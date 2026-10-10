# 手机持续跟进（0.5.53 试用功能）

手机保存任务队列、目标、授权范围和跟进记录，调度模型与执行后端。普通管家聊天、Pi 记忆和持续跟进是不同功能；持续跟进不需要安装 Pi。

## 在手机上使用

1. 在管家页面点「跟进」，或在员工详情的「更多操作」点「交给管家跟进」。
2. 选择已有员工会话或 OpenHands，填写目标和允许管家处理的范围。
3. 「允许在上述范围内自动回复」默认关闭。开启后，管家可以在该任务范围内发送后续要求。每个任务单独设置次数与时长。
4. 加入队列后，点「启动手机管家」。添加任务本身不启动服务，也不发送消息。
5. 通知栏可暂停整个管家。任务列表可暂停、重新检查或取消单个任务。结果进入「等待验收」后，由用户点「验收完成」。

## English quick setup

In Butler, open **Follow-up**, choose an existing employee session or OpenHands, and enter a goal and permitted scope. Automatic replies are off by default. Add the task, then explicitly start the phone butler. If you allow replies, set the count and duration limits. Pause individual tasks or the whole queue; accept finished results yourself.

The phone makes supervision decisions through your configured OpenAI-compatible model, even when chat uses Pi. That model URL must be reachable from the phone. Codex and Claude process sessions require a stable original session ID; tmux sessions remain manual. OpenHands requires your own Agent Server, access key and existing conversation UUID. It does not create a sandbox automatically.

A foreground notification stays visible. Battery restrictions, network loss, force stops and phone shutdown can interrupt checks. Reopen the app to inspect the persistent queue. An uncertain send stops automatic retries so you can verify delivery; pausing does not cancel work already sent. Recent records and phone history are not the original session’s complete context. Start with observation and a small reversible task. There is no token or monetary budget yet.

管理判断由手机直接调用已配置模型的 OpenAI 兼容接口；即使聊天设置选择 Pi，持续跟进的判断仍在手机发起，模型地址必须能从手机访问。最多自动回复 20 次，每个任务最多检查 120 次，时长最多 24 小时。一次只判断和派发一个任务，正常检查间隔至少 60 秒，连接或判断失败后至少等待 120 秒，连续三次失败转为「需要你处理」。这版尚未提供模型 Token/金额预算。

现有员工先支持带固定会话 ID 的 Codex / Claude 进程会话。tmux 员工继续支持手动回复，暂不放入自动跟进。只读取所绑定会话的近期输出与对应手机历史，不能声称获得了员工全部上下文。模型根据用户目标和规则决定等待、回复、需要人处理或待验收；新目标及拿不准的事情要求人决定。目标和规则必须写清楚，判断仍可能出错，建议先用可恢复的任务验收。

## 手机后台与恢复

