const { test } = require('node:test');
const { harness } = require('./java-json-fixture.cjs');

const fixture = `
  static final String ID="ses_fixture_123", DIR="/workspace/中文 project";
  static class Wire implements OpenCodeClient.Transport {
    final Map<String,OpenCodeClient.Response> routes=new HashMap<>();
    int posts; JSONObject sent; String postedPath; boolean dropPost;
    final List<String> requested=new ArrayList<>();
    Wire() throws Exception {
      route("/global/health",new JSONObject().put("healthy",true).put("version","1.18.30").toString());
      JSONObject session=new JSONObject().put("id",ID).put("directory",DIR).put("title","OpenCode fixture");
      route("/session",new JSONArray().put(session).toString());
      route("/experimental/session",new JSONArray().put(session).toString());
      route("/session/"+ID,session.toString());
      route("/session/status",new JSONObject().toString());
      route("/permission",new JSONArray().toString()); route("/question",new JSONArray().toString());
      route("/session/"+ID+"/message",new JSONArray()
        .put(new JSONObject().put("info",new JSONObject().put("role","user"))
          .put("parts",new JSONArray().put(new JSONObject().put("type","text").put("text","你好"))))
        .put(new JSONObject().put("info",new JSONObject().put("role","assistant"))
          .put("parts",new JSONArray().put(new JSONObject().put("type","text").put("text","原会话回复"))
            .put(new JSONObject().put("type","reasoning").put("text","private reasoning"))))
        .toString());
    }
    void route(String path,String body){routes.put(path,new OpenCodeClient.Response(200,body));}
    public OpenCodeClient.Response request(String method,String path,JSONObject body)throws Exception{
      requested.add(path);
      if(method.equals("POST")){posts++;sent=body;postedPath=path;if(dropPost)throw new IOException("secret transport error");return new OpenCodeClient.Response(204,"");}
      OpenCodeClient.Response result=routes.get(path.split("\\\\?")[0]);
      if(result==null)throw new AssertionError("Unexpected route "+path);
      return result;
    }
  }
`;

test('OpenCode normalizes actual sessions, text and server status without exposing reasoning', t => {
  harness(t, 'OpenCodeRead', fixture + `
    public static void main(String[] args)throws Exception{
      Wire wire=new Wire();OpenCodeClient client=new OpenCodeClient(wire);
      JSONObject task=client.discover().getJSONObject(0);
      check(task.getString("externalSessionId").equals(ID));
      check(task.getString("workspacePath").equals(DIR));
      check(task.getString("workSummary").equals("原会话回复"));
      check(task.getString("latestUserText").equals("你好")&&task.getString("latestAssistantText").equals("原会话回复"));
      check(task.optBoolean("canReply")&&task.getString("status").equals("idle"));
      check(task.getString("lastOutput").contains("User: 你好")&&!task.toString().contains("private reasoning"));
      wire.route("/session/status",new JSONObject().put(ID,new JSONObject().put("type","retry")).toString());
      check(client.read(ID,DIR).getString("status").equals("running"));
      check(!client.read(ID,DIR).optBoolean("canReply"));
      System.out.println("ok");
    }`, ['OpenCodeClient.java']);
});

test('OpenCode discovers across projects and scopes state checks to each session directory', t => {
  harness(t, 'OpenCodeProjects', fixture + `
    public static void main(String[] args)throws Exception{
      Wire wire=new Wire();OpenCodeClient client=new OpenCodeClient(wire);
      client.discover();
      check(wire.requested.contains("/experimental/session?roots=true&limit=30"));
      check(wire.requested.contains("/session/status?directory="+URLEncoder.encode(DIR,"UTF-8")));
      check(wire.requested.contains("/permission?directory="+URLEncoder.encode(DIR,"UTF-8")));
      wire.routes.put("/experimental/session",new OpenCodeClient.Response(404,""));
      check(client.discover().length()==1);
      wire.route("/session/"+ID+"/message",new JSONArray().put(new JSONObject()
        .put("info",new JSONObject().put("role","assistant").put("time",new JSONObject().put("created",1)))
        .put("parts",new JSONArray())).toString());
      // An unfinished writer remains blocked even if this server's status map is empty.
      check(!client.read(ID,DIR).optBoolean("canReply"));
      try{client.send(ID,DIR,"x");throw new AssertionError();}catch(IllegalStateException expected){}
      check(wire.posts==0);System.out.println("ok");
    }`, ['OpenCodeClient.java']);
});

