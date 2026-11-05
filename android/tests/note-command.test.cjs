const {test}=require('node:test');
const {harness,productionClass,methods}=require('./java-json-fixture.cjs');
const command=productionClass('NoteCommand.java');
function run(t,name,body){harness(t,name,command+body,'import java.time.*;');}

test('note intent and user defaults distinguish explicit writing, follow-up, questions and image overrides',t=>{
 run(t,'NoteIntentHarness',`
 public static void main(String[] args)throws Exception {
 for(String s:new String[]{"帮我写一篇小红书笔记，介绍深圳咖啡店，配图，明天晚上八点提醒我","生成小红书文案","把刚才的笔记改到明天20:00提醒","上一条小红书笔记不要图片"})check(NoteCommand.accepts(s));
 for(String s:new String[]{"怎么写小红书笔记","不要生成小红书文案","如果写小红书笔记","看看这个项目","打开小红书搜索猫咪"})check(!NoteCommand.accepts(s));
 JSONObject c=NoteCommand.defaults();check(NoteCommand.imageMode("配图",c).equals("ask"));c.put("imageMode","last");check(NoteCommand.imageMode("纯文字",c).equals("none"));check(NoteCommand.imageMode("写一篇小红书",c).equals("last"));check(NoteCommand.imageMode("沿用上一张图片",c).equals("last"));
 c.put("style","简短具体").put("audience","学生").put("length",200).put("zone","Asia/Shanghai");check(NoteCommand.config(c).optInt("length")==200);
 check(NoteCommand.messages("用户主题",c).getJSONObject(0).optString("content").contains("学生"));
 for(JSONObject bad:new JSONObject[]{new JSONObject().put("hour",25),new JSONObject().put("minute",60),new JSONObject().put("length",1),new JSONObject().put("imageMode","auto-scrape"),new JSONObject().put("zone","madeup/zone")}){try{NoteCommand.config(bad);throw new AssertionError();}catch(RuntimeException expected){}}
 System.out.println("ok");
 }`);
});
test('time parsing uses configured timezone and defaults, accepts common Chinese times and never silently schedules topic dates',t=>{
 run(t,'NoteTimeHarness',`
 static long time(String v){return ZonedDateTime.parse(v).toInstant().toEpochMilli();}
 public static void main(String[] args)throws Exception {
 JSONObject c=NoteCommand.defaults();long now=time("2026-11-05T21:00:00+08:00[Asia/Shanghai]");
 check(NoteCommand.dueAt("写小红书介绍明天的活动",c,now)==0);
 check(NoteCommand.dueAt("写小红书明天晚上八点提醒",c,now)==time("2026-11-06T20:00:00+08:00[Asia/Shanghai]"));
 check(NoteCommand.dueAt("明晚八点半提醒",c,now)==time("2026-11-06T20:30:00+08:00[Asia/Shanghai]"));
 check(NoteCommand.dueAt("十分钟后提醒",c,now)==now+600000);
 check(NoteCommand.dueAt("两小时后提醒",c,now)==now+7200000);
 check(NoteCommand.dueAt("明天提醒",c.put("hour",9).put("minute",15),now)==time("2026-11-06T09:15:00+08:00[Asia/Shanghai]"));
 check(NoteCommand.dueAt("20:00提醒",c,now)==time("2026-11-06T20:00:00+08:00[Asia/Shanghai]"));
 check(NoteCommand.dueAt("取消提醒，明天",c,now)==0);
 for(String bad:new String[]{"今天20:00提醒","明天25:00提醒","明天下午提醒","明天8点或9点提醒","明天后天提醒","2026-11-01 08:00提醒","每天8点提醒","每天8点发布","30分钟后或2小时后提醒"}){try{NoteCommand.dueAt(bad,c,now);throw new AssertionError(bad);}catch(java.time.DateTimeException|IllegalArgumentException expected){}}
 System.out.println("ok");
 }`);
});
test('model copy parser strips action fields and rejects missing text instead of trusting model dates or URIs',t=>{
 run(t,'NoteCopyHarness',`
 public static void main(String[] args)throws Exception {
 String raw=new JSONObject().put("title","标题").put("body","正文").put("dueAt",1).put("image","file:///secret").put("id","overwrite").toString();
 JSONObject c=NoteCommand.copy(raw);check(c.optString("title").equals("标题")&&!c.has("dueAt")&&!c.has("image")&&!c.has("id"));
 check(NoteCommand.copy("\u0060\u0060\u0060json\\n"+raw+"\\n\u0060\u0060\u0060").optString("body").equals("正文"));
 try{NoteCommand.copy(new JSONObject().put("title",7).put("body","x").toString());throw new AssertionError();}catch(IllegalArgumentException expected){}
 System.out.println("ok");
 }`);
});

