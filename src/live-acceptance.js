/** v3.4 live acceptance: explicit human review, provenance and fail-closed release decision.
 * Deliberately does NOT use alias/keyword matches as human semantic truth.
 */
import {createHash} from 'node:crypto';

export const ACCEPTANCE_SCHEMA='ba.live-acceptance.v1';
export const ACCEPTANCE_POLICY={minCases:20,maxCases:50,minFrRecall:0.90,minNfrRecall:0.85,minGrounding:0.99,maxUnsupported:0.03,minAgreement:0.80};
const safeId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(s);
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const quoteIn=(text,quote)=>typeof quote==='string'&&quote.trim().length>0&&String(text||'').normalize('NFKC').toLocaleLowerCase('vi').replace(/\s+/g,' ').includes(quote.normalize('NFKC').toLocaleLowerCase('vi').replace(/\s+/g,' ').trim());
function assert(condition,msg){if(!condition)throw new Error(msg)}
const goldList=(rows,prefix)=>rows.map((entry,i)=>({id:`${prefix}-G${i+1}`,aliases:entry}));

export function validateCorpus(corpus,{minCases=ACCEPTANCE_POLICY.minCases,maxCases=ACCEPTANCE_POLICY.maxCases}={}){
 assert(corpus&&typeof corpus==='object'&&!Array.isArray(corpus),'Gold corpus must be an object');
 assert(corpus.schemaVersion==='ba.gold.reviewed.v1','Corpus schemaVersion must be ba.gold.reviewed.v1');
 assert(corpus.provenance?.kind==='real-anonymized','Provenance must be real-anonymized; synthetic/demo cannot receive live acceptance');
 assert(corpus.provenance?.dataUseApproved===true,'Explicit data use approval is required');
 assert(typeof corpus.provenance?.approvalReference==='string'&&corpus.provenance.approvalReference.length>=4,'Data-use approvalReference is required');
 assert(/^[a-zA-Z0-9_-]{3,128}$/.test(corpus.figmaTarget?.fileKey||'')&&/^\d+:\d+$/.test(corpus.figmaTarget?.nodeId||'')&&typeof corpus.figmaTarget?.nodeName==='string'&&corpus.figmaTarget.nodeName.length>0&&typeof corpus.figmaTarget?.designSpecReference==='string'&&corpus.figmaTarget.designSpecReference.length>=4,'Exact Figma acceptance target + design spec reference required');
 assert(Array.isArray(corpus.cases)&&corpus.cases.length>=minCases&&corpus.cases.length<=maxCases,`Require ${minCases}..${maxCases} approved real cases`);
 const ids=new Set();
 for(const c of corpus.cases){
  assert(safeId(c.id)&&!ids.has(c.id),`Duplicate/invalid case ID: ${c.id}`);ids.add(c.id);
  assert(typeof c.title==='string'&&c.title.trim().length>1&&c.title.length<=250,'Missing/invalid case title');
  assert(typeof c.brief==='string'&&c.brief.trim().length>=20&&c.brief.length<=100000,`Invalid brief in ${c.id}`);
  assert(typeof c.domain==='string'&&c.domain.trim().length>0,`Missing domain in ${c.id}`);
  for(const field of ['expectedFunctional','expectedNfr']){
   assert(Array.isArray(c[field]),`Missing ${field} in ${c.id}`);
   for(const aliases of c[field])assert(Array.isArray(aliases)&&aliases.length>0&&aliases.every(x=>typeof x==='string'&&x.trim().length>1),`Invalid gold concept in ${c.id}/${field}`);
  }
  assert(c.expectedFunctional.length+c.expectedNfr.length>0,`No annotated concepts in ${c.id}`);
  const a=c.annotation;
  assert(a?.status==='approved'&&typeof a.adjudicatedAt==='string'&&Number.isFinite(Date.parse(a.adjudicatedAt)),`Missing approved annotation in ${c.id}`);
  assert(Array.isArray(a.reviewerIds)&&a.reviewerIds.length>=2&&a.reviewerIds.every(safeId)&&new Set(a.reviewerIds).size===a.reviewerIds.length,`Two distinct BA reviewer IDs required in ${c.id}`);
  assert(safeId(a.adjudicatedBy)&&typeof a.reference==='string'&&a.reference.trim().length>=4,`Adjudication provenance required in ${c.id}`);
 }
 return {caseCount:corpus.cases.length,corpusHash:digest(corpus),domains:[...new Set(corpus.cases.map(c=>c.domain))].sort(),goldFR:corpus.cases.reduce((a,c)=>a+c.expectedFunctional.length,0),goldNFR:corpus.cases.reduce((a,c)=>a+c.expectedNfr.length,0)};
}

