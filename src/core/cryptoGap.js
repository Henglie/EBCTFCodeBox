/*
 * cryptoGap.js — 密码学缺口补全（对标 CyberChef / 同类工具真缺口）。
 *
 * 本模块自注册以下 op（模块加载即 register）：
 * - rc2 RC2 对称加解密（RFC 2268，ECB/CBC，纯 JS） cat: modern
 * - lmHash Windows LM Hash（复用 modern.js makeDes） cat: hash
 * - evpBytesToKey OpenSSL EVP_BytesToKey 密钥派生（复用 hash.js md5）cat: hash
 *
 * 红线：
 * - RC2 照 RFC 2268 实现（含官方 PITABLE + 官方测试向量），不许编造。
 * - LM Hash 复用 DES 内核（makeDes.encBlock），自写 expand7to8 + KGS!@#$% 固定明文。
 * - EVP_BytesToKey 复用 md5Bytes（md5）+ WebCrypto（sha1/sha256）。
 * - 零外发：纯本地计算。core 层零 UI 依赖（仅 registry）。
 */
import { register } from "./registry.js";
import { makeDes } from "./modern.js";
import { md5Bytes } from "./hash.js";

// ============================================================
// 编码工具（本模块自带，与 modern.js 契约一致；modern 内部未导出故自备）
// ============================================================
const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度必须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function b64ToBytes(s) {
  const bin = atob(s.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(b) {
  let bin = "";
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin);
}
function decodeInput(text, enc) {
  switch (enc) {
    case "hex": return hexToBytes(text);
    case "base64": return b64ToBytes(text);
    case "latin1": { const o = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) o[i] = text.charCodeAt(i) & 0xff; return o; }
    case "utf8":
    default: return te(text);
  }
}
function encodeOutput(bytes, enc) {
  switch (enc) {
    case "hex": return bytesToHex(bytes);
    case "base64": return bytesToB64(bytes);
    case "latin1": { let s = ""; for (const x of bytes) s += String.fromCharCode(x); return s; }
    case "utf8":
    default: return td(bytes);
  }
}
function concatBytes(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// PKCS#7
function pkcs7Pad(data, bs) {
  const padLen = bs - (data.length % bs);
  const out = new Uint8Array(data.length + padLen);
  out.set(data);
  out.fill(padLen, data.length);
  return out;
}
function pkcs7Unpad(data, bs) {
  if (data.length === 0 || data.length % bs !== 0) throw new Error("密文长度非法（PKCS#7）");
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > bs) throw new Error("PKCS#7 填充非法");
  return data.subarray(0, data.length - padLen);
}

