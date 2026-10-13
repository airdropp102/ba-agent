#!/usr/bin/env node
/** Idempotent local setup; never installs external software or overwrites secrets. */
import fs, {constants} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import os from 'node:os';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2);
const has=x=>args.includes(x);
const option=x=>args.find(a=>a.startsWith(x+'='))?.slice(x.length+1);
const envPath=path.join(root,'.env');
try{
 try{await fs.copyFile(path.join(root,'.env.example'),envPath,constants.COPYFILE_EXCL);await fs.chmod(envPath,0o600);console.log('Created .env from example (DEMO mode).');}
 catch(e){if(e.code!=='EEXIST')throw e;console.log('Existing .env preserved.');}
 await fs.mkdir(path.join(root,'data'),{recursive:true,mode:0o700});
 const target=option('--install-skills');
 if(target){
   if(!['codex','claude','both'].includes(target))throw new Error('--install-skills=codex|claude|both');
   const targets=target==='both'?['codex','claude']:[target];
   const skillDirs=(await fs.readdir(path.join(root,'skills'),{withFileTypes:true})).filter(d=>d.isDirectory()&&d.name.startsWith('ba-'));
   for(const runtime of targets){
     const dest=path.join(os.homedir(),runtime==='codex'?'.agents/skills':'.claude/skills');
     await fs.mkdir(dest,{recursive:true});
     for(const skill of skillDirs){
       try{await fs.cp(path.join(root,'skills',skill.name),path.join(dest,skill.name),{recursive:true,errorOnExist:true,force:false});console.log(`Installed ${runtime}/${skill.name}`)}
       catch(e){if(e.code!=='ERR_FS_CP_EEXIST')throw e;console.log(`Kept existing ${runtime}/${skill.name} (no overwrite)`)}
     }
   }
 }
 const doctor=spawn(process.execPath,['scripts/doctor.mjs',...(has('--figma')?['--figma']:[])],{cwd:root,stdio:'inherit',env:process.env});
 const status=await new Promise((resolve,reject)=>{doctor.once('error',reject);doctor.once('close',code=>resolve(code))});
 if(status!==0){console.error('Preflight failed. Fix the reported issues before starting.');process.exitCode=1;}
 else if(has('--start')){
   console.log('Starting BA Studio. Stop with Ctrl+C.');
   const server=spawn(process.execPath,['src/server.js'],{cwd:root,stdio:'inherit',env:process.env});
   for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.kill(signal));
   process.exitCode=await new Promise((resolve,reject)=>{server.once('error',reject);server.once('close',code=>resolve(code??0))});
 }else {
   const continuity=spawn(process.execPath,['scripts/session-continuity.mjs','bootstrap'],{cwd:root,stdio:'inherit',env:process.env});
   const result=await new Promise((resolve,reject)=>{continuity.once('error',reject);continuity.once('close',resolve)});
   if(result!==0)console.warn('Session continuity bootstrap requires review before starting work.');
   console.log('Ready. Run npm start, or npm run setup:start next time.');
 }
}catch(e){console.error('Setup failed:',e.message);process.exitCode=1}
