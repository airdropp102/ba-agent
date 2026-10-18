import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeDesignDirection,saveDesignDirection,referenceBytes,currentSampleApproval} from '../src/design-direction.js';
import {beginFigmaDesign,completeFigmaDesign,reviewFigmaDesign} from '../src/figma-design-review.js';
import {buildFigmaHandoff} from '../src/figma-handoff.js';
import {buildFigmaDesignPlan,publishFigmaDesign} from '../src/figma-publisher.js';
import {sampleTitle,sampleBrief,demoAnalysis,demoPrototype} from '../src/demo.js';
import {normalizeAnalysis,normalizePrototype} from '../src/normalize.js';
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=';
const sha=createHash('sha256').update(Buffer.from(png,'base64')).digest('hex');
const document={id:'22222222-2222-4222-8222-222222222222',category:'reference',filename:'reference.png',encoding:'base64',content:png,sha256:sha};
const fixture=()=>{const analysis=normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief);return {id:'11111111-1111-4111-8111-111111111111',title:sampleTitle,brief:sampleBrief,version:4,status:'GENERATED',analysis,prototype:normalizePrototype(demoPrototype(analysis),analysis),review:{approved:true,customerApproved:false}}};
const input=()=>({brief:{goals:'Calm and professional',style:'Editorial'},sampleScreenId:'SCR-001',references:[{documentId:document.id,caption:'Hierarchy'}],library:[{name:'Search icon',kind:'icon',componentId:'30:1',sourceUrl:'https://example.com/icon',license:'Operator supplied'}]});
async function configured(){const p=fixture();p.designDirection=await normalizeDesignDirection(p,input(),async(id,doc)=>{assert.equal(id,p.id);assert.equal(doc,document.id);return document});return p}
const start=p=>beginFigmaDesign(p,{jobId:'sample-job',platform:'mobile',documentKey:'fixture-file',channelId:'channel'});
function complete(p,result){return completeFigmaDesign(p,{runId:p.figmaDesign.runId,projectVersion:p.version,manifestDigest:result.manifestDigest,screens:result.screens,previewFiles:result.previews.map(s=>({screenId:s.screenId,contentType:'image/png',path:`04-figma/exports/v4-mobile/previews/11111111-1111-4111-8111-111111111111/${s.screenId}.png`,sha256:s.sha256,sizeBytes:s.sizeBytes}))})}
function review(p,decision='APPROVE'){return reviewFigmaDesign(p,{decision,notes:'Visual QA of sample',reviewerId:'fixture-operator',projectVersion:p.version,manifestDigest:p.figmaDesign.manifestDigest})}
const preview=async({screenId})=>({screenId,contentType:'image/png',base64:png});

test('design inputs reject cross-project documents, malformed images, unsafe URLs and stale screens',async()=>{
 const p=fixture();await assert.rejects(normalizeDesignDirection(p,input(),async()=>{throw Error('Document not found for project')}),/project/);
 assert.throws(()=>referenceBytes({...document,content:Buffer.from('not a PNG').toString('base64')}),/bytes/);
 assert.throws(()=>referenceBytes({...document,category:'customer'}),/reference/);
 for(const bad of [{...input(),sampleScreenId:'SCR-999'},{...input(),library:[{...input().library[0],sourceUrl:'javascript:alert(1)'}]},{...input(),references:[input().references[0],input().references[0]]}])await assert.rejects(normalizeDesignDirection(p,bad,async()=>document));
});

