/*
 * lzcodec.js — LZString / LZW 压缩（cat:'archive'，双向）。
 *
 * 两套格式，用 fmt 参数切换（默认 legacy，保证旧配方输出不变）：
 *
 *   legacy（默认）—— 本文件原有「原始 LZW → JSON 数字数组」：
 *     字典预填 0..255 单字符，编码结果如 "[12,34,56]"；只支持 Latin-1。
 *
 *   default / utf16 / base64 —— pieroxy/lz-string 标准格式，逐位兼容参考实现：
 *     default = LZString.compress / decompress
 *               16 bit/字符，输出为原始 UTF-16 码元串（可能含控制字符）
 *     utf16   = LZString.compressToUTF16 / decompressFromUTF16
 *               15 bit/字符，码元 +32，末尾补一个空格
 *     base64  = LZString.compressToBase64 / decompressFromBase64
 *               6 bit/字符，标准 Base64 字母表 + '=' 补齐
 *
 * 参考：pieroxy/lz-string 1.4.5/1.5.0（MIT/WTFPL）公开源码与测试向量；
 *       算法本身为 LZW + 变长码位打包。本文件按同一 bit 语义重写，未直接内嵌依赖。
 *
 * 默认值裁决：
 *   - 默认 legacy：旧配方 / 收藏 / 一键解码都按 JSON 数字数组消费，改默认会静默破坏；
 *   - 需要与网页/JS 题互通时显式选 base64（最常用）或 utf16；
 *   - 三种标准格式都可逆，测试用 pieroxy 官方测试串对拍。
 *
 * 注册 op：lzstring（id 不变，新增 fmt 参数）。
 * 红线：只改本文件；不新增 op id，不碰 registerAll / main / i18n / edu。
 */

import { register } from "./registry.js";

// ============================================================
// legacy：原始 LZW（预填 256 ASCII 单字符字典）
// 输入：字符串；输出：JSON 数字数组字符串
// 仅支持 Latin-1 字符（0-255），中文等多字节字符请先 UTF-8 编码。
// ============================================================
function lzwCompress(input) {
  if (input == null || input === "") return "[]";
  const dictionary = new Map();
  for (let i = 0; i < 256; i++) {
    dictionary.set(String.fromCharCode(i), i);
  }
  let dictSize = 256;
  let w = "";
  const result = [];

  for (let i = 0; i < input.length; i++) {
    const c = input.charAt(i);
    const code = c.charCodeAt(0);
    if (code > 255) {
      throw new Error("LZString legacy: 仅支持 Latin-1 字符（0-255），遇到字符码 " + code + "。中文等多字节字符请选 base64/utf16 标准模式，或先 UTF-8 编码");
    }
    const wc = w + c;
    if (dictionary.has(wc)) {
      w = wc;
    } else {
      result.push(dictionary.get(w));
      dictionary.set(wc, dictSize++);
      w = c;
    }
  }
  if (w !== "") {
    result.push(dictionary.get(w));
  }
  return JSON.stringify(result);
}

function lzwDecompress(input) {
  if (input == null || input === "") return null;
  let arr;
  try {
    arr = JSON.parse(input);
  } catch {
    throw new Error("LZString legacy 逆: 输入须为 JSON 数字数组（如 '[12,34,56]'）；若是标准 lz-string 串请切换格式参数");
  }
  if (!Array.isArray(arr)) throw new Error("LZString legacy 逆: 输入须为数字数组");
  if (arr.length === 0) return "";
  for (const v of arr) {
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      throw new Error("LZString legacy 逆: 数组项须为非负整数");
    }
  }

  const dictionary = [];
  for (let i = 0; i < 256; i++) {
    dictionary[i] = String.fromCharCode(i);
  }
  let dictSize = 256;

  let w = dictionary[arr[0]];
  if (w === undefined) {
    throw new Error("LZString legacy 逆: 无效索引 " + arr[0] + "（dictSize=" + dictSize + "）");
  }
  const result = [w];

  for (let i = 1; i < arr.length; i++) {
    const k = arr[i];
    let entry;
    if (k < dictSize) {
      entry = dictionary[k];
    } else if (k === dictSize) {
      entry = w + w.charAt(0);
    } else {
      throw new Error("LZString legacy 逆: 无效索引 " + k + "（dictSize=" + dictSize + "）");
    }
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    w = entry;
  }
  return result.join("");
}