`ManagedButlerService` 与单次操作的 `TaskForegroundService` 分开。用户开启后，以可见通知运行；Android 14+ 使用 `specialUse` 类型，并在 Manifest 声明具体任务监督用途。此类型用于不属于其他类型的有效用途，Google Play 提交时仍需平台审核，见 [Android 官方服务类型说明](https://developer.android.com/develop/background-work/services/fgs/service-types)。当前构建用于直接安装测试。

服务使用 `START_STICKY`，进程重建时从 App 私有目录 `managed/queue.json` 恢复。重新打开 App 时也尝试恢复已开启服务。系统强制停止、手机关机和厂商省电策略仍可能阻止运行；没有承诺不受 Android 调度限制的永久常驻。没有开机广播强行启动、精确闹钟或不间断唤醒锁。每次处理只持有最多五分钟的 CPU 唤醒锁，闲置时不持有；深度休眠仍可能延迟检查。

发送前持久化动作编号、原问题指纹和次数，再发送。进程在发送中退出或网络结果不明确时，状态为「发送结果待核对」，不自动重发。重新检查只读取新状态，不重放旧草稿。派发前还会再次读取记录，问题已变化时重新判断。同一问题指纹不再次派发，后端没有统一幂等能力时采用保守处理；尚未提供自动核对远端收据的功能。

暂停或取消只停止后续调度。已经交给电脑或 OpenHands 的动作可能继续执行，不假装已撤回。原始输出和派发记录可查看，员工空闲或模型声称完成都不自动算验收。

## 可替换接口

`ManagedCoordinator` 不依赖 Activity、Android Service、SSH 或 OpenHands SDK。它依赖三个接口：

| 接口 | 职责 | 当前实现 |
| --- | --- | --- |
| `Backend` | 观察绑定会话、发送动作 | 原员工 SSH / OpenHands V1 REST |
| `Planner` | 根据目标、范围、记忆和观察提出动作 | 手机 OpenAI 兼容模型 |
| `Memory` | 按任务读取资料并记录派发 | 手机 Markdown |

Android 生命周期由 `ManagedButlerService` 负责。更换模型实现 `Planner`，更换执行引擎实现 `Backend` 并注册新键，替换检索实现 `Memory`。不同任务可以选择不同后端。队列使用版本号 `schema: 1`；未知版本拒绝加载，后续升级需显式迁移。绑定后端键和目标身份固定，改服务地址、机器账号或原会话身份后必须重新绑定。凭据在 `BridgeStore` 的加密配置里，队列中不保存模型或服务密钥。

## OpenHands 接入

使用 [OpenHands Software Agent SDK / Agent Server](https://github.com/OpenHands/software-agent-sdk) 的 V1 REST 接口，不引入第二套 Agent Canvas UI。这版绑定**已有会话**；创建工作环境、工具权限和模型由服务端配置。手机尚未一键创建沙箱或新 OpenHands 会话。

可选后端依赖固定在 `tools/openhands/requirements.txt`，当前 1.54.0，Python 3.12+。建议在独立工作目录或沙箱部署：

```bash
python3.12 -m venv .venv-openhands
.venv-openhands/bin/pip install -r tools/openhands/requirements.txt
# 在环境中设置 ASB_OPENHANDS_SERVER_KEY 和稳定的 OH_SECRET_KEY，不写进 Git。
.venv-openhands/bin/python tools/openhands/server.py --workspace /absolute/dedicated-project --port 8001
```

脚本绑定 `127.0.0.1`。远程手机连接使用受控 HTTPS 入口；本机端口转发可使用 localhost HTTP。不自动暴露服务，不修改防火墙。`OH_SECRET_KEY` 用于服务端凭据持久化，重启时应保留同一值。

在手机跟进设置中填写 Agent Server 地址与访问密钥，保存后填已有会话 UUID。认证使用官方 `X-Session-API-Key`，通过 `/api/conversations/{id}` 与 `/events/search` 观察，向 `/events` 发用户消息并设置 `run: true`。服务已保存消息后也可能因为执行容量返回 429，因此错误响应不能简单当作“没有送达”。当前统一停止自动重发，交给用户核对。OpenHands 自身的工具确认状态也会转成人工处理，不自动批准。

OpenHands 对话不是原 Codex / Claude 对话，不自动读取那些会话的全部资料。换后端不会自动搬迁正在执行的任务。

## 验证范围

自动化覆盖队列持久化、恢复、授权默认关闭、重复发送抑制、记录变化后的重新判断、暂停期间的决策失效、结果待验收和 OpenHands 接口。中英文 UI、Android 编译与 lint 一并验证。

隔离 Android 15 模拟器验证过开启服务、切到后台继续运行，以及终止进程后系统恢复前台服务与已保存队列。此项使用空队列，不证明所有厂商手机锁屏长时间调度可靠，也不代替真机自动回复测试。

真实 OpenHands 1.54.0 与本地 qwen3.6:27b 已验证单次派发、完成结果、待验收状态与重新加载后的保留。该测试的决策适配器为固定的合成规则，不是手机管家模型的判断质量评测。

`tools/openhands/live-smoke.py` 使用真实 SDK、生产 Java 调度器与适配器、临时工作目录和虚构任务，不读取真实员工、个人模型密钥或项目文件。运行需要独立 OpenHands 环境、JDK 17、json-java 20250517 测试 jar，以及本地测试模型：

```bash
ASB_JSON_JAR=/absolute/json-20250517.jar .venv-openhands/bin/python tools/openhands/live-smoke.py
```

真机后台长时间运行、复杂开发任务和自动发布均需要另外验收。本版没有自动发布小红书或公众号的工具。

实际 0.5.53 APK 已在 Android 15 隔离模拟器中通过后台模型判断 → 单次派发 → 读取结果 → 待验收 → 用户验收流程，队列不包含模型或服务密钥。

实际 APK 的合成后台验证脚本为 `tools/openhands/native-smoke.cjs`。它只接受隔离模拟器，拒绝覆盖已有模型配置和任务；通过本地模拟模型与 OpenHands 接口验证原生后台判断、单次派发、读取结果和用户验收，不代替真实 OpenHands 模型测试。
