package com.otterview.agentsessionbridge;

import org.json.JSONObject;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Voice credentials are independent from chat credentials and remain in the sealed store. */
final class VoiceService {
  static final String BAILIAN_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
  static final String DOUBAO_URL = "https://openspeech.bytedance.com";
  interface Connections { HttpURLConnection open(URL url) throws Exception; }
  interface Pending { void track(HttpURLConnection connection) throws Exception; }

  static JSONObject config(JSONObject stored) throws Exception {
    String provider = stored.optString("provider", stored.optString("apiKey", "").isEmpty() ? "system" : "bailian");
    JSONObject profiles = stored.optJSONObject("profiles");
    JSONObject profile = profiles == null ? stored : profiles.optJSONObject(provider);
    if (profile == null) profile = new JSONObject();
    JSONObject result = new JSONObject(profile.toString()).put("provider", provider);
    if (provider.equals("bailian")) result.put("baseUrl", BAILIAN_URL).put("asrModel", "qwen3-asr-flash").put("ttsModel", "qwen3-tts-flash").put("voice", "Cherry");
    if (provider.equals("doubao")) return result.put("baseUrl", DOUBAO_URL)
        .put("asrModel", "doubao-seed-asr-2.0").put("ttsModel", "").put("voice", "");
    if (provider.equals("sherpa")) return result.put("baseUrl", "").put("apiKey", "")
        .put("asrModel", "xasr-zh-en-int8").put("ttsModel", "").put("voice", "");
    if (provider.equals("openai")) result.put("baseUrl", "https://api.openai.com/v1");
    if (!result.has("asrModel")) result.put("asrModel", provider.equals("openai") ? "gpt-4o-mini-transcribe" : "whisper-1");
    if (!result.has("ttsModel")) result.put("ttsModel", provider.equals("openai") ? "gpt-4o-mini-tts" : "tts-1");
    if (!result.has("voice")) result.put("voice", "alloy");
    return result;
  }

  static JSONObject save(JSONObject stored, JSONObject input) throws Exception {
    JSONObject active = config(stored);
    String provider = input.optString("provider", active.optString("provider"));
    if (!provider.matches("system|sherpa|bailian|doubao|openai|custom")) throw new IllegalArgumentException(UiText.text("不支持的语音服务"));
    JSONObject profiles = stored.optJSONObject("profiles");
    profiles = profiles == null ? new JSONObject() : new JSONObject(profiles.toString());
    if (!active.optString("provider").equals("system")) profiles.put(active.optString("provider"), active);
    JSONObject old = profiles.optJSONObject(provider);
    if (old == null) old = new JSONObject();
    JSONObject next = new JSONObject(input.toString()).put("provider", provider);
    boolean local = isLocal(provider);
    String url = local ? "" : provider.equals("bailian") ? BAILIAN_URL : provider.equals("doubao") ? DOUBAO_URL : provider.equals("openai") ? "https://api.openai.com/v1" : input.optString("baseUrl", old.optString("baseUrl", "")).trim();
    while (url.endsWith("/")) url = url.substring(0, url.length() - 1);
    if (!local) {
      URL parsed;
      try { parsed = new URL(url); }
      catch (java.net.MalformedURLException error) { throw new IllegalArgumentException(UiText.text("请填写有效的 HTTPS 语音服务地址")); }
      if (!parsed.getProtocol().equals("https") || parsed.getHost().isEmpty() || parsed.getUserInfo() != null || parsed.getQuery() != null || parsed.getRef() != null || url.length() > 2048) {
        throw new IllegalArgumentException(UiText.text("语音服务地址需为 HTTPS Base URL，且不能包含密钥或查询参数"));
      }
    }
    String key = input.optString("apiKey", "").trim();
    if (input.optBoolean("clear")) key = "";
    else if (key.isEmpty() && url.equals(old.optString("baseUrl"))) key = old.optString("apiKey", "");
    if (key.length() > 4096 || key.contains("\n") || key.contains("\r")) throw new IllegalArgumentException(UiText.text("语音 API Key 格式不正确"));
    next.remove("clear");
    next.put("baseUrl", url).put("apiKey", local ? "" : key);
    for (String field : new String[]{"asrModel", "ttsModel", "voice"}) {
      String value = input.optString(field, old.optString(field, "")).trim();
      if (value.length() > 128 || value.contains("\n") || value.contains("\r")) throw new IllegalArgumentException(UiText.text("语音模型或音色格式不正确"));
      if (value.isEmpty()) next.remove(field); else next.put(field, value);
    }
    next = config(new JSONObject().put("provider", provider).put("profiles", new JSONObject().put(provider, next)));
    profiles.put(provider, next);
    return new JSONObject().put("provider", provider).put("profiles", profiles);
  }

