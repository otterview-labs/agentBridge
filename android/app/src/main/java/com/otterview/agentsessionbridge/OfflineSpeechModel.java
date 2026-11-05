package com.otterview.agentsessionbridge;

import android.content.Context;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URL;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import javax.net.ssl.HttpsURLConnection;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Downloaded only on request. Recognition opens files in app-private storage. */
final class OfflineSpeechModel {
  private static final String VERSION = "xasr-zh-en-int8-v1";
  private static final String URL_ROOT =
      "https://github.com/otterview-labs/agentBridge/releases/download/offline-voice-v1/";
  static final String ENCODER = "encoder.int8.onnx";
  static final String DECODER = "decoder.onnx";
  static final String JOINER = "joiner.int8.onnx";
  static final String TOKENS = "tokens.txt";
  static final String BPE = "bpe.vocab";
  // Values are produced by tools/package-offline-voice.py from the pinned upstream archive.
  private static final String SHA256 = "d493734b3b39be233badef29aed3ca93151ffa7f3d8d56c07e3a22c65b6e4b0a";
  private static final long DOWNLOAD_BYTES = 129118208;
  private static final Map<String, Long> FILES = Map.of(
      ENCODER, 155278641L, DECODER, 11309084L, JOINER, 2581422L,
      TOKENS, 58806L, BPE, 69594L);
  private static final Set<String> DOWNLOAD_HOSTS = Set.of(
      "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com");
  private static OfflineSpeechModel instance;
  private final File root;
  private final File installed;
  private volatile String state = "missing";
  private volatile long receivedBytes;

  static synchronized OfflineSpeechModel get(Context context) {
    if (instance == null) instance = new OfflineSpeechModel(context.getNoBackupFilesDir());
    return instance;
  }

  private OfflineSpeechModel(File directory) {
    root = new File(directory, "offline-speech");
    installed = new File(root, VERSION);
  }

  File directory() {
    for (var file : FILES.entrySet()) {
      File candidate = new File(installed, file.getKey());
      if (!candidate.isFile() || candidate.length() != file.getValue()) return null;
    }
    return installed;
  }

  String state() {
    String snapshot = state;
    if (directory() != null) return "ready";
    return "ready".equals(snapshot) ? "missing" : snapshot;
  }
  long downloadedBytes() { return receivedBytes; }
  static long totalBytes() { return DOWNLOAD_BYTES; }

  synchronized void startDownload() {
    if ("downloading".equals(state) || directory() != null) return;
    receivedBytes = 0;
    state = "downloading";
    Thread thread = new Thread(this::install, "offline-speech-download");
    thread.start();
  }

  private void install() {
    File archive = new File(root, VERSION + ".part");
    File staged = new File(root, VERSION + ".staged");
    String outcome = "error";
    try {
      if (!root.isDirectory() && !root.mkdirs()) throw new IOException("Model directory unavailable");
      clearStaging(staged);
      if (root.getUsableSpace() < DOWNLOAD_BYTES + FILES.values().stream().mapToLong(Long::longValue).sum() + 8_000_000) {
        outcome = "storage";
        return;
      }
      fetch(archive);
      unpack(archive, staged);
      // No recognizer can open an incomplete model: publish the entire directory atomically.
      clearStaging(installed);
      if (!staged.renameTo(installed)) throw new IOException("Cannot publish model");
      outcome = "ready";
    } catch (Exception error) {
      android.util.Log.w("OfflineSpeech", "Model download failed (" + error.getClass().getSimpleName() + ")");
    } finally {
      archive.delete();
      clearStaging(staged);
      // Keep the state as downloading until the previous worker has finished cleaning up.
      state = outcome;
    }
  }

  private void fetch(File archive) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    URL target = new URL(URL_ROOT + VERSION + ".zip");
    for (int attempt = 0; attempt < 5; attempt++) {
      if (!"https".equals(target.getProtocol()) || !DOWNLOAD_HOSTS.contains(target.getHost())) {
        throw new IOException("Unexpected model download host");
      }
      HttpsURLConnection connection = (HttpsURLConnection) target.openConnection();
      try {
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(15_000);
        connection.setReadTimeout(30_000);
        int status = connection.getResponseCode();
        if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
          String next = connection.getHeaderField("Location");
          if (next == null) throw new IOException("Missing download redirect");
          target = new URL(target, next);
          continue;
        }
        if (status != 200) throw new IOException("Model host returned HTTP " + status);
        try (InputStream input = new DigestInputStream(connection.getInputStream(), digest);
             FileOutputStream output = new FileOutputStream(archive)) {
          byte[] buffer = new byte[64 * 1024];
          for (int read; (read = input.read(buffer)) != -1;) {
            if (receivedBytes + read > DOWNLOAD_BYTES) throw new IOException("Model download exceeded its expected size");
            output.write(buffer, 0, read);
            receivedBytes += read;
          }
        }
        if (receivedBytes != DOWNLOAD_BYTES || !SHA256.equals(hex(digest.digest()))) {
          throw new IOException("Model download did not match its checksum");
        }
        return;
      } finally {
        connection.disconnect();
      }
    }
    throw new IOException("Too many model download redirects");
  }

  private static void unpack(File archive, File staged) throws IOException {
    if (!staged.mkdir()) throw new IOException("Cannot stage the offline model");
    Set<String> seen = new HashSet<>();
    try (ZipInputStream input = new ZipInputStream(new java.io.FileInputStream(archive))) {
      byte[] buffer = new byte[64 * 1024];
      for (ZipEntry entry; (entry = input.getNextEntry()) != null;) {
        Long expected = FILES.get(entry.getName());
        if (expected == null || entry.isDirectory() || !seen.add(entry.getName())) {
          throw new IOException("Unexpected file in the model pack");
        }
        long remaining = expected;
        try (FileOutputStream output = new FileOutputStream(new File(staged, entry.getName()))) {
          for (int n; (n = input.read(buffer)) != -1;) {
            remaining -= n;
            if (remaining < 0) throw new IOException("Model file exceeded its expected size");
            output.write(buffer, 0, n);
          }
          output.getFD().sync();
        }
        if (remaining != 0) throw new IOException("Incomplete model file");
      }
    }
    if (seen.size() != FILES.size()) throw new IOException("Incomplete model pack");
  }

  private static String hex(byte[] hash) {
    StringBuilder result = new StringBuilder();
    for (byte b : hash) {
      result.append(Character.forDigit((b & 0xff) >>> 4, 16));
      result.append(Character.forDigit(b & 15, 16));
    }
    return result.toString();
  }

  private static void clearStaging(File directory) {
    File[] files = directory.listFiles();
    if (files != null) for (File file : files) file.delete();
    directory.delete();
  }
}
