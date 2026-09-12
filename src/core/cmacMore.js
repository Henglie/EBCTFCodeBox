/*
 * cmacMore.js — CMAC 扩展（cat:'hash'，单 run）。T374 批A，件内自注册。
 *
 * op：
 *   - cmacExt   CMAC(K, M) 通用消息认证码，底层分组密码可选：
 *               128 位分组（Rb=0x87，RFC 4493 子密钥结构）：
 *                 camellia（Camellia，RFC 3713）、seed（SEED，RFC 4269）、
 *                 twofish（Twofish，Schneier 1998）、rc6（RC6，RFC 2268？见下）
 *               64 位分组（Rb=0x1B，ISO/IEC 9797-1 结构）：
 *                 idea（IDEA，Lai 1991）、blowfish（Blowfish，Schneier 1993）、
 *                 cast5（CAST-128，RFC 2144）
 *
 * 复用（import，勿复制）：
 *   - camellia.js  camelliaEncode   — 单块/多块加密（RFC 3713）
 *   - seed.js       seedEncode       — 单块/多块加密（RFC 4269）
 *   - modernExt2.js idea/blowfish/rc6/cast5/twofish 的 KeySchedule + EncryptBlock
 *     （单块函数，块大小 8 或 16）
 *
 * 子密钥/结构：与 cmac.js（RFC 4493 CMAC）同构——
 *   L = CIPH_K(0^bs)；K1 = L<<1(⊕Rb)；K2 = K1<<1(⊕Rb)；MBDW = pad10* 分块处理。
 *   128 位块 Rb=0x87（x^128+x^7+x^2+x+1）；64 位块 Rb=0x1B（x^64+x^4+x^3+x+1）。
 *
 * KAT 背书（每条逐字）：
 *   128 位块 — Camellia：RFC 3713 附录 C 单块向量（key=0123...3210 → 67673138 54966973 08570656 48eabe43）
 *             ；SEED：RFC 4269 附录 B 三组向量；Twofish：botan twofish.vec；RC6：RC6 提交稿零密钥向量。
 *   64 位块 — IDEA：botan idea.vec；Blowfish：botan blowfish.vec；CAST-128：RFC 2144 附录 A。
 *   CMAC 结构本身由 cmac.js 的 AES-CMAC 过 RFC 4493 §4 全部四组向量背书。
 *   无直接『算法+CMAC』官方 KAT 的，采用「单块 KAT + RFC 4493/9797-1 结构等价」双背书（注释见各 alg 名）。
 *
 * 红线：算法层零 UI 依赖（仅 registry）；件内自注册；不碰 main.js / registerAll.js / i18n 主表。
 */
import { register } from "./registry.js";
import { camelliaEncode } from "./camellia.js";
import { seedEncode } from "./seed.js";
import {
  ideaKeySchedule, ideaEncryptBlock,
  blowfishKeySchedule, blowfishEncryptBlock,
  rc6KeySchedule, rc6EncryptBlock,
  cast5KeySchedule, cast5EncryptBlock,
  twofishKeySchedule, twofishEncryptBlock,
} from "./modernExt2.js";

// ============================================================
// 字节工具
// ============================================================
const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

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
  let s = "";
  for (const x of bytes) s += x.toString(16).padStart(2, "0");
  return s;
}

function msgToBytes(text, enc) {
  if (enc === "hex") return hexToBytes(text);
  return te(String(text == null ? "" : text));
}

// ============================================================
// GF(2^bs) 乘 x（RFC 4493 §2.3 doubling 的通用版）：整块左移 1 位，溢出异或 Rb。
// ============================================================
function shiftLeftDbl(b, rb) {
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) {
    out[i] = ((b[i] << 1) | (i + 1 < b.length ? b[i + 1] >> 7 : 0)) & 0xff;
  }
  if (b[0] >> 7) out[b.length - 1] ^= rb;
  return out;
}

function xorBlock(a, b) {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] ^ b[i];
  return o;
}

/**
 * 通用 CMAC（ISO/IEC 9797-1 / RFC 4493，任意块长）。
 * encBlock(b)->b 为分组密码单块加密；bs 为块大小（字节）；rb 为倍乘约减常数。
 */
function cmacGeneric(encBlock, msg, bs, rb) {
  const L = encBlock(new Uint8Array(bs));
  const K1 = shiftLeftDbl(L, rb);
  const K2 = shiftLeftDbl(K1, rb);

  const len = msg.length;
  const n = Math.max(1, Math.ceil(len / bs));
  const lastLen = len === 0 ? 0 : len - (n - 1) * bs;

  let M_last = new Uint8Array(bs);
  if (lastLen === bs) {
    M_last = xorBlock(msg.subarray((n - 1) * bs), K1);
  } else {
    const padded = new Uint8Array(bs);
    padded.set(msg.subarray((n - 1) * bs), 0);
    padded[lastLen] = 0x80; // pad10*
    M_last = xorBlock(padded, K2);
  }

  let X = new Uint8Array(bs);
  for (let i = 0; i < n - 1; i++) {
    X = encBlock(xorBlock(X, msg.subarray(i * bs, i * bs + bs)));
  }
  return encBlock(xorBlock(X, M_last));
}

