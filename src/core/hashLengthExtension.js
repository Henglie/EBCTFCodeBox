/*
 * hashLengthExtension.js — 哈希长度扩展攻击（cat:'crypto'，run 型）。
 *
 * 定位：CTF web/crypto 高频题。给定 H(secret) 和 len(secret)，构造
 * H(secret || padding || append) 而不需要知道 secret——MD5/SHA1/SHA256 等
 * Merkle-Damgård 结构哈希的固有弱点。对应 ctf-wiki crypto/hash/attack。
 *
 * 原理：Merkle-Damgård 哈希把消息分 64 字节块压缩，最终 state 即 hash 输出。
 * 攻击者从 hash 反推内部 state，把它当压缩函数的"初始 state"，继续压缩 append
 * 得到 new_hash = H(secret || padding || append)。padding = 0x80 + 0x00* + 64 位长度。
 *
 * 落地范围：
 * - **MD5**（核心，CTF 最常见）：纯 JS 实现，复用 hash.js md5Bytes 的压缩函数逻辑
 * 但 state 从 hash 反推（4 个 32 位小端字）+ 不重新 init，继续压缩 append。
 * - **SHA-1 / SHA-256**：本项目的 SHA1/SHA256 走 WebCrypto 不暴露内部 state
 * 无法直接用。给出降级提示：用 hashpump（命令行）或本 op 的 MD5 路径。
 *
 * 输入：
 * - originalHash：32 hex（MD5）/ 40 hex（SHA1）/ 64 hex（SHA256）
 * - originalLength：secret 字节数
 * - appendData：要追加的数据（按 appendEnc 解码）
 * - algo：md5（默认）/ sha1 / sha256（后两者降级提示）
 *
 * 输出：
 * - newHash：构造出的新哈希 hex
 * - newMessage：secret_padding_append 的字节串（hex/base64，UI 给 base64 便于复制）
 * - 注：actual secret 未知，newMessage 中 secret 部分用占位符标注
 *
 * 红线：
 * - 算法层零 UI 依赖（仅 registry）。
 * - 零外发：纯本地计算。
 * - 件内自注册（register(op)）。
 *
 * 契约：register({id, cat:'crypto', name, desc, params, run})。
 *
 * 参考：
 * - 落地照 RFC 1321 MD5 压缩函数（与 hash.js 一致），仅改 init state 来源。
 * - ctf-wiki crypto/hash/attack.md
 * - hashpump 工具对照
 */
import { register } from "./registry.js";

// ============================================================
// 工具
// ============================================================
const M32 = 0xffffffff;
function rotl(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }

function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度需为偶数");
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

