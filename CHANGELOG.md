# Changelog

Notable changes to agentBridge are documented here.

## Unreleased

### Android 0.5.38 — security and reliability fixes from the code review

Security

- SSH passwords, private keys, the model API key and FRP secrets are encrypted
  with an Android Keystore key; plain values from older versions are encrypted
  on first read. A transient Keystore failure shows an error instead of an
  empty list, so nothing is overwritten. Cloud backup and device transfer are
  disabled.
- The WebView no longer receives stored credentials. Edit forms show
  "已保存" and an empty field keeps the saved value. `phone.html` has a
  Content-Security-Policy.
- Plain HTTP is limited to a model on `localhost` and DashScope audio links,
  which are fetched over HTTPS.
- FRP archives are verified against SHA-256 values pinned in the app (0.61.1,
  0.71.0) instead of a checksum file from the same mirror. An unpinned version
  saved earlier keeps working where FRP is installed but is not downloaded. The
  download base must be an HTTPS URL (prefix mirrors are accepted).
- `frps` and the visitors on the public entry run as an unprivileged
  `asb-frp` account with systemd hardening; the managed `frps` only allows its
  own bind port.
- Codex thread ids from the session index are validated before they reach a
  shell command.
- A changed SSH host key now explains itself and offers an explicit reset;
  deleting a machine forgets its host key.

Reliability

- The "network self-heal" no longer kills the app. SSH sockets restore the
  process network binding to exactly what it was (previously the app could stay
  pinned to a VPN), hold it only during connect, and always use the 12-second
  connect timeout. Only ENONET counts as a lost network.
- Slow bridge calls (connection tests, discovery, LAN scan, FRP deployment)
  run on native worker threads; the page no longer freezes.
- Process-session replies run detached on the remote machine and are polled.
  A reply still running after three minutes is reported as delivered, not
  failed, so it is not sent twice. Replies starting with `-` are passed after
  `--` and no longer read as CLI flags.
- Long operations update machines and tasks field by field, so edits made in
  the meantime are kept. Concurrent butler messages are no longer dropped.
  Finished operations are pruned before running ones.
- The foreground service is actually started now, held for as long as any
  operation runs, and stops cleanly at the Android 15 time limit. Its fake
  two-minute polling was removed.
- Streaming ASR follows the DashScope protocol (it previously read the sentence
  object as a string and never produced a final result), checks the microphone
  permission first, releases the microphone on every exit path, and uses the
  echo-cancelling voice-communication source. TTS stops live capture first.
- Call mode ends when the microphone permission is denied, backs off and then
  mutes after repeated recognizer errors, and no longer overwrites the saved
  press-to-talk preferences.
- The butler's tools read the right fields (`list_tasks` returned nothing and
  `get_task_output` was always empty), the last tool round must answer in text,
  and tool errors are valid JSON.

Project

- CI builds the APK and runs the UI, FRP installer and new reply-script tests;
  CodeQL also scans Java; Dependabot covers Gradle and the test packages.
- Test dependencies are declared in `android/tests/package.json`.
- Removed dead code (`ButlerManager`, the one-line operation runnables, the
  unused version catalog), the Studio test for a page no longer in the
  repository, and the Pages workflow for the private `site/` directory.
  Backend design notes moved to `docs/archive/`.
- The Gradle wrapper download is checked against its SHA-256.


### Added

- Android 0.5.31 call stability and network self-heal: keep one recognizer
  instance and reset it with cancel() instead of destroy (OPlus native
  FORTIFY crash), make cloud recorder stops re-entrancy safe, defer the
  max-duration stop out of the recorder callback, remember the cloud-ASR
  fallback for the process, clear stale per-process network bindings left by
  earlier VPN sessions, and surface a clear VPN-blocked error for model DNS
  failures.
- Android 0.5.30 call-mode voice loop: cloud recordings stop on detected
  silence (2.6s after speech) or a 15s cap and then transcribe automatically;
  repeated hard recognizer failures fall back to cloud recording; playback
  stops live capture first to avoid transcribing the butler's own voice; hang
  up and mute discard pending audio instead of sending stale transcripts.
