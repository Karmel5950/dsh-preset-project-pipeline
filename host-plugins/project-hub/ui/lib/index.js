// 宿主半面:无宿主侧行为。浏览器半面(lib/client.js)做三件事:
// 1) 侧栏底部动作区(sidebar.footer.action slot)注册「项目中心」入口,点击打开
//    全幅浮层看板(shell.overlay slot);
// 2) 全幅浮层看板主体:项目列表(状态/迭代/当前阶段/待裁决门禁/预算摘要)+
//    单项目详情下钻(流程/预算/总结/门禁)+ 工作区级预算聚合;
// 3) 设置面板「设置 → 插件 → 插件配置」(settings.plugin.item slot)注册
//    「项目中心」扫描根目录配置卡。
// 宿主数据/写入全部由 project-hub.mjs 注册的 HTTP 通道
// (GET/PUT /plugins/project-hub/api)承担。
export const name = 'dsh-project-hub-ui';

export const inject = [];

export function apply() {}

export default { name, inject, apply };
