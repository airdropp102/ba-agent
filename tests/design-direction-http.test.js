import {emptyBriefOptions,applyBriefPreset} from '../public/design-brief-options.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {ProductionStore} from '../src/production-store.js';
import {FigmaPreviewStore} from '../src/figma-preview-store.js';
import {completeFigmaDesign} from '../src/figma-design-review.js';
import {sampleTitle,sampleBrief,demoAnalysis,demoPrototype} from '../src/demo.js';
import {normalizeAnalysis,normalizePrototype} from '../src/normalize.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=';

test('HTTP design brief isolates project references and requires sample approval before full queue',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-design-direction-http-'));let server;
 try{
  const store=new ProductionStore(dir),id=randomUUID(),other=randomUUID(),analysis=normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief),now=new Date().toISOString();
  const p={id,title:'Synthetic visual direction',brief:sampleBrief,status:'GENERATED',version:4,analysis,prototype:normalizePrototype(demoPrototype(analysis),analysis),review:{approved:true,customerApproved:false},createdAt:now,updatedAt:now};store.save(p);store.save({...p,id:other});store.db.close();
  const fakeBun=path.join(dir,'fake-bun.cjs');await writeFile(fakeBun,'#!/usr/bin/env node\nrequire("node:net").createServer().listen(Number(process.env.FIGMA_RELAY_PORT),"127.0.0.1");\n',{mode:0o700});
  const port=50000+Math.floor(Math.random()*3000),base=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['src/server.js'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port),DATA_DIR:dir,DEMO_MODE:'true',BA_WORKER_ENABLED:'false',REQUIRE_IF_MATCH:'true',BUN_BIN:fakeBun,FIGMA_RELAY_PORT:String(port+3001)},stdio:'ignore'});
  const api=async(route,method='GET',data,version)=>{const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(version?{'If-Match':String(version)}:{})},body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,data:await response.json()}};
  let ready=false;for(let i=0;i<100;i++){try{if((await api('/api/status')).status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,50))}assert.ok(ready);
  const pluginPackage=await fetch(base+'/api/figma/asset-plugin.zip');assert.equal(pluginPackage.status,200);assert.equal(pluginPackage.headers.get('content-type'),'application/zip');assert.equal(Buffer.from(await pluginPackage.arrayBuffer()).readUInt32LE(0),0x04034b50);
  const route=`/api/projects/${id}`,uploaded=await api(route+'/files','POST',{filename:'mood.png',category:'reference',content:png,encoding:'base64'},4);assert.equal(uploaded.status,201);
  assert.equal((await fetch(base+route+'/files/'+uploaded.data.id+'/preview')).status,200);
  assert.equal((await fetch(base+`/api/projects/${other}/files/${uploaded.data.id}/preview`)).status,404);
  const direction={brief:{goals:'Clear hierarchy and calm surfaces'},sampleScreenId:'SCR-001',references:[{documentId:uploaded.data.id,caption:'Spacing and typography'}],library:[]};
  assert.equal((await api(`/api/projects/${other}/design-direction`,'POST',direction,4)).status,400);
  const saved=await api(route+'/design-direction','POST',direction,4);assert.equal(saved.status,200,JSON.stringify(saved.data));assert.equal(saved.data.version,5);
  assert.equal((await api(route+'/design-direction','POST',direction,4)).status,409);
  assert.equal((await api(route+'/design-direction','POST',direction,5)).data.version,5);
  assert.equal((await api('/api/figma/relay/start','POST',{})).status,200);
  const draw={fileUrl:'https://www.figma.com/design/fixture-file',channelId:'fixture-channel',platform:'mobile',fileIdentityConfirmed:true,visualInputsConfirmed:true};
  assert.equal((await api(route+'/figma-design','POST',{...draw,mode:'full'},5)).status,409);
  assert.equal((await api(route+'/figma-design','POST',{...draw,visualInputsConfirmed:false},5)).status,400);
  const queued=await api(route+'/figma-design','POST',draw,5);assert.equal(queued.status,202,JSON.stringify(queued.data));assert.equal(queued.data.figmaDesign.mode,'sample');assert.equal(queued.data.version,6);
  assert.equal((await api(route+'/design-direction','POST',{...direction,brief:{goals:'Changed'}},6)).status,400);
  // Simulate the worker boundary with a synthetic verified frame; no external tools/models.
  const worker=new ProductionStore(dir),job=worker.claimJob(),current=worker.get(id,{leaseToken:job.token});current.figmaDesign.state='DESIGNING';
  const files=await new FigmaPreviewStore(worker).write(id,{version:6,platform:'mobile',runId:current.figmaDesign.runId,previews:[{screenId:'SCR-001',contentType:'image/png',base64:png}]});
  const draft=completeFigmaDesign(current,{runId:current.figmaDesign.runId,projectVersion:6,manifestDigest:'a'.repeat(64),screens:[{screenId:'SCR-001',nodeId:'10:1',verified:true,requirementIds:p.prototype.screens[0].requirementIds}],previewFiles:files});draft.version=7;draft.figmaDesign.projectVersion=7;draft.figmaDesign.draft.projectVersion=7;worker.attach(draft,current._dbRevision,job.token);worker.save(draft);worker.finishJob(job.id,job.token,{resultVersion:7});worker.db.close();
  assert.equal((await fetch(base+route+'/figma-design/previews/SCR-001')).status,200);assert.equal((await fetch(base+route+'/figma-design/previews/SCR-002')).status,404);
  const approval={decision:'APPROVE',notes:'Synthetic visual review',projectVersion:7,manifestDigest:'a'.repeat(64)};
  assert.equal((await api(route+'/figma-design/review','POST',{...approval,projectVersion:6},7)).status,409);
  const approved=await api(route+'/figma-design/review','POST',approval,7);assert.equal(approved.status,200,JSON.stringify(approved.data));assert.equal(approved.data.figmaDesign.state,'SAMPLE_APPROVED');assert.equal(approved.data.figmaDesign.approved,null);
  const check=new ProductionStore(dir);assert.equal(check.jobs(id).length,1);assert.equal(check.get(id).review.customerApproved,false);check.db.close();
  assert.equal((await api(route+'/figma-design','POST',{...draw,mode:'full',platform:'web'},8)).status,409);
  const full=await api(route+'/figma-design','POST',draw,8);assert.equal(full.status,202,JSON.stringify(full.data));assert.equal(full.data.figmaDesign.mode,'full');
  const options=applyBriefPreset(emptyBriefOptions(),'modern-saas'),otherRoute=`/api/projects/${other}/design-direction`;const selected=await api(otherRoute,'POST',{briefOptions:options,sampleScreenId:'SCR-001',references:[],library:[]},4);assert.equal(selected.status,200,JSON.stringify(selected.data));assert.equal(selected.data.designDirection.briefOptions.style,'modern-saas');assert.match(selected.data.designDirection.brief.style,/Modern SaaS/);assert.equal((await api(otherRoute,'POST',{briefOptions:{...options,style:'invented'},sampleScreenId:'SCR-001',references:[],library:[]},5)).status,400);
  const same=await api(otherRoute,'POST',{briefOptions:selected.data.designDirection.briefOptions,sampleScreenId:'SCR-001',references:[],library:[]},5);assert.equal(same.data.version,5);
 }finally{if(server&&server.exitCode===null){const done=new Promise(r=>server.once('exit',r));server.kill('SIGTERM');await done}await rm(dir,{recursive:true,force:true})}
});
