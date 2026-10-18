import {prepareDecision,cleanAttachments} from './clarification-recommendations.js';
import {briefUnchangedSince} from './ba-digest.js';
import {fingerprint,buildSources} from './revisions.js';
const bad=message=>Object.assign(new Error(message),{status:400});
// respondent / sourceReference are interpolated into a header line of the brief:
// they must not be able to open a new line (and so forge a "=== CUSTOMER RESPONSE ..." header).
const SINGLE_LINE=/^[^\u0000-\u001f\u007f]+$/;
// Free-text answers may contain lines that look like our header; neutralize them in the brief only.
// source.text keeps the original wording so evidence quotes still verify against it.
const defang=t=>t.replace(/^([ \t]*={3,}[ \t]*CUSTOMER RESPONSE)/gim,'[escaped] $1');
/**
 * Validate every entry against the untouched project `p` (prepareDecision never mutates it);
 * build the result on ONE clone and publish it only after everything validated.
 */
export function applyClarificationBatch(p,items,actor){
 if(!p.analysis)throw bad('Analyze before answering questions');
 if(!Array.isArray(items)||!items.length||items.length>100)throw bad('Batch requires 1-100 answers');
 const next=structuredClone(p),ids=new Set(),decisions=[],ctx={};
 next.sources=next.sources||buildSources(next.brief);next.answers=next.answers||[];
 for(const entry of items){
  if(!entry||typeof entry.questionId!=='string')throw bad('Invalid question ID');
  if(ids.has(entry.questionId))throw bad('Duplicate question in batch');ids.add(entry.questionId);
  const q=p.analysis.clarificationQuestions.find(q=>q.id===entry.questionId);
  if(!q||q.status==='resolved')throw bad('Open question not found');
  if(entry.kind==='option'){
   const prepared=prepareDecision(p,entry,actor,ctx);
   decisions.push(prepared.decision);next.answers.push(prepared.answerRow);
  }else if(entry.kind==='custom'){
   const values={};for(const key of ['answer','respondent','sourceReference']){if(typeof entry[key]!=='string')throw bad('Answer, respondent and source reference required');values[key]=entry[key].trim();}
   const {answer,respondent,sourceReference}=values;
   if(answer.length<3||answer.length>12000||respondent.length<2||respondent.length>160||sourceReference.length<3||sourceReference.length>300)throw bad('Invalid answer, respondent or source reference');
   if(!SINGLE_LINE.test(respondent)||!SINGLE_LINE.test(sourceReference))throw bad('Respondent and source reference must be single-line text');
   const {attachmentIds,attachments}=cleanAttachments(entry);
   const at=new Date().toISOString(),existing=new Set(next.sources.map(s=>s.id));let number=next.sources.length+1;while(existing.has(`SRC-${String(number).padStart(3,'0')}`))number++;
   const source={id:`SRC-${String(number).padStart(3,'0')}`,type:'customer-response',text:answer,respondent,sourceReference,questionId:entry.questionId,at};
   next.sources.push(source);next.answers.push({questionId:entry.questionId,...values,sourceId:source.id,at,attachmentIds,attachments});
   next.brief+=`\n\n=== CUSTOMER RESPONSE TO ${entry.questionId} (source: ${sourceReference}; respondent: ${respondent}) ===\n${defang(answer)}`;
  }else throw bad('Invalid answer kind');
 }
 if(next.brief.length>100000)throw bad('Brief exceeds 100000 characters');
 // New choices are authorized together with this batch's sourced responses.
 const digest=fingerprint(next.brief),cache=new Map();
 for(const decision of decisions){decision.briefDigest=digest;decision.briefLength=next.brief.length;}
 // The brief is append-only: older decisions stay valid unless the text they were approved against changed.
 for(const d of next.clarificationDecisions||[])if(d.status==='APPROVED'&&!briefUnchangedSince(d,next.brief,cache))d.status='STALE_BRIEF_CHANGED';
 next.clarificationDecisions=[...(next.clarificationDecisions||[]),...decisions];
 const decided=new Set(decisions.map(d=>d.questionId));
 next.analysis.clarificationQuestions=next.analysis.clarificationQuestions.map(q=>ids.has(q.id)?{...q,status:decided.has(q.id)?'resolved':'answered-pending-ba-review'}:q);
 next.clarificationRecommendations=[];next.requirementsRefreshPending=true;next.review=null;next.previousPrototype=next.prototype||next.previousPrototype||null;next.prototype=null;next.status='ANALYZED';
 Object.assign(p,next);return {saved:items.length,questionIds:[...ids]};
}