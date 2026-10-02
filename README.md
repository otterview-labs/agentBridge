<div align="center">

<img src="docs/screenshots/icon.png" width="72" alt="办公小镇像素员工">

# agentBridge · 办公小镇

**电脑上的任务，手机上继续。**

离开电脑后，看看 Codex、Claude 做到哪了，给它们回一句消息。<br>
每台机器是一间办公室，每个任务是一位像素员工。

[下载安卓版](https://otterview-labs.github.io/agentBridge/) · [直接下载 APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge.apk) · [使用文档](docs/android-app.md)

Android 7.0+ · 安装包约 1.5 MB · 开源

</div>

## 出门了，任务还在电脑上

电脑上的 Codex 正在写代码，Claude 等你确认一个改动。你不用一直坐在屏幕前：打开 agentBridge，刷新进展、读一段输出，想好后发回原来的会话。

连上自己的模型，还能问问管家「哪件事等我回复？」或「这个任务做到哪了？」。不知道怎么回，就让它根据已有记录写几句，改好再发送。语音配置好后，也可以直接开口聊。

## 手机上是什么样

<div align="center">

| 办公室 | 管家聊天 | 语音通话 |
|:---:|:---:|:---:|
| 看任务进展，打开员工回消息 | 查任务、读输出、讨论下一步 | 用声音和管家聊 |
| <img src="docs/screenshots/office-0.5.42.png" width="240" alt="办公室：像素员工、任务卡片与待输入状态"> | <img src="docs/screenshots/butler-0.5.42.png" width="240" alt="管家聊天：模型连接状态、对话记录与输入框"> | <img src="docs/screenshots/call-0.5.42.png" width="240" alt="管家通话：聆听状态、麦克风、扬声器和挂断按钮"> |

</div>

截图使用样例记录。任务状态在刷新后更新；连接和通话效果需在自己的手机上测试。

## 为什么用它

- **接着原来的任务聊。** 在手机上读 Codex、Claude 的会话输出，发送消息继续原来的会话。多台机器、多个任务放在一个工作台里。
- **把任务摆进小办公室。** 每台机器是一间办公室，任务是像素员工。刷一下，看看哪些在运行、哪些等你回复，再打开卡片读详情。
- **管家帮你看记录，你来决定怎么回。** 连上自己的模型，查询机器、读任务输出、讨论下一步。「帮我写回复」按需生成草稿，选中后可以改，再点发送。管家的查询工具只读，不替你下执行指令。
- **电脑不用再装一套配套服务。** 手机通过 SSH 连接已有的 Mac 或 Linux。局域网里就能用；需要公网访问时，可以配置自己的 FRP 入口。
- **模型和连接方式自己选。** 支持 OpenAI 兼容的模型接口。SSH 凭据和 API Key 用 Android Keystore 加密保存，项目没有自建中转后端。

发消息、找任务、刷新等已启动的操作会在前台服务中继续运行，成功或失败时通知你。应用按需刷新机器，不在后台持续监控任务。

## 几分钟开始试用

1. **[下载 APK](https://otterview-labs.github.io/agentBridge/)，安装到安卓手机。** 需要 Android 7.0 或更高版本。旧正式版可以覆盖更新。
2. **连上电脑。** 电脑保持开机、能通过 SSH 连接，并已有 Codex 或 Claude 会话。在 App 中用「发现机器」扫描局域网，或手动填写 SSH 地址、账号和密码／私钥。
3. **点「找任务」，打开一位员工。** 先看看输出，再发一条消息。之后点击刷新，查看最新状态。

想用管家，在「管家 → 配置模型」填写服务商地址、模型名和 API Key，保存后验证连接，再试一条文字消息。语音需要另外测试麦克风和播报；系统语音不可用时，可配置百炼北京地域的云端语音服务。

公网访问需要可用的公网服务器或已有 FRP 入口。安装、语音和远程连接的具体配置见 [Android 使用文档](docs/android-app.md)。

## 支持哪些工具

| 工具 | 当前支持 |
| --- | --- |
| Codex CLI | 发现会话、读取输出、发送消息、查看对话记录 |
| Claude Code | 发现会话、读取输出、发送消息、查看对话记录 |
| Gemini CLI | 基础进程发现 |

App 界面、管家提示词和语音识别目前以中文为主。手机端为 Android，尚无 iOS 版本。

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

欢迎提交问题和改进，开发约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。项目使用 [Apache-2.0](LICENSE) 许可证。

---

**Manage Codex and Claude Code sessions from your Android phone.** Connect to your own Mac or Linux machine over SSH, read task output, and send messages to existing sessions. Each machine becomes a pixel-art office, and each task an employee. An optional AI butler uses your model provider to discuss tasks and draft replies; you review and send them. The app currently focuses on Chinese UI and speech.
