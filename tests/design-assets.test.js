import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {ProductionStore} from '../src/production-store.js';
import {assetUrl,publicAddress,downloadAsset,sanitizeSvg,normalizeAssetBytes} from '../src/design-asset-fetch.js';
import {DesignAssetStore,resolveDesignAssets,normalizeLibrarySource} from '../src/design-assets.js';
import {createFigmaAssetImporter} from '../src/figma-assets.js';
import {figmaAssetPluginZip,validateLocalAssetPluginManifest} from '../src/figma-asset-plugin-package.js';
import {publishFigmaDesign} from '../src/figma-publisher.js';
import {buildFigmaHandoff} from '../src/figma-handoff.js';
import {beginFigmaDesign,completeFigmaDesign,reviewFigmaDesign} from '../src/figma-design-review.js';
import {normalizeAnalysis,normalizePrototype} from '../src/normalize.js';
import {demoAnalysis,demoPrototype,sampleBrief,sampleTitle} from '../src/demo.js';
const svg=Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" d="M1 2h3"/></svg>');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=','base64');
const metadata={name:'search',kind:'icon',sourceUrl:'https://api.iconify.design/lucide/search.svg',directionDigest:'d'.repeat(64)};
const scope=async fn=>{const dir=await mkdtemp(path.join(tmpdir(),'ba-assets-')),store=new ProductionStore(dir);try{const id=randomUUID();store.save({id,version:1,updatedAt:new Date().toISOString()});await fn({dir,store,id,assets:new DesignAssetStore(store)})}finally{store.db.close();await rm(dir,{recursive:true,force:true})}};

test('asset downloader rejects local/credential URLs and non-public IPv4/IPv6 addresses',async()=>{
 for(const input of ['http://example.com/a.svg','https://user:pass@example.com/a.svg','https://localhost/a.svg','https://127.0.0.1/a.svg','https://[::1]/a.svg','https://example.com:444/a.svg'])assert.throws(()=>assetUrl(input));
 for(const ip of ['0.0.0.0','10.1.2.3','127.0.0.1','169.254.169.254','172.16.1.1','192.168.1.1','100.64.1.2','203.0.113.4','255.255.255.255','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1','2002:7f00:1::'])assert.equal(publicAddress(ip),false,ip);
 for(const ip of ['1.1.1.1','8.8.8.8','2606:4700:4700::1111'])assert.equal(publicAddress(ip),true,ip);
 let requests=0;await assert.rejects(downloadAsset('https://example.com/a.svg',{resolve:async()=>[{address:'127.0.0.1',family:4}],request:()=>requests++}),/public/);assert.equal(requests,0);
});
function transport(responses,check=()=>{}){return (url,options,onResponse)=>{check(url,options);const req=new EventEmitter();req.end=()=>queueMicrotask(()=>{const data=responses.shift(),res=new EventEmitter();res.statusCode=data.status||200;res.headers=data.headers||{'content-type':'image/svg+xml'};res.resume=()=>{};res.destroy=()=>{};onResponse(res);if(res.statusCode===200){res.emit('data',data.bytes||svg);res.emit('end')}});req.destroy=e=>{if(e)req.emit('error',e);req.emit('close')};return req}}

test('HTTPS download pins DNS, validates redirects again and bounds response bytes',async()=>{
 const resolve=async()=>[{address:'1.1.1.1',family:4}];let pinned=false;
 const download=await downloadAsset('https://example.com/a.svg',{resolve,request:transport([{bytes:svg}],(url,opts)=>opts.lookup(url.hostname,{all:true},(e,values)=>{pinned=values[0].address==='1.1.1.1'}))});assert.ok(pinned);assert.deepEqual(download.bytes,svg);
 await assert.rejects(downloadAsset('https://example.com/a.svg',{resolve,request:transport([{status:302,headers:{location:'https://127.0.0.1/secret'}}])}),/public HTTPS/);
 await assert.rejects(downloadAsset('https://example.com/a.svg',{maxBytes:3,resolve,request:transport([{bytes:svg}])}),/byte limit/);
});

