# dsh 项目制交付流水线

**DeepSeek Harness(dsh)的项目制交付系统**:把「需求 → 门禁裁决 → 实现 → 验收 → 归档」变成一条可审计、可驱动的流水线。由三部分组成:**12 阶段流程 agent preset**、**项目中心看板宿主插件**、**工具无关的驱动工具链**。

> 当前版本:preset **v0.23.0** · project-hub **v0.4.0**

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

## 从 GitHub 部署到本地(快速开始)

把本仓库作为 dsh 项目制交付系统的**安装源**:从 GitHub clone 后,部署到你自己的 dsh 实例(本地)。下面每一步都是**在本仓库语境下可执行**的真实命令。

### 0. 前提条件

- 一个**已安装、可运行**的 dsh 实例。外部主路径用**你的真实实例**(prod,默认 `http://127.0.0.1:3080`)。
- 一个独立目录用于保存 clone 下来的仓库(下文称 `<仓库根>`);除标注外,命令在 `<仓库根>` 下执行。
- (可选)试验独立的 **test 隔离实例**(默认 `http://127.0.0.1:3081`)需要 dev 工具链依赖,见「开发与维护者」;外部快速开始不强制。

### 1. 克隆本仓库

```bash
cd <你打算存放的目录>
git clone https://github.com/Karmel5950/dsh-preset-project-pipeline.git
cd dsh-preset-project-pipeline      # 此时目录即 <仓库根>
```

### 2. 部署 preset(直接安装,必选;零源码改动、无需 dsh-runtime)

dsh 预设就是一个**自包含目录——放入预设根即完成安装**。把 `presets/project-pipeline/` 子树放进你的 preset 安装根即可:

```bash
cd <仓库根>

# POSIX(Git Bash / WSL / macOS / Linux):
mkdir -p ~/.dsh/.agent-presets
cp -r presets/project-pipeline ~/.dsh/.agent-presets/project-pipeline

# Windows(cmd / PowerShell):
mkdir %USERPROFILE%\.dsh\.agent-presets       # 若目标目录不存在
xcopy /E /I .\presets\project-pipeline %USERPROFILE%\.dsh\.agent-presets\project-pipeline
```

> 上面 `mkdir -p` / `cp -r` 是 **POSIX 语法**。Windows cmd 请用右侧等效(xcopy 等),或直接在 **Git Bash / WSL** 里执行整段 POSIX 命令。
>
> `<仓库根>` = 本仓库 clone 后根目录;**`<installRoot>` = 你的 dsh 预设安装根**,即 `~/.dsh/.agent-presets`(Windows 为 `%USERPROFILE%\.dsh\.agent-presets`)。

### 3. 部署项目中心宿主插件(可选)

project-hub 把登记簿变成 web 界面可见的项目中心(项目列表/详情/预算)。装好后 dsh 侧栏出现「项目中心」入口;不需要看板可跳过本步。

```bash
cd <仓库根>/host-plugins/project-hub
node deploy.mjs --env prod --confirm-prod     # 部署到你的真实实例(prod;需显式确认)
```

> 该脚本部署到 `~/.dsh/profiles/web/...`(prod),不依赖 sibling dsh-runtime;`--confirm-prod` 必须显式给定。若部署到独立的 test 隔离实例,不加 `--confirm-prod`(需 dsh-runtime,见「开发与维护者」)。

### 4. 重启实例

- **外部主路径(你的真实实例 prod)**:按你 dsh 实例的启动/重启方式重启(本仓库工具链不管理 prod 实例生命周期)。
- **dev/test 隔离实例(维护者内件)**:`cd <仓库根> && node toolkit/env.mjs down && node toolkit/env.mjs up`(需 sibling dsh-runtime 就位,见「开发与维护者」)。

### 5. 行为探针验证

```bash
cd <仓库根>
node presets/project-pipeline/scripts/pm-probe.mjs   # 静态要素(模型/角色/门禁授权)
# 行为级(不要只看 HTTP 200):role_show(role=pm) 可展开、subagent_pm 可 spawn
# 看板(装了 host 插件后):curl http://127.0.0.1:3081/plugins/project-hub/api
#   → { "ok": true, "projects": [ ... ] }
```

### 6. 后续更新

仓库发新版后,按 [`docs/UPDATE.md`](docs/UPDATE.md) 的五步闭环更新(git pull → 变更应用 → deploy IN SYNC 核对 → 重启 → 探针)。

