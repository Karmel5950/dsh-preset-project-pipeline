# Changelog

本 preset 的全部显著变更记录在此文件。

## [0.8.0] - 2026-09-01

预算账本改真实 token 计量(budget-token-meter 交付;背景:原 BUDGET.json committed 全是角色自报的拍脑袋数字,usage 形状自由不可聚合,estimate/cap 多为 null——预算系统形同装饰。运行时本有逐会话真实 tokenUsage(projcache 投影),只是从未接入)。

- **A commit 自动填**:`project_budget` commit 允许 `source='runtime-events'` 且 usage 缺省 → 插件按调用者会话 id 读 projcache(`context.agent.session.header.id`)自动填四桶(uncachedInputTokens/outputTokens/cacheRead/cacheWrite),条目带 asOf/projcacheMtime 供复核;有效计费口径 = uncachedInput + output(DeepSeek 路由 cache 桶恒 0)。
- **B advance 联动归集**:每次 advance 自动 collect——扫 REGISTRY.sessions(主备两路登记:协调者 spawn 回传 subagentId 为主,任何会话首调 project 工具按调用类型自动记为兜底),读 projcache 按角色分桶汇总,**全量重算并替换**全部 runtime-events 条目(同一 sessionId 不重复计数);幂等、非致命(projcache 读失败/守卫报错不阻断 advance,带 collected.note)。
- **口径(C2+R1β)**:项目账本只计项目私有会话(协调者/角色/探针)按 role 分桶;intake 及被 ≥2 项目登记的共享会话只进工作区级汇总计一次(sharedOnce)——实测 intake 全量计入各项目会造成约 30 倍失真,项目间不可比。
- **projcache 纯函数**:`readProjcache`(unit.version=3 守卫,≠3 中文报错不误解析)/`sessionTokenUsage`/`aggregateByRole`;定位 = config `projcachePath` 显式优先,env DSH_HOME/storages 回退。
- **host 看板(project-hub)**:computeTotals/budgetSummary/aggregateBudget 对 runtime-events 条目按桶数值求和(byRole[role] = { count, tokens } + totalTokens),工作区级含 sharedOnce;看板预算列/预算 tab/工作区汇总呈现真实 token 总量;i18n 增 totalTokens/sharedOnce 键;host 侧同款 projcache 读取与守卫。
- **coordinator persona**:移除「每阶段 budget 上报」(自动归集取代),增「advance 时传 spawn 返回的 subagentId 登记会话」;694 字符(≤700)。
- 容差声明:runtime-events 数字反映 collect 时刻 projcache 检查点快照(检查点延迟实测 ≤1.7h),project_status 输出附来源说明。
- 版本 0.7.0 → **0.8.0(minor)**:BUDGET_SOURCES 枚举不动(复用预留的 'runtime-events' 口径)= 能力新增

## [0.7.0] - 2026-08-31

看板搜索/筛选 + 项目操作(归档/置顶)写路径(project-hub-i8 交付;背景:看板项目多时找项目难,且归档/置顶这类展示层语义无处安放——登记簿状态机语义不可动,需开一个窄写面)。

- **看板搜索/筛选(纯前端受控状态)**:project-hub 看板新增搜索框(按 title 中文 + id 英文模糊匹配,大小写不敏感,输入即过滤,× 清空)+ 状态筛选 chips(active/delivered/rejected/parked 多选,与搜索 AND 叠加)+ 「已归档」toggle;空态「无匹配项目」+ 清空指引。全部为 React useState 受控,不触发 refetch(AC-S1~S5/F1~F5/E1~E2/C1~C2)。
- **归档/置顶(展示层标记 + 写端点)**:新增唯一写面 = workspace 级 board view config(`<scanRoot>/board-view.json`,形状 `{ items: { "<id>": { pinned, archived } } }`),REGISTRY.json 保持严格只读。看板行内操作按钮(置顶/归档,stopPropagation 不误触导航),乐观更新 + 写端点落盘,失败回滚 + 提示。排序优先级:用户置顶 > active 置顶,置顶间 updatedAt 倒序(AC-A1~A5/P1~P5)。
- **后端写端点 + 安全护栏**:project-hub.mjs 新增 `readBoardViewConfig`/`writeBoardViewConfig`(原子写:临时文件 + rename)/`applyBoardChange`(幂等 set/clear)纯函数;通道扩展 GET `?view=board` + PUT `{ board: { id, archived?, pinned? } }`。安全护栏 AC-W1~W7:白名单字段 / 固定路径 / 无越权写(只写 board-view.json)/ id 存在校验 / 幂等 / 并发(last-write-wins,无数据损坏)/ 读容错(缺失/坏 JSON → 空配置)。
- 版本 0.6.0 → **0.7.0(minor)**:搜索/筛选/归档/置顶/写端点 = 能力新增
- 测试:host-plugin project-hub.test.mjs 增 board view config 读写 + PUT board 写端点护栏(W1~W7)用例;新增 client.test.mjs(浏览器半面纯函数 filterProjects/applyBoardView/applyBoardChange/sortProjects 提取 eval 单测,覆盖搜索中英文/筛选逐态/叠加/空态/归档/置顶/排序)。

