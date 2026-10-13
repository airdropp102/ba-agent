#!/usr/bin/env node
/** Offline deterministic guardrail evaluation, not an LLM-quality benchmark. */
import {demoAnalysis,sampleTitle,sampleBrief} from '../src/demo.js';
import {normalizeAnalysis,normalizePrototype} from '../src/normalize.js';
import {mergeStableIds,buildSources,applyEvidenceTrust} from '../src/revisions.js';
import {prepareBAAnalysis} from '../src/ba-quality.js';
import {buildCanonicalPackage} from '../src/ba-canonical.js';
import {validateModelOutput} from '../src/model-output.js';
import {analysisSchema} from '../src/schemas.js';

const trials=[];
const trial=(name,fn)=>{try{const {passed,detail}=fn();trials.push({name,passed:!!passed,detail});}catch(e){trials.push({name,passed:false,detail:e.message})}};
const raw=demoAnalysis(sampleTitle,sampleBrief);
const create=()=>prepareBAAnalysis(mergeStableIds(applyEvidenceTrust(normalizeAnalysis(raw,sampleBrief),buildSources(sampleBrief)),null,{}).analysis);
trial('source evidence bounded to customer brief',()=>{
 const a=create();return {passed:a.functionalRequirements.every(x=>x.certainty!=='confirmed'||x.sourceEvidence&&sampleBrief.includes(x.sourceEvidence)),detail:`${a.functionalRequirements.length} FR`};
});
trial('analyst-only evidence is untrusted',()=>{
 const source='Một ghi chú chỉ do BA đề xuất.';const a=structuredClone(create());const fr=a.functionalRequirements[0];fr.sourceEvidence=source;fr.certainty='confirmed';
 const result=applyEvidenceTrust(a,[...buildSources(sampleBrief),{id:'SRC-002',type:'ba-note',text:source}]);
 return {passed:result.functionalRequirements[0].certainty==='assumption',detail:result.functionalRequirements[0].certainty};
});
trial('stable requirement IDs across reordering',()=>{
 const a=create();const b=structuredClone(a);b.functionalRequirements.reverse();
 const merged=mergeStableIds(b,a,{FR:100,NFR:100,BR:100,Q:100});
 const expected=new Map(a.functionalRequirements.map(x=>[x.name,x.id]));
 return {passed:merged.analysis.functionalRequirements.every(x=>expected.get(x.name)===x.id),detail:`${expected.size} IDs`};
});
trial('untrusted navigation targets are removed',()=>{
 const a=create();const p=normalizePrototype({screens:[{id:'S1',title:'Overview',requirementIds:[],components:[{type:'button',label:'Next',actionTarget:'https://evil.example'}]}]},a);
 return {passed:p.screens[0].components[0].actionTarget==='',detail:'invalid navigation removed'};
});
trial('invalid provider output rejected',()=>{
 const bad={...raw,functionalRequirements:'wrong'};
 let rejected=false;try{validateModelOutput(bad,analysisSchema)}catch{rejected=true}
 return {passed:rejected,detail:'schema type mismatch blocked'};
});
trial('BA review does not imply customer sign-off',()=>{
 const a=create();const p={id:'11111111-1111-4111-8111-111111111111',title:'Evaluation',brief:sampleBrief,analysis:a,review:{approved:true,reviewedAt:new Date().toISOString()},status:'REVIEWED',version:2};
 const model=buildCanonicalPackage(p);
 return {passed:model.review.customerApproved===false&&model.review.baselineStatus==='NOT_BASELINED',detail:'customerApproved=false'};
});
const passed=trials.filter(t=>t.passed).length;
const result={suite:'offline-guardrail-v1',passed,total:trials.length,successRate:Number((100*passed/trials.length).toFixed(1)),trials};
console.log(JSON.stringify(result,null,2));
if(passed!==trials.length)process.exitCode=1;
