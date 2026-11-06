/*
 * textUtils.js — CyberChef 全量对齐第一波：文本 / 字节小工具（cat:'text' 为主）。
 *
 * 契约：本文件**不调用 register()**（注册表不动，由共享入口 M 接线）。只导出 handler
 * 与现成的 op 元数据数组 TEXT_UTILS_OPS，M 直接 forEach(register) 即可。
 *
 * 逐项对照 CyberChef 同名 operation（Apache-2.0 / MIT，见各段来源标注）实现；差异见交付报告。
 * 纯 JS、零第三方依赖；字节 op 用 run + acceptsBytes（真字节走 p.rawBytes），
 * 输出统一收口到 bytesIo.finishBytesDecode（合法 UTF-8 出字符串，否则无损转义 + 原字节）。
 */
import { finishBytesDecode } from "./bytesIo.js";
import { randomBytes as secureRandomBytes } from "./randSource.js";

const SRC = import.meta.url; // 供 registry 记录「权威实现」源文件（register 只在缺失时注入）

// ============================================================
// 通用：分隔符 token → 字符（照抄 CyberChef Utils.charRep 的相关子集）
// ============================================================
const CHAR_REP = {
  "Space": " ",
  "Percent": "%",
  "Comma": ",",
  "Semi-colon": ";",
  "Colon": ":",
  "Tab": "\t",
  "Line feed": "\n",
  "CRLF": "\r\n",
  "Forward slash": "/",
  "Backslash": "\\",
  "0x": "0x",
  "\\x": "\\x",
  "Nothing (separate chars)": "",
  "None": "",
};
function charRep(token) {
  const v = CHAR_REP[token];
  return v === undefined ? token : v;
}

// INPUT_DELIM_OPTIONS（CyberChef lib/Delim.mjs）——Sort/Unique/Head/Tail/FileTree 用
const INPUT_DELIM_OPTIONS = [
  { value: "Line feed", label: "换行 (\\n)" },
  { value: "CRLF", label: "CRLF (\\r\\n)" },
  { value: "Space", label: "空格" },
  { value: "Comma", label: "逗号" },
  { value: "Semi-colon", label: "分号" },
  { value: "Colon", label: "冒号" },
  { value: "Nothing (separate chars)", label: "无（逐字符）" },
];

// 照抄 CyberChef Utils.parseEscapedChars（editableOption/binaryString 取值时应用）。
function parseEscapedChars(str) {
  return String(str).replace(/\\([abfnrtv'"]|[0-3][0-7]{2}|[0-7]{1,2}|x[\da-fA-F]{2}|u[\da-fA-F]{4}|u\{[\da-fA-F]{1,6}\}|\\)/g, function (m, a) {
    switch (a[0]) {
      case "\\": return "\\";
      case "0": case "1": case "2": case "3":
      case "4": case "5": case "6": case "7":
        return String.fromCharCode(parseInt(a, 8));
      case "a": return String.fromCharCode(7);
      case "b": return "\b";
      case "t": return "\t";
      case "n": return "\n";
      case "v": return "\v";
      case "f": return "\f";
      case "r": return "\r";
      case '"': return '"';
      case "'": return "'";
      case "x": return String.fromCharCode(parseInt(a.substr(1), 16));
      case "u":
        if (a[1] === "{") return String.fromCodePoint(parseInt(a.slice(2, -1), 16));
        return String.fromCharCode(parseInt(a.substr(1), 16));
    }
  });
}

// 字节入参：op 声明 acceptsBytes 时优先真字节（p.rawBytes），否则按 CyberChef strToByteArray
// 的规则从文本取字节（全部 ≤255 → latin1；出现 >255 → UTF-8）。
function textToBytes(text) {
  const s = String(text == null ? "" : text);
  const arr = new Uint8Array(s.length);
  let i = s.length, b;
  while (i--) {
    b = s.charCodeAt(i);
    arr[i] = b;
    if (b > 255) return new TextEncoder().encode(s);
  }
  return arr;
}
function inputBytes(text, p) {
  if (p && p.rawBytes) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : Uint8Array.from(p.rawBytes);
  }
  return textToBytes(text);
}
function outBytes(bytes, name) {
  return finishBytesDecode(bytes, { textMode: "escape", name });
}

// ============================================================
// 1. Sort — 照抄 CyberChef operations/Sort.mjs + lib/Sort.mjs
// ============================================================
function caseInsensitiveSort(a, b) {
  return a.toLowerCase().localeCompare(b.toLowerCase());
}
function ipSort(a, b) {
  let a_ = a.split("."), b_ = b.split(".");
  a_ = a_[0] * 0x1000000 + a_[1] * 0x10000 + a_[2] * 0x100 + a_[3] * 1;
  b_ = b_[0] * 0x1000000 + b_[1] * 0x10000 + b_[2] * 0x100 + b_[3] * 1;
  if (isNaN(a_) && !isNaN(b_)) return 1;
  if (!isNaN(a_) && isNaN(b_)) return -1;
  if (isNaN(a_) && isNaN(b_)) return a.localeCompare(b);
  return a_ - b_;
}
// 注：numericSort / hexadecimalSort 的循环上界照抄上游 `i < b.length`（对字符串长度比较，
// 属上游既有实现，保持逐字一致以对齐行为）。
function numericSort(a, b) {
  const a_ = a.split(/([^\d]+)/), b_ = b.split(/([^\d]+)/);
  for (let i = 0; i < a_.length && i < b.length; ++i) {
    if (isNaN(a_[i]) && !isNaN(b_[i])) return 1;
    if (!isNaN(a_[i]) && isNaN(b_[i])) return -1;
    if (isNaN(a_[i]) && isNaN(b_[i])) {
      const ret = a_[i].localeCompare(b_[i]);
      if (ret !== 0) return ret;
    }
    if (!isNaN(a_[i]) && !isNaN(b_[i])) {
      if (a_[i] - b_[i] !== 0) return a_[i] - b_[i];
    }
  }
  return a.localeCompare(b);
}
function hexadecimalSort(a, b) {
  let a_ = a.split(/([^\da-f]+)/i), b_ = b.split(/([^\da-f]+)/i);
  a_ = a_.map((v) => { const t = parseInt(v, 16); return isNaN(t) ? v : t; });
  b_ = b_.map((v) => { const t = parseInt(v, 16); return isNaN(t) ? v : t; });
  for (let i = 0; i < a_.length && i < b.length; ++i) {
    if (isNaN(a_[i]) && !isNaN(b_[i])) return 1;
    if (!isNaN(a_[i]) && isNaN(b_[i])) return -1;
    if (isNaN(a_[i]) && isNaN(b_[i])) {
      const ret = a_[i].localeCompare(b_[i]);
      if (ret !== 0) return ret;
    }
    if (!isNaN(a_[i]) && !isNaN(b_[i])) {
      if (a_[i] - b_[i] !== 0) return a_[i] - b_[i];
    }
  }
  return a.localeCompare(b);
}
function lengthSort(a, b) { return a.length - b.length; }

