/** Credential-isolated Codex JSON transport; ledger contains metadata only. */
import {spawn} from 'node:child_process';
import {open,readFile,writeFile,rename,mkdir,mkdtemp,copyFile,chmod,rm,stat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {validateModelOutput} from '../../src/model-output.js';

export async function readLedger(root){try{return JSON.parse(await readFile(join(root,'invocations.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function transact(root,fn){
 await mkdir(root,{recursive:true,mode:0o700});const lock=join(root,'invocations.lock');let handle;
 for(let n=0;n<500;n++){try{handle=await open(lock,'wx',0o600);break;}catch(e){if(e.code!=='EEXIST')throw e;await delay(10);}}
 if(!handle)throw new Error('Invocation ledger locked; inspect interrupted run, never replay blindly');
 try{const current=await readLedger(root);const result=fn(current);const next=result.ledger;const temp=join(root,`invocations-${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(next,null,2)+'\n',{flag:'wx',mode:0o600});await rename(temp,join(root,'invocations.json'));return result.value;}
 finally{await handle.close();await rm(lock,{force:true});}
}
export async function reserveCall(root,{maxCalls,role,requestId,model}){
 if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>2000)throw new Error('Invalid invocation cap');
 return transact(root,current=>{
  const ledger=current??{maxCalls,calls:[],stopped:false};
  if(ledger.maxCalls!==maxCalls||ledger.stopped||ledger.calls.length>=maxCalls)throw new Error('Invocation budget/cap reached or stopped');
  if(ledger.calls.some(c=>c.requestId===requestId))throw new Error('Invocation already attempted; no replay');
  const call={id:randomUUID(),requestId,role,model,status:'IN_FLIGHT',startedAt:new Date().toISOString(),inputTokens:null,outputTokens:null,costUsd:null};ledger.calls.push(call);
  return {ledger,value:call};
 });
}
export async function completeCall(root,id,result){
 return transact(root,ledger=>{
  const call=ledger?.calls.find(c=>c.id===id);if(!call||call.status!=='IN_FLIGHT')throw new Error('Invalid invocation completion');
  if(!['COMPLETED','FAILED'].includes(result.status))throw new Error('Invalid invocation status');
  Object.assign(call,{status:result.status,completedAt:new Date().toISOString(),durationMs:Date.now()-Date.parse(call.startedAt),inputTokens:Number.isSafeInteger(result.inputTokens)&&result.inputTokens>=0?result.inputTokens:null,outputTokens:Number.isSafeInteger(result.outputTokens)&&result.outputTokens>=0?result.outputTokens:null,costUsd:null,errorCode:result.errorCode??null});
  if(call.status==='FAILED')ledger.stopped=true;return {ledger,value:call};
 });
}

export function buildCodexArgs({model,schemaFile,outputFile}){
 if(!/^[\w.:-]{1,100}$/.test(model))throw new Error('Explicit model required');
 const args=['exec','--json','--ephemeral','--ignore-user-config','--ignore-rules','--sandbox','read-only','--skip-git-repo-check','--model',model,'--output-schema',schemaFile,'--output-last-message',outputFile];
 for(const config of ['model_reasoning_effort="low"','web_search="disabled"','mcp_servers={}','tools.view_image=false',...['shell_tool','apps','plugins','browser_use','browser_use_external','computer_use','code_mode','code_mode_host','multi_agent','memories','hooks','shell_snapshot'].map(x=>`features.${x}=false`)])args.push('-c',config);
 args.push('-');return args;
}

function kill(proc){if(!proc?.pid)return;try{process.kill(process.platform==='win32'?proc.pid:-proc.pid,'SIGKILL');}catch{}}
export async function callCodexJson({prompt,schema,model,bin,authFile,ledgerRoot,maxCalls,role,requestId,timeoutMs=150000,validate}){
 const argsCheck=buildCodexArgs({model,schemaFile:'schema',outputFile:'output'});void argsCheck;
 if(typeof prompt!=='string'||Buffer.byteLength(prompt)>600000)throw new Error('Codex prompt exceeds limit');
 const call=await reserveCall(ledgerRoot,{maxCalls,role,requestId,model});
 const directory=await mkdtemp(join(tmpdir(),'ba-h2-codex-'));let proc,timer;const usage={inputTokens:null,outputTokens:null};
 let errorCode='CLI_FAILED';const cleanup=()=>kill(proc);process.once('exit',cleanup);
 const interrupted=()=>{kill(proc);};process.once('SIGTERM',interrupted);process.once('SIGINT',interrupted);
 try{
  await chmod(directory,0o700);const home=join(directory,'codex');await mkdir(home,{mode:0o700});
  const authStat=await stat(authFile);if(!authStat.isFile()||authStat.size>100000)throw new Error('Codex file login required');
  await copyFile(authFile,join(home,'auth.json'));await chmod(join(home,'auth.json'),0o600);
  const schemaFile=join(directory,'schema.json'),outputFile=join(directory,'output.json');await writeFile(schemaFile,JSON.stringify(schema),{mode:0o600});
  proc=spawn(bin,buildCodexArgs({model,schemaFile,outputFile}),{cwd:directory,env:{PATH:dirname(process.execPath)+':/usr/bin:/bin',HOME:directory,CODEX_HOME:home,LANG:'en_US.UTF-8'},stdio:['pipe','pipe','pipe'],shell:false,detached:process.platform!=='win32'});
  let buffered='',bytes=0,toolSeen=false,timedOut=false;
  proc.stderr.on('data',()=>{}); // never echo provider errors, prompts or reasoning
  proc.stdout.setEncoding('utf8');proc.stdout.on('data',data=>{
   bytes+=Buffer.byteLength(data);if(bytes>8_000_000){errorCode='OUTPUT_LIMIT';kill(proc);return;}
   buffered+=data;let i;
   while((i=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,i);buffered=buffered.slice(i+1);try{
    const event=JSON.parse(line);
    if(event.type==='turn.completed'&&event.usage){usage.inputTokens=event.usage.input_tokens??null;usage.outputTokens=event.usage.output_tokens??null;}
    if(event.type==='item.started'||event.type==='item.completed'){
     if(['command_execution','mcp_tool_call','web_search','file_change'].includes(event.item?.type)){toolSeen=true;errorCode='UNEXPECTED_TOOL';kill(proc);}
    }
   }catch{}}
   if(buffered.length>2_000_000){errorCode='OUTPUT_LIMIT';kill(proc);}
  });
  proc.stdin.on('error',()=>{});proc.stdin.end(prompt);
  timer=setTimeout(()=>{timedOut=true;errorCode='TIMEOUT';kill(proc);},timeoutMs);
  const code=await new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('close',code=>resolve(code));});
  if(code!==0||toolSeen||timedOut)throw new Error('Codex call failed');
  const output=await readFile(outputFile,'utf8');if(Buffer.byteLength(output)>2_000_000)throw new Error('Codex result too large');
  errorCode='INVALID_MODEL_OUTPUT';const value=validateModelOutput(JSON.parse(output),schema);
  if(validate)await validate(value);
  const metadata=await completeCall(ledgerRoot,call.id,{status:'COMPLETED',...usage});
  return {value,metadata};
 }catch{
  await completeCall(ledgerRoot,call.id,{status:'FAILED',...usage,errorCode});
  throw new Error(`Codex invocation failed (${errorCode}); stopped ledger, no automatic replay`);
 }finally{clearTimeout(timer);kill(proc);process.removeListener('exit',cleanup);process.removeListener('SIGTERM',interrupted);process.removeListener('SIGINT',interrupted);await rm(directory,{recursive:true,force:true});}
}
