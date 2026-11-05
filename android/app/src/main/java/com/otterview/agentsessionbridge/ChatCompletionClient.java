package com.otterview.agentsessionbridge;

import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Completion transport. Receives platform networking as a port, never an Activity. */
final class ChatCompletionClient {
  interface Connections { HttpURLConnection open(URL url) throws Exception; }
  private final Connections connections;
  private final Runnable networkFailure;

  ChatCompletionClient(Connections connections, Runnable networkFailure) {
    this.connections = connections;
    this.networkFailure = networkFailure;
  }

  String reply(JSONObject model, JSONArray messages) throws Exception {
    HttpURLConnection connection = null;
    try {
      connection = post(model, messages, null, null, false, 180_000);
      int status = connection.getResponseCode();
      InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
      String body = readBody(stream, 2_000_000);
      if (status >= 400) {
        throw new IllegalStateException(UiText.text("模型服务返回 HTTP ") + status + "，请检查模型名、密钥和额度");
      }
      JSONObject result = new JSONObject(body);
      JSONArray choices = result.optJSONArray("choices");
      if (choices == null || choices.length() == 0) {
        throw new IllegalStateException(UiText.text("模型服务没有返回回复"));
      }
      if ("length".equals(choices.getJSONObject(0).optString("finish_reason"))) throw new IllegalStateException("模型回复被截断，请缩小任务范围");
      String answer = choices.getJSONObject(0)
          .optJSONObject("message") == null ? "" : choices.getJSONObject(0)
          .getJSONObject("message").optString("content", "").trim();
      if (answer.isEmpty()) throw new IllegalStateException(UiText.text("模型服务返回了空回复"));
      return answer;
    } catch (java.io.IOException error) {
      if (error instanceof java.net.UnknownHostException) {
        networkFailure.run();
        throw new IllegalStateException(UiText.text("无法解析模型服务地址，请检查手机网络；网络正常仍失败时，完全退出 App 再打开"));
      }
      throw new IllegalStateException(UiText.text("模型连接失败或超时，请检查网络和服务状态"));
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  String complete(JSONObject model, JSONArray messages, JSONArray tools, String toolChoice) throws Exception {
    HttpURLConnection connection = null;
    try {
      connection = post(model, messages, tools, toolChoice, false, 120_000);
      int status = connection.getResponseCode();
      InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
      String body = readBody(stream, 2_000_000);
      if (status >= 400) {
        String detail = body.replace(model.getString("apiKey"), "[密钥已隐藏]").replaceAll("\\s+", " ").trim();
        String hint = status == 401 || status == 403 ? "，请检查 API Key、地域和调用权限"
            : status == 404 ? "，请检查 Base URL 和模型名称"
            : status == 429 ? "，额度不足或请求过于频繁，请检查服务商控制台" : "";
        throw new IllegalStateException(UiText.text("模型返回 HTTP ") + status
            + hint
            + (detail.isEmpty() ? "" : "：" + detail.substring(0, Math.min(detail.length(), 200))));
      }
      return body;
    } catch (java.io.IOException error) {
      if (error instanceof java.net.UnknownHostException) networkFailure.run();
      throw new IllegalStateException(UiText.text("模型连接失败：") + error.getMessage());
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  String stream(JSONObject model, JSONArray messages, JSONArray tools,
      java.util.function.Consumer<String> onPartial) throws Exception {
    HttpURLConnection connection = null;
    try {
      connection = post(model, messages, tools, null, true, 120_000);
      int status = connection.getResponseCode();
      if (status >= 400) {
        String body = readBody(connection.getErrorStream(), 100_000);
        // An explicit lack of streaming support can fall back before any answer arrived.
        if ((status == 400 || status == 422) && body.toLowerCase(java.util.Locale.ROOT).contains("stream")) {
          return complete(model, messages, tools, null);
        }
        String detail = body.replace(model.getString("apiKey"), "[密钥已隐藏]").replaceAll("\\s+", " ").trim();
        throw new IllegalStateException(UiText.text("模型返回 HTTP ") + status
            + (detail.isEmpty() ? "" : "：" + detail.substring(0, Math.min(detail.length(), 200))));
      }
      String type = connection.getContentType();
      if (type != null && type.toLowerCase(java.util.Locale.ROOT).contains("application/json")) {
        String body = readBody(connection.getInputStream(), 2_000_000);
        JSONObject message = new JSONObject(body).getJSONArray("choices").getJSONObject(0).getJSONObject("message");
        String answer = ChatCompletionProtocol.messageText(message);
        if (!answer.isEmpty()) onPartial.accept(answer);
        return body;
      }
      return ChatCompletionProtocol.readAnswerStream(connection.getInputStream(), onPartial);
    } catch (IOException error) {
      if (error instanceof java.net.UnknownHostException) networkFailure.run();
      // Do not silently submit a second request after a partial answer or timeout.
      throw new IllegalStateException(UiText.text("模型连接失败：") + error.getMessage());
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  private HttpURLConnection post(JSONObject model, JSONArray messages, JSONArray tools,
      String toolChoice, boolean stream, int readTimeout) throws Exception {
    HttpURLConnection connection = connections.open(new URL(model.getString("baseUrl") + "/chat/completions"));
    try {
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(readTimeout);
      connection.setDoOutput(true);
      connection.setRequestProperty("Authorization", "Bearer " + model.getString("apiKey"));
      connection.setRequestProperty("Content-Type", "application/json");
      if (stream) connection.setRequestProperty("Accept", "text/event-stream");
      JSONObject request = new JSONObject().put("model", model.getString("modelId"))
          .put("messages", messages).put("max_tokens", 1800).put("temperature", 0.2);
      if (stream) request.put("stream", true);
      if (tools != null && tools.length() > 0) {
        request.put("tools", tools);
        if (toolChoice != null) request.put("tool_choice", toolChoice);
      }
      ChatCompletionProtocol.applyRequestOptions(request, model);
      byte[] payload = request.toString().getBytes(StandardCharsets.UTF_8);
      connection.setFixedLengthStreamingMode(payload.length);
      try (OutputStream output = connection.getOutputStream()) { output.write(payload); }
      return connection;
    } catch (Exception error) {
      // A failure before post returns must also release the opened connection.
      connection.disconnect();
      throw error;
    }
  }

  static String readBody(InputStream input, int maximum) throws Exception {
    if (input == null) return "";
    ByteArrayOutputStream output = new ByteArrayOutputStream();
    byte[] buffer = new byte[8192];
    int read;
    while ((read = input.read(buffer)) != -1) {
      if (output.size() + read > maximum) throw new IllegalStateException(UiText.text("模型服务响应过大"));
      output.write(buffer, 0, read);
    }
    return output.toString("UTF-8");
  }

}
