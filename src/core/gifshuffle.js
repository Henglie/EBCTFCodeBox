/*
 * gifshuffle.js — GIF 调色板排列隐写（GifShuffle 2.0 兼容，cat:'stegoFile'）。
 *
 * 原理：GIF 全局调色板里颜色条目的「顺序」不影响显示结果——把 n 个唯一颜色按
 * 排列顺序编码成一个 [0, n!-1] 的整数 m，就能在色表里藏约 log2(n!) 位。
 * 256 个唯一颜色 → 最多 1683 位（210 字节）。编码时把 m 的阶乘进制各位
 * 当作插入位置，逐色重建色表；再把画面里每个像素的颜色索引重映射到新色表，
 * 外观逐像素不变。解码反过来从色表顺序还原 m，去掉最高位的哨兵 1 即得位流。
 *
 * 兼容性：与 Matthew Kwan 的 gifshuffle 2.0（公有领域，2003-01-21）双向互通。
 * - 加密：ICE 64 位分组密码，1 位 CFB 模式；口令每字符取低 7 位打包成密钥，
 *   密钥长度决定 ICE level（level = ceil(len*7/64)，上限 128）；口令存在时，
 *   2.0 还会按「颜色密文的字典序」排色表（-1 关闭，退回自然序，兼容 1.0）。
 * - 压缩：内置 Huffman 编码，码表针对英文语料，短消息压得更短。
 * - 透明色、动画、局部色表：透明索引随色表重映射；每帧独立处理；带局部色表的
 *   帧其索引指向局部色表，不参与全局色表重映射。
 *
 * 格式要求：必须有全局色表（作者实现同样硬性要求），否则显式拒绝。
 * 容量为 0（唯一颜色 ≤ 1）或载荷超容量时显式拒绝并给出实测容量。
 *
 * 自检：加载即跑「编码→解码」往返与容量/拒绝边界，失败抛错。
 *
 * 来源与许可：gifshuffle 2.0 作者 Matthew Kwan，公有领域（public domain）。
 * 本文件为纯 JS 重写，不复制作者 C 代码；作者源码内 gif.c 的 GIF 解码/编码部分
 * 分别基于 giftoppm.c（Copyright 1990, David Koblas）与 ppmtogif.c
 * （Copyright (C) 1989 by Jef Poskanzer）的宽松许可声明，在此保留以致意：
 *   - Copyright 1990, David Koblas. Permission to use, copy, modify, and
 *     distribute this software and its documentation for any purpose and
 *     without fee is hereby granted.
 *   - Copyright (C) 1989 by Jef Poskanzer. Permission to use, copy, modify,
 *     and distribute this software and its documentation for any purpose and
 *     without fee is hereby granted.
 *   - The Graphics Interchange Format(c) is the Copyright property of
 *     CompuServe Incorporated. GIF(sm) is a Service Mark property of
 *     CompuServe Incorporated.
 */
import { register } from "./registry.js";

/* ================= 基础工具 ================= */

function b64ToBytes(b64) {
  if (typeof b64 !== "string") throw new Error("需要 base64 字符串输入");
  let s = b64.trim();
  const comma = s.indexOf(",");
  if (comma >= 0 && s.slice(0, 5).toLowerCase().startsWith("data:")) s = s.slice(comma + 1);
  s = s.replace(/\s+/g, "");
  let bin;
  if (typeof atob === "function") bin = atob(s);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(s, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes) {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  if (typeof btoa === "function") return btoa(bin);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new Error("无 btoa/Buffer，无法编码 base64");
}

function hexToBytes(s) {
  const t = String(s).replace(/\s+/g, "");
  if (t.length % 2) throw new Error("hex 长度须为偶数");
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = parseInt(t.substr(i * 2, 2), 16);
    if (Number.isNaN(v)) throw new Error("非法 hex 字符");
    out[i] = v;
  }
  return out;
}

function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s;
}

function utf8ToBytes(s) {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s);
  return new Uint8Array(Buffer.from(String(s), "utf8"));
}

function bytesToUtf8(bytes) {
  if (typeof TextDecoder !== "undefined") return new TextDecoder("utf-8").decode(bytes);
  return Buffer.from(bytes).toString("utf8");
}

function isMostlyPrintable(bytes) {
  if (!bytes.length) return true;
  let ok = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b < 0x7f)) ok++;
    else if (b >= 0x80) ok += 0.5; // 可能的多字节 UTF-8
  }
  return ok / bytes.length > 0.9;
}

/* ================= ICE 分组密码（与作者实现逐位一致） ================= */

const ICE_SMOD = [[333, 313, 505, 369], [379, 375, 319, 391], [361, 445, 451, 397], [397, 425, 395, 505]];
const ICE_SXOR = [[0x83, 0x85, 0x9b, 0xcd], [0xcc, 0xa7, 0xad, 0x41], [0x4b, 0x2e, 0xd4, 0x33], [0xea, 0xcb, 0x2e, 0x04]];
const ICE_PBOX = [
  0x00000001, 0x00000080, 0x00000400, 0x00002000, 0x00080000, 0x00200000, 0x01000000, 0x40000000,
  0x00000008, 0x00000020, 0x00000100, 0x00004000, 0x00010000, 0x00800000, 0x04000000, 0x20000000,
  0x00000004, 0x00000010, 0x00000200, 0x00008000, 0x00020000, 0x00400000, 0x08000000, 0x10000000,
  0x00000002, 0x00000040, 0x00000800, 0x00001000, 0x00040000, 0x00100000, 0x02000000, 0x80000000];
const ICE_KEYROT = [0, 1, 2, 3, 2, 1, 3, 0, 1, 3, 2, 0, 3, 1, 0, 2];

function gfMult(a, b, m) {
  let res = 0;
  a = a >>> 0; b = b >>> 0;
  while (b) {
    if (b & 1) res ^= a;
    a = (a << 1) >>> 0;
    b >>>= 1;
    if (a >= 256) a ^= m;
  }
  return res >>> 0;
}

