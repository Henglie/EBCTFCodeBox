/*
 * analysis.js — CTF 分析工具组（cat:'analysis'，单向 run 输出报告文本）。
 *
 * 来源：
 * - 算法逻辑参考 CyberChef（GPL，照规范重写不抄源码）等同类实现。
 * - 频率分析/IC/卡方/熵：标准信息论公式。
 * - De Bruijn：标准组合数学算法。
 * - hammingDistance/levenshtein：标准编辑距离 DP。
 *
 * 契约：单向 run(text, params) 返回报告文本（非 hex）。无 encode/decode。
 * 大小写全排列/爆破类有输入长度上限防爆（超长给警告）。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);

// ============ xorBrute（单字节异或爆破，输出全部 256 个结果，可过滤可打印）============
function xorBrute(text, p) {
  const bytes = te(text);
  const printableOnly = p && p.printableOnly;
  const lines = [];
  for (let k = 0; k < 256; k++) {
    const out = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] ^ k;
    let s;
    try { s = new TextDecoder("utf-8", { fatal: false }).decode(out); } catch { s = ""; }
    const printable = s.replace(/[^\x20-\x7e]/g, "");
    if (printableOnly && printable.length < s.length * 0.8) continue;
    lines.push(`0x${k.toString(16).padStart(2, "0")} (${k}): ${s}`);
  }
  return lines.join("\n");
}

// ============ freqDist（字符频率分布）============
// caseMode（大小写统计四档）：
//   keep   保留原样
//   upper  仅统计大写字母（其余字符丢弃）
//   lower  仅统计小写字母
//   toUpper 全部转大写后统计（大小写合并计数）
//   toLower 全部转小写后统计
function freqDist(text, p) {
  const top = Math.max(1, Math.min(50, Number((p && p.top) || 20)));
  const caseMode = (p && p.caseMode) || "keep";
  const asc = !!(p && p.asc); // 倒序开关：true = 按次数升序
  let src = text;
  if (caseMode === "toUpper") src = text.toUpperCase();
  else if (caseMode === "toLower") src = text.toLowerCase();
  const freq = new Map();
  for (const ch of src) {
    if (caseMode === "upper" && !(ch >= "A" && ch <= "Z")) continue;
    if (caseMode === "lower" && !(ch >= "a" && ch <= "z")) continue;
    freq.set(ch, (freq.get(ch) || 0) + 1);
  }
  let counted = 0;
  for (const n of freq.values()) counted += n;
  const total = counted || 1;
  const sorted = [...freq.entries()]
    .sort((a, b) => (asc ? a[1] - b[1] : b[1] - a[1]))
    .slice(0, top);
  const lines = sorted.map(([ch, n]) => {
    const display = ch === "\n" ? "\\n" : ch === "\t" ? "\\t" : ch === " " ? "␠" : ch;
    return `${display}\t${n}\t${(n / total * 100).toFixed(2)}%`;
  });
  return `字符\t次数\t占比\n${lines.join("\n")}\n（共 ${counted} 字符，${freq.size} 种${asc ? "，升序" : ""}）`;
}

// ============ entropy（香农熵）============
function entropy(text) {
  const freq = new Map();
  for (const ch of text) freq.set(ch, (freq.get(ch) || 0) + 1);
  const n = text.length;
  if (n === 0) return "熵: 0（空输入）";
  let h = 0;
  for (const f of freq.values()) {
    const p = f / n;
    h -= p * Math.log2(p);
  }
  return `香农熵: ${h.toFixed(4)} bits/char\n字符数: ${n}\n字符种类: ${freq.size}\n参考: 英语文本≈4.0-4.5, 随机字母≈4.7, Base64≈5.9-6.0, 随机字节≈8.0\n判读: ${
    h > 7.5 ? "高熵（随机/加密/压缩）"
    : h > 5.5 ? "中熵（编码/加密文本）"
    : h > 3.5 ? "正常文本"
    : "低熵（重复/结构化）"
  }`;
}

// ============ wordFreq（词频统计）============
function wordFreq(text, p) {
  const top = Math.max(1, Math.min(100, Number((p && p.top) || 20)));
  const words = text.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/).filter(Boolean);
  if (words.length === 0) return "词频: 无有效词汇";
  const freq = new Map();
  for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  const lines = sorted.map(([w, n]) => `${w}\t${n}`);
  return `词\t次数\n${lines.join("\n")}\n（共 ${words.length} 词，${freq.size} 种）`;
}

// ============ hammingDistance（汉明距离，破 XOR key 长）============
function hammingDistance(a, b) {
 // 字节级汉明距离（不同比特数）
  const ba = te(a), bb = te(b);
  const len = Math.min(ba.length, bb.length);
  let dist = 0;
  for (let i = 0; i < len; i++) {
    let x = ba[i] ^ bb[i];
    while (x) { dist += x & 1; x >>= 1; }
  }
 // 长度差按每字节 8 位算
  dist += Math.abs(ba.length - bb.length) * 8;
  return `汉明距离: ${dist} bits\n长度: ${ba.length} vs ${bb.length}\n归一化: ${(dist / (Math.max(ba.length, bb.length) * 8 || 1)).toFixed(4)}`;
}

// ============ levenshtein（编辑距离，DP）============
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return `编辑距离: ${n}`;
  if (n === 0) return `编辑距离: ${m}`;
  const prev = new Array(n + 1);
  const curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  const d = prev[n];
  return `编辑距离: ${d}\n长度: ${m} vs ${n}\n相似度: ${(1 - d / Math.max(m, n)).toFixed(4)}`;
}

// ============ strContrast（等长 ASCII 逐字符差异）============
function strContrast(text, p) {
 // 输入用分隔符分两段（默认换行）
  const sep = (p && p.sep) || "\n";
  const parts = text.split(sep);
  if (parts.length < 2) return "请输入两行文本（用换行分隔）";
  const a = parts[0], b = parts.slice(1).join(sep);
  const len = Math.max(a.length, b.length);
  const lines = ["位置\tA\tB\tASCII差\tXOR"];
  for (let i = 0; i < len; i++) {
    const ca = a[i] || "", cb = b[i] || "";
    const caDisplay = ca === " " ? "␠" : ca || "∅";
    const cbDisplay = cb === " " ? "␠" : cb || "∅";
    const na = ca ? ca.charCodeAt(0) : 0;
    const nb = cb ? cb.charCodeAt(0) : 0;
    lines.push(`${i + 1}\t${caDisplay}\t${cbDisplay}\t${na - nb}\t0x${(na ^ nb).toString(16).padStart(2, "0")}`);
  }
  return lines.join("\n");
}

// ============ debruijn（De Bruijn 序列，pwn 缓冲区溢出偏移定位）============
// 标准 B(k, n) 序列（Wikipedia 算法）：字母表 k 个符号，所有长度 n 的子串各出现一次，序列长度 k^n + n - 1
function debruijn(text, p) {
  const len = Math.max(1, Math.min(100000, Number((p && p.len) || 200)));
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const k = alphabet.length;
  const subLen = 3; // 子串长度 3，序列长度 26^3 + 2 = 17578
 // a 数组长度需 ≥ k*n（Wikipedia 实现），原版长度 4 会导致越界覆盖、序列错乱
  const a = new Array(k * subLen).fill(0);
  const seq = [];
  function db(t, p) {
    if (t > subLen) {
      if (subLen % p === 0) {
        for (let i = 1; i <= p; i++) seq.push(alphabet[a[i]]);
      }
    } else {
      a[t] = a[t - p];
      db(t + 1, p);
      for (let j = a[t - p] + 1; j < k; j++) {
        a[t] = j;
        db(t + 1, t);
      }
    }
  }
  db(1, 1);
  let result = seq.join("");
  if (result.length > len) result = result.slice(0, len);
 // 如果输入是地址（如 0x41414141 或 "Aa1a"），查找偏移
  let offsetInfo = "";
  const trimmed = text.trim();
  if (trimmed) {
    let needle = "";
    if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
      const hex = trimmed.slice(2);
      if (hex.length >= 2 && hex.length % 2 === 0) {
        const bytes = [];
        for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
        needle = bytes.map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "")).join("");
      }
    } else {
      needle = trimmed;
    }
    if (needle) {
      const idx = result.indexOf(needle);
      offsetInfo = idx >= 0 ? `\n偏移: ${idx}（"${needle}" 在位置 ${idx}）` : `\n未找到 "${needle}"`;
    }
  }
  return `De Bruijn 序列（长度 ${Math.min(len, result.length)}, 字母 ${k}, 子串长 ${subLen}）:\n${result}${offsetInfo}`;
}

// ============ textIntConverter（文本 ↔ 大整数，RSA 题）============
function textToInt(text) {
  const bytes = te(text);
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n.toString();
}
function intToText(text) {
  const s = text.trim().replace(/[^0-9]/g, "");
  if (!s) return "（无有效数字）";
  let n = BigInt(s);
  const bytes = [];
  while (n > 0n) { bytes.unshift(Number(n & 0xffn)); n >>= 8n; }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
}
function textIntConverter(text, p) {
  const dir = (p && p.dir) || "t2i";
  if (dir === "t2i") return `文本 → 大整数:\n${textToInt(text)}`;
  return `大整数 → 文本:\n${intToText(text)}`;
}

// ============ extractHashes（正则提取哈希）============
function extractHashes(text) {
  const re = /\b[0-9a-fA-F]{32,128}\b/g;
  const found = text.match(re) || [];
  if (found.length === 0) return "未找到哈希串";
  const lines = [];
  const seen = new Set();
  for (const h of found) {
    if (seen.has(h)) continue;
    seen.add(h);
    const len = h.length;
    let type = "未知";
    if (len === 32) type = "MD5/NTLM 等";
    else if (len === 40) type = "SHA-1 等";
    else if (len === 56) type = "SHA-224 等";
    else if (len === 64) type = "SHA-256 等";
    else if (len === 96) type = "SHA-384 等";
    else if (len === 128) type = "SHA-512 等";
    lines.push(`${h}\t(${len} 位, ${type})`);
  }
  return `找到 ${found.length} 个哈希串（去重 ${lines.length}）:\n${lines.join("\n")}`;
}

// ============ getAllCasings（大小写全排列，防爆）============
function getAllCasings(text) {
  const letters = text.replace(/[^a-zA-Z]/g, "");
  const n = letters.length;
  if (n > 20) return `字母数 ${n} 超过 20，全排列 ${2 ** n} 种会爆炸，请缩短输入`;
  if (n === 0) return text;
  const results = new Set();
  const total = 1 << n;
  for (let mask = 0; mask < total; mask++) {
    let li = 0;
    let out = "";
    for (const ch of text) {
      if (/[a-zA-Z]/.test(ch)) {
        const bit = (mask >> li) & 1;
        out += bit ? ch.toUpperCase() : ch.toLowerCase();
        li++;
      } else {
        out += ch;
      }
    }
    results.add(out);
  }
  return [...results].join("\n");
}

// ============ alternatingCaps（交替大小写）============
function alternatingCaps(text, p) {
  const startUpper = p && p.startUpper;
  let upper = !!startUpper;
  let out = "";
  for (const ch of text) {
    if (/[a-zA-Z]/.test(ch)) {
      out += upper ? ch.toUpperCase() : ch.toLowerCase();
      upper = !upper;
    } else {
      out += ch;
    }
  }
  return out;
}

// ============ 注册 ============
register({
  id: "xorBrute", cat: "analysis", name: "XOR 单字节爆破",
  desc: "对输入逐字节异或 0-255，输出全部结果（可过滤可打印）",
  params: [
    { key: "printableOnly", label: "仅显示可打印结果", type: "bool", default: false },
  ],
  run: xorBrute,
});
register({
  id: "freqDist", cat: "analysis", name: "字符频率分布",
  desc: "统计字符出现次数和占比（按次数降序，可选大小写过滤/归并 + 升序）",
  params: [
    { key: "top", label: "显示前 N 项", type: "number", default: 20, placeholder: "1-50" },
    { key: "caseMode", label: "大小写", type: "select", default: "keep", options: [
      { value: "keep", label: "保留原样" },
      { value: "upper", label: "仅大写字母" },
      { value: "lower", label: "仅小写字母" },
      { value: "toUpper", label: "全转大写后统计" },
      { value: "toLower", label: "全转小写后统计" },
    ] },
    { key: "asc", label: "按次数升序", type: "bool", default: false },
  ],
  run: freqDist,
});
register({
  id: "entropy", cat: "analysis", name: "香农熵",
  desc: "计算香农熵（bits/char，判数据随机性，随机字节≈8.0，英语≈4.0-4.5）",
  run: entropy,
});
register({
  id: "wordFreq", cat: "analysis", name: "词频统计",
  desc: "分词统计词频（按次数降序）",
  params: [
    { key: "top", label: "显示前 N 项", type: "number", default: 20, placeholder: "1-100" },
  ],
  run: wordFreq,
});
register({
  id: "hammingDistance", cat: "analysis", name: "汉明距离",
  desc: "两段文本的字节级汉明距离（破 XOR key 长，用换行分隔两段）",
  params: [],
  run: (t) => {
    const parts = t.split(/\r?\n/);
    if (parts.length < 2) return "请输入两行文本（用换行分隔）";
    return hammingDistance(parts[0], parts.slice(1).join("\n"));
  },
});
register({
  id: "levenshtein", cat: "analysis", name: "编辑距离",
  desc: "Levenshtein 编辑距离（插入/删除/替换，DP）",
  params: [],
  run: (t) => {
    const parts = t.split(/\r?\n/);
    if (parts.length < 2) return "请输入两行文本（用换行分隔）";
    return levenshtein(parts[0], parts.slice(1).join("\n"));
  },
});
register({
  id: "strContrast", cat: "analysis", name: "等长 ASCII 对比",
  desc: "逐字符对比两段文本的 ASCII 差值",
  params: [],
  run: strContrast,
});
register({
  id: "debruijn", cat: "analysis", name: "De Bruijn 序列",
  desc: "生成 De Bruijn 序列（pwn 缓冲区溢出偏移定位，输入地址查偏移）",
  params: [
    { key: "len", label: "序列长度", type: "number", default: 200, placeholder: "1-100000" },
  ],
  run: debruijn,
});
register({
  id: "textIntConverter", cat: "analysis", name: "文本↔大整数",
  desc: "文本 ↔ 大整数互转（RSA 题，文本按字节拼成大整数或反向还原）",
  params: [
    { key: "dir", label: "方向", type: "select", default: "t2i", options: [
      { value: "t2i", label: "文本 → 大整数" },
      { value: "i2t", label: "大整数 → 文本" },
    ] },
  ],
  run: textIntConverter,
});
register({
  id: "extractHashes", cat: "analysis", name: "提取哈希串",
  desc: "正则提取文本中的 hex 哈希串（32-128 位）",
  run: extractHashes,
});
register({
  id: "getAllCasings", cat: "analysis", name: "大小写全排列",
  desc: "生成所有大小写组合（字母 ≤20，防爆）",
  run: getAllCasings,
});
register({
  id: "alternatingCaps", cat: "analysis", name: "交替大小写",
  desc: "交替大小写转换（如 sPoNgEbOb 文本）",
  params: [
    { key: "startUpper", label: "首字母大写起", type: "bool", default: false },
  ],
  run: alternatingCaps,
});

export {
  xorBrute, freqDist, entropy, wordFreq,
  hammingDistance, levenshtein, strContrast, debruijn, textIntConverter,
  extractHashes, getAllCasings, alternatingCaps,
  textToInt, intToText,
};
