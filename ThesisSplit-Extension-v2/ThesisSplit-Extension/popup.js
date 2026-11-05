const $=id=>document.getElementById(id);
async function request(action,payload={}){const reply=await chrome.runtime.sendMessage({kind:'POPUP',action,payload});if(reply?.error)throw new Error(reply.error);return reply.result;}
async function run(action,payload={}){
 $('error').textContent='';document.querySelectorAll('button').forEach(button=>button.disabled=true);
 try {const result=await request(action,payload);if(result?.state)$('status').textContent=result.state+(result.message?' · '+result.message:'');await refresh();return result;}
 catch(error){$('error').textContent=error.message;}
 finally{document.querySelectorAll('button').forEach(button=>button.disabled=false);}
}
async function refresh(){const data=await request('POPUP_STATE');$('status').textContent=data.status.state+(data.status.message?' · '+data.status.message:'');$('pairing').hidden=!data.pending;if(data.pending)$('pairing-info').textContent=data.pending.websiteOrigin+' · '+data.pending.jobId;
 const selected=$('target').value;$('target').replaceChildren();for(const tab of data.tabs){const option=document.createElement('option');option.value=tab.id;option.textContent=tab.title;option.title=tab.url;$('target').append(option);}if([...$('target').options].some(o=>o.value===selected))$('target').value=selected;
}
$('approve').addEventListener('click',()=>run('APPROVE'));$('reject').addEventListener('click',()=>run('REJECT'));
$('start-auto').addEventListener('click',()=>run('START_AUTO',{tabId:Number($('target').value)}));
$('inspect').addEventListener('click',()=>run('INSPECT',{tabId:Number($('target').value)}));
for(const [id,action] of [['pause','PAUSE'],['resume','RESUME'],['stop','STOP'],['check','CHECK_FILES']])$(id).addEventListener('click',async()=>{await run(action);if(id==='stop'){$('metadata').replaceChildren();$('files').replaceChildren();}});
const fieldLabels={title:'Title',abstract:'Abstract',thesis_type:'Thesis Type',thesis_name:'Thesis name',creator_family_name:'Creator Family Name',creator_given_name:'Creator Given Name',creator_identifier:'Creator NIM/Email',contribution:'Contributor Contribution',advisor_family_name:'Contributor Family Name',advisor_given_name:'Contributor Given Name',advisor_identifier:'Contributor NIDN',division:'Division',publication_status:'Publication Status',publication_date:'Publication Date',date_type:'Date Type',institution:'Institution',department:'Department',number_of_pages:'Number of Pages',email:'Contact Email Address',references:'References',keywords:'Uncontrolled Keywords',disciplines:'Rumpun keilmuan'};
$('load').addEventListener('click',async()=>{
 const pack=await run('PACKAGE');if(!pack?.metadata)return;
 $('files').replaceChildren();for(const file of pack.files){const article=document.createElement('article');const name=document.createElement('strong');name.textContent=file.filename;const info=document.createElement('p');info.textContent=[file.content,file.description,file.visible_to,file.license].join(' · ');article.append(name,info);$('files').append(article);}
 $('metadata').replaceChildren();for(const [key,label] of Object.entries(fieldLabels)){const article=document.createElement('article');const heading=document.createElement('strong');heading.textContent=label;const textarea=document.createElement('textarea');textarea.readOnly=true;textarea.value=Array.isArray(pack.metadata[key])?pack.metadata[key].join('; '):String(pack.metadata[key]??'');const copy=document.createElement('button');copy.className='secondary';copy.textContent='Salin '+label;copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(textarea.value);copy.textContent='Tersalin';}catch{$('error').textContent='Pilih teks pada kolom, lalu salin manual.';}});article.append(heading,textarea,copy);$('metadata').append(article);}
});
refresh().catch(error=>$('error').textContent=error.message);

setInterval(()=>refresh().catch(()=>{}),2500);
