import {renderERPDesign} from './erp-solution-design.js';
import {erpFitGapReport} from './erp-intelligence.js';
/** Multi-project filesystem projections and evidence inbox for BA Studio v3.6.
 * The shared SQLite database remains authoritative for projects, jobs and audit.
 * Workspace files are scoped by immutable UUID; no customer-provided path becomes a directory.
 */
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {renderBRD,renderSRS,renderPRD,renderQuestionnaire,renderERPDiscovery,renderERPSolutionComparison} from './docs.js';
import {renderStandalone} from './export.js';
import {buildCanonicalPackage} from './ba-canonical.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const folders=['00-admin','01-customer-input','02-requirements','03-prototypes','04-figma','05-workflow','06-reviews','07-results','08-sessions','09-archive'];
const digest=b=>createHash('sha256').update(b).digest('hex');
const err=(message,status=400)=>Object.assign(new Error(message),{status});
export const requireProjectId=id=>{if(!uuid.test(id||''))throw err('Invalid project UUID');return id.toLowerCase()};
export const projectDirectory=(dataDir,id)=>path.join(path.resolve(dataDir),'projects',requireProjectId(id));
export const figmaRegistryDirectory=(dataDir,id)=>path.join(projectDirectory(dataDir,id),'04-figma','registry');
export const workflowArtifactDirectory=(dataDir,id,runId)=>{
  if(!uuid.test(runId||''))throw err('Invalid workflow run UUID');
  return path.join(projectDirectory(dataDir,id),'05-workflow','runs',runId);
};

