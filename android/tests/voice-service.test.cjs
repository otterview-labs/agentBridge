const {test}=require('node:test');
const fs=require('node:fs'),path=require('node:path');
const {source,harness,productionClass}=require('./java-json-fixture.cjs');
const implementation=fs.readFileSync(path.join(source,'VoiceService.java'),'utf8').replace(/^package .*;\n/m,'').replace(/^import .*;\n/gm,'').replace('final class VoiceService','static final class VoiceService').replaceAll('HttpURLConnection','java.net.HttpURLConnection').replaceAll('new URL(','new java.net.URL(').replaceAll('URL url','java.net.URL url').replaceAll('URL parsed','java.net.URL parsed');
const fake=`
static class Response extends java.net.HttpURLConnection {
 ByteArrayOutputStream sent=new ByteArrayOutputStream();byte[] data;int status=200;boolean disconnected;String mime="application/json";
 Response(byte[] body)throws Exception{super(new java.net.URL("https://fixture.example/v1"));data=body;}
 public void connect(){} public boolean usingProxy(){return false;} public void disconnect(){disconnected=true;}
 public OutputStream getOutputStream(){return sent;}public int getResponseCode(){return status;}
 public InputStream getInputStream(){return new ByteArrayInputStream(data);}public String getContentType(){return mime;}
}
`;
test('voice profiles migrate legacy keys and scope retained secrets to provider and endpoint',t=>harness(t,'VoiceProfiles',`${implementation}
public static void main(String[] args)throws Exception{
 JSONObject legacy=new JSONObject().put("apiKey","legacy-key");
 check(VoiceService.config(legacy).getString("provider").equals("bailian"));
 JSONObject stored=VoiceService.save(legacy,new JSONObject().put("provider","openai").put("apiKey","openai-key"));
 check(VoiceService.config(stored).getString("apiKey").equals("openai-key"));
 stored=VoiceService.save(stored,new JSONObject().put("provider","bailian"));
 check(VoiceService.config(stored).getString("apiKey").equals("legacy-key"));
 stored=VoiceService.save(stored,new JSONObject().put("provider","custom").put("baseUrl","https://one.example/v1").put("apiKey","custom-key"));
 stored=VoiceService.save(stored,new JSONObject().put("provider","custom").put("baseUrl","https://one.example/v1"));
 check(VoiceService.config(stored).getString("apiKey").equals("custom-key"));
 stored=VoiceService.save(stored,new JSONObject().put("provider","custom").put("baseUrl","https://two.example/v1"));
 check(VoiceService.config(stored).getString("apiKey").isEmpty());
 check(!VoiceService.publicConfig(VoiceService.config(stored)).has("apiKey"));
 for(String bad:new String[]{"http://public.example/v1","https://user:password@example.com/v1","https://example.com/v1?key=secret","https://example.com/v1#key"}){
  try{VoiceService.save(stored,new JSONObject().put("provider","custom").put("baseUrl",bad));throw new AssertionError();}catch(IllegalArgumentException expected){}
 }
 stored=VoiceService.save(stored,new JSONObject().put("provider","openai").put("clear",true));
 check(VoiceService.config(stored).getString("apiKey").isEmpty());
 stored=VoiceService.save(stored,new JSONObject().put("provider","doubao").put("baseUrl","https://untrusted.example").put("apiKey","voice-key"));
 JSONObject doubao=VoiceService.config(stored);
 check(doubao.getString("baseUrl").equals("https://openspeech.bytedance.com"));
 check(doubao.getString("apiKey").equals("voice-key"));
 check(doubao.getString("ttsModel").isEmpty());
 check(!VoiceService.publicConfig(doubao).has("apiKey"));
 stored=VoiceService.save(stored,new JSONObject().put("provider","bailian"));
 check(VoiceService.config(stored).getString("apiKey").equals("legacy-key"));
 stored=VoiceService.save(stored,new JSONObject().put("provider","doubao"));
 check(VoiceService.config(stored).getString("apiKey").equals("voice-key"));
 stored=VoiceService.save(stored,new JSONObject().put("provider","system"));check(VoiceService.config(stored).optString("apiKey").isEmpty());
 System.out.println("ok");
}`));
test('OpenAI audio protocol sends AAC multipart and JSON speech and bounds audio responses',t=>harness(t,'VoiceProtocol',`${implementation}${fake}
public static void main(String[] args)throws Exception{
 JSONObject config=VoiceService.config(VoiceService.save(new JSONObject(),new JSONObject().put("provider","openai").put("apiKey","test-key")));
 Response asr=new Response(new JSONObject().put("text","你好，管家").toString().getBytes(StandardCharsets.UTF_8));
 String text=VoiceService.transcribe(config,new byte[]{11,22,33},url->{check(url.toString().equals("https://api.openai.com/v1/audio/transcriptions"));return asr;},null);
 check(text.equals("你好，管家"));check(asr.disconnected);check(!asr.getInstanceFollowRedirects());check(asr.getRequestProperty("Authorization").equals("Bearer test-key"));
 String multipart=asr.sent.toString("UTF-8");check(multipart.contains("gpt-4o-mini-transcribe"));check(multipart.contains("recording.m4a"));check(multipart.contains("audio/mp4"));
 Response tts=new Response(new byte[]{73,68,51,1});tts.mime="audio/mpeg";
 check(VoiceService.synthesize(config,"你好",url->{check(url.toString().endsWith("/audio/speech"));return tts;},null).length==4);
 JSONObject request=new JSONObject(tts.sent.toString("UTF-8"));check(request.getString("input").equals("你好"));check(request.getString("model").equals("gpt-4o-mini-tts"));check(request.getString("response_format").equals("mp3"));check(tts.disconnected);
 try{VoiceService.read(new ByteArrayInputStream(new byte[20]),10);throw new AssertionError();}catch(IOException expected){}
 Response json=new Response(new byte[]{123,125});try{VoiceService.synthesize(config,"hello",url->json,null);throw new AssertionError();}catch(IOException expected){}check(json.disconnected);
 System.out.println("ok");
}`));
test('voice HTTP errors and cancellations never expose provider bodies or send a redirected credential',t=>harness(t,'VoiceFailures',`${implementation}${fake}
public static void main(String[] args)throws Exception{
 JSONObject config=VoiceService.config(VoiceService.save(new JSONObject(),new JSONObject().put("provider","openai").put("apiKey","private-key")));
 for(int code:new int[]{302,401,429,500}){
  Response bad=new Response("private-key".getBytes(StandardCharsets.UTF_8));bad.status=code;
  try{VoiceService.synthesize(config,"hello",url->bad,null);throw new AssertionError();}catch(IllegalStateException expected){check(!expected.getMessage().contains("private-key"));check(expected.getMessage().contains(Integer.toString(code)));}
  check(bad.disconnected);check(!bad.getInstanceFollowRedirects());
 }
 Response cancel=new Response(new byte[]{1});try{VoiceService.synthesize(config,"hello",url->cancel,connection->{throw new IOException("cancelled");});throw new AssertionError();}catch(IOException expected){}
 check(cancel.disconnected);check(cancel.sent.size()==0);
 Thread.currentThread().interrupt();try{VoiceService.read(new ByteArrayInputStream(new byte[]{1}),10);throw new AssertionError();}catch(IOException expected){}finally{Thread.interrupted();}
 System.out.println("ok");
}`));
test('Doubao WebSocket sends a negative final audio sequence and rejects broken result frames',t=>harness(t,'DoubaoFrames',`
${productionClass('DoubaoAsrProtocol.java')}
static byte[] result(int type,int encoding,int sequence,byte[] payload) {
 return ByteBuffer.allocate(12+payload.length).put((byte)0x11).put((byte)type)
  .put((byte)encoding).put((byte)0).putInt(sequence).putInt(payload.length).put(payload).array();
}
public static void main(String[] args)throws Exception{
 byte[] pcm=new byte[]{0,9,17,1};
 ByteBuffer audio=ByteBuffer.wrap(DoubaoAsrProtocol.audio(5,pcm,true));
 check(audio.getInt()==0x11231100);
 check(audio.getInt()==-5);
 int size=audio.getInt();
 check(size==audio.remaining());
 try(GZIPInputStream gzip=new GZIPInputStream(new ByteArrayInputStream(audio.array(),12,size))){
  check(Arrays.equals(gzip.readAllBytes(),pcm));
 }
 byte[] json="{}".getBytes(StandardCharsets.UTF_8);
 ByteArrayOutputStream compressed=new ByteArrayOutputStream();
 try(GZIPOutputStream gzip=new GZIPOutputStream(compressed)){gzip.write(json);}
 byte[] frame=result(0x93,0x11,9,compressed.toByteArray());
 DoubaoAsrProtocol.Result finalResult=DoubaoAsrProtocol.decode(frame);
 check(finalResult.last && finalResult.error==0 && Arrays.equals(finalResult.json,json));
 DoubaoAsrProtocol.Result err=DoubaoAsrProtocol.decode(result(0xf0,0x10,45000000,json));
 check(err.error==45000000 && err.json.length==0);
 try{DoubaoAsrProtocol.decode(Arrays.copyOf(frame,frame.length-1));throw new AssertionError();}catch(IOException expected){}
 System.out.println("ok");
}`,'import java.nio.ByteBuffer;import java.util.zip.*;'));

test('offline tool names keep product spelling without replacing ordinary coder references', t => harness(t, 'OfflineToolNamesFixture', `
public static void main(String[] args) {
  check(OfflineToolNames.format("帮我看看 CODEX 和 Coder 的进度").equals("帮我看看 Codex 和 Qoder 的进度"));
  check(OfflineToolNames.format("继续在 coder 里执行任务").equals("继续在 Qoder 里执行任务"));
  check(OfflineToolNames.format("Coder 继续执行任务").equals("Qoder 继续执行任务"));
  check(OfflineToolNames.format("继续再扣个耳里执行任务").equals("继续在 Qoder 里执行任务"));
  check(OfflineToolNames.format("打开 open code，让 CLAUDE CODE 检查").equals("打开 OpenCode，让 Claude Code 检查"));
  check(OfflineToolNames.format("这个 coder 写了代码").equals("这个 coder 写了代码"));
  check(OfflineToolNames.format("MyCoder and decodeX are identifiers").equals("MyCoder and decodeX are identifiers"));
  check(OfflineToolNames.format("口袋里有四张卡片").equals("口袋里有四张卡片"));
  System.out.println("ok");
}`, ['OfflineToolNames.java']));
