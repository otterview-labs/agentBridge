package com.otterview.agentsessionbridge;

import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** Bounded NDJSON over an existing SSH channel. No credentials in shell arguments. */
final class PiButlerProtocol {
  interface Query { String run(String name, JSONObject args) throws Exception; }

  static String command(String workerPath) {
    if (workerPath == null || !workerPath.startsWith("/") || workerPath.length() > 1024
        || workerPath.contains("\n") || workerPath.contains("\r") || workerPath.indexOf('\0') >= 0) {
      throw new IllegalArgumentException("Pi worker path must be absolute");
    }
    return "export PATH=\"$HOME/bin:$HOME/.local/bin:$HOME/.npm-global/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH\"\n"
        + "exec node '" + workerPath.replace("'", "'\\''") + "'";
  }

  static String taskScope(JSONObject machine, JSONObject task) throws Exception {
    String sessionId = task.optString("externalSessionId");
    if (sessionId.isEmpty()) sessionId = task.optString("sessionId");
    if (sessionId.isEmpty()) throw new IllegalArgumentException("Task has no stable session ID");
    String key = new org.json.JSONArray().put(machine.optString("host"))
        .put(machine.opt("port")).put(machine.optString("username"))
        .put(task.optString("agentType")).put(sessionId).toString();
    byte[] bytes = MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8));
    StringBuilder hash = new StringBuilder("task-");
    for (byte value : bytes) hash.append(String.format(java.util.Locale.ROOT, "%02x", value & 255));
    return hash.toString();
  }

  static void write(OutputStream stream, JSONObject frame) throws Exception {
    byte[] bytes = (frame.toString() + "\n").getBytes(StandardCharsets.UTF_8);
    if (bytes.length > 256000) throw new IllegalArgumentException("Pi request too large");
    stream.write(bytes);
    stream.flush();
  }

  static String exchange(InputStream output, OutputStream input, JSONObject request,
      BooleanSupplier active, Query query, Consumer<String> partial, Consumer<String> progress,
      int timeoutMillis) throws Exception {
    write(input, request);
    ByteArrayOutputStream line = new ByteArrayOutputStream();
    StringBuilder text = new StringBuilder();
    long deadline = System.nanoTime() + java.util.concurrent.TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
    int total = 0, calls = 0;
    while (System.nanoTime() < deadline) {
      if (output.available() == 0) {
        if (!active.getAsBoolean()) throw new IllegalStateException("Pi SSH connection ended before an answer");
        Thread.sleep(20);
        continue;
      }
      int value = output.read();
      if (value < 0) throw new IllegalStateException("Pi response interrupted");
      if (++total > 2000000 || line.size() > 256000) throw new IllegalStateException("Pi response too large");
      if (value != '\n') { line.write(value); continue; }
      JSONObject event = new JSONObject(line.toString(StandardCharsets.UTF_8.name()));
      line.reset();
      if (event.optInt("protocol") != 1) throw new IllegalStateException("Unsupported Pi protocol");
      switch (event.optString("type")) {
        case "ready": break;
        case "delta":
          text.append(event.optString("text"));
          if (text.length() > 64000) throw new IllegalStateException("Pi answer too large");
          partial.accept(text.toString());
          break;
        case "progress":
          text.setLength(0);
          partial.accept("");
          progress.accept(event.optString("tool"));
          break;
        case "tool_request":
          if (++calls > 12) throw new IllegalStateException("Pi tool limit reached");
          String name = event.optString("name");
          String result;
          if (!name.equals("list_tasks") && !name.equals("check_machines") && !name.equals("get_task_output")) {
            result = new JSONObject().put("error", "Tool is unavailable").toString();
          } else result = query.run(name, event.getJSONObject("args"));
          write(input, new JSONObject().put("type", "tool_result").put("id", event.getString("id")).put("result", result));
          break;
        case "done":
          String answer = event.optString("answer").trim();
          if (answer.isEmpty() || answer.length() > 64000) throw new IllegalStateException("Pi returned an invalid answer");
          return answer;
        case "error": throw new IllegalStateException("Pi request failed; check computer configuration and memory scope");
        default: throw new IllegalStateException("Invalid Pi event");
      }
    }
    throw new IllegalStateException("Pi reply timed out; check the computer before retrying");
  }
}
