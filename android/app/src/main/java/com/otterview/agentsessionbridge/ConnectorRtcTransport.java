package com.otterview.agentsessionbridge;

import android.content.Context;
import org.json.*;
import org.webrtc.*;
import okhttp3.*;
import java.nio.*;import java.nio.charset.*;import java.util.*;import java.util.concurrent.*;import java.util.concurrent.atomic.*;

/** Foreground, data-only RTC. Every callback/RPC is owned by one immutable handshake generation. */
final class ConnectorRtcTransport implements ConnectorTransport {
 private static boolean initialized;
 enum NetworkMode{PLATFORM_DEFAULT,COMPAT_NATIVE_POLLING,EXPERIMENT_MONITOR_ON,EXPERIMENT_MONITOR_OFF}
 private final NetworkMode networkMode;
 private static NetworkMode selectNetworkMode(boolean enabled,boolean off){return !enabled?NetworkMode.PLATFORM_DEFAULT:off?NetworkMode.EXPERIMENT_MONITOR_OFF:NetworkMode.EXPERIMENT_MONITOR_ON;}
 private static PeerConnectionFactory.Builder configuredFactory(NetworkMode mode){PeerConnectionFactory.Builder builder=PeerConnectionFactory.builder();if(mode!=NetworkMode.PLATFORM_DEFAULT){PeerConnectionFactory.Options options=new PeerConnectionFactory.Options();options.networkIgnoreMask=PeerConnectionFactory.Options.ADAPTER_TYPE_LOOPBACK;options.disableEncryption=false;options.disableNetworkMonitor=mode==NetworkMode.EXPERIMENT_MONITOR_OFF||mode==NetworkMode.COMPAT_NATIVE_POLLING;builder.setOptions(options);}return builder;}

