/*
 * zipCrc32Brute.js — ZIP CRC32 小文件内容爆破（T287，cat:'analysis'，单向 run）。
 *
 * 场景：CTF misc 里 ZIP 存了 Stored（method=0，未压缩）的极小文件，已知其 CRC32
 * 反查文件内容。对长度 ≤6 的所有可能内容穷举 CRC32，命中即输出。
 *
 * 算法：标准 CRC-32/ISO-HDLC（IEEE 802.3，与 zip/gzip 一致）。
 * 反射式多项式 0xEDB88320（= 0x04C11DB7 的位反射），init=0xFFFFFFFF
 * refIn/refOut=true，xorOut=0xFFFFFFFF。表驱动 + 增量计算（沿 DFS 路径复用寄存器）。
 *
 * 契约：run(text, p) 忽略 text（可空，仅作提示），用 p 参数驱动爆破，返回报告文本。
 * 参数：
 * targetCrc 目标 CRC32（hex，"0x3610a686" 或 "3610a686" 均可）
 * charset lower/upper/digit/alnum/printable/custom
 * customCharset 自定义字符集（charset=custom 时生效）
 * minLen 最小长度，默认 1
 * maxLen 最大长度，默认 4，硬上限 6
 *
 * 防爆：maxLen 硬上限 6；搜索空间 > 1e9 拒跑（printable 5+ 字节、alnum 6 字节等）。
 *
 * 红线：只建本文件，件内自注册，不碰任何现有文件。零外发纯 JS 计算。
 */
import { register } from "./registry.js";

export const MAX_LEN = 6;
const SEARCH_SPACE_LIMIT = 1_000_000_000; // 10 亿，浏览器同步爆破上限
const HIT_CAP = 50; // 最多列 50 个命中，防碰撞刷屏

// ---- CRC32 表（标准 poly 0xEDB88320，反射式） ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * 对字符串或字节数组算标准 CRC32（IEEE 802.3，与 ZIP 一致），返回无符号 32 位。
 * 输入为字符串时按 UTF-8 字节计算（ASCII 范围与 ASCII 等价）。
 */
export function crc32(input) {
  let bytes;
  if (typeof input === "string") {
    bytes = new TextEncoder().encode(input);
  } else if (input && typeof input.length === "number") {
    bytes = input;
  } else {
    throw new TypeError("crc32 入参需为 string 或 array-like");
  }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---- 字符集 ----
function rangeBytes(lo, hi) {
  const a = new Uint8Array(hi - lo + 1);
  for (let i = 0; i < a.length; i++) a[i] = lo + i;
  return a;
}

const CHARSET_PRESETS = {
  lower: () => rangeBytes(0x61, 0x7A),      // a-z
  upper: () => rangeBytes(0x41, 0x5A),      // A-Z
  digit: () => rangeBytes(0x30, 0x39),      // 0-9
  alnum: () => {
    const a = [];
    for (let i = 0x30; i <= 0x39; i++) a.push(i); // 0-9
    for (let i = 0x41; i <= 0x5A; i++) a.push(i); // A-Z
    for (let i = 0x61; i <= 0x7A; i++) a.push(i); // a-z
    return Uint8Array.from(a);
  },
  printable: () => rangeBytes(0x20, 0x7E),  // 可打印 ASCII（含空格）
};

/**
 * 取字符集字节数组（已去重）。
 * - name 为预设名（lower/upper/digit/alnum/printable）→ 返回预设
 * - name === "custom" 且提供 customChars → 把 customChars 每字符码点（≤0xFF）去重
 * - 其它字符串 → 视为字面字符集，每字符作候选字节
 * 返回 Uint8Array。
 */
export function getCharset(name, customChars) {
  if (typeof name === "string" && CHARSET_PRESETS[name]) {
    return CHARSET_PRESETS[name]();
  }
  const src = name === "custom" ? (customChars || "") : (name || "");
  const seen = new Set();
  const out = [];
  for (const ch of String(src)) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && cp <= 0xFF) {
      if (!seen.has(cp)) {
        seen.add(cp);
        out.push(cp);
      }
    }
  }
  return Uint8Array.from(out);
}

