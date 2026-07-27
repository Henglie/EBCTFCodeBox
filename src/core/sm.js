/*
 * sm.js — 国密补全组（T69）。
 *
 * 覆盖：
 * - ZUC 祖冲之流密码（GM/T 0001-2012，128 位密钥 + 128 位 IV，完整实现）
 * - SM2 加密/签名结构识别（detect，运算需完整 ECC 实现暂不支持）
 * - SM9 标识识别（detect）
 *
 * 算法来源：
 * - ZUC 规格照抄 GM/T 0001-2012 标准，参考 Rust 实现（CSDN anonymous_qsh）
 * 逐行对照移植：S0/S1 盒、D 常量、L1/L2 线性变换、比特重组、非线性函数 F
 * LFSR 初始化/工作模式。S 盒照抄不许编造（见红线）。
 * - SM3 已在 hashExt.js、SM4 已在 modernExt.js，本模块不重复。
 *
 * 红线：
 * - ZUC 标准测试向量必对（GM/T 0001-2012 附录 A 三组向量）。
 * - 零外发：全部本地纯 JS 计算。
 * - 机制四合规：仅新建本文件 + 件内自注册，不碰 main.js import 清单和 i18n 主表。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============================================================
// ZUC 祖冲之序列密码（GM/T 0001-2012）
// ============================================================

// S 盒 S0（照抄标准，不许编造）
const S0 = [
  0x3e,0x72,0x5b,0x47,0xca,0xe0,0x00,0x33,0x04,0xd1,0x54,0x98,0x09,0xb9,0x6d,0xcb,
  0x7b,0x1b,0xf9,0x32,0xaf,0x9d,0x6a,0xa5,0xb8,0x2d,0xfc,0x1d,0x08,0x53,0x03,0x90,
  0x4d,0x4e,0x84,0x99,0xe4,0xce,0xd9,0x91,0xdd,0xb6,0x85,0x48,0x8b,0x29,0x6e,0xac,
  0xcd,0xc1,0xf8,0x1e,0x73,0x43,0x69,0xc6,0xb5,0xbd,0xfd,0x39,0x63,0x20,0xd4,0x38,
  0x76,0x7d,0xb2,0xa7,0xcf,0xed,0x57,0xc5,0xf3,0x2c,0xbb,0x14,0x21,0x06,0x55,0x9b,
  0xe3,0xef,0x5e,0x31,0x4f,0x7f,0x5a,0xa4,0x0d,0x82,0x51,0x49,0x5f,0xba,0x58,0x1c,
  0x4a,0x16,0xd5,0x17,0xa8,0x92,0x24,0x1f,0x8c,0xff,0xd8,0xae,0x2e,0x01,0xd3,0xad,
  0x3b,0x4b,0xda,0x46,0xeb,0xc9,0xde,0x9a,0x8f,0x87,0xd7,0x3a,0x80,0x6f,0x2f,0xc8,
  0xb1,0xb4,0x37,0xf7,0x0a,0x22,0x13,0x28,0x7c,0xcc,0x3c,0x89,0xc7,0xc3,0x96,0x56,
  0x07,0xbf,0x7e,0xf0,0x0b,0x2b,0x97,0x52,0x35,0x41,0x79,0x61,0xa6,0x4c,0x10,0xfe,
  0xbc,0x26,0x95,0x88,0x8a,0xb0,0xa3,0xfb,0xc0,0x18,0x94,0xf2,0xe1,0xe5,0xe9,0x5d,
  0xd0,0xdc,0x11,0x66,0x64,0x5c,0xec,0x59,0x42,0x75,0x12,0xf5,0x74,0x9c,0xaa,0x23,
  0x0e,0x86,0xab,0xbe,0x2a,0x02,0xe7,0x67,0xe6,0x44,0xa2,0x6c,0xc2,0x93,0x9f,0xf1,
  0xf6,0xfa,0x36,0xd2,0x50,0x68,0x9e,0x62,0x71,0x15,0x3d,0xd6,0x40,0xc4,0xe2,0x0f,
  0x8e,0x83,0x77,0x6b,0x25,0x05,0x3f,0x0c,0x30,0xea,0x70,0xb7,0xa1,0xe8,0xa9,0x65,
  0x8d,0x27,0x1a,0xdb,0x81,0xb3,0xa0,0xf4,0x45,0x7a,0x19,0xdf,0xee,0x78,0x34,0x60,
];

// S 盒 S1（照抄标准，不许编造）
const S1 = [
  0x55,0xc2,0x63,0x71,0x3b,0xc8,0x47,0x86,0x9f,0x3c,0xda,0x5b,0x29,0xaa,0xfd,0x77,
  0x8c,0xc5,0x94,0x0c,0xa6,0x1a,0x13,0x00,0xe3,0xa8,0x16,0x72,0x40,0xf9,0xf8,0x42,
  0x44,0x26,0x68,0x96,0x81,0xd9,0x45,0x3e,0x10,0x76,0xc6,0xa7,0x8b,0x39,0x43,0xe1,
  0x3a,0xb5,0x56,0x2a,0xc0,0x6d,0xb3,0x05,0x22,0x66,0xbf,0xdc,0x0b,0xfa,0x62,0x48,
  0xdd,0x20,0x11,0x06,0x36,0xc9,0xc1,0xcf,0xf6,0x27,0x52,0xbb,0x69,0xf5,0xd4,0x87,
  0x7f,0x84,0x4c,0xd2,0x9c,0x57,0xa4,0xbc,0x4f,0x9a,0xdf,0xfe,0xd6,0x8d,0x7a,0xeb,
  0x2b,0x53,0xd8,0x5c,0xa1,0x14,0x17,0xfb,0x23,0xd5,0x7d,0x30,0x67,0x73,0x08,0x09,
  0xee,0xb7,0x70,0x3f,0x61,0xb2,0x19,0x8e,0x4e,0xe5,0x4b,0x93,0x8f,0x5d,0xdb,0xa9,
  0xad,0xf1,0xae,0x2e,0xcb,0x0d,0xfc,0xf4,0x2d,0x46,0x6e,0x1d,0x97,0xe8,0xd1,0xe9,
  0x4d,0x37,0xa5,0x75,0x5e,0x83,0x9e,0xab,0x82,0x9d,0xb9,0x1c,0xe0,0xcd,0x49,0x89,
  0x01,0xb6,0xbd,0x58,0x24,0xa2,0x5f,0x38,0x78,0x99,0x15,0x90,0x50,0xb8,0x95,0xe4,
  0xd0,0x91,0xc7,0xce,0xed,0x0f,0xb4,0x6f,0xa0,0xcc,0xf0,0x02,0x4a,0x79,0xc3,0xde,
  0xa3,0xef,0xea,0x51,0xe6,0x6b,0x18,0xec,0x1b,0x2c,0x80,0xf7,0x74,0xe7,0xff,0x21,
  0x5a,0x6a,0x54,0x1e,0x41,0x31,0x92,0x35,0xc4,0x33,0x07,0x0a,0xba,0x7e,0x0e,0x34,
  0x88,0xb1,0x98,0x7c,0xf3,0x3d,0x60,0x6c,0x7b,0xca,0xd3,0x1f,0x32,0x65,0x04,0x28,
  0x64,0xbe,0x85,0x9b,0x2f,0x59,0x8a,0xd7,0xb0,0x25,0xac,0xaf,0x12,0x03,0xe2,0xf2,
];

// 密钥装入常量 D（照抄标准）
const D = [
  0x44D7,0x26BC,0x626B,0x135E,0x5789,0x35E2,0x7135,0x09AF,
  0x4D78,0x2F13,0x6BC4,0x1AF1,0x5E26,0x3C4D,0x789A,0x47AC,
];

const P = 0x7FFFFFFF; // 2^31 - 1

// 32 位循环左移
function rotl32(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

// L1 线性变换
function L1(x) {
  return (x ^ rotl32(x, 2) ^ rotl32(x, 10) ^ rotl32(x, 18) ^ rotl32(x, 24)) >>> 0;
}

// L2 线性变换
function L2(x) {
  return (x ^ rotl32(x, 8) ^ rotl32(x, 14) ^ rotl32(x, 22) ^ rotl32(x, 30)) >>> 0;
}

// 4 字节拼 32 位
function toU32(a, b, c, d) {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

// mod (2^31 - 1) 加法
function addMod(a, b) {
  const c = (a + b) >>> 0;
  return ((c & 0x7FFFFFFF) + (c >>> 31)) >>> 0;
}

// mod (2^31 - 1) 乘法（用 BigInt 避免溢出）
function mulMod(a, b) {
  return Number((BigInt(a >>> 0) * BigInt(b >>> 0)) % 2147483647n);
}

// ZUC 状态
class ZucState {
  constructor(key, iv) {
 // 密钥装载：s[i] = (k[i] << 23) | (d[i] << 8) | iv[i]
    this.s = new Array(16);
    for (let i = 0; i < 16; i++) {
      this.s[i] = ((key[i] << 23) | (D[i] << 8) | iv[i]) >>> 0;
    }
    this.r1 = 0;
    this.r2 = 0;
    this.x = [0, 0, 0, 0];

 // 初始化阶段：32 轮
    for (let i = 0; i < 32; i++) {
      this.bitReconstruction();
      const w = this.f();
      this.lfsrInitMode(w >>> 1);
    }
 // 丢弃第一个 generate_32bit 的输出
    this.generate32bit();
  }

 // 比特重组
  bitReconstruction() {
    this.x[0] = (((this.s[15] & 0x7FFF8000) << 1) | (this.s[14] & 0xFFFF)) >>> 0;
    this.x[1] = (((this.s[11] & 0xFFFF) << 16) | (this.s[9] >>> 15)) >>> 0;
    this.x[2] = (((this.s[7] & 0xFFFF) << 16) | (this.s[5] >>> 15)) >>> 0;
    this.x[3] = (((this.s[2] & 0xFFFF) << 16) | (this.s[0] >>> 15)) >>> 0;
  }

 // 非线性函数 F
  f() {
    const w = ((this.x[0] ^ this.r1) + this.r2) >>> 0;
    const w1 = (this.r1 + this.x[1]) >>> 0;
    const w2 = (this.r2 ^ this.x[2]) >>> 0;
    const u = L1(((w1 << 16) | (w2 >>> 16)) >>> 0);
    const v = L2(((w2 << 16) | (w1 >>> 16)) >>> 0);
    this.r1 = toU32(
      S0[(u >>> 24) & 0xFF],
      S1[(u >>> 16) & 0xFF],
      S0[(u >>> 8) & 0xFF],
      S1[u & 0xFF]
    );
    this.r2 = toU32(
      S0[(v >>> 24) & 0xFF],
      S1[(v >>> 16) & 0xFF],
      S0[(v >>> 8) & 0xFF],
      S1[v & 0xFF]
    );
    return w;
  }

 // LFSR 初始化模式
  lfsrInitMode(u) {
    let v = this.s[0];
    v = addMod(mulMod(this.s[0], 256), v);
    v = addMod(mulMod(this.s[4], 1048576), v);
    v = addMod(mulMod(this.s[10], 2097152), v);
    v = addMod(mulMod(this.s[13], 131072), v);
    v = addMod(mulMod(this.s[15], 32768), v);
    let s16 = addMod(v, u);
    if (s16 === 0) s16 = 0x7FFFFFFF;
    for (let i = 0; i < 15; i++) this.s[i] = this.s[i + 1];
    this.s[15] = s16;
  }

 // LFSR 工作模式
  lfsrWorkMode() {
    let v = this.s[0];
    v = addMod(mulMod(this.s[0], 256), v);
    v = addMod(mulMod(this.s[4], 1048576), v);
    v = addMod(mulMod(this.s[10], 2097152), v);
    v = addMod(mulMod(this.s[13], 131072), v);
    v = addMod(mulMod(this.s[15], 32768), v);
    let s16 = v;
    if (s16 === 0) s16 = 0x7FFFFFFF;
    for (let i = 0; i < 15; i++) this.s[i] = this.s[i + 1];
    this.s[15] = s16;
  }

 // 生成 32 位密钥字
  generate32bit() {
    this.bitReconstruction();
    const z = (this.f() ^ this.x[3]) >>> 0;
    this.lfsrWorkMode();
    return z;
  }
}

/**
 * ZUC 加密/解密（流密码，自反）。
 * @param {Uint8Array} data 明文或密文
 * @param {Uint8Array} key 16 字节密钥
 * @param {Uint8Array} iv 16 字节 IV
 * @returns {Uint8Array} 密文或明文（与输入等长）
 */
