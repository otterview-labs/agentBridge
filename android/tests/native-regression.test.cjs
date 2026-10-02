const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const source = path.resolve(__dirname, '../app/src/main/java/com/otterview/agentsessionbridge');
const javaHome = process.env.JAVA_HOME;
const java = javaHome ? path.join(javaHome, 'bin/java') : 'java';
const javac = javaHome ? path.join(javaHome, 'bin/javac') : 'javac';

// Compile the production methods with small platform fakes. This exercises
// failure/cancellation behavior without an Android emulator or a real key.
function methods(file, start, end) {
  const text = fs.readFileSync(path.join(source, file), 'utf8');
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'production method boundaries must exist');
  return text.slice(from, to);
}

function runHarness(t, name, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'asb-native-tests-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, `${name}.java`);
  fs.writeFileSync(file, body + '\n' + fs.readFileSync(path.join(source, 'UiText.java'), 'utf8').replace(/^package .*;\n/m, ''));
  execFileSync(javac, ['-d', root, file]);
  return execFileSync(java, ['-cp', root, name], { encoding: 'utf8', timeout: 10000 });
}

test('failed credential encryption preserves saved values and never publishes plaintext or cache updates', t => {
  const seal = methods('BridgeStore.java', '  private SharedPreferences.Editor writeSealed(', '  /** AES-GCM');
  const result = runHarness(t, 'SealingHarness', `
import java.util.*;
public class SealingHarness {
  final Map<String, String> sealedCache = new HashMap<>();
  final SecretBox secrets = new SecretBox();
  int drops;
  void dropUnreadableSealedValues() { drops++; }
  static class Log { static void w(String tag, String message, Exception error) {} }
  static class SecretBox {
    boolean fail, missing;
    boolean hasKey() throws Exception { return !missing; }
    String seal(String value) throws Exception {
      if (fail) throw new Exception("Keystore failed");
      return "sealed:" + value;
    }
  }
  static class SharedPreferences {
    static class Editor {
      final Map<String, String> disk;
      final Map<String, String> pending = new HashMap<>();
      Editor(Map<String, String> disk) { this.disk = disk; }
      Editor putString(String key, String value) { pending.put(key, value); return this; }
      void apply() { disk.putAll(pending); }
    }
  }
  ${seal}
  static void check(boolean condition) { if (!condition) throw new AssertionError(); }
  public static void main(String[] args) {
    SealingHarness store = new SealingHarness();
    Map<String, String> disk = new HashMap<>();
    disk.put("machines", "sealed:old");
    store.sealedCache.put("machines", "old");
    SharedPreferences.Editor editor = new SharedPreferences.Editor(disk);
    store.secrets.fail = true;
    try { store.writeSealed(editor, "machines", "new-password"); throw new AssertionError(); }
    catch (IllegalStateException expected) {}
    check(editor.pending.isEmpty());
    check(disk.get("machines").equals("sealed:old"));
    check(store.sealedCache.get("machines").equals("old"));
    check(store.drops == 0);
    store.secrets.missing = true;
    try { store.writeSealed(editor, "machines", "new-password"); throw new AssertionError(); }
    catch (IllegalStateException expected) {}
    check(store.drops == 0);
    store.secrets.missing = false;
    store.secrets.fail = false;
    store.writeSealed(editor, "machines", "new-password");
    check(store.sealedCache.isEmpty());
    check(disk.get("machines").equals("sealed:old"));
    // A second encrypted field fails before a grouped save is applied.
    store.secrets.fail = true;
    try { store.writeSealed(editor, "relays", "token"); throw new AssertionError(); }
    catch (IllegalStateException expected) {}
    check(disk.get("machines").equals("sealed:old"));
    check(!disk.containsKey("relays"));
    editor.apply();
    check(disk.get("machines").equals("sealed:new-password"));
    System.out.println("ok");
  }
}`);
  assert.equal(result.trim(), 'ok');
});

