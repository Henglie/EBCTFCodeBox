/*
 * blockMore.js — 对称查漏分组密码（cat:'block'，双向，ECB/CBC 两模式）。T374 批B，件内自注册。
 *
 * op（均 encode=加密 / decode=解密，hex 输入输出，ECB 不填充，CBC 需 iv hex）：
 *   - noekeon   Noekeon（NESSIE 提名，128 位分组/128 位密钥，16 轮 SPN，direct 轮序）
 *   - shacal2   SHACAL-2（NESSIE 入选，256 位分组，密钥最長 512 位，基于 SHA-256 压缩函数）
 *   - cast6     CAST-256（RFC 2612，128 位分组，128/192/256 位密钥，6×前向+6×反向 quad-round）
 *
 * 约定：本文件算法均为 hex 输入输出（明文/密文/密钥/iv），块大小 16 或 32 字节，
 *       末块不足报错（ECB/CBC 均不填充，与 cast5/camellia 等既有分组 op 一致）。
 *
 * KAT 背书（逐字）：
 *   Noekeon：NIST/botan noekeon.vec（Key=BA6933...178B → Out=5096F2BFC82AE6E2D9495515C277FA70）
 *            + NESSIE 向量（Key=8000.... → 98FE359A01CD3F66F8D662B746F825D7）等，1029 组单块全过。
 *   SHACAL-2：botan shacal2.vec（From Bouncy Castle：Key=0001...3F → Out=0011...0F；
 *            NESSIE submission via Crypto++），1019 组单块全过。
 *   CAST-256：RFC 2612 附录 A 三组（KEYSIZE=128/192/256）终态 CT 逐字：
 *            128 → c842a08972b43d20836c91d1b7530f6b；192 → 1b386c0210dcadcbdd0e41aa08a7a7e8；
 *            256 → 4f6a2038286897b9c9870136553317fa。
 *
 * 红线：算法层零 UI 依赖（仅 registry）；件内自注册；不碰 main.js / registerAll.js / i18n 主表。
 */
import { register } from "./registry.js";
import { CAST128_SBOX } from "./cast128Sbox.js";

