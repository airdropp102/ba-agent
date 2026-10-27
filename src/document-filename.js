/** Display names stay in metadata; immutable on-disk names use document UUIDs. */
export function documentExtension(filename,allowed){
 if(typeof filename!=='string'||!filename.trim()||filename.length>255||/[\u0000-\u001f\u007f/\\]/u.test(filename))return null;
 const dot=filename.lastIndexOf('.');if(dot<=0)return null;
 const extension=filename.slice(dot+1).toLowerCase();
 return allowed.includes(extension)?extension:null;
}
