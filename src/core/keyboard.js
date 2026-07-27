/*
 * keyboard.js — 键盘/坐标编码组（cat:'fancy'）。
 *
 * 收录的编码：
 * - keyboardSurround（nliqwerty_dec，相邻键包围/数字坐标）
 * - keyCode（JS event.keyCode 表 8-222）
 * - shiftKey（上档键符号映射）
 * - keyword9（T9 九宫格三套表 + 字母模式）
 * - qweAbc（QWERTY/QWERTZ/AZERTY → ABC）
 * keyCode 表按 W3C UI Events KeyboardEvent.keyCode 值。
 *
 * 契约：与 fancy.js 已有 keyboard（QWERTY 行列坐标）/tapcode 不重复。
 * - keyCode/keyword9/keyboardSurround/qweAbc 单向 run 返报告文本
 * - shiftKey 自反，双向 encode=decode
 */
import { register } from "./registry.js";

// ============ keyCode ============
// JS event.keyCode 8-222 → 名称表（keyboard_dict）
const KEYCODE_DICT = {
  8: "BackSpace", 9: "Tab", 12: "Clear", 13: "Enter", 16: "Shift", 17: "Control",
  18: "Alt", 20: "Cape Lock", 27: "Esc", 32: "Spacebar", 33: "Page Up", 34: "Page Down",
  35: "End", 36: "Home", 37: "Left Arrow", 38: "Up Arrow", 39: "Right Arrow", 40: "Dw Arrow",
  45: "Insert", 46: "Delete",
  48: "0", 49: "1", 50: "2", 51: "3", 52: "4", 53: "5", 54: "6", 55: "7", 56: "8", 57: "9",
  65: "A", 66: "B", 67: "C", 68: "D", 69: "E", 70: "F", 71: "G", 72: "H", 73: "I", 74: "J",
  75: "K", 76: "L", 77: "M", 78: "N", 79: "O", 80: "P", 81: "Q", 82: "R", 83: "S", 84: "T",
  85: "U", 86: "V", 87: "W", 88: "X", 89: "Y", 90: "Z",
  96: "0", 97: "1", 98: "2", 99: "3", 100: "4", 101: "5", 102: "6", 103: "7", 104: "8", 105: "9",
  106: "*", 107: "+", 108: "Enter", 109: "-", 110: ".", 111: "/",
  112: "F1", 113: "F2", 114: "F3", 115: "F4", 116: "F5", 117: "F6", 118: "F7", 119: "F8",
  120: "F9", 121: "F10", 122: "F11", 123: "F12", 144: "Num Lock",
  170: "搜索", 171: "收藏", 172: "浏览器", 173: "静音", 174: "音量减", 175: "音量加",
  179: "停止", 180: "邮件",
  186: ";:", 187: "=+", 188: ",<", 189: "-_", 190: ".>", 191: "/?", 192: "`~",
  219: "[{", 220: "\\|", 221: "]}", 222: "'\"",
};
function keyCodeRun(text) {
  const s = text.trim();
  if (!s) return "（空输入）";
 // 分隔符：空格/逗号/分号/换行
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  const out = [];
  let unknown = 0;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (Number.isNaN(n)) {
      out.push(`${p} → （非数字）`);
      unknown++;
    } else if (KEYCODE_DICT.hasOwnProperty(n)) {
      out.push(`${n} → ${KEYCODE_DICT[n]}`);
    } else {
      out.push(`${n} → （表中无）`);
      unknown++;
    }
  }
  return out.join("\n") + (unknown ? `\n\n（${unknown} 项未知）` : "");
}

// ============ shiftKey ============
// 上档键符号映射（自反：Shift+数字 → 符号；符号 → 数字）
const SHIFT_KEY_MAP = {
  "^": "6", "%": "5", "&": "7", "(": "9", ")": "0", "!": "1",
  "@": "2", "#": "3", "$": "4", "*": "8", "`": "~",
  "-": "_", "=": "+", "[": "{", "]": "}", "'": '"',
  ";": ":", "\\": "|", "/": "?",
};
// 反向映射（值→键）用于反向；注意：~ _ + { } " : | ? 这些值在正向表里不存在，反向时映射回原键
const SHIFT_KEY_REVERSE = (() => {
  const m = {};
  for (const [k, v] of Object.entries(SHIFT_KEY_MAP)) {
    if (!m.hasOwnProperty(v)) m[v] = k;  // 首次出现优先
  }
  return m;
})();
function shiftKeyConvert(text) {
 // 未知字符原样保留
  let out = "";
  for (const ch of text) {
    if (SHIFT_KEY_MAP.hasOwnProperty(ch)) out += SHIFT_KEY_MAP[ch];
    else if (SHIFT_KEY_REVERSE.hasOwnProperty(ch)) out += SHIFT_KEY_REVERSE[ch];
    else out += ch;
  }
  return out;
}

