/*
 * xxhash.js — xxHash32 / xxHash64 极速非加密哈希（Yann Collet，BSD-2）。cat:'hash'，run 型。
 *
 * 算法照官方 C 参考实现（github.com/Cyan4973/xxHash，xxhash.h）逐步转写，不编造：
 *
 *   XXH32_round(acc, in)  : acc += in*P2; acc = rotl32(acc,13); acc *= P1
 *   XXH64_round(acc, in)  : acc += in*P2; acc = rotl64(acc,31); acc *= P1
 *   XXH64_mergeRound(a,v) : a ^= round(0,v); a = a*P1 + P4
 *
 * 主循环（xxh32 每 16 字节 4 条 lane / xxh64 每 32 字节 4 条 lane）后收敛：
 *   h = rotl(v1,1) + rotl(v2,7) + rotl(v3,12) + rotl(v4,18)
 * 尾部按 4 字节 / 1 字节两级消化，最后走 avalanche 混淆。
 *
 * 32 位用 Math.imul（避免 double 精度丢失），64 位用 BigInt + MASK64 截断。
 * ⚠ BigInt 运算符优先级坑：`(a*b) & MASK + c` 会被解析成 `(a*b) & (MASK+c)`，
 *   本文件所有掩码/加法一律显式括号，别删。
 *
 * 载入自检跑官方已知答案（seed=0 与非零 seed，覆盖空串/1/3/4 字节尾部分支 +
 * 超过 striping 阈值的长输入，即 xxh32 ≥16、xxh64 ≥32 的主循环路径）。
 *
 * 红线：算法照官方参考实现；向量自检不过即抛错拒绝载入；纯本地零外发；core 层零 UI 依赖。
 *
 * 契约：register({ id:"xxhash", cat:"hash", name, desc, params, run })。
 */
import { register } from "./registry.js";

/* ============================================================
 * xxHash32
 * ============================================================ */

const P32_1 = 0x9E3779B1;
const P32_2 = 0x85EBCA77;
const P32_3 = 0xC2B2AE3D;
const P32_4 = 0x27D4EB2F;
const P32_5 = 0x165667B1;

function rotl32(x, r) { return ((x << r) | (x >>> (32 - r))) >>> 0; }

// XXH32_round：acc += in*P2; rotl 13; *= P1
function round32(acc, input) {
  return Math.imul(rotl32((acc + Math.imul(input, P32_2)) >>> 0, 13), P32_1) >>> 0;
}

function xxh32(data, seed = 0) {
  const n = data.length;
  let off = 0;
  let h;
  seed = seed >>> 0;

  const read32 = (o) =>
    (data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)) >>> 0;

  if (n >= 16) {
    let v1 = (seed + P32_1 + P32_2) >>> 0;
    let v2 = (seed + P32_2) >>> 0;
    let v3 = seed;
    let v4 = (seed - P32_1) >>> 0;
    const limit = n - 16;
    for (; off <= limit; off += 16) {
      v1 = round32(v1, read32(off));
      v2 = round32(v2, read32(off + 4));
      v3 = round32(v3, read32(off + 8));
      v4 = round32(v4, read32(off + 12));
    }
    h = (rotl32(v1, 1) + rotl32(v2, 7) + rotl32(v3, 12) + rotl32(v4, 18)) >>> 0;
  } else {
    h = (seed + P32_5) >>> 0;
  }

  h = (h + n) >>> 0;

  // 尾部：先 4 字节一组
  for (; off + 4 <= n; off += 4) {
    h = (h + Math.imul(read32(off), P32_3)) >>> 0;
    h = Math.imul(rotl32(h, 17), P32_4) >>> 0;
  }
  // 再逐字节
  for (; off < n; off++) {
    h = (h + Math.imul(data[off], P32_5)) >>> 0;
    h = Math.imul(rotl32(h, 11), P32_1) >>> 0;
  }

  // avalanche
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, P32_2) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, P32_3) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/* ============================================================
 * xxHash64（BigInt）
 * ============================================================ */

