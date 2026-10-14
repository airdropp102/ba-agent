import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {validateModelOutput} from './model-output.js';
import {logExecution} from './execution-log.js';

export function codexTimeoutMs(value){
 const n=Number(value);return Math.min(Math.max(100,Number.isFinite(n)&&n>0?n:300000),600000);
}
const active=new Set();
function terminate(proc){
 if(!proc.pid)return;
 try{if(process.platform!=='win32')process.kill(-proc.pid,'SIGKILL');else proc.kill('SIGKILL');}catch{try{proc.kill('SIGKILL')}catch{}}
}
process.once('exit',()=>{for(const proc of active)terminate(proc);});
for(const signal of ['SIGTERM','SIGINT']){
 const handle=()=>{
  for(const proc of active){logExecution('CLI_SHUTDOWN',{pid:proc.pid,errorCode:signal});terminate(proc);}
  // Preserve the application's handlers; otherwise restore normal signal termination.
  if(process.listenerCount(signal)===1){process.removeListener(signal,handle);process.kill(process.pid,signal);}
 };
 process.on(signal,handle);
}

/** Default calls use an isolated temp directory; explicit operators may supply a reviewed pack directory. */
export async function runCodexStructured(prompt,schema,{bin=process.env.CODEX_BIN||'codex',timeoutMs=process.env.CODEX_TIMEOUT_MS,heartbeatMs=15000,model=process.env.CODEX_MODEL,workingDirectory,maxOutputBytes=2_000_000}={}) {
 const ms=codexTimeoutMs(timeoutMs),started=Date.now();
 if(!Number.isSafeInteger(maxOutputBytes)||maxOutputBytes<1||maxOutputBytes>8*1024*1024)throw new Error('Invalid Codex output byte limit (maximum 8 MiB)');
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-codex-'));
 const schemaFile=path.join(dir,'schema.json'),outputFile=path.join(dir,'result.json');
 let proc,timeout,heartbeat,timedOut=false,stdoutBytes=0,stderrBytes=0,phase='CLI_START',stdoutLine='';
 const progress=(event,extra={})=>logExecution(event,{elapsedMs:Date.now()-started,timeoutMs:ms,pid:proc?.pid,stdoutBytes,stderrBytes,...extra});
 try{
  const cwd=workingDirectory===undefined?dir:await realpath(workingDirectory);
  const schemaText=JSON.stringify(schema);await writeFile(schemaFile,schemaText,{mode:0o600});
  const args=['exec','--json','--sandbox','read-only','--skip-git-repo-check','--output-schema',schemaFile,'--output-last-message',outputFile,'-'];
  if(model){if(!/^[\w.:-]{1,100}$/.test(model))throw new Error('Invalid CODEX_MODEL');args.splice(1,0,'--model',model);}
  proc=spawn(bin,args,{cwd,env:process.env,stdio:['pipe','pipe','pipe'],shell:false,detached:process.platform!=='win32'});active.add(proc);
  progress('CLI_START',{model:model||'codex-cli',promptBytes:Buffer.byteLength(prompt),schemaBytes:Buffer.byteLength(schemaText)});
  // Only count stderr: it can echo customer prompts, model reasoning, tokens or provider errors.
  proc.stderr.on('data',data=>{stderrBytes+=data.length;});
  let discardLine=false;
  proc.stdout.on('data',data=>{
   stdoutBytes+=data.length;
   for(const segment of data.toString().split(/(?<=\n)/)){
    if(!discardLine)stdoutLine+=segment;
    if(stdoutLine.length>65536){stdoutLine='';discardLine=true;}
    if(!segment.endsWith('\n'))continue;
    if(!discardLine){try{
     const event=JSON.parse(stdoutLine);
     if(['thread.started','turn.started','turn.completed','turn.failed'].includes(event.type))progress('CLI_EVENT',{cliEvent:event.type});
     if(['item.started','item.completed'].includes(event.type)&&['command_execution','mcp_tool_call','web_search','agent_message'].includes(event.item?.type))progress('CLI_EVENT',{cliEvent:event.type,itemType:event.item.type});
    }catch{}}
    stdoutLine='';discardLine=false;
   }
  });
  proc.stdin.on('error',()=>{});proc.stdin.end(prompt);
  phase='CLI_WAITING';
  heartbeat=setInterval(()=>progress('CLI_WAITING'),Math.max(10,Number(heartbeatMs)||15000));heartbeat.unref();
  timeout=setTimeout(()=>{timedOut=true;progress('CLI_TIMEOUT');terminate(proc);},ms);
  const exitCode=await new Promise((resolve,reject)=>{proc.once('error',reject);proc.once('close',(code,signal)=>resolve(code??(signal?1:0)));});
  clearTimeout(timeout);clearInterval(heartbeat);progress('CLI_EXIT',{exitCode});
  if(timedOut)throw Object.assign(new Error(`Codex CLI timeout: vượt thời hạn xử lý ${Math.round(ms/1000)} giây; đã dừng nhóm process CLI. Thử lại hoặc tăng CODEX_TIMEOUT_MS (tối đa 600000).`),{status:504});
  if(exitCode!==0)throw Object.assign(new Error(`Codex CLI thất bại (exit ${exitCode}). Kiểm tra codex login status, model và hạn mức.`),{status:502});
  phase='OUTPUT_READ';const content=await readFile(outputFile,'utf8');progress('OUTPUT_READ',{outputBytes:Buffer.byteLength(content)});
  if(Buffer.byteLength(content)>maxOutputBytes)throw new Error(maxOutputBytes===2_000_000?'Codex output vượt 2 MB':`Codex output exceeds ${maxOutputBytes} bytes`);
  phase='JSON_VALIDATE';progress('JSON_VALIDATE');let value;
  try{value=JSON.parse(content);}catch{throw Object.assign(new Error('Codex output JSON không hợp lệ.'),{status:502});}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Codex output không phải JSON object');
  let valid;try{valid=validateModelOutput(value,schema,{maxBytes:maxOutputBytes,maxStringLength:maxOutputBytes});}catch{throw Object.assign(new Error('Codex output schema validation failed.'),{status:502});}
  progress('OUTPUT_VALIDATED');return valid;
 }catch(e){progress('CLI_ERROR',{errorCode:timedOut?'TIMEOUT':e?.code==='ENOENT'?'CLI_OR_OUTPUT_MISSING':phase==='JSON_VALIDATE'?'INVALID_MODEL_OUTPUT':'CLI_FAILED'});throw e;}
 finally{
  clearTimeout(timeout);clearInterval(heartbeat);
  if(proc){active.delete(proc);terminate(proc);}await rm(dir,{recursive:true,force:true});
 }
}
