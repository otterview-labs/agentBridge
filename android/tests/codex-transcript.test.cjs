const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { source, methods, harness } = require('./java-json-fixture.cjs');
const reader = path.resolve(__dirname, '../app/src/main/assets/codex-transcript.py');
const java = fs.readFileSync(path.join(source, 'PhoneBridge.java'), 'utf8');
const work = java.slice(java.indexOf('  private static final class Work {'), java.lastIndexOf('\n}')).replaceAll('org.json.JSONArray', 'JSONArray');

test('refreshing one desktop employee reads only that thread and retains its reply', t => {
  const discovery = methods('PhoneBridge.java', '  private List<JSONObject> listCodexDesktopTasks(', '  private void preserveCustomTitles(');
  harness(t, 'CodexSingleRefreshHarness', `
 static final String CODEX_THREAD_ID="[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
 static final String TARGET="01a094c7-6452-73d2-a9c0-1b85f22498c7";
 static class Session{} static class Log{static void d(String tag,String value){}}
 static class Assets{InputStream open(String name){check(name.equals("codex-transcript.py"));return new ByteArrayInputStream("reader".getBytes(StandardCharsets.UTF_8));}}
 static class Activity{Assets getAssets(){return new Assets();}} Activity activity=new Activity();
 static class Work{String latestUser="Check login",latestAssistant="Tests passed",status="idle";static Work fromCodexTranscript(String text){check(text.contains("REAL_REPLY"));return new Work();}String summary(){return latestAssistant;}}
 JSONObject parseObject(String text){try{return new JSONObject(text);}catch(Exception e){return null;}}
 String run(Session session,String command){
  check(!command.contains("thread-writer-locks"));
  if(command.startsWith("cat ")) return new JSONObject().put("id",TARGET).put("thread_name","Training platform").toString()+"\\n"+new JSONObject().put("id","00000000-0000-0000-0000-000000000001").put("thread_name","Other employee").toString();
  if(command.startsWith("find ")){check(command.contains(TARGET)&&!command.contains("00000000-0000-0000-0000-000000000001"));return "/records/"+TARGET+".jsonl\\n";}
  check(command.contains("python3 -c")&&command.contains("tail -c 32768"));
  return "__ASB_THREAD__\\t"+TARGET+"\\t/records/"+TARGET+".jsonl\\nmeta\\n__ASB_TAIL__\\nREAL_REPLY\\n__ASB_END__\\n";
 }
 String shellQuote(String value){return "'"+value+"'";} String extractJsonStringField(String meta,String key){return key.equals("cwd")?"/work/project":"";}
 String deriveTitle(String a,String b,String c,String d){return a==null?b:a;}boolean isVagueWorkTitle(String title){return false;}
 String requiredInput(String text){return "";}String suggestedReply(String text){return "";}String now(){return "now";}String displayName(String agent,String title){return title;}
 JSONObject baseTask(int machine,String pane,String stable,String agent,String mode){return new JSONObject().put("machineId",machine).put("paneId",pane).put("stableKey",stable);}
 ${discovery}
 public static void main(String[] args)throws Exception{
 CodexSingleRefreshHarness b=new CodexSingleRefreshHarness();List<JSONObject> tasks=b.listCodexDesktopTasks(new Session(),77,TARGET);
 check(tasks.size()==1);JSONObject task=tasks.get(0);check(task.optString("externalSessionId").equals(TARGET)&&task.optString("workSummary").equals("Tests passed"));
 check(task.optString("status").equals("idle")&&task.optString("lastOutput").contains("Tests passed"));
 try{b.listCodexDesktopTasks(new Session(),77,"invalid; command");throw new AssertionError();}catch(IllegalArgumentException expected){}
 System.out.println("ok");
 }`);
});

test('recent Codex messages survive large tool records without reading an entire transcript', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asb-transcript-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'session.jsonl');
  const row = (role, text) => JSON.stringify({ type: 'response_item', payload: { type: 'message', role,
    content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] } }) + '\n';
  const state = type => JSON.stringify({ type: 'event_msg', payload: { type } }) + '\n';
  fs.writeFileSync(file, 'incomplete old line\n' + state('task_started') + row('user', 'Check login')
    + JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', output: 'x'.repeat(400000) } }) + '\n'
    + row('assistant', 'Login fixed. Add tests?') + state('task_complete')
    + JSON.stringify({ type: 'response_item', payload: { type: 'function_call_output', output: 'y'.repeat(200000) } }) + '\n');
  const read = () => execFileSync('python3', [reader, file], { encoding: 'utf8' }).trim().split('\n').map(JSON.parse);
  let result = read();
  assert.equal(result.length, 3);
  assert.equal(result[0].payload.role, 'user');
  assert.equal(result[1].payload.content[0].text, 'Login fixed. Add tests?');
  assert.equal(result[2].payload.type, 'task_complete');
  // More than 8 MB of newer tool data exceeds the intentional scan budget.
  // An empty result is preferable to copying gigabytes or inventing progress.
  fs.appendFileSync(file, JSON.stringify({ type: 'tool', payload: { output: 'z'.repeat(9 * 1024 * 1024) } }) + '\n');
  assert.equal(execFileSync('python3', [reader, file], { encoding: 'utf8' }).trim(), '');
});

