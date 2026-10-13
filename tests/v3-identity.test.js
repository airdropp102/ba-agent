import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeStableIds, buildSources, resolveEvidenceSource} from '../src/revisions.js';

const fr=(name, sourceEvidence='')=>({id:'FR-001',name,sourceEvidence});
const original={functionalRequirements:[fr('Đăng ký bảo hành','khách tạo yêu cầu'),{...fr('Tra cứu bảo hành','khách tra cứu'),id:'FR-002'}],nonFunctionalRequirements:[],businessRules:[],clarificationQuestions:[]};

test('stable IDs survive reordering, inserted and deleted FR without reusing retired IDs',()=>{
  const updated={...original,functionalRequirements:[fr('Quản lý nhân viên'),fr('Tra cứu bảo hành','khách tra cứu'),fr('Đăng ký bảo hành','khách tạo yêu cầu')]};
  const next=mergeStableIds(updated,original,{FR:4});
  assert.deepEqual(next.analysis.functionalRequirements.map(x=>x.id),['FR-005','FR-002','FR-001']);
  assert.equal(next.nextIds.FR,5);
  const remove=mergeStableIds({...updated,functionalRequirements:[fr('Đăng ký bảo hành')]},next.analysis,next.nextIds);
  assert.equal(remove.analysis.functionalRequirements[0].id,'FR-001');
  assert.equal(remove.nextIds.FR,5);
});

test('colliding names never duplicate IDs',()=>{
  const next=mergeStableIds({...original,functionalRequirements:[fr('Tra cứu bảo hành'),fr('Tra cứu bảo hành')]},original);
  assert.equal(new Set(next.analysis.functionalRequirements.map(r=>r.id)).size,2);
});

test('only customer-attributed sources can confirm evidence',()=>{
  const sources=buildSources('Khách cần báo hỏng');
  sources.push({id:'SRC-002',type:'ba-note',text:'Không thu phí',at:'2026-10-13T00:00:00Z'});
  assert.equal(resolveEvidenceSource('Không thu phí',sources),null);
  assert.equal(resolveEvidenceSource('Khách cần báo hỏng',sources),'SRC-001');
  sources.push({id:'SRC-003',type:'customer-response',text:'Miễn phí vận chuyển',at:'2026-10-13T00:00:00Z'});
  assert.equal(resolveEvidenceSource('Miễn phí vận chuyển',sources),'SRC-003');
});

test('prototype screen IDs survive reordered AI output and navigation follows stable IDs',async()=>{
  const {normalizePrototype}=await import('../src/normalize.js');
  const analysis={functionalRequirements:[{id:'FR-001'},{id:'FR-002'}]};
  const source={screens:[
    {id:'a',title:'Tạo phiếu',requirementIds:['FR-001'],components:[]},
    {id:'b',title:'Danh sách',requirementIds:['FR-002'],components:[]}
  ]};
  const original=normalizePrototype(source,analysis);
  const shuffled={screens:[
    {id:'second',title:'Danh sách',requirementIds:['FR-002'],components:[{type:'button',label:'Tạo phiếu',actionTarget:'first'}]},
    {id:'first',title:'Tạo phiếu',requirementIds:['FR-001'],components:[]}
  ]};
  const revised=normalizePrototype(shuffled,analysis,{previous:original,maxId:2});
  assert.deepEqual(revised.screens.map(x=>x.id),['SCR-002','SCR-001']);
  assert.equal(revised.screens[0].components[0].actionTarget,'SCR-001');
});
