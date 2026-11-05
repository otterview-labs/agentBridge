const {test}=require('node:test');
const {harness,productionClass,methods}=require('./java-json-fixture.cjs');
const setup=`
static class NoteReminderService{}
static class ComponentName{ComponentName(Object a,Class<?> c){}}
static class JobInfo {long latency;boolean persisted;static class Builder{JobInfo j=new JobInfo();Builder(int id,ComponentName c){}Builder setMinimumLatency(long x){j.latency=x;return this;}Builder setOverrideDeadline(long x){return this;}Builder setPersisted(boolean x){j.persisted=x;return this;}JobInfo build(){return j;}}}
static class JobScheduler{static int RESULT_SUCCESS=1;JobInfo last;int result=1;void cancel(int id){last=null;}int schedule(JobInfo j){last=j;return result;}}
static class Notifications {void cancel(String id,int code){}}
static class Context {Prefs prefs=new Prefs();JobScheduler jobs=new JobScheduler();Prefs getSharedPreferences(String n,int m){return prefs;}<T>T getSystemService(Class<T> c){return c.cast(c==JobScheduler.class?jobs:new Notifications());}}
static class Prefs{String data=new JSONArray().toString();boolean success=true;String getString(String k,String d){return data;}Prefs edit(){return this;}Prefs putString(String k,String v){if(success)data=v;return this;}boolean commit(){return success;}}
${productionClass('NoteTasks.java').replaceAll('android.app.NotificationManager','Notifications')}
static JSONObject draft(String title,long due){return new JSONObject().put("title",title).put("body","hello").put("dueAt",due);}
`;
test('draft scheduling validates content and survives reload; due transitions happen only once',t=>{
 harness(t,'NoteTaskStoreHarness',setup+`
 public static void main(String[] args)throws Exception {
 Context c=new Context();long future=System.currentTimeMillis()+600000;
 JSONObject n=NoteTasks.validate(draft("Title",future),System.currentTimeMillis());String id=n.optString("id");NoteTasks.save(c,n);
 check(NoteTasks.list(c).length()==1&&c.jobs.last.persisted&&c.jobs.last.latency>0);
 check(NoteTasks.markDue(c,future-1).length()==0);check(NoteTasks.markDue(c,future).length()==1);check(NoteTasks.markDue(c,future+1).length()==0);
 check(NoteTasks.list(c).getJSONObject(0).optString("state").equals("due"));
 JSONObject replacement=NoteTasks.validate(draft("Changed",future).put("id",id),System.currentTimeMillis());NoteTasks.save(c,replacement);check(NoteTasks.list(c).length()==1&&NoteTasks.list(c).getJSONObject(0).optString("title").equals("Changed"));
 NoteTasks.delete(c,id);check(NoteTasks.list(c).length()==0&&c.jobs.last==null);System.out.println("ok");
 }`);
});
test('invalid drafts, storage failures and scheduler rejection are observable without claiming publication',t=>{
 harness(t,'NoteTaskFailureHarness',setup+`
 public static void main(String[] args)throws Exception {
 for(JSONObject n:new JSONObject[]{new JSONObject(),draft("x",1),draft("x",-1),draft("x",0).put("image","file:///tmp/x"),draft("x".repeat(101),0)}) {
 try{NoteTasks.validate(n,100);throw new AssertionError();}catch(IllegalArgumentException expected){}
 }
 Context c=new Context();JSONObject note=NoteTasks.validate(draft("x",System.currentTimeMillis()+10000).put("image","content://picked/image"),System.currentTimeMillis());
 c.prefs.success=false;try{NoteTasks.save(c,note);throw new AssertionError();}catch(IllegalStateException expected){}check(NoteTasks.list(c).length()==0);
 c.prefs.success=true;NoteTasks.save(c,note);c.jobs.result=0;check(!NoteTasks.schedule(c));
 check(NoteTasks.list(c).getJSONObject(0).optString("state").equals("scheduled"));System.out.println("ok");
 }`);
});