// MD5 K/S 表（RFC 1321，与 hash.js 一致）
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const MD5_K = [
  0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
  0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
  0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
  0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
  0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
  0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
  0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
  0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

/**
 * MD5 压缩函数：给定初始 state [a0,b0,c0,d0]（4 个 32 位字）和 64 字节块
 * 返回压缩后的新 state [a0',b0',c0',d0']。不处理 padding（外部已处理）。
 */
function md5CompressBlock(state, block) {
 // block: 64 字节，按 16 个 32 位小端字读
  const dv = new DataView(block.buffer, block.byteOffset, 64);
  const M = new Array(16);
  for (let i = 0; i < 16; i++) M[i] = dv.getUint32(i * 4, true);
  let A = state[0], B = state[1], C = state[2], D = state[3];
  for (let i = 0; i < 64; i++) {
    let F, g;
    if (i < 16) { F = (B & C) | (~B & D); g = i; }
    else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
    else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
    else { F = C ^ (B | ~D); g = (7 * i) % 16; }
    F = (F + A + MD5_K[i] + M[g]) >>> 0;
    A = D; D = C; C = B;
    B = (B + rotl(F, MD5_S[i])) >>> 0;
  }
  return [
    (state[0] + A) >>> 0,
    (state[1] + B) >>> 0,
    (state[2] + C) >>> 0,
    (state[3] + D) >>> 0,
  ];
}

/**
 * MD5 长度扩展攻击。
 * @param {string} originalHashHex 32 hex（MD5）
 * @param {number} originalLen secret 字节数
 * @param {Uint8Array} appendData 追加数据
 * @returns {{newHashHex, newMessageBytes, paddingBytes}}
 */
function md5LengthExtension(originalHashHex, originalLen, appendData) {
 // 1. 从 hash 反推 state：MD5 hash 是 a0||b0||c0||d0 小端拼 hex
  const hashBytes = hexToBytes(originalHashHex);
  if (hashBytes.length !== 16) {
    throw new Error("MD5 hash 需 32 hex 字符（16 字节）");
  }
  const dv = new DataView(hashBytes.buffer, hashBytes.byteOffset, 16);
  const state = [
    dv.getUint32(0, true),
    dv.getUint32(4, true),
    dv.getUint32(8, true),
    dv.getUint32(12, true),
  ];

 // 2. 算 original_message 的 padding（glue padding）：
 // 0x80 + 0x00*pad + 64 位小端 bit 长度
 // 总长（含 0x80 + 长度域 8 字节）需为 64 倍数
  const bitLen = BigInt(originalLen) * 8n;
  const withOne = originalLen + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const paddingLen = 1 + k + 8;
  const padding = new Uint8Array(paddingLen);
  padding[0] = 0x80;
 // k 个 0x00 已默认 0
  const padDv = new DataView(padding.buffer);
  padDv.setUint32(paddingLen - 8, Number(bitLen & 0xffffffffn), true);
  padDv.setUint32(paddingLen - 4, Number((bitLen >> 32n) & 0xffffffffn), true);

 // 3. 构造 new_message = padding + appendData（secret 部分未知，只构造 suffix）
 // 实际请求里 new_message = secret || padding || appendData
 // 攻击者构造的 suffix = padding || appendData（发送时前置 secret 即完整）
  const newMessageSuffix = new Uint8Array(padding.length + appendData.length);
  newMessageSuffix.set(padding, 0);
  newMessageSuffix.set(appendData, padding.length);

 // 4. 用恢复的 state 继续压缩 appendData（需自己补 padding）
 // 压缩流程：appendData || glue_padding2（appendData 的 padding）
 // 总输入到压缩函数的字节流：appendData + 0x80 + 0x00*pad2 + 64 位小端 bit 长度2
 // 其中 bit 长度2 = (originalLen + paddingLen + appendData.length) * 8
 // （state 已"知道"前面有 originalLen + paddingLen 字节，新压缩以 appendData 起算）
  const totalPrecedingLen = originalLen + paddingLen; // state 隐含已处理字节数
  const totalLen = totalPrecedingLen + appendData.length;
  const bitLen2 = BigInt(totalLen) * 8n;
  const withOne2 = appendData.length + 1;
  const k2 = (56 - (withOne2 % 64) + 64) % 64;
  const total2 = withOne2 + k2 + 8;
  const appendPadded = new Uint8Array(total2);
  appendPadded.set(appendData, 0);
  appendPadded[appendData.length] = 0x80;
  const apDv = new DataView(appendPadded.buffer);
  apDv.setUint32(total2 - 8, Number(bitLen2 & 0xffffffffn), true);
  apDv.setUint32(total2 - 4, Number((bitLen2 >> 32n) & 0xffffffffn), true);

 // 5. 用 state 作 init，逐块压缩 appendPadded
  let curState = state;
  for (let off = 0; off < total2; off += 64) {
    const block = appendPadded.subarray(off, off + 64);
    curState = md5CompressBlock(curState, block);
  }

 // 6. newHash = a0'||b0'||c0'||d0' 小端拼 hex
  const newHash = new Uint8Array(16);
  const nhDv = new DataView(newHash.buffer);
  nhDv.setUint32(0, curState[0], true);
  nhDv.setUint32(4, curState[1], true);
  nhDv.setUint32(8, curState[2], true);
  nhDv.setUint32(12, curState[3], true);
  const newHashHex = bytesToHex(newHash);

  return {
    newHashHex,
    newMessageSuffix, // 即 padding || appendData
    paddingBytes: padding,
  };
}

// ============================================================
// SHA-1 / SHA-256 压缩函数（Merkle-Damgård，大端序）
// ============================================================
// SHA-1 单块压缩：state = 5 个 32 位字，block = 64 字节（大端）
function sha1CompressBlock(state, block) {
  const dv = new DataView(block.buffer, block.byteOffset, 64);
  const w = new Array(80);
  for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4, false); // 大端
  for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
  let a = state[0], b = state[1], c = state[2], d = state[3], e = state[4];
  for (let i = 0; i < 80; i++) {
    let f, k;
    if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
    else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
    else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
    else { f = b ^ c ^ d; k = 0xca62c1d6; }
    const tmp = (rotl(a, 5) + f + e + k + w[i]) >>> 0;
    e = d; d = c; c = rotl(b, 30); b = a; a = tmp;
  }
  return [
    (state[0] + a) >>> 0, (state[1] + b) >>> 0, (state[2] + c) >>> 0,
    (state[3] + d) >>> 0, (state[4] + e) >>> 0,
  ];
}

