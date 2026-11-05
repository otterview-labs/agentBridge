const {test}=require('node:test');
const {harness:javaHarness}=require('./java-json-fixture.cjs');
const harness=(t,name,body)=>javaHarness(t,name,body,['ChatCompletionProtocol.java','ChatCompletionClient.java']);

const fixtures=`
  static JSONObject model(){return new JSONObject().put("baseUrl","https://fixture.invalid/v1").put("modelId","test").put("apiKey","fixture-secret");}
  static JSONArray messages(){return new JSONArray().put(new JSONObject().put("role","user").put("content","hello"));}
  static String answer(){return new JSONObject().put("choices",new JSONArray().put(new JSONObject().put("message",new JSONObject().put("content","complete")))).toString();}
  static class Connection extends HttpURLConnection {
    ByteArrayOutputStream sent=new ByteArrayOutputStream();String body,type="application/json";int status=200;boolean disconnected,failWrite;
    Connection(String body)throws Exception{super(new URL("https://fixture.invalid/v1/chat/completions"));this.body=body;}
    public void connect(){}public boolean usingProxy(){return false;}public void disconnect(){disconnected=true;}
    public OutputStream getOutputStream()throws IOException{if(failWrite)throw new IOException("write failed");return sent;}
    public InputStream getInputStream(){return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));}
    public InputStream getErrorStream(){return getInputStream();}public int getResponseCode(){return status;}public String getContentType(){return type;}
  }
`;

test('completion setup and HTTP failures release connections and hide model credentials',t=>{
  harness(t,'ClientFailures',`${fixtures}
  public static void main(String[] args)throws Exception{
    Connection writeFailure=new Connection("");writeFailure.failWrite=true;
    java.util.concurrent.atomic.AtomicInteger requests=new java.util.concurrent.atomic.AtomicInteger();
    ChatCompletionClient client=new ChatCompletionClient(url->{requests.incrementAndGet();return writeFailure;},()->{});
    try{client.complete(model(),messages(),null,null);throw new AssertionError();}catch(IllegalStateException expected){}
    check(writeFailure.disconnected&&requests.get()==1);
    Connection rejected=new Connection("denied fixture-secret");rejected.status=403;
    client=new ChatCompletionClient(url->rejected,()->{});
    try{client.complete(model(),messages(),null,null);throw new AssertionError();}catch(IllegalStateException e){check(e.getMessage().contains("HTTP 403")&&!e.getMessage().contains("fixture-secret"));}
    check(rejected.disconnected);
    java.util.concurrent.atomic.AtomicInteger dnsFailures=new java.util.concurrent.atomic.AtomicInteger();
    client=new ChatCompletionClient(url->{throw new java.net.UnknownHostException("fixture.invalid");},dnsFailures::incrementAndGet);
    try{client.reply(model(),messages());throw new AssertionError();}catch(IllegalStateException expected){}check(dnsFailures.get()==1);
    try{ChatCompletionClient.readBody(new ByteArrayInputStream(new byte[100]),20);throw new AssertionError();}catch(IllegalStateException expected){}
    System.out.println("ok");
  }`);
});

test('stream fallback is limited to an explicit rejection before content and reuses the request options',t=>{
  harness(t,'StreamFallback',`${fixtures}
  public static void main(String[] args)throws Exception{
    Connection rejection=new Connection("stream unsupported");rejection.status=422;
    Connection success=new Connection(answer());List<Connection> opened=Arrays.asList(rejection,success);
    java.util.concurrent.atomic.AtomicInteger count=new java.util.concurrent.atomic.AtomicInteger();
    ChatCompletionClient client=new ChatCompletionClient(url->opened.get(count.getAndIncrement()),()->{});
    JSONObject model=model().put("baseUrl","https://api.kimi.com/coding/v1").put("modelId","k3-256k");
    check(client.stream(model,messages(),null,value->{throw new AssertionError("rejected stream must not publish");}).equals(answer()));
    check(count.get()==2&&rejection.disconnected&&success.disconnected);
    JSONObject first=new JSONObject(rejection.sent.toString(StandardCharsets.UTF_8));JSONObject second=new JSONObject(success.sent.toString(StandardCharsets.UTF_8));
    check(first.optBoolean("stream")&&!second.has("stream"));check(first.getInt("max_completion_tokens")==second.getInt("max_completion_tokens"));
    Connection json=new Connection(answer());List<String> visible=new ArrayList<>();
    check(new ChatCompletionClient(url->json,()->{}).stream(model(),messages(),null,visible::add).equals(answer()));
    check(visible.equals(Arrays.asList("complete"))&&json.disconnected);
    System.out.println("ok");
  }`);
});

test('stream failure after visible text never resubmits or returns a successful partial answer',t=>{
  harness(t,'PartialFailure',`${fixtures}
  public static void main(String[] args)throws Exception{
    String event="data:"+new JSONObject().put("choices",new JSONArray().put(new JSONObject().put("delta",new JSONObject().put("content","partial")))).toString()+"\\n\\n";
    Connection broken=new Connection(event){public InputStream getInputStream(){final byte[] bytes=body.getBytes(StandardCharsets.UTF_8);return new InputStream(){int position;public int read()throws IOException{if(position==bytes.length)throw new IOException("stream interrupted");return bytes[position++];}};}};
    broken.type="text/event-stream";java.util.concurrent.atomic.AtomicInteger count=new java.util.concurrent.atomic.AtomicInteger();List<String> visible=new ArrayList<>();
    ChatCompletionClient client=new ChatCompletionClient(url->{count.incrementAndGet();return broken;},()->{});
    try{client.stream(model(),messages(),null,visible::add);throw new AssertionError();}catch(IllegalStateException expected){}
    check(visible.equals(Arrays.asList("partial")));check(count.get()==1&&broken.disconnected);System.out.println("ok");
  }`);
});
