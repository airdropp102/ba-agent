const asString = (value) => typeof value === 'string' ? value.trim() : '';
const stringArray = (value) => Array.isArray(value) ? value.filter(v => typeof v === 'string').map(v => v.trim()).filter(Boolean).slice(0, 40) : [];
const seq = (prefix, n) => `${prefix}-${String(n + 1).padStart(3, '0')}`;

export function normalizeAnalysis(input, sourceText) {
  if (!input || !Array.isArray(input.functionalRequirements) || !Array.isArray(input.clarificationQuestions)) {
    throw new Error('Kết quả AI không đúng cấu trúc phân tích.');
  }
  const text = asString(sourceText).replace(/\s+/g, ' ').toLowerCase();
  const evidenceValid = (quote) => Boolean(quote) && text.includes(asString(quote).replace(/\s+/g, ' ').toLowerCase());
  const goals = stringArray(input.businessGoals);
  const known = (sourceEvidence, certainty) => certainty === 'confirmed' && evidenceValid(sourceEvidence);
  const list = (value) => Array.isArray(value) ? value : [];
  return {
    projectName: asString(input.projectName) || 'Dự án chưa đặt tên',
    executiveSummary: asString(input.executiveSummary),
    businessProblem: asString(input.businessProblem) || 'Chưa xác định — cần xác nhận khách hàng',
    businessGoals: goals,
    stakeholders: list(input.stakeholders).slice(0, 20).map(x => ({role:asString(x.role),need:asString(x.need)})),
    scopeIn: stringArray(input.scopeIn), scopeOut: stringArray(input.scopeOut),
    businessRules: list(input.businessRules).slice(0, 60).map((x,i) => ({
      id: seq('BR',i), rule:asString(x.rule), sourceEvidence:asString(x.sourceEvidence),
      certainty:known(x.sourceEvidence,x.certainty) ? 'confirmed' : 'assumption'
    })),
    functionalRequirements: list(input.functionalRequirements).slice(0, 100).map((x,i) => ({
      id:seq('FR',i), name:asString(x.name), description:asString(x.description),
      actor:asString(x.actor), priority:['Must','Should','Could'].includes(x.priority) ? x.priority : 'Should',
      sourceEvidence:asString(x.sourceEvidence), certainty:known(x.sourceEvidence,x.certainty) ? 'confirmed' : 'assumption',
      relatedBusinessGoal:goals.includes(x.relatedBusinessGoal) ? x.relatedBusinessGoal : '',
      preconditions:stringArray(x.preconditions),mainFlow:stringArray(x.mainFlow),
      alternateFlows:stringArray(x.alternateFlows),acceptanceCriteria:stringArray(x.acceptanceCriteria)
    })),
    nonFunctionalRequirements: list(input.nonFunctionalRequirements).slice(0, 60).map((x,i) => ({
      id:seq('NFR',i),category:asString(x.category),description:asString(x.description),
      measurableTarget:asString(x.measurableTarget) || 'TBD — khách hàng xác nhận',
      sourceEvidence:asString(x.sourceEvidence),
      certainty:known(x.sourceEvidence,x.certainty) ? 'confirmed' : 'assumption'
    })),
    clarificationQuestions: list(input.clarificationQuestions).slice(0, 60).map((x,i) => ({
      id:seq('Q',i), question:asString(x.question),impact:asString(x.impact),
      priority:['High','Medium','Low'].includes(x.priority) ? x.priority : 'Medium'
    })),
    assumptions:stringArray(input.assumptions),risks:stringArray(input.risks)
  };
}

export function normalizePrototype(input, analysis, {previous=null,maxId=0}={}) {
  const validReqs = new Set(analysis.functionalRequirements.map(x => x.id));
  const raw = Array.isArray(input?.screens) ? input.screens.slice(0, 12) : [];
  const prior=previous?.screens||[];
  const used=new Set();
  let counter=Math.max(maxId,...prior.map(s=>Number(String(s.id).match(/^SCR-(\d+)$/)?.[1]||0)),0);
  const screenId=screen=>{
    const matches=prior.filter(old=>old.title?.trim().toLowerCase()===String(screen.title||'').trim().toLowerCase() && !used.has(old.id));
    const matched=matches.length===1?matches[0]:null;
    const id=matched?.id||`SCR-${String(++counter).padStart(3,'0')}`;
    used.add(id);return id;
  };
  const screens = raw.map((screen, i) => ({
    id: screenId(screen), oldId:asString(screen.id),title:asString(screen.title)||`Màn hình ${i+1}`,
    description:asString(screen.description),
    requirementIds:stringArray(screen.requirementIds).filter(id => validReqs.has(id)),
    components:(Array.isArray(screen.components) ? screen.components : []).slice(0, 20).map(c => ({
      type:['heading','paragraph','input','textarea','select','button','card','list','badge'].includes(c.type) ? c.type : 'paragraph',
      label:asString(c.label), placeholder:asString(c.placeholder), value:asString(c.value),
      options:stringArray(c.options), actionTarget:asString(c.actionTarget)
    }))
  }));
  const screenIds = new Set(screens.map(x => x.id));
  const remap = new Map(screens.map(x => [x.oldId,x.id]));
  for (const screen of screens) {
    delete screen.oldId;
    for (const component of screen.components) {
      component.actionTarget = remap.get(component.actionTarget) || (screenIds.has(component.actionTarget) ? component.actionTarget : '');
    }
  }
  return {screens};
}
