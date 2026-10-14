import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProductionStore} from '../src/production-store.js';
import {ProjectWorkspaces} from '../src/project-workspaces.js';
import {sampleTitle,sampleBrief,demoAnalysis,demoPrototype} from '../src/demo.js';
import {normalizeAnalysis,normalizePrototype} from '../src/normalize.js';
import {buildFigmaHandoff} from '../src/figma-handoff.js';
import {buildPublishPlan,acceptVerifiedFigmaReport} from '../src/figma-registry.js';
import {recordFigmaFileConfirmation} from '../src/figma-design-review.js';
import {recoverFigmaPreviewDraft} from '../src/figma-design-recovery.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=';
test('failed preview recovery reuses registered frames and preserves history/review gates; stale scope is rejected',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'ba-preview-recovery-')),store=new ProductionStore(dir);
 try{
  const analysis=normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief),id=randomUUID(),runId=randomUUID(),channelId='fixture-channel',documentKey='fixture-file';
  const source={id,title:sampleTitle,brief:sampleBrief,status:'GENERATED',version:4,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),analysis,prototype:normalizePrototype(demoPrototype(analysis),analysis),review:{approved:true,customerApproved:false},workflow:{runId:randomUUID(),platform:'web'}};
  source.figmaDesign={state:'QUEUED',runId,projectVersion:4,workflowRunId:source.workflow.runId,documentKey,channelId,history:[],approved:null};
  source.figmaDesign.fileConfirmation=recordFigmaFileConfirmation(source,{confirmed:true,runId,documentKey,channelId,projectVersion:4,confirmedBy:'fixture-operator'});store.save(source);
  const pack=buildFigmaHandoff(source),plan=buildPublishPlan(pack.manifest);
  const registry=acceptVerifiedFigmaReport(plan,{documentKey,screens:plan.screens.map((screen,i)=>({screenId:screen.screenId,nodeId:`1:${i+1}`,verified:true})),notes:'OFFLINE FIXTURE'},{documentKey}).registry;
  const workspaces=new ProjectWorkspaces(store),registryDir=path.join(workspaces.root(id),'04-figma','registry');await mkdir(registryDir,{recursive:true});await writeFile(path.join(registryDir,`${documentKey}.json`),JSON.stringify(registry));
  await mkdir(path.join(workspaces.root(id),'04-figma','exports','v4-web'),{recursive:true});
  const failed=store.get(id);failed.version=5;failed.figmaDesign.state='FAILED';failed.figmaDesign.errorCode='DESIGN_FAILED';store.save(failed);
  let draws=0,exports=0;const runner=async prompt=>{if(!prompt.includes('READ-ONLY CONNECTION PREFLIGHT'))draws++;return {connected:true,documentKey:'',failureCode:'FILE_KEY_UNAVAILABLE'}};
  const options={store,projectId:id,channelId,expectedVersion:5,runner,previewExporter:async({screenId})=>{exports++;return {screenId,contentType:'image/png',base64:png}}};
  await assert.rejects(recoverFigmaPreviewDraft({...options,expectedVersion:4}),/exact failed project version/);
  await assert.rejects(recoverFigmaPreviewDraft({...options,channelId:'other-channel'}),/confirmation mismatch/);
  const result=await recoverFigmaPreviewDraft(options);assert.equal(draws,0);assert.equal(exports,source.prototype.screens.length);assert.equal(result.state,'WAITING_FOR_REVIEW');
  const restored=store.get(id);assert.equal(restored.version,6);assert.equal(restored.figmaDesign.draft.projectVersion,6);assert.equal(restored.figmaDesign.approved,null);assert.deepEqual(restored.review,source.review);
  assert.equal(store.version(id,5).figmaDesign.state,'FAILED');assert.equal(store.verifyAudit(id).valid,true);
  assert.ok(restored.figmaDesign.screens.every(screen=>screen.preview.contentType==='image/png'&&screen.preview.path.endsWith('.png')));
  await assert.rejects(recoverFigmaPreviewDraft({...options,expectedVersion:6}),/exact failed project version/);
 }finally{store.db.close();await rm(dir,{recursive:true,force:true})}
});
