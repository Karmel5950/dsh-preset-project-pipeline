# dsh 插件工程化开发方案

以 zcode(第三方 harness)作为开发环境,开发调试 DeepSeek Harness (dsh) 的 preset 与本地插件。
源码在此工作空间受 git 管理,部署目标是 `~/.dsh/.agent-presets/`(dsh 的用户 preset 安装根)。

> **配套 skill**:本工作流的入口已固化为 zcode skill `dsh-plugin-dev`
> (`E:\04-Programs\dsh\.agents\skills\dsh-plugin-dev\SKILL.md`)。
> 在 zcode 会话里提出"开发/调试/发布 dsh 插件、preset、宿主面插件"类需求时它会自动加载;
> 修改工作流后应同步更新该 skill,保持两者一致。

## 目录结构

```
plugindev/
├── package.json              # 工作空间脚本入口(见下文命令)
├── dsh-runtime.lock.json     # 兼容性锚:开发所依据的 dsh 运行时版本快照
├── AGENTS.md                 # 后续 zcode 会话自动遵守的开发约定(硬规则)
├── toolkit/                  # 开发工具链(本身零依赖,借用运行时树解析)
│   ├── paths.mjs             # 路径常量:运行时树 / DSH_HOME / 安装根 / API 地址
│   ├── dialect.mjs           # 用运行时的 loader 方言离线解析 agent.cordis.yml(!!js → 标记)
│   ├── lint-composition.mjs  # 离线静态检查:行形状 / 包存在性 / 重复 id / isolate 用法
│   ├── stub-ctx.mjs          # 单测桩:构造最小 cordis ctx(捕获监听器/注册/日志)
│   ├── dsh-api.mjs           # dsh web JSON-RPC 客户端(信封封装)
│   ├── check.mjs             # `npm run check`:node --check + 全量 lint
│   ├── validate.mjs          # 四级验证流水线(见下文)
│   ├── deploy.mjs            # 复制到安装根 + 写部署戳;--list 对账;--uninstall 移入 .trash
│   ├── new-preset.mjs        # 从 _template 脚手架新 preset
│   └── refresh-lock.mjs      # 刷新 dsh-runtime.lock.json
├── presets/
│   ├── _template/            # 新 preset 模板(目录名不合法 preset id,不会被误发现)
│   │   ├── package.json      # 该 preset 自己的版本号(语义化版本)
│   │   ├── preset.yml        # 展示元数据(name/description)
│   │   ├── agent.cordis.yml  # 组合文件(可挂载的最小可用组合)
│   │   ├── plugins/          # 本地插件(纯 ESM,零依赖,随 preset 部署)
│   │   └── test/             # 该 preset 的单元测试
│   └── vision-bridge/        # 非视觉模型图片桥接(拦截 read_image 转文字描述)
├── external-plugins/         # 外部克隆的插件仓库参考(自带 .git,整目录被 gitignore)
├── host-plugins/             # 宿主面(profile patch 级)插件,不走 preset 安装根
│   ├── subagent-settings/    # 子代理默认模型/思考强度:设置面板行 + 热设置命名空间
│   ├── lan-access/           # 局域网网关(独立端口代理官方实例)+「插件配置」卡片:端口热改
│   └── vision-bridge/        # 非视觉模型上传图片自动转文字描述(宿主 admission 层桥接)
├── shared/                   # 跨插件共享设施(dsh-compat 兼容层:权威源 + 设计文档)
├── project-pipeline/         # 项目制交付基础设施与框架(登记簿/角色库/预算账本/流程模板引擎;流程是数据不定死;P1 preset 基于官方 standard / P2 project-hub 宿主面)
├── eval/                     # preset A/B 对照实验框架(自动化 e2e 必经,见 eval/README.md)
└── test/                     # toolkit 自身的测试
```

## 环境隔离(开发 / 测试 / 生产)

| 环境 | 载体 | 触碰方式 |
|---|---|---|
| **dev 开发** | 源码工作空间 `plugindev/`(`npm run check` / `npm test`) | 纯离线,不接触任何 dsh 实例 |
| **test 测试** | 独立 dsh web 实例:`DSH_HOME=plugindev/.dsh-home`,端口 3081 | `npm run env:up` 拉起;deploy/validate **默认**落这里 |
| **prod 生产** | 你的日常实例:`~/.dsh`,端口 3080 | **只有显式 `--env prod`** 才触碰 |

