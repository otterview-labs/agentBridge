# Pi 管家与 Markdown 记忆（0.5.53 可选扩展）

这一版有两种运行方式：

- **手机直接聊天**：沿用 OpenAI 兼容接口。对话另外存入 App 私有目录的 `butler-memory/<范围>/HISTORY.md`，下次提问读取最近的历史资料。没有语义搜索，也不把模型建议自动提炼成用户决定。
- **电脑端 Pi + 记忆**：手机通过已有 SSH 连接启动可选 worker，使用真实的 `@earendil-works/pi-coding-agent` 和 [`pi-memory`](https://github.com/jayzeng/pi-memory)，提供长期记忆、每日记录和 scratchpad。原始 Pi 会话另外保留为 JSONL。

两种方式都可以选择整个小镇或一个员工。单员工范围根据 SSH 目标、账号、智能体类型和原始会话 ID 生成，改名不影响记忆。换 SSH 地址或账号会生成另一范围；缺少原始会话 ID 的员工暂时不能单独建记忆库。整个小镇的记忆不自动汇总或导入员工记忆。

## 配置电脑端 Pi

需要 Node.js 22.19+。电脑端组件是可选的，普通手机聊天不需要安装。在电脑项目目录执行：

```bash
cd tools/pi-butler
npm ci --ignore-scripts
npm run check
```

`check` 只检查 SDK 导入。完整链路要在 App 中验证：在「管家 → 模型」选择「电脑端 Pi + 记忆」，选择已连接的电脑，填写该电脑上 `tools/pi-butler/worker.mjs` 的**绝对路径**，同时填写模型地址、名称和 API Key。保存后点「验证连接」，会通过电脑端 Pi 发出一条独立测试请求，不读取真实任务记忆。

SSH 非交互环境需要能找到 Node。启动命令包含 `$HOME/bin`、`$HOME/.local/bin`、`$HOME/.npm-global/bin`、Homebrew 和常见系统路径；仅在 nvm 交互 shell 可用的 Node 要先加入这些路径之一。

Pi 模式下 `localhost` 模型地址指运行 Pi 的电脑。Pi 模式的简单问候使用独立空范围，不读取任务记忆。普通手机聊天、日报和「帮我写回复」仍从手机直接调用模型，需要手机能访问同一配置地址。

聊天输入框上方选择记忆范围。先选择训练平台员工，说“训练中显示进度，失败显示原因，先不加通知，请记住这些已确认的要求”。重启后在相同范围询问之前的要求。选择小红书员工时会使用另外一个目录，聊天记录也分别显示。

## 存储与边界

电脑端默认目录：

```text
tools/pi-butler/.data/<手机安装命名空间>/<town 或 task-会话标识>/
  memory/MEMORY.md
  memory/SCRATCHPAD.md
  memory/daily/<日期>.md
  sessions/<原始会话>.jsonl
  receipts/<请求编号>.json
```

用 `ASB_PI_DATA_DIR` 可改变根目录。不同安装、中文和英文 App 使用不同命名空间。数据已加入 Git 忽略规则。

每次 Pi 请求从新会话启动，扩展加载当前范围的 Markdown。用户明确要求记住的决定由工具保存；完成的原始发言和管家报告还会存入每日记录，带请求编号和时间。管家说“测试通过”仍是报告，不能直接当作已验证事实或新的授权。可以在电脑编辑 Markdown，下次请求读取修改后的内容。

原始会话、每日记录、手机历史和长期记忆分别保留。删掉 `MEMORY.md` 不会同时删除其他记录；彻底清除一个范围需要删除对应目录以及手机数据。当前没有 App 内的完整记忆编辑和清除界面。

凭据通过 SSH 标准输入传递，不放进 shell 参数，不写入 worker 凭据文件。所选上下文仍会发送到用户配置的模型服务。电脑关闭或 worker 不可用会明确失败，不会自动换执行位置或重发给员工。

Pi 仅加载指定记忆扩展和 `list_tasks`、`check_machines`、`get_task_output` 三个查询工具。未启用 bash、任意文件编辑或员工发送工具。Pi 聊天本身未开放员工发送工具。0.5.53 的[手机持续跟进](managed-mode.md)通过独立队列和执行适配器处理自动回复，不经过 Pi 聊天工具；手机离线后无法继续手机端调度。

## 可选 QMD

Markdown 读写和加载不需要 QMD；关键词、语义和混合检索需要另外安装 [QMD](https://github.com/tobi/qmd)：

```bash
npm install -g @tobilu/qmd
```

worker 同时隔离各范围的 QMD 配置和缓存，避免共用全局 collection。首次语义索引需要下载模型。当前验证覆盖无 QMD 的记忆读写和重启召回；**QMD 语义索引尚未验收**。

## 验证

真实 Pi SDK 和扩展配合模拟模型的测试：

```bash
cd tools/pi-butler
npm test
```

可选本地真实模型检查只使用虚构的训练平台要求：

```bash
ASB_PI_TEST_URL=http://127.0.0.1:11434/v1 \
ASB_PI_TEST_MODEL=qwen3.6:27b node live-smoke.mjs
```

手机 Markdown、SSH 协议、范围切换与布局测试在 `android/tests`。0.5.53 下载包包含手机端接入；Pi worker 与依赖需要另行安装到电脑。

## English setup

Release 0.5.53 supports optional Pi + pi-memory on an SSH-connected computer. Install dependencies under `tools/pi-butler` using `npm ci --ignore-scripts`, then choose the Pi runtime in model settings and enter the absolute worker path. Use the app connection check to verify SSH, Pi, the extension and the model together.

Choose the town or a specific agent above the composer. Stable original session IDs isolate agent memories. Normal phone chat also keeps local Markdown history. Raw records, user decisions and assistant claims remain distinct. QMD is optional and its semantic indexing has not been validated here. Pi chat has no sending tools. The separate 0.5.53 phone supervision queue can dispatch bounded follow-up replies; see managed-mode.md.