const execution=methods('PhoneController.java','  private String executeNoteCommand(','  /** Only called for a fresh user send')
 .replaceAll('android.net.Uri','Uri').replaceAll('android.content.Intent','Intent').replaceAll('android.app.KeyguardManager','Keyguard').replaceAll('android.app.NotificationManager','Notifications').replaceAll('android.os.SystemClock','Clock').replace('Thread.sleep(300);','Clock.advance();');
const executionSetup=`
 static class Uri{static Uri parse(String s){return new Uri();}}
 static class Notifications{boolean areNotificationsEnabled(){return true;}}
 static class Keyguard{boolean isKeyguardLocked(){return false;}}
 static class NoteImageActivity{}
 static class Intent{Intent(Object a,Class<?> c){}Intent putExtra(String k,String v){return this;}}
 static class Resolver{java.io.InputStream openInputStream(Uri u){return new java.io.ByteArrayInputStream(new byte[]{1});}}
 static class Activity{String imageOutcome="selected";int pickers;boolean isFinishing(){return false;}boolean hasWindowFocus(){return true;}<T>T getSystemService(Class<T> c){return c.cast(c==Notifications.class?new Notifications():new Keyguard());}Resolver getContentResolver(){return new Resolver();}void runOnUiThread(Runnable r){r.run();}void startActivity(Intent i){pickers++;NoteTasks.saved.put("imageStatus",imageOutcome);if(imageOutcome.equals("selected"))NoteTasks.saved.put("image","content://selected/one");}}
 static class Clock{static long elapsed;static long elapsedRealtime(){return elapsed;}static void advance(){elapsed+=100000;}}
 static class NoteTasks{
 static JSONObject saved;static boolean failed,scheduled=true;static int saves;
 ${methods('NoteTasks.java','  static JSONObject validate(','  private static void write(')}
 static JSONArray markDue(Activity a,long now){return new JSONArray();}
 static JSONArray list(Activity a){return saved==null?new JSONArray():new JSONArray().put(saved);}
 static void save(Activity a,JSONObject n){if(failed)throw new IllegalStateException("storage failure");saved=n;saves++;}
 static JSONObject find(Activity a,String id){return saved;}
 static boolean schedule(Activity a){return scheduled;}
 static void completeImage(Activity a,String id,String image,String state){saved.put("image",image).put("imageStatus",state);}
 }
 Activity activity=new Activity();int modelCalls,piCalls;String generated=new JSONObject().put("title","深圳咖啡店").put("body","请核实营业时间。正文示例。" ).toString();
 String chatCompletion(JSONObject m,JSONArray messages,JSONArray tools){modelCalls++;return new JSONObject().put("choices",new JSONArray().put(new JSONObject().put("message",new JSONObject().put("content",generated)))).toString();}
 String modelMessageText(JSONObject message){return message.optString("content");}
 String piButlerReply(JSONObject m,String v,JSONObject e,int scope,int id,java.util.function.Consumer<String> partial,java.util.function.Consumer<String> progress,boolean greeting){piCalls++;return generated;}
 String now(){return "date";}void updateOperation(int i,String p,String msg,String extra){}
 ${execution}
`;
test('production note flow writes copy, schedules and supports picker cancellation or reuse without a draft form',t=>{
 run(t,'NoteExecutionHarness',executionSetup+`
 public static void main(String[] args)throws Exception {
 NoteExecutionHarness c=new NoteExecutionHarness();JSONObject settings=NoteCommand.defaults();
 String answer=c.executeNoteCommand("帮我写小红书笔记，明天晚上八点提醒",settings,new JSONObject(),1);
 check(c.modelCalls==1&&NoteTasks.saves==1&&NoteTasks.saved.optLong("dueAt")>System.currentTimeMillis());check(answer.contains("尚未发布")&&answer.contains("深圳咖啡店"));
 c.activity.imageOutcome="cancelled";answer=c.executeNoteCommand("写小红书笔记，配图",settings,new JSONObject(),2);check(c.activity.pickers==1&&NoteTasks.saved.optString("imageStatus").equals("cancelled")&&answer.contains("取消选图"));
 c.activity.imageOutcome="selected";c.executeNoteCommand("写小红书文案，配图",settings,new JSONObject(),3);check(NoteTasks.saved.optString("image").equals("content://selected/one"));
 c.executeNoteCommand("写小红书笔记，沿用上一张图片",settings,new JSONObject(),4);check(c.activity.pickers==2&&NoteTasks.saved.optString("image").equals("content://selected/one"));
 String id=NoteTasks.saved.optString("id"),body=NoteTasks.saved.optString("body");int calls=c.modelCalls;
 c.executeNoteCommand("把刚才的小红书笔记改到明天九点提醒",settings,new JSONObject(),5);check(c.modelCalls==calls&&NoteTasks.saved.optString("id").equals(id)&&NoteTasks.saved.optString("body").equals(body));check(NoteTasks.saved.optString("image").equals("content://selected/one"));
 c.executeNoteCommand("写小红书笔记",settings,new JSONObject().put("runtime","pi"),6);check(c.piCalls==1);
 check(NoteCommand.accepts("查看我的小红书定时任务"));calls=c.modelCalls;answer=c.executeNoteCommand("查看我的小红书定时任务",settings,new JSONObject(),7);check(c.modelCalls==calls&&answer.contains("均未确认发布"));System.out.println("ok");
 }`);
});
test('production flow validates time and model output before saving, reports scheduler failure and keeps picker timeout truthful',t=>{
 run(t,'NoteExecutionFailureHarness',executionSetup+`
 public static void main(String[] args)throws Exception {
 NoteExecutionFailureHarness c=new NoteExecutionFailureHarness();JSONObject settings=NoteCommand.defaults();
 try{c.executeNoteCommand("写小红书笔记，明天8点或9点提醒",settings,new JSONObject(),1);throw new AssertionError();}catch(IllegalArgumentException expected){}check(c.modelCalls==0&&NoteTasks.saved==null);
 c.generated=new JSONObject().put("title",false).put("body","bad").toString();try{c.executeNoteCommand("写小红书笔记",settings,new JSONObject(),2);throw new AssertionError();}catch(IllegalArgumentException expected){}check(NoteTasks.saved==null);
 c.generated=new JSONObject().put("title","Title").put("body","Body").put("image","file:///secret").put("dueAt",1).toString();
 NoteTasks.failed=true;try{c.executeNoteCommand("写小红书笔记，配图",settings,new JSONObject(),3);throw new AssertionError();}catch(IllegalStateException expected){}check(c.activity.pickers==0);
 NoteTasks.failed=false;NoteTasks.scheduled=false;String answer=c.executeNoteCommand("写小红书笔记，明天提醒",settings,new JSONObject(),4);check(answer.contains("未接受调度")&&NoteTasks.saved.optString("image").isEmpty());
 c.activity.imageOutcome="pending";answer=c.executeNoteCommand("写小红书笔记，配图",settings,new JSONObject(),5);check(answer.contains("仍待选择")&&NoteTasks.saved.optString("imageStatus").equals("pending"));System.out.println("ok");
 }`);
});

