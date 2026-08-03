/*
 * camellia.js — Camellia 分组密码（cat:'modern'，双向）。
 *
 * NTT/三菱 开发的 Camellia 分组密码（RFC 3713），NESSIE/CRYPTREC 推荐，128 位分组：
 *   - 128 位密钥 = 18 轮 Feistel；192/256 位 = 24 轮；FL/FLINV 每 6 轮插入一次。
 *   - F 函数：与 64 位子密钥异或 → 4 个 S 盒（SBOX2/3/4 由 SBOX1 旋转派生）→ P 线性层。
 *   - 密钥调度：KL||KR（192 位补 ~KR）→ F 混出 KA/KB → 对 KL/KR/KA/KB 循环左移取半得子密钥。
 *
 * 官方测试向量（RFC 3713 附录 C，已用 openssl 复现一致）：
 *   key=0123456789abcdeffedcba9876543210  pt=0123456789abcdeffedcba9876543210
 *     → 67673138549669730857065648eabe43（128）/ b4993401b3e996f84ee5cee7d79b09b9（192）
 *       / 9acc237dff16d76c20ef7c919e3a7509（256）
 *
 * 约定（与其它分组密码 op 一致）：encode=加密 decode=解密（明文/密文/密钥 hex，ECB 多块）；
 *   128 位分组 = 16 字节 = 32 hex，末块不足报错（ECB 不填充）。64 位运算用 BigInt。
 *
 * 红线：RFC 3713 原文实现不编造；S 盒照表抄；交付前过官方向量。core 零 UI 依赖。
 */
import { register } from "./registry.js";

const MASK64 = (1n << 64n) - 1n;
const MASK128 = (1n << 128n) - 1n;

// ============================================================
// SBOX1（RFC 3713 十进制表），SBOX2/3/4 由旋转派生
// ============================================================
const SBOX1 = Uint8Array.from([
  112,130, 44,236,179, 39,192,229,228,133, 87, 53,234, 12,174, 65,
   35,239,107,147, 69, 25,165, 33,237, 14, 79, 78, 29,101,146,189,
  134,184,175,143,124,235, 31,206, 62, 48,220, 95, 94,197, 11, 26,
  166,225, 57,202,213, 71, 93, 61,217,  1, 90,214, 81, 86,108, 77,
  139, 13,154,102,251,204,176, 45,116, 18, 43, 32,240,177,132,153,
  223, 76,203,194, 52,126,118,  5,109,183,169, 49,209, 23,  4,215,
   20, 88, 58, 97,222, 27, 17, 28, 50, 15,156, 22, 83, 24,242, 34,
  254, 68,207,178,195,181,122,145, 36,  8,232,168, 96,252,105, 80,
  170,208,160,125,161,137, 98,151, 84, 91, 30,149,224,255,100,210,
   16,196,  0, 72,163,247,117,219,138,  3,230,218,  9, 63,221,148,
  135, 92,131,  2,205, 74,144, 51,115,103,246,243,157,127,191,226,
   82,155,216, 38,200, 55,198, 59,129,150,111, 75, 19,190, 99, 46,
  233,121,167,140,159,110,188,142, 41,245,249,182, 47,253,180, 89,
  120,152,  6,106,231, 70,113,186,212, 37,171, 66,136,162,141,250,
  114,  7,185, 85,248,238,172, 10, 54, 73, 42,104, 60, 56,241,164,
   64, 40,211,123,187,201, 67,193, 21,227,173,244,119,199,128,158,
]);
const SBOX2 = new Uint8Array(256); // SBOX2[x] = SBOX1[x] <<< 1
const SBOX3 = new Uint8Array(256); // SBOX3[x] = SBOX1[x] <<< 7
const SBOX4 = new Uint8Array(256); // SBOX4[x] = SBOX1[x <<< 1]
{
  for (let i = 0; i < 256; i++) {
    const s = SBOX1[i];
    SBOX2[i] = ((s << 1) | (s >>> 7)) & 0xff;
    SBOX3[i] = ((s << 7) | (s >>> 1)) & 0xff;
    const ridx = ((i << 1) | (i >>> 7)) & 0xff;
    SBOX4[i] = SBOX1[ridx];
  }
}

