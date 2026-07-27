/*
 * knapsack.js — Merkle-Hellman 背包公钥加密（cat:'modern'）。
 *
 * 算法照 Merkle & Hellman 1978《Hiding Information and Signatures in Trapdoor
 * Knapsacks》原始方案 + HAC §8.6.1 实现，不编造：
 *
 * 密钥生成：
 * ● 私钥：超递增序列 w = (w1..wn)（每项 wi > Σ_{j<i} wj）
 * 模数 q > Σ wi
 * 乘数 r，与 q 互质（gcd(r,q)=1），1 < r < q
 * ● 公钥：β = (β1..βn)，βi = (wi · r) mod q
 *
 * 加密（明文按 bit 逐块，每 n bit 一块）：
 * 取明文 bit 向量 (m1..mn)，密文 c = Σ mi · βi
 *
 * 解密：
 * r⁻¹ = r 关于 q 的逆元（gcd(r,q)=1 保证存在）
 * c' = (c · r⁻¹) mod q
 * 对超递增序列 w 贪心求子集和 = c'：从大到小，wi ≤ c' 则 mi=1 且 c' -= wi，否则 mi=0
 * 还原 bit 向量 → 字节
 *
 * 正确性依据：
 * c·r⁻¹ ≡ Σ mi·βi·r⁻¹ ≡ Σ mi·(wi·r)·r⁻¹ ≡ Σ mi·wi (mod q)
 * 因 Σ mi·wi ≤ Σ wi < q，故模 q 不截断，等式在整数域成立 → 贪心解超递增背包唯一还原。
 *
 * 红线：
 * - 算法照原始方案实现，不编造。
 * - 交付前跑往返测试（encode→decode 复原）。
 * - 随机 seed 用 crypto.getRandomValues，不用 Math.random。
 * - 零外发：纯本地 BigInt 计算。
 * - core 层零 UI 依赖（仅 registry）。
 *
 * 契约：register({id, cat:"modern", name, desc, params, encode, decode})。
 * 密文格式：每块一个十进制大整数，逗号分隔（c1,c2,...）。
 *
 * 安全说明（教学）：低密度背包可被 LO 格归约攻破。
 * density d = n / log2(max βi)，d < 0.9408 时（Coster et al. 1991）
 * 格归约（LLL / CJLOSS）几乎必然还原明文。本 op 仅讲原理，不实现完整 LLL。
 */
import { register } from "./registry.js";

