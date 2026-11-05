const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const {source,harness}=require('./java-json-fixture.cjs');

test('operation snapshots isolate workers and readers; clearing prevents late completion from reappearing',t=>{
  harness(t,'OperationSnapshots',`
  public static void main(String[] args)throws Exception{
    java.util.concurrent.atomic.AtomicLong clock=new java.util.concurrent.atomic.AtomicLong(100);
    BridgeOperations operations=new BridgeOperations(clock::get);
    JSONObject nested=new JSONObject().put("value","original");
    JSONObject first=operations.register(1,"model","thinking",new JSONObject().put("nested",nested));
    nested.put("value","caller changed");first.put("state","failed");first.getJSONObject("nested").put("value","reader changed");
    check(operations.get(1).optString("state").equals("running"));
    check(operations.get(1).getJSONObject("nested").optString("value").equals("original"));
    JSONObject result=new JSONObject().put("answer","complete");clock.set(200);
    operations.completeStudio(1,"done",result);result.put("answer","mutated");
    JSONObject done=operations.get(1);check(done.optString("state").equals("succeeded"));
    check(done.getJSONObject("studio").optString("answer").equals("complete"));check(done.optLong("updatedAt")==200);
    operations.remove(1);operations.completeStudio(1,"late",result);operations.mark(1,"partialText","late");
    operations.update(1,"failed","late","",null);check(operations.get(1)==null);
    System.out.println("ok");
  }`,['BridgeOperations.java']);
});

test('concurrent operations keep their own result, timestamps and bounded retention',t=>{
  harness(t,'OperationConcurrency',`
  public static void main(String[] args)throws Exception{
    BridgeOperations operations=new BridgeOperations();
    java.util.concurrent.atomic.AtomicReference<Throwable> error=new java.util.concurrent.atomic.AtomicReference<>();
    List<Thread> workers=new ArrayList<>();
    for(int i=1;i<=12;i++){final int id=i;operations.register(id,"call","",null);
      workers.add(new Thread(()->{try{for(int j=0;j<50;j++)operations.mark(id,"partialText",id+":"+j);
        operations.mark(id,"result",new JSONObject().put("id",id));operations.update(id,"succeeded","done","",null);
      }catch(Throwable e){error.set(e);}}));}
    for(Thread w:workers)w.start();for(Thread w:workers)w.join();if(error.get()!=null)throw new AssertionError(error.get());
    for(int id=1;id<=12;id++){JSONObject result=operations.get(id);check(result.optString("state").equals("succeeded"));
      check(result.getJSONObject("result").getInt("id")==id);check(result.optString("partialText").equals(id+":49"));}
    operations.register(50,"call","",null);
    for(int id=100;id<230;id++){operations.register(id,"call","",null);operations.update(id,"succeeded","done",null,null);}
    check(operations.get(50)!=null);check(operations.get(100)==null);check(operations.get(229)!=null);
    System.out.println("ok");
  }`,['BridgeOperations.java']);
});

const fakeChannel=`
  static class Fake implements RemoteCommandRunner.Channel {
    InputStream input;boolean active,closed=true,disposed,failConnect;int exit;String command;InputStream stdin;OutputStream errors;
    Fake(byte[] bytes){input=new ByteArrayInputStream(bytes);}
    public void configure(String command,InputStream stdin,OutputStream stderr)throws Exception{this.command=command;this.stdin=stdin;errors=stderr;}
    public InputStream stdout(){return input;}
    public void connect(int timeout)throws Exception{if(failConnect)throw new IOException("connect failed");}
    public boolean closed(){return closed;}public boolean connected(){return active;}public int exitStatus(){return exit;}
    public void close(){disposed=true;}
  }
`;

test('remote execution bounds output and always closes channels, including setup failures',t=>{
  harness(t,'CommandLimits',`${fakeChannel}
  public static void main(String[] args)throws Exception{
    RemoteCommandRunner runner=new RemoteCommandRunner((error,exit,stage)->error);
    byte[] bytes=new byte[2_100_000];Arrays.fill(bytes,(byte)'x');Fake done=new Fake(bytes);
    InputStream stdin=new ByteArrayInputStream(new byte[]{42});String result=runner.run(done,"literal command",stdin,1000);
    check(result.length()==2_000_000&&done.disposed&&done.stdin==stdin&&done.command.equals("literal command"));
    Fake failure=new Fake(new byte[0]);failure.failConnect=true;
    try{runner.run(failure,"command",null,1000);throw new AssertionError();}catch(IOException expected){}
    check(failure.disposed);System.out.println("ok");
  }`,['RemoteCommandRunner.java']);
});