function gfExp7(b, m) {
  if (b === 0) return 0;
  let x = gfMult(b, b, m);
  x = gfMult(b, x, m);
  x = gfMult(x, x, m);
  return gfMult(b, x, m);
}

function icePerm32(x) {
  let res = 0, idx = 0;
  x = x >>> 0;
  while (x) {
    if (x & 1) res = (res | ICE_PBOX[idx]) >>> 0;
    idx++;
    x >>>= 1;
  }
  return res >>> 0;
}

let ICE_SBOX = null;
function iceSboxesInit() {
  if (ICE_SBOX) return ICE_SBOX;
  const box = [new Uint32Array(1024), new Uint32Array(1024), new Uint32Array(1024), new Uint32Array(1024)];
  for (let i = 0; i < 1024; i++) {
    const col = (i >> 1) & 0xff;
    const row = (i & 1) | ((i & 0x200) >> 8);
    box[0][i] = icePerm32((gfExp7(col ^ ICE_SXOR[0][row], ICE_SMOD[0][row]) << 24) >>> 0);
    box[1][i] = icePerm32((gfExp7(col ^ ICE_SXOR[1][row], ICE_SMOD[1][row]) << 16) >>> 0);
    box[2][i] = icePerm32((gfExp7(col ^ ICE_SXOR[2][row], ICE_SMOD[2][row]) << 8) >>> 0);
    box[3][i] = icePerm32(gfExp7(col ^ ICE_SXOR[3][row], ICE_SMOD[3][row]));
  }
  ICE_SBOX = box;
  return box;
}

function iceF(p, sk) {
  const S = ICE_SBOX;
  const tl = (((p >>> 16) & 0x3ff) | (((p >>> 14) | (p << 18)) & 0xffc00)) >>> 0;
  const tr = ((p & 0x3ff) | ((p << 2) & 0xffc00)) >>> 0;
  let al = (sk[2] & (tl ^ tr)) >>> 0;
  let ar = (al ^ tr) >>> 0;
  al = (al ^ tl) >>> 0;
  al = (al ^ sk[0]) >>> 0;
  ar = (ar ^ sk[1]) >>> 0;
  return (S[0][al >>> 10] | S[1][al & 0x3ff] | S[2][ar >>> 10] | S[3][ar & 0x3ff]) >>> 0;
}

function iceKeySchedBuild(sched, n, kb, keyrot, rotOff) {
  for (let i = 0; i < 8; i++) {
    const kr = keyrot[rotOff + i];
    const isk = sched[n + i];
    isk[0] = isk[1] = isk[2] = 0;
    for (let j = 0; j < 15; j++) {
      const si = j % 3;
      for (let k = 0; k < 4; k++) {
        const ci = (kr + k) & 3;
        const bit = kb[ci] & 1;
        isk[si] = ((isk[si] << 1) | bit) >>> 0;
        kb[ci] = ((kb[ci] >>> 1) | ((bit ^ 1) << 15)) & 0xffff;
      }
    }
  }
}

/** 建一个 ICE 密钥对象：{rounds, sched, iv}。level<1 视作 1。 */
function iceKeyCreate(level) {
  iceSboxesInit();
  const n = level < 1 ? 1 : level;
  const rounds = n * 16;
  const sched = [];
  for (let i = 0; i < rounds; i++) sched.push([0, 0, 0]);
  return { size: n, rounds, sched, iv: new Uint8Array(8) };
}

function iceKeySet(key, k) {
  const rounds = key.rounds;
  const kb = new Uint16Array(4);
  if (rounds === 8) {
    for (let i = 0; i < 4; i++) kb[3 - i] = ((k[i * 2] << 8) | k[i * 2 + 1]) & 0xffff;
    iceKeySchedBuild(key.sched, 0, kb, ICE_KEYROT, 0);
    return;
  }
  for (let i = 0; i < key.size; i++) {
    for (let j = 0; j < 4; j++) kb[3 - j] = ((k[i * 8 + j * 2] << 8) | k[i * 8 + j * 2 + 1]) & 0xffff;
    iceKeySchedBuild(key.sched, i * 8, kb, ICE_KEYROT, 0);
    iceKeySchedBuild(key.sched, rounds - 8 - i * 8, kb, ICE_KEYROT, 8);
  }
}

function iceEncryptBlock(key, ptext, ctext) {
  let l = (((ptext[0] << 24) | (ptext[1] << 16) | (ptext[2] << 8) | ptext[3]) >>> 0);
  let r = (((ptext[4] << 24) | (ptext[5] << 16) | (ptext[6] << 8) | ptext[7]) >>> 0);
  for (let i = 0; i < key.rounds; i += 2) {
    l = (l ^ iceF(r, key.sched[i])) >>> 0;
    r = (r ^ iceF(l, key.sched[i + 1])) >>> 0;
  }
  for (let i = 0; i < 4; i++) {
    ctext[3 - i] = r & 0xff;
    ctext[7 - i] = l & 0xff;
    r >>>= 8;
    l >>>= 8;
  }
}

/** 由口令建 ICE 上下文（含初始 IV）。 */
function iceContextFromPassword(passwd) {
  const s = String(passwd);
  let level = Math.floor((s.length * 7 + 63) / 64);
  if (level === 0) level = 1;
  else if (level > 128) level = 128;
  const key = iceKeyCreate(level);
  const buf = new Uint8Array(1024);
  let i = 0;
  for (let ci = 0; ci < s.length; ci++) {
    const c = s.charCodeAt(ci) & 0x7f;
    const idx = i >> 3;
    const bit = i & 7;
    if (bit === 0) buf[idx] = (c << 1) & 0xff;
    else if (bit === 1) buf[idx] = (buf[idx] | c) & 0xff;
    else {
      buf[idx] = (buf[idx] | (c >> (bit - 1))) & 0xff;
      buf[idx + 1] = (c << (9 - bit)) & 0xff;
    }
    i += 7;
    if (i > 8184) break;
  }
  iceKeySet(key, buf);
  iceEncryptBlock(key, buf.subarray(0, 8), key.iv);
  return key;
}

