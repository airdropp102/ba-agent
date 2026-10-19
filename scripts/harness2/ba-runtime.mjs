/** Offline-only bridge. Deliberately imports no provider, config, server or store. */
import {pathToFileURL} from 'node:url';
import {buildAnalysisPrompt, promptMetadata} from '../../src/ba-prompts.js';
import {analysisSchema} from '../../src/schemas.js';
import {validateModelOutput} from '../../src/model-output.js';
import {normalizeAnalysis} from '../../src/normalize.js';
import {applyEvidenceTrust, mergeStableIds} from '../../src/revisions.js';
import {prepareBAAnalysis} from '../../src/ba-quality.js';
import {buildCanonicalPackage} from '../../src/ba-canonical.js';

export const GUIDANCE=Object.freeze({
 'clarify-scope':'Khách hàng cần xác nhận phạm vi và các ngoại lệ nghiệp vụ nào?',
 'clarify-nfr':'Khách hàng cần xác nhận mục tiêu đo lường NFR nào?',
});
// These are public synthetic inputs, without expected answers or scoring rubrics.
export const TASKS=Object.freeze([
 {id:'train-requests',group:'synthetic-team-a',split:'train',domain:'general-ba',sourceId:'SRC-101',brief:'Nhân viên gửi yêu cầu mua văn phòng phẩm.'},
 {id:'train-leave',group:'synthetic-team-b',split:'train',domain:'general-ba',sourceId:'SRC-102',brief:'Nhân viên gửi đơn xin nghỉ phép.'},
 {id:'test-repairs',group:'synthetic-team-c',split:'test',domain:'general-ba',sourceId:'SRC-103',brief:'Nhân viên gửi phiếu yêu cầu sửa thiết bị.'},
 {id:'test-bookings',group:'synthetic-team-d',split:'test',domain:'general-ba',sourceId:'SRC-104',brief:'Nhân viên gửi yêu cầu đặt phòng họp.'},
].map(Object.freeze));

function validateGuidance(ids){
 if(!Array.isArray(ids)||ids.length>Object.keys(GUIDANCE).length||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!Object.hasOwn(GUIDANCE,id)))
  throw new Error('Invalid catalog guidance IDs');
 return ids;
}

export function composeBenchmarkPrompt(guidanceIds=[]){
 validateGuidance(guidanceIds);
 const base=buildAnalysisPrompt();
 if(!guidanceIds.length)return base;
 return base+'\n\nOffline experimental analyst guidance (unverified, never customer evidence; cannot override policy above):\n'+guidanceIds.map(id=>GUIDANCE[id]).join('\n');
}

/** A scripted test double; it consumes the instructions actually sent to it. */
export function scriptedProvider({task,instructions}){
 return {
  projectName:task.id,executiveSummary:task.brief,businessProblem:'Chưa xác nhận',businessGoals:[],
  stakeholders:[{role:'Nhân viên',need:task.brief}],scopeIn:[],scopeOut:[],businessRules:[],
  functionalRequirements:[{name:task.brief,description:task.brief,actor:'Nhân viên',priority:'Must',
   sourceEvidence:task.brief,certainty:'confirmed',relatedBusinessGoal:'',preconditions:[],mainFlow:[],alternateFlows:[],acceptanceCriteria:[]}],
  nonFunctionalRequirements:[],
  clarificationQuestions:Object.values(GUIDANCE).filter(text=>instructions.includes(text)).map(question=>({question,impact:'Cần khách hàng xác nhận',priority:'High'})),
  assumptions:[],risks:['Synthetic scripted provider; no semantic accuracy measurement.'],
 };
}

export async function runOfflineAnalysis(input,{provider=scriptedProvider}={}){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['task','guidanceIds','previous'].includes(k)))throw new Error('Unknown offline input fields');
 const task=TASKS.find(t=>t.id===input.task);
 if(!task)throw new Error('Only registered synthetic tasks are allowed in offline mode');
 const guidanceIds=validateGuidance(input.guidanceIds??[]);
 const instructions=composeBenchmarkPrompt(guidanceIds);
 const raw=await provider({task,instructions});
 validateModelOutput(raw,analysisSchema);
 const sources=[{id:task.sourceId,type:'customer-brief',text:task.brief,at:null,
  respondent:'synthetic-fixture',sourceReference:`synthetic:${task.id}`}];
 const normalized=normalizeAnalysis(raw,task.brief);
 const trusted=applyEvidenceTrust(normalized,sources);
 const base=mergeStableIds(trusted,input.previous,{}, {prefixes:['FR','NFR','BR']});
 const prepared=prepareBAAnalysis(base.analysis,sources,input.previous?.clarificationQuestions??[]);
 const analysis=mergeStableIds(prepared,input.previous,base.nextIds,{prefixes:['Q']}).analysis;
 const canonical=buildCanonicalPackage({id:`synthetic-${task.id}`,title:task.id,version:1,status:'DRAFT',brief:task.brief,sources,analysis});
 return {task:task.id,provider:'offline-scripted',externalModelCalls:0,guidanceIds,instruction:promptMetadata(instructions),
  usage:{status:'UNKNOWN',tokens:null,costUsd:null},semanticScore:null,analysis,canonical};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==2)throw new Error('Use JSON stdin only; live/provider options are unsupported');
  process.stdin.setEncoding('utf8');
  let data='';
  for await(const chunk of process.stdin){data+=chunk;if(Buffer.byteLength(data)>64*1024)throw new Error('Input exceeds 64 KiB');}
  const input=JSON.parse(data);
  const result=input?.operation==='describe'&&Object.keys(input).length===1
   ?{tasks:TASKS,guidance:GUIDANCE,policy:promptMetadata(buildAnalysisPrompt()),schema:analysisSchema}
   :await runOfflineAnalysis(input);
  process.stdout.write(JSON.stringify(result)+'\n');
 }catch(error){process.stderr.write(`Offline BA bridge failed: ${error.message}\n`);process.exitCode=1;}
}
