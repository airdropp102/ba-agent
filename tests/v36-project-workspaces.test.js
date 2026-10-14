import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProductionStore} from '../src/production-store.js';
import {ProjectWorkspaces,projectDirectory} from '../src/project-workspaces.js';
import {SessionContinuity} from '../src/session-continuity.js';
import {sampleBrief} from '../src/demo.js';

const project=(title)=>({id:randomUUID(),title,brief:sampleBrief,version:1,status:'NEW',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),analysis:null,review:null,prototype:null});
async function setup(fn){
 const root=await mkdtemp(join(tmpdir(),'ba-v36-')),dataDir=join(root,'data');await mkdir(dataDir);
 const store=new ProductionStore(dataDir),workspaces=new ProjectWorkspaces(store),sessions=new SessionContinuity(store.db,{root,dataDir});
 try{await fn({root,dataDir,store,workspaces,sessions})}finally{store.db.close();await rm(root,{recursive:true,force:true})}
}
const r=(dir,id,relative)=>join(projectDirectory(dir,id),...relative.split('/'));

test('v3.6: creates distinct project trees containing scoped brief, status and archive',()=>setup(async({dataDir,store,workspaces})=>{
 const a=project('Acme'),b=project('Beta');store.save(a);store.save(b);
 await workspaces.exportProject(a);await workspaces.exportProject(b);
 assert.match(await readFile(r(dataDir,a.id,'01-customer-input/CUSTOMER_BRIEF.md'),'utf8'),/Acme/);
 assert.doesNotMatch(await readFile(r(dataDir,b.id,'01-customer-input/CUSTOMER_BRIEF.md'),'utf8'),/Acme/);
 assert.equal(JSON.parse(await readFile(r(dataDir,a.id,'05-workflow/PROJECT_STATE.json'))).projectId,a.id);
 assert.ok((await stat(r(dataDir,b.id,'09-archive/v000001/state.json'))).isFile());
}));

test('v3.6: document ID is bound to project, content hashed and immutable',()=>setup(async({store,workspaces})=>{
 const a=project('Company A'),b=project('Company B');store.save(a);store.save(b);
 const evidence=await workspaces.addDocument(a.id,{category:'customer',filename:'interview.txt',content:'Customer wants export.'});
 assert.equal(workspaces.list(a.id).length,1);assert.equal(workspaces.list(b.id).length,0);
 assert.equal((await workspaces.readDocument(a.id,evidence.id)).content,'Customer wants export.');
 await assert.rejects(()=>workspaces.readDocument(b.id,evidence.id),/not found/);
 await assert.rejects(()=>workspaces.addDocument(a.id,{category:'customer',filename:'../secret.txt',content:'x'}),/Unsafe filename/);
 await assert.rejects(()=>workspaces.addDocument(a.id,{category:'customer',filename:'.env',content:'x'}),/Unsafe filename/);
 assert.equal(store.verifyAudit(a.id).valid,true);
}));

test('v3.6: drift of evidence file is detected, never silently trusted',()=>setup(async({dataDir,store,workspaces})=>{
 const a=project('A');store.save(a);const evidence=await workspaces.addDocument(a.id,{category:'customer',filename:'meeting.md',content:'Minutes v1'});
 const list=store.db.prepare('SELECT relative_path FROM project_documents WHERE id=?').get(evidence.id);
 await writeFile(r(dataDir,a.id,list.relative_path),'tampered');
 await assert.rejects(()=>workspaces.readDocument(a.id,evidence.id),/checksum mismatch/);
}));

