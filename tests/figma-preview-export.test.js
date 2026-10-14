import test from 'node:test';
import assert from 'node:assert/strict';
import {exportFigmaPreview} from '../src/figma-preview-export.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=';
function fixtureSocket(transform=result=>result){
 const commands=[];
 class Socket extends EventTarget{
  constructor(url){super();assert.equal(url,'ws://127.0.0.1:3055');queueMicrotask(()=>this.dispatchEvent(new Event('open')))}
  send(raw){const data=JSON.parse(raw);commands.push(data);
   const reply=data.type==='join'?{type:'system',channel:data.channel,message:{result:'joined'}}:{type:'broadcast',channel:data.channel,message:{id:data.message.id,result:transform({nodeId:data.message.params.nodeId,mimeType:'image/png',imageData:png})}};
   queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(reply)})));
  }
  close(){this.dispatchEvent(new Event('close'))}
 }
 return {Socket,commands};
}
test('preview export reads original plugin PNG without model copying and exposes only join/export commands',async()=>{
 const {Socket,commands}=fixtureSocket();
 const image=await exportFigmaPreview({channelId:'fixture-channel',nodeId:'1:2',screenId:'SCR-001',WebSocketImpl:Socket});
 assert.deepEqual(image,{screenId:'SCR-001',contentType:'image/png',base64:png});
 assert.equal(commands.length,2);assert.equal(commands[0].type,'join');
 assert.equal(commands[1].message.command,'export_node_as_image');assert.equal(commands[1].message.params.nodeId,'1:2');
});
test('preview export rejects a wrong node, unsupported type and invalid channel before storage',async()=>{
 for(const change of [r=>({...r,nodeId:'9:9'}),r=>({...r,mimeType:'text/html'}),r=>({...r,imageData:undefined})]){
  const {Socket}=fixtureSocket(change);await assert.rejects(exportFigmaPreview({channelId:'fixture-channel',nodeId:'1:2',screenId:'SCR-001',WebSocketImpl:Socket}),/Invalid Figma preview identity/);
 }
 await assert.rejects(exportFigmaPreview({channelId:'../unsafe',nodeId:'1:2',screenId:'SCR-001'}),/Invalid Figma preview export scope/);
});
