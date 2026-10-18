import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const html=await readFile(new URL('../vendor/ba-talk-to-figma-plugin/ui.html',import.meta.url),'utf8');
function fixture(){
 const sockets=[],timers=new Map();let timerId=0;
 const node=()=>({textContent:'',className:'',disabled:false,children:[],append(n){this.children.push(n)}});
 const status=node(),button=node(),port=node(),config=node();
 class Socket {
  constructor(url){this.url=url;this.sent=[];sockets.push(this)}
  send(raw){this.sent.push(JSON.parse(raw))}
  close(){this.closed=true;this.onclose?.({code:1000})}
  open(){this.onopen()}
  ack(){this.onmessage({data:JSON.stringify({type:'system',channel:this.sent[0].channel,message:{result:'Connected'}})})}
 }
 const ctx=vm.createContext({WebSocket:Socket,connectionStatus:status,connectButton:button,portInput:port,document:{createElement:node,querySelectorAll:()=>[],getElementById:id=>({'connection-status':status,'btn-connect':button,port}[id]||config)},setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),parent:{postMessage(){}},updateMcpConfig(){},generateChannelName:()=>`fixture-${sockets.length}`,handleSocketMessage(){},console});
 vm.runInContext(html.slice(html.indexOf('// WebSocket connection state'),html.indexOf('// Handle messages from the WebSocket')),ctx);
 return {sockets,timers,status,button,port,connect:p=>vm.runInContext(`connectToServer(${p})`,ctx),disconnect:()=>vm.runInContext('disconnectFromServer()',ctx),state:()=>vm.runInContext('({connected:state.connected,connecting:state.connecting,channel:state.channel})',ctx)};
}
test('plugin is connected only after matching relay channel acknowledgement and repeated starts reuse attempt',()=>{
 const f=fixture();f.connect(3055);f.connect(3055);assert.equal(f.sockets.length,1);assert.equal(f.button.textContent,'Cancel');assert.equal(f.port.disabled,true);const s=f.sockets[0];assert.equal(s.url,'ws://localhost:3055');s.open();assert.equal(f.state().connected,false);
 s.onmessage({data:JSON.stringify({type:'system',channel:'wrong',message:{result:'Connected'}})});assert.equal(f.state().connected,false);s.ack();assert.equal(f.state().connected,true);assert.equal(f.timers.size,0);f.connect(3055);assert.equal(f.sockets.length,1);assert.equal(f.button.textContent,'Disconnect');
});
test('failed connection retains actionable diagnosis and supports retry despite late close events',()=>{
 const f=fixture();f.connect(3055);const old=f.sockets[0];old.onerror();assert.match(f.status.textContent,/ws:\/\/localhost:3055/);assert.match(f.status.textContent,/Start socket/);assert.match(f.status.textContent,/Local Network Access/);assert.equal(f.button.textContent,'Connect');assert.equal(f.port.disabled,false);assert.equal(f.timers.size,0);
 f.connect(3055);const next=f.sockets[1];next.open();next.ack();old.onclose({code:1006});old.onerror();assert.equal(f.state().connected,true);assert.equal(f.state().channel,next.sent[0].channel);
});
test('missing relay acknowledgement times out and closing/cancelling releases the attempt',()=>{
 const f=fixture();f.connect(3055);const s=f.sockets[0];s.open();[...f.timers.values()][0]();assert.match(f.status.textContent,/Hết thời gian/);assert.equal(s.closed,true);assert.equal(f.state().connecting,false);assert.equal(f.state().connected,false);f.connect(3055);f.disconnect();assert.equal(f.sockets[1].closed,true);assert.equal(f.port.disabled,false);assert.equal(f.timers.size,0);
});
test('relay error text stays literal, invalid ports never create sockets, and auto-connect never toggles disconnect',()=>{
 const f=fixture();for(const port of [0,65536,3055.5,'NaN'])f.connect(port);assert.equal(f.sockets.length,0);f.connect(3055);f.sockets[0].onmessage({data:JSON.stringify({type:'error',message:'<img src=x onerror=alert(1)>'})});assert.match(f.status.textContent,/<img src=x/);assert.match(html,/case "auto-connect":\s*connectToServer\(Number\(portInput.value\)\)/);assert.match(html,/case "auto-disconnect":\s*disconnectFromServer\(\)/);
});

test('complete plugin UI boots without injected control globals and registers Connect before use',()=>{
 const nodes=new Map(),sockets=[];
 const node=()=>({value:'3055',handlers:{},classList:{add(){},remove(){}},addEventListener(type,fn){this.handlers[type]=fn},append(){},style:{}});
 const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)};
 const ctx=vm.createContext({document:{getElementById:get,querySelectorAll:()=>[],createElement:node},window:{},parent:{postMessage(){}},WebSocket:class{constructor(url){this.url=url;sockets.push(this)}close(){}},setTimeout:()=>1,clearTimeout(){},console});
 const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];assert.doesNotThrow(()=>vm.runInContext(script,ctx));assert.equal(typeof get('btn-connect').handlers.click,'function');get('btn-connect').handlers.click();assert.equal(sockets.length,1);assert.equal(sockets[0].url,'ws://localhost:3055');assert.equal(get('btn-connect').textContent,'Cancel');
});
