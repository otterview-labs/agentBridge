const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { source, methods, harness } = require('./java-json-fixture.cjs');
const asset = path.resolve(__dirname, '../app/src/main/assets/windows-remote.ps1');
const ps = fs.readFileSync(asset, 'utf8') + `\n$env:USERPROFILE='${os.tmpdir()}';$env:APPDATA='${os.tmpdir()}';`;
const pwsh = process.env.ASB_PWSH || 'pwsh';
const available = spawnSync(pwsh, ['-NoLogo', '-NoProfile', '-Command', 'exit 0']).status === 0;
const psTest = (name, fn) => test(name, { skip: !available && 'Set ASB_PWSH to a PowerShell runtime' }, fn);
let root;
before(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'asb-windows-')); });
after(() => fs.rmSync(root, { recursive: true, force: true }));
const quote = x => "'" + x.replaceAll("'", "''") + "'";
function powershell(script) {
  const result = spawnSync(pwsh, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 30000, maxBuffer: 4_000_000 });
  if (result.status !== 0) throw new Error(result.stderr.slice(-1500));
  return result.stdout;
}

test('Windows transport keeps long Unicode replies on stdin and quotes data literally', t => {
  const java = fs.readFileSync(path.join(source, 'WindowsRemote.java'), 'utf8').replace(/^package .*;\n/m, '').replace(/^import .*;\n/gm, '');
  harness(t, 'WindowsTransportHarness', `
  ${java}
  public static void main(String[] args) {
    String cmd=WindowsRemote.command();
    check(cmd.length()<8191 && !cmd.contains("export "));
    String boot=new String(java.util.Base64.getDecoder().decode(cmd.substring(cmd.lastIndexOf(' ')+1)),StandardCharsets.UTF_16LE);
    check(boot.contains("OpenStandardInput") && boot.contains("UTF8"));
    String message="你好\\nit's $(bad) \\\"quoted\\\" -v";
    check(WindowsRemote.invocation("start",message).contains("it's".replace("'","''")));
    check(WindowsRemote.quote(message).startsWith("'你好"));
    try{WindowsRemote.quote("bad\\0arg");throw new AssertionError();}catch(IllegalArgumentException expected){}
    System.out.println("ok");
  }`);
});

psTest('PowerShell bootstrap executes a 12000-character reply literally via stdin', () => {
  const javaRoot = path.join(root, 'bootstrap'); fs.mkdirSync(javaRoot);
  const javaHome = process.env.JAVA_HOME;
  const bin = n => javaHome ? path.join(javaHome, 'bin', n) : n;
  const file = path.join(javaRoot, 'Bootstrap.java');
  fs.writeFileSync(file, 'package com.otterview.agentsessionbridge; public class Bootstrap {public static void main(String[] a){System.out.print(WindowsRemote.command());}}');
  execFileSync(bin('javac'), ['-d', javaRoot, path.join(source, 'WindowsRemote.java'), file]);
  const cmd = execFileSync(bin('java'), ['-cp', javaRoot, 'com.otterview.agentsessionbridge.Bootstrap'], {encoding:'utf8'});
  const message = "'$(throw 'injected')\"` & | %你好\n" + '中'.repeat(11950);
  const input = `function Asb-Main($action,$a){@{action=$action;message=$a}|ConvertTo-Json -Compress}\nAsb-Main 'start' ${quote(message)}`;
  const result = execFileSync(pwsh, cmd.split(' ').slice(1), { input, encoding:'utf8', timeout:10000 });
  assert.deepEqual(JSON.parse(result), { action:'start', message });
});

