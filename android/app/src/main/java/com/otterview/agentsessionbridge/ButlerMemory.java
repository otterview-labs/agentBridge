package com.otterview.agentsessionbridge;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Local conversation evidence, readable as Markdown; never model-inferred decisions. */
final class ButlerMemory {
  private static File file(File root, String scope) {
    if (!scope.matches("town|task-[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid memory scope");
    return new File(new File(root, scope), "HISTORY.md");
  }

  static synchronized String read(File root, String scope) throws Exception {
    File source = file(root, scope);
    if (!source.exists()) return "";
    try (FileInputStream input = new FileInputStream(source)) {
      long remaining = Math.max(0, source.length() - 24000);
      while (remaining > 0) {
        long skipped = input.skip(remaining);
        if (skipped == 0) { if (input.read() < 0) break; skipped = 1; }
        remaining -= skipped;
      }
      byte[] bytes = new byte[24000];
      int length = 0, count;
      while (length < bytes.length && (count = input.read(bytes, length, bytes.length - length)) > 0) length += count;
      return new String(bytes, 0, length, StandardCharsets.UTF_8);
    }
  }

  static synchronized void append(File root, String scope, String turnId, String time,
      String user, String answer) throws Exception {
    File destination = file(root, scope);
    if (!destination.getParentFile().isDirectory() && !destination.getParentFile().mkdirs()) {
      throw new IllegalStateException("Cannot create memory directory");
    }
    String entry = "\n\n<!-- source: " + turnId + "; time: " + time + " -->\n"
        + "## Historical conversation / 历史对话\n\nUser said / 用户原话:\n" + user
        + "\n\nButler reported (not independently verified) / 管家报告（未独立核实）:\n" + answer + "\n";
    try (FileOutputStream output = new FileOutputStream(destination, true)) {
      output.write(entry.getBytes(StandardCharsets.UTF_8));
      output.getFD().sync();
    }
  }
}
