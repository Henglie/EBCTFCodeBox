/*
 * xmssLms.js — XMSS（RFC 8391）与 LMS/HSS（RFC 8554）基于状态的哈希签名。
 *
 * XMSS：
 *   参数集 XMSS-SHA2_10_256（RFC 8391 §5.3 REQUIRED，OID 0x00000001）：
 *   n=32, w=16, len=67, h=10。算法照 RFC 8391 原文实现：
 *   §2.5 ADRS（32B 地址，layer/tree/type/ots/chain/hash/keyAndMask）
 *   §3.1 WOTS+（chain / base_w / 校验和 csum<<(8-(len_2*lg(w))%8) / pkFromSig）
 *   §4.1 RAND_HASH / ltree / treeHash / XMSS_keyGen / XMSS_sign / XMSS_verify
 *   §5.1 SHA2 n=32 域分隔：F=SHA256(toByte(0,32)||KEY||M)  H=…(1,32)…
 *        H_msg=…(2,32)…  PRF=…(3,32)…
 *   伪随机密钥生成按 RFC 作者官方参考实现（XMSS/xmss-reference）的
 *   prf_keygen 变体：SK_i = SHA256(toByte(4,32) || SK_SEED || PUB_SEED || ADRS)，
 *   ADRS 为 OTS 地址（ots=叶子号, chain=元素序号, hash=0, keyAndMask=0）。
 *   官方 RFC 文本无逐字节测试向量附录；本实现对拍锚点为参考实现确定性
 *   KAT（XMSS-SHA2_10_256，NIST PQCsignKAT 格式，root/R/签名逐字节全过）。
 *
 * LMS/HSS（RFC 8554）：
 *   LMOTS_SHA256_N32_W8（type 4, p=34, ls=0）、N32_W4（type 3, p=67, ls=4）；
 *   LMS_SHA256_M32_H5（type 5）、H10（type 6）；D_MESG=0x8181 D_PBLC=0x8080
 *   D_LEAF=0x8282 D_INTR=0x8383；coef/checksum/Alg 0-6a/Appendix A 伪随机私钥
 *   x_q[i]=H(I||u32str(q)||u16str(i)||u8str(0xff)||SEED) 照原文。
 *   对拍：Appendix F Test Case 1（两级 HSS）签名逐字节验证 VALID；
 *   Test Case 2（私钥 SEED/I 齐全）从种子完整复现两级签名逐字节一致。
 *
 * ⚠ 状态签名：OTS 索引（XMSS idx / LMS q）绝对不可重用，同一 index 签两次
 *   = 私钥泄露。本工具接受固定 index 仅为复现 CTF 向量，真实使用必须维护
 *   持久化 state。
 *
 * op id：xmssKeyGen / xmssSign / xmssVerify / lmsSign / lmsVerify。
 */