function textSort(input, p) {
  p = p || {};
  const delim = charRep(p.delim || "Line feed");
  let sorted = String(input).split(delim);
  const order = p.order || "Alphabetical (case sensitive)";
  if (order === "Alphabetical (case sensitive)") sorted = sorted.sort();
  else if (order === "Alphabetical (case insensitive)") sorted = sorted.sort(caseInsensitiveSort);
  else if (order === "IP address") sorted = sorted.sort(ipSort);
  else if (order === "Numeric") sorted = sorted.sort(numericSort);
  else if (order === "Numeric (hexadecimal)") sorted = sorted.sort(hexadecimalSort);
  else if (order === "Length") sorted = sorted.sort(lengthSort);
  if (p.reverse) sorted.reverse();
  return sorted.join(delim);
}

// ============================================================
// 2. Unique — 保序去重（照抄 CyberChef operations/Unique.mjs）
// ============================================================
function textUnique(input, p) {
  p = p || {};
  const delim = charRep(p.delim || "Line feed");
  const parts = String(input).split(delim);
  if (p.count) {
    // 用普通对象（非 Map）以复刻上游 Object.keys 对整数型键的升序重排行为
    const valMap = {};
    for (const curr of parts) {
      if (Object.prototype.hasOwnProperty.call(valMap, curr)) valMap[curr]++;
      else valMap[curr] = 1;
    }
    return Object.keys(valMap).map((val) => `${valMap[val]} ${val}`).join(delim);
  }
  const seen = {};
  const out = [];
  for (const v of parts) {
    if (Object.prototype.hasOwnProperty.call(seen, v)) continue;
    seen[v] = 1;
    out.push(v);
  }
  return out.join(delim);
}

// ============================================================
// 3. Split — 拆分/重组（editableOptionShort：分隔符经 parseEscapedChars）
// ============================================================
function textSplit(input, p) {
  p = p || {};
  const splitDelim = parseEscapedChars(p.splitDelim == null ? "" : p.splitDelim);
  const joinDelim = parseEscapedChars(p.joinDelim == null ? "" : p.joinDelim);
  return String(input).split(splitDelim).join(joinDelim);
}

// ============================================================
// 4/5. Head / Tail — 照抄 CyberChef operations/{Head,Tail}.mjs
// ============================================================
function textHead(input, p) {
  p = p || {};
  const delim = charRep(p.delim || "Line feed");
  const number = Number(p.number);
  const arr = String(input).split(delim);
  return arr
    .filter((line, lineIndex) => {
      lineIndex += 1;
      if (number < 0) return lineIndex <= arr.length + number;
      return lineIndex <= number;
    })
    .join(delim);
}
function textTail(input, p) {
  p = p || {};
  const delim = charRep(p.delim || "Line feed");
  const number = Number(p.number);
  const arr = String(input).split(delim);
  return arr
    .filter((line, lineIndex) => {
      lineIndex += 1;
      if (number < 0) return lineIndex > -number;
      return lineIndex > arr.length - number;
    })
    .join(delim);
}

// ============================================================
// 6/7/8. Take nth bytes / Drop bytes / Drop nth bytes（字节 op）
// ============================================================
function takeNthBytes(input, p) {
  p = p || {};
  const bytes = inputBytes(input, p);
  const n = Number(p.every), start = Number(p.start), eachLine = !!p.eachLine;
  if (parseInt(n, 10) !== n || n <= 0) throw new Error("'Take every' must be a positive integer.");
  if (parseInt(start, 10) !== start || start < 0) throw new Error("'Starting at' must be a positive or zero integer.");
  let offset = 0;
  const output = [];
  for (let i = 0; i < bytes.length; i++) {
    if (eachLine && bytes[i] === 0x0a) {
      output.push(0x0a);
      offset = i + 1;
    } else if (i - offset >= start && (i - (start + offset)) % n === 0) {
      output.push(bytes[i]);
    }
  }
  return outBytes(output, "takeNthBytes");
}

function dropBytes(input, p) {
  p = p || {};
  const bytes = inputBytes(input, p);
  let start = Number(p.start), length = Number(p.length);
  const applyToEachLine = !!p.eachLine;

  if (!applyToEachLine) {
    if (start < 0) start = bytes.length + start;
    if (length < 0) {
      start = start + length;
      if (start < 0) {
        start = bytes.length + start;
        length = start - length;
      } else {
        length = -length;
      }
    }
    const left = bytes.slice(0, start);
    const right = bytes.slice(start + length, bytes.length);
    const result = new Uint8Array(left.length + right.length);
    result.set(left, 0);
    result.set(right, left.length);
    return outBytes(result, "dropBytes");
  }

  const lines = [];
  let line = [];
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) { lines.push(line); line = []; }
    else line.push(bytes[i]);
  }
  lines.push(line);

  let output = [], s = start, l = length;
  for (let i = 0; i < lines.length; i++) {
    if (s < 0) s = lines[i].length + s;
    if (l < 0) {
      s = s + l;
      if (s < 0) {
        s = lines[i].length + s;
        l = s - l;
      } else {
        l = -l;
      }
    }
    output = output.concat(lines[i].slice(0, s).concat(lines[i].slice(s + l, lines[i].length)));
    output.push(0x0a);
    s = start;
    l = length;
  }
  return outBytes(output.slice(0, output.length - 1), "dropBytes");
}

function dropNthBytes(input, p) {
  p = p || {};
  const bytes = inputBytes(input, p);
  const n = Number(p.every), start = Number(p.start), eachLine = !!p.eachLine;
  if (parseInt(n, 10) !== n || n <= 0) throw new Error("'Drop every' must be a positive integer.");
  if (parseInt(start, 10) !== start || start < 0) throw new Error("'Starting at' must be a positive or zero integer.");
  let offset = 0;
  const output = [];
  for (let i = 0; i < bytes.length; i++) {
    if (eachLine && bytes[i] === 0x0a) {
      output.push(0x0a);
      offset = i + 1;
    } else if (i - offset < start || (i - (start + offset)) % n !== 0) {
      output.push(bytes[i]);
    }
  }
  return outBytes(output, "dropNthBytes");
}

// ============================================================
// 9. Remove whitespace — 照抄 CyberChef operations/RemoveWhitespace.mjs
// ============================================================
function removeWhitespace(input, p) {
  p = p || {};
  let data = String(input);
  if (p.spaces !== false) data = data.replace(/ /g, "");
  if (p.cr !== false) data = data.replace(/\r/g, "");
  if (p.lf !== false) data = data.replace(/\n/g, "");
  if (p.tabs !== false) data = data.replace(/\t/g, "");
  if (p.ff !== false) data = data.replace(/\f/g, "");
  if (p.fullStops) data = data.replace(/\./g, "");
  return data;
}

// ============================================================
// 10. Remove null bytes（字节 op）
// ============================================================
function removeNullBytes(input, p) {
  const bytes = inputBytes(input, p);
  const output = [];
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0) output.push(bytes[i]);
  return outBytes(output, "removeNullBytes");
}

