import {spawn} from 'node:child_process';
import net from 'node:net';

const SAFE_HOST='127.0.0.1';
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function canConnect(host,port,timeout=120){
 return new Promise(resolve=>{
  const socket=net.connect({host,port});let done=false;
  const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value)};
  socket.setTimeout(timeout,()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));
 });
}

export function createFigmaRelayManager({bunExecutable=process.env.BUN_BIN,relayEntry,host=SAFE_HOST,port=3055,readyTimeoutMs=3000}={}){
 let state='STOPPED',child=null,errorCode=null,stopping=false;
 const status=()=>({state,host,port,errorCode});
 const fail=(code)=>{state='FAILED';errorCode=code;child=null;stopping=false;return status()};
 async function start(){
  if(state==='READY'||state==='STARTING')return status();
  if(host!==SAFE_HOST)return fail('LOOPBACK_ONLY');
  if(!bunExecutable||!relayEntry)return fail('RELAY_NOT_CONFIGURED');
  if(await canConnect(host,port))return fail('PORT_UNAVAILABLE');
  state='STARTING';errorCode=null;stopping=false;
  try{
   child=spawn(bunExecutable,[relayEntry],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,FIGMA_RELAY_HOST:host,FIGMA_RELAY_PORT:String(port)}});
   child.stdout?.resume();child.stderr?.resume();
   child.once('error',()=>{if(!stopping)fail('BUN_UNAVAILABLE')});
   child.once('exit',()=>{if(!stopping)fail('CHILD_EXIT')});
  }catch{return fail('BUN_UNAVAILABLE')}
  const until=Date.now()+readyTimeoutMs;
  while(Date.now()<until){
   if(state==='FAILED')return status();
   if(await canConnect(host,port)){state='READY';return status()}
   await delay(35);
  }
  await stopChild();return fail('START_TIMEOUT');
 }
 async function stopChild(){
  const current=child;if(!current){state='STOPPED';errorCode=null;return status()}
  stopping=true;state='STOPPING';
  const exited=new Promise(resolve=>{if(current.exitCode!==null||current.signalCode!==null)return resolve();current.once('exit',resolve);});
  current.kill('SIGTERM');
  await Promise.race([exited,delay(1000)]);
  if(current.exitCode===null&&current.signalCode===null){current.kill('SIGKILL');await Promise.race([exited,delay(500)]);}
  child=null;stopping=false;state='STOPPED';errorCode=null;return status();
 }
 async function stop(){return stopChild()}
 return {start,stop,status};
}
