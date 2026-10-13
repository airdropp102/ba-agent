import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,mkdir,readFile,writeFile} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {demoAnalysis,sampleTitle,sampleBrief} from '../src/demo.js';
import {buildFigmaHandoff} from '../src/figma-handoff.js';
import {buildPublishPlan,acceptVerifiedFigmaReport} from '../src/figma-registry.js';
import {unresolvedHigh,acceptClarificationRisk,hasCurrentWaiver,ensureWorkflow,qualitySnapshot} from '../src/intelligent-workflow.js';
import {resolveEvidenceSource} from '../src/revisions.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function launch(extra={}){
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-v32-wf-'));const port=22000+Math.floor(Math.random()*20000);
 const proc=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DEMO_MODE:'true',DATA_DIR:dir,...extra},stdio:'ignore'});
 const base=`http://127.0.0.1:${port}`;
 const api=async(route,method='GET',payload,headers={})=>{
   const res=await fetch(base+route,{method,headers:{...(payload!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:payload!==undefined?JSON.stringify(payload):undefined});
   const data=await res.json();return {status:res.status,data};
 };
 let ready=false;for(let i=0;i<100;i++){try{if((await api('/api/status')).status===200){ready=true;break}}catch{}await sleep(40)}
 assert.ok(ready,'Server failed to start');
 return {dir,proc,api,port,close:async()=>{proc.kill('SIGTERM');await new Promise(resolve=>{if(proc.exitCode!==null||proc.signalCode)resolve();else proc.once('close',resolve)});await rm(dir,{recursive:true,force:true})}};
}
const route=id=>`/api/projects/${id}`;
async function create(ctx){const r=await ctx.api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});assert.equal(r.status,201);return r.data;}
async function start(ctx,p){return ctx.api(`${route(p.id)}/workflow/advance`,'POST',{auto:true},{'If-Match':String(p.version)});}

test('workflow waits at clarification with durable checkpoints and no customer sign-off',async()=>{
 const s=await launch();try{
   const p=await create(s),result=await start(s,p);
   assert.equal(result.status,200);const a=result.data;
   assert.equal(a.workflow.stage,'CLARIFICATION');assert.equal(a.workflow.state,'WAITING_CLARIFICATION');
   assert.deepEqual(a.workflow.checkpoints.map(x=>x.stage),['BRAINSTORM','ELICITATION','GAP_ANALYSIS']);
   assert.equal(a.brainstorm.status,'DRAFT_HYPOTHESES');assert.equal(a.brainstorm.customerApproved,false);
   assert.equal(a.review,null);assert.equal(a.prototype,null);
   assert.ok(a.workflow.gapReport.highBlockerCount>0);
   assert.ok(a.analysis.functionalRequirements.every(x=>x.certainty!=='confirmed'||resolveEvidenceSource(x.sourceEvidence,a.sources)));
   const repeat=await start(s,a);assert.equal(repeat.status,200);assert.equal(repeat.data.version,a.version);
   const persisted=await s.api(route(p.id));assert.deepEqual(persisted.data.workflow.checkpoints,a.workflow.checkpoints);
   const unauthReview=await s.api(`${route(p.id)}/review`,'POST',{approved:true},{'If-Match':String(a.version)});
   assert.equal(unauthReview.status,409);
 }finally{await s.close()}
});

