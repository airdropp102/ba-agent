import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {runCodexStructured} from '../src/codex-provider.js';

const schema={type:'object',properties:{screens:{type:'array'}},required:['screens'],additionalProperties:false};
test('Figma tool approval overrides stay scoped to each phase and preserve the shell sandbox',async()=>{
 const {FIGMA_APPROVED_TOOLS}=await import('../src/figma-codex-policy.js');
 const {readFile}=await import('node:fs/promises');
 const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-codex-figma-policy-'));
 try{
  const bin=path.join(tmp,'mock-codex'),argsFile=path.join(tmp,'args.json');
  await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(args));process.stdin.resume();process.stdin.on('end',()=>fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({screens:[]})));
`,{mode:0o700});
  for(const phase of [undefined,'preflight','design','preview']){
   await runCodexStructured('Synthetic fixture',schema,{bin,figmaToolPhase:phase,timeoutMs:5000});
   const args=JSON.parse(await readFile(argsFile,'utf8'));assert.equal(args[args.indexOf('--sandbox')+1],'read-only');
   const configs=args.filter((arg,i)=>args[i-1]==='-c');
   if(phase===undefined){assert.deepEqual(configs,[]);continue;}
   const enabled=JSON.parse(configs.find(x=>x.startsWith('mcp_servers.TalkToFigma.enabled_tools=')).split('=')[1]);
   const expected=phase==='preflight'?['join_channel','get_document_info','get_selection']:phase==='preview'?['join_channel','get_document_info','get_node_info','export_node_as_image']:[...FIGMA_APPROVED_TOOLS];
   assert.deepEqual(enabled,expected);assert.equal(FIGMA_APPROVED_TOOLS.length,27);
   assert.ok(enabled.every(tool=>!tool.startsWith('delete')));
   assert.equal(configs.length,1+expected.length);
   for(const tool of expected)assert.ok(configs.includes(`mcp_servers.TalkToFigma.tools.${tool}.approval_mode="approve"`));
  }
  await assert.rejects(runCodexStructured('Synthetic fixture',schema,{bin,figmaToolPhase:'unknown',timeoutMs:5000}),/Invalid Figma tool phase/);
 }finally{await rm(tmp,{recursive:true,force:true})}
});

test('Codex provider safely invokes non-interactive CLI and parses JSON without API key',async()=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-codex-test-'));
  try{
    const bin=path.join(tmp,'mock-codex');
    await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs');const args=process.argv.slice(2);
if(args[0]!=='exec'||!args.includes('--sandbox')||!args.includes('--output-schema')||!args.includes('--output-last-message')||args.at(-1)!=='-')process.exit(32);
let input='';process.stdin.on('data',d=>input+=d);process.stdin.on('end',()=>{if(!input.includes('BA rules'))process.exit(33);fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({screens:[]}));});
`,{mode:0o700});
    const result=await runCodexStructured('BA rules',schema,{bin,timeoutMs:5000});
    assert.deepEqual(result,{screens:[]});
  }finally{await rm(tmp,{recursive:true,force:true})}
});
test('Codex provider fails closed on malformed JSON and on timeout',async()=>{
  const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-codex-bad-'));
  try{
    const bin=path.join(tmp,'bad-codex');
    await writeFile(bin,'#!/usr/bin/env node\nsetInterval(()=>{},100000);\n',{mode:0o700});
    await assert.rejects(runCodexStructured('BA rules',schema,{bin,timeoutMs:250}),/timeout|hạn/i);
  }finally{await rm(tmp,{recursive:true,force:true})}
});

test('Codex schema guard rejects nested malformed screen objects',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-schema-test-'));
 try{
   const bin=path.join(tmp,'bad-shape');
   await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs');const a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify({screens:['not an object']}));
`,{mode:0o700});
   const nested={type:'object',additionalProperties:false,required:['screens'],properties:{screens:{type:'array',items:{type:'object',additionalProperties:false,required:['id'],properties:{id:{type:'string'}}}}}};
   await assert.rejects(runCodexStructured('BA rules',nested,{bin,timeoutMs:5000}),/schema/i);
 }finally{await rm(tmp,{recursive:true,force:true})}
});

test('Codex timeout terminates descendants instead of waiting for an orphan holding stderr',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-codex-tree-'));let childPid,cleanup;
 try{
  const bin=path.join(tmp,'forking-codex'),pidFile=path.join(tmp,'child.pid');
  await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),cp=require('child_process');
const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{stdio:['ignore','ignore','inherit']});
fs.writeFileSync(${JSON.stringify(pidFile)},String(child.pid));setInterval(()=>{},10000);
`,{mode:0o700});
  cleanup=setTimeout(async()=>{try{childPid=Number(await (await import('node:fs/promises')).readFile(pidFile,'utf8'));process.kill(childPid,'SIGKILL');}catch{}},3500);
  const started=Date.now();await assert.rejects(runCodexStructured('Synthetic prompt',schema,{bin,timeoutMs:1000}),/timeout/i);
  assert.ok(Date.now()-started<2500,'timeout should close the whole CLI process tree promptly');
 }finally{clearTimeout(cleanup);if(childPid)try{process.kill(childPid,'SIGKILL')}catch{}await rm(tmp,{recursive:true,force:true});}
});

