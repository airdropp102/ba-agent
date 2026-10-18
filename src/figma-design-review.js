import {designRunMode,sampleBinding} from './design-direction.js';
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

function selectedScreens(screenIds,known){
 if(!Array.isArray(screenIds)||!screenIds.length||screenIds.length>known.length||new Set(screenIds).size!==screenIds.length||screenIds.some(id=>!known.includes(id)))fail('Invalid selected screen IDs');
 return [...screenIds];
}

export function beginFigmaDesign(project,{documentKey,channelId,jobId,platform,screenIds,mode}={}){
 if(!project||!Number.isSafeInteger(project.version)||project.version<1)fail('Project version required for Figma design');
 if(project.review?.approved!==true)fail('BA Review is required before Figma design');
 if(!FILE_KEY.test(documentKey||''))fail('Invalid Figma document key');
 if(!CHANNEL.test(channelId||''))fail('Invalid Figma channel ID');
 if(typeof jobId!=='string'||!jobId.trim()||jobId.length>160)fail('Figma design job ID required');
 const planned=expectedScreens(project).map(s=>s.screenId);
 const previous=project.figmaDesign||{},previousPlatform=previous.platform||project.workflow?.platform||'web';
 platform=platform??previousPlatform;
 if(!['web','mobile'].includes(platform))fail('Invalid Figma platform');
 mode=designRunMode(project,{mode,platform,documentKey});
 if(mode==='sample')screenIds=undefined;
 if(screenIds!==undefined){
  screenIds=selectedScreens(screenIds,planned);
  const requested=previous.revisionScreenIds||(previous.state==='FAILED'?previous.screenIds:null);
  if(!['REVISION_REQUESTED','FAILED'].includes(previous.state)||!requested||JSON.stringify([...screenIds].sort())!==JSON.stringify([...requested].sort()))fail('Selected screen IDs must match the revision request');
  if(platform!==previousPlatform)fail('Selected screen revision cannot change platform');
  if(documentKey!==previous.documentKey)fail('Selected screen revision cannot change file');
 }
 const next=clone(project),prior=next.figmaDesign||{};
 if(mode==='sample')next.designSample=null;
 next.figmaDesign={
  state:'DESIGNING',runId:jobId,projectVersion:project.version,workflowRunId:project.workflow?.runId||null,
  documentKey,channelId,platform,mode,...(mode==='full'&&platform===previousPlatform&&documentKey===prior.documentKey?{retainedAssets:clone(prior.assets||[]),retainedAssetEvidence:clone(prior.assetEvidence||[])}:{}),...(screenIds?{screenIds}:{}),revision:(prior.revision||0)+1,history:Array.isArray(prior.history)?prior.history:[],
  startedAt:new Date().toISOString(),draft:null,approved:mode!=='sample'&&platform===previousPlatform&&documentKey===prior.documentKey?prior.approved||null:null
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
 const expected=expectedScreens(project).filter(s=>current.mode!=='sample'||s.screenId===project.designDirection?.sampleScreenId),expectedById=new Map(expected.map(s=>[s.screenId,s])),seen=new Set(),nodes=new Set();
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
 next.figmaDesign={...next.figmaDesign,state:current.mode==='sample'?'WAITING_SAMPLE_REVIEW':'WAITING_FOR_REVIEW',manifestDigest:manifestDigest.toLowerCase(),screens:normalized,
  draft:{projectVersion,manifestDigest:manifestDigest.toLowerCase(),screenIds:normalized.map(s=>s.screenId)},completedAt:new Date().toISOString()};
 return next;
}

export function reviewFigmaDesign(project,{decision,notes='',reviewerId,projectVersion,manifestDigest,screenIds}={}){
 const current=project?.figmaDesign;
 const reopenApproved=['APPROVED','SAMPLE_APPROVED'].includes(current?.state)&&decision==='REQUEST_CHANGES';
 if(!current||(!reopenApproved&&!['WAITING_FOR_REVIEW','WAITING_SAMPLE_REVIEW'].includes(current.state))||!current.draft)fail('No Figma design draft is waiting for review');
 if(!['APPROVE','REQUEST_CHANGES'].includes(decision))fail('Invalid Figma design review decision');
 if(typeof reviewerId!=='string'||!reviewerId.trim()||reviewerId.length>160)fail('Figma design reviewer identity required');
 if(typeof notes!=='string'||notes.length>3000)fail('Invalid Figma design review notes');
 if(decision==='REQUEST_CHANGES'&&!notes.trim())fail('Revision feedback is required');
 if(reopenApproved&&current.mode!=='sample'&&(current.approved?.projectVersion!==project.version||current.approved?.manifestDigest!==manifestDigest))fail('Stale approved Figma design');
 if(projectVersion!==project.version||projectVersion!==current.draft.projectVersion)fail('Stale Figma project version');
 if(manifestDigest!==current.manifestDigest||manifestDigest!==current.draft.manifestDigest)fail('Figma manifest mismatch');
 if(screenIds!==undefined){
  if(decision!=='REQUEST_CHANGES')fail('Selected screen IDs are only valid for revision requests');
  screenIds=selectedScreens(screenIds,current.draft.screenIds);
 }
 const next=clone(project),record={decision,mode:current.mode||'full',notes:notes.trim(),reviewerId:reviewerId.trim(),projectVersion,manifestDigest,platform:current.platform||project.workflow?.platform||'web',reviewedAt:new Date().toISOString(),screenIds:screenIds||[...current.draft.screenIds]};
 const history=[...(current.history||[]),record];
 next.figmaDesign={...next.figmaDesign,state:decision==='APPROVE'?(current.mode==='sample'?'SAMPLE_APPROVED':'APPROVED'):'REVISION_REQUESTED',history};
 if(decision==='REQUEST_CHANGES'){
  if(current.mode==='sample')next.designSample=null;
  delete next.figmaDesign.screenIds;
  if(screenIds)next.figmaDesign.revisionScreenIds=screenIds;
  else delete next.figmaDesign.revisionScreenIds;
 }
 if(decision==='APPROVE'){
  if(current.mode==='sample'){const screen=current.screens[0];next.designSample={state:'APPROVED',binding:sampleBinding(project,{platform:current.platform,documentKey:current.documentKey}),screenId:screen.screenId,nodeId:screen.nodeId,preview:clone(screen.preview),assets:clone(current.assets||[]),review:record};}
  else {next.figmaDesign.approved={projectVersion,manifestDigest,screens:clone(current.screens),review:record};if(project.designDirection&&next.designSample?.binding===sampleBinding(project,{platform:current.platform,documentKey:current.documentKey})){const sample=current.screens.find(s=>s.screenId===project.designDirection.sampleScreenId);if(sample){const assets=(current.assets||[]).filter(a=>a.screenIds?.includes(sample.screenId));next.designSample={...next.designSample,nodeId:sample.nodeId,preview:clone(sample.preview),...(assets.length?{assets:clone(assets)}:{})};}}}
  delete next.figmaDesign.channelId;
 }
 return next;
}
