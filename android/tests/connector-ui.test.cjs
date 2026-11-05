const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),path=require('node:path');const{chromium,webkit}=require('playwright');const assets=path.resolve(__dirname,'../app/src/main/assets');
async function open(t,language='zh-CN',pairing=false,v2=false,healthOnline=true,fakeClock=false,fixtureOptions={}){const browser=await (process.env.BROWSER==='webkit'?webkit:chromium).launch({headless:true,...(process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE&&process.env.BROWSER==='webkit'?{executablePath:process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE}:{})});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:363,height:800},isMobile:true,hasTouch:true});if(fakeClock)await page.clock.install();const errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));await page.route('http://phone.test/**',route=>{let name=new URL(route.request().url()).pathname.slice(1)||'phone.html';const file=name==='language.js'&&language==='en'?path.resolve(assets,'../../en/assets/language.js'):path.join(assets,name);return route.fulfill({body:fs.readFileSync(file),contentType:name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':name.endsWith('.svg')?'image/svg+xml':'text/html'});});
 await page.addInitScript(({pairing,v2,healthOnline,fixtureOptions})=>{
  const ok=data=>JSON.stringify({ok:true,data});window.AgentBridge={state:()=>ok({machines:[],tasks:[],deletedTasks:[]}),studioOverview:()=>ok({model:{ready:!!fixtureOptions.modelReady},modelSettings:{enabled:false},machines:[],tasks:[],memories:[],messages:[],report:{completed:[],ongoing:[],suggestions:[]},reportHistory:[]}),getTtsStatus:()=>ok({recognitionAvailable:true,ready:true}),startConversationAudio:()=>{window.callStarts=(window.callStarts||0)+1;return ok({});},stopConversationAudio:()=>ok({})};
  const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',op='33333333-3333-4333-8333-333333333333';let seq=0,failed=false;const jobs=new Map();window.connectorCalls=[];window.approve=false;window.operationDone=false;window.healthOnline=healthOnline;window.connectionFixture={kind:"webrtc",state:"connecting",path:"unknown"};
  let state={paired:!pairing,pending:false,computer:{id:'computer-fixture',name:'Fixture Mac'},endpoint:'https://127.0.0.1:7446',usbDevelopment:!v2,transport:v2?"webrtc":"https",pendingRequests:[]};
  window.switchComputer=id=>{state.computer={...state.computer,id};};
  window.seedPending=()=>{state.pendingRequests=[{computerId:state.computer.id,sessionId:id,requestId:'44444444-4444-4444-8444-444444444444',operationId:op,status:'running',text:'Preserved pending reply'}];};
  const session={id,title:'Fixture Codex session',agent:'codex',projectPath:'/fixture/project',status:'idle',canReply:true};if(fixtureOptions.twoReplyable)window.sharedSessions=[session,{...session,id:other,title:'Second assistant'}];
  window.ConnectorBridge={connection:()=>JSON.stringify(window.connectionFixture),pairingJob:()=>0,scan:()=>window.phoneConnector.nativeEvent('camera_denied',0),begin:(action,raw)=>{const args=JSON.parse(raw);window.connectorCalls.push({action,args});let data={};
   if(action==='state')data=state;
   if(action==='setPairingNetworkCompatibility'){state={...state,pairingNetworkCompatibility:args.enabled};data=state;}
   if(action==='setNetworkCompatibility'){if(window.failSetting){const n=++seq;jobs.set(n,{state:'done',result:{ok:false,error:'fixture save failed'}});return JSON.stringify({ok:true,id:n});}state={...state,networkCompatibility:args.enabled};data=state;}
   if(action==='pair'){state={...state,paired:false,pending:true,pairingEndpoint:state.endpoint,confirmationCode:'123456'};data=state;}
   if(action==='pollPair'){if(window.approve)state={...state,paired:true,pending:false,pairingStatus:'approved'};data=state;}
   if(action==='status'&&window.healthError){const n=++seq;jobs.set(n,{state:'done',result:{ok:false,...window.healthError}});return JSON.stringify({ok:true,id:n});}
   if(action==='status'&&window.restoreNativeOnHealth&&window.healthOnline)window.connectionFixture={kind:'webrtc',state:'connected',path:'relay'};
   if(action==='status')data={computer:state.computer,online:window.healthOnline,capabilities:['codex.sessions.read','codex.sessions.reply']};
   if(action==='sessions')data={sessions:window.emptySessions?[]:(window.sharedSessions||[session,{...session,id:other,title:'Running session',canReply:false,status:'running'}]),hasMore:true};
   if(action==='session')data={session:window.sharedSessions?.find(item=>item.id===args.sessionId)||(args.sessionId===id?session:{...session,id:other,title:'Running session',canReply:false,status:'running'}),messages:[{id:'m1',role:'assistant',text:'Exact original <img src=bad> output'}],hasMore:false};
   if(action==='send'){state.pendingRequests=[{...args,status:'unknown'}];if(!failed){failed=true;const n=++seq;jobs.set(n,{state:'done',result:{ok:false,error:'fixture connection lost'}});return JSON.stringify({ok:true,id:n});}data={operation:{id:op,sessionId:id,status:'queued'}};state.pendingRequests=[{...args,operationId:op,status:'queued'}];}
   if(action==='operation'){data={operation:{id:op,sessionId:id,status:window.operationDone?'completed':'running'}};if(window.operationDone)state.pendingRequests=[];}
   if(action==='forget')data=state={paired:false,pending:false};
   const n=++seq;jobs.set(n,{state:'done',result:{ok:true,data:structuredClone(data)}});return JSON.stringify({ok:true,id:n});},result:n=>{const value=jobs.get(n);if(window.holdOperation&&value?.result?.data?.operation||window.holdSetting&&value?.result?.data?.networkCompatibility!==undefined)return JSON.stringify({state:'running'});jobs.delete(n);return JSON.stringify(value||{state:'missing'});}};
 },{pairing,v2,healthOnline,fixtureOptions});await page.goto('http://phone.test/phone.html');await page.locator('#busy').waitFor({state:'hidden'});return page;}
for(const language of ['zh-CN','en'])test(`connector approval and public sessions ${language}`,async t=>{const page=await open(t,language,true);await page.locator('#openConnector').click();await page.locator('#connectorScan').click();await page.waitForFunction(()=>document.getElementById('connectorStatus').textContent.includes('permission')||document.getElementById('connectorStatus').textContent.includes('权限'));await page.locator('#connectorSettings > summary').click();await page.locator('#connectorImport summary').click();await page.locator('#connectorUri').fill('agentbridge://pair?fixture-secret');await page.locator('#connectorImportButton').click();await page.locator('#connectorPairCode').waitFor({state:'visible'});assert.equal(await page.locator('#connectorUri').inputValue(),'');assert.match(await page.locator('#connectorPairCode').innerText(),/123456/);assert.equal(await page.locator('#connectorSessions button').count(),0,'no access before desktop approval');await page.evaluate(()=>window.approve=true);await page.locator('#connectorSessions button').first().waitFor();assert.match(await page.locator('#connectorSessions button').first().innerText(),/空闲.*可回复|Idle.*Reply available/);assert.match(await page.locator('#connectorSessions button').nth(1).innerText(),/运行中.*只读|Running.*Read only/);assert.match(await page.locator('#connectorCount').innerText(),/记录已截断|Records are truncated/);await page.locator('#connectorSessions button').first().click();await page.getByText('Exact original <img src=bad> output',{exact:true}).waitFor();assert.equal(await page.locator('#connectorMessages img').count(),0);assert.match(await page.locator('#connectorDiagnostics').textContent(),/USB/);assert.equal(await page.locator('#connectorGuide').isVisible(),false);if(process.env.CONNECTOR_ARTIFACT_DIR&&language==='zh-CN'){fs.mkdirSync(process.env.CONNECTOR_ARTIFACT_DIR,{recursive:true});for(const width of [363,430]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(process.env.CONNECTOR_ARTIFACT_DIR,`connector-${width}.png`)});}}assert.equal(await page.locator('#connectorSheet [type=hidden]').count(),0);await page.locator('#connectorSessions button').nth(1).click();assert.equal(await page.locator('#connectorSend').isDisabled(),true);assert.ok(await page.locator('#connectorBackdrop').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.locator('[data-close=connectorBackdrop]').click();assert.equal(await page.locator('#connectorBackdrop').isVisible(),false);assert.equal(await page.locator('#openConnector').isVisible(),true);});
test('unknown sends retry the exact UUID/body and operation completion stays separate from task completion',async t=>{const page=await open(t);await page.locator('#openConnector').click();await page.locator('#connectorSessions button').first().click();await page.locator('#connectorReply').fill('Reply to the selected fixture only');await page.locator('#connectorSend').click();await page.getByText('fixture connection lost',{exact:true}).waitFor();assert.match(await page.locator('#connectorOperation').innerText(),/结果未知/);await page.locator('#connectorRefresh').click();await page.locator('#connectorSend').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('connectorSend').disabled);await page.locator('#connectorSend').click();await page.waitForFunction(()=>window.connectorCalls.filter(c=>c.action==='send').length===2);const sends=await page.evaluate(()=>window.connectorCalls.filter(c=>c.action==='send').map(c=>c.args));assert.deepEqual(sends[0],sends[1]);assert.match(sends[0].requestId,/^[a-f0-9-]{36}$/);assert.equal(sends[0].computerId,'computer-fixture');await page.evaluate(()=>window.operationDone=true);await page.waitForFunction(()=>document.getElementById('connectorOperation').textContent.includes('不代表整体任务完成'));assert.equal(await page.locator('#connectorReply').inputValue(),'');assert.equal(await page.evaluate(()=>window.connectorCalls.filter(c=>c.action==='send').length),2,'polling never sends a new message');});

test('native pairing defers behind SSH sheet without losing its draft',async t=>{const page=await open(t);await page.locator('#openAppearance').click();await page.locator('#connectionAdvanced > summary').click();await page.locator('#openAdd').click();await page.locator('#machineAdvanced > summary').click();await page.locator('#machineName').fill('Unsubmitted SSH office draft');await page.evaluate(()=>{const id=JSON.parse(ConnectorBridge.begin('pair',JSON.stringify({uri:'fixture'}))).id;phoneConnector.nativeEvent('pairing',id);});assert.equal(await page.locator('#machineBackdrop').isVisible(),true);assert.equal(await page.locator('#connectorBackdrop').isVisible(),false);assert.equal(await page.locator('#machineName').inputValue(),'Unsubmitted SSH office draft');await page.locator('[data-close=machineBackdrop]').click();await page.locator('#openConnector').click();await page.locator('#connectorPairCode').waitFor({state:'visible'});assert.match(await page.locator('#connectorPairCode').innerText(),/123456/);});
test('WSS/ICE state alone is never online; direct and relay labels use native selected-pair stats',async t=>{const page=await open(t,'zh-CN',false,true,false);await page.locator('#openConnector').click();await page.waitForFunction(()=>document.getElementById('connectorStatus').textContent.includes('离线'));await page.evaluate(()=>window.connectionFixture={kind:'webrtc',state:'connected',path:'direct'});await page.waitForTimeout(2200);assert.ok(!(await page.locator('#connectorStatus').innerText()).includes('连接正常'),'socket/ICE alone does not become online');await page.evaluate(()=>window.healthOnline=true);await page.locator('#connectorRefresh').click();await page.waitForFunction(()=>document.getElementById('connectorDiagnostics').textContent.includes('WebRTC 实际直连'));await page.evaluate(()=>window.connectionFixture.path='relay');await page.waitForFunction(()=>document.getElementById('connectorDiagnostics').textContent.includes('TURN 实际中继'));await page.evaluate(()=>window.connectionFixture.state='disconnected');await page.waitForFunction(()=>document.getElementById('connectorStatus').textContent.includes('已断开'));assert.equal(await page.locator('#connectorSend').isDisabled(),true);});

for(const lang of ['zh-CN','en'])test(`compatibility switch is explicit, reversible and never replays ${lang}`,async t=>{const page=await open(t,lang,false,true);await page.locator('#openConnector').click();await page.locator('#connectorSessions button').first().click();await page.locator('#connectorReply').fill('Preserved original draft');await page.evaluate(()=>window.holdSetting=true);await page.locator('#connectorSettings > summary').click();await page.locator('#connectorCompatibility').check();assert.equal(await page.locator('#connectorCompatibility').isDisabled(),true);await page.evaluate(()=>window.holdSetting=false);await page.waitForFunction(()=>!document.getElementById('connectorCompatibility').disabled);assert.equal(await page.locator('#connectorReply').inputValue(),'Preserved original draft');assert.equal(await page.locator('#connectorSend').isDisabled(),true);assert.equal(await page.evaluate(()=>window.connectorCalls.filter(c=>c.action==='send').length),0);let calls=await page.evaluate(()=>window.connectorCalls);assert.equal(calls.at(-1).action,'setNetworkCompatibility');assert.deepEqual(calls.at(-1).args,{computerId:'computer-fixture',enabled:true});await page.evaluate(()=>window.failSetting=true);await page.locator('#connectorCompatibility').click();await page.getByText('fixture save failed',{exact:true}).waitFor();assert.equal(await page.locator('#connectorCompatibility').isChecked(),true);await page.evaluate(()=>window.failSetting=false);await page.locator('#connectorCompatibility').uncheck();await page.waitForFunction(()=>!document.getElementById('connectorCompatibility').disabled);assert.equal(await page.locator('#connectorCompatibility').isChecked(),false);assert.equal(await page.locator('#connectorReply').inputValue(),'Preserved original draft');});

for(const inflight of [false,true])test(`compatibility invalidates ${inflight?'in-flight completed':'sleeping'} operation polling`,async t=>{const page=await open(t,'zh-CN',false,true);await page.evaluate(()=>{window.seedPending();});await page.locator('#openConnector').click();if(inflight)await page.evaluate(()=>{window.holdOperation=true;window.operationDone=true;});await page.locator('#connectorSessions button').first().click();if(inflight)await page.waitForFunction(()=>window.connectorCalls.some(c=>c.action==='operation'));await page.locator('#connectorSettings > summary').click();await page.locator('#connectorCompatibility').check();await page.waitForFunction(()=>!document.getElementById('connectorCompatibility').disabled);const before=await page.evaluate(()=>window.connectorCalls.length);await page.evaluate(()=>window.holdOperation=false);await page.waitForTimeout(1900);const after=await page.evaluate(()=>window.connectorCalls.slice(0));assert.equal(after.length,before,'old poll makes no new request or completed-session load');assert.equal(after.filter(c=>c.action==='send').length,0);assert.equal(await page.locator('#connectorReply').inputValue(),'Preserved pending reply');assert.equal(await page.locator('#connectorReply').getAttribute('readonly'),'');const statusBefore=after.filter(c=>c.action==='status').length;await page.locator('#connectorRefresh').click();await page.waitForFunction(n=>window.connectorCalls.filter(c=>c.action==='status').length>n,statusBefore);assert.equal(await page.evaluate(()=>window.connectorCalls.filter(c=>c.action==='send').length),0);});

for(const language of ['zh-CN','en'])test(`connection page guides one next step and hides advanced settings ${language}`,async t=>{
 const page=await open(t,language,true,true);
 async function capture(name){if(!process.env.CONNECTOR_ARTIFACT_DIR)return;fs.mkdirSync(process.env.CONNECTOR_ARTIFACT_DIR,{recursive:true});for(const width of [363,430]){await page.setViewportSize({width,height:800});await page.locator('.connectorSheet').evaluate(e=>e.scrollTop=0);await page.screenshot({path:path.join(process.env.CONNECTOR_ARTIFACT_DIR,`simple-${language}-${name}-${width}.png`)});}await page.setViewportSize({width:363,height:800});}
 await page.locator('#openConnector').click();
 await page.waitForFunction(()=>!document.getElementById('connectorScan').disabled);
 assert.equal(await page.locator('#connectorGuide').isVisible(),true);
 assert.equal(await page.locator('#connectorScan').isVisible(),true);
 for(const id of ['connectorSessionList','connectorRefresh','connectorCompatibility','connectorUri','connectorForget'])assert.equal(await page.locator('#'+id).isVisible(),false,id+' is not a first-use decision');
 await capture('first-use');
 const scan=await page.locator('#connectorScan').boundingBox();assert.ok(scan.y+scan.height<800,'scan action is visible without scrolling');
 await page.locator('#connectorSettings > summary').click();await page.locator('#connectorImport > summary').click();
 await page.locator('#connectorUri').fill('agentbridge://pair?fixture');await page.locator('#connectorImportButton').click();
 await page.locator('#connectorPairCode').waitFor({state:'visible'});
 assert.equal(await page.locator('#connectorPairCode').innerText(),'123456');
 assert.equal(await page.locator('#connectorGuide').isVisible(),false);
 assert.equal(await page.locator('#connectorScan').isVisible(),false);
 assert.equal(await page.locator('#connectorNext').isVisible(),true);
 assert.equal(await page.locator('#connectorSessionList').isVisible(),false);
 await page.locator('#connectorSettings > summary').click();
 await capture('approval');
 await page.evaluate(()=>{window.approve=true;window.emptySessions=true;});
 await page.locator('#connectorSessionList').waitFor({state:'visible'});
 assert.equal(await page.locator('#connectorComputer').innerText(),'Fixture Mac');
 assert.equal(await page.locator('#connectorGuide').isVisible(),false);
 assert.equal(await page.locator('#connectorCompatibility').isVisible(),false);
 assert.match(await page.locator('#connectorCount').innerText(),/暂无已授权|No shared sessions/);
 await capture('empty-connected');
 await page.evaluate(()=>{window.healthOnline=false;});await page.locator('#connectorRefresh').click();
 await page.waitForFunction(()=>!document.getElementById('connectorRefresh').disabled);
 assert.equal(await page.locator('#connectorSessionList').isVisible(),false,'offline state does not expose a stale clickable list');
 assert.equal(await page.locator('#connectorNext').isVisible(),true);
 assert.match(await page.locator('#connectorRefresh').innerText(),/重新连接|Reconnect/);
 assert.equal(await page.evaluate(()=>window.connectorCalls.filter(c=>c.action==='send').length),0);
 await page.locator('#connectorSettings > summary').click();await page.locator('#connectorForget').click();
 await page.locator('#connectorGuide').waitFor({state:'visible'});
 assert.equal(await page.locator('#connectorScan').isVisible(),true);
 assert.equal(await page.locator('#connectorSessionList').isVisible(),false);
});

test('pairing compatibility is explicit before scanning and sends no network request',async t=>{const page=await open(t,'zh-CN',true);await page.locator('#openConnector').click();await page.locator('#connectorSettings > summary').click();assert.equal(await page.locator('#connectorPairingCompatibility').isChecked(),false);await page.locator('#connectorPairingCompatibility').check();await page.waitForFunction(()=>!document.getElementById('connectorPairingCompatibility').disabled);assert.equal(await page.locator('#connectorPairingCompatibility').isChecked(),true);const calls=await page.evaluate(()=>window.connectorCalls);assert.deepEqual(calls.filter(c=>c.action==='setPairingNetworkCompatibility').map(c=>c.args),[{enabled:true}]);assert.equal(calls.some(c=>['pair','send'].includes(c.action)),false);});


test('foreground RTC renewal reconnects with reads and preserves the draft without replay',async t=>{
 const page=await open(t,'zh-CN',false,true,true,true);
 await page.locator('#openConnector').click();
 await page.locator('#connectorSessions button').first().click();
 await page.locator('#connectorReply').fill('Preserve during lease renewal');
 await page.evaluate(()=>{window.restoreNativeOnHealth=true;window.connectionFixture={kind:'webrtc',state:'disconnected',path:'unknown'};});
 await page.clock.runFor(6500);
 await page.waitForFunction(()=>window.connectorCalls.filter(c=>c.action==='status').length>=2);
 assert.match(await page.locator('#connectorStatus').innerText(),/电脑连接正常/);
 assert.equal(await page.locator('#connectorReply').inputValue(),'Preserve during lease renewal');
 const calls=await page.evaluate(()=>window.connectorCalls);
 assert.equal(calls.filter(c=>['send','pair','pollPair'].includes(c.action)).length,0);
 await page.locator('[data-close=connectorBackdrop]').click();
 await page.clock.runFor(22000);
 assert.ok(await page.evaluate(n=>window.connectorCalls.length>n,calls.length),'town keeps approved employees current');
 await page.locator('[data-view=public]').click();
 const before=await page.evaluate(()=>window.connectorCalls.length);
 await page.clock.runFor(90000);
 assert.equal(await page.evaluate(()=>window.connectorCalls.length),before,'unrelated view does not reconnect or heartbeat');
});

test('foreground RTC recovery stops on revoked authorization and requires manual retry',async t=>{
 const page=await open(t,'zh-CN',false,true,true,true);
 await page.locator('#openConnector').click();
 await page.evaluate(()=>{window.healthError={code:'authorization_failed',error:'fixture authorization revoked'};window.connectionFixture={kind:'webrtc',state:'disconnected',path:'unknown'};});
 await page.clock.runFor(6500);
 await page.getByText('fixture authorization revoked',{exact:true}).waitFor();
 const before=await page.evaluate(()=>window.connectorCalls.length);
 await page.clock.runFor(90000);
 assert.equal(await page.evaluate(()=>window.connectorCalls.length),before);
 assert.equal(await page.locator('#connectorSend').isDisabled(),true);
});

test('foreground RTC heartbeat detects silent outage and backs off without sending',async t=>{
 const page=await open(t,'zh-CN',false,true,true,true);await page.locator('#openConnector').click();
 await page.evaluate(()=>{window.connectionFixture={kind:'webrtc',state:'connected',path:'relay'};window.healthError={code:'rtc_timeout',error:'fixture silent outage'};});
 await page.clock.runFor(22000);
 await page.getByText('fixture silent outage',{exact:true}).waitFor();
 await page.clock.runFor(90000);
 const calls=await page.evaluate(()=>window.connectorCalls);
 const probes=calls.filter(c=>c.action==='status').length;
 assert.ok(probes>=4&&probes<=10,'retries back off with a 30 second cap; observed '+probes);
 assert.equal(calls.filter(c=>c.action==='send').length,0);
 await page.evaluate(()=>{delete window.healthError;});
 await page.clock.runFor(34000);
 assert.match(await page.locator('#connectorStatus').innerText(),/电脑连接正常/);
});

for(const language of ['zh-CN','en'])test(`QR employees and desktop butler need no phone model ${language}`,async t=>{
 const page=await open(t,language);
 await page.waitForFunction(()=>document.querySelectorAll('.employee[data-source=desktop]').length===2);
 assert.match(await page.locator('#taskCount').textContent(),/2/);
 assert.equal(await page.locator('.emptyTown').count(),0);
 const entry=page.locator('#openTownButler'), box=await entry.boundingBox();
 assert.ok(box.y+box.height<(await page.locator('.connectorOffice').boundingBox()).y,'paired employees stay below the chat shortcut');
 await entry.click();
 await page.waitForFunction(()=>document.getElementById('piMessages').textContent.includes('Exact original'));
 assert.equal(await page.locator('#butlerSource').inputValue(),'11111111-1111-4111-8111-111111111111');
 assert.equal(await page.locator('#piMeta').textContent(),'Fixture Mac');
 assert.equal(await page.locator('#piMessages img').count(),0);
 assert.equal(await page.locator('#butlerPlanDetails').isVisible(),false);
 assert.equal(await page.locator('#startCall').isVisible(),true);
 const readingHeight=await page.locator('#piMessages').evaluate(e=>e.clientHeight);
 assert.ok(readingHeight>=440,'the paired conversation should use most of a 363 × 800 screen: '+readingHeight);
 await page.locator('#startCall').click();
 assert.equal(await page.locator('#startCall').getAttribute('aria-expanded'),'true');
 await page.locator('#desktopCallContinue').click();
 assert.equal(await page.locator('#cloudBackdrop').isVisible(),true);
 await page.locator('#cloudBackdrop [data-close]').click();
 assert.equal(await page.locator('#butlerSource').inputValue(),'11111111-1111-4111-8111-111111111111');
 assert.equal(await page.evaluate(()=>window.callStarts||0),0);
 await page.locator('#piInput').fill('Use the approved computer conversation');
 assert.equal(await page.locator('#sendPi').isEnabled(),true);
 assert.equal(await page.evaluate(()=>window.connectorCalls.some(c=>['pair','send'].includes(c.action))),false);
 if(process.env.CONNECTOR_ARTIFACT_DIR){
  fs.mkdirSync(process.env.CONNECTOR_ARTIFACT_DIR,{recursive:true});
  for(const width of [363,430]){
   await page.setViewportSize({width,height:850});
   await page.screenshot({path:path.join(process.env.CONNECTOR_ARTIFACT_DIR,`town-butler-${language}-${width}.png`)});
   await page.locator('[data-view=offices]').click();
   for(const scene of ['floors','map','workstations']){
    await page.locator('#openAppearance').click();await page.locator(`[data-scene-choice=${scene}]`).click();await page.locator('[data-close=appearanceBackdrop]').click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),scene+' fits screen');
    await page.screenshot({path:path.join(process.env.CONNECTOR_ARTIFACT_DIR,`town-${scene}-${language}-${width}.png`)});
   }
   await page.locator('[data-view=butler]').click();
  }
 }
});

