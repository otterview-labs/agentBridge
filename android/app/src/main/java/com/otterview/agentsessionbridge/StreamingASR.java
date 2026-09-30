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
import org.json.JSONObject;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Real-time streaming ASR via DashScope WebSocket (paraformer-realtime-v2).
 * Uses OkHttp WebSocket client which handles TLS and headers correctly on Android.
 */
public final class StreamingASR {
  private static final String TAG = "StreamingASR";
  private static final int SAMPLE_RATE = 16_000;
  private static final int CHUNK_MS = 200;
  private static final int CHUNK_SIZE = SAMPLE_RATE * 2 * CHUNK_MS / 1000;
  private static final String WS_URL = "wss://dashscope.aliyuncs.com/api-ws/v1/inference";

  public interface Listener {
    void onPartial(String text);
    void onFinal(String text);
    void onError(String message);
    void onReady();
  }

  private final Listener listener;
  private final String apiKey;
  private final Handler mainHandler = new Handler(Looper.getMainLooper());
  private final AtomicBoolean running = new AtomicBoolean(false);
  private WebSocket ws;
  private OkHttpClient client;
  private AudioRecord audioRecord;
  private Thread captureThread;
  private long lastVoiceAt;
  private boolean heardSpeech;

  public StreamingASR(String apiKey, Listener listener) {
    this.apiKey = apiKey;
    this.listener = listener;
  }

  public boolean isRunning() {
    return running.get();
  }

  public void start() {
    if (running.get()) return;
    running.set(true);
    heardSpeech = false;
    lastVoiceAt = System.currentTimeMillis();

    try {
      client = new OkHttpClient.Builder()
          .connectTimeout(10, java.util.concurrent.TimeUnit.SECONDS)
          .readTimeout(120, java.util.concurrent.TimeUnit.SECONDS)
          .build();
      Request request = new Request.Builder()
          .url(WS_URL)
          .header("Authorization", "Bearer " + apiKey)
          .build();
      ws = client.newWebSocket(request, new WebSocketListener() {
        @Override
        public void onOpen(WebSocket webSocket, Response response) {
          Log.d(TAG, "WebSocket connected, code=" + (response != null ? response.code() : "?"));
          try {
            JSONObject task = new JSONObject()
                .put("header", new JSONObject()
                    .put("action", "run-task")
                    .put("task_id", java.util.UUID.randomUUID().toString())
                    .put("streaming", "out"))
                .put("payload", new JSONObject()
                    .put("task_group", "audio")
                    .put("model", "paraformer-realtime-v2")
                    .put("task", "asr")
                    .put("function", "recognition")
                    .put("input", new JSONObject()
                        .put("format", "pcm")
                        .put("sample_rate", SAMPLE_RATE))
                    .put("parameters", new JSONObject()
                        .put("language_hint", "zh")));
            webSocket.send(task.toString());
            Log.d(TAG, "Sent run-task with task_group");
            startCapture();
            mainHandler.post(() -> listener.onReady());
          } catch (Exception e) {
            Log.e(TAG, "Failed to send task config", e);
            mainHandler.post(() -> listener.onError("ASR 配置发送失败"));
          }
        }

        @Override
        public void onMessage(WebSocket webSocket, String message) {
          Log.d(TAG, "WS msg: " + message.substring(0, Math.min(message.length(), 200)));
          try {
            JSONObject json = new JSONObject(message);
            JSONObject header = json.optJSONObject("header");
            JSONObject payload = json.optJSONObject("payload");
            if (header == null || payload == null) return;
            JSONObject output = payload.optJSONObject("output");
            if (output == null) return;
            String text = output.optString("sentence", "");
            boolean isFinal = output.optBoolean("sentence_end", false);
            if (isFinal && !text.isEmpty()) {
              mainHandler.post(() -> listener.onFinal(text));
            } else if (!text.isEmpty()) {
              mainHandler.post(() -> listener.onPartial(text));
            }
          } catch (Exception e) {
            Log.w(TAG, "Parse error: " + e.getMessage());
          }
        }

        @Override
        public void onClosed(WebSocket webSocket, int code, String reason) {
          Log.d(TAG, "WebSocket closed: " + code + " " + reason);
          if (running.get()) {
            mainHandler.post(() -> listener.onError("ASR 连接断开"));
          }
          running.set(false);
        }

        @Override
        public void onFailure(WebSocket webSocket, Throwable t, Response response) {
          Log.e(TAG, "WebSocket failure: " + t.getMessage()
              + " code=" + (response != null ? response.code() : "?"));
          mainHandler.post(() -> listener.onError("ASR 连接失败: " + t.getMessage()));
          running.set(false);
        }
      });
    } catch (Exception e) {
      Log.e(TAG, "Failed to start ASR", e);
      running.set(false);
      listener.onError("ASR 启动失败: " + e.getMessage());
    }
  }

  private void startCapture() {
    int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
    int bufSize = Math.max(minBuf, CHUNK_SIZE * 4);
    audioRecord = new AudioRecord(
        MediaRecorder.AudioSource.MIC,
        SAMPLE_RATE,
        AudioFormat.CHANNEL_IN_MONO,
        AudioFormat.ENCODING_PCM_16BIT,
        bufSize);
    if (audioRecord.getState() != AudioRecord.STATE_INITIALIZED) {
      mainHandler.post(() -> listener.onError("麦克风初始化失败"));
      return;
    }
    audioRecord.startRecording();
    captureThread = new Thread(() -> {
      byte[] buffer = new byte[CHUNK_SIZE];
      android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_URGENT_AUDIO);
      while (running.get() && audioRecord != null) {
        int read = audioRecord.read(buffer, 0, buffer.length);
        if (read > 0 && ws != null) {
          byte[] chunk = new byte[read];
          System.arraycopy(buffer, 0, chunk, 0, read);
          ws.send(ByteString.of(chunk));
          long sum = 0;
          for (int i = 0; i < read; i += 2) {
            short sample = (short) ((buffer[i] & 0xFF) | (buffer[i + 1] << 8));
            sum += Math.abs(sample);
          }
          double amplitude = sum / (read / 2.0);
          if (amplitude > 300) {
            heardSpeech = true;
            lastVoiceAt = System.currentTimeMillis();
          }
        }
        try { Thread.sleep(CHUNK_MS); } catch (InterruptedException e) { break; }
      }
    }, "asr-capture");
    captureThread.start();
  }

  public void stop() {
    if (!running.getAndSet(false)) return;
    try { if (captureThread != null) captureThread.interrupt(); } catch (Exception ignored) { }
    try {
      if (audioRecord != null) { audioRecord.stop(); audioRecord.release(); audioRecord = null; }
    } catch (Exception ignored) { }
    try {
      if (ws != null) {
        JSONObject finish = new JSONObject().put("header", new JSONObject().put("action", "finish-task"));
        ws.send(finish.toString());
        ws.close(1000, "stopped");
      }
    } catch (Exception ignored) { }
    try { if (client != null) client.dispatcher().executorService().shutdown(); } catch (Exception ignored) { }
  }

  public boolean hasHeardSpeech() { return heardSpeech; }
  public long getSilenceMs() { return System.currentTimeMillis() - lastVoiceAt; }
}
