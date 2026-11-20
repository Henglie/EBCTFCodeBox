/*
 * T525 受限纯文本 Magic profile · 候选
 *
 * 与现有 MCP 适配层的区别（卡面要求「不解析面向人的 MCP 文本」）：
 *   本模块**直接调用 `src/core/magic/magic.js` 的 `magicDecode`**，
 *   用 `allowOps`（扩展安全目录）做正向白名单限制，返回**结构化候选**（协议 §4.5），
 *   全程不产生、不解析任何人类可读的 MCP 文本。
 *
 * 纯只读：只 import 产品 core，不写任何产品文件。
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = process.env.EBCTF_CORE_DIR || path.resolve(HERE, "..", "..", "..", "src", "core");
const ROOT = path.resolve(CORE, "..", "..");

/** 协议 §5 硬限额（服务端强制） */
export const MAGIC_LIMITS = Object.freeze({
  maxCandidates: 10,
  serverTimeoutMs: 15000,
  maxInputBytes: 64 * 1024,
});

export class WorkerError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * legacy chain → opId 解析（协议 §4.5，T533 落地前唯一合法桥接）。
 * chain 条目形如 "base64" / "caesar(shift=10)" / "aes(CBC,key:utf8,ct:base64)"。
 */
export function legacyOpIdOf(step) {
  const s = String(step);
  const cut = s.search(/[(:]/);
  return cut === -1 ? s : s.slice(0, cut);
}

/** 从 legacy chain 条目里取参数标签（"caesar(shift=10)" → "shift=10"）。 */
export function legacyParamLabelOf(step) {
  const m = /\(([^)]*)\)/.exec(String(step));
  return m ? m[1] : null;
}

/** 单个 Magic 候选 → 协议 §4.5 结构化候选。 */
export function mapCandidate(c) {
  const first = Array.isArray(c.chain) && c.chain.length ? String(c.chain[0]) : "";
  const out = {
    opId: legacyOpIdOf(first),
    // 必存在字段（与 MCP chain.join 兼容，语义不得改）
    chain: c.chain,
    result: c.result,
    confidence: c.confidence,
    score: c.score,
    matchesCrib: !!c.matchesCrib,
  };
  // params / steps / signals 归 T533/T534，缺席即「未提供」；此处只补 legacy 参数标签供 UI 展示。
  const label = legacyParamLabelOf(first);
  if (label) out.paramLabel = label;
  return out;
}

let _engine = null;
/** engine 信息（appVersion 取 core/version.js，rev 取生成的 sw-assets.js；rev 取不到则 null）。 */
export async function engineInfo() {
  if (_engine) return _engine;
  const v = await import(pathToFileURL(path.join(CORE, "version.js")).href);
  let rev = null;
  try {
    const t = fs.readFileSync(path.join(ROOT, "sw-assets.js"), "utf8");
    const m = /\bREV\s*=\s*"([0-9a-fA-F]+)"/.exec(t);
    if (m) rev = m[1];
  } catch { /* 资源清单缺失不阻塞解码 */ }
  _engine = { appVersion: v.APP_VERSION, rev };
  return _engine;
}

let _magicDecode = null;
async function loadMagic() {
  if (_magicDecode) return _magicDecode;
  const m = await import(pathToFileURL(path.join(CORE, "magic", "magic.js")).href);
  _magicDecode = m.magicDecode || (m.default && m.default.magicDecode);
  if (typeof _magicDecode !== "function") throw new WorkerError("E_INTERNAL", "magicDecode 不可用");
  return _magicDecode;
}

/**
 * 受限纯文本 Magic。
 * @param {string} text 输入文本（服务端不落盘、不回显）
 * @param {{byId:Map}} catalog 扩展安全目录
 * @param {object} opts { maxCandidates, crib, timeoutMs }
 * @returns 协议 §4.5 响应对象；硬超时返回 ok:false + code E_TIMEOUT + partial:true + 已得候选
 */
export async function magicRestricted(text, catalog, opts = {}) {
  if (typeof text !== "string" || text.length === 0) {
    throw new WorkerError("E_BAD_REQUEST", "text 必须是非空字符串");
  }
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAGIC_LIMITS.maxInputBytes) {
    throw new WorkerError("E_INPUT_TOO_LARGE", `输入 ${bytes} 字节超出 ${MAGIC_LIMITS.maxInputBytes} 字节上限`);
  }

  const asked = Number(opts.maxCandidates ?? MAGIC_LIMITS.maxCandidates);
  const maxCandidates = Math.max(1, Math.min(MAGIC_LIMITS.maxCandidates,
    Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : MAGIC_LIMITS.maxCandidates));
  const timeoutMs = Math.max(1, Math.min(MAGIC_LIMITS.serverTimeoutMs,
    Number(opts.timeoutMs) > 0 ? Math.floor(Number(opts.timeoutMs)) : MAGIC_LIMITS.serverTimeoutMs));

  const magicDecode = await loadMagic();
  const allowOps = [...catalog.byId.keys()];

  // 硬超时：用 AbortSignal（magicDecode 内部「aborted 立即收尾返回已有候选」，不抛错）。
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const t0 = Date.now();
  let raw = [];
  try {
    raw = await magicDecode(text, {
      allowOps,
      maxCandidates,
      crib: opts.crib ?? null,
      signal: ac.signal,
      timeBudget: timeoutMs,
      paramScan: opts.paramScan ?? true,
      intensive: opts.intensive ?? false,
      maxDepth: opts.maxDepth ?? 1,
    });
  } finally {
    clearTimeout(timer);
  }
  const elapsedMs = Date.now() - t0;
  const timedOut = ac.signal.aborted;

  const all = (Array.isArray(raw) ? raw : []).map(mapCandidate);
  const truncated = all.length > maxCandidates;
  const candidates = all.slice(0, maxCandidates);
  const engine = await engineInfo();

  if (timedOut) {
    return {
      v: 1, ok: false, error: { code: "E_TIMEOUT", message: `Magic 超过 ${timeoutMs}ms 硬超时` },
      partial: true, input: { bytes, truncated: false }, candidates, engine, elapsedMs, truncated,
    };
  }
  return {
    v: 1, ok: true, input: { bytes, truncated: false }, candidates, engine, elapsedMs, truncated,
  };
}
