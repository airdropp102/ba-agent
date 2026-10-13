#!/usr/bin/env node
/** Operator workspace CLI. Existing project data is never deleted during migration. */
import {loadDotEnv} from './load-env.mjs';
await loadDotEnv();
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProductionStore} from '../src/production-store.js';
import {ProjectWorkspaces} from '../src/project-workspaces.js';
import {SessionContinuity} from '../src/session-continuity.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dataDir=path.resolve(process.env.DATA_DIR||path.join(root,'data'));
await mkdir(dataDir,{recursive:true,mode:0o700});
const store=new ProductionStore(dataDir),workspaces=new ProjectWorkspaces(store);
const continuity=new SessionContinuity(store.db,{root,dataDir});
try{
  const command=process.argv[2]||'status';
  const selected=process.argv.includes('--project')?process.argv[process.argv.indexOf('--project')+1]:null;
  let result;
  if(command==='migrate'){
    await store.importLegacy();
    const projects=selected?[await workspaces.migrateLegacy(selected)]:await workspaces.migrateAll();
    const handoffs=[];
    for(const project of projects){
      const tasks=store.db.prepare('SELECT id FROM continuity_tasks WHERE project_id=?').all(project.projectId);
      for(const task of tasks){
        try{handoffs.push(await continuity.export(task.id))}
        catch(e){handoffs.push({taskId:task.id,projectId:project.projectId,error:e.message,requiresReconciliation:true})}
      }
    }
    result={projects,handoffs};
  }else if(command==='status'){
    const projects=selected?[store.get(selected)]:store.list();
    result=projects.map(p=>({projectId:p.id,title:p.title,workspace:workspaces.root(p.id),version:p.version,documentCount:workspaces.list(p.id).length}));
  }else throw new Error('Use status|migrate [--project <project-uuid>]');
  console.log(JSON.stringify({command,result,registry:'shared SQLite',projectDataRoot:path.join(dataDir,'projects')},null,2));
}catch(e){console.error(e.message);process.exitCode=1}finally{store.db.close()}