// ============================================================
// 128 位循环左移（BigInt）
// ============================================================
function rol128(v, n) {
  const nn = BigInt(n) % 128n;
  return ((v << nn) | (v >> (128n - nn))) & MASK128;
}

// ============================================================
// F 函数（64 位输入/子密钥 → 64 位输出）
// ============================================================
function camelliaF(xIn, ke) {
  const x = (xIn ^ ke) & MASK64;
  const t1 = SBOX1[Number((x >> 56n) & 0xffn)];
  const t2 = SBOX2[Number((x >> 48n) & 0xffn)];
  const t3 = SBOX3[Number((x >> 40n) & 0xffn)];
  const t4 = SBOX4[Number((x >> 32n) & 0xffn)];
  const t5 = SBOX2[Number((x >> 24n) & 0xffn)];
  const t6 = SBOX3[Number((x >> 16n) & 0xffn)];
  const t7 = SBOX4[Number((x >> 8n) & 0xffn)];
  const t8 = SBOX1[Number(x & 0xffn)];
  const y1 = t1 ^ t3 ^ t4 ^ t6 ^ t7 ^ t8;
  const y2 = t1 ^ t2 ^ t4 ^ t5 ^ t7 ^ t8;
  const y3 = t1 ^ t2 ^ t3 ^ t5 ^ t6 ^ t8;
  const y4 = t2 ^ t3 ^ t4 ^ t5 ^ t6 ^ t7;
  const y5 = t1 ^ t2 ^ t6 ^ t7 ^ t8;
  const y6 = t2 ^ t3 ^ t5 ^ t7 ^ t8;
  const y7 = t3 ^ t4 ^ t5 ^ t6 ^ t8;
  const y8 = t1 ^ t4 ^ t5 ^ t6 ^ t7;
  return (
    (BigInt(y1) << 56n) | (BigInt(y2) << 48n) | (BigInt(y3) << 40n) | (BigInt(y4) << 32n) |
    (BigInt(y5) << 24n) | (BigInt(y6) << 16n) | (BigInt(y7) << 8n) | BigInt(y8)
  );
}

// ============================================================
// FL / FLINV（RFC 3713 §2.4.2）
// ============================================================
const rol32 = (v) => (((v << 1n) | (v >> 31n)) & 0xffffffffn);
function camelliaFL(flIn, ke) {
  const x1 = (flIn >> 32n) & 0xffffffffn;
  const x2 = flIn & 0xffffffffn;
  const k1 = (ke >> 32n) & 0xffffffffn;
  const k2 = ke & 0xffffffffn;
  const x2n = (x2 ^ rol32(x1 & k1)) & 0xffffffffn;
  const x1n = (x1 ^ (x2n | k2)) & 0xffffffffn;
  return (x1n << 32n) | x2n;
}
function camelliaFLINV(flIn, ke) {
  const y1 = (flIn >> 32n) & 0xffffffffn;
  const y2 = flIn & 0xffffffffn;
  const k1 = (ke >> 32n) & 0xffffffffn;
  const k2 = ke & 0xffffffffn;
  const y1n = (y1 ^ (y2 | k2)) & 0xffffffffn;
  const y2n = (y2 ^ rol32(y1n & k1)) & 0xffffffffn;
  return (y1n << 32n) | y2n;
}

