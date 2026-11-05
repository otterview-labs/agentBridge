const {test}=require('node:test');
const {harness,methods}=require('./java-json-fixture.cjs');

test('explicit Chinese and English phone commands preserve query text and ignore questions or negation',t=>{
 harness(t,'PhoneCommandGrammarHarness',`
 public static void main(String[] args)throws Exception{
  String[] commands={"打开微信","帮我打开小红书搜索猫咪","请打开 浏览器，并搜索一下“明天的天气”","打开便签输入 Codex 和 Qoder","please open Chrome and search for weather tomorrow","open Notes and type hello world"};
  for(String value:commands)check(PhoneCommand.parse(value)!=null);
  PhoneCommand c=PhoneCommand.parse(commands[2]);check(c.app.equals("浏览器")&&c.action.equals("search")&&c.text.equals("明天的天气"));
  check(PhoneCommand.parse(commands[3]).text.equals("Codex 和 Qoder"));check(PhoneCommand.parse(commands[4]).app.equals("Chrome"));
  for(String value:new String[]{"不要打开微信","怎么打开微信搜索猫","能不能打开微信？","比如打开微信搜索猫","请总结打开微信的方法","打开微信可以吗","打开微信；删除聊天","open Chrome?","打开如果微信","打开浏览器搜索 "+"x".repeat(2001)})check(PhoneCommand.parse(value)==null);
  System.out.println("ok");
 }`,['PhoneCommand.java']);
});

test('app resolution uses installed exact names, package names and aliases and exposes ambiguous matches',t=>{
 harness(t,'PhoneCommandMatchHarness',`
 static JSONObject app(String name,String pkg){return new JSONObject().put("name",name).put("packageName",pkg);}
 public static void main(String[] args)throws Exception{
  JSONArray apps=new JSONArray().put(app("微信 WeChat","com.tencent.mm")).put(app("微信读书","com.tencent.weread")).put(app("浏览器 A","test.a")).put(app("浏览器 B","test.b")).put(app("便签","demo.app"));
  check(PhoneCommand.matches("微信",apps).size()==1&&PhoneCommand.matches("wechat",apps).get(0).optString("packageName").equals("com.tencent.mm"));
  check(PhoneCommand.matches("浏览器",apps).size()==2);check(PhoneCommand.matches("demo.app",apps).size()==1);
  check(PhoneCommand.matches("Chrome",apps).isEmpty());check(PhoneCommand.matches("微信",new JSONArray().put(app("微信读书","com.tencent.weread"))).isEmpty());
  PhoneCommand c=PhoneCommand.parse("打开便签输入 测试");check(c.request("demo.app","token").optString("requestId").equals("token"));System.out.println("ok");
 }`,['PhoneCommand.java']);
});

test('phone action chat turns are atomic pairs, bounded and explicitly marked to prevent replay or model forwarding',t=>{
 harness(t,'PhoneCommandTurnHarness',`
 public static void main(String[] args)throws Exception{
  JSONArray original=new JSONArray().put(new JSONObject().put("role","user").put("content","old"));
  JSONArray saved=PhoneCommand.appendTurn(original,"打开微信","已请求打开","now","studio-7",3);
  check(original.length()==1&&saved.length()==3);check(saved.getJSONObject(1).optBoolean("phoneAction")&&saved.getJSONObject(2).optBoolean("phoneAction"));check(saved.getJSONObject(2).optString("id").equals("studio-7-assistant")&&saved.getJSONObject(2).optInt("memoryTaskId")==3);
  for(int i=0;i<60;i++)saved=PhoneCommand.appendTurn(saved,"u","a","now","id"+i,0);check(saved.length()==100);System.out.println("ok");
 }`,['PhoneCommand.java']);
});

