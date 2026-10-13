import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {normalizeTechStack,createRecommendations,demoRecommendations,recordDecision,validDecision,techStackDigest} from '../src/clarification-recommendations.js';
import {unresolvedHigh} from '../src/intelligent-workflow.js';
import {sampleTitle,sampleBrief} from '../src/demo.js';

const stack={frontend:['React'],backend:['Node.js'],database:['PostgreSQL']};
const sample=()=>{
 const question={id:'Q-001',question:'Cần phân quyền người dùng như thế nào?',impact:'Không biết ai có quyền truy cập',origin:'GAP-001',priority:'High',status:'open'};
 return {id:randomUUID(),brief:'customer brief',analysis:{clarificationQuestions:[question],quality:{findings:[{id:'GAP-001',priority:'High',question:question.question}]}},techStack:normalizeTechStack(stack),clarificationDecisions:[]};
};
const approve=(p,role='ba')=>{
 const option=p.clarificationRecommendations[0].options[0];
 return recordDecision(p,{questionId:'Q-001',optionId:option.id,approverRole:role,sourceReference:'Meeting BA 2026-10-13',rationale:'Team agreed to use existing stack.',customerRepresentative:role==='customer'?'Customer A':undefined},'ba-reviewer');
};

test('v3.7: a project must provide real stack; unknown and malformed fields reject',()=>{
 assert.throws(()=>normalizeTechStack({}),/at least one/);
 assert.throws(()=>normalizeTechStack({backend:['N'],unknown:['x']}),/Unknown tech stack/);
 assert.throws(()=>normalizeTechStack({backend:['x'.repeat(200)]}),/Invalid/);
 assert.deepEqual(normalizeTechStack({backend:['Node.js','Node.js'],frontend:[]}).backend,['Node.js']);
});

test('v3.7: proposals stay DRAFT and never auto-resolve a blocking question',()=>{
 const p=sample(),raw=demoRecommendations(p);const proposals=createRecommendations(p,raw,{provider:'demo'});
 assert.equal(proposals.length,1);assert.equal(proposals[0].options.length,2);
 assert.equal(proposals[0].status,'PROPOSED');assert.ok(proposals[0].preferredOptionId);
 assert.equal(p.analysis.clarificationQuestions[0].status,'open');assert.equal(unresolvedHigh(p).length,2);
 assert.equal(p.clarificationDecisions.length,0);
});

test('v3.7: explicit BA approval records answer but not customer sign-off',()=>{
 const p=sample();createRecommendations(p,demoRecommendations(p));
 const d=approve(p);assert.equal(d.customerApproved,false);assert.equal(d.customerBaselineApproved,false);
 assert.equal(p.requirementsRefreshPending,true);assert.equal(p.answers[0].approvalType,'BA_APPROVED_TECHNICAL_DECISION');assert.equal(p.analysis.clarificationQuestions[0].status,'resolved');
 assert.equal(validDecision(p,p.analysis.clarificationQuestions[0]).id,d.id);
 assert.equal(unresolvedHigh(p).length,0);assert.equal(p.review,null);
 assert.throws(()=>approve(p),/already resolved/);
});

test('v3.7: customer approval requires representative but is still not customer baseline',()=>{
 const p=sample();createRecommendations(p,demoRecommendations(p));
 assert.throws(()=>recordDecision(p,{questionId:'Q-001',optionId:'OPT-Q-001-1',approverRole:'customer',sourceReference:'Meeting reference',rationale:'Customer selected this option'},'operator'),/representative/);
 const d=approve(p,'customer');assert.equal(d.customerApproved,true);assert.equal(d.customerBaselineApproved,false);assert.equal(d.customerRepresentative,'Customer A');
});

test('v3.7: approval cannot dismiss an unverified requirement as customer evidence',()=>{
 const p=sample();p.analysis.quality.findings[0].code='UNVERIFIED_REQUIREMENT';
 createRecommendations(p,demoRecommendations(p));approve(p);
 assert.equal(unresolvedHigh(p).length,1);
});

test('v3.7: chosen option must be in current project and stale edits are rejected',()=>{
 const p=sample();createRecommendations(p,demoRecommendations(p));
 assert.throws(()=>recordDecision(p,{questionId:'Q-001',optionId:'OPT-Q-002-1',approverRole:'ba',sourceReference:'Decision-12345',rationale:'We reviewed options'},'ba-actor'),/exact option/);
 p.analysis.clarificationQuestions[0].impact='Different impact';
 assert.throws(()=>approve(p),/stale/);
 p.analysis.clarificationQuestions[0].impact='Không biết ai có quyền truy cập';
 p.techStack=normalizeTechStack({backend:['Go']});
 assert.throws(()=>approve(p),/stale/);
});

