export function figmaUiState({relay,design,job}={}){
 if(design?.state==='WAITING_FOR_REVIEW')return 'WAITING_FOR_REVIEW';
 if(design?.state==='REVISION_REQUESTED')return 'REVISION_REQUESTED';
 if(design?.state==='APPROVED')return 'APPROVED';
 if(design?.state==='FAILED'||job?.state==='DEAD_LETTER')return 'FAILED';
 if(design?.state==='QUEUED'||design?.state==='DESIGNING'||job?.state==='RUNNING'||job?.state==='QUEUED')return 'QUEUED';
 if(relay?.state==='STARTING'||relay?.state==='STOPPING')return 'RELAY_STARTING';
 if(relay?.state!=='READY')return 'RELAY_STOPPED';
 return 'READY';
}
export function approvedGalleryScreens(design){return design?.state==='APPROVED'&&Array.isArray(design.approved?.screens)?design.approved.screens:[]}
export function screenPreviewUrl(projectId,screenId){return `/api/projects/${encodeURIComponent(projectId)}/figma-design/previews/${encodeURIComponent(screenId)}`}
export function figmaFailureMessage(code){
 const messages={
  NO_VERIFIED_SCREENS:'Codex không trả về màn hình đã xác minh. Kiểm tra skill UI UX Pro Max và các tool TalkToFigma. Kiểm tra file Figma trước khi thử vẽ lại vì có thể còn frame tạo dở.',
  FIGMA_REPORT_REJECTED:'Report Figma không khớp danh sách màn hình, file hoặc node cần xác minh. Kiểm tra file Figma trước khi thử vẽ lại; chưa có bản thiết kế được duyệt.',
  MCP_APPROVAL_REQUIRED:'Codex chưa được cấp quyền gọi TalkToFigma MCP trong phiên chạy nền. Cần phê duyệt quyền tool trước khi thử lại. Lượt này đã dừng trước khi vẽ.',
  PLUGIN_NOT_CONNECTED:'Chưa kết nối được plugin TalkToFigma. Mở plugin trong file Figma, kết nối socket và kiểm tra Channel ID. Lượt này đã dừng trước khi vẽ.',
  FILE_KEY_UNAVAILABLE:'Plugin không trả về mã file Figma. Xác nhận plugin đang mở đúng file theo link đã nhập trước khi thử lại. Lượt này đã dừng trước khi vẽ.',
  DOCUMENT_MISMATCH:'File Figma mà plugin đang mở không khớp với link đã nhập. Mở đúng file và kết nối lại. Lượt này đã dừng trước khi vẽ.',
  MCP_UNAVAILABLE:'Codex chưa tìm thấy tool TalkToFigma MCP. Kiểm tra cấu hình MCP của Codex trước khi thử lại. Lượt này đã dừng trước khi vẽ.',
  PREFLIGHT_FAILED:'Không xác minh được kết nối và file Figma. Kiểm tra cấu hình Codex, plugin và Channel ID. Lượt này đã dừng trước khi vẽ.'
 };
 return messages[code]||'Figma có thể đã nhận một phần frame trước khi lỗi xảy ra. Hãy kiểm tra file Figma trước khi gửi lượt vẽ mới.';
}
export function projectToRestore(projects,lastProjectId){
 return projects.find(project=>project.id===lastProjectId)||[...projects].sort((a,b)=>Date.parse(b.updatedAt||0)-Date.parse(a.updatedAt||0))[0]||null;
}
