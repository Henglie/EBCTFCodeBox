/*
 * dsa.js — DSA 数字签名算法（FIPS 186）+ CTF 常见攻击。
 *
 * 算法照 FIPS 186-4 §4（The Digital Signature Algorithm）实现：
 * 参数：p（L 位素数），q（N 位素数，q | p-1），g = h^((p-1)/q) mod p（阶为 q 的生成元）
 * 私钥 x ∈ [1, q-1]，公钥 y = g^x mod p
 *
 * 签名（消息 hash 记为 z，z = leftmost min(N, hashlen) bits of H(m)）：
 * 选每消息唯一随机数 k ∈ [1, q-1]
 * r = (g^k mod p) mod q （若 r=0 换 k）
 * s = k^{-1}·(z + x·r) mod q （若 s=0 换 k）
 * 签名 = (r, s)
 *
 * 验签：
 * 检查 0 < r < q 且 0 < s < q
 * w = s^{-1} mod q
 * u1 = z·w mod q
 * u2 = r·w mod q
 * v = ((g^u1·y^u2) mod p) mod q
 * 通过 ⟺ v == r
 *
 * 重用 k 攻击（CTF 高频，nonce reuse）：
 * 两条不同消息 m1,m2 用了同一 k（表现为 r1==r2）：
 * s1 = k^{-1}(z1 + x·r), s2 = k^{-1}(z2 + x·r)
 * s1 - s2 = k^{-1}(z1 - z2) ⇒ k = (z1 - z2)·(s1 - s2)^{-1} mod q
 * x = (s1·k - z1)·r^{-1} mod q
 *
 * 红线：
 * - 算法照 FIPS 186-4，不编造。
 * - core 层零 UI 依赖（仅 import registry）。
 * - 纯前端零外发，纯 JS BigInt。
 * - 随机 k 用 crypto.getRandomValues，不用 Math.random。
 * - 消息 hash：支持 SHA-1（Web Crypto）或直接输入整数 z（CTF 常直接给 H(m)）。
 * - 模逆 / 快速幂自备（扩展欧几里得 + 快速幂），不 import 其他 core。
 *
 * 契约：register({ id:"dsa", cat:"crypto", name, desc, params, run })。
 * 工具类，模式用 param mode 选（sign / verify / attack_reuse_k）。
 * 输出 === 标题 === 报告风格。
 */

import { register } from "./registry.js";

// ============================================================
// 通用数论工具（BigInt，局部实现）
// ============================================================

/** 解析单个十进制/0x 十六进制大整数（去空白）。空/非法抛错。 */
function parseBig(s, label) {
  let t = String(s == null ? "" : s).trim();
  if (!t) throw new Error(`缺少参数 ${label}`);
  try {
 // 支持 0x 前缀
    if (/^0x/i.test(t)) return BigInt(t);
    return BigInt(t);
  } catch {
    throw new Error(`参数 ${label} 不是合法整数：${t}`);
  }
}

/** 正规化到 [0, m)。 */
function mod(a, m) {
  const r = a % m;
  return r < 0n ? r + m : r;
}

/** 扩展欧几里得：返回 [g, x, y] 使 a·x + b·y = g。 */
function egcd(a, b) {
  let oldR = a, r = b;
  let oldS = 1n, s = 0n;
  let oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return [oldR, oldS, oldT];
}

/** 模逆 a⁻¹ mod m（要求 gcd(a,m)=1，否则抛错）。 */
function modInverse(a, m) {
  a = mod(a, m);
  const [g, x] = egcd(a, m);
  if (g !== 1n) throw new Error(`模逆不存在：gcd(${a}, ${m}) = ${g} ≠ 1`);
  return mod(x, m);
}

/** 大数模幂 base^exp mod m（exp ≥ 0）。 */
function powMod(base, exp, m) {
  if (m === 1n) return 0n;
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % m;
    exp >>= 1n;
    base = (base * base) % m;
  }
  return result;
}

