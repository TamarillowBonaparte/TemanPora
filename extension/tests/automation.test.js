import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import {webcrypto,createHash} from 'node:crypto';

const origin='https://sipora.polije.ac.id';
const url=stage=>`${origin}/cgi/users/home?screen=EPrint::Edit&eprintid=61189&stage=${stage}`;
const bytes=new TextEncoder().encode('%PDF-fixture');
const files=[['abstract','Abstract'],['chapter_1','Bab 1 Pendahuluan'],['full_report','Laporan Lengkap'],['references','Daftar Pustaka']].map(([key,name])=>({key,filename:name+'.pdf',description:name,content:'Submitted Version',visible_to:key==='full_report'?'Registered user only':'Anyone',license:key==='full_report'?'Unspecified':'CC BY-SA 4.0',size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}));
const pack={files,metadata:{verified:true,discipline_confirmed:true,disciplines:['458 - Teknik Informatika'],title:'Judul Laporan',abstract:'Abstrak contoh',creator_family_name:'Mahasiswa',creator_given_name:'Contoh',creator_identifier:'NIMG41200000',advisor_family_name:'Pembimbing',advisor_given_name:'Contoh',advisor_identifier:'NIDN1234567890',institution:'Politeknik Negeri Jember',number_of_pages:20,email:'contoh@example.test',references:'Referensi',keywords:'sistem',thesis_type:'Undergraduate',department:'Teknik Informatika',division:'Perpustakaan: Tugas Akhir: Undergraduate',publication_date:'2026-11-04'}};
const nav=['next','jump_files','jump_core','jump_subjects','jump_deposit'].map(name=>`<input type="submit" name="_action_${name}" value="${name}">`).join('');
function page(html,stage='core'){
 const dom=new JSDOM(`<h1>Edit item: Thesis #61189</h1><form>${nav}${html}</form>`,{url:url(stage),runScripts:'outside-only'});
 dom.window.CSS={escape:value=>value.replace(/[^a-zA-Z0-9_-]/g,char=>'\\'+char)};
 Object.defineProperty(dom.window,'crypto',{value:webcrypto});
 dom.window.fetch=async()=>({ok:true,arrayBuffer:async()=>bytes.buffer});
 dom.window.eval(fs.readFileSync('config.js','utf8'));
 dom.window.eval(fs.readFileSync('modules/automation-v212.js','utf8'));
 return {dom,doc:dom.window.document,engine:dom.window.ThesisSplitSipora.automation};
}
function select(name,values,multiple=false){return `<select name="c20_${name}" ${multiple?'multiple':''}>${values.map(([value,text])=>`<option value="${value}">${text}</option>`).join('')}</select>`;}
function radio(name,value,label){return `<label><input type="radio" name="c20_${name}" value="${value}">${label}</label>`;}
function core(){
 const fields=['title','abstract','creators_1_name_family','creators_1_name_given','creators_1_id','contributors_1_name_family','contributors_1_name_given','contributors_1_id','institution','pages','contact_email','referencetext','keywords','date_year'];
 return fields.map(name=>name==='title'||name==='abstract'?`<textarea name="c4_${name}"></textarea>`:`<input type="text" name="c20_${name}">`).join('')+
 radio('thesis_type','undergraduate','Undergraduate')+radio('thesis_name','other','Other')+radio('ispublished','unpub','Unpublished')+radio('date_type','completed','Completion')+radio('department','kode55301','D4 - Teknik Informatika')+
 select('contributors_1_type',[['','UNSPECIFIED'],['THS','Thesis advisor']])+select('divisions',[['DT','Perpustakaan: Tugas Akhir: Diploma'],['SJ','Perpustakaan: Tugas Akhir: Undergraduate']],true)+select('date_month',[['00','Unspecified'],['11','November']])+select('date_day',[['00','?'],['04','04']]);
}
function group(file){return `<section><a href="${origin}/61189/1/${encodeURIComponent(file.filename)}">${file.filename}</a>${select(file.key+'_content',[['draft','Draft'],['submitted','Submitted Version']])}${select(file.key+'_security',[['public','Anyone'],['restricted','Registered users only']])}${select(file.key+'_license',[['','UNSPECIFIED'],['cc','CC: Attribution-Share Alike 4.0']])}<input type="text" name="c20_${file.key}_description"><input type="submit" name="_internal_doc_update_doc" value="Update Metadata"></section>`;}
const fileInput='<input type="file" name="c2_Screen::EPrint::UploadMethod::File_file" onchange="UploadMethod_file_change(this)">';