/** 1 位 CFB：加密一位，返回密文位并推进 IV。 */
function iceCfbEncryptBit(key, bit) {
  const tmp = new Uint8Array(8);
  iceEncryptBlock(key, key.iv, tmp);
  if (tmp[0] & 0x80) bit = bit ? 0 : 1;
  for (let i = 0; i < 8; i++) {
    key.iv[i] = (key.iv[i] << 1) & 0xff;
    if (i < 7 && (key.iv[i + 1] & 0x80)) key.iv[i] |= 1;
  }
  key.iv[7] |= bit;
  return bit;
}

/** 1 位 CFB：解一位（IV 用密文位推进，与加密对称）。 */
function iceCfbDecryptBit(key, bit) {
  const tmp = new Uint8Array(8);
  iceEncryptBlock(key, key.iv, tmp);
  const nbit = (tmp[0] & 0x80) ? (bit ? 0 : 1) : bit;
  for (let i = 0; i < 8; i++) {
    key.iv[i] = (key.iv[i] << 1) & 0xff;
    if (i < 7 && (key.iv[i + 1] & 0x80)) key.iv[i] |= 1;
  }
  key.iv[7] |= bit;
  return nbit;
}

/* ================= 内置 Huffman 压缩（作者英文语料码表） ================= */

const HUFFCODES = [
  "010011101110011001000", "010011101110011001001", "010011101110011001010", "010011101110011001011", "010011101110011001100", "010011101110011001101", "010011101110011001110", "010011101110011001111",
  "101100010101", "0100100", "101101", "010011101110011010000", "0100111011100111", "010011101110011010001", "010011101110011010010", "010011101110011010011",
  "010011101110011010100", "010011101110011010101", "010011101110011010110", "010011101110011010111", "010011101110011011000", "010011101110011011001", "010011101110011011010", "010011101110011011011",
  "010011101110011011100", "010011101110011011101", "010011101110011011110", "010011101110001", "010011101110011011111", "01001110111000000000", "01001110111000000001", "01001110111000000010",
  "111", "0100101000", "101100100", "10111111111", "101111010010", "1011000101000", "0010100010101", "00101011",
  "101111110", "00100011", "010010101", "101111010011", "1010110", "10111110", "101000", "101111001",
  "0010000", "01001011", "101100101", "001010101", "001010011", "1011110111", "1011001100", "0100101001",
  "1010011001", "001010000", "101111000", "10111111110", "01001110110", "10100101010", "10111101000", "1010010100",
  "0010100011", "01001111", "1011110110", "101100011", "101001101", "00100010", "001010010", "1011000000",
  "1011001101", "0111000", "10110000011", "10110001011", "001010100", "101100111", "101001011", "101100001",
  "010011100", "1010011110001", "101001110", "10100100", "10101110", "1011110101", "10100111101", "1011000100",
  "10110000010", "0100111010", "010011101111", "101001111001", "001010001011", "101001010111", "1011000101001", "10111111100",
  "00101000100", "0101", "001001", "110110", "01000", "1100", "101010", "011101",
  "10001", "0011", "1010011111", "0100110", "01111", "101110", "0001", "0110",
  "100001", "10111111101", "11010", "0000", "1001", "110111", "0111001", "001011",
  "10101111", "100000", "1010011000", "1010011110000", "101001010110", "0100111011101", "0010100010100", "01001110111000000011",
  "010011101110000001000", "010011101110000001001", "010011101110000001010", "010011101110000001011", "010011101110000001100", "010011101110000001101", "010011101110000001110", "010011101110000001111",
  "010011101110000010000", "010011101110000010001", "010011101110000010010", "010011101110000010011", "010011101110000010100", "010011101110000010101", "010011101110000010110", "010011101110000010111",
  "010011101110000011000", "010011101110000011001", "010011101110000011010", "010011101110000011011", "010011101110000011100", "010011101110000011101", "010011101110000011110", "010011101110000011111",
  "010011101110000100000", "010011101110000100001", "010011101110000100010", "010011101110000100011", "010011101110000100100", "010011101110000100101", "010011101110000100110", "010011101110000100111",
  "010011101110000101000", "010011101110000101001", "010011101110000101010", "010011101110000101011", "010011101110000101100", "010011101110000101101", "010011101110000101110", "010011101110000101111",
  "010011101110000110000", "010011101110000110001", "010011101110000110010", "010011101110000110011", "010011101110000110100", "010011101110000110101", "010011101110000110110", "010011101110000110111",
  "010011101110000111000", "010011101110000111001", "010011101110000111010", "010011101110000111011", "010011101110000111100", "010011101110000111101", "010011101110000111110", "010011101110000111111",
  "010011101110010000000", "010011101110010000001", "010011101110010000010", "010011101110010000011", "010011101110010000100", "010011101110010000101", "010011101110010000110", "010011101110010000111",
  "010011101110010001000", "010011101110010001001", "010011101110010001010", "010011101110010001011", "010011101110010001100", "010011101110010001101", "010011101110010001110", "010011101110010001111",
  "010011101110010010000", "010011101110010010001", "010011101110010010010", "010011101110010010011", "010011101110010010100", "010011101110010010101", "010011101110010010110", "010011101110010010111",
  "010011101110010011000", "010011101110010011001", "010011101110010011010", "010011101110010011011", "010011101110010011100", "010011101110010011101", "010011101110010011110", "010011101110010011111",
  "010011101110010100000", "010011101110010100001", "010011101110010100010", "010011101110010100011", "010011101110010100100", "010011101110010100101", "010011101110010100110", "010011101110010100111",
  "010011101110010101000", "010011101110010101001", "010011101110010101010", "010011101110010101011", "010011101110010101100", "010011101110010101101", "010011101110010101110", "010011101110010101111",
  "010011101110010110000", "010011101110010110001", "010011101110010110010", "010011101110010110011", "010011101110010110100", "010011101110010110101", "010011101110010110110", "010011101110010110111",
  "010011101110010111000", "010011101110010111001", "010011101110010111010", "010011101110010111011", "010011101110010111100", "010011101110010111101", "010011101110010111110", "010011101110010111111",
  "010011101110011000000", "010011101110011000001", "010011101110011000010", "010011101110011000011", "010011101110011000100", "010011101110011000101", "010011101110011000110", "010011101110011000111",
];

