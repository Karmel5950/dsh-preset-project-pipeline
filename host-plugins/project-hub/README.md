# project-hub 项目中心宿主面插件

dsh **宿主面(host-plane)插件**,把 project-pipeline 一期的**文件制登记簿**变成 **web 界面可见的项目中心**。用户打开 dsh web UI,即可在侧栏进入项目看板,一览全部项目的状态/迭代/当前阶段/待裁决门禁/预算,点开单项目看详情(流程/预算/总结/门禁),并在设置页配置扫描根目录。

- **本期是只读视图**:看板不驱动会话、不写账本、不做实时推送(拉取式)。
- 会话驱动 / 重启自动 resume / 真 per-role preset 会话 / projection 推送留待后续迭代。
- 交付到「源码 + 单测 + README + deploy 脚本」为止,**不做真实部署**;deploy 由用户验收后亲自执行。

---

## 1. 架构说明

```
project-hub/
├── project-hub.mjs          # 宿主面插件:登记簿读视图服务 + 预算聚合 + HTTP 通道 + 配置命名空间
├── dsh-compat.mjs           # vendored 兼容层副本(与 shared/dsh-compat 权威源逐字节一致)
├── ui/                      # 浏览器半面包(包名 dsh-project-hub-ui)
│   ├── package.json         # dsh.client.platform=web + inject 声明
│   └── lib/
│       ├── index.js         # 宿主半面桩(无宿主侧行为,apply 空)
│       └── client.js        # 浏览器半面:侧栏入口 + 看板浮层 + 设置卡
├── deploy.mjs               # 部署/卸载脚本(默认 test;prod 需显式确认;卸载入 .trash)
├── test/
│   └── project-hub.test.mjs # 单测(零 npm 依赖,stub ctx + stub fs)
└── README.md
```

**依赖边界(单向,无环):**

```
project-hub.mjs(核心)
   │  import { channel, hotConfig, buildNamespaceSchema, detectRuntime,
   │           assertUsable, readBody, sendJson } from './dsh-compat.mjs'
   ▼
dsh-compat.mjs(vendored 兼容层)
```

- **核心不 import 任何 npm 包**(硬规则 3);文件系统经 `node:fs/promises`(内建)读取,经 deps 注入可替换(单测用 stub fs)。
- **dsh-compat 是唯一外部依赖**:官方 dsh 升级只改 compat 实现,插件不动。
- **无 adapters/ 子目录**:与 consumption-query 不同,本插件读本地文件而非上游 API,无"多提供商"维度;错误分类针对登记簿解析。

### 数据流

```
浏览器半面(看板/设置卡)
  → 同源 fetch GET/PUT /plugins/project-hub/api
  → 宿主 handler(makeApiHandler)
       ├─ GET 默认 → scanProjects(scanRoot) → { ok, projects[] }
       ├─ GET ?project=<id> → readProject → { ok, project }(404 若不存在)
       ├─ GET ?view=budget → scanProjects + aggregateBudget → { ok, budget }
       ├─ GET ?view=config → { ok, config:{ scanRoot } }
       └─ PUT { section:{ scanRoot } } → 校验路径 → settings.replace → { ok, config }
  → 每次命中实时扫描,无缓存
```

### 核心导出面(纯函数,可注入 deps 便于单测)

| 导出 | 作用 |
|---|---|
| `name` / `API_ROUTE` / `NAMESPACE` | 插件名 / 通道路径 `/plugins/project-hub/api` / 配置命名空间 `project-hub` |
| `scanProjects(scanRoot, deps)` | 扫描 scanRoot 下全部 `.dsh-project/`,归一化为列表项数组(含错误分类) |
| `readProject(scanRoot, id, deps)` | 读单项目详情;id 不存在 → null |
| `aggregateBudget(projects)` | 工作区级预算聚合 |
| `buildSchema()` | 配置命名空间 schema |
| `makeApiHandler({ settingsService, deps, logger })` | 构造通道 handler(GET 读视图 / PUT 配置写) |
| `apply(ctx, config)` | 插件装载:注册命名空间 + 通道 |

