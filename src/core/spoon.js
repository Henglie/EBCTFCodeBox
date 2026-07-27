/*
 * spoon.js — Spoon 深奥语言（Brainfuck 的前缀码二进制变体，T267）。
 *
 * Spoon（Steven Goodwin 设计）把 Brainfuck 的 8 个指令换成一套可变长前缀码
 * （霍夫曼式），整段源程序因此变成一串 0/1。本模块做 Brainfuck ↔ Spoon 双向转换。
 *
 * 映射表来源：esolangs.org「Spoon」页面（8 条 BF 指令 + 1 条 Debug）：
 * + 1 - 000 > 010 < 011
 * [ 00100 ] 0011 . 001010 , 0010110
 * Debug 00101110（BF 无对应指令，解码时消费但不产出字符）
 * 该码表是前缀码（任一码都不是另一码的前缀），故可逐位贪婪解析、无歧义。
 *
 * 与其它 esolang 模块（fancy.js 的 brainfuck、esolang2.js 的 deadfish 等）解耦
 * 仅共享 registry；风格对齐同目录已有 op。
 */
import { register } from "./registry.js";

// Brainfuck 指令 → Spoon 码（编码只产出这 8 个，其余字符一律忽略）
const BF_TO_SPOON = {
  "+": "1",
  "-": "000",
  ">": "010",
  "<": "011",
  "[": "00100",
  "]": "0011",
  ".": "001010",
  ",": "0010110",
};

// Spoon 码 → Brainfuck 指令（多含 Debug 码；BF 无对应，故映射为空串——解码时消费但不产出）
const SPOON_TO_BF = {
  "1": "+",
  "000": "-",
  "010": ">",
  "011": "<",
  "00100": "[",
  "0011": "]",
  "001010": ".",
  "0010110": ",",
  "00101110": "", // Debug：消费但不产出字符
};

// 所有码的「真前缀」集合。逐位解析时用它判断当前缓冲区是否仍可能构成合法码
// 若缓冲区既非完整码、又不在前缀集合里，即为非法比特序列。
const _SPOON_PREFIXES = new Set();
for (const code of Object.keys(SPOON_TO_BF)) {
  for (let i = 1; i < code.length; i++) _SPOON_PREFIXES.add(code.slice(0, i));
}

// encode：Brainfuck 源码 → Spoon 二进制串。只保留 8 条指令，注释/空白等其余字符忽略。
function spoonEncode(text) {
  let out = "";
  for (const ch of String(text)) {
    const code = BF_TO_SPOON[ch];
    if (code !== undefined) out += code;
  }
  return out;
}

// 逐位贪婪解析 Spoon 比特串 → Brainfuck。前缀码保证贪婪匹配无歧义。
// strict=true（decode 用）：遇非法比特 / 末尾残余即抛错。
// strict=false（detect 用）：遇错返回 null，不抛异常。
function spoonParse(bits, strict) {
  let out = "";
  let buf = "";
  for (const b of bits) {
    buf += b;
    const bf = SPOON_TO_BF[buf];
    if (bf !== undefined) {
      out += bf; // 命中完整码（Debug 命中为空串）
      buf = "";
    } else if (!_SPOON_PREFIXES.has(buf)) {
      if (strict) throw new Error(`Spoon: 无法解析的比特序列 "${buf}"`);
      return null;
    }
  }
  if (buf !== "") {
    if (strict) throw new Error(`Spoon: 末尾有不完整的比特 "${buf}"`);
    return null;
  }
  return out;
}

// decode：Spoon 二进制串 → Brainfuck 源码。先剔除所有非 0/1 字符（空白 / 分隔符等）。
function spoonDecode(text) {
  const bits = String(text).replace(/[^01]/g, "");
  if (!bits) return "";
  return spoonParse(bits, true);
}

// detect：输入基本只含 0/1（可含少量空白），去空白后非空且能被前缀码完整解析 → 中等分。
function spoonDetect(text) {
  const s = String(text).trim();
  if (!s) return 0;
  if (!/^[01\s]+$/.test(s)) return 0;
  const bits = s.replace(/\s+/g, "");
  if (bits.length < 3) return 0;
  return spoonParse(bits, false) === null ? 0 : 0.5;
}

// ---- 注册 ----
register({
  id: "spoon", cat: "fancy", name: "Spoon",
  desc: "Brainfuck 的前缀码二进制变体（8 指令映射为霍夫曼式 0/1 串，双向严格往返）",
  encode: spoonEncode, decode: spoonDecode,
  detect: spoonDetect,
});

export { spoonEncode, spoonDecode, spoonParse, BF_TO_SPOON, SPOON_TO_BF };
