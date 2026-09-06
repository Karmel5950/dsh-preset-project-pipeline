# 后续更新流程(Update)

本仓库发布新版本后,在**已部署的本地实例**上做一轮更新。闭环五步:`git pull → 变更应用 → deploy IN SYNC 双匹配核对 → 重启 → 行为探针`。

> **版本线说明**:preset 与 project-hub 是**两条各自独立 bump 的版本线**——
> - **preset**:版本锚在 `presets/project-pipeline/package.json`(当前 **v0.21.0**),变更史 [CHANGELOG](presets/project-pipeline/CHANGELOG.md);
> - **project-hub**:版本锚在 `host-plugins/project-hub/ui/package.json`(当前 **v0.3.0**)对应 `host-plugins/project-hub/CHANGELOG.md`(hub 根无 package.json,以 `ui/package.json` 为权威)。
>
> 两条线各自 tag/发版,`0.x`(或任意同号段)**纯属巧合,不联动**——更新时逐个组件看各自的 CHANGELOG 决定是否需重启、是否要更新。

---

## 1. git pull(拉取最新)

在 `<仓库根>` 拉取远端最新:

```bash
cd <仓库根>
git pull
```

## 2. 变更应用

按变更类型把新版本应用到你的本地部署:

- **preset 变更**:重放快速开始的 step 2——把 `presets/project-pipeline/` 重新拷贝覆盖到 `<installRoot>/project-pipeline`:
  - POSIX:`cp -r presets/project-pipeline ~/.dsh/.agent-presets/project-pipeline`(覆盖);
  - Windows:`robocopy .\presets\project-pipeline %USERPROFILE%\.dsh\.agent-presets\project-pipeline /MIR`(或用 `xcopy /E /Y ...`)。
- **host 插件变更(若装了)**:`cd <仓库根>/host-plugins/project-hub && node deploy.mjs --env prod --confirm-prod`。
- **dev 工具链变更**(维护者内件、可选):按仓库根 README「开发与维护者」的 sibling `dsh-runtime` 约束执行。

> `mkdir -p` / `cp -r` 为 POSIX 语法;Windows 用右侧等效(xcopy/robocopy)或在 Git Bash / WSL 里执行。`<仓库根>` 与 `<installRoot>` 含义见仓库根 README(安装根 = `~/.dsh/.agent-presets`,Windows `%USERPROFILE%\.dsh\.agent-presets`)。

## 3. deploy IN SYNC 核对(版本 + 提交 双匹配)

分**两种安装方式**,核对路径不同,别搞混:

### 方式 A.直接安装(外部主路径,preset 子树拷贝)

直接安装**不会写入** `.plugindev-deploy.json` 部署戳。用**版本 + git HEAD** 兜底核对:

- **版本**:本地 `~/.dsh/.agent-presets/project-pipeline/package.json` 的 `version` ↔ 仓库 `presets/project-pipeline/package.json` 的 `version`;
- **提交**:本地对应文件的 git commit ↔ 仓库当前 HEAD。

**双匹配 = IN SYNC;任一不匹配 = STALE**,须回到 step 2 重新应用,直至匹配。
> 直接安装**没有部署戳文件**,不要去找 `.plugindev-deploy.json`(缺戳不代表同步错误——只是没走 dev 工具链写入)。

### 方式 B.dev 工具链安装(维护者内件)

- 读部署戳 `<installRoot>/project-pipeline/.plugindev-deploy.json` 的 `sourceVersion` / `gitCommit`;
- 与仓库源码 `package.json version`、git HEAD 对照;
- 也可 `node toolkit/deploy.mjs --list` 对账(与戳文件同源)。
- **IN SYNC = 版本 + 提交双匹配**;否则继续应用至同步(只改源码不 deploy 即 STALE,会呈现旧代际假失败)。

## 4. 重启

- **prod(你的真实实例,外部主路径)**:按你 dsh 实例的方式重启(本仓库工具链不管理 prod 实例生命周期)。
- **test 隔离实例(维护者内件)**:`cd <仓库根> && node toolkit/env.mjs down && node toolkit/env.mjs up`(需 sibling `dsh-runtime` 就位)。

> 是否需要重启、是否攒批,以各组件 CHANGELOG 的「需重启」标注为准。

## 5. 行为探针

```bash
cd <仓库根>
node presets/project-pipeline/scripts/pm-probe.mjs   # 静态要素(模型/角色/门禁授权)
# 行为级(不要只看 HTTP 200):role_show(role=pm) 可展开、subagent_pm 可 spawn
# 看板(装了 host 插件后):curl http://127.0.0.1:3081/plugins/project-hub/api
#   → { "ok": true, "projects": [ ... ] }
```

全部通过即本轮更新完成。
