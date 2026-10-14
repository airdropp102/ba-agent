/** BA Studio v3.3: SQLite WAL transactional source of truth + durable queue/audit.
 * Node >=22.13: built-in node:sqlite; no native npm dependencies.
 * NOT for network shares. JSON files are best-effort legacy projections only.
 */
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const sha=s=>createHash('sha256').update(s).digest('hex');
const err=(message,status=409)=>Object.assign(new Error(message),{status});
export class ProductionStore {
  constructor(dir){
    this.dir=dir;
    this.db=new DatabaseSync(path.join(dir,'ba-studio.sqlite'),{enableForeignKeyConstraints:true});
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS project_versions(project_id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY(project_id,version));
CREATE TABLE IF NOT EXISTS project_leases(project_id TEXT PRIMARY KEY, token TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS workflow_jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL, state TEXT NOT NULL,options TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,max_attempts INTEGER NOT NULL DEFAULT 3,available_at INTEGER NOT NULL,lease_token TEXT,lease_until INTEGER,
  created_at TEXT NOT NULL,updated_at TEXT NOT NULL,last_error TEXT,result_version INTEGER);
CREATE INDEX IF NOT EXISTS idx_jobs_ready ON workflow_jobs(state,available_at);
CREATE TABLE IF NOT EXISTS figma_challenges(nonce TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL,document_key TEXT NOT NULL,manifest_digest TEXT NOT NULL,payload TEXT NOT NULL,expires_at INTEGER NOT NULL,used_at TEXT);
CREATE TABLE IF NOT EXISTS audit_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,project_id TEXT NOT NULL,event_type TEXT NOT NULL,actor_id TEXT NOT NULL,
  details TEXT NOT NULL,prev_hash TEXT NOT NULL,event_hash TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_audit_project ON audit_events(project_id,seq);
INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(1,datetime('now'));`);
    this.db.exec("INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(2,datetime('now'))");
    this.db.exec(`CREATE TABLE IF NOT EXISTS ai_invocations(
      id TEXT PRIMARY KEY,project_id TEXT,run_id TEXT,stage TEXT NOT NULL,operation TEXT NOT NULL,
      provider TEXT NOT NULL,model TEXT NOT NULL,started_at TEXT NOT NULL,duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,input_tokens INTEGER,output_tokens INTEGER,cost_usd REAL,rate_version TEXT);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_project ON ai_invocations(project_id,started_at);
    INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(3,datetime('now'));`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS quality_snapshots(project_id TEXT NOT NULL,version INTEGER NOT NULL,run_id TEXT,
      input_digest TEXT NOT NULL,score REAL,decision TEXT NOT NULL,summary TEXT NOT NULL,created_at TEXT NOT NULL,
      PRIMARY KEY(project_id,version));
    CREATE INDEX IF NOT EXISTS idx_quality_snapshots ON quality_snapshots(project_id,version);
    INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(4,datetime('now'));`);
    this.getProjectStatement=this.db.prepare('SELECT data,revision FROM projects WHERE id=?');
  }
  tx(fn){this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result}catch(e){this.db.exec('ROLLBACK');throw e}}
  attach(p,revision,leaseToken){Object.defineProperty(p,'_dbRevision',{value:revision,writable:true,configurable:true,enumerable:false});
    if(leaseToken)Object.defineProperty(p,'_leaseToken',{value:leaseToken,writable:true,configurable:true,enumerable:false});return p}
  get(id,{leaseToken}={}){const r=this.getProjectStatement.get(id);if(!r)throw err('Không tìm thấy dự án',404);return this.attach(JSON.parse(r.data),r.revision,leaseToken)}
  list(){return this.db.prepare('SELECT data FROM projects ORDER BY updated_at DESC').all().map(r=>{const p=JSON.parse(r.data);return {id:p.id,title:p.title,status:p.status,updatedAt:p.updatedAt,version:p.version,demo:p.demo}})}
  history(id){const versions=this.db.prepare('SELECT version FROM project_versions WHERE project_id=? ORDER BY version').all(id).map(r=>({version:r.version,archived:true}));return [...versions,{version:this.get(id).version,archived:false}]}
  version(id,version){const r=this.db.prepare('SELECT data FROM project_versions WHERE project_id=? AND version=?').get(id,version);if(!r)throw err('Version not found',404);return JSON.parse(r.data)}
  writeAudit(projectId,eventType,actorId,details){const prev=this.db.prepare('SELECT event_hash FROM audit_events WHERE project_id=? ORDER BY seq DESC LIMIT 1').get(projectId)?.event_hash||'GENESIS';
    const createdAt=new Date().toISOString();const serialized=JSON.stringify(details);const eventHash=sha(JSON.stringify({projectId,eventType,actorId,serialized,prev,createdAt}));
    this.db.prepare('INSERT INTO audit_events(project_id,event_type,actor_id,details,prev_hash,event_hash,created_at) VALUES(?,?,?,?,?,?,?)').run(projectId,eventType,actorId,serialized,prev,eventHash,createdAt);
  }
  save(p,{actorId='system',eventType='PROJECT_COMMITTED',details={},consumeChallenge=null,qualityReport=null}={}){
    const expected=p._dbRevision;
    const encoded=JSON.stringify(p);
    const revision=this.tx(()=>{
      const old=this.getProjectStatement.get(p.id);
      const lease=this.db.prepare('SELECT * FROM project_leases WHERE project_id=? AND expires_at>?').get(p.id,Date.now());
      if(p._leaseToken && (!lease || lease.token!==p._leaseToken))throw err('Expired or stolen executor lease (fenced writer)',409);
      if(lease && lease.token!==p._leaseToken)throw err('Project has an active executor lease',409);
      if(!old){if(expected!==undefined)throw err('Project disappeared',409);
        this.db.prepare('INSERT INTO projects(id,revision,version,data,updated_at) VALUES(?,1,?,?,?)').run(p.id,p.version,encoded,p.updatedAt);
      }else{
        if(expected!==old.revision)throw err('Concurrent project update detected; reload project',409);
        if(p.version<=JSON.parse(old.data).version)throw err('Project version must increase',409);
        this.db.prepare('INSERT OR IGNORE INTO project_versions(project_id,version,data) VALUES(?,?,?)').run(p.id,JSON.parse(old.data).version,old.data);
        const changed=this.db.prepare('UPDATE projects SET data=?,revision=revision+1,version=?,updated_at=? WHERE id=? AND revision=?').run(encoded,p.version,p.updatedAt,p.id,old.revision);
        if(changed.changes!==1)throw err('Concurrent project update detected',409);
      }
      if(consumeChallenge!==null){
        const challenge=this.db.prepare('SELECT project_id,run_id,used_at,expires_at FROM figma_challenges WHERE nonce=?').get(consumeChallenge);
        if(!challenge||challenge.project_id!==p.id||challenge.run_id!==p.workflow?.runId||challenge.used_at||challenge.expires_at<=Date.now())throw err('Figma challenge expired, reused or invalidated',409);
        const used=this.db.prepare('UPDATE figma_challenges SET used_at=? WHERE nonce=? AND used_at IS NULL').run(new Date().toISOString(),consumeChallenge);
        if(used.changes!==1)throw err('Figma challenge already consumed',409);
      }
      if(qualityReport){
        const prev=this.db.prepare('SELECT input_digest FROM quality_snapshots WHERE project_id=? ORDER BY version DESC LIMIT 1').get(p.id);
        if(prev?.input_digest!==qualityReport.inputDigest){
          this.db.prepare('INSERT INTO quality_snapshots(project_id,version,run_id,input_digest,score,decision,summary,created_at) VALUES(?,?,?,?,?,?,?,?)').run(
            p.id,p.version,p.workflow?.runId||null,qualityReport.inputDigest,qualityReport.score,qualityReport.decision,
            JSON.stringify({rates:qualityReport.rates,counts:qualityReport.counts,findings:qualityReport.findings,policy:qualityReport.policy}),new Date().toISOString());
        }
      }
      this.writeAudit(p.id,eventType,actorId,{version:p.version,revision:(old?.revision||0)+1,...details});
      return (old?.revision||0)+1;
    });
    this.attach(p,revision,p._leaseToken);
    return revision;
  }
  async mirror(p){const file=path.join(this.dir,p.id+'.json');const temp=file+'.'+randomUUID()+'.tmp';try{await fs.writeFile(temp,JSON.stringify(p,null,2),{mode:0o600});await fs.rename(temp,file)}finally{await fs.rm(temp,{force:true}).catch(()=>{})}}
  async importLegacy(){let imported=0;for(const file of await fs.readdir(this.dir)){
    if(!/^[0-9a-f-]{36}\.json$/i.test(file))continue;
    const id=file.slice(0,-5);if(this.getProjectStatement.get(id))continue;
    const p=JSON.parse(await fs.readFile(path.join(this.dir,file),'utf8'));
    if(p.id!==id||!Number.isInteger(p.version))throw new Error('Invalid legacy project: '+file);
    if(!p.updatedAt)p.updatedAt=p.createdAt||new Date().toISOString();
    try{this.save(p,{eventType:'LEGACY_PROJECT_IMPORTED',actorId:'migration'});imported++}
    catch(e){if(!this.getProjectStatement.get(id))throw e}
  }return imported}
  recoverAbandoned(){return this.tx(()=>{
    const rows=this.db.prepare('SELECT * FROM project_leases').all();let recovered=0;
    for(const row of rows){
      const pid=Number(String(row.token).split(':')[0]);let alive=true;
      if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0)}catch(e){if(e.code==='ESRCH')alive=false}}
      if(alive&&row.expires_at>Date.now())continue;
      this.db.prepare('DELETE FROM project_leases WHERE project_id=? AND token=?').run(row.project_id,row.token);
      this.db.prepare("UPDATE workflow_jobs SET state='RETRY_WAIT', available_at=?, lease_token=NULL, lease_until=NULL,updated_at=? WHERE project_id=? AND state='RUNNING' AND lease_token=?").run(Date.now(),new Date().toISOString(),row.project_id,row.token);
      this.writeAudit(row.project_id,'ORPHAN_LEASE_RECOVERED','system',{reason:alive?'lease-expired':'process-exited'});
      recovered++;
    }return recovered;
  })}
  acquireLease(projectId,{ttlMs=120000}={}){const token=`${process.pid}:${randomUUID()}`,expires=Date.now()+ttlMs;
    this.tx(()=>{const old=this.db.prepare('SELECT token,expires_at FROM project_leases WHERE project_id=?').get(projectId);
      if(old&&old.expires_at>Date.now())throw err('Project is being modified by another executor',409);
      this.db.prepare('INSERT INTO project_leases(project_id,token,expires_at) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at').run(projectId,token,expires);
    });return token;
  }
  renewLease(id,token,ttlMs=120000){const r=this.db.prepare('UPDATE project_leases SET expires_at=? WHERE project_id=? AND token=? AND expires_at>?').run(Date.now()+ttlMs,id,token,Date.now());return r.changes===1}
  releaseLease(id,token){this.db.prepare('DELETE FROM project_leases WHERE project_id=? AND token=?').run(id,token)}
  enqueue(projectId,runId,options,{maxAttempts=3}={}){
    return this.tx(()=>{
      const active=this.db.prepare("SELECT id FROM workflow_jobs WHERE project_id=? AND state IN ('QUEUED','RUNNING','RETRY_WAIT') LIMIT 1").get(projectId);
      if(active)throw err('An active workflow job already exists',409);
      const id=randomUUID(),ts=new Date().toISOString();
      this.db.prepare("INSERT INTO workflow_jobs(id,project_id,run_id,state,options,available_at,created_at,updated_at,max_attempts) VALUES(?,?,?,'QUEUED',?,?,?,?,?)").run(id,projectId,runId,JSON.stringify(options),Date.now(),ts,ts,maxAttempts);
      this.writeAudit(projectId,'JOB_QUEUED','system',{jobId:id,runId});return this.job(id)
    });
  }
  job(id,{internal=false}={}){const row=this.db.prepare('SELECT * FROM workflow_jobs WHERE id=?').get(id);if(!row)throw err('Job not found',404);const options=JSON.parse(row.options);if(!internal){delete options.channelId;delete options.revisionNotes}return {...row,options,lease_token:undefined}}
  jobs(projectId){return this.db.prepare('SELECT id FROM workflow_jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 40').all(projectId).map(x=>this.job(x.id))}
  metrics(){
    const rows=this.db.prepare("SELECT state,COUNT(*) AS count,SUM(CASE WHEN attempts>1 THEN 1 ELSE 0 END) AS retried,AVG((julianday(updated_at)-julianday(created_at))*86400000.0) AS avg_age_ms FROM workflow_jobs GROUP BY state").all();
    const states=Object.fromEntries(rows.map(r=>[r.state,r.count]));const totalJobs=rows.reduce((a,r)=>a+r.count,0);
    const finished=['SUCCEEDED','DEAD_LETTER'].reduce((a,s)=>a+(states[s]||0),0);
    return {kind:'observed-sqlite-job-metrics',totalJobs,states,retriedJobs:rows.reduce((a,r)=>a+r.retried,0),successRateCompleted:finished?Number(((states.SUCCEEDED||0)/finished).toFixed(3)):null,meanSucceededLatencyMs:Math.round(rows.find(r=>r.state==='SUCCEEDED')?.avg_age_ms||0)};
  }
  qualityHistory(projectId,{limit=50}={}){
    return this.db.prepare('SELECT version,run_id,input_digest,score,decision,summary,created_at FROM quality_snapshots WHERE project_id=? ORDER BY version DESC LIMIT ?').all(projectId,Math.max(1,Math.min(100,limit)))
      .map(r=>({...r,summary:JSON.parse(r.summary)}));
  }
  recordAIUsage(e){
    this.db.prepare(`INSERT INTO ai_invocations(id,project_id,run_id,stage,operation,provider,model,started_at,duration_ms,status,input_tokens,output_tokens,cost_usd,rate_version)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(e.id,e.projectId,e.runId,e.stage,e.operation,e.provider,e.model,e.startedAt,e.durationMs,e.status,e.inputTokens,e.outputTokens,e.costUsd,e.rateVersion);
  }
  aiMetrics(projectId=null){
    const where=projectId?' WHERE project_id=?':'';const params=projectId?[projectId]:[];
    const row=this.db.prepare(`SELECT COUNT(*) AS calls,SUM(status='ERROR') AS failures,
      SUM(CASE WHEN input_tokens IS NULL OR output_tokens IS NULL THEN 1 ELSE 0 END) AS missingUsage,
      SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknownCostCalls,
      SUM(input_tokens) AS inputTokens,SUM(output_tokens) AS outputTokens,SUM(cost_usd) AS knownCostUsd,
      AVG(duration_ms) AS meanLatencyMs FROM ai_invocations${where}`).get(...params);
    const grouped=this.db.prepare(`SELECT provider,model,COUNT(*) AS calls,SUM(cost_usd) AS knownCostUsd,SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknownCostCalls FROM ai_invocations${where} GROUP BY provider,model ORDER BY calls DESC`).all(...params);
    const latencies=this.db.prepare(`SELECT duration_ms FROM ai_invocations${where} ORDER BY started_at DESC LIMIT 10000`).all(...params).map(x=>x.duration_ms).sort((a,b)=>a-b);
    const warn=Number(process.env.BA_AI_ALERT_RUN_USD||0);
    let byRun=[];
    if(projectId)byRun=this.db.prepare('SELECT run_id,COUNT(*) AS calls,SUM(cost_usd) AS knownCostUsd,SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknownCostCalls FROM ai_invocations WHERE project_id=? GROUP BY run_id').all(projectId);
    return {kind:'recorded-ai-usage-no-content-retention',projectId,calls:row.calls,failures:row.failures||0,
      inputTokens:row.inputTokens,outputTokens:row.outputTokens,missingUsage:row.missingUsage||0,
      knownCostUsd:row.knownCostUsd===null?null:Number(row.knownCostUsd.toFixed(6)),unknownCostCalls:row.unknownCostCalls||0,
      meanLatencyMs:row.meanLatencyMs===null?null:Math.round(row.meanLatencyMs),
      p95LatencyMs:latencies.length?latencies[Math.ceil(latencies.length*0.95)-1]:null,p95SampleSize:latencies.length,
      byModel:grouped,byRun:byRun.map(r=>({...r,alertKnownCostAboveThreshold:Number.isFinite(warn)&&warn>0&&r.knownCostUsd!==null&&r.knownCostUsd>=warn})),
      costCaveat:'Configured USD prices are operator supplied. Null usage or pricing means TOTAL cost is unknown. Codex CLI/DEMO may not expose token usage.'};
  }
  claimJob(ttlMs=120000){return this.tx(()=>{
    const now=Date.now();
    // Expired attempts must never be claimed indefinitely, including after crash.
    const exhausted=this.db.prepare("SELECT * FROM workflow_jobs WHERE state='RUNNING' AND lease_until<=? AND attempts>=max_attempts").all(now);
    for(const j of exhausted){
      const owner=this.db.prepare('SELECT token,expires_at FROM project_leases WHERE project_id=?').get(j.project_id);
      if(owner&&owner.expires_at>now)continue;
      this.db.prepare("UPDATE workflow_jobs SET state='DEAD_LETTER',lease_token=NULL,lease_until=NULL,last_error='Retry budget exhausted after executor crash',updated_at=? WHERE id=? AND state='RUNNING'").run(new Date().toISOString(),j.id);
      if(owner?.token===j.lease_token)this.db.prepare('DELETE FROM project_leases WHERE project_id=? AND token=?').run(j.project_id,j.lease_token);
      this.writeAudit(j.project_id,'JOB_DEAD_LETTER','worker',{jobId:j.id,attempts:j.attempts,reason:'expired lease, exhausted budget'});
    }
    const candidates=this.db.prepare("SELECT * FROM workflow_jobs WHERE (state IN ('QUEUED','RETRY_WAIT') AND available_at<=?) OR (state='RUNNING' AND lease_until<=?) ORDER BY created_at LIMIT 20").all(now,now);
    for(const row of candidates){
      const lock=this.db.prepare('SELECT * FROM project_leases WHERE project_id=? AND expires_at>?').get(row.project_id,now);
      if(lock)continue;
      const token=`${process.pid}:${randomUUID()}`,expire=now+ttlMs;
      this.db.prepare('INSERT INTO project_leases(project_id,token,expires_at) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at').run(row.project_id,token,expire);
      this.db.prepare("UPDATE workflow_jobs SET state='RUNNING',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?").run(token,expire,new Date().toISOString(),row.id);
      this.writeAudit(row.project_id,'JOB_LEASED','worker',{jobId:row.id,attempt:row.attempts+1,stolen:row.state==='RUNNING'});
      return {...this.job(row.id,{internal:true}),token};
    }
    return null;
  })}
  renewJob(id,token,ttlMs=120000){return this.tx(()=>{
    const row=this.db.prepare('SELECT project_id FROM workflow_jobs WHERE id=? AND state=? AND lease_token=?').get(id,'RUNNING',token);if(!row)return false;
    if(!this.renewLease(row.project_id,token,ttlMs))return false;
    this.db.prepare('UPDATE workflow_jobs SET lease_until=? WHERE id=? AND lease_token=?').run(Date.now()+ttlMs,id,token);return true;
  })}
  finishJob(id,token,{error,resultVersion,retryable=true}={}){return this.tx(()=>{
    const row=this.db.prepare("SELECT * FROM workflow_jobs WHERE id=? AND state='RUNNING' AND lease_token=?").get(id,token);
    if(!row)throw err('Stale worker cannot complete job',409);
    const lock=this.db.prepare('SELECT * FROM project_leases WHERE project_id=?').get(row.project_id);
    if(!lock||lock.token!==token||lock.expires_at<=Date.now())throw err('Stale job lease cannot finalize',409);
    const retry=!!error&&retryable&&row.attempts<row.max_attempts;
    const state=!error?'SUCCEEDED':retry?'RETRY_WAIT':'DEAD_LETTER';
    const backoff=Math.min(60000,1000*2**(row.attempts-1));
    this.db.prepare('UPDATE workflow_jobs SET state=?,lease_token=NULL,lease_until=NULL,available_at=?,last_error=?,result_version=?,updated_at=? WHERE id=?').run(state,Date.now()+(retry?backoff:0),error?String(error).slice(0,300):null,resultVersion??null,new Date().toISOString(),id);
    if(!retry&&JSON.parse(row.options).kind==='figma-design'){const options=JSON.parse(row.options);delete options.channelId;this.db.prepare('UPDATE workflow_jobs SET options=? WHERE id=?').run(JSON.stringify(options),id)}
    this.db.prepare('DELETE FROM project_leases WHERE project_id=? AND token=?').run(row.project_id,token);
    this.writeAudit(row.project_id,'JOB_'+state,'worker',{jobId:id,attempts:row.attempts,resultVersion,error:error?String(error).slice(0,120):null});return state;
  })}
  issueReadbackChallenge({projectId,runId,documentKey,manifestDigest,screens}){
    const nonce=randomUUID(),createdAt=new Date().toISOString(),expiresAt=new Date(Date.now()+300000).toISOString();
    const challenge={nonce,projectId,runId,documentKey,manifestDigest,screens,createdAt,expiresAt};
    this.tx(()=>{
      this.db.prepare('INSERT INTO figma_challenges(nonce,project_id,run_id,document_key,manifest_digest,payload,expires_at) VALUES(?,?,?,?,?,?,?)').run(nonce,projectId,runId,documentKey,manifestDigest,JSON.stringify(challenge),new Date(expiresAt).getTime());
      this.writeAudit(projectId,'FIGMA_READBACK_CHALLENGE','system',{nonce,runId,documentKey,manifestDigest});
    });return challenge;
  }
  getReadbackChallenge(nonce){const row=this.db.prepare('SELECT * FROM figma_challenges WHERE nonce=?').get(nonce);if(!row)throw err('Unknown readback challenge',404);return {...JSON.parse(row.payload),usedAt:row.used_at}}
  consumeReadbackChallenge(nonce,projectId){this.tx(()=>{
    const result=this.db.prepare('UPDATE figma_challenges SET used_at=? WHERE nonce=? AND project_id=? AND used_at IS NULL AND expires_at>?').run(new Date().toISOString(),nonce,projectId,Date.now());
    if(result.changes!==1)throw err('Readback challenge already consumed or expired',409);
  })}
  audit(projectId,{limit=100}={}){return this.db.prepare('SELECT seq,event_type,actor_id,details,prev_hash,event_hash,created_at FROM audit_events WHERE project_id=? ORDER BY seq DESC LIMIT ?').all(projectId,Math.max(1,Math.min(limit,500))).map(x=>({...x,details:JSON.parse(x.details)}))}
  verifyAudit(projectId){const rows=this.db.prepare('SELECT * FROM audit_events WHERE project_id=? ORDER BY seq').all(projectId);let prev='GENESIS';for(const row of rows){const value=sha(JSON.stringify({projectId,eventType:row.event_type,actorId:row.actor_id,serialized:row.details,prev,createdAt:row.created_at}));if(row.prev_hash!==prev||row.event_hash!==value)return {valid:false,atSeq:row.seq};prev=value}return {valid:true,count:rows.length,tipHash:prev}}
  auditAction(projectId,type,actorId,details){return this.tx(()=>this.writeAudit(projectId,type,actorId,details))}
}
