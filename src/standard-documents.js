import {readFileSync} from 'node:fs';

export const DOCUMENT_TEMPLATES=Object.freeze({
 brd:{filename:'BRD.md',title:'Business Requirements Document'},
 srs:{filename:'SRS.md',title:'Software Requirements Specification'},
 urd:{filename:'URD.md',title:'User / Stakeholder Requirements Document'},
 'use-cases':{filename:'USE_CASES.md',title:'Use case specification'},
 'user-stories':{filename:'USER_STORIES.md',title:'User stories'}
});
const templates=new Map();
export function getDocumentTemplate(kind){
 const entry=Object.hasOwn(DOCUMENT_TEMPLATES,kind)?DOCUMENT_TEMPLATES[kind]:null;
 if(!entry)throw Object.assign(new Error('Unknown document template'),{status:404});
 if(!templates.has(kind))templates.set(kind,readFileSync(new URL('../templates/documents/'+entry.filename,import.meta.url),'utf8'));
 return templates.get(kind);
}
const unknown='Chưa xác nhận';
const one=x=>String(x??'').replace(/\r?\n/g,' ').trim();
const cell=x=>one(x).replaceAll('|','\\|');
const table=(headers,rows)=>rows.length?[`| ${headers.join(' | ')} |`,`| ${headers.map(()=>'---').join(' | ')} |`,...rows.map(row=>`| ${row.map(cell).join(' | ')} |`)].join('\n'):'Chưa có dữ liệu; cần làm rõ với stakeholder.';
const bullets=(items,empty=unknown)=>items?.length?items.map(x=>`- ${one(x)}`).join('\n'):`- ${empty}`;
const numbered=(items,empty=unknown)=>items?.length?items.map((x,i)=>`${i+1}. ${one(x)}`).join('\n'):`- ${empty}`;
const evidenceLabel=x=>x.evidenceStatus==='evidence-found-not-approved'?'Có bằng chứng văn bản; chưa phải phê duyệt':'Chưa xác minh nguồn';
const sourceFor=(c,item)=>c.sources.some(s=>s.id===item.sourceId)?item.sourceId:unknown;
const references={
 brd:'- [IIBA: requirements and designs / BABOK](https://www.iiba.org/knowledgehub/the-business-analysis-standard/4-implementing-business-analysis/4-4-understanding-requirements-and-designs/)\n- [ISO/IEC/IEEE 29148:2018](https://www.iso.org/standard/72089.html)',
 srs:'- [ISO/IEC/IEEE 29148:2018](https://www.iso.org/standard/72089.html)',
 urd:'- [ISO/IEC/IEEE 29148:2018 — stakeholder requirements](https://www.iso.org/standard/72089.html)',
 'use-cases':'- Alistair Cockburn, Writing Effective Use Cases (2001) — tham chiếu cấu trúc đặc tả.\n- [Jacobson & Cockburn: Use-Case Foundation](https://alistaircockburn.com/Use%20Case%20Foundation.pdf)\n- [OMG UML 2.5.1](https://www.omg.org/spec/UML/2.5.1/)',
 'user-stories':'- [Mike Cohn / Mountain Goat Software: Writing User Stories](https://www.mountaingoatsoftware.com/agile/user-stories/writing-user-stories)\n- [Bill Wake: INVEST in Good Stories, and SMART Tasks](https://xp123.com/invest-in-good-stories-and-smart-tasks/)\n- [Cucumber: Gherkin reference](https://cucumber.io/docs/gherkin/reference/)'
};
function functional(c){return c.requirements.functional.map(fr=>{
 const screens=c.traceability.find(t=>t.requirementId===fr.id)?.screenIds||[];
 return `### ${fr.id} — ${one(fr.name)}\n\n`+table(['Thuộc tính','Nội dung'],[
 ['Mô tả',fr.description||unknown],['Tác nhân',fr.actor||unknown],['Ưu tiên',fr.priority||unknown],['Mức xác minh',evidenceLabel(fr)],['Nguồn',sourceFor(c,fr)],['Trích dẫn',fr.sourceEvidence||unknown],['Mục tiêu',fr.relatedBusinessGoal||unknown],['Prototype (thiết kế tham khảo)',screens.join(', ')||'Chưa có mapping']])+`\n\n**Tiền điều kiện — DRAFT**\n${bullets(fr.preconditions)}\n\n**Luồng chính — DRAFT, cần xác nhận từng bước**\n${numbered(fr.mainFlow)}\n\n**Luồng thay thế / ngoại lệ — DRAFT**\n${bullets(fr.alternateFlows)}\n\n**Tiêu chí chấp nhận đề xuất — chưa được kiểm chứng**\n${bullets(fr.acceptanceCriteria)}\n`;
 }).join('\n')||'Chưa có yêu cầu chức năng; cần elicitation trước khi đặc tả.'}
