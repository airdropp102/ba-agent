import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {demoAnalysis,sampleTitle,sampleBrief} from '../src/demo.js';
import {analysisSchema} from '../src/schemas.js';
import {validateModelOutput} from '../src/model-output.js';
import {buildPublishPlan,acceptVerifiedFigmaReport} from '../src/figma-registry.js';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Provider-independent validator rejects malformed output and oversized strings',()=>{
 const raw=demoAnalysis(sampleTitle,sampleBrief);
 assert.equal(validateModelOutput(raw,analysisSchema),raw);
 assert.throws(()=>validateModelOutput({...raw, functionalRequirements:'string'},analysisSchema),/array/);
 assert.throws(()=>validateModelOutput({...raw, injected:'property'},analysisSchema),/unexpected/);
 assert.throws(()=>validateModelOutput({...raw, businessProblem:'x'.repeat(25_001)},analysisSchema),/bounded string/);
 assert.throws(()=>validateModelOutput({...raw, businessGoals:Array(501).fill('ok')},analysisSchema),/excessive array/);
});
test('Figma publish rejects shared node IDs and recycled previous nodes',()=>{
 const manifest={project:{id:'11111111-1111-4111-8111-111111111111',version:3},platform:'web',screens:[
 {id:'SCR-001',requirementIds:[],components:[]},{id:'SCR-002',requirementIds:[],components:[]}
 ]};
 const plan=buildPublishPlan(manifest);
 const report={documentKey:'file_key',screens:[{screenId:'SCR-001',nodeId:'12:1',verified:true},{screenId:'SCR-002',nodeId:'12:1',verified:true}]};
 assert.throws(()=>acceptVerifiedFigmaReport(plan,report,{documentKey:'file_key'}),/Duplicate/i);
 const approved=acceptVerifiedFigmaReport(plan,{...report,screens:[{...report.screens[0]},{...report.screens[1],nodeId:'12:2'}]},{documentKey:'file_key'});
 const next=buildPublishPlan({...manifest,project:{...manifest.project,version:4},screens:[{...manifest.screens[0],title:'Changed'},manifest.screens[1]]},approved.registry);
 assert.throws(()=>acceptVerifiedFigmaReport(next,{documentKey:'file_key',screens:[{screenId:'SCR-001',nodeId:'12:1',verified:true}]},{documentKey:'file_key',registry:approved.registry}),/reused/);
});
test('Single-process project mutations serialize before reading project data',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-hardening-'));
 const port=47000+Math.floor(Math.random()*15000);
 const base=`http://127.0.0.1:${port}`;
 const executable=path.join(tmp,'codex-fake.cjs');
 const fixture=JSON.stringify(demoAnalysis(sampleTitle,sampleBrief));
 await writeFile(executable,`#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);const o=args[args.indexOf('--output-last-message')+1];setTimeout(()=>{fs.writeFileSync(o,${JSON.stringify(fixture)});process.exit(0)},600);\n`,{mode:0o700});
 const proc=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,DEMO_MODE:'false',AI_PROVIDER:'codex',CODEX_BIN:executable,DATA_DIR:tmp,HOST:'127.0.0.1',PORT:String(port),REQUIRE_IF_MATCH:'true'},stdio:'ignore'});
 const api=async(uri,method='GET',body,headers={})=>{
   const r=await fetch(base+uri,{method,headers:{'Content-Type':'application/json',...headers},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()};
 };
 try{
  let ready=false;
  for(let i=0;i<70;i++){try{const r=await api('/api/status');if(r.status===200){ready=true;break}}catch{}await sleep(50)}
  assert.ok(ready);
  const created=await api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});
  assert.equal(created.status,201);
  const id=created.body.id,route=`/api/projects/${id}/analyze`;
  const first=api(route,'POST',undefined,{'If-Match':'1'});
  await sleep(160);
  const second=await api(route,'POST',undefined,{'If-Match':'1'});
  assert.equal(second.status,409);
  const firstResult=await first;
  assert.equal(firstResult.status,200);
  assert.equal(firstResult.body.version,2);
  const stale=await api(route,'POST',undefined,{'If-Match':'1'});
  assert.equal(stale.status,409);
  const missing=await api(route,'POST');
  assert.equal(missing.status,428);
  const current=await api(`/api/projects/${id}`);
  assert.equal(current.body.version,2);
 }finally{
   proc.kill('SIGTERM');
   await new Promise(resolve=>{if(proc.exitCode!==null||proc.signalCode)resolve();else proc.once('close',resolve)});
   await rm(tmp,{recursive:true,force:true});
 }
});
test('Demo doctor reports healthy no-key preflight',()=>{
 const run=spawnSync(process.execPath,['scripts/doctor.mjs','--json'],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,DEMO_MODE:'true',HOST:'127.0.0.1',BA_STUDIO_TOKEN:''},timeout:10000});
 assert.equal(run.status,0,run.stderr);
 assert.equal(JSON.parse(run.stdout).status,'PASS');
});
