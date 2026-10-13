/** ERP domain overlay (v3.8): candidate platforms are NOT an installed stack.
 * Do not claim Fit or product capabilities without version/edition-specific BA evidence.
 */
import {fingerprint} from './revisions.js';

const bad=(message,status=400)=>Object.assign(new Error(message),{status});
export const ERP_CATALOG=Object.freeze([
 {id:'odoo-community',name:'Odoo Community',license:'LGPL-3.0',distribution:'open-source',verifyAt:'https://www.odoo.com/documentation/19.0/legal/licenses.html',note:'Edition/version/module coverage and local accounting must be checked in target deployment.'},
 {id:'erpnext',name:'ERPNext',license:'GPL-3.0',distribution:'open-source',verifyAt:'https://docs.frappe.io/erpnext/open-source',note:'Check version, deployment, customization license obligations and localization.'},
 {id:'odoo-enterprise',name:'Odoo Enterprise',license:'commercial subscription',distribution:'commercial',verifyAt:'https://www.odoo.com/documentation/19.0/legal/licenses.html',note:'Not an open-source edition; confirm subscription, deployment and app availability.'}
]);
export const ERP_PROCESSES=Object.freeze([
 {id:'lead-to-cash',name:'Lead-to-Cash',questions:['Quy trình từ cơ hội đến đơn hàng/hóa đơn/thu tiền hiện tại như thế nào?','Chính sách giá, chiết khấu, hạn mức tín dụng và ngoại lệ ai duyệt?']},
 {id:'procure-to-pay',name:'Procure-to-Pay',questions:['Luồng yêu cầu mua hàng → PO → nhận hàng → hóa đơn → thanh toán và người duyệt?', 'Quy tắc 3-way match và xử lý chênh lệch được phê duyệt ra sao?']},
 {id:'inventory-to-fulfillment',name:'Inventory-to-Fulfillment',questions:['Có bao nhiêu kho, vị trí, đơn vị tính, lot/serial và quy tắc xuất kho?', 'Quy trình kiểm kê, trả hàng, tồn âm và định giá tồn kho thế nào?']},
 {id:'plan-to-produce',name:'Plan-to-Produce',questions:['BOM, routing, work centers, công đoạn, gia công ngoài và backflush dùng thế nào?', 'Cách kiểm soát WIP, hao hụt, truy xuất lô và costing?']},
 {id:'record-to-report',name:'Record-to-Report',questions:['Niên độ, hệ thống tài khoản, đơn vị tiền tệ, thuế, công ty/chi nhánh và đối soát?', 'Báo cáo bắt buộc theo luật địa phương và quy trình khóa sổ nào?']},
 {id:'hire-to-retire',name:'Hire-to-Retire',questions:['Quy trình nhân sự, phê duyệt nghỉ phép, chấm công và phân quyền dữ liệu?', 'Tính lương và các ràng buộc luật lao động cụ thể tại địa phương?']},
 {id:'master-data',name:'Master Data Governance',questions:['Ai sở hữu dữ liệu khách hàng, nhà cung cấp, mã hàng, UoM và chart of accounts?', 'Quy tắc deduplication, mapping, làm sạch và cutover dữ liệu cũ?']},
 {id:'integration-security',name:'Integration & Controls',questions:['Các hệ thống POS/eCommerce/WMS/MES/bank/tax nào cần tích hợp và tần suất đồng bộ?', 'Ma trận quyền, segregation of duties, audit trail và disaster recovery cần kiểm chứng thế nào?']}
]);
const CATALOG=new Map(ERP_CATALOG.map(x=>[x.id,x]));
const PROCESSES=new Map(ERP_PROCESSES.map(x=>[x.id,x]));
const unique=(xs)=>[...new Set(xs)];
export function normalizeSolutionProfile(raw){
 if(!raw||typeof raw!=='object'||Array.isArray(raw))throw bad('solutionProfile object required');
 const allowed=['domain','strategy','candidates','processAreas'];
 if(Object.keys(raw).some(k=>!allowed.includes(k)))throw bad('Unknown solutionProfile field');
 const domain=raw.domain||'general',strategy=raw.strategy||'undecided';
 if(!['general','erp'].includes(domain))throw bad('Invalid ERP domain');
 if(!['undecided','custom','open-source','hybrid','commercial'].includes(strategy))throw bad('Invalid solution strategy');
 for(const key of ['candidates','processAreas'])if(raw[key]!==undefined&&!Array.isArray(raw[key]))throw bad(`Invalid ${key}`);
 const candidates=unique(raw.candidates||[]),processAreas=unique(raw.processAreas||[]);
 if(candidates.length>5||candidates.some(x=>typeof x!=='string'||!CATALOG.has(x)))throw bad('Unknown ERP candidate platform');
 if(processAreas.length>ERP_PROCESSES.length||processAreas.some(x=>typeof x!=='string'||!PROCESSES.has(x)))throw bad('Unknown ERP process area');
 if(domain==='general' && (candidates.length||processAreas.length||!['undecided','custom'].includes(strategy)))throw bad('ERP platform choices require domain=erp');
 if(strategy==='custom'&&candidates.length)throw bad('Custom-build strategy cannot have ERP platform candidates');
 if(strategy==='open-source'&&(!candidates.length||candidates.some(x=>CATALOG.get(x).distribution!=='open-source')))throw bad('Open-source strategy requires open-source candidates only');
 if(strategy==='commercial'&&(!candidates.length||candidates.some(x=>CATALOG.get(x).distribution!=='commercial')))throw bad('Commercial strategy requires commercial candidates only');
 if(strategy==='hybrid'&&!candidates.length)throw bad('Hybrid strategy requires at least one ERP candidate');
 return {domain,strategy,candidates,processAreas};
}
export const solutionProfileDigest=p=>fingerprint(JSON.stringify(p.solutionProfile||null));
export function candidatePlatforms(p){return (p.solutionProfile?.candidates||[]).map(id=>CATALOG.get(id)).filter(Boolean)}
export function solutionReferences(p,existing=[]){return unique([...existing,...candidatePlatforms(p).map(x=>x.name)])}
export function erpElicitationChecklist(p){
 if(p.solutionProfile?.domain!=='erp')return [];
 const selected=p.solutionProfile.processAreas||[];
 const areas=selected.length?selected:ERP_PROCESSES.map(x=>x.id);
 return areas.map(id=>PROCESSES.get(id)).filter(Boolean).map(x=>({processId:x.id,processName:x.name,questions:x.questions.map(question=>({question,status:'OPEN_FOR_STAKEHOLDER',sourceConfirmed:false}))}));
}
export function requirementDigest(requirement){return fingerprint(JSON.stringify({id:requirement.id,name:requirement.name,description:requirement.description,actor:requirement.actor,sourceEvidence:requirement.sourceEvidence,certainty:requirement.certainty}));}
const statuses=['FIT_STANDARD','CONFIGURE','EXTEND','INTEGRATE','GAP_BUILD','NOT_APPLICABLE'];
export function erpFitGapReport(p){
 const profile=p.solutionProfile;
 if(profile?.domain!=='erp')return {enabled:false};
 const candidates=candidatePlatforms(p),requirements=p.analysis?.functionalRequirements||[];
 const rows=[];
 for(const req of requirements)for(const platform of candidates){
  const entry=(p.erpFitGap||[]).filter(x=>x.requirementId===req.id&&x.platformId===platform.id).at(-1);
  const valid=entry?.requirementDigest===requirementDigest(req)&&entry?.profileDigest===solutionProfileDigest(p);
  rows.push({requirementId:req.id,requirementName:req.name,platformId:platform.id,platformName:platform.name,status:valid?entry.classification:'UNASSESSED',reviewedBy:valid?entry.reviewedBy:null,sourceReference:valid?entry.sourceReference:null,rationale:valid?entry.rationale:null,verifiedVersion:valid?entry.verifiedVersion:null,verifiedEdition:valid?entry.verifiedEdition:null,stale:!!entry&&!valid});
 }
 const assessed=rows.filter(x=>x.status!=='UNASSESSED').length;
 return {enabled:true,domain:'erp',strategy:profile.strategy,assessmentStatus:!rows.length?'NOT_READY':assessed===rows.length?'HUMAN_ASSESSED_NOT_CUSTOMER_APPROVED':'REVIEW_REQUIRED',requirements:requirements.length,candidates:candidates.length,reviewed:assessed,total:rows.length,coverage:rows.length?Number((assessed/rows.length).toFixed(3)):0,rows,processChecklist:erpElicitationChecklist(p),warnings:['As-Is/To-Be, controls, master data, migration, localization and cross-module UAT require human/domain evidence.','A human Fit classification is not proof of software capability without edition/version/demo evidence.','BA assessment is not customer requirements sign-off.']};
}
export function recordERPFitGap(p,input,actor){
 if(p.solutionProfile?.domain!=='erp')throw bad('Configure ERP solution profile first',409);
 if(!p.analysis)throw bad('Analyze project first',409);
 const req=p.analysis.functionalRequirements.find(r=>r.id===input.requirementId);
 if(!req)throw bad('Requirement not found for this project',404);
 if(!p.solutionProfile.candidates.includes(input.platformId))throw bad('Platform is not an allowed candidate for this project',409);
 if(!statuses.includes(input.classification))throw bad('Invalid fit-gap classification');
 for(const k of ['sourceReference','rationale','verifiedVersion','verifiedEdition'])if(typeof input[k]!=='string'||input[k].trim().length<(k==='rationale'?10:2)||input[k].length>500)throw bad(`ERP Fit-Gap ${k} evidence required`);
 if(typeof actor!=='string'||actor.length<3)throw bad('Reviewer identity required',401);
 const entry={requirementId:req.id,requirementDigest:requirementDigest(req),profileDigest:solutionProfileDigest(p),platformId:input.platformId,classification:input.classification,sourceReference:input.sourceReference.trim(),rationale:input.rationale.trim(),verifiedVersion:input.verifiedVersion.trim(),verifiedEdition:input.verifiedEdition.trim(),reviewedBy:actor,reviewedAt:new Date().toISOString(),humanAttested:true,customerApproved:false};
 p.erpFitGap=[...(p.erpFitGap||[]),entry].slice(-5000);
 return entry;
}