export function predictionsFromAnalysis(analysis){
 return {
  functional:(analysis.functionalRequirements||[]).map((r,i)=>({id:`FR-P${i+1}`,title:r.name||'',description:r.description||'',certainty:r.certainty||'assumption',sourceEvidence:r.sourceEvidence||''})),
  nonFunctional:(analysis.nonFunctionalRequirements||[]).map((r,i)=>({id:`NFR-P${i+1}`,title:r.category||'',description:r.description||'',certainty:r.certainty||'assumption',sourceEvidence:r.sourceEvidence||''}))
 };
}
export function makeReviewTemplate(run,reviewerId){
 assert(safeId(reviewerId),'Reviewer ID invalid');
 return {schemaVersion:'ba.review-judgments.v1',runId:run.runId,corpusHash:run.corpusHash,runPredictionsHash:digest(run.cases),reviewerId,reviewedAt:'',cases:run.cases.filter(x=>x.status==='COMPLETED').map(c=>({caseId:c.id,functional:c.predictions.functional.map(p=>({predictionId:p.id,verdict:'PENDING',matchedGoldIds:[],supportQuote:'',note:''})),nonFunctional:c.predictions.nonFunctional.map(p=>({predictionId:p.id,verdict:'PENDING',matchedGoldIds:[],supportQuote:'',note:''}))}))};
}
function validateReview(review,run,corpus,{allowPending=false}={}){
 assert(review?.schemaVersion==='ba.review-judgments.v1'&&review.runId===run.runId&&review.corpusHash===run.corpusHash&&review.runPredictionsHash===digest(run.cases),'Review must bind to run ID, corpus hash and exact generated predictions');
 assert(safeId(review.reviewerId)&&Number.isFinite(Date.parse(review.reviewedAt||'')),'Reviewer identity and timestamp required');
 assert(Array.isArray(review.cases)&&review.cases.length===run.cases.length,'Review case coverage mismatch');
 const byId=new Map(corpus.cases.map(c=>[c.id,c]));const used=new Set();const result=new Map();
 for(const r of review.cases){
  assert(!used.has(r.caseId)&&byId.has(r.caseId),`Invalid/duplicate review case: ${r.caseId}`);used.add(r.caseId);
  const gold=byId.get(r.caseId),output=run.cases.find(c=>c.id===r.caseId);
  assert(output?.status==='COMPLETED',`Cannot review failed run case: ${r.caseId}`);
  const judgments=[];
  for(const [field,prefix,goldField] of [['functional','FR','expectedFunctional'],['nonFunctional','NFR','expectedNfr']]){
   const predictions=output.predictions[field],rows=r[field];
   assert(Array.isArray(rows)&&rows.length===predictions.length,`Prediction coverage mismatch: ${r.caseId}/${field}`);
   const refs=new Set(goldList(gold[goldField],prefix).map(g=>g.id));const seen=new Set();
   for(const row of rows){
    const p=predictions.find(p=>p.id===row.predictionId);
    assert(p&&!seen.has(p.id),`Unexpected/duplicate predicted ID: ${r.caseId}/${row.predictionId}`);seen.add(p.id);
    assert((allowPending?['supported','unsupported','needs-clarification','PENDING']:['supported','unsupported','needs-clarification']).includes(row.verdict),`Invalid pending verdict: ${r.caseId}/${p.id}`);
    assert(Array.isArray(row.matchedGoldIds)&&new Set(row.matchedGoldIds).size===row.matchedGoldIds.length&&row.matchedGoldIds.every(g=>refs.has(g)),`Unknown gold IDs in ${r.caseId}/${p.id}`);
    if(row.verdict==='supported'){
     assert(row.matchedGoldIds.length>0,`Supported prediction must map to gold: ${r.caseId}/${p.id}`);
     assert(quoteIn(gold.brief,row.supportQuote),`Supported prediction needs verbatim customer quote: ${r.caseId}/${p.id}`);
    }else assert(row.matchedGoldIds.length===0,`Unaccepted prediction cannot match gold: ${r.caseId}/${p.id}`);
    if(row.verdict==='unsupported')assert(typeof row.note==='string'&&row.note.trim().length>=5,`Unsupported prediction requires BA reason: ${r.caseId}/${p.id}`);
    judgments.push({field,predictionId:p.id,verdict:row.verdict,matchedGoldIds:row.matchedGoldIds,caseId:r.caseId});
   }
  }
  result.set(r.caseId,judgments);
 }
 return result;
}
const round=(num,den)=>den?Math.round(num/den*10000)/10000:null;

