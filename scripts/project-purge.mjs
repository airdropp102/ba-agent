#!/usr/bin/env node
/** Offline operator deletion. Preview is read-only; --confirm is required. */
import {loadDotEnv} from './load-env.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {SessionContinuity} from '../src/session-continuity.js';
await loadDotEnv();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
const uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const valid=new RegExp(`^${uuid}$`,'i');
const staged=new RegExp(`^(${uuid})(?:\\.json)?\\.purge-${uuid}$`,'i');
const stat=async p=>fs.lstat(p).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
const checked=async p=>{const s=await stat(p);if(s?.isSymbolicLink())throw Error('Refusing symlink path: '+p);return s;};
let db;
try{
 const args=process.argv.slice(2);if(args.some(a=>a!=='--confirm'))throw Error('Use npm run project:purge [-- --confirm]');
 const confirm=args.includes('--confirm');
 const base=await checked(dir);if(!base){console.log(JSON.stringify({preview:!confirm,projects:0,deletedProjects:0,files:0}));process.exit(0);}
 if(!base.isDirectory())throw Error('DATA_DIR must be a directory');
 const sqlite=path.join(dir,'ba-studio.sqlite');const dbStat=await checked(sqlite);
 if(confirm&&dbStat){
  const open=spawnSync('lsof',['-t',sqlite],{encoding:'utf8',timeout:10000});
  if(open.error||![0,1].includes(open.status))throw Error('Cannot verify stopped server/worker: lsof is required');
  if(open.stdout.trim())throw Error('Stop all server/worker processes using DATA_DIR before purge');
 }
 if(dbStat)db=new DatabaseSync(sqlite,{readOnly:!confirm,enableForeignKeyConstraints:true});
 const tables=db?db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r=>r.name):[];
 const quote=t=>'"'+t.replaceAll('"','""')+'"';
 const scoped=tables.filter(t=>db.prepare(`PRAGMA table_info(${quote(t)})`).all().some(c=>c.name==='project_id'));
 const ids=new Set(db&&tables.includes('projects')?db.prepare('SELECT id FROM projects').all().map(r=>r.id):[]);
 for(const table of scoped)for(const row of db.prepare(`SELECT DISTINCT project_id AS id FROM ${quote(table)} WHERE project_id IS NOT NULL`).all())ids.add(row.id);
 const tasks=db&&tables.includes('continuity_tasks')?db.prepare('SELECT id FROM continuity_tasks WHERE project_id IS NOT NULL').all().map(r=>r.id):[];
 if([...ids,...tasks].some(id=>!valid.test(id)))throw Error('Invalid UUID in project records; reconcile before purge');
 const targets=new Set(),leftovers=new Set(),manifests=[];
 const manifestPattern=new RegExp(`^\\.project-purge-(${uuid})\\.json$`,'i');
 for(const name of await fs.readdir(dir)){const match=name.match(manifestPattern);if(!match)continue;const file=path.join(dir,name);await checked(file);const manifest=JSON.parse(await fs.readFile(file,'utf8'));if(manifest.dataDir!==dir||!Array.isArray(manifest.moved))throw Error('Invalid purge recovery manifest');for(const [original,temporary] of manifest.moved){const parent=path.dirname(original),leaf=path.basename(original);const allowedParents=[dir,...['projects','.history','.workflow-artifacts','.figma-registry'].map(n=>path.join(dir,n)),path.join(root,'.session-handoff')];if(!allowedParents.includes(parent)||!(valid.test(leaf.replace(/\.json$/,''))||['HANDOFF.md','PROJECT_STATE.json'].includes(leaf))||temporary!==original+'.purge-'+match[1])throw Error('Invalid recovery path');await checked(parent);if(await checked(temporary))leftovers.add(temporary);}manifests.push(file);}
 const directories=[dir,...['projects','.history','.workflow-artifacts','.figma-registry'].map(name=>path.join(dir,name))];
 for(const baseDir of directories){
  const info=await checked(baseDir);if(!info)continue;if(!info.isDirectory())throw Error('Expected directory: '+baseDir);
  for(const name of await fs.readdir(baseDir)){
   const file=path.join(baseDir,name);
   if(staged.test(name)){await checked(file);leftovers.add(file);continue;}
   const id=baseDir===dir&&name.endsWith('.json')?name.slice(0,-5):name;
   if(valid.test(id)&&(baseDir!==dir||name.endsWith('.json'))){await checked(file);ids.add(id);targets.add(file);}
  }
 }
 const handoff=path.join(root,'.session-handoff');await checked(handoff);
 const pointer=path.join(handoff,'PROJECT_STATE.json');
 if(await checked(pointer)){const state=JSON.parse(await fs.readFile(pointer,'utf8'));if(state.task?.project_id&&ids.has(state.task.project_id)&&tasks.includes(state.task.id)){for(const name of ['PROJECT_STATE.json','HANDOFF.md']){const file=path.join(handoff,name);if(await checked(file))targets.add(file);}}}
 for(const id of tasks){const file=path.join(handoff,id);if(await checked(file))targets.add(file);}

 const count=db&&tables.includes('projects')?db.prepare('SELECT count(*) AS n FROM projects').get().n:0;
 if(!confirm){console.log(JSON.stringify({preview:true,projects:count,projectIds:ids.size,projectSessions:tasks.length,files:targets.size,pendingCleanup:leftovers.size,instructions:'Stop server/worker, then run npm run project:purge -- --confirm'}));}
 else{
  const moved=[];const token=randomUUID();const manifestFile=path.join(dir,`.project-purge-${token}.json`);
  await fs.writeFile(manifestFile,JSON.stringify({dataDir:dir,moved:[...targets].map(file=>[file,file+'.purge-'+token])}),{mode:0o600,flag:'wx'});
  db?.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
  try{
   if(db){const open=spawnSync('lsof',['-t',sqlite],{encoding:'utf8',timeout:10000});if(open.error||![0,1].includes(open.status))throw Error('Cannot verify stopped server/worker');if(open.stdout.trim().split(/\s+/).some(pid=>pid&&Number(pid)!==process.pid))throw Error('Stop all server/worker processes before purge');}
   for(const file of targets){const temporary=file+'.purge-'+token;await fs.rename(file,temporary);moved.push([file,temporary]);}
   if(db){
    for(const id of tasks){for(const table of ['continuity_checkpoints','continuity_sessions'])if(tables.includes(table))db.prepare(`DELETE FROM ${quote(table)} WHERE task_id=?`).run(id);}
    for(const table of scoped)db.exec(`DELETE FROM ${quote(table)} WHERE project_id IS NOT NULL`);
    if(tables.includes('projects'))db.exec('DELETE FROM projects');
    db.exec('COMMIT');
   }
  }catch(e){db?.exec('ROLLBACK');for(const [file,temporary] of moved.reverse())await fs.rename(temporary,file);await fs.rm(manifestFile,{force:true});throw e;}
  let cleaned=0;for(const file of [...leftovers,...moved.map(x=>x[1])]){try{await fs.rm(file,{recursive:true,force:true});cleaned++;}catch{throw Error('Database deletion committed; file cleanup incomplete. Run project:purge -- --confirm again.');}}
  for(const file of [...manifests,manifestFile])await fs.rm(file,{force:true});
  if(db&&tables.includes('continuity_tasks')){const global=db.prepare('SELECT id FROM continuity_tasks WHERE project_id IS NULL ORDER BY updated_at DESC LIMIT 1').get();if(dir===path.join(root,'data')&&global&&await stat(path.join(handoff,global.id))){const continuity=new SessionContinuity(db,{root,dataDir:dir});await continuity.export(global.id);}}
  const integrity=db?.prepare('PRAGMA integrity_check').get().integrity_check||'no-database';
  if(db)db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  console.log(JSON.stringify({preview:false,deletedProjects:count,projectIds:ids.size,deletedProjectSessions:tasks.length,cleanedPaths:cleaned,integrity}));
 }
}catch(e){console.error(e.message);process.exitCode=1;}finally{db?.close();}
