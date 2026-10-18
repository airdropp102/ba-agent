import {randomUUID} from 'node:crypto';
const fail=(message,code='ASSET_IMPORT_FAILED')=>Object.assign(new Error(message),{code});
export async function figmaAssetCommand({channelId,command,params={},port=3055,timeoutMs=30000,WebSocketImpl=WebSocket}={}){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(channelId||'')||!['ba_asset_capabilities','ba_import_asset','ba_verify_asset','ba_close_asset_run'].includes(command)||!Number.isInteger(port)||port<1||port>65535)throw fail('Invalid asset relay scope');
 const id=randomUUID();return new Promise((resolve,reject)=>{
  const socket=new WebSocketImpl(`ws://127.0.0.1:${port}`);let done=false,sent=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);socket.close();error?reject(fail(error,command==='ba_asset_capabilities'?'ASSET_PLUGIN_REQUIRED':'ASSET_IMPORT_FAILED')):resolve(value)};
  const timer=setTimeout(()=>finish('Asset plugin timed out; open BA Studio TalkToFigma + Assets'),timeoutMs);timer.unref();
  socket.addEventListener('open',()=>socket.send(JSON.stringify({type:'join',channel:channelId})));socket.addEventListener('error',()=>finish('Asset relay connection failed'));socket.addEventListener('close',()=>{if(!done)finish('Asset relay closed before completion')});
  socket.addEventListener('message',event=>{
   if(done)return;if(typeof event.data!=='string'||event.data.length>100000)return finish('Invalid asset relay response size');let data;try{data=JSON.parse(event.data)}catch{return finish('Invalid asset relay response')}
   if(data.channel!==channelId)return;
   if(data.type==='system'&&!sent&&data.message?.result){sent=true;socket.send(JSON.stringify({type:'message',channel:channelId,message:{id,command,params}}));return}
   if(data.type!=='broadcast'||data.message?.id!==id)return;if(data.message.error)return finish('Asset plugin command failed; check the installed extension');finish(null,data.message.result);
  });
 });
}
export function createFigmaAssetImporter({channelId,documentKey,runId,store,projectId,port=3055,command=figmaAssetCommand}={}){
 const call=(name,params)=>command({channelId,port,command:name,params:{runId,...params}});
 return {
  async capabilities(){const result=await call('ba_asset_capabilities');if(result?.protocol!=='ba.assets.v1')throw fail('Install the BA Studio asset plugin in the confirmed Figma file','ASSET_PLUGIN_REQUIRED');if(result.documentKey&&result.documentKey!==documentKey)throw fail('Asset plugin is connected to a different document','DOCUMENT_MISMATCH');return result},
  async import({assets,slots,screens}){
   const expected=new Map(assets.flatMap(asset=>asset.screenIds.map(screenId=>[asset.id+':'+screenId,{asset,screenId}]))),seen=new Set(),slotIds=new Set();
   if(!Array.isArray(slots)||slots.length!==expected.size)throw fail('Missing asset slot coverage');
   const prepared=[];
   for(const slot of slots){const match=expected.get(slot?.assetId+':'+slot?.screenId),screen=screens.find(s=>s.screenId===slot?.screenId);if(!match||!screen||seen.has(slot.assetId+':'+slot.screenId)||slotIds.has(slot.nodeId)||!/^\d+:\d+$/.test(slot.nodeId||''))throw fail('Invalid asset slot scope');seen.add(slot.assetId+':'+slot.screenId);slotIds.add(slot.nodeId);const file=await store.read(projectId,slot.assetId);if(file.asset.sha256!==match.asset.sha256)throw fail('Asset checksum changed before import');prepared.push({match,slot,screen,file})}
   const evidence=[];
   for(const {match,slot,screen,file} of prepared){
    const params={assetId:slot.assetId,sha256:file.asset.sha256,screenId:slot.screenId,screenNodeId:screen.nodeId,slotNodeId:slot.nodeId,contentType:file.asset.contentType,kind:match.asset.kind};
    const result=await call('ba_import_asset',{...params,data:file.bytes.toString(file.asset.contentType==='image/svg+xml'?'utf8':'base64')});
    const verify=await call('ba_verify_asset',params);
    if(result?.protocol!=='ba.assets.v1'||verify?.protocol!=='ba.assets.v1'||result.assetId!==slot.assetId||verify.assetId!==slot.assetId||verify.sha256!==file.asset.sha256||verify.screenId!==slot.screenId||verify.verified!==true||verify.nodeId!==result.nodeId||!/^\d+:\d+$/.test(verify.nodeId||''))throw fail('Asset insertion read-back rejected');
    evidence.push({...verify,runId,source:'PLUGIN_ASSET_READBACK_NOT_INDEPENDENT_ATTESTATION'});
   }
   const closed=await call('ba_close_asset_run',{screenNodeIds:[...new Set(prepared.map(x=>x.screen.nodeId))]});if(closed?.closed!==true||closed.runId!==runId)throw fail('Could not close asset import run');return evidence;
  }
 };
}
