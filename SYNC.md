# SYNC — 多设备同步与安装

本仓库是 `project-pipeline` 预设的同步仓库(私有)。一个 dsh 预设就是一个自包含目录——**把它放进 dsh 的预设根目录即完成安装**。

## 全新设备安装

```bash
# 1. clone 到 dsh 的预设根目录下(路径按你的 dsh home 调整)
git clone git@github.com:Karmel5950/dsh-preset-project-pipeline.git \
  ~/.dsh/.agent-presets/project-pipeline

# 2. 确认预设可见(重启实例 / 新建会话后可选到该预设)
# 3. 需要 ollama-cloud 等模型凭据与 subagent-defaults 设置(见下方依赖)
```

## 已安装设备更新

```bash
cd ~/.dsh/.agent-presets/project-pipeline && git pull
```

- `agent.cordis.yml` / preset 插件 `.mjs` / `roles/*.json` 变更:新建会话自动拿新组合;涉及 preset 插件文件与角色的版本升级按 CHANGELOG 标注的「需重启」执行(硬重启实例)。
- 每次发版 CHANGELOG 会注明是否需重启。

## 开发机(源头)发布流程

源头在本机 `plugindev/presets/project-pipeline/`(随主工作区仓库开发、验证),发布 = subtree 推送:

```bash
# 在主工作区仓库根目录:
git subtree split -P plugindev/presets/project-pipeline -b preset-dist
git push origin preset-dist:main   # origin = 本同步仓库;force 与否视快进而定
git branch -D preset-dist
```

约定:**主工作区仓库是唯一开发源头,本同步仓库只读消费**;不要在同步仓库 clone 里直接改(会被下次 split 覆盖)。

## 依赖与兼容声明

- 兼容 dsh **0.1.1-rc.2**(其他版本未测试,官方明示可能存在破坏性变更)。
- 默认模型路由不在预设内——设备需自带凭据(settings.yaml 的 providers/keyEnv/subagent-defaults)。
- 平台说明:角色工具白名单当前按 Windows 部署写(`pwsh`);macOS/Linux 宿主需先做平台化修正(见 CHANGELOG/README 后续版本)。

## 测试

`test/` 依赖主工作区的 `plugindev/toolkit/stub-ctx.mjs`,本同步仓库内暂不可独立运行(发布公开版时会收编)。同步消费不需要跑测试。