test('v3.7: model cannot claim nonexistent stack technology',()=>{
 const p=sample();const raw=demoRecommendations(p);raw[0].options[0].stackReferences=['MongoDB'];
 assert.throws(()=>createRecommendations(p,raw),/unknown project technology/);
});

test('v3.7: decisions are cryptographically scoped to current stack and question',()=>{
 const p=sample();createRecommendations(p,demoRecommendations(p));approve(p);
 assert.equal(validDecision(p,p.analysis.clarificationQuestions[0])?.status,'APPROVED');
 p.techStack=normalizeTechStack({backend:['Django']});
 assert.equal(validDecision(p,p.analysis.clarificationQuestions[0]),null);
});

const sleep=n=>new Promise(resolve=>setTimeout(resolve,n));
test('v3.7 HTTP: cross-project segregation, audit and workspace projection', {timeout:30000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ba-v37-http-')),port=39000+Math.floor(Math.random()*15000),base=`http://127.0.0.1:${port}`;
 const proc=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:dir,DEMO_MODE:'true',HOST:'127.0.0.1',BA_WORKER_ENABLED:'false'},stdio:'ignore'});
 const api=async(route,method='GET',body,version)=>{const r=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(version?{'If-Match':String(version)}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};
 try{
  let ready=false;for(let i=0;i<120;i++){try{if((await api('/api/status')).status===200){ready=true;break}}catch{}await sleep(50)}
  assert.equal(ready,true);
  const a=(await api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief})).data;
  const b=(await api('/api/projects','POST',{title:'Independent Project B',brief:'Customer wants another feature unrelated to this application.'})).data;
  const r=(id,route)=>`/api/projects/${id}/${route}`;
  const noStack=await api(r(a.id,'recommendations/generate'),'POST',{});assert.equal(noStack.status,409);
  const businessProject=(await api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief})).data;
  const businessAnalysis=await api(r(businessProject.id,'analyze'),'POST',{});
  const question1=businessAnalysis.data.analysis.clarificationQuestions[0].id;
  const question2=businessAnalysis.data.analysis.clarificationQuestions[1].id;
  const businessDraft=await api(r(businessProject.id,'recommendations/generate'),'POST',{mode:'business',questionId:question1});
  assert.equal(businessDraft.status,200);assert.equal(businessDraft.data.clarificationRecommendations.length,1);
  assert.equal(businessDraft.data.clarificationRecommendations[0].preferredOptionId,null);
  assert.deepEqual(businessDraft.data.clarificationRecommendations[0].options[0].stackReferences,[]);
  const secondDraft=await api(r(businessProject.id,'recommendations/generate'),'POST',{mode:'business',questionId:question2});
  assert.equal(secondDraft.status,200);assert.equal(secondDraft.data.clarificationRecommendations.length,2);
  assert.equal((await api(r(businessProject.id,'recommendations/generate'),'POST',{mode:'business',questionId:'Q-INVALID'})).status,404);
  assert.equal((await fetch(base+'/clarification-ui.js')).status,200);
  const allDraft=await api(r(businessProject.id,'recommendations/generate'),'POST',{mode:'business',questionIds:[question1,question2]});
  assert.equal(allDraft.status,200);assert.equal(allDraft.data.clarificationRecommendations.length,2);
  const beforeBatch=(await api(`/api/projects/${businessProject.id}`)).data;
  const invalidBatch=await api(r(businessProject.id,'answers/batch'),'POST',{answers:[{kind:'custom',questionId:question1,answer:'Workshop answer',respondent:'Owner',sourceReference:'Workshop-2026'},{kind:'custom',questionId:'Q-BAD',answer:'Invalid',respondent:'Owner',sourceReference:'Workshop-2026'}]});
  assert.equal(invalidBatch.status,400);assert.equal((await api(`/api/projects/${businessProject.id}`)).data.version,beforeBatch.version);
  const savedBatch=await api(r(businessProject.id,'answers/batch'),'POST',{answers:[{kind:'option',questionId:question1,optionId:allDraft.data.clarificationRecommendations.find(x=>x.questionId===question1).options[0].id,approverRole:'ba',sourceReference:'ADR-2026',rationale:'Reviewed during workshop'},{kind:'custom',questionId:question2,answer:'Workshop answer',respondent:'Owner',sourceReference:'Workshop-2026'}]});
  assert.equal(savedBatch.status,200);assert.equal(savedBatch.data.requirementsRefreshPending,true);assert.equal(savedBatch.data.answers.length,2);
  assert.equal((await api(r(businessProject.id,'review'),'POST',{approved:true,notes:'Not yet allowed'})).status,409);
  const refresh=await api(r(businessProject.id,'analyze'),'POST',{});assert.equal(refresh.status,200);assert.equal(refresh.data.requirementsRefreshPending,false);
  const s=await api(r(a.id,'tech-stack'),'POST',{techStack:stack},a.version);assert.equal(s.status,200);
  const analyzed=await api(r(a.id,'analyze'),'POST',{});assert.equal(analyzed.status,200);
  const advanced=await api(r(a.id,'workflow/advance'),'POST',{auto:true});
  assert.equal(advanced.status,200);assert.equal(advanced.data.workflow.stage,'CLARIFICATION');assert.equal(advanced.data.workflow.state,'WAITING_CLARIFICATION');assert.ok(advanced.data.clarificationRecommendations.length>0);
  const gen=await api(r(a.id,'recommendations/generate'),'POST',{},advanced.data.version);assert.equal(gen.status,200);
  assert.ok(gen.data.clarificationRecommendations.length>0);
  assert.equal((await api(r(b.id,'recommendations'))).data.proposals.length,0);
  const {questionId,options}=gen.data.clarificationRecommendations[0];
  assert.equal((await api(r(b.id,'analyze'),'POST',{})).status,200);
  const wrong=await api(r(b.id,'recommendations/approve'),'POST',{questionId,optionId:options[0].id,approverRole:'ba',sourceReference:'Meeting-Ref 100',rationale:'We agree to use the stack'});assert.equal(wrong.status,404);
  const selected=await api(r(a.id,'recommendations/approve'),'POST',{questionId,optionId:options[0].id,approverRole:'ba',sourceReference:'Meeting 2026-10-13',rationale:'BA technical choice agreed'},gen.data.version);assert.equal(selected.status,200);
  assert.equal(selected.data.clarificationDecisions.length,1);assert.equal(selected.data.review,null);assert.equal(selected.data.requirementsRefreshPending,true);
  assert.equal((await api(r(a.id,'review'),'POST',{approved:true,notes:'review'})).status,409);
  const reconciled=await api(r(a.id,'analyze'),'POST',{});assert.equal(reconciled.status,200);assert.equal(reconciled.data.requirementsRefreshPending,false);
  const refreshed=await api(r(a.id,'recommendations/generate'),'POST',{});assert.equal(refreshed.status,200);
  assert.equal((await api(r(a.id,'audit'))).data.integrity.valid,true);
  const stored=JSON.parse(await readFile(join(dir,'projects',a.id,'02-requirements','clarification-recommendations.json'),'utf8'));
  assert.equal(stored.decisions[0].optionId,options[0].id);
  assert.equal((await api(r(b.id,'recommendations'))).data.decisions.length,0);
  const changed=await api(r(a.id,'tech-stack'),'POST',{techStack:{backend:['Go']}},refreshed.data.version);assert.equal(changed.status,200);
  assert.equal(changed.data.clarificationDecisions[0].status,'STALE_STACK_CHANGED');
  assert.equal(changed.data.analysis.clarificationQuestions.find(q=>q.id===questionId).status,'open');
 }finally{proc.kill('SIGTERM');await rm(dir,{recursive:true,force:true})}
});

