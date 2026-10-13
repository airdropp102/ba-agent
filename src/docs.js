const esc = x => String(x ?? '').replace(/\|/g,'\\|').replace(/\r?\n/g,' ').trim();
const bullet = (arr,empty='Chưa xác định') => arr?.length ? arr.map(x => `- ${x}`).join('\n') : `- ${empty}`;
const table = (headers, rows) => [
  `| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`,
  ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)
].join('\n');
const mdHead = (p, title) => `# ${title}: ${p.analysis.projectName}\n\n> Trạng thái: BẢN THẢO — yêu cầu BA xác nhận trước khi nghiệm thu.\n> Phiên bản dự án: ${p.version} • Tạo ngày ${new Date().toISOString().slice(0,10)}\n> Nguồn: ${p.title} / yêu cầu nhập trực tiếp và ghi chú review.\n> Chế độ: ${p.demo ? 'DEMO (không phân tích AI)' : 'AI hỗ trợ phân tích'}\n\n`;
const questions = a => a.clarificationQuestions.length ? table(['ID','Ưu tiên','Câu hỏi','Tác động'],a.clarificationQuestions.map(q => [q.id,q.priority,q.question,q.impact])) : 'Không có câu hỏi đang được ghi nhận.';
const proposalsAppendix=p=>{
 const proposals=p.clarificationRecommendations||[],decisions=p.clarificationDecisions||[];
 const approved=decisions.filter(x=>x.status==='APPROVED');
 return `\n\n## Technology-aware clarification decisions (not customer baseline)\n${p.requirementsRefreshPending?'**WARNING: RE-ANALYSIS REQUIRED. Decisions are captured, but requirement sections have not yet been regenerated.**\n\n':''}${approved.length?table(['Decision','Question','Authority','Approved answer','Source / reference'],approved.map(d=>[d.id,d.questionId,d.approverRole==='customer'?`Customer approval (attested by ${d.actor}; representative: ${d.customerRepresentative||'unknown'})`:`BA technical decision (${d.actor}); not customer approval`,d.answer,d.sourceReference])):'No authorized recommendation decisions recorded.'}\n\n### Proposed, not accepted\n${proposals.filter(r=>r.status==='PROPOSED').map(r=>`- ${r.questionId}: ${r.options.map(o=>`${o.id} ${o.title}`).join('; ')} (DRAFT)`).join('\n')||'No open suggestions.'}\n`;
};
import {erpFitGapReport,erpSolutionComparison} from './erp-intelligence.js';
const erpAppendix=p=>{const r=erpFitGapReport(p);if(!r.enabled)return '';return `\n\n## ERP solution assessment (human verification required)\n- Strategy: ${r.strategy}\n- Human-reviewed Fit–Gap: ${r.reviewed}/${r.total} (${Math.round(r.coverage*100)}%)\n- Assessment: **${r.assessmentStatus}**; NOT customer sign-off.\n- AS-IS/TO-BE, local accounting/HR compliance, master data, migration, security/SoD and cross-module UAT must be verified with stakeholders.\n\n${table(['FR','ERP candidate','Fit–Gap','Edition/version evidence','Review source'],r.rows.map(x=>[x.requirementId,x.platformName,x.status,x.verifiedEdition&&x.verifiedVersion?`${x.verifiedEdition} / ${x.verifiedVersion}`:'NOT VERIFIED',x.sourceReference||'PENDING']))}\n`;};
const label = x => x === 'confirmed' ? 'Có bằng chứng trong brief' : 'GIẢ ĐỊNH — CẦN XÁC NHẬN';