 enum Phase { IDLE, SIGNAL_CONNECTING, SIGNAL_OPEN, HELLO_SENT, OFFER_RECEIVED, OFFER_VERIFIED, REMOTE_SDP_SETTING, REMOTE_SDP_SET, ANSWER_CREATING, LOCAL_SDP_SETTING, LOCAL_SDP_SET, ICE_GATHERING, ANSWER_SENT, DATA_CHANNEL_RECEIVED, DATA_CHANNEL_OPEN, RPC_READY, CLOSED }
 enum Failure { NONE, ANSWER_BINDING_FAILED, ANSWER_FAILED, BINARY_SIGNAL_REFUSED, EXPIRED_ANSWER, EXPIRED_LOCAL_ANSWER, ICE_DISCONNECTED, LOCAL_SDP_FAILED, MEDIA_STREAM_REFUSED, MEDIA_TRACK_REFUSED, OFFER_EXPIRED, PEER_DISCONNECTED, RPC_AUTHORIZATION_REJECTED, RPC_CHANNEL_CLOSED, RPC_CHUNK_REFUSED, RPC_DEADLINE, RPC_ENABLED_OUTSIDE_HANDSHAKE, RPC_FRAME_REJECTED, RPC_OUTGOING_PRESSURE, RPC_SEND_REFUSED, RTC_CALLBACK_FAILED, RTC_CALLBACK_PRESSURE, RTC_CALLBACK_QUEUE_FULL, RTC_CONNECT_FAILED, RTC_HANDSHAKE_DEADLINE, REMOTE_SDP_FAILED, REMOTE_CLOSED, SIGNAL_BOUND, SIGNAL_CLOSED, SIGNAL_CLOSING, SIGNAL_DISCONNECTED, SIGNAL_ROOM_UNAVAILABLE, SIGNAL_FAILED, SIGNAL_IDENTITY_REJECTED, TRANSPORT_CLOSED, UNEXPECTED_DATA_CHANNEL }
 private volatile Phase phase=Phase.IDLE;private volatile Failure failure=Failure.NONE;
 private volatile PeerConnection.IceConnectionState sdkIceState=PeerConnection.IceConnectionState.NEW;
 private volatile PeerConnection.PeerConnectionState sdkPeerState=PeerConnection.PeerConnectionState.NEW;
 private void stage(Session s,Phase value){if(!alive(s))return;phase=value;android.util.Log.i("ConnectorRTC","phase="+value.name());}
 private final Context appContext;
 private volatile ConnectorNetworkDiagnostics.Snapshot networkSnapshot=new ConnectorNetworkDiagnostics.Snapshot(ConnectorNetworkDiagnostics.Stage.BEFORE_PEER);
 private volatile ConnectorNetworkDiagnostics.Probes networkProbes;
 private final ConnectorPolicy config;private final String authType,deviceId;private final byte[] authKey;
 private final PeerConnectionFactory factory;private final Object factoryLock=new Object(),startLock=new Object(),cleanupLock=new Object();
 private final CompletableFuture<Void> closeCompletion=new CompletableFuture<>();private volatile boolean cleanupFailed;
 private final ThreadPoolExecutor serial=new ThreadPoolExecutor(1,1,0,TimeUnit.MILLISECONDS,new ArrayBlockingQueue<>(64));
 private final ScheduledThreadPoolExecutor timer=new ScheduledThreadPoolExecutor(1);
 private final AtomicReference<Session> current=new AtomicReference<>();private final AtomicLong generation=new AtomicLong(),callbackBytes=new AtomicLong();
 private final LinkedHashMap<String,Long> seenServerNonces=new LinkedHashMap<>();
 private volatile ConnectorIceDiagnostics iceDiagnostics=new ConnectorIceDiagnostics();
 private volatile boolean stopped,pairSubmitted;private volatile String connectionState="disconnected",pathState="unknown";
 private final class Session {
  final long generation=ConnectorRtcTransport.this.generation.incrementAndGet();final String clientNonce=ConnectorRtcCrypto.nonce();final byte[] key=authKey.clone();
  final ConnectorIceDiagnostics ice=new ConnectorIceDiagnostics();
  final ConnectorNetworkDiagnostics.Probes probes=new ConnectorNetworkDiagnostics.Probes(appContext,value->{if(!stopped&&iceDiagnostics==ice){networkSnapshot=value;android.util.Log.i("ConnectorRTC","network_probe "+value.safeLine());}});
  volatile boolean localSetSuccess;volatile PeerConnection.IceGatheringState gathering=PeerConnection.IceGatheringState.NEW;
  final AtomicBoolean closed=new AtomicBoolean(),offered=new AtomicBoolean(),answered=new AtomicBoolean();final Object nativeLock=new Object();
  final CompletableFuture<Session> connected=new CompletableFuture<>();final Map<String,CompletableFuture<JSONObject>> pending=new ConcurrentHashMap<>();
  final ConnectorRpcFramer framer=new ConnectorRpcFramer();final ArrayDeque<byte[]> outgoing=new ArrayDeque<>();long queued;String connectionId,statement,serverNonce;long expires;
  volatile long renewAt=Long.MAX_VALUE;
  boolean helloSent,answerSent;PeerConnection pc;DataChannel channel;WebSocket signal;OkHttpClient http;ScheduledFuture<?> stats;
 }
 private void recordSdkIceState(Session s,PeerConnection.IceConnectionState state){if(!alive(s)||state==null)return;sdkIceState=state;android.util.Log.i("ConnectorRTC","sdk_ice="+state.name());}
 private void recordSdkPeerState(Session s,PeerConnection.PeerConnectionState state){if(!alive(s)||state==null)return;sdkPeerState=state;android.util.Log.i("ConnectorRTC","sdk_peer="+state.name());}
 ConnectorRtcTransport(Context context,ConnectorPolicy config,String secret,String authType,String deviceId,boolean networkCompatibility)throws Exception{
  timer.setRemoveOnCancelPolicy(true);timer.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);timer.setContinueExistingPeriodicTasksAfterShutdownPolicy(false);
  this.appContext=context.getApplicationContext();this.config=config;this.authType=authType;this.deviceId=deviceId;authKey=ConnectorRtcCrypto.hash(secret);
  if(!Arrays.asList("pair","device").contains(authType)||"pair".equals(authType)&&!deviceId.isEmpty())throw new IllegalArgumentException("RTC auth mode");
  synchronized(ConnectorRtcTransport.class){if(!initialized){PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(context.getApplicationContext()).setEnableInternalTracer(false).setInjectableLogger((message,severity,tag)->{},org.webrtc.Logging.Severity.LS_NONE).createInitializationOptions());initialized=true;}}
  networkMode=networkCompatibility?NetworkMode.COMPAT_NATIVE_POLLING:selectNetworkMode(BuildConfig.DEBUG&&BuildConfig.CONNECTOR_MONITOR_AB,BuildConfig.CONNECTOR_MONITOR_OFF);factory=configuredFactory(networkMode).createPeerConnectionFactory();android.util.Log.i("ConnectorRTC","network_mode="+networkMode.name());
 }
 public JSONObject publicState(){try{return new JSONObject().put("kind","webrtc").put("state",connectionState).put("path",pathState).put("phase",phase.name()).put("failure",failure.name()).put("sdkIceState",sdkIceState.name()).put("sdkPeerState",sdkPeerState.name()).put("iceDiagnostics",iceDiagnostics.publicValues()).put("networkDiagnostics",networkSnapshot.publicValues()).put("networkMode",networkMode.name());}catch(Exception e){return new JSONObject();}}
 private boolean alive(Session s){return !stopped&&!s.closed.get()&&current.get()==s&&generation.get()==s.generation;}
 public boolean renewalDue(){Session s=current.get();return "device".equals(authType)&&s!=null&&alive(s)&&"connected".equals(connectionState)&&!"direct".equals(pathState)&&s.renewAt!=Long.MAX_VALUE&&System.nanoTime()-s.renewAt>=0;}
 private void dispatch(Session s,int bytes,Runnable task){if(!alive(s))return;if(callbackBytes.addAndGet(bytes)>4*1024*1024){callbackBytes.addAndGet(-bytes);fail(s,Failure.RTC_CALLBACK_PRESSURE);return;}try{serial.execute(()->{try{if(alive(s))task.run();}catch(Exception error){fail(s,Failure.RTC_CALLBACK_FAILED);}finally{callbackBytes.addAndGet(-bytes);}});}catch(RejectedExecutionException error){callbackBytes.addAndGet(-bytes);fail(s,Failure.RTC_CALLBACK_QUEUE_FULL);}}
 private void fail(Session s,Failure reason){synchronized(cleanupLock){if(s==null||!s.closed.compareAndSet(false,true))return;if(current.compareAndSet(s,null)){connectionState="disconnected";pathState="unknown";failure=reason;android.util.Log.i("ConnectorRTC","phase="+phase.name()+" failure="+reason.name());}ConnectorException error=reason==Failure.SIGNAL_ROOM_UNAVAILABLE?new ConnectorException("connector_unavailable","原配对的电脑连接入口未上线或连接已满。请在电脑原来的连接手机页面启动连接；如切换了连接来源，请重新扫码。"):new ConnectorException("rtc_disconnected","跨网络连接已断开；未决回复不会自动重发");s.connected.completeExceptionally(error);synchronized(s.pending){for(CompletableFuture<JSONObject> future:s.pending.values())future.completeExceptionally(error);s.pending.clear();}enqueueCleanup(s);}}
 // Registration and close's finalizer are serialized; no native cleanup
 // ever runs inline on the UI or an SDK callback thread.
 private void enqueueCleanup(Session s){try{timer.execute(()->{try{cleanup(s);}catch(Throwable ignored){cleanupFailed=true;}finally{Arrays.fill(s.key,(byte)0);}});}catch(RejectedExecutionException ignored){cleanupFailed=true;Arrays.fill(s.key,(byte)0);closeCompletion.completeExceptionally(new IllegalStateException("RTC cleanup unavailable"));}}
 private void cleanup(Session s){if(s.stats!=null)s.stats.cancel(false);if(s.signal!=null)s.signal.cancel();if(s.http!=null){s.http.dispatcher().cancelAll();s.http.connectionPool().evictAll();s.http.dispatcher().executorService().shutdown();}synchronized(s.nativeLock){if(s.channel!=null){s.channel.unregisterObserver();s.channel.close();s.channel.dispose();s.channel=null;}if(s.pc!=null){s.pc.close();s.pc.dispose();s.pc=null;}s.outgoing.clear();s.queued=0;}Arrays.fill(s.key,(byte)0);}
 private Session connect()throws Exception{
  Session s; synchronized(startLock){if(stopped)throw new ConnectorException("rtc_closed","跨网络连接已关闭");s=current.get();if(s==null||s.closed.get()){if("pair".equals(authType)&&pairSubmitted)throw new ConnectorException("pairing_disconnected","配对通道已断开，请生成新二维码");if(networkProbes!=null)networkProbes.cancel();s=new Session();networkProbes=s.probes;networkSnapshot=new ConnectorNetworkDiagnostics.Snapshot(ConnectorNetworkDiagnostics.Stage.BEFORE_PEER);current.set(s);iceDiagnostics=s.ice;failure=Failure.NONE;sdkIceState=PeerConnection.IceConnectionState.NEW;sdkPeerState=PeerConnection.PeerConnectionState.NEW;stage(s,Phase.SIGNAL_CONNECTING);connectionState="connecting";pathState="unknown";Session started=s;dispatch(s,0,()->startSignal(started));timer.schedule(()->{if(!started.connected.isDone())fail(started,Failure.RTC_HANDSHAKE_DEADLINE);},30,TimeUnit.SECONDS);}}
  try{return s.connected.get(31,TimeUnit.SECONDS);}catch(Exception error){fail(s,Failure.RTC_CONNECT_FAILED);if(error.getCause() instanceof ConnectorException&&"connector_unavailable".equals(((ConnectorException)error.getCause()).code))throw (ConnectorException)error.getCause();throw new ConnectorException("rtc_connect_failed","跨网络连接未建立，请检查电脑与公网连接器");}
 }
 private void startSignal(Session s){try{
  s.http=ConnectorSignalTls.client(config.host,config.signalPin);HttpUrl url=HttpUrl.get(config.endpoint.replaceFirst("^wss:","https:")).newBuilder().addQueryParameter("role","phone").addQueryParameter("room",config.room).build();
  s.signal=s.http.newWebSocket(new Request.Builder().url(url).build(),new WebSocketListener(){
   @Override public void onOpen(WebSocket socket,Response response){stage(s,Phase.SIGNAL_OPEN);}
   @Override public void onMessage(WebSocket socket,String text){if(text.length()>256*1024){fail(s,Failure.SIGNAL_BOUND);return;}dispatch(s,text.length()*2,()->signalMessage(s,text));}
   @Override public void onMessage(WebSocket socket,okio.ByteString bytes){fail(s,Failure.BINARY_SIGNAL_REFUSED);}
   @Override public void onFailure(WebSocket socket,Throwable error,Response response){if(alive(s)){int code=ConnectorSignalFailure.httpCode(response==null?0:response.code());android.util.Log.i("ConnectorRTC","signal_failure="+ConnectorSignalFailure.classify(error,code).name()+" http_code="+code);if(code==409)fail(s,Failure.SIGNAL_ROOM_UNAVAILABLE);else fail(s,Failure.SIGNAL_DISCONNECTED);}}
   @Override public void onClosed(WebSocket socket,int code,String reason){fail(s,Failure.SIGNAL_CLOSED);}
   @Override public void onClosing(WebSocket socket,int code,String reason){fail(s,Failure.SIGNAL_CLOSING);}
  });
 }catch(Exception error){fail(s,Failure.SIGNAL_FAILED);}}
 private void signalMessage(Session s,String text){try{
  ConnectorStrictJson.validate(text);JSONObject message=new JSONObject(text);String type=message.getString("type");
  if("welcome".equals(type)){
   ConnectorRtcCrypto.exact(message,"type","room","connectionId");if(s.helloSent||!config.room.equals(message.getString("room")))throw new IllegalArgumentException("Signal room binding");String id=message.getString("connectionId");if(!id.matches("[A-Za-z0-9_-]{8,128}"))throw new IllegalArgumentException("Signal connection binding");s.connectionId=id;s.helloSent=true;
   JSONObject hello=new JSONObject().put("type","hello").put("room",config.room).put("clientNonce",s.clientNonce).put("authType",authType).put("deviceId",deviceId).put("proof",ConnectorRtcCrypto.helloProof(s.key,config.room,s.clientNonce,authType,deviceId));if(!s.signal.send(hello.toString()))throw new IllegalStateException("Hello not queued");stage(s,Phase.HELLO_SENT);return;
  }
  if("offer".equals(type)){
   if(!s.helloSent||!s.offered.compareAndSet(false,true))throw new IllegalArgumentException("Offer generation");
   if(message.has("connectionId")&&!s.connectionId.equals(message.getString("connectionId")))throw new IllegalArgumentException("Outer connection binding");
   stage(s,Phase.OFFER_RECEIVED);String statement=message.getString("statement");long observedNow=System.currentTimeMillis();JSONObject offer=ConnectorRtcCrypto.verifyOffer(statement,message.getString("certificate"),message.getString("signature"),config.pin,config.room,s.connectionId,s.clientNonce,authType,deviceId,observedNow);
   stage(s,Phase.OFFER_VERIFIED);String serverNonce=offer.getString("serverNonce");long now=System.currentTimeMillis();seenServerNonces.entrySet().removeIf(entry->entry.getValue()<=now);if(seenServerNonces.containsKey(serverNonce))throw new IllegalArgumentException("Server nonce replay");if(seenServerNonces.size()>=128)seenServerNonces.remove(seenServerNonces.keySet().iterator().next());seenServerNonces.put(serverNonce,java.time.Instant.parse(offer.getString("expiresAt")).toEpochMilli());
   s.statement=statement;s.serverNonce=serverNonce;s.expires=ConnectorRtcCrypto.handshakeDeadline(offer,observedNow);timer.schedule(()->{if(!s.connected.isDone())fail(s,Failure.OFFER_EXPIRED);},Math.max(1,s.expires-System.currentTimeMillis()),TimeUnit.MILLISECONDS);createPeer(s,offer);return;
  }
  if(Arrays.asList("close","peer-closed","error").contains(type)){if(message.has("connectionId")&&s.connectionId!=null&&!s.connectionId.equals(message.getString("connectionId")))throw new IllegalArgumentException("Close generation");fail(s,Failure.REMOTE_CLOSED);return;}
  throw new IllegalArgumentException("Unknown signal message");
 }catch(Exception error){fail(s,Failure.SIGNAL_IDENTITY_REJECTED);}}
 private void createPeer(Session s,JSONObject offer)throws Exception{
  s.renewAt=ConnectorRelayLease.renewAt(offer.getJSONArray("iceServers"),System.currentTimeMillis(),System.nanoTime());
  List<PeerConnection.IceServer> servers=new ArrayList<>();JSONArray raw=offer.getJSONArray("iceServers");for(int i=0;i<raw.length();i++){JSONObject value=raw.getJSONObject(i);List<String> urls=new ArrayList<>();JSONArray values=value.getJSONArray("urls");for(int j=0;j<values.length();j++)urls.add(values.getString(j));servers.add(PeerConnection.IceServer.builder(urls).setUsername(value.getString("username")).setPassword(value.getString("credential")).createIceServer());}
  PeerConnection.RTCConfiguration rtc=new PeerConnection.RTCConfiguration(servers);rtc.sdpSemantics=PeerConnection.SdpSemantics.UNIFIED_PLAN;
  synchronized(s.nativeLock){if(!alive(s)||System.currentTimeMillis()>=s.expires)throw new IllegalStateException("Offer expired before remote description");synchronized(factoryLock){if(!alive(s))return;s.probes.request(ConnectorNetworkDiagnostics.Stage.BEFORE_PEER);s.pc=factory.createPeerConnection(rtc,new PeerConnection.Observer(){
   public void onSignalingChange(PeerConnection.SignalingState state){}
   public void onIceConnectionChange(PeerConnection.IceConnectionState state){recordSdkIceState(s,state);if(alive(s)&&state==PeerConnection.IceConnectionState.FAILED)s.probes.request(ConnectorNetworkDiagnostics.Stage.ICE_FAILED);if(state==PeerConnection.IceConnectionState.FAILED||state==PeerConnection.IceConnectionState.CLOSED||state==PeerConnection.IceConnectionState.DISCONNECTED)fail(s,Failure.ICE_DISCONNECTED);}
   public void onConnectionChange(PeerConnection.PeerConnectionState state){recordSdkPeerState(s,state);if(state==PeerConnection.PeerConnectionState.FAILED||state==PeerConnection.PeerConnectionState.CLOSED||state==PeerConnection.PeerConnectionState.DISCONNECTED)fail(s,Failure.PEER_DISCONNECTED);}
   public void onIceConnectionReceivingChange(boolean receiving){}
   public void onIceGatheringChange(PeerConnection.IceGatheringState state){if(alive(s)&&state!=null)s.gathering=state;if(state==PeerConnection.IceGatheringState.GATHERING)stage(s,Phase.ICE_GATHERING);if(state==PeerConnection.IceGatheringState.COMPLETE){if(alive(s))s.probes.request(ConnectorNetworkDiagnostics.Stage.GATHER_COMPLETE);if(alive(s))android.util.Log.i("ConnectorRTC","gather_complete "+s.ice.gathered.safeLine());dispatch(s,0,()->sendAnswer(s));}}
   public void onIceCandidate(IceCandidate candidate){if(alive(s)&&candidate!=null)s.ice.gathered.candidate(candidate.sdp);}
   public void onIceCandidateError(IceCandidateErrorEvent event){if(!alive(s)||event==null)return;ConnectorIceDiagnostics.ErrorRecord record=s.ice.error(event.errorCode,event.url);if(record.log)android.util.Log.i("ConnectorRTC","ice_candidate_error "+record.safeLine());}
   public void onIceCandidatesRemoved(IceCandidate[] candidates){}
   public void onAddStream(MediaStream stream){fail(s,Failure.MEDIA_STREAM_REFUSED);}
   public void onRemoveStream(MediaStream stream){}
   public void onDataChannel(DataChannel channel){stage(s,Phase.DATA_CHANNEL_RECEIVED);dispatch(s,0,()->acceptChannel(s,channel));}
   public void onRenegotiationNeeded(){}
   public void onTrack(RtpTransceiver transceiver){fail(s,Failure.MEDIA_TRACK_REFUSED);}
  });}
  if(s.pc==null)throw new IllegalStateException("Peer creation failed");s.probes.request(ConnectorNetworkDiagnostics.Stage.AFTER_PEER);s.pc.setAudioPlayout(false);s.pc.setAudioRecording(false);
  stage(s,Phase.REMOTE_SDP_SETTING);s.pc.setRemoteDescription(new SdpAdapter(){public void onSetSuccess(){stage(s,Phase.REMOTE_SDP_SET);dispatch(s,0,()->answer(s));}public void onSetFailure(String ignored){fail(s,Failure.REMOTE_SDP_FAILED);}},new SessionDescription(SessionDescription.Type.OFFER,offer.getString("sdp")));
  }
 }
 private void answer(Session s){synchronized(s.nativeLock){if(!alive(s)||s.pc==null||System.currentTimeMillis()>=s.expires){fail(s,Failure.EXPIRED_ANSWER);return;}stage(s,Phase.ANSWER_CREATING);s.pc.createAnswer(new SdpAdapter(){public void onCreateSuccess(SessionDescription description){dispatch(s,description.description.length()*2,()->{synchronized(s.nativeLock){if(!alive(s)||System.currentTimeMillis()>=s.expires){fail(s,Failure.EXPIRED_LOCAL_ANSWER);return;}stage(s,Phase.LOCAL_SDP_SETTING);s.pc.setLocalDescription(new SdpAdapter(){public void onSetSuccess(){if(alive(s))s.localSetSuccess=true;stage(s,Phase.LOCAL_SDP_SET);dispatch(s,0,()->{synchronized(s.nativeLock){if(s.pc!=null){PeerConnection.IceGatheringState gathering=s.pc.iceGatheringState();if(alive(s)&&gathering!=null)s.gathering=gathering;if(gathering==PeerConnection.IceGatheringState.COMPLETE)sendAnswer(s);}}});}public void onSetFailure(String ignored){fail(s,Failure.LOCAL_SDP_FAILED);}},description);}});}public void onCreateFailure(String ignored){fail(s,Failure.ANSWER_FAILED);}},new MediaConstraints());}}
 private void sendAnswer(Session s){try{synchronized(s.nativeLock){if(!alive(s)||s.pc==null||s.pc.getLocalDescription()==null)return;if(!s.answered.compareAndSet(false,true))return;if(System.currentTimeMillis()>=s.expires)throw new IllegalStateException("Expired answer generation");String sdp=s.pc.getLocalDescription().description;if(sdp.length()>65536||!sdp.contains("m=application "))throw new IllegalArgumentException("Answer bound");JSONObject reply=new JSONObject().put("type","answer").put("clientNonce",s.clientNonce).put("serverNonce",s.serverNonce).put("sdp",sdp).put("proof",ConnectorRtcCrypto.answerProof(s.key,config.room,s.connectionId,s.clientNonce,s.serverNonce,s.statement,sdp));s.answerSent=true;if(!s.signal.send(reply.toString()))throw new IllegalStateException("Answer not queued");s.ice.answer(sdp,s.localSetSuccess,s.gathering.name());android.util.Log.i("ConnectorRTC","answer_candidates "+s.ice.answerLine());stage(s,Phase.ANSWER_SENT);s.probes.request(ConnectorNetworkDiagnostics.Stage.ANSWER_SENT);}}catch(Exception error){fail(s,Failure.ANSWER_BINDING_FAILED);}}
 private void acceptChannel(Session s,DataChannel channel){synchronized(s.nativeLock){if(!alive(s)){channel.close();channel.dispose();return;}if(s.channel!=null||!"agentbridge.rpc.v2".equals(channel.label())){channel.close();channel.dispose();fail(s,Failure.UNEXPECTED_DATA_CHANNEL);return;}s.channel=channel;channel.registerObserver(new DataChannel.Observer(){
  public void onBufferedAmountChange(long previous){dispatch(s,0,()->pump(s));}
  public void onStateChange(){dispatch(s,0,()->channelState(s));}
  public void onMessage(DataChannel.Buffer buffer){if(!buffer.binary||buffer.data.remaining()<1||buffer.data.remaining()>ConnectorRpcFramer.MAX_CHUNK){fail(s,Failure.RPC_CHUNK_REFUSED);return;}byte[] bytes=new byte[buffer.data.remaining()];buffer.data.get(bytes);dispatch(s,bytes.length,()->receive(s,bytes));}
 });channelState(s);}}
 private void channelState(Session s){synchronized(s.nativeLock){if(!alive(s)||s.channel==null)return;DataChannel.State state=s.channel.state();if(state==DataChannel.State.CLOSED||state==DataChannel.State.CLOSING){fail(s,Failure.RPC_CHANNEL_CLOSED);return;}if(state==DataChannel.State.OPEN){if(!s.connected.isDone()&&(!s.answerSent||System.currentTimeMillis()>=s.expires)){fail(s,Failure.RPC_ENABLED_OUTSIDE_HANDSHAKE);return;}stage(s,Phase.DATA_CHANNEL_OPEN);connectionState="connected";s.connected.complete(s);stage(s,Phase.RPC_READY);if(s.stats==null)s.stats=timer.scheduleWithFixedDelay(()->dispatch(s,0,()->stats(s)),0,5,TimeUnit.SECONDS);pump(s);}}}
 private void stats(Session s){synchronized(s.nativeLock){if(!alive(s)||s.pc==null)return;s.pc.getStats(report->dispatch(s,0,()->{if(alive(s))pathState=ConnectorRtcStats.path(report.getStatsMap());}));}}
 private void receive(Session s,byte[] bytes){try{for(byte[] record:s.framer.accept(bytes)){String text=StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(record)).toString();ConnectorStrictJson.validate(text);JSONObject response=new JSONObject(text);ConnectorRtcCrypto.exact(response,"id","statusCode","body");String id=response.getString("id");if(!(response.get("statusCode")instanceof Integer)||response.getInt("statusCode")<100||response.getInt("statusCode")>599||!(response.get("body")instanceof JSONObject))throw new IllegalArgumentException("RPC response schema");CompletableFuture<JSONObject> future=s.pending.remove(id);if(future==null)throw new IllegalArgumentException("Unknown RPC generation");future.complete(response);if(response.getInt("statusCode")==401||response.getInt("statusCode")==403)fail(s,Failure.RPC_AUTHORIZATION_REJECTED);}}catch(Exception error){fail(s,Failure.RPC_FRAME_REJECTED);}}
 private void pump(Session s){synchronized(s.nativeLock){if(!alive(s)||s.channel==null||s.channel.state()!=DataChannel.State.OPEN)return;while(!s.outgoing.isEmpty()&&s.channel.bufferedAmount()<256*1024){byte[] bytes=s.outgoing.peek();if(!s.channel.send(new DataChannel.Buffer(ByteBuffer.wrap(bytes),true))){fail(s,Failure.RPC_SEND_REFUSED);return;}s.outgoing.remove();s.queued-=bytes.length;}}}
 public JSONObject request(String origin,String host,String pin,String bearer,String method,String route,JSONObject body)throws Exception{
  if(!config.endpoint.equals(origin)||!config.pin.equals(pin)||!allowed(method,route))throw new IllegalArgumentException("RPC endpoint scope");Session s=connect();if("pair".equals(authType)&&"/v1/pair".equals(route))pairSubmitted=true;
  String id=UUID.randomUUID().toString();CompletableFuture<JSONObject> response=new CompletableFuture<>();
  JSONObject request=new JSONObject().put("id",id).put("method",method).put("path",route);if(bearer!=null)request.put("bearer",bearer);if(body!=null)request.put("body",body);
  byte[] record=ConnectorRtcCrypto.utf8(request.toString());List<byte[]> chunks=ConnectorRpcFramer.encode(record);synchronized(s.pending){if(!alive(s))throw new ConnectorException("rtc_disconnected","跨网络连接已断开；未决回复不会自动重发");if(s.pending.size()>=16)throw new ConnectorException("rtc_pressure","跨网络请求队列已满");s.pending.put(id,response);}
  dispatch(s,record.length,()->{synchronized(s.nativeLock){if(s.queued+record.length+4>4*1024*1024){fail(s,Failure.RPC_OUTGOING_PRESSURE);return;}for(byte[] chunk:chunks){s.outgoing.add(chunk);s.queued+=chunk.length;}pump(s);}});
  try{JSONObject value=response.get(20,TimeUnit.SECONDS);int status=value.getInt("statusCode");if(status<200||status>=300)throw new ConnectorException(status==401||status==403?"authorization_failed":status==409?"conflict":"server_error",status==401||status==403?"连接器授权已失效，请重新配对":status==409?"会话正在运行或请求冲突；请核对电脑端状态":"连接器拒绝请求，请检查电脑端记录");return value.getJSONObject("body");}catch(TimeoutException error){fail(s,Failure.RPC_DEADLINE);throw new ConnectorException("rtc_timeout","跨网络请求超时；未决回复不会自动重发");}catch(ExecutionException error){throw new ConnectorException("rtc_disconnected","跨网络连接已断开；未决回复不会自动重发");}finally{s.pending.remove(id);}
 }
 private static final String UUID_PATTERN="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
 static boolean allowed(String method,String route){return "GET".equals(method)&&(route.equals("/v1/status")||route.equals("/v1/sessions")||route.matches("/v1/(?:sessions|operations)/"+UUID_PATTERN))||"POST".equals(method)&&(route.equals("/v1/pair")||route.equals("/v1/pair/status")||route.matches("/v1/sessions/"+UUID_PATTERN+"/messages"));}
 public void close(){synchronized(startLock){synchronized(cleanupLock){
  if(stopped)return;stopped=true;if(networkProbes!=null)networkProbes.cancel();Session s=current.getAndSet(null);if(s!=null)fail(s,Failure.TRANSPORT_CLOSED);connectionState="disconnected";pathState="unknown";serial.shutdownNow();
  try{timer.execute(()->{try{synchronized(factoryLock){factory.dispose();}}catch(Throwable ignored){cleanupFailed=true;}finally{Arrays.fill(authKey,(byte)0);timer.shutdownNow();if(cleanupFailed)closeCompletion.completeExceptionally(new IllegalStateException("RTC cleanup failed"));else closeCompletion.complete(null);}});}catch(RejectedExecutionException ignored){cleanupFailed=true;Arrays.fill(authKey,(byte)0);closeCompletion.completeExceptionally(new IllegalStateException("RTC cleanup unavailable"));}
 }}}
 private static class SdpAdapter implements SdpObserver{public void onCreateSuccess(SessionDescription s){}public void onSetSuccess(){}public void onCreateFailure(String ignored){}public void onSetFailure(String ignored){}}
}
