const {test}=require('node:test');
const {methods,harness}=require('./java-json-fixture.cjs');
const core=methods('ManagedCoordinator.java','  interface Backend','\n}').replaceAll('Files.','java.nio.file.Files.').replaceAll('StandardCopyOption.','java.nio.file.StandardCopyOption.').replaceAll('MessageDigest.','java.security.MessageDigest.');
const backend=methods('OpenHandsBackend.java','  interface Transport','\n}').replaceAll('new URI(', 'new java.net.URI(').replaceAll('URI uri','java.net.URI uri');

test('managed JSON fences and endpoint tails use bounded linear parsing for untrusted text', t => {
 const parser=methods('PhoneBridge.java','  static String managedJsonText','  private JSONObject studioMessageTurn');
 harness(t,'ManagedTextHarness',`
 static class ManagedCoordinator {${core}}
 static class OpenHandsBackend implements ManagedCoordinator.Backend {${backend}}
 ${parser}
 public static void main(String[] args)throws Exception{
  check(managedJsonText("  {\\\"action\\\":\\\"wait\\\"}  ").equals("{\\\"action\\\":\\\"wait\\\"}"));
  check(managedJsonText("\x60\x60\x60json\\n{\\\"action\\\":\\\"review\\\"}\\n\x60\x60\x60").equals("{\\\"action\\\":\\\"review\\\"}"));
  check(managedJsonText("\x60\x60\x60\\n{}\\n\x60\x60\x60").equals("{}"));
  try {managedJsonText(" ".repeat(64001));throw new AssertionError();}catch(IllegalArgumentException expected){}
  check(OpenHandsBackend.endpoint(" https://example.test/v1"+"/".repeat(1000)+" ").equals("https://example.test/v1"));
  try {OpenHandsBackend.endpoint("https://example.test/"+"/".repeat(4096));throw new AssertionError();}catch(IllegalArgumentException expected){}
  System.out.println("ok");
 }
 `);
});

test('phone coordinator persists delivery before sending, recovers uncertainty and never retries an ambiguous action',t=>{
 harness(t,'ManagedRecoveryHarness',`
 static class ManagedCoordinator {${core}}
 static class Memory implements ManagedCoordinator.Memory {public String read(JSONObject job){return "confirmed requirement";}public void record(JSONObject job,String text){}}
 static JSONObject binding(){return new JSONObject().put("scope","one");}
 static JSONObject observe(){return new JSONObject().put("state","idle").put("question","Add tests?");}
 static JSONObject decision(){return new JSONObject().put("action","reply").put("reply","Add the agreed tests only");}
 public static void main(String[] args)throws Exception{
  File dir=java.nio.file.Files.createTempDirectory("managed-recovery").toFile(),file=new File(dir,"queue.json");int[] sends={0};
  ManagedCoordinator c=new ManagedCoordinator(file,(j,o)->decision(),new Memory());
  c.register("employee",new ManagedCoordinator.Backend(){public JSONObject observe(JSONObject b){return ManagedRecoveryHarness.observe();}public void send(JSONObject b,String text,String id)throws Exception{
    sends[0]++;JSONObject disk=new JSONObject(java.nio.file.Files.readString(file.toPath()));check(disk.getJSONArray("jobs").getJSONObject(0).optString("state").equals("dispatching"));
    throw new IOException("connection lost after sending"); }});
  c.add("employee",binding(),"training progress","only agreed tests",true,3,120);c.enable(true);c.tick();
  check(sends[0]==1&&c.snapshot().getJSONArray("jobs").getJSONObject(0).optString("state").equals("uncertain"));c.tick();check(sends[0]==1);
  ManagedCoordinator reopened=new ManagedCoordinator(file,(j,o)->decision(),new Memory());
  reopened.register("employee",new ManagedCoordinator.Backend(){public JSONObject observe(JSONObject b){return ManagedRecoveryHarness.observe();}public void send(JSONObject b,String text,String id){sends[0]++;}});
  reopened.tick();check(sends[0]==1);JSONObject job=reopened.snapshot().getJSONArray("jobs").getJSONObject(0);
  reopened.control(job.getString("id"),"resume");reopened.tick();check(sends[0]==1); // identical question is not replayed
  try{reopened.control(job.getString("id"),"accept");throw new AssertionError();}catch(IllegalArgumentException expected){}
  System.out.println("ok");
 }
 `);
});