test('waiver binds to exact blocker set; BA approval required; design pack exported with coverage',async()=>{
 const s=await launch();try{
   const p=await create(s);const res=await start(s,p);assert.equal(res.status,200);
   let cur=res.data;const base=route(p.id), blockers=unresolvedHigh(cur);
   assert.ok(blockers.length>0);
   const wrong=await s.api(base+'/workflow/waiver','POST',{rationale:'Accepted despite open questions for draft only.',blockerIds:[]},{'If-Match':String(cur.version)});
   assert.equal(wrong.status,400);
   const accepted=await s.api(base+'/workflow/waiver','POST',{rationale:'BA accepted all listed open questions as documented draft design risks.',blockerIds:[...new Set(blockers.map(x=>x.id))]},{'If-Match':String(cur.version)});
   assert.equal(accepted.status,200);cur=accepted.data;assert.ok(hasCurrentWaiver(cur));
   const waiting=await start(s,cur);assert.equal(waiting.status,200);cur=waiting.data;
   assert.equal(cur.workflow.state,'WAITING_BA_REVIEW');assert.equal(cur.workflow.stage,'BA_REVIEW');
   const premature=await s.api(base+'/workflow/advance','POST',{auto:true},{'If-Match':String(cur.version)});
   assert.equal(premature.data.workflow.state,'WAITING_BA_REVIEW');
   const reviewed=await s.api(base+'/review','POST',{approved:true,notes:'Draft review; unanswered high questions retained.'},{'If-Match':String(cur.version)});
   assert.equal(reviewed.status,200);cur=reviewed.data;
   assert.equal(cur.workflow.stage,'DELIVERABLES');assert.equal(cur.review.approved,true);
   const finished=await start(s,cur);assert.equal(finished.status,200,JSON.stringify(finished.data));cur=finished.data;
   assert.equal(cur.workflow.state,'AWAITING_FIGMA');assert.equal(cur.workflow.stage,'FIGMA_PUBLISH');
   assert.ok(cur.workflow.artifactDir);
   assert.equal(cur.workflow.design.publication,'NOT_PUBLISHED');
   assert.equal(cur.workflow.design.coverage.requirements,3);
   assert.equal(cur.workflow.design.coverage.covered,3);
   for(const filename of ['BRD.md','SRS.md','canonical.json','prototype.html','FIGMA_INSTRUCTIONS.md','figma-publish-plan.json','quality-metrics.json']){
     assert.ok((await readFile(path.join(cur.workflow.artifactDir,filename),'utf8')).length>30,filename);
   }
   const doc=JSON.parse(await readFile(path.join(cur.workflow.artifactDir,'canonical.json')));
   assert.equal(doc.review.customerApproved,false);
   const noRegistry=await s.api(base+'/workflow/figma/sync','POST',{documentKey:'test_figma_key'},{'If-Match':String(cur.version)});
   assert.equal(noRegistry.status,409);
   const handoff=buildFigmaHandoff(cur),plan=buildPublishPlan(handoff.manifest);
   const report={documentKey:'test_figma_key',screens:plan.screens.map((x,i)=>({screenId:x.screenId,nodeId:`3:${100+i}`,verified:true})),notes:'verified by mocked operator'};
   const verified=acceptVerifiedFigmaReport(plan,report,{documentKey:'test_figma_key'});
   const rdir=path.join(s.dir,'.figma-registry',p.id);await mkdir(rdir,{recursive:true});
   await writeFile(path.join(rdir,'test_figma_key.json'),JSON.stringify(verified.registry));
   const synced=await s.api(base+'/workflow/figma/sync','POST',{documentKey:'test_figma_key'},{'If-Match':String(cur.version)});
   assert.equal(synced.status,200,JSON.stringify(synced.data));assert.equal(synced.data.workflow.state,'FIGMA_REPORTED');
   assert.equal(synced.data.workflow.figmaResult.state,'REPORTED_VERIFIED_PENDING_VISUAL_QA');
   const rerun=await start(s,synced.data);assert.equal(rerun.status,200);assert.equal(rerun.data.workflow.state,'FIGMA_REPORTED');
 }finally{await s.close()}
});

