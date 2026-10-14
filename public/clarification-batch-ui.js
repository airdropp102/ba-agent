import {answerPayload} from './clarification-ui.js';
export const questionKey=q=>JSON.stringify([q.question,q.impact]);
export const proposalKey=p=>p?JSON.stringify([p.questionDigest,p.analysisDigest,p.stackDigest,p.options]):'';
export function completeDrafts(project,drafts){
 const results=[];
 for(const q of project.analysis?.clarificationQuestions||[]){const d=drafts[q.id];if(!d||q.status==='resolved'||d.questionKey!==questionKey(q))continue;
  if(d.mode!=='custom'&&d.proposalKey!==proposalKey(project.clarificationRecommendations?.find(p=>p.questionId===q.id)))continue;
  try{const payload=answerPayload({...d,questionId:q.id});results.push({...payload.body,kind:payload.route==='answers'?'custom':'option'});}catch{}
 }
 return results;
}
export async function generateQuestionGroups(ids,{generate,onProgress,size=3}){
 const result={done:[],failed:[],total:ids.length,active:[]};
 for(let index=0;index<ids.length;index+=size){const group=ids.slice(index,index+size);result.active=group;onProgress({...result});
  try{await generate(group);result.done.push(...group);}catch{result.failed.push(...group);}
  result.active=[];onProgress({...result});
 }
 return result;
}

/** Select AI-ranked drafts locally; persistence still requires the BA Save action. */
export function selectRecommendedDrafts(project,drafts,ids){
 for(const id of ids){
  const q=project.analysis?.clarificationQuestions.find(q=>q.id===id);
  const proposal=project.clarificationRecommendations?.find(p=>p.questionId===id&&p.status==='PROPOSED');
  if(!q||['resolved','answered-pending-ba-review'].includes(q.status)||!proposal)continue;
  const old=drafts[id]||{};if(old.mode&&!old.autoSelected)continue;
  const option=proposal.options.find(o=>o.id===proposal.preferredOptionId)||(proposal.options.length===1?proposal.options[0]:null);
  if(!option)continue;
  drafts[id]={...old,questionId:id,mode:option.id,role:'ba',autoSelected:true,questionKey:questionKey(q),proposalKey:proposalKey(proposal)};
 }
}

/** Keep successful uploads for retry, but only for the currently selected File objects. */
export async function uploadDraftAttachments(draft,upload){
 const files=[...(draft.files||[])];
 draft.fileUploads=(draft.fileUploads||[]).filter(u=>files.includes(u.file));
 for(const file of files){if(draft.fileUploads.some(u=>u.file===file))continue;
  const result=await upload(file);draft.fileUploads.push({file,id:result.id});
 }
 draft.attachmentIds=files.map(file=>draft.fileUploads.find(u=>u.file===file).id);
 return [...draft.attachmentIds];
}