test('SVG allowlist rejects active XML, external paint, event handlers and oversized data',()=>{
 assert.match(sanitizeSvg(svg).toString(),/<path/);
 for(const value of ['<script/>','<foreignObject/>','<style/>','<image href="https://example.com/a.png"/>','<path onload="alert(1)"/>','<path fill="url(https://example.com/a)"/>','<use href="https://example.com/a.svg#x"/>'])assert.throws(()=>sanitizeSvg(`<svg xmlns="http://www.w3.org/2000/svg">${value}</svg>`));
 assert.throws(()=>sanitizeSvg('<!DOCTYPE svg [<!ENTITY e SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&e;</svg>'));
 assert.throws(()=>sanitizeSvg(Buffer.alloc(300000)));
 assert.throws(()=>normalizeAssetBytes({bytes:Buffer.from('<html>no</html>'),contentType:'image/png'}));
 assert.equal(normalizeAssetBytes({bytes:png,contentType:'image/png'}).extension,'png');
});

test('asset cache is immutable, UUID scoped, checksummed and rejects cross-project reads',()=>scope(async({store,assets,id,dir})=>{
 const a=await assets.put(id,'source', {bytes:svg,contentType:'image/svg+xml'},metadata);assert.equal((await assets.put(id,'source',{bytes:svg,contentType:'image/svg+xml'},metadata)).id,a.id);assert.equal(assets.list(id).length,1);assert.equal(a.licenseVerified,false);
 const other=randomUUID();store.save({id:other,version:1,updatedAt:new Date().toISOString()});await assert.rejects(assets.read(other,a.id),/not found/);
 await writeFile(path.join(dir,'projects',id,'04-figma','assets',a.filename),'tampered');await assert.rejects(assets.read(id,a.id),/checksum/);
}));

test('Iconify source normalization supports collection links and direct public images only',()=>{
 assert.deepEqual(normalizeLibrarySource({sourceType:'auto',sourceUrl:'https://icon-sets.iconify.design/lucide/'}),{sourceType:'iconify',prefix:'lucide'});
 assert.equal(normalizeLibrarySource({sourceType:'auto',sourceUrl:'https://example.com/a.png'}).sourceType,'url');
 assert.throws(()=>normalizeLibrarySource({sourceType:'iconify',sourceUrl:'https://evil.example/lucide/'}));
 assert.throws(()=>normalizeLibrarySource({sourceType:'iconify',sourceUrl:'https://icon-sets.iconify.design/lucide/',componentId:'1:2'}));
});

test('asset planner uses exact catalog entries, caches bytes, and rejects invented icons/screens',()=>scope(async({assets,id,dir})=>{
 const project={id,designDirection:{digest:'d'.repeat(64),library:[{sourceType:'iconify',prefix:'lucide',sourceUrl:'https://icon-sets.iconify.design/lucide/',name:'Lucide',kind:'icon'}]},figmaDesign:{visualInputsConfirmed:true},prototype:{screens:[{id:'SCR-001',title:'Search',components:[]}]}};
 let svgDownloads=0;const download=async url=>url.includes('/collection?')?{bytes:Buffer.from(JSON.stringify({prefix:'lucide',uncategorized:['search','user']})),contentType:'application/json'}:(svgDownloads++,{bytes:svg,contentType:'image/svg+xml'});
 const runner=async(prompt,schema,options)=>{assert.equal(options.figmaToolPhase,'asset-selection');assert.match(prompt,/search/);return {assets:[{sourceIndex:0,iconName:'search',screenIds:['SCR-001'],usage:'Search action'}]}};
 const options={project,screenIds:['SCR-001'],store:assets,runner,download,outputDirectory:dir};
 const first=await resolveDesignAssets(options),second=await resolveDesignAssets(options);assert.equal(first[0].id,second[0].id);assert.equal(svgDownloads,1);
 await assert.rejects(resolveDesignAssets({...options,runner:async()=>({assets:[{sourceIndex:0,iconName:'invented',screenIds:['SCR-001'],usage:''}]})}),/catalog/);
 await assert.rejects(resolveDesignAssets({...options,runner:async()=>({assets:[{sourceIndex:0,iconName:'search',screenIds:['SCR-999'],usage:''}]})}),/scope/);
}));

