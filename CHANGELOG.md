# Changelog

本 preset 的全部显著变更记录在此文件。

## [0.2.0] - 2026-08-30

流程补丁:可行性分析 + 卡点通道(背景:i3 美化迭代事故——设计与验收角色无浏览器无视觉,以"静态层全过/无法验证不阻塞"强行完成视觉任务并推进到 delivered,raw markdown 裸显缺陷全链放行;困难从未上报,而是被降级消化)。

- **project_block 卡点通道**(登记簿第 6 工具):report/resolve/list;report 登记 blockers[]{status:open} + journal 双向留痕;**open 卡点期间 project_advance 一律拒绝**(机制强制停摆);category = 五维可行性维度 + other;project_status 两级输出新增 openBlockers 计数
- **五维可行性分析**:clarify 阶段并行必做,入 SPEC 专章(设计信息完备/开发复杂度/测试环境与数据/部署权限/验收者能力);任一维度有条件/不可行 → 登记 project_block;spec-gate 呈递前自查
- **角色 persona 全量增补**(均≤300 字):coordinator 收到卡点立即呈递、不代裁决、open 不推进;product 可行性专章 + accept 阶段"影响判定却无法真实验证必须上报,禁止以不在范围/静态层放行";tester 测试可行性自查 + 同款禁令;dev 遇沙箱/依赖/复杂度卡点禁止缩范围硬闯;architect 信息不完备即上报;deliverer 交付卡点上报。六角色 allow 统一加 project_block
- **intake persona**:登记时初筛"验收手段与所需能力"并写进需求原文与回执(验收路由);结算通知携带卡点时原样呈递、resolve 转达
- **手册提示段**:新增「可行性分析」「卡点纪律」两节(含 i3 事故背景);工具速查 5+4 → 6+4
- flows/standard-flow:clarify/accept 阶段 note 增补对应纪律(模板仅影响新项目)
- SPEC-P1 §3.1/§4/§9/§10、DESIGN §11 同步;单测 49/49(新增 project_block 三用例:report 留痕/advance 拒绝与 resolve 恢复/校验与老登记簿兼容)

## [0.1.0] - 2026-08-29

P1 首版:模型面闭环(纯 preset,基座 = 官方 standard 复制叠加;DESIGN §10 P1)。

- 组合文件 `agent.cordis.yml`:intake persona(SPEC-P1 §8 原样)、subagent/subagent_fork 加 `maxDepth: 4`(深度链 用户会话=0 → 协调者=1 → 角色=2 → 角色助手=3)、不启用官方 workflow/ralph(流程引擎即编排,避免双编排)、codex/claude-code disabled 行保留、挂载两本地插件
- 新增本地插件 `project-registry`(登记簿五工具 register/advance/gate/budget/status + 共享手册提示段)与 `project-roles`(角色/流程库四工具 role_list/role_show/flow_list/flow_show;role_show 产出可直接拷进 subagent 调用)
- preset 默认角色库 `roles/`:coordinator/product/architect/dev/tester/deliverer 六份声明式 JSON 清单(模型/工具/工作空间/权限四可调,manifest 不含模型路由默认值)
- preset 默认流程模板 `flows/standard-flow.json`:三道门只是默认模板的一条实例;登记时可选模板或定制 flowStages
- 预算账本 BUDGET:estimate/committed/cap 三段式,P1 口径 `source: self-report`
- 登记簿/库全部 JSON 落盘(随项目仓 git 可追溯);workspace 级 `.dsh-library/` 覆盖 preset 自带库,坏条目跳过带 errors
