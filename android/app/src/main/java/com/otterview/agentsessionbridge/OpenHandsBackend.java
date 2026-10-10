package com.otterview.agentsessionbridge;

import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URI;
import java.util.Locale;

/** OpenHands V1 Agent Server REST adapter. No orchestration or model coupling. */
final class OpenHandsBackend implements ManagedCoordinator.Backend {
  interface Transport { JSONObject request(String method, String path, JSONObject body) throws Exception; }
  private final Transport transport;
  OpenHandsBackend(Transport transport) { this.transport=transport; }
  static String endpoint(String value) throws Exception {
    if (value == null || value.length() > 4096)
      throw new IllegalArgumentException("OpenHands 地址过长，请检查服务地址");
    String normalized = value.trim();
    URI uri=new URI(normalized);
    if (!("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) || uri.getHost()==null
        || uri.getUserInfo()!=null || uri.getQuery()!=null || uri.getFragment()!=null)
      throw new IllegalArgumentException("请填写 OpenHands Agent Server 的 HTTP(S) 地址");
    if ("http".equals(uri.getScheme()) && !uri.getHost().equals("127.0.0.1") && !uri.getHost().equals("localhost"))
      throw new IllegalArgumentException("OpenHands 远程连接请使用 HTTPS；本机端口转发可使用 localhost HTTP");
    int end = normalized.length();
    while (end > 0 && normalized.charAt(end - 1) == '/') end--;
    return normalized.substring(0, end);
  }
  static String conversationPath(JSONObject binding) {
    String id=binding.optString("conversationId").toLowerCase(Locale.ROOT);
    if (!id.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"))
      throw new IllegalArgumentException("请填写 OpenHands 会话 UUID");
    return "/api/conversations/"+id;
  }
  @Override public JSONObject observe(JSONObject binding) throws Exception {
    String path=conversationPath(binding);
    JSONObject info=transport.request("GET", path, null);
    if (!binding.getString("conversationId").equalsIgnoreCase(info.optString("id")))
      throw new IllegalStateException("OpenHands 返回了其他会话");
    String status=info.optString("execution_status");
    String state;
    switch(status) {
      case "running": state="running"; break;
      case "waiting_for_confirmation": state="confirmation"; break;
      case "idle": case "paused": case "finished": state="idle"; break;
      case "error": case "stuck": state="error"; break;
      default: throw new IllegalStateException("不支持的 OpenHands 执行状态");
    }
    JSONObject page=transport.request("GET", path+"/events/search?limit=20&sort_order=TIMESTAMP_DESC", null);
    JSONArray items=page.optJSONArray("items");
    if(items==null) throw new IllegalStateException("OpenHands 事件格式不兼容");
    JSONArray records=new JSONArray();
    // Restrict fields rather than forwarding secrets in the whole conversation config.
    for(int i=Math.min(items.length(),20)-1;i>=0;i--) {
      JSONObject item=items.getJSONObject(i), record=new JSONObject().put("id",item.optString("id"))
          .put("kind",item.optString("kind")).put("source",item.optString("source"));
      for(String key:new String[]{"llm_message","action","observation"}) {
        Object value=item.opt(key);
        if(value!=null && !JSONObject.NULL.equals(value)) {
          String text=value.toString(); record.put(key,text.substring(0,Math.min(text.length(),4000)));
        }
      }
      records.put(record);
    }
    String output="";
    if(status.equals("finished")) output=transport.request("GET",path+"/agent_final_response",null).optString("response");
    return new JSONObject().put("state",state).put("backendStatus",status).put("records",records)
        .put("output",output.substring(0,Math.min(output.length(),6000)));
  }
  @Override public void send(JSONObject binding, String text, String actionId) throws Exception {
    // Official /events can save a message and then return 429 if run capacity is full.
    // The coordinator treats ANY send error as uncertain and never resends it.
    if (binding.has("expectedRevision") && !ManagedCoordinator.hash(observe(binding).toString()).equals(binding.getString("expectedRevision")))
      throw new IllegalStateException("OpenHands 会话已变化，未发送旧回复");
    JSONObject body=new JSONObject().put("role","user").put("run",true)
        .put("content",new JSONArray().put(new JSONObject().put("type","text").put("text",text)));
    transport.request("POST", conversationPath(binding)+"/events", body);
  }
}
