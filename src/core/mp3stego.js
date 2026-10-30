/*
 * mp3stego.js — MP3Stego（-X -P）纯 JS 解码，跨 Node/浏览器，零 DOM。
 *
 * 算法来源（按 1.1.19 源码逐项复刻，未调用本地 exe）：
 *   1. MPEG Layer III 每帧 side info 里 part2_3_length 的奇偶性（&1）承载 1 bit；
 *   2. 哪些 granule/channel 承载数据由密码驱动的 SHA-1 伪随机比特流选择：
 *      hash = SHA1(password)，按 32 位字 LSB-first 取位；每 5 个 32 位字后
 *      hash = SHA1(hash_words_hostLE || password)；累计 3 个 0 后丢弃下一个 0；
 *   3. 隐藏流前 4 字节 = 小端 size_t 的负载长度 lData，随后 lData 字节为
 *      3DES-CBC(zlib/gzip 压缩后的明文)。3DES 三个密钥取自 SHA1(password)
 *      的主机字节序（Windows x86 = 小端）偏移 0/6/12 各 8 字节，IV=0；
 *   4. 解密后去掉 3DES 尾部填充（最后一块最后一字节 = 有效字节数 rem，
 *      保留最后一块前 rem 字节），再按 gzip 解压得到隐藏文本/文件。
 *
 * 限制：中间数据布局依赖编码器的 size_t（4 字节）与主机小端序；官方 32 位
 * Windows/Linux 构建均满足。若 3DES 后不是 gzip 头，明确返回密码错误/未嵌入，
 * 不会假成功。
 *
 * API：
 *   mp3stegoDecode(bytes, {password, extract=true, maxPayloadBytes=4MiB})
 *     -> { ok, text, bytes, reason, code?, meta }
 */
import { inflateRaw } from "./pcapDeep.js";

const MP3_LAYER_III = 1;
const BITRATE_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
const BITRATE_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0];
const SAMPLE_RATES = {
  3: [44100, 48000, 32000, 0],
  2: [22050, 24000, 16000, 0],
  0: [11025, 12000, 8000, 0],
};

function toBytes(src) {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  throw new Error("mp3stegoDecode: 输入必须是 Uint8Array/ArrayBuffer");
}

function fail(code, reason, meta) {
  return { ok: false, text: "", bytes: new Uint8Array(0), reason, code, meta: meta || null };
}

// ---------------- SHA-1（返回 5 个 32 位字，与 C 端 UINT32 hash[5] 对应） ----------------
function rotl32(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

function sha1Words(data) {
  const len = data.length;
  const bitLen = len * 8;
  const total = (len + 9 + 63) & ~63;
  const buf = new Uint8Array(total);
  buf.set(data);
  buf[len] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(total - 8, Math.floor(bitLen / 0x100000000) >>> 0);
  view.setUint32(total - 4, bitLen >>> 0);
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) w[i] = rotl32(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const t = (rotl32(a, 5) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = rotl32(b, 30); b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return new Uint32Array([h0, h1, h2, h3, h4]);
}

function wordsToLeBytes(words) {
  const out = new Uint8Array(words.length * 4);
  for (let i = 0; i < words.length; i++) {
    const v = words[i];
    out[i * 4] = v & 0xff;
    out[i * 4 + 1] = (v >>> 8) & 0xff;
    out[i * 4 + 2] = (v >>> 16) & 0xff;
    out[i * 4 + 3] = (v >>> 24) & 0xff;
  }
  return out;
}

class StegoPrng {
  constructor(passwordBytes) {
    this.pw = passwordBytes;
    this.reset();
  }
  reset() {
    this.hash = sha1Words(this.pw);
    this.block = 0;
    this.bit = 0;
    this.count = 0;
  }
  _advance() {
    this.bit++;
    if (this.bit === 32) {
      this.bit = 0;
      this.block++;
      if (this.block === 5) {
        this.block = 0;
        const seed = new Uint8Array(20 + this.pw.length);
        seed.set(wordsToLeBytes(this.hash), 0);
        seed.set(this.pw, 20);
        this.hash = sha1Words(seed);
      }
    }
  }
  next() {
    for (;;) {
      const bit = (this.hash[this.block] >>> this.bit) & 1;
      if (bit === 0) this.count++;
      this._advance();
      if (bit === 1) return true;
      if (this.count === 3) { this.count = 0; continue; }
      return false;
    }
  }
}

// ---------------- DES / 3DES-CBC（Eric Young 兼容的 EDE3 解密） ----------------
const DES_IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];
const DES_FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];
const DES_E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13,
  12, 13, 14, 15, 16, 17, 16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];
