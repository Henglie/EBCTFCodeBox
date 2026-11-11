/*
 * mldsa.js — ML-DSA（Module-Lattice-Based Digital Signature Algorithm）keygen / sign / verify
 *
 * 标准：FIPS 204（final，2024-08-13）。算法号引用（FIPS 204 final 编号）：
 *   1 = ML-DSA.KeyGen    2 = ML-DSA.Sign    3 = ML-DSA.Verify
 *   6 = KeyGen_internal  7 = Sign_internal  8 = Verify_internal
 *   22 = pkEncode  23 = pkDecode  24 = skEncode  25 = skDecode
 *   26 = sigEncode 27 = sigDecode 28 = w1Encode
 *   29 = SampleInBall 30 = RejNTTPoly 31 = RejBoundedPoly
 *   32 = ExpandA 33 = ExpandS 34 = ExpandMask
 *   35 = Power2Round 36 = Decompose 37 = HighBits 38 = LowBits
 *   39 = MakeHint 40 = UseHint 41 = NTT^+ 42 = NTT^-
 *
 * 环与模数（FIPS 204 §4.1–4.3）：q = 8380417 = 2^23 − 2^13 + 1，n = 256。
 *   注意与 ML-KEM（FIPS 203）不同：那边 q = 3329、ζ = 17、不完全 NTT（γ 基乘）；
 *   本边 ζ = 1753（512 次本原单位根）→ 完整 NTT，NTT 域乘法为逐系数点乘，
 *   NTT^-1 末尾缩放 256^-1 mod q = 8347681。底层不共享，本文件自实现。
 * 哈希（FIPS 204 §4.4–4.5，基于 FIPS 202 Keccak）：H = SHAKE-256 变长输出
 *   （种子扩展 128B、tr/mu/rho' 64B、c_tilde 32/48/64B）；XOF = SHAKE-128（ExpandA）。
 *   FIPS 204 的 H 与 ML-KEM 的 H=SHA3-256 同名不同实，勿混。
 *
 * Keccak 海绵：复用 hash.js 的 keccakF1600 置换（mlkem.js/cmac.js 先例），
 * sponge 与流式 reader 本文件自实现（需要字节串输入 + 变长输出 + 拒绝采样按需取字节）。
 *
 * 验证：NIST ACVP 官方向量（usnistgov/ACVP-Server artifacts）keyGen 3x25、
 *   sigGen 3x(10 确定性 + 10 随机 rnd)、sigVer 3x15 全过（含负例）；
 *   dilithium-py 独立实现逐字节对拍一致。
 */

import { register } from "./registry.js";
import { keccakF1600 } from "./hash.js";
import { randomBytes as randBytes } from "./randSource.js"; // 统一随机源（默认档 system 逐字节零回归）

// ============================================================
// 字节工具（与 mlkem.js 同风格，件内自包含）
// ============================================================

const HEX_VAL = new Int8Array(256).fill(-1);
for (let i = 0; i < 10; i++) HEX_VAL[48 + i] = i;
for (let i = 0; i < 6; i++) { HEX_VAL[97 + i] = 10 + i; HEX_VAL[65 + i] = 10 + i; }
const HEX2 = [];
for (let i = 0; i < 256; i++) HEX2.push(i.toString(16).padStart(2, "0"));

function hexToBytes(hex) {
  let h = String(hex == null ? "" : hex).replace(/^0x/i, "").replace(/\s+/g, "");
  if (!h) return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0, j = 0; i < out.length; i++, j += 2) {
    const a = HEX_VAL[h.charCodeAt(j)] ?? -1, b = HEX_VAL[h.charCodeAt(j + 1)] ?? -1;
    if (a < 0 || b < 0) throw new Error(`含非 hex 字符: ${hex}`);
    out[i] = (a << 4) | b;
  }
  return out;
}

function bytesToHex(bytes) {
  const parts = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) parts[i] = HEX2[bytes[i]];
  return parts.join("");
}

