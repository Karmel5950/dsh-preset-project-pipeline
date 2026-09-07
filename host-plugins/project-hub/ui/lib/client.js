// 浏览器半面:手写的 dsh 客户端插件包(经 window.__ModuleLoader__ 装载)。
// 「项目中心」看板 —— 把 project-pipeline 的文件制登记簿变成 web 界面可见的项目中心。
// 三处挂点(用户定案,project-pipeline DESIGN §6 证据):
//   1) sidebar.footer.action —— 侧栏底部动作区入口,点击打开全幅浮层看板;
//   2) shell.overlay —— 全幅浮层看板主体(项目列表 + 单项目详情 + 预算聚合);
//   3) settings.plugin.item —— 设置页「插件配置」卡(扫描根目录配置)。
// 数据全部经宿主面插件 project-hub.mjs 的自有 HTTP 通道
//   GET/PUT /plugins/project-hub/api(同源 fetch,拉取式,无推送)。
// 待裁决门禁(pendingGate)在列表上醒目提示(徽章 + 高亮),提示用户去裁决。
// 零构建:plain JS + React.createElement;卡片/浮层 chrome 用一次性注入的
// <style>(hover/focus 等伪类无法内联),字段样式沿用内联 + 设计 token。
// zh/en 双语(对齐 lan-access 先例)。
// 中文可用化迭代(project-hub-i2):数据层裸显英文全部经 zh/en 字典映射为中文
// 白话(带兜底回退 + 悬停 title 对照原始 id);预算详情改人话逐行(含 usage.note
// 次级展示);进度显示 第N/M步;详情页信息头 + 待裁决门禁警示块;浮层头部刷新
// 按钮 + 15 秒自动刷新;「查看全文」改指后端 view=file 端点。
// 视觉美化迭代(project-hub-i3):样式全量 token 化(间距五档 4/8/12/16/24、三级
// 排版、状态语义色、卡片质感、空态/加载态、内联 SVG 图标);列表卡片三级主次 +
// meta 分组;详情五节编号图标锚点 + 分隔线;工作区汇总条核心数字突出;待裁决
// 徽章改 AA 可读变体(state-warn-label 深色警示文字 + 边框/字重/图标补足醒目);
// 卡片 hover 阴影用 var(--dsw-shadow-lv1)(token 缺失时自动退化为无阴影)。
// markdown 渲染迭代(project-hub-i4):总结节不再裸显 markdown 源码,新增手写轻量
// markdown 解析器 parseMarkdown(纯函数,不依赖 React/window/t/闭包,Node 可测)+
// renderMarkdownAst 渲染器 + .dshph_md* 样式。子集:标题(#/##/###)、段落、无序/
// 有序列表、引用、分隔线、表格、加粗、斜体、行内代码、链接;排除围栏代码块、
// 嵌套列表、任务列表、图片、HTML、删除线、自动链接(按纯文本兜底,不抛错)。
// 视觉迭代 5(project-hub-i5):视觉方向切 B-zhi 纸感排版语言(暖白纸底 #faf9f7 系
// + 衬线中文标题系统宋体栈 + 正文无衬线 + 杂志排版节号/发丝规则线 + 徽章小型印章/
// 标签感浅底深字 AA);详情区六大块改 tab 分组(进度/预算/记录/总结,记录=门禁+日志),
// 信息头不进 tab、待裁决警示块常显、tab 为纯前端受控状态(React useState)、各 tab
// 面板保持挂载(切换为纯展示 display 切换,不 refetch、不卸载);浮层宽度适配(居中
// 限宽内容列 + 响应式收缩:衬线标题字号 clamp、杂志网格 subsec 2列→1列、steps 2列→
// 1列、列表改杂志索引式单栏通栏行);窄容器无横向溢出(overflow-wrap:anywhere +
// min-width:0);markdown 表格窄容器 overflow-x:auto(仅渲染失败才降级纯文本)。
// 用户两点带入:①正文/辅文/徽章字号红线 ≥13px 不得破;②markdown 表格窄容器溢出
// 备选(降级纯文本)只允许渲染失败时启用,正常优先 overflow-x 滚动。
// D1 修订(i5-test 缺陷):语义/状态色(ok/warn/info 及 bg/line 变体、待裁决行强调色)
// 改 var(--dsw-alias-state-*, <hex兜底>),随宿主主题变化;纸感局部色板(--dshph-*:
// 纸底/暖灰/发丝线/朱砂)维持自包含 hex 不改(B-zhi 审美核心)。
// 深色版本迭代(project-hub-i6):新增深色皮肤 + 看板跟随 DSH 宿主颜色主题自动切换。
//   R1 深色皮肤:body[data-ds-dark-theme] .dshph_overlay 内重定义局部 --dshph-* 色板
//       为墨纸感深色变体(近黑底 #151517 系 + 低对比 hairline + 文字四级避开纯黑纯白
//       + 色度收敛),保留 B-zhi 衬线标题/杂志网格/印章徽章基因,不做成 A-mo 琥珀编辑器风。
//   R2 主题跟随:宿主解析后实际主题落在 <body data-ds-dark-theme> 属性(已核实),CSS
//       选择器命中即切换局部色板,无需 JS 监听/刷新;token 缺失时 --dshph-* 深/浅态
//       hex 兜底,无白屏/崩布局。
//   R3 已知限制清理:formatTime 纯函数(ISO→YYYY-MM-DD HH:mm 本地时区)用于详情页
//       updatedAt;usageDetail 的 note 与 tokens 间加「 · 」分隔;侧栏节标签去重
//       (门禁 cap→历次裁决、日志 cap→推进记录、总结 cap→markdown 已渲染)。
//   R5 列表排序:sortProjects 纯函数(active 置顶,其余含 rejected 按 updatedAt 倒序),
//       BoardOverlay 渲染前排序;纯前端,project-hub.mjs 不动,无需重启。
//   R6 流程进度单列:.dshph_steps 恒单列 grid-template-columns:1fr。
//   R4 不回归:4 tab、信息头/警示块常显、切换不丢状态、中文映射、预算人话、
//       markdown 渲染、刷新、view=file、字号红线 ≥13px 全部保留。
// 迭代7(project-hub-i7,2026-08-30 中文命名与需求背景可见):
//   - 新增第 5 个「需求」tab:懒取 view=file&name=REQUIREMENT.md(text/plain),复用
//     parseMarkdown/renderMarkdownAst/.dshph_md* inline 渲染,缓存不 refetch(符合 i5
//     约定);大文件由 overlayBody overflow:auto 滚动;字号红线 ≥13px 照旧。
//   - 降级路径(用户 C3):后端白名单未放行或 fetch 失败时「需求」tab 显示「暂无需求」/
//     错误态,不白屏、不影响其余 4 tab。
//   - 列表/详情 id 辅显:列表名称单元格中文 title 下方加小号 muted id(.dshph_cName
//     .dshph_id,font-size 13px,ink3 色,overflow-wrap:anywhere);详情信息头 meta 行加
//     id 前缀(项目 <id> · 迭代 N · 进度 · 更新时间)。id 仍是唯一键,双处辅显保证
//     「不可隐藏到找不到」,同时中文 title 为主视觉。
// 迭代8(project-hub-i8,2026-08-31 搜索/筛选 + 归档/置顶写路径):
//   - 纯函数(不依赖 React/window/t,Node 可测):applyBoardView(合并 boardView 的
//     pinned/archived 标记)、filterProjects(搜索 title/id 大小写不敏感 + 状态筛选
//     AND + 归档可见性)、applyBoardChange(乐观更新幂等 set/clear)、sortProjects 扩展
//     (用户置顶 > active 置顶,置顶间 updatedAt 倒序)。
//   - 搜索/筛选为纯前端受控状态(React useState),不触发 refetch(AC-S4/F3/C1/C2)。
//   - 归档/置顶:乐观更新 + 写端点落盘(PUT board 载荷);失败回滚 + writeFailed 提示。
//   - 列表节头新增工具条:搜索框(× 清空)+ 状态筛选 chips(active/delivered/rejected/
//     parked 多选)+ 「已归档」toggle;空态「无匹配项目」+ 清空指引(AC-E1/E2)。
//   - 行内操作按钮(置顶/归档)stopPropagation 不触发行点击导航。
// 迭代9(project-hub-i8-fix,2026-08-31 已归档功能缺陷修复):
//   - 缺陷一(逻辑洞):状态筛选不再静默吞掉归档项目。filterProjects 归档可见性拆两态
//     (archivedOnly 排他 / revealArchived 并入);新增 countHiddenArchivedMatches 统计
//     「被归档隐藏且匹配当前筛选」的项目数,空态/受限态提示「另有 N 个已归档项目被隐藏」
//     + 一键显示(并入当前筛选),不静默吞(A1/A2/A3)。
//   - 缺陷二(语义):「已归档」chip 改排他筛选(点=只剩归档项目),与四态 chip 互斥
//     (点状态 chip 取消已归档,反之亦然),并带计数徽章「已归档 (N)」(B1/B2/B3)。
//   - 缺陷三(可达性):筛「已归档」后归档行可见,行上「取消归档」可达可点;取消后按
//     状态/排序规则回主列表正确位置(C1/C2)。
//   - 纯前端,数据层(project-hub.mjs/REGISTRY/board-view.json)不动;改动仅限 client.js。
// 0.8.0(预算账本改真实 token 计量,2026-08-31):
//   - 预算列/预算 tab/工作区汇总呈现真实 token 总量(totalTokens = runtime-events 数值求和)。
//   - byRole[role] 形状改 { count, tokens }(roleCountsText 兼容);工作区汇总加 sharedOnce。
//   - 新增 i18n 键 totalTokens/sharedOnce(zh/en 双语)。纯前端,数据层由 project-hub.mjs 提供。
window.__ModuleLoader__.load({
	id: "dsh-project-hub-ui",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");

		const API_ROUTE = "/plugins/project-hub/api";
		const NS = "projectHub";
		const SLOT_SIDEBAR = "sidebar.footer.action";
		const SLOT_OVERLAY = "shell.overlay";
		const SLOT_SETTINGS = "settings.plugin.item";
		const AUTO_REFRESH_MS = 15000;

		const zh = {
			"title": "项目中心",
			"description": "项目流水线看板:一览全部项目的状态、迭代、当前阶段、待裁决门禁与预算。",
			"open": "打开项目中心",
			"close": "关闭",
			"back": "返回列表",
			"loading": "加载中…",
			"error": "项目中心数据加载失败。",
			"empty": "扫描根下暂无项目。",
			"emptyHint": "可在设置 → 插件配置中调整扫描根目录",
			"state.active": "推进中",
			"state.delivered": "已交付",
			"state.rejected": "已拒绝",
			"state.parked": "暂存",
			"stagingArea": "暂存区",
			"stagingAreaHint": "已入册暂存,未激活;激活走 project_advance(activate:true)",
			"iteration": "迭代",
			"stage": "当前阶段",
			"pendingGate": "待裁决门禁",
			"pendingGateHint": "此项目有门禁等待裁决",
			"budget": "预算",
			"estimate": "估算",
			"cap": "上限",
			"committed": "已上报",
			"totals": "合计",
			"byRole": "按角色",
			"bySource": "按来源",
			"workspace": "工作区汇总",
			"projectCount": "项目数",
			"committedEntryCount": "上报条目数",
			"summary": "总结",
			"summaryFull": "查看全文",
			"flow": "流程",
			"gates": "门禁",
			"journals": "日志",
			"verdict.approve": "批准",
			"verdict.revise": "打回",
			"verdict.reject": "拒绝",
			"noSummary": "暂无总结",
			"noBudget": "暂无预算",
			"scanRoot": "扫描根目录",
			"apply": "应用",
			"applying": "应用中…",
			"applied": "已生效,扫描范围已更新。",
			"invalidPath": "路径不存在或不是目录。",
			"configHint": "扫描根目录(绝对路径);默认=会话工作区。改后热生效,无需重启。",
			"configError": "配置读写失败,改动未保存。",
			"expand": "展开设置",
			"collapse": "收起设置",
			"errorProject": "该项目解析失败",
			// ── 中文可用化迭代新增键 ──────────────────────────────────────
			"stageType.work": "工作",
			"stageType.gate": "门禁",
			"stageType.summary": "总结",
			"stageType.internalize": "内化",
			"role.product": "产品",
			"role.architect": "架构",
			"role.dev": "开发",
			"role.tester": "测试",
			"role.deliverer": "交付",
			"role.coordinator": "协调者",
			"source.self-report": "自报",
			"source.runtime-events": "运行时事件",
			"source.billing-plugin": "计费插件",
			"stageId.clarify": "需求澄清",
			"stageId.spec-gate": "需求规格确认",
			"stageId.design": "架构设计",
			"stageId.mid-summary": "中期总结",
			"stageId.design-gate": "设计与UX评审",
			"stageId.build": "开发实现",
			"stageId.test": "测试验收",
			"stageId.accept": "产品验收",
			"stageId.delivery-gate": "交付验收",
			"stageId.wrap": "结项总结",
			"stageId.harvest": "经验内化",
			"error.missing-registry": "缺登记簿",
			"error.malformed-registry": "登记簿损坏",
			"error.malformed-flow": "流程文件损坏",
			"error.malformed-budget": "预算文件损坏",
			"error.unreadable": "不可读",
			"usageKey.calls": "调用次数",
			"usageKey.tokens": "tokens",
			"usageKey.files": "文件数",
			"usageKey.tests": "测试数",
			"usageKey.testsPassed": "通过测试",
			"usageKey.commits": "提交数",
			"usageKey.acVerified": "验收数",
			"usageKey.criticalPathChecks": "关键路径检查",
			"usageKey.criticalPathPassed": "关键路径通过",
			"progressPrefix": "第",
			"progressSep": "/",
			"progressSuffix": "步",
			"notSet": "未设置",
			"refresh": "刷新",
			"refreshFailed": "刷新失败,显示的是上次数据",
			"updatedAt": "更新时间",
			"readOnlyGateHint": "看板只读,请到接待会话完成裁决(批准/打回/拒绝)",
			"pendingGateSummary": "门禁摘要",
			"budgetEntry": "上报条目",
			// ── 视觉迭代 5(i5)新增键:tab 化 + 杂志列表标签 ────────────────
			"tab.progress": "进度",
			"tab.budget": "预算",
			"tab.records": "记录",
			"tab.summary": "总结",
			"project": "项目",
			"progress": "进度",
			"projectList": "项目列表",
			"stateLegend": "状态",
			"budgetSummary": "汇总",
			"entryUnit": " 条",
			// ── 0.8.0 真实 token 计量新增键 ────────────────────────────────
			"totalTokens": "真实token",
			"sharedOnce": "共享会话",
			// ── kr-board-time-token 新增键:时间线 + token 可读化 ────────────
			"startTime": "开始时间",
			"endTime": "结束时间",
			"duration": "耗时",
			"token": "token",
			"presentedAt": "呈递",
			"decidedAt": "裁决",
			// ── 深色版本迭代(i6)新增键:侧栏节标签去重 ────────────────────
			"gateHistory": "历次裁决",
			"journalCap": "推进记录",
			"summaryCap": "markdown 已渲染",
			// ── 迭代7(i7)新增键:需求 tab + id 辅显 ───────────────────────
			"tab.requirement": "需求",
			"requirementCap": "原始需求与背景",
			"noRequirement": "暂无需求",
			"requirementError": "需求加载失败",
			// ── 迭代8(i8)新增键:搜索/筛选/归档/置顶 ─────────────────────
			"search.placeholder": "搜索项目标题或 id",
			"search.clear": "清空搜索",
			"filter.state": "状态",
			"filter.archived": "已归档",
			"action.pin": "置顶",
			"action.unpin": "取消置顶",
			"action.archive": "归档",
			"action.unarchive": "取消归档",
			"noMatch": "无匹配项目",
			"noMatchHint": "可清空搜索或筛选后查看全部",
			"pinned": "已置顶",
			"archived": "已归档",
			"writeFailed": "操作失败,请重试",
			// ── 迭代9(i8-fix)新增键:已归档缺陷修复 ────────────────────────
			"filter.archivedHidden": "另有",
			"filter.archivedHiddenUnit": "个已归档项目被隐藏",
			"filter.showArchived": "显示已归档",
			// ── kr-control-plane 新增键:流水线设置 tab(块 A 策略 + 块 B 模型)──
			"tab.board": "项目列表",
			"tab.settings": "流水线设置",
			"settings.blockA": "策略编辑",
			"settings.blockB": "每角色模型",
			"settings.vouchers": "沉淀凭证",
			"settings.sedimentation": "沉淀开关",
			"settings.everyNDelivered": "沉淀阈值(每 N 个交付)",
			"settings.rules": "规则表",
			"settings.ruleId": "规则 id",
			"settings.ruleName": "规则名",
			"settings.ruleObserve": "观察",
			"settings.ruleAct": "动作",
			"settings.ruleObject": "对象",
			"settings.ruleDedupe": "去重",
			"settings.ruleTerritory": "领地",
			"settings.ruleMeta": "meta",
			"settings.ruleWhen": "when(JSON)",
			"settings.ruleRecommendation": "建议",
			"settings.addRule": "新增规则",
			"settings.deleteRule": "删除",
			"settings.meta": "meta 段(JSON)",
			"settings.save": "保存",
			"settings.saving": "保存中…",
			"settings.saved": "已保存,免部署生效。",
			"settings.saveFailed": "保存失败:",
			"settings.role": "角色",
			"settings.provider": "provider",
			"settings.model": "model",
			"settings.source": "来源",
			"settings.source.workspace": "工作区覆盖",
			"settings.source.preset": "预设声明",
			"settings.source.default": "默认继承",
			"settings.contextHint": "architect/product 读大 SPEC,须配大窗模型;小窗模型不得配给读大 SPEC 的角色。",
			"settings.voucherId": "凭证 id",
			"settings.voucherHash": "哈希",
			"settings.voucherTs": "时间",
			"settings.noVouchers": "暂无沉淀凭证",
			"settings.loadFailed": "设置加载失败。",
			"settings.rulings": "既定裁决(只读)",
			"settings.categories": "卡点类别(只读)",
			"settings.readonlyHint": "以下为只读展示,改动仍走文件。",
			// ── kr-control-plane-i2 新增键:两模块设置面板(分区导航 + 沉淀策略 + 每角色模型)──
			"settings.nav.sedimentation": "沉淀策略",
			"settings.nav.roles": "每角色模型",
			"settings.sedimentationHint": "每交付 N 个项目后自动登记一个沉淀项目",
			"settings.everyNDeliveredHint": "每交付 N 个后触发",
			"settings.thresholdInvalid": "沉淀阈值须为 ≥1 的整数。",
			"settings.roleDuty.architect": "读大规格文档、写技术设计,读得多,建议大窗口",
			"settings.roleDuty.product": "读需求/规格、写可行性分析,读得多,建议大窗口",
			"settings.roleDuty.dev": "写实现代码、读设计文档,中等",
			"settings.roleDuty.tester": "跑单测/核对、读验收标准,中等",
			"settings.roleDuty.deliverer": "打包/写交付说明,轻量",
			"settings.roleDuty.coordinator": "派活/汇总/推进,读各阶段产出,中等",
			"settings.currentModel": "当前模型:",
			"settings.modifyModel": "修改模型",
			"settings.cancel": "取消",
			"settings.restoreDefault": "恢复默认",
			"settings.restoreConfirm": "确认将「{role}」恢复为默认模型(deepseek-v4-flash:0731)?",
			"settings.selectModel": "选择模型",
			"settings.modelWarn": "模型变更影响成本与上下文窗口,请确认。",
			"settings.modelsUnavailable": "模型清单不可用",
			"settings.noModels": "暂无已配置模型,请先在 dsh 设置中配置。",
			"settings.notInList": "不在清单",
			// ── 0.4.1 新增键:保存落点提示 / 未保存徽章 / 零项目 scanRoot 警示 ──
			"settings.saveLocationHint": "保存落点:{root}\\.dsh-library\\roles\\<角色>.json。该根须与流水线工作区一致,否则流水线角色读不到此覆盖。",
			"settings.unsaved": "未保存:改动须点「保存」才落盘,直接关闭面板会丢弃。",
			"empty.scanRootLabel": "当前扫描根目录:",
			"empty.scanRootHint": "扫描根目录下未发现任何项目。若流水线项目登记在其他工作区,请到 设置 → 插件 → 插件配置 → project-hub「扫描根目录」改为项目所在目录,保存后重开看板。",
		};
		const en = {
			"title": "Project Hub",
			"description": "Project pipeline board: state, iteration, current stage, pending gates and budget for every project.",
			"open": "Open Project Hub",
			"close": "Close",
			"back": "Back to list",
			"loading": "Loading…",
			"error": "Failed to load Project Hub data.",
			"empty": "No projects under the scan root.",
			"emptyHint": "Adjust the scan root in Settings → Plugin config",
			"state.active": "Active",
			"state.delivered": "Delivered",
			"state.rejected": "Rejected",
			"state.parked": "Parked",
			"stagingArea": "Staging area",
			"stagingAreaHint": "Registered but not activated; activate via project_advance(activate:true)",
			"iteration": "Iteration",
			"stage": "Current stage",
			"pendingGate": "Pending gate",
			"pendingGateHint": "This project has a gate awaiting your decision",
			"budget": "Budget",
			"estimate": "Estimate",
			"cap": "Cap",
			"committed": "Committed",
			"totals": "Totals",
			"byRole": "By role",
			"bySource": "By source",
			"workspace": "Workspace summary",
			"projectCount": "Projects",
			"committedEntryCount": "Committed entries",
			"summary": "Summary",
			"summaryFull": "View full",
			"flow": "Flow",
			"gates": "Gates",
			"journals": "Journals",
			"verdict.approve": "Approved",
			"verdict.revise": "Revised",
			"verdict.reject": "Rejected",
			"noSummary": "No summary",
			"noBudget": "No budget",
			"scanRoot": "Scan root",
			"apply": "Apply",
			"applying": "Applying…",
			"applied": "Applied — scan scope updated.",
			"invalidPath": "Path does not exist or is not a directory.",
			"configHint": "Scan root (absolute path); defaults to the session workspace. Changes take effect immediately without a restart.",
			"configError": "Failed to read/write config; change not saved.",
			"expand": "Show settings",
			"collapse": "Hide settings",
			"errorProject": "This project failed to parse",
			// ── 中文可用化迭代新增键 ──────────────────────────────────────
			"stageType.work": "Work",
			"stageType.gate": "Gate",
			"stageType.summary": "Summary",
			"stageType.internalize": "Internalize",
			"role.product": "Product",
			"role.architect": "Architect",
			"role.dev": "Dev",
			"role.tester": "Tester",
			"role.deliverer": "Deliverer",
			"role.coordinator": "Coordinator",
			"source.self-report": "Self-report",
			"source.runtime-events": "Runtime events",
			"source.billing-plugin": "Billing plugin",
			"stageId.clarify": "Clarify",
			"stageId.spec-gate": "Spec gate",
			"stageId.design": "Design",
			"stageId.mid-summary": "Mid summary",
			"stageId.design-gate": "Design & UX review",
			"stageId.build": "Build",
			"stageId.test": "Test",
			"stageId.accept": "Accept",
			"stageId.delivery-gate": "Delivery gate",
			"stageId.wrap": "Wrap",
			"stageId.harvest": "Harvest",
			"error.missing-registry": "Missing registry",
			"error.malformed-registry": "Malformed registry",
			"error.malformed-flow": "Malformed flow",
			"error.malformed-budget": "Malformed budget",
			"error.unreadable": "Unreadable",
			"usageKey.calls": "Calls",
			"usageKey.tokens": "Tokens",
			"usageKey.files": "Files",
			"usageKey.tests": "Tests",
			"usageKey.testsPassed": "Tests passed",
			"usageKey.commits": "Commits",
			"usageKey.acVerified": "AC verified",
			"usageKey.criticalPathChecks": "Critical path checks",
			"usageKey.criticalPathPassed": "Critical path passed",
			"progressPrefix": "Step ",
			"progressSep": "/",
			"progressSuffix": "",
			"notSet": "Not set",
			"refresh": "Refresh",
			"refreshFailed": "Refresh failed; showing previous data",
			"updatedAt": "Updated",
			"readOnlyGateHint": "Board is read-only; please complete the decision (approve/revise/reject) in the intake session",
			"pendingGateSummary": "Gate summary",
			"budgetEntry": "Committed entries",
			// ── 视觉迭代 5(i5)新增键:tab 化 + 杂志列表标签 ────────────────
			"tab.progress": "Progress",
			"tab.budget": "Budget",
			"tab.records": "Records",
			"tab.summary": "Summary",
			"project": "Project",
			"progress": "Progress",
			"projectList": "Project list",
			"stateLegend": "State",
			"budgetSummary": "Summary",
			"entryUnit": "",
			// ── 0.8.0 真实 token 计量新增键 ────────────────────────────────
			"totalTokens": "Real tokens",
			"sharedOnce": "Shared sessions",
			// ── kr-board-time-token 新增键:时间线 + token 可读化 ────────────
			"startTime": "Start",
			"endTime": "End",
			"duration": "Duration",
			"token": "Token",
			"presentedAt": "Presented",
			"decidedAt": "Decided",
			// ── 深色版本迭代(i6)新增键:侧栏节标签去重 ────────────────────
			"gateHistory": "Gate history",
			"journalCap": "Progress records",
			"summaryCap": "Rendered markdown",
			// ── 迭代7(i7)新增键:需求 tab + id 辅显 ───────────────────────
			"tab.requirement": "Requirement",
			"requirementCap": "Original requirement & background",
			"noRequirement": "No requirement",
			"requirementError": "Failed to load requirement",
			// ── 迭代8(i8)新增键:搜索/筛选/归档/置顶 ─────────────────────
			"search.placeholder": "Search by title or id",
			"search.clear": "Clear search",
			"filter.state": "State",
			"filter.archived": "Archived",
			"action.pin": "Pin",
			"action.unpin": "Unpin",
			"action.archive": "Archive",
			"action.unarchive": "Unarchive",
			"noMatch": "No matching projects",
			"noMatchHint": "Clear search or filters to see all projects",
			"pinned": "Pinned",
			"archived": "Archived",
			"writeFailed": "Action failed, please retry",
			// ── 迭代9(i8-fix)新增键:已归档缺陷修复 ────────────────────────
			"filter.archivedHidden": "There are",
			"filter.archivedHiddenUnit": "more archived projects hidden",
			"filter.showArchived": "Show archived",
			// ── kr-control-plane 新增键:流水线设置 tab(块 A 策略 + 块 B 模型)──
			"tab.board": "Project list",
			"tab.settings": "Pipeline settings",
			"settings.blockA": "Policy editor",
			"settings.blockB": "Per-role model",
			"settings.vouchers": "Sediment vouchers",
			"settings.sedimentation": "Sedimentation",
			"settings.everyNDelivered": "Threshold (every N delivered)",
			"settings.rules": "Rules",
			"settings.ruleId": "Rule id",
			"settings.ruleName": "Name",
			"settings.ruleObserve": "Observe",
			"settings.ruleAct": "Act",
			"settings.ruleObject": "Object",
			"settings.ruleDedupe": "Dedupe",
			"settings.ruleTerritory": "Territory",
			"settings.ruleMeta": "Meta",
			"settings.ruleWhen": "When (JSON)",
			"settings.ruleRecommendation": "Recommendation",
			"settings.addRule": "Add rule",
			"settings.deleteRule": "Delete",
			"settings.meta": "Meta (JSON)",
			"settings.save": "Save",
			"settings.saving": "Saving…",
			"settings.saved": "Saved — takes effect without a restart.",
			"settings.saveFailed": "Save failed:",
			"settings.role": "Role",
			"settings.provider": "Provider",
			"settings.model": "Model",
			"settings.source": "Source",
			"settings.source.workspace": "Workspace override",
			"settings.source.preset": "Preset",
			"settings.source.default": "Default",
			"settings.contextHint": "architect/product read large SPECs and need a large-window model; do not assign a small-window model to roles that read large SPECs.",
			"settings.voucherId": "Voucher id",
			"settings.voucherHash": "Hash",
			"settings.voucherTs": "Time",
			"settings.noVouchers": "No sediment vouchers",
			"settings.loadFailed": "Failed to load settings.",
			"settings.rulings": "Rulings (read-only)",
			"settings.categories": "Blocker categories (read-only)",
			"settings.readonlyHint": "Read-only display; changes still go through files.",
			// ── kr-control-plane-i2 新增键:两模块设置面板 ────────────────────
			"settings.nav.sedimentation": "Sedimentation",
			"settings.nav.roles": "Per-role model",
			"settings.sedimentationHint": "Auto-register a sediment project after every N delivered projects",
			"settings.everyNDeliveredHint": "Triggers after every N delivered",
			"settings.thresholdInvalid": "Threshold must be an integer ≥ 1.",
			"settings.roleDuty.architect": "Reads large specs, writes technical design; reads a lot, large window recommended",
			"settings.roleDuty.product": "Reads requirements/specs, writes feasibility analysis; reads a lot, large window recommended",
			"settings.roleDuty.dev": "Writes implementation code, reads design docs; medium",
			"settings.roleDuty.tester": "Runs tests/checks, reads acceptance criteria; medium",
			"settings.roleDuty.deliverer": "Packages/writes delivery notes; light",
			"settings.roleDuty.coordinator": "Delegates/summarizes/advances, reads stage outputs; medium",
			"settings.currentModel": "Current model:",
			"settings.modifyModel": "Change model",
			"settings.cancel": "Cancel",
			"settings.restoreDefault": "Restore default",
			"settings.restoreConfirm": "Restore \"{role}\" to the default model (deepseek-v4-flash:0731)?",
			"settings.selectModel": "Select model",
			"settings.modelWarn": "Changing the model affects cost and context window; please confirm.",
			"settings.modelsUnavailable": "Model list unavailable",
			"settings.noModels": "No configured models; configure them in dsh settings first.",
			"settings.notInList": "not in list",
			"settings.saveLocationHint": "Save location: {root}\\.dsh-library\\roles\\<role>.json. This root must match the pipeline workspace, otherwise the pipeline will not see the override.",
			"settings.unsaved": "Unsaved: click \"Save\" to persist; closing the panel discards changes.",
			"empty.scanRootLabel": "Current scan root:",
			"empty.scanRootHint": "No projects found under the scan root. If your pipeline projects live in another workspace, set it in Settings → Plugins → project-hub \"Scan root\", save, then reopen the board.",
		};

		const inject = ["slots", "locale", "connection"];

		// ── 看板开合状态(侧栏入口与浮层跨组件共享)────────────────────────────
		const board = { open: false, listeners: new Set() };
		function setBoardOpen(v) {
			board.open = v;
			for (const fn of board.listeners) fn();
		}
		function subscribeBoard(fn) {
			board.listeners.add(fn);
			return () => board.listeners.delete(fn);
		}

		// ── 数据获取(拉取式,无缓存)──────────────────────────────────────────
		function fetchJson(url) {
			return fetch(url).then((r) => r.json());
		}
		function fetchProjects() {
			return fetchJson(API_ROUTE).then((p) => (p.ok ? p.projects : []));
		}
		function fetchBudget() {
			return fetchJson(`${API_ROUTE}?view=budget`).then((p) => (p.ok ? p.budget : null));
		}
		function fetchProject(id) {
			return fetchJson(`${API_ROUTE}?project=${encodeURIComponent(id)}`).then((p) => (p.ok ? p.project : null));
		}
		function fetchConfig() {
			return fetchJson(`${API_ROUTE}?view=config`).then((p) => (p.ok ? p.config : null));
		}
		// 迭代7:取 REQUIREMENT.md 全文(text/plain)。后端白名单未放行(400)或
		// 文件缺失(404)/网络失败 → 返回 null(调用方显示「暂无需求」/错误态,不白屏)。
		function fetchRequirement(id) {
			return fetch(`${API_ROUTE}?view=file&project=${encodeURIComponent(id)}&name=REQUIREMENT.md`)
				.then((r) => (r.ok ? r.text() : null))
				.catch(() => null);
		}
		// 迭代8:取 board view config(GET ?view=board);失败回退空配置(读容错)。
		function fetchBoardView() {
			return fetchJson(`${API_ROUTE}?view=board`).then((p) => (p.ok && p.board ? p.board : { items: {} }));
		}
		// 迭代8:写归档/置顶(PUT board 载荷)。返回 { ok, board };网络失败 → { ok:false }。
		function writeBoardView(id, change) {
			return fetch(API_ROUTE, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ board: Object.assign({ id }, change) }),
			}).then((r) => r.json()).catch(() => ({ ok: false }));
		}
		// kr-control-plane:流水线设置数据获取与写(块 A 策略 + 块 B 模型)。
		function fetchSettings() {
			return fetchJson(`${API_ROUTE}?view=settings`).then((p) => (p.ok && p.settings ? p.settings : null));
		}
		// kr-control-plane-i2(C-A):拉取 dsh 已配置模型清单(view=models 只读端点)。
		// ok:false(模型清单不可用)→ null;ok:true → models 数组(可能为空)。
		function fetchModels() {
			return fetchJson(`${API_ROUTE}?view=models`).then((p) => (p.ok ? p.models : null));
		}
		// kr-control-plane-i2(C-D 护栏):UI 写 audit-rules.json 读-改-写——只动
		// meta.sedimentation,rules[] 原样透传,不得整体覆盖清掉 rules[]。
		// 浏览器内置等价实现(权威副本在 project-hub.mjs 的 applySedimentationChange,
		// project-hub.test.mjs 断言 AC-B3)。
		function applySedimentationChange(current, nextSedimentation) {
			var next = JSON.parse(JSON.stringify(current && typeof current === "object" && !Array.isArray(current)
				? current : { schemaVersion: 1, meta: {}, rules: [] }));
			if (!next.meta || typeof next.meta !== "object" || Array.isArray(next.meta)) next.meta = {};
			next.meta.sedimentation = JSON.parse(JSON.stringify(nextSedimentation && typeof nextSedimentation === "object" && !Array.isArray(nextSedimentation)
				? nextSedimentation : {}));
			return next;
		}
		function writeAuditRules(auditRules) {
			return fetch(API_ROUTE, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ settings: { auditRules } }),
			}).then((r) => r.json()).catch(() => ({ ok: false }));
		}
		// AC-R2 修复:结构化沉降控件(spinbutton everyNDelivered / checkbox enabled)显示值
		// 保存时须 reconcile 进最终 PUT 载荷;权威副本在 project-hub.mjs 的
		// reconcileSedimentation(project-hub.test.mjs 断言),本处为浏览器内置等价实现。
		// dirtyKeys 为本次会话中被用户改过的沉降键:命中 → 结构化真值覆盖 JSON 文本面,
		// 未命中 → 保留 JSON 文本面(metaText 直编路径不回退)。
		function reconcileSedimentation(parsedMeta, structuredSed, dirtyKeys) {
			var meta = JSON.parse(JSON.stringify(parsedMeta && typeof parsedMeta === "object" ? parsedMeta : {}));
			if (!structuredSed || typeof structuredSed !== "object") return meta;
			(Array.isArray(dirtyKeys) ? dirtyKeys : []).forEach(function (key) {
				if (Object.prototype.hasOwnProperty.call(structuredSed, key)) {
					if (!meta.sedimentation || typeof meta.sedimentation !== "object") meta.sedimentation = {};
					meta.sedimentation[key] = structuredSed[key];
				}
			});
			return meta;
		}
		function writeRoleModel(role, provider, model) {
			return fetch(API_ROUTE, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ settings: { roleModel: { role, provider, model } } }),
			}).then((r) => r.json()).catch(() => ({ ok: false }));
		}
		// C3 恢复默认(卡点 b1 裁决方案 A):移除 workspace 覆盖,回退默认档。
		// 返回 { ok, settings:{ roleModel:{ role, reset:true, source } } };source 为 reset 后
		// 的真实来源(preset 声明或默认继承),由服务端计算。
		function resetRoleModel(role) {
			return fetch(API_ROUTE, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ settings: { roleModel: { role, reset: true } } }),
			}).then((r) => r.json()).catch(() => ({ ok: false }));
		}
		// 0.4.1:角色卡未保存判定(纯函数,Node 可测)。draft 与服务端已存状态不一致 → true。
		// saved 为 settings.roles 条目(provider/model 可能为 null);draft 为角色卡草稿(字符串)。
		function isRoleDraftDirty(saved, draft) {
			const sp = saved && typeof saved === "object" && typeof saved.provider === "string" ? saved.provider : "";
			const sm = saved && typeof saved === "object" && typeof saved.model === "string" ? saved.model : "";
			const dp = draft && typeof draft === "object" && typeof draft.provider === "string" ? draft.provider : "";
			const dm = draft && typeof draft === "object" && typeof draft.model === "string" ? draft.model : "";
			return dp !== sp || dm !== sm;
		}

		// ── 展示辅助 ─────────────────────────────────────────────────────────
		// 宿主 locale t() 对未知键返回键本身,「返回值 === 请求键」视作未命中(回退原始值)。
		function lookup(t, key, fallback) {
			const v = t(key);
			return typeof v === "string" && v !== "" && v !== key ? v : fallback;
		}
		function stateLabel(state, t) {
			return lookup(t, `state.${state}`, state);
		}
		function verdictLabel(v, t) {
			return lookup(t, `verdict.${v}`, v);
		}

		// ── 中文映射辅助(未命中回退原始值;悬停 title 由调用处传原始值)────────
		function mapStageType(type, t) { return lookup(t, `stageType.${type}`, type); }
		function mapRole(role, t) { return lookup(t, `role.${role}`, role); }
		function mapSource(key, t) { return lookup(t, `source.${key}`, key); }
		function mapStageId(id, t) { return lookup(t, `stageId.${id}`, id); }
		function mapError(cat, t) { return lookup(t, `error.${cat}`, cat); }
		function mapUsageKey(key, t) { return lookup(t, `usageKey.${key}`, key); }
		function mapJournalName(filename, t) {
			const m = /^([0-9]+)-(.+)\.md$/.exec(filename);
			if (!m) return filename;
			return `${m[1]} · ${mapStageId(m[2], t)}`;
		}

		// ── 进度文本:第N/M步(zh)/Step N/M(en);M 缺失/0 → 省略 M ────────────
		function progressText(stageIndex, stageCount, t) {
			const n = (typeof stageIndex === "number" ? stageIndex : 0) + 1;
			const m = typeof stageCount === "number" && stageCount > 0 ? stageCount : null;
			if (m === null) return `${t("progressPrefix")}${n}${t("progressSuffix")}`;
			return `${t("progressPrefix")}${n}${t("progressSep")}${m}${t("progressSuffix")}`;
		}

		// ── 时间格式化(i6 R3.1):ISO 串 → YYYY-MM-DD HH:mm(本地时区)──────────
		// 纯函数,不依赖 React/window/t,Node 可测。无效/缺失输入返回 null(调用处
		// 回退 t("notSet"))。
		function formatTime(iso) {
			if (iso === null || iso === undefined || iso === "") return null;
			const d = new Date(iso);
			if (isNaN(d.getTime())) return null;
			const p = (n) => String(n).padStart(2, "0");
			return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
		}

		// ── token 格式化(kr-board-time-token R1):逗号分组 + M/B 缩写阈值切换 ──
		// 纯函数,不依赖 React/window/t,Node 可测。
		// n < 1e6 → 逗号分组;1e6 ≤ n < 1e9 → M 缩写(1 位小数去尾零);n ≥ 1e9 → B 缩写。
		// 非有限数/非数字 → "—"。悬浮 title 用 tokenTitle 保留精确逗号值。
		function trimZero(s) {
			return s.endsWith(".0") ? s.slice(0, -2) : s;
		}
		// 自包含(不依赖外部 trimZero),可被 client.test.mjs 的 extractFunction 提取单测。
		// 1 位小数用截断(非四舍五入),保证 999,999,999 → "999.9M"(未达 B 阈值)。
		function formatToken(n) {
			if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return "—";
			if (n < 1e6) return n.toLocaleString("en-US");
			if (n < 1e9) {
				const s = (Math.floor((n / 1e6) * 10) / 10).toFixed(1);
				return (s.endsWith(".0") ? s.slice(0, -2) : s) + "M";
			}
			const s = (Math.floor((n / 1e9) * 10) / 10).toFixed(1);
			return (s.endsWith(".0") ? s.slice(0, -2) : s) + "B";
		}
		// 悬浮 title 用:精确逗号分组值;非有限/非数字 → undefined(不设 title)。
		function tokenTitle(n) {
			return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString("en-US") : undefined;
		}

		// ── 耗时格式化(kr-board-time-token R3/R4/R5):ms → 人话 ──────────────
		// 纯函数,不依赖 React/window/t,Node 可测。
		// 判定链:<1分→不足1分;<1小时→X分;<1天→X小时Y分;≥1天→X天Y小时。
		// 整小时省略「0分」;整天省略「0小时」。非有限/非数字/≤0 → "—"。
		function formatDuration(ms) {
			if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "—";
			if (ms < 60000) return "不足1分";
			if (ms < 3600000) return Math.floor(ms / 60000) + "分";
			if (ms < 86400000) {
				const h = Math.floor(ms / 3600000);
				const m = Math.floor((ms % 3600000) / 60000);
				return h + "小时" + (m > 0 ? m + "分" : "");
			}
			const d = Math.floor(ms / 86400000);
			const h = Math.floor((ms % 86400000) / 3600000);
			return d + "天" + (h > 0 ? h + "小时" : "");
		}

		// ── 阶段 token 聚合(kr-board-time-token R4):按 stageId 聚合 committed ──
		// 纯函数,不依赖 React/window/t,Node 可测。
		// 对 source==='runtime-events' 且 usage 含数值 token 的条目按 stageId 求和;
		// self-report 无数值求和 → 0。返回 { stageId: tokens }。
		function stageTokenTotals(committed) {
			const out = {};
			if (!Array.isArray(committed)) return out;
			for (const entry of committed) {
				if (entry === null || typeof entry !== "object") continue;
				if (typeof entry.stageId !== "string") continue;
				if (entry.source !== "runtime-events") continue;
				if (typeof entry.usage?.tokens !== "number" || !Number.isFinite(entry.usage.tokens)) continue;
				out[entry.stageId] = (out[entry.stageId] ?? 0) + entry.usage.tokens;
			}
			return out;
		}

		// ── 列表排序(i6 R5 + 机制4 暂存区 + 迭代8 用户置顶)──────────────────
		// active 置顶,其余(含 rejected)按 updatedAt 倒序;state=parked 项目单独一组
		// (暂存区),不参与 active 排序。迭代8:用户置顶(pinned=true)排最前,置顶间按
		// updatedAt 倒序;parked 组内同样 pinned 优先。
		// 纯函数,不依赖 React/window,Node 可测。updatedAt 缺失按 0 处理(组内末尾)。
		// 返回 { active, parked }:active=主列表;parked=暂存区。
		function sortProjects(projects) {
			if (!Array.isArray(projects)) return { active: [], parked: [] };
			const active = [];
			const parked = [];
			for (const p of projects) {
				if (p.state === "parked") parked.push(p);
				else active.push(p);
			}
			active.sort((a, b) => {
				const aPinned = a.pinned === true;
				const bPinned = b.pinned === true;
				if (aPinned !== bPinned) return aPinned ? -1 : 1;
				const aActive = a.state === "active";
				const bActive = b.state === "active";
				if (aActive !== bActive) return aActive ? -1 : 1;
				const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
				const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
				return bt - at;
			});
			parked.sort((a, b) => {
				const aPinned = a.pinned === true;
				const bPinned = b.pinned === true;
				if (aPinned !== bPinned) return aPinned ? -1 : 1;
				const at = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
				const bt = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
				return bt - at;
			});
			return { active, parked };
		}

		// ── 迭代8(i8):board view 合并 + 搜索/筛选 + 乐观更新 ───────────────
		// 纯函数,不依赖 React/window/t,Node 可测。
		// applyBoardView:把 boardView.items[id].{pinned,archived} 合并进每个 project 项。
		function applyBoardView(projects, boardView) {
			if (!Array.isArray(projects)) return [];
			const items = boardView && typeof boardView === "object" && boardView.items && typeof boardView.items === "object" ? boardView.items : {};
			return projects.map(function (p) {
				const meta = items[p.id] && typeof items[p.id] === "object" ? items[p.id] : {};
				return Object.assign({}, p, { pinned: meta.pinned === true, archived: meta.archived === true });
			});
		}
		// applyBoardChange:乐观更新用,幂等 set/clear 单项目单字段。返回新 board(不修改入参)。
		function applyBoardChange(board, change) {
			const items = board && typeof board === "object" && board.items && typeof board.items === "object" ? Object.assign({}, board.items) : {};
			const cur = items[change.id] && typeof items[change.id] === "object" ? Object.assign({}, items[change.id]) : {};
			if (change.archived !== undefined) cur.archived = change.archived;
			if (change.pinned !== undefined) cur.pinned = change.pinned;
			items[change.id] = cur;
			return { items: items };
		}
		// filterProjects:搜索(title/id 大小写不敏感模糊)+ 状态筛选(AND)+ 归档可见性。
		// 输入应为 applyBoardView 合并后的项目(含 p.archived/p.pinned)。
		// opts = { query(string), states(Set 或数组,空=全量), archivedOnly(bool), revealArchived(bool) }。
		// 归档可见性语义(迭代9 i8-fix 修复缺陷一/二):
		//   - archivedOnly=true:排他筛选,只保留归档项目(「已归档」chip 独占态;状态 chips
		//     已清空,不参与)。满足 B1「点了就该只剩归档的」。
		//   - revealArchived=true:把归档项目并入当前筛选(与未归档同列,受状态/搜索约束)。
		//     缺陷一「一键显示已归档」入口触发,满足 A2。
		//   - 两者皆 false(默认):归档项目隐藏(不静默吞,由 countHiddenArchivedMatches
		//     供空态/受限提示,满足 A1/A3)。
		function filterProjects(projects, opts) {
			if (!Array.isArray(projects)) return [];
			const query = typeof opts.query === "string" ? opts.query.trim().toLowerCase() : "";
			const states = opts.states;
			const archivedOnly = opts.archivedOnly === true;
			const revealArchived = opts.revealArchived === true;
			const hasStateFilter = states && (states instanceof Set ? states.size > 0 : states.length > 0);
			return projects.filter(function (p) {
				if (archivedOnly) {
					if (p.archived !== true) return false;
				} else if (!revealArchived) {
					if (p.archived === true) return false;
				}
				if (!archivedOnly && hasStateFilter) {
					const inStates = states instanceof Set ? states.has(p.state) : states.indexOf(p.state) !== -1;
					if (!inStates) return false;
				}
				if (query.length > 0) {
					const title = String(p.title == null ? "" : p.title).toLowerCase();
					const id = String(p.id == null ? "" : p.id).toLowerCase();
					if (title.indexOf(query) === -1 && id.indexOf(query) === -1) return false;
				}
				return true;
			});
		}
		// countHiddenArchivedMatches:统计「被归档隐藏且匹配当前状态/搜索筛选」的项目数。
		// 缺陷一提示用:当未开已归档(archivedOnly/revealArchived 均 false)且存在被隐藏的
		// 匹配归档项时,空态/列表须提示「另有 N 个已归档项目被隐藏」,不得静默吞。
		// 输入应为 applyBoardView 合并后的项目。opts 同 filterProjects(忽略 archivedOnly/
		// revealArchived,只按 states+query 判定匹配)。
		function countHiddenArchivedMatches(projects, opts) {
			if (!Array.isArray(projects)) return 0;
			const query = typeof opts.query === "string" ? opts.query.trim().toLowerCase() : "";
			const states = opts.states;
			const hasStateFilter = states && (states instanceof Set ? states.size > 0 : states.length > 0);
			let n = 0;
			for (const p of projects) {
				if (p.archived !== true) continue;
				if (hasStateFilter) {
					const inStates = states instanceof Set ? states.has(p.state) : states.indexOf(p.state) !== -1;
					if (!inStates) continue;
				}
				if (query.length > 0) {
					const title = String(p.title == null ? "" : p.title).toLowerCase();
					const id = String(p.id == null ? "" : p.id).toLowerCase();
					if (title.indexOf(query) === -1 && id.indexOf(query) === -1) continue;
				}
				n++;
			}
			return n;
		}
		// countArchived:统计归档项目总数(「已归档」chip 计数徽章用,满足 B3)。
		function countArchived(projects) {
			if (!Array.isArray(projects)) return 0;
			let n = 0;
			for (const p of projects) if (p.archived === true) n++;
			return n;
		}

		// ── 预算人话辅助 ───────────────────────────────────────────────────
		function roleCountsText(byRole, t) {
			if (!byRole || typeof byRole !== "object") return "";
			const parts = [];
			for (const [k, v] of Object.entries(byRole)) {
				// 0.8.0:byRole[role] 为 { count, tokens }(runtime-events 数值求和)。
				// kr-board-time-token(R1):tokens 经 formatToken 可读化。
				if (v && typeof v === "object" && typeof v.count === "number") {
					parts.push(`${mapRole(k, t)}: ${v.count}${v.tokens ? ` (${formatToken(v.tokens)})` : ""}`);
				} else {
					parts.push(`${mapRole(k, t)}: ${v}`);
				}
			}
			return parts.join(" · ");
		}
		function sourceCountsText(bySource, t) {
			if (!bySource || typeof bySource !== "object") return "";
			const parts = [];
			for (const [k, v] of Object.entries(bySource)) parts.push(`${mapSource(k, t)}: ${v}`);
			return parts.join(" · ");
		}
		// estimate/cap 等对象 → 键值对文本(键经 mapUsageKey;note 排除)。
		function usageText(usage, t) {
			if (usage === null || usage === undefined) return t("notSet");
			if (typeof usage !== "object") return String(usage);
			const parts = [];
			for (const [k, v] of Object.entries(usage)) {
				if (k === "note") continue;
				parts.push(`${mapUsageKey(k, t)}: ${v}`);
			}
			return parts.join(" · ");
		}
		// 逐条上报的 usage:对象优先展示 note(次级)+ 其余键值对;标量直接展示;空 → 「—」。
		// i6 R3.2:note 与键值对之间加「 · 」分隔,避免视觉粘连。
		function usageDetail(usage, t) {
			if (usage === null || usage === undefined) return React.createElement("span", { className: "dshph_budgetUsage" }, "—");
			if (typeof usage !== "object") return React.createElement("span", { className: "dshph_budgetUsage" }, String(usage));
			const note = typeof usage.note === "string" && usage.note.length > 0 ? usage.note : null;
			const parts = [];
			for (const [k, v] of Object.entries(usage)) {
				if (k === "note") continue;
				parts.push(`${mapUsageKey(k, t)}: ${v}`);
			}
			const text = parts.join(" · ");
			if (note === null && text.length === 0) return React.createElement("span", { className: "dshph_budgetUsage" }, "—");
			return React.createElement("span", { className: "dshph_budgetUsage" },
				note ? React.createElement("span", { className: "dshph_budgetNote" }, note) : null,
				note && text.length > 0 ? " · " : null,
				text.length > 0 ? React.createElement("span", null, text) : null,
			);
		}
		function budgetTotalsText(totals, t) {
			if (!totals || typeof totals !== "object") return "";
			const parts = [];
			// kr-board-time-token(R2):移除「上报条目数」渲染(committedEntryCount 不再展示)。
			// kr-board-time-token(R1):真实 token 总量经 formatToken 可读化(逗号分组 + M/B 缩写)。
			if (typeof totals.totalTokens === "number" && totals.totalTokens > 0) parts.push(`${t("totalTokens")}:${formatToken(totals.totalTokens)}`);
			if (totals.bySource && typeof totals.bySource === "object") {
				for (const [k, v] of Object.entries(totals.bySource)) parts.push(`${mapSource(k, t)}:${v}`);
			}
			return parts.join(" · ");
		}

		// ── 一次性注入样式(浮层/卡片 chrome;伪类无法内联)──────────────────────
		// 视觉迭代 5(i5):全量迁移到 B-zhi 纸感排版语言。纸感色板用局部 --dshph-*
		// 变量承载(暖白纸底/卡面/暖灰内衬/发丝线/墨字三级/朱砂强调),这些是 B-zhi
		// 审美核心,维持自包含 hex 不改。
		// 语义/状态色(ok/warn/info 及其 bg/line 变体,以及待裁决行强调色)引用
		// dsw-alias state token 并带 hex 兜底(沿用 i3 阴影先例:token 缺失自动退化
		// 为兜底值,无白屏/无布局崩坏)。i6 修正 token 名为宿主实际名:
		//   --dsw-alias-state-success-primary  ← 已交付/成功(ok)
		//   --dsw-alias-state-warn-primary     ← 待裁决/警示(warn)
		//   --dsw-alias-state-business-primary ← 推进中/信息(info)
		// 宿主未定义 -bg/-line 变体 token,故这些恒走 hex 兜底(浅色 B-zhi 浅底深字,
		// 深色深底浅字)。
		// 深色版本迭代(i6):新增 body[data-ds-dark-theme] .dshph_overlay 深色色板
		// 变体(墨纸感,近黑底 + 低对比 hairline + 文字四级避开纯黑纯白 + 色度收敛),
		// 保留衬线/杂志/印章基因,不做成 A-mo 琥珀编辑器风。宿主深色主题时该选择器
		// 命中,局部 --dshph-* 色板切换为深色变体,组件结构/布局规则原样复用。
		// 衬线中文标题用系统宋体栈,正文保持无衬线。杂志排版:节号 + 发丝规则线;
		// 徽章小型印章/标签感(浅底深字 AA)。字号红线:正文/辅文/徽章均 ≥13px(用户带入①)。
		const CSS_TAG = "dsh-project-hub-ui";
		const CSS = [
			// ── 纸感色板与基础(局部变量承载 B-zhi 纸感色板;浅色为默认)────────
			".dshph_overlay{--dshph-paper:#faf9f7;--dshph-card:#fffdf9;--dshph-wash:#f4f0e8;--dshph-line:#e6dfd2;--dshph-line2:#d8cfbd;--dshph-edge:#b8ac93;--dshph-ink:#29241d;--dshph-ink2:#514a3f;--dshph-ink3:#6d6455;--dshph-accent:#a63d2f;--dshph-accent-wash:#f6ebe5;--dshph-tagCur-fg:var(--dshph-card);--dshph-ok:var(--dsw-alias-state-success-primary,#1a5c38);--dshph-ok-bg:#e9f2ea;--dshph-ok-line:#c2dac8;--dshph-warn:var(--dsw-alias-state-warn-primary,#8a4a08);--dshph-warn-bg:#fcefd9;--dshph-warn-line:#e6ca94;--dshph-info:var(--dsw-alias-state-business-primary,#1e4e79);--dshph-info-bg:#e6eef6;--dshph-info-line:#bccfde;--dshph-serif:\"Songti SC\",\"SimSun\",\"STSong\",\"NSimSun\",\"Noto Serif CJK SC\",serif;--dshph-sans:-apple-system,\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",sans-serif;position:fixed;inset:0;z-index:1000;background:var(--dshph-paper);color:var(--dshph-ink2);font:14px/1.75 var(--dshph-sans);-webkit-font-smoothing:antialiased;display:flex;flex-direction:column}",
			// ── 深色色板变体(i6 R1/R2):宿主深色主题时切换局部 --dshph-* 色板 ──
			// 墨纸感:近黑纸底 #151517(对齐宿主深色 bg)、卡面略亮、低对比 hairline、
			// 文字四级避开纯黑纯白、朱砂强调变浅保对比、语义色用深色态浅色变体。
			// 仅重定义色板变量,布局/组件规则继承浅色版(共用结构,不双份维护)。
			"body[data-ds-dark-theme] .dshph_overlay{--dshph-paper:#151517;--dshph-card:#1a1a1d;--dshph-wash:#1f1f24;--dshph-line:rgba(255,255,255,.08);--dshph-line2:rgba(255,255,255,.14);--dshph-edge:rgba(255,255,255,.22);--dshph-ink:#f0f0f2;--dshph-ink2:#dcdde1;--dshph-ink3:#a4a6ae;--dshph-accent:#d97a6a;--dshph-accent-wash:rgba(217,122,106,.12);--dshph-tagCur-fg:#29241d;--dshph-ok:var(--dsw-alias-state-success-primary,#7cc98f);--dshph-ok-bg:rgba(124,201,143,.12);--dshph-ok-line:rgba(124,201,143,.32);--dshph-warn:var(--dsw-alias-state-warn-primary,#e6a23c);--dshph-warn-bg:rgba(230,162,60,.12);--dshph-warn-line:rgba(230,162,60,.32);--dshph-info:var(--dsw-alias-state-business-primary,#85b6dd);--dshph-info-bg:rgba(133,182,221,.12);--dshph-info-line:rgba(133,182,221,.32);--dshph-serif:\"Songti SC\",\"SimSun\",\"STSong\",\"NSimSun\",\"Noto Serif CJK SC\",serif;--dshph-sans:-apple-system,\"Segoe UI\",\"Microsoft YaHei\",\"PingFang SC\",sans-serif}",
			// 侧栏入口
			".dshph_sidebarBtn{appearance:none;width:100%;font:inherit;color:var(--dshph-ink);text-align:left;cursor:pointer;background:0 0;border:0;border-radius:4px;align-items:center;gap:8px;padding:8px 10px;display:flex}",
			".dshph_sidebarBtn:hover{background:var(--dshph-wash)}",
			".dshph_sidebarBtn:focus-visible{outline:2px solid var(--dshph-accent);outline-offset:-2px}",
			".dshph_sidebarIcon{color:var(--dshph-ink3);flex:none;display:inline-flex}",
			".dshph_sidebarText{font-size:13px;line-height:20px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			// 浮层 chrome(衬线标题 + 发丝规则线)
			".dshph_overlayHeader{flex:none;display:flex;align-items:center;gap:12px;padding:16px 24px;border-bottom:1px solid var(--dshph-line2);background:var(--dshph-paper)}",
			".dshph_overlayTitle{font-family:var(--dshph-serif);font-size:22px;font-weight:700;color:var(--dshph-ink);letter-spacing:.08em;flex:1;min-width:0}",
			".dshph_closeBtn{appearance:none;font:inherit;color:var(--dshph-ink2);cursor:pointer;background:transparent;border:1px solid var(--dshph-line2);border-radius:3px;padding:8px 16px;font-size:13px;letter-spacing:.08em;transition:background-color .16s,border-color .16s,color .16s}",
			".dshph_closeBtn:hover{background:var(--dshph-card);border-color:var(--dshph-edge);color:var(--dshph-ink)}",
			".dshph_overlayBody{flex:1;overflow:auto;padding:0}",
			// 居中限宽内容列(对齐设计稿 .page{max-width:1120px;margin:0 auto})
			".dshph_page{max-width:1120px;margin:0 auto;padding:32px 40px 48px;min-width:0}",
			// 节头(杂志排版:节号 + 发丝规则线)
			".dshph_sec{margin-top:40px}",
			".dshph_page > .dshph_sec:first-child{margin-top:0}",
			".dshph_secHead{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;padding-bottom:12px;border-bottom:1px solid var(--dshph-line2)}",
			".dshph_secNo{font-family:var(--dshph-serif);font-size:14px;color:var(--dshph-accent);letter-spacing:.12em}",
			".dshph_secTitle{font-family:var(--dshph-serif);font-size:24px;font-weight:700;color:var(--dshph-ink);letter-spacing:.06em;margin:0}",
			".dshph_secSide{margin-left:auto;font-size:13px;color:var(--dshph-ink3);display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			// 徽章(小型印章/标签感;浅底深字 AA;字号红线 ≥13px)
			".dshph_badge{flex:none;display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:600;line-height:1;letter-spacing:.08em;padding:5px 10px 5px 11px;border-radius:2px;white-space:nowrap}",
			".dshph_badgeIcon{display:inline-flex}",
			".dshph_badgeState{color:var(--dshph-ink2);background:var(--dshph-card);border:1px solid var(--dshph-line2)}",
			".dshph_badgeState[data-state=\"active\"]{color:var(--dshph-info);background:var(--dshph-info-bg);border:1px solid var(--dshph-info-line)}",
			".dshph_badgeState[data-state=\"delivered\"]{color:var(--dshph-ok);background:var(--dshph-ok-bg);border:1px solid var(--dshph-ok-line)}",
			".dshph_badgeState[data-state=\"rejected\"]{color:var(--dshph-warn);background:var(--dshph-warn-bg);border:1px solid var(--dshph-warn-line)}",
			// 暂存(parked)徽章:中性灰蓝,浅底深字 AA,字号 ≥13px(机制4 暂存区)。
			".dshph_badgeState[data-state=\"parked\"]{color:var(--dshph-ink3);background:var(--dshph-wash);border:1px solid var(--dshph-line2)}",
			".dshph_badgePending{color:var(--dshph-warn);background:var(--dshph-warn-bg);border:1px solid var(--dshph-warn-line)}",
			".dshph_badgeCurrent{color:var(--dshph-accent);background:var(--dshph-accent-wash);border:1px solid var(--dshph-accent)}",
			// 汇总条(stat-band:衬线大数字 + 发丝分隔)
			".dshph_workspace{display:flex;align-items:stretch;gap:0;padding:24px 0 8px;flex-wrap:wrap}",
			".dshph_wsStat{display:flex;flex-direction:column;gap:4px;padding:0 40px 8px 0}",
			".dshph_wsStat + .dshph_wsStat{border-left:1px solid var(--dshph-line);padding-left:40px}",
			".dshph_wsStatLabel{font-size:13px;letter-spacing:.18em;color:var(--dshph-ink3)}",
			".dshph_wsStat b{font-family:var(--dshph-serif);font-size:34px;font-weight:400;color:var(--dshph-ink);line-height:1.25}",
			".dshph_wsSub{font-size:13px;color:var(--dshph-ink3);margin-top:10px}",
			// 项目列表(杂志索引式单栏通栏行)
			".dshph_rows{border-top:1px solid var(--dshph-line)}",
			".dshph_row{display:grid;grid-template-columns:40px minmax(200px,1.5fr) 1.15fr .85fr .6fr 1.05fr;gap:20px;align-items:start;padding:20px 16px;border-bottom:1px solid var(--dshph-line);transition:background-color .16s;cursor:pointer}",
			// i6:硬编码浅色 hover 底改 var(--dshph-wash),深色态自动为深灰。
			".dshph_row:hover{background:var(--dshph-wash)}",
			// i6:待裁决行强调色修正 token 名并走 --dshph-warn(深色态浅琥珀兜底)。
			".dshph_row[data-pending=\"true\"]{background:var(--dshph-warn-bg);box-shadow:inset 3px 0 0 var(--dshph-warn)}",
			".dshph_row[data-pending=\"true\"]:hover{background:var(--dshph-warn-bg)}",
			".dshph_row[data-error=\"true\"]{box-shadow:inset 3px 0 0 var(--dshph-warn)}",
			".dshph_idx{font-family:var(--dshph-serif);font-size:14px;color:var(--dshph-ink3);padding-top:20px;letter-spacing:.06em}",
			".dshph_cell{min-width:0}",
			".dshph_cellLabel{display:block;font-size:13px;letter-spacing:.16em;color:var(--dshph-ink3);margin-bottom:6px}",
			".dshph_cellValue{display:block;font-size:14px;color:var(--dshph-ink2);line-height:1.6;overflow-wrap:anywhere;min-width:0}",
			".dshph_cName .dshph_name{display:inline;font-size:17px;font-weight:600;color:var(--dshph-ink);letter-spacing:.01em;overflow-wrap:anywhere;margin-right:10px}",
			".dshph_cName .dshph_badge{margin-right:6px}",
			// 迭代7:列表名称单元格中文 title 下方小号 muted id(字号红线 ≥13px,ink3 色,
			// overflow-wrap:anywhere;display:block 使其独占一行在 title 下方)。
			".dshph_cName .dshph_id{display:block;font-size:13px;color:var(--dshph-ink3);overflow-wrap:anywhere;margin-top:2px}",
			".dshph_cBudget .dshph_cellValue{letter-spacing:.02em}",
			// kr-board-time-token(R3):项目卡片时间行(开始/结束/耗时;次级信息,ink3 小号)。
			".dshph_timeRow{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;color:var(--dshph-ink3);min-width:0;grid-column:1/-1;padding:0 16px 4px}",
			".dshph_timeItem{white-space:nowrap}",
			".dshph_errorLine{font-size:13px;color:var(--dshph-warn)}",
			// 待裁决警示块(常显,不进 tab)
			".dshph_gateWarn{border:1px solid var(--dshph-warn-line);background:var(--dshph-warn-bg);border-radius:4px;padding:12px 16px;display:flex;flex-direction:column;gap:8px;font-size:13px;color:var(--dshph-warn)}",
			".dshph_gateWarn b{color:var(--dshph-warn);font-weight:600}",
			".dshph_gateWarn .dshph_gateSummary{color:var(--dshph-ink2)}",
			".dshph_gateWarn .dshph_gateHint{color:var(--dshph-ink3)}",
			// 详情
			".dshph_detail{display:flex;flex-direction:column;gap:8px}",
			".dshph_backBtn{appearance:none;font:inherit;color:var(--dshph-ink);cursor:pointer;background:transparent;border:1px solid var(--dshph-line2);border-radius:3px;padding:8px 16px;font-size:13px;letter-spacing:.08em;align-self:flex-start;transition:background-color .16s,border-color .16s,color .16s}",
			".dshph_backBtn:hover{background:var(--dshph-card);border-color:var(--dshph-edge)}",
			".dshph_detailHead{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;padding:20px 0 8px}",
			".dshph_detailName{font-size:22px;font-weight:600;color:var(--dshph-ink);letter-spacing:.01em;overflow-wrap:anywhere}",
			".dshph_detailMeta{font-size:13px;color:var(--dshph-ink3);letter-spacing:.03em}",
			// tab 栏(纯前端受控;各面板保持挂载,切换为 display 切换)
			".dshph_tabs{display:flex;gap:4px;border-bottom:1px solid var(--dshph-line2);margin-top:8px}",
			".dshph_tab{appearance:none;font:inherit;font-size:13px;letter-spacing:.08em;color:var(--dshph-ink3);background:transparent;border:0;border-bottom:2px solid transparent;padding:10px 16px;cursor:pointer;transition:color .16s,border-color .16s}",
			".dshph_tab:hover{color:var(--dshph-ink)}",
			".dshph_tab[data-active=\"true\"]{color:var(--dshph-accent);border-bottom-color:var(--dshph-accent);font-weight:600}",
			".dshph_tab:focus-visible{outline:2px solid var(--dshph-accent);outline-offset:-2px}",
			".dshph_tabPanels{display:flex;flex-direction:column}",
			".dshph_tabPanel[data-active=\"false\"]{display:none}",
			// 杂志网格(subsec:边栏标签 + 内容;窄容器单列)
			".dshph_subsec{display:grid;grid-template-columns:180px minmax(0,1fr);gap:16px 48px;padding:28px 0;border-top:1px solid var(--dshph-line)}",
			".dshph_subsecLabel h3{font-family:var(--dshph-serif);font-size:18px;font-weight:700;color:var(--dshph-ink);letter-spacing:.08em;display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0}",
			".dshph_subsecLabel .dshph_cap{display:block;font-size:13px;color:var(--dshph-ink3);letter-spacing:.1em;margin-top:6px}",
			".dshph_subsecBody{min-width:0}",
			// 步骤(i6 R6:恒单列,不再随容器宽度 2列→1列)
			".dshph_steps{display:grid;grid-template-columns:1fr;gap:10px 40px}",
			// kr-board-time-token(R4):阶段行改「主行 + 时间/token 副行」两段式。
			".dshph_step{display:flex;flex-direction:column;gap:6px;min-width:0;padding:10px 12px;border-radius:3px;transition:background-color .16s}",
			".dshph_stepMainRow{display:flex;align-items:center;gap:12px;min-width:0}",
			".dshph_step:hover{background:var(--dshph-wash)}",
			".dshph_stepNo{font-family:var(--dshph-serif);font-size:14px;color:var(--dshph-ink3);min-width:24px;letter-spacing:.04em}",
			".dshph_stepMain{display:flex;align-items:center;gap:8px;flex-wrap:wrap;min-width:0}",
			".dshph_stepId{font-size:13.5px;font-weight:600;color:var(--dshph-ink);overflow-wrap:anywhere}",
			".dshph_step[data-current=\"true\"]{background:var(--dshph-accent-wash);box-shadow:inset 2px 0 0 var(--dshph-accent)}",
			".dshph_step[data-current=\"true\"] .dshph_stepNo{color:var(--dshph-accent);font-weight:700}",
			// i6:当前步标签文字色改 --dshph-tagCur-fg(深色态用深字,避免深底深字/浅底浅字)。
			".dshph_tagCur{font-size:13px;line-height:1;letter-spacing:.14em;color:var(--dshph-tagCur-fg);background:var(--dshph-accent);padding:4px 9px 4px 10px;border-radius:2px;white-space:nowrap;margin-left:auto}",
			// kr-board-time-token(R4):阶段副行(时间 + token;次级信息,ink3 小号)。
			".dshph_stageMeta{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:13px;color:var(--dshph-ink3);min-width:0}",
			".dshph_stageMetaItem{white-space:nowrap}",
			// chip(类型/角色小徽标;字号红线 ≥13px)
			".dshph_chip{display:inline-flex;align-items:center;font-size:13px;line-height:1;letter-spacing:.1em;color:var(--dshph-ink2);padding:4px 8px;border:1px solid var(--dshph-line2);border-radius:2px;white-space:nowrap}",
			".dshph_chipSoft{border-color:transparent;background:var(--dshph-wash)}",
			".dshph_chipGate{color:var(--dshph-warn);background:var(--dshph-warn-bg);border-color:var(--dshph-warn-line)}",
			// 预算(kv 杂志网格 + 逐条上报)
			".dshph_budget{display:flex;flex-direction:column;gap:8px;font-size:14px;color:var(--dshph-ink2)}",
			".dshph_miniHead{font-size:13px;font-weight:600;letter-spacing:.24em;color:var(--dshph-ink3);margin:20px 0 6px}",
			".dshph_miniHead:first-child{margin-top:0}",
			".dshph_kv{margin:0}",
			".dshph_kvRow{display:grid;grid-template-columns:110px minmax(0,1fr);gap:16px;padding:11px 0;border-bottom:1px solid var(--dshph-line)}",
			".dshph_kvRow dt{font-size:13px;color:var(--dshph-ink3);letter-spacing:.06em}",
			".dshph_kvRow dd{font-size:14px;color:var(--dshph-ink2);margin:0;min-width:0;overflow-wrap:anywhere}",
			".dshph_kvRow dd.dshph_unset{color:var(--dshph-ink3)}",
			".dshph_bigNum{font-family:var(--dshph-serif);font-size:21px;color:var(--dshph-ink);margin-right:2px}",
			".dshph_entries{margin:0;padding:0;list-style:none;border-bottom:1px solid var(--dshph-line)}",
			".dshph_entries li{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 10px;padding:14px 2px;border-top:1px solid var(--dshph-line);transition:background-color .16s}",
			// i6:硬编码浅色 hover 底改 var(--dshph-wash),深色态自动为深灰。
			".dshph_entries li:hover{background:var(--dshph-wash)}",
			".dshph_entries .dshph_eid{font-size:13px;font-weight:600;color:var(--dshph-ink);overflow-wrap:anywhere}",
			".dshph_entries .dshph_desc{font-size:14px;color:var(--dshph-ink2);min-width:0;overflow-wrap:anywhere}",
			".dshph_budgetUsage{font-size:13px;color:var(--dshph-ink3)}",
			".dshph_budgetNote{color:var(--dshph-ink2);font-style:italic}",
			// 门禁记录 / 推进日志
			".dshph_gateList,.dshph_logList{margin:0;padding:0;list-style:none;border-top:1px solid var(--dshph-line)}",
			".dshph_gateList li,.dshph_logList li{display:flex;align-items:baseline;gap:14px;padding:13px 2px;border-bottom:1px solid var(--dshph-line)}",
			".dshph_gateList .dshph_gName{font-size:14px;color:var(--dshph-ink2);min-width:0;overflow-wrap:anywhere}",
			".dshph_gateList .dshph_badge{margin-left:auto}",
			".dshph_logNo{font-family:var(--dshph-serif);font-size:14px;color:var(--dshph-ink3);min-width:30px;letter-spacing:.04em}",
			".dshph_logDot{color:var(--dshph-edge)}",
			".dshph_logName{font-size:14px;color:var(--dshph-ink2);min-width:0;overflow-wrap:anywhere}",
			// kr-board-time-token(R5):记录条目时间(门禁/日志;次级信息,ink3 小号)。
			".dshph_recTime{font-size:13px;color:var(--dshph-ink3);white-space:nowrap}",
			// 总结/需求(markdown 渲染;表格窄容器 overflow-x:auto)
			".dshph_md{display:flex;flex-direction:column;gap:8px;font-size:14px;line-height:1.6;color:var(--dshph-ink2);overflow-wrap:anywhere;min-width:0}",
			".dshph_mdH1{font-size:19px;font-weight:700;color:var(--dshph-ink);margin:0;font-family:var(--dshph-serif);letter-spacing:.04em}",
			".dshph_mdH2{font-size:17px;font-weight:700;color:var(--dshph-ink);margin:0}",
			".dshph_mdH3{font-size:15px;font-weight:600;color:var(--dshph-ink);margin:0}",
			".dshph_mdP{font-size:14px;line-height:1.6;color:var(--dshph-ink2);margin:0}",
			".dshph_mdBlockquote{font-size:14px;line-height:1.6;color:var(--dshph-ink2);border-left:3px solid var(--dshph-accent);padding:4px 0 4px 18px;margin:0}",
			".dshph_mdCode{font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dshph-ink2);background:var(--dshph-wash);border:1px solid var(--dshph-line);border-radius:3px;padding:1px 4px}",
			".dshph_mdUl,.dshph_mdOl{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:4px}",
			".dshph_mdLi{font-size:14px;line-height:1.6;color:var(--dshph-ink2)}",
			".dshph_mdHr{border:0;border-top:1px solid var(--dshph-line);margin:4px 0}",
			// 表格:窄容器 overflow-x:auto(仅渲染失败才降级纯文本,用户带入②)
			".dshph_mdTableWrap{overflow-x:auto;max-width:100%;min-width:0}",
			".dshph_mdTable{border-collapse:collapse;width:100%;font-size:13px;color:var(--dshph-ink2)}",
			".dshph_mdTh,.dshph_mdTd{border:1px solid var(--dshph-line);padding:4px 8px;text-align:left}",
			".dshph_mdTh{font-weight:600;color:var(--dshph-ink);background:var(--dshph-wash)}",
			".dshph_mdLink{color:var(--dshph-accent);text-decoration:underline;cursor:pointer}",
			// 通用文本
			".dshph_text{font-size:13px;line-height:1.6;color:var(--dshph-ink2);white-space:pre-wrap;overflow-wrap:anywhere;margin:0}",
			".dshph_link{color:var(--dshph-accent);cursor:pointer;text-decoration:underline;font-size:13px}",
			// 空态 / 加载态
			".dshph_state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:48px 0;text-align:center}",
			".dshph_stateIcon{color:var(--dshph-ink3);display:inline-flex}",
			".dshph_stateText{font-size:13px;color:var(--dshph-ink3);margin:0}",
			".dshph_stateTitle{font-size:15px;font-weight:600;color:var(--dshph-ink);margin:0}",
			".dshph_stateHint{font-size:13px;color:var(--dshph-ink3);margin:0}",
			".dshph_emptyBox{margin-top:28px;border:1px dashed var(--dshph-line2);border-radius:4px;padding:48px 24px;text-align:center;background:var(--dshph-card)}",
			".dshph_scanRootWarn{margin:16px auto 0;max-width:560px;text-align:left;border:1px solid var(--dshph-warn-line);background:var(--dshph-warn-bg);border-radius:4px;padding:10px 14px;display:flex;flex-direction:column;gap:4px}",
			".dshph_scanRootPath{margin:0;font-size:13px;color:var(--dshph-warn);word-break:break-all}",
			".dshph_scanRootHint{margin:0;font-size:13px;color:var(--dshph-ink2);line-height:1.5}",
			".dshph_emptyIcon{width:40px;height:40px;margin:0 auto 16px;border:1.5px solid var(--dshph-edge);border-radius:50%;position:relative}",
			".dshph_emptyIcon::after{content:\"\";position:absolute;left:7px;right:7px;top:50%;height:1.5px;background:var(--dshph-edge);transform:rotate(-45deg)}",
			".dshph_emptyMain{font-size:15px;font-weight:600;color:var(--dshph-ink);letter-spacing:.06em;margin:0}",
			".dshph_emptySub{font-size:13px;color:var(--dshph-ink3);margin-top:8px}",
			".dshph_spinner{animation:dshph_spin .8s linear infinite}",
			"@keyframes dshph_spin{to{transform:rotate(360deg)}}",
			".dshph_visuallyHidden{clip:rect(0 0 0 0);white-space:nowrap;width:1px;height:1px;position:absolute;overflow:hidden}",
			// 迭代8:搜索/筛选工具条 + 行内操作按钮 + 归档/置顶徽章(深浅两态走 --dshph-*)
			".dshph_toolbar{display:flex;flex-direction:column;gap:12px;padding:20px 0 4px;border-bottom:1px solid var(--dshph-line)}",
			".dshph_search{display:flex;align-items:center;gap:8px;position:relative}",
			".dshph_searchInput{box-sizing:border-box;width:100%;height:36px;font:inherit;font-size:14px;color:var(--dshph-ink);background:var(--dshph-card);border:1px solid var(--dshph-line2);border-radius:4px;padding:0 34px 0 12px}",
			".dshph_searchInput:focus-visible{outline:2px solid var(--dshph-accent);outline-offset:-2px}",
			".dshph_searchClear{appearance:none;position:absolute;right:6px;width:24px;height:24px;font-size:16px;line-height:1;color:var(--dshph-ink3);background:transparent;border:0;border-radius:3px;cursor:pointer}",
			".dshph_searchClear:hover{color:var(--dshph-ink);background:var(--dshph-wash)}",
			".dshph_filterChips{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
			".dshph_filterLabel{font-size:13px;letter-spacing:.16em;color:var(--dshph-ink3)}",
			".dshph_chipFilter{appearance:none;font:inherit;font-size:13px;line-height:1;letter-spacing:.08em;color:var(--dshph-ink2);background:var(--dshph-card);border:1px solid var(--dshph-line2);border-radius:2px;padding:6px 10px;cursor:pointer;transition:background-color .16s,border-color .16s,color .16s}",
			".dshph_chipFilter:hover{border-color:var(--dshph-edge);color:var(--dshph-ink)}",
			".dshph_chipFilter[data-state=\"active\"]{color:var(--dshph-info)}",
			".dshph_chipFilter[data-state=\"delivered\"]{color:var(--dshph-ok)}",
			".dshph_chipFilter[data-state=\"rejected\"]{color:var(--dshph-warn)}",
			".dshph_chipFilter[data-state=\"parked\"]{color:var(--dshph-ink3)}",
			".dshph_chipFilterOn{background:var(--dshph-accent-wash);border-color:var(--dshph-accent);color:var(--dshph-accent);font-weight:600}",
			".dshph_chipArchived{color:var(--dshph-ink3)}",
			".dshph_rowActions{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px}",
			".dshph_actionBtn{appearance:none;font:inherit;font-size:13px;line-height:1;letter-spacing:.06em;color:var(--dshph-ink2);background:var(--dshph-card);border:1px solid var(--dshph-line2);border-radius:2px;padding:5px 9px;cursor:pointer;transition:background-color .16s,border-color .16s,color .16s}",
			".dshph_actionBtn:hover{border-color:var(--dshph-edge);color:var(--dshph-ink)}",
			".dshph_badgePinned{color:var(--dshph-accent);background:var(--dshph-accent-wash);border:1px solid var(--dshph-accent)}",
			".dshph_badgeArchived{color:var(--dshph-ink3);background:var(--dshph-wash);border:1px solid var(--dshph-line2)}",
			".dshph_clearAll{margin-top:12px}",
			// 迭代9(i8-fix):被归档隐藏的匹配项目提示条 + 空态操作行(缺陷一)。
			".dshph_hiddenArchived{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:12px 16px;margin-top:16px;border:1px solid var(--dshph-warn-line);background:var(--dshph-warn-bg);border-radius:4px;font-size:13px;color:var(--dshph-warn)}",
			".dshph_hiddenArchivedText{color:var(--dshph-warn);min-width:0}",
			".dshph_emptyActions{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:16px}",
			// 响应式(窄容器收缩:衬线标题字号、杂志网格、列表列数)
			"@media (max-width:920px){.dshph_page{padding:24px 20px 32px}.dshph_overlayHeader{padding:12px 20px}.dshph_overlayTitle{font-size:18px}.dshph_wsStat{padding-right:24px}.dshph_wsStat + .dshph_wsStat{padding-left:24px}.dshph_wsStat b{font-size:26px}.dshph_row{grid-template-columns:1fr;gap:10px;padding:18px 14px}.dshph_idx{display:none}.dshph_steps{grid-template-columns:1fr}.dshph_subsec{grid-template-columns:1fr;gap:10px;padding:24px 0}.dshph_cell{display:flex;align-items:baseline;gap:10px}.dshph_cellLabel{margin-bottom:0;min-width:72px}.dshph_secTitle{font-size:20px}.dshph_detailName{font-size:19px}.dshph_kvRow{grid-template-columns:90px minmax(0,1fr)}.dshph_tab{padding:10px 12px}}",
		].join("\n");

		function ensureStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector(`style[data-plugin-css="${CSS_TAG}"]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.pluginCss = CSS_TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}
		// ── markdown 渲染迭代(i4):总结节轻量 markdown 解析器 + 渲染器 ────────
		// parseMarkdown 是纯函数:不依赖 React/window/t/模块闭包,输入 markdown
		// 字符串,输出块级 AST(数组)。每块含 {type, ...} 与行内 span 数组
		// ({type:'text'|'bold'|'italic'|'code'|'link', ...})。因自包含(内联
		// parseInline/parseTableRow),可被 Node 测试从 client.js 提取 eval 单测。
		// 子集边界:标题(#/##/###)、段落、无序/有序列表、引用、分隔线、表格、
		// 加粗、斜体、行内代码、链接;未识别语法一律按纯文本兜底,不抛错。
		function parseMarkdown(md) {
			if (typeof md !== "string") return [];
			var lines = md.split(/\r?\n/);
			var blocks = [];
			var i = 0;
			while (i < lines.length) {
				var line = lines[i];
				var trimmed = line.trim();
				if (trimmed === "") { i++; continue; }
				// 标题 # / ## / ###
				var h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
				if (h) {
					blocks.push({ type: "heading", level: h[1].length, spans: parseInline(h[2]) });
					i++;
					continue;
				}
				// 分隔线 --- / *** / ___
				if (/^(---|\*\*\*|___)\s*$/.test(trimmed)) {
					blocks.push({ type: "hr" });
					i++;
					continue;
				}
				// 引用:连续 > 行合并为一个 blockquote
				if (trimmed.charAt(0) === ">") {
					var qlines = [];
					while (i < lines.length && lines[i].trim().charAt(0) === ">") {
						qlines.push(lines[i].trim().replace(/^>\s?/, ""));
						i++;
					}
					blocks.push({ type: "blockquote", spans: parseInline(qlines.join(" ")) });
					continue;
				}
				// 无序列表:连续 - / * / + 行
				var ul = /^[-*+]\s+(.*)$/.exec(trimmed);
				if (ul) {
					var uitems = [];
					while (i < lines.length) {
						var ut = lines[i].trim();
						var um = /^[-*+]\s+(.*)$/.exec(ut);
						if (um) { uitems.push({ spans: parseInline(um[1]) }); i++; }
						else break;
					}
					blocks.push({ type: "ul", items: uitems });
					continue;
				}
				// 有序列表:连续 1. / 2. 行
				var ol = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
				if (ol) {
					var oitems = [];
					while (i < lines.length) {
						var ot = lines[i].trim();
						var om = /^(\d+)[.)]\s+(.*)$/.exec(ot);
						if (om) { oitems.push({ spans: parseInline(om[2]) }); i++; }
						else break;
					}
					blocks.push({ type: "ol", items: oitems });
					continue;
				}
				// 表格:行以 | 开头且下一行为分隔行(| --- | --- |)才识别
				if (trimmed.charAt(0) === "|" && i + 1 < lines.length) {
					var sep = lines[i + 1].trim();
					if (/^\|?[\s:|-]+\|?$/.test(sep) && sep.indexOf("-") !== -1) {
						var header = parseTableRow(trimmed);
						i += 2;
						var rows = [];
						while (i < lines.length && lines[i].trim().charAt(0) === "|") {
							rows.push(parseTableRow(lines[i].trim()));
							i++;
						}
						blocks.push({ type: "table", header: header, rows: rows });
						continue;
					}
				}
				// 段落:收集连续非空、非块起始行,以空格连接
				var plines = [];
				while (i < lines.length) {
					var pt = lines[i].trim();
					if (pt === "") break;
					if (/^(#{1,3})\s+/.test(pt)) break;
					if (/^(---|\*\*\*|___)\s*$/.test(pt)) break;
					if (pt.charAt(0) === ">") break;
					if (/^[-*+]\s+/.test(pt)) break;
					if (/^\d+[.)]\s+/.test(pt)) break;
					plines.push(pt);
					i++;
				}
				if (plines.length > 0) {
					blocks.push({ type: "paragraph", spans: parseInline(plines.join(" ")) });
				} else {
					i++; // 安全兜底,防死循环
				}
			}
			return blocks;

			// 行内解析:扫描文本产出 span 数组。识别 code / link / bold / italic,
			// 其余按纯文本。bold/italic 递归解析内层(支持嵌套)。
			function parseInline(text) {
				var spans = [];
				var buf = "";
				var i = 0;
				function flush() {
					if (buf.length > 0) { spans.push({ type: "text", text: buf }); buf = ""; }
				}
				while (i < text.length) {
					var ch = text.charAt(i);
					// 行内代码 `text`
					if (ch === "`") {
						var end = text.indexOf("`", i + 1);
						if (end !== -1) {
							flush();
							spans.push({ type: "code", text: text.slice(i + 1, end) });
							i = end + 1;
							continue;
						}
					}
					// 链接 [text](url)
					if (ch === "[") {
						var close = text.indexOf("]", i + 1);
						if (close !== -1 && text.charAt(close + 1) === "(") {
							var paren = text.indexOf(")", close + 2);
							if (paren !== -1) {
								flush();
								spans.push({ type: "link", text: text.slice(i + 1, close), href: text.slice(close + 2, paren) });
								i = paren + 1;
								continue;
							}
						}
					}
					// 加粗 **text**
					if (ch === "*" && text.charAt(i + 1) === "*") {
						var bend = text.indexOf("**", i + 2);
						if (bend !== -1) {
							flush();
							spans.push({ type: "bold", spans: parseInline(text.slice(i + 2, bend)) });
							i = bend + 2;
							continue;
						}
					}
					// 斜体 *text* 或 _text_(_ 需两侧非词字符,避免 snake_case 误判)
					if ((ch === "*" || ch === "_") && text.charAt(i + 1) !== ch) {
						var iend = text.indexOf(ch, i + 1);
						if (iend !== -1) {
							var before = i === 0 ? "" : text.charAt(i - 1);
							var after = iend + 1 >= text.length ? "" : text.charAt(iend + 1);
							var word = /[A-Za-z0-9_]/;
							if (ch === "_" && (word.test(before) || word.test(after))) {
								buf += ch; i++; continue;
							}
							flush();
							spans.push({ type: "italic", spans: parseInline(text.slice(i + 1, iend)) });
							i = iend + 1;
							continue;
						}
					}
					buf += ch;
					i++;
				}
				flush();
				return spans;
			}

			// 表格行:去首尾 |,按 | 切分单元格,trim 后行内解析。
			function parseTableRow(line) {
				var s = line.trim();
				if (s.charAt(0) === "|") s = s.slice(1);
				if (s.charAt(s.length - 1) === "|") s = s.slice(0, -1);
				return s.split("|").map(function (cell) { return parseInline(cell.trim()); });
			}
		}

		// 渲染器:AST → React 元素(.dshph_md* 类)。依赖 React,不参与 Node 单测。
		function renderSpans(spans, t) {
			if (!Array.isArray(spans)) return null;
			return spans.map(function (s, i) {
				switch (s.type) {
					case "text": return s.text;
					case "bold": return React.createElement("strong", { key: i }, renderSpans(s.spans, t));
					case "italic": return React.createElement("em", { key: i }, renderSpans(s.spans, t));
					case "code": return React.createElement("code", { className: "dshph_mdCode", key: i }, s.text);
					case "link": return React.createElement("a", { className: "dshph_mdLink", href: s.href, target: "_blank", rel: "noopener", key: i }, s.text);
					default: return s.text != null ? s.text : "";
				}
			});
		}
		function renderMarkdownAst(ast, t) {
			if (!Array.isArray(ast)) return null;
			return ast.map(function (block, bi) {
				switch (block.type) {
					case "heading":
						return React.createElement("h" + block.level, { className: "dshph_mdH" + block.level, key: bi }, renderSpans(block.spans, t));
					case "paragraph":
						return React.createElement("p", { className: "dshph_mdP", key: bi }, renderSpans(block.spans, t));
					case "ul":
						return React.createElement("ul", { className: "dshph_mdUl", key: bi },
							block.items.map(function (it, ii) {
								return React.createElement("li", { className: "dshph_mdLi", key: ii }, renderSpans(it.spans, t));
							}));
					case "ol":
						return React.createElement("ol", { className: "dshph_mdOl", key: bi },
							block.items.map(function (it, ii) {
								return React.createElement("li", { className: "dshph_mdLi", key: ii }, renderSpans(it.spans, t));
							}));
					case "blockquote":
						return React.createElement("blockquote", { className: "dshph_mdBlockquote", key: bi }, renderSpans(block.spans, t));
					case "hr":
						return React.createElement("hr", { className: "dshph_mdHr", key: bi });
					case "table":
						// 表格包一层 overflow-x:auto 容器,窄容器横向滚动而非撑破(用户带入②)。
						return React.createElement("div", { className: "dshph_mdTableWrap", key: bi },
							React.createElement("table", { className: "dshph_mdTable" },
								React.createElement("thead", null,
									React.createElement("tr", null,
										block.header.map(function (c, ci) {
											return React.createElement("th", { className: "dshph_mdTh", key: ci }, renderSpans(c, t));
										}))),
								React.createElement("tbody", null,
									block.rows.map(function (row, ri) {
										return React.createElement("tr", { key: ri },
											row.map(function (c, ci) {
												return React.createElement("td", { className: "dshph_mdTd", key: ci }, renderSpans(c, t));
											}));
									}))));
					default:
						return null;
				}
			});
		}
		// markdown 渲染入口:外层 try/catch,解析/渲染抛错时回退原始文本,不白屏。
		// 表格窄容器溢出由 .dshph_mdTableWrap overflow-x:auto 处理;仅当解析/渲染
		// 抛错(渲染失败)才降级为纯文本(用户带入②)。总结与需求 tab 共用。
		function renderSummary(summary, t) {
			try {
				return React.createElement("div", { className: "dshph_md" }, renderMarkdownAst(parseMarkdown(summary), t));
			} catch (e) {
				return React.createElement("p", { className: "dshph_text" }, summary);
			}
		}

		// ── 侧栏底部动作区入口 ───────────────────────────────────────────────
		function SidebarEntry({ t }) {
			return React.createElement("button", {
				type: "button",
				className: "dshph_sidebarBtn",
				"aria-label": t("open"),
				onClick: () => setBoardOpen(true),
			},
				React.createElement("span", { className: "dshph_sidebarIcon", "aria-hidden": true },
					React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" },
						React.createElement("rect", { x: 2, y: 2, width: 12, height: 12, rx: 2, stroke: "currentColor", strokeWidth: 1.4 }),
						React.createElement("path", { d: "M5 6h6M5 8.5h6M5 11h3", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" }))),
				React.createElement("span", { className: "dshph_sidebarText" }, t("title")),
			);
		}

		// ── 全幅浮层看板主体 ─────────────────────────────────────────────────
		// 项目列表项:杂志索引式单栏通栏行(设计稿 §3 .rows/.row)。
		// 迭代8:新增 onPin/onArchive 回调 + 行内操作按钮(置顶/归档,stopPropagation
		// 不触发行点击导航)+ 已置顶/已归档徽章。
		function ProjectCard({ project, t, index, onPin, onArchive }) {
			const pending = project.pendingGate !== null && project.pendingGate !== undefined;
			const error = project.error !== undefined && project.error !== null;
			const state = project.state;
			const cells = [];
			// 当前阶段(类型 + 阶段 id)
			cells.push(React.createElement("div", { key: "stage", className: "dshph_cell" },
				React.createElement("span", { className: "dshph_cellLabel" }, t("stage")),
				React.createElement("span", { className: "dshph_cellValue" },
					project.currentStage ? React.createElement(React.Fragment, null,
						React.createElement("span", { title: project.currentStage.type }, mapStageType(project.currentStage.type, t)),
						project.currentStage.id ? React.createElement(React.Fragment, null,
							" · ",
							React.createElement("span", { title: project.currentStage.id }, mapStageId(project.currentStage.id, t))) : null)
						: "—")));
			// 进度(第N/M步)
			cells.push(React.createElement("div", { key: "progress", className: "dshph_cell" },
				React.createElement("span", { className: "dshph_cellLabel" }, t("progress")),
				React.createElement("span", { className: "dshph_cellValue" }, progressText(project.stageIndex, project.stageCount, t))));
			// 迭代
			cells.push(React.createElement("div", { key: "iter", className: "dshph_cell" },
				React.createElement("span", { className: "dshph_cellLabel" }, t("iteration")),
				React.createElement("span", { className: "dshph_cellValue" }, project.iteration)));
			// 预算(合计)。kr-board-time-token(R1):悬浮 title 保留精确逗号值。
			cells.push(React.createElement("div", { key: "budget", className: "dshph_cell dshph_cBudget" },
				React.createElement("span", { className: "dshph_cellLabel" }, t("budget")),
				React.createElement("span", { className: "dshph_cellValue", title: project.budget && project.budget.totals ? tokenTitle(project.budget.totals.totalTokens) : undefined },
					project.budget && project.budget.totals ? budgetTotalsText(project.budget.totals, t) : "—")));
			// 迭代8:行内操作(置顶/归档)+ 已置顶/已归档徽章。stopPropagation 防误触导航。
			const actions = React.createElement("div", { className: "dshph_rowActions" },
				project.pinned ? React.createElement("span", { className: "dshph_badge dshph_badgePinned" }, t("pinned")) : null,
				project.archived ? React.createElement("span", { className: "dshph_badge dshph_badgeArchived" }, t("archived")) : null,
				React.createElement("button", { type: "button", className: "dshph_actionBtn", onClick: (e) => { e.stopPropagation(); onPin(project); } }, project.pinned ? t("action.unpin") : t("action.pin")),
				React.createElement("button", { type: "button", className: "dshph_actionBtn", onClick: (e) => { e.stopPropagation(); onArchive(project); } }, project.archived ? t("action.unarchive") : t("action.archive")),
			);
			return React.createElement("div", {
				className: "dshph_row",
				"data-pending": pending ? "true" : undefined,
				"data-error": error ? "true" : undefined,
				role: "button",
				tabIndex: 0,
				"aria-label": `${project.title}${pending ? ` — ${t("pendingGateHint")}` : ""}`,
			},
				React.createElement("span", { className: "dshph_idx" }, String(index + 1).padStart(2, "0")),
				React.createElement("div", { className: "dshph_cell dshph_cName" },
					React.createElement("span", { className: "dshph_cellLabel" }, t("project")),
					React.createElement("span", { className: "dshph_cellValue" },
						React.createElement("span", { className: "dshph_name" }, project.title),
						React.createElement("span", { className: "dshph_badge dshph_badgeState", "data-state": state }, stateLabel(state, t)),
						pending ? React.createElement("span", { className: "dshph_badge dshph_badgePending" }, t("pendingGate")) : null,
						// 迭代7:中文 title 下方小号 muted id(唯一键,不可隐藏到找不到)。
						React.createElement("span", { className: "dshph_id", title: project.id }, project.id),
						actions)),
				...cells,
				// kr-board-time-token(R3):项目时间行(开始/结束/耗时)。
				// 开始=createdAt;结束=active?"—":updatedAt;耗时=end−start(active=至今)。
				React.createElement("div", { className: "dshph_timeRow" },
					React.createElement("span", { className: "dshph_timeItem" }, `${t("startTime")} ${formatTime(project.createdAt) ?? "—"}`),
					React.createElement("span", { className: "dshph_timeItem" }, `${t("endTime")} ${state === "active" ? "—" : (formatTime(project.updatedAt) ?? "—")}`),
					React.createElement("span", { className: "dshph_timeItem" }, `${t("duration")} ${projectDurationText(project, state)}`)),
				error ? React.createElement("div", { className: "dshph_errorLine", title: project.error.category },
					`${t("errorProject")} (${mapError(project.error.category, t)})`) : null,
			);
		}
		// kr-board-time-token(R3):项目耗时文本(active=至今;否则 end−start;数据缺失 → "—")。
		function projectDurationText(project, state) {
			const startMs = project.createdAt ? new Date(project.createdAt).getTime() : null;
			if (startMs === null || isNaN(startMs)) return "—";
			const endMs = state === "active"
				? Date.now()
				: (project.updatedAt ? new Date(project.updatedAt).getTime() : null);
			if (endMs === null || isNaN(endMs)) return "—";
			return formatDuration(endMs - startMs);
		}

		// 流程步骤行(杂志 steps 网格;当前步高亮 + 「当前」标签)。
		// kr-board-time-token(R4):阶段行扩展为「主行 + 时间/token 副行」两段式。
		// start/end/duration 由 DetailView 预计算传入;token=该阶段 runtime-events 聚合。
		function StageRow({ stage, index, current, t, start, end, duration, token }) {
			const label = stage.type === "work"
				? React.createElement(React.Fragment, null,
					React.createElement("span", { className: "dshph_chip", title: stage.type }, mapStageType(stage.type, t)),
					React.createElement("span", { className: "dshph_chip dshph_chipSoft", title: stage.role ?? "" }, mapRole(stage.role ?? "", t)))
				: React.createElement("span", { className: "dshph_chip" + (stage.type === "gate" ? " dshph_chipGate" : ""), title: stage.type }, mapStageType(stage.type, t));
			return React.createElement("div", { className: "dshph_step", "data-current": current ? "true" : undefined },
				React.createElement("div", { className: "dshph_stepMainRow" },
					React.createElement("span", { className: "dshph_stepNo" }, String(index + 1).padStart(2, "0")),
					React.createElement("span", { className: "dshph_stepMain" },
						React.createElement("span", { className: "dshph_stepId", title: stage.id }, mapStageId(stage.id, t)),
						label),
					current ? React.createElement("span", { className: "dshph_tagCur" }, t("stage")) : null,
				),
				React.createElement("div", { className: "dshph_stageMeta" },
					React.createElement("span", { className: "dshph_stageMetaItem" }, `${t("startTime")} ${start ? formatTime(start) : "—"}`),
					React.createElement("span", { className: "dshph_stageMetaItem" }, `${t("endTime")} ${end ? formatTime(end) : "—"}`),
					React.createElement("span", { className: "dshph_stageMetaItem" }, `${t("duration")} ${duration ?? "—"}`),
					React.createElement("span", { className: "dshph_stageMetaItem" }, `${t("token")} ${formatToken(token)}`),
				),
			);
		}

		// 预算详情:汇总(kv 杂志网格)+ 逐条上报(人话逐行 + usage.note 次级展示)。
		function BudgetDetail({ budget, t }) {
			const committed = Array.isArray(budget.committed) ? budget.committed : [];
			const summaryRows = [];
			summaryRows.push(React.createElement("div", { key: "estimate", className: "dshph_kvRow" },
				React.createElement("dt", null, t("estimate")),
				React.createElement("dd", { className: budget.estimate == null ? "dshph_unset" : undefined }, usageText(budget.estimate, t))));
			summaryRows.push(React.createElement("div", { key: "cap", className: "dshph_kvRow" },
				React.createElement("dt", null, t("cap")),
				React.createElement("dd", { className: budget.cap == null ? "dshph_unset" : undefined }, usageText(budget.cap, t))));
			// kr-board-time-token(R2):移除「已上报:N 条」计数行(committed 行)。逐条上报
			// 列表(budgetEntry 明细)保留。
			// kr-board-time-token(R1):真实 token 总量经 formatToken 可读化;悬浮 title 保留精确值。
			if (budget.totals && typeof budget.totals.totalTokens === "number" && budget.totals.totalTokens > 0) {
				summaryRows.push(React.createElement("div", { key: "totalTokens", className: "dshph_kvRow" },
					React.createElement("dt", null, t("totalTokens")),
					React.createElement("dd", null,
						React.createElement("span", { className: "dshph_bigNum", title: tokenTitle(budget.totals.totalTokens) }, formatToken(budget.totals.totalTokens)))));
			}
			if (budget.totals && budget.totals.byRole && typeof budget.totals.byRole === "object") {
				summaryRows.push(React.createElement("div", { key: "byRole", className: "dshph_kvRow" },
					React.createElement("dt", null, t("byRole")),
					React.createElement("dd", null, roleCountsText(budget.totals.byRole, t))));
			}
			if (budget.totals && budget.totals.bySource && typeof budget.totals.bySource === "object") {
				summaryRows.push(React.createElement("div", { key: "bySource", className: "dshph_kvRow" },
					React.createElement("dt", null, t("bySource")),
					React.createElement("dd", null, sourceCountsText(budget.totals.bySource, t))));
			}
			return React.createElement("div", { className: "dshph_budget" },
				React.createElement("h4", { className: "dshph_miniHead" }, t("budgetSummary")),
				React.createElement("dl", { className: "dshph_kv" }, summaryRows),
				committed.length > 0 ? React.createElement(React.Fragment, null,
					React.createElement("h4", { className: "dshph_miniHead" }, t("budgetEntry")),
					React.createElement("ul", { className: "dshph_entries" },
						committed.map((entry, i) => React.createElement("li", { key: `entry-${i}` },
							React.createElement("span", { className: "dshph_chip" }, mapRole(entry.role ?? "", t)),
							React.createElement("span", { className: "dshph_chip dshph_chipSoft" }, mapSource(entry.source ?? "", t)),
							React.createElement("span", { className: "dshph_eid", title: entry.stageId }, mapStageId(entry.stageId ?? "", t)),
							React.createElement("span", { className: "dshph_desc" }, usageDetail(entry.usage, t)),
						)))) : null);
		}

		// ── 详情区 tab 化(i5):4 组(进度/预算/记录/总结)────────────────────
		// 信息头不进 tab;待裁决警示块常显(在 tab 栏之外);tab 为纯前端受控状态
		// (React useState,默认「进度」);各 tab 面板保持挂载,切换为纯展示
		// (display 切换),不 refetch、不卸载 → 天然满足「切换不丢状态」。
		// 迭代7:新增第 5 个「需求」tab(懒取 REQUIREMENT.md,缓存不 refetch)。
		const TABS = [
			{ id: "progress", labelKey: "tab.progress" },
			{ id: "budget", labelKey: "tab.budget" },
			{ id: "records", labelKey: "tab.records" },
			{ id: "summary", labelKey: "tab.summary" },
			{ id: "requirement", labelKey: "tab.requirement" },
		];

		function DetailView({ project, t, onBack }) {
			const flow = project.flow;
			const stages = flow && Array.isArray(flow.stages) ? flow.stages : [];
			const currentIdx = project.registry?.stageIndex ?? 0;
			const stageCount = project.stageCount ?? (stages.length > 0 ? stages.length : null);
			const budget = project.budget;
			const pendingGate = project.pendingGate;
			const state = project.registry?.state ?? project.state;
			// kr-board-time-token(R4):阶段时间 + token 预计算。
			// 阶段开始=stageTimes[stageId](API 补);阶段结束=下一阶段开始/「—」/delivered 时刻;
			// 当前阶段结束=「—」、耗时=至今;无 journal 阶段=「—」。token=stageTokenTotals 聚合。
			const stageTimesMap = {};
			if (Array.isArray(project.stageTimes)) {
				for (const st of project.stageTimes) stageTimesMap[st.stageId] = st.start;
			}
			const stageTokens = stageTokenTotals(budget?.committed);
			const nowMs = Date.now();
			const updatedAtMs = project.registry?.updatedAt ? new Date(project.registry.updatedAt).getTime() : null;
			const stageRows = stages.map((stage, i) => {
				const start = stageTimesMap[stage.id] ?? null;
				const startMs = start ? new Date(start).getTime() : null;
				let end = null;
				let duration = null;
				if (i === currentIdx) {
					// 当前阶段:结束=「—」、耗时=至今。
					duration = startMs !== null && !isNaN(startMs) ? formatDuration(nowMs - startMs) : null;
				} else {
					const nextStart = stageTimesMap[stages[i + 1]?.id] ?? null;
					if (nextStart) {
						end = nextStart;
						const nextMs = new Date(nextStart).getTime();
						duration = startMs !== null && !isNaN(startMs) && !isNaN(nextMs) ? formatDuration(nextMs - startMs) : null;
					} else if (i === stages.length - 1 && (state === "delivered" || state === "rejected") && updatedAtMs !== null && !isNaN(updatedAtMs)) {
						// 末阶段且已交付/拒绝:结束=updatedAt 代理(delivered 时刻)。
						end = project.registry?.updatedAt;
						duration = startMs !== null && !isNaN(startMs) ? formatDuration(updatedAtMs - startMs) : null;
					}
				}
				return { stage, index: i, current: i === currentIdx, start, end, duration, token: stageTokens[stage.id] ?? 0 };
			});
			const [activeTab, setActiveTab] = React.useState("progress");
			// 迭代7:需求 tab 懒取状态(idle|loading|loaded|error)。面板保持挂载,
			// 首次激活「需求」tab 时 fetch 一次并缓存,后续切 tab 不 refetch(符合 i5 约定)。
			const [requirement, setRequirement] = React.useState(null);
			const [requirementState, setRequirementState] = React.useState("idle");
			React.useEffect(() => {
				if (activeTab !== "requirement") return;
				if (requirementState !== "idle") return;
				setRequirementState("loading");
				fetchRequirement(project.id).then((text) => {
					if (text === null) setRequirementState("error");
					else { setRequirement(text); setRequirementState("loaded"); }
				}).catch(() => setRequirementState("error"));
			}, [activeTab, requirementState, project.id]);

			// 信息头(不进 tab):标题 + 状态徽章 + 迭代/进度/更新时间
			// i6 R3.1:updatedAt 经 formatTime 格式化为可读时间(非原始 ISO 串)。
			// 迭代7:meta 行加 id 前缀(项目 <id> · 迭代 N · 进度 · 更新时间)。
			const infoHead = React.createElement("div", { className: "dshph_detailHead" },
				React.createElement("span", { className: "dshph_detailName" }, project.title),
				React.createElement("span", { className: "dshph_badge dshph_badgeState", "data-state": state }, stateLabel(state, t)),
				React.createElement("span", { className: "dshph_detailMeta" },
					`${t("project")} ${project.id} · ${t("iteration")} ${project.registry?.iteration ?? project.iteration} · ${progressText(currentIdx, stageCount, t)} · ${t("updatedAt")} ${formatTime(project.registry?.updatedAt) ?? t("notSet")}`),
			);

			// 待裁决警示块(常显,不进 tab)
			const gateWarn = pendingGate ? React.createElement("div", { className: "dshph_gateWarn" },
				React.createElement("span", null, React.createElement("b", null, t("pendingGate"), ": "), pendingGate.title ?? mapStageId(pendingGate.stageId, t)),
				pendingGate.summary ? React.createElement("span", { className: "dshph_gateSummary" }, `${t("pendingGateSummary")}: ${pendingGate.summary}`) : null,
				React.createElement("span", { className: "dshph_gateHint" }, t("readOnlyGateHint")),
			) : null;

			// 5 个 tab 面板(全部挂载,display 切换)
			const panels = {
				progress: React.createElement("div", { key: "progress", className: "dshph_tabPanel", "data-active": activeTab === "progress" ? "true" : "false" },
					React.createElement("div", { className: "dshph_subsec" },
						React.createElement("div", { className: "dshph_subsecLabel" },
							React.createElement("h3", null, t("flow")),
							React.createElement("span", { className: "dshph_cap" }, progressText(currentIdx, stageCount, t))),
						React.createElement("div", { className: "dshph_subsecBody" },
							stages.length > 0
								? React.createElement("div", { className: "dshph_steps" },
									stageRows.map((r) => React.createElement(StageRow, { key: r.stage.id, stage: r.stage, index: r.index, current: r.current, t, start: r.start, end: r.end, duration: r.duration, token: r.token })))
								: React.createElement("p", { className: "dshph_text" }, "—")))),
				budget: React.createElement("div", { key: "budget", className: "dshph_tabPanel", "data-active": activeTab === "budget" ? "true" : "false" },
					React.createElement("div", { className: "dshph_subsec" },
						React.createElement("div", { className: "dshph_subsecLabel" },
							React.createElement("h3", null, t("budget")),
							React.createElement("span", { className: "dshph_cap" }, t("budgetEntry"))),
						React.createElement("div", { className: "dshph_subsecBody" },
							budget ? React.createElement(BudgetDetail, { budget, t }) : React.createElement("p", { className: "dshph_text" }, t("noBudget"))))),
				records: React.createElement("div", { key: "records", className: "dshph_tabPanel", "data-active": activeTab === "records" ? "true" : "false" },
					React.createElement("div", { className: "dshph_subsec" },
						React.createElement("div", { className: "dshph_subsecLabel" },
							React.createElement("h3", null, t("gates")),
							// i6 R3.3:门禁节 cap 改「历次裁决」,与 h3「门禁」去重。
							React.createElement("span", { className: "dshph_cap" }, t("gateHistory"))),
						React.createElement("div", { className: "dshph_subsecBody" },
							project.gates && project.gates.length > 0
								? React.createElement("ul", { className: "dshph_gateList" },
									project.gates.map((g) => React.createElement("li", { key: g.file },
										React.createElement("span", { className: "dshph_gName", title: g.stageId }, g.title ?? mapStageId(g.stageId, t)),
										// kr-board-time-token(R5):门禁条目补呈递/裁决时间。
										React.createElement("span", { className: "dshph_recTime" }, `${t("presentedAt")} ${g.presentedAt ? formatTime(g.presentedAt) : "—"}`),
										g.decidedAt ? React.createElement("span", { className: "dshph_recTime" }, `${t("decidedAt")} ${formatTime(g.decidedAt)}`) : null,
										g.verdict ? React.createElement("span", { className: "dshph_badge dshph_badgeState" }, verdictLabel(g.verdict, t)) : null)))
								: React.createElement("p", { className: "dshph_text" }, "—"))),
					React.createElement("div", { className: "dshph_subsec" },
						React.createElement("div", { className: "dshph_subsecLabel" },
							React.createElement("h3", null, t("journals")),
							// i6 R3.3:日志节 cap 改「推进记录」,与 h3「日志」去重。
							React.createElement("span", { className: "dshph_cap" }, t("journalCap"))),
						React.createElement("div", { className: "dshph_subsecBody" },
							project.journals && project.journals.length > 0
								? React.createElement("ul", { className: "dshph_logList" },
									project.journals.map((j) => {
										// kr-board-time-token(R5):journals 元素为对象 { file, stageId, start }。
										const mapped = mapJournalName(j.file, t);
										const sepIdx = mapped.indexOf(" · ");
										const logNo = sepIdx >= 0 ? mapped.slice(0, sepIdx) : "";
										const logName = sepIdx >= 0 ? mapped.slice(sepIdx + 3) : mapped;
										return React.createElement("li", { key: j.file, title: j.file },
											React.createElement("span", { className: "dshph_logNo" }, logNo),
											React.createElement("span", { className: "dshph_logDot" }, "·"),
											React.createElement("span", { className: "dshph_logName" }, logName),
											React.createElement("span", { className: "dshph_recTime" }, j.start ? formatTime(j.start) : "—"));
									}))
								: React.createElement("p", { className: "dshph_text" }, "—")))),
				summary: React.createElement("div", { key: "summary", className: "dshph_tabPanel", "data-active": activeTab === "summary" ? "true" : "false" },
					React.createElement("div", { className: "dshph_subsec" },
						React.createElement("div", { className: "dshph_subsecLabel" },
							React.createElement("h3", null, t("summary")),
							// i6 R3.3:总结节 cap 改「markdown 已渲染」,与 h3「总结」去重。
							React.createElement("span", { className: "dshph_cap" }, t("summaryCap"))),
						React.createElement("div", { className: "dshph_subsecBody" },
							project.summary ? renderSummary(project.summary, t) : React.createElement("p", { className: "dshph_text" }, t("noSummary")),
							project.summary ? React.createElement("span", { className: "dshph_link", onClick: () => window.open(`${API_ROUTE}?view=file&project=${encodeURIComponent(project.id)}&name=SUMMARY.md`, "_blank") }, t("summaryFull")) : null))),
				// 迭代7:需求 tab。懒取 REQUIREMENT.md 全文 inline 渲染;大文件由
				// overlayBody overflow:auto 滚动;后端未放行/fetch 失败 → 错误态,不白屏。
				requirement: React.createElement("div", { key: "requirement", className: "dshph_tabPanel", "data-active": activeTab === "requirement" ? "true" : "false" },
					React.createElement("div", { className: "dshph_subsec" },
						React.createElement("div", { className: "dshph_subsecLabel" },
							React.createElement("h3", null, t("tab.requirement")),
							React.createElement("span", { className: "dshph_cap" }, t("requirementCap"))),
						React.createElement("div", { className: "dshph_subsecBody" },
							requirementState === "loading" ? React.createElement("p", { className: "dshph_text" }, t("loading"))
								: requirementState === "error" ? React.createElement("p", { className: "dshph_text" }, t("requirementError"))
								: requirement ? renderSummary(requirement, t) : React.createElement("p", { className: "dshph_text" }, t("noRequirement"))))),
			};

			return React.createElement("div", { className: "dshph_detail" },
				React.createElement("button", { type: "button", className: "dshph_backBtn", onClick: onBack }, t("back")),
				infoHead,
				gateWarn,
				React.createElement("div", { className: "dshph_tabs", role: "tablist", "aria-label": t("title") },
					TABS.map((tab) => React.createElement("button", {
						key: tab.id,
						type: "button",
						role: "tab",
						className: "dshph_tab" + (activeTab === tab.id ? " dshph_tabActive" : ""),
						"data-active": activeTab === tab.id ? "true" : "false",
						"aria-selected": activeTab === tab.id,
						onClick: () => setActiveTab(tab.id),
					}, t(tab.labelKey)))),
				React.createElement("div", { className: "dshph_tabPanels" },
					panels.progress, panels.budget, panels.records, panels.summary, panels.requirement),
			);
		}
		// ── 空态 / 加载态(居中图标 + 文案 + 留白)────────────────────────────
		function LoadingState({ t }) {
			return React.createElement("div", { className: "dshph_state" },
				React.createElement("span", { className: "dshph_stateIcon", "aria-hidden": true },
					React.createElement("svg", { className: "dshph_spinner", width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" },
						React.createElement("circle", { cx: 8, cy: 8, r: 6, stroke: "var(--dshph-ink3)", strokeWidth: 2 }),
						React.createElement("path", { d: "M14 8a6 6 0 0 0-6-6", stroke: "var(--dshph-accent)", strokeWidth: 2, strokeLinecap: "round" }))),
				React.createElement("p", { className: "dshph_stateText" }, t("loading")));
		}

		// 0.4.1:零项目空态带 scanRoot 警示(扫错根不再静默空白;给出修改指引)。
		function EmptyState({ t, scanRoot }) {
			return React.createElement("div", { className: "dshph_emptyBox" },
				React.createElement("div", { className: "dshph_emptyIcon", "aria-hidden": true }),
				React.createElement("p", { className: "dshph_emptyMain" }, t("empty")),
				React.createElement("p", { className: "dshph_emptySub" }, t("emptyHint")),
				typeof scanRoot === "string" && scanRoot.length > 0 ? React.createElement("div", { className: "dshph_scanRootWarn" },
					React.createElement("p", { className: "dshph_scanRootPath" }, lookup(t, "empty.scanRootLabel", "") + " " + scanRoot),
					React.createElement("p", { className: "dshph_scanRootHint" }, lookup(t, "empty.scanRootHint", ""))) : null);
		}

		// 迭代8:搜索+筛选后无匹配项目的空态(区别于「扫描根下暂无项目」全局空态)。
		// 含可操作指引(清空搜索/筛选),点击恢复全量(AC-E1/E2)。
		function NoMatchState({ t, onClear }) {
			return React.createElement("div", { className: "dshph_emptyBox" },
				React.createElement("div", { className: "dshph_emptyIcon", "aria-hidden": true }),
				React.createElement("p", { className: "dshph_emptyMain" }, t("noMatch")),
				React.createElement("p", { className: "dshph_emptySub" }, t("noMatchHint")),
				React.createElement("button", { type: "button", className: "dshph_actionBtn dshph_clearAll", onClick: onClear }, t("search.clear")));
		}

		// 迭代9(i8-fix)缺陷一:被归档隐藏的匹配项目提示。
		// 受限态(列表非空但存在被隐藏的匹配归档项):列表上方内联提示条 + 一键显示。
		function HiddenArchivedHint({ t, count, onReveal }) {
			return React.createElement("div", { className: "dshph_hiddenArchived" },
				React.createElement("span", { className: "dshph_hiddenArchivedText" },
					`${t("filter.archivedHidden")} ${count} ${t("filter.archivedHiddenUnit")}`),
				React.createElement("button", { type: "button", className: "dshph_actionBtn", onClick: onReveal }, t("filter.showArchived")));
		}
		// 空态(列表为空但存在被隐藏的匹配归档项):空态主文案改提示 + 一键显示(A1/A2)。
		function HiddenArchivedEmptyState({ t, count, onReveal, onClear }) {
			return React.createElement("div", { className: "dshph_emptyBox" },
				React.createElement("div", { className: "dshph_emptyIcon", "aria-hidden": true }),
				React.createElement("p", { className: "dshph_emptyMain" },
					`${t("filter.archivedHidden")} ${count} ${t("filter.archivedHiddenUnit")}`),
				React.createElement("p", { className: "dshph_emptySub" }, t("noMatchHint")),
				React.createElement("div", { className: "dshph_emptyActions" },
					React.createElement("button", { type: "button", className: "dshph_actionBtn", onClick: onReveal }, t("filter.showArchived")),
					React.createElement("button", { type: "button", className: "dshph_actionBtn dshph_clearAll", onClick: onClear }, t("search.clear"))));
		}

		function BoardOverlay({ t }) {
			const [open, setOpen] = React.useState(board.open);
			const [view, setView] = React.useState("list");
			const [selectedId, setSelectedId] = React.useState(null);
			// kr-control-plane:浮层顶层 tab(项目列表 / 流水线设置)。
			const [tab, setTab] = React.useState("board");
			const [projects, setProjects] = React.useState(null);
			const [budget, setBudget] = React.useState(null);
			const [detail, setDetail] = React.useState(null);
			const [failed, setFailed] = React.useState(false);
			const [refreshFailed, setRefreshFailed] = React.useState(false);
			// 迭代8:搜索/筛选/归档/置顶展示层受控状态(AC-C1)。纯前端,不触发 refetch。
			const [query, setQuery] = React.useState("");
			const [selectedStates, setSelectedStates] = React.useState(new Set());
			// 迭代9(i8-fix):归档可见性拆两态。
			//   archivedOnly:「已归档」chip 排他筛选(缺陷二,点=只剩归档)。
			//   revealArchived:缺陷一「一键显示已归档」并入当前筛选(与状态/搜索同列)。
			const [archivedOnly, setArchivedOnly] = React.useState(false);
			const [revealArchived, setRevealArchived] = React.useState(false);
			const [boardView, setBoardView] = React.useState({ items: {} });
			const [writeFailed, setWriteFailed] = React.useState(false);
			// 0.4.1:当前 scanRoot(零项目空态警示用;随主刷新一并拉取)。
			const [scanRoot, setScanRoot] = React.useState(null);
			// boardViewRef 始终持最新 boardView,避免乐观更新闭包读到过期值。
			const boardViewRef = React.useRef(boardView);
			boardViewRef.current = boardView;

			React.useEffect(() => subscribeBoard(() => setOpen(board.open)), []);

			// 刷新当前视图数据(保留 view/selectedId;失败保留旧数据 + transient 提示)。
			const refresh = React.useCallback(() => {
				if (view === "detail" && selectedId !== null) {
					fetchProject(selectedId).then((d) => {
						if (d) setDetail(d);
						setRefreshFailed(false);
					}).catch(() => setRefreshFailed(true));
				} else {
					Promise.all([fetchProjects(), fetchBudget(), fetchBoardView(), fetchConfig()]).then(([projs, bud, bv, cfg]) => {
						setProjects(projs);
						setBudget(bud);
						setBoardView(bv);
						if (cfg && typeof cfg.scanRoot === "string") setScanRoot(cfg.scanRoot);
						setRefreshFailed(false);
					}).catch(() => setRefreshFailed(true));
				}
			}, [view, selectedId]);

			React.useEffect(() => {
				if (!open) return;
				let cancelled = false;
				setFailed(false);
				Promise.all([fetchProjects(), fetchBudget(), fetchBoardView(), fetchConfig()]).then(([projs, bud, bv, cfg]) => {
					if (cancelled) return;
					setProjects(projs);
					setBudget(bud);
					setBoardView(bv);
					if (cfg && typeof cfg.scanRoot === "string") setScanRoot(cfg.scanRoot);
				}).catch(() => {
					if (!cancelled) setFailed(true);
				});
				return () => { cancelled = true; };
			}, [open]);

			React.useEffect(() => {
				if (!open || view !== "detail" || selectedId === null) return;
				let cancelled = false;
				setDetail(null);
				fetchProject(selectedId).then((d) => {
					if (!cancelled) setDetail(d);
				}).catch(() => {
					if (!cancelled) setFailed(true);
				});
				return () => { cancelled = true; };
			}, [open, view, selectedId]);

			// 15 秒自动刷新当前视图(open 时启动,close/unmount 清理)。
			React.useEffect(() => {
				if (!open) return;
				const id = setInterval(refresh, AUTO_REFRESH_MS);
				return () => clearInterval(id);
			}, [open, refresh]);

			// 迭代8:归档/置顶写操作。乐观更新 + 写端点落盘;失败回滚 + writeFailed 提示。
			const applyChange = React.useCallback((id, change) => {
				const prev = boardViewRef.current;
				const next = applyBoardChange(prev, Object.assign({ id }, change));
				setBoardView(next);
				setWriteFailed(false);
				writeBoardView(id, change).then((res) => {
					if (res && res.ok) setBoardView(res.board || next);
					else { setBoardView(prev); setWriteFailed(true); }
				}).catch(() => { setBoardView(prev); setWriteFailed(true); });
			}, []);

			// 迭代8:状态筛选 chip 切换(多选 Set)。
			// 迭代9(i8-fix):点状态 chip 时取消「已归档」排他态(与四态互斥,B2)。
			const toggleState = React.useCallback((s) => {
				setArchivedOnly(false);
				setSelectedStates((prev) => {
					const next = new Set(prev);
					if (next.has(s)) next.delete(s);
					else next.add(s);
					return next;
				});
			}, []);

			// 迭代9(i8-fix)缺陷二:「已归档」chip 排他筛选。开启时清空状态 chips(互斥),
			// 并取消缺陷一的并入态(避免语义叠加)。
			const toggleArchivedOnly = React.useCallback(() => {
				setArchivedOnly((prev) => {
					const next = !prev;
					if (next) {
						setSelectedStates(new Set());
						setRevealArchived(false);
					}
					return next;
				});
			}, []);

			// 迭代9(i8-fix)缺陷一:一键显示被归档隐藏的匹配项目(并入当前筛选)。
			const revealHiddenArchived = React.useCallback(() => {
				setRevealArchived(true);
			}, []);

			// 迭代8:清空搜索/筛选(空态指引用,恢复全量)。
			const clearFilters = React.useCallback(() => {
				setQuery("");
				setSelectedStates(new Set());
				setArchivedOnly(false);
				setRevealArchived(false);
			}, []);

			if (!open) return null;
			const ws = budget?.workspace;
			// 迭代8:渲染管线 = applyBoardView(合并 pinned/archived)→ filterProjects
			// (搜索+状态筛选+归档可见性)→ sortProjects(用户置顶 > active 置顶)。
			// 纯前端受控状态,不触发 refetch(AC-S4/F3/C1/C2)。
			const merged = applyBoardView(projects, boardView);
			const filterOpts = { query, states: selectedStates, archivedOnly, revealArchived };
			const filtered = filterProjects(merged, filterOpts);
			const { active: activeProjects, parked: parkedProjects } = sortProjects(filtered);
			// 迭代9(i8-fix)缺陷一:被归档隐藏的匹配项目数 + 归档总数(chip 计数徽章)。
			const hiddenArchivedCount = countHiddenArchivedMatches(merged, filterOpts);
			const archivedTotal = countArchived(merged);
			// 提示仅在存在筛选(状态/搜索)且未开已归档、未并入时出现,避免默认视图噪音。
			const hasActiveFilter = selectedStates.size > 0 || query.trim().length > 0;
			const showHiddenArchivedHint = !archivedOnly && !revealArchived && hasActiveFilter && hiddenArchivedCount > 0;
			// 迭代8:搜索/筛选工具条(搜索框 + 状态 chips + 已归档 toggle)。
			const toolbar = React.createElement("div", { className: "dshph_toolbar" },
				React.createElement("div", { className: "dshph_search" },
					React.createElement("input", { className: "dshph_searchInput", type: "text", value: query, placeholder: t("search.placeholder"), "aria-label": t("search.placeholder"), onChange: (e) => setQuery(e.target.value) }),
					query.length > 0 ? React.createElement("button", { type: "button", className: "dshph_searchClear", "aria-label": t("search.clear"), onClick: () => setQuery("") }, "×") : null,
				),
				React.createElement("div", { className: "dshph_filterChips" },
					React.createElement("span", { className: "dshph_filterLabel" }, t("filter.state")),
					["active", "delivered", "rejected", "parked"].map((s) =>
						React.createElement("button", { key: s, type: "button", className: "dshph_chipFilter" + (selectedStates.has(s) ? " dshph_chipFilterOn" : ""), "data-state": s, "aria-pressed": selectedStates.has(s), onClick: () => toggleState(s) }, stateLabel(s, t))),
					React.createElement("button", { type: "button", className: "dshph_chipFilter dshph_chipArchived" + (archivedOnly ? " dshph_chipFilterOn" : ""), "aria-pressed": archivedOnly, onClick: toggleArchivedOnly }, t("filter.archived") + (archivedTotal > 0 ? ` (${archivedTotal})` : "")),
				),
			);
			return React.createElement("div", { className: "dshph_overlay", role: "dialog", "aria-label": t("title") },
				React.createElement("div", { className: "dshph_overlayHeader" },
					React.createElement("span", { className: "dshph_overlayTitle" }, t("title")),
					React.createElement("button", { type: "button", className: "dshph_closeBtn", onClick: refresh }, t("refresh")),
					React.createElement("button", { type: "button", className: "dshph_closeBtn", onClick: () => setBoardOpen(false) }, t("close")),
				),
				// kr-control-plane:浮层顶层 tab(项目列表 / 流水线设置)。
				React.createElement("div", { className: "dshph_tabs" },
					React.createElement("button", { type: "button", className: "dshph_tab", "data-active": tab === "board" ? "true" : undefined, onClick: () => setTab("board") }, t("tab.board")),
					React.createElement("button", { type: "button", className: "dshph_tab", "data-active": tab === "settings" ? "true" : undefined, onClick: () => setTab("settings") }, t("tab.settings")),
				),
				React.createElement("div", { className: "dshph_overlayBody" },
					tab === "settings" ? React.createElement(SettingsPanel, { t })
					: React.createElement("div", { className: "dshph_page" },
						failed ? React.createElement("p", { className: "dshph_errorLine" }, t("error")) : null,
						refreshFailed ? React.createElement("p", { className: "dshph_errorLine" }, t("refreshFailed")) : null,
						view === "list" ? React.createElement(React.Fragment, null,
							ws ? React.createElement("section", { className: "dshph_sec", "aria-label": t("workspace") },
								React.createElement("div", { className: "dshph_secHead" },
									React.createElement("span", { className: "dshph_secNo" }, "01"),
									React.createElement("h2", { className: "dshph_secTitle" }, t("workspace"))),
								React.createElement("div", { className: "dshph_workspace" },
									React.createElement("div", { className: "dshph_wsStat" },
										React.createElement("span", { className: "dshph_wsStatLabel" }, t("projectCount")),
										React.createElement("b", null, ws.projectCount)),
									// kr-board-time-token(R2):移除「上报条目数」统计块(committedEntryCount 不再展示)。
									// kr-board-time-token(R1):工作区真实 token 总量经 formatToken 可读化;悬浮 title 保留精确值。
									React.createElement("div", { className: "dshph_wsStat" },
										React.createElement("span", { className: "dshph_wsStatLabel" }, t("totalTokens")),
										React.createElement("b", { title: tokenTitle(ws.totalTokens) }, formatToken(ws.totalTokens ?? 0))),
									React.createElement("div", { className: "dshph_wsSub" },
										`${t("bySource")}: ${sourceCountsText(ws.bySource, t)}${ws.sharedOnce ? ` · ${t("sharedOnce")}: ${ws.sharedOnce}` : ""}`))) : null,
							projects === null ? React.createElement(LoadingState, { t })
								: projects.length === 0 ? React.createElement(EmptyState, { t, scanRoot })
								: React.createElement(React.Fragment, null,
									toolbar,
									writeFailed ? React.createElement("p", { className: "dshph_errorLine" }, t("writeFailed")) : null,
									// 迭代8:两段均无匹配 → 空态(AC-E1/E2);否则按段渲染。
									// 迭代9(i8-fix)缺陷一:空态/受限态存在被归档隐藏的匹配项目时,
									// 提示「另有 N 个已归档项目被隐藏」+ 一键显示,不静默吞(A1/A2/A3)。
									activeProjects.length === 0 && parkedProjects.length === 0
										? (showHiddenArchivedHint
											? React.createElement(HiddenArchivedEmptyState, { t, count: hiddenArchivedCount, onReveal: revealHiddenArchived, onClear: clearFilters })
											: React.createElement(NoMatchState, { t, onClear: clearFilters }))
										: React.createElement(React.Fragment, null,
											showHiddenArchivedHint ? React.createElement(HiddenArchivedHint, { t, count: hiddenArchivedCount, onReveal: revealHiddenArchived }) : null,
											activeProjects.length > 0 ? React.createElement("section", { className: "dshph_sec", "aria-label": t("projectList") },
												React.createElement("div", { className: "dshph_secHead" },
													React.createElement("span", { className: "dshph_secNo" }, "02"),
													React.createElement("h2", { className: "dshph_secTitle" }, t("projectList")),
													React.createElement("div", { className: "dshph_secSide" },
														React.createElement("span", { className: "dshph_badge dshph_badgeState", "data-state": "active" }, t("state.active")),
														React.createElement("span", { className: "dshph_badge dshph_badgeState", "data-state": "delivered" }, t("state.delivered")),
														React.createElement("span", { className: "dshph_badge dshph_badgeState", "data-state": "parked" }, t("state.parked")),
														React.createElement("span", { className: "dshph_badge dshph_badgePending" }, t("pendingGate")))),
												React.createElement("div", { className: "dshph_rows" },
													activeProjects.map((p, i) => React.createElement("div", {
														key: p.id,
														onClick: () => { setSelectedId(p.id); setView("detail"); },
														onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(p.id); setView("detail"); } },
													}, React.createElement(ProjectCard, { project: p, t, index: i, onPin: (proj) => applyChange(proj.id, { pinned: !proj.pinned }), onArchive: (proj) => applyChange(proj.id, { archived: !proj.archived }) })))),
											) : null,
											parkedProjects.length > 0 ? React.createElement("section", { className: "dshph_sec", "aria-label": t("stagingArea") },
												React.createElement("div", { className: "dshph_secHead" },
													React.createElement("span", { className: "dshph_secNo" }, "03"),
													React.createElement("h2", { className: "dshph_secTitle" }, t("stagingArea")),
													React.createElement("div", { className: "dshph_secSide" },
														React.createElement("span", { className: "dshph_badge dshph_badgeState", "data-state": "parked" }, t("state.parked")),
														React.createElement("span", { className: "dshph_text" }, t("stagingAreaHint")))),
												React.createElement("div", { className: "dshph_rows" },
													parkedProjects.map((p, i) => React.createElement("div", {
														key: p.id,
														onClick: () => { setSelectedId(p.id); setView("detail"); },
														onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelectedId(p.id); setView("detail"); } },
													}, React.createElement(ProjectCard, { project: p, t, index: i, onPin: (proj) => applyChange(proj.id, { pinned: !proj.pinned }), onArchive: (proj) => applyChange(proj.id, { archived: !proj.archived }) })))),
											) : null,
										),
								),
						) : React.createElement(React.Fragment, null,
							detail === null ? React.createElement(LoadingState, { t })
								: React.createElement(DetailView, { project: detail, t, onBack: () => { setView("list"); setDetail(null); } }),
						),
					),
				),
			);
		}

		// ── 设置卡(扫描根目录配置)────────────────────────────────────────────
		const CARD_CSS = [
			".dshph_card2{border:1px solid var(--dshph-line2);background:var(--dshph-card);border-radius:4px;list-style:none;transition:border-color .16s,background .16s}",
			".dshph_card2:hover{border-color:var(--dshph-edge)}",
			".dshph_card2[data-open=\"true\"]{background:var(--dshph-card);border-color:var(--dshph-edge)}",
			".dshph_header{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:4px;align-items:center;gap:12px;padding:14px 16px;display:flex}",
			".dshph_header:focus-visible{outline:2px solid var(--dshph-accent);outline-offset:-2px}",
			".dshph_headText{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}",
			".dshph_name{color:var(--dshph-ink);font-size:15px;font-weight:600;line-height:1.4}",
			".dshph_description{color:var(--dshph-ink3);font-size:13px;line-height:1.5}",
			".dshph_chevron{color:var(--dshph-ink3);flex:none;display:flex;transition:transform .16s}",
			".dshph_chevron[data-open=\"true\"]{transform:rotate(180deg)}",
			".dshph_body{border-top:1px solid var(--dshph-line2);margin:0 16px;padding:14px 0 16px;display:flex;flex-direction:column;gap:10px}",
		].join("\n");
		function ensureCardStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector(`style[data-plugin-css="${CSS_TAG}-card"]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.pluginCss = `${CSS_TAG}-card`;
			tag.textContent = CARD_CSS;
			document.head.appendChild(tag);
		}

		const fieldStyles = {
			fields: { display: "flex", flexWrap: "wrap", alignItems: "flex-end", gap: "16px" },
			field: { display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 320px", minWidth: "240px" },
			label: { fontSize: "13px", fontWeight: 500, lineHeight: "18px", color: "var(--dshph-ink2)" },
			input: {
				boxSizing: "border-box",
				height: "32px",
				width: "100%",
				font: "inherit",
				fontSize: "14px",
				color: "var(--dshph-ink)",
				background: "var(--dshph-card)",
				border: "1px solid var(--dshph-line2)",
				borderRadius: "4px",
				padding: "0 10px",
			},
			button: {
				height: "32px",
				font: "inherit",
				fontSize: "14px",
				color: "var(--dshph-ink)",
				background: "var(--dshph-card)",
				border: "1px solid var(--dshph-line2)",
				borderRadius: "4px",
				padding: "0 14px",
				cursor: "pointer",
			},
			hint: { margin: 0, fontSize: "13px", lineHeight: "18px", color: "var(--dshph-ink3)" },
			ok: { margin: 0, fontSize: "13px", lineHeight: "18px", color: "var(--dshph-ok)" },
			error: { margin: 0, fontSize: "13px", lineHeight: "18px", color: "var(--dshph-warn)" },
		};

		function SettingsCard({ t }) {
			const [open, setOpen] = React.useState(false);
			const [scanRoot, setScanRoot] = React.useState(null);
			const [draft, setDraft] = React.useState("");
			const [busy, setBusy] = React.useState(false);
			const [failed, setFailed] = React.useState(null);
			const [applied, setApplied] = React.useState(false);
			React.useEffect(() => {
				let cancelled = false;
				fetchConfig().then((config) => {
					if (cancelled) return;
					setScanRoot(config?.scanRoot ?? null);
					setDraft(config?.scanRoot ?? "");
				}).catch(() => {
					if (!cancelled) setFailed(t("configError"));
				});
				return () => { cancelled = true; };
			}, []);
			if (scanRoot === null && failed === null) return null;
			const title = t("title");
			const unchanged = scanRoot !== null && draft === scanRoot;
			const submit = () => {
				if (busy || unchanged) return;
				setBusy(true);
				setFailed(null);
				setApplied(false);
				fetch(API_ROUTE, {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ section: { scanRoot: draft } }),
				}).then(async (response) => {
					const payload = await response.json();
					if (!payload.ok) {
						setFailed(typeof payload.error === "string" && payload.error.length > 0 ? payload.error : t("configError"));
						return;
					}
					setScanRoot(payload.config?.scanRoot ?? draft);
					setDraft(payload.config?.scanRoot ?? draft);
					setApplied(true);
				}).catch(() => setFailed(t("configError"))).finally(() => setBusy(false));
			};
			const chevron = React.createElement("svg", {
				className: "dshph_chevron",
				"data-open": open ? "true" : undefined,
				width: 14,
				height: 14,
				viewBox: "0 0 14 14",
				fill: "none",
				"aria-hidden": true,
			}, React.createElement("path", {
				d: "M3 5.2 7 9.2l4-4",
				stroke: "currentColor",
				strokeWidth: 1.5,
				strokeLinecap: "round",
				strokeLinejoin: "round",
			}));
			return React.createElement("li", { className: "dshph_card2", "data-open": open ? "true" : undefined },
				React.createElement("button", {
					type: "button",
					className: "dshph_header",
					"aria-expanded": open,
					"aria-label": `${t(open ? "collapse" : "expand")}: ${title}`,
					onClick: () => setOpen(!open),
				},
					React.createElement("span", { className: "dshph_headText" },
						React.createElement("span", { className: "dshph_name" }, title),
						React.createElement("span", { className: "dshph_description" }, t("description")),
					),
					chevron,
				),
				open ? React.createElement("div", { className: "dshph_body" },
					React.createElement("div", { style: fieldStyles.fields },
						React.createElement("label", { style: fieldStyles.field },
							React.createElement("span", { style: fieldStyles.label }, t("scanRoot")),
							React.createElement("input", {
								style: fieldStyles.input,
								type: "text",
								value: draft,
								"aria-label": t("scanRoot"),
								onChange: (e) => { setDraft(e.target.value); setApplied(false); setFailed(null); },
								onKeyDown: (e) => { if (e.key === "Enter") submit(); },
							}),
						),
						React.createElement("button", {
							type: "button",
							style: fieldStyles.button,
							disabled: busy || unchanged,
							onClick: submit,
						}, busy ? t("applying") : t("apply")),
					),
					React.createElement("p", { style: fieldStyles.hint }, t("configHint")),
					applied ? React.createElement("p", { style: fieldStyles.ok }, t("applied")) : null,
					failed !== null ? React.createElement("p", { style: fieldStyles.error }, failed) : null,
				) : null,
			);
		}

		// ── 流水线设置面板(kr-control-plane:块 A 策略编辑 + 块 B 每角色模型)──
		// 挂载于看板浮层「流水线设置」tab。数据经 GET ?view=settings 拉取;
		// 写面仅经 API 层(PUT { settings: { auditRules | roleModel } }),护栏 AC-A2。
		const SETTINGS_CSS = [
			// kr-control-plane-i2:左侧分区导航 + 右侧内容区(两模块)。
			".dshph_settings{display:flex;gap:24px;align-items:flex-start;padding:24px}",
			".dshph_settingsNav{flex:none;width:180px;display:flex;flex-direction:column;gap:4px;position:sticky;top:20px}",
			".dshph_settingsNavBtn{appearance:none;font:inherit;text-align:left;cursor:pointer;background:transparent;border:0;border-radius:6px;padding:10px 14px;font-size:14px;color:var(--dshph-ink2);display:flex;align-items:center;gap:8px}",
			".dshph_settingsNavBtn:hover{background:var(--dshph-wash)}",
			".dshph_settingsNavBtn.active{background:var(--dshph-accent-wash);color:var(--dshph-accent);font-weight:600}",
			".dshph_settingsNavIdx{font-family:var(--dshph-serif);font-size:12px;color:var(--dshph-ink3);letter-spacing:.1em}",
			".dshph_settingsNavBtn.active .dshph_settingsNavIdx{color:var(--dshph-accent)}",
			".dshph_settingsContent{flex:1;min-width:0;display:flex;flex-direction:column;gap:20px}",
			".dshph_settingsBlock{border:1px solid var(--dshph-line2);border-radius:6px;background:var(--dshph-card);padding:18px 20px}",
			".dshph_settingsBlockTitle{font-family:var(--dshph-serif);font-size:16px;font-weight:700;color:var(--dshph-ink);letter-spacing:.05em;margin:0 0 14px}",
			".dshph_settingsRow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:10px}",
			".dshph_settingsLabel{font-size:13px;color:var(--dshph-ink2);min-width:120px}",
			".dshph_settingsInput{box-sizing:border-box;height:30px;font:inherit;font-size:13px;color:var(--dshph-ink);background:var(--dshph-card);border:1px solid var(--dshph-line2);border-radius:4px;padding:0 8px}",
			".dshph_settingsSelect{box-sizing:border-box;height:30px;font:inherit;font-size:13px;color:var(--dshph-ink);background:var(--dshph-card);border:1px solid var(--dshph-line2);border-radius:4px;padding:0 8px;min-width:280px}",
			".dshph_settingsBtn{height:30px;font:inherit;font-size:13px;color:var(--dshph-ink);background:var(--dshph-card);border:1px solid var(--dshph-line2);border-radius:4px;padding:0 14px;cursor:pointer}",
			".dshph_settingsBtn:disabled{opacity:.5;cursor:default}",
			".dshph_settingsBtnPrimary{background:var(--dshph-accent);color:#fff;border-color:var(--dshph-accent)}",
			".dshph_settingsHint{font-size:13px;color:var(--dshph-ink3);line-height:1.6;margin:6px 0 0}",
			".dshph_settingsOk{font-size:13px;color:var(--dshph-ok);margin:8px 0 0}",
			".dshph_settingsErr{font-size:13px;color:var(--dshph-warn);margin:8px 0 0}",
			".dshph_roleCard{border:1px solid var(--dshph-line2);border-radius:6px;background:var(--dshph-card);padding:14px 16px;margin-bottom:12px}",
			".dshph_roleHead{display:flex;align-items:center;gap:10px;margin-bottom:6px}",
			".dshph_roleName{font-size:14px;font-weight:600;color:var(--dshph-ink);flex:1}",
			".dshph_roleDuty{font-size:13px;color:var(--dshph-ink3);line-height:1.6;margin:0 0 8px}",
			".dshph_roleCur{font-size:13px;color:var(--dshph-ink2)}",
			".dshph_roleCur b{color:var(--dshph-ink);font-weight:600}",
			".dshph_roleEdit{margin-top:10px;border-top:1px solid var(--dshph-line);padding-top:10px;display:flex;flex-direction:column;gap:8px}",
			".dshph_roleWarn{font-size:13px;color:var(--dshph-warn);background:var(--dshph-warn-bg);border:1px solid var(--dshph-warn-line);border-radius:4px;padding:6px 10px;margin:0}",
			".dshph_roleUnsaved{font-size:13px;color:var(--dshph-warn);margin:0}",
			".dshph_saveLocation{font-size:13px;color:var(--dshph-ink3);margin:0;line-height:1.5}",
			".dshph_roleActions{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}",
			".dshph_settingsSource{display:inline-block;font-size:13px;padding:2px 8px;border-radius:3px;border:1px solid var(--dshph-line2);color:var(--dshph-ink3)}",
			".dshph_settingsSource[data-source=\"workspace\"]{color:var(--dshph-accent);border-color:var(--dshph-accent)}",
			".dshph_settingsSource[data-source=\"preset\"]{color:var(--dshph-info);border-color:var(--dshph-info-line)}",
			".dshph_settingsSource[data-source=\"default\"]{color:var(--dshph-ink3);border-color:var(--dshph-line2)}",
		].join("\n");
		function ensureSettingsStyles() {
			if (typeof document === "undefined") return;
			if (document.querySelector(`style[data-plugin-css="${CSS_TAG}-settings"]`) !== null) return;
			const tag = document.createElement("style");
			tag.dataset.pluginCss = `${CSS_TAG}-settings`;
			tag.textContent = SETTINGS_CSS;
			document.head.appendChild(tag);
		}

		// ── 流水线设置面板(kr-control-plane-i2:两模块重做)──────────────────
		// 范围缩为两模块(design-gate round 3 C-A~C-D):块 1 沉淀策略(只留沉淀开关 +
		// 沉淀阈值 + 保存,C-D);块 2 每角色模型(角色卡片 + 职责说明 + 模型下拉动态
		// 渲染 dsh 已配置模型清单 C-A/C-B + 恢复默认 C3 + 红线提示)。
		// 「沉淀凭证」「只读展示」已移出设置 tab(C-C);规则表/新增规则/高级设置全部
		// 移出(C-D,规则的增删改走流水线,UI 不做)。
		// 写面仅经 API 层(PUT { settings: { auditRules | roleModel } }),护栏 AC-A2。
		// C-D 护栏:UI 写 audit-rules.json 读-改-写(applySedimentationChange 只动
		// meta.sedimentation,rules[] 原样透传),不得整体覆盖清掉 rules[]。
		function SettingsPanel({ t }) {
			const [settings, setSettings] = React.useState(null);
			const [failed, setFailed] = React.useState(false);
			const [section, setSection] = React.useState("sedimentation"); // 分区导航
			const [auditDraft, setAuditDraft] = React.useState(null);
			const [roleDrafts, setRoleDrafts] = React.useState(null);
			const [models, setModels] = React.useState(null); // null=模型清单不可用;数组=可用(可能为空)
			const [busy, setBusy] = React.useState(false);
			const [saveMsg, setSaveMsg] = React.useState(null); // { kind: 'ok'|'error', text }
			const [editingRole, setEditingRole] = React.useState(null);
			// 0.4.1:scanRoot(保存落点提示用)。
			const [scanRoot, setScanRoot] = React.useState(null);

			React.useEffect(() => {
				let cancelled = false;
				Promise.all([fetchSettings(), fetchModels(), fetchConfig()]).then(([s, m, cfg]) => {
					if (cancelled) return;
					if (!s) { setFailed(true); return; }
					setSettings(s);
					setAuditDraft(JSON.parse(JSON.stringify(s.auditRules)));
          setRoleDrafts((s.roles || []).map((r) => ({ role: r.role, provider: typeof r.provider === "string" ? r.provider : (r.model && r.model.provider ? r.model.provider : ""), model: typeof r.model === "string" ? r.model : (r.model && r.model.model ? r.model.model : ""), source: r.source })));
					setModels(m); // null=模型清单不可用;数组=可用(可能为空)
					if (cfg && typeof cfg.scanRoot === "string") setScanRoot(cfg.scanRoot);
				}).catch(() => { if (!cancelled) setFailed(true); });
				return () => { cancelled = true; };
			}, []);

			if (failed) return React.createElement("p", { className: "dshph_errorLine" }, t("settings.loadFailed"));
			if (settings === null || auditDraft === null || roleDrafts === null) return React.createElement(LoadingState, { t });

			const sed = auditDraft.meta && auditDraft.meta.sedimentation ? auditDraft.meta.sedimentation : {};
			const setSed = (key, value) => setAuditDraft((prev) => {
				const next = JSON.parse(JSON.stringify(prev));
				if (!next.meta || typeof next.meta !== "object") next.meta = {};
				if (!next.meta.sedimentation || typeof next.meta.sedimentation !== "object") next.meta.sedimentation = {};
				next.meta.sedimentation[key] = value;
				return next;
			});

			const saveAudit = () => {
				if (busy) return;
				const n = Number(sed.everyNDelivered);
				if (!(n >= 1)) { setSaveMsg({ kind: "error", text: t("settings.thresholdInvalid") }); return; }
				// C-D 护栏:读-改-写,只动 meta.sedimentation,rules[] 原样透传。
				const next = applySedimentationChange(auditDraft, { enabled: sed.enabled === true, everyNDelivered: n });
				setBusy(true); setSaveMsg(null);
				writeAuditRules(next).then((res) => {
					if (res && res.ok) { setAuditDraft(JSON.parse(JSON.stringify(res.settings.auditRules))); setSaveMsg({ kind: "ok", text: t("settings.saved") }); }
					else setSaveMsg({ kind: "error", text: t("settings.saveFailed") + (res && res.error ? " " + res.error : "") });
				}).catch(() => setSaveMsg({ kind: "error", text: t("settings.saveFailed") })).finally(() => setBusy(false));
			};

			const saveRole = (role) => {
				if (busy) return;
				const draft = roleDrafts.find((r) => r.role === role);
				if (!draft) return;
				setBusy(true); setSaveMsg(null);
				writeRoleModel(role, draft.provider, draft.model).then((res) => {
					if (res && res.ok) {
						setRoleDrafts((prev) => prev.map((r) => r.role === role ? Object.assign({}, r, { provider: res.settings.roleModel.model.provider, model: res.settings.roleModel.model.model, source: "workspace" }) : r));
						// 0.4.1:同步 settings.roles 快照,避免未保存徽章在保存成功后因快照过期而误亮。
						setSettings((prev) => prev ? Object.assign({}, prev, { roles: (prev.roles || []).map((s) => s && s.role === role ? Object.assign({}, s, { provider: res.settings.roleModel.model.provider, model: res.settings.roleModel.model.model, source: "workspace" }) : s) }) : prev);
						setEditingRole(null);
						setSaveMsg({ kind: "ok", text: t("settings.saved") });
					} else setSaveMsg({ kind: "error", text: t("settings.saveFailed") + (res && res.error ? " " + res.error : "") });
				}).catch(() => setSaveMsg({ kind: "error", text: t("settings.saveFailed") })).finally(() => setBusy(false));
			};

			const setRoleField = (role, key, value) => setRoleDrafts((prev) => prev.map((r) => r.role === role ? Object.assign({}, r, { [key]: value }) : r));

			// C3 恢复默认(卡点 b1 裁决方案 A):移除 workspace 覆盖,回退默认档。
			// 服务端返回 reset 后的真实来源与 effectiveModel(preset 声明或默认继承),
			// 来源徽章据此正确显示「预设声明」或「默认继承」。
			const restoreDefault = (role) => {
				const name = mapRole(role, t);
				if (window.confirm(t("settings.restoreConfirm").replace("{role}", name))) {
					setBusy(true); setSaveMsg(null);
					resetRoleModel(role).then((res) => {
						if (res && res.ok) {
							const rm = res.settings && res.settings.roleModel ? res.settings.roleModel : {};
							const provider = rm.model && rm.model.provider ? rm.model.provider : "";
							const model = rm.model && rm.model.model ? rm.model.model : "";
							setRoleDrafts((prev) => prev.map((r) => r.role === role ? Object.assign({}, r, { provider, model, source: rm.source || "default" }) : r));
							// 0.4.1:同步 settings.roles 快照(与 saveRole 同理,防徽章误亮)。
							setSettings((prev) => prev ? Object.assign({}, prev, { roles: (prev.roles || []).map((s) => s && s.role === role ? Object.assign({}, s, { provider, model, source: rm.source || "default" }) : s) }) : prev);
							setEditingRole(null);
							setSaveMsg({ kind: "ok", text: t("settings.saved") });
						} else setSaveMsg({ kind: "error", text: t("settings.saveFailed") + (res && res.error ? " " + res.error : "") });
					}).catch(() => setSaveMsg({ kind: "error", text: t("settings.saveFailed") })).finally(() => setBusy(false));
				}
			};

			// C-B:模型下拉选项展示 provider+model 真实型号串(人话只作后缀,不得替代型号本身)。
			const modelOptions = (r) => {
				const curKey = r.provider + "|" + r.model;
				const known = (models || []).some((m) => m.provider + "|" + m.model === curKey);
				const opts = [];
				if (!known) {
					opts.push(React.createElement("option", { key: "cur", value: curKey }, r.model + " · " + r.provider + "(" + t("settings.notInList") + ")"));
				}
				(models || []).forEach((m) => {
					const key = m.provider + "|" + m.model;
					const ctx = Number.isFinite(m.contextWindow) ? (m.contextWindow >= 10000 ? Math.round(m.contextWindow / 1000) / 10 + "万" : String(m.contextWindow)) : null;
					opts.push(React.createElement("option", { key: key, value: key }, m.model + " · " + m.provider + (ctx ? " · 上下文 " + ctx : "")));
				});
				return opts;
			};

			// 块 1:沉淀策略(C-D 只留沉淀开关 + 沉淀阈值 + 保存)
			const block1 = React.createElement("section", { className: "dshph_settingsBlock", "aria-label": t("settings.nav.sedimentation") },
				React.createElement("h3", { className: "dshph_settingsBlockTitle" }, t("settings.nav.sedimentation")),
				React.createElement("div", { className: "dshph_settingsRow" },
					React.createElement("label", { className: "dshph_settingsLabel" }, t("settings.sedimentation")),
					React.createElement("input", { type: "checkbox", checked: sed.enabled === true, onChange: (e) => setSed("enabled", e.target.checked), "aria-label": t("settings.sedimentation") }),
					React.createElement("span", { className: "dshph_settingsHint" }, t("settings.sedimentationHint")),
				),
				React.createElement("div", { className: "dshph_settingsRow" },
					React.createElement("label", { className: "dshph_settingsLabel" }, t("settings.everyNDelivered")),
					React.createElement("input", { className: "dshph_settingsInput", type: "number", min: 1, value: sed.everyNDelivered ?? 10, onChange: (e) => setSed("everyNDelivered", Number(e.target.value)), "aria-label": t("settings.everyNDelivered") }),
					React.createElement("span", { className: "dshph_settingsHint" }, t("settings.everyNDeliveredHint")),
				),
				React.createElement("div", { className: "dshph_settingsRow" },
					React.createElement("button", { type: "button", className: "dshph_settingsBtn dshph_settingsBtnPrimary", disabled: busy, onClick: saveAudit }, busy ? t("settings.saving") : t("settings.save"))),
				saveMsg && saveMsg.kind === "ok" ? React.createElement("p", { className: "dshph_settingsOk" }, saveMsg.text) : null,
				saveMsg && saveMsg.kind === "error" ? React.createElement("p", { className: "dshph_settingsErr" }, saveMsg.text) : null,
			);

			// 块 2:每角色模型(角色卡片 + 职责说明 + 模型下拉 C-A/C-B + 恢复默认 C3 + 红线提示)
			const roleCards = roleDrafts.map((r) => {
				const isDefault = r.source === "default";
				const editing = editingRole === r.role;
				// 0.4.1:未保存徽章(编辑态下草稿与服务端已存状态不一致时提示;纯函数判定)。
				const savedRole = (settings.roles || []).find((s) => s && s.role === r.role) ?? null;
				const dirty = editing && isRoleDraftDirty(savedRole, r);
				return React.createElement("div", { key: r.role, className: "dshph_roleCard" },
					React.createElement("div", { className: "dshph_roleHead" },
						React.createElement("span", { className: "dshph_roleName" }, mapRole(r.role, t)),
						React.createElement("span", { className: "dshph_settingsSource", "data-source": r.source }, lookup(t, "settings.source." + r.source, r.source)),
					),
					React.createElement("p", { className: "dshph_roleDuty" }, lookup(t, "settings.roleDuty." + r.role, "")),
					React.createElement("div", { className: "dshph_roleCur" }, t("settings.currentModel"), " ", React.createElement("b", null, r.provider + " / " + r.model)),
					editing ? React.createElement("div", { className: "dshph_roleEdit" },
						React.createElement("div", { className: "dshph_settingsRow" },
							React.createElement("label", { className: "dshph_settingsLabel" }, t("settings.selectModel")),
							models === null
								? React.createElement("span", { className: "dshph_settingsErr" }, t("settings.modelsUnavailable"))
								: (models.length > 0
									? React.createElement("select", { className: "dshph_settingsSelect", value: r.provider + "|" + r.model, onChange: (e) => { const [pp, mm] = e.target.value.split("|"); setRoleField(r.role, "provider", pp); setRoleField(r.role, "model", mm); }, "aria-label": t("settings.selectModel") }, modelOptions(r))
									: React.createElement("span", { className: "dshph_settingsHint" }, t("settings.noModels"))),
						),
						React.createElement("p", { className: "dshph_roleWarn" }, t("settings.modelWarn")),
						dirty ? React.createElement("p", { className: "dshph_roleUnsaved" }, lookup(t, "settings.unsaved", "")) : null,
						React.createElement("div", { className: "dshph_roleActions" },
							React.createElement("button", { type: "button", className: "dshph_settingsBtn dshph_settingsBtnPrimary", disabled: busy, onClick: () => saveRole(r.role) }, busy ? t("settings.saving") : t("settings.save")),
							React.createElement("button", { type: "button", className: "dshph_settingsBtn", onClick: () => setEditingRole(null) }, t("settings.cancel")),
						),
					) : null,
					React.createElement("div", { className: "dshph_roleActions" },
						React.createElement("button", { type: "button", className: "dshph_settingsBtn", onClick: () => setEditingRole(r.role) }, t("settings.modifyModel")),
						isDefault ? null : React.createElement("button", { type: "button", className: "dshph_settingsBtn", onClick: () => restoreDefault(r.role) }, t("settings.restoreDefault")),
					),
				);
			});
			const block2 = React.createElement("section", { className: "dshph_settingsBlock", "aria-label": t("settings.nav.roles") },
				React.createElement("h3", { className: "dshph_settingsBlockTitle" }, t("settings.nav.roles")),
				scanRoot ? React.createElement("p", { className: "dshph_saveLocation" }, lookup(t, "settings.saveLocationHint", "").replace("{root}", scanRoot)) : null,
				roleCards,
			);

			// 左侧分区导航 + 右侧内容区(纯前端受控,不重新拉取)
			const nav = React.createElement("nav", { className: "dshph_settingsNav", "aria-label": t("tab.settings") },
				React.createElement("button", { type: "button", className: "dshph_settingsNavBtn" + (section === "sedimentation" ? " active" : ""), onClick: () => setSection("sedimentation") },
					React.createElement("span", { className: "dshph_settingsNavIdx" }, "01"), t("settings.nav.sedimentation")),
				React.createElement("button", { type: "button", className: "dshph_settingsNavBtn" + (section === "roles" ? " active" : ""), onClick: () => setSection("roles") },
					React.createElement("span", { className: "dshph_settingsNavIdx" }, "02"), t("settings.nav.roles")),
			);
			const content = React.createElement("div", { className: "dshph_settingsContent" },
				section === "sedimentation" ? block1 : block2,
			);

			return React.createElement("div", { className: "dshph_settings" }, nav, content);
		}

		// ── 装载 ────────────────────────────────────────────────────────────
		function applyPlugin(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "project-hub-ui: dictionaries");
			ensureStyles();
			ensureCardStyles();
			ensureSettingsStyles();

			// 1) 侧栏底部动作区入口
			ctx.slots.inject(SLOT_SIDEBAR, () => ctx.slots.register({
				name: SLOT_SIDEBAR,
				id: "project-hub",
				key: "project-hub",
				order: 10,
				locale: NS,
				inject: () => ({}),
			}, SidebarEntry));

			// 2) 全幅浮层看板主体
			ctx.slots.inject(SLOT_OVERLAY, () => ctx.slots.register({
				name: SLOT_OVERLAY,
				id: "project-hub",
				key: "project-hub",
				order: 10,
				locale: NS,
				inject: () => ({}),
			}, BoardOverlay));

			// 3) 设置页「插件配置」卡(扫描根目录配置)
			ctx.slots.inject(SLOT_SETTINGS, () => ctx.slots.register({
				name: SLOT_SETTINGS,
				id: "project-hub",
				key: "project-hub",
				order: 50,
				locale: NS,
				inject: () => ({}),
			}, SettingsCard));
		}

		exports.apply = applyPlugin;
		exports.inject = inject;
		return module.exports;
	},
});

//# sourceURL=dsh-project-hub-ui/lib/client.js