export function scoreAcceptance({run,corpus,reviewA,reviewB,adjudication,figma,visualQa,policy=ACCEPTANCE_POLICY}){
 const info=validateCorpus(corpus);
 assert(run?.schemaVersion===ACCEPTANCE_SCHEMA&&run.corpusHash===info.corpusHash&&Array.isArray(run.cases)&&run.cases.length===corpus.cases.length,'Run/corpus mismatch');
 assert(new Set(run.cases.map(c=>c.id)).size===corpus.cases.length&&corpus.cases.every(c=>run.cases.some(o=>o.id===c.id)),'Incomplete run corpus coverage');
 const a=validateReview(reviewA,run,corpus),b=validateReview(reviewB,run,corpus),final=validateReview(adjudication,run,corpus);
 assert(a.size===info.caseCount&&b.size===info.caseCount&&final.size===info.caseCount,'Review incomplete');
 assert(reviewA.reviewerId!==reviewB.reviewerId,'Independent reviews need distinct identities');
 assert(safeId(adjudication.reviewerId),'Adjudicator must provide identity');
 for(const c of corpus.cases){assert(c.annotation.reviewerIds.includes(reviewA.reviewerId)&&c.annotation.reviewerIds.includes(reviewB.reviewerId),`Corpus ${c.id} was not approved by both reviewers`);assert(c.annotation.adjudicatedBy===adjudication.reviewerId,`Corpus ${c.id} adjudicator ID mismatch`);}
 let agreed=0,totalJudgments=0,unsupported=0,totalPredictions=0,confirmed=0,confirmedGrounded=0,rawConfirmed=0,rawGrounded=0,frFound=0,nfrFound=0,needsClarification=0;
 const findings=[];
 for(const c of corpus.cases){
  const original=run.cases.find(x=>x.id===c.id),ja=a.get(c.id),jb=b.get(c.id),jf=final.get(c.id);
  totalPredictions+=jf.length;
  assert(Number.isSafeInteger(original.rawEvidence?.confirmed)&&Number.isSafeInteger(original.rawEvidence?.grounded)&&original.rawEvidence.confirmed>=original.rawEvidence.grounded&&original.rawEvidence.grounded>=0,`Missing trustworthy pre-normalization quote metrics: ${c.id}`);
  rawConfirmed+=original.rawEvidence.confirmed;rawGrounded+=original.rawEvidence.grounded;
  for(let i=0;i<jf.length;i++){
   const v=jf[i],p=(original.predictions[v.field]||[]).find(row=>row.id===v.predictionId);
   assert(p,`Run prediction missing: ${c.id}/${v.predictionId}`);
   totalJudgments++;
   if(ja[i]?.predictionId===jb[i]?.predictionId&&ja[i]?.field===jb[i]?.field&&ja[i]?.verdict===jb[i]?.verdict&&JSON.stringify([...ja[i].matchedGoldIds].sort())===JSON.stringify([...jb[i].matchedGoldIds].sort()))agreed++;
   if(v.verdict==='unsupported'){unsupported++;findings.push({caseId:c.id,predictionId:v.predictionId,code:'UNSUPPORTED_REQUIREMENT'})}
   if(v.verdict==='needs-clarification')needsClarification++;
   if(p.certainty==='confirmed'){confirmed++;if(quoteIn(c.brief,p.sourceEvidence))confirmedGrounded++;else findings.push({caseId:c.id,predictionId:p.id,code:'UNGROUNDED_CONFIRMED'});}
  }
  const supported=jf.filter(j=>j.verdict==='supported');
  frFound+=new Set(supported.filter(j=>j.field==='functional').flatMap(j=>j.matchedGoldIds)).size;
  nfrFound+=new Set(supported.filter(j=>j.field==='nonFunctional').flatMap(j=>j.matchedGoldIds)).size;
 }
 const metrics={frRecall:round(frFound,info.goldFR),nfrRecall:round(nfrFound,info.goldNFR),unsupportedRate:round(unsupported,totalPredictions),reviewerAgreement:round(agreed,totalJudgments),confirmedGrounding:round(rawGrounded,rawConfirmed),rawConfirmedGrounding:round(rawGrounded,rawConfirmed),postNormalizationGrounding:round(confirmedGrounded,confirmed),unresolvedPredictions:needsClarification,totalPredictions,totalConfirmed:confirmed,totalRawConfirmed:rawConfirmed,goldFR:info.goldFR,goldNFR:info.goldNFR};
 const failures=[];
 for(const [name,value,limit,dir] of [['frRecall',metrics.frRecall,policy.minFrRecall,'min'],['nfrRecall',metrics.nfrRecall,policy.minNfrRecall,'min'],['confirmedGrounding',metrics.confirmedGrounding,policy.minGrounding,'min'],['unsupportedRate',metrics.unsupportedRate,policy.maxUnsupported,'max'],['reviewerAgreement',metrics.reviewerAgreement,policy.minAgreement,'min']]){
  if(value===null||(dir==='min'?value<limit:value>limit))failures.push(`${name}: ${value??'NOT_MEASURABLE'} (threshold ${dir} ${limit})`);
 }
 if(info.goldFR===0||info.goldNFR===0)failures.push('Gold corpus must include FR and NFR for meaningful release metrics');
 if(!totalPredictions||needsClarification)failures.push('Incomplete semantic conclusions (zero predictions or unresolved judgments)');
 if(run.cases.some(c=>c.status!=='COMPLETED'))failures.push('One or more provider calls failed');
 if(!figma||figma.source!=='figma-rest-crosschecked-with-mcp-operator'||figma.passed!==true||figma.mcpContract!==true||figma.fileKey!==corpus.figmaTarget.fileKey||figma.nodeId!==corpus.figmaTarget.nodeId||figma.nodeName!==corpus.figmaTarget.nodeName)failures.push('Independent live Figma REST + operator MCP cross-check missing or not bound to intended design target');
 else if(!Number.isFinite(Date.parse(figma.checkedAt))||Math.abs(Date.now()-Date.parse(figma.checkedAt))>24*3600_000)failures.push('Figma proof must be from last 24 hours');
 if(visualQa?.approved!==true||visualQa?.source!=='ba-human-visual-qa'||!safeId(visualQa.reviewerId)||typeof visualQa.evidenceReference!=='string'||visualQa.evidenceReference.length<4||visualQa.designSpecReference!==corpus.figmaTarget.designSpecReference||visualQa.fileKey!==corpus.figmaTarget.fileKey||visualQa.nodeId!==corpus.figmaTarget.nodeId||!Number.isFinite(Date.parse(visualQa.approvedAt))||Math.abs(Date.now()-Date.parse(visualQa.approvedAt))>30*24*3600_000)failures.push('Scoped BA visual QA approval is missing or stale');
 return {schemaVersion:'ba.live-acceptance-report.v1',evaluatedAt:new Date().toISOString(),status:failures.length?'FAIL':'PASS',runId:run.runId,corpusHash:info.corpusHash,provider:run.provider,model:run.model,sampleCount:info.caseCount,domains:info.domains,metrics,figma:{status:figma?.passed?'CROSSCHECKED':'NOT_VERIFIED',fileKey:figma?.fileKey||null,nodeId:figma?.nodeId||null,checkedAt:figma?.checkedAt||null},visualQa:{approved:visualQa?.approved===true,reviewerId:visualQa?.reviewerId||null,evidenceReference:visualQa?.evidenceReference||null},policy,failures,findings,caveats:['Corpus provenance, reviewer identity and adjudication references are operator attestations, not independently identity-verified.','Text-level evidence grounding does not certify semantic correctness.','Figma cross-check verifies node identity/type/name, not visual UX quality or customer sign-off.']};
}

