(() => {
 if(window.top!==window||location.origin!==globalThis.ThesisSplitConfig.siporaOrigin)return;
 if(globalThis.ThesisSplitAutomationInstalled)return;
 globalThis.ThesisSplitAutomationInstalled=true;
 let controller=null;let runId=null;
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message.kind==='SIPORA_CANCEL'){controller?.abort();runId=null;respond({ok:true});return;}
  if(message.kind==='SIPORA_INSPECT'){
   const kind=globalThis.ThesisSplitSipora.automation.pageKind(document,location.href);
   respond({state:['home','items','type','files','core','subjects','deposit'].includes(kind)?'deposit_page_detected':kind,message:'Halaman SIPORA: '+kind+'.'});return;
  }
  if(!['SIPORA_AUTOSTEP','SIPORA_UPLOAD'].includes(message.kind))return;
  if(typeof message.runId!=='string')return;
  if(runId!==message.runId){controller?.abort();controller=new AbortController();runId=message.runId;}
  const signal=controller.signal;
  (async()=>{
   const engine=globalThis.ThesisSplitSipora.automation;
   if(message.kind==='SIPORA_UPLOAD'){
    if(engine.pageKind(document,location.href)!=='files'||engine.itemId(location.href)!==message.itemId)throw new Error('Draft/tahap upload berubah. Proses dihentikan.');
    const result=await engine.upload(document,message.file,message.base64,signal);
    return {result};
   }
   const step=await engine.step(document,location.href,message.pack,message.context,signal);
   const navigate=step.navigate;delete step.navigate;
   const reply={result:{...step,navigation:!!navigate}};
   if(navigate){
    // Give the worker time to persist the checkpoint before normal form navigation.
    setTimeout(()=>{if(!signal.aborted&&runId===message.runId&&navigate.isConnected)navigate.click();},150);
   }
   return reply;
  })().then(respond).catch(error=>respond({error:String(error.message||'Halaman berubah. Proses dihentikan.').slice(0,300)}));
  return true;
 });
})();