test('Codex event messages are readable and internal agent traffic stays hidden', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asb-events-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, 'events.jsonl');
  fs.writeFileSync(file, [
    { type: 'event_msg', payload: { type: 'user_message', message: 'Review this change' } },
    { type: 'event_msg', payload: { type: 'agent_message', message: 'Reviewed. Tests passed.' } },
    { type: 'response_item', payload: { type: 'agent_message', author: { role: 'assistant' }, content: [{ type: 'input_text', text: 'Internal delegate note' }] } },
    { type: 'event_msg', payload: { type: 'task_complete' } }
  ].map(JSON.stringify).join('\n'));
  const result = execFileSync('python3', [reader, file], { encoding: 'utf8' });
  assert.ok(result.includes('Reviewed. Tests passed.'));
  assert.ok(!result.includes('Internal delegate note'));
});

test('transcript status and the latest reply stay coherent across new turns and empty output', t => {
  harness(t, 'CodexTranscriptHarness', `
 static String latestTerminalOutput(String value){return value;}
 ${work}
 static String event(String type,String message){return new JSONObject().put("type","event_msg").put("payload",new JSONObject().put("type",type).put("message",message)).toString()+"\\n";}
 static String message(String role,String text){return new JSONObject().put("type","response_item").put("payload",new JSONObject().put("type","message").put("role",role).put("content",new JSONArray().put(new JSONObject().put("type",role.equals("user")?"input_text":"output_text").put("text",text)))).toString()+"\\n";}
 public static void main(String[] args){
 Work w=Work.fromCodexTranscript(message("user","Check login")+message("assistant","Tests passed")+event("task_complete",""));
 check(w.latestUser.equals("Check login")&&w.latestAssistant.equals("Tests passed")&&w.status.equals("idle"));
 w=Work.fromCodexTranscript(event("task_complete",""));check(w.status.equals("idle")&&w.latestAssistant==null);
 w=Work.fromCodexTranscript(event("task_failed",""));check(w.status.equals("error"));
 w=Work.fromCodexTranscript(message("assistant","OLD REPLY")+event("task_started","")+message("user","New question"));
 check(w.latestAssistant==null&&w.latestUser.equals("New question")&&w.status.equals("running"));
 w=Work.fromCodexTranscript(event("user_message","Review this change")+event("agent_message","Reviewed")+event("task_complete",""));
 check(w.latestUser.equals("Review this change")&&w.latestAssistant.equals("Reviewed"));
 w=Work.fromClaudeTranscript(new JSONObject().put("message",new JSONObject().put("role","user").put("content","Write tests")).toString()+"\\n"+new JSONObject().put("message",new JSONObject().put("role","assistant").put("content","Done")).toString());
 check(w.latestUser.equals("Write tests")&&w.latestAssistant.equals("Done"));
 System.out.println("ok");
 }`);
});

test('explanatory questions do not become pending confirmations', t => {
  const required = methods('PhoneBridge.java', '  private static String requiredInput(', '  private static String suggestedReply(');
  harness(t, 'PendingQuestionHarness', `${required}
 static void expect(String input,String wanted){String actual=requiredInput(input);if(!actual.equals(wanted))throw new AssertionError("Expected ["+wanted+"] but got ["+actual+"]");}
 public static void main(String[] args){
 expect("为什么报错后容器还一直显示 running？错误发生在发送线程中，主进程仍在等待。","");
 expect("Why does the container stay running? The worker is still waiting for data.","");
 expect("原因找到了。是否现在重启训练？","是否现在重启训练？");
 expect("Tests passed. Should I deploy now?","Should I deploy now?");
 expect("Which dataset should we use?","Which dataset should we use?");
 expect("可以执行部署吗？","可以执行部署吗？");
 expect("请提供失败日志。","请提供失败日志。");
 System.out.println("ok");
 }`);
});
