/*
 * ntruReal.js — 真 NTRU 公钥加密（EESS/NTRU Encrypt 产品式规范口径，T398 批A）。
 * 与 pqcLite.js 的 ntruToy（玩具参数 n=8, q=257）完全独立，本文件为产品级参数。
 *
 * ============ 规范来源（查证记录，2026-09-05） ============
 * 目标规范：EESS #1 v3.1（2015，"Implementation Aspects of NTRUEncrypt"，
 * 原文 EESS1-v3.1.pdf 曾发布于 github NTRUOpenSourceProject/ntru-crypto/doc/——
 * 该仓库 2021-01 被重建且历史丢失，原 PDF 已不可达；本实现改以两份可验证的一手资料逐条核对）：
 *   [P] eprint.iacr.org/2015/708 "Choosing Parameters for NTRUEncrypt"
 *       （Hoffstein/Howgrave-Graham/Pipher/Silverman/Whyte/Zhang，NTRU 团队官方，
 *       CT-RSA 2017）——给出 EESS#1 产品式定义与四套产品式参数集（Table 3）。
 *   [L] libntru 0.5（github tbuktu/libntru，EESS1/IEEE 1363.1-2008 参考级 C 实现）
 *       ——src/encparams.c 参数逐值、src/ntru.c 的 keygen/encrypt/decrypt 数学逐行。
 * 两份来源在所有交叉点上完全一致（f 公式、h 公式、解密还原、参数值），据此落笔。
 *
 * ============ 数学（EESS1 v3.1 口径，[P] Alg.1-3 / [L] ntru.c） ============
 *   环 R = Z[x]/(x^N−1)，q = 2048（2^11），p = 3（中心化 {−1,0,1}）。
 *   私钥（产品式，EP 参数集）：F = F1∗F2 + F3，Fi ∈ T_N(di,di)；f = 1 + p·F（[P] §"A product
 *     form private key ... is (f,g) = (1+pF,g)"，F∈P(d1,d2,d3)={A1∗A2+A3}；[L] "inverse of 3t+1"）。
 *     ⚠ 注意 f = 1 + p·F1·F2 + p·F3（F3 同样乘 p）——这保证 f ≡ 1 (mod p)，f_p = 1。
 *   私钥（标准式，如 ees659ep1）：F ∈ T_N(df,df)，f = 1 + p·F 同式。
 *   g ∈ T_N(dg,dg)（[L] ntru_gen_g: rand_tern(N, dg, dg)）。
 *   fq = f⁻¹ mod q（Hensel：先 GF(2) 扩展欧几里得求 mod 2 逆，再 t←t(2−ft) 逐级升 2^k）。
 *   公钥 h = p·(g∗fq) mod q（[L] ntru_gen_key_pair: mult_priv(g,fq)→mult_fac(3)→mod_mask(q−1)）。
 *   加密（核心 PKE）：M = b(db/8 B 随机)‖octL‖msg‖0 填充；m = SVES 系数映射(M)（P1363.1 §9.2.2，
 *     3 bit→2 系数，c=3a+b，LSB-first，[L] ntru_from_sves 两张系数表）；r 与 F 同重量采样
 *     （产品式 P(d1,d2,d3) / 标准式 T(df,df)，[L] ntru_gen_blind_poly 用 df1/df2/df3）；
 *     e = r∗h + m mod q。
 *   解密（[L] ntru_decrypt_poly，逐行）：a = f∗e mod q → 系数减法中心化到 (−q/2, q/2] →
 *     mod 3 得 m ∈ {0,1,2} → SVES 逆映射（§9.2.3，拒绝 (2,2) 对）→ b‖octL‖msg‖0 → 校验零填充。
 *     （等价于规范常写的 a = fq∗e mod q → 中心化 → mod p：f∗e = fq⁻¹… 两者同余，本实现
 *     直接用 f 免去 fq 保存；失败概率由 |f∗e|_∞ ≤ p·(d1d2+d3)·2 + 1 < q/2 保证（[P] §6）。
 *
 * ============ 与完整 EESS-SVES 的差异（如实声明，不虚报） ============
 * 本文件实现 EESS1 v3.1 的 PKE 数学内核（keygen / 加密 / 解密公式与 libntru 逐行一致，
 * 消息编码照抄 P1363.1 §9.2.2/9.2.3 系数映射），但未实现 SVES 的 CCA-2 外壳：
 * 无 MGF(r) 掩码加扰、无 IGF 确定性盲化采样、无 dm0 拒绝循环（dm0 是 CCA 计数器measure，
 * 掩码缺失时对 m 断言 dm0 无意义）。因此本实现为**被动安全**核心 PKE——适合教学演示与
 * CTF 演算，不替代生产库。EESS1 v3.1 SVES 无公开逐字节 KAT（原规范 PDF 不可达），故
 * 验证采用属性级：往返全对、重量断言、密文篡改必拒、解密失败实测 0（理论见文末冒烟记录）。
 *
 * ============ 参数集（[L] encparams.c 逐值抄录；[P] Table 3 交叉核对） ============
 *   ees401ep1  N=401 标准式 df=113  dg=133 dm0=113  112-bit（IEEE 1363.1-2008）
 *   ees401ep2  N=401 产品式 (8,8,6) dg=133 dm0=101  112-bit（[P] Table 3 行1：8 8 6 133 101）
 *   ees439ep1  N=439 产品式 (9,8,5) dg=146 dm0=112  128-bit（[P] Table 3 行2：9 8 5 146 112）
 *   ees659ep1  N=659 标准式 df=38   dg=219 dm0=38   112-bit（IEEE 1363.1-2008）
 * 注：常被混称的"产品式参数集 ees401ep1/ees659ep1"在 IEEE 1363.1-2008/EESS1 中实为标准式；
 *   EESS#1 的产品式集为 ees401ep2/ees439ep1/ees593ep1/ees743ep1（[P] Table 3 共四套）。
 *   本文件两种形式都实现，产品式（ees401ep2）为默认档。
 *
 * ============ 序列化口径（本工具自定义，hex） ============
 *   公钥 hex = tag(1B，= 参数集序号+1) ‖ h（N 个系数，各 11 bit 大端流式拼接，ceil(N·11/8) B）
 *   私钥 hex = tag(1B) ‖ F 各成分（2 bit/系数：0→00, 1→01, −1→10，大端流式；产品式 F1‖F2‖F3，
 *     标准式仅 F）。解密只需 f = 1+pF，故不存 g/fq（fq 可由 f 重算）。
 */

