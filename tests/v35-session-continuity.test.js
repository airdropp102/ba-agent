import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProductionStore} from '../src/production-store.js';
import {SessionContinuity} from '../src/session-continuity.js';
import {spawnSync} from 'node:child_process';

async function fixture(fn){
 const root=await mkdtemp(join(tmpdir(),'ba-v35-'));const data=join(root,'data');await mkdir(data);
 const store=new ProductionStore(data),svc=new SessionContinuity(store.db,{root});
 try{await writeFile(join(root,'spec.md'),'approved spec');await fn({root,data,store,svc});}
 finally{store.db.close();await rm(root,{recursive:true,force:true})}
}
const complete={id:'SPEC-1',title:'Write spec',artifacts:['spec.md']};
async function save(svc,created,extra={}){return svc.checkpoint({taskId:created.task.id,sessionId:created.session.id,expectedVersion:created.task.version,summary:'First checkpoint',completed:[complete],next:['Write tests'],...extra});}

test('v3.5: brand-new workspace recommends NEW_TASK without accidental mutation',()=>fixture(async({svc})=>{
 const boot=await svc.bootstrap();assert.equal(boot.recommendation,'NEW_TASK');assert.equal(svc.list().length,0);
}));

test('v3.5: create task, committed checkpoint, SQLite hash-chain and handoff artifacts',()=>fixture(async({svc})=>{
 const item=svc.createTask({title:'Improve workflow',runtime:'codex'});const p=await save(svc,item);
 assert.equal(p.task.version,2);assert.equal(svc.verify(item.task.id).valid,true);
 const exported=await svc.export(item.task.id);
 assert.equal(exported.decision,'RESUME');
 const handoff=await readFile(join(exported.directory,'HANDOFF.md'),'utf8');
 assert.match(handoff,/Write spec/);assert.match(handoff,/Write tests/);
 for(const file of ['PROJECT_STATE.json','TASK_LEDGER.md','DECISIONS.md','PROGRESS_LOG.md','NEXT_ACTIONS.md','TEST_RESULTS.json','SESSION_HISTORY/'+item.session.id+'.json']){
 const dest=file==='TASK_LEDGER.md'?join(svc.exportDir,file):join(exported.directory,file);
 assert.ok((await readFile(dest)).length>0,file);
 }
}));

test('v3.5: session restart resumes without losing completed evidence',()=>fixture(async({data,root,svc})=>{
 const item=svc.createTask({title:'Resume task'});await save(svc,item);
 const store2=new ProductionStore(data),s2=new SessionContinuity(store2.db,{root});
 try{const rec=await s2.resume({taskId:item.task.id,expectedVersion:2,runtime:'claude'});assert.equal(rec.task.version,3);assert.equal(rec.session.runtime,'claude');
 assert.equal(s2.session(item.session.id).close_reason,'SUPERSEDED_BY_RESUME');
 assert.equal(s2.latest(item.task.id).payload.completed[0].id,'SPEC-1');
 assert.equal(s2.verify(item.task.id).valid,true);
 const next=await s2.checkpoint({taskId:item.task.id,sessionId:rec.session.id,expectedVersion:3,completed:[complete],next:[],summary:'Testing complete'});
 assert.equal(next.task.version,4);
 }finally{store2.db.close()}
}));

test('v3.5: invalid artifact evidence is rejected and no checkpoint is written',()=>fixture(async({svc})=>{
 const item=svc.createTask({title:'bad evidence'});
 await assert.rejects(()=>save(svc,item,{completed:[{id:'A',title:'Fake done',artifacts:['missing.md']}]}),/missing/);
 assert.equal(svc.latest(item.task.id),null);
}));

