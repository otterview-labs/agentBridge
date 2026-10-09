const { test } = require('node:test');
const { methods, harness } = require('./java-json-fixture.cjs');

const taskFactory = `
static JSONObject task(int id, int machine, String session, String output) {
 return new JSONObject().put("id",id).put("machineId",machine).put("agentType","codex")
  .put("externalSessionId",session).put("stableKey","session:"+session).put("title","Fix login")
  .put("workspacePath","/workspace/app").put("lastOutput",output).put("status","idle")
  .put("requiredInput","Add tests?").put("customTitle","");
}
static JSONArray copy(JSONArray records) {
 JSONArray result=new JSONArray();for(int i=0;i<records.length();i++)result.put(new JSONObject(records.getJSONObject(i).toString()));return result;
}
`;

test('discovery preserves independent sessions and panes while collapsing duplicate observations', t => {
 const dedupe = methods('PhoneBridge.java', '  private JSONArray dedupeSemanticTasks(', '  @JavascriptInterface\n  public String beginTailTask(');
 harness(t, 'TaskIdentityHarness', `${taskFactory}${dedupe}
 public static void main(String[] args)throws Exception {
 TaskIdentityHarness b=new TaskIdentityHarness();JSONArray tasks=new JSONArray();
 tasks.put(task(1,1,"a","first")).put(task(2,1,"b","second"));
 tasks.put(task(3,1,"a","duplicate").put("title","A renamed copy").put("status","running"));
 tasks.put(task(4,1,"","pane1").put("stableKey","%1"));
 tasks.put(task(5,1,"","pane2").put("stableKey","%2"));
 tasks.put(task(6,1,"a","another tool").put("agentType","claude-code"));
 tasks.put(task(7,1,"","unknown1").put("stableKey",""));
 tasks.put(task(8,1,"","unknown2").put("stableKey",""));
 JSONArray result=b.dedupeSemanticTasks(tasks);check(result.length()==7);
 boolean first=false,second=false;for(int i=0;i<result.length();i++){JSONObject item=result.getJSONObject(i);if(item.getInt("id")==3)first=true;if(item.getInt("id")==2)second=true;}check(first&&second);System.out.println("ok");
 }`);
});

const storage = methods('BridgeStore.java', '  synchronized JSONArray replaceTasksForMachine(', '  synchronized void updateTask(');
const deletion = methods('BridgeStore.java', '  synchronized void deleteTask(', '  synchronized void restoreDeletedTask(');
const identity = methods('BridgeStore.java', '  synchronized boolean isDeletedTask(', '  private String now()');
const patch = methods('BridgeStore.java', '  synchronized JSONObject patchTask(', '  synchronized void deleteMachine(');
const fakeStore = `
JSONArray saved=new JSONArray(),deleted=new JSONArray();boolean machineExists=true;
JSONArray tasks(){return copy(saved);}JSONArray deletedTasks(){return copy(deleted);}
void saveTasks(JSONArray value){saved=copy(value);}void saveDeletedTasks(JSONArray value){deleted=copy(value);}
JSONObject machine(int id){if(!machineExists)throw new IllegalArgumentException("machine gone");return new JSONObject().put("id",id);}
String now(){return "now";}
`;

test('late refresh preserves replies and renames, respects deletions, and returns the committed records', t => {
 harness(t, 'TaskCommitHarness', `${taskFactory}${fakeStore}${storage}${deletion}${identity}${patch}
 public static void main(String[] args)throws Exception {
 TaskCommitHarness s=new TaskCommitHarness();s.saved.put(task(1,1,"a","old")).put(task(2,1,"b","old b")).put(task(3,2,"c","other machine"));
 JSONArray baseline=s.tasks();JSONArray scan=copy(baseline);scan.values.remove(2);
 s.patchTask(1,new JSONObject().put("lastOutput","NEW REPLY").put("requiredInput","").put("workSummary","Tests passed").put("customTitle","Training platform").put("title","Training platform"));s.deleteTask(2);
 JSONArray result=s.replaceTasksForMachine(1,scan,baseline);check(result.length()==1&&s.saved.length()==2&&s.deleted.length()==1);
 JSONObject kept=result.getJSONObject(0);check(kept.optString("lastOutput").equals("NEW REPLY"));check(kept.optString("requiredInput").isEmpty());check(kept.optString("title").equals("Training platform"));check(kept.optString("workSummary").equals("Tests passed"));
 // A subsequent fresh scan must be able to update the reply normally.
 baseline=s.tasks();scan=new JSONArray().put(task(1,1,"a","NEXT REPLY"));result=s.replaceTasksForMachine(1,scan,baseline);check(result.getJSONObject(0).optString("lastOutput").equals("NEXT REPLY"));check(result.getJSONObject(0).optString("title").equals("Training platform"));
 // Nothing from an in-flight scan can restore a deleted machine.
 s.machineExists=false;try{s.replaceTasksForMachine(1,scan,baseline);throw new AssertionError();}catch(IllegalArgumentException expected){}check(s.saved.length()==2);System.out.println("ok");
 }`);
});

