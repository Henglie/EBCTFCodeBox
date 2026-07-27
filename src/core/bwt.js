/*
 * bwt.js — BWT 块排序变换（cat:'modern'）。
 *
 * BWT（Burrows-Wheeler Transform）是 bzip2 核心变换，可逆不加密，CTF 偶见。
 * 常用于压缩前置 + 隐写。
 *
 * 覆盖：
 * bwt 双向：encode = BWT 正变换（输出变换串 + 主索引）；
 * decode = LF-mapping 逆变换还原。
 *
 * 两种模式：
 * - 无哨兵（默认）：输出 "BWT串|primary"，primary 为原串在排序矩阵的行号
 * - 有哨兵（eofSentinel=true）：末尾加 $ 哨兵（$ 须小于所有字符）
 * primary 由 $ 在 BWT 串的位置决定，输出 "BWT串"（含 $）
 *
 * 实现说明：标准 BWT 算法（循环移位排序 + LF-mapping 逆变换），纯本地计算。
 *
 * 参考：Burrows & Wheeler (1994) "A Block-sorting Lossless Data Compression Algorithm"；
 * bzip2 实现；Wikipedia "Burrows–Wheeler transform"。
 *
 * 限制：O(n² log n) 排序，输入长度上限 65536 防 UI 卡死；CTF 场景（短文本）足够。
 * 非 BMP 字符（emoji 等）按 UTF-16 码元处理，CTF 场景罕见不影响。
 */
import { register } from "./registry.js";

const MAX_LEN = 65536;
const SENTINEL = "$";

// ============================================================
// BWT 正变换
// 输入：字符串 s
// 输出：{ bwt: 变换后字符串, primary: 主索引 }
// 算法：构造 n 个循环移位 → 排序 → 取最后一列 + 原串所在行号
// ============================================================
function bwtEncode(s) {
  const n = s.length;
  if (n === 0) return { bwt: "", primary: 0 };
  if (n > MAX_LEN) {
    throw new Error("BWT 输入过长（" + n + " > " + MAX_LEN + "），请缩短输入");
  }

 // 构造循环移位的起始索引 [0, 1, ..., n-1]
 // 不实际构造 n 个字符串（O(n²) 空间），用索引数组 + 比较函数
  const indices = Array.from({ length: n }, (_, i) => i);

 // 比较循环移位 s[i..] + s[..i]（O(n² log n) 时间，O(n) 空间）
  indices.sort((a, b) => {
    for (let k = 0; k < n; k++) {
      const ca = s.charCodeAt((a + k) % n);
      const cb = s.charCodeAt((b + k) % n);
      if (ca !== cb) return ca - cb;
    }
    return 0;
  });

 // 取最后一列：每个排序后的旋转，最后一字符是 s[(idx + n - 1) % n]
  let bwt = "";
  let primary = 0;
  for (let i = 0; i < n; i++) {
    const idx = indices[i];
    bwt += s[(idx + n - 1) % n];
    if (idx === 0) primary = i;
  }
  return { bwt, primary };
}