// ============================================================
// 11. Remove ANSI Escape Codes — 照抄 operations/RemoveANSIEscapeCodes.mjs
// ============================================================
function removeAnsiEscapeCodes(input) {
  return String(input).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

// ============================================================
// 12. Add line numbers — 照抄 operations/AddLineNumbers.mjs
// ============================================================
function addLineNumbers(input, p) {
  p = p || {};
  const lines = String(input).split("\n");
  const width = lines.length.toString().length;
  const offset = p.offset ? parseInt(p.offset, 10) : 0;
  let output = "";
  for (let n = 0; n < lines.length; n++) {
    output += (n + 1 + offset).toString().padStart(width, " ") + " " + lines[n] + "\n";
  }
  return output.slice(0, output.length - 1);
}

// ============================================================
// 13. Remove line numbers — 照抄 operations/RemoveLineNumbers.mjs
// ============================================================
function removeLineNumbers(input) {
  return String(input).replace(/^[ \t]{0,5}\d+[\s:|\-,.)\]]/gm, "");
}

// ============================================================
// 14. Pad lines — 照抄 operations/PadLines.mjs（Character 为 binaryShortString）
// ============================================================
function padLines(input, p) {
  p = p || {};
  const position = p.position || "Start";
  const len = Number(p.length);
  const chr = parseEscapedChars(p.char == null ? " " : p.char);
  const lines = String(input).split("\n");
  let output = "";
  if (position === "Start") {
    for (const l of lines) output += l.padStart(l.length + len, chr) + "\n";
  } else if (position === "End") {
    for (const l of lines) output += l.padEnd(l.length + len, chr) + "\n";
  }
  return output.slice(0, output.length - 1);
}

// ============================================================
// 15. To Upper case — 照抄 operations/ToUpperCase.mjs（Scope）
// ============================================================
function toUpperCaseOp(input, p) {
  p = p || {};
  const scope = p.scope || "All";
  if (scope === "All") return String(input).toUpperCase();
  const scopeRegex = {
    "Word": /(\b\w)/gi,
    "Sentence": /(?:\.|^)\s*(\b\w)/gi,
    "Paragraph": /(?:\n|^)\s*(\b\w)/gi,
  }[scope];
  if (scopeRegex === undefined) throw new Error("Unrecognized capitalization scope");
  return String(input).replace(scopeRegex, (m) => m.toUpperCase());
}

// ============================================================
// 16. To Lower case / 17. Swap case
// ============================================================
function toLowerCaseOp(input) {
  return String(input).toLowerCase();
}
function swapCase(input) {
  const s = String(input);
  let result = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    const upper = c.toUpperCase();
    if (c === upper) result += c.toLowerCase();
    else result += upper;
  }
  return result;
}

// ============================================================
// 18/19/20. To Camel / Snake / Kebab case
//   逐字移植 lodash 4.17.21 的 words/deburr/createCompounder（CyberChef 直接用 lodash）。
// ============================================================
// ---- deburr（lodash/_deburrLetter.js）----
const DEBURRED_LETTERS = {
  "\xc0": "A", "\xc1": "A", "\xc2": "A", "\xc3": "A", "\xc4": "A", "\xc5": "A",
  "\xe0": "a", "\xe1": "a", "\xe2": "a", "\xe3": "a", "\xe4": "a", "\xe5": "a",
  "\xc7": "C", "\xe7": "c",
  "\xd0": "D", "\xf0": "d",
  "\xc8": "E", "\xc9": "E", "\xca": "E", "\xcb": "E",
  "\xe8": "e", "\xe9": "e", "\xea": "e", "\xeb": "e",
  "\xcc": "I", "\xcd": "I", "\xce": "I", "\xcf": "I",
  "\xec": "i", "\xed": "i", "\xee": "i", "\xef": "i",
  "\xd1": "N", "\xf1": "n",
  "\xd2": "O", "\xd3": "O", "\xd4": "O", "\xd5": "O", "\xd6": "O", "\xd8": "O",
  "\xf2": "o", "\xf3": "o", "\xf4": "o", "\xf5": "o", "\xf6": "o", "\xf8": "o",
  "\xd9": "U", "\xda": "U", "\xdb": "U", "\xdc": "U",
  "\xf9": "u", "\xfa": "u", "\xfb": "u", "\xfc": "u",
  "\xdd": "Y", "\xfd": "y", "\xff": "y",
  "\xc6": "Ae", "\xe6": "ae",
  "\xde": "Th", "\xfe": "th",
  "\xdf": "ss",
  "\u0100": "A", "\u0102": "A", "\u0104": "A",
  "\u0101": "a", "\u0103": "a", "\u0105": "a",
  "\u0106": "C", "\u0108": "C", "\u010a": "C", "\u010c": "C",
  "\u0107": "c", "\u0109": "c", "\u010b": "c", "\u010d": "c",
  "\u010e": "D", "\u0110": "D", "\u010f": "d", "\u0111": "d",
  "\u0112": "E", "\u0114": "E", "\u0116": "E", "\u0118": "E", "\u011a": "E",
  "\u0113": "e", "\u0115": "e", "\u0117": "e", "\u0119": "e", "\u011b": "e",
  "\u011c": "G", "\u011e": "G", "\u0120": "G", "\u0122": "G",
  "\u011d": "g", "\u011f": "g", "\u0121": "g", "\u0123": "g",
  "\u0124": "H", "\u0126": "H", "\u0125": "h", "\u0127": "h",
  "\u0128": "I", "\u012a": "I", "\u012c": "I", "\u012e": "I", "\u0130": "I",
  "\u0129": "i", "\u012b": "i", "\u012d": "i", "\u012f": "i", "\u0131": "i",
  "\u0134": "J", "\u0135": "j",
  "\u0136": "K", "\u0137": "k", "\u0138": "k",
  "\u0139": "L", "\u013b": "L", "\u013d": "L", "\u013f": "L", "\u0141": "L",
  "\u013a": "l", "\u013c": "l", "\u013e": "l", "\u0140": "l", "\u0142": "l",
  "\u0143": "N", "\u0145": "N", "\u0147": "N", "\u014a": "N",
  "\u0144": "n", "\u0146": "n", "\u0148": "n", "\u014b": "n",
  "\u014c": "O", "\u014e": "O", "\u0150": "O",
  "\u014d": "o", "\u014f": "o", "\u0151": "o",
  "\u0154": "R", "\u0156": "R", "\u0158": "R",
  "\u0155": "r", "\u0157": "r", "\u0159": "r",
  "\u015a": "S", "\u015c": "S", "\u015e": "S", "\u0160": "S",
  "\u015b": "s", "\u015d": "s", "\u015f": "s", "\u0161": "s",
  "\u0162": "T", "\u0164": "T", "\u0166": "T",
  "\u0163": "t", "\u0165": "t", "\u0167": "t",
  "\u0168": "U", "\u016a": "U", "\u016c": "U", "\u016e": "U", "\u0170": "U", "\u0172": "U",
  "\u0169": "u", "\u016b": "u", "\u016d": "u", "\u016f": "u", "\u0171": "u", "\u0173": "u",
  "\u0174": "W", "\u0175": "w",
  "\u0176": "Y", "\u0177": "y", "\u0178": "Y",
  "\u0179": "Z", "\u017b": "Z", "\u017d": "Z",
  "\u017a": "z", "\u017c": "z", "\u017e": "z",
  "\u0132": "IJ", "\u0133": "ij",
  "\u0152": "Oe", "\u0153": "oe",
  "\u0149": "'n", "\u017f": "s",
};
const reLatin = /[\xc0-\xd6\xd8-\xf6\xf8-\xff\u0100-\u017f]/g;
const reComboMark = /[\u0300-\u036f\ufe20-\ufe2f\u20d0-\u20ff]/g;
function deburr(string) {
  const s = String(string == null ? "" : string);
  return s && s.replace(reLatin, (c) => (Object.prototype.hasOwnProperty.call(DEBURRED_LETTERS, c) ? DEBURRED_LETTERS[c] : c)).replace(reComboMark, "");
}

