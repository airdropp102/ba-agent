import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fingerprint} from '../src/revisions.js';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {ProductionStore} from '../src/production-store.js';
import {sampleBrief,sampleTitle} from '../src/demo.js';
import {unresolvedHigh} from '../src/intelligent-workflow.js';
import {buildFigmaHandoff} from '../src/figma-handoff.js';
import {buildPublishPlan,acceptVerifiedFigmaReport} from '../src/figma-registry.js';
import {beginFigmaDesign,completeFigmaDesign,reviewFigmaDesign} from '../src/figma-design-review.js';
import {demoAnalysis,demoPrototype} from '../src/demo.js';
import {normalizeAnalysis,normalizePrototype} from '../src/normalize.js';
import {mkdir} from 'node:fs/promises';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const temp=()=>mkdtemp(path.join(os.tmpdir(),'ba-v33-'));
const project=(id=randomUUID())=>({id,title:'Production test',brief:sampleBrief,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),version:1,workflow:{runId:randomUUID(),stage:'BRAINSTORM',state:'READY'}});

async function launch(dir,opts={}) {
 const server=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,HOST:'127.0.0.1',PORT:String(opts.port),DATA_DIR:dir,DEMO_MODE:'true',BA_JOB_POLL_MS:'60',...opts.env},stdio:'ignore'});
 const base=`http://127.0.0.1:${opts.port}`;
 const api=async(route,method='GET',data)=>{const r=await fetch(base+route,{method,headers:data!==undefined?{'Content-Type':'application/json'}:{},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()}};
 let ok=false;for(let i=0;i<100;i++){try{if((await api('/api/status')).status===200){ok=true;break}}catch{}await sleep(35)}
 if(!ok){server.kill('SIGKILL');throw new Error('Server did not start')}
 return {server,api,stop:async()=>{if(server.exitCode===null&&!server.signalCode){server.kill('SIGKILL');await new Promise(r=>server.once('close',r))}}};
}

async function until(fn,limitMs=4000){const end=Date.now()+limitMs;while(Date.now()<end){const val=await fn();if(val)return val;await sleep(45)}throw new Error('Timed out waiting for expected job state')}

test('Browser entrypoint and all imported UI modules are served as JavaScript',async()=>{
 const dir=await temp();let server;
 try{
  const port=45000+Math.floor(Math.random()*3000);server=await launch(dir,{port});
  const base=`http://127.0.0.1:${port}`;
  const html=await (await fetch(base)).text();
  const entry=html.match(/<script type="module" src="([^"]+)"/);
  assert.ok(entry,'HTML must load a module entrypoint');
  const pending=[new URL(entry[1],base).href],visited=new Set();
  while(pending.length){
   const url=pending.pop();if(visited.has(url))continue;visited.add(url);
   const response=await fetch(url);
   assert.equal(response.status,200,`Missing browser module: ${url}`);
   assert.match(response.headers.get('content-type'),/application\/javascript/);
   const source=await response.text();
   for(const match of source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g))pending.push(new URL(match[1],url).href);
  }
  assert.ok(visited.has(new URL('/figma-review-ui.js',base).href));
 }finally{await server?.stop();await rm(dir,{recursive:true,force:true})}
});

