import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {sampleTitle,sampleBrief} from '../src/demo.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const launch=async (env)=>{const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-v3-api-'));const port=25000+Math.floor(Math.random()*15000);const base=`http://127.0.0.1:${port}`;const proc=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DEMO_MODE:'true',DATA_DIR:tmp,...env},stdio:'ignore'});return {tmp,port,base,proc,close:async()=>{proc.kill('SIGTERM');await rm(tmp,{recursive:true,force:true})}};};
const wait=async ctx=>{for(let i=0;i<45;i++){try{const r=await fetch(ctx.base+'/api/status');if(r.ok)return true;}catch{}await sleep(100)}return false};
test('versioned source provenance and stable requirement IDs after clarification',async()=>{
 const s=await launch({});try{
 assert.ok(await wait(s));
 const req=async(route,method='GET',payload)=>{const r=await fetch(s.base+route,{method,headers:{'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});return {status:r.status,body:await r.json()}};
 let r=await req('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});const id=r.body.id;
 r=await req(`/api/projects/${id}/analyze`,'POST');assert.equal(r.status,200);const before=r.body.analysis.functionalRequirements.map(x=>({id:x.id,name:x.name}));
 r=await req(`/api/projects/${id}/clarify`,'POST',{clarifications:'BA đề xuất thêm câu hỏi về hạn tiếp nhận bảo hành.'});assert.equal(r.status,200);
 assert.deepEqual(r.body.analysis.functionalRequirements.map(x=>({id:x.id,name:x.name})),before);
 assert.equal(r.body.sources[1].type,'ba-note');assert.equal(r.body.review,null);
 const v=await req(`/api/projects/${id}/history`);assert.equal(v.status,200);assert.ok(v.body.some(x=>x.version===2));
 const snapshot=await req(`/api/projects/${id}/history/2`);assert.equal(snapshot.status,200);assert.equal(snapshot.body.status,'ANALYZED');
 const canon=await req(`/api/projects/${id}/export/canonical.json`);assert.equal(canon.body.sources.length,2);assert.equal(canon.body.sources[1].type,'ba-note');
 assert.equal(canon.body.traceability[0].sourceId,'SRC-001');
 const firstQuestion=r.body.analysis.clarificationQuestions[0];
 if(firstQuestion){
   const answered=await req(`/api/projects/${id}/answers`,'POST',{questionId:firstQuestion.id,answer:'Quy tắc tạm thời cần theo phiếu được gửi qua email.',respondent:'Đại diện nghiệp vụ',sourceReference:'Email 13/10/2026'});
   assert.equal(answered.status,200);
   assert.equal(answered.body.sources.at(-1).type,'customer-response');
   assert.equal(answered.body.answers.at(-1).questionId,firstQuestion.id);
   const qs=await fetch(s.base+`/api/projects/${id}/export/questions.md`);
   assert.match(await qs.text(),/13\/10\/2026/);
 }
 }finally{await s.close()}
});
test('remote bind fails closed without secret; when enabled, remote API requires bearer token',async()=>{
 const s=await launch({HOST:'0.0.0.0',BA_STUDIO_TOKEN:''});try{await sleep(220);assert.ok(s.proc.exitCode!==null||!await wait(s),'remote binding must not start without secret');}finally{await s.close()}
 const ctx=await launch({HOST:'0.0.0.0',BA_STUDIO_TOKEN:'testing-only-long-secret-with-32-characters'});try{
 assert.ok(await wait({...ctx,base:`http://127.0.0.1:${ctx.port}`})===false,'status should require token');
 const denied=await fetch(ctx.base+'/api/projects');assert.equal(denied.status,401);
 const ok=await fetch(ctx.base+'/api/status',{headers:{Authorization:'Bearer testing-only-long-secret-with-32-characters'}});assert.equal(ok.status,200);
 }finally{await ctx.close()}
});

test('Codex CLI provider operates in web API without OPENAI_API_KEY when local CLI is logged in',async()=>{
 const {writeFile}=await import('node:fs/promises');
 const {demoAnalysis}=await import('../src/demo.js');
 const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-fake-cli-'));
 try{
  const script=path.join(tmp,'codex');
  const sample=JSON.stringify(demoAnalysis(sampleTitle,sampleBrief));
  await writeFile(script,`#!/usr/bin/env node
const fs=require('node:fs');const args=process.argv.slice(2);
const output=args[args.indexOf('--output-last-message')+1];
fs.writeFileSync(output, ${JSON.stringify(sample)});
`,{mode:0o700});
  const s=await launch({DEMO_MODE:'false',AI_PROVIDER:'codex',OPENAI_API_KEY:'',CODEX_BIN:script});
  try{
    assert.ok(await wait(s));
    const status=await(await fetch(s.base+'/api/status')).json();assert.equal(status.provider,'codex');
    let res=await fetch(s.base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:sampleTitle,brief:sampleBrief})});const p=await res.json();
    res=await fetch(s.base+`/api/projects/${p.id}/analyze`,{method:'POST',headers:{'Content-Type':'application/json'}});
    assert.equal(res.status,200);const result=await res.json();assert.equal(result.analysis.functionalRequirements.length,3);
  }finally{await s.close()}
 }finally{await rm(tmp,{recursive:true,force:true})}
});
