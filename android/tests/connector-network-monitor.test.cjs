const{test}=require('node:test');const{harness}=require('./java-json-fixture.cjs');
test('default-network callback waits for validation, deduplicates, ignores stale networks and unregisters on stop',t=>{
 harness(t,'NetworkMonitorHarness',`
 static class Context{static final String CONNECTIVITY_SERVICE="connectivity";Object getSystemService(String s){return null;}}
 static class Network{final int id;Network(int id){this.id=id;}public boolean equals(Object o){return o instanceof Network&&((Network)o).id==id;}public int hashCode(){return id;}}
 static class NetworkCapabilities{static final int NET_CAPABILITY_INTERNET=1,NET_CAPABILITY_VALIDATED=2;final boolean internet,valid;NetworkCapabilities(boolean i,boolean v){internet=i;valid=v;}boolean hasCapability(int c){return c==1?internet:valid;}}
 static class ConnectivityManager{
  static class NetworkCallback{public void onAvailable(Network n){}public void onLost(Network n){}public void onCapabilitiesChanged(Network n,NetworkCapabilities c){}}
  Network active=new Network(1);NetworkCallback callback;int registrations,unregistrations;boolean fail;
  Network getActiveNetwork(){return active;}void registerDefaultNetworkCallback(NetworkCallback c){if(fail)throw new SecurityException();callback=c;registrations++;}void unregisterNetworkCallback(NetworkCallback c){check(c==callback);unregistrations++;}
 }
 public static void main(String[]args){
  ConnectivityManager manager=new ConnectivityManager();java.util.concurrent.atomic.AtomicInteger calls=new java.util.concurrent.atomic.AtomicInteger();ConnectorNetworkMonitor monitor=new ConnectorNetworkMonitor(manager,calls::incrementAndGet);
  Network one=new Network(1),two=new Network(2),three=new Network(3);NetworkCapabilities good=new NetworkCapabilities(true,true),portal=new NetworkCapabilities(true,false);
  monitor.start();monitor.start();check(manager.registrations==1);ConnectivityManager.NetworkCallback old=manager.callback;
  old.onAvailable(one);old.onCapabilitiesChanged(one,good);old.onCapabilitiesChanged(one,good);check(calls.get()==0);
  old.onAvailable(two);old.onCapabilitiesChanged(two,portal);old.onCapabilitiesChanged(one,good);check(calls.get()==0);
  old.onCapabilitiesChanged(two,good);old.onCapabilitiesChanged(two,good);check(calls.get()==1);
  old.onLost(one);old.onCapabilitiesChanged(two,good);check(calls.get()==1);
  old.onLost(two);old.onAvailable(two);old.onCapabilitiesChanged(two,good);check(calls.get()==2);
  monitor.stop();monitor.stop();old.onAvailable(three);old.onCapabilitiesChanged(three,good);check(calls.get()==2&&manager.unregistrations==1);
  manager.active=two;monitor.start();old.onAvailable(three);old.onCapabilitiesChanged(three,good);check(calls.get()==2);manager.callback.onAvailable(two);manager.callback.onCapabilitiesChanged(two,good);check(calls.get()==2);
  manager.callback.onAvailable(three);manager.callback.onCapabilitiesChanged(three,new NetworkCapabilities(false,true));check(calls.get()==2);manager.callback.onCapabilitiesChanged(three,good);check(calls.get()==3);monitor.stop();
  manager.fail=true;monitor.start();monitor.stop();check(manager.unregistrations==2);manager.fail=false;manager.active=null;monitor.start();manager.callback.onAvailable(one);manager.callback.onCapabilitiesChanged(one,good);check(calls.get()==3);monitor.stop();
  new ConnectorNetworkMonitor((ConnectivityManager)null,()->{throw new AssertionError();}).start();
  System.out.println("ok");
 }
 `,['ConnectorNetworkMonitor.java']);
});
