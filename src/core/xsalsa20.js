/*
 * xsalsa20.js — XSalsa20 流密码（cat:'stream'）。
 *
 * 原理（照权威来源，未编造）：
 *  - XSalsa20 是 Salsa20 的「扩展 nonce」版本：把 Salsa20 的 8 字节 nonce 扩到 24 字节。
 *    做法是两步：① 先用 HSalsa20（Salsa20 的「不喂入/不输出状态加法」变体）以密钥与 24 字节
 *    nonce 的**前 16 字节**（连同 sigma 常数）派生出 32 字节子密钥；② 用该子密钥 + nonce 的
 *    **后 8 字节** + 64 位块计数器跑标准 Salsa20/20 PRGA。密文 = 明文 XOR 密钥流（自反）。
 *  - HSalsa20 与 Salsa20 核心的差别：状态布局相同，但 HSalsa20 输出取 8 个字
 *    （第 0、5、10、15、6、7、8、9 字）且**不加回初始状态**，因此是压缩函数而非 PRF 块。
 *  - 该设计使 nonce 空间从 2^64 扩到 2^192，配合 32 字节密钥即可安全地随机生成 nonce。
 *
 * 权威来源：
 *  - Daniel J. Bernstein, "Extending the Salsa20 nonce"（2011-02-04，原论文，
 *    https://cr.yp.to/snuffle/xsalsa-20110204.pdf），访问日期 2026-09-23：XSalsa20 = HSalsa20 派生
 *    子密钥 + Salsa20 的构造定义。
 *  - NaCl（原作者实现，https://nacl.cr.yp.to/stream.html），访问日期 2026-09-23：
 *    crypto_stream_xsalsa20 —— 32 字节密钥、24 字节 nonce、64 位块计数器。
 *  - libsodium（NaCl 的兼容后继实现）官方测试向量，访问日期 2026-09-23：
 *    · test/default/stream3.{c,exp}：firstkey = 1b27556473e985d462cd51197a9a46c76009549eac6474f206c4ee0844f68389，
 *      nonce = 69696ee955b62b73cd62bda875fc73d68219e0036b7a0b37，crypto_stream 前 32 字节 =
 *      eea6a7251c1e72916d11c2cb214d3c252539121d8e234e652d651fa4c8cff880。
 *    · test/default/core4.{c,exp}：crypto_core_salsa20（Salsa20 核心 20 轮）在
 *      k = 01..10 ‖ c9..d8、in = 65..74、c = "expand 32-byte k" 下的 64 字节输出，
 *      用于对拍块函数本体。
 *    · test/default/core3.{c,exp}：以非 cesuffix 递增 4 MiB 核心输出取 SHA-256 的聚合向量
 *      （662b9d0e3463029156069b12f918691a98f7dfb2ca0393c96bbfc6b1fbd630a2），作为块函数的第二锚点。
 *  - 既有 op `salsa20`（modernExt.js）为 Salsa20/20 + 8 字节 nonce；本 op 为 24 字节 nonce 的扩展版，
 *    两者参数面不重叠（nonce 长度不同，互不误用）。
 *
 * 参数与取值（覆盖权威定义的参数面）：
 *  - key / keyEnc：密钥，32 字节（XSalsa20 固定 32 字节；原版 Salsa20 的 16 字节密钥不适用于 XSalsa20）。
 *  - nonce / nonceEnc：24 字节 nonce。
 *  - counter：起始块计数器（64 位，整数 ≥ 0，默认 0）。
 *  - rounds：20/12/8（默认 20）；HSalsa20 与 Salsa20 使用同一轮数。
 *  - outEnc：密文编码（base64 / hex）。
 *
 * 约定：
 *  - 自反：encode 与 decode 为同一变换（XOR 密钥流）。
 *  - 长度/取值不合法时显式报错，不静默截断。
 *
 * 契约：register({id, cat:"stream", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const SIGMA = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]; // "expand 32-byte k"

const rotl = (x, n) => (((x << n) | (x >>> (32 - n))) >>> 0);
const rdU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
function wrU32(b, o, v) {
  b[o] = v & 0xff; b[o + 1] = (v >>> 8) & 0xff; b[o + 2] = (v >>> 16) & 0xff; b[o + 3] = (v >>> 24) & 0xff;
}

/** 轮数归一化：XSalsa20 支持 20/12/8 轮（Salsa20/20、Salsa20/12、Salsa20/8）。 */
function normRounds(rounds) {
  if (rounds == null || rounds === "") return 20;
  const n = Number(rounds);
  if (n !== 20 && n !== 12 && n !== 8) throw new Error(`XSalsa20 rounds 仅支持 20/12/8（当前 ${rounds}）`);
  return n;
}

