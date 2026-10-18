import test from 'node:test';
import assert from 'node:assert/strict';
import {figmaAssetCommand} from '../src/figma-assets.js';
function peer({error=false,malformed=false}={}){
 const commands=[];
 class Socket extends EventTarget{
  constructor(url){super();assert.equal(url,'ws://127.0.0.1:3055');queueMicrotask(()=>this.dispatchEvent(new Event('open')))}
  send(raw){const data=JSON.parse(raw);commands.push(data);const reply=data.type==='join'?{type:'system',channel:data.channel,message:{result:'joined'}}:{type:'broadcast',channel:data.channel,message:{id:data.message.id,...(error?{error:'Unsupported command'}:{result:{protocol:'ba.assets.v1',documentKey:'fixture-file'}})}};
   queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:malformed&&data.type!=='join'?'{bad':JSON.stringify(reply)})));
  }
  close(){this.dispatchEvent(new Event('close'))}
 }
 return {Socket,commands};
}
test('asset relay joins the scoped channel and correlates only the explicit bounded command',async()=>{
 const {Socket,commands}=peer();const result=await figmaAssetCommand({channelId:'fixture-channel',command:'ba_asset_capabilities',params:{runId:'fixture-run'},WebSocketImpl:Socket});assert.equal(result.protocol,'ba.assets.v1');assert.equal(commands.length,2);assert.equal(commands[1].message.command,'ba_asset_capabilities');assert.equal(commands[1].message.params.runId,'fixture-run');
 await assert.rejects(figmaAssetCommand({channelId:'fixture-channel',command:'delete_node'}),/scope/);
 await assert.rejects(figmaAssetCommand({channelId:'../unsafe',command:'ba_import_asset'}),/scope/);
});
test('old or malformed plugin responses fail without any fallback mutation',async()=>{
 for(const options of [{error:true},{malformed:true}]){const {Socket,commands}=peer(options);await assert.rejects(figmaAssetCommand({channelId:'fixture-channel',command:'ba_asset_capabilities',WebSocketImpl:Socket}),e=>e.code==='ASSET_PLUGIN_REQUIRED');assert.equal(commands.length,2);assert.equal(commands.some(c=>c.message?.command==='ba_import_asset'),false)}
});
