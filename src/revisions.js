import {createHash} from 'node:crypto';

const norm = x => String(x || '').normalize('NFKC').toLocaleLowerCase('vi').replace(/\s+/g,' ').trim();
const seq = (prefix,n) => `${prefix}-${String(n).padStart(3,'0')}`;
const groups = [['FR','functionalRequirements','name'],['NFR','nonFunctionalRequirements','description'],['BR','businessRules','rule'],['Q','clarificationQuestions','question']];

/** Stable IDs require conservative exact semantic keys; never guess when duplicate/ambiguous. */
export function mergeStableIds(analysis, previous = null, counters = {}, {prefixes = ['FR','NFR','BR','Q']} = {}) {
  const result = {...analysis};
  const nextIds = {...counters};
  const changes=[];
  for (const [prefix,field,labelKey] of groups) {
    if (!prefixes.includes(prefix)) continue;
    const earlier=previous?.[field] || [];
    const current=analysis[field] || [];
    const maxPreviouslyUsed=Math.max(0,...earlier.map(x=>Number(String(x.id).match(new RegExp(`^${prefix}-(\\d+)$`))?.[1]||0)));
    let max=Math.max(maxPreviouslyUsed,Number(counters[prefix]||0));
    const used=new Set();
    const beforeById=new Map(earlier.map(item=>[item.id,item]));
    const updated=current.map(item=>{
      const key=norm(item[labelKey]);
      let match=null;
      // An explicit stable ID is supported if the row is semantically the same.
      if (item.id && beforeById.has(item.id) && key && key===norm(beforeById.get(item.id)[labelKey]) && !used.has(item.id)) {
        match=beforeById.get(item.id);
      }
      if (!match && key) {
        const candidates=earlier.filter(x=>norm(x[labelKey])===key && !used.has(x.id));
        if (candidates.length===1) match=candidates[0];
      }
      // A source quote is an additional strong link for a renamed FR only if unique.
      if (!match && item.sourceEvidence && ['FR','BR'].includes(prefix)) {
        const candidates=earlier.filter(x=>norm(x.sourceEvidence)===norm(item.sourceEvidence) && !used.has(x.id) && norm(x.sourceEvidence));
        if(candidates.length===1)match=candidates[0];
      }
      const id=match?.id || seq(prefix,++max);
      used.add(id);
      if (!match) changes.push({type:'added',entity:prefix,id,label:String(item[labelKey]||'')});
      else if (JSON.stringify({...match,id:undefined})!==JSON.stringify({...item,id:undefined})) changes.push({type:'modified',entity:prefix,id,label:String(item[labelKey]||'')});
      return {...item,id};
    });
    for (const old of earlier)if(!used.has(old.id))changes.push({type:'retired',entity:prefix,id:old.id,label:String(old[labelKey]||'')});
    result[field]=updated;
    nextIds[prefix]=max;
  }
  return {analysis:result,nextIds,changes};
}
export const fingerprint = s=>createHash('sha256').update(String(s||'')).digest('hex');
export function buildSources(brief) {
  return [{id:'SRC-001',type:'customer-brief',text:String(brief||''),at:new Date().toISOString()}];
}
export function resolveEvidenceSource(quote,sources=[]) {
  const normalized=norm(quote);
  if (!normalized) return null;
  for (const source of sources) {
    if(!['customer-brief','customer-response'].includes(source.type))continue;
    if(norm(source.text).includes(normalized))return source.id;
  }
  return null;
}
/** A quote in an analyst note is never sufficient to promote a requirement to confirmed. */
export function applyEvidenceTrust(analysis,sources) {
  const fields=['functionalRequirements','nonFunctionalRequirements','businessRules'];
  const output={...analysis};
  for(const field of fields)output[field]=(analysis[field]||[]).map(item=>({
    ...item,
    certainty:item.certainty==='confirmed' && resolveEvidenceSource(item.sourceEvidence,sources)?'confirmed':'assumption',
  }));
  return output;
}
