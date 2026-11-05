const {test}=require('node:test');
const {methods,harness:javaHarness}=require('./java-json-fixture.cjs');
const harness=(t,name,body)=>javaHarness(t,name,body,['ChatCompletionProtocol.java','ChatCompletionClient.java']);
const options=methods('PhoneController.java','  private static boolean kimiK3(','  /** Replay complete K3 exchanges,').replace(/\bURL\b/g,'java.net.URL');

test('every model completion path uses K3 parameters without changing other providers',t=>{
  const direct=methods('PhoneController.java','  private String directModelReply(','  private String directModelReplyWithTools(');
  const chat=methods('PhoneController.java','  private String chatCompletion(JSONObject model, JSONArray messages, JSONArray tools, String toolChoice)','  /** Stream text');
  const stream=methods('PhoneController.java','  private String chatCompletionStream(','  private JSONArray buildButlerTools(');
  const qualify=s=>s.replace(/\bHttpURLConnection\b/g,'java.net.HttpURLConnection').replace(/\bURL\b/g,'java.net.URL');
  harness(t,'ModelOptionsHarness',`
  static class Activity{void noteNetworkDeath(){}}Activity activity;
  static class FixtureConnection extends java.net.HttpURLConnection {
    ByteArrayOutputStream output=new ByteArrayOutputStream();String body;
    FixtureConnection(String body)throws Exception{super(new java.net.URL("https://fixture.invalid"));this.body=body;}
    public void disconnect(){} public boolean usingProxy(){return false;}public void connect(){}
    public OutputStream getOutputStream(){return output;} public InputStream getInputStream(){return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));}
    public int getResponseCode(){return 200;}public String getContentType(){return "application/json";}
  }
  FixtureConnection last;
  final ChatCompletionClient modelClient=new ChatCompletionClient(this::openModelConnection,()->{});
  java.net.HttpURLConnection openModelConnection(java.net.URL url)throws Exception {
    String body=new JSONObject().put("choices",new JSONArray().put(new JSONObject().put("message",new JSONObject().put("content","connected")))).toString();
    return last=new FixtureConnection(body);
  }
  String modelMessageText(JSONObject m){return m.optString("content");}
  String chatCompletion(JSONObject m,JSONArray a,JSONArray tools)throws Exception{return chatCompletion(m,a,tools,null);}
  ${options}${qualify(direct)}${qualify(chat)}${qualify(stream)}
  void expectK3(){JSONObject request=new JSONObject(last.output.toString(StandardCharsets.UTF_8));check(!request.has("temperature")&&!request.has("max_tokens"));check(request.optInt("max_completion_tokens")==8192&&request.optString("reasoning_effort").equals("low"));}
  public static void main(String[] args)throws Exception{
    ModelOptionsHarness b=new ModelOptionsHarness();JSONArray messages=new JSONArray().put(new JSONObject().put("role","user").put("content","hello"));
    JSONObject model=new JSONObject().put("baseUrl","https://api.kimi.com/coding/v1").put("modelId","k3-256k").put("apiKey","test-key");
    check(b.directModelReply(model,messages).equals("connected"));b.expectK3();b.chatCompletion(model,messages,null,null);b.expectK3();b.chatCompletionStream(model,messages,null,text->{});b.expectK3();
    model.put("baseUrl","https://api.moonshot.cn/v1").put("modelId","kimi-k3");b.chatCompletion(model,messages,null,null);b.expectK3();
    model.put("baseUrl","https://api.deepseek.com/v1").put("modelId","deepseek-flash");b.chatCompletion(model,messages,null,null);JSONObject request=new JSONObject(b.last.output.toString(StandardCharsets.UTF_8));check(request.optInt("max_tokens")==1800&&request.has("temperature")&&!request.has("max_completion_tokens"));
    check(!kimiK3(new JSONObject().put("modelId","k3").put("baseUrl","https://api.kimi.com.evil.test/coding/v1")));
    System.out.println("ok");
  }`);
});

