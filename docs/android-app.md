# Android Phone Controller

The Android app is a phone-first controller. It has no server component. On launch it opens a local office-town UI and talks to remote Mac /
Linux machines over SSH directly from the phone.

Current debug version:

```text
versionName: 0.5.44
versionCode: 60
minSdk: 24
targetSdk: 35
package (Chinese): com.otterview.agentsessionbridge.debug
package (English): com.otterview.agentsessionbridge.en.debug
```

Artifact:

```text
android/app/build/outputs/apk/zh/debug/app-zh-debug.apk (Chinese)
android/app/build/outputs/apk/en/debug/app-en-debug.apk (English)
```

## What runs on the phone

- Local office-town UI in `android/app/src/main/assets/`.
- Pixel employee sprites, desks, status bubbles, and state animations matching
  the web office town.
- Compact office actions: discover tasks, collapse, and a disclosure for
  connection tests, editing, and deletion. Titles and summaries use up to two lines.
- Last connection-check timestamps are separate from configuration edits.
  Existing records without a check timestamp show as unchecked until refreshed.
- Refresh reports partial and total failures without claiming stale data is fresh.
  Task details update their status and output together while preserving reply drafts.
- Idle sessions are labeled idle, not pending acceptance; the phone does not
  infer that a task has passed verification.
- Pending-input tasks sort first within each office. The summary's input count
  opens the pending-input list directly, and its tab includes the count.
- Offline or unchecked machines' employees show historical labels and stop
  animating. A successful connection check still does not imply live monitoring.
- Employee reply inputs start empty; legacy keyword approval templates are ignored.
  “帮我写回复” uses the configured model to draft 2–3 choices from only the selected
  employee’s bounded, last-synced records. It runs in the background, does not
  append to butler chat, and has no employee tools. Choices fill an empty draft
  only after selection; the user still edits and sends. Human decisions and
  unverified installation/test claims are not prefilled. Missing models, invalid
  replies, and provider failures show errors without canned fallback suggestions.
  Refreshing or changing the conversation invalidates old choices; late results
  cannot cross employees or overwrite drafts.
- Task replies keep separate in-memory drafts across sheet closes. Drafts do
  not survive a page reload or app restart and are not written to local storage.
  Confirmed sends clear drafts even if the following record reload fails;
  failed sends retain them. Concurrent sends are blocked.
- Reply, discovery, output refresh, and task-planning operations run in native
  background threads. The UI shows a background counter, keeps navigation
  available, and posts a system notification when the operation succeeds or
  fails. A data-sync foreground service is held natively for as long as any
  operation runs, so locking the phone does not kill it. A failed reply restores
  its draft.
- Replies to process sessions start `claude --print` / `codex exec resume`
  detached (`nohup`) on the remote machine and poll its log. If the agent is
  still working after three minutes the phone stops waiting and says the reply
  was delivered; it never reports failure for a reply that is still running, so
  the user is not prompted to send it twice. Arguments are passed after `--`,
  so a reply starting with `-` reaches the agent as text.
- Connection tests, discovery, LAN scans and FRP deployment run as native
  background calls; the page shows progress instead of freezing.
- Cloud speech synthesis also runs in the background. Hanging up or starting
  another capture cancels pending synthesis and discards late speech results.
- Sheets lock background scrolling and keyboard focus. Escape and Android Back
  close the active sheet before leaving the app. Task sheets also close on an
  outside tap.
- Per-office sprite collapse/expand. Collapsing hides the task list entirely
  and leaves only an employee/attention summary; the choice is persisted in
  local storage.
- Private machine/task storage in Android app storage. SSH passwords, private
  keys, the model API key and FRP secrets are encrypted with a non-exportable
  Android Keystore key (AES-GCM); values stored in plain text by older
  versions are encrypted on first read. If encryption fails, the save reports
  an error instead of writing plaintext or caching an unsaved value. Cloud backup and device-to-device
  transfer are disabled. The WebView never receives stored credentials: the
  edit form shows "已保存" and an empty field keeps the saved value.
- SSH host keys are pinned on first connection. If a key changes the app
  refuses to connect and offers **重置主机指纹**, to be used only after a
  reinstall or a replaced machine.
- SSH sockets bind to the active non-VPN Wi-Fi/Ethernet network when one is
  available. This avoids always-on VPN policies that route the app over a tunnel
  while blocking raw SSH, while model HTTP traffic keeps the system default.
  The process-wide binding some OEM stacks need is held only for the DNS lookup
  and connect, serialized, and restored to exactly what it was before. Every
  connect has a 12-second timeout.