// ============================================================
// pieroxy/lz-string 标准格式
// bitsPerChar: 16=default、15=UTF16、6=Base64；emitChar 决定码元落点。
// 位序与 lz-string _compress 完全一致：低位先写，写满 bitsPerChar 从高位侧补齐。
// ============================================================
const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_REVERSE = (() => {
  const m = new Map();
  for (let i = 0; i < BASE64_ALPHABET.length; i++) m.set(BASE64_ALPHABET[i], i);
  m.set("=", 64); // 参考实现 alphabet 末尾也含 '='，仅用于补齐，不会进入有效码流
  return m;
})();

function lzStringPack(uncompressed, bitsPerChar, emitChar) {
  if (uncompressed == null) return "";
  const dictionary = new Map();
  const dictionaryToCreate = new Set();
  let contextW = "";
  let enlargeIn = 2;
  let dictSize = 3;
  let numBits = 2;
  const data = [];
  let dataVal = 0;
  let dataPos = 0;

  const writeBit = (bit) => {
    dataVal = (dataVal << 1) | bit;
    if (dataPos === bitsPerChar - 1) {
      data.push(emitChar(dataVal));
      dataVal = 0;
      dataPos = 0;
    } else {
      dataPos++;
    }
  };
  const writeBits = (value, count) => {
    for (let i = 0; i < count; i++) {
      writeBit(value & 1);
      value >>= 1;
    }
  };
  // 首次出现的新字符：先 numBits 位 0（<256）或 numBits 位 1（>=256），再写 8/16 位码元
  const writeNewChar = (ch) => {
    const code = ch.charCodeAt(0);
    if (code < 256) {
      writeBits(0, numBits);
      writeBits(code, 8);
    } else {
      writeBits(1, numBits);
      writeBits(code, 16);
    }
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    dictionaryToCreate.delete(ch);
  };

  for (let ii = 0; ii < uncompressed.length; ii++) {
    const contextC = uncompressed.charAt(ii);
    if (!dictionary.has(contextC)) {
      dictionary.set(contextC, dictSize++);
      dictionaryToCreate.add(contextC);
    }

    const contextWC = contextW + contextC;
    if (dictionary.has(contextWC)) {
      contextW = contextWC;
      continue;
    }

    if (dictionaryToCreate.has(contextW)) {
      writeNewChar(contextW);
    } else {
      writeBits(dictionary.get(contextW), numBits);
    }
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
    dictionary.set(contextWC, dictSize++);
    contextW = contextC;
  }

  if (contextW !== "") {
    if (dictionaryToCreate.has(contextW)) {
      writeNewChar(contextW);
    } else {
      writeBits(dictionary.get(contextW), numBits);
    }
    enlargeIn--;
    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }

  // 结束标记 2（固定 numBits 位）
  writeBits(2, numBits);

  // 刷尾：剩余位左移补 0，直到写满一个 bitsPerChar 码元
  while (true) {
    dataVal <<= 1;
    if (dataPos === bitsPerChar - 1) {
      data.push(emitChar(dataVal));
      break;
    }
    dataPos++;
  }
  return data.join("");
}

function lzStringUnpack(length, resetValue, getNextValue) {
  const dictionary = [];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let w;
  const result = [];
  const data = { val: getNextValue(0), position: resetValue, index: 1 };

  for (let i = 0; i < 3; i++) dictionary[i] = i;

  const readBits = (count) => {
    let bits = 0;
    let power = 1;
    const maxpower = 2 ** count;
    while (power !== maxpower) {
      const resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }
    return bits;
  };

  let c;
  switch (readBits(2)) {
    case 0:
      c = String.fromCharCode(readBits(8));
      break;
    case 1:
      c = String.fromCharCode(readBits(16));
      break;
    case 2:
      return "";
    default:
      throw new Error("LZString 解压失败：首码元不是合法的字面量/结束标记");
  }
  dictionary[3] = c;
  w = c;
  result.push(c);

  while (true) {
    if (data.index > length) return "";
    let code = readBits(numBits);
    switch (code) {
      case 0:
        dictionary[dictSize++] = String.fromCharCode(readBits(8));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        dictionary[dictSize++] = String.fromCharCode(readBits(16));
        code = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join("");
      default:
        break;
    }

    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }

    let entry;
    if (dictionary[code] !== undefined) {
      entry = dictionary[code];
    } else if (code === dictSize) {
      entry = w + w.charAt(0);
    } else {
      return null;
    }
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;

    if (enlargeIn === 0) {
      enlargeIn = 2 ** numBits;
      numBits++;
    }
  }
}