test('new customer answer invalidates waiver and downstream stages but keeps brainstorming',async()=>{
 const s=await launch();try{
   const p=await create(s);let r=await start(s,p);let cur=r.data;
   const ids=[...new Set(unresolvedHigh(cur).map(x=>x.id))];
   r=await s.api(`${route(p.id)}/workflow/waiver`,'POST',{rationale:'Accept all high priority uncertainties only for early draft.',blockerIds:ids},{'If-Match':String(cur.version)});cur=r.data;
   const questionId=cur.analysis.clarificationQuestions[0].id;
   r=await s.api(`${route(p.id)}/answers`,'POST',{questionId,answer:'Khách hàng yêu cầu xác thực qua tài khoản định danh.',respondent:'BA đại diện nghiệp vụ',sourceReference:'Meeting minutes 2026-10-13'},{'If-Match':String(cur.version)});
   assert.equal(r.status,200);cur=r.data;
   assert.equal(cur.workflow.stage,'GAP_ANALYSIS');assert.equal(cur.workflow.state,'READY');assert.equal(cur.workflow.waiver,null);
   assert.ok(cur.workflow.checkpoints.every(x=>['BRAINSTORM','ELICITATION'].includes(x.stage)));
   assert.equal(cur.analysis.functionalRequirements[0].id,'FR-001');
   r=await start(s,cur);assert.equal(r.status,200);assert.equal(r.data.workflow.state,'WAITING_CLARIFICATION');
 }finally{await s.close()}
});

test('failed AI stage is persisted and retry does not lose audit trail',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-wf-provider-'));
 const executable=path.join(dir,'fake-codex.cjs');
 const bad=`#!/usr/bin/env node\nconst fs=require('fs');const args=process.argv.slice(2);fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({wrong:'shape'}));\n`;
 const good=`#!/usr/bin/env node\nconst fs=require('fs');const args=process.argv.slice(2);fs.writeFileSync(args[args.indexOf('--output-last-message')+1],${JSON.stringify(JSON.stringify({summary:'Draft hypotheses',opportunities:['Map flows'],stakeholderQuestions:['Actors?'],assumptions:[],risks:[]}))});\n`;
 await writeFile(executable,bad,{mode:0o700});
 const s=await launch({DEMO_MODE:'false',AI_PROVIDER:'codex',CODEX_BIN:executable});
 try{
   const p=await create(s);let r=await start(s,p);
   assert.equal(r.status,502);let fresh=(await s.api(route(p.id))).data;
   assert.equal(fresh.workflow.state,'FAILED');assert.equal(fresh.workflow.stage,'BRAINSTORM');
   assert.equal(fresh.workflow.lastError.code,'STEP_FAILED');assert.equal(fresh.workflow.attempts.length,1);
   await writeFile(executable,good,{mode:0o700});
   r=await s.api(`${route(p.id)}/workflow/advance`,'POST',{auto:false},{'If-Match':String(fresh.version)});
   assert.equal(r.status,200,JSON.stringify(r.data));fresh=r.data;
   assert.equal(fresh.workflow.stage,'ELICITATION');assert.equal(fresh.workflow.attempts.length,2);
   assert.equal(fresh.workflow.lastError,null);assert.equal(fresh.brainstorm.status,'DRAFT_HYPOTHESES');
 }finally{await s.close();await rm(dir,{recursive:true,force:true})}
});

test('unresolved gating cannot be bypassed with stale waiver from earlier analysis',()=>{
 const p={brief:sampleBrief,analysis:{quality:{findings:[{id:'GAP-001',priority:'High',question:'Role?'}]},clarificationQuestions:[{id:'Q-001',priority:'High',question:'Role?'}],functionalRequirements:[],businessGoals:[]}};
 ensureWorkflow(p).stage='CLARIFICATION';
 const ids=[...new Set(unresolvedHigh(p).map(x=>x.id))];
 assert.throws(()=>acceptClarificationRisk(p,{blockerIds:ids,rationale:'short'}),/20-3000/);
 acceptClarificationRisk(p,{blockerIds:ids,rationale:'Document all open risks and seek later sign-off.'});
 assert.ok(hasCurrentWaiver(p));p.analysis.clarificationQuestions.push({id:'Q-002',priority:'High',question:'New issue'});
 assert.equal(hasCurrentWaiver(p),false);
 const report=qualitySnapshot(p);assert.equal(report.frCount,0);
});

