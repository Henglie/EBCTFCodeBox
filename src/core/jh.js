/*
 * jh.js — JH 哈希（NIST SHA-3 决赛候选，cat:'hash'，run 型）。
 *
 * 算法照 Hongjun Wu 官方 64 位 bitslice 参考实现（hash.c，2011，public domain），不编造：
 *   状态：1024 位 = 8 行 × 2 个 64 位字（x[8][2]，bitslice 布局）。
 *   F8 压缩：消息块（512 位 = 8 字，内存小端读）异或进前一半状态 →
 *     E8（42 轮）→ 再异或进后一半状态。
 *   E8 轮结构：每 7 轮一组 = 6 轮「Sbox(SS) + MDS(L) + SWAP{1,2,4,8,16,32}」
 *     + 1 轮「Sbox + MDS + 交换各行两半 x[i][0]↔x[i][1]」。
 *     S 盒 bitslice：m0..m7 逐位逻辑（SS 宏），轮常数 cc0/cc1 = 第 round 个
 *     32 字节常数按 4 个 u64 读（[i] 与 [i+2]，i=0/1）。
 *   填充（照 Final）：databitlen ≡ 0 mod 512 → 单块 0x80...len；
 *     否则首块补 1 位 + 0，第二块放 64 位长度。
 *   输出：truncate 自状态字节 64 起的尾段（JH224 取 28B、256 取 32B、384 取 48B、512 取 64B）。
 *
 * 红线：算法照官方参考不编造；纯本地 BigInt；core 层零 UI 依赖（仅 registry）。
 *   载入自校验 C oracle（MSVC 编译官方 hash.c）交叉结果。
 *
 * 契约：register({ id:"jh", cat:"hash", name, desc, params, run })。
 *   variant 选 JH-224/256/384/512；输入文本/hex。
 */
import { register } from "./registry.js";
import { JH_H0, JH_RC } from "./jhTables.js";

const MASK64 = (1n << 64n) - 1n;

/* ---- 常量字节 → u64（内存小端）---- */
function bytesToWords(bs) {
  const out = new Array(bs.length / 8);
  for (let i = 0; i < out.length; i++) {
    let v = 0n;
    for (let j = 7; j >= 0; j--) v = (v << 8n) | BigInt(bs[i * 8 + j]);
    out[i] = v;
  }
  return out;
}

/* ---- bitslice S 盒（照 SS 宏）+ MDS（照 L 宏）+ SWAP 系列 ---- */
function ss(m, cc0, cc1) {
  // m = [m0,m1,m2,m3,m4,m5,m6,m7]，原位修改
  let temp0, temp1;
  m[3] = ~m[3] & MASK64;
  m[7] = ~m[7] & MASK64;
  m[0] = (m[0] ^ ((~m[2]) & cc0)) & MASK64;
  m[4] = (m[4] ^ ((~m[6]) & cc1)) & MASK64;
  temp0 = (cc0 ^ (m[0] & m[1])) & MASK64;
  temp1 = (cc1 ^ (m[4] & m[5])) & MASK64;
  m[0] = (m[0] ^ (m[2] & m[3])) & MASK64;
  m[4] = (m[4] ^ (m[6] & m[7])) & MASK64;
  m[3] = (m[3] ^ ((~m[1]) & m[2])) & MASK64;
  m[7] = (m[7] ^ ((~m[5]) & m[6])) & MASK64;
  m[1] = (m[1] ^ (m[0] & m[2])) & MASK64;
  m[5] = (m[5] ^ (m[4] & m[6])) & MASK64;
  m[2] = (m[2] ^ (m[0] & (~m[3]))) & MASK64;
  m[6] = (m[6] ^ (m[4] & (~m[7]))) & MASK64;
  m[0] = (m[0] ^ (m[1] | m[3])) & MASK64;
  m[4] = (m[4] ^ (m[5] | m[7])) & MASK64;
  m[3] = (m[3] ^ (m[1] & m[2])) & MASK64;
  m[7] = (m[7] ^ (m[5] & m[6])) & MASK64;
  m[1] = (m[1] ^ (temp0 & m[0])) & MASK64;
  m[5] = (m[5] ^ (temp1 & m[4])) & MASK64;
  m[2] = (m[2] ^ temp0) & MASK64;
  m[6] = (m[6] ^ temp1) & MASK64;
}
function l(m) {
  m[4] = (m[4] ^ m[1]) & MASK64;
  m[5] = (m[5] ^ m[2]) & MASK64;
  m[6] = (m[6] ^ m[0] ^ m[3]) & MASK64;
  m[7] = (m[7] ^ m[0]) & MASK64;
  m[0] = (m[0] ^ m[5]) & MASK64;
  m[1] = (m[1] ^ m[6]) & MASK64;
  m[2] = (m[2] ^ m[4] ^ m[7]) & MASK64;
  m[3] = (m[3] ^ m[4]) & MASK64;
}
const SWAP = [
  // swap1
  (x) => (((x & 0x5555555555555555n) << 1n) | ((x >> 1n) & 0x5555555555555555n)) & MASK64,
  // 1: swap2
  (x) => (((x & 0x3333333333333333n) << 2n) | ((x >> 2n) & 0x3333333333333333n)) & MASK64,
  // 2: swap4
  (x) => (((x & 0x0f0f0f0f0f0f0f0fn) << 4n) | ((x >> 4n) & 0x0f0f0f0f0f0f0f0fn)) & MASK64,
  // 3: swap8
  (x) => (((x & 0x00ff00ff00ff00ffn) << 8n) | ((x >> 8n) & 0x00ff00ff00ff00ffn)) & MASK64,
  // 4: swap16
  (x) => (((x & 0x0000ffff0000ffffn) << 16n) | ((x >> 16n) & 0x0000ffff0000ffffn)) & MASK64,
  // 5: swap32
  (x) => (((x & 0x00000000ffffffffn) << 32n) | ((x >> 32n) & 0x00000000ffffffffn)) & MASK64,
];

