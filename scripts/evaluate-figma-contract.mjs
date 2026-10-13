#!/usr/bin/env node
import {loadDotEnv} from './load-env.mjs';
await loadDotEnv();
import {validateLiveProbe,liveProbeSchema} from '../src/figma-mcp-contract.js';
import {runCodexStructured} from '../src/codex-provider.js';
const a=process.argv.slice(2),opt=k=>a.includes(k)?a[a.indexOf(k)+1]:undefined;
const file=opt('--file'),node=opt('--node'),name=opt('--name');
if(!a.includes('--live')){
 const expected={documentKey:'contract-fixture',nodeId:'1:1',nodeName:'Dashboard'};
 const base={...expected,documentRead:true,nodeRead:true,nodeType:'FRAME',observedToolNames:['get_document_info','get_node_info']};
 const passing=validateLiveProbe(base,expected);
 let negatives=0;
 for(const change of [{documentKey:'different'},{nodeRead:false},{nodeType:'RECTANGLE'},{observedToolNames:[]}]){
  try{validateLiveProbe({...base,...change},expected)}catch{negatives++}
 }
 if(negatives!==4)process.exitCode=1;
 console.log(JSON.stringify({suite:'figma-mcp-contract-offline',mode:'fixture-only',positive:passing.passed?1:0,negativeCasesRejected:negatives,total:5,liveMcpVerified:false},null,2));
}else{
 if(!/^[\w-]{3,128}$/.test(file||'')||!/^\d+:\d+$/.test(node||'')){console.error('Use --live --file <file-key> --node <N:N> [--name <expected frame name>]. Requires connected Codex Figma MCP.');process.exit(2)}
 const prompt=`Read-only Figma MCP integration contract probe. Actually invoke the MCP get_document_info and get_node_info (or get_nodes_info) tools on the connected Figma file. File key: ${JSON.stringify(file)}, node ID: ${JSON.stringify(node)}. Do not create/edit any node. Never infer success from these expected values. Return exactly the provided JSON schema; documentRead/nodeRead must be false if live reads fail; observedToolNames must list the exact tools ACTUALLY invoked. Return the actual file key, node ID, FRAME type and frame name from MCP responses. On missing/unauthorized/unavailable MCP tool, fail rather than fabricating any read result.`;
 const result=await runCodexStructured(prompt,liveProbeSchema);
 const validated=validateLiveProbe(result,{documentKey:file,nodeId:node,...(name?{nodeName:name}:{})});
 console.log(JSON.stringify({suite:'figma-mcp-contract',mode:'live-operator-reported',...validated,liveMcpVerified:'operator-reported, no independent attestation'},null,2));
}
