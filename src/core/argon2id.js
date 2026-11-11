/*
 * argon2id.js — 纯 JS Argon2id 密钥派生（RFC 9106）。
 *
 * 用途：想曰 XiangYue format1 默认密码路径的 master_key 派生
 * （t=2, m=64MiB, p=1, tagLen=64, version=0x13）。
 * 无 WASM、无第三方，纯前端可审计；压缩函数用 Uint32 lo/hi 精确 64 位运算。
 *
 * 自包含：内置精简 BLAKE2b（变长 1..64 输出）+ Argon2 压缩函数 G
 * 不依赖注册表 / hashExt，可离线 node 单测。
 *
 * 权威向量（argon2-cffi 25.1.0, version=19）：
 * password/somesalt12345678 t=2 m=256 p=1 len=32 →
 * 8110e1165eb0e1114ee37d5ff017573ba0084b8366b4108db44749954b8d9871
 * 同上 p=2 → 08e29c1f9052d73937049de3224a2f7fd5f6e6ad3c0f403dda21b447588bdbb6
 * 想曰默认密码 salt=00..0f t=2 m=65536 p=1 len=64 →
 * aa4ad84a...8a569ca0
 *
 * 参考：RFC 9106（Argon2）、RFC 7693（BLAKE2）。
 */

const M64 = (1n << 64n) - 1n;

// ============ 精简 BLAKE2b（变长输出 1..64，无 key；BigInt 精确） ============
const B2B_IV = [
  0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];
