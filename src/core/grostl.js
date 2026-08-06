/*
 * grostl.js — Grøstl 哈希（NIST SHA-3 决赛候选，cat:'hash'，run 型）。
 *
 * 算法照 NIST 官方提交（Thomsen/Matusiewicz 2011，ANSI C optimized 版，来自
 * tweqx/grostl-wasm 镜像的 hash.c/hash.h/tables.h，public domain），不编造：
 *   两种状态：SHORT=512 位（8 字，hashbitlen ≤ 256）与 LONG=1024 位（16 字，> 256）。
 *   Init：链值全 0，最后一字 = u64big(hashbitlen)。
 *   F512/F1024 压缩：h' = h ⊕ Q(m) ⊕ P(h⊕m)。P/Q 各 10/14 轮，
 *     每轮先异或轮常数（P 用 0x00..0x70<<56 系、Q 用 0xff..0x8f 系，均经 u64big），
 *     再做 COLUMN 变换：y[i] = Σ_k T[k*256 + byte_k(x[c_k])]，byte_n = x >> 8n。
 *   T 表 8×256 个 64 位值照官方逐值提取（grostlTables.js）。
 *   填充：补 0x80 + 0x00，长度字段 = 块计数（8 字节大端），不足则补两整块。
 *   Final：OutputTransformation（P(h)⊕h），取链值最后 hashbytelen 字节。
 *
 * 红线：算法照官方参考不编造；纯本地 BigInt；core 层零 UI 依赖（仅 registry）。
 *   载入自校验 C oracle（MSVC 编译官方 hash.c）交叉结果。
 *
 * 契约：register({ id:"grostl", cat:"hash", name, desc, params, run })。
 *   variant 选 Grøstl-256（SHORT 512 位）/ Grøstl-512（LONG 1024 位）；输入文本/hex。
 */
import { register } from "./registry.js";
import T from "./grostlTables.js";

const MASK64 = (1n << 64n) - 1n;

// U64BIG（照 hash.h）：8 字节反转（C 宏实测 = bswap64）
function u64big(x) {
  x &= MASK64;
  return (
    ((x & 0x00000000000000ffn) << 56n) |
    ((x & 0x000000000000ff00n) << 40n) |
    ((x & 0x0000000000ff0000n) << 24n) |
    ((x & 0x00000000ff000000n) << 8n) |
    ((x & 0x000000ff00000000n) >> 8n) |
    ((x & 0x0000ff0000000000n) >> 24n) |
    ((x & 0x00ff000000000000n) >> 40n) |
    ((x & 0xff00000000000000n) >> 56n)
  );
}
const extByte = (x, n) => Number((x >> BigInt(8 * n)) & 0xffn);

/* ---- P/Q 轮常数（照 RND512P/Q 宏：x[i] ^= u64big(CONST[i]) ^ r）---- */
const PC_512 = [
  0x0000000000000000n, 0x1000000000000000n, 0x2000000000000000n, 0x3000000000000000n,
  0x4000000000000000n, 0x5000000000000000n, 0x6000000000000000n, 0x7000000000000000n,
];
const QC_512 = [
  0xffffffffffffffffn, 0xffffffffffffffefn, 0xffffffffffffffdfn, 0xffffffffffffffcfn,
  0xffffffffffffffbfn, 0xffffffffffffffafn, 0xffffffffffffff9fn, 0xffffffffffffff8fn,
];
const PC_1024 = [
  0x0000000000000000n, 0x1000000000000000n, 0x2000000000000000n, 0x3000000000000000n,
  0x4000000000000000n, 0x5000000000000000n, 0x6000000000000000n, 0x7000000000000000n,
  0x8000000000000000n, 0x9000000000000000n, 0xa000000000000000n, 0xb000000000000000n,
  0xc000000000000000n, 0xd000000000000000n, 0xe000000000000000n, 0xf000000000000000n,
];
const QC_1024 = [
  0xffffffffffffffffn, 0xffffffffffffffefn, 0xffffffffffffffdfn, 0xffffffffffffffcfn,
  0xffffffffffffffbfn, 0xffffffffffffffafn, 0xffffffffffffff9fn, 0xffffffffffffff8fn,
  0xffffffffffffff7fn, 0xffffffffffffff6fn, 0xffffffffffffff5fn, 0xffffffffffffff4fn,
  0xffffffffffffff3fn, 0xffffffffffffff2fn, 0xffffffffffffff1fn, 0xffffffffffffff0fn,
];