/** Product Requirements Document: draft derived only from sourced BA analysis. */
export function renderPRD(p){
  const a=p.analysis;
  return mdHead(p,'PRD — Product Requirements Document') +
`## 1. Product problem and objective\n${a.businessProblem||'Chưa xác định'}\n\n## 2. Business goals\n${bullet(a.businessGoals)}\n\n## 3. Users and stakeholders\n${table(['Vai trò','Nhu cầu'],a.stakeholders.map(x=>[x.role,x.need]))}\n\n## 4. Scope\n### In scope\n${bullet(a.scopeIn)}\n\n### Out of scope\n${bullet(a.scopeOut,'Chưa thống nhất')}\n\n## 5. Product capabilities (DRAFT)\n${table(['ID','Tính năng','Ưu tiên','Mức xác thực','Bằng chứng'],a.functionalRequirements.map(x=>[x.id,x.name,x.priority,label(x.certainty),x.sourceEvidence||'CẦN XÁC NHẬN']))}\n\n## 6. Success criteria / metrics\nChưa được xác định nếu không có bằng chứng rõ ràng trong yêu cầu khách hàng. Không tự suy diễn KPI.\n\n## 7. Constraints and non-functional needs\n${table(['ID','Nhóm','Mục tiêu đo','Mức xác thực'],a.nonFunctionalRequirements.map(x=>[x.id,x.category,x.measurableTarget,label(x.certainty)]))}\n\n## 8. Assumptions and risks\n${bullet(a.assumptions)}\n\n${bullet(a.risks)}\n\n## 9. Clarifications required\n${questions(a)}\n\n## 10. Approvals\n${p.review?.approved?'BA review recorded; customer sign-off NOT implied.':'No BA approval yet.'}\n` + proposalsAppendix(p) + erpAppendix(p) + qualityAppendix(p);
}

export function renderBRD(p) {
  const a=p.analysis;
  return mdHead(p,'BRD — Business Requirements Document') +
`## 1. Tổng quan và bối cảnh\n${a.executiveSummary || 'Chưa xác định'}\n\n## 2. Vấn đề kinh doanh\n${a.businessProblem}\n\n## 3. Mục tiêu kinh doanh\n${bullet(a.businessGoals)}\n\n## 4. Stakeholder\n${table(['Vai trò','Nhu cầu'],a.stakeholders.map(x=>[x.role,x.need]))}\n\n## 5. Phạm vi\n### Trong phạm vi\n${bullet(a.scopeIn)}\n\n### Ngoài phạm vi (chỉ khi đã nêu rõ)\n${bullet(a.scopeOut,'Chưa được thống nhất')}\n\n## 6. Business Rules\n${table(['ID','Quy tắc','Mức xác thực','Bằng chứng'],a.businessRules.map(x=>[x.id,x.rule,label(x.certainty),x.sourceEvidence || 'Không có']))}\n\n## 7. Danh mục nhu cầu/chức năng\n${table(['ID','Tên','Vai trò','Ưu tiên','Mục tiêu','Mức xác thực'],a.functionalRequirements.map(x=>[x.id,x.name,x.actor,x.priority,x.relatedBusinessGoal || 'Chưa liên kết',label(x.certainty)]))}\n\n## 8. Giả định\n${bullet(a.assumptions,'Chưa ghi nhận')}\n\n## 9. Rủi ro\n${bullet(a.risks,'Chưa ghi nhận')}\n\n## 10. Open Questions\n${questions(a)}\n\n## 11. Ghi chú BA Review\n${p.review?.notes || 'Chưa có'}\n\n## 12. Trạng thái phê duyệt\n${p.review?.approved ? `Đã được BA đánh dấu rà soát vào ${p.review.reviewedAt}; không đồng nghĩa khách hàng ký duyệt.` : 'Chưa được BA rà soát.'}\n` + proposalsAppendix(p) + erpAppendix(p) + qualityAppendix(p);
}

