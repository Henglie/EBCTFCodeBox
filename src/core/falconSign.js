/*
 * falconSign.js — Falcon（FN-DSA）签名：ffSampling/LDL 树 + 高斯采样 + 压缩签名编码。
 *
 * 依据（来源 URL 与访问日期见开发档案 SOURCES.md）：
 *   - 规范：Falcon Specification v1.2（2020-10-01）§3.6、§3.8、§3.9（算法 9–12）、
 *     §3.11.2/§3.11.3（压缩系数与签名编码）、表 3.3。
 *   - 参考实现：Falcon Round-3 Reference_Implementation/falcon512int 与 falcon1024int：
 *       sign.c    expand_privkey / ffSampling_fft_dyntree / do_sign_dyn /
 *                 gaussian0_sampler / BerExp / sampler；
 *       rng.c     ChaCha20 PRNG（prng_init / prng_refill / prng_get_u64 / prng_get_u8）；
 *       fpr.c/fpr.h  fpr 常量、fpr_expm_p63；
 *       codec.c   trim_i8_encode / trim_i8_decode；
 *       vrfy.c    complete_private（由 f,g,F 精确恢复 G）。
 *   参考实现为 MIT 许可，Copyright (c) 2017-2019 Falcon Project, Thomas Pornin。
 *
 * 数值域与参考实现一致：FFT 全程 IEEE-754 双精度（Float64Array），高斯采样在
 * 72 bit 固定点与 64 bit Bernoulli 比较上做整数运算；签名系数最终落回 int16。
 *
 * 随机源：nonce 与签名 PRNG 种子默认走统一随机层 randSource.randomBytes；
 * 显式给出 nonce/seed 时整条采样流可复现（KAT/对拍/教学用）。本文件不注册 op，
 * 不碰 UI、不联网。
 */

import {
  FALCON_Q,
  fft,
  ifft,
  polyAdd,
  polyMulAdjFft,
  polyMulConst,
  polyMulFft,
  polyMulSelfAdjFft,
  polyLDLFft,
  polySplitFft,
  polyMergeFft,
  compEncode,
  divModQ,
  decodePrivateKey,
  negacyclicNtt,
  negacyclicIntt,
} from "./falconKeygen.js";
import { keccak } from "./hash.js";
import { randomBytes } from "./randSource.js";

const Q = FALCON_Q;
const MASK64 = (1n << 64n) - 1n;

// fpr.h 常量的 double 位型按十进制全精度回写（Python struct.unpack 解码，见证据目录）。
const FPR_INV_SIGMA = {
  9: 0.006033669668157724,
  10: 0.005938645309533116,
};
const FPR_SIGMA_MIN = {
  9: 1.2778336969128337,
  10: 1.298280334344292,
};
const FPR_INV_2SQRSIGMA0 = 0.15086504887537272;
const FPR_LOG2 = 0.6931471805599453;
const FPR_INV_LOG2 = 1.4426950408889634;
const FPR_INVERSE_OF_Q = 8.137358613394092e-05;

// codec.c max_fg_bits / max_FG_bits（Falcon-512/1024 实用档）
const MAX_FG_BITS = [0, 8, 8, 8, 8, 8, 7, 7, 6, 6, 5];
const MAX_FG_BITS_FG = [0, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8];

// vrfy.c l2bound（与 falconVerify.js 的 ⌊β²⌋ 同源）
const L2BOUND = { 9: 34034726, 10: 70265242 };

// gaussian0_sampler 的 72 bit 分布表（sign.c 原表）
const GAUSSIAN0_DIST = [
  10745844, 3068844, 3741698,
  5559083, 1580863, 8248194,
  2260429, 13669192, 2736639,
  708981, 4421575, 10046180,
  169348, 7122675, 4136815,
  30538, 13063405, 7650655,
  4132, 14505003, 7826148,
  417, 16768101, 11363290,
  31, 8444042, 8086568,
  1, 12844466, 265321,
  0, 1232676, 13644283,
  0, 38047, 9111839,
  0, 870, 6138264,
  0, 14, 12545723,
  0, 0, 3104126,
  0, 0, 28824,
  0, 0, 198,
  0, 0, 1,
];

