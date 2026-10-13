import {createHash} from 'node:crypto';
import {evaluateQuality} from './ba-quality.js';
import {resolveEvidenceSource,fingerprint} from './revisions.js';

/** One output contract for BRD, SRS, prototype and external agent handoff. */
export function buildCanonicalPackage(project) {
  if (!project?.analysis) throw new Error('Project must be analyzed before canonical export.');
  const a = project.analysis;
  const sources=project.sources?.length?project.sources:[{id:'SRC-001',type:'legacy-brief-with-amendments',text:project.brief||'',at:project.createdAt||null}];
  const sourceIdFor=quote=>project.sources?.length?resolveEvidenceSource(quote,sources):(quote&&String(project.brief||'').includes(quote)?'SRC-001':null);
  const goals = (a.businessGoals || []).map((statement,i) => ({ id:`BG-${String(i+1).padStart(3,'0')}`,statement }));
  const prototype = project.prototype || {screens: []};
  const screens = prototype.screens || [];
  const requirementIds = new Set([...(a.functionalRequirements||[]),...(a.nonFunctionalRequirements||[])].map(x=>x.id));
  const functional = (a.functionalRequirements || []).map(fr => ({
    ...fr, type:'functional',
    evidenceStatus:fr.certainty === 'confirmed' ? 'evidence-found-not-approved' : 'needs-source-confirmation',
    sourceId: sourceIdFor(fr.sourceEvidence),
  }));
  const nonFunctional = (a.nonFunctionalRequirements || []).map(nfr => ({
    ...nfr, type:'non-functional',
    evidenceStatus:nfr.certainty === 'confirmed' ? 'evidence-found-not-approved' : 'needs-source-confirmation',
    sourceId: sourceIdFor(nfr.sourceEvidence),
  }));
  const traceability = [...functional,...nonFunctional].map(r => ({
    requirementId:r.id,
    businessGoalId:goals.find(g=>g.statement === r.relatedBusinessGoal)?.id || null,
    screenIds:screens.filter(s=>s.requirementIds?.includes(r.id)).map(s=>s.id),
    sourceId:r.sourceId,
    evidenceStatus:r.evidenceStatus,
  }));
  return {
    schemaVersion:'ba.canonical.v1',
    project:{id:project.id, name:a.projectName, title:project.title, version:project.version, status:project.status},
    sources:sources.map(source=>({id:source.id,type:source.type,sha256:fingerprint(source.text),at:source.at||null,respondent:source.respondent||null,sourceReference:source.sourceReference||null,questionId:source.questionId||null,note:'Quote match only — not stakeholder sign-off.'})),
    business:{summary:a.executiveSummary, problem:a.businessProblem,businessGoals:goals, stakeholders:a.stakeholders,scopeIn:a.scopeIn,scopeOut:a.scopeOut},
    requirements:{businessRules:a.businessRules, functional,nonFunctional},
    elicitation:{questions:a.clarificationQuestions,assumptions:a.assumptions,risks:a.risks, amendments:project.amendments||[],answers:project.answers||[],techStack:project.techStack||null,solutionProfile:project.solutionProfile||null,erpFitGap:project.erpFitGap||[],clarificationRecommendations:project.clarificationRecommendations||[],clarificationDecisions:project.clarificationDecisions||[]},
    revisions:{lastChanges:project.changeLog?.at(-1)?.changes||[],count:project.changeLog?.length||0},
    quality:a.quality || evaluateQuality(a),
    review:{baReviewed:Boolean(project.review?.approved), reviewedAt:project.review?.reviewedAt||null,notes:project.review?.notes||'',customerApproved:false,baselineStatus:'NOT_BASELINED'},
    prototype:{screens:screens.map(s=>({...s,requirementIds:s.requirementIds.filter(id=>requirementIds.has(id))}))},
    traceability,
  };
}