function zucCrypt(data, key, iv) {
  if (key.length !== 16) throw new Error("ZUC 密钥须为 16 字节");
  if (iv.length !== 16) throw new Error("ZUC IV 须为 16 字节");
  const state = new ZucState(key, iv);
  const out = new Uint8Array(data.length);
  let buf = 0; // 缓存的 32 位密钥字
  let bufBits = 0; // buf 中剩余的位数
  for (let i = 0; i < data.length; i++) {
    if (bufBits < 8) {
      buf = state.generate32bit();
      bufBits = 32;
    }
    out[i] = data[i] ^ ((buf >>> 24) & 0xFF);
    buf = (buf << 8) >>> 0;
    bufBits -= 8;
  }
  return out;
}

// ============================================================
// 编码工具（hex / base64 / utf8）
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

// ============================================================
// SM2 / SM9 结构识别（detect）
// ============================================================

/**
 * SM2 密文结构识别。
 * SM2 密文格式：C1 || C3 || C2（旧序）或 C1 || C2 || C3（新序 GMT 0009）
 * C1 = 椭圆曲线点（04 || X(32B) || Y(32B)，65 字节，或非压缩前缀 04）
 * C3 = SM3 哈希（32 字节）
 * C2 = 密文（与明文等长）
 * 识别：hex 解码后长度 >= 97（65+32），且以 04 开头（非压缩点前缀）。
 */
