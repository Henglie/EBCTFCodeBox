/*
 * core/cryptoTryAll.js — 密码学「密钥+密文一键尝试」（T34 交付）
 *
 * 思路参照同类工具密码学窗口 + CyberChef Magic：
 * 输入密文+密钥(+可选IV)，枚举 {AES/DES/3DES/RC4/XOR/Fernet} × {ECB/CBC/CFB/OFB/CTR}
 * × {key/密文/IV 编码 utf8|hex|base64|latin1} × {CBC/ECB pad PKCS7/NoPadding} 组合
 * 逐个试解，用 crib 或「可打印率+熵」打分（复用 T31 scorer），只返回像明文的候选。
 *
 * 红线：
 * - 算法层零 UI 依赖（纯函数，可 node 直跑单测）。
 * - 复用 modern.js 高层 API（aesDecrypt/desDecrypt/des3Decrypt/rc4/xorCrypt/fernetDecrypt）。
 * - 组合爆炸控制：默认集合 + maxAttempts + 时间预算 + 单次 try-catch。
 * - 零外发：全本地纯 JS（Fernet 走 WebCrypto，但仍在本地）。
 *
 * 契约：
 * cryptoTryAll({ cipherText, keyText, ivText?, crib? }, opts?) -> Promise<candidate[]>
 * candidate = { algo, mode?, pad?, keyEnc, cipherEnc, ivEnc?, plaintext, confidence, matchesCrib }
 *
 * 依赖：T12 modern.js 高层 API（就位）；T31 scorer（就位）。TEA/SM4 待 T21。
 */
import { register } from "./registry.js";
import { aesDecrypt, desDecrypt, des3Decrypt, rc4, xorCrypt, fernetDecrypt } from "./modern.js";
import { entropy, isPrintableRatio } from "./magic/scorer.js";
import { md5, md5Bytes } from "./hash.js";
import { rabbitCrypt } from "./streamcipher.js";

const ENCODINGS = ["utf8", "hex", "base64", "latin1"];
const BLOCK_MODES = ["ECB", "CBC", "CFB", "OFB", "CTR"];

