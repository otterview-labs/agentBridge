package com.otterview.agentsessionbridge;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.util.Log;

import com.jcraft.jsch.HostKey;
import com.jcraft.jsch.HostKeyRepository;
import com.jcraft.jsch.UserInfo;

import org.json.JSONArray;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Private, JSON-backed storage for the phone-first controller. */
final class BridgeStore {
  private static final String PREFS = "phone_controller_v1";
  private static final String KEY_MACHINES = "machines";
  private static final String KEY_TASKS = "tasks";
  private static final String KEY_DELETED_TASKS = "deleted_tasks";
  private static final String KEY_FRP_SERVER = "frp_server";
  private static final String KEY_FRP_RELAYS = "frp_relays";
  private static final String KEY_HOST_KEYS = "host_keys";
  private static final String KEY_SEQUENCE = "id_sequence";
  private static final String KEY_STUDIO_MODEL = "studio_model";
  private static final String KEY_STUDIO_VOICE = "studio_voice";

  private final SharedPreferences prefs;
  private final SecretBox secrets = new SecretBox();
  /** Plain values of sealed keys, so reads do not pay a Keystore round trip each time. */
  private final Map<String, String> sealedCache = new HashMap<>();

  private static BridgeStore instance;
  private boolean studioTurnActive;

  /**
   * One store per process: an Activity recreated mid-operation must not get a
   * second copy whose lock and cache disagree with the one its old threads use.
   */
  static synchronized BridgeStore get(Context context) {
    if (instance == null) instance = new BridgeStore(context.getApplicationContext());
    return instance;
  }

  private BridgeStore(Context context) {
    prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
  }

  // Machines (SSH passwords and private keys), the FRP server (auth token),
  // relays (STCP secrets) and the model (API key) hold credentials, so their
  // JSON is sealed with a Keystore key before it reaches disk.

  synchronized JSONArray machines() throws Exception {
    return new JSONArray(readSealed(KEY_MACHINES, "[]"));
  }

  synchronized void saveMachines(JSONArray value) {
    writeSealed(prefs.edit(), KEY_MACHINES, value.toString()).apply();
  }

  synchronized JSONArray tasks() throws Exception {
    return new JSONArray(prefs.getString(KEY_TASKS, "[]"));
  }

  synchronized JSONArray deletedTasks() throws Exception {
    return new JSONArray(prefs.getString(KEY_DELETED_TASKS, "[]"));
  }

  synchronized void saveDeletedTasks(JSONArray value) {
    prefs.edit().putString(KEY_DELETED_TASKS, value.toString()).apply();
  }

  synchronized JSONArray studioMemories() throws Exception {
    return new JSONArray(prefs.getString("studio_memories", "[]"));
  }

  synchronized void saveStudioMemories(JSONArray value) {
    if (!prefs.edit().putString("studio_memories", value.toString()).commit()) {
      throw new IllegalStateException(UiText.text("记忆保存失败，请检查手机存储空间"));
    }
  }

  synchronized JSONObject studioModel() throws Exception {
    String value = readSealed(KEY_STUDIO_MODEL, "");
    return value.trim().isEmpty() ? new JSONObject() : new JSONObject(value);
  }

  synchronized void saveStudioModel(JSONObject value) {
    if (!writeSealed(prefs.edit(), KEY_STUDIO_MODEL, value.toString()).commit()) {
      throw new IllegalStateException(UiText.text("模型配置保存失败，请检查手机存储空间"));
    }
  }

  synchronized JSONArray studioMessages() throws Exception {
    return new JSONArray(prefs.getString("studio_messages", "[]"));
  }

  synchronized JSONObject studioVoice() throws Exception {
    return new JSONObject(readSealed(KEY_STUDIO_VOICE, "{}"));
  }

  synchronized void saveStudioVoice(JSONObject value) {
    if (!writeSealed(prefs.edit(), KEY_STUDIO_VOICE, value.toString()).commit()) {
      throw new IllegalStateException(UiText.text("语音配置保存失败，请检查手机存储空间"));
    }
  }