test('Rednote handoff preserves draft text and image access and never records a successful post',t=>{
 const share=methods('NoteTasksActivity.java','  private void handoff(','  @Override public void onBackPressed()');
 harness(t,'NoteHandoffHarness',`
 static class Uri {String value;Uri(String v){value=v;}static Uri parse(String v){return new Uri(v);}}
 static class ClipData {static ClipData newRawUri(String l,Uri u){return new ClipData();}static ClipData newPlainText(String l,String t){return new ClipData();}}
 static class ClipboardManager {void setPrimaryClip(ClipData c){}}
 static class Intent {
 static String ACTION_SEND="send",EXTRA_TEXT="text",EXTRA_TITLE="title",EXTRA_STREAM="stream";static int FLAG_GRANT_READ_URI_PERMISSION=1;
 String pkg,type;int flags;ClipData clip;Map<String,Object> extras=new HashMap<>();Intent(String a){}Intent setPackage(String p){pkg=p;return this;}Intent putExtra(String k,Object v){extras.put(k,v);return this;}Intent setType(String t){type=t;return this;}void setClipData(ClipData c){clip=c;}Intent addFlags(int f){flags|=f;return this;}
 }
 static class PM{List<Object> queryIntentActivities(Intent i,int f){return List.of(new Object());}Intent getLaunchIntentForPackage(String p){return new Intent("open");}}
 static class Resolver{java.io.InputStream openInputStream(Uri u){return new java.io.ByteArrayInputStream(new byte[]{1});}}
 interface Listener{void call(Object d,int w);}
 static class AlertDialog {static class Builder{Builder(Object a){}Builder setMessage(String m){return this;}Builder setNegativeButton(String s,Listener l){return this;}Builder setPositiveButton(String s,Listener l){return this;}void show(){}}}
 static class Toast {static int LENGTH_LONG=1;static Toast makeText(Object a,String s,int l){return new Toast();}void show(){}}
 Intent sent;PM getPackageManager(){return new PM();}Resolver getContentResolver(){return new Resolver();}void startActivity(Intent i){sent=i;}<T>T getSystemService(Class<T> c){return c.cast(new ClipboardManager());}static String t(String a,String b){return a;}
 ${share}
 public static void main(String[] args)throws Exception {
 NoteHandoffHarness h=new NoteHandoffHarness();JSONObject n=new JSONObject().put("title","Test title").put("body","Exact body").put("state","draft");
 h.handoff(n);check(h.sent.pkg.equals("com.xingin.xhs")&&h.sent.type.equals("text/plain"));check(h.sent.extras.get("text").equals("Test title\\n\\nExact body"));check(n.optString("state").equals("draft"));
 n.put("image","content://picked/one");h.handoff(n);check(h.sent.type.equals("image/*")&&h.sent.clip!=null&&h.sent.flags==1);check(((Uri)h.sent.extras.get("stream")).value.equals("content://picked/one"));check(n.optString("state").equals("draft"));System.out.println("ok");
 }`);
});

test('late image selection keeps reminder state and cannot recreate deleted drafts or overwrite an already selected image',t=>{
 harness(t,'NoteImagePersistenceHarness',setup+`
 public static void main(String[] args)throws Exception {
 Context c=new Context();long due=System.currentTimeMillis()+10000;JSONObject n=NoteTasks.validate(draft("Photo",due),System.currentTimeMillis()).put("imageStatus","pending");String id=n.optString("id");NoteTasks.save(c,n);
 NoteTasks.markDue(c,due);NoteTasks.completeImage(c,id,"content://selected/image","selected");JSONObject current=NoteTasks.find(c,id);check(current.optString("state").equals("due")&&current.optString("image").equals("content://selected/image"));
 NoteTasks.completeImage(c,id,"","cancelled");check(NoteTasks.find(c,id).optString("imageStatus").equals("selected"));
 NoteTasks.delete(c,id);try{NoteTasks.completeImage(c,id,"content://late/image","selected");throw new AssertionError();}catch(IllegalStateException expected){}check(NoteTasks.list(c).length()==0);System.out.println("ok");
 }`);
});
