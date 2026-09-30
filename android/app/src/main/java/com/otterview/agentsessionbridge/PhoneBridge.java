package com.otterview.agentsessionbridge;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.util.Log;

import com.jcraft.jsch.ChannelExec;
import com.jcraft.jsch.JSch;
import com.jcraft.jsch.Session;
import com.jcraft.jsch.SocketFactory;
import com.jcraft.jsch.UIKeyboardInteractive;
import com.jcraft.jsch.UserInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.NetworkInterface;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.Arrays;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.security.SecureRandom;
import java.util.regex.Matcher;
import java.util.regex.Pattern;


/** Native bridge exposed to the local phone UI. All agent control happens on the phone. */
final class PhoneBridge {
  private static final int CONNECT_TIMEOUT = 12_000;
  private static final int COMMAND_TIMEOUT = 90_000;
  private static final int MAX_OUTPUT = 2_000_000;
  private static final int MAX_STDERR = 64_000;
  private static final String CODEX_THREAD_ID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

  private final MainActivity activity;

  String getDashScopeApiKey() {
    try {
      JSONObject model = store.studioModel();
      String baseUrl = model.optString("baseUrl", "");
      if (baseUrl.contains("dashscope.aliyuncs.com")) {
        return model.optString("apiKey", "");
      }
    } catch (Exception error) {
      // Model not configured or not DashScope
    }
    return null;
  }
  private final BridgeStore store;
  /** Insertion-ordered so pruning drops the oldest operations first. */
  private final Map<Integer, JSONObject> operations = new LinkedHashMap<>();
  /** Keyed by identity: two live sessions must never share a slot. */
  private final Map<Session, Session> relayBastionSessions = new IdentityHashMap<>();
  private final SecureRandom secureRandom = new SecureRandom();

  PhoneBridge(MainActivity activity) {
    this.activity = activity;
    this.store = BridgeStore.get(activity);
  }

  void close() { /* Direct model calls run on their own operation threads. */ }

