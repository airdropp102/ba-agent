#!/usr/bin/env node
/** Small, reproducible GOLD/proxy benchmark; NOT human semantic correctness. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';import path from 'node:path';
import {analyze,checkProvider} from '../src/ai-provider.js';
import {normalizeAnalysis} from '../src/normalize.js';
import {applyEvidenceTrust,buildSources,resolveEvidenceSource} from '../src/revisions.js';
import {prepareBAAnalysis} from '../src/ba-quality.js';
const args=process.argv.slice(2),live=args.includes('--live');
if(!live)process.env.DEMO_MODE='true';
else if(process.env.DEMO_MODE!=='false')throw new Error('Live evaluation requires DEMO_MODE=false and configured AI_PROVIDER');
const corpus=JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../eval/ba-gold-v1.json'),'utf8'));
const norm=x=>String(x||'').normalize('NFKC').toLocaleLowerCase('vi').replace(/\s+/g,' ');
const matches=(x,alternatives)=>alternatives.some(term=>norm(x).includes(norm(term)));
const samples=[];let target=0,hits=0,predicted=0,matchedPredicted=0,confirmed=0,grounded=0,nfrTargets=0,nfrHits=0;
for(const c of corpus.cases){
 const raw=await analyze(c.title,c.brief);
 const a=prepareBAAnalysis(applyEvidenceTrust(normalizeAnalysis(raw,c.brief),buildSources(c.brief)));
 const fr=a.functionalRequirements||[],nfr=a.nonFunctionalRequirements||[];
 const expected=c.expectedFunctional||[];
 const corpusHits=expected.filter(group=>fr.some(r=>matches(`${r.name} ${r.description}`,group))).length;
 const found=fr.filter(r=>expected.some(group=>matches(`${r.name} ${r.description}`,group))).length;
 const currentConfirmed=[...fr,...nfr].filter(r=>r.certainty==='confirmed');
 const currentGrounded=currentConfirmed.filter(r=>resolveEvidenceSource(r.sourceEvidence,buildSources(c.brief))!==null);
 const nfHits=(c.expectedNfr||[]).filter(group=>nfr.some(r=>matches(`${r.category} ${r.description} ${r.measurableTarget}`,group))).length;
 target+=expected.length;hits+=corpusHits;predicted+=fr.length;matchedPredicted+=found;confirmed+=currentConfirmed.length;grounded+=currentGrounded.length;nfrTargets+=(c.expectedNfr||[]).length;nfrHits+=nfHits;
 samples.push({id:c.id,goldFr:expected.length,foundFr:corpusHits,producedFr:fr.length,confirmed:currentConfirmed.length,grounded:currentGrounded.length,goldNfr:(c.expectedNfr||[]).length,foundNfr:nfHits,highGaps:a.quality?.counts?.high||0});
}
const ratio=(n,d)=>d===0?null:Number((n/d).toFixed(3));
const report={suite:'ba-gold-v1',provider:checkProvider(),cases:samples.length,
 caveat:'Keyword-concept recall/precision proxy only; synthetic corpus cannot certify semantic accuracy. Human annotation needed.',
 metrics:{frConceptRecall:ratio(hits,target),frConceptPrecisionProxy:ratio(matchedPredicted,predicted),nfrConceptRecall:ratio(nfrHits,nfrTargets),confirmedQuoteGroundingRate:ratio(grounded,confirmed)},samples};
console.log(JSON.stringify(report,null,2));
const threshold=args.indexOf('--min-recall');
if(threshold>=0){const n=Number(args[threshold+1]);if(!Number.isFinite(n)||n<0||n>1)throw new Error('--min-recall must be 0..1');if((report.metrics.frConceptRecall??0)<n)process.exitCode=1;}
