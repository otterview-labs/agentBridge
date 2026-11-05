package com.otterview.agentsessionbridge;

import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;

/** Make-before-break for approved devices only. Never retries an application RPC. */
final class ConnectorHandoverTransport implements ConnectorTransport {
 interface Factory{ConnectorTransport create()throws Exception;}
 private static final class Slot{final ConnectorTransport transport;int users;Slot(ConnectorTransport value){transport=value;}}
 private final Object lock=new Object();private final Factory factory;private final String origin,host,pin,bearer,computerId;
 private final ExecutorService worker=Executors.newSingleThreadExecutor(task->{Thread thread=new Thread(task,"connector-renewal");thread.setDaemon(true);return thread;});
 private Slot active,retiring;private ConnectorTransport candidate;
 private boolean closed,warming,renewalDisabled,verified;private long retryAt,networkGeneration,activeNetworkGeneration;private int handovers,networkHandovers;
 ConnectorHandoverTransport(ConnectorTransport initial,Factory factory,String origin,String host,String pin,String bearer,String computerId){
  active=new Slot(initial);this.factory=factory;this.origin=origin;this.host=host;this.pin=pin;this.bearer=bearer;this.computerId=computerId;
 }
 public JSONObject publicState(){synchronized(lock){try{return active.transport.publicState().put("renewalState",closed?"stopped":warming?"preparing":renewalDisabled?"blocked":retryAt!=0&&System.nanoTime()-retryAt<0?"retry_wait":"idle").put("handoverCount",handovers).put("networkChangeCount",networkGeneration).put("networkHandoverCount",networkHandovers);}catch(Exception ignored){return new JSONObject();}}}
 public void networkChanged(){
  ConnectorTransport obsolete;
  synchronized(lock){if(closed)return;networkGeneration++;retryAt=0;obsolete=candidate;}
  if(obsolete!=null)obsolete.close();
  prepareRenewal();
 }
 public JSONObject request(String origin,String host,String pin,String bearer,String method,String route,JSONObject body)throws Exception{
  Slot selected;synchronized(lock){if(closed)throw new ConnectorException("rtc_closed","跨网络连接已关闭");selected=active;selected.users++;}
  boolean success=false;
  try{JSONObject result=selected.transport.request(origin,host,pin,bearer,method,route,body);success=true;
   if("GET".equals(method)&&"/v1/status".equals(route)&&result.optBoolean("online")&&result.optJSONObject("computer")!=null&&computerId.equals(result.getJSONObject("computer").optString("id")))synchronized(lock){verified=true;}
   return result;}
  finally{
   ConnectorTransport drained=null;
   synchronized(lock){selected.users--;if(retiring==selected&&selected.users==0){drained=selected.transport;retiring=null;}}
   if(drained!=null)drained.close();
   if(success||drained!=null)prepareRenewal();
  }
 }
 private void prepareRenewal(){
  synchronized(lock){
   if(closed||renewalDisabled||warming||retiring!=null||retryAt!=0&&System.nanoTime()-retryAt<0)return;
   boolean migration=networkGeneration!=activeNetworkGeneration;
   if(migration?!verified:!active.transport.renewalDue())return;
   Slot source=active;long target=networkGeneration;
   warming=true;
   try{worker.execute(()->renew(source,target));}catch(RejectedExecutionException ignored){warming=false;}
  }
 }
 private void renew(Slot source,long target){
  ConnectorTransport next=null,drained=null;
  try{
   next=factory.create();
   synchronized(lock){if(closed||active!=source||target!=networkGeneration)return;candidate=next;}
   JSONObject health=next.request(origin,host,pin,bearer,"GET","/v1/status",null);
   if(!computerId.equals(health.getJSONObject("computer").getString("id")))throw new ConnectorException("computer_changed","电脑身份发生变化，请重新配对");
   if(!health.optBoolean("online"))throw new ConnectorException("connector_unavailable","电脑当前离线");
   if(!"connected".equals(next.publicState().optString("state")))throw new ConnectorException("rtc_disconnected","新连接尚未就绪");
   synchronized(lock){
    if(closed||active!=source||candidate!=next||target!=networkGeneration)return;
    active=new Slot(next);candidate=null;next=null;retryAt=0;if(handovers<Integer.MAX_VALUE)handovers++;
    if(target!=activeNetworkGeneration&&networkHandovers<Integer.MAX_VALUE)networkHandovers++;activeNetworkGeneration=target;
    if(source.users==0)drained=source.transport;else retiring=source;
   }
  }catch(Exception|LinkageError error){
   synchronized(lock){
    if(target!=networkGeneration)return;
    retryAt=System.nanoTime()+TimeUnit.SECONDS.toNanos(30);
    if(error instanceof ConnectorException){String code=((ConnectorException)error).code;if(code.equals("authorization_failed")||code.equals("computer_changed")||code.equals("certificate_rejected"))renewalDisabled=true;}
    for(Throwable cause=error;cause!=null;cause=cause.getCause())if(cause instanceof javax.net.ssl.SSLException||cause instanceof java.security.cert.CertificateException)renewalDisabled=true;
   }
  }finally{
   boolean superseded;synchronized(lock){if(candidate==next)candidate=null;warming=false;superseded=target!=networkGeneration;}
   if(next!=null)next.close();if(drained!=null)drained.close();
   if(superseded)prepareRenewal();
  }
 }
 public void close(){
  ConnectorTransport first,pending,old;
  synchronized(lock){if(closed)return;closed=true;first=active.transport;pending=candidate;candidate=null;old=retiring==null?null:retiring.transport;retiring=null;}
  first.close();if(pending!=null)pending.close();if(old!=null)old.close();worker.shutdownNow();
 }
}