test('calling from a desktop chat requires an explicit switch and preserves the desktop draft',async t=>{
 const page=await open(t,'zh-CN',false,false,true,false,{modelReady:true});
 await page.locator('[data-view=butler]').click();
 await page.waitForFunction(()=>document.getElementById('piMessages').textContent.includes('Exact original')&&!document.getElementById('butlerSource').disabled);
 const draft='Keep this desktop draft';
 await page.locator('#piInput').fill(draft);
 await page.locator('#startCall').click();
 assert.equal(await page.evaluate(()=>window.callStarts||0),0);
 await page.locator('#desktopCallCancel').click();
 assert.equal(await page.locator('#piInput').inputValue(),draft);
 await page.locator('#startCall').click();
 await page.locator('#desktopCallContinue').click();
 assert.equal(await page.locator('#callBackdrop').isVisible(),true);
 assert.equal(await page.evaluate(()=>window.callStarts),1);
 await page.locator('#callEnd').click();
 assert.equal(await page.locator('#butlerSource').inputValue(),'phone');
 assert.equal(await page.locator('#piInput').inputValue(),'');
 await page.locator('#butlerSource').selectOption('11111111-1111-4111-8111-111111111111');
 assert.equal(await page.locator('#piInput').inputValue(),draft);
 assert.equal(await page.evaluate(()=>window.connectorCalls.some(c=>c.action==='send')),false);
});

