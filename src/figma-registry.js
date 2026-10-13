import {fingerprint} from './revisions.js';

/** Registry must be scoped to one Figma file; only verified nodes enter it. */
export function buildPublishPlan(manifest,registry=null) {
  const old=registry?.screens||{};
  return {
    schemaVersion:'ba.figma.publish.v1',projectId:manifest.project.id,projectVersion:manifest.project.version,
    platform:manifest.platform,documentKey:registry?.documentKey||null,
    screens:(manifest.screens||[]).map(screen=>{
      const sha256=fingerprint(JSON.stringify({platform:manifest.platform,designSourceDigest:manifest.designSourceDigest||'',screen}));
      const previous=old[screen.id];
      return {screenId:screen.id,sha256,action:previous?.verified && previous.sha256===sha256?'skip':'create',previousNodeId:previous?.verified?previous.nodeId:null,requirements:screen.requirementIds||[]};
    })
  };
}
export function acceptVerifiedFigmaReport(plan,report,{documentKey,registry=null}={}) {
  if(!documentKey || !/^[\w-]{3,128}$/.test(documentKey))throw new Error('Invalid documentKey');
  if(report?.documentKey!==documentKey)throw new Error('Figma document mismatch');
  if(registry && (registry.documentKey!==documentKey || registry.projectId!==plan.projectId))throw new Error('Figma registry scope mismatch');
  if(!Array.isArray(report.screens))throw new Error('Missing Figma screen report');
  const result={schemaVersion:'ba.figma.registry.v1',documentKey,projectId:plan.projectId,
    screens:{...(registry?.screens||{})},lastVerifiedAt:new Date().toISOString()};
  const expected=new Map(plan.screens.map(s=>[s.screenId,s]));
  const reported=new Set();
  const nodeIds=new Set(Object.values(registry?.screens||{}).filter(x=>x.verified).map(x=>x.nodeId));
  let completed=0;
  for (const item of report.screens||[]) {
    const entry=expected.get(item.screenId);
    if(!entry || reported.has(item.screenId))throw new Error('Unknown or duplicate Figma screen ID: '+item.screenId);
    reported.add(item.screenId);
    if(entry.action==='skip')throw new Error('Unrequested Figma screen report for skipped screen: '+item.screenId);
    if(item.verified!==true || !/^\d+:\d+$/.test(String(item.nodeId||'')))throw new Error(`Figma node not verified: ${item.screenId}`);
    if(nodeIds.has(item.nodeId))throw new Error('Duplicate or reused Figma node ID: '+item.nodeId);
    nodeIds.add(item.nodeId);
    result.screens[item.screenId]={nodeId:item.nodeId,sha256:entry.sha256,verified:true,verifiedAt:new Date().toISOString(),version:plan.projectVersion};
    completed++;
  }
  const missing=plan.screens.filter(s=>s.action==='create'&&!reported.has(s.screenId));
  if(missing.length)throw new Error('Missing verified Figma screens: '+missing.map(s=>s.screenId).join(', '));
  return {registry:result,completed,skipped:plan.screens.filter(s=>s.action==='skip').length};
}