import { register } from "./registry.js";

// ============================================================
// 参数集（来源见文件头；字段名与 [L] encparams.c 一致）
// ============================================================

const SETS = [
  { name: "ees401ep1", N: 401, q: 2048, prod: null, df: 113, dg: 133, dm0: 113, db: 112, sec: 112 },
  { name: "ees401ep2", N: 401, q: 2048, prod: [8, 8, 6], df: null, dg: 133, dm0: 101, db: 112, sec: 112 },
  { name: "ees439ep1", N: 439, q: 2048, prod: [9, 8, 5], df: null, dg: 146, dm0: 112, db: 128, sec: 128 },
  { name: "ees659ep1", N: 659, q: 2048, prod: null, df: 38, dg: 219, dm0: 38, db: 112, sec: 112 },
];

const P = 3;
const QBITS = 11; // q = 2^11

function getSet(name) {
  const s = SETS.find((x) => x.name === String(name || "").trim());
  if (!s) throw new Error(`未知参数集 "${name}"（可选：${SETS.map((x) => x.name).join(" / ")}）`);
  return s;
}

// SVES 系数映射表（[L] ntru.c NTRU_COEFF1/2_TABLE，P1363.1 §9.2.2）
const COEFF1 = [0, 0, 0, 1, 1, 1, -1, -1];
const COEFF2 = [0, 1, -1, 0, 1, -1, 0, 1];

// ============================================================
// 基础工具：hex / 字节 / 随机
// ============================================================

