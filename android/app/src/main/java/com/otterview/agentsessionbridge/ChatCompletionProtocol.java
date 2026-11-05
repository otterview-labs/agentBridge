package com.otterview.agentsessionbridge;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Map;

/** Wire-format policy only. Transport, tool execution and history commits stay outside. */
final class ChatCompletionProtocol {
  private ChatCompletionProtocol() {}

  static String messageText(JSONObject message) {
    Object content = message.opt("content");
    if (content instanceof String) return ((String) content).trim();
    if (!(content instanceof JSONArray)) return "";
    StringBuilder text = new StringBuilder();
    JSONArray parts = (JSONArray) content;
    for (int i = 0; i < parts.length(); i++) {
      JSONObject part = parts.optJSONObject(i);
      if (part != null && part.optString("type").equals("text")) text.append(part.optString("text"));
    }
    return text.toString().trim();
  }

  static String readAnswerStream(InputStream stream, java.util.function.Consumer<String> onPartial) throws Exception {
    StringBuilder full = new StringBuilder();
    StringBuilder reasoning = new StringBuilder();
    boolean finished = false;
    Map<Integer, JSONObject> calls = new java.util.TreeMap<>();
    try (java.io.BufferedReader reader = new java.io.BufferedReader(
        new java.io.InputStreamReader(stream, StandardCharsets.UTF_8))) {
      String line;
      while ((line = reader.readLine()) != null) {
        if (!line.startsWith("data:")) continue;
        String data = line.substring(5).trim();
        if (data.isEmpty()) continue;
        if (data.equals("[DONE]")) { finished = true; break; }
        JSONObject chunk = new JSONObject(data);
        if (chunk.optJSONObject("error") != null) throw new IllegalStateException(UiText.text("管家回复失败，请重试"));
        JSONArray choices = chunk.optJSONArray("choices");
        if (choices == null || choices.length() == 0) continue;
        JSONObject choice = choices.getJSONObject(0);
        JSONObject delta = choice.optJSONObject("delta");
        if (delta != null) {
          String reasoningPart = delta.optString("reasoning_content", "");
          if (!reasoningPart.isEmpty() && !"null".equals(reasoningPart)) {
            reasoning.append(reasoningPart);
            if (reasoning.length() > 100_000) throw new IllegalStateException("模型推理过长");
          }
          JSONArray fragments = delta.optJSONArray("tool_calls");
          if (fragments != null) for (int i = 0; i < fragments.length(); i++) {
            JSONObject fragment = fragments.getJSONObject(i);
            if (!fragment.has("index")) throw new IllegalStateException("模型工具回复缺少编号");
            int index = fragment.getInt("index");
            JSONObject call = calls.get(index);
            if (call == null) {
              call = new JSONObject().put("type", "function").put("function", new JSONObject().put("name", "").put("arguments", ""));
              calls.put(index, call);
            }
            if (!fragment.optString("id").isEmpty()) call.put("id", fragment.optString("id"));
            JSONObject function = fragment.optJSONObject("function");
            if (function != null) for (String key : new String[]{"name", "arguments"}) {
              JSONObject target = call.getJSONObject("function");
              target.put(key, target.optString(key) + function.optString(key));
            }
          }
          String content = delta.optString("content", "");
          if (!content.isEmpty() && !"null".equals(content)) {
            full.append(content);
            if (full.length() > 100_000) throw new IllegalStateException("模型回复过长");
            onPartial.accept(full.toString());
          }
        }
        String reason = choice.optString("finish_reason", "");
        if ("stop".equals(reason) || "tool_calls".equals(reason)) finished = true;
        else if (!reason.isEmpty() && !"null".equals(reason)) throw new IllegalStateException("模型回复未完成，请重试");
      }
    }
    if (!finished) throw new IllegalStateException("模型回复中断，请重试");
    JSONObject message = new JSONObject().put("role", "assistant").put("content", full.toString());
    if (reasoning.length() > 0) message.put("reasoning_content", reasoning.toString());
    if (!calls.isEmpty()) {
      JSONArray toolCalls = new JSONArray();
      for (JSONObject call : calls.values()) {
        if (call.optString("id").isEmpty() || call.getJSONObject("function").optString("name").isEmpty()) {
          throw new IllegalStateException("模型工具回复不完整");
        }
        toolCalls.put(call);
      }
      message.put("tool_calls", toolCalls);
    } else if (full.toString().trim().isEmpty()) throw new IllegalStateException(UiText.text("管家模型没有返回有效文本"));
    return new JSONObject().put("choices", new JSONArray().put(new JSONObject().put("message", message))).toString();
  }

  static boolean kimiK3(JSONObject model) {
    String id = model.optString("modelId").toLowerCase(java.util.Locale.ROOT);
    if (id.startsWith("kimi-k3")) return true;
    try {
      URL url = new URL(model.optString("baseUrl"));
      return (url.getHost().equals("api.kimi.com") || url.getHost().equals("api.kimi.ai"))
          && url.getPath().startsWith("/coding/") && (id.equals("k3") || id.equals("k3-256k"));
    } catch (Exception ignored) { return false; }
  }

  static void applyRequestOptions(JSONObject request, JSONObject model) throws Exception {
    String id = model.optString("modelId").toLowerCase(java.util.Locale.ROOT);
    if (kimiK3(model)) {
      request.remove("temperature");
      request.remove("max_tokens");
      request.put("max_completion_tokens", 8192).put("reasoning_effort", "low");
    } else if (id.startsWith("kimi-")) {
      request.remove("temperature");
      if (id.startsWith("kimi-k2.6")) request.put("thinking", new JSONObject().put("type", "disabled"));
    }
    if (model.optString("baseUrl").contains("dashscope.aliyuncs.com")) request.put("enable_thinking", false);
  }

}