// ============================================================
// RC2（RFC 2268）
// ============================================================
// RFC 2268 官方 PITABLE（256 字节置换表），逐字节照抄，不许改。
const RC2_PITABLE = new Uint8Array([
  0xd9, 0x78, 0xf9, 0xc4, 0x19, 0xdd, 0xb5, 0xed, 0x28, 0xe9, 0xfd, 0x79, 0x4a, 0xa0, 0xd8, 0x9d,
  0xc6, 0x7e, 0x37, 0x83, 0x2b, 0x76, 0x53, 0x8e, 0x62, 0x4c, 0x64, 0x88, 0x44, 0x8b, 0xfb, 0xa2,
  0x17, 0x9a, 0x59, 0xf5, 0x87, 0xb3, 0x4f, 0x13, 0x61, 0x45, 0x6d, 0x8d, 0x09, 0x81, 0x7d, 0x32,
  0xbd, 0x8f, 0x40, 0xeb, 0x86, 0xb7, 0x7b, 0x0b, 0xf0, 0x95, 0x21, 0x22, 0x5c, 0x6b, 0x4e, 0x82,
  0x54, 0xd6, 0x65, 0x93, 0xce, 0x60, 0xb2, 0x1c, 0x73, 0x56, 0xc0, 0x14, 0xa7, 0x8c, 0xf1, 0xdc,
  0x12, 0x75, 0xca, 0x1f, 0x3b, 0xbe, 0xe4, 0xd1, 0x42, 0x3d, 0xd4, 0x30, 0xa3, 0x3c, 0xb6, 0x26,
  0x6f, 0xbf, 0x0e, 0xda, 0x46, 0x69, 0x07, 0x57, 0x27, 0xf2, 0x1d, 0x9b, 0xbc, 0x94, 0x43, 0x03,
  0xf8, 0x11, 0xc7, 0xf6, 0x90, 0xef, 0x3e, 0xe7, 0x06, 0xc3, 0xd5, 0x2f, 0xc8, 0x66, 0x1e, 0xd7,
  0x08, 0xe8, 0xea, 0xde, 0x80, 0x52, 0xee, 0xf7, 0x84, 0xaa, 0x72, 0xac, 0x35, 0x4d, 0x6a, 0x2a,
  0x96, 0x1a, 0xd2, 0x71, 0x5a, 0x15, 0x49, 0x74, 0x4b, 0x9f, 0xd0, 0x5e, 0x04, 0x18, 0xa4, 0xec,
  0xc2, 0xe0, 0x41, 0x6e, 0x0f, 0x51, 0xcb, 0xcc, 0x24, 0x91, 0xaf, 0x50, 0xa1, 0xf4, 0x70, 0x39,
  0x99, 0x7c, 0x3a, 0x85, 0x23, 0xb8, 0xb4, 0x7a, 0xfc, 0x02, 0x36, 0x5b, 0x25, 0x55, 0x97, 0x31,
  0x2d, 0x5d, 0xfa, 0x98, 0xe3, 0x8a, 0x92, 0xae, 0x05, 0xdf, 0x29, 0x10, 0x67, 0x6c, 0xba, 0xc9,
  0xd3, 0x00, 0xe6, 0xcf, 0xe1, 0x9e, 0xa8, 0x2c, 0x63, 0x16, 0x01, 0x3f, 0x58, 0xe2, 0x89, 0xa9,
  0x0d, 0x38, 0x34, 0x1b, 0xab, 0x33, 0xff, 0xb0, 0xbb, 0x48, 0x0c, 0x5f, 0xb9, 0xb1, 0xcd, 0x2e,
  0xc5, 0xf3, 0xdb, 0x47, 0xe5, 0xa5, 0x9c, 0x77, 0x0a, 0xa6, 0x20, 0x68, 0xfe, 0x7f, 0xc1, 0xad,
]);
const RC2_S = [1, 2, 3, 5]; // 各字位置的循环左移量

/**
 * RC2 密钥扩展（RFC 2268 §2）。
 * @param {Uint8Array} key 1..128 字节密钥
 * @param {number} effBits 有效密钥位数 T1（1..1024）
 * @returns {Uint16Array} 64 个 16 位密钥字 K[0..63]
 */
export function rc2KeyExpand(key, effBits) {
  const T = key.length;
  if (T < 1 || T > 128) throw new Error("RC2 密钥长度须为 1..128 字节");
  const T1 = effBits;
  const T8 = (T1 + 7) >>> 3;
  const TM = 0xff >>> ((8 - (T1 & 7)) & 7); // = 255 MOD 2^(8 + T1 - 8*T8)
  const L = new Uint8Array(128);
  L.set(key.subarray(0, T));
  for (let i = T; i < 128; i++) {
    L[i] = RC2_PITABLE[(L[i - 1] + L[i - T]) & 0xff];
  }
  L[128 - T8] = RC2_PITABLE[L[128 - T8] & TM];
  for (let i = 128 - T8 - 1; i >= 0; i--) {
    L[i] = RC2_PITABLE[L[i + 1] ^ L[i + T8]];
  }
  const K = new Uint16Array(64);
  for (let i = 0; i < 64; i++) K[i] = L[2 * i] | (L[2 * i + 1] << 8);
  return K;
}