- LAN `/24` SSH-port scanner.
- Native SSH client using `com.github.mwiede:jsch`.
- Trust-on-first-use SSH host-key pinning.
- Claude/Codex tmux task discovery.
- Claude/Codex process discovery.
- Codex Desktop thread discovery through `~/.codex/thread-writer-locks`,
  `~/.codex/session_index.jsonl`, and rollout transcripts.
- Codex Desktop subagent/review threads are not shown as separate employees;
  only their parent user thread represents the work.
- Multiple Claude processes that reference the same session ID collapse into
  one employee card. The most informative/running process wins, and custom names
  survive the PID-to-session identity migration.
- Employees can be removed from the active office without deleting remote work.
  Removed employees stay in a per-office deleted list, are excluded from task
  planning and normal discovery, and can be restored later.
- Task aliases and a “waiting for input” list.
- Direct replies to tmux panes and resumable CLI sessions.
- Codex replies prefer the newer Codex Desktop binary so paginated Desktop
  threads can resume successfully.
- If Codex Desktop already owns a thread writer lock, the phone does not force a
  second writer. It queues the message with `codex queue --thread` so the
  existing Desktop thread can continue with it after its current turn.
- A successful process reply returns immediately instead of triggering another
  full discovery scan.
- Reply operations run in the background and expose network reachability,
  phase, and elapsed time to the local UI.
- Optional secure public access through FRP. Each machine can be set to
  `off`, `auto`, or `public`; private machines use STCP tunnels and do not
  expose their SSH ports to the internet.
- The office uses cream surfaces, forest-green accents and pixel employees.
  Butler chat appears before collapsible confirmation and planning sections.
- Butler chat uses a fixed bottom composer, quick prompts, immediate local
  message echo, a typing indicator, and optional speech playback in the edition’s language.
- The butler model is called directly from Android using an OpenAI-compatible
  `/chat/completions` endpoint. There is no Hub address, Hub token, device
  upload, or desktop Hub round trip.
- Saving a model shows **模型待验证**. **验证连接** sends a real completion
  request in a background operation without adding it to chat history; success
  records a verification timestamp. Failed chat keeps the typed message and a
  retry action during the page session, including after refreshing the overview.
- Pasted `/chat/completions` URLs are normalized to the base URL. Endpoints
  that explicitly reject tools can fall back to plain text on the first request.
- The butler has three read-only tools: refresh tasks, check machines, and read
  current task output. It cannot dispatch replies or execute work; use an
  employee card for those actions. Cached records include task/machine IDs and
  timestamps. SSH refresh failures stay visible and never imply an empty office.
- A conversation turn saves its question and answer together. Only one turn can
  run at a time, including across Activity recreation. Temporary operation-read
  failures resume the submitted request rather than sending it twice; committed
  replies can also be recovered from local history by operation ID.
- Voice settings can save a separate, Keystore-encrypted DashScope Beijing API
  key for ASR and TTS, independent of the text model. With no separate key, an
  exact `dashscope.aliyuncs.com` model host supplies the fallback key.
  Other regions need their own endpoint support and are not silently reused.
- Before calling, the app checks available recognition and speech services.
  Missing services lead to voice settings; microphone permission is requested
  at capture time. A silent ASR completion releases the listening state, and
  hanging up discards late transcription results and pending permission starts.
- Butler conversations, explicit memories, and generated task plans are stored
  in Android app-private storage.
- Butler voice input supports press-and-hold, tap-to-toggle, and slide-up
  cancellation. When a Beijing DashScope speech key is available, speech is streamed
  to `paraformer-realtime-v2`: press-to-talk collects every sentence until the
  finger lifts, a call ends the user's turn after one sentence. Otherwise the
  system recognizer is used, with `qwen3-asr-flash` as the fallback. The
  microphone permission is checked before any capture starts. Call mode backs
  off after recognizer errors, mutes itself after three in a row, and ends if
  the permission is denied.
- Voice settings show engine status and provide speech-rate and pitch sliders
  with a preview button; choices persist locally and apply to every playback.
- Butler replies use Android Text-to-Speech. In call mode the app requests
  communication audio focus, uses the speaker route selected by the user, and
  reports utterance start/end so listening can resume automatically.
- Call mode presents a dedicated full-screen conversation UI with mute,
  speaker, elapsed time, live transcript, and hang-up controls. It is an
  in-app voice conversation, not a cellular telephone call.
