import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import net from 'node:net';
import {createFigmaRelayManager} from '../src/figma-relay.js';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'figma-relay-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const relay=join(dir,'relay-fixture.mjs');
 await writeFile(relay,`import net from 'node:net';
const server=net.createServer();
server.listen(Number(process.env.FIGMA_RELAY_PORT),process.env.FIGMA_RELAY_HOST);
server.on('connection',socket=>{socket.on('data',()=>{});});
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`);
 return {dir,relay,manager:(port)=>createFigmaRelayManager({bunExecutable:process.execPath,relayEntry:relay,host:'127.0.0.1',port})};
}
async function waitFor(predicate,timeout=2000){
 const end=Date.now()+timeout;
 while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,20));}
 throw new Error('condition timed out');
}
function freePort(){return new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});}

test('relay starts on loopback, repeated start reuses one child, and stop is idempotent',async t=>{
 const {manager,relay}=await fixture(t),port=await freePort(),m=manager(port);
 assert.deepEqual(m.status(),{state:'STOPPED',host:'127.0.0.1',port,errorCode:null});
 assert.equal((await m.start()).state,'READY');
 assert.equal((await m.start()).state,'READY');
 const socket=net.connect(port,'127.0.0.1');await once(socket,'connect');socket.destroy();
 assert.equal((await m.stop()).state,'STOPPED');
 assert.equal((await m.stop()).state,'STOPPED');
 assert.equal(relay.endsWith('relay-fixture.mjs'),true);
});

test('relay child exit updates status without exposing child output',async t=>{
 const {manager,relay,dir}=await fixture(t),port=await freePort();
 await writeFile(relay,`console.log('PRIVATE_CHANNEL_PAYLOAD');setTimeout(()=>process.exit(7),80);`);
 const m=manager(port);await m.start();
 await waitFor(()=>m.status().state==='FAILED');
 assert.equal(m.status().errorCode,'CHILD_EXIT');
 assert.equal('output' in m.status(),false);
 assert.doesNotMatch(JSON.stringify(m.status()),/PRIVATE_CHANNEL_PAYLOAD/);
 assert.equal(dir.length>0,true);
});

test('occupied port fails closed with a safe status code',async t=>{
 const occupied=net.createServer();occupied.listen(0,'127.0.0.1');await once(occupied,'listening');
 t.after(()=>occupied.close());
 const {manager}=await fixture(t),m=manager(occupied.address().port);
 const status=await m.start();
 assert.equal(status.state,'FAILED');
 assert.equal(status.errorCode,'PORT_UNAVAILABLE');
 assert.equal('output' in status,false);
});

test('relay rejects a non-loopback host before spawning',async t=>{
 const {dir,relay}=await fixture(t);
 const m=createFigmaRelayManager({bunExecutable:process.execPath,relayEntry:relay,host:'0.0.0.0',port:3055});
 assert.equal((await m.start()).errorCode,'LOOPBACK_ONLY');
 assert.equal(m.status().state,'FAILED');
});

test('vendored websocket relay is loopback-only and contains no payload logging',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../vendor/talk-to-figma-relay/socket.ts',import.meta.url),'utf8');
 assert.match(source,/hostname:\s*["']127\.0\.0\.1["']/);
 assert.doesNotMatch(source,/console\.(log|error|warn)\s*\(/);
 assert.match(source,/data\.type\s*===\s*["']join["']/);
 assert.match(source,/data\.type\s*===\s*["']message["']/);
 assert.match(source,/data\.type\s*===\s*["']progress_update["']/);
});