/* ---- E8（照 C E8）---- */
// x 展平下标映射：m[j] ↔ x[行][i]，行 = [0,2,4,6,1,3,5,7]（C SS/L 参数顺序）
const E8_IDX = (i) => [i, 4 + i, 8 + i, 12 + i, 2 + i, 6 + i, 10 + i, 14 + i];
function e8(x, rcWords) {
  for (let roundnumber = 0; roundnumber < 42; roundnumber += 7) {
    // 每 7 轮一组，前 6 轮 Sbox+MDS+SWAP{1,2,4,8,16,32}，第 7 轮 Sbox+MDS+行交换
    for (let k = 0; k < 6; k++) {
      for (let i = 0; i < 2; i++) {
        const idx = E8_IDX(i);
        const m = idx.map(j => x[j]);
        const rc = rcWords[roundnumber + k];
        ss(m, rc[i], rc[i + 2]);
        l(m);
        // SWAP 作用于 x[1],x[3],x[5],x[7] 行 = m[4..7]（C：SWAP1(x[1][i])...）
        for (let j = 4; j < 8; j++) m[j] = SWAP[k](m[j]);
        for (let j = 0; j < 8; j++) x[idx[j]] = m[j];
      }
    }
    // 第 7 轮（roundnumber+6）：Sbox+MDS，无 SWAP
    for (let i = 0; i < 2; i++) {
      const idx = E8_IDX(i);
      const m = idx.map(j => x[j]);
      const rc = rcWords[roundnumber + 6];
      ss(m, rc[i], rc[i + 2]);
      l(m);
      for (let j = 0; j < 8; j++) x[idx[j]] = m[j];
    }
    // 交换 x[i][0] ↔ x[i][1]（i=1,3,5,7）
    for (let i = 1; i < 8; i += 2) {
      const t = x[2 * i];
      x[2 * i] = x[2 * i + 1];
      x[2 * i + 1] = t;
    }
  }
}

/* ---- F8 压缩 ---- */
function f8(x, blockWords) {
  for (let i = 0; i < 8; i++) x[i] = (x[i] ^ blockWords[i]) & MASK64;
  e8(x, RC_WORDS);
  for (let i = 0; i < 8; i++) x[8 + i] = (x[8 + i] ^ blockWords[i]) & MASK64;
}

// 预转换轮常数为 u64 数组（每轮 4 个 u64）
const RC_WORDS = JH_RC.map(bs => bytesToWords(bs));

