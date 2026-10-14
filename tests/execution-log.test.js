import test from 'node:test';import assert from 'node:assert/strict';

test('progress context stays separated across concurrent projects and omits unapproved text fields',async()=>{
 const {withExecutionContext,logExecution}=await import('../src/execution-log.js');
 const previous=console.info,logs=[];console.info=(...args)=>logs.push(args.join(' '));
 try{await Promise.all([
  withExecutionContext({projectId:'project-a',stage:'ELICITATION',prompt:'PRIVATE_INPUT'},async()=>{await new Promise(r=>setTimeout(r,15));logExecution('INPUT_READY',{briefChars:50,sourceIds:['SRC-001','PRIVATE_SOURCE'],raw:'RAW_CUSTOMER'});}),
  withExecutionContext({projectId:'project-b',stage:'GAP_ANALYSIS'},async()=>logExecution('INPUT_READY',{questionIds:['Q-001'],answerCount:3}))
 ]);
 const a=logs.find(l=>l.includes('project-a')),b=logs.find(l=>l.includes('project-b'));
 assert.match(a,/ELICITATION/);assert.doesNotMatch(a,/project-b/);assert.match(b,/GAP_ANALYSIS/);assert.match(a,/SRC-001/);assert.match(b,/Q-001/);assert.doesNotMatch(logs.join(' '),/PRIVATE_INPUT|PRIVATE_SOURCE|RAW_CUSTOMER/);
 }finally{console.info=previous;}
});
