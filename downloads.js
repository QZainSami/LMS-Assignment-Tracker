/* Resolve actual downloaded content rather than naming the PHP handler. */
const FileDownload = (() => {
 function headerName(disposition='') {
  const encoded=disposition.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i);
  if(encoded){try{return decodeURIComponent(encoded[1].trim().replace(/^"|"$/g,''));}catch{}}
  const quoted=disposition.match(/filename\s*=\s*"((?:\\.|[^"\\])*)"/i);
  return quoted?quoted[1].replace(/\\(.)/g,'$1'):(disposition.match(/filename\s*=\s*([^;]+)/i)?.[1]||'').trim();
 }
 function ext(name='') {return name.match(/\.(pdf|pptx?|docx?|xlsx?|zip|rar|7z|txt|csv|png|jpe?g|gif|webp|mp4|mp3|ipynb|py|cpp|c|java|odt|odp|ods|rtf)$/i)?.[1].toLowerCase()||'';}
 function identify(bytes,mime='',disposition='',fallback='') {
  const text=new TextDecoder().decode(bytes.slice(0,1024)).trimStart();
  if(/^<(?:!doctype\s+html|html|head|body|form|script|\?php)\b/i.test(text)||/^(?:Warning|Fatal error|Notice):/i.test(text))throw Error('LMS returned a web page or error instead of a file. Open LMS, log in, then try again.');
  if(text.startsWith('%PDF-'))return 'pdf';
  if(bytes[0]===0x50&&bytes[1]===0x4b){
   const directory=new TextDecoder('latin1').decode(bytes.slice(-262144));
   if(directory.includes('word/'))return 'docx';if(directory.includes('ppt/'))return 'pptx';if(directory.includes('xl/'))return 'xlsx';
   return ext(headerName(disposition))||'zip';
  }
  if(bytes[0]===0x89&&text.includes('PNG'))return 'png';
  if(bytes[0]===0xff&&bytes[1]===0xd8)return 'jpg';
  const named=ext(headerName(disposition));if(named)return named;
  const types={'application/pdf':'pdf','application/msword':'doc','application/vnd.ms-powerpoint':'ppt','application/vnd.ms-excel':'xls','application/vnd.openxmlformats-officedocument.wordprocessingml.document':'docx','application/vnd.openxmlformats-officedocument.presentationml.presentation':'pptx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'xlsx','application/zip':'zip','application/x-rar-compressed':'rar','application/vnd.rar':'rar','application/x-7z-compressed':'7z','text/plain':'txt','text/csv':'csv','image/png':'png','image/jpeg':'jpg','image/gif':'gif','image/webp':'webp'};
  const type=mime.split(';')[0].trim().toLowerCase();
  if(type==='text/html'||type==='application/json')throw Error('LMS did not return a downloadable file. Please log in and try again.');
  return types[type]||ext(fallback)||'bin';
 }
 function filename(title,extension){return Core.segment(String(title||'Untitled').replace(new RegExp('\\.'+extension+'$','i'),''))+'.'+extension;}
 // This function runs inside the existing LMS tab, using its login/cookie context.
 async function fetchInLmsTab(url) {
  try {
   const target=new URL(url);
   if(target.protocol!=='https:'||target.hostname!=='lms.bahria.edu.pk')throw Error('Invalid LMS download link.');
   const r=await fetch(target.href,{credentials:'include',signal:AbortSignal.timeout(60000)});
   if(!r.ok)throw Error('Download failed: HTTP '+r.status);
   if(/login|signin/i.test(new URL(r.url||url).pathname))throw Error('LMS session expired. Log in and try again.');
   const bytes=new Uint8Array(await r.arrayBuffer());
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   return {ok:true,url:r.url||url,base64:btoa(binary),mime:r.headers.get('Content-Type')||'',disposition:r.headers.get('Content-Disposition')||''};
  }catch(error){return {ok:false,error:error.message};}
 }
 async function fileResponse(url) {
  try{return await fetch(url,{credentials:'include',signal:AbortSignal.timeout(60000)});}
  catch(error){
   // A network/CORS failure can occur in the extension context while LMS itself works.
   if(!/network|fetch|cors/i.test(error.message||''))throw error;
   const tabs=await chrome.tabs.query({url:'https://lms.bahria.edu.pk/*'});
   const tab=tabs.find(t=>t.active)||tabs[0];
   if(!tab)throw Error('The background download was blocked. Keep a logged-in LMS tab open and retry.');
   let results;
   try{results=await chrome.scripting.executeScript({target:{tabId:tab.id},func:fetchInLmsTab,args:[url]});}
   catch(e){throw Error('Could not request the file through LMS: '+e.message);}
   const result=results?.[0]?.result;
   if(!result?.ok)throw Error(result?.error||'LMS did not return a file.');
   const binary=atob(result.base64),bytes=new Uint8Array(binary.length);
   for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
   return {ok:true,status:200,url:result.url,headers:{get:name=>name.toLowerCase()==='content-type'?result.mime:name.toLowerCase()==='content-disposition'?result.disposition:null},blob:async()=>new Blob([bytes])};
  }
 }
 function tokenExtension(url) {
  try {
   const token=new URL(url).searchParams.get('k');
   if(!token)return '';
   // LMS token: record,date,kind,index,original filename,return page.
   // Read the filename only; never construct URLs from token contents.
   const fields=atob(token.replace(/-/g,'+').replace(/_/g,'/')).split(',');
   return ext(fields[4]||'');
  }catch{return '';}
 }
 async function start(file,title,folder){
  const nativeExtension=tokenExtension(file.url);
  if(nativeExtension){
   const options={url:Core.portalUrl(file.url,'lms.bahria.edu.pk'),filename:folder+'/'+filename(title,nativeExtension),conflictAction:'uniquify'};
   if(file.referrer)options.headers=[{name:'Referer',value:Core.portalUrl(file.referrer,'lms.bahria.edu.pk')}];
   return chrome.downloads.download(options);
  }
  const response=await fileResponse(Core.portalUrl(file.url,'lms.bahria.edu.pk'));
  if(!response.ok)throw Error('Download failed: HTTP '+response.status);
  if(/login|signin/i.test(new URL(response.url||file.url).pathname))throw Error('LMS session expired. Log in and try again.');
  const blob=await response.blob();if(!blob.size)throw Error('LMS returned an empty file.');
  const extension=identify(new Uint8Array(await blob.arrayBuffer()),response.headers.get('Content-Type')||'',response.headers.get('Content-Disposition')||'',file.filename);
  // A neutral MIME type prevents a misconfigured server from changing the chosen suffix.
  const url=URL.createObjectURL(new Blob([blob],{type:'application/octet-stream'}));
  try{
   const id=await chrome.downloads.download({url,filename:folder+'/'+filename(title,extension),conflictAction:'uniquify'});
   // The browser consumes the blob at download start; retain it briefly for completion.
   setTimeout(()=>URL.revokeObjectURL(url),60000);return id;
  }catch(e){URL.revokeObjectURL(url);throw e;}
 }
 return {headerName,identify,filename,start,fetchInLmsTab,tokenExtension};
})();
if(typeof module!=='undefined')module.exports=FileDownload;