// ============================================================
// 随机 nonce k ∈ [1, q-1]（crypto.getRandomValues，非 Math.random）
// ============================================================
function randomK(q) {
  const qMinus1 = q - 1n;                 // 取值范围 [1, q-1]
  const bits = q.toString(2).length;
  const bytes = Math.ceil(bits / 8) + 8;  // 多取几字节降低模偏差
  const buf = new Uint8Array(bytes);
  let k;
  do {
    crypto.getRandomValues(buf);
    k = 0n;
    for (const b of buf) k = (k << 8n) | BigInt(b);
    k = (k % qMinus1) + 1n;               // [1, q-1]
  } while (k < 1n || k >= q);
  return k;
}

// ============================================================
// 消息 hash → 整数 z
// hashMode:
// "int" —— text 本身就是整数 H(m)（十进制 / 0x hex），直接用（CTF 常态）
// "sha1" —— 对 text 的 UTF-8 字节做 SHA-1，取 leftmost min(N, 160) bit
// 注：Web Crypto subtle.digest 是异步，这里对 run（同步）不便；
// 故内置一份同步纯 JS SHA-1（仅用于消息摘要，非机密）。
// ============================================================

/** 纯 JS 同步 SHA-1，输入 Uint8Array，返回 20 字节 Uint8Array。 */
function sha1(bytes) {
  const ml = bytes.length * 8;
 // 预处理：追加 0x80，补零到 (len ≡ 56 mod 64)，末尾 64bit 长度
  const withPad = [];
  for (const b of bytes) withPad.push(b);
  withPad.push(0x80);
  while (withPad.length % 64 !== 56) withPad.push(0x00);
 // 64bit 长度（大端），JS 位运算 32bit，分高低写入
  const hi = Math.floor(ml / 0x100000000);
  const lo = ml >>> 0;
  withPad.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
  withPad.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const rotl = (n, c) => (n << c) | (n >>> (32 - c));

  const w = new Array(80);
  for (let off = 0; off < withPad.length; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((withPad[off + i * 4] << 24) | (withPad[off + i * 4 + 1] << 16) |
              (withPad[off + i * 4 + 2] << 8) | (withPad[off + i * 4 + 3])) >>> 0;
    }
    for (let i = 16; i < 80; i++) {
      w[i] = rotl((w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]) >>> 0, 1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k = 0xCA62C1D6; }
      const tmp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl(b, 30) >>> 0; b = a; a = tmp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  const out = new Uint8Array(20);
  [h0, h1, h2, h3, h4].forEach((hh, i) => {
    out[i * 4] = (hh >>> 24) & 0xff;
    out[i * 4 + 1] = (hh >>> 16) & 0xff;
    out[i * 4 + 2] = (hh >>> 8) & 0xff;
    out[i * 4 + 3] = hh & 0xff;
  });
  return out;
}

/** 20 字节摘要 → BigInt，取 leftmost min(N, 160) bit（FIPS 186-4 §4.6）。 */
function hashToZ(bytes, q) {
 // 完整 160bit 整数
  let z = 0n;
  for (const b of bytes) z = (z << 8n) | BigInt(b);
  const N = q.toString(2).length;         // q 的比特长度
  if (N < 160) z = z >> BigInt(160 - N);  // 取最左 N bit
  return z;
}

/**
 * 计算消息 hash 整数 z。
 * @param {string} msg 消息（int 模式为整数字符串，sha1 模式为原文）
 * @param {bigint} q
 * @param {string} hashMode "int" | "sha1"
 */
function computeZ(msg, q, hashMode) {
  if (hashMode === "sha1") {
    const bytes = new TextEncoder().encode(msg);
    return hashToZ(sha1(bytes), q);
  }
 // int：直接把输入当整数 H(m)
  const t = String(msg == null ? "" : msg).trim();
  if (!t) throw new Error("hash 模式为『整数』时消息不能为空，请填 H(m) 的整数值");
  const z = parseBig(t, "z（消息 hash 整数）");
 // FIPS 186-4：z 也需截断到 q 的比特长度以内；这里对超长值取 mod q 前先按需处理。
 // CTF 场景通常已 < q，若 ≥ q 保留原值让 (z mod q) 在签名式里生效即可。
  return z;
}

// ============================================================
// DSA 签名
// ============================================================

