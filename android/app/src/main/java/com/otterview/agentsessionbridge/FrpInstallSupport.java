package com.otterview.agentsessionbridge;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/** Shell fragments shared by FRP installers, testable without Android. */
final class FrpInstallSupport {
  private FrpInstallSupport() {}

  /**
   * SHA-256 of every archive the installers may fetch, copied from the
   * frp_sha256_checksums.txt of the official GitHub release. They are pinned in
   * the app rather than downloaded next to the archive: a mirror that can swap
   * the archive could swap a checksum file served from the same place.
   */
  private static final Map<String, Map<String, String>> PINNED = new LinkedHashMap<>();

  static {
    Map<String, String> v0611 = new LinkedHashMap<>();
    v0611.put("frp_0.61.1_darwin_amd64.tar.gz", "403a0ee5e92f083a863d984b7af1e9d70ba2aaa28e87f42f1fe085adf76b8491");
    v0611.put("frp_0.61.1_darwin_arm64.tar.gz", "3e65f13a17a284bd6013e6bb6856bc2720074cea6094cc446c1f4c3932154c2d");
    v0611.put("frp_0.61.1_linux_amd64.tar.gz", "bff260b68ca7b1461182a46c4f34e9709ba32764eed30a15dd94ac97f50a2c40");
    v0611.put("frp_0.61.1_linux_arm64.tar.gz", "af6366f2b43920ebfe6235dba6060770399ed1fb18601e5818552bd46a7621f8");
    PINNED.put("0.61.1", Collections.unmodifiableMap(v0611));

    Map<String, String> v0710 = new LinkedHashMap<>();
    v0710.put("frp_0.71.0_darwin_amd64.tar.gz", "1b1b4e2f1836e21e8733f1dddaacd4ed9ae67d7dbee39046b9d7b7eda6253637");
    v0710.put("frp_0.71.0_darwin_arm64.tar.gz", "45be02b186860d375ed49a8941ae9569628a54bf14e67fc36b29c98c99dabcc6");
    v0710.put("frp_0.71.0_linux_amd64.tar.gz", "84f27e39f11169f7adcef8e8b70c9329de17747b1f14dad9fb95eef5682ea716");
    v0710.put("frp_0.71.0_linux_arm64.tar.gz", "f33c293c275d8fc68c654b6fba8f10b2551d6463d09a9fc9cffb7227eae82266");
    PINNED.put("0.71.0", Collections.unmodifiableMap(v0710));
  }

  static Set<String> supportedVersions() {
    return Collections.unmodifiableSet(PINNED.keySet());
  }

  static boolean isSupportedVersion(String version) {
    return PINNED.containsKey(version);
  }

  /** Downloads "$archive" into "$work/frp.tar.gz" and checks it against the pinned SHA-256. */
  static String download(String version) {
    Map<String, String> checksums = PINNED.get(version);
    if (checksums == null) {
      throw new IllegalArgumentException("FRP " + version + " 没有内置校验值，可选版本：" + String.join("、", PINNED.keySet()));
    }
    return downloadWithChecksums(checksums);
  }

  /**
   * Like {@link #download}, but an unsupported version fails only when the
   * fragment runs. Installers skip the download when the binary is already on
   * the machine, so a version saved by an older release keeps working there.
   */
  static String downloadOrRefuse(String version) {
    if (PINNED.containsKey(version)) return download(version);
    return "echo " + quote("FRP " + version + " has no pinned checksum in this app; choose "
        + String.join(" or ", PINNED.keySet()) + " in the public entry settings") + " >&2\nexit 2\n";
  }

  static String quote(String value) {
    return "'" + value.replace("'", "'\\''") + "'";
  }

  static String downloadWithChecksums(Map<String, String> checksums) {
    StringBuilder table = new StringBuilder("case \"$(basename \"$archive\")\" in\n");
    for (Map.Entry<String, String> entry : checksums.entrySet()) {
      if (!entry.getKey().matches("[A-Za-z0-9_.-]+") || !entry.getValue().matches("[0-9a-f]{64}")) {
        throw new IllegalArgumentException("Invalid pinned FRP checksum");
      }
      table.append("  ").append(entry.getKey()).append(") expected=").append(entry.getValue()).append(" ;;\n");
    }
    table.append("  *) echo 'No pinned checksum for this FRP archive' >&2; exit 2 ;;\nesac\n");
    return "printf 'ASB_STAGE=download\\n'\n"
        + "asb_download() {\n"
        + "  destination=$1\n"
        + "  shift\n"
        + "  for url in \"$@\"; do\n"
        + "    curl -fsSL --connect-timeout 15 --max-time 60 --retry 1 \"$url\" -o \"$destination\" && return 0\n"
        + "    rm -f \"$destination\"\n"
        + "  done\n"
        + "  return 1\n"
        + "}\n"
        + "archive_downloaded=0\n"
        + "asb_download \"$work/frp.tar.gz\" \"$archive\" && archive_downloaded=1 || true\n"
        + "case \"$archive\" in https://github.com/*) [ \"$archive_downloaded\" -eq 1 ] || { asb_download \"$work/frp.tar.gz\" \"https://gh-proxy.com/$archive\" && archive_downloaded=1 || true; } ;; esac\n"
        + "[ \"$archive_downloaded\" -eq 1 ] || exit 1\n"
        + "printf 'ASB_STAGE=checksum\\n'\n"
        + table
        + "if command -v sha256sum >/dev/null 2>&1; then actual=$(sha256sum \"$work/frp.tar.gz\");\n"
        + "elif command -v shasum >/dev/null 2>&1; then actual=$(shasum -a 256 \"$work/frp.tar.gz\");\n"
        + "else echo 'Need sha256sum or shasum to verify FRP' >&2; exit 2; fi\n"
        + "actual=${actual%% *}\n"
        + "[ \"$(printf '%s' \"$actual\" | tr 'A-F' 'a-f')\" = \"$expected\" ] "
        + "|| { echo 'FRP checksum mismatch; installation stopped' >&2; exit 2; }\n"
        + "printf 'ASB_STAGE=install\\n'\n";
  }