test('business drafts without stack accept no technical references and retain human review guards',()=>{
 const p=sample();delete p.techStack;
 const raw=[{questionId:'Q-001',preferredIndex:0,options:[{title:'Phân quyền theo vai trò',answer:'DRAFT: đề xuất phân quyền theo vai trò để chủ nghiệp vụ xác minh.',benefits:'Dễ rà soát',tradeoffs:'Cần xác nhận vai trò',implementation:'Workshop xác minh với khách hàng',stackReferences:[],feasibility:'unknown'}]}];
 const rows=createRecommendations(p,raw,{mode:'business'});
 assert.equal(rows[0].preferredOptionId,null);
 assert.equal(rows[0].mode,'business');
 assert.equal(p.analysis.clarificationQuestions[0].status,'open');
 assert.deepEqual(rows[0].options[0].stackReferences,[]);
 approve(p);assert.equal(p.requirementsRefreshPending,true);assert.equal(p.clarificationDecisions[0].customerBaselineApproved,false);
});
test('business drafts cannot fabricate installed technology while legacy mode still needs references',()=>{
 const p=sample();delete p.techStack;
 const option={title:'Draft',answer:'Draft answer',benefits:'Review',tradeoffs:'Unknown',implementation:'Verify',stackReferences:['InventedStack'],feasibility:'compatible'};
 assert.throws(()=>createRecommendations(p,[{questionId:'Q-001',options:[option]}],{mode:'business'}),/technology|references/i);
 assert.throws(()=>createRecommendations(p,[],{}),/Configure/);
});
