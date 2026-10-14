import {completeDrafts,generateQuestionGroups} from './clarification-batch-ui.js';
import {candidateAllowed,filterQuestions,renderQuestionForm} from './clarification-ui.js';
import {watchWorkflowJob,workflowStatus,elapsedLabel} from './workflow-progress.js';
import {figmaUiState,approvedGalleryScreens,screenPreviewUrl} from './figma-review-ui.js';
const $ = id => document.getElementById(id);
const state={project:null,tab:'workflow',busy:false,docCache:{},workflowPlatform:'web',workflowJob:null,questionPriority:'all',questionStatus:'open',answerDrafts:{},suggestionJobs:{},figmaDesign:null,figmaJob:null,figmaRelay:null,figmaForm:{},figmaPollKey:null};
const stages=['NEW','ANALYZED','REVIEWED','GENERATED'];
const wfLabels={BRAINSTORM:'Brainstorming',ELICITATION:'Elicitation',GAP_ANALYSIS:'Gap Analysis',CLARIFICATION:'Clarification',BA_REVIEW:'BA Review',DELIVERABLES:'BRD / SRS / Prototype',FIGMA_DESIGN:'Figma Design Pack',FIGMA_PUBLISH:'Figma publish (thủ công)'};
const statusNames={NEW:'Mới tạo',ANALYZED:'Đã phân tích',REVIEWED:'BA đã rà soát',GENERATED:'Đã sinh tài liệu & prototype'};
let toastTimer;
function toast(message,isError=false){const e=$('toast');e.textContent=message;e.className='toast visible'+(isError?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.className='toast',4500)}
function elt(tag,text,cls){const el=document.createElement(tag);if(text!==undefined&&text!==null)el.textContent=String(text);if(cls)el.className=cls;return el}
function add(parent,...children){for(const child of children)if(child)parent.append(child);return parent}
function button(text,fn,css='quiet'){const b=elt('button',text,css);b.onclick=fn;b.disabled=state.busy;return b}
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
async function download(route){
  const res=await authenticatedFetch(route);if(!res.ok)throw new Error('Không thể tải file: HTTP '+res.status);
  const blob=await res.blob();const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=url;anchor.download=route.split('/').at(-1);document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function work(fn){if(state.busy)return;state.busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn()}catch(e){toast(e.message,true)}finally{state.busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);document.dispatchEvent(new Event('ba-idle'));}}
async function loadProjects(){const projects=await api('/api/projects');const list=$('project-list');list.replaceChildren();if(!projects.length)list.append(elt('p','Chưa có dự án','empty'));for(const p of projects){const b=elt('button',null,'project-link'+(state.project?.id===p.id?' selected':''));add(b,elt('strong',p.title),elt('small',`${statusNames[p.status]} · v${p.version}${p.demo?' · DEMO':''}`));b.onclick=()=>work(async()=>{const fresh=await api(`/api/projects/${p.id}`);await selectProject(fresh)});list.append(b)}}
function resetWelcome(){$('welcome-view').hidden=false;$('project-view').hidden=true;$('page-title').textContent='From Brief to Blueprint.';$('page-subtitle').textContent='Biến yêu cầu khách hàng thành đặc tả rõ ràng và prototype có thể kiểm thử.';state.project=null;state.docCache={};loadProjects().catch(e=>toast(e.message,true))}
async function selectProject(project,tab='workflow'){state.project=project;state.docCache={};state.tab=tab;state.workflowPlatform=project.workflow?.platform||'web';state.figmaDesign=null;state.figmaJob=null;try{const [design,relay]=await Promise.all([api(`/api/projects/${project.id}/figma-design`),api('/api/figma/relay')]);state.figmaDesign=design.figmaDesign;state.figmaJob=design.job;state.figmaRelay=relay}catch{}$('welcome-view').hidden=true;$('project-view').hidden=false;$('page-title').textContent=project.title;$('page-subtitle').textContent='Phiên bản '+project.version+' · Cập nhật '+new Date(project.updatedAt).toLocaleString('vi-VN');$('project-id').textContent='PROJECT / '+project.id.split('-')[0].toUpperCase();$('status-label').textContent=statusNames[project.status]+(project.demo?' • DEMO':'');const index=stages.indexOf(project.status);document.querySelectorAll('.step').forEach((e,i)=>e.classList.toggle('done',i<=index));await render();if(['QUEUED','DESIGNING'].includes(state.figmaDesign?.state))pollFigmaDesign(project.id);loadProjects().catch(e=>toast(e.message,true))}
function setTab(tab){state.tab=tab;render().catch(e=>toast(e.message,true))}
async function render(){
  const p=state.project;if(!p)return;
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));
  $('workflow-content').hidden=state.tab!=='workflow';
  $('analysis-content').hidden=state.tab!=='analysis';
  $('document-content').hidden=!['prd','brd','srs'].includes(state.tab);
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
    toast(state.project.workflow?.state==='AWAITING_FIGMA'?'Design pack sẵn sàng; cần Figma operator publish.':'Workflow đã tới checkpoint hoặc human gate.');
  }catch(e){
    try{await selectProject(await api(`/api/projects/${id}`),'workflow')}catch{}
    throw e;
  }
}

