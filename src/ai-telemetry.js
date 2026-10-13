/** Request-scoped usage capture with zero prompt/completion retention. */
import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
const context=new AsyncLocalStorage();
let sink=null;
export function setTelemetrySink(fn){sink=fn;}
export function withAIContext(metadata,work){return context.run({...context.getStore(),...metadata},work);}
export function noteUsage(data){const ctx=context.getStore();if(ctx)ctx.usage=data;}
export function costRates(env=process.env){
 let data;
 try{data=JSON.parse(env.BA_AI_COST_RATES_JSON||'{}')}catch{throw new Error('Invalid BA_AI_COST_RATES_JSON')}
 if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('BA_AI_COST_RATES_JSON must be an object');
 for(const [model,rate] of Object.entries(data)){
  if(!/^[\w.:-]{1,100}$/.test(model)||!rate||!Number.isFinite(rate.inputPerMillionUsd)||rate.inputPerMillionUsd<0||!Number.isFinite(rate.outputPerMillionUsd)||rate.outputPerMillionUsd<0)throw new Error('Invalid nonnegative model price rate: '+model);
 }
 return data;
}
function safeInt(n){return Number.isSafeInteger(n)&&n>=0?n:null}
export async function measureAI(operation,provider,model,work){
 const parent=context.getStore()||{},local={...parent,usage:null};const started=Date.now();
 try{return await context.run(local,work)}
 catch(e){local.failed=true;throw e}
 finally{
  const tokens=local.usage||{};const input=safeInt(tokens.inputTokens),output=safeInt(tokens.outputTokens);
  let usd=null,rateVersion=null;
  try{const rate=costRates()[model];if(rate&&input!==null&&output!==null){usd=Number(((input*rate.inputPerMillionUsd+output*rate.outputPerMillionUsd)/1_000_000).toFixed(8));rateVersion='operator-configured-not-provider-verified';}}catch(e){console.error('[BA Telemetry] price config invalid:',e.message)}
  const event={id:randomUUID(),projectId:local.projectId||null,runId:local.runId||null,stage:local.stage||operation,
   operation,provider,model,startedAt:new Date(started).toISOString(),durationMs:Math.max(0,Date.now()-started),status:local.failed?'ERROR':'OK',
   inputTokens:input,outputTokens:output,costUsd:usd,rateVersion};
  try{sink?.(event)}catch(e){console.error('[BA Telemetry] usage persistence failed:',e.message)}
 }
}
