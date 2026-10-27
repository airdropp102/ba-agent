import {readFile,writeFile,mkdir,lstat,access} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn,execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {resolve,dirname,join,delimiter} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareCorpora,admitCorpus,planCalls} from './harness2/live-corpus.mjs';
import {LIVE_GUIDANCE} from './harness2/live-runtime.mjs';
import {analysisPromptManifest} from '../src/ba-prompts.js';
import {digest} from '../src/live-acceptance.js';

const args=process.argv.slice(2),command=args.shift();
const known=new Set(['--dir','--corpus','--output','--model','--max-calls','--codex-bin','--synthetic-smoke','--confirm-external-processing']);
const options={};
const repository=dirname(dirname(fileURLToPath(import.meta.url)));
const help='Use prepare --dir PATH | preflight --corpus PATH [--synthetic-smoke] | run --corpus PATH --output NEW_DIR --model MODEL --max-calls N [--synthetic-smoke] --confirm-external-processing';
try{
 for(let i=0;i<args.length;i++){
  const key=args[i];if(!known.has(key)||Object.hasOwn(options,key))throw new Error(help);
  if(['--synthetic-smoke','--confirm-external-processing'].includes(key))options[key]=true;
  else{if(!args[i+1]||args[i+1].startsWith('--'))throw new Error(help);options[key]=args[++i];}
 }
 if(command==='prepare'){
  if(!options['--dir'])throw new Error(help);
  console.log(JSON.stringify(await prepareCorpora(options['--dir']),null,2));
 }else if(['preflight','run'].includes(command)){
  if(!options['--corpus'])throw new Error(help);
  const corpusFile=resolve(options['--corpus']);const st=await lstat(corpusFile);
  if(!st.isFile()||st.isSymbolicLink()||st.size>10_000_000)throw new Error('Corpus must be a bounded regular file');
  let corpus;try{corpus=JSON.parse(await readFile(corpusFile,'utf8'));}catch{throw new Error('Invalid corpus JSON');}
  const admitted=admitCorpus(corpus,{kind:options['--synthetic-smoke']?'synthetic-smoke':'reviewed'}),plan=planCalls(admitted.tasks);
  if(command==='preflight')console.log(JSON.stringify({kind:admitted.kind,corpusHash:admitted.corpusHash,plan,productionAccepted:false,externalCalls:0,warning:'No network/auth check; provenance remains operator-attested. Synthetic cannot pass real acceptance.'},null,2));
  else{
   const maxCalls=Number(options['--max-calls']);
   if(!options['--confirm-external-processing'])throw new Error('Explicit --confirm-external-processing required before transmission');
   if(!Number.isSafeInteger(maxCalls)||maxCalls<plan.plannedCalls||maxCalls>2000)throw new Error(`Need an explicit invocation cap >= planned ${plan.plannedCalls}, maximum 2000`);
   if(!options['--model']||!options['--output'])throw new Error(help);
   const python=process.env.HARNESS2_PYTHON||join(homedir(),'.local/share/ba-benchmarks/harness2/.venv/bin/python');
   await access(python);
   const bin=options['--codex-bin']||String(process.env.PATH||'').split(delimiter).map(p=>join(p,'codex')).find(existsSync);
   if(!bin)throw new Error('Native Codex CLI required');
   const authFile=join(process.env.CODEX_HOME||join(homedir(),'.codex'),'auth.json');await access(authFile);
   const output=resolve(options['--output']);await mkdir(dirname(output),{recursive:true,mode:0o700});await mkdir(output,{mode:0o700});
   const config={schemaVersion:'ba.harness2.live-config.v1',kind:admitted.kind,consent:true,consentScope:'CLI operator approved transmission of admitted briefs/outputs to selected Codex model for solver and improver',createdAt:new Date().toISOString(),corpusFile,corpusHash:admitted.corpusHash,tasks:admitted.tasks,model:options['--model'],maxCalls,output,codexBin:resolve(bin),authFile,plan,upstreamRevision:'1cfe254e8d25b15f37048c3730134686abe60335',policy:analysisPromptManifest(),catalogSha256:digest(LIVE_GUIDANCE),codexVersion:execFileSync(bin,['--version'],{encoding:'utf8'}).trim()};
   const configFile=join(output,'config.json');await writeFile(configFile,JSON.stringify(config,null,2)+'\n',{mode:0o600,flag:'wx'});
   const child=spawn(python,[join(repository,'scripts/harness2/live.py'),'--config',configFile],{cwd:output,env:{PATH:process.env.PATH,BA_HARNESS2_NODE:process.execPath,PYTHONDONTWRITEBYTECODE:'1',LANG:'en_US.UTF-8'},stdio:'inherit',shell:false});
   process.exitCode=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',code=>done(code??1));});
   console.log(JSON.stringify({output,report:join(output,'report.json'),invocations:join(output,'invocations.json'),productionAccepted:false},null,2));
  }
 }else throw new Error(help);
}catch(error){console.error(`Harness2 live: ${error.message}`);process.exitCode=2;}