// ============================================================
// 算法注册表：每种算法给出 块长 bs、Rb、密钥长度校验、单块加密绑定。
// ============================================================
const ALGS = {
  // ---- 128 位块（bs=16，Rb=0x87） ----
  camellia: {
    bs: 16, rb: 0x87,
    keyOk: (k) => k.length === 16 || k.length === 24 || k.length === 32,
    keyMsg: "Camellia 密钥须 16/24/32 字节（128/192/256 位）",
    enc: (key) => (blk) => hexToBytes(camelliaEncode(bytesToHex(blk), { key: bytesToHex(key) })),
    note: "单块 KAT：RFC 3713 附录 C；CMAC 结构 RFC 4493 等价。",
  },
  seed: {
    bs: 16, rb: 0x87,
    keyOk: (k) => k.length === 16,
    keyMsg: "SEED 密钥须 16 字节（128 位）",
    enc: (key) => (blk) => hexToBytes(seedEncode(bytesToHex(blk), { key: bytesToHex(key) })),
    note: "单块 KAT：RFC 4269 附录 B（KISA 规范向量）；CMAC 结构 RFC 4493 等价。",
  },
  twofish: {
    bs: 16, rb: 0x87,
    keyOk: (k) => k.length === 16 || k.length === 24 || k.length === 32,
    keyMsg: "Twofish 密钥须 16/24/32 字节（128/192/256 位）",
    enc: (key) => { const ctx = twofishKeySchedule(key); return (blk) => twofishEncryptBlock(blk, ctx); },
    note: "单块 KAT：botan twofish.vec；CMAC 结构 RFC 4493 等价。",
  },
  rc6: {
    bs: 16, rb: 0x87,
    keyOk: (k) => k.length >= 1 && k.length <= 255,
    keyMsg: "RC6 密钥须 1-255 字节",
    enc: (key) => { const S = rc6KeySchedule(key); return (blk) => rc6EncryptBlock(blk, S); },
    note: "单块 KAT：RC6 提交稿零密钥向量；CMAC 结构 RFC 4493 等价。",
  },
  // ---- 64 位块（bs=8，Rb=0x1B） ----
  idea: {
    bs: 8, rb: 0x1b,
    keyOk: (k) => k.length === 16,
    keyMsg: "IDEA 密钥须 16 字节（128 位）",
    enc: (key) => { const sub = ideaKeySchedule(key); return (blk) => ideaEncryptBlock(blk, sub); },
    note: "单块 KAT：botan idea.vec（64 位块 Rb=0x1B）；CMAC 结构 ISO/IEC 9797-1 等价。",
  },
  blowfish: {
    bs: 8, rb: 0x1b,
    keyOk: (k) => k.length >= 4 && k.length <= 56,
    keyMsg: "Blowfish 密钥须 4-56 字节",
    enc: (key) => { const ctx = blowfishKeySchedule(key); return (blk) => blowfishEncryptBlock(blk, ctx); },
    note: "单块 KAT：botan blowfish.vec（64 位块 Rb=0x1B）；CMAC 结构 ISO/IEC 9797-1 等价。",
  },
  cast5: {
    bs: 8, rb: 0x1b,
    keyOk: (k) => k.length >= 5 && k.length <= 16,
    keyMsg: "CAST-128 密钥须 5-16 字节",
    enc: (key) => { const ctx = cast5KeySchedule(key); return (blk) => cast5EncryptBlock(blk, ctx); },
    note: "单块 KAT：RFC 2144 附录 A（64 位块 Rb=0x1B）；CMAC 结构 ISO/IEC 9797-1 等价。",
  },
};

// ============================================================
// op · cmacExt
// ============================================================
function cmacExtRun(text, p = {}) {
  const alg = String((p && p.alg) || "camellia");
  const spec = ALGS[alg];
  if (!spec) throw new Error(`cmacExt 不支持的算法: ${alg}（可选：${Object.keys(ALGS).join("/")}）`);

  const key = hexToBytes(p && p.key);
  if (!spec.keyOk(key)) throw new Error(spec.keyMsg + `，当前 ${key.length} 字节`);

  const msg = msgToBytes(text, (p && p.msgEnc) || "hex");
  const mac = cmacGeneric(spec.enc(key), msg, spec.bs, spec.rb);

  const L = [];
  L.push(`=== CMAC-${alg}（${spec.bs * 8} 位块${spec.bs === 8 ? "，Rb=0x1B" : "，Rb=0x87"}，ISO/IEC 9797-1 / RFC 4493 结构） ===`);
  L.push(`密钥 (hex, ${key.length} B) = ${bytesToHex(key)}`);
  L.push(`消息 (${(p && p.msgEnc) || "hex"}, ${msg.length} B) = ${(p && p.msgEnc) === "hex" ? bytesToHex(msg) : JSON.stringify(String(text))}`);
  L.push("");
  L.push(`T = CMAC(${alg}, K, M) = ${bytesToHex(mac)}`);
  return L.join("\n");
}

register({
  id: "cmacExt",
  cat: "hash",
  name: "CMAC 扩展",
  desc: "通用 CMAC 消息认证码（ISO/IEC 9797-1 / RFC 4493 结构），底层分组密码可选 Camellia/SEED/Twofish/RC6（128 位块 Rb=0x87）或 IDEA/Blowfish/CAST-128（64 位块 Rb=0x1B）。单块 KAT 逐字背书。",
  params: [
    { key: "alg", label: "底层分组密码", type: "select", default: "camellia", options: ["camellia", "seed", "twofish", "rc6", "idea", "blowfish", "cast5"] },
    { key: "key", label: "密钥 K (hex)", type: "text", default: "2b7e151628aed2a6abf7158809cf4f3c", placeholder: "各算法密钥长度不同" },
    { key: "msgEnc", label: "消息编码", type: "select", default: "hex", options: ["hex", "text"] },
  ],
  run: cmacExtRun,
});
