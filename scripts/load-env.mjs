/** Minimal .env loader shared by operator CLIs; never overrides runtime environment. */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export async function loadDotEnv(){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 let source;try{source=await readFile(path.join(root,'.env'),'utf8')}catch(e){if(e.code==='ENOENT')return;throw e}
 for(const line of source.split(/\r?\n/)){
  const match=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
  if(match&&process.env[match[1]]===undefined)process.env[match[1]]=match[2].replace(/^(['"])(.*)\1$/,'$2');
 }
}