/**
 * DSA 签名。
 * @param {bigint} z 消息 hash 整数
 * @param {bigint} p @param {bigint} q @param {bigint} g @param {bigint} x 私钥
 * @param {bigint|null} kFixed 指定 k（教学/复现用），null 则随机
 * @returns {{r:bigint, s:bigint, k:bigint}}
 */
function dsaSign(z, p, q, g, x, kFixed) {
  if (x <= 0n || x >= q) throw new Error(`私钥 x 必须 ∈ [1, q-1]`);
  for (let tries = 0; tries < 64; tries++) {
    const k = kFixed != null ? kFixed : randomK(q);
    if (k <= 0n || k >= q) throw new Error(`k 必须 ∈ [1, q-1]`);
    const r = mod(powMod(g, k, p), q);
    if (r === 0n) {
      if (kFixed != null) throw new Error("指定的 k 导致 r=0，请换 k");
      continue;
    }
    const kInv = modInverse(k, q);
    const s = mod(kInv * (mod(z, q) + x * r), q);
    if (s === 0n) {
      if (kFixed != null) throw new Error("指定的 k 导致 s=0，请换 k");
      continue;
    }
    return { r, s, k };
  }
  throw new Error("多次尝试均得到 r=0 或 s=0，参数可能异常");
}

// ============================================================
// DSA 验签
// ============================================================

/**
 * DSA 验签。
 * @returns {{ok:boolean, v:bigint}}
 */
function dsaVerify(z, r, s, p, q, g, y) {
  if (!(r > 0n && r < q)) return { ok: false, v: -1n, reason: `r 不在 (0, q) 内` };
  if (!(s > 0n && s < q)) return { ok: false, v: -1n, reason: `s 不在 (0, q) 内` };
  const w = modInverse(s, q);
  const u1 = mod(mod(z, q) * w, q);
  const u2 = mod(r * w, q);
  const v = mod(mod(powMod(g, u1, p) * powMod(y, u2, p), p), q);
  return { ok: v === r, v };
}

// ============================================================
// 重用 k 攻击（nonce reuse）：两签名同 r → 恢复 k、私钥 x
// ============================================================

/**
 * @param {bigint} z1 @param {bigint} s1 消息1 hash 与 s
 * @param {bigint} z2 @param {bigint} s2 消息2 hash 与 s
 * @param {bigint} r 公共 r（两签名相同）
 * @param {bigint} q
 * @returns {{k:bigint, x:bigint}}
 */
function attackReuseK(z1, s1, z2, s2, r, q) {
  const sDiff = mod(s1 - s2, q);
  if (sDiff === 0n) throw new Error("s1 == s2 (mod q)，无法恢复 k（消息 hash 相同或数据异常）");
 // k = (z1 - z2)/(s1 - s2) mod q
  const k = mod(mod(z1 - z2, q) * modInverse(sDiff, q), q);
  if (k === 0n) throw new Error("恢复出 k=0，数据异常");
 // x = (s1·k - z1)/r mod q
  const rInv = modInverse(r, q);
  const x = mod((mod(s1 * k, q) - mod(z1, q)) * rInv, q);
  return { k, x };
}

// ============================================================
// 教学 demo 默认参数（小参数，签名→验签→攻击可自洽跑通）
// 来源：构造的合法 DSA 组（p=283, q=47, q|p-1=282=6·47；g=60 阶为 47；x=24）。
// 验证：g^q mod p = 1 且 g≠1，故 g 阶为 q=47。
// ============================================================
const DEMO = {
  p: "283",
  q: "47",
  g: "60",
  x: "24",
 // 教学用固定 k=15（便于复现，真实场景绝不固定/复用 k）
  k: "15",
  z: "123",   // 直接给 H(m) 整数
};