test('v3.6: BA session handoff and evidence are confined to project workspace',()=>setup(async({root,dataDir,store,workspaces,sessions})=>{
 const a=project('A'),b=project('B');store.save(a);store.save(b);await workspaces.exportProject(a);await workspaces.exportProject(b);
 const task=sessions.createTask({title:'Evaluate A',scope:'ba-workflow',projectId:a.id,runtime:'codex'});
 const cp=await sessions.checkpoint({taskId:task.task.id,sessionId:task.session.id,expectedVersion:1,summary:'Customer interview reviewed',completed:[{id:'INTAKE',title:'Gathered brief',artifacts:['01-customer-input/CUSTOMER_BRIEF.md']}],next:['Create PRD']});
 assert.equal(cp.task.version,2);const e=await sessions.export(task.task.id);
 assert.ok(e.directory.startsWith(r(dataDir,a.id,'08-sessions/')));
 assert.match(await readFile(join(e.directory,'HANDOFF.md'),'utf8'),/Create PRD/);
 assert.equal((await sessions.bootstrap({projectId:a.id})).recommendation,'RESUME');
 assert.equal((await sessions.bootstrap({projectId:b.id})).recommendation,'NEW_TASK');
 await assert.rejects(()=>sessions.checkpoint({taskId:task.task.id,sessionId:task.session.id,expectedVersion:2,completed:[{id:'LEAK',title:'Foreign evidence',artifacts:['../'+b.id+'/01-customer-input/CUSTOMER_BRIEF.md']}]}),/outside allowed workspace/);
}));

test('v3.6: legacy registry gets safely copied into project without deleting origin',()=>setup(async({dataDir,store,workspaces})=>{
 const a=project('Migrated');store.save(a);
 const old=join(dataDir,'.figma-registry',a.id);await mkdir(old,{recursive:true});await writeFile(join(old,'testfile.json'),'{}');
 await workspaces.migrateLegacy(a.id);
 assert.equal(await readFile(r(dataDir,a.id,'04-figma/registry/testfile.json'),'utf8'),'{}');
 assert.equal(await readFile(join(old,'testfile.json'),'utf8'),'{}');
}));

test('v3.6: symlinked project directories are refused',()=>setup(async({dataDir,store,workspaces})=>{
 const a=project('Unsafe');store.save(a);
 await mkdir(join(dataDir,'projects'),{recursive:true});await symlink(join(dataDir,'escape'),join(dataDir,'projects',a.id));
 await assert.rejects(()=>workspaces.exportProject(a),/physical directory/);
}));

test('v3.6: project tasks reject unknown project and BA task without project',()=>setup(async({sessions})=>{
 assert.throws(()=>sessions.createTask({title:'Not bound',scope:'ba-workflow'}),/requires --project/);
 assert.throws(()=>sessions.createTask({title:'Unknown',projectId:randomUUID()}),/Project must exist/);
}));

