import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {docx,pdf,upload} from './helpers/requirement-fixtures.js';

test('Word/PDF preview and project creation preserve evidence without AI calls', {timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ba-intake-')),port=39000+Math.floor(Math.random()*14000),origin=`http://127.0.0.1:${port}`;
 const proc=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,DEMO_MODE:'true',HOST:'127.0.0.1',BA_WORKER_ENABLED:'false'},stdio:'ignore'});
 async function api(route,method='GET',body){const res=await fetch(origin+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()}}
 try{
  let ready=false;for(let n=0;n<100;n++){try{if((await api('/api/status')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready);
  const file=upload('Yêu cầu (1) [final] & Quy trình.docx',docx());
  const preview=await api('/api/requirements/preview','POST',file);assert.equal(preview.status,200);assert.match(preview.data.text,/Khách hàng cần/);
  assert.equal((await api('/api/projects')).data.length,0);
  const bad=await api('/api/projects','POST',{title:'Invalid upload',requirementFile:file,previewTextSha256:'wrong'});assert.equal(bad.status,409);
  assert.equal((await api('/api/projects')).data.length,0);
  const created=await api('/api/projects','POST',{title:'Warranty portal',requirementFile:file,previewTextSha256:preview.data.textSha256});assert.equal(created.status,201);
  const p=created.data;assert.match(p.brief,/Khách hàng cần/);assert.equal(p.analysis,null);assert.equal(p.sources.length,1);
  assert.equal(p.sources[0].type,'customer-brief');assert.equal(p.sources[0].sha256,preview.data.sha256);assert.equal(p.sources[0].text,preview.data.text);
  const docs=(await api(`/api/projects/${p.id}/files`)).data;assert.equal(docs.length,1);assert.equal(docs[0].id,p.sources[0].documentId);
  const original=(await api(`/api/projects/${p.id}/files/${docs[0].id}`)).data;assert.equal(original.content,file.content);
  const typed=await api('/api/projects','POST',{title:'Legacy typed creation',brief:'Customer needs customer service request tracking.'});assert.equal(typed.status,201);
  assert.equal((await api(`/api/projects/${typed.data.id}/files/${docs[0].id}`)).status,404);
  const mixed=await api('/api/projects','POST',{title:'Mixed intake',brief:'Customer needs a mobile portal.',requirementFile:file,previewTextSha256:preview.data.textSha256});assert.equal(mixed.status,201);assert.deepEqual(mixed.data.sources.map(s=>s.id),['SRC-001','SRC-002']);
  assert.equal(mixed.data.sources[0].text,'Customer needs a mobile portal.');assert.equal(mixed.data.sources[1].text,preview.data.text);
  const scan=await api('/api/requirements/preview','POST',upload('scan.pdf',pdf('')));assert.equal(scan.status,422);assert.match(scan.data.error,/OCR/);
  assert.equal((await api('/api/projects','POST',{title:'Overflow notes',brief:'x'.repeat(100000),requirementFile:file,previewTextSha256:preview.data.textSha256})).status,400);
  assert.equal((await api('/api/projects')).data.length,3);
  const second=upload('Process.pdf',pdf('Customer needs a separate approval step.'));
  const secondPreview=await api('/api/requirements/preview','POST',second);assert.equal(secondPreview.status,200);
  const files=[{...file,previewTextSha256:preview.data.textSha256},{...second,previewTextSha256:secondPreview.data.textSha256}];
  const multiple=await api('/api/projects','POST',{title:'Multi-document intake',brief:'Additional customer context.',requirementFiles:files});assert.equal(multiple.status,201);
  assert.deepEqual(multiple.data.sources.map(s=>s.id),['SRC-001','SRC-002','SRC-003']);
  assert.equal(multiple.data.sources[1].text,preview.data.text);assert.equal(multiple.data.sources[2].text,secondPreview.data.text);
  assert.notEqual(multiple.data.sources[1].documentId,multiple.data.sources[2].documentId);
  const originals=(await api(`/api/projects/${multiple.data.id}/files`)).data;assert.equal(originals.length,2);
  for(let i=0;i<files.length;i++){const source=multiple.data.sources[i+1],doc=(await api(`/api/projects/${multiple.data.id}/files/${source.documentId}`)).data;assert.equal(doc.content,files[i].content);assert.equal(doc.sha256,source.sha256)}
  const invalid=await api('/api/projects','POST',{title:'Bad second file',requirementFiles:[files[0],{...files[1],previewTextSha256:'wrong'}]});assert.equal(invalid.status,409);
  assert.equal((await api('/api/projects','POST',{title:'Too many files',requirementFiles:Array(11).fill(files[0])})).status,400);
  assert.equal((await api('/api/projects','POST',{title:'Empty files',requirementFiles:[]})).status,400);
  assert.equal((await api('/api/projects','POST',{title:'Ambiguous files',requirementFile:file,previewTextSha256:preview.data.textSha256,requirementFiles:files})).status,400);
  const long=upload('Long.docx',docx('x'.repeat(60000))),longPreview=await api('/api/requirements/preview','POST',long);
  const longEntry={...long,previewTextSha256:longPreview.data.textSha256};
  assert.equal((await api('/api/projects','POST',{title:'Combined text overflow',requirementFiles:[longEntry,{...longEntry,filename:'Second.docx'}]})).status,400);
  assert.equal((await api('/api/projects')).data.length,4);
  const metrics=(await api('/api/metrics')).data;assert.equal(metrics.ai.calls,0);
 }finally{proc.kill('SIGTERM');await new Promise(resolve=>proc.exitCode!==null?resolve():proc.once('exit',resolve));await rm(dir,{recursive:true,force:true})}
});