  synchronized void saveStudioMessages(JSONArray value) {
    if (!prefs.edit().putString("studio_messages", value.toString()).commit()) {
      throw new IllegalStateException(UiText.text("管家对话保存失败，请检查手机存储空间"));
    }
  }

  /** Appends one chat message under the store lock so concurrent replies never drop each other. */
  synchronized void appendStudioMessage(JSONObject message, int limit) throws Exception {
    JSONArray messages = studioMessages();
    messages.put(message);
    while (messages.length() > limit) messages.remove(0);
    saveStudioMessages(messages);
  }

  synchronized boolean beginStudioTurn() {
    if (studioTurnActive) return false;
    studioTurnActive = true;
    return true;
  }

  synchronized void endStudioTurn() {
    studioTurnActive = false;
  }

  /** Publish both sides with one commit; a failed save must never leave half a turn. */
  synchronized JSONObject appendStudioTurn(String user, String answer, String createdAt, String turnId) throws Exception {
    JSONArray messages = studioMessages();
    JSONObject reply = new JSONObject().put("id", turnId + "-assistant")
        .put("role", "assistant").put("content", answer).put("createdAt", createdAt);
    messages.put(new JSONObject().put("id", turnId + "-user")
        .put("role", "user").put("content", user).put("createdAt", createdAt));
    messages.put(reply);
    while (messages.length() > 100) messages.remove(0);
    while (messages.length() > 0 && !"user".equals(messages.getJSONObject(0).optString("role"))) {
      messages.remove(0);
    }
    saveStudioMessages(messages);
    return reply;
  }

  synchronized JSONArray studioReports() throws Exception {
    return new JSONArray(prefs.getString("studio_reports", "[]"));
  }

  synchronized void saveStudioReports(JSONArray value) {
    if (!prefs.edit().putString("studio_reports", value.toString()).commit()) {
      throw new IllegalStateException(UiText.text("任务规划保存失败，请检查手机存储空间"));
    }
  }

  synchronized void saveTasks(JSONArray value) {
    prefs.edit().putString(KEY_TASKS, value.toString()).apply();
  }

  synchronized JSONObject frpServer() throws Exception {
    String value = readSealed(KEY_FRP_SERVER, "");
    return value.trim().isEmpty() ? null : new JSONObject(value);
  }

  synchronized void saveFrpServer(JSONObject value) {
    writeSealed(prefs.edit(), KEY_FRP_SERVER, value.toString()).apply();
  }

  synchronized void clearFrpServer() {
    sealedCache.remove(KEY_FRP_SERVER);
    prefs.edit().remove(KEY_FRP_SERVER).apply();
  }

  synchronized JSONArray frpRelays() throws Exception {
    return new JSONArray(readSealed(KEY_FRP_RELAYS, "[]"));
  }

  synchronized void saveFrpRelays(JSONArray value) {
    writeSealed(prefs.edit(), KEY_FRP_RELAYS, value.toString()).apply();
  }

  synchronized JSONObject frpRelay(int machineId) throws Exception {
    JSONArray items = frpRelays();
    for (int index = 0; index < items.length(); index += 1) {
      JSONObject item = items.getJSONObject(index);
      if (item.getInt("machineId") == machineId) return item;
    }
    return null;
  }

  synchronized void updateFrpRelay(JSONObject relay) throws Exception {
    JSONArray items = frpRelays();
    boolean replaced = false;
    for (int index = 0; index < items.length(); index += 1) {
      if (items.getJSONObject(index).getInt("machineId") == relay.getInt("machineId")) {
        items.put(index, relay);
        replaced = true;
        break;
      }
    }
    if (!replaced) items.put(relay);
    saveFrpRelays(items);
  }

  synchronized JSONObject machine(int id) throws Exception {
    JSONArray items = machines();
    for (int index = 0; index < items.length(); index += 1) {
      JSONObject item = items.getJSONObject(index);
      if (item.getInt("id") == id) return item;
    }
    throw new IllegalArgumentException(UiText.text("机器不存在"));
  }

