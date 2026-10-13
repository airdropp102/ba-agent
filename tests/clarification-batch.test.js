import test from 'node:test';import assert from 'node:assert/strict';
import {applyClarificationBatch} from '../src/clarification-batch.js';
import {createRecommendations} from '../src/clarification-recommendations.js';
const sample=()=>({id:'fixture',brief:'Original brief',sources:[{id:'SRC-001',type:'customer-brief',text:'Original brief'}],analysis:{clarificationQuestions:[{id:'Q-001',question:'Policy?',status:'open'},{id:'Q-002',question:'Timing?',status:'open'}]},answers:[],review:{approved:true}});
const option={title:'Draft option',answer:'Proposed policy',benefits:'Review',tradeoffs:'Unknown',implementation:'Verify',stackReferences:[],feasibility:'unknown'};
const custom={kind:'custom',questionId:'Q-002',answer:'Customer supplied answer',respondent:'Customer owner',sourceReference:'Workshop-2026'};
test('mixed batch retains exact choices and sources and requires one re-analysis before review',()=>{
 const p=sample();createRecommendations(p,[{questionId:'Q-001',options:[option]}],{mode:'business'});
 applyClarificationBatch(p,[{kind:'option',questionId:'Q-001',optionId:'OPT-Q-001-1',approverRole:'ba',sourceReference:'ADR-2026',rationale:'Reviewed policy proposal'},custom],'reviewer');
 assert.equal(p.answers.length,2);assert.equal(p.sources.length,2);assert.equal(p.sources[1].respondent,'Customer owner');assert.equal(p.clarificationDecisions[0].optionId,'OPT-Q-001-1');assert.equal(p.clarificationDecisions[0].customerBaselineApproved,false);assert.equal(p.requirementsRefreshPending,true);assert.equal(p.review,null);
});
test('invalid batch item or duplicate question leaves original project unchanged',()=>{
 const p=sample(),original=JSON.stringify(p);
 assert.throws(()=>applyClarificationBatch(p,[custom,{...custom,questionId:'Q-NOT-FOUND'}],'reviewer'),/question/i);assert.equal(JSON.stringify(p),original);
 assert.throws(()=>applyClarificationBatch(p,[custom,custom],'reviewer'),/duplicate/i);assert.equal(JSON.stringify(p),original);
});

import {completeDrafts,generateQuestionGroups,questionKey} from '../public/clarification-batch-ui.js';
test('complete draft collection keeps incomplete drafts and rejects changed question context',()=>{
 const p=sample(),drafts={'Q-001':{questionKey:questionKey(p.analysis.clarificationQuestions[0]),mode:'custom',answer:'Answer',respondent:'Owner',reference:'Workshop'},'Q-002':{mode:'custom',answer:'Incomplete'}};
 assert.equal(completeDrafts(p,drafts).length,1);assert.equal(drafts['Q-002'].answer,'Incomplete');
 p.analysis.clarificationQuestions[0].question='Changed?';assert.equal(completeDrafts(p,drafts).length,0);
});
test('all-question generation groups inputs and reports failed IDs for retry',async()=>{
 const groups=[],progress=[];const result=await generateQuestionGroups(['Q1','Q2','Q3','Q4'],{size:2,generate:async ids=>{groups.push(ids);if(ids.includes('Q3'))throw Error('provider failed');},onProgress:r=>progress.push(r.active.length)});
 assert.deepEqual(groups,[['Q1','Q2'],['Q3','Q4']]);assert.deepEqual(result.done,['Q1','Q2']);assert.deepEqual(result.failed,['Q3','Q4']);assert.deepEqual(progress,[2,0,2,0]);
});