function detectSm2(text) {
  const t = text.trim();
 // 尝试 hex
  const hexClean = t.replace(/[^0-9a-fA-F]/g, "");
  if (hexClean.length >= 194) { // 97 字节 = 194 hex 字符
    if (hexClean.substr(0, 2).toLowerCase() === "04") return 0.7;
  }
 // 尝试 base64
  try {
    const bytes = b64ToBytes(t);
    if (bytes.length >= 97 && bytes[0] === 0x04) return 0.6;
  } catch (e) { /* ignore */ }
  return 0;
}

/**
 * SM9 识别（粗略）。
 * SM9 基于双线性对，密文/签名结构复杂无固定短前缀。
 * 仅识别含 "sm9" 关键字的输入（低置信度）。
 */
function detectSm9(text) {
  const t = text.toLowerCase();
  if (/\bsm9\b/.test(t)) return 0.5;
  return 0;
}

// ============================================================
// register 注册
// ============================================================

const ENC_OPTS = [
  { value: "utf8", label: "UTF-8" },
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
  { value: "latin1", label: "Latin-1" },
];

// 解码输入字节
function decodeInput(s, enc) {
  if (enc === "hex") return hexToBytes(s);
  if (enc === "base64") return b64ToBytes(s);
  if (enc === "latin1") {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xFF;
    return out;
  }
  return te(s); // utf8
}

