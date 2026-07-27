/*
 * modernExt2.js — 现代分组密码补全组2。
 *
 * 覆盖：RC5（RFC 2040）/ IDEA（Lai 1991）—— modern.js / modernExt.js 未覆盖的分组密码。
 * 与 modern.js / modernExt.js 解耦（内嵌≠耦合红线），自写编码工具 + PKCS7 + 分组模式。
 *
 * 红线：
 * - RC5 走 RFC 2040 标准（RC5-32/12/16：32 位字，12 轮，可变密钥），用 RFC 2040 附录 B 官方向量验证。
 * - IDEA 走 Lai 1991 标准（64 位块，128 位密钥，8.5 轮），用权威测试向量验证。
 * - 零外发：全部本地纯 JS 计算。
 * - 契约：核心算法层纯函数（字节进字节出），register 层负责编码（hex/base64/utf8）解析与拼装。
 *
 * 分层：
 * [RC5 内核] rc5KeySchedule / rc5EncryptBlock / rc5DecryptBlock — 64 位块，12 轮
 * [IDEA 内核] ideaKeySchedule / ideaDecryptKeySchedule / ideaEncryptBlock — 64 位块，8.5 轮
 * [分组模式] ecb/cbc（自写，避免依赖 modern.js）
 * [填充] pkcs7 pad/unpad（自写）
 * [高层 API] rc5Encrypt/rc5Decrypt / ideaEncrypt/ideaDecrypt
 * [register] 编码解析（key/iv/data 的 hex|base64|utf8|latin1）+ 双向注册
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============================================================
// 字节 <-> 编码 工具（hex / base64 / utf8 / latin1）
// ============================================================
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

// ============================================================
// 32 位整数运算工具
// ============================================================
function readU32LE(b, off) {
  return ((b[off]) | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}
function writeU32LE(b, off, v) {
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
}
function rotl32(x, s) {
  s = s & 31;
  if (s === 0) return x >>> 0;
  return ((x << s) | (x >>> (32 - s))) >>> 0;
}
function rotr32(x, s) {
  s = s & 31;
  if (s === 0) return x >>> 0;
  return ((x >>> s) | (x << (32 - s))) >>> 0;
}

// ============================================================
// PKCS#7 填充
// ============================================================
function pkcs7Pad(data, blockSize) {
  const padLen = blockSize - (data.length % blockSize);
  const out = new Uint8Array(data.length + padLen);
  out.set(data);
  out.fill(padLen, data.length);
  return out;
}
function pkcs7Unpad(data, blockSize) {
  if (data.length === 0 || data.length % blockSize !== 0) throw new Error("密文长度非块大小整数倍，无法去填充");
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > blockSize) throw new Error("PKCS7 填充非法（可能密钥/模式错误）");
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) throw new Error("PKCS7 填充校验失败（可能密钥/模式错误）");
  }
  return data.subarray(0, data.length - padLen);
}
function xorBytes(a, b) {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] ^ b[i];
  return o;
}

// ============================================================
// 分组模式（通用，块密码传入 encBlock/decBlock，块大小 bs）
// ============================================================
function ecbEncrypt(data, encBlock, bs, pad = true) {
  const d = pad ? pkcs7Pad(data, bs) : data;
  if (d.length % bs) throw new Error(`明文需为 ${bs} 字节整数倍（或开启填充）`);
  const out = new Uint8Array(d.length);
  for (let i = 0; i < d.length; i += bs) out.set(encBlock(d.subarray(i, i + bs)), i);
  return out;
}
function ecbDecrypt(data, decBlock, bs, pad = true) {
  if (data.length % bs) throw new Error(`密文需为 ${bs} 字节整数倍`);
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += bs) out.set(decBlock(data.subarray(i, i + bs)), i);
  return pad ? pkcs7Unpad(out, bs) : out;
}
function cbcEncrypt(data, encBlock, bs, iv, pad = true) {
  const d = pad ? pkcs7Pad(data, bs) : data;
  if (d.length % bs) throw new Error(`明文需为 ${bs} 字节整数倍（或开启填充）`);
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
  return pad ? pkcs7Unpad(out, bs) : out;
}

// ============================================================
// RC5-32/12/16（RFC 2040）
// 64 位块，12 轮，可变密钥（1-255 字节，默认 16 字节）
// 常数：P32 = Odd(π-2)·2^32 = 0xB7E15163，Q32 = Odd((e-2)·2^32) = 0x9E3779B9
// ============================================================
const RC5_P32 = 0xB7E15163;
const RC5_Q32 = 0x9E3779B9;
const RC5_ROUNDS = 12;
const RC5_BLOCK_SIZE = 8;
const RC5_T = 2 * (RC5_ROUNDS + 1); // 26 个子密钥

function rc5KeySchedule(key) {
 // key: Uint8Array(1..255)
  const u = 4; // 32/8
  const b = key.length;
  const c = Math.max(1, Math.ceil(b / u));
  const L = new Uint32Array(c);
 // 把密钥字节按小端填入 L
  for (let i = b - 1; i >= 0; i--) {
    L[(i / u) | 0] = ((L[(i / u) | 0] << 8) + key[i]) >>> 0;
  }
  const S = new Uint32Array(RC5_T);
  S[0] = RC5_P32;
  for (let i = 1; i < RC5_T; i++) {
    S[i] = (S[i - 1] + RC5_Q32) >>> 0;
  }
  let A = 0, B = 0;
  let i = 0, j = 0;
  const n = 3 * Math.max(RC5_T, c);
  for (let k = 0; k < n; k++) {
    A = S[i] = rotl32((S[i] + A + B) >>> 0, 3);
    B = L[j] = rotl32((L[j] + A + B) >>> 0, (A + B) & 31);
    i = (i + 1) % RC5_T;
    j = (j + 1) % c;
  }
  return S;
}

function rc5EncryptBlock(block, S) {
 // block: Uint8Array(8), 小端
  let A = readU32LE(block, 0);
  let B = readU32LE(block, 4);
  A = (A + S[0]) >>> 0;
  B = (B + S[1]) >>> 0;
  for (let r = 1; r <= RC5_ROUNDS; r++) {
    A = (rotl32(A ^ B, B) + S[2 * r]) >>> 0;
    B = (rotl32(B ^ A, A) + S[2 * r + 1]) >>> 0;
  }
  const out = new Uint8Array(8);
  writeU32LE(out, 0, A);
  writeU32LE(out, 4, B);
  return out;
}

function rc5DecryptBlock(block, S) {
  let A = readU32LE(block, 0);
  let B = readU32LE(block, 4);
  for (let r = RC5_ROUNDS; r >= 1; r--) {
    B = rotr32((B - S[2 * r + 1]) >>> 0, A) ^ A;
    A = rotr32((A - S[2 * r]) >>> 0, B) ^ B;
  }
  A = (A - S[0]) >>> 0;
  B = (B - S[1]) >>> 0;
  const out = new Uint8Array(8);
  writeU32LE(out, 0, A);
  writeU32LE(out, 4, B);
  return out;
}

export function rc5Encrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  const S = rc5KeySchedule(key);
  const enc = (blk) => rc5EncryptBlock(blk, S);
  if (mode === "ECB") return ecbEncrypt(data, enc, RC5_BLOCK_SIZE);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcEncrypt(data, enc, RC5_BLOCK_SIZE, iv);
  }
  throw new Error(`RC5 不支持模式: ${mode}`);
}

export function rc5Decrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  const S = rc5KeySchedule(key);
  const dec = (blk) => rc5DecryptBlock(blk, S);
  if (mode === "ECB") return ecbDecrypt(data, dec, RC5_BLOCK_SIZE);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcDecrypt(data, dec, RC5_BLOCK_SIZE, iv);
  }
  throw new Error(`RC5 不支持模式: ${mode}`);
}

// ============================================================
// IDEA（Lai 1991，国际数据加密算法）
// 64 位块，128 位密钥，8.5 轮（8 轮 + 最终输出变换）
// 运算：mod 2^16 加法 ⊕ / mod 2^16+1 (65537) 乘法 ⊗ / XOR
// ============================================================
const IDEA_MOD = 0x10001; // 65537（素数）

// 乘法 mod 65537：0 表示 65536
function ideaMulMod(a, b) {
  if (a < 0 || a > 0xFFFF || b < 0 || b > 0xFFFF) throw new Error("ideaMulMod 越界");
  if (a === 0) a = 0x10000;
  if (b === 0) b = 0x10000;
  const r = a * b; // 最大 65536 * 65536 = 2^32，JS 安全
  let lo = r & 0xFFFF;
  let hi = r >>> 16;
  let result = lo - hi;
  if (result < 0) result += IDEA_MOD;
  return result & 0xFFFF;
}

// 乘法逆元 mod 65537（扩展欧几里得，用 BigInt 保证安全）
function ideaMulInv(x) {
  if (x < 0 || x > 0xFFFF) throw new Error("ideaMulInv 越界");
 // 0 表示 65536，65536^2 mod 65537 = 1，所以 0 的逆元是 0
  if (x === 0) return 0;
  const mod = BigInt(IDEA_MOD);
  let a = BigInt(x);
  let y = mod;
  let t0 = 0n, t1 = 1n;
  while (a > 1n) {
    const q = y / a;
    const r = y - q * a;
    y = a;
    a = r;
    const t = t0 - q * t1;
    t0 = t1;
    t1 = t;
  }
  const inv = ((t1 % mod) + mod) % mod;
  return Number(inv) & 0xFFFF;
}

// 加法逆元 mod 2^16
function ideaAddInv(x) {
  return (0x10000 - x) & 0xFFFF;
}

// 128 位密钥循环左移 25 位（用 BigInt 处理）
function ideaRotate25(keyBytes) {
  let big = 0n;
  for (let i = 0; i < 16; i++) {
    big = (big << 8n) | BigInt(keyBytes[i]);
  }
 // 循环左移 25 位：高 25 位移到低位
  const mask = (1n << 128n) - 1n;
  const shifted = ((big << 25n) | (big >> 103n)) & mask;
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[15 - i] = Number((shifted >> BigInt(i * 8)) & 0xFFn);
  }
  return out;
}

// IDEA 加密子密钥调度：128 位密钥 -> 52 个 16 位子密钥
function ideaKeySchedule(key) {
 // key: Uint8Array(16)
  if (key.length !== 16) throw new Error("IDEA 密钥必须为 16 字节（128 位）");
  const sub = new Uint16Array(52);
  let buf = new Uint8Array(key);
  let offset = 0;
  while (offset < 52) {
    for (let i = 0; i < 8 && offset < 52; i++) {
      sub[offset++] = (buf[i * 2] << 8) | buf[i * 2 + 1];
    }
    if (offset < 52) {
      buf = ideaRotate25(buf);
    }
  }
  return sub;
}

// IDEA 解密子密钥调度：从加密子密钥生成解密子密钥
function ideaDecryptKeySchedule(enc) {
  const dec = new Uint16Array(52);
 // 第 1 轮解密（对应最终变换 + 第 8 轮的 MA 子密钥）
  dec[0] = ideaMulInv(enc[48]);
  dec[1] = ideaAddInv(enc[49]); // 最终变换，不交换
  dec[2] = ideaAddInv(enc[50]); // 最终变换，不交换
  dec[3] = ideaMulInv(enc[51]);
  dec[4] = enc[46]; // 第 8 轮 K5
  dec[5] = enc[47]; // 第 8 轮 K6
 // 第 2-8 轮解密（对应第 7-1 轮）
  for (let i = 1; i <= 7; i++) {
    dec[6 * i + 0] = ideaMulInv(enc[48 - 6 * i]);
    dec[6 * i + 1] = ideaAddInv(enc[50 - 6 * i]); // 交换
    dec[6 * i + 2] = ideaAddInv(enc[49 - 6 * i]); // 交换
    dec[6 * i + 3] = ideaMulInv(enc[51 - 6 * i]);
    dec[6 * i + 4] = enc[46 - 6 * i]; // 第 (8-i) 轮 K5
    dec[6 * i + 5] = enc[47 - 6 * i]; // 第 (8-i) 轮 K6
  }
 // 最终变换（对应第 1 轮；解密轮 7 不交换，故 K2'/K3' 不交换）
  dec[48] = ideaMulInv(enc[0]);
  dec[49] = ideaAddInv(enc[1]); // 不交换
  dec[50] = ideaAddInv(enc[2]); // 不交换
  dec[51] = ideaMulInv(enc[3]);
  return dec;
}

function ideaEncryptBlock(block, sub) {
 // block: Uint8Array(8), sub: 52 个 16 位子密钥
  let x1 = (block[0] << 8) | block[1];
  let x2 = (block[2] << 8) | block[3];
  let x3 = (block[4] << 8) | block[5];
  let x4 = (block[6] << 8) | block[7];
  for (let r = 0; r < 8; r++) {
 // 步骤 1: 乘/加
    x1 = ideaMulMod(x1, sub[r * 6 + 0]);
    x2 = (x2 + sub[r * 6 + 1]) & 0xFFFF;
    x3 = (x3 + sub[r * 6 + 2]) & 0xFFFF;
    x4 = ideaMulMod(x4, sub[r * 6 + 3]);
 // 步骤 2: MA 结构
    const t1 = x1 ^ x3;
    const t2 = x2 ^ x4;
    const m1 = ideaMulMod(t1, sub[r * 6 + 4]);
    const m2 = (t2 + m1) & 0xFFFF;
    const m3 = ideaMulMod(m2, sub[r * 6 + 5]);
    const m4 = (m1 + m3) & 0xFFFF;
 // 步骤 3: 异或
    x1 ^= m3;
    x3 ^= m3;
    x2 ^= m4;
    x4 ^= m4;
 // 步骤 4: 交换 x2 和 x3（最后一轮不交换）
    if (r < 7) {
      const tmp = x2; x2 = x3; x3 = tmp;
    }
  }
 // 最终输出变换（不交换 x2/x3，直接用）
  const y1 = ideaMulMod(x1, sub[48]);
  const y2 = (x2 + sub[49]) & 0xFFFF;
  const y3 = (x3 + sub[50]) & 0xFFFF;
  const y4 = ideaMulMod(x4, sub[51]);
  const out = new Uint8Array(8);
  out[0] = (y1 >>> 8) & 0xff;
  out[1] = y1 & 0xff;
  out[2] = (y2 >>> 8) & 0xff;
  out[3] = y2 & 0xff;
  out[4] = (y3 >>> 8) & 0xff;
  out[5] = y3 & 0xff;
  out[6] = (y4 >>> 8) & 0xff;
  out[7] = y4 & 0xff;
  return out;
}

export function ideaEncrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  const sub = ideaKeySchedule(key);
  const enc = (blk) => ideaEncryptBlock(blk, sub);
  if (mode === "ECB") return ecbEncrypt(data, enc, 8);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcEncrypt(data, enc, 8, iv);
  }
  throw new Error(`IDEA 不支持模式: ${mode}`);
}

export function ideaDecrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  const encSub = ideaKeySchedule(key);
  const decSub = ideaDecryptKeySchedule(encSub);
  const dec = (blk) => ideaEncryptBlock(blk, decSub); // 解密用同一加密函数 + 解密子密钥
  if (mode === "ECB") return ecbDecrypt(data, dec, 8);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcDecrypt(data, dec, 8, iv);
  }
  throw new Error(`IDEA 不支持模式: ${mode}`);
}

// ============================================================
// Blowfish（Schneier 1993）
// 64 位块，可变密钥（4-56 字节），16 轮 Feistel
// P-array(18) + S-boxes(4×256)，初始化为 π 的十六进制小数位
// ============================================================
const BF_P_INIT = new Uint32Array([
  0x243F6A88,   0x85A308D3,   0x13198A2E,   0x03707344,   0xA4093822,   0x299F31D0,
  0x082EFA98,   0xEC4E6C89,   0x452821E6,   0x38D01377,   0xBE5466CF,   0x34E90C6C,
  0xC0AC29B7,   0xC97C50DD,   0x3F84D5B5,   0xB5470917,   0x9216D5D9,   0x8979FB1B
]);

const BF_S_INIT = [
  new Uint32Array([
    0xD1310BA6,     0x98DFB5AC,     0x2FFD72DB,     0xD01ADFB7,     0xB8E1AFED,     0x6A267E96,     0xBA7C9045,     0xF12C7F99,
    0x24A19947,     0xB3916CF7,     0x0801F2E2,     0x858EFC16,     0x636920D8,     0x71574E69,     0xA458FEA3,     0xF4933D7E,
    0x0D95748F,     0x728EB658,     0x718BCD58,     0x82154AEE,     0x7B54A41D,     0xC25A59B5,     0x9C30D539,     0x2AF26013,
    0xC5D1B023,     0x286085F0,     0xCA417918,     0xB8DB38EF,     0x8E79DCB0,     0x603A180E,     0x6C9E0E8B,     0xB01E8A3E,
    0xD71577C1,     0xBD314B27,     0x78AF2FDA,     0x55605C60,     0xE65525F3,     0xAA55AB94,     0x57489862,     0x63E81440,
    0x55CA396A,     0x2AAB10B6,     0xB4CC5C34,     0x1141E8CE,     0xA15486AF,     0x7C72E993,     0xB3EE1411,     0x636FBC2A,
    0x2BA9C55D,     0x741831F6,     0xCE5C3E16,     0x9B87931E,     0xAFD6BA33,     0x6C24CF5C,     0x7A325381,     0x28958677,
    0x3B8F4898,     0x6B4BB9AF,     0xC4BFE81B,     0x66282193,     0x61D809CC,     0xFB21A991,     0x487CAC60,     0x5DEC8032,
    0xEF845D5D,     0xE98575B1,     0xDC262302,     0xEB651B88,     0x23893E81,     0xD396ACC5,     0x0F6D6FF3,     0x83F44239,
    0x2E0B4482,     0xA4842004,     0x69C8F04A,     0x9E1F9B5E,     0x21C66842,     0xF6E96C9A,     0x670C9C61,     0xABD388F0,
    0x6A51A0D2,     0xD8542F68,     0x960FA728,     0xAB5133A3,     0x6EEF0B6C,     0x137A3BE4,     0xBA3BF050,     0x7EFB2A98,
    0xA1F1651D,     0x39AF0176,     0x66CA593E,     0x82430E88,     0x8CEE8619,     0x456F9FB4,     0x7D84A5C3,     0x3B8B5EBE,
    0xE06F75D8,     0x85C12073,     0x401A449F,     0x56C16AA6,     0x4ED3AA62,     0x363F7706,     0x1BFEDF72,     0x429B023D,
    0x37D0D724,     0xD00A1248,     0xDB0FEAD3,     0x49F1C09B,     0x075372C9,     0x80991B7B,     0x25D479D8,     0xF6E8DEF7,
    0xE3FE501A,     0xB6794C3B,     0x976CE0BD,     0x04C006BA,     0xC1A94FB6,     0x409F60C4,     0x5E5C9EC2,     0x196A2463,
    0x68FB6FAF,     0x3E6C53B5,     0x1339B2EB,     0x3B52EC6F,     0x6DFC511F,     0x9B30952C,     0xCC814544,     0xAF5EBD09,
    0xBEE3D004,     0xDE334AFD,     0x660F2807,     0x192E4BB3,     0xC0CBA857,     0x45C8740F,     0xD20B5F39,     0xB9D3FBDB,
    0x5579C0BD,     0x1A60320A,     0xD6A100C6,     0x402C7279,     0x679F25FE,     0xFB1FA3CC,     0x8EA5E9F8,     0xDB3222F8,
    0x3C7516DF,     0xFD616B15,     0x2F501EC8,     0xAD0552AB,     0x323DB5FA,     0xFD238760,     0x53317B48,     0x3E00DF82,
    0x9E5C57BB,     0xCA6F8CA0,     0x1A87562E,     0xDF1769DB,     0xD542A8F6,     0x287EFFC3,     0xAC6732C6,     0x8C4F5573,
    0x695B27B0,     0xBBCA58C8,     0xE1FFA35D,     0xB8F011A0,     0x10FA3D98,     0xFD2183B8,     0x4AFCB56C,     0x2DD1D35B,
    0x9A53E479,     0xB6F84565,     0xD28E49BC,     0x4BFB9790,     0xE1DDF2DA,     0xA4CB7E33,     0x62FB1341,     0xCEE4C6E8,
    0xEF20CADA,     0x36774C01,     0xD07E9EFE,     0x2BF11FB4,     0x95DBDA4D,     0xAE909198,     0xEAAD8E71,     0x6B93D5A0,
    0xD08ED1D0,     0xAFC725E0,     0x8E3C5B2F,     0x8E7594B7,     0x8FF6E2FB,     0xF2122B64,     0x8888B812,     0x900DF01C,
    0x4FAD5EA0,     0x688FC31C,     0xD1CFF191,     0xB3A8C1AD,     0x2F2F2218,     0xBE0E1777,     0xEA752DFE,     0x8B021FA1,
    0xE5A0CC0F,     0xB56F74E8,     0x18ACF3D6,     0xCE89E299,     0xB4A84FE0,     0xFD13E0B7,     0x7CC43B81,     0xD2ADA8D9,
    0x165FA266,     0x80957705,     0x93CC7314,     0x211A1477,     0xE6AD2065,     0x77B5FA86,     0xC75442F5,     0xFB9D35CF,
    0xEBCDAF0C,     0x7B3E89A0,     0xD6411BD3,     0xAE1E7E49,     0x00250E2D,     0x2071B35E,     0x226800BB,     0x57B8E0AF,
    0x2464369B,     0xF009B91E,     0x5563911D,     0x59DFA6AA,     0x78C14389,     0xD95A537F,     0x207D5BA2,     0x02E5B9C5,
    0x83260376,     0x6295CFA9,     0x11C81968,     0x4E734A41,     0xB3472DCA,     0x7B14A94A,     0x1B510052,     0x9A532915,
    0xD60F573F,     0xBC9BC6E4,     0x2B60A476,     0x81E67400,     0x08BA6FB5,     0x571BE91F,     0xF296EC6B,     0x2A0DD915,
    0xB6636521,     0xE7B9F9B6,     0xFF34052E,     0xC5855664,     0x53B02D5D,     0xA99F8FA1,     0x08BA4799,     0x6E85076A
  ]),
  new Uint32Array([
    0x4B7A70E9,     0xB5B32944,     0xDB75092E,     0xC4192623,     0xAD6EA6B0,     0x49A7DF7D,     0x9CEE60B8,     0x8FEDB266,
    0xECAA8C71,     0x699A17FF,     0x5664526C,     0xC2B19EE1,     0x193602A5,     0x75094C29,     0xA0591340,     0xE4183A3E,
    0x3F54989A,     0x5B429D65,     0x6B8FE4D6,     0x99F73FD6,     0xA1D29C07,     0xEFE830F5,     0x4D2D38E6,     0xF0255DC1,
    0x4CDD2086,     0x8470EB26,     0x6382E9C6,     0x021ECC5E,     0x09686B3F,     0x3EBAEFC9,     0x3C971814,     0x6B6A70A1,
    0x687F3584,     0x52A0E286,     0xB79C5305,     0xAA500737,     0x3E07841C,     0x7FDEAE5C,     0x8E7D44EC,     0x5716F2B8,
    0xB03ADA37,     0xF0500C0D,     0xF01C1F04,     0x0200B3FF,     0xAE0CF51A,     0x3CB574B2,     0x25837A58,     0xDC0921BD,
    0xD19113F9,     0x7CA92FF6,     0x94324773,     0x22F54701,     0x3AE5E581,     0x37C2DADC,     0xC8B57634,     0x9AF3DDA7,
    0xA9446146,     0x0FD0030E,     0xECC8C73E,     0xA4751E41,     0xE238CD99,     0x3BEA0E2F,     0x3280BBA1,     0x183EB331,
    0x4E548B38,     0x4F6DB908,     0x6F420D03,     0xF60A04BF,     0x2CB81290,     0x24977C79,     0x5679B072,     0xBCAF89AF,
    0xDE9A771F,     0xD9930810,     0xB38BAE12,     0xDCCF3F2E,     0x5512721F,     0x2E6B7124,     0x501ADDE6,     0x9F84CD87,
    0x7A584718,     0x7408DA17,     0xBC9F9ABC,     0xE94B7D8C,     0xEC7AEC3A,     0xDB851DFA,     0x63094366,     0xC464C3D2,
    0xEF1C1847,     0x3215D908,     0xDD433B37,     0x24C2BA16,     0x12A14D43,     0x2A65C451,     0x50940002,     0x133AE4DD,
    0x71DFF89E,     0x10314E55,     0x81AC77D6,     0x5F11199B,     0x043556F1,     0xD7A3C76B,     0x3C11183B,     0x5924A509,
    0xF28FE6ED,     0x97F1FBFA,     0x9EBABF2C,     0x1E153C6E,     0x86E34570,     0xEAE96FB1,     0x860E5E0A,     0x5A3E2AB3,
    0x771FE71C,     0x4E3D06FA,     0x2965DCB9,     0x99E71D0F,     0x803E89D6,     0x5266C825,     0x2E4CC978,     0x9C10B36A,
    0xC6150EBA,     0x94E2EA78,     0xA5FC3C53,     0x1E0A2DF4,     0xF2F74EA7,     0x361D2B3D,     0x1939260F,     0x19C27960,
    0x5223A708,     0xF71312B6,     0xEBADFE6E,     0xEAC31F66,     0xE3BC4595,     0xA67BC883,     0xB17F37D1,     0x018CFF28,
    0xC332DDEF,     0xBE6C5AA5,     0x65582185,     0x68AB9802,     0xEECEA50F,     0xDB2F953B,     0x2AEF7DAD,     0x5B6E2F84,
    0x1521B628,     0x29076170,     0xECDD4775,     0x619F1510,     0x13CCA830,     0xEB61BD96,     0x0334FE1E,     0xAA0363CF,
    0xB5735C90,     0x4C70A239,     0xD59E9E0B,     0xCBAADE14,     0xEECC86BC,     0x60622CA7,     0x9CAB5CAB,     0xB2F3846E,
    0x648B1EAF,     0x19BDF0CA,     0xA02369B9,     0x655ABB50,     0x40685A32,     0x3C2AB4B3,     0x319EE9D5,     0xC021B8F7,
    0x9B540B19,     0x875FA099,     0x95F7997E,     0x623D7DA8,     0xF837889A,     0x97E32D77,     0x11ED935F,     0x16681281,
    0x0E358829,     0xC7E61FD6,     0x96DEDFA1,     0x7858BA99,     0x57F584A5,     0x1B227263,     0x9B83C3FF,     0x1AC24696,
    0xCDB30AEB,     0x532E3054,     0x8FD948E4,     0x6DBC3128,     0x58EBF2EF,     0x34C6FFEA,     0xFE28ED61,     0xEE7C3C73,
    0x5D4A14D9,     0xE864B7E3,     0x42105D14,     0x203E13E0,     0x45EEE2B6,     0xA3AAABEA,     0xDB6C4F15,     0xFACB4FD0,
    0xC742F442,     0xEF6ABBB5,     0x654F3B1D,     0x41CD2105,     0xD81E799E,     0x86854DC7,     0xE44B476A,     0x3D816250,
    0xCF62A1F2,     0x5B8D2646,     0xFC8883A0,     0xC1C7B6A3,     0x7F1524C3,     0x69CB7492,     0x47848A0B,     0x5692B285,
    0x095BBF00,     0xAD19489D,     0x1462B174,     0x23820E00,     0x58428D2A,     0x0C55F5EA,     0x1DADF43E,     0x233F7061,
    0x3372F092,     0x8D937E41,     0xD65FECF1,     0x6C223BDB,     0x7CDE3759,     0xCBEE7460,     0x4085F2A7,     0xCE77326E,
    0xA6078084,     0x19F8509E,     0xE8EFD855,     0x61D99735,     0xA969A7AA,     0xC50C06C2,     0x5A04ABFC,     0x800BCADC,
    0x9E447A2E,     0xC3453484,     0xFDD56705,     0x0E1E9EC9,     0xDB73DBD3,     0x105588CD,     0x675FDA79,     0xE3674340,
    0xC5C43465,     0x713E38D8,     0x3D28F89E,     0xF16DFF20,     0x153E21E7,     0x8FB03D4A,     0xE6E39F2B,     0xDB83ADF7
  ]),
  new Uint32Array([
    0xE93D5A68,     0x948140F7,     0xF64C261C,     0x94692934,     0x411520F7,     0x7602D4F7,     0xBCF46B2E,     0xD4A20068,
    0xD4082471,     0x3320F46A,     0x43B7D4B7,     0x500061AF,     0x1E39F62E,     0x97244546,     0x14214F74,     0xBF8B8840,
    0x4D95FC1D,     0x96B591AF,     0x70F4DDD3,     0x66A02F45,     0xBFBC09EC,     0x03BD9785,     0x7FAC6DD0,     0x31CB8504,
    0x96EB27B3,     0x55FD3941,     0xDA2547E6,     0xABCA0A9A,     0x28507825,     0x530429F4,     0x0A2C86DA,     0xE9B66DFB,
    0x68DC1462,     0xD7486900,     0x680EC0A4,     0x27A18DEE,     0x4F3FFEA2,     0xE887AD8C,     0xB58CE006,     0x7AF4D6B6,
    0xAACE1E7C,     0xD3375FEC,     0xCE78A399,     0x406B2A42,     0x20FE9E35,     0xD9F385B9,     0xEE39D7AB,     0x3B124E8B,
    0x1DC9FAF7,     0x4B6D1856,     0x26A36631,     0xEAE397B2,     0x3A6EFA74,     0xDD5B4332,     0x6841E7F7,     0xCA7820FB,
    0xFB0AF54E,     0xD8FEB397,     0x454056AC,     0xBA489527,     0x55533A3A,     0x20838D87,     0xFE6BA9B7,     0xD096954B,
    0x55A867BC,     0xA1159A58,     0xCCA92963,     0x99E1DB33,     0xA62A4A56,     0x3F3125F9,     0x5EF47E1C,     0x9029317C,
    0xFDF8E802,     0x04272F70,     0x80BB155C,     0x05282CE3,     0x95C11548,     0xE4C66D22,     0x48C1133F,     0xC70F86DC,
    0x07F9C9EE,     0x41041F0F,     0x404779A4,     0x5D886E17,     0x325F51EB,     0xD59BC0D1,     0xF2BCC18F,     0x41113564,
    0x257B7834,     0x602A9C60,     0xDFF8E8A3,     0x1F636C1B,     0x0E12B4C2,     0x02E1329E,     0xAF664FD1,     0xCAD18115,
    0x6B2395E0,     0x333E92E1,     0x3B240B62,     0xEEBEB922,     0x85B2A20E,     0xE6BA0D99,     0xDE720C8C,     0x2DA2F728,
    0xD0127845,     0x95B794FD,     0x647D0862,     0xE7CCF5F0,     0x5449A36F,     0x877D48FA,     0xC39DFD27,     0xF33E8D1E,
    0x0A476341,     0x992EFF74,     0x3A6F6EAB,     0xF4F8FD37,     0xA812DC60,     0xA1EBDDF8,     0x991BE14C,     0xDB6E6B0D,
    0xC67B5510,     0x6D672C37,     0x2765D43B,     0xDCD0E804,     0xF1290DC7,     0xCC00FFA3,     0xB5390F92,     0x690FED0B,
    0x667B9FFB,     0xCEDB7D9C,     0xA091CF0B,     0xD9155EA3,     0xBB132F88,     0x515BAD24,     0x7B9479BF,     0x763BD6EB,
    0x37392EB3,     0xCC115979,     0x8026E297,     0xF42E312D,     0x6842ADA7,     0xC66A2B3B,     0x12754CCC,     0x782EF11C,
    0x6A124237,     0xB79251E7,     0x06A1BBE6,     0x4BFB6350,     0x1A6B1018,     0x11CAEDFA,     0x3D25BDD8,     0xE2E1C3C9,
    0x44421659,     0x0A121386,     0xD90CEC6E,     0xD5ABEA2A,     0x64AF674E,     0xDA86A85F,     0xBEBFE988,     0x64E4C3FE,
    0x9DBC8057,     0xF0F7C086,     0x60787BF8,     0x6003604D,     0xD1FD8346,     0xF6381FB0,     0x7745AE04,     0xD736FCCC,
    0x83426B33,     0xF01EAB71,     0xB0804187,     0x3C005E5F,     0x77A057BE,     0xBDE8AE24,     0x55464299,     0xBF582E61,
    0x4E58F48F,     0xF2DDFDA2,     0xF474EF38,     0x8789BDC2,     0x5366F9C3,     0xC8B38E74,     0xB475F255,     0x46FCD9B9,
    0x7AEB2661,     0x8B1DDF84,     0x846A0E79,     0x915F95E2,     0x466E598E,     0x20B45770,     0x8CD55591,     0xC902DE4C,
    0xB90BACE1,     0xBB8205D0,     0x11A86248,     0x7574A99E,     0xB77F19B6,     0xE0A9DC09,     0x662D09A1,     0xC4324633,
    0xE85A1F02,     0x09F0BE8C,     0x4A99A025,     0x1D6EFE10,     0x1AB93D1D,     0x0BA5A4DF,     0xA186F20F,     0x2868F169,
    0xDCB7DA83,     0x573906FE,     0xA1E2CE9B,     0x4FCD7F52,     0x50115E01,     0xA70683FA,     0xA002B5C4,     0x0DE6D027,
    0x9AF88C27,     0x773F8641,     0xC3604C06,     0x61A806B5,     0xF0177A28,     0xC0F586E0,     0x006058AA,     0x30DC7D62,
    0x11E69ED7,     0x2338EA63,     0x53C2DD94,     0xC2C21634,     0xBBCBEE56,     0x90BCB6DE,     0xEBFC7DA1,     0xCE591D76,
    0x6F05E409,     0x4B7C0188,     0x39720A3D,     0x7C927C24,     0x86E3725F,     0x724D9DB9,     0x1AC15BB4,     0xD39EB8FC,
    0xED545578,     0x08FCA5B5,     0xD83D7CD3,     0x4DAD0FC4,     0x1E50EF5E,     0xB161E6F8,     0xA28514D9,     0x6C51133C,
    0x6FD5C7E7,     0x56E14EC4,     0x362ABFCE,     0xDDC6C837,     0xD79A3234,     0x92638212,     0x670EFA8E,     0x406000E0
  ]),
  new Uint32Array([
    0x3A39CE37,     0xD3FAF5CF,     0xABC27737,     0x5AC52D1B,     0x5CB0679E,     0x4FA33742,     0xD3822740,     0x99BC9BBE,
    0xD5118E9D,     0xBF0F7315,     0xD62D1C7E,     0xC700C47B,     0xB78C1B6B,     0x21A19045,     0xB26EB1BE,     0x6A366EB4,
    0x5748AB2F,     0xBC946E79,     0xC6A376D2,     0x6549C2C8,     0x530FF8EE,     0x468DDE7D,     0xD5730A1D,     0x4CD04DC6,
    0x2939BBDB,     0xA9BA4650,     0xAC9526E8,     0xBE5EE304,     0xA1FAD5F0,     0x6A2D519A,     0x63EF8CE2,     0x9A86EE22,
    0xC089C2B8,     0x43242EF6,     0xA51E03AA,     0x9CF2D0A4,     0x83C061BA,     0x9BE96A4D,     0x8FE51550,     0xBA645BD6,
    0x2826A2F9,     0xA73A3AE1,     0x4BA99586,     0xEF5562E9,     0xC72FEFD3,     0xF752F7DA,     0x3F046F69,     0x77FA0A59,
    0x80E4A915,     0x87B08601,     0x9B09E6AD,     0x3B3EE593,     0xE990FD5A,     0x9E34D797,     0x2CF0B7D9,     0x022B8B51,
    0x96D5AC3A,     0x017DA67D,     0xD1CF3ED6,     0x7C7D2D28,     0x1F9F25CF,     0xADF2B89B,     0x5AD6B472,     0x5A88F54C,
    0xE029AC71,     0xE019A5E6,     0x47B0ACFD,     0xED93FA9B,     0xE8D3C48D,     0x283B57CC,     0xF8D56629,     0x79132E28,
    0x785F0191,     0xED756055,     0xF7960E44,     0xE3D35E8C,     0x15056DD4,     0x88F46DBA,     0x03A16125,     0x0564F0BD,
    0xC3EB9E15,     0x3C9057A2,     0x97271AEC,     0xA93A072A,     0x1B3F6D9B,     0x1E6321F5,     0xF59C66FB,     0x26DCF319,
    0x7533D928,     0xB155FDF5,     0x03563482,     0x8ABA3CBB,     0x28517711,     0xC20AD9F8,     0xABCC5167,     0xCCAD925F,
    0x4DE81751,     0x3830DC8E,     0x379D5862,     0x9320F991,     0xEA7A90C2,     0xFB3E7BCE,     0x5121CE64,     0x774FBE32,
    0xA8B6E37E,     0xC3293D46,     0x48DE5369,     0x6413E680,     0xA2AE0810,     0xDD6DB224,     0x69852DFD,     0x09072166,
    0xB39A460A,     0x6445C0DD,     0x586CDECF,     0x1C20C8AE,     0x5BBEF7DD,     0x1B588D40,     0xCCD2017F,     0x6BB4E3BB,
    0xDDA26A7E,     0x3A59FF45,     0x3E350A44,     0xBCB4CDD5,     0x72EACEA8,     0xFA6484BB,     0x8D6612AE,     0xBF3C6F47,
    0xD29BE463,     0x542F5D9E,     0xAEC2771B,     0xF64E6370,     0x740E0D8D,     0xE75B1357,     0xF8721671,     0xAF537D5D,
    0x4040CB08,     0x4EB4E2CC,     0x34D2466A,     0x0115AF84,     0xE1B00428,     0x95983A1D,     0x06B89FB4,     0xCE6EA048,
    0x6F3F3B82,     0x3520AB82,     0x011A1D4B,     0x277227F8,     0x611560B1,     0xE7933FDC,     0xBB3A792B,     0x344525BD,
    0xA08839E1,     0x51CE794B,     0x2F32C9B7,     0xA01FBAC9,     0xE01CC87E,     0xBCC7D1F6,     0xCF0111C3,     0xA1E8AAC7,
    0x1A908749,     0xD44FBD9A,     0xD0DADECB,     0xD50ADA38,     0x0339C32A,     0xC6913667,     0x8DF9317C,     0xE0B12B4F,
    0xF79E59B7,     0x43F5BB3A,     0xF2D519FF,     0x27D9459C,     0xBF97222C,     0x15E6FC2A,     0x0F91FC71,     0x9B941525,
    0xFAE59361,     0xCEB69CEB,     0xC2A86459,     0x12BAA8D1,     0xB6C1075E,     0xE3056A0C,     0x10D25065,     0xCB03A442,
    0xE0EC6E0E,     0x1698DB3B,     0x4C98A0BE,     0x3278E964,     0x9F1F9532,     0xE0D392DF,     0xD3A0342B,     0x8971F21E,
    0x1B0A7441,     0x4BA3348C,     0xC5BE7120,     0xC37632D8,     0xDF359F8D,     0x9B992F2E,     0xE60B6F47,     0x0FE3F11D,
    0xE54CDA54,     0x1EDAD891,     0xCE6279CF,     0xCD3E7E6F,     0x1618B166,     0xFD2C1D05,     0x848FD2C5,     0xF6FB2299,
    0xF523F357,     0xA6327623,     0x93A83531,     0x56CCCD02,     0xACF08162,     0x5A75EBB5,     0x6E163697,     0x88D273CC,
    0xDE966292,     0x81B949D0,     0x4C50901B,     0x71C65614,     0xE6C6C7BD,     0x327A140A,     0x45E1D006,     0xC3F27B9A,
    0xC9AA53FD,     0x62A80F00,     0xBB25BFE2,     0x35BDD2F6,     0x71126905,     0xB2040222,     0xB6CBCF7C,     0xCD769C2B,
    0x53113EC0,     0x1640E3D3,     0x38ABBD60,     0x2547ADF0,     0xBA38209C,     0xF746CE76,     0x77AFA1C5,     0x20756060,
    0x85CBFE4E,     0x8AE88DD8,     0x7AAAF9B0,     0x4CF9AA7E,     0x1948C25C,     0x02FB8A8C,     0x01C36AE4,     0xD6EBE1F9,
    0x90D4F869,     0xA65CDEA0,     0x3F09252D,     0xC208E69F,     0xB74E6132,     0xCE77E25B,     0x578FDFE3,     0x3AC372E6
  ])
];


// Blowfish 上下文：P-array + S-boxes（密钥扩展后的）
function blowfishKeySchedule(key) {
 // key: Uint8Array(4..56)
  const P = new Uint32Array(BF_P_INIT);
  const S = [new Uint32Array(BF_S_INIT[0]), new Uint32Array(BF_S_INIT[1]),
             new Uint32Array(BF_S_INIT[2]), new Uint32Array(BF_S_INIT[3])];

 // XOR key into P-array（字节级循环）
  let k = 0;
  for (let i = 0; i < 18; i++) {
    let data = 0;
    for (let j = 0; j < 4; j++) {
      data = ((data << 8) | key[k % key.length]) >>> 0;
      k++;
    }
    P[i] = (P[i] ^ data) >>> 0;
  }

 // 用全零块加密，输出依次填入 P 和 S
  let L = 0, R = 0;
  function encLR() {
    for (let i = 0; i < 16; i++) {
      L = (L ^ P[i]) >>> 0;
      const f = ((S[0][(L >>> 24) & 0xFF] + S[1][(L >>> 16) & 0xFF]) >>> 0) ^ S[2][(L >>> 8) & 0xFF];
      R = (R ^ ((f + S[3][L & 0xFF]) >>> 0)) >>> 0;
      const tmp = L; L = R; R = tmp;
    }
    const tmp = L; L = R; R = tmp; // undo last swap
    L = (L ^ P[17]) >>> 0;
    R = (R ^ P[16]) >>> 0;
  }

 // 填充 P
  for (let i = 0; i < 18; i += 2) {
    encLR();
    P[i] = L;
    P[i + 1] = R;
  }
 // 填充 S
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 256; i += 2) {
      encLR();
      S[s][i] = L;
      S[s][i + 1] = R;
    }
  }

  return { P, S };
}

function blowfishEncryptBlock(block, ctx) {
  const { P, S } = ctx;
  let L = ((block[0] << 24) | (block[1] << 16) | (block[2] << 8) | block[3]) >>> 0;
  let R = ((block[4] << 24) | (block[5] << 16) | (block[6] << 8) | block[7]) >>> 0;
  for (let i = 0; i < 16; i++) {
    L = (L ^ P[i]) >>> 0;
    const f = ((S[0][(L >>> 24) & 0xFF] + S[1][(L >>> 16) & 0xFF]) >>> 0) ^ S[2][(L >>> 8) & 0xFF];
    R = (R ^ ((f + S[3][L & 0xFF]) >>> 0)) >>> 0;
    const tmp = L; L = R; R = tmp;
  }
  const tmp = L; L = R; R = tmp; // undo last swap
  L = (L ^ P[17]) >>> 0;
  R = (R ^ P[16]) >>> 0;
  const out = new Uint8Array(8);
  out[0] = (L >>> 24) & 0xff; out[1] = (L >>> 16) & 0xff; out[2] = (L >>> 8) & 0xff; out[3] = L & 0xff;
  out[4] = (R >>> 24) & 0xff; out[5] = (R >>> 16) & 0xff; out[6] = (R >>> 8) & 0xff; out[7] = R & 0xff;
  return out;
}

function blowfishDecryptBlock(block, ctx) {
  const { P, S } = ctx;
  let L = ((block[0] << 24) | (block[1] << 16) | (block[2] << 8) | block[3]) >>> 0;
  let R = ((block[4] << 24) | (block[5] << 16) | (block[6] << 8) | block[7]) >>> 0;
  for (let i = 17; i >= 2; i--) {
    L = (L ^ P[i]) >>> 0;
    const f = ((S[0][(L >>> 24) & 0xFF] + S[1][(L >>> 16) & 0xFF]) >>> 0) ^ S[2][(L >>> 8) & 0xFF];
    R = (R ^ ((f + S[3][L & 0xFF]) >>> 0)) >>> 0;
    const tmp = L; L = R; R = tmp;
  }
  const tmp = L; L = R; R = tmp; // undo last swap
  L = (L ^ P[0]) >>> 0;
  R = (R ^ P[1]) >>> 0;
  const out = new Uint8Array(8);
  out[0] = (L >>> 24) & 0xff; out[1] = (L >>> 16) & 0xff; out[2] = (L >>> 8) & 0xff; out[3] = L & 0xff;
  out[4] = (R >>> 24) & 0xff; out[5] = (R >>> 16) & 0xff; out[6] = (R >>> 8) & 0xff; out[7] = R & 0xff;
  return out;
}

export function blowfishEncrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  if (key.length < 4 || key.length > 56) throw new Error("Blowfish 密钥长度需 4-56 字节");
  const ctx = blowfishKeySchedule(key);
  const enc = (blk) => blowfishEncryptBlock(blk, ctx);
  if (mode === "ECB") return ecbEncrypt(data, enc, 8);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcEncrypt(data, enc, 8, iv);
  }
  throw new Error(`Blowfish 不支持模式: ${mode}`);
}

export function blowfishDecrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  if (key.length < 4 || key.length > 56) throw new Error("Blowfish 密钥长度需 4-56 字节");
  const ctx = blowfishKeySchedule(key);
  const dec = (blk) => blowfishDecryptBlock(blk, ctx);
  if (mode === "ECB") return ecbDecrypt(data, dec, 8);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcDecrypt(data, dec, 8, iv);
  }
  throw new Error(`Blowfish 不支持模式: ${mode}`);
}

// ============================================================
// RC6-32/20/16（RFC 2276）
// 128 位块，20 轮，可变密钥（1-255 字节，默认 16）
// 常数同 RC5：P32=0xB7E15163, Q32=0x9E3779B9；子密钥数 2r+4=44
// 关键运算：f(x)=x·(2x+1) mod 2^32（用 Math.imul 实现 32×32→32）
// ============================================================
const RC6_ROUNDS = 20;
const RC6_BLOCK_SIZE = 16;
const RC6_T = 2 * RC6_ROUNDS + 4; // 44 个子密钥

function rc6KeySchedule(key) {
  const u = 4;
  const b = key.length;
  if (b < 1 || b > 255) throw new Error("RC6 密钥长度需 1-255 字节");
  const c = Math.max(1, Math.ceil(b / u));
  const L = new Uint32Array(c);
  for (let i = b - 1; i >= 0; i--) {
    L[(i / u) | 0] = ((L[(i / u) | 0] << 8) + key[i]) >>> 0;
  }
  const S = new Uint32Array(RC6_T);
  S[0] = RC5_P32;
  for (let i = 1; i < RC6_T; i++) {
    S[i] = (S[i - 1] + RC5_Q32) >>> 0;
  }
  let A = 0, B = 0;
  let i = 0, j = 0;
  const n = 3 * Math.max(RC6_T, c);
  for (let k = 0; k < n; k++) {
    A = S[i] = rotl32((S[i] + A + B) >>> 0, 3);
    B = L[j] = rotl32((L[j] + A + B) >>> 0, (A + B) & 31);
    i = (i + 1) % RC6_T;
    j = (j + 1) % c;
  }
  return S;
}

// 32×32→32 乘法（取低 32 位，mod 2^32）
function mul32(a, b) { return Math.imul(a >>> 0, b >>> 0) >>> 0; }
// f(x) = x·(2x+1) mod 2^32，然后循环左移 lg(w)=5 位
function rc6F(x) {
  return rotl32(mul32(x, (((x << 1) | 1) >>> 0)), 5);
}

function rc6EncryptBlock(block, S) {
 // block: Uint8Array(16)，4 个小端 32 位字 A,B,C,D
  let A = readU32LE(block, 0);
  let B = readU32LE(block, 4);
  let C = readU32LE(block, 8);
  let D = readU32LE(block, 12);
  B = (B + S[0]) >>> 0;
  D = (D + S[1]) >>> 0;
  for (let r = 1; r <= RC6_ROUNDS; r++) {
    const t = rc6F(B);
    const u = rc6F(D);
    A = (rotl32((A ^ t) >>> 0, u) + S[2 * r]) >>> 0;
    C = (rotl32((C ^ u) >>> 0, t) + S[2 * r + 1]) >>> 0;
 // (A,B,C,D) = (B,C,D,A) 循环左移
    const tmp = A; A = B; B = C; C = D; D = tmp;
  }
  A = (A + S[2 * RC6_ROUNDS + 2]) >>> 0;
  C = (C + S[2 * RC6_ROUNDS + 3]) >>> 0;
  const out = new Uint8Array(16);
  writeU32LE(out, 0, A);
  writeU32LE(out, 4, B);
  writeU32LE(out, 8, C);
  writeU32LE(out, 12, D);
  return out;
}

function rc6DecryptBlock(block, S) {
  let A = readU32LE(block, 0);
  let B = readU32LE(block, 4);
  let C = readU32LE(block, 8);
  let D = readU32LE(block, 12);
  C = (C - S[2 * RC6_ROUNDS + 3]) >>> 0;
  A = (A - S[2 * RC6_ROUNDS + 2]) >>> 0;
  for (let r = RC6_ROUNDS; r >= 1; r--) {
 // (A,B,C,D) = (D,A,B,C) 循环右移（逆操作）
    const tmp = D; D = C; C = B; B = A; A = tmp;
    const u = rc6F(D);
    const t = rc6F(B);
    C = (rotr32((C - S[2 * r + 1]) >>> 0, t) ^ u) >>> 0;
    A = (rotr32((A - S[2 * r]) >>> 0, u) ^ t) >>> 0;
  }
  D = (D - S[1]) >>> 0;
  B = (B - S[0]) >>> 0;
  const out = new Uint8Array(16);
  writeU32LE(out, 0, A);
  writeU32LE(out, 4, B);
  writeU32LE(out, 8, C);
  writeU32LE(out, 12, D);
  return out;
}

export function rc6Encrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  const ctx = rc6KeySchedule(key);
  const enc = (blk) => rc6EncryptBlock(blk, ctx);
  if (mode === "ECB") return ecbEncrypt(data, enc, RC6_BLOCK_SIZE);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcEncrypt(data, enc, RC6_BLOCK_SIZE, iv);
  }
  throw new Error(`RC6 不支持模式: ${mode}`);
}

export function rc6Decrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  const ctx = rc6KeySchedule(key);
  const dec = (blk) => rc6DecryptBlock(blk, ctx);
  if (mode === "ECB") return ecbDecrypt(data, dec, RC6_BLOCK_SIZE);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcDecrypt(data, dec, RC6_BLOCK_SIZE, iv);
  }
  throw new Error(`RC6 不支持模式: ${mode}`);
}


// ============================================================
// CAST-128（RFC 2144，CAST5）
// 64 位块，key≤80位(≤10字节)用12轮，>80位用16轮；密钥 5-16 字节（不足16补0）
// 8 个 8x32 S-box（S1-S4 轮函数，S5-S8 key schedule）；大端字节序
// S-box 数据照抄 RFC 2144 Appendix A 不许改（红线）；轮函数/key schedule 照抄 RFC 2.2/2.4
// ============================================================
const S1 = new Uint32Array([
  0x30fb40d4,0x9fa0ff0b,0x6beccd2f,0x3f258c7a,0x1e213f2f,0x9c004dd3,0x6003e540,0xcf9fc949,
  0xbfd4af27,0x88bbbdb5,0xe2034090,0x98d09675,0x6e63a0e0,0x15c361d2,0xc2e7661d,0x22d4ff8e,
  0x28683b6f,0xc07fd059,0xff2379c8,0x775f50e2,0x43c340d3,0xdf2f8656,0x887ca41a,0xa2d2bd2d,
  0xa1c9e0d6,0x346c4819,0x61b76d87,0x22540f2f,0x2abe32e1,0xaa54166b,0x22568e3a,0xa2d341d0,
  0x66db40c8,0xa784392f,0x004dff2f,0x2db9d2de,0x97943fac,0x4a97c1d8,0x527644b7,0xb5f437a7,
  0xb82cbaef,0xd751d159,0x6ff7f0ed,0x5a097a1f,0x827b68d0,0x90ecf52e,0x22b0c054,0xbc8e5935,
  0x4b6d2f7f,0x50bb64a2,0xd2664910,0xbee5812d,0xb7332290,0xe93b159f,0xb48ee411,0x4bff345d,
  0xfd45c240,0xad31973f,0xc4f6d02e,0x55fc8165,0xd5b1caad,0xa1ac2dae,0xa2d4b76d,0xc19b0c50,
  0x882240f2,0x0c6e4f38,0xa4e4bfd7,0x4f5ba272,0x564c1d2f,0xc59c5319,0xb949e354,0xb04669fe,
  0xb1b6ab8a,0xc71358dd,0x6385c545,0x110f935d,0x57538ad5,0x6a390493,0xe63d37e0,0x2a54f6b3,
  0x3a787d5f,0x6276a0b5,0x19a6fcdf,0x7a42206a,0x29f9d4d5,0xf61b1891,0xbb72275e,0xaa508167,
  0x38901091,0xc6b505eb,0x84c7cb8c,0x2ad75a0f,0x874a1427,0xa2d1936b,0x2ad286af,0xaa56d291,
  0xd7894360,0x425c750d,0x93b39e26,0x187184c9,0x6c00b32d,0x73e2bb14,0xa0bebc3c,0x54623779,
  0x64459eab,0x3f328b82,0x7718cf82,0x59a2cea6,0x04ee002e,0x89fe78e6,0x3fab0950,0x325ff6c2,
  0x81383f05,0x6963c5c8,0x76cb5ad6,0xd49974c9,0xca180dcf,0x380782d5,0xc7fa5cf6,0x8ac31511,
  0x35e79e13,0x47da91d0,0xf40f9086,0xa7e2419e,0x31366241,0x051ef495,0xaa573b04,0x4a805d8d,
  0x548300d0,0x00322a3c,0xbf64cddf,0xba57a68e,0x75c6372b,0x50afd341,0xa7c13275,0x915a0bf5,
  0x6b54bfab,0x2b0b1426,0xab4cc9d7,0x449ccd82,0xf7fbf265,0xab85c5f3,0x1b55db94,0xaad4e324,
  0xcfa4bd3f,0x2deaa3e2,0x9e204d02,0xc8bd25ac,0xeadf55b3,0xd5bd9e98,0xe31231b2,0x2ad5ad6c,
  0x954329de,0xadbe4528,0xd8710f69,0xaa51c90f,0xaa786bf6,0x22513f1e,0xaa51a79b,0x2ad344cc,
  0x7b5a41f0,0xd37cfbad,0x1b069505,0x41ece491,0xb4c332e6,0x032268d4,0xc9600acc,0xce387e6d,
  0xbf6bb16c,0x6a70fb78,0x0d03d9c9,0xd4df39de,0xe01063da,0x4736f464,0x5ad328d8,0xb347cc96,
  0x75bb0fc3,0x98511bfb,0x4ffbcc35,0xb58bcf6a,0xe11f0abc,0xbfc5fe4a,0xa70aec10,0xac39570a,
  0x3f04442f,0x6188b153,0xe0397a2e,0x5727cb79,0x9ceb418f,0x1cacd68d,0x2ad37c96,0x0175cb9d,
  0xc69dff09,0xc75b65f0,0xd9db40d8,0xec0e7779,0x4744ead4,0xb11c3274,0xdd24cb9e,0x7e1c54bd,
  0xf01144f9,0xd2240eb1,0x9675b3fd,0xa3ac3755,0xd47c27af,0x51c85f4d,0x56907596,0xa5bb15e6,
  0x580304f0,0xca042cf1,0x011a37ea,0x8dbfaadb,0x35ba3e4a,0x3526ffa0,0xc37b4d09,0xbc306ed9,
  0x98a52666,0x5648f725,0xff5e569d,0x0ced63d0,0x7c63b2cf,0x700b45e1,0xd5ea50f1,0x85a92872,
  0xaf1fbda7,0xd4234870,0xa7870bf3,0x2d3b4d79,0x42e04198,0x0cd0ede7,0x26470db8,0xf881814c,
  0x474d6ad7,0x7c0c5e5c,0xd1231959,0x381b7298,0xf5d2f4db,0xab838653,0x6e2f1e23,0x83719c9e,
  0xbd91e046,0x9a56456e,0xdc39200c,0x20c8c571,0x962bda1c,0xe1e696ff,0xb141ab08,0x7cca89b9,
  0x1a69e783,0x02cc4843,0xa2f7c579,0x429ef47d,0x427b169c,0x5ac9f049,0xdd8f0f00,0x5c8165bf
]);

const S2 = new Uint32Array([
  0x1f201094,0xef0ba75b,0x69e3cf7e,0x393f4380,0xfe61cf7a,0xeec5207a,0x55889c94,0x72fc0651,
  0xada7ef79,0x4e1d7235,0xd55a63ce,0xde0436ba,0x99c430ef,0x5f0c0794,0x18dcdb7d,0xa1d6eff3,
  0xa0b52f7b,0x59e83605,0xee15b094,0xe9ffd909,0xdc440086,0xef944459,0xba83ccb3,0xe0c3cdfb,
  0xd1da4181,0x3b092ab1,0xf997f1c1,0xa5e6cf7b,0x01420ddb,0xe4e7ef5b,0x25a1ff41,0xe180f806,
  0x1fc41080,0x179bee7a,0xd37ac6a9,0xfe5830a4,0x98de8b7f,0x77e83f4e,0x79929269,0x24fa9f7b,
  0xe113c85b,0xacc40083,0xd7503525,0xf7ea615f,0x62143154,0x0d554b63,0x5d681121,0xc866c359,
  0x3d63cf73,0xcee234c0,0xd4d87e87,0x5c672b21,0x071f6181,0x39f7627f,0x361e3084,0xe4eb573b,
  0x602f64a4,0xd63acd9c,0x1bbc4635,0x9e81032d,0x2701f50c,0x99847ab4,0xa0e3df79,0xba6cf38c,
  0x10843094,0x2537a95e,0xf46f6ffe,0xa1ff3b1f,0x208cfb6a,0x8f458c74,0xd9e0a227,0x4ec73a34,
  0xfc884f69,0x3e4de8df,0xef0e0088,0x3559648d,0x8a45388c,0x1d804366,0x721d9bfd,0xa58684bb,
  0xe8256333,0x844e8212,0x128d8098,0xfed33fb4,0xce280ae1,0x27e19ba5,0xd5a6c252,0xe49754bd,
  0xc5d655dd,0xeb667064,0x77840b4d,0xa1b6a801,0x84db26a9,0xe0b56714,0x21f043b7,0xe5d05860,
  0x54f03084,0x066ff472,0xa31aa153,0xdadc4755,0xb5625dbf,0x68561be6,0x83ca6b94,0x2d6ed23b,
  0xeccf01db,0xa6d3d0ba,0xb6803d5c,0xaf77a709,0x33b4a34c,0x397bc8d6,0x5ee22b95,0x5f0e5304,
  0x81ed6f61,0x20e74364,0xb45e1378,0xde18639b,0x881ca122,0xb96726d1,0x8049a7e8,0x22b7da7b,
  0x5e552d25,0x5272d237,0x79d2951c,0xc60d894c,0x488cb402,0x1ba4fe5b,0xa4b09f6b,0x1ca815cf,
  0xa20c3005,0x8871df63,0xb9de2fcb,0x0cc6c9e9,0x0beeff53,0xe3214517,0xb4542835,0x9f63293c,
  0xee41e729,0x6e1d2d7c,0x50045286,0x1e6685f3,0xf33401c6,0x30a22c95,0x31a70850,0x60930f13,
  0x73f98417,0xa1269859,0xec645c44,0x52c877a9,0xcdff33a6,0xa02b1741,0x7cbad9a2,0x2180036f,
  0x50d99c08,0xcb3f4861,0xc26bd765,0x64a3f6ab,0x80342676,0x25a75e7b,0xe4e6d1fc,0x20c710e6,
  0xcdf0b680,0x17844d3b,0x31eef84d,0x7e0824e4,0x2ccb49eb,0x846a3bae,0x8ff77888,0xee5d60f6,
  0x7af75673,0x2fdd5cdb,0xa11631c1,0x30f66f43,0xb3faec54,0x157fd7fa,0xef8579cc,0xd152de58,
  0xdb2ffd5e,0x8f32ce19,0x306af97a,0x02f03ef8,0x99319ad5,0xc242fa0f,0xa7e3ebb0,0xc68e4906,
  0xb8da230c,0x80823028,0xdcdef3c8,0xd35fb171,0x088a1bc8,0xbec0c560,0x61a3c9e8,0xbca8f54d,
  0xc72feffa,0x22822e99,0x82c570b4,0xd8d94e89,0x8b1c34bc,0x301e16e6,0x273be979,0xb0ffeaa6,
  0x61d9b8c6,0x00b24869,0xb7ffce3f,0x08dc283b,0x43daf65a,0xf7e19798,0x7619b72f,0x8f1c9ba4,
  0xdc8637a0,0x16a7d3b1,0x9fc393b7,0xa7136eeb,0xc6bcc63e,0x1a513742,0xef6828bc,0x520365d6,
  0x2d6a77ab,0x3527ed4b,0x821fd216,0x095c6e2e,0xdb92f2fb,0x5eea29cb,0x145892f5,0x91584f7f,
  0x5483697b,0x2667a8cc,0x85196048,0x8c4bacea,0x833860d4,0x0d23e0f9,0x6c387e8a,0x0ae6d249,
  0xb284600c,0xd835731d,0xdcb1c647,0xac4c56ea,0x3ebd81b3,0x230eabb0,0x6438bc87,0xf0b5b1fa,
  0x8f5ea2b3,0xfc184642,0x0a036b7a,0x4fb089bd,0x649da589,0xa345415e,0x5c038323,0x3e5d3bb9,
  0x43d79572,0x7e6dd07c,0x06dfdf1e,0x6c6cc4ef,0x7160a539,0x73bfbe70,0x83877605,0x4523ecf1
]);

const S3 = new Uint32Array([
  0x8defc240,0x25fa5d9f,0xeb903dbf,0xe810c907,0x47607fff,0x369fe44b,0x8c1fc644,0xaececa90,
  0xbeb1f9bf,0xeefbcaea,0xe8cf1950,0x51df07ae,0x920e8806,0xf0ad0548,0xe13c8d83,0x927010d5,
  0x11107d9f,0x07647db9,0xb2e3e4d4,0x3d4f285e,0xb9afa820,0xfade82e0,0xa067268b,0x8272792e,
  0x553fb2c0,0x489ae22b,0xd4ef9794,0x125e3fbc,0x21fffcee,0x825b1bfd,0x9255c5ed,0x1257a240,
  0x4e1a8302,0xbae07fff,0x528246e7,0x8e57140e,0x3373f7bf,0x8c9f8188,0xa6fc4ee8,0xc982b5a5,
  0xa8c01db7,0x579fc264,0x67094f31,0xf2bd3f5f,0x40fff7c1,0x1fb78dfc,0x8e6bd2c1,0x437be59b,
  0x99b03dbf,0xb5dbc64b,0x638dc0e6,0x55819d99,0xa197c81c,0x4a012d6e,0xc5884a28,0xccc36f71,
  0xb843c213,0x6c0743f1,0x8309893c,0x0feddd5f,0x2f7fe850,0xd7c07f7e,0x02507fbf,0x5afb9a04,
  0xa747d2d0,0x1651192e,0xaf70bf3e,0x58c31380,0x5f98302e,0x727cc3c4,0x0a0fb402,0x0f7fef82,
  0x8c96fdad,0x5d2c2aae,0x8ee99a49,0x50da88b8,0x8427f4a0,0x1eac5790,0x796fb449,0x8252dc15,
  0xefbd7d9b,0xa672597d,0xada840d8,0x45f54504,0xfa5d7403,0xe83ec305,0x4f91751a,0x925669c2,
  0x23efe941,0xa903f12e,0x60270df2,0x0276e4b6,0x94fd6574,0x927985b2,0x8276dbcb,0x02778176,
  0xf8af918d,0x4e48f79e,0x8f616ddf,0xe29d840e,0x842f7d83,0x340ce5c8,0x96bbb682,0x93b4b148,
  0xef303cab,0x984faf28,0x779faf9b,0x92dc560d,0x224d1e20,0x8437aa88,0x7d29dc96,0x2756d3dc,
  0x8b907cee,0xb51fd240,0xe7c07ce3,0xe566b4a1,0xc3e9615e,0x3cf8209d,0x6094d1e3,0xcd9ca341,
  0x5c76460e,0x00ea983b,0xd4d67881,0xfd47572c,0xf76cedd9,0xbda8229c,0x127dadaa,0x438a074e,
  0x1f97c090,0x081bdb8a,0x93a07ebe,0xb938ca15,0x97b03cff,0x3dc2c0f8,0x8d1ab2ec,0x64380e51,
  0x68cc7bfb,0xd90f2788,0x12490181,0x5de5ffd4,0xdd7ef86a,0x76a2e214,0xb9a40368,0x925d958f,
  0x4b39fffa,0xba39aee9,0xa4ffd30b,0xfaf7933b,0x6d498623,0x193cbcfa,0x27627545,0x825cf47a,
  0x61bd8ba0,0xd11e42d1,0xcead04f4,0x127ea392,0x10428db7,0x8272a972,0x9270c4a8,0x127de50b,
  0x285ba1c8,0x3c62f44f,0x35c0eaa5,0xe805d231,0x428929fb,0xb4fcdf82,0x4fb66a53,0x0e7dc15b,
  0x1f081fab,0x108618ae,0xfcfd086d,0xf9ff2889,0x694bcc11,0x236a5cae,0x12deca4d,0x2c3f8cc5,
  0xd2d02dfe,0xf8ef5896,0xe4cf52da,0x95155b67,0x494a488c,0xb9b6a80c,0x5c8f82bc,0x89d36b45,
  0x3a609437,0xec00c9a9,0x44715253,0x0a874b49,0xd773bc40,0x7c34671c,0x02717ef6,0x4feb5536,
  0xa2d02fff,0xd2bf60c4,0xd43f03c0,0x50b4ef6d,0x07478cd1,0x006e1888,0xa2e53f55,0xb9e6d4bc,
  0xa2048016,0x97573833,0xd7207d67,0xde0f8f3d,0x72f87b33,0xabcc4f33,0x7688c55d,0x7b00a6b0,
  0x947b0001,0x570075d2,0xf9bb88f8,0x8942019e,0x4264a5ff,0x856302e0,0x72dbd92b,0xee971b69,
  0x6ea22fde,0x5f08ae2b,0xaf7a616d,0xe5c98767,0xcf1febd2,0x61efc8c2,0xf1ac2571,0xcc8239c2,
  0x67214cb8,0xb1e583d1,0xb7dc3e62,0x7f10bdce,0xf90a5c38,0x0ff0443d,0x606e6dc6,0x60543a49,
  0x5727c148,0x2be98a1d,0x8ab41738,0x20e1be24,0xaf96da0f,0x68458425,0x99833be5,0x600d457d,
  0x282f9350,0x8334b362,0xd91d1120,0x2b6d8da0,0x642b1e31,0x9c305a00,0x52bce688,0x1b03588a,
  0xf7baefd5,0x4142ed9c,0xa4315c11,0x83323ec5,0xdfef4636,0xa133c501,0xe9d3531c,0xee353783
]);

const S4 = new Uint32Array([
  0x9db30420,0x1fb6e9de,0xa7be7bef,0xd273a298,0x4a4f7bdb,0x64ad8c57,0x85510443,0xfa020ed1,
  0x7e287aff,0xe60fb663,0x095f35a1,0x79ebf120,0xfd059d43,0x6497b7b1,0xf3641f63,0x241e4adf,
  0x28147f5f,0x4fa2b8cd,0xc9430040,0x0cc32220,0xfdd30b30,0xc0a5374f,0x1d2d00d9,0x24147b15,
  0xee4d111a,0x0fca5167,0x71ff904c,0x2d195ffe,0x1a05645f,0x0c13fefe,0x081b08ca,0x05170121,
  0x80530100,0xe83e5efe,0xac9af4f8,0x7fe72701,0xd2b8ee5f,0x06df4261,0xbb9e9b8a,0x7293ea25,
  0xce84ffdf,0xf5718801,0x3dd64b04,0xa26f263b,0x7ed48400,0x547eebe6,0x446d4ca0,0x6cf3d6f5,
  0x2649abdf,0xaea0c7f5,0x36338cc1,0x503f7e93,0xd3772061,0x11b638e1,0x72500e03,0xf80eb2bb,
  0xabe0502e,0xec8d77de,0x57971e81,0xe14f6746,0xc9335400,0x6920318f,0x081dbb99,0xffc304a5,
  0x4d351805,0x7f3d5ce3,0xa6c866c6,0x5d5bcca9,0xdaec6fea,0x9f926f91,0x9f46222f,0x3991467d,
  0xa5bf6d8e,0x1143c44f,0x43958302,0xd0214eeb,0x022083b8,0x3fb6180c,0x18f8931e,0x281658e6,
  0x26486e3e,0x8bd78a70,0x7477e4c1,0xb506e07c,0xf32d0a25,0x79098b02,0xe4eabb81,0x28123b23,
  0x69dead38,0x1574ca16,0xdf871b62,0x211c40b7,0xa51a9ef9,0x0014377b,0x041e8ac8,0x09114003,
  0xbd59e4d2,0xe3d156d5,0x4fe876d5,0x2f91a340,0x557be8de,0x00eae4a7,0x0ce5c2ec,0x4db4bba6,
  0xe756bdff,0xdd3369ac,0xec17b035,0x06572327,0x99afc8b0,0x56c8c391,0x6b65811c,0x5e146119,
  0x6e85cb75,0xbe07c002,0xc2325577,0x893ff4ec,0x5bbfc92d,0xd0ec3b25,0xb7801ab7,0x8d6d3b24,
  0x20c763ef,0xc366a5fc,0x9c382880,0x0ace3205,0xaac9548a,0xeca1d7c7,0x041afa32,0x1d16625a,
  0x6701902c,0x9b757a54,0x31d477f7,0x9126b031,0x36cc6fdb,0xc70b8b46,0xd9e66a48,0x56e55a79,
  0x026a4ceb,0x52437eff,0x2f8f76b4,0x0df980a5,0x8674cde3,0xedda04eb,0x17a9be04,0x2c18f4df,
  0xb7747f9d,0xab2af7b4,0xefc34d20,0x2e096b7c,0x1741a254,0xe5b6a035,0x213d42f6,0x2c1c7c26,
  0x61c2f50f,0x6552daf9,0xd2c231f8,0x25130f69,0xd8167fa2,0x0418f2c8,0x001a96a6,0x0d1526ab,
  0x63315c21,0x5e0a72ec,0x49bafefd,0x187908d9,0x8d0dbd86,0x311170a7,0x3e9b640c,0xcc3e10d7,
  0xd5cad3b6,0x0caec388,0xf73001e1,0x6c728aff,0x71eae2a1,0x1f9af36e,0xcfcbd12f,0xc1de8417,
  0xac07be6b,0xcb44a1d8,0x8b9b0f56,0x013988c3,0xb1c52fca,0xb4be31cd,0xd8782806,0x12a3a4e2,
  0x6f7de532,0x58fd7eb6,0xd01ee900,0x24adffc2,0xf4990fc5,0x9711aac5,0x001d7b95,0x82e5e7d2,
  0x109873f6,0x00613096,0xc32d9521,0xada121ff,0x29908415,0x7fbb977f,0xaf9eb3db,0x29c9ed2a,
  0x5ce2a465,0xa730f32c,0xd0aa3fe8,0x8a5cc091,0xd49e2ce7,0x0ce454a9,0xd60acd86,0x015f1919,
  0x77079103,0xdea03af6,0x78a8565e,0xdee356df,0x21f05cbe,0x8b75e387,0xb3c50651,0xb8a5c3ef,
  0xd8eeb6d2,0xe523be77,0xc2154529,0x2f69efdf,0xafe67afb,0xf470c4b2,0xf3e0eb5b,0xd6cc9876,
  0x39e4460c,0x1fda8538,0x1987832f,0xca007367,0xa99144f8,0x296b299e,0x492fc295,0x9266beab,
  0xb5676e69,0x9bd3ddda,0xdf7e052f,0xdb25701c,0x1b5e51ee,0xf65324e6,0x6afce36c,0x0316cc04,
  0x8644213e,0xb7dc59d0,0x7965291f,0xccd6fd43,0x41823979,0x932bcdf6,0xb657c34d,0x4edfd282,
  0x7ae5290c,0x3cb9536b,0x851e20fe,0x9833557e,0x13ecf0b0,0xd3ffb372,0x3f85c5c1,0x0aef7ed2
]);

const S5 = new Uint32Array([
  0x7ec90c04,0x2c6e74b9,0x9b0e66df,0xa6337911,0xb86a7fff,0x1dd358f5,0x44dd9d44,0x1731167f,
  0x08fbf1fa,0xe7f511cc,0xd2051b00,0x735aba00,0x2ab722d8,0x386381cb,0xacf6243a,0x69befd7a,
  0xe6a2e77f,0xf0c720cd,0xc4494816,0xccf5c180,0x38851640,0x15b0a848,0xe68b18cb,0x4caadeff,
  0x5f480a01,0x0412b2aa,0x259814fc,0x41d0efe2,0x4e40b48d,0x248eb6fb,0x8dba1cfe,0x41a99b02,
  0x1a550a04,0xba8f65cb,0x7251f4e7,0x95a51725,0xc106ecd7,0x97a5980a,0xc539b9aa,0x4d79fe6a,
  0xf2f3f763,0x68af8040,0xed0c9e56,0x11b4958b,0xe1eb5a88,0x8709e6b0,0xd7e07156,0x4e29fea7,
  0x6366e52d,0x02d1c000,0xc4ac8e05,0x9377f571,0x0c05372a,0x578535f2,0x2261be02,0xd642a0c9,
  0xdf13a280,0x74b55bd2,0x682199c0,0xd421e5ec,0x53fb3ce8,0xc8adedb3,0x28a87fc9,0x3d959981,
  0x5c1ff900,0xfe38d399,0x0c4eff0b,0x062407ea,0xaa2f4fb1,0x4fb96976,0x90c79505,0xb0a8a774,
  0xef55a1ff,0xe59ca2c2,0xa6b62d27,0xe66a4263,0xdf65001f,0x0ec50966,0xdfdd55bc,0x29de0655,
  0x911e739a,0x17af8975,0x32c7911c,0x89f89468,0x0d01e980,0x524755f4,0x03b63cc9,0x0cc844b2,
  0xbcf3f0aa,0x87ac36e9,0xe53a7426,0x01b3d82b,0x1a9e7449,0x64ee2d7e,0xcddbb1da,0x01c94910,
  0xb868bf80,0x0d26f3fd,0x9342ede7,0x04a5c284,0x636737b6,0x50f5b616,0xf24766e3,0x8eca36c1,
  0x136e05db,0xfef18391,0xfb887a37,0xd6e7f7d4,0xc7fb7dc9,0x3063fcdf,0xb6f589de,0xec2941da,
  0x26e46695,0xb7566419,0xf654efc5,0xd08d58b7,0x48925401,0xc1bacb7f,0xe5ff550f,0xb6083049,
  0x5bb5d0e8,0x87d72e5a,0xab6a6ee1,0x223a66ce,0xc62bf3cd,0x9e0885f9,0x68cb3e47,0x086c010f,
  0xa21de820,0xd18b69de,0xf3f65777,0xfa02c3f6,0x407edac3,0xcbb3d550,0x1793084d,0xb0d70eba,
  0x0ab378d5,0xd951fb0c,0xded7da56,0x4124bbe4,0x94ca0b56,0x0f5755d1,0xe0e1e56e,0x6184b5be,
  0x580a249f,0x94f74bc0,0xe327888e,0x9f7b5561,0xc3dc0280,0x05687715,0x646c6bd7,0x44904db3,
  0x66b4f0a3,0xc0f1648a,0x697ed5af,0x49e92ff6,0x309e374f,0x2cb6356a,0x85808573,0x4991f840,
  0x76f0ae02,0x083be84d,0x28421c9a,0x44489406,0x736e4cb8,0xc1092910,0x8bc95fc6,0x7d869cf4,
  0x134f616f,0x2e77118d,0xb31b2be1,0xaa90b472,0x3ca5d717,0x7d161bba,0x9cad9010,0xaf462ba2,
  0x9fe459d2,0x45d34559,0xd9f2da13,0xdbc65487,0xf3e4f94e,0x176d486f,0x097c13ea,0x631da5c7,
  0x445f7382,0x175683f4,0xcdc66a97,0x70be0288,0xb3cdcf72,0x6e5dd2f3,0x20936079,0x459b80a5,
  0xbe60e2db,0xa9c23101,0xeba5315c,0x224e42f2,0x1c5c1572,0xf6721b2c,0x1ad2fff3,0x8c25404e,
  0x324ed72f,0x4067b7fd,0x0523138e,0x5ca3bc78,0xdc0fd66e,0x75922283,0x784d6b17,0x58ebb16e,
  0x44094f85,0x3f481d87,0xfcfeae7b,0x77b5ff76,0x8c2302bf,0xaaf47556,0x5f46b02a,0x2b092801,
  0x3d38f5f7,0x0ca81f36,0x52af4a8a,0x66d5e7c0,0xdf3b0874,0x95055110,0x1b5ad7a8,0xf61ed5ad,
  0x6cf6e479,0x20758184,0xd0cefa65,0x88f7be58,0x4a046826,0x0ff6f8f3,0xa09c7f70,0x5346aba0,
  0x5ce96c28,0xe176eda3,0x6bac307f,0x376829d2,0x85360fa9,0x17e3fe2a,0x24b79767,0xf5a96b20,
  0xd6cd2595,0x68ff1ebf,0x7555442c,0xf19f06be,0xf9e0659a,0xeeb9491d,0x34010718,0xbb30cab8,
  0xe822fe15,0x88570983,0x750e6249,0xda627e55,0x5e76ffa8,0xb1534546,0x6d47de08,0xefe9e7d4
]);

const S6 = new Uint32Array([
  0xf6fa8f9d,0x2cac6ce1,0x4ca34867,0xe2337f7c,0x95db08e7,0x016843b4,0xeced5cbc,0x325553ac,
  0xbf9f0960,0xdfa1e2ed,0x83f0579d,0x63ed86b9,0x1ab6a6b8,0xde5ebe39,0xf38ff732,0x8989b138,
  0x33f14961,0xc01937bd,0xf506c6da,0xe4625e7e,0xa308ea99,0x4e23e33c,0x79cbd7cc,0x48a14367,
  0xa3149619,0xfec94bd5,0xa114174a,0xeaa01866,0xa084db2d,0x09a8486f,0xa888614a,0x2900af98,
  0x01665991,0xe1992863,0xc8f30c60,0x2e78ef3c,0xd0d51932,0xcf0fec14,0xf7ca07d2,0xd0a82072,
  0xfd41197e,0x9305a6b0,0xe86be3da,0x74bed3cd,0x372da53c,0x4c7f4448,0xdab5d440,0x6dba0ec3,
  0x083919a7,0x9fbaeed9,0x49dbcfb0,0x4e670c53,0x5c3d9c01,0x64bdb941,0x2c0e636a,0xba7dd9cd,
  0xea6f7388,0xe70bc762,0x35f29adb,0x5c4cdd8d,0xf0d48d8c,0xb88153e2,0x08a19866,0x1ae2eac8,
  0x284caf89,0xaa928223,0x9334be53,0x3b3a21bf,0x16434be3,0x9aea3906,0xefe8c36e,0xf890cdd9,
  0x80226dae,0xc340a4a3,0xdf7e9c09,0xa694a807,0x5b7c5ecc,0x221db3a6,0x9a69a02f,0x68818a54,
  0xceb2296f,0x53c0843a,0xfe893655,0x25bfe68a,0xb4628abc,0xcf222ebf,0x25ac6f48,0xa9a99387,
  0x53bddb65,0xe76ffbe7,0xe967fd78,0x0ba93563,0x8e342bc1,0xe8a11be9,0x4980740d,0xc8087dfc,
  0x8de4bf99,0xa11101a0,0x7fd37975,0xda5a26c0,0xe81f994f,0x9528cd89,0xfd339fed,0xb87834bf,
  0x5f04456d,0x22258698,0xc9c4c83b,0x2dc156be,0x4f628daa,0x57f55ec5,0xe2220abe,0xd2916ebf,
  0x4ec75b95,0x24f2c3c0,0x42d15d99,0xcd0d7fa0,0x7b6e27ff,0xa8dc8af0,0x7345c106,0xf41e232f,
  0x35162386,0xe6ea8926,0x3333b094,0x157ec6f2,0x372b74af,0x692573e4,0xe9a9d848,0xf3160289,
  0x3a62ef1d,0xa787e238,0xf3a5f676,0x74364853,0x20951063,0x4576698d,0xb6fad407,0x592af950,
  0x36f73523,0x4cfb6e87,0x7da4cec0,0x6c152daa,0xcb0396a8,0xc50dfe5d,0xfcd707ab,0x0921c42f,
  0x89dff0bb,0x5fe2be78,0x448f4f33,0x754613c9,0x2b05d08d,0x48b9d585,0xdc049441,0xc8098f9b,
  0x7dede786,0xc39a3373,0x42410005,0x6a091751,0x0ef3c8a6,0x890072d6,0x28207682,0xa9a9f7be,
  0xbf32679d,0xd45b5b75,0xb353fd00,0xcbb0e358,0x830f220a,0x1f8fb214,0xd372cf08,0xcc3c4a13,
  0x8cf63166,0x061c87be,0x88c98f88,0x6062e397,0x47cf8e7a,0xb6c85283,0x3cc2acfb,0x3fc06976,
  0x4e8f0252,0x64d8314d,0xda3870e3,0x1e665459,0xc10908f0,0x513021a5,0x6c5b68b7,0x822f8aa0,
  0x3007cd3e,0x74719eef,0xdc872681,0x073340d4,0x7e432fd9,0x0c5ec241,0x8809286c,0xf592d891,
  0x08a930f6,0x957ef305,0xb7fbffbd,0xc266e96f,0x6fe4ac98,0xb173ecc0,0xbc60b42a,0x953498da,
  0xfba1ae12,0x2d4bd736,0x0f25faab,0xa4f3fceb,0xe2969123,0x257f0c3d,0x9348af49,0x361400bc,
  0xe8816f4a,0x3814f200,0xa3f94043,0x9c7a54c2,0xbc704f57,0xda41e7f9,0xc25ad33a,0x54f4a084,
  0xb17f5505,0x59357cbe,0xedbd15c8,0x7f97c5ab,0xba5ac7b5,0xb6f6deaf,0x3a479c3a,0x5302da25,
  0x653d7e6a,0x54268d49,0x51a477ea,0x5017d55b,0xd7d25d88,0x44136c76,0x0404a8c8,0xb8e5a121,
  0xb81a928a,0x60ed5869,0x97c55b96,0xeaec991b,0x29935913,0x01fdb7f1,0x088e8dfa,0x9ab6f6f5,
  0x3b4cbf9f,0x4a5de3ab,0xe6051d35,0xa0e1d855,0xd36b4cf1,0xf544edeb,0xb0e93524,0xbebb8fbd,
  0xa2d762cf,0x49c92f54,0x38b5f331,0x7128a454,0x48392905,0xa65b1db8,0x851c97bd,0xd675cf2f
]);

const S7 = new Uint32Array([
  0x85e04019,0x332bf567,0x662dbfff,0xcfc65693,0x2a8d7f6f,0xab9bc912,0xde6008a1,0x2028da1f,
  0x0227bce7,0x4d642916,0x18fac300,0x50f18b82,0x2cb2cb11,0xb232e75c,0x4b3695f2,0xb28707de,
  0xa05fbcf6,0xcd4181e9,0xe150210c,0xe24ef1bd,0xb168c381,0xfde4e789,0x5c79b0d8,0x1e8bfd43,
  0x4d495001,0x38be4341,0x913cee1d,0x92a79c3f,0x089766be,0xbaeeadf4,0x1286becf,0xb6eacb19,
  0x2660c200,0x7565bde4,0x64241f7a,0x8248dca9,0xc3b3ad66,0x28136086,0x0bd8dfa8,0x356d1cf2,
  0x107789be,0xb3b2e9ce,0x0502aa8f,0x0bc0351e,0x166bf52a,0xeb12ff82,0xe3486911,0xd34d7516,
  0x4e7b3aff,0x5f43671b,0x9cf6e037,0x4981ac83,0x334266ce,0x8c9341b7,0xd0d854c0,0xcb3a6c88,
  0x47bc2829,0x4725ba37,0xa66ad22b,0x7ad61f1e,0x0c5cbafa,0x4437f107,0xb6e79962,0x42d2d816,
  0x0a961288,0xe1a5c06e,0x13749e67,0x72fc081a,0xb1d139f7,0xf9583745,0xcf19df58,0xbec3f756,
  0xc06eba30,0x07211b24,0x45c28829,0xc95e317f,0xbc8ec511,0x38bc46e9,0xc6e6fa14,0xbae8584a,
  0xad4ebc46,0x468f508b,0x7829435f,0xf124183b,0x821dba9f,0xaff60ff4,0xea2c4e6d,0x16e39264,
  0x92544a8b,0x009b4fc3,0xaba68ced,0x9ac96f78,0x06a5b79a,0xb2856e6e,0x1aec3ca9,0xbe838688,
  0x0e0804e9,0x55f1be56,0xe7e5363b,0xb3a1f25d,0xf7debb85,0x61fe033c,0x16746233,0x3c034c28,
  0xda6d0c74,0x79aac56c,0x3ce4e1ad,0x51f0c802,0x98f8f35a,0x1626a49f,0xeed82b29,0x1d382fe3,
  0x0c4fb99a,0xbb325778,0x3ec6d97b,0x6e77a6a9,0xcb658b5c,0xd45230c7,0x2bd1408b,0x60c03eb7,
  0xb9068d78,0xa33754f4,0xf430c87d,0xc8a71302,0xb96d8c32,0xebd4e7be,0xbe8b9d2d,0x7979fb06,
  0xe7225308,0x8b75cf77,0x11ef8da4,0xe083c858,0x8d6b786f,0x5a6317a6,0xfa5cf7a0,0x5dda0033,
  0xf28ebfb0,0xf5b9c310,0xa0eac280,0x08b9767a,0xa3d9d2b0,0x79d34217,0x021a718d,0x9ac6336a,
  0x2711fd60,0x438050e3,0x069908a8,0x3d7fedc4,0x826d2bef,0x4eeb8476,0x488dcf25,0x36c9d566,
  0x28e74e41,0xc2610aca,0x3d49a9cf,0xbae3b9df,0xb65f8de6,0x92aeaf64,0x3ac7d5e6,0x9ea80509,
  0xf22b017d,0xa4173f70,0xdd1e16c3,0x15e0d7f9,0x50b1b887,0x2b9f4fd5,0x625aba82,0x6a017962,
  0x2ec01b9c,0x15488aa9,0xd716e740,0x40055a2c,0x93d29a22,0xe32dbf9a,0x058745b9,0x3453dc1e,
  0xd699296e,0x496cff6f,0x1c9f4986,0xdfe2ed07,0xb87242d1,0x19de7eae,0x053e561a,0x15ad6f8c,
  0x66626c1c,0x7154c24c,0xea082b2a,0x93eb2939,0x17dcb0f0,0x58d4f2ae,0x9ea294fb,0x52cf564c,
  0x9883fe66,0x2ec40581,0x763953c3,0x01d6692e,0xd3a0c108,0xa1e7160e,0xe4f2dfa6,0x693ed285,
  0x74904698,0x4c2b0edd,0x4f757656,0x5d393378,0xa132234f,0x3d321c5d,0xc3f5e194,0x4b269301,
  0xc79f022f,0x3c997e7e,0x5e4f9504,0x3ffafbbd,0x76f7ad0e,0x296693f4,0x3d1fce6f,0xc61e45be,
  0xd3b5ab34,0xf72bf9b7,0x1b0434c0,0x4e72b567,0x5592a33d,0xb5229301,0xcfd2a87f,0x60aeb767,
  0x1814386b,0x30bcc33d,0x38a0c07d,0xfd1606f2,0xc363519b,0x589dd390,0x5479f8e6,0x1cb8d647,
  0x97fd61a9,0xea7759f4,0x2d57539d,0x569a58cf,0xe84e63ad,0x462e1b78,0x6580f87e,0xf3817914,
  0x91da55f4,0x40a230f3,0xd1988f35,0xb6e318d2,0x3ffa50bc,0x3d40f021,0xc3c0bdae,0x4958c24c,
  0x518f36b2,0x84b1d370,0x0fedce83,0x878ddada,0xf2a279c7,0x94e01be8,0x90716f4b,0x954b8aa3
]);

const S8 = new Uint32Array([
  0xe216300d,0xbbddfffc,0xa7ebdabd,0x35648095,0x7789f8b7,0xe6c1121b,0x0e241600,0x052ce8b5,
  0x11a9cfb0,0xe5952f11,0xece7990a,0x9386d174,0x2a42931c,0x76e38111,0xb12def3a,0x37ddddfc,
  0xde9adeb1,0x0a0cc32c,0xbe197029,0x84a00940,0xbb243a0f,0xb4d137cf,0xb44e79f0,0x049eedfd,
  0x0b15a15d,0x480d3168,0x8bbbde5a,0x669ded42,0xc7ece831,0x3f8f95e7,0x72df191b,0x7580330d,
  0x94074251,0x5c7dcdfa,0xabbe6d63,0xaa402164,0xb301d40a,0x02e7d1ca,0x53571dae,0x7a3182a2,
  0x12a8ddec,0xfdaa335d,0x176f43e8,0x71fb46d4,0x38129022,0xce949ad4,0xb84769ad,0x965bd862,
  0x82f3d055,0x66fb9767,0x15b80b4e,0x1d5b47a0,0x4cfde06f,0xc28ec4b8,0x57e8726e,0x647a78fc,
  0x99865d44,0x608bd593,0x6c200e03,0x39dc5ff6,0x5d0b00a3,0xae63aff2,0x7e8bd632,0x70108c0c,
  0xbbd35049,0x2998df04,0x980cf42a,0x9b6df491,0x9e7edd53,0x06918548,0x58cb7e07,0x3b74ef2e,
  0x522fffb1,0xd24708cc,0x1c7e27cd,0xa4eb215b,0x3cf1d2e2,0x19b47a38,0x424f7618,0x35856039,
  0x9d17dee7,0x27eb35e6,0xc9aff67b,0x36baf5b8,0x09c467cd,0xc18910b1,0xe11dbf7b,0x06cd1af8,
  0x7170c608,0x2d5e3354,0xd4de495a,0x64c6d006,0xbcc0c62c,0x3dd00db3,0x708f8f34,0x77d51b42,
  0x264f620f,0x24b8d2bf,0x15c1b79e,0x46a52564,0xf8d7e54e,0x3e378160,0x7895cda5,0x859c15a5,
  0xe6459788,0xc37bc75f,0xdb07ba0c,0x0676a3ab,0x7f229b1e,0x31842e7b,0x24259fd7,0xf8bef472,
  0x835ffcb8,0x6df4c1f2,0x96f5b195,0xfd0af0fc,0xb0fe134c,0xe2506d3d,0x4f9b12ea,0xf215f225,
  0xa223736f,0x9fb4c428,0x25d04979,0x34c713f8,0xc4618187,0xea7a6e98,0x7cd16efc,0x1436876c,
  0xf1544107,0xbedeee14,0x56e9af27,0xa04aa441,0x3cf7c899,0x92ecbae6,0xdd67016d,0x151682eb,
  0xa842eedf,0xfdba60b4,0xf1907b75,0x20e3030f,0x24d8c29e,0xe139673b,0xefa63fb8,0x71873054,
  0xb6f2cf3b,0x9f326442,0xcb15a4cc,0xb01a4504,0xf1e47d8d,0x844a1be5,0xbae7dfdc,0x42cbda70,
  0xcd7dae0a,0x57e85b7a,0xd53f5af6,0x20cf4d8c,0xcea4d428,0x79d130a4,0x3486ebfb,0x33d3cddc,
  0x77853b53,0x37effcb5,0xc5068778,0xe580b3e6,0x4e68b8f4,0xc5c8b37e,0x0d809ea2,0x398feb7c,
  0x132a4f94,0x43b7950e,0x2fee7d1c,0x223613bd,0xdd06caa2,0x37df932b,0xc4248289,0xacf3ebc3,
  0x5715f6b7,0xef3478dd,0xf267616f,0xc148cbe4,0x9052815e,0x5e410fab,0xb48a2465,0x2eda7fa4,
  0xe87b40e4,0xe98ea084,0x5889e9e1,0xefd390fc,0xdd07d35b,0xdb485694,0x38d7e5b2,0x57720101,
  0x730edebc,0x5b643113,0x94917e4f,0x503c2fba,0x646f1282,0x7523d24a,0xe0779695,0xf9c17a8f,
  0x7a5b2121,0xd187b896,0x29263a4d,0xba510cdf,0x81f47c9f,0xad1163ed,0xea7b5965,0x1a00726e,
  0x11403092,0x00da6d77,0x4a0cdd61,0xad1f4603,0x605bdfb0,0x9eedc364,0x22ebe6a8,0xcee7d28a,
  0xa0e736a0,0x5564a6b9,0x10853209,0xc7eb8f37,0x2de705ca,0x8951570f,0xdf09822b,0xbd691a6c,
  0xaa12e4f2,0x87451c0f,0xe0f6a27a,0x3ada4819,0x4cf1764f,0x0d771c2b,0x67cdb156,0x350d8384,
  0x5938fa0f,0x42399ef3,0x36997b07,0x0e84093d,0x4aa93e61,0x8360d87b,0x1fa98b0c,0x1149382c,
  0xe97625a5,0x0614d1b7,0x0e25244b,0x0c768347,0x589e8d82,0x0d2059d1,0xa466bb1e,0xf8da0a82,
  0x04f19130,0xba6e4ec0,0x99265164,0x1ee7230d,0x50b2ad80,0xeaee6801,0x8db2a283,0xea8bf59e
]);

// ============================================================
// CAST-128（RFC 2144，CAST5）
// 64 位块，key≤80位(≤10字节)用12轮，>80位用16轮；密钥 5-16 字节（不足16补0）
// 8 个 8x32 S-box（S1-S4 轮函数，S5-S8 key schedule）；大端字节序
// S-box 数据照抄 RFC 2144 Appendix A 不许改（红线）；轮函数/key schedule 照抄 RFC 2.2/2.4
// ============================================================
const CAST5_BLOCK_SIZE = 8;

function readU32BE(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function writeU32BE(b, o, v) { b[o] = (v >>> 24) & 0xff; b[o + 1] = (v >>> 16) & 0xff; b[o + 2] = (v >>> 8) & 0xff; b[o + 3] = v & 0xff; }

function cast5KeySchedule(key) {
  if (key.length < 5 || key.length > 16) throw new Error("CAST-128 密钥长度需 5-16 字节");
  const rounds = key.length <= 10 ? 12 : 16;
  const x = new Uint8Array(16);
  x.set(key.subarray(0, 16));
  const z = new Uint8Array(16);
  const Km = new Uint32Array(16);
  const Kr = new Uint8Array(16);
  const rd = (a, i) => ((a[i] << 24) | (a[i + 1] << 16) | (a[i + 2] << 8) | a[i + 3]) >>> 0;
  const wr = (a, i, v) => { a[i] = (v >>> 24) & 0xff; a[i + 1] = (v >>> 16) & 0xff; a[i + 2] = (v >>> 8) & 0xff; a[i + 3] = v & 0xff; };
 // 段1: z from x, K1-4
  wr(z, 0, rd(x, 0) ^ S5[x[13]] ^ S6[x[15]] ^ S7[x[12]] ^ S8[x[14]] ^ S7[x[8]]);
  wr(z, 4, rd(x, 8) ^ S5[z[0]] ^ S6[z[2]] ^ S7[z[1]] ^ S8[z[3]] ^ S8[x[10]]);
  wr(z, 8, rd(x, 12) ^ S5[z[7]] ^ S6[z[6]] ^ S7[z[5]] ^ S8[z[4]] ^ S5[x[9]]);
  wr(z, 12, rd(x, 4) ^ S5[z[10]] ^ S6[z[9]] ^ S7[z[11]] ^ S8[z[8]] ^ S6[x[11]]);
  Km[0] = S5[z[8]] ^ S6[z[9]] ^ S7[z[7]] ^ S8[z[6]] ^ S5[z[2]];
  Km[1] = S5[z[10]] ^ S6[z[11]] ^ S7[z[5]] ^ S8[z[4]] ^ S6[z[6]];
  Km[2] = S5[z[12]] ^ S6[z[13]] ^ S7[z[3]] ^ S8[z[2]] ^ S7[z[9]];
  Km[3] = S5[z[14]] ^ S6[z[15]] ^ S7[z[1]] ^ S8[z[0]] ^ S8[z[12]];
 // 段2: x from z, K5-8
  wr(x, 0, rd(z, 8) ^ S5[z[5]] ^ S6[z[7]] ^ S7[z[4]] ^ S8[z[6]] ^ S7[z[0]]);
  wr(x, 4, rd(z, 0) ^ S5[x[0]] ^ S6[x[2]] ^ S7[x[1]] ^ S8[x[3]] ^ S8[z[2]]);
  wr(x, 8, rd(z, 4) ^ S5[x[7]] ^ S6[x[6]] ^ S7[x[5]] ^ S8[x[4]] ^ S5[z[1]]);
  wr(x, 12, rd(z, 12) ^ S5[x[10]] ^ S6[x[9]] ^ S7[x[11]] ^ S8[x[8]] ^ S6[z[3]]);
  Km[4] = S5[x[3]] ^ S6[x[2]] ^ S7[x[12]] ^ S8[x[13]] ^ S5[x[8]];
  Km[5] = S5[x[1]] ^ S6[x[0]] ^ S7[x[14]] ^ S8[x[15]] ^ S6[x[13]];
  Km[6] = S5[x[7]] ^ S6[x[6]] ^ S7[x[8]] ^ S8[x[9]] ^ S7[x[3]];
  Km[7] = S5[x[5]] ^ S6[x[4]] ^ S7[x[10]] ^ S8[x[11]] ^ S8[x[7]];
 // 段3: z from x, K9-12
  wr(z, 0, rd(x, 0) ^ S5[x[13]] ^ S6[x[15]] ^ S7[x[12]] ^ S8[x[14]] ^ S7[x[8]]);
  wr(z, 4, rd(x, 8) ^ S5[z[0]] ^ S6[z[2]] ^ S7[z[1]] ^ S8[z[3]] ^ S8[x[10]]);
  wr(z, 8, rd(x, 12) ^ S5[z[7]] ^ S6[z[6]] ^ S7[z[5]] ^ S8[z[4]] ^ S5[x[9]]);
  wr(z, 12, rd(x, 4) ^ S5[z[10]] ^ S6[z[9]] ^ S7[z[11]] ^ S8[z[8]] ^ S6[x[11]]);
  Km[8] = S5[z[3]] ^ S6[z[2]] ^ S7[z[12]] ^ S8[z[13]] ^ S5[z[9]];
  Km[9] = S5[z[1]] ^ S6[z[0]] ^ S7[z[14]] ^ S8[z[15]] ^ S6[z[12]];
  Km[10] = S5[z[7]] ^ S6[z[6]] ^ S7[z[8]] ^ S8[z[9]] ^ S7[z[2]];
  Km[11] = S5[z[5]] ^ S6[z[4]] ^ S7[z[10]] ^ S8[z[11]] ^ S8[z[6]];
 // 段4: x from z, K13-16
  wr(x, 0, rd(z, 8) ^ S5[z[5]] ^ S6[z[7]] ^ S7[z[4]] ^ S8[z[6]] ^ S7[z[0]]);
  wr(x, 4, rd(z, 0) ^ S5[x[0]] ^ S6[x[2]] ^ S7[x[1]] ^ S8[x[3]] ^ S8[z[2]]);
  wr(x, 8, rd(z, 4) ^ S5[x[7]] ^ S6[x[6]] ^ S7[x[5]] ^ S8[x[4]] ^ S5[z[1]]);
  wr(x, 12, rd(z, 12) ^ S5[x[10]] ^ S6[x[9]] ^ S7[x[11]] ^ S8[x[8]] ^ S6[z[3]]);
  Km[12] = S5[x[8]] ^ S6[x[9]] ^ S7[x[7]] ^ S8[x[6]] ^ S5[x[3]];
  Km[13] = S5[x[10]] ^ S6[x[11]] ^ S7[x[5]] ^ S8[x[4]] ^ S6[x[7]];
  Km[14] = S5[x[12]] ^ S6[x[13]] ^ S7[x[3]] ^ S8[x[2]] ^ S7[x[8]];
  Km[15] = S5[x[14]] ^ S6[x[15]] ^ S7[x[1]] ^ S8[x[0]] ^ S8[x[13]];
 // 段5: z from x, K17-20 -> Kr0-3（取低5位）
  wr(z, 0, rd(x, 0) ^ S5[x[13]] ^ S6[x[15]] ^ S7[x[12]] ^ S8[x[14]] ^ S7[x[8]]);
  wr(z, 4, rd(x, 8) ^ S5[z[0]] ^ S6[z[2]] ^ S7[z[1]] ^ S8[z[3]] ^ S8[x[10]]);
  wr(z, 8, rd(x, 12) ^ S5[z[7]] ^ S6[z[6]] ^ S7[z[5]] ^ S8[z[4]] ^ S5[x[9]]);
  wr(z, 12, rd(x, 4) ^ S5[z[10]] ^ S6[z[9]] ^ S7[z[11]] ^ S8[z[8]] ^ S6[x[11]]);
  Kr[0] = (S5[z[8]] ^ S6[z[9]] ^ S7[z[7]] ^ S8[z[6]] ^ S5[z[2]]) & 0x1f;
  Kr[1] = (S5[z[10]] ^ S6[z[11]] ^ S7[z[5]] ^ S8[z[4]] ^ S6[z[6]]) & 0x1f;
  Kr[2] = (S5[z[12]] ^ S6[z[13]] ^ S7[z[3]] ^ S8[z[2]] ^ S7[z[9]]) & 0x1f;
  Kr[3] = (S5[z[14]] ^ S6[z[15]] ^ S7[z[1]] ^ S8[z[0]] ^ S8[z[12]]) & 0x1f;
 // 段6: x from z, K21-24 -> Kr4-7
  wr(x, 0, rd(z, 8) ^ S5[z[5]] ^ S6[z[7]] ^ S7[z[4]] ^ S8[z[6]] ^ S7[z[0]]);
  wr(x, 4, rd(z, 0) ^ S5[x[0]] ^ S6[x[2]] ^ S7[x[1]] ^ S8[x[3]] ^ S8[z[2]]);
  wr(x, 8, rd(z, 4) ^ S5[x[7]] ^ S6[x[6]] ^ S7[x[5]] ^ S8[x[4]] ^ S5[z[1]]);
  wr(x, 12, rd(z, 12) ^ S5[x[10]] ^ S6[x[9]] ^ S7[x[11]] ^ S8[x[8]] ^ S6[z[3]]);
  Kr[4] = (S5[x[3]] ^ S6[x[2]] ^ S7[x[12]] ^ S8[x[13]] ^ S5[x[8]]) & 0x1f;
  Kr[5] = (S5[x[1]] ^ S6[x[0]] ^ S7[x[14]] ^ S8[x[15]] ^ S6[x[13]]) & 0x1f;
  Kr[6] = (S5[x[7]] ^ S6[x[6]] ^ S7[x[8]] ^ S8[x[9]] ^ S7[x[3]]) & 0x1f;
  Kr[7] = (S5[x[5]] ^ S6[x[4]] ^ S7[x[10]] ^ S8[x[11]] ^ S8[x[7]]) & 0x1f;
 // 段7: z from x, K25-28 -> Kr8-11
  wr(z, 0, rd(x, 0) ^ S5[x[13]] ^ S6[x[15]] ^ S7[x[12]] ^ S8[x[14]] ^ S7[x[8]]);
  wr(z, 4, rd(x, 8) ^ S5[z[0]] ^ S6[z[2]] ^ S7[z[1]] ^ S8[z[3]] ^ S8[x[10]]);
  wr(z, 8, rd(x, 12) ^ S5[z[7]] ^ S6[z[6]] ^ S7[z[5]] ^ S8[z[4]] ^ S5[x[9]]);
  wr(z, 12, rd(x, 4) ^ S5[z[10]] ^ S6[z[9]] ^ S7[z[11]] ^ S8[z[8]] ^ S6[x[11]]);
  Kr[8] = (S5[z[3]] ^ S6[z[2]] ^ S7[z[12]] ^ S8[z[13]] ^ S5[z[9]]) & 0x1f;
  Kr[9] = (S5[z[1]] ^ S6[z[0]] ^ S7[z[14]] ^ S8[z[15]] ^ S6[z[12]]) & 0x1f;
  Kr[10] = (S5[z[7]] ^ S6[z[6]] ^ S7[z[8]] ^ S8[z[9]] ^ S7[z[2]]) & 0x1f;
  Kr[11] = (S5[z[5]] ^ S6[z[4]] ^ S7[z[10]] ^ S8[z[11]] ^ S8[z[6]]) & 0x1f;
 // 段8: x from z, K29-32 -> Kr12-15
  wr(x, 0, rd(z, 8) ^ S5[z[5]] ^ S6[z[7]] ^ S7[z[4]] ^ S8[z[6]] ^ S7[z[0]]);
  wr(x, 4, rd(z, 0) ^ S5[x[0]] ^ S6[x[2]] ^ S7[x[1]] ^ S8[x[3]] ^ S8[z[2]]);
  wr(x, 8, rd(z, 4) ^ S5[x[7]] ^ S6[x[6]] ^ S7[x[5]] ^ S8[x[4]] ^ S5[z[1]]);
  wr(x, 12, rd(z, 12) ^ S5[x[10]] ^ S6[x[9]] ^ S7[x[11]] ^ S8[x[8]] ^ S6[z[3]]);
  Kr[12] = (S5[x[8]] ^ S6[x[9]] ^ S7[x[7]] ^ S8[x[6]] ^ S5[x[3]]) & 0x1f;
  Kr[13] = (S5[x[10]] ^ S6[x[11]] ^ S7[x[5]] ^ S8[x[4]] ^ S6[x[7]]) & 0x1f;
  Kr[14] = (S5[x[12]] ^ S6[x[13]] ^ S7[x[3]] ^ S8[x[2]] ^ S7[x[8]]) & 0x1f;
  Kr[15] = (S5[x[14]] ^ S6[x[15]] ^ S7[x[1]] ^ S8[x[0]] ^ S8[x[13]]) & 0x1f;
  return { Km, Kr, rounds };
}

// 轮类型：轮 1,4,7,10,13,16→Type1；2,5,8,11,14→Type2；3,6,9,12,15→Type3
function cast5RoundType(i) { return ((i - 1) % 3) + 1; }

// f 函数（D 数据，Km masking，Kr rotate，type 1/2/3）；+/− mod 2^32
function cast5F(D, Km, Kr, type) {
  let I;
  if (type === 1) I = rotl32((Km + D) >>> 0, Kr);
  else if (type === 2) I = rotl32((Km ^ D) >>> 0, Kr);
  else I = rotl32((Km - D) >>> 0, Kr);
  const ia = (I >>> 24) & 0xff, ib = (I >>> 16) & 0xff, ic = (I >>> 8) & 0xff, id = I & 0xff;
  if (type === 1) return (((S1[ia] ^ S2[ib]) >>> 0) - S3[ic] + S4[id]) >>> 0;
  if (type === 2) return ((((S1[ia] - S2[ib]) >>> 0) + S3[ic]) ^ S4[id]) >>> 0;
  return (((((S1[ia] + S2[ib]) >>> 0) ^ S3[ic]) >>> 0) - S4[id]) >>> 0;
}

function cast5EncryptBlock(block, ctx) {
  let L = readU32BE(block, 0), R = readU32BE(block, 4);
  for (let i = 0; i < ctx.rounds; i++) {
    const t = (L ^ cast5F(R, ctx.Km[i], ctx.Kr[i], cast5RoundType(i + 1))) >>> 0;
    L = R; R = t;
  }
 // 16 轮后最后交换：密文 = R | L
  const out = new Uint8Array(8);
  writeU32BE(out, 0, R);
  writeU32BE(out, 4, L);
  return out;
}

function cast5DecryptBlock(block, ctx) {
  let L = readU32BE(block, 0), R = readU32BE(block, 4);
 // 密文是 R|L，先 swap 回加密结束态 (L=Ln, R=Rn)
  const tmp = L; L = R; R = tmp;
  for (let i = ctx.rounds - 1; i >= 0; i--) {
    const t = (R ^ cast5F(L, ctx.Km[i], ctx.Kr[i], cast5RoundType(i + 1))) >>> 0;
    R = L; L = t;
  }
  const out = new Uint8Array(8);
  writeU32BE(out, 0, L);
  writeU32BE(out, 4, R);
  return out;
}

export function cast5Encrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  const ctx = cast5KeySchedule(key);
  const enc = (blk) => cast5EncryptBlock(blk, ctx);
  if (mode === "ECB") return ecbEncrypt(data, enc, CAST5_BLOCK_SIZE);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcEncrypt(data, enc, CAST5_BLOCK_SIZE, iv);
  }
  throw new Error(`CAST-128 不支持模式: ${mode}`);
}

export function cast5Decrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  const ctx = cast5KeySchedule(key);
  const dec = (blk) => cast5DecryptBlock(blk, ctx);
  if (mode === "ECB") return ecbDecrypt(data, dec, CAST5_BLOCK_SIZE);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcDecrypt(data, dec, CAST5_BLOCK_SIZE, iv);
  }
  throw new Error(`CAST-128 不支持模式: ${mode}`);
}


// ============================================================
// Twofish（Schneier et al. 1998 AES proposal）
// 128 位块，16 轮 Feistel，密钥 16/24/32 字节（128/192/256 位）
// key-dependent S-boxes（4 个，从密钥派生）+ 固定 q0/q1 置换 + MDS 矩阵（GF(2^8), poly 0x169）+ RS 矩阵（GF(2^8), poly 0x14D）
// 参考实现：npm twofish 包（src/twofish.js），与 Bruce Schneier 官方 C 参考实现一致
// 红线：q0/q1/MDS/RS 数据为公开标准常量，照抄不许改；轮函数/key schedule 照抄 Twofish paper Section 4
// ============================================================
const TWOFISH_BLOCK_SIZE = 16;
const TWOFISH_ROUNDS = 16;
const SK_STEP = 0x02020202;
const SK_BUMP = 0x01010101;
const SK_ROTL = 9;
const INPUT_WHITEN = 0;
const OUTPUT_WHITEN = 4;
const ROUND_SUBKEYS = 8;

// 固定置换 q0 (P0) 和 q1 (P1)，照抄 Twofish paper Appendix，不许改
const Q0 = new Uint8Array([
  0xA9, 0x67, 0xB3, 0xE8, 0x04, 0xFD, 0xA3, 0x76, 0x9A, 0x92, 0x80, 0x78, 0xE4, 0xDD, 0xD1, 0x38,
  0x0D, 0xC6, 0x35, 0x98, 0x18, 0xF7, 0xEC, 0x6C, 0x43, 0x75, 0x37, 0x26, 0xFA, 0x13, 0x94, 0x48,
  0xF2, 0xD0, 0x8B, 0x30, 0x84, 0x54, 0xDF, 0x23, 0x19, 0x5B, 0x3D, 0x59, 0xF3, 0xAE, 0xA2, 0x82,
  0x63, 0x01, 0x83, 0x2E, 0xD9, 0x51, 0x9B, 0x7C, 0xA6, 0xEB, 0xA5, 0xBE, 0x16, 0x0C, 0xE3, 0x61,
  0xC0, 0x8C, 0x3A, 0xF5, 0x73, 0x2C, 0x25, 0x0B, 0xBB, 0x4E, 0x89, 0x6B, 0x53, 0x6A, 0xB4, 0xF1,
  0xE1, 0xE6, 0xBD, 0x45, 0xE2, 0xF4, 0xB6, 0x66, 0xCC, 0x95, 0x03, 0x56, 0xD4, 0x1C, 0x1E, 0xD7,
  0xFB, 0xC3, 0x8E, 0xB5, 0xE9, 0xCF, 0xBF, 0xBA, 0xEA, 0x77, 0x39, 0xAF, 0x33, 0xC9, 0x62, 0x71,
  0x81, 0x79, 0x09, 0xAD, 0x24, 0xCD, 0xF9, 0xD8, 0xE5, 0xC5, 0xB9, 0x4D, 0x44, 0x08, 0x86, 0xE7,
  0xA1, 0x1D, 0xAA, 0xED, 0x06, 0x70, 0xB2, 0xD2, 0x41, 0x7B, 0xA0, 0x11, 0x31, 0xC2, 0x27, 0x90,
  0x20, 0xF6, 0x60, 0xFF, 0x96, 0x5C, 0xB1, 0xAB, 0x9E, 0x9C, 0x52, 0x1B, 0x5F, 0x93, 0x0A, 0xEF,
  0x91, 0x85, 0x49, 0xEE, 0x2D, 0x4F, 0x8F, 0x3B, 0x47, 0x87, 0x6D, 0x46, 0xD6, 0x3E, 0x69, 0x64,
  0x2A, 0xCE, 0xCB, 0x2F, 0xFC, 0x97, 0x05, 0x7A, 0xAC, 0x7F, 0xD5, 0x1A, 0x4B, 0x0E, 0xA7, 0x5A,
  0x28, 0x14, 0x3F, 0x29, 0x88, 0x3C, 0x4C, 0x02, 0xB8, 0xDA, 0xB0, 0x17, 0x55, 0x1F, 0x8A, 0x7D,
  0x57, 0xC7, 0x8D, 0x74, 0xB7, 0xC4, 0x9F, 0x72, 0x7E, 0x15, 0x22, 0x12, 0x58, 0x07, 0x99, 0x34,
  0x6E, 0x50, 0xDE, 0x68, 0x65, 0xBC, 0xDB, 0xF8, 0xC8, 0xA8, 0x2B, 0x40, 0xDC, 0xFE, 0x32, 0xA4,
  0xCA, 0x10, 0x21, 0xF0, 0xD3, 0x5D, 0x0F, 0x00, 0x6F, 0x9D, 0x36, 0x42, 0x4A, 0x5E, 0xC1, 0xE0
]);
const Q1 = new Uint8Array([
  0x75, 0xF3, 0xC6, 0xF4, 0xDB, 0x7B, 0xFB, 0xC8, 0x4A, 0xD3, 0xE6, 0x6B, 0x45, 0x7D, 0xE8, 0x4B,
  0xD6, 0x32, 0xD8, 0xFD, 0x37, 0x71, 0xF1, 0xE1, 0x30, 0x0F, 0xF8, 0x1B, 0x87, 0xFA, 0x06, 0x3F,
  0x5E, 0xBA, 0xAE, 0x5B, 0x8A, 0x00, 0xBC, 0x9D, 0x6D, 0xC1, 0xB1, 0x0E, 0x80, 0x5D, 0xD2, 0xD5,
  0xA0, 0x84, 0x07, 0x14, 0xB5, 0x90, 0x2C, 0xA3, 0xB2, 0x73, 0x4C, 0x54, 0x92, 0x74, 0x36, 0x51,
  0x38, 0xB0, 0xBD, 0x5A, 0xFC, 0x60, 0x62, 0x96, 0x6C, 0x42, 0xF7, 0x10, 0x7C, 0x28, 0x27, 0x8C,
  0x13, 0x95, 0x9C, 0xC7, 0x24, 0x46, 0x3B, 0x70, 0xCA, 0xE3, 0x85, 0xCB, 0x11, 0xD0, 0x93, 0xB8,
  0xA6, 0x83, 0x20, 0xFF, 0x9F, 0x77, 0xC3, 0xCC, 0x03, 0x6F, 0x08, 0xBF, 0x40, 0xE7, 0x2B, 0xE2,
  0x79, 0x0C, 0xAA, 0x82, 0x41, 0x3A, 0xEA, 0xB9, 0xE4, 0x9A, 0xA4, 0x97, 0x7E, 0xDA, 0x7A, 0x17,
  0x66, 0x94, 0xA1, 0x1D, 0x3D, 0xF0, 0xDE, 0xB3, 0x0B, 0x72, 0xA7, 0x1C, 0xEF, 0xD1, 0x53, 0x3E,
  0x8F, 0x33, 0x26, 0x5F, 0xEC, 0x76, 0x2A, 0x49, 0x81, 0x88, 0xEE, 0x21, 0xC4, 0x1A, 0xEB, 0xD9,
  0xC5, 0x39, 0x99, 0xCD, 0xAD, 0x31, 0x8B, 0x01, 0x18, 0x23, 0xDD, 0x1F, 0x4E, 0x2D, 0xF9, 0x48,
  0x4F, 0xF2, 0x65, 0x8E, 0x78, 0x5C, 0x58, 0x19, 0x8D, 0xE5, 0x98, 0x57, 0x67, 0x7F, 0x05, 0x64,
  0xAF, 0x63, 0xB6, 0xFE, 0xF5, 0xB7, 0x3C, 0xA5, 0xCE, 0xE9, 0x68, 0x44, 0xE0, 0x4D, 0x43, 0x69,
  0x29, 0x2E, 0xAC, 0x15, 0x59, 0xA8, 0x0A, 0x9E, 0x6E, 0x47, 0xDF, 0x34, 0x35, 0x6A, 0xCF, 0xDC,
  0x22, 0xC9, 0xC0, 0x9B, 0x89, 0xD4, 0xED, 0xAB, 0x12, 0xA2, 0x0D, 0x52, 0xBB, 0x02, 0x2F, 0xA9,
  0xD7, 0x61, 0x1E, 0xB4, 0x50, 0x04, 0xF6, 0xC2, 0x16, 0x25, 0x86, 0x56, 0x55, 0x09, 0xBE, 0x91
]);
const QP = [Q0, Q1];

// 各 S-box 的 q-permutation 选择（照抄参考实现）
const P_00 = 1, P_01 = 0, P_02 = 0, P_03 = 1, P_04 = 1;
const P_10 = 0, P_11 = 0, P_12 = 1, P_13 = 1, P_14 = 0;
const P_20 = 1, P_21 = 1, P_22 = 0, P_23 = 0, P_24 = 0;
const P_30 = 0, P_31 = 1, P_32 = 1, P_33 = 0, P_34 = 1;

// GF(2^8) 反馈多项式常量（MDS 用 0x169，RS 用 0x14D）
const GF256_FDBK_2 = Math.floor(0x169 / 2);  // 0xB4
const GF256_FDBK_4 = Math.floor(0x169 / 4);  // 0x5A
const RS_GF_FDBK = 0x14D;

function lfsr1(x) { return (x >>> 1) ^ ((x & 0x01) !== 0 ? GF256_FDBK_2 : 0); }
function lfsr2(x) { return (x >>> 2) ^ ((x & 0x02) !== 0 ? GF256_FDBK_2 : 0) ^ ((x & 0x01) !== 0 ? GF256_FDBK_4 : 0); }
function mxX(x) { return x ^ lfsr2(x); }
function mxY(x) { return x ^ lfsr1(x) ^ lfsr2(x); }

// MDS 预计算：4 个 256 项 Uint32Array，每项是 32 位（4 字节）结果
// 每行用 P_xx 索引选择 Q0 或 Q1（P_xx=0→Q0, P_xx=1→Q1）
const MDS = (function calcMDS() {
  const m = [[], [], [], []];
  for (let i = 0; i < 256; i++) {
    const j0 = Q0[i] & 0xFF;
    const j1 = Q1[i] & 0xFF;
    const m1_0 = j0, mX_0 = mxX(j0) & 0xFF, mY_0 = mxY(j0) & 0xFF;
    const m1_1 = j1, mX_1 = mxX(j1) & 0xFF, mY_1 = mxY(j1) & 0xFF;
 // MDS[0] P_00=1→Q1, 模式 (m1, mX, mY, mY)
    m[0][i] = (m1_1 << 0) | (mX_1 << 8) | (mY_1 << 16) | (mY_1 << 24);
 // MDS[1] P_10=0→Q0, 模式 (mY, mY, mX, m1)
    m[1][i] = (mY_0 << 0) | (mY_0 << 8) | (mX_0 << 16) | (m1_0 << 24);
 // MDS[2] P_20=1→Q1, 模式 (mX, mY, m1, mY)
    m[2][i] = (mX_1 << 0) | (mY_1 << 8) | (m1_1 << 16) | (mY_1 << 24);
 // MDS[3] P_30=0→Q0, 模式 (mX, m1, mY, mX)
    m[3][i] = (mX_0 << 0) | (m1_0 << 8) | (mY_0 << 16) | (mX_0 << 24);
  }
  return [new Uint32Array(m[0]), new Uint32Array(m[1]), new Uint32Array(m[2]), new Uint32Array(m[3])];
})();

function b0(x) { return x & 0xFF; }
function b1(x) { return (x >>> 8) & 0xFF; }
function b2(x) { return (x >>> 16) & 0xFF; }
function b3(x) { return (x >>> 24) & 0xFF; }
function chooseB(x, N) {
  switch (N & 3) {
    case 0: return b0(x);
    case 1: return b1(x);
    case 2: return b2(x);
    case 3: return b3(x);
  }
}

// RS 编码（用于从密钥派生 S-box key）
function rsRem(x) {
  const bb = (x >>> 24) & 0xFF;
  const g2 = ((bb << 1) ^ ((bb & 0x80) !== 0 ? RS_GF_FDBK : 0)) & 0xFF;
  const g3 = ((bb >>> 1) ^ ((bb & 0x01) !== 0 ? (RS_GF_FDBK >>> 1) : 0) ^ g2) & 0xFF;
  return (x << 8) ^ (g3 << 24) ^ (g2 << 16) ^ (g3 << 8) ^ bb;
}
function rsMDSEncode(k0, k1) {
  for (let i = 0; i < 4; i++) k1 = rsRem(k1);
  k1 = (k1 ^ k0) >>> 0;
  for (let i = 0; i < 4; i++) k1 = rsRem(k1);
  return k1 >>> 0;
}

// h 函数（f32）：x 经 q-permutation + 密钥 XOR + MDS 矩阵乘法，返回 32 位
function tfF32(k64Cnt, x, k32) {
  let lB0 = b0(x), lB1 = b1(x), lB2 = b2(x), lB3 = b3(x);
  const k0 = k32[0] || 0, k1 = k32[1] || 0, k2 = k32[2] || 0, k3 = k32[3] || 0;
  let result = 0;
  switch (k64Cnt & 3) {
    case 1:
      result = MDS[0][QP[P_01][lB0] ^ b0(k0)] ^
               MDS[1][QP[P_11][lB1] ^ b1(k0)] ^
               MDS[2][QP[P_21][lB2] ^ b2(k0)] ^
               MDS[3][QP[P_31][lB3] ^ b3(k0)];
      break;
    case 0:  // 同 case 4
      lB0 = QP[P_04][lB0] ^ b0(k3);
      lB1 = QP[P_14][lB1] ^ b1(k3);
      lB2 = QP[P_24][lB2] ^ b2(k3);
      lB3 = QP[P_34][lB3] ^ b3(k3);
 /* falls through */
    case 3:
      lB0 = QP[P_03][lB0] ^ b0(k2);
      lB1 = QP[P_13][lB1] ^ b1(k2);
      lB2 = QP[P_23][lB2] ^ b2(k2);
      lB3 = QP[P_33][lB3] ^ b3(k2);
 /* falls through */
    case 2:
      result = MDS[0][QP[P_01][QP[P_02][lB0] ^ b0(k1)] ^ b0(k0)] ^
               MDS[1][QP[P_11][QP[P_12][lB1] ^ b1(k1)] ^ b1(k0)] ^
               MDS[2][QP[P_21][QP[P_22][lB2] ^ b2(k1)] ^ b2(k0)] ^
               MDS[3][QP[P_31][QP[P_32][lB3] ^ b3(k1)] ^ b3(k0)];
      break;
  }
  return result >>> 0;
}