// ============================================================
// 密钥调度
// ============================================================
const SIGMA = [
  0xA09E667F3BCC908Bn, 0xB67AE8584CAA73B2n, 0xC6EF372FE94F82BEn,
  0x54FF53A5F1D36F1Cn, 0x10E527FADE682D1Dn, 0xB05688C2B3E6C1FDn,
];
function camelliaKeySchedule(keyHex) {
  const c = keyHex.replace(/[^0-9a-fA-F]/g, "");
  if (![32, 48, 64].includes(c.length)) throw new Error("Camellia 密钥须为 128/192/256 位（32/48/64 hex）");
  let K = 0n;
  for (let i = 0; i < c.length; i++) K = (K << 4n) | BigInt(parseInt(c[i], 16));
  let KL, KR;
  if (c.length === 32) { KL = K; KR = 0n; }
  else if (c.length === 48) {
    KL = K >> 64n;
    KR = ((K & MASK64) << 64n) | (~(K & MASK64) & MASK64);
  } else { KL = K >> 128n; KR = K & MASK128; }
  let d1 = (KL ^ KR) >> 64n;
  let d2 = (KL ^ KR) & MASK64;
  d2 = (d2 ^ camelliaF(d1, SIGMA[0])) & MASK64;
  d1 = (d1 ^ camelliaF(d2, SIGMA[1])) & MASK64;
  d1 = (d1 ^ (KL >> 64n)) & MASK64;
  d2 = (d2 ^ (KL & MASK64)) & MASK64;
  d2 = (d2 ^ camelliaF(d1, SIGMA[2])) & MASK64;
  d1 = (d1 ^ camelliaF(d2, SIGMA[3])) & MASK64;
  const KA = (d1 << 64n) | d2;
  let KB = 0n;
  if (c.length !== 32) {
    d1 = (KA ^ KR) >> 64n;
    d2 = (KA ^ KR) & MASK64;
    d2 = (d2 ^ camelliaF(d1, SIGMA[4])) & MASK64;
    d1 = (d1 ^ camelliaF(d2, SIGMA[5])) & MASK64;
    KB = (d1 << 64n) | d2;
  }
  const hi = (v) => v >> 64n;
  const lo = (v) => v & MASK64;
  const sk = { kw: [], k: [], ke: [] };
  if (c.length === 32) {
    sk.kw.push(hi(rol128(KL, 0)), lo(rol128(KL, 0)));
    sk.k.push(hi(rol128(KA, 0)), lo(rol128(KA, 0)));
    sk.k.push(hi(rol128(KL, 15)), lo(rol128(KL, 15)));
    sk.k.push(hi(rol128(KA, 15)), lo(rol128(KA, 15)));
    sk.ke.push(hi(rol128(KA, 30)), lo(rol128(KA, 30)));
    sk.k.push(hi(rol128(KL, 45)), lo(rol128(KL, 45)));   // k7,k8
    sk.k.push(hi(rol128(KA, 45)));                       // k9 = (KA<<<45)>>64（单个）
    sk.k.push(lo(rol128(KL, 60)), hi(rol128(KA, 60)), lo(rol128(KA, 60))); // k10,k11,k12
    sk.ke.push(hi(rol128(KL, 77)), lo(rol128(KL, 77)));
    sk.k.push(hi(rol128(KL, 94)), lo(rol128(KL, 94)));
    sk.k.push(hi(rol128(KA, 94)), lo(rol128(KA, 94)));
    sk.k.push(hi(rol128(KL, 111)), lo(rol128(KL, 111)));
    sk.kw.push(hi(rol128(KA, 111)), lo(rol128(KA, 111)));
  } else {
    sk.kw.push(hi(rol128(KL, 0)), lo(rol128(KL, 0)));
    sk.k.push(hi(rol128(KB, 0)), lo(rol128(KB, 0)));
    sk.k.push(hi(rol128(KR, 15)), lo(rol128(KR, 15)));
    sk.k.push(hi(rol128(KA, 15)), lo(rol128(KA, 15)));
    sk.ke.push(hi(rol128(KR, 30)), lo(rol128(KR, 30)));
    sk.k.push(hi(rol128(KB, 30)), lo(rol128(KB, 30)));
    sk.k.push(hi(rol128(KL, 45)), lo(rol128(KL, 45)));
    sk.k.push(hi(rol128(KA, 45)), lo(rol128(KA, 45)));
    sk.ke.push(hi(rol128(KL, 60)), lo(rol128(KL, 60)));
    sk.k.push(hi(rol128(KR, 60)), lo(rol128(KR, 60)));
    sk.k.push(hi(rol128(KB, 60)), lo(rol128(KB, 60)));
    sk.k.push(hi(rol128(KL, 77)), lo(rol128(KL, 77)));
    sk.ke.push(hi(rol128(KA, 77)), lo(rol128(KA, 77)));
    sk.k.push(hi(rol128(KR, 94)), lo(rol128(KR, 94)));
    sk.k.push(hi(rol128(KA, 94)), lo(rol128(KA, 94)));
    sk.k.push(hi(rol128(KL, 111)), lo(rol128(KL, 111)));
    sk.kw.push(hi(rol128(KB, 111)), lo(rol128(KB, 111)));
  }
  return sk;
}