## 开发与维护者

本仓库是一个 git monorepo。`toolkit/` 下的开发编排工具(`paths.mjs` / `deploy.mjs` / `env.mjs` 等)面向**作者本地 monorepo 布局**,要点如下:

- **仓库根没有 `package.json`**——仓库根没有任何可执行的 `npm` 脚本命令。旧文档/旧 README 曾出现的 deploy、preset 安装类命令来自**作者本地 monorepo**,clone 后**不存在**、照抄必然失败。外部安装请走上方「从 GitHub 部署到本地」的直接安装路径,不要照抄任何 `npm` 脚本命令。真正的 dev 编排工具用 `node toolkit/deploy.mjs` / `node toolkit/env.mjs` 直跑(见下)。
- `node toolkit/deploy.mjs --preset project-pipeline`、`node toolkit/env.mjs up` 依赖 **sibling `dsh-runtime`**(内部读 `dsh-runtime/node_modules/@deepseek-ai/dsh/package.json` 的版本、用其 `DSH_BIN` 拉起实例),独立 clone 下会报 ENOENT——这些是作者 dev 编排内件,不作为外部部署 step。
- `host-plugins/project-hub/deploy.mjs --env prod` 部署到 `~/.dsh/profiles/web/...`,仅取路径模块顶层常量、**不依赖 sibling dsh-runtime**(静态评估可运行,未经在独立 clone 下实测);使用前请先核对目标路径。
- **本地服务默认值与环境变量覆盖**:本工具链 test 隔离实例默认 `http://127.0.0.1:3081`、prod 默认 `http://127.0.0.1:3080`,均为合理默认值。覆盖方式:
  - `DSH_PLUGINDEV_PORT`(默认 `3081`)——改 **test 隔离实例**端口;
  - `DSH_API`(默认 `http://127.0.0.1:3080`)——改 **prod** API 基址;
  - `DSH_HOME`(默认 `~/.dsh`)——改 dsh home(进而改预设安装根)。

## 驱动流水线

下列驱动工具是给**流水线驱动方**(intake/主线程)用的,指向一个已运行的 dsh 实例:

```bash
# 登记需求(创建项目专属 intake 会话并投递)
node toolkit/pipeline-start.mjs --prompt <登记投递.md> --base-url http://127.0.0.1:3081

# 裁决下发
node toolkit/pipeline-drive.mjs --session <intake会话id> --prompt <裁决书.md>

# 值守监控(registry 轮询 + WS 帧通道双覆盖)
node toolkit/pipeline-watch.mjs --session <intake会话id> --timeout-min 360 --ws-root <工作区>
```

完整的驱动协议(命令清单/事件语义/裁决格式/安全边界)见 [`toolkit/PIPELINE-DRIVE-PROTOCOL.md`](toolkit/PIPELINE-DRIVE-PROTOCOL.md),操作手册见 [`skills/dsh-pipeline/SKILL.md`](skills/dsh-pipeline/SKILL.md)。`<工作区>` = 流水线工作区根(示例来自作者环境),即 watcher 轮询的目录。

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

> 两条版本线各**独立 bump**(preset 锚 `presets/project-pipeline/package.json`,hub 锚 `host-plugins/project-hub/ui/package.json` + CHANGELOG),`0.x` 同号属巧合不联动。

## 设计原则

- **流程做成数据,不做死代码**:阶段、角色、门禁要求全部数据驱动,定制点=声明式清单
- **门禁否决权在人**:所有自动化评审(PM/toolface/审计)都是前置质量闸,不替代用户终审
- **框架优先于定死流程**:搭基础设施与升级路径,而非为每个场景写死分支
- **如实上报,不走降级**:能力缺口显式上报卡点,禁止以静态检查冒充真实验收

---

## 附:双环境(维护者 opt-in)

外部部署用户**无需关心本节**:默认单环境(端口 3080、dsh-home `~/.dsh`)开箱即用。

仓库维护者(作者本机)使用 test/prod 双实例隔离时:在仓库根放 `.plugindev-env.json`(内容 `{"env":"test"}`,已被 .gitignore 忽略)或设环境变量 `DSH_ENV=test|prod` 显式开启;开启后 `node toolkit/env.mjs up|down|status`、`deploy --env test|prod` 与 `--list` 对账恢复双环境语义。该文件**不入库**——否则会污染 clone 用户的单环境默认。
