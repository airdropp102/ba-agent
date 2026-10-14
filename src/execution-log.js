/** Console-only execution metadata. Never emit arbitrary provider text or customer content. */
import {AsyncLocalStorage} from 'node:async_hooks';
const context=new AsyncLocalStorage();
const labels=['projectId','runId','executionId','invocationId','stage','operation','provider','model','errorCode','cliEvent','itemType'];
const counts=['pid','elapsedMs','durationMs','timeoutMs','promptBytes','schemaBytes','stdoutBytes','stderrBytes','outputBytes','briefChars','sourceCount','answerCount','decisionCount','questionCount','frCount','nfrCount','brCount','version','exitCode'];
export function withExecutionContext(metadata,work){return context.run({...context.getStore(),...metadata},work);}
export function logExecution(event,details={}){
 if(process.env.BA_LOG_PROGRESS==='false')return;
 if(!/^[A-Z][A-Z0-9_]{1,60}$/.test(event))return;
 const input={...context.getStore(),...details},record={at:new Date().toISOString(),event,processPid:process.pid};
 for(const key of labels)if(typeof input[key]==='string'&&/^[\w.:-]{1,100}$/.test(input[key]))record[key]=input[key];
 for(const key of counts)if(Number.isSafeInteger(input[key])&&input[key]>=0)record[key]=input[key];
 for(const [key,pattern] of [['sourceIds',/^SRC-\d{3,}$/],['questionIds',/^Q-\d{3,}$/]])if(Array.isArray(input[key]))record[key]=input[key].filter(id=>typeof id==='string'&&pattern.test(id)).slice(0,100);
 try{console.info('[BA Progress] '+JSON.stringify(record));}catch{} // Logging must not alter project execution.
}