test('recognizes actual EPrints pages and binds draft identity',async()=>{
 const {doc,engine}=page(core());assert.equal(engine.pageKind(doc,url('core')),'core');
 await assert.rejects(engine.step(doc,url('core'),pack,{itemId:'999',phase:'metadata'}),/item lain/);
 const result=await engine.step(doc,url('core'),pack,{phase:'files'});assert.equal(result.navigate.name,'_action_jump_files');assert.equal(result.checkpoint.itemId,'61189');
 const login=page('<input type="password">');assert.equal(login.engine.pageKind(login.doc,url('core')),'login_required');
 assert.equal(engine.pageKind(doc,'https://evil.test/'),'wrong_tab');
});
test('fills all metadata, radios, multi-select division and split date from reviewed package',async()=>{
 const {doc,engine}=page(core());const result=await engine.step(doc,url('core'),pack,{itemId:'61189',phase:'metadata'});
 assert.equal(doc.querySelector('[name$="_title"]').value,pack.metadata.title);
 assert.equal(doc.querySelector('[name$="_creators_1_id"]').value,'NIMG41200000');
 assert.equal(doc.querySelector('[name$="_date_year"]').value,'2026');assert.equal(doc.querySelector('[name$="_date_month"]').value,'11');assert.equal(doc.querySelector('[name$="_date_day"]').value,'04');
 assert.equal(doc.querySelector('[name$="_department"]:checked').value,'kode55301');assert.equal(doc.querySelector('[name$="_divisions"]').value,'SJ');
 assert.equal(result.navigate.name,'_action_jump_subjects');assert.equal(result.checkpoint.phase,'subjects');
});
test('unknown department preflight leaves every metadata field untouched',()=>{
 const {doc,engine}=page(core());assert.throws(()=>engine.metadataPlan(doc,{...pack.metadata,department:'Other Campus'}),/belum cocok/);
 assert.equal(doc.querySelector('[name$="_title"]').value,'');
});
test('uploads only the first missing file and never treats filename alone as final success',async()=>{
 const {doc,engine}=page(fileInput,'files');const result=await engine.step(doc,url('files'),pack,{phase:'files'});
 assert.equal(result.needFile,'abstract');assert.equal(result.completed_files,0);
});
test('verifies hashes of all four remote PDFs and sets each output policy',async()=>{
 const {doc,engine}=page(fileInput+files.map(group).join(''),'files');
 for(const file of files){const controls=engine.findDocument(doc,file);for(const apply of engine.settingsPlan(controls,file))apply();}
 const result=await engine.step(doc,url('files'),pack,{phase:'files'});
 assert.equal(result.completed_files,4);assert.equal(result.checkpoint.phase,'metadata');assert.equal(result.navigate.name,'_action_jump_core');
 for(const file of files){const fields=engine.findDocument(doc,file);assert.equal(fields.content.value,'submitted');assert.equal(fields.security.value,file.key==='full_report'?'restricted':'public');assert.equal(fields.license.value,file.key==='full_report'?'':'cc');assert.equal(fields.description.value,file.description);}
});
test('existing file with different content stops before any policy mutation',async()=>{
 const {dom,doc,engine}=page(fileInput+files.map(group).join(''),'files');dom.window.fetch=async()=>({ok:true,arrayBuffer:async()=>new TextEncoder().encode('wrong').buffer});
 await assert.rejects(engine.step(doc,url('files'),pack,{phase:'files'}),/Ukuran file/);
 assert.equal(engine.findDocument(doc,files[0]).content.value,'draft');
});
test('duplicate uploaded filename is blocked',()=>{
 const {doc,engine}=page(fileInput+group(files[0])+group(files[0]).replace('/1/','/2/'),'files');
 assert.throws(()=>engine.findDocument(doc,files[0]),/duplikat/);
});
test('only confirmed matching subject is added; already-selected subject is not duplicated',async()=>{
 const {doc,engine}=page('<input id="c31_q"><dt class="ep_subjectinput_tree"><a>410 - Teknik</a></dt><dt><input type="submit" name="_internal_c31_458_add" value="Add">458 - Teknik Informatika</dt>','subjects');
 let result=await engine.step(doc,url('subjects'),pack,{phase:'subjects'});assert.equal(result.navigate.name,'_internal_c31_458_add');
 doc.querySelector('dt:last-child').innerHTML='<input type="submit" name="_internal_c31_458_remove" value="Remove">458 - Teknik Informatika';
 result=await engine.step(doc,url('subjects'),pack,{phase:'subjects'});assert.equal(result.navigate.name,'_action_jump_files');assert.equal(result.checkpoint.phase,'final_files');
});
test('final review stops and never clicks deposit',async()=>{
 const {doc,engine}=page('<input type="submit" name="_action_deposit" value="Deposit Item Now">','deposit');doc.querySelector('h1').textContent='Deposit item: Thesis #61189';
 let clicked=0;doc.querySelector('[name="_action_deposit"]').addEventListener('click',()=>clicked++);
 const result=await engine.step(doc,url('deposit'),pack,{phase:'review',filesVerified:true});assert.equal(result.stop,true);assert.equal(result.state,'final_confirmation');assert.equal(clicked,0);assert.equal(result.navigate,undefined);
 doc.body.insertAdjacentHTML('afterbegin','<img alt="Warning">');assert.equal((await engine.step(doc,url('deposit'),pack,{phase:'review',filesVerified:true})).state,'metadata_incomplete');
});
test('unapproved metadata cannot trigger any UI automation',async()=>{
 const {doc,engine}=page(core());await assert.rejects(engine.step(doc,url('core'),{...pack,metadata:{...pack.metadata,verified:false}},{phase:'metadata'}),/disetujui/);
});


