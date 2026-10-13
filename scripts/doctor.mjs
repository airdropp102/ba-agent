#!/usr/bin/env node
/** Local, side-effect-free environment preflight. No keys or customer data logged. */
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {qualityPolicy} from '../src/quality-intelligence.js';
import {costRates} from '../src/ai-telemetry.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'.env');
if(existsSync(file))for(const line of readFileSync(file,'utf8').split(/\r?\n/)){
 const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
 if(m && process.env[m[1]]===undefined)process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');
}
const args=process.argv.slice(2);
const jsonMode=args.includes('--json');
const checkFigma=args.includes('--figma');
const checks=[];
function record(name,status,detail){checks.push({name,status,detail});}
function command(bin,commandArgs=[]){
 const r=spawnSync(bin,commandArgs,{encoding:'utf8',timeout:6000,windowsHide:true});
 return {ok:!r.error&&r.status===0,raw:String(r.stdout||r.stderr||''),message:r.error?.code||String(r.stdout||r.stderr||'').trim().split('\n')[0].slice(0,200)};
}
const [major,minor]=process.versions.node.split('.').map(Number);
record('Node.js',major>22||(major===22&&minor>=13)?'PASS':'FAIL',`v${process.versions.node}; SQLite requires >=22.13`);
for(const f of ['AGENTS.md','schemas/ba-canonical-v1.schema.json','skills/ba-orchestrating-analysis/SKILL.md','src/server.js'])
 record(f,existsSync(path.join(root,f))?'PASS':'FAIL','required project file');
const selected=process.env.DEMO_MODE!=='false'?'demo':(process.env.AI_PROVIDER||'openai').toLowerCase();
record('AI provider',['demo','codex','openai'].includes(selected)?'PASS':'FAIL',selected);
if(selected==='codex'){
 const cli=command(process.env.CODEX_BIN||'codex',['--version']);
 record('Codex CLI',cli.ok?'PASS':'FAIL',cli.message||'codex missing');
 if(cli.ok){const login=command(process.env.CODEX_BIN||'codex',['login','status']);record('Codex session',login.ok?'PASS':'WARN',login.ok?'login active':'login not verified; run codex login');}
}else if(selected==='openai')record('OPENAI_API_KEY',process.env.OPENAI_API_KEY?'PASS':'FAIL',process.env.OPENAI_API_KEY?'configured (value hidden)':'missing; set in .env');
else record('Demo mode','PASS','uses deterministic bundled sample; other briefs do not get AI analysis');
const host=process.env.HOST||'127.0.0.1';
const reviewerIdentity=process.env.REQUIRE_REVIEWER_IDENTITY==='true';
try{
 const identities=JSON.parse(process.env.BA_REVIEWER_TOKENS_JSON||'{}');
 const valid=Object.entries(identities).filter(([id,k])=>/^[a-zA-Z0-9_.@-]{3,100}$/.test(id)&&typeof k==='string'&&k.length>=32);
 record('Reviewer identities',(!reviewerIdentity||valid.length>0)?'PASS':'FAIL',`${valid.length} valid identity token(s) configured; identity requirement=${reviewerIdentity}`);
}catch{record('Reviewer identities','FAIL','BA_REVIEWER_TOKENS_JSON is invalid JSON')}

const external=!['127.0.0.1','localhost','::1'].includes(host);
record('Network binding',!external||(String(process.env.BA_STUDIO_TOKEN||'').length>=32&&process.env.REQUIRE_REVIEWER_IDENTITY==='true')?'PASS':'FAIL',external?'remote bind; 32-character API token, reviewer identity, HTTPS proxy/VPN required':'localhost only');
if(checkFigma){
 const bun=command('bun',['--version']);record('Bun (Figma socket)',bun.ok?'PASS':'FAIL',bun.message||'bun missing');
 const codex=command(process.env.CODEX_BIN||'codex',['mcp','list']);
 record('Codex MCP list',codex.ok?'PASS':'FAIL',codex.message||'codex mcp list failed');
 if(codex.ok)record('TalkToFigma MCP',/talktofigma|cursor-talk-to-figma/i.test(codex.raw)?'PASS':'WARN','Check live channel/plugin separately (not verified by doctor)');
}
try{const settings=qualityPolicy();record('Quality gate policy','PASS',`enforce=${settings.enforce}; minScore=${settings.minScore}`)}
catch(e){record('Quality gate policy','FAIL',e.message)}
try{const rates=costRates();const models=Object.keys(rates);record('AI price catalog',models.length?'PASS':'WARN',models.length?`${models.length} models configured by operator`:'No operator-verified price rates; USD cost shown as UNKNOWN')}
catch(e){record('AI price catalog','FAIL',e.message)}
const result={status:checks.some(c=>c.status==='FAIL')?'FAIL':'PASS',provider:selected,checks};
if(jsonMode)console.log(JSON.stringify(result,null,2));
else for(const c of checks)console.log(`[${c.status}] ${c.name}: ${c.detail}`);
process.exitCode=result.status==='FAIL'?1:0;
