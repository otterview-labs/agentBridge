<div align="center">

<img src="docs/screenshots/icon.png" width="72" alt="办公小镇像素员工">

# agentBridge · 办公小镇

**在手机上看 Codex、Claude 的任务，也能回消息。**

任务还是在你的电脑上跑。手机通过 SSH 连过去，查看输出，把消息发回原来的会话。<br>
界面是个像素小镇：电脑是办公室，任务是里面的小人。

[下载安卓版](https://otterview-labs.github.io/agentBridge/) · [直接下载 APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge.apk) · [使用文档](docs/android-app.md)

Android 7.0+ · 安装包约 1.5 MB · 开源

</div>

## 手机上是什么样

<div align="center">

| 办公室 | 管家聊天 | 语音通话 |
|:---:|:---:|:---:|
| 看任务进展，打开员工回消息 | 查任务、读输出、讨论下一步 | 用声音和管家聊 |
| <img src="docs/screenshots/office-0.5.42.png" width="240" alt="办公室：像素员工、任务卡片与待输入状态"> | <img src="docs/screenshots/butler-0.5.42.png" width="240" alt="管家聊天：模型连接状态、对话记录与输入框"> | <img src="docs/screenshots/call-0.5.42.png" width="240" alt="管家通话：聆听状态、麦克风、扬声器和挂断按钮"> |

</div>

截图使用样例记录。任务状态在刷新后更新；连接和通话效果需在自己的手机上测试。

## 能做什么

- **看任务、回消息。** 打开 Codex 或 Claude 的任务，读输出，在手机上回复。消息会发回原来的会话。多台电脑的任务可以一起看。
- **问管家。** 配上自己的模型，就能问它任务做到哪了、哪些等你回复。不知道怎么回，可以点「帮我写回复」，选一条改好再发送。管家能查记录，不会替你给员工发指令。
- **用语音聊。** 可以对着麦克风说话，也可以拨给管家。先测试识别和播报，再拨给管家。
- **连自己的电脑。** 支持 Mac 和 Linux，电脑上不用装 agentBridge，有 SSH 和现成的会话就行。局域网可以直接连接；在外面用，需要能访问电脑的 SSH 地址，或配置自己的 FRP 入口。

状态要点刷新才会更新。发消息、找任务这些操作开始后，锁屏也会继续，结束时会通知你。

## 怎么开始

1. **[下载 APK](https://otterview-labs.github.io/agentBridge/)，安装到安卓手机。** 需要 Android 7.0 或更高版本。旧正式版可以覆盖更新。
2. **连上电脑。** 电脑保持开机、能通过 SSH 连接，并已有 Codex 或 Claude 会话。在 App 中用「发现机器」扫描局域网，或手动填写 SSH 地址、账号和密码／私钥。
3. **点「找任务」，打开员工卡片。** 先看看输出，再发一条消息。之后点击刷新，查看最新状态。

管家支持 OpenAI 兼容的模型接口。在「管家 → 配置模型」填写服务商地址、模型名和 API Key，保存后验证连接，再试一条文字消息。语音需要另外测试麦克风和播报；系统语音不可用时，可配置百炼北京地域的云端语音服务。

公网访问需要可用的公网服务器或已有 FRP 入口。安装、语音和远程连接的具体配置见 [Android 使用文档](docs/android-app.md)。

## 支持哪些工具

| 工具 | 当前支持 |
| --- | --- |
| Codex CLI | 发现会话、读取输出、发送消息、查看对话记录 |
| Claude Code | 发现会话、读取输出、发送消息、查看对话记录 |
| Gemini CLI | 基础进程发现 |

目前只有安卓版，界面和语音以中文为主。

## 数据与隐私

配置、对话和记录保存在手机应用私有存储。SSH 密码、私钥、模型密钥等凭据使用 Android Keystore 加密，并从备份中排除；连接会核对已保存的 SSH 主机密钥。

启用管家后，必要的任务信息和对话会发送到你配置的模型服务。使用百炼云端语音时，录音或播报文字会发送到百炼。详情见 [安全说明](SECURITY.md)。

## 从源码运行

技术栈：Java · Android WebView · JSch / SSH · WebSocket · Android Service。

需要 JDK 17、Android SDK 35 和 Build Tools 35.0.0。

```bash
git clone https://github.com/otterview-labs/agentBridge.git
cd agentBridge/android
./gradlew assembleDebug lintDebug
```

调试安装包位于 `android/app/build/outputs/apk/debug/app-debug.apk`，与正式版使用不同的应用 ID，可同时安装。

运行测试需要 Node.js 20+ 和 JDK：

```bash
cd android/tests
npm ci
npx playwright install chromium
npm test
```

遇到问题可以提 Issue，想改代码请先看 [CONTRIBUTING.md](CONTRIBUTING.md)。项目使用 [Apache-2.0](LICENSE) 许可证。

---

**Manage Codex and Claude Code sessions from your Android phone.** Connect to your own Mac or Linux machine over SSH, read task output, and send messages to existing sessions. Each machine becomes a pixel-art office, and each task an employee. An optional AI butler uses your model provider to discuss tasks and draft replies; you review and send them. The app currently focuses on Chinese UI and speech.
