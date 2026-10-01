<div align="center">

<img src="docs/screenshots/icon.png" width="100" alt="agentBridge" style="border-radius: 20px;">

# agentBridge

**Manage your AI coding agents from your phone.**

Each machine becomes a pixel-art office. Each AI task becomes a cute employee.<br>
See who's working, who's waiting for you, and what to do next — at a glance.

[![Download](https://img.shields.io/badge/Download-APK-blue?logo=android&logoColor=white&style=for-the-badge)](https://otterview-labs.github.io/agentBridge/)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue?style=for-the-badge)](LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/otterview-labs/agentBridge/ci.yml?branch=main&label=CI&style=for-the-badge)](https://github.com/otterview-labs/agentBridge/actions/workflows/ci.yml)
[![Platform](https://img.shields.io/badge/Platform-Android-3DDC84?logo=android&logoColor=white&style=for-the-badge)](https://github.com/otterview-labs/agentBridge)

[Features](#-features) · [Screenshots](#-screenshots) · [Install](#-install) · [Architecture](#-architecture) · [中文介绍](#-中文介绍)

</div>

---

## 🎬 Demo

<div align="center">

| 🏢 Office Town | 🤖 AI Butler | 📞 Voice Call |
|:---:|:---:|:---:|
| **Every machine is an office**<br>Every task is an employee<br>Animated sprites show real-time status | **Ask anything, get real answers**<br>SSH into machines for live data<br>Prioritize what needs attention | **Talk like a phone call**<br>Streaming speech-to-text<br>AI responds with voice |
| <img src="docs/screenshots/android-local.png" width="220"> | <img src="docs/screenshots/android-report.png" width="220"> | <img src="docs/screenshots/studio-mobile.png" width="220"> |

</div>

---

## ✨ Features

### 🏢 Visual Task Management

- **Pixel-art office town** — machines are buildings, tasks are animated employees
- **Real-time status** — running (animated), needs-input (hand raised), idle (grayed out)
- **One-tap reply** — see what the AI is asking, respond directly from your phone
- **Color-coded status cards** — green (running), yellow (idle), red (needs input)
- **Conversation timeline** — user/assistant bubbles with code block rendering

### 🤖 AI Butler

- **Smart assistant** powered by qwen-max, GLM, Claude, or any OpenAI-compatible API
- **Real-time tool calling** — the butler SSHes into machines to fetch live task data
- **Actionable advice** — prioritizes tasks, suggests next steps, flags risks
- **Task planning** — auto-generates daily summaries with clear action items

### 📞 Voice & Call Mode

- **Press-to-talk** — hold the mic button, speak, release to send
- **Full call mode** — phone-call UI with timer, live transcript, mute/speaker controls
- **Streaming ASR** — see words appear as you speak (DashScope WebSocket)
- **Cloud TTS** — natural voice replies via qwen3-tts, or use local engine
- **Auto-recovery** — smart network self-healing for OEM-specific issues

### 🔔 Notifications

- **Keeps working when locked** — replies, discovery, refreshes and plans you start run in a foreground service until they finish
- **Result alerts** — a system notification when each of them succeeds or fails
- **No polling** — the app checks machines only when you refresh; it does not watch them in the background

### 🌐 Remote Access (FRP)

- **One-tap FRP setup** — automatically deploy frps/frpc on your machines
- **Encrypted STCP tunnels** — no SSH ports exposed to the internet
- **Auto-discovery** — scans LAN, detects installed AI tools, imports sessions
- **Works anywhere** — access all machines from any network

### 🔒 Privacy & Security

- **No backend of ours** — the phone connects directly to your machines over SSH
- **Encrypted credentials** — SSH passwords, keys and API keys are encrypted with an Android Keystore key, excluded from backups, and never handed to the WebView
- **Pinned host keys** — a changed SSH host key blocks the connection until you reset it
- **Your choice of cloud** — the office town works fully offline within your LAN. If you enable the butler, task titles, machine names, your recent chat and saved memories go to the model provider you configure; with DashScope voice, your audio goes to Alibaba Cloud

---

## 📥 Install

### Download APK

[![Download APK](https://img.shields.io/badge/⬇️-Download_APK-blue?style=for-the-badge&logo=android&logoColor=white)](https://otterview-labs.github.io/agentBridge/)

### Build from Source

```bash
git clone https://github.com/otterview-labs/agentBridge.git
cd agentBridge/android

# Debug build
./gradlew assembleDebug

# APK location
ls app/build/outputs/apk/debug/app-debug.apk
```

### Setup (3 steps)

1. **Add a machine** — enter SSH address, username, and password
2. **Auto-discover** — agentBridge scans and imports all AI sessions
3. **(Optional) Connect AI butler** — add an OpenAI-compatible API key for the smart assistant

---

## 🏗️ Architecture

```
┌─────────────────────┐
│    Android Phone     │
│                      │
│  ┌────────────────┐ │         SSH (direct / FRP tunnel)
│  │  Office Town UI │ │◄──────────────────────────────►  Mac / Linux
│  │  (pixel art)    │ │                                    │
│  ├────────────────┤ │                              ┌─────┴─────┐
│  │  AI Butler      │ │   OpenAI-compatible API     │Claude Code│
│  │  (qwen-max etc) │ │◄──────────────────────►    │Codex CLI  │
│  ├────────────────┤ │                              │Gemini CLI │
│  │  Voice Engine   │ │   DashScope WebSocket       │tmux panes │
│  │  (ASR + TTS)    │ │◄──────────────────────►    └───────────┘
│  ├────────────────┤ │
│  │  SSH + FRP      │ │
│  │  (JSch)         │ │
│  └────────────────┘ │
└─────────────────────┘
```

**Tech stack:** Java · JSch (SSH) · WebSocket (ASR) · WebView · Android Service

---

## 📱 Supported AI Tools

| Tool | Discovery | Status | Features |
|------|-----------|--------|----------|
| **Claude Code** | Process scan + tmux | ✅ Full | Read output, send input, timeline |
| **Codex CLI** | Process scan + desktop | ✅ Full | Read output, send input, timeline |
| **Gemini CLI** | Process scan | ✅ Basic | Session discovery |

---

## 🗺️ Roadmap

- [x] Pixel-art office town UI
- [x] AI butler with tool calling
- [x] Press-to-talk voice input
- [x] Full call mode with TTS
- [x] Cloud ASR with streaming
- [x] Push notifications
- [x] FRP remote access
- [x] Multi-machine management
- [ ] Multi-device data sync
- [ ] iOS version
- [ ] More AI tool integrations

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

### Development Setup

```bash
# UI, FRP installer and reply-script tests (Node.js 20+ and a JDK)
cd android/tests
npm ci
npx playwright install chromium
npm test
```

The app's interface, prompts and voice recognition are Chinese-only for now.

---

## 📄 License

This project is licensed under the [Apache License 2.0](LICENSE).

---

<div align="center">
<br>
<img src="docs/screenshots/icon.png" width="48" style="border-radius: 12px;" alt="agentBridge">
<br>
<br>

**If you find this useful, please consider giving it a ⭐!**

[![Star History Chart](https://api.star-history.com/svg?repos=otterview-labs/agentBridge&type=Date)](https://star-history.com/#otterview-labs/agentBridge&Date)

</div>

---

## 🇨🇳 中文介绍

**agentBridge** 把你的安卓手机变成 AI 编程团队的控制中心。

每台远程机器变成一个像素风办公室，每个 AI 任务变成一个可爱的小人。打开手机就能看到谁在干活、谁在等你回复、下一步该做什么。

### 核心亮点

| 功能 | 说明 |
|------|------|
| 🏢 **像素办公室** | 机器=办公室，任务=小人，动画实时反映状态 |
| 🤖 **AI 管家** | 智能助手，可 SSH 到机器查询实时任务数据 |
| 📞 **语音通话** | 全屏电话界面，流式语音识别，AI 语音回复 |
| 🔔 **结果通知** | 回复、找任务、刷新、生成规划完成或失败时推送通知；锁屏后仍会跑完 |
| 🌐 **远程访问** | FRP 加密隧道，随时随地管理局域网机器 |
| 🔒 **隐私安全** | 没有自建后端；密码、私钥、API Key 用系统密钥库加密，不进备份。启用管家或语音后，相关内容会发送给你配置的模型服务商 |

### 快速开始

```bash
git clone https://github.com/otterview-labs/agentBridge.git
cd agentBridge/android
./gradlew assembleDebug
```

1. 安装 APK 到手机
2. 添加机器（SSH 地址 + 密码）
3. 自动发现所有 AI 任务

### 技术栈

Java · JSch · WebSocket · WebView · Android Service · OpenAI API

---

<div align="center">

**用 ❤️ 和像素制作的**

</div>