const HUFF_LOOKUP = (() => {
  const m = new Map();
  for (let i = 0; i < 256; i++) m.set(HUFFCODES[i], i);
  return m;
})();

/* ================= GIF 解析 / 写出 ================= */

function parseGif(bytes) {
  if (bytes.length < 13) throw new Error("不是 GIF：文件过短");
  if (!(bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38))
    throw new Error("不是 GIF：魔数非 GIF8");
  const version = String.fromCharCode(bytes[4], bytes[5]);
  const width = bytes[6] | (bytes[7] << 8);
  const height = bytes[8] | (bytes[9] << 8);
  const packed = bytes[10];
  const bg = bytes[11];
  const aspect = bytes[12];
  let pos = 13;
  let gct = null, gctSize = 0;
  if (packed & 0x80) {
    gctSize = 1 << ((packed & 7) + 1);
    if (pos + gctSize * 3 > bytes.length) throw new Error("不是 GIF：全局色表越界");
    gct = bytes.subarray(pos, pos + gctSize * 3);
    pos += gctSize * 3;
  }
  const blocks = [];
  while (pos < bytes.length) {
    const intro = bytes[pos];
    if (intro === 0x3b) break;
    if (intro === 0x21) {
      if (pos + 2 > bytes.length) throw new Error("GIF 扩展块截断");
      const label = bytes[pos + 1];
      pos += 2;
      const chunks = [];
      while (pos < bytes.length) {
        const n = bytes[pos]; pos++;
        if (n === 0) break;
        if (pos + n > bytes.length) throw new Error("GIF 扩展子块截断");
        chunks.push(bytes.subarray(pos, pos + n));
        pos += n;
      }
      blocks.push({ kind: "ext", label, chunks });
    } else if (intro === 0x2c) {
      if (pos + 10 > bytes.length) throw new Error("GIF 图像描述符截断");
      const left = bytes[pos + 1] | (bytes[pos + 2] << 8);
      const top = bytes[pos + 3] | (bytes[pos + 4] << 8);
      const w = bytes[pos + 5] | (bytes[pos + 6] << 8);
      const h = bytes[pos + 7] | (bytes[pos + 8] << 8);
      const ipacked = bytes[pos + 9];
      pos += 10;
      let lct = null, lctSize = 0;
      if (ipacked & 0x80) {
        lctSize = 1 << ((ipacked & 7) + 1);
        if (pos + lctSize * 3 > bytes.length) throw new Error("GIF 局部色表越界");
        lct = bytes.subarray(pos, pos + lctSize * 3);
        pos += lctSize * 3;
      }
      if (pos >= bytes.length) throw new Error("GIF 缺 LZW 最小码长");
      const minCodeSize = bytes[pos]; pos++;
      const dataChunks = [];
      while (pos < bytes.length) {
        const n = bytes[pos]; pos++;
        if (n === 0) break;
        if (pos + n > bytes.length) throw new Error("GIF 图像数据子块截断");
        dataChunks.push(bytes.subarray(pos, pos + n));
        pos += n;
      }
      let total = 0;
      for (const c of dataChunks) total += c.length;
      const data = new Uint8Array(total);
      let off = 0;
      for (const c of dataChunks) { data.set(c, off); off += c.length; }
      blocks.push({ kind: "image", left, top, w, h, packed: ipacked, lct, lctSize, minCodeSize, data });
    } else {
      throw new Error("GIF 未知块引导字节 0x" + intro.toString(16));
    }
  }
  return { version, width, height, packed, bg, aspect, gct, gctSize, blocks };
}

function gifSubBlocks(data) {
  const out = [];
  for (let i = 0; i < data.length; i += 255) {
    const n = Math.min(255, data.length - i);
    out.push(n);
    for (let k = 0; k < n; k++) out.push(data[i + k]);
  }
  out.push(0);
  return out;
}

function writeGif(g) {
  const out = [];
  const pushB = (b) => out.push(b & 0xff);
  pushB(0x47); pushB(0x49); pushB(0x46); pushB(0x38);
  pushB(g.version.charCodeAt(0)); pushB(g.version.charCodeAt(1));
  pushB(g.width & 0xff); pushB((g.width >> 8) & 0xff);
  pushB(g.height & 0xff); pushB((g.height >> 8) & 0xff);
  pushB(g.packed); pushB(g.bg); pushB(g.aspect);
  if (g.gct) for (let i = 0; i < g.gct.length; i++) pushB(g.gct[i]);
  for (const blk of g.blocks) {
    if (blk.kind === "ext") {
      pushB(0x21); pushB(blk.label);
      for (const c of blk.chunks) {
        pushB(c.length);
        for (let i = 0; i < c.length; i++) pushB(c[i]);
      }
      pushB(0);
    } else {
      pushB(0x2c);
      pushB(blk.left & 0xff); pushB((blk.left >> 8) & 0xff);
      pushB(blk.top & 0xff); pushB((blk.top >> 8) & 0xff);
      pushB(blk.w & 0xff); pushB((blk.w >> 8) & 0xff);
      pushB(blk.h & 0xff); pushB((blk.h >> 8) & 0xff);
      pushB(blk.packed);
      if (blk.lct) for (let i = 0; i < blk.lct.length; i++) pushB(blk.lct[i]);
      pushB(blk.minCodeSize);
      const sub = gifSubBlocks(blk.data);
      for (let i = 0; i < sub.length; i++) pushB(sub[i]);
    }
  }
  pushB(0x3b);
  return Uint8Array.from(out);
}