/** RC2 单块加密（8 字节，小端字序）。 */
export function rc2EncryptBlock(block, K) {
  const R = [
    block[0] | (block[1] << 8),
    block[2] | (block[3] << 8),
    block[4] | (block[5] << 8),
    block[6] | (block[7] << 8),
  ];
  let j = 0;
  const mix = () => {
    for (let i = 0; i < 4; i++) {
      const im1 = (i + 3) & 3, im2 = (i + 2) & 3, im3 = (i + 1) & 3;
      R[i] = (R[i] + K[j] + (R[im1] & R[im2]) + (~R[im1] & R[im3])) & 0xffff;
      j++;
      const s = RC2_S[i];
      R[i] = ((R[i] << s) | (R[i] >>> (16 - s))) & 0xffff;
    }
  };
  const mash = () => {
    for (let i = 0; i < 4; i++) {
      const im1 = (i + 3) & 3;
      R[i] = (R[i] + K[R[im1] & 63]) & 0xffff;
    }
  };
  for (let r = 0; r < 5; r++) mix();
  mash();
  for (let r = 0; r < 6; r++) mix();
  mash();
  for (let r = 0; r < 5; r++) mix();
  const out = new Uint8Array(8);
  for (let i = 0; i < 4; i++) { out[2 * i] = R[i] & 0xff; out[2 * i + 1] = (R[i] >>> 8) & 0xff; }
  return out;
}

/** RC2 单块解密（8 字节，小端字序）。 */
export function rc2DecryptBlock(block, K) {
  const R = [
    block[0] | (block[1] << 8),
    block[2] | (block[3] << 8),
    block[4] | (block[5] << 8),
    block[6] | (block[7] << 8),
  ];
  let j = 63;
  const rmix = () => {
    for (let i = 3; i >= 0; i--) {
      const s = RC2_S[i];
      R[i] = ((R[i] >>> s) | (R[i] << (16 - s))) & 0xffff;
      const im1 = (i + 3) & 3, im2 = (i + 2) & 3, im3 = (i + 1) & 3;
      R[i] = (R[i] - K[j] - (R[im1] & R[im2]) - (~R[im1] & R[im3])) & 0xffff;
      j--;
    }
  };
  const rmash = () => {
    for (let i = 3; i >= 0; i--) {
      const im1 = (i + 3) & 3;
      R[i] = (R[i] - K[R[im1] & 63]) & 0xffff;
    }
  };
  for (let r = 0; r < 5; r++) rmix();
  rmash();
  for (let r = 0; r < 6; r++) rmix();
  rmash();
  for (let r = 0; r < 5; r++) rmix();
  const out = new Uint8Array(8);
  for (let i = 0; i < 4; i++) { out[2 * i] = R[i] & 0xff; out[2 * i + 1] = (R[i] >>> 8) & 0xff; }
  return out;
}

// RC2 分组模式包装（ECB / CBC + PKCS#7）
function rc2ModeEncrypt(data, K, mode, iv) {
  const padded = pkcs7Pad(data, 8);
  const out = new Uint8Array(padded.length);
  let prev = iv;
  for (let off = 0; off < padded.length; off += 8) {
    let blk = padded.subarray(off, off + 8);
    if (mode === "CBC") {
      const x = new Uint8Array(8);
      for (let i = 0; i < 8; i++) x[i] = blk[i] ^ prev[i];
      blk = x;
    }
    const ct = rc2EncryptBlock(blk, K);
    out.set(ct, off);
    prev = ct;
  }
  return out;
}
function rc2ModeDecrypt(data, K, mode, iv) {
  if (data.length === 0 || data.length % 8 !== 0) throw new Error("RC2 密文长度须为 8 的倍数");
  const out = new Uint8Array(data.length);
  let prev = iv;
  for (let off = 0; off < data.length; off += 8) {
    const ct = data.subarray(off, off + 8);
    let pt = rc2DecryptBlock(ct, K);
    if (mode === "CBC") {
      for (let i = 0; i < 8; i++) pt[i] = pt[i] ^ prev[i];
      prev = ct;
    }
    out.set(pt, off);
  }
  return pkcs7Unpad(out, 8);
}

