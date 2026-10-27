import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequirementFileDraft,requirementCreateBlocker} from '../public/requirement-file-ui.js';

const file=(name,size=100)=>({name,size,arrayBuffer:async()=>new TextEncoder().encode('synthetic').buffer});
const result={text:'Customer needs warranty request tracking.',textSha256:'digest',warnings:[]};
test('disabled creation always explains whether files are pending or unreadable',()=>{
 assert.match(requirementCreateBlocker({files:[{pending:true},{pending:true}]}),/đọc.*2/i);
 assert.match(requirementCreateBlocker({files:[{error:'Bad name'},{error:'OCR'}]}),/2.*lỗi/);
 assert.equal(requirementCreateBlocker({files:[{upload:{},pending:false,error:''}]}),'');
 assert.match(requirementCreateBlocker({files:[]},true),/xử lý/);
});
test('multiple files retain original uploads and digests; add appends, removal keeps other files',async()=>{
 const draft=createRequirementFileDraft({preview:async()=>result});
 await draft.add([file('first.pdf'),file('second.docx')]);
 assert.deepEqual(draft.payload('').requirementFiles.map(f=>f.filename),['first.pdf','second.docx']);
 assert.equal(draft.payload('').requirementFiles[0].previewTextSha256,'digest');
 assert.equal(draft.payload('Additional context').brief,'Additional context');
 const first=draft.state.files[0].id;await draft.add([file('third.doc')]);draft.remove(first);
 assert.deepEqual(draft.payload('').requirementFiles.map(f=>f.filename),['second.docx','third.doc']);
 draft.clear();assert.throws(()=>draft.payload(''),/15/);assert.equal(draft.payload('Customer needs tracking.').requirementFiles,undefined);
});
test('removal or clear during preview cannot resurrect removed files; new files still finish',async()=>{
 let resolveFirst;const draft=createRequirementFileDraft({preview:async f=>f.filename==='first.pdf'?new Promise(r=>{resolveFirst=r}):{...result,text:'Second file text.'}});
 const first=draft.add([file('first.pdf'),file('second.docx')]);await new Promise(r=>setTimeout(r,0));
 assert.throws(()=>draft.payload('Customer notes.'),/đọc/);
 draft.remove(draft.state.files[0].id);resolveFirst(result);await first;
 assert.equal(draft.state.files.length,1);assert.equal(draft.state.files[0].text,'Second file text.');
 const pending=draft.add([file('first.pdf')]);await new Promise(r=>setTimeout(r,0));draft.clear();resolveFirst(result);await pending;assert.equal(draft.state.files.length,0);
});
test('bad files block submission until individually removed while valid previews survive',async()=>{
 const draft=createRequirementFileDraft({preview:async f=>{if(f.filename==='scan.pdf')throw Error('PDF cần OCR');return result}});
 await draft.add([file('good.pdf'),file('scan.pdf')]);
 assert.match(draft.state.files[1].error,/OCR/);assert.throws(()=>draft.payload('Typed notes are here.'),/OCR/);
 draft.remove(draft.state.files[1].id);assert.equal(draft.payload('').requirementFiles.length,1);
 await draft.add([file('image.png')]);assert.match(draft.state.files[1].error,/Word|PDF/);
 draft.remove(draft.state.files[1].id);
 await draft.add([file('big.pdf',5*1024*1024+1)]);assert.match(draft.state.error,/5 MB/);assert.equal(draft.state.files.length,1);
});
test('batch limits reject additions before encoding or extraction without losing accepted files',async()=>{
 let previews=0;const draft=createRequirementFileDraft({preview:async()=>{previews++;return result}});
 await draft.add(Array.from({length:11},(_,i)=>file(`file-${i}.pdf`)));assert.match(draft.state.error,/10/);assert.equal(previews,0);
 await draft.add(Array.from({length:5},(_,i)=>file(`file-${i}.pdf`,5*1024*1024)));assert.match(draft.state.error,/20 MB/);assert.equal(previews,0);
 await draft.add([file('accepted.pdf')]);assert.equal(draft.state.files.length,1);
 await draft.add(Array.from({length:10},(_,i)=>file(`file-${i}.pdf`)));assert.equal(draft.state.files.length,1);assert.equal(previews,1);
});
test('combined text overflow is rejected without truncating file previews',async()=>{
 const draft=createRequirementFileDraft({preview:async()=>({...result,text:'x'.repeat(60000)})});
 await draft.add([file('first.pdf'),file('second.docx')]);
 assert.throws(()=>draft.payload(''),/100.000/);assert.equal(draft.state.files[0].text.length,60000);assert.equal(draft.state.files[1].text.length,60000);
});
