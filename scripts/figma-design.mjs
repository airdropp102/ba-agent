#!/usr/bin/env node
import {loadDotEnv} from './load-env.mjs';
await loadDotEnv();
/** Safe local operator handoff: generate design artifacts, optionally publish with Codex + MCP. */
import path from 'node:path';
import fs from 'node:fs/promises';
import {existsSync,readFileSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {runCodexStructured} from '../src/codex-provider.js';
import {publishFigmaDesign} from '../src/figma-publisher.js';
import {withExecutionContext,logExecution} from '../src/execution-log.js';
import {buildFigmaHandoff} from '../src/figma-handoff.js';
import {ProductionStore} from '../src/production-store.js';
import {buildPublishPlan} from '../src/figma-registry.js';
import {ProjectWorkspaces,figmaRegistryDirectory} from '../src/project-workspaces.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const opt=(name)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
const has=(name)=>args.includes(name);
const help=()=>console.log(`Usage: node scripts/figma-design.mjs --project <UUID> [--platform web|mobile] [--force] [--data-dir PATH] [--out PATH]
       node scripts/figma-design.mjs --project <UUID> --publish --channel <FIGMA_CHANNEL> --figma-file <FIGMA_FILE_KEY> [--platform web|mobile] [--force]

By default this only writes a local design pack. --publish explicitly invokes logged-in Codex CLI,
which uses the installed UI UX Pro Max skill and the configured TalkToFigma MCP server.
Uses CODEX_BIN and CODEX_MODEL from .env; CODEX_FIGMA_TIMEOUT_MS defaults to 600000 (max 10 minutes).
Progress metadata is printed with [BA Progress]; raw prompt/provider output is not printed.
Requires an open Figma file and connected plugin. Never use --publish on untrusted machines.`);
if(has('--help')){help();process.exit(0)}
const id=opt('--project');
if(!id||!/^[0-9a-f-]{36}$/i.test(id)){help();console.error('Invalid --project UUID');process.exit(2)}
const platform=opt('--platform')||'web';
if(!['web','mobile'].includes(platform)){console.error('Choose --platform web|mobile');process.exit(2)}
const channel=opt('--channel');
const figmaFile=opt('--figma-file');
if(figmaFile && !/^[\w-]{3,128}$/.test(figmaFile)){console.error('Invalid --figma-file');process.exit(2)}
if(has('--publish') && (!channel || !/^[a-zA-Z0-9_-]{1,128}$/.test(channel))){console.error('Publishing requires a valid --channel (1-128 letters/digits/_/-).');process.exit(2)}
if(has('--publish') && !figmaFile){console.error('Publishing requires --figma-file for an auditable, file-scoped registry.');process.exit(2)}
const dataDir=path.resolve(opt('--data-dir')||process.env.DATA_DIR||path.join(root,'data'));
const outputRoot=opt('--out')?path.resolve(opt('--out')):null;
let store;
try{
  store=new ProductionStore(dataDir);
  await store.importLegacy();
  const workspaces=new ProjectWorkspaces(store);
  await workspaces.migrateLegacy(id);
  const project=store.get(id);
  if(project.id!==id)throw new Error('Project ID mismatch');
  const handoff=buildFigmaHandoff(project,{platform});
  const registryDir=figmaRegistryDirectory(dataDir,id);
  const registryFile=figmaFile?path.join(registryDir,`${figmaFile}.json`):null;
  const legacyRegistry=figmaFile?path.join(dataDir,'.figma-registry',id,`${figmaFile}.json`):null;
  const sourceRegistry=registryFile&&existsSync(registryFile)?registryFile:legacyRegistry&&existsSync(legacyRegistry)?legacyRegistry:null;
  const registry=sourceRegistry?JSON.parse(await fs.readFile(sourceRegistry,'utf8')):null;
  if(registry&&(registry.documentKey!==figmaFile||registry.projectId!==id))throw new Error('Figma registry file/project mismatch');
  const plan=buildPublishPlan(handoff.manifest,registry);plan.documentKey=figmaFile||null;
  // Reconcile manually deleted/edited frames by opting into full recreation.
  if(has('--force'))for(const screen of plan.screens)screen.action='create';
  const runDir=outputRoot?path.join(outputRoot,`${id}-v${project.version}-${platform}`):path.join(workspaces.root(id),'04-figma','exports',`v${project.version}-${platform}`);
  await fs.mkdir(runDir,{recursive:true,mode:0o700});
  await Promise.all([
    fs.writeFile(path.join(runDir,'BRD.md'),handoff.brd,{mode:0o600}),
    fs.writeFile(path.join(runDir,'SRS.md'),handoff.srs,{mode:0o600}),
    fs.writeFile(path.join(runDir,'canonical.json'),JSON.stringify(handoff.canonical,null,2),{mode:0o600}),
    fs.writeFile(path.join(runDir,'figma-manifest.json'),JSON.stringify(handoff.manifest,null,2),{mode:0o600}),
    fs.writeFile(path.join(runDir,'FIGMA_INSTRUCTIONS.md'),handoff.instructions,{mode:0o600}),
    fs.writeFile(path.join(runDir,'figma-publish-plan.json'),JSON.stringify(plan,null,2),{mode:0o600}),
  ]);
  console.log('Figma Design Pack:',runDir);
  if(!has('--publish')){
    console.log('Offline handoff generated. To draw in Figma, connect the Figma plugin and rerun with --publish --channel YOUR_CHANNEL.');
    process.exit(0);
  }
  if(!existsSync(path.join(runDir,'figma-manifest.json')))throw new Error('Missing manifest');
  if(plan.screens.every(s=>s.action==='skip')){console.log('No new create actions; unchanged screens already have operator reports for file',figmaFile);process.exit(0)}
  const schemaFile=path.join(runDir,'figma-report-schema.json');
  const reportFile=path.join(runDir,'figma-run-report.json');
  const reportSchema={type:'object',additionalProperties:false,required:['documentKey','screens','notes'],properties:{documentKey:{type:'string'},screens:{type:'array'},notes:{type:'string'}}};
  await fs.writeFile(schemaFile,JSON.stringify(reportSchema,null,2),{mode:0o600});
  console.log('Invoking Codex CLI. This will request changes to the currently open Figma document.');
  const timeoutMs=process.env.CODEX_FIGMA_TIMEOUT_MS||600000;
  const published=await withExecutionContext({projectId:id,stage:'FIGMA_PUBLISH',provider:'codex',model:process.env.CODEX_MODEL||'codex-cli',executionId:randomUUID()},async()=>{
    logExecution('FIGMA_PUBLISH_START',{version:project.version});
    return publishFigmaDesign({project,designPack:handoff,documentKey:figmaFile,channelId:channel,outputDirectory:runDir,registry,force:has('--force'),runner:(prompt,schema,options)=>runCodexStructured(prompt,schema,{...options,timeoutMs})});
  });
  const report=published.report;
  const accepted={registry:published.registry,completed:published.completed,skipped:published.skipped};
  await fs.mkdir(registryDir,{recursive:true,mode:0o700});
  const lease=store.acquireLease(id);
  const reportTmp=reportFile+'.'+randomUUID()+'.tmp',registryTmp=registryFile+'.'+randomUUID()+'.tmp';
  try{
    await fs.writeFile(reportTmp,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
    await fs.writeFile(registryTmp,JSON.stringify(accepted.registry,null,2),{mode:0o600,flag:'wx'});
    // Fence the final version check and synchronous renames against cooperating SQLite writers.
    // The two filesystem renames are not a crash-atomic multi-file transaction.
    store.tx(()=>{
      if(!store.renewLease(id,lease))throw new Error('Publish commit lease expired or superseded');
      const latest=store.get(id);
      if(latest.version!==project.version)throw new Error('Project changed during publish; do not accept stale Figma report');
      const currentSource=existsSync(registryFile)?registryFile:legacyRegistry&&existsSync(legacyRegistry)?legacyRegistry:null;
      const currentRegistry=currentSource?JSON.parse(readFileSync(currentSource,'utf8')):null;
      if(JSON.stringify(currentRegistry)!==JSON.stringify(registry))throw new Error('Figma registry changed during publish; inspect Figma before retrying');
      renameSync(reportTmp,reportFile);renameSync(registryTmp,registryFile);
    });
    logExecution('FIGMA_REPORT_VALIDATED',{projectId:id,stage:'FIGMA_PUBLISH',version:project.version});
  }finally{
    try{await Promise.all([fs.rm(reportTmp,{force:true}),fs.rm(registryTmp,{force:true})]);}
    finally{store.releaseLease(id,lease);}
  }
  logExecution('FIGMA_REGISTRY_COMMITTED',{projectId:id,stage:'FIGMA_PUBLISH',version:project.version});
  console.log(`Figma operator report accepted: ${accepted.completed} reported nodes; ${accepted.skipped} unchanged screens skipped.`);
  console.log('Operator must still inspect live Figma for visual quality, correct file and native links.');
}catch(e){logExecution('FIGMA_PUBLISH_ERROR',{projectId:id,stage:'FIGMA_PUBLISH',errorCode:e?.status===504?'TIMEOUT':'PUBLISH_FAILED'});console.error('Figma export failed:',e.message);process.exitCode=1}
finally{store?.db.close()}
