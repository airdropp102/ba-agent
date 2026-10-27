import {figmaAssetPluginZip} from './figma-asset-plugin-package.js';
import {DesignAssetStore,resolveDesignAssets} from './design-assets.js';
import {createFigmaAssetImporter} from './figma-assets.js';
import {normalizeDesignDirection,saveDesignDirection,referenceBytes} from './design-direction.js';
import {currentERPTarget,currentERPDesign,confirmERPTarget,erpDesignInput,acceptERPDesign,reviewERPDesign,invalidateERPDesign,renderERPDesign} from './erp-solution-design.js';
import {codexTimeoutMs,runCodexStructured} from './codex-provider.js';
import {withExecutionContext,logExecution} from './execution-log.js';
import {extractRequirementFile,extractRequirementFiles} from './requirement-file.js';
import {applyClarificationBatch} from './clarification-batch.js';
import http from 'node:http';
import fs from 'node:fs/promises';
import {readFileSync, existsSync} from 'node:fs';
import {ProductionStore} from './production-store.js';
import {ProjectWorkspaces,figmaRegistryDirectory} from './project-workspaces.js';
import {withAIContext,setTelemetrySink} from './ai-telemetry.js';
import {assessDeliverables,qualityPolicy} from './quality-intelligence.js';
import {validateReadback} from './figma-readback.js';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {analyze,generatePrototype,brainstorm,recommendClarifications,generateERPSolution,provider,checkProvider} from './ai-provider.js';
import {mergeStableIds,buildSources,applyEvidenceTrust,fingerprint} from './revisions.js';
import {timingSafeEqual,createHash} from 'node:crypto';
import {normalizeAnalysis,normalizePrototype} from './normalize.js';
import {prepareBAAnalysis} from './ba-quality.js';
import {buildCanonicalPackage} from './ba-canonical.js';
import {renderBRD,renderSRS,renderPRD,renderQuestionnaire,DOCUMENT_RENDERERS} from './docs.js';
import {getDocumentTemplate,DOCUMENT_TEMPLATES} from './standard-documents.js';
import {renderStandalone} from './export.js';
import {buildFigmaHandoff} from './figma-handoff.js';
import {buildPublishPlan} from './figma-registry.js';
import {createFigmaRelayManager} from './figma-relay.js';
import {parseFigmaDesignInput,beginFigmaDesign,completeFigmaDesign,reviewFigmaDesign,recordFigmaFileConfirmation} from './figma-design-review.js';
import {publishFigmaDesign,buildFigmaDesignPlan,FIGMA_DESIGN_FAILURE_CODES} from './figma-publisher.js';
import {FigmaPreviewStore} from './figma-preview-store.js';
import {exportFigmaPreview} from './figma-preview-export.js';
import {normalizeTechStack,createRecommendations,recordDecision,validDecision,techStackDigest,availableSolutionReferences} from './clarification-recommendations.js';
import {ERP_CATALOG,ERP_PROCESSES,normalizeSolutionProfile,erpFitGapReport,recordERPFitGap,erpSolutionComparison} from './erp-intelligence.js';
import {ensureWorkflow,unresolvedHigh,hasCurrentWaiver,acceptClarificationRisk,invalidateAfterAnalysis,checkpoint,nextStage,qualitySnapshot,hasActiveWorkflow} from './intelligent-workflow.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if (existsSync(path.join(root,'.env'))) {
  const lines=readFileSync(path.join(root,'.env'),'utf8').split(/\r?\n/);
  for(const line of lines){const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m && process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
}
const dataDir=path.resolve(process.env.DATA_DIR || path.join(root,'data'));
const publicDir=path.join(root,'public');
await fs.mkdir(dataDir,{recursive:true,mode:0o700});
const store=new ProductionStore(dataDir);
const workspaces=new ProjectWorkspaces(store);
const figmaPreviews=new FigmaPreviewStore(store,{dataDir});
const designAssets=new DesignAssetStore(store);
const figmaRelay=createFigmaRelayManager({bunExecutable:process.env.BUN_BIN||'bun',relayEntry:path.join(root,'vendor/talk-to-figma-relay/socket.ts'),host:process.env.FIGMA_RELAY_HOST||'127.0.0.1',port:Number(process.env.FIGMA_RELAY_PORT||3055)});
setTelemetrySink(event=>store.recordAIUsage(event));
const qualitySettings=qualityPolicy();
await store.importLegacy();
await workspaces.migrateAll();
store.recoverAbandoned();
const mode=checkProvider();
const demo=mode==='demo';
const host=process.env.HOST||'127.0.0.1';
const publicBind=!['127.0.0.1','localhost','::1'].includes(host);
const token=process.env.BA_STUDIO_TOKEN||'';
if (publicBind && token.length<32)throw new Error('Public HOST requires BA_STUDIO_TOKEN at least 32 characters. Local-first security gate.');
const validToken=(provided)=>{const a=createHash('sha256').update(provided||'').digest(),b=createHash('sha256').update(token).digest();return timingSafeEqual(a,b) && Boolean(provided)};
const isId = s => /^[0-9a-f-]{36}$/i.test(s);
const registryPath=(id,key,platform='web')=>{
  const scoped=path.join(figmaRegistryDirectory(dataDir,id,platform),`${key}.json`);
  if(platform!=='web')return scoped;
  return existsSync(scoped)?scoped:path.join(dataDir,'.figma-registry',id,`${key}.json`);
};
const safeGet=async(id,leaseToken)=>{if(!isId(id))throw Object.assign(new Error('ID không hợp lệ'),{status:400});return store.get(id,{leaseToken});};
function auditAs(p,actor,event,details={}){
  Object.defineProperty(p,'_auditActor',{value:actor,configurable:true,enumerable:false});
  Object.defineProperty(p,'_auditEvent',{value:event,configurable:true,enumerable:false});
  Object.defineProperty(p,'_auditDetails',{value:details,configurable:true,enumerable:false});
}
const save=async (p,options={})=>{
  invalidateERPDesign(p);
  logExecution('DB_SAVE_START',{projectId:p.id,stage:p.workflow?.stage,version:p.version});
  store.save(p,{actorId:p._auditActor||'system',eventType:p._auditEvent||'PROJECT_COMMITTED',details:p._auditDetails||{stage:p.workflow?.stage,state:p.workflow?.state},...(p.analysis?{qualityReport:assessDeliverables(p,{policy:qualitySettings})}:{}),...options});
  logExecution('DB_SAVE_COMPLETE',{projectId:p.id,stage:p.workflow?.stage,version:p.version});
  delete p._auditActor;delete p._auditEvent;delete p._auditDetails;
  // Read-only projection for v3.2 CLI, never used as the canonical state after migration.
  await workspaces.exportProject(p).catch(e=>console.error('[BA Studio] Workspace projection failed:',e.message));
};
const archive=async()=>{}; // Project snapshots are atomically persisted in SQLite with each save.
const reviewerTokens=(()=>{try{return JSON.parse(process.env.BA_REVIEWER_TOKENS_JSON||'{}')}catch{throw Error('Invalid BA_REVIEWER_TOKENS_JSON')}})();
const identityRequired=process.env.REQUIRE_REVIEWER_IDENTITY==='true'||publicBind;
// Preserve v3.2 remote API compatibility; reviewer-only endpoints fail closed if no token is configured.
// Identity is enforced at protected endpoints; status remains available to diagnose misconfiguration.
function reviewerId(req){
  const supplied=String(req.headers['x-ba-reviewer-token']||'');
  for(const [actor,key] of Object.entries(reviewerTokens)){
    if(!/^[a-zA-Z0-9_.@-]{3,100}$/.test(actor)||typeof key!=='string'||key.length<32)continue;
    const a=createHash('sha256').update(supplied).digest(),b=createHash('sha256').update(key).digest();
    if(supplied&&timingSafeEqual(a,b))return actor;
  }
  if(identityRequired)throw Object.assign(new Error('Authenticated reviewer token required'),{status:401});
  return 'local-operator-unauthenticated';
}
async function resolveAnswerAttachments(projectId,entry){
 if(!entry||typeof entry!=='object'||Array.isArray(entry))throw Object.assign(new Error('Invalid answer entry'),{status:400});
 const ids=entry.attachmentIds||[];
 if(!Array.isArray(ids)||ids.length>10||new Set(ids).size!==ids.length)throw Object.assign(new Error('Invalid attachment IDs (up to 10 unique files)'),{status:400});
 const docs=[];for(const id of ids)docs.push(await workspaces.readDocument(projectId,id));
 const reference=docs.length?'Project attachments: '+docs.map(d=>d.id).join(', '):null;
 return {...entry,attachments:docs.map(d=>({id:d.id,filename:d.filename,sha256:d.sha256})),...(reference&&!entry.sourceReference?{sourceReference:reference.slice(0,300)}:{}),...(entry.approverRole==='customer'&&reference&&!entry.rationale?{rationale:'Customer-attested option selection with attached documentation.'}:{})};
}
async function newAnalysis(p,sourceText) {
 return withExecutionContext({projectId:p.id,runId:p.workflow?.runId,stage:'ELICITATION',executionId:randomUUID()},async()=>{
  const started=Date.now();
  logExecution('ANALYSIS_INPUT',{briefChars:sourceText.length,sourceCount:p.sources?.length||0,sourceIds:(p.sources||[]).map(s=>s.id),answerCount:p.answers?.length||0,decisionCount:p.clarificationDecisions?.length||0,questionIds:(p.answers||[]).map(a=>a.questionId)});
  for(const d of p.clarificationDecisions||[])if(d.status==='APPROVED'&&d.briefDigest!==fingerprint(p.brief))d.status='STALE_BRIEF_CHANGED';
  const decisions=(p.clarificationDecisions||[]).filter(d=>d.status==='APPROVED'&&d.stackDigest===techStackDigest(p)&&d.briefDigest===fingerprint(p.brief));
  const augmented=sourceText+(decisions.length?'\n\n=== PREVIOUSLY AUTHORIZED DECISIONS (not necessarily customer sign-off; provenance retained separately) ===\n'+decisions.map(d=>`${d.questionId} [${d.approverRole} / ${d.sourceReference}]: ${d.answer}`).join('\n'):'');
  const raw=await withAIContext({projectId:p.id,runId:p.workflow?.runId||null,stage:'ELICITATION'},()=>analyze(p.title,augmented,p.solutionProfile||null));
  logExecution('ANALYSIS_NORMALIZE');
  const incoming=normalizeAnalysis(raw,augmented);
  logExecution('ANALYSIS_EVIDENCE_CHECK');
  const trusted=applyEvidenceTrust(incoming,p.sources||buildSources(p.brief));
  const base=mergeStableIds(trusted,p.analysis,p.nextIds||{}, {prefixes:['FR','NFR','BR']});
  const prepared=prepareBAAnalysis(base.analysis);
  const questions=mergeStableIds(prepared,p.analysis,base.nextIds,{prefixes:['Q']});
  p.nextIds=questions.nextIds;
  p.analysis=questions.analysis;
  const answered=new Set((p.answers||[]).filter(a=>!a.decisionId).map(a=>a.questionId));
  p.analysis.clarificationQuestions=p.analysis.clarificationQuestions.map(q=>{const accepted=validDecision(p,q);return {...q,status:accepted?'resolved':answered.has(q.id)?'answered-pending-ba-review':'open',...(accepted?{resolutionId:accepted.id}:{})};});
  p.clarificationRecommendations=[];p.requirementsRefreshPending=false;
  p.changeLog=[...(p.changeLog||[]),{at:new Date().toISOString(),fromVersion:p.version,changes:[...base.changes,...questions.changes]}].slice(-100);
  p.review=null;p.previousPrototype=p.prototype||p.previousPrototype||null;p.prototype=null;p.status='ANALYZED';p.version++;
  p.updatedAt=new Date().toISOString();
  logExecution('ANALYSIS_READY',{durationMs:Date.now()-started,frCount:p.analysis.functionalRequirements.length,nfrCount:p.analysis.nonFunctionalRequirements.length,brCount:p.analysis.businessRules.length,questionCount:p.analysis.clarificationQuestions.length});
 });
}

