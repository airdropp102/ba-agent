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
