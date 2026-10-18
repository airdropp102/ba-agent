/**
 * Deterministic quality gate for BABOK v3 RADD Verify / Elicitation Confirm.
 * It identifies missing information; it never fabricates business facts.
 *
 * v1.1 changes:
 *  - finding IDs and question IDs are derived from content, not from list position,
 *    so answers/decisions that reference them survive re-analysis;
 *  - resolved questions no longer block status / baselineEligible;
 *  - questions are truncated by priority, never silently dropping High ones first;
 *  - prepareBAAnalysis() verifies `confirmed` quotes against the project sources.
 */
import {createHash} from 'node:crypto';
import {verifyEvidence} from './ba-evidence.js';

const MAX_QUESTIONS = 160;
const RANK = {High: 0, Medium: 1, Low: 2};
const shortHash = s => createHash('sha256').update(s).digest('hex').slice(0, 8);
const norm = s => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const isOpen = q => q?.status !== 'resolved';
const isFindingOrigin = o => typeof o === 'string' && o.startsWith('GAP-');
const UNMEASURED = /^\s*(tbd|n\/a|chưa)/i;

export function evaluateQuality(analysis) {
  const findings = [];
  const usedIds = new Set();
  const add = (code, priority, question, impact, requirementId = '') => {
    const base = `GAP-${code}${requirementId ? `-${requirementId}` : ''}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}~${n}`;
    usedIds.add(id);
    findings.push({id, code, priority, question, impact, requirementId, status: 'open', origin: 'deterministic-check'});
  };
  const goals = new Set(analysis.businessGoals || []);

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
    else if (!goals.has(fr.relatedBusinessGoal)) add('GOAL_TRACE_BROKEN', 'Medium', `${id} tham chiếu một mục tiêu không có trong danh sách mục tiêu kinh doanh. Mục tiêu nào đúng?`, 'Truy vết yêu cầu → mục tiêu bị đứt.', id);
    if (!fr.mainFlow?.length) add('MISSING_MAIN_FLOW', 'Medium', `Các bước xử lý chính của ${id} diễn ra như thế nào?`, 'Luồng nghiệp vụ chưa đủ để thiết kế.', id);
  }
  for (const nfr of analysis.nonFunctionalRequirements || []) {
    const target = String(nfr.measurableTarget ?? '');
    if (!target.trim() || UNMEASURED.test(target)) {
      add('UNMEASURABLE_NFR', 'High', `Ngưỡng đo và cách kiểm thử ${nfr.id} (${nfr.category}) là gì?`, 'Không thể kiểm thử NFR với mức đo chưa xác định.', nfr.id);
    }
    if (nfr.certainty !== 'confirmed') add('UNVERIFIED_NFR', 'Medium', `Khách hàng có xác nhận yêu cầu ${nfr.id} không?`, 'NFR chưa có căn cứ trong nguồn.', nfr.id);
  }

  const openQuestions = (analysis.clarificationQuestions || []).filter(isOpen);
  return {
    policyVersion: 'ba-quality-v1',
    status: findings.some(x => x.priority === 'High') || openQuestions.some(x => x.priority === 'High')
      ? 'NEEDS_CLARIFICATION' : 'READY_FOR_BA_REVIEW',
    counts: {high: findings.filter(x => x.priority === 'High').length, medium: findings.filter(x => x.priority === 'Medium').length},
    findings,
    // This is not customer sign-off. No automatic baseline action is exposed.
    baselineEligible: findings.length === 0 && openQuestions.length === 0 && (analysis.assumptions || []).length === 0,
  };
}

/**
 * Merge model questions with deterministic findings.
 * IDs: reuse the ID of the same question in `previous` (by finding origin, then by text);
 * otherwise derive from content. Output is ordered by priority so truncation drops Low first.
 */
export function augmentQuestions(questions = [], findings = [], previous = []) {
  const prevByText = new Map(), prevByOrigin = new Map();
  for (const q of previous || []) {
    if (!q?.id) continue;
    prevByText.set(norm(q.question), q.id);
    if (isFindingOrigin(q.origin)) prevByOrigin.set(q.origin, q.id);
  }
  const out = new Map(), usedIds = new Set();
  const add = q => {
    const key = norm(q?.question);
    if (!key || out.has(key)) return;
    const base = (isFindingOrigin(q.origin) && prevByOrigin.get(q.origin))
      || prevByText.get(key)
      || `Q-${shortHash(isFindingOrigin(q.origin) ? q.origin : `${q.relatedRequirementId || ''}|${key}`)}`;
    let id = base;
    for (let n = 2; usedIds.has(id); n++) id = `${base}-${n}`;
    usedIds.add(id);
    out.set(key, {...q, id});
  };
  for (const q of questions || []) add(q);
  for (const g of findings || []) add({question: g.question, impact: g.impact, priority: g.priority, origin: g.id, relatedRequirementId: g.requirementId});
  return [...out.values()].sort((a, b) => (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3));
}

/**
 * @param analysis           raw model analysis
 * @param sources            project sources ([{id,text}]); pass `p.sources?.length ? p.sources : buildSources(p.brief)`.
 *                           When omitted the evidence gate is skipped (legacy behaviour).
 * @param previousQuestions  `p.analysis?.clarificationQuestions` from the previous run, to keep IDs stable.
 */
export function prepareBAAnalysis(analysis, sources = null, previousQuestions = []) {
  const {analysis: verified, downgraded} = sources
    ? verifyEvidence(analysis, sources)
    : {analysis, downgraded: []};
  const quality = evaluateQuality(verified);
  const all = augmentQuestions(verified.clarificationQuestions, quality.findings, previousQuestions);
  return {
    ...verified,
    clarificationQuestions: all.slice(0, MAX_QUESTIONS),
    quality: {...quality, evidenceDowngrades: downgraded, truncatedQuestions: Math.max(0, all.length - MAX_QUESTIONS)},
  };
}