test('desktop butler sends through the shared outbox and blocks a new POST after an unknown result',async t=>{
 const page=await open(t);await page.locator('[data-view=butler]').click();
 await page.waitForFunction(()=>document.getElementById('piMessages').textContent.includes('Exact original'));
 await page.locator('#piInput').fill('One request from the butler');await page.locator('#sendPi').click();
 await page.waitForFunction(()=>document.getElementById('connectionHint').textContent.includes('fixture connection lost'));
 assert.equal(await page.locator('#piInput').inputValue(),'One request from the butler','unknown send keeps the draft');
 await page.locator('#butlerActions > summary').click();
 await page.locator('#refreshButler').click();
 await page.waitForFunction(()=>!document.getElementById('butlerSource').disabled);
 await page.locator('#piInput').fill('Do not send this as a second request');
 assert.equal(await page.locator('#sendPi').isDisabled(),true);
 assert.equal(await page.evaluate(()=>window.connectorCalls.filter(c=>c.action==='send').length),1);
 const sent=await page.evaluate(()=>window.connectorCalls.find(c=>c.action==='send').args);
 assert.equal(sent.text,'One request from the butler');assert.equal(sent.computerId,'computer-fixture');
 assert.equal(sent.sessionId,'11111111-1111-4111-8111-111111111111');
 await page.locator('#checkButlerModel').click();
 await page.waitForFunction(()=>!document.getElementById('connectorSend').disabled);
 await page.locator('#connectorSend').click();
 await page.waitForFunction(()=>window.connectorCalls.filter(c=>c.action==='send').length===2);
 assert.deepEqual(await page.evaluate(()=>window.connectorCalls.filter(c=>c.action==='send').map(c=>c.args)),[sent,sent]);
 await page.evaluate(()=>window.operationDone=true);
 await page.waitForFunction(()=>document.getElementById('connectorOperation').textContent.includes('不代表整体任务完成'));
});

