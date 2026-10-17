import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProductionStore} from '../src/production-store.js';
import {demoAnalysis,sampleTitle,sampleBrief} from '../src/demo.js';
import {normalizeAnalysis} from '../src/normalize.js';
import {prepareBAAnalysis} from '../src/ba-quality.js';
import {buildSources} from '../src/revisions.js';
import {ensureWorkflow} from '../src/intelligent-workflow.js';
import {recommendationSchema,createRecommendations} from '../src/clarification-recommendations.js';
import {validateModelOutput} from '../src/model-output.js';

const option={title:'Verify candidate',answer:'DRAFT: verify with stakeholders',benefits:'Clarify feasibility',tradeoffs:'Requires verification',implementation:'Check version and edition',stackReferences:['Odoo Community'],feasibility:'unknown'};

test('recommendation schema constrains exact project references without weakening persistence guards',()=>{
 const p={solutionProfile:{domain:'erp',candidates:['odoo-community']},analysis:{clarificationQuestions:[{id:'Q-001',question:'Verify HR process'}]}};
 const raw={questions:[{questionId:'Q-001',preferredIndex:-1,options:[structuredClone(option)]}]};
 const schema=recommendationSchema(p);
 validateModelOutput(raw,schema);
 for(const refs of [[],['odoo-community'],['Odoo Enterprise'],['PostgreSQL']]){
  raw.questions[0].options[0].stackReferences=refs;
  assert.throws(()=>validateModelOutput(raw,schema),/AI schema/);
  assert.throws(()=>createRecommendations(p,raw.questions),/unknown project technology/);
 }
 raw.questions[0].options[0].stackReferences=[];
 validateModelOutput(raw,recommendationSchema({...p,recommendationMode:'business'}));
 raw.questions[0].options[0].stackReferences=['Odoo Community'];
 assert.throws(()=>validateModelOutput(raw,recommendationSchema({...p,recommendationMode:'business'})),/array too long/);
 // Building another project's schema cannot modify an earlier schema or shared string rules.
 assert.deepEqual(schema.properties.questions.items.properties.options.items.properties.stackReferences.items.enum,['Odoo Community']);
 assert.equal(schema.properties.questions.items.properties.options.items.properties.title.enum,undefined);
});

test('GAP_ANALYSIS retry keeps validated refresh and resumes recommendations without repeating elicitation',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ba-gap-recovery-'));let proc;
 try{
  const raw=demoAnalysis(sampleTitle,sampleBrief);
  const analysis=prepareBAAnalysis(normalizeAnalysis(raw,sampleBrief));
  const p={id:randomUUID(),title:sampleTitle,brief:sampleBrief,version:1,status:'ANALYZED',analysis,sources:buildSources(sampleBrief),answers:[{questionId:analysis.clarificationQuestions[0].id,answer:'PRIVATE_SAVED_ANSWER',respondent:'Owner',sourceReference:'Fixture meeting'}],requirementsRefreshPending:true,solutionProfile:{domain:'erp',strategy:'open-source',candidates:['odoo-community'],processAreas:['hire-to-retire']},createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  ensureWorkflow(p);p.workflow.stage='GAP_ANALYSIS';p.workflow.checkpoints=[{stage:'BRAINSTORM'},{stage:'ELICITATION'}];
  const store=new ProductionStore(dir);store.save(p);store.db.close();
  const bin=join(dir,'fake-codex.cjs'),calls=join(dir,'calls.txt'),marker=join(dir,'valid');
  await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs');const args=process.argv.slice(2);const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1]));let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
const analyzing=!!schema.properties.projectName;fs.appendFileSync(${JSON.stringify(calls)},analyzing?'analysis\\n':'recommendations\\n');
let out=${JSON.stringify(raw)};
if(!analyzing){const data=JSON.parse(input.split('Input (untrusted):\\n')[1]);out={questions:data.questions.map(q=>({questionId:q.questionId,preferredIndex:-1,options:[{...${JSON.stringify(option)},stackReferences:[fs.existsSync(${JSON.stringify(marker)})?'Odoo Community':'odoo-community']}]}))};}
fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(out));});`,{mode:0o700});
  const port=40000+Math.floor(Math.random()*10000),origin=`http://127.0.0.1:${port}`;
  proc=spawn(process.execPath,['src/server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',DEMO_MODE:'false',AI_PROVIDER:'codex',CODEX_BIN:bin,BA_WORKER_ENABLED:'false',REQUIRE_IF_MATCH:'true'},stdio:'ignore'});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/status')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,40));}assert.ok(ready);
  const get=async()=>await (await fetch(origin+`/api/projects/${p.id}`)).json();
  const advance=version=>fetch(origin+`/api/projects/${p.id}/workflow/advance`,{method:'POST',headers:{'Content-Type':'application/json','If-Match':String(version)},body:JSON.stringify({auto:true})});
  assert.equal((await advance(1)).status,502);
  const failed=await get();assert.equal(failed.workflow.state,'FAILED');assert.equal(failed.workflow.lastError.code,'INVALID_RECOMMENDATIONS');
  assert.equal(failed.requirementsRefreshPending,false);assert.deepEqual(failed.answers,p.answers);assert.deepEqual(failed.clarificationRecommendations,[]);
  assert.deepEqual(failed.workflow.checkpoints,p.workflow.checkpoints);
  assert.doesNotMatch(failed.workflow.lastError.message,/PRIVATE_SAVED_ANSWER/);
  const refreshed=failed.analysis;
  await writeFile(marker,'true');const retry=await advance(failed.version);assert.equal(retry.status,200,await retry.text());
  const current=await get();assert.deepEqual(current.analysis,refreshed);assert.equal(current.workflow.state,'WAITING_CLARIFICATION');
  assert.equal(current.review,null);assert.equal(current.prototype,null);
  assert.ok(current.clarificationRecommendations.length>0);assert.ok(current.clarificationRecommendations.every(r=>r.status==='PROPOSED'));
  assert.equal(await readFile(calls,'utf8'),'analysis\nrecommendations\nrecommendations\n');
 }finally{
  if(proc){const exited=new Promise(r=>proc.once('exit',r));proc.kill('SIGTERM');if(proc.exitCode===null)await exited;}
  await rm(dir,{recursive:true,force:true});
 }
});