import { register } from "./registry.js";

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
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function concatBytes(...arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function randomBytes(n) {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(n);
    c.getRandomValues(b);
    return b;
  }
  throw new Error("无可用 CSPRNG（crypto.getRandomValues），无法生成随机种子");
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** RFC 8391 §2.4 toByte(x, y)：大端 y 字节。 */
function toByte(x, y) {
  const b = new Uint8Array(y);
  let v = typeof x === "bigint" ? x : BigInt(Math.floor(x));
  for (let i = y - 1; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
}

// ============================================================
// SHA-256（纯 JS，FIPS 180-4，与 slhdsa.js 同实现）
// ============================================================

const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function sha256(msg) {
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const l = msg.length;
  const bitLen = l * 8;
  let padLen = (56 - (l + 1) % 64 + 64) % 64;
  const total = l + 1 + padLen + 8;
  const padded = new Uint8Array(total);
  padded.set(msg, 0);
  padded[l] = 0x80;
  const bitLenB = BigInt(bitLen);
  for (let i = 0; i < 8; i++) padded[total - 1 - i] = Number((bitLenB >> BigInt(8 * i)) & 0xffn);

  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = (padded[off + i * 4] << 24) | (padded[off + i * 4 + 1] << 16) | (padded[off + i * 4 + 2] << 8) | padded[off + i * 4 + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (H[i] >> 24) & 0xff; out[i * 4 + 1] = (H[i] >> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >> 8) & 0xff; out[i * 4 + 3] = H[i] & 0xff;
  }
  return out;
}

// ============================================================
// XMSS（RFC 8391，XMSS-SHA2_10_256）
// ============================================================

const XN = 32;      // n
const XW = 16;      // w
const XLEN = 67;    // len = len_1 + len_2
const XLEN1 = 64;   // len_1 = 8n/lg(w)
const XLEN2 = 3;    // len_2 = floor(lg(len_1*(w-1))/lg(w)) + 1
const XH = 10;      // 树高
const XOID = 0x00000001;

// ADRS：32 字节地址（RFC 8391 §2.5）
const ADRS_OTS = 0, ADRS_LTREE = 1, ADRS_HASHTREE = 2;

function newAdrs() { return new Uint8Array(32); }
function adrsToBytes(a) { return a.slice(0, 32); }
function setLayerAddr(a, v) { const b = toByte(v, 4); a.set(b, 0); }
function setTreeAddr(a, v) { a.set(toByte(v, 8), 4); }
function setType(a, t) { a.set(toByte(t, 4), 12); for (let i = 16; i < 32; i++) a[i] = 0; }
function setOtsAddr(a, v) { a.set(toByte(v, 4), 16); }
function setLtreeAddr(a, v) { a.set(toByte(v, 4), 16); }
function setChainAddr(a, v) { a.set(toByte(v, 4), 20); }
function setHashAddr(a, v) { a.set(toByte(v, 4), 24); }
function setTreeHeight(a, v) { a.set(toByte(v, 4), 20); }
function setTreeIndex(a, v) { a.set(toByte(v, 4), 24); }
function setKeyAndMask(a, v) { a.set(toByte(v, 4), 28); }

// §5.1：PRF = SHA2-256(toByte(3,32) || KEY || M)；prf_keygen 用 padding 4（参考实现口径）
function prf(key, m) {
  const b = new Uint8Array(32 + key.length + m.length);
  b.set(toByte(3, 32), 0); b.set(key, 32); b.set(m, 32 + key.length);
  return sha256(b);
}
function prfKeygen(key, m) {
  const b = new Uint8Array(32 + key.length + m.length);
  b.set(toByte(4, 32), 0); b.set(key, 32); b.set(m, 32 + key.length);
  return sha256(b);
}

// F：SHA2-256(toByte(0,32) || KEY || M)，KEY/M 由 PRF(PUB_SEED, ADRS) 生成
function thashF(inp, pubSeed, adrs) {
  setKeyAndMask(adrs, 0);
  const KEY = prf(pubSeed, adrsToBytes(adrs));
  setKeyAndMask(adrs, 1);
  const BM = prf(pubSeed, adrsToBytes(adrs));
  const x = new Uint8Array(XN);
  for (let i = 0; i < XN; i++) x[i] = inp[i] ^ BM[i];
  const b = new Uint8Array(32 + XN + XN);
  b.set(toByte(0, 32), 0); b.set(KEY, 32); b.set(x, 32 + XN);
  return sha256(b);
}

// H：SHA2-256(toByte(1,32) || KEY || M)，M 为 2n 字节 XOR 2n 位掩码
function thashH(in2n, pubSeed, adrs) {
  setKeyAndMask(adrs, 0);
  const KEY = prf(pubSeed, adrsToBytes(adrs));
  setKeyAndMask(adrs, 1);
  const BM0 = prf(pubSeed, adrsToBytes(adrs));
  setKeyAndMask(adrs, 2);
  const BM1 = prf(pubSeed, adrsToBytes(adrs));
  const x = new Uint8Array(2 * XN);
  for (let i = 0; i < XN; i++) {
    x[i] = in2n[i] ^ BM0[i];
    x[XN + i] = in2n[XN + i] ^ BM1[i];
  }
  const b = new Uint8Array(32 + XN + 2 * XN);
  b.set(toByte(1, 32), 0); b.set(KEY, 32); b.set(x, 32 + XN);
  return sha256(b);
}

// §2.6 base_w（w=16，半字节）
function baseW(input, outLen) {
  const out = new Uint8Array(outLen);
  let inIdx = 0, bits = 0, total = 0;
  for (let consumed = 0; consumed < outLen; consumed++) {
    if (bits === 0) { total = input[inIdx]; inIdx++; bits += 8; }
    bits -= 4;
    out[consumed] = (total >> bits) & (XW - 1);
  }
  return out;
}

// §3.1.5 校验和 + 链长
function chainLengths(msg) {
  const lengths = new Uint8Array(XLEN);
  lengths.set(baseW(msg, XLEN1), 0);
  let csum = 0;
  for (let i = 0; i < XLEN1; i++) csum += XW - 1 - lengths[i];
  csum = csum << (8 - ((XLEN2 * 4) % 8));
  const csumBytes = toByte(csum, 2); // len_2_bytes = ceil(len_2*lg(w)/8) = 2
  lengths.set(baseW(csumBytes, XLEN2), XLEN1);
  return lengths;
}

// §3.1.2 chain（迭代实现，等价于 RFC 递归式）
function chain(inp, start, steps, pubSeed, adrs) {
  const out = inp.slice(0, XN);
  for (let i = start; i < start + steps && i < XW; i++) {
    setHashAddr(adrs, i);
    setKeyAndMask(adrs, 0);
    const KEY = prf(pubSeed, adrsToBytes(adrs));
    setKeyAndMask(adrs, 1);
    const BM = prf(pubSeed, adrsToBytes(adrs));
    const x = new Uint8Array(XN);
    for (let j = 0; j < XN; j++) x[j] = out[j] ^ BM[j];
    const b = new Uint8Array(32 + XN + XN);
    b.set(toByte(0, 32), 0); b.set(KEY, 32); b.set(x, 32 + XN);
    out.set(sha256(b));
  }
  return out;
}

// 伪随机密钥生成（参考实现 expand_seed + prf_keygen）：
// SK_i = SHA256(toByte(4,32) || SK_SEED || PUB_SEED || ADRS)，ADRS.chain=i
function expandSeed(skSeed, pubSeed, adrs) {
  const seeds = new Uint8Array(XLEN * XN);
  const buf = new Uint8Array(XN + 32);
  buf.set(pubSeed, 0);
  setHashAddr(adrs, 0);
  setKeyAndMask(adrs, 0);
  for (let i = 0; i < XLEN; i++) {
    setChainAddr(adrs, i);
    buf.set(adrsToBytes(adrs), XN);
    seeds.set(prfKeygen(skSeed, buf), i * XN);
  }
  return seeds;
}

// §3.1.4 WOTS_genPK（伪随机私钥口径）
function wotsPkgen(skSeed, pubSeed, adrs) {
  const pk = expandSeed(skSeed, pubSeed, adrs);
  for (let i = 0; i < XLEN; i++) {
    setChainAddr(adrs, i);
    pk.set(chain(pk.subarray(i * XN), 0, XW - 1, pubSeed, adrs), i * XN);
  }
  return pk;
}

// §3.1.5 WOTS_sign
function wotsSign(msg, skSeed, pubSeed, adrs) {
  const lengths = chainLengths(msg);
  const sig = expandSeed(skSeed, pubSeed, adrs);
  for (let i = 0; i < XLEN; i++) {
    setChainAddr(adrs, i);
    sig.set(chain(sig.subarray(i * XN), 0, lengths[i], pubSeed, adrs), i * XN);
  }
  return sig;
}

// §3.1.6 WOTS_pkFromSig
function wotsPkFromSig(sig, msg, pubSeed, adrs) {
  const lengths = chainLengths(msg);
  const pk = new Uint8Array(XLEN * XN);
  for (let i = 0; i < XLEN; i++) {
    setChainAddr(adrs, i);
    pk.set(chain(sig.subarray(i * XN, (i + 1) * XN), lengths[i], XW - 1 - lengths[i], pubSeed, adrs), i * XN);
  }
  return pk;
}

// §4.1.5 ltree（67 个元素 → 1 个叶节点）
function ltree(pk, pubSeed, adrs) {
  let l = XLEN;
  let height = 0;
  setTreeHeight(adrs, height);
  const buf = pk.slice();
  while (l > 1) {
    const parentNodes = l >> 1;
    for (let i = 0; i < parentNodes; i++) {
      setTreeIndex(adrs, i);
      buf.set(thashH(buf.subarray(i * 2 * XN, i * 2 * XN + 2 * XN), pubSeed, adrs), i * XN);
    }
    if (l & 1) {
      buf.set(buf.subarray((l - 1) * XN, l * XN), (l >> 1) * XN);
      l = (l >> 1) + 1;
    } else {
      l = l >> 1;
    }
    height++;
    setTreeHeight(adrs, height);
  }
  return buf.slice(0, XN);
}

// 叶子 = WOTS 公钥经 L-tree 压缩（参考实现 gen_leaf_wots）
function genLeafWots(skSeed, pubSeed, ltreeAddr, otsAddr) {
  const pk = wotsPkgen(skSeed, pubSeed, otsAddr);
  return ltree(pk, pubSeed, ltreeAddr);
}

// §4.1.6/参考实现 treeHash：root + 认证路径一次算出
function treeHash(skSeed, pubSeed, leafIdx, subtreeAddr) {
  const stack = [];
  const auth = new Uint8Array(XH * XN);
  const otsAddr = newAdrs(), ltreeAddr = newAdrs(), nodeAddr = newAdrs();
  otsAddr.set(subtreeAddr); ltreeAddr.set(subtreeAddr); nodeAddr.set(subtreeAddr);
  setType(otsAddr, ADRS_OTS); setType(ltreeAddr, ADRS_LTREE); setType(nodeAddr, ADRS_HASHTREE);

  for (let idx = 0; idx < (1 << XH); idx++) {
    setLtreeAddr(ltreeAddr, idx);
    setOtsAddr(otsAddr, idx);
    stack.push({ node: genLeafWots(skSeed, pubSeed, ltreeAddr, otsAddr), h: 0 });

    if ((leafIdx ^ 0x1) === idx) auth.set(stack[stack.length - 1].node, 0);

    while (stack.length >= 2 && stack[stack.length - 1].h === stack[stack.length - 2].h) {
      const right = stack.pop();
      const left = stack.pop();
      const nh = right.h;
      const treeIdx = idx >> (nh + 1);
      setTreeHeight(nodeAddr, nh);
      setTreeIndex(nodeAddr, treeIdx);
      const parent = thashH(concatBytes(left.node, right.node), pubSeed, nodeAddr);
      stack.push({ node: parent, h: nh + 1 });
      if (((leafIdx >> (nh + 1)) ^ 0x1) === treeIdx) {
        auth.set(parent, (nh + 1) * XN);
      }
    }
  }
  return { root: stack[0].node, auth };
}

// XMSS_keyGen（§4.1.7）：输入 SK_SEED/SK_PRF/PUB_SEED（各 32B），输出 root
function xmssRootFromSeeds(skSeed, pubSeed) {
  const adrs = newAdrs(); // 单树全零（layer=0, tree=0）
  return treeHash(skSeed, pubSeed, 0, adrs).root;
}

// XMSS_sign（§4.1.8-4.1.9）：签名 = idx(4) || r(n) || sig_ots(len*n) || auth(h*n)
function xmssSignBytes(msg, skSeed, skPrf, pubSeed, root, idx) {
  if (!Number.isInteger(idx) || idx < 0 || idx >= (1 << XH)) {
    throw new Error(`index 须为 0..${(1 << XH) - 1} 的整数（当前 ${idx}）`);
  }
  const adrs = newAdrs();
  // r = PRF(SK_PRF, toByte(idx_sig, 32))
  const r = prf(skPrf, toByte(idx, 32));
  // M' = H_msg(r || root || toByte(idx, n), M) = SHA256(toByte(2,32) || r || root || toByte(idx,32) || M)
  const mIn = concatBytes(toByte(2, 32), r, root, toByte(idx, XN), msg);
  const mhash = sha256(mIn);
  // treeSig
  setType(adrs, ADRS_OTS);
  setLayerAddr(adrs, 0); setTreeAddr(adrs, 0); setOtsAddr(adrs, idx);
  const sigOts = wotsSign(mhash, skSeed, pubSeed, adrs);
  const { auth } = treeHash(skSeed, pubSeed, idx, adrs);
  return concatBytes(toByte(idx, 4), r, sigOts, auth);
}

// XMSS_verify（§4.1.10 + 参考实现 compute_root）
function xmssVerifyBytes(msg, sig, root, pubSeed) {
  const expLen = 4 + XN + XLEN * XN + XH * XN;
  if (sig.length !== expLen) {
    return { valid: false, reason: `签名长度不符（应 ${expLen} 字节，实得 ${sig.length}）` };
  }
  const idx = Number((BigInt(sig[0]) << 24n) | (BigInt(sig[1]) << 16n) | (BigInt(sig[2]) << 8n) | BigInt(sig[3]));
  if (idx >= (1 << XH)) return { valid: false, reason: `签名 index 超界（${idx} ≥ 2^${XH}）` };
  const r = sig.subarray(4, 4 + XN);
  const sigOts = sig.subarray(4 + XN, 4 + XN + XLEN * XN);
  const auth = sig.subarray(4 + XN + XLEN * XN);
  const adrs = newAdrs();
  const mhash = sha256(concatBytes(toByte(2, 32), r, root, toByte(idx, XN), msg));
  // WOTS_pkFromSig → ltree → compute_root
  setType(adrs, ADRS_OTS);
  setLayerAddr(adrs, 0); setTreeAddr(adrs, 0); setOtsAddr(adrs, idx);
  const pk = wotsPkFromSig(sigOts, mhash, pubSeed, adrs);
  setType(adrs, ADRS_LTREE);
  setLtreeAddr(adrs, idx);
  const leaf = ltree(pk, pubSeed, adrs);
  setType(adrs, ADRS_HASHTREE);
  // compute_root（照参考实现：buffer 两槽 + auth 逐层填入）
  const buffer = new Uint8Array(2 * XN);
  let leafIdx = idx;
  if (leafIdx & 1) {
    buffer.set(auth.subarray(0, XN), 0);
    buffer.set(leaf, XN);
  } else {
    buffer.set(leaf, 0);
    buffer.set(auth.subarray(0, XN), XN);
  }
  let ap = XN;
  for (let i = 0; i < XH - 1; i++) {
    setTreeHeight(adrs, i);
    leafIdx >>= 1;
    setTreeIndex(adrs, leafIdx);
    if (leafIdx & 1) {
      buffer.set(thashH(buffer, pubSeed, adrs), XN);
      buffer.set(auth.subarray(ap, ap + XN), 0);
    } else {
      buffer.set(thashH(buffer, pubSeed, adrs), 0);
      buffer.set(auth.subarray(ap, ap + XN), XN);
    }
    ap += XN;
  }
  setTreeHeight(adrs, XH - 1);
  leafIdx >>= 1;
  setTreeIndex(adrs, leafIdx);
  const rootC = thashH(buffer, pubSeed, adrs);
  const valid = bytesEqual(rootC, root);
  return {
    valid,
    reason: valid ? "根节点重算与公钥一致（WOTS+ → L-tree → Merkle 路径全部通过）" : "根节点重算不符（消息/签名/公钥/index 任一不符即失败）",
    idx,
  };
}

// ============================================================
// LMS / HSS（RFC 8554）
// ============================================================

const LMOTS_TYPES = {
  w8: { type: 4, n: 32, w: 8, p: 34, ls: 0 },
  w4: { type: 3, n: 32, w: 4, p: 67, ls: 4 },
};
const LMS_TYPES = {
  h5: { type: 5, h: 5, m: 32 },
  h10: { type: 6, h: 10, m: 32 },
};
const D_PBLC = 0x8080, D_MESG = 0x8181, D_LEAF = 0x8282, D_INTR = 0x8383;

const u32str = (v) => toByte(v, 4);
const u16str = (v) => toByte(v, 2);
const u8str = (v) => toByte(v, 1);

// §3.1.3 coef(S, i, w)
function coef(S, i, w) {
  const byteIdx = Math.floor((i * w) / 8);
  const shift = 8 - (w * (i % (8 / w)) + w);
  return ((1 << w) - 1) & (S[byteIdx] >> shift);
}

// §4.4 Cksm：16 位校验和，左移 ls
function lmsChecksum(S, otsw) {
  const { n, w, ls } = otsw;
  let sum = 0;
  for (let i = 0; i < (n * 8) / w; i++) sum += (1 << w) - 1 - coef(S, i, w);
  return (sum << ls) & 0xffff;
}

// Q || Cksm(Q) 展开成 w 位系数流（coef 直接按位取，不预转字节）
function lmotsCoefStream(Q, otsw) {
  // 返回取 coef 的虚拟串：Q(n 字节) || u16str(Cksm<<ls 已含于值)
  const cksm = lmsChecksum(Q, otsw);
  const full = concatBytes(Q, u16str(cksm));
  return { full, w: otsw.w, count: otsw.p };
}
function streamCoef(st, i) {
  // 与 coef(Q||Cksm(Q), i, w) 一致：Cksm 值本身已左移 ls，u16str 即可
  return coef(st.full, i, st.w);
}

// Appendix A 伪随机私钥：x_q[i] = H(I || u32str(q) || u16str(i) || u8str(0xff) || SEED)
function lmotsPrivKey(I, q, otsw, SEED) {
  const { n, p } = otsw;
  const x = new Uint8Array(p * n);
  for (let i = 0; i < p; i++) {
    x.set(sha256(concatBytes(I, u32str(q), u16str(i), u8str(0xff), SEED)), i * n);
  }
  return x;
}

// §4.3 Algorithm 1：LM-OTS 公钥 K
function lmotsPubkeyK(x, I, q, otsw) {
  const { n, p, w } = otsw;
  const y = new Uint8Array(p * n);
  for (let i = 0; i < p; i++) {
    let tmp = x.subarray(i * n, (i + 1) * n).slice();
    for (let j = 0; j < (1 << w) - 1; j++) {
      tmp = sha256(concatBytes(I, u32str(q), u16str(i), u8str(j), tmp));
    }
    y.set(tmp, i * n);
  }
  return { K: sha256(concatBytes(I, u32str(q), u16str(D_PBLC), y)), y };
}

// §4.5 Algorithm 3：LM-OTS 签名（C 固定 → 可复现向量）
function lmotsSign(x, I, q, otsw, msg, C) {
  const { n, p, w, type } = otsw;
  const Q = sha256(concatBytes(I, u32str(q), u16str(D_MESG), C, msg));
  const st = lmotsCoefStream(Q, otsw);
  const y = new Uint8Array(p * n);
  for (let i = 0; i < p; i++) {
    const a = streamCoef(st, i);
    let tmp = x.subarray(i * n, (i + 1) * n).slice();
    for (let j = 0; j < a; j++) {
      tmp = sha256(concatBytes(I, u32str(q), u16str(i), u8str(j), tmp));
    }
    y.set(tmp, i * n);
  }
  return concatBytes(u32str(type), C, y);
}

// §4.6 Algorithm 4b：由签名恢复公钥候选 Kc
function lmotsPkFromSig(lmotsSig, msg, I, q, otsw) {
  const { n, p, w, type } = otsw;
  if (lmotsSig.length !== 4 + n * (p + 1)) return { error: `LM-OTS 签名长度不符（应 ${4 + n * (p + 1)}，实得 ${lmotsSig.length}）` };
  const sigtype = Number((BigInt(lmotsSig[0]) << 24n) | (BigInt(lmotsSig[1]) << 16n) | (BigInt(lmotsSig[2]) << 8n) | BigInt(lmotsSig[3]));
  if (sigtype !== type) return { error: `LM-OTS 类型不符（签名 ${sigtype} ≠ 期望 ${type}）` };
  const C = lmotsSig.subarray(4, 4 + n);
  const y = lmotsSig.subarray(4 + n);
  const Q = sha256(concatBytes(I, u32str(q), u16str(D_MESG), C, msg));
  const st = lmotsCoefStream(Q, otsw);
  const z = new Uint8Array(p * n);
  for (let i = 0; i < p; i++) {
    const a = streamCoef(st, i);
    let tmp = y.subarray(i * n, (i + 1) * n).slice();
    for (let j = a; j < (1 << w) - 1; j++) {
      tmp = sha256(concatBytes(I, u32str(q), u16str(i), u8str(j), tmp));
    }
    z.set(tmp, i * n);
  }
  return { Kc: sha256(concatBytes(I, u32str(q), u16str(D_PBLC), z)) };
}

// §5.3：T[r] 与 LMS 公钥
// OTS_PUB_HASH[i] = K of leaf i（K 已含 I||q 域分隔）
function lmsLeafHash(I, r, otsPubHash) {
  return sha256(concatBytes(I, u32str(r), u16str(D_LEAF), otsPubHash));
}
function lmsIntrHash(I, r, left, right) {
  return sha256(concatBytes(I, u32str(r), u16str(D_INTR), left, right));
}

// 计算 2^h 个叶子的 OTS_PUB_HASH（Appendix A 私钥口径）
function lmsOtsPubHashes(I, lmsT, otsw, SEED) {
  const leaves = 1 << lmsT.h;
  const hashes = new Uint8Array(leaves * 32);
  for (let q = 0; q < leaves; q++) {
    const x = lmotsPrivKey(I, q, otsw, SEED);
    hashes.set(lmotsPubkeyK(x, I, q, otsw).K, q * 32);
  }
  return hashes;
}

// 全树节点 T[1..2^(h+1)-1]，栈式（Appendix C 等价实现）
function lmsTreeNodes(I, lmsT, otsPubHashes) {
  const { h } = lmsT;
  const leaves = 1 << h;
  // 节点号 1..2^(h+1)-1，多留 1 槽方便 r*32 直写
  const nodes = new Uint8Array((1 << (h + 1)) * 32);
  const stack = []; // 值栈（Appendix C）
  for (let i = 0; i < leaves; i++) {
    let r = leaves + i;
    let temp = lmsLeafHash(I, r, otsPubHashes.subarray(i * 32, i * 32 + 32));
    nodes.set(temp, r * 32);
    let j = i;
    while (j % 2 === 1) {
      r = (r - 1) / 2;
      j = (j - 1) / 2;
      const leftSide = stack.pop();
      temp = lmsIntrHash(I, r, leftSide, temp);
      nodes.set(temp, r * 32);
    }
    stack.push(temp);
  }
  return nodes; // T[r] 位于 nodes[r*32..]
}

// LMS 公钥字节串：u32str(type) || u32str(otstype) || I || T[1]
function lmsPubkeyBytes(I, lmsT, otsw, nodes) {
  return concatBytes(u32str(lmsT.type), u32str(otsw.type), I, nodes.subarray(1 * 32, 2 * 32));
}

// LMS 签名（§5.4.1）：q 由调用方指定（CTF 复现），path 取 T[兄弟节点]
function lmsSignBytes(msg, I, lmsT, otsw, SEED, q, otsPubHashes, nodes, C) {
  const { h } = lmsT;
  if (!Number.isInteger(q) || q < 0 || q >= (1 << h)) {
    throw new Error(`index q 须为 0..${(1 << h) - 1} 的整数（当前 ${q}）`);
  }
  const x = lmotsPrivKey(I, q, otsw, SEED);
  const lmotsSig = lmotsSign(x, I, q, otsw, msg, C);
  let nodeNum = (1 << h) + q;
  const path = new Uint8Array(h * 32);
  for (let i = 0; i < h; i++) {
    const sib = nodeNum ^ 1;
    path.set(nodes.subarray(sib * 32, sib * 32 + 32), i * 32);
    nodeNum >>= 1;
  }
  return concatBytes(u32str(q), lmotsSig, u32str(lmsT.type), path);
}

// §5.4.2 Algorithm 6a：LMS 验证
function lmsVerifyBytes(msg, sig, pub) {
  if (pub.length !== 56) return { valid: false, reason: `LMS 公钥长度不符（应 56 字节，实得 ${pub.length}）` };
  const pubtype = u32read(pub, 0);
  const otsTypecode = u32read(pub, 4);
  const lmsT = typeToLms(pubtype), otsw = typeToOtsw(otsTypecode);
  if (!lmsT || !otsw) return { valid: false, reason: "未知 LMS/LMOTS typecode" };
  const I = pub.subarray(8, 24);
  const K = pub.subarray(24, 56);
  if (sig.length < 8) return { valid: false, reason: "LMS 签名过短" };
  const q = u32read(sig, 0);
  const otssigtype = u32read(sig, 4);
  if (otssigtype !== otsTypecode) return { valid: false, reason: `LMOTS typecode 不一致（签名 ${otssigtype} ≠ 公钥 ${otsTypecode}）` };
  const lmotsSigLen = 4 + otsw.n * (otsw.p + 1);
  if (sig.length < 8 + lmotsSigLen) return { valid: false, reason: "LMS 签名长度不足（LM-OTS 部分截断）" };
  const sigtype = u32read(sig, 4 + lmotsSigLen);
  if (sigtype !== pubtype) return { valid: false, reason: `LMS typecode 不一致（签名 ${sigtype} ≠ 公钥 ${pubtype}）` };
  const pathLen = lmsT.h * 32;
  if (sig.length !== 8 + lmotsSigLen + pathLen) return { valid: false, reason: `LMS 签名长度不符（应 ${8 + lmotsSigLen + pathLen}，实得 ${sig.length}）` };
  if (q >= (1 << lmsT.h)) return { valid: false, reason: `q 超界（${q} ≥ 2^${lmsT.h}）` };
  const lmotsSig = sig.subarray(4, 4 + lmotsSigLen);
  const path = sig.subarray(8 + lmotsSigLen);
  const kc = lmotsPkFromSig(lmotsSig, msg, I, q, otsw);
  if (kc.error) return { valid: false, reason: kc.error };
  // Alg 6a step 4
  let nodeNum = (1 << lmsT.h) + q;
  let tmp = lmsLeafHash(I, nodeNum, kc.Kc);
  for (let i = 0; nodeNum > 1; i++) {
    if (nodeNum % 2 === 1) {
      tmp = lmsIntrHash(I, (nodeNum - 1) / 2, path.subarray(i * 32, i * 32 + 32), tmp);
    } else {
      tmp = lmsIntrHash(I, nodeNum / 2, tmp, path.subarray(i * 32, i * 32 + 32));
    }
    nodeNum = Math.floor(nodeNum / 2);
  }
  const valid = bytesEqual(tmp, K);
  return { valid, reason: valid ? "候选根节点与公钥一致" : "候选根节点不符（验证失败）", q };
}

function u32read(b, off) {
  return Number((BigInt(b[off]) << 24n) | (BigInt(b[off + 1]) << 16n) | (BigInt(b[off + 2]) << 8n) | BigInt(b[off + 3]));
}
function typeToLms(t) { return Object.values(LMS_TYPES).find((v) => v.type === t) || null; }
function typeToOtsw(t) { return Object.values(LMOTS_TYPES).find((v) => v.type === t) || null; }

// HSS 两级签名（§6.2，L=2）：u32str(1) || sig[0] || pub[1] || sig[1]
function hssSign2(msg, top, bot) {
  // top/bot: { I, SEED, lmsT, otsw, q, C }
  const topHashes = lmsOtsPubHashes(top.I, top.lmsT, top.otsw, top.SEED);
  const topNodes = lmsTreeNodes(top.I, top.lmsT, topHashes);
  const botHashes = lmsOtsPubHashes(bot.I, bot.lmsT, bot.otsw, bot.SEED);
  const botNodes = lmsTreeNodes(bot.I, bot.lmsT, botHashes);
  const pub0 = lmsPubkeyBytes(top.I, top.lmsT, top.otsw, topNodes);
  const pub1 = lmsPubkeyBytes(bot.I, bot.lmsT, bot.otsw, botNodes);
  const sig0 = lmsSignBytes(pub1, top.I, top.lmsT, top.otsw, top.SEED, top.q, topHashes, topNodes, top.C);
  const sig1 = lmsSignBytes(msg, bot.I, bot.lmsT, bot.otsw, bot.SEED, bot.q, botHashes, botNodes, bot.C);
  return { hssPub: concatBytes(u32str(2), pub0), hssSig: concatBytes(u32str(1), sig0, pub1, sig1) };
}

// HSS 验证（§6.3）：签名自描述解析，逐层验签
function hssVerifyBytes(msg, sig, pub) {
  if (pub.length < 4) return { valid: false, reason: "公钥过短" };
  const L = u32read(pub, 0);
  if (sig.length < 4) return { valid: false, reason: "签名过短" };
  const Nspk = u32read(sig, 0);
  if (Nspk + 1 !== L) return { valid: false, reason: `Nspk+1=${Nspk + 1} ≠ 公钥层数 L=${L}` };
  let key = pub.subarray(4);       // 当前层 LMS 公钥
  let off = 4;
  for (let i = 0; i < Nspk; i++) {
    const sigLen = parseLmsSigLen(sig, off);
    if (sigLen.error) return { valid: false, reason: sigLen.error };
    const sigI = sig.subarray(off, off + sigLen.len);
    off += sigLen.len;
    const pubLen = parseLmsPubLen(sig, off);
    if (pubLen.error) return { valid: false, reason: pubLen.error };
    const pubI = sig.subarray(off, off + pubLen.len);
    off += pubLen.len;
    const v = lmsVerifyBytes(pubI, sigI, key);
    if (!v.valid) return { valid: false, reason: `第 ${i} 层签名公钥验证失败：${v.reason}` };
    key = pubI;
  }
  const sigLen = parseLmsSigLen(sig, off);
  if (sigLen.error) return { valid: false, reason: sigLen.error };
  const sigMsg = sig.subarray(off, off + sigLen.len);
  if (off + sigLen.len !== sig.length) return { valid: false, reason: "签名尾部有多余字节" };
  return lmsVerifyBytes(msg, sigMsg, key);
}

// 解析 LMS 签名长度（自描述：q + lmots type → 长度；lms type → path 长度）
function parseLmsSigLen(sig, off) {
  if (sig.length < off + 8) return { error: "LMS 签名头部截断" };
  const otssigtype = u32read(sig, off + 4);
  const otsw = typeToOtsw(otssigtype);
  if (!otsw) return { error: `未知 LMOTS typecode ${otssigtype}` };
  const lmotsSigLen = 4 + otsw.n * (otsw.p + 1);
  if (sig.length < off + 8 + lmotsSigLen) return { error: "LMS 签名 LM-OTS 部分截断" };
  const sigtype = u32read(sig, off + 4 + lmotsSigLen);
  const lmsT = typeToLms(sigtype);
  if (!lmsT) return { error: `未知 LMS typecode ${sigtype}` };
  return { len: 8 + lmotsSigLen + lmsT.h * 32 };
}
function parseLmsPubLen(sig, off) {
  if (sig.length < off + 56) return { error: "LMS 公钥部分截断" };
  return { len: 56 };
}

// ============================================================
// 顶层 API（供 op 与测试）
// ============================================================

function u8ToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }
function parseHexField(v, name, len) {
  if (v instanceof Uint8Array) v = u8ToHex(v);
  if (v instanceof Uint8Array) v = bytesToHexU8(v);
  const b = hexToBytes(v);
  if (b.length !== len) throw new Error(`${name} 须为 ${len} 字节 hex（当前 ${b.length} 字节）`);
  return b;
}

/** XMSS 密钥生成：skSeed/skPrf/pubSeed 各 32B hex（留空随机）。 */
export function xmssKeyGenBytes(skSeedHex, skPrfHex, pubSeedHex) {
  let skSeed, skPrf, pubSeed;
  if (String(skSeedHex || "").trim() === "" && String(skPrfHex || "").trim() === "" && String(pubSeedHex || "").trim() === "") {
    const all = randomBytes(3 * XN);
    skSeed = all.subarray(0, XN); skPrf = all.subarray(XN, 2 * XN); pubSeed = all.subarray(2 * XN);
  } else {
    skSeed = parseHexField(skSeedHex, "SK_SEED", XN);
    skPrf = parseHexField(skPrfHex, "SK_PRF", XN);
    pubSeed = parseHexField(pubSeedHex, "PUB_SEED", XN);
  }
  const root = xmssRootFromSeeds(skSeed, pubSeed);
  return { skSeed, skPrf, pubSeed, root, pk: concatBytes(root, pubSeed), pkOid: concatBytes(u32str(XOID), root, pubSeed) };
}

/** XMSS 签名。root 为 32B。 */
export function xmssSignFull(msg, skSeedHex, skPrfHex, pubSeedHex, rootHex, idx) {
  const skSeed = parseHexField(skSeedHex, "SK_SEED", XN);
  const skPrf = parseHexField(skPrfHex, "SK_PRF", XN);
  const pubSeed = parseHexField(pubSeedHex, "PUB_SEED", XN);
  const root = parseHexField(rootHex, "root", XN);
  const sig = xmssSignBytes(msg, skSeed, skPrf, pubSeed, root, idx);
  return { sig, pk: concatBytes(root, pubSeed) };
}

/** XMSS 验签：pk 64B（root||SEED）或 68B（OID||root||SEED）。 */
export function xmssVerifyFull(msg, pkHex, sigHex) {
  if (pkHex instanceof Uint8Array) pkHex = u8ToHex(pkHex);
  if (sigHex instanceof Uint8Array) sigHex = u8ToHex(sigHex);
  const pk = hexToBytes(pkHex);
  let root, pubSeed;
  if (pk.length === 64) { root = pk.subarray(0, XN); pubSeed = pk.subarray(XN); }
  else if (pk.length === 68) {
    const oid = u32read(pk, 0);
    if (oid !== XOID) return { valid: false, reason: `OID 不符（${oid} ≠ ${XOID}，本工具仅支持 XMSS-SHA2_10_256）` };
    root = pk.subarray(4, 4 + XN); pubSeed = pk.subarray(4 + XN);
  } else {
    return { valid: false, reason: `公钥长度不符（应 64 或 68 字节，实得 ${pk.length}）` };
  }
  const sig = hexToBytes(sigHex);
  return xmssVerifyBytes(msg, sig, root, pubSeed);
}

/**
 * LMS/HSS 签名统一入口。
 * mode="lms"：单级（seed/I/q/C）。
 * mode="hss"：两级（顶层 seed/I/qTop/C2 + 底层 seed2/I2/q/C）。
 */
export function lmsSignFull(msg, p) {
  const lmsT = LMS_TYPES[p.h] || LMS_TYPES.h5;
  const otsw = LMOTS_TYPES[p.w] || LMOTS_TYPES.w8;
  if (p.mode === "hss") {
    // HSS 各级允许不同参数集（RFC 8554 §6：TC2 即顶层 h10/w4 + 底层 h5/w8）
    const lmsT2 = LMS_TYPES[p.h2] || LMS_TYPES.h5;
    const otsw2 = LMOTS_TYPES[p.w2] || LMOTS_TYPES.w8;
    const r = hssSign2(msg,
      { I: parseHexField(p.i, "顶层 I", 16), SEED: parseHexField(p.seed, "顶层 SEED", 32), lmsT, otsw, q: p.qTop, C: parseHexField(p.c2, "顶层 C", 32) },
      { I: parseHexField(p.i2, "底层 I", 16), SEED: parseHexField(p.seed2, "底层 SEED", 32), lmsT: lmsT2, otsw: otsw2, q: p.q, C: parseHexField(p.c, "底层 C", 32) });
    return { hssPub: r.hssPub, hssSig: r.hssSig };
  }
  const I = parseHexField(p.i, "I", 16);
  const SEED = parseHexField(p.seed, "SEED", 32);
  const C = parseHexField(p.c, "C", 32);
  const hashes = lmsOtsPubHashes(I, lmsT, otsw, SEED);
  const nodes = lmsTreeNodes(I, lmsT, hashes);
  const pk = lmsPubkeyBytes(I, lmsT, otsw, nodes);
  const sig = lmsSignBytes(msg, I, lmsT, otsw, SEED, p.q, hashes, nodes, C);
  return { pk, sig };
}

/** 验签统一入口：format="hss"（含 L=1）/ "lms"。 */
export function lmsVerifyFull(msg, pkHex, sigHex, format) {
  const pk = hexToBytes(pkHex);
  const sig = hexToBytes(sigHex);
  if (format === "lms") return lmsVerifyBytes(msg, sig, pk);
  return hssVerifyBytes(msg, sig, pk);
}

// ============================================================
// op 注册
// ============================================================

const ENC = new TextEncoder();
const MSG_MODE_OPTIONS = [
  { value: "text", label: "文本 (UTF-8)" },
  { value: "hex", label: "Hex" },
];

function msgBytes(t, mode) {
  const s0 = String(t == null ? "" : t);
  if (mode === "hex") return hexToBytes(s0.replace(/\s+/g, ""));
  return new TextEncoder().encode(s0);
}

const XMSS_KAT = {
  skSeed: "061550234D158C5EC95595FE04EF7A25767F2E24CC2BC479D09D86DC9ABCFDE7",
  skPrf: "056A8C266F9EF97ED08541DBD2E1FFA19810F5392D076276EF41277C3AB6E94A",
  pubSeed: "04562AD35E8ECAFAAFDA16981CDAA147606BEEA62801342AF13C8B5535F72F94",
  root: "B901B8D9332FE458EB6DE87AF74655D0B5AD936A66FDB6AC9D1B8CF25BB6DB84",
};

register({
  id: "xmssKeyGen", family: "xmss", familyLabel: "keygen",
  cat: "asym",
  name: "XMSS 密钥生成",
  desc: "RFC 8391 XMSS-SHA2_10_256（n=32,w=16,h=10）密钥对生成，纯 JS。SK_SEED/SK_PRF/PUB_SEED 各 32B hex 可固定复现；默认随机。树建房 2^10 个 WOTS+ 叶子（约百万次哈希，数秒）。⚠ 状态签名：idx 不可重用",
  params: [
    { key: "skSeed", label: "SK_SEED (hex 32B，留空随机)", type: "text", default: "", placeholder: XMSS_KAT.skSeed },
    { key: "skPrf", label: "SK_PRF (hex 32B，留空随机)", type: "text", default: "", placeholder: XMSS_KAT.skPrf },
    { key: "pubSeed", label: "PUB_SEED (hex 32B，留空随机)", type: "text", default: "", placeholder: XMSS_KAT.pubSeed },
  ],
  run: (_t, p = {}) => {
    const r = xmssKeyGenBytes(p.skSeed, p.skPrf, p.pubSeed);
    const fixed = String(p.skSeed || p.skPrf || p.pubSeed).trim() !== "";
    return {
      text: [
        "参数集: XMSS-SHA2_10_256 (n=32, w=16, len=67, h=10, OID 0x00000001)",
        `SK_SEED: ${bytesToHex(r.skSeed)}`,
        `SK_PRF:  ${bytesToHex(r.skPrf)}`,
        `PUB_SEED: ${bytesToHex(r.pubSeed)}`,
        `root: ${bytesToHex(r.root)}`,
        "",
        `公钥 pk (${r.pkOid.length}B = OID‖root‖PUB_SEED):`,
        bytesToHex(r.pkOid),
        "",
        "⚠ 状态签名：每签一条消息消耗一个 index（0..1023），index 重用=私钥泄露。",
        fixed ? "（固定种子 → 可复现官方 KAT 向量）" : "（本次为随机种子）",
      ].join("\n"),
    };
  },
});

register({
  id: "xmssSign", family: "xmss", familyLabel: "sign",
  cat: "asym",
  name: "XMSS 签名",
  desc: "RFC 8391 XMSS-SHA2_10_256 签名：R=PRF(SK_PRF,idx)，M'=H_msg(R‖root‖idx‖M)，WOTS+ 签 M' + 认证路径。签名 2500B=idx(4)‖R‖WOTS(2144)‖auth(320)。⚠ 真实使用必须维护 state，index 重用=私钥泄露",
  params: [
    { key: "skSeed", label: "SK_SEED (hex 32B)", type: "text", default: "", placeholder: XMSS_KAT.skSeed },
    { key: "skPrf", label: "SK_PRF (hex 32B)", type: "text", default: "", placeholder: XMSS_KAT.skPrf },
    { key: "pubSeed", label: "PUB_SEED (hex 32B)", type: "text", default: "", placeholder: XMSS_KAT.pubSeed },
    { key: "root", label: "root (hex 32B，密钥生成输出)", type: "text", default: "", placeholder: XMSS_KAT.root },
    { key: "idx", label: "签名 index (0..1023，不可重用)", type: "number", default: 0 },
    { key: "msgMode", label: "消息形式", type: "select", default: "text", options: MSG_MODE_OPTIONS },
  ],
  run: (t, p = {}) => {
    const msg = msgBytes(t, p.msgMode);
    const r = xmssSignFull(msg, p.skSeed, p.skPrf, p.pubSeed, p.root, Number(p.idx));
    return {
      text: [
        "参数集: XMSS-SHA2_10_256 (n=32, w=16, len=67, h=10)",
        `消息 M: ${msg.length} B（${p.msgMode === "hex" ? "hex" : "UTF-8"}）`,
        `index idx_sig: ${Number(p.idx)}（已消耗，不可再用）`,
        `签名 Sig (${r.sig.length} B = idx4 ‖ R32 ‖ WOTS+2144 ‖ auth320):`,
        bytesToHex(r.sig),
        "",
        "⚠ 真实使用须把 index +1 持久化到 state 后才能输出签名。",
      ].join("\n"),
      files: [
        { name: `xmss_sha2_10_256_idx${Number(p.idx)}.sig`, mime: "application/octet-stream", bytes: r.sig },
      ],
    };
  },
});

register({
  id: "xmssVerify", family: "xmss", familyLabel: "verify",
  cat: "asym",
  name: "XMSS 验签",
  desc: "RFC 8391 XMSS-SHA2_10_256 验签：WOTS_pkFromSig → L-tree → 认证路径重算根节点，比对公钥 root。pk 64B（root‖PUB_SEED）或 68B（含 OID）。签名长度不符/index 超界直接判非法",
  params: [
    { key: "pk", label: "公钥 pk (hex 64B 或 68B 带 OID)", type: "text", default: "", placeholder: "root‖PUB_SEED 或 OID‖root‖PUB_SEED" },
    { key: "sig", label: "签名 Sig (hex 2500B)", type: "text", default: "", placeholder: "签名输出的 Sig hex" },
    { key: "msgMode", label: "消息形式", type: "select", default: "text", options: MSG_MODE_OPTIONS },
  ],
  run: (t, p = {}) => {
    const msg = msgBytes(t, p.msgMode);
    const r = xmssVerifyFull(msg, p.pk, p.sig);
    const lines = [
      "参数集: XMSS-SHA2_10_256 (n=32, w=16, len=67, h=10)",
      `消息 M: ${msg.length} B（${p.msgMode === "hex" ? "hex" : "UTF-8"}）`,
    ];
    if (r.idx != null) lines.push(`签名 index: ${r.idx}`);
    lines.push(`结论: ${r.valid ? "✓ 合法（验证通过）" : "✗ 不合法"} — ${r.reason}`);
    return { text: lines.join("\n") };
  },
});

const LMS_KAT2 = {
  seedTop: "558b8966c48ae9cb898b423c83443aae014a72f1b1ab5cc85cf1d892903b5439",
  iTop: "d08fabd4a2091ff0a8cb4ed834e74534",
  seedBot: "a1c4696e2608035a886100d05cd99945eb3370731884a8235e2fb3d4d71f2547",
  iBot: "215f83b7ccb9acbcd08db97b0d04dc2b",
};

register({
  id: "lmsSign", family: "lms", familyLabel: "sign",
  cat: "asym",
  name: "LMS/HSS 签名",
  desc: "RFC 8554 LMS 单级或 HSS 两级签名（SHA-256，h=5/10，w=4/8），私钥按 Appendix A 从 SEED 伪随机派生（x=H(I‖q‖i‖0xff‖SEED)）。SEED/I/C 固定即可复现官方向量（TC2 口径）。⚠ 状态签名：q 不可重用",
  params: [
    { key: "mode", label: "签名模式", type: "select", default: "hss", options: [
      { value: "hss", label: "HSS 两级（RFC 8554 TC 口径）" },
      { value: "lms", label: "LMS 单级" },
    ] },
    { key: "h", label: "顶层/单级树高 h", type: "select", default: "h5", options: [
      { value: "h5", label: "LMS_SHA256_M32_H5 (type 5)" },
      { value: "h10", label: "LMS_SHA256_M32_H10 (type 6, 慢)" },
    ] },
    { key: "w", label: "顶层/单级 Winternitz w", type: "select", default: "w8", options: [
      { value: "w8", label: "LMOTS_SHA256_N32_W8 (type 4, p=34)" },
      { value: "w4", label: "LMOTS_SHA256_N32_W4 (type 3, p=67)" },
    ] },
    { key: "h2", label: "底层树高 h（仅 HSS，可与顶层不同）", type: "select", default: "h5", options: [
      { value: "h5", label: "LMS_SHA256_M32_H5 (type 5)" },
      { value: "h10", label: "LMS_SHA256_M32_H10 (type 6, 慢)" },
    ] },
    { key: "w2", label: "底层 Winternitz w（仅 HSS）", type: "select", default: "w8", options: [
      { value: "w8", label: "LMOTS_SHA256_N32_W8 (type 4, p=34)" },
      { value: "w4", label: "LMOTS_SHA256_N32_W4 (type 3, p=67)" },
    ] },
    { key: "seed", label: "顶层 SEED (hex 32B)", type: "text", default: "", placeholder: LMS_KAT2.seedTop },
    { key: "i", label: "顶层 I (hex 16B)", type: "text", default: "", placeholder: LMS_KAT2.iTop },
    { key: "qTop", label: "顶层 index q（签底层公钥用）", type: "number", default: 3 },
    { key: "c2", label: "顶层随机数 C (hex 32B)", type: "text", default: "", placeholder: "官方 TC2 顶层 C 可留空随机" },
    { key: "seed2", label: "底层 SEED (hex 32B，仅 HSS)", type: "text", default: "", placeholder: LMS_KAT2.seedBot },
    { key: "i2", label: "底层 I (hex 16B，仅 HSS)", type: "text", default: "", placeholder: LMS_KAT2.iBot },
    { key: "q", label: "底层/单级 index q（签消息用，不可重用）", type: "number", default: 0 },
    { key: "c", label: "底层/单级随机数 C (hex 32B)", type: "text", default: "", placeholder: "官方 TC2 底层 C 可留空随机" },
    { key: "msgMode", label: "消息形式", type: "select", default: "text", options: MSG_MODE_OPTIONS },
  ],
  run: (t, p = {}) => {
    const msg = msgBytes(t, p.msgMode);
    const r = lmsSignFull(msg, p);
    const nm = (s) => (s === "h10" ? "H10" : "H5");
    const nw = (s) => (s === "w8" ? "W8" : "W4");
    if (p.mode === "hss") {
      return {
        text: [
          `参数集: HSS L=2, 顶层 LMS_SHA256_M32_${nm(p.h)}/${nw(p.w)} + 底层 LMS_SHA256_M32_${nm(p.h2)}/${nw(p.w2)}`,
          `消息 M: ${msg.length} B（${p.msgMode === "hex" ? "hex" : "UTF-8"}）`,
          `顶层 q=${Number(p.qTop)}（签底层公钥），底层 q=${Number(p.q)}（签消息，已消耗）`,
          `HSS 公钥 (${r.hssPub.length}B = levels‖LMS type‖LMOTS type‖I‖K):`,
          bytesToHex(r.hssPub),
          `HSS 签名 (${r.hssSig.length}B):`,
          bytesToHex(r.hssSig),
          "",
          "⚠ 真实使用必须持久化各层 q state；index 重用=私钥泄露。",
        ].join("\n"),
        files: [
          { name: "hss.pub", mime: "application/octet-stream", bytes: r.hssPub },
          { name: "hss.sig", mime: "application/octet-stream", bytes: r.hssSig },
        ],
      };
    }
    return {
      text: [
        `参数集: ${lmsName} + ${otsName}（单级 LMS）`,
        `消息 M: ${msg.length} B（${p.msgMode === "hex" ? "hex" : "UTF-8"}）`,
        `index q=${Number(p.q)}（已消耗，不可再用）`,
        `LMS 公钥 (${r.pk.length}B):`,
        bytesToHex(r.pk),
        `LMS 签名 (${r.sig.length}B):`,
        bytesToHex(r.sig),
        "",
        "⚠ 真实使用必须持久化 q state；index 重用=私钥泄露。",
      ].join("\n"),
      files: [
        { name: "lms.pub", mime: "application/octet-stream", bytes: r.pk },
        { name: "lms.sig", mime: "application/octet-stream", bytes: r.sig },
      ],
    };
  },
});

register({
  id: "lmsVerify", family: "lms", familyLabel: "verify",
  cat: "asym",
  name: "LMS/HSS 验签",
  desc: "RFC 8554 验签：HSS 多级（逐层 LMS 验签，签名自描述解析）或 LMS 单级。LM-OTS 公钥候选 Kc → D_LEAF/D_INTR 逐层重算根 → 比对 K。支持官方向量 TC1/TC2 的公钥+签名直接粘贴",
  params: [
    { key: "format", label: "签名/公钥格式", type: "select", default: "hss", options: [
      { value: "hss", label: "HSS（Nspk 前缀，含 L=1）" },
      { value: "lms", label: "LMS 单级" },
    ] },
    { key: "pk", label: "公钥 (hex：HSS 60B / LMS 56B)", type: "text", default: "", placeholder: "levels‖LMS type‖LMOTS type‖I‖K" },
    { key: "sig", label: "签名 (hex)", type: "text", default: "", placeholder: "HSS/LMS 签名 hex" },
    { key: "msgMode", label: "消息形式", type: "select", default: "text", options: MSG_MODE_OPTIONS },
  ],
  run: (t, p = {}) => {
    const msg = msgBytes(t, p.msgMode);
    const r = lmsVerifyFull(msg, p.pk, p.sig, p.format);
    return {
      text: [
        "参数集: RFC 8554（SHA-256 系，签名自描述解析 typecode）",
        `消息 M: ${msg.length} B（${p.msgMode === "hex" ? "hex" : "UTF-8"}）`,
        `结论: ${r.valid ? "✓ 合法（验证通过）" : "✗ 不合法"} — ${r.reason}`,
      ].join("\n"),
    };
  },
});
