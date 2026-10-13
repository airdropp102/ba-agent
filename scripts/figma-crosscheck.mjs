#!/usr/bin/env node
/** Independent, read-only Figma REST verification of a prior live MCP operator read-back. */
import {loadDotEnv} from './load-env.mjs';await loadDotEnv();
import fs from 'node:fs/promises';import path from 'node:path';
import {crosscheckFigmaRest} from '../src/live-acceptance.js';
const args=process.argv.slice(2),opt=k=>args.includes(k)?args[args.indexOf(k)+1]:null;
try{
 const [p,fileKey,nodeId,output]=[opt('--mcp-report'),opt('--file'),opt('--node'),opt('--out')];
 if(!p||!fileKey||!nodeId||!output||!args.includes('--confirm-read-only-figma'))throw new Error('Requires --mcp-report file --file key --node 1:2 --out proof.json --confirm-read-only-figma');
 const report=JSON.parse(await fs.readFile(path.resolve(p),'utf8'));
 if(report.mode!=='live-operator-reported'||!report.passed)throw new Error('Input must be a successful live (not fixture) MCP operator report');
 const attestation=await crosscheckFigmaRest(report,{fileKey,nodeId,nodeName:opt('--name')||undefined,token:process.env.FIGMA_ACCESS_TOKEN});
 const destination=path.resolve(output);await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
 await fs.writeFile(destination,JSON.stringify(attestation,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify({status:'CROSSCHECKED',output:destination,fileKey,nodeId,at:attestation.checkedAt},null,2));
}catch(e){console.error('Figma cross-check failed:',e.message);process.exitCode=2}