test('Codex progress logs show elapsed phase and input sizes without prompt or raw CLI output',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-codex-progress-')),logs=[];
 const previous=console.info;console.info=(...args)=>logs.push(args.join(' '));
 try{
  const bin=path.join(tmp,'progress-codex');
  await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),args=process.argv.slice(2);process.stdin.resume();
process.stderr.write('RAW_PRIVATE_CUSTOMER_TEXT sk-private-token');
setTimeout(()=>{fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({screens:[]}));},90);
`,{mode:0o700});
  await runCodexStructured('PRIVATE_CUSTOMER_PROMPT',schema,{bin,timeoutMs:5000,heartbeatMs:20});
  const text=logs.join('\n');assert.match(text,/CLI_START/);assert.match(text,/CLI_WAITING/);assert.match(text,/OUTPUT_VALIDATED/);assert.match(text,/promptBytes/);assert.match(text,/elapsedMs/);
  assert.doesNotMatch(text,/PRIVATE_CUSTOMER_PROMPT|RAW_PRIVATE_CUSTOMER_TEXT|sk-private-token/);
 }finally{console.info=previous;await rm(tmp,{recursive:true,force:true});}
});

test('default Codex timeout is five minutes and invalid settings retain bounded fallback',async()=>{
 const {codexTimeoutMs}=await import('../src/codex-provider.js');
 assert.equal(codexTimeoutMs(undefined),300000);assert.equal(codexTimeoutMs('bad'),300000);assert.equal(codexTimeoutMs(999999),600000);assert.equal(codexTimeoutMs(250),250);
});

test('configured Codex model is explicitly passed to CLI instead of relying on a global default',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-codex-model-'));
 try{
  const bin=path.join(tmp,'model-codex');await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2);if(a[a.indexOf('--model')+1]!=='configured-test-model')process.exit(41);
process.stdin.resume();process.stdin.on('end',()=>fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify({screens:[]})));
`,{mode:0o700});
  assert.deepEqual(await runCodexStructured('Synthetic prompt',schema,{bin,model:'configured-test-model',timeoutMs:5000}),{screens:[]});
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('malformed Codex output and unexpected schema keys do not expose private text in errors',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-codex-private-'));
 try{
  const bin=path.join(tmp,'private-codex');
  for(const output of ['PRIVATE_MODEL_CUSTOMER_TEXT',{screens:[],PRIVATE_MODEL_CUSTOMER_TEXT:'private'}]){
   await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2);fs.writeFileSync(a[a.indexOf('--output-last-message')+1],${JSON.stringify(typeof output==='string'?output:JSON.stringify(output))});
`,{mode:0o700});
   await assert.rejects(runCodexStructured('Synthetic prompt',schema,{bin,timeoutMs:5000}),error=>{assert.doesNotMatch(error.message,/PRIVATE_MODEL_CUSTOMER_TEXT/);assert.match(error.message,/JSON|schema/i);return true;});
  }
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('stopping the host with SIGTERM terminates its detached Codex descendants',async()=>{
 const {spawn}=await import('node:child_process'),{readFile}=await import('node:fs/promises');
 const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-codex-shutdown-'));let host,ids;
 try{
  const bin=path.join(tmp,'shutdown-codex'),pidFile=path.join(tmp,'pids.json'),runner=path.join(tmp,'runner.mjs');
  await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),cp=require('child_process');const child=cp.spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{stdio:['ignore','ignore','inherit']});
fs.writeFileSync(${JSON.stringify(pidFile)},JSON.stringify({cli:process.pid,child:child.pid}));setInterval(()=>{},10000);
`,{mode:0o700});
  await writeFile(runner,`import {runCodexStructured} from ${JSON.stringify(new URL('../src/codex-provider.js',import.meta.url).href)};await runCodexStructured('Synthetic',${JSON.stringify(schema)},{bin:${JSON.stringify(bin)},timeoutMs:5000});`);
  host=spawn(process.execPath,[runner],{stdio:'ignore'});
  for(let i=0;i<60;i++){try{ids=JSON.parse(await readFile(pidFile,'utf8'));break;}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.ok(ids,'descendant started');const exited=new Promise(resolve=>host.once('exit',resolve));host.kill('SIGTERM');await exited;
  await new Promise(r=>setTimeout(r,150));
  let alive=false;try{process.kill(ids.child,0);alive=true;}catch{}assert.equal(alive,false,'Codex descendant must not survive stopping its host');
 }finally{host?.kill('SIGKILL');if(ids)try{process.kill(-ids.cli,'SIGKILL')}catch{}await rm(tmp,{recursive:true,force:true});}
});