test('SQLite is source of truth; stale writers rejected and audit chain survives rollback',async()=>{
 const dir=await temp();try{
  const a=new ProductionStore(dir),b=new ProductionStore(dir),p=project();a.save(p);
  const stale=b.get(p.id),current=a.get(p.id);
  current.version++;current.updatedAt=new Date().toISOString();a.save(current,{actorId:'ba-reviewer',eventType:'TEST_REVIEW',details:{reason:'approved draft'}});
  stale.version++;assert.throws(()=>b.save(stale),/Concurrent project update/);
  assert.equal(a.get(p.id).version,2);assert.deepEqual(a.history(p.id).map(x=>x.version),[1,2]);
  assert.deepEqual(a.verifyAudit(p.id).valid,true);assert.equal(a.audit(p.id).length,2);
  a.db.close();b.db.close();
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('Cross-process-style queue claim fenced; stale token cannot commit or finish',async()=>{
 const dir=await temp();try{
  const a=new ProductionStore(dir),b=new ProductionStore(dir),p=project();a.save(p);
  const j=a.enqueue(p.id,p.workflow.runId,{auto:true});
  const first=a.claimJob();assert.equal(first.id,j.id);assert.equal(b.claimJob(),null);
  const fetched=a.get(p.id,{leaseToken:first.token});fetched.version++;
  // Simulate a crash/expired lease, without relying on real elapsed wall clock.
  a.db.prepare('UPDATE project_leases SET expires_at=? WHERE project_id=?').run(Date.now()-1000,p.id);
  a.db.prepare('UPDATE workflow_jobs SET lease_until=? WHERE id=?').run(Date.now()-1000,j.id);
  const second=b.claimJob();assert.equal(second.id,j.id);assert.notEqual(second.token,first.token);
  assert.throws(()=>a.save(fetched),/Expired or stolen executor lease/);
  assert.throws(()=>a.finishJob(j.id,first.token),/Stale worker/);
  assert.equal(b.finishJob(j.id,second.token,{resultVersion:p.version}),'SUCCEEDED');
  assert.equal(b.job(j.id).attempts,2);assert.equal(b.verifyAudit(p.id).valid,true);
  const metrics=b.metrics();assert.equal(metrics.totalJobs,1);assert.equal(metrics.states.SUCCEEDED,1);assert.equal(metrics.retriedJobs,1);assert.equal(metrics.successRateCompleted,1);
  a.db.close();b.db.close();
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('Expired running job at max attempts is dead-lettered, not claimed again',async()=>{
 const dir=await temp();try{
  const s=new ProductionStore(dir),p=project();s.save(p);const j=s.enqueue(p.id,p.workflow.runId,{}, {maxAttempts:1});
  assert.ok(s.claimJob());s.db.prepare('UPDATE project_leases SET expires_at=?').run(Date.now()-5);s.db.prepare('UPDATE workflow_jobs SET lease_until=?').run(Date.now()-5);
  assert.equal(s.claimJob(),null);assert.equal(s.job(j.id).state,'DEAD_LETTER');assert.equal(s.job(j.id).attempts,1);
  assert.equal(s.verifyAudit(p.id).valid,true);s.db.close();
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('Figma channel credentials stay private in job reads and are scrubbed after terminal state',async()=>{
 const dir=await temp();try{
  const store=new ProductionStore(dir),p=project();store.save(p);const queued=store.enqueue(p.id,randomUUID(),{kind:'figma-design',channelId:'private-channel',documentKey:'figma_key'},{maxAttempts:1});
  assert.equal(store.job(queued.id).options.channelId,undefined);const claimed=store.claimJob();assert.equal(claimed.options.channelId,'private-channel');
  store.finishJob(claimed.id,claimed.token,{resultVersion:p.version});assert.equal(store.job(queued.id).options.channelId,undefined);store.db.close();
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('Loopback API starts and stops its managed Figma socket relay',async()=>{
 const dir=await temp();let server;const relayPort=31000+Math.floor(Math.random()*10000),fakeBun=path.join(dir,'fake-bun.cjs');try{
  await writeFile(fakeBun,'#!/usr/bin/env node\nrequire("node:net").createServer().listen(Number(process.env.FIGMA_RELAY_PORT),"127.0.0.1");\n',{mode:0o700});
  server=await launch(dir,{port:45000+Math.floor(Math.random()*3000),env:{BUN_BIN:fakeBun,FIGMA_RELAY_PORT:String(relayPort)}});
  assert.equal((await server.api('/api/figma/relay')).data.state,'STOPPED');
  const started=await server.api('/api/figma/relay/start','POST',{});assert.equal(started.status,200,JSON.stringify(started.data));assert.equal(started.data.state,'READY');
  const stopped=await server.api('/api/figma/relay/stop','POST',{});assert.equal(stopped.data.state,'STOPPED');
 }finally{if(server)await server.stop();await rm(dir,{recursive:true,force:true})}
});

test('Figma design API binds queued work to project version without exposing channel credentials',async()=>{
 const dir=await temp();let server;const relayPort=42000+Math.floor(Math.random()*5000),fakeBun=path.join(dir,'fake-bun.cjs');try{
  await writeFile(fakeBun,'#!/usr/bin/env node\nrequire("node:net").createServer().listen(Number(process.env.FIGMA_RELAY_PORT),"127.0.0.1");\n',{mode:0o700});
  server=await launch(dir,{port:47000+Math.floor(Math.random()*2000),env:{BA_WORKER_ENABLED:'false',BUN_BIN:fakeBun,FIGMA_RELAY_PORT:String(relayPort)}});
  let result=await server.api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});assert.equal(result.status,201);const id=result.data.id,base=`/api/projects/${id}`;
  assert.equal((await server.api(base+'/analyze','POST',{})).status,200);
  assert.equal((await server.api(base+'/review','POST',{approved:true,notes:'BA Review complete for design handoff.'})).status,200);
  assert.equal((await server.api(base+'/generate','POST',{})).status,200);
  assert.equal((await server.api('/api/figma/relay/start','POST',{})).status,200);
  assert.equal((await server.api(base+'/figma-design','POST',{fileUrl:'https://www.figma.com/design/abc-123/MyFile',channelId:'private-channel-1',fileIdentityConfirmed:'true'})).status,400);
  result=await server.api(base+'/figma-design','POST',{fileUrl:'https://www.figma.com/design/abc-123/MyFile',channelId:'private-channel-1',fileIdentityConfirmed:true});
  assert.equal(result.status,202,JSON.stringify(result.data));assert.equal(result.data.state,'QUEUED');
  assert.equal(JSON.stringify(result.data).includes('private-channel-1'),false);
  const design=await server.api(base+'/figma-design');assert.equal(design.data.figmaDesign.state,'QUEUED');assert.equal(JSON.stringify(design.data).includes('private-channel-1'),false);
  assert.equal(design.data.figmaDesign.fileConfirmation.source,'OPERATOR_FILE_CONFIRMATION_NOT_INDEPENDENT_ATTESTATION');
  assert.equal(design.data.figmaDesign.fileConfirmation.projectVersion,design.data.version);
  assert.equal(design.data.figmaDesign.fileConfirmation.runId,design.data.figmaDesign.runId);
  assert.equal(design.data.figmaDesign.fileConfirmation.documentKey,'abc-123');
  const job=await server.api(base+'/workflow/jobs/'+result.data.jobId);assert.equal(job.data.options.kind,'figma-design');assert.equal(JSON.stringify(job.data).includes('private-channel-1'),false);
  const projectRead=await server.api(base);assert.equal(JSON.stringify(projectRead.data).includes('private-channel-1'),false);
  await server.api('/api/figma/relay/stop','POST',{});
 }finally{if(server)await server.stop();await rm(dir,{recursive:true,force:true})}
});

test('Figma worker preserves approval denial in failed state without retrying or exposing credentials',async()=>{
 const dir=await temp();let server;
 try{
  const fakeBun=path.join(dir,'fake-bun.cjs'),fakeCodex=path.join(dir,'fake-codex.cjs');
  await writeFile(fakeBun,'#!/usr/bin/env node\nrequire("node:net").createServer().listen(Number(process.env.FIGMA_RELAY_PORT),"127.0.0.1");\n',{mode:0o700});
  await writeFile(fakeCodex,'#!/usr/bin/env node\nconst fs=require("fs"),args=process.argv.slice(2);process.stdin.resume();process.stdin.on("end",()=>fs.writeFileSync(args[args.indexOf("--output-last-message")+1],JSON.stringify({connected:false,documentKey:"",failureCode:"MCP_APPROVAL_REQUIRED"})));\n',{mode:0o700});
  server=await launch(dir,{port:47000+Math.floor(Math.random()*2000),env:{BUN_BIN:fakeBun,CODEX_BIN:fakeCodex,FIGMA_RELAY_PORT:String(42000+Math.floor(Math.random()*5000))}});
  const created=await server.api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});const base=`/api/projects/${created.data.id}`;
  assert.equal((await server.api(base+'/analyze','POST',{})).status,200);
  assert.equal((await server.api(base+'/review','POST',{approved:true,notes:'BA Review complete for fixture design.'})).status,200);
  assert.equal((await server.api(base+'/generate','POST',{})).status,200);
  assert.equal((await server.api('/api/figma/relay/start','POST',{})).status,200);
  assert.equal((await server.api(base+'/figma-design','POST',{fileUrl:'https://www.figma.com/design/fixture-file/Test',channelId:'private-fixture-channel'})).status,202);
  const result=await until(async()=>{const r=await server.api(base+'/figma-design');return r.data.figmaDesign.state==='FAILED'&&r.data.job.state==='DEAD_LETTER'?r.data:null});
  assert.equal(result.figmaDesign.errorCode,'MCP_APPROVAL_REQUIRED');
  assert.equal(result.job.last_error,'MCP_APPROVAL_REQUIRED');assert.equal(result.job.attempts,1);
  assert.equal(result.figmaDesign.draft,null);assert.equal(JSON.stringify(result).includes('private-fixture-channel'),false);
  await server.api('/api/figma/relay/stop','POST',{});
 }finally{await server?.stop();await rm(dir,{recursive:true,force:true})}
});

test('approved Figma design reopens through the API and queues a revision on a fresh channel without changing the prior approval',async()=>{
 const dir=await temp();let server;
 try{
  const id=randomUUID(),previewRun=randomUUID(),analysis=normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief),manifestDigest='a'.repeat(64);
  const p={id,title:sampleTitle,brief:sampleBrief,status:'GENERATED',version:10,analysis,prototype:normalizePrototype(demoPrototype(analysis),analysis),review:{approved:true,customerApproved:false},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const start=beginFigmaDesign(p,{documentKey:'fixture-file',channelId:'old-channel',jobId:randomUUID()});
  const screens=p.prototype.screens.map((s,i)=>({screenId:s.id,nodeId:`2:${i+1}`,verified:true,requirementIds:s.requirementIds}));
  const files=screens.map(s=>({screenId:s.screenId,path:`04-figma/exports/v10-web/previews/${previewRun}/${s.screenId}.jpg`,contentType:'image/jpeg',sha256:'b'.repeat(64),sizeBytes:4}));
  const draft=completeFigmaDesign(start,{runId:start.figmaDesign.runId,projectVersion:10,manifestDigest,screens,previewFiles:files});
  const approved=reviewFigmaDesign(draft,{decision:'APPROVE',notes:'OFFLINE FIXTURE',reviewerId:'fixture-reviewer',projectVersion:10,manifestDigest});
  approved.version=11;approved.figmaDesign.draft.projectVersion=11;approved.figmaDesign.approved.projectVersion=11;
  const store=new ProductionStore(dir);store.save(approved);store.db.close();
  const fakeBun=path.join(dir,'fake-bun.cjs');await writeFile(fakeBun,'#!/usr/bin/env node\nrequire("node:net").createServer().listen(Number(process.env.FIGMA_RELAY_PORT),"127.0.0.1");\n',{mode:0o700});
  server=await launch(dir,{port:47000+Math.floor(Math.random()*2000),env:{BA_WORKER_ENABLED:'false',BUN_BIN:fakeBun,FIGMA_RELAY_PORT:String(42000+Math.floor(Math.random()*5000))}});
  const base=`/api/projects/${id}`;
  const reopened=await server.api(base+'/figma-design/review','POST',{decision:'REQUEST_CHANGES',notes:'Update the approved screen typography',projectVersion:11,manifestDigest});
  assert.equal(reopened.status,200,JSON.stringify(reopened.data));assert.equal(reopened.data.figmaDesign.state,'REVISION_REQUESTED');assert.equal(reopened.data.figmaDesign.approved.projectVersion,11);
  assert.equal(reopened.data.figmaDesign.history.length,2);assert.equal((await server.api(base)).data.review.customerApproved,false);
  assert.equal((await server.api('/api/figma/relay/start','POST',{})).status,200);
  const queued=await server.api(base+'/figma-design','POST',{revisionNotes:'Update the approved screen typography',channelId:'fresh-private-channel',fileIdentityConfirmed:true});
  assert.equal(queued.status,202,JSON.stringify(queued.data));assert.equal(queued.data.figmaDesign.approved.projectVersion,11);
  assert.equal(queued.data.figmaDesign.draft,null);assert.equal(queued.data.figmaDesign.fileConfirmation.documentKey,'fixture-file');assert.equal(JSON.stringify(queued.data).includes('fresh-private-channel'),false);
  await server.api('/api/figma/relay/stop','POST',{});
 }finally{await server?.stop();await rm(dir,{recursive:true,force:true})}
});

test('Figma challenge consume + project commit are atomic, stale version cannot burn nonce',async()=>{
 const dir=await temp();try{
  const a=new ProductionStore(dir),p=project();a.save(p);
  const ch=a.issueReadbackChallenge({projectId:p.id,runId:p.workflow.runId,documentKey:'figma_key',manifestDigest:'digest',screens:[]});
  const old=a.get(p.id),fresh=a.get(p.id);fresh.version++;a.save(fresh);
  old.version++;assert.throws(()=>a.save(old,{consumeChallenge:ch.nonce}),/Concurrent project update/);
  assert.equal(a.getReadbackChallenge(ch.nonce).usedAt,null);
  const latest=a.get(p.id);latest.version++;a.save(latest,{eventType:'FIGMA_READBACK_RECORDED',actorId:'reviewer-1',consumeChallenge:ch.nonce});
  assert.ok(a.getReadbackChallenge(ch.nonce).usedAt);
  const next=a.get(p.id);next.version++;assert.throws(()=>a.save(next,{consumeChallenge:ch.nonce}),/reused or invalidated/);
  assert.equal(a.get(p.id).version,3);assert.equal(a.verifyAudit(p.id).valid,true);a.db.close();
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('Two Node servers share one SQLite queue without double execution; project audit reads back',async()=>{
 const dir=await temp();let a,b;try{
  const port=39000+Math.floor(Math.random()*9000);a=await launch(dir,{port});b=await launch(dir,{port:port+1});
  const created=await a.api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});assert.equal(created.status,201);
  const id=created.data.id,base=`/api/projects/${id}`;
  const enq=await a.api(base+'/workflow/jobs','POST',{auto:true});assert.equal(enq.status,202);
  const duplicate=await b.api(base+'/workflow/jobs','POST',{auto:true});assert.equal(duplicate.status,409);
  const job=await until(async()=>{const r=await a.api(base+'/workflow/jobs/'+enq.data.jobId);return ['SUCCEEDED','DEAD_LETTER'].includes(r.data.state)?r.data:null});
  assert.equal(job.state,'SUCCEEDED');assert.equal(job.attempts,1);
  const p=(await b.api(base)).data;assert.equal(p.workflow.stage,'CLARIFICATION');assert.equal(p.workflow.state,'WAITING_CLARIFICATION');
  assert.deepEqual(p.workflow.checkpoints.map(x=>x.stage),['BRAINSTORM','ELICITATION','GAP_ANALYSIS']);
  const audit=await a.api(base+'/audit');assert.equal(audit.status,200);assert.equal(audit.data.integrity.valid,true);
  assert.ok(audit.data.events.some(x=>x.event_type==='JOB_SUCCEEDED'));
 }finally{if(a)await a.stop();if(b)await b.stop();await rm(dir,{recursive:true,force:true})}
});

test('Worker restart resumes interrupted stage from durable checkpoint, not previous attempt',async()=>{
 const dir=await temp();let a,b;try{
  const fake=path.join(dir,'fake-codex.cjs'),port=40000+Math.floor(Math.random()*7000);
  // First provider blocks long enough to kill the worker mid-stage.
  await writeFile(fake,'#!/usr/bin/env node\nsetTimeout(()=>{},60000);\n',{mode:0o700});
  const env={DEMO_MODE:'false',AI_PROVIDER:'codex',CODEX_BIN:fake,CODEX_TIMEOUT_MS:'20000'};
  a=await launch(dir,{port,env});
  const r=await a.api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});assert.equal(r.status,201);
  const id=r.data.id,base=`/api/projects/${id}`;
  assert.equal((await a.api(base+'/workflow/jobs','POST',{auto:false})).status,202);
  await until(async()=>{const p=(await a.api(base)).data;return p.workflow.currentAttempt?.stage==='BRAINSTORM'?p:null});
  await a.stop();a=null;
  // Recovery detects owner process termination, releases lease, requeues durable job.
  const valid=JSON.stringify({summary:'Draft hypotheses',opportunities:['Map flows'],stakeholderQuestions:['Actors?'],assumptions:[],risks:[]});
  await writeFile(fake,`#!/usr/bin/env node\nconst fs=require('fs');const a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf('--output-last-message')+1],${JSON.stringify(valid)});\n`,{mode:0o700});
  b=await launch(dir,{port:port+1,env});
  const completed=await until(async()=>{const jobs=(await b.api(base+'/workflow/jobs')).data;return jobs[0]?.state==='SUCCEEDED'?jobs[0]:null},5000);
  assert.equal(completed.attempts,2);
  const p=(await b.api(base)).data;
  assert.equal(p.workflow.stage,'ELICITATION');assert.equal(p.workflow.checkpoints.length,1);
  assert.deepEqual(p.workflow.attempts.map(x=>x.result),['ABANDONED','SUCCEEDED']);
  assert.equal((await b.api(base+'/audit')).data.integrity.valid,true);
 }finally{if(a)await a.stop();if(b)await b.stop();await rm(dir,{recursive:true,force:true})}
});

test('End-to-end Figma read-back nonce, replay protection, human visual QA + audit',async()=>{
 const dir=await temp();let a;try{
  a=await launch(dir,{port:42000+Math.floor(Math.random()*5000),env:{BA_WORKER_ENABLED:'false'}});
  let r=await a.api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});assert.equal(r.status,201);
  const id=r.data.id,base=`/api/projects/${id}`;
  r=await a.api(base+'/workflow/advance','POST',{auto:true});assert.equal(r.status,200);
  let p=r.data,ids=[...new Set(unresolvedHigh(p).map(x=>x.id))];
  r=await a.api(base+'/workflow/waiver','POST',{rationale:'All remaining high gaps explicitly accepted for BA draft design only.',blockerIds:ids});assert.equal(r.status,200);
  r=await a.api(base+'/workflow/advance','POST',{auto:true});assert.equal(r.data.workflow.state,'WAITING_BA_REVIEW');
  r=await a.api(base+'/review','POST',{approved:true,notes:'Reviewer explicitly approved BA draft handoff.'});assert.equal(r.status,200);
  r=await a.api(base+'/workflow/advance','POST',{auto:true});assert.equal(r.status,200);p=r.data;
  assert.equal(p.workflow.state,'COMPLETED');
  // Restore a historical manual-publish fixture to verify backward-compatible APIs.
  const legacyStore=new ProductionStore(dir);p=legacyStore.get(id);
  p.workflow.stage='FIGMA_PUBLISH';p.workflow.state='AWAITING_FIGMA';
  p.workflow.artifactDir=path.join(dir,'legacy-design-pack');p.workflow.design={publication:'NOT_PUBLISHED',manifestDigest:fingerprint(JSON.stringify(buildFigmaHandoff(p).manifest))};
  await mkdir(p.workflow.artifactDir,{recursive:true});
  await writeFile(path.join(p.workflow.artifactDir,'figma-manifest.json'),JSON.stringify(buildFigmaHandoff(p).manifest));
  p.version++;legacyStore.save(p);legacyStore.db.close();
  const key='ba_figma_test',manifest=buildFigmaHandoff(p).manifest,plan=buildPublishPlan(manifest);
  const report={documentKey:key,screens:plan.screens.map((sc,i)=>({screenId:sc.screenId,nodeId:`2:${i+150}`,verified:true})),notes:'mocked MCP report for offline test'};
  const verified=acceptVerifiedFigmaReport(plan,report,{documentKey:key});
  const regDir=path.join(dir,'.figma-registry',id);await mkdir(regDir,{recursive:true});
  await writeFile(path.join(regDir,`${key}.json`),JSON.stringify(verified.registry));
  r=await a.api(base+'/workflow/figma/sync','POST',{documentKey:key});assert.equal(r.status,200);
  r=await a.api(base+'/workflow/figma/challenge','POST',{documentKey:key});assert.equal(r.status,201,JSON.stringify(r.data));
  const challenge=r.data;
  const liveReport={nonce:challenge.nonce,documentKey:key,documentInfoRead:true,reportedFileKey:key,screens:challenge.screens.map(sc=>({screenId:sc.screenId,nodeId:sc.nodeId,nodeType:'FRAME',nodeName:sc.nodeName,readbackOk:true}))};
  const broken=JSON.parse(JSON.stringify(liveReport));broken.screens[0].nodeName='WRONG';
  r=await a.api(base+'/workflow/figma/readback','POST',{report:broken});assert.equal(r.status,409);
  r=await a.api(base+'/workflow/figma/readback','POST',{report:liveReport});assert.equal(r.status,200,JSON.stringify(r.data));
  assert.equal(r.data.workflow.state,'FIGMA_READBACK_REPORTED');
  assert.match(r.data.workflow.figmaResult.readback.kind,/NOT_INDEPENDENT_ATTESTATION/);
  const replay=await a.api(base+'/workflow/figma/readback','POST',{report:liveReport});assert.equal(replay.status,409);
  const short=await a.api(base+'/workflow/figma/qa','POST',{approved:true,notes:'ok'});assert.equal(short.status,400);
  r=await a.api(base+'/workflow/figma/qa','POST',{approved:true,notes:'BA verified each frame and correct Figma file in visual QA.'});assert.equal(r.status,200);
  assert.equal(r.data.workflow.state,'FIGMA_QA_APPROVED');
  assert.match(r.data.workflow.figmaResult.visualQA.state,/NOT_CUSTOMER_SIGNOFF/);
  const audit=(await a.api(base+'/audit')).data;
  assert.equal(audit.integrity.valid,true);assert.ok(audit.events.some(x=>x.event_type==='FIGMA_READBACK_RECORDED'));
  assert.ok(audit.events.some(x=>x.event_type==='FIGMA_VISUAL_QA_APPROVED'));
 }finally{if(a)await a.stop();await rm(dir,{recursive:true,force:true})}
});

test('Standalone worker consumes API-queued jobs when embedded worker is disabled',async()=>{
 const dir=await temp();let apiServer,worker;try{
  apiServer=await launch(dir,{port:43000+Math.floor(Math.random()*4000),env:{BA_WORKER_ENABLED:'false'}});
  const created=await apiServer.api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});assert.equal(created.status,201);
  const base=`/api/projects/${created.data.id}`;
  const queued=await apiServer.api(base+'/workflow/jobs','POST',{auto:false});assert.equal(queued.status,202);
  await sleep(170);
  assert.equal((await apiServer.api(base+'/workflow/jobs/'+queued.data.jobId)).data.state,'QUEUED');
  worker=spawn(process.execPath,['scripts/worker.mjs'],{cwd:process.cwd(),env:{...process.env,DEMO_MODE:'true',DATA_DIR:dir,BA_JOB_POLL_MS:'50'},stdio:'ignore'});
  const job=await until(async()=>{const result=(await apiServer.api(base+'/workflow/jobs/'+queued.data.jobId)).data;return result.state==='SUCCEEDED'?result:null});
  assert.equal(job.attempts,1);
  const final=(await apiServer.api(base)).data;
  assert.equal(final.workflow.stage,'ELICITATION');
  assert.deepEqual(final.workflow.checkpoints.map(x=>x.stage),['BRAINSTORM']);
  assert.equal((await apiServer.api(base+'/audit')).data.integrity.valid,true);
 }finally{
  if(worker){worker.kill('SIGKILL');await new Promise(r=>worker.exitCode!==null||worker.signalCode?r():worker.once('close',r))}
  if(apiServer)await apiServer.stop();await rm(dir,{recursive:true,force:true});
 }
});
