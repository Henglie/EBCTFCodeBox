/*
 * blake3.js — BLAKE3 加密哈希（cat:'hash'，run 型）。
 *
 * BLAKE3（O'Connor/Aumasson/Neves/Wilcox-O'Hearn 2020）：基于 BLAKE2 的 G 函数
 * 与 Merkle 树结构，支持无限输出（XOF）。本实现照官方规范：
 *   - 压缩函数：7 轮，每轮 8 次 G 混合（列 4 次 + 对角 4 次）+ 消息置换。
 *   - 分块：chunk = 1024 字节（16 个 64 字节块），跨块链接。
 *   - 树：叶为 chunk，父节点两两合并 CV；根节点带 ROOT 标志，可扩展输出。
 *   - IV = SHA-256 IV（8 个 32 位字）。
 *
 * 标志位：CHUNK_START=1 / CHUNK_END=2 / PARENT=4 / ROOT=8。
 * （KEYED_HASH / DERIVE_KEY 未实现，本 op 仅纯哈希。）
 *
 * 落地照官方 test_vectors.json（input = 字节 i mod 251 重复），
 * 交付前跑官方向量（含 1024/1025 多 chunk 边界）验证。
 *
 * 红线：算法照官方规范；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 契约：register({ id:"blake3", cat:"hash", name, desc, params, run })。
 */
import { register } from "./registry.js";

// SHA-256 IV
const IV = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

const CHUNK_START = 1;
const CHUNK_END = 2;
const PARENT = 4;
const ROOT = 8;

const MSG_PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];

function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