/** Comparative decision support: no weighted score/TCO fabricated from missing inputs. */
export function erpSolutionComparison(p){
 if(p.solutionProfile?.domain!=='erp')return [];
 const report=erpFitGapReport(p);
 const base={implementationCost:'UNKNOWN_REQUIRES_ESTIMATE',fiveYearTCO:'UNKNOWN_REQUIRES_ESTIMATE',securityAndCompliance:'NEEDS_REVIEW',localization:'NEEDS_REVIEW',dataMigration:'NEEDS_ASSESSMENT',integration:'NEEDS_ASSESSMENT',upgradeRisk:'NEEDS_ASSESSMENT',decisionStatus:'NOT_SELECTED'};
 const custom={id:'custom-build',title:'Custom Build',kind:'custom',license:'Project-dependent',fitGapCoverage:null,...base,validation:['Total cost of ownership and staffing','Cross-module data controls and financial reconciliation','Technology architecture / maintenance support']};
 const candidates=candidatePlatforms(p).map(x=>({id:x.id,title:x.name,kind:x.distribution,license:x.license,source:x.verifyAt,fitGapCoverage:report.rows.filter(y=>y.platformId===x.id).length?Number((report.rows.filter(y=>y.platformId===x.id&&y.status!=='UNASSESSED').length/report.rows.filter(y=>y.platformId===x.id).length).toFixed(3)):0,...base,validation:['Functional Fit–Gap with tested version and edition','Local accounting / payroll / tax compliance','Extensions, migration, integrations, vendor and upgrade policy']}));
 return [custom,...candidates];
}
