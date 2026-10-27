import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreLearningReviews} from '../scripts/harness2-review.mjs';
import {digest} from '../src/live-acceptance.js';

function fixture(){
 const cases=['train','test'].map((split,i)=>({id:split,title:'Synthetic case',domain:'ba',split,groupId:split,sourceId:`SRC-10${i}`,respondent:'synthetic-author',sourceReference:'fixture:review',brief:`This is a fictional ${split} case. Staff may submit a service request.`,expectedFunctional:[['submit request']],expectedNfr:[]}));
 const corpus={schemaVersion:'ba.harness2.synthetic-smoke.v1',provenance:{kind:'synthetic'},cases};
 const run={kind:'synthetic-smoke',status:'AWAITING_HUMAN_REVIEW',corpusHash:digest(corpus),rows:['A','B','C'].map(arm=>({phase:'test',task:'test',arm,status:'COMPLETED',groupId:'test',rawEvidence:{confirmed:1,grounded:1},predictions:{functional:[{id:'FR-P1'}],nonFunctional:[]}}))};
 const review=reviewerId=>({schemaVersion:'ba.harness2.review.v1',runHash:'fixture-run-hash',reviewerId,reviewedAt:'2026-10-20T01:00:00Z',judgments:run.rows.map(row=>({caseId:'test',arm:row.arm,functional:[{predictionId:'FR-P1',verdict:'supported',matchedGoldIds:['FR-G1'],supportQuote:'Staff may submit a service request.',note:''}],nonFunctional:[]}))});
 return {corpus,run,runHash:'fixture-run-hash',reviewA:review('human-a'),reviewB:review('human-b'),adjudication:review('human-c')};
}

test('research scorer requires complete independent human judgments and preserves synthetic status',()=>{
 const input=fixture();const report=scoreLearningReviews(input);
 assert.equal(report.productionAccepted,false);
 assert.equal(report.status,'SYNTHETIC_REVIEWED_NOT_ACCEPTANCE');
 assert.equal(report.metrics.A.frRecall,1);
 assert.equal(report.metrics.A.nfrRecall,null);
 assert.equal(report.metrics.C.reviewerAgreement,1);
 assert.equal(report.paired.CminusB.frRecallDelta,0);
 assert.equal(report.paired.CminusB.groupCount,1);
 assert.equal(report.paired.CminusB.frRecallCI95,null);
 input.reviewA.judgments[0].functional[0].verdict='PENDING';
 assert.throws(()=>scoreLearningReviews(input),/pending|verdict/i);
});

test('research scorer rejects changed outputs, repeated reviewers, false source quotes and failed rows',()=>{
 for(const mutate of [
  x=>{x.reviewA.runHash='changed';},
  x=>{x.reviewB.reviewerId=x.reviewA.reviewerId;},
  x=>{x.adjudication.judgments[0].functional[0].supportQuote='invented quote';},
  x=>{x.run.rows[0].status='FAILED';},
  x=>{x.reviewB.judgments.pop();},
 ]){const input=fixture();mutate(input);assert.throws(()=>scoreLearningReviews(input));}
});
