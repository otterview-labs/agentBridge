const {test} = require('node:test');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {methods,harness} = require('./java-json-fixture.cjs');

test('phone Markdown memory survives reopening, isolates task banks and bounds recalled history', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asb-memory-java-'));
  t.after(() => fs.rmSync(root,{recursive:true,force:true}));
  const source = fs.readFileSync(path.resolve(__dirname,'../app/src/main/java/com/otterview/agentsessionbridge/ButlerMemory.java'),'utf8').replace(/^package .*;\n/m,'');
  fs.writeFileSync(path.join(root,'ButlerMemory.java'), source);
  fs.writeFileSync(path.join(root,'MemoryHarness.java'), `
import java.io.*;
public class MemoryHarness {
 static void check(boolean value){if(!value)throw new AssertionError();}
 public static void main(String[] args)throws Exception {
  File root=new File(args[0]);String training="task-"+"a".repeat(64), social="task-"+"b".repeat(64);
  if(args[1].equals("write")) {
   ButlerMemory.append(root,training,"turn-1","time","Show training progress and failure reason","I suggest adding alerts");
   ButlerMemory.append(root,social,"turn-2","time","Keep the social draft casual","Draft ready");
  } else {
   check(ButlerMemory.read(root,training).contains("Show training progress"));
   check(!ButlerMemory.read(root,social).contains("training progress"));
   check(ButlerMemory.read(root,training).contains("not independently verified"));
   check(ButlerMemory.read(root,"town").isEmpty());
   try{ButlerMemory.read(root,"../escape");throw new AssertionError();}catch(IllegalArgumentException expected){}
   ButlerMemory.append(root,training,"turn-3","time","x".repeat(30000)+"LATEST_REQUIREMENT","Recorded");
   String context=ButlerMemory.read(root,training);check(context.length()<=24000&&context.contains("LATEST_REQUIREMENT"));
  }
 }
}`);
  const bin=name=>process.env.JAVA_HOME?path.join(process.env.JAVA_HOME,'bin',name):name;
  execFileSync(bin('javac'),['-d',root,path.join(root,'ButlerMemory.java'),path.join(root,'MemoryHarness.java')]);
  const data=path.join(root,'data');
  execFileSync(bin('java'),['-cp',root,'MemoryHarness',data,'write']);
  execFileSync(bin('java'),['-cp',root,'MemoryHarness',data,'read']);
  assert.ok(fs.existsSync(path.join(data,'task-'+'a'.repeat(64),'HISTORY.md')));
});

test('Pi SSH protocol streams text, routes only query tools and rejects incomplete replies', t => {
  const source=methods('PiButlerProtocol.java','  interface Query','\n}');
  harness(t,'PiProtocolHarness',`
static class PiButlerProtocol {${source.replace('org.json.JSONArray','JSONArray').replaceAll('BooleanSupplier','java.util.function.BooleanSupplier').replaceAll('Consumer<','java.util.function.Consumer<').replaceAll('MessageDigest.','java.security.MessageDigest.')}}
static String frame(String type){return new JSONObject().put("protocol",1).put("type",type).toString()+"\\n";}
static InputStream input(String text){return new ByteArrayInputStream(text.getBytes(StandardCharsets.UTF_8));}
public static void main(String[] args)throws Exception{
 List<String> partial=new ArrayList<>();int[] queries={0};ByteArrayOutputStream output=new ByteArrayOutputStream();
 String events=new JSONObject().put("protocol",1).put("type","delta").put("text","hello ").toString()+"\\n"
  +new JSONObject().put("protocol",1).put("type","tool_request").put("id","bad").put("name","send_reply").put("args",new JSONObject()).toString()+"\\n"
  +new JSONObject().put("protocol",1).put("type","tool_request").put("id","good").put("name","get_task_output").put("args",new JSONObject().put("task_id","S-1")).toString()+"\\n"
  +new JSONObject().put("protocol",1).put("type","done").put("answer","final answer").toString()+"\\n";
 String answer=PiButlerProtocol.exchange(input(events),output,new JSONObject(),()->false,(name,params)->{queries[0]++;return "fresh result";},partial::add,p->{},1000);
 check(answer.equals("final answer")&&partial.get(0).equals("hello ")&&queries[0]==1);
 try{PiButlerProtocol.exchange(input(frame("ready")),new ByteArrayOutputStream(),new JSONObject(),()->false,(n,a)->"{}",p->{},p->{},1000);throw new AssertionError();}catch(IllegalStateException expected){}
 check(PiButlerProtocol.command("/tmp/worker'quote.mjs").contains("'\\\\''"));
 try{PiButlerProtocol.command("relative/worker");throw new AssertionError();}catch(IllegalArgumentException expected){}
 System.out.println("ok");
}`);
});
