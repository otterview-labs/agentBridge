package com.otterview.agentsessionbridge;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.AlarmManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.media.AudioAttributes;
import android.media.MediaPlayer;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.SystemClock;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.media.MediaRecorder;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.WebChromeClient;
import android.webkit.ConsoleMessage;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.File;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class MainActivity extends Activity {
  private static final int REQUEST_VOICE = 41024;
  private static final int REQUEST_NOTIFICATIONS = 41025;
  private static final int RESULT_NOTIFICATION_ID = 41027;

  private WebView webView;
  private PhoneBridge bridge;
  private SpeechRecognizer recognizer;
  private TextToSpeech textToSpeech;
  private boolean textToSpeechReady;
  private volatile float ttsRate = 1.0f;
  private volatile float ttsPitch = 1.0f;
  private volatile boolean preferCloudTts;
  private boolean pendingVoiceAutoSend;
  private long lastVoiceLevelAt;
  private MediaRecorder cloudRecorder;
  private File cloudAudioFile;
  private boolean cloudRecording;
  private long cloudRecordingStartedAt;
  private long cloudLastVoiceAt;
  private boolean cloudHeardSpeech;
  private boolean cloudStopInFlight;
  private boolean preferCloudRecording;
  private int recognizerFailureCount;
  private AudioManager audioManager;
  private AudioFocusRequest callFocusRequest;
  private MediaPlayer cloudSpeechPlayer;
  private int networkDeathCount;
  private long firstNetworkDeathAt;
  private long lastNetworkRestartAt = -600_000L;
  private StreamingASR streamingASR;
  private final Handler voiceHandler = new Handler(Looper.getMainLooper());
  private final Runnable cloudLevelRunnable = new Runnable() {
    @Override public void run() {
      if (!cloudRecording || cloudRecorder == null) return;
      int amplitude = cloudRecorder.getMaxAmplitude();
      long now = System.currentTimeMillis();
      if (amplitude > 1200) {
        cloudHeardSpeech = true;
        cloudLastVoiceAt = now;
      }
      postVoiceState("level", String.valueOf(Math.min(100, amplitude / 327)),
          pendingVoiceAutoSend);
      // Call mode has no finger-release action to stop the recording, so the
      // level monitor doubles as a silence detector: once the caller has said
      // something and then stays quiet, finish the clip and transcribe it.
      if (cloudHeardSpeech
          && now - cloudLastVoiceAt >= 2000
          && now - cloudRecordingStartedAt >= 1500) {
        stopCloudRecording();
        return;
      }
      voiceHandler.postDelayed(this, 160);
    }
  };

  private void ensureResultChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(
          "asb_task_results", "Agent Bridge 任务结果", NotificationManager.IMPORTANCE_DEFAULT);
      getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
  }

  void showTaskNotification(String title, String message) {
    ensureResultChannel();
    Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
        ? new Notification.Builder(this, "asb_task_results")
        : new Notification.Builder(this);
    PendingIntent contentIntent = PendingIntent.getActivity(
        this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE);
    Notification notification = builder
        .setSmallIcon(android.R.drawable.ic_dialog_info)
        .setContentTitle(title)
        .setContentText(message)
        .setContentIntent(contentIntent)
        .setAutoCancel(true)
        .build();
    getSystemService(NotificationManager.class).notify(RESULT_NOTIFICATION_ID, notification);
  }

  private void initializeConversationAudio() {
    audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
  }

  private String preferredTtsEnginePackage() {
    try {
      Intent service = new Intent("android.intent.action.TTS_SERVICE");
      List<ResolveInfo> engines = getPackageManager().queryIntentServices(service, 0);
      if (engines == null || engines.isEmpty()) return null;
      String preferred = "com.oplus.ttsaccessibilityengine";
      for (ResolveInfo engine : engines) {
        if (engine.serviceInfo != null && preferred.equals(engine.serviceInfo.packageName)) return preferred;
      }
      return engines.get(0).serviceInfo == null ? null : engines.get(0).serviceInfo.packageName;
    } catch (Exception error) {
      return null;
    }
  }

  void startConversationAudio(boolean speakerOn) {
    runOnUiThread(() -> {
      if (audioManager == null) audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
      if (audioManager == null) return;
      audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
      audioManager.setSpeakerphoneOn(speakerOn);
      int result;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
        callFocusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener(focus -> {
              if (focus == AudioManager.AUDIOFOCUS_LOSS) postVoiceState("error", "通话音频失去焦点", false);
            })
            .build();
        result = audioManager.requestAudioFocus(callFocusRequest);
      } else {
        result = audioManager.requestAudioFocus(
            focus -> {
              if (focus == AudioManager.AUDIOFOCUS_LOSS) postVoiceState("error", "通话音频失去焦点", false);
            },
            AudioManager.STREAM_VOICE_CALL,
            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK);
      }
      if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
        // Audio focus is best effort: recording and playback both work without
        // it, so surface the condition in logs instead of failing the call.
        Log.w("AgentBridgeNative", "call audio focus request result: " + result);
      }
    });
  }

  void setConversationSpeaker(boolean speakerOn) {
    runOnUiThread(() -> {
      if (audioManager != null) audioManager.setSpeakerphoneOn(speakerOn);
    });
  }

  void stopConversationAudio() {
    runOnUiThread(() -> {
      if (textToSpeech != null) textToSpeech.stop();
      stopCloudSpeechPlayback();
      if (audioManager == null) return;
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && callFocusRequest != null) {
        audioManager.abandonAudioFocusRequest(callFocusRequest);
        callFocusRequest = null;
      }
      audioManager.setSpeakerphoneOn(false);
      audioManager.setMode(AudioManager.MODE_NORMAL);
    });
  }

  void startTaskForeground() {
    Intent intent = new Intent(this, TaskForegroundService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
    else startService(intent);
  }

  void startTaskForegroundWithBridge() {
    Intent intent = new Intent(this, TaskForegroundService.class);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent);
    else startService(intent);
    if (bridge != null) {
      // Give the service a moment to start, then inject the bridge
      new Handler(Looper.getMainLooper()).postDelayed(() -> {
        try {
          // Find the running service and set the bridge
          if (TaskForegroundService.instance != null) {
            TaskForegroundService.instance.setBridge(bridge);
          }
        } catch (Exception error) {
          android.util.Log.w("AgentBridgeNative", "bridge injection failed", error);
        }
      }, 500);
    }
  }

  void stopTaskForeground() {
    stopService(new Intent(this, TaskForegroundService.class));
  }

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      requestPermissions(new String[]{android.Manifest.permission.POST_NOTIFICATIONS},
          REQUEST_NOTIFICATIONS);
    }
    webView = new WebView(this);
    if ((getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
      WebView.setWebContentsDebuggingEnabled(true);
    }
    webView.setBackgroundColor(0xFFF7F2E7);
    webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

    @SuppressLint("SetJavaScriptEnabled")
    WebSettings settings = webView.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setDatabaseEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setCacheMode(WebSettings.LOAD_NO_CACHE);
    settings.setMediaPlaybackRequiresUserGesture(false);
    settings.setSupportZoom(false);
    // Respect the page's phone-sized viewport meta tag without applying the
    // desktop-page overview zoom. This keeps layout, visual, and fixed layers
    // aligned, preventing a hidden 609px-wide horizontal scroll area.
    settings.setUseWideViewPort(true);
    settings.setLoadWithOverviewMode(false);
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      settings.setSafeBrowsingEnabled(true);
    }

    webView.setWebViewClient(new WebViewClient() {
      @Override public boolean shouldOverrideUrlLoading(WebView view, android.webkit.WebResourceRequest request) {
        return !isLocalAsset(request.getUrl().toString());
      }
      @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
        return !isLocalAsset(url);
      }
      private boolean isLocalAsset(String url) {
        return url.matches("file:///android_asset/(studio|phone)\\.html(?:#[a-zA-Z0-9=\\-]*)?");
      }
    });
    webView.setWebChromeClient(new WebChromeClient() {
      @Override public boolean onConsoleMessage(ConsoleMessage message) {
        Log.d("AgentBridgeJS", message.lineNumber() + ":" + message.message());
        return true;
      }
    });
    bridge = new PhoneBridge(this);
    webView.addJavascriptInterface(bridge, "AgentBridge");
    webView.loadUrl("file:///android_asset/phone.html");
    webView.setLayoutParams(new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT));
    setContentView(webView, new ViewGroup.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT));
    initializeConversationAudio();
    String ttsEngine = preferredTtsEnginePackage();
    textToSpeech = new TextToSpeech(this, status -> {
      textToSpeechReady = status == TextToSpeech.SUCCESS;
      if (textToSpeechReady) {
        textToSpeech.setLanguage(new Locale("zh", "CN"));
        AudioAttributes attributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build();
        textToSpeech.setAudioAttributes(attributes);
        textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
          @Override public void onStart(String utteranceId) {
            postVoiceState("speaking", "", false);
          }

          @Override public void onDone(String utteranceId) {
            postVoiceState("speak-ended", "", false);
          }

          @Override public void onError(String utteranceId) {
            postVoiceState("speak-error", "语音播报失败", false);
          }
        });
      }
    }, ttsEngine);
  }

  void startVoiceRecognition(boolean autoSend) {
    runOnUiThread(() -> {
      pendingVoiceAutoSend = autoSend;
      // Try streaming ASR first when we have a DashScope key
      if (startStreamingASR(autoSend)) return;
      if (textToSpeech != null) textToSpeech.stop();
      stopCloudSpeechPlayback();
      if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
        requestPermissions(new String[]{android.Manifest.permission.RECORD_AUDIO}, REQUEST_VOICE);
        return;
      }
      startRecognizer();
    });
  }

  private boolean startStreamingASR(boolean autoSend) {
    try {
      String apiKey = bridge != null ? bridge.getDashScopeApiKey() : null;
      if (apiKey == null || apiKey.trim().isEmpty()) return false;
      if (streamingASR != null && streamingASR.isRunning()) return true;
      streamingASR = new StreamingASR(apiKey.trim(), new StreamingASR.Listener() {
        @Override
        public void onReady() {
          postVoiceState("cloud-recording", "", autoSend);
        }

        @Override
        public void onPartial(String text) {
          postVoiceState("partial", text, autoSend);
        }

        @Override
        public void onFinal(String text) {
          postVoiceState("final", text, autoSend);
        }

        @Override
        public void onError(String message) {
          postVoiceState("error", message, false);
        }
      });
      streamingASR.start();
      return true;
    } catch (Exception error) {
      Log.w("AgentBridgeNative", "Streaming ASR not available, falling back", error);
      return false;
    }
  }

  void stopVoiceRecognition() {
    runOnUiThread(() -> {
      if (streamingASR != null && streamingASR.isRunning()) {
        streamingASR.stop();
        postVoiceState("stopped", "", false);
        return;
      }
      if (cloudRecording) {
        stopCloudRecording();
        return;
      }
      if (recognizer != null) recognizer.stopListening();
    });
  }

  void cancelVoiceRecognition() {
    runOnUiThread(() -> {
      if (streamingASR != null && streamingASR.isRunning()) {
        streamingASR.stop();
        postVoiceState("stopped", "", false);
        return;
      }
      if (cloudRecording && cloudRecorder != null) {
        try {
          cloudRecorder.stop();
        } catch (Exception error) {
          // The recording is being discarded.
        }
        cleanupCloudRecorder();
        if (cloudAudioFile != null) cloudAudioFile.delete();
        postVoiceState("stopped", "", false);
        return;
      }
      if (recognizer != null) {
        recognizer.cancel();
        postVoiceState("stopped", "", false);
      }
    });
  }

  boolean speakText(String text) {
    if (preferCloudTts) return false;
    if (!textToSpeechReady || textToSpeech == null) return false;
    runOnUiThread(() -> {
      // Stop any live microphone capture before playing the reply so the
      // recognizer never transcribes the butler's own voice.
      if (cloudRecording && cloudRecorder != null) {
        try {
          cloudRecorder.stop();
        } catch (Exception error) {
          // The pending clip is discarded either way.
        }
        cleanupCloudRecorder();
        postVoiceState("stopped", "", false);
      }
      if (recognizer != null) {
        try {
          recognizer.stopListening();
        } catch (Exception error) {
          // The recognizer may already be idle.
        }
      }
      textToSpeech.setLanguage(new Locale("zh", "CN"));
      textToSpeech.setSpeechRate(ttsRate);
      textToSpeech.setPitch(ttsPitch);
      textToSpeech.speak(text, TextToSpeech.QUEUE_FLUSH, null, "butler-reply");
      postVoiceState("speaking", "", false);
    });
    return true;
  }

  String synthesizeCloudSpeechUrl(String apiKey, String text) throws Exception {
    HttpURLConnection connection = null;
    try {
      URL url = new URL("https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation");
      connection = openModelConnection(url);
      connection.setRequestMethod("POST");
      connection.setConnectTimeout(15_000);
      connection.setReadTimeout(60_000);
      connection.setDoOutput(true);
      connection.setRequestProperty("Authorization", "Bearer " + apiKey);
      connection.setRequestProperty("Content-Type", "application/json");
      String safeText = text == null ? "" : text.trim();
      if (safeText.isEmpty()) safeText = "管家已回复。";
      if (safeText.length() > 500) safeText = safeText.substring(0, 500);
      org.json.JSONObject payload = new org.json.JSONObject()
          .put("model", "qwen3-tts-flash")
          .put("input", new org.json.JSONObject()
              .put("text", safeText)
              .put("voice", "Cherry"));
      byte[] body = payload.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
      connection.setFixedLengthStreamingMode(body.length);
      try (java.io.OutputStream output = connection.getOutputStream()) {
        output.write(body);
      }
      int status = connection.getResponseCode();
      java.io.InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
      java.io.ByteArrayOutputStream buffer = new java.io.ByteArrayOutputStream();
      byte[] chunk = new byte[8192];
      int read;
      while ((read = stream.read(chunk)) != -1) buffer.write(chunk, 0, read);
      String response = new String(buffer.toByteArray(), java.nio.charset.StandardCharsets.UTF_8);
      if (status >= 400) {
        throw new IllegalStateException("云端语音合成返回 HTTP " + status);
      }
      org.json.JSONObject parsed = new org.json.JSONObject(response);
      String audioUrl = parsed.optJSONObject("output") == null ? null
          : parsed.getJSONObject("output").optJSONObject("audio") == null ? null
          : parsed.getJSONObject("output").getJSONObject("audio").optString("url", "");
      if (audioUrl == null || audioUrl.isEmpty()) {
        throw new IllegalStateException("云端语音合成没有返回音频");
      }
      return audioUrl;
    } catch (java.io.IOException error) {
      throw new IllegalStateException("云端语音合成连接失败：" + error);
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  HttpURLConnection openModelConnection(URL url) throws Exception {
    ConnectivityManager manager = getSystemService(ConnectivityManager.class);
    if (manager != null) {
      // Resolve through each candidate network explicitly. Some OEM resolver
      // setups leave the process default unable to resolve external model
      // hosts even though the active network itself is fine; Network#getAllByName
      // pins resolution and routing to one network and sidesteps that state.
      java.util.List<Network> candidates = new java.util.ArrayList<>();
      Network active = manager.getActiveNetwork();
      if (active != null) candidates.add(active);
      for (Network network : manager.getAllNetworks()) {
        if (candidates.contains(network)) continue;
        NetworkCapabilities capabilities = manager.getNetworkCapabilities(network);
        if (capabilities == null || capabilities.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
        if (!capabilities.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
            && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)
            && !capabilities.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) continue;
        candidates.add(network);
      }
      for (Network network : candidates) {
        try {
          // DNS alone can succeed on a VPN whose data path is dead; probe a
          // real TCP connection so HTTP never lands on an unusable network.
          java.net.InetAddress[] addresses = network.getAllByName(url.getHost());
          if (addresses.length == 0) continue;
          java.net.Socket probe = network.getSocketFactory().createSocket();
          try {
            probe.connect(new java.net.InetSocketAddress(addresses[0], url.getPort() > 0 ? url.getPort() : 443), 4_000);
          } finally {
            try {
              probe.close();
            } catch (Exception closeError) {
              // The probe socket is discarded either way.
            }
          }
          return (HttpURLConnection) network.openConnection(url);
        } catch (java.io.IOException error) {
          Log.w("AgentBridgeNative", "model network candidate failed for " + url.getHost()
              + " net=" + network + " -> " + error);
          // Try the next network.
        }
      }
    }
    return (HttpURLConnection) url.openConnection();
  }

  void playSpeechUrl(String audioUrl) {
    runOnUiThread(() -> {
      stopCloudSpeechPlayback();
      try {
        cloudSpeechPlayer = new MediaPlayer();
        cloudSpeechPlayer.setAudioAttributes(new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build());
        cloudSpeechPlayer.setDataSource(audioUrl);
        cloudSpeechPlayer.setOnPreparedListener(player -> {
          postVoiceState("speaking", "", false);
          player.start();
        });
        cloudSpeechPlayer.setOnCompletionListener(player -> {
          postVoiceState("speak-ended", "", false);
          stopCloudSpeechPlayback();
        });
        cloudSpeechPlayer.setOnErrorListener((player, what, extra) -> {
          postVoiceState("speak-error", "云端语音播放失败", false);
          stopCloudSpeechPlayback();
          return true;
        });
        cloudSpeechPlayer.prepareAsync();
      } catch (Exception error) {
        postVoiceState("speak-error", "云端语音播放失败", false);
        stopCloudSpeechPlayback();
      }
    });
  }

  void stopCloudSpeechPlayback() {
    if (cloudSpeechPlayer != null) {
      try {
        cloudSpeechPlayer.stop();
      } catch (Exception error) {
        // The player may already be stopped or unprepared.
      }
      try {
        cloudSpeechPlayer.release();
      } catch (Exception error) {
        // Release is best effort; the reference is cleared either way.
      }
      cloudSpeechPlayer = null;
    }
  }

  void noteNetworkAlive() {
    networkDeathCount = 0;
  }

  void noteNetworkDeath() {
    long now = SystemClock.elapsedRealtime();
    if (now - firstNetworkDeathAt > 30_000) {
      firstNetworkDeathAt = now;
      networkDeathCount = 0;
    }
    networkDeathCount += 1;
    if (networkDeathCount < 5) return;
    if (now - lastNetworkRestartAt < 600_000L) return;
    // ColorOS network services (com.oplus.nas) keep per-process routing
    // configs; after their tunnel state changes, every socket of a running
    // process dies while a fresh process works immediately. Restarting the
    // process is the only reliable recovery on these OEM builds.
    postVoiceState("error", "系统网络通道变化，应用将自动重启恢复", false);
    runOnUiThread(() -> {
      lastNetworkRestartAt = SystemClock.elapsedRealtime();
      try {
        android.content.Intent intent = new android.content.Intent(this, MainActivity.class)
            .addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent restart = PendingIntent.getActivity(this, 91, intent,
            PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarm = getSystemService(AlarmManager.class);
        if (alarm != null) {
          alarm.setExact(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + 500, restart);
        }
      } catch (Exception error) {
        Log.w("AgentBridgeNative", "restart scheduling failed", error);
      }
      finishAffinity();
      System.exit(0);
    });
  }

  void setTtsSettings(float rate, float pitch) {
    ttsRate = Math.max(0.5f, Math.min(2.0f, rate));
    ttsPitch = Math.max(0.5f, Math.min(2.0f, pitch));
  }

  void setTtsEnginePreference(boolean preferCloud) {
    preferCloudTts = preferCloud;
  }

  boolean getTtsStatus(java.util.Map<String, Object> status) {
    status.put("ready", textToSpeechReady && textToSpeech != null);
    try {
      if (textToSpeech != null) {
        String engine = textToSpeech.getDefaultEngine();
        if (engine != null) status.put("engine", engine);
        status.put("language", textToSpeech.getLanguage().toString());
      }
    } catch (Exception error) {
      // Status stays best-effort; speaking itself reports failures.
    }
    return true;
  }

  void stopSpeaking() {
    runOnUiThread(() -> {
      if (textToSpeech != null) textToSpeech.stop();
      stopCloudSpeechPlayback();
      postVoiceState("stopped", "", false);
    });
  }

  private void startRecognizer() {
    if (preferCloudRecording || !SpeechRecognizer.isRecognitionAvailable(this)) {
      startCloudRecording();
      return;
    }
    // Keep one recognizer instance and reset it with cancel() before each
    // session. Destroying a live OEM recognizer crashes natively with a
    // FORTIFY destroyed-mutex abort on some devices.
    if (recognizer != null) {
      try {
        recognizer.cancel();
      } catch (Exception cancelError) {
        try {
          recognizer.destroy();
        } catch (Exception destroyError) {
          // Replace the unusable instance either way.
        }
        recognizer = null;
      }
    }
    if (recognizer == null) {
      recognizer = SpeechRecognizer.createSpeechRecognizer(this);
      recognizer.setRecognitionListener(new VoiceListener());
    }
    postVoiceState("ready", "", pendingVoiceAutoSend);
    Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "zh-CN")
        .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
        .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
    recognizer.startListening(intent);
  }

  private void startCloudRecording() {
    try {
      cloudAudioFile = new File(getCacheDir(), "butler-voice.amr");
      if (cloudAudioFile.exists() && !cloudAudioFile.delete()) {
        postVoiceState("error", "语音缓存文件无法清理", false);
        return;
      }
      cloudRecorder = new MediaRecorder();
      cloudRecorder.setAudioSource(MediaRecorder.AudioSource.MIC);
      // AMR-WB is natively supported by MediaRecorder and by the cloud ASR
      // task; MPEG4/AAC containers are rejected with InvalidParameter.
      cloudRecorder.setOutputFormat(MediaRecorder.OutputFormat.AMR_WB);
      cloudRecorder.setAudioEncoder(MediaRecorder.AudioEncoder.AMR_WB);
      cloudRecorder.setAudioSamplingRate(16_000);
      cloudRecorder.setAudioEncodingBitRate(23_850);
      cloudRecorder.setAudioChannels(1);
      cloudRecorder.setOutputFile(cloudAudioFile);
      cloudRecorder.setMaxDuration(15_000);
      cloudRecorder.setOnInfoListener((recorder, what, extra) -> {
        if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED) {
          // Never stop the recorder from inside its own callback; defer to
          // the handler queue so native state stays consistent.
          voiceHandler.postDelayed(this::stopCloudRecording, 80);
        }
      });
      cloudRecorder.prepare();
      cloudRecorder.start();
      cloudRecording = true;
      cloudRecordingStartedAt = System.currentTimeMillis();
      cloudLastVoiceAt = cloudRecordingStartedAt;
      cloudHeardSpeech = false;
      postVoiceState("cloud-recording", "", pendingVoiceAutoSend);
      voiceHandler.post(cloudLevelRunnable);
    } catch (Exception error) {
      cleanupCloudRecorder();
      postVoiceState("error", "录音启动失败，请检查麦克风权限", false);
    }
  }

  private void stopCloudRecording() {
    if (cloudStopInFlight) return;
    cloudStopInFlight = true;
    voiceHandler.removeCallbacks(cloudLevelRunnable);
    try {
      if (!cloudRecording || cloudRecorder == null) return;
      boolean failed = false;
      try {
        cloudRecorder.stop();
      } catch (Exception error) {
        failed = true;
      }
      cleanupCloudRecorder();
      if (failed || cloudAudioFile == null || !cloudAudioFile.exists() || cloudAudioFile.length() == 0) {
        postVoiceState("error", "没有录到有效语音", false);
        return;
      }
      postVoiceState("cloud-processing", "", pendingVoiceAutoSend);
      File audio = cloudAudioFile;
      boolean autoSend = pendingVoiceAutoSend;
      new Thread(() -> {
        try {
          byte[] bytes = Files.readAllBytes(audio.toPath());
          String base64 = Base64.encodeToString(bytes, Base64.NO_WRAP);
          org.json.JSONObject parsed = bridge.transcribeVoiceAudio(base64, "audio/amr");
          if (!parsed.optBoolean("ok")) {
            throw new IllegalStateException(parsed.optString("error", "语音识别失败"));
          }
          String text = parsed.getJSONObject("data").optString("text", "");
          if (text.trim().isEmpty()) throw new IllegalStateException("没有识别到文字");
          postVoiceState("final", text.trim(), autoSend);
        } catch (Exception error) {
          Log.w("AgentBridgeNative", "cloud voice transcription failed", error);
          String message = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
          // Silence (no speech detected) is normal between turns in call mode;
          // only surface real service failures to the UI.
          if (message.contains("没有识别到文字")) {
            postVoiceState("stopped", "", false);
          } else {
            postVoiceState("error", "语音识别失败：" + message, false);
          }
        } finally {
          if (audio.exists() && !audio.delete()) {
            // A stale cache file is replaced on the next recording.
          }
        }
      }, "agent-bridge-cloud-voice").start();
    } finally {
      cloudStopInFlight = false;
    }
  }

  private void cleanupCloudRecorder() {
    cloudRecording = false;
    voiceHandler.removeCallbacks(cloudLevelRunnable);
    if (cloudRecorder != null) {
      cloudRecorder.release();
      cloudRecorder = null;
    }
  }

  private void postVoiceState(String type, String text, boolean autoSend) {
    runOnUiThread(() -> {
      if (webView == null || isFinishing() || isDestroyed()) return;
      String payload;
      try {
        payload = new org.json.JSONObject()
            .put("type", type)
            .put("text", text)
            .put("autoSend", autoSend)
            .toString();
      } catch (Exception error) {
        payload = "{\"type\":\"error\",\"text\":\"语音状态更新失败\",\"autoSend\":false}";
      }
      webView.evaluateJavascript("window.phoneVoice && window.phoneVoice.update(" + payload + ")", null);
    });
  }

  @Override
  public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
    super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    if (requestCode != REQUEST_VOICE) return;
    if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
      startRecognizer();
    } else {
      postVoiceState("error", "需要麦克风权限才能使用实时语音", false);
    }
  }

  @Override
  public void onBackPressed() {
    if (webView != null) {
      webView.evaluateJavascript(
          "Boolean(window.phoneUI && window.phoneUI.closeTopSheet())",
          handled -> {
            if (isFinishing() || isDestroyed() || "true".equals(handled)) return;
            if (webView != null && webView.canGoBack()) webView.goBack();
            else MainActivity.super.onBackPressed();
          });
      return;
    }
    super.onBackPressed();
  }

  @Override
  protected void onDestroy() {
    if (streamingASR != null) streamingASR.stop();
    cleanupCloudRecorder();
    stopCloudSpeechPlayback();
    stopConversationAudio();
    if (recognizer != null) {
      recognizer.destroy();
      recognizer = null;
    }
    if (textToSpeech != null) {
      textToSpeech.shutdown();
      textToSpeech = null;
    }
    if (bridge != null) bridge.close();
    if (webView != null) {
      webView.destroy();
      webView = null;
    }
    super.onDestroy();
  }

  private final class VoiceListener implements RecognitionListener {
    @Override public void onReadyForSpeech(Bundle params) {
      recognizerFailureCount = 0;
      postVoiceState("recording", "", pendingVoiceAutoSend);
    }

    @Override public void onBeginningOfSpeech() { }

    @Override public void onRmsChanged(float rmsdB) {
      long now = System.currentTimeMillis();
      if (now - lastVoiceLevelAt < 120) return;
      lastVoiceLevelAt = now;
      postVoiceState("level", String.valueOf(Math.max(0, Math.min(100, (rmsdB + 4) * 4))), pendingVoiceAutoSend);
    }

    @Override public void onBufferReceived(byte[] buffer) { }

    @Override public void onEndOfSpeech() {
      postVoiceState("processing", "", pendingVoiceAutoSend);
    }

    @Override public void onError(int error) {
      boolean recoverable = error == SpeechRecognizer.ERROR_NO_MATCH
          || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
      if (!recoverable) recognizerFailureCount += 1;
      // Some OEM recognizer services accept the bind but fail every session
      // (ERROR_CLIENT/NETWORK). After two hard failures in a row, switch this
      // attempt to cloud recording instead of surfacing another dead error.
      if (!recoverable && recognizerFailureCount >= 2) {
        recognizerFailureCount = 0;
        // Remember the fallback for this process: retrying a broken OEM
        // recognizer for every turn only adds latency and crash risk.
        preferCloudRecording = true;
        startCloudRecording();
        return;
      }
      String message = error == SpeechRecognizer.ERROR_NO_MATCH
          ? "没有听到内容，请再按一次语音按钮"
          : error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT
            ? "语音输入超时，请靠近麦克风再试"
            : "语音识别失败，请重试";
      postVoiceState("error", message, false);
    }

    @Override public void onResults(Bundle results) {
      recognizerFailureCount = 0;
      ArrayList<String> values = results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
      String text = values == null || values.isEmpty() ? "" : values.get(0);
      postVoiceState("final", text, pendingVoiceAutoSend);
    }

    @Override public void onPartialResults(Bundle partialResults) {
      ArrayList<String> values = partialResults.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
      String text = values == null || values.isEmpty() ? "" : values.get(0);
      postVoiceState("partial", text, pendingVoiceAutoSend);
    }

    @Override public void onEvent(int eventType, Bundle params) { }
  }
}