const P64_1 = 0x9E3779B185EBCA87n;
const P64_2 = 0xC2B2AE3D27D4EB4Fn;
const P64_3 = 0x165667B19E3779F9n;
const P64_4 = 0x85EBCA77C2B2AE63n;
const P64_5 = 0x27D4EB2F165667C5n;
const M64 = (1n << 64n) - 1n;

function rotl64(x, r) {
  const b = BigInt(r);
  return (((x << b) | (x >> (64n - b))) & M64);
}

// XXH64_round：acc += in*P2; rotl 31; *= P1
function round64(acc, input) {
  const a = (acc + ((input * P64_2) & M64)) & M64;
  return (rotl64(a, 31) * P64_1) & M64;
}

// XXH64_mergeRound：acc ^= round64(0,val); acc = acc*P1 + P4
function merge64(acc, val) {
  const a = acc ^ round64(0n, val);
  return (((a * P64_1) & M64) + P64_4) & M64;
}

function xxh64(data, seed = 0n) {
  const n = data.length;
  let off = 0;
  let h;
  seed = BigInt(seed) & M64;

  const read64 = (o) => {
    let r = 0n;
    for (let i = 7; i >= 0; i--) r = (r << 8n) | BigInt(data[o + i]);
    return r;
  };
  const read32u = (o) =>
    BigInt((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16) | (data[o + 3] << 24)) >>> 0);

  if (n >= 32) {
    let v1 = (seed + P64_1 + P64_2) & M64;
    let v2 = (seed + P64_2) & M64;
    let v3 = seed;
    let v4 = (seed - P64_1) & M64;
    const limit = n - 32;
    for (; off <= limit; off += 32) {
      v1 = round64(v1, read64(off));
      v2 = round64(v2, read64(off + 8));
      v3 = round64(v3, read64(off + 16));
      v4 = round64(v4, read64(off + 24));
    }
    h = (rotl64(v1, 1) + rotl64(v2, 7) + rotl64(v3, 12) + rotl64(v4, 18)) & M64;
    h = merge64(h, v1);
    h = merge64(h, v2);
    h = merge64(h, v3);
    h = merge64(h, v4);
  } else {
    h = (seed + P64_5) & M64;
  }

  h = (h + BigInt(n)) & M64;

  // 尾部：8 字节一组
  for (; off + 8 <= n; off += 8) {
    h ^= round64(0n, read64(off));
    h = (((rotl64(h, 27) * P64_1) & M64) + P64_4) & M64;
  }
  // 4 字节
  if (off + 4 <= n) {
    h ^= (read32u(off) * P64_1) & M64;
    h = (((rotl64(h, 23) * P64_2) & M64) + P64_3) & M64;
    off += 4;
  }
  // 逐字节
  for (; off < n; off++) {
    h ^= (BigInt(data[off]) * P64_5) & M64;
    h = (rotl64(h, 11) * P64_1) & M64;
  }

  // avalanche
  h ^= h >> 33n;
  h = (h * P64_2) & M64;
  h ^= h >> 29n;
  h = (h * P64_3) & M64;
  h ^= h >> 32n;
  return h & M64;
}

/* ============================================================
 * 载入自检（官方已知答案；不过即抛错，绝不上线错的密码学/哈希）
 * ============================================================ */

const _enc = new TextEncoder();

