/*
 * pearson.js — Pearson 哈希（cat:'hash'，run 型）。
 *
 * Peter K. Pearson《Fast Hashing of Variable-Length Text Strings》(CACM 1990)。
 * 结构极简：h := 0；对消息每字节 c：h := T[h ^ c]；输出 h。
 *   T 是 0..255 的一个置换表（实现自定义，无唯一"官方"表）。
 *   本实现采用广为引用的 Wikipedia 参考置换表。
 *
 * 多字节输出扩展（标准做法）：对第 j 个输出字节，用 (msg[0] + j) mod 256
 *   作为首字节的替身再跑一遍，拼成 n 字节摘要。空串则以 j 作种子。
 *
 * 自检（载入时）：T 必须是 0..255 的合法置换（每值恰好出现一次）——
 *   这是 Pearson 表的唯一正确性不变量（表本身非标准化，故无通用向量）。
 *
 * 红线：算法照原论文；表为合法置换（载入自检）；纯本地零外发；core 层零 UI 依赖。
 *
 * 契约：register({ id:"pearson", cat:"hash", name, desc, params, run })。
 */
import { register } from "./registry.js";

// Wikipedia「Pearson hashing」参考置换表（0..255 的一个排列）
const T = Uint8Array.from([
  98, 6, 85, 150, 36, 23, 112, 164, 135, 207, 169, 5, 26, 64, 165, 219,
  61, 20, 68, 89, 130, 63, 52, 102, 24, 229, 132, 245, 80, 216, 195, 115,
  90, 168, 156, 203, 177, 120, 2, 190, 188, 7, 100, 185, 174, 243, 162, 10,
  237, 18, 253, 225, 8, 208, 172, 244, 255, 126, 101, 79, 145, 235, 228, 121,
  123, 251, 67, 250, 161, 0, 107, 97, 241, 111, 181, 82, 249, 33, 69, 55,
  59, 153, 29, 9, 213, 167, 84, 93, 30, 46, 94, 75, 151, 114, 73, 222,
  197, 96, 210, 45, 16, 227, 248, 202, 51, 152, 252, 125, 81, 206, 215, 186,
  39, 158, 178, 187, 131, 136, 1, 49, 50, 17, 141, 91, 47, 129, 60, 99,
  154, 35, 86, 171, 105, 34, 38, 200, 147, 58, 77, 118, 173, 246, 76, 254,
  133, 232, 196, 144, 198, 124, 53, 4, 108, 74, 223, 234, 134, 230, 157, 139,
  189, 205, 199, 128, 176, 19, 211, 236, 127, 192, 231, 70, 233, 88, 146, 44,
  183, 201, 22, 83, 13, 214, 116, 109, 159, 32, 95, 226, 140, 220, 57, 12,
  221, 31, 209, 182, 143, 92, 149, 184, 148, 62, 113, 65, 37, 27, 106, 166,
  3, 14, 204, 72, 21, 41, 56, 66, 28, 193, 40, 217, 25, 54, 179, 117,
  238, 87, 240, 155, 180, 170, 242, 212, 191, 163, 78, 218, 137, 194, 175, 110,
  43, 119, 224, 71, 122, 142, 42, 160, 104, 48, 247, 103, 15, 11, 138, 239,
]);

// 载入自检：T 必须是 0..255 合法置换
(() => {
  if (T.length !== 256) throw new Error("Pearson 表长度须为 256");
  const seen = new Uint8Array(256);
  for (const v of T) seen[v]++;
  for (let i = 0; i < 256; i++) {
    if (seen[i] !== 1) throw new Error(`Pearson 表非合法置换（值 ${i} 出现 ${seen[i]} 次）`);
  }
})();

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/**
 * Pearson 哈希，输出 n 字节。
 * @param {Uint8Array} data 消息字节
 * @param {number} n 输出字节数（1..32）
 * @returns {Uint8Array}
 */
function pearson(data, n = 1) {
  const out = new Uint8Array(n);
  for (let j = 0; j < n; j++) {
    // 第 j 字节：首字节用 (data[0] + j) mod 256 替身（空串以 j 为种子）
    let h = data.length ? T[(data[0] + j) & 0xff] : (T[j & 0xff]);
    for (let i = 1; i < data.length; i++) h = T[h ^ data[i]];
    out[j] = h;
  }
  return out;
}

function pearsonRun(text, p = {}) {
  const inputMode = (p && p.inputMode) || "text";
  let input;
  if (inputMode === "hex") input = hexToBytes(String(text || ""));
  else input = new TextEncoder().encode(String(text || ""));

  let n = parseInt((p && p.bytes) || 8, 10);
  if (!Number.isFinite(n) || n < 1) n = 8;
  if (n > 32) n = 32;

  const digest = pearson(input, n);
  const lines = [];
  lines.push("=== Pearson 哈希 ===");
  lines.push(`输入: ${input.length} 字节（${inputMode}）`);
  lines.push(`输出字节数: ${n}`);
  lines.push("");
  lines.push(`摘要 (hex): ${bytesToHex(digest)}`);
  lines.push(`摘要 (十进制): ${Array.from(digest).join(", ")}`);
  return lines.join("\n");
}

register({
  id: "pearson",
  cat: "hash",
  name: "Pearson 哈希",
  desc: "Pearson 快速哈希（CACM 1990）：h:=T[h^c] 逐字节迭代，T 为 0..255 置换表（Wikipedia 参考表）。极简非加密哈希，多字节输出用首字节替身扩展。可选输出 1..32 字节。",
  params: [
    {
      key: "inputMode", label: "输入形式", type: "select", default: "text",
      options: [
        { value: "text", label: "文本 (UTF-8)" },
        { value: "hex", label: "Hex" },
      ],
    },
    { key: "bytes", label: "输出字节数 (1..32)", type: "number", default: 8, placeholder: "默认 8" },
  ],
  run: pearsonRun,
});

export { pearson, T };
