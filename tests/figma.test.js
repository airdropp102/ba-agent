import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleTitle,sampleBrief,demoAnalysis,demoPrototype} from '../src/demo.js';
import {normalizeAnalysis,normalizePrototype} from '../src/normalize.js';
import {buildFigmaHandoff,renderFigmaInstructions} from '../src/figma-handoff.js';
import {publishFigmaDesign} from '../src/figma-publisher.js';

const fixture=()=>{
  const analysis=normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief);
  return {id:'11111111-1111-4111-8111-111111111111',title:sampleTitle,brief:sampleBrief,
    status:'GENERATED',version:4,analysis,review:{approved:true,notes:'DRAFT checked',reviewedAt:'2026-10-13T00:00:00.000Z'},
    prototype:normalizePrototype(demoPrototype(analysis),analysis)};
};

test('Figma handoff requires BA review and at least one analyzed FR',()=>{
  const p=fixture();p.review=null;
  assert.throws(()=>buildFigmaHandoff(p),/review/i);
  p.review={approved:true};p.prototype=null;p.analysis.functionalRequirements=[];
  assert.throws(()=>buildFigmaHandoff(p),/functional requirement/i);
});

test('Figma design pack keeps IDs, navigation, and provenance statuses consistent',()=>{
  const handoff=buildFigmaHandoff(fixture(),{platform:'web'});
  assert.equal(handoff.manifest.schemaVersion,'ba.figma.v1');
  assert.equal(handoff.manifest.project.version,4);
  assert.equal(handoff.manifest.review.customerApproved,false);
  assert.equal(handoff.manifest.screens.length,3);
  assert.equal(handoff.manifest.screens[0].id,'SCR-001');
  assert.deepEqual(handoff.manifest.screens[0].requirementIds,['FR-001']);
  assert.ok(handoff.manifest.screens.every(s=>s.viewport.width===1440));
  assert.ok(handoff.manifest.screens[0].components.some(c=>c.type==='input'));
  assert.ok(handoff.brd.includes('BRD'));
  assert.ok(handoff.srs.includes('FR-001'));
  assert.ok(handoff.instructions.includes('ui-ux-pro-max'));
  assert.ok(handoff.instructions.includes('join_channel'));
  assert.ok(handoff.instructions.includes('get_document_info'));
  assert.ok(handoff.instructions.includes('create_frame'));
  assert.ok(handoff.instructions.includes('Do not claim'));
  assert.ok(handoff.manifest.navigation.every(e=>e.fromScreenId.startsWith('SCR-')&&e.toScreenId.startsWith('SCR-')));
});

test('Figma handoff never treats an unknown action target as a valid navigation destination',()=>{
  const p=fixture();p.prototype.screens[0].components.push({type:'button',label:'Next',actionTarget:'SCR-999'});
  const pack=buildFigmaHandoff(p);
  assert.ok(!pack.manifest.navigation.some(x=>x.toScreenId==='SCR-999'));
  assert.match(renderFigmaInstructions(pack.manifest),/verified/i);
});


test('From BRD/SRS alone, conservative screen candidates preserve FR traceability',()=>{
  const p=fixture();p.prototype=null;
  const pack=buildFigmaHandoff(p,{platform:'mobile'});
  assert.equal(pack.manifest.screens.length,p.analysis.functionalRequirements.length);
  assert.equal(pack.manifest.screens[0].designStatus,'DRAFT-SCREEN-CANDIDATE');
  assert.equal(pack.manifest.screens[0].viewport.width,390);
  assert.deepEqual(pack.manifest.screens[0].requirementIds,['FR-001']);
  assert.equal(pack.manifest.navigation.length,0);
  assert.ok(pack.brd.includes('BRD')&&pack.srs.includes('SRS'));
});