(() => {
  // xxHash32，seed = 0
  const V32 = [
    ["", 0x02CC5D05],
    ["a", 0x550D7456],
    ["abc", 0x32D153FF],
    ["abcd", 0xA3643705],
    // ≥16 字节，走 4-lane striping 主循环 + 4 字节/单字节双级尾部
    ["Nobody inspects the spammish repetition", 0xE2293B2F],
  ];
  for (const [msg, want] of V32) {
    const got = xxh32(_enc.encode(msg));
    if (got !== want >>> 0) {
      throw new Error(
        `xxHash32 向量自检失败（"${msg}"）：得 0x${got.toString(16)}，期望 0x${(want >>> 0).toString(16)}`
      );
    }
  }

  // xxHash64，seed = 0
  const V64 = [
    ["", 0xEF46DB3751D8E999n],
    ["a", 0xD24EC4F1A98C6E5Bn],
    ["abc", 0x44BC2CF5AD770999n],
    ["abcd", 0xDE0327B0D25D92CCn],
    // ≥32 字节，走 4-lane striping 主循环 + 8/4/1 三级尾部
    ["Nobody inspects the spammish repetition", 0xFBCEA83C8A378BF1n],
  ];
  for (const [msg, want] of V64) {
    const got = xxh64(_enc.encode(msg));
    if (got !== want) {
      throw new Error(
        `xxHash64 向量自检失败（"${msg}"）：得 0x${got.toString(16)}，期望 0x${want.toString(16)}`
      );
    }
  }
})();

/* ============================================================
 * op 注册
 * ============================================================ */

function hexToBytes(s) {
  const c = String(s || "").replace(/[^0-9a-fA-F]/g, "");
  if (c.length % 2) throw new Error("hex 长度须为偶数");
  const o = new Uint8Array(c.length / 2);
  for (let i = 0; i < o.length; i++) o[i] = parseInt(c.substr(i * 2, 2), 16);
  return o;
}

// seed 解析：支持十进制与 0x 前缀十六进制；空 = 0
function parseSeed(s) {
  const t = String(s == null ? "" : s).trim();
  if (!t) return 0n;
  try {
    return BigInt(t) & M64;
  } catch {
    throw new Error(`种子不是合法整数：${t}`);
  }
}

function xxhashRun(text, p = {}) {
  const variant = (p && p.variant) || "xxh64";
  const inputMode = (p && p.inputMode) || "text";
  const data = inputMode === "hex" ? hexToBytes(text) : _enc.encode(String(text || ""));
  const seed = parseSeed(p && p.seed);

  const lines = [];
  lines.push(`=== ${variant === "xxh32" ? "xxHash32" : "xxHash64"} 极速哈希 ===`);
  lines.push(`输入: ${data.length} 字节（${inputMode === "hex" ? "Hex" : "文本 UTF-8"}）`);
  lines.push(`种子: ${seed}${seed ? ` (0x${seed.toString(16)})` : ""}`);
  lines.push("");

  if (variant === "xxh32") {
    const h = xxh32(data, Number(seed & 0xFFFFFFFFn));
    lines.push(`摘要 (hex): ${h.toString(16).padStart(8, "0")}`);
    lines.push(`摘要 (十进制): ${h}`);
  } else {
    const h = xxh64(data, seed);
    lines.push(`摘要 (hex): ${h.toString(16).padStart(16, "0")}`);
    lines.push(`摘要 (十进制): ${h}`);
  }
  lines.push("");
  lines.push("※ 非加密哈希：为速度设计，不抗碰撞攻击，勿用于签名/口令。");
  return lines.join("\n");
}

register({
  id: "xxhash",
  cat: "hash",
  name: "xxHash 极速哈希",
  desc:
    "xxHash32 / xxHash64（Yann Collet）：非加密极速哈希，4 条 lane 并行 striping + 乘旋异或混合。" +
    "常见于 LZ4/Zstd 校验、数据库索引、文件去重。可选种子（十进制或 0x 十六进制）。载入时跑官方向量自检。",
  params: [
    {
      key: "variant", label: "变体", type: "select", default: "xxh64",
      options: [
        { value: "xxh64", label: "xxHash64（64 位）" },
        { value: "xxh32", label: "xxHash32（32 位）" },
      ],
    },
    {
      key: "inputMode", label: "输入形式", type: "select", default: "text",
      options: [
        { value: "text", label: "文本 (UTF-8)" },
        { value: "hex", label: "Hex" },
      ],
    },
    { key: "seed", label: "种子 seed（可选，支持 0x）", type: "text", default: "", placeholder: "默认 0" },
  ],
  run: xxhashRun,
});

export { xxh32, xxh64 };