test('OpenCode sends one literal prompt to the verified session and never retries ambiguous delivery', t => {
  harness(t, 'OpenCodeSend', fixture + `
    public static void main(String[] args)throws Exception{
      Wire wire=new Wire();OpenCodeClient client=new OpenCodeClient(wire);
      String prompt="-v $(touch /tmp/must-not-run) it's 中文\\nnext";
      client.send(ID,DIR,prompt);
      check(wire.posts==1&&wire.postedPath.contains("/"+ID+"/prompt_async?directory="));
      check(wire.postedPath.contains("%E4%B8%AD%E6%96%87+project"));
      check(wire.sent.getJSONArray("parts").getJSONObject(0).getString("text").equals(prompt));
      check(wire.sent.getString("messageID").startsWith("msg_"));
      wire.dropPost=true;
      try{client.send(ID,DIR,"one more");throw new AssertionError();}catch(IOException expected){
        check(!expected.getMessage().contains("secret")&&expected.getMessage().contains("不要重复发送"));
      }
      check(wire.posts==2);
      try{client.send("ses_bad/../x",DIR,"x");throw new AssertionError();}catch(IllegalArgumentException expected){}
      try{client.send(ID,"/wrong/project","x");throw new AssertionError();}catch(IllegalArgumentException expected){}
      check(wire.posts==2);System.out.println("ok");
    }`, ['OpenCodeClient.java']);
});

test('OpenCode refuses busy sessions and pending permission or question requests before sending', t => {
  harness(t, 'OpenCodeBlocked', fixture + `
    public static void main(String[] args)throws Exception{
      Wire wire=new Wire();OpenCodeClient client=new OpenCodeClient(wire);
      wire.route("/session/status",new JSONObject().put(ID,new JSONObject().put("type","busy")).toString());
      try{client.send(ID,DIR,"x");throw new AssertionError();}catch(IllegalStateException expected){}
      wire.route("/session/status",new JSONObject().toString());
      wire.route("/permission",new JSONArray().put(new JSONObject().put("sessionID",ID).put("id","per_1")).toString());
      check(!client.read(ID,DIR).optBoolean("canReply"));
      try{client.send(ID,DIR,"yes");throw new AssertionError();}catch(IllegalStateException expected){}
      wire.route("/permission",new JSONArray().toString());
      wire.route("/question",new JSONArray().put(new JSONObject().put("sessionID",ID)
        .put("questions",new JSONArray().put(new JSONObject().put("question","Choose a target")))).toString());
      check(client.read(ID,DIR).getString("requiredInput").contains("Choose a target"));
      try{client.send(ID,DIR,"yes");throw new AssertionError();}catch(IllegalStateException expected){}
      check(wire.posts==0);System.out.println("ok");
    }`, ['OpenCodeClient.java']);
});

test('OpenCode rejects auth failures, malformed data and unsupported versions without exposing server bodies', t => {
  harness(t, 'OpenCodeFailures', fixture + `
    public static void main(String[] args)throws Exception{
      Wire wire=new Wire();OpenCodeClient client=new OpenCodeClient(wire);
      for(int status:new int[]{401,403,500,302}){
        wire.routes.put("/global/health",new OpenCodeClient.Response(status,"secret-password"));
        try{client.discover();throw new AssertionError();}catch(IOException expected){check(!expected.getMessage().contains("secret-password"));}
      }
      wire.route("/global/health",new JSONObject().put("healthy",true).put("version","2.0.24").toString());
      try{client.discover();throw new AssertionError();}catch(IllegalArgumentException expected){}
      wire.route("/global/health","<html>secret-password</html>");
      try{client.discover();throw new AssertionError();}catch(IOException expected){check(!expected.getMessage().contains("secret-password"));}
      check(wire.posts==0);System.out.println("ok");
    }`, ['OpenCodeClient.java']);
});

test('OpenCode displays model failures separately from accepted delivery without exposing raw errors', t => {
  harness(t, 'OpenCodeModelError', fixture + `
    public static void main(String[] args)throws Exception{
      Wire wire=new Wire();
      wire.route("/session/"+ID+"/message",new JSONArray().put(new JSONObject()
        .put("info",new JSONObject().put("role","assistant").put("error",new JSONObject()
          .put("name","APIError").put("data",new JSONObject().put("statusCode",403).put("message","secret-token"))))
        .put("parts",new JSONArray())).toString());
      JSONObject task=new OpenCodeClient(wire).read(ID,DIR);
      check(task.getString("status").equals("error"));
      check(task.getString("latestAssistantText").contains("HTTP 403"));
      check(!task.toString().contains("secret-token"));System.out.println("ok");
    }`, ['OpenCodeClient.java']);
});
