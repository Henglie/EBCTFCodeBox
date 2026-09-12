/*
 * cmac.js — CMAC / KMAC 消息认证码组（T348 批B3，cat:'hash'）。
 *
 * op：
 *   - aesCmac   AES-CMAC（RFC 4493，AES-128，子密钥 K1/K2 生成 + MBDW 块处理）
 *   - sm4Cmac   SM4-CMAC（GB/T 32907-2016 的 SM4 块 + ISO/IEC 9797-1 MAC 结构，
 *               子密钥推导与 RFC 4493 同构：左移一位 + MSB 进位则异或 Rb=0x87）
 *   - kmac      KMAC128 / KMAC256（NIST SP 800-185 §4.3，基于 cSHAKE128/256）
 *
 * 复用（不复制）：
 *   - modern.js   makeAes(key).encBlock  — AES 单块加密（FIPS 197，AES-128）
 *   - modernExt.js sm4EncryptBlock      — SM4 单块加密（GB/T 32907-2016）
 *   - hash.js     keccakF1600           — Keccak-f[1600] 置换（FIPS 202），
 *                 cSHAKE 海绵（多字节 pad 起始串，SP 800-185 §2.4）本文件自实现
 *
 * 参考：
 *   RFC 4493 (AES-CMAC)、NIST SP 800-185 §2.3/§2.4/§4.3 (encode_string/bytepad/cSHAKE/KMAC)、
 *   FIPS 202 (Keccak)、GB/T 32907-2016 (SM4)、ISO/IEC 9797-1 (CMAC 结构)。
 */

import { register } from "./registry.js";
import { makeAes } from "./modern.js";
import { sm4EncryptBlock } from "./modernExt.js";
import { keccakF1600 } from "./hash.js";

// ============================================================
// 字节工具
// ============================================================
const te = (s) => new TextEncoder().encode(s);

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

/** 消息输入（hex 或 text）→ 字节。 */
function msgToBytes(text, enc) {
  if (enc === "hex") {
    const b = hexToBytes(text);
    return b;
  }
  return te(String(text == null ? "" : text));
}

/**
 * GF(2^128) 乘 x（RFC 4493 §2.3 doubling）：大端 128 位整体左移 1 位。
 * 高位字节在低地址：out[i] 低 LSB ← b[i+1] 的 MSB（进位从低地址字节流向高地址字节）；
 * 原 MSB（b[0]>>7）为 1 则溢出，最低字节（末字节）异或 Rb。
 */
function shiftLeftDbl(b, rb) {
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) {
    out[i] = ((b[i] << 1) | (i + 1 < b.length ? b[i + 1] >> 7 : 0)) & 0xff;
  }
  if (b[0] >> 7) out[b.length - 1] ^= rb;
  return out;
}

/** 16 字节异或。 */
function xor16(a, b) {
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = a[i] ^ b[i];
  return out;
}

// ============================================================
// CMAC 核心（RFC 4493 / ISO/IEC 9797-1，任意 128 位分组密码通用）
// ============================================================
/**
 * 通用 CMAC（分组 16 字节）。encBlock(b16)->b16 为分组密码单块加密。
 * RFC 4493 §2.3 子密钥 + §2.4 MBDW。
 */
