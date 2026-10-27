const MAX_BYTES=5*1024*1024,MAX_FILES=10,MAX_TOTAL_BYTES=20*1024*1024;
export function requirementCreateBlocker(state,busy=false){
 if(busy)return 'Đang xử lý thao tác hiện tại. Vui lòng đợi.';
 const pending=state.files.filter(f=>f.pending).length,failed=state.files.filter(f=>f.error).length;
 if(pending)return `Đang đọc ${pending} tài liệu. Nút tạo dự án sẽ mở khi đọc xong.`;
 if(failed)return `${failed} tài liệu đọc lỗi. Xem lỗi dưới từng file; bỏ file lỗi hoặc chọn lại trước khi tạo dự án.`;
 return '';
}
async function encode(file){
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 return {filename:file.name,encoding:'base64',content:btoa(binary)};
}

/** Form-local drafts. Removed rows never receive late preview results. */
export function createRequirementFileDraft({preview,onChange=()=>{}}){
 let files=[],error='',nextId=0,queue=Promise.resolve();
 const snapshot=()=>({files:files.map(f=>({...f})),error,pending:files.some(f=>f.pending)});
 const notify=()=>onChange(snapshot());
 const exists=id=>files.some(f=>f.id===id);
 const patch=(id,changes)=>{files=files.map(f=>f.id===id?{...f,...changes}:f);notify()};
 return {
  get state(){return snapshot()},
  clear(){files=[];error='';notify()},
  remove(id){files=files.filter(f=>f.id!==id);error='';notify()},
  async add(selected){
   const incoming=Array.from(selected||[]);if(!incoming.length)return;
   error='';
   if(files.length+incoming.length>MAX_FILES)error='Chỉ đính kèm tối đa 10 tài liệu.';
   else if(incoming.some(f=>!f.size||f.size>MAX_BYTES))error='Mỗi file cần có nội dung và tối đa 5 MB.';
   else if([...files,...incoming].reduce((sum,f)=>sum+f.size,0)>MAX_TOTAL_BYTES)error='Tổng dung lượng tài liệu vượt 20 MB.';
   if(error){notify();return}
   const entries=incoming.map(file=>({file,id:`brief-file-${++nextId}`}));
   files.push(...entries.map(({file,id})=>({id,filename:file.name,size:file.size,pending:true,reading:false,error:'',text:'',warnings:[],upload:null,textSha256:null})));notify();
   const run=async()=>{
    for(const {file,id} of entries){
     if(!exists(id))continue;
     patch(id,{reading:true});
     try{
      if(!/\.(docx?|pdf)$/i.test(file.name))throw Error('Chỉ hỗ trợ Word (.doc, .docx) và PDF.');
      const upload=await encode(file);if(!exists(id))continue;
      const result=await preview(upload);if(!exists(id))continue;
      patch(id,{pending:false,reading:false,upload,text:result.text,textSha256:result.textSha256,warnings:result.warnings||[]});
     }catch(e){if(exists(id))patch(id,{pending:false,reading:false,error:e.message})}
    }
   };
   queue=queue.then(run,run);await queue;
  },
  payload(notes){
   if(files.some(f=>f.pending))throw Error('Đang đọc tài liệu. Vui lòng đợi.');
   const failed=files.find(f=>f.error);if(failed)throw Error(`${failed.filename}: ${failed.error}`);
   const brief=String(notes||'').trim();
   if(!files.length&&brief.length<15)throw Error('Nhập ít nhất 15 ký tự hoặc đính kèm tài liệu Word/PDF.');
   const combined=[brief,...files.map(f=>`=== FILE: ${f.filename} ===\n${f.text}`)].filter(Boolean).join('\n\n');
   if(combined.length>100000)throw Error('Tổng nội dung vượt 100.000 ký tự. Hãy giảm hoặc chia nhỏ tài liệu.');
   return {brief,...(files.length?{requirementFiles:files.map(f=>({...f.upload,previewTextSha256:f.textSha256}))}:{})};
  }
 };
}

