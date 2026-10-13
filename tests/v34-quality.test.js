import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {demoAnalysis,sampleBrief,sampleTitle} from '../src/demo.js';
import {normalizeAnalysis} from '../src/normalize.js';
import {prepareBAAnalysis} from '../src/ba-quality.js';
import {buildSources,applyEvidenceTrust,fingerprint} from '../src/revisions.js';
import {assessDeliverables,qualityPolicy} from '../src/quality-intelligence.js';
import {analysisSignature,unresolvedHigh} from '../src/intelligent-workflow.js';
import {setTelemetrySink,withAIContext,noteUsage,measureAI,costRates} from '../src/ai-telemetry.js';
import {ProductionStore} from '../src/production-store.js';
import {validateLiveProbe} from '../src/figma-mcp-contract.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function fixture(){const id=randomUUID(),analysis=prepareBAAnalysis(applyEvidenceTrust(normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief),buildSources(sampleBrief)));
 const p={id,title:sampleTitle,brief:sampleBrief,sources:buildSources(sampleBrief),analysis,version:2,demo:true,review:{approved:true,reviewedAt:new Date().toISOString()},workflow:{runId:randomUUID(),stage:'DELIVERABLES',state:'READY',checkpoints:[]},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
 p.workflow.waiver={analysisSignature:analysisSignature(p),blockerDigest:fingerprint(JSON.stringify(unresolvedHigh(p)))};return p;}

