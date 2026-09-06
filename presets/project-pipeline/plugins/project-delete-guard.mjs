// preset-plugin: project-delete-guard —— 删除命令拦截 guard(R3-candidate-a)。
//
// 职责:在 tools.guard() 挂点拦截模型面 shell 工具(pwsh/bash)中的删除命令,
// 拒绝并引导走 .trash 语义;豁免路径可配(如 $WS/.tmp/、$WS/experiment/、
// $WS/*/.trash/)。命令清单/识别策略/拒绝文案按 DESIGN §3.5。
//
// 挂点:ctx.tools.guard(fn)(dsh-tools guard() L2805-2810,单调 guard,返回
// reason 即拒;guardReason() L2812-2820 在预执行瀑布后遍历 global + scope 链)。
// guard 收到 exec,读 exec.name(工具名)与 exec.arguments.command(命令串)。
// 注册在 preset 本地插件 apply(ctx) 的 ctx 上;若 ctx 为全局/非 scoped,guard
// 落全局层(约束所有会话)——见 DESIGN §5.1 假设 2,需 build 实测确认对角色
// 子代理生效。
//
// 红线:不改 dsh 运行时;本插件只读 exec,不触碰文件系统、不发起网络。
//
// 失效面(如实,见 DESIGN §3.1):命令混淆(变量拼接/子 shell/& 串联/管道中段/
// 字符串转义)可绕过;仅防「工具预执行层能看到的删除命令」;会误拦一切含删除
// 命令的调用(含清理临时文件等合理删除)——靠豁免路径 + 明确拒绝文案缓解;
// 拦不住「写工具覆盖即销毁」(那是 R3-b 的域,本期排除);不拦「非删除但破坏」
// 操作(如 mv 覆盖、> 重定向截断)。本插件是「纪律 + 命令拦截」的应用层兜底,
// 不构成通用安全沙箱(dsh-bash-sandbox README L85)。

export const name = 'project-pipeline-delete-guard';

/** 纯消费工具面;不 provide,组合行无需 isolate group。 */
export const inject = ['tools'];

// 删除命令白名单(pwsh 别名 + bash)。pwsh 命令大小写不敏感,统一小写比对。
const PWSH_DELETE_CMDS = new Set(['remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);
const BASH_DELETE_CMDS = new Set(['rm', 'rmdir', 'del']);

// 默认豁免路径片段(相对工作区;命令串含任一即放行)。可经 config.exemptPaths 覆盖。
export const DEFAULT_EXEMPT_PATHS = ['.tmp', 'experiment', '.trash'];

// DESIGN §3.5 拒绝文案(guard 返回 reason)。
export const REJECT_TEXT =
  '删除操作当前被 project-pipeline 预设限制:禁止直接用 del/Remove-Item/rd/rmdir/rm 删除文件或目录。若确要清理,请先用 git 提交基线,再用 Move-Item 把目标移入 <workspace>/.trash/ 保全,或把文件标记为废弃;若属项目内部临时目录(如 .tmp/、experiment/),可在豁免路径内删除。如需全局删除能力请经协调者/user 裁决。';

/** config fail-fast 校验:仅接受 { exemptPaths?: 非空字符串数组, enabled?: boolean }。 */
export function normalizeConfig(config = {}) {
  if (config === null || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`${name}: config 必须是对象`);
  }
  for (const key of Object.keys(config)) {
    if (key !== 'exemptPaths' && key !== 'enabled') {
      throw new Error(`${name}: 不支持的 config 键 "${key}"(仅接受 exemptPaths / enabled)`);
    }
  }
  let exemptPaths = DEFAULT_EXEMPT_PATHS;
  if (config.exemptPaths !== undefined) {
    if (!Array.isArray(config.exemptPaths) || config.exemptPaths.some((p) => typeof p !== 'string' || p.length === 0)) {
      throw new Error(`${name}: config.exemptPaths 必须是非空字符串数组`);
    }
    exemptPaths = [...config.exemptPaths];
  }
  const enabled = config.enabled !== false;
  return { exemptPaths, enabled };
}

/**
 * 把命令串按语句分隔符(& ; |)切成段,返回每段的首命令词(小写)。
 * 已知局限:分隔符若出现在引号内路径/字符串里会被误切(命令混淆绕过面,
 * DESIGN §3.1 失效面①),本插件如实接受该局限。
 */
export function commandSegments(command) {
  const segments = command.split(/[&;|]/);
  const words = [];
  for (const segment of segments) {
    const trimmed = segment.trim();
    if (trimmed.length === 0) continue;
    // 取首词:跳过前导符号(& ; | ( ) 空白)与引号。
    const m = trimmed.match(/^[&;|()\s]*"?([^\s"']+)/);
    if (m) words.push(m[1].toLowerCase());
  }
  return words;
}

/**
 * 删除命令识别(DESIGN §3.5 判定规则)。纯函数,可单测。
 * 返回 { blocked: boolean, matched?: string, exempt?: boolean }。
 * - 豁免路径:命令串含任一豁免片段 → 放行(内部临时目录的合理删除)。
 * - pwsh:首命令词 ∈ {remove-item,ri,del,erase,rd,rmdir},或含 `.Delete(`/`::Delete(`。
 * - bash:首命令词 ∈ {rm,rmdir,del}。
 */
export function detectDeleteCommand({ toolName, command, exemptPaths = DEFAULT_EXEMPT_PATHS }) {
  if (typeof command !== 'string' || command.trim().length === 0) {
    return { blocked: false };
  }
  // 豁免路径优先:命令串含任一豁免片段 → 放行(整命令启发式,见 DESIGN §3.1 局限)。
  if (exemptPaths.some((frag) => command.includes(frag))) {
    return { blocked: false, exempt: true };
  }
  const words = commandSegments(command);
  if (toolName === 'pwsh') {
    for (const word of words) {
      if (PWSH_DELETE_CMDS.has(word)) return { blocked: true, matched: word };
    }
    if (/\.Delete\s*\(/.test(command) || /::Delete\s*\(/.test(command)) {
      return { blocked: true, matched: '.Delete(' };
    }
  } else if (toolName === 'bash') {
    for (const word of words) {
      if (BASH_DELETE_CMDS.has(word)) return { blocked: true, matched: word };
    }
  }
  return { blocked: false };
}

export function apply(ctx, config = {}) {
  const cfg = normalizeConfig(config);
  if (!cfg.enabled) return;

  ctx.tools.guard((exec) => {
    const toolName = exec?.name;
    if (toolName !== 'pwsh' && toolName !== 'bash') return undefined;
    const command = exec?.arguments?.command;
    const result = detectDeleteCommand({ toolName, command, exemptPaths: cfg.exemptPaths });
    if (result.blocked) return REJECT_TEXT;
    return undefined;
  });
}

export default { name, inject, DEFAULT_EXEMPT_PATHS, REJECT_TEXT, normalizeConfig, commandSegments, detectDeleteCommand, apply };