test('v3.5: missing or altered evidence causes RECONCILE and blocks resume/finish',()=>fixture(async({root,svc})=>{
 const item=svc.createTask({title:'Changes after review'});await save(svc,item);
 await writeFile(join(root,'spec.md'),'replaced');
 const status=await svc.inspect(item.task.id);assert.equal(status.decision,'RECONCILE');assert.equal(status.drift[0].reason,'CHANGED');
 await assert.rejects(()=>svc.resume({taskId:item.task.id,expectedVersion:2}),/Evidence mismatch/);
 await assert.rejects(()=>svc.finish({taskId:item.task.id,sessionId:item.session.id,expectedVersion:2,confirm:true}),/drifted evidence/);
}));

test('v3.5: compare-and-swap rejects stale session and version conflicts',()=>fixture(async({svc})=>{
 const item=svc.createTask({title:'CAS task'});await save(svc,item);
 await assert.rejects(()=>svc.checkpoint({taskId:item.task.id,sessionId:item.session.id,expectedVersion:1,next:[]}),/version conflict/);
 const rec=await svc.resume({taskId:item.task.id,expectedVersion:2,runtime:'claude'});
 await assert.rejects(()=>svc.checkpoint({taskId:item.task.id,sessionId:item.session.id,expectedVersion:3,next:[]}),/does not own/);
 await assert.rejects(()=>svc.resume({taskId:item.task.id,expectedVersion:2}),/version conflict/);
 assert.equal(svc.session(rec.session.id).ended_at,null);
}));

test('v3.5: idempotency prevents duplicate checkpoint and rejects conflicting replay',()=>fixture(async({svc})=>{
 const item=svc.createTask({title:'Idempotency task'});
 const base={taskId:item.task.id,sessionId:item.session.id,expectedVersion:1,operationId:'unique-op',summary:'Saved',completed:[complete]};
 const one=await svc.checkpoint(base),two=await svc.checkpoint(base);
 assert.equal(two.idempotent,true);assert.equal(one.checkpoint,two.checkpoint);assert.equal(svc.history(item.task.id).length,1);
 await assert.rejects(()=>svc.checkpoint({...base,summary:'different'}),/Idempotency key reused/);
}));

test('v3.5: cannot silently drop or rewrite completed steps',()=>fixture(async({svc})=>{
 const item=svc.createTask({title:'No silent drop'});await save(svc,item);
 await assert.rejects(()=>svc.checkpoint({taskId:item.task.id,sessionId:item.session.id,expectedVersion:2,summary:'Bad',completed:[]}),/without explicit invalidation/);
 const okay=await svc.checkpoint({taskId:item.task.id,sessionId:item.session.id,expectedVersion:2,completed:[],invalidations:[{id:'SPEC-1',reason:'New requirements make spec obsolete'}],next:['Rewrite spec']});
 assert.equal(okay.task.version,3);
}));

test('v3.5: path traversal and symlinks are rejected, including within workspace',()=>fixture(async({root,svc})=>{
 const item=svc.createTask({title:'Path policy'});await symlink(join(root,'spec.md'),join(root,'evidence-link.md'));
 for(const file of ['../outside.md','/etc/passwd','evidence-link.md','.session-handoff/HANDOFF.md']){
 await assert.rejects(()=>save(svc,item,{completed:[{id:'X',title:'Unsafe',artifacts:[file]}]}));
 }
}));

test('v3.5: checkpoint tampering is detected and task enters RECONCILE',()=>fixture(async({svc,store})=>{
 const item=svc.createTask({title:'Integrity task'});await save(svc,item);
 store.db.prepare('UPDATE continuity_checkpoints SET payload=? WHERE task_id=?').run('{"forged":true}',item.task.id);
 const report=await svc.inspect(item.task.id);assert.equal(report.decision,'RECONCILE');assert.equal(report.chain.valid,false);
}));