import {spawn} from 'node:child_process';
import {sampleTitle} from '../src/demo.js';
const sleep=t=>new Promise(ok=>setTimeout(ok,t));
test('v3.6 HTTP: project-scoped files, generated PRD and invalidated current prototype', {timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ba-v36-http-')),port=38000+Math.floor(Math.random()*15000),origin=`http://127.0.0.1:${port}`;
 const proc=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:dir,DEMO_MODE:'true',HOST:'127.0.0.1',BA_WORKER_ENABLED:'false'},stdio:'ignore'});
 async function api(route,method='GET',body){const res=await fetch(origin+route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()}}
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await api('/api/status')).status===200){ready=true;break}}catch{}await sleep(75)}
  assert.equal(ready,true);
  const a=(await api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief}));
  const b=(await api('/api/projects','POST',{title:'B separate project',brief:'Customer needs a new privacy-first account application.'}));
  assert.equal(a.status,201);assert.equal(b.status,201);
  const one=a.data.id,two=b.data.id;
  const metadata=await api(`/api/projects/${one}/workspace`);assert.equal(metadata.status,200);assert.equal(metadata.data.projectId,one);
  const upload=await api(`/api/projects/${one}/files`,'POST',{category:'customer',filename:'meeting.txt',content:'Signed customer interview notes 2026-10-13'});
  assert.equal(upload.status,201);
  assert.equal((await api(`/api/projects/${two}/files`)).data.length,0);
  assert.equal((await api(`/api/projects/${two}/files/${upload.data.id}`)).status,404);
  assert.equal((await api(`/api/projects/${one}/files/${upload.data.id}`)).data.content,'Signed customer interview notes 2026-10-13');
  const analyzed=await api(`/api/projects/${one}/analyze`,'POST',{});assert.equal(analyzed.status,200);
  assert.match(await readFile(r(dir,one,'02-requirements/PRD.md'),'utf8'),/Product Requirements Document/);
  assert.equal((await fetch(origin+`/api/projects/${one}/export/prd.md`)).status,409); // BA review gate intact
  const review=await api(`/api/projects/${one}/review`,'POST',{approved:true,notes:'Approved BA draft only'});assert.equal(review.status,200);
  assert.equal((await fetch(origin+`/api/projects/${one}/export/prd.md`)).status,200); // text route
  const gen=await api(`/api/projects/${one}/generate`,'POST',{});assert.equal(gen.status,200);
  assert.ok((await stat(r(dir,one,'03-prototypes/prototype.html'))).isFile());
  assert.ok((await stat(r(dir,one,'06-reviews/BA_REVIEW.json'))).isFile());
  const note=await api(`/api/projects/${one}/clarify`,'POST',{clarifications:'BA note: ask customer to confirm extended return policy.'});assert.equal(note.status,200);
  await assert.rejects(()=>stat(r(dir,one,'03-prototypes/prototype.html')),/ENOENT/);
  await assert.rejects(()=>stat(r(dir,one,'06-reviews/BA_REVIEW.json')),/ENOENT/);
  assert.equal(JSON.parse(await readFile(r(dir,one,'05-workflow/PROJECT_STATE.json'))).version,note.data.version);
  assert.match(await readFile(r(dir,one,`09-archive/v${String(gen.data.version).padStart(6,'0')}/SRS.md`),'utf8'),/SRS/);
 }finally{proc.kill('SIGTERM');await rm(dir,{recursive:true,force:true})}
});

test('binary PDF attachments retain bytes and reject cross-project access, malformed base64 and oversized data',()=>setup(async({dataDir,store,workspaces})=>{
 const a=project('Attachment A'),b=project('Attachment B');store.save(a);store.save(b);
 const content=Buffer.from('%PDF-1.7\nattachment\n');
 const doc=await workspaces.addDocument(a.id,{category:'approval',filename:'Biên bản BA.pdf',encoding:'base64',content:content.toString('base64')});
 const read=await workspaces.readDocument(a.id,doc.id);assert.equal(read.encoding,'base64');assert.deepEqual(Buffer.from(read.content,'base64'),content);
 await assert.rejects(()=>workspaces.readDocument(b.id,doc.id),/not found/);
 await assert.rejects(()=>workspaces.addDocument(a.id,{category:'approval',filename:'bad.pdf',encoding:'base64',content:'!!!!'}),/base64/i);
 await assert.rejects(()=>workspaces.addDocument(a.id,{category:'approval',filename:'big.pdf',encoding:'base64',content:Buffer.alloc(5*1024*1024+1).toString('base64')}),/5 MB/i);
 const row=store.db.prepare('SELECT relative_path FROM project_documents WHERE id=?').get(doc.id);await writeFile(r(dataDir,a.id,row.relative_path),'tampered');await assert.rejects(()=>workspaces.readDocument(a.id,doc.id),/checksum/);
}));

test('base64 text attachments support 5 MB policy while legacy plain text stays limited to 300 KB',()=>setup(async({store,workspaces})=>{
 const a=project('Text attachments');store.save(a);const text='a'.repeat(400000);
 const doc=await workspaces.addDocument(a.id,{category:'approval',filename:'large.txt',encoding:'base64',content:Buffer.from(text).toString('base64')});
 assert.equal((await workspaces.readDocument(a.id,doc.id)).content,text);
 await assert.rejects(()=>workspaces.addDocument(a.id,{category:'approval',filename:'legacy.txt',content:text}),/300KB/i);
}));