test('BRD/SRS quality proxy validates 100% grounded positive fixture without calling AI',()=>{
 const q=assessDeliverables(fixture());assert.equal(q.decision,'PASS');assert.equal(q.score,1);assert.equal(q.counts.documentTraces,3);
 assert.equal(q.counts.groundedConfirmed,4);assert.equal(q.kind,'deterministic-structure-and-evidence-proxy-not-semantic-certification');
});
test('Unsafe confirmed source evidence is blocking even with high weighted score',()=>{
 const p=fixture();p.analysis.functionalRequirements[0].sourceEvidence='Fabricated client confirmation';
 const q=assessDeliverables(p);assert.equal(q.decision,'BLOCK');assert.ok(q.findings.some(f=>f.code==='UNTRUSTED_CONFIRMED_EVIDENCE'));
});
test('Empty scope is not marked as perfect; no requirements are a hard blocker',()=>{
 const p=fixture();p.analysis.functionalRequirements=[];
 const q=assessDeliverables(p);assert.equal(q.decision,'BLOCK');assert.ok(q.findings.some(f=>f.code==='NO_FUNCTIONAL_REQUIREMENTS'));assert.equal(q.score,null);
});
test('Acceptance, actor, goal and document coverage findings produce actionable severity',()=>{
 const p=fixture();const r=p.analysis.functionalRequirements[0];r.acceptanceCriteria=[];r.actor='';r.relatedBusinessGoal='';
 let q=assessDeliverables(p,{policy:{...qualityPolicy(),minScore:0.99}});
 assert.equal(q.decision,'REVIEW');assert.ok(q.findings.some(f=>f.code==='AC_MISSING'));assert.ok(q.findings.some(f=>f.code==='ACTOR_MISSING'));
 q=assessDeliverables(p,{brd:'No IDs here',srs:'No IDs here'});assert.equal(q.decision,'BLOCK');assert.ok(q.findings.some(f=>f.code==='DOC_TRACE_MISSING'));
});
test('Quality threshold and price configurations reject invalid values',()=>{
 assert.throws(()=>qualityPolicy({BA_QUALITY_MIN_SCORE:'1.4'}),/0 to 1/);
 assert.throws(()=>costRates({BA_AI_COST_RATES_JSON:'{"provider":{"inputPerMillionUsd":-5,"outputPerMillionUsd":0}}'}),/Invalid/);
 assert.equal(qualityPolicy({BA_QUALITY_ENFORCE:'true',BA_QUALITY_MIN_SCORE:'0.9'}).enforce,true);
});
test('SQLite usage ledger records known configured costs, unknown Codex costs, and p95',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-v34-'));
 try{const store=new ProductionStore(dir),p=fixture();store.save(p);
  store.recordAIUsage({id:randomUUID(),projectId:p.id,runId:p.workflow.runId,stage:'ELICITATION',operation:'elicitation',provider:'openai',model:'test',startedAt:new Date().toISOString(),durationMs:150,status:'OK',inputTokens:100,outputTokens:50,costUsd:0.0002,rateVersion:'operator-configured'});
  store.recordAIUsage({id:randomUUID(),projectId:p.id,runId:p.workflow.runId,stage:'BRAINSTORM',operation:'brainstorm',provider:'codex',model:'codex-cli',startedAt:new Date().toISOString(),durationMs:300,status:'OK',inputTokens:null,outputTokens:null,costUsd:null,rateVersion:null});
  const m=store.aiMetrics(p.id);assert.equal(m.calls,2);assert.equal(m.knownCostUsd,0.0002);assert.equal(m.unknownCostCalls,1);assert.equal(m.missingUsage,1);assert.equal(m.p95LatencyMs,300);assert.equal(m.inputTokens,100);
  const data=store.db.prepare('SELECT * FROM ai_invocations').all();assert.equal(data.length,2);assert.ok(data.every(x=>!('prompt' in x)&&!('completion' in x)));
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM schema_migrations WHERE version=3').get().n,1);store.db.close();
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('AI telemetry isolates concurrent invocation context and never guesses missing token costs',async()=>{
 const events=[];setTelemetrySink(e=>events.push(e));
 const old=process.env.BA_AI_COST_RATES_JSON;
 process.env.BA_AI_COST_RATES_JSON=JSON.stringify({'test-model':{inputPerMillionUsd:1,outputPerMillionUsd:2}});
 try{
  await Promise.all([
   withAIContext({projectId:'project-a',runId:'run-a'},()=>measureAI('elicitation','openai','test-model',async()=>{await sleep(20);noteUsage({inputTokens:100,outputTokens:50})})),
   withAIContext({projectId:'project-b',runId:'run-b'},()=>measureAI('brainstorm','codex','codex-cli',async()=>{await sleep(5)})),
  ]);
  const a=events.find(e=>e.projectId==='project-a'),b=events.find(e=>e.projectId==='project-b');
  assert.equal(a.costUsd,0.0002);assert.equal(a.inputTokens,100);assert.equal(b.costUsd,null);assert.equal(b.inputTokens,null);assert.equal(b.runId,'run-b');
 }finally{if(old===undefined)delete process.env.BA_AI_COST_RATES_JSON;else process.env.BA_AI_COST_RATES_JSON=old;setTelemetrySink(null)}
});
test('Failed provider requests generate ERROR event with unknown usage',async()=>{
 const events=[];setTelemetrySink(e=>events.push(e));
 try{await assert.rejects(()=>withAIContext({projectId:'err-project'},()=>measureAI('analysis','openai','test',async()=>{throw Error('request failed')})),/request failed/);
  assert.equal(events[0].status,'ERROR');assert.equal(events[0].inputTokens,null);assert.equal(events[0].costUsd,null);
 }finally{setTelemetrySink(null)}
});
test('Figma contract probe rejects fabricated identity, unavailable tools and non-frame nodes',()=>{
 const expected={documentKey:'abcdef',nodeId:'1:2',nodeName:'Home'};
 const probe={...expected,documentRead:true,nodeRead:true,nodeType:'FRAME',observedToolNames:['figma.get_document_info','figma.get_node_info']};
 assert.equal(validateLiveProbe(probe,expected).passed,true);
 for(const patch of [{documentRead:false},{nodeId:'1:3'},{nodeType:'COMPONENT'},{observedToolNames:['other_tool']},{nodeName:'Fake'}])assert.throws(()=>validateLiveProbe({...probe,...patch},expected));
});
test('API exposes project quality and no-cost-assumption AI observability',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-v34-api-'));
 const port=48000+Math.floor(Math.random()*10000);
 const child=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:dir,DEMO_MODE:'true',BA_JOB_POLL_MS:'70'},stdio:'ignore'});
 const api=async(route,method='GET',data)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()}};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await api('/api/status')).status===200){ready=true;break}}catch{}await sleep(40)}assert.equal(ready,true);
  const created=await api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});assert.equal(created.status,201);
  const id=created.data.id;
  const quality=await api(`/api/projects/${id}/quality`);assert.equal(quality.status,200);assert.equal(quality.data.decision,'BLOCK');
  assert.equal((await api(`/api/projects/${id}/workflow/jobs`,'POST',{auto:true})).status,202);
  let done=false;for(let i=0;i<120;i++){const p=(await api(`/api/projects/${id}`)).data;if(p.workflow.stage==='CLARIFICATION'){done=true;break}await sleep(40)}assert.equal(done,true);
  const m=(await api(`/api/projects/${id}/quality/ai`)).data;
  assert.equal(m.calls,2);assert.equal(m.unknownCostCalls,2);assert.equal(m.inputTokens,null);
  const quality2=(await api(`/api/projects/${id}/quality`)).data;assert.equal(quality2.decision,'REVIEW');assert.equal(quality2.score,1);assert.ok(quality2.findings.some(x=>x.code==='HIGH_CLARIFICATIONS_PENDING'));
  const global=(await api('/api/metrics')).data;assert.equal(global.ai.calls,2);
 }finally{child.kill('SIGKILL');await new Promise(r=>child.once('close',r));await rm(dir,{recursive:true,force:true})}
});
test('Opt-in quality enforcement stops workflow at explicit measurable gate',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-v34-gate-'));
 const port=51000+Math.floor(Math.random()*12000);
 const store=new ProductionStore(dir),p=fixture();p.analysis.functionalRequirements[0].sourceEvidence='fabricated';store.save(p);store.db.close();
 const child=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:dir,DEMO_MODE:'true',BA_WORKER_ENABLED:'false',BA_QUALITY_ENFORCE:'true'},stdio:'ignore'});
 const api=async(route,method='GET',data)=>{const r=await fetch(`http://127.0.0.1:${port}${route}`,{method,headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()}};
 try{let ready=false;for(let i=0;i<100;i++){try{if((await api('/api/status')).status===200){ready=true;break}}catch{}await sleep(40)}assert.equal(ready,true);
  const r=await api(`/api/projects/${p.id}/workflow/advance`,'POST',{auto:true});assert.equal(r.status,200);assert.equal(r.data.workflow.state,'WAITING_QUALITY_REVIEW');
  assert.equal(r.data.workflow.stage,'DELIVERABLES');assert.equal(r.data.workflow.qualityGate.decision,'BLOCK');
  assert.equal(r.data.prototype??null,null);assert.equal((await api(`/api/projects/${p.id}/quality`)).data.enforceable,true);
 }finally{child.kill('SIGKILL');await new Promise(r=>child.once('close',r));await rm(dir,{recursive:true,force:true})}
});

