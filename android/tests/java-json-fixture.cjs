const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {execFileSync}=require('node:child_process');
const source=path.resolve(__dirname,'../app/src/main/java/com/otterview/agentsessionbridge');
const javaHome=process.env.JAVA_HOME;
function methods(file,start,end){const text=fs.readFileSync(path.join(source,file),'utf8');const from=text.indexOf(start),to=text.indexOf(end,from);assert.ok(from>=0&&to>from);return text.slice(from,to);}
// JSON fixture handles model Android's platform objects. These tests exercise
// production control flow and state; the platform JSON parser is not under test.
const json=`
static final Map<String,Object> fixtures=new HashMap<>();
static String quote(String value){return "\\\""+value.replace("\\\\","\\\\\\\\").replace("\\\"","\\\\\\\"").replace("\\n","\\\\n").replace("\\r","\\\\r").replace("\\t","\\\\t")+"\\\"";}
static String canonical(Object value){
 if(value==null || value==JSONObject.NULL)return "null";
 if(value instanceof String)return quote((String)value);
 if(value instanceof JSONObject){List<String> fields=new ArrayList<>();for(Map.Entry<String,Object> e:((JSONObject)value).values.entrySet())fields.add(quote(e.getKey())+":"+canonical(e.getValue()));return "{"+String.join(",",fields)+"}";}
 if(value instanceof JSONArray){List<String> items=new ArrayList<>();for(Object item:((JSONArray)value).values)items.add(canonical(item));return "["+String.join(",",items)+"]";}return String.valueOf(value);
}
static synchronized String encode(Object value){String key=canonical(value);fixtures.put(key,JSONObject.copy(value));return key;}
static class JSONObject{
 final Map<String,Object> values=new LinkedHashMap<>();
 static final Object NULL=new Object();
 JSONObject(){} JSONObject(String raw){if(raw.equals("{}"))return;Object v=fixtures.get(raw);if(!(v instanceof JSONObject))throw new IllegalArgumentException("invalid JSON");for(Map.Entry<String,Object> item:((JSONObject)v).values.entrySet())values.put(item.getKey(),copy(item.getValue()));}
 static Object copy(Object value){
  if(value instanceof JSONObject){JSONObject result=new JSONObject();for(Map.Entry<String,Object> e:((JSONObject)value).values.entrySet())result.put(e.getKey(),copy(e.getValue()));return result;}
  if(value instanceof JSONArray){JSONArray result=new JSONArray();for(Object item:((JSONArray)value).values)result.put(copy(item));return result;}return value;
 }
 int optInt(String k,int fallback){return has(k)?optInt(k):fallback;}
 long optLong(String k){try{return Long.parseLong(optString(k));}catch(Exception e){return 0;}}
 boolean has(String k){return values.containsKey(k);} Iterator<String> keys(){return values.keySet().iterator();} Object get(String k){return opt(k);} Object remove(String k){return values.remove(k);} String getString(String k){return optString(k);} JSONObject put(String k,Object v){values.put(k,v);return this;} Object opt(String k){return values.get(k);}
 String optString(String k){return optString(k,"");} String optString(String k,String fallback){Object v=opt(k);return v==null?fallback:String.valueOf(v);}
 boolean optBoolean(String k){return Boolean.parseBoolean(optString(k));} int optInt(String k){try{return Integer.parseInt(optString(k));}catch(Exception e){return 0;}}
 JSONObject optJSONObject(String k){Object v=opt(k);return v instanceof JSONObject?(JSONObject)v:null;} JSONArray optJSONArray(String k){Object v=opt(k);return v instanceof JSONArray?(JSONArray)v:null;}
 JSONObject getJSONObject(String k){return (JSONObject)opt(k);} JSONArray getJSONArray(String k){return (JSONArray)opt(k);} int getInt(String k){return Integer.parseInt(optString(k));}
 public String toString(){return encode(this);}
}
static class JSONArray{
 final List<Object> values=new ArrayList<>();JSONArray(){} JSONArray(JSONArray other){values.addAll(other.values);} JSONArray(String raw){values.addAll(((JSONArray)fixtures.get(raw)).values);}
 JSONArray put(Object v){values.add(v);return this;} int length(){return values.size();} Object get(int i){return values.get(i);} JSONObject getJSONObject(int i){return (JSONObject)get(i);}
 JSONObject optJSONObject(int i){Object v=i<length()?get(i):null;return v instanceof JSONObject?(JSONObject)v:null;} Object remove(int i){return values.remove(i);}public String toString(){return encode(this);}
}
static void check(boolean v){if(!v)throw new AssertionError();}
`;
function harness(t,name,body){const root=fs.mkdtempSync(path.join(os.tmpdir(),'asb-butler-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,name+'.java');fs.writeFileSync(file,`import java.util.*;import java.util.regex.*;import java.util.concurrent.*;import java.io.*;import java.nio.charset.StandardCharsets;public class ${name}{${json}${body}}\n${fs.readFileSync(path.join(source,'UiText.java'),'utf8').replace(/^package .*;\n/m,'')}`);const bin=n=>javaHome?path.join(javaHome,'bin',n):n;execFileSync(bin('javac'),['-d',root,file]);assert.equal(execFileSync(bin('java'),['-cp',root,name],{encoding:'utf8',timeout:10000}).trim(),'ok');}


module.exports={source,methods,harness};