// 轮函数 g 的查表实现（sBox 预计算后用 fe32）
function tfFe32(sBox, x, R) {
  return (sBox[2 * chooseB(x, R)] ^
          sBox[2 * chooseB(x, R + 1) + 1] ^
          sBox[0x200 + 2 * chooseB(x, R + 2)] ^
          sBox[0x200 + 2 * chooseB(x, R + 3) + 1]) >>> 0;
}

// 密钥调度：生成 sBox[1024] + subKeys[40]
function twofishKeySchedule(key) {
  if (key.length !== 16 && key.length !== 24 && key.length !== 32) {
    throw new Error("Twofish 密钥长度需 16/24/32 字节（128/192/256 位）");
  }
  const k64Cnt = key.length / 8;
  const subkeyCnt = ROUND_SUBKEYS + 2 * TWOFISH_ROUNDS;  // 40
  const k32e = [0, 0, 0, 0];
  const k32o = [0, 0, 0, 0];
  const sBoxKey = [0, 0, 0, 0];
  let offset = 0;
  for (let i = 0, j = k64Cnt - 1; i < 4 && offset < key.length; i++, j--) {
    k32e[i] = ((key[offset++]) | (key[offset++] << 8) | (key[offset++] << 16) | (key[offset++] << 24)) >>> 0;
    k32o[i] = ((key[offset++]) | (key[offset++] << 8) | (key[offset++] << 16) | (key[offset++] << 24)) >>> 0;
    sBoxKey[j] = rsMDSEncode(k32e[i], k32o[i]);
  }
  const subKeys = new Array(subkeyCnt);
  for (let i = 0, q = 0; i < subkeyCnt / 2; i++, q = (q + SK_STEP) >>> 0) {
    let A = tfF32(k64Cnt, q, k32e);
    let B = tfF32(k64Cnt, (q + SK_BUMP) >>> 0, k32o);
    B = ((B << 8) | (B >>> 24)) >>> 0;
    A = (A + B) >>> 0;
    subKeys[2 * i] = A;
    A = (A + B) >>> 0;
    subKeys[2 * i + 1] = ((A << SK_ROTL) | (A >>> (32 - SK_ROTL))) >>> 0;
  }
 // 预计算 sBox[1024]
  const sBox = new Uint32Array(0x400);
  const k0 = sBoxKey[0], k1 = sBoxKey[1], k2 = sBoxKey[2], k3 = sBoxKey[3];
  for (let i = 0; i < 256; i++) {
    let lB0 = i, lB1 = i, lB2 = i, lB3 = i;
    switch (k64Cnt & 3) {
      case 1:
        sBox[2 * i] = MDS[0][QP[P_01][lB0] ^ b0(k0)];
        sBox[2 * i + 1] = MDS[1][QP[P_11][lB1] ^ b1(k0)];
        sBox[0x200 + 2 * i] = MDS[2][QP[P_21][lB2] ^ b2(k0)];
        sBox[0x200 + 2 * i + 1] = MDS[3][QP[P_31][lB3] ^ b3(k0)];
        break;
      case 0:
        lB0 = QP[P_04][lB0] ^ b0(k3);
        lB1 = QP[P_14][lB1] ^ b1(k3);
        lB2 = QP[P_24][lB2] ^ b2(k3);
        lB3 = QP[P_34][lB3] ^ b3(k3);
 /* falls through */
      case 3:
        lB0 = QP[P_03][lB0] ^ b0(k2);
        lB1 = QP[P_13][lB1] ^ b1(k2);
        lB2 = QP[P_23][lB2] ^ b2(k2);
        lB3 = QP[P_33][lB3] ^ b3(k2);
 /* falls through */
      case 2:
        sBox[2 * i] = MDS[0][QP[P_01][QP[P_02][lB0] ^ b0(k1)] ^ b0(k0)];
        sBox[2 * i + 1] = MDS[1][QP[P_11][QP[P_12][lB1] ^ b1(k1)] ^ b1(k0)];
        sBox[0x200 + 2 * i] = MDS[2][QP[P_21][QP[P_22][lB2] ^ b2(k1)] ^ b2(k0)];
        sBox[0x200 + 2 * i + 1] = MDS[3][QP[P_31][QP[P_32][lB3] ^ b3(k1)] ^ b3(k0)];
        break;
    }
  }
  return { sBox, subKeys };
}