/* ---- 完整哈希（对照 C Hash/Init/Update/Final）---- */
function jhHex(bytes, hashbitlen) {
  const H0 = JH_H0[String(hashbitlen)];
  if (!H0) throw new Error(`JH 仅支持 224/256/384/512 位输出`);
  const x = bytesToWords(H0); // 128 字节 → 16 u64
  let databitlen = 0n;

  const buf = [];
  buf.push(...bytes);
  databitlen = BigInt(buf.length * 8);

  // Update（照 C）：消化所有完整 64 字节块
  const nFull = Math.floor(buf.length / 64);
  for (let b = 0; b < nFull; b++) {
    f8(x, bytesToWords(Uint8Array.from(buf.slice(b * 64, (b + 1) * 64))));
  }
  const partial = buf.slice(nFull * 64); // < 64 字节

  // Final：填充
  const block = new Uint8Array(64);
  if (databitlen % 512n === 0n) {
    block[0] = 0x80;
    for (let i = 0; i < 8; i++) block[63 - i] = Number((databitlen >> BigInt(8 * i)) & 0xffn);
    f8(x, bytesToWords(block));
  } else {
    // 首块：partial 数据 + 1 位填充（照 C：buffer[(databitlen&0x1ff)>>3] |= 1<<(7-(databitlen&7))）
    block.set(partial);
    const fillByte = Number((databitlen % 512n) >> 3n);
    const bitInLast = Number(databitlen % 8n);
    block[fillByte] |= (1 << (7 - bitInLast)) & 0xff;
    f8(x, bytesToWords(block));
    // 第二块：0 + 长度
    const block2 = new Uint8Array(64);
    for (let i = 0; i < 8; i++) block2[63 - i] = Number((databitlen >> BigInt(8 * i)) & 0xffn);
    f8(x, bytesToWords(block2));
  }

  // 输出：truncate 自字节 64 起
  // x 16 u64 → 128 字节（小端）
  const outLen = hashbitlen / 8;
  const startByte = 64 + (512 - hashbitlen) / 8; // JH224: 64+36, 256: 64+32, 384: 64+16, 512: 64
  const outBytes = [];
  for (let i = 0; i < outLen; i++) {
    const w = x[Math.floor((startByte + i) / 8)];
    outBytes.push(Number((w >> BigInt(8 * ((startByte + i) % 8))) & 0xffn));
  }
  let s = "";
  for (const b of outBytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/* ---- 载入自检：C oracle（MSVC 编译官方 hash.c）交叉结果 ---- */
(() => {
  const enc = new TextEncoder();
  const V = [
    ["", 512, "90ecf2f76f9d2c8017d979ad5ab96b87d58fc8fc4b83060f3f900774faa2c8fabe69c5f4ff1ec2b61d6b316941cedee117fb04b1f4c5bc1b919ae841c50eec4f"],
  ];
  for (const [msg, hb, want] of V) {
    const got = jhHex(enc.encode(msg), hb);
    if (got !== want) throw new Error(`JH-${hb} 自检失败（"${msg}"）：得到 ${got}\n期望   ${want}`);
  }
})();

/* ---------- 注册 ---------- */

function jhRun(text, p = {}) {
  const variant = (p && p.variant) || "512";
  const hbl = parseInt(variant, 10);
  const inputMode = (p && p.inputMode) || "text";
  const input = inputMode === "hex"
    ? (() => { const h = String(text || "").replace(/[^0-9a-fA-F]/g, ""); if (h.length % 2) throw new Error("hex 串长度须为偶数"); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16); return o; })()
    : new TextEncoder().encode(String(text || ""));

  const digest = jhHex(input, hbl);
  const lines = [];
  lines.push(`=== JH-${hbl} ===`);
  lines.push(`输入: ${input.length} 字节（${inputMode === "hex" ? "Hex" : "文本 UTF-8"}）`);
  lines.push("");
  lines.push("摘要 (hex):");
  lines.push(digest);
  lines.push("");
  lines.push(`大写: ${digest.toUpperCase()}`);
  return lines.join("\n");
}

register({
  id: "jh",
  cat: "hash",
  name: "JH",
  desc: "JH 哈希（NIST SHA-3 决赛五强之一，Hongjun Wu 清华/新加坡南阳理工）：1024 位 bitslice 状态，42 轮 E8 双射 + MDS 扩散，JH-224/256/384/512 四种输出。bitslice 设计使其在 Intel 平台高速实现。已过 C oracle（官方参考编译）交叉验证。",
  params: [
    {
      key: "variant", label: "变体", type: "select", default: "512",
      options: [
        { value: "224", label: "JH-224" },
        { value: "256", label: "JH-256" },
        { value: "384", label: "JH-384" },
        { value: "512", label: "JH-512" },
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
  run: jhRun,
});