/** Salsa20 轮函数（每 2 轮一个双轮），返回 16 个字的**原始**结果（不喂回初始状态）。 */
function salsaRounds(state, rounds = 20) {
  const R = normRounds(rounds);
  const x = state.slice();
  for (let i = 0; i < R / 2; i++) {
    x[4]  = (x[4]  ^ rotl((x[0]  + x[12]) >>> 0, 7))  >>> 0;
    x[8]  = (x[8]  ^ rotl((x[4]  + x[0])  >>> 0, 9))  >>> 0;
    x[12] = (x[12] ^ rotl((x[8]  + x[4])  >>> 0, 13)) >>> 0;
    x[0]  = (x[0]  ^ rotl((x[12] + x[8])  >>> 0, 18)) >>> 0;
    x[9]  = (x[9]  ^ rotl((x[5]  + x[1])  >>> 0, 7))  >>> 0;
    x[13] = (x[13] ^ rotl((x[9]  + x[5])  >>> 0, 9))  >>> 0;
    x[1]  = (x[1]  ^ rotl((x[13] + x[9])  >>> 0, 13)) >>> 0;
    x[5]  = (x[5]  ^ rotl((x[1]  + x[13]) >>> 0, 18)) >>> 0;
    x[14] = (x[14] ^ rotl((x[10] + x[6])  >>> 0, 7))  >>> 0;
    x[2]  = (x[2]  ^ rotl((x[14] + x[10]) >>> 0, 9))  >>> 0;
    x[6]  = (x[6]  ^ rotl((x[2]  + x[14]) >>> 0, 13)) >>> 0;
    x[10] = (x[10] ^ rotl((x[6]  + x[2])  >>> 0, 18)) >>> 0;
    x[3]  = (x[3]  ^ rotl((x[15] + x[11]) >>> 0, 7))  >>> 0;
    x[7]  = (x[7]  ^ rotl((x[3]  + x[15]) >>> 0, 9))  >>> 0;
    x[11] = (x[11] ^ rotl((x[7]  + x[3])  >>> 0, 13)) >>> 0;
    x[15] = (x[15] ^ rotl((x[11] + x[7])  >>> 0, 18)) >>> 0;

    x[1]  = (x[1]  ^ rotl((x[0]  + x[3])  >>> 0, 7))  >>> 0;
    x[2]  = (x[2]  ^ rotl((x[1]  + x[0])  >>> 0, 9))  >>> 0;
    x[3]  = (x[3]  ^ rotl((x[2]  + x[1])  >>> 0, 13)) >>> 0;
    x[0]  = (x[0]  ^ rotl((x[3]  + x[2])  >>> 0, 18)) >>> 0;
    x[6]  = (x[6]  ^ rotl((x[5]  + x[4])  >>> 0, 7))  >>> 0;
    x[7]  = (x[7]  ^ rotl((x[6]  + x[5])  >>> 0, 9))  >>> 0;
    x[4]  = (x[4]  ^ rotl((x[7]  + x[6])  >>> 0, 13)) >>> 0;
    x[5]  = (x[5]  ^ rotl((x[4]  + x[7])  >>> 0, 18)) >>> 0;
    x[11] = (x[11] ^ rotl((x[10] + x[9])  >>> 0, 7))  >>> 0;
    x[8]  = (x[8]  ^ rotl((x[11] + x[10]) >>> 0, 9))  >>> 0;
    x[9]  = (x[9]  ^ rotl((x[8]  + x[11]) >>> 0, 13)) >>> 0;
    x[10] = (x[10] ^ rotl((x[9]  + x[8])  >>> 0, 18)) >>> 0;
    x[12] = (x[12] ^ rotl((x[15] + x[14]) >>> 0, 7))  >>> 0;
    x[13] = (x[13] ^ rotl((x[12] + x[15]) >>> 0, 9))  >>> 0;
    x[14] = (x[14] ^ rotl((x[13] + x[12]) >>> 0, 13)) >>> 0;
    x[15] = (x[15] ^ rotl((x[14] + x[13]) >>> 0, 18)) >>> 0;
  }
  return x;
}

