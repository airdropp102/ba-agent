import test from 'node:test';
import assert from 'node:assert/strict';
import {runOfflineAnalysis, composeBenchmarkPrompt, GUIDANCE, TASKS} from '../scripts/harness2/ba-runtime.mjs';
import {buildAnalysisPrompt} from '../src/ba-prompts.js';

test('Harness2: immutable BA policy, bounded catalog guidance and no arbitrary text',()=>{
 const base=composeBenchmarkPrompt([]);
 assert.equal(base,buildAnalysisPrompt());
 const candidate=composeBenchmarkPrompt(['clarify-nfr']);
 assert.ok(candidate.startsWith(base));
 assert.ok(candidate.includes(GUIDANCE['clarify-nfr']));
 for(const bad of [['disable-review'],['clarify-nfr','clarify-nfr'],['clarify-nfr', 'SRC-private'], 'clarify-nfr'])
  assert.throws(()=>composeBenchmarkPrompt(bad));
});

test('Harness2: actual canonical/evidence pipeline keeps source ID and never grants review',async()=>{
 const a=await runOfflineAnalysis({task:TASKS[0].id});
 const b=await runOfflineAnalysis({task:TASKS[0].id,guidanceIds:['clarify-scope','clarify-nfr']});
 assert.equal(a.canonical.schemaVersion,'ba.canonical.v1');
 assert.equal(a.canonical.requirements.functional[0].sourceId,TASKS[0].sourceId);
 assert.equal(b.canonical.review.customerApproved,false);
 assert.equal(b.canonical.review.baReviewed,false);
 assert.notEqual(a.instruction.instructionSha256,b.instruction.instructionSha256);
 assert.ok(b.canonical.elicitation.questions.some(q=>q.question===GUIDANCE['clarify-nfr']));
 assert.equal(b.provider,'offline-scripted');
 assert.equal(b.usage.tokens,null);
 assert.equal(b.usage.costUsd,null);
 assert.equal(b.semanticScore,null);
 assert.equal(b.externalModelCalls,0);
 assert.equal(Object.hasOwn(b,'prompt'),false);
});

test('Harness2: invalid provider outputs fail before canonical delivery; unknown task rejected',async()=>{
 await assert.rejects(runOfflineAnalysis({task:TASKS[0].id},{provider:()=>({})}),/AI schema/);
 await assert.rejects(runOfflineAnalysis({task:'customer-secret'}),/synthetic/);
 await assert.rejects(runOfflineAnalysis({task:TASKS[0].id,brief:'customer data'}),/Unknown/);
});

test('Harness2: candidate guidance reaches provider and forged quotes downgrade',async()=>{
 let instructions;
 const result=await runOfflineAnalysis({task:TASKS[0].id,guidanceIds:['clarify-nfr']},{provider:async input=>{
  instructions=input.instructions;
  const {scriptedProvider}=await import('../scripts/harness2/ba-runtime.mjs');
  const raw=scriptedProvider(input);
  raw.functionalRequirements[0].sourceEvidence='A made up statement that is absent from the brief';
  return raw;
 }});
 assert.ok(instructions.includes(GUIDANCE['clarify-nfr']));
 assert.equal(result.canonical.requirements.functional[0].certainty,'assumption');
 assert.equal(result.canonical.requirements.functional[0].sourceId,null);
});

test('Harness2: reanalysis preserves FR and open Q IDs',async()=>{
 const a=await runOfflineAnalysis({task:TASKS[0].id,guidanceIds:['clarify-nfr']});
 const b=await runOfflineAnalysis({task:TASKS[0].id,guidanceIds:['clarify-scope','clarify-nfr'],previous:a.analysis});
 assert.equal(a.analysis.functionalRequirements[0].id,b.analysis.functionalRequirements[0].id);
 const q=a.analysis.clarificationQuestions.find(q=>q.question===GUIDANCE['clarify-nfr']);
 assert.equal(b.analysis.clarificationQuestions.find(x=>x.question===q.question).id,q.id);
});