function cmacGeneric(encBlock, msg, rb) {
  // 子密钥：L = CIPH_K(0^128)；K1 = L<<1(⊕Rb)；K2 = K1<<1(⊕Rb)
  const L = encBlock(new Uint8Array(16));
  const K1 = shiftLeftDbl(L, rb);
  const K2 = shiftLeftDbl(K1, rb);

  // MBDW：n = ceil(len/16)，空消息 n=1
  const len = msg.length;
  const n = Math.max(1, Math.ceil(len / 16));
  const lastLen = len === 0 ? 0 : len - (n - 1) * 16;

  // 末块：整块 → M_n ⊕ K1；不完整/空 → pad10* 后 ⊕ K2（RFC 4493 §2.4 M_last）
  let M_last = new Uint8Array(16);
  if (lastLen === 16) {
    M_last = xor16(msg.subarray((n - 1) * 16), K1);
  } else {
    const padded = new Uint8Array(16);
    padded.set(msg.subarray((n - 1) * 16), 0);
    padded[lastLen] = 0x80; // pad10*
    M_last = xor16(padded, K2);
  }

  // X_0 = 0^128；X_i = CIPH_K(X_{i-1} ⊕ M_i)
  let X = new Uint8Array(16);
  for (let i = 0; i < n - 1; i++) {
    X = encBlock(xor16(X, msg.subarray(i * 16, i * 16 + 16)));
  }
  return encBlock(xor16(X, M_last)); // T = CIPH_K(X_{n-1} ⊕ M_last)
}

/** AES-CMAC（RFC 4493）。key 16 字节。 */
export function aesCmacBytes(key, msg) {
  if (key.length !== 16) throw new Error(`AES-CMAC 密钥须为 16 字节 hex（RFC 4493 限 AES-128），当前 ${key.length} 字节`);
  const { encBlock } = makeAes(key);
  return cmacGeneric(encBlock, msg, 0x87);
}

/** SM4-CMAC（GB/T 32907-2016 SM4 块 + ISO/IEC 9797-1 MAC 结构，Rb=0x87）。key 16 字节。 */
export function sm4CmacBytes(key, msg) {
  if (key.length !== 16) throw new Error(`SM4-CMAC 密钥须为 16 字节 hex，当前 ${key.length} 字节`);
  return cmacGeneric((b) => sm4EncryptBlock(b, key), msg, 0x87);
}

// ============================================================
// cSHAKE / KMAC（NIST SP 800-185，Keccak-f[1600] 复用 hash.js）
// ============================================================
/** left_encode(x)（SP 800-185 §2.3.1）：[字节数 n] || x 大端（n 最小）。 */
function leftEncode(x) {
  if (x < 0) throw new Error("left_encode 仅支持非负整数");
  const bytes = [];
  let v = x;
  do { bytes.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
  return Uint8Array.from([bytes.length, ...bytes]);
}

/** right_encode(x)（SP 800-185 §2.3.2）：x 大端 || [字节数 n]。 */
function rightEncode(x) {
  if (x < 0) throw new Error("right_encode 仅支持非负整数");
  const bytes = [];
  let v = x;
  do { bytes.unshift(v & 0xff); v = Math.floor(v / 256); } while (v > 0);
  return Uint8Array.from([...bytes, bytes.length]);
}

/** encode_string(s)（SP 800-185 §2.3.3）：left_encode(8·len) || s。 */
function encodeString(b) {
  const n = leftEncode(b.length * 8);
  const out = new Uint8Array(n.length + b.length);
  out.set(n, 0);
  out.set(b, n.length);
  return out;
}

/** bytepad(X, w)（SP 800-185 §2.3.4）：left_encode(w) || X || 0*，凑到 w 字节的整数倍。 */
function bytepad(X, w) {
  const head = leftEncode(w);
  const zlen = Math.ceil((head.length + X.length) / w) * w;
  const out = new Uint8Array(zlen);
  out.set(head, 0);
  out.set(X, head.length);
  return out;
}

function concatBytes(...arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

/**
 * Keccak 海绵（域分隔字节 + pad10*1，FIPS 202 §5.1）。
 * padStart 为域字节：SHA3=0x06 / Keccak=0x01 / SHAKE=0x1f / cSHAKE=0x04（SP 800-185 §3.3）。
 * 状态表示与 hash.js keccak() 相同：sLo/sHi 双 32 位模拟 64 位 × 25 lane（结构等价已对拍验证）。
 */
function sponge(rate, padStart, msg, outLen) {
  const sLo = new Array(25).fill(0);
  const sHi = new Array(25).fill(0);
  const msgLen = msg.length;
  const padLen = rate - ((msgLen + padStart.length) % rate); // 1..rate（含与 0x80 合并的尾字节）
  const padded = new Uint8Array(msgLen + padStart.length + padLen);
  padded.set(msg, 0);
  padded.set(padStart, msgLen);
  padded[padded.length - 1] |= 0x80; // pad10*1 尾 1（与 padStart 尾字节重叠时自动合并）
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate; i += 8) {
      const li = i >> 3;
      const p = off + i;
      const lo = (padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24)) >>> 0;
      const hi = (padded[p + 4] | (padded[p + 5] << 8) | (padded[p + 6] << 16) | (padded[p + 7] << 24)) >>> 0;
      sLo[li] = (sLo[li] ^ lo) >>> 0;
      sHi[li] = (sHi[li] ^ hi) >>> 0;
    }
    keccakF1600(sLo, sHi);
  }
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

