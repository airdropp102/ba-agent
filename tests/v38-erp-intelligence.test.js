import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {ERP_CATALOG,normalizeSolutionProfile,erpFitGapReport,recordERPFitGap,erpSolutionComparison} from '../src/erp-intelligence.js';
import {createRecommendations,demoRecommendations,availableSolutionReferences,techStackDigest,recordDecision} from '../src/clarification-recommendations.js';
import {sampleTitle,sampleBrief} from '../src/demo.js';

const profile=()=>normalizeSolutionProfile({domain:'erp',strategy:'open-source',candidates:['odoo-community','erpnext'],processAreas:['procure-to-pay','master-data']});
const project=()=>({id:randomUUID(),title:'ERP mock',brief:sampleBrief,solutionProfile:profile(),techStack:null,erpFitGap:[],analysis:{functionalRequirements:[{id:'FR-001',name:'Purchase approval',description:'Approval for purchase order',actor:'Procurement',certainty:'assumption',sourceEvidence:''}],clarificationQuestions:[{id:'Q-001',question:'Ai duyệt đơn mua hàng?',impact:'Thiếu quy tắc phê duyệt',priority:'High',status:'open'}]}});

test('v3.8 catalog distinguishes open source from commercial edition',()=>{
 assert.equal(ERP_CATALOG.find(x=>x.id==='odoo-community').license,'LGPL-3.0');
 assert.equal(ERP_CATALOG.find(x=>x.id==='erpnext').license,'GPL-3.0');
 assert.equal(ERP_CATALOG.find(x=>x.id==='odoo-enterprise').distribution,'commercial');
 assert.throws(()=>normalizeSolutionProfile({domain:'erp',strategy:'open-source',candidates:['odoo-enterprise']}),/open-source candidates/);
 assert.throws(()=>normalizeSolutionProfile({domain:'general',strategy:'open-source',candidates:['odoo-community']}),/domain=erp/);
 assert.throws(()=>normalizeSolutionProfile({domain:'erp',strategy:'open-source',candidates:['odoo-unknown']}),/Unknown ERP candidate/);
 assert.throws(()=>normalizeSolutionProfile({domain:'erp',strategy:'hybrid',candidates:[],processAreas:[]}),/at least one/);
});

test('v3.8 ERP shortlist is NOT existing tech stack and draft proposals need approval',()=>{
 const p=project();assert.equal(p.techStack,null);assert.deepEqual(availableSolutionReferences(p),['Odoo Community','ERPNext']);
 const raw=demoRecommendations(p);assert.equal(raw.length,1);assert.equal(raw[0].preferredIndex,-1);
 const proposals=createRecommendations(p,raw);
 assert.equal(proposals[0].preferredOptionId,null);assert.equal(proposals[0].status,'PROPOSED');
 assert.equal(p.analysis.clarificationQuestions[0].status,'open');
 assert.match(proposals[0].options[0].answer,/chưa xác nhận module/i);
 assert.match(proposals[0].options[1].title,/ERPNext/);
 const digest=techStackDigest(p);p.solutionProfile={...p.solutionProfile,candidates:['erpnext']};
 assert.notEqual(techStackDigest(p),digest);
});

test('v3.8 invalid platform references rejected without claiming adopted product',()=>{
 const p=project(),raw=demoRecommendations(p);raw[0].options[0].stackReferences=['Uninstalled MagicalERP'];
 assert.throws(()=>createRecommendations(p,raw),/unknown project technology/);
});

test('v3.8 Fit-Gap stays unassessed, human decision requires evidence and correct project platform',()=>{
 const p=project();let r=erpFitGapReport(p);assert.equal(r.reviewed,0);assert.equal(r.total,2);
 assert.equal(r.rows[0].status,'UNASSESSED');assert.equal(r.assessmentStatus,'REVIEW_REQUIRED');
 const comparison=erpSolutionComparison(p);assert.equal(comparison.length,3);assert.ok(comparison.every(x=>x.fiveYearTCO==='UNKNOWN_REQUIRES_ESTIMATE'));assert.equal(comparison[1].license,'LGPL-3.0');
 const base={requirementId:'FR-001',platformId:'odoo-community',classification:'CONFIGURE',verifiedVersion:'19.0',verifiedEdition:'Community - Purchase',sourceReference:'PoC-ERP-2026-01',rationale:'Reviewed the purchase approval workflow on test tenant.'};
 assert.throws(()=>recordERPFitGap(p,{...base,platformId:'odoo-enterprise'},'ba-reviewer'),/not an allowed/);
 assert.throws(()=>recordERPFitGap(p,{...base,sourceReference:''},'ba-reviewer'),/evidence required/);
 const entry=recordERPFitGap(p,base,'ba-reviewer');assert.equal(entry.customerApproved,false);
 r=erpFitGapReport(p);assert.equal(r.reviewed,1);assert.equal(r.rows[0].status,'CONFIGURE');
 p.analysis.functionalRequirements[0].description='New requirement version';r=erpFitGapReport(p);
 assert.equal(r.reviewed,0);assert.equal(r.rows[0].stale,true);
});

