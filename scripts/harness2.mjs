/** Explicit offline launcher; never loads application .env or provider modules. */
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {homedir,tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=dirname(dirname(fileURLToPath(import.meta.url)));
const python=process.env.HARNESS2_PYTHON||join(homedir(),'.local/share/ba-benchmarks/harness2/.venv/bin/python');
if(!existsSync(python)){
 console.error('Harness2 Python environment missing. Set HARNESS2_PYTHON to its venv Python; see docs/HARNESS2_BENCHMARK.md.');
 process.exit(1);
}
const [action,...args]=process.argv.slice(2);
if(!['test','live-test','run'].includes(action)){console.error('Use harness2.mjs test|live-test|run [--output DIR --mode sequential|parallel --k 1 --seed 42]');process.exit(1);}
// The child runs away from the application's .env; keep CLI paths relative to the caller.
for(let i=0;i<args.length;i++){
 if(args[i]==='--output'&&args[i+1]){args[i+1]=resolve(args[i+1]);i++;}
 else if(args[i].startsWith('--output='))args[i]='--output='+resolve(args[i].slice('--output='.length));
}
const result=spawnSync(python,[join(root,'scripts/harness2',action==='test'?'test_adapter.py':action==='live-test'?'test_live.py':'run.py'),...args],{
 stdio:'inherit',cwd:tmpdir(),shell:false,
 env:{PATH:process.env.PATH||'/usr/bin:/bin',LANG:'en_US.UTF-8',BA_HARNESS2_NODE:process.execPath,PYTHONDONTWRITEBYTECODE:'1'},
});
if(result.error)console.error(result.error.message);
process.exit(result.status??1);
