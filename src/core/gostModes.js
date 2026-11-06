/*
 * gostModes.js — GOST 28147-89 / GOST R 34.12-2015 工作模式与 1989 分组内核。
 *
 * 依据（逐条对照，不编造）：
 * - GOST R 34.13-2015《分组密码算法的工作模式》：
 *   · CTR：nonce 长度为分组一半（Magma 32 位 / Kuznyechik 64 位），
 *     计数器块 = nonce || 0^(n)，对低半部按大端加 1（模 2^n）。
 *   · CBC/CFB/OFB：反馈寄存器可取一个或多个分组（官方附录示例分别用 2/3 个分组），
 *     每处理一个分组，寄存器左移一个分组并把相应值追加到末尾。
 *   · 填充不属于标准规定；本模块复用 modern.js 的统一填充，默认 none。
 * - RFC 5830（GOST 28147-89）：ECB、计数器（гаммирование）、CFB（64 位全块反馈）。
 *   1989 计数器模式使用常量 C1=0x01010104、C2=0x01010101，先对同步向量做 A(S)。
 * - RFC 4357 §2.3.2：CryptoPro key meshing（CP），每 1024 字节：
 *     K' = D_K(C)，IV' = E_{K'}(IV)，C 为 32 字节常量（本文件 GOST_MESH_C）。
 * - RFC 4357 §11.2：id-Gost28147-89-CryptoPro-A-ParamSet 等 1989 S 盒。
 * - 1989 字序：密钥字与分组字均按小端解释（RFC 5830 §4/§5），
 *   与 2015 Magma 的大端字序不同；选择 1989 S 盒时必须同时切换字序。
 *
 * 官方测试向量（GOST R 34.13-2015 附录 A，经 OpenGost / crypto-gost-js 双源核对）：
 *   Magma：
 *     ECB  key ffeeddcc…feff, pt 92def06b…7e41
 *           → 2b073f0494f372a0 de70e715d3556e48 11d8d9e9eacfbc1e 7c68260996c67efb
 *     CTR  iv 12345678 → 4e98110c97b7b93c 3e250d93d6e85d69 …
 *     CBC  iv 1234567890abcdef234567890abcdef134567890abcdef12
 *           → 96d1b05eea683919aff76129abb937b9 …
 *     CFB  iv 1234567890abcdef234567890abcdef1
 *           → db37e0e266903c830d46644c1f9a089c …
 *     OFB  同上 IV → db37e0e266903c830d46644c1f9a089c a0f83062430e327e …
 *   Kuznyechik：
 *     CTR  iv 1234567890abcef0 → f195d8bec10ed1db…
 *     OFB/CBC/CFB 见测试脚本。
 *   1989：
 *     E-Z  key 8182…dfd0, pt 0102030405060708f1f2f3f4f5f6f7f8
 *           → ce5a5ed7e0577a5fd0cc85ce31635b8b
 *
 * 本文件只提供纯字节函数，不注册 op；由 magma.js / kuznyechik.js 调用。
 */
import { padBytes, unpadBytes } from "./modern.js";

// ============================================================
// RFC 4357 §2.3.2 CryptoPro key meshing 常量
// ============================================================
export const GOST_MESH_C = new Uint8Array([
  0x69, 0x00, 0x72, 0x22, 0x64, 0xc9, 0x04, 0x23,
  0x8d, 0x3a, 0xdb, 0x96, 0x46, 0xe9, 0x2a, 0xc4,
  0x18, 0xfe, 0xac, 0x94, 0x00, 0xed, 0x07, 0x12,
  0xc0, 0x86, 0xdc, 0xc2, 0xef, 0x4c, 0xa9, 0x2b,
]);

export function normKeyMeshing(v) {
  const s = String(v == null || v === "" ? "NO" : v).toUpperCase();
  if (s === "NO" || s === "CP") return s;
  throw new Error(`keyMeshing 仅支持 NO/CP（当前 ${v}）`);
}