// ============ keyword9（T9 九宫格） ============
// 三套映射表
const KW9_1 = {  // 二位数字 → 字符
  "11": ".", "12": "_", "13": "@", "14": "/", "15": "#",
  "21": "a", "22": "b", "23": "c",
  "31": "d", "32": "e", "33": "f",
  "41": "g", "42": "h", "43": "i",
  "51": "j", "52": "k", "53": "l",
  "61": "m", "62": "n", "63": "o",
  "71": "p", "72": "q", "73": "r", "74": "s",
  "81": "t", "82": "u", "83": "v",
  "91": "w", "92": "x", "93": "y", "94": "z",
};
const KW9_2 = {  // 重复数字 → 字符（如 22=b, 222=c）
  "1": ".", "11": "_", "111": "@", "1111": "/", "11111": "#",
  "2": "a", "22": "b", "222": "c",
  "3": "d", "33": "e", "333": "f",
  "4": "g", "44": "h", "444": "i",
  "5": "j", "55": "k", "555": "l",
  "6": "m", "66": "n", "666": "o",
  "7": "p", "77": "q", "777": "r", "7777": "s",
  "8": "t", "88": "u", "888": "v",
  "9": "w", "99": "x", "999": "y", "9999": "z",
};
const KW9_0 = {  // 数字+\|/ → 字符（如 2\=a, 2|=b, 2/=c）
  "1\\": ".", "1|": "_", "1/": "@",
  "2\\": "a", "2|": "b", "2/": "c",
  "3\\": "d", "3|": "e", "3/": "f",
  "4\\": "g", "4|": "h", "4/": "i",
  "5\\": "j", "5|": "k", "5/": "l",
  "6\\": "m", "6|": "n", "6/": "o",
  "7\\": "p", "0\\": "q", "7|": "r", "7/": "s",
  "8\\": "t",
};
// f=3 模式：字母+空格，base = " qwertyuiop"（注意首位是空格），a = [' ', ' ', 'abc', 'def', ...]
const KW9_BASE = " qwertyuiop";
const KW9_T9 = [" ", " ", "abc", "def", "ghi", "jkl", "mno", "pqrs", "tuv", "wxyz"];

function keyword9Run(text) {
  const txt = text.trim();
  if (!txt) return "（空输入）";
  let mode = 1;  // 默认 KW9_1
  if (txt.includes(" ")) {
    for (const t of txt.split(" ")) {
      if (/[|/]/.test(t)) { mode = 0; break; }
      if (t.length >= 3 && /^\d+$/.test(t)) { mode = 2; break; }
      if (t.length >= 3 && /^[a-zA-Z]+$/.test(t)) { mode = 3; break; }
    }
  }
 // 全空格+数字也走 mode 1（去掉空格按 2 位切）
 // 但若整串无空格且全数字，也按 2 位切（mode 1）
  let fruit = "";
  if (mode === 1) {
    const s = txt.replace(/\s+/g, "");
    if (s.length % 2 !== 0) return `（mode 1 输入长度 ${s.length} 不是 2 的倍数，无法按二位切分）`;
    fruit = "";
    for (let i = 0; i < s.length; i += 2) {
      const k = s.slice(i, i + 2);
      fruit += KW9_1[k] ?? `?${k}?`;
    }
  } else if (mode === 0) {
 // mode 0：按空格分割，每段查 KW9_0
    fruit = txt.split(/\s+/).map((x) => KW9_0[x] ?? `?${x}?`).join("");
  } else if (mode === 2) {
 // mode 2：按空格分割，每段查 KW9_2
    fruit = txt.split(/\s+/).map((x) => KW9_2[x] ?? `?${x}?`).join("");
  } else if (mode === 3) {
 // mode 3：字母模式，首字符在 base 中位置 → T9 数字 → 按长度取字母
    fruit = "";
    for (const part of txt.split(/\s+/)) {
      if (!part) continue;
      const s = KW9_BASE.indexOf(part[0]);
      if (s < 0 || s >= KW9_T9.length) { fruit += `?${part}?`; continue; }
      const letters = KW9_T9[s];
      const idx = part.length - 1;
      if (idx >= 0 && idx < letters.length) fruit += letters[idx];
      else fruit += `?${part}?`;
    }
  }
  const modeDesc = ["mode 0（数字+\\|/ 三字符）", "mode 1（二位数字）", "mode 2（重复数字）", "mode 3（字母+长度）"][mode];
  return `识别: ${modeDesc}\n结果: ${fruit}`;
}