const execute=methods('PhoneController.java','  private String executePhoneCommand(','  public String beginStudioMessage(').replaceAll('android.os.SystemClock.','Clock.');
const setup=`
 Object activity=new Object();String lastProgress;
 void updateOperation(int id,String phase,String progress,String ignored){lastProgress=progress;}
 static class Clock{static long elapsedRealtime(){return 0;}}
 static class PhoneActions {
  static JSONArray inventory;static boolean enabled,busy,rejected,swap;static int runs;static JSONObject last;
  PhoneActions(Object a){}
  String apps(){return new JSONObject().put("ok",true).put("data",new JSONObject().put("apps",inventory)).toString();}
  String status(){return new JSONObject().put("data",new JSONObject().put("enabled",enabled).put("busy",busy).put("requestId",last==null?"":swap?"another":last.optString("requestId")).put("detail","已提交搜索请求 / Search requested")).toString();}
  String run(String payload){runs++;last=new JSONObject(payload);return new JSONObject().put("ok",!rejected).put("error","denied").toString();}
 }
 ${execute}
 static JSONArray apps(String... names){JSONArray a=new JSONArray();for(int i=0;i<names.length;i++)a.put(new JSONObject().put("name",names[i]).put("packageName","test.app"+i));return a;}
`;
test('native chat dispatches the uniquely matched app once without a model and returns real executor state',t=>{
 harness(t,'PhoneCommandExecutionHarness',setup+`
 public static void main(String[] args)throws Exception{
  PhoneCommandExecutionHarness b=new PhoneCommandExecutionHarness();PhoneActions.inventory=apps("浏览器");PhoneActions.enabled=true;
  String answer=b.executePhoneCommand(PhoneCommand.parse("打开浏览器搜索 天气"),1);
  check(PhoneActions.runs==1&&PhoneActions.last.optString("text").equals("天气")&&PhoneActions.last.optString("action").equals("search"));check(answer.contains("已提交搜索请求")&&!answer.contains(" / "));check(b.lastProgress.contains("20 秒"));
  UiText.configure("en",new HashMap<>());answer=b.executePhoneCommand(PhoneCommand.parse("open 浏览器 and search weather"),2);check(answer.contains("Search requested")&&!answer.contains("已提交搜索请求"));System.out.println("ok");
 }`,['PhoneCommand.java']);
});
test('ambiguous, absent, disabled and busy targets never dispatch; changed results never replay',t=>{
 harness(t,'PhoneCommandRefusalHarness',setup+`
 public static void main(String[] args)throws Exception{
  PhoneCommandRefusalHarness b=new PhoneCommandRefusalHarness();PhoneCommand command=PhoneCommand.parse("打开浏览器搜索 天气");
  PhoneActions.inventory=apps("浏览器 A","浏览器 B");String ambiguous=b.executePhoneCommand(command,1);check(ambiguous.contains("多个")&&ambiguous.contains("浏览器 A")&&ambiguous.contains("浏览器 B"));check(PhoneActions.runs==0);
  PhoneActions.inventory=apps("便签");check(b.executePhoneCommand(command,2).contains("没有找到"));check(PhoneActions.runs==0);
  PhoneActions.inventory=apps("浏览器");check(b.executePhoneCommand(command,3).contains("权限"));check(PhoneActions.runs==0);
  PhoneActions.enabled=true;PhoneActions.busy=true;check(b.executePhoneCommand(command,4).contains("正在进行"));check(PhoneActions.runs==0);
  PhoneActions.busy=false;PhoneActions.swap=true;check(b.executePhoneCommand(command,5).contains("状态已变化"));check(PhoneActions.runs==1);
  PhoneActions.swap=false;PhoneActions.rejected=true;check(b.executePhoneCommand(command,6).contains("未启动"));check(PhoneActions.runs==2);System.out.println("ok");
 }`,['PhoneCommand.java']);
});

