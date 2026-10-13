import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {sampleBrief,sampleTitle} from '../src/demo.js';
const sleep=t=>new Promise(r=>setTimeout(r,t));

test('End-to-end: create → analyze → review → generate → export → clarify', {timeout:20000}, async()=>{
  const dataDir=await mkdtemp(path.join(os.tmpdir(),'ba-test-'));
  const port=30000+Math.floor(Math.random()*15000);const base=`http://127.0.0.1:${port}`;
  const proc=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:dataDir,DEMO_MODE:'true',HOST:'127.0.0.1'},stdio:'ignore'});
  try{
    let ready=false;for(let i=0;i<50;i++){try{const r=await fetch(base+'/api/status');if(r.ok){ready=true;break}}catch{}await sleep(100)}assert.ok(ready,'Server started');
    const req=async(route,method='GET',body)=>{const r=await fetch(base+route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json()}};
    let r=await req('/api/projects','POST',{title:sampleTitle,brief:sampleBrief});assert.equal(r.status,201);const id=r.body.id;
    r=await req(`/api/projects/${id}/generate`,'POST',{});assert.equal(r.status,409);
    r=await req(`/api/projects/${id}/analyze`,'POST',{});assert.equal(r.body.status,'ANALYZED');assert.equal(r.body.analysis.functionalRequirements.length,3);
    assert.equal(r.body.analysis.quality.policyVersion,'ba-quality-v1');
    assert.ok(r.body.analysis.quality.findings.some(x=>x.code==='NO_BUSINESS_PROBLEM'));
    const preQuestions=await fetch(base+`/api/projects/${id}/export/questions.md`);
    assert.equal(preQuestions.status,200);assert.match(await preQuestions.text(),/Phiếu câu hỏi làm rõ/);
    const preCanonical=await fetch(base+`/api/projects/${id}/export/canonical.json`);
    assert.equal(preCanonical.status,200);const c=await preCanonical.json();
    assert.equal(c.schemaVersion,'ba.canonical.v1');assert.equal(c.review.baReviewed,false);
    assert.equal((await fetch(base+`/api/projects/${id}/export/brd.md`)).status,409);
    assert.equal((await fetch(base+`/api/projects/${id}/export/figma.md`)).status,409);
    r=await req(`/api/projects/${id}/review`,'POST',{approved:false,notes:'ignore'});assert.equal(r.status,400);
    r=await req(`/api/projects/${id}/review`,'POST',{approved:true,notes:'BA has checked the draft'});assert.equal(r.body.status,'REVIEWED');
    const figmaBefore=await fetch(base+`/api/projects/${id}/export/figma-manifest.json`);
    assert.equal(figmaBefore.status,200);
    const figmaCandidates=await figmaBefore.json();
    assert.equal(figmaCandidates.screens[0].designStatus,'DRAFT-SCREEN-CANDIDATE');
    r=await req(`/api/projects/${id}/generate`,'POST',{});assert.equal(r.body.status,'GENERATED');assert.equal(r.body.prototype.screens.length,3);
    const figmaManifest=await (await fetch(base+`/api/projects/${id}/export/figma-manifest.json`)).json();
    const figmaGuide=await (await fetch(base+`/api/projects/${id}/export/figma.md`)).text();
    assert.equal(figmaManifest.schemaVersion,'ba.figma.v1');
    assert.equal(figmaManifest.screens[0].designStatus,'DRAFT-WIREFRAME');
    assert.match(figmaGuide,/join_channel/);
    const brd=await (await fetch(base+`/api/projects/${id}/export/brd.md`)).text();
    const srs=await (await fetch(base+`/api/projects/${id}/export/srs.md`)).text();
    const html=await (await fetch(base+`/api/projects/${id}/export/prototype.html`)).text();
    assert.match(brd,/BABOK Quality Gate/);assert.match(brd,/BRD/);assert.match(srs,/FR-001/);assert.match(srs,/SCR-001/);assert.match(html,/Đăng ký bảo hành/);
    r=await req(`/api/projects/${id}/clarify`,'POST',{clarifications:'Khách hàng xác nhận cần hỏi thêm về trùng số seri.'});
    assert.equal(r.body.status,'ANALYZED');assert.equal(r.body.review,null);assert.equal(r.body.prototype,null);
  }finally{proc.kill('SIGTERM');await rm(dataDir,{recursive:true,force:true})}
});
