import {parentPort,workerData} from 'node:worker_threads';

try{
 const bytes=Buffer.from(workerData.bytes),parts=[],warnings=[];
 if(workerData.extension==='pdf'){
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWorkerFetch:false,enableXfa:false,verbosity:0});
  try{
   const pdf=await loading.promise;
   if(pdf.numPages>200)throw Error('PDF vượt 200 trang. Hãy chia nhỏ tài liệu.');
   let empty=0;
   for(let n=1;n<=pdf.numPages;n++){
    const page=await pdf.getPage(n),content=await page.getTextContent();
    const text=content.items.map(item=>typeof item.str==='string'?item.str+(item.hasEOL?'\n':' '):'').join('').trim();
    if(!text)empty++;
    parts.push(text);page.cleanup();
    if(parts.join('\n\n').length>100000)throw Error('Nội dung vượt 100.000 ký tự. Hãy chia nhỏ tài liệu.');
   }
   if(empty)warnings.push(`Có ${empty} trang không đọc được chữ (trang trắng hoặc ảnh). Hãy kiểm tra bản gốc; trang ảnh cần OCR.`);
  }finally{await loading.destroy()}
 }else{
  const {default:WordExtractor}=await import('word-extractor');
  const doc=await new WordExtractor().extract(bytes);
  for(const method of ['getBody','getHeaders','getFootnotes','getEndnotes','getTextboxes','getAnnotations'])parts.push(doc[method]({filterUnicode:false}));
 }
 const text=parts.filter(Boolean).join('\n\n').replace(/\r\n?/g,'\n').replaceAll('\0','').trim();
 if(text.length<15)throw Error('Không tìm thấy đủ nội dung chữ trong file. Với PDF scan hoặc ảnh, hãy chạy OCR rồi tải lại.');
 if(text.length>100000)throw Error('Nội dung vượt 100.000 ký tự. Hãy chia nhỏ tài liệu.');
 parentPort.postMessage({text,warnings});
}catch(error){
 const message=/OCR|100.000|200 trang/.test(error.message||'')?error.message:'Không đọc được file Word/PDF. File có thể bị lỗi, được bảo vệ bằng mật khẩu hoặc không có nội dung chữ; hãy mở khóa hoặc chuyển sang DOCX/PDF có chữ.';
 parentPort.postMessage({error:message});
}
