(() => {
 'use strict';
 const $=id=>document.getElementById(id),t=window.OfficeI18n.text;
 const sheet=$('connectorBackdrop'),drafts=new Map(),sends=new Map();let publicState={},selected=null,online=false,caps=[],working=false,pairPolling=false,deferredPairJob=0,connectionEpoch=0;const operationPolls=new Set();
 let recoveryArmed=false,recoveryAt=0,recoveryAttempts=0;
 let sessions=[],conversation=null,published='';
 const active=()=>!document.hidden&&(!sheet.classList.contains('hidden')||window.phoneUI?.connectorActive?.());
 function snapshot(){return {paired:!!publicState.paired&&!publicState.pending,computer:publicState.computer?{id:publicState.computer.id,name:publicState.computer.name}:null,online,busy:working,sessions:sessions.map(item=>({...item,canReply:!!item.canReply&&canSendReplies()})),conversation,pending:Array.from(sends.values()).map(item=>({computerId:item.computerId,sessionId:item.sessionId,status:item.status,text:item.text})),status:$('connectorStatus').textContent};}
 function publish(){const value=snapshot(),encoded=JSON.stringify(value);if(encoded!==published){published=encoded;window.phoneUI?.connectorChanged?.(value);}}
 const pauseRecovery=()=>{recoveryArmed=false;recoveryAt=0;recoveryAttempts=0;};
 const armRecovery=()=>{recoveryArmed=publicState.transport==='webrtc'&&publicState.paired&&!publicState.pending;recoveryAt=Date.now()+20000;recoveryAttempts=0;};
 const retryRecovery=()=>{recoveryAt=Date.now()+Math.min(30000,2000*2**Math.min(recoveryAttempts++,4));};
 function connectorError(value){const error=new Error(value.error||t('连接器操作失败'));error.code=value.code;return error;}
 const status=text=>{$('connectorStatus').textContent=t(text);};
 const key=()=>`${publicState.computer?.id||''}:${selected?.id||''}`;
 async function result(id){for(let i=0;i<240;i++){const job=JSON.parse(ConnectorBridge.result(id));if(job.connection?.kind==='webrtc'&&job.connection.state==='connecting')status('正在建立跨网络连接…');if(job.state==='done'){if(!job.result?.ok)throw connectorError(job.result||{});return job.result.data;}if(job.state==='missing')throw new Error(t('连接器操作状态已丢失，请刷新'));await new Promise(r=>setTimeout(r,250));}throw new Error(t('等待连接器超时；不会自动重发回复'));}
 async function call(action,args={}){if(!window.ConnectorBridge)throw new Error(t('请在安卓应用中使用电脑连接器'));const job=JSON.parse(ConnectorBridge.begin(action,JSON.stringify(args)));if(!job.ok)throw new Error(job.error||t('无法开始连接器操作'));return result(job.id);}
 const bound=extra=>({computerId:publicState.computer?.id,...extra});
 async function run(fn){if(working)return;working=true;controls();try{await fn();}catch(error){online=false;if(['authorization_failed','certificate_rejected','invalid_input','storage_or_state_unavailable'].includes(error.code))pauseRecovery();status(error.message);}finally{working=false;controls();}}
 function open(){const other=document.querySelector('.sheetBackdrop:not(.hidden)');if(other&&other!==sheet){window.phoneUI?.notice?.(t('已收到电脑配对，请先关闭当前面板后打开扫码连接电脑'));return false;}sheet.classList.remove('hidden');document.body.classList.add('sheetOpen');document.querySelector('.app').setAttribute('inert','');(publicState.paired&&!publicState.pending?$('connectorRefresh'):publicState.pending?$('connectorTitle'):$('connectorScan')).focus({preventScroll:true});return true;}
 function canSendReplies(){return caps.includes('codex.sessions.reply')||caps.includes('agentharbor.sessions.reply');}
 function controls(){$('connectorPairingCompatibility').disabled=working||publicState.pending;$('connectorCompatibility').disabled=working||!publicState.paired||publicState.pending;const pending=sends.get(key());$('connectorSend').disabled=working||publicState.pending||!online||!selected?.canReply||!canSendReplies()||pending?.operationId&&['queued','running'].includes(pending.status)||pending?.status==='failed';$('connectorSend').textContent=t(pending?.status==='unknown'?'重试同一发送':'发送回复');$('connectorReply').readOnly=!!pending;$('connectorResolve').hidden=!['failed','unknown'].includes(pending?.status);$('connectorImportButton').disabled=working;$('connectorScan').disabled=working;$('connectorForget').disabled=working||!publicState.paired;$('connectorRescan').disabled=working;$('connectorRefresh').disabled=working;presentation();publish();}
 function presentation(){
  const pending=!!publicState.pending,paired=!!publicState.paired&&!pending;
  const entryTitle=t(paired?'查看电脑会话':pending?'确认电脑配对':'扫码连接电脑');
  $('connectorEntryTitle').textContent=entryTitle;
  $('openConnector').setAttribute('aria-label',entryTitle);
  $('connectorEntryDescription').textContent=paired?(publicState.computer?.name||t('已配对电脑')):t(pending?'请在电脑允许连接':'在手机查看和回复电脑会话');
  $('connectorComputer').textContent=pending?t('请在电脑允许连接'):paired?(publicState.computer?.name||t('已配对电脑')):t('先在电脑打开二维码');
  $('connectorGuide').hidden=paired||pending;
  $('connectorScan').hidden=paired||pending;
  $('connectorRefresh').hidden=!paired;
  $('connectorRefresh').classList.toggle('dark',!online);
  $('connectorRefresh').textContent=t(online?'刷新会话':'重新连接');
  $('connectorNext').hidden=!pending&&(!paired||online);
  $('connectorNext').textContent=t(pending?'核对两边的确认码，一致后在电脑允许连接。此页会自动更新。':'请确认电脑上的 AgentHarbor 正在运行，网络正常后点“重新连接”。');
  $('connectorSessionList').hidden=!paired||!online;
  $('connectorRescan').hidden=!paired&&!pending;
  $('connectorForgetArea').hidden=!paired;
 }
 function sessionLabel(item){const state=t(({idle:'空闲',running:'运行中',unknown:'状态未知'})[item.status]||item.status||'状态未知');return state+' · '+t(item.canReply&&canSendReplies()?'可回复':'只读');}
 function stateView(value){
  const old=publicState.computer?.id;publicState=value;
  $('connectorCompatibilityRow').hidden=!value.paired||value.pending||value.transport!=='webrtc';
  $('connectorCompatibility').checked=value.networkCompatibility===true;
  $('connectorPairingCompatibility').checked=value.pairingNetworkCompatibility===true;
  $('connectorTransportNote').textContent=t(value.transport==='webrtc'?'跨网络原型仅传输数据；不共享屏幕，不采集音视频。':value.paired||value.pending?'此二维码使用直连地址；跨网络请使用 v2 二维码。':'扫码后会自动选择二维码提供的连接方式。');
  $('connectorDiagnostics').textContent=value.transport==='webrtc'?'WebRTC':value.usbDevelopment?t('USB 调试连接'):value.paired||value.pending?t(' · 直连地址').trim():'';
  for(const item of value.pendingRequests||[])sends.set(`${item.computerId}:${item.sessionId}`,item);
  $('connectorPairCode').hidden=!value.pending;
  $('connectorPairCode').textContent=value.pending?value.confirmationCode:'';
  $('connectorPairCode').setAttribute('aria-label',t('核对电脑端确认码：')+(value.confirmationCode||''));
  if(!value.paired||old&&old!==value.computer?.id){sessions=[];conversation=null;pauseRecovery();selected=null;$('connectorSessions').replaceChildren();$('connectorConversation').hidden=true;online=false;}
  status(value.pending?'等待电脑端审批':value.paired?'已配对，正在检查连接…':'尚未配对');controls();
 }
 async function pollPair(){if(pairPolling)return;pairPolling=true;try{while(!sheet.classList.contains('hidden')&&publicState.pending){await new Promise(r=>setTimeout(r,1500));const value=await call('pollPair');stateView(value);if(value.pairingStatus==='denied'||value.pairingStatus==='expired'){status(value.pairingStatus==='denied'?'电脑端拒绝配对':'配对已过期，请重新扫码');break;}if(value.paired&&!value.pending)await refresh();}}catch(error){status(error.message);}finally{pairPolling=false;}}
 async function refresh(){stateView(await call('state'));if(publicState.pending){void pollPair();return;}if(!publicState.paired){online=false;return;}const expected=publicState.computer.id,health=await call('status',bound());if(expected!==publicState.computer?.id)return;online=health.online===true;caps=health.capabilities||[];status(online?'电脑连接正常':'电脑当前离线');if(online)armRecovery();controls();if(!online)return;const response=await call('sessions',bound());if(expected!==publicState.computer?.id)return;sessions=response.sessions||[];if(selected){selected=sessions.find(item=>item.id===selected.id)||null;if(!selected)$('connectorConversation').hidden=true;}if(conversation&&!sessions.some(item=>item.id===conversation.sessionId))conversation=null;$('connectorSessions').replaceChildren();$('connectorCount').textContent=(response.sessions||[]).length?t('点击会话查看消息；电脑允许后可回复。'):t('暂无已授权会话，请在电脑选择要分享的会话。');if(response.hasMore)$('connectorCount').textContent+=' · '+t('记录已截断');for(const item of response.sessions||[]){const button=document.createElement('button');button.className='smallAction';button.textContent=(item.title||item.id)+' · '+sessionLabel(item);button.setAttribute('aria-pressed',String(selected?.id===item.id));button.onclick=()=>void run(()=>load(item));$('connectorSessions').append(button);}controls();}
 async function load(item,epoch=connectionEpoch){if(selected)drafts.set(key(),$('connectorReply').value);const computer=publicState.computer.id,response=await call('session',bound({sessionId:item.id}));if(epoch!==connectionEpoch||computer!==publicState.computer?.id)return;selected=response.session;conversation={computerId:computer,sessionId:selected.id,messages:response.messages||[],hasMore:!!response.hasMore};$('connectorConversation').hidden=false;$('connectorSessionTitle').textContent=selected.title||selected.id;$('connectorSessionMeta').textContent=(selected.projectPath||'')+' · '+(selected.status||t('状态未知'))+(!selected.canReply||!canSendReplies()?' · '+t('当前会话只读；电脑端尚未允许回复'):(selected.replyNotice?' · '+selected.replyNotice:''));$('connectorMessages').replaceChildren();for(const message of response.messages||[]){const article=document.createElement('article'),role=document.createElement('strong'),text=document.createElement('p');role.textContent=message.role;text.textContent=message.text;article.append(role,text);$('connectorMessages').append(article);}$('connectorMore').textContent=response.hasMore?t('记录已截断'):'';$('connectorReply').value=drafts.get(key())||sends.get(key())?.text||'';controls();const pending=sends.get(key());if(pending?.status==='unknown')$('connectorOperation').textContent=t('发送结果未知；重试会沿用同一请求编号');else if(pending?.status==='failed')$('connectorOperation').textContent=t('发送操作失败，请核对电脑连接器记录；不会自动重发。');if(pending?.operationId)void pollOperation(key(),pending);}
 function uuid(){if(crypto.randomUUID)return crypto.randomUUID();const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=bytes[6]&15|64;bytes[8]=bytes[8]&63|128;return Array.from(bytes,(b,i)=>([4,6,8,10].includes(i)?'-':'')+b.toString(16).padStart(2,'0')).join('');}
 async function pollOperation(binding,entry){if(operationPolls.has(entry.operationId))return;operationPolls.add(entry.operationId);const epoch=connectionEpoch;try{if(entry.status==='completed'){if(binding===key()&&$('connectorReply').value===entry.text){$('connectorReply').value='';drafts.delete(binding);}sends.delete(binding);if(binding===key()){$('connectorOperation').textContent=t('发送操作已完成；不代表整体任务完成');await load(selected,epoch);}return;}while(epoch===connectionEpoch&&['queued','running'].includes(entry.status)&&active()){await new Promise(r=>setTimeout(r,1500));if(epoch!==connectionEpoch)return;try{const response=await call('operation',{computerId:entry.computerId,operationId:entry.operationId});if(epoch!==connectionEpoch)return;entry.status=response.operation.status;if(binding===key())$('connectorOperation').textContent=t('发送操作状态：')+entry.status+(response.operation.error?' · '+response.operation.error:'');if(entry.status==='completed'){if(binding===key()&&$('connectorReply').value===entry.text){$('connectorReply').value='';drafts.delete(binding);}sends.delete(binding);if(binding===key()){$('connectorOperation').textContent=t('发送操作已完成；不代表整体任务完成');await load(selected,epoch);}}}catch(error){if(epoch===connectionEpoch&&binding===key())status(error.message);break;}finally{controls();}}}catch(error){if(epoch===connectionEpoch&&binding===key())status(error.message);}finally{operationPolls.delete(entry.operationId);controls();}}
 $('openConnector').onclick=()=>{if(!open())return;const id=deferredPairJob||window.ConnectorBridge?.pairingJob?.();deferredPairJob=0;if(id>0)void run(async()=>{stateView(await result(id));void pollPair();});else void run(refresh);};
 $('connectorPairingCompatibility').onchange=()=>{const enabled=$('connectorPairingCompatibility').checked;void run(async()=>{try{stateView(await call('setPairingNetworkCompatibility',{enabled}));}finally{$('connectorPairingCompatibility').checked=publicState.pairingNetworkCompatibility===true;}});};
 $('connectorCompatibility').onchange=()=>{const enabled=$('connectorCompatibility').checked;pauseRecovery();connectionEpoch++;online=false;void run(async()=>{try{stateView(await call('setNetworkCompatibility',bound({enabled})));status('设置已保存，请刷新连接');}finally{$('connectorCompatibility').checked=publicState.networkCompatibility===true;}});};
 $('connectorScan').onclick=()=>{pauseRecovery();if(window.ConnectorBridge){status('请在系统界面扫描二维码');ConnectorBridge.scan();}else status('请在安卓应用中使用相机扫描');};
 $('connectorRescan').onclick=()=>$('connectorScan').onclick();
 $('connectorRefresh').onclick=()=>void run(async()=>{await refresh();const entry=sends.get(key());if(entry?.operationId)void pollOperation(key(),entry);});
 $('connectorImportButton').onclick=()=>{pauseRecovery();const uri=$('connectorUri').value;$('connectorUri').value='';selected=null;online=false;$('connectorConversation').hidden=true;void run(async()=>{stateView(await call('pair',{uri}));void pollPair();});};
 $('connectorForget').onclick=()=>void run(async()=>{pauseRecovery();const value=await call('forget');online=false;selected=null;stateView(value);$('connectorConversation').hidden=true;$('connectorSessions').replaceChildren();});
 $('connectorReply').oninput=()=>drafts.set(key(),$('connectorReply').value);
 async function submitReply(text,allowRetry){if(!selected||!online||!selected.canReply||!canSendReplies())throw new Error(t('当前会话只读；电脑端尚未允许回复'));const binding=key(),computerId=publicState.computer.id,sessionId=selected.id;let entry=sends.get(binding);if(entry&&!allowRetry)throw new Error(t('上一条发送尚未确认，请先查看发送状态'));if(!entry){if(!text.trim())return;entry={requestId:uuid(),text,computerId,sessionId,status:'unknown'};sends.set(binding,entry);}try{const response=await call('send',{computerId:entry.computerId,sessionId:entry.sessionId,text:entry.text,requestId:entry.requestId});entry.operationId=response.operation.id;entry.status=response.operation.status;if(binding===key())$('connectorOperation').textContent=t('发送操作状态：')+entry.status;void pollOperation(binding,entry);}catch(error){entry.status='unknown';$('connectorOperation').textContent=t('发送结果未知；重试会沿用同一请求编号');throw error;}}
 $('connectorSend').onclick=()=>void run(()=>submitReply($('connectorReply').value,true));
 $('connectorResolve').onclick=()=>void run(async()=>{stateView(await call('resolveSend',bound({sessionId:selected.id})));sends.delete(key());$('connectorOperation').textContent=t('请核对电脑记录后再发送新回复');controls();});
 window.phoneConnector={nativeEvent(type,id){if(!open()){if(id>0)deferredPairJob=id;return;}if(id>0){selected=null;online=false;$('connectorConversation').hidden=true;$('connectorSessions').replaceChildren();ConnectorBridge.pairingJob?.();void run(async()=>{stateView(await result(id));void pollPair();});}else status(({invalid_uri:'二维码不是有效的电脑配对地址',camera_denied:'相机权限未开启，请在系统设置允许后重新扫码',scan_cancelled:'已取消扫描'})[type]||'连接器操作失败');}};
 // The town uses the same approved scope, outbox and exact-once send path.
 async function townRun(fn){if(working)throw new Error(t('电脑连接正在处理，请稍后再试'));let value,error;await run(async()=>{try{value=await fn();}catch(e){error=e;throw e;}});if(error)throw error;return value;}
 function shared(id){const item=sessions.find(item=>item.id===id);if(!item)throw new Error(t('这个会话已不在电脑共享范围内'));return item;}
 Object.assign(window.phoneConnector,{
  snapshot,
  refreshTown:()=>townRun(async()=>{await refresh();return snapshot();}),
  loadTown:id=>{const item=shared(id);return townRun(async()=>{await load(item);return conversation;});},
  sendTown:(id,text)=>{const item=shared(id);if(!online||!item.canReply||!canSendReplies())throw new Error(t('当前会话只读；电脑端尚未允许回复'));if(sends.has(`${publicState.computer?.id}:${id}`))throw new Error(t('上一条发送尚未确认，请先查看发送状态'));return townRun(async()=>{if(selected?.id!==id)await load(item);await submitReply(text,false);return snapshot();});},
  openSession:id=>{if(!open())return;void run(async()=>{await refresh();if(id)await load(shared(id));});}
 });
 // Recover an already verified, approved connection while the connector or town is visible.
 // These probes use status/session-list reads only. No send, approval or retry POST.
 async function recoverConnection(){
  if(!recoveryArmed||working)return;
  const expected=publicState.computer?.id;
  await run(async()=>{
   try{
    if(!online){status('正在恢复电脑连接；未决回复不会自动重发');await refresh();}
    else {await refresh();if(online&&selected&&window.phoneUI?.connectorActive?.())await load(selected);}
    if(!online)retryRecovery();
   }catch(error){retryRecovery();throw error;}
  });
 }
 setInterval(()=>{
  if(!active()||publicState.transport!=='webrtc'||!publicState.paired||publicState.pending||!window.ConnectorBridge?.connection)return;
  try{
   const value=JSON.parse(ConnectorBridge.connection());
   if(value.state==='disconnected'&&online){online=false;status(recoveryArmed?'跨网络连接已断开，正在准备恢复；未决回复不会自动重发':'跨网络连接已断开；请刷新，未决回复不会自动重发');if(recoveryArmed)retryRecovery();controls();}
   else if(online&&value.state==='connected')$('connectorDiagnostics').textContent=t(value.path==='direct'?'WebRTC 实际直连':value.path==='relay'?'TURN 实际中继':'WebRTC 路径待确认');
   publish();if(recoveryArmed&&!working&&Date.now()>=recoveryAt)void recoverConnection();
  }catch(error){}
 },2000);
 if(window.ConnectorBridge){const id=ConnectorBridge.pairingJob?.();if(id>0)window.phoneConnector.nativeEvent('pairing',id);else void run(refresh);}
})();
