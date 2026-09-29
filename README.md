# agentBridge

<p align="center">
  <img src="docs/screenshots/icon.png" width="96" alt="agentBridge 吉祥物图标">
</p>

**agentBridge** 是一个 Android 手机应用，把远程机器上的 AI 编程任务（Claude Code、Codex CLI）变成可视化的小镇办公室，让你在手机上就能看到每台机器在做什么、谁在等你回复、下一步该做什么。

手机直连机器 SSH，不依赖任何中间服务器。管家的模型配置、对话记录和任务规划全部保存在手机本机。

## 它能做什么

### 🏢 办公室视图

- 每台机器是一间像素风办公室
- 每个任务是一位可爱的小人（员工）
- 员工会动 = 任务在执行；举手 = 等你输入；灰色 = 机器离线
- 点击员工看对话时间线、最近输出和工作目录

### 🤖 AI 管家

- 支持 OpenAI 格式 API（qwen-max、GLM-5.3、Claude 等）
- 能调用工具实时查询任务状态和机器在线情况
- 自动整理「待输入 > 执行中 > 空闲」的优先级建议
- 支持语音对话和电话模式

### 📱 语音与通话

- **按住说话**：松手自动转文字发送
- **通话模式**：全屏界面，说完自动断句，管家语音回复，持续聆听
- **流式识别**：说话时文字实时出现（需百炼 API）
- **TTS 播报**：本机引擎或云端语音（qwen3-tts）

### 🔔 推送通知

- 后台监控任务状态变化
- AI 等待输入时立即通知
- 任务完成时提醒验收

### 🌐 公网访问（FRP）

- 添加一台公网机器作为 FRP 入口
- 局域网机器通过加密隧道自动接入
- 手机在任何网络都能操作所有机器
- 支持自动部署和一键接管已有 FRP 服务

## 快速开始

### 前提条件

- 一台 Android 手机（Android 7.0+）
- 局域网内有 Mac 或 Linux 机器运行 Claude Code / Codex CLI
- （可选）一个 OpenAI 格式的模型 API Key

### 安装

```bash
# 克隆项目
git clone https://github.com/otterview-labs/agentBridge.git
cd agentBridge/android

# 构建 Debug APK
./gradlew assembleDebug

# APK 位置
app/build/outputs/apk/debug/app-debug.apk
```

或直接从 [Releases](https://github.com/otterview-labs/agentBridge/releases) 下载。

### 配置

1. **添加机器**：输入 SSH 地址、用户名和密码（或私钥）
2. **自动发现**：App 会扫描局域网并读取已安装的 AI 工具
3. **配置管家**（可选）：管家页 → 连接模型 → 填入 API 地址和 Key

## 架构

```
┌──────────────┐         SSH (直连/FRP隧道)
│  Android App │◄──────────────────────────► Mac / Linux
│              │                              ├── Claude Code
│  • SSH 客户端 │                              ├── Codex CLI
│  • AI 管家    │                              └── tmux 会话
│  • 语音识别   │
│  • TTS 播报   │    OpenAI 格式 API
│  • FRP 管理   │◄──────────────────────────► 百炼 / Z.ai / 其他
└──────────────┘
```

- **零后端依赖**：手机直连机器，不需要中间服务器
- **数据本地化**：所有配置和对话保存在手机私有存储
- **安全**：SSH 凭据不上传，FRP 使用加密隧道

## 项目结构

```
android/
├── app/src/main/java/com/otterview/agentsessionbridge/
│   ├── MainActivity.java         # Activity + 音频管理
│   ├── PhoneBridge.java          # SSH 连接 + FRP + 任务管理
│   ├── ButlerManager.java        # AI 管家对话 + 工具调用
│   ├── StreamingASR.java         # 流式语音识别（WebSocket）
│   ├── TaskForegroundService.java# 后台推送通知
│   └── BridgeStore.java          # 本地持久化
├── app/src/main/assets/
│   ├── phone.html                # 界面结构
│   ├── phone.css                 # 样式
│   └── phone.js                  # 前端逻辑
└── tests/
    └── phone-ui.test.cjs         # UI 自动化测试
```

## 支持的 AI 工具

| 工具 | 发现方式 | 状态 |
|---|---|---|
| Claude Code | 进程扫描 + tmux 窗格 | ✅ 完整支持 |
| Codex CLI | 进程扫描 + 桌面会话 | ✅ 完整支持 |
| Gemini CLI | 进程扫描 | ✅ 支持 |

## 开发

```bash
# 运行测试（34 个 UI 测试）
cd android
npm ci
npx playwright install chromium
node --test tests/phone-ui.test.cjs

# 构建
./gradlew assembleDebug
```

## 路线图

- [ ] 流式语音端到端优化
- [ ] 多设备数据同步
- [ ] iOS 版本
- [ ] 更多 AI 工具支持

## 许可证

[Apache License 2.0](LICENSE)

## 贡献

欢迎提交 [Issue](https://github.com/otterview-labs/agentBridge/issues) 和 [Pull Request](https://github.com/otterview-labs/agentBridge/pulls)！
