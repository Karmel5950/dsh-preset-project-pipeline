## [0.18.1] - 2026-09-05

审计执行凭证机制化(kr-audit-voucher 交付;背景:sediment-r1 事件暴露——角色声称「审计轮已跑 13 条发现」时,唯一核验手段是主线程人肉考古会话历史,且考古脚本本身还有字段路径陷阱(差点误判)。核验依赖人肉 = 不可扩展)。

- **project_audit(action=run) 执行后自动写审计执行凭证(project-registry)**:
  - 凭证形状 `{ id, type:'audit-run-voucher', ts, findings, actions, deduped, callerSessionId, returnHash }`(threshold? 仅当有阈值时,当前 run 无阈值故省略)。
  - **0 actions 也写凭证**——「跑了但无事发生」与「没跑」可区分(unsupported-degradation 纪律的机制化承载)。
  - 凭证 id = `audit-run-voucher-<stamp>`(stamp = ts 去 `[:.]`),可被结项包/门禁引用;主线程核验=比对凭证 vs 会话记录,机械可查。
  - pwsh/直写绕过工具的路径天然无凭证,绕行即裸奔可见(顺带堵住 0.18.0 期间直写重建类行为)。
- **returnHash(project-lib 只增不改,零 npm import)**:
  - `canonicalStringify`(递归排序对象键的稳定序列化)/ `sha256Hex`(node 内置 crypto SHA-256)/ `returnHashOf`(工具返回体摘要)。
  - 序列化口径=canonicalStringify,同返回体重放哈希一致(AC2)。
- **flows/sediment-flow.json**:harvest 注记同步为 workspace 修正版(显式点名 project_audit + project_harvest、禁止 pwsh/直写绕行、0 actions 也要记录)——workspace 覆盖版已在线上生效,本次落进源码随版本固化。
- **MANUAL_TEXT 工具速查补 project_audit 凭证句**(文本不含 {{template}} 变量,prompt-render-template-var-guard)。
- 版本 0.18.0 → **0.18.1(patch)**:修复(审计核验依赖人肉)+ 凭证。
- 测试:project-lib 增 `canonicalStringify`/`sha256Hex`/`returnHashOf` 纯函数单测(稳定序列化/同值同串/同返回体重放哈希一致);project-registry 增 AC1(凭证字段完整 + 0 actions 也写凭证)与 AC2(哈希可复算)单测。覆盖仓库全部相关测试文件(selftest-must-cover-repo-test-files),新增逻辑分支均有 happy path 测试(test-coverage-happy-path)。
- **AC3 真机(r4)**:部署后真实跑一轮 project_audit,凭证出现且哈希与会话记录一致,由用户侧 blocking 执行;流水线只做单测/桩预演核对。
- 触点:presets/project-pipeline/(project-lib.mjs、project-registry.mjs、flows/sediment-flow.json、test/、package.json、CHANGELOG)→ **r2 交付 deliverables/ + APPLY.md** + **r3 deploy 至 IN SYNC + 重启**(重启窗口并入攒批)。

## [0.18.0] - 2026-09-04

批量沉淀机制:每 N 项交付触发专门沉淀流程(kr-sediment-batch 交付;背景:0.15.0 设计的「harvest 顺带跑一轮 project_audit」是 MANUAL_TEXT 纪律,连续四次 harvest 跳过,自主审计飞轮转不起来——AC5 见证(无人工输入的自主立项)始终无法发生。用户决策:放弃每次沉淀,改为批量触发)。

- **计数触发(project-lib 只增不改,零 npm import)**:
  - `SEDIMENT_TITLE_PREFIX`(「沉淀」,登记惯例,非判定依据)/ `DEFAULT_SEDIMENT_THRESHOLD`(10)/ `SEDIMENT_FLOW_TEMPLATE`(sediment-flow)/ `SEDIMENT_TRIGGER_MESSAGE`(「已达沉淀阈值 N,须登记沉淀项目」)。
  - `isSedimentProject`(**按 flowRef 识别**:flowRef 以 sediment-flow 开头即沉淀项目;title 前缀「沉淀」不作为判定依据——真机探针教训:title「沉淀机制探针 1/2」曾按 title 前缀被误判为沉淀项目成为锚点导致计数归零永不触发)/ `lastSedimentRegistrationAt`(最近沉淀登记 createdAt 锚点,同 flowRef 口径)/ `countDeliveredSinceSediment`(自最近沉淀登记以来 delivered 数,从 REGISTRY 派生,沉淀自身不计)/ `hasActiveOrParkedSediment`(防重复触发)/ `sedimentThresholdMet`(满 N 触发/未满不触发/防重复/并发边界)。
  - `DEFAULT_AUDIT_META` 增 `sedimentation:{enabled:true, everyNDelivered:10}`;`validateAuditRules` 校验 meta.sedimentation 形状(enabled 布尔 + everyNDelivered 正整数);`normalizeSedimentation` 归一化(缺省/非法回退默认)。
