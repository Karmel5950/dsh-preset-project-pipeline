---
name: dsh-pipeline
description: 驱动 dsh 项目制流水线(project-pipeline preset):需求登记、门禁审查与裁决下发、卡点处理、watcher 监控、提问帧应答、交付物应用(APPLY/部署/重启/浏览器验收)。凡用户提到"流水线"、"丢给流水线/交给流水线"、"登记需求/项目"、"门禁"、"卡点"、"裁决"、"项目中心/看板"、"project-pipeline"、"pipeline-ws"、"project_register",或要在 dsh 仓库里推进、查看、修复流水线项目时,一律使用本技能。
---

# dsh-pipeline:流水线驱动技能

把用户需求丢给流水线异步交付,你只做:登记 → 监控 → 门禁/卡点裁决 → 应用交付物 → 验收。
底层插件开发知识见 dsh-plugin-dev 技能;本技能只管"驱动"。

## 0. 常量(本机地面真相,先核实再用)

- 仓库根:`E:\04-Programs\dsh`(git 根);流水线工作区 `plugindev/pipeline-ws/`
- test 实例:`http://127.0.0.1:3081`(prod 3080 **禁止不受控直写**)
- **intake 会话 = 每项目一个**(P0 一次性化,不再有全局固定会话作为工作面):
  - 从 `pipeline-ws/<projectId>/.dsh-project/REGISTRY.json` 的 `sessions` 取 `role==='intake'` 的 `sessionId`(register 时即 auto-record 入册)
  - 新建项目 intake 会话:`node toolkit/pipeline-start.mjs --prompt <登记投递.md> --base-url http://127.0.0.1:3081`(输出 sessionId;权威来源仍是 REGISTRY.sessions)
  - 验证活性:drive 返回 HTTP 200 `accepted:true` 即在
- 工具(都在 `plugindev/` 下执行):
  - 投递:`node toolkit/pipeline-drive.mjs --session <id> --prompt <file.md>`(id 取本项目 REGISTRY.sessions 的 intake)
  - 监控:`node toolkit/pipeline-watch.mjs --session <id> --timeout-min 360 --ws-root E:/04-Programs/dsh/plugindev/pipeline-ws`(与会话 id 解耦,按 --ws-root 轮询 REGISTRY;--session 亦可传本项目 intake id)
  - 建会投递:`node toolkit/pipeline-start.mjs --prompt <登记投递.md> --base-url http://127.0.0.1:3081`
- 登记簿:`pipeline-ws/<projectId>/.dsh-project/REGISTRY.json`,判读字段:`state`(active/parked/delivered/rejected)、`stageIndex`、`gateStatus`(pending=待你裁决);**blockers 无 state 字段,open = 无 `resolvedAt`**;`sessions` 是以 `sessionId` 为键的对象(值含 `role`:`'intake'`/`'coordinator'`;主线程按 role 取键名即得会话 id)
- 流程阶段(以各项目 FLOW.json / journal 编号为准):standard-flow(11 阶段)0 clarify → 1 spec-gate → 2 design → 3 mid-summary → **4 design-gate** → 5 build → 6 test → 7 accept → **8 delivery-gate** → 9 wrap → 10 harvest;adhoc(10 阶段,无 mid-summary)**delivery-gate=7**;lite(6 阶段,缺陷修复用)0 clarify → 1 build → 2 test → **3 delivery-gate** → 4 wrap → 5 harvest
- 裁决库:`pipeline-ws/.dsh-library/rulings.json`(r1 视觉验收用户侧 blocking / r2 交付 handover / r3 deploy IN SYNC+重启 / r4 真实环境用户侧)——角色会自动引用,你裁决时同案同判

## 1. 登记新需求

写投递文件(含用户原话逐字 + 地面真相 + 设计方向候选 + 验收/部署预判),**先经 `node toolkit/pipeline-start.mjs --prompt <登记投递.md>` 在 test 实例创建本项目专属 intake 会话并投递登记,再由该新会话(project-pipeline preset)自行 `project_register`**;本项目后续 drive/watch 的 `--session` 一律从 `REGISTRY.sessions` 取该项目 `role==='intake'` 的会话 id。**登记纪律(0.6.0+)**:

