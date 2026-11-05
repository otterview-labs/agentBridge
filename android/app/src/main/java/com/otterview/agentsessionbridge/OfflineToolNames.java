package com.otterview.agentsessionbridge;

import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Speech vocabulary and display spelling; the recognizer decides whether a name was spoken. */
final class OfflineToolNames {
  static final String HOTWORDS = "Codex/Coder :4.0/Open Code/OpenCode/Claude Code";
  private static final Pattern TOOLS = Pattern.compile(
      "(?<![A-Za-z0-9])(?:CODEX|QODER|OPEN *CODE|CLAUDE +CODE|WORK *BUDDY)(?![A-Za-z0-9])",
      Pattern.CASE_INSENSITIVE);

  // Qoder sounds like “coder”. Resolve that homophone only where it names a tool.
  private static final Pattern QODER_COMMAND = Pattern.compile(
      "((?:在|用|打开|启动|切到|换到|交给|让|(?:Codex|OpenCode) *[和与、]) *)"
          + "(?:coder|code *[二而尔])(?= *(?:[里中]|的|检查|执行|继续|看|帮|[，。！？,!.?]|$))",
      Pattern.CASE_INSENSITIVE);
  private static final Pattern QODER_DIRECT_ADDRESS = Pattern.compile(
      "^coder(?= *(?:请)?(?:继续执行|帮我|检查项目|执行任务))", Pattern.CASE_INSENSITIVE);
  private static final Pattern QODER_PHONETIC = Pattern.compile(
      "(?:在|再) *(?:扣[德得尔耳]|扣个耳) *(?=[里中](?:执行|继续|查看|检查|处理|运行))");

  static String format(String text) {
    Matcher matcher = TOOLS.matcher(text.trim());
    StringBuffer result = new StringBuffer();
    while (matcher.find()) {
      String tool = switch (matcher.group().replace(" ", "").toUpperCase(Locale.ROOT)) {
        case "CODEX" -> "Codex";
        case "QODER" -> "Qoder";
        case "OPENCODE" -> "OpenCode";
        case "CLAUDECODE" -> "Claude Code";
        case "WORKBUDDY" -> "WorkBuddy";
        default -> matcher.group();
      };
      matcher.appendReplacement(result, tool);
    }
    String names = QODER_COMMAND.matcher(matcher.appendTail(result).toString()).replaceAll("$1Qoder");
    names = QODER_PHONETIC.matcher(names).replaceAll("在 Qoder ");
    return QODER_DIRECT_ADDRESS.matcher(names).replaceFirst("Qoder");
  }

  private OfflineToolNames() {}
}