function twofishEncryptBlock(block, ctx) {
  const sBox = ctx.sBox, sKey = ctx.subKeys;
  let x0 = (block[0] | (block[1] << 8) | (block[2] << 16) | (block[3] << 24)) >>> 0;
  let x1 = (block[4] | (block[5] << 8) | (block[6] << 16) | (block[7] << 24)) >>> 0;
  let x2 = (block[8] | (block[9] << 8) | (block[10] << 16) | (block[11] << 24)) >>> 0;
  let x3 = (block[12] | (block[13] << 8) | (block[14] << 16) | (block[15] << 24)) >>> 0;
  x0 = (x0 ^ sKey[INPUT_WHITEN]) >>> 0;
  x1 = (x1 ^ sKey[INPUT_WHITEN + 1]) >>> 0;
  x2 = (x2 ^ sKey[INPUT_WHITEN + 2]) >>> 0;
  x3 = (x3 ^ sKey[INPUT_WHITEN + 3]) >>> 0;
  let k = ROUND_SUBKEYS;
  for (let R = 0; R < TWOFISH_ROUNDS; R += 2) {
    let t0 = tfFe32(sBox, x0, 0);
    let t1 = tfFe32(sBox, x1, 3);
    x2 = (x2 ^ (t0 + t1 + sKey[k++])) >>> 0;
    x2 = ((x2 >>> 1) | (x2 << 31)) >>> 0;
    x3 = ((x3 << 1) | (x3 >>> 31)) >>> 0;
    x3 = (x3 ^ (t0 + 2 * t1 + sKey[k++])) >>> 0;
    t0 = tfFe32(sBox, x2, 0);
    t1 = tfFe32(sBox, x3, 3);
    x0 = (x0 ^ (t0 + t1 + sKey[k++])) >>> 0;
    x0 = ((x0 >>> 1) | (x0 << 31)) >>> 0;
    x1 = ((x1 << 1) | (x1 >>> 31)) >>> 0;
    x1 = (x1 ^ (t0 + 2 * t1 + sKey[k++])) >>> 0;
  }
  x2 = (x2 ^ sKey[OUTPUT_WHITEN]) >>> 0;
  x3 = (x3 ^ sKey[OUTPUT_WHITEN + 1]) >>> 0;
  x0 = (x0 ^ sKey[OUTPUT_WHITEN + 2]) >>> 0;
  x1 = (x1 ^ sKey[OUTPUT_WHITEN + 3]) >>> 0;
  const out = new Uint8Array(16);
  out[0] = x2 & 0xff; out[1] = (x2 >>> 8) & 0xff; out[2] = (x2 >>> 16) & 0xff; out[3] = (x2 >>> 24) & 0xff;
  out[4] = x3 & 0xff; out[5] = (x3 >>> 8) & 0xff; out[6] = (x3 >>> 16) & 0xff; out[7] = (x3 >>> 24) & 0xff;
  out[8] = x0 & 0xff; out[9] = (x0 >>> 8) & 0xff; out[10] = (x0 >>> 16) & 0xff; out[11] = (x0 >>> 24) & 0xff;
  out[12] = x1 & 0xff; out[13] = (x1 >>> 8) & 0xff; out[14] = (x1 >>> 16) & 0xff; out[15] = (x1 >>> 24) & 0xff;
  return out;
}

