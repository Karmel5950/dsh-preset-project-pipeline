# pipeline-toolkit-drive — 流水线驱动工具

固化自两个临时脚本(tmp-drive.mjs / tmp-watch.mjs)的正式工具,零依赖纯 node(仅 node 内置模块 + 全局 `fetch` / `WebSocket`,Node ≥22)。

- `pipeline-start.mjs` — 登记新需求:创建本项目专属 intake 会话并投递登记投递(P0,kr-p0-intake 交付)。
- `pipeline-drive.mjs` — 向指定 dsh 会话投递一条 prompt。
- `pipeline-watch.mjs` — 后台常驻 watcher:自愈循环 + 单例锁 + 通知适配层(详见文件头与 PIPELINE-DRIVE-PROTOCOL.md)。
- `intake-collect.mjs` — intake 纯问答取回复(session.history 翻页拼 chunk)。
- `tool-usage.mjs` — 工具使用审计:从 dsh 会话存储 + zcode rollout 统计各工具真实使用次数与最近使用时刻。
- 值守驱动协议(工具无关):`PIPELINE-DRIVE-PROTOCOL.md`。

> 插件开发链工具(deploy/check/validate/lint-composition/compat-scan/new-preset/refresh-lock/upgrade-runtime/stub-ctx/dialect/env/paths/dsh-api)同在本目录,清单详表待最小机制补全。
>
> **维护者内件说明**:`paths.mjs` / `deploy.mjs` / `env.mjs` 等开发编排工具面向作者本地 monorepo 布局(仓库上一级存在 sibling `dsh-runtime`),依赖 `dsh-runtime/node_modules/@deepseek-ai/dsh`(`runtimeDshVersion()` / `DSH_BIN`),在独立 clone 下会因缺 sibling `dsh-runtime` 报 ENOENT。本仓库作为公开预设源,外部安装请走仓库根 README「从 GitHub 部署到本地」的直接安装路径,不要依赖这些 dev 内件。

## pipeline-start.mjs

登记新需求(P0 标准入口):`node toolkit/pipeline-start.mjs --prompt <登记投递.md> --base-url http://127.0.0.1:3081`;创建 project-pipeline preset 专属 intake 会话并投递,打印 {sessionId, prompt, tip}。一切调用显式 baseUrl=3081。

## pipeline-drive.mjs

向指定会话 POST `/api/session.prompt` 投递文本,打印 HTTP 状态与响应。

```
node pipeline-drive.mjs --session <sessionId> --prompt <file>
node pipeline-drive.mjs --session <sessionId> --stdin
cat msg.txt | node pipeline-drive.mjs --session <sessionId> --stdin
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--session <id>` | 目标会话 id(必填) | — |
| `--prompt <file>` | 从文件读取 prompt 文本(与 `--stdin` 二选一) | — |
| `--stdin` | 从标准输入读取 prompt 文本(与 `--prompt` 二选一) | — |
| `--api <baseUrl>` | dsh web API 基址 | `http://127.0.0.1:3081` |
| `--timeout-ms <ms>` | 请求超时(毫秒) | `15000` |

**退出码**:`0` 成功(HTTP 2xx 且信封 ok);`1` 失败(参数错误 / 连接失败 / HTTP 非 2xx / 信封非 ok)。

## pipeline-watch.mjs

后台常驻 watcher:①WS 订阅 `/api/events.mux` 捕获会话 question/approval 帧;②每 3 秒轮询轮询根目录下各项目 `.dsh-project/REGISTRY.json` 变化。任一事件触发即写日志并退出;半写瞬时态(JSON 解析失败)跳过不崩。

```
node pipeline-watch.mjs --session <sessionId> [--timeout-min <min>] [--log <path>] [--api <baseUrl>] [--ws-root <dir>]
```

| 参数 | 说明 | 默认 |
|------|------|------|
| `--session <id>` | 要订阅的会话 id(必填) | — |
| `--timeout-min <min>` | 超时分钟,超时无事件 → 退出码 2 | `40` |
| `--log <path>` | 日志文件路径 | `./pipeline-watch.log` |
| `--api <baseUrl>` | dsh web API 基址(WS 用 `ws://` 同源) | `http://127.0.0.1:3081` |
| `--ws-root <dir>` | 轮询根目录(其下各项目 `.dsh-project/REGISTRY.json`) | 当前目录 |

**退出码**:`0` 捕获到事件(question/approval 帧或 REGISTRY 变化);`2` 超时无事件;`1` 参数错误。

## 示例

```bash
# 向会话 abc123 投递文件中的 prompt
node pipeline-drive.mjs --session abc123 --prompt ./task.txt

# 从 stdin 投递
echo "继续项目" | node pipeline-drive.mjs --session abc123 --stdin

# 后台等待会话 abc123 出现 question/approval 帧或 REGISTRY 变化,最多 10 分钟
node pipeline-watch.mjs --session abc123 --timeout-min 10 --log ./watch.log --ws-root <ws-root>

# 工具使用审计(dsh 会话存储 + zcode rollout 双源)
node tool-usage.mjs --out ../pipeline-ws/.dsh-library/tool-usage-report.md
```

> `<ws-root>` = 流水线工作区根,示例来自作者环境(请替换为你本机挂载工作区的真实路径)。

## 环境

- Node ≥ 22(依赖全局 `fetch` 与全局 `WebSocket`;tool-usage 依赖 node:zlib 的 zstd API)。
- 默认 API 基址 `http://127.0.0.1:3081`(test 实例);生产实例为 `http://127.0.0.1:3080`,用 `--api` 覆盖。
- 端口环境变量覆盖:test 隔离实例端口默认 `3081`,用 `DSH_PLUGINDEV_PORT` 改(如 `set DSH_PLUGINDEV_PORT=4000` / `export DSH_PLUGINDEV_PORT=4000`);prod 基址默认 `http://127.0.0.1:3080`,用 `DSH_API` 改。
