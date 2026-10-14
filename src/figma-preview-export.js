import {randomUUID} from 'node:crypto';

/** Read-only export using the pinned local TalkToFigma relay protocol. Image bytes never pass through a model. */
export async function exportFigmaPreview({channelId,nodeId,screenId,port=3055,timeoutMs=30000,WebSocketImpl=WebSocket}={}){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(channelId||'')||!/^\d+:\d+$/.test(nodeId||'')||!/^SCR-[A-Za-z0-9_-]{1,80}$/.test(screenId||'')||!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid Figma preview export scope');
 const id=randomUUID();
 return new Promise((resolve,reject)=>{
  const socket=new WebSocketImpl(`ws://127.0.0.1:${port}`);let settled=false,sent=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);socket.close();error?reject(Object.assign(new Error(error),{code:'PREVIEW_EXPORT_FAILED'})):resolve(value)};
  const timer=setTimeout(()=>finish('Figma preview export timed out; check the connected plugin'),timeoutMs);
  socket.addEventListener('open',()=>socket.send(JSON.stringify({type:'join',channel:channelId})));
  socket.addEventListener('error',()=>finish('Figma preview socket connection failed'));
  socket.addEventListener('close',()=>{if(!settled)finish('Figma preview socket closed before export completed')});
  socket.addEventListener('message',event=>{
   if(settled)return;
   if(typeof event.data!=='string'||event.data.length>12*1024*1024)return finish('Figma preview response exceeds the byte limit');
   let data;try{data=JSON.parse(event.data)}catch{return finish('Invalid Figma preview socket response')}
   if(data.channel!==channelId)return;
   if(data.type==='system'&&!sent&&data.message?.result){
    sent=true;socket.send(JSON.stringify({type:'message',channel:channelId,message:{id,command:'export_node_as_image',params:{nodeId,format:'PNG',scale:1,commandId:id}}}));return;
   }
   if(data.type!=='broadcast'||data.message?.id!==id)return;
   if(data.message.error)return finish('Figma plugin could not export the requested frame');
   const result=data.message.result;
   if(result?.nodeId!==nodeId||!['image/png','image/jpeg'].includes(result.mimeType)||typeof result.imageData!=='string')return finish('Invalid Figma preview identity or image type');
   finish(null,{screenId,contentType:result.mimeType,base64:result.imageData});
  });
 });
}
