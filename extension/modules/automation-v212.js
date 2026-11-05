/* SIPORA EPrints adapter. Controls were inspected on 4 Nov 2026.
 * Only these fixed UI actions are exposed; final deposit is never part of a run.
 */
(() => {
 const ns=globalThis.ThesisSplitSipora=globalThis.ThesisSplitSipora||{};
 const norm=value=>String(value||'').normalize('NFKC').replace(/\s+/g,' ').trim().toLocaleLowerCase();
 const canonical=value=>norm(value).replace(/[^\p{L}\p{N}]/gu,'');
 const visible=element=>!!element&&element.getClientRects().length>0;
 const fail=message=>{throw new Error(message);};
 const unique=(root,selector)=>{const all=[...root.querySelectorAll(selector)];if(all.length!==1)fail('Kontrol SIPORA berubah atau tidak unik. Proses dihentikan.');return all[0];};
 const field=(doc,suffix)=>unique(doc,`[name$="_${suffix}"]`);
 const caption=element=>(element.value||element.textContent||'').trim();
 const labels=(doc,element)=>[...(element.labels||[])].map(label=>label.textContent).join(' ')||doc.querySelector(`[for="${CSS.escape(element.id)}"]`)?.textContent||element.id;
 const changed=element=>{element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));};
 function setValue(element,value){
  const ctor=element.tagName==='TEXTAREA'?HTMLTextAreaElement:element.tagName==='SELECT'?HTMLSelectElement:HTMLInputElement;
  Object.getOwnPropertyDescriptor(ctor.prototype,'value').set.call(element,String(value));changed(element);
 }
 function selectOption(element,text,aliases=[]){
  const choices=[text,...aliases].map(canonical);const matches=[...element.options].filter(option=>choices.includes(canonical(option.textContent)));
  if(matches.length!==1)fail('Pilihan SIPORA tidak cocok: '+text+'. Periksa langsung pada form.');return matches[0];
 }
 function planSelect(element,text,aliases=[]){const option=selectOption(element,text,aliases);return()=>{if(element.multiple){for(const opt of element.options)opt.selected=opt===option;changed(element);}else setValue(element,option.value);};}
 function planRadio(doc,suffix,text,degree){
  const radios=[...doc.querySelectorAll(`input[type="radio"][name$="_${suffix}"]`)];
  const clean=value=>canonical(value).replace(/^(programstudi|prodi)/,'').replace(/^(d3|d4|s2)/,'');
  let matches=radios.filter(element=>clean(labels(doc,element))===clean(text));
  if(suffix==='department'&&matches.length>1&&degree)matches=matches.filter(element=>canonical(labels(doc,element)).replace(/^(programstudi|prodi)/,'').startsWith(degree));
  if(matches.length!==1)fail('Pilihan '+suffix+' belum cocok dengan metadata. Periksa nama program studi/jenjang.');
  return()=>{matches[0].checked=true;changed(matches[0]);};
 }
 function action(doc,name){
  if(!['_action_next','_action_jump_files','_action_jump_core','_action_jump_subjects','_action_jump_deposit'].includes(name))fail('Tindakan navigasi ditolak.');
  const buttons=[...doc.querySelectorAll(`input[type="submit"][name="${name}"]`)];
  if(!buttons.length||buttons.length>2||buttons.some(button=>button.disabled))fail('Tombol navigasi SIPORA tidak tersedia.');
  return buttons[0];
 }
 function itemId(url){const id=new URL(url).searchParams.get('eprintid');return /^\d+$/.test(id||'')?id:null;}
 function pageKind(doc,url){
  const parsed=new URL(url);
  if(parsed.origin!==globalThis.ThesisSplitConfig.siporaOrigin)return 'wrong_tab';
  if(doc.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],input[name="g-recaptcha-response"]'))return 'captcha_required';
  if(doc.querySelector('input[autocomplete="one-time-code"]'))return 'otp_required';
  if(doc.querySelector('input[type="password"]'))return 'login_required';
  if(parsed.pathname!=='/cgi/users/home')return 'unsupported_page';
  const screen=parsed.searchParams.get('screen')||'';
  if(screen==='Items'&&[...doc.querySelectorAll('input,button')].some(el=>caption(el)==='New Item'))return 'items';
  if(doc.querySelector('input[type="radio"][name$="_type"][value="thesis"]'))return 'type';
  if(!itemId(url))return doc.querySelector('a[href*="screen=Items"]')?'home':'unsupported_page';
  if(!doc.querySelector('input[name="_action_jump_core"]')||!doc.querySelector('input[name="_action_jump_files"]'))return 'unsupported_page';
  if(doc.querySelector('input[type="file"][name*="UploadMethod::File"]'))return 'files';
  if(doc.querySelector('textarea[name$="_title"]')&&doc.querySelector('[name$="_creators_1_name_family"]'))return 'core';
  if(doc.querySelector('input[id$="_q"]')&&doc.querySelector('.ep_subjectinput_tree'))return 'subjects';
  if(/^Deposit item:/i.test(doc.querySelector('h1')?.textContent||''))return 'deposit';
  return 'unsupported_page';
 }
 function assertPackage(pack){
  if(!pack?.metadata?.verified||!pack.metadata.discipline_confirmed||!pack.metadata.disciplines?.length||pack.files?.length!==4)fail('Metadata, rumpun, dan empat file harus disetujui dari website.');
  const names=pack.files.map(file=>file.filename);
  if(new Set(names).size!==4||!names.includes('Laporan Lengkap.pdf')||!names.includes('Bab 1 Pendahuluan.pdf')||!names.includes('Daftar Pustaka.pdf')||!names.some(name=>['Abstract.pdf','Ringkasan.pdf'].includes(name)))fail('Manifest empat berkas tidak sesuai.');
 }
 function assertDraft(context,id){if(context.itemId&&id!==context.itemId)fail('Tab berpindah ke item lain. Otomasi dihentikan untuk melindungi draft.');}
 function reveal(doc,element){
  if(visible(element))return;
  let node=element.parentElement;
  while(node&&node!==doc.body){
   const header=node.previousElementSibling;
   if(header){const link=[...header.querySelectorAll('a')].find(a=>/^\+/.test(a.textContent.trim()));if(link)link.click();}
   node=node.parentElement;
  }
 }
 function metadataPlan(doc,data){
  const stringFields={title:'title',abstract:'abstract',creator_family_name:'creators_1_name_family',creator_given_name:'creators_1_name_given',creator_identifier:'creators_1_id',advisor_family_name:'contributors_1_name_family',advisor_given_name:'contributors_1_name_given',advisor_identifier:'contributors_1_id',institution:'institution',number_of_pages:'pages',email:'contact_email',references:'referencetext',keywords:'keywords'};
  const plans=[];
  for(const [key,suffix] of Object.entries(stringFields)){
   const element=field(doc,suffix);if(!['INPUT','TEXTAREA'].includes(element.tagName)||element.disabled)fail('Field metadata tidak dapat diisi.');
   plans.push(()=>{reveal(doc,element);setValue(element,data[key]??'');});
  }
  plans.push(planRadio(doc,'thesis_type',data.thesis_type),planRadio(doc,'thesis_name','Other'),planRadio(doc,'ispublished','Unpublished'),planRadio(doc,'date_type','Completion'),planRadio(doc,'department',data.department,{Diploma:'d3',Undergraduate:'d4',Masters:'s2'}[data.thesis_type]));
  plans.push(planSelect(field(doc,'contributors_1_type'),'Thesis advisor'),planSelect(field(doc,'divisions'),data.division));
  const date=String(data.publication_date).match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!date)fail('Tanggal pengesahan tidak valid.');
  const year=field(doc,'date_year'),month=field(doc,'date_month'),day=field(doc,'date_day');
  if(![...month.options].some(o=>o.value===date[2])||![...day.options].some(o=>o.value===date[3]))fail('Kontrol tanggal SIPORA berubah.');
  plans.push(()=>{setValue(year,date[1]);setValue(month,date[2]);setValue(day,date[3]);});
  return plans;
 }
 function findDocument(doc,file){
  const matchName=value=>{let name=String(value||'');try{name=decodeURIComponent(name);}catch{}return canonical(name)===canonical(file.filename);};
  const anchors=[...doc.querySelectorAll('a[href]')].filter(a=>matchName(a.textContent.trim())||matchName(new URL(a.href,doc.URL).pathname.split('/').pop()));
  const links=[...new Map(anchors.map(a=>[a.href,a])).values()];
  if(links.length>1)fail('Terdapat file duplikat '+file.filename+'. Periksa draft sebelum melanjutkan.');
  if(!links.length)return null;
  const link=links[0];let root=link.parentElement;
  while(root&&root!==doc.body){
   const selects=[...root.querySelectorAll('select')];
   const content=selects.filter(s=>[...s.options].some(o=>canonical(o.textContent)==='submittedversion'));
   const security=selects.filter(s=>[...s.options].some(o=>canonical(o.textContent)==='anyone')&&[...s.options].some(o=>['registeredusersonly','registereduseronly'].includes(canonical(o.textContent))));
   const license=selects.filter(s=>[...s.options].some(o=>/attributionsharealike40|ccbysa40/.test(canonical(o.textContent))));
   const descriptions=[...root.querySelectorAll('input[type="text"],textarea')].filter(el=>/description|formatdesc/.test(el.name));
   if(content.length===1&&security.length===1&&license.length===1&&descriptions.length===1)return {link,root,content:content[0],security:security[0],license:license[0],description:descriptions[0]};
   root=root.parentElement;
  }
  fail('File ditemukan, tetapi opsi Content/Visibility/License/Description belum dikenali. Proses berhenti sebelum file lain diunggah.');
 }
 async function verifyRemote(file,link,signal){
  const url=new URL(link.href,location.href);if(url.origin!==location.origin)fail('Tautan file bukan domain SIPORA.');
  const response=await fetch(url.href,{credentials:'same-origin',redirect:'error',signal});if(!response.ok)fail('Berkas pada SIPORA belum dapat diverifikasi.');
  const bytes=await response.arrayBuffer();if(bytes.byteLength!==file.size)fail('Ukuran file pada draft tidak sama dengan hasil ThesisSplit.');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(hash!==file.sha256)fail('Isi file pada draft berbeda. Tidak menimpa atau mengunggah duplikat.');
 }
 function settingsPlan(group,file){return [planSelect(group.content,'Submitted Version'),planSelect(group.security,file.visible_to,file.visible_to==='Anyone'?[]:['Registered users only','Registered user only']),planSelect(group.license,file.license,file.license==='Unspecified'?['UNSPECIFIED']:['CC: Attribution-Share Alike 4.0','Creative Commons Attribution Share Alike 4.0']),()=>setValue(group.description,file.description)];}
 function selectedSubjects(doc){return [...doc.querySelectorAll('input[type="submit"]')].filter(el=>caption(el)==='Remove'&&/subjects|c\d+_/.test(el.name)).map(el=>({label:norm((el.closest('tr')||el.parentElement).textContent),button:el}));}
 function subjectMatches(label,wanted){const strip=value=>norm(value).replace(/^\d+\s*[-–:]?\s*/,'');return strip(label)===strip(wanted);}
 function subjectStep(doc,data){
  if(!data.discipline_confirmed)fail('Rumpun keilmuan belum disetujui.');
  const selected=selectedSubjects(doc);const missing=data.disciplines.find(value=>!selected.some(entry=>subjectMatches(entry.label,value)));
  if(!missing){const extra=selected.find(entry=>!data.disciplines.some(value=>subjectMatches(entry.label,value)));if(extra)return {state:'discipline_selection',navigate:extra.button,message:'Menghapus rumpun lama agar sesuai pilihan metadata yang disetujui.'};}
  if(!missing)return {state:'upload_in_progress',navigate:action(doc,'_action_jump_files'),checkpoint:{phase:'final_files',filesVerified:false},message:'Rumpun tersimpan. Memeriksa ulang empat PDF yang tersimpan sebelum review akhir.'};
  const candidates=[...doc.querySelectorAll('dt')].filter(el=>subjectMatches(el.textContent,missing));
  const buttons=candidates.flatMap(el=>[...el.querySelectorAll('input[type="submit"]')].filter(button=>caption(button)==='Add'));
  if(buttons.length!==1)fail('Rumpun tidak ditemukan secara unik: '+missing+'. Gunakan nama/kode persis seperti SIPORA.');
  // Expand the inspected EPrints subject tree; never substitute a different subject.
  let node=buttons[0].parentElement;
  while(node&&node!==doc.body){if(node.tagName==='DD')node.previousElementSibling?.querySelector('a')?.click();node=node.parentElement;}
  return {state:'discipline_selection',navigate:buttons[0],message:'Menambahkan rumpun yang sudah disetujui.'};
 }
 async function step(doc,url,pack,context,signal){
  assertPackage(pack);const kind=pageKind(doc,url);const id=itemId(url);
  if(['wrong_tab','login_required','captcha_required','otp_required','unsupported_page'].includes(kind))return {state:kind,stop:true,message:'Otomasi berhenti: '+kind+'. Periksa halaman SIPORA.'};
  if(id)assertDraft(context,id);else if(context.itemId)fail('Draft yang terikat tidak lagi terbuka. Buka draft tersebut dan lanjutkan.');
  const bound=id?{itemId:id}:{};
  if(kind==='home'){
   const links=[...doc.querySelectorAll('a[href]')].filter(el=>norm(el.textContent)==='manage deposits');if(links.length!==1)fail('Manage deposits tidak ditemukan.');
   return {state:'deposit_page_detected',navigate:links[0],message:'Membuka Manage deposits.'};
  }
  if(kind==='items'){
   if(context.createPending)fail('Pembuatan draft sebelumnya belum diketahui. Buka draft yang dibuat, lalu lanjutkan; tidak membuat duplikat.');
   const buttons=[...doc.querySelectorAll('input[type="submit"],input[type="button"],button')].filter(el=>caption(el)==='New Item');if(buttons.length!==1)fail('Tombol New Item tidak unik.');
   return {state:'deposit_page_detected',navigate:buttons[0],checkpoint:{createPending:true},message:'Membuat satu draft baru.'};
  }
  if(kind==='type'){
   const radio=unique(doc,'input[type="radio"][name$="_type"][value="thesis"]');radio.checked=true;changed(radio);
   return {state:'deposit_page_detected',navigate:action(doc,'_action_next'),checkpoint:{...bound,phase:'files',createPending:false},message:'Memilih Thesis dan melanjutkan ke upload.'};
  }
  if(['files','final_files'].includes(context.phase)||!context.phase){
   const phase=context.phase==='final_files'?'final_files':'files';
   if(kind!=='files')return {state:'upload_in_progress',navigate:action(doc,'_action_jump_files'),checkpoint:{...bound,phase,filesVerified:false},message:'Membuka tahap upload empat PDF.'};
   const groups=pack.files.map(file=>({file,group:findDocument(doc,file)}));
   for(const {file,group} of groups){
    if(!group)continue;
    await verifyRemote(file,group.link,signal);
    const options={content:selectOption(group.content,'Submitted Version'),security:selectOption(group.security,file.visible_to,file.visible_to==='Anyone'?[]:['Registered users only','Registered user only']),license:selectOption(group.license,file.license,file.license==='Unspecified'?['UNSPECIFIED']:['CC: Attribution-Share Alike 4.0','Creative Commons Attribution Share Alike 4.0'])};
    const same=group.content.value===options.content.value&&group.security.value===options.security.value&&group.license.value===options.license.value&&group.description.value===file.description;
    if(!same){
     const plans=settingsPlan(group,file);if(signal?.aborted)fail('Proses dijeda.');
     const update=[...group.root.querySelectorAll('input[type="submit"]')].filter(button=>caption(button)==='Update Metadata');
     if(update.length!==1)fail('Tombol Update Metadata dokumen belum dikenali.');
     for(const apply of plans)apply();
     return {state:'upload_in_progress',navigate:update[0],checkpoint:{...bound,phase,filesVerified:false,uploadIntent:null},completed_files:groups.filter(entry=>entry.group).length,message:'Menyimpan opsi '+file.filename+' sesuai pedoman.'};
    }
   }
   const absent=groups.find(entry=>!entry.group);
   if(absent)return {state:'upload_in_progress',needFile:absent.file.key,checkpoint:{...bound,filesVerified:false},completed_files:groups.filter(entry=>entry.group).length,message:'Menyiapkan '+absent.file.filename};
   if(phase==='final_files')return {state:'upload_completed',navigate:action(doc,'_action_jump_deposit'),checkpoint:{...bound,phase:'review',uploadIntent:null,filesVerified:true},completed_files:4,message:'Keempat PDF tersimpan dan isi serta opsi masing-masing cocok. Membuka review akhir.'};
   return {state:'upload_completed',navigate:action(doc,'_action_jump_core'),checkpoint:{...bound,phase:'metadata',uploadIntent:null},completed_files:4,message:'Empat PDF ditemukan, isinya cocok, dan opsi file telah diisi.'};
  }
  if(context.phase==='metadata'){
   if(kind!=='core')return {state:'metadata_filling',navigate:action(doc,'_action_jump_core'),message:'Membuka detail laporan.'};
   const plans=metadataPlan(doc,pack.metadata);for(const apply of plans)apply();
   return {state:'metadata_review',navigate:action(doc,'_action_jump_subjects'),checkpoint:{...bound,phase:'subjects'},message:'Metadata terisi. Menyimpan dan memilih rumpun yang disetujui.'};
  }
  if(context.phase==='subjects'){
   if(kind!=='subjects')return {state:'discipline_selection',navigate:action(doc,'_action_jump_subjects'),message:'Membuka rumpun keilmuan.'};
   const result=subjectStep(doc,pack.metadata);return {...result,checkpoint:{...bound,...result.checkpoint}};
  }
  if(context.phase==='review'){
   if(!context.filesVerified)return {state:'upload_in_progress',navigate:action(doc,'_action_jump_files'),checkpoint:{...bound,phase:'final_files'},message:'Memverifikasi ulang empat PDF sebelum menyatakan persiapan selesai.'};
   if(kind!=='deposit')return {state:'final_confirmation',navigate:action(doc,'_action_jump_deposit'),message:'Membuka review akhir.'};
   const warnings=[...doc.querySelectorAll('img[alt="Warning"]')];
   return {state:warnings.length?'metadata_incomplete':'final_confirmation',stop:true,checkpoint:bound,message:warnings.length?'SIPORA masih menampilkan peringatan. Periksa daftar masalah pada review akhir.':'Persiapan otomatis selesai. Periksa review SIPORA lalu lakukan deposit akhir sendiri.'};
  }
  fail('Tahap otomasi tidak dikenali.');
 }
 async function upload(doc,file,base64,signal){
  if(findDocument(doc,file))return {state:'upload_in_progress',message:'Berkas sudah terpasang; memeriksa opsi tanpa upload ulang.'};
  const input=unique(doc,'input[type="file"][name*="UploadMethod::File"]');
  if(!/UploadMethod_file_change/.test(input.getAttribute('onchange')||''))fail('Pemicu upload SIPORA berubah. Tidak mencoba upload berulang.');
  const bytes=Uint8Array.from(atob(base64),char=>char.charCodeAt(0));if(bytes.length!==file.size||new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')fail('Payload PDF tidak valid.');
  const transfer=new DataTransfer();transfer.items.add(new File([bytes],file.filename,{type:'application/pdf'}));input.files=transfer.files;
  if(signal?.aborted)fail('Upload dibatalkan sebelum dikirim.');input.dispatchEvent(new Event('change',{bubbles:true}));
  // The observed site change handler starts its own upload. Never also click Upload.
  const completion=await new Promise((resolve,reject)=>{
   let timer,settleTimer;
   const probe=()=>{
    if(signal?.aborted){done(new Error('Proses dijeda.'));return;}
    try{if(findDocument(doc,file)){done(undefined,{reload:true});return;}}catch{/* A placeholder is not a completed document. */}
    const transferred=[...doc.querySelectorAll('tr')].some(row=>row.textContent.includes(file.filename)&&/100%/.test(row.textContent));
    if(transferred&&!settleTimer)settleTimer=setTimeout(()=>done(undefined,{reload:true}),3000);
   };
   const observer=new MutationObserver(probe);
   const done=(error,result)=>{observer.disconnect();clearTimeout(timer);clearTimeout(settleTimer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(result);};
   const cancel=()=>done(new Error('Proses dijeda.'));signal?.addEventListener('abort',cancel,{once:true});
   observer.observe(doc.body,{childList:true,subtree:true});queueMicrotask(probe);timer=setTimeout(()=>done(new Error('Upload belum terverifikasi. Periksa file di SIPORA sebelum melanjutkan; tidak mengulang upload otomatis.')),90000);
  });
  return {state:'upload_in_progress',navigation:completion.reload,reload:completion.reload,message:completion.reload?'Transfer selesai. Memuat ulang daftar untuk memverifikasi penyimpanan.':'Berkas ditemukan pada daftar. Memeriksa opsi dokumen.'};
 }
 ns.automation={norm,canonical,itemId,pageKind,assertPackage,metadataPlan,findDocument,settingsPlan,subjectMatches,step,upload};
})();
