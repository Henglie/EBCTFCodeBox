/*
 * argon2id.js — 纯 JS Argon2id 密钥派生（RFC 9106）。
 *
 * 用途：想曰 XiangYue format1 默认密码路径的 master_key 派生
 * （t=2, m=64MiB, p=1, tagLen=64, version=0x13）。
 * 无 WASM、无第三方，纯前端可审计；BigInt 精确 64 位运算，正确性优先。
 *
 * 自包含：内置精简 BLAKE2b（变长 1..64 输出）+ Argon2 压缩函数 G
 * 不依赖注册表 / hashExt，可离线 node 单测。
 *
 * 权威向量（argon2-cffi 25.1.0, version=19）：见 工具/rt_argon2_test.mjs：
 * password/somesalt12345678 t=2 m=256 p=1 len=32 →
 * 8110e1165eb0e1114ee37d5ff017573ba0084b8366b4108db44749954b8d9871
 * 同上 p=2 → 08e29c1f9052d73937049de3224a2f7fd5f6e6ad3c0f403dda21b447588bdbb6
 * 想曰默认密码 salt=00..0f t=2 m=65536 p=1 len=64 →
 * aa4ad84a...8a569ca0
 *
 * 参考：RFC 9106（Argon2）、RFC 7693（BLAKE2）。
 */

const M64 = (1n << 64n) - 1n;
const M32 = 0xFFFFFFFFn;

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
// 块用 128 个 BigInt（uint64 LE）表示。
const bytesToWords = (bytes, off) => {
  const w = new Array(128);
  for (let i = 0; i < 128; i++) {
    const o = off + i * 8;
    w[i] = BigInt(bytes[o]) | (BigInt(bytes[o + 1]) << 8n) | (BigInt(bytes[o + 2]) << 16n) | (BigInt(bytes[o + 3]) << 24n) |
      (BigInt(bytes[o + 4]) << 32n) | (BigInt(bytes[o + 5]) << 40n) | (BigInt(bytes[o + 6]) << 48n) | (BigInt(bytes[o + 7]) << 56n);
  }
  return w;
};
const wordsToBytes = (w) => {
  const out = new Uint8Array(1024);
  for (let i = 0; i < 128; i++) {
    let x = w[i];
    const o = i * 8;
    for (let j = 0; j < 8; j++) { out[o + j] = Number(x & 0xFFn); x >>= 8n; }
  }
  return out;
};

// Argon2 GB（含 2*aL*bL 乘法项）
function GB(v, a, b, c, d) {
  let va = v[a], vb = v[b], vc = v[c], vd = v[d];
  va = (va + vb + 2n * (va & M32) * (vb & M32)) & M64;
  vd = rotr64(vd ^ va, 32);
  vc = (vc + vd + 2n * (vc & M32) * (vd & M32)) & M64;
  vb = rotr64(vb ^ vc, 24);
  va = (va + vb + 2n * (va & M32) * (vb & M32)) & M64;
  vd = rotr64(vd ^ va, 16);
  vc = (vc + vd + 2n * (vc & M32) * (vd & M32)) & M64;
  vb = rotr64(vb ^ vc, 63);
  v[a] = va; v[b] = vb; v[c] = vc; v[d] = vd;
}
// 对 16 个 uint64 应用 BLAKE2 轮排列 P
function P(v) {
  GB(v, 0, 4, 8, 12); GB(v, 1, 5, 9, 13); GB(v, 2, 6, 10, 14); GB(v, 3, 7, 11, 15);
  GB(v, 0, 5, 10, 15); GB(v, 1, 6, 11, 12); GB(v, 2, 7, 8, 13); GB(v, 3, 4, 9, 14);
}

// G(X,Y)：X,Y,out 均为 128-uint64 数组。返回新数组。
function G(X, Y) {
  const R = new Array(128);
  for (let i = 0; i < 128; i++) R[i] = X[i] ^ Y[i];
  const Q = R.slice();
 // 行：每行 16 个字（连续）
  const t = new Array(16);
  for (let r = 0; r < 8; r++) {
    const base = r * 16;
    for (let i = 0; i < 16; i++) t[i] = Q[base + i];
    P(t);
    for (let i = 0; i < 16; i++) Q[base + i] = t[i];
  }
 // 列：列 c 取每行寄存器 c（每寄存器 2 字），k 行 → 字 k*16 + c*2 (+1)
  for (let c = 0; c < 8; c++) {
    for (let k = 0; k < 8; k++) {
      t[2 * k] = Q[k * 16 + c * 2];
      t[2 * k + 1] = Q[k * 16 + c * 2 + 1];
    }
    P(t);
    for (let k = 0; k < 8; k++) {
      Q[k * 16 + c * 2] = t[2 * k];
      Q[k * 16 + c * 2 + 1] = t[2 * k + 1];
    }
  }
  const Z = new Array(128);
  for (let i = 0; i < 128; i++) Z[i] = Q[i] ^ R[i];
  return Z;
}

// ============ 主流程（RFC 9106 §3.2–3.4） ============
const TYPE_ARGON2ID = 2;
const VERSION = 0x13;

/**
 * Argon2id 派生。
 * @param {Uint8Array} pwd 口令字节
 * @param {Uint8Array} salt 盐字节
 * @param {object} o {t=时间, m=内存KiB, p=并行, tagLen=输出字节}
 * @returns {Uint8Array} tagLen 字节
 */
