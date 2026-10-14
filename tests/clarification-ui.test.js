import test from 'node:test';
import assert from 'node:assert/strict';
import {candidateAllowed,filterQuestions,answerPayload} from '../public/clarification-ui.js';
test('strategy limits shortlist to the matching license class',()=>{
 assert.equal(candidateAllowed('erp','open-source','odoo-enterprise'),false);
 assert.equal(candidateAllowed('erp','commercial','erpnext'),false);
 assert.equal(candidateAllowed('erp','open-source','erpnext'),true);
 assert.equal(candidateAllowed('erp','commercial','odoo-enterprise'),true);
 assert.equal(candidateAllowed('general','undecided','erpnext'),false);
 assert.equal(candidateAllowed('erp','custom','erpnext'),false);
 assert.equal(candidateAllowed('erp','hybrid','odoo-enterprise'),true);
});
test('questions filter by priority and status and put high priority first',()=>{
 const qs=[{id:'Q-002',priority:'Low'},{id:'Q-001',priority:'High'},{id:'Q-003',priority:'High',status:'resolved'}];
 assert.deepEqual(filterQuestions(qs,'all','open').map(q=>q.id),['Q-001','Q-002']);
 assert.deepEqual(filterQuestions(qs,'High','resolved').map(q=>q.id),['Q-003']);
});
test('option answer keeps the exact selected ID and requires attribution while custom answer needs respondent',()=>{
 const base={questionId:'Q-001',mode:'OPT-Q-001-2',role:'customer',representative:'Client A',reference:'Meeting 2026',rationale:'Approved after review'};
 assert.equal(answerPayload(base).route,'recommendations/approve');
 assert.equal(answerPayload(base).body.optionId,'OPT-Q-001-2');
 assert.throws(()=>answerPayload({...base,representative:''}),/đại diện/);
 assert.throws(()=>answerPayload({...base,mode:'custom',answer:'Policy',respondent:''}),/Người trả lời/);
 assert.equal(answerPayload({...base,mode:'custom',answer:'Policy',respondent:'Owner'}).body.respondent,'Owner');
});
test('sourced answers pending BA review appear under answered without becoming resolved',()=>{
 const qs=[{id:'Q-001',priority:'High',status:'answered-pending-ba-review'},{id:'Q-002',priority:'High',status:'open'}];
 assert.deepEqual(filterQuestions(qs,'all','open').map(q=>q.id),['Q-002']);
 assert.deepEqual(filterQuestions(qs,'all','resolved').map(q=>q.id),['Q-001']);
 assert.equal(qs[0].status,'answered-pending-ba-review');
});

test('BA form payload needs neither reference nor rationale and keeps optional attachment IDs',()=>{
 const v={questionId:'Q-001',mode:'OPT-Q-001-1',role:'ba',attachmentIds:['11111111-1111-4111-8111-111111111111']};
 const body=answerPayload(v).body;assert.equal(body.decisionContext,'ba-ui');assert.equal(body.approverRole,'ba');assert.deepEqual(body.attachmentIds,v.attachmentIds);assert.equal(body.sourceReference,undefined);
});