// CLI never requires a Figma session for offline handoff.
test('Local figma export CLI writes a complete offline pack without network',async()=>{
  const {mkdtemp,readFile,writeFile,readdir,rm}=await import('node:fs/promises');
  const {spawnSync}=await import('node:child_process');
  const os=await import('node:os');
  const path=await import('node:path');
  const temp=await mkdtemp(path.join(os.tmpdir(),'ba-figma-'));
  try{
    const p=fixture();
    const dataDir=path.join(temp,'data');const out=path.join(temp,'pack');
    await (await import('node:fs/promises')).mkdir(dataDir);
    await writeFile(path.join(dataDir,p.id+'.json'),JSON.stringify(p));
    const r=spawnSync(process.execPath,['scripts/figma-design.mjs','--project',p.id,'--data-dir',dataDir,'--out',out],{cwd:process.cwd(),encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    const runs=await readdir(out);assert.equal(runs.length,1);
    const files=await readdir(path.join(out,runs[0]));
    for (const name of ['BRD.md','SRS.md','canonical.json','figma-manifest.json','FIGMA_INSTRUCTIONS.md']) assert.ok(files.includes(name),name);
    const m=JSON.parse(await readFile(path.join(out,runs[0],'figma-manifest.json'),'utf8'));
    assert.equal(m.screens.length,3);
    const invalid=spawnSync(process.execPath,['scripts/figma-design.mjs','--project',p.id,'--publish'],{cwd:process.cwd(),encoding:'utf8'});
    assert.equal(invalid.status,2);
    assert.match(invalid.stderr,/channel/);
  }finally{await rm(temp,{recursive:true,force:true})}
});

test('Figma publish uses configured CLI/model in reviewed pack, records validated report, then skips unchanged screens',async()=>{
 const {mkdtemp,mkdir,writeFile,readFile,rm,access}=await import('node:fs/promises');const {spawnSync}=await import('node:child_process');const path=await import('node:path');const os=await import('node:os');
 const temp=await mkdtemp(path.join(os.tmpdir(),'ba-figma-publish-'));
 try{
  const p=fixture(),dataDir=path.join(temp,'data'),bin=path.join(temp,'configured-codex'),marker=path.join(temp,'invoked'),poison=path.join(temp,'codex');await mkdir(dataDir);await writeFile(path.join(dataDir,p.id+'.json'),JSON.stringify(p));
  await writeFile(poison,'#!/usr/bin/env node\nprocess.exit(91);\n',{mode:0o700});
  await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2);if(a[a.indexOf('--model')+1]!=='configured-test-model'||!a.includes('--json')||a[a.indexOf('--sandbox')+1]!=='read-only')process.exit(70);
for(const f of ['BRD.md','SRS.md','canonical.json','figma-manifest.json'])if(!fs.existsSync(f))process.exit(71);
let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{
if(!input.includes('READ-ONLY CONNECTION PREFLIGHT')&&!input.includes('CREATE DESIGN FRAMES')&&!input.includes('EXPORT JPEG PREVIEW'))process.exit(73);
fs.appendFileSync(${JSON.stringify(marker)},'called\\n');const output=a[a.indexOf('--output-last-message')+1];
if(input.includes('READ-ONLY CONNECTION PREFLIGHT'))return fs.writeFileSync(output,JSON.stringify({connected:true,documentKey:'fixture-file',failureCode:''}));
if(input.includes('CREATE DESIGN FRAMES')){if(!input.includes('NEVER alter or delete'))process.exit(74);const plan=JSON.parse(fs.readFileSync('figma-publish-plan.json','utf8'));return fs.writeFileSync(output,JSON.stringify({documentKey:'fixture-file',screens:plan.screens.filter(s=>s.action==='create').map((s,i)=>({screenId:s.screenId,nodeId:'1:'+String(i+1),verified:true})),notes:'OFFLINE MOCK ONLY'}));}
const screenId=input.match(/screen (SCR-[A-Z0-9-]+)/)?.[1];return fs.writeFileSync(output,JSON.stringify({screenId,contentType:'image/jpeg',base64:'\\/9j\\/4AIA\\/9k='}));});
`,{mode:0o700});
  const args=['scripts/figma-design.mjs','--project',p.id,'--data-dir',dataDir,'--publish','--channel','fixture-channel','--figma-file','fixture-file'];
  const env={...process.env,PATH:temp+path.delimiter+process.env.PATH,CODEX_BIN:bin,CODEX_MODEL:'configured-test-model',CODEX_FIGMA_TIMEOUT_MS:'5000',BA_LOG_PROGRESS:'true'};
  const first=spawnSync(process.execPath,args,{env,encoding:'utf8',timeout:15000});assert.equal(first.status,0,first.stderr);assert.match(first.stdout,/CLI_START/);assert.match(first.stdout,/configured-test-model/);
  const run=path.join(dataDir,'projects',p.id,'04-figma','exports','v4-web');assert.equal(JSON.parse(await readFile(path.join(run,'figma-run-report.json'))).screens.length,3);
  await access(path.join(dataDir,'projects',p.id,'04-figma','registry','fixture-file.json'));
  const second=spawnSync(process.execPath,args,{env,encoding:'utf8',timeout:15000});assert.equal(second.status,0,second.stderr);assert.equal((await readFile(marker,'utf8')).trim().split('\n').length,5,'preflight, frame draw and three bounded previews run sequentially');
  const priorReport=await readFile(path.join(run,'figma-run-report.json'),'utf8');
  const retry=spawnSync(process.execPath,[...args,'--force'],{env,encoding:'utf8',timeout:15000});
  assert.equal(retry.status,1);assert.match(retry.stderr,/report rejected|Duplicate or reused Figma node ID/);
  assert.equal(await readFile(path.join(run,'figma-run-report.json'),'utf8'),priorReport,'failed retry preserves previously accepted report');
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('publish rejects wrong-file report without persisting report or registry and offline export never invokes CLI',async()=>{
 const {mkdtemp,mkdir,writeFile,access,rm}=await import('node:fs/promises');const {spawnSync}=await import('node:child_process');const path=await import('node:path');const os=await import('node:os');
 const temp=await mkdtemp(path.join(os.tmpdir(),'ba-figma-reject-'));
 try{
  const p=fixture(),dataDir=path.join(temp,'data'),bin=path.join(temp,'wrong-file-cli');await mkdir(dataDir);await writeFile(path.join(dataDir,p.id+'.json'),JSON.stringify(p));
  await writeFile(path.join(temp,'codex'),'#!/usr/bin/env node\nprocess.exit(91);\n',{mode:0o700});
  await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2);process.stdin.resume();process.stdin.on('end',()=>fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify({connected:false,documentKey:'wrong-file',failureCode:'DOCUMENT_MISMATCH'})));
`,{mode:0o700});
  const env={...process.env,PATH:temp+path.delimiter+process.env.PATH,CODEX_BIN:bin,CODEX_MODEL:'configured-test-model'};
  const args=['scripts/figma-design.mjs','--project',p.id,'--data-dir',dataDir];
  const offline=spawnSync(process.execPath,args,{env,encoding:'utf8'});assert.equal(offline.status,0,offline.stderr);assert.doesNotMatch(offline.stdout,/CLI_START/);
  const r=spawnSync(process.execPath,[...args,'--publish','--channel','fixture-channel','--figma-file','fixture-file'],{env,encoding:'utf8',timeout:15000});assert.equal(r.status,1);assert.match(r.stderr,/report rejected|document mismatch/i);assert.doesNotMatch(r.stdout+r.stderr,/PRIVATE_MODEL_TEXT/);
  const base=path.join(dataDir,'projects',p.id,'04-figma');await assert.rejects(access(path.join(base,'registry','fixture-file.json')));await assert.rejects(access(path.join(base,'exports','v4-web','figma-run-report.json')));
 }finally{await rm(temp,{recursive:true,force:true});}
});

