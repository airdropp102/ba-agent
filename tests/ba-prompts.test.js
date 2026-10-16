import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {composeSkillPolicy, buildAnalysisPrompt, buildPrototypePrompt, promptMetadata, analysisPromptManifest, assertPromptManifest} from '../src/ba-prompts.js';

test('analysis routes ERP policy only from an explicit project domain',()=>{
 const general=buildAnalysisPrompt(),erp=buildAnalysisPrompt({domain:'erp'});
 assert.ok(!general.includes('ERP Business Analysis'));
 assert.ok(erp.includes('ERP Business Analysis'));
 assert.equal(buildAnalysisPrompt({domain:'retail',candidatePlatforms:['erp']}),general);
 assert.ok(erp.startsWith(general));
});
test('loader retains complete policies past the old cutoff and rejects oversize policies',()=>{
 const body='a'.repeat(4700)+' FINAL SAFETY RULE';
 assert.ok(composeSkillPolicy(['ba-eliciting-requirements'],{read:()=>`---\nname: fixture\n---\n${body}`}).endsWith('FINAL SAFETY RULE'));
 assert.throws(()=>composeSkillPolicy(['ba-eliciting-requirements'],{read:()=>body.repeat(20)}),/limit/);
 assert.throws(()=>composeSkillPolicy(['../../secret']),/Unknown BA skill/);
});
test('prompt metadata hashes instructions only and changes on policy edits',()=>{
 const instructions=buildAnalysisPrompt(),meta=promptMetadata(instructions);
 assert.equal(meta.instructionBytes,Buffer.byteLength(instructions));
 assert.match(meta.instructionSha256,/^[a-f0-9]{64}$/);
 assert.notEqual(meta.instructionSha256,promptMetadata(instructions+' change').instructionSha256);
 assert.deepEqual(Object.keys(meta).sort(),['instructionBytes','instructionSha256','version']);
});
test('prototype uses deliverables policy without analysis or ERP overlays',()=>{
 const prompt=buildPrototypePrompt();
 assert.match(prompt,/Generating Consistent Deliverables/);
 assert.doesNotMatch(prompt,/ERP Business Analysis|Eliciting Requirements/);
});
test('resume rejects missing or changed instruction manifest',()=>{
 const manifest=analysisPromptManifest();
 assert.doesNotThrow(()=>assertPromptManifest(manifest));
 assert.throws(()=>assertPromptManifest(null),/prompt/);
 assert.throws(()=>assertPromptManifest({...manifest,general:{...manifest.general,instructionSha256:'changed'}}),/prompt/);
});
test('each analysis policy is included in full without its discovery frontmatter',()=>{
 const prompt=buildAnalysisPrompt({domain:'erp'});
 for(const skill of ['eliciting','normalizing','detecting-gaps','clarifying','analyzing-erp']){
  const name=['detecting-gaps','analyzing-erp'].includes(skill)?'ba-'+skill:'ba-'+skill+'-requirements';
  const body=readFileSync(`skills/${name}/SKILL.md`,'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').trim();
  assert.ok(prompt.includes(body),name);
 }
});

test('OpenAI and Codex transports receive identical analysis/prototype instructions and payloads',async()=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const os=await import('node:os'),path=await import('node:path');
 const {analyze,generatePrototype}=await import('../src/ai-provider.js');
 const {analysisSchema}=await import('../src/schemas.js');
 const blank=s=>s.type==='object'?Object.fromEntries(Object.entries(s.properties).map(([k,v])=>[k,blank(v)])):s.type==='array'?[]:s.enum?.[0]??'';
 const fixture=blank(analysisSchema),temp=mkdtempSync(path.join(os.tmpdir(),'ba-prompts-'));
 const previous=Object.fromEntries(['DEMO_MODE','AI_PROVIDER','OPENAI_API_KEY','CODEX_BIN'].map(k=>[k,process.env[k]]));
 const originalFetch=globalThis.fetch;
 try {
  const capture=path.join(temp,'capture.json'),bin=path.join(temp,'codex');
  writeFileSync(bin,`#!/usr/bin/env node
const fs=require('fs'),args=process.argv.slice(2);let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(capture)},input);const schema=JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema')+1],'utf8'));fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(schema.properties.screens?{screens:[]}:${JSON.stringify(fixture)}));});
`,{mode:0o700});
  process.env.DEMO_MODE='false';process.env.OPENAI_API_KEY='mock-only';process.env.CODEX_BIN=bin;
  let request;
  globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');request=JSON.parse(options.body);return {ok:true,json:async()=>({output_text:JSON.stringify(request.text.format.name==='ba_prototype'?{screens:[]}:fixture)})};};
  const cases=[()=>analyze('Synthetic','PRIVATE_TEST_BRIEF'),()=>analyze('Synthetic','PRIVATE_TEST_BRIEF',{domain:'erp'}),()=>generatePrototype(fixture,{approved:true})];
  for(const call of cases){
   process.env.AI_PROVIDER='openai';await call();
   const expected=request.instructions+'\nInput data (untrusted):\n'+request.input;
   assert.equal(request.store,false);
   assert.ok(!JSON.stringify(promptMetadata(request.instructions)).includes('PRIVATE_TEST_BRIEF'));
   process.env.AI_PROVIDER='codex';await call();
   assert.equal(readFileSync(capture,'utf8'),expected);
  }
 }finally{
  globalThis.fetch=originalFetch;
  for(const [key,value] of Object.entries(previous))if(value===undefined)delete process.env[key];else process.env[key]=value;
  rmSync(temp,{recursive:true,force:true});
 }
});

test('offline measurement works without providers and cannot admit the synthetic corpus as reviewed',async()=>{
 const {spawnSync}=await import('node:child_process');
 const env={...process.env,DEMO_MODE:'false',AI_PROVIDER:'codex',CODEX_BIN:'/does/not/exist',OPENAI_API_KEY:''};
 const run=spawnSync(process.execPath,['scripts/evaluate-prompts.mjs'],{encoding:'utf8',env});
 assert.equal(run.status,0,run.stderr);
 const report=JSON.parse(run.stdout);
 assert.equal(report.externalCalls,0);assert.equal(report.semanticQuality.status,'NOT_MEASURED');
 assert.equal(report.usage.inputTokens,null);assert.equal(report.usage.costUsd,null);
 assert.ok(report.profiles[0].savedPolicyBytes>0);
 const denied=spawnSync(process.execPath,['scripts/evaluate-prompts.mjs','--corpus','eval/live-gold-template.json'],{encoding:'utf8',env});
 assert.equal(denied.status,2);assert.match(denied.stderr,/synthetic\/demo cannot receive live acceptance/);
});