/** Salsa20 核心（默认 20 轮），返回 64 字节（x + 初始状态，即带喂回的 PRF 块）。 */
function salsa20Block(state, rounds = 20) {
  const x = salsaRounds(state, rounds);
  const out = new Uint8Array(64);
  for (let i = 0; i < 16; i++) wrU32(out, i * 4, (x[i] + state[i]) >>> 0);
  return out;
}

/** libsodium crypto_core_salsa20 口径：in(16) / key(32) / c(16) → 64 字节核心输出。 */
function salsa20Core(inBytes, keyBytes, constBytes, rounds = 20) {
  const s = new Array(16);
  s[0] = rdU32(constBytes, 0);
  s[1] = rdU32(keyBytes, 0); s[2] = rdU32(keyBytes, 4); s[3] = rdU32(keyBytes, 8); s[4] = rdU32(keyBytes, 12);
  s[5] = rdU32(constBytes, 4);
  s[6] = rdU32(inBytes, 0); s[7] = rdU32(inBytes, 4); s[8] = rdU32(inBytes, 8); s[9] = rdU32(inBytes, 12);
  s[10] = rdU32(constBytes, 8);
  s[11] = rdU32(keyBytes, 16); s[12] = rdU32(keyBytes, 20); s[13] = rdU32(keyBytes, 24); s[14] = rdU32(keyBytes, 28);
  s[15] = rdU32(constBytes, 12);
  return salsa20Block(s, rounds);
}

/** HSalsa20：key(32) + in(16) → 32 字节子密钥（输出 8 个字，不加回初始状态）。 */
function hsalsa20(keyBytes, inBytes, rounds = 20) {
  const s = new Array(16);
  s[0] = SIGMA[0];
  s[1] = rdU32(keyBytes, 0); s[2] = rdU32(keyBytes, 4); s[3] = rdU32(keyBytes, 8); s[4] = rdU32(keyBytes, 12);
  s[5] = SIGMA[1];
  s[6] = rdU32(inBytes, 0); s[7] = rdU32(inBytes, 4); s[8] = rdU32(inBytes, 8); s[9] = rdU32(inBytes, 12);
  s[10] = SIGMA[2];
  s[11] = rdU32(keyBytes, 16); s[12] = rdU32(keyBytes, 20); s[13] = rdU32(keyBytes, 24); s[14] = rdU32(keyBytes, 28);
  s[15] = SIGMA[3];
  const x = salsaRounds(s, rounds);
  const words = [0, 5, 10, 15, 6, 7, 8, 9].map((i) => x[i]);
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) wrU32(out, i * 4, words[i]);
  return out;
}

/** XSalsa20 密钥流（length 字节）。 */
function xsalsa20Keystream(length, key, nonce, counter, rounds = 20) {
  if (key.length !== 32) throw new Error(`XSalsa20：密钥须为 32 字节（当前 ${key.length}）。`);
  if (nonce.length !== 24) throw new Error(`XSalsa20：nonce 须为 24 字节（当前 ${nonce.length}）。`);
  const c = Number(counter);
  if (!Number.isInteger(c) || c < 0) throw new Error(`XSalsa20：计数器须为 ≥0 的整数（当前 ${counter}）。`);
  const R = normRounds(rounds);
  const subkey = hsalsa20(key, nonce.subarray(0, 16), R);
  const s = new Array(16);
  s[0] = SIGMA[0]; s[5] = SIGMA[1]; s[10] = SIGMA[2]; s[15] = SIGMA[3];
  s[1] = rdU32(subkey, 0); s[2] = rdU32(subkey, 4); s[3] = rdU32(subkey, 8); s[4] = rdU32(subkey, 12);
  s[11] = rdU32(subkey, 16); s[12] = rdU32(subkey, 20); s[13] = rdU32(subkey, 24); s[14] = rdU32(subkey, 28);
  s[6] = rdU32(nonce, 16); s[7] = rdU32(nonce, 20);
  s[8] = c >>> 0; s[9] = Math.floor(c / 0x100000000) >>> 0;
  const out = new Uint8Array(length);
  for (let off = 0; off < length; off += 64) {
    const ks = salsa20Block(s, R);
    const n = Math.min(64, length - off);
    for (let j = 0; j < n; j++) out[off + j] = ks[j];
    s[8] = (s[8] + 1) >>> 0;
    if (s[8] === 0) s[9] = (s[9] + 1) >>> 0;
  }
  return out;
}