/* ================= GIF LZW ================= */

function lzwDecodeGif(sub, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1, MAX = 4096;
  const prefix = new Int32Array(MAX);
  const suffix = new Uint8Array(MAX);
  const stack = new Uint8Array(MAX + 1);
  let codeSize, next, prev, sp, bitpos;
  const reset = () => {
    for (let i = 0; i < clear; i++) { prefix[i] = -1; suffix[i] = i; }
    for (let i = clear; i < MAX; i++) { prefix[i] = -1; suffix[i] = 0; }
    codeSize = minCodeSize + 1; next = eoi + 1; prev = -1; sp = 0;
  };
  reset();
  bitpos = 0;
  const nbits = sub.length * 8;
  const out = [];
  let firstCode = -1;
  while (bitpos + codeSize <= nbits) {
    let code = 0;
    for (let k = 0; k < codeSize; k++) code |= (((sub[(bitpos + k) >> 3] >> ((bitpos + k) & 7)) & 1) << k);
    bitpos += codeSize;
    if (code === clear) { reset(); firstCode = -1; continue; }
    if (code === eoi) break;
    if (prev === -1) { out.push(code); firstCode = code; prev = code; continue; }
    let incode = code;
    if (code >= next) { stack[sp++] = firstCode; code = prev; }
    while (code >= clear) {
      if (prefix[code] < 0) throw new Error("GIF LZW 字典损坏");
      stack[sp++] = suffix[code];
      code = prefix[code];
    }
    firstCode = suffix[code];
    stack[sp++] = firstCode;
    if (next < MAX) {
      prefix[next] = prev; suffix[next] = firstCode; next++;
      if (next === (1 << codeSize) && codeSize < 12) codeSize++;
    }
    while (sp > 0) out.push(stack[--sp]);
    prev = incode;
  }
  return out;
}

function lzwEncodeGif(indices, minCodeSize) {
  const clear = 1 << minCodeSize, eoi = clear + 1;
  let dict = new Map();
  let codeSize = minCodeSize + 1, next = eoi + 1;
  const out = [];
  let bitBuf = 0, bitCnt = 0;
  const emit = (code, size) => {
    bitBuf |= code << bitCnt; bitCnt += size;
    while (bitCnt >= 8) { out.push(bitBuf & 0xff); bitBuf >>>= 8; bitCnt -= 8; }
  };
  // 字典只存「前缀码 + 字符」的组合键；字面量码 (0..clear-1) 直接用其自身值作 ent，
  // 不入字典，避免 (ent<<8)|c 与字面量码相撞（ent=0 时 key 会等于 c）。
  const resetDict = () => {
    dict = new Map();
    next = eoi + 1; codeSize = minCodeSize + 1;
  };
  resetDict();
  emit(clear, codeSize);
  let ent = indices[0];
  for (let k = 1; k < indices.length; k++) {
    const c = indices[k];
    const key = (ent << 8) | c;
    const v = dict.get(key);
    if (v !== undefined) { ent = v; continue; }
    emit(ent, codeSize);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << codeSize) && codeSize < 12) codeSize++;
    } else {
      emit(clear, codeSize);
      resetDict();
    }
    ent = c;
  }
  emit(ent, codeSize);
  emit(eoi, codeSize);
  if (bitCnt > 0) out.push(bitBuf & 0xff);
  return Uint8Array.from(out);
}

/* ================= 调色板排列编解码（阶乘进制） ================= */

function rgbVal(c) { return ((c[0] << 16) | (c[1] << 8) | c[2]) >>> 0; }

function sameRgb(a, b) { return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]; }

/** 取唯一颜色；重复色从数组尾部倒序填入（与作者 unique_colours 一致）。 */
function uniqueColours(cols, ncols) {
  const ci = new Array(ncols);
  let n = 0, top = 0;
  for (let i = 0; i < ncols; i++) {
    let unique = true;
    for (let j = 0; j < i; j++) if (sameRgb(cols[i], cols[j])) { unique = false; break; }
    if (unique) ci[n++] = cols[i];
    else ci[ncols - (++top)] = cols[i];
  }
  return { ci, n };
}

function factorial(n) {
  let f = 1n;
  for (let i = 2n; i <= BigInt(n); i++) f *= i;
  return f;
}

/** 由色表颜色数组（每项 [r,g,b]）还原位流 m（BigInt）。 */
function colourmapDecode(cols, ncols, ice) {
  const { ci, n } = uniqueColours(cols, ncols);
  const items = ci.slice(0, n).map((c, i) => ({ c, pos: i }));
  if (ice) {
    for (const it of items) {
      const p = new Uint8Array(8); p[0] = it.c[0]; p[1] = it.c[1]; p[2] = it.c[2];
      const ct = new Uint8Array(8);
      iceEncryptBlock(ice, p, ct);
      it.ct = ct;
    }
    items.sort((a, b) => {
      for (let i = 0; i < 8; i++) if (a.ct[i] !== b.ct[i]) return a.ct[i] - b.ct[i];
      return 0;
    });
  } else {
    items.sort((a, b) => rgbVal(a.c) - rgbVal(b.c));
  }
  let m = 0n;
  for (let i = 0; i < n - 1; i++) {
    const pos = items[i].pos;
    m = m * BigInt(n - i) + BigInt(pos);
    for (let j = i + 1; j < n; j++) if (items[j].pos > pos) items[j].pos--;
  }
  return m;
}