test('file input change fires once; upload waits for completed document options',async()=>{
 const {dom,doc,engine}=page(fileInput,'files');const input=doc.querySelector('input[type="file"]');
 let changes=0,filesSet;
 dom.window.DataTransfer=class {constructor(){this.items={add:file=>{this.files=[file];}};this.files=[];}};
 dom.window.TextDecoder=TextDecoder;
 Object.defineProperty(input,'files',{get:()=>filesSet,set:value=>{filesSet=value;}});
 input.addEventListener('change',()=>{changes++;queueMicrotask(()=>doc.querySelector('form').insertAdjacentHTML('beforeend',group(files[0])));});
 const result=await engine.upload(doc,files[0],Buffer.from(bytes).toString('base64'),new AbortController().signal);
 assert.equal(changes,1);assert.equal(filesSet[0].name,'Abstract.pdf');assert.equal(result.state,'upload_in_progress');assert.equal(result.reload,true);
 await engine.upload(doc,files[0],Buffer.from(bytes).toString('base64'),new AbortController().signal);
 assert.equal(changes,1); // never select/send an already-present filename twice
});

test('aborted upload never dispatches change',async()=>{
 const {dom,doc,engine}=page(fileInput,'files');const input=doc.querySelector('input[type="file"]');let changes=0;
 dom.window.DataTransfer=class {constructor(){this.items={add:()=>{}};this.files=[];}};dom.window.TextDecoder=TextDecoder;
 Object.defineProperty(input,'files',{set:()=>{}});input.addEventListener('change',()=>changes++);
 const controller=new AbortController();controller.abort();
 await assert.rejects(engine.upload(doc,files[0],Buffer.from(bytes).toString('base64'),controller.signal),/dibatalkan/);assert.equal(changes,0);
});


test('document description accepts the EPrints formatdesc field',()=>{
 const {doc,engine}=page(fileInput+group(files[0]).replace('_description','_formatdesc'),'files');
 const controls=engine.findDocument(doc,files[0]);assert.ok(controls.description.name.endsWith('_formatdesc'));
});

test('website bridge rejects other origins and other extension targets',()=>{
 const dom=new JSDOM('',{url:'http://127.0.0.1:3000/',runScripts:'outside-only'});let calls=0;const replies=[];
 dom.window.chrome={runtime:{id:'new-extension',getManifest:()=>({version:'2.1.0'}),sendMessage:(message,reply)=>{calls++;reply({result:{state:'extension_ready',automation:true}});}}};
 dom.window.eval(fs.readFileSync('config.js','utf8'));dom.window.eval(fs.readFileSync('website-bridge.js','utf8'));
 dom.window.postMessage=message=>replies.push(message);
 const event=(origin,extensionId)=>new dom.window.MessageEvent('message',{origin,source:dom.window,data:{type:'THESISSPLIT_REQUEST',requestId:'test',action:'HELLO',extensionId}});
 dom.window.dispatchEvent(event('https://evil.test'));assert.equal(calls,0);
 dom.window.dispatchEvent(event('http://127.0.0.1:3000','old-extension'));assert.equal(calls,0);
 dom.window.dispatchEvent(event('http://127.0.0.1:3000','new-extension'));assert.equal(calls,1);assert.equal(replies[0].bridgeId,'new-extension');assert.equal(replies[0].bridgeVersion,'2.1.0');
});


