# Security Policy

agentBridge is an Android app that holds SSH credentials for your machines and
can send input to AI coding agents running on them. Treat the phone it is
installed on as a privileged developer device.

## Supported versions

Security fixes are applied to the latest commit on `main` and the newest
`android-v*` release. Older APKs are not patched.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's
private vulnerability reporting for this repository:

<https://github.com/otterview-labs/agentbridge/security/advisories/new>

Include the affected version or commit, reproduction steps, impact, and any
suggested mitigation. Do not include real credentials, private source code,
production data, or destructive proof-of-concept payloads.

## What the app stores and where it goes

| Data | Stored | Leaves the phone |
|------|--------|------------------|
| SSH passwords and private keys | App-private storage, encrypted with a non-exportable Android Keystore key (AES-GCM) | Only to the SSH server they belong to |
| Model API key | Same as above | Only to the model base URL you configure (HTTPS required, except `localhost`) |
| FRP auth token and STCP secrets | Same as above | Written to the FRP config on your public entry and target machines |
| Machine list, discovered tasks, agent output | App-private storage | Task titles and summaries are sent to your model provider when you use the butler |
| Butler chat and memories | App-private storage | The last 20 messages and saved memories go to your model provider with each question |
| Voice | Not stored | With a DashScope model, audio is streamed to Alibaba Cloud for recognition and reply text is sent for speech synthesis |

Cloud backup and device-to-device transfer are disabled
(`allowBackup="false"` plus `dataExtractionRules`). Plain HTTP is refused except
for a model on `localhost` and DashScope's signed audio links, which are
upgraded to HTTPS before playback.

## Boundaries

- The WebView only loads the bundled `phone.html`, blocks navigation elsewhere,
  and runs under a Content-Security-Policy that forbids remote scripts and
  network access. It never receives stored credentials.
- The butler's tools are read-only (list tasks, check machines, read task
  output). Nothing an agent prints can make the butler send input or run
  commands.
- SSH host keys are trusted on first use and pinned. A changed key blocks the
  connection until the user explicitly resets it. The first connection does
  not show the fingerprint, so add machines on a network you trust.
- FRP archives are verified against SHA-256 values pinned in the app, never
  against a checksum downloaded from the same source. On the public entry,
  `frps` and the visitors run as an unprivileged `asb-frp` account, and the
  managed `frps` only allows its own bind port, so a leaked token cannot open
  other public ports. Every machine behind one entry shares its auth token.
- Release APKs are signed and checked to be non-debuggable before publishing.

## Known limitations

- A rooted or compromised phone can read the app's data while the app runs.
- There is no app lock or biometric prompt.