// ============================================================
// run 入口 —— mode 选功能
// ============================================================
function dsaRun(text, p) {
  const mode = (p && p.mode) || "sign";
  const hashMode = (p && p.hashMode) || "int";
  const lines = [];

  if (mode === "sign") {
 // ---- 签名 ----
    const P = parseBig((p && p.p) || DEMO.p, "p");
    const Q = parseBig((p && p.q) || DEMO.q, "q");
    const G = parseBig((p && p.g) || DEMO.g, "g");
    const X = parseBig((p && p.x) || DEMO.x, "x（私钥）");
 // 消息：主输入框优先；空则用 demo z
    const msgRaw = (text && String(text).trim()) ? text : DEMO.z;
    const z = computeZ(msgRaw, Q, hashMode);
 // 可选固定 k
    const kRaw = (p && p.k != null && String(p.k).trim()) ? String(p.k).trim() : "";
    const kFixed = kRaw ? parseBig(kRaw, "k") : null;

    const { r, s, k } = dsaSign(z, P, Q, G, X, kFixed);
 // 自动算公钥便于随后验签
    const y = powMod(G, X, P);

    lines.push("=== DSA 签名 ===");
    lines.push(`p = ${P}`);
    lines.push(`q = ${Q}`);
    lines.push(`g = ${G}`);
    lines.push(`x (私钥) = ${X}`);
    lines.push(`y (公钥 g^x mod p) = ${y}`);
    lines.push(`hash 模式 = ${hashMode === "sha1" ? "SHA-1(消息)" : "整数 H(m)"}`);
    lines.push(`z (消息 hash) = ${z}`);
    lines.push(`k (nonce)${kFixed != null ? " [指定]" : " [随机]"} = ${k}`);
    lines.push("");
    lines.push(`签名结果：`);
    lines.push(`r = ${r}`);
    lines.push(`s = ${s}`);
    lines.push("");
    lines.push(`签名串 (r,s) = ${r},${s}`);
 // 自检验签
    const chk = dsaVerify(z, r, s, P, Q, G, y);
    lines.push(`自检验签 v = ${chk.v}，${chk.ok ? "✓ 通过 (v==r)" : "✗ 失败"}`);
    return lines.join("\n");
  }

  if (mode === "verify") {
 // ---- 验签 ----
    const P = parseBig((p && p.p) || DEMO.p, "p");
    const Q = parseBig((p && p.q) || DEMO.q, "q");
    const G = parseBig((p && p.g) || DEMO.g, "g");
    const Y = parseBig((p && p.y), "y（公钥）");
    const R = parseBig((p && p.r), "r");
    const S = parseBig((p && p.s), "s");
    const msgRaw = (text && String(text).trim()) ? text : DEMO.z;
    const z = computeZ(msgRaw, Q, hashMode);

    const res = dsaVerify(z, R, S, P, Q, G, Y);
    lines.push("=== DSA 验签 ===");
    lines.push(`p = ${P}`);
    lines.push(`q = ${Q}`);
    lines.push(`g = ${G}`);
    lines.push(`y (公钥) = ${Y}`);
    lines.push(`z (消息 hash) = ${z}`);
    lines.push(`r = ${R}`);
    lines.push(`s = ${S}`);
    lines.push("");
    lines.push(`w  = s⁻¹ mod q`);
    lines.push(`v  = ((g^u1·y^u2) mod p) mod q = ${res.v}`);
    lines.push("");
    if (res.reason) {
      lines.push(`✗ 验签失败：${res.reason}`);
    } else {
      lines.push(res.ok ? "✓ 验签通过 (v == r)" : `✗ 验签失败 (v=${res.v} ≠ r=${R})`);
    }
    return lines.join("\n");
  }

  if (mode === "attack_reuse_k") {
 // ---- 重用 k 攻击 ----
    const Q = parseBig((p && p.q) || DEMO.q, "q");
    const R = parseBig((p && p.r), "r（两签名公共 r）");
    const S1 = parseBig((p && p.s1), "s1");
    const S2 = parseBig((p && p.s2), "s2");
 // z1/z2：按 hashMode 从 z1/z2 参数取（整数或对文本 sha1）
    const z1 = computeZ((p && p.z1), Q, hashMode);
    const z2 = computeZ((p && p.z2), Q, hashMode);

    const { k, x } = attackReuseK(z1, S1, z2, S2, R, Q);

    lines.push("=== DSA 重用 k 攻击（nonce reuse）===");
    lines.push("前提：两条签名使用同一随机数 k（表现为 r1 == r2）");
    lines.push("");
    lines.push(`q  = ${Q}`);
    lines.push(`r  = ${R}`);
    lines.push(`z1 = ${z1}, s1 = ${S1}`);
    lines.push(`z2 = ${z2}, s2 = ${S2}`);
    lines.push("");
    lines.push(`k = (z1 - z2)·(s1 - s2)⁻¹ mod q = ${k}`);
    lines.push(`x = (s1·k - z1)·r⁻¹ mod q = ${x}`);
    lines.push("");
    lines.push(`✓ 恢复出 nonce k = ${k}`);
    lines.push(`✓ 恢复出私钥 x = ${x}`);
 // 若提供 p/g/y 可反向校验
    const pRaw = (p && p.p != null && String(p.p).trim());
    const gRaw = (p && p.g != null && String(p.g).trim());
    const yRaw = (p && p.y != null && String(p.y).trim());
    if (pRaw && gRaw && yRaw) {
      const P = parseBig(pRaw, "p");
      const G = parseBig(gRaw, "g");
      const Y = parseBig(yRaw, "y");
      const yCalc = powMod(G, x, P);
      lines.push("");
      lines.push(`校验: g^x mod p = ${yCalc}  (应 = 公钥 y = ${Y})  ${yCalc === Y ? "✓" : "✗"}`);
    } else {
      lines.push("");
      lines.push("提示: 填入 p / g / y 可自动校验 g^x mod p == y。");
    }
    return lines.join("\n");
  }

  throw new Error(`未知 mode: ${mode}`);
}

