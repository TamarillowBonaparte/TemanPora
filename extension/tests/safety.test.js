import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {AutomationRunner} from '../modules/automation-runner.js';
import {isAllowedOrigin,canAct,nextDepositStatus} from '../modules/state.js';
import {checkPdf} from '../modules/file-bridge.js';

function domContext(){const ctx=vm.createContext({URL,Date,console});vm.runInContext(fs.readFileSync('config.js','utf8'),ctx);for(const file of ['sipora-detector','metadata-filler','upload-manager','division-selector','deposit-manager'])vm.runInContext(fs.readFileSync(`modules/${file}.js`,'utf8'),ctx);return ctx.ThesisSplitSipora;}

test('origin allowlist uses exact origin, not suffix or wildcard',()=>{
 assert.ok(isAllowedOrigin('https://sipora.polije.ac.id/123',['https://sipora.polije.ac.id']));
 for(const url of ['https://sipora.polije.ac.id.evil.test/','https://evil.test/sipora.polije.ac.id','http://sipora.polije.ac.id/'])assert.equal(isAllowedOrigin(url,['https://sipora.polije.ac.id']),false);
 assert.equal(isAllowedOrigin('http://127.0.0.1:3001/',['http://127.0.0.1:3000']),false);
});
test('expired or paused sessions cannot act',()=>{
 const expires_at=new Date(Date.now()+60000).toISOString();
 assert.ok(canAct({state:'extension_ready',expires_at}));
 for(const state of ['paused','stopped','disconnected'])assert.equal(canAct({state,expires_at}),false);
 assert.equal(canAct({state:'extension_ready',expires_at:'2000-01-01'}),false);
});
test('only verified matching item Under Review counts as completed',()=>{
 assert.equal(nextDepositStatus('Under Review',true),'completed');
 assert.equal(nextDepositStatus('Under Workarea',true),'user_action_required');
 assert.equal(nextDepositStatus('Under Review',false),'deposit_status_uncertain');
 assert.equal(nextDepositStatus('Submitted',true),'deposit_status_uncertain');
});
test('page detection stops at login, captcha, otp and unknown page',()=>{
 const ns=domContext();
 const doc=selector=>({querySelector:s=>s.includes(selector)?{}:null,querySelectorAll:()=>[]});
 assert.equal(ns.detect(doc('password'),'https://sipora.polije.ac.id/login').state,'login_required');
 assert.equal(ns.detect(doc('recaptcha'),'https://sipora.polije.ac.id/').state,'captcha_required');
 assert.equal(ns.detect(doc('one-time-code'),'https://sipora.polije.ac.id/').state,'otp_required');
 assert.equal(ns.detect(doc('not present'),'https://sipora.polije.ac.id/').state,'user_action_required');
 assert.equal(ns.detect(doc('password'),'https://evil.test/').state,'wrong_tab');
});
test('unverified live form cannot fill metadata, upload, select discipline or submit',()=>{
 const ns=domContext();const doc={querySelector:()=>null};let clicked=false;
 assert.throws(()=>ns.fillMetadata(doc,{verified:false},{}),/unsupported_page/);
 assert.throws(()=>ns.verifyUploads(doc,{verified:false},[]),/unsupported_page/);
 assert.throws(()=>ns.confirmDisciplines(doc,{verified:true},['science'],false),/user_action_required/);
 assert.throws(()=>ns.deposit(doc,{verified:true},{explicit:false,at:Date.now()}),/user_action_required/);
 assert.throws(()=>ns.deposit(doc,{verified:false},{explicit:true,at:Date.now()}),/unsupported_page/);
 assert.throws(()=>ns.verifyDeposit(doc,{verified:false},'Title'),/deposit_status_uncertain/);
 assert.equal(clicked,false);
});
test('deposit validates fresh explicit confirmation and status matching title',()=>{
 const ns=domContext();let count=0;
 const button={textContent:'Deposit Item Now',disabled:false,click:()=>count++};
 const doc={querySelector:()=>({}),querySelectorAll:selector=>[selector==='#deposit'?button:{textContent:selector==='#title'?'Title':'Under Workarea'}]};
 const profile={verified:true,fingerprint:'#fingerprint',depositButton:'#deposit',itemTitle:'#title',itemStatus:'#status'};
 assert.throws(()=>ns.deposit(doc,profile,{explicit:true,at:Date.now()-60000}),/user_action_required/);
 assert.equal(count,0);
 assert.equal(ns.deposit(doc,profile,{explicit:true,at:Date.now()}).state,'status_verification');
 assert.equal(count,1);
 assert.equal(ns.verifyDeposit(doc,profile,'Title').state,'user_action_required');
 assert.throws(()=>ns.verifyDeposit(doc,profile,'Different item'),/deposit_status_uncertain/);
});
test('default profile never assumes authenticated SIPORA selectors',()=>{
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('config.js','utf8'),ctx);
 assert.equal(ctx.ThesisSplitConfig.verifiedProfiles.length,0);
 const manifest=JSON.parse(fs.readFileSync('manifest.json','utf8'));
 assert.equal(manifest.manifest_version,3);assert.ok(!manifest.permissions.includes('cookies'));assert.ok(!manifest.permissions.includes('debugger'));
});
test('invalid file manifest is rejected before any network call',async()=>{
 await assert.rejects(checkPdf({}, {key:'source',filename:'source.pdf',size:1,mime_type:'application/pdf'}),/Manifest/);
});


