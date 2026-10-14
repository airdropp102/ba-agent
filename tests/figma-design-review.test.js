import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFigmaDesignInput,beginFigmaDesign,completeFigmaDesign,reviewFigmaDesign} from '../src/figma-design-review.js';

const project=()=>({id:'11111111-1111-4111-8111-111111111111',version:7,workflow:{runId:'workflow-7'},analysis:{functionalRequirements:[{id:'FR-001'},{id:'FR-002'}]},prototype:{screens:[{id:'SCR-001',requirementIds:['FR-001']},{id:'SCR-002',requirementIds:['FR-002']}]},review:{approved:true,customerApproved:false}});
const digest='a'.repeat(64);
const reports=()=>[
 {screenId:'SCR-001',requirementIds:['FR-001'],nodeId:'11:1',verified:true},
 {screenId:'SCR-002',requirementIds:['FR-002'],nodeId:'11:2',verified:true}
];
const previews=()=>[
 {screenId:'SCR-001',path:`04-figma/exports/v1-web/previews/${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}/SCR-001.jpg`,contentType:'image/jpeg',sha256:'b'.repeat(64),sizeBytes:1200},
 {screenId:'SCR-002',path:`04-figma/exports/v1-web/previews/${'a'.repeat(8)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(4)}-${'a'.repeat(12)}/SCR-002.jpg`,contentType:'image/jpeg',sha256:'c'.repeat(64),sizeBytes:1400}
];

test('Figma input accepts supported HTTPS file links and channel IDs',()=>{
 assert.deepEqual(parseFigmaDesignInput({fileUrl:'https://www.figma.com/design/AbC_123/file-name?node-id=1%3A2',channelId:'my_channel-42'}),{documentKey:'AbC_123',channelId:'my_channel-42'});
 assert.deepEqual(parseFigmaDesignInput({fileUrl:'https://figma.com/file/abc-123/name',channelId:'A'}),{documentKey:'abc-123',channelId:'A'});
});

test('Figma input rejects unsafe schemes, hosts, paths, keys, and channels',()=>{
 for(const fileUrl of ['http://figma.com/design/abc/name','https://evilfigma.com/design/abc/name','https://figma.com/proto/abc/name','https://figma.com/design/a/name','https://figma.com/design/'+ 'x'.repeat(129) +'/name','not a url'])
  assert.throws(()=>parseFigmaDesignInput({fileUrl,channelId:'channel'}));
 for(const channelId of ['', 'with space','x'.repeat(129)])
  assert.throws(()=>parseFigmaDesignInput({fileUrl:'https://figma.com/file/abc/name',channelId}));
});

test('complete design requires full planned screen coverage, unique nodes, and valid previews',()=>{
 const p=beginFigmaDesign(project(),{documentKey:'abc-123',channelId:'channel',jobId:'job-1'});
 for(const [screens,files] of [
  [reports().slice(0,1),previews()],
  [[...reports(),{...reports()[0]}],previews()],
  [reports().map((s,i)=>({...s,nodeId:i?'11:1':'11:1'})),previews()],
  [reports(),previews().slice(0,1)],
  [reports(),previews().map(x=>({...x,contentType:'image/png'}))],
  [reports(),previews().map(x=>({...x,path:'../outside.jpg'}))]
 ]) assert.throws(()=>completeFigmaDesign(p,{runId:'job-1',projectVersion:7,manifestDigest:digest,screens,previewFiles:files}));
});

test('approved design is version-bound and never changes customer approval fields',()=>{
 const original=project(),started=beginFigmaDesign(original,{documentKey:'abc-123',channelId:'channel',jobId:'job-1'});
 const draft=completeFigmaDesign(started,{runId:'job-1',projectVersion:7,manifestDigest:digest,screens:reports(),previewFiles:previews()});
 const approved=reviewFigmaDesign(draft,{decision:'APPROVE',notes:'Looks good',reviewerId:'reviewer-1',projectVersion:7,manifestDigest:digest});
 assert.equal(approved.figmaDesign.state,'APPROVED');
 assert.equal(approved.figmaDesign.approved.manifestDigest,digest);
 assert.deepEqual(approved.review,original.review);
 assert.equal(original.figmaDesign,undefined);
});

test('revision request preserves review history and stale project or manifest is rejected',()=>{
 const p=beginFigmaDesign(project(),{documentKey:'abc-123',channelId:'channel',jobId:'job-1'});
 const draft=completeFigmaDesign(p,{runId:'job-1',projectVersion:7,manifestDigest:digest,screens:reports(),previewFiles:previews()});
 assert.throws(()=>completeFigmaDesign({...draft,version:8},{runId:'job-1',projectVersion:7,manifestDigest:digest,screens:reports(),previewFiles:previews()}),/stale|version/i);
 assert.throws(()=>reviewFigmaDesign(draft,{decision:'APPROVE',notes:'ok',reviewerId:'reviewer-1',projectVersion:6,manifestDigest:digest}),/stale|version/i);
 assert.throws(()=>reviewFigmaDesign(draft,{decision:'APPROVE',notes:'ok',reviewerId:'reviewer-1',projectVersion:7,manifestDigest:'d'.repeat(64)}),/manifest/i);
 const requested=reviewFigmaDesign(draft,{decision:'REQUEST_CHANGES',notes:'Increase spacing',reviewerId:'reviewer-1',projectVersion:7,manifestDigest:digest});
 assert.equal(requested.figmaDesign.state,'REVISION_REQUESTED');
 assert.equal(requested.figmaDesign.history.length,1);
 assert.equal(requested.figmaDesign.history[0].decision,'REQUEST_CHANGES');
 assert.equal(requested.figmaDesign.channelId,'channel');
});

test('approved design can be reopened for changes while preserving approval history and requiring a fresh review',()=>{
 const original=project(),started=beginFigmaDesign(original,{documentKey:'abc-123',channelId:'channel',jobId:'job-1'});
 const draft=completeFigmaDesign(started,{runId:'job-1',projectVersion:7,manifestDigest:digest,screens:reports(),previewFiles:previews()});
 const approved=reviewFigmaDesign(draft,{decision:'APPROVE',notes:'Approved fixture',reviewerId:'reviewer-1',projectVersion:7,manifestDigest:digest});
 const input={decision:'REQUEST_CHANGES',notes:'Update the approved screen spacing',reviewerId:'reviewer-1',projectVersion:7,manifestDigest:digest};
 const reopened=reviewFigmaDesign(approved,input);
 assert.equal(reopened.figmaDesign.state,'REVISION_REQUESTED');assert.deepEqual(reopened.figmaDesign.approved,approved.figmaDesign.approved);
 assert.deepEqual(reopened.figmaDesign.history.map(item=>item.decision),['APPROVE','REQUEST_CHANGES']);
 assert.equal(approved.figmaDesign.state,'APPROVED');assert.deepEqual(reopened.review,original.review);
 assert.throws(()=>reviewFigmaDesign(approved,{...input,notes:''}),/feedback/);
 assert.throws(()=>reviewFigmaDesign(approved,{...input,decision:'APPROVE'}),/waiting for review/);
 assert.throws(()=>reviewFigmaDesign(approved,{...input,projectVersion:6}),/stale|version/i);
 const next=beginFigmaDesign(reopened,{documentKey:'abc-123',channelId:'new-channel',jobId:'job-2'});
 assert.equal(next.figmaDesign.state,'DESIGNING');assert.equal(next.figmaDesign.draft,null);
 assert.deepEqual(next.figmaDesign.approved,approved.figmaDesign.approved);
});
