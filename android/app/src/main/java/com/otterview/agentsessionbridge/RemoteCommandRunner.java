package com.otterview.agentsessionbridge;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Bounded command execution. Knows neither Android nor the SSH library. */
final class RemoteCommandRunner {
  interface Channel {
    void configure(String command, InputStream stdin, OutputStream stderr) throws Exception;
    InputStream stdout() throws Exception;
    void connect(int timeoutMillis) throws Exception;
    boolean closed();
    boolean connected();
    int exitStatus();
    void close();
  }

  interface Sleeper { void sleep(long milliseconds) throws InterruptedException; }
  interface ErrorFormatter { String format(String error, int exit, String stage); }

  private static final int MAX_OUTPUT = 2_000_000;
  private static final int MAX_STDERR = 64_000;
  private final LongSupplier clock;
  private final Sleeper sleeper;
  private final ErrorFormatter errors;

  RemoteCommandRunner(ErrorFormatter errors) { this(System::nanoTime, Thread::sleep, errors); }
  RemoteCommandRunner(LongSupplier clock, Sleeper sleeper, ErrorFormatter errors) {
    this.clock = clock;
    this.sleeper = sleeper;
    this.errors = errors;
  }

  String run(Channel channel, String command, InputStream stdin, int timeoutMillis) throws Exception {
    ByteArrayOutputStream stdout = new ByteArrayOutputStream();
    ByteArrayOutputStream stderr = new ByteArrayOutputStream();
    OutputStream boundedStderr = new OutputStream() {
      @Override public void write(int value) {
        if (stderr.size() < MAX_STDERR) stderr.write(value);
      }
      @Override public void write(byte[] buffer, int offset, int length) {
        int room = MAX_STDERR - stderr.size();
        if (room > 0) stderr.write(buffer, offset, Math.min(room, length));
      }
    };
    try {
      channel.configure(command, stdin, boundedStderr);
      InputStream output = channel.stdout();
      channel.connect(timeoutMillis);
      byte[] buffer = new byte[16_384];
      long deadline = clock.getAsLong() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis);
      while (!channel.closed() && channel.connected() && clock.getAsLong() < deadline) {
        while (output.available() > 0 && clock.getAsLong() < deadline) {
          int read = output.read(buffer);
          if (read < 0) break;
          if (stdout.size() < MAX_OUTPUT) stdout.write(buffer, 0, Math.min(read, MAX_OUTPUT - stdout.size()));
        }
        sleeper.sleep(25);
      }
      boolean timedOut = !channel.closed() && clock.getAsLong() >= deadline;
      while (output.available() > 0 && !timedOut) {
        int read = output.read(buffer);
        if (read < 0) break;
        if (stdout.size() < MAX_OUTPUT) stdout.write(buffer, 0, Math.min(read, MAX_OUTPUT - stdout.size()));
      }
      int exit = channel.exitStatus();
      String stage = "";
      Matcher stages = Pattern.compile("(?m)^ASB_STAGE=([a-z-]+)$")
          .matcher(new String(stdout.toByteArray(), StandardCharsets.UTF_8));
      while (stages.find()) stage = UiText.text("，阶段 ") + stages.group(1);
      if (timedOut) throw new IllegalArgumentException(UiText.text("远程命令超过 ") + (timeoutMillis / 1000)
          + UiText.text(" 秒") + stage + UiText.text("；远程进程可能仍在运行，请检查后再试"));
      if (exit == -1) throw new IllegalArgumentException(UiText.text("SSH 连接中断或未返回退出状态")
          + stage + UiText.text("；请检查网络及远程服务"));
      if (exit != 0) {
        String error = new String(stderr.toByteArray(), StandardCharsets.UTF_8).trim();
        if (error.length() > 1500) error = error.substring(error.length() - 1500);
        throw new IllegalArgumentException(errors.format(error, exit, stage));
      }
      String value = new String(stdout.toByteArray(), StandardCharsets.UTF_8);
      return value.length() > MAX_OUTPUT ? value.substring(0, MAX_OUTPUT) : value;
    } finally {
      channel.close();
    }
  }
}