// fpr_expm_p63 的多项式系数（fpr.c 原表，已按 2^63 定标）
const EXPM_C = [
  0x00000004741183a3n,
  0x00000036548cfc06n,
  0x0000024fdcbf140an,
  0x0000171d939de045n,
  0x0000d00cf58f6f84n,
  0x000680681cf796e3n,
  0x002d82d8305b0fean,
  0x011111110e066fd0n,
  0x0555555555070f00n,
  0x155555555581ff00n,
  0x400000000002b400n,
  0x7fffffffffff4800n,
  0x8000000000000000n,
];

const TE = new TextEncoder();

function fail(msg) {
  return new Error(`Falcon 签名失败：${msg}`);
}

function toBytes(x, label) {
  if (x instanceof Uint8Array) return x;
  if (typeof x === "string") return TE.encode(x);
  throw fail(`${label}须为 Uint8Array 或字符串`);
}

function hexToBytes(hex, len, label) {
  const s = String(hex == null ? "" : hex).trim().replace(/^0x/i, "").replace(/[\s:]+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2) throw fail(`${label} 须为偶数个 hex 字符`);
  if (len != null && s.length !== len * 2) throw fail(`${label} 须为 ${len} 字节（收到 ${s.length / 2}）`);
  return Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.substr(i * 2, 2), 16));
}

function fixedBytes(x, len, label) {
  if (typeof x === "string") return hexToBytes(x, len, label);
  if (!(x instanceof Uint8Array)) throw fail(`${label} 须为 Uint8Array 或 hex 字符串`);
  if (x.length !== len) throw fail(`${label} 须为 ${len} 字节（收到 ${x.length}）`);
  return x;
}