test('overlapping discoveries keep stable IDs and newly changed or restored tasks', t => {
 harness(t, 'OverlappingScansHarness', `${taskFactory}${fakeStore}${storage}${identity}${patch}
 public static void main(String[] args)throws Exception {
 OverlappingScansHarness s=new OverlappingScansHarness();JSONArray baseline=s.tasks();
 s.replaceTasksForMachine(1,new JSONArray().put(task(10,1,"a","new scan")),baseline);
 JSONArray result=s.replaceTasksForMachine(1,new JSONArray().put(task(11,1,"a","old scan")),baseline);
 check(result.length()==1&&result.getJSONObject(0).getInt("id")==10&&result.getJSONObject(0).optString("lastOutput").equals("new scan"));
 baseline=s.tasks();s.saved.put(task(12,1,"restored","restored after scan began"));s.patchTask(10,new JSONObject().put("lastOutput","new reply"));
 result=s.replaceTasksForMachine(1,new JSONArray(),baseline);check(result.length()==2);
 baseline=s.tasks();result=s.replaceTasksForMachine(1,new JSONArray(),baseline);check(result.length()==0);
 // A reused process identity must not transfer state from a different session.
 check(!s.sameTaskIdentity(task(1,1,"a",""),task(2,1,"b","").put("stableKey","session:a")));
 check(!s.sameTaskIdentity(task(1,1,"",""),task(2,1,"","").put("stableKey","")));
 System.out.println("ok");
 }`);
});

test('tmux refresh clears answered questions and stopped panes but retains new decisions and raw output', t => {
 const fields = methods('PhoneBridge.java', '  private static JSONObject tmuxTaskFields(', '  private static String suggestedReply(');
 const terminal = methods('PhoneBridge.java', '    private static Work fromTerminal(', '    private static Work fromClaudeTranscript(');
 harness(t, 'TmuxDecisionHarness', `
 static String now(){return "now";}
 static class Work{String latestAssistant;Work(String user,String answer,String status){latestAssistant=answer;}String summary(){return latestAssistant;}${terminal}}
 ${fields}
 public static void main(String[] args)throws Exception {
 String answered="是否补上测试？\\n› 请补测试并运行\\n测试完成，全部通过。\\n› ";
 JSONObject result=tmuxTaskFields(answered,false);check(result.optString("requiredInput").isEmpty());check(result.optString("lastOutput").equals(answered));check(!result.optString("workSummary").contains("是否补上测试"));
 String decision="是否补上测试？\\n❯ 请补测试\\n测试通过。是否现在部署？\\n❯ ";result=tmuxTaskFields(decision,false);check(result.optString("requiredInput").equals("是否现在部署？"));
 result=tmuxTaskFields("是否现在部署？",true);check(result.optString("requiredInput").isEmpty()&&result.optString("status").equals("stopped"));
 result=tmuxTaskFields("Should I deploy now?",false);check(result.optString("requiredInput").equals("Should I deploy now?"));System.out.println("ok");
 }`);
});


test('a newer reply keeps all progress fields coherent even when some values equal the baseline', t => {
 harness(t, 'ReplyProgressHarness', `${taskFactory}${fakeStore}${storage}${identity}${patch}
 public static void main(String[] args)throws Exception {
 ReplyProgressHarness s=new ReplyProgressHarness();s.saved.put(task(1,1,"a","old output").put("requiredInput","").put("workSummary","old summary").put("suggestedReply",""));
 JSONArray baseline=s.tasks();JSONArray scan=new JSONArray().put(task(1,1,"a","stale output").put("status","running").put("requiredInput","Deploy now?").put("workSummary","stale summary").put("suggestedReply","stale draft"));
 s.patchTask(1,new JSONObject().put("lastOutput","new reply").put("workSummary","done").put("requiredInput","").put("status","idle").put("suggestedReply",""));
 JSONObject result=s.replaceTasksForMachine(1,scan,baseline).getJSONObject(0);
 check(result.optString("lastOutput").equals("new reply"));check(result.optString("workSummary").equals("done"));check(result.optString("status").equals("idle"));check(result.optString("requiredInput").isEmpty());check(result.optString("suggestedReply").isEmpty());System.out.println("ok");
 }`);
});