- Butler replies render basic Markdown emphasis and lists without raw
  asterisks, and spoken text strips symbols and long code blocks.

## Add a machine

1. Open **发现机器** or **添加 SSH**.
2. Let the app scan the current Wi-Fi subnet, or enter a prefix such as
   `192.168.1`.
3. Pick a host with port 22 open.
4. Enter the SSH username and password/private key.
5. Save the office, then tap **找任务**.

The remote machine does not need this project's Hub or runner installed. It
only needs SSH access and permission to read the relevant Claude/Codex files.

## Optional public access

The **公网** tab uses a three-field quick setup: public server address, SSH
user, and password. FRP address, ports, version, download source, and key auth
are tucked into **高级配置**. Saving automatically inspects the public machine,
reuses a healthy **agentBridge-managed** FRP service when possible, adopts a
healthy third-party `frps` when its port and auth token can be read, and otherwise
installs a separate `asb-frps` service. Adoption is read-only: existing services,
configuration, and proxies are not stopped or overwritten. If an existing service
uses an unreadable token, enter it in **高级配置 → 已有 FRP Token**. The default bind port is 7001; if it is occupied,
the app tries 7000 and 7002–7010. The selected port must be allowed by the server's
firewall/security group. The app can:

1. Install and start a checksum-verified `frps` service on the public entry.
2. Install and start a checksum-verified `frpc` service on each selected
   Mac/Linux machine.
3. Create a unique FRP STCP tunnel and strong secret per machine.
4. Install a visitor on the public entry bound only to `127.0.0.1`.
5. Open an SSH local forwarding channel from the phone through the public entry
   before connecting to the target machine.

Archive checksums are pinned in the app (`FrpInstallSupport`) for FRP
0.61.1 (default) and 0.71.0, copied from the official GitHub releases. The
download source and the gh-proxy fallback only supply bytes; a checksum file
is never downloaded, so a mirror cannot vouch for its own archive. A version
saved by an older release keeps working where FRP is already installed, but
the app will not download it; choosing a new version is limited to the pinned
ones. On the public entry `frps` and the visitors run as the
unprivileged `asb-frp` account with systemd hardening, and the managed `frps`
config sets `allowPorts` to its own bind port, so a leaked token cannot open
other public ports. Existing entries pick this up the next time they are
deployed.

Version 0.3.5 fixed installer checksum verification against the downloaded file,
portable shell URL substitution, Mac LaunchAgent absolute/XML-escaped paths,
and visitor config/service naming. Downloads have bounded timeouts and checksum
failures stop installation. Mac LaunchAgents require the target user to be
logged into the desktop; an SSH-only Mac without that GUI session gets an
explicit error rather than false success.

First-time relay installation needs a reachable direct SSH address for the
target. Check this address before deploying; stale LAN addresses cannot be
repaired by installing FRP on the public server. A relay is marked online only
after a fresh SSH connection through the relay succeeds. The phone records
that verification time; it is not a continuous health guarantee.

Deployment errors show the failing stage, including target SSH, download,
checksum, service startup, or end-to-end verification. SSH disconnects and
command deadlines have distinct messages. A deadline does not guarantee the
remote process has stopped: inspect it before retrying.

Per-machine modes:

- `不上公网`: direct LAN SSH only.
- `自动`: use direct LAN access when available, otherwise the secure public
  relay.
- `仅公网`: always use the relay.

The public cloud security group only needs the public machine's SSH port and
the FRP bind port. Do not open target-machine SSH ports to the internet. FRP
uses TLS, a strong random server token, and a unique STCP secret per machine.

## Butler voice setup

Voice needs no self-hosted server. In **语音设置 → 云端语音配置**, save a
DashScope (阿里云百炼) Beijing-region API key to enable streaming recognition
(`paraformer-realtime-v2`), fallback cloud recognition (`qwen3-asr-flash`) and
cloud speech (`qwen3-tts-flash`). The text model can use another provider. With
no separate voice key, a Beijing DashScope text-model key is reused; with no
cloud key, the phone needs working native recognition and TTS engines supporting the edition’s language.
Cloud recognition sends microphone audio to DashScope, and cloud TTS sends
reply text. Other regions' keys are not interchangeable with Beijing keys.

To diagnose a phone setup: save the model, tap **验证连接**, send a short text
message, then use **试听管家声音** and the composer microphone. Once both work,
tap **拨给管家**. A successful model check verifies a completion, not voice
permissions or ASR/TTS entitlements. HTTP 401/403, 404 and 429 errors are shown
with configuration, permission and quota hints.

## Release