// ---- words（lodash/_unicodeWords.js、_asciiWords.js、_hasUnicodeWord.js、words.js）----
const rsAstralRange = "\\ud800-\\udfff",
  rsComboMarksRange = "\\u0300-\\u036f",
  reComboHalfMarksRange = "\\ufe20-\\ufe2f",
  rsComboSymbolsRange = "\\u20d0-\\u20ff",
  rsComboRange = rsComboMarksRange + reComboHalfMarksRange + rsComboSymbolsRange,
  rsDingbatRange = "\\u2700-\\u27bf",
  rsLowerRange = "a-z\\xdf-\\xf6\\xf8-\\xff",
  rsMathOpRange = "\\xac\\xb1\\xd7\\xf7",
  rsNonCharRange = "\\x00-\\x2f\\x3a-\\x40\\x5b-\\x60\\x7b-\\xbf",
  rsPunctuationRange = "\\u2000-\\u206f",
  rsSpaceRange = " \\t\\x0b\\f\\xa0\\ufeff\\n\\r\\u2028\\u2029\\u1680\\u180e\\u2000\\u2001\\u2002\\u2003\\u2004\\u2005\\u2006\\u2007\\u2008\\u2009\\u200a\\u202f\\u205f\\u3000",
  rsUpperRange = "A-Z\\xc0-\\xd6\\xd8-\\xde",
  rsVarRange = "\\ufe0e\\ufe0f",
  rsBreakRange = rsMathOpRange + rsNonCharRange + rsPunctuationRange + rsSpaceRange;
const rsApos = "['\u2019]",
  rsBreak = "[" + rsBreakRange + "]",
  rsCombo = "[" + rsComboRange + "]",
  rsDigits = "\\d+",
  rsDingbat = "[" + rsDingbatRange + "]",
  rsLower = "[" + rsLowerRange + "]",
  rsMisc = "[^" + rsAstralRange + rsBreakRange + rsDigits + rsDingbatRange + rsLowerRange + rsUpperRange + "]",
  rsFitz = "\\ud83c[\\udffb-\\udfff]",
  rsModifier = "(?:" + rsCombo + "|" + rsFitz + ")",
  rsNonAstral = "[^" + rsAstralRange + "]",
  rsRegional = "(?:\\ud83c[\\udde6-\\uddff]){2}",
  rsSurrPair = "[\\ud800-\\udbff][\\udc00-\\udfff]",
  rsUpper = "[" + rsUpperRange + "]",
  rsZWJ = "\\u200d";
const rsMiscLower = "(?:" + rsLower + "|" + rsMisc + ")",
  rsMiscUpper = "(?:" + rsUpper + "|" + rsMisc + ")",
  rsOptContrLower = "(?:" + rsApos + "(?:d|ll|m|re|s|t|ve))?",
  rsOptContrUpper = "(?:" + rsApos + "(?:D|LL|M|RE|S|T|VE))?",
  reOptMod = rsModifier + "?",
  rsOptVar = "[" + rsVarRange + "]?",
  rsOptJoin = "(?:" + rsZWJ + "(?:" + [rsNonAstral, rsRegional, rsSurrPair].join("|") + ")" + rsOptVar + reOptMod + ")*",
  rsOrdLower = "\\d*(?:1st|2nd|3rd|(?![123])\\dth)(?=\\b|[A-Z_])",
  rsOrdUpper = "\\d*(?:1ST|2ND|3RD|(?![123])\\dTH)(?=\\b|[a-z_])",
  rsSeq = rsOptVar + reOptMod + rsOptJoin,
  rsEmoji = "(?:" + [rsDingbat, rsRegional, rsSurrPair].join("|") + ")" + rsSeq;
const reUnicodeWord = RegExp([
  rsUpper + "?" + rsLower + "+" + rsOptContrLower + "(?=" + [rsBreak, rsUpper, "$"].join("|") + ")",
  rsMiscUpper + "+" + rsOptContrUpper + "(?=" + [rsBreak, rsUpper + rsMiscLower, "$"].join("|") + ")",
  rsUpper + "?" + rsMiscLower + "+" + rsOptContrLower,
  rsUpper + "+" + rsOptContrUpper,
  rsOrdUpper,
  rsOrdLower,
  rsDigits,
  rsEmoji,
].join("|"), "g");
const reAsciiWord = /[^\x00-\x2f\x3a-\x40\x5b-\x60\x7b-\x7f]+/g;
const reHasUnicodeWord = /[a-z][A-Z]|[A-Z]{2}[a-z]|[0-9][a-zA-Z]|[a-zA-Z][0-9]|[^a-zA-Z0-9 ]/;
function asciiWords(string) { return string.match(reAsciiWord) || []; }
function unicodeWords(string) { return string.match(reUnicodeWord) || []; }
function words(string) {
  const s = String(string == null ? "" : string);
  return reHasUnicodeWord.test(s) ? unicodeWords(s) : asciiWords(s);
}
function upperFirst(string) { return string.charAt(0).toUpperCase() + string.slice(1); }
function capitalize(string) { return upperFirst(String(string).toLowerCase()); }
const reAposGlobal = /['\u2019]/g;
function wordsOf(string) { return words(deburr(string).replace(reAposGlobal, "")); }

function lodashCamelCase(string) {
  let result = "";
  const ws = wordsOf(string);
  for (let i = 0; i < ws.length; i++) {
    let w = ws[i].toLowerCase();
    result += i ? capitalize(w) : w;
  }
  return result;
}
function lodashSnakeCase(string) {
  let result = "";
  const ws = wordsOf(string);
  for (let i = 0; i < ws.length; i++) result += (i ? "_" : "") + ws[i].toLowerCase();
  return result;
}
function lodashKebabCase(string) {
  let result = "";
  const ws = wordsOf(string);
  for (let i = 0; i < ws.length; i++) result += (i ? "-" : "") + ws[i].toLowerCase();
  return result;
}
// 照抄 CyberChef lib/Code.mjs replaceVariableNames（smart 模式）
function replaceVariableNames(input, replacer) {
  const tokenRegex = /\\"|"(?:\\"|[^"])*"|(\b[a-z0-9\-_]+\b)/ig;
  return String(input).replace(tokenRegex, (...args) => {
    const match = args[0], quotes = args[1];
    if (!quotes) return match;
    return replacer(match);
  });
}

