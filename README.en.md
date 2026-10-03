<div align="center">

<img src="docs/screenshots/icon.png" width="72" alt="agentBridge bridge mark">

# agentBridge · Office Town

### Android client for Codex and Claude Code

Read output, browse history, and reply to sessions running on your computers.<br>
Each computer becomes an office; each task gets a pixel employee.

[![Release](https://img.shields.io/github/v/release/otterview-labs/agentBridge?label=APK&color=3f6845)](https://github.com/otterview-labs/agentBridge/releases/latest)
[![CI](https://github.com/otterview-labs/agentBridge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/otterview-labs/agentBridge/actions/workflows/ci.yml)
[![Android](https://img.shields.io/badge/Android-7.0%2B-3f6845)](https://otterview-labs.github.io/agentBridge/en/)
[![License](https://img.shields.io/github/license/otterview-labs/agentBridge)](LICENSE)

[中文](README.md) · **English**

[Download page](https://otterview-labs.github.io/agentBridge/en/) · [English APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge-en.apk) · [中文 APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge-zh.apk)

| Office | Butler chat | Voice chat |
|:---:|:---:|:---:|
| <img src="docs/screenshots/office-en-0.5.44.png" width="240" alt="Office with pixel employees and tasks awaiting input"> | <img src="docs/screenshots/butler-en-0.5.44.png" width="240" alt="Butler chat with task questions and message input"> | <img src="docs/screenshots/call-en-0.5.44.png" width="240" alt="Voice chat with listening, microphone, speaker and end-call controls"> |

<sub>Screenshots use sample records.</sub>

</div>

## Get started

You need Android 7.0 or later and a Mac or Linux computer reachable over SSH, with an existing Codex or Claude Code session.

### 1. Download the app

[Download the English APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge-en.apk), or choose the [Chinese APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge-zh.apk). The signed release is about 1.5 MB.

### 2. Connect your computer

Use the LAN scan or enter your computer's SSH address, username, and password or private key.

### 3. Find a task and reply

Find existing sessions, open an employee card, and send a reply. Tap refresh to see new output.

You can set up the butler and voice later. Start by connecting your computer and sending a reply. See the [Android guide](docs/android-app.md) for detailed setup.

## How it works

Tasks keep running on your computers. The app uses SSH to read session records and send messages back to the original Codex or Claude Code session. Your computer needs no agentBridge installation or companion service.

Keep your computer on. Away from your LAN, use a reachable SSH address or your own FRP connection. See the [connection guide](docs/android-app.md#add-a-machine).

Tap refresh for the latest task status. Offline computers show saved records.

## What you can do

- Read output and conversation history while away from your desk, then add instructions or answer the agent's questions.
- Keep tasks from several Mac and Linux computers together, with a separate office for each.
- See which tasks are working, idle, or waiting for input. Tasks needing a reply appear first.
- Ask the butler “Which tasks need my reply?” or “What has this task done recently?” It can refresh tasks, check connections, and read output before answering.
- Choose **Help me reply** on an employee card for drafts based on the last refreshed task records. Select one, edit it, and send it yourself; selecting a draft does not send it.
- Use voice input or an in-app call to ask about progress. Configure the model and test speech recognition and playback first.

Choose your own butler model through an OpenAI-compatible API. Instructions to employees are sent from their task cards.

<details>
<summary>Set up butler chat and voice</summary>

Save your provider URL, model name, and API key in model settings, verify the connection, and send a text message.

Then test the microphone and speech playback before starting a call. If system speech services are unavailable, configure Bailian / DashScope cloud speech with a Beijing-region key. Chat and speech can use separate keys. See the [Android guide](docs/android-app.md).

</details>

## Supported tools and editions

| Tool | Current support |
| --- | --- |
| Codex CLI / Codex Desktop sessions | Find sessions, read output and history, send messages |
| Claude Code | Find sessions, read output and history, send messages |
| Gemini CLI | Basic process discovery |

The Chinese **办公小镇** and English **Office Town** apps can be installed together. Each keeps its own settings and records. The Chinese edition updates existing Chinese releases; future English releases update the English app. Original task records retain their language.

Operations such as finding tasks and sending messages can continue after the phone locks, with a notification when they finish or fail.

## Why I’m building Office Town

The more AI tools I use, the more places there are to check. Tasks and records end up spread across sessions and computers. Sometimes I lose track of what got done and what still needs attention. I want one place to check that work and its history.

I also want routine tasks to need less attention. Next, I want the butler to follow up, plan, and handle work within boundaries I set, asking when a decision needs me. Autonomous task management is still planned.

## Data and privacy

Tasks run on the computers you connect. App settings, conversations, and records stay in private app storage on your phone. SSH passwords, private keys, and model credentials are encrypted with Android Keystore and excluded from backups. SSH connections verify saved host keys.

Butler chat sends relevant task information and messages to your chosen model provider. Bailian cloud speech sends audio or playback text to Bailian when enabled. See [SECURITY.md](SECURITY.md).

## Development

Java, Android WebView, JSch / SSH, WebSocket, and Android Service.

Build requirements: JDK 17, Android SDK 35, and Build Tools 35.0.0. Tests also require Node.js 20 or later.

```bash
git clone https://github.com/otterview-labs/agentBridge.git
cd agentBridge/android
./gradlew assembleDebug lintZhDebug lintEnDebug
```

Debug APKs: `android/app/build/outputs/apk/zh/debug/app-zh-debug.apk` and `android/app/build/outputs/apk/en/debug/app-en-debug.apk`. Debug builds use separate application IDs and can coexist with releases.

From the `android` directory, run the tests:

```bash
cd tests
npm ci
npx playwright install chromium
npm test
```

[Report an issue](https://github.com/otterview-labs/agentBridge/issues) or read the [contribution guide](CONTRIBUTING.md).

Licensed under [Apache-2.0](LICENSE).
