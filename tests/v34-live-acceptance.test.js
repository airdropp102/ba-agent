import test from 'node:test';
import assert from 'node:assert/strict';
import {ACCEPTANCE_SCHEMA,validateCorpus,predictionsFromAnalysis,makeReviewTemplate,scoreAcceptance,crosscheckFigmaRest,digest} from '../src/live-acceptance.js';

// Entirely synthetic FIXTURES for harness tests, NEVER an accredited production corpus.
function fixture(){
 const cases=Array.from({length:20},(_,i)=>({id:`SIM_${i+1}`,title:`Tình huống ${i+1}`,domain:i%2?'sales':'support',brief:`Khách hàng muốn nhân viên tạo phiếu ${i+1} và hiệu năng không quá 2 giây.`,expectedFunctional:[['tạo phiếu']],expectedNfr:[['không quá 2 giây']],annotation:{status:'approved',reviewerIds:['ba-a','ba-b'],adjudicatedBy:'ba-c',adjudicatedAt:'2026-10-01',reference:'fixture-only'}}));
 const corpus={schemaVersion:'ba.gold.reviewed.v1',provenance:{kind:'real-anonymized',dataUseApproved:true,approvalReference:'synthetic-fixture-not-production'},figmaTarget:{fileKey:'abcdefghijkl',nodeId:'1:2',nodeName:'Dashboard',designSpecReference:'SPEC-TEST-01'},cases};
 const run={schemaVersion:ACCEPTANCE_SCHEMA,runId:'fixture-run',corpusHash:digest(corpus),provider:'mock-test-only',model:'mock-test-only',cases:cases.map(c=>({id:c.id,status:'COMPLETED',rawEvidence:{confirmed:2,grounded:2},predictions:predictionsFromAnalysis({functionalRequirements:[{name:'tạo phiếu',description:'Nhân viên tạo phiếu',certainty:'confirmed',sourceEvidence:`nhân viên tạo phiếu ${c.id.replace('SIM_','')}`}],nonFunctionalRequirements:[{category:'Hiệu năng',description:'không quá 2 giây',certainty:'confirmed',sourceEvidence:'không quá 2 giây'}]})}))};
 function review(id){const o=makeReviewTemplate(run,id);o.reviewedAt='2026-10-13T09:00:00.000Z';o.cases.forEach((r,i)=>{r.functional[0]={predictionId:'FR-P1',verdict:'supported',matchedGoldIds:['FR-G1'],supportQuote:`nhân viên tạo phiếu ${i+1}`,note:''};r.nonFunctional[0]={predictionId:'NFR-P1',verdict:'supported',matchedGoldIds:['NFR-G1'],supportQuote:'không quá 2 giây',note:''};});return o}
 const figma={source:'figma-rest-crosschecked-with-mcp-operator',passed:true,mcpContract:true,fileKey:'abcdefghijkl',nodeId:'1:2',nodeName:'Dashboard',checkedAt:new Date().toISOString()};
 const visualQa={approved:true,source:'ba-human-visual-qa',reviewerId:'ba-c',evidenceReference:'QA-TEST-001',designSpecReference:'SPEC-TEST-01',fileKey:'abcdefghijkl',nodeId:'1:2',approvedAt:new Date().toISOString()};
 return {corpus,run,a:review('ba-a'),b:review('ba-b'),final:review('ba-c'),figma,visualQa};
}
const scored=f=>scoreAcceptance({run:f.run,corpus:f.corpus,reviewA:f.a,reviewB:f.b,adjudication:f.final,figma:f.figma,visualQa:f.visualQa});