test('service worker pairing requires popup approval and binds exact website tab',async()=>{
 const store={};let listener;let fetches=0;
 const fakeChrome={
  runtime:{id:'test-extension',getURL:path=>'chrome-extension://test-extension/'+path,onMessage:{addListener:fn=>listener=fn}},
  storage:{session:{get:async key=>({[key]:store[key]}),set:async value=>Object.assign(store,value),remove:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])delete store[key];}}},
  tabs:{query:async()=>[],onRemoved:{addListener:()=>{}}}
 };
 const ctx=vm.createContext({URL,Date,AbortController,console,chrome:fakeChrome,
  fetch:async()=>{fetches++;return {ok:true,json:async()=>({grant_token:'scoped-token',expires_at:new Date(Date.now()+900000).toISOString()})};},
  AutomationRunner,isAllowedOrigin,canAct,safeStatus:s=>({state:s?.state||'extension_ready',jobId:s?.jobId})
 });
 vm.runInContext(fs.readFileSync('config.js','utf8'),ctx);
 const source=fs.readFileSync('background.js','utf8').replace(/^import[^\n]*\n/gm,'');vm.runInContext(source,ctx);
 const send=(message,sender)=>new Promise(resolve=>listener(message,sender,resolve));
 const web={url:'http://127.0.0.1:3000/',frameId:0,tab:{id:7}};
 const popup={url:'chrome-extension://test-extension/popup.html',id:'test-extension'};
 const jobId='job_'+'a'.repeat(32);
 assert.ok((await send({kind:'WEBSITE',action:'PAIR',payload:{jobId,code:'x'.repeat(40),apiOrigin:'http://127.0.0.1:8000'}},{...web,url:'https://evil.test/'})).error);
 assert.equal(store.pending,undefined);
 assert.equal((await send({kind:'WEBSITE',action:'PAIR',payload:{jobId,code:'x'.repeat(40),apiOrigin:'http://127.0.0.1:8000'}},web)).result.state,'pairing_pending');
 assert.equal(fetches,0);
 assert.ok((await send({kind:'WEBSITE',action:'APPROVE',payload:{jobId}},web)).error);
 assert.equal(fetches,0);
 assert.equal((await send({kind:'POPUP',action:'APPROVE'},popup)).result.state,'extension_ready');
 assert.equal(fetches,1);assert.equal(store.session.grant_token,'scoped-token');assert.equal(store.pending,undefined);
 const visible=await send({kind:'WEBSITE',action:'STATUS',payload:{jobId}},web);
 assert.equal(visible.result.jobId,jobId);assert.equal(visible.result.grant_token,undefined);
 assert.ok((await send({kind:'WEBSITE',action:'INSPECT',payload:{jobId}},{...web,tab:{id:8}})).error);
 assert.equal((await send({kind:'WEBSITE',action:'STOP',payload:{jobId}},web)).result.state,'stopped');
 assert.equal(store.session,undefined);
 // The website's explicit consent can replace the optional popup approval.
 const approved=await send({kind:'WEBSITE',action:'PAIR',payload:{jobId,code:'y'.repeat(40),apiOrigin:'http://127.0.0.1:8000',approved:true}},web);
 assert.equal(approved.result.state,'extension_ready');assert.equal(store.session.websiteTabId,7);assert.equal(store.pending,undefined);
});