async function renderProjectFiles(){
  const p=state.project,root=$('files-content');root.replaceChildren();
  const location=await api(`/api/projects/${p.id}/workspace`);
  const workspace=panel('Thư mục dự án',`Workspace: ${location.relativePath} · Snapshot từ SQLite v${location.version}`);
  workspace.append(elt('p','PRD, BRD, SRS ở 02-requirements; prototype ở 03-prototypes; handoff ở 08-sessions. Các tài liệu chưa được BA duyệt luôn mang trạng thái draft.'));
  const input=elt('input');input.type='file';input.accept='.txt,.md,.json,.csv';
  const select=elt('select');for(const [value,title] of [['customer','Yêu cầu khách hàng'],['reference','Tài liệu tham khảo'],['approval','Biên bản phê duyệt']]){
    const opt=elt('option',title);opt.value=value;select.append(opt);
  }
  const actions=elt('div',null,'actions');actions.append(select,input);
  actions.append(button('↑ Lưu vào dự án',()=>work(async()=>{
    if(!input.files?.length)throw new Error('Chọn một file tài liệu trước.');
    const file=input.files[0];if(file.size>300000)throw new Error('Tệp vượt 300 KB; dùng API/CLI batch riêng cho tệp lớn.');
    await api(`/api/projects/${p.id}/files`,'POST',{category:select.value,filename:file.name,content:await file.text()});
    toast('Tài liệu đã được ghi riêng theo dự án, kèm mã định danh và checksum.');await renderProjectFiles();
  }),'secondary'));
  workspace.append(actions);root.append(workspace);
  const documents=await api(`/api/projects/${p.id}/files`);
  const listing=panel('Tài liệu bổ sung ('+documents.length+')','Tài liệu nhập riêng, giữ nguyên bản gốc và ghi audit.');
  if(!documents.length)listing.append(elt('p','Chưa có tài liệu bổ sung.','empty'));
  for(const doc of documents){
    const row=elt('div',null,'actions');
    row.append(elt('span',`${doc.filename} · ${doc.category} · ${Math.ceil(doc.size_bytes/1024)} KB · SHA ${doc.sha256.slice(0,12)}`));
    row.append(button('↓ Đọc / tải',()=>work(async()=>{
      const result=await api(`/api/projects/${p.id}/files/${doc.id}`);
      const blob=new Blob([result.content],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);
      const a=document.createElement('a');a.href=url;a.download=result.filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }),'quiet'));
    listing.append(row);
  }
  root.append(listing);
}

