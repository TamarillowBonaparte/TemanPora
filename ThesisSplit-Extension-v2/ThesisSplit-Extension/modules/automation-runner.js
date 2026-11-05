import {packageFor,checkPdf} from './file-bridge.js';
import {safeStatus,canAct} from './state.js';
export class AutomationRunner {
 constructor({config,read,write,schedule=fn=>setTimeout(fn,0)}){this.schedule=schedule;this.config=config;this.read=read;this.write=write;this.busy=new Set();this.pending=new Set();this.controllers=new Map();}
 async send(tabId,message){
  const tab=await chrome.tabs.get(tabId);
  if(new URL(tab.url).origin!==this.config.siporaOrigin)throw new Error('Tab target bukan SIPORA.');
  if(this.config.adapterFile&&['SIPORA_AUTOSTEP','SIPORA_UPLOAD'].includes(message.kind))await chrome.scripting.executeScript({target:{tabId},files:[this.config.adapterFile]});
  try{return await chrome.tabs.sendMessage(tabId,message);}
  catch(error){
   if(!/Receiving end does not exist|Could not establish connection/i.test(error.message))throw error;
   const scripts=chrome.runtime.getManifest().content_scripts.find(entry=>entry.matches.includes(this.config.siporaOrigin+'/*')).js;
   await chrome.scripting.executeScript({target:{tabId},files:scripts});
   return chrome.tabs.sendMessage(tabId,message);
  }
 }
 async target(session,chosenTabId){
  let tabs=await chrome.tabs.query({url:this.config.siporaOrigin+'/*'});
  if(chosenTabId)tabs=tabs.filter(tab=>tab.id===chosenTabId);
  else if(session.targetTabId&&tabs.some(tab=>tab.id===session.targetTabId))tabs=tabs.filter(tab=>tab.id===session.targetTabId);
  else {const active=tabs.filter(tab=>tab.active);if(active.length===1)tabs=active;}
  if(tabs.length!==1)throw new Error(tabs.length?'Pilih satu tab SIPORA dari popup lalu jalankan otomatis.':'Buka SIPORA dan login dahulu.');
  return tabs[0];
 }
 async start(session,chosenTabId){
  if(Date.now()>=Date.parse(session.expires_at))throw new Error('Sesi berakhir. Hubungkan ulang dari ThesisSplit.');
  if(session.autoRun)return safeStatus(session);
  const tab=await this.target(session,chosenTabId);
  const currentId=new URL(tab.url).searchParams.get('eprintid');
  if(session.flow?.itemId&&currentId!==session.flow.itemId)throw new Error('Buka kembali draft yang terikat sebelum melanjutkan.');
  const next={...session,targetTabId:tab.id,domain:this.config.siporaOrigin,autoRun:true,runId:crypto.randomUUID(),state:'running',
    flow:{...session.flow,phase:'files',filesVerified:false},completed_files:0,message:'Memeriksa ulang empat berkas sebelum melanjutkan persiapan otomatis.'};
  await this.write('session',next);
  this.schedule(()=>this.advance(tab.id));
  return safeStatus(next);
 }
 async cancel(session){
  this.controllers.get(session.targetTabId)?.abort();
  if(session.targetTabId)try{await this.send(session.targetTabId,{kind:'SIPORA_CANCEL'});}catch{}
 }
 async update(run,patch){
  const current=await this.read('session');
  if(!current?.autoRun||current.runId!==run.runId)return null;
  const next={...current,...patch,flow:{...current.flow,...patch.flow}};await this.write('session',next);return next;
 }
 async advance(tabId){
  if(this.busy.has(tabId)){this.pending.add(tabId);return;}
  let session=await this.read('session');if(!session?.autoRun||session.targetTabId!==tabId)return;
  if(!canAct(session)){await this.write('session',{...session,autoRun:false,state:'disconnected',message:'Sesi berakhir. Hubungkan ulang.'});return;}
  this.busy.add(tabId);const controller=new AbortController();this.controllers.set(tabId,controller);
  try{
   const pack=await packageFor(session,controller.signal);
   for(let step=0;step<12;step++){
    const live=await this.read('session');if(!live?.autoRun||live.runId!==session.runId||controller.signal.aborted)return;
    session=live;
    const response=await this.send(tabId,{kind:'SIPORA_AUTOSTEP',pack,context:session.flow,runId:session.runId});
    if(response?.error)throw new Error(response.error);
    const result=response?.result;if(!result)throw new Error('Extension di halaman belum diperbarui. Reload extension dan refresh tab SIPORA.');
    const next=await this.update(session,{state:result.state,message:result.message,completed_files:result.completed_files??session.completed_files,
       flow:result.checkpoint||{},autoRun:!result.stop});
    if(!next)return;
    session=next;
    if(result.stop)return;
    if(result.needFile){
     const file=pack.files.find(file=>file.key===result.needFile);if(!file)throw new Error('Manifest file tidak cocok.');
     if(session.flow.uploadIntent===file.key)throw new Error('Upload sebelumnya belum terverifikasi. Periksa daftar file SIPORA dahulu; tidak mengulangi file secara otomatis.');
     const bytes=await checkPdf(session,file,controller.signal);
     if(!await this.update(session,{flow:{uploadIntent:file.key}}))return;
     let binary='';const array=new Uint8Array(bytes);for(let i=0;i<array.length;i+=32768)binary+=String.fromCharCode(...array.subarray(i,i+32768));
     const current=await this.read('session');if(!current?.autoRun||current.runId!==session.runId||controller.signal.aborted)return;
     const upload=await this.send(tabId,{kind:'SIPORA_UPLOAD',file,base64:btoa(binary),runId:session.runId,itemId:session.flow.itemId});
     if(upload?.error)throw new Error(upload.error);
     if(upload?.result?.navigation){if(await this.update(session,{message:upload.result.message}))await chrome.tabs.reload(tabId);return;}
     await this.update(session,{flow:{uploadIntent:null},message:upload?.result?.message||'Memeriksa hasil upload.'});
     continue;
    }
    if(result.navigation)return; // tabs.onUpdated resumes from the saved checkpoint.
    throw new Error('Halaman tidak memberikan tahap berikutnya. Proses dihentikan.');
   }
   throw new Error('Terlalu banyak langkah tanpa navigasi. Periksa halaman.');
  }catch(error){
   if(!controller.signal.aborted)await this.update(session,{autoRun:false,state:'user_action_required',message:String(error.message||'Otomasi terhenti. Periksa halaman SIPORA.').slice(0,300)});
  }finally{this.busy.delete(tabId);this.controllers.delete(tabId);if(this.pending.delete(tabId))this.schedule(()=>this.advance(tabId));}
 }
}