// ============================================================
// 编码工具
// ============================================================
const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度必须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function b64ToBytes(s) {
  const bin = atob(s.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(b) {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}
function decodeInput(text, enc) {
  switch (enc) {
    case "hex": return hexToBytes(text);
    case "base64": return b64ToBytes(text);
    case "utf8":
    default: return te(text);
  }
}
function encodeOutput(bytes, enc) {
  switch (enc) {
    case "hex": return bytesToHex(bytes);
    case "base64": return bytesToB64(bytes);
    case "utf8":
    default: return td(bytes);
  }
}

// ============================================================
// 数论工具（BigInt）
// ============================================================

// 扩展欧几里得：返回 [g, x, y]，满足 a*x + b*y = g = gcd(a,b)
function egcd(a, b) {
  let old_r = a, r = b;
  let old_s = 1n, s = 0n;
  let old_t = 0n, t = 1n;
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
    [old_t, t] = [t, old_t - q * t];
  }
  return [old_r, old_s, old_t];
}

function gcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

// 模逆元 a⁻¹ mod m（gcd(a,m)=1 时存在）
function modInverse(a, m) {
  a = ((a % m) + m) % m;
  const [g, x] = egcd(a, m);
  if (g !== 1n) throw new Error(`模逆元不存在：gcd(${a},${m})=${g} ≠ 1`);
  return ((x % m) + m) % m;
}

// ============================================================
// 随机数（crypto.getRandomValues）
// ============================================================

// 返回 [0, boundExclusive) 内均匀随机 BigInt
function randBigIntBelow(boundExclusive) {
  if (boundExclusive <= 0n) throw new Error("边界必须为正");
  const bits = boundExclusive.toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const buf = new Uint8Array(bytes);
  let n;
  do {
    crypto.getRandomValues(buf);
    n = 0n;
    for (const b of buf) n = (n << 8n) | BigInt(b);
 // 掩掉高位多余 bit，减少 reject 概率
    const excess = BigInt(bytes * 8 - bits);
    if (excess > 0n) n >>= excess;
  } while (n >= boundExclusive);
  return n;
}

// 返回 [min, max] 内随机 BigInt
function randBigIntRange(min, max) {
  return min + randBigIntBelow(max - min + 1n);
}

// ============================================================
// 密钥生成
// ============================================================

/**
 * 生成 Merkle-Hellman 密钥。
 * @param {number} n 背包项数（= 每块 bit 数）
 * @returns {{w: bigint[], q: bigint, r: bigint, beta: bigint[]}}
 * w=超递增私钥序列, q=模数, r=乘数, beta=公钥
 *
 * 超递增序列构造：w1 随机小正数，wi = (Σ_{j<i} wj) + 随机增量（保证严格超递增）。
 * q > Σ wi，r ∈ (1,q) 且 gcd(r,q)=1。
 */
function generateKey(n) {
  if (n < 2 || n > 4096) throw new Error("项数 n 需在 2..4096");
  const w = [];
  let sum = 0n;
 // 每项在前缀和基础上 + [1, 2^k] 增量，保证严格超递增（wi > sum）
  for (let i = 0; i < n; i++) {
 // 增量随位置增长，避免序列过密；起始项 1..256
    const span = 8 + i; // 增量位宽随项数缓增
    const inc = randBigIntRange(1n, 1n << BigInt(span));
    const wi = sum + inc; // wi = 前缀和 + 正增量 > 前缀和 → 严格超递增
    w.push(wi);
    sum += wi;
  }
 // q > Σ wi
  const q = sum + randBigIntRange(1n, 1n << 16n);
 // r ∈ [2, q-1] 且与 q 互质
  let r;
  do {
    r = randBigIntRange(2n, q - 1n);
  } while (gcd(r, q) !== 1n);
 // 公钥 βi = wi·r mod q
  const beta = w.map((wi) => (wi * r) % q);
  return { w, q, r, beta };
}

// 校验超递增
function isSuperincreasing(w) {
  let sum = 0n;
  for (const wi of w) {
    if (wi <= sum) return false;
    sum += wi;
  }
  return true;
}

// ============================================================
// 加密 / 解密（bit 级）
// ============================================================

/**
 * 加密：字节流 → 密文块数组。
 * 每 n bit 一块（MSB 优先），c = Σ mi·βi。
 * 最后一块不足 n bit 补 0（解密时按已知明文字节长度截断）。
 * @param {Uint8Array} bytes
 * @param {bigint[]} beta 公钥
 * @returns {bigint[]} 密文块
 */
function encryptBytes(bytes, beta) {
  const n = beta.length;
 // 展开为 bit 数组（MSB 优先）
  const bits = [];
  for (const byte of bytes) {
    for (let b = 7; b >= 0; b--) bits.push((byte >> b) & 1);
  }
  const cipher = [];
  for (let i = 0; i < bits.length; i += n) {
    let c = 0n;
    for (let j = 0; j < n && i + j < bits.length; j++) {
      if (bits[i + j]) c += beta[j];
    }
    cipher.push(c);
  }
  return cipher;
}

/**
 * 解密：密文块数组 → bit 数组。
 * c' = (c·r⁻¹) mod q，对超递增 w 贪心求子集和。
 * @param {bigint[]} cipher
 * @param {bigint[]} w 超递增私钥
 * @param {bigint} q
 * @param {bigint} r
 * @returns {number[]} bit 数组（MSB 优先，含末块补零）
 */
function decryptBlocks(cipher, w, q, r) {
  const n = w.length;
  const rInv = modInverse(r, q);
 // 从大到小的项索引（超递增贪心需降序）
  const idxDesc = [...Array(n).keys()].sort((a, b) => (w[a] < w[b] ? 1 : w[a] > w[b] ? -1 : 0));
  const bits = [];
  for (const c of cipher) {
    let cp = (c % q) * rInv % q; // c·r⁻¹ mod q
    const blockBits = new Array(n).fill(0);
    for (const idx of idxDesc) {
      if (w[idx] <= cp) {
        blockBits[idx] = 1;
        cp -= w[idx];
      }
    }
    if (cp !== 0n) throw new Error("贪心背包解失败：余量非零，密钥或密文不匹配");
    for (let j = 0; j < n; j++) bits.push(blockBits[j]);
  }
  return bits;
}

// bit 数组 → 字节（MSB 优先，按 byteLen 截断丢弃末块补零）
function bitsToBytes(bits, byteLen) {
  const out = new Uint8Array(byteLen);
  for (let i = 0; i < byteLen; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | (bits[i * 8 + b] || 0);
    }
    out[i] = byte;
  }
  return out;
}