// SHA-256 K 表（FIPS 180-4）
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) >>> 0; }

// SHA-256 单块压缩：state = 8 个 32 位字，block = 64 字节（大端）
function sha256CompressBlock(state, block) {
  const dv = new DataView(block.buffer, block.byteOffset, 64);
  const w = new Array(64);
  for (let i = 0; i < 16; i++) w[i] = dv.getUint32(i * 4, false);
  for (let i = 16; i < 64; i++) {
    const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
    const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  let a = state[0], b = state[1], c = state[2], d = state[3];
  let e = state[4], f = state[5], g = state[6], h = state[7];
  for (let i = 0; i < 64; i++) {
    const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const ch = (e & f) ^ (~e & g);
    const t1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
    const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    h = g; g = f; f = e; e = (d + t1) >>> 0;
    d = c; c = b; b = a; a = (t1 + t2) >>> 0;
  }
  return [
    (state[0] + a) >>> 0, (state[1] + b) >>> 0, (state[2] + c) >>> 0, (state[3] + d) >>> 0,
    (state[4] + e) >>> 0, (state[5] + f) >>> 0, (state[6] + g) >>> 0, (state[7] + h) >>> 0,
  ];
}

/**
 * 大端 Merkle-Damgård 长度扩展（SHA-1 / SHA-256 共用）。
 * @param {string} originalHashHex 40 hex(SHA1) / 64 hex(SHA256)
 * @param {number} originalLen secret 字节数
 * @param {Uint8Array} appendData 追加数据
 * @param {{words:number, compress:function}} cfg 算法配置
 */
function beLengthExtension(originalHashHex, originalLen, appendData, cfg) {
  const nWords = cfg.words;
  const hashBytes = hexToBytes(originalHashHex);
  if (hashBytes.length !== nWords * 4) {
    throw new Error(`${cfg.name} hash 需 ${nWords * 4 * 2} hex 字符（${nWords * 4} 字节）`);
  }
  // 1. 反推 state（大端）
  const dv = new DataView(hashBytes.buffer, hashBytes.byteOffset, nWords * 4);
  const state = [];
  for (let i = 0; i < nWords; i++) state.push(dv.getUint32(i * 4, false));

  // 2. 原消息 glue padding（0x80 + 0x00* + 64 位大端 bit 长度）
  const bitLen = BigInt(originalLen) * 8n;
  const withOne = originalLen + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const paddingLen = 1 + k + 8;
  const padding = new Uint8Array(paddingLen);
  padding[0] = 0x80;
  const padDv = new DataView(padding.buffer);
  padDv.setUint32(paddingLen - 8, Number((bitLen >> 32n) & 0xffffffffn), false); // 大端高位在前
  padDv.setUint32(paddingLen - 4, Number(bitLen & 0xffffffffn), false);

  const newMessageSuffix = new Uint8Array(padding.length + appendData.length);
  newMessageSuffix.set(padding, 0);
  newMessageSuffix.set(appendData, padding.length);

  // 3. append 自身的 padding（bit 长度2 = 全部前置字节 + append）
  const totalPrecedingLen = originalLen + paddingLen;
  const totalLen = totalPrecedingLen + appendData.length;
  const bitLen2 = BigInt(totalLen) * 8n;
  const withOne2 = appendData.length + 1;
  const k2 = (56 - (withOne2 % 64) + 64) % 64;
  const total2 = withOne2 + k2 + 8;
  const appendPadded = new Uint8Array(total2);
  appendPadded.set(appendData, 0);
  appendPadded[appendData.length] = 0x80;
  const apDv = new DataView(appendPadded.buffer);
  apDv.setUint32(total2 - 8, Number((bitLen2 >> 32n) & 0xffffffffn), false);
  apDv.setUint32(total2 - 4, Number(bitLen2 & 0xffffffffn), false);

  // 4. 用 state 逐块压缩
  let curState = state;
  for (let off = 0; off < total2; off += 64) {
    curState = cfg.compress(curState, appendPadded.subarray(off, off + 64));
  }

  // 5. 拼新 hash（大端）
  const newHash = new Uint8Array(nWords * 4);
  const nhDv = new DataView(newHash.buffer);
  for (let i = 0; i < nWords; i++) nhDv.setUint32(i * 4, curState[i], false);

  return { newHashHex: bytesToHex(newHash), newMessageSuffix, paddingBytes: padding };
}

// ============================================================
// run：主入口
// ============================================================
function hashLengthExtensionRun(text, p) {
  const lines = [];
  lines.push("=== 哈希长度扩展攻击（Merkle-Damgård 弱点） ===");
  lines.push("");

  const algo = (p && p.algo) || "md5";
  const originalHash = String((p && p.originalHash) || "").trim();
  const origLen = parseInt((p && p.originalLength) || "0", 10) || 0;
  const appendRaw = String(text || "");
  const appendEnc = (p && p.appendEnc) || "auto";

  if (!originalHash) {
    lines.push("✗ 未填「原哈希」参数。请填 H(secret) 的 hex 值。");
    return lines.join("\n");
  }
  if (origLen <= 0) {
    lines.push("✗ 未填「secret 字节长度」或为 0。");
    return lines.join("\n");
  }

 // 解码 appendData
  let appendData;
  try {
    const s = appendRaw.trim();
    if (appendEnc === "hex") {
      appendData = hexToBytes(s);
    } else if (appendEnc === "utf8") {
      appendData = new TextEncoder().encode(appendRaw);
    } else if (appendEnc === "base64") {
      const bin = atob(s.replace(/\s/g, ""));
      appendData = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) appendData[i] = bin.charCodeAt(i);
    } else {
 // auto: hex 优先（偶数+全 hex 字符），否则 utf8
      const stripped = s.replace(/\s/g, "");
      if (/^[0-9a-fA-F]+$/.test(stripped) && stripped.length % 2 === 0) {
        appendData = hexToBytes(s);
      } else {
        appendData = new TextEncoder().encode(appendRaw);
      }
    }
  } catch (e) {
    lines.push("✗ append 数据解析失败: " + (e.message || String(e)));
    return lines.join("\n");
  }

  lines.push("算法: " + algo.toUpperCase());
  lines.push("原哈希: " + originalHash);
  lines.push("secret 长度: " + origLen + " 字节");
  lines.push("append 数据: " + appendData.length + " 字节（" + appendEnc + " 解码）");
  lines.push("");

  if (algo === "md5") {
    try {
      const r = md5LengthExtension(originalHash, origLen, appendData);
      lines.push("--- 构造结果 ---");
      lines.push("新哈希 new_hash = " + r.newHashHex);
      lines.push("");
      lines.push("新消息后缀 new_message_suffix = padding || append（" + r.newMessageSuffix.length + " 字节）:");
      lines.push("  hex: " + bytesToHex(r.newMessageSuffix));
      lines.push("  base64: " + bytesToB64(r.newMessageSuffix));
      lines.push("");
      lines.push("完整新消息: secret || padding || append（secret 未知，用真实 secret 前置即可）");
      lines.push("  glue padding: " + bytesToHex(r.paddingBytes) + "（" + r.paddingBytes.length + " 字节）");
      lines.push("");
      lines.push("用法：");
      lines.push("  · 服务器校验 H(secret || msg) == 你提交的 new_hash 时，");
      lines.push("    把 msg 替换为 padding || append，hash 用 new_hash，即可绕过 secret 校验。");
      lines.push("  · new_message_suffix 是后缀，发送时前置 secret（服务器自动拼）即可。");
      lines.push("  · 验证：H(secret || new_message_suffix) 应等于 new_hash（用本工具箱 MD5 op 对拍）。");
    } catch (e) {
      lines.push("✗ " + (e.message || String(e)));
    }
    return lines.join("\n");
  }

  if (algo === "sha1" || algo === "sha256") {
    const cfg = algo === "sha1"
      ? { name: "SHA-1", words: 5, compress: sha1CompressBlock }
      : { name: "SHA-256", words: 8, compress: sha256CompressBlock };
    try {
      const r = beLengthExtension(originalHash, origLen, appendData, cfg);
      lines.push("--- 构造结果 ---");
      lines.push("新哈希 new_hash = " + r.newHashHex);
      lines.push("");
      lines.push("新消息后缀 new_message_suffix = padding || append（" + r.newMessageSuffix.length + " 字节）:");
      lines.push("  hex: " + bytesToHex(r.newMessageSuffix));
      lines.push("  base64: " + bytesToB64(r.newMessageSuffix));
      lines.push("");
      lines.push("完整新消息: secret || padding || append（secret 未知，用真实 secret 前置即可）");
      lines.push("  glue padding: " + bytesToHex(r.paddingBytes) + "（" + r.paddingBytes.length + " 字节）");
      lines.push("");
      lines.push("用法：");
      lines.push("  · 服务器校验 " + cfg.name + "(secret || msg) == 你提交的 new_hash 时，");
      lines.push("    把 msg 替换为 padding || append，hash 用 new_hash，即可绕过 secret 校验。");
      lines.push("  · new_message_suffix 是后缀，发送时前置 secret（服务器自动拼）即可。");
      lines.push("  · 验证：" + cfg.name + "(secret || new_message_suffix) 应等于 new_hash（用本工具箱 " + cfg.name + " op 对拍）。");
    } catch (e) {
      lines.push("✗ " + (e.message || String(e)));
    }
    return lines.join("\n");
  }

  return "未知算法: " + algo;
}