  synchronized JSONObject task(int id) throws Exception {
    JSONArray items = tasks();
    for (int index = 0; index < items.length(); index += 1) {
      JSONObject item = items.getJSONObject(index);
      if (item.getInt("id") == id) return item;
    }
    throw new IllegalArgumentException(UiText.text("任务不存在"));
  }

  synchronized int nextId() {
    int value = prefs.getInt(KEY_SEQUENCE, 0) + 1;
    prefs.edit().putInt(KEY_SEQUENCE, value).apply();
    return value;
  }

  synchronized void updateMachine(JSONObject machine) throws Exception {
    JSONArray items = machines();
    int id = machine.getInt("id");
    boolean replaced = false;
    for (int index = 0; index < items.length(); index += 1) {
      if (items.getJSONObject(index).getInt("id") == id) {
        items.put(index, machine);
        replaced = true;
        break;
      }
    }
    if (!replaced) items.put(machine);
    saveMachines(items);
  }

  /**
   * Merges fields into the stored machine. Long SSH operations use this
   * instead of writing back a copy read minutes earlier, which would undo
   * edits the user made in the meantime. Returns the merged machine, or null
   * when it was deleted while the operation ran.
   */
  synchronized JSONObject patchMachine(int id, JSONObject fields) throws Exception {
    JSONArray items = machines();
    for (int index = 0; index < items.length(); index += 1) {
      JSONObject item = items.getJSONObject(index);
      if (item.getInt("id") != id) continue;
      merge(item, fields);
      saveMachines(items);
      return item;
    }
    return null;
  }

  /** Same as {@link #patchMachine} for tasks. */
  synchronized JSONObject patchTask(int id, JSONObject fields) throws Exception {
    JSONArray items = tasks();
    for (int index = 0; index < items.length(); index += 1) {
      JSONObject item = items.getJSONObject(index);
      if (item.getInt("id") != id) continue;
      merge(item, fields);
      saveTasks(items);
      return item;
    }
    return null;
  }

  private static void merge(JSONObject target, JSONObject fields) throws Exception {
    Iterator<String> keys = fields.keys();
    while (keys.hasNext()) {
      String key = keys.next();
      target.put(key, fields.get(key));
    }
  }

  synchronized void deleteMachine(int id) throws Exception {
    JSONObject removed = null;
    JSONArray machines = machines();
    JSONArray keptMachines = new JSONArray();
    for (int index = 0; index < machines.length(); index += 1) {
      JSONObject item = machines.getJSONObject(index);
      if (item.getInt("id") != id) keptMachines.put(item);
      else removed = item;
    }

    JSONArray tasks = tasks();
    JSONArray keptTasks = new JSONArray();
    for (int index = 0; index < tasks.length(); index += 1) {
      if (tasks.getJSONObject(index).getInt("machineId") != id) keptTasks.put(tasks.get(index));
    }
    JSONArray deletedTasks = deletedTasks();
    JSONArray keptDeletedTasks = new JSONArray();
    for (int index = 0; index < deletedTasks.length(); index += 1) {
      if (deletedTasks.getJSONObject(index).getInt("machineId") != id) {
        keptDeletedTasks.put(deletedTasks.get(index));
      }
    }

    // One editor, one write: a process killed halfway can no longer leave
    // tasks or relays pointing at a machine that is already gone.
    SharedPreferences.Editor editor = prefs.edit();
    writeSealed(editor, KEY_MACHINES, keptMachines.toString());
    editor.putString(KEY_TASKS, keptTasks.toString());
    editor.putString(KEY_DELETED_TASKS, keptDeletedTasks.toString());
    JSONObject server = frpServer();
    if (server != null && server.getInt("machineId") == id) {
      editor.remove(KEY_FRP_SERVER);
      sealedCache.remove(KEY_FRP_SERVER);
      writeSealed(editor, KEY_FRP_RELAYS, "[]");
    } else {
      JSONArray relays = frpRelays();
      JSONArray keptRelays = new JSONArray();
      for (int index = 0; index < relays.length(); index += 1) {
        if (relays.getJSONObject(index).getInt("machineId") != id) keptRelays.put(relays.get(index));
      }
      writeSealed(editor, KEY_FRP_RELAYS, keptRelays.toString());
    }
    if (removed != null) {
      JSONObject hostKeys = readHostKeys();
      for (String alias : hostAliases(removed)) hostKeys.remove(alias);
      editor.putString(KEY_HOST_KEYS, hostKeys.toString());
    }
    editor.apply();
  }