test('configured publish timeout and changed project version never commit a report or registry',async()=>{
 const {mkdtemp,mkdir,writeFile,access,rm}=await import('node:fs/promises');const {spawnSync}=await import('node:child_process');const path=await import('node:path');const os=await import('node:os');
 for(const mode of ['timeout','stale','registry']){
  const temp=await mkdtemp(path.join(os.tmpdir(),'ba-figma-'+mode+'-'));
  try{
   const p=fixture(),dataDir=path.join(temp,'data'),bin=path.join(temp,'fixture-cli');await mkdir(dataDir);await writeFile(path.join(dataDir,p.id+'.json'),JSON.stringify(p));await writeFile(path.join(temp,'codex'),'#!/usr/bin/env node\nprocess.exit(91);\n',{mode:0o700});
   const body=mode==='timeout'?'process.stdin.resume();setInterval(()=>{},10000);':`const fs=require('fs'),a=process.argv.slice(2);let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',async()=>{const output=a[a.indexOf('--output-last-message')+1];if(input.includes('READ-ONLY CONNECTION PREFLIGHT'))return fs.writeFileSync(output,JSON.stringify({connected:true,documentKey:'fixture-file',failureCode:''}));if(input.includes('EXPORT JPEG PREVIEW')){const screenId=input.match(/screen (SCR-[A-Z0-9-]+)/)?.[1];return fs.writeFileSync(output,JSON.stringify({screenId,contentType:'image/jpeg',base64:'\/9j\/4AIA\/9k='}));}const plan=JSON.parse(fs.readFileSync('figma-publish-plan.json','utf8'));const {ProductionStore}=await import(${JSON.stringify(new URL('../src/production-store.js',import.meta.url).href)});const store=new ProductionStore(${JSON.stringify(dataDir)});const p=store.get(plan.projectId);if(${JSON.stringify(mode)}==='stale'){p.version++;store.save(p);}else{const path=require('path'),registryDir=path.join(${JSON.stringify(dataDir)},'projects',p.id,'04-figma','registry');fs.mkdirSync(registryDir,{recursive:true});fs.writeFileSync(path.join(registryDir,'fixture-file.json'),JSON.stringify({schemaVersion:'ba.figma.registry.v1',documentKey:'fixture-file',projectId:p.id,screens:{},notes:'OFFLINE CONCURRENT REGISTRY'}));}store.db.close();fs.writeFileSync(output,JSON.stringify({documentKey:'fixture-file',screens:plan.screens.map((s,i)=>({screenId:s.screenId,nodeId:'1:'+String(i+1),verified:true})),notes:'OFFLINE MOCK ONLY'}));});`;
   await writeFile(bin,'#!/usr/bin/env node\n'+body,{mode:0o700});
   const env={...process.env,PATH:temp+path.delimiter+process.env.PATH,CODEX_BIN:bin,CODEX_MODEL:'configured-test-model',CODEX_FIGMA_TIMEOUT_MS:mode==='timeout'?'1000':'5000',BA_LOG_PROGRESS:'true'};
   const result=spawnSync(process.execPath,['scripts/figma-design.mjs','--project',p.id,'--data-dir',dataDir,'--publish','--channel','fixture-channel','--figma-file','fixture-file'],{env,encoding:'utf8',timeout:10000});
   assert.equal(result.status,1,result.stderr);assert.match(result.stderr,mode==='timeout'?/timeout/i:mode==='stale'?/Project changed during publish/:/Figma registry changed during publish/);
   if(mode==='timeout')assert.match(result.stdout,/CLI_TIMEOUT/);
   const base=path.join(dataDir,'projects',p.id,'04-figma');if(mode==='registry')await access(path.join(base,'registry','fixture-file.json'));else await assert.rejects(access(path.join(base,'registry','fixture-file.json')));await assert.rejects(access(path.join(base,'exports','v4-web','figma-run-report.json')));
  }finally{await rm(temp,{recursive:true,force:true});}
 }
});


