package com.otterview.agentsessionbridge;
import android.webkit.JavascriptInterface;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;
/** Local-only async interface. Device/poll credentials never enter a returned object. */
final class ConnectorBridge {
 private final MainActivity activity;private final ConnectorClient client;
 private final ConnectorNetworkMonitor networks;
 private final ExecutorService executor=Executors.newSingleThreadExecutor();
 private final Map<Integer,JSONObject> jobs=new LinkedHashMap<>();private int sequence;private volatile int latestPairJob;
 ConnectorBridge(MainActivity activity){this.activity=activity;client=new ConnectorClient(BridgeStore.get(activity.getApplicationContext()),(config,secret,type,device,compat)->new ConnectorRtcTransport(activity.getApplicationContext(),config,secret,type,device,compat));networks=new ConnectorNetworkMonitor(activity.getApplicationContext(),client::networkChanged);}
 @JavascriptInterface public String connection(){return client.transportState().toString();}
 @JavascriptInterface public int pairingJob(){int value=latestPairJob;latestPairJob=0;return value;}
 @JavascriptInterface public void scan(){activity.runOnUiThread(activity::startConnectorScan);}
 @JavascriptInterface public String begin(String action,String json){try{
  if(!Arrays.asList("state","pair","pollPair","forget","status","sessions","session","send","operation","resolveSend","setNetworkCompatibility","setPairingNetworkCompatibility").contains(action)||json.length()>20000)throw new IllegalArgumentException();
  JSONObject args=new JSONObject(json);final int id;synchronized(jobs){if(jobs.size()>=16)throw new IllegalStateException();id=++sequence;jobs.put(id,new JSONObject().put("state","running"));}
  executor.execute(()->{JSONObject result;try{result=new JSONObject().put("ok",true).put("data",client.action(action,args));}catch(Exception error){try{result=publicError(error);}catch(Exception impossible){result=new JSONObject();}}try{synchronized(jobs){jobs.put(id,new JSONObject().put("state","done").put("result",result));}}catch(Exception ignored){}});
  return new JSONObject().put("ok",true).put("id",id).toString();
 }catch(Exception error){return "{\"ok\":false,\"error\":\"无法开始连接器操作\"}";}}
 static JSONObject publicError(Exception error)throws Exception{
  String code="connection_failed",message="电脑连接中断，请刷新连接；不会自动重发回复";
  if(error instanceof ConnectorException){code=((ConnectorException)error).code;message=error.getMessage();}
  else if(error instanceof IllegalArgumentException){code="invalid_input";message="配对地址或操作参数无效";}
  else if(error instanceof IllegalStateException){code="storage_or_state_unavailable";message="配对状态或加密存储不可用，请检查后重试";}
  else{for(Throwable cause=error;cause!=null;cause=cause.getCause())if(cause instanceof javax.net.ssl.SSLException||cause instanceof java.security.cert.CertificateException){code="certificate_rejected";message="电脑证书或地址校验失败，请重新扫描电脑上的二维码";break;}}
  return new JSONObject().put("ok",false).put("code",code).put("error",message);
 }
 @JavascriptInterface public String result(int id){synchronized(jobs){JSONObject job=jobs.get(id);if(job==null)return "{\"state\":\"missing\"}";if("done".equals(job.optString("state")))jobs.remove(id);else try{job.put("connection",client.transportState());}catch(Exception ignored){}return job.toString();}}
 void acceptUri(String uri){try{ConnectorPolicy.parse(uri,BuildConfig.DEBUG);int id=new JSONObject(begin("pair",new JSONObject().put("uri",uri).toString())).optInt("id",0);latestPairJob=id;activity.connectorEvent(id>0?"pairing":"error",id);}catch(Exception ignored){activity.connectorEvent("invalid_uri",0);}}
 void suspend(){client.setForeground(false);networks.stop();}
 void resume(){client.setForeground(true);networks.start();}
 void close(){client.setForeground(false);networks.stop();client.close();executor.shutdownNow();}
}
