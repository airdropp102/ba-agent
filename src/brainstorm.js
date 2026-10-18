/** Brainstorm ideas are ALWAYS hypotheses, never customer-approved requirements. */
export const brainstormSchema={
  type:'object',additionalProperties:false,required:['summary','opportunities','stakeholderQuestions','assumptions','risks'],
  properties:{
    summary:{type:'string'},
    opportunities:{type:'array',items:{type:'string'}},
    stakeholderQuestions:{type:'array',items:{type:'string'}},
    assumptions:{type:'array',items:{type:'string'}},
    risks:{type:'array',items:{type:'string'}}
  }
};
export function demoBrainstorm(title,brief){
  return {summary:`Khám phá phạm vi và kết quả mong đợi cho ${title}. Nội dung sau là gợi ý cần kiểm chứng, không phải yêu cầu xác nhận.`,
    opportunities:['Làm rõ bài toán và mục tiêu đo lường','Nhận diện stakeholder và vai trò','Liên kết hành trình người dùng với các tiêu chí nghiệm thu'],
    stakeholderQuestions:['Ai phê duyệt phạm vi và quy tắc nghiệp vụ?','Những điểm đau hiện tại và KPI thành công nào được xác nhận?','Ngoại lệ, phân quyền và yêu cầu chất lượng nào chưa được mô tả?'],
    assumptions:['Không suy luận thêm chức năng từ nội dung đầu vào.'],
    risks:[brief.length<200?'Brief ngắn; cần bổ sung phỏng vấn và nguồn chứng cứ.':'Chưa có xác nhận độc lập về tính đầy đủ của brief.']};
}
const LISTS=['opportunities','stakeholderQuestions','assumptions','risks'];
export const BRAINSTORM_LIMITS=Object.freeze({summary:4000,items:20,itemLength:2000});
export function assessBrainstorm(value){
  const {summary:maxSummary,items:maxItems,itemLength:maxLength}=BRAINSTORM_LIMITS;
  if(!value||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>maxSummary)throw new Error('Invalid brainstorming output');
  const out={summary:value.summary.trim()};
  for(const key of LISTS){
    const list=value[key];
    if(!Array.isArray(list)||list.some(x=>typeof x!=='string'))throw new Error('Invalid brainstorming output');
    const items=list.map(x=>x.trim()).filter(Boolean);
    if(items.length>maxItems||items.some(x=>x.length>maxLength))throw new Error('Invalid brainstorming output');
    out[key]=items;
  }
  // Only known fields are kept; anything else the model added is dropped.
  return {...out,status:'DRAFT_HYPOTHESES',customerApproved:false};
}