async function plugin(){
 const nodes=new Map();let serial=100;
 function node(type,id,parent){const data=new Map(),n={type,id,name:'',x:0,y:0,width:24,height:24,children:[],visible:true,parent,getPluginData:k=>data.get(k)||'',setPluginData:(k,v)=>data.set(k,v),resize(w,h){this.width=w;this.height=h},insertChild(i,child){if(child.parent)child.parent.children=child.parent.children.filter(n=>n!==child);child.parent=this;this.children.splice(i,0,child)}};nodes.set(id,n);if(parent)parent.children.push(n);return n}
 const page=node('PAGE','1:1'),old=node('FRAME','2:1',page);
 const api={fileKey:'fixture-file',currentPage:page,getNodeByIdAsync:async id=>nodes.get(id),createNodeFromSvg:()=>node('FRAME',`${serial++}:1`,page),base64Decode:x=>Buffer.from(x,'base64'),createImage:()=>({hash:'image-hash'})};page.findAllWithCriteria=()=>[...nodes.values()].filter(n=>n.type==='FRAME');
 const context=vm.createContext({console,Date,Map,Set});vm.runInContext(await readFile('vendor/ba-talk-to-figma-plugin/asset-commands.js','utf8'),context);
 return {api,node,old,call:(command,params)=>context.handleBAAssetCommand(api,command,params),close:params=>context.closeBAAssetRun(api,params)};
}

test('plugin rejects existing frames/outside slots, inserts vectors/images, verifies identity and fences closed runs',async()=>{
 const p=await plugin(),assetId=randomUUID(),runId='fixture-run',sha256='a'.repeat(64);await p.call('ba_asset_capabilities',{runId});
 const oldSlot=p.node('RECTANGLE','2:2',p.old);oldSlot.name='BA_ASSET:'+assetId;
 const params={runId,assetId,sha256,screenId:'SCR-001',screenNodeId:p.old.id,slotNodeId:oldSlot.id,contentType:'image/svg+xml',data:svg.toString()};await assert.rejects(p.call('ba_import_asset',params),/newly created/);
 const frame=p.node('FRAME','3:1',p.api.currentPage),slot=p.node('RECTANGLE','3:2',frame);slot.name='BA_ASSET:'+assetId;params.screenNodeId=frame.id;params.slotNodeId=slot.id;
 const inserted=await p.call('ba_import_asset',params);assert.equal(inserted.verified,true);assert.equal(slot.visible,false);assert.equal((await p.call('ba_verify_asset',params)).nodeId,inserted.nodeId);
 await assert.rejects(p.call('ba_import_asset',params),/already contains/);await p.close({runId,screenNodeIds:[frame.id]});await assert.rejects(p.call('ba_import_asset',params),/snapshot/);
});