// ============================================================
// 数据加解密
// ============================================================
// 加密主体：按 RFC 轮序（FL/FLINV 在每 6 轮后插入，即 r=7/13/19 前）；每轮单次 F 调用 + 交换
function camelliaEncryptBlock(M, sk, rounds) {
  let d1 = (M >> 64n) & MASK64;
  let d2 = M & MASK64;
  const { kw, k, ke } = sk;
  d1 ^= kw[0]; d2 ^= kw[1];
  const flAt = rounds === 18 ? [7, 13] : [7, 13, 19];
  for (let r = 1; r <= rounds; r++) {
    if (flAt.includes(r)) {
      const idx = flAt.indexOf(r);
      d1 = camelliaFL(d1, ke[idx * 2]);
      d2 = camelliaFLINV(d2, ke[idx * 2 + 1]);
    }
    d2 = (d2 ^ camelliaF(d1, k[r - 1])) & MASK64;
    const t = d1; d1 = d2; d2 = t;
  }
  d2 ^= kw[2]; d1 ^= kw[3];
  return (d2 << 64n) | d1;
}
// 解密：逆序换密钥（kw 交换、k 逆序、ke 逆序），FL/FLINV 对调，加密结构本身不变
function camelliaDecryptBlock(C, sk, rounds) {
  let d1 = (C >> 64n) & MASK64;
  let d2 = C & MASK64;
  const { kw, k, ke } = sk;
  const n = rounds;
  const kwR = [kw[2], kw[3], kw[0], kw[1]];
  const kR = [...k].reverse();
  const keR = [...ke].reverse();
  d1 ^= kwR[0]; d2 ^= kwR[1];
  const flAt = n === 18 ? [7, 13] : [7, 13, 19];
  for (let r = 1; r <= n; r++) {
    if (flAt.includes(r)) {
      const idx = flAt.indexOf(r);
      // 解密仍用 FL(d1)/FLINV(d2) 结构，密钥换 keR（ke1↔ke4, ke2↔ke3）
      d1 = camelliaFL(d1, keR[idx * 2]);
      d2 = camelliaFLINV(d2, keR[idx * 2 + 1]);
    }
    d2 = (d2 ^ camelliaF(d1, kR[r - 1])) & MASK64;
    const t = d1; d1 = d2; d2 = t;
  }
  d2 ^= kwR[2]; d1 ^= kwR[3];
  return (d2 << 64n) | d1;
}

function camelliaCrypt(text, p, decrypt) {
  const keyHex = String((p && p.key) || "");
  const sk = camelliaKeySchedule(keyHex);
  const rounds = keyHex.replace(/[^0-9a-fA-F]/g, "").length === 32 ? 18 : 24;
  const inHex = String(text || "").replace(/[^0-9a-fA-F]/g, "");
  if (inHex.length === 0 || inHex.length % 32 !== 0) throw new Error("输入须为 16 字节（32 hex）的整数倍，ECB 不自动填充");
  let out = "";
  for (let off = 0; off < inHex.length; off += 32) {
    let M = BigInt("0x" + inHex.slice(off, off + 32));
    const D = decrypt ? camelliaDecryptBlock(M, sk, rounds) : camelliaEncryptBlock(M, sk, rounds);
    out += D.toString(16).padStart(32, "0");
  }
  return out;
}
const camelliaEncode = (t, p) => camelliaCrypt(t, p, false);
const camelliaDecode = (t, p) => camelliaCrypt(t, p, true);

register({
  id: "camellia",
  cat: "modern",
  name: "Camellia（RFC 3713）",
  desc: "NTT/三菱 Camellia 分组密码：128 位分组，128/192/256 位密钥（18/24 轮 Feistel），FL/FLINV 每 6 轮插入。NESSIE/CRYPTREC 推荐。ECB 多块，明文/密文/密钥均 hex。encode 加密 / decode 解密。过 RFC 3713 附录 C 三向量。",
  params: [
    { key: "key", label: "密钥 (hex, 128/192/256 位)", type: "text", default: "0123456789abcdeffedcba9876543210", placeholder: "32/48/64 hex 字符" },
  ],
  encode: camelliaEncode,
  decode: camelliaDecode,
});

export { camelliaEncode, camelliaDecode, camelliaKeySchedule, camelliaF, camelliaFL, camelliaFLINV };