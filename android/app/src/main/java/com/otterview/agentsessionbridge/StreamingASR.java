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
 * Captures microphone audio for the DashScope and Doubao real-time ASR WebSocket APIs.
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
  private final boolean doubao;
  private final Object audioSendLock = new Object();
  private byte[] doubaoPendingPcm; // Hold one chunk so the final frame contains actual audio.
  private int sequence = 1;
  private volatile boolean doubaoFinishing;
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

  public StreamingASR(String apiKey, boolean finishOnSentence, boolean doubao, Listener listener) {
    this.apiKey = apiKey;
    this.doubao = doubao;
    this.finishOnSentence = finishOnSentence;
    this.listener = listener;
  }

  private static synchronized OkHttpClient client() {
    if (sharedClient == null) {
      sharedClient = new OkHttpClient.Builder()
          .connectTimeout(10, TimeUnit.SECONDS)
          .readTimeout(120, TimeUnit.SECONDS)
          .followRedirects(false)
          .followSslRedirects(false)
          .build();
    }
    return sharedClient;
  }

  public boolean isRunning() {
    return running.get();
  }

  public void start() {
    if (!running.compareAndSet(false, true)) return;
    Request.Builder request = new Request.Builder().url(doubao ? DoubaoAsrProtocol.URL : WS_URL);
    if (doubao) {
      request.header("X-Api-Key", apiKey)
          .header("X-Api-Resource-Id", DoubaoAsrProtocol.RESOURCE)
          .header("X-Api-Connect-Id", taskId).header("X-Api-Request-Id", taskId);
    } else {
      request.header("Authorization", "Bearer " + apiKey);
    }
    WebSocket connection = client().newWebSocket(request.build(), new WebSocketListener() {
      @Override
      public void onOpen(WebSocket webSocket, Response response) {
        if (!running.get() || settled.get()) { webSocket.cancel(); return; }
        if (doubao) {
          startDoubaoTask(webSocket);
          return;
        }
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
                      .put("language_hints", new JSONArray().put(UiText.english() ? "en" : "zh")))
                  .put("input", new JSONObject()));
          webSocket.send(task.toString());
        } catch (Exception error) {
          fail(UiText.text("ASR 配置发送失败"));
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
              break;
            case "result-generated":
              handleResult(json.optJSONObject("payload"));
              break;
            case "task-finished":
              settle();
              break;
            case "task-failed":
              fail(UiText.text("语音识别失败：") + header.optString("error_message", header.optString("error_code", UiText.text("未知错误"))));
              break;
            default:
              break;
          }
        } catch (Exception error) {
          Log.w(TAG, "unreadable ASR event", error);
        }
      }

      @Override
      public void onMessage(WebSocket socket, ByteString message) {
        if (doubao && !settled.get()) handleDoubaoResult(socket, message);
      }

      @Override
      public void onClosed(WebSocket webSocket, int code, String reason) {
        running.set(false);
        if (!settled.get()) fail(UiText.text("语音连接提前关闭，请检查网络或语音服务权限"));
      }

      @Override
      public void onFailure(WebSocket webSocket, Throwable t, Response response) {
        if (settled.get()) return;
        int status = response == null ? 0 : response.code();
        Log.w(TAG, "ASR socket failure code=" + status);
        fail(UiText.text(doubao && (status == 401 || status == 403)
            ? "豆包语音鉴权失败，请检查 API Key 和语音识别开通状态"
            : "ASR 连接失败，请检查网络") + (status == 0 ? "" : " (HTTP " + status + ")"));
      }
    });
    ws = connection;
    if (settled.get()) connection.cancel();
    mainHandler.postDelayed(() -> {
      if (!taskStarted && !settled.get()) fail(UiText.text(doubao
          ? "豆包语音连接超时，请检查网络或 API Key"
          : "语音服务连接超时，请检查网络或北京地域 API Key"));
    }, 15_000);
  }

  private void startDoubaoTask(WebSocket socket) {
    try {
      JSONObject audio = new JSONObject().put("format", "pcm").put("codec", "raw")
          .put("rate", SAMPLE_RATE).put("bits", 16).put("channel", 1);
      JSONObject options = new JSONObject().put("model_name", "bigmodel")
          .put("enable_itn", true).put("enable_punc", true).put("show_utterances", true)
          .put("result_type", "full");
      byte[] payload = new JSONObject().put("user", new JSONObject().put("uid", taskId))
          .put("audio", audio).put("request", options).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
      if (!socket.send(ByteString.of(DoubaoAsrProtocol.request(sequence++, payload)))) {
        fail(UiText.text("ASR 配置发送失败"));
      }
    } catch (Exception error) {
      fail(UiText.text("ASR 配置发送失败"));
    }
  }

  private void handleDoubaoResult(WebSocket socket, ByteString message) {
    try {
      DoubaoAsrProtocol.Result reply = DoubaoAsrProtocol.decode(message.toByteArray());
      if (reply.error != 0) {
        fail(UiText.text("豆包语音识别失败") + " (" + reply.error + ")");
        return;
      }
      if (!taskStarted && running.get() && !reply.last) {
        ws = socket;
        taskStarted = true;
        startCapture();
        mainHandler.postDelayed(this::stop, finishOnSentence ? 15_000 : 30_000);
      }
      Object resultValue = reply.json.length == 0 ? null :
          new JSONObject(new String(reply.json, java.nio.charset.StandardCharsets.UTF_8)).opt("result");
      JSONObject result = resultValue instanceof JSONObject ? (JSONObject) resultValue
          : resultValue instanceof JSONArray ? ((JSONArray) resultValue).optJSONObject(0) : null;
      if (result != null) {
        String transcript = result.optString("text").trim();
        if (!transcript.isEmpty()) {
          pendingSentence = transcript;
          if (!reply.last) mainHandler.post(() -> { if (!settled.get()) listener.onPartial(transcript); });
        }
        if (finishOnSentence && !doubaoFinishing && !reply.last && !transcript.isEmpty()) {
          JSONArray sentences = result.optJSONArray("utterances");
          JSONObject last = sentences == null ? null : sentences.optJSONObject(sentences.length() - 1);
          if (last != null && last.optBoolean("definite")) stop();
        }
      }
      if (reply.last) settle();
    } catch (Exception error) {
      fail(UiText.text("豆包语音返回了无法读取的结果"));
    }
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
        if (!running.get() || settled.get()) return;
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
          fail(UiText.text("麦克风初始化失败，请检查麦克风权限或是否被其他应用占用"));
          return;
        }
        record.startRecording();
        if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
          fail(UiText.text("录音失败，请重试"));
          return;
        }
        mainHandler.post(() -> { if (running.get() && !settled.get()) listener.onReady(); });
        byte[] buffer = new byte[CHUNK_SIZE];
        while (running.get()) {
          int read = record.read(buffer, 0, buffer.length);
          if (read < 0) {
            fail(UiText.text("录音失败，请重试"));
            break;
          }
          WebSocket socket = ws;
          if (read == 0 || socket == null) continue;
          if (doubao) {
            synchronized (audioSendLock) {
              if (!running.get()) break;
              if (doubaoPendingPcm != null && (socket.queueSize() > 128_000
                  || !socket.send(ByteString.of(DoubaoAsrProtocol.audio(sequence++, doubaoPendingPcm, false))))) {
                fail(UiText.text("ASR 连接失败，请检查网络"));
                break;
              }
              doubaoPendingPcm = java.util.Arrays.copyOf(buffer, read);
            }
          } else {
            socket.send(ByteString.of(buffer, 0, read));
          }
        }
      } catch (SecurityException error) {
        fail(UiText.text("需要麦克风权限才能使用实时语音"));
      } catch (Exception error) {
        Log.w(TAG, "audio capture failed", error);
        fail(UiText.text("录音失败，请重试"));
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
    if (doubao) {
      doubaoFinishing = true;
      sendFinish();
      mainHandler.postDelayed(() -> {
        if (!settled.get()) fail(UiText.text("豆包语音识别超时，请重试"));
      }, 5_000);
    } else {
      sendFinish();
      mainHandler.postDelayed(this::settle, FLUSH_TIMEOUT_MS);
    }
  }

  /** Stops listening and drops anything recognised so far. */
  public void cancel() {
    discard = true;
    running.set(false);
    if (!doubao) sendFinish();
    settle();
  }

  private void sendFinish() {
    WebSocket socket = ws;
    if (socket == null || !taskStarted) return;
    if (doubao) {
      try {
        synchronized (audioSendLock) {
          byte[] last = doubaoPendingPcm;
          doubaoPendingPcm = null;
          if (last == null) settle();
          else if (!socket.send(ByteString.of(DoubaoAsrProtocol.audio(sequence++, last, true)))) {
            fail(UiText.text("ASR 连接失败，请检查网络"));
          }
        }
      } catch (Exception error) {
        fail(UiText.text("ASR 连接失败，请检查网络"));
      }
      return;
    }
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
    closeSocket(discard);
  }

  private void fail(String message) {
    running.set(false);
    if (!settled.compareAndSet(false, true)) return;
    if (!discard) mainHandler.post(() -> listener.onError(message));
    closeSocket(true);
  }

  private void closeSocket(boolean abort) {
    WebSocket socket = ws;
    ws = null;
    if (socket != null) {
      try { if (doubao && abort) socket.cancel(); else socket.close(1000, "done"); } catch (Exception ignored) { }
    }
  }
}
