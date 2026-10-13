import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleTitle,sampleBrief,demoAnalysis,demoPrototype} from '../src/demo.js';
import {normalizeAnalysis,normalizePrototype} from '../src/normalize.js';
import {buildFigmaHandoff,renderFigmaInstructions} from '../src/figma-handoff.js';

const fixture=()=>{
  const analysis=normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief);
  return {id:'11111111-1111-4111-8111-111111111111',title:sampleTitle,brief:sampleBrief,
    status:'GENERATED',version:4,analysis,review:{approved:true,notes:'DRAFT checked',reviewedAt:'2026-10-13T00:00:00.000Z'},
    prototype:normalizePrototype(demoPrototype(analysis),analysis)};
};

test('Figma handoff requires BA review and at least one analyzed FR',()=>{
  const p=fixture();p.review=null;
  assert.throws(()=>buildFigmaHandoff(p),/review/i);
  p.review={approved:true};p.prototype=null;p.analysis.functionalRequirements=[];
  assert.throws(()=>buildFigmaHandoff(p),/functional requirement/i);
});

test('Figma design pack keeps IDs, navigation, and provenance statuses consistent',()=>{
  const handoff=buildFigmaHandoff(fixture(),{platform:'web'});
  assert.equal(handoff.manifest.schemaVersion,'ba.figma.v1');
  assert.equal(handoff.manifest.project.version,4);
  assert.equal(handoff.manifest.review.customerApproved,false);
  assert.equal(handoff.manifest.screens.length,3);
  assert.equal(handoff.manifest.screens[0].id,'SCR-001');
  assert.deepEqual(handoff.manifest.screens[0].requirementIds,['FR-001']);
  assert.ok(handoff.manifest.screens.every(s=>s.viewport.width===1440));
  assert.ok(handoff.manifest.screens[0].components.some(c=>c.type==='input'));
  assert.ok(handoff.brd.includes('BRD'));
  assert.ok(handoff.srs.includes('FR-001'));
  assert.ok(handoff.instructions.includes('ui-ux-pro-max'));
  assert.ok(handoff.instructions.includes('join_channel'));
  assert.ok(handoff.instructions.includes('get_document_info'));
  assert.ok(handoff.instructions.includes('create_frame'));
  assert.ok(handoff.instructions.includes('Do not claim'));
  assert.ok(handoff.manifest.navigation.every(e=>e.fromScreenId.startsWith('SCR-')&&e.toScreenId.startsWith('SCR-')));
});

test('Figma handoff never treats an unknown action target as a valid navigation destination',()=>{
  const p=fixture();p.prototype.screens[0].components.push({type:'button',label:'Next',actionTarget:'SCR-999'});
  const pack=buildFigmaHandoff(p);
  assert.ok(!pack.manifest.navigation.some(x=>x.toScreenId==='SCR-999'));
  assert.match(renderFigmaInstructions(pack.manifest),/verified/i);
});


test('From BRD/SRS alone, conservative screen candidates preserve FR traceability',()=>{
  const p=fixture();p.prototype=null;
  const pack=buildFigmaHandoff(p,{platform:'mobile'});
  assert.equal(pack.manifest.screens.length,p.analysis.functionalRequirements.length);
  assert.equal(pack.manifest.screens[0].designStatus,'DRAFT-SCREEN-CANDIDATE');
  assert.equal(pack.manifest.screens[0].viewport.width,390);
  assert.deepEqual(pack.manifest.screens[0].requirementIds,['FR-001']);
  assert.equal(pack.manifest.navigation.length,0);
  assert.ok(pack.brd.includes('BRD')&&pack.srs.includes('SRS'));
});

// CLI never requires a Figma session for offline handoff.
test('Local figma export CLI writes a complete offline pack without network',async()=>{
  const {mkdtemp,readFile,writeFile,readdir,rm}=await import('node:fs/promises');
  const {spawnSync}=await import('node:child_process');
  const os=await import('node:os');
  const path=await import('node:path');
  const temp=await mkdtemp(path.join(os.tmpdir(),'ba-figma-'));
  try{
    const p=fixture();
    const dataDir=path.join(temp,'data');const out=path.join(temp,'pack');
    await (await import('node:fs/promises')).mkdir(dataDir);
    await writeFile(path.join(dataDir,p.id+'.json'),JSON.stringify(p));
    const r=spawnSync(process.execPath,['scripts/figma-design.mjs','--project',p.id,'--data-dir',dataDir,'--out',out],{cwd:process.cwd(),encoding:'utf8'});
    assert.equal(r.status,0,r.stderr);
    const runs=await readdir(out);assert.equal(runs.length,1);
    const files=await readdir(path.join(out,runs[0]));
    for (const name of ['BRD.md','SRS.md','canonical.json','figma-manifest.json','FIGMA_INSTRUCTIONS.md']) assert.ok(files.includes(name),name);
    const m=JSON.parse(await readFile(path.join(out,runs[0],'figma-manifest.json'),'utf8'));
    assert.equal(m.screens.length,3);
    const invalid=spawnSync(process.execPath,['scripts/figma-design.mjs','--project',p.id,'--publish'],{cwd:process.cwd(),encoding:'utf8'});
    assert.equal(invalid.status,2);
    assert.match(invalid.stderr,/channel/);
  }finally{await rm(temp,{recursive:true,force:true})}
});
