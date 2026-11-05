package com.otterview.agentsessionbridge;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

/** PowerShell transport independent of the Windows OpenSSH default shell. */
final class WindowsRemote {
  private WindowsRemote() {}

  // Only this small bootstrap is on the command line. The actual script and
  // prompt travel on stdin, avoiding CMD's 8191-character limit and escaping.
  static String command() {
    String bootstrap = "$ProgressPreference='SilentlyContinue';"
        + "[Console]::OutputEncoding=New-Object Text.UTF8Encoding($false);"
        + "$reader=New-Object IO.StreamReader([Console]::OpenStandardInput(),[Text.Encoding]::UTF8);"
        + "try { & ([scriptblock]::Create($reader.ReadToEnd())) }"
        + "catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }";
    return "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand "
        + Base64.getEncoder().encodeToString(bootstrap.getBytes(StandardCharsets.UTF_16LE));
  }

  static String quote(String value) {
    if (value == null || value.indexOf('\0') >= 0) {
      throw new IllegalArgumentException("Windows 参数无效");
    }
    return "'" + value.replace("'", "''") + "'";
  }

  static String invocation(String action, String... args) {
    StringBuilder script = new StringBuilder("\nAsb-Main ").append(quote(action));
    for (String arg : args) script.append(' ').append(quote(arg));
    return script.append('\n').toString();
  }
}