test('shared Figma publisher checks channel and file identity before writing frames',async()=>{
 const designPack=buildFigmaHandoff(fixture()),calls=[];
 const result=await publishFigmaDesign({project:fixture(),designPack,documentKey:'expected-file',channelId:'fixture-channel',outputDirectory:'/tmp',runner:async(prompt)=>{
  calls.push(prompt);return {connected:true,documentKey:'wrong-file'};
 }}).catch(e=>e);
 assert.match(result.message,/document mismatch/i);
 assert.equal(calls.length,1,'only the read-only preflight is allowed before identity is checked');
});

test('publisher reports approval denial and stops before creating frames',async()=>{
 const p=fixture(),calls=[];
 await assert.rejects(publishFigmaDesign({project:p,designPack:buildFigmaHandoff(p),documentKey:'expected-file',channelId:'fixture-channel',runner:async(prompt)=>{
  calls.push(prompt);return {connected:false,documentKey:'',failureCode:'MCP_APPROVAL_REQUIRED'};
 }}),error=>error.code==='MCP_APPROVAL_REQUIRED');
 assert.equal(calls.length,1,'approval denial must not trigger drawing or a fallback route');
});

test('operator file confirmation only resolves a connected plugin with an unavailable file key, in the exact run scope',async()=>{
 const {recordFigmaFileConfirmation}=await import('../src/figma-design-review.js');
 const p=fixture(),designPack=buildFigmaHandoff(p),runId='fixture-run',documentKey='expected-file',channelId='fixture-channel';
 const confirmation=recordFigmaFileConfirmation(p,{confirmed:true,runId,documentKey,channelId,projectVersion:p.version,confirmedBy:'fixture-operator'});
 const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x02,0xff,0xd9]).toString('base64');
 for(const [preflight,fileConfirmation,expectedCode] of [
  [{connected:true,documentKey:'',failureCode:'FILE_KEY_UNAVAILABLE'},null,'FILE_KEY_UNAVAILABLE'],
  [{connected:true,documentKey:'',failureCode:'FILE_KEY_UNAVAILABLE'},{...confirmation,runId:'other-run'},'FILE_KEY_UNAVAILABLE'],
  [{connected:true,documentKey:'',failureCode:'FILE_KEY_UNAVAILABLE'},{...confirmation,projectVersion:p.version+1},'FILE_KEY_UNAVAILABLE'],
  [{connected:true,documentKey:'',failureCode:'FILE_KEY_UNAVAILABLE'},{...confirmation,channelDigest:'0'.repeat(64)},'FILE_KEY_UNAVAILABLE'],
  [{connected:false,documentKey:'',failureCode:'PLUGIN_NOT_CONNECTED'},confirmation,'PLUGIN_NOT_CONNECTED'],
  [{connected:true,documentKey:'wrong-file',failureCode:'DOCUMENT_MISMATCH'},confirmation,'DOCUMENT_MISMATCH'],
  [{connected:false,documentKey:'',failureCode:'MCP_APPROVAL_REQUIRED'},confirmation,'MCP_APPROVAL_REQUIRED']
 ]){
  let calls=0;await assert.rejects(publishFigmaDesign({project:p,designPack,runId,documentKey,channelId,fileConfirmation,runner:async()=>{calls++;return preflight}}),e=>e.code===expectedCode);assert.equal(calls,1);
 }
 const result=await publishFigmaDesign({project:p,designPack,runId,documentKey,channelId,fileConfirmation:confirmation,runner:async(prompt)=>{
  if(prompt.includes('READ-ONLY CONNECTION PREFLIGHT'))return {connected:true,documentKey:'',failureCode:'FILE_KEY_UNAVAILABLE'};
  if(prompt.includes('CREATE DESIGN FRAMES')){assert.match(prompt,/human operator explicitly confirmed/);return {documentKey,screens:designPack.manifest.screens.map((s,i)=>({screenId:s.id,nodeId:`31:${i+1}`,verified:true})),notes:'OFFLINE FIXTURE'};}
  return {screenId:prompt.match(/screen (SCR-[A-Z0-9-]+)/)[1],contentType:'image/jpeg',base64:jpeg};
 }});
 assert.deepEqual(result.fileIdentity,confirmation);assert.deepEqual(p.review,fixture().review);
});

