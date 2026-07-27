/*
 * xorAnalyze.js — xortool 一体化（重复密钥 XOR 分析，cat:'analysis'，run 型）。
 *
 * 定位：CTF crypto 高频。给定重复密钥 XOR 密文，自动猜 key 长度 + 逐字节恢复 key +
 * 解密结果。对标 xortool 但纯前端。对应 ctf-tools crypto 节 + ctf-wiki crypto。
 *
 * 算法（经典方法）：
 * 1. **猜 key 长度**：对每个候选 keylen (1..maxKeyLen)，把密文按 keylen 分块
 * 计算块间归一化汉明距离（每字节平均汉明距离）。取最小值对应的 keylen
 * （正确 keylen 下，块间汉明距离最低，因相同位置密钥相同 → 异或后分布更集中）。
 * 2. **逐字节恢复 key**：对每个 key 字节位 i，把所有块的第 i 字节收集
 * 对 256 个候选字节 k 做 single-byte XOR，用英文卡方打分，取最优 k。
 * 3. **输出**：top 3 keylen 候选 + 最优 key + 解密结果（前 2000 字符）+ 置信度。
 *
 * 红线：
 * - 算法层零 UI 依赖（仅 registry）。
 * - 零外发：纯本地计算。
 * - 件内自注册（register(op)）。
 * - 不 import xorCribDrag/hamming（避依赖耦合，自备汉明距离）。
 *
 * 契约：register({id, cat:'analysis', name, desc, params, run})。
 *
 * 参考：
 * - cryptopals Set 1 Challenge 6（Vigenère/Breaking repeating-key XOR）
 * - xortool 工具（https://github.com/hellman/xortool）
 * - ctf-wiki crypto（重复密钥 XOR）
 */
import { register } from "./registry.js";