function concatBytes(...arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** CSPRNG。密钥种子禁弱随机源：无 crypto.getRandomValues 直接报错，不降级。 */
function randomBytes(n) {
  return randBytes(n);
}

/** 种子参数解析：空 → 随机 32B；Uint8Array 直收；hex 须严格 32B。 */
function seedBytes(v, name) {
  if (v == null || String(v).trim() === "") return randomBytes(32);
  if (v instanceof Uint8Array) {
    if (v.length !== 32) throw new Error(`${name} 须为 32 字节（当前 ${v.length} 字节）`);
    return v;
  }
  const b = hexToBytes(v);
  if (b.length !== 32) throw new Error(`${name} 须为 32 字节 hex（当前 ${b.length} 字节）`);
  return b;
}

/** 消息参数 → 字节：text 模式 UTF-8，hex 模式严格解析。 */
function messageBytes(t, mode) {
  const s = String(t == null ? "" : t);
  if (mode === "hex") return hexToBytes(s.replace(/\s+/g, ""));
  return new TextEncoder().encode(s);
}

/** 取视图真字节通道（params.rawBytes）；无则 null。 */
function rawBytesOf(p) {
  const b = p && p.rawBytes;
  if (b == null) return null;
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

/** 视图 text 模式字节与文本同构时让位给原文本层；真字节（hex/base64 视图、文件）原样优先。 */
function rawBytesOrNull(p, text) {
  const b = rawBytesOf(p);
  if (!b) return null;
  const t = new TextEncoder().encode(String(text == null ? "" : text));
  if (b.length === t.length) {
    let same = true;
    for (let i = 0; i < b.length; i++) if (b[i] !== t[i]) { same = false; break; }
    if (same) return null;
  }
  return b;
}

/** 上下文 ctx → 字节（UTF-8，≤255B，FIPS 204 §5.4）。 */
function ctxBytes(v) {
  const b = new TextEncoder().encode(String(v == null ? "" : v));
  if (b.length > 255) throw new Error(`上下文 ctx 须 ≤255 字节（UTF-8 后 ${b.length} 字节）`);
  return b;
}

// ============================================================
// Keccak 海绵（FIPS 202 §5/§6.2；复用 hash.js keccakF1600，mlkem.js 先例）
// ============================================================

// 海绵状态 / 末块复用缓冲（同步调用，无重入）。
const SPONGE_LO = new Uint32Array(25);
const SPONGE_HI = new Uint32Array(25);
const PAD_BLOCK = new Uint8Array(168); // 最大 rate（SHAKE128）

/** 整块吸收（rate 为 8 的倍数：136 / 168）。 */
function absorbBlock(src, off, rate, sLo, sHi) {
  for (let i = 0; i < rate; i += 8) {
    const li = i >> 3;
    const p = off + i;
    const lo = (src[p] | (src[p + 1] << 8) | (src[p + 2] << 16) | (src[p + 3] << 24)) >>> 0;
    const hi = (src[p + 4] | (src[p + 5] << 8) | (src[p + 6] << 16) | (src[p + 7] << 24)) >>> 0;
    sLo[li] = (sLo[li] ^ lo) >>> 0;
    sHi[li] = (sHi[li] ^ hi) >>> 0;
  }
}

/** 一次性 sponge：SHAKE 域分隔 0x1f + pad10*1，输入任意长度（整块直吸收）。 */
function sponge(rate, msg, outLen) {
  const sLo = SPONGE_LO, sHi = SPONGE_HI;
  sLo.fill(0);
  sHi.fill(0);
  const msgLen = msg.length;
  const full = msgLen - (msgLen % rate);
  for (let off = 0; off < full; off += rate) {
    absorbBlock(msg, off, rate, sLo, sHi);
    keccakF1600(sLo, sHi);
  }
  const rem = msgLen - full;
  const block = PAD_BLOCK;
  block.fill(0, 0, rate);
  for (let i = 0; i < rem; i++) block[i] = msg[full + i];
  block[rem] = 0x1f;
  block[rate - 1] |= 0x80;
  absorbBlock(block, 0, rate, sLo, sHi);
  keccakF1600(sLo, sHi);
  const out = new Uint8Array(outLen);
  let produced = 0;
  while (produced < outLen) {
    const blockBytes = Math.min(rate, outLen - produced);
    for (let i = 0; i < blockBytes; i++) {
      const laneIdx = i >> 3;
      const bil = i & 7;
      const word = bil < 4 ? sLo[laneIdx] : sHi[laneIdx];
      out[produced++] = (word >>> ((bil & 3) * 8)) & 0xff;
    }
    if (produced < outLen) keccakF1600(sLo, sHi);
  }
  return out;
}

/** SHAKE-256 一次性输出（FIPS 204 的 H 原语）。 */
const shake256 = (msg, outLen) => sponge(136, msg, outLen);

/**
 * 流式 SHAKE reader：供拒绝采样按需逐字节取（rate=168 → SHAKE-128，136 → SHAKE-256）。
 * 仅接受 seed ≤ rate−2（本文件全部采样 seed 均满足：最大 ρ'66B / c̃64B）。
 * 复用单块缓冲，不按读取长度切片分配。
 */
function shakeStream(rate, seed) {
  const sLo = new Uint32Array(25), sHi = new Uint32Array(25);
  if (seed.length > rate - 2) throw new Error("shakeStream 内部错误：seed 超出单块海绵容量");
  const block = new Uint8Array(rate);
  block.set(seed);
  block[seed.length] = 0x1f;
  block[rate - 1] |= 0x80;
  absorbBlock(block, 0, rate, sLo, sHi);
  keccakF1600(sLo, sHi);
  const buf = new Uint8Array(rate);
  let pos = 0, len = 0;
  const refill = () => {
    for (let i = 0; i < rate; i++) {
      const laneIdx = i >> 3;
      const bil = i & 7;
      const word = bil < 4 ? sLo[laneIdx] : sHi[laneIdx];
      buf[i] = (word >>> ((bil & 3) * 8)) & 0xff;
    }
    keccakF1600(sLo, sHi); // 挤出一块后再置换，供下一块
    pos = 0;
    len = rate;
  };
  return function next() {
    if (pos >= len) refill();
    return buf[pos++];
  };
}

// ============================================================
// Z_8380417 与完整 NTT（FIPS 204 §4.3，Alg 41/42）
// ============================================================

const Q = 8380417; // 2^23 − 2^13 + 1（FIPS 204 §4.1）
const NTT_F = 8347681; // 256^{-1} mod q（NTT^-1 末尾缩放）
const D = 13; // Power2Round 丢位（FIPS 204 Table 1 三参数集同值）

function bitRev8(i) {
  return ((i & 1) << 7) | ((i & 2) << 5) | ((i & 4) << 3) | ((i & 8) << 1) | ((i & 16) >> 1) | ((i & 32) >> 3) | ((i & 64) >> 5) | ((i & 128) >> 7);
}

function powMod(b, e) {
  let r = 1;
  while (e > 0) {
    if (e & 1) r = (r * b) % Q;
    b = (b * b) % Q;
    e >>= 1;
  }
  return r;
}

// ZETAS[i] = 1753^BitRev8(i) mod q（ζ=1753 为 512 次本原单位根，FIPS 204 §4.3）
// 正向 NTT 消耗 ZETAS[1..255]，逆向消耗 −ZETAS[255..1]（完整 NTT 共 255 只蝶形）
const ZETAS = new Int32Array(256);
for (let i = 0; i < 256; i++) ZETAS[i] = powMod(1753, bitRev8(i));

/** 非负剩余。 */
const modQ = (x) => ((x % Q) + Q) % Q;

// Barrett 归约：x ∈ [0, 2q²)，用 1/q 倒数一次乘减再修正（比 % 快且结果精确）。
const INV_Q = 1 / Q;
function redc(x) {
  let r = x - ((x * INV_Q) | 0) * Q; // x/q < 2^31，|0 即向下取整
  if (r >= Q) r -= Q;
  else if (r < 0) r += Q;
  return r;
}



/** 正向完整 NTT（Alg 41）：就地，位反转序输出，逐蝶形归约在 [0,q)。
 *  输入为 (-q, 2q) 内整数；与「末端一次取模」的数学结果一致，模等价。 */
function ntt(f) {
  for (let j = 0; j < 256; j++) {
    let x = f[j];
    if (x < 0) x += Q;
    else if (x >= Q) x %= Q;
    f[j] = x;
  }
  let k = 0;
  for (let len = 128; len > 0; len >>= 1) {
    for (let start = 0; start < 256; start += len << 1) {
      const zeta = ZETAS[++k];
      for (let j = start; j < start + len; j++) {
        const v = f[j], u = f[j + len];
        const t = redc(zeta * u);
        let x = v - t;
        if (x < 0) x += Q;
        f[j + len] = x;
        x = v + t;
        if (x >= Q) x -= Q;
        f[j] = x;
      }
    }
  }
}

/** 逆向 NTT（Alg 42）：就地，输入 [0,q)，输出 [0,q) 标准序，末尾乘 256^{-1}。 */
function intt(f) {
  let k = 256;
  for (let len = 1; len < 256; len <<= 1) {
    for (let start = 0; start < 256; start += len << 1) {
      const zeta = Q - ZETAS[--k]; // −ζ mod q
      for (let j = start; j < start + len; j++) {
        const v = f[j], u = f[j + len];
        let x = v + u;
        if (x >= Q) x -= Q;
        f[j] = x;
        x = v - u;
        if (x < 0) x += Q;
        f[j + len] = redc(zeta * x);
      }
    }
  }
  for (let j = 0; j < 256; j++) f[j] = redc(f[j] * NTT_F);
}

/** NTT 域点乘累加：dst[j] += a[j]·b[j] mod q。 */
function addPwInto(dst, a, b) {
  for (let j = 0; j < 256; j++) dst[j] = redc(dst[j] + a[j] * b[j]);
}

/** NTT 域点乘写入复用缓冲。 */
function mulPwInto(out, a, b) {
  for (let j = 0; j < 256; j++) out[j] = redc(a[j] * b[j]);
}

/** 拷贝并正向 NTT。 */
const nttOf = (f) => { const g = f.slice(); ntt(g); return g; };

// ============================================================
// 位打包（FIPS 204 §4.2/§7.2，LSB 先行位流）
// ============================================================

/** SimpleBitPack/BitPack 通用写入 out[off..]：256 系数 × nBits 位。
 *  位运算实现（nBits≤20 时累加器 ≤28 位，精确）。系数须在 [0, 2^nBits)。 */
function bitPackTo(coeffs, nBits, out, off) {
  let acc = 0, accBits = 0;
  for (let j = 0; j < 256; j++) {
    acc |= coeffs[j] << accBits;
    accBits += nBits;
    while (accBits >= 8) {
      out[off++] = acc & 0xff;
      acc >>>= 8;
      accBits -= 8;
    }
  }
}

/** BitUnpack：原始 [0, 2^nBits) 系数。 */
function bitUnpackAt(bytes, off, nBits) {
  const f = new Int32Array(256);
  const mask = (1 << nBits) - 1;
  let acc = 0, accBits = 0, pos = off;
  for (let j = 0; j < 256; j++) {
    while (accBits < nBits) {
      acc |= bytes[pos++] << accBits;
      accBits += 8;
    }
    f[j] = acc & mask;
    acc >>>= nBits;
    accBits -= nBits;
  }
  return f;
}

/** BitUnpack 后做中心化修正 out[j] = base − v（s1/s2/z/t0/ExpandMask 共用）。 */
function bitUnpackSignedAt(bytes, off, nBits, base) {
  const f = new Int32Array(256);
  const mask = (1 << nBits) - 1;
  let acc = 0, accBits = 0, pos = off;
  for (let j = 0; j < 256; j++) {
    while (accBits < nBits) {
      acc |= bytes[pos++] << accBits;
      accBits += 8;
    }
    f[j] = base - (acc & mask);
    acc >>>= nBits;
    accBits -= nBits;
  }
  return f;
}

// ============================================================
// 分解与提示（FIPS 204 §4.4，Alg 35–40）
// ============================================================

/** HighBits（Alg 37）：标量实现，不分配 [r1,r0]。 */
function highBits(r, alpha) {
  const rp = modQ(r);
  let r0 = rp % alpha;
  if (r0 > (alpha >> 1)) r0 -= alpha;
  if (rp - r0 === Q - 1) return 0;
  return (rp - r0) / alpha;
}

/** LowBits（Alg 38）：标量实现。 */
function lowBits(r, alpha) {
  const rp = modQ(r);
  let r0 = rp % alpha;
  if (r0 > (alpha >> 1)) r0 -= alpha;
  if (rp - r0 === Q - 1) r0 -= 1;
  return r0;
}

/** MakeHint（Alg 39）：r 与 r+z 的高位是否跨桶。 */
const makeHint1 = (z, r, alpha) => (highBits(r, alpha) !== highBits(r + z, alpha) ? 1 : 0);

/** UseHint（Alg 40）：桶数模 m = ⌊(q−1)/alpha⌋ 环回。 */
function useHint1(h, r, alpha) {
  const m = Math.floor((Q - 1) / alpha);
  const rp = modQ(r);
  let r0 = rp % alpha;
  if (r0 > (alpha >> 1)) r0 -= alpha;
  let r1;
  if (rp - r0 === Q - 1) { r1 = 0; r0 -= 1; }
  else r1 = (rp - r0) / alpha;
  if (h === 1) {
    if (r0 > 0) return (r1 + 1) % m;
    return ((r1 - 1) % m + m) % m;
  }
  return r1;
}

/** 中心化绝对值（无穷范数用）。 */
function absCentered(x) {
  let v = x;
  if (v < 0) { v %= Q; if (v < 0) v += Q; }
  else if (v >= Q) v %= Q;
  if (v > (Q - 1) / 2) v = Q - v;
  return v;
}

/** 范数检查失败判定：中心化绝对值 ≥ bound（FIPS 204 §4.4 NormBound 语义）。 */
const normFail = (x, bound) => absCentered(x) >= bound;

// ============================================================
// 采样（FIPS 204 §4.3.1，Alg 29–34）
// ============================================================

// RejBoundedPoly 半字节查表（0x7fff 表示拒绝）。
const REJ2 = new Int32Array(16).fill(0x7fff);
for (let v = 0; v < 15; v++) REJ2[v] = 2 - (v % 5);
const REJ4 = new Int32Array(16).fill(0x7fff);
for (let v = 0; v < 9; v++) REJ4[v] = 4 - v;

/** RejNTTPoly（Alg 30）：SHAKE128 流上 3 字节产 23 位候选，拒绝 ≥ q。 */
function rejNttPoly(rho, col, row) {
  const seed = new Uint8Array(34);
  seed.set(rho, 0);
  seed[32] = col;
  seed[33] = row;
  const next = shakeStream(168, seed);
  const f = new Int32Array(256);
  let n = 0;
  while (n < 256) {
    const v = (next() | (next() << 8) | (next() << 16)) & 0x7fffff;
    if (v < Q) f[n++] = v;
  }
  return f;
}

/** RejBoundedPoly（Alg 31）：SHAKE256 流上按半字节拒绝采样，值域 [−η, η]。
 *  η=2：v<15 → 2−(v mod 5)；η=4：v<9 → 4−v。低半字节先用，填满 256 即止。 */
function rejBoundedPoly(sigma, nonce, eta) {
  const seed = new Uint8Array(66);
  seed.set(sigma, 0);
  seed[64] = nonce & 0xff;
  seed[65] = (nonce >> 8) & 0xff;
  const next = shakeStream(136, seed.subarray(0, 66));
  const tbl = eta === 2 ? REJ2 : REJ4;
  const f = new Int32Array(256);
  let n = 0;
  while (n < 256) {
    const b = next();
    let c = tbl[b & 15];
    if (c !== 0x7fff) f[n++] = c;
    if (n >= 256) break;
    c = tbl[b >> 4];
    if (c !== 0x7fff) f[n++] = c;
  }
  return f;
}

/** ExpandMask（Alg 34）：y[i] 系数 = γ1 − BitUnpack_{18/20}(SHAKE256(ρ'‖i2b16(µ+i)))，
 *  定长流无拒绝，值域 (−γ1, γ1]。 */
function expandMask(s, rhoPrime, kappa) {
  const y = [];
  const byteLen = 32 * s.zBits;
  const seed = new Uint8Array(66);
  seed.set(rhoPrime, 0);
  for (let i = 0; i < s.l; i++) {
    const t = kappa + i;
    seed[64] = t & 0xff;
    seed[65] = (t >> 8) & 0xff;
    const buf = shake256(seed, byteLen);
    y.push(bitUnpackSignedAt(buf, 0, s.zBits, s.gamma1));
  }
  return y;
}

/** SampleInBall（Alg 29）：SHAKE256(c_tilde) 前 8 字节定符号（LE 位序），
 *  位置带拒绝的 Fisher–Yates 摆 τ 个 ±1。 */
function sampleInBall(cTilde, tau) {
  const next = shakeStream(136, cTilde);
  const signBytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) signBytes[i] = next();
  let signPos = 0;
  const f = new Int32Array(256);
  for (let i = 256 - tau; i < 256; i++) {
    let j = next();
    while (j > i) j = next();
    f[i] = f[j];
    const sign = (signBytes[signPos >> 3] >> (signPos & 7)) & 1;
    signPos++;
    f[j] = 1 - 2 * sign;
  }
  return f;
}

// ============================================================
// 参数集（FIPS 204 Table 1）
// ============================================================

const PARAM_SETS = {
  44: { k: 4, l: 4, eta: 2, tau: 39, gamma1: 131072, gamma2: 95232, omega: 80, ctLen: 32, beta: 78 },
  65: { k: 6, l: 5, eta: 4, tau: 49, gamma1: 524288, gamma2: 261888, omega: 55, ctLen: 48, beta: 196 },
  87: { k: 8, l: 7, eta: 2, tau: 60, gamma1: 524288, gamma2: 261888, omega: 75, ctLen: 64, beta: 120 },
};

function getSet(key) {
  const name = String(key == null ? "65" : key).replace(/^ML-DSA-/i, "").trim();
  const b = PARAM_SETS[name];
  if (!b) throw new Error(`未知参数集: ${key}（可选 ML-DSA-44 / 65 / 87）`);
  const sPolyBits = b.eta === 2 ? 3 : 4;       // BitPack(−η..η) 位宽：⌈log2(2η+1)⌉
  const zBits = b.gamma1 === 131072 ? 18 : 20; // BitPack(−γ1..γ1) 位宽
  const w1Bits = b.gamma2 === 95232 ? 6 : 4;   // w1Encode 位宽：(q−1)/88→6 位，/32→4 位
  return {
    name, ...b, sPolyBits, zBits, w1Bits,
    pkLen: 32 + 320 * b.k,
    skLen: 128 + 32 * sPolyBits * (b.k + b.l) + 416 * b.k,
    sigLen: b.ctLen + 32 * zBits * b.l + b.omega + b.k,
  };
}

// ============================================================
// 编解码（FIPS 204 §7.2，Alg 22–28）
// ============================================================

/** ExpandA（Alg 32）：Â[r][s] = RejNTTPoly(SHAKE128(ρ‖i2b(s)‖i2b(r)))，列先于行。 */
function expandA(s, rho) {
  const A = [];
  for (let r = 0; r < s.k; r++) {
    const row = [];
    for (let c = 0; c < s.l; c++) row.push(rejNttPoly(rho, c, r));
    A.push(row);
  }
  return A;
}

/** pkEncode（Alg 22）：pk = ρ ‖ 逐多项式 SimpleBitPack_10(t1)。 */
function pkEncode(s, rho, t1) {
  const pk = new Uint8Array(s.pkLen);
  pk.set(rho, 0);
  for (let i = 0; i < s.k; i++) bitPackTo(t1[i], 10, pk, 32 + 320 * i);
  return pk;
}

/** pkDecode（Alg 23）。 */
function pkDecode(s, pk) {
  if (pk.length !== s.pkLen) {
    throw new Error(`pk 长度错误：ML-DSA-${s.name} 应为 ${s.pkLen} 字节，实得 ${pk.length}`);
  }
  const rho = pk.slice(0, 32);
  const t1 = [];
  for (let i = 0; i < s.k; i++) t1.push(bitUnpackAt(pk, 32 + 320 * i, 10));
  return { rho, t1 };
}

/** skEncode（Alg 24）：ρ‖K‖tr‖s1‖s2‖t0；s 用 BitPack_η（存 η−c），t0 存 2^12−c。 */
function skEncode(s, rho, K, tr, s1, s2, t0) {
  const sk = new Uint8Array(s.skLen);
  sk.set(rho, 0);
  sk.set(K, 32);
  sk.set(tr, 64);
  const sBytes = 32 * s.sPolyBits;
  const tmp = new Int32Array(256);
  let off = 128;
  const packS = (f) => {
    for (let j = 0; j < 256; j++) tmp[j] = s.eta - f[j];
    bitPackTo(tmp, s.sPolyBits, sk, off);
    off += sBytes;
  };
  for (const f of s1) packS(f);
  for (const f of s2) packS(f);
  for (const f of t0) {
    for (let j = 0; j < 256; j++) tmp[j] = 4096 - f[j];
    bitPackTo(tmp, 13, sk, off);
    off += 416;
  }
  return sk;
}

/** skDecode（Alg 25）：s = η−v，t0 = 2^12−v。 */
function skDecode(s, sk) {
  if (sk.length !== s.skLen) {
    throw new Error(`sk 长度错误：ML-DSA-${s.name} 应为 ${s.skLen} 字节，实得 ${sk.length}`);
  }
  const rho = sk.slice(0, 32);
  const K = sk.slice(32, 64);
  const tr = sk.slice(64, 128);
  const sBytes = 32 * s.sPolyBits;
  const s1 = [], s2 = [], t0 = [];
  let off = 128;
  for (let i = 0; i < s.l; i++) { s1.push(bitUnpackSignedAt(sk, off, s.sPolyBits, s.eta)); off += sBytes; }
  for (let i = 0; i < s.k; i++) { s2.push(bitUnpackSignedAt(sk, off, s.sPolyBits, s.eta)); off += sBytes; }
  for (let i = 0; i < s.k; i++) { t0.push(bitUnpackSignedAt(sk, off, 13, 4096)); off += 416; }
  return { rho, K, tr, s1, s2, t0 };
}

/** w1Encode（Alg 28）：逐多项式 SimpleBitPack（6 或 4 位）。 */
function w1Encode(s, w1) {
  const per = 32 * s.w1Bits;
  const out = new Uint8Array(per * w1.length);
  for (let i = 0; i < w1.length; i++) bitPackTo(w1[i], s.w1Bits, out, i * per);
  return out;
}

/** sigEncode（Alg 26）：σ = c̃ ‖ BitPack_γ1(z) ‖ h（ω 字节位置流 + k 字节累计偏移）。 */
function sigEncode(s, cTilde, z, h) {
  const zBytes = 32 * s.zBits;
  const out = new Uint8Array(s.sigLen);
  out.set(cTilde, 0);
  const tmp = new Int32Array(256);
  for (let i = 0; i < s.l; i++) {
    for (let j = 0; j < 256; j++) tmp[j] = s.gamma1 - z[i][j];
    bitPackTo(tmp, s.zBits, out, s.ctLen + i * zBytes);
  }
  const posOff = s.ctLen + s.l * zBytes;
  let count = 0;
  for (let i = 0; i < s.k; i++) {
    for (let j = 0; j < 256; j++) if (h[i][j] === 1) out[posOff + count++] = j;
    out[posOff + s.omega + i] = count;
  }
  return out;
}

/** sigDecode（Alg 27）：严格长度 + 偏移单调不减 + 累计 ≤ ω + 填充区全零 + 位置严格递增。
 *  任何违规抛错（verify 包装为「不合法」）。 */
function sigDecode(s, sig) {
  if (sig.length !== s.sigLen) {
    throw new Error(`签名长度错误：ML-DSA-${s.name} 应为 ${s.sigLen} 字节，实得 ${sig.length}`);
  }
  const cTilde = sig.slice(0, s.ctLen);
  const zBytes = 32 * s.zBits;
  const z = [];
  for (let i = 0; i < s.l; i++) z.push(bitUnpackSignedAt(sig, s.ctLen + i * zBytes, s.zBits, s.gamma1));
  const hOff = s.ctLen + s.l * zBytes;
  const offsets = new Int32Array(s.k + 1);
  for (let i = 0; i < s.k; i++) offsets[i + 1] = sig[hOff + s.omega + i];
  for (let i = 0; i < s.k; i++) {
    if (offsets[i] > offsets[i + 1]) throw new Error("sigDecode 失败：h 偏移非单调不减");
  }
  if (offsets[s.k] > s.omega) throw new Error("sigDecode 失败：hint 偏移累计超 ω");
  for (let i = offsets[s.k]; i < s.omega; i++) {
    if (sig[hOff + i] !== 0) throw new Error("sigDecode 失败：h 填充区非零");
  }
  const h = [];
  let hintCount = 0;
  for (let i = 0; i < s.k; i++) {
    const f = new Uint8Array(256);
    let prev = -1;
    for (let p = offsets[i]; p < offsets[i + 1]; p++) {
      const v = sig[hOff + p];
      if (v <= prev) throw new Error("sigDecode 失败：hint 位置非严格递增");
      f[v] = 1; prev = v; hintCount++;
    }
    h.push(f);
  }
  return { cTilde, z, h, hintCount };
}

// ============================================================
// ML-DSA（FIPS 204 §5–7，Alg 1–8）
// ============================================================

/** ML-DSA.KeyGen_internal（Alg 6）+ KeyGen（Alg 1）：
 *  (ρ,ρ′,K) = SHAKE256(ξ‖i2b(k)‖i2b(l), 128)；tr = SHAKE256(pk, 64)。 */
export function mldsaKeyGenBytes(setKey, zeta) {
  const s = getSet(setKey);
  zeta = seedBytes(zeta, "种子 ξ");
  const seed = shake256(concatBytes(zeta, new Uint8Array([s.k, s.l])), 128);
  const rho = seed.subarray(0, 32);
  const rhoPrime = seed.subarray(32, 96);
  const K = seed.subarray(96, 128);

  const A = expandA(s, rho);
  const s1 = [], s2 = [];
  for (let i = 0; i < s.l; i++) s1.push(rejBoundedPoly(rhoPrime, i, s.eta));      // ExpandS：nonce 0..l−1
  for (let i = 0; i < s.k; i++) s2.push(rejBoundedPoly(rhoPrime, s.l + i, s.eta)); // ExpandS：nonce l..l+k−1

  const s1Hat = s1.map(nttOf);
  const t1 = [], t0 = [];
  for (let i = 0; i < s.k; i++) {
    const acc = new Int32Array(256);
    for (let j = 0; j < s.l; j++) addPwInto(acc, A[i][j], s1Hat[j]);
    intt(acc);
    const hi = new Int32Array(256), lo = new Int32Array(256);
    for (let j = 0; j < 256; j++) {
      let x = acc[j] + s2[i][j];
      if (x < 0) x += Q;
      else if (x >= Q) x -= Q;
      // Power2Round（Alg 35）：2^13 为 2 的幂 → 掩码取余
      let r0 = x & 8191;
      if (r0 > 4096) r0 -= 8192;
      hi[j] = (x - r0) / 8192;
      lo[j] = r0;
    }
    t1.push(hi); t0.push(lo);
  }

  const pk = pkEncode(s, rho, t1);
  const tr = shake256(pk, 64);
  const sk = skEncode(s, rho, K, tr, s1, s2, t0);
  return { set: s.name, s, zeta, pk, sk };
}

/** M′ 组装（FIPS 204 §5.4，Alg 2–3 行 2）：0x00 ‖ len(ctx) ‖ ctx ‖ M。 */
function formatMessage(msg, ctx) {
  if (ctx.length > 255) throw new Error(`上下文 ctx 须 ≤255 字节（当前 ${ctx.length}）`);
  return concatBytes(new Uint8Array([0, ctx.length]), ctx, msg);
}

/**
 * ML-DSA.Sign_internal（Alg 7）：输入已是格式化消息 M′（FIPS 204 §5.4）。
 * ACVP sigGen 向量即此层语义（message 字段直作 M′）。rnd：留空 → 随机 32B（hedged）；
 * hex 32B 显式指定（全零 = 确定性，KAT/复现用）。
 * 返回 { set, s, sig, cTilde, rounds, hintCount, rnd }。
 */
export function mldsaSignInternalBytes(setKey, skHex, mPrime, rnd) {
  const s = getSet(setKey);
  const sk = hexToBytes(skHex);
  const { rho, K, tr, s1, s2, t0 } = skDecode(s, sk);
  rnd = seedBytes(rnd, "随机性 rnd");

  const s1Hat = s1.map(nttOf);
  const s2Hat = s2.map(nttOf);
  const t0Hat = t0.map(nttOf);
  const A = expandA(s, rho);
  const mu = shake256(concatBytes(tr, mPrime), 64);
  const rhoPrime = shake256(concatBytes(K, rnd, mu), 64);
  const alpha = 2 * s.gamma2;

  // 复用缓冲：拒绝采样重试时只覆写，不重复分配。
  const w = [], w1 = [], cs2 = [], h = [], z = [];
  for (let i = 0; i < s.k; i++) {
    w.push(new Int32Array(256));
    w1.push(new Int32Array(256));
    cs2.push(new Int32Array(256));
    h.push(new Uint8Array(256));
  }
  for (let j = 0; j < s.l; j++) z.push(new Int32Array(256));
  const scratch = new Int32Array(256);

  let kappa = 0, rounds = 0;
  for (;;) {
    if (++rounds > 1000) throw new Error("签名拒绝采样超限（输入数据异常）");
    const y = expandMask(s, rhoPrime, kappa);
    kappa += s.l;
    const yHat = y.map(nttOf);

    // w = INTT(Â·ŷ)，w1 = HighBits(w, 2γ2)
    for (let i = 0; i < s.k; i++) {
      const acc = w[i];
      acc.fill(0);
      for (let j = 0; j < s.l; j++) addPwInto(acc, A[i][j], yHat[j]);
      intt(acc);
      const hi = w1[i];
      for (let t = 0; t < 256; t++) hi[t] = highBits(acc[t], alpha);
    }
    const cTilde = shake256(concatBytes(mu, w1Encode(s, w1)), s.ctLen);
    const cHat = nttOf(sampleInBall(cTilde, s.tau));

    // z = y + INTT(ĉ·ŝ1)，须 ‖z‖∞ < γ1 − β。INTT 输出在 [0,q)，先中心化再与 y 相加
    //（与参考实现 _add_ 的 mod^± q 语义一致），否则打包 γ1−c 会越界。
    let zBad = false;
    for (let j = 0; j < s.l; j++) {
      mulPwInto(scratch, cHat, s1Hat[j]);
      intt(scratch);
      const p = z[j];
      for (let t = 0; t < 256; t++) {
        const ct = scratch[t] > (Q - 1) / 2 ? scratch[t] - Q : scratch[t];
        const v = y[j][t] + ct;
        if (normFail(v, s.gamma1 - s.beta)) { zBad = true; break; }
        p[t] = v;
      }
      if (zBad) break;
    }
    if (zBad) continue;

    // r0 = LowBits(w − INTT(ĉ·ŝ2))，须 ‖r0‖∞ < γ2 − β
    for (let i = 0; i < s.k; i++) {
      mulPwInto(cs2[i], cHat, s2Hat[i]);
      intt(cs2[i]);
    }
    let r0Bad = false;
    for (let i = 0; i < s.k && !r0Bad; i++) {
      for (let t = 0; t < 256; t++) {
        if (normFail(lowBits(w[i][t] - cs2[i][t], alpha), s.gamma2 - s.beta)) { r0Bad = true; break; }
      }
    }
    if (r0Bad) continue;

    // c_t0 = INTT(ĉ·t̂0)，须 ‖c_t0‖∞ < γ2；h = MakeHint(−c_t0, w − c_s2 + c_t0)
    let t0Bad = false;
    for (let i = 0; i < s.k && !t0Bad; i++) {
      mulPwInto(scratch, cHat, t0Hat[i]);
      intt(scratch);
      const hp = h[i];
      for (let t = 0; t < 256; t++) {
        if (normFail(scratch[t], s.gamma2)) { t0Bad = true; break; }
        hp[t] = makeHint1(-scratch[t], w[i][t] - cs2[i][t] + scratch[t], alpha);
      }
    }
    if (t0Bad) continue;
    let hintCount = 0;
    for (let i = 0; i < s.k; i++) {
      const hp = h[i];
      for (let t = 0; t < 256; t++) hintCount += hp[t];
    }
    if (hintCount > s.omega) continue;

    return { set: s.name, s, sig: sigEncode(s, cTilde, z, h), cTilde, rounds, hintCount, rnd };
  }
}

/** ML-DSA.Sign（Alg 2）：M′ = 0x00‖len(ctx)‖ctx‖M（FIPS 204 §5.4）再进 Alg 7。 */
export function mldsaSignBytes(setKey, skHex, msg, ctx, rnd) {
  ctx = ctx == null ? new Uint8Array(0) : ctx;
  return mldsaSignInternalBytes(setKey, skHex, formatMessage(msg, ctx), rnd);
}

/**
 * ML-DSA.Verify_internal（Alg 8）：输入已是格式化消息 M′。
 * ACVP sigVer 向量即此层语义。结构非法（长度/偏移/hint 编码）不抛错，
 * 返回 valid:false + reason（FIPS 204 §7.2 语义）。
 */
export function mldsaVerifyInternalBytes(setKey, pkHex, mPrime, sigHex) {
  const s = getSet(setKey);
  const pk = hexToBytes(pkHex);
  const sig = hexToBytes(sigHex);
  const detail = { sigLen: sig.length, expectedSigLen: s.sigLen, pkLen: pk.length, expectedPkLen: s.pkLen };

  let rho, t1, cTilde, z, h, hintCount;
  try {
    ({ rho, t1 } = pkDecode(s, pk));
    ({ cTilde, z, h, hintCount } = sigDecode(s, sig));
  } catch (e) {
    return { valid: false, reason: e.message, ...detail };
  }
  detail.hintCount = hintCount;
  if (hintCount > s.omega) return { valid: false, reason: "hint 数超 ω 上限", ...detail };

  let zMax = 0;
  for (const f of z) for (let t = 0; t < 256; t++) {
    const a = absCentered(f[t]);
    if (a > zMax) zMax = a;
  }
  detail.zMax = zMax;
  detail.zBound = s.gamma1 - s.beta;
  if (zMax >= s.gamma1 - s.beta) return { valid: false, reason: "‖z‖∞ 超界（≥ γ1−β）", ...detail };

  const A = expandA(s, rho);
  const tr = shake256(pk, 64);
  const mu = shake256(concatBytes(tr, mPrime), 64);
  const cHat = nttOf(sampleInBall(cTilde, s.tau));
  const zHat = z.map(nttOf);
  const alpha = 2 * s.gamma2;

  // w′_approx = INTT(Â·ẑ − ĉ·2^d·t̂1)，w′1 = UseHint(h, w′_approx, 2γ2)
  const w1p = [];
  const acc = new Int32Array(256);
  const t1w = new Int32Array(256);
  for (let i = 0; i < s.k; i++) {
    acc.fill(0);
    for (let j = 0; j < s.l; j++) addPwInto(acc, A[i][j], zHat[j]);
    for (let t = 0; t < 256; t++) t1w[t] = t1[i][t] << D; // t1 ≤ 2^10−1 → 乘积 ≤ q−1
    ntt(t1w);
    for (let t = 0; t < 256; t++) {
      let x = acc[t] - redc(cHat[t] * t1w[t]);
      if (x < 0) x += Q;
      acc[t] = x;
    }
    intt(acc);
    const hi = new Int32Array(256);
    for (let t = 0; t < 256; t++) hi[t] = useHint1(h[i][t], acc[t], alpha);
    w1p.push(hi);
  }
  const c2 = shake256(concatBytes(mu, w1Encode(s, w1p)), s.ctLen);
  const valid = bytesEqual(cTilde, c2);
  return { valid, reason: valid ? "c̃ 重算一致（Fiat–Shamir 挑战匹配）" : "c̃ 重算不符（挑战不匹配）", ...detail };
}

/** ML-DSA.Verify（Alg 3）：M′ = 0x00‖len(ctx)‖ctx‖M（FIPS 204 §5.4）再进 Alg 8。 */
export function mldsaVerifyBytes(setKey, pkHex, msg, ctx, sigHex) {
  ctx = ctx == null ? new Uint8Array(0) : ctx;
  return mldsaVerifyInternalBytes(setKey, pkHex, formatMessage(msg, ctx), sigHex);
}

// ============================================================
// op 包装
// ============================================================

const SET_OPTIONS = [
  { value: "44", label: "ML-DSA-44 (L2)" },
  { value: "65", label: "ML-DSA-65 (L3)" },
  { value: "87", label: "ML-DSA-87 (L5)" },
];
const MSG_MODE_OPTIONS = [
  { value: "text", label: "文本 (UTF-8)" },
  { value: "hex", label: "Hex" },
];
const ENC = new TextEncoder();

function setSummary(s) {
  const g2 = s.gamma2 === 95232 ? "(q-1)/88" : "(q-1)/32";
  const g1 = s.gamma1 === 131072 ? "2^17" : "2^19";
  return `参数集: ML-DSA-${s.name} (k=${s.k}, l=${s.l}, η=${s.eta}, τ=${s.tau}, γ1=${g1}, γ2=${g2}, ω=${s.omega}, β=${s.beta})`;
}

register({
  id: "mldsaKeyGen",
  family: "mldsa", familyLabel: "keygen",
  cat: "asym",
  name: "ML-DSA 密钥生成",
  desc: "FIPS 204 ML-DSA-44/65/87（后量子签名）密钥对生成，种子 ξ 可固定复现（FIPS 204 §6.1 种子扩展），纯 JS 实现毫秒级",
  params: [
    { key: "set", label: "参数集", type: "select", default: "65", options: SET_OPTIONS },
    { sensitive: true, key: "zeta", label: "种子 ξ (hex 32B，留空随机)", type: "text", default: "", placeholder: "教学复现可固定" },
  ],
  run: (t, p = {}) => {
    const r = mldsaKeyGenBytes(p.set, p.zeta);
    return {
      text: [
        setSummary(r.s),
        `公钥 pk (${r.pk.length} B / ${r.pk.length * 8} bit，= ρ‖t1):`,
        bytesToHex(r.pk),
        `私钥 sk (${r.sk.length} B，= ρ‖K‖tr‖s1‖s2‖t0):`,
        bytesToHex(r.sk),
        `种子 ξ: ${bytesToHex(r.zeta)}`,
        "",
        "公钥 pk / 私钥 sk 已分开生成：sk ⚠ 敏感请妥善保管。点击下方按钮下载（hex 文本，可直接粘回签名/验签）。",
      ].join("\n"),
      files: [
        { name: `mldsa${r.set}_pk.hex`, mime: "text/plain", bytes: ENC.encode(bytesToHex(r.pk) + "\n") },
        { name: `mldsa${r.set}_sk.hex`, mime: "text/plain", bytes: ENC.encode(bytesToHex(r.sk) + "\n") },
      ],
    };
  },
});

register({
  id: "mldsaSign",
  acceptsBytes: true,
  family: "mldsa", familyLabel: "sign",
  cat: "asym",
  name: "ML-DSA 签名",
  desc: "FIPS 204 签名：私钥 sk + 消息（text/hex）+ 上下文 ctx(≤255B)；hedged 随机 rnd（§5.4 推荐）或确定性 rnd=0；Fiat–Shamir with aborts",
  params: [
    { key: "set", label: "参数集", type: "select", default: "65", options: SET_OPTIONS },
    { sensitive: true, key: "sk", label: "私钥 sk (hex)", type: "textarea", default: "", placeholder: "密钥生成输出的 sk hex" },
    { key: "ctx", label: "上下文 ctx (≤255B，默认空)", type: "text", default: "", placeholder: "FIPS 204 §5.4 域分隔上下文" },
    { key: "rndMode", label: "随机性模式", type: "select", default: "hedged", options: [
      { value: "hedged", label: "随机 rnd（hedged，推荐）" },
      { value: "det", label: "确定性 rnd=0（可复现）" },
    ] },
    { key: "rnd", label: "rand (hex 32B，留空随机；rnd=0 模式忽略)", type: "text", default: "", placeholder: "教学复现可固定" },
  ],
  run: (t, p = {}) => {
    if (p && p.msgMode != null && String(p.msgMode).toLowerCase() !== "text") {
      throw new Error("msgMode 该参数已废弃，请改用输入视图");
    }
    const raw = rawBytesOf(p);
    const msg = raw != null ? raw : messageBytes(t, "text");
    const ctx = ctxBytes(p.ctx);
    const rnd = p.rndMode === "det" ? new Uint8Array(32) : (String(p.rnd == null ? "" : p.rnd).trim() === "" ? null : p.rnd);
    const r = mldsaSignBytes(p.set, p.sk, msg, ctx, rnd);
    return {
      text: [
        setSummary(r.s),
        `消息 M: ${msg.length} B（UTF-8）`,
        `上下文 ctx: ${ctx.length} B`,
        `随机性 rnd: ${bytesToHex(r.rnd)}${p.rndMode === "det" ? "（确定性 rnd=0）" : ""}`,
        `拒绝采样轮数: ${r.rounds}（Fiat–Shamir with aborts）`,
        `签名 σ (${r.sig.length} B = c̃${r.cTilde.length} + z${r.s.l * 32 * r.s.zBits} + h${r.s.omega + r.s.k}):`,
        bytesToHex(r.sig),
        `挑战 c̃ (${r.cTilde.length} B): ${bytesToHex(r.cTilde)}`,
        `hint 数: ${r.hintCount}/${r.s.omega}`,
      ].join("\n"),
      files: [
        { name: `mldsa${r.set}.sig`, mime: "application/octet-stream", bytes: r.sig },
      ],
    };
  },
});

register({
  id: "mldsaVerify",
  acceptsBytes: true,
  family: "mldsa", familyLabel: "verify",
  cat: "asym",
  name: "ML-DSA 验签",
  desc: "FIPS 204 验签：pk + 消息 + 签名 → 合法/不合法（含 sigDecode 严格结构检查、‖z‖∞ 与 hint 上限校验、c̃ 重算比对）",
  params: [
    { key: "set", label: "参数集", type: "select", default: "65", options: SET_OPTIONS },
    { key: "pk", label: "公钥 pk (hex)", type: "text", default: "", placeholder: "密钥生成输出的 pk hex" },
    { key: "sig", label: "签名 σ (hex)", type: "text", default: "", placeholder: "签名输出的 σ hex" },
    { key: "ctx", label: "上下文 ctx (≤255B，须与签名一致)", type: "text", default: "", placeholder: "FIPS 204 §5.4 域分隔上下文" },
  ],
  run: (t, p = {}) => {
    if (p && p.msgMode != null && String(p.msgMode).toLowerCase() !== "text") {
      throw new Error("msgMode 该参数已废弃，请改用输入视图");
    }
    const raw = rawBytesOf(p);
    const msg = raw != null ? raw : messageBytes(t, "text");
    const ctx = ctxBytes(p.ctx);
    const r = mldsaVerifyBytes(p.set, p.pk, msg, ctx, p.sig);
    const lines = [
      setSummary(getSet(p.set)),
      `消息 M: ${msg.length} B（UTF-8），ctx: ${ctx.length} B`,
      `签名长度: ${r.sigLen}/${r.expectedSigLen} B ${r.sigLen === r.expectedSigLen ? "✓" : "✗"}`,
    ];
    if (r.hintCount != null) lines.push(`hint 数: ${r.hintCount}`);
    if (r.zMax != null) lines.push(`‖z‖∞ = ${r.zMax}（上限 γ1−β = ${r.zBound}）`);
    lines.push(`结论: ${r.valid ? "✓ 合法（验证通过）" : "✗ 不合法"} — ${r.reason}`);
    return { text: lines.join("\n") };
  },
});
