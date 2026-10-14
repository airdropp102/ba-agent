#!/usr/bin/env bun
/**
 * Local-safe TalkToFigma relay, derived from grab/cursor-talk-to-figma-mcp
 * src/socket.ts at ddd90f3a6d454ea0b2fc29f1b084f50fd062b880.
 * Protocol behavior is retained; bind address is loopback and payload logging is removed.
 */
import type {Server, ServerWebSocket} from 'bun';

type Client = ServerWebSocket<unknown>;
type Message = {type?:string;channel?:unknown;message?:unknown;id?:unknown};
const channels=new Map<string,Set<Client>>();
const open=(client:Client)=>client.readyState===WebSocket.OPEN;
const send=(client:Client,message:unknown)=>{if(open(client))client.send(JSON.stringify(message));};
function remove(client:Client){
 for(const [channel,members] of channels){
  if(!members.delete(client))continue;
  for(const peer of members)send(peer,{type:'system',message:'A user has left the channel',channel});
  if(members.size===0)channels.delete(channel);
 }
}
function handleMessage(client:Client,raw:string|Buffer){
 let data:Message;
 try{data=JSON.parse(String(raw)) as Message;}catch{return;}
 if(!data||typeof data!=='object'||typeof data.type!=='string')return;
 if(data.type==='join'){
  const channel=typeof data.channel==='string'?data.channel:'';
  if(!channel){send(client,{type:'error',message:'Channel name is required'});return;}
  let members=channels.get(channel);if(!members){members=new Set();channels.set(channel,members);}
  members.add(client);
  send(client,{type:'system',message:`Joined channel: ${channel}`,channel});
  send(client,{type:'system',message:{id:data.id,result:'Connected to channel: '+channel},channel});
  for(const peer of members)if(peer!==client)send(peer,{type:'system',message:'A new user has joined the channel',channel});
  return;
 }
 if(data.type==='message'){
  const channel=typeof data.channel==='string'?data.channel:'';
  if(!channel){send(client,{type:'error',message:'Channel name is required'});return;}
  const members=channels.get(channel);
  if(!members?.has(client)){send(client,{type:'error',message:'You must join the channel first'});return;}
  for(const peer of members)if(peer!==client)send(peer,{type:'broadcast',message:data.message,sender:'peer',channel});
  return;
 }
 if(data.type==='progress_update'){
  const channel=typeof data.channel==='string'?data.channel:'';
  const members=channels.get(channel);if(!members?.has(client))return;
  for(const peer of members)if(peer!==client)send(peer,data);
 }
}
const server=Bun.serve({
 hostname:'127.0.0.1',
 port:Number(Bun.env.FIGMA_RELAY_PORT||3055),
 fetch(req:Request,server:Server){
  if(req.method==='OPTIONS')return new Response(null,{headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}});
  if(server.upgrade(req,{headers:{'Access-Control-Allow-Origin':'*'}}))return;
  return new Response('WebSocket server running',{headers:{'Access-Control-Allow-Origin':'*'}});
 },
 websocket:{
  open(client:Client){send(client,{type:'system',message:'Please join a channel to start chatting'});},
  message:handleMessage,
  close:remove
 }
});
void server;