function toCamelCaseOp(input, p) {
  return (p && p.smart) ? replaceVariableNames(input, lodashCamelCase) : lodashCamelCase(input);
}
function toSnakeCaseOp(input, p) {
  return (p && p.smart) ? replaceVariableNames(input, lodashSnakeCase) : lodashSnakeCase(input);
}
function toKebabCaseOp(input, p) {
  return (p && p.smart) ? replaceVariableNames(input, lodashKebabCase) : lodashKebabCase(input);
}

// ============================================================
// 21. Count occurrences — 照抄 operations/CountOccurrences.mjs（toggleString → mode+search）
// ============================================================
function countOccurrencesOp(input, p) {
  p = p || {};
  const search = p.search == null ? "" : String(p.search);
  const type = p.mode || "Simple string";
  if (type === "Regex" && search) {
    try {
      const regex = new RegExp(search, "gi");
      const matches = String(input).match(regex);
      return String(matches.length);
    } catch (err) {
      return "0";
    }
  } else if (search) {
    let s = search;
    if (type.indexOf("Extended") === 0) s = parseEscapedChars(s);
    return String(String(input).split(s).length - 1);
  }
  return "0";
}

// ============================================================
// 22. Expand alphabet range — 照抄 operations/ExpandAlphabetRange.mjs + Utils.{ord,chr,expandAlphRange}
// ============================================================
function ord(c) {
  if (c.length === 2) {
    const high = c.charCodeAt(0), low = c.charCodeAt(1);
    if (high >= 0xd800 && high < 0xdc00 && low >= 0xdc00 && low < 0xe000) {
      return (high - 0xd800) * 0x400 + low - 0xdc00 + 0x10000;
    }
  }
  return c.charCodeAt(0);
}
function chr(o) {
  if (o > 0xffff) {
    o -= 0x10000;
    const high = String.fromCharCode((o >>> 10 & 0x3ff) | 0xd800);
    o = 0xdc00 | (o & 0x3ff);
    return high + String.fromCharCode(o);
  }
  return String.fromCharCode(o);
}
function expandAlphRange(alphStr) {
  const alphArr = [];
  for (let i = 0; i < alphStr.length; i++) {
    if (i < alphStr.length - 2 && alphStr[i + 1] === "-" && alphStr[i] !== "\\") {
      const start = ord(alphStr[i]), end = ord(alphStr[i + 2]);
      for (let j = start; j <= end; j++) alphArr.push(chr(j));
      i += 2;
    } else if (i < alphStr.length - 2 && alphStr[i] === "\\" && alphStr[i + 1] === "-") {
      alphArr.push("-");
      i++;
    } else {
      alphArr.push(alphStr[i]);
    }
  }
  return alphArr;
}
function expandAlphabetRangeOp(input, p) {
  p = p || {};
  return expandAlphRange(String(input)).join(parseEscapedChars(p.delim == null ? "" : p.delim));
}

// ============================================================
// 23. Wrap — 照抄 operations/Wrap.mjs（含上游 min/max/integer 校验语义）
// ============================================================
function textWrap(input, p) {
  p = p || {};
  const lineWidth = Number(p.width);
  if (!Number.isInteger(lineWidth)) throw new Error("Line Width must be an integer.");
  if (lineWidth < 1) throw new Error("Line Width must be greater than or equal to 1.");
  if (lineWidth > 65536) throw new Error("Line Width must be less than or equal to 65536.");
  if (!input) return "";
  const regex = new RegExp(`.{1,${lineWidth}}`, "g");
  const m = String(input).match(regex);
  return m ? m.join("\n") : "";
}

// ============================================================
// 24. XML Minify — 移植 vkbeautify.xmlmin（CyberChef 直接依赖 vkbeautify）
// ============================================================
function xmlMinify(input, p) {
  p = p || {};
  const preserveComments = !!p.preserveComments;
  const str = preserveComments
    ? String(input)
    : String(input)
      .replace(/\<![ \r\n\t]*(--([^\-]|[\r\n]|-[^\-])*--[ \r\n\t]*)\>/g, "")
      .replace(/[ \r\n\t]{1,}xmlns/g, " xmlns");
  return str.replace(/>\s{0,}</g, "><");
}

// ============================================================
// 25. HTML To Text — 照抄 operations/HTMLToText.mjs（inputType:"html"→string，run 为恒等）
//   注意：本项目无独立 html 输入/输出类型，此 op 语义上等价于恒等（与 Strip HTML tags 不同）。
// ============================================================
function htmlToText(input) {
  return input;
}

// ============================================================
// 26. Strip HTML tags — 照抄 operations/StripHTMLTags.mjs + Utils.stripHtmlTags
// ============================================================
function stripHtmlTagsInner(htmlStr, removeScriptAndStyle) {
  function recursiveRemove(pattern, str) {
    const newStr = str.replace(pattern, "");
    return newStr.length === str.length ? newStr : recursiveRemove(pattern, newStr);
  }
  if (removeScriptAndStyle) {
    htmlStr = recursiveRemove(/<script[^>]*>(\s|\S)*?<\/script[^>]*>/gi, htmlStr);
    htmlStr = recursiveRemove(/<style[^>]*>(\s|\S)*?<\/style[^>]*>/gi, htmlStr);
  }
  return recursiveRemove(/<[^>]+>/g, htmlStr);
}
function stripHtmlTags(input, p) {
  p = p || {};
  const removeIndentation = p.removeIndentation !== false;
  const removeLineBreaks = p.removeLineBreaks !== false;
  let s = stripHtmlTagsInner(String(input));
  if (removeIndentation) s = s.replace(/\n[ \f\t]+/g, "\n");
  if (removeLineBreaks) {
    s = s.replace(/^\s*\n/, "").replace(/(\n\s*){2,}/g, "\n");
  }
  return s;
}

