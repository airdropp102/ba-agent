import {fingerprint} from './revisions.js';

/** Parse strictly scoped operator/MCP read-back; never confuse with visual approval. */
export function validateReadback(challenge,report,{project,manifest,registry,now=Date.now()}={}){
  if(!challenge||challenge.usedAt||new Date(challenge.expiresAt).getTime()<now)throw new Error('Readback challenge expired or consumed');
  if(challenge.runId!==project.workflow?.runId || challenge.projectId!==project.id)throw new Error('Readback workflow scope changed');
  if(project.workflow?.design?.manifestDigest!==challenge.manifestDigest)throw new Error('Readback manifest scope changed');
  if(fingerprint(JSON.stringify(manifest))!==challenge.manifestDigest)throw new Error('Manifest changed since challenge');
  if(report?.nonce!==challenge.nonce||report?.documentKey!==challenge.documentKey)throw new Error('Readback challenge/file mismatch');
  if(!report?.documentInfoRead||report?.documentInfoRead!==true)throw new Error('MCP document info read-back required');
  if(report?.reportedFileKey!==challenge.documentKey)throw new Error('MCP reported file key mismatch');
  if(!Array.isArray(report.screens)||report.screens.length!==challenge.screens.length)throw new Error('Every expected screen must be read back');
  if(registry?.documentKey!==challenge.documentKey||registry?.projectId!==project.id)throw new Error('Figma registry identity changed');
  const required=new Map(challenge.screens.map(s=>[s.screenId,s]));const seen=new Set();
  for(const screen of report.screens){
    const expected=required.get(screen.screenId);
    if(!expected||seen.has(screen.screenId))throw new Error('Unknown/duplicate readback screen');
    seen.add(screen.screenId);
    if(screen.nodeId!==expected.nodeId || screen.nodeId!==registry.screens[screen.screenId]?.nodeId)throw new Error('Node ID changed: '+screen.screenId);
    if(screen.nodeType!=='FRAME'||screen.nodeName!==expected.nodeName||screen.readbackOk!==true)throw new Error('Figma node mismatch: '+screen.screenId);
  }
  return {kind:'MCP_OPERATOR_REPORTED_READBACK_NOT_INDEPENDENT_ATTESTATION',nonce:challenge.nonce,documentKey:challenge.documentKey,runId:challenge.runId,manifestDigest:challenge.manifestDigest,screenCount:seen.size,reportDigest:fingerprint(JSON.stringify(report)),checkedAt:new Date(now).toISOString(),visualQA:'PENDING'};
}