test('note preferences persist validated user defaults and do not replace a valid profile on invalid writes',t=>{
 const preferences=productionClass('NotePreferences.java');
 run(t,'NotePreferencesHarness',`
 static class Context{Prefs prefs=new Prefs();Prefs getSharedPreferences(String name,int mode){return prefs;}}
 static class Prefs{String value;boolean success=true;String getString(String name,String fallback){return value==null?fallback:value;}Prefs edit(){return this;}Prefs putString(String key,String data){if(success)value=data;return this;}boolean commit(){return success;}}
 ${preferences}
 public static void main(String[] args)throws Exception {
 Context c=new Context();check(NotePreferences.read(c).optInt("hour")==20);
 JSONObject custom=NoteCommand.defaults().put("style","轻松但不夸大").put("imageMode","ask").put("hour",9).put("minute",30);NotePreferences.save(c,custom);check(NotePreferences.read(c).optString("imageMode").equals("ask")&&NotePreferences.read(c).optInt("hour")==9);
 try{NotePreferences.save(c,new JSONObject().put("hour",30));throw new AssertionError();}catch(IllegalArgumentException expected){}check(NotePreferences.read(c).optInt("hour")==9);
 c.prefs.success=false;try{NotePreferences.save(c,custom.put("hour",10));throw new AssertionError();}catch(IllegalStateException expected){}check(NotePreferences.read(c).optInt("hour")==9);System.out.println("ok");
 }`);
});