async function safeDirectory(directory,root){
  // Reject user-inserted symlinks for all directories below DATA_DIR.
  const relative=path.relative(path.resolve(root),directory);
  if(relative.startsWith('..')||path.isAbsolute(relative))throw err('Path escapes data directory');
  let current=path.resolve(root);
  await fs.mkdir(current,{recursive:true,mode:0o700});
  for(const segment of relative.split(path.sep).filter(Boolean)){
    current=path.join(current,segment);
    try{await fs.mkdir(current,{mode:0o700})}catch(e){if(e.code!=='EEXIST')throw e}
    const st=await fs.lstat(current);
    if(!st.isDirectory()||st.isSymbolicLink())throw err('Workspace path is not a physical directory',409);
  }
}
async function atomic(file,content){
  const temp=file+'.'+randomUUID()+'.tmp';
  try{await fs.writeFile(temp,content,{flag:'wx',mode:0o600});await fs.rename(temp,file)}
  finally{await fs.rm(temp,{force:true}).catch(()=>{})}
}
export class ProjectWorkspaces{
  constructor(store,{dataDir=store.dir}={}){
    this.store=store;this.dir=path.resolve(dataDir);
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS project_documents(
      id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),category TEXT NOT NULL,
      filename TEXT NOT NULL,relative_path TEXT NOT NULL,sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,created_at TEXT NOT NULL,actor_id TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_project_documents ON project_documents(project_id,created_at);
      INSERT OR IGNORE INTO schema_migrations(version,applied_at) VALUES(6,datetime('now'));`);
  }
  root(id){return projectDirectory(this.dir,id)}
  async ensure(id){
    this.store.get(requireProjectId(id)); // never materialize a non-existent project
    const root=this.root(id);
    for(const sub of folders)await safeDirectory(path.join(root,sub),this.dir);
    await safeDirectory(path.join(root,'01-customer-input','attachments'),this.dir);
    await safeDirectory(path.join(root,'04-figma','registry'),this.dir);
    await safeDirectory(path.join(root,'05-workflow','runs'),this.dir);
    return root;
  }
  async exportProject(p){
    const root=await this.ensure(p.id);
    const put=async(sub,name,content)=>atomic(path.join(root,sub,name),content);
    const metadata={projectId:p.id,title:p.title,version:p.version,status:p.status,updatedAt:p.updatedAt,
      workflow:{runId:p.workflow?.runId||null,stage:p.workflow?.stage||'NOT_STARTED',state:p.workflow?.state||'NOT_STARTED',checkpoints:p.workflow?.checkpoints||[]},
      review:{approved:!!p.review?.approved,reviewedAt:p.review?.reviewedAt||null},clarifications:{requirementsRefreshPending:!!p.requirementsRefreshPending,proposals:(p.clarificationRecommendations||[]).length,decisions:(p.clarificationDecisions||[]).length,unresolved:(p.analysis?.clarificationQuestions||[]).filter(q=>q.status!=='resolved').length},sourceOfTruth:'shared SQLite / projects table',projection:true};
    await put('00-admin','TECH_STACK.json',JSON.stringify(p.techStack||null,null,2)+'\n');
    await put('00-admin','ERP_SOLUTION_PROFILE.json',JSON.stringify(p.solutionProfile||null,null,2)+'\n');
    await put('02-requirements','ERP_FIT_GAP.json',JSON.stringify(erpFitGapReport(p),null,2)+'\n');
    if(p.solutionProfile?.domain==='erp'){
      await put('00-admin','ERP_TARGET.json',JSON.stringify(p.erpTarget||null,null,2)+'\n');
      await put('02-requirements','ERP_SOLUTION_DESIGN.json',JSON.stringify(p.erpSolutionDesign||null,null,2)+'\n');
      await put('02-requirements','ERP_SOLUTION_DESIGN.md',renderERPDesign(p));
      await put('02-requirements','ERP_DISCOVERY.md',renderERPDiscovery(p));
      await put('02-requirements','ERP_SOLUTION_COMPARISON.md',renderERPSolutionComparison(p));
    }else{
      for(const file of ['00-admin/ERP_TARGET.json','02-requirements/ERP_SOLUTION_DESIGN.json','02-requirements/ERP_SOLUTION_DESIGN.md'])await fs.rm(path.join(root,file),{force:true});
      await fs.rm(path.join(root,'02-requirements','ERP_DISCOVERY.md'),{force:true});
      await fs.rm(path.join(root,'02-requirements','ERP_SOLUTION_COMPARISON.md'),{force:true});
    }
    await put('00-admin','PROJECT.json',JSON.stringify({id:p.id,title:p.title,createdAt:p.createdAt,version:p.version},null,2)+'\n');
    await put('01-customer-input','CUSTOMER_BRIEF.md',`# Customer brief — ${p.title}\n\n${p.brief||''}\n`);
    await put('05-workflow','PROJECT_STATE.json',JSON.stringify(metadata,null,2)+'\n');
    await put('05-workflow','JOB_STATUS.json',JSON.stringify({projectId:p.id,jobs:this.store.jobs(p.id)},null,2)+'\n');
    await put('05-workflow','AUDIT_STATUS.json',JSON.stringify({projectId:p.id,integrity:this.store.verifyAudit(p.id),recentEvents:this.store.audit(p.id,{limit:100})},null,2)+'\n');
    await put('07-results','QUALITY_HISTORY.json',JSON.stringify({projectId:p.id,qualitySnapshots:this.store.qualityHistory(p.id)},null,2)+'\n');
    await put('07-results','AI_USAGE.json',JSON.stringify(this.store.aiMetrics(p.id),null,2)+'\n');
    if(p.analysis){
      await put('02-requirements','PRD.md',renderPRD(p));
      await put('02-requirements','BRD.md',renderBRD(p));
      await put('02-requirements','SRS.md',renderSRS(p));
      await put('02-requirements','canonical.json',JSON.stringify(buildCanonicalPackage(p),null,2)+'\n');
      await put('02-requirements','clarification-questions.md',renderQuestionnaire(p));
      await put('02-requirements','clarification-recommendations.json',JSON.stringify({projectId:p.id,techStack:p.techStack||null,proposals:p.clarificationRecommendations||[],decisions:p.clarificationDecisions||[]},null,2)+'\n');
    }else{
      for(const name of ['PRD.md','BRD.md','SRS.md','canonical.json','clarification-questions.md','clarification-recommendations.json'])await fs.rm(path.join(root,'02-requirements',name),{force:true});
    }
    if(p.prototype)await put('03-prototypes','prototype.html',renderStandalone(p));
    else await fs.rm(path.join(root,'03-prototypes','prototype.html'),{force:true});
    if(p.review)await put('06-reviews','BA_REVIEW.json',JSON.stringify(p.review,null,2)+'\n');
    else await fs.rm(path.join(root,'06-reviews','BA_REVIEW.json'),{force:true});
    // An immutable release snapshot per project version. These are projections;
    // complete historical project records and audit are still retained in SQLite.
    const historical=path.join(root,'09-archive',`v${String(p.version).padStart(6,'0')}`);
    await safeDirectory(historical,this.dir);
    const snapshot=path.join(historical,'state.json');
    try{await fs.writeFile(snapshot,JSON.stringify(metadata,null,2)+'\n',{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}
    if(p.analysis)for(const [name,content] of [['PRD.md',renderPRD(p)],['BRD.md',renderBRD(p)],['SRS.md',renderSRS(p)]]){
      try{await fs.writeFile(path.join(historical,name),content,{flag:'wx',mode:0o600})}catch(e){if(e.code!=='EEXIST')throw e}
    }
    return {directory:root,projectId:p.id,version:p.version};
  }
  async migrateLegacy(id){
    const root=await this.ensure(id),oldRoot=path.join(this.dir,'.figma-registry',id);
    let entries=[];try{entries=await fs.readdir(oldRoot,{withFileTypes:true})}catch(e){if(e.code!=='ENOENT')throw e}
    for(const e of entries){
      if(!e.isFile()||!/^[-\w]{3,128}\.json$/.test(e.name))continue;
      const from=path.join(oldRoot,e.name),target=path.join(root,'04-figma','registry',e.name);
      // Copy only: the original is kept for rollback. Never overwrite new registry revisions.
      try{await fs.copyFile(from,target,fs.constants.COPYFILE_EXCL)}catch(e){if(e.code!=='EEXIST')throw e}
    }
    const oldRuns=path.join(this.dir,'.workflow-artifacts',id);
    let runs=[];try{runs=await fs.readdir(oldRuns,{withFileTypes:true})}catch(e){if(e.code!=='ENOENT')throw e}
    for(const run of runs){
      if(!run.isDirectory()||!uuid.test(run.name))continue;
      const from=path.join(oldRuns,run.name),to=path.join(root,'05-workflow','runs',run.name);
      await safeDirectory(to,this.dir);
      // Only copy regular files and folders; skip unknown/symlinked legacy entries.
      for(const file of await fs.readdir(from,{withFileTypes:true})){
        if(!file.isFile()||!/^[-\w.]{1,150}$/.test(file.name))continue;
        try{await fs.copyFile(path.join(from,file.name),path.join(to,file.name),fs.constants.COPYFILE_EXCL)}catch(e){if(e.code!=='EEXIST')throw e}
      }
    }
    return this.exportProject(this.store.get(id));
  }
  async migrateAll(){const results=[];for(const item of this.store.list())results.push(await this.migrateLegacy(item.id));return results}
  list(id){this.store.get(requireProjectId(id));return this.store.db.prepare('SELECT id,category,filename,sha256,size_bytes,created_at,actor_id FROM project_documents WHERE project_id=? ORDER BY created_at DESC').all(id)}
  async addDocument(id,{category,filename,content,encoding,actorId='local-operator'}={}){
    const root=await this.ensure(id);
    if(!['customer','reference','approval'].includes(category))throw err('Invalid category: customer|reference|approval');
    if(typeof filename!=='string'||! /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,119}\.(md|txt|json|csv|pdf|doc|docx|xls|xlsx|png|jpg|jpeg|webp)$/iu.test(filename)||filename.includes('..'))throw err('Unsafe filename or unsupported file type');
    const binary=!/\.(md|txt|json|csv)$/i.test(filename);
    if(binary&&encoding!=='base64')throw err('Binary attachments require base64 encoding');
    if(encoding!==undefined&&encoding!=='base64')throw err('Unsupported encoding');
    if(typeof content!=='string'||!content.trim())throw err('Content required');
    const maxBytes=encoding==='base64'?5*1024*1024:300000;
    if(content.length>(encoding==='base64'?Math.ceil(maxBytes/3)*4:maxBytes))throw err(encoding==='base64'?'Attachment exceeds 5 MB':'Content exceeds 300KB');
    if(encoding==='base64'&&(content.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(content)||Buffer.from(content,'base64').toString('base64')!==content))throw err('Invalid base64 content');
    const bytes=Buffer.from(content,encoding==='base64'?'base64':'utf8');
    if(!bytes.length||bytes.length>maxBytes)throw err(encoding==='base64'?'Attachment exceeds 5 MB':'Content required (up to 300KB)');
    if(typeof actorId!=='string'||!/^[a-zA-Z0-9_.@-]{3,100}$/.test(actorId))throw err('Invalid actor ID');
    const fileId=randomUUID(),sub=category==='customer'?'01-customer-input':category==='reference'?'02-requirements':'06-reviews';
    const base=category==='reference'?'references':'attachments';
    await safeDirectory(path.join(root,sub,base),this.dir);
    const relativePath=path.posix.join(sub,base,fileId+'-'+filename);
    const absolute=path.join(root,...relativePath.split('/'));
    const sha256=digest(bytes),at=new Date().toISOString();
    // Write once using a random immutable basename; committed registry entry is the reference.
    await fs.writeFile(absolute,bytes,{flag:'wx',mode:0o600});
    try{
      this.store.tx(()=>{
        this.store.db.prepare('INSERT INTO project_documents(id,project_id,category,filename,relative_path,sha256,size_bytes,created_at,actor_id) VALUES(?,?,?,?,?,?,?,?,?)').run(fileId,id,category,filename,relativePath,sha256,bytes.length,at,actorId);
        this.store.writeAudit(id,'PROJECT_DOCUMENT_ADDED',actorId,{fileId,filename,category,sha256});
      });
    }catch(e){await fs.rm(absolute,{force:true}).catch(()=>{});throw e}
    return {id:fileId,projectId:id,category,filename,sha256,sizeBytes:bytes.length,createdAt:at};
  }
  async readDocument(id,documentId){
    this.store.get(requireProjectId(id));
    if(!uuid.test(documentId||''))throw err('Invalid document UUID');
    const row=this.store.db.prepare('SELECT * FROM project_documents WHERE id=? AND project_id=?').get(documentId,id);
    if(!row)throw err('Document not found for project',404);
    const parts=row.relative_path.split('/');
    if(parts.some(x=>!x||x==='.'||x==='..'))throw err('Unsafe document registry',409);
    const directory=path.join(this.root(id),...parts.slice(0,-1));
    await safeDirectory(directory,this.dir);
    const absolute=path.join(directory,parts.at(-1));
    const st=await fs.lstat(absolute);
    if(!st.isFile()||st.isSymbolicLink())throw err('Unsafe document file',409);
    const bytes=await fs.readFile(absolute);
    if(bytes.length!==row.size_bytes||digest(bytes)!==row.sha256)throw err('Document evidence checksum mismatch',409);
    const binary=!/\.(md|txt|json|csv)$/i.test(row.filename)||!Buffer.from(bytes.toString('utf8')).equals(bytes);
    return {id:row.id,filename:row.filename,category:row.category,sha256:row.sha256,...(binary?{encoding:'base64'}:{}),content:bytes.toString(binary?'base64':'utf8')};
  }
}
