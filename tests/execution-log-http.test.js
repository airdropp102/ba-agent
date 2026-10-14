import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {randomUUID} from 'node:crypto';
import {ProductionStore} from '../src/production-store.js';import {demoAnalysis,sampleTitle,sampleBrief} from '../src/demo.js';
import {normalizeAnalysis} from '../src/normalize.js';import {prepareBAAnalysis} from '../src/ba-quality.js';import {buildSources} from '../src/revisions.js';

test('re-analysis timeout preserves saved answers, logs scoped metadata, and retains UNKNOWN provider usage',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ba-log-http-')),port=40000+Math.floor(Math.random()*10000),origin=`http://127.0.0.1:${port}`;let proc,logs='';
 try{
  const bin=join(dir,'slow-codex');await writeFile(bin,'#!/usr/bin/env node\nprocess.stdin.resume();process.stderr.write("PRIVATE_PROVIDER_TEXT sk-private-token");process.stdout.write(JSON.stringify({type:"thread.started",private:"PRIVATE_PROVIDER_TEXT"})+"\\n");setInterval(()=>{},10000);\n',{mode:0o700});
  const analysis=prepareBAAnalysis(normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief));
  const p={id:randomUUID(),title:'Private survey title',brief:sampleBrief,version:1,status:'ANALYZED',analysis,sources:buildSources(sampleBrief),answers:[{questionId:analysis.clarificationQuestions[0].id,answer:'PRIVATE_SAVED_CUSTOMER_ANSWER',respondent:'Owner',sourceReference:'Survey fixture'}],review:null,requirementsRefreshPending:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
  const seed=new ProductionStore(dir);seed.save(p);seed.db.close();
  proc=spawn(process.execPath,['src/server.js'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),HOST:'127.0.0.1',DEMO_MODE:'false',AI_PROVIDER:'codex',CODEX_BIN:bin,CODEX_MODEL:'configured-test-model',CODEX_TIMEOUT_MS:'1000',BA_LOG_PROGRESS:'true',BA_WORKER_ENABLED:'false',REQUIRE_IF_MATCH:'true'},stdio:['ignore','pipe','pipe']});
  proc.stdout.on('data',d=>logs+=d);proc.stderr.on('data',d=>logs+=d);
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/status')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready);
  const res=await fetch(origin+`/api/projects/${p.id}/analyze`,{method:'POST',headers:{'Content-Type':'application/json','If-Match':'1'},body:'{}'});assert.equal(res.status,504);assert.match((await res.json()).error,/1 giây/);
  const current=await (await fetch(origin+`/api/projects/${p.id}`)).json();assert.deepEqual(current.answers,p.answers);assert.deepEqual(current.analysis,p.analysis);assert.equal(current.version,1);assert.equal(current.requirementsRefreshPending,true);
  assert.match(logs,/ANALYSIS_INPUT/);assert.match(logs,/CLI_START/);assert.match(logs,/CLI_TIMEOUT/);assert.match(logs,/AI_ERROR/);assert.match(logs,new RegExp(p.id));assert.match(logs,/SRC-001/);assert.match(logs,/answerCount/);assert.doesNotMatch(logs,/PRIVATE_PROVIDER_TEXT|PRIVATE_SAVED_CUSTOMER_ANSWER|Private survey title|sk-private-token/);
  const check=new ProductionStore(dir);try{const row=check.db.prepare('SELECT * FROM ai_invocations').get();assert.equal(row.status,'ERROR');assert.equal(row.input_tokens,null);assert.equal(row.output_tokens,null);assert.equal(row.cost_usd,null);assert.doesNotMatch(JSON.stringify(row),/PRIVATE_/);}finally{check.db.close();}
 }finally{if(proc){const exited=new Promise(r=>proc.once('exit',r));proc.kill('SIGTERM');if(proc.exitCode===null)await exited;}await rm(dir,{recursive:true,force:true});}
});