// ============================================================
// 27. Generate UUID — 对照 operations/GenerateUUID.mjs（uuid 包：v1/v3/v4/v5/v6/v7）
//   非确定性版本（v1/v4/v6/v7）只保证 RFC 9562 结构与版本/变体位；v3/v5 为确定性。
// ============================================================
function uuidBytesToStr(b) {
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20, 32);
}
function uuidValidate(s) {
  return typeof s === "string" && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);
}
function uuidParseBytes(s) {
  const h = s.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
// 统一走 randSource（含用户档位 / 可复现种子），禁止直连 crypto.getRandomValues。
function randomBytes(n) {
  return secureRandomBytes(n);
}
// 内联 MD5（RFC 1321，纯 JS）——v3 用；刻意不 import hash.js，保持本模块零副作用。
function rotl32(x, n) { return ((x << n) | (x >>> (32 - n))) >>> 0; }
function md5Bytes(bytes) {
  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ];
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const origLen = bytes.length;
  const withOne = origLen + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + k + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[origLen] = 0x80;
  const bitLen = BigInt(origLen) * 8n;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, Number(bitLen & 0xffffffffn), true);
  dv.setUint32(total - 4, Number((bitLen >> 32n) & 0xffffffffn), true);
  for (let off = 0; off < total; off += 64) {
    const M = new Array(16);
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; }
      else { F = C ^ (B | ~D); g = (7 * i) % 16; }
      F = (F + A + K[i] + M[g]) >>> 0;
      A = D; D = C; C = B;
      B = (B + rotl32(F, S[i])) >>> 0;
    }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return out;
}
// 同步 SHA-1（UTF-8 之外给定字节），返回 40 位小写 hex。v5 用。
function sha1Hex(bytes) {
  const ml = bytes.length * 8;
  const withOne = bytes.length + 1;
  const k = (56 - (withOne % 64) + 64) % 64;
  const total = withOne + k + 8;
  const msg = new Uint8Array(total);
  msg.set(bytes, 0);
  msg[bytes.length] = 0x80;
  const dv = new DataView(msg.buffer);
  dv.setUint32(total - 8, Math.floor(ml / 0x100000000), false);
  dv.setUint32(total - 4, ml >>> 0, false);
  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const n = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16];
      w[i] = ((n << 1) | (n >>> 31)) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k2;
      if (i < 20) { f = (b & c) | (~b & d); k2 = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d; k2 = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k2 = 0x8F1BBCDC; }
      else { f = b ^ c ^ d; k2 = 0xCA62C1D6; }
      const temp = ((((a << 5) | (a >>> 27)) >>> 0) + f + e + k2 + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = temp;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, "0")).join("");
}
function uuidNamespaceConcat(name, namespace) {
  const nsB = uuidParseBytes(namespace);
  const nameB = new TextEncoder().encode(String(name));
  const cat = new Uint8Array(nsB.length + nameB.length);
  cat.set(nsB, 0);
  cat.set(nameB, nsB.length);
  return cat;
}
function uuidV3(name, namespace) {
  const b = md5Bytes(uuidNamespaceConcat(name, namespace)).slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x30;
  b[8] = (b[8] & 0x3f) | 0x80;
  return uuidBytesToStr(b);
}
function uuidV5(name, namespace) {
  const hex = sha1Hex(uuidNamespaceConcat(name, namespace));
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = parseInt(hex.substr(i * 2, 2), 16);
  b[6] = (b[6] & 0x0f) | 0x50;
  b[8] = (b[8] & 0x3f) | 0x80;
  return uuidBytesToStr(b);
}
function uuidV4() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return uuidBytesToStr(b);
}
// 1582-10-15 与 Unix epoch 的毫秒差
const UUID_V1_EPOCH_OFFSET_MS = 12219292800000;
function uuidTimestamp100ns() {
  const ms = Date.now() + UUID_V1_EPOCH_OFFSET_MS;
  return BigInt(ms) * 10000n + BigInt(randomBytes(1)[0] % 10000);
}
function uuidV1() {
  const timestamp = uuidTimestamp100ns();
  const timeLow = Number(timestamp & 0xffffffffn) >>> 0;
  const timeMid = Number((timestamp >> 32n) & 0xffffn);
  const timeHi = Number((timestamp >> 48n) & 0x0fffn);
  const node = randomBytes(6);
  node[0] |= 0x01; // multicast 位（无 MAC 时用随机 node）
  const clockSeq = ((randomBytes(1)[0] & 0x3f) << 8) | randomBytes(1)[0];
  const b = new Uint8Array(16);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, timeLow, false);
  dv.setUint16(4, timeMid, false);
  dv.setUint16(6, timeHi | 0x1000, false);
  dv.setUint8(8, ((clockSeq >> 8) & 0x3f) | 0x80);
  dv.setUint8(9, clockSeq & 0xff);
  b.set(node, 10);
  return uuidBytesToStr(b);
}
function uuidV6() {
  const timestamp = uuidTimestamp100ns();
  const timeHigh = Number((timestamp >> 28n) & 0xffffffffn) >>> 0;
  const timeMid = Number((timestamp >> 12n) & 0xffffn);
  const timeLow = Number(timestamp & 0x0fffn);
  const node = randomBytes(6);
  node[0] |= 0x01;
  const clockSeq = ((randomBytes(1)[0] & 0x3f) << 8) | randomBytes(1)[0];
  const b = new Uint8Array(16);
  const dv = new DataView(b.buffer);
  dv.setUint32(0, timeHigh, false);
  dv.setUint16(4, timeMid, false);
  dv.setUint16(6, timeLow | 0x6000, false);
  dv.setUint8(8, ((clockSeq >> 8) & 0x3f) | 0x80);
  dv.setUint8(9, clockSeq & 0xff);
  b.set(node, 10);
  return uuidBytesToStr(b);
}
function uuidV7() {
  const ms = BigInt(Date.now());
  const rand = randomBytes(10);
  const b = new Uint8Array(16);
  b[0] = Number((ms >> 40n) & 0xffn);
  b[1] = Number((ms >> 32n) & 0xffn);
  b[2] = Number((ms >> 24n) & 0xffn);
  b[3] = Number((ms >> 16n) & 0xffn);
  b[4] = Number((ms >> 8n) & 0xffn);
  b[5] = Number(ms & 0xffn);
  b[6] = 0x70 | (rand[0] & 0x0f);
  b[7] = rand[1];
  b[8] = (rand[2] & 0x3f) | 0x80;
  for (let i = 9; i < 16; i++) b[i] = rand[i - 7];
  return uuidBytesToStr(b);
}
function generateUuid(input, p) {
  p = p || {};
  const version = p.version || "v4";
  const namespace = p.namespace;
  if (version === "v3" || version === "v5") {
    if (!uuidValidate(namespace)) throw new Error("Invalid UUID namespace");
    return version === "v3" ? uuidV3(input, namespace) : uuidV5(input, namespace);
  }
  if (version === "v1") return uuidV1();
  if (version === "v4") return uuidV4();
  if (version === "v6") return uuidV6();
  if (version === "v7") return uuidV7();
  throw new Error("Invalid UUID version");
}

