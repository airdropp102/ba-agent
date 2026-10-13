import test from 'node:test';
import assert from 'node:assert/strict';
import {demoAnalysis,demoPrototype,sampleBrief,sampleTitle} from '../src/demo.js';
import {normalizeAnalysis,normalizePrototype} from '../src/normalize.js';
import {renderBRD,renderSRS} from '../src/docs.js';
import {renderStandalone} from '../src/export.js';

test('Evidence quotes are validated and non-grounded requirements downgraded',()=>{
  const data=demoAnalysis(sampleTitle,sampleBrief);
  data.functionalRequirements.push({...data.functionalRequirements[0],sourceEvidence:'Yêu cầu tưởng tượng',certainty:'confirmed'});
  const a=normalizeAnalysis(data,sampleBrief);
  assert.equal(a.functionalRequirements.length,4);
  assert.equal(a.functionalRequirements[0].certainty,'confirmed');
  assert.equal(a.functionalRequirements[3].certainty,'assumption');
  assert.equal(a.functionalRequirements[0].id,'FR-001');
});

test('Prototype actions map to screens and filter invalid references',()=>{
  const a=normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief);
  const raw=demoPrototype(a);raw.screens[0].requirementIds.push('FR-999');
  const proto=normalizePrototype(raw,a);
  assert.deepEqual(proto.screens[0].requirementIds,['FR-001']);
  assert.equal(proto.screens[0].components.find(x=>x.actionTarget).actionTarget,'SCR-002');
});

test('BRD, SRS preserve same FR identifiers; prototype HTML encodes unsafe text',()=>{
  const a=normalizeAnalysis(demoAnalysis(sampleTitle,sampleBrief),sampleBrief);
  const proto=normalizePrototype(demoPrototype(a),a);
  const p={analysis:a,prototype:proto,version:3,title:sampleTitle,demo:true,review:{approved:true,notes:'Checked',reviewedAt:new Date().toISOString()}};
  for(const r of a.functionalRequirements){assert.match(renderBRD(p),new RegExp(r.id));assert.match(renderSRS(p),new RegExp(r.id))}
  assert.match(renderSRS(p),/SCR-001/);
  p.analysis.projectName='<script>alert(1)</script>';
  const html=renderStandalone(p);
  assert.ok(!html.includes('<title>Prototype — <script>'));
  assert.ok(html.includes('&lt;script&gt;'));
});