test('v3.8 Fit-Gap stale on changed shortlist and never spills between projects',()=>{
 const p=project();recordERPFitGap(p,{requirementId:'FR-001',platformId:'odoo-community',classification:'FIT_STANDARD',verifiedVersion:'19.0',verifiedEdition:'Community',sourceReference:'Demo 1 verified',rationale:'BA tested the expected workflow against the module.'},'ba-a');
 const other=project();assert.equal(erpFitGapReport(other).reviewed,0);
 p.solutionProfile=normalizeSolutionProfile({domain:'erp',strategy:'open-source',candidates:['odoo-community'],processAreas:['procure-to-pay']});
 assert.equal(erpFitGapReport(p).reviewed,0);
});

const sleep=n=>new Promise(r=>setTimeout(r,n));
test('v3.8 HTTP ERP configure → analyze → propose → Fit-Gap; per-project isolation', {timeout:40000},async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ba-v38-erp-')),port=45000+Math.floor(Math.random()*12000),base=`http://127.0.0.1:${port}`;
 const proc=spawn(process.execPath,['src/server.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),DATA_DIR:dir,DEMO_MODE:'true',HOST:'127.0.0.1',BA_WORKER_ENABLED:'false'},stdio:'ignore'});
 const api=async(route,method='GET',body)=>{const r=await fetch(base+route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};
 try{
  let ready=false;for(let i=0;i<100;i++){try{if((await api('/api/status')).status===200){ready=true;break}}catch{}await sleep(60)}
  assert.equal(ready,true);
  const catalog=await api('/api/erp/catalog');assert.equal(catalog.status,200);assert.ok(catalog.data.processes.length>=6);
  const a=(await api('/api/projects','POST',{title:sampleTitle,brief:sampleBrief,solutionProfile:profile()})).data;
  const b=(await api('/api/projects','POST',{title:'Second isolated ERP',brief:sampleBrief,solutionProfile:profile()})).data;
  assert.equal(a.techStack,null);assert.equal(a.solutionProfile.candidates.length,2);
  const analyzed=await api(`/api/projects/${a.id}/analyze`,'POST',{});assert.equal(analyzed.status,200);
  const gen=await api(`/api/projects/${a.id}/recommendations/generate`,'POST',{});assert.equal(gen.status,200);
  assert.equal(gen.data.clarificationRecommendations[0].preferredOptionId,null);
  const erp=await api(`/api/projects/${a.id}/erp`);assert.equal(erp.status,200);assert.equal(erp.data.assessment.reviewed,0);
  const fr=gen.data.analysis.functionalRequirements[0];assert.ok(fr);
  const invalid=await api(`/api/projects/${b.id}/erp/fit-gap`,'POST',{requirementId:fr.id,platformId:'odoo-community',classification:'CONFIGURE',verifiedVersion:'19.0',verifiedEdition:'Community',sourceReference:'QA Test Doc 1',rationale:'Verified manually in sandbox'});
  assert.equal(invalid.status,409); // no analysis on B
  const reviewed=await api(`/api/projects/${a.id}/erp/fit-gap`,'POST',{requirementId:fr.id,platformId:'odoo-community',classification:'CONFIGURE',verifiedVersion:'19.0',verifiedEdition:'Community',sourceReference:'QA Test Doc 1',rationale:'Verified purchase process in PoC environment'});
  assert.equal(reviewed.status,200);
  assert.equal((await api(`/api/projects/${a.id}/erp`)).data.assessment.reviewed,1);
  assert.equal((await api(`/api/projects/${b.id}/erp`)).data.assessment.reviewed,0);
  const comparisonMd=await readFile(join(dir,'projects',a.id,'02-requirements','ERP_SOLUTION_COMPARISON.md'),'utf8');
  assert.match(comparisonMd,/Odoo Community/);assert.match(comparisonMd,/ERPNext/);
  const discoveryMd=await readFile(join(dir,'projects',a.id,'02-requirements','ERP_DISCOVERY.md'),'utf8');assert.match(discoveryMd,/Procure-to-Pay/);
  const persisted=JSON.parse(await readFile(join(dir,'projects',a.id,'02-requirements','ERP_FIT_GAP.json'),'utf8'));
  assert.equal(persisted.reviewed,1);
  const selected=gen.data.clarificationRecommendations[0],questionId=selected.questionId,optionId=selected.options[0].id;
  const decision=await api(`/api/projects/${a.id}/recommendations/approve`,'POST',{questionId,optionId,approverRole:'ba',sourceReference:'Meeting test notes',rationale:'BA recommends testing Odoo integration first'});
  assert.equal(decision.status,404); // Fit-gap update invalidates proposals; regeneration required
  const changed=await api(`/api/projects/${a.id}/erp/profile`,'POST',{solutionProfile:normalizeSolutionProfile({domain:'erp',strategy:'hybrid',candidates:['erpnext'],processAreas:['master-data']})});
  assert.equal(changed.status,200);assert.equal((await api(`/api/projects/${a.id}/erp`)).data.assessment.reviewed,0);
 }finally{proc.kill('SIGTERM');await rm(dir,{recursive:true,force:true})}
});