function lzStringCompress(input, fmt) {
  const s = input == null ? "" : String(input);
  switch (fmt) {
    case "legacy":
      return lzwCompress(s);
    case "default":
      return lzStringPack(s, 16, (v) => String.fromCharCode(v));
    case "utf16":
      return lzStringPack(s, 15, (v) => String.fromCharCode(v + 32)) + " ";
    case "base64": {
      const res = lzStringPack(s, 6, (v) => BASE64_ALPHABET.charAt(v));
      switch (res.length % 4) {
        case 1: return res + "===";
        case 2: return res + "==";
        case 3: return res + "=";
        default: return res;
      }
    }
    default:
      throw new Error(`未知 LZString 格式 ${JSON.stringify(fmt)}：支持 legacy / default / utf16 / base64`);
  }
}

function lzStringDecompress(input, fmt) {
  const s = input == null ? "" : String(input);
  switch (fmt) {
    case "legacy":
      return lzwDecompress(s);
    case "default": {
      if (s === "") throw new Error("LZString 解压：输入为空");
      return ensureLzResult(lzStringUnpack(s.length, 32768, (i) => s.charCodeAt(i)), "default");
    }
    case "utf16": {
      if (s === "") throw new Error("LZString 解压：输入为空");
      return ensureLzResult(lzStringUnpack(s.length, 16384, (i) => s.charCodeAt(i) - 32), "utf16");
    }
    case "base64": {
      const t = s.replace(/\s+/g, "");
      if (t === "") throw new Error("LZString 解压：输入为空");
      for (const ch of t) {
        if (!BASE64_REVERSE.has(ch)) {
          throw new Error(`LZString Base64 解压：含非法字符 ${JSON.stringify(ch)}`);
        }
      }
      return ensureLzResult(lzStringUnpack(t.length, 32, (i) => BASE64_REVERSE.get(t.charAt(i))), "base64");
    }
    default:
      throw new Error(`未知 LZString 格式 ${JSON.stringify(fmt)}：支持 legacy / default / utf16 / base64`);
  }
}

function ensureLzResult(out, fmt) {
  if (out === null) {
    throw new Error(`LZString ${fmt} 解压失败：码流引用了不存在的字典项（数据损坏或格式选错）`);
  }
  return out;
}

// ============================================================
// 注册：id 不变，新增 fmt 参数；默认 legacy 保持旧输出
// ============================================================
register({
  id: "lzstring",
  cat: "archive",
  name: "LZString 压缩 / 解压",
  desc:
    "fmt=legacy（默认）：原有原始 LZW → JSON 数字数组，仅 Latin-1；" +
    "fmt=base64 / utf16 / default：pieroxy/lz-string 标准 compressToBase64 / compressToUTF16 / compress，逐位兼容参考实现；" +
    "中文与 emoji 请用三种标准格式（JS 按 UTF-16 码元处理，往返原样）；base64 最常用于网页/JS 题",
  params: [
    { key: "fmt", label: "格式", type: "select", default: "legacy",
      options: [
        { value: "legacy", label: "legacy（旧版 LZW → JSON 数字数组）" },
        { value: "base64", label: "标准 Base64（compressToBase64）" },
        { value: "utf16", label: "标准 UTF16（compressToUTF16）" },
        { value: "default", label: "标准原始（compress，16 位码元）" },
      ] },
  ],
  encode(text, p) {
    return lzStringCompress(text, (p && p.fmt) || "legacy");
  },
  decode(text, p) {
    return lzStringDecompress(text, (p && p.fmt) || "legacy");
  },
});

export {
  lzwCompress, lzwDecompress,
  lzStringPack, lzStringUnpack,
  lzStringCompress, lzStringDecompress,
};