  /**
   * Creates the unprivileged system account the FRP services on the public
   * entry run as. Expects $SUDO to be set by the caller.
   */
  static String serviceAccount() {
    return "if ! id -u asb-frp >/dev/null 2>&1; then\n"
        + "  $SUDO useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin asb-frp 2>/dev/null \\\n"
        + "    || $SUDO adduser -S -H -s /sbin/nologin asb-frp 2>/dev/null \\\n"
        + "    || { echo 'Cannot create the asb-frp service account' >&2; exit 2; }\n"
        + "fi\n";
  }

  /**
   * Creates the install directories readable by the service account. The
   * installers run under umask 077, and mkdir -p leaves directories from older
   * releases as they were, so the modes are set explicitly every time.
   */
  static String serviceDirectories() {
    return "$SUDO mkdir -p /opt/asb-frp/bin /etc/asb-frp\n"
        + "$SUDO chmod 0755 /opt/asb-frp /opt/asb-frp/bin\n"
        + "$SUDO chown root:asb-frp /etc/asb-frp\n"
        + "$SUDO chmod 0750 /etc/asb-frp\n";
  }

  /** systemd [Service] lines that keep FRP away from root and the rest of the system. */
  static String serviceHardening() {
    return "User=asb-frp\nGroup=asb-frp\nNoNewPrivileges=yes\nPrivateTmp=yes\nProtectSystem=full\nProtectHome=yes\n";
  }

  static String macLaunchAgent(String label) {
    if (!label.matches("[A-Za-z0-9_.-]+")) throw new IllegalArgumentException("Invalid launch agent label");
    return "printf 'ASB_STAGE=launch-agent\\n'\n"
        + "domain=\"gui/$(id -u)\"\n"
        + "launchctl print \"$domain\" >/dev/null 2>&1 || { echo 'Mac GUI session unavailable; sign in to the Mac desktop before enabling remote access' >&2; exit 2; }\n"
        + "mkdir -p \"$HOME/Library/LaunchAgents\"\n"
        + "plist=\"$HOME/Library/LaunchAgents/com.agent-session-bridge.frpc." + label + ".plist\"\n"
        + "home_xml=$(printf '%s' \"$HOME\" | sed 's/\\&/\\&amp;/g;s/</\\&lt;/g;s/>/\\&gt;/g')\n"
        + "cat > \"$plist\" <<PLIST\n"
        + "<?xml version=\"1.0\" encoding=\"UTF-8\"?><plist version=\"1.0\"><dict>"
        + "<key>Label</key><string>com.agent-session-bridge.frpc." + label + "</string>"
        + "<key>ProgramArguments</key><array><string>${home_xml}/.asb-frp/bin/frpc</string><string>-c</string>"
        + "<string>${home_xml}/.config/agent-session-bridge/frpc.toml</string></array>"
        + "<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>"
        + "<key>StandardOutPath</key><string>${home_xml}/.asb-frp/frpc.log</string>"
        + "<key>StandardErrorPath</key><string>${home_xml}/.asb-frp/frpc-error.log</string>"
        + "</dict></plist>\nPLIST\n"
        + "plutil -lint \"$plist\" >/dev/null\n"
        + "launchctl bootout \"$domain\" \"$plist\" >/dev/null 2>&1 || true\n"
        + "launchctl bootstrap \"$domain\" \"$plist\"\n"
        + "launchctl kickstart \"$domain/com.agent-session-bridge.frpc." + label + "\"\n"
        + "sleep 1\n"
        + "launchctl print \"$domain/com.agent-session-bridge.frpc." + label + "\" | grep -q 'state = running' "
        + "|| { echo 'FRP launch agent is not running; inspect ~/.asb-frp/frpc-error.log' >&2; exit 2; }\n";
  }
}
