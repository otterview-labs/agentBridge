package com.otterview.agentsessionbridge;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.IOException;
import java.net.URLEncoder;
import java.util.UUID;
import java.util.HashMap;
import java.util.Map;

/** OpenCode V1 session adapter. A transport is bound to one authenticated server. */
final class OpenCodeClient {
  interface Transport { Response request(String method, String path, JSONObject body) throws Exception; }
  static final class Response {
    final int status;
    final String body;
    Response(int status, String body) { this.status = status; this.body = body; }
  }

  private final Transport transport;
  OpenCodeClient(Transport transport) { this.transport = transport; }

  String probe() throws Exception {
    Response response = transport.request("GET", "/global/health", null);
    if (response.status == 404) {
      throw new IllegalArgumentException(UiText.text("此 OpenCode 服务接口暂不支持，请使用 V1 服务"));
    }
    JSONObject health = object(response);
    String version = health.optString("version");
    if (!health.optBoolean("healthy") || !version.startsWith("1.")) {
      throw new IllegalArgumentException(UiText.text("此 OpenCode 服务接口暂不支持，请使用 V1 服务"));
    }
    return version;
  }

  JSONArray discover() throws Exception {
    probe();
    Response global = transport.request("GET", "/experimental/session?roots=true&limit=30", null);
    JSONArray sessions = global.status == 404
        ? array(transport.request("GET", "/session?roots=true&limit=30", null)) : array(global);
    JSONArray result = new JSONArray();
    Map<String, Context> contexts = new HashMap<>();
    for (int index = 0; index < Math.min(sessions.length(), 30); index++) {
      JSONObject session = sessions.getJSONObject(index);
      if (!session.optString("parentID").isEmpty()) continue;
      String id = session.optString("id");
      if (!id.matches("ses_[A-Za-z0-9_-]{1,160}")) continue;
      String directory = session.optString("directory");
      Context context = contexts.get(directory);
      if (context == null) { context = inspect(directory); contexts.put(directory, context); }
      result.put(snapshot(session, context.states, context.permissions, context.questions));
    }
    return result;
  }

  JSONObject read(String id, String directory) throws Exception {
    probe();
    JSONObject session = session(id, directory);
    Context context = inspect(directory);
    return snapshot(session, context.states, context.permissions, context.questions);
  }

  /** A successful return means accepted, never completed. A failed POST is never retried. */
  void send(String id, String directory, String text) throws Exception {
    if (text == null || text.trim().isEmpty() || text.length() > 12_000) {
      throw new IllegalArgumentException(UiText.text("回复不能为空，且最多 12000 字。"));
    }
    JSONObject fresh = read(id, directory);
    if ("running".equals(fresh.optString("status"))) {
      throw new IllegalStateException(UiText.text("OpenCode 会话仍在工作，请等待结束后刷新；本次未发送"));
    }
    if (!fresh.optString("requiredInput").isEmpty()) {
      throw new IllegalStateException(UiText.text("请先回到 OpenCode 处理权限或问题确认，再刷新；本次未发送"));
    }
    JSONObject body = new JSONObject()
        .put("messageID", "msg_" + UUID.randomUUID().toString().replace("-", ""))
        .put("parts", new JSONArray().put(new JSONObject().put("type", "text").put("text", text)));
    Response response;
    try {
      response = transport.request("POST", path(id, "/prompt_async", directory), body);
    } catch (Exception error) {
      throw new IOException(UiText.text("OpenCode 发送结果尚未确认，请刷新原会话，不要重复发送"));
    }
    requireSuccess(response);
    if (response.status != 204) {
      throw new IOException(UiText.text("OpenCode 发送结果尚未确认，请刷新原会话，不要重复发送"));
    }
  }

  private JSONObject session(String id, String directory) throws Exception {
    JSONObject result = object(transport.request("GET", path(id, "", directory), null));
    if (!id.equals(result.optString("id")) || !directory.equals(result.optString("directory"))) {
      throw new IllegalArgumentException(UiText.text("OpenCode 会话或工作目录已变化，请重新发现任务"));
    }
    return result;
  }