// ============================================================
// 密钥序列化：逗号分隔十进制大整数
// ============================================================
function parseBigIntList(text) {
  return text.trim().replace(/[\s\n\r]/g, "").split(",").filter(Boolean).map((s) => BigInt(s));
}
function formatBigIntList(list) {
  return list.map((x) => x.toString(10)).join(",");
}

// ============================================================
// 内置教学 demo 密钥（超递增序列，n=8，可自洽往返）
// 经典教科书示例扩展版。
// ============================================================
const DEMO_W = [2n, 3n, 6n, 13n, 27n, 52n, 105n, 210n];
const DEMO_Q = 467n;   // > Σw = 418
const DEMO_R = 116n;   // gcd(116,467)=1
// βi = wi·r mod q
const DEMO_BETA = DEMO_W.map((wi) => (wi * DEMO_R) % DEMO_Q);

// 密度估算：d = n / log2(max βi)
function density(beta) {
  const n = beta.length;
  let maxB = 0n;
  for (const b of beta) if (b > maxB) maxB = b;
  const log2max = maxB > 0n ? maxB.toString(2).length : 1;
  return n / log2max;
}

// ============================================================
// op 注册
// ============================================================
const DATA_ENC = [
  { value: "utf8", label: "UTF-8" },
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
];

/**
 * 解析密钥来源：
 * keyMode='demo' 用内置 demo 密钥
 * keyMode='gen' 用 seed... 其实按 n 现场随机生成，输出到报告让用户回填
 * keyMode='manual' 用用户填的 w,q,r（私钥）/ beta（公钥）
 * 加密只需 beta（+ n）；解密需 w,q,r。
 */
function resolveKeyForEncode(p) {
  const mode = p.keyMode || "demo";
  if (mode === "demo") {
    return { beta: DEMO_BETA.slice(), w: DEMO_W.slice(), q: DEMO_Q, r: DEMO_R, generated: false };
  }
  if (mode === "gen") {
    const n = Math.max(2, Math.min(4096, parseInt(p.n || "8", 10) || 8));
    const k = generateKey(n);
    return { ...k, generated: true };
  }
 // manual
  const betaStr = (p.beta || "").trim();
  const wStr = (p.w || "").trim();
  const qStr = (p.q || "").trim();
  const rStr = (p.r || "").trim();
  let beta;
  if (betaStr) {
    beta = parseBigIntList(betaStr);
  } else if (wStr && qStr && rStr) {
 // 无 beta 但给了私钥 → 现算公钥
    const w = parseBigIntList(wStr);
    const q = BigInt(qStr), r = BigInt(rStr);
    beta = w.map((wi) => (wi * r) % q);
  } else {
    throw new Error("手动加密需填 公钥 β，或同时填 w/q/r 让程序算 β");
  }
  return {
    beta,
    w: wStr ? parseBigIntList(wStr) : null,
    q: qStr ? BigInt(qStr) : null,
    r: rStr ? BigInt(rStr) : null,
    generated: false,
  };
}