## [0.5.0] - 2026-08-30

自成长四机制增强(pipeline-selfgrowth 交付;背景:确认型卡点重复消耗、失败模式靠人发现、perm-boundary-p1 的 STALE 事故、用户提了但不想现在做的需求无处安放)。

- **机制1 既定裁决库**:新增 workspace 库 `.dsh-library/rulings.json`(用户可自增裁决免部署、免重启),种子四条(视觉类=用户侧 blocking/截图+双核验;外部路径=deliverables+APPLY;preset/宿主改动=IN SYNC+重启攒批;真实上游/凭据/无人值守=用户侧 blocking);project-lib 增 `readRulings`/`validateRulings`/`matchRuling` 纯函数(命中判据=前提一致才命中);product persona 增「先读裁决库、命中不重抛、不一致仍上报」引用规则;MANUAL_TEXT 增「既定裁决库」小节
- **机制2 失败模式聚合**:project-lib 增 `collectAllBlockers`/`aggregateByCategory`/`buildFailureReport` 纯函数(规范参考实现,单测锁定形状);coordinator persona 增 harvest 聚合步骤(扫全部 sibling REGISTRY blockers 含 delivered,同 category ≥2 → 四要素报告写 SUMMARY + 随结算上抛 intake);边界=聚合是呈递材料非卡点,勿用 project_block;MANUAL_TEXT 增「失败模式聚合」小节
- **机制3 部署自检**:coordinator persona 增部署自检核对规则(读部署戳 .plugindev-deploy.json + 源码 package.json version + git HEAD → IN SYNC 判据);门禁包三要素(戳版本/commit、源码 HEAD、是否 IN SYNC);IN SYNC=false 作为 approve 前置;MANUAL_TEXT 增「部署自检」小节;APPLY.md 必含 deploy IN SYNC 步骤
- **机制4 暂存区 parking**:project_register 增 `parked` 参数(默认 false)→ REGISTRY.state='parked'(入册不 spawn);project_advance 增 parked 激活路径(`activate:true` → parked→active,stageIndex=0),parked 不设 activate 一律拒绝;ADVANCE/REGISTER 输出 schema 增 state/activated;intake persona 增 parked 语义(入册不 spawn、激活后 spawn);coordinator 触点比对含 parked(标注不冲突);看板 project-hub 增「暂存区」分组 + state.parked 徽章(i18n zh「暂存」/en「Parked」+ CSS data-state=parked);MANUAL_TEXT 增「暂存区 parked 语义」小节
- 版本 0.4.0 → **0.5.0(minor)**:parked 状态 + 失败模式聚合 = 能力新增
- 测试:project-registry.test.mjs 增 parked 状态机/register 单测;新增 project-lib.test.mjs(裁决库解析/校验/命中 + 聚合);host-plugin project-hub.test.mjs 增 parked 透传回归

## [0.4.0] - 2026-08-30

spawn 硬化(perm-boundary-p2 交付;背景:p1 建立的 per-role 工具行白名单存在残余洞——通用 subagent/subagent_fork 无过滤通道,p1 R2-AC5 一轮探针实证 56 工具全量泄漏,二轮修全)。

