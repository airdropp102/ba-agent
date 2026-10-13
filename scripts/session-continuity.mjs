#!/usr/bin/env node
/** Operator CLI for durable task session continuity. JSON input is never sent to an AI provider. */
import {readFile,mkdir,readlink} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ProductionStore} from '../src/production-store.js';
import {SessionContinuity} from '../src/session-continuity.js';
const root=resolve(process.env.BA_CONTINUITY_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'..'));
const envFile=join(root,'.env');
if(existsSync(envFile))for(const line of readFileSync(envFile,'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');
}
const args=process.argv.slice(2),cmd=args[0]||'bootstrap';
const option=name=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:null};
const raw=async()=>option('file')?JSON.parse(await readFile(resolve(process.cwd(),option('file')),'utf8')):{};
const dataDir=resolve(process.env.DATA_DIR||join(root,'data'));
await mkdir(dataDir,{recursive:true,mode:0o700});
const store=new ProductionStore(dataDir),svc=new SessionContinuity(store.db,{root,dataDir});
try{
  const input=await raw(),taskId=input.taskId||option('task'),sessionId=input.sessionId||option('session');
  const projectId=input.projectId||option('project')||undefined;
  let result;
  if(cmd==='new')result=svc.createTask({title:input.title||option('title'),scope:input.scope||option('scope')||'engineering',projectId:projectId||null,runtime:input.runtime||option('runtime')||'codex',externalSessionId:input.externalSessionId||null});
  else if(cmd==='bootstrap')result=await svc.bootstrap({projectId});
  else if(cmd==='list')result=svc.list({projectId});
  else if(cmd==='status')result=await svc.inspect(taskId);
  else if(cmd==='history')result=svc.history(taskId);
  else if(cmd==='resume')result=await svc.resume({...input,taskId,runtime:input.runtime||option('runtime')||'codex',expectedVersion:input.expectedVersion??Number(option('version'))});
  else if(cmd==='checkpoint')result=await svc.checkpoint({...input,taskId,sessionId,expectedVersion:input.expectedVersion??Number(option('version'))});
  else if(cmd==='finish')result=await svc.finish({taskId,sessionId,expectedVersion:input.expectedVersion??Number(option('version')),confirm:input.confirm===true||args.includes('--confirm')});
  else if(cmd==='verify')result=await svc.inspect(taskId);
  else if(cmd==='handoff')result=await svc.export(taskId);
  else if(cmd==='context'){
    const {usedTokens,maxTokens}=input;
    if(!Number.isSafeInteger(usedTokens)||!Number.isSafeInteger(maxTokens)||maxTokens<=0||usedTokens<0)throw Error('Require usedTokens and maxTokens as integers');
    const fraction=usedTokens/maxTokens;
    result={fraction,level:fraction>=0.85?'HANDOFF_NOW':fraction>=0.7?'CHECKPOINT_NOW':'NORMAL',source:'operator-provided token counts, not measured by runtime'};
    if(fraction>=0.7&&taskId)result.handoff=await svc.export(taskId);
  }
  else throw Error('Unknown command. Use: bootstrap, new, list, status, checkpoint, resume, handoff, verify, history, finish, context');
  if(['new','resume','checkpoint','finish'].includes(cmd)){
    const id=result.task.id;
    try{result.export=await svc.export(id)}catch(e){result.warning='Committed to SQLite but handoff export failed: '+e.message}
  }
  console.log(JSON.stringify(result,null,2));
  if((cmd==='bootstrap'&&result.recommendation==='RECONCILE')||(cmd==='verify'&&result.decision==='RECONCILE'))process.exitCode=2;
}catch(e){console.error(JSON.stringify({error:e.message,status:e.status||500}));process.exitCode=1;
}finally{store.db.close()}