test('Requires approved corpus of >=20 real/anonymized annotated cases',()=>{
 const f=fixture();const m=validateCorpus(f.corpus);assert.equal(m.caseCount,20);assert.equal(m.goldFR,20);
 assert.throws(()=>validateCorpus({...f.corpus,cases:f.corpus.cases.slice(1)}),/20\.\.50/);
 assert.throws(()=>validateCorpus({...f.corpus,provenance:{kind:'synthetic',dataUseApproved:true,approvalReference:'test'}}),/real-anonymized/);
 assert.throws(()=>validateCorpus({...f.corpus,provenance:{kind:'real-anonymized',dataUseApproved:false,approvalReference:'test'}}),/data use approval/);
});
test('Adjudicated supported predictions and independent Figma crosscheck can satisfy quality gate only in fixtures',()=>{
 const result=scored(fixture());assert.equal(result.status,'PASS');assert.deepEqual(result.failures,[]);assert.equal(result.metrics.frRecall,1);assert.equal(result.metrics.nfrRecall,1);
});
test('Reject unsupported/hallucinated semantic predictions and poor recall',()=>{
 const f=fixture();for(const c of f.final.cases.slice(0,3))c.functional[0]={predictionId:'FR-P1',verdict:'unsupported',matchedGoldIds:[],note:'Không được brief hỗ trợ',supportQuote:''};
 assert.equal(scored(f).status,'FAIL');assert.ok(scored(f).failures.some(x=>x.startsWith('frRecall')));assert.ok(scored(f).failures.some(x=>x.startsWith('unsupportedRate')));
});
test('Reject missing evidence or fabricated quote in human review',()=>{
 const f=fixture();f.final.cases[0].functional[0].supportQuote='Không có trong tài liệu';assert.throws(()=>scored(f),/verbatim/);
});
test('Unresolved BA semantic judgments fail closed',()=>{
 const f=fixture();f.final.cases[0].functional[0]={predictionId:'FR-P1',verdict:'needs-clarification',matchedGoldIds:[],supportQuote:'',note:'Ambiguous'};
 assert.equal(scored(f).status,'FAIL');assert.ok(scored(f).failures.some(x=>x.includes('unresolved judgments')));
});
test('Reject reviews from same reviewer, swapped prediction IDs and tampered run prediction',()=>{
 let f=fixture();f.b.reviewerId='ba-a';assert.throws(()=>scored(f),/distinct identities/);
 f=fixture();f.b.cases[0].functional[0].predictionId='NFR-P1';assert.throws(()=>scored(f),/Unexpected/);
 f=fixture();f.run.cases[0].predictions.functional[0].description='changed-after-review';assert.throws(()=>scored(f),/exact generated predictions/);
});
test('Disagreement between two BA reviewers blocks release if below threshold',()=>{
 const f=fixture();f.b.cases.slice(0,8).forEach(r=>r.functional[0]={predictionId:'FR-P1',verdict:'unsupported',matchedGoldIds:[],supportQuote:'',note:'Reviewer disagrees'});
 assert.equal(scored(f).metrics.reviewerAgreement,0.8);f.b.cases[8].functional[0]={predictionId:'FR-P1',verdict:'unsupported',matchedGoldIds:[],supportQuote:'',note:'Reviewer disagrees'};
 assert.equal(scored(f).status,'FAIL');
});
test('Figma proof missing, wrong source, or stale cannot receive PASS',()=>{
 const f=fixture();f.figma=null;assert.equal(scored(f).status,'FAIL');
 f.figma={source:'figma-rest-crosschecked-with-mcp-operator',passed:true,mcpContract:true,fileKey:'abcdefghijkl',nodeId:'1:2',nodeName:'Dashboard',checkedAt:'2025-01-01T00:00:00Z'};
 assert.ok(scored(f).failures.some(x=>x.includes('24 hours')));
});
test('Figma REST cross-check matches actual read-only FRAME metadata',async()=>{
 const report={contract:'ba.figma-mcp-readback.v3.4',passed:true,source:'operator-reported-live-probe-not-cryptographic-attestation',documentKey:'samplekey',nodeId:'1:2',nodeName:'Dashboard'};
 const requests=[];
 const fetchImpl=async(url,opt)=>{requests.push({url,opt});return {ok:true,json:async()=>({nodes:{'1:2':{document:{id:'1:2',name:'Dashboard',type:'FRAME'}}}})}};
 const proof=await crosscheckFigmaRest(report,{fileKey:'samplekey',nodeId:'1:2',nodeName:'Dashboard',token:'fixture-token',fetchImpl});
 assert.equal(proof.passed,true);assert.equal(proof.source,'figma-rest-crosschecked-with-mcp-operator');assert.equal(requests[0].opt.method,'GET');assert.equal(requests[0].opt.headers['X-Figma-Token'],'fixture-token');
});
test('Figma REST mismatched node, missing token, operator and HTTP failures are rejected',async()=>{
 const report={contract:'ba.figma-mcp-readback.v3.4',passed:true,source:'operator-reported-live-probe-not-cryptographic-attestation',documentKey:'samplekey',nodeId:'1:2',nodeName:'Dashboard'};
 const options={fileKey:'samplekey',nodeId:'1:2',token:'dummy',fetchImpl:async()=>({ok:true,json:async()=>({nodes:{'1:2':{document:{id:'1:2',name:'Something else',type:'RECTANGLE'}}}})})};
 await assert.rejects(crosscheckFigmaRest(report,options),/FRAME/);
 await assert.rejects(crosscheckFigmaRest({...report,documentKey:'evil'},options),/scoped mismatch/);
 await assert.rejects(crosscheckFigmaRest(report,{...options,token:''}),/TOKEN/);
 await assert.rejects(crosscheckFigmaRest(report,{...options,fetchImpl:async()=>({ok:false,status:403})}),/403/);
});