test('publisher verifies every planned screen and exports one bounded JPEG at a time',async()=>{
 const p=fixture(),designPack=buildFigmaHandoff(p),calls=[],jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x02,0xff,0xd9]).toString('base64');
 const result=await publishFigmaDesign({project:p,designPack,documentKey:'expected-file',channelId:'fixture-channel',outputDirectory:'/tmp',runner:async(prompt,_schema,options)=>{
  calls.push({prompt,options});
  if(prompt.includes('READ-ONLY CONNECTION PREFLIGHT'))return {connected:true,documentKey:'expected-file'};
  if(prompt.includes('CREATE DESIGN FRAMES'))return {documentKey:'expected-file',screens:designPack.manifest.screens.map((s,i)=>({screenId:s.id,nodeId:`21:${i+1}`,verified:true})),notes:'verified'};
  const screenId=prompt.match(/screen (SCR-[A-Z0-9-]+)/)?.[1];return {screenId,contentType:'image/jpeg',base64:jpeg};
 }});
 assert.equal(result.screens.length,designPack.manifest.screens.length);
 assert.equal(result.previews.length,designPack.manifest.screens.length);
 assert.deepEqual(result.screens.map(s=>s.screenId),designPack.manifest.screens.map(s=>s.id));
 const exports=calls.filter(c=>c.prompt.includes('EXPORT JPEG PREVIEW'));
 assert.equal(exports.length,result.screens.length);
 assert.ok(exports.every(c=>c.options.maxOutputBytes===8*1024*1024));
 assert.deepEqual(calls.filter(c=>c.prompt.includes('EXPORT JPEG PREVIEW')).map(c=>c.prompt.match(/screen (SCR-[A-Z0-9-]+)/)?.[1]),result.screens.map(s=>s.screenId));
});

