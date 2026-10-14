import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {buildFigmaHandoff} from './figma-handoff.js';
import {buildPublishPlan} from './figma-registry.js';
import {publishFigmaDesign} from './figma-publisher.js';
import {completeFigmaDesign,validFigmaFileConfirmation} from './figma-design-review.js';
import {FigmaPreviewStore} from './figma-preview-store.js';
import {ProjectWorkspaces} from './project-workspaces.js';
import {exportFigmaPreview} from './figma-preview-export.js';

/** Re-export existing verified frames after a failed preview pass; never redraw, approve, or rewrite failed job history. */
export async function recoverFigmaPreviewDraft({store,projectId,channelId,expectedVersion,runner,previewExporter=exportFigmaPreview}={}){
 const current=store.get(projectId),design=current.figmaDesign;
 if(current.version!==expectedVersion||design?.state!=='FAILED'||!design.fileConfirmation)throw new Error('Recovery requires the exact failed project version and file confirmation');
 const source=store.version(projectId,design.projectVersion);
 if(source.figmaDesign?.runId!==design.runId)throw new Error('Recovery run scope mismatch');
 if(!validFigmaFileConfirmation(design.fileConfirmation,{project:source,runId:design.runId,documentKey:design.documentKey,channelId}))throw new Error('Recovery file/channel confirmation mismatch');
 const handoff=buildFigmaHandoff(source,{platform:source.workflow?.platform||'web'});
 const currentAtSourceVersion={...current,version:source.version};
 if(JSON.stringify(buildFigmaHandoff(currentAtSourceVersion,{platform:source.workflow?.platform||'web'}).manifest)!==JSON.stringify(handoff.manifest))throw new Error('Requirements changed after the failed design; recovery is blocked');
 const workspaces=new ProjectWorkspaces(store),root=workspaces.root(projectId),platform=source.workflow?.platform||'web';
 const registry=JSON.parse(await fs.readFile(path.join(root,'04-figma','registry',`${design.documentKey}.json`),'utf8'));
 const ids=new Set(source.prototype.screens.map(screen=>screen.id)),plan=buildPublishPlan(handoff.manifest,registry);
 const planned=plan.screens.filter(screen=>ids.has(screen.screenId));
 if(planned.length!==ids.size||planned.some(screen=>screen.action!=='skip'))throw new Error('Recovery requires matching registered frames for every prototype screen; no drawing is permitted');
 const outputDirectory=path.join(root,'04-figma','exports',`v${source.version}-${platform}`);
 const result=await publishFigmaDesign({project:source,designPack:handoff,runId:design.runId,fileConfirmation:design.fileConfirmation,documentKey:design.documentKey,channelId,registry,outputDirectory,runner,previewExporter});
 if(result.completed!==0)throw new Error('Recovery unexpectedly requested frame creation');
 const recoveryId=randomUUID(),files=await new FigmaPreviewStore(store).write(projectId,{version:source.version,platform,runId:recoveryId,previews:result.previews});
 const reportPath=path.join(outputDirectory,`preview-recovery-${recoveryId}.json`);
 await fs.writeFile(reportPath,JSON.stringify({runId:design.runId,recoveryId,sourceVersion:source.version,manifestDigest:result.manifestDigest,fileIdentity:result.fileIdentity,screens:result.screens,previewFiles:files},null,2),{flag:'wx',mode:0o600});
 const lease=store.acquireLease(projectId);
 try{
  const latest=store.get(projectId,{leaseToken:lease});
  if(latest.version!==expectedVersion||JSON.stringify(latest)!==JSON.stringify(current))throw new Error('Project changed during preview recovery');
  const working={...latest,version:source.version,figmaDesign:{...latest.figmaDesign,state:'DESIGNING'}};
  const next=completeFigmaDesign(working,{runId:design.runId,projectVersion:source.version,manifestDigest:result.manifestDigest,screens:result.screens,previewFiles:files});
  next.version=latest.version+1;next.figmaDesign.projectVersion=next.version;next.figmaDesign.draft.projectVersion=next.version;
  next.figmaDesign.fileIdentity=result.fileIdentity;next.figmaDesign.recovery={id:recoveryId,sourceVersion:source.version,failedVersion:expectedVersion,report:path.relative(root,reportPath),reportSha256:createHash('sha256').update(await fs.readFile(reportPath)).digest('hex')};
  delete next.figmaDesign.errorCode;delete next.figmaDesign.revisionNotes;next.updatedAt=new Date().toISOString();
  store.attach(next,latest._dbRevision,lease);
  store.save(next,{actorId:design.fileConfirmation.confirmedBy,eventType:'FIGMA_PREVIEWS_RECOVERED_NOT_APPROVED',details:{runId:design.runId,recoveryId,sourceVersion:source.version,projectVersion:next.version,screenIds:result.screens.map(screen=>screen.screenId),identitySource:result.fileIdentity.source}});
  await workspaces.exportProject(next);
  return {projectId,version:next.version,state:next.figmaDesign.state,screens:result.screens.length,recoveryId};
 }finally{store.releaseLease(projectId,lease)}
}