---

## 2. 通道契约

- **路径**:`GET/PUT /plugins/project-hub/api`(复用 dsh-compat `L1.channel` 嵌套 inject 注册)。
- **方法**:`GET`(读视图)+ `PUT`(配置写);其他方法返回 `405`。
- **语义**:每次命中实时扫描,**无缓存**。
- **鉴权**:沿用 loopback 语义,不加额外鉴权(官方 browser-trust fence 兜底)。

### GET(读视图,数据源)

| 请求 | 语义 |
|---|---|
| `GET /plugins/project-hub/api` | 项目列表:`{ ok, projects: [ §3.1 列表项 ] }` |
| `GET /plugins/project-hub/api?project=<id>` | 单项目详情:`{ ok, project: §3.2 }`;id 不存在 → 404 |
| `GET /plugins/project-hub/api?view=budget` | 预算聚合:`{ ok, budget: §3.3 }` |
| `GET /plugins/project-hub/api?view=config` | 当前配置:`{ ok, config: { scanRoot } }` |

### PUT(配置写)

| 请求 | 语义 |
|---|---|
| `PUT {section:{scanRoot:"<绝对路径>"}}` | 更新扫描根目录;校验(路径存在且为目录)→ 400;成功 → `settings.replace` 持久化 → 返回新配置 |
| `PUT {section:{}}` | 清空覆盖(回退默认扫描根) |

### 通道响应纪律

- 通道本身始终返回 200 + 结构化体(即使某项目解析失败);仅当插件自身装载/通道故障时才非 200。
- 单项目解析失败 → 该项目条目带错误分类,不拖垮整体。

---

## 3. 数据模型(登记簿读视图)

读视图把 `.dsh-project/` 的文件制数据归一化为结构化 JSON。以下形状为**核心契约**,只增不改。

### 3.1 项目列表项(看板卡片)

```jsonc
{
  "id": "project-hub",              // 项目 id(kebab slug)
  "title": "project-hub",           // 标题
  "state": "active",                // active | delivered | rejected(REGISTRY.state)
  "iteration": 1,                   // REGISTRY.iteration
  "stageIndex": 0,                  // REGISTRY.stageIndex(当前阶段指针)
  "currentStage": {                 // 由 stageIndex 从 FLOW.stages 解析
    "id": "clarify",
    "type": "work",                 // work | gate | summary | internalize
    "role": "product"               // work 阶段有;gate 阶段为 null
  },
  "gateStatus": null,               // REGISTRY.gateStatus(null | "pending")
  "pendingGate": null,              // gateStatus=pending 时:{ stageId, title, summary? }
  "budget": {                       // BUDGET.json 摘要(estimate/cap 原样 + committed + totals)
    "estimate": { /* 原样 */ },
    "cap": { /* 原样 */ },
    "committed": [ /* 原样,逐条 */ ],
    "totals": { /* 聚合 */ }
  },
  "hasSummary": true,               // SUMMARY.md 是否存在
  "updatedAt": "2026-08-29T13:07:35.442Z"   // REGISTRY.updatedAt
}
```

> 注:列表项 `budget` 在 SPEC §4.1 的 `{ estimate, cap, totals }` 基础上**增补 `committed`**(只增不改),使 `aggregateBudget` 可单次扫描完成工作区级汇总。

### 3.2 单项目详情(看板详情)

```jsonc
{
  "id": "project-hub",
  "title": "project-hub",
  "registry": { /* REGISTRY.json 原样 */ },
  "flow": { /* FLOW.json 原样(含 stages 全序列) */ },
  "budget": { /* BUDGET.json 原样(estimate/cap/committed/totals) */ },
  "summary": "…",                    // SUMMARY.md 末段截断(默认 500 字符)
  "summaryFile": "SUMMARY.md",       // 全文文件路径(点开可看全文)
  "gates": [                        // gates/ 目录解析出的门禁包清单
    { "stageId": "02-spec-gate", "title": "需求规格确认", "verdict": "approve", "file": "gates/02-spec-gate.md" }
  ],
  "pendingGate": null,              // 当前待裁决门禁(若有)
  "journals": [ "01-clarify.md", "02-spec-gate.md" ]   // journal/ 文件清单
}
```