/**
 * cSHAKE（SP 800-185 §3.3）。
 * 域分隔（FIPS 202 pad10*1 首字节）：SHA3=0x06（01+1）、SHAKE=0x1F（1111+1）、
 * cSHAKE=0x04（00+1）。N/S 经 bytepad(encode_string(N) || encode_string(S), w) 前缀吸收，
 * N、S 均空时退化为 SHAKE（0x1F）。已对 NIST KMAC_samples.pdf 全六条样例验证。
 */
function cshake(X, L, N, S, rate) {
  if (N.length === 0 && S.length === 0) {
    return sponge(rate, [0x1f], X, L);
  }
  const prefix = bytepad(concatBytes(encodeString(N), encodeString(S)), rate);
  return sponge(rate, [0x04], concatBytes(prefix, X), L);
}

/**
 * KMAC（NIST SP 800-185 §4.3）：
 * Step 1-2: newKMAC = bytepad(encode_string(K), w)（w = rate 字节，只含密钥 K）；
 * Step 3: newInput = newKMAC || X || right_encode(L)，L 为输出**位数**；
 * Step 4: KMAC[K](X, L, S) = cSHAKE(newInput, L, "KMAC", S)（S 作 cSHAKE 定制串传入）。
 * KMAC128 → cSHAKE128（rate=168 字节）；KMAC256 → cSHAKE256（rate=136 字节）。
 */
export function kmacBytes(bits, key, msg, L, customization) {
  if (bits !== 128 && bits !== 256) throw new Error(`KMAC 位数须为 128 或 256（SP 800-185），当前 ${bits}`);
  const rate = bits === 128 ? 168 : 136;
  const S = te(String(customization == null ? "" : customization));
  const newKmac = bytepad(encodeString(key), rate);
  const input = concatBytes(newKmac, msg, rightEncode(L * 8)); // L 按位计（SP 800-185 §4.3）
  return cshake(input, L, te("KMAC"), S, rate);
}

// ============================================================
// op 1 · aesCmac（RFC 4493）
// ============================================================
function aesCmacRun(text, p = {}) {
  const key = hexToBytes(p.key);
  const msg = msgToBytes(text, p.msgEnc || "hex");
  const mac = aesCmacBytes(key, msg);
  const L = [];
  L.push("=== AES-CMAC（RFC 4493） ===");
  L.push(`密钥 (hex, ${key.length} B) = ${bytesToHex(key)}`);
  L.push(`消息 (${p.msgEnc || "hex"}, ${msg.length} B) = ${p.msgEnc === "hex" ? bytesToHex(msg) : JSON.stringify(String(text))}`);
  L.push("");
  L.push(`T = AES-CMAC(K, M) = ${bytesToHex(mac)}`);
  return L.join("\n");
}