test('Quality snapshot history deduplicates matching input digests and is transactionally rollback-safe',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-v34-trend-'));
 try{
  const store=new ProductionStore(dir),p=fixture();
  const first=assessDeliverables(p);store.save(p,{qualityReport:first});
  assert.equal(store.qualityHistory(p.id).length,1);
  const next=store.get(p.id);next.version++;next.updatedAt=new Date().toISOString();store.save(next,{qualityReport:assessDeliverables(next)});
  assert.equal(store.qualityHistory(p.id).length,1,'same input digest must not inflate series');
  const stale=store.get(p.id),current=store.get(p.id);
  current.analysis.functionalRequirements[0].acceptanceCriteria=[];current.version++;current.updatedAt=new Date().toISOString();store.save(current,{qualityReport:assessDeliverables(current)});
  assert.equal(store.qualityHistory(p.id).length,2);assert.ok(store.qualityHistory(p.id)[0].score<store.qualityHistory(p.id)[1].score);
  stale.version++;stale.analysis.functionalRequirements[1].actor='';
  assert.throws(()=>store.save(stale,{qualityReport:assessDeliverables(stale)}),/Concurrent project update/);
  assert.equal(store.qualityHistory(p.id).length,2);assert.equal(store.verifyAudit(p.id).valid,true);store.db.close();
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('Unwaived High clarifications or missing BA review cannot PASS the quality gate',()=>{
 const p=fixture();p.workflow.waiver=null;
 let q=assessDeliverables(p);assert.equal(q.score,1);assert.equal(q.decision,'REVIEW');assert.ok(q.findings.some(f=>f.code==='HIGH_CLARIFICATIONS_PENDING'));
 p.review=null;q=assessDeliverables(p);assert.equal(q.decision,'REVIEW');assert.ok(q.findings.some(f=>f.code==='BA_REVIEW_REQUIRED'));
});
test('NFR/business rule confirmed quotations are gated against the customer source',()=>{
 const p=fixture();p.analysis.businessRules[0].sourceEvidence='Unverified business rule invented by provider';
 let q=assessDeliverables(p);assert.equal(q.decision,'BLOCK');
 p.analysis.businessRules[0].sourceEvidence='Hệ thống phải phân quyền theo vai trò khách hàng, nhân viên trạm và quản trị viên.';
 p.analysis.nonFunctionalRequirements.push({id:'NFR-001',certainty:'confirmed',measurableTarget:'1s',category:'Speed',description:'Performance',sourceEvidence:'Fake NFR'});
 q=assessDeliverables(p);assert.equal(q.decision,'BLOCK');assert.ok(q.findings.some(f=>f.requirementId==='NFR-001'));
});
