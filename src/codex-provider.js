import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {validateModelOutput} from './model-output.js';

/** Codex CLI with ChatGPT login: no shell, no project FS, no API key. */
export async function runCodexStructured(prompt,schema,{bin=process.env.CODEX_BIN||'codex',timeoutMs=Number(process.env.CODEX_TIMEOUT_MS||120000)}={}) {
  const ms=Math.min(Math.max(100,Number(timeoutMs)||120000),600000);
  const dir=await mkdtemp(path.join(os.tmpdir(),'ba-codex-'));
  const schemaFile=path.join(dir,'schema.json');
  const outputFile=path.join(dir,'result.json');
  try {
    await writeFile(schemaFile,JSON.stringify(schema),{mode:0o600});
    const args=['exec','--sandbox','read-only','--skip-git-repo-check','--output-schema',schemaFile,'--output-last-message',outputFile,'-'];
    const proc=spawn(bin,args,{cwd:dir,env:process.env,stdio:['pipe','ignore','pipe'],shell:false});
    let errorOutput='';
    proc.stderr.on('data',d=>{if(errorOutput.length<6000)errorOutput+=d.toString().slice(0,6000-errorOutput.length)});
    proc.stdin.on('error',()=>{});
    proc.stdin.end(prompt);
    let timedOut=false;
    const timeout=setTimeout(()=>{timedOut=true;proc.kill('SIGKILL');},ms);
    let exitCode;
    try {
      exitCode=await new Promise((resolve,reject)=>{proc.on('error',reject);proc.on('close',(code,signal)=>resolve(code??(signal?1:0)))});
    } finally {clearTimeout(timeout)}
    if(timedOut)throw Object.assign(new Error('Codex CLI timeout: vượt thời hạn xử lý.'),{status:504});
    if(exitCode!==0)throw Object.assign(new Error(`Codex CLI thất bại (exit ${exitCode}). Kiểm tra codex login status, model và hạn mức. Chi tiết trong log máy chủ; không đưa dữ liệu khách hàng vào HTTP lỗi.`),{status:502});
    const content=await readFile(outputFile,'utf8');
    if(content.length>2_000_000)throw new Error('Codex output vượt 2 MB');
    const value=JSON.parse(content);
    if(!value || typeof value!=='object'||Array.isArray(value))throw new Error('Codex output không phải JSON object');
    return validateModelOutput(value,schema);
  } finally {await rm(dir,{recursive:true,force:true})}
}
