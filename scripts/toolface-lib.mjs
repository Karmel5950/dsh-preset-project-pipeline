// toolface-lib.mjs —— 角色工具面一致性核对纯函数(零依赖,node:test 可测)。
//
// 四层工具面:
//   L1 roles/*.json tools.allow(角色 manifest 声明面)
//   L2 agent.cordis.yml per-role 行 config.toolFilter.allow(白名单唯一承重路径)
//   L3 dsh 真实注册工具名(REAL_TOOL_SURFACE,0.4.0 已固化)
//   L4 spawn 冻结语义(改白名单须重 spawn,resume 不生效;fork 携带 fork 行 toolFilter)
//
// 设计纪律(SPEC §7 开发可行性):核对纯函数接受输入数据(roles 清单 / agent.cordis.yml
// 文本 / REAL_TOOL_SURFACE),便于单测构造漂移样本;真实文件读取由入口脚本/用户侧做。
// 本模块为交付物(用户侧代应用),生产集成时把纯函数并入 project-lib.mjs(只增不改),
// REAL_TOOL_SURFACE/FORBIDDEN 与 L4 冻结语义并入 project-lib.mjs 或独立共享模块。
//
// 漂移项形状:
//   { layerA, layerB, role, tool, direction, detail }
//   direction ∈ { declared-extra(声明层比真实层多声明), real-missing(真实层缺失声明层
//   期望的工具), real-extra(真实层比声明层多授予), forbidden(引用禁用工具) }。
//   layerA/layerB 为 'L1'|'L2'|'L3';role 为角色 id(coordinator/dev/...)。

// ---------------------------------------------------------------------------
// 真实工具面基准(0.4.0 固化,与 project-roles.test.mjs 的 REAL_TOOL_SURFACE 同源)。
// 维护注意:若部署工具面变化(新增工具/启用 bash)需同步更新;漂移即报即提示人工核对。
// ---------------------------------------------------------------------------
export const REAL_TOOL_SURFACE = new Set([
  // fs
  'read', 'write', 'edit', 'glob', 'grep',
  // shell(win32)
  'pwsh',
  // web
  'web_search',
  // todo/jobs/goal/plan
  'todo_write', 'job_list', 'job_output', 'job_kill', 'create_goal', 'get_goal', 'update_goal', 'exit_plan_mode',
  // ask
  'ask_user_question',
  // delegation
  'subagent_architect', 'subagent_deliverer', 'subagent_dev', 'subagent_product', 'subagent_tester', 'subagent_coordinator', 'subagent_devhelper',
  'send_message', 'interrupt_agent', 'subagent_control', 'subagent_list_agents',
  // project-registry
  'project_register', 'project_advance', 'project_gate', 'project_budget', 'project_status', 'project_block', 'project_harvest', 'project_audit',
  // project-roles
  'role_list', 'role_show', 'flow_list', 'flow_show',
]);

/** 禁用工具名单(通用 spawn / 未注册 / 平台不符)。 */
export const FORBIDDEN = ['bash', 'web_fetch', 'subagent', 'subagent_fork'];

// ---------------------------------------------------------------------------
// L4 spawn 冻结语义(文档化,供报告引用;AC1「冻结语义文档化」)。
// ---------------------------------------------------------------------------
export const TOOLFACE_FREEZE_SEMANTICS = [
  'L4-1 白名单唯一承重路径 = agent.cordis.yml per-role 行 config.toolFilter.allow;roles/*.json 的 tools.allow 是声明面,运行时实际生效的是 per-role 行。',
  'L4-2 冻结语义:改白名单(roles allow 或 per-role 行 toolFilter)后,已 spawn 的角色会话不生效——必须重 spawn(新会话)才携带新 toolFilter;resume 续聊沿用旧 toolFilter,不生效。',
  'L4-3 fork 语义:fork 路径携带 fork 工具行 config 的 toolFilter(dsh-subagent continuation.js L206/L652 同构);通用 tool-subagent-fork 行若未配 toolFilter,fork 出的子代理继承全量工具面(无过滤)。',
  'L4-4 一致性核对:roles allow 与 per-role 行 toolFilter 应逐字一致;任一漂移(roles 有而 per-role 行无 / per-role 行有而 roles 无)即报。',
];

/** 角色 id → per-role 工具行名(subagent_<roleId>)。 */
export function roleToolName(roleId) {
  return `subagent_${roleId}`;
}

/** 工具行名 → 角色 id(去 subagent_ 前缀)。 */
export function toolNameToRole(toolName) {
  return toolName.replace(/^subagent_/, '');
}

/**
 * 解析 roles 清单 → Map<roleId, Set<tool>>。
 * roles: [{ id, tools: { allow: string[] } }](坏条目跳过,不炸)。
 */
export function parseRolesAllow(roles) {
  const out = new Map();
  for (const r of roles || []) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string') continue;
    const allow = r.tools?.allow;
    if (!Array.isArray(allow)) continue;
    out.set(r.id, new Set(allow));
  }
  return out;
}

/**
 * 解析 agent.cordis.yml 文本 → Map<toolName, Set<tool>>(toolName = subagent_<role>)。
 * 零依赖正则(与 project-roles.test.mjs extractPerRoleAllow 同构,提取为纯函数)。
 */
export function parseCordisPerRoleAllow(cordisText) {
  const out = new Map();
  if (typeof cordisText !== 'string') return out;
  const rowRe = /toolName:\s*(subagent_\w+)[\s\S]*?allow:\s*\[([^\]]*)\]/g;
  let m;
  while ((m = rowRe.exec(cordisText)) !== null) {
    const names = m[2].split(',').map((s) => s.trim()).filter(Boolean);
    out.set(m[1], new Set(names));
  }
  return out;
}

