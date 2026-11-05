package com.otterview.agentsessionbridge;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import java.util.Objects;

/** One foreground callback. Initial/duplicate/unvalidated events never open sockets. */
final class ConnectorNetworkMonitor {
 private final ConnectivityManager manager;private final Runnable changed;
 private Watch watch;
 ConnectorNetworkMonitor(Context context,Runnable changed){this((ConnectivityManager)context.getSystemService(Context.CONNECTIVITY_SERVICE),changed);}
 ConnectorNetworkMonitor(ConnectivityManager manager,Runnable changed){this.manager=manager;this.changed=changed;}
 synchronized void start(){
  if(manager==null||watch!=null)return;
  Watch next=new Watch();
  try{next.last=manager.getActiveNetwork();next.available=next.last;watch=next;manager.registerDefaultNetworkCallback(next);}
  catch(RuntimeException ignored){watch=null;}
 }
 void stop(){
  Watch previous;synchronized(this){previous=watch;watch=null;}
  if(previous!=null)try{manager.unregisterNetworkCallback(previous);}catch(RuntimeException ignored){}
 }
 private final class Watch extends ConnectivityManager.NetworkCallback {
  Network available,last;boolean lost;
  @Override public void onAvailable(Network network){synchronized(ConnectorNetworkMonitor.this){if(watch==this)available=network;}}
  @Override public void onLost(Network network){synchronized(ConnectorNetworkMonitor.this){if(watch==this&&Objects.equals(available,network)){available=null;lost=true;}}}
  @Override public void onCapabilitiesChanged(Network network,NetworkCapabilities capabilities){
   boolean notify;
   synchronized(ConnectorNetworkMonitor.this){
    if(watch!=this||!Objects.equals(available,network)||!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)||!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))return;
    notify=last!=null&&(!Objects.equals(last,network)||lost);last=network;lost=false;
   }
   if(notify)changed.run();
  }
 }
}
