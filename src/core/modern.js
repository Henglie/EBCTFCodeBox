/*
 * modern.js — 现代加密（cat:'modern'）。
 *
 * 覆盖：AES（ECB/CBC/CFB/OFB/CTR 纯 JS + GCM 走 WebCrypto）、DES/3DES、RC4
 * XOR（单/多字节 key）、Fernet（对称令牌，HMAC-SHA256 + AES-128-CBC）、RSA（教学级）。
 *
 * 红线：
 * - AES/DES 走标准算法（FIPS-197 / FIPS-46-3），用 NIST 官方测试向量验证，不许编造 S-box/轮常量。
 * - 零外发：全部本地计算（纯 JS 块密码 + WebCrypto，无网络）。
 * - 契约：核心算法层纯函数（字节进字节出），register 层负责编码（hex/base64/utf8）解析与拼装。
 *
 * 分层：
 * [块密码内核] aesEncryptBlock / desBlock — 16/8 字节块级变换
 * [分组模式] ecb/cbc/cfb/ofb/ctr — 通用模式包装，任意 16 或 8 字节块密码复用
 * [填充] pkcs7 pad/unpad
 * [高层 API] aesEncrypt/aesDecrypt、desEncrypt/desDecrypt、rc4、xorCrypt、fernet*、rsa*
 * [register] 编码解析（key/iv/data 的 hex|base64|utf8）+ 双向注册
 *
 * 供「密钥+密文一键尝试」复用高层 API（makeAes / aesEncrypt / desEncrypt / rc4 / xorCrypt）。
 */
import { register } from "./registry.js";
import { finishBytesDecode } from "./bytesIo.js";
import { bytesToBits as _bytesToBitsStd, bitsToBytes as _bitsToBytesStd } from "./bitsource.js";
import { randomBytes as randBytes } from "./randSource.js"; // 统一随机源（默认档 system 逐字节零回归）

const te = (s) => new TextEncoder().encode(s);
/** 取 acceptsBytes 真字节通道（params.rawBytes）；无则 null。 */
function rawBytesOf(p) {
  const b = p && p.rawBytes;
  if (b == null) return null;
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}
/**
 * 旧载体（outEnc/dataEnc）未删前的兼容桥：视图 text 模式交给 op 的字节
 * 恰是输入的 UTF-8 编码时，让位给旧载体（同一文本层，只解一次）；
 * hex/base64 视图或文件拖入的真字节与文本不同构 → 原样返回，rawBytes 优先。
 */
function rawBytesOrNull(p, text) {
  const b = rawBytesOf(p);
  if (!b) return null;
  const t = te(String(text == null ? "" : text));
  if (b.length === t.length) {
    let same = true;
    for (let i = 0; i < b.length; i++) if (b[i] !== t[i]) { same = false; break; }
    if (same) return null;
  }
  return b;
}
// 本文件的 decode 出口已改为 finishBytesDecode（见 ./bytesIo.js）——不再有本地有损解码。

