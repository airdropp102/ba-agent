import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {runCodexStructured} from '../src/codex-provider.js';

const schema={type:'object',properties:{screens:{type:'array'}},required:['screens'],additionalProperties:false};
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
