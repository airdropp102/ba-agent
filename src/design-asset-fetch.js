import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP,BlockList} from 'node:net';
import {SaxesParser} from 'saxes';
const blocked=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['192.88.99.0',24],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',3]])blocked.addSubnet(address,prefix,'ipv4');
for(const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])blocked.addSubnet(address,prefix,'ipv6');
const fail=message=>{throw Object.assign(new Error(message),{code:'ASSET_SOURCE_REJECTED',status:400})};
export function publicAddress(address){const family=isIP(address);return family===4?!blocked.check(address,'ipv4'):family===6&&/^[23]/.test(address)&&!blocked.check(address,'ipv6')}
export function assetUrl(value){
 let u;try{u=new URL(value)}catch{fail('Invalid asset URL')}
 if(typeof value!=='string'||value.length>2048||u.protocol!=='https:'||u.username||u.password||u.port||u.hash||isIP(u.hostname.replace(/^\[|\]$/g,''))||u.hostname==='localhost'||!u.hostname.includes('.'))fail('Use a public HTTPS asset URL without credentials or a custom port');return u;
}
export async function downloadAsset(value,{maxBytes=5*1024*1024,timeoutMs=12000,resolve=host=>lookup(host,{all:true}),request=https.request}={}){
 const deadline=Date.now()+timeoutMs;
 for(let redirects=0;redirects<=3;redirects++){
  const url=assetUrl(value),remaining=deadline-Date.now();if(remaining<=0)fail('Asset download timed out');
  const addresses=await Promise.race([resolve(url.hostname),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Asset DNS timed out')),remaining);timer.unref()})]);
  if(!Array.isArray(addresses)||!addresses.length||addresses.some(a=>!publicAddress(a.address)))fail('Asset host must resolve only to public addresses');
  const chosen=addresses[0];
  const result=await new Promise((resolveResult,reject)=>{
   const req=request(url,{method:'GET',headers:{Accept:'image/svg+xml,image/png,image/jpeg,image/webp,application/json','User-Agent':'BA-Studio-Asset-Importer/1'},lookup:(host,options,callback)=>callback(null,...(options?.all?[[chosen]]:[chosen.address,chosen.family]))},res=>{
    if([301,302,303,307,308].includes(res.statusCode)){res.destroy();return resolveResult({redirect:res.headers.location})}
    if(res.statusCode!==200){res.destroy();return reject(new Error('Asset source returned an unsuccessful HTTP status'))}
    const size=Number(res.headers['content-length']);if(size>maxBytes){res.destroy();return reject(new Error('Asset exceeds download byte limit'))}
    const chunks=[];let length=0;res.on('data',chunk=>{length+=chunk.length;if(length>maxBytes){res.destroy();req.destroy(new Error('Asset exceeds download byte limit'))}else chunks.push(chunk)});res.on('error',reject);res.on('end',()=>resolveResult({bytes:Buffer.concat(chunks),contentType:String(res.headers['content-type']||'').split(';')[0].trim().toLowerCase(),url:url.href}));
   });
   const timer=setTimeout(()=>req.destroy(new Error('Asset download timed out')),Math.max(1,deadline-Date.now()));timer.unref();req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end();
  });
  if(!Object.hasOwn(result,'redirect'))return result;
  if(!result.redirect||redirects===3)fail('Too many or invalid asset redirects');value=new URL(result.redirect,url).href;
 }
}
const tags=new Set(['svg','g','path','rect','circle','ellipse','line','polyline','polygon','defs','linearGradient','radialGradient','stop','clipPath','mask','use','title','desc']);
const attrs=new Set(['xmlns','id','viewBox','width','height','x','y','x1','x2','y1','y2','cx','cy','r','rx','ry','d','points','fill','fill-rule','fill-opacity','stroke','stroke-width','stroke-linecap','stroke-linejoin','stroke-miterlimit','stroke-dasharray','stroke-dashoffset','stroke-opacity','opacity','transform','clip-path','clip-rule','mask','maskUnits','maskContentUnits','gradientUnits','gradientTransform','offset','stop-color','stop-opacity','fx','fy','href','color','preserveAspectRatio']);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function sanitizeSvg(input){
 const source=Buffer.isBuffer(input)?input.toString('utf8'):input;if(typeof source!=='string'||Buffer.byteLength(source)>256*1024)fail('SVG exceeds 256 KiB');
 const parser=new SaxesParser({xmlns:true}),out=[];let depth=0,nodes=0,roots=0;
 parser.on('doctype',()=>fail('SVG DOCTYPE is not supported'));parser.on('processinginstruction',()=>fail('SVG processing instructions are not supported'));parser.on('error',()=>fail('Malformed SVG'));
 parser.on('opentag',node=>{
  if(node.prefix||!tags.has(node.local)||node.uri!=='http://www.w3.org/2000/svg'||++depth>32||++nodes>5000)fail('Unsupported SVG structure');if(depth===1){roots++;if(node.local!=='svg')fail('SVG root required')}
  const values=[];for(const a of Object.values(node.attributes)){
   if(a.prefix||!attrs.has(a.name)||a.value.length>100000)fail('Unsupported SVG attribute');
   if(a.name==='xmlns'){if(a.value!=='http://www.w3.org/2000/svg')fail('Invalid SVG namespace')}
   else if(a.name==='href'){if(!/^#[A-Za-z_][\w.-]*$/.test(a.value))fail('External SVG references are unsupported')}
   else if(/url\s*\(/i.test(a.value)){if(!/^url\(#[A-Za-z_][\w.-]*\)$/.test(a.value))fail('External SVG paint is unsupported')}
   else if(/(?:https?:|data:|javascript:|file:|\\)/i.test(a.value))fail('External SVG content is unsupported');
   values.push(`${a.name}="${escape(a.value)}"`);
  }
  out.push(`<${node.local}${values.length?' '+values.join(' '):''}>`);
 });
 parser.on('closetag',node=>{out.push(`</${node.local}>`);depth--});parser.on('text',value=>{if(value.trim())out.push(escape(value))});parser.on('cdata',()=>fail('SVG CDATA is unsupported'));
 try{parser.write(source).close()}catch(e){if(e.code==='ASSET_SOURCE_REJECTED')throw e;fail('Malformed SVG')}
 if(roots!==1||depth!==0)fail('SVG root required');return Buffer.from(out.join(''));
}
export function normalizeAssetBytes({bytes,contentType}){
 if(contentType==='image/svg+xml')return {bytes:sanitizeSvg(bytes),contentType,extension:'svg'};
 const b=bytes,png=b.length>=33&&b.subarray(0,8).toString('hex')==='89504e470d0a1a0a',jpg=b.length>=4&&b[0]===255&&b[1]===216&&b[2]===255&&b.at(-2)===255&&b.at(-1)===217,webp=b.length>=20&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP';
 if(!b.length||b.length>5*1024*1024||!({ 'image/png':png,'image/jpeg':jpg,'image/webp':webp}[contentType]))fail('Expected SVG, PNG, JPEG or WebP asset bytes');return {bytes:b,contentType,extension:png?'png':jpg?'jpg':'webp'};
}