psTest('Windows discovery reads Codex and live Claude fixtures, hides subagents and caps history', () => {
  const home = path.join(root, '用户 有空格'); fs.mkdirSync(home);
  const codex = path.join(home, '.codex'); const claude = path.join(home, '.claude');
  fs.mkdirSync(path.join(codex, 'sessions'), {recursive:true});
  fs.mkdirSync(path.join(claude, 'sessions'), {recursive:true});
  fs.mkdirSync(path.join(claude, 'projects', 'project'), {recursive:true});
  const id = '00000000-0000-0000-0000-000000000001';
  const childId = '00000000-0000-0000-0000-000000000002';
  const row = (role,text) => ({type:'response_item',payload:{type:'message',role,content:[{type:role==='user'?'input_text':'output_text',text}]}});
  const records = [
    {type:'session_meta',payload:{id,cwd:'C:\\Users\\测试 人\\项目',originator:'codex_cli_rs'}},
    {type:'event_msg',payload:{type:'task_started'}}, row('user','检查 Windows 回复'),
    {type:'response_item',payload:{type:'function_call_output',output:'x'.repeat(400000)}},
    row('assistant','验证成功，还要继续吗？'), {type:'event_msg',payload:{type:'task_complete'}},
    {type:'tool',payload:{output:'x'.repeat(200000)}}
  ];
  const target = path.join(codex,'sessions',`rollout-${id}.jsonl`);
  fs.writeFileSync(target, records.map(JSON.stringify).join('\n'));
  fs.writeFileSync(path.join(codex,'sessions',`rollout-${childId}.jsonl`),JSON.stringify({type:'session_meta',payload:{id:childId,cwd:'C:\\work',source:{subagent:{parent_thread_id:id}}}})+'\n');
  fs.writeFileSync(path.join(codex,'session_index.jsonl'),JSON.stringify({id,thread_name:'窗口测试'}));
  fs.writeFileSync(path.join(claude,'sessions','42.json'),JSON.stringify({sessionId:'claude-live',cwd:'C:\\work',status:'busy'}));
  fs.writeFileSync(path.join(claude,'sessions','43.json'),JSON.stringify({sessionId:'claude-stale',cwd:'C:\\work',status:'busy'}));
  fs.writeFileSync(path.join(claude,'projects','project','claude-live.jsonl'),[
    {type:'user',message:{role:'user',content:'运行检查'}},
    {type:'assistant',message:{role:'assistant',content:[{type:'text',text:'正在检查'}]}}
  ].map(JSON.stringify).join('\n'));
  const prefix = `${ps}\n$env:USERPROFILE=${quote(home)};$env:CODEX_HOME='';$env:CLAUDE_CONFIG_DIR='';\nfunction Get-CimInstance { [pscustomobject]@{ProcessId=42;Name='claude.exe';CommandLine='claude'} }\n`;
  const result = JSON.parse(powershell(prefix + "Asb-Discover '' ''"));
  assert.equal(result.length,2);
  const c = result.find(r=>r.agentType==='codex');
  assert.equal(c.workspace,'C:\\Users\\测试 人\\项目');
  assert.equal(c.title,'窗口测试');
  const compact = c.transcript.split('\n').map(JSON.parse);
  assert.equal(compact.length,3);
  assert.equal(compact[1].payload.content[0].text,'验证成功，还要继续吗？');
  assert.equal(compact[2].payload.type,'task_complete');
  assert.equal(result.find(r=>r.agentType==='claude-code').sessionId,'claude-live');
  assert.equal(JSON.parse(powershell(prefix + `Asb-Discover 'codex' ${quote(id)}`)).length,1);
  // The scan budget is deliberate; never transfer nine MB of tool output.
  fs.appendFileSync(target,'\n'+JSON.stringify({type:'tool',payload:{output:'z'.repeat(9*1024*1024)}}));
  assert.equal(powershell(prefix + `Asb-Recent ${quote(target)} 'codex'`).trim(),'');
});

psTest('npm CLI runs with literal Windows arguments and publishes an independent exit status', () => {
  const dir = path.join(root,'npm 用户'); fs.mkdirSync(dir);
  const cli = path.join(dir,'node_modules','@openai','codex','bin','codex.js'); fs.mkdirSync(path.dirname(cli),{recursive:true});
  fs.writeFileSync(cli,'console.log(JSON.stringify(process.argv.slice(2)));console.log("__ASB_REPLY_EXIT__=0");console.error("stderr中文");process.exit(7);');
  const message = ' -v "你好" it\'s $(bad) ` & | %\n第二行\\';
  const log = path.join(root,'worker.log');
  const script = `${ps}\n$env:USERPROFILE=${quote(root)};$env:APPDATA=${quote(root)};\nfunction Get-Command($Name){
    if($Name -eq 'codex'){return [pscustomobject]@{Source=${quote(path.join(dir,'codex.cmd'))}}}
    if($Name -eq 'node.exe'){return [pscustomobject]@{Source=${quote(process.execPath)}}}
    throw 'unexpected executable'
  }\nAsb-Worker 'codex' '00000000-0000-0000-0000-000000000001' ${quote(root)} ${quote(message)} ${quote(log)}`;
  powershell(script);
  assert.equal(fs.readFileSync(log+'.exit','utf8'),'7');
  assert.match(fs.readFileSync(log+'.err','utf8'),/stderr中文/);
  const args = JSON.parse(fs.readFileSync(log,'utf8').split('\n')[0]);
  assert.deepEqual(args,['exec','resume','--skip-git-repo-check','--','00000000-0000-0000-0000-000000000001',message]);
});