function concatBytes(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

// ============================================================
// trim_i8（codec.c）：官方私钥的定宽补码编码
// ============================================================

function trimI8Decode(bytes, offset, n, bits) {
  const inLen = ((n * bits) + 7) >> 3;
  if (offset + inLen > bytes.length) throw fail(`私钥截断：需要 ${inLen} 字节，余 ${bytes.length - offset}`);
  const out = new Int8Array(n);
  const mask1 = (1 << bits) - 1;
  const mask2 = 1 << (bits - 1);
  let acc = 0;
  let accLen = 0;
  let pos = offset;
  let u = 0;
  while (u < n) {
    acc = (acc << 8) | bytes[pos++];
    accLen += 8;
    while (accLen >= bits && u < n) {
      accLen -= bits;
      let w = (acc >> accLen) & mask1;
      if (w & mask2) w -= 1 << bits;
      if (w === -mask2) throw fail(`私钥系数为禁用值 -2^${bits - 1}（第 ${u} 个）`);
      out[u++] = w;
    }
  }
  if ((acc & ((1 << accLen) - 1)) !== 0) throw fail("私钥末字节未用位非零");
  return { out, consumed: inLen };
}

export function trimI8Encode(values, n, bits) {
  const maxv = (1 << (bits - 1)) - 1;
  for (let i = 0; i < n; i++) {
    if (values[i] < -maxv || values[i] > maxv) throw fail(`系数 ${values[i]}（第 ${i} 个）超出 ${bits} bit 有符号范围`);
  }
  const out = new Uint8Array(((n * bits) + 7) >> 3);
  const mask = (1 << bits) - 1;
  let acc = 0;
  let accLen = 0;
  let pos = 0;
  for (let i = 0; i < n; i++) {
    acc = (acc << bits) | (values[i] & mask);
    accLen += bits;
    while (accLen >= 8) {
      accLen -= 8;
      out[pos++] = (acc >> accLen) & 0xff;
    }
  }
  if (accLen > 0) out[pos++] = (acc << (8 - accLen)) & 0xff;
  return out;
}

// ============================================================
// 私钥解码 / G 恢复（vrfy.c complete_private）
// ============================================================

function normalizeModQ(a, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = ((a[i] % Q) + Q) % Q;
  return out;
}

function mulModQ(a, b, logn) {
  const n = 1 << logn;
  const A = negacyclicNtt(normalizeModQ(a, n), logn);
  const B = negacyclicNtt(normalizeModQ(b, n), logn);
  const C = new Array(n);
  for (let i = 0; i < n; i++) C[i] = (A[i] * B[i]) % Q;
  return negacyclicIntt(C, logn);
}

// G = g·F/f mod (x^n+1, q)，再居中到 [-127,127]；与 vrfy.c complete_private 等价。
export function completePrivateG(f, g, F, logn) {
  const n = 1 << logn;
  const t = mulModQ(g, F, logn);
  const Gmod = divModQ(t, normalizeModQ(f, n), logn);
  if (Gmod === null) throw fail("f 在模 q 下不可逆，无法由 f,g,F 恢复 G");
  const G = new Int8Array(n);
  const half = (Q - 1) >> 1;
  for (let i = 0; i < n; i++) {
    let v = Gmod[i];
    if (v > half) v -= Q;
    if (v < -127 || v > 127) throw fail(`恢复出的 G[${i}] = ${v} 超出 int8 范围（私钥不一致）`);
    G[i] = v;
  }
  return G;
}

export function decodePrivateKeyOfficial(bytes) {
  if (!bytes || bytes.length < 1) throw fail("私钥为空");
  const b0 = bytes[0];
  if ((b0 & 0xf0) !== 0x50) throw fail(`私钥头字节 0x${b0.toString(16).padStart(2, "0")} 不符（应为 0x50 + logn）`);
  const logn = b0 & 0x0f;
  if (logn !== 9 && logn !== 10) throw fail(`官方私钥档位 n = 2^${logn} 不在支持范围（仅 9/10）`);
  const n = 1 << logn;
  const lenF = ((n * MAX_FG_BITS[logn]) + 7) >> 3;
  const lenFG = ((n * MAX_FG_BITS_FG[logn]) + 7) >> 3;
  const expected = 1 + lenF * 2 + lenFG;
  if (bytes.length !== expected) {
    throw fail(`官方私钥长度 ${bytes.length} 字节 ≠ 1 + ${lenF} + ${lenF} + ${lenFG} = ${expected} 字节`);
  }
  const f = trimI8Decode(bytes, 1, n, MAX_FG_BITS[logn]);
  const g = trimI8Decode(bytes, 1 + lenF, n, MAX_FG_BITS[logn]);
  const F = trimI8Decode(bytes, 1 + lenF * 2, n, MAX_FG_BITS_FG[logn]);
  const G = completePrivateG(f.out, g.out, F.out, logn);
  return { logn, n, f: f.out, g: g.out, F: F.out, G, keyFormat: "official" };
}

export function encodePrivateKeyOfficial(key) {
  const { logn, f, g, F } = key;
  if (logn !== 9 && logn !== 10) throw fail(`官方私钥仅支持 logn=9/10（收到 ${logn}）`);
  const n = 1 << logn;
  if (!f || !g || !F || f.length !== n || g.length !== n || F.length !== n) {
    throw fail(`私钥多项式长度须为 n = ${n}`);
  }
  const a = trimI8Encode(f, n, MAX_FG_BITS[logn]);
  const b = trimI8Encode(g, n, MAX_FG_BITS[logn]);
  const c = trimI8Encode(F, n, MAX_FG_BITS_FG[logn]);
  const out = new Uint8Array(1 + a.length + b.length + c.length);
  out[0] = 0x50 + logn;
  out.set(a, 1);
  out.set(b, 1 + a.length);
  out.set(c, 1 + a.length + b.length);
  return out;
}

function normalizePrivateKey(priv) {
  if (priv instanceof Uint8Array) {
    const b0 = priv[0];
    if ((b0 & 0xf0) !== 0x50) throw fail(`私钥头字节 0x${b0.toString(16).padStart(2, "0")} 不符`);
    const logn = b0 & 0x0f;
    const n = 1 << logn;
    const officialLen = logn === 9 ? 1281 : logn === 10 ? 2305 : 0;
    if (priv.length === officialLen) return decodePrivateKeyOfficial(priv);
    try {
      const k = decodePrivateKey(priv);
      if (k.logn !== 9 && k.logn !== 10) throw fail(`签名仅支持 Falcon-512/1024（收到 n=2^${k.logn}）`);
      return { ...k, keyFormat: "comp4" };
    } catch (e) {
      throw fail(`私钥既不是官方 ${officialLen} 字节格式，也不是本模块四段压缩格式：${e.message}`);
    }
  }
  if (!priv || typeof priv !== "object") throw fail("私钥须为字节串或 {logn,f,g,F,G} 对象");
  const logn = priv.logn;
  if (logn !== 9 && logn !== 10) throw fail(`签名仅支持 Falcon-512/1024（logn=${logn}）`);
  const n = 1 << logn;
  const need = (name) => {
    const a = priv[name];
    if (!a || a.length !== n) throw fail(`私钥 ${name} 长度须为 n = ${n}`);
    return Int8Array.from(a);
  };
  const f = need("f");
  const g = need("g");
  const F = need("F");
  let G;
  if (priv.G) {
    G = need("G");
  } else {
    G = completePrivateG(f, g, F, logn);
  }
  const check = (a, name) => {
    for (let i = 0; i < n; i++) {
      if (!Number.isInteger(a[i]) || a[i] < -127 || a[i] > 127) {
        throw fail(`私钥 ${name}[${i}] = ${a[i]} 不是 int8 系数`);
      }
    }
  };
  check(f, "f");
  check(g, "g");
  check(F, "F");
  check(G, "G");
  return { logn, n, f, g, F, G, keyFormat: priv.G ? "object" : "object-derived-g" };
}

// ============================================================
// SHAKE256 / HashToPoint（规范算法 3）
// ============================================================

function hashToPoint(nonce, msg, n) {
  const input = concatBytes(nonce, msg);
  let outLen = 2 * n + 64;
  for (;;) {
    const h = keccak(136, 0x1f, input, outLen);
    const c = new Array(n);
    let i = 0;
    let pos = 0;
    let ok = true;
    while (i < n) {
      if (pos + 2 > h.length) {
        ok = false;
        break;
      }
      const w = (h[pos] << 8) | h[pos + 1];
      pos += 2;
      if (w < 61445) c[i++] = w % Q;
    }
    if (ok) return c;
    outLen *= 2;
  }
}

// ============================================================
// ChaCha20 PRNG（rng.c 逐行移植；KAT 要求固定字节序与交织顺序）
// ============================================================

const CHACHA_CW = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574];

