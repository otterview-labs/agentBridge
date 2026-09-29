<div align="center">

<img src="docs/screenshots/icon.png" width="120" alt="agentBridge mascot" style="border-radius: 24px;">

# agentBridge

### Your AI coding team, in your pocket.

**A pixel-art office town where every machine is an office and every AI task is a cute employee — right on your Android phone.**

[![Android](https://img.shields.io/badge/platform-Android-3DDC84?logo=android&logoColor=white)](https://github.com/otterview-labs/agentBridge)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-34%2F34-brightgreen)](.)
[![API](https://img.shields.io/badge/AI-Claude%20%7C%20Codex%20%7C%20Gemini-8B5CF6)](.)

[English](#-overview) · [中文](#-项目介绍)

</div>

---

## 📸 Screenshots

<div align="center">
<table>
<tr>
<td align="center"><b>🏢 Office Town</b><br>Every machine = an office<br>Every task = an employee</td>
<td align="center"><b>🤖 AI Butler</b><br>Smart assistant with<br>real-time tool calling</td>
<td align="center"><b>📞 Call Mode</b><br>Voice conversation<br>with streaming ASR</td>
</tr>
<tr>
<td><img src="docs/screenshots/android-local.png" width="200" alt="Office view"></td>
<td><img src="docs/screenshots/android-report.png" width="200" alt="AI butler"></td>
<td><img src="docs/screenshots/studio-mobile.png" width="200" alt="Voice call"></td>
</tr>
</table>
</div>

---

## 🇺🇸 Overview

**agentBridge** turns your Android phone into a mission control for remote AI coding agents. Instead of staring at terminal logs, you see a living pixel-art town:

- 🏢 **Each machine** (Mac, Linux server) appears as a cute office building
- 👨‍💻 **Each AI task** (Claude Code, Codex CLI) is an animated employee working inside
- ✋ **Hands up** = the AI is waiting for your reply — tap to respond instantly
- 🎨 **Color-coded status cards** tell you at a glance: running (green), idle (yellow), needs-input (red)

### ✨ Key Features

| Feature | What it does |
|---------|-------------|
| 🤖 **AI Butler** | Chat with a smart assistant (qwen-max / GLM / Claude) that can SSH into machines and pull real-time task data |
| 📞 **Voice Call Mode** | Full-screen phone call UI — speak naturally, AI responds with voice, continuous conversation |
| 🎙️ **Streaming ASR** | Real-time speech-to-text via WebSocket — see words appear as you speak |
| 🔔 **Push Notifications** | Background monitoring alerts you when AI needs input or task completes |
| 🌐 **FRP Remote Access** | One-tap encrypted tunnel setup — access LAN machines from anywhere |
| 📱 **Zero Backend** | Phone connects directly to machines via SSH — no server needed |
| 🔒 **Privacy First** | All credentials and conversations stay on your phone |

### 🏗️ Architecture

```
┌──────────────────┐                    SSH / FRP
│   Android App    │◄──────────────────────────────► ┌─────────────┐
│                  │                                  │  Mac / Linux │
│  🏢 Office Town  │                                  │              │
│  🤖 AI Butler    │                                  │  Claude Code │
│  📞 Voice Call   │                                  │  Codex CLI   │
│  🔔 Notifications│                                  │  Gemini CLI  │
│                  │    OpenAI-compatible API         │  tmux panes  │
│  ButlerManager   │◄───────────────────────────► ┌──┴───────────┐
│  StreamingASR    │                               │ DashScope /   │
│  PhoneBridge     │                               │ Z.ai / Any   │
│  BridgeStore     │                               │ OpenAI API   │
└──────────────────┘                               └──────────────┘
```

### 🚀 Quick Start

```bash
git clone https://github.com/otterview-labs/agentBridge.git
cd agentBridge/android
./gradlew assembleDebug
# APK: app/build/outputs/apk/debug/app-debug.apk
```

Or download from [Releases](https://github.com/otterview-labs/agentBridge/releases).

### 📁 Project Structure

```
android/app/src/main/java/com/otterview/agentsessionbridge/
├── MainActivity.java           # Activity lifecycle + audio management
├── PhoneBridge.java            # SSH connections + FRP + task operations
├── ButlerManager.java          # AI butler + model API + tool calling
├── StreamingASR.java           # Real-time speech recognition (WebSocket)
├── TaskForegroundService.java  # Background push notifications
└── BridgeStore.java            # Local persistence (SharedPreferences)

android/app/src/main/assets/
├── phone.html                  # UI structure
├── phone.css                   # Pixel-art styling
└── phone.js                    # Frontend logic (2,400+ lines)

android/tests/
└── phone-ui.test.cjs           # 34 Playwright UI tests
```

---

## 🇨🇳 项目介绍

**agentBridge** 是一个安卓应用，把远程机器上的 AI 编程任务变成一个活生生的像素小镇。

不用盯着终端日志 —— 打开手机就能看到：
- 🏢 每台机器是一间可爱的办公室
- 👨‍💻 每个任务是一位像素小人，正在敲键盘
- ✋ 小人举手 = AI 在等你的回复，点一下就能回应
- 🟢🟡🔴 颜色状态卡片一眼看清：执行中 / 空闲 / 待输入

### 核心功能

| 功能 | 说明 |
|------|------|
| 🤖 **AI 管家** | 智能助手（qwen-max / GLM / Claude），能 SSH 到机器实时查询任务状态 |
| 📞 **通话模式** | 全屏电话界面 — 说话、停顿、AI 语音回复、持续对话 |
| 🎙️ **流式识别** | 边说边出字（WebSocket 实时语音转文字） |
| 🔔 **推送通知** | 后台监控，AI 等待输入或任务完成时立即提醒 |
| 🌐 **FRP 公网访问** | 一键加密隧道，随时随地管理局域网机器 |
| 📱 **零后端** | 手机直连 SSH，不需要中间服务器 |
| 🔒 **隐私优先** | 所有凭据和对话保存在手机本地 |

### 技术架构

- **纯 Android 原生**：Java + WebView，无 React Native / Flutter 依赖
- **SSH 直连**：JSch 库，支持密码和私钥认证
- **FRP 加密隧道**：STCP 协议，自动部署 frps/frpc
- **AI 工具调用**：OpenAI Function Calling，管家可实时查机器
- **流式语音**：WebSocket 对接百炼 paraformer-realtime
- **34 个 UI 自动化测试**：Playwright 全覆盖

### 支持的 AI 工具

| 工具 | 状态 |
|------|------|
| Claude Code | ✅ 完整支持 |
| Codex CLI | ✅ 完整支持 |
| Gemini CLI | ✅ 支持 |

### 快速开始

```bash
git clone https://github.com/otterview-labs/agentBridge.git
cd agentBridge/android
./gradlew assembleDebug
```

1. 安装 APK 到手机
2. 添加机器（输入 SSH 地址和密码）
3. 自动发现 AI 任务
4. （可选）配置管家模型

---

## 🗺️ Roadmap

- [x] Office town UI with animated employees
- [x] AI butler with tool calling
- [x] Voice input (press-to-talk + call mode)
- [x] Cloud TTS (qwen3-tts) with local fallback
- [x] Push notifications for task changes
- [x] FRP remote access with auto-deployment
- [x] Streaming ASR (WebSocket)
- [ ] Multi-device data sync
- [ ] iOS version
- [ ] More AI tool integrations

## 🤝 Contributing

Issues and Pull Requests are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md).

## 📄 License

[Apache License 2.0](LICENSE)

---

<div align="center">

**Made with 🎮 pixel love**

[⭐ Star this repo](https://github.com/otterview-labs/agentBridge) if you like it!

</div>
