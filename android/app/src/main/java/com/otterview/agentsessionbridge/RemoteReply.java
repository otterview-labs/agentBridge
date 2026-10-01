package com.otterview.agentsessionbridge;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Runs a reply command on the remote machine detached from the SSH channel.
 *
 * <p>An agent turn often takes longer than any sensible SSH timeout, and
 * closing the exec channel early can take the agent process down with it. So
 * the command is started under nohup with its output in a log file, and the
 * phone polls the log until the exit marker appears. If the phone stops
 * waiting, the agent keeps working and the user is told not to resend.
 */
final class RemoteReply {
  static final String EXIT_MARKER = "__ASB_REPLY_EXIT__=";
  // Leave room under PhoneBridge's 2 MB SSH output limit for the exit status.
  static final int OUTPUT_LIMIT = 1_900_000;
  private static final Pattern EXIT = Pattern.compile("(?m)^" + EXIT_MARKER + "([0-9]+)\\s*$");
  private static final Pattern LOG_PATH = Pattern.compile("^/[A-Za-z0-9_./-]+$");

  private RemoteReply() {}

  /** Starts the command in the background and prints the path of its log. */
  static String start(String command) {
    return "set -eu\n"
        + "dir=${TMPDIR:-/tmp}\n"
        + "dir=${dir%/}\n"
        // Logs of replies the phone stopped waiting for are never read again.
        + "find \"$dir\" -maxdepth 1 -name 'asb-reply.*' -type f -mtime +1 -exec rm -f {} + 2>/dev/null || true\n"
        + "log=$(mktemp \"$dir/asb-reply.XXXXXX\")\n"
        + "script=$(mktemp \"$dir/asb-reply-cmd.XXXXXX\")\n"
        + "printf '%s\\n' " + quote(command) + " > \"$script\"\n"
        // Publish status atomically and separately from untrusted agent output.
        + "nohup sh -c 'sh \"$1\" > \"$2\" 2>&1; status=$?; printf \"%s\\n\" \"$status\" > \"$2.exit.tmp\"; "
        + "mv \"$2.exit.tmp\" \"$2.exit\"; rm -f \"$1\"' "
        + "asb-reply \"$script\" \"$log\" < /dev/null > /dev/null 2>&1 &\n"
        + "printf '%s\\n' \"$log\"\n";
  }

  static String requireLogPath(String output) {
    String path = output == null ? "" : output.trim();
    if (!LOG_PATH.matcher(path).matches() || path.contains("..")) {
      throw new IllegalArgumentException("远程机器没有返回回复日志路径");
    }
    return path;
  }

  static String poll(String logPath) {
    String path = requireLogPath(logPath);
    return "tail -c " + OUTPUT_LIMIT + " " + quote(path) + " 2>/dev/null "
        + "| sed '/^" + EXIT_MARKER + "[0-9][0-9]*[[:space:]]*$/d'\n"
        + "if [ -f " + quote(path + ".exit") + " ]; then\n"
        + "  printf '\\n" + EXIT_MARKER + "'; cat " + quote(path + ".exit") + "\n"
        + "fi\n";
  }

  static String cleanup(String logPath) {
    String path = requireLogPath(logPath);
    return "rm -f " + quote(path) + " " + quote(path + ".exit") + " " + quote(path + ".exit.tmp");
  }

  /** The command's exit status, or null while it is still running. */
  static Integer exitCode(String log) {
    Matcher matcher = EXIT.matcher(log == null ? "" : log);
    Integer result = null;
    while (matcher.find()) result = Integer.valueOf(matcher.group(1));
    return result;
  }

  /** The log without the exit marker line. */
  static String output(String log) {
    return EXIT.matcher(log == null ? "" : log).replaceAll("").trim();
  }

  static String quote(String value) {
    return "'" + value.replace("'", "'\\''") + "'";
  }
}