test('v3.5: finish needs explicit confirmation, resolved steps, evidence and verification',()=>fixture(async({svc})=>{
 const item=svc.createTask({title:'Finish task'});await save(svc,item);
 await assert.rejects(()=>svc.finish({taskId:item.task.id,sessionId:item.session.id,expectedVersion:2,confirm:true}),/pending next/);
 await svc.checkpoint({taskId:item.task.id,sessionId:item.session.id,expectedVersion:2,completed:[complete],summary:'No work remaining',checks:[{command:'npm test',result:'PASS'}]});
 await assert.rejects(()=>svc.finish({taskId:item.task.id,sessionId:item.session.id,expectedVersion:3}),/Explicit confirm/);
 const fin=await svc.finish({taskId:item.task.id,sessionId:item.session.id,expectedVersion:3,confirm:true});
 assert.equal(fin.status,'DONE');assert.equal((await svc.inspect(item.task.id)).decision,'NEW_TASK');
}));

test('v3.5: two SQLite connections fence conflicting resume on same host',()=>fixture(async({root,data,svc})=>{
 const item=svc.createTask({title:'Two runtimes'});await save(svc,item);
 const another=new ProductionStore(data),other=new SessionContinuity(another.db,{root});
 try{const first=await svc.resume({taskId:item.task.id,expectedVersion:2,runtime:'claude'});
 await assert.rejects(()=>other.resume({taskId:item.task.id,expectedVersion:2,runtime:'codex'}),/version conflict/);
 assert.equal(other.task(item.task.id).active_session,first.session.id);
 }finally{another.db.close()}
}));

test('v3.5: multiple task bootstrap requires explicit choice',()=>fixture(async({svc})=>{
 const a=svc.createTask({title:'First task'});const b=svc.createTask({title:'Second task'});
 assert.equal((await svc.bootstrap()).recommendation,'CHOOSE_TASK');
 await save(svc,a);assert.equal((await svc.bootstrap()).active.length,2);
}));

test('v3.5: hook is fail-open and does not invent checkpoint',()=>fixture(async({root,data,svc})=>{
 const item=svc.createTask({title:'Compaction task'});
 // Hook executable is expected to tolerate empty/out-of-band event metadata.
 const command=spawnSync(process.execPath,[join(process.cwd(),'scripts/session-hook.mjs'),'PreCompact'],{cwd:root,input:'{}',encoding:'utf8',env:{...process.env,DATA_DIR:data,BA_CONTINUITY_ROOT:root},timeout:15000});
 assert.equal(command.status,0,command.stderr);assert.equal(svc.latest(item.task.id),null);
 assert.ok((await readFile(join(root,'.session-handoff',item.task.id,'HANDOFF.md'),'utf8')).includes('No checkpoint yet'));
}));

test('v3.5: malformed checkpoint payload fails closed and exports RECONCILE safely',()=>fixture(async({svc,store})=>{
 const item=svc.createTask({title:'Corrupted DB row'});await save(svc,item);
 store.db.prepare('UPDATE continuity_checkpoints SET payload=? WHERE task_id=?').run('{invalid-json',item.task.id);
 const status=await svc.inspect(item.task.id);assert.equal(status.decision,'RECONCILE');
 const projected=await svc.export(item.task.id);assert.equal(projected.decision,'RECONCILE');
 const md=await readFile(join(projected.directory,'HANDOFF.md'),'utf8');assert.match(md,/RECONCILE/);
}));

test('v3.5: CLI context thresholds use only supplied counts and reject invented budget',()=>fixture(async({root,data,svc})=>{
 const task=svc.createTask({title:'Context thresholds'});
 const path=join(root,'context.json');await writeFile(path,JSON.stringify({usedTokens:8800,maxTokens:10000,taskId:task.task.id}));
 const cmd=spawnSync(process.execPath,[join(process.cwd(),'scripts/session-continuity.mjs'),'context','--file',path],{cwd:root,encoding:'utf8',env:{...process.env,BA_CONTINUITY_ROOT:root,DATA_DIR:data},timeout:15000});
 assert.equal(cmd.status,0,cmd.stderr);assert.equal(JSON.parse(cmd.stdout).level,'HANDOFF_NOW');
}));
