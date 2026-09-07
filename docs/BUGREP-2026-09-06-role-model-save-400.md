# BUGREP 2026-09-06 — project-hub 设置卡保存角色模型必 400(「修改的模型保存不下来」)

环境:Windows 11,单环境默认部署(dsh web 实例 127.0.0.1:3080,dsh-home `~/.dsh`;settings.yaml 无 `project-hub:` 节,web 进程未设 `DSH_HOME` 环境变量)。

## 现象(用户原话)

「deepseekHARNESS 流水线插件 为什么我修改的模型保存不下来」——在看板浮层 → 流水线设置 → 每角色模型改下拉后未点保存/未注意反馈;重开面板回到默认。

## 复现实录(本机受控执行,2026-09-06)

与 UI 保存按钮逐字节相同的 PUT:

```
PUT http://127.0.0.1:3080/plugins/project-hub/api
{"settings":{"roleModel":{"role":"dev","provider":"opencode-go","model":"mimo-v2.5"}}}

→ HTTP 400 {"ok":false,"error":"role manifest not found: dev"}
```

同时证实(读侧不报错,只有保存路径暴露):

- `GET ?view=settings`:全部角色 `source=default`(读容错把 presetRolesDir=null 静默降级);
- `GET ?view=models`:模型清单正常(6 条,数据源 `llm-pi-ai.providers`);
- 看板 `GET /`(默认列表):`projects count: 0` —— scanRoot 回退到 dsh 进程 cwd(`C:\Users\liu`),而真实流水线项目在 `D:\AI\ComfyUI-aki-v3\doubao-style-lora-dataset\.dsh-project\`,扫错根 → 看板空白且无解释;
- 全机无任何写痕:`C:\Users\liu\.dsh-library\`、`board-view.json`、`.trash\` 均不存在。

## 根因

`resolvePresetRolesDir` / `resolveProjcachePath` 只有 **显式 config → env `DSH_HOME`** 两级解析。作者环境显式设了 `DSH_HOME` 才可用;单环境默认部署两级皆空 → `presetRolesDir=null` → `writeRoleModel` 找不到 preset 角色声明(`C:\Users\liu\.dsh\.agent-presets\project-pipeline\roles\` 明明存在)→ 400。沉淀策略保存(`writeAuditRules`)不受此影响但同样从未被触发过。

伴生缺陷(即使保存成功也会「存了白存」):看板角色模型写面 = `<scanRoot>/.dsh-library/roles/<角色>.json`,而 scanRoot 回退 = 进程 cwd ≠ 流水线工作区根;流水线角色库(project-roles)只读 `<流水线工作区>/.dsh-library/roles/`。两根不一致 → 覆盖永远不被流水线读到。

## 修复(0.4.1)

1. **host**:`resolvePresetRolesDir` / `resolveProjcachePath` 增第三级回退 `homedir()/.dsh`(与 dsh 单环境默认 dsh-home 一致,同 toolkit paths.mjs 的 DSH_HOME 默认)。
2. **本机配置(热生效,无需重启)**:经看板 API `PUT {section:{scanRoot, presetRolesDir}}` 显式落两级配置,持久化到 settings.yaml——在旧代码运行期即可让保存走通(scanRoot 对齐流水线工作区后,写面落到流水线真正读取的目录)。
3. **UI**:零项目空态显示当前 scanRoot + 修改指引;每角色模型块显示保存落点与一致性提示;角色卡编辑态增「未保存」徽章(下拉改动不点保存即丢弃,此前无任何提示);保存/恢复默认成功后同步 roles 快照防徽章误亮。

## 部署侧基线偏差(修复时发现并回灌)

部署副本 `client.js`(20:07 热修)含仓库缺失的本地补丁:侧栏脚部 dsh-cost-meter/dsh-usage-stats/project-hub 共槽溢出修复 CSS(展开模式 439px 被侧栏 `overflow:hidden` 裁剪)。已先回灌仓库作为 0.4.1 基线,重部署不回退该补丁。

## 测试

- host:122 → **125** 全绿(resolver 第三级回退 ×2 + 通道级复现回归「无显式 config 经 env 解析 preset → 200」×1);
- client:48 → **53** 全绿(isRoleDraftDirty ×3 + 警示 UI 静态核对 ×2);
- preset 套件:292 过 / 3 既有环境性失败(`prompt-render.test.mjs` 依赖本机不存在的 `dsh-runtime` 运行时树,真实仓库同状,与本修复无关)。
