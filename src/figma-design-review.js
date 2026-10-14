import {createHash} from 'node:crypto';
const FILE_KEY=/^[\w-]{3,128}$/;
const CHANNEL=/^[A-Za-z0-9_-]{1,128}$/;
const NODE=/^\d+:\d+$/;
const SHA=/^[a-f0-9]{64}$/i;
const MAX_PREVIEW=5*1024*1024;
const clone=value=>structuredClone(value);
const fail=message=>{throw new Error(message)};

export function recordFigmaFileConfirmation(project,{confirmed,runId,documentKey,channelId,projectVersion,confirmedBy}={}){
 if(confirmed!==true)return null;
 if(!FILE_KEY.test(documentKey||'')||!CHANNEL.test(channelId||'')||!runId||!Number.isSafeInteger(projectVersion)||!confirmedBy)fail('Invalid Figma file confirmation scope');
 return {source:'OPERATOR_FILE_CONFIRMATION_NOT_INDEPENDENT_ATTESTATION',projectId:project.id,projectVersion,runId,documentKey,channelDigest:createHash('sha256').update(channelId).digest('hex'),confirmedBy,confirmedAt:new Date().toISOString()};
}
export function validFigmaFileConfirmation(confirmation,{project,runId,documentKey,channelId}={}){
 return Boolean(confirmation&&confirmation.source==='OPERATOR_FILE_CONFIRMATION_NOT_INDEPENDENT_ATTESTATION'&&confirmation.projectId===project?.id&&confirmation.projectVersion===project?.version&&confirmation.runId===runId&&confirmation.documentKey===documentKey&&typeof channelId==='string'&&confirmation.channelDigest===createHash('sha256').update(channelId).digest('hex')&&typeof confirmation.confirmedBy==='string'&&confirmation.confirmedBy.trim()&&Number.isFinite(Date.parse(confirmation.confirmedAt)));
}

export function parseFigmaDesignInput({fileUrl,channelId}={}){
 if(typeof fileUrl!=='string'||fileUrl.length>2048)fail('Invalid Figma URL');
 let url;try{url=new URL(fileUrl)}catch{fail('Malformed Figma URL')}
 if(url.protocol!=='https:')fail('Figma URL must use HTTPS');
 if(url.username||url.password||url.port)fail('Unsupported Figma URL authority');
 const host=url.hostname.toLowerCase();
 if(host!=='figma.com'&&!host.endsWith('.figma.com'))fail('URL host must be figma.com');
 const match=url.pathname.match(/^\/(?:design|file)\/([^/]+)(?:\/|$)/);
 if(!match||!FILE_KEY.test(match[1]))fail('Unsupported Figma file URL path');
 if(typeof channelId!=='string'||!CHANNEL.test(channelId))fail('Invalid Figma channel ID');
 return {documentKey:match[1],channelId};
}

function expectedScreens(project){
 const screens=project?.prototype?.screens;
 if(!Array.isArray(screens)||!screens.length)fail('Figma design requires planned prototype screens');
 const ids=new Set();
 return screens.map(screen=>{
  if(!screen||typeof screen.id!=='string'||!screen.id||ids.has(screen.id))fail('Prototype screen IDs must be unique');
  ids.add(screen.id);
  const requirements=Array.isArray(screen.requirementIds)?[...new Set(screen.requirementIds)]:[];
  if(!requirements.length)fail(`Screen has no FR coverage: ${screen.id}`);
  const known=new Set((project.analysis?.functionalRequirements||[]).map(item=>item.id));
  if(requirements.some(id=>!known.has(id)))fail(`Screen has invalid FR coverage: ${screen.id}`);
  return {screenId:screen.id,requirementIds:requirements};
 });
}

export function beginFigmaDesign(project,{documentKey,channelId,jobId}={}){
 if(!project||!Number.isSafeInteger(project.version)||project.version<1)fail('Project version required for Figma design');
 if(project.review?.approved!==true)fail('BA Review is required before Figma design');
 if(!FILE_KEY.test(documentKey||''))fail('Invalid Figma document key');
 if(!CHANNEL.test(channelId||''))fail('Invalid Figma channel ID');
 if(typeof jobId!=='string'||!jobId.trim()||jobId.length>160)fail('Figma design job ID required');
 expectedScreens(project);
 const next=clone(project),prior=next.figmaDesign||{};
 next.figmaDesign={
  state:'DESIGNING',runId:jobId,projectVersion:project.version,workflowRunId:project.workflow?.runId||null,
  documentKey,channelId,revision:(prior.revision||0)+1,history:Array.isArray(prior.history)?prior.history:[],
  startedAt:new Date().toISOString(),draft:null,approved:prior.approved||null
 };
 return next;
}