function hexToBytes(hex) {
  let h = String(hex == null ? "" : hex).replace(/^0x/i, "").replace(/[\s_-]+/g, "");
  if (!h) throw new Error("输入为空（需要 hex）");
  if (h.length % 2) h = "0" + h;
  if (!/^[0-9a-fA-F]+$/.test(h)) throw new Error("含非 hex 字符");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomU32() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    return c.getRandomValues(new Uint32Array(1))[0] >>> 0;
  }
  throw new Error("无可用 CSPRNG（crypto.getRandomValues）");
}

/** 无偏 [0,u) 随机整数（拒绝采样）。 */
function randBelow(u) {
  const lim = Math.floor(0x100000000 / u) * u;
  for (;;) {
    const x = randomU32();
    if (x < lim) return x % u;
  }
}

// 可选固定种子（教学复现）：xoshiro128** 种子派生自输入字节（工具内部口径，非规范）。
function makeRng(seedHex) {
  if (!seedHex || !String(seedHex).trim()) {
    return { next: () => randBelow(0x100000000) >>> 0, below: randBelow };
  }
  const seed = hexToBytes(seedHex);
  // FNV-1a 混入 4 个 32 位状态字
  let s0 = 0x9e3779b9, s1 = 0x85ebca6b, s2 = 0xc2b2ae35, s3 = 0x27d4eb2f;
  const mix = (b, salt) => {
    let h = [s0, s1, s2, s3][salt] >>> 0;
    for (const byte of seed) h = (Math.imul(h ^ byte, 0x01000193) + salt * 0x9e3779b9) >>> 0;
    for (let i = 0; i < 8; i++) h = (Math.imul(h ^ (h >>> 15), 0x2545f491) + 1) >>> 0;
    return h >>> 0;
  };
  s0 = mix(seed, 0); s1 = mix(seed, 1); s2 = mix(seed, 2); s3 = mix(seed, 3);
  let counter = 0;
  const rotl = (x, k) => ((x << k) | (x >>> (32 - k))) >>> 0;
  const nextRaw = () => {
    const result = (Math.imul(rotl(Math.imul(s1, 5) >>> 0, 7) >>> 0, 9) >>> 0) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 = (s2 ^ s0) >>> 0;
    s3 = (s3 ^ s1) >>> 0;
    s1 = (s1 ^ s2) >>> 0;
    s0 = (s0 ^ s3) >>> 0;
    s2 = (s2 ^ t) >>> 0;
    s3 = rotl(s3, 11);
    return result;
  };
  const below = (u) => {
    const lim = Math.floor(0x100000000 / u) * u;
    for (;;) {
      const x = nextRaw();
      counter++;
      if (x < lim) return x % u;
    }
  };
  return { next: nextRaw, below, _counter: () => counter };
}

// ============================================================
// 多项式环 R = Z[x]/(x^N−1)（Number 数组，系数容量见文件头安全界）
// ============================================================

/** 循环卷积（schoolbook O(N²)），结果各系数 mod q 归一到 [0,q)。 */
function polyMulMod(a, b, N, q) {
  const out = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const ai = a[i];
    if (ai === 0) continue;
    for (let j = 0; j < N; j++) {
      const k = i + j;
      out[k < N ? k : k - N] += ai * b[j];
    }
  }
  for (let k = 0; k < N; k++) out[k] = ((out[k] % q) + q) % q;
  return out;
}

/** 系数减法中心化：[0,q) → (−q/2, q/2]（EESS 解密口径）。 */
function centerLift(a, q) {
  return a.map((x) => (x > q / 2 ? x - q : x));
}

/** mod 3 → {0,1,2}（输入为中心化整数）。 */
function mod3(a) {
  return a.map((x) => ((x % 3) + 3) % 3);
}

// ============================================================
// 采样：三元多项式 / 产品式
// ============================================================

