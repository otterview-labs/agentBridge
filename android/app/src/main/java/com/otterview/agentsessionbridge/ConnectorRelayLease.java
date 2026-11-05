package com.otterview.agentsessionbridge;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.TimeUnit;

/** Schedule renewal from verified offer ICE, without extending the host's finite lease. */
final class ConnectorRelayLease {
 private ConnectorRelayLease(){}
 static long renewAt(JSONArray servers,long wallMillis,long nanoTime)throws Exception{
  long deadline=Long.MAX_VALUE;
  for(int i=0;i<servers.length();i++){
   JSONObject server=servers.getJSONObject(i);JSONArray urls=server.getJSONArray("urls");boolean turn=false;
   for(int j=0;j<urls.length();j++){String url=urls.getString(j);if(url.startsWith("turn:")||url.startsWith("turns:"))turn=true;}
   if(!turn)continue;
   String username=server.getString("username");int colon=username.indexOf(':');
   if(colon<1||colon==username.length()-1)throw new IllegalArgumentException("TURN expiry missing");
   long seconds=Long.parseLong(username.substring(0,colon));
   if(seconds<=0||seconds>Long.MAX_VALUE/1000)throw new IllegalArgumentException("TURN expiry invalid");
   long finite=seconds*1000-30000;
   if(finite<=wallMillis)throw new IllegalArgumentException("TURN lease expired");
   deadline=Math.min(deadline,Math.min(finite,wallMillis+570000));
  }
  if(deadline==Long.MAX_VALUE)return Long.MAX_VALUE;
  // Preserve 90s of lease headroom and start preparing a relay replacement by 4m.
  // The overlap is brief: ordinary use still owns just one active channel.
  return nanoTime+TimeUnit.MILLISECONDS.toNanos(Math.max(0,Math.min(240000,deadline-wallMillis-90000)));
 }
}
