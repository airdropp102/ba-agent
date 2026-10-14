import {loadDotEnv} from './load-env.mjs';
await loadDotEnv();
import path from 'node:path';
import {ProductionStore} from '../src/production-store.js';
import {recoverFigmaPreviewDraft} from '../src/figma-design-recovery.js';
import {exportFigmaPreview} from '../src/figma-preview-export.js';
const args=process.argv.slice(2),option=name=>{const i=args.indexOf('--'+name);return i<0?undefined:args[i+1]};
const store=new ProductionStore(path.resolve(process.env.DATA_DIR||'data'));
try{
 if(!args.includes('--confirm'))throw new Error('Explicit --confirm is required for failed preview recovery');
 const projectId=option('project'),project=store.get(projectId);
 const result=await recoverFigmaPreviewDraft({store,projectId,expectedVersion:Number(option('version')),channelId:project.figmaDesign?.channelId,previewExporter:options=>exportFigmaPreview({...options,port:Number(process.env.FIGMA_RELAY_PORT||3055)})});
 console.log(JSON.stringify(result));
}catch(error){console.error('Figma preview recovery failed:',error.message);process.exitCode=1}
finally{store.db.close()}