/** 由 m 生成新的色表（长度 ncols）。 */
function colourmapEncode(cols, ncols, m, ice) {
  const { ci, n } = uniqueColours(cols, ncols);
  const items = ci.slice(0, n).map((c) => ({ c }));
  if (ice) {
    for (const it of items) {
      const p = new Uint8Array(8); p[0] = it.c[0]; p[1] = it.c[1]; p[2] = it.c[2];
      const ct = new Uint8Array(8);
      iceEncryptBlock(ice, p, ct);
      it.ct = ct;
    }
    items.sort((a, b) => {
      for (let i = 0; i < 8; i++) if (a.ct[i] !== b.ct[i]) return a.ct[i] - b.ct[i];
      return 0;
    });
  } else {
    items.sort((a, b) => rgbVal(a.c) - rgbVal(b.c));
  }
  let mm = m;
  for (let i = 0; i < n; i++) {
    items[n - 1 - i].pos = Number(mm % BigInt(i + 1));
    mm = mm / BigInt(i + 1);
  }
  if (mm !== 0n) throw new Error("gifshuffle：阶乘进制仍有余数（内部错误）");
  const out = new Array(ncols);
  let i = 0;
  for (; i < n; i++) {
    const it = items[n - 1 - i];
    const pos = it.pos;
    for (let j = i; j > pos; j--) out[j] = out[j - 1];
    out[pos] = it.c;
  }
  for (; i < ncols; i++) out[i] = cols[ncols - 1];
  return out;
}

/* ================= 位流管道（压缩 + 加密） ================= */

/** 由 opts.password 建 ICE 上下文；password 为 null/undefined 表示不加密（空串是合法口令）。 */
function iceFromOpts(opts) {
  return opts.password != null ? iceContextFromPassword(String(opts.password)) : null;
}

/** 消息字节 → 位数组（含压缩、加密）。 */
function messageToBits(msgBytes, opts) {
  const ice = iceFromOpts(opts);
  const bits = [];
  const emit = (bit) => {
    if (ice) bit = iceCfbEncryptBit(ice, bit);
    bits.push(bit);
  };
  if (opts.compress) {
    let acc = 0, cnt = 0;
    for (let i = 0; i < msgBytes.length; i++) {
      const byte = msgBytes[i];
      for (let k = 0; k < 8; k++) {
        acc = ((acc << 1) | ((byte >> (7 - k)) & 1)) & 0xff;
        if (++cnt === 8) {
          const code = HUFFCODES[acc];
          for (let t = 0; t < code.length; t++) emit(code.charCodeAt(t) === 49 ? 1 : 0);
          acc = 0; cnt = 0;
        }
      }
    }
    // 残位（不足 8 位）按作者行为丢弃
  } else {
    for (let i = 0; i < msgBytes.length; i++) {
      const byte = msgBytes[i];
      for (let k = 0; k < 8; k++) emit((byte >> (7 - k)) & 1);
    }
  }
  return bits;
}

/** 位数组 → 消息字节（解密 + 解压），返回 Uint8Array。 */
function bitsToMessage(bits, opts) {
  const ice = iceFromOpts(opts);
  const outBits = [];
  let cur = "";
  for (let i = 0; i < bits.length; i++) {
    let bit = bits[i];
    if (ice) bit = iceCfbDecryptBit(ice, bit);
    if (opts.compress) {
      cur += bit ? "1" : "0";
      const code = HUFF_LOOKUP.get(cur);
      if (code !== undefined) {
        for (let k = 0; k < 8; k++) outBits.push((code >> (7 - k)) & 1);
        cur = "";
      } else if (cur.length >= 255) {
        throw new Error("gifshuffle：Huffman 解压缓冲溢出（口令或压缩参数可能不对）");
      }
    } else {
      outBits.push(bit);
    }
  }
  const n = outBits.length - (outBits.length % 8);
  const out = new Uint8Array(n / 8);
  for (let i = 0; i < n; i += 8) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | outBits[i + k];
    out[i / 8] = b;
  }
  return out;
}

/* ================= 顶层 API ================= */

function requireGct(g) {
  if (!g.gct || !g.gctSize) throw new Error("不支持的 GIF：缺少全局调色板（作者实现同样要求全局色表）");
}

/** 返回 {bits, bytes, uniqueColors, paletteEntries}。 */
function gifshuffleCapacity(bytes) {
  const g = parseGif(bytes);
  requireGct(g);
  const cols = [];
  for (let i = 0; i < g.gctSize; i++) cols.push([g.gct[i * 3], g.gct[i * 3 + 1], g.gct[i * 3 + 2]]);
  const { n } = uniqueColours(cols, g.gctSize);
  let maxM = 1n;
  for (let i = 2; i <= n; i++) maxM *= BigInt(i);
  maxM -= 1n;
  const bits = maxM === 0n ? 0 : (maxM.toString(2).length - 1);
  return { bits, bytes: Math.floor(bits / 8), uniqueColors: n, paletteEntries: g.gctSize };
}

/**
 * 把 messageBytes 藏进 GIF。
 * @param {Uint8Array} bytes 封面 GIF 原始字节
 * @param {Uint8Array} messageBytes 载荷
 * @param {{password?:string, compress?:boolean, v1?:boolean}} opts
 * @returns {Uint8Array} 隐写后的 GIF
 */