test('publisher resolves, inserts and reads back real cached assets before exporting a review preview',()=>scope(async({store,assets,id,dir})=>{
 const p=await plugin(),analysis=normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief);
 let project={id,title:sampleTitle,brief:sampleBrief,status:'GENERATED',version:4,analysis,review:{approved:true},prototype:normalizePrototype(demoPrototype(analysis),analysis),designDirection:{digest:'d'.repeat(64),brief:{goals:'Professional'},sampleScreenId:'SCR-001',references:[],library:[{sourceType:'iconify',prefix:'lucide',sourceUrl:'https://icon-sets.iconify.design/lucide/',kind:'icon'}]}};
 project=beginFigmaDesign(project,{documentKey:'fixture-file',channelId:'channel',jobId:'fixture-run',platform:'web'});project.figmaDesign.visualInputsConfirmed=true;
 const importer=createFigmaAssetImporter({channelId:'channel',documentKey:'fixture-file',runId:'fixture-run',store:assets,projectId:id,command:async({command,params})=>command==='ba_close_asset_run'?p.close(params):p.call(command,params)});
 let selected,draws=0;
 const runner=async(prompt,schema)=>{
  if(schema.properties.connected)return {connected:true,documentKey:'fixture-file',failureCode:''};
  if(schema.properties.assets)return {assets:[{sourceIndex:0,iconName:'search',screenIds:['SCR-001'],usage:'Search action'}]};
  draws++;const frame=p.node('FRAME','4:1',p.api.currentPage),slot=p.node('RECTANGLE','4:2',frame);slot.name='BA_ASSET:'+selected[0].id;
  return {documentKey:'fixture-file',notes:'Fixture only',screens:[{screenId:'SCR-001',nodeId:frame.id,verified:true}],assetSlots:[{assetId:selected[0].id,screenId:'SCR-001',nodeId:slot.id}]};
 };
 const resolver=async({screenIds})=>(selected=await resolveDesignAssets({project,screenIds,store:assets,runner,outputDirectory:dir,download:async url=>url.includes('/collection?')?{bytes:Buffer.from(JSON.stringify({prefix:'lucide',uncategorized:['search']})),contentType:'application/json'}:{bytes:svg,contentType:'image/svg+xml'}}));
 const result=await publishFigmaDesign({project,designPack:buildFigmaHandoff(project),documentKey:'fixture-file',channelId:'channel',outputDirectory:dir,assetResolver:resolver,assetImporter:importer,runner,previewExporter:async({screenId})=>{assert.equal(draws,1);assert.equal(p.api.currentPage.children.find(n=>n.id==='4:1').getPluginData('baAssetClosed'),'true');return {screenId,contentType:'image/png',base64:png.toString('base64')}}});
 assert.equal(result.assets.length,1);assert.equal(result.assetEvidence[0].verified,true);assert.match(result.assetEvidence[0].source,/NOT_INDEPENDENT/);
 const failedImporter={capabilities:async()=>{throw Object.assign(new Error('Old plugin'),{code:'ASSET_PLUGIN_REQUIRED'})}};
 await assert.rejects(publishFigmaDesign({project,designPack:buildFigmaHandoff(project),documentKey:'fixture-file',channelId:'channel',assetResolver:resolver,assetImporter:failedImporter,runner}),e=>e.code==='ASSET_PLUGIN_REQUIRED');assert.equal(draws,1);
}));

test('downloadable plugin ZIP contains only pinned public plugin files and no analytics endpoint',async()=>{
 const bytes=await figmaAssetPluginZip();assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.equal(bytes.readUInt32LE(bytes.length-22),0x06054b50);assert.equal(bytes.readUInt16LE(bytes.length-12),6);
 assert.equal((await readFile('vendor/ba-talk-to-figma-plugin/ui.html','utf8')).includes('google-analytics.com'),false);assert.equal((await readFile('vendor/ba-talk-to-figma-plugin/code.js','utf8')).split('// BA_ASSET_EXTENSION\n')[1],await readFile('vendor/ba-talk-to-figma-plugin/asset-commands.js','utf8'));
});


test('development plugin package uses localhost only and rejects the IP domain that Figma refused',async()=>{
 const manifest=JSON.parse(await readFile('vendor/ba-talk-to-figma-plugin/manifest.json','utf8'));
 assert.equal(validateLocalAssetPluginManifest(manifest),manifest);
 for(const network of [{...manifest.networkAccess,allowedDomains:['ws://127.0.0.1:3055']},{...manifest.networkAccess,devAllowedDomains:['ws://127.0.0.1:3055']},{...manifest.networkAccess,allowedDomains:['*']}])assert.throws(()=>validateLocalAssetPluginManifest({...manifest,networkAccess:network}),/localhost/);
 const zip=await figmaAssetPluginZip(),start=30+zip.readUInt16LE(26)+zip.readUInt16LE(28),length=zip.readUInt32LE(18),packaged=JSON.parse(zip.subarray(start,start+length));
 assert.deepEqual(packaged.networkAccess.allowedDomains,['none']);assert.deepEqual(packaged.networkAccess.devAllowedDomains,['http://localhost:3055','ws://localhost:3055']);
});