function argon2id(pwd, salt, o = {}) {
  const t = o.t || 2;
  const m = o.m || 65536;      // KiB（=块数上限前）
  const p = o.p || 1;
  const tagLen = o.tagLen || 64;
  const secret = new Uint8Array(0);
  const ad = new Uint8Array(0);

 // 内存块数取整：m' = 4*p*floor(m/(4p))
  const mPrime = 4 * p * Math.floor(m / (4 * p));
  const laneLength = mPrime / p;          // q：每 lane 列数
  const segmentLength = laneLength / 4;   // 每段列数

 // H0 = BLAKE2b-512( p||tagLen||m||t||version||type || |P||P || |S||S || |K||K || |X||X )
  const H0 = blake2b(concat(
    le32(p), le32(tagLen), le32(m), le32(t), le32(VERSION), le32(TYPE_ARGON2ID),
    le32(pwd.length), pwd,
    le32(salt.length), salt,
    le32(secret.length), secret,
    le32(ad.length), ad
  ), 64);

 // 内存矩阵 B[lane][col]，每块 128 uint64
  const B = [];
  for (let i = 0; i < p; i++) B.push(new Array(laneLength));

 // 初始两列
  for (let i = 0; i < p; i++) {
    B[i][0] = bytesToWords(hprime(1024, concat(H0, le32(0), le32(i))), 0);
    B[i][1] = bytesToWords(hprime(1024, concat(H0, le32(1), le32(i))), 0);
  }

  const ZERO = new Array(128).fill(0n);

 // 填充
  for (let pass = 0; pass < t; pass++) {
    for (let slice = 0; slice < 4; slice++) {
 // Argon2id：pass0 且 slice<2 用数据无关（Argon2i）寻址
      const dataIndependent = (pass === 0 && slice < 2);

      for (let lane = 0; lane < p; lane++) {
 // 数据无关寻址（Argon2i 部分）的地址块状态：
 // input.v[6]=counter，每生成一次地址块 +1；地址值按“段内下标 idx % 128”取。
        let addrBlock = null, counter = 0n;
        const genAddr = () => {
          counter += 1n;
          const input = new Array(128).fill(0n);
          input[0] = BigInt(pass);
          input[1] = BigInt(lane);
          input[2] = BigInt(slice);
          input[3] = BigInt(mPrime);
          input[4] = BigInt(t);
          input[5] = BigInt(TYPE_ARGON2ID);
          input[6] = counter;
 // addressBlock = G(ZERO, G(ZERO, input))
          addrBlock = G(ZERO, G(ZERO, input));
        };
 // pass0/slice0 段内下标从 2 起，2%128≠0 不触发循环内生成 → 段首预生成一次
        if (dataIndependent && pass === 0 && slice === 0) genAddr();

        const startCol = (pass === 0 && slice === 0) ? 2 : slice * segmentLength;
        const endCol = (slice + 1) * segmentLength;

        for (let col = startCol; col < endCol; col++) {
          const idx = col - slice * segmentLength; // 段内 0 基位置

 // J1,J2
          let J1, J2;
          if (dataIndependent) {
            if (idx % 128 === 0) genAddr();
            const a = addrBlock[idx % 128];
            J1 = a & M32;
            J2 = (a >> 32n) & M32;
          } else {
            const prev = B[lane][(col - 1 + laneLength) % laneLength];
            J1 = prev[0] & M32;
            J2 = (prev[0] >> 32n) & M32;
          }

 // 参考 lane
          let refLane;
          if (pass === 0 && slice === 0) refLane = lane;
          else refLane = Number(J2 % BigInt(p));

 // 参考区大小
          let refAreaSize;
          if (pass === 0) {
            if (slice === 0) refAreaSize = idx - 1;
            else if (refLane === lane) refAreaSize = slice * segmentLength + idx - 1;
            else refAreaSize = slice * segmentLength - (idx === 0 ? 1 : 0);
          } else {
            if (refLane === lane) refAreaSize = laneLength - segmentLength + idx - 1;
            else refAreaSize = laneLength - segmentLength - (idx === 0 ? 1 : 0);
          }
          if (refAreaSize < 1) refAreaSize = 1; // 防御（首块 idx=1,slice0 → 0，此路径不会取）

 // 相对位置（RFC §3.4.2 平方映射）
          let x = (J1 * J1) >> 32n;
          let y = (BigInt(refAreaSize) * x) >> 32n;
          let relPos = BigInt(refAreaSize) - 1n - y;

 // 起始位置
          let startPos = 0n;
          if (!(pass === 0)) startPos = (slice === 3) ? 0n : BigInt((slice + 1) * segmentLength);
          const absPos = Number((startPos + relPos) % BigInt(laneLength));

          const prev = B[lane][(col - 1 + laneLength) % laneLength];
          const refBlock = B[refLane][absPos];
          const newBlock = G(prev, refBlock);

          if (pass === 0) {
            B[lane][col] = newBlock;
          } else {
 // version 0x13：与旧块异或
            const old = B[lane][col];
            for (let i = 0; i < 128; i++) newBlock[i] ^= old[i];
            B[lane][col] = newBlock;
          }
        }
      }
    }
  }

 // 最终：C = XOR 所有 lane 的最后一列，tag = H'^tagLen(C)
  const C = B[0][laneLength - 1].slice();
  for (let i = 1; i < p; i++) {
    const last = B[i][laneLength - 1];
    for (let j = 0; j < 128; j++) C[j] ^= last[j];
  }
  return hprime(tagLen, wordsToBytes(C));
}

export { argon2id, blake2b };