function gifshuffleEmbed(bytes, messageBytes, opts) {
  opts = opts || {};
  const g = parseGif(bytes);
  requireGct(g);
  const ncols = g.gctSize;
  const cols = [];
  for (let i = 0; i < ncols; i++) cols.push([g.gct[i * 3], g.gct[i * 3 + 1], g.gct[i * 3 + 2]]);

  const bits = messageToBits(messageBytes, opts);
  const L = bits.length;
  let m = 1n << BigInt(L); // 前置哨兵 1（在最高位，作者 encode_flush 行为）
  for (let i = 0; i < L; i++) if (bits[i]) m += (1n << BigInt(i));

  const { n } = uniqueColours(cols, ncols);
  let maxM = 1n;
  for (let i = 2; i <= n; i++) maxM *= BigInt(i);
  maxM -= 1n;
  const maxBits = maxM === 0n ? 0 : maxM.toString(2).length;
  if (L + 1 > maxBits || m > maxM) {
    if (maxBits <= 1) throw new Error("gifshuffle：该 GIF 无可用容量（唯一颜色不足）");
    const pct = ((L + 1) / (maxBits - 1) - 1) * 100;
    throw new Error(`gifshuffle：载荷超出容量约 ${pct.toFixed(2)}%（容量 ${maxBits - 1} 位，需要 ${L + 1} 位）`);
  }

  const ice = iceFromOpts(opts);
  const paletteIce = opts.v1 ? null : ice;

  const newCols = colourmapEncode(cols, ncols, m, paletteIce);

  // 旧索引 → 新索引（重复色取新表首次出现，与作者一致）
  const cidx = new Array(ncols);
  for (let i = 0; i < ncols; i++) {
    const orig = cols[i];
    let j = 0;
    for (; j < ncols; j++) if (sameRgb(orig, newCols[j])) { cidx[i] = j; break; }
  }

  const outG = {
    version: g.version, width: g.width, height: g.height,
    packed: g.packed, bg: cidx[g.bg], aspect: g.aspect,
    gct: new Uint8Array(ncols * 3), blocks: [],
  };
  for (let i = 0; i < ncols; i++) {
    outG.gct[i * 3] = newCols[i][0];
    outG.gct[i * 3 + 1] = newCols[i][1];
    outG.gct[i * 3 + 2] = newCols[i][2];
  }

  for (const blk of g.blocks) {
    if (blk.kind === "ext") {
      if (blk.label === 0xf9 && blk.chunks.length && blk.chunks[0].length >= 4) {
        const d = Uint8Array.from(blk.chunks[0]);
        if (d[0] & 1) d[3] = cidx[d[3]]; // 透明索引重映射
        outG.blocks.push({ kind: "ext", label: 0xf9, chunks: [d].concat(blk.chunks.slice(1)) });
      } else {
        outG.blocks.push({ kind: "ext", label: blk.label, chunks: blk.chunks.slice() });
      }
    } else {
      if (blk.lct) {
        // 带局部色表的帧：索引指向局部色表，整体原样透传
        outG.blocks.push({
          kind: "image", left: blk.left, top: blk.top, w: blk.w, h: blk.h,
          packed: blk.packed, lct: blk.lct, lctSize: blk.lctSize,
          minCodeSize: blk.minCodeSize, data: blk.data,
        });
      } else {
        const idx = lzwDecodeGif(blk.data, blk.minCodeSize);
        const expect = blk.w * blk.h;
        if (idx.length < expect) throw new Error("gifshuffle：图像数据不完整，无法重映射");
        const remapped = new Array(idx.length);
        for (let i = 0; i < idx.length; i++) remapped[i] = cidx[idx[i]] & 0xff;
        outG.blocks.push({
          kind: "image", left: blk.left, top: blk.top, w: blk.w, h: blk.h,
          packed: blk.packed, lct: null, lctSize: 0,
          minCodeSize: blk.minCodeSize,
          data: lzwEncodeGif(remapped, blk.minCodeSize),
        });
      }
    }
  }
  return writeGif(outG);
}

/**
 * 从 GIF 中提取载荷。
 * @returns {Uint8Array}
 */
function gifshuffleExtract(bytes, opts) {
  opts = opts || {};
  const g = parseGif(bytes);
  requireGct(g);
  const ncols = g.gctSize;
  const cols = [];
  for (let i = 0; i < ncols; i++) cols.push([g.gct[i * 3], g.gct[i * 3 + 1], g.gct[i * 3 + 2]]);
  const ice = iceFromOpts(opts);
  const paletteIce = opts.v1 ? null : ice;
  const m = colourmapDecode(cols, ncols, paletteIce);
  const highBit = m === 0n ? 0 : m.toString(2).length;
  const bits = [];
  for (let i = 0; i < highBit - 1; i++) bits.push(Number((m >> BigInt(i)) & 1n));
  return bitsToMessage(bits, opts);
}

/* ================= op 适配 ================= */

const LEGACY_ENC_DEFAULTS = { inputEnc: "auto", msgEnc: "text", outEnc: "auto" };

/** 旧参数兼容：这些 A 类参数已由输入/输出视图接管；显式非默认值拒绝，默认值静默忽略。 */
function assertNoLegacyEnc(p) {
  for (const [key, def] of Object.entries(LEGACY_ENC_DEFAULTS)) {
    const v = p && p[key];
    if (v != null && String(v).toLowerCase() !== def) {
      throw new Error(`${key} 该参数已废弃，请改用输入视图`);
    }
  }
}

function pickInputBytes(text, p) {
  assertNoLegacyEnc(p);
  if (p && p.rawBytes && p.rawBytes.length) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  }
  const s = String(text || "");
  // auto：dataURL / base64 优先，失败再试 hex
  try { return b64ToBytes(s); } catch (e) {
    try { return hexToBytes(s); } catch (e2) { throw new Error("无法解析封面 GIF 输入（需要拖入文件或 base64/hex）"); }
  }
}

function messageBytesFromParam(p) {
  const s = (p && p.message) != null ? String(p.message) : "";
  return utf8ToBytes(s);
}

function gifshuffleEncodeOp(text, p) {
  p = p || {};
  const bytes = pickInputBytes(text, p);
  const msg = messageBytesFromParam(p);
  const out = gifshuffleEmbed(bytes, msg, {
    password: p.password != null && p.password !== "" ? p.password : undefined,
    compress: !!p.compress,
    v1: !!p.v1,
  });
  const cap = gifshuffleCapacity(bytes);
  const report =
    `GifShuffle 嵌入完成\n` +
    `封面：${bytes.length} 字节，调色板 ${cap.paletteEntries} 项 / 唯一 ${cap.uniqueColors} 色，容量 ${cap.bits} 位（${cap.bytes} 字节）\n` +
    `载荷：${msg.length} 字节${p.compress ? "（已 Huffman 压缩）" : ""}${p.password ? "（已 ICE 加密）" : ""}\n` +
    `产物：${out.length} 字节 GIF（外观逐像素不变）`;
  return {
    text: report + "\n\ndata:image/gif;base64," + bytesToB64(out),
    files: [{ name: "gifshuffle_out.gif", mime: "image/gif", bytes: out }],
  };
}

