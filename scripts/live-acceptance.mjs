#!/usr/bin/env node
/** Explicit live acceptance protocol. No hidden network calls in preflight/score. */
import {loadDotEnv} from './load-env.mjs';
await loadDotEnv();
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {analysisPromptManifest,assertPromptManifest} from '../src/ba-prompts.js';
import {normalizeSolutionProfile} from '../src/erp-intelligence.js';
import {analyze,checkProvider} from '../src/ai-provider.js';
import {normalizeAnalysis} from '../src/normalize.js';
import {buildSources,applyEvidenceTrust} from '../src/revisions.js';
import {prepareBAAnalysis} from '../src/ba-quality.js';
import {ACCEPTANCE_SCHEMA,ACCEPTANCE_POLICY,validateCorpus,predictionsFromAnalysis,makeReviewTemplate,scoreAcceptance,quoteIn} from '../src/live-acceptance.js';

const argv=process.argv.slice(2);
const opt=k=>{const idx=argv.indexOf(k);return idx<0?null:argv[idx+1]};
const has=k=>argv.includes(k);
const usage='Use --preflight --corpus path | --run --corpus path --out /secure/run.json --confirm-external-processing | --score --corpus path --run-file path --review-a path --review-b path --adjudication path [--figma-proof path] [--visual-qa path] --out path';
async function readJson(p){if(!p)throw new Error('Missing input JSON path. '+usage);return JSON.parse(await fs.readFile(path.resolve(p),'utf8'))}
async function saveJson(file,value,{overwrite=false}={}){
 const target=path.resolve(file);await fs.mkdir(path.dirname(target),{recursive:true,mode:0o700});
 const serialized=JSON.stringify(value,null,2)+'\n';
 if(overwrite){const temp=target+'.tmp-'+randomUUID();await fs.writeFile(temp,serialized,{mode:0o600,flag:'wx'});await fs.rename(temp,target)}
 else await fs.writeFile(target,serialized,{mode:0o600,flag:'wx'});
 return target;
}
async function main(){
 const corpus=await readJson(opt('--corpus'));
 const info=validateCorpus(corpus);
 if(has('--preflight')){
  const backend=String(process.env.AI_PROVIDER||'openai').toLowerCase();
  const readiness={schemaVersion:'ba.live-preflight.v1',corpus:{caseCount:info.caseCount,goldFR:info.goldFR,goldNFR:info.goldNFR,domains:info.domains,sha256:info.corpusHash},providerConfigured:process.env.DEMO_MODE==='false'&&['openai','codex'].includes(backend),provider:backend,openaiKeyPresent:backend==='openai'?Boolean(process.env.OPENAI_API_KEY):null,figmaTokenPresent:Boolean(process.env.FIGMA_ACCESS_TOKEN),warning:'Preflight does not verify logins/permissions, reviewer attestations or make network calls.'};
  console.log(JSON.stringify(readiness,null,2));
  if(!readiness.providerConfigured||(backend==='openai'&&!readiness.openaiKeyPresent))process.exitCode=2;
  return;
 }
 if(has('--run')){
  if(!has('--confirm-external-processing'))throw new Error('Explicit --confirm-external-processing required; anonymize and obtain consent for all customer briefs before transmission.');
  if(process.env.DEMO_MODE!=='false'||!['openai','codex'].includes(checkProvider()))throw new Error('Live run requires DEMO_MODE=false AI_PROVIDER=openai|codex');
  if(checkProvider()==='openai'&&!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is unavailable');
  const output=opt('--out');if(!output)throw new Error('Specify --out /secure/path/run.json');
  const model=checkProvider()==='openai'?(process.env.OPENAI_MODEL||'gpt-4.1-mini'):(process.env.CODEX_MODEL||'codex-cli');
  let run;
  const resume=has('--resume');
  if(resume){run=await readJson(output);if(run.corpusHash!==info.corpusHash||run.provider!==checkProvider()||run.model!==model)throw new Error('Cannot resume a run with changed corpus/provider/model');assertPromptManifest(run.promptManifest);}
  else{
   run={schemaVersion:ACCEPTANCE_SCHEMA,runId:randomUUID(),startedAt:new Date().toISOString(),corpusHash:info.corpusHash,provider:checkProvider(),model,promptManifest:analysisPromptManifest(),cases:[],providerProcess:'Existing BA Studio elicitation path; raw messages and API keys not saved in run file',warning:'Potential customer data in generated predictions; store files with restricted permissions.'};
   await saveJson(output,run);
  }
  for(const c of corpus.cases){
   // Resume keeps all recorded attempts, including errors, to avoid accidental duplicate billable invocations.
   if(run.cases.some(x=>x.id===c.id))continue;
   const began=Date.now();let outcome;
   try{
    const raw=await analyze(c.title,c.brief,c.solutionProfile?normalizeSolutionProfile(c.solutionProfile):null);
    const rawConfirmed=[...(raw.functionalRequirements||[]),...(raw.nonFunctionalRequirements||[]),...(raw.businessRules||[])].filter(x=>x.certainty==='confirmed');
    const rawEvidence={confirmed:rawConfirmed.length,grounded:rawConfirmed.filter(x=>quoteIn(c.brief,x.sourceEvidence)).length};
    const norm=prepareBAAnalysis(applyEvidenceTrust(normalizeAnalysis(raw,c.brief),buildSources(c.brief)));
    outcome={id:c.id,status:'COMPLETED',durationMs:Date.now()-began,predictions:predictionsFromAnalysis(norm),rawEvidence,highGapCount:norm.quality?.counts?.high||0};
   }catch(error){outcome={id:c.id,status:'FAILED',durationMs:Date.now()-began,errorType:error?.name||'Error'};}
   run.cases.push(outcome);await saveJson(output,run,{overwrite:true});
   console.error(`[${run.cases.length}/${corpus.cases.length}] ${c.id}: ${outcome.status}`);
   if(outcome.status==='FAILED'&&!has('--continue-on-error'))break;
  }
  run.completedAt=new Date().toISOString();await saveJson(output,run,{overwrite:true});
  const completed=run.cases.filter(x=>x.status==='COMPLETED').length;
  if(completed!==corpus.cases.length){process.exitCode=1;console.log(JSON.stringify({runId:run.runId,status:'INCOMPLETE',completed,total:corpus.cases.length,out:path.resolve(output)},null,2));return;}
  const reviewDir=path.dirname(path.resolve(output));
  const packet={schemaVersion:'ba.review-packet.v1',runId:run.runId,corpusHash:run.corpusHash,warning:'Sensitive: includes original briefs and generated requirements; never commit to git.',cases:corpus.cases.map(c=>({id:c.id,title:c.title,domain:c.domain,brief:c.brief,goldFunctional:c.expectedFunctional.map((aliases,i)=>({id:`FR-G${i+1}`,aliases})),goldNonFunctional:c.expectedNfr.map((aliases,i)=>({id:`NFR-G${i+1}`,aliases})),predictions:run.cases.find(r=>r.id===c.id).predictions}))};
  await saveJson(path.join(reviewDir,`review-packet-${run.runId}.json`),packet);
  for(const reviewerId of ['reviewer-a','reviewer-b','adjudicator']){
   const template=makeReviewTemplate(run,reviewerId);
   await saveJson(path.join(reviewDir,`${reviewerId}-${run.runId}.json`),template);
  }
  console.log(JSON.stringify({runId:run.runId,status:'AWAITING_HUMAN_REVIEW',completed,output:path.resolve(output),reviewDir,warning:'Fill two independent reviews and adjudication; no release decision can be PASS until score and Figma cross-check.'},null,2));
  return;
 }
 if(has('--score')){
  const run=await readJson(opt('--run-file'));
  const reviewA=await readJson(opt('--review-a')),reviewB=await readJson(opt('--review-b')),adjudication=await readJson(opt('--adjudication'));
  const figma=opt('--figma-proof')?await readJson(opt('--figma-proof')):null;
  const visualQa=opt('--visual-qa')?await readJson(opt('--visual-qa')):null;
  const report=scoreAcceptance({run,corpus,reviewA,reviewB,adjudication,figma,visualQa,policy:ACCEPTANCE_POLICY});
  if(opt('--out'))await saveJson(opt('--out'),report);
  console.log(JSON.stringify(report,null,2));
  if(report.status!=='PASS')process.exitCode=1;
  return;
 }
 throw new Error(usage);
}
try{await main()}catch(e){console.error('Live Acceptance error:',e.message);process.exitCode=2}