/** 解析目标 CRC hex → 无符号 32 位，非法返回 null。 */
function parseCrc(raw) {
  if (!raw) return null;
  let s = String(raw).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]{1,8}$/.test(s)) return null;
  return parseInt(s, 16) >>> 0;
}

/** 把命中的字节数组渲染成可读串 + hex。 */
function fmtHit(bytes) {
  const s = bytes.map((b) => (b >= 0x20 && b <= 0x7E ? String.fromCharCode(b) : ".")).join("");
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  return `"${s}"  (hex: ${hex}, len=${bytes.length})`;
}

// ---- 内部爆破：返回 {hits, tried, aborted} ----
// DFS 按长度递增，regStack[k] = 前 k 字节的中间寄存器值，沿路径复用避免重算前缀。
function _bruteForceRaw(target, csBytes, minLen, maxLen) {
  const cs = csBytes;
  const hits = [];
  let tried = 0;
  let aborted = false;

  const bytes = new Uint8Array(maxLen);
  const regStack = new Uint32Array(maxLen + 1);

  function dfs(depth, targetLen) {
    if (aborted) return;
    for (let i = 0; i < cs.length; i++) {
      const b = cs[i];
      bytes[depth] = b;
      regStack[depth + 1] = (CRC_TABLE[(regStack[depth] ^ b) & 0xFF] ^ (regStack[depth] >>> 8)) >>> 0;
      if (depth + 1 === targetLen) {
        tried++;
        const final = (regStack[depth + 1] ^ 0xFFFFFFFF) >>> 0;
        if (final === target) {
          hits.push(Array.from(bytes.subarray(0, targetLen)));
          if (hits.length >= HIT_CAP) { aborted = true; return; }
        }
      } else {
        dfs(depth + 1, targetLen);
        if (aborted) return;
      }
    }
  }

  for (let len = minLen; len <= maxLen && !aborted; len++) {
    regStack[0] = 0xFFFFFFFF; // init
    dfs(0, len);
  }
  return { hits, tried, aborted };
}

/**
 * 爆破目标 CRC32，返回匹配的内容字符串数组。
 * @param {number|string} targetCrc 目标 CRC32（数值或 hex 字符串）
 * @param {string|Uint8Array|number[]} charset 预设名 / 字面字符集 / 字节数组
 * @param {number} minLen 最小长度（含），最小按 1 处理
 * @param {number} maxLen 最大长度（含），硬上限 6，超过自动截断
 * @returns {string[]} 命中的内容字符串列表
 */
export function bruteForceCrc32(targetCrc, charset, minLen, maxLen) {
  const target = typeof targetCrc === "string" ? parseCrc(targetCrc) : (targetCrc >>> 0);
  if (target === null) return [];

  let lo = Math.max(1, Math.floor(minLen) || 1);
  let hi = Math.floor(maxLen) || lo;
  if (!Number.isFinite(hi)) hi = lo;
  if (hi < lo) hi = lo;
  if (hi > MAX_LEN) hi = MAX_LEN; // 硬上限保护

  let csBytes;
  if (charset && typeof charset === "object" && typeof charset.length === "number") {
    csBytes = Uint8Array.from(charset);
  } else {
    csBytes = getCharset(charset);
  }
  if (csBytes.length === 0) return [];

 // 搜索空间上限：与 op run 一致，防导出函数被直接调用时无界爆破挂死。
  let space = 0;
  for (let L = lo; L <= hi; L++) space += Math.pow(csBytes.length, L);
  if (space > SEARCH_SPACE_LIMIT) {
    throw new Error(`搜索空间 ${space.toExponential(2)} 超上限 ${SEARCH_SPACE_LIMIT}（缩小字符集或长度范围）`);
  }

  const { hits } = _bruteForceRaw(target, csBytes, lo, hi);
  return hits.map((arr) => String.fromCharCode.apply(null, arr));
}