test('publisher exports original PNG bytes and excludes supplemental draft screens from the prototype review set',async()=>{
 const p=fixture(),designPack=buildFigmaHandoff(p),ids=new Set(p.prototype.screens.map(screen=>screen.id));
 designPack.manifest.screens.push({...designPack.manifest.screens[0],id:'SCR-DRAFT-FR-999',status:'DRAFT'});
 const exports=[],png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=';
 const result=await publishFigmaDesign({project:p,designPack,documentKey:'fixture-file',channelId:'fixture-channel',previewExporter:async({screenId})=>{exports.push(screenId);return {screenId,contentType:'image/png',base64:png}},runner:async prompt=>{
  if(prompt.includes('READ-ONLY CONNECTION PREFLIGHT'))return {connected:true,documentKey:'fixture-file',failureCode:''};
  assert.ok(prompt.includes('CREATE DESIGN FRAMES'));assert.ok(!prompt.includes('SCR-DRAFT-FR-999'));
  return {documentKey:'fixture-file',screens:designPack.manifest.screens.filter(screen=>ids.has(screen.id)).map((screen,i)=>({screenId:screen.id,nodeId:`41:${i+1}`,verified:true})),notes:'OFFLINE FIXTURE'};
 }});
 assert.deepEqual(exports,[...ids]);assert.equal(result.screens.length,ids.size);assert.ok(result.previews.every(image=>image.contentType==='image/png'&&image.base64===png));
});

test('publisher rejects incomplete reports and invalid preview bytes; revisions require new frames and preserve old registry',async()=>{
 const p=fixture(),designPack=buildFigmaHandoff(p),manifestScreens=designPack.manifest.screens,jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,0x00,0x02,0xff,0xd9]).toString('base64');
 const registry={schemaVersion:'ba.figma.registry.v1',projectId:p.id,documentKey:'expected-file',screens:{'SCR-001':{nodeId:'8:1',verified:true,sha256:'old'}}};
 const run=async({revisionNotes,reportScreens=manifestScreens.map((s,i)=>({screenId:s.id,nodeId:`21:${i+1}`,verified:true})),image=jpeg})=>{
  const prompts=[];const value=await publishFigmaDesign({project:p,designPack,documentKey:'expected-file',channelId:'fixture-channel',revisionNotes,registry,outputDirectory:'/tmp',runner:async prompt=>{
   prompts.push(prompt);
   if(prompt.includes('READ-ONLY CONNECTION PREFLIGHT'))return {connected:true,documentKey:'expected-file'};
   if(prompt.includes('CREATE DESIGN FRAMES'))return {documentKey:'expected-file',screens:reportScreens,notes:'mock'};
   const screenId=prompt.match(/screen (SCR-[A-Z0-9-]+)/)?.[1];return {screenId,contentType:'image/jpeg',base64:image};
  }});return {value,prompts};
 };
 await assert.rejects(run({reportScreens:manifestScreens.slice(0,1).map((s,i)=>({screenId:s.id,nodeId:`21:${i+1}`,verified:true}))}),/missing|coverage/i);
 await assert.rejects(run({image:Buffer.from('not an image').toString('base64')}),/JPEG|preview/i);
 const prior=JSON.stringify(registry),{value,prompts}=await run({revisionNotes:'Use more spacing and keep actions visible'});
 assert.deepEqual(registry,JSON.parse(prior));
 assert.ok(prompts.some(x=>x.includes('REVISION FEEDBACK: Use more spacing')));
 assert.ok(prompts.some(x=>x.includes('NEW isolated versioned container')));
 assert.ok(value.plan.screens.every(s=>s.action==='create'));
});