test('read-only assistant and optional phone model are distinct choices',async t=>{
 const page=await open(t);await page.locator('[data-view=butler]').click();
 await page.waitForFunction(()=>document.getElementById('piMessages').textContent.includes('Exact original'));
 await page.locator('#butlerSource').selectOption('22222222-2222-4222-8222-222222222222');
 await page.waitForFunction(()=>!document.getElementById('butlerSource').disabled);
 await page.locator('#piInput').fill('Read only stays read only');
 assert.equal(await page.locator('#sendPi').isDisabled(),true);
 assert.match(await page.locator('#connectionHint').textContent(),/当前会话只读/);
 await page.locator('#butlerActions > summary').click();
 await page.getByRole('button',{name:'手机模型',exact:true}).click();
 await page.getByRole('button',{name:'自定义模型',exact:true}).waitFor();
 await page.getByRole('button',{name:'关闭模型设置',exact:true}).click();
 assert.equal(await page.locator('#butlerSource').inputValue(),'22222222-2222-4222-8222-222222222222');
 await page.locator('#butlerSource').selectOption('phone');
 assert.equal(await page.locator('#butlerPlanDetails').isVisible(),true);
 assert.match(await page.locator('#piMeta').textContent(),/模型未连接/);
 await page.locator('#butlerActions > summary').click();
 await page.locator('#openCloudFromButler').click();assert.equal(await page.locator('#cloudBackdrop').isVisible(),true);
 assert.equal(await page.evaluate(()=>window.connectorCalls.some(c=>c.action==='send')),false);
 await page.reload();await page.locator('#busy').waitFor({state:'hidden'});
 await page.locator('[data-view=butler]').click();
 await page.waitForFunction(()=>document.getElementById('butlerSource').value==='phone');
});