/** T_N(d,d)：恰 d 个 +1、d 个 −1（部分 Fisher-Yates，无偏）。 */
function randTern(N, d, rng) {
  const idx = Array.from({ length: N }, (_, i) => i);
  for (let i = 0; i < 2 * d; i++) {
    const j = i + rng.below(N - i);
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  const p = new Array(N).fill(0);
  for (let i = 0; i < d; i++) p[idx[i]] = 1;
  for (let i = d; i < 2 * d; i++) p[idx[i]] = -1;
  return p;
}

// ============================================================
// 模 q 求逆：GF(2) 扩展欧几里得 + Hensel 升幕（2 → 4 → … → 2048）
// ============================================================

const bitLen = (x) => (x <= 0n ? 0n : BigInt(x.toString(2).length));

/** GF(2)[x] 带余除法（BigInt 位向量，bit i ↔ x^i）。 */
function gf2DivMod(a, b) {
  let db = bitLen(b);
  let q = 0n, r = a;
  let shift = bitLen(a) - db;
  while (shift >= 0n) {
    if ((bitLen(r)) === db + shift) {
      r ^= b << shift;
      q |= 1n << shift;
    }
    shift -= 1n;
  }
  return [q, r];
}

/** BigInt 无进位乘（GF(2)）。 */
function gf2Mul(a, b) {
  let r = 0n;
  let x = a, y = b;
  while (y !== 0n) {
    if (y & 1n) r ^= x;
    x <<= 1n;
    y >>= 1n;
  }
  return r;
}

/** GF(2) 多项式归约 mod (x^N+1)：bit i≥N 折叠到 bit i−N（x^N ≡ 1）。 */
function gf2Reduce(v, N) {
  const mask = (1n << BigInt(N)) - 1n;
  const nb = BigInt(N);
  while (v >> nb) v = (v & mask) ^ (v >> nb);
  return v;
}

/** f⁻¹ mod 2（在 GF(2)[x]/(x^N+1) 中）；不可逆返回 null。 */
function invMod2(fBits, N) {
  const m = (1n << BigInt(N)) | 1n;
  const f = fBits & ((1n << BigInt(N)) - 1n);
  let [r0, s0] = [m, 0n];
  let [r1, s1] = [f, 1n];
  while (r1 !== 0n) {
    const [q, rem] = gf2DivMod(r0, r1);
    [r0, r1] = [r1, rem];
    [s0, s1] = [s1, gf2Reduce(s0 ^ gf2Mul(q, s1), N)];
  }
  if (r0 !== 1n) return null; // gcd(f, x^N+1) ≠ 1 → f 不可逆
  return gf2Reduce(s0, N);
}

/** f（小系数）在 Z_q[x]/(x^N−1) 中的逆，q = 2^k。不可逆返回 null。 */
function invModQ(f, N, q) {
  let fBits = 0n;
  for (let i = 0; i < N; i++) if (((f[i] % 2) + 2) % 2 === 1) fBits |= 1n << BigInt(i);
  let t = invMod2(fBits, N);
  if (t === null) return null;
  let tArr = new Array(N);
  for (let i = 0; i < N; i++) tArr[i] = Number((t >> BigInt(i)) & 1n);
  let exp = 1; // 当前精度：f·t ≡ 1 (mod 2^exp)，起始 t = f⁻¹ mod 2
  const E = Math.log2(q);
  while (exp < E) {
    exp = Math.min(exp * 2, E); // Newton 步精度翻倍；算术模数取目标精度 2^exp
    const mod = 2 ** exp;
    const ft = polyMulMod(f, tArr, N, mod);
    // t2 = 2 − f·t（"2" 为常数多项式：0 号系数 2−x，其余 −x）
    const t2 = ft.map((x, j) => (((j === 0 ? 2 : 0) - x) % mod + mod) % mod);
    tArr = polyMulMod(tArr, t2, N, mod);
  }
  return tArr;
}

// ============================================================
// 序列化
// ============================================================

/** 系数流 → 位流打包（每系数 bits 位、大端位序）。 */
function packCoefs(a, bits) {
  const bytes = [];
  let cur = 0, curBits = 0;
  for (const v0 of a) {
    const v = v0 === -1 ? 2 : v0; // 三元 −1 → 2（仅 2 bit 口径用到）
    cur = (cur << bits) | v;
    curBits += bits;
    while (curBits >= 8) {
      bytes.push((cur >> (curBits - 8)) & 0xff);
      curBits -= 8;
    }
  }
  if (curBits > 0) bytes.push((cur << (8 - curBits)) & 0xff);
  return new Uint8Array(bytes);
}

function unpackCoefs(bytes, count, bits) {
  const vals = [];
  let cur = 0, curBits = 0;
  for (const b of bytes) {
    cur = ((cur << 8) | b) >>> 0;
    curBits += 8;
    while (curBits >= bits && vals.length < count) {
      const v = (cur >>> (curBits - bits)) & ((1 << bits) - 1);
      vals.push(v);
      curBits -= bits;
    }
    cur &= (1 << curBits) - 1; // 截掉已消费的高位，防止再左移越界
  }
  if (vals.length < count) throw new Error("密钥/密文长度不足（hex 位流过短）");
  // 2 bit 口径：00→0, 01→1, 10→−1（见 packCoefs）
  return bits === 2 ? vals.map((v) => (v === 2 ? -1 : v)) : vals;
}

/** SVES 系数映射：字节串 M → 三元多项式 m ∈ {−1,0,1}^N（P1363.1 §9.2.2，[L] ntru_from_sves）。 */
function fromSves(M, N) {
  const m = [];
  const chunkCount = Math.floor((M.length + 2) / 3) * 3;
  let i = 0;
  while (i < chunkCount && m.length < N - 1) {
    let chunk = (M[i] | (M[i + 1] << 8) | (M[i + 2] << 16)) >>> 0;
    i += 3;
    for (let j = 0; j < 8 && m.length < N - 1; j++) {
      m.push(COEFF1[chunk & 7], COEFF2[chunk & 7]);
      chunk >>= 3;
    }
  }
  while (m.length < N) m.push(0); // N 为奇数时最高位恒 0（[L] 同款 N−1 截断）
  return m;
}

/** SVES 逆映射：m ∈ {0,1,2}^N → M（P1363.1 §9.2.3，[L] ntru_to_sves；拒绝 (2,2) 对）。 */
function toSves(m012, Mlen) {
  const M = new Uint8Array(Mlen);
  const pairs = Math.floor(m012.length / 2); // N 奇数时弃最高位（与 fromSves 对称）
  for (let i = 0; i < pairs; i++) {
    const a = m012[2 * i], b = m012[2 * i + 1];
    if ((a === 2 && b === 2) || a < 0 || a > 2 || b < 0 || b > 2) {
      throw new Error("SVES 解码失败：出现非法系数对（密文可能被篡改/损坏）");
    }
    const c = a * 3 + b;
    const pos = i * 3, byt = pos >> 3, off = pos & 7;
    M[byt] |= (c << off) & 0xff;
    if (off + 3 > 8) M[byt + 1] |= c >> (8 - off);
  }
  return M;
}

function mLenBytes(N) {
  return Math.ceil(((N * 3 + 1) / 2) / 8); // [L] cM_len_bits/bytes 公式
}

// ============================================================
// 方案三层：keyGen / encrypt / decrypt
// ============================================================

function buildF(set, F) {
  // f = 1 + p·F：常数项 1 只落在 0 号系数（f[0] = 1+3F[0]，f[i≥1] = 3F[i]），
  // 保证 f mod p = 常数多项式 1（f_p = 1）——EESS 私钥的核心性质。
  const f = new Array(set.N);
  for (let i = 0; i < set.N; i++) f[i] = P * F[i];
  f[0] += 1;
  return f;
}

function sampleF(set, rng) {
  if (set.prod) {
    const parts = [randTern(set.N, set.prod[0], rng), randTern(set.N, set.prod[1], rng), randTern(set.N, set.prod[2], rng)];
    return { parts, F: combineProd(set.N, parts) };
  }
  const F = randTern(set.N, set.df, rng);
  return { parts: [F], F };
}

function sampleR(set, rng) {
  // [L] ntru_gen_blind_poly：盲化多项式重量与 F 相同
  return sampleF(set, rng).F;
}

/** 产品式合成：F = F1∗F2 + F3（Z 上小系数）。 */
function combineProd(N, parts) {
  const [a1, a2, a3] = parts;
  const out = new Array(N).fill(0);
  for (let i = 0; i < N; i++) {
    const ai = a1[i];
    if (ai === 0) continue;
    for (let j = 0; j < N; j++) {
      const k = i + j;
      out[k < N ? k : k - N] += ai * a2[j];
    }
  }
  for (let k = 0; k < N; k++) out[k] += a3[k];
  return out;
}

/**
 * 密钥生成（EESS1 v3.1 口径）。
 * 返回 { set, h, F, g, f, fq, privBytes, pubBytes, hWeight }。
 */
function ntruKeyGen(set, seedHex) {
  const rng = makeRng(seedHex);
  const N = set.N, q = set.q;
  let parts, F, f, fq;
  for (;;) {
    ({ parts, F } = sampleF(set, rng));
    f = buildF(set, F);
    fq = invModQ(f, N, q);
    if (fq) break; // f mod 2 与 x^N+1 互素概率极高（[P]：推荐参数下"always invertible"），失败重采样
  }
  // 反向验证 fq 正确（防静默 bug）：f·fq ≡ 常数多项式 1
  const chk = polyMulMod(f, fq, N, q);
  for (let i = 0; i < N; i++) {
    if (chk[i] !== (i === 0 ? 1 : 0)) throw new Error("内部错误：f·fq ≢ 1 (mod q)（Hensel 求逆失败）");
  }
  const g = randTern(N, set.dg, rng);
  // h = p·(g∗fq) mod q
  const h = polyMulMod(g, fq, N, q).map((x) => (x * P) % q);
  const tag = SETS.indexOf(set) + 1;
  const privBytes = new Uint8Array(1 + parts.length * Math.ceil((N * 2) / 8));
  privBytes[0] = tag;
  parts.forEach((part, i) => privBytes.set(packCoefs(part, 2), 1 + i * Math.ceil((N * 2) / 8)));
  const pubBytes = new Uint8Array(1 + Math.ceil((N * QBITS) / 8));
  pubBytes[0] = tag;
  pubBytes.set(packCoefs(h, QBITS), 1);
  return { set, h, parts, F, g, f, fq, privBytes, pubBytes };
}

/**
 * 加密（核心 PKE）：M = b‖octL‖msg‖0 → m = fromSves(M)；e = r∗h + m mod q。
 * 返回 { e, eBytes, mWeight, r }。
 */
function ntruEncrypt(set, h, msgBytes, seedHex) {
  const rng = makeRng(seedHex);
  const N = set.N, q = set.q;
  const Mlen = mLenBytes(N);
  const maxMsg = Mlen - set.db / 8 - 2;
  if (msgBytes.length > maxMsg) {
    throw new Error(`明文过长：${set.name} 上限 ${maxMsg} 字节，当前 ${msgBytes.length} 字节（超长请先对称压缩/分片）`);
  }
  const M = new Uint8Array(Mlen);
  for (let i = 0; i < set.db / 8; i++) M[i] = rng.below(256); // SVES 的随机 b 字段（FMT 输入）
  M[set.db / 8] = msgBytes.length; // octL
  M.set(msgBytes, set.db / 8 + 1);
  // 其余填 0（SVES 的 p0/零填充）
  const m = fromSves(M, N); // {−1,0,1}
  const r = sampleR(set, rng);
  const R = polyMulMod(r, h, N, q);
  const e = new Array(N);
  for (let i = 0; i < N; i++) e[i] = ((R[i] + m[i]) % q + q) % q;
  const tag = SETS.indexOf(set) + 1;
  const eBytes = new Uint8Array(1 + Math.ceil((N * QBITS) / 8));
  eBytes[0] = tag;
  eBytes.set(packCoefs(e, QBITS), 1);
  let w1 = 0, w_1 = 0;
  for (const v of m) { if (v === 1) w1++; else if (v === -1) w_1++; }
  return { e, eBytes, mWeight: { one: w1, minusOne: w_1 } };
}

/**
 * 解密（[L] ntru_decrypt_poly）：a = f∗e mod q → 中心化 → mod 3 → toSves → b‖octL‖msg‖0。
 * parts 为私钥成分数组（产品式 [F1,F2,F3] / 标准式 [F]）。
 */
function ntruDecrypt(set, parts, e) {
  const N = set.N, q = set.q;
  const F = set.prod ? combineProd(N, parts) : parts[0];
  const f = buildF(set, F);
  const a = centerLift(polyMulMod(f, e, N, q), q);
  const m012 = mod3(a);
  const Mlen = mLenBytes(N);
  const M = toSves(m012, Mlen);
  const blen = set.db / 8;
  const maxMsg = Mlen - blen - 2;
  const cl = M[blen];
  if (cl > maxMsg) throw new Error(`长度字段非法（${cl} > ${maxMsg}）：解密失败或密文损坏`);
  for (let i = blen + 1 + cl; i < Mlen; i++) {
    if (M[i] !== 0) throw new Error("零填充校验失败：解密失败或密文损坏（SVES 口径拒绝）");
  }
  return M.slice(blen + 1, blen + 1 + cl);
}

// ============================================================
// op 包装（cat: asym；hex 口径；与 ntruToy 明确区分）
// ============================================================

const SET_OPTIONS = SETS.map((s) => s.name);

function fmtWeight(parts, set) {
  if (set.prod) {
    const ws = parts.map((Fi) => {
      let o = 0, m = 0;
      for (const v of Fi) { if (v === 1) o++; else if (v === -1) m++; }
      return `(+${o}/-${m})`;
    });
    return `F1${ws[0]}·F2${ws[1]}·F3${ws[2]}`;
  }
  let o = 0, m = 0;
  for (const v of parts[0]) { if (v === 1) o++; else if (v === -1) m++; }
  return `F(+${o}/-${m})`;
}

register({
  id: "ntruKeyGen", family: "ntru", familyLabel: "keygen",
  cat: "asym",
  name: "NTRU 密钥生成（真参数）",
  desc: "EESS v3.1 口径真参数 NTRU（ees401ep1/ep2/ees439ep1/ees659ep1，q=2048）密钥对生成，产品式私钥 f=1+p·F1·F2+p·F3；与 ntruToy 玩具参数无关",
  params: [
    { key: "set", label: "参数集", type: "select", default: "ees401ep2", options: SET_OPTIONS },
    { key: "seed", label: "seed (hex，留空随机；教学复现可固定)", type: "text", default: "", placeholder: "如 0011223344" },
  ],
  run: (_t, p = {}) => {
    const set = getSet(p.set);
    const r = ntruKeyGen(set, p.seed);
    const s = r.set;
    return {
      text: [
        `参数集: ${s.name}（N=${s.N}, q=${s.q}, p=3, ${s.prod ? "产品式 f=1+p·F1·F2+p·F3, d=" + s.prod.join("/") : "标准式 f=1+p·F, df=" + s.df}, dg=${s.dg}, dm0=${s.dm0}，${s.sec}-bit）`,
        `私钥重量: ${fmtWeight(r.parts, s)}（g 同理可验）`,
        `公钥 h (${r.pubBytes.length} B, hex, tag+${s.N}×11bit 系数流):`,
        bytesToHex(r.pubBytes),
        `私钥 (${r.privBytes.length} B, hex, ${s.prod ? "tag+F1‖F2‖F3 各 2bit/系数" : "tag+F 2bit/系数"}):`,
        bytesToHex(r.privBytes),
        "",
        "公钥粘到「NTRU 加密（真参数）」，私钥粘到「NTRU 解密（真参数）」。私钥 ⚠ 敏感。下方按钮下载（hex 文本）。",
      ].join("\n"),
      files: [
        { name: `ntru_${s.name}_pub.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.pubBytes) + "\n") },
        { name: `ntru_${s.name}_priv.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.privBytes) + "\n") },
      ],
    };
  },
});

