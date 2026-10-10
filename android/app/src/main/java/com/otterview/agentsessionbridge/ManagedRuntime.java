package com.otterview.agentsessionbridge;

import android.content.Context;
import org.json.JSONObject;
import org.json.JSONArray;
import java.io.File;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.URL;
import java.net.HttpURLConnection;
import java.nio.charset.StandardCharsets;

/** Process singleton with no Activity references, safe to recreate from persisted queue. */
final class ManagedRuntime {
  private static ManagedRuntime instance;
  final ManagedCoordinator coordinator;
  private final BridgeStore store;
  private final Context context;
  static synchronized ManagedRuntime get(Context context) throws Exception {
    if(instance==null) instance=new ManagedRuntime(context.getApplicationContext());
    return instance;
  }
  private ManagedRuntime(Context context) throws Exception {
    this.context=context; store=BridgeStore.get(context); PhoneBridge bridge=new PhoneBridge(context);
    File memoryRoot=new File(context.getFilesDir(),"butler-memory");
    coordinator=new ManagedCoordinator(new File(context.getFilesDir(),"managed/queue.json"),bridge::managedDecision,
      new ManagedCoordinator.Memory() {
        public String read(JSONObject job) throws Exception { return ButlerMemory.read(memoryRoot,memoryScope(job)); }
        public void record(JSONObject job,String text) throws Exception {
          ButlerMemory.append(memoryRoot,memoryScope(job),java.util.UUID.randomUUID().toString(),
              java.time.Instant.now().toString(),job.getString("goal"),text);
        }
      });
    coordinator.register("employee",new ManagedCoordinator.Backend() {
      public JSONObject observe(JSONObject binding) throws Exception { return bridge.managedObservation(binding); }
      public void send(JSONObject binding,String text,String actionId) throws Exception { bridge.managedSend(binding,text,actionId); }
    });
    coordinator.register("openhands",new ManagedCoordinator.Backend() {
      private OpenHandsBackend adapter(JSONObject binding) throws Exception {
        JSONObject config=store.openHandsConfig();
        if(!ManagedCoordinator.hash(config.optString("endpoint")).equals(binding.optString("destination")))
          throw new IllegalStateException("OpenHands 服务地址已变化，请重新绑定");
        return new OpenHandsBackend((method,path,body)->request(config,method,path,body));
      }
      public JSONObject observe(JSONObject binding) throws Exception { return adapter(binding).observe(binding); }
      public void send(JSONObject binding,String text,String actionId) throws Exception { adapter(binding).send(binding,text,actionId); }
    });
  }
  private static String memoryScope(JSONObject job) throws Exception {
    JSONObject binding=job.getJSONObject("binding");
    return job.optString("backend").equals("employee") ? binding.getString("scope")
        : "task-"+ManagedCoordinator.hash("openhands:"+binding.getString("destination")+":"+binding.getString("conversationId"));
  }
  JSONObject snapshot() throws Exception {
    JSONObject result=coordinator.snapshot(),config=store.openHandsConfig();
    return result.put("running",ManagedButlerService.running()).put("openHands",new JSONObject()
        .put("endpoint",config.optString("endpoint")).put("hasApiKey",!config.optString("apiKey").isEmpty()));
  }
  JSONObject add(JSONObject input) throws Exception {
    String backend=input.optString("backend"); JSONObject binding=new JSONObject();
    if(backend.equals("employee")) {
      int id=input.optInt("taskId"); JSONObject task=store.task(id),machine=store.machine(task.getInt("machineId"));
      if(!"process".equals(task.optString("controlMode"))) throw new IllegalArgumentException("持续跟进先支持有固定会话 ID 的 Codex / Claude 员工");
      if(!task.optString("agentType").matches("codex|claude-code")) throw new IllegalArgumentException("该员工暂不支持自动回复");
      binding.put("taskId",id).put("scope",PiButlerProtocol.taskScope(machine,task));
    } else if(backend.equals("openhands")) {
      JSONObject config=store.openHandsConfig(); String endpoint=OpenHandsBackend.endpoint(config.optString("endpoint"));
      binding.put("conversationId",input.optString("conversationId").toLowerCase(java.util.Locale.ROOT))
          .put("destination",ManagedCoordinator.hash(endpoint));
      OpenHandsBackend.conversationPath(binding);
    } else throw new IllegalArgumentException("请选择支持的执行后端");
    // Model config is required, but adding a job performs no network or mutation.
    JSONObject model=store.studioModel();
    if(!model.optBoolean("enabled") || model.optString("apiKey").isEmpty()) throw new IllegalArgumentException("请先配置管家模型");
    coordinator.add(backend,binding,input.optString("goal"),input.optString("rules"),input.optBoolean("allowReplies"),
        input.optInt("maxReplies",3),input.optInt("minutes",120));
    return snapshot();
  }
  private JSONObject request(JSONObject config,String method,String path,JSONObject body) throws Exception {
    HttpURLConnection connection=PhoneNetwork.open(context,new URL(config.getString("endpoint")+path));
    try {
      connection.setInstanceFollowRedirects(false); connection.setRequestMethod(method);
      connection.setConnectTimeout(15000); connection.setReadTimeout(45000);
      if(!config.optString("apiKey").isEmpty()) connection.setRequestProperty("X-Session-API-Key",config.getString("apiKey"));
      if(body!=null) {
        byte[] data=body.toString().getBytes(StandardCharsets.UTF_8); connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type","application/json"); connection.setFixedLengthStreamingMode(data.length);
        try(java.io.OutputStream output=connection.getOutputStream()) { output.write(data); }
      }
      int status=connection.getResponseCode();
      if(status<200 || status>=300) throw new IllegalStateException("OpenHands HTTP "+status);
      ByteArrayOutputStream bytes=new ByteArrayOutputStream();
      try(InputStream in=connection.getInputStream()) {
        byte[] buffer=new byte[8192]; int count;
        while((count=in.read(buffer))!=-1) { if(bytes.size()+count>2000000) throw new IllegalStateException("OpenHands 响应过大"); bytes.write(buffer,0,count); }
      }
      return new JSONObject(bytes.toString(StandardCharsets.UTF_8.name()));
    } finally { connection.disconnect(); }
  }
}
