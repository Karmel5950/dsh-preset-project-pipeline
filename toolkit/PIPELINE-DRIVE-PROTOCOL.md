# PIPELINE-DRIVE-PROTOCOL — 流水线外部值守驱动协议(工具无关)

> 任何 AI agent 工具(Claude Code / Codex / OpenCode / dsh headless / zcode / 人的终端)只要满足
> 前提三条,读完本文即可值守驱动 dsh 项目流水线——登记、监控、门禁裁决、卡点处理、交付应用。
> 本协议是 `plugindev/toolkit/` 三个 CLI 的工具无关说明书;zcode 侧的使用姿势见
> `.agents/skills/dsh-pipeline/SKILL.md`(同一协议的 zcode 技能封装)。

## 0. 前提(满足即Compatible)

1. 能执行命令(node ≥22 在 PATH;三个 CLI 零 npm 依赖)
2. 能读写流水线工作区文件(默认 `plugindev/pipeline-ws/`)
3. 能被异步唤醒(被 watcher 回调拉起 / 自己轮询事件文件 / 长驻会话被外部投喂)——三者其一

## 1. 角色定位

你是**裁决方代理**(用户代理),与流水线六角色(干活方)垂直:流水线角色产出门禁包/卡点,
你代表用户审查并裁决。裁决权边界见 §5 安全边界——越界即停。

## 2. 命令清单(全部零依赖 node CLI)

| 命令 | 用途 |
|---|---|
| `node toolkit/pipeline-start.mjs --prompt <登记投递.md> [--base-url http://127.0.0.1:3081]` | 登记新需求:创建本项目专属 intake 会话并投递登记投递 |
| `node toolkit/pipeline-drive.mjs --session <sessionId> --prompt <投递.md>` | 向会话投递消息(登记/门禁裁决/卡点裁决/指令) |
| `node toolkit/pipeline-watch.mjs --ws-root <pipeline-ws> [选项]` | 值守监控(见 §3) |

会话定位铁律:一切 `--session` 取自**目标项目** `pipeline-ws/<projectId>/.dsh-project/REGISTRY.json`
的 `sessions`(sessionId 键对象)中 `role==='intake'` 的会话 id。
`--base-url`:test 实例 3081(DSH_HOME=plugindev/.dsh-home)必须**显式**传;3080 是 prod,禁碰。

## 3. 事件与值守(watcher)

```
node toolkit/pipeline-watch.mjs --ws-root <pipeline-ws> \
  [--notify-cmd "<拉起你的命令>"]   # 事件详情经环境变量:DSH_WATCH_EVENT/_PROJECT/_DETAIL/_LOG/_EXIT/_WS_ROOT
  [--notify-file <path>]            # 同一事件追加 NDJSON:{ts,kind,project,detail,exit,wsRoot,log}
  [--stay]                          # 通知后不退出继续盯(全自动模式);默认通知后退出(退出码=事件码)
```

事件语义(需你出场):`BASELINE-PENDING`(布防时已有挂起,退出码 3)/ 门禁 `gate=pending` /
卡点 `blockers-open>0` / `STATE-FINAL`(项目转 delivered/rejected,需结项收尾)/ `FRAME`(提问帧)。
常规事件(阶段推进/新项目/mtime)只写日志不打扰。
watcher 自愈:常规事件不退、WS 断线自动重连、单例锁(`<ws-root>/.pipeline-watch.lock`)
自动接管旧实例/回收陈锁——**重挂=直接再跑同一条命令,无需清点旧进程**。

## 4. 处理循环(事件 → 裁决 → 重挂)

1. 读事件(回调 env / NDJSON / 退出码)→ 读 `pipeline-watch.log` 尾部与 CONFIRMED 快照
2. 按事件类型处理:
   - **门禁 pending**:读 `pipeline-ws/<id>/.dsh-project/gates/<NN>-<gate>.md`(摘要/待审材料/建议),
     按需核对材料(SPEC/DESIGN/deliverables/journal),写裁决投递文件:
     `【<projectId> · <gate> 裁决】approve/revise/reject` + 逐条核对依据 → `pipeline-drive` 投给 intake
   - **卡点 open**:读 REGISTRY.blockers(reason/options/recommendation),同案同判引用
     `pipeline-ws/.dsh-library/rulings.json`,新案写裁决上报用户或按裁决 resolve
   - **STATE-FINAL**:结项收尾(git tag `plugindev/project-pipeline/vX.Y.Z` + subtree 同步 + 记忆/文档更新)
3. 需要用户侧真机的项(视觉验收/真实上游/部署 IN SYNC+重启/e2e 数字)——见 §5,不得以静态检查替代
4. 处理完重新布防 watcher(同一条命令,单例锁自动接管)

## 5. 安全边界(越界即停,报告不擅自决定)

- **永不自动**:卡点的新裁决方向、APPLY 改生产源码、deploy+重启、验收口径变更(如阈值重定义)、
  与 rulings.json 既有裁决冲突的判定——一律呈报用户裁决
- **approve 前必须**:实际读门禁包与关键材料;「建议批准」不等于批准理由成立
- **裁决留痕**:每份裁决写明逐条核对依据;用户可随时复核审计
- **真机 blocking 项**(既定裁决 r1/r4):流水线与代理都只做静态核对,真实验证归用户侧

## 6. 挂载示例

- **zcode**:Bash `run_in_background` 挂 watcher;task-notification 唤醒;技能文件 `.agents/skills/dsh-pipeline/SKILL.md`
- **回调型 headless agent(Claude Code / Codex / OpenCode)**:
  `--notify-cmd "claude -p '流水线事件:读 \$env:DSH_WATCH_LOG 处理' --dangerously-skip-permissions"`
  (示例;各工具 headless 旗标不同,事件详情在环境变量里,命令模板由布防者按其 CLI 语法写)
- **轮询型/cron**:cron 定时读 `--notify-file` 的 NDJSON,发现新行即拉起 agent 处理(按 ts 去重)
- **dsh 自举**:dsh headless 会话作为代理(实例内值守,配合 dsh-schedule 是波 3 候选)