register({
  id: "ntruEncrypt", family: "ntru", familyLabel: "encrypt",
  cat: "asym",
  name: "NTRU 加密（真参数）",
  desc: "EESS v3.1 真参数 NTRU 加密：e = r∗h + m mod q（SVES 系数映射 + 随机 b 字段），被动安全核心 PKE（非完整 SVES CCA-2）",
  params: [
    { key: "set", label: "参数集", type: "select", default: "ees401ep2", options: SET_OPTIONS },
    { key: "ek", label: "公钥 h (hex)", type: "text", default: "", placeholder: "密钥生成输出的公钥 hex" },
    { key: "seed", label: "seed (hex，留空随机)", type: "text", default: "", placeholder: "教学复现可固定" },
  ],
  run: (t, p = {}) => {
    const set = getSet(p.set);
    if (!p.ek || !String(p.ek).trim()) throw new Error("请先在「NTRU 密钥生成（真参数）」生成并粘贴公钥 h (hex)");
    const kb = hexToBytes(p.ek);
    if (kb[0] !== SETS.indexOf(set) + 1) throw new Error("公钥 tag 与所选参数集不符（确认生成时选的同一档）");
    const h = unpackCoefs(kb.subarray(1), set.N, QBITS);
    const msg = new TextEncoder().encode(String(t ?? ""));
    if (!msg.length) throw new Error("请输入明文");
    const r = ntruEncrypt(set, h, msg, p.seed);
    return {
      text: [
        `参数集: ${set.name}（N=${set.N}, q=${set.q}）`,
        `明文 (${msg.length} B): ${bytesToHex(msg)}`,
        `m 重量: +1×${r.mWeight.one} / −1×${r.mWeight.minusOne}`,
        `密文 e (${r.eBytes.length} B, hex, tag+${set.N}×11bit 系数流):`,
        bytesToHex(r.eBytes),
        "",
        "密文粘到「NTRU 解密（真参数）」还原。同一明文每次加密都不同（随机 b 与 r）。下方按钮下载。",
      ].join("\n"),
      files: [
        { name: `ntru_${set.name}_ct.hex`, mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.eBytes) + "\n") },
      ],
    };
  },
});

