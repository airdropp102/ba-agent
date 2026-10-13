import {recordDecision} from './clarification-recommendations.js';
import {fingerprint,buildSources} from './revisions.js';
const bad=message=>Object.assign(new Error(message),{status:400});
/** Validate against a single snapshot; mutate only after every entry validates. */
export function applyClarificationBatch(p,items,actor){
 if(!p.analysis)throw bad('Analyze before answering questions');
 if(!Array.isArray(items)||!items.length||items.length>100)throw bad('Batch requires 1-100 answers');
 const snapshot=structuredClone(p),next=structuredClone(p),ids=new Set(),decisions=[];
 next.sources=next.sources||buildSources(next.brief);next.answers=next.answers||[];
 for(const entry of items){
  if(!entry||typeof entry.questionId!=='string')throw bad('Invalid question ID');
  if(ids.has(entry.questionId))throw bad('Duplicate question in batch');ids.add(entry.questionId);
  const q=snapshot.analysis.clarificationQuestions.find(q=>q.id===entry.questionId);
  if(!q||q.status==='resolved')throw bad('Open question not found');
  if(entry.kind==='option'){
   const isolated=structuredClone(snapshot);const decision=recordDecision(isolated,entry,actor);
   decisions.push(decision);next.answers.push(isolated.answers.at(-1));
  }else if(entry.kind==='custom'){
   const values={};for(const key of ['answer','respondent','sourceReference']){if(typeof entry[key]!=='string')throw bad('Answer, respondent and source reference required');values[key]=entry[key].trim();}
   const {answer,respondent,sourceReference}=values;
   if(answer.length<3||answer.length>12000||respondent.length<2||respondent.length>160||sourceReference.length<3||sourceReference.length>300)throw bad('Invalid answer, respondent or source reference');
   const at=new Date().toISOString(),existing=new Set(next.sources.map(s=>s.id));let number=next.sources.length+1;while(existing.has(`SRC-${String(number).padStart(3,'0')}`))number++;
   const source={id:`SRC-${String(number).padStart(3,'0')}`,type:'customer-response',text:answer,respondent,sourceReference,questionId:entry.questionId,at};
   next.sources.push(source);next.answers.push({questionId:entry.questionId,...values,sourceId:source.id,at});
   next.brief+=`\n\n=== CUSTOMER RESPONSE TO ${entry.questionId} (source: ${sourceReference}; respondent: ${respondent}) ===\n${answer}`;
  }else throw bad('Invalid answer kind');
 }
 if(next.brief.length>100000)throw bad('Brief exceeds 100000 characters');
 // New choices are authorized together with this batch's sourced responses.
 for(const decision of decisions)decision.briefDigest=fingerprint(next.brief);
 for(const d of next.clarificationDecisions||[])if(d.briefDigest!==fingerprint(next.brief)&&d.status==='APPROVED')d.status='STALE_BRIEF_CHANGED';
 next.clarificationDecisions=[...(next.clarificationDecisions||[]),...decisions];
 next.analysis.clarificationQuestions=next.analysis.clarificationQuestions.map(q=>ids.has(q.id)?{...q,status:decisions.some(d=>d.questionId===q.id)?'resolved':'answered-pending-ba-review'}:q);
 next.clarificationRecommendations=[];next.requirementsRefreshPending=true;next.review=null;next.previousPrototype=next.prototype||next.previousPrototype||null;next.prototype=null;next.status='ANALYZED';
 Object.assign(p,next);return {saved:items.length,questionIds:[...ids]};
}