function twofishDecryptBlock(block, ctx) {
  const sBox = ctx.sBox, sKey = ctx.subKeys;
  let x2 = (block[0] | (block[1] << 8) | (block[2] << 16) | (block[3] << 24)) >>> 0;
  let x3 = (block[4] | (block[5] << 8) | (block[6] << 16) | (block[7] << 24)) >>> 0;
  let x0 = (block[8] | (block[9] << 8) | (block[10] << 16) | (block[11] << 24)) >>> 0;
  let x1 = (block[12] | (block[13] << 8) | (block[14] << 16) | (block[15] << 24)) >>> 0;
  x2 = (x2 ^ sKey[OUTPUT_WHITEN]) >>> 0;
  x3 = (x3 ^ sKey[OUTPUT_WHITEN + 1]) >>> 0;
  x0 = (x0 ^ sKey[OUTPUT_WHITEN + 2]) >>> 0;
  x1 = (x1 ^ sKey[OUTPUT_WHITEN + 3]) >>> 0;
  let k = ROUND_SUBKEYS + 2 * TWOFISH_ROUNDS - 1;
  for (let R = 0; R < TWOFISH_ROUNDS; R += 2) {
    let t0 = tfFe32(sBox, x2, 0);
    let t1 = tfFe32(sBox, x3, 3);
    x1 = (x1 ^ (t0 + 2 * t1 + sKey[k--])) >>> 0;
    x1 = ((x1 >>> 1) | (x1 << 31)) >>> 0;
    x0 = ((x0 << 1) | (x0 >>> 31)) >>> 0;
    x0 = (x0 ^ (t0 + t1 + sKey[k--])) >>> 0;
    t0 = tfFe32(sBox, x0, 0);
    t1 = tfFe32(sBox, x1, 3);
    x3 = (x3 ^ (t0 + 2 * t1 + sKey[k--])) >>> 0;
    x3 = ((x3 >>> 1) | (x3 << 31)) >>> 0;
    x2 = ((x2 << 1) | (x2 >>> 31)) >>> 0;
    x2 = (x2 ^ (t0 + t1 + sKey[k--])) >>> 0;
  }
  x0 = (x0 ^ sKey[INPUT_WHITEN]) >>> 0;
  x1 = (x1 ^ sKey[INPUT_WHITEN + 1]) >>> 0;
  x2 = (x2 ^ sKey[INPUT_WHITEN + 2]) >>> 0;
  x3 = (x3 ^ sKey[INPUT_WHITEN + 3]) >>> 0;
  const out = new Uint8Array(16);
  out[0] = x0 & 0xff; out[1] = (x0 >>> 8) & 0xff; out[2] = (x0 >>> 16) & 0xff; out[3] = (x0 >>> 24) & 0xff;
  out[4] = x1 & 0xff; out[5] = (x1 >>> 8) & 0xff; out[6] = (x1 >>> 16) & 0xff; out[7] = (x1 >>> 24) & 0xff;
  out[8] = x2 & 0xff; out[9] = (x2 >>> 8) & 0xff; out[10] = (x2 >>> 16) & 0xff; out[11] = (x2 >>> 24) & 0xff;
  out[12] = x3 & 0xff; out[13] = (x3 >>> 8) & 0xff; out[14] = (x3 >>> 16) & 0xff; out[15] = (x3 >>> 24) & 0xff;
  return out;
}

