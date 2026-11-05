package com.otterview.agentsessionbridge;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import org.webrtc.NetworkMonitor;
import org.json.JSONObject;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;

/** Passive, bounded snapshots. Never starts monitoring or controls RTC readiness. */
final class ConnectorNetworkDiagnostics {
 static final int MAX_COUNT=4096,MAX_INTERFACES=128,MAX_ADDRESSES=128;
 enum Stage{BEFORE_PEER,AFTER_PEER,GATHER_COMPLETE,ANSWER_SENT,ICE_FAILED}
 enum Kind{NONE,CELLULAR,WIFI,ETHERNET,VPN,OTHER,UNKNOWN}
 interface Sink{void accept(Snapshot snapshot);}
 private static final ThreadPoolExecutor POOL=new ThreadPoolExecutor(1,1,30,TimeUnit.SECONDS,new ArrayBlockingQueue<>(4),r->{Thread t=new Thread(r,"connector-network-probe");t.setDaemon(true);return t;});
 static{POOL.allowCoreThreadTimeOut(true);}
 static long monotonicMs(){return System.nanoTime()/1_000_000;}
 static int bound(int value){return Math.max(0,Math.min(MAX_COUNT,value));}
 static final class Snapshot{
  final Stage stage;boolean completed,osKnown,active,cellular,wifi,vpn,internet,validated,notVpn,addressCountsKnown,sdkKnown,sdkNotNone;
  Kind kind=Kind.UNKNOWN;int interfaces,ipv4,ipv6,sdkObservers=-1;long queuedMs,collectMs;
  Snapshot(Stage stage){this.stage=stage;}
  JSONObject publicValues()throws Exception{return new JSONObject().put("stage",stage.name()).put("completed",completed).put("queuedMs",queuedMs).put("collectMs",collectMs).put("osKnown",osKnown).put("active",active).put("type",kind.name()).put("cellular",cellular).put("wifi",wifi).put("vpn",vpn).put("internet",internet).put("validated",validated).put("notVpn",notVpn).put("addressCountsKnown",addressCountsKnown).put("interfaces",interfaces).put("ipv4",ipv4).put("ipv6",ipv6).put("sdkKnown",sdkKnown).put("sdkObservers",sdkObservers).put("sdkNotNone",sdkNotNone);}
  String safeLine(){return "stage="+stage.name()+" completed="+completed+" queuedMs="+queuedMs+" collectMs="+collectMs+" osKnown="+osKnown+" active="+active+" type="+kind.name()+" cellular="+cellular+" wifi="+wifi+" vpn="+vpn+" internet="+internet+" validated="+validated+" notVpn="+notVpn+" addressCountsKnown="+addressCountsKnown+" interfaces="+interfaces+" ipv4="+ipv4+" ipv6="+ipv6+" sdkKnown="+sdkKnown+" sdkObservers="+sdkObservers+" sdkNotNone="+sdkNotNone;}
 }
 static void os(Context context,Snapshot out){try{
  ConnectivityManager manager=(ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE);if(manager==null)return;
  Network network=manager.getActiveNetwork();out.active=network!=null;if(network==null){out.osKnown=true;out.kind=Kind.NONE;return;}
  NetworkCapabilities caps=manager.getNetworkCapabilities(network);if(caps==null)return;
  out.osKnown=true;out.cellular=caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR);out.wifi=caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);out.vpn=caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
  out.kind=out.vpn?Kind.VPN:out.cellular?Kind.CELLULAR:out.wifi?Kind.WIFI:caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)?Kind.ETHERNET:Kind.OTHER;
  out.internet=caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET);out.validated=caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);out.notVpn=caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN);
 }catch(Exception ignored){out.osKnown=false;out.kind=Kind.UNKNOWN;}}
 static boolean addAddresses(Enumeration<InetAddress> addresses,Snapshot out){int seen=0;while(addresses.hasMoreElements()){if(seen++>=MAX_ADDRESSES)return false;InetAddress address=addresses.nextElement();if(address==null||address.isLoopbackAddress()||address.isAnyLocalAddress())continue;if(address instanceof Inet4Address)out.ipv4=bound(out.ipv4+1);else if(address instanceof Inet6Address)out.ipv6=bound(out.ipv6+1);}return true;}
 static void addresses(Snapshot out){try{Enumeration<NetworkInterface> list=NetworkInterface.getNetworkInterfaces();if(list==null)return;boolean complete=true;int seen=0;while(list.hasMoreElements()){if(seen++>=MAX_INTERFACES){complete=false;break;}NetworkInterface network=list.nextElement();if(network==null||network.isLoopback()||!network.isUp())continue;out.interfaces=bound(out.interfaces+1);if(!addAddresses(network.getInetAddresses(),out))complete=false;}out.addressCountsKnown=complete;}catch(Exception ignored){out.addressCountsKnown=false;}}
 static void sdk(Snapshot out){try{int observers=NetworkMonitor.getInstance().getNumObservers();if(observers<0)return;out.sdkObservers=bound(observers);out.sdkNotNone=NetworkMonitor.isOnline();out.sdkKnown=true;}catch(RuntimeException|LinkageError ignored){out.sdkKnown=false;}}
 static Snapshot capture(Context context,Stage stage,long requested){long began=monotonicMs();Snapshot out=new Snapshot(stage);out.queuedMs=Math.max(0,Math.min(60000,began-requested));os(context,out);addresses(out);sdk(out);out.collectMs=Math.max(0,Math.min(60000,monotonicMs()-began));out.completed=true;return out;}
 static final class Probes{
  private final Context context;private final Sink sink;private final EnumSet<Stage> requested=EnumSet.noneOf(Stage.class);private final List<FutureTask<Void>> tasks=new ArrayList<>();private boolean closed;
  Probes(Context context,Sink sink){this.context=context.getApplicationContext();this.sink=sink;}
  synchronized void request(Stage stage){if(closed||!requested.add(stage))return;long began=monotonicMs();FutureTask<Void> task=new FutureTask<>(()->{Snapshot value=capture(context,stage,began);synchronized(this){if(closed)return null;}sink.accept(value);return null;});tasks.add(task);try{POOL.execute(task);}catch(RejectedExecutionException ignored){tasks.remove(task);sink.accept(new Snapshot(stage));}}
  synchronized void cancel(){closed=true;for(FutureTask<Void> task:tasks)task.cancel(true);tasks.clear();POOL.purge();}
 }
}