register({
  id: "zipCrc32Brute",
  cat: "forensic",
  name: "ZIP CRC32 内容爆破",
  desc: "ZIP 里 Stored 小文件已知 CRC32 反查内容。对长度 ≤6 的所有可能内容穷举 CRC32，命中即输出。表驱动增量计算",
  params: [
    { key: "targetCrc", label: "目标 CRC32 (hex)", type: "text", default: "", placeholder: "0x3610a686 或 3610a686" },
    {
      key: "charset", label: "字符集", type: "select", default: "lower",
      options: [
        { value: "lower", label: "小写字母 a-z" },
        { value: "upper", label: "大写字母 A-Z" },
        { value: "digit", label: "数字 0-9" },
        { value: "alnum", label: "字母+数字" },
        { value: "printable", label: "可打印 ASCII" },
        { value: "custom", label: "自定义" },
      ],
    },
    { key: "customCharset", label: "自定义字符集", type: "text", default: "", placeholder: "如 abc123!@#" },
    { key: "minLen", label: "最小长度", type: "number", default: 1 },
    { key: "maxLen", label: "最大长度", type: "number", default: 4 },
  ],
  run: function (text, p) {
    const pp = p || {};
    const target = parseCrc(pp.targetCrc);
    if (target === null) {
      return "（无效的目标 CRC32）请填 8 位以内十六进制，如 0x3610a686 或 3610a686。";
    }

    let minLen = parseInt(pp.minLen, 10);
    let maxLen = parseInt(pp.maxLen, 10);
    if (!Number.isFinite(minLen) || minLen < 1) minLen = 1;
    if (!Number.isFinite(maxLen) || maxLen < 1) maxLen = 4;
    if (minLen > maxLen) { const t = minLen; minLen = maxLen; maxLen = t; }

    let clamped = false;
    if (maxLen > MAX_LEN) { maxLen = MAX_LEN; clamped = true; }
    if (minLen > MAX_LEN) { minLen = MAX_LEN; clamped = true; }

    const charsetName = pp.charset || "lower";
    const csBytes = getCharset(charsetName, pp.customCharset);
    if (csBytes.length === 0) {
      return charsetName === "custom"
        ? "（字符集为空）当前字符集选了「自定义」但未填自定义字符集，请在「自定义字符集」框里填入候选字符。"
        : "（字符集为空）解析出的字符集为空，请换一个字符集。";
    }

 // 搜索空间估算（防爆）
    let space = 0;
    for (let L = minLen; L <= maxLen; L++) space += Math.pow(csBytes.length, L);
    if (space > SEARCH_SPACE_LIMIT) {
      return [
        "（拒绝执行 · 搜索空间过大）",
        `字符集 ${csBytes.length} 字符 × 长度 ${minLen}..${maxLen} ≈ ${space.toLocaleString()} 组合，浏览器同步爆破会卡死。`,
        "建议：缩小 maxLen、换更小的字符集，或明文更长时改用离线 hashcat/自写脚本。",
      ].join("\n");
    }

    const t0 = Date.now();
    const { hits, tried, aborted } = _bruteForceRaw(target, csBytes, minLen, maxLen);
    const ms = Date.now() - t0;

    const targetHex = "0x" + target.toString(16).padStart(8, "0");
    const lines = [];
    lines.push(`目标 CRC32: ${targetHex}`);
    lines.push(`字符集: ${charsetName}${charsetName === "custom" ? "（" + (pp.customCharset || "") + "）" : ""}（${csBytes.length} 字符）  长度: ${minLen}..${maxLen}`);
    if (clamped) lines.push(`注意: maxLen 已被压到硬上限 ${MAX_LEN}。`);
    lines.push(`尝试组合: ${tried.toLocaleString()} 次  耗时: ${ms} ms`);
    lines.push("");

    if (hits.length === 0) {
      lines.push("未命中 ✗");
      lines.push("建议: 增大 maxLen / 换字符集（原文可能含非可打印字节或更长），或明文 > 6 字节需离线爆破。");
      return lines.join("\n");
    }

    lines.push(`命中 ✓  共 ${hits.length} 个候选${aborted ? "（已达上限 " + HIT_CAP + "，可能还有更多）" : ""}:`);
    hits.forEach((h, i) => lines.push(`  [${i + 1}] ${fmtHit(h)}`));
    if (hits.length > 1) {
      lines.push("");
      lines.push("提示: CRC32 只 32 位，短串一般唯一；多个候选时结合 ZIP 条目的文件大小 / 上下文判断。");
    }
    return lines.join("\n");
  },
});
