const {test}=require('node:test');
const {harness,methods}=require('./java-json-fixture.cjs');

test('model library migrates a single config and atomically persists independent credentials',t=>{
 const store=methods('BridgeStore.java','  synchronized JSONObject studioModel()','  synchronized JSONObject connector()').replace('android.content.SharedPreferences.Editor','Editor');
 harness(t,'ModelLibraryHarness',`
 static final String KEY_STUDIO_MODEL="studio_model";
 final Map<String,String> disk=new HashMap<>(); boolean failCommit;
 final Prefs prefs=new Prefs();
 class Prefs { Editor edit(){return new Editor();} }
 class Editor { final Map<String,String> pending=new HashMap<>(); Editor putString(String k,String v){pending.put(k,v);return this;} boolean commit(){if(failCommit)return false;disk.putAll(pending);return true;} }
 String readSealed(String k,String fallback){return disk.containsKey(k)?disk.get(k):fallback.equals("[]")?new JSONArray().toString():fallback;}
 Editor writeSealed(Editor e,String k,String value){return e.putString(k,value);}
 ${store}
 public static void main(String[] args)throws Exception {
   ModelLibraryHarness b=new ModelLibraryHarness();
   b.disk.put(KEY_STUDIO_MODEL,new JSONObject().put("modelId","first").put("apiKey","secret-one").toString());
   check(b.studioModel().optString("profileId").equals("legacy"));check(b.studioModelProfiles().length()==1);
   JSONObject two=new JSONObject().put("modelId","second").put("apiKey","secret-two");b.saveStudioModel(two);
   check(b.studioModelProfiles().length()==2);check(b.studioModel().optString("modelId").equals("second"));
   JSONObject one=b.studioModelProfiles().getJSONObject(0);check(one.optString("apiKey").equals("secret-one"));
   b.saveStudioModel(one);check(b.studioModelProfiles().length()==2);check(b.studioModel().optString("apiKey").equals("secret-one"));
   String before=b.disk.toString();b.failCommit=true;
   try{b.saveStudioModel(two);throw new AssertionError();}catch(IllegalStateException expected){}
   check(b.disk.toString().equals(before));System.out.println("ok");
 }
 `);
});

test('public model metadata never exposes profile credentials',t=>{
 const method=methods('PhoneController.java','  private JSONObject publicStudioModel(','  private String piButlerReply(');
 harness(t,'PublicProfileHarness',`${method}
 public static void main(String[] args)throws Exception {
   PublicProfileHarness b=new PublicProfileHarness();JSONObject p=b.publicStudioModel(new JSONObject().put("apiKey","top-secret").put("favorite",true).put("profileId","p1").put("name","My model"));
   check(!p.toString().contains("top-secret")&&!p.has("apiKey"));check(p.optBoolean("hasApiKey")&&p.optBoolean("favorite"));check(p.optString("profileId").equals("p1"));System.out.println("ok");
 }`);
});

test('revision validates latest scope, preserves other conversations and bounds recoverable versions',t=>{
 harness(t,'StudioRevisionHarness',`
 static JSONObject msg(String id,String role,String content,int scope){return new JSONObject().put("id",id).put("role",role).put("content",content).put("memoryTaskId",scope);}
 public static void main(String[] args)throws Exception {
   JSONObject user=msg("u","user","original question",0), reply=msg("a","assistant","old answer",0), other=msg("x","user","other conversation",7);
   JSONArray all=new JSONArray().put(user).put(other).put(reply);
   check(StudioRevision.before(StudioRevision.scope(all,0),"a").length()==0);
   String original=all.toString();
   try{StudioRevision.before(StudioRevision.scope(all,7),"a");throw new AssertionError();}catch(IllegalStateException expected){}
   check(all.toString().equals(original));
   JSONArray replaced=StudioRevision.replace(all,"a",0,msg("new-u","user","edited",0),msg("new-a","assistant","new answer",0));
   check(replaced.getJSONObject(1)==other);check(all.toString().equals(original));
   check(replaced.getJSONObject(2).getJSONArray("revisions").getJSONObject(0).getJSONObject("user").optString("content").equals("original question"));
   for(int i=0;i<8;i++) {String id=replaced.getJSONObject(2).optString("id");replaced=StudioRevision.replace(replaced,id,0,msg("u"+i,"user","q",0),msg("a"+i,"assistant","r",0));}
   check(replaced.getJSONObject(2).getJSONArray("revisions").length()==5);
   try{StudioRevision.replace(replaced,"a",0,user,reply);throw new AssertionError();}catch(IllegalStateException expected){}
   System.out.println("ok");
 }`,['StudioRevision.java']);
});

