import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sampleTitle,sampleBrief} from '../src/demo.js';

test('BA draft ranking, optional scoped PDF attachments, and batch save require refresh without customer signoff',{timeout:20000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ba-attachments-')),port=40000+Math.floor(Math.random()*10000),origin=`http://127.0.0.1:${port}`;
 const proc=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,DEMO_MODE:'true',HOST:'127.0.0.1',BA_WORKER_ENABLED:'false',REQUIRE_IF_MATCH:'true',REQUIRE_REVIEWER_IDENTITY:'false'},stdio:'ignore'});
 const api=async(route,method='GET',body,version)=>{const res=await fetch(origin+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(version?{'If-Match':String(version)}:{})},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()};};
 try{
  let ready=false;for(let i=0;i<80;i++){try{if((await api('/api/status')).status===200){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready,'server started');
  let p=(await api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief})).data;
  const path=s=>`/api/projects/${p.id}/${s}`;
  p=(await api(path('analyze'),'POST',{},p.version)).data;
  const ids=p.analysis.clarificationQuestions.slice(0,2).map(q=>q.id);
  const generated=await api(path('recommendations/generate'),'POST',{mode:'business',selectionMode:'ba-draft',questionIds:ids},p.version);assert.equal(generated.status,200);p=generated.data;
  assert.ok(p.clarificationRecommendations.every(r=>r.preferredOptionId));assert.equal(p.clarificationDecisions.length,0);
  const other=(await api('/api/projects','POST',{title:'Other project',brief:sampleBrief})).data;
  const pdf=Buffer.from('%PDF-1.7\nSample BA attachment\n');
  const upload=await api(path('files'),'POST',{category:'approval',filename:'Ghi chú BA.pdf',encoding:'base64',content:pdf.toString('base64')},p.version);assert.equal(upload.status,201);
  assert.equal((await api(`/api/projects/${other.id}/files/${upload.data.id}`)).status,404);
  const otherDoc=(await api(`/api/projects/${other.id}/files`,'POST',{category:'approval',filename:'other.txt',content:'Other project evidence'},other.version)).data;
  const answers=ids.map(questionId=>({kind:'option',questionId,optionId:p.clarificationRecommendations.find(r=>r.questionId===questionId).preferredOptionId,approverRole:'ba',decisionContext:'ba-ui'}));
  const invalid=await api(path('answers/batch'),'POST',{answers:[{...answers[0],attachmentIds:[otherDoc.id]}]},p.version);assert.equal(invalid.status,404);assert.equal((await api(`/api/projects/${p.id}`)).data.version,p.version);
  answers[0].attachmentIds=[upload.data.id];
  const saved=await api(path('answers/batch'),'POST',{answers},p.version);assert.equal(saved.status,200);p=saved.data;
  assert.equal(p.requirementsRefreshPending,true);assert.equal(p.review,null);assert.equal(p.clarificationDecisions.length,2);
  assert.ok(p.clarificationDecisions.every(d=>d.approverRole==='ba'&&!d.customerApproved&&!d.customerBaselineApproved));
  assert.equal(p.answers[0].attachments[0].filename,'Ghi chú BA.pdf');assert.equal(p.answers[0].attachmentIds[0],upload.data.id);
  const read=(await api(path(`files/${upload.data.id}`))).data;assert.deepEqual(Buffer.from(read.content,'base64'),pdf);
  assert.equal((await api(path('review'),'POST',{approved:true,notes:'Pending refresh'},p.version)).status,409);
 }finally{proc.kill('SIGTERM');await new Promise(r=>proc.exitCode!==null?r():proc.once('exit',r));await rm(dir,{recursive:true,force:true});}
});
