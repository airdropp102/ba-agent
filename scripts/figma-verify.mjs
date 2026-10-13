#!/usr/bin/env node
import {loadDotEnv} from './load-env.mjs';
await loadDotEnv();
/** Explicit read-back via connected Codex MCP. Agent-provided reports are not signed Figma attestations. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
const argv=process.argv.slice(2), opt=k=>argv[argv.indexOf(k)+1];
const id=opt('--project'),key=opt('--figma-file');
if(!/^[0-9a-f-]{36}$/i.test(id||'')||!/^[\w-]{3,128}$/.test(key||'')){
  console.error('Usage: node scripts/figma-verify.mjs --project <UUID> --figma-file <FIGMA_KEY> [--base http://127.0.0.1:3478]');process.exit(2);
}
const base=opt('--base')||'http://127.0.0.1:3478';
if(!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base))throw new Error('Only local BA Studio endpoint permitted by CLI');
const headers={'Content-Type':'application/json',...(process.env.BA_STUDIO_TOKEN?{Authorization:`Bearer ${process.env.BA_STUDIO_TOKEN}`}:{}) ,...(process.env.BA_STUDIO_REVIEWER_TOKEN?{'X-BA-Reviewer-Token':process.env.BA_STUDIO_REVIEWER_TOKEN}:{})};
const post=async(route,data)=>{const r=await fetch(base+route,{method:'POST',headers,body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw new Error(`BA Studio ${r.status}: ${value.error}`);return value};
const route=`/api/projects/${id}/workflow/figma`;
let tmp;
try{
  const challenge=await post(route+'/challenge',{documentKey:key});
  tmp=await fs.mkdtemp(path.join(os.tmpdir(),'ba-figma-readback-'));
  const schema={type:'object',additionalProperties:false,required:['nonce','documentKey','documentInfoRead','reportedFileKey','screens'],properties:{
    nonce:{type:'string'},documentKey:{type:'string'},documentInfoRead:{type:'boolean'},reportedFileKey:{type:'string'},
    screens:{type:'array',items:{type:'object',additionalProperties:false,required:['screenId','nodeId','nodeType','nodeName','readbackOk'],properties:{screenId:{type:'string'},nodeId:{type:'string'},nodeType:{type:'string'},nodeName:{type:'string'},readbackOk:{type:'boolean'}}}}
  }};
  const schemaFile=path.join(tmp,'schema.json'),reportFile=path.join(tmp,'report.json');
  await fs.writeFile(schemaFile,JSON.stringify(schema),{mode:0o600});
  const prompt=`You are a verification-only Codex agent with MCP. Do not create/edit/remove Figma nodes. Use ONLY live Figma MCP get_document_info and get_node_info/get_nodes_info. Read current document identity and each specified node. If MCP tool does not expose a trustworthy Figma file key, STOP without success. If document file key does not equal ${JSON.stringify(key)}, STOP without success. Read every listed node ID; confirm type FRAME, exact name, and identity. Never invent confirmations or copy expected values when live MCP call fails. Do not read customer local files. Produce JSON only according to schema. Challenge nonce ${JSON.stringify(challenge.nonce)}, documentKey ${JSON.stringify(key)}. Expected screens: ${JSON.stringify(challenge.screens)}. Set documentInfoRead true and reportedFileKey only after actual get_document_info, set readbackOk true only after actual live node read. Any unavailable tools or mismatch: fail without claiming success.`;
  const cli=process.env.CODEX_BIN||'codex';
  const child=spawn(cli,['exec','--sandbox','read-only','--skip-git-repo-check','--output-schema',schemaFile,'--output-last-message',reportFile,'-'],{cwd:tmp,stdio:['pipe','inherit','inherit']});
  const timeout=setTimeout(()=>child.kill('SIGKILL'),180000);timeout.unref();
  child.stdin.on('error',()=>{});child.stdin.end(prompt);
  const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)}).finally(()=>clearTimeout(timeout));
  if(status!==0)throw new Error('Codex/MCP verification did not succeed');
  const report=JSON.parse(await fs.readFile(reportFile,'utf8'));
  const updated=await post(route+'/readback',{report});
  console.log(JSON.stringify({status:updated.workflow.state,readback:updated.workflow.figmaResult.readback},null,2));
  console.log('Read-back is an MCP operator report, NOT independently signed Figma evidence or visual BA approval.');
}catch(e){console.error('Figma read-back failed:',e.message);process.exitCode=1}
finally{if(tmp)await fs.rm(tmp,{recursive:true,force:true}).catch(()=>{})}