const RC2_ENC_OPTS = [
  { value: "utf8", label: "UTF-8" },
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
  { value: "latin1", label: "Latin-1" },
];
const RC2_OUT_OPTS = [
  { value: "base64", label: "Base64" },
  { value: "hex", label: "Hex" },
];

register({
  id: "rc2", cat: "modern", name: "RC2",
  desc: "RC2 对称加解密（RFC 2268，ECB/CBC，纯 JS，key 1..128 字节）",
  params: [
    { key: "key", label: "密钥", type: "text", default: "", placeholder: "1..128 字节密钥" },
    { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: RC2_ENC_OPTS },
    { key: "effBits", label: "有效密钥位数", type: "number", default: 0, placeholder: "0=自动（密钥字节数×8）" },
    { key: "mode", label: "模式", type: "select", default: "CBC",
      options: [{ value: "ECB", label: "ECB" }, { value: "CBC", label: "CBC" }] },
    { key: "iv", label: "IV", type: "text", default: "", placeholder: "hex（CBC 用，8 字节）" },
    { key: "ivEnc", label: "IV 编码", type: "select", default: "hex", options: RC2_ENC_OPTS },
    { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: RC2_OUT_OPTS },
  ],
  encode: (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const effBits = (p.effBits && p.effBits > 0) ? p.effBits : key.length * 8;
    const K = rc2KeyExpand(key, effBits);
    const mode = (p.mode || "CBC").toUpperCase();
    const iv = mode === "CBC" ? (p.iv ? decodeInput(p.iv, p.ivEnc || "hex") : new Uint8Array(8)) : new Uint8Array(8);
    return encodeOutput(rc2ModeEncrypt(te(text), K, mode, iv), p.outEnc || "base64");
  },
  decode: (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const effBits = (p.effBits && p.effBits > 0) ? p.effBits : key.length * 8;
    const K = rc2KeyExpand(key, effBits);
    const mode = (p.mode || "CBC").toUpperCase();
    const iv = mode === "CBC" ? (p.iv ? decodeInput(p.iv, p.ivEnc || "hex") : new Uint8Array(8)) : new Uint8Array(8);
    return encodeOutput(rc2ModeDecrypt(decodeInput(text.trim(), p.outEnc || "base64"), K, mode, iv), "utf8");
  },
});

// ============================================================
// LM Hash（Windows，复用 modern.js makeDes）
// ============================================================
// 7 字节（56 位）扩成 8 字节 DES 密钥：每字节取 7 位放高位，LSB 留奇偶位（置 0）。
function expand7to8(k7) {
  const o = new Uint8Array(8);
  o[0] = k7[0] >> 1;
  o[1] = ((k7[0] & 0x01) << 6) | (k7[1] >> 2);
  o[2] = ((k7[1] & 0x03) << 5) | (k7[2] >> 3);
  o[3] = ((k7[2] & 0x07) << 4) | (k7[3] >> 4);
  o[4] = ((k7[3] & 0x0f) << 3) | (k7[4] >> 5);
  o[5] = ((k7[4] & 0x1f) << 2) | (k7[5] >> 6);
  o[6] = ((k7[5] & 0x3f) << 1) | (k7[6] >> 7);
  o[7] = k7[6] & 0x7f;
  for (let i = 0; i < 8; i++) o[i] = (o[i] << 1) & 0xff; // 奇偶位左移入 LSB
  return o;
}
const LM_KGS = new Uint8Array([0x4b, 0x47, 0x53, 0x21, 0x40, 0x23, 0x24, 0x25]); // "KGS!@#$%"

