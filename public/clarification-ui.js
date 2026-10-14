import {questionKey,proposalKey} from './clarification-batch-ui.js';
export function candidateAllowed(domain,strategy,id){
 if(domain!=='erp'||strategy==='custom')return false;
 if(!['odoo-community','erpnext','odoo-enterprise'].includes(id))return false;
 return strategy==='open-source'?id!=='odoo-enterprise':strategy==='commercial'?id==='odoo-enterprise':true;
}
export function filterQuestions(qs,priority='all',status='open'){
 const ranks={High:0,Medium:1,Low:2};
 return qs.filter(q=>(priority==='all'||q.priority===priority)&&(status==='all'||(status==='resolved')===['resolved','answered-pending-ba-review'].includes(q.status))).sort((a,b)=>(ranks[a.priority]??3)-(ranks[b.priority]??3));
}
export function answerPayload(v){
 if(!v.mode)throw Error('Chọn gợi ý hoặc Tự nhập câu trả lời.');
 if(v.mode==='custom'){
  if(!v.answer?.trim()||v.answer.trim().length<3)throw Error('Nhập câu trả lời.');
  if(!v.respondent?.trim()||v.respondent.trim().length<2)throw Error('Người trả lời / vai trò là bắt buộc.');
  return {route:'answers',body:{questionId:v.questionId,answer:v.answer.trim(),respondent:v.respondent.trim(),sourceReference:v.reference?.trim()||`BA Studio form / ${v.respondent.trim()}`,attachmentIds:v.attachmentIds||[]}};
 }
 if(!['ba','customer'].includes(v.role))throw Error('Chọn thẩm quyền chấp thuận.');
 if(v.role==='customer'&&!v.reference?.trim()&&!(v.files?.length||v.attachmentIds?.length))throw Error('Đính kèm tài liệu xác nhận khi chọn thẩm quyền khách hàng.');
 if(v.role==='customer'&&(!v.representative||v.representative.trim().length<3))throw Error('Nhập người đại diện khách hàng (ít nhất 3 ký tự).');
 return {route:'recommendations/approve',body:{questionId:v.questionId,optionId:v.mode,approverRole:v.role,decisionContext:v.role==='ba'?'ba-ui':undefined,attachmentIds:v.attachmentIds||[],sourceReference:v.reference?.trim()||undefined,rationale:v.rationale?.trim()||undefined,customerRepresentative:v.role==='customer'?v.representative.trim():undefined}};
}
export function renderQuestionForm({item,proposal,savedAnswer,elt,button,onGenerate,onSave,onDraftChange,onDownloadAttachment,draft={}}){
 const wrap=elt('details',null,'question');
 const summary=elt('summary',`${item.id} · ${item.priority} · ${item.status==='resolved'?'Đã chọn phương án':item.status==='answered-pending-ba-review'?'Đã trả lời · Chờ BA Review':'Cần trả lời'} — ${item.question}`);wrap.append(summary);
 wrap.append(elt('p',item.impact));
 if(savedAnswer){wrap.append(elt('p','Câu trả lời đã lưu: '+savedAnswer.answer),elt('p','Người trả lời: '+(savedAnswer.customerRepresentative||savedAnswer.respondent||'Chưa xác định')),elt('p','Nguồn xác nhận: '+(savedAnswer.sourceReference||'Chưa xác định')));}
 for(const doc of savedAnswer?.attachments||[]){wrap.append(button('↓ '+doc.filename,()=>onDownloadAttachment?.(doc.id),'quiet'));}
 if(item.status==='resolved'){wrap.append(elt('p','Đã ghi nhận quyết định; vẫn cần phân tích và BA Review.'));return wrap;}
 wrap.append(elt('p','Gợi ý DRAFT để xem xét; chưa phải bằng chứng hay customer sign-off.'));
 const generateLabel=proposal?'Tạo lại gợi ý DRAFT':'AI gợi ý câu trả lời';
 const generate=button(generateLabel,async()=>{generate.textContent='Đang tạo gợi ý DRAFT…';generate.disabled=true;try{await onGenerate();}finally{generate.textContent=generateLabel;generate.disabled=false;}},'secondary');wrap.append(generate);
 const changed=draft.questionKey&&draft.questionKey!==questionKey(item)||draft.mode&&draft.mode!=='custom'&&draft.proposalKey!==proposalKey(proposal);
 const form=elt('form');let mode=changed?'':draft.mode||'';if(changed)wrap.append(elt('p','Câu hỏi hoặc gợi ý đã thay đổi; hãy chọn lại trước khi lưu.','workflow-note'));if(draft.open)wrap.open=true;wrap.ontoggle=()=>{if(onDraftChange&&wrap.isConnected)onDraftChange({...draft,open:wrap.open});};
 const fields={};
 const field=(key,label,type='input')=>{const box=elt('label');box.append(elt('span',label));const input=elt(type);input.value=draft[key]||'';input.name=key;input.style.width='100%';box.append(input);form.append(box);fields[key]=input;return box;};
 const choices=elt('fieldset');choices.append(elt('legend','Chọn một gợi ý hoặc tự trả lời'));form.append(choices);
 const optionFields=[];
 const answerBox=field('answer','Câu trả lời của khách hàng','textarea');fields.answer.rows=4;fields.answer.maxLength=5000;
 const respondentBox=field('respondent','Người trả lời / vai trò');fields.respondent.maxLength=160;
 const roleBox=field('role','Thẩm quyền chấp thuận','select');optionFields.push(roleBox);
 for(const [value,label] of [['','Chọn thẩm quyền'],['customer','Khách hàng xác nhận'],['ba','BA chấp thuận phương án']]){const o=elt('option',label);o.value=value;fields.role.append(o);}
 const representativeBox=field('representative','Người đại diện khách hàng');optionFields.push(representativeBox);fields.representative.maxLength=160;
 const attachmentBox=elt('label');attachmentBox.append(elt('span','File đính kèm (tùy chọn)'));
 const attachmentInput=elt('input');attachmentInput.type='file';attachmentInput.multiple=true;attachmentInput.accept='.pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.webp,.md,.txt,.json,.csv';attachmentBox.append(attachmentInput);form.append(attachmentBox);
 const attachmentStatus=elt('p',(draft.files||[]).map(f=>f.name).join(', '),'subtle');form.append(attachmentStatus);
 attachmentInput.onchange=()=>{const files=Array.from(attachmentInput.files||[]);if(files.length>10||files.some(f=>f.size>5*1024*1024)){attachmentStatus.textContent='Tối đa 10 file, mỗi file tối đa 5 MB.';attachmentInput.value='';return;}draft={...draft,files,attachmentIds:[],fileUploads:[]};attachmentStatus.textContent=files.map(f=>f.name).join(', ');capture();};
 const refresh=()=>{const custom=mode==='custom';answerBox.hidden=!custom;respondentBox.hidden=!custom;for(const box of optionFields)box.hidden=custom||!mode;representativeBox.hidden=custom||fields.role.value!=='customer';};
 const capture=()=>{const values={...draft,questionId:item.id,mode,open:wrap.open,questionKey:questionKey(item),proposalKey:proposalKey(proposal)};for(const [key,input] of Object.entries(fields))values[key]=input.value;draft=values;if(onDraftChange)onDraftChange(values);};
 fields.role.value=draft.role||'ba';fields.role.onchange=()=>{draft.autoSelected=false;refresh();capture();};form.oninput=capture;
 const choice=(id,title,option)=>{const label=elt('label');label.style.display='block';const radio=elt('input');radio.type='radio';radio.name='answer-mode';radio.value=id;radio.checked=mode===id;radio.onchange=()=>{mode=id;draft.autoSelected=false;refresh();capture();};label.append(radio,document.createTextNode(' '+title));choices.append(label);if(option){const detail=elt('details');detail.append(elt('summary','Xem nội dung gợi ý'),elt('p',option.answer),elt('p','Lợi ích: '+option.benefits),elt('p','Đánh đổi: '+option.tradeoffs),elt('p','Cần xác minh: '+option.implementation));choices.append(detail);}};
 for(const option of proposal?.options||[])choice(option.id,option.title,option);
 choice('custom','Tự nhập câu trả lời từ khách hàng');refresh();
 const error=elt('p',null,'workflow-note');error.setAttribute('role','alert');form.append(error);
 const save=button(onDraftChange?'Đã nhập · dùng nút Lưu câu trả lời phía trên':'Lưu câu trả lời',()=>{},'primary');save.type='submit';if(!onDraftChange)form.append(save);
 form.onsubmit=async event=>{event.preventDefault();if(onDraftChange){capture();return;}error.textContent='';try{const values={...draft,questionId:item.id,mode};for(const [key,input] of Object.entries(fields))values[key]=input.value;const payload=answerPayload(values);save.disabled=true;await onSave(payload);}catch(e){error.textContent=e.message;}finally{save.disabled=false;}};
 wrap.append(form);return wrap;
}
