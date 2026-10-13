/** Contract of a read-only Figma MCP operator report, not signed attestation. */
export const FIGMA_CONTRACT_VERSION='ba.figma-mcp-readback.v3.4';
export const liveProbeSchema={type:'object',additionalProperties:false,required:['documentKey','documentRead','nodeId','nodeRead','nodeType','nodeName','observedToolNames'],properties:{
 documentKey:{type:'string'},documentRead:{type:'boolean'},nodeId:{type:'string'},nodeRead:{type:'boolean'},nodeType:{type:'string'},nodeName:{type:'string'},observedToolNames:{type:'array',items:{type:'string'}}
}};
export function validateLiveProbe(probe,{documentKey,nodeId,nodeName}={}){
 if(!probe||typeof probe!=='object'||Array.isArray(probe))throw new Error('Probe must be an object');
 if(!probe.documentRead||!probe.nodeRead)throw new Error('MCP document and node read must both succeed');
 if(probe.documentKey!==documentKey||probe.nodeId!==nodeId)throw new Error('Figma file/node scope mismatch');
 if(probe.nodeType!=='FRAME')throw new Error('Expected Figma FRAME node');
 if(nodeName!==undefined&&probe.nodeName!==nodeName)throw new Error('Figma node name mismatch');
 const tools=probe.observedToolNames;
 if(!Array.isArray(tools)||tools.length<2||!tools.every(x=>typeof x==='string'&&x.length<128))throw new Error('Missing recorded read-only MCP tools');
 if(!tools.some(x=>/get_document_info/i.test(x))||!tools.some(x=>/get_node_info|get_nodes_info/i.test(x)))throw new Error('Required MCP tool family not observed');
 return {contract:FIGMA_CONTRACT_VERSION,passed:true,source:'operator-reported-live-probe-not-cryptographic-attestation',documentKey,nodeId,nodeName:probe.nodeName};
}