const B2B_SIGMA = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
  [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
  [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
  [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
  [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
  [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
  [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
  [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
  [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];
const rotr64 = (x, n) => (((x >> BigInt(n)) | (x << BigInt(64 - n))) & M64);

function b2bG(v, a, b, c, d, x, y) {
  v[a] = (v[a] + v[b] + x) & M64;
  v[d] = rotr64(v[d] ^ v[a], 32);
  v[c] = (v[c] + v[d]) & M64;
  v[b] = rotr64(v[b] ^ v[c], 24);
  v[a] = (v[a] + v[b] + y) & M64;
  v[d] = rotr64(v[d] ^ v[a], 16);
  v[c] = (v[c] + v[d]) & M64;
  v[b] = rotr64(v[b] ^ v[c], 63);
}

function b2bCompress(h, block, t, last) {
  const v = new Array(16);
  for (let i = 0; i < 8; i++) v[i] = h[i];
  for (let i = 0; i < 8; i++) v[i + 8] = B2B_IV[i];
  v[12] ^= t & M64;
  v[13] ^= (t >> 64n) & M64;
  if (last) v[14] ^= M64;
  const m = new Array(16);
  for (let i = 0; i < 16; i++) {
    const o = i * 8;
    m[i] = BigInt(block[o]) | (BigInt(block[o + 1]) << 8n) | (BigInt(block[o + 2]) << 16n) | (BigInt(block[o + 3]) << 24n) |
      (BigInt(block[o + 4]) << 32n) | (BigInt(block[o + 5]) << 40n) | (BigInt(block[o + 6]) << 48n) | (BigInt(block[o + 7]) << 56n);
  }
  for (let r = 0; r < 12; r++) {
    const s = B2B_SIGMA[r];
    b2bG(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
    b2bG(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
    b2bG(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
    b2bG(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
    b2bG(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
    b2bG(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
    b2bG(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
    b2bG(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
  }
  for (let i = 0; i < 8; i++) h[i] = (h[i] ^ v[i] ^ v[i + 8]) & M64;
}

// BLAKE2b(input) → Uint8Array(outLen)，outLen 1..64
function blake2b(input, outLen = 64) {
  if (outLen < 1 || outLen > 64) throw new Error("blake2b outLen 1..64");
  const h = B2B_IV.slice();
  h[0] ^= 0x01010000n ^ BigInt(outLen);
  let t = 0n, off = 0;
  const total = input.length;
  while (total - off > 128) {
    b2bCompress(h, input.subarray(off, off + 128), (t += 128n), false);
    off += 128;
  }
  const last = new Uint8Array(128);
  const rem = total - off;
  last.set(input.subarray(off));
  t += BigInt(rem);
  b2bCompress(h, last, t, true);
  const out = new Uint8Array(outLen);
  for (let i = 0; i < outLen; i++) out[i] = Number((h[i >> 3] >> BigInt((i & 7) * 8)) & 0xFFn);
  return out;
}

// ============ 变长哈希 H'（RFC 9106 §3.2） ============
function le32(n) {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}
function concat(...arrs) {
  let len = 0;
  for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
// H'^T(A)：变长哈希，输出 T 字节
function hprime(outLen, A) {
  const input = concat(le32(outLen), A);
  if (outLen <= 64) return blake2b(input, outLen);
  const r = Math.ceil(outLen / 32) - 2;
  const out = new Uint8Array(outLen);
  let V = blake2b(input, 64);
  out.set(V.subarray(0, 32), 0);
  for (let i = 1; i < r; i++) {
    V = blake2b(V, 64);
    out.set(V.subarray(0, 32), i * 32);
  }
  const lastLen = outLen - 32 * r;
  V = blake2b(V, lastLen);
  out.set(V.subarray(0, lastLen), 32 * r);
  return out;
}

// ============ Argon2 压缩函数 G（RFC 9106 §3.5–3.6） ============
// 内存块 = 128 个 uint64 = 256 个 uint32（lo/hi）。全部用 Number 精确运算。
const A2_U32 = 4294967296;
let _mlo = 0, _mhi = 0;

// (x*y*2) mod 2^64 → _mlo/_mhi，x/y 为 uint32，16 位拆分避免 53 位溢出
function mulDbl(x, y) {
  const xh = x >>> 16, xl = x & 0xffff, yh = y >>> 16, yl = y & 0xffff;
  const p0 = xl * yl;
  const p1 = xl * yh + xh * yl;
  const p2 = xh * yh;
  const ls = p0 + (p1 & 0xffff) * 65536;
  const lo = ls >>> 0;
  const hi = (p2 + ((p1 / 65536) | 0) + (ls >= A2_U32 ? 1 : 0)) >>> 0;
  const d = lo * 2;
  _mlo = d >>> 0;
  _mhi = (hi * 2 + (d >= A2_U32 ? 1 : 0)) >>> 0;
}

// floor(x*y / 2^32)，x/y 为 uint32（RFC §3.4.2 平方映射，避免 BigInt）
function mulHi32(x, y) {
  const xh = x >>> 16, xl = x & 0xffff, yh = y >>> 16, yl = y & 0xffff;
  const p0 = xl * yl;
  const p1 = xl * yh + xh * yl;
  const p2 = xh * yh;
  const ls = p0 + (p1 & 0xffff) * 65536;
  return (p2 + ((p1 / 65536) | 0) + (ls >= A2_U32 ? 1 : 0)) >>> 0;
}

// Argon2 GB（RFC 9106 §3.5，含 2*lo*lo 乘法项）。v: Uint32Array，参数为 uint32 偏移。
function gb(v, ai, bi, ci, di) {
  let alo = v[ai], ahi = v[ai + 1];
  let blo = v[bi], bhi = v[bi + 1];
  let clo = v[ci], chi = v[ci + 1];
  let dlo = v[di], dhi = v[di + 1];
  let tlo, thi, s;

  mulDbl(alo, blo);
  s = alo + blo + _mlo;
  alo = s >>> 0; ahi = (ahi + bhi + _mhi + ((s / A2_U32) | 0)) >>> 0;
  tlo = (dlo ^ alo) >>> 0; thi = (dhi ^ ahi) >>> 0;
  dlo = thi; dhi = tlo;

  mulDbl(clo, dlo);
  s = clo + dlo + _mlo;
  clo = s >>> 0; chi = (chi + dhi + _mhi + ((s / A2_U32) | 0)) >>> 0;
  tlo = (blo ^ clo) >>> 0; thi = (bhi ^ chi) >>> 0;
  blo = ((tlo >>> 24) | (thi << 8)) >>> 0;
  bhi = ((thi >>> 24) | (tlo << 8)) >>> 0;

  mulDbl(alo, blo);
  s = alo + blo + _mlo;
  alo = s >>> 0; ahi = (ahi + bhi + _mhi + ((s / A2_U32) | 0)) >>> 0;
  tlo = (dlo ^ alo) >>> 0; thi = (dhi ^ ahi) >>> 0;
  dlo = ((tlo >>> 16) | (thi << 16)) >>> 0;
  dhi = ((thi >>> 16) | (tlo << 16)) >>> 0;

  mulDbl(clo, dlo);
  s = clo + dlo + _mlo;
  clo = s >>> 0; chi = (chi + dhi + _mhi + ((s / A2_U32) | 0)) >>> 0;
  tlo = (blo ^ clo) >>> 0; thi = (bhi ^ chi) >>> 0;
  blo = ((tlo << 1) | (thi >>> 31)) >>> 0;
  bhi = ((thi << 1) | (tlo >>> 31)) >>> 0;

  v[ai] = alo; v[ai + 1] = ahi;
  v[bi] = blo; v[bi + 1] = bhi;
  v[ci] = clo; v[ci + 1] = chi;
  v[di] = dlo; v[di + 1] = dhi;
}

// BLAKE2 轮排列 P：行模式（连续 16 字）与列模式（跨行取寄存器对）
function p16Row(v, base) {
  gb(v, base, base + 8, base + 16, base + 24);
  gb(v, base + 2, base + 10, base + 18, base + 26);
  gb(v, base + 4, base + 12, base + 20, base + 28);
  gb(v, base + 6, base + 14, base + 22, base + 30);
  gb(v, base, base + 10, base + 20, base + 30);
  gb(v, base + 2, base + 12, base + 22, base + 24);
  gb(v, base + 4, base + 14, base + 16, base + 26);
  gb(v, base + 6, base + 8, base + 18, base + 28);
}
function p16Col(v, base) {
  gb(v, base, base + 64, base + 128, base + 192);
  gb(v, base + 2, base + 66, base + 130, base + 194);
  gb(v, base + 32, base + 96, base + 160, base + 224);
  gb(v, base + 34, base + 98, base + 162, base + 226);
  gb(v, base, base + 66, base + 160, base + 226);
  gb(v, base + 2, base + 96, base + 162, base + 192);
  gb(v, base + 32, base + 98, base + 128, base + 194);
  gb(v, base + 34, base + 64, base + 130, base + 224);
}

const _Q = new Uint32Array(256);

// Argon2 压缩函数 G(X,Y)（RFC 9106 §3.6）：行 8 次 P + 列 8 次 P，Z = Q ^ R。
// out 同时暂存 R；调用方保证 out 与 x/y 不重叠。
function blockG(x, xo, y, yo, out, oo) {
  const q = _Q;
  for (let i = 0; i < 256; i++) {
    const r = (x[xo + i] ^ y[yo + i]) >>> 0;
    q[i] = r; out[oo + i] = r;
  }
  for (let row = 0; row < 8; row++) p16Row(q, row * 32);
  for (let c = 0; c < 8; c++) p16Col(q, c * 4);
  for (let i = 0; i < 256; i++) out[oo + i] = (q[i] ^ out[oo + i]) >>> 0;
}

// 1024 字节 → 内存块（128 字小端装载）
function bytesToBlock(b, mem, off) {
  for (let j = 0; j < 128; j++) {
    const o = j * 8;
    const lo = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
    const hi = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) >>> 0;
    mem[off + 2 * j] = lo; mem[off + 2 * j + 1] = hi;
  }
}
// 内存块 → 1024 字节（小端）
function blockToBytes(mem, off) {
  const out = new Uint8Array(1024);
  for (let j = 0; j < 128; j++) {
    const lo = mem[off + 2 * j], hi = mem[off + 2 * j + 1];
    const o = j * 8;
    out[o] = lo & 0xff; out[o + 1] = (lo >>> 8) & 0xff;
    out[o + 2] = (lo >>> 16) & 0xff; out[o + 3] = (lo >>> 24) & 0xff;
    out[o + 4] = hi & 0xff; out[o + 5] = (hi >>> 8) & 0xff;
    out[o + 6] = (hi >>> 16) & 0xff; out[o + 7] = (hi >>> 24) & 0xff;
  }
  return out;
}

// ============ 主流程（RFC 9106 §3.2–3.4） ============
const TYPE_ARGON2ID = 2;
const VERSION = 0x13;

/**
 * 通用 Argon2 核心（argon2d/i/id），供本文件与 hashFrontier.js 共用。
 * 调用方负责参数校验；pwd/salt/secret/ad 均为 Uint8Array。
 * @param {object} o { type:0|1|2, t, m(KiB), p, tagLen }
 */
function argon2Kdf(pwd, salt, secret, ad, o) {
  const type = o.type, t = o.t, m = o.m, p = o.p, tagLen = o.tagLen;
  const mPrime = 4 * p * Math.floor(m / (4 * p));
  const laneLength = mPrime / p;          // q：每 lane 列数
  const segmentLength = laneLength / 4;   // 每段列数

  // H0 = BLAKE2b-512( p||tagLen||m||t||version||type || |P||P || |S||S || |K||K || |X||X )
  const H0 = blake2b(concat(
    le32(p), le32(tagLen), le32(m), le32(t), le32(VERSION), le32(type),
    le32(pwd.length), pwd,
    le32(salt.length), salt,
    le32(secret.length), secret,
    le32(ad.length), ad
  ), 64);

  const mem = new Uint32Array(mPrime * 256);
  for (let lane = 0; lane < p; lane++) {
    bytesToBlock(hprime(1024, concat(H0, le32(0), le32(lane))), mem, lane * laneLength * 256);
    bytesToBlock(hprime(1024, concat(H0, le32(1), le32(lane))), mem, (lane * laneLength + 1) * 256);
  }

  const ZERO = new Uint32Array(256);
  const INPUT = new Uint32Array(256), TMP = new Uint32Array(256), ADDR = new Uint32Array(256);

  for (let pass = 0; pass < t; pass++) {
    for (let slice = 0; slice < 4; slice++) {
      const dataIndep = (type === 1) || (type === 2 && pass === 0 && slice < 2);
      for (let lane = 0; lane < p; lane++) {
        let counter = 0;
        const genAddr = () => {
          counter++;
          INPUT.fill(0);
          INPUT[0] = pass; INPUT[2] = lane; INPUT[4] = slice;
          INPUT[6] = mPrime; INPUT[8] = t; INPUT[10] = type; INPUT[12] = counter;
          blockG(ZERO, 0, INPUT, 0, TMP, 0);
          blockG(ZERO, 0, TMP, 0, ADDR, 0);
        };
        if (dataIndep && pass === 0 && slice === 0) genAddr();

        const startCol = (pass === 0 && slice === 0) ? 2 : slice * segmentLength;
        const endCol = (slice + 1) * segmentLength;
        const laneBase = lane * laneLength;

        for (let col = startCol; col < endCol; col++) {
          const idx = col - slice * segmentLength;

          let J1, J2;
          if (dataIndep) {
            if (idx % 128 === 0) genAddr();
            const w = idx % 128;
            J1 = ADDR[2 * w]; J2 = ADDR[2 * w + 1];
          } else {
            const prevOff = (laneBase + ((col - 1 + laneLength) % laneLength)) * 256;
            J1 = mem[prevOff]; J2 = mem[prevOff + 1];
          }

          let refLane;
          if (pass === 0 && slice === 0) refLane = lane;
          else refLane = J2 % p;

          let refAreaSize;
          if (pass === 0) {
            if (slice === 0) refAreaSize = idx - 1;
            else if (refLane === lane) refAreaSize = slice * segmentLength + idx - 1;
            else refAreaSize = slice * segmentLength - (idx === 0 ? 1 : 0);
          } else {
            if (refLane === lane) refAreaSize = laneLength - segmentLength + idx - 1;
            else refAreaSize = laneLength - segmentLength - (idx === 0 ? 1 : 0);
          }
          if (refAreaSize < 1) refAreaSize = 1;

          // 平方映射（RFC §3.4.2），64 位高位用 16 位拆分精确计算
          const x = mulHi32(J1, J1);
          const relPos = refAreaSize - 1 - mulHi32(refAreaSize, x);
          const startPos = (pass === 0) ? 0 : ((slice === 3) ? 0 : (slice + 1) * segmentLength);
          const absPos = (startPos + relPos) % laneLength;

          const prevOff = (laneBase + ((col - 1 + laneLength) % laneLength)) * 256;
          const refOff = (refLane * laneLength + absPos) * 256;
          const outOff = (laneBase + col) * 256;

          blockG(mem, prevOff, mem, refOff, TMP, 0);
          if (pass === 0) {
            mem.set(TMP, outOff);
          } else {
            for (let i = 0; i < 256; i++) mem[outOff + i] = (mem[outOff + i] ^ TMP[i]) >>> 0;
          }
        }
      }
    }
  }

  const C = new Uint32Array(256);
  for (let lane = 0; lane < p; lane++) {
    const off = (lane * laneLength + laneLength - 1) * 256;
    for (let i = 0; i < 256; i++) C[i] = (C[i] ^ mem[off + i]) >>> 0;
  }
  return hprime(tagLen, blockToBytes(C, 0));
}

/**
 * Argon2id 派生。
 * @param {Uint8Array} pwd 口令字节
 * @param {Uint8Array} salt 盐字节
 * @param {object} o {t=时间, m=内存KiB, p=并行, tagLen=输出字节}
 * @returns {Uint8Array} tagLen 字节
 */
function argon2id(pwd, salt, o = {}) {
  const t = o.t == null ? 2 : o.t;
  const m = o.m == null ? 65536 : o.m;
  const p = o.p == null ? 1 : o.p;
  const tagLen = o.tagLen == null ? 64 : o.tagLen;
  const secret = new Uint8Array(0);
  const ad = new Uint8Array(0);
  if (!Number.isInteger(p) || p < 1) throw new Error(`Argon2id：并行度 p 须为 ≥1 的整数（当前 ${p}）`);
  if (!Number.isInteger(t) || t < 1) throw new Error(`Argon2id：迭代次数 t 须为 ≥1 的整数（当前 ${t}）`);
  if (!Number.isInteger(m) || m < 1) throw new Error(`Argon2id：内存 m 须为 ≥1 的整数（当前 ${m}）`);
  if (m < 8 * p) throw new Error(`Argon2id：内存 m 须 ≥ 8×p（当前 m=${m}, p=${p}）`);
  if (!(salt instanceof Uint8Array)) salt = new Uint8Array(salt || []);
  if (!Number.isInteger(tagLen) || tagLen < 4) throw new Error(`Argon2id：输出长度 tagLen 须为 ≥4 的整数（当前 ${tagLen}）`);
  return argon2Kdf(pwd, salt, secret, ad, { type: TYPE_ARGON2ID, t, m, p, tagLen });
}

export { argon2id, blake2b, argon2Kdf };
