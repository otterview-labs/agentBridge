// Native APK integration with deterministic local model/OpenHands fixtures.
// Refuses non-emulator targets and an app that already has model/job data.
const http=require('node:http'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const adb=process.env.ASB_ADB || '/Users/chenhao/.local/share/android-sdk/platform-tools/adb';
const device=process.argv[2];
if(!/^emulator-\d+$/.test(device || '')) throw new Error('Pass an isolated emulator serial');
const pkg='com.otterview.agentsessionbridge.debug';
const shell=(...args)=>execFileSync(adb,['-s',device,...args],{encoding:'utf8'}).trim();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function evaluate(expression){
 const pid=shell('shell','pidof',pkg); assert.ok(/^\d+$/.test(pid));
 shell('forward','tcp:9229',`localabstract:webview_devtools_remote_${pid}`);
 const pages=await (await fetch('http://127.0.0.1:9229/json')).json();
 const page=pages.find(item=>item.url==='file:///android_asset/phone.html');assert.ok(page);
 return new Promise((resolve,reject)=>{const ws=new WebSocket(page.webSocketDebuggerUrl);
 const timer=setTimeout(()=>{ws.close();reject(new Error('Native bridge timeout'))},20000);
 ws.addEventListener('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}})));
 ws.addEventListener('message',event=>{const r=JSON.parse(event.data);if(r.id!==1)return;clearTimeout(timer);ws.close();if(r.error||r.result?.exceptionDetails)reject(new Error(JSON.stringify(r)));else resolve(r.result.result.value);});
 ws.addEventListener('error',reject);
 });
}
async function bridge(name,...args){const raw=await evaluate(`AgentBridge.${name}(${args.map(arg=>JSON.stringify(arg)).join(',')})`);const result=JSON.parse(raw);assert.equal(result.ok,true,result.error);return result.data;}
async function main(){
 const before=await bridge('managedState');assert.equal(before.jobs.length,0,'Use a fresh isolated app');
 const overview=await bridge('studioOverview');assert.equal(overview.model.ready,false,'Do not overwrite existing model config');
 await bridge('setManagedEnabled',false);
 const id='11111111-1111-4111-8111-111111111111';let sent=0,modelCalls=0,finished=false;
 const server=http.createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;
 let result;
 if(req.url==='/v1/chat/completions'){
   modelCalls++;const input=JSON.parse(body.messages.at(-1).content);assert.equal(input.goal,'Synthetic native queue check');
   const decision=input.observation.output?.includes('NATIVE_READY_482')?{action:'review',reason:'Synthetic result ready for user acceptance'}:
      {action:'reply',reason:'Within the synthetic confirmed scope',reply:'Return NATIVE_READY_482 only'};
   result={choices:[{finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(decision)}}]};
 }else if(req.url===`/api/conversations/${id}/events`&&req.method==='POST'){
   assert.equal(body.run,true);assert.equal(body.content[0].text,'Return NATIVE_READY_482 only');sent++;finished=true;result={success:true};
 }else if(req.url.includes('/events/search'))result={items:[]};
 else if(req.url.endsWith('/agent_final_response'))result={response:'NATIVE_READY_482'};
 else result={id,execution_status:finished?'finished':'idle'};
 res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;
 shell('reverse',`tcp:${port}`,`tcp:${port}`);
 try{
  await bridge('saveStudioModel',JSON.stringify({runtime:'phone',baseUrl:`http://127.0.0.1:${port}/v1`,modelId:'synthetic-model',apiKey:'synthetic-key'}));
  await bridge('saveOpenHandsConfig',JSON.stringify({endpoint:`http://127.0.0.1:${port}`,apiKey:'synthetic-server-key'}));
  await bridge('addManagedJob',JSON.stringify({backend:'openhands',conversationId:id,goal:'Synthetic native queue check',rules:'Only request the fixed marker. No files, commands or publishing.',allowReplies:true,maxReplies:1,minutes:10}));
  await bridge('setManagedEnabled',true);shell('shell','input','keyevent','KEYCODE_HOME');
  let state;
  for(let i=0;i<45;i++){await sleep(2000);state=await bridge('managedState');if(state.jobs[0].state==='review')break;}
  assert.equal(state.jobs[0].state,'review',JSON.stringify(state));assert.equal(sent,1);assert.equal(modelCalls,2);
  const persisted=JSON.parse(shell('shell','run-as',pkg,'cat','files/managed/queue.json'));
  assert.equal(persisted.jobs[0].state,'review');assert.equal(persisted.jobs[0].replyCount,1);
  assert.equal(JSON.stringify(persisted).includes('synthetic-key'),false);
  console.log('Native Android background queue: model decision -> OpenHands event -> result -> review; sent exactly once');
  await bridge('managedControl',state.jobs[0].id,'accept');
  assert.equal((await bridge('managedState')).jobs[0].state,'complete');
 }finally{await bridge('setManagedEnabled',false);shell('reverse','--remove',`tcp:${port}`);await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
