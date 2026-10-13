import test from 'node:test';
import assert from 'node:assert/strict';
import { demoAnalysis, demoPrototype, sampleBrief, sampleTitle } from '../src/demo.js';
import { normalizeAnalysis, normalizePrototype } from '../src/normalize.js';
import { evaluateQuality, augmentQuestions } from '../src/ba-quality.js';
import { buildCanonicalPackage } from '../src/ba-canonical.js';

const fixture = () => normalizeAnalysis(demoAnalysis(sampleTitle, sampleBrief), sampleBrief);

test('BABOK verification gate identifies actor, acceptance and provenance gaps without inventing requirements', () => {
  const analysis = fixture();
  const originalCount = analysis.functionalRequirements.length;
  analysis.functionalRequirements[0].actor = '';
  analysis.functionalRequirements[0].acceptanceCriteria = [];
  analysis.functionalRequirements[1].certainty = 'assumption';
  const quality = evaluateQuality(analysis);
  assert.equal(quality.status, 'NEEDS_CLARIFICATION');
  assert.ok(quality.findings.some(f => f.code === 'MISSING_ACTOR' && f.requirementId === 'FR-001'));
  assert.ok(quality.findings.some(f => f.code === 'MISSING_ACCEPTANCE_CRITERIA' && f.requirementId === 'FR-001'));
  assert.ok(quality.findings.some(f => f.code === 'UNVERIFIED_REQUIREMENT' && f.requirementId === 'FR-002'));
  assert.equal(analysis.functionalRequirements.length, originalCount);
  assert.equal(augmentQuestions(analysis.clarificationQuestions, quality.findings).length, new Set(augmentQuestions(analysis.clarificationQuestions, quality.findings).map(q => q.id)).size);
});

test('Canonical package preserves stable traceability and separates evidence from stakeholder approval', () => {
  const analysis = fixture();
  const project = {
    id: 'example', title: sampleTitle, brief: sampleBrief, version: 2,
    status: 'GENERATED', analysis,
    review: { approved: true, notes: 'BA reviewed', reviewedAt: '2026-10-13T04:00:00.000Z' },
    prototype: normalizePrototype(demoPrototype(analysis), analysis)
  };
  const doc = buildCanonicalPackage(project);
  assert.equal(doc.schemaVersion, 'ba.canonical.v1');
  assert.equal(doc.business.businessGoals[0].id, 'BG-001');
  assert.equal(doc.requirements.functional[0].id, 'FR-001');
  assert.equal(doc.traceability[0].requirementId, 'FR-001');
  assert.deepEqual(doc.traceability[0].screenIds, ['SCR-001']);
  assert.equal(doc.review.baReviewed, true);
  assert.equal(doc.review.customerApproved, false);
  assert.equal(doc.requirements.functional[0].evidenceStatus, 'evidence-found-not-approved');
  assert.ok(doc.sources[0].sha256.match(/^[a-f0-9]{64}$/));
});

test('Empty-brief demo stays in NEEDS_CLARIFICATION with zero invented FR', () => {
  const a = normalizeAnalysis(demoAnalysis('Sample', 'Yêu cầu chưa rõ, vui lòng hỏi lại khách hàng về phạm vi và mục tiêu.'), 'Yêu cầu chưa rõ, vui lòng hỏi lại khách hàng về phạm vi và mục tiêu.');
  const q = evaluateQuality(a);
  assert.equal(a.functionalRequirements.length, 0);
  assert.equal(q.status, 'NEEDS_CLARIFICATION');
  assert.ok(q.findings.some(f => f.code === 'NO_FUNCTIONAL_REQUIREMENTS'));
});