// 编码输出
function encodeOutput(bytes, enc) {
  if (enc === "hex") return bytesToHex(bytes);
  if (enc === "base64") return bytesToB64(bytes);
  if (enc === "latin1") {
    let s = "";
    for (const x of bytes) s += String.fromCharCode(x);
    return s;
  }
  return td(bytes); // utf8
}

// ZUC op（流密码，encode=decode 自反）
register({
  id: "zuc",
  cat: "modern",
  name: "ZUC 祖冲之",
  desc: "国密流密码（GM/T 0001-2012，128 位密钥+128 位 IV，3GPP LTE 加密标准）",
  params: [
    { key: "key", label: "密钥（hex）", type: "text", default: "00000000000000000000000000000000", placeholder: "16 字节 hex（32 字符）" },
    { key: "iv", label: "IV（hex）", type: "text", default: "00000000000000000000000000000000", placeholder: "16 字节 hex（32 字符）" },
    { key: "dataEnc", label: "数据编码", type: "select", default: "utf8", options: ENC_OPTS },
    { key: "outEnc", label: "输出编码", type: "select", default: "hex", options: ENC_OPTS },
  ],
  encode: (text, p) => {
    const key = hexToBytes(p.key || "00".repeat(16));
    const iv = hexToBytes(p.iv || "00".repeat(16));
    const data = decodeInput(text, p.dataEnc || "utf8");
    return encodeOutput(zucCrypt(data, key, iv), p.outEnc || "hex");
  },
  decode: (text, p) => {
    const key = hexToBytes(p.key || "00".repeat(16));
    const iv = hexToBytes(p.iv || "00".repeat(16));
    const data = decodeInput(text, p.dataEnc || "hex");
    return encodeOutput(zucCrypt(data, key, iv), p.outEnc || "utf8");
  },
  detect: (text) => {
 // ZUC 密文无固定格式特征，不识别
    return 0;
  },
});

// SM2 op（结构识别，运算需完整 ECC 实现暂不支持）
register({
  id: "sm2",
  cat: "modern",
  name: "SM2",
  desc: "国密椭圆曲线公钥密码（GM/T 0003-2012）。结构识别（C1||C3||C2 格式），加解密运算需完整 ECC 实现暂不支持",
  params: [],
  run: (text) => {
    const score = detectSm2(text);
    if (score > 0) {
      return `识别为 SM2 密文（置信度 ${score}）：格式 C1||C3||C2，C1=椭圆曲线点(65B)，C3=SM3(32B)，C2=密文。加解密运算暂不支持。`;
    }
    return "未识别为 SM2 密文（需 hex/base64 格式，长度≥97 字节且以 04 开头）";
  },
  detect: detectSm2,
});

// SM9 op（标识识别）
register({
  id: "sm9",
  cat: "modern",
  name: "SM9",
  desc: "国密标识密码（GM/T 0044-2016）。基于双线性对的标识密码，结构识别仅，运算暂不支持",
  params: [],
  run: (text) => {
    const score = detectSm9(text);
    if (score > 0) {
      return `识别为 SM9 相关输入（置信度 ${score}）。SM9 基于双线性对，运算暂不支持。`;
    }
    return "未识别为 SM9 输入";
  },
  detect: detectSm9,
});
