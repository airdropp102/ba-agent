#!/usr/bin/env node
/** Minimal offline semantic validation of the canonical package. Not a full JSON Schema validator. */
import {readFile} from 'node:fs/promises';
const filename = process.argv[2];
if (!filename) {console.error('Usage: node scripts/validate-canonical.mjs path/to/canonical.json'); process.exit(2);}
const x = JSON.parse(await readFile(filename,'utf8'));
const errors = [];
const check = (ok, message) => {if (!ok) errors.push(message);};
check(x.schemaVersion === 'ba.canonical.v1','Unexpected schemaVersion');
const refs = [...(x.requirements?.functional || []),...(x.requirements?.nonFunctional || [])];
const ids = refs.map(r=>r.id);
check(ids.length === new Set(ids).size,'Duplicate requirement IDs');
check((x.requirements?.functional || []).every(r=>/^FR-\d{3}$/.test(r.id)),'Invalid FR IDs');
check((x.requirements?.nonFunctional || []).every(r=>/^NFR-\d{3}$/.test(r.id)),'Invalid NFR IDs');
const srcs = new Set((x.sources||[]).map(s=>s.id));
const goals = new Set((x.business?.businessGoals||[]).map(g=>g.id));
const screens = new Set((x.prototype?.screens||[]).map(s=>s.id));
for (const r of refs) {
  check(r.evidenceStatus === 'needs-source-confirmation' || r.evidenceStatus === 'evidence-found-not-approved', `${r.id}: invalid evidence status`);
  check(!r.sourceId || srcs.has(r.sourceId),`${r.id}: orphan source`);
}
for (const t of x.traceability || []) {
  check(ids.includes(t.requirementId),`Orphan trace requirement ${t.requirementId}`);
  check(!t.businessGoalId || goals.has(t.businessGoalId),`Orphan goal ${t.businessGoalId}`);
  for (const id of t.screenIds || []) check(screens.has(id),`Orphan screen ${id}`);
}
for (const s of x.prototype?.screens || []) {
  for (const id of s.requirementIds||[]) check(ids.includes(id),`Screen ${s.id} has orphan requirement ${id}`);
}
check(x.review?.customerApproved === false, 'MVP does not support customer sign-off. Do not fabricate approval.');
check(x.review?.baselineStatus === 'NOT_BASELINED','MVP does not support baseline.');
if (errors.length) {console.error('FAIL:',errors.join('\n- ')); process.exit(1)}
console.log(`PASS ba.canonical.v1: ${refs.length} requirements, ${(x.prototype?.screens||[]).length} screens`);