- Android 0.5.29: model and speech HTTP requests now resolve DNS through an
  explicit candidate network (active first, then non-VPN Wi-Fi/cellular),
  fixing OEM resolver states that broke butler chat entirely; cloud TTS via
  qwen3-tts-flash when the local engine is unavailable (OPlus engine is
  system-blocked for third-party apps).
- Android 0.5.28 voice settings sheet: engine status, speech rate and pitch
  with live preview, plus markdown-lite rendering for butler replies and
  cleaner speech text. Call mode now shows live partial transcripts, retries
  listening automatically after recognizer errors, and rebuilds the system
  recognizer per session for OEM reliability. Phones without a system
  recognizer fall back to qwen3-asr-flash when the butler model points at
  DashScope; DashScope chat calls disable hidden thinking so planning JSON is
  not truncated. Task planning now feeds per-task work summaries to the model
  and requires concrete next actions with acceptance criteria.
- Android 0.5.27 butler call mode with communication audio focus, speaker and
  mute controls, a live transcript, call timer, TTS utterance events, and
  continuous listen → send → speak cycles.
- Android 0.5.26 network routing for SSH: JSch temporarily binds to the active
  non-VPN Wi-Fi/Ethernet network and prefers IPv4, working around OEM/VPN rules
  that block raw SSH sockets while leaving HTTP traffic unchanged.
- Discovery now also collapses same-title, same-workspace task records after
  preserving custom names and deleted identities.
- Android 0.5.25 employee removal: deleted employees stay in a per-office
  restorable list, do not reappear during discovery, and never delete remote
  projects, session transcripts, or workspace files.
- Android 0.5.24 discovery de-duplication: Claude processes sharing one session
  collapse to one employee, while Codex Desktop subagent/review threads remain
  hidden under their parent user thread.
- Android 0.5.23 Hub-free butler mode: direct OpenAI-compatible model calls,
  local conversations, local memories, and locally generated task plans.
- Public contribution, support, and security documentation.
- CI and dependency-update automation.
- Security regression coverage for configuration, terminal classification, and workspace path containment.
- Android 0.5.22 background operations for employee discovery, task replies,
  output refresh, and task planning, with a foreground service and system
  success/failure notifications.
- Android background operation counters, restore-on-failure reply drafts, and
  a clearer question/answer task timeline.
- Android task planning copy that leads with actionable one-sentence items.
- Queue fallback for Codex Desktop threads that already have an active writer.
- Hub task-planning generation with bounded state-prioritized context, clearer
  one-sentence prompts, a 180-second deadline, and a 1,800-token output cap.
- Recovery of partially generated task-planning JSON so a truncated final string
  does not discard otherwise valid completed sections.

### Changed

- Android now reports missing Codex rollouts and busy writer locks as specific
  user actions instead of a generic remote-command failure.
- Android relays target the local SSH service when deploying an STCP client,
  allowing a public SSH endpoint to differ from the target machine's local port.
- The Studio UI now calls the saved model analysis “任务规划” instead of “日报”.
- Android no longer packages or uses StudioHubClient; model and planning calls
  no longer require a Hub address or Hub token.

### Changed

- Simplified the README and visible product copy around the agentBridge name.
- Remote HTTP binding now requires a strong API token, explicit allowed hosts, and allowed workspace roots.
- Feishu authorization and workspace trust confirmation now fail closed by default.
- Dependency lock data now uses the official npm registry and patched dependency versions.

### Security

- Hardened terminal command classification against shell-composition and write-capable option bypasses.
- Added canonical-path checks to prevent workspace symlink escapes.
- Added bounded JSON request bodies, constant-time token comparison, security headers, and sanitized internal errors.
- Replaced backtracking Bearer parsing with bounded linear parsing.
- Aligned API token configuration and HTTP transport limits to visible ASCII values of at most 4096 characters.
- Removed browser API tokens from Web Storage and purged values left by earlier versions.

## 0.1.0 - 2026-04-18

- Initial private preview of the tmux and SQLite session bridge.