  @JavascriptInterface
  public String state() {
    try {
      JSONObject data = new JSONObject();
      data.put("machines", publicMachines(store.machines()));
      data.put("tasks", store.tasks());
      data.put("deletedTasks", store.deletedTasks());
      data.put("frpServer", publicFrpServer());
      data.put("frpRelays", publicFrpRelays());
      data.put("networkHint", networkHint());
      return success(data);
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String studioOverview() {
    try {
      return success(localStudioSnapshot());
    } catch (Exception error) {
      return failure(new Exception("管家状态读取失败，请重试"));
    }
  }

  @JavascriptInterface
  public String saveStudioModel(String payload) {
    try {
      JSONObject input = new JSONObject(payload);
      String baseUrl = validateDirectModelUrl(input.optString("baseUrl", ""));
      String modelId = input.optString("modelId", "").trim();
      String apiKey = input.optString("apiKey", "").trim();
      if (modelId.isEmpty() || modelId.length() > 160) {
        throw new IllegalArgumentException("模型名不能为空，且最多 160 字符");
      }
      JSONObject old = store.studioModel();
      boolean sameDestination = baseUrl.equals(old.optString("baseUrl"));
      if (apiKey.isEmpty()) {
        apiKey = sameDestination ? old.optString("apiKey", "") : "";
      }
      if (apiKey.isEmpty()) throw new IllegalArgumentException("请填写模型 API Key；更换地址时必须重新填写");
      JSONObject model = new JSONObject()
          .put("enabled", true)
          .put("provider", "openai-compatible")
          .put("modelId", modelId)
          .put("baseUrl", baseUrl)
          .put("apiKey", apiKey)
          .put("updatedAt", now());
      store.saveStudioModel(model);
      JSONObject overview = localStudioSnapshot();
      overview.put("modelSettings", publicStudioModel(model));
      return success(overview);
    } catch (Exception error) {
      if (error instanceof IllegalArgumentException || error instanceof IllegalStateException) return failure(error);
      return failure(new Exception("管家模型保存失败，请检查地址、模型名和密钥"));
    }
  }

  @JavascriptInterface
  public String sendStudioMessage(String content) {
    try {
      JSONObject model = readyStudioModel();
      String value = content == null ? "" : content.trim();
      if (value.isEmpty() || value.length() > 4000) {
        throw new IllegalArgumentException("消息须为 1–4000 字。");
      }
      JSONArray history = store.studioMessages();
      JSONObject snapshot = localStudioSnapshot();
      String answer = directModelReplyWithTools(model, studioChatMessages(history, value, snapshot), 3);
      appendStudioMessage("user", value);
      appendStudioMessage("assistant", answer);
      JSONObject overview = localStudioSnapshot();
      overview.put("messages", store.studioMessages());
      return success(overview);
    } catch (Exception error) {
      if (error instanceof IllegalArgumentException || error instanceof IllegalStateException) return failure(error);
      return failure(new Exception("管家回复失败；这条消息没有保存，也没有执行操作"));
    }
  }

  @JavascriptInterface
  public String beginStudioMessage(String content) {
    try {
      String value = content == null ? "" : content.trim();
      if (value.isEmpty() || value.length() > 4000) {
        throw new IllegalArgumentException("消息须为 1–4000 字。");
      }
      int operationId = store.nextId();
      JSONObject operation = registerOperation(operationId, "model", "管家正在思考…");

      startWorker("agent-bridge-chat-" + operationId, () -> {
        try {
          updateOperation(operationId, "model", "管家正在思考…", "");
          String raw = sendStudioMessage(value);
          JSONObject result = new JSONObject(raw);
          if (!result.optBoolean("ok")) {
            throw new IllegalArgumentException(result.optString("error", "管家回复失败"));
          }
          JSONObject data = result.getJSONObject("data");
          synchronized (operations) {
            JSONObject current = operations.get(operationId);
            if (current != null) {
              current.put("state", "succeeded")
                  .put("phase", "succeeded")
                  .put("message", "管家已回复")
                  .put("studio", data)
                  .put("updatedAt", System.currentTimeMillis());
            }
          }
        } catch (Exception error) {
          try {
            updateOperation(operationId, "failed",
                error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage(), "");
          } catch (Exception ignored) {
            // The operation was cleared by the user.
          }
        }
      });
      return success(new JSONObject().put("operation", operation));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String generateStudioReport(String date) {
    try {
      JSONObject model = readyStudioModel();
      JSONObject snapshot = localStudioSnapshot();
      if (!date.equals(snapshot.getString("date"))) {
        throw new IllegalArgumentException("只可根据当前手机记录生成今日任务规划");
      }
      JSONObject report = generateDirectReport(model, snapshot);
      JSONArray reports = store.studioReports();
      reports.put(report);
      while (reports.length() > 20) reports.remove(0);
      store.saveStudioReports(reports);
      JSONObject overview = localStudioSnapshot();
      overview.put("lastReport", report);
      return success(overview);
    } catch (Exception error) {
      if (error instanceof IllegalArgumentException || error instanceof IllegalStateException) return failure(error);
      return failure(new Exception("任务规划生成失败；已有规划不会覆盖"));
    }
  }

  @JavascriptInterface
  public String startVoiceInput(boolean autoSend) {
    try {
      activity.startVoiceRecognition(autoSend);
      return success(new JSONObject().put("recording", true).put("autoSend", autoSend));
    } catch (Exception error) {
      return failure(new Exception("语音识别启动失败，请检查系统语音服务和麦克风权限"));
    }
  }

  @JavascriptInterface
  public String stopVoiceInput() {
    try {
      activity.stopVoiceRecognition();
      return success(new JSONObject().put("recording", false));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String cancelVoiceInput() {
    try {
      activity.cancelVoiceRecognition();
      return success(new JSONObject().put("recording", false));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String startConversationAudio(boolean speakerOn) {
    try {
      activity.startConversationAudio(speakerOn);
      return success(new JSONObject().put("callAudio", true).put("speakerOn", speakerOn));
    } catch (Exception error) {
      return failure(new Exception("通话音频启动失败，请检查音频设备"));
    }
  }

  @JavascriptInterface
  public String setConversationSpeaker(boolean speakerOn) {
    try {
      activity.setConversationSpeaker(speakerOn);
      return success(new JSONObject().put("speakerOn", speakerOn));
    } catch (Exception error) {
      return failure(new Exception("扬声器切换失败"));
    }
  }

  @JavascriptInterface
  public String stopConversationAudio() {
    try {
      activity.stopConversationAudio();
      return success(new JSONObject().put("callAudio", false));
    } catch (Exception error) {
      return failure(new Exception("通话音频关闭失败"));
    }
  }

  @JavascriptInterface
  public String setTtsSettings(double rate, double pitch) {
    try {
      activity.setTtsSettings((float) rate, (float) pitch);
      return success(new JSONObject()
          .put("rate", rate)
          .put("pitch", pitch));
    } catch (Exception error) {
      return failure(new Exception("语音设置保存失败"));
    }
  }

  @JavascriptInterface
  public String setTtsEnginePreference(boolean preferCloud) {
    try {
      activity.setTtsEnginePreference(preferCloud);
      return success(new JSONObject().put("preferCloud", preferCloud));
    } catch (Exception error) {
      return failure(new Exception("语音引擎偏好保存失败"));
    }
  }

  @JavascriptInterface
  public String getTtsStatus() {
    try {
      java.util.Map<String, Object> status = new java.util.LinkedHashMap<>();
      activity.getTtsStatus(status);
      JSONObject result = new JSONObject(status);
      boolean cloudAvailable = false;
      try {
        JSONObject model = store.studioModel();
        cloudAvailable = model.optBoolean("enabled", false)
            && model.optString("baseUrl", "").contains("dashscope.aliyuncs.com")
            && !model.optString("apiKey", "").isEmpty();
      } catch (Exception error) {
        cloudAvailable = false;
      }
      result.put("cloudAvailable", cloudAvailable);
      if (!result.optBoolean("ready", false) && cloudAvailable) {
        result.put("ready", true);
        result.put("mode", "cloud");
      } else {
        result.put("mode", result.optBoolean("ready", false) ? "local" : "none");
      }
      return success(result);
    } catch (Exception error) {
      return failure(new Exception("语音状态读取失败"));
    }
  }

  JSONObject transcribeVoiceAudio(String base64Audio, String contentType) throws Exception {
    JSONObject model = readyStudioModel();
    String baseUrl = model.optString("baseUrl", "");
    if (!baseUrl.contains("dashscope.aliyuncs.com")) {
      throw new IllegalStateException("系统语音不可用，且当前管家模型地址不支持云端识别；可换用阿里云百炼地址");
    }
    HttpURLConnection connection = null;
    try {
      URL url = new URL(baseUrl + "/chat/completions");
      connection = activity.openModelConnection(url);
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(60_000);
      connection.setDoOutput(true);
      connection.setRequestProperty("Authorization", "Bearer " + model.getString("apiKey"));
      connection.setRequestProperty("Content-Type", "application/json");
      // qwen3-asr-flash on the OpenAI-compatible endpoint expects input_audio
      // as a plain data-URI string; an object form returns InvalidParameter.
      JSONArray content = new JSONArray().put(new JSONObject()
          .put("type", "input_audio")
          .put("input_audio", "data:audio/amr;base64," + base64Audio));
      byte[] payload = new JSONObject()
          .put("model", "qwen3-asr-flash")
          .put("messages", new JSONArray().put(new JSONObject()
              .put("role", "user")
              .put("content", content)))
          .toString().getBytes(StandardCharsets.UTF_8);
      connection.setFixedLengthStreamingMode(payload.length);
      try (java.io.OutputStream output = connection.getOutputStream()) {
        output.write(payload);
      }
      int status = connection.getResponseCode();
      InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
      String body = readStream(stream, 2_000_000);
      if (status >= 400) {
        throw new IllegalStateException("云端语音识别返回 HTTP " + status
            + "：" + body.replaceAll("\\s+", " ").substring(0, Math.min(body.length(), 180)));
      }
      JSONObject result = new JSONObject(body);
      JSONArray choices = result.optJSONArray("choices");
      if (choices == null || choices.length() == 0) {
        throw new IllegalStateException("云端语音识别没有返回结果");
      }
      String text = choices.getJSONObject(0).optJSONObject("message") == null
          ? "" : choices.getJSONObject(0).getJSONObject("message").optString("content", "").trim();
      if (text.isEmpty()) throw new IllegalStateException("没有识别到文字");
      return new JSONObject().put("ok", true).put("data", new JSONObject().put("text", text));
    } catch (java.io.IOException error) {
      throw new IllegalStateException("云端语音识别连接失败，请检查网络");
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  @JavascriptInterface
  public String speakText(String text) {
    try {
      if (activity.speakText(text)) {
        return success(new JSONObject().put("speaking", true).put("mode", "local"));
      }
      JSONObject model = readyStudioModel();
      if (!model.optString("baseUrl", "").contains("dashscope.aliyuncs.com")) {
        throw new IllegalStateException("本机语音不可用，且当前管家模型地址不支持云端语音");
      }
      String audioUrl = activity.synthesizeCloudSpeechUrl(model.getString("apiKey"), text);
      activity.playSpeechUrl(audioUrl);
      return success(new JSONObject().put("speaking", true).put("mode", "cloud"));
    } catch (Exception error) {
      String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
      android.util.Log.w("AgentBridgeNative", "speakText failed", error);
      return failure(new Exception("语音播报失败：" + message));
    }
  }

  @JavascriptInterface
  public String stopSpeaking() {
    try {
      activity.stopSpeaking();
      return success(new JSONObject().put("speaking", false));
    } catch (Exception error) {
      return failure(error);
    }
  }


  @JavascriptInterface
  public synchronized String studioState() {
    try {
      JSONObject data = new JSONObject();
      JSONArray machines = new JSONArray();
      JSONArray storedMachines = store.machines();
      for (int i = 0; i < storedMachines.length(); i++) {
        JSONObject item = storedMachines.getJSONObject(i);
        JSONObject machine = new JSONObject();
        machine.put("id", item.getInt("id"));
        machine.put("name", item.optString("name"));
        machine.put("status", item.optString("lastStatus", "unknown"));
        machine.put("lastSeenAt", item.optString("lastCheckedAt", ""));
        machine.put("tools", item.optJSONArray("tools") == null ? new JSONArray() : item.optJSONArray("tools"));
        machines.put(machine);
      }
      JSONArray tasks = new JSONArray();
      JSONArray storedTasks = store.tasks();
      for (int i = 0; i < storedTasks.length(); i++) {
        JSONObject item = storedTasks.getJSONObject(i);
        JSONObject task = new JSONObject();
        for (String key : new String[] { "id", "machineId", "title", "agentType", "status", "updatedAt" }) {
          task.put(key, item.opt(key));
        }
        // Only signal pending input, never expose raw output or credentials here.
        task.put("requiredInput", !item.optString("requiredInput").isEmpty());
        tasks.put(task);
      }
      data.put("machines", machines);
      data.put("tasks", tasks);
      data.put("memories", store.studioMemories());
      return success(data);
    } catch (Exception error) {
      return failure(error);
    }
  }

  private JSONObject localStudioSnapshot() throws Exception {
    java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT);
    format.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Shanghai"));
    String date = format.format(new java.util.Date());
    JSONObject local = new JSONObject(studioState()).getJSONObject("data");
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
        .put("generatedAt", now())
        .put("tomorrow", tomorrowDateString())
        .put("timeZone", "Asia/Shanghai")
        .put("scope", "当前手机的 SSH 记录、本机记忆和本机模型配置；不经过 Hub。")
        .put("model", new JSONObject()
            .put("ready", modelReady)
            .put("label", modelReady ? model.optString("modelId") : "模型未配置"))
        .put("modelSettings", publicStudioModel(model))
        .put("machines", local.getJSONArray("machines"))
        .put("tasks", tasks)
        .put("memories", local.getJSONArray("memories"))
        .put("messages", store.studioMessages())
        .put("dailyReport", latestReport == null ? JSONObject.NULL : latestReport)
        .put("reportHistory", reportHistory)
        .put("report", new JSONObject()
            .put("completed", new JSONArray())
            .put("ongoing", ongoing)
        .put("suggestions", suggestions));
  }

  private String tomorrowDateString() {
    java.text.SimpleDateFormat format = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT);
    format.setTimeZone(java.util.TimeZone.getTimeZone("Asia/Shanghai"));
    return format.format(new java.util.Date(System.currentTimeMillis() + 86_400_000L));
  }

  private JSONObject publicStudioModel(JSONObject model) {
    JSONObject result = new JSONObject();
    try {
      result.put("enabled", model.optBoolean("enabled"))
          .put("provider", "openai-compatible")
          .put("modelId", model.optString("modelId"))
          .put("baseUrl", model.optString("baseUrl"))
          .put("hasApiKey", !model.optString("apiKey").isEmpty())
          .put("source", model.optString("apiKey").isEmpty() ? "unconfigured" : "local");
    } catch (Exception ignored) {
      // The caller treats an empty object as an unconfigured model.
    }
    return result;
  }

  private JSONObject readyStudioModel() throws Exception {
    JSONObject model = store.studioModel();
    if (!model.optBoolean("enabled") || model.optString("modelId").trim().isEmpty()
        || model.optString("baseUrl").trim().isEmpty() || model.optString("apiKey").trim().isEmpty()) {
      throw new IllegalArgumentException("请先在模型设置中配置 OpenAI 格式模型");
    }
    return model;
  }

  private String validateDirectModelUrl(String value) throws Exception {
    String clean = value == null ? "" : value.trim();
    while (clean.endsWith("/")) clean = clean.substring(0, clean.length() - 1);
    if (clean.isEmpty()) throw new IllegalArgumentException("模型 Base URL 不能为空");
    URL url = new URL(clean);
    boolean local = url.getHost().equals("localhost") || url.getHost().equals("127.0.0.1")
        || url.getHost().equals("[::1]");
    if (!url.getProtocol().equals("https") && !(url.getProtocol().equals("http") && local)) {
      throw new IllegalArgumentException("模型 Base URL 须使用 HTTPS；本机模型可用 HTTP");
    }
    if (url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null) {
      throw new IllegalArgumentException("模型 Base URL 不能带凭据、查询参数或片段");
    }
    return clean;
  }

  private void appendStudioMessage(String role, String content) throws Exception {
    store.appendStudioMessage(new JSONObject()
        .put("id", java.util.UUID.randomUUID().toString())
        .put("role", role)
        .put("content", content)
        .put("createdAt", now()), 100);
  }

  private JSONArray studioChatMessages(JSONArray history, String value, JSONObject snapshot) throws Exception {
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

  private String formatStudioContext(JSONObject snapshot) throws Exception {
    StringBuilder sb = new StringBuilder("当前手机记录（已整理）：\n\n");
    JSONArray machines = snapshot.optJSONArray("machines");
    if (machines != null && machines.length() > 0) {
      sb.append("## 机器\n");
      for (int i = 0; i < machines.length(); i++) {
        JSONObject m = machines.getJSONObject(i);
        sb.append("- ").append(m.optString("name", "未知"))
            .append("（").append(m.optString("status", "unknown")).append("）\n");
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

  private String directModelReply(JSONObject model, JSONArray messages) throws Exception {
    HttpURLConnection connection = null;
    try {
      URL url = new URL(model.getString("baseUrl") + "/chat/completions");
      connection = activity.openModelConnection(url);
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(180_000);
      connection.setDoOutput(true);
      connection.setRequestProperty("Authorization", "Bearer " + model.getString("apiKey"));
      connection.setRequestProperty("Content-Type", "application/json");
      JSONObject request = new JSONObject()
          .put("model", model.getString("modelId"))
          .put("messages", messages)
          .put("max_tokens", 1800)
          .put("temperature", 0.2);
      // DashScope-compatible qwen models may spend the token budget on hidden
      // reasoning before emitting content; disable it for deterministic output.
      if (model.optString("baseUrl", "").contains("dashscope.aliyuncs.com")) {
        request.put("enable_thinking", false);
      }
      byte[] payload = request.toString().getBytes(StandardCharsets.UTF_8);
      connection.setFixedLengthStreamingMode(payload.length);
      try (java.io.OutputStream output = connection.getOutputStream()) {
        output.write(payload);
      }
      int status = connection.getResponseCode();
      InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
      String body = readStream(stream, 2_000_000);
      if (status >= 400) {
        throw new IllegalStateException("模型服务返回 HTTP " + status + "，请检查模型名、密钥和额度");
      }
      JSONObject result = new JSONObject(body);
      JSONArray choices = result.optJSONArray("choices");
      if (choices == null || choices.length() == 0) {
        throw new IllegalStateException("模型服务没有返回回复");
      }
      String answer = choices.getJSONObject(0)
          .optJSONObject("message") == null ? "" : choices.getJSONObject(0)
          .getJSONObject("message").optString("content", "").trim();
      if (answer.isEmpty()) throw new IllegalStateException("模型服务返回了空回复");
      return answer;
    } catch (java.io.IOException error) {
      if (error instanceof java.net.UnknownHostException) {
        activity.noteNetworkDeath();
        throw new IllegalStateException("无法解析模型服务地址，请检查手机网络；网络正常仍失败时，完全退出 App 再打开");
      }
      throw new IllegalStateException("模型连接失败或超时，请检查网络和服务状态");
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  private String directModelReplyWithTools(JSONObject model, JSONArray messages, int maxRounds) throws Exception {
    JSONArray tools = buildButlerTools();
    for (int round = 0; round < maxRounds; round++) {
      // The last round must answer in text, or every tool call so far is wasted.
      String raw = chatCompletion(model, messages, tools, round == maxRounds - 1 ? "none" : null);
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
      // Model wants to call tools; append assistant message with tool_calls then execute each.
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

  private String chatCompletion(JSONObject model, JSONArray messages, JSONArray tools) throws Exception {
    return chatCompletion(model, messages, tools, null);
  }

  private String chatCompletion(JSONObject model, JSONArray messages, JSONArray tools, String toolChoice) throws Exception {
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
      if (tools != null && tools.length() > 0) {
        request.put("tools", tools);
        if (toolChoice != null) request.put("tool_choice", toolChoice);
      }
      if (model.optString("baseUrl", "").contains("dashscope.aliyuncs.com")) {
        request.put("enable_thinking", false);
      }
      byte[] payload = request.toString().getBytes(StandardCharsets.UTF_8);
      connection.setFixedLengthStreamingMode(payload.length);
      try (java.io.OutputStream output = connection.getOutputStream()) { output.write(payload); }
      int status = connection.getResponseCode();
      InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
      String body = readStream(stream, 2_000_000);
      if (status >= 400) {
        String detail = body.replaceAll("\\s+", " ").trim();
        throw new IllegalStateException("模型返回 HTTP " + status
            + (detail.isEmpty() ? "" : "：" + detail.substring(0, Math.min(detail.length(), 200))));
      }
      return body;
    } catch (java.io.IOException error) {
      if (error instanceof java.net.UnknownHostException) activity.noteNetworkDeath();
      throw new IllegalStateException("模型连接失败：" + error.getMessage());
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  /**
   * Streaming chat completion using SSE. Returns the full response text but
   * calls onPartial as chunks arrive, enabling real-time UI updates and
   * early TTS. Falls back to non-streaming if SSE fails.
   */
  private String chatCompletionStream(JSONObject model, JSONArray messages, JSONArray tools,
      java.util.function.Consumer<String> onPartial) throws Exception {
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
      connection.setRequestProperty("Accept", "text/event-stream");
      JSONObject request = new JSONObject()
          .put("model", model.getString("modelId"))
          .put("messages", messages)
          .put("max_tokens", 1800)
          .put("temperature", 0.2)
          .put("stream", true);
      if (tools != null && tools.length() > 0) request.put("tools", tools);
      if (model.optString("baseUrl", "").contains("dashscope.aliyuncs.com")) {
        request.put("enable_thinking", false);
      }
      byte[] payload = request.toString().getBytes(StandardCharsets.UTF_8);
      connection.setFixedLengthStreamingMode(payload.length);
      try (java.io.OutputStream output = connection.getOutputStream()) { output.write(payload); }
      int status = connection.getResponseCode();
      if (status >= 400) {
        String body = readStream(connection.getErrorStream(), 100_000);
        throw new IllegalStateException("模型返回 HTTP " + status);
      }
      // Read SSE stream
      InputStream stream = connection.getInputStream();
      java.io.BufferedReader reader = new java.io.BufferedReader(
          new java.io.InputStreamReader(stream, StandardCharsets.UTF_8));
      StringBuilder full = new StringBuilder();
      String line;
      while ((line = reader.readLine()) != null) {
        if (!line.startsWith("data: ")) continue;
        String data = line.substring(6).trim();
        if (data.equals("[DONE]")) break;
        try {
          JSONObject chunk = new JSONObject(data);
          JSONArray choices = chunk.optJSONArray("choices");
          if (choices == null || choices.length() == 0) continue;
          JSONObject delta = choices.getJSONObject(0).optJSONObject("delta");
          if (delta == null) continue;
          String content = delta.optString("content", "");
          if (!content.isEmpty()) {
            full.append(content);
            if (onPartial != null) onPartial.accept(full.toString());
          }
        } catch (Exception ignored) {
          // Skip malformed chunks
        }
      }
      if (full.length() == 0) throw new IllegalStateException("模型流式返回为空");
      return full.toString();
    } catch (java.io.IOException error) {
      if (error instanceof java.net.UnknownHostException) activity.noteNetworkDeath();
      // Fall back to non-streaming on network errors
      return chatCompletion(model, messages, tools);
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  private JSONArray buildButlerTools() throws Exception {
    return new JSONArray()
        .put(new JSONObject()
            .put("type", "function")
            .put("function", new JSONObject()
                .put("name", "list_tasks")
                .put("description", "获取所有机器上的实时任务列表（比静态快照更新）。返回任务名称、状态、机器、Agent类型。")
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
                .put("description", "获取指定任务的最近输出内容，用于了解任务当前进展")
                .put("parameters", new JSONObject()
                    .put("type", "object")
                    .put("properties", new JSONObject()
                        .put("task_id", new JSONObject().put("type", "string").put("description", "任务ID"))))));
  }

  private String executeButlerTool(String name, String argsJson) {
    try {
      JSONObject args = new JSONObject(argsJson == null || argsJson.trim().isEmpty() ? "{}" : argsJson);
      switch (name) {
        case "list_tasks": {
          // Real-time: SSH to every machine that was online at the last check.
          JSONArray result = new JSONArray();
          JSONArray machines = store.machines();
          for (int i = 0; i < machines.length(); i++) {
            JSONObject m = machines.getJSONObject(i);
            if (!"online".equals(m.optString("lastStatus"))) continue;
            try {
              JSONObject parsed = new JSONObject(discoverTasks(m.getInt("id")));
              if (!parsed.optBoolean("ok")) continue;
              JSONArray tasks = parsed.getJSONObject("data").getJSONArray("tasks");
              for (int t = 0; t < tasks.length(); t++) {
                JSONObject task = tasks.getJSONObject(t);
                result.put(new JSONObject()
                    .put("id", task.opt("id"))
                    .put("title", task.optString("title"))
                    .put("status", task.optString("status"))
                    .put("machine", m.optString("name"))
                    .put("agentType", task.optString("agentType"))
                    .put("needsInput", !task.optString("requiredInput").isEmpty()));
              }
            } catch (Exception sshError) {
              result.put(new JSONObject().put("machine", m.optString("name")).put("error", "机器暂时无法连接"));
            }
          }
          return result.toString();
        }
        case "check_machines": {
          JSONArray machines = store.machines();
          JSONArray result = new JSONArray();
          for (int i = 0; i < machines.length(); i++) {
            JSONObject m = machines.getJSONObject(i);
            JSONObject parsed = new JSONObject(probeMachine(m.getInt("id")));
            JSONObject probed = parsed.optBoolean("ok") ? parsed.getJSONObject("data").getJSONObject("machine") : null;
            result.put(new JSONObject()
                .put("id", m.opt("id"))
                .put("name", m.optString("name"))
                .put("status", probed == null ? "unreachable" : probed.optString("lastStatus"))
                .put("tools", probed == null ? new JSONArray() : probed.optJSONArray("tools")));
          }
          return result.toString();
        }
        case "get_task_output": {
          String taskId = args.optString("task_id", "").replaceFirst("^S-", "");
          JSONArray tasks = store.tasks();
          for (int i = 0; i < tasks.length(); i++) {
            JSONObject t = tasks.getJSONObject(i);
            if (!taskId.equals(String.valueOf(t.opt("id")))) continue;
            String output = Work.clean(sanitize(t.optString("lastOutput", "")));
            // The tail is where the agent's latest state is.
            if (output.length() > 4000) output = "…" + output.substring(output.length() - 4000);
            return new JSONObject()
                .put("id", t.opt("id"))
                .put("title", t.optString("title"))
                .put("status", t.optString("status"))
                .put("workSummary", Work.clean(t.optString("workSummary", "")))
                .put("lastOutput", output)
                .toString();
          }
          return toolError("task not found: " + taskId);
        }
        default:
          return toolError("unknown tool: " + name);
      }
    } catch (Exception error) {
      return toolError(error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage());
    }
  }

  private static String toolError(String message) {
    try {
      return new JSONObject().put("error", message).toString();
    } catch (Exception ignored) {
      return "{\"error\":\"tool failed\"}";
    }
  }

  private JSONObject generateDirectReport(JSONObject model, JSONObject snapshot) throws Exception {
    JSONArray allTasks = snapshot.getJSONArray("tasks");
    List<JSONObject> ranked = new ArrayList<>();
    for (int index = 0; index < allTasks.length(); index += 1) ranked.add(allTasks.getJSONObject(index));
    ranked.sort((left, right) -> Integer.compare(planPriority(right), planPriority(left)));
    JSONArray selected = new JSONArray();
    Set<String> ids = new HashSet<>();
    JSONArray sources = new JSONArray();
    for (int index = 0; index < ranked.size() && index < 34; index += 1) {
      JSONObject task = ranked.get(index);
      selected.put(new JSONObject()
          .put("id", task.getString("id"))
          .put("title", task.optString("title"))
          .put("agentType", task.optString("agentType"))
          .put("status", task.optString("status"))
          .put("label", task.optString("label"))
          .put("needsAttention", task.optBoolean("needsAttention"))
          .put("next", task.optString("next"))
          .put("source", task.optString("source"))
          .put("summary", boundedText(task.optString("summary"), 360, "")));
      ids.add(task.getString("id"));
      sources.put(new JSONObject()
          .put("id", task.getString("id"))
          .put("title", task.optString("title"))
          .put("label", task.optString("label"))
          .put("source", task.optString("source")));
    }
    String instruction = "请作为手机管家生成「任务规划」。输出一个 JSON 对象，不要 Markdown 代码围栏。"
        + "结构：{\"summary\":\"一句话全局状态\",\"completed\":[],\"ongoing\":[{\"text\":\"一句话说明项目、进展和还差什么\",\"taskIds\":[\"S-1\"]}],"
        + "\"blockers\":[],\"tomorrow\":[{\"text\":\"一句话说明明天做什么和如何验收\",\"taskIds\":[]}],\"decisions\":[]}。"
        + "summary 写清：几条执行中、几条待输入，以及现在最该处理哪一件、为什么；不超过 50 个字。"
        + "每个条目都是 18-60 个中文字符的完整句子，采用“在【项目】里【具体动作】，达到【可判断结果】”。"
        + "写条目前先读该任务的 summary：进展写到具体步骤或文件，不要复述状态标签。"
        + "禁止“继续优化、处理问题、跟进、完善、加强”等空话；text 不写任务编号；一个条目只写一件事。"
        + "ongoing 只选 running 或 needsAttention 的任务，最多 6 条；按影响排序。"
        + "tomorrow 是建议（最多 3 条），必须基于已有任务的自然下一步，并写清验收方式。"
        + "没有依据的 blockers 和 decisions 留空。"
        + "手机记录没有人工验收事件，所以 completed 必须为空，不能把执行中或空闲推断为完成。";
    JSONArray requestMessages = new JSONArray()
        .put(new JSONObject().put("role", "system").put("content",
            "你是 agentBridge 的手机管家，只根据手机记录生成任务规划，不执行命令。"))
        .put(new JSONObject().put("role", "user").put("content", instruction + "\n手机记录 JSON："
            + new JSONObject().put("date", snapshot.getString("date")).put("tasks", selected)));
    String raw = directModelReply(model, requestMessages).trim()
        .replace("```json", "").replace("```", "").trim();
    int start = raw.indexOf('{');
    int end = raw.lastIndexOf('}');
    if (start < 0 || end < start) throw new IllegalArgumentException("模型没有返回任务规划 JSON");
    JSONObject parsed = new JSONObject(raw.substring(start, end + 1));
    JSONObject content = new JSONObject()
        .put("summary", boundedText(parsed.optString("summary"), 2000, "基于手机记录生成任务规划"))
        .put("completed", normalizePlanRows(parsed.optJSONArray("completed"), ids, true))
        .put("ongoing", normalizePlanRows(parsed.optJSONArray("ongoing"), ids, false))
        .put("blockers", normalizePlanRows(parsed.optJSONArray("blockers"), ids, false))
        .put("tomorrow", normalizePlanRows(parsed.optJSONArray("tomorrow"), ids, false))
        .put("decisions", normalizePlanRows(parsed.optJSONArray("decisions"), ids, false));
    if (content.getJSONArray("completed").length() > 0) {
      throw new IllegalArgumentException("手机记录没有人工验收事件，不能生成已完成事项");
    }
    return new JSONObject()
        .put("id", java.util.UUID.randomUUID().toString())
        .put("date", snapshot.getString("date"))
        .put("generatedAt", now())
        .put("model", model.optString("modelId"))
        .put("content", content)
        .put("sources", sources)
        .put("coverage", "使用手机本机记录 " + selected.length() + " 条，不经过 Hub；省略 "
            + Math.max(0, allTasks.length() - selected.length()) + " 条。");
  }

  private int planPriority(JSONObject task) {
    if (task.optBoolean("needsAttention")) return 4;
    if ("running".equals(task.optString("status"))) return 3;
    if ("idle".equals(task.optString("status"))) return 2;
    return task.optString("updatedAt").isEmpty() ? 0 : 1;
  }

  private String boundedText(String value, int maximum, String fallback) {
    String clean = value == null ? "" : value.trim();
    return clean.isEmpty() ? fallback : clean.substring(0, Math.min(clean.length(), maximum));
  }

  private JSONArray normalizePlanRows(JSONArray input, Set<String> ids, boolean completed) throws Exception {
    JSONArray result = new JSONArray();
    if (input == null) return result;
    for (int index = 0; index < input.length() && result.length() < 10; index += 1) {
      Object value = input.get(index);
      if (!(value instanceof JSONObject)) continue;
      JSONObject row = (JSONObject) value;
      String text = boundedText(row.optString("text"), 1500, "");
      if (text.isEmpty()) continue;
      JSONArray taskIds = new JSONArray();
      JSONArray sourceIds = row.optJSONArray("taskIds");
      if (sourceIds != null) {
        for (int idIndex = 0; idIndex < sourceIds.length() && taskIds.length() < 10; idIndex += 1) {
          String id = String.valueOf(sourceIds.get(idIndex));
          if (!ids.contains(id)) throw new IllegalArgumentException("任务规划引用了不存在的任务：" + id);
          taskIds.put(id);
        }
      }
      if (completed && taskIds.length() == 0) {
        throw new IllegalArgumentException("已完成事项必须引用手机任务记录");
      }
      result.put(new JSONObject().put("text", text).put("taskIds", taskIds));
    }
    return result;
  }

  private String readStream(InputStream input, int maximum) throws Exception {
    if (input == null) return "";
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int read;
    while ((read = input.read(buffer)) != -1) {
      if (output.size() + read > maximum) throw new IllegalStateException("模型服务响应过大");
      output.write(buffer, 0, read);
    }
    return output.toString("UTF-8");
  }

  /**
   * Binds JSch to the phone's Wi-Fi/Ethernet network when an always-on VPN is
   * active. A VPN may accept the default route but block long-lived raw SSH
   * sockets, which surfaces as JSch's "socket is not established" timeout.
   *
   * <p>JSch skips its own connect timeout when a SocketFactory is set, so every
   * path here connects with CONNECT_TIMEOUT itself.
   */
  private static final class DirectNetworkSocketFactory implements SocketFactory {
    /** Process binding is global state: one connect at a time may hold it. */
    private static final Object PROCESS_BINDING = new Object();
    private final Network network;
    private final ConnectivityManager manager;

    DirectNetworkSocketFactory(Context context) {
      Network selected = null;
      ConnectivityManager selectedManager = null;
      try {
        ConnectivityManager manager = context.getSystemService(ConnectivityManager.class);
        if (manager != null) {
          boolean vpnActive = false;
          for (Network network : manager.getAllNetworks()) {
            NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
            if (capabilities != null && capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
              vpnActive = true;
              break;
            }
          }
          // The physical-network bypass exists only to route raw SSH around an
          // always-on VPN; without one, default routing is used.
          if (vpnActive) {
            // Prefer Wi-Fi/Ethernet, then cellular: any validated physical
            // network is a better SSH route than an always-on VPN tunnel that
            // silently drops long-lived raw sockets.
            List<Network> candidates = new ArrayList<>();
            for (Network network : manager.getAllNetworks()) {
              NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
              if (capabilities == null || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
              if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                  || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) candidates.add(0, network);
              else if (capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) candidates.add(network);
            }
            for (Network network : candidates) {
              NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
              if (capabilities == null
                  || !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                  || !capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_SUSPENDED)) continue;
              selected = network;
              selectedManager = manager;
              break;
            }
          }
        }
      } catch (Exception error) {
        Log.w("AgentBridgeNative", "direct network selection failed; using default", error);
      }
      this.network = selected;
      this.manager = selectedManager;
    }

    @Override
    public Socket createSocket(String host, int port) throws IOException {
      if (network == null) return connectDefault(host, port);
      synchronized (PROCESS_BINDING) {
        // Some OEM/VPN stacks honor bindSocket for the source address but still
        // apply per-UID routing, so the process is bound too, only for the DNS
        // lookup and connect, and then put back exactly as it was. Restoring
        // getActiveNetwork() instead would pin the whole app to the VPN.
        Network previous = manager.getBoundNetworkForProcess();
        Socket socket = new Socket();
        try {
          manager.bindProcessToNetwork(network);
          InetAddress target = null;
          for (InetAddress address : network.getAllByName(host)) {
            if (address instanceof java.net.Inet4Address) {
              target = address;
              break;
            }
          }
          if (target == null) target = network.getAllByName(host)[0];
          network.bindSocket(socket);
          socket.connect(new InetSocketAddress(target, port), CONNECT_TIMEOUT);
          return socket;
        } catch (IOException bindFailure) {
          // The saved Network handle can go stale after Wi-Fi roaming; fall
          // back to default routing below rather than failing the session.
          try {
            socket.close();
          } catch (IOException ignored) {
            // Nothing was connected.
          }
        } finally {
          manager.bindProcessToNetwork(previous);
        }
      }
      return connectDefault(host, port);
    }

    private static Socket connectDefault(String host, int port) throws IOException {
      Socket socket = new Socket();
      try {
        socket.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT);
        return socket;
      } catch (IOException error) {
        try {
          socket.close();
        } catch (IOException ignored) {
          // Nothing was connected.
        }
        throw error;
      }
    }

    @Override
    public InputStream getInputStream(Socket socket) throws IOException {
      return socket.getInputStream();
    }

    @Override
    public OutputStream getOutputStream(Socket socket) throws IOException {
      return socket.getOutputStream();
    }
  }

  @JavascriptInterface
  public synchronized String addStudioMemory(String content) {
    try {
      String text = content == null ? "" : content.trim();
      if (text.isEmpty() || text.length() > 500) throw new IllegalArgumentException("记忆内容须为 1–500 字");
      JSONArray memories = store.studioMemories();
      if (memories.length() >= 50) throw new IllegalArgumentException("最多保存 50 条记忆，请先整理旧记忆");
      JSONObject memory = new JSONObject();
      memory.put("id", java.util.UUID.randomUUID().toString());
      memory.put("content", text);
      memory.put("createdAt", now());
      memories.put(memory);
      store.saveStudioMemories(memories);
      return success(new JSONObject().put("memory", memory));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public synchronized String deleteStudioMemory(String id) {
    try {
      JSONArray memories = store.studioMemories();
      JSONArray remaining = new JSONArray();
      boolean found = false;
      for (int i = 0; i < memories.length(); i++) {
        JSONObject memory = memories.getJSONObject(i);
        if (memory.optString("id").equals(id)) found = true;
        else remaining.put(memory);
      }
      if (!found) throw new IllegalArgumentException("记忆不存在或已删除");
      store.saveStudioMemories(remaining);
      return success(new JSONObject());
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String beginDiscoverTasks(int machineId) {
    try {
      int operationId = store.nextId();
      JSONObject operation = registerOperation(operationId, "discovery", "正在发现员工…");
      startWorker("agent-bridge-discover-" + operationId, () -> discoverTasksOperation(machineId, operationId));
      return success(new JSONObject().put("operation", operation));
    } catch (Exception error) {
      return failure(error);
    }
  }

  void discoverTasksOperation(int machineId, int operationId) {
    try {
      updateOperation(operationId, "discovery", "正在发现员工…", "");
      JSONObject result = new JSONObject(discoverTasks(machineId));
      if (!result.optBoolean("ok")) {
        throw new IllegalArgumentException(result.optString("error", "发现员工失败"));
      }
      updateOperation(operationId, "succeeded", "发现员工完成", "");
      activity.showTaskNotification("Agent Bridge", "发现员工完成");
    } catch (Exception error) {
      String message = error.getMessage() == null ? "发现员工失败" : "发现员工失败：" + error.getMessage();
      try {
        updateOperation(operationId, "failed", message, "");
      } catch (Exception ignored) {
        // The web layer may already have cleared this operation.
      }
      try {
        activity.showTaskNotification("Agent Bridge", message);
      } catch (Exception ignored) {
        // The activity can disappear during a background operation.
      }
    }
  }

  @JavascriptInterface
  public String beginStudioReport(String date) {
    try {
      int operationId = store.nextId();
      JSONObject operation = registerOperation(operationId, "report", "正在生成任务规划…");
      startWorker("agent-bridge-report-" + operationId, () -> studioReportOperation(date, operationId));
      return success(new JSONObject().put("operation", operation));
    } catch (Exception error) {
      return failure(error);
    }
  }

  void studioReportOperation(String date, int operationId) {
    try {
      updateOperation(operationId, "report", "正在生成任务规划…", "");
      JSONObject result = new JSONObject(generateStudioReport(date));
      if (!result.optBoolean("ok")) {
        throw new IllegalArgumentException(result.optString("error", "任务规划生成失败"));
      }
      JSONObject studio = result.optJSONObject("data");
      updateOperation(operationId, "succeeded", "任务规划已生成", "", studio);
      activity.showTaskNotification("Agent Bridge", "任务规划已生成");
    } catch (Exception error) {
      String message = error.getMessage() == null
          ? error.getClass().getSimpleName() : error.getMessage();
      try {
        updateOperation(operationId, "failed", message, "");
      } catch (Exception ignored) {
        // The web layer may already have cleared this operation.
      }
      try {
        activity.showTaskNotification("Agent Bridge", "任务规划生成失败");
      } catch (Exception ignored) {
        // The activity can disappear during a background operation.
      }
    }
  }

  @JavascriptInterface
  public String networkStatus(int machineId) {
    try {
      return success(networkStatusForMachine(machineId));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String saveFrpServer(String payload) {
    try {
      JSONObject input = new JSONObject(payload);
      String host = requiredText(input, "host", "公网机器地址不能为空");
      String username = requiredText(input, "username", "公网机器 SSH 用户不能为空");
      String publicAddress = requiredText(input, "publicAddress", "FRP 公网地址不能为空");
      int sshPort = Math.max(1, Math.min(65_535, input.optInt("port", 22)));
      int bindPort = Math.max(1024, Math.min(65_535, input.optInt("bindPort", 7001)));
      String version = input.optString("version", "0.61.1").trim();
      String downloadBase = input.optString("downloadBase", "https://github.com/fatedier/frp/releases/download").trim();
      while (downloadBase.endsWith("/")) downloadBase = downloadBase.substring(0, downloadBase.length() - 1);
      JSONObject savedServer = store.frpServer();
      boolean keptVersion = savedServer != null && version.equals(savedServer.optString("version"));
      // A version saved by an older release stays usable where FRP is already
      // installed; the installer refuses only if it actually has to download.
      if (!FrpInstallSupport.isSupportedVersion(version) && !keptVersion) {
        throw new IllegalArgumentException("FRP 版本只能选内置校验值的版本："
            + String.join("、", FrpInstallSupport.supportedVersions()));
      }
      // The base is spliced into an installer script; allow only a plain HTTPS URL.
      // Prefix mirrors such as https://mirror.example/https://github.com/... are allowed.
      // One flat character class after the host: no nested quantifiers to backtrack on.
      if (downloadBase.length() > 300
          || !downloadBase.matches("https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:/[A-Za-z0-9._~%+:@=/-]*)?")) {
        throw new IllegalArgumentException("下载源必须是 https:// 开头的普通地址，不能带空格、引号或查询参数");
      }
      boolean keyAuth = "key".equals(input.optString("authType"));

      JSONObject oldServer = store.frpServer();
      int machineId = input.optInt("machineId", oldServer == null ? 0 : oldServer.optInt("machineId"));
      JSONObject machine;
      if (machineId > 0) {
        machine = store.machine(machineId);
      } else {
        machine = new JSONObject();
        machine.put("id", store.nextId());
        machine.put("lastStatus", "unknown");
      }
      String password = keepCredential(input.optString("password", ""), machineId > 0 ? machine : null, "password");
      String privateKey = keepCredential(input.optString("privateKey", ""), machineId > 0 ? machine : null, "privateKey");
      if (keyAuth && privateKey.trim().isEmpty()) {
        throw new IllegalArgumentException("公网机器 SSH 私钥不能为空");
      }
      if (!keyAuth && password.trim().isEmpty()) {
        throw new IllegalArgumentException("公网机器 SSH 密码不能为空");
      }
      machine.put("name", input.optString("name", "Public Entry"))
          .put("host", host)
          .put("port", sshPort)
          .put("username", username)
          .put("authType", keyAuth ? "key" : "password")
          .put("password", keyAuth ? "" : password)
          .put("privateKey", keyAuth ? privateKey : "")
          .put("publicMode", "off")
          .put("updatedAt", now());
      if (!machine.has("os")) machine.put("os", "unknown");
      if (!machine.has("tools")) machine.put("tools", new JSONArray());
      if (!machine.has("tmuxVersion")) machine.put("tmuxVersion", "");
      if (!machine.has("lastError")) machine.put("lastError", "");
      if (!machine.has("publicMode")) machine.put("publicMode", "off");
      store.updateMachine(machine);

      JSONObject server = oldServer == null ? new JSONObject() : oldServer;
      server.put("machineId", machine.getInt("id"))
          .put("publicAddress", publicAddress)
          .put("bindPort", bindPort)
          .put("version", version)
          .put("downloadBase", downloadBase)
          .put("status", "not_deployed")
          .put("lastError", "")
          .put("updatedAt", now());
      String providedToken = input.optString("existingToken", "").trim();
      if (!providedToken.isEmpty()) {
        server.put("token", providedToken).put("tokenProvided", true);
      } else if (!server.optBoolean("tokenProvided")
          && (!server.has("token") || server.optString("token").length() < 32)) {
        server.put("token", randomToken(32)).put("tokenProvided", false);
      }
      store.saveFrpServer(server);
      return success(new JSONObject()
          .put("frpServer", publicFrpServer(server))
          .put("machine", publicMachine(machine)));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String deployFrpServer() {
    String stage = "检查公网入口";
    try {
      JSONObject server = store.frpServer();
      if (server == null || !server.has("machineId")) throw new IllegalArgumentException("请先配置公网入口");
      JSONObject machine = store.machine(server.getInt("machineId"));
      server.put("status", "deploying").put("lastError", "").put("updatedAt", now());
      store.saveFrpServer(server);
      Session session = null;
      try {
        stage = "连接公网服务器 SSH";
        session = connectDirect(machine);
        stage = "检查已有 FRP 服务与端口";
        JSONObject inspection = inspectFrps(session);
        Set<Integer> usedPorts = readUsedPorts(inspection);
        String existingToken = inspection.optString("token");
        int existingPort = inspection.optInt("bindPort", -1);
        boolean activeManaged = inspection.optBoolean("serviceActive")
            && !existingToken.isEmpty()
            && existingPort > 0
            && usedPorts.contains(existingPort);

        // A previously deployed, healthy agentBridge frps is reused as-is.
        if (activeManaged) {
          server.put("token", existingToken)
              .put("bindPort", existingPort)
              .put("status", "online")
              .put("lastError", "")
              .put("deployment", "reused")
              .put("updatedAt", now());
          store.saveFrpServer(server);
          return success(new JSONObject().put("frpServer", publicFrpServer(server)));
        }

        // Adopt a healthy third-party frps without changing its service,
        // configuration, process, or existing proxies. Adoption requires a
        // readable auth token so the phone never turns an open relay into an
        // agentBridge entry automatically.
        int externalPort = inspection.optInt("externalBindPort", 0);
        String externalToken = inspection.optString("externalToken", "");
        if (externalToken.isEmpty() && server.optBoolean("tokenProvided")) {
          externalToken = server.optString("token", "");
        }
        if (inspection.optBoolean("externalRunning")) {
          if (externalPort < 1 || externalToken.isEmpty() || !usedPorts.contains(externalPort)) {
            throw new IllegalArgumentException("检测到已有 FRP 服务，但无法确认其安全 token 或监听端口；请在高级配置填写该服务的 token 后重试");
          }
          server.put("token", externalToken)
              .put("tokenProvided", true)
              .put("bindPort", externalPort)
              .put("status", "online")
              .put("lastError", "")
              .put("deployment", "adopted-existing")
              .put("updatedAt", now());
          store.saveFrpServer(server);
          return success(new JSONObject().put("frpServer", publicFrpServer(server)));
        }

        if (!existingToken.isEmpty()) server.put("token", existingToken);
        int bindPort = chooseFrpBindPort(server, inspection, usedPorts);
        server.put("bindPort", bindPort)
            .put("deployment", inspection.optBoolean("binaryExists") ? "reused-binary" : "installed")
            .put("updatedAt", now());
        store.saveFrpServer(server);
        // agentBridge only uses STCP, which needs no public port. Allowing
        // just the bind port (already taken by frps itself) means a leaked
        // token cannot be used to open other ports on this server.
        String config = "bindAddr = \"0.0.0.0\"\n"
            + "bindPort = " + bindPort + "\n"
            + "auth.token = " + tomlString(server.getString("token")) + "\n"
            + "transport.tls.force = true\n"
            + "allowPorts = [{ single = " + bindPort + " }]\n";
        stage = "部署公网入口";
        if (inspection.optBoolean("binaryExists")) {
          run(session, buildFrpsServiceEnabler(config, bindPort), 120_000);
        } else {
          run(session, buildFrpsInstaller(server, config), 300_000);
        }
        server.put("status", "online").put("lastError", "").put("updatedAt", now());
        store.saveFrpServer(server);
        return success(new JSONObject().put("frpServer", publicFrpServer(server)));
      } finally {
        disconnect(session);
      }
    } catch (Exception error) {
      error = new IllegalArgumentException(stage + "失败：" + error.getMessage(), error);
      try {
        JSONObject server = store.frpServer();
        if (server != null) {
          server.put("status", "error")
              .put("lastError", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage())
              .put("updatedAt", now());
          store.saveFrpServer(server);
        }
      } catch (Exception ignored) {
        // Keep the original deployment error.
      }
      return failure(error);
    }
  }

  @JavascriptInterface
  public String setMachinePublicMode(int machineId, String mode) {
    try {
      if (!"off".equals(mode) && !"auto".equals(mode) && !"public".equals(mode)) {
        throw new IllegalArgumentException("公网模式必须是 off、auto 或 public");
      }
      if ("auto".equals(mode) || "public".equals(mode)) {
        JSONObject relay = store.frpRelay(machineId);
        if (relay == null || !"online".equals(relay.optString("status"))) {
          throw new IllegalArgumentException("请先部署这台机器的公网中转");
        }
      }
      JSONObject machine = store.patchMachine(machineId, new JSONObject().put("publicMode", mode).put("updatedAt", now()));
      if (machine == null) throw new IllegalArgumentException("机器不存在");
      return success(new JSONObject().put("machine", publicMachine(machine)));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String deployFrpRelay(int machineId) {
    String stage = "检查公网入口";
    try {
      JSONObject server = store.frpServer();
      if (server == null || !"online".equals(server.optString("status"))) {
        throw new IllegalArgumentException("请先部署并启动公网 FRP 入口");
      }
      JSONObject machine = store.machine(machineId);
      if (server.getInt("machineId") == machineId) {
        throw new IllegalArgumentException("公网入口机器不需要配置中转");
      }
      store.patchMachine(machineId, new JSONObject().put("publicAccessError", ""));
      JSONObject relay = store.frpRelay(machineId);

      JSONObject serverMachine = store.machine(server.getInt("machineId"));
      Session targetSession = null;
      Session serverSession = null;
      try {
        stage = "连接目标机器 SSH（首次开通需要可达的 SSH 地址）";
        targetSession = connectDirect(machine);
        stage = "连接公网服务器 SSH";
        serverSession = connectDirect(serverMachine);
        Set<Integer> remoteUsedPorts = readUsedPorts(inspectFrps(serverSession));
        if (relay == null) {
          relay = new JSONObject()
              .put("machineId", machineId)
              .put("proxyName", "asb-machine-" + machineId + "-ssh")
              .put("secretKey", randomToken(24))
              .put("visitorPort", allocateVisitorPort(remoteUsedPorts))
              .put("createdAt", now());
        } else if (!"online".equals(relay.optString("status")) && remoteUsedPorts.contains(relay.getInt("visitorPort"))) {
          // An offline relay's old visitor port may have been taken by another service.
          relay.put("visitorPort", allocateVisitorPort(remoteUsedPorts));
        }
        relay.put("enabled", true)
            .put("status", "deploying")
            .put("lastError", "")
            .put("updatedAt", now());
        store.updateFrpRelay(relay);

        stage = "安装目标机器 FRP 客户端";
        String targetConfig = "serverAddr = " + tomlString(server.getString("publicAddress")) + "\n"
            + "serverPort = " + server.getInt("bindPort") + "\n"
            + "auth.token = " + tomlString(server.getString("token")) + "\n"
            + "transport.tls.enable = true\n\n"
            + "[[proxies]]\n"
            + "name = " + tomlString(relay.getString("proxyName")) + "\n"
            + "type = \"stcp\"\n"
            + "secretKey = " + tomlString(relay.getString("secretKey")) + "\n"
            + "localIP = \"127.0.0.1\"\n"
            + "localPort = 22\n";
        run(targetSession, buildFrpcInstaller(server, relay.getString("proxyName"), targetConfig), 300_000);

        disconnect(serverSession);
        serverSession = null;
        stage = "重新连接公网服务器 SSH";
        serverSession = connectDirect(serverMachine);
        String visitorName = relay.getString("proxyName") + "-visitor";
        String visitorConfig = "serverAddr = \"127.0.0.1\"\n"
            + "serverPort = " + server.getInt("bindPort") + "\n"
            + "auth.token = " + tomlString(server.getString("token")) + "\n"
            + "transport.tls.enable = true\n\n"
            + "[[visitors]]\n"
            + "name = " + tomlString(visitorName) + "\n"
            + "type = \"stcp\"\n"
            + "serverName = " + tomlString(relay.getString("proxyName")) + "\n"
            + "secretKey = " + tomlString(relay.getString("secretKey")) + "\n"
            + "bindAddr = \"127.0.0.1\"\n"
            + "bindPort = " + relay.getInt("visitorPort") + "\n";
        stage = "安装公网中转 visitor";
        run(serverSession, buildFrpVisitorInstaller(server, visitorName, visitorConfig, relay.getInt("visitorPort")), 300_000);

        stage = "验证手机经公网中转连接目标 SSH";
        Session verified = null;
        try {
          verified = connectThroughRelay(machine, server, relay);
          run(verified, "printf 'ASB_RELAY_OK\\n'");
        } finally {
          disconnect(verified);
        }

        relay.put("status", "online").put("enabled", true).put("lastError", "")
            .put("verifiedAt", now()).put("updatedAt", now());
        store.updateFrpRelay(relay);
        JSONObject latest = store.machine(machineId);
        if ("off".equals(latest.optString("publicMode", "off"))) {
          latest = store.patchMachine(machineId, new JSONObject().put("publicMode", "auto").put("updatedAt", now()));
        }
        return success(new JSONObject()
            .put("relay", publicFrpRelay(relay))
            .put("machine", publicMachine(latest)));
      } finally {
        disconnect(targetSession);
        disconnect(serverSession);
      }
    } catch (Exception error) {
      error = new IllegalArgumentException(stage + "失败：" + error.getMessage(), error);
      try {
        store.patchMachine(machineId, new JSONObject().put("publicAccessError", error.getMessage()));
        JSONObject relay = store.frpRelay(machineId);
        if (relay != null) {
          relay.put("status", "error")
              .put("lastError", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage())
              .put("updatedAt", now());
          store.updateFrpRelay(relay);
        }
      } catch (Exception ignored) {
        // Preserve the original deployment failure.
      }
      return failure(error);
    }
  }

  @JavascriptInterface
  public String disableFrpRelay(int machineId) {
    try {
      JSONObject server = store.frpServer();
      JSONObject relay = store.frpRelay(machineId);
      if (server == null || relay == null) throw new IllegalArgumentException("这台机器没有公网中转配置");
      JSONObject machine = store.machine(machineId);
      JSONObject serverMachine = store.machine(server.getInt("machineId"));
      Session targetSession = null;
      Session serverSession = null;
      try {
        serverSession = connectDirect(serverMachine);
        String label = relay.getString("proxyName").replaceAll("[^A-Za-z0-9_.-]+", "-");
        run(serverSession, "systemctl stop asb-frpc-" + label + "-visitor.service 2>/dev/null || true; "
            + "systemctl disable asb-frpc-" + label + "-visitor.service 2>/dev/null || true; "
            + "rm -f /etc/asb-frp/" + shellQuote(label) + "-visitor.toml "
            + "/etc/systemd/system/asb-frpc-" + label + "-visitor.service; systemctl daemon-reload || true", 60_000);
        try {
          targetSession = connectDirect(machine);
          if ("Darwin".equals(machine.optString("os"))) {
            run(targetSession, "launchctl unload \"$HOME/Library/LaunchAgents/com.agent-session-bridge.frpc."
                + label + ".plist\" >/dev/null 2>&1 || true; rm -f \"$HOME/Library/LaunchAgents/com.agent-session-bridge.frpc."
                + label + ".plist\" \"$HOME/.config/agent-session-bridge/frpc.toml\"", 60_000);
          } else {
            run(targetSession, "systemctl --user disable --now asb-frpc.service 2>/dev/null || true; "
                + "sudo systemctl disable --now asb-frpc.service 2>/dev/null || true; "
                + "rm -f \"$HOME/.config/agent-session-bridge/frpc.toml\"", 60_000);
          }
        } catch (Exception ignored) {
          // The target may be outside the LAN. The visitor is already disabled on the public entry.
        }
      } finally {
        disconnect(targetSession);
        disconnect(serverSession);
      }
      relay.put("enabled", false).put("status", "disabled").put("lastError", "").put("updatedAt", now());
      store.updateFrpRelay(relay);
      JSONObject latest = store.patchMachine(machineId, new JSONObject().put("publicMode", "off").put("updatedAt", now()));
      return success(new JSONObject().put("relay", publicFrpRelay(relay))
          .put("machine", publicMachine(latest == null ? machine : latest)));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String beginSendPrompt(int id, String prompt, String actorId) {
    try {
      int operationId = store.nextId();
      JSONObject operation = registerOperation(operationId, "network", "正在检查网络连接…");

      startWorker("agent-bridge-send-" + operationId, () -> {
        try {
          int machineId = store.task(id).getInt("machineId");
          updateOperation(operationId, "network", "正在检查手机到机器的网络…", "");
          JSONObject network = networkStatusForMachine(machineId);
          updateOperation(operationId, "network", network.optBoolean("reachable")
              ? "网络正常 · " + network.optString("summary")
              : "网络不可达 · " + network.optString("summary"), network);
          if (!network.optBoolean("reachable")) {
            throw new IllegalArgumentException("机器网络不可达：" + network.optString("summary"));
          }

          updateOperation(operationId, "agent", "SSH 已可达，正在发送回原会话…", network);
          String raw = sendPrompt(id, prompt, actorId);
          JSONObject result = new JSONObject(raw);
          if (!result.optBoolean("ok")) {
            throw new IllegalArgumentException(result.optString("error", "回复失败"));
          }
          JSONObject data = result.optJSONObject("data");
          JSONObject task = data == null ? null : data.optJSONObject("task");
          boolean stillRunning = data != null && data.optBoolean("stillRunning");
          String done = stillRunning ? "回复已送达，远程仍在处理，稍后点刷新查看结果" : "回复已发送";
          markOperation(operationId, "stillRunning", stillRunning);
          updateOperation(operationId, "succeeded", done, network, task);
          activity.showTaskNotification("Agent Bridge", stillRunning ? done : "后台任务已执行");
        } catch (Exception error) {
          try {
            JSONObject current = operationById(operationId);
            updateOperation(operationId, "failed",
                error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage(),
                current == null ? "" : current.optJSONObject("network"));
            String message = error.getMessage() == null
                ? error.getClass().getSimpleName() : error.getMessage();
            activity.showTaskNotification("Agent Bridge", message);
          } catch (Exception ignored) {
            // The operation may already have been cleared.
          }
        }
      });
      return success(new JSONObject().put("operation", operation));
    } catch (Exception error) {
      return failure(error);
    }
  }

  /** Bridge methods that open SSH connections and must not run on the page's thread. */
  private static final Set<String> BACKGROUND_CALLS = new HashSet<>(Arrays.asList(
      "discoverTasks", "probeMachine", "scanNetwork", "deployFrpServer", "deployFrpRelay", "disableFrpRelay"));

  /**
   * Runs a slow bridge method on a worker thread. A direct call from
   * JavaScript blocks the WebView until it returns, which for an FRP deploy
   * can be minutes of a frozen page. The page polls operationState and reads
   * the method's normal result from "result".
   */
  @JavascriptInterface
  public String beginBridgeCall(String method, String argsJson) {
    try {
      if (!BACKGROUND_CALLS.contains(method)) throw new IllegalArgumentException("不支持后台调用：" + method);
      JSONArray args = new JSONArray(argsJson == null || argsJson.isEmpty() ? "[]" : argsJson);
      int operationId = store.nextId();
      JSONObject operation = registerOperation(operationId, "call", "");
      startWorker("agent-bridge-call-" + operationId, () -> {
        String raw;
        try {
          raw = invokeBackgroundCall(method, args);
        } catch (Exception error) {
          raw = failure(error);
        }
        try {
          // The result must be in place before the state leaves "running";
          // the page reads both on its next poll.
          markOperation(operationId, "result", new JSONObject(raw));
          updateOperation(operationId, "succeeded", "", "");
        } catch (Exception error) {
          Log.w("AgentBridgeNative", "background call result lost: " + method, error);
        }
      });
      return success(new JSONObject().put("operation", operation));
    } catch (Exception error) {
      return failure(error);
    }
  }

  private String invokeBackgroundCall(String method, JSONArray args) throws Exception {
    switch (method) {
      case "discoverTasks": return discoverTasks(args.getInt(0));
      case "probeMachine": return probeMachine(args.getInt(0));
      case "scanNetwork": return scanNetwork(args.optString(0, ""));
      case "deployFrpServer": return deployFrpServer();
      case "deployFrpRelay": return deployFrpRelay(args.getInt(0));
      case "disableFrpRelay": return disableFrpRelay(args.getInt(0));
      default: throw new IllegalArgumentException("不支持后台调用：" + method);
    }
  }

  /** Forgets a machine's pinned SSH host key after the user confirms the server was reinstalled. */
  @JavascriptInterface
  public String resetHostKey(int machineId) {
    try {
      store.forgetHostKey(store.machine(machineId));
      return success(new JSONObject());
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String operationState(int id) {
    try {
      JSONObject operation = operationById(id);
      if (operation == null) throw new IllegalArgumentException("发送任务不存在");
      return success(new JSONObject().put("operation", operation));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String clearOperation(int id) {
    synchronized (operations) {
      operations.remove(id);
    }
    return success(new JSONObject());
  }

  @JavascriptInterface
  public String saveMachine(String payload) {
    try {
      JSONObject input = new JSONObject(payload);
      String name = requiredText(input, "name", "机器名称不能为空");
      String host = requiredText(input, "host", "SSH 地址不能为空");
      String username = requiredText(input, "username", "SSH 用户不能为空");
      int port = Math.max(1, Math.min(65_535, input.optInt("port", 22)));
      String authType = "key".equals(input.optString("authType")) ? "key" : "password";

      JSONArray machines = store.machines();
      int id = input.optInt("id", 0);
      JSONObject machine = null;
      if (id > 0) {
        for (int index = 0; index < machines.length(); index += 1) {
          JSONObject item = machines.getJSONObject(index);
          if (item.getInt("id") == id) {
            machine = item;
            break;
          }
        }
      }
      // The page never receives stored credentials, so an empty field on an
      // existing machine means "keep what is saved".
      String password = keepCredential(input.optString("password", ""), machine, "password");
      String privateKey = keepCredential(input.optString("privateKey", ""), machine, "privateKey");
      if ("password".equals(authType) && password.trim().isEmpty()) {
        throw new IllegalArgumentException("SSH 密码不能为空");
      }
      if ("key".equals(authType) && privateKey.trim().isEmpty()) {
        throw new IllegalArgumentException("SSH 私钥内容不能为空");
      }
      if ("password".equals(authType)) privateKey = "";
      else password = "";
      if (machine == null) {
        machine = new JSONObject();
        machine.put("id", store.nextId());
        machine.put("lastStatus", "unknown");
      }
      machine.put("name", name)
          .put("host", host)
          .put("port", port)
          .put("username", username)
          .put("authType", authType)
          .put("password", password)
          .put("privateKey", privateKey)
          .put("updatedAt", now());
      if (!machine.has("os")) machine.put("os", "unknown");
      if (!machine.has("tools")) machine.put("tools", new JSONArray());
      if (!machine.has("tmuxVersion")) machine.put("tmuxVersion", "");
      if (!machine.has("lastError")) machine.put("lastError", "");
      store.updateMachine(machine);
      return success(new JSONObject().put("machine", publicMachine(machine)));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String deleteMachine(int id) {
    try {
      store.deleteMachine(id);
      return success(new JSONObject());
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String scanNetwork(String prefixOrAddress) {
    String prefix = normalizePrefix(prefixOrAddress);
    if (prefix == null) prefix = networkHint();
    if (prefix == null) return failure(new IllegalArgumentException("无法识别手机所在网段，请输入类似 192.168.1"));

    ExecutorService executor = Executors.newFixedThreadPool(64);
    List<Future<String>> futures = new ArrayList<>();
    for (int host = 1; host <= 254; host += 1) {
      final String address = prefix + "." + host;
      futures.add(executor.submit(() -> {
        try (Socket socket = new Socket()) {
          socket.connect(new InetSocketAddress(address, 22), 260);
          return address;
        } catch (Exception ignored) {
          return null;
        }
      }));
    }
    executor.shutdown();
    try {
      executor.awaitTermination(4, TimeUnit.SECONDS);
    } catch (InterruptedException ignored) {
      Thread.currentThread().interrupt();
    }
    JSONArray found = new JSONArray();
    for (Future<String> future : futures) {
      try {
        String value = future.get();
        if (value != null) found.put(value);
      } catch (Exception ignored) {
        // A single failed probe is not fatal.
      }
    }
    try {
      return success(new JSONObject().put("prefix", prefix).put("hosts", found));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String probeMachine(int id) {
    try {
      JSONObject machine = store.machine(id);
      Session session = null;
      try {
        session = connect(machine);
        JSONObject updated = store.patchMachine(id, onlineFields(probe(session)));
        return success(new JSONObject().put("machine", publicMachine(updated == null ? machine : updated)));
      } finally {
        disconnect(session);
      }
    } catch (Exception error) {
      markOffline(id, error);
      return failure(error);
    }
  }

  @JavascriptInterface
  public String discoverTasks(int machineId) {
    try {
      JSONObject machine = store.machine(machineId);
      Session session = null;
      try {
        session = connect(machine);
        JSONObject probe = probe(session);
        JSONObject updated = store.patchMachine(machineId, onlineFields(probe));
        if (updated != null) machine = updated;

        JSONArray discovered = new JSONArray();
        Set<Integer> tmuxShellPids = new HashSet<>();
        if (!probe.optString("tmuxVersion").isEmpty()) {
          List<JSONObject> panes = listTmuxTasks(session, machineId, tmuxShellPids);
          for (JSONObject pane : panes) discovered.put(pane);
        }
        Log.d("AgentBridgeNative", "discovery stage=process begin machine=" + machineId);
        List<JSONObject> processTasks = listProcessTasks(session, machineId, tmuxShellPids);
        Log.d("AgentBridgeNative", "discovery stage=codex-desktop begin machine=" + machineId);
        List<JSONObject> codexDesktopTasks = listCodexDesktopTasks(session, machineId);
        Log.d("AgentBridgeNative", "discovery stage=merge machine=" + machineId);
        Set<String> desktopThreadIds = new HashSet<>();
        for (JSONObject task : codexDesktopTasks) desktopThreadIds.add(task.optString("externalSessionId"));
        for (JSONObject task : processTasks) {
          if ("codex".equals(task.optString("agentType"))
              && desktopThreadIds.contains(task.optString("externalSessionId"))) continue;
          discovered.put(task);
        }
        for (JSONObject task : codexDesktopTasks) discovered.put(task);
        discovered = withoutDeletedTasks(discovered);
        Log.d("AgentBridgeNative", "discovered machine=" + machineId
            + " tmux=" + (probe.optString("tmuxVersion").isEmpty() ? 0 : 1)
            + " total=" + discovered.length());
        preserveCustomTitles(machineId, discovered);
        discovered = dedupeSemanticTasks(discovered);
        store.replaceTasksForMachine(machineId, discovered);
        return success(new JSONObject().put("machine", publicMachine(machine)).put("tasks", discovered));
      } finally {
        disconnect(session);
      }
    } catch (Exception error) {
      Log.e("AgentBridgeNative", "discover failed machine=" + machineId, error);
      markOffline(machineId, error);
      return failure(error);
    }
  }

  @JavascriptInterface
  public String renameTask(int id, String title) {
    try {
      String value = title == null ? "" : title.trim().replaceAll("\\s+", " ");
      if (value.isEmpty() || value.length() > 160) throw new IllegalArgumentException("任务名称不能为空，且最多 160 字。");
      JSONObject task = store.task(id);
      task.put("customTitle", value).put("title", value).put("updatedAt", now());
      store.updateTask(task);
      return success(new JSONObject().put("task", task));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String deleteTask(int id) {
    try {
      store.deleteTask(id);
      return success(new JSONObject()
          .put("tasks", store.tasks())
          .put("deletedTasks", store.deletedTasks()));
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String restoreDeletedTask(int id) {
    try {
      store.restoreDeletedTask(id);
      return success(new JSONObject()
          .put("tasks", store.tasks())
          .put("deletedTasks", store.deletedTasks()));
    } catch (Exception error) {
      return failure(error);
    }
  }

  private JSONArray withoutDeletedTasks(JSONArray discovered) throws Exception {
    JSONArray visible = new JSONArray();
    for (int index = 0; index < discovered.length(); index += 1) {
      JSONObject task = discovered.getJSONObject(index);
      if (!store.isDeletedTask(task)) visible.put(task);
    }
    return visible;
  }

  private JSONArray dedupeSemanticTasks(JSONArray discovered) throws Exception {
    Map<String, JSONObject> bestByKey = new HashMap<>();
    JSONArray result = new JSONArray();
    for (int index = 0; index < discovered.length(); index += 1) {
      JSONObject task = discovered.getJSONObject(index);
      String title = task.optString("title", "").trim().replaceAll("\\s+", " ");
      String workspace = task.optString("workspacePath", "").trim();
      String key = task.getInt("machineId") + "|" + task.optString("agentType", "")
          + "|" + title.toLowerCase(java.util.Locale.ROOT) + "|" + workspace;
      JSONObject old = bestByKey.get(key);
      if (old == null || preferSemanticTask(task, old)) {
        if (old != null) {
          for (int resultIndex = 0; resultIndex < result.length(); resultIndex += 1) {
            if (result.get(resultIndex) == old) {
              result.remove(resultIndex);
              break;
            }
          }
        }
        bestByKey.put(key, task);
        result.put(task);
      }
    }
    return result;
  }

  private boolean preferSemanticTask(JSONObject candidate, JSONObject old) {
    int candidateScore = semanticTaskScore(candidate);
    int oldScore = semanticTaskScore(old);
    if (candidateScore != oldScore) return candidateScore > oldScore;
    return taskTime(candidate) > taskTime(old);
  }

  private int semanticTaskScore(JSONObject task) {
    int score = 0;
    if (!task.optString("requiredInput", "").trim().isEmpty()) score += 8;
    if ("running".equals(task.optString("status"))) score += 4;
    if (!task.optString("customTitle", "").trim().isEmpty()) score += 2;
    if (!task.optString("workSummary", "").trim().isEmpty()) score += 1;
    return score;
  }

  private long taskTime(JSONObject task) {
    String value = task.optString("lastActiveAt", "");
    if (value.isEmpty()) value = task.optString("updatedAt", "");
    try {
      return java.time.Instant.parse(value).toEpochMilli();
    } catch (Exception ignored) {
      return 0;
    }
  }

  @JavascriptInterface
  public String beginTailTask(int taskId) {
    try {
      JSONObject task = store.task(taskId);
      int operationId = store.nextId();
      JSONObject operation = registerOperation(operationId, "tail", "正在刷新任务输出…", new JSONObject()
          .put("taskId", taskId)
          .put("stableKey", task.optString("stableKey", ""))
          .put("machineId", task.getInt("machineId")));
      startWorker("agent-bridge-tail-" + operationId, () -> tailTaskOperation(taskId, operationId));
      return success(new JSONObject().put("operation", operation));
    } catch (Exception error) {
      return failure(error);
    }
  }

  void tailTaskOperation(int taskId, int operationId) {
    try {
      updateOperation(operationId, "tail", "正在刷新任务输出…", "");
      JSONObject result = new JSONObject(tailTask(taskId));
      if (!result.optBoolean("ok")) {
        throw new IllegalArgumentException(result.optString("error", "刷新任务输出失败"));
      }
      updateOperation(operationId, "succeeded", "任务输出已刷新", "");
      activity.showTaskNotification("Agent Bridge", "任务输出已刷新");
    } catch (Exception error) {
      String message = error.getMessage() == null
          ? error.getClass().getSimpleName() : error.getMessage();
      try {
        updateOperation(operationId, "failed", message, "");
      } catch (Exception ignored) {
        // The web layer may already have cleared this operation.
      }
      try {
        activity.showTaskNotification("Agent Bridge", message);
      } catch (Exception ignored) {
        // The activity can disappear during a background operation.
      }
    }
  }

  @JavascriptInterface
  public String tailTask(int id) {
    try {
      JSONObject task = store.task(id);
      JSONObject machine = store.machine(task.getInt("machineId"));
      if ("process".equals(task.optString("controlMode"))) {
        return discoverTasks(machine.getInt("id"));
      }
      Session session = null;
      try {
        session = connect(machine);
        String output = sanitize(run(session, "tmux capture-pane -p -S -180 -t " + shellQuote(task.getString("paneId"))));
        JSONObject fields = new JSONObject().put("lastOutput", output).put("updatedAt", now());
        if ("missing".equals(task.optString("status"))) fields.put("status", "running");
        JSONObject updated = store.patchTask(id, fields);
        return success(new JSONObject().put("task", updated == null ? task : updated));
      } finally {
        disconnect(session);
      }
    } catch (Exception error) {
      return failure(error);
    }
  }

  @JavascriptInterface
  public String sendPrompt(int id, String prompt, String actorId) {
    try {
      String value = prompt == null ? "" : prompt.trim();
      if (value.isEmpty() || value.length() > 12_000) throw new IllegalArgumentException("回复不能为空，且最多 12000 字。");
      JSONObject task = store.task(id);
      JSONObject machine = store.machine(task.getInt("machineId"));
      String controlMode = task.optString("controlMode", "tmux");
      Session session = null;
      try {
        session = connect(machine);
        if ("process".equals(controlMode)) {
          String sessionId = task.optString("externalSessionId", "");
          if (sessionId.isEmpty()) throw new IllegalArgumentException("没有找到该进程的会话 ID，暂不能回复。");
          String command;
          // "--" ends option parsing: a reply such as "-v 看下" must reach the
          // agent as text, not be read as a CLI flag (claude would print its
          // version, codex would reject the arguments).
          if ("codex".equals(task.optString("agentType"))) {
            command = "cd " + shellQuote(task.getString("workspacePath"))
                + " && { codex_bin='/Applications/ChatGPT.app/Contents/Resources/codex'; "
                + "if [ ! -x \"$codex_bin\" ]; then codex_bin=\"$HOME/.codex/plugins/.plugin-appserver/codex\"; fi; "
                + "if [ ! -x \"$codex_bin\" ]; then codex_bin=$(command -v codex); fi; "
                + "thread=" + shellQuote(sessionId) + " message=" + shellQuote(value) + "; "
                + "err=$(mktemp); trap 'rm -f \"$err\"' EXIT; "
                + "if \"$codex_bin\" exec resume --skip-git-repo-check -- \"$thread\" \"$message\" 2>\"$err\"; then exit 0; fi; "
                + "if grep -Eq 'thread-store conflict|already has an active writer' \"$err\"; then "
                + "printf '__ASB_CODEX_QUEUED__\\n'; cat \"$err\" >&2; "
                + "\"$codex_bin\" queue --thread=\"$thread\" --message=\"$message\"; exit $?; fi; "
                + "cat \"$err\" >&2; exit 1; }";
          } else if ("claude-code".equals(task.optString("agentType"))) {
            command = "cd " + shellQuote(task.getString("workspacePath"))
                + " && claude --resume "
                + shellQuote(sessionId) + " --print -- " + shellQuote(value);
          } else {
            throw new IllegalArgumentException("暂不支持回复 " + task.optString("agentType"));
          }
          ReplyOutcome outcome = runReply(session, command);
          JSONObject fields = new JSONObject()
              .put("requiredInput", "")
              .put("suggestedReply", "")
              .put("updatedAt", now());
          if (outcome.finished) {
            fields.put("lastOutput", "回复执行完成：\n" + outcome.output)
                .put("status", outcome.output.contains("__ASB_CODEX_QUEUED__") ? "running" : "idle");
          } else {
            fields.put("lastOutput", "回复已送达，远程仍在处理（手机等了 " + (REPLY_WAIT_MS / 1000) + " 秒）。"
                + "请稍后点刷新查看结果，不要重复发送。" + (outcome.output.isEmpty() ? "" : "\n\n目前的输出：\n" + outcome.output))
                .put("status", "running");
          }
          JSONObject updated = store.patchTask(id, fields);
          return success(new JSONObject()
              .put("task", updated == null ? task : updated)
              .put("stillRunning", !outcome.finished));
        }

        String paneId = shellQuote(task.getString("paneId"));
        run(session, "tmux send-keys -t " + paneId + " -l -- " + shellQuote(value));
        run(session, "tmux send-keys -t " + paneId + " Enter");
        return tailTask(id);
      } finally {
        disconnect(session);
      }
    } catch (Exception error) {
      return failure(error);
    }
  }

  private static final int REPLY_WAIT_MS = 180_000;

  /** The reply command ran to the end and exited non-zero. */
  private static final class ReplyFailed extends IllegalArgumentException {
    ReplyFailed(String message) {
      super(message);
    }
  }

  private static final class ReplyOutcome {
    final boolean finished;
    final String output;

    ReplyOutcome(boolean finished, String output) {
      this.finished = finished;
      this.output = output;
    }
  }

  /**
   * Starts the reply detached from this SSH channel and waits for it. Once it
   * has started, running out of patience or losing the connection is not a
   * failure: the agent is still working, and reporting failure would only make
   * the user send the same reply twice.
   */
  private ReplyOutcome runReply(Session session, String command) throws Exception {
    String log = RemoteReply.requireLogPath(run(session, RemoteReply.start(command), 30_000));
    long deadline = System.currentTimeMillis() + REPLY_WAIT_MS;
    String content = "";
    try {
      while (true) {
        content = run(session, RemoteReply.poll(log), 30_000);
        Integer exit = RemoteReply.exitCode(content);
        if (exit != null) {
          try {
            run(session, RemoteReply.cleanup(log), 15_000);
          } catch (Exception ignored) {
            // A leftover log in the remote temp directory is harmless.
          }
          String output = RemoteReply.output(content);
          if (output.length() > MAX_OUTPUT) output = output.substring(output.length() - MAX_OUTPUT);
          if (exit != 0) throw new ReplyFailed(friendlyRemoteError(output, exit, ""));
          return new ReplyOutcome(true, output);
        }
        if (System.currentTimeMillis() >= deadline) break;
        Thread.sleep(2_000);
      }
    } catch (ReplyFailed finishedWithError) {
      throw finishedWithError;
    } catch (Exception waitError) {
      // Includes run()'s own errors for a dropped SSH session while polling.
      Log.w("AgentBridgeNative", "stopped waiting for a started reply", waitError);
    }
    return new ReplyOutcome(false, RemoteReply.output(content));
  }

  private Session connect(JSONObject machine) throws Exception {
    try {
      String mode = machine.optString("publicMode", "off");
      Session session;
      if ("public".equals(mode)) session = connectThroughRelay(machine);
      else if ("auto".equals(mode) && !directReachable(machine)) session = connectThroughRelay(machine);
      else session = connectDirect(machine);
      activity.noteNetworkAlive();
      return session;
    } catch (Exception error) {
      String message = String.valueOf(error);
      // Only ENONET says this process has no usable network. A timeout or an
      // unknown host is about the remote machine or its name, not the phone.
      if (message.contains("ENONET")) activity.noteNetworkDeath();
      if (message.contains("HostKey has been changed")) {
        throw new IllegalArgumentException("「" + machine.optString("name") + "」的 SSH 主机指纹和上次不一致，已拒绝连接。"
            + "如果你重装或更换了这台机器，在办公室菜单里点「重置主机指纹」后重试；否则可能有人在冒充它。", error);
      }
      throw error;
    }
  }

  private Session connectDirect(JSONObject machine) throws Exception {
    JSch jsch = new JSch();
    String username = machine.getString("username");
    String host = machine.getString("host");
    int port = machine.getInt("port");
    Session session = jsch.getSession(username, host, port);
    session.setSocketFactory(new DirectNetworkSocketFactory(activity));
    if ("key".equals(machine.optString("authType"))) {
      byte[] key = machine.getString("privateKey").getBytes(StandardCharsets.UTF_8);
      jsch.addIdentity("phone-key", key, null, null);
    } else {
      session.setPassword(machine.getString("password"));
      session.setUserInfo(new BridgeUserInfo(machine.getString("password")));
    }
    session.setConfig("StrictHostKeyChecking", "yes");
    session.setHostKeyRepository(store.hostKeyRepository());
    session.setConfig("PreferredAuthentications", "key".equals(machine.optString("authType"))
        ? "publickey" : "password,keyboard-interactive");
    session.setConfig("HashKnownHosts", "no");
    if (!machine.optString("hostKeyAlias").isEmpty()) session.setHostKeyAlias(machine.optString("hostKeyAlias"));
    session.setServerAliveInterval(15_000);
    session.setServerAliveCountMax(3);
    session.connect(CONNECT_TIMEOUT);
    return session;
  }

  private Session connectThroughRelay(JSONObject machine) throws Exception {
    JSONObject server = store.frpServer();
    if (server == null || !"online".equals(server.optString("status"))) {
      throw new IllegalArgumentException("公网 FRP 入口未在线");
    }
    JSONObject relay = store.frpRelay(machine.getInt("id"));
    if (relay == null || !"online".equals(relay.optString("status")) || !relay.optBoolean("enabled")) {
      throw new IllegalArgumentException("这台机器的公网中转未启用");
    }
    return connectThroughRelay(machine, server, relay);
  }

  private Session connectThroughRelay(JSONObject machine, JSONObject server, JSONObject relay) throws Exception {
    JSONObject serverMachine = store.machine(server.getInt("machineId"));
    Session bastion = connectDirect(serverMachine);
    try {
      int localPort = bastion.setPortForwardingL(0, "127.0.0.1", relay.getInt("visitorPort"));
      if (localPort <= 0) throw new IllegalArgumentException("无法创建公网 SSH 本地转发");
      JSONObject tunnelTarget = new JSONObject(machine.toString());
      tunnelTarget.put("host", "127.0.0.1")
          .put("port", localPort)
          .put("publicMode", "off")
          .put("hostKeyAlias", machine.getInt("port") == 22 ? machine.getString("host")
              : "[" + machine.getString("host") + "]:" + machine.getInt("port"));
      Session target = connectDirect(tunnelTarget);
      synchronized (relayBastionSessions) {
        relayBastionSessions.put(target, bastion);
      }
      return target;
    } catch (Exception error) {
      disconnect(bastion);
      throw error;
    }
  }

  private boolean directReachable(JSONObject machine) {
    try (Socket socket = new Socket()) {
      socket.connect(new InetSocketAddress(machine.getString("host"), machine.getInt("port")), 1_200);
      return socket.isConnected();
    } catch (Exception error) {
      return false;
    }
  }

  private void disconnect(Session session) {
    if (session == null) return;
    Session bastion;
    synchronized (relayBastionSessions) {
      bastion = relayBastionSessions.remove(session);
    }
    try {
      session.disconnect();
    } finally {
      if (bastion != null) bastion.disconnect();
    }
  }

  /** A machine as the page sees it: never the password or key, only whether one is saved. */
  private static JSONObject publicMachine(JSONObject machine) throws Exception {
    JSONObject result = new JSONObject(machine.toString());
    result.put("hasPassword", !machine.optString("password").isEmpty())
        .put("hasPrivateKey", !machine.optString("privateKey").isEmpty());
    result.remove("password");
    result.remove("privateKey");
    return result;
  }

  private static JSONArray publicMachines(JSONArray machines) throws Exception {
    JSONArray result = new JSONArray();
    for (int index = 0; index < machines.length(); index += 1) result.put(publicMachine(machines.getJSONObject(index)));
    return result;
  }

  private static String keepCredential(String entered, JSONObject existing, String key) {
    if (!entered.trim().isEmpty() || existing == null) return entered;
    return existing.optString(key, "");
  }

  private JSONObject onlineFields(JSONObject probe) throws Exception {
    return new JSONObject()
        .put("os", probe.optString("os"))
        .put("tools", probe.getJSONArray("tools"))
        .put("tmuxVersion", probe.optString("tmuxVersion"))
        .put("lastStatus", "online")
        .put("lastError", "")
        .put("lastCheckedAt", now())
        .put("updatedAt", now());
  }

  private JSONObject publicFrpServer() throws Exception {
    JSONObject server = store.frpServer();
    return server == null ? null : publicFrpServer(server);
  }

  private JSONObject publicFrpServer(JSONObject server) throws Exception {
    JSONObject result = new JSONObject(server.toString());
    result.remove("token");
    return result;
  }

  private JSONArray publicFrpRelays() throws Exception {
    JSONArray result = new JSONArray();
    JSONArray relays = store.frpRelays();
    for (int index = 0; index < relays.length(); index += 1) {
      result.put(publicFrpRelay(relays.getJSONObject(index)));
    }
    return result;
  }

  private JSONObject publicFrpRelay(JSONObject relay) throws Exception {
    JSONObject result = new JSONObject(relay.toString());
    result.remove("secretKey");
    return result;
  }

  private String randomToken(int bytes) {
    byte[] value = new byte[bytes];
    secureRandom.nextBytes(value);
    return Base64.encodeToString(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
  }

  private int allocateVisitorPort(Set<Integer> usedPorts) {
    while (true) {
      int port = 22_000 + secureRandom.nextInt(10_000);
      if (usedPorts.add(port)) return port;
    }
  }

  private String tomlString(String value) {
    return JSONObject.quote(value);
  }

  private String frpArchiveUrl(JSONObject server, String target) {
    return server.optString("downloadBase") + "/v" + server.optString("version")
        + "/frp_" + server.optString("version") + "_" + target + ".tar.gz";
  }

  private JSONObject inspectFrps(Session session) throws Exception {
    String output = run(session, "printf 'ASB_CONFIG='; "
        + "if [ -r /etc/asb-frp/frps.toml ]; then base64 -w0 /etc/asb-frp/frps.toml; fi; printf '\\n'; "
        + "printf 'ASB_SERVICE='; "
        + "if command -v systemctl >/dev/null 2>&1; then systemctl is-active asb-frps 2>/dev/null || true; else echo inactive; fi; "
        + "printf 'ASB_BINARY='; [ -x /opt/asb-frp/bin/frps ] && echo yes || echo no; "
        + "printf 'ASB_EXTERNAL_PID='; pid=$(pgrep -x frps 2>/dev/null | head -n 1); printf '%s\\n' \"$pid\"; "
        + "if [ -n \"$pid\" ]; then "
        + "printf 'ASB_EXTERNAL_ARGS='; base64 -w0 \"/proc/$pid/cmdline\" 2>/dev/null || true; printf '\\n'; "
        + "args=$(tr '\\0' '\\n' < \"/proc/$pid/cmdline\" 2>/dev/null || true); "
        + "config=$(printf '%s\\n' \"$args\" | awk 'prev==\"-c\" || prev==\"--config\" || prev==\"--config.file\" {print; exit} $0 ~ /^--config=/ {print substr($0, index($0, \"=\") + 1); exit} {prev=$0}'); "
        + "if [ -n \"$config\" ]; then case \"$config\" in /*) ;; *) config=$(readlink -f \"/proc/$pid/cwd/$config\" 2>/dev/null || true);; esac; fi; "
        + "printf 'ASB_EXTERNAL_CONFIG='; if [ -n \"$config\" ] && [ -r \"$config\" ]; then base64 -w0 \"$config\"; fi; printf '\\n'; "
        + "fi; "
        + "printf 'ASB_PORTS\\n'; ss -ltnp 2>/dev/null || true", 30_000);
    JSONObject result = new JSONObject()
        .put("serviceActive", "active".equals(firstMatch(output, "(?m)^ASB_SERVICE=(.*)$")))
        .put("binaryExists", "yes".equals(firstMatch(output, "(?m)^ASB_BINARY=(.*)$")))
        .put("usedPorts", new JSONArray());
    String encodedConfig = firstMatch(output, "(?m)^ASB_CONFIG=(.*)$");
    if (!encodedConfig.isEmpty()) {
      String config = new String(Base64.decode(encodedConfig, Base64.DEFAULT), StandardCharsets.UTF_8);
      Matcher bindPort = Pattern.compile("(?m)^bindPort\\s*=\\s*([0-9]+)\\s*$").matcher(config);
      Matcher token = Pattern.compile("(?m)^auth\\.token\\s*=\\s*\"([^\"]+)\"\\s*$").matcher(config);
      if (bindPort.find()) result.put("bindPort", Integer.parseInt(bindPort.group(1)));
      if (token.find()) result.put("token", token.group(1));
    }
    applyExternalFrps(result, output);

    JSONArray used = result.getJSONArray("usedPorts");
    String portsBlock = output.contains("ASB_PORTS")
        ? output.substring(output.indexOf("ASB_PORTS") + "ASB_PORTS".length())
        : "";
    for (String line : portsBlock.split("\\n")) {
      Matcher address = Pattern.compile("\\s(?:[0-9.]+:|\\*:|\\[[^]]+\\]:)([0-9]+)\\s").matcher(line);
      while (address.find()) {
        int port = Integer.parseInt(address.group(1));
        boolean exists = false;
        for (int index = 0; index < used.length(); index += 1) {
          if (used.getInt(index) == port) {
            exists = true;
            break;
          }
        }
        if (!exists) used.put(port);
      }
    }
    return result;
  }

  private void applyExternalFrps(JSONObject result, String output) throws Exception {
    String encodedArguments = firstMatch(output, "(?m)^ASB_EXTERNAL_ARGS=(.*)$");
    if (encodedArguments.isEmpty()) return;
    result.put("externalRunning", true);

    String arguments = new String(Base64.decode(encodedArguments, Base64.DEFAULT), StandardCharsets.UTF_8);
    String[] values = arguments.split("\0", -1);
    Integer bindPort = null;
    String token = "";
    String configPath = "";
    for (int index = 0; index < values.length; index += 1) {
      String value = values[index];
      if (index + 1 < values.length && (value.equals("--bind-port") || value.equals("--bindPort"))) {
        bindPort = parsePort(values[index + 1]);
      } else if (value.startsWith("--bind-port=") || value.startsWith("--bindPort=")) {
        bindPort = parsePort(value.substring(value.indexOf('=') + 1));
      } else if (index + 1 < values.length && value.equals("--token")) {
        token = values[index + 1];
      } else if (value.startsWith("--token=")) {
        token = value.substring(value.indexOf('=') + 1);
      } else if (index + 1 < values.length
          && (value.equals("-c") || value.equals("--config") || value.equals("--config.file"))) {
        configPath = values[index + 1];
      } else if (value.startsWith("--config=")) {
        configPath = value.substring(value.indexOf('=') + 1);
      }
    }

    String encodedConfig = firstMatch(output, "(?m)^ASB_EXTERNAL_CONFIG=(.*)$");
    if (!encodedConfig.isEmpty()) {
      String config = new String(Base64.decode(encodedConfig, Base64.DEFAULT), StandardCharsets.UTF_8);
      Matcher configBindPort = Pattern.compile("(?m)^\\s*(?:bindPort|bind_port)\\s*=\\s*\"?([0-9]+)\"?\\s*$").matcher(config);
      Matcher configToken = Pattern.compile("(?m)^\\s*(?:auth[.]token|token)\\s*=\\s*\"([^\"]+)\"\\s*$").matcher(config);
      if (bindPort == null && configBindPort.find()) bindPort = parsePort(configBindPort.group(1));
      if (token.isEmpty() && configToken.find()) token = configToken.group(1);
    }
    if (!configPath.isEmpty()) result.put("externalConfigPath", configPath);
    if (bindPort != null && bindPort >= 1) {
      result.put("externalBindPort", bindPort);
    }
    if (bindPort != null && bindPort >= 1 && !token.trim().isEmpty()) {
      result.put("externalReusable", true).put("externalToken", token.trim());
    }
  }

  private Integer parsePort(String value) {
    try {
      return Integer.valueOf(value.trim());
    } catch (Exception error) {
      return null;
    }
  }

  private Set<Integer> readUsedPorts(JSONObject inspection) throws Exception {
    Set<Integer> result = new HashSet<>();
    JSONArray ports = inspection.optJSONArray("usedPorts");
    if (ports == null) return result;
    for (int index = 0; index < ports.length(); index += 1) result.add(ports.getInt(index));
    return result;
  }

  private int chooseFrpBindPort(JSONObject server, JSONObject inspection, Set<Integer> usedPorts) throws Exception {
    List<Integer> candidates = new ArrayList<>();
    if (server.optInt("bindPort", 0) >= 1024) candidates.add(server.getInt("bindPort"));
    if (inspection.optInt("bindPort", 0) >= 1024 && !inspection.optString("token").isEmpty()) {
      candidates.add(inspection.getInt("bindPort"));
    }
    candidates.add(7001);
    candidates.add(7000);
    for (int port = 7002; port <= 7010; port += 1) candidates.add(port);
    for (int port : candidates) {
      if (!usedPorts.contains(port)) return port;
    }
    throw new IllegalArgumentException("7001 及备选端口 7000、7002–7010 都被占用，请在高级配置里指定端口");
  }

  private String buildFrpsServiceEnabler(String config, int bindPort) {
    String encoded = Base64.encodeToString(config.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    return "set -eu\numask 077\nprintf 'ASB_STAGE=service\\n'\n"
        + "[ \"$(uname -s)\" = Linux ] || { echo 'FRP server supports Linux only' >&2; exit 2; }\n"
        + "if [ \"$(id -u)\" = 0 ]; then SUDO=''; elif sudo -n true 2>/dev/null; then SUDO=sudo; else echo 'Need root or passwordless sudo' >&2; exit 2; fi\n"
        + FrpInstallSupport.serviceAccount()
        + FrpInstallSupport.serviceDirectories()
        + "printf '%s' " + shellQuote(encoded) + " | base64 -d | $SUDO tee /etc/asb-frp/frps.toml >/dev/null\n"
        + "$SUDO chmod 600 /etc/asb-frp/frps.toml\n"
        + "$SUDO chown asb-frp:asb-frp /etc/asb-frp/frps.toml\n"
        + "$SUDO tee /etc/systemd/system/asb-frps.service >/dev/null <<'UNIT'\n"
        + "[Unit]\nDescription=agentBridge FRP server\nAfter=network-online.target\nWants=network-online.target\n"
        + "[Service]\nExecStart=/opt/asb-frp/bin/frps -c /etc/asb-frp/frps.toml\nRestart=always\nRestartSec=3\n"
        + FrpInstallSupport.serviceHardening()
        + "[Install]\nWantedBy=multi-user.target\nUNIT\n"
        + "$SUDO systemctl daemon-reload\n$SUDO systemctl enable --now asb-frps\n"
        + "$SUDO systemctl restart asb-frps\nsleep 1\nsystemctl is-active --quiet asb-frps\n"
        + "ss -ltn | grep -q '[:.]" + bindPort + "[[:space:]]'\n";
  }

  private String buildFrpsInstaller(JSONObject server, String config) {
    String encoded = Base64.encodeToString(config.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    String archive = frpArchiveUrl(server, "__ASB_OS_ARCH__");
    return "set -eu\numask 077\n"
        + "[ \"$(uname -s)\" = Linux ] || { echo 'FRP server supports Linux only' >&2; exit 2; }\n"
        + "case \"$(uname -m)\" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo 'Unsupported architecture' >&2; exit 2 ;; esac\n"
        + "if [ \"$(id -u)\" = 0 ]; then SUDO=''; elif sudo -n true 2>/dev/null; then SUDO=sudo; else echo 'Need root or passwordless sudo' >&2; exit 2; fi\n"
        + "work=$(mktemp -d); trap 'rm -rf \"$work\"' EXIT\n"
        + "archive=" + shellQuote(archive) + "\n"
        + "archive=$(printf '%s' \"$archive\" | sed \"s/__ASB_OS_ARCH__/linux_$arch/\")\n"
        + FrpInstallSupport.downloadOrRefuse(server.optString("version"))
        + "tar -xzf \"$work/frp.tar.gz\" -C \"$work\"\n"
        + FrpInstallSupport.serviceAccount()
        + FrpInstallSupport.serviceDirectories()
        + "$SUDO install -m 0755 \"$work\"/frp_*/frps /opt/asb-frp/bin/frps\n"
        + "printf '%s' " + shellQuote(encoded) + " | base64 -d | $SUDO tee /etc/asb-frp/frps.toml >/dev/null\n"
        + "$SUDO chmod 600 /etc/asb-frp/frps.toml\n"
        + "$SUDO chown asb-frp:asb-frp /etc/asb-frp/frps.toml\n"
        + "$SUDO tee /etc/systemd/system/asb-frps.service >/dev/null <<'UNIT'\n"
        + "[Unit]\nDescription=agentBridge FRP server\nAfter=network-online.target\nWants=network-online.target\n"
        + "[Service]\nExecStart=/opt/asb-frp/bin/frps -c /etc/asb-frp/frps.toml\nRestart=always\nRestartSec=3\n"
        + FrpInstallSupport.serviceHardening()
        + "[Install]\nWantedBy=multi-user.target\nUNIT\n"
        + "printf 'ASB_STAGE=service\\n'\n"
        + "$SUDO systemctl daemon-reload\n$SUDO systemctl enable --now asb-frps\n$SUDO systemctl restart asb-frps\n"
        + "sleep 1\nsystemctl is-active --quiet asb-frps\n"
        + "ss -ltn | grep -q '[:.]" + server.optInt("bindPort") + "[[:space:]]'\n";
  }

  private String buildFrpcInstaller(JSONObject server, String name, String config) {
    String encoded = Base64.encodeToString(config.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    String label = name.replaceAll("[^A-Za-z0-9_.-]+", "-");
    return "set -eu\numask 077\n"
        + "os=$(uname -s); case \"$(uname -m)\" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo 'Unsupported architecture' >&2; exit 2 ;; esac\n"
        + "case \"$os\" in Darwin|Linux) ;; *) echo 'Only Mac and Linux clients are supported' >&2; exit 2 ;; esac\n"
        + "work=$(mktemp -d); trap 'rm -rf \"$work\"' EXIT\n"
        + "mkdir -p \"$HOME/.asb-frp/bin\" \"$HOME/.config/agent-session-bridge\"\n"
        + "if [ ! -x \"$HOME/.asb-frp/bin/frpc\" ]; then\n"
        + "archive=" + shellQuote(frpArchiveUrl(server, "__ASB_OS_ARCH__")) + "\n"
        + "archive=$(printf '%s' \"$archive\" | sed \"s/__ASB_OS_ARCH__/$(echo \"$os\" | tr '[:upper:]' '[:lower:]')_$arch/\")\n"
        + FrpInstallSupport.downloadOrRefuse(server.optString("version"))
        + "tar -xzf \"$work/frp.tar.gz\" -C \"$work\"\n"
        + "install -m 0755 \"$work\"/frp_*/frpc \"$HOME/.asb-frp/bin/frpc\"\n"
        + "fi\n"
        + "printf '%s' " + shellQuote(encoded) + " | base64 -d > \"$HOME/.config/agent-session-bridge/frpc.toml\"\n"
        + "chmod 600 \"$HOME/.config/agent-session-bridge/frpc.toml\"\n"
        + "if [ \"$os\" = Darwin ]; then\n"
        + FrpInstallSupport.macLaunchAgent(label)
        + "else\n"
        + "  systemctl --user disable --now asb-frpc.service 2>/dev/null || true\n"
        + "  mkdir -p \"$HOME/.config/systemd/user\"\n"
        + "  cat > \"$HOME/.config/systemd/user/asb-frpc.service\" <<'UNIT'\n"
        + "[Unit]\nDescription=agentBridge FRP client\nAfter=default.target\n[Service]\nExecStart=%h/.asb-frp/bin/frpc -c %h/.config/agent-session-bridge/frpc.toml\nRestart=always\nRestartSec=3\n[Install]\nWantedBy=default.target\nUNIT\n"
        + "  printf 'ASB_STAGE=service\\n'\n"
        + "  systemctl --user daemon-reload\nsystemctl --user enable --now asb-frpc.service\n"
        + "  systemctl --user restart asb-frpc.service\nsleep 1\nsystemctl --user is-active --quiet asb-frpc.service\n"
        + "fi\n";
  }

  private String buildFrpVisitorInstaller(JSONObject server, String name, String config, int visitorPort) {
    String encoded = Base64.encodeToString(config.getBytes(StandardCharsets.UTF_8), Base64.NO_WRAP);
    String label = name.replaceAll("[^A-Za-z0-9_.-]+", "-");
    return "set -eu\numask 077\n"
        + "[ \"$(uname -s)\" = Linux ] || { echo 'FRP visitor supports Linux only' >&2; exit 2; }\n"
        + "if [ \"$(id -u)\" = 0 ]; then SUDO=''; elif sudo -n true 2>/dev/null; then SUDO=sudo; else echo 'Need root or passwordless sudo' >&2; exit 2; fi\n"
        + "work=$(mktemp -d); trap 'rm -rf \"$work\"' EXIT\n"
        + FrpInstallSupport.serviceAccount()
        + FrpInstallSupport.serviceDirectories()
        + "if [ ! -x /opt/asb-frp/bin/frpc-visitor ]; then\n"
        + "archive=" + shellQuote(frpArchiveUrl(server, "__ASB_OS_ARCH__")) + "\n"
        + "case \"$(uname -m)\" in x86_64) arch=amd64 ;; aarch64|arm64) arch=arm64 ;; *) echo 'Unsupported architecture' >&2; exit 2 ;; esac\n"
        + "archive=$(printf '%s' \"$archive\" | sed \"s/__ASB_OS_ARCH__/linux_$arch/\")\n"
        + FrpInstallSupport.downloadOrRefuse(server.optString("version"))
        + "tar -xzf \"$work/frp.tar.gz\" -C \"$work\"\n"
        + "$SUDO install -m 0755 \"$work\"/frp_*/frpc /opt/asb-frp/bin/frpc-visitor\n"
        + "fi\n"
        + "printf '%s' " + shellQuote(encoded) + " | base64 -d | $SUDO tee /etc/asb-frp/" + label + ".toml >/dev/null\n"
        + "$SUDO chmod 600 /etc/asb-frp/" + label + ".toml\n"
        + "$SUDO chown asb-frp:asb-frp /etc/asb-frp/" + label + ".toml\n"
        + "$SUDO tee /etc/systemd/system/asb-frpc-" + label + ".service >/dev/null <<'UNIT'\n"
        + "[Unit]\nDescription=agentBridge FRP visitor " + name + "\nAfter=network-online.target\nWants=network-online.target\n"
        + "[Service]\nExecStart=/opt/asb-frp/bin/frpc-visitor -c /etc/asb-frp/" + label + ".toml\nRestart=always\nRestartSec=3\n"
        + FrpInstallSupport.serviceHardening()
        + "[Install]\nWantedBy=multi-user.target\nUNIT\n"
        + "printf 'ASB_STAGE=service\\n'\n"
        + "$SUDO systemctl daemon-reload\n$SUDO systemctl enable --now asb-frpc-" + label + "\n"
        + "$SUDO systemctl restart asb-frpc-" + label + "\n"
        + "sleep 1\nsystemctl is-active --quiet asb-frpc-" + label + "\n"
        + "ss -ltn | grep -q '[:.]" + visitorPort + "[[:space:]]'\n";
  }

  private JSONObject probe(Session session) throws Exception {
    String output = run(session, "printf 'ASB_OS=%s\\n' \"$(uname -s 2>/dev/null || printf unknown)\"; "
        + "command -v claude >/dev/null 2>&1 && printf 'ASB_TOOL_claude=1\\n' || printf 'ASB_TOOL_claude=0\\n'; "
        + "command -v codex >/dev/null 2>&1 && printf 'ASB_TOOL_codex=1\\n' || printf 'ASB_TOOL_codex=0\\n'; "
        + "command -v gemini >/dev/null 2>&1 && printf 'ASB_TOOL_gemini=1\\n' || printf 'ASB_TOOL_gemini=0\\n'; "
        + "command -v tmux >/dev/null 2>&1 && tmux -V || true");
    JSONObject result = new JSONObject();
    result.put("os", firstMatch(output, "(?m)^ASB_OS=(.*)$"));
    JSONArray tools = new JSONArray();
    if (output.contains("ASB_TOOL_claude=1")) tools.put("claude-code");
    if (output.contains("ASB_TOOL_codex=1")) tools.put("codex");
    if (output.contains("ASB_TOOL_gemini=1")) tools.put("gemini");
    result.put("tools", tools);
    result.put("tmuxVersion", firstMatch(output, "(?m)^tmux\\s+([0-9][^\\n]*)$"));
    return result;
  }

  private List<JSONObject> listTmuxTasks(Session session, int machineId, Set<Integer> shellPids) throws Exception {
    String list = run(session, "tmux list-panes -a -F "
        + "'#{pane_id}\\t#{session_name}\\t#{window_index}\\t#{window_name}\\t#{pane_current_command}\\t"
        + "#{pane_current_path}\\t#{pane_dead}\\t#{pane_pid}' 2>/dev/null || true");
    List<JSONObject> result = new ArrayList<>();
    for (String line : list.split("\\n")) {
      if (line.trim().isEmpty()) continue;
      String[] fields = line.split("\\t", -1);
      if (fields.length < 8 || !fields[0].matches("%[0-9]+")) continue;
      String paneId = fields[0];
      String sessionName = fields[1];
      String windowIndex = fields[2];
      String windowName = fields[3];
      String workspace = fields[5];
      boolean dead = "1".equals(fields[6]);
      try {
        shellPids.add(Integer.parseInt(fields[7]));
      } catch (Exception ignored) {
        // tmux may report an unreadable pid on unusual platforms.
      }
      String output = sanitize(run(session, "tmux capture-pane -p -S -140 -t " + shellQuote(paneId)));
      String haystack = (sessionName + "\n" + windowName + "\n" + output).toLowerCase();
      String agentType = detectAgent(haystack);
      if (agentType == null) continue;
      Work work = Work.fromTerminal(output);
      JSONObject task = baseTask(machineId, machineTaskKey(paneId), paneId, agentType, "tmux");
      task.put("sessionName", sessionName)
          .put("windowName", windowName)
          .put("windowIndex", Integer.parseInt(windowIndex))
          .put("workspacePath", workspace)
          .put("status", dead ? "stopped" : "running")
          .put("title", displayName(agentType, deriveTitle(work.latestUser, work.latestAssistant, windowName, sessionName)))
          .put("workSummary", work.summary())
          .put("lastOutput", output)
          .put("requiredInput", dead ? "" : requiredInput(work.latestAssistant != null ? work.latestAssistant : output))
          .put("suggestedReply", dead ? "" : suggestedReply(requiredInput(work.latestAssistant != null ? work.latestAssistant : output)))
          .put("updatedAt", now());
      result.add(task);
    }
    return result;
  }

  private List<JSONObject> listProcessTasks(Session session, int machineId, Set<Integer> tmuxShellPids) throws Exception {
    Log.d("AgentBridgeNative", "process scan command=ps begin");
    String ps = run(session, "ps -axo pid=,ppid=,etime=,command=");
    Log.d("AgentBridgeNative", "process scan command=ps end bytes=" + ps.length());
    List<ProcessRow> processes = new ArrayList<>();
    for (String line : ps.split("\\n")) {
      if (line.trim().isEmpty()) continue;
      String[] fields = line.trim().split("\\s+", 4);
      if (fields.length < 4) continue;
      try {
        processes.add(new ProcessRow(Integer.parseInt(fields[0]), Integer.parseInt(fields[1]), fields[2], fields[3]));
      } catch (Exception ignored) {
        // Non-numeric rows cannot be agent processes.
      }
    }
    Set<Integer> excluded = descendants(processes, tmuxShellPids);
    List<ProcessRow> candidates = new ArrayList<>();
    for (ProcessRow process : processes) {
      if (!excluded.contains(process.pid)
          && "claude-code".equals(detectAgent(process.command.toLowerCase()))) candidates.add(process);
    }
    if (candidates.isEmpty()) return Collections.emptyList();
    Log.d("AgentBridgeNative", "process scan rows=" + processes.size()
        + " tmuxDescendants=" + excluded.size() + " candidates=" + candidates.size());

    Map<Integer, JSONObject> sessionMetaByPid = new HashMap<>();
    StringBuilder sessionScript = new StringBuilder();
    for (ProcessRow process : candidates) {
      sessionScript.append("printf '__ASB_SESSION__\\t").append(process.pid).append("\\n'\n")
          .append("session_file=\"$HOME/.claude/sessions/").append(process.pid).append(".json\"; ")
          .append("if [ -r \"$session_file\" ]; then cat \"$session_file\"; fi\n")
          .append("printf '\\n__ASB_SESSION_END__\\n'\n");
    }
    Log.d("AgentBridgeNative", "process scan command=claude-session-meta begin candidates=" + candidates.size());
    String sessionRecords = run(session, sessionScript.toString());
    Log.d("AgentBridgeNative", "process scan command=claude-session-meta end bytes=" + sessionRecords.length());
    for (String record : sessionRecords.split("(?m)^__ASB_SESSION_END__$\\n?")) {
      String[] parts = record.split("__ASB_SESSION__\\t", 2);
      if (parts.length < 2) continue;
      String[] lines = parts[1].split("\\n", 2);
      try {
        JSONObject meta = parseObject(lines.length > 1 && !lines[1].trim().isEmpty() ? lines[1] : lines[0]);
        if (meta != null) sessionMetaByPid.put(Integer.parseInt(lines[0].trim()), meta);
      } catch (Exception ignored) {
        // Session metadata is optional for process cards.
      }
    }

    List<String> sessionIds = new ArrayList<>();
    for (ProcessRow process : candidates) {
      JSONObject meta = sessionMetaByPid.get(process.pid);
      if (meta != null && meta.optString("sessionId").matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")) {
        sessionIds.add(meta.optString("sessionId"));
      }
    }
    Map<String, String> transcriptBySession = new HashMap<>();
    if (!sessionIds.isEmpty()) {
      List<String> expressions = new ArrayList<>();
      for (String sessionId : sessionIds) expressions.add("-name " + shellQuote(sessionId + ".jsonl"));
      String findCommand = "find \"$HOME/.claude/projects\" -type f \\( "
          + String.join(" -o ", expressions) + " \\) -print 2>/dev/null || true";
      Log.d("AgentBridgeNative", "process scan command=claude-find begin ids=" + sessionIds.size());
      String transcriptPaths = run(session, findCommand);
      Log.d("AgentBridgeNative", "process scan command=claude-find end bytes=" + transcriptPaths.length());
      for (String path : transcriptPaths.split("\\n")) {
        String clean = path.trim();
        if (clean.isEmpty()) continue;
        for (String sessionId : sessionIds) {
          if (clean.endsWith("/" + sessionId + ".jsonl")) transcriptBySession.put(sessionId, clean);
        }
      }
    }

    Map<String, Work> workBySession = new HashMap<>();
    if (!transcriptBySession.isEmpty()) {
      StringBuilder transcriptScript = new StringBuilder();
      for (Map.Entry<String, String> entry : transcriptBySession.entrySet()) {
        transcriptScript.append("printf '__ASB_TRANSCRIPT__\\t").append(entry.getKey()).append("\\n'\n")
            .append("tail -c 131072 ").append(shellQuote(entry.getValue())).append(" 2>/dev/null || true\n")
            .append("printf '\\n__ASB_TRANSCRIPT_END__\\n'\n");
      }
      Log.d("AgentBridgeNative", "process scan command=claude-tail begin sessions=" + transcriptBySession.size());
      String transcriptRecords = run(session, transcriptScript.toString());
      Log.d("AgentBridgeNative", "process scan command=claude-tail end bytes=" + transcriptRecords.length());
      for (String record : transcriptRecords.split("(?m)^__ASB_TRANSCRIPT_END__$\\n?")) {
        String[] parts = record.split("__ASB_TRANSCRIPT__\\t", 2);
        if (parts.length < 2) continue;
        String[] lines = parts[1].split("\\n", 2);
        if (lines.length < 2) continue;
        Work work = Work.fromClaudeTranscript(lines[1]);
        if (work.latestUser != null || work.latestAssistant != null) workBySession.put(lines[0].trim(), work);
      }
    }

    List<JSONObject> result = new ArrayList<>();
    for (ProcessRow process : candidates) {
      String agentType = detectAgent(process.command.toLowerCase());
      if (agentType == null) continue;
      String workspace = "/tmp";
      String paneId = "process:" + process.pid;
      String externalSessionId = "";
      String externalStatus = "";
      Work work = null;
      String detail = "远程进程 PID " + process.pid + " · 运行 " + process.elapsed + "\n" + sanitizeProcess(process.command);

      JSONObject meta = sessionMetaByPid.get(process.pid);
      if (meta != null && meta.optString("sessionId").matches("[A-Za-z0-9][A-Za-z0-9_-]{0,127}")) {
        externalSessionId = meta.optString("sessionId");
        externalStatus = meta.optString("status");
        if (!meta.optString("cwd").isEmpty()) workspace = meta.optString("cwd");
        String transcript = transcriptBySession.getOrDefault(externalSessionId, "");
        work = workBySession.get(externalSessionId);
        if (!transcript.isEmpty() && work != null) {
          detail = "远程 Claude 会话：" + externalSessionId + "\n记录：" + transcript + "\n\n" + work.summary();
        }
      }

      String workspaceName = workspace.substring(workspace.lastIndexOf('/') + 1);
      if (workspaceName.isEmpty()) workspaceName = "Remote";

      String titleSource = work == null ? null : (work.latestUser != null ? work.latestUser : work.latestAssistant);
      String status;
      if ("claude-code".equals(agentType) && !externalStatus.isEmpty()) {
        status = "busy".equals(externalStatus) ? "running" : "idle";
      } else {
        status = work != null && "idle".equals(work.status) ? "idle" : "running";
      }
      String stableKey = "claude-code".equals(agentType) && !externalSessionId.isEmpty()
          ? "claude:" + externalSessionId
          : machineTaskKey(paneId);
      JSONObject task = baseTask(machineId, stableKey, paneId, agentType, "process");
      task.put("sessionName", "process")
          .put("windowName", workspaceName)
          .put("windowIndex", 0)
          .put("workspacePath", workspace)
          .put("externalSessionId", externalSessionId)
          .put("processCommand", sanitizeProcess(process.command))
          .put("status", status)
          .put("title", displayName(agentType, deriveTitle(titleSource, work == null ? null : work.latestAssistant, workspaceName, "进程任务")))
          .put("workSummary", work == null ? "" : work.summary())
          .put("lastOutput", detail)
          .put("requiredInput", "idle".equals(status) ? requiredInput(work == null ? detail : work.latestAssistant) : "")
          .put("suggestedReply", "idle".equals(status) ? suggestedReply(requiredInput(work == null ? detail : work.latestAssistant)) : "")
          .put("updatedAt", now());
      result.add(task);
    }
    return dedupeProcessTasksBySession(result);
  }

  private List<JSONObject> dedupeProcessTasksBySession(List<JSONObject> tasks) {
    Map<String, JSONObject> bySession = new HashMap<>();
    List<JSONObject> result = new ArrayList<>();
    for (JSONObject task : tasks) {
      String sessionId = task.optString("externalSessionId", "");
      if (sessionId.isEmpty() || !"claude-code".equals(task.optString("agentType"))) {
        result.add(task);
        continue;
      }
      JSONObject old = bySession.get(sessionId);
      if (old == null || preferProcessTask(task, old)) {
        if (old != null) result.remove(old);
        bySession.put(sessionId, task);
        result.add(task);
      }
    }
    return result;
  }

  private boolean preferProcessTask(JSONObject candidate, JSONObject old) {
    int candidateScore = processTaskScore(candidate);
    int oldScore = processTaskScore(old);
    if (candidateScore != oldScore) return candidateScore > oldScore;
    // A stable lower PID is usually the long-lived parent process rather than a
    // short-lived wrapper/child that happens to reference the same session.
    return parseProcessPid(candidate.optString("paneId", "")) < parseProcessPid(old.optString("paneId", ""));
  }

  private int processTaskScore(JSONObject task) {
    int score = 0;
    if ("running".equals(task.optString("status"))) score += 4;
    if (!task.optString("workSummary", "").trim().isEmpty()) score += 2;
    if (!task.optString("requiredInput", "").trim().isEmpty()) score += 1;
    return score;
  }

  private int parseProcessPid(String paneId) {
    if (!paneId.startsWith("process:")) return Integer.MAX_VALUE;
    try {
      return Integer.parseInt(paneId.substring("process:".length()));
    } catch (Exception ignored) {
      return Integer.MAX_VALUE;
    }
  }

  private List<JSONObject> listCodexDesktopTasks(Session session, int machineId) throws Exception {
    // Read the session index first — it has all sessions with human-readable names
    Map<String, String> titleByThread = new HashMap<>();
    for (String line : run(session, "cat \"$HOME/.codex/session_index.jsonl\" 2>/dev/null || true").split("\\n")) {
      JSONObject entry = parseObject(line);
      if (entry == null) continue;
      String id = entry.optString("id").toLowerCase();
      String title = entry.optString("thread_name");
      // These ids end up in a find expression, so only well-formed UUIDs pass.
      if (id.matches(CODEX_THREAD_ID) && !title.isEmpty()) titleByThread.put(id, title);
    }

    // Detect active threads via lock files
    String lockValue = run(session, "find \"$HOME/.codex/thread-writer-locks\" -maxdepth 1 -type f "
        + "-name '*.lock' ! -name '.coordination.lock' -exec basename {} .lock \\; 2>/dev/null || true");
    Set<String> activeThreadIds = new HashSet<>();
    for (String value : lockValue.split("\\n")) {
      String threadId = value.trim().toLowerCase();
      if (threadId.matches(CODEX_THREAD_ID)) activeThreadIds.add(threadId);
    }

    // Include all indexed sessions (not just locked ones), capped to recent 30
    List<String> threadIds = new ArrayList<>(activeThreadIds);
    for (String id : titleByThread.keySet()) {
      if (!activeThreadIds.contains(id) && threadIds.size() < 30) threadIds.add(id);
    }
    if (threadIds.isEmpty()) return Collections.emptyList();

    // Find transcript files
    StringBuilder findExpression = new StringBuilder("find \"$HOME/.codex/sessions\" -type f \\( ");
    for (String threadId : threadIds) findExpression.append("-name '*").append(threadId).append(".jsonl' -o ");
    findExpression.setLength(findExpression.length() - 3);
    findExpression.append("\\) -print 2>/dev/null || true");
    Map<String, String> transcriptByThread = new HashMap<>();
    Log.d("AgentBridgeNative", "codex scan command=find begin threads=" + threadIds.size());
    String codexPaths = run(session, findExpression.toString());
    Log.d("AgentBridgeNative", "codex scan command=find end bytes=" + codexPaths.length());
    for (String path : codexPaths.split("\\n")) {
      String clean = path.trim();
      if (clean.isEmpty()) continue;
      for (String threadId : threadIds) {
        if (clean.toLowerCase().endsWith(threadId + ".jsonl")) transcriptByThread.put(threadId, clean);
      }
    }

    StringBuilder script = new StringBuilder();
    for (String threadId : threadIds) {
      String transcriptPath = transcriptByThread.getOrDefault(threadId, "");
      script.append("printf '__ASB_THREAD__\\t%s\\t%s\\n' ")
          .append(shellQuote(threadId)).append(' ').append(shellQuote(transcriptPath)).append('\n');
      if (!transcriptPath.isEmpty()) {
        String quoted = shellQuote(transcriptPath);
        script.append("head -c 4096 ").append(quoted).append(" 2>/dev/null || true\n")
            .append("printf '\\n__ASB_TAIL__\\n'\n")
            .append("tail -c 32768 ").append(quoted).append(" 2>/dev/null || true\n");
      }
      script.append("printf '\\n__ASB_END__\\n'\n");
    }
    Log.d("AgentBridgeNative", "codex scan command=records begin threads=" + threadIds.size());
    String records = run(session, script.toString());
    Log.d("AgentBridgeNative", "codex scan command=records end bytes=" + records.length());

    List<JSONObject> result = new ArrayList<>();
    for (String record : records.split("(?m)^__ASB_END__$\\n?")) {
      if (record.trim().isEmpty()) continue;
      String[] headerAndBody = record.split("(?m)^__ASB_TAIL__$\\n?", 2);
      String[] threadParts = (headerAndBody.length > 1 ? headerAndBody[0] : record)
          .split("__ASB_THREAD__\\t", 2);
      if (threadParts.length < 2) continue;
      String[] threadLines = threadParts[1].split("\\n", 2);
      String[] fields = threadLines.length > 0 ? threadLines[0].split("\\t", -1) : new String[0];
      if (fields.length < 2) continue;
      String threadId = fields[0].trim();
      String transcriptPath = fields[1].trim();
      if (!threadId.matches(CODEX_THREAD_ID)) continue;

      String metaLine = "";
      String tailText = "";
      if (headerAndBody.length > 1) {
        metaLine = threadLines.length > 1 ? threadLines[1] : "";
        tailText = headerAndBody[1];
      }

      String workspace = extractJsonStringField(metaLine, "cwd");
      String originator = extractJsonStringField(metaLine, "originator");
      String threadSource = extractJsonStringField(metaLine, "thread_source");
      String parentThreadId = extractJsonStringField(metaLine, "parent_thread_id");
      // Desktop subagents share their parent's workspace and often have the same
      // derived title. They are implementation details of one employee, not a
      // separate employee card.
      if ("subagent".equals(threadSource) || !parentThreadId.isEmpty()) continue;
      if (workspace.trim().isEmpty()) workspace = "/tmp";
      String workspaceName = workspace.substring(workspace.lastIndexOf('/') + 1);
      if (workspaceName.isEmpty()) workspaceName = "Home";

      String threadTitle = titleByThread.getOrDefault(threadId, "");
      Work work = tailText.trim().isEmpty() ? null : Work.fromCodexTranscript(tailText);
      String userTitle = deriveTitle(work == null ? null : work.latestUser, null, null, null);
      String assistantTitle = deriveTitle(null, work == null ? null : work.latestAssistant, null, null);
      String workTitle = userTitle != null && !isVagueWorkTitle(userTitle)
          ? userTitle
          : threadTitle != null && !isVagueWorkTitle(threadTitle)
            ? threadTitle
            : assistantTitle != null ? assistantTitle : userTitle != null ? userTitle : threadTitle;
      if (workTitle == null || workTitle.trim().isEmpty()) workTitle = workspaceName;
      String status = work != null && "running".equals(work.status) ? "running" : "idle";
      String summary = work == null || work.summary().trim().isEmpty()
          ? (threadTitle.isEmpty() ? "已发现 Codex Desktop 线程，暂未读取到文本记录。" : "Codex 线程：" + threadTitle)
          : work.summary();
      String required = "idle".equals(status) ? requiredInput(work == null ? null : work.latestAssistant) : "";

      JSONObject task = baseTask(machineId, "codex:" + threadId, "codex:" + threadId, "codex", "process");
      task.put("sessionName", threadTitle.isEmpty() ? workTitle : threadTitle)
          .put("windowName", workspaceName)
          .put("windowIndex", 0)
          .put("workspacePath", workspace)
          .put("externalSessionId", threadId)
          .put("processCommand", originator.isEmpty() ? "Codex Desktop" : originator + " (Codex Desktop)")
          .put("status", status)
          .put("title", displayName("codex", workTitle))
          .put("workSummary", summary)
          .put("lastOutput", "Codex 线程：" + threadId
              + "\n状态：" + ("running".equals(status) ? "task_started" : "等待输入")
              + "\n来源：" + (originator.isEmpty() ? "Codex Desktop" : originator)
              + "\n记录：" + (transcriptPath.isEmpty() ? "未找到 transcript" : transcriptPath)
              + "\n\n" + summary)
          .put("requiredInput", required)
          .put("suggestedReply", suggestedReply(required))
          .put("updatedAt", now());
      result.add(task);
    }
    Log.d("AgentBridgeNative", "codex desktop threads=" + threadIds.size() + " tasks=" + result.size());
    return result;
  }

  private void preserveCustomTitles(int machineId, JSONArray discovered) throws Exception {
    Map<String, JSONObject> oldByKey = new HashMap<>();
    Map<String, JSONObject> oldByExternalSession = new HashMap<>();
    JSONArray oldTasks = store.tasks();
    for (int index = 0; index < oldTasks.length(); index += 1) {
      JSONObject task = oldTasks.getJSONObject(index);
      if (task.getInt("machineId") != machineId) continue;
      oldByKey.put(task.getString("stableKey"), task);
      String externalSessionId = task.optString("externalSessionId", "");
      if (!externalSessionId.isEmpty()) oldByExternalSession.put(externalSessionId, task);
    }
    for (int index = 0; index < discovered.length(); index += 1) {
      JSONObject task = discovered.getJSONObject(index);
      String externalSessionId = task.optString("externalSessionId", "");
      JSONObject old = oldByKey.get(task.getString("stableKey"));
      if (old == null && !externalSessionId.isEmpty()) old = oldByExternalSession.get(externalSessionId);
      if (old == null) {
        task.put("id", store.nextId());
        continue;
      }
      task.put("id", old.getInt("id"));
      String customTitle = old.optString("customTitle", "");
      if (!customTitle.isEmpty()) task.put("customTitle", customTitle).put("title", customTitle);
    }
  }

  private JSONObject baseTask(int machineId, String stableKey, String paneId, String agentType, String controlMode) throws Exception {
    return new JSONObject()
        .put("machineId", machineId)
        .put("stableKey", stableKey)
        .put("paneId", paneId)
        .put("agentType", agentType)
        .put("controlMode", controlMode)
        .put("externalSessionId", "")
        .put("customTitle", "")
        .put("status", "running")
        .put("title", displayName(agentType, "新任务"))
        .put("lastOutput", "")
        .put("workSummary", "")
        .put("requiredInput", "")
        .put("suggestedReply", "")
        .put("lastActiveAt", now());
  }

  private String machineTaskKey(String paneId) {
    return paneId;
  }

  private String run(Session session, String command) throws Exception {
    return run(session, command, COMMAND_TIMEOUT);
  }

  private String run(Session session, String command, int timeoutMillis) throws Exception {
    ChannelExec channel = (ChannelExec) session.openChannel("exec");
    ByteArrayOutputStream stdout = new ByteArrayOutputStream();
    ByteArrayOutputStream stderr = new ByteArrayOutputStream();
    // A chatty remote command must not grow the error buffer without limit.
    OutputStream boundedStderr = new OutputStream() {
      @Override public void write(int value) {
        if (stderr.size() < MAX_STDERR) stderr.write(value);
      }

      @Override public void write(byte[] buffer, int offset, int length) {
        int room = MAX_STDERR - stderr.size();
        if (room > 0) stderr.write(buffer, offset, Math.min(room, length));
      }
    };
    try {
      channel.setCommand("export PATH=\"$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH\"\n" + command);
      channel.setInputStream(null);
      channel.setErrStream(boundedStderr);
      InputStream output = channel.getInputStream();
      channel.connect(timeoutMillis);
      byte[] buffer = new byte[16_384];
      long deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
      while (!channel.isClosed() && session.isConnected() && System.nanoTime() < deadline) {
        while (output.available() > 0 && System.nanoTime() < deadline) {
          int read = output.read(buffer);
          if (read < 0) break;
          if (stdout.size() < MAX_OUTPUT) stdout.write(buffer, 0, Math.min(read, MAX_OUTPUT - stdout.size()));
        }
        Thread.sleep(25);
      }
      boolean timedOut = !channel.isClosed() && System.nanoTime() >= deadline;
      while (output.available() > 0 && !timedOut) {
        int read = output.read(buffer);
        if (read < 0) break;
        if (stdout.size() < MAX_OUTPUT) stdout.write(buffer, 0, Math.min(read, MAX_OUTPUT - stdout.size()));
      }
      int exit = channel.getExitStatus();
      String stage = "";
      Matcher stages = Pattern.compile("(?m)^ASB_STAGE=([a-z-]+)$")
          .matcher(new String(stdout.toByteArray(), StandardCharsets.UTF_8));
      while (stages.find()) stage = "，阶段 " + stages.group(1);
      if (timedOut) {
        throw new IllegalArgumentException("远程命令超过 " + (timeoutMillis / 1000) + " 秒"
            + stage + "；远程进程可能仍在运行，请检查后再试");
      }
      if (exit == -1) {
        throw new IllegalArgumentException("SSH 连接中断或未返回退出状态" + stage + "；请检查网络及远程服务");
      }
      if (exit != 0) {
        String error = new String(stderr.toByteArray(), StandardCharsets.UTF_8).trim();
        if (error.length() > 1500) error = error.substring(error.length() - 1500);
        throw new IllegalArgumentException(friendlyRemoteError(error, exit, stage));
      }
      String value = new String(stdout.toByteArray(), StandardCharsets.UTF_8);
      if (value.length() > MAX_OUTPUT) value = value.substring(0, MAX_OUTPUT);
      return value;
    } finally {
      channel.disconnect();
    }
  }

  private static final class BridgeUserInfo implements UserInfo, UIKeyboardInteractive {
    private final String password;

    private BridgeUserInfo(String password) {
      this.password = password == null ? "" : password;
    }

    @Override public String getPassphrase() { return ""; }
    @Override public String getPassword() { return password; }
    @Override public boolean promptPassword(String message) { return true; }
    @Override public boolean promptPassphrase(String message) { return true; }
    @Override public boolean promptYesNo(String message) { return true; }
    @Override public void showMessage(String message) { }
    @Override public String[] promptKeyboardInteractive(String destination, String name, String instruction, String[] prompts, boolean[] echo) {
      if (prompts == null || prompts.length == 0) return new String[0];
      String[] answers = new String[prompts.length];
      for (int index = 0; index < prompts.length; index += 1) answers[index] = password;
      return answers;
    }
  }

  private void markOffline(int machineId, Exception error) {
    try {
      store.patchMachine(machineId, new JSONObject()
          .put("lastStatus", "offline")
          .put("lastError", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage())
          .put("lastCheckedAt", now())
          .put("updatedAt", now()));
    } catch (Exception ignored) {
      // The machine may have been deleted while an operation was in flight.
    }
  }

  private JSONObject networkStatusForMachine(int machineId) throws Exception {
    JSONObject machine = store.machine(machineId);
    boolean directReachable = directReachable(machine);
    String mode = machine.optString("publicMode", "off");
    boolean usePublic = "public".equals(mode)
        || ("auto".equals(mode) && !directReachable);
    JSONObject relay = usePublic ? store.frpRelay(machineId) : null;
    JSONObject server = usePublic ? store.frpServer() : null;
    String host = machine.getString("host");
    int port = machine.getInt("port");
    String route = "direct";
    if (usePublic) {
      if (server == null || relay == null || !relay.optBoolean("enabled") || !"online".equals(relay.optString("status"))) {
        return new JSONObject()
            .put("phoneIp", networkHint())
            .put("host", host)
            .put("port", port)
            .put("reachable", false)
            .put("route", "public")
            .put("latencyMs", -1)
            .put("summary", "公网中转未启用 · " + host + ":" + port);
      }
      JSONObject serverMachine = store.machine(server.getInt("machineId"));
      host = serverMachine.getString("host");
      port = serverMachine.getInt("port");
      route = "public";
    }
    long started = System.currentTimeMillis();
    boolean reachable;
    try (Socket socket = new Socket()) {
      socket.connect(new InetSocketAddress(host, port), 2_000);
      reachable = socket.isConnected();
    } catch (Exception error) {
      reachable = false;
    }
    long latency = System.currentTimeMillis() - started;
    JSONObject result = new JSONObject()
        .put("phoneIp", networkHint().isEmpty() ? "unknown" : networkHint() + ".x")
        .put("host", host)
        .put("port", port)
        .put("reachable", reachable)
        .put("route", route)
        .put("latencyMs", reachable ? latency : -1)
        .put("summary", (reachable ? "可达" : "不可达")
            + " · " + host + ":" + port
            + (reachable ? " · " + latency + "ms" : "")
            + ("public".equals(route) ? " · FRP 安全中转" : " · 局域网直连"));
    return result;
  }

  /**
   * Registers a running operation and returns a snapshot for the page; the
   * stored object is only ever touched under the operations lock.
   */
  private JSONObject registerOperation(int operationId, String phase, String message) throws Exception {
    return registerOperation(operationId, phase, message, null);
  }

  private JSONObject registerOperation(int operationId, String phase, String message, JSONObject extra) throws Exception {
    long now = System.currentTimeMillis();
    JSONObject operation = new JSONObject()
        .put("id", operationId)
        .put("state", "running")
        .put("phase", phase)
        .put("message", message)
        .put("startedAt", now)
        .put("updatedAt", now);
    if (extra != null) {
      Iterator<String> keys = extra.keys();
      while (keys.hasNext()) {
        String key = keys.next();
        operation.put(key, extra.get(key));
      }
    }
    synchronized (operations) {
      pruneOperations();
      operations.put(operationId, operation);
      return new JSONObject(operation.toString());
    }
  }

  /** Runs a user-started operation on its own thread, in the foreground while it lasts. */
  private void startWorker(String name, Runnable body) {
    TaskForegroundService.acquire(activity);
    try {
      new Thread(() -> {
        try {
          body.run();
        } finally {
          TaskForegroundService.release(activity);
        }
      }, name).start();
    } catch (RuntimeException error) {
      TaskForegroundService.release(activity);
      throw error;
    }
  }

  private void markOperation(int id, String key, Object value) throws Exception {
    synchronized (operations) {
      JSONObject operation = operations.get(id);
      if (operation != null) operation.put(key, value);
    }
  }

  private JSONObject operationById(int id) throws Exception {
    synchronized (operations) {
      JSONObject operation = operations.get(id);
      return operation == null ? null : new JSONObject(operation.toString());
    }
  }

  private void updateOperation(int id, String phase, String message, Object network) throws Exception {
    updateOperation(id, phase, message, network, null);
  }

  private void updateOperation(int id, String phase, String message, Object network, Object task) throws Exception {
    synchronized (operations) {
      JSONObject operation = operations.get(id);
      if (operation == null) return;
      operation.put("state", "succeeded".equals(phase) || "failed".equals(phase) ? phase : "running")
          .put("phase", phase)
          .put("message", message)
          .put("updatedAt", System.currentTimeMillis());
      if (network != null) {
        if (network instanceof JSONObject) operation.put("network", network);
        else if (!String.valueOf(network).isEmpty()) operation.put("network", network);
      }
      if (task != null) operation.put("task", task);
    }
  }

  private void pruneOperations() {
    // Finished operations the page never cleared go first, oldest first. A
    // running one is dropped only if far too many pile up, since the page is
    // still polling it.
    Iterator<Map.Entry<Integer, JSONObject>> iterator = operations.entrySet().iterator();
    while (operations.size() >= 20 && iterator.hasNext()) {
      if (!"running".equals(iterator.next().getValue().optString("state"))) iterator.remove();
    }
    iterator = operations.entrySet().iterator();
    while (operations.size() >= 100 && iterator.hasNext()) {
      iterator.next();
      iterator.remove();
    }
  }

  private String networkHint() {
    try {
      List<NetworkInterface> interfaces = Collections.list(NetworkInterface.getNetworkInterfaces());
      for (NetworkInterface item : interfaces) {
        if (!item.isUp() || item.isLoopback()) continue;
        List<InetAddress> addresses = Collections.list(item.getInetAddresses());
        for (InetAddress address : addresses) {
          if (address.isLoopbackAddress() || !address.getHostAddress().matches("(?:\\d{1,3}\\.){3}\\d{1,3}")) continue;
          String value = address.getHostAddress();
          return value.substring(0, value.lastIndexOf('.'));
        }
      }
    } catch (Exception ignored) {
      // Fall back to manual prefix entry.
    }
    return "";
  }

  private String normalizePrefix(String value) {
    if (value == null) return null;
    String trimmed = value.trim();
    Matcher full = Pattern.compile("^((?:\\d{1,3}\\.){3}\\d{1,3})$").matcher(trimmed);
    if (full.matches()) return trimmed.substring(0, trimmed.lastIndexOf('.'));
    Matcher prefix = Pattern.compile("^((?:\\d{1,3}\\.){2}\\d{1,3})$").matcher(trimmed);
    return prefix.matches() ? trimmed : null;
  }

  private String requiredText(JSONObject input, String key, String message) throws Exception {
    String value = input.optString(key).trim();
    if (value.isEmpty()) throw new IllegalArgumentException(message);
    return value;
  }

  private static String firstMatch(String value, String expression) {
    Matcher matcher = Pattern.compile(expression).matcher(value);
    return matcher.find() ? matcher.group(1).trim() : "";
  }

  private static String detectAgent(String haystack) {
    if (haystack.contains("renderer")
        || haystack.contains("app-server")
        || haystack.contains("snapshot_file=")
        || haystack.contains("/applications/chatgpt.app/")
        || haystack.contains("chatgpt for chrome")) return null;
    if (Pattern.compile("^/(?:bin|usr/bin)/(?:sh|zsh|bash)(?:\\s|$)").matcher(haystack).find()) return null;
    if (Pattern.compile("(^|\\s|/)claude(\\s|$)").matcher(haystack).find()) return "claude-code";
    if (Pattern.compile("(^|\\s|/)codex(\\s|$)").matcher(haystack).find()) return "codex";
    if (Pattern.compile("(^|\\s|/)gemini(\\s|$)").matcher(haystack).find()) return "gemini";
    return null;
  }

  private static Set<Integer> descendants(List<ProcessRow> processes, Set<Integer> roots) {
    Map<Integer, List<Integer>> children = new HashMap<>();
    for (ProcessRow process : processes) {
      children.computeIfAbsent(process.parentPid, ignored -> new ArrayList<>()).add(process.pid);
    }
    Set<Integer> result = new HashSet<>(roots);
    List<Integer> queue = new ArrayList<>(roots);
    while (!queue.isEmpty()) {
      int pid = queue.remove(0);
      for (int child : children.getOrDefault(pid, Collections.emptyList())) {
        if (result.add(child)) queue.add(child);
      }
    }
    return result;
  }

  private static String sanitizeProcess(String command) {
    return command
        .replaceAll("(?i)(Authorization:\\s*Bearer\\s+)\\S+", "$1***")
        .replaceAll("(?i)((?:api[_-]?key|token|password)=)[^\\s]+", "$1***");
  }

  private static String sanitize(String value) {
    return value
        .replaceAll("\\u001B\\[[0-9;?]*[A-Za-z]", "")
        .replaceAll("[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F]", "")
        .trim();
  }

  private static String displayName(String agentType, String title) {
    String name = "claude-code".equals(agentType) ? "Claude" : "codex".equals(agentType) ? "Codex" : "Gemini";
    return name + " · " + (title == null || title.trim().isEmpty() ? "未命名任务" : title.trim());
  }

  private static String deriveTitle(String first, String second, String fallbackA, String fallbackB) {
    String source = first != null && !first.trim().isEmpty() ? first : second;
    if (source != null) {
      String cleaned = source
          .replaceAll("<[^>]+>", " ")
          .replaceAll("(?s)```.*?```", " ")
          .replaceAll("https?://\\S+", " ")
          .replaceAll("\\s+", " ")
          .trim();
      Matcher chinese = Pattern.compile("[\\p{IsHan}][\\p{IsHan}\\w，。；、：()（）\\s-]{5,80}").matcher(cleaned);
      if (chinese.find()) {
        String value = chinese.group().trim().split("[。？！；]")[0].trim();
        if (value.length() >= 4) return value.substring(0, Math.min(48, value.length()));
      }
      String[] words = cleaned.split("\\s+");
      if (words.length > 0 && !words[0].isEmpty()) {
        StringBuilder value = new StringBuilder();
        for (int index = 0; index < Math.min(8, words.length); index += 1) value.append(words[index]).append(' ');
        String joined = value.toString().trim();
        return joined.substring(0, Math.min(60, joined.length()));
      }
    }
    return fallbackA != null && !fallbackA.trim().isEmpty() ? fallbackA : fallbackB;
  }

  private static boolean isVagueWorkTitle(String value) {
    String trimmed = value == null ? "" : value.trim();
    if (trimmed.isEmpty() || trimmed.length() <= 3) return true;
    if (trimmed.matches("^\\d{4}-\\d{2}-\\d{2}(?:\\s|$)")) return true;
    return trimmed.matches(".*(继续|咋样|怎么样|好的|可以|搞定|继续呢|看看|启动|刷新).*")
        && trimmed.length() <= 18;
  }

  private static JSONObject parseObject(String value) {
    try {
      JSONObject result = new JSONObject(value);
      return result;
    } catch (Exception ignored) {
      return null;
    }
  }

  private static String extractJsonStringField(String value, String field) {
    if (value == null || value.trim().isEmpty()) return "";
    Matcher matcher = Pattern.compile("\"" + Pattern.quote(field) + "\"\\s*:\\s*\"((?:\\\\.|[^\"\\\\])*)\"")
        .matcher(value);
    if (!matcher.find()) return "";
    String escaped = matcher.group(1);
    StringBuilder result = new StringBuilder();
    for (int index = 0; index < escaped.length(); index += 1) {
      char current = escaped.charAt(index);
      if (current != '\\' || index + 1 >= escaped.length()) {
        result.append(current);
        continue;
      }
      char next = escaped.charAt(++index);
      switch (next) {
        case 'n' -> result.append('\n');
        case 'r' -> result.append('\r');
        case 't' -> result.append('\t');
        case 'b' -> result.append('\b');
        case 'f' -> result.append('\f');
        case 'u' -> {
          if (index + 4 < escaped.length()) {
            try {
              result.append((char) Integer.parseInt(escaped.substring(index + 1, index + 5), 16));
              index += 4;
            } catch (NumberFormatException ignored) {
              result.append('u');
            }
          } else result.append('u');
        }
        default -> result.append(next);
      }
    }
    return result.toString();
  }

  private static String requiredInput(String value) {
    if (value == null || value.trim().isEmpty()) return "";
    String readable = value
        .replaceAll("(?s)```.*?```", " ")
        .replaceAll("`([^`]+)`", "$1")
        .replace('|', ' ');
    List<String> candidates = new ArrayList<>();
    for (String line : readable.split("\\r?\\n")) {
      String clean = line.replaceFirst("^#{1,6}\\s*", "").replaceAll("\\s+", " ").trim();
      if (clean.isEmpty() || clean.matches("^(?:[-*]\\s|>\\s*).*")) continue;
      Collections.addAll(candidates, clean.split("(?<=[。！？!?])\\s*"));
    }
    Pattern cue = Pattern.compile("(需要你|你需要|你要|请确认|确认一下|你确认|等你|告诉我|要不要|是否|你选|你决定|手动|装好后|说一声|最后一步|你只需要|你拍板|发给我|提供|输入|可以授权我|验收)");
    for (int index = candidates.size() - 1; index >= 0; index -= 1) {
      String sentence = candidates.get(index).trim();
      if (cue.matcher(sentence).find() || sentence.matches(".*[?？]$")) {
        String selected = sentence.replaceFirst("^[*-]\\s*", "").replaceFirst("^[:：,，。]\\s*", "").trim();
        if (selected.length() >= 6) return selected.substring(0, Math.min(320, selected.length()));
      }
    }
    return "";
  }

  private static String suggestedReply(String input) {
    if (input == null || input.isEmpty()) return "";
    if (input.contains("可以授权") || input.contains("解除隔离")) return "可以授权，继续。";
    if (input.contains("现象") || input.contains("异常") || input.contains("报错") || input.contains("结果")) return "我操作后的结果如下：";
    if (input.contains("选") || input.contains("拍板") || input.contains("哪个方案")) return "选这个，继续。";
    if (input.contains("要不要") || input.contains("是否")) return "要，继续。";
    if (input.contains("确认") || input.contains("验收") || input.contains("审核")) return "确认，继续。";
    if (input.contains("安装") || input.contains("装好后")) return "我已安装并测试，结果：";
    if (input.contains("验证") || input.contains("测试")) return "我用真实场景验证，结果：";
    return "继续，按你的建议处理。";
  }

  private static String shellQuote(String value) {
    return "'" + value.replace("'", "'\\''") + "'";
  }

  private static String friendlyRemoteError(String error, int exit, String stage) {
    if (error != null) {
      if (error.contains("thread-store conflict") || error.contains("already has an active writer")) {
        return "这个 Codex 员工正被桌面端占用，手机不能同时接管；请等它完成或关闭桌面会话后再发送。";
      }
      if (error.contains("no rollout found for thread id") || error.contains("session not found")) {
        return "这个 Codex 员工的会话记录已经不存在，可能是临时会话或记录被清理；请点“找任务”刷新后再选择。";
      }
    }
    String detail = error == null ? "" : error.trim();
    if (detail.isEmpty()) detail = "命令未输出错误详情，请检查远程服务日志";
    return "远程命令失败(" + exit + ")" + stage + "：" + detail;
  }

  static String now() {
    return java.time.format.DateTimeFormatter.ISO_INSTANT.format(java.time.Instant.now());
  }

  private static String success(JSONObject data) {
    try {
      return new JSONObject().put("ok", true).put("data", data).toString();
    } catch (Exception error) {
      return failure(error);
    }
  }

  private static String failure(Exception error) {
    try {
      return new JSONObject()
          .put("ok", false)
          .put("error", error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage())
          .toString();
    } catch (Exception ignored) {
      return "{\"ok\":false,\"error\":\"未知错误\"}";
    }
  }

  private static final class ProcessRow {
    private final int pid;
    private final int parentPid;
    private final String elapsed;
    private final String command;

    private ProcessRow(int pid, int parentPid, String elapsed, String command) {
      this.pid = pid;
      this.parentPid = parentPid;
      this.elapsed = elapsed;
      this.command = command;
    }
  }

  private static final class Work {
    private final String latestUser;
    private final String latestAssistant;
    private final String status;

    private Work(String latestUser, String latestAssistant, String status) {
      this.latestUser = latestUser;
      this.latestAssistant = latestAssistant;
      this.status = status;
    }

    private String summary() {
      List<String> lines = new ArrayList<>();
      if (latestUser != null && !latestUser.isEmpty()) lines.add("最近指令：" + truncate(latestUser, 700));
      if (latestAssistant != null && !latestAssistant.isEmpty()) lines.add("最近输出：" + truncate(latestAssistant, 1200));
      return String.join("\n", lines);
    }

    private static Work fromTerminal(String value) {
      return new Work(null, value, "running");
    }

    private static Work fromClaudeTranscript(String value) {
      return parseTranscript(value, "claude");
    }

    private static Work fromCodexTranscript(String value) {
      return parseTranscript(value, "codex");
    }

    private static Work parseTranscript(String value, String kind) {
      String latestUser = null;
      String latestAssistant = null;
      String status = null;
      String[] lines = value.split("\\n");
      for (int index = lines.length - 1; index >= 0; index -= 1) {
        String line = lines[index].trim();
        if (line.isEmpty()) continue;
        JSONObject entry;
        try {
          entry = new JSONObject(line);
        } catch (Exception ignored) {
          continue;
        }
        if ("codex".equals(kind) && "event_msg".equals(entry.optString("type"))) {
          JSONObject payload = entry.optJSONObject("payload");
          String eventType = payload == null ? "" : payload.optString("type");
          if (status == null && ("task_complete".equals(eventType) || "task_failed".equals(eventType) || "task_cancelled".equals(eventType))) status = "idle";
          if (status == null && "task_started".equals(eventType)) status = "running";
        }
        JSONObject payload = "codex".equals(kind) ? entry.optJSONObject("payload") : entry.optJSONObject("message");
        if (payload == null) continue;
        String role = payload.optString("role");
        String text = "codex".equals(kind) ? codexText(payload.optJSONArray("content")) : claudeText(payload.opt("content"));
        if (text == null || text.trim().isEmpty()) continue;
        if ("user".equals(role) && latestUser == null && !text.startsWith("<")) latestUser = truncate(clean(text), 2400);
        if ("assistant".equals(role) && latestAssistant == null) latestAssistant = truncate(clean(text), 2400);
        if (latestUser != null && latestAssistant != null && status != null) break;
      }
      if (latestUser == null && latestAssistant == null) return new Work(null, null, "running");
      return new Work(latestUser, latestAssistant, status == null ? "running" : status);
    }

    private static String claudeText(Object content) {
      if (content instanceof String) return ((String) content).trim();
      if (!(content instanceof org.json.JSONArray)) return null;
      org.json.JSONArray array = (org.json.JSONArray) content;
      StringBuilder result = new StringBuilder();
      for (int index = 0; index < array.length(); index += 1) {
        JSONObject item = array.optJSONObject(index);
        if (item != null && "text".equals(item.optString("type"))) result.append(item.optString("text")).append('\n');
      }
      return result.toString().trim();
    }

    private static String codexText(org.json.JSONArray content) {
      if (content == null) return null;
      StringBuilder result = new StringBuilder();
      for (int index = 0; index < content.length(); index += 1) {
        JSONObject item = content.optJSONObject(index);
        if (item == null) continue;
        String type = item.optString("type");
        if ("input_text".equals(type) || "output_text".equals(type)) result.append(item.optString("text")).append('\n');
      }
      return result.toString().trim();
    }

    private static String clean(String value) {
      return value
          .replaceAll("(?i)(Authorization:\\s*Bearer\\s+)\\S+", "$1***")
          .replaceAll("\\bsk-[A-Za-z0-9_-]{8,}\\b", "***")
          .replaceAll("(?i)((?:password|passwd|api[_-]?key|token|secret)\\s*[:=]\\s*)[^\\s,;}]+", "$1***")
          .replaceAll("[\\t ]+", " ")
          .replaceAll("\\n{3,}", "\n\n")
          .trim();
    }

    private static String truncate(String value, int maximum) {
      return value.length() <= maximum ? value : value.substring(0, maximum - 1) + "…";
    }
  }
}