// ============================================================
// 注册
// ============================================================
register({
  id: "dsa",
  cat: "crypto",
  name: "DSA 签名 / 验签 / 攻击",
  desc: "DSA 数字签名（FIPS 186）：签名 (r,s) / 验签 / 重用 k(nonce) 攻击恢复私钥 x。hash 支持直接整数或 SHA-1。纯 BigInt 本地计算。",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "sign",
      options: [
        { value: "sign", label: "签名（私钥 x → r,s）" },
        { value: "verify", label: "验签（公钥 y + r,s）" },
        { value: "attack_reuse_k", label: "重用 k 攻击（同 r 恢复 x）" },
      ],
    },
    {
      key: "hashMode", label: "消息 hash 方式", type: "select", default: "int",
      options: [
        { value: "int", label: "直接整数 H(m)（CTF 常态）" },
        { value: "sha1", label: "SHA-1(消息文本)" },
      ],
    },
    { key: "p", label: "素数 p", type: "text", default: DEMO.p, placeholder: "L 位素数（demo:283）" },
    { key: "q", label: "素数 q（q|p-1）", type: "text", default: DEMO.q, placeholder: "N 位素数（demo:47）" },
    { key: "g", label: "生成元 g（阶 q）", type: "text", default: DEMO.g, placeholder: "g=h^((p-1)/q)（demo:60）" },
    { key: "x", label: "私钥 x（签名用）", type: "text", default: DEMO.x, placeholder: "x∈[1,q-1]（demo:24）" },
    { key: "y", label: "公钥 y（验签/攻击校验用）", type: "text", default: "", placeholder: "y=g^x mod p" },
    { key: "k", label: "指定 k（签名·可选）", type: "text", default: "", placeholder: "留空随机；教学可填如 15" },
    { key: "r", label: "r（验签/攻击）", type: "text", default: "", placeholder: "签名 r" },
    { key: "s", label: "s（验签）", type: "text", default: "", placeholder: "签名 s" },
    { key: "s1", label: "s1（攻击）", type: "text", default: "", placeholder: "签名1 的 s" },
    { key: "s2", label: "s2（攻击）", type: "text", default: "", placeholder: "签名2 的 s" },
    { key: "z1", label: "z1 消息1 hash（攻击）", type: "text", default: "", placeholder: "整数或原文（依 hash 方式）" },
    { key: "z2", label: "z2 消息2 hash（攻击）", type: "text", default: "", placeholder: "整数或原文（依 hash 方式）" },
  ],
  run: dsaRun,
});

export {
  parseBig,
  mod,
  egcd,
  modInverse,
  powMod,
  randomK,
  sha1,
  hashToZ,
  computeZ,
  dsaSign,
  dsaVerify,
  attackReuseK,
  dsaRun,
  DEMO,
};
