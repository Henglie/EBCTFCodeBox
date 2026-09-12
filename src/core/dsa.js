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
 * 契约：族滑块四档 op（T396-A）：dsaParamGen / dsaSign / dsaVerify / dsaReuseK，
 *        family:"dsa"。输出 === 标题 === 报告风格。
 */

import { register } from "./registry.js";
import { generatePrime, isProbablePrime } from "./primeGen.js"; // keygen 参数组生成复用（Miller-Rabin，FIPS 186-5 一致判据）

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
// DSA 四档算法族（T396-A，2026-09-04：同族多操作必须族滑块，废除下拉切模式）
// family:"dsa" + familyLabel → fam.lbl.*（keygen/sign/verify 已有主表 key；
// 攻击档用 attack——需主控在 zh/en i18n 主表新增 fam.lbl.attack）。
// 底层 dsaSign/dsaVerify/attackReuseK/参数组生成实现原样复用，
// 每个 op 只保留本档参数面。
// ============================================================

// ---- 档① 生成密钥对/参数组 ----
register({
  id: "dsaParamGen",
  cat: "asym",
  family: "dsa",
  familyLabel: "keygen",
  name: "DSA 密钥对/参数组生成",
  desc: "DSA 密钥对与参数组生成（FIPS 186-5 §A.1.1-§A.2.1）：q（N 位素数）→ p=k·q+1（L 位素数）→ g=h^((p-1)/q) mod p（阶 q 生成元）→ 私钥 x ∈ [1,q-1]，公钥 y=g^x mod p。仅认可现行 (L,N)=(2048,224)/(2048,256)/(3072,256)，1024 及以下已废止",
  params: [
    {
      key: "ln", label: "参数组 L/N", type: "select", default: "2048/256",
      options: [
        { value: "2048/256", label: "2048 / 256（推荐）" },
        { value: "2048/224", label: "2048 / 224" },
        { value: "3072/256", label: "3072 / 256（生成较慢）" },
      ],
    },
  ],
  run: (_text, p) => {
    // 现行标准仅认可 (L,N) = (2048,224)/(2048,256)/(3072,256)；(1024,160) 及以下已废止
    // （NIST SP 800-131A Rev.2 disallow），本工具不提供废止参数生成，历史题请手填参数。
    const LN = String((p && p.ln) || "2048/256");
    const [L, N] = LN.split("/").map((x) => Number(x.trim()));
    if (![ [2048,224],[2048,256],[3072,256] ].some(([a, b]) => a === L && b === N)) {
      throw new Error("FIPS 186-5 仅认可参数组 2048/224、2048/256、3072/256（1024 及以下已废止，不提供生成）");
    }
    const Q = generatePrime(N);
    // p = k·q + 1，k 自 ceil(2^(L-1)/q) 起向上搜素数（保证 p 恰为 L 位）
    let k = (1n << BigInt(L - 1)) / Q + 1n;
    let P = 0n;
    for (;;) {
      P = k * Q + 1n;
      if (P.toString(2).length > L) throw new Error("L 位范围内未搜到素数 p，请重试（概率性，属正常）");
      if (isProbablePrime(P)) break;
      k++;
    }
    // g = h^((p-1)/q) mod p，h 自 2 起取首个 g>1（FIPS 186-5 §A.2.1）
    const e = (P - 1n) / Q;
    let G = 1n;
    for (let h = 2n; h < P - 1n; h++) {
      G = powMod(h, e, P);
      if (G > 1n) break;
    }
    if (G <= 1n) throw new Error("未找到阶为 q 的生成元 g（异常）");
    const X = randomK(Q); // ∈ [1, q-1]
    const Y = powMod(G, X, P);
    // T362 产物协议（2026-09-02）：公钥（p/q/g/y）/ 私钥（p/q/x）分开交付下载按钮（十进制文本，
    // 可直接粘回参数框）。
    return {
      text: [
        `DSA 参数组 + 密钥对（FIPS 186-5，L=${L}, N=${N}）`,
        `p(${P.toString(2).length} 位素数) = ${P}`,
        `q(${Q.toString(2).length} 位素数) = ${Q}`,
        `g（阶 q 的生成元） = ${G}`,
        `私钥 x = ${X}`,
        `公钥 y = ${Y}`,
        "提示：把 p/q/g 填入「签名」档（私钥 x）出题、「验签」档（公钥 y）解题",
        "注：大素数 p 纯 JS 搜索需数秒到数十秒；1024 位及以下已被 FIPS 186-5 废止，仅支持手填验证",
        "",
        "公钥 / 私钥已分开生成：私钥 ⚠ 敏感请妥善保管。点击下方按钮下载。",
      ].join("\n"),
      files: [
        { name: `dsa_pub_${L}_${N}.txt`, mime: "text/plain",
          bytes: new TextEncoder().encode(`p = ${P}\nq = ${Q}\ng = ${G}\ny = ${Y}\n`) },
        { name: `dsa_priv_${L}_${N}.txt`, mime: "text/plain",
          bytes: new TextEncoder().encode(`p = ${P}\nq = ${Q}\nx = ${X}\n`) },
      ],
    };
  },
});

