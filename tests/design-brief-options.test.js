import test from 'node:test';
import assert from 'node:assert/strict';
import {BRIEF_FIELDS,BRIEF_STYLES,BRIEF_CHOICES,emptyBriefOptions,applyBriefPreset,resolveBriefOptions} from '../public/design-brief-options.js';
import {normalizeDesignDirection,saveDesignDirection} from '../src/design-direction.js';
const project=()=>({id:'11111111-1111-4111-8111-111111111111',version:4,review:{approved:true,customerApproved:false},prototype:{screens:[{id:'SCR-001',requirementIds:['FR-001']}]}});
const payload=()=>({references:[],library:[],sampleScreenId:'SCR-001'});

test('each curated style produces a complete visual brief using only selected options',()=>{
 for(const style of BRIEF_STYLES){const options=applyBriefPreset(emptyBriefOptions(),style.id),result=resolveBriefOptions(options);assert.match(result.brief.style,new RegExp(style.value.slice(0,8)));assert.ok(result.brief.goals);assert.match(result.brief.primaryColor,/^#[A-F0-9]{6}$/);assert.ok(result.brief.typography);assert.ok(result.brief.density);assert.equal(result.brief.audience,'');assert.deepEqual(result.options.preserve,[])}
});

test('options reject invented choices, duplicate multi-select IDs and unsupported catalogs',()=>{
 const valid=applyBriefPreset(emptyBriefOptions(),'modern-saas');
 for(const invalid of [{...valid,style:'invented-trend'},{...valid,goals:['clarity','clarity']},{...valid,primaryColor:'javascript:bad'},{...valid,audience:['unapproved-role']},{...valid,catalogVersion:'unknown'},{...valid,extra:'untrusted'}])assert.throws(()=>resolveBriefOptions(invalid));
 assert.throws(()=>resolveBriefOptions({...valid,preserve:['audience']}),/nội dung cũ/);
 assert.throws(()=>resolveBriefOptions({...valid,preserve:['style']},{style:'Previous'}),/nội dung cũ hoặc/);
});

test('server renders authoritative choice text and never accepts a forged brief alongside options',async()=>{
 const p=project(),options=applyBriefPreset(emptyBriefOptions(),'fluent');const direction=await normalizeDesignDirection(p,{...payload(),briefOptions:options,brief:{goals:'Forged customer signoff',style:'Forged style'}},async()=>{});
 assert.equal(direction.brief.style,BRIEF_STYLES.find(s=>s.id==='fluent').value);assert.ok(!JSON.stringify(direction).includes('Forged'));assert.equal(direction.briefOptions.style,'fluent');assert.equal(p.review.customerApproved,false);
});

test('legacy free text survives option-mode migration without changing its visual digest or sample approval',async()=>{
 const p=project(),brief={goals:'Exact existing goal',style:'Custom historical style',audience:'Existing user context',avoid:'Legacy avoid note',primaryColor:'#123456',typography:'Existing font choice',density:'Existing density'};
 const legacy=await normalizeDesignDirection(p,{...payload(),brief},async()=>{});p.designDirection=legacy;p.designSample={state:'APPROVED',marker:'existing'};p.figmaDesign={state:'SAMPLE_APPROVED',draft:{projectVersion:4}};
 const migrated=await normalizeDesignDirection(p,{...payload(),briefOptions:emptyBriefOptions(brief)},async()=>{});
 assert.deepEqual(migrated.brief,brief);assert.equal(migrated.digest,legacy.digest);const saved=saveDesignDirection(p,migrated,'operator');assert.equal(saved.figmaDesign.state,'SAMPLE_APPROVED');assert.equal(saved.designSample.marker,'existing');assert.deepEqual(saved.designDirection.briefOptions.preserve,BRIEF_FIELDS);
 const selected=applyBriefPreset(migrated.briefOptions,'soft-minimal');assert.deepEqual(selected.preserve,['audience']);const changed=await normalizeDesignDirection(p,{...payload(),briefOptions:selected},async()=>{});assert.equal(changed.brief.audience,brief.audience);assert.notEqual(changed.digest,legacy.digest);assert.equal(saveDesignDirection(p,changed,'operator').designSample,null);
});

test('multi-select order is canonical and stored options round-trip without visual drift',()=>{
 const first=applyBriefPreset(emptyBriefOptions(),'editorial'),second={...first,goals:[...first.goals].reverse(),avoid:[...first.avoid].reverse()};assert.deepEqual(resolveBriefOptions(first),resolveBriefOptions(second));
 for(const [key,choices] of Object.entries(BRIEF_CHOICES))assert.equal(new Set(choices.map(x=>x.id)).size,choices.length,key);
});