  /** Commit a scan against the records it started with, under the same lock as edits. */
  synchronized JSONArray replaceTasksForMachine(int machineId, JSONArray replacement, JSONArray baseline) throws Exception {
    machine(machineId); // A late scan must not restore tasks belonging to a deleted machine.
    JSONArray all = tasks();
    JSONArray merged = new JSONArray();
    JSONArray visible = new JSONArray();
    for (int index = 0; index < all.length(); index += 1) {
      if (all.getJSONObject(index).getInt("machineId") != machineId) merged.put(all.get(index));
    }
    for (int index = 0; index < replacement.length(); index += 1) {
      JSONObject incoming = replacement.getJSONObject(index);
      if (isDeletedTask(incoming)) continue;
      JSONObject current = matchingTask(all, incoming);
      if (current != null) {
        JSONObject before = matchingTask(baseline, current);
        // A reply, rename or another refresh may have completed during SSH reads.
        // Keep every field changed since this scan began; unchanged fields can refresh.
        preserveChangedFields(incoming, current, before);
        incoming.put("id", current.getInt("id"));
        String customTitle = current.optString("customTitle", "");
        if (!customTitle.isEmpty()) incoming.put("customTitle", customTitle).put("title", customTitle);
      }
      if (matchingTask(visible, incoming) == null) visible.put(incoming);
    }
    for (int index = 0; index < all.length(); index += 1) {
      JSONObject current = all.getJSONObject(index);
      if (current.getInt("machineId") != machineId || matchingTask(visible, current) != null) continue;
      JSONObject before = matchingTask(baseline, current);
      if (before == null || taskRecordChanged(current, before)) visible.put(current);
    }
    for (int index = 0; index < visible.length(); index += 1) merged.put(visible.get(index));
    saveTasks(merged);
    return visible;
  }

  private JSONObject matchingTask(JSONArray records, JSONObject task) throws Exception {
    for (int index = 0; index < records.length(); index += 1) {
      JSONObject item = records.getJSONObject(index);
      if (item.getInt("machineId") == task.getInt("machineId") && sameTaskIdentity(item, task)) return item;
    }
    return null;
  }

  private boolean taskRecordChanged(JSONObject current, JSONObject before) throws Exception {
    Iterator<String> keys = current.keys();
    while (keys.hasNext()) {
      String key = keys.next();
      if (!String.valueOf(current.opt(key)).equals(String.valueOf(before.opt(key)))) return true;
    }
    keys = before.keys();
    while (keys.hasNext()) {
      String key = keys.next();
      if (!String.valueOf(current.opt(key)).equals(String.valueOf(before.opt(key)))) return true;
    }
    return false;
  }

  private void preserveChangedFields(JSONObject incoming, JSONObject current, JSONObject before) throws Exception {
    // A reply is one record: unchanged status/decision fields still belong to
    // the new output and must not be mixed with an older scan's progress.
    String[] progressFields = { "lastOutput", "workSummary", "status", "requiredInput", "suggestedReply" };
    boolean progressChanged = before == null;
    for (String key : progressFields) {
      if (before == null || !String.valueOf(current.opt(key)).equals(String.valueOf(before.opt(key)))) {
        progressChanged = true;
      }
    }
    if (progressChanged) {
      for (String key : progressFields) incoming.put(key, current.opt(key));
    }
    Iterator<String> keys = current.keys();
    while (keys.hasNext()) {
      String key = keys.next();
      if (before == null || !String.valueOf(current.opt(key)).equals(String.valueOf(before.opt(key)))) {
        incoming.put(key, current.opt(key));
      }
    }
    if (before != null) {
      keys = before.keys();
      while (keys.hasNext()) {
        String key = keys.next();
        if (current.opt(key) == null) incoming.remove(key);
      }
    }
  }

