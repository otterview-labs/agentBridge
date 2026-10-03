<div align="center">

<img src="docs/screenshots/icon.png" width="72" alt="agentBridge 双拱桥标记">

# agentBridge · 办公小镇

### 电脑上的 AI 任务，手机上接着聊。

在安卓手机上查看、回复 Codex 和 Claude Code 会话。<br>
几台电脑上的任务和记录放在一起：每台电脑一间办公室，每个任务一位像素员工。

[![Release](https://img.shields.io/github/v/release/otterview-labs/agentBridge?label=APK&color=3f6845)](https://github.com/otterview-labs/agentBridge/releases/latest)
[![CI](https://github.com/otterview-labs/agentBridge/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/otterview-labs/agentBridge/actions/workflows/ci.yml)
[![Android](https://img.shields.io/badge/Android-7.0%2B-3f6845)](https://otterview-labs.github.io/agentBridge/)
[![License](https://img.shields.io/github/license/otterview-labs/agentBridge)](LICENSE)

[中文](README.md) · **[English README](README.en.md)**

[中文下载页](https://otterview-labs.github.io/agentBridge/) · [English download page](https://otterview-labs.github.io/agentBridge/en/) · [中文 APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge-zh.apk) · [English APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge-en.apk)

| 像素办公室 | 管家聊天 | 语音通话 |
|:---:|:---:|:---:|
| <img src="docs/screenshots/office-0.5.44.png" width="240" alt="像素办公室：多台电脑、任务员工与待输入状态"> | <img src="docs/screenshots/butler-0.5.44.png" width="240" alt="管家聊天：任务问答与消息输入"> | <img src="docs/screenshots/call-0.5.44.png" width="240" alt="语音通话：聆听、麦克风、扬声器与挂断按钮"> |

<sub>截图使用样例记录。</sub>

</div>

## 为什么做办公小镇

用的 AI 工具多了，任务和记录也散得到处都是。做过什么、哪件事还没结束，有时候自己都记不清。这是做办公小镇的第一个原因。

现在可以把几台电脑上的 Codex 和 Claude Code 会话放在一起，在手机上查看进展、翻记录，接着原来的任务聊。电脑上的任务照常执行。

第二个原因是，有些事 AI 本来就能自己解决，我不想每个任务都要操心。接下来想让它在设定的范围内，自己安排和处理日常任务，需要人决定的时候再来问。

自主任务管理还在计划中。当前管家可以查记录、讨论进展、帮你写回复草稿；给员工的指令仍由你在任务卡片里发出。

## 离开电脑，继续手上的任务

电脑还在跑任务，你可以在手机上读它刚才的输出、补充要求，或者回答它的问题。消息发回原会话，不用重新交代一遍背景。

- 读取 Codex、Claude Code 的输出和对话记录，回复现有会话。
- 在像素办公室里查看正在工作、空闲和等你输入的任务。需要回复的任务排在前面。
- 一起查看几台 Mac、Linux 电脑的任务，每台电脑各有自己的办公室。
- 手机通过 SSH 连接电脑，电脑端无需安装 agentBridge 或部署配套服务。

任务状态在点击刷新后更新；离线电脑显示的是历史记录。

## 找管家聊任务

不想逐个翻任务时，可以直接问管家：

> 哪些任务需要我回复？<br>
> 这个任务最近做了什么？

管家可以刷新任务、检查电脑连接、读取输出，再根据查到的内容回答。模型由你选择，支持 OpenAI 兼容接口。

不知道怎么回员工时，点卡片里的「帮我写回复」。模型会根据该任务的记录写几条草稿，你选一条，改好后发送。草稿参考最近一次刷新的记录，选中不会自动发出去。

也可以用语音聊：按住说话，或打开「拨给管家」，通过 App 内的语音通话询问进展。使用前需要配置模型，并测试语音识别和播报。

## 快速开始

**需要：** Android 7.0+ 手机，以及一台能通过 SSH 连接、已有 Codex 或 Claude Code 会话的 Mac / Linux 电脑。

1. **[下载并安装 APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge.apk)。** 安装包约 1.5 MB，旧正式版可覆盖更新。
2. **添加电脑。** 在 App 中点「发现机器」扫描局域网，或填写 SSH 地址、账号和密码／私钥。
3. **点「找任务」。** 打开员工卡片查看输出，发送消息后刷新进展。

电脑需要保持开机。局域网内可以直接连接；在外使用需要可访问的 SSH 地址，也可以配置自己的 FRP 入口。连接配置见 [使用文档](docs/android-app.md#add-a-machine)。

<details>
<summary><strong>配置管家聊天和语音</strong></summary>

在「管家 → 配置模型」填写服务商地址、模型名和 API Key，保存后点「验证连接」，再发一条文字消息。

文字聊天成功后，单独测试麦克风识别和声音播报，再打开「拨给管家」。系统语音服务不可用时，可配置百炼北京地域的云端语音服务。具体配置见 [使用文档](docs/android-app.md)。

</details>

## 支持范围

| 工具 | 当前支持 |
| --- | --- |
| Codex CLI / Codex Desktop 会话 | 发现会话、读取输出、发送消息、查看对话记录 |
| Claude Code | 发现会话、读取输出、发送消息、查看对话记录 |
| Gemini CLI | 基础进程发现 |

目前提供中文「办公小镇」和英文「Office Town」两款安卓版，可以同时安装。中文版沿用原应用 ID，可覆盖旧正式版；两款 App 的配置和记录各自保存。发送消息、查找任务等操作在开始后可继续在锁屏下执行，完成或失败时通知你。

## 数据与隐私

任务在你连接的电脑上执行。App 的配置、对话和记录保存在手机应用私有存储；SSH 密码、私钥、模型密钥等凭据使用 Android Keystore 加密，并从备份中排除。SSH 连接会核对已保存的主机密钥。

使用管家时，必要的任务信息和对话会发送到你选择的模型服务；启用百炼云端语音时，录音或播报文字会发送到百炼。详情见 [安全说明](SECURITY.md)。

## 开发与贡献

Java · Android WebView · JSch / SSH · WebSocket · Android Service。

需要 JDK 17、Android SDK 35、Build Tools 35.0.0；运行测试还需要 Node.js 20+。

```bash
git clone https://github.com/otterview-labs/agentBridge.git
cd agentBridge/android
./gradlew assembleDebug lintZhDebug lintEnDebug
```

调试安装包：`android/app/build/outputs/apk/zh/debug/app-zh-debug.apk` 和 `android/app/build/outputs/apk/en/debug/app-en-debug.apk`。调试版与正式版使用不同的应用 ID，可同时安装。

在 `android` 目录下运行测试：

```bash
cd tests
npm ci
npx playwright install chromium
npm test
```

反馈问题或提出功能建议：[提交 Issue](https://github.com/otterview-labs/agentBridge/issues)。参与开发请阅读 [贡献指南](CONTRIBUTING.md)。

[Apache-2.0](LICENSE) 许可证。

---

Read the [English README](README.en.md) for features, setup, and development instructions.