/** Figma REST read-back deliberately limits itself to authorized read-only nodes. */
export async function crosscheckFigmaRest(operatorReport,{fileKey,nodeId,nodeName,token,fetchImpl=fetch}){
 assert(/^[a-zA-Z0-9_-]{3,128}$/.test(fileKey||'')&&/^\d+:\d+$/.test(nodeId||''),'Invalid scoped Figma file/node');
 assert(typeof token==='string'&&token.trim().length>0,'FIGMA_ACCESS_TOKEN required');
 assert(operatorReport?.passed===true&&operatorReport?.contract==='ba.figma-mcp-readback.v3.4'&&operatorReport?.source==='operator-reported-live-probe-not-cryptographic-attestation','Valid MCP operator contract report required');
 assert(operatorReport.documentKey===fileKey&&operatorReport.nodeId===nodeId&&(!nodeName||operatorReport.nodeName===nodeName),'MCP report scoped mismatch');
 const url=`https://api.figma.com/v1/files/${encodeURIComponent(fileKey)}/nodes?ids=${encodeURIComponent(nodeId)}&depth=1`;
 const response=await fetchImpl(url,{method:'GET',headers:{'X-Figma-Token':token},signal:AbortSignal.timeout(20000)});
 assert(response.ok,`Figma read-only API HTTP ${response.status}`);
 const data=await response.json();const actual=data?.nodes?.[nodeId]?.document;
 assert(actual?.id===nodeId&&actual?.type==='FRAME','Figma REST read-back returned missing/wrong FRAME');
 assert(typeof actual.name==='string'&&actual.name===operatorReport.nodeName&&(!nodeName||actual.name===nodeName),'Figma REST node name mismatch');
 return {source:'figma-rest-crosschecked-with-mcp-operator',passed:true,mcpContract:true,checkedAt:new Date().toISOString(),fileKey,nodeId,nodeName:actual.name,apiOrigin:'https://api.figma.com',scope:'read-only',note:'Cross-channel identity confirmation; not visual QA or cryptographic attestation of the MCP agent.'};
}
