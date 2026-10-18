import fs from 'node:fs/promises';
import {crc32} from 'node:zlib';
const names=['manifest.json','code.js','ui.html','LICENSE','NOTICE.md','README.md'];
/** Our local-development network policy, not a replacement for Figma's manifest validator. */
export function validateLocalAssetPluginManifest(manifest){
 const network=manifest?.networkAccess;
 if(JSON.stringify(network?.allowedDomains)!==JSON.stringify(['none'])||JSON.stringify(network?.devAllowedDomains)!==JSON.stringify(['http://localhost:3055','ws://localhost:3055']))throw new Error('Asset plugin must use localhost in devAllowedDomains only; IP literals and broad network access are unsupported');
 return manifest;
}
/** Small stored ZIP; only fixed public plugin files are included, never project data. */
export async function figmaAssetPluginZip(){
 validateLocalAssetPluginManifest(JSON.parse(await fs.readFile(new URL('../vendor/ba-talk-to-figma-plugin/manifest.json',import.meta.url),'utf8')));
 const chunks=[],central=[];let offset=0;
 for(const name of names){const filename=Buffer.from(name),data=await fs.readFile(new URL('../vendor/ba-talk-to-figma-plugin/'+name,import.meta.url)),crc=crc32(data),local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(33,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(filename.length,26);chunks.push(local,filename,data);
  const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50,0);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6);entry.writeUInt16LE(33,14);entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42);central.push(entry,filename);offset+=local.length+filename.length+data.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(names.length,8);end.writeUInt16LE(names.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...chunks,directory,end]);
}
