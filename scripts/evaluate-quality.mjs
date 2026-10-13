#!/usr/bin/env node
/** Adjudicable concept benchmark; auto matching is a proxy, not semantic truth. */
import {loadDotEnv} from './load-env.mjs';
await loadDotEnv();
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {analyze,checkProvider} from '../src/ai-provider.js';
import {normalizeAnalysis} from '../src/normalize.js';
import {buildSources,applyEvidenceTrust,resolveEvidenceSource} from '../src/revisions.js';
import {prepareBAAnalysis} from '../src/ba-quality.js';
const args=process.argv.slice(2);const arg=k=>args.includes(k)?args[args.indexOf(k)+1]:null;
if(!args.includes('--live'))process.env.DEMO_MODE='true';
else if(process.env.DEMO_MODE!=='false')throw new Error('--live requires DEMO_MODE=false and real configured AI_PROVIDER');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.resolve(arg('--corpus')||path.join(root,'eval/ba-gold-v1.json'));
const corpus=JSON.parse(await fs.readFile(file,'utf8'));
if(!Array.isArray(corpus.cases)||!corpus.cases.length||corpus.cases.length>1000)throw new Error('Gold corpus needs 1..1000 labeled cases');
const ids=new Set();
for(const c of corpus.cases){
 if(!/^[\w-]{1,80}$/.test(c.id)||ids.has(c.id)||typeof c.title!=='string'||typeof c.brief!=='string'||c.brief.length<10)throw new Error('Invalid gold case identity/input');
 ids.add(c.id);
 for(const arr of [c.expectedFunctional,c.expectedNfr]){
  if(!Array.isArray(arr)||!arr.every(group=>Array.isArray(group)&&group.length>0&&group.every(x=>typeof x==='string'&&x.trim().length>1)))throw new Error('Invalid gold concepts in '+c.id);
 }
}
const norm=x=>String(x||'').normalize('NFKC').toLocaleLowerCase('vi').replace(/\s+/g,' ').trim();
const hit=(text,group)=>group.some(x=>norm(text).includes(norm(x)));
const ratio=(n,d)=>d?Number((n/d).toFixed(4)):null;
const samples=[];let expectedFR=0,foundFR=0,producedFR=0,matchedFR=0,expectedNFR=0,foundNFR=0,confirmed=0,grounded=0,violations=0;
for(const c of corpus.cases){
 const raw=await analyze(c.title,c.brief),sources=buildSources(c.brief);
 const result=prepareBAAnalysis(applyEvidenceTrust(normalizeAnalysis(raw,c.brief),sources));
 const fr=result.functionalRequirements||[],nfr=result.nonFunctionalRequirements||[];
 const matched=(c.expectedFunctional||[]).filter(g=>fr.some(r=>hit(`${r.name} ${r.description}`,g))).length;
 const matchedNfr=(c.expectedNfr||[]).filter(g=>nfr.some(r=>hit(`${r.category} ${r.description} ${r.measurableTarget}`,g))).length;
 const predicted=fr.filter(r=>(c.expectedFunctional||[]).some(g=>hit(`${r.name} ${r.description}`,g))).length;
 const current=[...fr,...nfr].filter(r=>r.certainty==='confirmed');
 const valid=current.filter(r=>resolveEvidenceSource(r.sourceEvidence,sources)!==null).length;
 const invalid=current.length-valid;
 expectedFR+=c.expectedFunctional.length;foundFR+=matched;producedFR+=fr.length;matchedFR+=predicted;
 expectedNFR+=c.expectedNfr.length;foundNFR+=matchedNfr;confirmed+=current.length;grounded+=valid;violations+=invalid;
 samples.push({id:c.id,goldFR:c.expectedFunctional.length,matchedFR:matched,generatedFR:fr.length,expectedNFR:c.expectedNfr.length,matchedNFR:matchedNfr,confirmed:current.length,confirmedWithoutVerbatimQuote:invalid,highGaps:result.quality?.counts.high||0});
}
const report={schemaVersion:'ba.quality-benchmark.v3.4',suite:corpus.schemaVersion||'custom-gold',provider:checkProvider(),sampleCount:samples.length,
 mode:args.includes('--live')?'live-model-on-labeled-corpus':'offline-demo-on-synthetic-corpus',
 metrics:{frConceptRecallProxy:ratio(foundFR,expectedFR),frConceptPrecisionProxy:ratio(matchedFR,producedFR),nfrConceptRecallProxy:ratio(foundNFR,expectedNFR),confirmedQuoteGroundingRate:ratio(grounded,confirmed),invalidConfirmedQuotes:violations},
 samples,caveat:'Exact/alias matching is NOT semantic verification. Dataset provenance and human adjudication needed before a production quality claim.'};
const output=JSON.stringify(report,null,2);console.log(output);
if(arg('--out')){const location=path.resolve(arg('--out'));await fs.mkdir(path.dirname(location),{recursive:true});await fs.writeFile(location,output+'\n',{mode:0o600});}
for(const [argName,value] of [['--min-fr-recall',report.metrics.frConceptRecallProxy],['--min-fr-precision',report.metrics.frConceptPrecisionProxy],['--min-grounding',report.metrics.confirmedQuoteGroundingRate]]){
 const input=arg(argName);if(input===null)continue;const n=Number(input);
 if(!Number.isFinite(n)||n<0||n>1)throw new Error(argName+' must be 0..1');
 if(value===null||value<n){process.exitCode=1;console.error(`Quality threshold failed: ${argName} ${value??'N/A'} < ${n}`)}
}
if(args.includes('--fail-on-invalid-confirmed')&&violations>0){process.exitCode=1;console.error('Invalid confirmed evidence quotes: '+violations)}