/* COLUMN：y[i] = Σ_k T[k*256 + byte_k(x[c_k])] */
function column(x, y, i, c) {
  let v = 0n;
  for (let k = 0; k < 8; k++) {
    v ^= T[k * 256 + extByte(x[c[k]], k)];
  }
  y[i] = v;
}

function roundP512(x, y, r) {
  for (let i = 0; i < 8; i++) x[i] = (x[i] ^ u64big(PC_512[i]) ^ r) & MASK64;
  column(x, y, 0, [0, 1, 2, 3, 4, 5, 6, 7]);
  column(x, y, 1, [1, 2, 3, 4, 5, 6, 7, 0]);
  column(x, y, 2, [2, 3, 4, 5, 6, 7, 0, 1]);
  column(x, y, 3, [3, 4, 5, 6, 7, 0, 1, 2]);
  column(x, y, 4, [4, 5, 6, 7, 0, 1, 2, 3]);
  column(x, y, 5, [5, 6, 7, 0, 1, 2, 3, 4]);
  column(x, y, 6, [6, 7, 0, 1, 2, 3, 4, 5]);
  column(x, y, 7, [7, 0, 1, 2, 3, 4, 5, 6]);
}
function roundQ512(x, y, r) {
  for (let i = 0; i < 8; i++) x[i] = (x[i] ^ u64big(QC_512[i]) ^ r) & MASK64;
  column(x, y, 0, [1, 3, 5, 7, 0, 2, 4, 6]);
  column(x, y, 1, [2, 4, 6, 0, 1, 3, 5, 7]);
  column(x, y, 2, [3, 5, 7, 1, 2, 4, 6, 0]);
  column(x, y, 3, [4, 6, 0, 2, 3, 5, 7, 1]);
  column(x, y, 4, [5, 7, 1, 3, 4, 6, 0, 2]);
  column(x, y, 5, [6, 0, 2, 4, 5, 7, 1, 3]);
  column(x, y, 6, [7, 1, 3, 5, 6, 0, 2, 4]);
  column(x, y, 7, [0, 2, 4, 6, 7, 1, 3, 5]);
}
const QI_512 = [
  [15, 0, 2, 4, 10, 15, 1, 3, 5], [14, 15, 1, 3, 9, 14, 0, 2, 4],
  [13, 14, 0, 2, 8, 13, 15, 1, 3], [12, 13, 15, 1, 7, 12, 14, 0, 2],
  [11, 12, 14, 0, 6, 11, 13, 15, 1], [10, 11, 13, 15, 5, 10, 12, 14, 0],
  [9, 10, 12, 14, 4, 9, 11, 13, 15], [8, 9, 11, 13, 3, 8, 10, 12, 14],
];
const PI_1024 = [
  [15, 15, 0, 1, 2, 3, 4, 5, 10], [14, 14, 15, 0, 1, 2, 3, 4, 9],
  [13, 13, 14, 15, 0, 1, 2, 3, 8], [12, 12, 13, 14, 15, 0, 1, 2, 7],
  [11, 11, 12, 13, 14, 15, 0, 1, 6], [10, 10, 11, 12, 13, 14, 15, 0, 5],
  [9, 9, 10, 11, 12, 13, 14, 15, 4], [8, 8, 9, 10, 11, 12, 13, 14, 3],
  [7, 7, 8, 9, 10, 11, 12, 13, 2], [6, 6, 7, 8, 9, 10, 11, 12, 1],
  [5, 5, 6, 7, 8, 9, 10, 11, 0], [4, 4, 5, 6, 7, 8, 9, 10, 15],
  [3, 3, 4, 5, 6, 7, 8, 9, 14], [2, 2, 3, 4, 5, 6, 7, 8, 13],
  [1, 1, 2, 3, 4, 5, 6, 7, 12], [0, 0, 1, 2, 3, 4, 5, 6, 11],
];
const QI_1024 = [
  [15, 0, 2, 4, 10, 15, 1, 3, 5], [14, 15, 1, 3, 9, 14, 0, 2, 4],
  [13, 14, 0, 2, 8, 13, 15, 1, 3], [12, 13, 15, 1, 7, 12, 14, 0, 2],
  [11, 12, 14, 0, 6, 11, 13, 15, 1], [10, 11, 13, 15, 5, 10, 12, 14, 0],
  [9, 10, 12, 14, 4, 9, 11, 13, 15], [8, 9, 11, 13, 3, 8, 10, 12, 14],
  [7, 8, 10, 12, 2, 7, 9, 11, 13], [6, 7, 9, 11, 1, 6, 8, 10, 12],
  [5, 6, 8, 10, 0, 5, 7, 9, 11], [4, 5, 7, 9, 15, 4, 6, 8, 10],
  [3, 4, 6, 8, 14, 3, 5, 7, 9], [2, 3, 5, 7, 13, 2, 4, 6, 8],
  [1, 2, 4, 6, 12, 1, 3, 5, 7], [0, 1, 3, 5, 11, 0, 2, 4, 6],
];