  synchronized void updateTask(JSONObject task) throws Exception {
    JSONArray items = tasks();
    int id = task.getInt("id");
    for (int index = 0; index < items.length(); index += 1) {
      if (items.getJSONObject(index).getInt("id") == id) {
        items.put(index, task);
        saveTasks(items);
        return;
      }
    }
    items.put(task);
    saveTasks(items);
  }

  synchronized void deleteTask(int id) throws Exception {
    JSONArray tasks = tasks();
    JSONArray keptTasks = new JSONArray();
    JSONObject deleted = null;
    for (int index = 0; index < tasks.length(); index += 1) {
      JSONObject task = tasks.getJSONObject(index);
      if (task.getInt("id") == id) {
        deleted = task;
        deleted.put("deletedAt", now());
      } else {
        keptTasks.put(tasks.get(index));
      }
    }
    if (deleted == null) throw new IllegalArgumentException(UiText.text("员工不存在"));

    JSONArray deletedTasks = deletedTasks();
    JSONArray keptDeleted = new JSONArray();
    boolean replaced = false;
    for (int index = 0; index < deletedTasks.length(); index += 1) {
      JSONObject item = deletedTasks.getJSONObject(index);
      if (item.getInt("machineId") == deleted.getInt("machineId")
          && sameTaskIdentity(item, deleted)) {
        if (!replaced) {
          keptDeleted.put(deleted);
          replaced = true;
        }
      } else {
        keptDeleted.put(deletedTasks.get(index));
      }
    }
    if (!replaced) keptDeleted.put(deleted);
    while (keptDeleted.length() > 200) keptDeleted.remove(0);
    saveTasks(keptTasks);
    saveDeletedTasks(keptDeleted);
  }

  synchronized void restoreDeletedTask(int id) throws Exception {
    JSONArray deletedTasks = deletedTasks();
    JSONArray keptDeletedTasks = new JSONArray();
    JSONObject restored = null;
    for (int index = 0; index < deletedTasks.length(); index += 1) {
      JSONObject item = deletedTasks.getJSONObject(index);
      if (item.getInt("id") == id) restored = item;
      else keptDeletedTasks.put(deletedTasks.get(index));
    }
    if (restored == null) throw new IllegalArgumentException(UiText.text("已删除员工不存在"));
    restored.remove("deletedAt");
    JSONArray tasks = tasks();
    JSONArray keptTasks = new JSONArray();
    boolean replaced = false;
    for (int index = 0; index < tasks.length(); index += 1) {
      JSONObject item = tasks.getJSONObject(index);
      if (item.getInt("machineId") == restored.getInt("machineId") && sameTaskIdentity(item, restored)) {
        if (!replaced) {
          keptTasks.put(restored);
          replaced = true;
        }
      } else {
        keptTasks.put(tasks.get(index));
      }
    }
    if (!replaced) keptTasks.put(restored);
    saveTasks(keptTasks);
    saveDeletedTasks(keptDeletedTasks);
  }

  synchronized boolean isDeletedTask(JSONObject task) throws Exception {
    JSONArray deletedTasks = deletedTasks();
    for (int index = 0; index < deletedTasks.length(); index += 1) {
      JSONObject item = deletedTasks.getJSONObject(index);
      if (item.getInt("machineId") == task.getInt("machineId") && sameTaskIdentity(item, task)) return true;
    }
    return false;
  }

  private boolean sameTaskIdentity(JSONObject left, JSONObject right) {
    String leftSession = left.optString("externalSessionId", "");
    String rightSession = right.optString("externalSessionId", "");
    String leftAgent = left.optString("agentType", "");
    String rightAgent = right.optString("agentType", "");
    if (!leftAgent.equals(rightAgent)) return false;
    if (!leftSession.isEmpty() && !rightSession.isEmpty()) return leftSession.equals(rightSession);
    String stableKey = left.optString("stableKey", "");
    return !stableKey.isEmpty() && stableKey.equals(right.optString("stableKey", ""));
  }

