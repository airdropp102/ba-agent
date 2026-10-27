import {createHash} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {documentExtension} from './document-filename.js';

const bad=(message,status=400)=>Object.assign(new Error(message),{status});
const digest=value=>createHash('sha256').update(value).digest('hex');
let active=0;
export const MAX_REQUIREMENT_FILE_BYTES=5*1024*1024;
export const MAX_REQUIREMENT_FILES=10;
export const MAX_REQUIREMENT_TOTAL_BYTES=20*1024*1024;

function decodeRequirementFile(file){
 const extension=documentExtension(file?.filename,['pdf','docx','doc']);
 if(!extension)throw bad('Chọn file Word (.doc, .docx) hoặc PDF có tên tối đa 255 ký tự, không chứa đường dẫn hoặc ký tự điều khiển.');
 const {filename,content,encoding}=file;
 if(encoding!=='base64'||typeof content!=='string'||!content)throw bad('File phải có nội dung base64.');
 if(content.length>Math.ceil(MAX_REQUIREMENT_FILE_BYTES/3)*4)throw bad('File vượt giới hạn 5 MB.',413);
 if(content.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(content))throw bad('Nội dung base64 không hợp lệ.');
 const bytes=Buffer.from(content,'base64');
 if(bytes.toString('base64')!==content||!bytes.length)throw bad('Nội dung base64 không hợp lệ.');
 if(bytes.length>MAX_REQUIREMENT_FILE_BYTES)throw bad('File vượt giới hạn 5 MB.',413);
 const valid=extension==='pdf'?bytes.subarray(0,5).equals(Buffer.from('%PDF-')):extension==='docx'?bytes.subarray(0,4).equals(Buffer.from('504b0304','hex')):bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex'));
 if(!valid)throw bad('Nội dung file không khớp định dạng Word/PDF đã chọn.');
 return {bytes,extension,filename};
}

/** Local document parsing only. Never calls a provider or persists preview input. */
export async function extractRequirementFile(file){
 const {bytes,extension,filename}=decodeRequirementFile(file);
 if(active>=2)throw bad('Đang đọc tài liệu khác. Vui lòng thử lại sau.',429);
 active++;
 try{
  const result=await new Promise((resolve,reject)=>{
   const worker=new Worker(new URL('./requirement-file-worker.js',import.meta.url),{workerData:{bytes,extension},execArgv:[],resourceLimits:{maxOldGenerationSizeMb:256},stdout:true,stderr:true});
   const finish=(error,result)=>{clearTimeout(timer);void worker.terminate();error?reject(error):resolve(result)};
   const timer=setTimeout(()=>finish(bad('Đọc file quá thời gian. Hãy chia nhỏ tài liệu và thử lại.',422)),15000);
   worker.once('message',result=>result.error?finish(bad(result.error,422)):finish(null,result));
   worker.once('error',()=>finish(bad('Không đọc được file. Hãy kiểm tra tài liệu và thử lại.',422)));
   worker.once('exit',code=>{if(code!==0)finish(bad('Không đọc được file. Hãy kiểm tra tài liệu và thử lại.',422))});
  });
  return {filename,sha256:digest(bytes),text:result.text,textSha256:digest(result.text),warnings:result.warnings||[]};
 }finally{active--}
}

/** Validate the entire batch before parsing; keep each preview bound to its file. */
export async function extractRequirementFiles(files){
 if(!Array.isArray(files)||files.length<1||files.length>MAX_REQUIREMENT_FILES)throw bad('Chọn từ 1 đến 10 tài liệu Word/PDF.');
 let total=0;
 for(const file of files){total+=decodeRequirementFile(file).bytes.length;if(total>MAX_REQUIREMENT_TOTAL_BYTES)throw bad('Tổng dung lượng tài liệu vượt 20 MB.',413)}
 const results=[];
 for(const file of files){
  let result;
  try{result=await extractRequirementFile(file)}catch(e){throw bad(`${file.filename}: ${e.message}`,e.status||422)}
  if(file.previewTextSha256!==result.textSha256)throw bad(`${file.filename}: Nội dung file đã thay đổi hoặc chưa được xem trước. Hãy chọn lại file.`,409);
  results.push(result);
 }
 return results;
}
