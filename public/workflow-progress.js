/** Poll durable state; waiting never implies model completion or percent progress. */
export async function watchWorkflowJob({readJob,readProject,onUpdate,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 for(;;){
  const job=await readJob();
  const project=await readProject();
  await onUpdate(project,job);
  if(['SUCCEEDED','DEAD_LETTER'].includes(job.state))return job;
  await wait(2000);
 }
}
export function workflowProgressText(project,job,now=Date.now()){
 const w=project.workflow||{};
 const started=Date.parse(w.currentAttempt?.startedAt||job.created_at||'');
 const seconds=Number.isFinite(started)?Math.max(0,Math.floor((now-started)/1000)):0;
 const labels={QUEUED:'Đang xếp hàng',RUNNING:'Đang xử lý',RETRY_WAIT:'Chờ thử lại',SUCCEEDED:'Đã kết thúc job',DEAD_LETTER:'Đã thất bại'};
 return `${w.stage||'Workflow'} · ${labels[job.state]||job.state} · ${Math.floor(seconds/60)} phút ${seconds%60} giây · Lần thử ${job.attempts||0}/${job.max_attempts||3}`;
}
export function workflowStatus(project,job,now=Date.now()){
 const stored=project.workflow||{stage:'BRAINSTORM',state:'READY'};
 const w=['FIGMA_DESIGN','FIGMA_PUBLISH'].includes(stored.stage)?{...stored,state:'COMPLETED'}:stored,matching=job&&(!job.run_id||job.run_id===w.runId)?job:null;
 const human=['COMPLETED','WAITING_CLARIFICATION','WAITING_BA_REVIEW','WAITING_QUALITY_REVIEW','WAITING_ERP_TARGET','WAITING_ERP_DESIGN_REVIEW','AWAITING_FIGMA','FIGMA_PUBLISHED','FIGMA_REPORTED','FIGMA_READBACK_REPORTED','FIGMA_QA_APPROVED'].includes(w.state);
 const active=!human&&(w.state==='RUNNING'||w.state==='READY'&&matching?.state==='RUNNING');
 const key=!human&&matching?.state==='RETRY_WAIT'?'RETRY_WAIT':!human&&w.state==='READY'&&matching?.state==='QUEUED'?'QUEUED':w.state;
 const labels={WAITING_ERP_TARGET:'Chờ xác nhận nền tảng ERP',WAITING_ERP_DESIGN_REVIEW:'Chờ duyệt thiết kế ERP',COMPLETED:'Đã tạo tài liệu',QUEUED:'Đang xếp hàng',READY:'Sẵn sàng tiếp tục',RUNNING:'Đang xử lý',WAITING_CLARIFICATION:'Chờ làm rõ yêu cầu',WAITING_BA_REVIEW:'Chờ BA rà soát',WAITING_QUALITY_REVIEW:'Chờ rà soát chất lượng',FAILED:'Xử lý thất bại',RETRY_WAIT:'Chờ thử lại',AWAITING_FIGMA:'Design pack sẵn sàng',BLOCKED_NO_FUNCTIONAL_REQUIREMENTS:'Cần bổ sung yêu cầu',FIGMA_REPORTED:'Có báo cáo Figma · chờ kiểm tra',FIGMA_READBACK_REPORTED:'Đã báo cáo đọc lại Figma · chờ QA',FIGMA_QA_APPROVED:'BA đã kiểm tra Figma'};
 const attempts=[...(w.attempts||[])].reverse();const attempt=w.currentAttempt||attempts.find(a=>a.stage===w.stage);
 const duration=(start,end)=>{const a=Date.parse(start||''),b=typeof end==='number'?end:Date.parse(end||'');return Number.isFinite(a)&&Number.isFinite(b)?Math.max(0,Math.floor((b-a)/1000)):null;};
 const stageSeconds=duration(attempt?.startedAt,active?now:attempt?.finishedAt||w.updatedAt);
 const jobSeconds=matching?duration(matching.created_at,['SUCCEEDED','DEAD_LETTER'].includes(matching.state)?matching.updated_at:now):null;
 return {label:active?'Đang xử lý':labels[key]||key,active,tone:active?'running':key==='FAILED'?'error':human?'waiting':'ready',stageSeconds,jobSeconds,job:matching};
}
export function elapsedLabel(seconds){return seconds===null?'—':`${Math.floor(seconds/60)} phút ${seconds%60} giây`;}
