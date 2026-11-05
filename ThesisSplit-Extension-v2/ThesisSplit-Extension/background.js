import './config.js';
import {AutomationRunner} from './modules/automation-runner.js';
import {isAllowedOrigin,safeStatus,canAct} from './modules/state.js';
import {packageFor,checkPdf} from './modules/file-bridge.js';
const config=globalThis.ThesisSplitConfig;
// Session storage is trusted-context-only by default. No SIPORA credentials/cookies are read.
const read=async key=>(await chrome.storage.session.get(key))[key];
const write=async (key,value)=>chrome.storage.session.set({[key]:value});
let queue=Promise.resolve();
let activeController=null;
let automationRunner;
function automation(){return automationRunner ||= new AutomationRunner({config,read,write});}
async function inspect(session, chosenTabId) {
 if(!canAct(session)) throw new Error('Sesi tidak aktif. Hubungkan ulang untuk melanjutkan.');
 let tabs=await chrome.tabs.query({url:config.siporaOrigin+'/*'});
 if(chosenTabId) tabs=tabs.filter(tab=>tab.id===chosenTabId);
 else if(session.targetTabId) tabs=tabs.filter(tab=>tab.id===session.targetTabId);
 if(tabs.length!==1) return {...session,state:tabs.length?'wrong_tab':'user_action_required',message:tabs.length?'Beberapa tab SIPORA terbuka. Pilih target dari popup extension.':'Buka SIPORA dan login sendiri terlebih dahulu.'};
 const tab=tabs[0];
 if(new URL(tab.url).origin!==config.siporaOrigin) throw new Error('Domain target ditolak.');
 try {
  const report=await chrome.tabs.sendMessage(tab.id,{kind:'SIPORA_INSPECT'});
  return {...session,...report,targetTabId:tab.id,domain:config.siporaOrigin};
 } catch {return {...session,state:'unsupported_page',targetTabId:tab.id,domain:config.siporaOrigin,message:'Halaman belum dikenali. Refresh tab SIPORA dan periksa secara manual.'};}
}
async function approvePending(){
  const pending=await read('pending');if(!pending||pending.expires<Date.now())throw new Error('Pairing kedaluwarsa. Hubungkan ulang dari website.');
  const response=await fetch(pending.apiOrigin+'/api/v1/extension/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({job_id:pending.jobId,code:pending.code}),credentials:'omit',redirect:'error'});
  if(!response.ok){await chrome.storage.session.remove('pending');throw new Error('Pairing ditolak. Hubungkan ulang dari website.');}
  const grant=await response.json();
  const next={jobId:pending.jobId,websiteOrigin:pending.websiteOrigin,websiteTabId:pending.websiteTabId,apiOrigin:pending.apiOrigin,grant_token:grant.grant_token,expires_at:grant.expires_at,state:'extension_ready',completed_files:0,message:'Koneksi disetujui. Periksa tab SIPORA untuk melanjutkan.'};
  await write('session',next);await chrome.storage.session.remove('pending');return safeStatus(next);
}
async function handle(message,sender){
 const website=message.kind==='WEBSITE' && sender.frameId===0 && isAllowedOrigin(sender.url,config.websiteOrigins);
 const popup=message.kind==='POPUP' && sender.id===chrome.runtime.id && sender.url===chrome.runtime.getURL('popup.html');
 if(!website&&!popup) throw new Error('Origin pesan tidak diizinkan.');
 const payload=message.payload||{}; const session=await read('session');
 if(message.action==='HELLO')return {state:'extension_ready',version:chrome.runtime.getManifest?.()?.version||'2.1.0',automation:true,message:'ThesisSplit Extension aktif.'};
 if(message.action==='PAIR'&&website){
  if(!/^job_[a-f0-9]{32}$/.test(payload.jobId)||typeof payload.code!=='string'||payload.code.length<32||payload.code.length>128||!config.apiOrigins.includes(payload.apiOrigin))throw new Error('Permintaan pairing tidak valid.');
  const prior=await read('pending');if(prior&&prior.expires>Date.now())throw new Error('Selesaikan atau tolak pairing di popup terlebih dahulu.');
  await write('pending',{jobId:payload.jobId,code:payload.code,apiOrigin:payload.apiOrigin,websiteOrigin:new URL(sender.url).origin,websiteTabId:sender.tab.id,expires:Date.now()+120000});
  if(payload.approved===true)return approvePending();
  return {state:'pairing_pending',jobId:payload.jobId,message:'Buka popup extension dan setujui koneksi.'};
 }
 if(popup&&message.action==='POPUP_STATE'){
  const pending=await read('pending');
  if(pending&&pending.expires<Date.now())await chrome.storage.session.remove('pending');
  return {status:safeStatus(session),pending:pending&&pending.expires>Date.now()?{jobId:pending.jobId,websiteOrigin:pending.websiteOrigin}:null,
          tabs:(await chrome.tabs.query({url:config.siporaOrigin+'/*'})).map(tab=>({id:tab.id,title:tab.title||'SIPORA',url:tab.url}))};
 }
 if(popup&&message.action==='REJECT') {await chrome.storage.session.remove('pending');return {state:'extension_ready'};}
 if(popup&&message.action==='APPROVE')return approvePending();
 if(website&&message.action==='STATUS'){
  const pending=await read('pending');
  if(pending?.expires>Date.now()&&pending.jobId===payload.jobId&&pending.websiteTabId===sender.tab.id)return {state:'pairing_pending',jobId:payload.jobId,message:'Menunggu persetujuan di popup extension.'};
  if(!session||session.jobId!==payload.jobId||session.websiteOrigin!==new URL(sender.url).origin||session.websiteTabId!==sender.tab.id)return {state:'extension_ready',message:'Belum terhubung ke pekerjaan ini.'};
  if(Date.now()>=Date.parse(session.expires_at))return {state:'disconnected',message:'Sesi kedaluwarsa. Hubungkan ulang.'};
  return safeStatus(session);
 }
 if(!session)throw new Error('Belum terhubung. Buat pairing dari website.');
 if(website&&(session.jobId!==payload.jobId||session.websiteOrigin!==new URL(sender.url).origin||session.websiteTabId!==sender.tab.id))throw new Error('Pesan tidak berasal dari tab pekerjaan yang terhubung.');
 if(message.action==='STOP'){
  await automation().cancel(session);
  // Local session is removed immediately, even when revocation cannot reach the API.
  await chrome.storage.session.remove(['session','pending']);
  try{await fetch(`${session.apiOrigin}/api/v1/jobs/${session.jobId}/extension-session`,{method:'DELETE',headers:{Authorization:'Bearer '+session.grant_token},credentials:'omit',redirect:'error'});}catch{}
  return {state:'stopped',message:'Sesi lokal dihentikan. Jika API offline, grant berakhir maksimal 15 menit.'};
 }
 if(message.action==='PAUSE'){await automation().cancel(session);await write('session',{...await read('session'),autoRun:false,state:'paused',message:'Dijeda. Periksa/lanjutkan melalui popup setelah siap.'});return safeStatus({...session,state:'paused'});}
 if(popup&&message.action==='RESUME'&&session.flow)return automation().start(session,session.targetTabId);
 if(popup&&message.action==='RESUME'){if(Date.now()>=Date.parse(session.expires_at))throw new Error('Sesi kedaluwarsa. Hubungkan ulang.');const next={...session,state:'extension_ready'};await write('session',next);return safeStatus(next);}
 if(!canAct(session))throw new Error('Sesi dijeda atau berakhir. Lanjutkan dari popup atau hubungkan ulang.');
 if(message.action==='START_AUTO')return automation().start(session,popup?Number(payload.tabId):undefined);
 if(message.action==='INSPECT'){const next=await inspect(session,popup?Number(payload.tabId):undefined);await write('session',next);return safeStatus(next);}
 if(popup&&message.action==='PACKAGE')return packageFor(session);
 if(popup&&message.action==='CHECK_FILES'){
  activeController=new AbortController();
  const pack=await packageFor(session,activeController.signal);
  for(const file of pack.files) await checkPdf(session,file,activeController.signal);
  if(activeController.signal.aborted)throw new Error('Proses dihentikan.');
  const next={...session,state:'user_action_required',message:'Empat PDF tervalidasi. Belum diunggah. Gunakan unduhan website untuk fallback manual.'};await write('session',next);return safeStatus(next);
 }
 throw new Error('Tindakan tidak tersedia. Gunakan panduan manual untuk halaman yang belum terverifikasi.');
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message.kind==='WEBSITE'&&message.action==='STATUS'){handle(message,sender).then(result=>respond({result})).catch(()=>respond({error:'Sesi tidak tersedia.'}));return true;}
 if(['STOP','PAUSE'].includes(message.action)){
  // Do not put cancellation behind a long file transfer in the command queue.
  const trustedPopup=message.kind==='POPUP'&&sender.id===chrome.runtime.id&&sender.url===chrome.runtime.getURL('popup.html');
  const trustedWebsite=message.kind==='WEBSITE'&&sender.frameId===0&&isAllowedOrigin(sender.url,config.websiteOrigins);
  (async()=>{
   const current=await read('session');
   if(!trustedPopup&&!(trustedWebsite&&current?.websiteTabId===sender.tab?.id&&current?.jobId===message.payload?.jobId&&current?.websiteOrigin===new URL(sender.url).origin))throw new Error('Origin ditolak.');
   activeController?.abort();return handle(message,sender);
  })().then(result=>respond({result})).catch(()=>respond({error:'Tidak dapat menghentikan sesi yang tidak terhubung.'}));
  return true;
 }
 queue=queue.catch(()=>{}).then(()=>handle(message,sender)).then(result=>respond({result})).catch(error=>respond({error:String(error.message||'Tindakan tidak dapat dilanjutkan.').slice(0,300)}));
 return true;
});
chrome.tabs.onRemoved.addListener(tabId=>{
 queue=queue.catch(()=>{}).then(async()=>{const session=await read('session');if(session?.targetTabId===tabId)await write('session',{...session,state:'user_action_required',autoRun:false,targetTabId:null,message:'Tab SIPORA ditutup. Buka tab kembali dan pilih target dari popup.'});});
});

chrome.tabs.onUpdated?.addListener((tabId,change)=>{if(change.status==='complete')automation().advance(tabId);});
