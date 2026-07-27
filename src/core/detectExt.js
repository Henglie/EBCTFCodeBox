// detectExt.js — T41 detect 识别函数补全（扩展层）。
// 为 registry 中"有 decode 但缺 detect"的 op 补全识别函数，使 oneClickDecode 能识别更多格式。
// 红线：不改主开发源码文件，运行时 monkey-patch 给 op 对象加 detect 字段。detect 只读不写。
// 置信度策略：固定变换/字符集明确 0.3-0.5；需密钥/参数 0.1-0.2（兜底）；自反变换 0.1（防误报）。
import { OPS } from "./registry.js";

// 通用 detect 工厂：正则 + 最小长度 → 置信度
const cs = (re, minLen, conf) => (t) => {
  const s = (t || "").trim();
  return re.test(s) && s.length >= minLen ? conf : 0;
};

// 按 op id 的 detect 映射
const DETECTORS = {
 // ---- fancy 固定变换（自反/无参，oneClickDecode 默认参数能解）----
  rot13: cs(/^[A-Za-z\s]+$/, 4, 0.1),
  rot5: cs(/^[0-9\s]+$/, 2, 0.2),
  rot18: cs(/^[A-Za-z0-9\s]+$/, 4, 0.1),
  rot47: cs(/^[\x21-\x7e]+$/, 4, 0.1),
  atbash: cs(/^[A-Za-z\s]+$/, 4, 0.1),
  scytale: cs(/^[A-Za-z\s]+$/, 4, 0.1),
  shiftKey: cs(/^[A-Za-z\s]+$/, 4, 0.1),

 // ---- fancy 参数化（默认参数可能解不出，低置信度兜底）----
  railFence: cs(/^[A-Za-z\s]+$/, 4, 0.1),
  caesar: cs(/^[A-Za-z\s]+$/, 4, 0.1),

 // ---- text ----
  leetSpeak: (t) => {
    const s = (t || "").trim();
    if (!s) return 0;
 // leet 替换字符 013457@$ 等
    const leetChars = /[0134578@$]/.test(s);
    const hasAlpha = /[A-Za-z]/.test(s);
    // leetSpeak 是冷门算法但 detect 命中率极高（含 0/1/@ 就中），易在穷举/多层时前排刷存在感。
    // 降到 0.15（恒烈需求3），配合 compositeScore 里 PLAINTEXT_STYLE_OPS 的 +35 链惩罚一起压后。
    return leetChars && hasAlpha ? 0.15 : 0;
  },
  natoAlphabet: (t) => {
    const s = (t || "").trim().toLowerCase();
    if (!s) return 0;
    const natoWords = ["alpha","bravo","charlie","delta","echo","foxtrot","golf","hotel","india","juliet","kilo","lima","mike","november","oscar","papa","quebec","romeo","sierra","tango","uniform","victor","whiskey","xray","yankee","zulu"];
    const words = s.split(/[\s-]+/);
    let hits = 0;
    for (const w of words) if (natoWords.includes(w)) hits++;
    return hits >= 2 ? 0.6 : hits === 1 ? 0.3 : 0;
  },

 // ---- radix（字符集探测）----
  radixConvert: cs(/^[0-9]+$/, 2, 0.15),
  asciiRadix: cs(/^[0-9]+$/, 2, 0.15),
  ieee754: cs(/^[0-9a-fA-F\s]+$/, 8, 0.2),
  bcd: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[01]{4,}$/.test(s) && s.length % 4 === 0 ? 0.35 : 0;
  },
  binPad: cs(/^[01\s]+$/, 8, 0.4),
  hybridCode: (t) => {
    const s = (t || "").trim();
 // 混合进制：含 0/1 且有分隔
    return /^[01\s]+$/.test(s) && s.length >= 4 ? 0.2 : 0;
  },
  asciiOffset: cs(/^[0-9\s]+$/, 2, 0.2),
  completion: (t) => {
    const s = (t || "").trim();
 // 补全码：通常是固定长度的 0/1 串
    return /^[01]+$/.test(s) && s.length >= 4 ? 0.2 : 0;
  },

 // ---- modern（密文格式探测，需密钥，oneClickDecode 默认参数大概率解不出，低置信度）----
  aes: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
 // AES 密文常为 base64 或 hex，长度 16 倍数
    if (/^[0-9a-fA-F]+$/.test(s) && s.length >= 32 && s.length % 32 === 0) return 0.15;
    if (/^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length >= 24 && s.length % 4 === 0) return 0.1;
    return 0;
  },
  des: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
 // DES 块 8 字节，hex 长度 16 倍数
    if (/^[0-9a-fA-F]+$/.test(s) && s.length >= 16 && s.length % 16 === 0) return 0.12;
    return 0;
  },
  des3: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    if (/^[0-9a-fA-F]+$/.test(s) && s.length >= 32 && s.length % 16 === 0) return 0.12;
    return 0;
  },
  rc4: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 8 && s.length % 2 === 0 ? 0.08 : 0;
  },
  xor: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 2 && s.length % 2 === 0 ? 0.1 : 0;
  },
  fernet: (t) => {
    const s = (t || "").trim();
 // Fernet token 以 gAAAAA 开头（URL-safe base64）
    return /^gAAAAA[A-Za-z0-9_-]+$/.test(s) ? 0.6 : 0;
  },
  rsa: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
 // RSA 密文通常是大 hex 串
    return /^[0-9a-fA-F]{128,512}$/.test(s) ? 0.2 : 0;
  },
  tea: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 16 && s.length % 16 === 0 ? 0.1 : 0;
  },
  xtea: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 16 && s.length % 16 === 0 ? 0.1 : 0;
  },
  xxtea: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 8 ? 0.08 : 0;
  },
  sm4: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    if (/^[0-9a-fA-F]+$/.test(s) && s.length >= 32 && s.length % 32 === 0) return 0.12;
    return 0;
  },
  salsa20: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 16 ? 0.08 : 0;
  },
  chacha20: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 16 ? 0.08 : 0;
  },
  xorStrings: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 2 && s.length % 2 === 0 ? 0.1 : 0;
  },

 // ---- classic（纯字母文本，需密钥/参数，极低置信度兜底）----
  vigenere: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  gronsfeld: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  beaufort: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  autokey: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  porta: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  playfair: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  nihilist: cs(/^[A-Za-z0-9\s]+$/, 6, 0.08),
  columnar: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  hill: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  affine: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  bifid: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  trifid: cs(/^[A-Za-z0-9\s]+$/, 6, 0.08),
  polybius: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
 // Polybius：1-5 的数字对
    return /^[1-5]+$/.test(s) && s.length >= 2 && s.length % 2 === 0 ? 0.4 : 0;
  },
  adfgx: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[ADFGX]+$/.test(s) && s.length >= 2 && s.length % 2 === 0 ? 0.5 : 0;
  },
  adfgvx: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[ADFGVX]+$/.test(s) && s.length >= 2 && s.length % 2 === 0 ? 0.5 : 0;
  },
  foursquare: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  graycode: (t) => {
    const s = (t || "").trim().replace(/\s/g, "");
    return /^[01]+$/.test(s) && s.length >= 4 ? 0.2 : 0;
  },
};

// monkey-patch：为缺 detect 且有 decode 的 op 补全
let patched = 0;
const patchedIds = [];
for (const op of OPS) {
  if (typeof op.detect !== "function" && typeof op.decode === "function" && DETECTORS[op.id]) {
    op.detect = DETECTORS[op.id];
    patched++;
    patchedIds.push(op.id);
  }
}

// 导出诊断信息（供测试/审计用）
export const DETECT_PATCHED = patchedIds;
export function detectAuditStats() {
  const withDetect = OPS.filter((o) => typeof o.detect === "function");
  const without = OPS.filter((o) => typeof o.detect !== "function" && typeof o.decode === "function");
  return { total: OPS.length, withDetect: withDetect.length, decodableWithoutDetect: without.map((o) => o.id) };
}

console.log(`[detectExt] patched ${patched} ops: ${patchedIds.join(", ")}`);