test('profile actions enforce the turn lock, toggle favorite and reject deleting the active profile',t=>{
 const actions=methods('PhoneController.java','  public String studioModelProfileAction(','  private JSONArray publicStudioProfiles()');
 harness(t,'ProfileActionsHarness',`
 class Store {
  JSONObject active=new JSONObject().put("profileId","one");
  JSONArray list=new JSONArray().put(active).put(new JSONObject().put("profileId","two"));boolean busy;
  boolean beginStudioTurn(){if(busy)return false;busy=true;return true;}void endStudioTurn(){busy=false;}
  JSONObject studioModel(){return active;}JSONArray studioModelProfiles(){return list;}
  void saveStudioModelLibrary(JSONObject a,JSONArray p){active=a;list=p;}
 }
 Store store=new Store();String success(JSONObject d){return new JSONObject().put("ok",true).toString();}String failure(Exception e){return new JSONObject().put("ok",false).toString();}JSONObject localStudioSnapshot(){return new JSONObject();}
 ${actions}
 public static void main(String[] args)throws Exception {
  ProfileActionsHarness b=new ProfileActionsHarness();
  check(new JSONObject(b.studioModelProfileAction(new JSONObject().put("action","favorite").put("id","two").toString())).optBoolean("ok"));
  check(b.store.list.getJSONObject(1).optBoolean("favorite"));check(b.store.active.optString("profileId").equals("one"));
  check(!new JSONObject(b.studioModelProfileAction(new JSONObject().put("action","delete").put("id","one").toString())).optBoolean("ok"));
  b.studioModelProfileAction(new JSONObject().put("action","select").put("id","two").toString());check(b.store.active.optString("profileId").equals("two"));
  b.store.busy=true;check(!new JSONObject(b.studioModelProfileAction(new JSONObject().put("action","select").put("id","one").toString())).optBoolean("ok"));check(b.store.busy);check(b.store.active.optString("profileId").equals("two"));b.store.busy=false;
  b.studioModelProfileAction(new JSONObject().put("action","delete").put("id","one").toString());check(b.store.list.length()==1);System.out.println("ok");
 }`);
});

test('revision markers commit with messages and prevent stale long-term memory after history is trimmed',t=>{
 const storage=methods('BridgeStore.java','  synchronized boolean studioScopeRevised(','  /** Appends one chat message');
 harness(t,'RevisionMarkerHarness',`
 final Map<String,String> disk=new HashMap<>();boolean fail;
 final Prefs prefs=new Prefs();
 class Prefs {String getString(String k,String fallback){return disk.getOrDefault(k,fallback);} Editor edit(){return new Editor();}}
 class Editor {Map<String,String> pending=new HashMap<>();Editor putString(String k,String v){pending.put(k,v);return this;}boolean commit(){if(fail)return false;disk.putAll(pending);return true;}}
 ${storage}
 public static void main(String[] args)throws Exception {
   RevisionMarkerHarness b=new RevisionMarkerHarness();JSONArray messages=new JSONArray().put(new JSONObject().put("memoryTaskId",0).put("revisedFrom","a"));
   b.fail=true;try{b.saveStudioMessages(messages);throw new AssertionError();}catch(IllegalStateException expected){}check(!b.studioScopeRevised(0));
   b.fail=false;b.saveStudioMessages(messages);check(b.studioScopeRevised(0));check(!b.studioScopeRevised(7));
   b.saveStudioMessages(new JSONArray());check(b.studioScopeRevised(0));System.out.println("ok");
 }`);
});