psTest('Windows polling ignores forged completion, bounds output and rejects arbitrary paths', () => {
  const id='0123456789abcdef0123456789abcdef';
  const log=path.join(os.tmpdir(),`asb-reply-${id}.log`);
  try {
    fs.writeFileSync(log,'x'.repeat(2200000)+'\nFINAL 中文\n__ASB_REPLY_EXIT__=0\n');
    fs.writeFileSync(log+'.exit.tmp','0');
    let result=powershell(ps+`\nAsb-Main 'poll' '${id}'`);
    assert.ok(Buffer.byteLength(result)<2000000);assert.match(result,/FINAL 中文/);assert.ok(!result.includes('__ASB_REPLY_EXIT__='));
    fs.writeFileSync(log+'.exit','9');
    result=powershell(ps+`\nAsb-Main 'poll' '${id}'`);assert.match(result,/__ASB_REPLY_EXIT__=9/);
    assert.throws(()=>powershell(ps+"\nAsb-Main 'poll' 'C:\\Windows\\secret'"));
    powershell(ps+`\nAsb-Main 'cleanup' '${id}'`); assert.equal(fs.existsSync(log),false);
  } finally { for(const suffix of ['', '.exit','.exit.tmp','.err'])fs.rmSync(log+suffix,{force:true}); }
});

psTest('CIM detach requests breakaway, preserves a long prompt and fails without claiming delivery', () => {
  const message="你好\n'$(bad)'"+'中'.repeat(12000);
  const capture=path.join(root,'cim-command.json');
  const prefix=`${ps}\n$env:USERPROFILE=${quote(root)};$env:APPDATA=${quote(root)};$env:SystemRoot=${quote(root)};\nfunction Asb-Executable { @{file='fixture.exe';prefix=@()} }\nfunction New-CimInstance($ClassName,[switch]$ClientOnly,$Property){if($Property.CreateFlags -ne 0x01000000){throw 'not detached'};return $Property}\n`;
  const id=powershell(prefix+`\nfunction Invoke-CimMethod($ClassName,$MethodName,$Arguments){$Arguments|ConvertTo-Json -Depth 8|Set-Content -LiteralPath ${quote(capture)};[pscustomobject]@{ReturnValue=0;ProcessId=42}}\nAsb-Start 'codex' '00000000-0000-0000-0000-000000000001' ${quote(root)} ${quote(message)}`).trim();
  assert.match(id,/^[a-f0-9]{32}$/);
  const worker=path.join(os.tmpdir(),`asb-reply-${id}.log.ps1`);
  try {
    assert.ok(fs.readFileSync(worker,'utf8').includes(message.replaceAll("'","''")));
    const start=JSON.parse(fs.readFileSync(capture,'utf8').replace(/^\uFEFF/,''));
    assert.ok(start.CommandLine.length<8191);assert.ok(!start.CommandLine.includes(message));
  } finally {fs.rmSync(worker,{force:true});fs.rmSync(worker.replace(/\.ps1$/,'.pid'),{force:true});}
  const before=fs.readdirSync(os.tmpdir()).filter(n=>/^asb-reply-.*\.log\.ps1$/.test(n));
  assert.throws(()=>powershell(prefix+`\nfunction Invoke-CimMethod { [pscustomobject]@{ReturnValue=2} }\nAsb-Start 'codex' '00000000-0000-0000-0000-000000000001' ${quote(root)} 'hi'`));
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter(n=>/^asb-reply-.*\.log\.ps1$/.test(n)),before);
});