test('cloud synthesis returns immediately and cancels stale playback and errors', t => {
  const speech = methods('MainActivity.java', '  void speakCloudText(', '  private String synthesizeCloudSpeechUrl(');
  const result = runHarness(t, 'SpeechHarness', `
import java.net.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
public class SpeechHarness {
  final ExecutorService speechExecutor = Executors.newSingleThreadExecutor();
  final AtomicInteger speechGeneration = new AtomicInteger();
  final Object speechLock = new Object();
  HttpURLConnection pendingSpeechConnection;
  Future<?> pendingSpeech;
  Object textToSpeech = null;
  final CountDownLatch entered = new CountDownLatch(1), finish = new CountDownLatch(1);
  final AtomicInteger plays = new AtomicInteger(), errors = new AtomicInteger();
  final BlockingQueue<Runnable> ui = new LinkedBlockingQueue<>();
  final Thread main = Thread.currentThread();
  boolean isFinishing() { return false; }
  boolean isDestroyed() { return false; }
  void runOnUiThread(Runnable body) { if (Thread.currentThread() == main) body.run(); else ui.add(body); }
  void stopCloudSpeechPlayback() {}
  void stopStreamingCapture() {}
  void playSpeechUrl(String url) { plays.incrementAndGet(); }
  void postVoiceState(String type, String text, boolean autoSend) { errors.incrementAndGet(); }
  static class Log { static void w(String tag, String message, Exception error) {} }
  // TextToSpeech fake has the same stop method as the platform object.
  static class Tts { void stop() {} }
  ${speech.replace('textToSpeech.stop()', '((Tts) textToSpeech).stop()')}
  String synthesizeCloudSpeechUrl(String key, String text, int generation) throws Exception {
    if (Thread.currentThread() == main) throw new AssertionError("HTTP on UI thread");
    entered.countDown();
    // Simulate a network completion that races cancellation and ignores interrupts.
    for (;;) { try { finish.await(); break; } catch (InterruptedException ignored) {} }
    if (text.equals("error")) throw new Exception("provider failed");
    return "https://audio.invalid/result";
  }
  static void check(boolean condition) { if (!condition) throw new AssertionError(); }
  public static void main(String[] args) throws Exception {
    for (String text : new String[] {"reply", "error"}) {
      SpeechHarness app = new SpeechHarness();
      try {
        app.speakCloudText("test-key", text);
        check(app.entered.await(2, TimeUnit.SECONDS));
        check(app.plays.get() == 0);
        app.cancelCloudSynthesis();
        app.finish.countDown();
        Runnable completion = app.ui.poll(2, TimeUnit.SECONDS);
        check(completion != null);
        completion.run();
        check(app.plays.get() == 0 && app.errors.get() == 0);
      } finally { app.finish.countDown(); app.speechExecutor.shutdownNow(); }
    }
    SpeechHarness app = new SpeechHarness();
    try {
      app.speakCloudText("test-key", "reply");
      check(app.entered.await(2, TimeUnit.SECONDS));
      app.finish.countDown();
      Runnable completion = app.ui.poll(2, TimeUnit.SECONDS);
      check(completion != null);
      completion.run();
      check(app.plays.get() == 1);
    } finally { app.finish.countDown(); app.speechExecutor.shutdownNow(); }
    System.out.println("ok");
  }
}`);
  assert.equal(result.trim(), 'ok');
});

test('model endpoint normalization handles pasted completion URLs and rejects unsafe destinations', t => {
  const validate = methods('PhoneBridge.java', '  private String validateDirectModelUrl(', '  private void appendStudioMessage(');
  const result = runHarness(t, 'ModelUrlHarness', `
import java.net.*;
public class ModelUrlHarness {
  ${validate}
  static void check(boolean condition) { if (!condition) throw new AssertionError(); }
  public static void main(String[] args) throws Exception {
    ModelUrlHarness bridge = new ModelUrlHarness();
    check(bridge.validateDirectModelUrl(" https://provider.test/v1/chat/completions/ ").equals("https://provider.test/v1"));
    check(bridge.validateDirectModelUrl("https://provider.test/compatible-mode/v1/").equals("https://provider.test/compatible-mode/v1"));
    check(bridge.validateDirectModelUrl("http://127.0.0.1:8080/v1").equals("http://127.0.0.1:8080/v1"));
    for (String value : new String[] {"", "http://provider.test/v1", "https://user:secret@provider.test/v1", "https://provider.test/v1?key=secret", "https://provider.test/v1#part"}) {
      try { bridge.validateDirectModelUrl(value); throw new AssertionError(value); }
      catch (IllegalArgumentException expected) {}
    }
    System.out.println("ok");
  }
}`);
  assert.equal(result.trim(), 'ok');
});

test('silent streaming recognition signals stopped exactly once and cancelled sessions publish nothing', t => {
  const settlement = methods('StreamingASR.java', '  private void settle() {', '\n}');
  const result = runHarness(t, 'AsrSettlementHarness', `
import java.util.concurrent.atomic.*;
public class AsrSettlementHarness {
  final AtomicBoolean running = new AtomicBoolean(true), settled = new AtomicBoolean(false);
  final StringBuilder committed = new StringBuilder();
  String pendingSentence = "";
  boolean discard;
  WebSocket ws = new WebSocket();
  final Handler mainHandler = new Handler();
  final Listener listener = new Listener();
  static class Handler { void post(Runnable callback) { callback.run(); } }
  static class WebSocket { int closes; void close(int code, String reason) { closes++; } }
  static class Listener {
    int finals, stops, errors; String text;
    void onFinal(String text) { finals++; this.text = text; }
    void onStopped() { stops++; }
    void onError(String message) { errors++; }
  }
  ${settlement}
  static void check(boolean condition) { if (!condition) throw new AssertionError(); }
  public static void main(String[] args) {
    AsrSettlementHarness silence = new AsrSettlementHarness();
    WebSocket socket = silence.ws;
    silence.settle(); silence.settle(); silence.fail("late network failure");
    check(silence.listener.stops == 1 && silence.listener.finals == 0 && silence.listener.errors == 0);
    check(socket.closes == 1 && !silence.running.get());
    AsrSettlementHarness speech = new AsrSettlementHarness();
    speech.committed.append("帮我"); speech.pendingSentence = "看进展";
    speech.settle(); speech.settle();
    check(speech.listener.finals == 1 && speech.listener.text.equals("帮我看进展"));
    check(speech.listener.stops == 0);
    AsrSettlementHarness cancelled = new AsrSettlementHarness();
    cancelled.discard = true; cancelled.pendingSentence = "不应发送";
    cancelled.settle();
    check(cancelled.listener.finals == 0 && cancelled.listener.stops == 0);
    AsrSettlementHarness failure = new AsrSettlementHarness();
    failure.fail("network"); failure.settle();
    check(failure.listener.errors == 1 && failure.listener.stops == 0 && failure.listener.finals == 0);
    System.out.println("ok");
  }
}`);
  assert.equal(result.trim(), 'ok');
});
