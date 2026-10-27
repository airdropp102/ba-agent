/** Human-adjudicated research comparison. Never a production release gate. */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {admitCorpus} from './harness2/live-corpus.mjs';
import {digest,quoteIn} from '../src/live-acceptance.js';

const check=(x,m)=>{if(!x)throw new Error(m);};
const ratio=(a,b)=>b?a/b:null;
const same=(a,b)=>a.verdict===b.verdict&&JSON.stringify([...a.matchedGoldIds].sort())===JSON.stringify([...b.matchedGoldIds].sort());

export function scoreLearningReviews({run,corpus,runHash,reviewA,reviewB,adjudication}){
 const admitted=admitCorpus(corpus,{kind:run.kind});
 check(run.corpusHash===admitted.corpusHash&&run.status==='AWAITING_HUMAN_REVIEW','Incomplete run or corpus hash mismatch');
 const cases=corpus.cases.filter(c=>c.split==='test'),rows=run.rows.filter(r=>r.phase==='test');
 check(rows.length===cases.length*3,'Run test/arm coverage mismatch');
 const byKey=new Map();
 for(const row of rows){const key=row.task+'/'+row.arm;check(!byKey.has(key)&&['A','B','C'].includes(row.arm)&&row.status==='COMPLETED','Duplicate, failed or invalid arm result');check(cases.some(c=>c.id===row.task&&c.groupId===row.groupId),'Unknown test case/group');byKey.set(key,row);}
 for(const c of cases)for(const arm of ['A','B','C'])check(byKey.has(c.id+'/'+arm),'Missing test arm');
 const peers=[reviewA,reviewB,adjudication];
 check(new Set(peers.map(r=>r?.reviewerId)).size===3,'Three distinct reviewer/adjudicator identities required');
 const parsed=peers.map(review=>{
  check(review?.schemaVersion==='ba.harness2.review.v1','Unsupported review schema');
  check(review?.runHash===runHash,'Review does not bind exact run outputs');
  check(/^[A-Za-z0-9_-]{1,80}$/.test(review.reviewerId??'')&&Number.isFinite(Date.parse(review.reviewedAt??'')),'Reviewer identity and timestamp required');
  check(Array.isArray(review.judgments)&&review.judgments.length===rows.length,'Review case/arm coverage mismatch');
  const judgments=new Map();
  for(const judgment of review.judgments){
   const key=judgment.caseId+'/'+judgment.arm,row=byKey.get(key),c=cases.find(c=>c.id===judgment.caseId);
   check(row&&c&&!judgments.has(key),'Duplicate/unknown reviewed case/arm');
   if(run.kind==='reviewed'){
    const approved=review===adjudication?c.annotation.adjudicatedBy===review.reviewerId:c.annotation.reviewerIds.includes(review.reviewerId);
    check(approved,'Reviewer authority differs from admitted corpus');
   }
   const mapped={};
   for(const [field,goldField,prefix] of [['functional','expectedFunctional','FR'],['nonFunctional','expectedNfr','NFR']]){
    const predictions=row.predictions[field],entries=judgment[field];
    check(Array.isArray(entries)&&entries.length===predictions.length,'Prediction review coverage mismatch');
    const seen=new Set(),known=new Set(c[goldField].map((_,i)=>`${prefix}-G${i+1}`));mapped[field]=[];
    for(const entry of entries){
     check(predictions.some(p=>p.id===entry.predictionId)&&!seen.has(entry.predictionId),'Duplicate/unknown prediction ID');seen.add(entry.predictionId);
     check(['supported','unsupported','needs-clarification'].includes(entry.verdict),'Pending/invalid semantic verdict');
     check(Array.isArray(entry.matchedGoldIds)&&new Set(entry.matchedGoldIds).size===entry.matchedGoldIds.length&&entry.matchedGoldIds.every(x=>known.has(x)),'Unknown/duplicate gold concept IDs');
     if(entry.verdict==='supported')check(entry.matchedGoldIds.length>0&&quoteIn(c.brief,entry.supportQuote),'Supported judgment needs actual source quote and gold mapping');
     else check(entry.matchedGoldIds.length===0,'Unsupported or unresolved prediction cannot match gold');
     if(entry.verdict==='unsupported')check(typeof entry.note==='string'&&entry.note.trim().length>=5,'Unsupported prediction requires human rationale');
     mapped[field].push(entry);
    }
   }
   judgments.set(key,mapped);
  }
  return judgments;
 });
 const metrics={},perCase=[];
 for(const arm of ['A','B','C']){
  let goldFR=0,goldNFR=0,matchedFR=0,matchedNFR=0,unsupported=0,total=0,agreement=0,confirmed=0,grounded=0;
  for(const c of cases){
   const key=c.id+'/'+arm,row=byKey.get(key),final=parsed[2].get(key),a=parsed[0].get(key),b=parsed[1].get(key);
   const matched=field=>new Set(final[field].flatMap(j=>j.matchedGoldIds)).size;
   const fr=matched('functional'),nfr=matched('nonFunctional');
   goldFR+=c.expectedFunctional.length;goldNFR+=c.expectedNfr.length;matchedFR+=fr;matchedNFR+=nfr;
   for(const field of ['functional','nonFunctional'])for(const judgment of final[field]){
    total++;unsupported+=judgment.verdict==='unsupported'?1:0;
    const aa=a[field].find(x=>x.predictionId===judgment.predictionId),bb=b[field].find(x=>x.predictionId===judgment.predictionId);agreement+=same(aa,bb)?1:0;
   }
   check(Number.isSafeInteger(row.rawEvidence?.confirmed)&&Number.isSafeInteger(row.rawEvidence?.grounded)&&row.rawEvidence.grounded>=0&&row.rawEvidence.confirmed>=row.rawEvidence.grounded,'Raw evidence counters invalid');
   confirmed+=row.rawEvidence.confirmed;grounded+=row.rawEvidence.grounded;
   perCase.push({caseId:c.id,groupId:c.groupId,arm,frRecall:ratio(fr,c.expectedFunctional.length),nfrRecall:ratio(nfr,c.expectedNfr.length)});
  }
  metrics[arm]={frRecall:ratio(matchedFR,goldFR),nfrRecall:ratio(matchedNFR,goldNFR),unsupportedRatio:ratio(unsupported,total),reviewerAgreement:ratio(agreement,total),rawQuoteGrounding:ratio(grounded,confirmed),predictions:total,goldFR,goldNFR};
 }
 const paired={};
 for(const [name,left,right] of [['BminusA','B','A'],['CminusB','C','B']]){
  const deltas=cases.map(c=>{const l=perCase.find(r=>r.caseId===c.id&&r.arm===left),r=perCase.find(r=>r.caseId===c.id&&r.arm===right);return {groupId:c.groupId,fr:l.frRecall!==null&&r.frRecall!==null?l.frRecall-r.frRecall:null,nfr:l.nfrRecall!==null&&r.nfrRecall!==null?l.nfrRecall-r.nfrRecall:null};});
  const groups=[...new Set(deltas.map(d=>d.groupId))];
  const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const ci=field=>{
   if(groups.length<2)return null;
   let seed=42;const samples=[];
   for(let i=0;i<1000;i++){
    const values=[];
    for(let j=0;j<groups.length;j++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const group=groups[seed%groups.length];values.push(...deltas.filter(d=>d.groupId===group&&d[field]!==null).map(d=>d[field]));}
    const value=mean(values);if(value!==null)samples.push(value);
   }
   samples.sort((a,b)=>a-b);return samples.length?[samples[Math.floor(samples.length*.025)],samples[Math.min(samples.length-1,Math.floor(samples.length*.975))]]:null;
  };
  paired[name]={caseCount:deltas.length,groupCount:groups.length,frRecallDelta:mean(deltas.filter(d=>d.fr!==null).map(d=>d.fr)),nfrRecallDelta:mean(deltas.filter(d=>d.nfr!==null).map(d=>d.nfr)),frRecallCI95:ci('fr'),nfrRecallCI95:ci('nfr')};
 }
 return {schemaVersion:'ba.harness2.human-research-report.v1',status:run.kind==='synthetic-smoke'?'SYNTHETIC_REVIEWED_NOT_ACCEPTANCE':'HUMAN_REVIEWED_RESEARCH_ONLY',productionAccepted:false,customerApproved:false,runHash,corpusHash:admitted.corpusHash,metrics,paired,perCase,caveats:['Review identity and corpus provenance are operator-attested, not independently authenticated.','Paired deltas are mean case-recall differences; confidence intervals resample project groups and are exploratory. One group yields no interval.','These research metrics do not replace the existing production/Figma/visual acceptance gates.']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2),opt=key=>args[args.indexOf(key)+1];
  for(const key of ['--run-dir','--corpus','--review-a','--review-b','--adjudication','--out'])if(!args.includes(key)||!opt(key))throw new Error('Required: --run-dir --corpus --review-a --review-b --adjudication --out');
  const raw=await readFile(join(resolve(opt('--run-dir')),'report.json'));
  const read=async key=>JSON.parse(await readFile(opt(key),'utf8'));
  const report=scoreLearningReviews({run:JSON.parse(raw),runHash:createHash('sha256').update(raw).digest('hex'),corpus:await read('--corpus'),reviewA:await read('--review-a'),reviewB:await read('--review-b'),adjudication:await read('--adjudication')});
  const target=resolve(opt('--out'));await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
  console.log(JSON.stringify({status:report.status,output:target,productionAccepted:false},null,2));
 }catch{console.error('Research scoring rejected: complete independent reviews, source quotes, corpus and exact run binding are required; inspect the runbook.');process.exitCode=2;}
}
