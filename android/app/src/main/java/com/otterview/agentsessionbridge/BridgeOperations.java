package com.otterview.agentsessionbridge;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.function.LongSupplier;

/** Owns operation state and snapshots. Cleared operations are never resurrected by late workers. */
final class BridgeOperations {
  private final Map<Integer, JSONObject> entries = new LinkedHashMap<>();
  private final LongSupplier clock;

  BridgeOperations() { this(System::currentTimeMillis); }
  BridgeOperations(LongSupplier clock) { this.clock = clock; }

  synchronized JSONObject register(int id, String phase, String message, JSONObject extra) throws Exception {
    long now = clock.getAsLong();
    JSONObject operation = new JSONObject().put("id", id).put("state", "running")
        .put("phase", phase).put("message", UiText.text(message))
        .put("startedAt", now).put("updatedAt", now);
    if (extra != null) {
      Iterator<String> keys = extra.keys();
      while (keys.hasNext()) {
        String key = keys.next();
        operation.put(key, copy(extra.get(key)));
      }
    }
    prune();
    entries.put(id, operation);
    return new JSONObject(operation.toString());
  }

  synchronized JSONObject get(int id) throws Exception {
    JSONObject operation = entries.get(id);
    return operation == null ? null : new JSONObject(operation.toString());
  }

  synchronized void remove(int id) { entries.remove(id); }

  synchronized void mark(int id, String key, Object value) throws Exception {
    JSONObject operation = entries.get(id);
    if (operation != null) operation.put(key, copy(value));
  }

  synchronized void update(int id, String phase, String message, Object network, Object task) throws Exception {
    JSONObject operation = entries.get(id);
    if (operation == null) return;
    operation.put("state", terminal(phase) ? phase : "running").put("phase", phase)
        .put("message", UiText.text(message)).put("updatedAt", clock.getAsLong());
    if (network instanceof JSONObject || network != null && !String.valueOf(network).isEmpty()) {
      operation.put("network", copy(network));
    }
    if (task != null) operation.put("task", copy(task));
  }

  /** Publish the full result atomically with the terminal state. */
  synchronized void completeStudio(int id, String message, JSONObject studio) throws Exception {
    JSONObject operation = entries.get(id);
    if (operation == null) return;
    operation.put("studio", copy(studio)).put("state", "succeeded").put("phase", "succeeded")
        .put("message", UiText.text(message)).put("updatedAt", clock.getAsLong());
  }

  private static boolean terminal(String phase) {
    return "succeeded".equals(phase) || "failed".equals(phase);
  }

  private static Object copy(Object value) throws Exception {
    if (value instanceof JSONObject) return new JSONObject(value.toString());
    if (value instanceof JSONArray) return new JSONArray(value.toString());
    return value;
  }

  private void prune() {
    // Keep the existing page-polling retention policy and insertion ordering.
    Iterator<Map.Entry<Integer, JSONObject>> iterator = entries.entrySet().iterator();
    while (entries.size() >= 20 && iterator.hasNext()) {
      if (!"running".equals(iterator.next().getValue().optString("state"))) iterator.remove();
    }
    iterator = entries.entrySet().iterator();
    while (entries.size() >= 100 && iterator.hasNext()) {
      iterator.next();
      iterator.remove();
    }
  }
}
