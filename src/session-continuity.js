/** v3.5 Session Continuity. SQLite is authoritative. Exported Markdown/JSON are disposable projections.
 * This ledger tracks operator/agent engineering sessions, not the BA workflow_jobs queue.
 */
import {createHash,randomUUID} from 'node:crypto';
import {lstat,readFile,realpath,rename,mkdir,writeFile,rm} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep,dirname} from 'node:path';
import {projectDirectory} from './project-workspaces.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
const now=()=>new Date().toISOString();
const fail=(message,status=409)=>Object.assign(new Error(message),{status});
const sid=/^[0-9a-f-]{36}$/i;
const str=(s,max=3000)=>typeof s==='string'&&s.trim()&&s.length<=max;
const txt=(value,limit=400)=>String(value||'').replace(/[\u0000-\u001f]/g,' ').slice(0,limit);
const parse=s=>JSON.parse(s);
const inside=(base,absolute)=>absolute!==base&&absolute.startsWith(base+sep);
export class SessionContinuity {
  constructor(db,{root,exportDir=join(root,'.session-handoff'),dataDir=join(root,'data')}={}){
    if(!db||!root)throw Error('SQLite database and project root required');
    this.db=db;this.root=resolve(root);this.exportDir=resolve(exportDir);this.dataDir=resolve(dataDir);
    this.db.exec(`CREATE TABLE IF NOT EXISTS continuity_tasks(
      id TEXT PRIMARY KEY,title TEXT NOT NULL,scope TEXT NOT NULL,project_id TEXT,status TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,active_session TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_continuity_active ON continuity_tasks(status,updated_at);
    CREATE TABLE IF NOT EXISTS continuity_sessions(
      id TEXT PRIMARY KEY,task_id TEXT NOT NULL REFERENCES continuity_tasks(id),runtime TEXT NOT NULL,
      external_session_id TEXT,started_at TEXT NOT NULL,ended_at TEXT,close_reason TEXT);
    CREATE INDEX IF NOT EXISTS idx_continuity_sessions ON continuity_sessions(task_id,started_at);
    CREATE TABLE IF NOT EXISTS continuity_checkpoints(
      seq INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL REFERENCES continuity_tasks(id),
      session_id TEXT NOT NULL REFERENCES continuity_sessions(id),operation_id TEXT NOT NULL,
      task_version INTEGER NOT NULL,payload TEXT NOT NULL,payload_hash TEXT NOT NULL,
      previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL,created_at TEXT NOT NULL,
      UNIQUE(task_id,operation_id));
    CREATE INDEX IF NOT EXISTS idx_continuity_checkpoints ON continuity_checkpoints(task_id,seq);
    INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(5,datetime('now'));`);
  }
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const output=fn();this.db.exec('COMMIT');return output}catch(e){this.db.exec('ROLLBACK');throw e}}
  task(id){if(!sid.test(id||''))throw fail('Invalid task ID',400);const row=this.db.prepare('SELECT * FROM continuity_tasks WHERE id=?').get(id);if(!row)throw fail('Task not found',404);return row}
  session(id){if(!sid.test(id||''))throw fail('Invalid session ID',400);const row=this.db.prepare('SELECT * FROM continuity_sessions WHERE id=?').get(id);if(!row)throw fail('Session not found',404);return row}
  list({limit=30,projectId=undefined}={}){
    const sql='SELECT * FROM continuity_tasks';
    const filter=projectId===undefined?'':projectId===null?' WHERE project_id IS NULL':' WHERE project_id=?';
    const params=projectId===undefined||projectId===null?[]:[projectId];
    if(projectId!==undefined&&projectId!==null&&!sid.test(projectId))throw fail('Invalid project ID',400);
    return this.db.prepare(sql+filter+' ORDER BY CASE WHEN status=? THEN 0 ELSE 1 END,updated_at DESC LIMIT ?').all(...params,'IN_PROGRESS',Math.min(Math.max(1,limit),100));
  }
  handoffDir(task){return task.project_id?join(projectDirectory(this.dataDir,task.project_id),'08-sessions'):this.exportDir;}

  latest(taskId){const row=this.db.prepare('SELECT * FROM continuity_checkpoints WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(taskId);if(!row)return null;try{return {...row,payload:parse(row.payload)}}catch{return {...row,payload:null,parseError:true}}}
  history(taskId){this.task(taskId);return this.db.prepare('SELECT seq,task_version,session_id,operation_id,payload_hash,entry_hash,previous_hash,created_at FROM continuity_checkpoints WHERE task_id=? ORDER BY seq').all(taskId)}
  createTask({title,scope='engineering',projectId=null,runtime='codex',externalSessionId=null}={}){
    if(!str(title,180))throw fail('Task title required, up to 180 chars',400);
    if(!['engineering','ba-workflow'].includes(scope))throw fail('Invalid scope',400);
    if(projectId!==null){if(!sid.test(projectId))throw fail('Invalid BA project ID',400);
      if(!this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId))throw fail('Project must exist before binding task',404);}
    if(scope==='ba-workflow'&&!projectId)throw fail('BA workflow task requires --project',400);
    const taskId=randomUUID(),sessionId=randomUUID(),time=now();
    this.tx(()=>{
      this.db.prepare('INSERT INTO continuity_tasks(id,title,scope,project_id,status,version,active_session,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(taskId,title,scope,projectId,'IN_PROGRESS',1,sessionId,time,time);
      this.insertSession(sessionId,taskId,runtime,externalSessionId,time);
    });return {task:this.task(taskId),session:this.session(sessionId)};
  }
  insertSession(id,taskId,runtime,externalId,time=now()){
    if(!['codex','claude','manual'].includes(runtime))throw fail('Invalid runtime',400);
    if(externalId!==null&&!str(externalId,160))throw fail('Invalid external session ID',400);
    this.db.prepare('INSERT INTO continuity_sessions(id,task_id,runtime,external_session_id,started_at) VALUES(?,?,?,?,?)').run(id,taskId,runtime,externalId,time);
  }
  async artifactDigest(file,projectId=null){
    if(!str(file,500)||isAbsolute(file))throw fail('Artifact must be a relative repository path',400);
    const base=projectId?projectDirectory(this.dataDir,projectId):this.root;
    const abs=resolve(base,file);
    if(!inside(base,abs)||inside(this.exportDir,abs)||abs===this.exportDir)throw fail('Artifact path outside allowed workspace',400);
    let stat;try{stat=await lstat(abs)}catch{throw fail('Evidence artifact missing: '+txt(file),409)}
    if(!stat.isFile()||stat.isSymbolicLink())throw fail('Evidence must be a regular file',400);
    const resolved=await realpath(abs);
    if(!inside(base,resolved))throw fail('Evidence path escapes workspace',400);
    if(stat.size>15_000_000)throw fail('Evidence exceeds 15MB',400);
    const content=await readFile(abs);return {path:relative(base,abs).replaceAll('\\','/'),sha256:hash(content),size:stat.size};
  }
  async normalize(input,projectId=null){
    if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Checkpoint object required',400);
    const textField=name=>{const value=input[name]??'';if(typeof value!=='string'||value.length>3000)throw fail(`Invalid ${name}`,400);return value.trim()};
    const arr=(name,max=50)=>{const value=input[name]??[];if(!Array.isArray(value)||value.length>max||!value.every(v=>str(v,600)))throw fail(`Invalid ${name}`,400);return value.map(x=>x.trim())};
    const completed=[];const ids=new Set();
    const invalidations=[];
    if(!Array.isArray(input.invalidations??[])||(input.invalidations??[]).length>50)throw fail('Invalid invalidations',400);
    for(const x of input.invalidations||[]){if(!x||!str(x.id,80)||!str(x.reason,500))throw fail('Invalidation requires step ID and reason',400);invalidations.push({id:x.id,reason:x.reason});}
    if(!Array.isArray(input.completed??[])||(input.completed??[]).length>50)throw fail('Invalid completed items',400);
    for(const item of input.completed||[]){
      if(!item||!str(item.id,80)||!str(item.title,500)||ids.has(item.id))throw fail('Completed step requires unique ID and title',400);
      if(!Array.isArray(item.artifacts)||item.artifacts.length<1||item.artifacts.length>15)throw fail('Completed step requires artifact evidence',400);
      ids.add(item.id);
      const artifacts=[];for(const file of item.artifacts)artifacts.push(await this.artifactDigest(file,projectId));
      completed.push({id:item.id,title:item.title.trim(),artifacts});
    }
    const checks=[];
    if(!Array.isArray(input.checks??[])||(input.checks??[]).length>30)throw fail('Invalid checks',400);
    for(const item of input.checks||[]){
      if(!item||!str(item.command,500)||!['PASS','FAIL','NOT_RUN'].includes(item.result))throw fail('Invalid verification check',400);
      // The operator supplies this report. It is NOT independent proof of command execution.
      checks.push({command:item.command,result:item.result,output:item.output?await this.artifactDigest(item.output,projectId):null,recordedBy:'agent-reported'});
    }
    return {summary:textField('summary'),inProgress:textField('inProgress'),completed,invalidations,
      next:arr('next'),decisions:arr('decisions'),risks:arr('risks'),checks,
      context:{usedTokens:Number.isSafeInteger(input.context?.usedTokens)&&input.context.usedTokens>=0?input.context.usedTokens:null,
        maxTokens:Number.isSafeInteger(input.context?.maxTokens)&&input.context.maxTokens>0?input.context.maxTokens:null}};
  }
  appendCheckpoint({taskId,sessionId,expectedVersion,operationId,payload}){
    if(!sid.test(sessionId||''))throw fail('Invalid session ID',400);
    if(!str(operationId,100))throw fail('Operation ID required for idempotency',400);
    if(!Number.isInteger(expectedVersion)||expectedVersion<1)throw fail('Expected task version required',400);
    const serialized=JSON.stringify(payload),payloadHash=hash(serialized);
    return this.tx(()=>{
      const task=this.task(taskId);
      const existing=this.db.prepare('SELECT * FROM continuity_checkpoints WHERE task_id=? AND operation_id=?').get(taskId,operationId);
      if(existing){if(existing.payload_hash!==payloadHash||existing.session_id!==sessionId)throw fail('Idempotency key reused with different payload',409);
        return {task,checkpoint:existing.seq,idempotent:true};}
      if(task.status!=='IN_PROGRESS'||task.active_session!==sessionId||this.session(sessionId).ended_at)throw fail('Session does not own active task',409);
      if(task.version!==expectedVersion)throw fail(`Task version conflict; current version=${task.version}`,409);
      if(!this.verify(taskId).valid)throw fail('Checkpoint chain invalid; reconciliation required');
      const prior=this.latest(taskId);
      if(prior){const present=new Map(payload.completed.map(x=>[x.id,x]));const invalidated=new Set(payload.invalidations.map(x=>x.id));
        for(const previousStep of prior.payload.completed){
          const updated=present.get(previousStep.id);
          if(!updated&&!invalidated.has(previousStep.id))throw fail('Completed step removed without explicit invalidation: '+previousStep.id);
          if(updated&&JSON.stringify(updated)!==JSON.stringify(previousStep)&&!invalidated.has(previousStep.id))throw fail('Completed evidence changed without explicit invalidation: '+previousStep.id);
        }
      }
      const previous=prior?.entry_hash||'GENESIS',time=now(),version=task.version+1;
      const entryHash=hash(JSON.stringify({taskId,sessionId,operationId,version,payloadHash,previous,time}));
      this.db.prepare(`INSERT INTO continuity_checkpoints(task_id,session_id,operation_id,task_version,payload,payload_hash,previous_hash,entry_hash,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`).run(taskId,sessionId,operationId,version,serialized,payloadHash,previous,entryHash,time);
      this.db.prepare('UPDATE continuity_tasks SET version=?,updated_at=? WHERE id=?').run(version,time,taskId);
      return {task:this.task(taskId),checkpoint:this.latest(taskId).seq,idempotent:false};
    });
  }
  async checkpoint({taskId,sessionId,expectedVersion,operationId=randomUUID(),...details}={}){
    const task=this.task(taskId);
    const payload=await this.normalize(details,task.project_id);
    return this.appendCheckpoint({taskId,sessionId,expectedVersion,operationId,payload});
  }
  verify(taskId){const task=this.task(taskId),rows=this.db.prepare('SELECT * FROM continuity_checkpoints WHERE task_id=? ORDER BY seq').all(taskId);
    let previous='GENESIS';for(const row of rows){const digest=hash(row.payload);
      const expected=hash(JSON.stringify({taskId,sessionId:row.session_id,operationId:row.operation_id,version:row.task_version,payloadHash:digest,previous,time:row.created_at}));
      if(digest!==row.payload_hash||row.previous_hash!==previous||row.entry_hash!==expected)return {valid:false,reason:'CHECKPOINT_CHAIN_INVALID',at:row.seq};previous=expected;
    }return {valid:true,checkpointCount:rows.length,tipHash:previous,taskVersion:task.version};
  }
  async inspect(taskId){
    const task=this.task(taskId),latest=this.latest(taskId),chain=this.verify(taskId),drift=[];
    if(chain.valid&&latest){for(const done of latest.payload.completed){for(const art of done.artifacts){
      try{const current=await this.artifactDigest(art.path,task.project_id);
        if(current.sha256!==art.sha256)drift.push({step:done.id,path:art.path,reason:'CHANGED'});
      }catch(e){drift.push({step:done.id,path:art.path,reason:'MISSING_OR_UNSAFE'});}
    }}}
    return {task,latest,chain,drift,decision:!chain.valid?'RECONCILE':drift.length?'RECONCILE':task.status==='DONE'?'NEW_TASK':task.status==='IN_PROGRESS'?'RESUME':'REVIEW'};
  }
  async resume({taskId,runtime='codex',externalSessionId=null,expectedVersion}={}){
    const check=await this.inspect(taskId);if(check.decision==='RECONCILE')throw fail('Evidence mismatch or chain failure; reconcile before resume',409);
    const time=now(),sessionId=randomUUID();
    return this.tx(()=>{
      const task=this.task(taskId);
      if(task.version!==expectedVersion)throw fail(`Task version conflict; current version=${task.version}`);
      if(task.status!=='IN_PROGRESS')throw fail('Only in-progress tasks may resume');
      if(task.active_session)this.db.prepare('UPDATE continuity_sessions SET ended_at=COALESCE(ended_at,?),close_reason=COALESCE(close_reason,?) WHERE id=?').run(time,'SUPERSEDED_BY_RESUME',task.active_session);
      this.insertSession(sessionId,taskId,runtime,externalSessionId,time);
      this.db.prepare('UPDATE continuity_tasks SET active_session=?,version=version+1,updated_at=? WHERE id=?').run(sessionId,time,taskId);
      return {task:this.task(taskId),session:this.session(sessionId),lastCheckpoint:check.latest?.seq||null};
    });
  }
  async finish({taskId,sessionId,expectedVersion,confirm=false}={}){
    const inspection=await this.inspect(taskId);
    if(inspection.decision==='RECONCILE')throw fail('Cannot finish with invalid checkpoint or drifted evidence');
    if(confirm!==true)throw fail('Explicit confirm required',400);
    return this.tx(()=>{
      const task=this.task(taskId);if(task.version!==expectedVersion)throw fail('Task version conflict');
      if(task.active_session!==sessionId||task.status!=='IN_PROGRESS'||this.session(sessionId).ended_at)throw fail('Not task owner');
      const latest=this.latest(taskId);if(!latest||!latest.payload.completed.length||latest.payload.next.length||latest.payload.inProgress||latest.payload.risks.length||latest.payload.checks.some(x=>x.result==='FAIL'))throw fail('Cannot finish task with pending next actions, in-progress work, or risks');
      const time=now();this.db.prepare("UPDATE continuity_tasks SET status='DONE',active_session=NULL,version=version+1,updated_at=? WHERE id=?").run(time,taskId);
      this.db.prepare("UPDATE continuity_sessions SET ended_at=?,close_reason='TASK_COMPLETED' WHERE id=?").run(time,sessionId);
      return this.task(taskId);
    });
  }
  async export(taskId){
    const state=await this.inspect(taskId),{task,latest,chain,drift,decision}=state;
    const base=this.handoffDir(task);
    if(task.project_id){
      // Never follow a user-created project or session symlink during handoff export.
      for(const dir of [join(this.dataDir,'projects'),projectDirectory(this.dataDir,task.project_id)]){
        const st=await lstat(dir).catch(()=>null);
        if(!st||!st.isDirectory()||st.isSymbolicLink())throw fail('Project workspace must be a physical directory',409);
      }
      await mkdir(base,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e});
      const st=await lstat(base);
      if(!st.isDirectory()||st.isSymbolicLink())throw fail('Unsafe session handoff directory',409);
    }else await mkdir(base,{recursive:true,mode:0o700});
    const output=join(base,taskId);await mkdir(output,{recursive:true,mode:0o700});
    const steps=latest?.payload?.completed||[];
    const renderList=(values)=>values.length?values.map(v=>'- '+txt(v,500)).join('\n'):'- (none recorded)';
    const markdown=`# BA Studio v3.6 — Project Session Handoff\n\nTask: ${txt(task.title)}\nTask ID: ${task.id}\nStatus: ${task.status}\nScope: ${task.scope}\nProject ID: ${task.project_id||'PLATFORM'}\nVersion: ${task.version}\nLatest checkpoint: ${latest?.seq??'NONE'}\nLatest commit: ${latest?.created_at??'NONE'}\nContinuity decision: ${decision}\nIntegrity: ${chain.valid?'VALID':'INVALID'}\n\n## Work summary\n${txt(latest?.payload?.summary||'No checkpoint yet',3000)}\n\n## Completed steps (evidence required)\n${renderList(steps.map(s=>`${s.id}: ${s.title} [${s.artifacts.map(a=>`${a.path}@${a.sha256.slice(0,12)}`).join(', ')}]`))}\n\n## In progress\n${txt(latest?.payload?.inProgress||'None recorded',3000)}\n\n## Next actions\n${renderList(latest?.payload?.next||[])}\n\n## Decisions\n${renderList(latest?.payload?.decisions||[])}\n\n## Risks / blockers\n${renderList(latest?.payload?.risks||[])}\n\n## Verification results (agent-reported, not independently attested)\n${renderList((latest?.payload?.checks||[]).map(c=>`${c.command}: ${c.result}${c.output?' ('+c.output.path+')':''}`))}\n\n## Evidence drift\n${renderList(drift.map(d=>`${d.reason}: ${d.step} -> ${d.path}`))}\n\n## Resume protocol\n1. Run \`npm run session:bootstrap\` and inspect current task metadata.\n2. Compare actual git diff, SQLite project version, and evidence hashes.\n3. If RECONCILE, resolve changes before continuing; never treat this handoff as absolute truth.\n4. Resume with the active session ID and expected task version; checkpoint after each milestone.\n5. Do not repeat completed steps with intact evidence unless new requirements invalidate them.\n\n_This file is a read-only projection. SQLite + actual files are authoritative; unrecorded context cannot be recovered._\n`;
    const stateJson={format:'BA_STUDIO_SESSION_CONTINUITY_V1',exportedAt:now(),...state};
    await this.atomicWrite(join(output,'HANDOFF.md'),markdown);
    await this.atomicWrite(join(output,'PROJECT_STATE.json'),JSON.stringify(stateJson,null,2)+'\n');
    // Active shortcut is explicitly a projection: cross-task readers still use SQLite.
    if(task.status==='IN_PROGRESS'){
      await this.atomicWrite(join(base,'HANDOFF.md'),markdown);
      await this.atomicWrite(join(base,'PROJECT_STATE.json'),JSON.stringify(stateJson,null,2)+'\n');
    }
    const allTasks=this.list({limit:100,projectId:task.project_id});
    const summaryRows=allTasks.map(t=>`- ${t.status} ${t.id} (v${t.version}): ${txt(t.title)}`);
    await this.atomicWrite(join(base,'TASK_LEDGER.md'),'# Task Ledger\n\n'+summaryRows.join('\n')+'\n');
    const decisions=(latest?.payload?.decisions||[]).map(v=>'- '+txt(v,600));
    await this.atomicWrite(join(output,'DECISIONS.md'),'# Decisions — '+txt(task.title)+'\n\n'+decisions.join('\n')+'\n');
    const progress=this.db.prepare('SELECT seq,created_at,payload FROM continuity_checkpoints WHERE task_id=? ORDER BY seq').all(taskId);
    await this.atomicWrite(join(output,'PROGRESS_LOG.md'),'# Progress Log\n\n'+progress.map(c=>{let summary='CORRUPT CHECKPOINT';try{summary=parse(c.payload).summary||'Checkpoint saved'}catch{}return `- ${c.created_at} #${c.seq}: ${txt(summary,500)}`}).join('\n')+'\n');
    await this.atomicWrite(join(output,'NEXT_ACTIONS.md'),'# Next Actions\n\n'+renderList(latest?.payload?.next||[])+'\n');
    await this.atomicWrite(join(output,'TEST_RESULTS.json'),JSON.stringify({kind:'agent-reported-checks-not-independent-attestation',taskId,checks:latest?.payload?.checks||[]},null,2)+'\n');
    const sessions=this.db.prepare('SELECT * FROM continuity_sessions WHERE task_id=? ORDER BY started_at').all(taskId);
    const history=join(output,'SESSION_HISTORY');await mkdir(history,{recursive:true,mode:0o700});
    for(const session of sessions){
      const historyFile=join(history,session.id+'.json');
      const snapshots=progress.filter(c=>this.db.prepare('SELECT session_id FROM continuity_checkpoints WHERE seq=?').get(c.seq)?.session_id===session.id)
        .map(c=>{let payload;try{payload=parse(c.payload)}catch{payload={error:'CORRUPT_CHECKPOINT_PAYLOAD'}}return {seq:c.seq,createdAt:c.created_at,payload}});
      await this.atomicWrite(historyFile,JSON.stringify({session,snapshots},null,2)+'\n');
    }
    return {directory:output,decision,taskId,checkpoint:latest?.seq||null};
  }
  async atomicWrite(file,content){const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,content,{mode:0o600});await rename(temp,file)}finally{await rm(temp,{force:true}).catch(()=>{})}}
  async bootstrap({projectId=undefined}={}){const tasks=this.list({projectId}),active=tasks.filter(t=>t.status==='IN_PROGRESS');const inspections=[];
    for(const task of active.slice(0,15))inspections.push(await this.inspect(task.id));
    return {recommendation:inspections.some(x=>x.decision==='RECONCILE')?'RECONCILE':active.length===1?'RESUME':active.length>1?'CHOOSE_TASK':'NEW_TASK',active:inspections,completed:tasks.filter(x=>x.status==='DONE').slice(0,8).map(x=>({id:x.id,title:x.title,updatedAt:x.updated_at})),note:'Do not mutate or resume a task merely because it is listed. Verify worktree and choose explicitly.'};
  }
}