function drift(layerA, layerB, role, tool, direction, detail) {
  return { layerA, layerB, role, tool, direction, detail };
}

/**
 * L1 vs L2 交叉核对(核心缺口,kr-p4-route 事故根因):roles allow vs per-role 行
 * toolFilter.allow。两集各自 ⊆ 真实面仍成立时,本核对仍能命中——roles 有而 per-role
 * 行无(角色实际调不起)或 per-role 行有而 roles 无(白名单授予未声明工具)。
 */
export function checkL1vsL2(rolesAllow, cordisAllow) {
  const drifts = [];
  for (const [roleId, allowSet] of rolesAllow) {
    const row = cordisAllow.get(roleToolName(roleId));
    if (!row) {
      for (const tool of allowSet) {
        drifts.push(drift('L1', 'L2', roleId, tool, 'real-missing',
          `roles/${roleId}.json allow 含 ${tool},但 agent.cordis.yml 无 ${roleToolName(roleId)} 行 → 角色实际调不起`));
      }
      continue;
    }
    for (const tool of allowSet) {
      if (!row.has(tool)) {
        drifts.push(drift('L1', 'L2', roleId, tool, 'real-missing',
          `roles/${roleId}.json allow 含 ${tool},但 ${roleToolName(roleId)} 行 toolFilter.allow 缺失 → 角色实际调不起(kr-p4-route 事故根因)`));
      }
    }
    for (const tool of row) {
      if (!allowSet.has(tool)) {
        drifts.push(drift('L1', 'L2', roleId, tool, 'real-extra',
          `${roleToolName(roleId)} 行 toolFilter.allow 含 ${tool},但 roles/${roleId}.json allow 未声明 → 白名单授予了未声明工具`));
      }
    }
  }
  return drifts;
}

/**
 * L2 vs L3 核对:per-role 行 toolFilter.allow ⊆ 真实工具面。引用真实面不存在的工具
 * → spawn 被拒(0.4.0 R4-AC3 语义,提取为可复用纯函数)。
 */
export function checkL2vsL3(cordisAllow, realSurface) {
  const drifts = [];
  for (const [toolName, allowSet] of cordisAllow) {
    const roleId = toolNameToRole(toolName);
    for (const tool of allowSet) {
      if (!realSurface.has(tool)) {
        drifts.push(drift('L2', 'L3', roleId, tool, 'declared-extra',
          `${toolName} 行 toolFilter.allow 引用 ${tool},但不在真实工具面(REAL_TOOL_SURFACE)→ spawn 被拒`));
      }
    }
  }
  return drifts;
}

/**
 * L1 vs L3 核对:roles allow ⊆ 真实工具面。引用真实面不存在的工具 → 声明多余
 * (0.4.0 R4-AC1 语义,提取为可复用纯函数)。
 */
export function checkL1vsL3(rolesAllow, realSurface) {
  const drifts = [];
  for (const [roleId, allowSet] of rolesAllow) {
    for (const tool of allowSet) {
      if (!realSurface.has(tool)) {
        drifts.push(drift('L1', 'L3', roleId, tool, 'declared-extra',
          `roles/${roleId}.json allow 引用 ${tool},但不在真实工具面(REAL_TOOL_SURFACE)`));
      }
    }
  }
  return drifts;
}

/**
 * 禁用工具核对:任何层引用 FORBIDDEN 名单(bash/web_fetch/通用 subagent/subagent_fork)。
 */
export function checkForbidden(rolesAllow, cordisAllow, forbidden = FORBIDDEN) {
  const drifts = [];
  for (const [roleId, allowSet] of rolesAllow) {
    for (const tool of allowSet) {
      if (forbidden.includes(tool)) {
        drifts.push(drift('L1', 'L3', roleId, tool, 'forbidden',
          `roles/${roleId}.json allow 引用禁用工具 ${tool}`));
      }
    }
  }
  for (const [toolName, allowSet] of cordisAllow) {
    const roleId = toolNameToRole(toolName);
    for (const tool of allowSet) {
      if (forbidden.includes(tool)) {
        drifts.push(drift('L2', 'L3', roleId, tool, 'forbidden',
          `${toolName} 行 toolFilter.allow 引用禁用工具 ${tool}`));
      }
    }
  }
  return drifts;
}

/**
 * 统一核对入口(纯函数):输入 roles 清单 + agent.cordis.yml 文本 + 真实工具面,
 * 输出结构化漂移报告。可被入口脚本 / harvest / 审计回路调用。
 * 返回 { ok, drifts, summary: { total, byPair }, freeze }。
 */
export function auditToolface({ roles, cordisText, realSurface = REAL_TOOL_SURFACE, forbidden = FORBIDDEN } = {}) {
  const rolesAllow = parseRolesAllow(roles);
  const cordisAllow = parseCordisPerRoleAllow(cordisText);
  const drifts = [
    ...checkL1vsL2(rolesAllow, cordisAllow),
    ...checkL2vsL3(cordisAllow, realSurface),
    ...checkL1vsL3(rolesAllow, realSurface),
    ...checkForbidden(rolesAllow, cordisAllow, forbidden),
  ];
  const byPair = {};
  for (const d of drifts) {
    const key = `${d.layerA}vs${d.layerB}`;
    byPair[key] = (byPair[key] || 0) + 1;
  }
  return {
    ok: drifts.length === 0,
    drifts,
    summary: { total: drifts.length, byPair },
    freeze: TOOLFACE_FREEZE_SEMANTICS,
  };
}