test('new document policies are saved through Update Metadata before another upload',async()=>{
 const {doc,engine}=page(fileInput+group(files[0]),'files');const result=await engine.step(doc,url('files'),pack,{phase:'files'});
 assert.equal(result.navigate.value,'Update Metadata');assert.equal(result.needFile,undefined);assert.equal(result.checkpoint.phase,'files');
 assert.equal(engine.findDocument(doc,files[0]).content.value,'submitted');
});


test('legacy 100 percent upload returns a single reload checkpoint rather than resubmitting',async()=>{
 const {dom,doc,engine}=page(fileInput,'files');const input=doc.querySelector('input[type="file"]');let changes=0;
 dom.window.DataTransfer=class {constructor(){this.items={add:()=>{}};this.files=[];}};dom.window.TextDecoder=TextDecoder;
 Object.defineProperty(input,'files',{set:()=>{}});
 const original=dom.window.setTimeout.bind(dom.window);dom.window.setTimeout=(callback,delay)=>original(callback,delay===3000?0:delay);
 input.addEventListener('change',()=>{changes++;queueMicrotask(()=>doc.body.insertAdjacentHTML('beforeend','<table><tr><td>Abstract.pdf</td><td>100%</td></tr></table>'));});
 const result=await engine.upload(doc,files[0],Buffer.from(bytes).toString('base64'),new AbortController().signal);
 assert.equal(changes,1);assert.equal(result.navigation,true);assert.equal(result.reload,true);
});


test('actual EPrints selected-subject row stores the label in the adjacent cell',async()=>{
 const html='<input id="c31_q"><dt class="ep_subjectinput_tree"><a>410 - Teknik</a></dt><dt>458 - Teknik Informatika</dt><table><tr><td><input type="submit" name="_internal_c31_458_remove" value="Remove"></td><td>458 - Teknik Informatika</td></tr></table>';
 const {doc,engine}=page(html,'subjects');const result=await engine.step(doc,url('subjects'),pack,{phase:'subjects'});
 assert.equal(result.navigate.name,'_action_jump_files');assert.equal(result.checkpoint.phase,'final_files');
});

test('review checkpoint cannot skip fresh file verification',async()=>{
 const {doc,engine}=page('<input type="submit" name="_action_deposit" value="Deposit Item Now">','deposit');doc.querySelector('h1').textContent='Deposit item: Thesis';
 const result=await engine.step(doc,url('deposit'),pack,{phase:'review'});
 assert.equal(result.navigate.name,'_action_jump_files');assert.equal(result.checkpoint.phase,'final_files');assert.equal(result.stop,undefined);
});
test('final file audit uploads the missing fourth PDF and verifies all four before review',async()=>{
 const {doc,engine}=page(fileInput+files.slice(0,3).map(group).join(''),'files');
 for(const file of files.slice(0,3))for(const apply of engine.settingsPlan(engine.findDocument(doc,file),file))apply();
 let result=await engine.step(doc,url('files'),pack,{phase:'final_files'});
 assert.equal(result.needFile,'references');assert.equal(result.completed_files,3);assert.equal(result.checkpoint.filesVerified,false);
 doc.querySelector('form').insertAdjacentHTML('beforeend',group(files[3]));
 for(const apply of engine.settingsPlan(engine.findDocument(doc,files[3]),files[3]))apply();
 result=await engine.step(doc,url('files'),pack,{phase:'final_files'});
 assert.equal(result.completed_files,4);assert.equal(result.checkpoint.filesVerified,true);assert.equal(result.navigate.name,'_action_jump_deposit');
});
test('approved Teknologi Informasi replaces the old Teknik Informatika subject',async()=>{
 const html='<input id="c31_q"><div class="ep_subjectinput_tree"></div><table><tr><td><input type="submit" name="_internal_c31_458_remove" value="Remove"></td><td>458 - Teknik Informatika</td></tr><tr><td><input type="submit" name="_internal_c31_462_remove" value="Remove"></td><td>462 - Teknologi Informasi</td></tr></table>';
 const {doc,engine}=page(html,'subjects');const approved={...pack,metadata:{...pack.metadata,disciplines:['462 - Teknologi Informasi']}};
 const result=await engine.step(doc,url('subjects'),approved,{phase:'subjects'});
 assert.equal(result.navigate.name,'_internal_c31_458_remove');assert.equal(result.state,'discipline_selection');
});
test('cover prodi matches the correct degree when D3 and D4 share a name',()=>{
 const {doc,engine}=page(core()+radio('department','d3-ti','D3 - Teknik Informatika'));
 for(const apply of engine.metadataPlan(doc,pack.metadata))apply();
 assert.equal(doc.querySelector('[name$="_department"]:checked').value,'kode55301');
});