function resolveKeyForDecode(p) {
  const mode = p.keyMode || "demo";
  if (mode === "demo") {
    return { w: DEMO_W.slice(), q: DEMO_Q, r: DEMO_R };
  }
 // gen / manual 解密都需要用户给 w/q/r（gen 模式的密钥已在加密报告里输出，用户回填 manual）
  const wStr = (p.w || "").trim();
  const qStr = (p.q || "").trim();
  const rStr = (p.r || "").trim();
  if (!wStr || !qStr || !rStr) {
    throw new Error("解密需填私钥：超递增序列 w、模数 q、乘数 r（gen 模式请把加密报告输出的密钥回填到手动字段）");
  }
  const w = parseBigIntList(wStr);
  const q = BigInt(qStr), r = BigInt(rStr);
  if (!isSuperincreasing(w)) throw new Error("w 非超递增序列，无法贪心解背包");
  if (gcd(r, q) !== 1n) throw new Error(`gcd(r,q)=${gcd(r, q)} ≠ 1，r⁻¹ mod q 不存在`);
  return { w, q, r };
}

register({
  id: "knapsack",
  cat: "modern",
  name: "背包加密（Merkle-Hellman）",
  desc: "Merkle-Hellman 背包公钥加密：私钥超递增序列 w+模数 q+乘数 r，公钥 β=w·r mod q；加密按 bit 求和，解密用 r⁻¹ 还原后贪心解背包。密文=逗号分隔十进制块。",
  params: [
    {
      key: "keyMode", label: "密钥来源", type: "select", default: "demo",
      options: [
        { value: "demo", label: "教学 demo 密钥（n=8）" },
        { value: "gen", label: "现场生成（填项数 n）" },
        { value: "manual", label: "手动填密钥" },
      ],
    },
    { key: "n", label: "项数 n（gen 模式）", type: "number", default: 8, placeholder: "2..4096，每块 bit 数" },
    { key: "beta", label: "公钥 β（manual 加密）", type: "text", default: "", placeholder: "逗号分隔十进制，或改填 w/q/r 自动算" },
    { key: "w", label: "私钥 w 超递增序列（manual/解密）", type: "text", default: "", placeholder: "逗号分隔十进制" },
    { key: "q", label: "模数 q（manual/解密）", type: "text", default: "", placeholder: "十进制，q > Σw" },
    { key: "r", label: "乘数 r（manual/解密）", type: "text", default: "", placeholder: "十进制，gcd(r,q)=1" },
    { key: "dataEnc", label: "明文编码", type: "select", default: "utf8", options: DATA_ENC },
    { key: "outEnc", label: "解密输出", type: "select", default: "utf8", options: DATA_ENC },
  ],

 // ---- 加密 ----
  encode: (text, p) => {
    const key = resolveKeyForEncode(p);
    const beta = key.beta;
    const n = beta.length;
    const bytes = decodeInput(text, p.dataEnc || "utf8");
    if (bytes.length === 0) throw new Error("明文为空");
    const cipher = encryptBytes(new Uint8Array(bytes), beta);

    const lines = [];
    lines.push("=== 背包加密（Merkle-Hellman）· 加密 ===");
    lines.push("");
    lines.push("● 参数");
    lines.push(`  项数 n（每块 bit）: ${n}`);
    lines.push(`  明文字节数: ${bytes.length}`);
    lines.push(`  密文块数: ${cipher.length}`);
    lines.push("");
    lines.push("● 公钥 β");
    lines.push(`  ${formatBigIntList(beta)}`);
    if (key.w) {
      lines.push("");
      lines.push("● 私钥（解密需回填到手动字段）");
      lines.push(`  w = ${formatBigIntList(key.w)}`);
      lines.push(`  q = ${key.q.toString(10)}`);
      lines.push(`  r = ${key.r.toString(10)}`);
      if (key.generated) {
        lines.push("  ▸ gen 模式随机生成：解密请切到 manual 或直接把上面 w/q/r 填入对应字段。");
      }
    }
    lines.push("");
    lines.push("● 密文（逗号分隔十进制块，回填此串到解密输入）");
    lines.push(`  CT: ${formatBigIntList(cipher)}`);
    lines.push("");
 // 密度与安全提示
    const d = density(beta);
    lines.push("● 安全说明（教学）");
    lines.push(`  背包密度 d = n / log2(max β) ≈ ${d.toFixed(4)}`);
    if (d < 0.9408) {
      lines.push("  × 低密度（d < 0.9408）：LO / CJLOSS 格归约（LLL）几乎必然还原明文，此参数不安全。");
    } else {
      lines.push("  ✓ 密度 ≥ 0.9408：低密度格攻击不直接适用（但 Shamir 攻击等仍威胁原始 MH 方案）。");
    }
    lines.push("  ▸ Merkle-Hellman 原始方案已被 Shamir(1984) 攻破，仅作教学/CTF 用途，勿用于真实加密。");
    return lines.join("\n");
  },

 // ---- 解密 ----
  decode: (text, p) => {
 // 从输入里提取密文块（容忍用户直接粘报告，抓最后一段逗号分隔数字串）
    const cipher = parseCipherFromInput(text);
    if (cipher.length === 0) throw new Error("未解析到密文块（应为逗号分隔的十进制大整数）");
    const key = resolveKeyForDecode(p);
    const { w, q, r } = key;
    const n = w.length;

    const bits = decryptBlocks(cipher, w, q, r);
 // 末块补零无法从密文得知，按 8 bit 对齐取整；用户可按需截断
    const byteLen = Math.floor(bits.length / 8);
    const bytes = bitsToBytes(bits, byteLen);
 // 去除末尾可能的补零字节（bit 补零通常落在最后一字节的低位或整字节 0）
    let end = bytes.length;
    while (end > 0 && bytes[end - 1] === 0) end--;
    const trimmed = bytes.subarray(0, end);
    const out = encodeOutput(end === bytes.length ? bytes : trimmed, p.outEnc || "utf8");

    const lines = [];
    lines.push("=== 背包加密（Merkle-Hellman）· 解密 ===");
    lines.push("");
    lines.push("● 私钥");
    lines.push(`  w = ${formatBigIntList(w)}`);
    lines.push(`  q = ${q.toString(10)}`);
    lines.push(`  r = ${r.toString(10)}`);
    lines.push(`  r⁻¹ mod q = ${modInverse(r, q).toString(10)}`);
    lines.push("");
    lines.push(`● 密文块数: ${cipher.length}（每块 ${n} bit）`);
    lines.push("");
    lines.push("● 明文");
    lines.push(`  ${out}`);
    return lines.join("\n");
  },
});

// 从输入文本抓密文块。
// 优先锚定 "CT:" 后的数字串（加密报告输出格式，避免误把公钥 β/私钥 w 当密文）；
// 无锚点时（用户直接粘裸密文串）取全文里块最多的逗号分隔数字串。
function parseCipherFromInput(text) {
  const raw = String(text || "");
 // ① 优先锚点 CT:
  const anchored = raw.match(/CT:\s*([0-9]+(?:\s*,\s*[0-9]+)*)/);
  if (anchored) return parseBigIntList(anchored[1]);
 // ② 无锚点：收集所有 "逗号/空白 分隔的十进制数字" 片段，选块最多者（平手取最长）
  const candidates = raw.match(/[0-9]+(?:\s*,\s*[0-9]+)*/g) || [];
  if (candidates.length === 0) return [];
  let best = "";
  let bestCount = -1;
  for (const c of candidates) {
    const count = (c.match(/,/g) || []).length;
    if (count > bestCount || (count === bestCount && c.length > best.length)) {
      best = c;
      bestCount = count;
    }
  }
  return parseBigIntList(best);
}

export { generateKey, encryptBytes, decryptBlocks, modInverse, egcd, gcd, isSuperincreasing, density };
