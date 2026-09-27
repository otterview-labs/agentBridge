# Changelog

Notable changes to agentBridge are documented here.

## Unreleased

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
