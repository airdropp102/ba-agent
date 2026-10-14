import {randomUUID} from 'node:crypto';
import {fingerprint,resolveEvidenceSource} from './revisions.js';

/** Durable single-agent workflow: no remote publish without explicit operator action. */
export const WORKFLOW_STAGES=['BRAINSTORM','ELICITATION','GAP_ANALYSIS','CLARIFICATION','BA_REVIEW','DELIVERABLES'];
// Legacy IDs remain ordered for invalidating old checkpoints, never scheduled anew.
const stageIndex=s=>[...WORKFLOW_STAGES,'FIGMA_DESIGN','FIGMA_PUBLISH'].indexOf(s);
const stamp=()=>new Date().toISOString();
export function ensureWorkflow(project){
  if(!project.workflow){
    project.workflow={schemaVersion:'ba.workflow.v3.2',runId:randomUUID(),stage:'BRAINSTORM',state:'READY',platform:'web',checkpoints:[],attempts:[],lastError:null,waiver:null,artifactDir:null,createdAt:stamp(),updatedAt:stamp()};
  }
  return project.workflow;
}
export function analysisSignature(p){return fingerprint(JSON.stringify({brief:p.brief,analysis:p.analysis}));}
export function unresolvedHigh(p){
  const resolvedOrigins=new Set((p.analysis?.clarificationQuestions||[]).filter(q=>q.status==='resolved'&&q.resolutionId).map(q=>q.origin).filter(Boolean));
  const high=(p.analysis?.quality?.findings||[]).filter(f=>f.priority==='High'&&(!resolvedOrigins.has(f.id)||['UNVERIFIED_REQUIREMENT','UNVERIFIED_NFR'].includes(f.code))).map(f=>({id:f.id,type:'GAP',text:f.question,requirementId:f.requirementId||''}));
  const pending=(p.analysis?.clarificationQuestions||[]).filter(q=>q.priority==='High' && q.status!=='resolved').map(q=>({id:q.id,type:'QUESTION',text:q.question,requirementId:q.relatedRequirementId||''}));
  // An answer remains pending BA review; it does not silently close a question.
  return [...high,...pending];
}
export function hasCurrentWaiver(p){return !!(p.workflow?.waiver?.analysisSignature===analysisSignature(p) && p.workflow.waiver.blockerDigest===fingerprint(JSON.stringify(unresolvedHigh(p))));}
export function acceptClarificationRisk(p,{rationale,blockerIds}={}){
  const wf=ensureWorkflow(p);
  if(wf.stage!=='CLARIFICATION'||!p.analysis)throw Object.assign(new Error('Clarification gate is not active'),{status:409});
  const blockers=unresolvedHigh(p);
  if(!blockers.length)throw Object.assign(new Error('No unresolved high-priority items'),{status:409});
  if(typeof rationale!=='string'||rationale.trim().length<20||rationale.length>3000)throw Object.assign(new Error('Rationale must be 20-3000 characters'),{status:400});
  const expected=[...new Set(blockers.map(b=>b.id))].sort();
  if(!Array.isArray(blockerIds)||blockerIds.length!==expected.length||JSON.stringify([...new Set(blockerIds)].sort())!==JSON.stringify(expected))throw Object.assign(new Error('Provide all current high-priority blocker IDs (no partial silent waiver)'),{status:400});
  wf.waiver={kind:'BA_ACCEPTED_RISK_NOT_CUSTOMER_APPROVAL',analysisSignature:analysisSignature(p),blockerDigest:fingerprint(JSON.stringify(blockers)),blockerIds:expected,rationale:rationale.trim(),at:stamp()};
  wf.state='READY';wf.updatedAt=stamp();
  return wf;
}
export function isBlocked(p){return unresolvedHigh(p).length>0&&!hasCurrentWaiver(p);}
export function hasActiveWorkflow(p){return !!(p.workflow && (p.workflow.checkpoints?.length || p.workflow.currentAttempt || p.workflow.state==='FAILED' || p.workflow.state?.startsWith('WAITING_') || p.workflow.state==='AWAITING_FIGMA'));}
export function invalidateAfterAnalysis(p,{full=false}={}){
  if(!hasActiveWorkflow(p))return;
  const wf=p.workflow;
  wf.stage=full?'BRAINSTORM':'GAP_ANALYSIS';wf.state='READY';wf.waiver=null;wf.artifactDir=null;wf.design=null;wf.figmaResult=null;wf.gapReport=null;wf.lastError=null;wf.currentAttempt=null;
  wf.checkpoints=(wf.checkpoints||[]).filter(c=>stageIndex(c.stage)<stageIndex(wf.stage));
  wf.updatedAt=stamp();
}
export function checkpoint(p,stage,meta={}){
  const wf=ensureWorkflow(p);
  const record={stage,completedAt:stamp(),inputDigest:fingerprint(JSON.stringify({brief:p.brief,analysis:p.analysis,review:p.review,prototype:p.prototype})),...meta};
  wf.checkpoints=[...(wf.checkpoints||[]),record].slice(-80);
  wf.currentAttempt=null;wf.lastError=null;wf.updatedAt=stamp();return record;
}
export function nextStage(stage){const i=stageIndex(stage);if(i<0||i===WORKFLOW_STAGES.length-1)return stage;return WORKFLOW_STAGES[i+1];}
export function qualitySnapshot(p){
  const a=p.analysis||{};
  const fr=a.functionalRequirements||[];
  const confirmedWithSource=fr.filter(x=>x.certainty==='confirmed'&&x.sourceEvidence&&resolveEvidenceSource(x.sourceEvidence,p.sources||[])).length;
  const quantified={
    frCount:fr.length,confirmedEvidenceRate:fr.length?Number((confirmedWithSource/fr.length).toFixed(3)):0,
    actorCoverage:fr.length?Number((fr.filter(x=>x.actor).length/fr.length).toFixed(3)):0,
    acceptanceCoverage:fr.length?Number((fr.filter(x=>x.acceptanceCriteria?.length).length/fr.length).toFixed(3)):0,
    goalTraceCoverage:fr.length?Number((fr.filter(x=>x.relatedBusinessGoal && a.businessGoals?.includes(x.relatedBusinessGoal)).length/fr.length).toFixed(3)):0,
    highGapCount:a.quality?.counts?.high||0,highBlockerCount:unresolvedHigh(p).length,
  };
  return {kind:'deterministic-completeness-check-not-semantic-certification',...quantified,questions:(a.clarificationQuestions||[]).length,risks:(a.risks||[]).length};
}
export function designCoverage(p,manifest){
  const reqIds=(p.analysis?.functionalRequirements||[]).map(x=>x.id);
  const covered=new Set((manifest.screens||[]).flatMap(s=>s.requirementIds||[]));
  return {requirements:reqIds.length,covered:reqIds.filter(id=>covered.has(id)).length,unmapped:reqIds.filter(id=>!covered.has(id))};
}