function g(s, a, b, c, d, mx, my) {
  s[a] = (s[a] + s[b] + mx) >>> 0;
  s[d] = rotr(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotr(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b] + my) >>> 0;
  s[d] = rotr(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotr(s[b] ^ s[c], 7);
}

/**
 * 压缩函数。cv=8 字，block=16 字，counter=块计数，blockLen=本块字节数，flags=标志。
 * 返回 16 字（前 8 为链接值，全 16 用于 XOF 输出）。
 */
function compress(cv, block, counter, blockLen, flags) {
  const counterLow = counter >>> 0;
  const counterHigh = Math.floor(counter / 0x100000000) >>> 0;
  const s = [
    cv[0], cv[1], cv[2], cv[3], cv[4], cv[5], cv[6], cv[7],
    IV[0], IV[1], IV[2], IV[3],
    counterLow, counterHigh, blockLen >>> 0, flags >>> 0,
  ];
  let m = block.slice();
  for (let r = 0; r < 7; r++) {
    g(s, 0, 4, 8, 12, m[0], m[1]);
    g(s, 1, 5, 9, 13, m[2], m[3]);
    g(s, 2, 6, 10, 14, m[4], m[5]);
    g(s, 3, 7, 11, 15, m[6], m[7]);
    g(s, 0, 5, 10, 15, m[8], m[9]);
    g(s, 1, 6, 11, 12, m[10], m[11]);
    g(s, 2, 7, 8, 13, m[12], m[13]);
    g(s, 3, 4, 9, 14, m[14], m[15]);
    if (r < 6) {
      const p = new Array(16);
      for (let i = 0; i < 16; i++) p[i] = m[MSG_PERMUTATION[i]];
      m = p;
    }
  }
  for (let i = 0; i < 8; i++) {
    s[i] = (s[i] ^ s[i + 8]) >>> 0;
    s[i + 8] = (s[i + 8] ^ cv[i]) >>> 0;
  }
  return s;
}

// 从字节数组按小端读 16 个 32 位字（不足补零）
function wordsFromBytes(bytes, start, len) {
  const bb = new Uint8Array(64);
  for (let i = 0; i < len; i++) bb[i] = bytes[start + i];
  const w = new Array(16);
  for (let i = 0; i < 16; i++) {
    w[i] = (bb[i * 4] | (bb[i * 4 + 1] << 8) | (bb[i * 4 + 2] << 16) | (bb[i * 4 + 3] << 24)) >>> 0;
  }
  return w;
}

// chunk → output 对象（最后一块作为可 root 化的输出，前面的块压进 cv）
function chunkOutput(input, start, len, chunkIndex, flags) {
  let cv = IV.slice();
  const nBlocks = Math.max(1, Math.ceil(len / 64));
  for (let i = 0; i < nBlocks; i++) {
    const blockStart = i * 64;
    const blockLen = Math.min(64, len - blockStart);
    const block = wordsFromBytes(input, start + blockStart, blockLen);
    let bf = flags;
    if (i === 0) bf |= CHUNK_START;
    if (i === nBlocks - 1) bf |= CHUNK_END;
    if (i === nBlocks - 1) {
      return { inputCV: cv, block, counter: chunkIndex, blockLen, flags: bf };
    }
    cv = compress(cv, block, chunkIndex, blockLen, bf).slice(0, 8);
  }
}

function parentOutput(leftCV, rightCV, flags) {
  return { inputCV: IV.slice(), block: leftCV.concat(rightCV), counter: 0, blockLen: 64, flags: flags | PARENT };
}

function outputCV(o) {
  return compress(o.inputCV, o.block, o.counter, o.blockLen, o.flags).slice(0, 8);
}

// 最大的严格小于 n 的 2 的幂（n>1）
function largestPow2Below(n) {
  let p = 1;
  while (p * 2 < n) p *= 2;
  return p;
}

// 递归树：返回根 output 对象
function hashTree(input, start, len, chunkIndexStart, flags) {
  if (len <= 1024) {
    return chunkOutput(input, start, len, chunkIndexStart, flags);
  }
  const nChunks = Math.ceil(len / 1024);
  const leftChunks = largestPow2Below(nChunks);
  const leftLen = leftChunks * 1024;
  const leftCV = outputCV(hashTree(input, start, leftLen, chunkIndexStart, flags));
  const rightCV = outputCV(hashTree(input, start + leftLen, len - leftLen, chunkIndexStart + leftChunks, flags));
  return parentOutput(leftCV, rightCV, flags);
}

// 根输出扩展到 outLen 字节（XOF）
function rootBytes(o, outLen) {
  const out = new Uint8Array(outLen);
  let pos = 0;
  let ctr = 0;
  while (pos < outLen) {
    const words = compress(o.inputCV, o.block, ctr, o.blockLen, o.flags | ROOT);
    for (let w = 0; w < 16 && pos < outLen; w++) {
      const word = words[w] >>> 0;
      for (let b = 0; b < 4 && pos < outLen; b++) out[pos++] = (word >>> (8 * b)) & 0xff;
    }
    ctr++;
  }
  return out;
}

function blake3(inputBytes, outLen = 32) {
  const o = hashTree(inputBytes, 0, inputBytes.length, 0, 0);
  return rootBytes(o, outLen);
}

// ============ 编解码工具 ============
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function blake3Run(text, p = {}) {
  const inputMode = (p && p.inputMode) || "text";
  let input;
  if (inputMode === "hex") input = hexToBytes(String(text || ""));
  else input = new TextEncoder().encode(String(text || ""));

  let outLen = parseInt((p && p.outLen) || "32", 10);
  if (!Number.isFinite(outLen) || outLen < 1) outLen = 32;
  if (outLen > 4096) outLen = 4096; // 防滥用

  const digest = blake3(input, outLen);
  const lines = [];
  lines.push("=== BLAKE3 加密哈希 ===");
  lines.push(`输入: ${input.length} 字节（${inputMode}）`);
  lines.push(`输出长度: ${outLen} 字节（XOF 可扩展）`);
  lines.push("");
  lines.push(`hex:    ${bytesToHex(digest)}`);
  lines.push(`base64: ${bytesToB64(digest)}`);
  return lines.join("\n");
}

register({
  id: "blake3",
  cat: "hash",
  name: "BLAKE3",
  desc: "BLAKE3 加密哈希（O'Connor/Aumasson/Neves/Wilcox-O'Hearn 2020）：BLAKE2 G 函数 + Merkle 树 + 无限输出（XOF）。7 轮压缩，chunk=1024 字节。默认 32 字节输出，可扩展。官方 test_vectors 验证。",
  params: [
    {
      key: "inputMode", label: "输入形式", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
    { key: "outLen", label: "输出字节数", type: "number", default: 32, placeholder: "默认 32（XOF 可扩展，最大 4096）" },
  ],
  run: blake3Run,
});

export { blake3, compress, bytesToHex, hexToBytes };