/** XSalsa20 加解密（自反）。 */
function xsalsa20(data, key, nonce, counter = 0, rounds = 20) {
  const ks = xsalsa20Keystream(data.length, key, nonce, counter, rounds);
  const out = new Uint8Array(data.length);
  for (let k = 0; k < data.length; k++) out[k] = data[k] ^ ks[k];
  return out;
}

// ---- 编解码小工具（自足，无外部依赖） ----
const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));
function hexToBytes(s) {
  const t = String(s == null ? "" : s).replace(/\s+/g, "");
  if (t.length % 2) throw new Error("十六进制串长度须为偶数：" + t.length);
  const o = new Uint8Array(t.length / 2);
  for (let i = 0; i < o.length; i++) {
    const v = parseInt(t.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(v)) throw new Error("非法十六进制字符：" + t.slice(i * 2, i * 2 + 2));
    o[i] = v;
  }
  return o;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function b64ToBytes(s) {
  const t = String(s == null ? "" : s).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t)) throw new Error("非法 Base64 串。");
  const bin = atob(t);
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}
function bytesToB64(b) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function decodeInput(text, enc) {
  switch (enc) {
    case "hex": return hexToBytes(text);
    case "base64": return b64ToBytes(text);
    case "latin1": {
      const s = String(text == null ? "" : text);
      const o = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff;
      return o;
    }
    case "utf8":
    default: return te(text);
  }
}
function encodeOutput(bytes, enc) {
  switch (enc) {
    case "hex": return bytesToHex(bytes);
    case "base64": return bytesToB64(bytes);
    case "latin1": {
      let s = "";
      for (const x of bytes) s += String.fromCharCode(x);
      return s;
    }
    case "utf8":
    default: return td(bytes);
  }
}

const ENC_OPTS = [
  { value: "hex", label: "Hex" },
  { value: "utf8", label: "UTF-8" },
  { value: "base64", label: "Base64" },
  { value: "latin1", label: "Latin-1" },
];
const OUT_OPTS = [
  { value: "base64", label: "Base64" },
  { value: "hex", label: "Hex" },
];

register({
  id: "xsalsa20", cat: "stream", name: "XSalsa20",
  desc: "XSalsa20 流密码（Bernstein「Extending the Salsa20 nonce」）：HSalsa20 派生 32 字节子密钥 + Salsa20，密钥 32 字节、nonce 24 字节、64 位块计数器（自反）。rounds 支持 20/12/8（默认 20；HSalsa20 与 Salsa20 同步降轮）",
  params: [
    { key: "key", label: "密钥", type: "text", default: "", placeholder: "32 字节" },
    { key: "keyEnc", label: "密钥编码", type: "select", default: "hex", options: ENC_OPTS },
    { key: "nonce", label: "Nonce", type: "text", default: "", placeholder: "24 字节" },
    { key: "nonceEnc", label: "Nonce 编码", type: "select", default: "hex", options: ENC_OPTS },
    { key: "counter", label: "初始计数器", type: "number", default: 0 },
    { key: "rounds", label: "轮数", type: "select", default: "20",
      options: [{ value: "20", label: "20" }, { value: "12", label: "12" }, { value: "8", label: "8" }] },
    { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: OUT_OPTS },
  ],
  encode: (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "hex");
    const nonce = decodeInput(p.nonce || "", p.nonceEnc || "hex");
    return encodeOutput(xsalsa20(te(text), key, nonce, Number((p && p.counter) || 0), Number((p && p.rounds) || 20)), p.outEnc || "base64");
  },
  decode: (text, p) => {
    const key = decodeInput(p.key || "", p.keyEnc || "hex");
    const nonce = decodeInput(p.nonce || "", p.nonceEnc || "hex");
    const data = decodeInput(String(text).trim(), p.outEnc || "base64");
    return td(xsalsa20(data, key, nonce, Number((p && p.counter) || 0), Number((p && p.rounds) || 20)));
  },
});

export { xsalsa20, xsalsa20Keystream, hsalsa20, salsa20Block, salsaRounds, salsa20Core, SIGMA, hexToBytes, bytesToHex };