/* 单轮 1024：先 XOR 常数，再按索引数组做 16 次 column */
function roundP1024(x, y, r) {
  for (let i = 0; i < 16; i++) x[i] = (x[i] ^ u64big(PC_1024[i]) ^ r) & MASK64;
  // PI_1024[i] = [outIdx, c0..c7]
  for (let i = 0; i < 16; i++) column(x, y, PI_1024[i][0], PI_1024[i].slice(1));
}
function roundQ1024(x, y, r) {
  for (let i = 0; i < 16; i++) x[i] = (x[i] ^ u64big(QC_1024[i]) ^ r) & MASK64;
  for (let i = 0; i < 16; i++) column(x, y, QI_1024[i][0], QI_1024[i].slice(1));
}

/* ---- 压缩函数 F512 / F1024 ---- */
function f512(h, m) {
  const z = m.slice();
  const inP = h.map((v, i) => v ^ m[i]);
  const outQ = new Array(8);
  const y = new Array(8);
  roundQ512(z, y, u64big(0n));
  roundQ512(y, z, u64big(1n));
  roundQ512(z, y, u64big(2n));
  roundQ512(y, z, u64big(3n));
  roundQ512(z, y, u64big(4n));
  roundQ512(y, z, u64big(5n));
  roundQ512(z, y, u64big(6n));
  roundQ512(y, z, u64big(7n));
  roundQ512(z, y, u64big(8n));
  roundQ512(y, outQ, u64big(9n));
  roundP512(inP, z, u64big(0n));
  roundP512(z, y, u64big(0x0100000000000000n));
  roundP512(y, z, u64big(0x0200000000000000n));
  roundP512(z, y, u64big(0x0300000000000000n));
  roundP512(y, z, u64big(0x0400000000000000n));
  roundP512(z, y, u64big(0x0500000000000000n));
  roundP512(y, z, u64big(0x0600000000000000n));
  roundP512(z, y, u64big(0x0700000000000000n));
  roundP512(y, z, u64big(0x0800000000000000n));
  roundP512(z, y, u64big(0x0900000000000000n));
  for (let i = 0; i < 8; i++) h[i] = (h[i] ^ outQ[i] ^ y[i]) & MASK64;
}