function renderWorkflow(){
  const p=state.project,w=p.workflow||{stage:'BRAINSTORM',state:'READY',checkpoints:[]},root=$('workflow-content');root.replaceChildren();
  const head=panel('Intelligent BA Workflow','Chạy theo checkpoint, tự dừng để xác nhận thông tin hoặc BA review; không tự publish Figma.');
  const job=state.workflowJob?.projectId===p.id?state.workflowJob:null;
  const status=workflowStatus(p,job);head.classList.add('workflow-dashboard');head.dataset.motion=status.active?'active':'idle';
  const hero=elt('div',null,'workflow-hero');hero.dataset.tone=status.tone;
  const badge=elt('span',status.label,'workflow-status-badge');badge.setAttribute('role','status');
  const stageText=elt('div');stageText.append(elt('small','BƯỚC HIỆN TẠI'),elt('h3',wfLabels[w.stage]||w.stage));
  hero.append(stageText,badge);head.append(hero);
  const metrics=elt('div',null,'workflow-stats');
  add(metrics,metric((w.checkpoints||[]).length,'Checkpoint đã lưu'),metric(elapsedLabel(status.stageSeconds),'Thời gian bước hiện tại'),metric(elapsedLabel(status.jobSeconds),'Tổng thời gian job'));
  head.append(metrics);
  if(status.job){const note=elt('p',`${status.job.state==='SUCCEEDED'?'Lượt xử lý đã kết thúc':status.job.state==='DEAD_LETTER'?'Đã hết lượt thử':status.active?'Đang chờ kết quả · cập nhật mỗi 2 giây':status.label} · Lần thử ${status.job.attempts||0}/${status.job.max_attempts||3}`,'workflow-job-note');head.append(note);}
  if(w.state==='WAITING_CLARIFICATION')head.append(elt('p','Mở Phân tích → Câu hỏi cần làm rõ để chọn gợi ý hoặc nhập câu trả lời.','workflow-callout'));
  if(w.state==='READY')head.append(elt('p','Bấm Chạy / Tiếp tục để xử lý bước tiếp theo.','workflow-callout'));
  const stages=elt('div',null,'workflow-timeline');
  const completed=new Set((w.checkpoints||[]).map(x=>x.stage));
  for(const [i,stage] of Object.keys(wfLabels).entries()){
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
  if(w.stage!=='FIGMA_PUBLISH')head.append(button(w.state==='FAILED'?'↻ Retry qua durable queue':'✦ Chạy / Tiếp tục qua queue',()=>work(progressWorkflow),'primary'));
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
  // Quality & FinOps are read-only, request-scoped metrics; no source text is transmitted to the dashboard.
  const qualityPanel=panel('Quality Intelligence v3.4','Kiểm tra xác định bằng chứng và truy vết; không chứng nhận tính đúng nghiệp vụ.');
  qualityPanel.append(elt('p','Đang tải các chỉ số chất lượng...'));
  root.append(qualityPanel);
  Promise.all([api(`/api/projects/${p.id}/quality`),api(`/api/projects/${p.id}/quality/ai`),api(`/api/projects/${p.id}/quality/history`)]).then(([q,ai,history])=>{
    if(!qualityPanel.isConnected||state.project?.id!==p.id)return;
    qualityPanel.replaceChildren(elt('h3','Quality Intelligence v3.4'));
    const summary=elt('div',null,'metrics');
    add(summary,metric(q.scorePercent===null?'—':q.scorePercent+'%','Quality proxy'),metric(q.decision,'Gate decision'),metric(q.findings.length,'Findings'),metric(ai.calls,'AI calls'));
    qualityPanel.append(summary);
    qualityPanel.append(elt('p',`Evidence: ${q.rates.evidence??'N/A'} · Actor: ${q.rates.actors??'N/A'} · Acceptance: ${q.rates.acceptance??'N/A'} · Trace: ${q.rates.documentTrace??'N/A'}`,'workflow-note'));
    qualityPanel.append(elt('p',`AI: ${ai.inputTokens??'N/A'} input / ${ai.outputTokens??'N/A'} output tokens · Known cost: ${ai.knownCostUsd===null?'UNKNOWN':'$'+ai.knownCostUsd} · Unknown cost calls: ${ai.unknownCostCalls} · p95 ${ai.p95LatencyMs??'—'}ms`,'workflow-note'));
    if(q.findings.length)qualityPanel.append(dataTable(['Code','Severity','Requirement'],q.findings.slice(0,20).map(f=>[f.code,f.severity,f.requirementId||'—'])));
    if(history.length){qualityPanel.append(elt('h3','Quality change history'));qualityPanel.append(dataTable(['Version','Score','Gate'],history.slice(0,8).map(h=>['v'+h.version,h.score===null?'N/A':Math.round(h.score*100)+'%',h.decision])));}
    if(q.enforceable&&!q.passed)qualityPanel.append(elt('p','QUALITY GATE ENABLED: chỉnh sửa nguồn/requirement và chạy lại trước khi sinh deliverables.','workflow-note'));
    qualityPanel.append(elt('small','Điểm số và giá đã biết không bao gồm đánh giá ngữ nghĩa của BA hoặc chi phí model không có usage/pricing.'));
  }).catch(e=>{if(qualityPanel.isConnected)qualityPanel.append(elt('p','Không tải được quality metrics: '+e.message));});
  if(p.brainstorm){
    const bs=panel('Brainstorming — DRAFT','Chỉ là giả thuyết, không phải yêu cầu được xác nhận.');
    bs.append(elt('p',p.brainstorm.summary));
    for(const [k,title] of [['opportunities','Các hướng cần khám phá'],['stakeholderQuestions','Câu hỏi cho stakeholder'],['assumptions','Giả định chưa xác nhận']]){
      bs.append(elt('h3',title));const ul=elt('ul');for(const val of p.brainstorm[k]||[])ul.append(elt('li',val));bs.append(ul);
    }
    root.append(bs);
  }
  if(p.analysis){
    const q=panel('Quality & Gap Analysis','Chỉ số completeness kiểm tra theo quy tắc; không thay cho semantic evaluation hoặc khách hàng ký duyệt.');
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
    const review=panel('Human BA Approval','BA phải xem và phê duyệt kết quả phân tích trước khi sinh tài liệu. Không phải customer approval.');
    review.append(button('Mở biểu mẫu BA Review',()=>setTab('analysis'),'primary'));root.append(review);
  }
  if(w.design){
    const pack=panel('Figma Design Pack','Đã tạo bộ bàn giao và kiểm tra độ phủ yêu cầu; chưa chứng minh đã vẽ vào Figma.');
    pack.append(elt('p',`FR mapping: ${w.design.coverage?.covered}/${w.design.coverage?.requirements} · Figma: ${w.figmaResult?.state||w.design.publication}`));
    pack.append(elt('pre',`node scripts/figma-design.mjs --project ${p.id} --platform ${w.platform||'web'}
# Chỉ thực hiện khi đã kết nối Figma MCP:
node scripts/figma-design.mjs --project ${p.id} --platform ${w.platform||'web'} --publish --channel YOUR_CHANNEL --figma-file YOUR_FILE_KEY`,'preview'));
    if(w.state==='FIGMA_REPORTED')pack.append(elt('pre',`node scripts/figma-verify.mjs --project ${p.id} --figma-file ${w.figmaResult.documentKey}`,'preview'));
    if(w.state==='FIGMA_READBACK_REPORTED'){
      pack.append(elt('p','MCP read-back được operator báo cáo; không phải chứng thực Figma độc lập. BA phải kiểm tra trực quan trên file thật trước khi duyệt.'));
      const notes=elt('textarea');notes.rows=3;notes.placeholder='Ghi rõ tên màn hình, frame và bằng chứng kiểm tra trực quan (ít nhất 20 ký tự)';
      pack.append(notes,button('BA xác nhận visual QA (không phải customer sign-off)',()=>work(async()=>{
        if(!confirm('Bạn đã trực tiếp kiểm tra đúng file và tất cả màn hình Figma?'))return;
        const next=await api(`/api/projects/${p.id}/workflow/figma/qa`,'POST',{approved:true,notes:notes.value});
        await selectProject(next,'workflow');toast('Đã ghi nhận BA visual QA vào audit trail.');
      }),'secondary'));
    }
    if(w.stage==='FIGMA_PUBLISH' && !w.figmaResult){
      const key=elt('input');key.placeholder='Figma file key đã publish';key.maxLength=128;pack.append(key);
      pack.append(button('Kiểm tra verified registry từ Figma operator',()=>work(async()=>{
        const next=await api(`/api/projects/${p.id}/workflow/figma/sync`,'POST',{documentKey:key.value.trim()});
        await selectProject(next,'workflow');toast('Có node report verified trong registry. Vẫn cần kiểm tra trực quan trên Figma.');
      }),'secondary'));
    }
    root.append(pack);
  }
}

function panel(title,subtitle){const p=elt('section',null,'panel');const h=elt('div',null,'section-heading');const div=elt('div');add(div,elt('h2',title),elt('p',subtitle));h.append(div);p.append(h);return p}
function metric(number,caption){return add(elt('div',null,'metric'),elt('b',number),elt('span',caption))}
function dataTable(headers,rows){const t=elt('table',null,'data-table'),head=elt('thead'),body=elt('tbody'),tr=elt('tr');for(const h of headers)tr.append(elt('th',h));head.append(tr);for(const row of rows){const r=elt('tr');for(const cell of row){const d=elt('td');if(cell instanceof Node)d.append(cell);else d.textContent=String(cell??'');r.append(d)}body.append(r)}add(t,head,body);return t}
function renderERPProfile(p,root){
 const profile=p.solutionProfile||{domain:'general',strategy:'undecided',candidates:[],processAreas:[]};
 const panelEl=panel('ERP Solution Strategy — Build / Open Source / Hybrid','Candidate platforms are proposals, NOT technologies already installed. ERP Fit–Gap must be validated against exact version and edition.');
 const chooser=(label,values,current)=>{const line=elt('label');line.append(elt('div',label,'mini-title'));const input=elt('select');for(const [id,name] of values){const option=elt('option',name);option.value=id;input.append(option)}input.value=current;line.append(input);panelEl.append(line);return input};
 const domain=chooser('Project domain',[['general','General software'],['erp','ERP / enterprise processes']],profile.domain);
 const strategy=chooser('Solution approach',[['undecided','Compare / undecided'],['custom','Build custom'],['open-source','Adopt open-source ERP'],['hybrid','ERP + custom modules/integrations'],['commercial','Commercial ERP']],profile.strategy);
 const checklist=(title,items,selected)=>{panelEl.append(elt('div',title,'mini-title'));const checks=[];for(const [id,name] of items){const label=elt('label');label.style.display='inline-flex';label.style.alignItems='center';label.style.margin='0 12px 8px 0';const checkbox=elt('input');checkbox.type='checkbox';checkbox.checked=selected.includes(id);checkbox.value=id;label.append(checkbox,document.createTextNode(' '+name));panelEl.append(label);checks.push(checkbox)}return checks};
 const candidates=checklist('ERP candidates (shortlist)',[['odoo-community','Odoo Community (LGPL-3.0)'],['erpnext','ERPNext (GPL-3.0)'],['odoo-enterprise','Odoo Enterprise (commercial, NOT open-source)']],profile.candidates||[]);
 const candidateNotice=elt('p',null,'workflow-note');panelEl.append(candidateNotice);
 const updateCandidates=()=>{
  let removed=0;for(const input of candidates){const allowed=candidateAllowed(domain.value,strategy.value,input.value);input.disabled=!allowed;if(!allowed&&input.checked){input.checked=false;removed++;}}
  candidateNotice.textContent=removed?'Đã bỏ chọn candidate không phù hợp. Bấm Lưu để áp dụng thay đổi.':strategy.value==='open-source'?'Chỉ chọn ERP open source.':strategy.value==='commercial'?'Chỉ chọn ERP commercial.':'Candidates là phương án đang xem xét, chưa được cài đặt.';
 };
 domain.onchange=updateCandidates;strategy.onchange=updateCandidates;updateCandidates();
 const areas=checklist('Business process areas — select relevant areas', [['lead-to-cash','Lead-to-Cash'],['procure-to-pay','Procure-to-Pay'],['inventory-to-fulfillment','Inventory / Fulfillment'],['plan-to-produce','Manufacturing / MRP'],['record-to-report','Finance / Accounting'],['hire-to-retire','HR / Payroll'],['master-data','Master Data / Migration'],['integration-security','Integrations / Controls']],profile.processAreas||[]);
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
 const updated=await api(`/api/projects/${p.id}/answers/batch`,'POST',{answers:items});for(const item of items)delete drafts[item.questionId];
 await selectProject(updated,'analysis');toast(`Đã lưu ${items.length} câu trả lời. Tiếp tục workflow để phân tích lại một lần và BA Review.`);
}),'primary');
const updateSave=()=>{const ready=completeDrafts(state.project,drafts).length;saveMany.dataset.batchSave='true';saveMany.textContent=`Lưu ${ready} câu trả lời`;saveMany.disabled=state.busy||ready===0;suggestAll.disabled=state.busy||pendingIds().length===0;};
const pendingIds=()=>p.analysis.clarificationQuestions.filter(x=>!['resolved','answered-pending-ba-review'].includes(x.status)).map(x=>x.id);
const suggestAll=button('✦ AI gợi ý tất cả câu chưa trả lời',()=>work(()=>generateAll(pendingIds())),'secondary');
const suggestionStatus=elt('p',null,'batch-progress');suggestionStatus.id='batch-suggestion-progress';suggestionStatus.setAttribute('role','status');
const renderSuggestionProgress=job=>{const current=document.getElementById('batch-suggestion-progress')||suggestionStatus;current.textContent=job?`Gợi ý DRAFT: ${job.done.length}/${job.total} câu · ${job.failed.length} lỗi${job.failed.length?' · Cần thử lại '+job.failed.join(', '):''}${job.active.length?' · Đang xử lý '+job.active.join(', '):' · Đã kết thúc lượt tạo gợi ý'}`:'';};
const generateAll=async ids=>{
 if(!ids.length)return;const currentId=p.id;
 const result=await generateQuestionGroups(ids,{generate:async questionIds=>{const updated=await api(`/api/projects/${currentId}/recommendations/generate`,'POST',{mode:'business',questionIds});state.project=updated;},onProgress:job=>{state.suggestionJobs[currentId]=job;renderSuggestionProgress(job);}});
 await selectProject(state.project,'analysis');toast(result.failed.length?'Một số câu chưa có gợi ý; bấm Thử lại phần lỗi.':'Gợi ý DRAFT đã sẵn sàng; chưa chọn đáp án nào.',result.failed.length>0);
};
batchActions.append(suggestAll,saveMany);const previousJob=state.suggestionJobs[p.id];
if(previousJob?.failed.length)batchActions.append(button('Thử lại phần lỗi',()=>work(()=>generateAll(previousJob.failed.filter(id=>pendingIds().includes(id)))),'quiet'));
document.addEventListener('ba-idle',()=>{if(saveMany.isConnected)updateSave();},{once:true});
q.append(batchActions,elt('p','Điền nguồn và người trả lời/thẩm quyền để bật nút lưu. Các câu chưa đủ thông tin sẽ được giữ lại.','subtle'),suggestionStatus);renderSuggestionProgress(previousJob);updateSave();
const filter=(label,key,choices)=>{const field=elt('label');field.style.display='inline-flex';field.style.gap='8px';field.style.margin='0 16px 16px 0';field.append(elt('span',label));const select=elt('select');for(const [value,text] of choices){const o=elt('option',text);o.value=value;select.append(o);}select.value=state[key];select.onchange=()=>{state[key]=select.value;renderAnalysis();};field.append(select);q.append(field);};
filter('Ưu tiên','questionPriority',[['all','Tất cả ưu tiên'],['High','High'],['Medium','Medium'],['Low','Low']]);
filter('Trạng thái','questionStatus',[['open','Chưa trả lời'],['resolved','Đã trả lời'],['all','Tất cả']]);
const visible=filterQuestions(a.clarificationQuestions,state.questionPriority,state.questionStatus);
for(const item of visible){
 const proposal=(p.clarificationRecommendations||[]).find(x=>x.questionId===item.id&&x.status==='PROPOSED');
 q.append(renderQuestionForm({item,proposal,draft:drafts[item.id]||{},onDraftChange:values=>{drafts[item.id]=values;updateSave();},savedAnswer:[...(p.answers||[])].reverse().find(x=>x.questionId===item.id),elt,button,
  onGenerate:()=>work(async()=>{
   toast('Đang tạo gợi ý DRAFT cho '+item.id+'; chờ Codex trả kết quả.');
   const updated=await api(`/api/projects/${p.id}/recommendations/generate`,'POST',{mode:'business',questionId:item.id});
   await selectProject(updated,'analysis');
   const current=Array.from($('analysis-content').querySelectorAll('details.question')).find(x=>x.querySelector('summary')?.textContent.startsWith(item.id));if(current)current.open=true;
   toast('Gợi ý DRAFT sẵn sàng; chọn hoặc tự nhập.');
  }),
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
async function renderDoc(type){const root=$('document-content'),p=state.project;root.replaceChildren();if(!p.review?.approved){root.append(add(elt('div',null,'empty-block'),elt('h3','Cần BA Review'),elt('p','Duyệt bản phân tích để xem và tải tài liệu.')));return}const label=type==='prd'?'Product Requirements Document':type==='brd'?'Business Requirements Document':'Software Requirements Specification';const container=panel(type.toUpperCase()+' · '+label,'Tài liệu draft có thể tải xuống và chỉnh sửa bằng Markdown.');const row=elt('div',null,'actions');row.append(button('↓ Tải '+type.toUpperCase()+'.md',()=>work(()=>download(`/api/projects/${p.id}/export/${type}.md`)),'primary'));container.append(row);
if(p.analysis?.functionalRequirements?.length){
  const figmaRow=elt('div',null,'actions');
  figmaRow.append(button('↓ Figma Design Brief',()=>work(()=>download(`/api/projects/${p.id}/export/figma.md`)),'secondary'));
  figmaRow.append(button('↓ Figma Manifest',()=>work(()=>download(`/api/projects/${p.id}/export/figma-manifest.json`)),'quiet'));
  container.append(elt('p','Vẽ Figma từ BRD/SRS bằng UI UX Pro Max + TalkToFigma MCP. Có thể chuẩn bị ngay sau BA Review, không bắt buộc sinh HTML prototype.','subtle'),figmaRow);
}
const pre=elt('pre','Đang tải tài liệu...','preview');container.append(pre);root.append(container);try{const resp=await authenticatedFetch(`/api/projects/${p.id}/export/${type}.md`);pre.textContent=resp.ok?await resp.text():'Chưa đủ điều kiện export.'}catch(e){pre.textContent=e.message}}
async function readFigmaSetup(){const [relay,design]=await Promise.all([api('/api/figma/relay'),api(`/api/projects/${state.project.id}/figma-design`)]);state.figmaRelay=relay;state.figmaDesign=design.figmaDesign;state.figmaJob=design.job;return design}
function pollFigmaDesign(projectId){const key=state.figmaDesign?.runId;if(!key||state.figmaPollKey===key)return;state.figmaPollKey=key;(async()=>{while(state.project?.id===projectId&&state.figmaDesign?.runId===key&&['QUEUED','DESIGNING'].includes(state.figmaDesign?.state)){await new Promise(resolve=>setTimeout(resolve,1400));try{const result=await readFigmaSetup();if(state.project?.id!==projectId)return;const fresh=await api(`/api/projects/${projectId}`);state.project=fresh;if(state.tab==='prototype')renderPrototype();if(['WAITING_FOR_REVIEW','FAILED'].includes(result.figmaDesign?.state)){await render();if(result.figmaDesign.state==='WAITING_FOR_REVIEW')toast('Đã vẽ xong. Hãy duyệt từng màn hình Figma.');else toast('Không thể hoàn tất lượt vẽ. Kiểm tra relay/plugin rồi thử lại.',true);break}}catch(e){toast(e.message,true);break}}state.figmaPollKey=null})()}
async function startFigmaRelay(){await api('/api/figma/relay/start','POST',{});state.figmaRelay=await api('/api/figma/relay');await render()}
async function submitFigmaDesign(form){const body=form.revisionNotes?{revisionNotes:form.revisionNotes}:{fileUrl:form.fileUrl,channelId:form.channelId};const queued=await api(`/api/projects/${state.project.id}/figma-design`,'POST',body);state.project=await api(`/api/projects/${state.project.id}`);state.figmaDesign=queued.figmaDesign;state.figmaJob={state:'QUEUED',id:queued.jobId};state.figmaForm={fileUrl:form.fileUrl||state.figmaForm.fileUrl||'',channelId:form.channelId||state.figmaForm.channelId||''};await render();pollFigmaDesign(state.project.id);toast('Đã xếp hàng vẽ. BA Studio đang chờ plugin Figma xác nhận và tạo từng màn hình.')}
async function submitFigmaReview(decision,notes){const design=state.figmaDesign;if(!design?.draft)return;await api(`/api/projects/${state.project.id}/figma-design/review`,'POST',{decision,notes,projectVersion:design.draft.projectVersion,manifestDigest:design.manifestDigest});state.project=await api(`/api/projects/${state.project.id}`);const current=await api(`/api/projects/${state.project.id}/figma-design`);state.figmaDesign=current.figmaDesign;state.figmaJob=current.job;await render();toast(decision==='APPROVE'?'Đã duyệt bản design Figma.':'Đã ghi nhận yêu cầu chỉnh sửa; mô hình sẽ tạo lại để duyệt lần nữa.')}
function renderFigmaPanel(p){const figmaPanel=panel('Vẽ prototype trên Figma','Codex dùng UI UX Pro Max và TalkToFigma MCP. Bạn vẫn cần mở plugin TalkToFigma thủ công.');figmaPanel.classList.add('figma-design-panel');const stateName=figmaUiState({relay:state.figmaRelay,design:state.figmaDesign,job:state.figmaJob});const labels={RELAY_STOPPED:'Socket chưa chạy',RELAY_STARTING:'Socket đang khởi động…',READY:'Sẵn sàng kết nối Figma',QUEUED:'Đang chờ vẽ trên Figma',FAILED:'Lượt vẽ chưa hoàn tất',WAITING_FOR_REVIEW:'Đang chờ bạn duyệt',REVISION_REQUESTED:'Bạn đã yêu cầu chỉnh sửa',APPROVED:'Đã duyệt design Figma'};const status=elt('div',null,'figma-status '+stateName.toLowerCase().replaceAll('_','-'));status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.append(elt('strong',labels[stateName]||'Đang kiểm tra kết nối'));figmaPanel.append(status);
 if(stateName==='RELAY_STOPPED'||stateName==='RELAY_STARTING'||(stateName==='FAILED'&&state.figmaRelay?.state!=='READY')){const start=button('Start socket cursor-talk-to-figma-mcp',()=>work(startFigmaRelay),'primary');start.disabled=state.busy||stateName==='RELAY_STARTING';figmaPanel.append(start)}
 if(stateName==='RELAY_STOPPED'&&state.figmaRelay?.errorCode)figmaPanel.append(elt('p',`Không khởi chạy được socket (${state.figmaRelay.errorCode}). Kiểm tra Bun và cấu hình local rồi thử lại.`,'inline-error'));
 if(stateName==='RELAY_STOPPED'||stateName==='RELAY_STARTING'){const step=elt('p','Sau khi socket sẵn sàng, mở Figma và chạy plugin TalkToFigma thủ công; plugin sẽ kết nối tới relay local.','subtle');figmaPanel.append(step)}
 if(stateName==='READY'||stateName==='REVISION_REQUESTED'||stateName==='FAILED'){
  if(stateName==='READY')figmaPanel.append(elt('p','Socket local đã chạy. Hãy mở file Figma và bấm Connect trong plugin TalkToFigma thủ công trước khi gửi yêu cầu vẽ.','figma-manual-step'));
  const form=elt('form',null,'figma-setup-form');
  if(stateName==='REVISION_REQUESTED'){const label=elt('label','Ghi chú chỉnh sửa');label.htmlFor='figma-revision-notes';const revision=document.createElement('textarea');revision.id='figma-revision-notes';revision.required=true;revision.maxLength=3000;revision.placeholder='Mô tả màn hình và điểm cần chỉnh sửa';form.onsubmit=e=>{e.preventDefault();work(()=>submitFigmaDesign({revisionNotes:revision.value.trim()}))};const submit=button('Vẽ lại bản design',()=>{},'primary');submit.type='submit';submit.onclick=null;form.append(label,revision,submit)}
  else{
   const fileLabel=elt('label','Link Figma file');fileLabel.htmlFor='figma-file-url';const file=document.createElement('input');file.id='figma-file-url';file.type='url';file.required=true;file.autocomplete='url';file.value=state.figmaForm.fileUrl||'';file.placeholder='https://www.figma.com/design/...';file.addEventListener('input',()=>state.figmaForm.fileUrl=file.value);form.append(fileLabel,file);
   const channelRow=elt('div',null,'figma-label-row');const channelLabel=elt('label','Channel ID');channelLabel.htmlFor='figma-channel-id';const help=elt('button','?','figma-help');help.type='button';help.setAttribute('aria-describedby','figma-channel-help');help.setAttribute('aria-label','Channel ID là gì?');channelRow.append(channelLabel,help);const channel=document.createElement('input');channel.id='figma-channel-id';channel.required=true;channel.autocomplete='off';channel.value=state.figmaForm.channelId||'';channel.placeholder='Ví dụ: abc123';channel.addEventListener('input',()=>state.figmaForm.channelId=channel.value);const helpText=elt('small','Channel ID là tên kênh hiển thị trong plugin TalkToFigma sau khi plugin kết nối với relay. Hãy nhập đúng ID plugin đang dùng; BA Studio không tự mở plugin.','figma-help-text');helpText.id='figma-channel-help';channel.setAttribute('aria-describedby','figma-channel-help');form.append(channelRow,channel,helpText);
   form.onsubmit=e=>{e.preventDefault();work(()=>submitFigmaDesign({fileUrl:file.value.trim(),channelId:channel.value.trim()}))};const submit=button(stateName==='FAILED'?'Thử vẽ lại':'Tiếp tục',()=>{},'primary');submit.type='submit';submit.onclick=null;form.append(submit);
  }
  figmaPanel.append(form);
 }
 if(stateName==='QUEUED'){const loading=elt('div',null,'figma-loading');loading.setAttribute('aria-busy','true');loading.setAttribute('aria-live','polite');loading.append(elt('span','', 'figma-spinner'),elt('div','Đang chuẩn bị các màn hình trong Figma. Giữ Figma mở và kiểm tra plugin TalkToFigma đã kết nối đúng channel.'));figmaPanel.append(loading)}
 if(stateName==='WAITING_FOR_REVIEW'){
  figmaPanel.append(elt('p','Bản dưới đây là draft để review. Chỉ sau khi bạn duyệt, các màn hình mới xuất hiện trong gallery Prototype.','subtle'));
  const notes=elt('textarea');notes.id='figma-review-notes';notes.maxLength=3000;notes.setAttribute('aria-label','Ghi chú duyệt design Figma');notes.placeholder='Nhận xét BA về chất lượng hình ảnh, bố cục hoặc cách thể hiện';
  for(const screen of state.figmaDesign.screens||[]){const card=elt('article',null,'figma-screen-card');const info=elt('div',null,'figma-screen-info');info.append(elt('span',screen.screenId,'pill'),elt('h3',p.prototype.screens.find(x=>x.id===screen.screenId)?.title||screen.screenId),elt('p','Yêu cầu liên quan: '+screen.requirementIds.join(', '),'trace'));const image=document.createElement('img');image.src=screenPreviewUrl(p.id,screen.screenId);image.alt=`Bản xem trước ${screen.screenId}`;image.loading='lazy';image.className='figma-preview';const link=document.createElement('a');link.className='quiet';link.target='_blank';link.rel='noopener noreferrer';link.href=`https://www.figma.com/design/${encodeURIComponent(state.figmaDesign.documentKey)}?node-id=${encodeURIComponent(screen.nodeId)}`;link.textContent='Mở frame trên Figma';info.append(link);card.append(info,image);figmaPanel.append(card)}
  figmaPanel.append(elt('label','Nhận xét duyệt','figma-review-label'),notes);const actions=elt('div',null,'actions');actions.append(button('Yêu cầu chỉnh sửa',()=>work(()=>submitFigmaReview('REQUEST_CHANGES',notes.value)),'secondary'),button('Duyệt design',()=>work(()=>submitFigmaReview('APPROVE',notes.value)),'primary'));figmaPanel.append(actions);
 }
 const approved=approvedGalleryScreens(state.figmaDesign);if(approved.length){const gallery=elt('section',null,'figma-gallery');gallery.append(elt('h3','Figma design đã duyệt'),elt('p','Các màn hình này đã được BA Studio chấp nhận cho gallery prototype. Trạng thái này không phải customer sign-off.','subtle'));for(const screen of approved){const card=elt('article',null,'figma-screen-card approved');const info=elt('div',null,'figma-screen-info');info.append(elt('span',screen.screenId,'pill good'),elt('h4',p.prototype.screens.find(x=>x.id===screen.screenId)?.title||screen.screenId),elt('p','Yêu cầu liên quan: '+screen.requirementIds.join(', '),'trace'));const image=document.createElement('img');image.src=screenPreviewUrl(p.id,screen.screenId);image.alt=`Màn hình Figma đã duyệt ${screen.screenId}`;image.loading='lazy';image.className='figma-preview';const link=document.createElement('a');link.className='quiet';link.target='_blank';link.rel='noopener noreferrer';link.href=`https://www.figma.com/design/${encodeURIComponent(state.figmaDesign.documentKey)}?node-id=${encodeURIComponent(screen.nodeId)}`;link.textContent='Mở frame trên Figma';card.append(info,image,link);gallery.append(card)}figmaPanel.append(gallery)}
 figmaPanel.append(elt('p','HTML prototype bên dưới tiếp tục là wireframe click-through riêng. Duyệt design Figma không đồng nghĩa với phê duyệt yêu cầu của khách hàng.','subtle'));return figmaPanel}
function renderPrototype(){const p=state.project,root=$('prototype-content');root.replaceChildren();if(!p.prototype?.screens?.length){root.append(add(elt('div',null,'empty-block'),elt('h3','Prototype chưa được tạo'),elt('p','Cần BA review và chọn “Tạo BRD · SRS · Prototype” ở tab Phân tích.')));return}const head=panel('Interactive prototype','Click-through wireframe, dữ liệu demo, chưa kết nối backend.');head.querySelector('.section-heading').append(button('↓ Tải prototype.html',()=>work(()=>download(`/api/projects/${p.id}/export/prototype.html`)),'primary'));
head.append(renderFigmaPanel(p));const layout=elt('div',null,'prototype-layout');const nav=elt('nav',null,'screen-nav'),content=elt('div'),phone=elt('div',null,'phone-frame');add(content,elt('div','','trace'),phone);add(layout,nav,content);head.append(layout);root.append(head);
const screens=p.prototype.screens;let active=screens[0].id;function show(id){const screen=screens.find(x=>x.id===id);if(!screen)return;active=id;nav.replaceChildren();for(const scr of screens){const b=elt('button',null,scr.id===active?'active':'');add(b,elt('span',scr.title),elt('small',scr.id));b.onclick=()=>show(scr.id);nav.append(b)}content.querySelector('.trace').textContent=screen.id+' · '+screen.requirementIds.join(', ')+' • '+screen.description;phone.replaceChildren();for(const comp of screen.components){let item,control;switch(comp.type){case 'heading':item=elt('h2',comp.label);break;case 'paragraph':item=elt('p',comp.label);break;case 'card':item=elt('div',comp.label,'ui-card');break;case 'badge':item=elt('span',comp.label,'badge');break;case 'button':item=button(comp.label,()=>{if(comp.actionTarget)show(comp.actionTarget);else toast('Chỉ là wireframe; thao tác nghiệp vụ chưa được triển khai.')} ,'');break;case 'input':case 'textarea':case 'select':{item=elt('div',null,'ui-element');item.append(elt('label',comp.label));if(comp.type==='textarea')control=document.createElement('textarea');else if(comp.type==='select'){control=document.createElement('select');for(const opt of comp.options){const op=elt('option',opt);op.value=opt;control.append(op)}}else{control=document.createElement('input');control.type='text'}control.placeholder=comp.placeholder;control.value=comp.value;item.append(control);break}default:item=elt('p',comp.label)}phone.append(item)}}show(active)}
async function analyze(){const p=state.project;toast('Đang phân tích yêu cầu...');const next=await api(`/api/projects/${p.id}/analyze`,'POST',{});await selectProject(next);toast('Đã tạo bản phân tích và Open Questions.')}
$('new-project-btn').onclick=resetWelcome;
$('sample-btn').onclick=()=>{$('title-input').value='Cổng tiếp nhận và xử lý bảo hành';$('brief-input').value="Khách hàng muốn triển khai cổng bảo hành máy lọc nước. Khách hàng có thể đăng ký bảo hành bằng số seri và số điện thoại. Nhân viên trạm bảo hành xem danh sách yêu cầu, cập nhật trạng thái 'Tiếp nhận', 'Đang xử lý', 'Hoàn thành'. Quản trị viên xem báo cáo số phiếu theo trạng thái. Hệ thống phải phân quyền theo vai trò khách hàng, nhân viên trạm và quản trị viên.";toast('Đã nạp brief mẫu.')};
$('brief-file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>300000)return toast('File vượt 300 KB',true);$('brief-input').value=await f.text();if(!$('title-input').value)$('title-input').value=f.name.replace(/\.[^.]+$/,'')};
$('create-form').onsubmit=e=>{e.preventDefault();work(async()=>{const title=$('title-input').value,brief=$('brief-input').value;const p=await api('/api/projects','POST',{title,brief});await selectProject(p,'workflow');await progressWorkflow()})};
$('reanalyze-btn').onclick=()=>work(async()=>{if(!confirm('Phân tích lại sẽ xóa BA Review và prototype của phiên bản hiện tại. Tiếp tục?'))return;await analyze()});
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>setTab(b.dataset.tab));
api('/api/status').then(s=>{$('mode-indicator').textContent=s.demo?'● DEMO MODE — No API key':'● LIVE AI / '+s.provider+' — '+s.model}).catch(e=>toast(e.message,true));
loadProjects().catch(e=>toast(e.message,true));