test('explicit operator working directory is readable while default structured calls remain isolated',async()=>{
 const {mkdir}=await import('node:fs/promises');const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-codex-cwd-'));
 try{
  const pack=path.join(tmp,'reviewed-pack');await mkdir(pack);await writeFile(path.join(pack,'BRD.md'),'Reviewed fixture');
  const bin=path.join(tmp,'pack-codex');await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2);if(!fs.existsSync('BRD.md'))process.exit(72);process.stdin.resume();process.stdin.on('end',()=>fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify({screens:[]})));
`,{mode:0o700});
  assert.deepEqual(await runCodexStructured('Synthetic operator prompt',schema,{bin,workingDirectory:pack,timeoutMs:5000}),{screens:[]});
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('Codex output limit remains 2 MB by default and can be raised for bounded single-screen JPEG export',async()=>{
 const tmp=await mkdtemp(path.join(os.tmpdir(),'ba-codex-output-limit-'));
 try{
  const bin=path.join(tmp,'large-codex'),largeSchema={type:'object',additionalProperties:false,required:['payload'],properties:{payload:{type:'string'}}};
  await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),a=process.argv.slice(2);process.stdin.resume();process.stdin.on('end',()=>fs.writeFileSync(a[a.indexOf('--output-last-message')+1],JSON.stringify({payload:'x'.repeat(2_100_000)})));
`,{mode:0o700});
  await assert.rejects(runCodexStructured('Synthetic export',largeSchema,{bin,timeoutMs:5000}),/2 MB/i);
  const value=await runCodexStructured('Synthetic export',largeSchema,{bin,timeoutMs:5000,maxOutputBytes:2_200_000});
  assert.equal(value.payload.length,2_100_000);
 }finally{await rm(tmp,{recursive:true,force:true});}
});

test('Codex attaches images with argv only inside the isolated pack and rejects external references',async()=>{
 const {readFile,mkdir,symlink}=await import('node:fs/promises');
 const dir=await mkdtemp(path.join(os.tmpdir(),'ba-image-argv-'));
 try{
  const pack=path.join(dir,'pack');await mkdir(pack);const image=path.join(pack,'reference.png'),argsFile=path.join(dir,'args.json'),bin=path.join(dir,'codex');await writeFile(image,'fixture');
  await writeFile(bin,`#!/usr/bin/env node
const fs=require('fs'),args=process.argv.slice(2);fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(args));process.stdin.resume();process.stdin.on('end',()=>fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({screens:[]})));
`,{mode:0o700});
  await runCodexStructured('Synthetic reference fixture',schema,{bin,workingDirectory:pack,imagePaths:[image]});const args=JSON.parse(await readFile(argsFile,'utf8'));assert.equal(args[args.indexOf('--image')+1],await (await import('node:fs/promises')).realpath(image));
  const outside=path.join(dir,'outside.png');await writeFile(outside,'fixture');await symlink(outside,path.join(pack,'escape.png'));
  await assert.rejects(runCodexStructured('Synthetic fixture',schema,{bin,workingDirectory:pack,imagePaths:[outside]}),/inside/);
  await assert.rejects(runCodexStructured('Synthetic fixture',schema,{bin,workingDirectory:pack,imagePaths:[path.join(pack,'escape.png')]}),/inside/);
 }finally{await rm(dir,{recursive:true,force:true})}
});