function f1024(h, m) {
  const z = m.slice();
  const inP = h.map((v, i) => v ^ m[i]);
  const outQ = new Array(16);
  const y = new Array(16);
  roundQ1024(z, y, 0n);
  for (let i = 1; i < 13; i += 2) {
    roundQ1024(y, z, u64big(BigInt(i)));
    roundQ1024(z, y, u64big(BigInt(i + 1)));
  }
  roundQ1024(y, outQ, u64big(13n));
  roundP1024(inP, z, 0n);
  for (let i = 1; i < 13; i += 2) {
    roundP1024(z, y, u64big(BigInt(i) << 56n));
    roundP1024(y, z, u64big(BigInt(i + 1) << 56n));
  }
  roundP1024(z, y, u64big(13n << 56n));
  for (let i = 0; i < 16; i++) h[i] = (h[i] ^ outQ[i] ^ y[i]) & MASK64;
}

/* ---- 输出变换：h ← P(h) ⊕ h ---- */
function outputTransform512(h) {
  const temp = h.slice();
  const y = new Array(8);
  const z = new Array(8);
  roundP512(temp, z, u64big(0n));
  roundP512(z, y, u64big(0x0100000000000000n));
  roundP512(y, z, u64big(0x0200000000000000n));
  roundP512(z, y, u64big(0x0300000000000000n));
  roundP512(y, z, u64big(0x0400000000000000n));
  roundP512(z, y, u64big(0x0500000000000000n));
  roundP512(y, z, u64big(0x0600000000000000n));
  roundP512(z, y, u64big(0x0700000000000000n));
  roundP512(y, z, u64big(0x0800000000000000n));
  roundP512(z, temp, u64big(0x0900000000000000n));
  for (let j = 0; j < 8; j++) h[j] = (h[j] ^ temp[j]) & MASK64;
}
function outputTransform1024(h) {
  const temp = h.slice();
  const y = new Array(16);
  const z = new Array(16);
  roundP1024(temp, y, 0n);
  for (let j = 1; j < 13; j += 2) {
    roundP1024(y, z, u64big(BigInt(j) << 56n));
    roundP1024(z, y, u64big(BigInt(j + 1) << 56n));
  }
  roundP1024(y, temp, u64big(13n << 56n));
  for (let j = 0; j < 16; j++) h[j] = (h[j] ^ temp[j]) & MASK64;
}

