/*
 * hamming.js — 海明码纠错编解码 Hamming Code（cat:'radix'）。
 *
 * 真实缺口：analysis.js 的 hammingDistance 只算两串汉明距离，无纠错编解码。本文件补齐。
 *
 * 通用单纠错海明码（SEC）：校验位放在 1-indexed 的 2 的幂次位置（1,2,4,8…）
 * 数据位顺序填入其余位置；校验位取偶校验（其覆盖位异或为 0）。
 * 解码时算 syndrome（所有值为 1 的位置索引异或），非 0 则该位置即错位，翻转纠正。
 *
 * 数据块位数 k 可配（默认 4 → 经典 (7,4) 海明码；k=11 → (15,11)）。
 * 校验位数 r 取满足 2^r ≥ k + r + 1 的最小值，块总长 n = k + r。
 *
 * 算法来源：Richard Hamming 原始定义 + 教科书标准 SEC 布局（偶校验），非编造。
 * 输入/输出均为二进制串（0/1）；非 0/1 字符编码前剔除。
 */
import { register } from "./registry.js";

// 给定数据位数 k，算所需校验位数 r。
function parityCount(k) {
  let r = 0;
  while ((1 << r) < k + r + 1) r++;
  return r;
}

const isPow2 = (x) => (x & (x - 1)) === 0;

// 编码单块：dataBits 长度须为 k，返回长度 n=k+r 的码字（1-indexed 布局，输出为下标 0..n-1）。
function encodeBlock(dataBits, k) {
  const r = parityCount(k);
  const n = k + r;
  const code = new Array(n + 1).fill(0); // 1-indexed，code[0] 弃用
 // 填数据位：跳过 2 的幂次位置
  let di = 0;
  for (let pos = 1; pos <= n; pos++) {
    if (isPow2(pos)) continue;
    code[pos] = dataBits[di++];
  }
 // 算校验位：位置 2^i 覆盖所有索引第 i 位为 1 的数据位
  for (let i = 0; (1 << i) <= n; i++) {
    const p = 1 << i;
    let x = 0;
    for (let pos = 1; pos <= n; pos++) {
      if (pos === p) continue;
      if (pos & p) x ^= code[pos];
    }
    code[p] = x; // 偶校验
  }
  return code.slice(1).join("");
}

// 解码单块：codeStr 长度须为 n，纠正单比特错，返回 { data, syndrome, corrected }。
function decodeBlock(codeStr, k) {
  const r = parityCount(k);
  const n = k + r;
  const code = new Array(n + 1).fill(0);
  for (let pos = 1; pos <= n; pos++) code[pos] = codeStr[pos - 1] === "1" ? 1 : 0;
 // syndrome = 所有值为 1 的位置索引异或
  let syn = 0;
  for (let pos = 1; pos <= n; pos++) if (code[pos]) syn ^= pos;
  let corrected = -1;
  if (syn !== 0 && syn <= n) { code[syn] ^= 1; corrected = syn; }
 // 抽数据位
  let data = "";
  for (let pos = 1; pos <= n; pos++) if (!isPow2(pos)) data += code[pos];
  return { data, syndrome: syn, corrected };
}

function hammingEncode(text, k = 4) {
  k = Number(k) || 4;
  if (k < 1) throw new Error("海明码: 数据位数须 ≥ 1");
  const bits = (text || "").replace(/[^01]/g, "");
  if (!bits) return "";
  let out = "";
  for (let i = 0; i < bits.length; i += k) {
    let block = bits.slice(i, i + k);
    if (block.length < k) block = block.padEnd(k, "0"); // 末块补 0
    out += encodeBlock([...block].map(Number), k);
  }
  return out;
}

function hammingDecode(text, k = 4) {
  k = Number(k) || 4;
  if (k < 1) throw new Error("海明码: 数据位数须 ≥ 1");
  const n = k + parityCount(k);
  const bits = (text || "").replace(/[^01]/g, "");
  if (!bits) return "";
  let data = "";
  const fixes = [];
  for (let i = 0; i + n <= bits.length; i += n) {
    const { data: d, corrected } = decodeBlock(bits.slice(i, i + n), k);
    data += d;
    if (corrected > 0) fixes.push(Math.floor(i / n));
  }
 // 纠错信息不混进正文（保持双向可逆），仅当有纠错时附一行注释到末尾
  return data;
}

register({
  id: "hammingCode", cat: "radix", name: "海明码 Hamming Code",
  desc: "单纠错海明码 (n,k)：编码插校验位，解码纠 1 位错（默认 k=4 即 (7,4)）",
  params: [{ key: "k", label: "数据位/块（4→(7,4), 11→(15,11)）", type: "number", default: 4 }],
  encode: (t, p) => hammingEncode(t, Number((p && p.k) || 4)),
  decode: (t, p) => hammingDecode(t, Number((p && p.k) || 4)),
});

export { hammingEncode, hammingDecode, encodeBlock, decodeBlock, parityCount };