export function bindRequirementFileInput({preview,isBusy=()=>false,document=globalThis.document}){
 const $=id=>document.getElementById(id);
 const file=$('brief-file'),notes=$('brief-input'),choose=$('brief-file-choose'),submit=$('create-btn'),list=$('brief-file-list');
 const rows=new Map();let draft;
 const make=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text)el.textContent=text;return el};
 const rowFor=entry=>{
  let row=rows.get(entry.id);if(row)return row;
  const root=make('div','brief-file-entry'),heading=make('div','brief-file-selection'),name=make('strong'),remove=make('button','quiet','Bỏ file');
  root.dataset.fileId=entry.id;root.setAttribute('role','listitem');name.textContent=entry.filename;remove.type='button';remove.setAttribute('aria-label',`Bỏ file ${entry.filename}`);
  remove.onclick=()=>{draft.remove(entry.id);choose.focus()};heading.append(name,remove);
  const status=make('p','brief-file-message'),error=make('p','brief-file-message brief-file-error'),warning=make('p','brief-file-message');error.setAttribute('role','alert');
  const details=make('details','brief-file-preview'),summary=make('summary',null,'Xem trước nội dung đọc từ file'),label=make('label','sr-only',`Nội dung trích từ ${entry.filename}`),text=make('textarea');
  text.id=entry.id+'-text';text.rows=5;text.readOnly=true;label.htmlFor=text.id;details.open=true;details.append(summary,label,text);root.append(heading,status,error,warning,details);list.append(root);
  row={root,remove,status,error,warning,details,text};rows.set(entry.id,row);return row;
 };
 const refresh=state=>{
  const ids=new Set(state.files.map(f=>f.id));for(const [id,row] of rows)if(!ids.has(id)){row.root.remove();rows.delete(id)}
  for(const entry of state.files){
   const row=rowFor(entry);row.root.setAttribute('aria-busy',String(entry.pending));
   row.status.textContent=entry.pending?(entry.reading?'Đang đọc nội dung tài liệu…':'Đang chờ đọc…'):entry.upload?`Đã đọc ${entry.text.length.toLocaleString('vi-VN')} ký tự. File gốc sẽ được lưu cùng dự án.`:'';
   row.error.textContent=entry.error;row.warning.textContent=entry.warnings.join(' ');row.details.hidden=!entry.upload;row.text.value=entry.text;row.remove.disabled=isBusy();
  }
  const ready=state.files.filter(f=>f.upload).length,bytes=state.files.reduce((sum,f)=>sum+f.size,0);
  const failed=state.files.filter(f=>f.error).length;
  $('brief-file-status').textContent=state.files.length?`${state.files.length}/10 tài liệu · ${(bytes/1024/1024).toLocaleString('vi-VN',{maximumFractionDigits:2})}/20 MB · Đã đọc ${ready}/${state.files.length}${failed?` · ${failed} file lỗi`:''}`:'';
  $('brief-file-error').textContent=state.error;
  $('brief-file-preview-hint').hidden=!ready;
  notes.required=!ready;notes.minLength=ready?0:15;notes.rows=ready?3:9;
  $('brief-input-label').textContent=ready?'Bổ sung yêu cầu (không bắt buộc)':'Yêu cầu ban đầu';
  const blocker=requirementCreateBlocker(state,isBusy());
  submit.disabled=!!blocker;
  $('create-blocker').textContent=blocker;
  file.disabled=isBusy();choose.disabled=isBusy();
  if(ready&&!$('title-input').value.trim())$('title-input').value=state.files.find(f=>f.upload).filename.replace(/\.[^.]+$/,'').slice(0,160);
 };
 draft=createRequirementFileDraft({preview,onChange:refresh});
 choose.onclick=()=>file.click();
 file.onchange=()=>{const selected=Array.from(file.files||[]);file.value='';if(selected.length)void draft.add(selected)};
 document.addEventListener('ba-idle',()=>refresh(draft.state));refresh(draft.state);return draft;
}
