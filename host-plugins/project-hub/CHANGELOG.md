## [0.4.2] - 2026-09-07

看板扫描接受 symlink/junction 项目目录(Windows junction 形态项目目录不可见修复;实测 2026-09-07:项目目录以 junction 形态挂进扫描根后,项目中心列表整体缺失)。

- **root cause**:`scanProjects` 的 dirent 过滤仅认 `entry.isDirectory()`;Windows junction(NTFS 挂载点)在 `readdir(withFileTypes)` 的 dirent 里是 `isSymbolicLink()=true/isDirectory()=false` → 被过滤。
- **修复**:过滤放宽为 `isDirectory() || isSymbolicLink()`(isSymbolicLink 防御式调用,兼容 Dirent-like stub);「是否真是项目目录」仍由既有 `stat(<项目>/.dsh-project)` 守门——悬空/非项目链接 stat 失败 → 跳过,单项目失败不拖垮整体(原语义不变)。
- **测试**:新增回归「scanProjects:junction/symlink 项目目录可见」(symlink dirent 收录/悬空链接跳过/普通目录照常)。
- 版本 0.4.1 → **0.4.2(patch)**。

## [0.4.1] - 2026-09-06

设置卡保存链路修复(真实环境复现:单环境默认部署下「每角色模型」保存必 400,用户报障「修改的模型保存不下来」)。版本 0.4.0 → **0.4.1(patch)**。

- **复现(HTTP 400 实录)**:单环境默认部署(settings.yaml 无 `project-hub:` 节、web 进程未设 `DSH_HOME`)下,`PUT /plugins/project-hub/api {settings:{roleModel:{role:'dev',...}}}` → **400 `role manifest not found: dev`**;UI 弹「保存失败: role manifest not found: dev」。读侧 `view=settings` 不报错(来源降级 default),故仅保存路径暴露。
- **根因**:`resolvePresetRolesDir` / `resolveProjcachePath` 只有 显式 config → env `DSH_HOME` 两级解析;作者环境显式设了 `DSH_HOME` 才可用,单环境默认部署两级皆空 → `presetRolesDir=null` → `writeRoleModel` 找不到 preset 角色声明即 400。
- **修复(host)**:两 resolver 增第三级回退 `homedir()/.dsh`(与 dsh 单环境默认 dsh-home 一致,同 toolkit paths.mjs 的 DSH_HOME 默认)。返回目录不存在时读侧照旧降级 default、写侧维持 400 语义,行为无新增风险。
- **修复(UI)**:
  - 看板零项目空态显示**当前 scanRoot + 修改指引**(扫错根不再静默空白——本机 scanRoot 回退值与流水线工作区不一致时,看板此前直接空白且无解释);
  - 设置卡「每角色模型」块显示**保存落点**(`<scanRoot>\.dsh-library\roles\<角色>.json`)与「须与流水线工作区一致」提示;
  - 角色卡编辑态增**未保存徽章**:下拉改动不点「保存」即丢弃,此前无任何提示(用户实测踩坑:改完下拉直接关面板,重开还原);保存/恢复默认成功后同步 roles 快照防徽章误亮。
- 测试:client 48 → **53**(isRoleDraftDirty 纯函数 3 例 + 警示 UI 静态核对 2 例),host 122 → **125**(resolver 第三级回退 2 例 + 通道级复现回归 1 例「无显式 config 经 env 解析 preset → 200」),合计 170 → **178 全绿**。
- 触点:host-plugins/project-hub(project-hub.mjs resolver ×2 / ui/lib/client.js / test ×2)→ 部署需**重启 web 实例**;部署后建议把看板 scanRoot 显式配置到流水线工作区根(见 docs/BUGREP-2026-09-06-role-model-save-400.md)。
## [0.4.0] - 2026-09-06

单环境默认部署(kr-single-env 交付):deploy.mjs 默认部署到单环境 dsh-home(~/.dsh/profiles/web);--env prod --confirm-prod 仅双环境显式开启(仓库根 .plugindev-env.json 或 DSH_ENV)下适用。版本 0.3.0 → **0.4.0(minor)**。
## [0.3.0] - 2026-09-06

看板可读性与时间线(kr-board-time-token 交付;用户五点:token 格式化+删条目数+项目/流程时间+记录页时间)。