function useCases(c){return c.requirements.functional.map(fr=>`### UC-${fr.id} — ${one(fr.name)}\n\n`+table(['Thuộc tính','Nội dung'],[
 ['FR gốc',fr.id],['Scope',c.project.name],['Level',unknown+' — cần phân loại mức mục tiêu'],['Mục tiêu',fr.relatedBusinessGoal||unknown],['Tác nhân chính',fr.actor||unknown],['Tác nhân hỗ trợ',unknown],['Stakeholder interests',unknown+' — cần xác nhận cho use case này'],['Trigger',unknown],['Minimal guarantee',unknown],['Success guarantee',unknown],['Ưu tiên',fr.priority||unknown],['Nguồn',sourceFor(c,fr)],['Trích dẫn',fr.sourceEvidence||unknown],['Mức xác minh',evidenceLabel(fr)]])+`\n\n**Tiền điều kiện — DRAFT**\n${bullets(fr.preconditions)}\n\n**Kịch bản thành công chính — DRAFT**\n${numbered(fr.mainFlow)}\n\n**Extensions: điều kiện rẽ nhánh, bước tham chiếu và cách kết thúc**\n${bullets(fr.alternateFlows)}\nLiên kết ngoại lệ tới bước cụ thể chưa được xác nhận.\n\n**Biến thể dữ liệu / công nghệ; tần suất và vấn đề đặc biệt**\n${unknown}.\n\n**Tiêu chí chấp nhận đề xuất**\n${bullets(fr.acceptanceCriteria)}\n`).join('\n')||'Chưa có FR để mô tả use case. Cần làm rõ tác nhân, mục tiêu và kịch bản.'}
