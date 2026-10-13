/**
 * Deterministic quality gate for BABOK v3 RADD Verify / Elicitation Confirm.
 * It identifies missing information; it never fabricates business facts.
 */
export function evaluateQuality(analysis) {
  const findings = [];
  const add = (code, priority, question, impact, requirementId = '') => {
    findings.push({
      id: `GAP-${String(findings.length + 1).padStart(3, '0')}`,
      code, priority, question, impact, requirementId,
      status: 'open', origin: 'deterministic-check',
    });
  };
  if (!analysis.businessGoals?.length) add('NO_BUSINESS_GOALS', 'High', 'Các mục tiêu kinh doanh cụ thể và tiêu chí đo thành công là gì?', 'Không xác định được giá trị kinh doanh và truy vết yêu cầu.');
  if (!analysis.stakeholders?.length) add('NO_STAKEHOLDERS', 'High', 'Ai là các nhóm người dùng và bên liên quan cần tham gia xác nhận yêu cầu?', 'Chưa có stakeholder để xác nhận đầu ra elicitation.');
  if (!analysis.functionalRequirements?.length) add('NO_FUNCTIONAL_REQUIREMENTS', 'High', 'Những chức năng bắt buộc và phạm vi cụ thể khách hàng yêu cầu là gì?', 'Không đủ yêu cầu để đặc tả hoặc tạo prototype.');
  const problem = String(analysis.businessProblem || '').toLowerCase();
  if (!problem || /chưa (được )?(nêu|xác định|rõ)|cần (xác nhận|phỏng vấn)|tbd/.test(problem)) {
    add('NO_BUSINESS_PROBLEM', 'Medium', 'Vấn đề kinh doanh hiện tại và ảnh hưởng cụ thể là gì?', 'Chưa thể đánh giá sự phù hợp của mục tiêu và giải pháp.');
  }
  for (const fr of analysis.functionalRequirements || []) {
    const id = fr.id || '';
    if (!fr.actor) add('MISSING_ACTOR', 'High', `Ai được phép thực hiện chức năng ${id} (${fr.name})?`, 'Chưa rõ vai trò, quyền truy cập hoặc trách nhiệm.', id);
    if (!fr.description) add('MISSING_DESCRIPTION', 'High', `Mô tả hành vi đầu vào, xử lý, đầu ra của ${id} là gì?`, 'Không thể đặc tả yêu cầu một cách không mơ hồ.', id);
    if (!fr.acceptanceCriteria?.length) add('MISSING_ACCEPTANCE_CRITERIA', 'High', `Điều kiện nghiệm thu kiểm thử được của ${id} là gì?`, 'Không thể xác định pass/fail.', id);
    if (fr.certainty !== 'confirmed') add('UNVERIFIED_REQUIREMENT', 'High', `Khách hàng có xác nhận nội dung ${id} không? Vui lòng cung cấp dẫn chứng hoặc điều chỉnh.`, 'Nội dung chưa có bằng chứng nguyên văn trong brief.', id);
    if (!fr.relatedBusinessGoal) add('MISSING_GOAL_TRACE', 'Medium', `${id} phục vụ mục tiêu kinh doanh nào?`, 'Yêu cầu chưa truy vết tới mục tiêu.', id);
    if (!fr.mainFlow?.length) add('MISSING_MAIN_FLOW', 'Medium', `Các bước xử lý chính của ${id} diễn ra như thế nào?`, 'Luồng nghiệp vụ chưa đủ để thiết kế.', id);
  }
  for (const nfr of analysis.nonFunctionalRequirements || []) {
    if (nfr.measurableTarget?.startsWith('TBD') || !nfr.measurableTarget) {
      add('UNMEASURABLE_NFR', 'High', `Ngưỡng đo và cách kiểm thử ${nfr.id} (${nfr.category}) là gì?`, 'Không thể kiểm thử NFR với mức đo chưa xác định.', nfr.id);
    }
    if (nfr.certainty !== 'confirmed') add('UNVERIFIED_NFR', 'Medium', `Khách hàng có xác nhận yêu cầu ${nfr.id} không?`, 'NFR chưa có căn cứ trong nguồn.', nfr.id);
  }
  return {
    policyVersion: 'ba-quality-v1',
    status: findings.some(x => x.priority === 'High') || (analysis.clarificationQuestions || []).some(x => x.priority === 'High')
      ? 'NEEDS_CLARIFICATION' : 'READY_FOR_BA_REVIEW',
    counts: { high: findings.filter(x=>x.priority === 'High').length, medium: findings.filter(x=>x.priority === 'Medium').length },
    findings,
    // This is not customer sign-off. No automatic baseline action is exposed.
    baselineEligible: findings.length === 0 && (analysis.clarificationQuestions || []).length === 0 && (analysis.assumptions || []).length === 0,
  };
}

export function augmentQuestions(questions = [], findings = []) {
  const normalized = new Set();
  const output = [];
  const add = q => {
    const question = String(q.question || '').trim();
    if (!question || normalized.has(question.toLowerCase())) return;
    normalized.add(question.toLowerCase());
    output.push({...q, id:`Q-${String(output.length + 1).padStart(3,'0')}`});
  };
  for (const q of questions) add(q);
  for (const g of findings) add({question:g.question,impact:g.impact,priority:g.priority,origin:g.id,relatedRequirementId:g.requirementId});
  return output.slice(0,160);
}

export function prepareBAAnalysis(analysis) {
  const quality = evaluateQuality(analysis);
  return {
    ...analysis,
    clarificationQuestions: augmentQuestions(analysis.clarificationQuestions, quality.findings),
    quality,
  };
}