function rotl32(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function quarterRound(s, a, b, c, d) {
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = (s[d] ^ s[a]) >>> 0;
  s[d] = rotl32(s[d], 16);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = (s[b] ^ s[c]) >>> 0;
  s[b] = rotl32(s[b], 12);
  s[a] = (s[a] + s[b]) >>> 0;
  s[d] = (s[d] ^ s[a]) >>> 0;
  s[d] = rotl32(s[d], 8);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = (s[b] ^ s[c]) >>> 0;
  s[b] = rotl32(s[b], 7);
}

class FalconPrng {
  constructor(seed48) {
    if (!(seed48 instanceof Uint8Array) || seed48.length !== 48) {
      throw fail(`签名 PRNG 种子须为 48 字节（收到 ${seed48 && seed48.length}）`);
    }
    const s = keccak(136, 0x1f, seed48, 56);
    this.state = new Uint8Array(48);
    this.state.set(s.subarray(0, 48));
    let cc = 0n;
    for (let i = 7; i >= 0; i--) cc = (cc << 8n) | BigInt(s[48 + i]);
    this.cc = cc;
    this.buf = new Uint8Array(512);
    this.ptr = 0;
    this.refill();
  }

  refill() {
    const st = new Uint32Array(16);
    st[0] = CHACHA_CW[0];
    st[1] = CHACHA_CW[1];
    st[2] = CHACHA_CW[2];
    st[3] = CHACHA_CW[3];
    for (let i = 0; i < 12; i++) {
      const o = i << 2;
      st[4 + i] = (this.state[o] | (this.state[o + 1] << 8) | (this.state[o + 2] << 16) | (this.state[o + 3] << 24)) >>> 0;
    }
    let cc = this.cc;
    for (let u = 0; u < 8; u++) {
      const lo = Number(cc & 0xffffffffn);
      const hi = Number((cc >> 32n) & 0xffffffffn);
      const x = new Uint32Array(st);
      x[14] = (x[14] ^ lo) >>> 0;
      x[15] = (x[15] ^ hi) >>> 0;
      const w = new Uint32Array(x);
      for (let r = 0; r < 10; r++) {
        quarterRound(w, 0, 4, 8, 12);
        quarterRound(w, 1, 5, 9, 13);
        quarterRound(w, 2, 6, 10, 14);
        quarterRound(w, 3, 7, 11, 15);
        quarterRound(w, 0, 5, 10, 15);
        quarterRound(w, 1, 6, 11, 12);
        quarterRound(w, 2, 7, 8, 13);
        quarterRound(w, 3, 4, 9, 14);
      }
      for (let v = 0; v < 4; v++) w[v] = (w[v] + CHACHA_CW[v]) >>> 0;
      for (let v = 4; v < 14; v++) w[v] = (w[v] + st[v]) >>> 0;
      w[14] = (w[14] + (st[14] ^ lo)) >>> 0;
      w[15] = (w[15] + (st[15] ^ hi)) >>> 0;
      const base = (u << 2);
      for (let v = 0; v < 16; v++) {
        const o = base + (v << 5);
        const word = w[v];
        this.buf[o + 0] = word & 0xff;
        this.buf[o + 1] = (word >>> 8) & 0xff;
        this.buf[o + 2] = (word >>> 16) & 0xff;
        this.buf[o + 3] = (word >>> 24) & 0xff;
      }
      cc++;
    }
    this.cc = cc;
    this.ptr = 0;
  }

  getU64() {
    if (this.ptr >= 512 - 9) this.refill();
    let v = 0n;
    const p = this.ptr;
    for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(this.buf[p + i]);
    this.ptr += 8;
    return v;
  }

  getU8() {
    const v = this.buf[this.ptr++];
    if (this.ptr === 512) this.refill();
    return v;
  }
}

// ============================================================
// 高斯采样（sign.c gaussian0_sampler / BerExp / sampler）
// ============================================================

function gaussian0(prng) {
  const lo = prng.getU64();
  const hi = prng.getU8();
  const v0 = Number(lo & 0xffffffn);
  const v1 = Number((lo >> 24n) & 0xffffffn);
  const v2 = (Number((lo >> 48n) & 0xffffn) | (hi << 16)) >>> 0;
  let z = 0;
  for (let u = 0; u < GAUSSIAN0_DIST.length; u += 3) {
    const w0 = GAUSSIAN0_DIST[u + 2];
    const w1 = GAUSSIAN0_DIST[u + 1];
    const w2 = GAUSSIAN0_DIST[u + 0];
    let cc = ((v0 - w0) >>> 0) >>> 31;
    cc = ((v1 - w1 - cc) >>> 0) >>> 31;
    cc = ((v2 - w2 - cc) >>> 0) >>> 31;
    z += cc;
  }
  return z;
}

function fprExpmP63(x, ccs) {
  let y = EXPM_C[0];
  let z = ((BigInt(Math.trunc(x * 2 ** 63)) << 1n) & MASK64);
  for (let u = 1; u < EXPM_C.length; u++) {
    const c = ((z * y) >> 64n) & MASK64;
    y = (EXPM_C[u] - c) & MASK64;
  }
  z = ((BigInt(Math.trunc(ccs * 2 ** 63)) << 1n) & MASK64);
  return ((z * y) >> 64n) & MASK64;
}

function berExp(prng, x, ccs) {
  if (!Number.isFinite(x) || !Number.isFinite(ccs)) throw fail(`BerExp 参数非有限：x=${x} ccs=${ccs}`);
  let s = Math.trunc(x * FPR_INV_LOG2);
  const r = x - s * FPR_LOG2;
  let sw = s >>> 0;
  if (sw > 63) sw = 63;
  const z = ((((fprExpmP63(r, ccs) << 1n) - 1n) & MASK64) >> BigInt(sw));
  let i = 64;
  let w;
  do {
    i -= 8;
    w = (prng.getU8() - Number((z >> BigInt(i)) & 0xffn)) >>> 0;
  } while (w === 0 && i > 0);
  return w >>> 31;
}

function sampleZ(prng, mu, isigma, origLogn) {
  if (!Number.isFinite(mu) || !Number.isFinite(isigma)) throw fail(`采样参数非有限：mu=${mu} isigma=${isigma} origLogn=${origLogn}`);
  const s = Math.floor(mu);
  const r = mu - s;
  const dss = 0.5 * isigma * isigma;
  const ccs = isigma * FPR_SIGMA_MIN[origLogn];
  for (;;) {
    const z0 = gaussian0(prng);
    const b = prng.getU8() & 1;
    const z = b + ((b << 1) - 1) * z0;
    const dr = z - r;
    let x = dr * dr * dss;
    x -= z0 * z0 * FPR_INV_2SQRSIGMA0;
    if (berExp(prng, x, ccs)) return s + z;
  }
}

// ============================================================
// ffSampling（sign.c ffSampling_fft_dyntree，动态 LDL）
// ============================================================

// 动态 LDL 树采样（sign.c ffSampling_fft_dyntree）。
// 每个递归层用独立的精确长度数组，避免子数组别名/残留元素污染。
// 子矩阵映射与参考实现一致：
//   左：g00 = d00_even，g01 = d00_odd，g11 = d00_even；
//   右：g00 = d11_even，g01 = d11_odd，g11 = d11_even。
function ffSampling(t0, t1, g00, g01, g11, origLogn, logn, prng) {
  if (logn === 0) {
    if (!(g00[0] > 0)) throw fail(`LDL 树叶子 d00=${g00[0]} 非正（origLogn=${origLogn}）`);
    const leaf = Math.sqrt(g00[0]) * FPR_INV_SIGMA[origLogn];
    t0[0] = sampleZ(prng, t0[0], leaf, origLogn);
    t1[0] = sampleZ(prng, t1[0], leaf, origLogn);
    return;
  }
  const n = 1 << logn;
  const hn = n >> 1;

  polyLDLFft(g00, g01, g11, logn);
  const l10 = Float64Array.from(g01);

  const d00e = new Float64Array(hn);
  const d00o = new Float64Array(hn);
  polySplitFft(d00e, d00o, g00, logn);
  const d11e = new Float64Array(hn);
  const d11o = new Float64Array(hn);
  polySplitFft(d11e, d11o, g11, logn);

  const t1e = new Float64Array(hn);
  const t1o = new Float64Array(hn);
  polySplitFft(t1e, t1o, t1, logn);
  ffSampling(t1e, t1o, d11e, d11o, Float64Array.from(d11e), origLogn, logn - 1, prng);

  const z1 = new Float64Array(n);
  polyMergeFft(z1, t1e, t1o, logn);
  const diff = new Float64Array(n);
  for (let i = 0; i < n; i++) diff[i] = t1[i] - z1[i];
  t1.set(z1);

  const prod = Float64Array.from(l10);
  polyMulFft(prod, diff, logn);
  const tb0 = Float64Array.from(t0);
  polyAdd(tb0, prod);

  const t0e = new Float64Array(hn);
  const t0o = new Float64Array(hn);
  polySplitFft(t0e, t0o, tb0, logn);
  ffSampling(t0e, t0o, d00e, d00o, Float64Array.from(d00e), origLogn, logn - 1, prng);
  polyMergeFft(t0, t0e, t0o, logn);
}

// ============================================================
// do_sign_dyn（sign.c）
// ============================================================

function fprRint(x) {
  const f = Math.floor(x);
  const d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return (f % 2 === 0) ? f : f + 1;
}

function polyFromSmall(a, logn) {
  const n = 1 << logn;
  const f = new Float64Array(n);
  for (let i = 0; i < n; i++) f[i] = a[i];
  return f;
}

function polyNegFft(a, logn) {
  const n = 1 << logn;
  for (let i = 0; i < n; i++) a[i] = -a[i];
}

function polyMulSelfAdjCopy(a, logn) {
  const r = Float64Array.from(a);
  polyMulSelfAdjFft(r, logn);
  return r;
}

function doSignDyn(key, hm, prng) {
  const { logn, n, f, g, F, G } = key;
  const b01 = polyFromSmall(f, logn);
  const b00 = polyFromSmall(g, logn);
  const b11 = polyFromSmall(F, logn);
  const b10 = polyFromSmall(G, logn);
  fft(b01, logn);
  fft(b00, logn);
  fft(b11, logn);
  fft(b10, logn);
  polyNegFft(b01, logn);
  polyNegFft(b11, logn);

  const g00 = polyMulSelfAdjCopy(b00, logn);
  polyAdd(g00, polyMulSelfAdjCopy(b01, logn));

  const g01 = Float64Array.from(b00);
  polyMulAdjFft(g01, b10, logn);
  const gxx = Float64Array.from(b01);
  polyMulAdjFft(gxx, b11, logn);
  polyAdd(g01, gxx);

  const g11 = polyMulSelfAdjCopy(b10, logn);
  polyAdd(g11, polyMulSelfAdjCopy(b11, logn));

  const t0 = new Float64Array(n);
  for (let i = 0; i < n; i++) t0[i] = hm[i];
  fft(t0, logn);
  const t1 = Float64Array.from(t0);
  polyMulFft(t1, b01, logn);
  polyMulConst(t1, -FPR_INVERSE_OF_Q);
  polyMulFft(t0, b11, logn);
  polyMulConst(t0, FPR_INVERSE_OF_Q);

  ffSampling(t0, t1, g00, g01, g11, logn, logn, prng);

  const tx = Float64Array.from(t0);
  polyMulFft(tx, b00, logn);
  const ty = Float64Array.from(t1);
  polyMulFft(ty, b10, logn);
  polyAdd(tx, ty);
  const ty2 = Float64Array.from(t0);
  polyMulFft(ty2, b01, logn);
  const t1l = Float64Array.from(t1);
  polyMulFft(t1l, b11, logn);
  polyAdd(t1l, ty2);
  ifft(tx, logn);
  ifft(t1l, logn);

  const s1 = new Int16Array(n);
  const s2 = new Int16Array(n);
  let sqn = 0;
  for (let u = 0; u < n; u++) {
    const z = hm[u] - fprRint(tx[u]);
    s1[u] = z;
    sqn += z * z;
    if (z < -32768 || z > 32767) return null;
  }
  for (let u = 0; u < n; u++) {
    const z = -fprRint(t1l[u]);
    if (z < -32768 || z > 32767) return null;
    s2[u] = z;
    sqn += z * z;
  }
  return { s1, s2, sqn };
}

// ============================================================
// 对外 API
// ============================================================

function normalizeHm(hm, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const v = hm[i] % Q;
    out[i] = v < 0 ? v + Q : v;
  }
  return out;
}