// ============================================================
// BWT 逆变换（LF-mapping）
// 输入：bwt 字符串（最后一列 L）+ primary 索引
// 输出：原始字符串
// 算法：
// 1. F = sorted(L)（第一列）
// 2. LF[i] = L[i] 在 F 中的对应位置（同字符按出现次序对应）
// 3. 从 primary 开始迭代 n 次：S[n-1-k] = L[LF^k[primary]]
// ============================================================
function bwtDecode(bwt, primary) {
  const n = bwt.length;
  if (n === 0) return "";
  if (n > MAX_LEN) {
    throw new Error("BWT 输入过长（" + n + " > " + MAX_LEN + "），请缩短输入");
  }
  if (!Number.isInteger(primary) || primary < 0 || primary >= n) {
    throw new Error("primary 索引非法（须 0.." + (n - 1) + "，实为 " + primary + "）");
  }

 // 统计每个字符出现次数
  const charCount = new Map();
  for (let i = 0; i < n; i++) {
    const ch = bwt[i];
    charCount.set(ch, (charCount.get(ch) || 0) + 1);
  }

 // 构造 F 列的起始位置（字符 c 在 F 中的起始行）
  const sortedChars = [...charCount.keys()].sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0));
  const startIdx = new Map();
  let acc = 0;
  for (const ch of sortedChars) {
    startIdx.set(ch, acc);
    acc += charCount.get(ch);
  }

 // 构造 LF 映射数组：LF[i] = startIdx[bwt[i]] + (bwt[i] 在 L[0..i) 中的出现次数)
  const lf = new Int32Array(n);
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const ch = bwt[i];
    const seenCount = seen.get(ch) || 0;
    lf[i] = startIdx.get(ch) + seenCount;
    seen.set(ch, seenCount + 1);
  }

 // 从 primary 开始迭代重建（倒序拼接）
  let result = "";
  let p = primary;
  for (let i = 0; i < n; i++) {
    result = bwt[p] + result;
    p = lf[p];
  }
  return result;
}

// ============================================================
// register 层：参数解析 + 输出格式
// ============================================================
// encode 输出格式：
// - 无哨兵：'BWT串|primary'（分隔符可配）
// - 有哨兵：'BWT串'（含 $，primary 隐含为 $ 位置）
// decode 输入：同格式

function bwtEncodeOp(text, p) {
  const useSentinel = p && p.eofSentinel;
  const sep = (p && p.separator) || "|";

  let s = String(text);
  if (useSentinel) {
    if (s.includes(SENTINEL)) {
      throw new Error("哨兵模式要求输入不含 '$' 字符（$ 用作 EOF 哨兵）");
    }
    s = s + SENTINEL;
  }

  const { bwt, primary } = bwtEncode(s);

  if (useSentinel) {
    return bwt; // 含 $，primary 隐含
  }
  return bwt + sep + primary;
}

function bwtDecodeOp(text, p) {
  const useSentinel = p && p.eofSentinel;
  const sep = (p && p.separator) || "|";

  let bwt, primary;
  if (useSentinel) {
    bwt = String(text);
    const idx = bwt.indexOf(SENTINEL);
    if (idx < 0) {
      throw new Error("哨兵模式 decode：BWT 串须含 '$' 哨兵");
    }
    primary = idx; // $ 在 L 列的位置 = primary
  } else {
    const t = String(text);
    const i = t.lastIndexOf(sep);
    if (i < 0) {
      throw new Error("decode 输入格式：'BWT串" + sep + "primary'，缺少分隔符 '" + sep + "'");
    }
    bwt = t.slice(0, i);
    primary = parseInt(t.slice(i + sep.length), 10);
 // 空 bwt 时 primary 须为 0；非空时 primary 须 0..length-1
    if (!Number.isInteger(primary) || primary < 0 || (bwt.length > 0 && primary >= bwt.length)) {
      throw new Error("primary 索引非法（须 0.." + Math.max(0, bwt.length - 1) + "）");
    }
  }

  let result = bwtDecode(bwt, primary);

  if (useSentinel) {
    if (!result.endsWith(SENTINEL)) {
      throw new Error("哨兵模式 decode：还原结果末尾应为 '$' 哨兵，实为 '" + result.slice(-1) + "'");
    }
    result = result.slice(0, -1);
  }
  return result;
}

// ============================================================
// 注册
// ============================================================
register({
  id: "bwt",
  cat: "modern",
  name: "BWT 块排序变换",
  desc: "Burrows-Wheeler 变换（bzip2 核心，可逆不加密）。encode 输出 'BWT串|primary'；哨兵模式末尾加 $ 无需 primary。decode 用 LF-mapping 还原",
  params: [
    { key: "eofSentinel", label: "用 $ 哨兵", type: "bool", default: false },
    { key: "separator", label: "分隔符", type: "text", default: "|", placeholder: "BWT 串与 primary 的分隔符（仅无哨兵模式）" },
  ],
  encode: bwtEncodeOp,
  decode: bwtDecodeOp,
});