// ============ keyboardSurround（nliqwerty_dec）============
// 每个键 → 周围键集合
const KB_SURROUND = {
  "'": ";[]/", ",": ".LKM", "-": "P=0[", ".": "L;/,", "/": ".;'",
  "0": "P-9O", "1": "Q2", "2": "Q31W", "3": "2EW4", "4": "53ER",
  "5": "4T6R", "6": "75YT", "7": "8YU6", "8": "7IU9", "9": "08IO",
  ";": "]PL./'", "=": "P-[]",
  "A": "QSWZ", "B": "NGVH", "C": "DVFX", "D": "WXRESFC", "E": "W4DR3S",
  "F": "TRDEVGC", "G": "TRBYHVF", "H": "TNBYGJU", "I": "98KOUJ",
  "J": "INYKHMU", "K": "ILOMJU,", "L": "I;KOP,.", "M": "NKJ,", "N": "BMJH",
  "O": "I9KLP0", "P": "[;LO0-", "Q": "12AW", "R": "T4DE5F", "S": "ZWXDQEA",
  "T": "RY5GF6", "U": "7I8YHJ", "V": "BGFC", "W": "Q2E3AS", "X": "DSZC",
  "Y": "7THGU6", "Z": "SAX", "[": "]';-=PL", "]": "'=\\[;",
};
// 数字坐标表（keyboard2）：每两位数字 → 字符
const KB_COORD = {
  "44": " ", "21": "A", "35": "B", "33": "C", "23": "D", "13": "E",
  "24": "F", "25": "G", "26": "H", "18": "I", "27": "J", "29": "K",
  "28": "L", "37": "M", "36": "N", "19": "O", "10": "P", "11": "Q",
  "14": "R", "22": "S", "15": "T", "17": "U", "34": "V", "12": "W",
  "32": "X", "16": "Y", "31": "Z",
};
function keyboardSurroundRun(text) {
  const txt = text.trim();
  if (!txt) return "（空输入）";
 // 全数字+空格 → keyboard2 数字坐标；含字母 → keyboard 包围键集合匹配
  const isAllDigitOrSpace = /^[0-9\s]+$/.test(txt);
  const parts = txt.split(/\s+/).filter(Boolean);
  let mode, result;
  if (isAllDigitOrSpace) {
    mode = "数字坐标（keyboard2）";
    result = parts.map((s) => KB_COORD[s] ?? `?${s}?`).join("");
  } else {
    mode = "包围键集合（keyboard）";
    const upper = txt.toUpperCase();
    const upperParts = upper.split(/\s+/).filter(Boolean);
    result = "";
    for (const s of upperParts) {
      let found = false;
      for (const [k, v] of Object.entries(KB_SURROUND)) {
 // method_all：s 的每个字符（大写）都在 v 中（v 已大写比较）
        const vUpper = v.toUpperCase();
        if ([...s].every((c) => vUpper.includes(c))) {
          result += k;
          found = true;
          break;
        }
      }
      if (!found) result += `?${s}?`;
    }
  }
  return `识别: ${mode}\n结果: ${result}`;
}

// ============ qweAbc ============
// QWERTY/QWERTZ/AZERTY 三套键盘 → ABC 标准字母表
const QWERTY_LAYOUT = "QWERTYUIOPASDFGHJKLZXCVBNMqwertyuiopasdfghjklzxcvbnm";
const QWERTZ_LAYOUT = "QWERTZUIOPASDFGHJKLYXCVBNMqwertzuiopasdfghjklyxcvbnm";
const AZERTY_LAYOUT = "AZERTYUIOPQSDFGHJKLWXCVBNMazertyuiopqsdfghjklwxcvbnm";
const ABC_LAYOUT = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
function qweAbcRun(text) {
  const txt = text.trim();
  if (!txt) return "（空输入）";
  function convert(layout, name) {
    let out = "";
    for (const c of txt) {
      const idx = layout.indexOf(c);
      if (idx >= 0) out += ABC_LAYOUT[idx];
 // 不在表里的字符被跳过（仅 c 在布局中才追加）
    }
    return name + ":" + out;
  }
  return [
    convert(QWERTY_LAYOUT, "qwerty"),
    convert(QWERTZ_LAYOUT, "qwertz"),
    convert(AZERTY_LAYOUT, "azerty"),
  ].join("\n");
}

// ============ 注册 ============
register({
  id: "keyCode", cat: "fancy", name: "JS keyCode 表",
  desc: "JS event.keyCode 8-222 → 键名（支持空格/逗号/分号分隔多个）",
  params: [],
  run: keyCodeRun,
});

register({
  id: "shiftKey", cat: "fancy", name: "上档键符号",
  desc: "Shift+数字/符号 ↔ 符号/数字（自反双向）",
  params: [],
  encode: shiftKeyConvert,
  decode: shiftKeyConvert,
});

register({
  id: "keyword9", cat: "fancy", name: "T9 九宫格",
  desc: "手机 T9 键盘四模式：二位数字 / 重复数字 / 数字+\\|/ / 字母+长度",
  params: [],
  run: keyword9Run,
});

register({
  id: "keyboardSurround", cat: "fancy", name: "键盘包围键",
  desc: "相邻键集合→中心键 或 数字坐标→字符（nliqwerty）",
  params: [],
  run: keyboardSurroundRun,
});

register({
  id: "qweAbc", cat: "fancy", name: "QWERTY→ABC",
  desc: "QWERTY/QWERTZ/AZERTY 键盘 → ABC 标准字母表",
  params: [],
  run: qweAbcRun,
});

export {
  keyCodeRun, KEYCODE_DICT,
  shiftKeyConvert, SHIFT_KEY_MAP, SHIFT_KEY_REVERSE,
  keyword9Run, KW9_1, KW9_2, KW9_0,
  keyboardSurroundRun, KB_SURROUND, KB_COORD,
  qweAbcRun, QWERTY_LAYOUT, QWERTZ_LAYOUT, AZERTY_LAYOUT, ABC_LAYOUT,
};
