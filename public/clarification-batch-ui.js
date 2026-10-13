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