test('command admission shares the studio lock, saves an outcome pair and releases the lock on errors',t=>{
 const admission=methods('PhoneController.java','  public String beginPhoneCommand(','  private String executePhoneCommand(');
 harness(t,'PhoneCommandAdmissionHarness',`
 Object activity=new Object();boolean failSave;int executions;Store store=new Store();Operations operations=new Operations();
 class Store{boolean locked;JSONArray history=new JSONArray();boolean beginStudioTurn(){if(locked)return false;locked=true;return true;}void endStudioTurn(){locked=false;}int nextId(){return 9;}JSONArray studioMessages(){return history;}void saveStudioMessages(JSONArray h){if(failSave)throw new IllegalStateException();history=h;}}
 class Operations{JSONObject saved;void completeStudio(int id,String message,JSONObject data){saved=data;}}
 JSONObject registerOperation(int id,String phase,String msg){return new JSONObject().put("id",id);}
 void startWorker(String name,Runnable worker){worker.run();}String now(){return "date";}JSONObject localStudioSnapshot(){return new JSONObject();}
 void updateOperation(int id,String phase,String message,String ignored){}String executePhoneCommand(PhoneCommand c,int id){executions++;return "已请求打开";}
 String success(JSONObject d){return new JSONObject().put("ok",true).put("data",d).toString();}String failure(Exception e){return new JSONObject().put("ok",false).toString();}
 ${admission}
 public static void main(String[] args)throws Exception{
 PhoneCommandAdmissionHarness b=new PhoneCommandAdmissionHarness();String normal=new JSONObject().put("content","看看项目").toString();check(!new JSONObject(b.beginPhoneCommand(normal)).getJSONObject("data").optBoolean("handled"));check(b.executions==0&&!b.store.locked);
 String request=new JSONObject().put("content","打开微信").put("taskId",2).toString();check(new JSONObject(b.beginPhoneCommand(request)).optBoolean("ok"));check(b.executions==1&&!b.store.locked&&b.store.history.length()==2);check(b.operations.saved.getJSONObject("reply").optBoolean("phoneAction"));
 b.store.locked=true;check(!new JSONObject(b.beginPhoneCommand(request)).optBoolean("ok"));check(b.executions==1&&b.store.locked);b.store.locked=false;b.failSave=true;b.beginPhoneCommand(request);check(!b.store.locked);b.activity=null;check(!new JSONObject(b.beginPhoneCommand(request)).optBoolean("ok"));System.out.println("ok");
 }`,['PhoneCommand.java']);
});

test('native revision guard rejects replaying or rewriting a saved phone action',t=>{
 harness(t,'PhoneCommandRevisionHarness',`
 public static void main(String[] args)throws Exception{
 JSONArray saved=PhoneCommand.appendTurn(new JSONArray(),"打开微信","已请求打开","now","local",0);
 try{StudioRevision.before(saved,"local-assistant");throw new AssertionError();}catch(IllegalStateException expected){}
 try{StudioRevision.replace(saved,"local-assistant",0,new JSONObject(),new JSONObject());throw new AssertionError();}catch(IllegalStateException expected){}
 check(saved.length()==2);System.out.println("ok");
 }`,['PhoneCommand.java','StudioRevision.java']);
});

test('natural imperative variants resolve to the same bounded command without interpreting questions',t=>{
 harness(t,'PhoneNaturalSearchHarness',`
 public static void main(String[] args){
 for(String value:new String[]{"帮我在小红书搜索猫咪","去小红书里搜一下猫咪","用小红书查找猫咪","在小红书里面搜索 猫咪","搜一下小红书里的猫咪","search Rednote for cats"}) {
  PhoneCommand c=PhoneCommand.parse(value);check(c!=null);check(c.action.equals("search"));
 }
 check(PhoneCommand.parse("帮我在小红书搜索猫咪").app.equals("小红书"));
 check(PhoneCommand.parse("在手机上打开小红书搜索猫咪").app.equals("小红书"));
 check(PhoneCommand.parse("搜一下小红书里的猫咪").text.equals("猫咪"));
 check(PhoneCommand.parse("去小红书里搜一下猫咪").text.equals("猫咪"));
 for(String value:new String[]{"不要在小红书搜索猫咪","怎么在小红书搜索猫咪","如果在小红书搜索猫咪","例如在小红书搜索猫咪"}) {
  PhoneCommand c=PhoneCommand.parse(value);check(c==null);
 }
 System.out.println("ok");
 }`,['PhoneCommand.java']);
});


test('long whitespace input cannot trigger regex backtracking stalls',t=>{
 harness(t,'PhoneCommandLongInputHarness',`
 public static void main(String[] args)throws Exception {
  long began=System.nanoTime();
  for(String prefix:new String[]{"在","搜","search ","打开","open "})
   for(int i=0;i<20;i++)PhoneCommand.parse(prefix+" ".repeat(3800)+"x");
  check(System.nanoTime()-began<2_000_000_000L);System.out.println("ok");
 }`,['PhoneCommand.java']);
});