// ---------- 字节编解码（自写，避免改 modern.js 导出契约） ----------
function decodeBytes(text, enc) {
  switch (enc) {
    case "hex": {
      const clean = String(text).replace(/[^0-9a-fA-F]/g, "");
      if (clean.length % 2) throw new Error("hex 长度必须为偶数");
      const out = new Uint8Array(clean.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
      return out;
    }
    case "base64": {
      const bin = atob(String(text).replace(/\s/g, ""));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    case "latin1": {
      const s = String(text);
      const out = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
      return out;
    }
    // ---- 口令派生（仅用于 keyEnc）----
    // md5: key = MD5(口令) 裸 16 字节摘要 → AES128/RC4/XOR/DES 派生
    case "md5":
      return md5Bytes(new TextEncoder().encode(String(text)));
    // md5hex: key = MD5(口令) 的 32 字符 hex 文本按 ASCII 当 32 字节 → AES256
    case "md5hex":
      return new TextEncoder().encode(md5(String(text)));
    case "utf8":
    default:
      return new TextEncoder().encode(String(text));
  }
}

function bytesToUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

// ---------- 打分 ----------
/**
 * 给候选明文打分（0-1，越高越像明文）。
 * - crib 命中 → 1.0
 * - U+FFFD 占比 > 10% → 0（无效 UTF-8 多，不是文本明文）
 * - 否则：printableRatio - entropy/16（可打印率高 + 熵低 → 高分），clamp 0-1
 */
function scoreCandidate(plainBytes, crib) {
  const text = bytesToUtf8(plainBytes);
  if (crib) {
    let hit = false;
    try {
      hit = new RegExp(crib).test(text);
    } catch {
      hit = text.includes(crib);
    }
    if (hit) return { confidence: 1.0, matchesCrib: true, text };
  }
 // U+FFFD 占比检查（无效 UTF-8 字节多 → 大量替换字符 → 不是文本明文）
  let replacementCount = 0;
  for (const ch of text) {
    if (ch.codePointAt(0) === 0xFFFD) replacementCount++;
  }
  const replacementRatio = text.length > 0 ? replacementCount / text.length : 0;
  if (replacementRatio > 0.1) {
    return { confidence: 0, matchesCrib: false, text };
  }
  const printableRatio = isPrintableRatio(text);
  const ent = entropy(plainBytes);
  let confidence = printableRatio - ent / 16;
  if (confidence < 0) confidence = 0;
  if (confidence > 1) confidence = 1;
  return { confidence, matchesCrib: false, text };
}

// ---------- 单次尝试 ----------
function tryOne(decryptFn, meta, crib, minConfidence) {
  try {
    const plainBytes = decryptFn();
    if (!plainBytes || plainBytes.length === 0) return null;
    const { confidence, matchesCrib, text } = scoreCandidate(plainBytes, crib);
    if (!matchesCrib && confidence < minConfidence) return null;
    return {
      algo: meta.algo,
      mode: meta.mode || null,
      pad: meta.pad != null ? meta.pad : null,
      keyEnc: meta.keyEnc,
      cipherEnc: meta.cipherEnc,
      ivEnc: meta.ivEnc || null,
      plaintext: text,
      confidence,
      matchesCrib,
    };
  } catch {
    return null; // 解密失败（PKCS7 校验、密钥长度、密文长度等）属正常
  }
}

// ---------- 主入口 ----------
/**
 * 密钥+密文一键尝试。
 * @param {object} input
 * - cipherText: string 密文（必填）
 * - keyText: string 密钥（必填）
 * - ivText: string? IV（可选，块密码非 ECB 用；省略则尝试全0 IV）
 * - crib: string? 目标特征（正则或子串，命中直接 confidence=1.0）
 * @param {object} opts?
 * - maxAttempts: number 默认 2000（组合爆炸上限）
 * - timeBudgetMs: number 默认 3000（时间预算）
 * - minConfidence: number 默认 0.5（低于此分且未命中 crib 的候选丢弃）
 * - algos: string[]? 限制算法集（如 ["AES","RC4"]）
 * - modes: string[]? 限制模式集
 * - encodings: string[]? 限制编码集
 * @returns {Promise<candidate[]>} 按 confidence 降序，crib 命中优先
 */
export async function cryptoTryAll(input, opts = {}) {
  const cipherText = (input && input.cipherText) || "";
  const keyText = (input && input.keyText) || "";
  const ivText = (input && input.ivText) || "";
  const crib = (input && input.crib) || "";
  if (!cipherText || !keyText) return [];

  const maxAttempts = opts.maxAttempts || 2000;
  const timeBudgetMs = opts.timeBudgetMs || 3000;
  const minConfidence = opts.minConfidence != null ? opts.minConfidence : 0.5;
 // algos 大小写不敏感：归一到规范名（UI/用户传 "xor"/"aes" 也能命中）。
  const _canon = { AES: "AES", DES: "DES", "3DES": "3DES", RC4: "RC4", XOR: "XOR", FERNET: "Fernet", RABBIT: "Rabbit" };
  const algos = (opts.algos || ["AES", "DES", "3DES", "RC4", "XOR", "Fernet", "Rabbit"])
    .map((a) => _canon[String(a).toUpperCase()] || a);
  const modes = opts.modes || BLOCK_MODES;
  const encodings = opts.encodings || ENCODINGS;
 // keyEnc 额外含口令 MD5 派生（md5=16B裸摘要 / md5hex=32字符hex当ASCII）——口令爆破主力模式。
 // 密文侧(cipherEnc)不派生。用户显式限定 encodings 时尊重之，不强加派生。
  const keyEncodings = opts.encodings ? encodings : [...ENCODINGS, "md5", "md5hex"];

  const start = Date.now();
  const results = [];
  let attempts = 0;
  const overBudget = () => attempts >= maxAttempts || (Date.now() - start) > timeBudgetMs;

 // ---- Fernet（特殊：keyText 必须 base64url 32B，cipherText 是 token 文本，不参与编码枚举）----
  if (algos.includes("Fernet")) {
    attempts++;
    try {
      const plainBytes = await fernetDecrypt(cipherText, keyText);
      if (plainBytes && plainBytes.length > 0) {
        const { confidence, matchesCrib, text } = scoreCandidate(plainBytes, crib);
        if (matchesCrib || confidence >= minConfidence) {
          results.push({
            algo: "Fernet", mode: null, pad: null,
            keyEnc: "base64url", cipherEnc: "base64url", ivEnc: null,
            plaintext: text, confidence, matchesCrib,
          });
        }
      }
    } catch { /* Fernet 密钥/令牌不匹配，正常 */ }
  }

 // ---- IV 枚举集 ----
 // 提供了 ivText：枚举 4 种编码；未提供：只用全0 IV（ivEnc="zero"）
  const ivVariants = ivText
    ? encodings.map((e) => ({ ivEnc: e, ivText }))
    : [{ ivEnc: "zero", ivText: "" }];

 // ---- 主枚举：cipherEnc × keyEnc × (RC4/XOR + 块密码 × mode × pad × ivVariant) ----
  for (const cipherEnc of encodings) {
    let cipherBytes;
    try { cipherBytes = decodeBytes(cipherText, cipherEnc); } catch { continue; }
    if (cipherBytes.length === 0) continue;

    for (const keyEnc of keyEncodings) {
      let keyBytes;
      try { keyBytes = decodeBytes(keyText, keyEnc); } catch { continue; }
      if (keyBytes.length === 0) continue;

 // RC4 / XOR（流密码，无 mode 无 IV 无 pad）
      if (algos.includes("RC4") && keyBytes.length >= 1) {
        if (overBudget()) return finalize(results);
        attempts++;
        const r = tryOne(() => rc4(cipherBytes, keyBytes),
          { algo: "RC4", keyEnc, cipherEnc }, crib, minConfidence);
        if (r) results.push(r);
      }
      if (algos.includes("XOR") && keyBytes.length >= 1) {
        if (overBudget()) return finalize(results);
        attempts++;
        const r = tryOne(() => xorCrypt(cipherBytes, keyBytes),
          { algo: "XOR", keyEnc, cipherEnc }, crib, minConfidence);
        if (r) results.push(r);
      }

 // Rabbit（RFC 4503 流密码，key 须 16B、IV 须 8B）。枚举 IV 编码；无 IV 时用全0 IV。
      if (algos.includes("Rabbit") && keyBytes.length === 16) {
        for (const ivVar of ivVariants) {
          if (overBudget()) return finalize(results);
          attempts++;
          let ivBytes;
          if (ivVar.ivText) {
            try { ivBytes = decodeBytes(ivVar.ivText, ivVar.ivEnc); } catch { continue; }
            if (ivBytes.length !== 8) continue;
          } else {
            ivBytes = new Uint8Array(8); // 全0 IV
          }
          const r = tryOne(() => rabbitCrypt(cipherBytes, keyBytes, ivBytes),
            { algo: "Rabbit", keyEnc, cipherEnc, ivEnc: ivVar.ivText ? ivVar.ivEnc : "zero" },
            crib, minConfidence);
          if (r) results.push(r);
        }
      }

 // 块密码：AES / DES / 3DES（按密钥长度筛选）
      const blockAlgos = [];
      if (algos.includes("AES") && [16, 24, 32].includes(keyBytes.length)) blockAlgos.push(["AES", 16, aesDecrypt]);
      if (algos.includes("DES") && keyBytes.length === 8) blockAlgos.push(["DES", 8, desDecrypt]);
      if (algos.includes("3DES") && [16, 24].includes(keyBytes.length)) blockAlgos.push(["3DES", 8, des3Decrypt]);

      for (const [algo, bs, decryptFn] of blockAlgos) {
        for (const mode of modes) {
 // CBC/ECB 试 pad=true(PKCS7)/false(NoPadding)；CFB/OFB/CTR 流模式 pad 不适用
          const padVariants = (mode === "CBC" || mode === "ECB") ? [true, false] : [null];
          for (const pad of padVariants) {
 // ECB 不用 IV，只跑一次；其他模式枚举 ivVariants
            const ivLoop = (mode === "ECB") ? [{ ivEnc: null, ivText: "" }] : ivVariants;
            for (const ivVar of ivLoop) {
              if (overBudget()) return finalize(results);
              attempts++;

              let ivBytes = null;
              if (mode !== "ECB") {
                if (ivVar.ivText) {
                  try { ivBytes = decodeBytes(ivVar.ivText, ivVar.ivEnc); } catch { continue; }
                  if (ivBytes.length === 0) continue;
                } else {
                  ivBytes = new Uint8Array(bs); // 全0 IV
                }
              }

              const ivEncLabel = (mode === "ECB") ? null : ivVar.ivEnc;
              const r = tryOne(
                () => decryptFn(cipherBytes, keyBytes, { mode, iv: ivBytes, pad: pad === null ? false : pad }),
                { algo, mode, pad, keyEnc, cipherEnc, ivEnc: ivEncLabel },
                crib, minConfidence,
              );
              if (r) results.push(r);
            }
          }
        }
      }
    }
  }

  return finalize(results);
}

function finalize(results) {
 // 去重（同 algo+mode+pad+keyEnc+cipherEnc+ivEnc+plaintext 只留一个）
  const seen = new Set();
  const dedup = [];
  for (const r of results) {
    const k = r.algo + "|" + (r.mode || "") + "|" + (r.pad == null ? "" : r.pad) +
              "|" + r.keyEnc + "|" + r.cipherEnc + "|" + (r.ivEnc || "") + "|" + r.plaintext;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(r);
  }
 // 排序：crib 命中优先，同则 confidence 降序
  dedup.sort((a, b) => {
    const ab = a.matchesCrib ? 1 : 0;
    const bb = b.matchesCrib ? 1 : 0;
    if (bb !== ab) return bb - ab;
    return b.confidence - a.confidence;
  });
  return dedup;
}

// ---------- op 注册在 main.js（virtual op + renderCryptoTryAll 专属 UI 面板，见 main.js:2223/1251）----------
// 本文件只导出 cryptoTryAll 函数供 main.js 的 renderCryptoTryAll 调用。
// 注：此处曾误加第二个 register（同 id）导致「重复注册 op id: cryptoTryAll」运行时崩溃——
// main.js 早有 virtual op（run 返回空、走专属渲染，交互式填 key/密文不适合通用 params 表单）
// 已删除本文件的重复 register 保留 main.js 版本。cryptoTryAll 是交互工具，不进穷举/magic。

export default { cryptoTryAll };
