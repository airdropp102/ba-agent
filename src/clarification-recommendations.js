/** v3.7 — project-scoped, opt-in technology-aware proposals and human decisions.
 * Draft recommendations are never evidence. A selected option is a recorded answer,
 * while customer confirmation and BA authorization remain distinct provenance.
 */
import {fingerprint} from './revisions.js';
import {candidatePlatforms,solutionReferences} from './erp-intelligence.js';

const fields=['frontend','backend','mobile','database','infrastructure','integrations','constraints'];
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const text=(v,max=2000)=>typeof v==='string'?v.trim().slice(0,max):'';
export const techStackDigest=p=>fingerprint(JSON.stringify(p.solutionProfile||p.erpFitGap?.length?{techStack:p.techStack||null,solutionProfile:p.solutionProfile||null,erpFitGap:p.erpFitGap||[]}:p.techStack||{}));
export const availableSolutionReferences=p=>solutionReferences(p,availableTechnologies(p.techStack));
export const questionDigest=q=>fingerprint(JSON.stringify({id:q.id,question:q.question,impact:q.impact,origin:q.origin||'',relatedRequirementId:q.relatedRequirementId||''}));
export function normalizeTechStack(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw bad('Tech stack object required');
 const unknown=Object.keys(raw).filter(key=>!fields.includes(key));
 if(unknown.length)throw bad('Unknown tech stack fields: '+unknown.join(', '));
 const result={};
 for(const field of fields){
  const arr=raw[field]??[];
  if(!Array.isArray(arr)||arr.length>20||arr.some(x=>typeof x!=='string'||x.trim().length<2||x.length>160))throw bad(`Invalid techStack.${field}`);
  result[field]=[...new Set(arr.map(x=>x.trim()))];
 }
 if(fields.every(f=>!result[f].length))throw bad('Provide at least one actual technology or constraint; do not infer a project stack');
 return result;
}
export function availableTechnologies(stack){return fields.filter(k=>k!=='constraints').flatMap(k=>stack?.[k]||[])}
const demoOptions=(q,techs)=>{
 const base=techs.slice(0,4),name=base.join(', ');
 return [
  {title:'Tận dụng công nghệ hiện tại',answer:`Đề xuất triển khai theo ${name}, giới hạn ở hạng mục ${q.question}. Các quy tắc nghiệp vụ và ngưỡng nghiệm thu chưa được quyết định phải được xác nhận riêng.`,benefits:'Tái sử dụng nền tảng đã khai báo; ít thay đổi vận hành hơn.',tradeoffs:'Phải kiểm tra giới hạn tích hợp, hiệu năng và chính sách nghiệp vụ trước khi cam kết.',implementation:'Spike kỹ thuật và làm rõ tiêu chí nghiệm thu với BA/khách hàng.',stackReferences:base,feasibility:'compatible'},
  {title:'Thử nghiệm trước khi chốt',answer:`Tạo proof-of-concept bằng ${name} để so sánh phương án triển khai cho câu hỏi ${q.question}; chưa chốt chính sách nghiệp vụ.`,benefits:'Giảm rủi ro phán đoán kỹ thuật khi thiếu thông tin.',tradeoffs:'Tăng thời gian kiểm chứng và cần tiêu chí quyết định do người có thẩm quyền đặt ra.',implementation:'Ghi lại benchmark/PoC, đánh giá rủi ro và yêu cầu người phụ trách phê duyệt.',stackReferences:base,feasibility:'compatible'}
 ];
};
const normalizedOption=(raw,id,techs,mode)=>{
 const ref=Array.isArray(raw.stackReferences)?[...new Set(raw.stackReferences.filter(v=>typeof v==='string'))]:[];
 // Reject hallucinated stack references; a model may mention alternatives in prose,
 // but may not claim an invented technology is already part of the customer's stack.
 if(mode==='business'?ref.length>0:(!ref.length||ref.some(r=>!techs.some(t=>t.toLowerCase()===r.toLowerCase()))))throw bad('Recommendation references unknown project technology',422);
 for(const key of ['title','answer','benefits','tradeoffs','implementation'])if(!text(raw[key]).length)throw bad(`Incomplete proposal ${key}`,422);
 return {id,title:text(raw.title,160),answer:text(raw.answer,1600),benefits:text(raw.benefits,1000),tradeoffs:text(raw.tradeoffs,1000),implementation:text(raw.implementation,1000),stackReferences:ref,feasibility:mode==='business'?'unknown':(['compatible','requires-change','unknown'].includes(raw.feasibility)?raw.feasibility:'unknown')};
};
export function createRecommendations(p,rawByQuestion,{provider='demo',mode='technical',selectionMode}={}){
 if(!p.analysis)throw bad('Analyze project first',409);
 const techs=availableSolutionReferences(p);
 if(mode!=='business'&&!techs.length)throw bad('Configure current stack or ERP candidate platforms before generating recommendations',409);
 const signature=fingerprint(JSON.stringify({brief:p.brief,analysis:p.analysis}));
 const rows=[];
 for(const q of p.analysis.clarificationQuestions||[]){
  if(q.status==='resolved')continue;
  const input=rawByQuestion?.find(x=>x.questionId===q.id);
  if(!input)continue;
  if(!Array.isArray(input.options)||input.options.length<1||input.options.length>3)throw bad('Each question requires 1-3 options',422);
  const options=input.options.map((option,i)=>normalizedOption(option,`OPT-${q.id}-${i+1}`,techs,mode));
  const preferred=Number.isInteger(input.preferredIndex)?input.preferredIndex:-1;
  if(selectionMode==='ba-draft'&&(preferred<0||preferred>=options.length))throw bad('AI draft ranking missing or invalid; retry generation',422);
  rows.push({questionId:q.id,questionDigest:questionDigest(q),analysisDigest:signature,stackDigest:techStackDigest(p),createdAt:new Date().toISOString(),provider,mode,status:'PROPOSED',preferredOptionId:(mode!=='business'||selectionMode==='ba-draft')&&preferred>=0&&preferred<options.length?options[preferred].id:null,options});
 }
 p.clarificationRecommendations=rows;
 return rows;
}
export function demoRecommendations(p){
 if(p.recommendationMode==='business')return (p.analysis?.clarificationQuestions||[]).filter(q=>q.status!=='resolved').map(q=>({questionId:q.id,preferredIndex:p.recommendationSelectionMode==='ba-draft'?0:-1,options:[{title:'DRAFT demo: xác minh với chủ nghiệp vụ',answer:'Cần chủ nghiệp vụ xác nhận: '+q.question,benefits:'Làm rõ quyết định nghiệp vụ',tradeoffs:'Chưa có câu trả lời được xác nhận',implementation:'Thu thập biên bản hoặc nguồn phản hồi khách hàng',stackReferences:[],feasibility:'unknown'}]}));
 const techs=availableSolutionReferences(p);
 const erpPlatforms=candidatePlatforms(p);
 if(erpPlatforms.length){
  const optionsFor=q=>{
   const options=erpPlatforms.slice(0,2).map(target=>({title:`Đánh giá ERP chuẩn: ${target.name}`,answer:`Đề xuất kiểm chứng khả năng cấu hình ${target.name} cho câu hỏi ${q.question}. Đây là candidate; chưa xác nhận module, edition hay chức năng hiện có.`,benefits:'Có thể sử dụng quy trình/đặc tính chuẩn nếu Fit–Gap được BA xác minh.',tradeoffs:'Phụ thuộc license, localization, module, ràng buộc dữ liệu và nâng cấp phiên bản.',implementation:'BA đánh giá Fit–Gap theo đúng phiên bản/edition và demo end-to-end với UAT.',stackReferences:[target.name],feasibility:'unknown'}));
   if(availableTechnologies(p.techStack).length)options.push({title:'Phát triển riêng trên current stack',answer:`Đánh giá build riêng cho câu hỏi ${q.question}; cần so sánh hiệu quả và TCO với ERP.`,benefits:'Chủ động thiết kế quy trình đặc thù.',tradeoffs:'Chi phí xây dựng/vận hành, kiểm soát liên module và bảo trì dài hạn.',implementation:'Lập business case, TCO 3–5 năm, đánh giá rủi ro và approval độc lập.',stackReferences:availableTechnologies(p.techStack).slice(0,3),feasibility:'unknown'});
   else if(options.length===1)options.push({title:`Hybrid: mở rộng ${erpPlatforms[0].name}`,answer:`Xem xét add-on hoặc tích hợp với ${erpPlatforms[0].name} cho câu hỏi ${q.question}; chỉ sau khi nhận diện gap và đánh giá license.`,benefits:'Tái sử dụng ERP core, chỉ phát triển phần đặc thù.',tradeoffs:'Phụ thuộc add-ons, upgrade path, bảo mật, đối soát dữ liệu.',implementation:'PoC mở rộng/integration, thử nâng cấp và phân tích maintenance.',stackReferences:[erpPlatforms[0].name],feasibility:'unknown'});
   return options.slice(0,3);
  };
  return (p.analysis?.clarificationQuestions||[]).filter(q=>q.status!=='resolved').map(q=>({questionId:q.id,preferredIndex:-1,options:optionsFor(q)}));
 }
 return (p.analysis?.clarificationQuestions||[]).filter(q=>q.status!=='resolved').map(q=>({questionId:q.id,options:demoOptions(q,techs),preferredIndex:/trùng|hết hạn|quy tắc|nghiệp vụ|có được|bắt buộc|scope|phạm vi|kpi|mục tiêu|chính sách/i.test(q.question)?-1:0}));
}
export function validDecision(p,q){
 const row=[...(p.clarificationDecisions||[])].reverse().find(d=>d.questionId===q.id&&d.status==='APPROVED');
 return row && row.questionDigest===questionDigest(q) && row.stackDigest===techStackDigest(p) && row.briefDigest===fingerprint(p.brief)?row:null;
}
export function recordDecision(p,{questionId,optionId,approverRole,sourceReference,rationale,customerRepresentative,decisionContext,attachmentIds=[],attachments=[]},actor){
 if(!p.analysis)throw bad('Analyze project first',409);
 const q=p.analysis.clarificationQuestions.find(x=>x.id===questionId);
 const r=p.clarificationRecommendations?.find(x=>x.questionId===questionId);
 if(!q||!r)throw bad('Question/recommendation not found',404);
 if(q.status==='resolved')throw bad('Question already resolved',409);
 if(r.analysisDigest!==fingerprint(JSON.stringify({brief:p.brief,analysis:p.analysis}))||r.stackDigest!==techStackDigest(p)||r.questionDigest!==questionDigest(q))throw bad('Proposal is stale. Regenerate before approving.',409);
 const option=r.options.find(x=>x.id===optionId);
 if(!option)throw bad('Select an exact option ID from this project',400);
 if(!['ba','customer'].includes(approverRole))throw bad('approverRole must be ba or customer');
 if(decisionContext==='ba-ui'&&approverRole==='ba'){
  sourceReference=sourceReference||`BA Studio decision log / ${questionId}`;
  rationale=rationale||`BA selected draft option ${optionId} in the clarification form; no external confirmation supplied.`;
 }
 if(typeof sourceReference!=='string'||sourceReference.trim().length<5||sourceReference.length>300)throw bad('Approval evidence reference is required (5-300 chars)');
 if(typeof rationale!=='string'||rationale.trim().length<10||rationale.length>2000)throw bad('Approval rationale required (10-2000 chars)');
 if(approverRole==='customer'&&(typeof customerRepresentative!=='string'||customerRepresentative.trim().length<3||customerRepresentative.length>160))throw bad('Customer representative is required for attested customer approval');
 if(typeof actor!=='string'||actor.length<3)throw bad('Approver identity required',401);
 const at=new Date().toISOString();
 const decision={id:`DEC-${cryptoRandom()}`,questionId,questionText:q.question,questionDigest:questionDigest(q),stackDigest:techStackDigest(p),briefDigest:fingerprint(p.brief),optionId,answer:option.answer,approverRole,actor,customerRepresentative:approverRole==='customer'?customerRepresentative.trim():null,sourceReference:sourceReference.trim(),rationale:rationale.trim(),approvedAt:at,status:'APPROVED',customerApproved:approverRole==='customer',customerBaselineApproved:false,attachmentIds:[...attachmentIds],attachments,decisionContext:decisionContext==='ba-ui'?'ba-ui':'manual'};
 p.clarificationDecisions=[...(p.clarificationDecisions||[]),decision];
 p.answers=[...(p.answers||[]),{questionId,answer:option.answer,sourceId:null,respondent:actor,customerRepresentative:approverRole==='customer'?customerRepresentative.trim():null,sourceReference:sourceReference.trim(),at,approvalType:approverRole==='customer'?'CUSTOMER_APPROVED_PROPOSAL':'BA_APPROVED_TECHNICAL_DECISION',decisionId:decision.id,attachmentIds:[...attachmentIds],attachments}];
 q.status='resolved';q.resolutionId=decision.id;
 r.status='APPROVED';r.approvedOptionId=optionId;
 // All unselected proposals are stale as soon as the analysis changes.
 // Keep the selected proposal in the current projection; historical versions retain the others.
 p.clarificationRecommendations=[r];
 p.requirementsRefreshPending=true;
 p.review=null;p.previousPrototype=p.prototype||p.previousPrototype||null;p.prototype=null;p.status='ANALYZED';
 return decision;
}
// Avoid depending on the server for decision IDs.
import {randomUUID as cryptoRandom} from 'node:crypto';
