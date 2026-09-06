# dsh 项目制交付流水线

**DeepSeek Harness(dsh)的项目制交付系统**:把「需求 → 门禁裁决 → 实现 → 验收 → 归档」变成一条可审计、可驱动的流水线。由三部分组成:**12 阶段流程 agent preset**、**项目中心看板宿主插件**、**工具无关的驱动工具链**。

> 当前版本:preset **v0.21.0** · project-hub **v0.3.0**

---

## 核心特性

| 能力 | 说明 |
|---|---|
| **12 阶段标准流程** | clarify → spec-gate → design → **pm-review** → mid-summary → design-gate → build → test → accept → delivery-gate → wrap → harvest;另有 lite-flow(缺陷修复)与 sediment-flow(批量沉淀) |
| **产品经理角色(pm)** | design 产出后、design-gate 前,强制从**用户视角**(可用性/易用性/场景/可读性)评审设计;8 条必查清单内嵌 persona;revise 最多 3 轮,超限升级呈用户 |
| **门禁授权源** | design-gate/delivery-gate 的 approve 必须携带主线程裁决指针 `rulingRef`(帧 rpcId / 裁决文件路径 / 原文摘录三形态),无指针机械拒绝——门禁否决权始终在人 |
| **验收路由前置化** | 真机类验收(视觉/真实会话/部署重启)在 clarify 阶段即声明 `user-blocking`,流水线角色不得以静态检查替代放行 |
| **审计执行凭证** | 每次 `project_audit` 运行写入凭证(SHA-256 returnHash 可回放),杜绝"自述已跑" |
| **项目中心看板** | 项目列表 + 流水线设置宿主插件:真实 token 计量(逗号分组 + M/B 缩写)、项目与阶段时间线(开始/结束/耗时)、每阶段 token 消耗、深浅色主题 |
| **驱动协议(工具无关)** | watcher 双通道(registry 轮询 + WS 帧通道)与裁决下发协议文档化,可接入 Claude Code / Codex / OpenCode / dsh headless 等任意驱动方 |

## 仓库结构

```
├── presets/project-pipeline/   # agent preset:角色、流程、插件、单测
│   ├── roles/                  #   coordinator/product/architect/pm/dev/tester/deliverer
│   ├── flows/                  #   standard-flow(12 阶段)/ lite-flow / sediment-flow
│   ├── plugins/                #   project-registry / project-lib / project-roles …
│   ├── scripts/                #   pm-probe(行为探针)/ toolface 审计
│   └── test/                   #   281 项单测
├── host-plugins/project-hub/   # 宿主面插件:项目中心看板 + 流水线设置
│   ├── project-hub.mjs         #   API 层(护栏/备份/原子写/view=models)
│   ├── ui/lib/client.js        #   前端(零构建 React)
│   └── test/                   #   170 项单测
├── toolkit/                    # 驱动与开发工具链(pipeline-watch / pipeline-drive / deploy …)
├── skills/dsh-pipeline/        # 驱动方操作手册(SKILL.md)
└── docs/                       # 协议与历史文档
```

## 快速开始

前置:一个可运行的 dsh 实例(本仓库工具链默认指向 test 实例 `http://127.0.0.1:3081`)。

```bash
# 1. 部署 preset(必须看到 IN SYNC:版本 + commit 双匹配)
npm run deploy -- --preset project-pipeline

# 2. 部署项目中心宿主插件
cd host-plugins/project-hub && node deploy.mjs

# 3. 重启实例后做行为探针(不要只看 HTTP 200)
node presets/project-pipeline/scripts/pm-probe.mjs   # 静态要素
# 行为级:role_show(role=pm) 可展开、subagent_pm 可 spawn
```

## 驱动流水线

```bash
# 登记需求(创建项目专属 intake 会话并投递)
node toolkit/pipeline-start.mjs --prompt <登记投递.md> --base-url http://127.0.0.1:3081

# 裁决下发
node toolkit/pipeline-drive.mjs --session <intake会话id> --prompt <裁决书.md>

# 值守监控(registry 轮询 + WS 帧通道双覆盖)
node toolkit/pipeline-watch.mjs --session <intake会话id> --timeout-min 360 --ws-root <工作区>
```

完整的驱动协议(命令清单/事件语义/裁决格式/安全边界)见 [`toolkit/PIPELINE-DRIVE-PROTOCOL.md`](toolkit/PIPELINE-DRIVE-PROTOCOL.md),操作手册见 [`skills/dsh-pipeline/SKILL.md`](skills/dsh-pipeline/SKILL.md)。

## 测试

```bash
cd presets/project-pipeline && node --test test/    # 281 项
cd host-plugins/project-hub && node --test test/    # 170 项
```

## 版本

| 组件 | 版本 | 说明 |
|---|---|---|
| presets/project-pipeline | v0.21.0 | 新增 pm-review 阶段与 PM 角色;门禁授权源 rulingRef 强制(变更史见 [CHANGELOG](presets/project-pipeline/CHANGELOG.md)) |
| host-plugins/project-hub | v0.3.0 | 设置 tab 两模块重构;看板 token 格式化与时间线(变更史见 [CHANGELOG](host-plugins/project-hub/CHANGELOG.md)) |

## 设计原则

- **流程做成数据,不做死代码**:阶段、角色、门禁要求全部数据驱动,定制点=声明式清单
- **门禁否决权在人**:所有自动化评审(PM/toolface/审计)都是前置质量闸,不替代用户终审
- **框架优先于定死流程**:搭基础设施与升级路径,而非为每个场景写死分支
- **如实上报,不走降级**:能力缺口显式上报卡点,禁止以静态检查冒充真实验收