const DES_P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];
const DES_PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];
const DES_PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8,
  16, 7, 27, 20, 13, 2, 41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];
const DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const DES_SBOX = [
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
    0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
    4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
    15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
    3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1, 10, 6, 9, 11, 5,
    0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
    13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
    13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
    13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
    1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
    13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
    10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
    3, 15, 0, 6, 10, 1, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
    14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
    4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
    11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
    10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
    9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
    4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
    13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
    1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
    6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
    1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
    7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
    2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

function bytesToBits(bytes) {
  const out = new Uint8Array(bytes.length * 8);
  for (let i = 0; i < bytes.length; i++) {
    for (let b = 0; b < 8; b++) out[i * 8 + b] = (bytes[i] >>> (7 - b)) & 1;
  }
  return out;
}

function bitsToBytes(bits) {
  const out = new Uint8Array(bits.length >>> 3);
  for (let i = 0; i < out.length * 8; i++) if (bits[i]) out[i >> 3] |= 1 << (7 - (i & 7));
  return out;
}

function permuteBits(input, table) {
  const out = new Uint8Array(table.length);
  for (let i = 0; i < table.length; i++) out[i] = input[table[i] - 1];
  return out;
}

function desSubkeys(key) {
  const perm = permuteBits(bytesToBits(key), DES_PC1);
  let C = Array.from(perm.slice(0, 28));
  let D = Array.from(perm.slice(28));
  const keys = [];
  for (let r = 0; r < 16; r++) {
    const s = DES_SHIFTS[r];
    C = C.slice(s).concat(C.slice(0, s));
    D = D.slice(s).concat(D.slice(0, s));
    keys.push(permuteBits(C.concat(D), DES_PC2));
  }
  return keys;
}

function desBlock(block, subkeys) {
  const ip = permuteBits(bytesToBits(block), DES_IP);
  let L = Array.from(ip.slice(0, 32));
  let R = Array.from(ip.slice(32));
  for (let r = 0; r < 16; r++) {
    const er = permuteBits(R, DES_E);
    const sk = subkeys[r];
    const sOut = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      const b = i * 6;
      const x0 = er[b] ^ sk[b], x1 = er[b + 1] ^ sk[b + 1], x2 = er[b + 2] ^ sk[b + 2];
      const x3 = er[b + 3] ^ sk[b + 3], x4 = er[b + 4] ^ sk[b + 4], x5 = er[b + 5] ^ sk[b + 5];
      const row = (x0 << 1) | x5;
      const col = (x1 << 3) | (x2 << 2) | (x3 << 1) | x4;
      const v = DES_SBOX[i][row * 16 + col];
      sOut[i * 4] = (v >>> 3) & 1;
      sOut[i * 4 + 1] = (v >>> 2) & 1;
      sOut[i * 4 + 2] = (v >>> 1) & 1;
      sOut[i * 4 + 3] = v & 1;
    }
    const p = permuteBits(sOut, DES_P);
    const nextR = new Uint8Array(32);
    for (let i = 0; i < 32; i++) nextR[i] = L[i] ^ p[i];
    L = R;
    R = Array.from(nextR);
  }
  return bitsToBytes(permuteBits(R.concat(L), DES_FP));
}

function desDecryptBlock(block, subkeys) { return desBlock(block, subkeys.slice().reverse()); }

function tripleDesCbcDecrypt(cipher, k1, k2, k3) {
  if (cipher.length % 8 !== 0) throw new Error("3DES 密文长度不是 8 的倍数");
  const s1 = desSubkeys(k1), s2 = desSubkeys(k2), s3 = desSubkeys(k3);
  const out = new Uint8Array(cipher.length);
  let prev = new Uint8Array(8);
  for (let off = 0; off < cipher.length; off += 8) {
    const c = cipher.subarray(off, off + 8);
    let p = desDecryptBlock(c, s3);
    p = desBlock(p, s2);
    p = desDecryptBlock(p, s1);
    for (let i = 0; i < 8; i++) out[off + i] = p[i] ^ prev[i];
    prev = c;
  }
  return out;
}

// ---------------- gzip ----------------
function gunzip(data) {
  if (data.length < 18 || data[0] !== 0x1f || data[1] !== 0x8b) throw new Error("不是 gzip 数据（缺少 1f 8b 头）");
  if (data[2] !== 8) throw new Error("gzip 压缩方法 " + data[2] + " 不支持");
  const flg = data[3];
  let pos = 10;
  if (flg & 4) {
    if (pos + 2 > data.length) throw new Error("gzip FEXTRA 截断");
    pos += 2 + (data[pos] | (data[pos + 1] << 8));
  }
  if (flg & 8) { while (pos < data.length && data[pos] !== 0) pos++; pos++; }
  if (flg & 16) { while (pos < data.length && data[pos] !== 0) pos++; pos++; }
  if (flg & 2) pos += 2;
  if (pos >= data.length) throw new Error("gzip 头截断");
  return inflateRaw(data.subarray(pos));
}

