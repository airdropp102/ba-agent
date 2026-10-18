import {resolveBriefOptions} from '../public/design-brief-options.js';
import {normalizeLibrarySource} from './design-assets.js';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail=message=>{throw new Error(message)};
const text=(value,max=3000)=>{if(value===undefined)return '';if(typeof value!=='string'||value.length>max)fail('Invalid design text');return value.trim()};
function url(value){value=text(value,2048);if(!value)return '';let u;try{u=new URL(value)}catch{fail('Invalid asset URL')};if(u.protocol!=='https:'||u.username||u.password)fail('Asset URL must use HTTPS');return u.href}
export function referenceBytes(doc){
 if(doc.category!=='reference'||doc.encoding!=='base64'||! /\.(png|jpe?g|webp)$/i.test(doc.filename))fail('Choose a project reference image (PNG/JPEG/WebP)');
 const b=Buffer.from(doc.content,'base64'),ext=doc.filename.split('.').at(-1).toLowerCase();
 const valid=ext==='png'?b.length>=33&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a':ext==='webp'?b.length>=20&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP':b.length>=4&&b[0]===255&&b[1]===216&&b[2]===255&&b.at(-2)===255&&b.at(-1)===217;
 if(!valid||b.length>5*1024*1024||createHash('sha256').update(b).digest('hex')!==doc.sha256)fail('Invalid reference image bytes or checksum');return b;
}
export async function normalizeDesignDirection(project,input,readDocument){
 if(!input||typeof input!=='object'||Array.isArray(input))fail('Design Brief required');
 const selected=input.briefOptions===undefined?null:resolveBriefOptions(input.briefOptions,project.designDirection?.brief||{});
 const brief={};for(const key of ['goals','style','audience','primaryColor','typography','density','avoid'])brief[key]=text((selected?.brief||input.brief)?.[key],key==='primaryColor'?80:3000);
 if(!brief.goals)fail('Design goals are required');
 if(!(project.prototype?.screens||[]).some(s=>s.id===input.sampleScreenId))fail('Choose a current prototype screen for the sample');
 if(!Array.isArray(input.references)||input.references.length>6)fail('Up to 6 reference images allowed');
 const references=[],seen=new Set();let bytes=0;
 for(const ref of input.references){if(seen.has(ref?.documentId))fail('Duplicate reference image');seen.add(ref?.documentId);const doc=await readDocument(project.id,ref?.documentId);bytes+=referenceBytes(doc).length;if(bytes>20*1024*1024)fail('Reference images exceed 20 MB');references.push({documentId:doc.id,filename:doc.filename,sha256:doc.sha256,caption:text(ref.caption,1000)});}
 if(!Array.isArray(input.library)||input.library.length>30)fail('Up to 30 library entries allowed');
 const library=input.library.map(item=>{const source=normalizeLibrarySource(item||{}),name=text(item?.name,160)||(source.sourceType==='iconify'?source.prefix:source.sourceType==='url'?'Asset':''),kind=text(item?.kind,30),componentId=text(item?.componentId,100);if(!name||!['component','icon','photo','illustration'].includes(kind))fail('Invalid library entry');if(componentId&&!/^\d+:\d+$/.test(componentId))fail('Use a local Figma component node ID');return {...source,name,kind,componentId,sourceUrl:url(item.sourceUrl),license:text(item.license,300),usage:text(item.usage,1000)};});
 const config={schemaVersion:'ba.design-direction.v1',brief,references,library,sampleScreenId:input.sampleScreenId};
 return {...config,...(selected?{briefOptions:selected.options}:{}),digest:hash(config)};
}
export function sampleBinding(project,{platform,documentKey}={}){
 return hash({projectId:project.id,direction:project.designDirection?.digest,analysis:project.analysis,prototype:project.prototype,platform,documentKey});
}
export function currentSampleApproval(project,scope){
 const sample=project.designSample;return !!(sample?.state==='APPROVED'&&sample.binding===sampleBinding(project,scope)&&sample.screenId===project.designDirection?.sampleScreenId&&/^\d+:\d+$/.test(sample.nodeId||'')&&sample.preview?.sha256);
}
export function designRunMode(project,{mode,platform,documentKey}={}){
 if(mode!==undefined&&!['sample','full'].includes(mode))fail('Invalid design mode');
 if(!project.designDirection){if(mode==='sample')fail('Save a Design Brief before drawing a sample');return 'full'}
 const approved=currentSampleApproval(project,{platform,documentKey});
 mode=mode??(approved?'full':'sample');if(mode==='full'&&!approved)fail('Duyệt màn hình mẫu cho đúng nền tảng và file trước khi vẽ toàn bộ.');return mode;
}
export function saveDesignDirection(project,direction,actor){
 if(['QUEUED','DESIGNING'].includes(project.figmaDesign?.state))fail('Wait for the current Figma job before changing the brief');
 const next=structuredClone(project);next.designDirection={...direction,updatedBy:actor,updatedAt:new Date().toISOString()};
 if(project.designDirection?.digest!==direction.digest){next.designSample=null;if(next.figmaDesign)next.figmaDesign={...next.figmaDesign,state:'STYLE_DRAFT',draft:null,approved:null,screenIds:undefined,revisionScreenIds:undefined};}
 return next;
}
