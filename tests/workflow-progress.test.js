import test from 'node:test';
import assert from 'node:assert/strict';
import {watchWorkflowJob,workflowProgressText} from '../public/workflow-progress.js';

test('polling publishes fresh project stages and stops at a terminal job',async()=>{
 let reads=0;const updates=[],delays=[];
 const jobs=[{state:'RUNNING',attempts:1},{state:'SUCCEEDED',attempts:1}];
 const result=await watchWorkflowJob({readJob:async()=>jobs[reads],readProject:async()=>({workflow:{stage:++reads===1?'ELICITATION':'BA_REVIEW'}}),onUpdate:(p,j)=>updates.push([p.workflow.stage,j.state]),wait:async ms=>delays.push(ms)});
 assert.deepEqual(updates,[['ELICITATION','RUNNING'],['BA_REVIEW','SUCCEEDED']]);
 assert.deepEqual(delays,[2000]);assert.equal(result.state,'SUCCEEDED');
});
test('waiting display reports elapsed stage time and retries without inventing percentage',()=>{
 const text=workflowProgressText({workflow:{stage:'ELICITATION',currentAttempt:{startedAt:'2026-10-13T00:00:00Z'}}},{state:'RETRY_WAIT',attempts:2,max_attempts:3},Date.parse('2026-10-13T00:01:05Z'));
 assert.match(text,/ELICITATION/);assert.match(text,/1 phút 5 giây/);assert.match(text,/2\/3/);assert.match(text,/Chờ thử lại/);assert.doesNotMatch(text,/%/);
});
test('a failed polling request propagates instead of displaying success',async()=>{
 await assert.rejects(watchWorkflowJob({readJob:async()=>{throw new Error('offline')},readProject:async()=>({}),onUpdate:()=>{}}),/offline/);
});
import {workflowStatus} from '../public/workflow-progress.js';
test('human gate stops motion and finished job elapsed duration does not keep increasing',()=>{
 const p={workflow:{stage:'CLARIFICATION',state:'WAITING_CLARIFICATION'}};const job={state:'SUCCEEDED',created_at:'2026-10-13T00:00:00Z',updated_at:'2026-10-13T00:02:26Z'};
 const view=workflowStatus(p,job,Date.parse('2026-10-13T02:00:00Z'));assert.equal(view.active,false);assert.equal(view.jobSeconds,146);assert.equal(view.stageSeconds,null);assert.equal(view.label,'Chờ làm rõ yêu cầu');
});