/* ---- 完整哈希（对照 C Hash()/Init/Update/Final）---- */
function grostlHex(bytes, hashbitlen) {
  if (hashbitlen <= 0 || hashbitlen % 8 || hashbitlen > 512) throw new Error("Grøstl hashbitlen 须为 8 的倍数且 ≤ 512");
  const size = hashbitlen <= 256 ? 8 : 16; // SHORT=512 位 / LONG=1024 位
  const blockBytes = size * 8;
  let h = new Array(size).fill(0n);
  h[size - 1] = u64big(BigInt(hashbitlen));
  let blockCounter = 0n;

  const transform = (data) => {
    let msglen = data.length;
    blockCounter += BigInt(Math.floor(msglen / blockBytes));
    let off = 0;
    while (msglen >= blockBytes) {
      const m = new Array(size);
      for (let i = 0; i < size; i++) {
        let v = 0n;
        for (let b = 7; b >= 0; b--) v = (v << 8n) | BigInt(data[off + i * 8 + b]);
        m[i] = v;
      }
      if (size === 8) f512(h, m); else f1024(h, m);
      msglen -= blockBytes;
      off += blockBytes;
    }
  };

  // Update
  let buf = [];
  buf.push(...bytes);
  // Update（照 C hash.c：Transform 直接消化所有完整块，剩余 < 块放 buffer）
  const fullLen = buf.length;
  const nFull = Math.floor(fullLen / blockBytes);
  if (nFull > 0) {
    transform(buf.slice(0, nFull * blockBytes));
    buf = buf.slice(nFull * blockBytes);
  }

  // Final：填充 + 长度字段
  const cur = buf.slice();
  cur.push(0x80);
  if (cur.length > blockBytes - 8) {
    while (cur.length < blockBytes) cur.push(0);
    transform(cur);
    cur.length = 0;
  }
  while (cur.length < blockBytes - 8) cur.push(0);
  // 长度字段：block_counter+1 的 8 字节大端
  blockCounter += 1n;
  const lenBytes = new Array(8).fill(0);
  let bc = blockCounter;
  for (let i = 7; i >= 0; i--) { lenBytes[i] = Number(bc & 0xffn); bc >>= 8n; }
  cur.push(...lenBytes);
  transform(cur);

  // 输出变换
  if (size === 8) outputTransform512(h); else outputTransform1024(h);

  // 取末 hashbytelen 字节（C Final：for(i=size-hashbytelen;i<size;i++) output[j]=s[i]；
  // 即从链值第 size-hashbytelen 字节起，逐字小端字节序）
  const hashbytelen = hashbitlen / 8;
  const startByte = blockBytes - hashbytelen;
  const outBytes = new Array(hashbytelen);
  for (let i = 0; i < hashbytelen; i++) {
    const w = h[Math.floor((startByte + i) / 8)];
    outBytes[i] = Number((w >> BigInt(8 * ((startByte + i) % 8))) & 0xffn);
  }
  let s = "";
  for (const b of outBytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/* ---- 载入自检：C oracle（MSVC 编译官方 hash.c）交叉结果 ---- */
(() => {
  const enc = new TextEncoder();
  const V = [
    ["", 512, "6d3ad29d279110eef3adbd66de2a0345a77baede1557f5d099fce0c03d6dc2ba8e6d4a6633dfbd66053c20faa87d1a11f39a7fbe4a6c2f009801370308fc4ad8"],
    ["abc", 512, "70e1c68c60df3b655339d67dc291cc3f1dde4ef343f11b23fdd44957693815a75a8339c682fc28322513fd1f283c18e53cff2b264e06bf83a2f0ac8c1f6fbff6"],
    ["", 256, "1a52d11d550039be16107f9c58db9ebcc417f16f736adb2502567119f0083467"],
    ["abc", 256, "f3c1bb19c048801326a7efbcf16e3d7887446249829c379e1840d1a3a1e7d4d2"],
  ];
  for (const [msg, hb, want] of V) {
    const got = grostlHex(enc.encode(msg), hb);
    if (got !== want) throw new Error(`Grøstl-${hb} 自检失败（"${msg}"）：得到 ${got}\n期望   ${want}`);
  }
})();

/* ---------- 注册 ---------- */

function grostlRun(text, p = {}) {
  const variant = (p && p.variant) || "512";
  const hbl = variant === "256" ? 256 : 512;
  const inputMode = (p && p.inputMode) || "text";
  const input = inputMode === "hex"
    ? (() => { const h = String(text || "").replace(/[^0-9a-fA-F]/g, ""); if (h.length % 2) throw new Error("hex 串长度须为偶数"); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return o; })()
    : new TextEncoder().encode(String(text || ""));

  const digest = grostlHex(input, hbl);
  const lines = [];
  lines.push(`=== Grøstl-${hbl} ===`);
  lines.push(`输入: ${input.length} 字节（${inputMode === "hex" ? "Hex" : "文本 UTF-8"}）`);
  lines.push("");
  lines.push("摘要 (hex):");
  lines.push(digest);
  lines.push("");
  lines.push(`大写: ${digest.toUpperCase()}`);
  return lines.join("\n");
}

register({
  id: "grostl",
  cat: "hash",
  name: "Grøstl",
  desc: "Grøstl 哈希（NIST SHA-3 决赛五强之一，Thomsen/Matusiewicz，公钥密码学背景）：Grøstl-256 用 512 位状态、Grøstl-512 用 1024 位状态，两个并行置换 P/Q 的宽管道压缩 h'=h⊕Q(m)⊕P(h⊕m)，双射结构保证高速。已过 C oracle（官方 NIST 提交编译）交叉验证。",
  params: [
    {
      key: "variant", label: "变体", type: "select", default: "512",
      options: [
        { value: "256", label: "Grøstl-256（512 位状态）" },
        { value: "512", label: "Grøstl-512（1024 位状态）" },
      ],
    },
    {
      key: "inputMode", label: "输入形式", type: "select", default: "text",
      options: [
        { value: "text", label: "文本 (UTF-8)" },
        { value: "hex", label: "Hex" },
      ],
    },
  ],
  run: grostlRun,
});
