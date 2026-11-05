import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {AutomationRunner} from '../modules/automation-runner.js';
const origin='https://sipora.polije.ac.id';
const data=new TextEncoder().encode('%PDF-fixture');
const file={key:'abstract',filename:'Abstract.pdf',mime_type:'application/pdf',size:data.length,sha256:createHash('sha256').update(data).digest('hex')};
const pack={job_id:'job_test',files:[file,{...file,key:'chapter_1'},{...file,key:'full_report'},{...file,key:'references'}]};
function harness(responses){
 let session={jobId:'job_test',apiOrigin:'http://127.0.0.1:8000',grant_token:'grant',expires_at:new Date(Date.now()+900000).toISOString(),state:'extension_ready'};
 const tasks=[],sent=[],fetched=[];
 globalThis.chrome={tabs:{query:async()=>[{id:7,url:origin+'/cgi/users/home?eprintid=61189',active:true}],get:async()=>({url:origin+'/cgi/users/home?eprintid=61189'}),sendMessage:async(id,message)=>{sent.push(message);return message.kind==='SIPORA_UPLOAD'?{result:{state:'upload_in_progress',message:'uploaded'}}:{result:responses.shift()};}}};
 globalThis.fetch=async(url,options)=>{fetched.push({url,options});return {ok:true,headers:{get:()=> 'application/pdf'},json:async()=>pack,arrayBuffer:async()=>data.buffer};};
 const runner=new AutomationRunner({config:{siporaOrigin:origin},read:async()=>session,write:async(key,value)=>{session=value;},schedule:task=>tasks.push(task)});
 return {runner,tasks,sent,fetched,get session(){return session;},set session(value){session=value;}};
}
test('worker persists navigation checkpoint, uploads one file and resumes to review',async()=>{
 const h=harness([{state:'upload_in_progress',needFile:'abstract',checkpoint:{itemId:'61189'}},{state:'upload_completed',navigation:true,completed_files:4,checkpoint:{phase:'metadata'}},{state:'metadata_review',navigation:true,checkpoint:{phase:'subjects'}},{state:'final_confirmation',stop:true,checkpoint:{phase:'review'}}]);
 const status=await h.runner.start(h.session);assert.equal(status.state,'running');assert.equal(h.tasks.length,1);
 await h.tasks.shift()();assert.equal(h.session.flow.itemId,'61189');assert.equal(h.session.flow.phase,'metadata');assert.equal(h.session.flow.uploadIntent,null);
 assert.equal(h.sent.filter(message=>message.kind==='SIPORA_UPLOAD').length,1);
 assert.equal(h.fetched.filter(req=>req.url.includes('/extension-files/')).length,1);
 await h.runner.advance(7);assert.equal(h.session.flow.phase,'subjects');
 await h.runner.advance(7);assert.equal(h.session.state,'final_confirmation');assert.equal(h.session.autoRun,false);
});
test('repeated Start while running does not enqueue a second run',async()=>{
 const h=harness([]);await h.runner.start(h.session);const runId=h.session.runId;await h.runner.start(h.session);
 assert.equal(h.tasks.length,1);assert.equal(h.session.runId,runId);
});
test('ambiguous upload is never blindly sent again after a restart',async()=>{
 const h=harness([{state:'upload_in_progress',needFile:'abstract',checkpoint:{itemId:'61189'}}]);
 await h.runner.start(h.session);h.session={...h.session,flow:{phase:'files',itemId:'61189',uploadIntent:'abstract'}};
 await h.tasks.shift()();assert.equal(h.session.autoRun,false);assert.match(h.session.message,/tidak mengulangi/);assert.equal(h.sent.filter(message=>message.kind==='SIPORA_UPLOAD').length,0);
});
test('start refuses to resume a checkpoint on a different draft',async()=>{
 const h=harness([]);h.session={...h.session,flow:{phase:'metadata',itemId:'999'}};
 await assert.rejects(h.runner.start(h.session),/draft yang terikat/);assert.equal(h.tasks.length,0);
});
test('an old run cannot restore a session after Stop',async()=>{
 const h=harness([]);await h.runner.start(h.session);const previous=h.session;h.session=undefined;
 assert.equal(await h.runner.update(previous,{state:'running'}),null);assert.equal(h.session,undefined);
});


test('upload reload keeps the intent checkpoint until the server list is verified',async()=>{
 const h=harness([{state:'upload_in_progress',needFile:'abstract',checkpoint:{itemId:'61189'}}]);let reloads=0;
 chrome.tabs.reload=async()=>reloads++;
 const previous=chrome.tabs.sendMessage;chrome.tabs.sendMessage=async(id,message)=>message.kind==='SIPORA_UPLOAD'?{result:{navigation:true,reload:true,message:'reloading'}}:previous(id,message);
 await h.runner.start(h.session);await h.tasks.shift()();
 assert.equal(reloads,1);assert.equal(h.session.flow.uploadIntent,'abstract');assert.equal(h.session.autoRun,true);
});

test('restarting from review checks files again instead of trusting the old checkpoint',async()=>{
 const h=harness([]);h.session={...h.session,flow:{phase:'review',itemId:'61189',filesVerified:true}};
 await h.runner.start(h.session);
 assert.equal(h.session.flow.phase,'files');assert.equal(h.session.flow.filesVerified,false);assert.equal(h.session.flow.itemId,'61189');
});