- **R1** token 数字可读化:formatToken 纯函数(三位逗号分组,<1e6;≥1e6 切 M、≥1e9 切 B,1 位小数去尾零),列表/汇总/预算 tab 统一。
- **R2** 移除「上报条目数」三处渲染(列表预算列/工作区汇总/预算 tab);host 侧 computeTotals 保留计算(向后兼容),逐条上报明细列表不删。
- **R3/R5** 项目卡片开始/结束/耗时;记录页条目补时间(formatDuration 纯函数:「X天Y小时」粒度,无「X月Y天」)。
- **R4** 流程进度每阶段时间+token:API 补 createdAt/stageTimes/journals 字段;stageTokenTotals 按 stageId 聚合 committed。
- 测试:client 48 + host 122 = 170 全绿。
# Changelog — dsh-project-hub-ui (project-hub 宿主插件)

本文件记录 project-hub 宿主插件(设置 tab UI + API 层)的显著变更。版本号对应 `ui/package.json`。

## [0.2.0] - 2026-09-06

流水线设置 UI 可用性重做(设置 tab 迭代 2,kr-control-plane-i2 交付;背景:迭代 1 设置 tab 功能正确但可用性/易用性被用户否决,打回重做。design-gate round 3 用户本人亲裁 C-A~C-D:范围缩为两模块,模型选择改选 dsh 已配置模型清单,规则表移出)。

- **设置面板重做(两模块,design-gate round 3 C-A~C-D)**:
  - 左侧分区导航(沉淀策略 / 每角色模型)+ 右侧内容区,替代迭代 1 的四块平铺(解决「无主次与导航」)。
  - **块 1 沉淀策略(C-D)**:只保留沉淀开关 + 沉淀阈值 + 保存;规则卡片/新增规则/高级设置/meta JSON 文本框全部移出——规则的增删改走流水线(文件/裁决流),UI 不做。
  - **块 2 每角色模型(C-A/C-B)**:角色卡片(角色名 + 职责说明 + 当前模型 + 来源徽章)+ 模型下拉动态渲染 dsh 已配置模型清单 + 恢复默认 + 红线提示。
  - **「沉淀凭证」「只读展示」移出设置 tab(C-C)**:凭证写入机制(audit-trail)不受影响,仅 UI 不再展示;rulings/categories 只读 API 保留但无 UI 入口。
- **C-A 模型选择=选 dsh 已配置模型清单**:新增只读端点 `GET /plugins/project-hub/api?view=models`(数据源 = `settingsService.get('llm-pi-ai')?.providers`),前端拉取动态渲染模型下拉;「高级(手动输入服务商/型号)」整体移除(非降级);模型不在清单里=先去 dsh 设置里配好,不在流水线设置里手输。
- **C-B 选项可见真实型号**:每个下拉选项展示 provider+model 真实型号串(如「deepseek-v4-flash:0731 · ollama-cloud」),人话说明只作前后缀;手写 MODEL_CATALOG 静态清单废弃;API 不可用 → 显式提示「模型清单不可用」,不得臆造条目。
- **C-D 护栏(AC-B3)**:UI 写 audit-rules.json 读-改-写(`applySedimentationChange` 只动 `meta.sedimentation`,`rules[]` 原样透传),不得整体覆盖清掉 rules[];护栏单测补「UI 保存后 rules[] 不变」。
- **C3 恢复默认(卡点 b1 裁决方案 A)**:新增 `resetRoleModel`(校验已知角色 → 备份既有覆盖到 .trash → unlink 移除 workspace 覆盖);PUT `{ settings: { roleModel: { role, reset:true } } }` 触发 reset,返回 reset 后的真实来源与 effectiveModel(preset 声明或默认继承);前端 `restoreDefault` 改调 reset,来源徽章正确变「预设声明」或「默认继承」。
- **模型红线(AC-C1)**:交付物零非默认模型引用,一切环节只准 `deepseek-v4-flash:0731`(经 `ollama-cloud`)。
- 版本 0.1.0 → **0.2.0(minor)**:设置 tab 两模块重做 + view=models 只读端点 + resetRoleModel = 能力重做。
- 测试:project-hub.test.mjs 104 → **118**(新增 view=models happy path / 空 providers 兜底 / settingsService 不可达 / applySedimentationChange 纯函数 / AC-B3 写路径 rules[] 不变 / resetRoleModel 恢复默认路径 6 例),既有机制单测全绿(AC-B2 不回归)。
- **卡点 b1 已裁决(方案 A)**:「恢复默认」(C3) 与「其余 API 不动」冲突已按用户裁决补全 reset 能力,AC-B1 对照表缺口消除。
- 触点:host-plugins/project-hub(设置 tab UI 前端资源 + API 层 view=models + resetRoleModel)→ **r2 交付 deliverables/ + APPLY.md** + **r3 deploy 至 IN SYNC + 重启**(API 层变更命中 r3,重启窗口并入攒批)。