test('remote execution reports timeout, disconnect and nonzero exit without automatic retry',t=>{
  harness(t,'CommandFailures',`${fakeChannel}
  public static void main(String[] args)throws Exception{
    java.util.concurrent.atomic.AtomicLong clock=new java.util.concurrent.atomic.AtomicLong();
    RemoteCommandRunner runner=new RemoteCommandRunner(clock::get,ms->clock.addAndGet(TimeUnit.MILLISECONDS.toNanos(ms)),
      (error,exit,stage)->"exit="+exit+stage+":"+error);
    Fake hanging=new Fake(new byte[0]);hanging.closed=false;hanging.active=true;
    try{runner.run(hanging,"command",null,1000);throw new AssertionError();}catch(IllegalArgumentException e){check(e.getMessage().contains("远程进程可能仍在运行"));}check(hanging.disposed);
    Fake disconnected=new Fake(new byte[0]);disconnected.exit=-1;
    try{runner.run(disconnected,"command",null,1000);throw new AssertionError();}catch(IllegalArgumentException e){check(e.getMessage().contains("未返回退出状态"));}check(disconnected.disposed);
    Fake failed=new Fake("ASB_STAGE=download\\nASB_STAGE=install\\n".getBytes(StandardCharsets.UTF_8)){
      public void connect(int timeout)throws Exception{byte[] errors=new byte[100_000];Arrays.fill(errors,(byte)'E');this.errors.write(errors);}
    };failed.exit=7;
    try{runner.run(failed,"command",null,1000);throw new AssertionError();}catch(IllegalArgumentException e){check(e.getMessage().startsWith("exit=7，阶段 install:"));check(e.getMessage().length()<1600);}check(failed.disposed);
    Fake interrupted=new Fake(new byte[0]);interrupted.closed=false;interrupted.active=true;
    RemoteCommandRunner cancelling=new RemoteCommandRunner(System::nanoTime,ms->{throw new InterruptedException();},(e,x,s)->e);
    try{cancelling.run(interrupted,"command",null,1000);throw new AssertionError();}catch(InterruptedException expected){}check(interrupted.disposed);
    System.out.println("ok");
  }`,['RemoteCommandRunner.java']);
});

test('WebView facade retains the pinned API and passes arguments unchanged without exposing native helpers',t=>{
  const contract=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/bridge-api.json'),'utf8'));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'asb-api-contract-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pkg='com.otterview.agentsessionbridge';
  const write=(name,text)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
  const files=[write('PhoneBridge.java',fs.readFileSync(path.join(source,'PhoneBridge.java'),'utf8')),
    write('JavascriptInterface.java','package android.webkit; import java.lang.annotation.*; @Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD) public @interface JavascriptInterface {}'),
    write('JSONObject.java','package org.json; public class JSONObject {}'),
    write('MainActivity.java',`package ${pkg}; final class MainActivity {}`)];
  const methods=contract.map(([name,params])=>{const args=params?params.split(',').map(p=>p.trim().split(' ').at(-1)).join(','):'';return `public String ${name}(${params}) { lastName="${name}";lastArgs=new Object[]{${args}};return "result"; }`;}).join('\n');
  files.push(write('PhoneController.java',`package ${pkg}; import org.json.JSONObject; final class PhoneController {
    String lastName;Object[] lastArgs;PhoneController(){}PhoneController(MainActivity a){}
    ${methods}
    JSONObject voiceConfig(){return null;}String getDashScopeApiKey(){return "";}boolean usesCloudVoice(){return false;}
    void cancelVoiceTranscription(){}JSONObject transcribeVoiceAudio(String a,String b,JSONObject c,java.util.function.BooleanSupplier d){return null;}void close(){}
  }`));
  const checks=contract.map(([name,params])=>{const types=params?params.split(',').map(p=>p.trim().split(' ')[0]):[];
    const values=types.map(type=>type==='int'?'42':type==='boolean'?'false':type==='double'?'1.25':'"中文 \\"literal\\" -- text"');
    return `{ java.lang.reflect.Method method=PhoneBridge.class.getDeclaredMethod("${name}"${types.length?','+types.map(t=>t+'.class').join(','):''});Object[] args=new Object[]{${values.join(',')}};
      if(!method.isAnnotationPresent(android.webkit.JavascriptInterface.class))throw new AssertionError("missing annotation");
      if(!method.invoke(bridge,args).equals("result")||!controller.lastName.equals("${name}")||!java.util.Arrays.equals(args,controller.lastArgs))throw new AssertionError("changed call"); }`;}).join('\n');
  files.push(write('ContractHarness.java',`package ${pkg}; public class ContractHarness { public static void main(String[] ignored)throws Exception{
    PhoneController controller=new PhoneController();PhoneBridge bridge=new PhoneBridge(controller);${checks}
    long exposed=java.util.Arrays.stream(PhoneBridge.class.getDeclaredMethods()).filter(m->m.isAnnotationPresent(android.webkit.JavascriptInterface.class)).count();
    if(exposed!=${contract.length})throw new AssertionError("unexpected exposed method");System.out.println("ok");}}`));
  const bin=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name):name;
  execFileSync(bin('javac'),['-d',root,...files]);assert.equal(execFileSync(bin('java'),['-cp',root,pkg+'.ContractHarness'],{encoding:'utf8',timeout:10000}).trim(),'ok');
});