  static boolean isLocal(String provider) {
    return provider.equals("system") || provider.equals("sherpa");
  }

  static JSONObject publicConfig(JSONObject config) throws Exception {
    JSONObject result = new JSONObject();
    for (String field : new String[]{"provider", "baseUrl", "asrModel", "ttsModel", "voice"}) result.put(field, config.optString(field, ""));
    return result.put("hasVoiceKey", !config.optString("apiKey", "").isEmpty());
  }

  static HttpURLConnection request(JSONObject config, String path, String type, byte[] payload,
      Connections connections, Pending pending) throws Exception {
    HttpURLConnection connection = connections.open(new URL(config.getString("baseUrl") + path));
    try {
      if (pending != null) pending.track(connection);
      connection.setInstanceFollowRedirects(false);
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(60_000);
      connection.setDoOutput(true);
      String key = config.optString("apiKey", "");
      if (key.isEmpty()) throw new IllegalStateException(UiText.text("请先保存所选语音服务的 API Key"));
      connection.setRequestProperty("Authorization", "Bearer " + key);
      connection.setRequestProperty("Content-Type", type);
      connection.setFixedLengthStreamingMode(payload.length);
      try (OutputStream output = connection.getOutputStream()) { output.write(payload); }
      int status = connection.getResponseCode();
      if (status < 200 || status >= 300) throw new IllegalStateException(UiText.text("语音服务返回 HTTP ") + status);
      return connection;
    } catch (Exception error) { connection.disconnect(); throw error; }
  }

  static byte[] read(InputStream stream, int limit) throws Exception {
    if (stream == null) throw new java.io.IOException("Empty voice response");
    try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      byte[] chunk = new byte[8192]; int length;
      while ((length = input.read(chunk)) != -1) {
        if (Thread.currentThread().isInterrupted()) throw new java.io.IOException("Voice cancelled");
        if (output.size() + length > limit) throw new java.io.IOException("Voice response too large");
        output.write(chunk, 0, length);
      }
      if (output.size() == 0) throw new java.io.IOException("Empty voice response");
      return output.toByteArray();
    }
  }

  static byte[] transcriptionBody(String boundary, String model, byte[] audio) throws Exception {
    ByteArrayOutputStream body = new ByteArrayOutputStream();
    String prefix = "--" + boundary + "\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n" + model
        + "\r\n--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"recording.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n";
    body.write(prefix.getBytes(StandardCharsets.UTF_8)); body.write(audio);
    body.write(("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8));
    return body.toByteArray();
  }

  static String transcribe(JSONObject config, byte[] audio, Connections connections, Pending pending) throws Exception {
    String boundary = "AgentBridge" + java.util.UUID.randomUUID().toString().replace("-", "");
    HttpURLConnection connection = request(config, "/audio/transcriptions", "multipart/form-data; boundary=" + boundary,
        transcriptionBody(boundary, config.getString("asrModel"), audio), connections, pending);
    try {
      String text = new JSONObject(new String(read(connection.getInputStream(), 1_000_000), StandardCharsets.UTF_8)).optString("text", "").trim();
      if (text.isEmpty()) throw new IllegalStateException(UiText.text("没有识别到文字"));
      return text;
    } finally { connection.disconnect(); }
  }

  static byte[] synthesize(JSONObject config, String text, Connections connections, Pending pending) throws Exception {
    String safeText = text == null ? "" : text.trim();
    if (safeText.isEmpty()) throw new IllegalArgumentException("Empty speech text");
    if (safeText.length() > 1500) safeText = safeText.substring(0, 1500);
    byte[] payload = new JSONObject().put("model", config.getString("ttsModel"))
        .put("input", safeText).put("voice", config.getString("voice")).put("response_format", "mp3")
        .toString().getBytes(StandardCharsets.UTF_8);
    HttpURLConnection connection = request(config, "/audio/speech", "application/json", payload, connections, pending);
    try {
      String type = connection.getContentType();
      if (type != null && !type.toLowerCase(java.util.Locale.ROOT).startsWith("audio/") && !type.toLowerCase(java.util.Locale.ROOT).startsWith("application/octet-stream")) throw new java.io.IOException("Voice response is not audio");
      return read(connection.getInputStream(), 8_000_000);
    } finally { connection.disconnect(); }
  }
}