The published APK is at
<https://github.com/otterview-labs/agentbridge/releases/latest/download/agentbridge.apk>,
linked from the download page at <https://otterview-labs.github.io/agentBridge/>.
Both are stable permalinks: the release URL always resolves to the newest
release, so neither has to be updated when a version ships. The page itself
is served from the `gh-pages` branch; its source is not part of this
repository.

Pushing a tag matching `android-v*` makes
`.github/workflows/android-release.yml` build, sign, verify, and publish the
APKs as `agentbridge-zh.apk` and `agentbridge-en.apk`; `agentbridge.apk` remains a Chinese compatibility alias. `workflow_dispatch` builds an existing tag again.
The same tag is what makes `/releases/latest` resolve to this release, so do
not publish a newer non-Android release without checking the download page.

Signing material is supplied out of band in two equivalent ways, both read by
`android/app/build.gradle`:

- `android/keystore.properties` (gitignored) for local builds —
  `storeFile`, `storePassword`, `keyAlias`, `keyPassword`.
- `ASB_ANDROID_STORE_FILE`, `ASB_ANDROID_STORE_PASSWORD`,
  `ASB_ANDROID_KEY_ALIAS`, `ASB_ANDROID_KEY_PASSWORD` in CI, with the keystore
  itself in the `ASB_ANDROID_KEYSTORE_BASE64` secret.

A checkout with neither still compiles; `assembleRelease` then just emits an
unsigned APK. CI therefore verifies the signature explicitly rather than
trusting the build to have succeeded, and also rejects a debuggable artifact —
a debuggable build stores SSH credentials where any process on the device can
read them.

> [!IMPORTANT]
> Back up the release keystore and its passwords somewhere outside this
> repository. Android only allows an update to be installed over an existing
> app when both are signed with the same key, so losing it means no future
> build can update a copy already on a phone.

## Tests

CI runs these on every push and pull request (`.github/workflows/ci.yml`),
together with `assembleDebug` and `lintZhDebug lintEnDebug`. Java API desugaring keeps
`java.time` and `java.nio.file` available on the minimum SDK, Android 7.
Locally, with Node.js 20+ and a JDK:

```bash
cd android/tests
npm ci
npx playwright install chromium
npm test
```

- `phone-ui.test.cjs` renders the real Android assets in Chromium with a mock
  native bridge. It does not scan networks, deploy FRP, or reach real machines.
  Set `PLAYWRIGHT_MODULE` to use a Playwright installed elsewhere.
- `frp-install.test.cjs` runs the Java-generated installer fragments with mock
  downloads and launchctl in temporary directories: pinned-checksum
  verification, tampered mirror archives, download failures, the service
  account step, and XML-safe Mac paths (the plist check needs macOS).
- `reply-script.test.cjs` runs the detached reply launcher with a real shell:
  it returns at once, survives quotes, `$()` and leading dashes in the reply,
  and reports the exit status even with multi-megabyte output. Exit status is
  published atomically in a separate file; agent text cannot forge completion.
- `native-regression.test.cjs` compiles production storage and speech methods
  with platform fakes. It checks failed encryption preserves saved values,
  synthesis leaves the UI thread free, and cancellation drops stale results.
  It does not exercise the device Keystore, microphone, or media player.

## Current limitations

- Windows SSH is not yet handled as a first-class target.
- There is no background polling. Launch loads saved records; discovery runs
  on explicit refresh or task-discovery actions, and the foreground service only
  covers operations the user started.
- There is no biometric lock, and the first SSH connection to a host trusts its
  key without showing the fingerprint.
- All machines behind one FRP entry share its auth token (an frp limitation).
- Public relay functionality is implemented, but UI-only tests do not verify
  live SSH or FRP connectivity.


## Chinese and English editions

The Chinese edition keeps the existing `com.otterview.agentsessionbridge` application ID, signing key and upgrade path. The English edition uses `com.otterview.agentsessionbridge.en` and is named Office Town. Both can be installed together; settings, keys and records are separate for each app.

UI controls, native progress/error messages and model-generated butler replies and draft suggestions use the edition’s language. System speech recognition and playback use zh-CN or en-US; cloud ASR and TTS also receive the selected language. Original task names, session output, human messages and saved history are not translated.

Download [Chinese APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge-zh.apk) or [English APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge-en.apk).

The product has two aims: collect scattered AI work and records in one place, and eventually let agents manage routine tasks within user-defined boundaries. The current butler queries tasks and discusses progress. Autonomous task dispatch is not implemented in this release.