隔离原理:`DSH_HOME` 重定向整套 dsh 状态(settings、`.agent-presets` 安装根、会话库、profiles),测试实例与生产实例只共享只读的固化运行时树(`dsh-runtime/node_modules`)。因此在 test 里部署的 preset **不会出现在生产模式选择器**,验证产生的会话**留在 test 会话列表**,生产会话列表零污染。首次 `env:up` 会复制生产的 settings.yaml(该文件不含密钥明文)。**test 实例默认模型 = opencode-go 的 `deepseek-v4-flash`,`reasoningEffort: max`**(2026-08-15 用户配置;凭据 `OPENCODE_GO_API_KEY` 已存 test home `.credentials.yaml`,另有一个占位 `DEEPSEEK_API_KEY` 防无凭据弹窗)—— 真实 e2e 默认用它跑。

发布到生产 = 环境根目录单 git 仓库,一次部署 = 一次提交(见 AGENTS.md 硬规则 8):①部署前 `git -C ~/.dsh status` 确认,有未提交改动先提交基线快照(只按路径 add);②`npm run deploy -- --preset <id> --env prod` + `npm run validate -- --preset <id> --env prod` 四级全过;③一次提交整个部署(预设/插件/cordis.patch.yml/settings.yaml),信息注明来源版本与变更要点;回退 = `git revert <部署提交>`。运行时依赖(`node_modules/`、`.credentials.yaml`、`sessions/` 等)在环境根 `.gitignore` 统一忽略。

```bash
start-dsh-web-test.bat   # 交互式启动测试实例(持久化 CMD 窗口,3081;agent 工具调用不闪屏)
start-dsh-web.bat        # 启动生产实例(持久化 CMD 窗口,3080)
restart-dsh-web-test.bat # 重启 test:结束 3081 进程树 -> 新窗口拉起(硬重启)
restart-dsh-web.bat      # 重启 prod:同上(3080);UI 可达时优先 agent 的 restart_now 优雅重启
npm run env:up           # 脚本化拉起测试实例(无窗口模式;仅适合无需 agent 工具调用的场景)
npm run env:status       # 查看状态
npm run env:down         # 停止
```

> **启动规范(2026-08-16 用户决策)**:实例启动必须用持久化 CMD 窗口脚本(`start-dsh-web-test.bat` / `start-dsh-web.bat`),node 前台运行、子进程共享控制台;无窗口/后台方式启动会让 agent 每次工具调用 spawn 子进程时**闪屏弹 CMD 窗口**(`npm run env:up` 是 windowsHide 无窗口模式,仅限脚本化场景)。

## 快速上手

```bash
cd E:\04-Programs\dsh\plugindev
npm run env:up                      # 0. 拉起隔离的测试实例(一次性)

npm run new -- --id my-preset        # 1. 脚手架(复制模板 + 替换占位符)
#    ...编辑 presets/my-preset/{agent.cordis.yml,plugins/*.mjs} ...
npm run check                        # 2. 语法 + 离线 lint(无需 dsh)
npm test                             # 3. 单元测试(stub ctx,无需 dsh)
npm run deploy -- --preset my-preset # 4. 安装到 test 环境(生产不受影响)
npm run validate -- --preset my-preset  # 5. 四级验证(打 test 实例)
npm run deploy -- --list             # 随时对账:test 与 prod 两列状态
npm run compat:scan                  # dsh-compat 能力满足报告(升级 SOP 核心步;--diff 对比上次)
npm run upgrade:runtime -- <版本>    # 内核半自动升级(dry-run;--apply=备份+安装+锚+scan)
```

> **内核(dsh-runtime)升级 SOP**:权威文档 `..\docs\dsh-runtime.md`「升级」——
> 半自动段用 `npm run upgrade:runtime`,人工回归段(check/test/deploy/curl/validate/浏览器实测)与 prod 决策点见文档。

## 测试流程(四级流水线)

| 级 | 命令 | 依赖 | 检查内容 |
|---|---|---|---|
| L1 语法+lint | `npm run check` | 无(离线) | `.mjs` 语法;组合文件用**运行时同款 loader 方言**解析(`!!js` 不执行、标记化);行形状;裸包名在运行时树中存在;相对路径插件文件存在;id 重复;`isolate` 值合法 |
| L2 单元测试 | `npm test` | 无(离线) | 插件行为:import `apply()` + `toolkit/stub-ctx.mjs` 桩 ctx + 假事件驱动,`node --test` 原生跑 |
| L3 roster | `validate`(在线) | dsh web | `agentPreset.list`:preset 被 discovery 看到、trust=user、无 broken |
| L4 挂载 | `validate`(在线) | dsh web | 空白会话上 `agentPreset.select` → 触发真实挂载(等价官方 `standingKeyFor` 检查),失败即报错;**零 token**(不发 prompt)。会话随后改名 `plugindev mount-check`,可在 UI 手动关闭 |

