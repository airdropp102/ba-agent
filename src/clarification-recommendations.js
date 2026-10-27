/** v3.8 — project-scoped, opt-in technology-aware proposals and human decisions.
 * Draft recommendations are never evidence. A selected option is a recorded answer,
 * while customer confirmation and BA authorization remain distinct provenance.
 *
 * v3.8 changes (see review): pure prepareDecision()/commitDecision() split, partial
 * generation with per-question rejects, semantic analysis digest, append-only brief
 * validity, no silent truncation, feasibility never self-attested by the model.
 */
import {randomUUID} from 'node:crypto';
import {fingerprint} from './revisions.js';
import {analysisSignature,analysisDigestMatches,briefUnchangedSince} from './ba-digest.js';
import {candidatePlatforms,solutionReferences} from './erp-intelligence.js';
import {clarificationRecommendationSchema} from './schemas.js';

const fields=['frontend','backend','mobile','database','infrastructure','integrations','constraints'];
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const MAX_ATTACHMENTS=20;
// Opt-in: require at least one attachment/evidence file for approverRole='customer'.
const requireCustomerAttachment=()=>process.env.BA_REQUIRE_CUSTOMER_ATTACHMENT==='1';
// NOTE: kept byte-for-byte compatible with v3.7 so stored stackDigest values stay valid.
export const techStackDigest=p=>fingerprint(JSON.stringify(p.solutionProfile||p.erpFitGap?.length?{techStack:p.techStack||null,solutionProfile:p.solutionProfile||null,erpFitGap:p.erpFitGap||[]}:p.techStack||{}));
export const availableSolutionReferences=p=>solutionReferences(p,availableTechnologies(p.techStack));
// Constrain generation to the same exact project references checked at persistence.
// Candidate names remain candidates; constraining a reference never attests capability.
export function recommendationSchema(p){
 const schema=structuredClone(clarificationRecommendationSchema);
 const option=schema.properties.questions.items.properties.options.items.properties;
 if(p.recommendationMode==='business')option.stackReferences.maxItems=0;
 else{
  const references=availableSolutionReferences(p);
  if(!references.length)throw bad('Configure current stack or ERP candidate platforms before generating recommendations',409);
  option.stackReferences.minItems=1;
  option.stackReferences.items={type:'string',enum:references};
 }
 return schema;
}
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
/** Shape/size validation only; existence of attachment IDs is checked where files are stored. */
export function cleanAttachments({attachmentIds=[],attachments=[]}={}){
 if(!Array.isArray(attachmentIds)||attachmentIds.length>MAX_ATTACHMENTS||attachmentIds.some(x=>typeof x!=='string'||!x||x.length>200))throw bad('Invalid attachmentIds');
 if(!Array.isArray(attachments)||attachments.length>MAX_ATTACHMENTS||attachments.some(x=>!x||typeof x!=='object'))throw bad('Invalid attachments');
 return {attachmentIds:[...new Set(attachmentIds)],attachments};
}
const demoOptions=(q,techs)=>{
 const base=techs.slice(0,4),name=base.join(', ');
 return [
  {title:'Tận dụng công nghệ hiện tại',answer:`Đề xuất triển khai theo ${name}, giới hạn ở hạng mục ${q.question}. Các quy tắc nghiệp vụ và ngưỡng nghiệm thu chưa được quyết định phải được xác nhận riêng.`,benefits:'Tái sử dụng nền tảng đã khai báo; ít thay đổi vận hành hơn.',tradeoffs:'Phải kiểm tra giới hạn tích hợp, hiệu năng và chính sách nghiệp vụ trước khi cam kết.',implementation:'Spike kỹ thuật và làm rõ tiêu chí nghiệm thu với BA/khách hàng.',stackReferences:base,feasibility:'unknown'},
  {title:'Thử nghiệm trước khi chốt',answer:`Tạo proof-of-concept bằng ${name} để so sánh phương án triển khai cho câu hỏi ${q.question}; chưa chốt chính sách nghiệp vụ.`,benefits:'Giảm rủi ro phán đoán kỹ thuật khi thiếu thông tin.',tradeoffs:'Tăng thời gian kiểm chứng và cần tiêu chí quyết định do người có thẩm quyền đặt ra.',implementation:'Ghi lại benchmark/PoC, đánh giá rủi ro và yêu cầu người phụ trách phê duyệt.',stackReferences:base,feasibility:'unknown'}
 ];
};
// Over-long fields are rejected (422) instead of being silently cut: a truncated
// `answer` would become the text of a recorded decision.
const field=(raw,key,max)=>{
 const v=typeof raw?.[key]==='string'?raw[key].trim():'';
 if(!v)throw bad(`Incomplete proposal ${key}`,422);
 if(v.length>max)throw bad(`Proposal ${key} exceeds ${max} characters`,422);
 return v;
};
const normalizedOption=(raw,id,techs,mode,trustFeasibility)=>{
 if(!raw||typeof raw!=='object')throw bad('Invalid proposal option',422);
 if(mode==='business'&&raw.stackReferences!==undefined&&(!Array.isArray(raw.stackReferences)||raw.stackReferences.length))throw bad('Business recommendations must have empty technology references',422);
 let ref=[];
 if(mode!=='business'){
  // Reject hallucinated stack references; a model may mention alternatives in prose,
  // but may not claim an invented technology is already part of the customer's stack.
  // Stored casing is the project's own, not the model's.
  const canon=new Map(techs.map(t=>[t.toLowerCase(),t]));
  const given=Array.isArray(raw.stackReferences)?raw.stackReferences.filter(v=>typeof v==='string'):[];
  ref=[...new Set(given.map(r=>canon.get(r.toLowerCase())))];
  if(!ref.length||ref.some(r=>!r))throw bad('Recommendation references unknown project technology',422);
 } // business mode: only empty references are accepted
 const feasibility=mode!=='business'&&trustFeasibility&&['compatible','requires-change','unknown'].includes(raw.feasibility)?raw.feasibility:'unknown';
 return {id,title:field(raw,'title',160),answer:field(raw,'answer',1600),benefits:field(raw,'benefits',1000),tradeoffs:field(raw,'tradeoffs',1000),implementation:field(raw,'implementation',1000),stackReferences:ref,feasibility};
};
/**
 * Partial generation: valid questions are kept, invalid ones are returned in `rejected`
 * so the caller can retry only those. Questions absent from rawByQuestion are skipped
 * silently (the UI generates in groups).
 */