// ---------------- MP3 帧 / side info ----------------
function parseFrameHeader(b, pos) {
  if (pos + 4 > b.length) return null;
  if (b[pos] !== 0xff || (b[pos + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[pos + 1] >>> 3) & 3;
  const layer = (b[pos + 1] >>> 1) & 3;
  const protection = b[pos + 1] & 1;
  if (version === 1 || layer !== MP3_LAYER_III) return null;
  const brIdx = (b[pos + 2] >>> 4) & 0x0f;
  const srIdx = (b[pos + 2] >>> 2) & 3;
  const padding = (b[pos + 2] >>> 1) & 1;
  const mode = (b[pos + 3] >>> 6) & 3;
  if (brIdx === 0 || brIdx === 15 || srIdx === 3) return null;
  const mpeg1 = version === 3;
  const bitrate = (mpeg1 ? BITRATE_V1_L3 : BITRATE_V2_L3)[brIdx] * 1000;
  const sampleRate = SAMPLE_RATES[version][srIdx];
  if (!bitrate || !sampleRate) return null;
  const frameLen = Math.floor(((mpeg1 ? 144 : 72) * bitrate) / sampleRate) + padding;
  const channels = mode === 3 ? 1 : 2;
  const crcLen = protection ? 0 : 2;
  const sideInfoLen = mpeg1 ? (channels === 1 ? 17 : 32) : (channels === 1 ? 9 : 17);
  if (frameLen < 4 + crcLen + sideInfoLen) return null;
  return { offset: pos, frameLen, version, mpeg1, mode, channels, crcLen, sideInfoLen, bitrate, sampleRate };
}

function parseMp3Frames(b) {
  let pos = 0;
  if (b.length >= 10 && b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) {
    const size = ((b[6] & 0x7f) << 21) | ((b[7] & 0x7f) << 14) | ((b[8] & 0x7f) << 7) | (b[9] & 0x7f);
    pos = 10 + size + ((b[5] & 0x10) ? 10 : 0);
  }
  const frames = [];
  while (pos + 4 <= b.length && frames.length < 500000) {
    const f = parseFrameHeader(b, pos);
    if (f) {
      if (pos + 4 + f.crcLen + f.sideInfoLen <= b.length) frames.push(f);
      pos += f.frameLen;
      if (pos > b.length) break;
    } else {
      const next = b.indexOf(0xff, pos + 1);
      if (next < 0) break;
      pos = next;
    }
  }
  return frames;
}

function readBitsBE(b, bitPos, n) {
  let v = 0;
  for (let i = 0; i < n; i++) {
    const p = bitPos + i;
    v = (v << 1) | ((b[p >>> 3] >>> (7 - (p & 7))) & 1);
  }
  return v;
}

function part2Lengths(b, f) {
  const base = (f.offset + 4 + f.crcLen) * 8;
  const out = [];
  if (f.mpeg1) {
    const start = base + 9 + (f.channels === 1 ? 5 : 3) + 4 * f.channels;
    for (let gr = 0; gr < 2; gr++) {
      for (let ch = 0; ch < f.channels; ch++) {
        out.push(readBitsBE(b, start + (gr * f.channels + ch) * 59, 12));
      }
    }
  } else {
    const start = base + 8 + (f.channels === 1 ? 1 : 2);
    for (let ch = 0; ch < f.channels; ch++) out.push(readBitsBE(b, start + ch * 63, 12));
  }
  return out;
}

function passwordBytes(p) {
  if (p == null) return new Uint8Array(0);
  if (p instanceof Uint8Array) return p;
  return new TextEncoder().encode(String(p));
}

function hiddenBitsToBytes(bits, start, count) {
  const out = new Uint8Array(count);
  for (let i = 0; i < count * 8; i++) if (bits[start + i]) out[i >>> 3] |= 1 << (i & 7);
  return out;
}

/**
 * 解码 MP3Stego -X -P 隐藏数据（同步）。
 * @param {Uint8Array|ArrayBuffer} src MP3 字节
 * @param {object} opts {password, extract=true, maxPayloadBytes=4*1024*1024}
 */
export function mp3stegoDecode(src, opts = {}) {
  const maxPayloadBytes = opts.maxPayloadBytes == null ? 4 * 1024 * 1024 : Number(opts.maxPayloadBytes);
  const extract = opts.extract !== false;
  let bytes;
  try {
    bytes = toBytes(src);
  } catch (e) {
    return fail("MP3STEGO_BAD_INPUT", e.message);
  }
  if (bytes.length < 4 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    if (bytes.length < 2 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) {
      return fail("MP3STEGO_NOT_MP3", "不是 MP3 帧流（缺少 ID3/0xFFEx 同步头）");
    }
  }
  const frames = parseMp3Frames(bytes);
  if (!frames.length) return fail("MP3STEGO_NO_FRAMES", "未找到可解析的 MPEG Layer III 帧");
  const unsupported = frames.find(f => !f.mpeg1);
  if (unsupported) {
    return fail("MP3STEGO_LSF_UNVERIFIED",
      "检测到 MPEG-2/2.5 Layer III（LSF）帧；本实现只验证了 MPEG-1，LSF 暂不支持，不返回成功。请改用本地 mp3stego_Decode.exe 对照");
  }

  const pw = passwordBytes(opts.password);
  const prng = new StegoPrng(pw);
  const bits = [];
  let lData = -1;
  let needBits = 0;
  let candidates = 0;
  let framesUsed = 0;
  let complete = false;

  outer:
  for (const f of frames) {
    framesUsed++;
    for (const part of part2Lengths(bytes, f)) {
      candidates++;
      if (!prng.next()) continue;
      bits.push(part & 1);
      if (bits.length === 32) {
        const hdr = hiddenBitsToBytes(bits, 0, 4);
        lData = (hdr[0] | (hdr[1] << 8) | (hdr[2] << 16) | (hdr[3] << 24)) >>> 0;
        if (lData === 0) return fail("MP3STEGO_EMPTY", "隐藏负载长度为 0（该文件可能未嵌入 MP3Stego 数据）", { frames: framesUsed, candidates });
        if (lData > maxPayloadBytes) {
          return fail("MP3STEGO_PAYLOAD_LIMIT",
            `隐藏负载长度 ${lData} 超过上限 ${maxPayloadBytes}；该文件可能未嵌入 MP3Stego 数据或密码/格式不匹配`,
            { hiddenLength: lData, candidates });
        }
        needBits = 32 + lData * 8;
      }
      if (lData >= 0 && bits.length >= needBits) { complete = true; break outer; }
    }
  }

  const metaBase = { frames: framesUsed, candidates, collectedBits: bits.length, hiddenLength: lData };
  if (!complete) {
    return fail("MP3STEGO_NOT_ENOUGH_BITS",
      `候选位不足：已收集 ${bits.length} bit，需要 ${needBits || 32} bit（载体容量不足或不是 MP3Stego 文件）`, metaBase);
  }

  const body = hiddenBitsToBytes(bits, 32, lData);
  if (!extract) {
    return {
      ok: true, text: "", bytes: body, reason: "",
      meta: { ...metaBase, extract: false, encrypted: true, encryptedBytes: body.length },
    };
  }

  const hashBytes = wordsToLeBytes(sha1Words(pw));
  let plain;
  try {
    plain = tripleDesCbcDecrypt(body, hashBytes.subarray(0, 8), hashBytes.subarray(6, 14), hashBytes.subarray(12, 20));
  } catch (e) {
    return fail("MP3STEGO_3DES_ERROR", "3DES 解密失败：" + e.message, metaBase);
  }
  if (plain.length < 8) return fail("MP3STEGO_3DES_ERROR", "3DES 明文过短", metaBase);
  const rem = plain[plain.length - 1];
  if (rem > 7) {
    return fail("MP3STEGO_BAD_PADDING",
      `3DES 填充非法（末字节 ${rem} > 7）：密码错误或该文件不是 MP3Stego 负载`, metaBase);
  }
  const compressed = plain.slice(0, plain.length - 8 + rem);
  if (compressed.length < 2 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) {
    return fail("MP3STEGO_NOT_GZIP",
      "3DES 解密结果不是 gzip（缺少 1f 8b）：密码错误或该 MP3 未嵌入 MP3Stego 数据；可改用本地 mp3stego_Decode.exe 对照", metaBase);
  }
  let output;
  try {
    output = gunzip(compressed);
  } catch (e) {
    return fail("MP3STEGO_GUNZIP_ERROR",
      "gzip 解压失败：" + e.message + "（密码错误时也会在此失败）", metaBase);
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(output);
  return {
    ok: true,
    text,
    bytes: output,
    reason: "",
    meta: {
      ...metaBase,
      encryptedBytes: body.length,
      compressedBytes: compressed.length,
      textLength: text.length,
      extract: true,
    },
  };
}