test('crash in RUNNING stage survives process restart and is resumed by explicit request',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-v32-crash-'));
 const executable=path.join(dir,'slow-codex.cjs');
 await writeFile(executable,`#!/usr/bin/env node\nconst fs=require('fs');const args=process.argv.slice(2);const o=args[args.indexOf('--output-last-message')+1];setTimeout(()=>{fs.writeFileSync(o,JSON.stringify({summary:'Delayed',opportunities:[],stakeholderQuestions:[],assumptions:[],risks:[]}))},3000);\n`,{mode:0o700});
 const port=45000+Math.floor(Math.random()*10000),base=`http://127.0.0.1:${port}`;
 const env={...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir,DEMO_MODE:'false',AI_PROVIDER:'codex',CODEX_BIN:executable};
 const spawnServer=overrides=>spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...env,...overrides},stdio:'ignore'});
 const waitReady=async()=>{for(let i=0;i<90;i++){try{if((await fetch(base+'/api/status')).status===200)return;}catch{}await sleep(40)}throw new Error('Not ready')};
 let proc=spawnServer({});
 try{
   await waitReady();
   let response=await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:sampleTitle,brief:sampleBrief})});
   let p=await response.json();
   const pending=fetch(base+route(p.id)+'/workflow/advance',{method:'POST',headers:{'Content-Type':'application/json','If-Match':String(p.version)},body:JSON.stringify({auto:true})}).catch(()=>null);
   let running=false;for(let i=0;i<40;i++){await sleep(40);const r=await fetch(base+route(p.id));const q=await r.json();if(q.workflow.state==='RUNNING'){running=true;break}}
   assert.ok(running);
   proc.kill('SIGKILL');await new Promise(resolve=>proc.once('close',resolve));await pending;
   proc=spawnServer({DEMO_MODE:'true'});await waitReady();
   let r=await fetch(base+route(p.id));p=await r.json();
   assert.equal(p.workflow.state,'RUNNING');assert.equal(p.workflow.stage,'BRAINSTORM');
   r=await fetch(base+route(p.id)+'/workflow/advance',{method:'POST',headers:{'Content-Type':'application/json','If-Match':String(p.version)},body:JSON.stringify({auto:true})});
   assert.equal(r.status,200);p=await r.json();
   assert.equal(p.workflow.state,'WAITING_CLARIFICATION');
   assert.deepEqual(p.workflow.checkpoints.map(x=>x.stage),['BRAINSTORM','ELICITATION','GAP_ANALYSIS']);
 }finally{
   if(proc.exitCode===null&&!proc.signalCode){proc.kill('SIGTERM');await new Promise(resolve=>proc.once('close',resolve))}
   await rm(dir,{recursive:true,force:true});
 }
});

test('restarting creates isolated run and can select mobile without losing stable requirement IDs',async()=>{
 const s=await launch();try{
  const p=await create(s);let result=await start(s,p);assert.equal(result.status,200);
  const first=result.data,runId=first.workflow.runId;
  result=await s.api(`${route(p.id)}/workflow/restart`,'POST',{confirm:true,platform:'mobile'},{'If-Match':String(first.version)});
  assert.equal(result.status,200);const restarted=result.data;
  assert.notEqual(restarted.workflow.runId,runId);
  assert.equal(restarted.workflow.platform,'mobile');assert.equal(restarted.workflow.stage,'BRAINSTORM');
  assert.equal(restarted.review,null);assert.equal(restarted.workflow.checkpoints.length,0);
  result=await s.api(`${route(p.id)}/workflow/advance`,'POST',{auto:true,platform:'mobile'},{'If-Match':String(restarted.version)});
  assert.equal(result.status,200);
  assert.equal(result.data.workflow.platform,'mobile');assert.deepEqual(result.data.analysis.functionalRequirements.map(x=>x.id),['FR-001','FR-002','FR-003']);
  const changed=await s.api(`${route(p.id)}/workflow/advance`,'POST',{auto:true,platform:'web'},{'If-Match':String(result.data.version)});
  assert.equal(changed.status,409);
 }finally{await s.close()}
});