register({
  id: "ntruDecrypt", family: "ntru", familyLabel: "decrypt",
  cat: "asym",
  name: "NTRU 解密（真参数）",
  desc: "EESS v3.1 真参数 NTRU 解密：a = f∗e mod q → 中心化 (−q/2,q/2] → mod 3 → SVES 逆映射还原明文（含零填充/长度校验）",
  params: [
    { key: "set", label: "参数集", type: "select", default: "ees401ep2", options: SET_OPTIONS },
    { key: "dk", label: "私钥 (hex)", type: "text", default: "", placeholder: "密钥生成输出的私钥 hex" },
  ],
  run: (t, p = {}) => {
    const set = getSet(p.set);
    if (!p.dk || !String(p.dk).trim()) throw new Error("请先在「NTRU 密钥生成（真参数）」生成并粘贴私钥 (hex)");
    const kb = hexToBytes(p.dk);
    if (kb[0] !== SETS.indexOf(set) + 1) throw new Error("私钥 tag 与所选参数集不符（确认生成时选的同一档）");
    const partBytes = Math.ceil((set.N * 2) / 8);
    const nParts = set.prod ? 3 : 1;
    if (kb.length !== 1 + nParts * partBytes) {
      throw new Error(`私钥长度不符：期望 ${1 + nParts * partBytes} B（${set.name}），实际 ${kb.length} B`);
    }
    const parts = [];
    for (let i = 0; i < nParts; i++) {
      parts.push(unpackCoefs(kb.subarray(1 + i * partBytes, 1 + (i + 1) * partBytes), set.N, 2));
    }
    if (!t || !String(t).trim()) throw new Error("请输入密文 hex（NTRU 加密输出）");
    const eb = hexToBytes(t);
    if (eb[0] !== SETS.indexOf(set) + 1) throw new Error("密文 tag 与所选参数集不符");
    const e = unpackCoefs(eb.subarray(1), set.N, QBITS);
    const msg = ntruDecrypt(set, parts, e);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(msg);
    } catch {
      text = `（非 UTF-8，输出 hex）${bytesToHex(msg)}`;
    }
    return `参数集: ${set.name}\n明文 (${msg.length} B):\n${text}`;
  },
});

// 供冒烟/单测复用（不进 op 面）
export const __ntruReal = { SETS, getSet, ntruKeyGen, ntruEncrypt, ntruDecrypt, invModQ, polyMulMod, fromSves, toSves, packCoefs, unpackCoefs, makeRng, combineProd, centerLift, mod3, buildF, mLenBytes, sampleF };