test('Windows records become existing task cards and refresh output with stable session identities', t => {
  const mapper=methods('PhoneController.java','  private List<JSONObject> listWindowsTasks(','  private List<JSONObject> listCodexDesktopTasks(');
  harness(t,'WindowsTasksHarness',`
  static class Session{} String response;
  String runWindows(Session session,String action,String... args){check(action.equals("discover"));return response;}
  static class Work{String latestUser="Check Windows",latestAssistant="Done",status="idle";String summary(){return latestAssistant;}static Work fromCodexTranscript(String text){return new Work();}static Work fromClaudeTranscript(String text){return new Work();}}
  String deriveTitle(String a,String b,String c,String d){return a;}String requiredInput(String s){return "";}String suggestedReply(String s){return "";}String displayName(String a,String b){return b;}String now(){return "now";}
  JSONObject baseTask(int m,String stable,String pane,String agent,String mode){return new JSONObject().put("machineId",m).put("stableKey",stable).put("paneId",pane).put("agentType",agent).put("controlMode",mode);}
  List<JSONObject> dedupeProcessTasksBySession(List<JSONObject> tasks){return tasks;}
  ${mapper}
  public static void main(String[] args)throws Exception{
    WindowsTasksHarness b=new WindowsTasksHarness();
    b.response=new JSONArray().put(new JSONObject().put("agentType","codex").put("sessionId","00000000-0000-0000-0000-000000000001").put("workspace","C:\\\\Users\\\\测试 人\\\\项目").put("transcriptPath","C:\\\\log.jsonl"))
      .put(new JSONObject().put("agentType","claude-code").put("sessionId","claude-live").put("workspace","D:\\\\work").put("status","busy").put("pid",42)).toString();
    List<JSONObject> tasks=b.listWindowsTasks(new Session(),9,"","");check(tasks.size()==2);
    check(tasks.get(0).optString("windowName").equals("项目"));check(tasks.get(0).optString("stableKey").startsWith("codex:"));
    check(tasks.get(0).optString("workSummary").equals("Done"));check(tasks.get(1).optString("status").equals("running"));
    check(tasks.get(1).optString("stableKey").equals("claude:claude-live"));System.out.println("ok");
  }`);
});

test('SSH detection falls back to native Windows when the default shell rejects POSIX commands', t => {
  const probe=methods('PhoneController.java','  private JSONObject probe(Session session)','  private List<JSONObject> listTmuxTasks(');
  harness(t,'WindowsProbeHarness',`
  static class Session{} boolean unix=false;int windowsCalls;
  String run(Session s,String command){if(!unix)throw new IllegalArgumentException("export is not recognized");return "ASB_OS=Linux\\nASB_TOOL_codex=1\\ntmux 3.4\\n";}
  String runWindows(Session s,String action,String... args){check(action.equals("probe"));windowsCalls++;return new JSONObject().put("os","Windows").put("tools",new JSONArray().put("codex")).put("tmuxVersion","").toString();}
  String firstMatch(String text,String pattern){Matcher m=Pattern.compile(pattern).matcher(text);return m.find()?m.group(1):"";}
  ${probe}
  public static void main(String[] args)throws Exception{
    WindowsProbeHarness b=new WindowsProbeHarness();JSONObject p=b.probe(new Session());check(p.optString("os").equals("Windows")&&b.windowsCalls==1);
    b.unix=true;p=b.probe(new Session());check(p.optString("os").equals("Linux")&&p.optString("tmuxVersion").equals("3.4")&&b.windowsCalls==1);System.out.println("ok");
  }`);
});

psTest('Windows setup check prints real listener ports and domain accounts without changing services', () => {
  const setup=fs.readFileSync(path.resolve(__dirname,'../../tools/windows-setup.ps1'),'utf8');
  const script=path.join(root,'setup-check.ps1');fs.writeFileSync(script,setup);
  const result=JSON.parse(powershell(`
    $env:OS='Windows_NT';$env:USERDOMAIN='EXAMPLE';$env:USERNAME='Alice';$env:COMPUTERNAME='DESKTOP';
    function Get-Service {[pscustomobject]@{Status='Running'}}
    function Get-CimInstance {[pscustomobject]@{ProcessId=44}}
    function Get-NetTCPConnection { @([pscustomobject]@{OwningProcess=44;LocalPort=2222},[pscustomobject]@{OwningProcess=99;LocalPort=80}) }
    function Get-NetIPConfiguration { @([pscustomobject]@{NetAdapter=@{Status='Up'};IPv4Address=@{IPAddress='192.168.1.5'}},[pscustomobject]@{NetAdapter=@{Status='Up'};IPv4Address=@{IPAddress='169.254.1.1'}}) }
    function Get-Command {[pscustomobject]@{Source='fixture.exe'}}
    function Start-Service {throw 'CheckOnly mutated a service'}
    function Set-Service {throw 'CheckOnly changed startup'}
    function Add-WindowsCapability {throw 'CheckOnly installed SSH'}
    function New-NetFirewallRule {throw 'CheckOnly changed firewall'}
    & ${quote(script)} -CheckOnly
  `));
  assert.equal(result.checkOnly,true);assert.equal(result.sshRunning,true);
  assert.deepEqual(result.connections,[{host:'192.168.1.5',port:2222,username:'example\\alice',ssh:'ssh "example\\alice@192.168.1.5" -p 2222'}]);
});