export function renderSRS(p) {
  const a=p.analysis;
  const screens = p.prototype?.screens || [];
  const frs = a.functionalRequirements.map(fr => {
    const refs = screens.filter(x=>x.requirementIds.includes(fr.id)).map(x=>`${x.id} (${x.title})`);
    return `### ${fr.id} — ${fr.name}\n- **Mô tả:** ${fr.description || 'TBD'}\n- **Tác nhân:** ${fr.actor || 'TBD'}\n- **Ưu tiên:** ${fr.priority}\n- **Mức xác thực:** ${label(fr.certainty)}\n- **Bằng chứng:** ${fr.sourceEvidence || 'Không có; cần phỏng vấn'}\n- **Mục tiêu liên kết:** ${fr.relatedBusinessGoal || 'Chưa liên kết'}\n- **Prototype:** ${refs.join(', ') || 'Chưa có mapping'}\n\n**Tiền điều kiện**\n${bullet(fr.preconditions,'TBD')}\n\n**Luồng chính (mục chưa được khách hàng xác nhận vẫn chỉ là đề xuất)**\n${bullet(fr.mainFlow,'TBD')}\n\n**Luồng ngoại lệ**\n${bullet(fr.alternateFlows,'TBD')}\n\n**Tiêu chí nghiệm thu đề xuất**\n${bullet(fr.acceptanceCriteria,'Chưa có — không thể nghiệm thu tự động')}\n`;
  }).join('\n');
  const rows = a.functionalRequirements.map(fr => [fr.id,fr.relatedBusinessGoal || 'TBD',label(fr.certainty),screens.filter(s=>s.requirementIds.includes(fr.id)).map(s=>s.id).join(', ') || '—']);
  return mdHead(p,'SRS — Software Requirements Specification') +
`## 1. Mục tiêu và ranh giới hệ thống\n${a.executiveSummary}\n\n## 2. Đối tượng sử dụng\n${table(['Vai trò','Nhu cầu'],a.stakeholders.map(x=>[x.role,x.need]))}\n\n## 3. Yêu cầu chức năng\n${frs || 'Chưa đủ yêu cầu chức năng được xác định.'}\n\n## 4. Yêu cầu phi chức năng\n${table(['ID','Nhóm','Mô tả','Chỉ tiêu đo','Mức xác thực'],a.nonFunctionalRequirements.map(x=>[x.id,x.category,x.description,x.measurableTarget,label(x.certainty)]))}\n\n## 5. Quy tắc nghiệp vụ\n${table(['ID','Quy tắc','Nguồn'],a.businessRules.map(x=>[x.id,x.rule,x.sourceEvidence || 'Chưa có']))}\n\n## 6. Ma trận truy vết BRD → SRS → Prototype\n${table(['FR ID','Business goal','Trạng thái nguồn','Màn hình'],rows)}\n\n## 7. Giao diện tích hợp, dữ liệu, bảo mật\nChưa có đặc tả kỹ thuật được xác nhận. Cần làm rõ tích hợp, dữ liệu, phân quyền chi tiết, quyền riêng tư và NFR trước triển khai.\n\n## 8. Vấn đề mở\n${questions(a)}\n\n## 9. Ghi chú review\n${p.review?.notes || 'Chưa có'}\n\n## 10. Điều kiện bàn giao\nTài liệu mang tính draft. Cần phê duyệt nghiệp vụ và hoàn thành các điểm mở trước khi baseline SRS.\n` + proposalsAppendix(p) + erpAppendix(p) + qualityAppendix(p);
}


/** Deterministic BABOK-inspired verification appendix shared by BRD & SRS. */
function qualityAppendix(p) {
  const q = p.analysis.quality;
  if (!q) return '\n\n## Quality Gate\nChưa chạy bộ kiểm tra chất lượng.\n';
  return `\n\n## BABOK Quality Gate (draft)\n- Trạng thái: **${q.status}**\n- Gap ưu tiên High: ${q.counts.high}; Medium: ${q.counts.medium}\n- Eligible to baseline (kiểm tra tự động): **${q.baselineEligible ? 'Có, vẫn cần phê duyệt khách hàng' : 'Không'}**\n- BA review **không** đồng nghĩa khách hàng ký duyệt.\n\n` +
    table(['Gap ID','Mã kiểm tra','Requirement','Ưu tiên','Câu hỏi cần làm rõ'],q.findings.map(f=>[f.id,f.code,f.requirementId||'—',f.priority,f.question])) + '\n';
}