// ============================================================
// 输入解析
// ============================================================
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度需为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function base64ToBytes(s) {
  const bin = atob(s.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function parseInput(text, inputEnc) {
  const s = String(text || "").trim();
  if (!s) return new Uint8Array(0);
  if (inputEnc === "hex") return hexToBytes(s);
  if (inputEnc === "base64") return base64ToBytes(s);
 // auto
  const stripped = s.replace(/\s/g, "");
  if (/^[0-9a-fA-F]+$/.test(stripped) && stripped.length % 2 === 0) {
    return hexToBytes(s);
  }
  return base64ToBytes(s);
}

// ============================================================
// 汉明距离（位数差）
// ============================================================
function hammingDistance(a, b) {
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a[i] ^ b[i];
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

// ============================================================
// 英文频率卡方打分（分越低越像英文）
// ============================================================
// 英文字母频率（百分比），用 cryptopals 标准
const EN_FREQ = {
  a: 8.167, b: 1.492, c: 2.782, d: 4.253, e: 12.702, f: 2.228, g: 2.015,
  h: 6.094, i: 6.966, j: 0.153, k: 0.772, l: 4.025, m: 2.406, n: 6.749,
  o: 7.507, p: 1.929, q: 0.095, r: 5.987, s: 6.327, t: 9.056, u: 2.758,
  v: 0.978, w: 2.360, x: 0.150, y: 1.974, z: 0.074,
  " ": 13.0, // 空格加权
};

// 英文 bigram 频率表（log10 相对频率，越高越常见）。
// 用于"整段明文"打分（非单列），弥补单字节卡方在小样本上的噪声。
// 来源：Norvig 英文 n-gram 统计（top 50 截取）。
const EN_BIGRAMS = {
  th: 2.71, he: 2.33, in: 1.83, er: 1.79, an: 1.62, re: 1.53, on: 1.42, at: 1.36,
  en: 1.33, nd: 1.31, ti: 1.28, es: 1.27, or: 1.21, te: 1.19, of: 1.17, ed: 1.17,
  is: 1.13, it: 1.12, al: 1.09, ar: 1.07, st: 1.05, to: 1.05, nt: 1.04, ng: 0.95,
  se: 0.93, ha: 0.93, as: 0.87, ou: 0.87, io: 0.83, le: 0.83, ve: 0.83, co: 0.79,
  me: 0.79, de: 0.76, hi: 0.73, ri: 0.73, ro: 0.73, ic: 0.70, ne: 0.69, ea: 0.69,
  ra: 0.62, ce: 0.65, li: 0.62, ch: 0.60, ll: 0.58, be: 0.58, ma: 0.57, si: 0.55,
  om: 0.55, ur: 0.54,
};

function scoreEnglish(bytes) {
 // 卡方：sum((observed - expected)^2 / expected)，仅对字母+空格统计
  const counts = {};
  let letterTotal = 0;
  for (const b of bytes) {
    const ch = String.fromCharCode(b).toLowerCase();
    if (EN_FREQ[ch] !== undefined) {
      counts[ch] = (counts[ch] || 0) + 1;
      letterTotal++;
    }
  }
  let chi = 0;
  if (letterTotal > 0) {
    for (const ch in counts) {
      const expected = (EN_FREQ[ch] / 100) * letterTotal;
      const observed = counts[ch];
      if (expected > 0) chi += ((observed - expected) ** 2) / expected;
    }
  } else {
    chi = 1e6; // 无字母 → 重罚
  }
 // 字母+空格占比：英文 ~80%，垃圾可打印但符号多 → 占比低
  let printable = 0;
  let nonPrintable = 0;
  for (const b of bytes) {
    if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09) printable++;
    else nonPrintable++;
  }
  const pr = printable / bytes.length;
  const letterRatio = letterTotal / bytes.length;
 // 综合：字母占比为主（英文 ~80% 字母+空格，垃圾符号多 → 占比低）
 // 卡方为次（小样本卡方噪声大，仅作微弱仲裁），非打印重罚。
  return -letterRatio * 100 + chi * 0.3 + nonPrintable * 200 - pr * 20;
}

// 整段明文 bigram 打分（越高越像英文）。用于 crackByte top N 候选组合择优。
// 单列字节是间隔采样，bigram 不连续 → 对单列无效；必须对重建后的整段明文打分。
function scoreBigram(plain) {
  let score = 0;
  for (let i = 0; i < plain.length - 1; i++) {
    const a = String.fromCharCode(plain[i]).toLowerCase();
    const b = String.fromCharCode(plain[i + 1]).toLowerCase();
    const bg = a + b;
    if (EN_BIGRAMS[bg] !== undefined) {
      score += EN_BIGRAMS[bg];
    } else if (!/[a-z]/.test(a) || !/[a-z]/.test(b)) {
 // 非字母对轻微惩罚（标点/数字/控制字符相邻）
      score -= 0.5;
    }
  }
  return score;
}

// ============================================================
// 单字节 XOR 破解某 key 字节位
// ============================================================
function crackByte(colBytes) {
 // colBytes: 所有密文块在该 key 字节位的字节集合
  let bestKey = 0;
  let bestScore = Infinity;
  for (let k = 0; k < 256; k++) {
    const decrypted = new Uint8Array(colBytes.length);
    for (let i = 0; i < colBytes.length; i++) decrypted[i] = colBytes[i] ^ k;
    const sc = scoreEnglish(decrypted);
    if (sc < bestScore) {
      bestScore = sc;
      bestKey = k;
    }
  }
  return { key: bestKey, score: bestScore };
}

// crackByte 返回 top N 候选（用于 bigram 组合择优）。
// 小样本卡方噪声大，真 key 字节可能不在 top 1 但在 top 3 内；
// bigram 对整段明文打分能救回。
function crackByteTopN(colBytes, topN = 3) {
  const candidates = [];
  for (let k = 0; k < 256; k++) {
    const decrypted = new Uint8Array(colBytes.length);
    for (let i = 0; i < colBytes.length; i++) decrypted[i] = colBytes[i] ^ k;
    const sc = scoreEnglish(decrypted);
    candidates.push({ key: k, score: sc });
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, topN);
}

// 组合优化：对每个 key 字节位的 top N 候选，组合后用 bigram 打分整段明文选最优。
// 组合数 = topN^kl，太大（> 20000）时退化为 top 1（即原 crackByte 结果）。
function refineKeyWithBigram(cipher, kl, topCandidates) {
  const topN = topCandidates[0].length;
  const combos = topN ** kl;
 // 退化阈值 20000：5^6=15625 可行，5^7=78125 退化。大 keylen 用 top 1。
  if (combos > 20000) {
 // 退化：每位置取 top 1
    const key = new Uint8Array(kl);
    for (let i = 0; i < kl; i++) key[i] = topCandidates[i][0].key;
    return key;
  }
  let bestKey = new Uint8Array(kl);
  let bestScore = -Infinity;
  const currentKey = new Uint8Array(kl);
  function recurse(pos) {
    if (pos === kl) {
 // 重建 plain 并 bigram 打分
      let sc = 0;
      for (let i = 0; i < cipher.length - 1; i++) {
        const a = cipher[i] ^ currentKey[i % kl];
        const b = cipher[i + 1] ^ currentKey[(i + 1) % kl];
        const ca = String.fromCharCode(a).toLowerCase();
        const cb = String.fromCharCode(b).toLowerCase();
        const bg = ca + cb;
        if (EN_BIGRAMS[bg] !== undefined) sc += EN_BIGRAMS[bg];
        else if (!/[a-z]/.test(ca) || !/[a-z]/.test(cb)) sc -= 0.5;
      }
      if (sc > bestScore) {
        bestScore = sc;
        bestKey = new Uint8Array(currentKey);
      }
      return;
    }
    for (const cand of topCandidates[pos]) {
      currentKey[pos] = cand.key;
      recurse(pos + 1);
    }
  }
  recurse(0);
  return bestKey;
}

// ============================================================
// 主算法
// ============================================================
/**
 * @param {Uint8Array} cipher
 * @param {number} maxKeyLen
 * @returns {{topKeyLens, bestKey, bestPlain, bestKeyLen, confidence}}
 */
function xorAnalyze(cipher, maxKeyLen) {
  if (cipher.length < 8) {
    throw new Error("密文太短（< 8 字节），无法分析");
  }
  maxKeyLen = Math.max(2, Math.min(maxKeyLen, Math.floor(cipher.length / 2)));

 // 1. 猜 key 长度：归一化汉明距离
  const keyLenScores = [];
  for (let kl = 1; kl <= maxKeyLen; kl++) {
 // 取前若干块算平均归一化汉明距离
    const numBlocks = Math.min(8, Math.floor(cipher.length / kl));
    if (numBlocks < 2) continue;
    let totalDist = 0;
    let pairs = 0;
    for (let i = 0; i < numBlocks - 1; i++) {
      const a = cipher.subarray(i * kl, (i + 1) * kl);
      const b = cipher.subarray((i + 1) * kl, (i + 2) * kl);
      totalDist += hammingDistance(a, b) / kl; // 归一化（每字节平均）
      pairs++;
    }
    const avgDist = totalDist / pairs;
    keyLenScores.push({ keyLen: kl, score: avgDist });
  }
 // 升序（汉明距离小 = 更可能）
  keyLenScores.sort((a, b) => a.score - b.score);
  const topKeyLens = keyLenScores.slice(0, 3);

 // 2. 对每个候选 keylen 逐字节恢复 key + 解密 + 打分
 // 谐波问题：keylen=6 对 3 字节 key 也低距离，但列更短 → 卡方更噪。
 // 解法：跑全部 keylen 候选（不只 top 3），按解密质量择优（英文卡方 + 字母占比）
 // 并在平手时偏好更短 keylen（真 keylen 的倍数 key 会周期重复）。
 // 小样本改善：crackByte 改为返回 top 3 候选，组合后用 bigram 打分整段明文选最优
 // （单列字节是间隔采样，bigram 不连续 → 对单列无效；但对重建后的整段明文有效）。
  const candidates = [];
  for (const cand of keyLenScores) {
    const kl = cand.keyLen;
 // 两阶段破解：① crackByteTopN 每列得 top 5 候选 ② bigram 组合择优
 // topN=5：小样本下真 key 字节可能在 top 3-5 内（top 3 偶尔漏）。
 // 组合数 5^kl，kl≤5 时 ≤3125 可行；kl≥6 时 >10000 退化为 top 1。
    const topCandidates = [];
    for (let i = 0; i < kl; i++) {
      const col = [];
      for (let j = i; j < cipher.length; j += kl) col.push(cipher[j]);
      topCandidates.push(crackByteTopN(new Uint8Array(col), 5));
    }
    const key = refineKeyWithBigram(cipher, kl, topCandidates);
    const plain = new Uint8Array(cipher.length);
    for (let i = 0; i < cipher.length; i++) plain[i] = cipher[i] ^ key[i % kl];
 // 质量分：scoreEnglish（卡方+字母占比，越低越优）+ bigram（整段明文连贯性，越高越优）
 // 综合：quality = scoreEnglish - bigram*10，越低越优。
 // 单独 scoreEnglish 在小样本下会被谐波 keylen 误导（谐波 keylen 列更短→卡方更噪→
 // 选错 key 字节但碰巧字母占比高→quality 更低）。加 bigram 项后，真 keylen 的明文
 // bigram 正分（th/he/in 等常见对），谐波 keylen 的乱码 bigram 负分，有效区分。
    const bigramScore = scoreBigram(plain);
    const quality = scoreEnglish(plain) - bigramScore * 10;
    let printable = 0;
    for (const b of plain) {
      if ((b >= 0x20 && b <= 0x7e) || b === 0x0a || b === 0x0d || b === 0x09) printable++;
    }
    const pr = printable / plain.length;
    candidates.push({ keyLen: kl, key, plain, quality, pr, hamming: cand.score });
  }
 // 排序：质量分升序（越低越优）→ 平手时 keylen 升序（短 key 优先，消谐波）
 // 阈值 5：差异 > 5 分即信 quality；差异 ≤ 5 视为平手，短 key 优先。
 // 旧阈值 30 太宽：kl=6(-103) vs kl=2(-76) 差 27 被误判为平手 → 选错短 keylen。
  candidates.sort((a, b) => {
    if (Math.abs(a.quality - b.quality) > 5) return a.quality - b.quality;
    return a.keyLen - b.keyLen;
  });
  const best = candidates[0];
  const bestKeyLen = best.keyLen;
  const key = best.key;
  const plain = best.plain;
  const pr = best.pr;

 // 3. 检测 key 周期性：若 key 是某更短 key 的重复（如 "KEYKEY" → "KEY"），缩减
  for (let period = 1; period <= bestKeyLen / 2; period++) {
    if (bestKeyLen % period !== 0) continue;
    let periodic = true;
    for (let i = period; i < bestKeyLen; i++) {
      if (key[i] !== key[i % period]) { periodic = false; break; }
    }
    if (periodic) {
 // key 是 period 长度的重复，缩减报告
      const shortKey = key.subarray(0, period);
      return {
        topKeyLens, bestKey: shortKey, bestPlain: plain,
        bestKeyLen: period, confidence: pr > 0.95 ? "高" : pr > 0.8 ? "中" : "低",
        printableRatio: pr,
      };
    }
  }

 // 4. 置信度：基于 top1 与 top2 汉明距离差 + 解密结果可打印率
  const distDiff = topKeyLens.length > 1
    ? (topKeyLens[1].score - topKeyLens[0].score)
    : 0;
  let confidence;
  if (pr > 0.95 && distDiff > 0.2) confidence = "高";
  else if (pr > 0.8) confidence = "中";
  else confidence = "低";

  return { topKeyLens, bestKey: key, bestPlain: plain, bestKeyLen, confidence, printableRatio: pr };
}

// ============================================================
// 工具：bytes → 显示
// ============================================================
function bytesToHex(bytes, max = 64) {
  let s = "";
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) s += "…";
  return s;
}

function bytesToText(bytes, max = 2000) {
  try {
    const s = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return s.length > max ? s.slice(0, max) + " …(截断)" : s;
  } catch {
    return bytesToHex(bytes, 2000);
  }
}

// ============================================================
// run：主入口
// ============================================================
function xorAnalyzeRun(text, p) {
  const inputEnc = (p && p.inputEnc) || "auto";
  const maxKeyLen = Math.max(2, Math.min(64, parseInt((p && p.maxKeyLen) || "32", 10) || 32));

  const lines = [];
  lines.push("=== xortool 一体化（重复密钥 XOR 分析） ===");
  lines.push("");

  let cipher;
  try {
    cipher = parseInput(text, inputEnc);
  } catch (e) {
    lines.push("✗ 密文解析失败: " + (e.message || String(e)));
    return lines.join("\n");
  }

  lines.push("密文长度: " + cipher.length + " 字节");
  lines.push("最大 key 长度: " + maxKeyLen);
  lines.push("");

  if (cipher.length < 16) {
    lines.push("✗ 密文太短（< 16 字节），重复密钥 XOR 分析需较长密文（建议 ≥ 50 字节）");
    return lines.join("\n");
  }

  let result;
  try {
    result = xorAnalyze(cipher, maxKeyLen);
  } catch (e) {
    lines.push("✗ 分析失败: " + (e.message || String(e)));
    return lines.join("\n");
  }

  lines.push("--- key 长度候选（归一化汉明距离，低=优） ---");
  for (const k of result.topKeyLens) {
    lines.push("  keylen=" + k.keyLen + "  距离=" + k.score.toFixed(4));
  }
  lines.push("");

  lines.push("--- 最优 key（keylen=" + result.bestKeyLen + "） ---");
  lines.push("  hex: " + bytesToHex(result.bestKey, 128));
 // 尝试以 ASCII 显示
  let keyAscii = "";
  for (const b of result.bestKey) {
    keyAscii += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : "·";
  }
  lines.push("  ascii: " + keyAscii);
  lines.push("");

  lines.push("--- 解密结果（置信度: " + result.confidence + "，可打印率: " + (result.printableRatio * 100).toFixed(1) + "%） ---");
  lines.push(bytesToText(result.bestPlain, 2000));
  lines.push("");

  lines.push("说明:");
  lines.push("  · 算法: 汉明距离猜 keylen → 单字节 XOR 卡方打分逐字节恢复 key → bigram 组合择优");
  lines.push("  · 置信度高 = 解密结果高度可打印 + top1 与 top2 距离差大");
  lines.push("  · 若置信度低，尝试：① 调大 maxKeyLen ② 检查输入是否真为重复密钥 XOR");
  lines.push("  · 密文越长分析越准，建议 ≥ 10 × keylen 字节");
  lines.push("  · 小样本（< 200 字节）卡方噪声大，bigram 组合择优可改善但不保证全对");
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "xorAnalyze",
  cat: "analysis",
  name: "xortool 一体化（重复密钥 XOR 分析）",
  desc: "汉明距离猜 key 长度 + 卡方打分逐字节恢复 key + bigram 组合择优 + 解密结果：纯前端 xortool，keylen 1-64 可配",
  params: [
    { key: "maxKeyLen", label: "最大 key 长度", type: "number", default: 32, placeholder: "2-64，默认 32" },
    {
      key: "inputEnc", label: "密文编码", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ],
    },
  ],
  run: xorAnalyzeRun,
});

export { xorAnalyze, crackByte, crackByteTopN, refineKeyWithBigram, hammingDistance };