- **通用 spawn 通道物理移除**:agent.cordis.yml 删除 tool-subagent(toolName: subagent)与 tool-subagent-fork 两行;preset 内不再存在无 toolFilter 的 spawn 工具行;coordinator 白名单去 subagent/subagent_fork(fork 非必需,续聊走 send_message;fork 过滤语义经 continuation.js L206/L652 核实)
- **devhelper 带 filter 通道**(R2 选型 b):新增 tool-subagent-devhelper 行(toolFilter = dev 面减 spawn 权,无 subagent/send_message);dev 白名单去 subagent、加 subagent_devhelper;dev persona 指定用该工具名派助手
- **白名单一致性审计制度化**(R4,b1 教训收口):project-roles.test.mjs 新增 5 组断言——角色 allow 与 per-role 行 toolFilter 逐条对照真实工具面基准(REAL_TOOL_SURFACE,按 R2-AC5 探针实测名单)+ FORBIDDEN 名单(bash/web_fetch/通用 spawn);b1 类「白名单引用不存在工具」从此被测试拦截
- **R1 纪律文本沙箱事实修正**:workspaceNoteFor/MANUAL_TEXT 由「沙箱允许写整仓库」修正为「可写根=会话 cwd(pipeline-ws),生产路径实际写不进」(实证:i5/p2 两次 Access denied;tester 越界探针就地关闭 p1 R1-AC4)
- **spawn 纪律段**:MANUAL_TEXT 增补;intake persona 指定 subagent_coordinator;coordinator persona 简化(机制保证后纪律从简)
- 测试 49→64(一致性断言 5 组+角色用例);单测 290/290 全仓绿(含 host-plugins)

## [0.3.1] - 2026-08-30

流程补丁(project-pipeline-fix-031 交付):多项目调度与重启决策。

- 机制1『资源触点互斥声明』:项目在 SPEC 声明触点三要素(拟改文件/拟部署组件/需重启);协调者派活前触点比对,冲突 project_block(other) 上抛用户排序;intake 登记时触点重叠提示(不阻断)
- 机制2『重启决策规则』:必须重启/免重启清单+攒批决策树(窗口由用户停摆点裁决)+--no-open 事实;入手册+SPEC-P1 §15 契约+restart-decision-rules.md;lessons 内化副本
- persona:coordinator 增派活前触点比对(561 字,断言 300→450→700 二次放开);intake 增登记重叠提示
- AC-M3-1 冲突模拟用户侧实测;49/49+check 绿

## [0.3.0] - 2026-08-30

流程修复(project-pipeline-fix-030 交付):三缺陷。

- **缺陷1(通道级)**:协调者禁 self-ask——persona 写明一律不自问 ask_user_question;own 层豁免经用户侧代码级确证(dsh-tools view() own 层直接 visible.set,承重契约),不改运行时
- **缺陷2(统一呈现面)**:intake 为唯一用户提问面;协调者等用户裁决(门禁/卡点/停摆)一律结算上抛 intake 呈现/回收/回传;统一呈递契约入 SPEC-P1 §13,监控兜底(WS question 帧+/api/respond)入 §14
- **缺陷3**:部署形态入审计③(dev persona 三分级取证);audit-deploy-form.md 契约文档;git 源插件安装序列入 .dsh-library/lessons;市场 install 字段反馈归档
- persona 断言 300→450(协调者承载禁自问+上抛契约,用户裁决 A-3)
- 实测:49/49 + check 绿;模拟停摆点全链用户侧验证

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

## 0.6.0 — 2026-08-31

- 迭代7 中文命名与需求背景可见(project-20260830):
  - project_register 新增可选 id 入参(显式英文 slug),title 自由中文;纯中文 title 未提供 id 拒收并提示(不引入拼音依赖);混合 title 维持 slugify 向后兼容。新增 slugifyStrict 纯函数。
  - MANUAL_TEXT/intake persona 增「中文 title + 英文 slug id」二元组登记纪律。
  - project-hub:view=file 白名单加 REQUIREMENT.md;看板新增「需求」tab(inline markdown 渲染)+ 列表/详情英文 id 辅显。
