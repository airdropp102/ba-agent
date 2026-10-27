import {renderDesignDirection} from './design-direction-ui.js';
import {bindRequirementFileInput} from './requirement-file-ui.js';
import {completeDrafts,generateQuestionGroups,selectRecommendedDrafts,uploadDraftAttachments} from './clarification-batch-ui.js';
import {candidateAllowed,filterQuestions,renderQuestionForm,referencedRequirements,processAreaHelp} from './clarification-ui.js';
import {patchQualityDashboard} from './quality-dashboard-ui.js';
import {watchWorkflowJob,workflowStatus,elapsedLabel} from './workflow-progress.js';
import {figmaUiState,approvedGalleryScreens,screenPreviewUrl,projectToRestore,figmaFailureMessage} from './figma-review-ui.js';
const $ = id => document.getElementById(id);
const state={project:null,tab:'workflow',busy:false,docCache:{},workflowPlatform:'web',prototypePlatform:'web',workflowJob:null,questionPriority:'all',questionStatus:'open',answerDrafts:{},suggestionJobs:{},figmaDesign:null,figmaJob:null,figmaRelay:null,figmaForm:{},figmaPollKey:null};
const stages=['NEW','ANALYZED','REVIEWED','GENERATED'];
const wfLabels={BRAINSTORM:'Brainstorming',ELICITATION:'Elicitation',GAP_ANALYSIS:'Gap Analysis',CLARIFICATION:'Clarification',BA_REVIEW:'BA Review',ERP_SOLUTION_DESIGN:'Thiết kế giải pháp ERP',DELIVERABLES:'BRD / SRS / Prototype'};
const statusNames={NEW:'Mới tạo',ANALYZED:'Đã phân tích',REVIEWED:'BA đã rà soát',GENERATED:'Đã sinh tài liệu & prototype'};
const documentLabels={prd:'Product Requirements Document',brd:'Business Requirements Document',srs:'Software Requirements Specification',urd:'User / Stakeholder Requirements Document','use-cases':'Use case specification','user-stories':'User stories'};
// Cache only the selected project/version; archived data is displayed explicitly as historical.
let referenceHistoryCache=null;
let qualityDashboardCache=null;
function loadRequirementReferences(project,label){
 const key=`${project.id}:${project.version}`;
 if(referenceHistoryCache?.key!==key)referenceHistoryCache={key,promise:null};
 const cache=referenceHistoryCache;
 cache.promise??=api(`/api/projects/${project.id}/requirement-references`).then(result=>{
  if(result.projectId!==project.id||result.projectVersion!==project.version)throw Error('Dự án đã thay đổi; tải lại bản phân tích.');
  return result.requirements;
 }).catch(error=>{cache.promise=null;throw error;});
 return cache.promise.then(rows=>referencedRequirements(label,rows).items);
}
let toastTimer;
function toast(message,isError=false){const e=$('toast');e.textContent=message;e.className='toast visible'+(isError?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.className='toast',4500)}
function elt(tag,text,cls){const el=document.createElement(tag);if(text!==undefined&&text!==null)el.textContent=String(text);if(cls)el.className=cls;return el}
function add(parent,...children){for(const child of children)if(child)parent.append(child);return parent}
const iconPaths={plus:'M12 5v14M5 12h14',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',menu:'M4 6h16M4 12h16M4 18h16',grid:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',folder:'M3 7V5h6l2 2h10v13H3z',document:'M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6',layers:'m12 3 10 5-10 5L2 8zM2 12l10 5 10-5M2 16l10 5 10-5',shield:'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6zM8 12l3 3 5-6',sparkles:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5zM20 2v4M18 4h4',arrow:'M4 12h16m-6-6 6 6-6 6',download:'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',upload:'M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4',refresh:'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 14 6M18 18a8 8 0 0 1-14-6'};
function icon(name){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',iconPaths[name]||iconPaths.document);svg.append(path);return svg;}
function button(text,fn,css='quiet'){const b=elt('button',null,css),match=text.match(/^([↓↑✦↻↺↗])\s*/),names={'↓':'download','↑':'upload','✦':'sparkles','↻':'refresh','↺':'refresh','↗':'arrow'};if(match)b.append(icon(names[match[1]]));b.append(document.createTextNode(match?text.slice(match[0].length):text));b.onclick=fn;b.disabled=state.busy;return b}
function closeNavigation(){const sidebar=$('workspace-navigation');sidebar.classList.remove('is-open');$('nav-toggle').setAttribute('aria-expanded','false');$('nav-toggle').setAttribute('aria-label','Mở danh sách dự án');}
function filterProjectList(){const normalized=value=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d');const query=normalized($('project-search').value);let visible=0;document.querySelectorAll('.project-link').forEach(b=>{b.hidden=!normalized(b.dataset.title).includes(query);if(!b.hidden)visible++});$('project-no-results')?.remove();if(!visible&&query){const empty=elt('p','Không tìm thấy dự án phù hợp.','empty');empty.id='project-no-results';$('project-list').append(empty)}}

let authToken=sessionStorage.getItem('ba-studio-token')||'';
let reviewerToken=sessionStorage.getItem('ba-studio-reviewer-token')||'';
let pendingLogin=null;
async function authenticatedFetch(route,opts={}){
  const run=()=>fetch(route,{...opts,headers:{...opts.headers,...(authToken?{Authorization:`Bearer ${authToken}`}:{}),...(reviewerToken?{'X-BA-Reviewer-Token':reviewerToken}:{})}});
  let res=await run();
  if(res.status===401){
    const detail=await res.clone().json().catch(()=>({}));
    if(/reviewer token required/i.test(detail.error||'')){
      const entered=prompt('Reviewer identity token (BA_REVIEWER_TOKENS_JSON):');
      if(!entered)throw new Error('Đã hủy xác thực reviewer.');
      reviewerToken=entered;sessionStorage.setItem('ba-studio-reviewer-token',entered);
      res=await run();
      if(res.status===401){reviewerToken='';sessionStorage.removeItem('ba-studio-reviewer-token')}
      return res;
    }
    if(!pendingLogin)pendingLogin=Promise.resolve().then(()=>prompt('BA Studio network access token:'));
    const entered=await pendingLogin;pendingLogin=null;
    if(!entered)throw new Error('Đã hủy xác thực.');
    authToken=entered;sessionStorage.setItem('ba-studio-token',entered);res=await run();
    if(res.status===401){authToken='';sessionStorage.removeItem('ba-studio-token')}
  }
  return res;
}
async function api(route,method='GET',body){
  const headers=body?{'Content-Type':'application/json'}:{};
  if(method!=='GET' && /^\/api\/projects\/[0-9a-f-]{36}\//i.test(route) && state.project?.version)headers['If-Match']=String(state.project.version);
  const res=await authenticatedFetch(route,{method,headers,body:body?JSON.stringify(body):undefined});
  const result=await res.json();if(!res.ok)throw new Error(result.error||`HTTP ${res.status}`);return result;
}
async function download(route,filename){
  const res=await authenticatedFetch(route);if(!res.ok)throw new Error('Không thể tải file: HTTP '+res.status);
  const blob=await res.blob();const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=url;anchor.download=filename||route.split('?')[0].split('/').at(-1);document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function work(fn){if(state.busy)return;state.busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn()}catch(e){toast(e.message,true)}finally{state.busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);document.dispatchEvent(new Event('ba-idle'));}}
async function loadProjects({restore=false}={}){const projects=await api('/api/projects');const list=$('project-list');$('project-count').textContent=projects.length;list.replaceChildren();if(!projects.length)list.append(elt('p','Chưa có dự án','empty'));for(const p of projects){const b=elt('button',null,'project-link'+(state.project?.id===p.id?' selected':''));add(b,elt('strong',p.title),elt('small',`${statusNames[p.status]} · v${p.version}${p.demo?' · DEMO':''}`));b.dataset.title=p.title;b.title=p.title;b.setAttribute('aria-current',state.project?.id===p.id?'page':'false');b.onclick=()=>work(async()=>{const fresh=await api(`/api/projects/${p.id}`);await selectProject(fresh);closeNavigation();$('page-title').focus()});list.append(b)}filterProjectList();if(restore&&!state.project&&projects.length){const project=projectToRestore(projects,localStorage.getItem('ba-studio:lastProjectId'));const fresh=await api(`/api/projects/${project.id}`);await selectProject(fresh,localStorage.getItem('ba-studio:lastProjectTab')||'workflow')}}
function resetWelcome(){$('welcome-view').hidden=false;$('project-view').hidden=true;$('page-title').textContent='Bắt đầu từ một ý tưởng.';$('location-label').textContent='Dự án mới';closeNavigation();$('page-subtitle').textContent='Cùng biến yêu cầu ban đầu thành tài liệu rõ ràng và prototype trực quan.';state.project=null;state.docCache={};loadProjects().catch(e=>toast(e.message,true))}
async function selectProject(project,tab='workflow'){state.project=project;state.docCache={};state.tab=tab;localStorage.setItem('ba-studio:lastProjectId',project.id);localStorage.setItem('ba-studio:lastProjectTab',tab);state.workflowPlatform=project.workflow?.platform||'web';state.prototypePlatform=project.figmaDesign?.platform||project.workflow?.platform||'web';state.figmaForm={};state.figmaDesign=null;state.figmaJob=null;try{const [design,relay]=await Promise.all([api(`/api/projects/${project.id}/figma-design`),api('/api/figma/relay')]);state.figmaDesign=design.figmaDesign;state.figmaJob=design.job;state.figmaRelay=relay}catch{}$('welcome-view').hidden=true;$('project-view').hidden=false;$('page-title').textContent=project.title;$('page-subtitle').textContent='Phiên bản '+project.version+' · Cập nhật '+new Date(project.updatedAt).toLocaleString('vi-VN');$('project-id').textContent='PROJECT / '+project.id.split('-')[0].toUpperCase();$('status-label').textContent=statusNames[project.status]+(project.demo?' • DEMO':'');const index=stages.indexOf(project.status);document.querySelectorAll('.step').forEach((e,i)=>e.classList.toggle('done',i<=index));await render();if(['QUEUED','DESIGNING'].includes(state.figmaDesign?.state))pollFigmaDesign(project.id);loadProjects().catch(e=>toast(e.message,true))}
function setTab(tab){state.tab=tab;if(state.project)localStorage.setItem('ba-studio:lastProjectTab',tab);render().catch(e=>toast(e.message,true))}
async function render(){
  const p=state.project;if(!p)return;
  document.querySelectorAll('.tab').forEach(b=>{const active=b.dataset.tab===state.tab;b.classList.toggle('active',active);b.setAttribute('aria-current',active?'page':'false');if(active)$('location-label').textContent=b.textContent.trim()});
  $('workflow-content').hidden=state.tab!=='workflow';
  $('analysis-content').hidden=state.tab!=='analysis';
  $('document-content').hidden=!Object.hasOwn(documentLabels,state.tab);
  $('prototype-content').hidden=state.tab!=='prototype';
  $('files-content').hidden=state.tab!=='files';
  $('reanalyze-btn').disabled=!p.analysis;
  if(state.tab==='workflow')renderWorkflow();
  else if(state.tab==='analysis')renderAnalysis();
  else if(state.tab==='prototype')renderPrototype();
  else if(state.tab==='files')await renderProjectFiles();
  else await renderDoc(state.tab);
}
async function progressWorkflow(){
  const id=state.project.id;
  try{
    const queued=await api(`/api/projects/${id}/workflow/jobs`,'POST',{auto:true,platform:state.workflowPlatform||state.project.workflow?.platform||'web'});
    toast('Job đã được ghi vào SQLite queue. Tự khôi phục khi worker khởi động lại.');
    const job=await watchWorkflowJob({
      readJob:()=>api(`/api/projects/${id}/workflow/jobs/${queued.jobId}`),
      readProject:()=>api(`/api/projects/${id}`),
      onUpdate:async(project,currentJob)=>{
        if(state.project?.id!==id)return;
        state.workflowJob={projectId:id,...currentJob};
        await selectProject(project,'workflow');
        document.querySelectorAll('button').forEach(b=>b.disabled=state.busy);
      }
    });
    if(job?.state==='DEAD_LETTER')throw new Error('Workflow job vào dead-letter. Xem audit log và kiểm tra lại trước khi retry.');
    if(job?.state!=='SUCCEEDED')throw new Error('Job vẫn đang chạy trên server. Tải lại dự án để xem trạng thái mới nhất.');
    toast(state.project.workflow?.state==='COMPLETED'?'Đã tạo tài liệu. Mở Prototype để quản lý thiết kế Figma.':'Workflow đã tới checkpoint hoặc human gate.');
  }catch(e){
    try{await selectProject(await api(`/api/projects/${id}`),'workflow')}catch{}
    throw e;
  }
}

async function renderProjectFiles(){
  const p=state.project,root=$('files-content');root.replaceChildren();
  const location=await api(`/api/projects/${p.id}/workspace`);
  const workspace=panel('Tài liệu dự án','Lưu yêu cầu, tài liệu tham khảo và biên bản để mọi thông tin luôn ở cùng dự án.');workspace.classList.add('documents-upload-panel');
  const meta=elt('details',null,'documents-storage');meta.append(elt('summary','Thông tin lưu trữ'),elt('p',`Thư mục: ${location.relativePath} · Phiên bản ${location.version}`),elt('p','PRD, BRD, SRS: 02-requirements · Prototype: 03-prototypes · Handoff: 08-sessions. Tài liệu chưa được BA duyệt luôn là bản nháp.'));workspace.append(meta);
  const input=elt('input');input.type='file';input.accept='.txt,.md,.json,.csv';input.id='project-document-file';input.hidden=true;
  const select=elt('select');select.id='project-document-category';for(const [value,title] of [['customer','Yêu cầu khách hàng'],['reference','Tài liệu tham khảo'],['approval','Biên bản phê duyệt']]){
    const opt=elt('option',title);opt.value=value;select.append(opt);
  }
  const actions=elt('div',null,'documents-upload-grid'),category=elt('div',null,'document-field'),categoryLabel=elt('label','Loại tài liệu');categoryLabel.htmlFor=select.id;category.append(categoryLabel,select,elt('small','Chọn nhóm phù hợp với nội dung.'));
  const fileField=elt('div',null,'document-field'),fileLabel=elt('label','Tệp đính kèm');fileLabel.htmlFor=input.id;
  const picker=elt('div',null,'document-picker'),fileInfo=elt('div',null,'document-file-info'),filename=elt('strong','Chưa chọn tệp'),fileHint=elt('small','TXT, MD, JSON, CSV · Tối đa 300 KB');fileInfo.setAttribute('aria-live','polite');fileInfo.append(filename,fileHint);
  const choose=button('Chọn tệp',()=>input.click(),'quiet');choose.setAttribute('aria-controls',input.id);picker.append(icon('upload'),fileInfo,choose,input);fileField.append(fileLabel,picker);input.onchange=()=>{const file=input.files?.[0];filename.textContent=file?file.name:'Chưa chọn tệp';fileHint.textContent=file?`${Math.ceil(file.size/1024)} KB · Sẵn sàng lưu`:'TXT, MD, JSON, CSV · Tối đa 300 KB';picker.classList.toggle('has-file',!!file);if(file&&file.size>300000)fileHint.textContent='Tệp vượt giới hạn 300 KB. Vui lòng chọn tệp nhỏ hơn.'};actions.append(category,fileField);
  const footer=elt('div',null,'documents-upload-footer'),note=elt('p');note.append(icon('shield'),elt('span','Bản gốc được giữ nguyên và lưu riêng trong dự án.'));footer.append(note,button('↑ Lưu vào dự án',()=>work(async()=>{
    if(!input.files?.length)throw new Error('Chọn một file tài liệu trước.');
    const file=input.files[0];if(file.size>300000)throw new Error('Tệp vượt 300 KB; dùng API/CLI batch riêng cho tệp lớn.');
    await api(`/api/projects/${p.id}/files`,'POST',{category:select.value,filename:file.name,content:await file.text()});
    toast('Tài liệu đã được ghi riêng theo dự án, kèm mã định danh và checksum.');await renderProjectFiles();
  }),'primary'));
  workspace.append(actions,footer);root.append(workspace);
  const documents=await api(`/api/projects/${p.id}/files`);
  const listing=panel('Tài liệu đã lưu','Các tệp bổ sung của dự án, sẵn sàng để xem hoặc tải xuống.');listing.classList.add('documents-list-panel');listing.querySelector('.section-heading').append(elt('span',documents.length+' tài liệu','pill'));
  if(!documents.length){const empty=elt('div',null,'documents-empty'),symbol=elt('span',null,'documents-empty-icon');symbol.append(icon('folder'));empty.append(symbol,elt('h3','Tài liệu đầu tiên bắt đầu từ đây'),elt('p','Chọn một tệp ở phía trên và nhấn “Lưu vào dự án” để bổ sung thông tin.'));listing.append(empty)}
  for(const doc of documents){
    const row=elt('div',null,'document-list-row'),symbol=elt('span',null,'document-type-icon'),info=elt('div',null,'document-list-info');symbol.append(icon('document'));info.append(elt('strong',doc.filename),elt('small',`${({customer:'Yêu cầu khách hàng',reference:'Tài liệu tham khảo',approval:'Biên bản phê duyệt'})[doc.category]||doc.category} · ${Math.ceil(doc.size_bytes/1024)} KB`));const integrity=elt('details',null,'document-integrity');integrity.append(elt('summary','Mã kiểm tra'),elt('code',doc.sha256));info.append(integrity);row.append(symbol,info);
    row.append(button('↓ Đọc / tải',()=>work(async()=>{
      const result=await api(`/api/projects/${p.id}/files/${doc.id}`);
      const content=result.encoding==='base64'?Uint8Array.from(atob(result.content),c=>c.charCodeAt(0)):result.content;
      const blob=new Blob([content],{type:result.encoding==='base64'?'application/octet-stream':'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=result.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }),'quiet'));
    listing.append(row);
  }
  root.append(listing);
}

function refreshQualityDashboard(p,root){
  // Quality & FinOps are read-only, request-scoped metrics; no source text is transmitted to the dashboard.
  if(qualityDashboardCache?.projectId!==p.id){
    const initial=panel('Chất lượng & chi phí AI','Kiểm tra xác định bằng chứng và truy vết; không chứng nhận tính đúng nghiệp vụ.');
    initial.append(elt('p','Đang tải các chỉ số chất lượng...'));
    qualityDashboardCache={projectId:p.id,panel:initial,request:0};
  }
  const cache=qualityDashboardCache,livePanel=cache.panel,request=++cache.request;
  if(livePanel.parentNode!==root)root.append(livePanel);
  Promise.all([api(`/api/projects/${p.id}/quality`),api(`/api/projects/${p.id}/quality/ai`),api(`/api/projects/${p.id}/quality/history`)]).then(([q,ai,history])=>{
    if(!livePanel.isConnected||state.project?.id!==p.id||cache!==qualityDashboardCache||request!==cache.request)return;
    const qualityPanel=elt('section',null,'panel quality-dashboard');
    const heading=elt('div',null,'section-heading'),title=elt('div');title.append(elt('span','SỨC KHỎE DỰ ÁN','overline'),elt('h2','Chất lượng & chi phí AI'),elt('p','Theo dõi độ đầy đủ của đặc tả và mức sử dụng AI trong dự án.'));
    const gateNames={PASS:'Đạt kiểm tra',REVIEW:'Cần rà soát',BLOCK:'Chưa đạt kiểm tra'};
    const badge=elt('span',gateNames[q.decision]||q.decision,'quality-badge '+(q.decision==='PASS'?'good':q.decision==='BLOCK'?'blocked':'review'));heading.append(title,badge);qualityPanel.replaceChildren(heading);
    const summary=elt('div',null,'quality-summary');
    for(const [value,label,note,name] of [[q.scorePercent==null?'—':q.scorePercent+'%','Điểm kiểm tra','Theo tiêu chí tự động','shield'],[q.findings.length,'Điểm cần xem xét','Chi tiết ở bên dưới','search'],[ai.calls,'Lượt sử dụng AI','Các lượt đã được ghi nhận','sparkles'],[ai.knownCostUsd==null?'Chưa xác định':'$'+ai.knownCostUsd,'Chi phí đã biết',ai.unknownCostCalls?`${ai.unknownCostCalls} lượt chưa có chi phí`:'Từ dữ liệu được ghi nhận','document']]){
      const card=elt('div',null,'quality-kpi'),top=elt('div',null,'quality-kpi-label');top.append(icon(name),elt('span',label));card.append(top,elt('strong',value),elt('small',note));summary.append(card);
    }
    qualityPanel.append(summary);
    const columns=elt('div',null,'quality-columns'),coverage=elt('section',null,'quality-section'),usage=elt('section',null,'quality-section');
    coverage.append(elt('h3','Độ phủ yêu cầu'),elt('p','Những thành phần đã có trong đặc tả.','subtle'));
    for(const [key,label] of [['evidence','Bằng chứng nguồn'],['actors','Vai trò sử dụng'],['acceptance','Tiêu chí nghiệm thu'],['documentTrace','Truy vết tài liệu']]){
      const rate=q.rates[key],row=elt('div',null,'coverage-item'),line=elt('div',null,'coverage-label');line.append(elt('span',label),elt('b',rate==null?'Chưa có dữ liệu':Math.round(rate*100)+'%'));row.append(line);
      if(rate!=null){const bar=elt('div',null,'coverage-track'),fill=elt('span');fill.style.width=Math.min(100,Math.max(0,rate*100))+'%';bar.setAttribute('aria-hidden','true');bar.classList.toggle('incomplete',rate<1);bar.append(fill);row.append(bar)}coverage.append(row);
    }
    usage.append(elt('h3','Sử dụng AI'),elt('p','Chỉ hiển thị số liệu được hệ thống ghi nhận.','subtle'));
    const usageList=elt('dl',null,'usage-list');
    for(const [label,value] of [['Token đầu vào',ai.inputTokens==null?'Chưa xác định':ai.inputTokens.toLocaleString('vi-VN')],['Token đầu ra',ai.outputTokens==null?'Chưa xác định':ai.outputTokens.toLocaleString('vi-VN')],['Thời gian phản hồi p95',ai.p95LatencyMs==null?'Chưa có dữ liệu':(ai.p95LatencyMs/1000).toLocaleString('vi-VN',{maximumFractionDigits:1})+' giây'],['Số lượt trong mẫu p95',ai.p95SampleSize??'Chưa có dữ liệu']]){const row=elt('div');row.append(elt('dt',label),elt('dd',value));usageList.append(row)}usage.append(usageList);
    const hint=elt('p',null,'quality-info');hint.append(icon('document'),elt('span','Thiếu dữ liệu token hoặc bảng giá thì tổng chi phí vẫn chưa xác định.'));usage.append(hint);columns.append(coverage,usage);qualityPanel.append(columns);
    const findingNames={NO_FUNCTIONAL_REQUIREMENTS:'Chưa có yêu cầu chức năng',UNTRUSTED_CONFIRMED_EVIDENCE:'Bằng chứng nguồn cần xác minh',ACTOR_MISSING:'Thiếu vai trò sử dụng',AC_MISSING:'Thiếu tiêu chí nghiệm thu',GOAL_UNMAPPED:'Chưa liên kết mục tiêu',DOC_TRACE_MISSING:'Thiếu truy vết tài liệu',HIGH_CLARIFICATIONS_PENDING:'Còn câu hỏi ưu tiên cao',BA_REVIEW_REQUIRED:'Cần BA rà soát'};
    if(q.findings.length){const detail=elt('details',null,'quality-details');detail.dataset.qualityKey='findings';detail.open=q.decision==='BLOCK';const toggle=elt('summary');toggle.append(elt('span','Các điểm cần xem xét'),elt('span',q.findings.length+' mục','pill'));detail.append(toggle,dataTable(['Nội dung','Mức độ','Yêu cầu'],q.findings.slice(0,20).map(f=>{const label=elt('div');label.append(elt('strong',findingNames[f.code]||f.code),elt('small',f.code));return [label,elt('span',f.severity==='BLOCK'?'Cần xử lý':f.severity==='WARN'?'Cần rà soát':f.severity,'quality-badge '+(f.severity==='BLOCK'?'blocked':'review')),f.requirementId||'Toàn dự án']})));if(q.findings.length>20)detail.append(elt('small',`Hiển thị 20/${q.findings.length} mục. Xem thêm trong tab Phân tích.`));qualityPanel.append(detail)}
    if(history.length){const detail=elt('details',null,'quality-details');detail.dataset.qualityKey='history';detail.append(elt('summary','Lịch sử kiểm tra'),dataTable(['Phiên bản','Điểm kiểm tra','Kết quả'],history.slice(0,8).map(h=>['v'+h.version,h.score==null?'—':Math.round(h.score*100)+'%',gateNames[h.decision]||h.decision])));qualityPanel.append(detail)}
    if(q.enforceable&&!q.passed)qualityPanel.append(elt('p','Cổng kiểm tra đang bật: cần cập nhật nguồn hoặc yêu cầu và chạy lại trước khi tạo tài liệu.','note'));
    qualityPanel.append(elt('p','Điểm kiểm tra tự động không thay thế đánh giá nghiệp vụ của BA hoặc phê duyệt của khách hàng.','quality-footnote'));

    patchQualityDashboard(livePanel,qualityPanel);
  }).catch(()=>{
    if(!livePanel.isConnected||cache!==qualityDashboardCache||request!==cache.request)return;
    if(!livePanel.classList.contains('quality-dashboard'))livePanel.lastElementChild.textContent='Chưa tải được chỉ số. Hệ thống sẽ thử lại ở lượt cập nhật tiếp theo.';
  });
}

function renderWorkflow(){
  const p=state.project,w=p.workflow||{stage:'BRAINSTORM',state:'READY',checkpoints:[]},root=$('workflow-content');
  const pollingJob=state.workflowJob?.projectId===p.id?state.workflowJob:null;
  const renderKey=JSON.stringify([p.id,p.version,pollingJob?.id,pollingJob?.state,pollingJob?.attempts,pollingJob?.max_attempts]);
  if(root.dataset.renderKey===renderKey&&root.firstElementChild){
    const status=workflowStatus(p,pollingJob),values=root.querySelectorAll('.workflow-stats .metric b');
    if(values[1])values[1].textContent=elapsedLabel(status.stageSeconds);
    if(values[2])values[2].textContent=elapsedLabel(status.jobSeconds);
    refreshQualityDashboard(p,root);
    return;
  }
  root.dataset.renderKey=renderKey;
  const focusedMetric=qualityDashboardCache?.panel.contains(document.activeElement)?document.activeElement:null;
  root.replaceChildren();
  const finished=w.state==='COMPLETED'||['FIGMA_DESIGN','FIGMA_PUBLISH'].includes(w.stage);
  const head=panel('Hành trình dự án','Chạy theo checkpoint, tự dừng để xác nhận thông tin hoặc BA review. Quản lý thiết kế Figma tại tab Prototype.');
  const job=state.workflowJob?.projectId===p.id?state.workflowJob:null;
  const status=workflowStatus(p,job);head.classList.add('workflow-dashboard');head.dataset.motion=status.active?'active':'idle';
  const hero=elt('div',null,'workflow-hero');hero.dataset.tone=finished?'complete':status.tone;
  const badge=elt('span',status.label,'workflow-status-badge');badge.setAttribute('role','status');
  const stageText=elt('div');stageText.append(elt('small','BƯỚC HIỆN TẠI'),elt('h3',finished?'BRD / SRS / Prototype':wfLabels[w.stage]||w.stage));
  hero.append(stageText,badge);head.append(hero);
  const metrics=elt('div',null,'workflow-stats');
  add(metrics,metric((w.checkpoints||[]).length,'Mốc xử lý đã lưu'),metric(elapsedLabel(status.stageSeconds),'Thời gian bước hiện tại'),metric(elapsedLabel(status.jobSeconds),'Tổng thời gian job'));
  head.append(metrics);
  if(status.job){const note=elt('p',`${status.job.state==='SUCCEEDED'?'Lượt xử lý đã kết thúc':status.job.state==='DEAD_LETTER'?'Đã hết lượt thử':status.active?'Đang chờ kết quả · cập nhật mỗi 2 giây':status.label} · Lần thử ${status.job.attempts||0}/${status.job.max_attempts||3}`,'workflow-job-note');head.append(note);}
  if(['WAITING_ERP_TARGET','WAITING_ERP_DESIGN_REVIEW'].includes(w.state))head.append(elt('p','Hoàn tất xác nhận hoặc review trong phần Thiết kế giải pháp ERP bên dưới.','workflow-callout'));
  if(w.state==='WAITING_CLARIFICATION')head.append(elt('p','Mở Phân tích → Câu hỏi cần làm rõ để chọn gợi ý hoặc nhập câu trả lời.','workflow-callout'));
  if(w.state==='READY')head.append(elt('p','Bấm Chạy / Tiếp tục để xử lý bước tiếp theo.','workflow-callout'));
  const stages=elt('div',null,'workflow-timeline'+(p.solutionProfile?.domain==='erp'?' erp-timeline':''));
  const completed=new Set((w.checkpoints||[]).map(x=>x.stage));
  for(const [i,stage] of Object.keys(wfLabels).filter(stage=>stage!=='ERP_SOLUTION_DESIGN'||p.solutionProfile?.domain==='erp').entries()){
    const step=elt('div',null,'workflow-item'+(completed.has(stage)?' completed':w.stage===stage?' current':''));
    add(step,elt('b',String(i+1).padStart(2,'0')),elt('span',wfLabels[stage]),elt('small',completed.has(stage)?'✓ Checkpoint':stage===w.stage?status.label:'Chưa chạy'));stages.append(step);
  }
  head.append(stages);
  if(!(w.checkpoints||[]).length){
    const config=elt('div',null,'workflow-config');
    config.append(elt('label','Figma target platform: '));
    const select=elt('select');for(const val of ['web','mobile']){const option=elt('option',val);option.value=val;select.append(option)}
    select.value=state.workflowPlatform||w.platform||'web';select.onchange=()=>{state.workflowPlatform=select.value;};config.append(select);head.append(config);
  }
  if((w.checkpoints||[]).length){head.append(button('↺ Bắt đầu run mới (xóa BA review hiện tại)',()=>work(async()=>{
    if(!confirm('Tạo workflow run mới? BA review và prototype hiện tại sẽ được đưa vào lịch sử, các nguồn và requirement ID vẫn được giữ.'))return;
    const next=await api(`/api/projects/${p.id}/workflow/restart`,'POST',{confirm:true,platform:w.platform||'web'});
    await selectProject(next,'workflow');toast('Đã tạo workflow run mới.');
  }),'quiet'));}

  if(w.lastError)head.append(elt('p',`Lỗi ${w.lastError.stage}: ${w.lastError.message}`,'workflow-note'));
  if(finished)head.append(button('Mở Prototype',()=>setTab('prototype'),'primary'));
  if(!finished)head.append(button(w.state==='FAILED'?'↻ Retry qua durable queue':'✦ Chạy / Tiếp tục qua queue',()=>work(progressWorkflow),'primary'));
  head.append(button('Xem jobs & audit trail',()=>work(async()=>{
    const [jobs,audit,metrics]=await Promise.all([api(`/api/projects/${p.id}/workflow/jobs`),api(`/api/projects/${p.id}/audit`),api('/api/metrics')]);
    if(!audit.integrity.valid)throw new Error('Audit integrity FAILED at event '+audit.integrity.atSeq);
    const existing=document.getElementById('audit-panel');if(existing)existing.remove();
    const detail=panel('Job queue & Review Audit',`Audit chain hợp lệ: ${audit.integrity.count} events · All projects: ${metrics.successRateCompleted===null?'—':Math.round(metrics.successRateCompleted*100)+'%'} successful completed jobs`);
    detail.id='audit-panel';
    detail.append(elt('h3','Jobs'));
    detail.append(dataTable(['State','Attempts','Last error'],jobs.slice(0,8).map(x=>[x.state,x.attempts,x.last_error||'—'])));
    detail.append(elt('h3','Review / audit events (latest first)'));
    detail.append(dataTable(['Time','Event','Actor'],audit.events.slice(0,20).map(x=>[x.created_at,x.event_type,x.actor_id])));
    root.append(detail);
  }),'quiet'));
  root.append(head);
  if(p.solutionProfile?.domain==='erp')renderERPSolution(p,root);
  refreshQualityDashboard(p,root);
  if(focusedMetric?.isConnected)focusedMetric.focus({preventScroll:true});
  if(p.brainstorm){
    const bs=panel('Brainstorming — DRAFT','Chỉ là giả thuyết, không phải yêu cầu được xác nhận.');
    bs.append(elt('p',p.brainstorm.summary));
    for(const [k,title] of [['opportunities','Các hướng cần khám phá'],['stakeholderQuestions','Câu hỏi cho stakeholder'],['assumptions','Giả định chưa xác nhận']]){
      bs.append(elt('h3',title));const ul=elt('ul');for(const val of p.brainstorm[k]||[])ul.append(elt('li',val));bs.append(ul);
    }
    root.append(bs);
  }
  if(p.analysis){
    const q=panel('Điểm cần làm rõ','Chỉ số completeness kiểm tra theo quy tắc; không thay cho semantic evaluation hoặc khách hàng ký duyệt.');
    const m=w.gapReport||{};q.append(dataTable(['Metric','Giá trị'],[
      ['Functional requirements',m.frCount??p.analysis.functionalRequirements?.length??0],
      ['Confirmed FR có chứng cứ',m.confirmedEvidenceRate===undefined?'—':Math.round(100*m.confirmedEvidenceRate)+'%'],
      ['Actor coverage',m.actorCoverage===undefined?'—':Math.round(100*m.actorCoverage)+'%'],
      ['Acceptance criteria coverage',m.acceptanceCoverage===undefined?'—':Math.round(100*m.acceptanceCoverage)+'%'],
      ['High-priority blockers',m.highBlockerCount??'—']
    ]));
    const resolvedOrigins=new Set((p.analysis.clarificationQuestions||[]).filter(x=>x.status==='resolved'&&x.resolutionId).map(x=>x.origin).filter(Boolean));
    const blockers=[...(p.analysis.quality?.findings||[]).filter(x=>x.priority==='High'&&(!resolvedOrigins.has(x.id)||['UNVERIFIED_REQUIREMENT','UNVERIFIED_NFR'].includes(x.code))).map(x=>({id:x.id,text:x.question})),...(p.analysis.clarificationQuestions||[]).filter(x=>x.priority==='High'&&x.status!=='resolved').map(x=>({id:x.id,text:x.question}))];
    if(blockers.length){q.append(elt('h3',`Các vấn đề High còn mở (${blockers.length})`));q.append(dataTable(['Mã','Cần xác minh'],blockers.slice(0,30).map(x=>[x.id,x.text])));}
    q.append(button('Mở câu hỏi & gợi ý AI',()=>setTab('analysis'),'secondary'));
    if(p.requirementsRefreshPending)q.append(elt('p','Cần phân tích lại yêu cầu theo các phương án đã được chấp thuận trước khi BA Review/BRD/SRS.','workflow-note'));
    if(w.stage==='CLARIFICATION'&&w.state==='WAITING_CLARIFICATION'&&blockers.length){
      const box=elt('div',null,'workflow-risk');
      add(box,elt('h3','BA quyết định chấp nhận rủi ro còn mở'),elt('p','Chỉ chọn khi chấp nhận làm tài liệu DRAFT với các câu hỏi chưa giải quyết. Không được ghi nhận thành customer sign-off.'));
      const reason=elt('textarea');reason.placeholder='Giải thích quyết định chấp nhận toàn bộ blocker High (ít nhất 20 ký tự)';reason.rows=4;box.append(reason);
      box.append(button('Ghi nhận risk acceptance & tiếp tục',()=>work(async()=>{
        if(!confirm('Chấp nhận toàn bộ rủi ro High được liệt kê để tiếp tục ở trạng thái DRAFT?'))return;
        const response=await api(`/api/projects/${p.id}/workflow/waiver`,'POST',{blockerIds:[...new Set(blockers.map(x=>x.id))],rationale:reason.value});
        await selectProject(response,'workflow');await progressWorkflow();
      }),'secondary'));q.append(box);
    }
    root.append(q);
  }
  if(w.stage==='BA_REVIEW'&&w.state==='WAITING_BA_REVIEW'){
    const review=panel('Rà soát của BA','BA phải xem và phê duyệt kết quả phân tích trước khi sinh tài liệu. Không phải customer approval.');
    review.append(button('Mở biểu mẫu BA Review',()=>setTab('analysis'),'primary'));root.append(review);
  }

}

function panel(title,subtitle){const p=elt('section',null,'panel');const h=elt('div',null,'section-heading');const div=elt('div');add(div,elt('h2',title),elt('p',subtitle));h.append(div);p.append(h);return p}
function metric(number,caption){return add(elt('div',null,'metric'),elt('b',number),elt('span',caption))}
function dataTable(headers,rows){const t=elt('table',null,'data-table'),head=elt('thead'),body=elt('tbody'),tr=elt('tr');for(const h of headers)tr.append(elt('th',h));head.append(tr);for(const row of rows){const r=elt('tr');for(const cell of row){const d=elt('td');if(cell instanceof Node)d.append(cell);else d.textContent=String(cell??'');r.append(d)}body.append(r)}add(t,head,body);const scroll=elt('div',null,'table-scroll');scroll.tabIndex=0;scroll.setAttribute('role','region');scroll.setAttribute('aria-label','Bảng dữ liệu: '+headers.join(', '));scroll.append(t);return scroll}
function renderERPSolution(p,root){
 const box=panel('Thiết kế giải pháp ERP','Sau BA Review: xác nhận nền tảng, tạo bản DRAFT theo từng yêu cầu, rồi rà soát giải pháp.');box.classList.add('erp-design-panel');root.append(box);
 if(!p.review?.approved||p.requirementsRefreshPending){box.append(elt('p','Cần hoàn tất phân tích và BA Review trước khi xác nhận nền tảng hoặc tạo thiết kế.','workflow-note'));return;}
 if(!p.solutionProfile.processAreas?.length){box.append(elt('p','Chọn Business process areas trong Phân tích, lưu và BA Review lại trước khi thiết kế.'));return;}
 box.append(elt('p','Đang tải thiết kế…','erp-design-loading'));
 api(`/api/projects/${p.id}/erp/design`).then(result=>{
  if(!box.isConnected||state.project?.id!==p.id||state.project.version!==p.version)return;
  box.querySelector('.erp-design-loading')?.remove();
  const target=result.target,design=result.design;
  const setup=elt('details',null,'erp-target-setup');setup.open=!target;setup.append(elt('summary',target?`Nền tảng mục tiêu: ${target.platformName} · ${target.version} · ${target.deployment}`:'Xác nhận nền tảng mục tiêu'));
  const form=elt('form',null,'erp-target-form'),fields={},saved=target||p.erpTarget||{};
  const field=(key,label,options)=>{const row=elt('label');row.append(elt('span',label));const input=elt(options?'select':'input');input.name=key;input.required=true;if(options)for(const [value,text] of [['','Chọn…'],...options]){const o=elt('option',text);o.value=value;input.append(o);}else input.maxLength=3000;input.value=saved[key]||'';row.append(input);form.append(row);fields[key]=input;};
  const names={'odoo-community':'Odoo Community','odoo-enterprise':'Odoo Enterprise','erpnext':'ERPNext','custom-build':'Custom Build'};
  const platforms=p.solutionProfile.strategy==='custom'?['custom-build']:p.solutionProfile.candidates;
  field('platformId','Nền tảng đã chọn',platforms.map(id=>[id,names[id]||id]));field('version','Phiên bản mục tiêu');field('edition','Edition / bản phân phối');
  field('deployment','Môi trường triển khai',[['odoo-online','Odoo Online'],['odoo-sh','Odoo.sh'],['self-hosted','Tự vận hành'],['other','Khác — ghi rõ trong phạm vi module']]);
  field('modules','Module / ứng dụng và phạm vi dự kiến');field('sourceReference','Tham chiếu quyết định chọn nền tảng');
  const confirmation=elt('label',null,'erp-target-confirm'),check=elt('input');check.type='checkbox';check.required=true;confirmation.append(check,document.createTextNode('Tôi xác nhận đây là nền tảng mục tiêu cho bản yêu cầu đã review.'));form.append(confirmation);
  const save=button('Xác nhận nền tảng',()=>{},'primary');save.type='submit';form.append(save);form.onsubmit=event=>{event.preventDefault();work(async()=>{const body={confirmed:check.checked};for(const [key,input] of Object.entries(fields))body[key]=input.value;const next=await api(`/api/projects/${p.id}/erp/target`,'POST',body);await selectProject(next,'workflow');toast('Đã xác nhận nền tảng. Có thể tạo thiết kế ERP.');});};
  setup.append(form);box.append(setup);
  if(!target){box.append(elt('p','Chưa có xác nhận còn hiệu lực cho bản BA Review hiện tại.'));return;}
  if(!design||!result.current){box.append(elt('p',design?'Bản thiết kế trước cần cập nhật. Lịch sử được giữ; tạo lại theo đầu vào hiện tại.':'Chưa có bản thiết kế. AI sẽ đề xuất cấu hình, luồng nghiệp vụ, mở rộng và UAT; các phần thiếu bằng chứng cần kiểm chứng.'));box.append(button(design?'Tạo lại thiết kế DRAFT':'Tạo thiết kế DRAFT',()=>work(progressWorkflow),'primary'));}
  if(!design)return;
  const labels={WAITING_FOR_REVIEW:'DRAFT · Chờ BA review',APPROVED:'BA đã duyệt thiết kế · chưa phải customer sign-off',REVISION_REQUESTED:'Đang yêu cầu chỉnh sửa',STALE:'Cần cập nhật theo yêu cầu mới'};
  box.append(elt('p',result.current?labels[design.status]||design.status:'Bản lịch sử — không còn hiệu lực','workflow-note'),elt('p',design.content.summary));
  for(const [areaId] of Object.entries(processAreaDescriptions)){
   const solutions=design.content.solutions.filter(s=>s.processArea===areaId);if(!solutions.length)continue;
   const group=elt('details',null,'erp-design-group');group.append(elt('summary',`${({'lead-to-cash':'Bán hàng và thu tiền','procure-to-pay':'Mua hàng và thanh toán','inventory-to-fulfillment':'Kho và giao hàng','plan-to-produce':'Sản xuất','record-to-report':'Tài chính và kế toán','hire-to-retire':'Nhân sự và tiền lương','master-data':'Dữ liệu chủ và chuyển đổi','integration-security':'Tích hợp và kiểm soát'})[areaId]} · ${solutions.length} yêu cầu`));
   for(const solution of solutions){const item=elt('section',null,'erp-design-solution');item.append(elt('h4',`${solution.requirementId} · ${solution.moduleName}`),elt('p',`Hướng đề xuất: ${solution.approach} · ${design.verification.find(x=>x.requirementId===solution.requirementId)?.status==='NEEDS_VERIFICATION'?'Cần kiểm chứng':'Có đánh giá Fit–Gap của BA; cấu hình đề xuất vẫn cần kiểm chứng'}`));
    const dl=elt('dl');for(const [key,label] of Object.entries({configuration:'Cấu hình dự kiến',workflow:'Luồng nghiệp vụ dự kiến',permissions:'Phân quyền',dataMigration:'Dữ liệu / chuyển đổi',integration:'Tích hợp',customization:'Mở rộng / custom',uat:'UAT đề xuất',upgradeRisks:'Rủi ro nâng cấp',openQuestions:'Cần làm rõ'})){dl.append(elt('dt',label));const dd=elt('dd');if(Array.isArray(solution[key])){const ul=elt('ul');for(const value of solution[key])ul.append(elt('li',value));dd.append(ul);}else dd.textContent=solution[key];dl.append(dd);}item.append(dl);group.append(item);}
   box.append(group);
  }
  if(result.current)box.append(button('↓ Tải thiết kế ERP.md',()=>download(`/api/projects/${p.id}/erp/design/ERP_SOLUTION_DESIGN.md`),'quiet'));
  if(result.current&&design.status==='WAITING_FOR_REVIEW'){
   const review=elt('div',null,'erp-design-review'),label=elt('label','Ghi chú review / yêu cầu chỉnh sửa'),notes=elt('textarea');notes.maxLength=5000;notes.rows=3;label.append(notes);review.append(label);
   const ackLabel=elt('label',null,'erp-target-confirm'),ack=elt('input');ack.type='checkbox';ackLabel.append(ack,document.createTextNode('Tôi đã rà soát và ghi nhận các phần chưa được kiểm chứng. Duyệt thiết kế không xác nhận khả năng ERP hoặc customer sign-off.'));review.append(ackLabel);
   for(const [decision,text] of [['APPROVE','Duyệt thiết kế'],['REQUEST_CHANGES','Yêu cầu chỉnh sửa']])review.append(button(text,()=>work(async()=>{if(notes.value.trim().length<10)throw Error('Nhập ghi chú ít nhất 10 ký tự.');const next=await api(`/api/projects/${p.id}/erp/design/review`,'POST',{decision,notes:notes.value,acknowledgeUnverified:ack.checked,projectVersion:p.version,designId:design.id,contentDigest:design.contentDigest});await selectProject(next,'workflow');toast(decision==='APPROVE'?'Đã duyệt thiết kế; tiếp tục để tạo tài liệu.':'Đã ghi yêu cầu chỉnh sửa; tạo lại để review bản mới.');}),decision==='APPROVE'?'primary':'secondary'));box.append(review);
  }
 }).catch(error=>{if(box.isConnected){box.querySelector('.erp-design-loading')?.remove();box.append(elt('p',error.message,'workflow-note'));}});
}
const processAreaDescriptions={
 'lead-to-cash':[['Phạm vi','Từ khách hàng tiềm năng, cơ hội bán hàng và báo giá đến đơn hàng, giao hàng, lập hóa đơn và thu tiền.'],['Cần làm rõ','Người phụ trách bán hàng, chính sách giá/chiết khấu, duyệt đơn, hạn mức công nợ và xử lý trả hàng hoặc hoàn tiền.']],
 'procure-to-pay':[['Phạm vi','Từ nhu cầu mua sắm, yêu cầu và phê duyệt mua hàng đến đặt hàng nhà cung cấp, nhận hàng, kiểm tra hóa đơn và thanh toán.'],['Cần làm rõ','Hạn mức duyệt, lựa chọn nhà cung cấp, đối chiếu đơn mua–nhận hàng–hóa đơn và xử lý thiếu hàng hoặc chênh lệch giá.']],
 'inventory-to-fulfillment':[['Phạm vi','Quản lý tồn kho và thực hiện giao hàng: nhập, lưu kho, điều chuyển, giữ hàng, lấy hàng, đóng gói, xuất hàng và kiểm kê.'],['Cần làm rõ','Kho/vị trí, đơn vị tính, lô hoặc serial, quy tắc xuất kho, hàng trả lại, tồn âm và truy xuất hàng hóa.']],
 'plan-to-produce':[['Phạm vi','Lập kế hoạch nhu cầu nguyên vật liệu và sản xuất, từ dự báo/đơn hàng đến chuẩn bị vật tư, lệnh sản xuất và hoàn thành thành phẩm.'],['Cần làm rõ','Định mức nguyên vật liệu (BOM), công đoạn, năng lực máy/nhân công, gia công ngoài, sản phẩm dở dang, hao hụt và giá thành.']],
 'record-to-report':[['Phạm vi','Ghi nhận giao dịch kế toán, quản lý sổ cái, công nợ và tài sản; đối soát, khóa sổ và lập báo cáo tài chính/quản trị.'],['Cần làm rõ','Hệ thống tài khoản, kỳ kế toán, tiền tệ, đơn vị/chi nhánh, quy trình duyệt bút toán và yêu cầu thuế/báo cáo theo địa phương.']],
 'hire-to-retire':[['Phạm vi','Vòng đời nhân sự từ tuyển dụng và tiếp nhận đến quản lý hồ sơ, hợp đồng, chấm công, nghỉ phép, lương và nghỉ việc.'],['Cần làm rõ','Vai trò phê duyệt, quyền xem dữ liệu cá nhân, ca làm việc, cách tính lương/phụ cấp và quy định lao động áp dụng.']],
 'master-data':[['Phạm vi','Quản trị dữ liệu dùng chung như khách hàng, nhà cung cấp, sản phẩm, đơn vị tính và tài khoản kế toán; chuyển dữ liệu từ hệ thống cũ.'],['Cần làm rõ','Chủ sở hữu dữ liệu, quy tắc mã hóa, chống trùng, làm sạch, ánh xạ trường, kiểm tra chất lượng và kế hoạch chuyển đổi dữ liệu.']],
 'integration-security':[['Phạm vi','Kết nối các hệ thống và kiểm soát truy cập, phê duyệt, phân tách nhiệm vụ, nhật ký thao tác và khả năng phục hồi.'],['Cần làm rõ','Hệ thống cần tích hợp, chiều/tần suất đồng bộ, xử lý lỗi, đối soát, quyền truy cập và trách nhiệm vận hành.']]
};
function renderERPProfile(p,root){
 const profile=p.solutionProfile||{domain:'general',strategy:'undecided',candidates:[],processAreas:[]};
 const panelEl=panel('ERP Solution Strategy — Build / Open Source / Hybrid','Candidate platforms are proposals, NOT technologies already installed. ERP Fit–Gap must be validated against exact version and edition.');
 const chooser=(label,values,current)=>{const line=elt('label');line.append(elt('div',label,'mini-title'));const input=elt('select');for(const [id,name] of values){const option=elt('option',name);option.value=id;input.append(option)}input.value=current;line.append(input);panelEl.append(line);return input};
 const domain=chooser('Project domain',[['general','General software'],['erp','ERP / enterprise processes']],profile.domain);
 const strategy=chooser('Solution approach',[['undecided','Compare / undecided'],['custom','Build custom'],['open-source','Adopt open-source ERP'],['hybrid','ERP + custom modules/integrations'],['commercial','Commercial ERP']],profile.strategy);
 const checklist=(title,items,selected,descriptions)=>{panelEl.append(elt('div',title,'mini-title'));const checks=[];for(const [id,name] of items){const label=elt('label');label.style.display='inline-flex';label.style.alignItems='center';label.style.margin='0 12px 8px 0';const checkbox=elt('input');checkbox.type='checkbox';checkbox.checked=selected.includes(id);checkbox.value=id;label.append(checkbox,document.createTextNode(' '+name));if(descriptions?.[id]){const row=elt('span',null,'process-area-option');row.append(label);processAreaHelp(name,[...descriptions[id],['Lưu ý','Đây là mô tả phạm vi tham khảo; chọn nhóm không xác nhận yêu cầu hay khả năng của một nền tảng ERP.']],row,elt);panelEl.append(row);}else panelEl.append(label);checks.push(checkbox)}return checks};
 const candidates=checklist('ERP candidates (shortlist)',[['odoo-community','Odoo Community (LGPL-3.0)'],['erpnext','ERPNext (GPL-3.0)'],['odoo-enterprise','Odoo Enterprise (commercial, NOT open-source)']],profile.candidates||[]);
 const candidateNotice=elt('p',null,'workflow-note');panelEl.append(candidateNotice);
 const updateCandidates=()=>{
  let removed=0;for(const input of candidates){const allowed=candidateAllowed(domain.value,strategy.value,input.value);input.disabled=!allowed;if(!allowed&&input.checked){input.checked=false;removed++;}}
  candidateNotice.textContent=removed?'Đã bỏ chọn candidate không phù hợp. Bấm Lưu để áp dụng thay đổi.':strategy.value==='open-source'?'Chỉ chọn ERP open source.':strategy.value==='commercial'?'Chỉ chọn ERP commercial.':'Candidates là phương án đang xem xét, chưa được cài đặt.';
 };
 domain.onchange=updateCandidates;strategy.onchange=updateCandidates;updateCandidates();
 const areas=checklist('Business process areas — select relevant areas', [['lead-to-cash','Lead-to-Cash'],['procure-to-pay','Procure-to-Pay'],['inventory-to-fulfillment','Inventory / Fulfillment'],['plan-to-produce','Manufacturing / MRP'],['record-to-report','Finance / Accounting'],['hire-to-retire','HR / Payroll'],['master-data','Master Data / Migration'],['integration-security','Integrations / Controls']],profile.processAreas||[],processAreaDescriptions);
 panelEl.append(button('Lưu ERP strategy / candidates',()=>work(async()=>{
  const domainValue=domain.value,strategyValue=domainValue==='erp'?strategy.value:'undecided';
  const selected=domainValue==='erp'&&strategyValue!=='custom'?candidates.filter(x=>x.checked).map(x=>x.value):[];
  const next={domain:domainValue,strategy:strategyValue,candidates:selected,processAreas:domainValue==='erp'?areas.filter(x=>x.checked).map(x=>x.value):[]};
  const updated=await api(`/api/projects/${p.id}/erp/profile`,'POST',{solutionProfile:next});await selectProject(updated,'analysis');toast('Đã cập nhật chiến lược ERP; decisions cũ bị vô hiệu nếu thay đổi phạm vi.');
 }),'secondary'));
 root.append(panelEl);
 if(p.solutionProfile?.domain==='erp'){
  const reviewPanel=panel('ERP Fit–Gap / As-Is → To-Be','UNASSESSED cho đến khi BA kiểm chứng bằng demo/version/edition/source; không tự tuyên bố FIT.');
  reviewPanel.append(elt('p','Checklist bắt buộc: business process owners, cross-module flow, master data, migration/cutover, SoD/approval, localization/tax, integration, reconciliation và end-to-end UAT.'));
  root.append(reviewPanel);
  api(`/api/projects/${p.id}/erp`).then(result=>{
    if(state.project?.id!==p.id)return;
    const a=result.assessment;
    reviewPanel.append(elt('p',`${a.assessmentStatus} · ${a.reviewed}/${a.total} assessments · coverage ${Math.round(a.coverage*100)}%`,'mini-title'));
    const checklistData=(a.processChecklist||[]).map(x=>[x.processName,x.questions.map(q=>q.question).join(' | ')]);
    if(checklistData.length)reviewPanel.append(dataTable(['ERP process','Câu hỏi chưa xác nhận'],checklistData));
    for(const item of (a.rows||[]).slice(0,30)){
      const row=elt('div',null,'question');row.append(elt('strong',`${item.requirementId} · ${item.platformName}: ${item.status}`),elt('p',item.requirementName));
      if(item.sourceReference)row.append(elt('small',`${item.verifiedEdition||''} ${item.verifiedVersion||''} · ${item.sourceReference}`));
      const status=elt('select');for(const name of ['FIT_STANDARD','CONFIGURE','EXTEND','INTEGRATE','GAP_BUILD','NOT_APPLICABLE']){const option=elt('option',name);option.value=name;status.append(option)}
      status.value=item.status==='UNASSESSED'?'CONFIGURE':item.status;
      row.append(status,button('BA ghi nhận Fit–Gap',()=>work(async()=>{
        const verifiedVersion=prompt('Phiên bản chính xác đã demo/kiểm tra (VD: 19.0):');if(!verifiedVersion)return;
        const verifiedEdition=prompt('Edition/module đang kiểm chứng (VD: Community / Inventory):');if(!verifiedEdition)return;
        const sourceReference=prompt('Biên bản/demo/test ID hoặc link bằng chứng:');if(!sourceReference)return;
        const rationale=prompt('Lý do phân loại kèm giới hạn, ít nhất 10 ký tự:');if(!rationale)return;
        const updated=await api(`/api/projects/${p.id}/erp/fit-gap`,'POST',{requirementId:item.requirementId,platformId:item.platformId,classification:status.value,verifiedVersion,verifiedEdition,sourceReference,rationale});await selectProject(updated,'analysis');
      }),'quiet'));reviewPanel.append(row);
    }
    if((a.rows||[]).length>30)reviewPanel.append(elt('p','Hiển thị 30 dòng đầu. Dùng API cho đánh giá batch có kiểm soát.'));
  }).catch(e=>reviewPanel.append(elt('p','Không tải được Fit–Gap: '+e.message)));
 }
}
function renderAnalysis(){const p=state.project,root=$('analysis-content');root.replaceChildren();renderERPProfile(p,root);if(!p.analysis){const box=elt('div',null,'empty-block');add(box,elt('h3','Dữ liệu sẵn sàng phân tích'),elt('p',p.brief.slice(0,400)),button('✦ Phân tích yêu cầu',()=>work(analyze),'primary'));root.append(box);return}const a=p.analysis;
if(p.demo)root.append(add(elt('div',null,'alert'),elt('strong','DEMO MODE: '),'Kết quả dùng bộ dữ liệu mẫu, không phải phân tích thực của AI. Với brief khác ví dụ mẫu, hệ thống cố ý để trống requirements nhằm tránh tự bịa.'));
const stats=elt('div',null,'summary-cards');add(stats,metric(a.functionalRequirements.length,'Functional requirements'),metric(a.nonFunctionalRequirements.length,'Non-functional requirements'),metric(a.clarificationQuestions.length,'Open questions'),metric(a.functionalRequirements.filter(x=>x.certainty==='confirmed').length,'FR có bằng chứng'));root.append(stats);
const context=panel('Nguồn và lịch sử thay đổi',`${(p.sources||[]).length||1} nguồn thông tin · phiên bản ${p.version}`);
const sourceRows=(p.sources||[]).map(x=>[x.id,x.type,x.respondent||'—',x.sourceReference||'—',x.at?.slice(0,10)||'—']);
if(sourceRows.length)context.append(dataTable(['ID','Loại nguồn','Người cung cấp','Tham chiếu','Ngày'],sourceRows));
const hist=elt('div',null,'actions');hist.append(button('Xem các phiên bản đã lưu',()=>work(async()=>{const versions=await api(`/api/projects/${p.id}/history`);toast('Phiên bản: '+versions.map(v=>'v'+v.version+(v.archived?'':' (hiện tại)')).join(', '));}),'quiet'));context.append(hist);root.append(context);
const quality=a.quality;
if(quality){
  const verify=panel('BABOK Quality Gate',quality.status==='NEEDS_CLARIFICATION'?'Có gap cần khách hàng làm rõ; BA Review chỉ cho phép xuất bản nháp.':'Không phát hiện High gap bằng kiểm tra tự động; vẫn cần BA và khách hàng xác nhận.');
  const status=elt('div',`Trạng thái: ${quality.status} · High: ${quality.counts.high} · Medium: ${quality.counts.medium}`,'mini-title');verify.append(status);
  const exportButtons=elt('div',null,'actions');
  exportButtons.append(button('↓ Bộ câu hỏi khách hàng',()=>work(()=>download(`/api/projects/${p.id}/export/questions.md`)),'secondary'));
  exportButtons.append(button('↓ Canonical JSON',()=>work(()=>download(`/api/projects/${p.id}/export/canonical.json`)),'quiet'));
  verify.append(exportButtons);
  for(const f of quality.findings.slice(0,12)){
    const item=elt('div',null,'question');
    add(item,elt('span',f.id+' · '+f.priority+(f.requirementId?' · '+f.requirementId:''),'pill '+(f.priority==='High'?'warn':'')),elt('p',f.question),elt('small',f.impact));
    verify.append(item);
  }
  if(quality.findings.length>12)verify.append(elt('p',`Còn ${quality.findings.length-12} gap khác — xem câu hỏi trong tài liệu xuất.`));
  root.append(verify);
}
const cols=elt('div',null,'split'),left=elt('div'),right=elt('div');
const fr=panel('Danh sách yêu cầu','Có mã định danh thống nhất cho BRD · SRS · Prototype.');const rows=a.functionalRequirements.map(x=>{const name=elt('div');add(name,elt('strong',x.name),elt('div',x.description?.slice(0,180),'subtle'));return [elt('code',x.id),name,x.actor,elt('span',x.priority,'pill'),elt('span',x.certainty==='confirmed'?'Có bằng chứng':'Giả định','pill '+(x.certainty==='confirmed'?'good':'warn'))]});fr.append(rows.length?dataTable(['ID','Yêu cầu','Actor','Ưu tiên','Nguồn'],rows):elt('p','Chưa đủ dữ liệu để trích xuất yêu cầu xác nhận.'));left.append(fr);
const scope=panel('Business context','Bối cảnh & mục tiêu từ yêu cầu khách hàng.');scope.append(elt('div','Vấn đề kinh doanh','mini-title'),elt('p',a.businessProblem||'Chưa xác định'),elt('div','Mục tiêu kinh doanh','mini-title'));const ul=elt('ul');for(const g of a.businessGoals)ul.append(elt('li',g));scope.append(a.businessGoals.length?ul:elt('p','Cần làm rõ mục tiêu.'));left.append(scope);
const q=panel('Câu hỏi cần làm rõ',`${a.clarificationQuestions.filter(x=>!['resolved','answered-pending-ba-review'].includes(x.status)).length} câu chưa trả lời. Chọn câu hỏi để mở form; gợi ý không tự được phê duyệt.`);
const drafts=state.answerDrafts[p.id]||(state.answerDrafts[p.id]={});
const batchActions=elt('div',null,'clarification-toolbar');const saveMany=button('Lưu 0 câu trả lời',()=>work(async()=>{
 const items=completeDrafts(state.project,drafts);if(!items.length)throw Error('Chưa có câu trả lời đủ thông tin.');
 const controls=Array.from(root.querySelectorAll('input, textarea, select'));
 const disabled=controls.map(control=>control.disabled);controls.forEach(control=>control.disabled=true);
 try{
  for(const item of items){const d=drafts[item.questionId];
   try{item.attachmentIds=await uploadDraftAttachments(d,async file=>{
    const content=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('Không đọc được file '+file.name));reader.readAsDataURL(file);});
    return api(`/api/projects/${p.id}/files`,'POST',{category:'approval',filename:file.name,encoding:'base64',content});
   });}finally{
    // Details toggles can replace the draft object even while inputs are disabled.
    drafts[item.questionId]={...drafts[item.questionId],fileUploads:d.fileUploads,attachmentIds:d.attachmentIds||[]};
   }
  }
  const updated=await api(`/api/projects/${p.id}/answers/batch`,'POST',{answers:items});for(const item of items)delete drafts[item.questionId];
  await selectProject(updated,'analysis');toast(`Đã lưu ${items.length} câu trả lời. Tiếp tục workflow để phân tích lại một lần và BA Review.`);
 }finally{controls.forEach((control,index)=>control.disabled=disabled[index]);}
}),'primary');
const updateSave=()=>{const ready=completeDrafts(state.project,drafts).length;saveMany.dataset.batchSave='true';saveMany.textContent=`Lưu ${ready} câu trả lời`;saveMany.disabled=state.busy||ready===0;suggestAll.disabled=state.busy||pendingIds().length===0;};
const pendingIds=()=>p.analysis.clarificationQuestions.filter(x=>!['resolved','answered-pending-ba-review'].includes(x.status)).map(x=>x.id);
const suggestAll=button('✦ AI gợi ý tất cả câu chưa trả lời',()=>work(()=>generateAll(pendingIds())),'secondary');
const suggestionStatus=elt('p',null,'batch-progress');suggestionStatus.id='batch-suggestion-progress';suggestionStatus.setAttribute('role','status');
const renderSuggestionProgress=job=>{const current=document.getElementById('batch-suggestion-progress')||suggestionStatus;current.textContent=job?`Gợi ý DRAFT: ${job.done.length}/${job.total} câu · ${job.failed.length} lỗi${job.failed.length?' · Cần thử lại '+job.failed.join(', '):''}${job.active.length?' · Đang xử lý '+job.active.join(', '):' · Đã kết thúc lượt tạo gợi ý'}`:'';};
const generateAll=async ids=>{
 if(!ids.length)return;const currentId=p.id;
 const result=await generateQuestionGroups(ids,{generate:async questionIds=>{const updated=await api(`/api/projects/${currentId}/recommendations/generate`,'POST',{mode:'business',selectionMode:'ba-draft',questionIds});state.project=updated;selectRecommendedDrafts(updated,drafts,questionIds);},onProgress:job=>{state.suggestionJobs[currentId]=job;renderSuggestionProgress(job);}});
 await selectProject(state.project,'analysis');toast(result.failed.length?'Một số câu chưa có gợi ý; bấm Thử lại phần lỗi.':'Đã chọn sẵn đề xuất DRAFT với thẩm quyền BA. Kiểm tra rồi bấm Lưu câu trả lời.',result.failed.length>0);
};
batchActions.append(suggestAll,saveMany);const previousJob=state.suggestionJobs[p.id];
if(previousJob?.failed.length)batchActions.append(button('Thử lại phần lỗi',()=>work(()=>generateAll(previousJob.failed.filter(id=>pendingIds().includes(id)))),'quiet'));
document.addEventListener('ba-idle',()=>{if(saveMany.isConnected)updateSave();},{once:true});
q.append(batchActions,elt('p','AI chọn sẵn đề xuất với thẩm quyền BA. Bạn có thể đổi phương án, đính kèm file hoặc bấm Lưu câu trả lời để ghi nhận.','subtle'),suggestionStatus);renderSuggestionProgress(previousJob);updateSave();
const filter=(label,key,choices)=>{const field=elt('label');field.style.display='inline-flex';field.style.gap='8px';field.style.margin='0 16px 16px 0';field.append(elt('span',label));const select=elt('select');for(const [value,text] of choices){const o=elt('option',text);o.value=value;select.append(o);}select.value=state[key];select.onchange=()=>{state[key]=select.value;renderAnalysis();};field.append(select);q.append(field);};
filter('Ưu tiên','questionPriority',[['all','Tất cả ưu tiên'],['High','High'],['Medium','Medium'],['Low','Low']]);
filter('Trạng thái','questionStatus',[['open','Chưa trả lời'],['resolved','Đã trả lời'],['all','Tất cả']]);
const visible=filterQuestions(a.clarificationQuestions,state.questionPriority,state.questionStatus);
for(const item of visible){
 const proposal=(p.clarificationRecommendations||[]).find(x=>x.questionId===item.id&&x.status==='PROPOSED');
 q.append(renderQuestionForm({item,proposal,requirements:a.functionalRequirements,loadReferences:label=>loadRequirementReferences(p,label),draft:drafts[item.id]||{},onDraftChange:values=>{drafts[item.id]=values;updateSave();},savedAnswer:[...(p.answers||[])].reverse().find(x=>x.questionId===item.id),elt,button,
  onGenerate:()=>work(async()=>{
   toast('Đang tạo gợi ý DRAFT cho '+item.id+'; chờ Codex trả kết quả.');
   const updated=await api(`/api/projects/${p.id}/recommendations/generate`,'POST',{mode:'business',selectionMode:'ba-draft',questionId:item.id});
   selectRecommendedDrafts(updated,drafts,[item.id]);
   await selectProject(updated,'analysis');
   const current=Array.from($('analysis-content').querySelectorAll('details.question')).find(x=>x.querySelector('summary')?.textContent.startsWith(item.id));if(current)current.open=true;
   toast('Đề xuất DRAFT đã sẵn sàng với thẩm quyền BA; kiểm tra trước khi lưu.');
  }),
  onDownloadAttachment:async id=>{try{const doc=await api(`/api/projects/${p.id}/files/${id}`);const content=doc.encoding==='base64'?Uint8Array.from(atob(doc.content),c=>c.charCodeAt(0)):doc.content;const url=URL.createObjectURL(new Blob([content],{type:'application/octet-stream'}));const link=elt('a');link.href=url;link.download=doc.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){toast(e.message,true);}},
  onSave:async payload=>{
   if(state.busy)throw new Error('Đang xử lý yêu cầu khác, vui lòng chờ.');
   state.busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);
   try{const updated=await api(`/api/projects/${p.id}/${payload.route}`,'POST',payload.body);await selectProject(updated,'analysis');toast('Đã lưu; cần phân tích và BA Review trước khi tạo tài liệu.');}
   finally{state.busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
 }));
}
if(!visible.length)q.append(elt('p','Không có câu hỏi phù hợp bộ lọc.'));root.append(q);
const decisions=(p.clarificationDecisions||[]);
if(decisions.length){
 const decisionsPanel=panel('Decision Log','Đáp án đã chấp thuận kèm loại thẩm quyền và nguồn; không tự xem là customer baseline.');
 for(const d of decisions){
  const row=elt('div',null,'question');
  row.append(elt('strong',`${d.questionId} / ${d.optionId} · ${d.approverRole==='customer'?'Customer (theo chứng nhận của BA)':'BA technical decision'} · ${d.status}`));
  row.append(elt('p',d.answer),elt('small',`${d.actor} · ${d.sourceReference} · ${d.approvedAt}`));
  decisionsPanel.append(row);
 }
 right.append(decisionsPanel);
}
const review=panel('BA Review','Rà soát giả định, yêu cầu và xác nhận trước khi tạo tài liệu.');review.classList.add('review-panel');review.append(elt('div','Ghi chú review / phản hồi khách hàng','mini-title'));const notes=elt('textarea');notes.id='review-notes';notes.placeholder='Nhập nhận xét BA, quyết định phạm vi, điểm cần khách hàng ký duyệt...';notes.value=p.review?.notes||'';review.append(notes);
const check=elt('label',null,'check-row');const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.id='approve-check';checkbox.checked=Boolean(p.review?.approved);check.append(checkbox,elt('span','Tôi đã rà soát đầu ra; hiểu rằng các câu hỏi chưa đóng và giả định chưa được khách hàng chấp thuận vẫn ở trạng thái draft.'));review.append(check);
const actions=elt('div',null,'actions');if(!p.review?.approved)actions.append(button('✓ Duyệt bản phân tích',()=>work(async()=>{if(!checkbox.checked)throw new Error('Bạn phải đánh dấu xác nhận BA review.');const next=await api(`/api/projects/${p.id}/review`,'POST',{approved:true,notes:notes.value});await selectProject(next);toast('Đã ghi nhận BA review (chưa phải khách hàng phê duyệt).')}),'secondary'));
if(p.review?.approved)actions.append(button(p.prototype?'↻ Sinh lại prototype':'✦ Tạo BRD · SRS · Prototype',()=>work(async()=>{toast('Đang tạo prototype và tài liệu từ bộ yêu cầu đã review...');const next=await api(`/api/projects/${p.id}/generate`,'POST',{});await selectProject(next,'prototype');toast('Đã tạo BRD, SRS và prototype.')}),'primary'));
review.append(actions);right.append(review);
const clarify=panel('Ghi chú BA chưa xác minh','Chỉ lưu như giả định BA. Phản hồi khách hàng cần sử dụng form “Tự nhập câu trả lời từ khách hàng” trong danh sách câu hỏi.');const extra=elt('textarea');extra.placeholder='VD: BA đề xuất làm rõ độ dài số seri và quy tắc trùng phiếu...';extra.id='clarify-text';extra.rows=3;extra.style.width='100%';extra.style.marginBottom='12px';extra.style.padding='12px';clarify.append(extra);clarify.append(button('Cập nhật brief & phân tích lại',()=>work(async()=>{if(extra.value.trim().length<5)throw new Error('Vui lòng nhập nội dung bổ sung.');toast('Đang phân tích lại với thông tin bổ sung...');const next=await api(`/api/projects/${p.id}/clarify`,'POST',{clarifications:extra.value});await selectProject(next);toast('Đã cập nhật brief và phiên bản phân tích.')}),'quiet'));right.append(clarify);
add(cols,left,right);root.append(cols)}
async function renderDoc(type){const root=$('document-content'),p=state.project;root.replaceChildren();const label=documentLabels[type]||type;const container=panel(type.toUpperCase()+' · '+label,'Tài liệu DRAFT từ bản yêu cầu hiện tại; có thể tải và chỉnh sửa bằng Markdown.');root.append(container);const row=elt('div',null,'actions');if(type!=='prd')row.append(button('↓ Template trống',()=>work(()=>download(`/api/document-templates/${type}.md`,type.toUpperCase()+'.template.md')),'quiet'));container.append(row);if(!p.review?.approved||p.requirementsRefreshPending){container.append(add(elt('div',null,'empty-block'),elt('h3','Cần BA Review hiện hành'),elt('p','Hoàn tất phân tích lại và BA Review để xem, tải tài liệu đã điền. Template trống có thể tải ngay.')));return}row.prepend(button('↓ Tải '+type.toUpperCase()+'.md',()=>work(()=>download(`/api/projects/${p.id}/export/${type}.md`)),'primary'));
if(p.analysis?.functionalRequirements?.length){
  const figmaRow=elt('div',null,'actions');
  figmaRow.append(button('↓ Figma Design Brief',()=>work(()=>download(`/api/projects/${p.id}/export/figma.md`)),'secondary'));
  figmaRow.append(button('↓ Figma Manifest',()=>work(()=>download(`/api/projects/${p.id}/export/figma-manifest.json`)),'quiet'));
  container.append(elt('p','Vẽ Figma từ BRD/SRS bằng UI UX Pro Max + TalkToFigma MCP. Có thể chuẩn bị ngay sau BA Review, không bắt buộc sinh HTML prototype.','subtle'),figmaRow);
}
const pre=elt('pre','Đang tải tài liệu...','preview');container.append(pre);try{const resp=await authenticatedFetch(`/api/projects/${p.id}/export/${type}.md`);pre.textContent=resp.ok?await resp.text():'Chưa đủ điều kiện export.'}catch(e){pre.textContent=e.message}}
async function readFigmaSetup(){const [relay,design]=await Promise.all([api('/api/figma/relay'),api(`/api/projects/${state.project.id}/figma-design`)]);state.figmaRelay=relay;state.figmaDesign=design.figmaDesign;state.figmaJob=design.job;return design}
function pollFigmaDesign(projectId){const key=state.figmaDesign?.runId;if(!key||state.figmaPollKey===key)return;state.figmaPollKey=key;(async()=>{while(state.project?.id===projectId&&state.figmaDesign?.runId===key&&['QUEUED','DESIGNING'].includes(state.figmaDesign?.state)){await new Promise(resolve=>setTimeout(resolve,1400));try{const result=await readFigmaSetup();if(state.project?.id!==projectId)return;const fresh=await api(`/api/projects/${projectId}`);state.project=fresh;if(state.tab==='prototype')renderPrototype();if(['WAITING_FOR_REVIEW','WAITING_SAMPLE_REVIEW','FAILED'].includes(result.figmaDesign?.state)){await render();if(['WAITING_FOR_REVIEW','WAITING_SAMPLE_REVIEW'].includes(result.figmaDesign.state))toast('Đã vẽ xong. Hãy duyệt từng màn hình Figma.');else toast(figmaFailureMessage(result.figmaDesign.errorCode),true);break}}catch(e){toast(e.message,true);break}}state.figmaPollKey=null})()}
async function startFigmaRelay(){await api('/api/figma/relay/start','POST',{});state.figmaRelay=await api('/api/figma/relay');await render()}
async function submitFigmaDesign(form){const platform=state.prototypePlatform;const body=form.revisionNotes?{revisionNotes:form.revisionNotes,channelId:form.channelId,fileIdentityConfirmed:form.fileIdentityConfirmed}:{fileUrl:form.fileUrl,channelId:form.channelId,fileIdentityConfirmed:form.fileIdentityConfirmed};body.platform=platform;if(state.project.designDirection&&document.getElementById('figma-draw-scope')?.value==='sample')body.mode='sample';if(state.project.designDirection)body.visualInputsConfirmed=document.getElementById('figma-visual-consent')?.checked===true;if(form.revisionNotes&&platform===(state.figmaDesign?.platform||state.project.workflow?.platform||'web')&&(state.figmaDesign?.revisionScreenIds||state.figmaDesign?.screenIds))body.screenIds=state.figmaDesign.revisionScreenIds||state.figmaDesign.screenIds;const queued=await api(`/api/projects/${state.project.id}/figma-design`,'POST',body);state.project=await api(`/api/projects/${state.project.id}`);state.figmaDesign=queued.figmaDesign;state.figmaJob={state:'QUEUED',id:queued.jobId};state.figmaForm={fileUrl:form.fileUrl||state.figmaForm.fileUrl||'',channelId:form.channelId||state.figmaForm.channelId||''};await render();pollFigmaDesign(state.project.id);toast('Đã xếp hàng vẽ. BA Studio đang chờ plugin Figma xác nhận và tạo từng màn hình.')}
async function submitFigmaReview(decision,notes,screenIds){if(decision==='REQUEST_CHANGES')state.figmaForm.revisionNotes=notes;const design=state.figmaDesign;if(!design?.draft)return;await api(`/api/projects/${state.project.id}/figma-design/review`,'POST',{decision,notes,...(screenIds?{screenIds}:{}),projectVersion:design.draft.projectVersion,manifestDigest:design.manifestDigest});state.project=await api(`/api/projects/${state.project.id}`);const current=await api(`/api/projects/${state.project.id}/figma-design`);state.figmaDesign=current.figmaDesign;state.figmaJob=current.job;state.prototypePlatform=current.figmaDesign?.platform||state.project.workflow?.platform||'web';await render();toast(decision==='APPROVE'?(design.mode==='sample'?'Đã duyệt mẫu. Bạn có thể vẽ các màn hình còn lại.':'Đã duyệt bản design Figma.'):'Đã ghi nhận yêu cầu chỉnh sửa; mô hình sẽ tạo lại để duyệt lần nữa.')}
function renderScreenRevision(screen){
 const details=elt('details',null,'figma-screen-revision');details.append(elt('summary','Chỉnh sửa màn hình này'));
 const form=elt('form'),label=elt('label',`Nội dung chỉnh sửa ${screen.screenId}`),notes=elt('textarea');
 notes.id=`figma-edit-${screen.screenId}`;notes.required=true;notes.maxLength=3000;notes.placeholder='Ví dụ: điều chỉnh bố cục, khoảng cách hoặc màu sắc';label.htmlFor=notes.id;
 const submit=button('Tiếp tục chỉnh sửa màn hình này',()=>{},'secondary');submit.type='submit';submit.onclick=null;
 form.append(label,notes,elt('p','Chỉ màn hình này được vẽ lại. Các frame khác được giữ nguyên; bản kết hợp cần duyệt lại.','subtle'),submit);
 form.onsubmit=e=>{e.preventDefault();work(()=>submitFigmaReview('REQUEST_CHANGES',notes.value,[screen.screenId]));};details.append(form);return details;
}
function renderFigmaPanel(p){const figmaPanel=panel('Vẽ prototype trên Figma','Codex dùng UI UX Pro Max và TalkToFigma MCP. Bạn vẫn cần mở plugin TalkToFigma thủ công.');figmaPanel.classList.add('figma-design-panel');const stateName=figmaUiState({relay:state.figmaRelay,design:state.figmaDesign,job:state.figmaJob});const labels={RELAY_STOPPED:'Socket chưa chạy',RELAY_STARTING:'Socket đang khởi động…',READY:'Sẵn sàng kết nối Figma',QUEUED:'Đang chờ vẽ trên Figma',FAILED:'Lượt vẽ chưa hoàn tất',WAITING_FOR_REVIEW:'Đang chờ bạn duyệt',WAITING_SAMPLE_REVIEW:'Đang chờ duyệt màn hình mẫu',SAMPLE_APPROVED:'Đã duyệt màn hình mẫu',REVISION_REQUESTED:'Bạn đã yêu cầu chỉnh sửa',APPROVED:'Đã duyệt design Figma'};const status=elt('div',null,'figma-status '+stateName.toLowerCase().replaceAll('_','-'));status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.append(elt('strong',labels[stateName]||'Đang kiểm tra kết nối'));figmaPanel.append(status);const selectiveRetry=stateName==='FAILED'&&state.figmaDesign?.screenIds;const designPlatform=state.figmaDesign?.platform||p.workflow?.platform||'web',newPlatform=state.prototypePlatform!==designPlatform;figmaPanel.classList.toggle('mobile-design',designPlatform==='mobile');figmaPanel.append(elt('p',`Nền tảng bản hiện tại: ${designPlatform==='mobile'?'Mobile app':'Web'}`,'subtle'));
 if(stateName==='RELAY_STOPPED'||stateName==='RELAY_STARTING'||((['FAILED','REVISION_REQUESTED','SAMPLE_APPROVED'].includes(stateName)||['APPROVED','SAMPLE_APPROVED'].includes(stateName)&&newPlatform)&&state.figmaRelay?.state!=='READY')){const start=button('Start socket cursor-talk-to-figma-mcp',()=>work(startFigmaRelay),'primary');start.disabled=state.busy||stateName==='RELAY_STARTING';figmaPanel.append(start)}
 if(stateName==='RELAY_STOPPED'&&state.figmaRelay?.errorCode)figmaPanel.append(elt('p',`Không khởi chạy được socket (${state.figmaRelay.errorCode}). Kiểm tra Bun và cấu hình local rồi thử lại.`,'inline-error'));
 if(stateName==='FAILED')figmaPanel.append(elt('p',figmaFailureMessage(state.figmaDesign?.errorCode),'inline-error'));
 if(stateName==='RELAY_STOPPED'||stateName==='RELAY_STARTING'){const step=elt('p','Sau khi socket sẵn sàng, mở Figma và chạy plugin TalkToFigma thủ công; plugin sẽ kết nối tới relay local.','subtle');figmaPanel.append(step)}
 if(stateName==='READY'||stateName==='SAMPLE_APPROVED'||stateName==='REVISION_REQUESTED'||stateName==='FAILED'||['APPROVED','SAMPLE_APPROVED'].includes(stateName)&&newPlatform){
  if(['APPROVED','SAMPLE_APPROVED'].includes(stateName)&&newPlatform)figmaPanel.append(elt('p','Nền tảng mới sẽ tạo một bản design cần duyệt riêng. Bản trước vẫn được lưu trong lịch sử.','figma-manual-step'));
  if(stateName==='READY')figmaPanel.append(elt('p','Socket local đã chạy. Hãy mở file Figma và bấm Connect trong plugin TalkToFigma thủ công trước khi gửi yêu cầu vẽ.','figma-manual-step'));
  const form=elt('form',null,'figma-setup-form');if(p.designDirection){const label=elt('label','Phạm vi lượt vẽ');label.htmlFor='figma-draw-scope';const scope=elt('select');scope.id='figma-draw-scope';for(const [value,title] of [['auto','Tự động theo mẫu đã duyệt'],['sample','Vẽ lại màn hình mẫu để duyệt hướng mới']]){const option=elt('option',title);option.value=value;scope.append(option)}form.append(label,scope)}const confirmation=elt('label');const confirmInput=document.createElement('input');confirmInput.type='checkbox';confirmInput.required=true;confirmInput.id='figma-file-confirmation';confirmation.append(confirmInput,document.createTextNode(' Tôi xác nhận plugin đang mở đúng file Figma theo link đã nhập.'));if(p.designDirection){const consent=elt('label');const input=elt('input');input.type='checkbox';input.required=true;input.id='figma-visual-consent';consent.append(input,document.createTextNode(' Cho phép Codex sử dụng Design Brief, ảnh tham khảo và tải asset từ các nguồn đã chọn cho lượt vẽ này.'));form.append(consent,elt('p',stateName==='SAMPLE_APPROVED'&&!newPlatform?'Mẫu đã được duyệt. Lượt tiếp theo vẽ các màn hình còn lại theo mẫu.':`Nếu chưa có mẫu đã duyệt cho nền tảng và file này, lượt tiếp theo chỉ vẽ mẫu ${p.designDirection.sampleScreenId}.`,'figma-manual-step'));}
  if(stateName==='REVISION_REQUESTED'||selectiveRetry){const channelLabel=elt('label','Channel ID đang kết nối');channelLabel.htmlFor='figma-revision-channel';const revisionChannel=document.createElement('input');revisionChannel.id='figma-revision-channel';revisionChannel.required=true;revisionChannel.autocomplete='off';revisionChannel.value=state.figmaForm.channelId||'';revisionChannel.addEventListener('input',()=>{state.figmaForm.channelId=revisionChannel.value;confirmInput.checked=false});form.append(elt('p',`File Figma: https://www.figma.com/design/${state.figmaDesign.documentKey}`,'subtle'),channelLabel,revisionChannel);const label=elt('label','Ghi chú chỉnh sửa');label.htmlFor='figma-revision-notes';const revision=document.createElement('textarea');revision.id='figma-revision-notes';revision.required=true;revision.maxLength=3000;revision.placeholder='Mô tả màn hình và điểm cần chỉnh sửa';revision.value=state.figmaForm.revisionNotes??state.figmaDesign.history?.at(-1)?.notes??'';revision.addEventListener('input',()=>state.figmaForm.revisionNotes=revision.value);const selected=newPlatform?undefined:state.figmaDesign.revisionScreenIds||state.figmaDesign.screenIds;form.append(elt('p',newPlatform?`Đổi sang ${state.prototypePlatform==='mobile'?'Mobile app':'Web'}: vẽ mới toàn bộ màn hình cho nền tảng này. Các frame cũ được giữ trong lịch sử.`:selected?`Chỉ vẽ lại: ${selected.join(', ')}. Giữ nguyên các frame còn lại.`:'Phạm vi: vẽ lại toàn bộ màn hình.','figma-revision-scope'));form.onsubmit=e=>{e.preventDefault();work(()=>submitFigmaDesign({revisionNotes:revision.value.trim(),channelId:revisionChannel.value.trim(),fileIdentityConfirmed:confirmInput.checked}))};const submit=button(newPlatform?`Vẽ toàn bộ màn hình cho ${state.prototypePlatform==='mobile'?'Mobile app':'Web'}`:state.figmaDesign.mode==='sample'?'Vẽ lại màn hình mẫu':selected?'Vẽ lại màn hình đã chọn':'Vẽ lại toàn bộ màn hình',()=>{},'primary');submit.type='submit';submit.onclick=null;form.append(label,revision,confirmation,submit)}
  else{
   const fileLabel=elt('label','Link Figma file');fileLabel.htmlFor='figma-file-url';const file=document.createElement('input');file.id='figma-file-url';file.type='url';file.required=true;file.autocomplete='url';file.value=state.figmaForm.fileUrl||(state.figmaDesign?.documentKey?`https://www.figma.com/design/${state.figmaDesign.documentKey}`:'');file.placeholder='https://www.figma.com/design/...';file.addEventListener('input',()=>{state.figmaForm.fileUrl=file.value;confirmInput.checked=false});form.append(fileLabel,file);
   const channelRow=elt('div',null,'figma-label-row');const channelLabel=elt('label','Channel ID');channelLabel.htmlFor='figma-channel-id';const help=elt('details',null,'figma-help');const helpToggle=elt('summary','?');helpToggle.setAttribute('aria-label','Channel ID là gì?');const helpText=elt('span','Channel ID là tên kênh hiển thị trong plugin TalkToFigma sau khi plugin kết nối với relay. Hãy nhập đúng ID plugin đang dùng; BA Studio không tự mở plugin.','figma-help-text');helpText.id='figma-channel-help';help.append(helpToggle,helpText);channelRow.append(channelLabel,help);const channel=document.createElement('input');channel.id='figma-channel-id';channel.required=true;channel.autocomplete='off';channel.value=state.figmaForm.channelId||'';channel.placeholder='Ví dụ: abc123';channel.addEventListener('input',()=>{state.figmaForm.channelId=channel.value;confirmInput.checked=false});channel.setAttribute('aria-describedby','figma-channel-help');form.append(channelRow,channel);
   form.onsubmit=e=>{e.preventDefault();work(()=>submitFigmaDesign({fileUrl:file.value.trim(),channelId:channel.value.trim(),fileIdentityConfirmed:confirmInput.checked}))};const submit=button(p.designDirection?(stateName==='SAMPLE_APPROVED'&&!newPlatform?'Vẽ các màn hình còn lại':'Vẽ màn hình mẫu'):stateName==='FAILED'?'Thử vẽ lại':'Tiếp tục',()=>{},'primary');submit.type='submit';submit.onclick=null;form.append(confirmation,submit);
  }
  figmaPanel.append(form);
 }
 if(stateName==='QUEUED'){const loading=elt('div',null,'figma-loading');loading.setAttribute('aria-busy','true');loading.setAttribute('aria-live','polite');loading.append(elt('span','', 'figma-spinner'),elt('div','Đang chuẩn bị các màn hình trong Figma. Giữ Figma mở và kiểm tra plugin TalkToFigma đã kết nối đúng channel.'));figmaPanel.append(loading)}
 if(state.figmaDesign?.fileIdentity?.source==='OPERATOR_FILE_CONFIRMATION_NOT_INDEPENDENT_ATTESTATION')figmaPanel.append(elt('p','File Figma đã được người vận hành xác nhận thủ công. Bạn vẫn cần kiểm tra trực tiếp các frame trước khi duyệt design.','subtle'));
 if(['WAITING_FOR_REVIEW','WAITING_SAMPLE_REVIEW'].includes(stateName)){
  if(stateName==='WAITING_SAMPLE_REVIEW')figmaPanel.append(elt('p','Kiểm tra màu sắc, font chữ, bố cục, icon và chất lượng thị giác trên Figma. Duyệt mẫu chỉ chốt hướng thiết kế; các màn hình còn lại vẫn cần được vẽ và duyệt.','figma-manual-step'));
  figmaPanel.append(elt('p','Bản dưới đây là draft để review. Chỉ sau khi bạn duyệt, các màn hình mới xuất hiện trong gallery Prototype.','subtle'));
  const notes=elt('textarea');notes.id='figma-review-notes';notes.maxLength=3000;notes.setAttribute('aria-label','Ghi chú duyệt design Figma');notes.placeholder='Nhận xét BA về chất lượng hình ảnh, bố cục hoặc cách thể hiện';
  for(const screen of state.figmaDesign.screens||[]){const card=elt('article',null,'figma-screen-card');const info=elt('div',null,'figma-screen-info');info.append(elt('span',screen.screenId,'pill'),elt('h3',p.prototype.screens.find(x=>x.id===screen.screenId)?.title||screen.screenId),elt('p','Yêu cầu liên quan: '+screen.requirementIds.join(', '),'trace'));const image=document.createElement('img');image.src=screenPreviewUrl(p.id,screen.screenId);image.alt=`Bản xem trước ${screen.screenId}`;image.loading='lazy';image.className='figma-preview';const link=document.createElement('a');link.className='quiet';link.target='_blank';link.rel='noopener noreferrer';link.href=`https://www.figma.com/design/${encodeURIComponent(state.figmaDesign.documentKey)}?node-id=${encodeURIComponent(screen.nodeId)}`;link.textContent='Mở frame trên Figma';info.append(link);if(stateName!=='WAITING_SAMPLE_REVIEW')info.append(renderScreenRevision(screen));if(state.figmaDesign.screenIds?.includes(screen.screenId))info.append(elt('span','Đã chỉnh sửa','pill'));card.append(info,image);figmaPanel.append(card)}
  figmaPanel.append(elt('label','Nhận xét duyệt','figma-review-label'),notes);const actions=elt('div',null,'actions');actions.append(button('Yêu cầu chỉnh sửa',()=>work(()=>submitFigmaReview('REQUEST_CHANGES',notes.value)),'secondary'),button(stateName==='WAITING_SAMPLE_REVIEW'?'Duyệt màn hình mẫu':'Duyệt design',()=>work(()=>submitFigmaReview('APPROVE',notes.value)),'primary'));figmaPanel.append(actions);
 }
 if(stateName==='SAMPLE_APPROVED'){const sample=state.figmaDesign.screens?.[0];if(sample){const image=elt('img');image.src=screenPreviewUrl(p.id,sample.screenId);image.alt='Màn hình mẫu đã duyệt';image.className='figma-preview';figmaPanel.append(image,renderScreenRevision(sample));}}
 const approved=approvedGalleryScreens(state.figmaDesign);if(approved.length){const gallery=elt('section',null,'figma-gallery');gallery.append(elt('h3','Thiết kế Figma đã duyệt'),elt('p','Các màn hình này đã được BA Studio chấp nhận cho gallery prototype. Trạng thái này không phải customer sign-off.','subtle'));for(const screen of approved){const card=elt('article',null,'figma-screen-card approved');const info=elt('div',null,'figma-screen-info');info.append(elt('span',screen.screenId,'pill good'),elt('h4',p.prototype.screens.find(x=>x.id===screen.screenId)?.title||screen.screenId),elt('p','Yêu cầu liên quan: '+screen.requirementIds.join(', '),'trace'));const image=document.createElement('img');image.src=screenPreviewUrl(p.id,screen.screenId);image.alt=`Màn hình Figma đã duyệt ${screen.screenId}`;image.loading='lazy';image.className='figma-preview';const link=document.createElement('a');link.className='quiet';link.target='_blank';link.rel='noopener noreferrer';link.href=`https://www.figma.com/design/${encodeURIComponent(state.figmaDesign.documentKey)}?node-id=${encodeURIComponent(screen.nodeId)}`;link.textContent='Mở frame trên Figma';info.append(renderScreenRevision(screen));card.append(info,image,link);gallery.append(card)}figmaPanel.append(gallery);const editLabel=elt('label','Chỉnh sửa design đã duyệt','figma-review-label');editLabel.htmlFor='figma-approved-edit-notes';const editNotes=elt('textarea');editNotes.id='figma-approved-edit-notes';editNotes.maxLength=3000;editNotes.placeholder='Mô tả màn hình và điểm cần chỉnh sửa';const editActions=elt('div',null,'actions');editActions.append(button('Chỉnh sửa design đã duyệt',()=>work(async()=>{if(!editNotes.value.trim())throw new Error('Vui lòng mô tả nội dung cần chỉnh sửa.');await submitFigmaReview('REQUEST_CHANGES',editNotes.value)}),'secondary'));figmaPanel.append(editLabel,editNotes,elt('p','Yêu cầu chỉnh sửa sẽ tạo bản design mới để duyệt lại. Bản đã duyệt và các frame trước vẫn được lưu trong lịch sử.','subtle'),editActions)}
 figmaPanel.append(elt('p','HTML prototype bên dưới tiếp tục là wireframe click-through riêng. Duyệt design Figma không đồng nghĩa với phê duyệt yêu cầu của khách hàng.','subtle'));return figmaPanel}
function renderPrototype(){const p=state.project,root=$('prototype-content');root.replaceChildren();if(!p.prototype?.screens?.length){root.append(add(elt('div',null,'empty-block'),elt('h3','Prototype chưa được tạo'),elt('p','Cần BA review và chọn “Tạo BRD · SRS · Prototype” ở tab Phân tích.')));return}const head=panel('Prototype của dự án','Click-through wireframe, dữ liệu demo, chưa kết nối backend.');head.querySelector('.section-heading').append(button('↓ Tải prototype.html',()=>work(()=>download(`/api/projects/${p.id}/export/prototype.html?platform=${state.prototypePlatform}`)),'primary'));
const platformRow=elt('div',null,'prototype-platform-row'),platformLabel=elt('label','Nền tảng prototype'),platformSelect=document.createElement('select');platformLabel.htmlFor='prototype-platform';platformSelect.id='prototype-platform';for(const [value,title] of [['web','Web'],['mobile','Mobile app']]){const opt=elt('option',title);opt.value=value;platformSelect.append(opt)}platformSelect.value=state.prototypePlatform;platformSelect.disabled=['QUEUED','DESIGNING'].includes(state.figmaDesign?.state);platformSelect.onchange=()=>{state.prototypePlatform=platformSelect.value;renderPrototype()};platformRow.append(platformLabel,platformSelect,elt('p','Chọn giao diện xem trước và nền tảng cho lượt vẽ Figma tiếp theo.','subtle'));head.append(platformRow,renderDesignDirection({project:p,api,work,busy:state.busy,onDownloadPlugin:()=>work(()=>download('/api/figma/asset-plugin.zip','ba-studio-talk-to-figma-assets.zip')),onSaved:async fresh=>{state.project=fresh;await readFigmaSetup();renderPrototype();toast('Đã lưu định hướng thiết kế. Hãy vẽ và duyệt màn hình mẫu.')}}),renderFigmaPanel(p));const layout=elt('div',null,'prototype-layout');const nav=elt('nav',null,'screen-nav'),content=elt('div'),phone=elt('div',null,state.prototypePlatform==='mobile'?'phone-frame mobile-wireframe':'phone-frame web-wireframe');add(content,elt('div','','trace'),phone);add(layout,nav,content);head.append(layout);root.append(head);
const screens=p.prototype.screens;let active=screens[0].id;function show(id){const screen=screens.find(x=>x.id===id);if(!screen)return;active=id;nav.replaceChildren();for(const scr of screens){const b=elt('button',null,scr.id===active?'active':'');add(b,elt('span',scr.title),elt('small',scr.id));b.onclick=()=>show(scr.id);nav.append(b)}content.querySelector('.trace').textContent=screen.id+' · '+screen.requirementIds.join(', ')+' • '+screen.description;phone.replaceChildren();for(const comp of screen.components){let item,control;switch(comp.type){case 'heading':item=elt('h2',comp.label);break;case 'paragraph':item=elt('p',comp.label);break;case 'card':item=elt('div',comp.label,'ui-card');break;case 'badge':item=elt('span',comp.label,'badge');break;case 'button':item=button(comp.label,()=>{if(comp.actionTarget)show(comp.actionTarget);else toast('Chỉ là wireframe; thao tác nghiệp vụ chưa được triển khai.')} ,'');break;case 'input':case 'textarea':case 'select':{item=elt('div',null,'ui-element');item.append(elt('label',comp.label));if(comp.type==='textarea')control=document.createElement('textarea');else if(comp.type==='select'){control=document.createElement('select');for(const opt of comp.options){const op=elt('option',opt);op.value=opt;control.append(op)}}else{control=document.createElement('input');control.type='text'}control.placeholder=comp.placeholder;control.value=comp.value;item.append(control);break}default:item=elt('p',comp.label)}phone.append(item)}}show(active)}
async function analyze(){const p=state.project;toast('Đang phân tích yêu cầu...');const next=await api(`/api/projects/${p.id}/analyze`,'POST',{});await selectProject(next);toast('Đã tạo bản phân tích và Open Questions.')}
$('new-project-btn').onclick=resetWelcome;
$('sample-btn').onclick=()=>{$('title-input').value='Cổng tiếp nhận và xử lý bảo hành';$('brief-input').value="Khách hàng muốn triển khai cổng bảo hành máy lọc nước. Khách hàng có thể đăng ký bảo hành bằng số seri và số điện thoại. Nhân viên trạm bảo hành xem danh sách yêu cầu, cập nhật trạng thái 'Tiếp nhận', 'Đang xử lý', 'Hoàn thành'. Quản trị viên xem báo cáo số phiếu theo trạng thái. Hệ thống phải phân quyền theo vai trò khách hàng, nhân viên trạm và quản trị viên.";toast('Đã nạp brief mẫu.')};
const requirementDraft=bindRequirementFileInput({preview:file=>api('/api/requirements/preview','POST',file),isBusy:()=>state.busy});
$('new-project-btn').addEventListener('click',()=>requirementDraft.clear());
$('sample-btn').addEventListener('click',()=>requirementDraft.clear());
$('create-form').onsubmit=e=>{e.preventDefault();work(async()=>{const title=$('title-input').value,payload=requirementDraft.payload($('brief-input').value);const p=await api('/api/projects','POST',{title,...payload});requirementDraft.clear();$('create-form').reset();await selectProject(p,'workflow');await progressWorkflow()})};
$('reanalyze-btn').onclick=()=>work(async()=>{if(!confirm('Phân tích lại sẽ xóa BA Review và prototype của phiên bản hiện tại. Tiếp tục?'))return;await analyze()});
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
api('/api/status').then(s=>{$('mode-indicator').textContent=s.demo?'● DEMO MODE — No API key':'● LIVE AI / '+s.provider+' — '+s.model}).catch(e=>toast(e.message,true));
loadProjects({restore:true}).catch(e=>toast(e.message,true));

// Shell interactions only: existing project mutations remain in their original handlers.
document.querySelectorAll('[data-icon]').forEach(el=>{const graphic=icon(el.dataset.icon);if(el.classList.length){el.replaceChildren(graphic);el.removeAttribute('data-icon')}else el.replaceWith(graphic)});
$('page-title').tabIndex=-1;
$('project-search').addEventListener('input',filterProjectList);
$('nav-toggle').onclick=()=>{const open=$('workspace-navigation').classList.toggle('is-open');$('nav-toggle').setAttribute('aria-expanded',String(open));$('nav-toggle').setAttribute('aria-label',open?'Đóng danh sách dự án':'Mở danh sách dự án')};
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&$('workspace-navigation').classList.contains('is-open')){closeNavigation();$('nav-toggle').focus()}});