// ---- 档② 签名 ----
register({
  id: "dsaSign",
  cat: "asym",
  family: "dsa",
  familyLabel: "sign",
  name: "DSA 签名",
  desc: "DSA 数字签名（FIPS 186-4 §4）：r=(g^k mod p) mod q，s=k⁻¹(z+x·r) mod q，k ∈ [1,q-1] 每消息唯一。hash 支持直接整数 H(m)（CTF 常态）或 SHA-1(消息文本)。输出含自检验签",
  params: [
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
    { key: "x", label: "私钥 x", type: "text", default: DEMO.x, placeholder: "x∈[1,q-1]（demo:24）" },
    { key: "k", label: "指定 k（可选）", type: "text", default: "", placeholder: "留空随机；教学可填如 15" },
  ],
  run: (text, p) => {
    const hashMode = (p && p.hashMode) || "int";
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

    const lines = [];
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
  },
});

// ---- 档③ 验签 ----
register({
  id: "dsaVerify",
  cat: "asym",
  family: "dsa",
  familyLabel: "verify",
  name: "DSA 验签",
  desc: "DSA 验签（FIPS 186-4 §4）：0<r,s<q，w=s⁻¹ mod q，v=((g^u1·y^u2) mod p) mod q，通过 ⟺ v==r。hash 支持直接整数 H(m) 或 SHA-1(消息文本)",
  params: [
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
    { key: "y", label: "公钥 y", type: "text", default: "", placeholder: "y=g^x mod p" },
    { key: "r", label: "r", type: "text", default: "", placeholder: "签名 r" },
    { key: "s", label: "s", type: "text", default: "", placeholder: "签名 s" },
  ],
  run: (text, p) => {
    const hashMode = (p && p.hashMode) || "int";
    const P = parseBig((p && p.p) || DEMO.p, "p");
    const Q = parseBig((p && p.q) || DEMO.q, "q");
    const G = parseBig((p && p.g) || DEMO.g, "g");
    const Y = parseBig((p && p.y), "y（公钥）");
    const R = parseBig((p && p.r), "r");
    const S = parseBig((p && p.s), "s");
    const msgRaw = (text && String(text).trim()) ? text : DEMO.z;
    const z = computeZ(msgRaw, Q, hashMode);

    const res = dsaVerify(z, R, S, P, Q, G, Y);
    const lines = [];
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
  },
});

// ---- 档④ 重用 k 攻击 ----
register({
  id: "dsaReuseK",
  cat: "asym",
  family: "dsa",
  familyLabel: "attack",
  name: "DSA 重用 k 攻击",
  desc: "DSA nonce 重用攻击（CTF 高频）：两条签名用同一 k（表现为 r1==r2）时，k=(z1-z2)(s1-s2)⁻¹ mod q，x=(s1·k-z1)·r⁻¹ mod q。hash 支持直接整数 H(m) 或 SHA-1(消息文本)。可选填 p/g/y 反向校验",
  params: [
    {
      key: "hashMode", label: "消息 hash 方式", type: "select", default: "int",
      options: [
        { value: "int", label: "直接整数 H(m)（CTF 常态）" },
        { value: "sha1", label: "SHA-1(消息文本)" },
      ],
    },
    { key: "q", label: "素数 q", type: "text", default: DEMO.q, placeholder: "N 位素数（demo:47）" },
    { key: "r", label: "r（两签名公共 r）", type: "text", default: "", placeholder: "签名 r（r1==r2）" },
    { key: "s1", label: "s1", type: "text", default: "", placeholder: "签名1 的 s" },
    { key: "s2", label: "s2", type: "text", default: "", placeholder: "签名2 的 s" },
    { key: "z1", label: "z1 消息1 hash", type: "text", default: "", placeholder: "整数或原文（依 hash 方式）" },
    { key: "z2", label: "z2 消息2 hash", type: "text", default: "", placeholder: "整数或原文（依 hash 方式）" },
    { key: "p", label: "素数 p（可选校验）", type: "text", default: "", placeholder: "填 p/g/y 可校验 g^x mod p == y" },
    { key: "g", label: "生成元 g（可选校验）", type: "text", default: "", placeholder: "同上" },
    { key: "y", label: "公钥 y（可选校验）", type: "text", default: "", placeholder: "同上" },
  ],
  run: (_text, p) => {
    const hashMode = (p && p.hashMode) || "int";
    const Q = parseBig((p && p.q) || DEMO.q, "q");
    const R = parseBig((p && p.r), "r（两签名公共 r）");
    const S1 = parseBig((p && p.s1), "s1");
    const S2 = parseBig((p && p.s2), "s2");
    // z1/z2：按 hashMode 从 z1/z2 参数取（整数或对文本 sha1）
    const z1 = computeZ((p && p.z1), Q, hashMode);
    const z2 = computeZ((p && p.z2), Q, hashMode);

    const { k, x } = attackReuseK(z1, S1, z2, S2, R, Q);

    const lines = [];
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
  },
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
  DEMO,
};