// ============================================================
// 字节 <-> 编码 工具（hex / base64 / utf8 / latin1）
// ============================================================
function hexToBytes(s) {
  const clean = String(s == null ? "" : s).replace(/\s+/g, "");
  if (!/^[0-9a-fA-F]*$/.test(clean)) throw new Error("非法 hex 字符（仅允许 0-9/A-F 与空白）");
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
// base64url（Fernet 用）
function bytesToB64url(b) {
  return bytesToB64(b).replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlToBytes(s) {
  return b64ToBytes(s.replace(/-/g, "+").replace(/_/g, "/"));
}

/** 按声明的编码把文本解析成字节。enc ∈ utf8|hex|base64|latin1 */
function decodeInput(text, enc) {
  switch (enc) {
    case "hex": return hexToBytes(text);
    case "base64": return b64ToBytes(text);
    case "latin1": { const o = new Uint8Array(text.length); for (let i = 0; i < text.length; i++) o[i] = text.charCodeAt(i) & 0xff; return o; }
    case "utf8":
    default: return te(text);
  }
}
/** 把字节按声明编码转成文本。 */
function encodeOutput(bytes, enc) {
  switch (enc) {
    case "hex": return bytesToHex(bytes);
    case "base64": return bytesToB64(bytes);
    case "latin1": { let s = ""; for (const x of bytes) s += String.fromCharCode(x); return s; }
    case "utf8":
    default: return finishBytesDecode(bytes, { textMode: "hex", name: "decoded" });
  }
}

// ============================================================
// 填充（统一实现，供 AES/DES/3DES 与其余分组密码模块复用）
//
// 语义：
// - none      : NoPadding。加密要求块对齐，否则显式报错；解密原样返回。
// - pkcs7     : 末字节=填充长度（默认，兼容旧行为；块大小 ≤255）。
// - zero      : 0x00 补齐到块边界；已对齐不追加。不可逆：原文末尾的 0x00 会被去掉。
// - bit       : ISO/IEC 9797-1 padding method 2，0x80 后补 0x00；总是至少补 1 字节。
// - iso10126  : 随机字节，末字节=填充长度（严格 ISO 10126；解密只信末字节）。
// - ansix923  : 0x00…0x00 + 末字节=填充长度。
//
// 流模式（CFB/OFB/CTR/GCM）不调用本层，padding 参数被忽略。
// ============================================================
export const PADDING_OPTIONS = [
  { value: "pkcs7", label: "PKCS#7（末字节=填充长度）" },
  { value: "none", label: "NoPadding（要求块对齐）" },
  { value: "zero", label: "Zero（0x00 补齐，不可逆）" },
  { value: "bit", label: "Bit（0x80 + 0x00，ISO/IEC 9797-1 M2）" },
  { value: "iso10126", label: "ISO 10126（随机字节 + 末字节长度）" },
  { value: "ansix923", label: "ANSI X9.23（0x00… + 末字节长度）" },
];
const PADDING_NAMES = new Set(["none", "pkcs7", "zero", "bit", "iso10126", "ansix923"]);

/** 归一化填充名；缺省/true→pkcs7，false→none。 */
export function normalizePadding(pad) {
  if (pad === false) return "none";
  if (pad === true || pad == null || pad === "") return "pkcs7";
  const s = String(pad).trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  switch (s) {
    case "none": case "nopadding": case "no": return "none";
    case "pkcs7": case "pkcs5": case "pkcs": return "pkcs7";
    case "zero": case "zeros": case "zeropadding": return "zero";
    case "bit": case "bitpadding": case "iso9797": case "iso97971": case "iso9797m2":
    case "isoiec97971m2": case "iso7816": case "iso78164": return "bit";
    case "iso10126": case "iso101262": return "iso10126";
    case "ansix923": case "x923": case "ansix923padding": return "ansix923";
    default: throw new Error(`不支持的填充: ${pad}（可用 none/pkcs7/zero/bit/iso10126/ansix923）`);
  }
}

/** 按填充名补齐到块大小整数倍。none 非对齐时显式报错。 */
export function padBytes(data, blockSize, pad = "pkcs7") {
  const mode = normalizePadding(pad);
  if (!PADDING_NAMES.has(mode)) throw new Error(`不支持的填充: ${pad}`);
  if (mode === "none") {
    if (data.length % blockSize !== 0) {
      throw new Error(`NoPadding 要求数据长度为 ${blockSize} 字节整数倍（当前 ${data.length} 字节）`);
    }
    return data;
  }
  const padLen = blockSize - (data.length % blockSize);
  if (mode === "zero" && padLen === blockSize) return data;
  const out = new Uint8Array(data.length + padLen);
  out.set(data);
  switch (mode) {
    case "pkcs7":
      out.fill(padLen, data.length);
      break;
    case "zero":
      break;
    case "bit":
      out[data.length] = 0x80;
      break;
    case "iso10126": {
      const rnd = randBytes(padLen);
      out.set(rnd, data.length);
      out[out.length - 1] = padLen;
      break;
    }
    case "ansix923":
      out[out.length - 1] = padLen;
      break;
    default:
      throw new Error(`不支持的填充: ${pad}`);
  }
  return out;
}

/** 按填充名去掉填充。none 原样返回；zero 去尾部 0x00；其余做结构校验。 */
export function unpadBytes(data, blockSize, pad = "pkcs7") {
  const mode = normalizePadding(pad);
  if (mode === "none") return data;
  if (data.length === 0 || data.length % blockSize !== 0) {
    throw new Error(`密文长度非 ${blockSize} 字节整数倍，无法去填充`);
  }
  switch (mode) {
    case "zero": {
      let i = data.length;
      while (i > 0 && data[i - 1] === 0) i--;
      return data.subarray(0, i);
    }
    case "bit": {
      let i = data.length - 1;
      while (i >= 0 && data[i] === 0) i--;
      if (i < 0 || data[i] !== 0x80) throw new Error("Bit 填充非法（未找到 0x80 填充字节）");
      return data.subarray(0, i);
    }
    case "pkcs7":
    case "iso10126":
    case "ansix923": {
      const padLen = data[data.length - 1];
      if (padLen < 1 || padLen > blockSize) throw new Error(`${mode} 填充非法（末字节=${padLen}，块大小=${blockSize}）`);
      if (mode === "pkcs7") {
        for (let i = data.length - padLen; i < data.length; i++) {
          if (data[i] !== padLen) throw new Error("PKCS7 填充校验失败（可能密钥/模式错误）");
        }
      } else if (mode === "ansix923") {
        for (let i = data.length - padLen; i < data.length - 1; i++) {
          if (data[i] !== 0) throw new Error("ANSI X9.23 填充校验失败（长度前的字节必须为 0）");
        }
      }
      return data.subarray(0, data.length - padLen);
    }
    default:
      throw new Error(`不支持的填充: ${pad}`);
  }
}

function xorBytes(a, b) {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] ^ b[i];
  return o;
}
function incCounter(ctr) {
  // 必须显式取低 8 位：对 Uint8Array 元素做 ++，回绕时表达式值是 256 而非 0，
  // 用 !==0 判断会让进位链在第一处低字节回绕时提前断开（256 块后 keystream 全错）。
  for (let i = ctr.length - 1; i >= 0; i--) {
    ctr[i] = (ctr[i] + 1) & 0xff;
    if (ctr[i] !== 0) break;
  }
}

// ============================================================
// 分组模式（通用，块密码传入 encBlock/decBlock，块大小 bs）
// ============================================================
function ecbEncrypt(data, encBlock, bs, pad = true) {
  const d = padBytes(data, bs, pad);
  const out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i += bs) out.set(encBlock(d.subarray(i, i + bs)), i);
  return out;
}
function ecbDecrypt(data, decBlock, bs, pad = true) {
  if (data.length % bs) throw new Error(`密文需为 ${bs} 字节整数倍`);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += bs) out.set(decBlock(data.subarray(i, i + bs)), i);
  return unpadBytes(out, bs, pad);
}
function cbcEncrypt(data, encBlock, bs, iv, pad = true) {
  const d = padBytes(data, bs, pad);
  const out = new Uint8Array(d.length);
  let prev = iv.subarray(0, bs);
  for (let i = 0; i < d.length; i += bs) {
    const blk = encBlock(xorBytes(d.subarray(i, i + bs), prev));
    out.set(blk, i);
    prev = blk;
  }
  return out;
}
function cbcDecrypt(data, decBlock, bs, iv, pad = true) {
  if (data.length % bs) throw new Error(`密文需为 ${bs} 字节整数倍`);
  const out = new Uint8Array(data.length);
  let prev = iv.subarray(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const cblk = data.subarray(i, i + bs);
    out.set(xorBytes(decBlock(cblk), prev), i);
    prev = cblk;
  }
  return unpadBytes(out, bs, pad);
}
// CFB/OFB/CTR 为流模式，加解密都用块密码的 encBlock
function cfbEncrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  let fb = iv.slice(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const ks = encBlock(fb);
    const n = Math.min(bs, data.length - i);
    const c = new Uint8Array(bs);
    for (let j = 0; j < n; j++) c[j] = data[i + j] ^ ks[j];
    out.set(c.subarray(0, n), i);
    fb = c;
  }
  return out;
}
function cfbDecrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  let fb = iv.slice(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const ks = encBlock(fb);
    const n = Math.min(bs, data.length - i);
    const c = new Uint8Array(bs);
    for (let j = 0; j < n; j++) { c[j] = data[i + j]; out[i + j] = data[i + j] ^ ks[j]; }
    fb = c;
  }
  return out;
}
function ofbCrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  let fb = iv.slice(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    fb = encBlock(fb);
    const n = Math.min(bs, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ fb[j];
  }
  return out;
}
function ctrCrypt(data, encBlock, bs, iv) {
  const out = new Uint8Array(data.length);
  const ctr = iv.slice(0, bs);
  for (let i = 0; i < data.length; i += bs) {
    const ks = encBlock(ctr);
    const n = Math.min(bs, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
    incCounter(ctr);
  }
  return out;
}
// 供其它分组密码模块复用同一套分组模式与填充（避免各文件各写一份）
export { ecbEncrypt, ecbDecrypt, cbcEncrypt, cbcDecrypt, cfbEncrypt, cfbDecrypt, ofbCrypt, ctrCrypt };

function concatBytes(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

// ============================================================
// AES 内核（FIPS-197，纯 JS）
// ============================================================
const AES_SBOX = new Uint8Array(256);
const AES_INV_SBOX = new Uint8Array(256);
const AES_RCON = new Uint8Array([0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36, 0x6c, 0xd8, 0xab, 0x4d]);
// GF(2^8) 乘法（仅用于建表/密钥扩展）
function gmul(a, b) {
  let p = 0;
  for (let i = 0; i < 8 && a && b; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b;
    b >>= 1;
  }
  return p;
}
// 运行时生成 S-box + 32 位 T 表（FIPS-197 §5）
const AES_TE0 = new Uint32Array(256), AES_TE1 = new Uint32Array(256);
const AES_TE2 = new Uint32Array(256), AES_TE3 = new Uint32Array(256);
const AES_TD0 = new Uint32Array(256), AES_TD1 = new Uint32Array(256);
const AES_TD2 = new Uint32Array(256), AES_TD3 = new Uint32Array(256);
const rotr32 = (x, n) => ((x >>> n) | (x << (32 - n))) >>> 0;
(function initSbox() {
 // 乘法逆元表
  const inv = new Uint8Array(256);
  for (let i = 1; i < 256; i++) {
    for (let j = 1; j < 256; j++) { if (gmul(i, j) === 1) { inv[i] = j; break; } }
  }
  for (let i = 0; i < 256; i++) {
    let s = inv[i];
    let x = s;
    for (let c = 0; c < 4; c++) { x = ((x << 1) | (x >> 7)) & 0xff; s ^= x; }
    s ^= 0x63;
    AES_SBOX[i] = s;
    AES_INV_SBOX[s] = i;
  }
  for (let i = 0; i < 256; i++) {
    const s = AES_SBOX[i];
    const s2 = gmul(s, 2), s3 = s2 ^ s;
    AES_TE0[i] = ((s2 << 24) | (s << 16) | (s << 8) | s3) >>> 0;
    AES_TE1[i] = rotr32(AES_TE0[i], 8);
    AES_TE2[i] = rotr32(AES_TE1[i], 8);
    AES_TE3[i] = rotr32(AES_TE2[i], 8);
    const si = AES_INV_SBOX[i];
    const m9 = gmul(si, 9), m11 = gmul(si, 11), m13 = gmul(si, 13), m14 = gmul(si, 14);
    AES_TD0[i] = ((m14 << 24) | (m9 << 16) | (m13 << 8) | m11) >>> 0;
    AES_TD1[i] = rotr32(AES_TD0[i], 8);
    AES_TD2[i] = rotr32(AES_TD1[i], 8);
    AES_TD3[i] = rotr32(AES_TD2[i], 8);
  }
})();

const loadBE32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

function aesKeyExpansion(key) {
  const Nk = key.length / 4;
  if (![4, 6, 8].includes(Nk)) throw new Error("AES 密钥须为 16/24/32 字节");
  const Nr = Nk + 6;
  const words = 4 * (Nr + 1);
  const rk = new Uint32Array(words);
  for (let i = 0; i < Nk; i++) rk[i] = loadBE32(key, i * 4);
  let rcon = 0;
  for (let i = Nk; i < words; i++) {
    let t = rk[i - 1];
    if (i % Nk === 0) {
 // RotWord + SubWord + Rcon
      t = ((AES_SBOX[(t >>> 16) & 0xff] << 24) | (AES_SBOX[(t >>> 8) & 0xff] << 16) |
        (AES_SBOX[t & 0xff] << 8) | AES_SBOX[(t >>> 24) & 0xff]) ^ (AES_RCON[rcon++] << 24);
    } else if (Nk > 6 && i % Nk === 4) {
      t = (AES_SBOX[(t >>> 24) & 0xff] << 24) | (AES_SBOX[(t >>> 16) & 0xff] << 16) |
        (AES_SBOX[(t >>> 8) & 0xff] << 8) | AES_SBOX[t & 0xff];
    }
    rk[i] = (rk[i - Nk] ^ t) >>> 0;
  }
  return { rk, Nr };
}

// 单块加密/解密：直接写入 out，无中间数组。state 按列 4×32 位大端字。
function aesEncInto(inp, inOff, out, outOff, rk, Nr) {
  let s0 = (loadBE32(inp, inOff) ^ rk[0]) >>> 0;
  let s1 = (loadBE32(inp, inOff + 4) ^ rk[1]) >>> 0;
  let s2 = (loadBE32(inp, inOff + 8) ^ rk[2]) >>> 0;
  let s3 = (loadBE32(inp, inOff + 12) ^ rk[3]) >>> 0;
  for (let r = 1; r < Nr; r++) {
    const k = r << 2;
    const t0 = (AES_TE0[s0 >>> 24] ^ AES_TE1[(s1 >>> 16) & 0xff] ^ AES_TE2[(s2 >>> 8) & 0xff] ^ AES_TE3[s3 & 0xff] ^ rk[k]) >>> 0;
    const t1 = (AES_TE0[s1 >>> 24] ^ AES_TE1[(s2 >>> 16) & 0xff] ^ AES_TE2[(s3 >>> 8) & 0xff] ^ AES_TE3[s0 & 0xff] ^ rk[k + 1]) >>> 0;
    const t2 = (AES_TE0[s2 >>> 24] ^ AES_TE1[(s3 >>> 16) & 0xff] ^ AES_TE2[(s0 >>> 8) & 0xff] ^ AES_TE3[s1 & 0xff] ^ rk[k + 2]) >>> 0;
    const t3 = (AES_TE0[s3 >>> 24] ^ AES_TE1[(s0 >>> 16) & 0xff] ^ AES_TE2[(s1 >>> 8) & 0xff] ^ AES_TE3[s2 & 0xff] ^ rk[k + 3]) >>> 0;
    s0 = t0; s1 = t1; s2 = t2; s3 = t3;
  }
  const kf = Nr << 2;
  const t0 = (((AES_SBOX[s0 >>> 24] << 24) | (AES_SBOX[(s1 >>> 16) & 0xff] << 16) | (AES_SBOX[(s2 >>> 8) & 0xff] << 8) | AES_SBOX[s3 & 0xff]) ^ rk[kf]) >>> 0;
  const t1 = (((AES_SBOX[s1 >>> 24] << 24) | (AES_SBOX[(s2 >>> 16) & 0xff] << 16) | (AES_SBOX[(s3 >>> 8) & 0xff] << 8) | AES_SBOX[s0 & 0xff]) ^ rk[kf + 1]) >>> 0;
  const t2 = (((AES_SBOX[s2 >>> 24] << 24) | (AES_SBOX[(s3 >>> 16) & 0xff] << 16) | (AES_SBOX[(s0 >>> 8) & 0xff] << 8) | AES_SBOX[s1 & 0xff]) ^ rk[kf + 2]) >>> 0;
  const t3 = (((AES_SBOX[s3 >>> 24] << 24) | (AES_SBOX[(s0 >>> 16) & 0xff] << 16) | (AES_SBOX[(s1 >>> 8) & 0xff] << 8) | AES_SBOX[s2 & 0xff]) ^ rk[kf + 3]) >>> 0;
  out[outOff] = t0 >>> 24; out[outOff + 1] = (t0 >>> 16) & 0xff; out[outOff + 2] = (t0 >>> 8) & 0xff; out[outOff + 3] = t0 & 0xff;
  out[outOff + 4] = t1 >>> 24; out[outOff + 5] = (t1 >>> 16) & 0xff; out[outOff + 6] = (t1 >>> 8) & 0xff; out[outOff + 7] = t1 & 0xff;
  out[outOff + 8] = t2 >>> 24; out[outOff + 9] = (t2 >>> 16) & 0xff; out[outOff + 10] = (t2 >>> 8) & 0xff; out[outOff + 11] = t2 & 0xff;
  out[outOff + 12] = t3 >>> 24; out[outOff + 13] = (t3 >>> 16) & 0xff; out[outOff + 14] = (t3 >>> 8) & 0xff; out[outOff + 15] = t3 & 0xff;
}

function aesDecInto(inp, inOff, out, outOff, rk, Nr) {
  const kf = Nr << 2;
  let s0 = (loadBE32(inp, inOff) ^ rk[kf]) >>> 0;
  let s1 = (loadBE32(inp, inOff + 4) ^ rk[kf + 1]) >>> 0;
  let s2 = (loadBE32(inp, inOff + 8) ^ rk[kf + 2]) >>> 0;
  let s3 = (loadBE32(inp, inOff + 12) ^ rk[kf + 3]) >>> 0;
  for (let r = Nr - 1; r > 0; r--) {
    const k = r << 2;
    const t0 = (AES_TD0[s0 >>> 24] ^ AES_TD1[(s3 >>> 16) & 0xff] ^ AES_TD2[(s2 >>> 8) & 0xff] ^ AES_TD3[s1 & 0xff] ^ rk[k]) >>> 0;
    const t1 = (AES_TD0[s1 >>> 24] ^ AES_TD1[(s0 >>> 16) & 0xff] ^ AES_TD2[(s3 >>> 8) & 0xff] ^ AES_TD3[s2 & 0xff] ^ rk[k + 1]) >>> 0;
    const t2 = (AES_TD0[s2 >>> 24] ^ AES_TD1[(s1 >>> 16) & 0xff] ^ AES_TD2[(s0 >>> 8) & 0xff] ^ AES_TD3[s3 & 0xff] ^ rk[k + 2]) >>> 0;
    const t3 = (AES_TD0[s3 >>> 24] ^ AES_TD1[(s2 >>> 16) & 0xff] ^ AES_TD2[(s1 >>> 8) & 0xff] ^ AES_TD3[s0 & 0xff] ^ rk[k + 3]) >>> 0;
    s0 = t0; s1 = t1; s2 = t2; s3 = t3;
  }
  const t0 = (((AES_INV_SBOX[s0 >>> 24] << 24) | (AES_INV_SBOX[(s3 >>> 16) & 0xff] << 16) | (AES_INV_SBOX[(s2 >>> 8) & 0xff] << 8) | AES_INV_SBOX[s1 & 0xff]) ^ rk[0]) >>> 0;
  const t1 = (((AES_INV_SBOX[s1 >>> 24] << 24) | (AES_INV_SBOX[(s0 >>> 16) & 0xff] << 16) | (AES_INV_SBOX[(s3 >>> 8) & 0xff] << 8) | AES_INV_SBOX[s2 & 0xff]) ^ rk[1]) >>> 0;
  const t2 = (((AES_INV_SBOX[s2 >>> 24] << 24) | (AES_INV_SBOX[(s1 >>> 16) & 0xff] << 16) | (AES_INV_SBOX[(s0 >>> 8) & 0xff] << 8) | AES_INV_SBOX[s3 & 0xff]) ^ rk[2]) >>> 0;
  const t3 = (((AES_INV_SBOX[s3 >>> 24] << 24) | (AES_INV_SBOX[(s2 >>> 16) & 0xff] << 16) | (AES_INV_SBOX[(s1 >>> 8) & 0xff] << 8) | AES_INV_SBOX[s0 & 0xff]) ^ rk[3]) >>> 0;
  out[outOff] = t0 >>> 24; out[outOff + 1] = (t0 >>> 16) & 0xff; out[outOff + 2] = (t0 >>> 8) & 0xff; out[outOff + 3] = t0 & 0xff;
  out[outOff + 4] = t1 >>> 24; out[outOff + 5] = (t1 >>> 16) & 0xff; out[outOff + 6] = (t1 >>> 8) & 0xff; out[outOff + 7] = t1 & 0xff;
  out[outOff + 8] = t2 >>> 24; out[outOff + 9] = (t2 >>> 16) & 0xff; out[outOff + 10] = (t2 >>> 8) & 0xff; out[outOff + 11] = t2 & 0xff;
  out[outOff + 12] = t3 >>> 24; out[outOff + 13] = (t3 >>> 16) & 0xff; out[outOff + 14] = (t3 >>> 8) & 0xff; out[outOff + 15] = t3 & 0xff;
}

// 等价逆密码需要 InvMixColumns(轮密钥)，仅中间轮
function buildDecRk(rk, Nr) {
  const dk = new Uint32Array(rk.length);
  dk.set(rk);
  for (let r = 1; r < Nr; r++) {
    const o = r << 2;
    for (let i = 0; i < 4; i++) {
      const w = rk[o + i];
      const a0 = (w >>> 24) & 0xff, a1 = (w >>> 16) & 0xff, a2 = (w >>> 8) & 0xff, a3 = w & 0xff;
      dk[o + i] = (((gmul(a0, 14) ^ gmul(a1, 11) ^ gmul(a2, 13) ^ gmul(a3, 9)) << 24) |
        ((gmul(a0, 9) ^ gmul(a1, 14) ^ gmul(a2, 11) ^ gmul(a3, 13)) << 16) |
        ((gmul(a0, 13) ^ gmul(a1, 9) ^ gmul(a2, 14) ^ gmul(a3, 11)) << 8) |
        (gmul(a0, 11) ^ gmul(a1, 13) ^ gmul(a2, 9) ^ gmul(a3, 14))) >>> 0;
    }
  }
  return dk;
}

function aesEncryptBlock(input, rk, Nr) {
  const out = new Uint8Array(16);
  aesEncInto(input, 0, out, 0, rk, Nr);
  return out;
}
function aesDecryptBlock(input, dk, Nr) {
  const out = new Uint8Array(16);
  aesDecInto(input, 0, out, 0, dk, Nr);
  return out;
}

// AES 专用模式循环：直接按块写入输出，避免每块新数组/subarray。
function aesEcbEnc(data, rk, Nr, pad) {
  const d = padBytes(data, 16, pad);
  const out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i += 16) aesEncInto(d, i, out, i, rk, Nr);
  return out;
}
function aesEcbDec(data, rk, Nr, pad) {
  if (data.length % 16) throw new Error("密文需为 16 字节整数倍");
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 16) aesDecInto(data, i, out, i, rk, Nr);
  return unpadBytes(out, 16, pad);
}
function aesCbcEnc(data, rk, Nr, iv, pad) {
  const d = padBytes(data, 16, pad);
  const out = new Uint8Array(d.length);
  const x = new Uint8Array(16);
  for (let i = 0; i < d.length; i += 16) {
    const po = i === 0 ? 0 : i - 16;
    const prev = i === 0 ? iv : out;
    for (let j = 0; j < 16; j++) x[j] = d[i + j] ^ prev[po + j];
    aesEncInto(x, 0, out, i, rk, Nr);
  }
  return out;
}
function aesCbcDec(data, rk, Nr, iv, pad) {
  if (data.length % 16) throw new Error("密文需为 16 字节整数倍");
  const out = new Uint8Array(data.length);
  const tmp = new Uint8Array(16);
  for (let i = 0; i < data.length; i += 16) {
    aesDecInto(data, i, tmp, 0, rk, Nr);
    const po = i === 0 ? 0 : i - 16;
    const prev = i === 0 ? iv : data;
    for (let j = 0; j < 16; j++) out[i + j] = tmp[j] ^ prev[po + j];
  }
  return unpadBytes(out, 16, pad);
}
function aesCfbEnc(data, rk, Nr, iv) {
  const out = new Uint8Array(data.length);
  const ks = new Uint8Array(16);
  for (let i = 0; i < data.length; i += 16) {
    const src = i === 0 ? iv : out;
    const so = i === 0 ? 0 : i - 16;
    aesEncInto(src, so, ks, 0, rk, Nr);
    const n = Math.min(16, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
  }
  return out;
}
function aesCfbDec(data, rk, Nr, iv) {
  const out = new Uint8Array(data.length);
  const ks = new Uint8Array(16);
  for (let i = 0; i < data.length; i += 16) {
    const src = i === 0 ? iv : data;
    const so = i === 0 ? 0 : i - 16;
    aesEncInto(src, so, ks, 0, rk, Nr);
    const n = Math.min(16, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
  }
  return out;
}
function aesOfbCrypt(data, rk, Nr, iv) {
  const out = new Uint8Array(data.length);
  const fb = new Uint8Array(16);
  fb.set(iv.subarray(0, 16));
  for (let i = 0; i < data.length; i += 16) {
    aesEncInto(fb, 0, fb, 0, rk, Nr);
    const n = Math.min(16, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ fb[j];
  }
  return out;
}
function aesCtrCrypt(data, rk, Nr, iv) {
  const out = new Uint8Array(data.length);
  const ctr = iv.slice(0, 16);
  const ks = new Uint8Array(16);
  for (let i = 0; i < data.length; i += 16) {
    aesEncInto(ctr, 0, ks, 0, rk, Nr);
    const n = Math.min(16, data.length - i);
    for (let j = 0; j < n; j++) out[i + j] = data[i + j] ^ ks[j];
    incCounter(ctr);
  }
  return out;
}

// ============================================================
// AES 高层 API（给 register 层 + 密钥一把梭复用）
// ============================================================
/** 由密钥构造 AES 块加/解密闭包。keyBytes 长 16/24/32。 */
export function makeAes(keyBytes) {
  const { rk, Nr } = aesKeyExpansion(keyBytes);
  const dk = buildDecRk(rk, Nr);
  return {
    encBlock: (b) => aesEncryptBlock(b, rk, Nr),
    decBlock: (b) => aesDecryptBlock(b, dk, Nr),
  };
}

const AES_MODES = new Set(["ECB", "CBC", "CFB", "OFB", "CTR"]);

/**
 * AES 加密（非 GCM 模式，纯 JS）。
 * @param {Uint8Array} data 明文字节
 * @param {Uint8Array} key 16/24/32 字节
 * @param {{mode:string, iv?:Uint8Array, pad?:boolean|string, padding?:string}} opts
 * @returns {Uint8Array} 密文字节
 */
export function aesEncrypt(data, key, { mode = "CBC", iv, pad = true, padding } = {}) {
  mode = mode.toUpperCase();
  if (!AES_MODES.has(mode)) throw new Error(`不支持的 AES 模式: ${mode}（GCM 用 aesGcm*）`);
  const padOpt = padding === undefined ? pad : padding;
  const { rk, Nr } = aesKeyExpansion(key);
  if (mode !== "ECB" && iv && iv.length !== 16) throw new Error(`AES-${mode} IV 必须为 16 字节，当前 ${iv.length} 字节`);
  const ivv = iv || new Uint8Array(16);
  switch (mode) {
    case "ECB": return aesEcbEnc(data, rk, Nr, padOpt);
    case "CBC": return aesCbcEnc(data, rk, Nr, ivv, padOpt);
    case "CFB": return aesCfbEnc(data, rk, Nr, ivv);
    case "OFB": return aesOfbCrypt(data, rk, Nr, ivv);
    case "CTR": return aesCtrCrypt(data, rk, Nr, ivv);
  }
}
/** AES 解密（非 GCM）。 */
export function aesDecrypt(data, key, { mode = "CBC", iv, pad = true, padding } = {}) {
  mode = mode.toUpperCase();
  if (!AES_MODES.has(mode)) throw new Error(`不支持的 AES 模式: ${mode}`);
  const padOpt = padding === undefined ? pad : padding;
  const { rk, Nr } = aesKeyExpansion(key);
  const dk = buildDecRk(rk, Nr);
  if (mode !== "ECB" && iv && iv.length !== 16) throw new Error(`AES-${mode} IV 必须为 16 字节，当前 ${iv.length} 字节`);
  const ivv = iv || new Uint8Array(16);
  switch (mode) {
    case "ECB": return aesEcbDec(data, dk, Nr, padOpt);
    case "CBC": return aesCbcDec(data, dk, Nr, ivv, padOpt);
    case "CFB": return aesCfbDec(data, rk, Nr, ivv); // 流模式解密用 encBlock
    case "OFB": return aesOfbCrypt(data, rk, Nr, ivv);
    case "CTR": return aesCtrCrypt(data, rk, Nr, ivv);
  }
}

// ============================================================
// DES 内核（FIPS-46-3，纯 JS，标准置换表照抄不改）
// ============================================================
// 初始置换 IP（64→64）
const DES_IP = [
  58,50,42,34,26,18,10,2, 60,52,44,36,28,20,12,4,
  62,54,46,38,30,22,14,6, 64,56,48,40,32,24,16,8,
  57,49,41,33,25,17,9,1, 59,51,43,35,27,19,11,3,
  61,53,45,37,29,21,13,5, 63,55,47,39,31,23,15,7,
];
// 逆初始置换 FP = IP^-1（64→64）
const DES_FP = [
  40,8,48,16,56,24,64,32, 39,7,47,15,55,23,63,31,
  38,6,46,14,54,22,62,30, 37,5,45,13,53,21,61,29,
  36,4,44,12,52,20,60,28, 35,3,43,11,51,19,59,27,
  34,2,42,10,50,18,58,26, 33,1,41,9,49,17,57,25,
];
// 扩展置换 E（32→48）
const DES_E = [
  32,1,2,3,4,5, 4,5,6,7,8,9, 8,9,10,11,12,13, 12,13,14,15,16,17,
  16,17,18,19,20,21, 20,21,22,23,24,25, 24,25,26,27,28,29, 28,29,30,31,32,1,
];
// P 置换（32→32）
const DES_P = [
  16,7,20,21,29,12,28,17, 1,15,23,26,5,18,31,10,
  2,8,24,14,32,27,3,9, 19,13,30,6,22,11,4,25,
];
// PC-1（64→56，丢奇偶校验位）
const DES_PC1 = [
  57,49,41,33,25,17,9, 1,58,50,42,34,26,18,
  10,2,59,51,43,35,27, 19,11,3,60,52,44,36,
  63,55,47,39,31,23,15, 7,62,54,46,38,30,22,
  14,6,61,53,45,37,29, 21,13,5,28,20,12,4,
];
// PC-2（56→48）
const DES_PC2 = [
  14,17,11,24,1,5, 3,28,15,6,21,10, 23,19,12,4,26,8, 16,7,27,20,13,2,
  41,52,31,37,47,55, 30,40,51,45,33,48, 44,49,39,56,34,53, 46,42,50,36,29,32,
];
// 每轮左移位数
const DES_SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
// 8 个 S 盒（每盒 4 行 16 列）
const DES_SBOX = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7, 0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8, 4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0, 15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10, 3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5, 0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15, 13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8, 13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1, 13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7, 1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15, 13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9, 10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4, 3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9, 14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6, 4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14, 11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11, 10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8, 9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6, 4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1, 13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6, 1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2, 6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7, 1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2, 7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8, 2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
];

// 字节数组 → 位数组（MSB 优先）；等价收敛：委托层③ 原语（src/core/bitsource.js）
function bytesToBits(bytes) {
  return _bytesToBitsStd(bytes, "msb");
}
function bitsToBytes(bits) {
  return _bitsToBytesStd(bits, "msb").bytes;
}
// 按 table（1-indexed）置换位数组
function permute(bits, table) {
  const out = new Uint8Array(table.length);
  for (let i = 0; i < table.length; i++) out[i] = bits[table[i] - 1];
  return out;
}
// 左循环移位（28 位半密钥）
function rotl28(arr, n) {
  const out = new Uint8Array(28);
  for (let i = 0; i < 28; i++) out[i] = arr[(i + n) % 28];
  return out;
}
// 生成 16 个 48 位子密钥
function desKeySchedule(keyBytes) {
  if (keyBytes.length !== 8) throw new Error("DES 密钥须为 8 字节");
  const key56 = permute(bytesToBits(keyBytes), DES_PC1);
  let C = key56.subarray(0, 28), D = key56.subarray(28, 56);
  const subkeys = [];
  for (let r = 0; r < 16; r++) {
    C = rotl28(C, DES_SHIFTS[r]);
    D = rotl28(D, DES_SHIFTS[r]);
    const CD = new Uint8Array(56);
    CD.set(C); CD.set(D, 28);
    subkeys.push(permute(CD, DES_PC2));
  }
  return subkeys;
}
// Feistel f 函数（R:32bits, K:48bits → 32bits）
function desF(R, K) {
  const expanded = permute(R, DES_E); // 48
  for (let i = 0; i < 48; i++) expanded[i] ^= K[i];
  const sOut = new Uint8Array(32);
  for (let b = 0; b < 8; b++) {
    const o = b * 6;
    const row = (expanded[o] << 1) | expanded[o + 5];
    const col = (expanded[o + 1] << 3) | (expanded[o + 2] << 2) | (expanded[o + 3] << 1) | expanded[o + 4];
    const val = DES_SBOX[b][row * 16 + col];
    sOut[b * 4] = (val >> 3) & 1;
    sOut[b * 4 + 1] = (val >> 2) & 1;
    sOut[b * 4 + 2] = (val >> 1) & 1;
    sOut[b * 4 + 3] = val & 1;
  }
  return permute(sOut, DES_P);
}
// DES 单块（8 字节）加/解密。decrypt=true 时子密钥逆序。
function desBlockRaw(block8, subkeys, decrypt) {
  const bits = permute(bytesToBits(block8), DES_IP);
  let L = bits.subarray(0, 32), R = bits.subarray(32, 64);
  for (let r = 0; r < 16; r++) {
    const k = subkeys[decrypt ? 15 - r : r];
    const f = desF(R, k);
    const newR = new Uint8Array(32);
    for (let i = 0; i < 32; i++) newR[i] = L[i] ^ f[i];
    L = R; R = newR;
  }
 // 末轮不交换：预输出 = R16 L16
  const pre = new Uint8Array(64);
  pre.set(R); pre.set(L, 32);
  return bitsToBytes(permute(pre, DES_FP));
}
/** 由 8 字节密钥构造 DES 块闭包。 */
export function makeDes(keyBytes) {
  const subkeys = desKeySchedule(keyBytes);
  return {
    encBlock: (b) => desBlockRaw(b, subkeys, false),
    decBlock: (b) => desBlockRaw(b, subkeys, true),
  };
}
/** 由 16 或 24 字节密钥构造 3DES（EDE）块闭包。16 字节 = K1K2K1。 */
export function makeDes3(keyBytes) {
  let k1, k2, k3;
  if (keyBytes.length === 24) { k1 = keyBytes.subarray(0, 8); k2 = keyBytes.subarray(8, 16); k3 = keyBytes.subarray(16, 24); }
  else if (keyBytes.length === 16) { k1 = keyBytes.subarray(0, 8); k2 = keyBytes.subarray(8, 16); k3 = k1; }
  else throw new Error("3DES 密钥须为 16 或 24 字节");
  const d1 = makeDes(k1), d2 = makeDes(k2), d3 = makeDes(k3);
  return {
    encBlock: (b) => d3.encBlock(d2.decBlock(d1.encBlock(b))), // EDE
    decBlock: (b) => d1.decBlock(d2.encBlock(d3.decBlock(b))), // DED
  };
}

const DES_MODES = new Set(["ECB", "CBC", "CFB", "OFB", "CTR"]);
function runBlockCipher(enc, data, blk, mode, iv, pad) {
  mode = mode.toUpperCase();
  if (!DES_MODES.has(mode)) throw new Error(`不支持的模式: ${mode}`);
  const bs = 8;
  if (mode !== "ECB" && iv && iv.length !== bs) throw new Error(`DES-${mode} IV 必须为 ${bs} 字节，当前 ${iv.length} 字节`);
  const ivv = iv || new Uint8Array(8);
  if (enc) switch (mode) {
    case "ECB": return ecbEncrypt(data, blk.encBlock, bs, pad);
    case "CBC": return cbcEncrypt(data, blk.encBlock, bs, ivv, pad);
    case "CFB": return cfbEncrypt(data, blk.encBlock, bs, ivv);
    case "OFB": return ofbCrypt(data, blk.encBlock, bs, ivv);
    case "CTR": return ctrCrypt(data, blk.encBlock, bs, ivv);
  } else switch (mode) {
    case "ECB": return ecbDecrypt(data, blk.decBlock, bs, pad);
    case "CBC": return cbcDecrypt(data, blk.decBlock, bs, ivv, pad);
    case "CFB": return cfbDecrypt(data, blk.encBlock, bs, ivv);
    case "OFB": return ofbCrypt(data, blk.encBlock, bs, ivv);
    case "CTR": return ctrCrypt(data, blk.encBlock, bs, ivv);
  }
}
export function desEncrypt(data, key, { mode = "CBC", iv, pad = true, padding } = {}) { return runBlockCipher(true, data, makeDes(key), mode, iv, padding === undefined ? pad : padding); }
export function desDecrypt(data, key, { mode = "CBC", iv, pad = true, padding } = {}) { return runBlockCipher(false, data, makeDes(key), mode, iv, padding === undefined ? pad : padding); }
export function des3Encrypt(data, key, { mode = "CBC", iv, pad = true, padding } = {}) { return runBlockCipher(true, data, makeDes3(key), mode, iv, padding === undefined ? pad : padding); }
export function des3Decrypt(data, key, { mode = "CBC", iv, pad = true, padding } = {}) { return runBlockCipher(false, data, makeDes3(key), mode, iv, padding === undefined ? pad : padding); }

// ============================================================
// RC4（流密码，自反）
// ============================================================
export function rc4(data, key) {
  if (!key || key.length === 0) throw new Error("RC4 密钥不能为空");
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }
  const out = new Uint8Array(data.length);
  let i = 0; j = 0;
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
    out[k] = data[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

// ============================================================
// XOR（重复密钥，自反）
// ============================================================
export function xorCrypt(data, key) {
  if (!key || key.length === 0) throw new Error("XOR 密钥不能为空");
  const out = new Uint8Array(data.length);
  const klen = key.length;
  // 单字节 key 特判（CTF 最常见），免取模；多字节用自增 j 替代 i % klen
  if (klen === 1) {
    const k = key[0];
    for (let i = 0; i < data.length; i++) out[i] = data[i] ^ k;
    return out;
  }
  let j = 0;
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ key[j];
    if (++j === klen) j = 0;
  }
  return out;
}

// ============================================================
// Fernet（对称令牌，spec: fernet-spec）
// 令牌 = base64url( 0x80 ‖ ts(8,BE秒) ‖ iv(16) ‖ ct(AES128-CBC/PKCS7) ‖ hmac(32) )
// 密钥 = base64url(32B)：前 16B 签名密钥(HMAC-SHA256)，后 16B 加密密钥(AES-128)。
// ============================================================
async function hmacSha256(keyBytes, msgBytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（Fernet 需要）");
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, msgBytes);
  return new Uint8Array(sig);
}
function fernetSplitKey(keyText) {
  const kb = b64urlToBytes(keyText.trim());
  if (kb.length !== 32) throw new Error("Fernet 密钥须为 base64url 编码的 32 字节");
  return { signKey: kb.subarray(0, 16), encKey: kb.subarray(16, 32) };
}
/** Fernet 加密。返回 base64url 令牌。ts 省略取当前秒；iv 省略随机。 */
export async function fernetEncrypt(dataBytes, keyText, { ts, iv } = {}) {
  const { signKey, encKey } = fernetSplitKey(keyText);
  const ivv = iv || randBytes(16);
  const now = ts != null ? BigInt(ts) : BigInt(Math.floor(Date.now() / 1000));
  const tsBytes = new Uint8Array(8);
  { let v = now; for (let i = 7; i >= 0; i--) { tsBytes[i] = Number(v & 0xffn); v >>= 8n; } }
  const ct = aesEncrypt(dataBytes, encKey, { mode: "CBC", iv: ivv, pad: true });
  const body = new Uint8Array(1 + 8 + 16 + ct.length);
  body[0] = 0x80; body.set(tsBytes, 1); body.set(ivv, 9); body.set(ct, 25);
  const mac = await hmacSha256(signKey, body);
  const token = new Uint8Array(body.length + 32);
  token.set(body); token.set(mac, body.length);
  return bytesToB64url(token);
}
/** Fernet 解密。校验版本 + HMAC，返回明文字节。 */
export async function fernetDecrypt(tokenText, keyText, { checkMac = true } = {}) {
  const { signKey, encKey } = fernetSplitKey(keyText);
  const token = b64urlToBytes(tokenText.trim());
  if (token.length < 1 + 8 + 16 + 32) throw new Error("Fernet 令牌过短");
  if (token[0] !== 0x80) throw new Error("Fernet 版本非法（应为 0x80）");
  const body = token.subarray(0, token.length - 32);
  const mac = token.subarray(token.length - 32);
  if (checkMac) {
    const expect = await hmacSha256(signKey, body);
    let diff = 0;
    for (let i = 0; i < 32; i++) diff |= mac[i] ^ expect[i];
    if (diff !== 0) throw new Error("Fernet HMAC 校验失败（密钥错误或令牌被篡改）");
  }
  const iv = body.subarray(9, 25);
  const ct = body.subarray(25);
  return aesDecrypt(ct, encKey, { mode: "CBC", iv, pad: true });
}

// ============================================================
// RSA（教学级，BigInt。仅裸 RSA / 无填充，用于 CTF 求解，不作生产加密）
// ============================================================
function modpow(base, exp, mod) {
  base %= mod;
  let result = 1n;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}
function egcd(a, b) {
  if (b === 0n) return [a, 1n, 0n];
  const [g, x, y] = egcd(b, a % b);
  return [g, y, x - (a / b) * y];
}
/** 模逆 a^{-1} mod m。 */
export function modInverse(a, m) {
  const [g, x] = egcd(((a % m) + m) % m, m);
  if (g !== 1n) throw new Error("模逆不存在（a 与 m 不互质）");
  return ((x % m) + m) % m;
}
/** 裸 RSA：c = m^e mod n。m 为 BigInt。 */
export function rsaPow(m, e, n) { return modpow(m, e, n); }
/** 字节 → BigInt（大端，OS2IP）。 */
export function bytesToBigInt(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}
/** BigInt → 字节（大端，I2OSP，len 省略取最小长度）。 */
export function bigIntToBytes(n, len) {
  const out = [];
  if (n > 0n) {
    // 大端字节直出：toString(16) 对 2 的幂基数为近线性，替代逐字节 &/>> 的 O(n²)
    const hex = n.toString(16);
    out.length = (hex.length + 1) >> 1;
    let j = out.length - 1;
    for (let off = hex.length - 2; off >= 0; off -= 2, j--) out[j] = parseInt(hex.slice(off, off + 2), 16);
    if (hex.length & 1) out[0] = parseInt(hex[0], 16);
  }
  if (len != null) { while (out.length < len) out.unshift(0); }
  return new Uint8Array(out);
}
/** 由 p,q,e 推导私钥 d（CTF 常见）。 */
export function rsaDeriveD(p, q, e) {
  const phi = (p - 1n) * (q - 1n);
  return modInverse(e, phi);
}

// ============================================================
// AES-GCM（认证加密，走 WebCrypto）
// ============================================================
// 密文 = ciphertext ‖ tag(tagLen 位，默认 128)。CTF 场景 iv/nonce 通常已知，故要求显式提供。
const GCM_TAG_BITS = new Set([128, 120, 112, 104, 96, 64, 32]);
function normGcmTagBits(tagLen) {
  if (tagLen == null || tagLen === "") return 128;
  const n = Number(tagLen);
  if (!GCM_TAG_BITS.has(n)) throw new Error("GCM tagLen 仅支持 128/120/112/104/96/64/32 位");
  return n;
}
export async function aesGcmEncrypt(data, key, iv, aad, { tagLen = 128 } = {}) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（AES-GCM 需要）");
  const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad || new Uint8Array(0), tagLength: normGcmTagBits(tagLen) }, k, data);
  return new Uint8Array(ct);
}
export async function aesGcmDecrypt(data, key, iv, aad, { tagLen = 128 } = {}) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（AES-GCM 需要）");
  const bits = normGcmTagBits(tagLen);
  const tagBytes = bits / 8;
  if (!data || data.length < tagBytes) {
    throw new Error(`AES-GCM 密文过短：至少需包含 ${tagBytes} 字节 tag（当前 ${data ? data.length : 0} 字节）`);
  }
  const k = await crypto.subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  try {
    const pt = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad || new Uint8Array(0), tagLength: bits }, k, data);
    return new Uint8Array(pt);
  } catch (e) {
    throw new Error(`AES-GCM 解密失败：密钥/IV/AAD/tag 不匹配或密文被篡改${e && e.message ? `（${e.message}）` : ""}`);
  }
}