test('partially mapped prototype uses DRAFT-only fallback screen for missing FRs',()=>{
 const a=demoAnalysis(sampleTitle,sampleBrief);
 a.functionalRequirements.forEach((fr,i)=>{fr.id=`FR-${String(i+1).padStart(3,'0')}`});
 const project={id:'11111111-1111-4111-8111-111111111111',title:sampleTitle,brief:sampleBrief,version:7,status:'GENERATED',analysis:a,review:{approved:true,reviewedAt:'2026-10-13'},
 prototype:{screens:[{id:'SCR-001',title:'Đăng ký',description:'draft',requirementIds:['FR-001'],components:[]}]}};
 const handoff=buildFigmaHandoff(project);
 assert.equal(handoff.manifest.screens.length,3);
 const supplemental=handoff.manifest.screens.filter(s=>s.id.startsWith('SCR-DRAFT-'));
 assert.equal(supplemental.length,2);
 assert.ok(supplemental.every(s=>s.designStatus==='DRAFT-SCREEN-CANDIDATE'&&s.components.every(x=>['heading','paragraph'].includes(x.type))));
 assert.deepEqual(handoff.manifest.screens.flatMap(x=>x.requirementIds).sort(),['FR-001','FR-002','FR-003']);
});

test('Figma design source digest invalidates old screens when requirement semantics change',()=>{
 const manifest={project:{id:'11111111-1111-4111-8111-111111111111',version:11},platform:'web',designSourceDigest:'requirements-v1',screens:[{id:'SCR-001',requirementIds:['FR-001'],components:[]}]};
 const plan=buildPublishPlan(manifest);
 const accepted=acceptVerifiedFigmaReport(plan,{documentKey:'figma_key',screens:[{screenId:'SCR-001',nodeId:'1:8',verified:true}]},{documentKey:'figma_key'});
 assert.equal(buildPublishPlan(manifest,accepted.registry).screens[0].action,'skip');
 assert.equal(buildPublishPlan({...manifest,designSourceDigest:'requirements-v2'},accepted.registry).screens[0].action,'create');
});

test('workflow progress browser module is served as JavaScript',async()=>{
 const s=await launch();try{
  const base=`http://127.0.0.1:${s.port}`;
  const res=await fetch(base+'/workflow-progress.js');
  assert.equal(res.status,200);assert.match(res.headers.get('content-type'),/javascript/);
 }finally{await s.close()}
});

test('provider timeout is identified safely and retains workflow checkpoint',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-wf-timeout-'));
 const executable=path.join(dir,'timeout.cjs');
 await writeFile(executable,'#!/usr/bin/env node\nsetInterval(()=>{},10000);\n',{mode:0o700});
 const s=await launch({DEMO_MODE:'false',AI_PROVIDER:'codex',CODEX_BIN:executable,CODEX_TIMEOUT_MS:'100'});
 try{
  const p=await create(s);const result=await start(s,p);
  assert.equal(result.status,502);
  const fresh=(await s.api(route(p.id))).data;
  assert.equal(fresh.workflow.state,'FAILED');
  assert.equal(fresh.workflow.lastError.code,'PROVIDER_TIMEOUT');
  assert.match(fresh.workflow.lastError.message,/thời gian chờ/);
  assert.doesNotMatch(fresh.workflow.lastError.message,/Customer|API_KEY/);
  assert.equal(fresh.workflow.checkpoints.length,0);
 }finally{await s.close();await rm(dir,{recursive:true,force:true})}
});
