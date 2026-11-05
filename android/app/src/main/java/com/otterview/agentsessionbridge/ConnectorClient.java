package com.otterview.agentsessionbridge;

import org.json.*;
import okhttp3.*;
import javax.net.ssl.*;
import java.security.*;
import java.security.cert.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.TimeUnit;

/** Native-only credentials and HTTPS transport. Returned objects are public projections. */
final class ConnectorClient {
  private final BridgeStore store;
  private JSONObject active;
  private ConnectorPolicy pending;
  private String pairingId,pollToken,code;
  private boolean pairingNetworkCompatibility,pendingNetworkCompatibility;
  interface Factory{ConnectorTransport create(ConnectorPolicy config,String secret,String authType,String deviceId,boolean networkCompatibility)throws Exception;}
  private final Factory factory;
  private volatile ConnectorTransport transport,connectingTransport;private volatile boolean foreground=true;private final Object transportLock=new Object();
  ConnectorClient(BridgeStore store){this(store,null);}
  ConnectorClient(BridgeStore store,Factory factory){this.store=store;this.factory=factory;}
  JSONObject transportState(){ConnectorTransport current=connectingTransport!=null?connectingTransport:transport;if(current!=null)return current.publicState();try{return new JSONObject().put("state","disconnected").put("path","unknown");}catch(Exception e){return new JSONObject();}}
  private ConnectorTransport make(ConnectorPolicy config,String secret,String type,String device)throws Exception{if(config.version==1)return new PinnedConnectorTransport();if(factory==null)throw new ConnectorException("rtc_unavailable","当前版本未提供跨网络连接");try{boolean compatibility="pair".equals(type)?pairingNetworkCompatibility:Boolean.TRUE.equals(active.opt("networkCompatibility"));ConnectorTransport first=factory.create(config,secret,type,device,compatibility);if(!"device".equals(type))return first;return new ConnectorHandoverTransport(first,()->factory.create(config,secret,type,device,compatibility),config.endpoint,config.host,config.pin,secret,active.getJSONObject("computer").getString("id"));}catch(LinkageError error){throw new ConnectorException("rtc_unavailable","跨网络组件未能加载");}}
  private ConnectorPolicy storedPolicy()throws Exception{int version=active.optInt("version",1);String query=version==2?"v=2&signal="+java.net.URLEncoder.encode(active.getString("endpoint"),"UTF-8")+"&signalPin="+active.getString("signalPin")+"&room="+active.getString("room"):"v=1&endpoint="+java.net.URLEncoder.encode(active.getString("endpoint"),"UTF-8");return ConnectorPolicy.parse("agentbridge://pair?"+query+"&pin="+active.getString("pin")+"&token=0000000000000000000000000000000000000000000",BuildConfig.DEBUG);}
  void setForeground(boolean value){foreground=value;if(!value)suspend();}
  void networkChanged(){ConnectorTransport current=transport;if(foreground&&current!=null)current.networkChanged();}
  private void register(ConnectorTransport value,boolean connecting)throws Exception{synchronized(transportLock){if(!foreground){value.close();throw new ConnectorException("background","请返回应用后重新连接");}if(connecting)connectingTransport=value;else transport=value;}}
  void suspend(){ConnectorTransport current,attempt;synchronized(transportLock){current=transport;attempt=connectingTransport;transport=null;connectingTransport=null;}if(current!=null)current.close();if(attempt!=null&&attempt!=current)attempt.close();}
  private void restore() throws Exception {if(active==null)active=store.connector();}
  synchronized JSONObject state() throws Exception {
    restore();JSONObject out=new JSONObject().put("paired",active.has("deviceToken")).put("pending",pending!=null).put("pairingNetworkCompatibility",pairingNetworkCompatibility).put("connection",transportState());
    if(active.has("deviceToken")){JSONArray pendingRequests=new JSONArray();JSONObject outbox=active.optJSONObject("outbox");if(outbox!=null){Iterator<String> ids=outbox.keys();while(ids.hasNext())pendingRequests.put(project(outbox.getJSONObject(ids.next()),"requestId","sessionId","computerId","text","operationId","status"));}out.put("pendingRequests",pendingRequests).put("networkCompatibility",Boolean.TRUE.equals(active.opt("networkCompatibility")));out.put("endpoint",active.getString("endpoint")).put("computer",active.getJSONObject("computer")).put("usbDevelopment",active.optBoolean("usbDevelopment")).put("transport",active.optInt("version",1)==2?"webrtc":"https");}
    if(pending!=null)out.put("confirmationCode",code).put("pairingEndpoint",pending.endpoint).put("usbDevelopment",pending.usbDevelopment).put("transport",pending.version==2?"webrtc":"https");
    return out;
  }
  synchronized JSONObject pair(String uri) throws Exception {
    ConnectorPolicy config=ConnectorPolicy.parse(uri,BuildConfig.DEBUG);
    String id=UUID.randomUUID().toString();ConnectorTransport attempt=make(config,config.pairingToken,"pair","");register(attempt,true);JSONObject response;
    try{response=attempt.request(config.endpoint,config.host,config.pin,null,"POST","/v1/pair",new JSONObject().put("pairingToken",config.pairingToken).put("deviceName",android.os.Build.MANUFACTURER+" "+android.os.Build.MODEL).put("deviceId",id));}catch(Exception error){attempt.close();connectingTransport=null;throw error;}
    String nextId,nextPoll,nextCode;
    try{nextId=response.getString("pairingId");nextPoll=response.getString("pollToken");nextCode=response.getString("confirmationCode");if(!"pending".equals(response.optString("status"))||nextPoll.length()<20||nextPoll.length()>512||nextId.length()>128||!nextCode.matches("[A-Za-z0-9 -]{4,32}"))throw new IOException("Invalid pairing response");}catch(Exception error){attempt.close();connectingTransport=null;throw error;}
    ConnectorTransport previous;synchronized(transportLock){if(!foreground){attempt.close();connectingTransport=null;throw new ConnectorException("background","请返回应用后重新连接");}previous=transport;transport=attempt;connectingTransport=null;}if(previous!=null)previous.close();
    pending=config;pendingNetworkCompatibility=config.version==2&&pairingNetworkCompatibility;pairingId=nextId;pollToken=nextPoll;code=nextCode;return state();
  }
  synchronized JSONObject pollPair() throws Exception {
    if(pending==null)return state();
    // A v2 invitation is bound to its original encrypted channel. Once that
    // channel is gone, approval cannot be collected by opening another one.
    if(transport==null){if(pending.version==1)register(new PinnedConnectorTransport(),false);else{clearPending();return state().put("pairingStatus","expired");}}
    JSONObject response;
    try{response=transport.request(pending.endpoint,pending.host,pending.pin,null,"POST","/v1/pair/status",new JSONObject().put("pairingId",pairingId).put("pollToken",pollToken));}
    catch(ConnectorException error){if(pending.version==2&&Arrays.asList("pairing_disconnected","rtc_closed","rtc_disconnected","rtc_timeout","rtc_connect_failed","authorization_failed").contains(error.code)){suspend();clearPending();return state().put("pairingStatus","expired");}throw error;}
    String status=response.optString("status");
    if("approved".equals(status)){
      String token=response.getString("deviceToken");if(token.length()<20||token.length()>1024||!token.matches("[A-Za-z0-9_-]+"))throw new IOException("Invalid device credential");
      JSONObject computer=project(response.getJSONObject("computer"),"id","name");if(!computer.has("id")||!computer.has("name"))throw new IOException("Missing computer identity");
      JSONObject saved=new JSONObject().put("endpoint",pending.endpoint).put("host",pending.host).put("pin",pending.pin).put("deviceToken",token).put("deviceId",response.getString("deviceId")).put("computer",computer).put("usbDevelopment",pending.usbDevelopment);
      saved.put("version",pending.version);if(pending.version==2)saved.put("signalPin",pending.signalPin).put("room",pending.room).put("networkCompatibility",pendingNetworkCompatibility);
      store.saveConnector(saved);active=saved;if(pending.version==2){ConnectorTransport paired=transport;transport=null;if(paired!=null)paired.close();}clearPending();return state().put("pairingStatus","approved");
    }
    if("denied".equals(status)||"expired".equals(status)){suspend();clearPending();return state().put("pairingStatus",status);}
    if(!"pending".equals(status))throw new IOException("Invalid pairing state");return state().put("pairingStatus","pending");
  }
  private void clearPending(){pairingNetworkCompatibility=false;pendingNetworkCompatibility=false;pending=null;pairingId=null;pollToken=null;code=null;}
  synchronized JSONObject action(String action,JSONObject args) throws Exception {
    if("state".equals(action))return state();if(!foreground)throw new ConnectorException("background","请返回应用后重新连接");if("setPairingNetworkCompatibility".equals(action)){if(pending!=null||!(args.opt("enabled") instanceof Boolean))throw new IllegalArgumentException("Invalid pairing network setting");pairingNetworkCompatibility=(Boolean)args.get("enabled");return state();}if("pair".equals(action))return pair(args.getString("uri"));if("pollPair".equals(action))return pollPair();
    if("forget".equals(action)){store.saveConnector(new JSONObject());suspend();active=new JSONObject();clearPending();return state();}
    restore();if(pending!=null)throw new ConnectorException("pairing_pending","请先完成电脑配对审批");if(!active.has("deviceToken"))throw new IllegalStateException("Not paired");
    if(!active.getJSONObject("computer").getString("id").equals(args.optString("computerId")))throw new IllegalArgumentException("Computer binding changed");
    if("setNetworkCompatibility".equals(action)){if(active.optInt("version",1)!=2||!(args.opt("enabled") instanceof Boolean))throw new IllegalArgumentException("Invalid network compatibility setting");suspend();JSONObject saved=new JSONObject(active.toString()).put("networkCompatibility",args.get("enabled"));store.saveConnector(saved);active=saved;return state();}
    JSONObject outbox=active.optJSONObject("outbox");if(outbox==null){outbox=new JSONObject();active.put("outbox",outbox);}
    if("resolveSend".equals(action)){String sessionId=ConnectorPolicy.uuid(args.getString("sessionId"));JSONObject kept=outbox.optJSONObject(sessionId);if(kept!=null&&Arrays.asList("queued","running").contains(kept.optString("status")))throw new IllegalArgumentException("Send still active");outbox.remove(sessionId);store.saveConnector(active);return state();}
    String method="GET",route;
    switch(action){case "status":route="/v1/status";break;case "sessions":route="/v1/sessions";break;case "session":route="/v1/sessions/"+ConnectorPolicy.uuid(args.getString("sessionId"));break;case "send":route="/v1/sessions/"+ConnectorPolicy.uuid(args.getString("sessionId"))+"/messages";method="POST";break;case "operation":route="/v1/operations/"+ConnectorPolicy.uuid(args.getString("operationId"));break;default:throw new IllegalArgumentException("Unknown connector action");}
    JSONObject body=null;if("send".equals(action)){String text=args.getString("text");if(text.trim().isEmpty()||text.length()>16000)throw new IllegalArgumentException("Invalid reply text");String requestId=ConnectorPolicy.uuid(args.getString("requestId")),sessionId=ConnectorPolicy.uuid(args.getString("sessionId"));JSONObject kept=outbox.optJSONObject(sessionId);if(kept!=null&&(!requestId.equals(kept.optString("requestId"))||!text.equals(kept.optString("text"))))throw new IllegalArgumentException("Unresolved send exists");
      outbox.put(sessionId,new JSONObject().put("requestId",requestId).put("sessionId",sessionId).put("computerId",args.getString("computerId")).put("text",text).put("status","unknown"));store.saveConnector(active);
      body=new JSONObject().put("text",text).put("requestId",requestId);}
    JSONObject response=request(active.getString("endpoint"),active.getString("host"),active.getString("pin"),active.getString("deviceToken"),method,route,body),out=new JSONObject();
    if("status".equals(action)){if(!active.getJSONObject("computer").getString("id").equals(response.getJSONObject("computer").optString("id")))throw new ConnectorException("computer_changed","电脑身份发生变化，请重新配对");JSONArray caps=new JSONArray(),rawCaps=response.optJSONArray("capabilities");if(rawCaps!=null)for(int i=0;i<rawCaps.length();i++)if(Arrays.asList("codex.sessions.read","codex.sessions.reply","agentharbor.sessions.read","agentharbor.sessions.reply").contains(rawCaps.optString(i)))caps.put(rawCaps.getString(i));out.put("computer",project(response.getJSONObject("computer"),"id","name")).put("online",response.optBoolean("online")).put("capabilities",caps).put("connection",transportState());return out;}
    if(response.has("operation")){JSONObject op=response.getJSONObject("operation");JSONObject safe=project(op,"id","sessionId","status");JSONObject kept=outbox.optJSONObject(op.optString("sessionId"));if(kept!=null){kept.put("operationId",op.getString("id")).put("status",op.getString("status"));if("completed".equals(op.optString("status")))outbox.remove(op.getString("sessionId"));store.saveConnector(active);}if(op.has("error"))safe.put("error","发送操作失败，请核对电脑连接器记录；不会自动重发。");return out.put("operation",safe);}
    if(response.has("session"))out.put("session",session(response.getJSONObject("session")));
    if(response.has("sessions")){JSONArray list=new JSONArray(),raw=response.getJSONArray("sessions");for(int i=0;i<Math.min(100,raw.length());i++)list.put(session(raw.getJSONObject(i)));out.put("sessions",list);}
    if(response.has("messages")){JSONArray list=new JSONArray(),raw=response.getJSONArray("messages");for(int i=0;i<Math.min(200,raw.length());i++)list.put(project(raw.getJSONObject(i),"id","role","text","timestamp"));out.put("messages",list);}
    out.put("hasMore",response.optBoolean("hasMore")||response.optJSONArray("sessions")!=null&&response.getJSONArray("sessions").length()>100||response.optJSONArray("messages")!=null&&response.getJSONArray("messages").length()>200);return out;
  }
  private static JSONObject session(JSONObject value)throws Exception{return project(value,"id","title","agent","updatedAt","projectPath","status","canReply","replyReason","replyNotice");}
  private static JSONObject project(JSONObject value,String...keys)throws Exception{JSONObject out=new JSONObject();for(String key:keys)if(value.has(key)){Object item=value.get(key);if(item instanceof String||item instanceof Number||item instanceof Boolean)out.put(key,item);}return out;}
  private JSONObject request(String origin,String host,String pin,String token,String method,String route,JSONObject body)throws Exception{ConnectorTransport current=transport;if(current==null){current=make(storedPolicy(),active.getString("deviceToken"),"device",active.getString("deviceId"));register(current,false);}return current.request(origin,host,pin,token,method,route,body);}
  void close(){suspend();}
}