test('several replyable assistants require a choice and removed scope cannot be used',async t=>{
 const page=await open(t,'zh-CN',false,false,true,false,{twoReplyable:true});
 await page.waitForFunction(()=>window.phoneConnector.snapshot().sessions.length===2);
 await page.locator('[data-view=butler]').click();
 assert.equal(await page.locator('#butlerSource').inputValue(),'');
 await page.locator('#piInput').fill('Choose before sending');assert.equal(await page.locator('#sendPi').isDisabled(),true);
 await page.locator('#butlerSource').selectOption('11111111-1111-4111-8111-111111111111');
 await page.waitForFunction(()=>!document.getElementById('butlerSource').disabled);
 await page.evaluate(async()=>{window.emptySessions=true;await phoneConnector.refreshTown();});
 assert.equal(await page.locator('#butlerSource').inputValue(),'');assert.equal(await page.locator('#sendPi').isDisabled(),true);
 assert.equal(await page.evaluate(async()=>{try{await phoneConnector.sendTown('11111111-1111-4111-8111-111111111111','stale');return false}catch{return true}}),true);
 assert.equal(await page.evaluate(()=>window.connectorCalls.some(c=>c.action==='send')),false);
 await page.locator('[data-view=offices]').click();assert.equal(await page.locator('.employee[data-source=desktop]').count(),0);
 assert.match(await page.locator('.connectorOffice').textContent(),/还没有发现电脑会话/);
 await page.locator('#openConnector').click();await page.locator('#connectorSettings > summary').click();await page.locator('#connectorForget').click();
 await page.locator('#connectorGuide').waitFor({state:'visible'});await page.locator('[data-close=connectorBackdrop]').click();
 assert.equal(await page.locator('.connectorOffice').count(),0);
 await page.locator('[data-view=butler]').click();assert.equal(await page.locator('#butlerSourceRow').isVisible(),false);
 assert.match(await page.locator('#piMessages').textContent(),/连接电脑，直接和助手聊聊/);
});