// ============================================================
// 注册
// ============================================================
register({
  id: "hashLengthExtension",
  cat: "crypto",
  name: "哈希长度扩展攻击（MD5/SHA1/SHA256）",
  desc: "Merkle-Damgård 弱点：从 H(secret) 和 len(secret) 构造 H(secret||padding||append) 而不知 secret。MD5/SHA-1/SHA-256 全部纯 JS 落地（内部 state 反推 + 续压），无需 hashpump",
  params: [
    {
      key: "algo", label: "算法", type: "select", default: "md5",
      options: [
        { value: "md5", label: "MD5（纯 JS）" },
        { value: "sha1", label: "SHA-1（纯 JS）" },
        { value: "sha256", label: "SHA-256（纯 JS）" },
      ],
    },
    { key: "originalHash", label: "原哈希 H(secret)（hex）", type: "text", default: "", placeholder: "32 hex (MD5) / 40 hex (SHA1) / 64 hex (SHA256)" },
    { key: "originalLength", label: "secret 字节长度", type: "number", default: 0, placeholder: "secret 的字节数（必填）" },
    {
      key: "appendEnc", label: "append 数据编码", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/utf8）" },
        { value: "hex", label: "Hex" },
        { value: "utf8", label: "UTF-8 文本" },
        { value: "base64", label: "Base64" },
      ],
    },
  ],
  run: hashLengthExtensionRun,
});

export { md5LengthExtension, md5CompressBlock };