  private JSONObject snapshot(JSONObject session, JSONObject states, JSONArray permissions, JSONArray questions) throws Exception {
    String id = session.getString("id"), directory = session.optString("directory");
    JSONArray messages = array(transport.request("GET", path(id, "/message", directory) + "&limit=30", null));
    StringBuilder output = new StringBuilder();
    String summary = "", latestUser = "", latestAssistant = "";
    boolean failed = false;
    boolean incomplete = false;
    for (int index = 0; index < messages.length(); index++) {
      JSONObject message = messages.getJSONObject(index), info = message.optJSONObject("info");
      if (info == null) continue;
      String role = info.optString("role");
      String text = text(message.optJSONArray("parts"));
      if (!text.isEmpty()) {
        output.append("user".equals(role) ? "User: " : "OpenCode: ").append(text).append("\n\n");
        if ("assistant".equals(role)) summary = text;
        if ("user".equals(role)) latestUser = text;
      }
      // Only the latest assistant result determines the error state.
      if ("assistant".equals(role)) {
        JSONObject error = info.optJSONObject("error");
        failed = error != null;
        latestAssistant = text;
        if (failed) {
          JSONObject data = error.optJSONObject("data");
          int http = data == null ? 0 : data.optInt("statusCode");
          latestAssistant = UiText.text("OpenCode 模型请求失败") + (http >= 400 && http <= 599 ? " (HTTP " + http + ")" : "")
              + "\n" + UiText.text("请在 OpenCode 检查模型账号、额度和配置；消息已保存，不要重复发送");
          summary = latestAssistant;
        }
        JSONObject time = info.optJSONObject("time");
        incomplete = !failed && time != null && !time.has("completed");
      }
    }
    JSONArray needsPermission = forSession(permissions, id), needsAnswer = forSession(questions, id);
    String required = "";
    if (needsPermission.length() > 0) required = UiText.text("请回到 OpenCode 确认权限；当前试用版只支持查看此类请求");
    if (needsAnswer.length() > 0) {
      required = UiText.text("请回到 OpenCode 回答问题；当前试用版只支持查看此类请求");
      JSONObject first = needsAnswer.getJSONObject(0);
      JSONArray items = first.optJSONArray("questions");
      if (items != null && items.length() > 0) required += "\n" + items.getJSONObject(0).optString("question");
    }
    JSONObject state = states.optJSONObject(id);
    boolean busy = incomplete || (state != null && !"idle".equals(state.optString("type")));
    String status = !required.isEmpty() ? "waiting" : busy ? "running" : failed ? "error" : "idle";
    if (summary.isEmpty()) summary = UiText.text("尚无文字回复，请打开原会话查看工具执行记录");
    return new JSONObject().put("externalSessionId", id).put("workspacePath", directory)
        .put("title", session.optString("title", "OpenCode"))
        .put("status", status).put("requiredInput", required).put("suggestedReply", "")
        .put("latestUserText", bounded(latestUser, 12_000)).put("latestAssistantText", bounded(latestAssistant, 100_000))
        .put("workSummary", bounded(summary, 2400)).put("lastOutput", bounded(output.toString(), 100_000))
        .put("canReply", !busy && required.isEmpty()).put("opencodeConnected", true);
  }

  private static final class Context {
    final JSONObject states;
    final JSONArray permissions, questions;
    Context(JSONObject states, JSONArray permissions, JSONArray questions) {
      this.states = states; this.permissions = permissions; this.questions = questions;
    }
  }

  private Context inspect(String directory) throws Exception {
    String suffix = "?directory=" + URLEncoder.encode(directory, "UTF-8");
    return new Context(object(transport.request("GET", "/session/status" + suffix, null)),
        pending("/permission" + suffix), pending("/question" + suffix));
  }

  private JSONArray pending(String path) throws Exception {
    Response response = transport.request("GET", path, null);
    // Older V1 servers may not implement questions; permission checking is required.
    if (path.startsWith("/question?") && response.status == 404) return new JSONArray();
    return array(response);
  }

  private static JSONArray forSession(JSONArray values, String id) throws Exception {
    JSONArray result = new JSONArray();
    for (int i = 0; i < values.length(); i++) {
      JSONObject value = values.getJSONObject(i);
      if (id.equals(value.optString("sessionID"))) result.put(value);
    }
    return result;
  }

  private static String text(JSONArray parts) throws Exception {
    StringBuilder result = new StringBuilder();
    if (parts == null) return "";
    for (int index = 0; index < parts.length(); index++) {
      JSONObject part = parts.getJSONObject(index);
      if ("text".equals(part.optString("type"))) result.append(part.optString("text")).append('\n');
    }
    return result.toString().trim();
  }

  static String path(String id, String suffix, String directory) throws Exception {
    if (id == null || !id.matches("ses_[A-Za-z0-9_-]{1,160}") || directory == null || directory.isEmpty()) {
      throw new IllegalArgumentException(UiText.text("OpenCode 会话 ID 或工作目录无效"));
    }
    return "/session/" + id + suffix + "?directory=" + URLEncoder.encode(directory, "UTF-8");
  }

  private static JSONObject object(Response response) throws Exception {
    requireSuccess(response);
    try { return new JSONObject(response.body); }
    catch (Exception error) { throw new IOException(UiText.text("OpenCode 返回的数据格式不支持，请核对服务版本")); }
  }

  private static JSONArray array(Response response) throws Exception {
    requireSuccess(response);
    try { return new JSONArray(response.body); }
    catch (Exception error) { throw new IOException(UiText.text("OpenCode 返回的数据格式不支持，请核对服务版本")); }
  }

  private static void requireSuccess(Response response) throws Exception {
    if (response.status == 401 || response.status == 403) {
      throw new IOException(UiText.text("OpenCode 认证失败，请检查服务账号和密码"));
    }
    if (response.status < 200 || response.status >= 300) {
      throw new IOException("OpenCode HTTP " + response.status);
    }
  }

  private static String bounded(String value, int limit) {
    return value.length() <= limit ? value : value.substring(value.length() - limit);
  }
}
