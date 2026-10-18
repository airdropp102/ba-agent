const BA_ASSET_RUNS=new Map();
// BA Studio asset extension. No network requests or changes outside new run-owned screen slots.
async function handleBAAssetCommand(api,command,p={}){
 const protocol='ba.assets.v1',nodePattern=/^\d+:\d+$/,shaPattern=/^[a-f0-9]{64}$/;
 if(command==='ba_asset_capabilities'){if(p.runId){if(!/^[a-zA-Z0-9_-]{1,128}$/.test(p.runId))throw new Error('Invalid run scope');if(!BA_ASSET_RUNS.has(p.runId)){const frames=api.currentPage.findAllWithCriteria({types:['FRAME']});if(frames.length>20000)throw new Error('File is too large for a bounded asset snapshot');if(BA_ASSET_RUNS.size>=20)BA_ASSET_RUNS.delete(BA_ASSET_RUNS.keys().next().value);BA_ASSET_RUNS.set(p.runId,{pageId:api.currentPage.id,frames:new Set(frames.map(n=>n.id)),at:Date.now()})}}let documentKey='';try{documentKey=api.fileKey||''}catch{}return {protocol,documentKey,formats:['image/svg+xml','image/png','image/jpeg','image/webp']};}
 const fail=message=>{throw new Error(message)};
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(p.runId||'')||!nodePattern.test(p.screenNodeId||'')||!/^SCR-[\w-]{1,80}$/.test(p.screenId||'')||!nodePattern.test(p.slotNodeId||'')||!shaPattern.test(p.sha256||'')||! /^[a-f0-9-]{36}$/i.test(p.assetId||''))fail('Invalid asset placement scope');
 const snapshot=BA_ASSET_RUNS.get(p.runId);if(!snapshot||snapshot.pageId!==api.currentPage.id||Date.now()-snapshot.at>3600000||snapshot.frames.has(p.screenNodeId))fail('Asset import requires a fresh run snapshot and newly created screen');
 const screen=await api.getNodeByIdAsync(p.screenNodeId),slot=await api.getNodeByIdAsync(p.slotNodeId);
 if(!screen||screen.type!=='FRAME'||!slot||slot.type!=='RECTANGLE'||slot.name!=='BA_ASSET:'+p.assetId)fail('Expected a new screen and named rectangle slot');
 // A completed run can never be reused as an asset-import target.
 const owner=screen.getPluginData('baAssetRun'),closed=screen.getPluginData('baAssetClosed');
 if(closed&&command==='ba_import_asset'||owner&&owner!==p.runId)fail('Asset screen belongs to another or completed run');
 let parent=slot.parent,found=false;for(let i=0;parent&&i<64;i++,parent=parent.parent){if(parent.id===screen.id){found=true;break}}if(!found)fail('Asset slot is outside its planned screen');
 const identity=JSON.stringify({assetId:p.assetId,sha256:p.sha256,runId:p.runId,screenId:p.screenId});
 if(command==='ba_verify_asset'){
  const record=slot.getPluginData('baAssetIdentity');if(record!==identity)fail('Asset read-back identity mismatch');
  const id=slot.getPluginData('baAssetNode'),node=await api.getNodeByIdAsync(id);if(!node||node.getPluginData('baAssetIdentity')!==identity)fail('Imported asset node missing');let ancestor=node.parent,inside=false;for(let i=0;ancestor&&i<64;i++,ancestor=ancestor.parent){if(ancestor.id===screen.id){inside=true;break}}if(!inside)fail('Imported asset moved outside its screen');
  if(p.contentType!=='image/svg+xml'&&(!Array.isArray(slot.fills)||!slot.fills.some(fill=>fill.type==='IMAGE'&&fill.imageHash)))fail('Expected image fill missing');
  return {protocol,assetId:p.assetId,sha256:p.sha256,screenId:p.screenId,nodeId:node.id,verified:true};
 }
 if(command!=='ba_import_asset')fail('Unknown BA asset command');
 if(slot.getPluginData('baAssetIdentity'))fail('Slot already contains an imported asset; inspect the frame before retrying');
 if(!['image/svg+xml','image/png','image/jpeg','image/webp'].includes(p.contentType)||typeof p.data!=='string'||p.data.length>7100000)fail('Unsupported or oversized asset');
 screen.setPluginData('baAssetRun',p.runId);
 let node;
 if(p.contentType==='image/svg+xml'){
  if(p.data.length>262144||/<!|<\?|<\s*(script|foreignObject|style|image)\b|\son\w+\s*=|(?:https?:|data:|javascript:|file:)\s*(?!\/\/www\.w3\.org\/2000\/svg)/i.test(p.data.replace('http://www.w3.org/2000/svg','')))fail('Unsafe SVG payload');
  const paint=Array.isArray(slot.fills)?slot.fills.find(fill=>fill.type==='SOLID'):null,color=paint?.color;const tint=color?'#'+['r','g','b'].map(k=>Math.round(Math.max(0,Math.min(1,color[k]))*255).toString(16).padStart(2,'0')).join(''):'#334155';
  const svg=p.kind==='icon'?p.data.replace(/currentColor/g,tint):p.data;
  node=api.createNodeFromSvg(svg);slot.parent.insertChild(slot.parent.children.indexOf(slot),node);node.resize(slot.width,slot.height);node.x=slot.x;node.y=slot.y;node.name='BA_ASSET_RENDER:'+p.assetId;slot.visible=false;
 }else{
  const encoded=p.contentType==='image/webp'?p.renderedPng:p.data;if(typeof encoded!=='string'||encoded.length>7100000||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail('Invalid image data');
  const bytes=api.base64Decode(encoded),image=api.createImage(bytes);slot.fills=[{type:'IMAGE',imageHash:image.hash,scaleMode:'FILL'}];node=slot;
 }
 slot.setPluginData('baAssetIdentity',identity);slot.setPluginData('baAssetNode',node.id);node.setPluginData('baAssetIdentity',identity);
 return {protocol,assetId:p.assetId,sha256:p.sha256,screenId:p.screenId,nodeId:node.id,verified:true};
}
async function closeBAAssetRun(api,p={}){
 if(!Array.isArray(p.screenNodeIds)||p.screenNodeIds.length>100)throw new Error('Invalid asset run close scope');
 for(const id of p.screenNodeIds){const node=await api.getNodeByIdAsync(id);if(!node||node.getPluginData('baAssetRun')!==p.runId)throw new Error('Asset run close mismatch');node.setPluginData('baAssetClosed','true')}
 BA_ASSET_RUNS.delete(p.runId);return {closed:true,runId:p.runId};
}