// ============================================================
// 小端 32 位读写（1989 字序）
// ============================================================
function readU32LE(b, o) {
  return ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0);
}
function writeU32LE(b, o, v) {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
  b[o + 2] = (v >>> 16) & 0xff;
  b[o + 3] = (v >>> 24) & 0xff;
}
function rotl32(x, n) {
  n &= 31;
  if (n === 0) return x >>> 0;
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

// ============================================================
// 1989 S 盒（每表 8×16，按 π0…π7 顺序；半字节 0 = 最低位）
//
// test     = id-GostR3411-94-TestParamSet（RFC 5831 附录；hashMore.js 同源）
// cryptopro= id-GostR3411-94-CryptoProParamSet（pygost / hashMore.js 同源，即 D-A）
// E-A      = id-Gost28147-89-CryptoPro-A-ParamSet（RFC 4357 §11.2）
// E-SC     = SignalCom 参数集（crypto-gost-js E-SC 同源）
// ============================================================
const SBOX_TEST = [
  [4, 10, 9, 2, 13, 8, 0, 14, 6, 11, 1, 12, 7, 15, 5, 3],
  [14, 11, 4, 12, 6, 13, 15, 10, 2, 3, 8, 1, 0, 7, 5, 9],
  [5, 8, 1, 13, 10, 3, 4, 2, 14, 15, 12, 7, 6, 0, 9, 11],
  [7, 13, 10, 1, 0, 8, 9, 15, 14, 4, 6, 12, 11, 2, 5, 3],
  [6, 12, 7, 1, 5, 15, 13, 8, 4, 10, 9, 14, 0, 3, 11, 2],
  [4, 11, 10, 0, 7, 2, 1, 13, 3, 6, 8, 5, 9, 12, 15, 14],
  [13, 11, 4, 1, 3, 15, 5, 9, 0, 10, 14, 7, 6, 8, 2, 12],
  [1, 15, 13, 0, 5, 7, 10, 4, 9, 2, 3, 14, 6, 11, 8, 12],
];
const SBOX_CRYPTOPRO = [
  [10, 4, 5, 6, 8, 1, 3, 7, 13, 12, 14, 0, 9, 2, 11, 15],
  [5, 15, 4, 0, 2, 13, 11, 9, 1, 7, 6, 3, 12, 14, 10, 8],
  [7, 15, 12, 14, 9, 4, 1, 0, 3, 11, 5, 2, 6, 10, 8, 13],
  [4, 10, 7, 12, 0, 15, 2, 8, 14, 1, 6, 5, 13, 11, 9, 3],
  [7, 6, 4, 11, 9, 12, 2, 10, 1, 8, 0, 14, 15, 13, 3, 5],
  [7, 6, 2, 4, 13, 9, 15, 0, 10, 1, 5, 11, 8, 14, 12, 3],
  [13, 14, 4, 1, 7, 0, 5, 10, 3, 12, 8, 15, 6, 2, 9, 11],
  [1, 3, 10, 9, 5, 11, 4, 15, 8, 6, 7, 14, 13, 0, 2, 12],
];
const SBOX_EA = [
  [9, 6, 3, 2, 8, 11, 1, 7, 10, 4, 14, 15, 12, 0, 13, 5],
  [3, 7, 14, 9, 8, 10, 15, 0, 5, 2, 6, 12, 11, 4, 13, 1],
  [14, 4, 6, 2, 11, 3, 13, 8, 12, 15, 5, 10, 0, 7, 1, 9],
  [14, 7, 10, 12, 13, 1, 3, 9, 0, 2, 11, 4, 15, 8, 5, 6],
  [11, 5, 1, 9, 8, 13, 15, 0, 14, 4, 2, 3, 12, 7, 10, 6],
  [3, 10, 13, 12, 1, 2, 0, 11, 7, 5, 9, 4, 8, 15, 14, 6],
  [1, 13, 2, 9, 7, 10, 6, 0, 8, 12, 4, 5, 15, 3, 11, 14],
  [11, 10, 15, 5, 0, 12, 14, 8, 6, 2, 3, 9, 1, 7, 13, 4],
];
const SBOX_ESC = [
  [3, 6, 1, 0, 5, 7, 13, 9, 4, 11, 8, 12, 14, 15, 2, 10],
  [7, 1, 5, 2, 8, 11, 9, 12, 13, 0, 3, 10, 15, 14, 4, 6],
  [15, 1, 4, 6, 12, 8, 9, 2, 14, 3, 7, 10, 11, 13, 5, 0],
  [3, 4, 15, 12, 5, 9, 14, 0, 6, 8, 7, 10, 1, 11, 13, 2],
  [6, 9, 0, 7, 11, 8, 4, 12, 2, 14, 10, 15, 1, 13, 5, 3],
  [6, 1, 2, 15, 0, 11, 9, 12, 7, 13, 10, 5, 8, 4, 14, 3],
  [0, 2, 14, 12, 9, 1, 4, 7, 3, 15, 6, 8, 10, 13, 11, 5],
  [5, 2, 11, 8, 4, 12, 7, 1, 10, 6, 14, 0, 9, 3, 13, 15],
];

const flatSbox = (rows) => Uint8Array.from(rows.flat());

const EXTRA_SBOXES = {
  "E-TEST": Uint8Array.from([4,2,15,5,9,1,0,8,14,3,11,12,13,7,10,6,12,9,15,14,8,1,3,10,2,7,4,13,6,0,11,5,13,8,14,12,7,3,9,10,1,5,2,4,6,15,0,11,14,9,11,2,5,15,7,1,0,13,12,6,10,4,3,8,3,14,5,9,6,8,0,13,10,11,7,12,2,1,15,4,8,15,6,11,1,9,12,5,13,3,7,10,0,14,2,4,9,11,12,0,3,6,7,5,4,8,14,15,1,10,2,13,12,6,5,2,11,0,9,13,3,14,7,10,15,4,1,8]),
  "E-B": Uint8Array.from([8,4,11,1,3,5,0,9,2,14,10,12,13,6,7,15,0,1,2,10,4,13,5,12,9,7,3,15,11,8,6,14,14,12,0,10,9,2,13,11,7,5,8,15,3,6,1,4,7,5,0,13,11,6,1,2,3,10,12,15,4,14,9,8,2,7,12,15,9,5,10,11,1,4,0,13,6,8,14,3,8,3,2,6,4,13,14,11,12,1,7,15,10,0,9,5,5,2,10,11,9,1,12,3,7,4,13,0,6,15,8,14,0,4,11,14,8,3,7,1,10,2,9,6,15,13,5,12]),
  "E-C": Uint8Array.from([1,11,12,2,9,13,0,15,4,5,8,14,10,7,6,3,0,1,7,13,11,4,5,2,8,14,15,12,9,10,6,3,8,2,5,0,4,9,15,10,3,7,12,13,6,14,1,11,3,6,0,1,5,13,10,8,11,2,9,7,14,15,12,4,8,13,11,0,4,5,1,2,9,3,12,14,6,15,10,7,12,9,11,1,8,14,2,4,7,3,6,5,10,0,15,13,10,9,6,8,13,14,2,0,15,3,5,11,4,1,12,7,7,4,0,5,10,2,15,14,12,6,1,11,13,9,3,8]),
  "E-D": Uint8Array.from([15,12,2,10,6,4,5,0,7,9,14,13,1,11,8,3,11,6,3,4,12,15,14,2,7,13,8,0,5,10,9,1,1,12,11,0,15,14,6,5,10,13,4,8,9,3,7,2,1,5,14,12,10,7,0,13,6,2,11,4,9,3,15,8,0,12,8,9,13,2,10,11,7,3,6,5,4,14,15,1,8,0,15,3,2,5,14,11,1,10,4,7,12,9,13,6,3,0,6,15,1,14,9,2,13,8,12,4,11,10,5,7,1,10,6,8,15,11,0,4,12,3,5,9,7,13,2,14]),
  "E-Z": Uint8Array.from([12,4,6,2,10,5,11,9,14,8,13,7,0,3,15,1,6,8,2,3,9,10,5,12,1,14,4,7,11,13,0,15,11,3,5,8,2,15,10,13,14,1,7,4,12,9,6,0,12,8,2,1,13,4,15,6,7,0,10,5,3,14,9,11,7,15,5,10,8,1,6,13,0,9,3,14,11,4,2,12,5,13,15,6,9,2,12,10,11,7,8,1,4,3,14,0,8,14,2,5,6,9,1,12,15,4,11,0,13,10,3,7,1,7,14,13,0,5,8,3,4,15,10,6,9,12,11,2]),
  "D-TEST": Uint8Array.from([4,10,9,2,13,8,0,14,6,11,1,12,7,15,5,3,14,11,4,12,6,13,15,10,2,3,8,1,0,7,5,9,5,8,1,13,10,3,4,2,14,15,12,7,6,0,9,11,7,13,10,1,0,8,9,15,14,4,6,12,11,2,5,3,6,12,7,1,5,15,13,8,4,10,9,14,0,3,11,2,4,11,10,0,7,2,1,13,3,6,8,5,9,12,15,14,13,11,4,1,3,15,5,9,0,10,14,7,6,8,2,12,1,15,13,0,5,7,10,4,9,2,3,14,6,11,8,12]),
  "D-A": Uint8Array.from([10,4,5,6,8,1,3,7,13,12,14,0,9,2,11,15,5,15,4,0,2,13,11,9,1,7,6,3,12,14,10,8,7,15,12,14,9,4,1,0,3,11,5,2,6,10,8,13,4,10,7,12,0,15,2,8,14,1,6,5,13,11,9,3,7,6,4,11,9,12,2,10,1,8,0,14,15,13,3,5,7,6,2,4,13,9,15,0,10,1,5,11,8,14,12,3,13,14,4,1,7,0,5,10,3,12,8,15,6,2,9,11,1,3,10,9,5,11,4,15,8,6,7,14,13,0,2,12]),
  "D-SC": Uint8Array.from([11,13,7,0,5,4,1,15,9,14,6,10,3,12,8,2,1,2,7,9,13,11,15,8,14,12,4,0,5,6,10,3,5,1,13,3,15,6,12,7,9,8,11,2,4,14,0,10,13,1,11,4,9,12,14,0,7,5,8,15,6,2,10,3,2,13,10,15,9,11,3,7,8,12,5,14,6,0,1,4,0,4,6,12,5,3,8,13,10,11,15,2,1,9,7,14,1,3,12,8,10,6,11,0,2,14,7,9,15,4,5,13,10,11,6,0,1,3,4,7,14,13,5,15,8,2,9,12]),
};
export const GOST89_SBOXES = {
  test: flatSbox(SBOX_TEST),
  cryptopro: flatSbox(SBOX_CRYPTOPRO),
  "E-A": flatSbox(SBOX_EA),
  "E-SC": flatSbox(SBOX_ESC),
  ...EXTRA_SBOXES,
};

export function normGost89Sbox(name) {
  const key = String(name == null || name === "" ? "test" : name);
  const sbox = GOST89_SBOXES[key];
  if (!sbox) throw new Error(`未知的 1989 GOST S 盒: ${name}`);
  return sbox;
}

// ============================================================
// 1989 分组内核（小端字序，32 轮 Feistel）
// ============================================================
export function gost89KeySchedule(keyBytes) {
  if (!keyBytes || keyBytes.length !== 32) {
    throw new Error(`GOST 28147-89 密钥须为 256 位（32 字节，当前 ${keyBytes ? keyBytes.length : 0}）`);
  }
  const K = [];
  for (let i = 0; i < 8; i++) K.push(readU32LE(keyBytes, i * 4));
  const rk = [];
  for (let r = 0; r < 24; r++) rk.push(K[r % 8]);
  for (let r = 0; r < 8; r++) rk.push(K[7 - r]);
  return rk;
}

/** 1989 单块加/解密；block 8 字节，schedule 为 gost89KeySchedule 结果。 */
export function gost89CryptBlock(block, schedule, decrypt, sbox) {
  if (sbox.length !== 128) throw new Error("GOST 28147-89 S 盒须为 8×16");
  let m0 = readU32LE(block, 0);
  let m1 = readU32LE(block, 4);
  const order = decrypt ? schedule.slice().reverse() : schedule;
  for (let r = 0; r < 32; r++) {
    const s = (m0 + order[r]) >>> 0;
    let om = 0;
    for (let i = 0; i < 8; i++) om |= sbox[i * 16 + ((s >>> (4 * i)) & 0xf)] << (4 * i);
    const t = (rotl32(om >>> 0, 11) ^ m1) >>> 0;
    m1 = m0;
    m0 = t;
  }
  const out = new Uint8Array(8);
  writeU32LE(out, 0, m1 >>> 0);
  writeU32LE(out, 4, m0 >>> 0);
  return out;
}

export function gost89EncryptBlock(block, schedule, sbox) {
  return gost89CryptBlock(block, schedule, false, sbox);
}
export function gost89DecryptBlock(block, schedule, sbox) {
  return gost89CryptBlock(block, schedule, true, sbox);
}

// ============================================================
// 通用模式
// ============================================================
function xorBlock(a, b, n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = a[i] ^ b[i];
  return out;
}
function incCounterBE(buf, start, end) {
  for (let i = end - 1; i >= start; i--) {
    buf[i] = (buf[i] + 1) & 0xff;
    if (buf[i] !== 0) break;
  }
}
function gamma89Step(state) {
  let w0 = readU32LE(state, 0);
  let w1 = readU32LE(state, 4);
  w0 = (w0 + 0x01010101) >>> 0;
  const tmp = w1 + 0x01010104;
  w1 = (tmp < 0x100000000 ? tmp : tmp - 0xffffffff) >>> 0;
  writeU32LE(state, 0, w0);
  writeU32LE(state, 4, w1);
}
function appendFeedback(state, value, bs) {
  state.copyWithin(0, bs);
  state.set(value, state.length - bs);
}

/**
 * GOST 模式统一入口（纯字节）。
 *
 * @param {object} o
 * @param {string} o.mode ECB/CBC/CFB/OFB/CTR
 * @param {boolean} o.decrypt
 * @param {Uint8Array} o.data
 * @param {number} o.blockSize 8 或 16
 * @param {Uint8Array} [o.iv] CBC/CFB/OFB 为分组整数倍；2015 CTR 为半个分组；1989 CTR 为整个分组
 * @param {string} [o.padding="none"] 统一填充名
 * @param {string} [o.keyMeshing="NO"] NO/CP
 * @param {Uint8Array} o.keyBytes 32 字节
 * @param {(keyBytes:Uint8Array)=>any} o.makeSchedule
 * @param {(block:Uint8Array,schedule:any)=>Uint8Array} o.encryptBlock
 * @param {(block:Uint8Array,schedule:any)=>Uint8Array} o.decryptBlock
 * @param {boolean} [o.gamma89=false] CTR 使用 RFC 5830 计数器模式
 */
export function gostModeCrypt(o) {
  const {
    mode, decrypt, data, blockSize: bs, keyBytes, makeSchedule,
    encryptBlock, decryptBlock, gamma89 = false,
  } = o;
  const padding = o.padding == null || o.padding === "" ? "none" : o.padding;
  const keyMeshing = normKeyMeshing(o.keyMeshing);
  const modeUp = String(mode || "ECB").toUpperCase();
  const modes = new Set(["ECB", "CBC", "CFB", "OFB", "CTR"]);
  if (!modes.has(modeUp)) throw new Error(`不支持的 GOST 模式: ${mode}`);
  if (!data || data.length === 0) throw new Error("输入为空");

  let schedule = makeSchedule(keyBytes);
  const enc = (block) => encryptBlock(block, schedule);
  const dec = (block) => decryptBlock(block, schedule);
  const mesh = (keyMeshing === "CP" && modeUp !== "ECB")
    ? (state) => {
      const newKey = new Uint8Array(32);
      for (let off = 0; off < 32; off += bs) {
        newKey.set(dec(GOST_MESH_C.subarray(off, off + bs)), off);
      }
      schedule = makeSchedule(newKey);
      const copy = state.slice();
      for (let off = 0; off < state.length; off += bs) {
        state.set(enc(copy.subarray(off, off + bs)), off);
      }
    }
    : null;

  if (modeUp === "ECB") {
    if (decrypt) {
      if (data.length % bs !== 0) throw new Error(`密文须为 ${bs} 字节整数倍`);
      const out = new Uint8Array(data.length);
      for (let off = 0; off < data.length; off += bs) {
        out.set(dec(data.subarray(off, off + bs)), off);
      }
      return unpadBytes(out, bs, padding);
    }
    const d = padBytes(data, bs, padding);
    const out = new Uint8Array(d.length);
    for (let off = 0; off < d.length; off += bs) {
      out.set(enc(d.subarray(off, off + bs)), off);
    }
    return out;
  }

  const iv = o.iv instanceof Uint8Array ? o.iv : (o.iv ? Uint8Array.from(o.iv) : null);

  if (modeUp === "CTR") {
    if (gamma89) {
      if (!iv || iv.length !== bs) throw new Error(`GOST 28147-89 CTR 需 ${bs} 字节同步向量（IV）`);
      const state = enc(iv); // A(S)
      const out = new Uint8Array(data.length);
      let processed = 0;
      for (let off = 0; off < data.length; off += bs) {
        gamma89Step(state);
        const ks = enc(state);
        const n = Math.min(bs, data.length - off);
        for (let j = 0; j < n; j++) out[off + j] = data[off + j] ^ ks[j];
        processed += n;
        if (n === bs && mesh && processed % 1024 === 0) mesh(state);
      }
      return out;
    }
    const nonceLen = bs >> 1;
    let nonce;
    if (iv && iv.length === nonceLen) nonce = iv;
    else if (iv && iv.length === bs) nonce = iv.subarray(0, nonceLen);
    else throw new Error(`GOST CTR 需 ${nonceLen} 字节 nonce（或 ${bs} 字节 IV，取前 ${nonceLen} 字节）`);
    const counter = new Uint8Array(bs);
    counter.set(nonce, 0);
    const out = new Uint8Array(data.length);
    let processed = 0;
    for (let off = 0; off < data.length; off += bs) {
      const ks = enc(counter);
      const n = Math.min(bs, data.length - off);
      for (let j = 0; j < n; j++) out[off + j] = data[off + j] ^ ks[j];
      processed += n;
      if (n === bs) {
        incCounterBE(counter, nonceLen, bs);
        if (mesh && processed % 1024 === 0) mesh(counter);
      }
    }
    return out;
  }

  if (!iv || iv.length === 0 || iv.length % bs !== 0) {
    throw new Error(`${modeUp} 需 ${bs} 字节整数倍的 IV（当前 ${iv ? iv.length : 0} 字节）`);
  }
  const state = iv.slice();

  if (modeUp === "CBC") {
    if (decrypt) {
      if (data.length % bs !== 0) throw new Error(`密文须为 ${bs} 字节整数倍`);
      const out = new Uint8Array(data.length);
      let processed = 0;
      for (let off = 0; off < data.length; off += bs) {
        const c = data.subarray(off, off + bs);
        out.set(xorBlock(dec(c), state.subarray(0, bs), bs), off);
        appendFeedback(state, c, bs);
        processed += bs;
        if (mesh && processed % 1024 === 0) mesh(state);
      }
      return unpadBytes(out, bs, padding);
    }
    const d = padBytes(data, bs, padding);
    const out = new Uint8Array(d.length);
    let processed = 0;
    for (let off = 0; off < d.length; off += bs) {
      const c = enc(xorBlock(d.subarray(off, off + bs), state.subarray(0, bs), bs));
      out.set(c, off);
      appendFeedback(state, c, bs);
      processed += bs;
      if (mesh && processed % 1024 === 0) mesh(state);
    }
    return out;
  }

  if (modeUp === "CFB") {
    const out = new Uint8Array(data.length);
    let processed = 0;
    for (let off = 0; off < data.length; off += bs) {
      const ks = enc(state.subarray(0, bs));
      const n = Math.min(bs, data.length - off);
      const c = new Uint8Array(bs);
      if (decrypt) {
        for (let j = 0; j < n; j++) {
          c[j] = data[off + j];
          out[off + j] = data[off + j] ^ ks[j];
        }
      } else {
        for (let j = 0; j < n; j++) {
          c[j] = data[off + j] ^ ks[j];
          out[off + j] = c[j];
        }
      }
      processed += n;
      if (n === bs) {
        appendFeedback(state, c, bs);
        if (mesh && processed % 1024 === 0) mesh(state);
      }
    }
    return out;
  }

  // OFB
  const out = new Uint8Array(data.length);
  let processed = 0;
  for (let off = 0; off < data.length; off += bs) {
    const ks = enc(state.subarray(0, bs));
    const n = Math.min(bs, data.length - off);
    const c = new Uint8Array(bs);
    for (let j = 0; j < n; j++) {
      c[j] = ks[j];
      out[off + j] = data[off + j] ^ ks[j];
    }
    processed += n;
    if (n === bs) {
      appendFeedback(state, c, bs);
      if (mesh && processed % 1024 === 0) mesh(state);
    }
  }
  return out;
}
