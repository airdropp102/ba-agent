/** Bounded, provider-neutral structured-output guard. This is deliberately scoped
 * to the JSON Schema subset used by src/schemas.js, not a generic validator. */
export function validateModelOutput(value, schema, {maxBytes=2_000_000, maxStringLength=25_000}={}) {
  const bytes=Buffer.byteLength(JSON.stringify(value) || 'null','utf8');
  if(bytes>maxBytes)throw new Error('AI output exceeds size limit');
  const visit=(data,s,p='$',depth=0)=>{
    if(depth>24)throw new Error(`AI schema depth exceeded at ${p}`);
    if(s.enum && !s.enum.includes(data))throw new Error(`AI schema enum mismatch at ${p}`);
    if(s.type==='object'){
      if(!data || typeof data!=='object' || Array.isArray(data))throw new Error(`AI schema expects object at ${p}`);
      const props=s.properties||{};
      for(const key of s.required||[])if(!Object.hasOwn(data,key))throw new Error(`AI schema missing ${p}.${key}`);
      if(s.additionalProperties===false)for(const key of Object.keys(data))if(!Object.hasOwn(props,key))throw new Error(`AI schema unexpected ${p}.${key}`);
      for(const [key,rule] of Object.entries(props))if(Object.hasOwn(data,key))visit(data[key],rule,`${p}.${key}`,depth+1);
    }else if(s.type==='array'){
      if(!Array.isArray(data))throw new Error(`AI schema expects array at ${p}`);
      if(data.length>500)throw new Error(`AI schema excessive array length at ${p}`);
      for(let i=0;i<data.length;i++)visit(data[i],s.items||{},`${p}[${i}]`,depth+1);
    }else if(s.type==='string'){
      if(typeof data!=='string'||data.length>maxStringLength)throw new Error(`AI schema expects bounded string at ${p}`);
    }else if(s.type==='boolean'){
      if(typeof data!=='boolean')throw new Error(`AI schema expects boolean at ${p}`);
    }else if(s.type==='number'||s.type==='integer'){
      if(typeof data!=='number'||!Number.isFinite(data)||(s.type==='integer'&&!Number.isInteger(data)))throw new Error(`AI schema expects number at ${p}`);
    }
  };
  visit(value,schema);
  return value;
}
