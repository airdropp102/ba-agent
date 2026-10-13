import test from 'node:test';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';import path from 'node:path';
const cwd=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const run=(args)=>spawnSync(process.execPath,['scripts/live-acceptance.mjs',...args],{cwd,encoding:'utf8',env:{...process.env,DEMO_MODE:'true',AI_PROVIDER:'demo',OPENAI_API_KEY:''},timeout:6000});
test('CLI preflight rejects bundled synthetic template instead of claiming live acceptance',()=>{
 const p=run(['--preflight','--corpus','eval/live-gold-template.json']);
 assert.equal(p.status,2);assert.match(p.stderr,/synthetic\/demo cannot receive live acceptance/);
});
test('CLI never sends external requests from synthetic/demo mode',()=>{
 const p=run(['--run','--corpus','eval/live-gold-template.json','--out','/tmp/should-not-be-written.json','--confirm-external-processing']);
 assert.equal(p.status,2);assert.match(p.stderr,/Provenance must be real-anonymized/);
});