/**
 * 原始签名：返回 s2 与统计，不拼接签名封装。
 * @param {Uint8Array|{logn:number,f:ArrayLike<number>,g:...,F:...,G?:...}} priv
 * @param {Uint8Array|string} msg
 * @param {{nonce?:Uint8Array|string, seed?:Uint8Array|string, maxAttempts?:number}} [opts]
 */
export function falconSignRaw(priv, msg, opts = {}) {
  const key = normalizePrivateKey(priv);
  const n = key.n;
  const logn = key.logn;
  const msgBytes = toBytes(msg, "消息");
  const nonce = opts.nonce != null ? fixedBytes(opts.nonce, 40, "nonce") : randomBytes(40);
  const seed = opts.seed != null ? fixedBytes(opts.seed, 48, "签名种子") : randomBytes(48);
  const hm = normalizeHm(hashToPoint(nonce, msgBytes, n), n);
  const prng = new FalconPrng(seed);
  const beta2 = L2BOUND[logn];
  const maxAttempts = opts.maxAttempts == null ? 1000 : opts.maxAttempts;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw fail(`maxAttempts 须为正整数（收到 ${maxAttempts}）`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const r = doSignDyn(key, hm, prng);
    if (r && r.sqn <= beta2) {
      const s2 = Array.from(r.s2);
      const comp = compEncode(s2, logn);
      const sig = new Uint8Array(1 + 40 + comp.length);
      sig[0] = 0x30 + logn;
      sig.set(nonce, 1);
      sig.set(comp, 41);
      return {
        logn,
        n,
        s2,
        nonce,
        seed,
        signature: sig,
        norm: r.sqn,
        beta2,
        attempts: attempt,
        keyFormat: key.keyFormat,
      };
    }
  }
  throw fail(`连续 ${maxAttempts} 次重采样仍超出 ‖(s1,s2)‖² ≤ ${beta2}（密钥或参数异常）`);
}

