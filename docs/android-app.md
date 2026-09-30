# Android Phone Controller

The Android app is a phone-first controller. It has no server component. On launch it opens a local office-town UI and talks to remote Mac /
Linux machines over SSH directly from the phone.

Current debug version:

```text
versionName: 0.5.38
versionCode: 54
minSdk: 24
targetSdk: 35
package: com.otterview.agentsessionbridge.debug
```

Artifact:

```text
android/app/build/outputs/apk/debug/app-debug.apk
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
- Sheets lock background scrolling and keyboard focus. Escape and Android Back
  close the active sheet before leaving the app. Task sheets also close on an
  outside tap.
- Per-office sprite collapse/expand. Collapsing hides the task list entirely
  and leaves only an employee/attention summary; the choice is persisted in
  local storage.
- Private machine/task storage in Android app storage. SSH passwords, private
  keys, the model API key and FRP secrets are encrypted with a non-exportable
  Android Keystore key (AES-GCM); values stored in plain text by older
  versions are encrypted on first read. Cloud backup and device-to-device
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
- Butler chat uses a fixed bottom composer, quick prompts, immediate local
  message echo, a typing indicator, and optional Chinese speech playback.
- The butler model is called directly from Android using an OpenAI-compatible
  `/chat/completions` endpoint. There is no Hub address, Hub token, device
  upload, or desktop Hub round trip.
- Butler conversations, explicit memories, and generated task plans are stored
  in Android app-private storage.
- Butler voice input supports press-and-hold, tap-to-toggle, and slide-up
  cancellation. When the butler model points at DashScope, speech is streamed
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

Voice needs no server. Configure the butler model with a DashScope
(阿里云百炼) OpenAI-compatible base URL to enable streaming recognition
(`paraformer-realtime-v2`), cloud recognition (`qwen3-asr-flash`) and cloud
speech (`qwen3-tts-flash`). With any other provider the phone's own speech
recognizer and Text-to-Speech engine are used. Audio is sent to DashScope only
in the first case.

## Release

The published APK is at
<https://github.com/otterview-labs/agentbridge/releases/latest/download/agentbridge.apk>,
linked from the download page at <https://otterview-labs.github.io/agentbridge/>.
Both are stable permalinks: the release URL always resolves to the newest
release, so neither has to be updated when a version ships. The page itself
is served from the `gh-pages` branch; its source is not part of this
repository.

Pushing a tag matching `android-v*` makes
`.github/workflows/android-release.yml` build, sign, verify, and publish the
APK as `agentbridge.apk`. `workflow_dispatch` builds an existing tag again.
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
together with `assembleDebug`. Locally, with Node.js 20+ and a JDK:

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
  and reports the exit status.

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
