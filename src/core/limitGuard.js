/*
 * limitGuard.js — 资源软阈值确认 / 硬上限守卫（零依赖，主线程与 Worker 共用）。
 *
 * 约定：
 * - actual <= soft：直接放行，正常小文件零行为变化。
 * - params._allowLimitOverride：调用方已确认，放宽到 hard；actual > hard 仍拒绝。
 * - 主线程有 confirm：弹窗询问；确认放行，取消抛 LIMIT_CANCEL_CODE（cancelled=true）。
 * - Worker / Node 无 confirm：抛 LIMIT_CONFIRM_CODE，err.meta 携带完整阈值信息，
 *   由 opRunClient 在主线程补弹窗并用同一 runId 带 _allowLimitOverride 重试。
 */
export const LIMIT_CONFIRM_CODE = "EBCTF_LIMIT_CONFIRM";
export const LIMIT_HARD_CODE = "EBCTF_LIMIT_HARD";
export const LIMIT_CANCEL_CODE = "EBCTF_LIMIT_CANCEL";

let _allowAllLimits = false;
let _limitMessageBuilder = null;

/** 批处理等显式场景：本次全部允许超限（仍受硬上限约束）。 */
export function setAllowAllLimits(bool) {
  _allowAllLimits = !!bool;
}

export function resetAllowAllLimits() {
  _allowAllLimits = false;
}

/**
 * 注册 i18n 消息构造器。fn(info) 返回字符串则优先使用，返回空值回退内置中文。
 * info = { kind:"confirm"|"notice"|"hard", scope, actual, soft, hard, label, unit }
 */
export function setLimitMessageBuilder(fn) {
  _limitMessageBuilder = (typeof fn === "function") ? fn : null;
}

function limitError(code, message, extra) {
  const err = new Error(message);
  err.code = code;
  if (extra) Object.assign(err, extra);
  return err;
}

function buildMessage(kind, info) {
  if (_limitMessageBuilder) {
    try {
      const built = _limitMessageBuilder({ kind, ...info });
      if (typeof built === "string" && built.trim()) return built;
    } catch { /* builder 异常回退内置中文 */ }
  }
  const { label: name, actual: a, soft: s, hard: h, unit: u } = info;
  if (kind === "hard") return `${name}：实际 ${a}${u}，超过硬上限 ${h}${u}，已拒绝。`;
  if (kind === "notice") {
    return `${name}：实际 ${a}${u}，超过软阈值 ${s}${u}；确认后可放宽到硬上限 ${h}${u}。继续可能占用大量内存/时间。`;
  }
  return `${name}：实际 ${a}${u}，超过安全软阈值 ${s}${u}。\n` +
    `继续可能占用大量内存/时间，是否继续？\n（硬上限 ${h}${u}）`;
}

export function checkLimit({ scope, actual, soft, hard, params, label, unit } = {}) {
  const a = Number(actual);
  const s = Number(soft);
  const h = Number(hard);
  const name = label || scope || "资源";
  const u = unit || "";
  const info = { scope, actual: a, soft: s, hard: h, label: name, unit: u };
  // 阈值配置/实际值异常时 fail-closed，避免尺寸溢出成 NaN 后静默绕过限制。
  if (!Number.isFinite(a) || !Number.isFinite(s) || !Number.isFinite(h)) {
    throw limitError(LIMIT_HARD_CODE, `${name}：资源用量或阈值无法确定，已拒绝。`, { meta: { ...info } });
  }
  // 先判硬上限：soft > hard 的配置错误也不能让 a 越过 hard。
  if (a > h) {
    throw limitError(LIMIT_HARD_CODE, buildMessage("hard", info), { meta: { ...info } });
  }
  if (a <= s) return;

  const ctx = globalThis.__ebctfLimitParams;
  const allowOverride = !!((params && params._allowLimitOverride) ||
    (ctx && ctx._allowLimitOverride) || _allowAllLimits);
  if (allowOverride) return;

  if (typeof globalThis.confirm === "function") {
    const ok = globalThis.confirm(buildMessage("confirm", info));
    if (ok) {
      // 让同一次 op 内后续嵌套解码/解压检查也视为已确认；调用方应在 op 结束时还原 ctx。
      globalThis.__ebctfLimitParams = { ...(ctx || {}), _allowLimitOverride: true };
      return;
    }
    throw limitError(LIMIT_CANCEL_CODE, `${name}：用户取消。`, { cancelled: true });
  }
  const metaMessage = buildMessage("notice", info);
  const err = limitError(LIMIT_CONFIRM_CODE, metaMessage, { meta: { ...info, message: metaMessage } });
  throw err;
}

/**
 * 在 op 调用期间设置资源确认上下文，结束后恢复。用于主线程直接执行、批量、
 * 穷举回退和 Worker 入口，避免 `__ebctfLimitParams` 泄漏到下一次无关操作。
 */
export async function withLimitContext(params, fn) {
  const prev = globalThis.__ebctfLimitParams;
  globalThis.__ebctfLimitParams = { _allowLimitOverride: !!(params && params._allowLimitOverride) };
  try {
    return await fn();
  } finally {
    globalThis.__ebctfLimitParams = prev;
  }
}

export function isLimitConfirmError(e) {
  return !!e && e.code === LIMIT_CONFIRM_CODE;
}

export function isLimitHardError(e) {
  return !!e && e.code === LIMIT_HARD_CODE;
}

export function isLimitCancelError(e) {
  return !!e && (e.code === LIMIT_CANCEL_CODE || e.cancelled === true);
}

export function isLimitError(e) {
  return isLimitConfirmError(e) || isLimitHardError(e) || isLimitCancelError(e);
}

/** 合并参数并带上 _allowLimitOverride（用于已确认后的内部递归/重试）。 */
export function withLimit(p, p2) {
  const a = p && typeof p === "object" ? p : {};
  const b = p2 && typeof p2 === "object" ? p2 : {};
  return { ...a, ...b, _allowLimitOverride: !!(a._allowLimitOverride || b._allowLimitOverride) };
}
