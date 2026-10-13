/** v3.4 deterministic BA deliverable QA. This verifies structure/traceability,
 * NOT factual correctness, usability or customer sign-off. */
import {fingerprint,resolveEvidenceSource} from './revisions.js';
import {renderBRD,renderSRS} from './docs.js';
import {unresolvedHigh,hasCurrentWaiver} from './intelligent-workflow.js';

const rate=(n,d)=>d?Number((n/d).toFixed(3)):null;
const isText=x=>typeof x==='string' && x.trim().length>0;
const round=n=>Math.round(n*1000)/1000;
const weighted=[['evidence',0.25],['actors',0.15],['acceptance',0.2],['businessGoals',0.15],['documentTrace',0.15],['nfrMeasurability',0.1]];
/** Policy is explicit and bounded; absence of functional requirements is a hard block. */
export function qualityPolicy(env=process.env){
 const min=Number(env.BA_QUALITY_MIN_SCORE??0.8);
 if(!Number.isFinite(min)||min<0||min>1)throw new Error('BA_QUALITY_MIN_SCORE must be a number from 0 to 1');
 return {version:'ba-quality-intelligence-v3.4',minScore:min,enforce:env.BA_QUALITY_ENFORCE==='true'};
}
export function assessDeliverables(p,{policy=qualityPolicy(),brd,srs}={}){
 const a=p.analysis||{};const fr=a.functionalRequirements||[];const nfr=a.nonFunctionalRequirements||[];
 const sources=p.sources||[];const goals=new Set(a.businessGoals||[]);
 const docB=brd??(p.analysis?renderBRD(p):'');
 const docS=srs??(p.analysis?renderSRS(p):'');
 const traceIds=fr.filter(r=>isText(r.id)&&docB.includes(r.id)&&docS.includes(r.id));
 const confirmed=[...fr,...nfr,...(a.businessRules||[])].filter(r=>r.certainty==='confirmed');
 const grounded=confirmed.filter(r=>isText(r.sourceEvidence)&&resolveEvidenceSource(r.sourceEvidence,sources)!==null);
 const missing=[];
 if(!fr.length)missing.push({code:'NO_FUNCTIONAL_REQUIREMENTS',severity:'BLOCK',detail:'No FR to validate'});
 for(const r of fr){
  if(r.certainty==='confirmed'&&!grounded.includes(r))missing.push({code:'UNTRUSTED_CONFIRMED_EVIDENCE',severity:'BLOCK',requirementId:r.id});
  if(!isText(r.actor))missing.push({code:'ACTOR_MISSING',severity:'WARN',requirementId:r.id});
  if(!r.acceptanceCriteria?.some(isText))missing.push({code:'AC_MISSING',severity:'WARN',requirementId:r.id});
  if(!goals.has(r.relatedBusinessGoal)||!isText(r.relatedBusinessGoal))missing.push({code:'GOAL_UNMAPPED',severity:'WARN',requirementId:r.id});
  if(!traceIds.includes(r))missing.push({code:'DOC_TRACE_MISSING',severity:'BLOCK',requirementId:r.id});
 }
 for(const item of [...nfr,...(a.businessRules||[])])if(item.certainty==='confirmed'&&!grounded.includes(item))missing.push({code:'UNTRUSTED_CONFIRMED_EVIDENCE',severity:'BLOCK',requirementId:item.id});
 const high=unresolvedHigh(p);
 if(high.length&&!hasCurrentWaiver(p))missing.push({code:'HIGH_CLARIFICATIONS_PENDING',severity:'WARN',count:high.length});
 if(!p.review?.approved)missing.push({code:'BA_REVIEW_REQUIRED',severity:'WARN'});
 const measurable=nfr.filter(r=>isText(r.measurableTarget)&&!/^(tbd|chưa|unknown)/i.test(r.measurableTarget.trim())).length;
 const rates={
  evidence:rate(grounded.length,confirmed.length), // null if there are no confirmed BR/FR/NFR items
  actors:rate(fr.filter(r=>isText(r.actor)).length,fr.length),
  acceptance:rate(fr.filter(r=>r.acceptanceCriteria?.some(isText)).length,fr.length),
  businessGoals:rate(fr.filter(r=>goals.has(r.relatedBusinessGoal)&&isText(r.relatedBusinessGoal)).length,fr.length),
  documentTrace:rate(traceIds.length,fr.length),
  nfrMeasurability:rate(measurable,nfr.length)
 };
 // Null components are excluded from weighted denominator, not interpreted as 100%.
 let numerator=0,denominator=0;
 for(const [key,weight] of weighted)if(rates[key]!==null){numerator+=rates[key]*weight;denominator+=weight}
 const score=fr.length>0&&denominator?round(numerator/denominator):null;
 const blockers=missing.filter(f=>f.severity==='BLOCK');
 const passed=score!==null&&score>=policy.minScore&&!missing.length;
 return {
  schemaVersion:'ba.quality-intelligence.v3.4',kind:'deterministic-structure-and-evidence-proxy-not-semantic-certification',
  projectId:p.id||null,runId:p.workflow?.runId||null,projectVersion:p.version||null,
  inputDigest:fingerprint(JSON.stringify({brief:p.brief,analysis:p.analysis,review:p.review,prototype:p.prototype})),
  policy,score,scorePercent:score===null?null:round(score*100),rates,
  counts:{functionalRequirements:fr.length,confirmedRequirements:confirmed.length,groundedConfirmed:grounded.length,nonFunctionalRequirements:nfr.length,documentTraces:traceIds.length,findings:missing.length},
  findings:missing,decision:passed?'PASS':blockers.length?'BLOCK':'REVIEW',
  enforceable:policy.enforce,passed,
  caveat:'A PASS does not imply business correctness, verified source authenticity, customer approval, or Figma visual quality.'
 };
}