  private String now() {
    return java.time.format.DateTimeFormatter.ISO_INSTANT.format(java.time.Instant.now());
  }

  // --- Sealed values -------------------------------------------------------

  private String readSealed(String key, String fallback) {
    String cached = sealedCache.get(key);
    if (cached != null) return cached;
    String raw = prefs.getString(key, null);
    if (raw == null) return fallback;
    if (!SecretBox.isSealed(raw)) {
      // Written by a release that stored credentials in plain text: seal it
      // now so upgrading is enough to get the plain copy off disk.
      writeSealed(prefs.edit(), key, raw).apply();
      return raw;
    }
    boolean keyExists;
    try {
      keyExists = secrets.hasKey();
    } catch (Exception error) {
      throw unreadable(key, error);
    }
    if (!keyExists) {
      // The Keystore key is gone for good (data copied to another device,
      // keystore wiped). Nothing can decrypt these values; the user re-enters them.
      dropUnreadableSealedValues();
      return fallback;
    }
    try {
      String plain = secrets.open(raw);
      sealedCache.put(key, plain);
      return plain;
    } catch (Exception error) {
      // The key exists but the Keystore failed, e.g. early after boot or an
      // update. Fail loudly: returning empty here would let the next save
      // overwrite every stored machine with an empty list.
      throw unreadable(key, error);
    }
  }

  private static IllegalStateException unreadable(String key, Exception cause) {
    Log.w("AgentBridgeStore", "sealed value " + key + " is temporarily unreadable", cause);
    return new IllegalStateException(UiText.text("加密存储暂时无法读取，数据没有丢失。请稍后重试，或重启手机后再打开 App。"), cause);
  }

  /**
   * Removes values sealed with a Keystore key that no longer exists, before a
   * new key is created: afterwards they would look like a transient failure.
   */
  private void dropUnreadableSealedValues() {
    SharedPreferences.Editor editor = prefs.edit();
    for (String key : new String[] { KEY_MACHINES, KEY_FRP_SERVER, KEY_FRP_RELAYS, KEY_STUDIO_MODEL, KEY_STUDIO_VOICE }) {
      String raw = prefs.getString(key, null);
      if (raw != null && SecretBox.isSealed(raw) && !sealedCache.containsKey(key)) {
        Log.w("AgentBridgeStore", "dropping " + key + ": its Keystore key no longer exists");
        editor.remove(key);
      }
    }
    editor.commit();
  }

  private SharedPreferences.Editor writeSealed(SharedPreferences.Editor editor, String key, String value) {
    try {
      boolean hadKey = secrets.hasKey();
      // Finish encryption before touching either the editor or the read cache.
      // A failed save must never make unsaved credentials appear as persisted.
      String sealed = secrets.seal(value);
      if (!hadKey) dropUnreadableSealedValues();
      // Reads repopulate this only after the caller applies/commits the editor.
      // Invalidation also handles a failed commit or a multi-value save that
      // fails before its editor is applied.
      sealedCache.remove(key);
      return editor.putString(key, sealed);
    } catch (Exception error) {
      Log.w("AgentBridgeStore", "cannot seal " + key, error);
      throw new IllegalStateException(UiText.text("加密存储保存失败，本次配置未保存。请稍后重试，或重启手机后再打开 App。"), error);
    }
  }

  /** AES-GCM with a non-exportable Android Keystore key. */
  private static final class SecretBox {
    private static final String PREFIX = "sealed:v1:";
    private static final String ALIAS = "agent-bridge-store-v1";
    private SecretKey key;

    static boolean isSealed(String value) {
      return value.startsWith(PREFIX);
    }

    String seal(String plain) throws Exception {
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.ENCRYPT_MODE, key());
      byte[] iv = cipher.getIV();
      byte[] body = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
      byte[] joined = new byte[iv.length + body.length];
      System.arraycopy(iv, 0, joined, 0, iv.length);
      System.arraycopy(body, 0, joined, iv.length, body.length);
      return PREFIX + Base64.encodeToString(joined, Base64.NO_WRAP);
    }