### 3.3 预算聚合

```jsonc
{
  "projects": [                    // 每项目一条
    { "id": "project-hub", "estimate": { /* 原样 */ }, "cap": { /* 原样 */ }, "committed": [ /* 原样 */ ], "totals": { /* 原样 */ } }
  ],
  "workspace": {                   // 工作区级汇总(尽力而为)
    "projectCount": 3,
    "committedEntryCount": 12,     // 全部 committed 条目数
    "byRole": { "product": 5, "architect": 3, "dev": 4 },   // 按 role 计数
    "bySource": { "self-report": 8, "runtime-events": 4 }    // 按 source 计数
  }
}
```

- 每项目预算**原样透传**(estimate/cap/committed/totals),不解释、不篡改。
- 工作区级汇总为**尽力而为**:`byRole`/`bySource` 按 `committed[].role`/`source` **计数**(usage 形状自由,数值求和不可靠;精确核算口径是账本配置)。
- 预算只读展示,不写账本。

### 3.4 待裁决门禁判定

- 判定依据:`REGISTRY.gateStatus === "pending"` **且** 当前阶段(`FLOW.stages[stageIndex]`)类型为 `gate`。
- 满足时 `pendingGate = { stageId, title, summary? }`;`summary` 从 `gates/NN-<stageId>.md` 的"摘要"节解析;文件缺失或解析失败 → 仅给 `stageId/title`。

### 3.5 错误分类(登记簿解析)

| category | 触发条件 |
|---|---|
| `missing-registry` | `REGISTRY.json` 缺失/不可读 |
| `malformed-registry` | `REGISTRY.json` 坏 JSON 或形状不符(缺 id/title/state) |
| `malformed-flow` | `FLOW.json` 坏 JSON 或形状不符;currentStage 解析失败 |
| `malformed-budget` | `BUDGET.json` 坏 JSON |
| `unreadable` | 其他读错误(权限/IO) |

**分类优先级**:`missing-registry`/`malformed-registry` 最高(项目无法识别 → 整项错误分类);REGISTRY 正常后 FLOW/BUDGET 坏 → 项目仍返回(受影响字段置 null + 该项带错误分类);SUMMARY/gates/journal 缺失/坏 → 非致命,对应字段置空。

**错误条目形状**:`{ "id": "<project-id>", "error": { "category": "…", "message": "…" } }`

---

## 4. 配置说明

- **命名空间**:`project-hub`(kebab-case,与 dsh-settings NAMESPACE_PATTERN 匹配)。
- **唯一键**:`scanRoot`(字符串,绝对路径)。
- **默认扫描根**:会话工作区(实现:默认取 dsh 进程工作目录 `process.cwd()`,实例从工作区根启动时即工作区根);经设置页可改。
- **schema 解析语义**:未知键剥离;`scanRoot` 须为非空字符串;section 缺失/空 → `{}`(回退默认扫描根)。
- **PUT 校验**:`scanRoot` 路径存在且为目录 → 否则 400(路径存在性校验在 PUT handler 做,schema 只做类型校验)。
- **热生效**:`settings.replace` 持久化到 settings.yaml 的 `project-hub` 段,写入后热生效。

---

## 5. 浏览器半面 UI

三处挂点(用户定案):

| 槽位 | 用途 |
|---|---|
| `sidebar.footer.action` | 侧栏底部动作区入口,点击打开全幅浮层看板 |
| `shell.overlay` | 全幅浮层看板主体(项目列表 + 单项目详情 + 预算聚合) |
| `settings.plugin.item` | 设置页「插件配置」卡(扫描根目录配置) |

