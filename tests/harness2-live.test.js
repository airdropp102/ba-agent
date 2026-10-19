import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareCorpora,admitCorpus,planCalls} from '../scripts/harness2/live-corpus.mjs';
import {buildCodexArgs,reserveCall,completeCall,readLedger,callCodexJson} from '../scripts/harness2/codex-json.mjs';
import {liveOperation} from '../scripts/harness2/live-runtime.mjs';
import {scriptedProvider} from '../scripts/harness2/ba-runtime.mjs';

test('live corpus: generated smoke and draft cannot pass real admission; split groups are isolated',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'h2-live-corpus-'));
 try{
  const paths=await prepareCorpora(join(tmp,'corpora'));
  const smoke=JSON.parse(await readFile(paths.smoke,'utf8'));
  const draft=JSON.parse(await readFile(paths.reviewedTemplate,'utf8'));
  assert.equal(draft.cases.length,20);
  assert.equal(draft.provenance.dataUseApproved,false);
  assert.throws(()=>admitCorpus(smoke,{kind:'reviewed'}));
  assert.throws(()=>admitCorpus(draft,{kind:'reviewed'}));
  const admitted=admitCorpus(smoke,{kind:'synthetic-smoke'});
  assert.equal(admitted.tasks.length,2);
  assert.ok(admitted.tasks.every(x=>!Object.hasOwn(x,'expectedFunctional')));
  assert.equal(planCalls(admitted.tasks).plannedCalls,23);
  smoke.cases[1].groupId=smoke.cases[0].groupId;
  assert.throws(()=>admitCorpus(smoke,{kind:'synthetic-smoke'}),/group/);
  await assert.rejects(prepareCorpora(join(tmp,'corpora')),/exist/i);
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('Codex transport: explicit model, ephemeral isolation and disabled execution tools',()=>{
 const args=buildCodexArgs({model:'gpt-6-sol',schemaFile:'/tmp/schema.json',outputFile:'/tmp/output.json'});
 for(const flag of ['--ephemeral','--ignore-user-config','--ignore-rules','--output-schema'])assert.ok(args.includes(flag));
 assert.ok(args.includes('features.shell_tool=false'));
 assert.ok(args.includes('features.apps=false'));
 assert.ok(args.includes('web_search="disabled"'));
 assert.ok(args.includes('read-only'));
 assert.ok(args.includes('gpt-6-sol'));
 assert.ok(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('invocation ledger: concurrent reservations respect a durable cap; failures stop later calls',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'h2-live-budget-'));
 try{
  const outcomes=await Promise.allSettled(Array.from({length:6},(_,i)=>reserveCall(tmp,{maxCalls:3,role:'solver',requestId:`r${i}`,model:'gpt-6-sol'})));
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,3);
  const ledger=await readLedger(tmp);
  assert.equal(ledger.calls.length,3);
  assert.ok(ledger.calls.every(x=>x.status==='IN_FLIGHT'));
  await completeCall(tmp,ledger.calls[0].id,{status:'FAILED',inputTokens:null,outputTokens:null});
  await assert.rejects(reserveCall(tmp,{maxCalls:10,role:'solver',requestId:'retry',model:'gpt-6-sol'}),/cap|budget|stopped/i);
  const saved=JSON.stringify(await readLedger(tmp));
  assert.ok(!saved.includes('prompt'));
  assert.ok(!saved.includes('customer'));
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('live solver applies guidance to the actual invocation, strips gold, validates and exports DRAFT',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'h2-live-solver-'));
 try{
  const task={id:'LIVE-TEST',title:'Synthetic test',brief:'Nhân viên gửi phiếu bảo trì thiết bị.',sourceId:'SRC-421',respondent:'synthetic-author',sourceReference:'fixture:test',expectedFunctional:['GOLD_DO_NOT_SEND']};
  const configFile=join(tmp,'config.json');await writeFile(configFile,JSON.stringify({schemaVersion:'ba.harness2.live-config.v1',consent:true,kind:'synthetic-smoke',tasks:[task],model:'gpt-6-sol'}));
  let called=false;
  const result=await liveOperation({operation:'solve',task:task.id,guidanceIds:['source-check'],configFile,requestId:'test'},{invoke:async input=>{
   called=true;assert.ok(!input.prompt.includes('GOLD_DO_NOT_SEND'));assert.ok(input.prompt.includes('Kiểm tra từng sourceEvidence'));
   return {value:scriptedProvider({task,instructions:input.prompt}),metadata:{inputTokens:12,outputTokens:5,costUsd:null}};
  }});
  assert.equal(called,true);assert.equal(result.canonical.requirements.functional[0].sourceId,'SRC-421');
  assert.equal(result.canonical.review.customerApproved,false);assert.equal(result.canonical.review.baReviewed,false);
  await assert.rejects(liveOperation({operation:'solve',task:task.id,guidanceIds:[],configFile},{invoke:async()=>({value:{},metadata:{}})}),/AI schema/);
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('Codex JSON subprocess validates output and captures usage without inheriting secret env or retaining prompts',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'h2-live-transport-'));
 try{
  const bin=join(tmp,'fake-codex');const authFile=join(tmp,'fake-auth.json');await writeFile(authFile,'{"fixture":true}');
  await writeFile(bin,'#!/usr/bin/env node\nconst fs=require("fs");const a=process.argv;process.stdin.resume();process.stdin.on("end",()=>{if(process.env.OPENAI_API_KEY)process.exit(3);fs.writeFileSync(a[a.indexOf("--output-last-message")+1],JSON.stringify({ok:true}));console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:10,output_tokens:3}}));});\n');await chmod(bin,0o700);
  const schema={type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false};
  const result=await callCodexJson({prompt:'PRIVATE_FIXTURE_PROMPT',schema,model:'gpt-6-sol',bin,authFile,ledgerRoot:join(tmp,'run'),maxCalls:1,role:'solver',requestId:'fake-1'});
  assert.equal(result.value.ok,true);assert.equal(result.metadata.inputTokens,10);assert.equal(result.metadata.outputTokens,3);
  const ledger=await readLedger(join(tmp,'run'));assert.equal(ledger.calls[0].costUsd,null);
  assert.ok(!JSON.stringify(ledger).includes('PRIVATE_FIXTURE_PROMPT'));
  await assert.rejects(callCodexJson({prompt:'x',schema,model:'gpt-6-sol',bin,authFile,ledgerRoot:join(tmp,'run'),maxCalls:1,role:'solver',requestId:'fake-2'}),/cap|budget/i);
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('invalid semantic operation output stops the invocation ledger before core retries',async()=>{
 const tmp=await mkdtemp(join(tmpdir(),'h2-live-invalid-'));
 try{
  const bin=join(tmp,'fake-codex'),authFile=join(tmp,'auth.json'),ledgerRoot=join(tmp,'run');await writeFile(authFile,'{}');
  await writeFile(bin,'#!/usr/bin/env node\nconst fs=require("fs");process.stdin.resume();process.stdin.on("end",()=>{const a=process.argv;fs.writeFileSync(a[a.indexOf("--output-last-message")+1],"{\\"ok\\":true}");});\n');await chmod(bin,0o700);
  const options={prompt:'fixture',schema:{type:'object',properties:{ok:{type:'boolean'}},required:['ok'],additionalProperties:false},model:'gpt-6-sol',bin,authFile,ledgerRoot,maxCalls:2,role:'edit',requestId:'bad-guidance',validate:()=>{throw new Error('duplicate guidance IDs');}};
  await assert.rejects(callCodexJson(options),/stopped/i);
  const ledger=await readLedger(ledgerRoot);assert.equal(ledger.stopped,true);assert.equal(ledger.calls[0].status,'FAILED');
  await assert.rejects(reserveCall(ledgerRoot,{maxCalls:2,role:'edit',requestId:'retry',model:'gpt-6-sol'}),/stopped/i);
 }finally{await rm(tmp,{recursive:true,force:true});}
});
