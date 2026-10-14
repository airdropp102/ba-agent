import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {projectDirectory,requireProjectId} from './project-workspaces.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const imageType=bytes=>bytes.length>=4&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff&&bytes.at(-2)===0xff&&bytes.at(-1)===0xd9?'image/jpeg':bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))&&bytes.subarray(-8).equals(Buffer.from('49454e44ae426082','hex'))?'image/png':null;
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
async function safeDirectory(directory,root){
 const relative=path.relative(path.resolve(root),directory);if(relative.startsWith('..')||path.isAbsolute(relative))fail('Path escapes data directory');
 let current=path.resolve(root);await fs.mkdir(current,{recursive:true,mode:0o700});
 for(const segment of relative.split(path.sep).filter(Boolean)){
  current=path.join(current,segment);try{await fs.mkdir(current,{mode:0o700})}catch(e){if(e.code!=='EEXIST')throw e}
  const stat=await fs.lstat(current);if(!stat.isDirectory()||stat.isSymbolicLink())fail('Workspace path is not a physical directory',409);
 }
}

/** Stores immutable, checksummed JPEG evidence in a UUID scoped project export directory. */
export class FigmaPreviewStore{
 constructor(store,{dataDir=store.dir}={}){this.store=store;this.dir=path.resolve(dataDir)}
 async write(projectId,{version,platform='web',runId,previews}={}){
  const id=requireProjectId(projectId);this.store.get(id);
  if(!Number.isSafeInteger(version)||version<1||!['web','mobile'].includes(platform)||!uuid.test(runId||'')||!Array.isArray(previews)||!previews.length)fail('Invalid Figma preview batch');
  const relativeDir=`04-figma/exports/v${version}-${platform}/previews/${runId}`,root=projectDirectory(this.dir,id),directory=path.join(root,...relativeDir.split('/'));
  await safeDirectory(directory,this.dir);const seen=new Set(),result=[];
  for(const preview of previews){
   if(!preview||!/^SCR-\d{3,}$/.test(preview.screenId||'')||seen.has(preview.screenId)||!['image/jpeg','image/png'].includes(preview.contentType)||typeof preview.base64!=='string')fail('Invalid Figma image preview');
   seen.add(preview.screenId);const bytes=Buffer.from(preview.base64,'base64');
   if(!bytes.length||bytes.length>5*1024*1024||bytes.toString('base64')!==preview.base64||imageType(bytes)!==preview.contentType)fail('Invalid Figma image preview bytes');
   const name=`${preview.screenId}.${preview.contentType==='image/png'?'png':'jpg'}`;await fs.writeFile(path.join(directory,name),bytes,{flag:'wx',mode:0o600});
   result.push({screenId:preview.screenId,path:`${relativeDir}/${name}`,contentType:preview.contentType,sha256:digest(bytes),sizeBytes:bytes.length});
  }
  return result;
 }
 async read(projectId,relativePath,{sha256,sizeBytes,contentType}={}){
  const id=requireProjectId(projectId);this.store.get(id);
  if(typeof relativePath!=='string'||!/^04-figma\/exports\/v\d+-(?:web|mobile)\/previews\/[0-9a-f-]{36}\/[A-Za-z0-9_-]{1,80}\.(?:jpg|png)$/i.test(relativePath))fail('Invalid Figma preview path');
  const root=projectDirectory(this.dir,id),parts=relativePath.split('/'),directory=path.join(root,...parts.slice(0,-1));await safeDirectory(directory,this.dir);
  const file=path.join(directory,parts.at(-1)),stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink())fail('Unsafe Figma preview file',409);
  const bytes=await fs.readFile(file);if(bytes.length!==sizeBytes||digest(bytes)!==sha256||imageType(bytes)!==(contentType||'image/jpeg'))fail('Figma preview checksum mismatch',409);
  return bytes;
 }
}