- title 必须**中文**(用户可读),id 必须显式**英文 slug**(如 `project-hub-i9`);纯中文 title 无 id 会被 register 拒收
- 投递文件里写明「建议 title:'…'(中文);建议 id:'…'」,让 intake 落二元组
- 缺陷修复/小改动:建议 lite flow + id 带 `-fix` 后缀
- 探针类(parked 验证等):`parked:true` + 明确"纯探针,验证后 reject 终止"
- 触点重叠(同文件/同组件):在投递里声明,指示 build 停等或排队,勿并行 build
- **路由纪律(P0)**:凡深度调研/架构分析/跨项目对账类需求,一律登记给流水线(不进你接待窗实时作答);「纯问答可直答」仅限**一屏以内、无需工具调研**的情形,超出即引导登记

## 2. 监控(watcher 三铁律)

1. **必传 `--ws-root`**(指向 pipeline-ws)——默认取 cwd,错层 = 基线空 = 整窗全盲
2. **铁律 2(watcher 已机制化)**:重挂 watcher 前无需人肉扫描挂起门禁——`pipeline-watch.mjs` 启动即扫基线,凡 `state==='active' && (gateStatus==='pending' || openBlockers>0)` 的项目立即打印 `EVENT BASELINE-PENDING <清单>` 并按事件路径退出(退出码 3),主线程据此直接处理挂起门禁。运行中项目转终态(delivered/rejected)单独标注 `EVENT STATE-FINAL <projectId> <state>`。常规 REGISTRY-CHANGE / WS question、approval 帧事件照常
3. **铁律 3(自愈循环+单例锁,2026-09-03)**:watcher 默认**常驻不退**——常规事件(阶段推进/新项目/mtime)写日志后继续盯,WS 断线自动重连(指数退避),心跳窗(默认 40 分钟)无变化打 HEARTBEAT 并重扫基线;**只有需人裁决的事件才退出通知**(门禁 pending/卡点 open/终态 STATE-FINAL/question+approval 帧/基线挂起)。**单例锁**(`<ws-root>/.pipeline-watch.lock`):重启直接再跑同一条命令即可——新实例自动探活接管旧实例(杀旧+夺锁),陈旧锁(强杀残留)自动回收,无需人肉清点旧进程;优雅退出/信号经 exit hook 清锁。退出通知后:处理事件 → 重新布防(同一条命令)。旧一次性语义用 `--once` 复现(不参与锁)。
   - **布防必须双通道(2026-09-04 盲区教训)**:registry-only(--session 缺省)看不见提问帧——tester 上抛裁决帧、intake 停摆整夜,REGISTRY 纹丝不动,静默 9.7 小时。布防命令必须带 `--session <active项目intake会话id>`(registry 轮询+帧通道同进程双覆盖);项目交付后 intake 退役,须换新项目 intake id 重挂。且必须 run_in_background(shell `&` 挂载下退出通知进不了对话流=静默死亡)。

事件分类:BASELINE-PENDING(退出码 3)=布防时已有挂起门禁/卡 pending=审门禁;STATE-FINAL=项目转终态(主线程 tag/subtree 收尾);gate pending=审门禁;blockers-open>0=读卡点裁决;question/approval 帧=答提问;stage 推进/NEW-PROJECT/HEARTBEAT=常规,进程不退只记日志。

**通知适配层(工具无关)**:本技能是同一驱动协议的 zcode 封装;watcher 的通知出口可插拔(`--notify-cmd` 环境变量回调 / `--notify-file` NDJSON 事件流 / `--stay` 全自动不退模式),任意 agent 工具(Claude Code/Codex/OpenCode/dsh headless)接上即可值守流水线——工具无关协议见 `plugindev/toolkit/PIPELINE-DRIVE-PROTOCOL.md`(命令清单/事件语义/裁决格式/安全边界/挂载示例)。