test('phone orchestration enforces opt-in, fresh state, cancellation, limits and explicit result acceptance',t=>{
 harness(t,'ManagedPolicyHarness',`
 static class ManagedCoordinator {${core}}
 static class Memory implements ManagedCoordinator.Memory {public String read(JSONObject job){return job.getJSONObject("binding").optString("scope");}public void record(JSONObject job,String text){}}
 static JSONObject reply(){return new JSONObject().put("action","reply").put("reply","Use the confirmed design");}
 static JSONObject obs(String question){return new JSONObject().put("state","idle").put("question",question);}
 static File file()throws Exception{return new File(java.nio.file.Files.createTempDirectory("managed-policy").toFile(),"queue.json");}
 static class Backend implements ManagedCoordinator.Backend{int sends=0,observes=0;boolean stale=false;public JSONObject observe(JSONObject b){observes++;return obs(stale&&observes>1?"New question":"Old question");}public void send(JSONObject b,String t,String id){sends++;}}
 static ManagedCoordinator setup(Backend b,ManagedCoordinator.Planner p,boolean allowed)throws Exception{
   ManagedCoordinator c=new ManagedCoordinator(file(),p,new Memory());c.register("employee",b);c.add("employee",new JSONObject().put("scope","training"),"training","confirmed requirements",allowed,1,120);c.enable(true);return c;
 }
 public static void main(String[] args)throws Exception{
  Backend unapproved=new Backend();ManagedCoordinator c=setup(unapproved,(j,o)->reply(),false);c.tick();check(unapproved.sends==0&&c.snapshot().getJSONArray("jobs").getJSONObject(0).optString("state").equals("needs_user"));
  Backend stale=new Backend();stale.stale=true;c=setup(stale,(j,o)->reply(),true);c.tick();check(stale.sends==0);
  Backend limited=new Backend();c=setup(limited,(j,o)->reply(),true);c.tick();check(limited.sends==1);
  Backend paused=new Backend();final ManagedCoordinator[] ref={null};ref[0]=setup(paused,(j,o)->{ref[0].enable(false);return reply();},true);ref[0].tick();check(paused.sends==0&&ref[0].snapshot().getJSONArray("jobs").getJSONObject(0).optString("state").equals("waiting"));
  Backend complete=new Backend();c=setup(complete,(j,o)->new JSONObject().put("action","review").put("reason","Agent reported tests passed"),true);c.tick();JSONObject job=c.snapshot().getJSONArray("jobs").getJSONObject(0);check(job.optString("state").equals("review"));c.control(job.getString("id"),"accept");check(c.snapshot().getJSONArray("jobs").getJSONObject(0).optString("state").equals("complete"));
  System.out.println("ok");
 }
 `);
});

test('OpenHands adapter uses V1 events and run contract, filters conversation config and fails closed on unknown status',t=>{
 harness(t,'OpenHandsContractHarness',`
 static class ManagedCoordinator { static String hash(String text){return text;} interface Backend{JSONObject observe(JSONObject b)throws Exception;void send(JSONObject b,String text,String id)throws Exception;} }
 static class OpenHandsBackend implements ManagedCoordinator.Backend {${backend}}
 public static void main(String[] args)throws Exception{
  String id="11111111-1111-1111-1111-111111111111";JSONObject binding=new JSONObject().put("conversationId",id);List<String> calls=new ArrayList<>();
  OpenHandsBackend adapter=new OpenHandsBackend((method,path,body)->{
    calls.add(method+" "+path);
    if(path.endsWith("/events")){check(body.optBoolean("run")&&body.optString("role").equals("user"));check(body.getJSONArray("content").getJSONObject(0).optString("type").equals("text"));return new JSONObject();}
    if(path.contains("events/search"))return new JSONObject().put("items",new JSONArray().put(new JSONObject().put("id","e1").put("kind","MessageEvent").put("source","agent").put("llm_message","Which tests?").put("api_key","secret")));
    return new JSONObject().put("id",id).put("execution_status","idle").put("agent",new JSONObject().put("api_key","secret"));
  });
  JSONObject observation=adapter.observe(binding);check(observation.optString("state").equals("idle")&&!observation.has("agent")&&!observation.getJSONArray("records").getJSONObject(0).has("api_key"));
  adapter.send(binding,"only agreed tests","action-1");check(calls.get(2).equals("POST /api/conversations/"+id+"/events"));
  try{OpenHandsBackend.endpoint("http://public.example/v1");throw new AssertionError();}catch(IllegalArgumentException expected){}
  try{new OpenHandsBackend((m,p,b)->new JSONObject().put("id",id).put("execution_status","future-unknown")).observe(binding);throw new AssertionError();}catch(IllegalStateException expected){}
  System.out.println("ok");
 }
 `);
});
