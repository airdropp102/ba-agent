import test from 'node:test';import assert from 'node:assert/strict';
import {buildPublishPlan,acceptVerifiedFigmaReport} from '../src/figma-registry.js';
const manifest={project:{id:'11111111-1111-4111-8111-111111111111',version:5},platform:'web',screens:[
  {id:'SCR-001',title:'Tiếp nhận',requirementIds:['FR-001'],viewport:{width:1440,height:900},components:[{id:'E1',type:'input',label:'Số seri'}]},
  {id:'SCR-002',title:'Danh sách',requirementIds:['FR-002'],viewport:{width:1440,height:900},components:[]}
]};
test('Figma publish plan skips identical verified frames and only redraws changed screens',()=>{
 const initial=buildPublishPlan(manifest);
 assert.deepEqual(initial.screens.map(s=>s.action),['create','create']);
 const {registry}=acceptVerifiedFigmaReport(initial,{documentKey:'file_123',screens:[{screenId:'SCR-001',nodeId:'12:1',verified:true},{screenId:'SCR-002',nodeId:'12:2',verified:true}]},{documentKey:'file_123'});
 const next=buildPublishPlan(manifest,registry);
 assert.deepEqual(next.screens.map(s=>s.action),['skip','skip']);
 const changed=structuredClone(manifest);changed.screens[1].components.push({id:'E2',type:'button',label:'Lọc'});
 assert.deepEqual(buildPublishPlan(changed,registry).screens.map(s=>s.action),['skip','create']);
});
test('Figma registry rejects mismatched document, nonexistent screen and unverified nodes',()=>{
 const plan=buildPublishPlan(manifest);
 assert.throws(()=>acceptVerifiedFigmaReport(plan,{documentKey:'wrong',screens:[]},{documentKey:'file_123'}),/document/i);
 assert.throws(()=>acceptVerifiedFigmaReport(plan,{documentKey:'file_123',screens:[{screenId:'SCR-001',nodeId:'1:1',verified:false}]},{documentKey:'file_123'}),/verified|xác minh/i);
 assert.throws(()=>acceptVerifiedFigmaReport(plan,{documentKey:'file_123',screens:[{screenId:'SCR-999',nodeId:'1:1',verified:true}]},{documentKey:'file_123'}),/unknown|invalid/i);
});