## 3. 门禁审查与裁决

读 `<id>/SPEC.md` / `DESIGN.md` / `deliverables/` + `APPLY.md`(APPLY 有时在项目根)+ journal 尾部。裁决用 drive 下发(`--session` 取本项目 REGISTRY.sessions 的 intake 会话 id),模板:

```
【<projectId> · <gate> 裁决(主线程代行,用户未亲裁)】approve/revise/reject。
①<结论与理由> ②<条件,编号 C1/C2…,可检查可验收> ③<执行指令:下一步/停等/排程>
rulingRef:<裁决书落盘路径(feedback/ 下)>
```

**代行标注纪律(2026-09-06 用户指令)**:凡主线程代替用户做出的裁决,标题与正文必须标注「主线程代行(用户未亲裁)」+代行事由;严禁写成「用户裁决/用户要求…」等让用户背书的措辞。涉及用户配置/环境的处置:非破坏性默认可代裁但须标注+汇报并留反悔通道;破坏性操作必须用户亲裁。汇报与记忆中引用裁决时主语必须准确(「我/主线程代行」≠「用户亲裁」)。

审查要点(按门禁类型):
- spec-gate:五维可行性是否如实;AC 判定方划分(模型可验 vs 用户侧 blocking);触点声明;遗留疑问是否给方向不甩用户
- design-gate:选型论证;对既有基线(已部署版本)的叠加关系;测试计划;**修正建议被 architect 反驳时先核实再坚持**
- delivery-gate:交付物完整性(见 §5 检查单);机制3 部署自检三要素(戳版本/commit、源码 HEAD、IN SYNC)

## 4. 卡点(blocker)与提问帧

- 卡点:读 reason/options,按裁决库同案同判;修 preset 配置类缺陷(如白名单缺工具)可直接改源码 + 测试 + commit + deploy + 重启,再下发裁决说明已修
- **提问帧(intake 挂 question 时整条消息队列停摆,drive 会假死)**:WS 订阅拿帧(rpcId 在 mux 帧顶层)→ `POST /api/respond`,信封:
  ```json
  {"type":"client-response","rpcId":"<帧rpcId>","result":{"ok":true,"value":{
    "sessionId":"<会话id>","answer":{"answers":[{"id":"<questionId>","selected":["<选项label原文>"]}]}}}}
  ```
  - **自由文本题(question 无 options 字段)**:`selected:[]` + `custom:"<正文>"`(api-proxy `matchesQuestions` 校验:label 必须在 options 内,故空 options 时 selected 只能为空;非 multiSelect 下 custom 与 selected 互斥;custom trim 后非空)。应答后 revise 意见会被 intake 原样转达协调者。
  - **顺序**:先应答帧,队列才放行;若裁决书已先 drive 投递,它会排在帧后面,应答帧后自然被消化,无需重发。
  - 抓帧:一次性 WS 订阅(mux open 重放挂起帧,同 rpcId);watcher 的帧通道会把重放帧当旧帧去重,不能靠它重取。

## 5. 应用交付物(APPLY 仪式,顺序硬性)

1. **备份**:`.trash/<项目>-<YYYYMMDD_HHMMSS>/`(绝不就地 .bak,绝不真删)
2. 按 APPLY.md 复制交付物到目标路径(preset → `presets/project-pipeline/`,toolkit → `plugindev/toolkit/`)
3. **交付缺口检查单**(三连教训,缺了就用户侧代补并记失败模式):
   - 版本增补(package.json minor/patch bump + CHANGELOG,能力新增=minor/修复=patch;agent.cordis.yml 头注释同步 bump 指引)
   - **仓库全量相关测试**:改了纯函数语义必须同步改既有 `presets/project-pipeline/test/*.test.mjs`,并在 plugindev/ 下跑 `npm test` + `npm run check` 全仓相关套件
   - persona 长度:若交付 `roles/*.json` manifest 形态保持 ≤700;agent.cordis.yml 内联 persona text 不触发 ≤700 校验但仍保持精炼