test('K3 streaming retains exact reasoning and content while only publishing visible text',t=>{
    harness(t,'KimiStreamHarness',`

  static String event(JSONObject delta,String reason){return "data: "+new JSONObject().put("choices",new JSONArray().put(new JSONObject().put("delta",delta).put("finish_reason",reason))).toString()+"\\n\\n";}
  public static void main(String[] args)throws Exception{
    KimiStreamHarness b=new KimiStreamHarness();List<String> visible=new ArrayList<>();
    String wire=event(new JSONObject().put("reasoning_content"," exact "),"")+event(new JSONObject().put("reasoning_content","reasoning\\n"),"")+event(new JSONObject().put("content"," answer "),"stop")+"data: [DONE]\\n";
    JSONObject message=new JSONObject(ChatCompletionProtocol.readAnswerStream(new ByteArrayInputStream(wire.getBytes(StandardCharsets.UTF_8)),visible::add)).getJSONArray("choices").getJSONObject(0).getJSONObject("message");
    check(message.optString("reasoning_content").equals(" exact reasoning\\n"));check(message.optString("content").equals(" answer "));check(visible.size()==1&&visible.get(0).equals(" answer "));System.out.println("ok");
  }`);
});

test('K3 history replays whole exchanges, isolates models and drops oversized turns intact',t=>{
  const history=methods('PhoneController.java','  /** Replay complete K3 exchanges,','  private JSONObject probe(');
  harness(t,'KimiHistoryHarness',`
  ${options}${history}
  boolean standaloneGreeting(String v){return v.equals("hi");}
  JSONArray studioChatMessages(JSONArray history,String value,JSONObject snapshot){return new JSONArray().put(new JSONObject().put("role","system").put("content","system")).put(new JSONObject().put("role","user").put("content",value));}
  public static void main(String[] args)throws Exception{
    KimiHistoryHarness b=new KimiHistoryHarness();JSONObject model=new JSONObject().put("baseUrl","https://api.kimi.com/coding/v1").put("modelId","k3-256k");
    JSONArray exchange=new JSONArray().put(new JSONObject().put("role","user").put("content","old question")).put(new JSONObject().put("role","assistant").put("content","old answer").put("reasoning_content","exact reasoning"));
    JSONObject meta=new JSONObject().put("baseUrl",model.optString("baseUrl")).put("modelId",model.optString("modelId")).put("messages",exchange);
    JSONArray history=new JSONArray().put(new JSONObject().put("role","assistant").put("modelExchange",meta));
    JSONArray result=b.studioModelChatMessages(model,history,"new question",new JSONObject());check(result.length()==4&&result.getJSONObject(2).optString("reasoning_content").equals("exact reasoning"));
    check(b.studioModelChatMessages(model,history,"hi",new JSONObject()).length()==2);
    model.put("modelId","k3");check(b.studioModelChatMessages(model,history,"new",new JSONObject()).length()==2);model.put("modelId","k3-256k");
    exchange.getJSONObject(1).put("reasoning_content","x".repeat(65000));check(b.studioModelChatMessages(model,history,"new",new JSONObject()).length()==2);
    System.out.println("ok");
  }`);
});

test('reasoning exchanges commit with the complete user and assistant turn',t=>{
  const append=methods('BridgeStore.java','  synchronized JSONObject appendStudioTurn(','  synchronized JSONArray studioReports(');
  harness(t,'ModelExchangeStoreHarness',`
  JSONArray saved=new JSONArray();boolean fail;
  JSONArray studioMessages(){return new JSONArray(saved.toString());}
  void saveStudioMessages(JSONArray messages){if(fail)throw new IllegalStateException("save failed");saved=new JSONArray(messages.toString());}
  ${append}
  public static void main(String[] args)throws Exception {
    ModelExchangeStoreHarness b=new ModelExchangeStoreHarness();JSONObject exchange=new JSONObject().put("modelId","k3").put("messages",new JSONArray().put(new JSONObject().put("role","assistant").put("reasoning_content","exact reasoning")));
    b.fail=true;try{b.appendScopedStudioTurn("question","answer","now","failed",0,exchange);throw new AssertionError();}catch(IllegalStateException expected){}check(b.saved.length()==0);
    b.fail=false;b.appendScopedStudioTurn("question","answer","now","ok",0,exchange);check(b.saved.length()==2);check(b.saved.getJSONObject(0).optString("role").equals("user"));check(b.saved.getJSONObject(1).getJSONObject("modelExchange").optString("modelId").equals("k3"));System.out.println("ok");
  }`);
});
