#!/usr/bin/env node
/** Optional Claude/Codex lifecycle hook. Fails open and NEVER fabricates uncommitted progress.
 * Parses only lifecycle metadata, never the transcript or secret-bearing tool outputs.
 */
import {readFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir} from 'node:fs/promises';
import {ProductionStore} from '../src/production-store.js';
import {SessionContinuity} from '../src/session-continuity.js';
const root=resolve(process.env.BA_CONTINUITY_ROOT||resolve(dirname(fileURLToPath(import.meta.url)),'..'));
const envPath=join(root,'.env');
try{const {existsSync}=await import('node:fs');if(existsSync(envPath))for(const line of readFileSync(envPath,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}}catch{}
const event=process.argv[2]||'SessionStart';
let meta={};
try{
 let source='';for await(const chunk of process.stdin){source+=chunk;if(source.length>65536)throw Error('Hook payload too large')}
 if(source.trim())meta=JSON.parse(source);
 const dir=resolve(process.env.DATA_DIR||join(root,'data'));
 await mkdir(dir,{recursive:true,mode:0o700});
 const store=new ProductionStore(dir),svc=new SessionContinuity(store.db,{root,dataDir:dir});
 try{
  const state=await svc.bootstrap({projectId:process.env.BA_ACTIVE_PROJECT_ID||undefined});
  if(event==='PreCompact'||event==='Stop'||event==='SessionEnd'){
    for(const task of state.active.slice(0,10))await svc.export(task.task.id);
  }
  const information=state.active.slice(0,5).map(x=>`${x.task.title} (${x.task.id}) status=${x.decision} version=${x.task.version}; next=${(x.latest?.payload?.next||[]).slice(0,3).join(' | ')}`).join('\n');
  const context=`BA Studio v3.5 continuity: ${state.recommendation}. ${information||'No unfinished task.'}\nRun npm run session:bootstrap and check repository worktree before editing. Do not assume this hook captured uncommitted context. Checkpoint after each milestone.`;
  if(event==='SessionStart')console.log(JSON.stringify({hookSpecificOutput:{hookEventName:'SessionStart',additionalContext:context}}));
  else if(event==='PreCompact')console.log(JSON.stringify({systemMessage:'BA Studio continuity handoff exported from committed checkpoint(s), not live conversation context.'}));
  else console.log(JSON.stringify({continue:true}));
 }finally{store.db.close()}
}catch(e){console.error('[continuity-hook] '+e.message);console.log(JSON.stringify({continue:true}));}