4. 测试:`node test/<file>.test.mjs` 直跑(沙箱内 node --test 会 EPERM,先例)→ `npm test` + `npm run check`(在 plugindev/ 下)
5. 提交:按路径 git add,commit message 里**测试数字等实测出来再写**
6. 部署:`npm run deploy -- --preset project-pipeline` **必须看到 IN SYNC(版本+commit 双匹配)**——只改源码不 deploy = STALE = 旧代际假失败(selfgrowth 最大教训);host 侧 `node host-plugins/project-hub/deploy.mjs`
7. 重启:`cmd //c restart-dsh-web-test.bat`(后台),curl 3081 验 200;多项目交付攒批一次重启
8. 重启后:drive 发消息唤醒 active 项目协调者(其 intake 会话 = 各项目 REGISTRY.sessions);真实验证(探针/接口/浏览器)

## 6. 版本与同步仪式(交付收口时)

- tag:`git tag plugindev/project-pipeline/vX.Y.Z <commit>`
- 同步仓库(其他设备拉取):
  ```bash
  git subtree split -P plugindev/presets/project-pipeline -b preset-dist
  git push preset-sync preset-dist:main && git branch -D preset-dist
  ```
- 纯 host-plugin 修复(不动 preset 文件)无需 bump preset 版本与 subtree 推送

## 7. 浏览器验收(视觉类 blocking,用 browser-use 技能)

- 开 `http://127.0.0.1:3081` → evaluate 合成 click 点「项目中心」(aria 按钮 click 常超时)
- React 受控输入**必须用 playwright `fill()`**(原生 setter+dispatchEvent 不触发)
- 截图卡死("previous screenshot completing")= 关 tab 重开唯一解;文字 DOM 读数可兜底
- 滚动:找 `scrollHeight>clientHeight+200` 的容器直接改 scrollTop
- 深浅两态:设置按钮 → 「浅色/深色」→ 关闭;`body[data-ds-dark-theme]`(深色=""浅色=null)
- 看板写端点(归档/置顶):`PUT /plugins/project-hub/api` body `{"board":{"id":"<projectId>","pinned|archived":true}}`;护栏测试:未知字段/不存在 id 期望 400

## 8. 已知坑(勿重蹈)

- deploy STALE 假失败(§5.6);watcher 基线竞态(§2.2);提问帧堵队列(§4)
- 旧子代理工具面冻结于 spawn 时刻:改白名单后须重 spawn,resume 不生效
- REGISTRY blockers 无 state 字段;APPLY.md 可能在项目根而非 deliverables/
- tester"自测全过"可能跑的是自带 _selftest 而非仓库测试——应用后必跑仓库全量
- 交付物 client.js 必须以**已部署版本**为基线(git diff tag 核实),勿用旧源码覆盖
- **勿把「某个项目 intake 会话 id」当全局常量复用**:每项目一个,跨项目绝不共享,一律从该项目的 REGISTRY.sessions 现取
- **`git apply` 在仓库子目录里跑会静默跳过**:`git apply` 退出码 0 但全部段 "Skipped"、零落盘(--check 也因此假"clean")——dev 沙箱里 plugindev 是独立 git 根测不出,生产里它是 dsh 仓库的子目录。**必须在仓库根跑 `git apply --directory=plugindev <patch>`**,且应用后必看 `git diff --stat` 核对文件数与行数,再 grep 版本号确认 bump 真的落盘

## 9. 红线

- prod(3080)操作须用户显式确认;`dsh-runtime/` 与市场插件本体只读;dsh-api 调用一律显式 baseUrl=3081,不落 3080 默认
- 文件删除一律 `.trash`;commit 不 push(同步仓库 subtree 推送除外)
- 登记簿 REGISTRY 由流水线工具写,主线程不直写;看板唯一写面 = board-view.json