export function twofishEncrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  const ctx = twofishKeySchedule(key);
  const enc = (blk) => twofishEncryptBlock(blk, ctx);
  if (mode === "ECB") return ecbEncrypt(data, enc, TWOFISH_BLOCK_SIZE);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcEncrypt(data, enc, TWOFISH_BLOCK_SIZE, iv);
  }
  throw new Error(`Twofish 不支持模式: ${mode}`);
}

export function twofishDecrypt(data, key, opts = {}) {
  const mode = (opts.mode || "ECB").toUpperCase();
  const iv = opts.iv;
  const ctx = twofishKeySchedule(key);
  const dec = (blk) => twofishDecryptBlock(blk, ctx);
  if (mode === "ECB") return ecbDecrypt(data, dec, TWOFISH_BLOCK_SIZE);
  if (mode === "CBC") {
    if (!iv) throw new Error("CBC 模式需提供 IV");
    return cbcDecrypt(data, dec, TWOFISH_BLOCK_SIZE, iv);
  }
  throw new Error(`Twofish 不支持模式: ${mode}`);
}

// ============================================================
// register 层
// ============================================================
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
function blockParams(modes, keyPh) {
  return [
    { key: "key", label: "密钥", type: "text", default: "", placeholder: keyPh },
    { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
    { key: "mode", label: "模式", type: "select", default: "CBC",
      options: modes.map((m) => ({ value: m, label: m })) },
    { key: "iv", label: "IV / Nonce", type: "text", default: "", placeholder: "hex（8 字节 IV）" },
    { key: "ivEnc", label: "IV 编码", type: "select", default: "hex", options: ENC_OPTS },
    { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: OUT_OPTS },
  ];
}
function makeBlockEncode(encFn) {
  return (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const mode = (p.mode || "CBC").toUpperCase();
    const data = te(text);
    const iv = p.iv ? decodeInput(p.iv, p.ivEnc || "hex") : undefined;
    return encodeOutput(encFn(data, key, { mode, iv }), p.outEnc || "base64");
  };
}
function makeBlockDecode(decFn) {
  return (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const mode = (p.mode || "CBC").toUpperCase();
    const data = decodeInput(text.trim(), p.outEnc || "base64");
    const iv = p.iv ? decodeInput(p.iv, p.ivEnc || "hex") : undefined;
    return encodeOutput(decFn(data, key, { mode, iv }), "utf8");
  };
}

// export 底层函数供测试直接调用（官方向量需单块无填充）
export { rc5KeySchedule, rc5EncryptBlock, rc5DecryptBlock, ideaKeySchedule, ideaEncryptBlock, ideaDecryptKeySchedule, blowfishKeySchedule, blowfishEncryptBlock, blowfishDecryptBlock, rc6KeySchedule, rc6EncryptBlock, rc6DecryptBlock, cast5KeySchedule, cast5EncryptBlock, cast5DecryptBlock, twofishKeySchedule, twofishEncryptBlock, twofishDecryptBlock };

register({
  id: "rc5", cat: "modern", name: "RC5", desc: "RC5-32/12/16 分组密码（RFC 2040，64位块，12轮，可变密钥，加法+XOR+循环移位）",
  params: blockParams(["ECB", "CBC"], "1-255 字节密钥（默认 16 字节）"),
  encode: makeBlockEncode(rc5Encrypt),
  decode: makeBlockDecode(rc5Decrypt),
});
register({
  id: "idea", cat: "modern", name: "IDEA", desc: "国际数据加密算法（Lai 1991，64位块，128位密钥，8.5轮，mod 2^16+1 乘法 + mod 2^16 加法 + XOR）",
  params: blockParams(["ECB", "CBC"], "16 字节密钥（128 位）"),
  encode: makeBlockEncode(ideaEncrypt),
  decode: makeBlockDecode(ideaDecrypt),
});
register({
  id: "blowfish", cat: "modern", name: "Blowfish", desc: "Blowfish 分组密码（Schneier 1993，64位块，可变密钥4-56字节，16轮Feistel，P-array+S-boxes）",
  params: blockParams(["ECB", "CBC"], "4-56 字节密钥"),
  encode: makeBlockEncode(blowfishEncrypt),
  decode: makeBlockDecode(blowfishDecrypt),
});
register({
  id: "rc6", cat: "modern", name: "RC6", desc: "RC6 分组密码（RFC 2276，128位块，可变密钥1-255字节默认16，20轮，乘法+循环移位，RC5继任者）",
  params: blockParams(["ECB", "CBC"], "1-255 字节密钥（默认 16）"),
  encode: makeBlockEncode(rc6Encrypt),
  decode: makeBlockDecode(rc6Decrypt),
});
register({
  id: "cast5", cat: "modern", name: "CAST-128", desc: "CAST-128/CAST5 分组密码（RFC 2144，64位块，可变密钥5-16字节，key≤80位12轮否则16轮，Feistel+三种轮函数+8个S-box）",
  params: blockParams(["ECB", "CBC"], "5-16 字节密钥"),
  encode: makeBlockEncode(cast5Encrypt),
  decode: makeBlockDecode(cast5Decrypt),
});
register({
  id: "twofish", cat: "modern", name: "Twofish", desc: "Twofish 分组密码（Schneier 1998 AES 提案，128位块，16轮Feistel，密钥128/192/256位，key-dependent S-boxes+MDS+RS 矩阵）",
  params: blockParams(["ECB", "CBC"], "16/24/32 字节密钥"),
  encode: makeBlockEncode(twofishEncrypt),
  decode: makeBlockDecode(twofishDecrypt),
});
