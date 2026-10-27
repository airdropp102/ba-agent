import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {extractRequirementFile,extractRequirementFiles} from '../src/requirement-file.js';
import {docx,pdf,upload} from './helpers/requirement-fixtures.js';

test('extracts actual PDF text and digests from original bytes',async()=>{
 const bytes=pdf(),result=await extractRequirementFile(upload('brief.pdf',bytes));
 assert.match(result.text,/Customer needs warranty requests tracked by serial number/);
 assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
 assert.equal(result.textSha256,createHash('sha256').update(result.text).digest('hex'));
});
test('extracts Unicode Word paragraphs, including tables as text',async()=>{
 const result=await extractRequirementFile(upload('Yêu cầu.docx',docx(undefined,'Mã bảo hành trong bảng.')));
 assert.match(result.text,/Khách hàng cần quản lý yêu cầu bảo hành theo số seri/);
 assert.match(result.text,/Mã bảo hành trong bảng/);
});
test('reads ordinary Word filenames with parentheses, brackets, ampersands and long Unicode names',async()=>{
 for(const filename of ['Yêu cầu (1).docx','BRD [final] & Quy trình.docx','Nghiệp vụ + Hợp đồng #2.docx','Yêu cầu '.repeat(15)+'(cuối).docx']){
  const result=await extractRequirementFile(upload(filename,docx()));assert.equal(result.filename,filename);assert.match(result.text,/Khách hàng cần/);
 }
});
test('extracts legacy Word DOC generated from synthetic RTF using macOS textutil',async()=>{
 const bytes=await readFile(new URL('./fixtures/requirement-legacy.doc',import.meta.url));
 const result=await extractRequirementFile(upload('legacy.doc',bytes));
 assert.match(result.text,/Customer needs warranty requests tracked by serial number/);
});
test('rejects scans, malformed documents and unsupported or disguised uploads',async()=>{
 await assert.rejects(()=>extractRequirementFile(upload('scan.pdf',pdf(''))),/OCR/);
 for(const f of [upload('bad.pdf',Buffer.from('not a pdf')),upload('../bad.docx',docx()),upload('brief.docx',pdf()),upload('brief.doc',docx()),upload('brief.png',pdf()),{filename:'bad.pdf',encoding:'base64',content:'%%%'}])await assert.rejects(()=>extractRequirementFile(f));
});
test('rejects oversized input and text overflow instead of truncating',async()=>{
 await assert.rejects(()=>extractRequirementFile(upload('big.pdf',Buffer.alloc(5*1024*1024+1))),/5 MB/);
 await assert.rejects(()=>extractRequirementFile(upload('long.docx',docx('x'.repeat(100001)))),/100.000/);
});
test('server batch guard rejects count and aggregate bytes before parsing',async()=>{
 await assert.rejects(()=>extractRequirementFiles([]),/1.*10/);
 await assert.rejects(()=>extractRequirementFiles(Array(11).fill(upload('brief.pdf',pdf()))),/1.*10/);
 const bytes=Buffer.alloc(5*1024*1024,32);bytes.write('%PDF-1.4');const file=upload('large.pdf',bytes);
 await assert.rejects(()=>extractRequirementFiles(Array(5).fill(file)),/20 MB/);
});
