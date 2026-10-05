# 第一次使用办公小镇

[English](getting-started.en.md) · [看操作实录](https://otterview-labs.github.io/agentBridge/#demo)

先连上一台电脑，找到一个任务，再从手机发出一条回复。管家聊天和语音可以稍后配置。

需要 Android 7.0+，以及一台已有 Codex 或 Claude Code 会话的 Mac / Linux 电脑。第一次连接建议让手机和电脑使用同一个局域网，电脑保持开机。

## 1. 安装 App

[下载中文 APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge-zh.apk)。下载后打开安装包，按安卓提示允许当前浏览器安装应用。

下载没开始，可以到 [最新版本](https://github.com/otterview-labs/agentBridge/releases/latest) 的 Assets 中选择 `agentbridge-zh.apk`。英文版是 `agentbridge-en.apk`。

## 2. 准备电脑的 SSH 连接

SSH 是手机连接电脑的方式。电脑不用安装办公小镇。

Mac：打开「系统设置 → 通用 → 共享 → 远程登录」，开启远程登录，允许运行 Codex / Claude Code 的那个账号登录。这个页面会显示连接命令和用户名。[Apple 的远程登录说明](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac)

Linux：电脑需要运行 SSH 服务。Ubuntu 上可按 [官方 OpenSSH 指南](https://ubuntu.com/server/docs/how-to/security/openssh-server/) 安装 `openssh-server`；其他发行版按各自的 SSH 配置方式处理。

记下这几项：电脑的局域网 IP、SSH 端口、用户名，以及对应的密码或私钥。用户名应是运行 AI 会话的电脑账号，通常不需要填 `root`。在该账号的电脑终端运行 `whoami` 可以查看用户名。

手机里的 `localhost` / `127.0.0.1` 指手机自身；连接电脑时，要填写电脑的地址。

## 3. 在手机上找到任务

1. 在电脑上打开一个专门用于试用的 Codex 或 Claude Code 会话。可以先让它只回复一句话，不修改文件、不运行命令。
2. 打开 App，点「添加 SSH」，填写办公室名称、电脑地址、账号和密码／私钥。默认端口是 22，电脑使用其他端口时填写实际值。
3. 点「保存办公室」，再点这间办公室的「找任务」。也可以先用「发现机器」扫描局域网；扫描只找开放的 22 端口，未扫描到时仍可手动添加。
4. 找到刚才的试用任务，打开员工卡片，看最近的对话或「查看原始记录」。

没有找到任务时，确认 SSH 登录账号与启动 AI 会话的账号一致。连接成功只表示 SSH 可用，还需要电脑上有可读取的会话记录。

## 4. 发出第一条回复

在试用任务的「给员工的消息」中写一句简单要求，例如“请只回复：手机连接测试。不要修改文件或运行命令”，然后点「发送」。

留意 App 的发送结果，再点「刷新输出」查看新记录。状态需要手动刷新；“已发送”不等于任务已经完成。正在工作的 Codex Desktop 线程可能把消息放入队列，等原线程继续处理。

确认原会话收到了消息、输出中出现了新回答，才算这一步走通。

## 5. 再配置管家和语音

打开「管家 → 配置模型」，按模型服务商要求填写 OpenAI 兼容接口地址、模型名和 API Key。保存后点「验证连接」，然后发一句文字，确认管家能回答。

任务刷新成功后，可以问“哪个任务在等我回复？”；在员工卡片里点「帮我写回复」，选择一条草稿后修改、发送。选择草稿不会自动发给员工。

文字聊天正常后，打开「语音设置」，先点「试听管家声音」，再用聊天框旁的麦克风测试识别。两项都正常后再用「拨给管家」。本机语音不可用时，可以配置百炼北京地域的云端语音密钥。详细说明见 [语音配置](android-app.md#butler-voice-setup)。

## 卡住时先看这里

| 现象 | 下一步 |
| --- | --- |
| 扫描不到电脑 | 手动填电脑地址和实际 SSH 端口；检查双方网络是否能互相访问。 |
| 连接被拒绝或超时 | 检查电脑是否开机、SSH 服务是否开启、地址和端口是否正确。办公室「更多 → 测试」可以单独检查连接。 |
| 认证失败 | 检查用户名、密码或私钥，以及该账号是否允许 SSH 登录。 |
| 找不到任务 | 用启动 Codex / Claude Code 的同一账号连接，并先在电脑上建立会话，再点「找任务」。 |
| 记录没变化 | 点击「刷新输出」；离线时看到的是历史记录。 |
| 管家不回复 | 在模型设置中「验证连接」，记录显示的错误；SSH 连接成功不会自动配置聊天模型。 |
| 通话没声音或不能识别 | 分别测试播报和麦克风，检查语音设置、权限及语音服务。文字聊天成功并不代表语音也已配置。 |

仍然卡住，可以 [反馈问题](https://github.com/otterview-labs/agentBridge/issues/new?template=bug_report.yml)。填安卓版本、电脑系统、App 版本和卡住的步骤，贴去掉私人信息后的错误提示即可。密码、私钥和 API Key 不要放进 Issue。

离开局域网使用，需要可访问的 SSH 连接；FRP 配置见 [完整使用文档](android-app.md#optional-public-access)。
