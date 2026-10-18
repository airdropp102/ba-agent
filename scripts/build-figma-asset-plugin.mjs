import {validateLocalAssetPluginManifest} from '../src/figma-asset-plugin-package.js';
import fs from 'node:fs/promises';
const root=new URL('../vendor/ba-talk-to-figma-plugin/',import.meta.url),file=new URL('code.js',root),base=(await fs.readFile(file,'utf8')).split('// BA_ASSET_EXTENSION')[0];
validateLocalAssetPluginManifest(JSON.parse(await fs.readFile(new URL('manifest.json',root),'utf8')));
await fs.writeFile(file,base+'// BA_ASSET_EXTENSION\n'+await fs.readFile(new URL('asset-commands.js',root),'utf8'));
console.log('Built BA Studio TalkToFigma asset plugin');