test('Unapproved or unrelated BA visual QA cannot satisfy release acceptance',()=>{
 const f=fixture();f.visualQa.approved=false;assert.ok(scored(f).failures.some(x=>x.includes('visual QA')));
 f.visualQa.approved=true;f.visualQa.designSpecReference='OTHER';assert.equal(scored(f).status,'FAIL');
});
test('Figma proof must match exact intended design node, not any FRAME',()=>{
 const f=fixture();f.figma.fileKey='otherfile';assert.ok(scored(f).failures.some(x=>x.includes('design target')));
});

test('Raw model evidence is assessed before normalization can silently downgrade invalid claims',()=>{
 const f=fixture();f.run.cases[0].rawEvidence={confirmed:2,grounded:0};
 for(const r of [f.a,f.b,f.final])r.runPredictionsHash=digest(f.run.cases);
 assert.ok(scored(f).failures.some(x=>x.startsWith('confirmedGrounding')));
});

test('reviewed corpus supports explicit ERP profiles and rejects malformed profiles',()=>{
 const f=fixture();f.corpus.cases[0].solutionProfile={domain:'erp'};
 assert.equal(validateCorpus(f.corpus).caseCount,20);
 for(const profile of [null,[],{domain:'unknown'},{domain:'general',candidates:[{id:'guessed'}]}]){
  f.corpus.cases[0].solutionProfile=profile;
  assert.throws(()=>validateCorpus(f.corpus));
 }
});

test('live CLI resume refuses changed prompt/model before provider calls or run writes',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os'),{join}=await import('node:path'),{spawnSync}=await import('node:child_process');
 const {analysisPromptManifest}=await import('../src/ba-prompts.js');
 const dir=mkdtempSync(join(tmpdir(),'ba-resume-fixture-'));
 try{
  // Existing synthetic harness fixture only; never used as a production corpus.
  const f=fixture(),corpusPath=join(dir,'corpus.json'),runPath=join(dir,'run.json');
  writeFileSync(corpusPath,JSON.stringify(f.corpus));
  for(const variant of ['missing-prompt','changed-prompt','changed-model']){
   const run={...f.run,provider:'codex',model:'mock-configured',promptManifest:analysisPromptManifest()};
   if(variant==='missing-prompt')delete run.promptManifest;
   if(variant==='changed-prompt')run.promptManifest.general.instructionSha256='changed';
   if(variant==='changed-model')run.model='another-model';
   const original=JSON.stringify(run);writeFileSync(runPath,original);
   const result=spawnSync(process.execPath,['scripts/live-acceptance.mjs','--run','--resume','--corpus',corpusPath,'--out',runPath,'--confirm-external-processing'],{encoding:'utf8',timeout:6000,env:{...process.env,DEMO_MODE:'false',AI_PROVIDER:'codex',CODEX_MODEL:'mock-configured',CODEX_BIN:'/nonexistent-mock-provider'}});
   assert.equal(result.status,2,result.stderr);
   assert.match(result.stderr,variant==='changed-model'?/changed corpus\/provider\/model/:/missing or changed prompt/);
   assert.equal(readFileSync(runPath,'utf8'),original);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});