/**
 * 规范格式签名：0x30+logn ‖ nonce(40) ‖ comp(s2)。
 * 返回对象同时含 raw 统计；可直接交给 falconVerify.js 验签。
 */
export function falconSignCore(priv, msg, opts = {}) {
  return falconSignRaw(priv, msg, opts);
}

/**
 * NIST API signed-message 封装：[2 字节大端 sig_len] ‖ nonce(40) ‖ msg ‖ [0x20+logn ‖ comp(s2)]。
 * 与 falconVerify.js 的第二种自动识别格式一致（KAT 对拍用）。
 */
export function encodeNistSignedMessage(msg, nonce, s2, logn) {
  if (logn !== 9 && logn !== 10) throw fail(`NIST 签名仅支持 logn=9/10（收到 ${logn}）`);
  const msgBytes = toBytes(msg, "消息");
  const nonceB = fixedBytes(nonce, 40, "nonce");
  const comp = compEncode(Array.from(s2), logn);
  const esig = new Uint8Array(1 + comp.length);
  esig[0] = 0x20 + logn;
  esig.set(comp, 1);
  const out = new Uint8Array(2 + 40 + msgBytes.length + esig.length);
  out[0] = (esig.length >> 8) & 0xff;
  out[1] = esig.length & 0xff;
  out.set(nonceB, 2);
  out.set(msgBytes, 42);
  out.set(esig, 42 + msgBytes.length);
  return out;
}

export { FalconPrng, hashToPoint, fprRint, ffSampling };