// ============================================================
// 28. File Tree — 照抄 operations/FileTree.mjs
// ============================================================
function fileTree(input, p) {
  p = p || {};
  const ARROW = "|---";
  const PIPE = "|   ";
  const fileDelim = parseEscapedChars(p.fileDelim == null ? "/" : p.fileDelim);
  const entryDelim = charRep(p.entryDelim || "Line feed");

  const completedList = [];
  const printList = [];

  // unique() 保序 + sort()（照抄 Array.prototype.unique().sort()）
  const seen = {};
  const uniq = [];
  for (const v of String(input).split(entryDelim)) {
    if (Object.prototype.hasOwnProperty.call(seen, v)) continue;
    seen[v] = 1;
    uniq.push(v);
  }
  const filePaths = uniq.sort();

  for (let i = 0; i < filePaths.length; i++) {
    let path = filePaths[i].split(fileDelim);
    if (path[0] === "") path = path.slice(1, path.length);
    for (let j = 0; j < path.length; j++) {
      let printLine, key;
      if (j === 0) {
        printLine = path[j];
        key = path[j];
      } else {
        printLine = PIPE.repeat(j - 1) + ARROW + path[j];
        key = path.slice(0, j + 1).join("/");
      }
      if (!completedList.includes(key)) {
        completedList.push(key);
        printList.push(printLine);
      }
    }
  }
  return printList.join("\n");
}