function normalizePreview(file,screenId){
 if(!file||file.screenId!==screenId||!['image/jpeg','image/png'].includes(file.contentType))fail(`Missing valid JPEG preview: ${screenId}`);
 if(typeof file.path!=='string'||file.path.startsWith('/')||file.path.includes('\\')||file.path.split('/').some(x=>x==='..'||x==='.'||!x))fail(`Invalid preview path: ${screenId}`);
 if(!/^04-figma\/exports\/v\d+-(?:web|mobile)\/previews\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,80}\.(?:jpg|png)$/i.test(file.path))fail(`Invalid preview path: ${screenId}`);
 if(!SHA.test(file.sha256||'')||!Number.isSafeInteger(file.sizeBytes)||file.sizeBytes<4||file.sizeBytes>MAX_PREVIEW)fail(`Invalid JPEG preview metadata: ${screenId}`);
 if(!file.path.endsWith(file.contentType==='image/png'?'.png':'.jpg'))fail(`Preview type/path mismatch: ${screenId}`);
 return {screenId,path:file.path,contentType:file.contentType,sha256:file.sha256.toLowerCase(),sizeBytes:file.sizeBytes};
}

export function completeFigmaDesign(project,{runId,projectVersion,manifestDigest,screens,previewFiles}={}){
 const current=project?.figmaDesign;
 if(!current||current.state!=='DESIGNING'||current.runId!==runId)fail('Figma design run is stale or inactive');
 if(projectVersion!==project.version||projectVersion!==current.projectVersion)fail('Stale Figma project version');
 if((project.workflow?.runId||null)!==current.workflowRunId)fail('Stale Figma workflow run');
 if(!SHA.test(manifestDigest||''))fail('Invalid Figma manifest digest');
 if(!Array.isArray(screens)||!Array.isArray(previewFiles))fail('Figma screens and previews are required');
 const expected=expectedScreens(project),expectedById=new Map(expected.map(s=>[s.screenId,s])),seen=new Set(),nodes=new Set();
 const fileById=new Map();
 for(const file of previewFiles){if(!file||typeof file.screenId!=='string'||fileById.has(file.screenId))fail('Duplicate or invalid Figma preview');fileById.set(file.screenId,file);}
 if(screens.length!==expected.length||fileById.size!==expected.length)fail('Incomplete Figma screen or preview coverage');
 const normalized=screens.map(screen=>{
  const planned=expectedById.get(screen?.screenId);
  if(!planned||seen.has(screen.screenId))fail('Unknown or duplicate Figma screen ID');seen.add(screen.screenId);
  if(screen.verified!==true||!NODE.test(String(screen.nodeId||'')))fail(`Figma node not verified: ${screen.screenId}`);
  if(nodes.has(screen.nodeId))fail('Duplicate Figma node ID');nodes.add(screen.nodeId);
  const ids=Array.isArray(screen.requirementIds)?screen.requirementIds:[];
  if(ids.length!==planned.requirementIds.length||planned.requirementIds.some(id=>!ids.includes(id)))fail(`Incomplete FR coverage: ${screen.screenId}`);
  return {screenId:screen.screenId,nodeId:screen.nodeId,verified:true,requirementIds:[...planned.requirementIds],preview:normalizePreview(fileById.get(screen.screenId),screen.screenId)};
 });
 const next=clone(project);
 next.figmaDesign={...next.figmaDesign,state:'WAITING_FOR_REVIEW',manifestDigest:manifestDigest.toLowerCase(),screens:normalized,
  draft:{projectVersion,manifestDigest:manifestDigest.toLowerCase(),screenIds:normalized.map(s=>s.screenId)},completedAt:new Date().toISOString()};
 return next;
}

export function reviewFigmaDesign(project,{decision,notes='',reviewerId,projectVersion,manifestDigest}={}){
 const current=project?.figmaDesign;
 const reopenApproved=current?.state==='APPROVED'&&decision==='REQUEST_CHANGES';
 if(!current||(!reopenApproved&&current.state!=='WAITING_FOR_REVIEW')||!current.draft)fail('No Figma design draft is waiting for review');
 if(!['APPROVE','REQUEST_CHANGES'].includes(decision))fail('Invalid Figma design review decision');
 if(typeof reviewerId!=='string'||!reviewerId.trim()||reviewerId.length>160)fail('Figma design reviewer identity required');
 if(typeof notes!=='string'||notes.length>3000)fail('Invalid Figma design review notes');
 if(decision==='REQUEST_CHANGES'&&!notes.trim())fail('Revision feedback is required');
 if(reopenApproved&&(current.approved?.projectVersion!==project.version||current.approved?.manifestDigest!==manifestDigest))fail('Stale approved Figma design');
 if(projectVersion!==project.version||projectVersion!==current.draft.projectVersion)fail('Stale Figma project version');
 if(manifestDigest!==current.manifestDigest||manifestDigest!==current.draft.manifestDigest)fail('Figma manifest mismatch');
 const next=clone(project),record={decision,notes:notes.trim(),reviewerId:reviewerId.trim(),projectVersion,manifestDigest,reviewedAt:new Date().toISOString(),screenIds:[...current.draft.screenIds]};
 const history=[...(current.history||[]),record];
 next.figmaDesign={...next.figmaDesign,state:decision==='APPROVE'?'APPROVED':'REVISION_REQUESTED',history};
 if(decision==='APPROVE'){
  next.figmaDesign.approved={projectVersion,manifestDigest,screens:clone(current.screens),review:record};
  delete next.figmaDesign.channelId;
 }
 return next;
}
