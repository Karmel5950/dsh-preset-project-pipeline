# Changelog

本 preset 的全部显著变更记录在此文件。

## [0.1.0] - 2026-08-29

P1 首版:模型面闭环(纯 preset,基座 = 官方 standard 复制叠加;DESIGN §10 P1)。

- 组合文件 `agent.cordis.yml`:intake persona(SPEC-P1 §8 原样)、subagent/subagent_fork 加 `maxDepth: 4`(深度链 用户会话=0 → 协调者=1 → 角色=2 → 角色助手=3)、不启用官方 workflow/ralph(流程引擎即编排,避免双编排)、codex/claude-code disabled 行保留、挂载两本地插件
- 新增本地插件 `project-registry`(登记簿五工具 register/advance/gate/budget/status + 共享手册提示段)与 `project-roles`(角色/流程库四工具 role_list/role_show/flow_list/flow_show;role_show 产出可直接拷进 subagent 调用)
- preset 默认角色库 `roles/`:coordinator/product/architect/dev/tester/deliverer 六份声明式 JSON 清单(模型/工具/工作空间/权限四可调,manifest 不含模型路由默认值)
- preset 默认流程模板 `flows/standard-flow.json`:三道门只是默认模板的一条实例;登记时可选模板或定制 flowStages
- 预算账本 BUDGET:estimate/committed/cap 三段式,P1 口径 `source: self-report`
- 登记簿/库全部 JSON 落盘(随项目仓 git 可追溯);workspace 级 `.dsh-library/` 覆盖 preset 自带库,坏条目跳过带 errors
