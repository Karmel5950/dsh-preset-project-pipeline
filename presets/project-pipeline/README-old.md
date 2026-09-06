# preset: project-pipeline

项目制交付 preset:把用户对话从"交付通道"降级为"需求入口"——用户会话只做接待
(登记 / 批量澄清 / 传达门禁 / 登记反馈,不做实现),登记确认后由后台常驻的
协调者按流程实例驱动角色流水线完成交付;流程本身是数据(模板),不是代码。
定位、动机与全景见 [DESIGN.md](../../project-pipeline/DESIGN.md) §1,P1 实现
契约见 [SPEC-P1.md](../../project-pipeline/SPEC-P1.md)。

## 组成

| 组成 | 说明 |
|---|---|
| `agent.cordis.yml` | 组合文件:基于官方 standard 复制叠加(intake persona、subagent 系 maxDepth=4、去官方 workflow/ralph、挂两本地插件),改动清单见文件头注释 |
| `plugins/project-registry.mjs` | 登记簿插件:project_register / advance / gate / budget / status 五工具 + 共享手册提示段 |
| `plugins/project-roles.mjs` | 角色/流程库插件:role_list / role_show / flow_list / flow_show 四工具,role_show 产出可直接拷进官方 subagent 调用 |
| `roles/*.json` | preset 默认角色库:coordinator/product/architect/dev/tester/deliverer 六份声明式清单,workspace 级 `.dsh-library/roles/` 可覆盖 |
| `flows/standard-flow.json` | 默认流程模板("三道门"只是它的一条实例),登记时可换模板或定制 stages |
| `test/` | 两插件的 stub-ctx 单测,随 `npm test` 一并运行 |

## 本地开发循环

```bash
cd E:\04-Programs\dsh\plugindev
npm run check                                  # 组合文件 lint(loader 方言,!!js 标记化)
npm test                                       # 单测(stub ctx,零依赖)
npm run deploy -- --preset project-pipeline    # 装进 test 环境(plugindev/.dsh-home)
npm run validate -- --preset project-pipeline  # 四级验证(④ = 空白会话真实挂载)
```

改 `agent.cordis.yml` 后新建会话自动生效;改旁边插件文件需 touch 组合文件触发新代际
(详见 `plugindev/AGENTS.md`)。

## 文档

- 设计(权威):[../../project-pipeline/DESIGN.md](../../project-pipeline/DESIGN.md)
- P1 规格(公共契约):[../../project-pipeline/SPEC-P1.md](../../project-pipeline/SPEC-P1.md)
- 变更历史:[CHANGELOG.md](CHANGELOG.md)