test('note admission shares chat lock and history, handles validation errors before model access and releases on worker failure',t=>{
 const admission=methods('PhoneController.java','  public String beginNoteCommand(','  private String executeNoteCommand(');
 run(t,'NoteAdmissionHarness',`
 Object activity=new Object();int executions,models;boolean fail;
 static class NotePreferences{static JSONObject read(Object a)throws Exception{return NoteCommand.defaults();}}
 class Store{boolean busy;JSONArray history=new JSONArray();boolean beginStudioTurn(){if(busy)return false;busy=true;return true;}void endStudioTurn(){busy=false;}int nextId(){return 44;}JSONArray studioMessages(){return history;}void saveStudioMessages(JSONArray h){history=h;}}
 Store store=new Store();class Operations{JSONObject result;void completeStudio(int id,String text,JSONObject data){result=data;}}Operations operations=new Operations();
 JSONObject readyStudioModel(){models++;return new JSONObject();}JSONObject registerOperation(int id,String phase,String msg){return new JSONObject().put("id",id);}
 void startWorker(String name,Runnable r){r.run();}String executeNoteCommand(String v,JSONObject p,JSONObject m,int id){executions++;if(fail)throw new IllegalStateException("model unavailable");return "已保存草稿，尚未发布";}
 String now(){return "now";}JSONObject localStudioSnapshot(){return new JSONObject();}void updateOperation(int id,String p,String m,String x){}
 String success(JSONObject d){return new JSONObject().put("ok",true).put("data",d).toString();}String failure(Exception e){return new JSONObject().put("ok",false).toString();}
 ${productionClass('PhoneCommand.java')}
 ${admission}
 public static void main(String[] args)throws Exception {
 NoteAdmissionHarness c=new NoteAdmissionHarness();String ordinary=new JSONObject().put("content","项目怎么样").toString();check(!new JSONObject(c.beginNoteCommand(ordinary)).getJSONObject("data").optBoolean("handled")&&c.models==0);
 String invalid=new JSONObject().put("content","写小红书笔记，明天8点或9点提醒").toString();check(!new JSONObject(c.beginNoteCommand(invalid)).optBoolean("ok")&&c.models==0&&!c.store.busy);
 String write=new JSONObject().put("content","写小红书笔记").toString();check(new JSONObject(c.beginNoteCommand(write)).optBoolean("ok"));check(c.executions==1&&!c.store.busy&&c.store.history.length()==2&&c.operations.result.getJSONObject("reply").optBoolean("phoneAction"));
 c.store.busy=true;c.beginNoteCommand(write);check(c.executions==1&&c.store.busy);c.store.busy=false;
 int models=c.models;c.fail=true;String update=new JSONObject().put("content","把刚才的笔记取消提醒").toString();c.beginNoteCommand(update);check(c.models==models&&!c.store.busy);check(c.operations.result.getJSONObject("reply").optString("content").contains("没有发布"));System.out.println("ok");
 }`);
});


test('repeated writing words are processed without combinatorial backtracking',t=>{
 run(t,'NoteCommandLongInputHarness',`
 public static void main(String[] args)throws Exception {
  long began=System.nanoTime();
  for(int i=0;i<100;i++)check(!NoteCommand.accepts("今天写"+"写".repeat(3900)));
  check(NoteCommand.accepts("明天写一篇小红书笔记"));
  check(System.nanoTime()-began<2_000_000_000L);System.out.println("ok");
 }`);
});