// ============================================================
// register 层：编码解析（key/iv/data 的 utf8|hex|base64|latin1）+ 双向注册
// ============================================================
// 参数模板：分组密码（AES/DES/3DES）共用 key/keyEnc/mode/iv/ivEnc/outEnc。
const ENC_OPTS = [
  { value: "utf8", label: "UTF-8" },
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
  { value: "latin1", label: "Latin-1" },
];
const OUT_OPTS = [
  { value: "base64", label: "Base64" },
  { value: "hex", label: "Hex" },
];
// RC4 专用 IO（对齐 CyberChef RC4 的 UTF16/UTF16LE/UTF16BE 档；不改其他 op 的 ENC_OPTS）
const RC4_IO_OPTS = [
  ...ENC_OPTS,
  { value: "utf16", label: "UTF-16（BE）" },
  { value: "utf16le", label: "UTF-16LE" },
  { value: "utf16be", label: "UTF-16BE" },
];
function decodeInputIo(text, enc) {
  if (enc === "utf16" || enc === "utf16be") {
    const s = String(text == null ? "" : text);
    const out = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[i * 2] = (c >> 8) & 0xff; out[i * 2 + 1] = c & 0xff;
    }
    return out;
  }
  if (enc === "utf16le") {
    const s = String(text == null ? "" : text);
    const out = new Uint8Array(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      out[i * 2] = c & 0xff; out[i * 2 + 1] = (c >> 8) & 0xff;
    }
    return out;
  }
  return decodeInput(text, enc || "utf8");
}
function encodeOutputIo(bytes, enc) {
  if (enc === "utf16" || enc === "utf16be" || enc === "utf16le") {
    const le = enc === "utf16le";
    let s = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      s += String.fromCharCode(le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]));
    }
    return s;
  }
  return encodeOutput(bytes, enc);
}