test('assistant selections and drafts stay bound to each computer and conversation',async t=>{
 const page=await open(t,'zh-CN',false,false,true,false,{twoReplyable:true});
 await page.waitForFunction(()=>window.phoneConnector.snapshot().sessions.length===2);
 await page.locator('[data-view=butler]').click();
 await page.locator('#butlerSource').selectOption('11111111-1111-4111-8111-111111111111');
 await page.waitForFunction(()=>!document.getElementById('butlerSource').disabled);
 await page.locator('#piInput').fill('Draft for the first assistant');
 await page.locator('#butlerSource').selectOption('22222222-2222-4222-8222-222222222222');
 await page.waitForFunction(()=>!document.getElementById('butlerSource').disabled);
 assert.equal(await page.locator('#piInput').inputValue(),'');
 await page.locator('#piInput').fill('Draft for the second assistant');
 await page.locator('#butlerSource').selectOption('11111111-1111-4111-8111-111111111111');
 await page.waitForFunction(()=>!document.getElementById('butlerSource').disabled);
 assert.equal(await page.locator('#piInput').inputValue(),'Draft for the first assistant');
 await page.evaluate(async()=>{window.switchComputer('another-computer');await phoneConnector.refreshTown();});
 assert.equal(await page.locator('#butlerSource').inputValue(),'');
 assert.equal(await page.locator('#piInput').inputValue(),'');
 await page.evaluate(async()=>{window.switchComputer('computer-fixture');await phoneConnector.refreshTown();});
 await page.waitForFunction(()=>!document.getElementById('butlerSource').disabled);
 assert.equal(await page.locator('#butlerSource').inputValue(),'11111111-1111-4111-8111-111111111111');
 assert.equal(await page.locator('#piInput').inputValue(),'Draft for the first assistant');
 assert.equal(await page.evaluate(()=>window.connectorCalls.some(c=>c.action==='send')),false);
});