export function createRecommendationsDetailed(p,rawByQuestion,{provider='demo',mode='technical',selectionMode}={}){
 if(!p.analysis)throw bad('Analyze project first',409);
 const techs=availableSolutionReferences(p);
 if(mode!=='business'&&!techs.length)throw bad('Configure current stack or ERP candidate platforms before generating recommendations',409);
 const signature=analysisSignature(p),stackDigest=techStackDigest(p),trustFeasibility=Boolean(p.erpFitGap?.length);
 const byQuestion=new Map();
 for(const x of rawByQuestion||[])if(x&&typeof x.questionId==='string'&&!byQuestion.has(x.questionId))byQuestion.set(x.questionId,x);
 const rows=[],rejected=[];
 for(const q of p.analysis.clarificationQuestions||[]){
  if(q.status==='resolved')continue;
  const input=byQuestion.get(q.id);
  if(!input)continue;
  try{
   if(!Array.isArray(input.options)||input.options.length<1||input.options.length>3)throw bad('Each question requires 1-3 options',422);
   const options=input.options.map((option,i)=>normalizedOption(option,`OPT-${q.id}-${i+1}`,techs,mode,trustFeasibility));
   const preferred=Number.isInteger(input.preferredIndex)?input.preferredIndex:-1;
   if(selectionMode==='ba-draft'&&(preferred<0||preferred>=options.length))throw bad('AI draft ranking missing or invalid; retry generation',422);
   rows.push({questionId:q.id,questionDigest:questionDigest(q),analysisDigest:signature,stackDigest,createdAt:new Date().toISOString(),provider,mode,status:'PROPOSED',preferredOptionId:(mode!=='business'||selectionMode==='ba-draft')&&preferred>=0&&preferred<options.length?options[preferred].id:null,options});
  }catch(e){
   if(e.status!==422)throw e;
   rejected.push({questionId:q.id,reason:e.message});
  }
 }
 // Never wipe existing proposals because every new one was rejected.
 if(rows.length||!rejected.length)p.clarificationRecommendations=rows;
 return {rows,rejected};
}
/** Backwards-compatible wrapper: returns rows; rejected questions are kept in p.recommendationRejects. */
export function createRecommendations(p,rawByQuestion,opts){
 const {rows,rejected}=createRecommendationsDetailed(p,rawByQuestion,opts);
 p.recommendationRejects=rejected;
 if(!rows.length&&rejected.length)throw bad(`All proposals rejected: ${rejected[0].reason}`,422);
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
/** A decision stays valid while the brief it was approved against is still a prefix of the current brief. */
export function validDecision(p,q,memo={}){
 const row=[...(p.clarificationDecisions||[])].reverse().find(d=>d.questionId===q.id&&d.status==='APPROVED');
 if(!row)return null;
 memo.stack??=techStackDigest(p);memo.briefCache??=new Map();
 return row.questionDigest===questionDigest(q)&&row.stackDigest===memo.stack&&briefUnchangedSince(row,p.brief,memo.briefCache)?row:null;
}
/**
 * Validate everything and build the records, WITHOUT mutating the project.
 * `ctx` memoizes digests so a batch hashes the project once, not once per entry.
 * It is only valid while `p` is not mutated between calls.
 */
export function prepareDecision(p,entry,actor,ctx={}){
 const {questionId,optionId,approverRole,customerRepresentative,decisionContext}=entry||{};
 let {sourceReference,rationale}=entry||{};
 if(!p.analysis)throw bad('Analyze project first',409);
 const q=p.analysis.clarificationQuestions.find(x=>x.id===questionId);
 const r=p.clarificationRecommendations?.find(x=>x.questionId===questionId);
 if(!q||!r)throw bad('Question/recommendation not found',404);
 if(q.status==='resolved')throw bad('Question already resolved',409);
 ctx.analysis??={};ctx.stack??=techStackDigest(p);
 if(!analysisDigestMatches(r.analysisDigest,p,ctx.analysis)||r.stackDigest!==ctx.stack||r.questionDigest!==questionDigest(q))throw bad('Proposal is stale. Regenerate before approving.',409);
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
 const {attachmentIds,attachments}=cleanAttachments(entry);
 if(approverRole==='customer'&&requireCustomerAttachment()&&!attachmentIds.length&&!attachments.length)throw bad('Customer approval requires at least one evidence attachment');
 ctx.brief??=fingerprint(p.brief);
 const at=new Date().toISOString();
 const business=r.mode==='business';
 const decision={id:`DEC-${randomUUID()}`,questionId,questionText:q.question,questionDigest:questionDigest(q),stackDigest:ctx.stack,briefDigest:ctx.brief,briefLength:p.brief.length,optionId,answer:option.answer,approverRole,actor,customerRepresentative:approverRole==='customer'?customerRepresentative.trim():null,sourceReference:sourceReference.trim(),rationale:rationale.trim(),approvedAt:at,status:'APPROVED',customerApproved:approverRole==='customer',customerBaselineApproved:false,attachmentIds,attachments,decisionContext:decisionContext==='ba-ui'?'ba-ui':'manual',decisionDomain:business?'business':'technical'};
 // approvalType keeps its v3.7 values (consumers may switch on it); decisionDomain tells business from technical.
 const answerRow={questionId,answer:option.answer,sourceId:null,respondent:actor,customerRepresentative:decision.customerRepresentative,sourceReference:decision.sourceReference,at,approvalType:approverRole==='customer'?'CUSTOMER_APPROVED_PROPOSAL':'BA_APPROVED_TECHNICAL_DECISION',decisionDomain:decision.decisionDomain,decisionId:decision.id,attachmentIds:[...attachmentIds],attachments};
 return {decision,answerRow,q,r};
}
export function commitDecision(p,{decision,answerRow,q,r}){
 p.clarificationDecisions=[...(p.clarificationDecisions||[]),decision];
 p.answers=[...(p.answers||[]),answerRow];
 q.status='resolved';q.resolutionId=decision.id;
 r.status='APPROVED';r.approvedOptionId=decision.optionId;
 // Keep the approved proposal and the proposals of independent questions (their digests
 // still match: the analysis signature ignores question status and quality). Drop only
 // proposals for the same requirement, which could now contradict the choice just made.
 const rel=q.relatedRequirementId||null;
 p.clarificationRecommendations=(p.clarificationRecommendations||[]).flatMap(x=>{
  if(x.questionId===q.id)return [r];
  const xq=p.analysis.clarificationQuestions.find(z=>z.id===x.questionId);
  return rel&&xq?.relatedRequirementId===rel?[]:[x];
 });
 p.requirementsRefreshPending=true;
 p.review=null;p.previousPrototype=p.prototype||p.previousPrototype||null;p.prototype=null;p.status='ANALYZED';
}
export function recordDecision(p,entry,actor){
 const prepared=prepareDecision(p,entry,actor);
 commitDecision(p,prepared);
 return prepared.decision;
}
