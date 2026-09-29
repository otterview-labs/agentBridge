package com.otterview.agentsessionbridge;

import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.HashSet;

/**
 * Manages the butler (管家) conversation, model calls, tool execution,
 * context formatting, and report generation. Extracted from PhoneBridge
 * for single-responsibility and testability.
 */
final class ButlerManager {
  private static final String TAG = "ButlerManager";

  private final PhoneBridge bridge;
  private final BridgeStore store;
  private final MainActivity activity;

  ButlerManager(PhoneBridge bridge, BridgeStore store, MainActivity activity) {
    this.bridge = bridge;
    this.store = store;
    this.activity = activity;
  }

  // ─── Context & Snapshot ────────────────────────────────────────────

  JSONObject localStudioSnapshot() throws Exception {
    java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT);
    format.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Shanghai"));
    String date = format.format(new java.util.Date());
    JSONObject local = new JSONObject(bridge.studioState()).getJSONObject("data");
    JSONArray sourceTasks = local.getJSONArray("tasks");
    JSONArray tasks = new JSONArray();
    JSONArray ongoing = new JSONArray();
    JSONArray suggestions = new JSONArray();
    for (int index = 0; index < sourceTasks.length(); index += 1) {
      JSONObject source = sourceTasks.getJSONObject(index);
      JSONObject task = new JSONObject();
      task.put("id", "S-" + source.opt("id"))
          .put("machineId", source.opt("machineId"))
          .put("title", source.optString("title"))
          .put("agentType", source.optString("agentType"))
          .put("status", source.optString("status"))
          .put("label", source.optBoolean("requiredInput") ? "待输入" : "待核实")
          .put("needsAttention", source.optBoolean("requiredInput"))
          .put("next", source.optBoolean("requiredInput") ? "等待手机回复后继续。" : "进入手机控制台查看输出后处理。")
          .put("source", "手机 SSH 会话记录")
          .put("completedToday", false);
      tasks.put(task);
      ongoing.put(task);
      suggestions.put(new JSONObject()
          .put("taskId", task.getString("id"))
          .put("title", task.getString("title"))
          .put("next", task.getString("next")));
    }
    JSONObject model = store.studioModel();
    boolean modelReady = model.optBoolean("enabled")
        && !model.optString("modelId").isEmpty()
        && !model.optString("baseUrl").isEmpty()
        && !model.optString("apiKey").isEmpty();
    JSONArray reports = store.studioReports();
    JSONObject latestReport = reports.length() == 0 ? null : reports.getJSONObject(reports.length() - 1);
    JSONArray reportHistory = new JSONArray();
    for (int index = 0; index < reports.length(); index += 1) {
      reportHistory.put(new JSONObject()
          .put("date", reports.getJSONObject(index).optString("date"))
          .put("versions", 1));
    }
    return new JSONObject()
        .put("date", date)
        .put("generatedAt", bridge.now())
        .put("tomorrow", tomorrowDateString())
        .put("timeZone", "Asia/Shanghai")
        .put("scope", "当前手机的 SSH 记录、本机记忆和本机模型配置；不经过 Hub。")
        .put("model", new JSONObject().put("ready", modelReady).put("label", modelReady ? model.optString("modelId") : "模型未配置"))
        .put("machines", local.getJSONArray("machines"))
        .put("tasks", tasks)
        .put("ongoing", ongoing)
        .put("suggestions", suggestions)
        .put("memories", store.studioMemories())
        .put("messages", store.studioMessages())
        .put("dailyReport", latestReport != null ? latestReport.optJSONObject("content") : null)
        .put("reportHistory", reportHistory);
  }

  String formatStudioContext(JSONObject snapshot) throws Exception {
    StringBuilder sb = new StringBuilder("当前手机记录（已整理）：\n\n");
    JSONArray machines = snapshot.optJSONArray("machines");
    if (machines != null && machines.length() > 0) {
      sb.append("## 机器\n");
      for (int i = 0; i < machines.length(); i++) {
        JSONObject m = machines.getJSONObject(i);
        sb.append("- ").append(m.optString("name", "未知"))
            .append("（").append(m.optString("lastStatus", "unknown")).append("）\n");
      }
      sb.append("\n");
    }
    JSONArray tasks = snapshot.optJSONArray("tasks");
    if (tasks != null && tasks.length() > 0) {
      JSONArray attention = new JSONArray();
      JSONArray running = new JSONArray();
      JSONArray idle = new JSONArray();
      for (int i = 0; i < tasks.length(); i++) {
        JSONObject t = tasks.getJSONObject(i);
        if (t.optBoolean("needsAttention") || t.optBoolean("requiredInput")) attention.put(t);
        else if ("running".equals(t.optString("status"))) running.put(t);
        else idle.put(t);
      }
      if (attention.length() > 0) {
        sb.append("## 待输入（AI 在等用户回复，最紧急）\n");
        for (int i = 0; i < attention.length(); i++) {
          JSONObject t = attention.getJSONObject(i);
          sb.append("- ").append(t.optString("title", "未知任务"))
              .append(" [").append(t.optString("agentType", "")).append("]\n");
        }
        sb.append("\n");
      }
      if (running.length() > 0) {
        sb.append("## 执行中\n");
        for (int i = 0; i < running.length(); i++) {
          JSONObject t = running.getJSONObject(i);
          sb.append("- ").append(t.optString("title", "未知任务"))
              .append(" [").append(t.optString("agentType", "")).append("]\n");
        }
        sb.append("\n");
      }
      if (idle.length() > 0) {
        sb.append("## 空闲（等待核实）\n");
        for (int i = 0; i < Math.min(idle.length(), 8); i++) {
          JSONObject t = idle.getJSONObject(i);
          sb.append("- ").append(t.optString("title", "未知任务"))
              .append(" [").append(t.optString("agentType", "")).append("]\n");
        }
        if (idle.length() > 8) sb.append("… 共 ").append(idle.length()).append(" 条\n");
        sb.append("\n");
      }
    }
    JSONArray memories = snapshot.optJSONArray("memories");
    if (memories != null && memories.length() > 0) {
      sb.append("## 用户偏好记忆\n");
      for (int i = 0; i < Math.min(memories.length(), 5); i++) {
        sb.append("- ").append(memories.getJSONObject(i).optString("content", "")).append("\n");
      }
      sb.append("\n");
    }
    return sb.toString();
  }

  JSONArray studioChatMessages(JSONArray history, String value, JSONObject snapshot) throws Exception {
    JSONArray messages = new JSONArray();
    messages.put(new JSONObject().put("role", "system").put("content",
        "你是 agentBridge 的手机管家小助手。你聪明、亲切、务实，像一个靠谱的技术管家。\n"
            + "职责：帮用户管理多台机器上的 AI 编程任务（Claude/Codex 等），提供状态汇总、优先级建议和风险提醒。\n\n"
            + "回答规则：\n"
            + "1. 先给一句直接的结论或建议，再展开细节。\n"
            + "2. 用任务名称说话，不要只报编号。例如「云端采集 agent 接入」比「S-252940」好得多。\n"
            + "3. 给出可操作的建议时说清楚：做什么、为什么、怎么判断做好了。\n"
            + "4. 待输入的任务最紧急（AI 在等用户回复），放在最前面提醒。\n"
            + "5. 语气自然友好，像同事沟通，不要像数据库查询。\n"
            + "6. 没有数据就直说，不要编造。\n"
            + "7. 你没有执行命令的权限，建议用户去操作。\n"
            + "8. 不输出 JSON，不使用 Markdown 符号（**、#、表格）。\n"
            + "9. 你可以调用工具获取实时数据（list_tasks、check_machines、get_task_output）。"
            + "回答涉及当前任务状态时，优先调用工具获取最新数据，不要只依赖静态快照。"));
    messages.put(new JSONObject().put("role", "system").put("content",
        formatStudioContext(snapshot)));
    int start = Math.max(0, history.length() - 20);
    for (int index = start; index < history.length(); index += 1) {
      JSONObject item = history.getJSONObject(index);
      messages.put(new JSONObject()
          .put("role", "assistant".equals(item.optString("role")) ? "assistant" : "user")
          .put("content", item.optString("content")));
    }
    messages.put(new JSONObject().put("role", "user").put("content", value));
    return messages;
  }

  // ─── Model API ─────────────────────────────────────────────────────

  String directModelReplyWithTools(JSONObject model, JSONArray messages, int maxRounds) throws Exception {
    JSONArray tools = buildButlerTools();
    for (int round = 0; round < maxRounds; round++) {
      String raw = chatCompletion(model, messages, tools);
      JSONObject response = new JSONObject(raw);
      JSONArray choices = response.optJSONArray("choices");
      if (choices == null || choices.length() == 0) break;
      JSONObject message = choices.getJSONObject(0).optJSONObject("message");
      if (message == null) break;
      JSONArray toolCalls = message.optJSONArray("tool_calls");
      if (toolCalls == null || toolCalls.length() == 0) {
        String content = message.optString("content", "").trim();
        if (!content.isEmpty()) return content;
        break;
      }
      messages.put(message);
      for (int i = 0; i < toolCalls.length(); i++) {
        JSONObject call = toolCalls.getJSONObject(i);
        String callId = call.optString("id", "call_" + i);
        JSONObject function = call.optJSONObject("function");
        String fnName = function != null ? function.optString("name", "") : "";
        String fnArgs = function != null ? function.optString("arguments", "{}") : "{}";
        String result = executeButlerTool(fnName, fnArgs);
        messages.put(new JSONObject()
            .put("role", "tool")
            .put("tool_call_id", callId)
            .put("content", result));
      }
    }
    throw new IllegalStateException("管家模型没有返回有效文本");
  }

  String chatCompletion(JSONObject model, JSONArray messages, JSONArray tools) throws Exception {
    HttpURLConnection connection = null;
    try {
      URL url = new URL(model.getString("baseUrl") + "/chat/completions");
      connection = activity.openModelConnection(url);
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(120_000);
      connection.setDoOutput(true);
      connection.setRequestProperty("Authorization", "Bearer " + model.getString("apiKey"));
      connection.setRequestProperty("Content-Type", "application/json");
      JSONObject request = new JSONObject()
          .put("model", model.getString("modelId"))
          .put("messages", messages)
          .put("max_tokens", 1800)
          .put("temperature", 0.2);
      if (tools != null && tools.length() > 0) request.put("tools", tools);
      if (model.optString("baseUrl", "").contains("dashscope.aliyuncs.com")) {
        request.put("enable_thinking", false);
      }
      byte[] payload = request.toString().getBytes(StandardCharsets.UTF_8);
      connection.setFixedLengthStreamingMode(payload.length);
      try (java.io.OutputStream output = connection.getOutputStream()) { output.write(payload); }
      int status = connection.getResponseCode();
      InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
      String body = readStream(stream, 2_000_000);
      if (status >= 400) throw new IllegalStateException("模型返回 HTTP " + status);
      return body;
    } catch (java.io.IOException error) {
      if (error instanceof java.net.UnknownHostException) activity.noteNetworkDeath();
      throw new IllegalStateException("模型连接失败：" + error.getMessage());
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  // ─── Tool Definitions & Execution ──────────────────────────────────

  JSONArray buildButlerTools() throws Exception {
    return new JSONArray()
        .put(new JSONObject()
            .put("type", "function")
            .put("function", new JSONObject()
                .put("name", "list_tasks")
                .put("description", "获取所有机器上的实时任务列表")
                .put("parameters", new JSONObject().put("type", "object").put("properties", new JSONObject()))))
        .put(new JSONObject()
            .put("type", "function")
            .put("function", new JSONObject()
                .put("name", "check_machines")
                .put("description", "检查所有机器的实时在线状态和连通性")
                .put("parameters", new JSONObject().put("type", "object").put("properties", new JSONObject()))))
        .put(new JSONObject()
            .put("type", "function")
            .put("function", new JSONObject()
                .put("name", "get_task_output")
                .put("description", "获取指定任务的最近输出内容")
                .put("parameters", new JSONObject()
                    .put("type", "object")
                    .put("properties", new JSONObject()
                        .put("task_id", new JSONObject().put("type", "string").put("description", "任务ID"))))));
  }

  String executeButlerTool(String name, String argsJson) {
    try {
      JSONObject args = new JSONObject(argsJson);
      switch (name) {
        case "list_tasks": {
          StringBuilder sb = new StringBuilder();
          JSONArray machines = new JSONObject(bridge.studioState()).getJSONObject("data").getJSONArray("machines");
          for (int i = 0; i < machines.length(); i++) {
            JSONObject m = machines.getJSONObject(i);
            if (!"online".equals(m.optString("lastStatus"))) continue;
            try {
              String result = bridge.discoverTasks(m.getInt("id"));
              JSONObject parsed = new JSONObject(result);
              if (parsed.optBoolean("ok")) {
                JSONArray tasks = parsed.getJSONObject("data").getJSONArray("tasks");
                for (int t = 0; t < tasks.length(); t++) {
                  JSONObject task = tasks.getJSONObject(t);
                  if (sb.length() > 0) sb.append(",");
                  sb.append(new JSONObject()
                      .put("id", task.optString("id"))
                      .put("title", task.optString("title"))
                      .put("status", task.optString("status"))
                      .put("machine", m.optString("name"))
                      .put("agentType", task.optString("agentType"))
                      .put("needsInput", task.optBoolean("requiredInput"))
                      .toString());
                }
              }
            } catch (Exception sshError) {
              // Machine unreachable
            }
          }
          return "[" + sb.toString() + "]";
        }
        case "check_machines": {
          JSONObject state = new JSONObject(bridge.studioState());
          JSONArray machines = state.getJSONObject("data").getJSONArray("machines");
          JSONArray result = new JSONArray();
          for (int i = 0; i < machines.length(); i++) {
            JSONObject m = machines.getJSONObject(i);
            try {
              String probeResult = bridge.probeMachine(m.getInt("id"));
              JSONObject parsed = new JSONObject(probeResult);
              if (parsed.optBoolean("ok")) {
                JSONObject pm = parsed.getJSONObject("data").getJSONObject("machine");
                result.put(new JSONObject()
                    .put("id", pm.opt("id"))
                    .put("name", pm.optString("name"))
                    .put("status", pm.optString("lastStatus"))
                    .put("tools", pm.optJSONArray("tools")));
              }
            } catch (Exception probeError) {
              result.put(new JSONObject()
                  .put("id", m.opt("id"))
                  .put("name", m.optString("name"))
                  .put("status", "unreachable"));
            }
          }
          return result.toString();
        }
        case "get_task_output": {
          String taskId = args.optString("task_id", "");
          JSONObject state = new JSONObject(bridge.studioState());
          JSONArray tasks = state.getJSONObject("data").getJSONArray("tasks");
          for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.getJSONObject(i);
            if (taskId.equals(t.optString("id")) || taskId.equals("S-" + t.opt("id"))) {
              return new JSONObject()
                  .put("id", t.optString("id"))
                  .put("title", t.optString("title"))
                  .put("workSummary", t.optString("workSummary", ""))
                  .put("lastOutput", t.optString("lastOutput", ""))
                  .toString();
            }
          }
          return "{\"error\":\"task not found: " + taskId + "\"}";
        }
        default:
          return "{\"error\":\"unknown tool: " + name + "\"}";
      }
    } catch (Exception error) {
      return "{\"error\":\"" + error.getMessage() + "\"}";
    }
  }

  // ─── Utility ───────────────────────────────────────────────────────

  private String tomorrowDateString() {
    java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT);
    format.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Shanghai"));
    return format.format(new java.util.Date(System.currentTimeMillis() + 86_400_000L));
  }

  private String readStream(InputStream input, int maximum) throws Exception {
    if (input == null) return "";
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int read;
    while ((read = input.read(buffer)) != -1) {
      if (output.size() + read > maximum) throw new IllegalStateException("响应过大");
      output.write(buffer, 0, read);
    }
    return output.toString("UTF-8");
  }
}