test('publisher supports MCP without create_section by requesting an isolated container frame',async()=>{
 const p=fixture(),pack=buildFigmaHandoff(p),prompts=[];
 const result=await publishFigmaDesign({project:p,designPack:pack,documentKey:'fixture-file',channelId:'fixture-channel',runner:async(prompt)=>{
  prompts.push(prompt);
  if(prompts.length===1)return {connected:true,documentKey:'fixture-file',failureCode:''};
  assert.match(prompt,/If create_section is unavailable, use create_frame/);
  assert.match(prompt,/parentId/);
  assert.match(prompt,/Do not report the container as a screen/);
  assert.match(prompt,/SKILL\.md/);
  return {documentKey:'fixture-file',screens:pack.manifest.screens.map((s,i)=>({screenId:s.id,nodeId:`20:${i+1}`,verified:true})),notes:'Fixture container frame'};
 },previewExporter:async({screenId})=>({screenId,contentType:'image/jpeg',base64:'/9j/4AIA/9k='})});
 assert.equal(result.screens.length,pack.manifest.screens.length);
 assert.match(pack.instructions,/container frame/);
 assert.match(pack.instructions,/parentId/);
});

test('empty validated design report fails with a specific safe code and never exports previews',async()=>{
 const p=fixture();let calls=0,exports=0;
 await assert.rejects(publishFigmaDesign({project:p,designPack:buildFigmaHandoff(p),documentKey:'fixture-file',channelId:'fixture-channel',runner:async()=>{
  if(++calls===1)return {connected:true,documentKey:'fixture-file',failureCode:''};
  return {documentKey:'fixture-file',screens:[],notes:'PRIVATE_PROVIDER_TEXT: missing create_section and design skill'};
 },previewExporter:async()=>{exports++;}}),e=>e.code==='NO_VERIFIED_SCREENS'&&!e.message.includes('PRIVATE_PROVIDER_TEXT'));
 assert.equal(calls,2);assert.equal(exports,0);
});

test('selected-screen revision creates only selected frames and preserves every other registered node',async()=>{
 const {buildPublishPlan,acceptVerifiedFigmaReport}=await import('../src/figma-registry.js');
 const p=fixture(),pack=buildFigmaHandoff(p,{platform:'mobile'}),base=buildPublishPlan(pack.manifest);
 const registry=acceptVerifiedFigmaReport(base,{documentKey:'fixture-file',screens:base.screens.map((s,i)=>({screenId:s.screenId,nodeId:`5:${i+1}`,verified:true}))},{documentKey:'fixture-file'}).registry;
 let calls=0;const selected=base.screens[1].screenId;
 const result=await publishFigmaDesign({project:p,designPack:pack,documentKey:'fixture-file',channelId:'fixture-channel',registry,revisionNotes:'Increase selected screen button size',screenIds:[selected],runner:async(prompt)=>{
  if(++calls===1)return {connected:true,documentKey:'fixture-file',failureCode:''};
  const actions=JSON.parse(prompt.split('plan actions marked create: ')[1].split('. For each new frame')[0]);
  assert.deepEqual(actions.map(s=>s.screenId),[selected]);
  return {documentKey:'fixture-file',screens:[{screenId:selected,nodeId:'8:1',verified:true}],notes:'Only selected frame was created'};
 },previewExporter:async({screenId})=>({screenId,contentType:'image/jpeg',base64:'/9j/4AIA/9k='})});
 assert.equal(calls,2);assert.equal(result.completed,1);assert.equal(result.skipped,base.screens.length-1);
 assert.equal(result.screens.find(s=>s.screenId===selected).nodeId,'8:1');
 for(const s of base.screens.filter(s=>s.screenId!==selected))assert.equal(result.registry.screens[s.screenId].nodeId,registry.screens[s.screenId].nodeId);
 assert.equal(registry.screens[selected].nodeId,'5:2');
 const wrong=structuredClone(registry);wrong.screens[base.screens[0].screenId].sha256='0'.repeat(64);
 for(const bad of [null,wrong])await assert.rejects(publishFigmaDesign({project:p,designPack:pack,documentKey:'fixture-file',channelId:'fixture-channel',registry:bad,revisionNotes:'Same change',screenIds:[selected],runner:()=>{throw Error('must not call provider');}}),/Unselected/);
 const {figmaRegistryDirectory}=await import('../src/project-workspaces.js');
 assert.notEqual(figmaRegistryDirectory('/tmp',p.id,'web'),figmaRegistryDirectory('/tmp',p.id,'mobile'));
 assert.ok(pack.manifest.screens.every(s=>s.viewport.width===390));
});