const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data,(key,value)=>['channelId','revisionNotes'].includes(key)?undefined:value))};
const error=(res,msg,status=400)=>json(res,{error:msg},status);
const readBody=async (req,limit=500_000)=>{let size=0;const buffers=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error(`Dữ liệu đầu vào vượt giới hạn ${Math.round(limit/1000)} KB`),{status:413});buffers.push(chunk)}try{return JSON.parse(Buffer.concat(buffers).toString('utf8'))}catch{throw Object.assign(new Error('JSON không hợp lệ'),{status:400})}};
const docsFilename={prd:'PRD.md',brd:'BRD.md',srs:'SRS.md',urd:'URD.md','use-cases':'USE_CASES.md','user-stories':'USER_STORIES.md',prototype:'prototype.html',json:'analysis.json',canonical:'canonical.json',questions:'clarification-questions.md',figma:'FIGMA_INSTRUCTIONS.md','figma-manifest':'figma-manifest.json'};
const sendDownload=(res,filename,content,type)=>{res.writeHead(200,{'Content-Type':type,'Content-Disposition':`attachment; filename="${filename}"`,'X-Content-Type-Options':'nosniff'});res.end(content)};

async function createPrototype(p){
  const proto=await withAIContext({projectId:p.id,runId:p.workflow?.runId||null,stage:'DELIVERABLES'},()=>generatePrototype(p.analysis,p.review));
  p.prototype=normalizePrototype(proto,p.analysis,{previous:p.prototype||p.previousPrototype,maxId:p.nextIds?.SCR||0});
  p.nextIds={...(p.nextIds||{}),SCR:Math.max(p.nextIds?.SCR||0,...p.prototype.screens.map(s=>Number(s.id.match(/^SCR-(\d+)$/)?.[1]||0)),0)};
  p.status='GENERATED';p.version++;p.updatedAt=new Date().toISOString();
}
async function setWorkflowState(p,state){
  const wf=ensureWorkflow(p);
  if(wf.state===state)return;
  await archive(p);wf.state=state;wf.updatedAt=new Date().toISOString();p.version++;p.updatedAt=wf.updatedAt;await save(p);
}
/** Runs one step at a time with durable 'RUNNING' + checkpoint writes. An interrupted
 * step can be explicitly resumed; no background execution or remote publish occurs. */
