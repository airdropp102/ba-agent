import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {sampleTitle,sampleBrief} from '../src/demo.js';

test('new document exports share review/refresh gates; workspaces and historical snapshots stay scoped', {timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ba-std-docs-')),port=39000+Math.floor(Math.random()*14000),origin=`http://127.0.0.1:${port}`;
 const proc=spawn(process.execPath,['src/server.js'],{env:{...process.env,PORT:String(port),DATA_DIR:dir,DEMO_MODE:'true',HOST:'127.0.0.1',BA_WORKER_ENABLED:'false'},stdio:'ignore'});
 async function api(route,body){const res=await fetch(origin+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:res.status,data:await res.json()}}
 const types=[['urd','URD.md'],['use-cases','USE_CASES.md'],['user-stories','USER_STORIES.md']];
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await api('/api/status')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready);
  for(const kind of ['brd','srs','urd','use-cases','user-stories']){const response=await fetch(origin+`/api/document-templates/${kind}.md`);assert.equal(response.status,200);assert.match(await response.text(),/\{\{document_control\}\}/)}
  assert.equal((await fetch(origin+'/api/document-templates/unknown.md')).status,404);
  let p=(await api('/api/projects',{title:sampleTitle,brief:sampleBrief})).data;
  const other=(await api('/api/projects',{title:'Separate workspace',brief:'Customer needs a separate application.'})).data;
  p=(await api(`/api/projects/${p.id}/analyze`,{})).data;
  for(const [kind,name] of types){assert.equal((await fetch(origin+`/api/projects/${p.id}/export/${kind}.md`)).status,409);const disk=await readFile(join(dir,'projects',p.id,'02-requirements',name),'utf8');assert.match(disk,/DRAFT/);await assert.rejects(()=>access(join(dir,'projects',other.id,'02-requirements',name)))}
  p=(await api(`/api/projects/${p.id}/review`,{approved:true,notes:'BA preparation review only'})).data;
  for(const [kind,name] of types){const response=await fetch(origin+`/api/projects/${p.id}/export/${kind}.md`);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),new RegExp(name));assert.match(await response.text(),/FR-001/)}
  const archived=join(dir,'projects',p.id,'09-archive',`v${String(p.version).padStart(6,'0')}`,'URD.md'),snapshot=await readFile(archived,'utf8');
  const fr=p.analysis.functionalRequirements[0];
  // Mutations go through the public API; pending answers must invalidate document exports.
  const question=p.analysis.clarificationQuestions[0];
  const answer=await api(`/api/projects/${p.id}/answers/batch`,{answers:[{questionId:question.id,kind:'custom',answer:'Customer response needs fresh analysis.',respondent:'Synthetic reviewer',sourceReference:'Synthetic meeting'}]});
  assert.equal(answer.status,200);assert.equal(answer.data.requirementsRefreshPending,true);
  for(const [kind] of types)assert.equal((await fetch(origin+`/api/projects/${p.id}/export/${kind}.md`)).status,409);
  assert.equal(await readFile(archived,'utf8'),snapshot);assert.ok(fr.id);
 }finally{proc.kill('SIGTERM');await new Promise(r=>proc.exitCode!==null?r():proc.once('exit',r));await rm(dir,{recursive:true,force:true})}
});