/** Windows LM Hash（返回大写 hex）。 */
export function lmHash(password) {
  const up = (password || "").toUpperCase();
  const pw = new Uint8Array(14); // 截断/补零到 14 字节
  for (let i = 0; i < 14 && i < up.length; i++) pw[i] = up.charCodeAt(i) & 0xff;
  const k1 = expand7to8(pw.subarray(0, 7));
  const k2 = expand7to8(pw.subarray(7, 14));
  const c1 = makeDes(k1).encBlock(LM_KGS);
  const c2 = makeDes(k2).encBlock(LM_KGS);
  return bytesToHex(concatBytes(c1, c2)).toUpperCase();
}

register({
  id: "lmHash", cat: "hash", name: "LM Hash",
  desc: "Windows LM Hash（口令转大写→14 字节→双 DES-ECB 加密 KGS!@#$%）",
  params: [],
  run: (t) => lmHash(t),
});

// ============================================================
// EVP_BytesToKey（OpenSSL 密钥派生）
// ============================================================
async function evpHash(algo, bytes) {
  if (algo === "md5") return md5Bytes(bytes);
  const name = algo === "sha1" ? "SHA-1" : algo === "sha256" ? "SHA-256" : null;
  if (!name) throw new Error("不支持的 hash: " + algo);
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（sha1/sha256 需要）");
  const buf = await crypto.subtle.digest(name, bytes);
  return new Uint8Array(buf);
}

/**
 * OpenSSL EVP_BytesToKey。
 * D_1 = Hash(pass||salt)；D_i = Hash(D_{i-1}||pass||salt)；count>1 时每块再哈希 count-1 次。
 * 拼接 D_i 至 >= keyLen+ivLen，前 keyLen 为 key，后 ivLen 为 iv。
 */
export async function evpBytesToKey(passBytes, saltBytes, keyLen, ivLen, count, algo) {
  const need = keyLen + ivLen;
  const chunks = [];
  let total = 0;
  let prev = new Uint8Array(0);
  while (total < need) {
    let md = await evpHash(algo, concatBytes(prev, passBytes, saltBytes));
    for (let i = 1; i < count; i++) md = await evpHash(algo, md);
    prev = md;
    chunks.push(md);
    total += md.length;
  }
  const all = concatBytes(...chunks);
  return { key: all.subarray(0, keyLen), iv: all.subarray(keyLen, keyLen + ivLen) };
}

register({
  id: "evpBytesToKey", cat: "hash", name: "EVP_BytesToKey",
  desc: "OpenSSL 口令派生 key/iv（openssl enc -k 的派生算法，默认 MD5，count=1）",
  params: [
    { key: "salt", label: "盐（hex）", type: "text", default: "", placeholder: "8 字节 hex，可空" },
    { key: "keyLen", label: "key 字节数", type: "number", default: 32, placeholder: "如 AES-256 为 32" },
    { key: "ivLen", label: "iv 字节数", type: "number", default: 16, placeholder: "如 CBC 为 16" },
    { key: "count", label: "迭代次数", type: "number", default: 1, placeholder: "OpenSSL 默认 1" },
    { key: "hash", label: "哈希", type: "select", default: "md5",
      options: [{ value: "md5", label: "MD5" }, { value: "sha1", label: "SHA-1" }, { value: "sha256", label: "SHA-256" }] },
  ],
  run: async (text, p) => {
    const pass = te(text);
    const salt = p.salt ? hexToBytes(p.salt) : new Uint8Array(0);
    const keyLen = p.keyLen != null ? Number(p.keyLen) : 32;
    const ivLen = p.ivLen != null ? Number(p.ivLen) : 16;
    const count = p.count != null && Number(p.count) > 0 ? Number(p.count) : 1;
    const { key, iv } = await evpBytesToKey(pass, salt, keyLen, ivLen, count, p.hash || "md5");
    return `Key: ${bytesToHex(key)}\nIV:  ${bytesToHex(iv)}`;
  },
});
