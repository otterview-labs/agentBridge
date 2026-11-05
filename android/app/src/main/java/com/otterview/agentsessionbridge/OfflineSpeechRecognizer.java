package com.otterview.agentsessionbridge;

import java.io.File;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.os.SystemClock;

import com.k2fsa.sherpa.onnx.OnlineRecognizer;
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig;
import com.k2fsa.sherpa.onnx.OnlineStream;

import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/** A single local utterance. The worker owns the microphone and all JNI objects. */
final class OfflineSpeechRecognizer {
  private static final int RATE = 16_000;
  private static final int CHUNK = RATE * 80 / 1000;
  private final File modelDirectory;
  private final boolean conversation;
  private final StreamingASR.Listener listener;
  private final Handler ui = new Handler(Looper.getMainLooper());
  private final AtomicBoolean listening = new AtomicBoolean(true);
  private volatile boolean cancelled;
  private volatile boolean finished;

  static boolean supported() {
    return Process.is64Bit() && Build.SUPPORTED_ABIS.length > 0
        && "arm64-v8a".equals(Build.SUPPORTED_ABIS[0]);
  }

  OfflineSpeechRecognizer(File modelDirectory, boolean conversation, StreamingASR.Listener listener) {
    this.modelDirectory = modelDirectory;
    this.conversation = conversation;
    this.listener = listener;
  }

  boolean isRunning() { return !finished && !cancelled; }
  void stop() { listening.set(false); }
  void cancel() { cancelled = true; stop(); }

  private void post(Runnable action) { ui.post(() -> { if (!cancelled) action.run(); }); }

  private OnlineRecognizer open() {
    OnlineRecognizerConfig config = new OnlineRecognizerConfig();
    var model = config.getModelConfig();
    model.setProvider("cpu");
    model.setNumThreads(2);
    model.setModelType("zipformer2");
    model.setTokens(modelFile(OfflineSpeechModel.TOKENS));
    model.getTransducer().setEncoder(modelFile(OfflineSpeechModel.ENCODER));
    model.getTransducer().setDecoder(modelFile(OfflineSpeechModel.DECODER));
    model.getTransducer().setJoiner(modelFile(OfflineSpeechModel.JOINER));
    model.setModelingUnit("cjkchar+bpe");
    model.setBpeVocab(modelFile(OfflineSpeechModel.BPE));
    config.setDecodingMethod("modified_beam_search");
    config.setMaxActivePaths(6);
    config.setHotwordsScore(3.2f);
    config.setEnableEndpoint(true);
    return new OnlineRecognizer(null, config);
  }

  private String modelFile(String name) { return new File(modelDirectory, name).getAbsolutePath(); }

  private static void decode(OnlineRecognizer recognizer, OnlineStream stream) {
    while (recognizer.isReady(stream)) recognizer.decode(stream);
  }

  /** Serialize mic use and briefly keep the expensive native model warm between turns. */
  static final class Worker {
    private final ScheduledThreadPoolExecutor executor = new ScheduledThreadPoolExecutor(1);
    private OnlineRecognizer cached;
    private File directory;
    private ScheduledFuture<?> idle;

    Worker() {
      executor.setRemoveOnCancelPolicy(true);
      executor.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
    }

    void start(OfflineSpeechRecognizer session) { executor.execute(() -> session.recognize(this)); }

    private OnlineRecognizer acquire(OfflineSpeechRecognizer session) {
      if (idle != null) idle.cancel(false);
      if (cached == null || !session.modelDirectory.equals(directory)) {
        release();
        cached = session.open();
        directory = session.modelDirectory;
      }
      return cached;
    }

    private void release() {
      OnlineRecognizer old = cached;
      cached = null;
      directory = null;
      if (old != null) old.release();
    }

    private void idle(boolean failed) {
      if (failed) release();
      else if (cached != null && !executor.isShutdown()) {
        try { idle = executor.schedule(this::release, 20, TimeUnit.SECONDS); }
        catch (java.util.concurrent.RejectedExecutionException ignored) { /* close already queued release */ }
      }
    }

    void close() {
      executor.execute(this::release);
      executor.shutdown();
    }
  }

  private void recognize(Worker worker) {
    OnlineRecognizer recognizer = null;
    OnlineStream stream = null;
    AudioRecord audio = null;
    String text = "";
    String error = null;
    try {
      if (!listening.get()) return;
      recognizer = worker.acquire(this);
      if (!listening.get()) return;
      stream = recognizer.createStream(OfflineToolNames.HOTWORDS);
      int minBytes = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
      if (minBytes <= 0) throw new IllegalStateException("Microphone format unavailable");
      audio = new AudioRecord(conversation ? MediaRecorder.AudioSource.VOICE_COMMUNICATION
          : MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO,
          AudioFormat.ENCODING_PCM_16BIT, Math.max(minBytes, CHUNK * 2 * 4));
      if (audio.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("Microphone unavailable");
      if (!listening.get()) return;
      audio.startRecording();
      if (audio.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) throw new IllegalStateException("Microphone did not start");
      post(() -> { if (listening.get()) listener.onReady(); });
      short[] pcm = new short[CHUNK];
      float[] frame = new float[CHUNK];
      long deadline = SystemClock.elapsedRealtime() + (conversation ? 15_000 : 30_000);
      boolean hasAudio = false;
      while (listening.get() && SystemClock.elapsedRealtime() < deadline) {
        int count = audio.read(pcm, 0, pcm.length, AudioRecord.READ_BLOCKING);
        if (cancelled) return;
        if (count < 0) throw new IllegalStateException("Microphone read failed");
        if (count == 0) continue;
        hasAudio = true;
        float[] samples = count == frame.length ? frame : new float[count];
        for (int i = 0; i < count; i++) samples[i] = pcm[i] / 32768.0f;
        stream.acceptWaveform(samples, RATE);
        decode(recognizer, stream);
        String partial = OfflineToolNames.format(recognizer.getResult(stream).getText());
        if (!partial.isEmpty() && !partial.equals(text)) {
          text = partial;
          post(() -> listener.onPartial(partial));
        }
        if (conversation && recognizer.isEndpoint(stream)) {
          if (!text.isEmpty()) break;
          recognizer.reset(stream);
        }
      }
      if (cancelled || !hasAudio) return;
      stream.acceptWaveform(new float[RATE * 6 / 5], RATE); // Flush the model's right context at the end of speech.
      stream.inputFinished();
      decode(recognizer, stream);
      String result = OfflineToolNames.format(recognizer.getResult(stream).getText());
      if (!result.isEmpty()) text = result;
    } catch (RuntimeException | LinkageError failure) {
      android.util.Log.w("OfflineSpeech", "Local recognition failed (" + failure.getClass().getSimpleName() + ")");
      error = UiText.text("本机离线识别启动或录音失败，请重试");
    } finally {
      if (audio != null) {
        try { if (audio.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) audio.stop(); }
        catch (RuntimeException ignored) { }
        audio.release();
      }
      try { if (stream != null) stream.release(); }
      finally { if (recognizer != null) worker.idle(error != null); }
      finished = true;
      final String finalText = text, failureMessage = error;
      post(() -> {
        if (failureMessage != null) listener.onError(failureMessage);
        else if (finalText.isEmpty()) listener.onStopped();
        else listener.onFinal(finalText);
      });
    }
  }
}
