const{test}=require('node:test');const{harness}=require('./java-json-fixture.cjs');
test('verified make-before-break keeps old RPCs alive, drains once, refuses replay and cancels late replacements',t=>{
 harness(t,'HandoverHarness',`
 static class Fake implements ConnectorTransport{
  volatile boolean due,closed;volatile Exception failure,postFailure;volatile String computer="computer-1";
  final java.util.concurrent.atomic.AtomicInteger posts=new java.util.concurrent.atomic.AtomicInteger(),reads=new java.util.concurrent.atomic.AtomicInteger(),closes=new java.util.concurrent.atomic.AtomicInteger();
  CountDownLatch entered,release,postEntered,postRelease;
  public boolean renewalDue(){return due;}
  public JSONObject publicState(){return new JSONObject().put("kind","webrtc").put("state",closed?"disconnected":"connected").put("path","relay");}
  public JSONObject request(String o,String h,String p,String token,String method,String route,JSONObject body)throws Exception{
   if(closed)throw new IOException("closed");
   if(method.equals("POST")){posts.incrementAndGet();if(postEntered!=null)postEntered.countDown();if(postRelease!=null)postRelease.await();if(postFailure!=null)throw postFailure;return new JSONObject().put("accepted",true);}
   reads.incrementAndGet();if(entered!=null)entered.countDown();if(release!=null)try{release.await();}catch(InterruptedException ignored){}if(failure!=null)throw failure;
   return new JSONObject().put("online",true).put("computer",new JSONObject().put("id",computer));
  }
  public synchronized void close(){if(!closed){closed=true;closes.incrementAndGet();}}
 }
 static ConnectorHandoverTransport wrapper(Fake old,ConnectorHandoverTransport.Factory factory){return new ConnectorHandoverTransport(old,factory,"wss://fixture","fixture","pin","SECRET_FIXTURE","computer-1");}
 static JSONObject read(ConnectorHandoverTransport value)throws Exception{return value.request("wss://fixture","fixture","pin","SECRET_FIXTURE","GET","/v1/status",null);}
 static JSONObject post(ConnectorHandoverTransport value)throws Exception{return value.request("wss://fixture","fixture","pin","SECRET_FIXTURE","POST","/v1/sessions/fixture/messages",new JSONObject().put("text","original").put("requestId","original-id"));}
 static void await(CountDownLatch latch)throws Exception{check(latch.await(3,TimeUnit.SECONDS));}
 static void until(java.util.function.BooleanSupplier predicate)throws Exception{long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(3);while(!predicate.getAsBoolean()&&System.nanoTime()<deadline)Thread.sleep(2);check(predicate.getAsBoolean());}
 public static void main(String[]args)throws Exception{
  Fake old=new Fake(),next=new Fake();old.due=true;next.entered=new CountDownLatch(1);next.release=new CountDownLatch(1);java.util.concurrent.atomic.AtomicInteger builds=new java.util.concurrent.atomic.AtomicInteger();
  ConnectorHandoverTransport w=wrapper(old,()->{builds.incrementAndGet();return next;});read(w);await(next.entered);check(!old.closed&&w.publicState().optString("state").equals("connected"));check(w.publicState().optString("renewalState").equals("preparing"));post(w);read(w);check(old.posts.get()==1&&builds.get()==1&&next.posts.get()==0);next.release.countDown();until(()->w.publicState().optInt("handoverCount")==1);until(()->old.closed);read(w);check(next.reads.get()==2&&old.closes.get()==1);w.close();w.close();check(next.closes.get()==1&&!w.publicState().toString().contains("SECRET"));
  Fake inFlight=new Fake(),replacement=new Fake();inFlight.due=true;inFlight.postEntered=new CountDownLatch(1);inFlight.postRelease=new CountDownLatch(1);ConnectorHandoverTransport draining=wrapper(inFlight,()->replacement);java.util.concurrent.atomic.AtomicReference<Throwable> error=new java.util.concurrent.atomic.AtomicReference<>();Thread sender=new Thread(()->{try{post(draining);}catch(Throwable e){error.set(e);}});sender.start();await(inFlight.postEntered);read(draining);until(()->draining.publicState().optInt("handoverCount")==1);check(!inFlight.closed&&inFlight.posts.get()==1&&replacement.posts.get()==0);read(draining);inFlight.postRelease.countDown();sender.join(3000);check(!sender.isAlive()&&error.get()==null);until(()->inFlight.closed);check(inFlight.closes.get()==1&&inFlight.posts.get()==1);draining.close();
  Fake stable=new Fake(),broken=new Fake();stable.due=true;broken.failure=new IOException("temporary");java.util.concurrent.atomic.AtomicInteger attempts=new java.util.concurrent.atomic.AtomicInteger();ConnectorHandoverTransport retry=wrapper(stable,()->{attempts.incrementAndGet();return broken;});read(retry);until(()->retry.publicState().optString("renewalState").equals("retry_wait"));check(!stable.closed&&broken.closed&&retry.publicState().optInt("handoverCount")==0);read(retry);read(retry);check(attempts.get()==1);stable.postFailure=new IOException("uncertain send");try{post(retry);throw new AssertionError("Expected failure");}catch(IOException expected){}check(stable.posts.get()==1&&broken.posts.get()==0);retry.close();
  for(String kind:new String[]{"authorization","identity","certificate"}){
   Fake authorized=new Fake(),refused=new Fake();authorized.due=true;
   if(kind.equals("authorization"))refused.failure=new ConnectorException("authorization_failed","revoked");else if(kind.equals("identity"))refused.computer="other-computer";else refused.failure=new javax.net.ssl.SSLException("bad certificate");
   java.util.concurrent.atomic.AtomicInteger count=new java.util.concurrent.atomic.AtomicInteger();ConnectorHandoverTransport blocked=wrapper(authorized,()->{count.incrementAndGet();return refused;});read(blocked);until(()->blocked.publicState().optString("renewalState").equals("blocked"));check(!authorized.closed&&refused.closed&&blocked.publicState().optInt("handoverCount")==0);read(blocked);check(count.get()==1&&refused.posts.get()==0);blocked.close();
  }
  // A validated network change starts health-checked migration immediately,
  // even for a direct path that is not due for TURN renewal. It never replays a POST.
  Fake mobile=new Fake(),wifi=new Fake();java.util.concurrent.atomic.AtomicInteger migrations=new java.util.concurrent.atomic.AtomicInteger();ConnectorHandoverTransport network=wrapper(mobile,()->{migrations.incrementAndGet();return wifi;});
  network.networkChanged();check(migrations.get()==0);read(network);until(()->network.publicState().optInt("networkHandoverCount")==1);check(migrations.get()==1&&mobile.closed&&wifi.posts.get()==0);network.close();network.networkChanged();check(migrations.get()==1);
  Fake sending=new Fake(),newPath=new Fake();ConnectorHandoverTransport migratingPost=wrapper(sending,()->newPath);read(migratingPost);sending.postEntered=new CountDownLatch(1);sending.postRelease=new CountDownLatch(1);sending.postFailure=new IOException("unknown delivery");
  Thread networkSender=new Thread(()->{try{post(migratingPost);throw new AssertionError("Unexpected success");}catch(IOException expected){}catch(Exception e){throw new RuntimeException(e);}});networkSender.start();await(sending.postEntered);migratingPost.networkChanged();until(()->migratingPost.publicState().optInt("networkHandoverCount")==1);check(!sending.closed&&sending.posts.get()==1&&newPath.posts.get()==0);sending.postRelease.countDown();networkSender.join(3000);check(!networkSender.isAlive());until(()->sending.closed);check(sending.posts.get()==1&&newPath.posts.get()==0);migratingPost.close();
  // A newer validated network cancels an obsolete candidate. Late completion
  // cannot replace the current path; the newest network is prepared next.
  Fake original=new Fake(),obsolete=new Fake(),newest=new Fake();obsolete.entered=new CountDownLatch(1);obsolete.release=new CountDownLatch(1);java.util.concurrent.atomic.AtomicInteger generations=new java.util.concurrent.atomic.AtomicInteger();ConnectorHandoverTransport flapping=wrapper(original,()->generations.incrementAndGet()==1?obsolete:newest);read(flapping);flapping.networkChanged();await(obsolete.entered);flapping.networkChanged();check(obsolete.closed&&!original.closed);obsolete.release.countDown();until(()->flapping.publicState().optInt("networkHandoverCount")==1);check(generations.get()==2&&original.closed&&flapping.publicState().optLong("networkChangeCount")==2);flapping.close();
  Fake locked=new Fake(),denied=new Fake();denied.failure=new ConnectorException("authorization_failed","revoked");java.util.concurrent.atomic.AtomicInteger deniedAttempts=new java.util.concurrent.atomic.AtomicInteger();ConnectorHandoverTransport security=wrapper(locked,()->{deniedAttempts.incrementAndGet();return denied;});read(security);security.networkChanged();until(()->security.publicState().optString("renewalState").equals("blocked"));security.networkChanged();read(security);check(deniedAttempts.get()==1&&denied.posts.get()==0);security.close();
  Fake foreground=new Fake(),late=new Fake();foreground.due=true;late.entered=new CountDownLatch(1);late.release=new CountDownLatch(1);ConnectorHandoverTransport cancel=wrapper(foreground,()->late);read(cancel);await(late.entered);cancel.close();late.release.countDown();until(()->late.closed);check(foreground.closed&&cancel.publicState().optInt("handoverCount")==0);try{read(cancel);throw new AssertionError("Reopened after close");}catch(ConnectorException expected){}
  Fake creating=new Fake(),notYetRegistered=new Fake();creating.due=true;CountDownLatch factoryEntered=new CountDownLatch(1),factoryRelease=new CountDownLatch(1);ConnectorHandoverTransport factoryRace=wrapper(creating,()->{factoryEntered.countDown();try{factoryRelease.await();}catch(InterruptedException ignored){}return notYetRegistered;});read(factoryRace);await(factoryEntered);factoryRace.close();factoryRelease.countDown();until(()->notYetRegistered.closed);check(factoryRace.publicState().optInt("handoverCount")==0&&creating.closed);
  System.out.println("ok");
 }
 `,['ConnectorTransport.java','ConnectorException.java','ConnectorHandoverTransport.java']);
});
test('renewal timing follows verified finite TURN expiry with monotonic lead and bounded lifetime',t=>{
 harness(t,'LeaseHarness',`
 static JSONObject server(String url,String username){return new JSONObject().put("urls",new JSONArray().put(url)).put("username",username);}
 public static void main(String[]args)throws Exception{
  long now=1000000,nano=123456;
  check(ConnectorRelayLease.renewAt(new JSONArray().put(server("turn:fixture","1600:nonce")),now,nano)==nano+TimeUnit.MILLISECONDS.toNanos(240000));
  check(ConnectorRelayLease.renewAt(new JSONArray().put(server("turns:fixture","999999:nonce")),now,nano)==nano+TimeUnit.MILLISECONDS.toNanos(240000));
  check(ConnectorRelayLease.renewAt(new JSONArray().put(server("stun:fixture","ignored")),now,nano)==Long.MAX_VALUE);
  check(ConnectorRelayLease.renewAt(new JSONArray().put(server("turn:one","1600:n")).put(server("turn:two","1500:n")),now,nano)==nano+TimeUnit.MILLISECONDS.toNanos(240000));
  check(ConnectorRelayLease.renewAt(new JSONArray().put(server("turn:fixture","1300:n")),now,nano)==nano+TimeUnit.MILLISECONDS.toNanos(180000));
  check(ConnectorRelayLease.renewAt(new JSONArray().put(server("turn:fixture","1100:n")),now,nano)==nano);
  for(String bad:new String[]{"nocolon","1200:","not-a-time:n","1000:n","-1:n","9223372036854776:n"}){try{ConnectorRelayLease.renewAt(new JSONArray().put(server("turn:fixture",bad)),now,nano);throw new AssertionError("Invalid lease accepted: "+bad);}catch(IllegalArgumentException expected){}}
  System.out.println("ok");
 }
 `,['ConnectorRelayLease.java']);
});
