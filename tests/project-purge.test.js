import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';import {randomUUID} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {ProductionStore} from '../src/production-store.js';
import {SessionContinuity} from '../src/session-continuity.js';
const cli=path.resolve('scripts/project-purge.mjs');
test('purge previews without deleting, then removes project records and mirrors while preserving runtime files',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ba-purge-'));const id=randomUUID();
 try{
  const store=new ProductionStore(dir);store.save({id,version:1,updatedAt:new Date().toISOString(),title:'Fixture',status:'NEW'});await store.mirror(store.get(id));const continuity=new SessionContinuity(store.db,{root:dir,dataDir:dir});continuity.createTask({title:'Global fixture',runtime:'codex'});continuity.createTask({title:'Project fixture',runtime:'codex',scope:'ba-workflow',projectId:id});store.db.close();
  await mkdir(path.join(dir,'projects',id),{recursive:true});await writeFile(path.join(dir,'projects',id,'brief.md'),'fixture');await mkdir(path.join(dir,'runtime'));await writeFile(path.join(dir,'runtime','keep'),'config');
  const run=args=>spawnSync(process.execPath,[cli,...args],{env:{...process.env,DATA_DIR:dir},encoding:'utf8'});
  const preview=run([]);assert.equal(preview.status,0,preview.stderr);assert.equal(JSON.parse(preview.stdout).projects,1);assert.equal(await readFile(path.join(dir,id+'.json'),'utf8').then(()=>true),true);
  const deleted=run(['--confirm']);assert.equal(deleted.status,0,deleted.stderr);assert.equal(JSON.parse(deleted.stdout).deletedProjects,1);
  const check=new ProductionStore(dir);assert.equal(check.list().length,0);assert.equal(check.db.prepare('SELECT count(*) AS n FROM continuity_tasks').get().n,1);assert.equal(check.db.prepare('SELECT count(*) AS n FROM continuity_sessions').get().n,1);assert.equal(await check.importLegacy(),0);check.db.close();assert.equal(await readFile(path.join(dir,'runtime','keep'),'utf8'),'config');
  await assert.rejects(readFile(path.join(dir,'projects',id,'brief.md')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('purge refuses an open SQLite database in another process',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ba-purge-busy-'));const store=new ProductionStore(dir);
 try{const r=spawnSync(process.execPath,[cli,'--confirm'],{env:{...process.env,DATA_DIR:dir},encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/server|worker|process/i);}finally{store.db.close();await rm(dir,{recursive:true,force:true});}
});

test('purge removes orphan mirrors, scoped records and pending cleanup, preserving projectless telemetry',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ba-purge-orphan-'));const id=randomUUID(),orphan=randomUUID();
 try{
  const store=new ProductionStore(dir);store.save({id,version:1,title:'fixture',updatedAt:new Date().toISOString()});
  store.db.prepare("INSERT INTO ai_invocations(id,project_id,stage,operation,provider,model,started_at,duration_ms,status) VALUES(?,?, 'TEST','test','demo','demo',datetime('now'),1,'SUCCESS')").run(randomUUID(),id);
  store.db.prepare("INSERT INTO ai_invocations(id,project_id,stage,operation,provider,model,started_at,duration_ms,status) VALUES(?,NULL, 'TEST','test','demo','demo',datetime('now'),1,'SUCCESS')").run(randomUUID());store.db.close();
  await writeFile(path.join(dir,orphan+'.json'),'orphan mirror');const staged=path.join(dir,'projects',orphan+'.purge-'+randomUUID());await mkdir(staged,{recursive:true});await writeFile(path.join(staged,'leftover'),'fixture');
  const run=spawnSync(process.execPath,[cli,'--confirm'],{env:{...process.env,DATA_DIR:dir},encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const check=new ProductionStore(dir);assert.equal(check.db.prepare('SELECT count(*) AS n FROM ai_invocations').get().n,1);assert.equal(await check.importLegacy(),0);check.db.close();
  await assert.rejects(readFile(path.join(staged,'leftover')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('symlink workspace prevents deletion and leaves project database intact',async()=>{
 const {symlink}=await import('node:fs/promises');const dir=await mkdtemp(path.join(tmpdir(),'ba-purge-link-')),outside=await mkdtemp(path.join(tmpdir(),'ba-keep-'));const id=randomUUID();
 try{const store=new ProductionStore(dir);store.save({id,version:1,title:'fixture',updatedAt:new Date().toISOString()});store.db.close();await symlink(outside,path.join(dir,'projects'));const run=spawnSync(process.execPath,[cli,'--confirm'],{env:{...process.env,DATA_DIR:dir},encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/symlink/);const check=new ProductionStore(dir);assert.equal(check.list().length,1);check.db.close();}finally{await rm(dir,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});

test('alternate DATA_DIR cannot remove unrelated repository handoff shortcuts or staged files',async()=>{
 const {cp}=await import('node:fs/promises');const root=await mkdtemp(path.join(tmpdir(),'ba-purge-isolated-root-'));const data=path.join(root,'alternate'),id=randomUUID(),other=randomUUID();
 try{
  await mkdir(path.join(root,'scripts'),{recursive:true});await cp(cli,path.join(root,'scripts','project-purge.mjs'));await cp(path.resolve('scripts/load-env.mjs'),path.join(root,'scripts','load-env.mjs'));await cp(path.resolve('src'),path.join(root,'src'),{recursive:true});await mkdir(data);
  const store=new ProductionStore(data);store.save({id,version:1,title:'fixture',updatedAt:new Date().toISOString()});store.db.close();
  const handoff=path.join(root,'.session-handoff');await mkdir(handoff);await writeFile(path.join(handoff,'PROJECT_STATE.json'),JSON.stringify({task:{id:randomUUID(),project_id:other}}));await writeFile(path.join(handoff,'HANDOFF.md'),'unrelated handoff');const staged=path.join(handoff,other+'.purge-'+randomUUID());await mkdir(staged);await writeFile(path.join(staged,'keep'),'other database');
  const run=spawnSync(process.execPath,[path.join(root,'scripts','project-purge.mjs'),'--confirm'],{env:{...process.env,DATA_DIR:data},encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  assert.equal(await readFile(path.join(handoff,'HANDOFF.md'),'utf8'),'unrelated handoff');assert.equal(await readFile(path.join(staged,'keep'),'utf8'),'other database');
 }finally{await rm(root,{recursive:true,force:true});}
});