async function advanceWorkflow(p,{auto=true,platform}={}){
  const wf=ensureWorkflow(p);
  if(platform!==undefined){
    if(!['web','mobile'].includes(platform))throw Object.assign(new Error('platform must be web or mobile'),{status:400});
    if(wf.platform!==platform){
      if(wf.checkpoints?.length||wf.currentAttempt)throw Object.assign(new Error('Design platform locked after workflow begins; restart workflow to change it'),{status:409});
      wf.platform=platform;
    }
  }
  for(let i=0;i<(auto?8:1);i++){
    if(wf.stage==='DELIVERABLES'&&wf.state!=='COMPLETED'&&p.solutionProfile?.domain==='erp'&&currentERPDesign(p)?.status!=='APPROVED')wf.stage='ERP_SOLUTION_DESIGN';
    const stage=wf.stage;
    // Historical manual Figma runs remain readable; design now runs from Prototype.
    if(wf.state==='COMPLETED'||['FIGMA_DESIGN','FIGMA_PUBLISH'].includes(stage))return p;
    if(stage==='CLARIFICATION' && unresolvedHigh(p).length && !hasCurrentWaiver(p)){
      await setWorkflowState(p,'WAITING_CLARIFICATION');return p;
    }
    if(stage==='BA_REVIEW' && !p.review?.approved){
      await setWorkflowState(p,'WAITING_BA_REVIEW');return p;
    }
    if(stage==='ERP_SOLUTION_DESIGN'){
      if(!p.review?.approved||p.requirementsRefreshPending){await setWorkflowState(p,'WAITING_BA_REVIEW');return p;}
      if(!currentERPTarget(p)){await setWorkflowState(p,'WAITING_ERP_TARGET');return p;}
      if(currentERPDesign(p)?.status==='WAITING_FOR_REVIEW'){await setWorkflowState(p,'WAITING_ERP_DESIGN_REVIEW');return p;}
    }
    if(stage==='DELIVERABLES' && !p.analysis?.functionalRequirements?.length){
      await setWorkflowState(p,'BLOCKED_NO_FUNCTIONAL_REQUIREMENTS');return p;
    }
    if(stage==='DELIVERABLES'&&qualitySettings.enforce){
      const quality=assessDeliverables(p,{policy:qualitySettings});
      if(!quality.passed){
        wf.qualityGate={decision:quality.decision,score:quality.score,findings:quality.findings,inputDigest:quality.inputDigest,policy:quality.policy};
        await setWorkflowState(p,'WAITING_QUALITY_REVIEW');return p;
      }
    }
    logExecution('WORKFLOW_STAGE_START',{projectId:p.id,runId:wf.runId,stage});
    const attemptId=randomUUID();
    await archive(p);
    // A crashed executor may leave a RUNNING marker from an earlier lease.
    if(wf.currentAttempt){
      const abandoned=wf.attempts.find(x=>x.id===wf.currentAttempt.id && !x.result);
      if(abandoned){abandoned.result='ABANDONED';abandoned.finishedAt=new Date().toISOString();}
    }
    wf.state='RUNNING';wf.currentAttempt={id:attemptId,stage,startedAt:new Date().toISOString()};
    wf.attempts=[...(wf.attempts||[]),{...wf.currentAttempt}].slice(-80);
    p.version++;p.updatedAt=new Date().toISOString();await save(p);
    let details={};
    try{
      if(stage==='BRAINSTORM'){
        p.brainstorm=await withAIContext({projectId:p.id,runId:wf.runId,stage:'BRAINSTORM'},()=>brainstorm(p.title,p.brief));
        details={hypotheses:p.brainstorm.opportunities.length,questions:p.brainstorm.stakeholderQuestions.length};
      }else if(stage==='ELICITATION'){
        await newAnalysis(p,p.brief);
        details={functionalRequirements:p.analysis.functionalRequirements.length};
      }else if(stage==='GAP_ANALYSIS'){
        if(p.requirementsRefreshPending){
          await newAnalysis(p,p.brief);
          // Keep the validated refresh even if draft recommendation generation fails.
          // Retry must not discard stable IDs or send the same answers for analysis again.
          await save(p);
        }
        if(!p.analysis)throw new Error('Missing elicitation result');
        if(availableSolutionReferences(p).length){
          try{
            const raw=await withAIContext({projectId:p.id,runId:wf.runId,stage:'GAP_ANALYSIS'},()=>recommendClarifications(p));
            createRecommendations(p,raw,{provider:mode});
          }
          catch(cause){
            if(cause?.status===422||cause?.message==='Codex output schema validation failed.'||cause?.message?.startsWith('AI schema '))cause.code='INVALID_RECOMMENDATIONS';
            throw cause;
          }
        }
        p.workflow.gapReport={...qualitySnapshot(p),recommendations:(p.clarificationRecommendations||[]).length,techStackConfigured:availableSolutionReferences(p).length>0};details=p.workflow.gapReport;
      }else if(stage==='CLARIFICATION'){
        details={highUnresolved:unresolvedHigh(p).length,riskAccepted:hasCurrentWaiver(p)};
      }else if(stage==='BA_REVIEW'){
        if(!p.review?.approved)throw new Error('BA review is required');
        details={reviewedAt:p.review.reviewedAt,customerApproved:false};
      }else if(stage==='ERP_SOLUTION_DESIGN'){
        if(currentERPDesign(p)?.status!=='APPROVED'){
          const input=erpDesignInput(p);
          const raw=await withAIContext({projectId:p.id,runId:wf.runId,stage},()=>generateERPSolution(input));
          acceptERPDesign(p,raw);
        }
        details={designId:p.erpSolutionDesign.id,contentDigest:p.erpSolutionDesign.contentDigest,customerApproved:false};
      }else if(stage==='DELIVERABLES'){
        if(!p.review?.approved)throw new Error('BA review is required');
        if(!p.prototype)await createPrototype(p);
        details={screens:p.prototype.screens.length,quality:assessDeliverables(p,{policy:qualitySettings}).decision};
      }else throw new Error('Unknown workflow stage');
      await archive(p);
      const attempt=wf.attempts.find(x=>x.id===attemptId);if(attempt){attempt.result='SUCCEEDED';attempt.finishedAt=new Date().toISOString();}
      logExecution('WORKFLOW_STAGE_COMPLETE',{projectId:p.id,runId:wf.runId,stage});
      if(stage==='ERP_SOLUTION_DESIGN'&&currentERPDesign(p)?.status!=='APPROVED'){
        wf.currentAttempt=null;wf.lastError=null;wf.state='WAITING_ERP_DESIGN_REVIEW';wf.updatedAt=new Date().toISOString();p.version++;p.updatedAt=wf.updatedAt;await save(p);return p;
      }
      checkpoint(p,stage,details);
      wf.stage=stage==='DELIVERABLES'?stage:nextStage(stage,p);wf.state=stage==='DELIVERABLES'?'COMPLETED':'READY';
      wf.updatedAt=new Date().toISOString();p.version++;p.updatedAt=wf.updatedAt;await save(p);
      if(wf.state==='COMPLETED')return p;
    }catch(cause){
      logExecution('WORKFLOW_STAGE_ERROR',{projectId:p.id,runId:wf.runId,stage,errorCode:cause?.status===504?'PROVIDER_TIMEOUT':'STEP_FAILED'});
      console.error('[BA Workflow]',stage,cause?.message?.slice(0,200));
      // Re-read the durable RUNNING snapshot to avoid committing half-mutated objects.
      const persisted=await safeGet(p.id,p._leaseToken);
      await archive(persisted);
      const w=ensureWorkflow(persisted);w.state='FAILED';w.currentAttempt=null;
      const failedAttempt=w.attempts.find(x=>x.id===attemptId);if(failedAttempt){failedAttempt.result='FAILED';failedAttempt.finishedAt=new Date().toISOString();}
      const timedOut=cause?.status===504;
      const invalidRecommendations=cause?.code==='INVALID_RECOMMENDATIONS';
      const validationMessages=new Set(['Recommendation references unknown project technology','Each question requires 1-3 options',...['title','answer','benefits','tradeoffs','implementation'].map(key=>`Incomplete proposal ${key}`)]);
      const detail=invalidRecommendations&&validationMessages.has(cause.message)?cause.message:null;
      w.lastError={stage,code:timedOut?'PROVIDER_TIMEOUT':invalidRecommendations?'INVALID_RECOMMENDATIONS':'STEP_FAILED',message:timedOut?'Codex vượt thời gian chờ xử lý. Checkpoint đã được giữ; có thể thử lại qua queue.':invalidRecommendations?`Đề xuất AI không hợp lệ${detail?': '+detail:''}. Kết quả phân tích đã lưu được giữ lại; thử lại để tạo đề xuất mới.`:'Bước xử lý thất bại. Xem log máy chủ và thử lại qua queue.',at:new Date().toISOString()};
      persisted.version++;persisted.updatedAt=w.lastError.at;w.updatedAt=w.lastError.at;
      await save(persisted);
      throw Object.assign(new Error(`Workflow ${stage} failed. The checkpoint was retained; retry to resume.`),{status:502});
    }
  }
  return p;
}
const activeWrites=new Set();
async function handler(req,res){
  let activeWriteId=null,requestLease=null,requestHeartbeat=null;
  const url=new URL(req.url,'http://localhost');
  const segments=url.pathname.split('/').filter(Boolean);
  try {
    if(publicBind && url.pathname.startsWith('/api/')) {
      const supplied=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
      if(!validToken(supplied))return error(res,'Unauthorized (BA_STUDIO_TOKEN required)',401);
    }
    // Refuse cross-site state-changing requests, even on localhost.
    if(!['GET','HEAD','OPTIONS'].includes(req.method)){
      const origin=req.headers.origin;
      if(origin){let hostname;try{hostname=new URL(origin).hostname}catch{return error(res,'Invalid Origin',403)}
        const expected=String(req.headers.host||'').split(':')[0];
        if(hostname!==expected && !(hostname==='localhost'&&expected==='127.0.0.1'))return error(res,'Cross-origin mutation not permitted',403);
      }
      if(String(req.headers['content-type']||'').split(';')[0].trim()!=='application/json')return error(res,'Content-Type must be application/json',415);
    }
    if(req.method==='GET'&&url.pathname==='/api/status')return json(res,{demo,provider:mode,model:mode==='demo'?'demo':mode==='codex'?(process.env.CODEX_MODEL||'codex-cli'):process.env.OPENAI_MODEL||'gpt-4.1-mini',localOnly:!publicBind,engine:'sqlite-wal-v3.4',qualityPolicy:qualitySettings,durableJobs:true,progressLogging:process.env.BA_LOG_PROGRESS!=='false',...(mode==='codex'?{codexTimeoutMs:codexTimeoutMs(process.env.CODEX_TIMEOUT_MS)}:{})});
    if(req.method==='GET'&&url.pathname==='/api/figma/asset-plugin.zip'){const bytes=await figmaAssetPluginZip();res.writeHead(200,{'Content-Type':'application/zip','Content-Length':bytes.length,'Content-Disposition':'attachment; filename=ba-studio-talk-to-figma-assets.zip','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes)}
    if(url.pathname.startsWith('/api/figma/relay')){
      if(publicBind)return error(res,'Figma relay controls are available only on loopback BA Studio',403);
      if(req.method==='GET'&&url.pathname==='/api/figma/relay')return json(res,figmaRelay.status());
      if(req.method==='POST'&&url.pathname==='/api/figma/relay/start')return json(res,await figmaRelay.start(),figmaRelay.status().state==='READY'?200:503);
      if(req.method==='POST'&&url.pathname==='/api/figma/relay/stop')return json(res,await figmaRelay.stop());
    }
    if(req.method==='GET'&&url.pathname==='/api/metrics')return json(res,{...store.metrics(),ai:store.aiMetrics()});
    if(req.method==='GET'&&url.pathname==='/api/projects')return json(res,store.list());
    if(req.method==='GET'&&url.pathname==='/api/erp/catalog')return json(res,{platforms:ERP_CATALOG,processes:ERP_PROCESSES});
    if(req.method==='GET'&&segments[0]==='api'&&segments[1]==='document-templates'&&segments.length===3){
      const kind=segments[2].replace(/\.md$/,'');
      const content=getDocumentTemplate(kind);
      return sendDownload(res,DOCUMENT_TEMPLATES[kind].filename,content,'text/markdown; charset=utf-8');
    }
    if(req.method==='POST'&&url.pathname==='/api/requirements/preview'){
      const body=await readBody(req,7_100_000);
      return json(res,await extractRequirementFile(body));
    }
    if(req.method==='POST'&&url.pathname==='/api/projects'){
      const body=await readBody(req,29_000_000);const title=String(body.title||'').trim();const notes=String(body.brief||'').trim();
      if(title.length<3||title.length>160||notes.length>100000)return error(res,'Tên dự án từ 3–160 ký tự và yêu cầu tối đa 100.000 ký tự.');
      if(body.requirementFile!==undefined&&body.requirementFiles!==undefined)return error(res,'Chỉ dùng một danh sách tài liệu.',400);
      const uploads=body.requirementFiles!==undefined?body.requirementFiles:body.requirementFile!==undefined?[{...body.requirementFile,previewTextSha256:body.previewTextSha256}]:null;
      const files=uploads===null?[]:await extractRequirementFiles(uploads);
      const brief=[notes,...files.map(file=>`=== FILE: ${file.filename} ===\n${file.text}`)].filter(Boolean).join('\n\n');
      if(title.length<3||title.length>160||brief.length<15||brief.length>100000)return error(res,'Tên dự án từ 3–160 ký tự và yêu cầu từ 15–100.000 ký tự.');
      const techStack=body.techStack?normalizeTechStack(body.techStack):null;
      const solutionProfile=body.solutionProfile?normalizeSolutionProfile(body.solutionProfile):null;
      const now=new Date().toISOString();const p={id:randomUUID(),title,brief,techStack,solutionProfile,erpFitGap:[],clarificationRecommendations:[],clarificationDecisions:[],sources:buildSources(brief),nextIds:{},changeLog:[],status:'NEW',version:1,createdAt:now,updatedAt:now,demo,analysis:null,review:null,prototype:null};
      ensureWorkflow(p);
      if(files.length){
        p.sources=notes?buildSources(notes):[];
        const entries=files.map((file,index)=>{
          const sourceId=`SRC-${String(p.sources.length+1).padStart(3,'0')}`;
          p.sources.push({id:sourceId,type:'customer-brief',text:file.text,at:now,extractedTextSha256:file.textSha256,extractionWarnings:file.warnings});
          return {file:{...uploads[index],category:'customer',actorId:'local-operator'},sourceId};
        });
        await workspaces.createWithDocuments(p,entries);
        await workspaces.exportProject(p).catch(e=>console.error('[BA Studio] Workspace projection failed:',e.message));
        return json(res,p,201);
      }
      await save(p);return json(res,p,201);
    }
    if(segments[0]==='api'&&segments[1]==='projects'&&segments[2]){
      const projectId=segments[2];
      if(!isId(projectId))return error(res,'ID không hợp lệ',400);
      // Serialize before the first await/read: obtaining the lock after safeGet
      // permits a stale read to overwrite a completed concurrent write.
      if(req.method==='POST') {
        if(activeWrites.has(projectId))return error(res,'Project is already being modified. Retry after current operation finishes.',409);
        requestLease=store.acquireLease(projectId);
        activeWrites.add(projectId);activeWriteId=projectId;
        requestHeartbeat=setInterval(()=>{
          try{if(!store.renewLease(projectId,requestLease))console.error('[BA Studio] request lease lost',projectId)}
          catch(e){console.error('[BA Studio] lease renewal failed:',e.message)}
        },10000);requestHeartbeat.unref();
      }
      const p=await safeGet(projectId,requestLease);
      if(req.method==='POST') {
        const expected=req.headers['if-match'];
        if(expected!==undefined && String(expected).replace(/"/g,'')!==String(p.version))return error(res,'Version conflict. Reload project before editing.',409);
        if(process.env.REQUIRE_IF_MATCH==='true' && expected===undefined)return error(res,'If-Match version required for mutation.',428);
      }
      if(segments.length===3&&req.method==='GET')return json(res,p);
      if(segments[3]==='design-assets'&&segments.length===4&&req.method==='GET')return json(res,designAssets.list(p.id).filter(a=>a.directionDigest===p.designDirection?.digest));
      if(segments[3]==='design-assets'&&segments.length===5&&req.method==='GET'){
        const {asset,bytes}=await designAssets.read(p.id,segments[4]);res.writeHead(200,{'Content-Type':asset.contentType,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"});return res.end(bytes);
      }
      if(segments[3]==='design-direction'&&segments.length===4&&req.method==='POST'){
        const body=await readBody(req),actor=reviewerId(req);let next;
        try{const direction=await normalizeDesignDirection(p,body,(id,doc)=>workspaces.readDocument(id,doc));next=saveDesignDirection(p,direction,actor);if(direction.digest===p.designDirection?.digest&&JSON.stringify(direction.briefOptions)===JSON.stringify(p.designDirection?.briefOptions))return json(res,p)}catch(e){return error(res,e.message,400)}
        next.version++;if(next.figmaDesign?.draft)next.figmaDesign.draft.projectVersion=next.version;if(next.figmaDesign?.approved)next.figmaDesign.approved.projectVersion=next.version;next.updatedAt=new Date().toISOString();auditAs(next,actor,'DESIGN_DIRECTION_SAVED',{digest:next.designDirection.digest,referenceCount:next.designDirection.references.length,libraryCount:next.designDirection.library.length});store.attach(next,p._dbRevision,requestLease);await save(next);return json(res,next);
      }
      if(segments[3]==='figma-design'&&segments.length===4&&req.method==='GET'){
        const design=p.figmaDesign?structuredClone(p.figmaDesign):null;if(design){delete design.channelId;delete design.revisionNotes}
        const jobs=store.jobs(p.id).filter(j=>j.options?.kind==='figma-design');return json(res,{projectId:p.id,version:p.version,figmaDesign:design,job:jobs[0]||null});
      }
      if(segments[3]==='figma-design'&&segments.length===4&&req.method==='POST'){
        if(p.requirementsRefreshPending)return error(res,'Yêu cầu đã thay đổi; cần phân tích và review lại trước khi vẽ Figma.',409);
        if(p.review?.approved!==true||!p.prototype?.screens?.length)return error(res,'BA Review và prototype hiện tại là điều kiện bắt buộc trước khi vẽ Figma.',409);
        if(figmaRelay.status().state!=='READY')return error(res,'Hãy khởi chạy Figma relay và kết nối plugin trước khi tiếp tục.',409);
        const body=await readBody(req);let connection,revisionNotes='';
        if(p.designDirection&&body.visualInputsConfirmed!==true)return error(res,'Xác nhận cho phép sử dụng Design Brief và ảnh tham khảo cho lượt vẽ này.',400);
        const platform=body.platform!==undefined?body.platform:(p.figmaDesign?.platform||p.workflow?.platform||'web');
        if(!['web','mobile'].includes(platform))return error(res,'Invalid Figma platform',400);
        if(body.screenIds!==undefined&&body.revisionNotes===undefined)return error(res,'Selected screens require a revision request',400);
        if(body.fileIdentityConfirmed!==undefined&&typeof body.fileIdentityConfirmed!=='boolean')return error(res,'File identity confirmation must be an explicit boolean.',400);
        if(body.revisionNotes!==undefined){
          revisionNotes=String(body.revisionNotes);if(!revisionNotes.trim()||revisionNotes.length>3000)return error(res,'Revision feedback phải có nội dung và tối đa 3000 ký tự.',400);
          if(!(p.figmaDesign?.state==='REVISION_REQUESTED'||p.figmaDesign?.state==='FAILED'&&p.figmaDesign?.screenIds)||!(body.channelId||p.figmaDesign.channelId))return error(res,'Không có bản design đang chờ chỉnh sửa hoặc chưa nhập Channel ID đang kết nối.',409);
          try{connection=body.channelId===undefined?{documentKey:p.figmaDesign.documentKey,channelId:p.figmaDesign.channelId}:parseFigmaDesignInput({fileUrl:`https://www.figma.com/design/${p.figmaDesign.documentKey}`,channelId:body.channelId})}catch(e){return error(res,e.message,400)}
        }else{try{connection=parseFigmaDesignInput(body)}catch(e){return error(res,e.message,400)}}
        const runId=randomUUID(),projectVersion=p.version+1;
        let next;
        const samePlatform=platform===(p.figmaDesign?.platform||p.workflow?.platform||'web');
        const screenIds=body.screenIds!==undefined?body.screenIds:(revisionNotes&&samePlatform?(p.figmaDesign?.revisionScreenIds||p.figmaDesign?.screenIds):undefined);
        try{next=beginFigmaDesign(p,{...connection,jobId:runId,platform,screenIds,mode:body.mode});}catch(e){return error(res,e.message,409)}
        next.figmaDesign.state='QUEUED';next.figmaDesign.visualInputsConfirmed=body.visualInputsConfirmed===true;next.figmaDesign.revisionNotes=revisionNotes;
        next.version=projectVersion;next.figmaDesign.projectVersion=projectVersion;next.updatedAt=new Date().toISOString();
        next.figmaDesign.fileConfirmation=recordFigmaFileConfirmation(next,{confirmed:body.fileIdentityConfirmed,runId,...connection,projectVersion,confirmedBy:reviewerId(req)});
        const job=store.enqueue(p.id,runId,{kind:'figma-design',documentKey:connection.documentKey,channelId:connection.channelId,revisionNotes,platform,mode:next.figmaDesign.mode,...(next.figmaDesign.screenIds?{screenIds:next.figmaDesign.screenIds}:{}),projectVersion},{maxAttempts:1});
        auditAs(next,reviewerId(req),'FIGMA_DESIGN_QUEUED',{runId,revision:next.figmaDesign.revision,projectVersion,fileConfirmation:next.figmaDesign.fileConfirmation});store.attach(next,p._dbRevision,requestLease);await save(next);
        return json(res,{projectId:p.id,version:next.version,figmaDesign:{...next.figmaDesign,channelId:undefined},jobId:job.id,state:'QUEUED'},202);
      }
      if(segments[3]==='figma-design'&&segments[4]==='review'&&segments.length===5&&req.method==='POST'){
        const body=await readBody(req),actor=reviewerId(req);let next;
        try{next=reviewFigmaDesign(p,{...body,reviewerId:actor})}catch(e){return error(res,e.message,409)}
        next.version++;next.updatedAt=new Date().toISOString();if(next.figmaDesign.draft)next.figmaDesign.draft.projectVersion=next.version;
        if(body.decision==='APPROVE'&&next.figmaDesign.approved)next.figmaDesign.approved.projectVersion=next.version;
        auditAs(next,actor,(next.figmaDesign.mode==='sample'?'FIGMA_SAMPLE_':'FIGMA_DESIGN_')+body.decision,{manifestDigest:body.manifestDigest,projectVersion:body.projectVersion,screenIds:next.figmaDesign.history.at(-1).screenIds});store.attach(next,p._dbRevision,requestLease);await save(next);
        const design=structuredClone(next.figmaDesign);delete design.channelId;delete design.revisionNotes;return json(res,{projectId:next.id,version:next.version,figmaDesign:design});
      }
      if(segments[3]==='figma-design'&&segments[4]==='previews'&&segments[5]&&segments.length===6&&req.method==='GET'){
        const screenId=segments[5],design=p.figmaDesign;
        const screens=['WAITING_FOR_REVIEW','WAITING_SAMPLE_REVIEW','SAMPLE_APPROVED'].includes(design?.state)&&design.draft?.projectVersion===p.version?design.screens:design?.state==='APPROVED'&&design.approved?.projectVersion===p.version?design.approved.screens:null;
        const item=screens?.find(s=>s.screenId===screenId);if(!item)return error(res,'Preview is not available for this project screen',404);
        const bytes=await figmaPreviews.read(p.id,item.preview.path,item.preview);
        res.writeHead(200,{'Content-Type':item.preview.contentType,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
      }
      if(segments[3]==='erp'&&segments[4]==='target'&&segments.length===5&&req.method==='POST'){
        const body=await readBody(req),actor=reviewerId(req);confirmERPTarget(p,body,actor);
        const wf=ensureWorkflow(p);wf.stage='ERP_SOLUTION_DESIGN';wf.state='READY';wf.lastError=null;wf.currentAttempt=null;
        wf.checkpoints=(wf.checkpoints||[]).filter(x=>!['ERP_SOLUTION_DESIGN','DELIVERABLES','FIGMA_DESIGN','FIGMA_PUBLISH'].includes(x.stage));
        p.version++;p.updatedAt=new Date().toISOString();auditAs(p,actor,'ERP_TARGET_CONFIRMED',{platformId:p.erpTarget.platformId,version:p.erpTarget.version,sourceReference:p.erpTarget.sourceReference});await save(p);return json(res,p);
      }
      if(segments[3]==='erp'&&segments[4]==='design'&&segments.length===5&&req.method==='GET')return json(res,{target:currentERPTarget(p),design:p.erpSolutionDesign||null,current:!!currentERPDesign(p)});
      if(segments[3]==='erp'&&segments[4]==='design'&&['export','ERP_SOLUTION_DESIGN.md'].includes(segments[5])&&segments.length===6&&req.method==='GET'){
        if(!currentERPDesign(p))return error(res,'Thiết kế thiếu hoặc đã lỗi thời.',409);
        return sendDownload(res,'ERP_SOLUTION_DESIGN.md',renderERPDesign(p),'text/markdown; charset=utf-8');
      }
      if(segments[3]==='erp'&&segments[4]==='design'&&segments[5]==='review'&&segments.length===6&&req.method==='POST'){
        const body=await readBody(req),actor=reviewerId(req),wf=ensureWorkflow(p);
        if(wf.stage!=='ERP_SOLUTION_DESIGN')return error(res,'Bước thiết kế ERP chưa hoạt động.',409);
        const design=reviewERPDesign(p,body,actor);
        if(design.status==='APPROVED'){checkpoint(p,'ERP_SOLUTION_DESIGN',{designId:design.id,contentDigest:design.contentDigest,customerApproved:false});wf.stage='DELIVERABLES';}
        wf.state='READY';p.version++;p.updatedAt=new Date().toISOString();auditAs(p,actor,'ERP_DESIGN_'+body.decision,{designId:design.id,contentDigest:design.contentDigest});await save(p);return json(res,p);
      }
      if(segments[3]==='erp'&&segments.length===4&&req.method==='GET')return json(res,{projectId:p.id,profile:p.solutionProfile||null,assessment:erpFitGapReport(p),comparison:erpSolutionComparison(p)});
      if(segments[3]==='erp'&&segments[4]==='profile'&&segments.length===5&&req.method==='POST'){
        const body=await readBody(req),profile=normalizeSolutionProfile(body.solutionProfile),actor=reviewerId(req);
        const before=techStackDigest(p);p.solutionProfile=profile;
        if(before!==techStackDigest(p)){
          p.clarificationRecommendations=[];p.requirementsRefreshPending=!!p.analysis;
          for(const d of p.clarificationDecisions||[])if(d.status==='APPROVED')d.status='STALE_SOLUTION_PROFILE_CHANGED';
          for(const q of p.analysis?.clarificationQuestions||[])if(q.resolutionId){q.status='open';delete q.resolutionId;}
          p.review=null;p.previousPrototype=p.prototype||p.previousPrototype||null;p.prototype=null;
          p.status=p.analysis?'ANALYZED':'NEW';invalidateAfterAnalysis(p);
        }
        p.version++;p.updatedAt=new Date().toISOString();
        auditAs(p,actor,'ERP_SOLUTION_PROFILE_UPDATED',{changed:before!==techStackDigest(p),profileDigest:techStackDigest(p)});
        await save(p);return json(res,p);
      }
      if(segments[3]==='erp'&&segments[4]==='fit-gap'&&segments.length===5&&req.method==='POST'){
        const body=await readBody(req),actor=reviewerId(req);
        const entry=recordERPFitGap(p,body,actor);
        p.clarificationRecommendations=[];p.requirementsRefreshPending=!!p.analysis;
        for(const d of p.clarificationDecisions||[])if(d.status==='APPROVED')d.status='STALE_FIT_GAP_CHANGED';
        for(const q of p.analysis?.clarificationQuestions||[])if(q.resolutionId){q.status='open';delete q.resolutionId;}
        p.review=null;p.previousPrototype=p.prototype||p.previousPrototype||null;p.prototype=null;
        p.status='ANALYZED';invalidateAfterAnalysis(p);p.version++;p.updatedAt=new Date().toISOString();
        auditAs(p,actor,'ERP_FIT_GAP_REVIEWED',{requirementId:entry.requirementId,platformId:entry.platformId,classification:entry.classification,sourceReference:entry.sourceReference});
        await save(p);return json(res,p);
      }
      if(segments[3]==='tech-stack'&&segments.length===4&&req.method==='POST'){
        const body=await readBody(req),techStack=normalizeTechStack(body.techStack),actor=reviewerId(req);
        const oldDigest=techStackDigest(p);
        p.techStack=techStack;
        if(oldDigest!==techStackDigest(p)){
          p.clarificationRecommendations=[];p.requirementsRefreshPending=!!p.analysis;
          for(const d of p.clarificationDecisions||[])if(d.status==='APPROVED')d.status='STALE_STACK_CHANGED';
          for(const q of p.analysis?.clarificationQuestions||[])if(q.resolutionId){q.status='open';delete q.resolutionId;}
          p.review=null;p.previousPrototype=p.prototype||p.previousPrototype||null;p.prototype=null;p.status=p.analysis?'ANALYZED':'NEW';
          invalidateAfterAnalysis(p);
        }
        p.version++;p.updatedAt=new Date().toISOString();
        auditAs(p,actor,'TECH_STACK_UPDATED',{changed:oldDigest!==techStackDigest(p),stackDigest:techStackDigest(p)});
        await save(p);return json(res,p);
      }
      if(segments[3]==='recommendations'&&segments.length===4&&req.method==='GET'){
        return json(res,{projectId:p.id,techStack:p.techStack||null,proposals:p.clarificationRecommendations||[],decisions:p.clarificationDecisions||[]});
      }
      if(segments[3]==='recommendations'&&segments[4]==='generate'&&req.method==='POST'){
        if(!p.analysis)return error(res,'Analyze first',409);
        const body=await readBody(req),business=body.mode==='business';
        if(body.mode && !['business','technical'].includes(body.mode))return error(res,'Invalid recommendation mode',400);
        if(!business&&!availableSolutionReferences(p).length)return error(res,'Configure actual tech stack or ERP candidates first',409);
        if(body.questionIds&&(!Array.isArray(body.questionIds)||!body.questionIds.length||body.questionIds.length>5||new Set(body.questionIds).size!==body.questionIds.length||body.questionIds.some(id=>typeof id!=='string'||!p.analysis.clarificationQuestions.some(q=>q.id===id&&!['resolved','answered-pending-ba-review'].includes(q.status)))))return error(res,'Invalid open question batch (1-5 IDs)',400);
        const question=body.questionId?p.analysis.clarificationQuestions.find(q=>q.id===body.questionId&&q.status!=='resolved'):null;
        if(body.questionId&&!question)return error(res,'Open question not found',404);
        if(body.selectionMode&&body.selectionMode!=='ba-draft')return error(res,'Invalid selection mode',400);
        const input={...p,recommendationSelectionMode:body.selectionMode,recommendationMode:business?'business':'technical',analysis:question?{...p.analysis,clarificationQuestions:[question]}:body.questionIds?{...p.analysis,clarificationQuestions:p.analysis.clarificationQuestions.filter(q=>body.questionIds.includes(q.id))}:p.analysis};
        const raw=await withAIContext({projectId:p.id,runId:p.workflow?.runId||null,stage:'GAP_ANALYSIS'},()=>recommendClarifications(input));
        const previous=p.clarificationRecommendations||[];
        if(body.questionIds&&body.questionIds.some(id=>!raw.some(r=>r.questionId===id)))return error(res,'Incomplete draft batch; retry these questions',422);
        createRecommendations(p,question?raw.filter(r=>r.questionId===question.id):body.questionIds?raw.filter(r=>body.questionIds.includes(r.questionId)):raw,{provider:mode,mode:business?'business':'technical',selectionMode:body.selectionMode});
        if(question&&!p.clarificationRecommendations.length)return error(res,'No draft answer returned for this question; retry or enter your own answer',422);
        if(question||body.questionIds){const requested=body.questionIds||[question.id];p.clarificationRecommendations=[...previous.filter(r=>!requested.includes(r.questionId)),...p.clarificationRecommendations];}
        p.version++;p.updatedAt=new Date().toISOString();
        auditAs(p,reviewerId(req),'CLARIFICATION_PROPOSALS_GENERATED',{count:p.clarificationRecommendations.length,stackDigest:techStackDigest(p)});
        await save(p);return json(res,p);
      }
      if(segments[3]==='recommendations'&&segments[4]==='approve'&&req.method==='POST'){
        const body=await readBody(req),actor=reviewerId(req);
        const decision=recordDecision(p,await resolveAnswerAttachments(p.id,body),actor);
        invalidateAfterAnalysis(p); // Reset dependent workflow checkpoints and invalidate design.
        if(p.workflow){p.workflow.state='READY';p.workflow.waiver=null;}
        p.version++;p.updatedAt=new Date().toISOString();
        auditAs(p,actor,'CLARIFICATION_OPTION_APPROVED',{decisionId:decision.id,questionId:decision.questionId,optionId:decision.optionId,approverRole:decision.approverRole,sourceReference:decision.sourceReference,customerBaselineApproved:false});
        await save(p);return json(res,p);
      }
      if(segments[3]==='workspace'&&req.method==='GET'&&segments.length===4){
        const exported=await workspaces.exportProject(p);
        return json(res,{projectId:p.id,relativePath:path.relative(dataDir,exported.directory).replaceAll('\\','/'),version:p.version,sourceOfTruth:'SQLite; workspace is a projection'});
      }
      if(segments[3]==='files'&&segments.length===4&&req.method==='GET')return json(res,workspaces.list(p.id));
      if(segments[3]==='files'&&segments.length===4&&req.method==='POST'){
        const body=await readBody(req,7_100_000);
        const doc=await workspaces.addDocument(p.id,{category:body.category,filename:body.filename,content:body.content,encoding:body.encoding,actorId:reviewerId(req)});
        return json(res,doc,201);
      }
      if(segments[3]==='files'&&segments.length===6&&segments[5]==='preview'&&req.method==='GET'){
        const doc=await workspaces.readDocument(p.id,segments[4]);let bytes;try{bytes=referenceBytes(doc)}catch(e){return error(res,e.message,400)}
        const type=/\.png$/i.test(doc.filename)?'image/png':/\.webp$/i.test(doc.filename)?'image/webp':'image/jpeg';
        res.writeHead(200,{'Content-Type':type,'Content-Length':bytes.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(bytes);
      }
      if(segments[3]==='files'&&segments.length===5&&req.method==='GET')return json(res,await workspaces.readDocument(p.id,segments[4]));

      if(segments[3]==='quality'&&segments[4]==='ai'&&req.method==='GET')return json(res,store.aiMetrics(p.id));
      if(segments[3]==='quality'&&segments[4]==='history'&&req.method==='GET')return json(res,store.qualityHistory(p.id));
      if(segments[3]==='quality'&&segments.length===4&&req.method==='GET')return json(res,assessDeliverables(p,{policy:qualitySettings}));
      if(segments[3]==='requirement-references'&&segments.length===4&&req.method==='GET'){
        const known=new Set((p.analysis?.functionalRequirements||[]).map(r=>r.id));
        const requirements=[];
        for(const entry of store.history(p.id).filter(v=>v.archived&&v.version<p.version).sort((a,b)=>b.version-a.version)){
          const snapshot=store.version(p.id,entry.version);
          for(const r of snapshot.analysis?.functionalRequirements||[]){
            if(!/^FR-\d+$/.test(r.id)||known.has(r.id))continue;
            known.add(r.id);requirements.push({id:r.id,name:r.name,description:r.description,actor:r.actor,historicalVersion:entry.version});
          }
        }
        return json(res,{projectId:p.id,projectVersion:p.version,requirements});
      }
      if(segments[3]==='history'&&req.method==='GET'){
        if(segments[4]){
          if(!/^\d+$/.test(segments[4]))return error(res,'Invalid history version',400);
          return json(res,store.version(p.id,Number(segments[4])));
        }
        return json(res,store.history(p.id));
      }
      if(segments[3]==='audit'&&req.method==='GET'){
        reviewerId(req);
        return json(res,{integrity:store.verifyAudit(p.id),events:store.audit(p.id)});
      }
      if(segments[3]==='workflow'&&segments[4]==='jobs'&&segments.length===5&&req.method==='GET')return json(res,store.jobs(p.id));
      if(segments[3]==='workflow'&&segments[4]==='jobs'&&segments.length===5&&req.method==='POST'){
        const body=await readBody(req);const wf=ensureWorkflow(p);
        if(body.platform!==undefined&&!['web','mobile'].includes(body.platform))return error(res,'Invalid platform',400);
        if(wf.state==='COMPLETED'||['FIGMA_DESIGN','FIGMA_PUBLISH'].includes(wf.stage))return error(res,'BA workflow complete; manage Figma design from Prototype',409);
        const job=store.enqueue(p.id,wf.runId,{auto:body.auto!==false,platform:body.platform});
        return json(res,{jobId:job.id,state:job.state,projectId:p.id,runId:wf.runId},202);
      }
      if(segments[3]==='workflow'&&segments[4]==='jobs'&&segments[5]&&req.method==='GET'){
        const job=store.job(segments[5]);if(job.project_id!==p.id)return error(res,'Job not found',404);
        return json(res,job);
      }
      if(segments[3]==='workflow'&&segments[4]==='restart'&&req.method==='POST'){
        const body=await readBody(req);
        if(body.confirm!==true)return error(res,'Restart requires confirm=true; BA Review and draft prototype will be reset',400);
        if(body.platform!==undefined&&!['web','mobile'].includes(body.platform))return error(res,'Invalid platform',400);
        await archive(p);
        const old=ensureWorkflow(p);
        p.workflow=null;const fresh=ensureWorkflow(p);fresh.platform=body.platform||old.platform||'web';
        p.brainstorm=null;p.review=null;p.previousPrototype=p.prototype||p.previousPrototype||null;p.prototype=null;
        p.status=p.analysis?'ANALYZED':'NEW';p.version++;p.updatedAt=new Date().toISOString();await save(p);
        return json(res,p);
      }
      if(segments[3]==='workflow'&&segments[4]==='advance'&&req.method==='POST'){
        const body=await readBody(req);
        const result=await advanceWorkflow(p,{auto:body.auto!==false,platform:body.platform});
        return json(res,result);
      }
      if(segments[3]==='workflow'&&segments[4]==='waiver'&&req.method==='POST'){
        const body=await readBody(req);
        const actor=reviewerId(req);await archive(p);acceptClarificationRisk(p,body);auditAs(p,actor,'CLARIFICATION_RISK_ACCEPTED',{blockerIds:p.workflow.waiver.blockerIds,waiverDigest:p.workflow.waiver.blockerDigest,rationale:p.workflow.waiver.rationale});
        p.version++;p.updatedAt=new Date().toISOString();await save(p);
        return json(res,p);
      }
      if(segments[3]==='workflow'&&segments[4]==='figma'&&segments[5]==='challenge'&&req.method==='POST'){
        const body=await readBody(req);const documentKey=String(body.documentKey||'');
        if(!/^[\w-]{3,128}$/.test(documentKey))return error(res,'Invalid Figma file key',400);
        const wf=ensureWorkflow(p);
        if(wf.stage!=='FIGMA_PUBLISH'||!wf.design||!['FIGMA_REPORTED','FIGMA_READBACK_REPORTED'].includes(wf.state))return error(res,'Sync verified registry before readback',409);
        if(wf.figmaResult?.documentKey!==documentKey)return error(res,'Figma file scope mismatch',409);
        const registry=JSON.parse(await fs.readFile(registryPath(p.id,documentKey),'utf8'));
        const manifest=JSON.parse(await fs.readFile(path.join(wf.artifactDir,'figma-manifest.json'),'utf8'));
        const plan=buildPublishPlan(manifest,registry);
        if(!plan.screens.length||plan.screens.some(x=>x.action!=='skip'))return error(res,'Registry missing or outdated',409);
        const screens=manifest.screens.map(x=>({screenId:x.id,nodeId:registry.screens[x.id].nodeId,nodeName:x.name}));
        return json(res,store.issueReadbackChallenge({projectId:p.id,runId:wf.runId,documentKey,manifestDigest:wf.design.manifestDigest,screens}),201);
      }
      if(segments[3]==='workflow'&&segments[4]==='figma'&&segments[5]==='readback'&&req.method==='POST'){
        const body=await readBody(req);const report=body.report;
        if(!report||typeof report.nonce!=='string')return error(res,'Readback report nonce required',400);
        const wf=ensureWorkflow(p);
        if(wf.stage!=='FIGMA_PUBLISH'||!['FIGMA_REPORTED','FIGMA_READBACK_REPORTED'].includes(wf.state))return error(res,'Figma sync gate not passed',409);
        const challenge=store.getReadbackChallenge(report.nonce);
        const registry=JSON.parse(await fs.readFile(registryPath(p.id,challenge.documentKey),'utf8'));
        const manifest=JSON.parse(await fs.readFile(path.join(wf.artifactDir,'figma-manifest.json'),'utf8'));
        let evidence;
        try{evidence=validateReadback(challenge,report,{project:p,manifest,registry})}
        catch(e){return error(res,'Figma read-back rejected: '+e.message,409)}
        wf.figmaResult={...wf.figmaResult,state:'MCP_OPERATOR_REPORTED_READBACK_PENDING_VISUAL_QA',readback:evidence};
        wf.state='FIGMA_READBACK_REPORTED';wf.updatedAt=new Date().toISOString();
        p.version++;p.updatedAt=wf.updatedAt;
        auditAs(p,reviewerId(req),'FIGMA_READBACK_RECORDED',evidence);
        await save(p,{consumeChallenge:challenge.nonce});return json(res,p);
      }
      if(segments[3]==='workflow'&&segments[4]==='figma'&&segments[5]==='qa'&&req.method==='POST'){
        const body=await readBody(req),actor=reviewerId(req),wf=ensureWorkflow(p);
        if(wf.state!=='FIGMA_READBACK_REPORTED'||!wf.figmaResult?.readback)return error(res,'Readback required before QA approval',409);
        if(body.approved!==true||typeof body.notes!=='string'||body.notes.trim().length<20||body.notes.length>4000)return error(res,'BA visual QA confirmation and notes (20-4000 chars) required',400);
        wf.figmaResult.visualQA={state:'BA_VISUAL_QA_APPROVED_NOT_CUSTOMER_SIGNOFF',reviewer:actor,notes:body.notes.trim(),at:new Date().toISOString(),evidenceDigest:wf.figmaResult.readback.reportDigest};
        wf.state='FIGMA_QA_APPROVED';wf.updatedAt=new Date().toISOString();p.version++;p.updatedAt=wf.updatedAt;
        auditAs(p,actor,'FIGMA_VISUAL_QA_APPROVED',{evidenceDigest:wf.figmaResult.readback.reportDigest,notes:body.notes.trim()});
        await save(p);return json(res,p);
      }
      if(segments[3]==='workflow'&&segments[4]==='figma'&&segments[5]==='sync'&&req.method==='POST'){
        const body=await readBody(req);const documentKey=String(body.documentKey||'');
        if(!/^[\w-]{3,128}$/.test(documentKey))return error(res,'Invalid Figma documentKey',400);
        const wf=ensureWorkflow(p);
        if(wf.stage!=='FIGMA_PUBLISH'||!wf.design)return error(res,'Design pack is not ready',409);
        const registryFile=registryPath(p.id,documentKey);
        let registry;try{registry=JSON.parse(await fs.readFile(registryFile,'utf8'))}catch(e){if(e.code==='ENOENT')return error(res,'No verified Figma registry exists for this file',409);throw e}
        if(registry.documentKey!==documentKey||registry.projectId!==p.id)return error(res,'Figma registry scope mismatch',409);
        const manifest=buildFigmaHandoff(p,{platform:wf.platform}).manifest;
        if(fingerprint(JSON.stringify(manifest.screens))!==fingerprint(JSON.stringify(JSON.parse(await fs.readFile(path.join(wf.artifactDir,'figma-manifest.json'),'utf8')).screens)))return error(res,'Design pack is stale; restart workflow',409);
        const plan=buildPublishPlan(manifest,registry);
        if(plan.screens.some(x=>x.action!=='skip')||!plan.screens.length)return error(res,'Some Figma screens are missing or outdated in verified registry',409);
        await archive(p);
        auditAs(p,reviewerId(req),'FIGMA_REGISTRY_SYNC',{documentKey,manifestDigest:wf.design.manifestDigest,screenCount:plan.screens.length});
        wf.figmaResult={documentKey,reportedVerifiedNodes:plan.screens.length,state:'REPORTED_VERIFIED_PENDING_VISUAL_QA',syncedAt:new Date().toISOString()};
        wf.state='FIGMA_REPORTED';wf.updatedAt=new Date().toISOString();
        p.version++;p.updatedAt=wf.updatedAt;await save(p);return json(res,p);
      }
      if(segments[3]==='workflow'&&segments.length===4&&req.method==='GET'){
        return json(res,{workflow:p.workflow||{stage:'BRAINSTORM',state:'NOT_STARTED',checkpoints:[]},quality:p.analysis?qualitySnapshot(p):null,qualityIntelligence:assessDeliverables(p,{policy:qualitySettings}),blockers:p.analysis?unresolvedHigh(p):[],brainstorm:p.brainstorm||null});
      }
      if(segments[3]==='analyze'&&req.method==='POST'){
        await archive(p);await newAnalysis(p,p.brief);invalidateAfterAnalysis(p);await save(p);return json(res,p);
      }
      if(segments[3]==='clarify'&&req.method==='POST'){
        if(!p.analysis)return error(res,'Cần phân tích dự án trước.',409);
        const body=await readBody(req);const extra=String(body.clarifications||'').trim();
        if(extra.length<5||extra.length>12000)return error(res,'Nội dung bổ sung phải từ 5 đến 12.000 ký tự.');
        const revisedBrief=p.brief+'\n\n=== BA NOTE (UNVERIFIED) ===\n'+extra;
        if(revisedBrief.length>100000)return error(res,'Tổng brief vượt 100.000 ký tự.');
        await archive(p);
        p.sources=[...(p.sources||buildSources(p.brief)),{id:`SRC-${String((p.sources?.length||1)+1).padStart(3,'0')}`,type:'ba-note',text:extra,at:new Date().toISOString()}];
        p.amendments=[...(p.amendments||[]),{text:extra,at:new Date().toISOString(),sourceType:'ba-note'}];
        p.brief=revisedBrief;
        await newAnalysis(p,revisedBrief);invalidateAfterAnalysis(p);
        await save(p);return json(res,p);
      }
      if(segments[3]==='answers'&&segments[4]==='batch'&&req.method==='POST'){
        const body=await readBody(req),actor=reviewerId(req);
        if(!Array.isArray(body.answers)||body.answers.length>100)return error(res,'Invalid answer batch',400);
        const entries=[];for(const entry of body.answers)entries.push(await resolveAnswerAttachments(p.id,entry));
        const result=applyClarificationBatch(p,entries,actor);invalidateAfterAnalysis(p);
        p.version++;p.updatedAt=new Date().toISOString();
        auditAs(p,actor,'CLARIFICATION_BATCH_SAVED',{...result,customerBaselineApproved:false});
        await save(p);return json(res,p);
      }
      if(segments[3]==='answers'&&req.method==='POST'){
        if(!p.analysis)return error(res,'Cần phân tích trước khi trả lời.',409);
        const b=await readBody(req);const questionId=String(b.questionId||'').trim();
        const answer=String(b.answer||'').trim(),respondent=String(b.respondent||'').trim(),sourceReference=String(b.sourceReference||'').trim();
        if(!p.analysis.clarificationQuestions.some(q=>q.id===questionId))return error(res,'Question ID không tồn tại.',400);
        if(answer.length<3||answer.length>12000||respondent.length<2||respondent.length>160||sourceReference.length<3||sourceReference.length>300)return error(res,'Cần câu trả lời, người trả lời và nguồn tham chiếu hợp lệ.',400);
        const brief=p.brief+`\n\n=== CUSTOMER RESPONSE TO ${questionId} (source: ${sourceReference}; respondent: ${respondent}) ===\n`+answer;
        if(brief.length>100000)return error(res,'Brief vượt quá 100.000 ký tự.');
        await archive(p);
        const source={id:`SRC-${String((p.sources?.length||1)+1).padStart(3,'0')}`,type:'customer-response',text:answer,at:new Date().toISOString(),respondent,sourceReference,questionId};
        p.sources=[...(p.sources||buildSources(p.brief)),source];
        p.answers=[...(p.answers||[]),{questionId,answer,sourceId:source.id,respondent,sourceReference,at:source.at}];
        p.brief=brief;
        await newAnalysis(p,brief);invalidateAfterAnalysis(p);await save(p);return json(res,p);
      }
      if(segments[3]==='review'&&req.method==='POST'){
        if(!p.analysis)return error(res,'Cần chạy phân tích trước khi review.',409);
        if(p.requirementsRefreshPending)return error(res,'Approved clarification requires re-analysis before BA review',409);
        if(hasActiveWorkflow(p)){
          if(p.workflow.stage!=='BA_REVIEW')return error(res,'Workflow must reach BA_REVIEW before approval',409);
          if(unresolvedHigh(p).length&&!hasCurrentWaiver(p))return error(res,'High-priority clarifications require responses or explicit BA risk acceptance',409);
          if(!p.analysis.functionalRequirements.length)return error(res,'No functional requirements for reviewed design',409);
        }
        const body=await readBody(req);
        if(body.approved!==true)return error(res,'BA phải xác nhận đã rà soát trước khi tạo tài liệu.',400);
        const notes=String(body.notes||'').trim();
        if(notes.length>20000)return error(res,'Ghi chú vượt quá 20.000 ký tự');
        const actor=reviewerId(req);await archive(p);p.review={approved:true,notes,reviewedAt:new Date().toISOString(),unresolvedQuestions:p.analysis.clarificationQuestions.length};
        p.status='REVIEWED';
        if(hasActiveWorkflow(p)){checkpoint(p,'BA_REVIEW',{customerApproved:false,waivedHighRisk:hasCurrentWaiver(p)});p.workflow.stage=nextStage('BA_REVIEW',p);p.workflow.state='READY';}
        p.version++;p.updatedAt=new Date().toISOString();auditAs(p,actor,'BA_REVIEW_APPROVED',{notes,reviewedAt:p.review.reviewedAt,analysisDigest:fingerprint(JSON.stringify(p.analysis)),waiver:p.workflow?.waiver?.blockerDigest||null});await save(p);return json(res,p);
      }
      if(segments[3]==='generate'&&req.method==='POST'){
        if(!p.review?.approved||p.requirementsRefreshPending)return error(res,'Cần re-analysis và BA review trước khi sinh prototype.',409);
        if(hasActiveWorkflow(p) && unresolvedHigh(p).length&&!hasCurrentWaiver(p))return error(res,'Unresolved high-risk clarifications',409);
        await archive(p);await createPrototype(p);
        if(hasActiveWorkflow(p)&&['FIGMA_DESIGN','FIGMA_PUBLISH'].includes(p.workflow.stage)){
          p.workflow.stage='FIGMA_DESIGN';p.workflow.state='READY';p.workflow.design=null;p.workflow.artifactDir=null;p.workflow.figmaResult=null;
          p.workflow.checkpoints=p.workflow.checkpoints.filter(x=>x.stage!=='FIGMA_DESIGN');
        }
        await save(p);return json(res,p);
      }
      if(segments[3]==='export'&&req.method==='GET'){
        const kind=segments[4]?.replace(/\.(md|html|json)$/,'');
        if(!p.analysis)return error(res,'Cần phân tích trước khi export.',409);
        if((!p.review?.approved||p.requirementsRefreshPending) && !['questions','canonical'].includes(kind))return error(res,'Chưa review nên chưa cho phép export BRD/SRS/prototype.',409);
        if(!docsFilename[kind])return error(res,'Định dạng export không tồn tại',404);
        if(kind==='prototype'&&!p.prototype)return error(res,'Chưa tạo prototype.',409);
        if(['figma','figma-manifest'].includes(kind)&&!p.analysis.functionalRequirements.length)return error(res,'Cần tối thiểu một yêu cầu chức năng để lập Figma design pack.',409);
        if(kind==='prototype'&&url.searchParams.has('platform')&&!['web','mobile'].includes(url.searchParams.get('platform')))return error(res,'Invalid prototype platform',400);
        const content=Object.hasOwn(DOCUMENT_RENDERERS,kind)?DOCUMENT_RENDERERS[kind](p):kind==='questions'?renderQuestionnaire(p):kind==='prototype'?renderStandalone(p,url.searchParams.has('platform')?{platform:url.searchParams.get('platform')}:{}):kind==='canonical'?JSON.stringify(buildCanonicalPackage(p),null,2):kind==='figma'?buildFigmaHandoff(p).instructions:kind==='figma-manifest'?JSON.stringify(buildFigmaHandoff(p).manifest,null,2):JSON.stringify({analysis:p.analysis,prototype:p.prototype,review:p.review},null,2);
        return sendDownload(res,docsFilename[kind],content,kind==='prototype'?'text/html; charset=utf-8':['json','canonical','figma-manifest'].includes(kind)?'application/json; charset=utf-8':'text/markdown; charset=utf-8');
      }
    }
    if(req.method==='GET' && !url.pathname.startsWith('/api/')){
      const files={'/':'index.html','/index.html':'index.html','/style.css':'style.css','/app.js':'app.js','/workflow-progress.js':'workflow-progress.js','/quality-dashboard-ui.js':'quality-dashboard-ui.js','/clarification-ui.js':'clarification-ui.js','/clarification-batch-ui.js':'clarification-batch-ui.js','/figma-review-ui.js':'figma-review-ui.js','/design-direction-ui.js':'design-direction-ui.js','/design-brief-options.js':'design-brief-options.js','/design-brief-controls.js':'design-brief-controls.js'};
      files['/requirement-file-ui.js']='requirement-file-ui.js';
      const file=files[url.pathname];if(!file)return error(res,'Not Found',404);
      const content=await fs.readFile(path.join(publicDir,file));res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'application/javascript; charset=utf-8':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'",'X-Content-Type-Options':'nosniff'});return res.end(content);
    }
    return error(res,'Not Found',404);
  }catch(e){console.error('[BA Agent]',e?.message);return error(res,e?.status?e.message:'Có lỗi xử lý dự án. Xem log backend.',e?.status||500)}
  finally{if(requestHeartbeat)clearInterval(requestHeartbeat);if(activeWriteId)activeWrites.delete(activeWriteId);if(requestLease)store.releaseLease(activeWriteId,requestLease)}
}
const server=http.createServer(handler);
const port=Number(process.env.PORT||3478);
logExecution('SERVICE_CONFIG',{provider:mode,model:mode==='codex'?(process.env.CODEX_MODEL||'codex-cli'):mode==='openai'?(process.env.OPENAI_MODEL||'gpt-4.1-mini'):'demo',...(mode==='codex'?{timeoutMs:codexTimeoutMs(process.env.CODEX_TIMEOUT_MS)}:{})});
if(process.env.BA_WORKER_ONLY!=='true')server.listen(port,host,()=>console.log(`BA Studio v3.4: http://${host}:${port} | provider=${mode}`));
else console.log(`BA Studio v3.4 worker-only mode | provider=${mode} | db=${dataDir}`);

// Durable queue processor. A worker can be restarted after a crash; stale leases
// expire, and project save is fenced by token + DB revision, not process memory.
let workerBusy=false;
async function tickWorker(){
  if(workerBusy)return;
  const job=store.claimJob();if(!job)return;
  workerBusy=true;logExecution('WORKER_JOB_START',{projectId:job.project_id,runId:job.run_id});
  const heartbeat=setInterval(()=>{
    try{if(!store.renewJob(job.id,job.token))console.error('[BA Worker] lease lost',job.id)}catch(e){console.error('[BA Worker] heartbeat',e.message)}
  },10000);
  heartbeat.unref();
  try{
    const p=await safeGet(job.project_id,job.token);
    if(job.options?.kind==='figma-design'){
      const runId=job.run_id,design=p.figmaDesign;
      if(!design||design.runId!==runId||design.state!=='QUEUED'||design.projectVersion!==p.version||job.options.projectVersion!==p.version)throw new Error('Figma design run is stale or inactive');
      if(figmaRelay.status().state!=='READY')throw new Error('Figma relay is not ready');
      design.state='DESIGNING';
      const platform=design.platform||job.options.platform||p.workflow?.platform||'web',handoff=buildFigmaHandoff(p,{platform});
      const outputDirectory=path.join(workspaces.root(p.id),'04-figma','exports',`v${p.version}-${platform}`);
      await fs.mkdir(outputDirectory,{recursive:true,mode:0o700});
      const registryFile=registryPath(p.id,job.options.documentKey,platform);let registry=null;
      if(existsSync(registryFile))registry=JSON.parse(await fs.readFile(registryFile,'utf8'));
      const designPlan=buildFigmaDesignPlan(p,handoff.manifest,registry,{revisionNotes:job.options.revisionNotes||'',screenIds:job.options.screenIds,mode:design.mode,documentKey:job.options.documentKey});
      const imagePaths=[];
      if(p.designDirection){
        if(design.visualInputsConfirmed!==true)throw new Error('Visual input consent required');
        for(const [index,ref] of p.designDirection.references.entries()){
          const doc=await workspaces.readDocument(p.id,ref.documentId);if(doc.sha256!==ref.sha256)throw new Error('Reference image changed');
          const bytes=referenceBytes(doc),filename=`reference-${index+1}.${doc.filename.split('.').at(-1).toLowerCase()}`,target=path.join(outputDirectory,filename);
          await fs.writeFile(target,bytes,{mode:0o600});imagePaths.push(target);
        }
      }
      const files={...(p.designDirection?{'DESIGN_BRIEF.json':JSON.stringify(p.designDirection,null,2)}:{}),'BRD.md':handoff.brd,'SRS.md':handoff.srs,'canonical.json':JSON.stringify(handoff.canonical,null,2),'figma-manifest.json':JSON.stringify(handoff.manifest,null,2),'FIGMA_INSTRUCTIONS.md':handoff.instructions,'figma-publish-plan.json':JSON.stringify(designPlan,null,2)};
      for(const [name,content] of Object.entries(files))await fs.writeFile(path.join(outputDirectory,name),content,{mode:0o600});
      const structuredRunner=(prompt,schema,options)=>runCodexStructured(prompt,schema,{...options,timeoutMs:codexTimeoutMs(process.env.CODEX_FIGMA_TIMEOUT_MS||600000)});
      const published=await withExecutionContext({projectId:p.id,runId,stage:'FIGMA_DESIGN',provider:'codex',model:process.env.CODEX_MODEL||'codex-cli'},()=>publishFigmaDesign({project:p,designPack:handoff,runId,fileConfirmation:design.fileConfirmation,previewExporter:options=>exportFigmaPreview({...options,port:Number(process.env.FIGMA_RELAY_PORT||3055)}),documentKey:job.options.documentKey,channelId:job.options.channelId,revisionNotes:job.options.revisionNotes||'',screenIds:job.options.screenIds,mode:design.mode,imagePaths,outputDirectory,registry,assetResolver:({screenIds})=>resolveDesignAssets({project:p,screenIds,store:designAssets,runner:structuredRunner,outputDirectory}),assetImporter:createFigmaAssetImporter({channelId:job.options.channelId,documentKey:job.options.documentKey,runId,store:designAssets,projectId:p.id,port:Number(process.env.FIGMA_RELAY_PORT||3055)}),runner:structuredRunner}));
      const registryDir=figmaRegistryDirectory(dataDir,p.id,platform);await fs.mkdir(registryDir,{recursive:true,mode:0o700});
      const registryTarget=path.join(registryDir,`${job.options.documentKey}.json`),registryTemp=registryTarget+'.'+randomUUID()+'.tmp';
      try{await fs.writeFile(registryTemp,JSON.stringify(published.registry,null,2),{flag:'wx',mode:0o600});await fs.rename(registryTemp,registryTarget)}finally{await fs.rm(registryTemp,{force:true}).catch(()=>{})}
      const previewFiles=await figmaPreviews.write(p.id,{version:p.version,platform,runId,previews:published.previews});
      const next=completeFigmaDesign(p,{runId,projectVersion:p.version,manifestDigest:published.manifestDigest,screens:published.screens,previewFiles});
      delete next.figmaDesign.retainedAssets;delete next.figmaDesign.retainedAssetEvidence;next.figmaDesign.fileIdentity=published.fileIdentity;if(published.assets?.length){next.figmaDesign.assets=published.assets;next.figmaDesign.assetEvidence=published.assetEvidence;}next.version++;next.figmaDesign.projectVersion=next.version;next.figmaDesign.draft.projectVersion=next.version;delete next.figmaDesign.revisionNotes;next.updatedAt=new Date().toISOString();
      auditAs(next,'worker','FIGMA_DESIGN_READY_FOR_REVIEW',{runId,revision:next.figmaDesign.revision,manifestDigest:published.manifestDigest,screenIds:next.figmaDesign.draft.screenIds,projectVersion:next.version});
      store.attach(next,p._dbRevision,job.token);await save(next);store.finishJob(job.id,job.token,{resultVersion:next.version});
      logExecution('WORKER_FIGMA_DESIGN_COMPLETE',{projectId:p.id,runId,version:next.version,screens:previewFiles.length});return;
    }
    if(p.workflow?.runId!==job.run_id)throw new Error('Workflow run changed; queued job is stale');
    const result=await advanceWorkflow(p,job.options);
    store.finishJob(job.id,job.token,{resultVersion:result.version});
    logExecution('WORKER_JOB_COMPLETE',{projectId:job.project_id,runId:job.run_id,version:result.version});
  }catch(e){
    if(job.options?.kind==='figma-design'){
      const errorCode=FIGMA_DESIGN_FAILURE_CODES.includes(e?.code)?e.code:'DESIGN_FAILED';
      console.error('[BA Worker] Figma design failed',job.id,errorCode);
      try{const failed=await safeGet(job.project_id,job.token);if(failed.figmaDesign?.runId===job.run_id&&failed.figmaDesign.state==='QUEUED'){failed.figmaDesign.state='FAILED';failed.figmaDesign.errorCode=errorCode;failed.version++;failed.updatedAt=new Date().toISOString();auditAs(failed,'worker','FIGMA_DESIGN_FAILED',{runId:job.run_id,revision:failed.figmaDesign.revision,errorCode});await save(failed)}store.finishJob(job.id,job.token,{error:errorCode,retryable:false})}catch(x){console.error('[BA Worker] Figma failure finalization rejected:',x.message)}
    }else{
      console.error('[BA Worker] failed job',job.id,e.message);
      try{store.finishJob(job.id,job.token,{error:e.message,retryable:!(/Workflow run changed|queued job is stale/.test(e.message))})}catch(x){console.error('[BA Worker] finish rejected:',x.message)}
    }
  }finally{clearInterval(heartbeat);workerBusy=false}
}
if(process.env.BA_WORKER_ONLY==='true'||process.env.BA_WORKER_ENABLED!=='false'){
  const timer=setInterval(()=>tickWorker().catch(e=>console.error('[BA Worker]',e.message)),Number(process.env.BA_JOB_POLL_MS||1500));
  if(process.env.BA_WORKER_ONLY!=='true')timer.unref();
}
const shutdownRelay=()=>{figmaRelay.stop().catch(e=>console.error('[BA Figma relay] shutdown:',e.message)).finally(()=>server.close(()=>{store.db.close();process.exit(0)}))};
process.once('SIGTERM',shutdownRelay);process.once('SIGINT',shutdownRelay);