export function renderQuestionnaire(p) {
  const a=p.analysis;
  const answers=p.answers||[];
  return `# Phiếu câu hỏi làm rõ — ${a.projectName}\n\n> DRAFT — answers need BA review; quote evidence is not customer sign-off.\n> Phiên bản dự án ${p.version}.\n\n` +
    (a.clarificationQuestions||[]).map(q=>{
      const last=answers.filter(item=>item.questionId===q.id).at(-1);
      return `## ${q.id} · ${q.priority}\n\n**Câu hỏi:** ${q.question}\n\n**Tác động:** ${q.impact}\n\n**Trạng thái:** ${q.status==='resolved'?'Đã chọn phương án, vẫn cần BA Review':last?'Đã nhận câu trả lời, chờ BA rà soát':'Đang mở'}\n\n**Người trả lời:** ${last?.respondent||'_Chưa xác định_'}\n\n**Câu trả lời:** ${last?.answer||'_Chưa có_'}\n\n**Nguồn (email/biên bản/ngày):** ${last?.sourceReference||'_Chưa có_'}\n\n${(p.clarificationRecommendations||[]).find(r=>r.questionId===q.id)?.options.map(o=>`**${o.id}: ${o.title}${(p.clarificationRecommendations||[]).find(r=>r.questionId===q.id)?.preferredOptionId===o.id?' (AI khuyến nghị)':''}**\n\n- Đề xuất: ${o.answer}\n- Lợi ích: ${o.benefits}\n- Trade-off: ${o.tradeoffs}\n- Triển khai/xác minh: ${o.implementation}\n- Stack: ${o.stackReferences.join(', ')}\n`).join('\n')||'_Chưa sinh đề xuất kỹ thuật cho câu hỏi này._'}\n\n---\n`;
    }).join('\n');
}


/** v3.8 supplementary ERP artifacts, never customer-approved from template text. */
export function renderERPDiscovery(p){
 const report=erpFitGapReport(p);
 if(!report.enabled)return '# ERP process discovery\n\nNot an ERP project.\n';
 return `# ERP discovery — ${p.title}\n\n> DRAFT. Questions are NOT customer statements. Capture As-Is, To-Be, process owners, control points and evidence during workshops.\n\n`+
 report.processChecklist.map(x=>`## ${x.processName}\n\n${x.questions.map(q=>`- [ ] ${q.question} — **OPEN / source not confirmed**`).join('\n')}\n`).join('\n')+
 '\n## Cross-module acceptance checklist\n- [ ] Reconcile SO/PO/MO, inventory valuation, invoices and journal entries where applicable\n- [ ] Establish process owners, approval matrix and segregation-of-duties\n- [ ] Verify localization/tax/accounting/legal requirements with domain experts\n- [ ] Inventory master data sources, cutover/migration, integrations and exception/reversal paths\n- [ ] End-to-end UAT scenarios, data setup and sign-off authority\n';
}
export function renderERPSolutionComparison(p){
 const entries=erpSolutionComparison(p);if(!entries.length)return '# ERP solution comparison\n\nNot an ERP project.\n';
 return `# Build vs Adopt vs Hybrid — ${p.title}\n\n> Decision support only. No platform is selected. Scores, capability claims, costs and compliance status are UNKNOWN until verified by a BA/customer and corresponding specialists.\n\n`+
 table(['Option','License/edition','Human Fit–Gap coverage','5-year TCO','Localization','Decision'],entries.map(x=>[x.title,x.license,x.fitGapCoverage===null?'N/A':`${Math.round(100*x.fitGapCoverage)}%`,x.fiveYearTCO,x.localization,x.decisionStatus]))+
 '\n\n## Evaluation protocol\n1. Confirm requirements and AS-IS/TO-BE process maps.\n2. Demo candidate modules with exact version and edition; collect Fit–Gap evidence and exceptions.\n3. Estimate license, configuration, development, integration, data migration, training, support and 3–5 year upgrade costs.\n4. Assess data portability, vendor risks, segregation of duties, local compliance and end-to-end UAT.\n5. Record authorized solution decision and customer scope baseline separately.\n';
}