L4 之后的实机验收:在 web UI 选该 preset 开真实会话,或对会话发实际任务(消耗 token,人工决定)。

注意:**headless profile 不挂 preset roster**(其组合是进程级、无 agent-presets 行),preset 的自动化验证只能走 web API,不能用 `--profile headless`。

## host-plugins(宿主面插件)

`host-plugins/<id>/` 存放**宿主面插件**——经 `<DSH_HOME>/profiles/web/cordis.patch.yml`
的 `insert` 行挂载(web 进程的 profile 组合层),**不走** preset 安装根,与 agent preset
体系正交。适合做:web 设置面板扩展、跨会话的宿主服务/HTTP 通道、热设置命名空间。

与 preset 插件的区别:部署目标是 `<DSH_HOME>/profiles/web/{plugins/,node_modules/}`,
部署脚本自带(`node host-plugins/<id>/deploy.mjs`,支持 `--uninstall` / `--env prod
--confirm-prod`);浏览器 UI 需要单独的 client 包放到 `<profile>/node_modules/`
(声明 `dsh.client` + `exports["./client"]`,经 client-modules 引导图送达,详见
`host-plugins/subagent-settings/README.md` 的架构决策一节)。

关键事实(开发宿主面插件前必读):

- **client-module 引导图只在进程启动时合成**:增/删/改 UI 包后必须重启 web 实例
  (`npm run env:down && npm run env:up`);web-app patch 显式禁用了 hmr 行。
- **`dsh-host-apiproxy` 的 settings 客户端有白名单**(可配置模型提供方 + 显式清单):
  宿主插件注册的自定义 settings 命名空间**不会**出现在 `settings.describe`,也**不能**
  经 `settings.update/mutate` 写。UI 读写要么走插件自有的 `webServer.register` HTTP
  通道(subagent-settings 的做法),要么挂靠已有白名单命名空间。
- profile patch 的 insert 行支持相对路径插件(`./plugins/xxx.mjs`,相对 profile 目录)
  与裸包名(`<profile>/node_modules` 里可解析的包)。

发布到 prod:`node host-plugins/<id>/deploy.mjs --env prod --confirm-prod` + 重启
prod web 实例(两步都要用户显式确认,见 AGENTS.md 硬规则 6)。

## 版本管理

- **源码**:本工作空间随外层仓库(`E:\04-Programs\dsh`)走 git。每个 preset 独立语义化版本(`presets/<id>/package.json` 的 `version`),变更写 `presets/<id>/CHANGELOG.md`,发布打 tag:`plugindev/<id>/vX.Y.Z`。
- **部署戳**:`deploy` 在安装目录写 `.plugindev-deploy.json`(源版本、git commit、dsh 版本、时间)。`deploy --list` 对比源与安装戳,报 `IN SYNC / STALE / NOT DEPLOYED`。
- **兼容性锚**:`dsh-runtime.lock.json` 记录开发时依据的 `@deepseek-ai/dsh` 版本与关键依赖版本;`validate` 比对当前运行时版本,不一致时警告(dsh 处于 rc 期,官方预告破坏性变更)。升级运行时后跑 `npm run lock:refresh` 重新锚定,并回归全部 preset。
- **部署仓库 = 环境根目录单 git 仓库**:prod 根 `~/.dsh`、test 根 `plugindev/.dsh-home` 各建一个仓库,deploy 改变其工作树后按"一次部署 = 一次提交"提交,形成部署历史(回退 = `git revert`);UI 包/依赖在 `node_modules/` 被 gitignore,可经 deploy 再生成。

## 已知限制

- 本地插件不能 import npm 包(不在 Node 解析路径上);需要新包时只能等 pnpm 可用后走 `dsh plugin --profile web add <pkg>`。
- 组合 stamp 只盯 `agent.cordis.yml`;改 plugins/skills 后需 touch 组合文件才对新会话生效。
- 无法经 API 删除会话;validate 的挂载检查会在会话列表留下一个标记了名字的空白会话。
- 运行中会话永远停留在它加入时的代际;验证新代际必须开新会话。

## 参考

- 官方插件开发教程(即内置"创造模式"的两个 skill):`dsh-runtime/node_modules/@deepseek-ai/dsh/config/agent-presets/cordis/skills/{editing-cordis-compositions,cordis-plugin-development}/SKILL.md`
- 官方 preset 服务说明:`dsh-runtime/node_modules/@deepseek-ai/dsh-agent-presets/README.md`
- 参考项目:`E:\04-Programs\dsh\preset\dsh-anchored-standard`(第三方 preset 的完整工程样例)
