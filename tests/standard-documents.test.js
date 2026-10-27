import test from 'node:test';
import assert from 'node:assert/strict';
import {demoAnalysis,sampleTitle,sampleBrief} from '../src/demo.js';
import {normalizeAnalysis} from '../src/normalize.js';
import {buildCanonicalPackage} from '../src/ba-canonical.js';
import {renderBRD,renderSRS,renderURD,renderUseCases,renderUserStories} from '../src/docs.js';
import {renderStandardDocument,getDocumentTemplate} from '../src/standard-documents.js';

const project=()=>({id:'12345678-1234-4234-8234-123456789abc',title:sampleTitle,brief:sampleBrief,version:7,demo:true,analysis:normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief),sources:[{id:'SRC-042',type:'customer-brief',text:sampleBrief}],review:{approved:true,notes:'BA review only',reviewedAt:'2026-10-26T00:00:00.000Z'}});
test('five real templates render from canonical data with identity, traceability and no approval invention',()=>{
 const p=project(),before=JSON.stringify(p);
 const cases=[['brd',renderBRD,/BABOK v3/],['srs',renderSRS,/ISO\/IEC\/IEEE 29148:2018/],['urd',renderURD,/StRS/],['use-cases',renderUseCases,/Cockburn/],['user-stories',renderUserStories,/INVEST/]];
 for(const [kind,render,standard] of cases){
  assert.match(getDocumentTemplate(kind),/\{\{document_control\}\}/);
  const text=render(p);assert.match(text,standard);assert.match(text,/DRAFT/);assert.match(text,/SRC-042/);assert.match(text,/FR-001/);assert.doesNotMatch(text,/\{\{[a-z_]+\}\}/);assert.match(text,/không.*khách hàng.*ký duyệt/i);
 }
 assert.equal(JSON.stringify(p),before);
 assert.throws(()=>getDocumentTemplate('../secrets'));
});
test('BRD and SRS distinguish business, software, missing interfaces/data and verification',()=>{
 const p=project();assert.match(renderBRD(p),/BRS/);assert.match(renderBRD(p),/Chỉ số.*thành công/);
 const srs=renderSRS(p);for(const section of ['Giao diện','Dữ liệu','Yêu cầu chức năng','Yêu cầu phi chức năng','Xác minh','Truy vết'])assert.ok(srs.includes(section),section);
 assert.match(srs,/Chưa xác nhận/);assert.doesNotMatch(srs,/99\.9%|200 ms|1000 người/);
});
test('use-case and story aliases follow FR identity rather than list order; unsupported semantics stay unknown',()=>{
 const p=project(),canonical=buildCanonicalPackage(p);const uc=renderStandardDocument('use-cases',canonical),story=renderStandardDocument('user-stories',canonical);
 for(const fr of canonical.requirements.functional){assert.ok(uc.includes(`UC-${fr.id}`));assert.ok(story.includes(`US-${fr.id}`))}
 canonical.requirements.functional.reverse();assert.match(renderStandardDocument('use-cases',canonical),/UC-FR-001/);assert.match(renderStandardDocument('user-stories',canonical),/US-FR-001/);
 assert.match(uc,/Trigger.*Chưa xác nhận/);assert.match(uc,/UML/);
 assert.match(story,/```gherkin/);assert.match(story,/Given /);assert.match(story,/When /);assert.match(story,/Then /);assert.match(story,/@draft/);assert.match(story,/CHƯA ĐÁNH GIÁ/);assert.doesNotMatch(story,/INVEST.*PASS/);
});
test('sparse analysis keeps missing stakeholder and acceptance information visible',()=>{
 const p=project();p.analysis=normalizeAnalysis(demoAnalysis('Unclear project','Customer request is not defined yet.'),'Customer request is not defined yet.');
 for(const render of [renderBRD,renderSRS,renderURD,renderUseCases,renderUserStories]){const text=render(p);assert.match(text,/Chưa xác nhận|Chưa có/);assert.doesNotMatch(text,/UC-FR-|US-FR-/)}
});
test('optional canonical metadata stays unknown instead of leaking undefined or requiring revision history',()=>{
 const canonical=buildCanonicalPackage(project());delete canonical.project.id;delete canonical.revisions;
 assert.doesNotMatch(renderStandardDocument('srs',canonical),/undefined/);
});