    boolean hasKey() throws Exception {
      if (key != null) return true;
      KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
      keyStore.load(null);
      return keyStore.containsAlias(ALIAS);
    }

    String open(String sealed) throws Exception {
      byte[] joined = Base64.decode(sealed.substring(PREFIX.length()), Base64.NO_WRAP);
      Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
      cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, joined, 0, 12));
      byte[] plain = cipher.doFinal(joined, 12, joined.length - 12);
      return new String(plain, StandardCharsets.UTF_8);
    }

    private SecretKey key() throws Exception {
      if (key != null) return key;
      KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
      keyStore.load(null);
      if (keyStore.containsAlias(ALIAS)) {
        key = ((KeyStore.SecretKeyEntry) keyStore.getEntry(ALIAS, null)).getSecretKey();
        return key;
      }
      KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
      generator.init(new KeyGenParameterSpec.Builder(ALIAS,
          KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
          .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
          .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
          .setKeySize(256)
          .build());
      key = generator.generateKey();
      return key;
    }
  }

  // --- Host keys -----------------------------------------------------------

  HostKeyRepository hostKeyRepository() {
    return new TrustOnFirstUseRepository();
  }

  /** Forgets the pinned host key so the next connection trusts the server's current key. */
  synchronized void forgetHostKey(JSONObject machine) throws Exception {
    JSONObject hostKeys = readHostKeys();
    for (String alias : hostAliases(machine)) hostKeys.remove(alias);
    prefs.edit().putString(KEY_HOST_KEYS, hostKeys.toString()).apply();
  }

  /** The names JSch checks a machine's key under, matching connectDirect and the relay alias. */
  private static String[] hostAliases(JSONObject machine) {
    String host = machine.optString("host", "");
    int port = machine.optInt("port", 22);
    return port == 22 ? new String[] { host } : new String[] { host, "[" + host + "]:" + port };
  }

  private JSONObject readHostKeys() {
    try {
      return new JSONObject(prefs.getString(KEY_HOST_KEYS, "{}"));
    } catch (Exception ignored) {
      // Malformed persisted state is treated as no known hosts.
      return new JSONObject();
    }
  }

  private final class TrustOnFirstUseRepository implements HostKeyRepository {
    private Map<String, String> read() {
      Map<String, String> result = new HashMap<>();
      try {
        JSONObject values = readHostKeys();
        JSONArray names = values.names();
        if (names == null) return result;
        for (int index = 0; index < names.length(); index += 1) {
          String name = names.getString(index);
          result.put(name, values.getString(name));
        }
      } catch (Exception ignored) {
        // Malformed persisted state is treated as no known hosts.
      }
      return result;
    }

    @Override
    public int check(String host, byte[] key) {
      String encoded = Base64.encodeToString(key, Base64.NO_WRAP);
      synchronized (BridgeStore.this) {
        String existing = read().get(host);
        if (existing == null) {
          try {
            JSONObject values = readHostKeys();
            values.put(host, encoded);
            prefs.edit().putString(KEY_HOST_KEYS, values.toString()).apply();
          } catch (Exception ignored) {
            return HostKeyRepository.NOT_INCLUDED;
          }
          return HostKeyRepository.OK;
        }
        return existing.equals(encoded) ? HostKeyRepository.OK : HostKeyRepository.CHANGED;
      }
    }

    @Override
    public void add(HostKey hostKey, UserInfo userInfo) {
      // check() persists the key on first use.
    }

    @Override
    public void remove(String host, String type) {
      remove(host, type, null);
    }

    @Override
    public void remove(String host, String type, byte[] key) {
      synchronized (BridgeStore.this) {
        JSONObject values = readHostKeys();
        values.remove(host);
        prefs.edit().putString(KEY_HOST_KEYS, values.toString()).apply();
      }
    }

    @Override
    public String getKnownHostsRepositoryID() {
      return "agent-bridge-phone";
    }

    @Override
    public HostKey[] getHostKey() {
      return new HostKey[0];
    }

    @Override
    public HostKey[] getHostKey(String host, String type) {
      return new HostKey[0];
    }

  }
}