function gifshuffleDecodeOp(text, p) {
  p = p || {};
  const bytes = pickInputBytes(text, p);
  const msg = gifshuffleExtract(bytes, {
    password: p.password != null && p.password !== "" ? p.password : undefined,
    compress: !!p.compress,
    v1: !!p.v1,
  });
  const shown = isMostlyPrintable(msg) ? bytesToUtf8(msg) : bytesToHex(msg);
  const report =
    `GifShuffle 提取：${msg.length} 字节${p.compress ? "（Huffman 解压）" : ""}${p.password ? "（ICE 解密）" : ""}\n` +
    `（口令错误不会报错，只会得到乱码；长度/内容异常时请核对口令与压缩开关）\n\n`;
  return {
    text: report + shown,
    files: [{ name: "gifshuffle_msg.bin", mime: "application/octet-stream", bytes: msg }],
  };
}

/* ================= 加载期自检 ================= */

function makeTestGif() {
  const cols = [];
  for (let i = 0; i < 256; i++) cols.push([(i * 7) & 0xff, (i * 13) & 0xff, (i * 29) & 0xff]);
  const idx = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) idx.push((x + y * 16) & 0xff);
  const g = {
    version: "89a", width: 16, height: 16, packed: 0x80 | (7 << 4) | 7, bg: 0, aspect: 0,
    gct: new Uint8Array(768), blocks: [{
      kind: "image", left: 0, top: 0, w: 16, h: 16, packed: 0, lct: null, lctSize: 0,
      minCodeSize: 8, data: lzwEncodeGif(idx, 8),
    }],
  };
  for (let i = 0; i < 256; i++) { g.gct[i * 3] = cols[i][0]; g.gct[i * 3 + 1] = cols[i][1]; g.gct[i * 3 + 2] = cols[i][2]; }
  return writeGif(g);
}

(() => {
  const cover = makeTestGif();
  const cap = gifshuffleCapacity(cover);
  if (cap.uniqueColors !== 256 || cap.bits !== 1683) {
    throw new Error(`gifshuffle 自检①失败：256 色容量应为 1683 位，实际 ${cap.uniqueColors}/${cap.bits}`);
  }
  const msg = utf8ToBytes("Hello, GifShuffle!");
  const stego = gifshuffleEmbed(cover, msg, {});
  const back = gifshuffleExtract(stego, {});
  if (bytesToUtf8(back) !== "Hello, GifShuffle!") {
    throw new Error(`gifshuffle 自检②失败：往返失真，得 "${bytesToUtf8(back)}"`);
  }
  // 加密 + 压缩
  const stego2 = gifshuffleEmbed(cover, msg, { password: "s3cret", compress: true });
  const back2 = gifshuffleExtract(stego2, { password: "s3cret", compress: true });
  if (bytesToUtf8(back2) !== "Hello, GifShuffle!") {
    throw new Error(`gifshuffle 自检③失败：加密压缩往返失真，得 "${bytesToUtf8(back2)}"`);
  }
  // 超容量拒绝
  let threw = false;
  try { gifshuffleEmbed(makeTestGif(), new Uint8Array(400), {}); } catch (e) { threw = true; }
  if (!threw) throw new Error("gifshuffle 自检④失败：超容量未拒绝");
  // 缺全局色表拒绝
  threw = false;
  try {
    const bad = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 4, 0, 4, 0, 0, 0, 0, 0x3b]);
    gifshuffleExtract(bad, {});
  } catch (e) { threw = true; }
  if (!threw) throw new Error("gifshuffle 自检⑤失败：缺全局色表未拒绝");
})();

/* ================= register ================= */

register({
  id: "gifshuffle", family: "gif", familyLabel: "shuffle", cat: "stegoFile", name: "GifShuffle 调色板隐写",
  desc: "通过重排 GIF 全局调色板条目顺序藏比特（外观逐像素不变）；兼容 gifshuffle 2.0 的 ICE 加密与内置 Huffman 压缩，支持透明色/动画/局部色表",
  params: [
    { key: "message", label: "待嵌入文本（编码时用）", type: "text", default: "" },
    { sensitive: true, key: "password", label: "口令（可选，ICE 加密）", type: "password", default: "" },
    { key: "compress", label: "使用内置 Huffman 压缩", type: "bool", default: false },
    { key: "v1", label: "兼容 1.0 排序（口令下仍用自然序排色表）", type: "bool", default: false },
  ],
  aka: [
    "gifshuffle", "GifShuffle", "gif shuffle", "调色板隐写", "GIF调色板隐写",
    "调色板排列隐写", "palette steganography", "Matthew Kwan", "gif隐写",
    "GIF colourmap stego", "调色板顺序隐写", "gifshuffle 2.0",
  ],
  encode: gifshuffleEncodeOp,
  decode: gifshuffleDecodeOp,
  acceptsBytes: true,
});

export {
  gifshuffleEmbed,
  gifshuffleExtract,
  gifshuffleCapacity,
  parseGif,
  writeGif,
  lzwDecodeGif,
  lzwEncodeGif,
  colourmapEncode,
  colourmapDecode,
  uniqueColours,
  iceContextFromPassword,
  iceEncryptBlock,
  iceCfbEncryptBit,
  iceCfbDecryptBit,
  messageToBits,
  bitsToMessage,
  makeTestGif,
  bytesToB64,
  b64ToBytes,
  utf8ToBytes,
  bytesToUtf8,
  bytesToHex,
  hexToBytes,
};