- **advance-to-delivered 触发指令(project-registry)**:结项时实时读 audit-rules.json meta 段 sedimentation(免部署生效,AC3),扫全部 REGISTRY 调 `sedimentThresholdMet`;触发 → 返回值携带 `sediment:{triggered:true,enabled,count,threshold,message}`(代码层浮现,非 MANUAL_TEXT)。**开关**:enabled=false → 代码层短路不产生登记指令(计数继续累计,从 REGISTRY 派生,重新开启后 count>=N 下一次交付即触发)。防重复触发(active/parked 已有沉淀项目不重登)+ 并发只触发一次(登记沉淀项目后后续 advance 不再触发)。读容错(registry-halfwrite-read-tolerance):触发检测失败非致命,不阻断结项。
- **ADVANCE_OUTPUT_SCHEMA 增可选 `sediment`**(sedimentTriggerSchema);render 结项分支增触发指令提示。
- **flows/sediment-flow.json**:沉淀流程模板(复用 lite-flow 结构 + 沉淀职责 note,避免 flow schema 变更);沉淀职责=跑 project_audit 审计轮、失败模式聚合、按 harvest-merge/lesson-lifecycle 纪律整固 lesson 库、回顾审计规则与消费路由、落库+留痕。
- **MANUAL_TEXT 增「批量沉淀机制」小节** + 工具速查/工具 description 补触发句(文本不含 {{template}} 变量,prompt-render-template-var-guard)。
- 版本 0.17.1 → **0.18.0(minor)**:批量沉淀触发机制 = 能力新增。
- 测试:project-lib 增沉淀纯函数单测(常量钉死/isSedimentProject/lastSedimentRegistrationAt/countDeliveredSinceSediment/hasActiveOrParkedSediment/sedimentThresholdMet 满 N happy path/未满/防重复/并发边界/阈值回退);project-registry 增 advance-to-delivered 触发单测(满 N happy path/未满/防重复/audit-rules 缺失回退默认/非结项不携带/MANUAL_TEXT 断言);prompt-render 增 MANUAL_TEXT 含「批量沉淀机制」断言。覆盖仓库全部相关测试文件(selftest-must-cover-repo-test-files),新增逻辑分支均有 happy path 测试(test-coverage-happy-path)。
- **AC2 真机 + AC5 见证(r4)**:交付满 N 个后沉淀项目自动登记并跑完整流程、审计轮产出留痕,由用户侧 blocking 执行(用户侧按 FORM §7);流水线只做单测/桩预演核对。
- 触点:presets/project-pipeline/(project-lib.mjs、project-registry.mjs、flows/sediment-flow.json、test/、package.json)→ **r2 交付 deliverables/ + APPLY.md** + **r3 deploy 至 IN SYNC + 重启**(重启窗口并入攒批)。

## [0.17.1] - 2026-09-04

### Fixed
- **persona 编译上限 1000 → 1060**(MAX_COMPILED_PERSONA):长 entity slug(如 F2 自主立项 r-lesson-storm-mtmc1gb4,24 字符)的 readings 头编译实测 1009,超限阻断协调者 spawn,自动项目「出生即冻结」。300→450→700→1000→1060 渐进史延续;触发场景与数字写入常量注释。verify-c4c 与 roles 测试阈值同步。

# CHANGELOG 建议条目(kr-toolface-audit · 0.17.0)

> 本文件为版本 bump 建议文案,供用户侧并入 `presets/project-pipeline/CHANGELOG.md`。

## [0.17.0] - 2026-09-04