- **待裁决门禁醒目提示**:有 `pendingGate` 的项目在列表上突出显示(徽章 + 高亮),提示用户去裁决。
- **双语**:zh/en(对齐 lan-access 先例)。
- **零构建**:plain JS + React.createElement;卡片/浮层 chrome 用一次性注入的 `<style>`。
- **数据获取**:同源 `fetch(API_ROUTE)`,拉取式,无推送。

---

## 6. 部署 / 卸载 / 验证

> 本项目交付到「源码 + 单测 + README + deploy 脚本」为止,**不做真实部署**。deploy 由用户验收后亲自执行。流水线运行期间不重启、不改动运行中的 dsh 实例。

### 部署(默认 test 环境)

```bash
node deploy.mjs                 # 部署到 test(端口 3081)
node deploy.mjs --env prod --confirm-prod   # 显式发布到 prod(需用户确认)
```

部署动作:
1. `project-hub.mjs` → `<home>/profiles/web/plugins/`
2. `dsh-compat.mjs`(vendored 兼容层副本)→ `<home>/profiles/web/plugins/`
3. `ui/` 子目录 → `<home>/profiles/web/node_modules/dsh-project-hub-ui/`(浏览器半面包,经 client-module 引导图启动期合成)
4. `cordis.patch.yml` 增补 insert 行(带 begin/end 注释标记,幂等)

宿主面改动需重启 web 实例:`npm run env:down && npm run env:up`(test)。

### 卸载

```bash
node deploy.mjs --uninstall     # 从 test 卸载
node deploy.mjs --uninstall --env prod --confirm-prod   # 从 prod 卸载
```

- 插件文件与 `ui/` 目录移入 `E:\04-Programs\dsh\.trash\`(绝不物理删除)。
- `dsh-compat.mjs` 是共享兼容层副本,可能仍被其他宿主插件引用,**不随本插件卸载**。
- `cordis.patch.yml` 补丁行移除。

### 验证

```bash
# 单测(零 npm 依赖,stub ctx + stub fs)
node test/project-hub.test.mjs

# 部署后 curl 通道(需先重启 web 实例)
curl http://127.0.0.1:3081/plugins/project-hub/api
# → { "ok": true, "projects": [ { "id": "project-hub", "state": "active", ... } ] }
curl "http://127.0.0.1:3081/plugins/project-hub/api?view=budget"
# → { "ok": true, "budget": { "projects": [...], "workspace": { ... } } }
curl "http://127.0.0.1:3081/plugins/project-hub/api?view=config"
# → { "ok": true, "config": { "scanRoot": "<workspace>" } }
```

---

## 7. 验收清单

> 本项目交付到代码为止,**不执行重启**。UI 包改动需重启实例后验证,见下。

- [ ] 单测全绿:`node test/project-hub.test.mjs`(35 条,零 npm 依赖)。
- [ ] 核心逻辑最小验证:扫描真实工作区,列表/详情/预算聚合/配置解析正确。
- [ ] `dsh-compat.mjs` 与 `shared/dsh-compat` 权威源逐字节一致(`npm run check` 校验)。
- [ ] deploy 默认打 test 环境;prod 需 `--confirm-prod`;卸载移入 `.trash`;复制 `ui/` 子目录。
- [ ] **UI 包改动需重启实例后验证,本项目交付阶段不执行重启**:侧栏入口(`sidebar.footer.action`)、全幅浮层看板(`shell.overlay`)、设置卡(`settings.plugin.item`)三处挂点需在重启后的 test 实例上实测;若 `sidebar.footer.action`/`shell.overlay` 运行时不可用,按设计降级为 `settings.plugin.item` 卡片。

---

## 8. 运行期边界

- 流水线运行期间不重启、不改动运行中的 dsh 实例;真实部署由用户验收后亲自执行。
- deploy 默认打 test 环境;prod 需显式 `--env prod --confirm-prod`。
- 读视图只读,不写账本、不驱动会话、不做实时推送。