// ============================================================
// op 2 · sm4Cmac（GB/T 32907-2016 SM4 块 + ISO/IEC 9797-1）
// ============================================================
function sm4CmacRun(text, p = {}) {
  const key = hexToBytes(p.key);
  const msg = msgToBytes(text, p.msgEnc || "hex");
  const mac = sm4CmacBytes(key, msg);
  const L = [];
  L.push("=== SM4-CMAC（SM4 块 + ISO/IEC 9797-1 结构） ===");
  L.push(`密钥 (hex, ${key.length} B) = ${bytesToHex(key)}`);
  L.push(`消息 (${p.msgEnc || "hex"}, ${msg.length} B) = ${p.msgEnc === "hex" ? bytesToHex(msg) : JSON.stringify(String(text))}`);
  L.push("");
  L.push(`T = SM4-CMAC(K, M) = ${bytesToHex(mac)}`);
  return L.join("\n");
}

// ============================================================
// op 3 · kmac（NIST SP 800-185 §4.3）
// ============================================================
function kmacRun(text, p = {}) {
  const bits = Number(p.bits || 128);
  const key = hexToBytes(p.key);
  if (!key.length) throw new Error("缺少参数 key（hex）");
  const L = Math.max(1, Number(p.outLen || 32));
  const msg = msgToBytes(text, p.msgEnc || "hex");
  const mac = kmacBytes(bits, key, msg, L, p.customization || "");
  const out = [];
  out.push(`=== KMAC${bits}（NIST SP 800-185 §4.3，cSHAKE${bits}） ===`);
  out.push(`密钥 (hex, ${key.length} B) = ${bytesToHex(key)}`);
  out.push(`定制串 S = ${JSON.stringify(String(p.customization || ""))}`);
  out.push(`消息 (${p.msgEnc || "hex"}, ${msg.length} B) = ${p.msgEnc === "hex" ? bytesToHex(msg) : JSON.stringify(String(text))}`);
  out.push(`输出长度 L = ${L} 字节`);
  out.push("");
  out.push(`KMAC${bits}(K, X, L, S) = ${bytesToHex(mac)}`);
  return out.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "aesCmac", family: "aes", familyLabel: "cmac",
  cat: "block",
  name: "AES-CMAC",
  desc: "AES-CMAC 消息认证码（RFC 4493，AES-128）",
  params: [
    { key: "key", label: "密钥 K (hex, 16B)", type: "text", default: "2b7e151628aed2a6abf7158809cf4f3c", placeholder: "RFC 4493 测试密钥" },
    { key: "msgEnc", label: "消息编码", type: "select", default: "hex", options: ["hex", "text"] },
  ],
  run: aesCmacRun,
});

register({
  id: "sm4Cmac", family: "sm4", familyLabel: "cmac",
  cat: "block",
  name: "SM4-CMAC",
  desc: "SM4-CMAC 消息认证码（SM4 块 + ISO/IEC 9797-1 结构）",
  params: [
    { key: "key", label: "密钥 K (hex, 16B)", type: "text", default: "0123456789abcdeffedcba9876543210", placeholder: "GB/T 32907-2016 附录 A 测试密钥" },
    { key: "msgEnc", label: "消息编码", type: "select", default: "hex", options: ["hex", "text"] },
  ],
  run: sm4CmacRun,
});

register({
  id: "kmac",
  cat: "hash",
  name: "KMAC",
  desc: "KMAC128/KMAC256 消息认证码（NIST SP 800-185，cSHAKE）",
  params: [
    { key: "bits", label: "位数", type: "select", default: "128", options: ["128", "256"] },
    { key: "key", label: "密钥 K (hex)", type: "text", default: "404142434445464748494a4b4c4d4e4f", placeholder: "NIST 样例密钥 40..4F (16B)" },
    { key: "customization", label: "定制串 S (text)", type: "text", default: "" },
    { key: "msgEnc", label: "消息编码", type: "select", default: "hex", options: ["hex", "text"] },
    { key: "outLen", label: "输出长度 L (字节)", type: "number", default: 32 },
  ],
  run: kmacRun,
});
