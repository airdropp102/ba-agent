import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,symlink,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {ProductionStore} from '../src/production-store.js';
import {FigmaPreviewStore} from '../src/figma-preview-store.js';
import {projectDirectory} from '../src/project-workspaces.js';

test('Figma JPEG previews are project scoped, immutable and checksum verified',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ba-figma-preview-')),dataDir=path.join(root,'data');await mkdir(dataDir);
 const store=new ProductionStore(dataDir),projectId=randomUUID(),runId=randomUUID();
 try{
  store.save({id:projectId,title:'Test project',brief:'Project brief long enough for preview storage.',version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  const previews=new FigmaPreviewStore(store,{dataDir}),jpg=Buffer.from([0xff,0xd8,0xff,0x00,0xff,0xd9]).toString('base64');
  const [entry]=await previews.write(projectId,{version:2,platform:'web',runId,previews:[{screenId:'SCR-001',contentType:'image/jpeg',base64:jpg}]});
  assert.match(entry.path,new RegExp(`04-figma/exports/v2-web/previews/${runId}/SCR-001\\.jpg`));
  assert.deepEqual(await previews.read(projectId,entry.path,entry),Buffer.from(jpg,'base64'));
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=';
  const [pngEntry]=await previews.write(projectId,{version:2,platform:'web',runId,previews:[{screenId:'SCR-002',contentType:'image/png',base64:png}]});
  assert.ok(pngEntry.path.endsWith('.png'));assert.equal(pngEntry.contentType,'image/png');
  assert.deepEqual(await previews.read(projectId,pngEntry.path,pngEntry),Buffer.from(png,'base64'));
  await assert.rejects(()=>previews.read(projectId,pngEntry.path,{...pngEntry,contentType:'image/jpeg'}),/checksum/);
  await assert.rejects(()=>previews.read(randomUUID(),entry.path,entry),/not found|không tìm thấy/i);
  await assert.rejects(()=>previews.read(projectId,entry.path.replace('v2-web','v3-web'),entry),/ENOENT/i);
  await writeFile(path.join(projectDirectory(dataDir,projectId),...entry.path.split('/')),'tampered');
  await assert.rejects(()=>previews.read(projectId,entry.path,entry),/checksum/i);
 }finally{store.db.close();await rm(root,{recursive:true,force:true})}
});

test('Figma preview storage rejects symlinked workspace directories',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'ba-figma-preview-link-')),dataDir=path.join(root,'data');await mkdir(dataDir);
 const store=new ProductionStore(dataDir),projectId=randomUUID(),runId=randomUUID();
 try{
  store.save({id:projectId,title:'Test project',brief:'Project brief long enough for preview storage.',version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
  const projectRoot=projectDirectory(dataDir,projectId);await mkdir(path.dirname(projectRoot),{recursive:true});await symlink(path.join(root,'escape'),projectRoot);
  const previews=new FigmaPreviewStore(store,{dataDir}),jpg=Buffer.from([0xff,0xd8,0xff,0x00,0xff,0xd9]).toString('base64');
  await assert.rejects(()=>previews.write(projectId,{version:2,platform:'web',runId,previews:[{screenId:'SCR-001',contentType:'image/jpeg',base64:jpg}]}),/physical directory/i);
 }finally{store.db.close();await rm(root,{recursive:true,force:true})}
});
