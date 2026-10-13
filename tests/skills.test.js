import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, mkdtempSync, writeFileSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const base = path.resolve('skills');
const dirs = readdirSync(base, {withFileTypes:true}).filter(x=>x.isDirectory()&&x.name.startsWith('ba-')).map(x=>x.name);

test('BA skills have discoverable agent-skill frontmatter and safety/revision guidance', () => {
  assert.equal(dirs.length,9);
  for (const d of dirs) {
    const md = readFileSync(path.join(base,d,'SKILL.md'),'utf8');
    assert.match(md,new RegExp('^---\\nname: '+d+'\\n'));
    assert.match(md,/description: Use when /);
    assert.ok(md.includes('BABOK') || md.includes('Superpowers'));
  }
  const orchestration=readFileSync(path.join(base,'ba-orchestrating-analysis','SKILL.md'),'utf8');
  for (const name of dirs.filter(n=>n!=='ba-orchestrating-analysis')) assert.ok(orchestration.includes(name),name);
  assert.match(orchestration,/BA review.*not.*customer sign-off/i);
});

test('Canonical semantic validation detects orphan prototype references and forged approval',()=>{
  const fixture=JSON.parse(readFileSync('examples/generated/canonical.json','utf8'));
  const temp=mkdtempSync(path.join(os.tmpdir(),'ba-canonical-test-'));
  try {
    const file=path.join(temp,'sample.json');
    writeFileSync(file,JSON.stringify(fixture));
    const valid=spawnSync(process.execPath,['scripts/validate-canonical.mjs',file],{encoding:'utf8'});
    assert.equal(valid.status,0,valid.stderr);
    fixture.traceability[0].screenIds=['SCR-999'];
    fixture.review.customerApproved=true;
    writeFileSync(file,JSON.stringify(fixture));
    const invalid=spawnSync(process.execPath,['scripts/validate-canonical.mjs',file],{encoding:'utf8'});
    assert.equal(invalid.status,1);
    assert.match(invalid.stderr,/Orphan screen/);
    assert.match(invalid.stderr,/customer sign-off/);
  } finally { rmSync(temp,{recursive:true,force:true}); }
});