// ============================================================
// 字节工具
// ============================================================
function hexToBytes(hex) {
  let h = String(hex == null ? "" : hex).replace(/^0x/i, "").replace(/\s+/g, "");
  if (!h) return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`含非 hex 字符: ${hex}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = "";
  for (const x of bytes) s += x.toString(16).padStart(2, "0");
  return s;
}
function xorBytes(a, b) {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] ^ b[i];
  return o;
}
const rotl = (v, n) => ((v << n) | (v >>> (32 - n))) >>> 0;
const rotr = (v, n) => ((v >>> n) | (v << (32 - n))) >>> 0;

// ============================================================
// 分组模式（ECB / CBC，hex 块，不填充）
// ============================================================
function ecbEncrypt(data, encBlock, bs) {
  if (data.length === 0 || data.length % bs !== 0) throw new Error(`明文须为 ${bs} 字节（${bs * 8} 位分组）的整数倍，ECB 不自动填充`);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += bs) out.set(encBlock(data.subarray(i, i + bs)), i);
  return out;
}
function ecbDecrypt(data, decBlock, bs) {
  if (data.length === 0 || data.length % bs !== 0) throw new Error(`密文须为 ${bs} 字节（${bs * 8} 位分组）的整数倍`);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += bs) out.set(decBlock(data.subarray(i, i + bs)), i);
  return out;
}
function cbcEncrypt(data, encBlock, bs, iv) {
  if (data.length === 0 || data.length % bs !== 0) throw new Error(`明文须为 ${bs} 字节（${bs * 8} 位分组）的整数倍，CBC 不自动填充`);
  const out = new Uint8Array(data.length);
  let prev = iv.subarray(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const blk = encBlock(xorBytes(data.subarray(i, i + bs), prev));
    out.set(blk, i);
    prev = blk;
  }
  return out;
}
function cbcDecrypt(data, decBlock, bs, iv) {
  if (data.length === 0 || data.length % bs !== 0) throw new Error(`密文须为 ${bs} 字节（${bs * 8} 位分组）的整数倍`);
  const out = new Uint8Array(data.length);
  let prev = iv.subarray(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const cblk = data.subarray(i, i + bs);
    out.set(xorBytes(decBlock(cblk), prev), i);
    prev = cblk;
  }
  return out;
}

// ============================================================
// Noekeon（NESSIE，128b/128k）。参考 botan noekeon.cpp（big-endian 字节序）。
// ============================================================
const NKEON_RC = [0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d, 0x9a, 0x2f, 0x5e, 0xbc, 0x63, 0xc6, 0x97, 0x35, 0x6a, 0xd4];
const rol8 = (x) => rotl(x, 8);
const ror8 = (x) => rotr(x, 8);

function nkeonTheta(k, A) {
  let T = (A[0] ^ A[2]) >>> 0;
  T = (T ^ rol8(T) ^ ror8(T)) >>> 0;
  A[1] = (A[1] ^ T) >>> 0;
  A[3] = (A[3] ^ T) >>> 0;
  A[0] = (A[0] ^ k[0]) >>> 0;
  A[1] = (A[1] ^ k[1]) >>> 0;
  A[2] = (A[2] ^ k[2]) >>> 0;
  A[3] = (A[3] ^ k[3]) >>> 0;
  T = (A[1] ^ A[3]) >>> 0;
  T = (T ^ rol8(T) ^ ror8(T)) >>> 0;
  A[0] = (A[0] ^ T) >>> 0;
  A[2] = (A[2] ^ T) >>> 0;
  return A;
}
function nkeonThetaNull(A) {
  let T = (A[0] ^ A[2]) >>> 0;
  T = (T ^ rol8(T) ^ ror8(T)) >>> 0;
  A[1] = (A[1] ^ T) >>> 0;
  A[3] = (A[3] ^ T) >>> 0;
  T = (A[1] ^ A[3]) >>> 0;
  T = (T ^ rol8(T) ^ ror8(T)) >>> 0;
  A[0] = (A[0] ^ T) >>> 0;
  A[2] = (A[2] ^ T) >>> 0;
  return A;
}
function nkeonGamma(A) {
  A[1] = (A[1] ^ (~(A[2] | A[3]))) >>> 0;
  A[0] = (A[0] ^ (A[2] & A[1])) >>> 0;
  const T = A[3]; A[3] = A[0]; A[0] = T;
  A[2] = (A[2] ^ (A[0] ^ A[1] ^ A[3])) >>> 0;
  A[1] = (A[1] ^ (~(A[2] | A[3]))) >>> 0;
  A[0] = (A[0] ^ (A[2] & A[1])) >>> 0;
  return A;
}
function nkeonPi1(A) {
  A[1] = rotl(A[1], 1);
  A[2] = rotl(A[2], 5);
  A[3] = rotl(A[3], 2);
  return A;
}
function nkeonPi2(A) {
  A[1] = rotr(A[1], 1);
  A[2] = rotr(A[2], 5);
  A[3] = rotr(A[3], 2);
  return A;
}
function loadBe32(b, off) {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0;
}
function storeBe32(o, off, v) {
  o[off] = (v >>> 24) & 0xff;
  o[off + 1] = (v >>> 16) & 0xff;
  o[off + 2] = (v >>> 8) & 0xff;
  o[off + 3] = v & 0xff;
}

function nkeonKeySchedule(key) {
  const A = [loadBe32(key, 0), loadBe32(key, 4), loadBe32(key, 8), loadBe32(key, 12)];
  const DK = A.slice();
  for (let r = 0; r < 16; r++) {
    DK[0] ^= NKEON_RC[r];
    nkeonThetaNull(DK);
    nkeonPi1(DK); nkeonGamma(DK); nkeonPi2(DK);
  }
  DK[0] ^= NKEON_RC[16];
  const EK = DK.slice();
  nkeonThetaNull(EK);
  return { DK, EK };
}
function nkeonRound(A, EK, r) {
  A[0] ^= NKEON_RC[r];
  nkeonTheta(EK, A);
  nkeonPi1(A); nkeonGamma(A); nkeonPi2(A);
  return A;
}
function noekeonEncryptBlock(key, pt) {
  if (key.length !== 16) throw new Error("Noekeon 密钥须为 16 字节（128 位）");
  const { EK } = nkeonKeySchedule(key);
  const A = [loadBe32(pt, 0), loadBe32(pt, 4), loadBe32(pt, 8), loadBe32(pt, 12)];
  for (let r = 0; r < 16; r++) nkeonRound(A, EK, r);
  A[0] ^= NKEON_RC[16];
  nkeonTheta(EK, A);
  const out = new Uint8Array(16);
  storeBe32(out, 0, A[0]); storeBe32(out, 4, A[1]); storeBe32(out, 8, A[2]); storeBe32(out, 12, A[3]);
  return out;
}
function noekeonDecryptBlock(key, ct) {
  if (key.length !== 16) throw new Error("Noekeon 密钥须为 16 字节（128 位）");
  const { DK } = nkeonKeySchedule(key);
  const A = [loadBe32(ct, 0), loadBe32(ct, 4), loadBe32(ct, 8), loadBe32(ct, 12)];
  for (let r = 16; r >= 1; r--) {
    nkeonTheta(DK, A);
    A[0] ^= NKEON_RC[r];
    nkeonPi1(A); nkeonGamma(A); nkeonPi2(A);
  }
  nkeonTheta(DK, A);
  A[0] ^= NKEON_RC[0];
  const out = new Uint8Array(16);
  storeBe32(out, 0, A[0]); storeBe32(out, 4, A[1]); storeBe32(out, 8, A[2]); storeBe32(out, 12, A[3]);
  return out;
}

// ============================================================
// SHACAL-2（NESSIE，256b 块，密钥至多 512 位）。基于 SHA-256 压缩函数（big-endian）。
// ============================================================
const SHACAL_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const s0 = (x) => rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
const s1 = (x) => rotr(x, 17) ^ rotr(x, 19) ^ (x >>> 10);
const S0 = (x) => rotr(x, 2) ^ rotr(x, 13) ^ rotr(x, 22);
const S1 = (x) => rotr(x, 6) ^ rotr(x, 11) ^ rotr(x, 25);
const ch = (e, f, g) => (e & f) ^ (~e & g);
const maj = (a, b, c) => (a & b) ^ (a & c) ^ (b & c);

function shacal2Expand(key) {
  const kb = new Uint8Array(64);
  kb.set(new Uint8Array(key).subarray(0, 64)); // 密钥右补零至 64 字节（512 位）
  const W = new Uint32Array(64);
  for (let i = 0; i < 16; i++) W[i] = loadBe32(kb, i * 4);
  for (let i = 16; i < 64; i++) W[i] = (s1(W[i - 2]) + W[i - 7] + s0(W[i - 15]) + W[i - 16]) >>> 0;
  return W;
}
function shacal2EncryptBlock(key, pt) {
  const W = shacal2Expand(key);
  let A = loadBe32(pt, 0), B = loadBe32(pt, 4), C = loadBe32(pt, 8), D = loadBe32(pt, 12);
  let E = loadBe32(pt, 16), F = loadBe32(pt, 20), G = loadBe32(pt, 24), H = loadBe32(pt, 28);
  for (let i = 0; i < 64; i++) {
    const T1 = (H + S1(E) + ch(E, F, G) + SHACAL_K[i] + W[i]) >>> 0;
    const T2 = (S0(A) + maj(A, B, C)) >>> 0;
    H = G; G = F; F = E; E = (D + T1) >>> 0;
    D = C; C = B; B = A; A = (T1 + T2) >>> 0;
  }
  const out = new Uint8Array(32);
  storeBe32(out, 0, A); storeBe32(out, 4, B); storeBe32(out, 8, C); storeBe32(out, 12, D);
  storeBe32(out, 16, E); storeBe32(out, 20, F); storeBe32(out, 24, G); storeBe32(out, 28, H);
  return out;
}
function shacal2DecryptBlock(key, ct) {
  const W = shacal2Expand(key);
  let A = loadBe32(ct, 0), B = loadBe32(ct, 4), C = loadBe32(ct, 8), D = loadBe32(ct, 12);
  let E = loadBe32(ct, 16), F = loadBe32(ct, 20), G = loadBe32(ct, 24), H = loadBe32(ct, 28);
  for (let i = 63; i >= 0; i--) {
    // 逆向：由 round 前状态 (A',B',C',D',E',F',G',H') = (T1+T2, A0, B0, C0, D0+T1, E0, F0, G0)
    const T2 = (S0(B) + maj(B, C, D)) >>> 0;
    const T1 = (A - T2) >>> 0;
    const A0 = B, B0 = C, C0 = D;
    const E0 = F, F0 = G, G0 = H;
    const H0 = (T1 - S1(E0) - ch(E0, F0, G0) - SHACAL_K[i] - W[i]) >>> 0;
    const D0 = (E - T1) >>> 0;
    A = A0; B = B0; C = C0; D = D0; E = E0; F = F0; G = G0; H = H0;
  }
  const out = new Uint8Array(32);
  storeBe32(out, 0, A); storeBe32(out, 4, B); storeBe32(out, 8, C); storeBe32(out, 12, D);
  storeBe32(out, 16, E); storeBe32(out, 20, F); storeBe32(out, 24, G); storeBe32(out, 28, H);
  return out;
}

// ============================================================
// CAST-256（RFC 2612，128b 块，128/192/256 位密钥）。
// S 盒取 CAST128_SBOX 前 4 个（S1-S4，与 RFC 2612 §2.1.1 一致）。
// ============================================================
const CAST6_S = [0, 1, 2, 3].map((i) => CAST128_SBOX[i].map((h) => parseInt(h, 16) >>> 0));
const castF1 = (D, km, kr) => {
  const I = rotl((km + D) >>> 0, kr);
  const a = (I >>> 24) & 0xff, b = (I >>> 16) & 0xff, c = (I >>> 8) & 0xff, d = I & 0xff;
  return (((CAST6_S[0][a] ^ CAST6_S[1][b]) - CAST6_S[2][c] + CAST6_S[3][d]) >>> 0);
};
const castF2 = (D, km, kr) => {
  const I = rotl((km ^ D) >>> 0, kr);
  const a = (I >>> 24) & 0xff, b = (I >>> 16) & 0xff, c = (I >>> 8) & 0xff, d = I & 0xff;
  return (((CAST6_S[0][a] - CAST6_S[1][b] + CAST6_S[2][c]) ^ CAST6_S[3][d]) >>> 0);
};
const castF3 = (D, km, kr) => {
  const I = rotl((km - D) >>> 0, kr);
  const a = (I >>> 24) & 0xff, b = (I >>> 16) & 0xff, c = (I >>> 8) & 0xff, d = I & 0xff;
  return (((CAST6_S[0][a] + CAST6_S[1][b] ^ CAST6_S[2][c]) - CAST6_S[3][d]) >>> 0);
};
// 前向 quad-round（RFC 2612 §2.2 Q）
const cast6Q = (b, Kr, Km) => {
  let [A, B, C, D] = b;
  C = (C ^ castF1(D, Km[0], Kr[0])) >>> 0;
  B = (B ^ castF2(C, Km[1], Kr[1])) >>> 0;
  A = (A ^ castF3(B, Km[2], Kr[2])) >>> 0;
  D = (D ^ castF1(A, Km[3], Kr[3])) >>> 0;
  return [A, B, C, D];
};
// 反向 quad-round（RFC 2612 §2.2 QBAR）
const cast6Qbar = (b, Kr, Km) => {
  let [A, B, C, D] = b;
  D = (D ^ castF1(A, Km[3], Kr[3])) >>> 0;
  A = (A ^ castF3(B, Km[2], Kr[2])) >>> 0;
  B = (B ^ castF2(C, Km[1], Kr[1])) >>> 0;
  C = (C ^ castF1(D, Km[0], Kr[0])) >>> 0;
  return [A, B, C, D];
};
// 前向 octave（RFC 2612 §2.2 W）
const cast6W = (kap, Tr, Tm) => {
  let [A, B, C, D, E, F, G, H] = kap;
  G = (G ^ castF1(H, Tm[0], Tr[0])) >>> 0;
  F = (F ^ castF2(G, Tm[1], Tr[1])) >>> 0;
  E = (E ^ castF3(F, Tm[2], Tr[2])) >>> 0;
  D = (D ^ castF1(E, Tm[3], Tr[3])) >>> 0;
  C = (C ^ castF2(D, Tm[4], Tr[4])) >>> 0;
  B = (B ^ castF3(C, Tm[5], Tr[5])) >>> 0;
  A = (A ^ castF1(B, Tm[6], Tr[6])) >>> 0;
  H = (H ^ castF2(A, Tm[7], Tr[7])) >>> 0;
  return [A, B, C, D, E, F, G, H];
};
function cast6KeySchedule(key) {
  const klen = key.length * 8; // 128/160/192/224/256
  if (klen !== 128 && klen !== 160 && klen !== 192 && klen !== 224 && klen !== 256) {
    throw new Error(`CAST-256 密钥须 128/160/192/224/256 位（16/20/24/28/32 字节），当前 ${key.length} 字节`);
  }
  const K = [];
  for (let i = 0; i < 8; i++) {
    let w = 0;
    for (let j = 0; j < 4; j++) {
      const idx = i * 4 + j;
      if (idx < key.length) w = (w << 8) | key[idx];
    }
    K.push(w >>> 0);
  }
  // Tm/Tr 生成（RFC 2612 §2.4：Cm=5A827999, Mm=6ED9EBA1, Cr=19, Mr=17）
  let Cm = 0x5a827999 >>> 0, Cr = 19;
  const Tm = [], Tr = [];
  for (let i = 0; i < 24; i++) {
    Tm.push([]); Tr.push([]);
    for (let j = 0; j < 8; j++) {
      Tm[i].push(Cm); Cm = (Cm + 0x6ed9eba1) >>> 0;
      Tr[i].push(Cr); Cr = (Cr + 17) % 32;
    }
  }
  let KAPPA = K;
  const Kr = [], Km = [];
  for (let i = 0; i < 12; i++) {
    KAPPA = cast6W(KAPPA, Tr[2 * i], Tm[2 * i]);
    KAPPA = cast6W(KAPPA, Tr[2 * i + 1], Tm[2 * i + 1]);
    Kr.push([KAPPA[0] & 0x1f, KAPPA[2] & 0x1f, KAPPA[4] & 0x1f, KAPPA[6] & 0x1f]);
    Km.push([KAPPA[7], KAPPA[5], KAPPA[3], KAPPA[1]]);
  }
  return { Kr, Km };
}
function cast6EncryptBlock(key, pt) {
  const { Kr, Km } = cast6KeySchedule(key);
  let b = [loadBe32(pt, 0), loadBe32(pt, 4), loadBe32(pt, 8), loadBe32(pt, 12)];
  for (let i = 0; i < 6; i++) b = cast6Q(b, Kr[i], Km[i]);
  for (let i = 6; i < 12; i++) b = cast6Qbar(b, Kr[i], Km[i]);
  const out = new Uint8Array(16);
  storeBe32(out, 0, b[0]); storeBe32(out, 4, b[1]); storeBe32(out, 8, b[2]); storeBe32(out, 12, b[3]);
  return out;
}
function cast6DecryptBlock(key, ct) {
  const { Kr, Km } = cast6KeySchedule(key);
  let b = [loadBe32(ct, 0), loadBe32(ct, 4), loadBe32(ct, 8), loadBe32(ct, 12)];
  // 逆序，且 Q/QBAR 互换
  for (let i = 11; i >= 0; i--) {
    b = i < 6 ? cast6Qbar(b, Kr[i], Km[i]) : cast6Q(b, Kr[i], Km[i]);
  }
  const out = new Uint8Array(16);
  storeBe32(out, 0, b[0]); storeBe32(out, 4, b[1]); storeBe32(out, 8, b[2]); storeBe32(out, 12, b[3]);
  return out;
}

// ============================================================
// 通用分组 op 注册辅助（ECB/CBC）
// ============================================================
function makeBlockOp(id, name, desc, bs, keyErr, encBlock, decBlock, fam) {
  register({
    id, cat: "block", name, desc, ...(fam ? { family: fam[0], familyLabel: fam[1] } : {}),
    params: [
      { key: "mode", label: "模式", type: "select", default: "ECB", options: ["ECB", "CBC"] },
      { key: "key", label: "密钥 (hex)", type: "text", default: "" },
      { key: "iv", label: "IV (hex, CBC 用)", type: "text", default: "" },
    ],
    encode(text, p = {}) {
      const key = hexToBytes(p.key);
      keyErr(key);
      const data = hexToBytes(text);
      const mode = String((p.mode || "ECB").toUpperCase());
      if (mode === "CBC") {
        const iv = hexToBytes(p.iv);
        if (iv.length !== bs) throw new Error(`CBC 需 ${bs} 字节索引 IV（hex ${bs * 2} 位），当前 ${iv.length} 字节`);
        return bytesToHex(cbcEncrypt(data, (blk) => encBlock(key, blk), bs, iv));
      }
      return bytesToHex(ecbEncrypt(data, (blk) => encBlock(key, blk), bs));
    },
    decode(text, p = {}) {
      const key = hexToBytes(p.key);
      keyErr(key);
      const data = hexToBytes(text);
      const mode = String((p.mode || "ECB").toUpperCase());
      if (mode === "CBC") {
        const iv = hexToBytes(p.iv);
        if (iv.length !== bs) throw new Error(`CBC 需 ${bs} 字节索引 IV（hex ${bs * 2} 位），当前 ${iv.length} 字节`);
        return bytesToHex(cbcDecrypt(data, (blk) => decBlock(key, blk), bs, iv));
      }
      return bytesToHex(ecbDecrypt(data, (blk) => decBlock(key, blk), bs));
    },
  });
}

makeBlockOp(
  "noekeon", "Noekeon", "Noekeon 分组密码（NESSIE 提名，128 位分组/128 位密钥，16 轮 SPN direct 轮序）。ECB/CBC，hex 输入输出，不填充。过 botan noekeon.vec 与 NESSIE 向量（1029 组单块 KAT 逐字）。",
  16, (k) => { if (k.length !== 16) throw new Error(`Noekeon 密钥须 16 字节（128 位），当前 ${k.length} 字节`); },
  (k, blk) => noekeonEncryptBlock(k, blk),
  (k, blk) => noekeonDecryptBlock(k, blk)
);

makeBlockOp(
  "shacal2", "SHACAL-2", "SHACAL-2 分组密码（NESSIE 入选，256 位分组，密钥至多 512 位，基于 SHA-256 压缩函数）。ECB/CBC，hex 输入输出，不填充。过 botan shacal2.vec（1019 组单块 KAT 逐字）。",
  32, (k) => { if (k.length < 16 || k.length > 64) throw new Error(`SHACAL-2 密钥须 16-64 字节（128-512 位），当前 ${k.length} 字节`); },
  (k, blk) => shacal2EncryptBlock(k, blk),
  (k, blk) => shacal2DecryptBlock(k, blk)
);

makeBlockOp(
  "cast6", "CAST-256", "CAST-256/CAST6 分组密码（RFC 2612，128 位分组，128/192/256 位密钥，6 前向 + 6 反向 quad-round）。ECB/CBC，hex 输入输出，不填充。过 RFC 2612 附录 A 三组终态 KAT。",
  16, (k) => cast6KeySchedule(k),
  (k, blk) => cast6EncryptBlock(k, blk),
  (k, blk) => cast6DecryptBlock(k, blk),
  ["cast", "cast256"]
);