test('sample then full publishing requires human approval, reuses approved node and sends images only to drawing',async()=>{
 let p=start(await configured());p.figmaDesign.visualInputsConfirmed=true;assert.equal(p.figmaDesign.mode,'sample');
 assert.throws(()=>beginFigmaDesign(p,{jobId:'bypass',documentKey:'fixture-file',channelId:'channel',platform:'mobile',mode:'full'}),/mẫu/);
 const calls=[];let node=40;
 const runner=async(prompt,schema,opts)=>{calls.push({prompt,opts});if(schema.properties.connected)return {connected:true,documentKey:'fixture-file',failureCode:''};if(schema.properties.availableComponentIds)return {availableComponentIds:['30:1']};return {documentKey:'fixture-file',notes:'Fixture report only',screens:JSON.parse(prompt.match(/marked create: (\[.*?\])\./)[1]).map(s=>({screenId:s.screenId,nodeId:`${++node}:1`,verified:true}))}};
 const pack=buildFigmaHandoff(p,{platform:'mobile'}),options={project:p,designPack:pack,documentKey:'fixture-file',channelId:'channel',runner,previewExporter:preview,imagePaths:['/isolated/reference-1.png']};
 const sample=await publishFigmaDesign(options);assert.deepEqual(sample.screens.map(s=>s.screenId),['SCR-001']);assert.equal(calls.filter(c=>c.opts.imagePaths).length,1);assert.match(calls.at(-1).prompt,/ONLY the selected sample/);
 p=complete(p,sample);assert.equal(p.figmaDesign.state,'WAITING_SAMPLE_REVIEW');assert.equal(p.figmaDesign.approved,null);
 const rejected=review(p,'REQUEST_CHANGES');assert.equal(rejected.designSample,null);assert.equal(start(rejected).figmaDesign.mode,'sample');
 p=review(p);assert.equal(p.figmaDesign.state,'SAMPLE_APPROVED');assert.equal(p.figmaDesign.approved,null);assert.equal(currentSampleApproval(p,{platform:'mobile',documentKey:'fixture-file'}),true);
 for(const scope of [{platform:'web',documentKey:'fixture-file'},{platform:'mobile',documentKey:'other-file'}])assert.equal(currentSampleApproval(p,scope),false);
 assert.equal(start({...p,analysis:{...p.analysis,context:'changed'}}).figmaDesign.mode,'sample');
 p=start(p);p.figmaDesign.visualInputsConfirmed=true;assert.equal(p.figmaDesign.mode,'full');
 const full=await publishFigmaDesign({...options,project:p,designPack:buildFigmaHandoff(p,{platform:'mobile'}),registry:sample.registry});assert.equal(full.skipped,1);assert.equal(full.screens[0].nodeId,sample.screens[0].nodeId);assert.equal(full.screens.length,p.prototype.screens.length);
 assert.throws(()=>buildFigmaDesignPlan(p,pack.manifest,null),/registry/);
 p=complete(p,full);p=review(p);assert.equal(p.figmaDesign.state,'APPROVED');assert.equal(p.figmaDesign.approved.screens.length,p.prototype.screens.length);assert.equal(p.review.customerApproved,false);
 const newSample=beginFigmaDesign(p,{jobId:'new-sample',documentKey:'fixture-file',channelId:'channel',platform:'mobile',mode:'sample'});assert.equal(newSample.figmaDesign.approved,null);assert.equal(newSample.designSample,null);
 const changed=input();changed.brief.style='Bold';const direction=await normalizeDesignDirection(p,changed,async()=>document),saved=saveDesignDirection(p,direction,'operator');assert.equal(saved.figmaDesign.state,'STYLE_DRAFT');assert.equal(saved.designSample,null);assert.equal(saved.figmaDesign.approved,null);
});

test('unavailable native library stops before drawing and missing consent stops before any provider call',async()=>{
 const p=start(await configured()),pack=buildFigmaHandoff(p,{platform:'mobile'});let calls=0;
 const opts={imagePaths:['/isolated/reference-1.png'],project:p,designPack:pack,documentKey:'fixture-file',channelId:'channel',runner:async(prompt,schema)=>{calls++;return schema.properties.connected?{connected:true,documentKey:'fixture-file',failureCode:''}:{availableComponentIds:[]}}};
 await assert.rejects(publishFigmaDesign(opts),/consent/);assert.equal(calls,0);p.figmaDesign.visualInputsConfirmed=true;
 await assert.rejects(publishFigmaDesign(opts),e=>e.code==='LIBRARY_UNAVAILABLE');assert.equal(calls,2);
 assert.throws(()=>saveDesignDirection({...p,figmaDesign:{state:'QUEUED'}},p.designDirection,'operator'),/Wait/);
});