角色工具面一致性审计(kr-toolface-audit 交付;背景:kr-p4-route 事故——roles allow 有
project_harvest 而 per-role 行没有,现有测试测不出,因为两集各自 ⊆ 真实面仍成立)。

- **L1 vs L2 交叉核对(核心缺口)**:`checkL1vsL2` 纯函数——roles/*.json tools.allow vs
  agent.cordis.yml per-role 行 config.toolFilter.allow 逐字比对。命中 kr-p4-route 类漂移
  (roles 有而 per-role 行无 → 角色实际调不起)与反向漂移(per-role 行有而 roles 无 →
  白名单授予未声明工具)。两集各自 ⊆ 真实面仍成立时,本核对仍能命中。
- **L2 vs L3 / L1 vs L3 核对提取为可复用纯函数**:`checkL2vsL3`(白名单引用真实面不存在
  工具 → spawn 被拒)、`checkL1vsL3`(roles 引用真实面不存在工具)、`checkForbidden`
  (bash/web_fetch/通用 subagent/subagent_fork)。
- **统一核对入口 `auditToolface`**:输入 roles 清单 + agent.cordis.yml 文本 + 真实工具面,
  输出结构化漂移报告(哪层 vs 哪层、缺哪个工具、方向=declared-extra/real-missing/
  real-extra/forbidden)+ 按层对聚合 + L4 冻结语义。纯函数便于单测构造漂移样本。
- **L4 spawn 冻结语义文档化**:`TOOLFACE_FREEZE_SEMANTICS` 常量——白名单唯一承重路径 =
  per-role 行 toolFilter.allow;改白名单须重 spawn,resume 不生效;fork 携带 fork 行
  toolFilter。
- **核对入口脚本化(AC3)**:`toolface-audit.mjs` 入口脚本,`--preset` 指定 preset 目录,
  `--real-surface` 注入运行时真实工具面,`--json` 结构化输出(供 harvest/审计回路调用),
  退出码 0=无漂移 / 1=有漂移(供 CI)。
- 版本 0.16.0 → **0.17.0(minor)**:工具面一致性核对入口 = 能力新增。
- 测试:新增 `test/toolface-audit.test.mjs`(15 例:解析 happy path、L1vsL2 逐类命中
  (kr-p4-route 根因/反向/整面缺失)、L2vsL3/L1vsL3/forbidden、auditToolface 干净样本
  happy path + 漂移聚合、L4 冻结语义文档化、常量完整性)。覆盖仓库全部相关测试文件
  (selftest-must-cover-repo-test-files),新增逻辑分支均有 happy path 测试
  (test-coverage-happy-path)。
- **AC2 真机 + AC4 见证(r4)**:真实环境跑一轮(已知漂移清零或显式列出剩余漂移)+ 全量
  测试绿 + deploy IN SYNC,由用户侧 blocking 执行;流水线只做单测/静态核对。
- 触点:presets/project-pipeline/(project-lib.mjs、scripts/、test/、package.json)→
  **r2 交付 deliverables/ + APPLY.md** + **r3 deploy 至 IN SYNC + 重启**(重启窗口并入攒批)。

# Changelog

本 preset 的全部显著变更记录在此文件。

## [0.16.0] - 2026-09-04

验收路由前置化(kr-accept-route 交付;背景:同类 test-env/acceptance-capability 卡点「流水线角色无真实会话/主线程手段,真机验证须用户侧 blocking」已重复 ≥5 次,每次重新裁决一个恒定答案(r4),且发现时机不稳定——早则 clarify、晚则 build 后期返工一整轮)。

- **验收路由声明前置到 clarify**:凡 AC 依赖真机会话 / 视觉浏览器验收 / 部署重启 / 真实上游凭据的,clarify 阶段即声明「用户侧 blocking」,进 SPEC AC 对照表,delivery-gate 机械核对,不再依赖中途卡点上报与事后引用裁决。
- **project-lib 只增不改(零 npm import)**:
  - `ACCEPTANCE_TRIGGER_CLASSES`(四类真机触发类:real-session/visual-browser/deploy-restart/real-upstream-credential)与 `ACCEPTANCE_ROUTES`(model-verifiable/user-blocking)。
  - `parseAcceptanceRouting(specText)`:解析 SPEC 头部 front-matter 的 `acceptance-routing` 结构化字段(每行 `AC-id: route` 或 `AC-id: route|trigger`;结构化字段机械核对更稳,不用 markdown 表 regex)。
  - `validateAcceptanceRouting(entries)`:校验 AC 对照表路由声明——trigger ∈ 四类触发类时 route 必须 user-blocking(r4 语义:真机项由用户侧 blocking 执行,不得以静态放行替代)。
- **delivery-gate 机械核对(project-registry)**:delivery-gate present 时读 SPEC.md 解析 acceptance-routing,调 `validateAcceptanceRouting` 校验;缺声明 / 错路由(trigger 类未声明 user-blocking)→ 拒绝呈递。非 delivery-gate 门禁不受影响。
- **flow 模板 note 增补**:standard-flow / iteration-flow 的 clarify 与 delivery-gate 阶段 note 增补 acceptance-routing 要求(模板仅影响新项目,存量零影响)。
- **MANUAL_TEXT 增「验收路由前置化」小节** + 工具速查/工具 description 补 delivery-gate 机械核对句(文本不含 {{template}} 变量,prompt-render-template-var-guard)。
- 版本 0.15.0 → **0.16.0(minor)**:验收路由前置化机制 = 能力新增。
- 测试:project-lib 增 `parseAcceptanceRouting`/`validateAcceptanceRouting` 单测(四类触发类各一 happy path、缺声明/错路由拒绝、解析非法拒绝);project-registry 增 delivery-gate 机械核对单测(合法 SPEC 通过 / 缺 acceptance-routing 拒绝 / 错路由拒绝 / 非 delivery-gate 不受影响);prompt-render 增 MANUAL_TEXT 含「验收路由前置化」断言。覆盖仓库全部相关测试文件(selftest-must-cover-repo-test-files),新增逻辑分支均有 happy path 测试(test-coverage-happy-path)。
- **AC2 真机 + AC5 见证(r4)**:部署后真实项目 clarify 产出 AC 对照表、delivery-gate 机械核对,由用户侧 blocking 执行;流水线只做单测/静态核对。
- 触点:presets/project-pipeline/(project-lib.mjs、project-registry.mjs、flows/、test/、package.json)+ pipeline-ws/.dsh-library/flows/lite-flow.json → **r2 交付 deliverables/ + APPLY.md** + **r3 deploy 至 IN SYNC + 重启**(重启窗口并入攒批)。

## [0.15.0] - 2026-09-03

自省审计回路:非用户需求的自我优化第一版(kr-self-audit 交付;背景:用户战略批评"watcher 五代全部用户驱动,流水线零自主优化",第一代"非用户需求的自我优化"由观察 → 规则表判定 → 三档分流实现,闭环仍走完整流水线,门禁停摆是用户否决点)。

- **project-lib 只增不改(零 npm import)**:
  - 观察原语 O1~O6 纯函数:O1 watcher 日志(路径经 `DEFAULT_WATCH_LOG` + plugindevRoot 推导,现环境 `plugindev/pipeline-watch.log` 可得;退出频次/事件分布/WS 断连/静默断链;全不可得 → `status:'unsupported'` 兜底)/ O2 BUDGET.runtime-events token 分布与异常 / O3 REGISTRY 门禁 pending 时长 + blockers category 频次(复用 `collectAllBlockers`/`aggregateByCategory`)/ O4 lessons-index 同类 category 计数(≥3 = 机制缺陷未修候选)/ O5 toolkit 实文件 vs 文档差集(含 deprecated)/ O6 audit-trail 前次发现状态;每条发现带 evidence(文件路径+行/条目/时间戳,可回放)。
  - 规则表引擎:`validateAuditRules`(schema 校验,act∈F1/F2/F3)/ `auditTerritoryWhitelist`(领地白名单硬边界)/ `auditRuleEngine`(匹配规则产分流动作;规则表含 act:F4 或对 F1 客体(flow/角色提示词)升权 F2 → 引擎拒绝报错=AC1)/ `auditDedupe`(by-category/by-target)/ `auditRateLimit`(F2 上限 2 + meta 冷却期 30 天 + 至多一条)。
  - 分流 payload:`buildF2Payload`(title 前缀「自省立项」+ reason evidence 链 + auto:true)/ `buildF1Payload`(发现+evidence+建议)/ `buildF3Payload`(直改动作+before+after+evidence)。
  - 观察读容错:`readJsonRetry`(瞬时半写读容错 registry-halfwrite-read-tolerance)。
- **project_audit 独立工具**:action=run(观察 → 引擎 → 去重限频 → 三档分流;F2 走 `project_register` auto:true / F1 呈递报告 / F3 直改留痕)/ action=status(查审计留痕);写 `.dsh-library/audit-trail.json`(append-only)。触发 = harvest 顺带(结项后跑一轮)+ 手动入口。
- **audit-rules.json**(workspace 级,规则归用户):初始三条示例规则 R-lesson-storm(act:F2)/ R-gate-slow(act:F1)/ R-doc-drift(act:F2)+ meta 段(`metaRuleChangeCooldownDays:30 / maxAutoProjectsPerAudit:2 / lastMetaActionAt:null`)。
- **MANUAL_TEXT 增「自省审计回路」小节** + 工具速查补 project_audit 条目(文本不含 {{template}} 变量,prompt-render-template-var-guard)。
- 版本 0.14.0 → **0.15.0(minor)**:新工具 + 观察原语 + 规则引擎 = 能力新增。
- 测试:新增 `test/project-audit.test.mjs`(AC1/AC4 及 AC2/AC3 单测部分:payload 形状、证据链可回放性、去重限频、领地硬边界 act:F4/升权 F2 拒绝、O1~O6 happy path)+ `project-lib.test.mjs`/`project-registry.test.mjs` 同步增补;覆盖仓库全部相关测试文件(selftest-must-cover-repo-test-files),新增逻辑分支均有 happy path 测试(test-coverage-happy-path)。
- **AC2/AC3 真机 + AC5 见证(r4)**:真实会话观察自动立项/呈递/直改,以及无人工输入窗内自主立项一单,由用户侧 blocking 执行;O1 须以 supported 状态运行产出真实发现(现环境日志可得,不得以 unsupported 交差)。
- 触点:presets/project-pipeline/(project-lib.mjs、project-registry.mjs、test/、package.json)+ pipeline-ws/.dsh-library/audit-rules.json → **r2 交付 deliverables/ + APPLY.md** + **r3 deploy 至 IN SYNC + 重启**(重启窗口并入攒批)。

## [0.14.0] - 2026-09-03

parked 退出通道:暂存项目可取消(kr-parked-exit 交付;背景:kr-entity-mutex 真机验证中探针 parked 后无法 reject 终止,「parked 进得去出不来」,登记纪律「探针类 parked:true + 验证后 reject 终止」兑现不了)。

- **project_advance 新增 parked 取消通道**:parked 项目经 `project_advance(projectId, cancel:true, reason)` → `state=rejected`(终态语义与既有 rejected 一致)+ `updatedAt` 刷新 → journal 记取消理由 → 返回终态(`cancelled:true, state:'rejected'`)。登记簿保留(审计可查),**id 不释放复用**。
- **reason 必填**:非空字符串,缺失/空白拒绝且不落盘(AC1 前置)。
- **非 parked 项目调用 cancel 一律拒绝**(active/delivered/rejected,仅限 parked)。
- **取消触发 budget 结算联动 collect**(幂等+非致命,与结项一致尝试)。
- **工具 schema**:project_advance 增 `cancel`/`reason` 入参;`ADVANCE_OUTPUT_SCHEMA.state` enum 增 `rejected`、增可选 `cancelled`;render 增取消分支。
- **MANUAL_TEXT 增补**:「工具速查」project_advance 条目补「或 cancel:true 取消(parked→rejected,终态,reason 必填)」;「暂存区 parked 语义(机制4)」新增「**取消通道(kr-parked-exit)**」句,状态机校验句补 `activate/cancel`。
- 版本 0.13.0 → **0.14.0(minor)**:parked 直接终止通道落地 = 能力新增。
- 测试:project-registry 72→**77**(新增 parked cancel AC1/AC1 前置/AC2/AC3 happy path/MANUAL_TEXT 断言 5 例)。preset 全量 165→**170** 例,lib+registry 106/106 绿;`verify-c4c` 通过;prompt-render AC7-①(manual section 注册)通过(AC7-②③④ 依赖真实 dsh-runtime,真实仓库绿)。
- **AC3 真机验证(r4)**:真实实例上对滞留探针 `cn-probe`、`kr-entity-mutex-probe` 执行 cancel → state=rejected + journal 记理由 + 看板移出暂存区 = 用户侧 blocking 执行,流水线只做单测/静态核对。
- 触点:presets/project-pipeline/(project-registry.mjs、MANUAL_TEXT、test/)→ **r2 交付 deliverables/ + APPLY.md** + **r3 deploy 至 IN SYNC + 重启**(重启窗口并入攒批)。

## [0.13.0] - 2026-09-03

entity 底座互斥显式化:隐式触点显式化(kr-entity-mutex 交付;背景:项目间并发靠触点声明互斥,但触点只覆盖显式文件路径;`.dsh-base/<entity>/` 是跨项目隐式共享写,同 entity 两个 active 项目并行迭代会竞争写同一底座)。

- **entity 互斥检测纯函数(project-lib 只增不改,零 npm import)**:
  - `entityTouchpoint(workspaceDir, entitySlug)` = baseDossierPaths(隐式触点路径,与「资源触点互斥声明」的显式文件路径同级)。
  - `entityConflictActive(candidateEntity, registries)` = 同 entity active 互斥检测;`entitySlugOf` 缺省=registry.id(legacy 天然互异、不冲突,25 存量项目零影响)。
- **project_register 登记时冲突检测**:对同 entity active 项目做互斥检测——命中且非 parked → **明确拒绝**(不静默并行),错误信息列出冲突项目与候选方案(等空出/parked 排队/project_block 排序);parked 登记 = 显式排队放行,回执带 `entityConflict` 冲突信号。不同 entity / legacy 放行(回归不变)。
- **project_advance(activate:true) 激活时冲突检测**:parked→active 激活前对同 entity active 项目(排除自身)做互斥检测,命中 → **明确拒绝激活**,须待 entity 空出或经用户裁决后再激活;无冲突则正常激活,回执带 `entityConflict(conflict:false)`。
- **REGISTER_OUTPUT_SCHEMA / ADVANCE_OUTPUT_SCHEMA** 增可选 `entityConflict`(实体形状 entityConflictSchema)。
- **MANUAL_TEXT 增补**:「资源触点互斥声明(机制1)」补 entity 一等触点维度句;「暂存区 parked 语义(机制4)」补激活冲突检测句;工具速查/工具 description 同步。
- 版本 0.12.0 → **0.13.0(minor)**:entity 触点显式化 + 冲突检测落地 = 能力新增。
- 测试:project-lib 28→**34**(新增 entityTouchpoint 断言隐式触点==底座路径、entityConflictActive 同/异 entity/parked/legacy/非法输入 6 例);project-registry 67→**72**(新增 Register 冲突拒绝/不同 entity 放行/legacy 回归、Activate 冲突拒绝/无冲突激活 5 例)+ 既有同 entity 模板测试改为 parked 排队并断言冲突信号。preset 全量 154→**165** 例,lib+registry 106/106 绿;`verify-c4c` 通过;prompt-render AC7-①(manual section 注册)通过。
- **AC5 真机验证(r4)**:真实 register/activate 双同 entity 项目端到端行为 = 用户侧 blocking 执行,流水线只做单测/静态核对。
- 触点:presets/project-pipeline/(project-lib.mjs、project-registry.mjs、MANUAL_TEXT、test/)→ **r2 交付 deliverables/ + APPLY.md** + **r3 deploy 至 IN SYNC + 重启**(重启窗口并入攒批)。

## [0.12.0] - 2026-09-02

成本计量 v2:统一 token 口径与模型来源(kr-cost-v2 交付;背景:预算账本 tokens(外层)与 uncachedInput+output(明细)双口径混用、projcache 无 model 字段、无单一权威总消耗公式)。

- **统一总 token 口径(totalToken,单一权威)**:project-lib 新增纯函数 `totalToken(usage) = uncachedInputTokens + cacheReadTokens + outputTokens`(non-number→0,不含 cacheWrite);「预算上报纪律」规定所有外层/明细/查询的"总 token"一律走该纯函数,严禁第二套公式(AC-R1)。legacy `tokens` 字段保留仅 read 兼容,不再作展示/查询总消耗口径。新增 `cacheRate` 纯函数 = cacheRead/(cacheRead+uncachedInput)(cacheRead≤0/分母0→0)。
- **model 来源落地(D1,AC-R3)**:A 路 `project_budget commit(source=runtime-events,usage 缺省)` 自动填桶扩四桶 + `model`/`provider`,来源 = 上报会话 agent 路由(`agent.options.{provider,model}` / `session.requestHeader().config.{provider,model}`),可选经 `ctx.get('llm')?.resolveModelInfo(provider,model)` 规范名增强(try/catch 降级原始路由串);**取不到一律显式 `model:'unknown'`**,严禁伪造/静默缺省(命中 unsupported-degradation)。B 路 `advance` 联动 collect 从被移除的 A 路条目按 session carry-forward 溯源并入角色桶;无溯源 → `'unknown'`;**禁止用协调者自身路由冒充角色桶**。
- **D4 兼容归一(AC-R2)**:BUDGET committed usage 只增 `cacheReadTokens?/cacheWriteTokens?/model?/provider?`,存量条目缺字段按 0/null/'unknown' 兼容读,不重写/不迁移既有字段。project-lib 新增 `normalizeUsage`(任意旧/新形状→六桶+model+provider)、`modelLabel`('unknown' 哨兵)、`aggregateByModel`(按 model 分组聚合)。
- **外层展示承载于工具输出(D3)**:`project_budget get` 的 totals 增 `totalToken`/`byModel`/`cacheRate`/`byRoleTotal`;`project_status` 单项目详情 project.budget 增 `totalToken` 与按 role 的 `byRoleTotal` 展开。看板渲染侧(host-plugins/project-hub)**本轮不触**。budgetTotalsSchema/budgetSnapshotSchema 扩展。
- **MANUAL_TEXT 增补**:「统一总 token 口径与缓存率」「model 来源说明」两小节 + 工具速查/预算上报纪律同步。
- 版本 0.11.0 → **0.12.0(minor)**:统一 token 口径 + model 来源 + 按 model 分组 = 能力新增。
- 测试:project-lib 22→28 / project-registry 62→67(preset 全量 153 例 + verify-c4c ALL_PASS)。既有注册/commit/collect 断言随 usage 扩展同步更新(selftest-must-cover-repo-test-files)。model happy path/unknown 兜底/carry-forward/totals 统一口径均有断言。
- **AC-R7 真机验证(r4)**:三层输出(BUDGET/看板/查询)正确性 = 用户侧 blocking 执行,流水线只做单测/静态核对。
- 触点:presets/project-pipeline/(project-lib.mjs、project-registry.mjs、MANUAL_TEXT、test/)→ **r2 交付 deliverables/+APPLY.md** + **r3 deploy 至 IN SYNC + 重启**(重启窗口并入攒批,与 kr-p4-route 合并一次重启)。

## [0.11.0] - 2026-09-02

记忆治理·消费路由优先(kr-p4-route 交付;背景:lessons/rulings 无代码消费=死档案,治理没人读的库没有意义——先路由后治理)。

- **lessons-index.json 消费路由索引**:category → 篇目/前提/状态/hits,由 harvest 维护;新增 project_harvest 工具(action=rebuild-index 扫 .dsh-library/lessons+patterns 读元数据归类重建索引保留 hits;action=bump-hits 引用递增)作为 harvest 阶段确定性维护入口。存量 31 篇(lessons 27 + patterns 4)已全量归类(7 category)
- **product 五维分析插消费路由步骤**:roles/product.json persona 增「查底座 + lessons-index 再下结论」(维度与 category 天然同构);readings 增 lessons-index.json/rulings.json。coordinator 派活提示带相关 lessons 引用,readings 增 lessons-index
- **rulings 增强(只增不改)**:每条增 negative-premises(何种情形不命中)与 basis(机制版本锚:preset 版本/日期,harvest 复查提示);matchRuling 否定面逻辑单测锁定
- **BLOCKER_CATEGORIES 开放**:封闭枚举改为「核心集 + .dsh-library/categories.json 扩展」(workspace 级,用户可自增免部署免重启);resolveBlockerCategories 单一权威(project-lib),registry 不再维护独立枚举消除双份漂移;project_block 的 category schema 放开为 type:string 运行时合并集校验;存量 other 历史 blocker 不动
- **lessons/patterns 元数据**:31 篇头部 front-matter(origin/category/premises/status)
- **prompt-render 渲染闸门测试(AC7)**:test/prompt-render.test.mjs 四断言——mock ctx 调 apply() 捕获 manual section 注册;从 dsh-agent-loop 源码动态提取生产注册变量集;真实 dsh-system-prompt renderPrompt 渲染 MANUAL_TEXT 不抛错;含 {{base}} 字面量的事故样本必须抛 unknown prompt variable(2026-09-02 v0.10.0 事故的回归闸)
- **agent.cordis.yml**:subagent_coordinator 行 allow 补 project_harvest
- 版本 0.10.0 → **0.11.0(minor)**:新工具 + categories 开放 + 索引 = 能力新增
- 测试:project-lib 22 / project-registry 62 / project-p4 13(新)/ project-harvest 4(新)/ prompt-render 4(新)/ project-roles 23 / project-delete-guard 14 全绿;verify-c4c ALL_PASS=true(coordinator 931)

## [0.10.0] - 2026-09-01

项目底座层 Base Dossier(kr-p1-base 交付;背景:实体仓每迭代"五遍读书重导入税"——跨迭代上下文无处安放,角色每次进场全量重读)。

- **实体仓底座 Base Dossier**:新增工作区级目录 `<workspace>/.dsh-base/<entitySlug>/`(与 .dsh-library 平级,entitySlug 过卫兵),四件套 MAP.md(模块地图)/ DECISIONS.md(决策日志,append-only)/ RUNBOOK.md(运行手册,命令级)/ STATE.md(状态快照,带 last-verified 戳),跨迭代存活、增量维护。project-lib 增 `baseDossierPaths`/`baseDossierExists`/`entitySlugOf` 纯函数
- **REGISTRY.entitySlug(schemaVersion 1→2 只增)**:缺省=项目自身;25 存量项目无 entitySlug 视为 legacy,零影响。`assertRegistry` 兼容 schemaVersion ∈ {1,2}(C3:读旧登记簿不报错、写回不迁移);project_status 单项目详情增 entitySlug
- **project_register 增 entity 入参**:entity-slug(缺省=项目自身);entity 已有底座 → 回执 baseDossier.exists=true;没有 → draftNeeded=true 且 clarify 阶段 produces 扩展底座初稿四件套(流程数据表达,不加新阶段类型);回执增 baseDossier{entity,path,exists,draftNeeded}
- **role manifest 增 readings 段**:路径模板数组(支持 {{base}}/{{project}} 变量);validateRole 只增校验;compileSubagent 展开为"进场必读"头前置到 persona;编译后 persona(头+正文)超 MAX_COMPILED_PERSONA(1000,C4a)在 role_show 编译期报错;role_show 给 projectId 时输出展开后的 readings 路径清单。六角色 readings 定案(coordinator 精简为 6 条,C4b:REGISTRY/FLOW/SUMMARY + STATE/MAP/DECISIONS;其余五角色按 DESIGN §6.2)
- **iteration-flow 模板**:纯数据进 preset 默认库(prelude(work:coordinator,读底座+上轮 STATE→增量更新)→ lite 主体(clarify→build→test→delivery-gate→wrap)→ harvest(work:更新底座 STATE/DECISIONS));阶段类型全在既有 work/gate/summary 内,不加新词
- 版本 0.9.0 → **0.10.0(minor)**:底座 + entity + readings + iteration-flow = 能力新增
- 测试:project-lib 增 entitySlugOf/baseDossierPaths/baseDossierExists/validateReadings/expandReadings/compileReadingsHeader 单测;project-registry 增 entity 登记(有/无底座)、schemaVersion=2+entitySlug、C3 兼容(读旧 1 不报错、写回不破坏未修改字段、不升 schemaVersion);project-roles 增 readings 编译/超限报错/role_show readings 输出;存量测试全量通过(register schemaVersion 断言 1→2 同步更新)

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
