import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {validateCorpus,digest} from '../../src/live-acceptance.js';

const check=(condition,message)=>{if(!condition)throw new Error(message);};
export async function prepareCorpora(directory){
 directory=resolve(directory);await mkdir(dirname(directory),{recursive:true,mode:0o700});await mkdir(directory,{mode:0o700});
 const cases=[
  {id:'SMOKE-TRAIN',title:'Phiếu bảo trì nội bộ',domain:'service-requests',groupId:'synthetic-maintenance',split:'train',sourceId:'SRC-101',respondent:'synthetic-author',sourceReference:'generated:maintenance',brief:'Đây là tình huống giả lập. Nhân viên tạo phiếu bảo trì gồm mã thiết bị và mô tả sự cố. Điều phối viên phân công một kỹ thuật viên cho mỗi phiếu. Kỹ thuật viên cập nhật trạng thái Đã nhận, Đang sửa hoặc Hoàn tất. Chỉ người tạo phiếu và người được phân công được xem nội dung phiếu. Nhật ký thay đổi phải được lưu trong 90 ngày. Chưa xác định thời gian phản hồi hay số người dùng đồng thời.',expectedFunctional:[['tạo phiếu bảo trì'],['phân công kỹ thuật viên'],['cập nhật trạng thái']],expectedNfr:[['quyền xem phiếu'],['lưu nhật ký 90 ngày']]},
  {id:'SMOKE-TEST',title:'Tiếp nhận yêu cầu phòng họp',domain:'service-requests',groupId:'synthetic-facilities',split:'test',sourceId:'SRC-102',respondent:'synthetic-author',sourceReference:'generated:facilities',brief:'Đây là tình huống giả lập. Nhân viên gửi yêu cầu đặt phòng họp với thời gian bắt đầu, kết thúc và số người tham gia. Nhân viên hành chính duyệt hoặc từ chối yêu cầu; khi từ chối phải nhập lý do. Không cho phép hai yêu cầu đã duyệt trùng thời gian trong cùng một phòng. Nhân viên chỉ được xem yêu cầu của mình, nhân viên hành chính được xem tất cả. Lịch sử duyệt phải lưu 180 ngày. Chưa thống nhất kênh thông báo hoặc ngưỡng hiệu năng.',expectedFunctional:[['gửi yêu cầu đặt phòng'],['duyệt hoặc từ chối'],['chống trùng thời gian']],expectedNfr:[['phân quyền xem yêu cầu'],['lịch sử duyệt 180 ngày']]},
 ];
 const smoke={schemaVersion:'ba.harness2.synthetic-smoke.v1',provenance:{kind:'synthetic',dataUseApproved:false,note:'Generated fiction for model connectivity/integration, never real-corpus acceptance.'},cases};
 const template={schemaVersion:'ba.gold.reviewed.v1',provenance:{kind:'UNVERIFIED',dataUseApproved:false,approvalReference:''},figmaTarget:{fileKey:'',nodeId:'',nodeName:'',designSpecReference:''},cases:Array.from({length:20},(_,i)=>({id:`CASE-${String(i+1).padStart(2,'0')}`,title:'',domain:'',groupId:'',split:i<10?'train':'test',sourceId:'',respondent:'',sourceReference:'',brief:'',expectedFunctional:[],expectedNfr:[],annotation:{status:'draft',reviewerIds:[],adjudicatedBy:'',adjudicatedAt:'',reference:''}}))};
 const paths={smoke:join(directory,'synthetic-pilot.json'),reviewedTemplate:join(directory,'real-corpus.UNAPPROVED.json')};
 await writeFile(paths.smoke,JSON.stringify(smoke,null,2)+'\n',{mode:0o600,flag:'wx'});
 await writeFile(paths.reviewedTemplate,JSON.stringify(template,null,2)+'\n',{mode:0o600,flag:'wx'});
 await writeFile(join(directory,'README.md'),'# Benchmark corpus\n\nsynthetic-pilot.json contains generated fiction. It cannot pass production preflight.\n\nFill real-corpus.UNAPPROVED.json with 20–50 distinct, permissioned/anonymized real cases. Do not invent approval references, reviewers, source attribution or a Figma target. Keep train/test customer/project groups disjoint. Two BA reviews and adjudication are required. Do not commit customer data or these private files. See docs/LIVE_ACCEPTANCE.md.\n',{mode:0o600,flag:'wx'});
 return paths;
}

export function admitCorpus(corpus,{kind='reviewed'}={}){
 check(['reviewed','synthetic-smoke'].includes(kind),'Invalid corpus kind');
 if(kind==='reviewed')validateCorpus(corpus);
 else{
  check(corpus?.schemaVersion==='ba.harness2.synthetic-smoke.v1'&&corpus.provenance?.kind==='synthetic','Smoke must be explicitly synthetic');
  check(Array.isArray(corpus.cases)&&corpus.cases.length>=2&&corpus.cases.length<=6,'Smoke requires 2..6 fictional cases');
 }
 const ids=new Set(),texts=new Set(),groups={train:new Set(),test:new Set()};
 const tasks=corpus.cases.map(c=>{
  check(/^[A-Za-z0-9_-]{1,80}$/.test(c.id??'')&&!ids.has(c.id),'Duplicate/invalid case ID');ids.add(c.id);
  check(['train','test'].includes(c.split),'Each case must declare train/test');
  check(/^[A-Za-z0-9_-]{1,80}$/.test(c.groupId??''),'Explicit anonymized project group required');groups[c.split].add(c.groupId);
  check(typeof c.domain==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(c.domain),'Domain must be a safe identifier');
  check(typeof c.title==='string'&&c.title.length>1&&c.title.length<=250&&typeof c.brief==='string'&&c.brief.trim().length>=20&&c.brief.length<=100000,'Invalid task title/brief');
  const hash=digest(c.brief.normalize('NFKC').replace(/\s+/g,' ').trim());check(!texts.has(hash),'Duplicate briefs across corpus');texts.add(hash);
  check(/^SRC-\d{3}$/.test(c.sourceId??'')&&typeof c.respondent==='string'&&c.respondent.trim()&&typeof c.sourceReference==='string'&&c.sourceReference.trim(),'Source ID, respondent and source reference are required');
  return {id:c.id,title:c.title,domain:c.domain,groupId:c.groupId,split:c.split,brief:c.brief,sourceId:c.sourceId,respondent:c.respondent,sourceReference:c.sourceReference,...(c.solutionProfile?{solutionProfile:c.solutionProfile}:{})};
 });
 check(groups.train.size&&groups.test.size,'Both train and test groups required');
 check(![...groups.train].some(g=>groups.test.has(g)),'Train/test group overlap');
 const domains=new Set(tasks.filter(t=>t.split==='train').map(t=>t.domain));
 check(tasks.filter(t=>t.split==='test').every(t=>domains.has(t.domain)),'Every test domain needs train experience');
 return {kind,corpusHash:digest(corpus),tasks,productionEligible:kind==='reviewed'};
}

export function planCalls(tasks){
 const train=tasks.filter(t=>t.split==='train').length,test=tasks.filter(t=>t.split==='test').length;
 return {protocol:'train-C-then-test-ABC',k:1,mode:'sequential',trainCases:train,testCases:test,plannedCalls:train*8+test*15,breakdown:{trainC:train*8,testA:test,testB:test*7,testC:test*7},note:'No retries assumed. Reservation cap includes failures; Codex may internally retry HTTP requests.'};
}