function uml(c){
 const links=c.requirements.functional.filter(fr=>fr.actor);
 if(!links.length)return 'Chưa có tác nhân liên kết FR để lập mô hình UML.';
 // Labels contain IDs only: customer text cannot become PlantUML directives/macros.
 const actors=[...new Set(links.map(fr=>fr.actor))];
 const index=table(['Nhãn UML','Vai trò trong mô hình phân tích'],actors.map((actor,i)=>[`A${i+1}`,actor]));
 const lines=['@startuml','left to right direction',...actors.map((_,i)=>`actor A${i+1}`),'rectangle System {',...links.map((fr,i)=>`  usecase "UC-${fr.id.replace(/[^A-Za-z0-9_-]/g,'_')}" as U${i+1}`),'}',...links.map((fr,i)=>`A${actors.indexOf(fr.actor)+1} -- U${i+1}`),'@enduml'];
 return index+'\n\n```plantuml\n'+lines.join('\n')+'\n```\n\nMã sơ đồ để chỉnh sửa; server không thực thi hoặc gửi tới dịch vụ vẽ bên ngoài.';
}
function stories(c){return c.requirements.functional.map(fr=>{
 const complete=fr.preconditions?.length&&fr.mainFlow?.length&&fr.acceptanceCriteria?.length;
 const given=fr.preconditions?.length?fr.preconditions.map((text,i)=>(i?'And ':'Given ')+one(text)):['Given [Chưa xác nhận tiền điều kiện]'];
 const when=fr.mainFlow?.length?fr.mainFlow.map((text,i)=>(i?'And ':'When ')+one(text)):['When [Chưa xác nhận hành động]'];
 const then=fr.acceptanceCriteria?.length?fr.acceptanceCriteria.map((text,i)=>(i?'And ':'Then ')+one(text)):['Then [Chưa xác nhận kết quả chấp nhận]'];
 const safe=s=>one(s).replaceAll('`','');
 const gherkin=[`Feature: ${safe(fr.name)}`,'',`  @draft @requires_review${complete?'':' @incomplete'}`,`  Scenario: US-${safe(fr.id)} — dự thảo từ FR`,...given.map(s=>'    '+safe(s)),...when.map(s=>'    '+safe(s)),...then.map(s=>'    '+safe(s))].join('\n');
 return `### US-${fr.id} — ${one(fr.name)}\n\nVới vai trò **${one(fr.actor)||unknown}**, tôi muốn **${one(fr.name)}**, để **${one(fr.relatedBusinessGoal)||unknown}**.\n\n`+
 table(['FR gốc','Ưu tiên','Nguồn','Trích dẫn','Mức xác minh'],[[fr.id,fr.priority||unknown,sourceFor(c,fr),fr.sourceEvidence||unknown,evidenceLabel(fr)]])+`\n\n**Conversation: vấn đề cần trao đổi**\nVai trò, giá trị, phạm vi nhỏ nhất, ngoại lệ và phụ thuộc cần BA/stakeholder xác nhận; không coi câu story được chuyển dạng là đã được duyệt.\n\n**INVEST — cần đánh giá thủ công**\n`+
 table(['Tiêu chí','Trạng thái','Điểm cần rà soát'],[
 ['I — Independent','CHƯA ĐÁNH GIÁ','Phụ thuộc vào story/yêu cầu nào?'],['N — Negotiable','CHƯA ĐÁNH GIÁ','Nội dung nào cần thảo luận và có thể thương lượng?'],['V — Valuable','CHƯA ĐÁNH GIÁ','Stakeholder có xác nhận giá trị đã nêu không?'],['E — Estimable','CHƯA ĐÁNH GIÁ','Nhóm thực hiện đã đủ dữ liệu để ước lượng chưa?'],['S — Small','CHƯA ĐÁNH GIÁ','Có thể chia thành giá trị nhỏ có thể bàn giao không?'],['T — Testable','CHƯA ĐÁNH GIÁ','AC và dữ liệu kiểm thử đã được xác nhận chưa?']])+`\n\n**Confirmation — Gherkin DRAFT**\n\n\`\`\`gherkin\n${gherkin}\n\`\`\`\n\n**Ngoại lệ / AC cần bổ sung**\n${bullets(fr.alternateFlows)}\n`;
 }).join('\n')||'Chưa có FR để lập user story. Cần xác định vai trò, nhu cầu, giá trị và AC.'}

