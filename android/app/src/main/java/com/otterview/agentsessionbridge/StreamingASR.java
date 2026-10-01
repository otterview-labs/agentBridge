package com.otterview.agentsessionbridge;

import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;
import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Real-time streaming ASR over the DashScope WebSocket API (paraformer-realtime-v2),
 * following the documented run-task / task-started / result-generated /
 * finish-task / task-finished exchange.
 *
 * <p>Two ways to end an utterance: in conversation mode the first finished
 * sentence is the user's turn, so it is delivered and the session closes; in
 * press-to-talk mode finished sentences accumulate until {@link #stop()},
 * and the whole transcript is delivered once the server has flushed it.
 * {@link #cancel()} drops whatever was heard.
 */
public final class StreamingASR {
  private static final String TAG = "StreamingASR";
  private static final int SAMPLE_RATE = 16_000;
  private static final int CHUNK_MS = 100;
  private static final int CHUNK_SIZE = SAMPLE_RATE * 2 * CHUNK_MS / 1000;
  private static final long FLUSH_TIMEOUT_MS = 3_000;
  private static final String WS_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
  private static OkHttpClient sharedClient;

  public interface Listener {
    void onPartial(String text);
    void onFinal(String text);
    void onError(String message);
    void onReady();
    default void onStopped() { }
  }

  private final Listener listener;
  private final String apiKey;
  private final boolean finishOnSentence;
  private final String taskId = java.util.UUID.randomUUID().toString();
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  /** True from start() until the caller stops or the session fails. Capture runs only while it is set. */
  private final AtomicBoolean running = new AtomicBoolean(false);
  /** Guards the single onFinal/onError delivery and the socket teardown. */
  private final AtomicBoolean settled = new AtomicBoolean(false);
  private final StringBuilder committed = new StringBuilder();
  private volatile WebSocket ws;
  private volatile boolean taskStarted;
  private volatile boolean discard;
  private volatile String pendingSentence = "";

  public StreamingASR(String apiKey, boolean finishOnSentence, Listener listener) {
    this.apiKey = apiKey;
    this.finishOnSentence = finishOnSentence;
    this.listener = listener;
  }

  private static synchronized OkHttpClient client() {
    if (sharedClient == null) {
      sharedClient = new OkHttpClient.Builder()
          .connectTimeout(10, TimeUnit.SECONDS)
          .readTimeout(120, TimeUnit.SECONDS)
          .build();
    }
    return sharedClient;
  }

  public boolean isRunning() {
    return running.get();
  }

  public void start() {
    if (!running.compareAndSet(false, true)) return;
    Request request = new Request.Builder()
        .url(WS_URL)
        .header("Authorization", "Bearer " + apiKey)
        .build();
    ws = client().newWebSocket(request, new WebSocketListener() {
      @Override
      public void onOpen(WebSocket webSocket, Response response) {
        try {
          JSONObject task = new JSONObject()
              .put("header", new JSONObject()
                  .put("action", "run-task")
                  .put("task_id", taskId)
                  .put("streaming", "duplex"))
              .put("payload", new JSONObject()
                  .put("task_group", "audio")
                  .put("task", "asr")
                  .put("function", "recognition")
                  .put("model", "paraformer-realtime-v2")
                  .put("parameters", new JSONObject()
                      .put("format", "pcm")
                      .put("sample_rate", SAMPLE_RATE)
                      .put("language_hints", new JSONArray().put("zh")))
                  .put("input", new JSONObject()));
          webSocket.send(task.toString());
        } catch (Exception error) {
          fail("ASR 配置发送失败");
        }
      }

      @Override
      public void onMessage(WebSocket webSocket, String message) {
        try {
          JSONObject json = new JSONObject(message);
          JSONObject header = json.optJSONObject("header");
          if (header == null) return;
          switch (header.optString("event")) {
            case "task-started":
              taskStarted = true;
              if (!running.get()) {
                // Stopped while the task was being set up.
                sendFinish();
                return;
              }
              startCapture();
              mainHandler.post(() -> { if (running.get() && !settled.get()) listener.onReady(); });
              break;
            case "result-generated":
              handleResult(json.optJSONObject("payload"));
              break;
            case "task-finished":
              settle();
              break;
            case "task-failed":
              fail("语音识别失败：" + header.optString("error_message", header.optString("error_code", "未知错误")));
              break;
            default:
              break;
          }
        } catch (Exception error) {
          Log.w(TAG, "unreadable ASR event", error);
        }
      }

      @Override
      public void onClosed(WebSocket webSocket, int code, String reason) {
        running.set(false);
        if (!settled.get()) fail("语音连接提前关闭，请检查网络或语音服务权限");
      }

      @Override
      public void onFailure(WebSocket webSocket, Throwable t, Response response) {
        Log.w(TAG, "ASR socket failure code=" + (response != null ? response.code() : "?"), t);
        fail("ASR 连接失败，请检查网络");
      }
    });
    mainHandler.postDelayed(() -> {
      if (!taskStarted && !settled.get()) fail("语音服务连接超时，请检查网络或北京地域 API Key");
    }, 15_000);
  }

  private void handleResult(JSONObject payload) {
    if (discard || payload == null) return;
    JSONObject output = payload.optJSONObject("output");
    JSONObject sentence = output == null ? null : output.optJSONObject("sentence");
    if (sentence == null) return;
    String text = sentence.optString("text", "").trim();
    if (text.isEmpty()) return;
    if (!sentence.optBoolean("sentence_end", false)) {
      pendingSentence = text;
      String partial = committed + text;
      mainHandler.post(() -> listener.onPartial(partial));
      return;
    }
    pendingSentence = "";
    synchronized (committed) {
      committed.append(text);
    }
    if (finishOnSentence) {
      // Conversation mode: one sentence is the user's whole turn.
      running.set(false);
      sendFinish();
      settle();
    } else {
      String partial = committed.toString();
      mainHandler.post(() -> listener.onPartial(partial));
    }
  }

  private void startCapture() {
    Thread capture = new Thread(() -> {
      AudioRecord record = null;
      try {
        int minBuffer = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        // VOICE_COMMUNICATION enables the platform echo canceller, so a reply
        // playing on the speaker is not transcribed as the user's next turn.
        record = new AudioRecord(
            MediaRecorder.AudioSource.VOICE_COMMUNICATION,
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT,
            Math.max(minBuffer, CHUNK_SIZE * 4));
        if (record.getState() != AudioRecord.STATE_INITIALIZED) {
          fail("麦克风初始化失败，请检查麦克风权限或是否被其他应用占用");
          return;
        }
        record.startRecording();
        byte[] buffer = new byte[CHUNK_SIZE];
        while (running.get()) {
          int read = record.read(buffer, 0, buffer.length);
          if (read < 0) {
            fail("录音失败，请重试");
            break;
          }
          WebSocket socket = ws;
          if (read == 0 || socket == null) continue;
          socket.send(ByteString.of(buffer, 0, read));
        }
      } catch (SecurityException error) {
        fail("需要麦克风权限才能使用实时语音");
      } catch (Exception error) {
        Log.w(TAG, "audio capture failed", error);
        fail("录音失败，请重试");
      } finally {
        // The capture thread owns the recorder: it is released here and
        // nowhere else, so stop() on another thread can never race a read().
        if (record != null) {
          try { record.stop(); } catch (Exception ignored) { }
          record.release();
        }
      }
    }, "asr-capture");
    capture.setPriority(Thread.MAX_PRIORITY);
    capture.start();
  }

  /** Stops listening and delivers the transcript once the server has flushed it. */
  public void stop() {
    if (!running.getAndSet(false)) return;
    if (!taskStarted) {
      settle();
      return;
    }
    sendFinish();
    mainHandler.postDelayed(this::settle, FLUSH_TIMEOUT_MS);
  }

  /** Stops listening and drops anything recognised so far. */
  public void cancel() {
    discard = true;
    running.set(false);
    sendFinish();
    settle();
  }

  private void sendFinish() {
    WebSocket socket = ws;
    if (socket == null || !taskStarted) return;
    try {
      socket.send(new JSONObject()
          .put("header", new JSONObject()
              .put("action", "finish-task")
              .put("task_id", taskId)
              .put("streaming", "duplex"))
          .put("payload", new JSONObject().put("input", new JSONObject()))
          .toString());
    } catch (Exception ignored) {
      // The socket is closing anyway.
    }
  }

  /** Delivers the final transcript (if any) exactly once and closes the socket. */
  private void settle() {
    running.set(false);
    if (!settled.compareAndSet(false, true)) return;
    String text;
    synchronized (committed) {
      text = (committed + pendingSentence).trim();
    }
    if (!discard) {
      if (!text.isEmpty()) mainHandler.post(() -> listener.onFinal(text));
      else mainHandler.post(listener::onStopped);
    }
    closeSocket();
  }

  private void fail(String message) {
    running.set(false);
    if (!settled.compareAndSet(false, true)) return;
    if (!discard) mainHandler.post(() -> listener.onError(message));
    closeSocket();
  }

  private void closeSocket() {
    WebSocket socket = ws;
    ws = null;
    if (socket != null) {
      try { socket.close(1000, "done"); } catch (Exception ignored) { }
    }
  }
}