// ============================================================
// op 元数据（供 M 接线；本文件自行 register 会与「注册表不动」冲突，故只导出）
// ============================================================
const TEXT_UTILS_OPS = [
  {
    id: "textSort", cat: "text", sourceFile: SRC,
    name: "排序 (Sort)", desc: "按分隔符排序（字母大小写敏感/不敏感、IP、数值、16 进制数值、长度；可倒序）",
    params: [
      { key: "delim", label: "分隔符", type: "select", default: "Line feed", options: INPUT_DELIM_OPTIONS },
      { key: "reverse", label: "倒序", type: "bool", default: false },
      { key: "order", label: "排序方式", type: "select", default: "Alphabetical (case sensitive)", options: [
        { value: "Alphabetical (case sensitive)", label: "字母（大小写敏感）" },
        { value: "Alphabetical (case insensitive)", label: "字母（忽略大小写）" },
        { value: "IP address", label: "IPv4 地址" },
        { value: "Numeric", label: "数值" },
        { value: "Numeric (hexadecimal)", label: "数值（16 进制）" },
        { value: "Length", label: "长度" },
      ] },
    ],
    run: textSort,
  },
  {
    id: "textUnique", cat: "text", sourceFile: SRC,
    name: "去重 (Unique)", desc: "按分隔符保序去重；可选显示每项出现次数",
    params: [
      { key: "delim", label: "分隔符", type: "select", default: "Line feed", options: INPUT_DELIM_OPTIONS },
      { key: "count", label: "显示计数", type: "bool", default: false },
    ],
    run: textUnique,
  },
  {
    id: "textSplit", cat: "text", sourceFile: SRC,
    name: "拆分/重组 (Split)", desc: "按拆分分隔符切开，再用连接分隔符拼回（支持 \\n \\t \\xHH 转义）",
    params: [
      { key: "splitDelim", label: "拆分分隔符", type: "text", default: "," },
      { key: "joinDelim", label: "连接分隔符", type: "text", default: "\\n" },
    ],
    run: textSplit,
  },
  {
    id: "textHead", cat: "text", sourceFile: SRC,
    name: "取前 N 项 (Head)", desc: "按分隔符取前 N 项（N 为负则保留除末尾 |N| 项外的全部）",
    params: [
      { key: "delim", label: "分隔符", type: "select", default: "Line feed", options: INPUT_DELIM_OPTIONS },
      { key: "number", label: "数量", type: "number", default: 10 },
    ],
    run: textHead,
  },
  {
    id: "textTail", cat: "text", sourceFile: SRC,
    name: "取后 N 项 (Tail)", desc: "按分隔符取后 N 项（N 为负则跳过前 |N| 项）",
    params: [
      { key: "delim", label: "分隔符", type: "select", default: "Line feed", options: INPUT_DELIM_OPTIONS },
      { key: "number", label: "数量", type: "number", default: 10 },
    ],
    run: textTail,
  },
  {
    id: "takeNthBytes", cat: "text", sourceFile: SRC, acceptsBytes: true,
    name: "每隔 N 字节取样 (Take nth bytes)", desc: "从起始位置起每隔 N 字节取 1 字节（可逐行应用）",
    params: [
      { key: "every", label: "每隔", type: "number", default: 4 },
      { key: "start", label: "起始位置", type: "number", default: 0 },
      { key: "eachLine", label: "逐行应用", type: "bool", default: false },
    ],
    run: takeNthBytes,
  },
  {
    id: "dropBytes", cat: "text", sourceFile: SRC, acceptsBytes: true,
    name: "删除字节 (Drop bytes)", desc: "从 Start 起切掉 Length 个字节（支持负值；可逐行应用）",
    params: [
      { key: "start", label: "起始位置", type: "number", default: 0 },
      { key: "length", label: "长度", type: "number", default: 5 },
      { key: "eachLine", label: "逐行应用", type: "bool", default: false },
    ],
    run: dropBytes,
  },
  {
    id: "dropNthBytes", cat: "text", sourceFile: SRC, acceptsBytes: true,
    name: "每隔 N 字节删除 (Drop nth bytes)", desc: "从起始位置起每隔 N 字节删 1 字节（可逐行应用）",
    params: [
      { key: "every", label: "每隔", type: "number", default: 4 },
      { key: "start", label: "起始位置", type: "number", default: 0 },
      { key: "eachLine", label: "逐行应用", type: "bool", default: false },
    ],
    run: dropNthBytes,
  },
  {
    id: "removeWhitespace", cat: "text", sourceFile: SRC,
    name: "删除空白 (Remove whitespace)", desc: "可选删除空格 / CR / LF / Tab / FF / 句点",
    params: [
      { key: "spaces", label: "空格", type: "bool", default: true },
      { key: "cr", label: "回车 (\\r)", type: "bool", default: true },
      { key: "lf", label: "换行 (\\n)", type: "bool", default: true },
      { key: "tabs", label: "制表符 (\\t)", type: "bool", default: true },
      { key: "ff", label: "换页符 (\\f)", type: "bool", default: true },
      { key: "fullStops", label: "句点 (.)", type: "bool", default: false },
    ],
    run: removeWhitespace,
  },
  {
    id: "removeNullBytes", cat: "text", sourceFile: SRC, acceptsBytes: true,
    name: "删除 NUL 字节 (Remove null bytes)", desc: "删除所有 0x00 字节",
    params: [],
    run: removeNullBytes,
  },
  {
    id: "removeAnsiEscapeCodes", cat: "text", sourceFile: SRC,
    name: "删除 ANSI 转义 (Remove ANSI Escape Codes)", desc: "删除 ANSI 转义序列（CSI）",
    params: [],
    run: removeAnsiEscapeCodes,
  },
  {
    id: "addLineNumbers", cat: "text", sourceFile: SRC,
    name: "添加行号 (Add line numbers)", desc: "为每行添加行号（可设偏移）",
    params: [
      { key: "offset", label: "偏移", type: "number", default: 0 },
    ],
    run: addLineNumbers,
  },
  {
    id: "removeLineNumbers", cat: "text", sourceFile: SRC,
    name: "删除行号 (Remove line numbers)", desc: "删除可被简单识别的行首行号",
    params: [],
    run: removeLineNumbers,
  },
  {
    id: "padLines", cat: "text", sourceFile: SRC,
    name: "行补齐 (Pad lines)", desc: "在每行起始/末尾补齐指定字符",
    params: [
      { key: "position", label: "位置", type: "select", default: "Start", options: [
        { value: "Start", label: "起始" },
        { value: "End", label: "末尾" },
      ] },
      { key: "length", label: "长度", type: "number", default: 5 },
      { key: "char", label: "字符", type: "text", default: " " },
    ],
    run: padLines,
  },
  {
    id: "toUpperCase", cat: "text", sourceFile: SRC,
    name: "转大写 (To Upper case)", desc: "转大写；可限定作用域：全部 / 每词 / 每句 / 每段",
    params: [
      { key: "scope", label: "作用域", type: "select", default: "All", options: [
        { value: "All", label: "全部" },
        { value: "Word", label: "每个词首字母" },
        { value: "Sentence", label: "每句首字母" },
        { value: "Paragraph", label: "每段首字母" },
      ] },
    ],
    run: toUpperCaseOp,
  },
  {
    id: "toLowerCase", cat: "text", sourceFile: SRC,
    name: "转小写 (To Lower case)", desc: "全部转小写",
    params: [],
    run: toLowerCaseOp,
  },
  {
    id: "swapCase", cat: "text", sourceFile: SRC,
    name: "大小写互换 (Swap case)", desc: "大写转小写、小写转大写",
    params: [],
    run: swapCase,
  },
  {
    id: "toCamelCase", cat: "text", sourceFile: SRC,
    name: "转驼峰 (To Camel case)", desc: "转 camelCase；context aware 模式仅转换代码中的变量名",
    params: [
      { key: "smart", label: "上下文感知（仅改变量名）", type: "bool", default: false },
    ],
    run: toCamelCaseOp,
  },
  {
    id: "toSnakeCase", cat: "text", sourceFile: SRC,
    name: "转下划线 (To Snake case)", desc: "转 snake_case；context aware 模式仅转换代码中的变量名",
    params: [
      { key: "smart", label: "上下文感知（仅改变量名）", type: "bool", default: false },
    ],
    run: toSnakeCaseOp,
  },
  {
    id: "toKebabCase", cat: "text", sourceFile: SRC,
    name: "转短横线 (To Kebab case)", desc: "转 kebab-case；context aware 模式仅转换代码中的变量名",
    params: [
      { key: "smart", label: "上下文感知（仅改变量名）", type: "bool", default: false },
    ],
    run: toKebabCaseOp,
  },
  {
    id: "countOccurrences", cat: "text", sourceFile: SRC,
    name: "出现次数 (Count occurrences)", desc: "统计搜索串出现次数（正则 / 转义扩展 / 纯文本）",
    params: [
      { key: "mode", label: "模式", type: "select", default: "Simple string", options: [
        { value: "Regex", label: "正则" },
        { value: "Extended (\\n, \\t, \\x...)", label: "转义扩展 (\\n \\t \\x...)" },
        { value: "Simple string", label: "纯文本" },
      ] },
      { key: "search", label: "搜索串", type: "text", default: "" },
    ],
    run: countOccurrencesOp,
  },
  {
    id: "expandAlphabetRange", cat: "text", sourceFile: SRC,
    name: "展开字母表范围 (Expand alphabet range)", desc: "把 a-z 之类范围展开为字符列表（可用连接符）",
    params: [
      { key: "delim", label: "连接分隔符", type: "text", default: "" },
    ],
    run: expandAlphabetRangeOp,
  },
  {
    id: "textWrap", cat: "text", sourceFile: SRC,
    name: "折行 (Wrap)", desc: "按指定宽度折行（\\n 分隔）",
    params: [
      { key: "width", label: "行宽", type: "number", default: 64 },
    ],
    run: textWrap,
  },
  {
    id: "xmlMinify", cat: "text", sourceFile: SRC,
    name: "XML 压缩 (XML Minify)", desc: "压缩 XML（可保留注释），移植 vkbeautify.xmlmin",
    params: [
      { key: "preserveComments", label: "保留注释", type: "bool", default: false },
    ],
    run: xmlMinify,
  },
  {
    id: "htmlToText", cat: "text", sourceFile: SRC,
    name: "HTML 转文本 (HTML To Text)", desc: "把 HTML 输出转为纯字符串（CyberChef 中为类型转换，语义等价于恒等）",
    params: [],
    run: htmlToText,
  },
  {
    id: "stripHtmlTags", cat: "text", sourceFile: SRC,
    name: "剥离 HTML 标签 (Strip HTML tags)", desc: "删除所有 HTML 标签（可选去缩进、去多余空行）",
    params: [
      { key: "removeIndentation", label: "删除缩进", type: "bool", default: true },
      { key: "removeLineBreaks", label: "删除多余空行", type: "bool", default: true },
    ],
    run: stripHtmlTags,
  },
  {
    id: "generateUuid", cat: "radix", sourceFile: SRC,
    name: "生成 UUID (Generate UUID)", desc: "生成 RFC 9562 UUID（v1/v3/v4/v5/v6/v7；v3/v5 需命名空间）",
    params: [
      { key: "version", label: "版本", type: "select", default: "v4", options: [
        { value: "v1", label: "v1 时间戳" },
        { value: "v3", label: "v3 命名空间 MD5" },
        { value: "v4", label: "v4 随机" },
        { value: "v5", label: "v5 命名空间 SHA-1" },
        { value: "v6", label: "v6 时间戳（重排）" },
        { value: "v7", label: "v7 Unix 时间戳" },
      ] },
      { key: "namespace", label: "命名空间（v3/v5）", type: "text", default: "1b671a64-40d5-491e-99b0-da01ff1f3341" },
    ],
    run: generateUuid,
  },
  {
    id: "fileTree", cat: "text", sourceFile: SRC,
    name: "文件树 (File Tree)", desc: "把文件路径列表渲染为树形结构",
    params: [
      { key: "fileDelim", label: "路径分隔符", type: "text", default: "/" },
      { key: "entryDelim", label: "条目分隔符", type: "select", default: "Line feed", options: INPUT_DELIM_OPTIONS },
    ],
    run: fileTree,
  },
];

export {
  charRep, parseEscapedChars,
  textSort,
  textUnique,
  textSplit,
  textHead, textTail,
  takeNthBytes, dropBytes, dropNthBytes,
  removeWhitespace, removeNullBytes, removeAnsiEscapeCodes,
  addLineNumbers, removeLineNumbers, padLines,
  toUpperCaseOp, toLowerCaseOp, swapCase,
  toCamelCaseOp, toSnakeCaseOp, toKebabCaseOp,
  countOccurrencesOp,
  expandAlphabetRangeOp, expandAlphRange,
  textWrap,
  xmlMinify, htmlToText, stripHtmlTags,
  generateUuid,
  fileTree,
  lodashCamelCase, lodashSnakeCase, lodashKebabCase,
  TEXT_UTILS_OPS,
};