/** Deterministic formatting of one canonical snapshot, with no inferred business facts. */
export function renderStandardDocument(kind,c){
 if(c?.schemaVersion!=='ba.canonical.v1')throw Error('Expected ba.canonical.v1');
 const template=getDocumentTemplate(kind),frs=c.requirements.functional,nfrs=c.requirements.nonFunctional;
 const values={
 title:one(c.project.name),
 document_control:table(['Thuộc tính','Giá trị'],[['Mã tài liệu',`${kind.toUpperCase()}/${c.project.id||unknown}`],['Mã dự án',c.project.id||unknown],['Loại tài liệu',kind.toUpperCase()],['Phiên bản dữ liệu',c.project.version],['Template','ba-documents-v1'],['Trạng thái','DRAFT / NOT_BASELINED'],['Người soạn / chủ sở hữu tài liệu',unknown],['Nguồn mô hình',c.schemaVersion]])+'\n\n### Thay đổi gần nhất trong mô hình\n'+table(['Loại','ID','Nội dung'],(c.revisions?.lastChanges||[]).map(x=>[x.type,x.id,x.label||unknown])),
 business_context:`${c.business.summary||unknown}\n\n**Vấn đề kinh doanh:** ${c.business.problem||unknown}`,
 business_goals:table(['ID mục tiêu (từ canonical)','Nội dung'],c.business.businessGoals.map(g=>[g.id,g.statement])),
 stakeholders:table(['Vai trò','Nhu cầu trong mô hình phân tích'],c.business.stakeholders.map(s=>[s.role,s.need])),
 scope:`### Trong phạm vi\n${bullets(c.business.scopeIn)}\n\n### Ngoài phạm vi\n${bullets(c.business.scopeOut)}`,
 capabilities:table(['FR gốc','Năng lực dự thảo','Vai trò','Ưu tiên','Mục tiêu','Nguồn'],frs.map(fr=>[fr.id,fr.name,fr.actor||unknown,fr.priority,fr.relatedBusinessGoal||unknown,sourceFor(c,fr)])),
 business_rules:table(['BR ID','Quy tắc','Trạng thái','Nguồn','Trích dẫn'],c.requirements.businessRules.map(br=>[br.id,br.rule,evidenceLabel(br),sourceFor(c,br),br.sourceEvidence||unknown])),
 functional_requirements:functional(c),
 nonfunctional_requirements:table(['NFR ID','Nhóm','Nội dung','Chỉ tiêu đo','Nguồn','Mức xác minh'],nfrs.map(n=>[n.id,n.category,n.description,n.measurableTarget||unknown,sourceFor(c,n),evidenceLabel(n)])),
 assumptions_risks:`### Giả định\n${bullets(c.elicitation.assumptions,'Chưa có giả định được ghi nhận')}\n\n### Rủi ro\n${bullets(c.elicitation.risks,'Chưa có rủi ro được ghi nhận')}`,
 questions:table(['Q ID','Ưu tiên','Trạng thái','Câu hỏi','Tác động'],c.elicitation.questions.map(q=>[q.id,q.priority,q.status||'open',q.question,q.impact])),
 traceability:table(['Yêu cầu','Mục tiêu','Nguồn','Mức xác minh','Prototype'],c.traceability.map(t=>[t.requirementId,t.businessGoalId||unknown,c.sources.some(s=>s.id===t.sourceId)?t.sourceId:unknown,t.evidenceStatus,t.screenIds.join(', ')||'Chưa có mapping'])),
 verification:table(['FR ID','AC đề xuất','Nguồn','Phương pháp và kết quả'],frs.map(fr=>[fr.id,fr.acceptanceCriteria?.join('; ')||unknown,sourceFor(c,fr),'Chưa xác nhận phương pháp, dữ liệu, người nghiệm thu và kết quả'])),
 review:`- BA Review: ${c.review.baReviewed?'Đã ghi nhận':'Chưa ghi nhận'}.\n- BA Review không đồng nghĩa khách hàng ký duyệt.\n- Trích dẫn chỉ chứng minh hỗ trợ văn bản; không chứng minh phê duyệt.\n- Baseline: NOT_BASELINED; thẩm quyền và bằng chứng khách hàng ký duyệt: ${unknown}.\n- Ghi chú BA (chưa xác minh): ${c.review.notes||'Chưa có'}.\n- Mọi thay đổi phải gắn phiên bản, giữ ID, cập nhật truy vết và rà soát lại.`,
 source_catalog:table(['Source ID','Loại','Tham chiếu','Người trả lời','Lưu ý'],c.sources.map(s=>[s.id,s.type,s.sourceReference||unknown,s.respondent||unknown,'Không tự chứng minh customer sign-off'])),
 references:references[kind],
 user_needs:table(['FR gốc','Tác nhân','Mục tiêu sử dụng dự thảo','Ưu tiên','Nguồn'],frs.map(fr=>[fr.id,fr.actor||unknown,fr.name,fr.priority,sourceFor(c,fr)])),
 use_cases:useCases(c),uml:uml(c),
 story_index:table(['Bí danh story','FR gốc','Vai trò','Mục tiêu','Giá trị'],frs.map(fr=>[`US-${fr.id}`,fr.id,fr.actor||unknown,fr.name,fr.relatedBusinessGoal||unknown])),
 user_stories:stories(c)
 };
 return template.replace(/\{\{([a-z_]+)\}\}/g,(_,key)=>{if(!Object.hasOwn(values,key))throw Error('Unknown template field: '+key);return values[key]});
}