// 分组密码参数（AES 含 GCM，DES/3DES 不含）。
function blockParams(modes, keyPh, { gcm = false } = {}) {
  const params = [
    { key: "key", label: "密钥", type: "text", default: "", placeholder: keyPh },
    { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
    { key: "mode", label: "模式", type: "select", default: "CBC",
      options: modes.map((m) => ({ value: m, label: m })) },
    { key: "iv", label: "IV / Nonce", type: "text", default: "", placeholder: "hex（GCM 为 12B nonce）" },
    { key: "ivEnc", label: "IV 编码", type: "select", default: "hex", options: ENC_OPTS },
    { key: "padding", label: "填充（ECB/CBC 用；流模式忽略）", type: "select", default: "pkcs7", options: PADDING_OPTIONS },
  ];
  if (gcm) {
    params.push(
      { key: "aad", label: "AAD（仅 GCM）", type: "text", default: "", placeholder: "认证附加数据（可空）" },
      { key: "aadEnc", label: "AAD 编码（仅 GCM）", type: "select", default: "utf8", options: ENC_OPTS },
      { key: "includeIv", label: "IV 包含方式（仅 GCM）", type: "select", default: "off",
        options: [
          { value: "off", label: "不包含（默认）" },
          { value: "prepend", label: "前置（iv‖ct‖tag）" },
          { value: "append", label: "后置（ct‖tag‖iv）" },
        ] },
      { key: "ivFromInput", label: "IV 来源（仅 GCM 解密）", type: "select", default: "off",
        options: [
          { value: "off", label: "Off（不自动取，默认）" },
          { value: "start", label: "From start（从输入开头取）" },
          { value: "end", label: "From end（从输入末尾取）" },
        ] },
      { key: "tagLen", label: "GCM tag 位数", type: "select", default: "128",
        options: [128, 120, 112, 104, 96, 64, 32].map((n) => ({ value: String(n), label: `${n} 位` })) },
      { key: "ivLen", label: "IV 长度（Include IV / ivFromInput 解密用）", type: "select", default: "12",
        options: [12, 16].map((n) => ({ value: String(n), label: `${n} 字节` })) },
      { key: "tag", label: "tag（仅 GCM 解密可选）", type: "text", default: "", placeholder: "留空取密文末；独立 tag 时单独粘贴" },
      { key: "tagEnc", label: "tag 编码（仅独立 tag）", type: "select", default: "hex", options: ENC_OPTS },
    );
  }
  params.push({ key: "outEnc", label: "密文编码", type: "select", default: "base64", options: OUT_OPTS });
  return params;
}

function normIncludeIv(v) {
  const s = String(v == null || v === "" ? "off" : v).toLowerCase();
  if (s === "off" || s === "prepend" || s === "append") return s;
  throw new Error(`IV 包含方式仅支持 off/prepend/append（当前 ${v}）`);
}
function normIvFromInput(v) {
  const s = String(v == null || v === "" ? "off" : v).toLowerCase();
  if (s === "off" || s === "start" || s === "end") return s;
  throw new Error(`IV 来源（ivFromInput）仅支持 off/start/end（当前 ${v}）`);
}
// AAD 不再固定 UTF-8：hex/base64 允许首尾空白，UTF-8/Latin1 原样保留（尾空格可能是合法 AAD）。
function parseGcmAad(p) {
  const raw = p.aad;
  if (raw == null || raw === "") return undefined;
  const enc = p.aadEnc || "utf8";
  const text = (enc === "hex" || enc === "base64") ? String(raw).trim() : String(raw);
  return decodeInput(text, enc);
}
// 独立 tag：长度必须与 tagLen 一致；UTF-8/Latin1 不 trim（末字节可能是空白）。
function parseGcmTag(p, tagBytes) {
  const raw = p.tag;
  if (raw == null || raw === "") return null;
  const enc = p.tagEnc || "hex";
  const text = (enc === "hex" || enc === "base64") ? String(raw).trim() : String(raw);
  const tag = decodeInput(text, enc);
  if (tag.length !== tagBytes) throw new Error(`GCM 独立 tag 需 ${tagBytes} 字节（当前 ${tag.length} 字节）`);
  return tag;
}
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// 由字节级 enc/dec 函数构造 register 用的 encode/decode（含 AES-GCM 分支）。
// isAes=true 时 GCM 模式走 WebCrypto，其余走纯 JS 分组模式。
function makeBlockEncode(encFn, isAes) {
  return async (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const mode = (p.mode || "CBC").toUpperCase();
    const data = rawBytesOrNull(p, text) || te(text);
    const padding = p.padding || "pkcs7";
    if (isAes && mode === "GCM") {
      if (!p.iv) throw new Error("GCM 需提供 nonce（IV）");
      const iv = decodeInput(p.iv, p.ivEnc || "hex");
      const aad = parseGcmAad(p);
      const tagLen = normGcmTagBits(p.tagLen);
      let out = await aesGcmEncrypt(data, key, iv, aad, { tagLen });
      const inc = normIncludeIv(p.includeIv);
      if (inc === "prepend") out = concatBytes(iv, out);
      else if (inc === "append") out = concatBytes(out, iv);
      return encodeOutput(out, p.outEnc || "base64");
    }
    const iv = p.iv ? decodeInput(p.iv, p.ivEnc || "hex") : undefined;
    return encodeOutput(encFn(data, key, { mode, iv, padding }), p.outEnc || "base64");
  };
}
function makeBlockDecode(decFn, isAes) {
  return async (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const mode = (p.mode || "CBC").toUpperCase();
    let data = rawBytesOrNull(p, text) || decodeInput(text.trim(), p.outEnc || "base64");
    const padding = p.padding || "pkcs7";
    if (isAes && mode === "GCM") {
      const aad = parseGcmAad(p);
      const tagLen = normGcmTagBits(p.tagLen);
      const tagBytes = tagLen / 8;
      const sepTag = parseGcmTag(p, tagBytes);
      const inTagBytes = sepTag ? 0 : tagBytes;
      const withTag = (body) => (sepTag ? concatBytes(body, sepTag) : body);
      const explicit = p.iv ? decodeInput(p.iv, p.ivEnc || "hex") : undefined;
      const ivFromInput = normIvFromInput(p.ivFromInput);
      const inc = normIncludeIv(p.includeIv);
      const dir = ivFromInput !== "off" ? ivFromInput
        : (inc === "prepend" ? "start" : inc === "append" ? "end" : "off");
      if (dir !== "off") {
        const ladder = explicit
          ? [explicit.length]
          : [...new Set([Number(p.ivLen) || 12, 12, 16])];
        let lastErr = null;
        for (const ivLen of ladder) {
          if (data.length < ivLen + inTagBytes) continue;
          const iv = dir === "start" ? data.subarray(0, ivLen) : data.subarray(data.length - ivLen);
          const body = dir === "start" ? data.subarray(ivLen) : data.subarray(0, data.length - ivLen);
          if (ivFromInput !== "off" && explicit && !bytesEqual(iv, explicit)) {
            lastErr = new Error(`IV 参数与输入${dir === "start" ? "开头" : "末尾"}的 ${ivLen} 字节 IV 不一致`);
            continue;
          }
          try {
            // 兼容旧 Include IV：显式 IV 优先用参数值；ivFromInput 时用输入中取出的 IV。
            const useIv = ivFromInput === "off" && explicit ? explicit : iv;
            return encodeOutput(await aesGcmDecrypt(withTag(body), key, useIv, aad, { tagLen }), "utf8");
          } catch (e) { lastErr = e; }
        }
        throw lastErr || new Error(`GCM 无法从输入${dir === "start" ? "开头" : "末尾"}取出 IV（数据过短）`);
      }
      if (!explicit) throw new Error("GCM 需提供 nonce（IV）");
      return encodeOutput(await aesGcmDecrypt(withTag(data), key, explicit, aad, { tagLen }), "utf8");
    }
    const iv = p.iv ? decodeInput(p.iv, p.ivEnc || "hex") : undefined;
    return encodeOutput(decFn(data, key, { mode, iv, padding }), "utf8");
  };
}

register({
  id: "aes", family: "aes", familyLabel: "encdec", cat: "block", name: "AES", desc: "高级加密标准（ECB/CBC/CFB/OFB/CTR 纯 JS + GCM WebCrypto，key 16/24/32 字节）。ECB/CBC 支持 PKCS#7/NoPadding/Zero/Bit/ISO10126/ANSI X9.23；GCM 支持 AAD（utf8/hex/base64/latin1）、tagLen(128…32 位)、Include IV、解密独立 tag 与 ivFromInput；流模式忽略填充",
  params: blockParams(["ECB", "CBC", "CFB", "OFB", "CTR", "GCM"], "16/24/32 字节密钥", { gcm: true }),
  encode: makeBlockEncode(aesEncrypt, true),
  decode: makeBlockDecode(aesDecrypt, true),
  acceptsBytes: true,
});
register({
  id: "des", family: "des", familyLabel: "des", cat: "block", name: "DES", desc: "数据加密标准（FIPS-46-3，key 8 字节，块 8 字节）。ECB/CBC 支持 PKCS#7/NoPadding/Zero/Bit/ISO10126/ANSI X9.23；流模式忽略填充",
  params: blockParams(["ECB", "CBC", "CFB", "OFB", "CTR"], "8 字节密钥"),
  encode: makeBlockEncode(desEncrypt, false),
  decode: makeBlockDecode(desDecrypt, false),
  acceptsBytes: true,
});
register({
  id: "des3", family: "des", familyLabel: "3des", cat: "block", name: "3DES / TripleDES", desc: "三重 DES（EDE，key 16 或 24 字节，块 8 字节）。ECB/CBC 支持 PKCS#7/NoPadding/Zero/Bit/ISO10126/ANSI X9.23；流模式忽略填充",
  params: blockParams(["ECB", "CBC", "CFB", "OFB", "CTR"], "16/24 字节密钥"),
  encode: makeBlockEncode(des3Encrypt, false),
  decode: makeBlockDecode(des3Decrypt, false),
  acceptsBytes: true,
});

// RC4 / XOR：流密码，自反。encode=decode（明文↔密文同一变换）。
function makeStreamOp(fn) {
  const enc = (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    return encodeOutput(fn(rawBytesOrNull(p, text) || te(text), key), p.outEnc || "base64");
  };
  const dec = (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    return encodeOutput(fn(rawBytesOrNull(p, text.trim()) || decodeInput(text.trim(), p.outEnc || "base64"), key), "utf8");
  };
  return { enc, dec };
}
const STREAM_PARAMS = [
  { key: "key", label: "密钥", type: "text", default: "", placeholder: "密钥" },
  { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
  { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: OUT_OPTS },
];
// XOR 单独 params：默认密钥给非空示例值，避免首次转换即报错（用户看到结果后自然知道改 key）
const XOR_PARAMS = [
  { key: "key", label: "密钥", type: "text", default: "ctf", placeholder: "密钥" },
  { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
  { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: OUT_OPTS },
  { key: "scheme", label: "Scheme（同 CyberChef）", type: "select", default: "Standard", options: [
    { value: "Standard", label: "Standard" },
    { value: "Input differential", label: "Input differential" },
    { value: "Output differential", label: "Output differential" },
    { value: "Cascade", label: "Cascade" },
  ] },
  { key: "nullPreserving", label: "Null preserving", type: "bool", default: false },
];

function xorApply(data, key, scheme = "Standard", nullPreserving = false) {
  if (!key.length) throw new Error("XOR：密钥不能为空");
  const out = new Uint8Array(data.length);
  let prevIn = 0, prevOut = 0;
  for (let i = 0; i < data.length; i++) {
    let kb;
    if (scheme === "Input differential") kb = i === 0 ? key[0] : prevIn;
    else if (scheme === "Output differential") kb = i === 0 ? key[0] : prevOut;
    else if (scheme === "Cascade") kb = i === 0 ? key[0] : ((prevIn << 1) & 0xff);
    else kb = key[i % key.length];
    const b = data[i];
    out[i] = (nullPreserving && (b === 0 || b === kb)) ? b : (b ^ kb);
    prevIn = b;
    prevOut = out[i];
  }
  return out;
}
{
  const RC4_PARAMS = [
    { key: "key", label: "密钥 / Passphrase", type: "text", default: "", placeholder: "密钥" },
    { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: RC4_IO_OPTS },
    { key: "inEnc", label: "输入编码（空=编码方向 UTF-8 / 解码方向跟随密文编码）", type: "select", default: "",
      options: [{ value: "", label: "跟随（旧行为）" }, ...RC4_IO_OPTS] },
    { key: "outEnc", label: "输出编码", type: "select", default: "base64", options: RC4_IO_OPTS },
  ];
  const enc = (text, p) => {
    const key = decodeInputIo(p.key || "", p.keyEnc || "utf8");
    const data = rawBytesOrNull(p, text) || decodeInputIo(text, (p && p.inEnc) || "utf8");
    return encodeOutputIo(rc4(data, key), p.outEnc || "base64");
  };
  const dec = (text, p) => {
    const key = decodeInputIo(p.key || "", p.keyEnc || "utf8");
    const data = rawBytesOrNull(p, text.trim()) || decodeInputIo(text.trim(), (p && p.inEnc) || p.outEnc || "base64");
    return encodeOutputIo(rc4(data, key), "utf8");
  };
  register({
    id: "rc4", cat: "stream", name: "RC4", desc: "RC4 流密码（自反，key 任意长；密钥/输入/输出支持 UTF16/UTF16LE/UTF16BE/Latin1/Hex/Base64）。若密文以 U2FsdGVk 开头（OpenSSL/CryptoJS 的 Salted__ 封装），请改用「OpenSSL 口令加解密」并选 RC4",
    params: RC4_PARAMS, encode: enc, decode: dec,
    acceptsBytes: true,
  });
}
{
  const enc = (text, p) => {
    const key = decodeInputIo(p.key || "", p.keyEnc || "utf8");
    const data = rawBytesOrNull(p, text) || decodeInputIo(text, "utf8");
    return encodeOutputIo(xorApply(data, key, p.scheme || "Standard", !!p.nullPreserving), p.outEnc || "base64");
  };
  const dec = (text, p) => {
    const key = decodeInputIo(p.key || "", p.keyEnc || "utf8");
    const data = rawBytesOrNull(p, text.trim()) || decodeInputIo(text.trim(), p.outEnc || "base64");
    return encodeOutputIo(xorApply(data, key, p.scheme || "Standard", !!p.nullPreserving), "utf8");
  };
  register({
    id: "xor", cat: "stream", name: "XOR", desc: "重复密钥异或（自反，CTF 最常用；单字节爆破见分析类 xorBrute；支持 Standard/Input differential/Output differential/Cascade + Null preserving）",
    params: XOR_PARAMS, encode: enc, decode: dec,
    acceptsBytes: true,
  });
}

register({
  id: "fernet", cat: "modern", name: "Fernet", desc: "对称令牌（AES-128-CBC + HMAC-SHA256，key 为 base64url 32 字节）",
  params: [
    { key: "key", label: "Fernet 密钥", type: "text", default: "", placeholder: "base64url 32 字节" },
    { key: "checkMac", label: "校验 HMAC", type: "bool", default: true },
  ],
  encode: async (text, p) => fernetEncrypt(te(text), p.key || ""),
  decode: async (text, p) => finishBytesDecode(await fernetDecrypt(text.trim(), p.key || "", { checkMac: p.checkMac !== false }), { textMode: "hex", name: "fernet" }),
});

// RSA 完整版（BigInt）。encode=c=m^e mod n，decode=m=c^d mod n。
// 相比原教学版增强（向后兼容，dataEnc/outEnc 默认 dec = 原纯十进制行为）：
// - dataEnc：输入(明文/密文)编码 dec/hex/base64/utf8，支持真实 CTF 的 hex/base64 密文
// - outEnc ：输出(密文/明文)编码 dec/hex/base64/utf8，解密后 m→ASCII 直出 flag
// - p,q ：填了自动算 n=pq 与 d=e⁻¹ mod φ，免手推私钥（n/d 缺时才用，不覆盖手填）
// RSA 数据编解码约定：数字域用十进制大整数；字节域(hex/base64/utf8)经 OS2IP/I2OSP
// 与整数互转（bytesToBigInt/bigIntToBytes 大端）。
const RSA_DATA_ENC = [
  { value: "dec", label: "十进制大数" },
  { value: "hex", label: "Hex 字节" },
  { value: "base64", label: "Base64 字节" },
  { value: "utf8", label: "UTF-8 文本" },
];
// 输入文本 → BigInt（m 或 c）。dec 直接 BigInt；字节域先解码再 OS2IP。
function rsaTextToInt(text, enc) {
  const s = text.trim();
  if (enc === "dec") {
    if (!/^\d+$/.test(s)) throw new Error("十进制模式下输入须为纯数字（含 hex/base64 密文请改「输入编码」）");
    return BigInt(s);
  }
  return bytesToBigInt(decodeInput(enc === "utf8" ? text : s, enc));
}
// BigInt 结果 → 输出文本。dec 直接十进制；字节域先 I2OSP 再编码。
function rsaIntToText(v, enc) {
  if (enc === "dec") return v.toString();
  return encodeOutput(bigIntToBytes(v), enc);
}
// 解析 n：优先手填 n，否则 p·q 自动算。
function rsaResolveN(p) {
  const nStr = (p.n || "").trim();
  if (nStr) return BigInt(nStr);
  const pp = (p.p || "").trim(), qq = (p.q || "").trim();
  if (pp && qq) return BigInt(pp) * BigInt(qq);
  throw new Error("缺模数：请填 n，或同时填 p 和 q（自动算 n=p·q）");
}
// 解析 d：优先手填 d，否则由 p,q,e 推导。
function rsaResolveD(p) {
  const dStr = (p.d || "").trim();
  if (dStr) return BigInt(dStr);
  const pp = (p.p || "").trim(), qq = (p.q || "").trim();
  if (pp && qq) return rsaDeriveD(BigInt(pp), BigInt(qq), BigInt((p.e || "65537").trim()));
  throw new Error("缺私钥：请填 d，或同时填 p 和 q（自动推 d=e⁻¹ mod φ）");
}
register({
  id: "rsa", family: "rsa", familyLabel: "encdec", cat: "asym", name: "RSA",
  desc: "RSA 模幂加解密：加密 c=mᵉ mod n，解密 m=cᵈ mod n。支持 hex/base64 密文与明文字节串（解密直出 flag）；填 p,q 自动推 n 和 d。",
  params: [
    { key: "n", label: "模数 n", type: "text", default: "", placeholder: "十进制；留空则用 p·q" },
    { key: "e", label: "公钥指数 e", type: "text", default: "65537", placeholder: "加密/推 d 用" },
    { sensitive: true, key: "d", label: "私钥指数 d", type: "text", default: "", placeholder: "解密；留空则由 p,q 推" },
    { key: "p", label: "素数 p（可选）", type: "text", default: "", placeholder: "填 p,q 自动算 n 和 d" },
    { key: "q", label: "素数 q（可选）", type: "text", default: "", placeholder: "填 p,q 自动算 n 和 d" },
    { key: "dataEnc", label: "输入编码", type: "select", default: "dec", options: RSA_DATA_ENC },
    { key: "outEnc", label: "输出编码", type: "select", default: "dec", options: RSA_DATA_ENC },
  ],
  acceptsBytes: true,
  encode: (text, p) => {
    const raw = rawBytesOrNull(p, text);
    const m = raw ? bytesToBigInt(raw) : rsaTextToInt(text, p.dataEnc || "dec");
    const e = BigInt((p.e || "65537").trim());
    const n = rsaResolveN(p);
    return rsaIntToText(rsaPow(m, e, n), p.outEnc || "dec");
  },
  decode: (text, p) => {
    const raw = rawBytesOrNull(p, text);
    const c = raw ? bytesToBigInt(raw) : rsaTextToInt(text, p.dataEnc || "dec");
    const d = rsaResolveD(p);
    const n = rsaResolveN(p);
    return rsaIntToText(rsaPow(c, d, n), p.outEnc || "dec");
  },
});
