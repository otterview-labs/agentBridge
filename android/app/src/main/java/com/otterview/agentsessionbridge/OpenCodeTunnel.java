package com.otterview.agentsessionbridge;

import com.jcraft.jsch.Session;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.Proxy;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Loopback-only HTTP carried inside the existing, host-key-verified SSH connection. */
final class OpenCodeTunnel implements OpenCodeClient.Transport, Closeable {
  private final Session session;
  private final int localPort;
  private final String authorization;

  OpenCodeTunnel(Session session, JSONObject machine) throws Exception {
    this.session = session;
    int port = machine.optInt("opencodePort", 0);
    String user = machine.optString("opencodeUsername", "opencode"), password = machine.optString("opencodePassword");
    if (port < 1 || port > 65535 || user.isEmpty() || user.contains(":") || password.isEmpty()) {
      throw new IllegalArgumentException(UiText.text("请在办公室高级设置填写 OpenCode 服务端口和密码"));
    }
    authorization = "Basic " + android.util.Base64.encodeToString((user + ":" + password)
        .getBytes(StandardCharsets.UTF_8), android.util.Base64.NO_WRAP);
    localPort = session.setPortForwardingL("127.0.0.1", 0, "127.0.0.1", port);
  }

  @Override public OpenCodeClient.Response request(String method, String path, JSONObject body) throws Exception {
    if (!path.startsWith("/") || path.startsWith("//") || path.contains("\r") || path.contains("\n")) {
      throw new IllegalArgumentException("Invalid OpenCode path");
    }
    HttpURLConnection connection = null;
    try {
      connection = (HttpURLConnection) new URL("http://127.0.0.1:" + localPort + path).openConnection(Proxy.NO_PROXY);
      connection.setInstanceFollowRedirects(false);
      connection.setConnectTimeout(12_000);
      connection.setReadTimeout(30_000);
      connection.setRequestMethod(method);
      connection.setRequestProperty("Authorization", authorization);
      connection.setRequestProperty("Accept", "application/json");
      if (body != null) {
        connection.setDoOutput(true);
        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        connection.setFixedLengthStreamingMode(bytes.length);
        try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
      }
      int status = connection.getResponseCode();
      // Error bodies are untrusted and may contain credentials; never expose or log them.
      if (status >= 300) return new OpenCodeClient.Response(status, "");
      return new OpenCodeClient.Response(status, read(connection.getInputStream()));
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  static String read(InputStream input) throws IOException {
    if (input == null) return "";
    try (InputStream stream = input; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[8192];
      int count;
      while ((count = stream.read(buffer)) != -1) {
        if (output.size() + count > 2_000_000) throw new IOException("OpenCode response exceeds 2 MB");
        output.write(buffer, 0, count);
      }
      return new String(output.toByteArray(), StandardCharsets.UTF_8);
    }
  }

  @Override public void close() throws IOException {
    try { session.delPortForwardingL("127.0.0.1", localPort); }
    catch (Exception ignored) { /* The owning SSH session may already be disconnected. */ }
  }
}
