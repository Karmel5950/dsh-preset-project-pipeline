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
