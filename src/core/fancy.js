/*
 * fancy.js — 花式 / CTF 编码 A 组（cat:'fancy'）。
 * 摩斯电码、培根密码（24/26 字母）、栅栏密码（W 型）、凯撒、ROT13/5/18/47
 * Atbash、A1Z26、DNA、敲击码 TapCode、键盘坐标。
 *
 * 算法来源：复刻自 WhatsInYourClipboard 的 ciphers.js / classicalGrid.js /
 * encodedText.js（ISC License，鸣谢 Leon406/ToolsFx）。编码表照抄源码，不许编造。
 * 每个编码都用往返测试验证。
 */
import { register } from "./registry.js";

const A = "abcdefghijklmnopqrstuvwxyz";
const A_UP = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ============ 摩斯电码 ============
// 码表照抄 WhatsInYourClipboard encodedText.js + 常用标点（ITU-R M.1677）
const MORSE = {
  ".-": "A", "-...": "B", "-.-.": "C", "-..": "D", ".": "E", "..-.": "F",
  "--.": "G", "....": "H", "..": "I", ".---": "J", "-.-": "K", ".-..": "L",
  "--": "M", "-.": "N", "---": "O", ".--.": "P", "--.-": "Q", ".-.": "R",
  "...": "S", "-": "T", "..-": "U", "...-": "V", ".--": "W", "-..-": "X",
  "-.--": "Y", "--..": "Z",
  "-----": "0", ".----": "1", "..---": "2", "...--": "3", "....-": "4",
  ".....": "5", "-....": "6", "--...": "7", "---..": "8", "----.": "9",
  ".-.-.-": ".", "--..--": ",", "..--..": "?", ".----.": "'", "-.-.--": "!",
  "-..-.": "/", "-.--.": "(", "-.--.-": ")", ".-...": "&", "---...": ":",
  "-.-.-.": ";", "-...-": "=", ".-.-.": "+", "-....-": "-", "..--.-": "_",
  ".-..-.": '"', "...-..-": "$", ".--.-.": "@",
 // 扩展标点（扩展字符集：{ } * # %）
  "----.--": "{", "-----.-": "}", "-..-..-": "*", "......": "#", "...-.-": "%",
};
const MORSE_REV = {};
for (const [k, v] of Object.entries(MORSE)) {
  if (!(v in MORSE_REV)) MORSE_REV[v] = k;
}
function morseEncode(text) {
 // 字符间空格，词间 / 分隔
  return text.toUpperCase().split(" ").map((word) =>
    [...word].map((ch) => MORSE_REV[ch] || ch).join(" ")
  ).join(" / ");
}
function morseDecode(text) {
  let s = String(text || "").trim();
  if (!s) return "";
 // 兼容层（参考实现同款增强，自动检测）：
 // ① BA 替代：A/a→'.'，B/b→'-'（中文风格记忆法；输入含 AB 且不含标准 .- 时启用）
  if (!/[.\-]/.test(s) && /[abAB]/.test(s)) {
    s = [...s].map((c) => (c === "A" || c === "a") ? "." : (c === "B" || c === "b") ? "-" : c).join("");
  }
 // ② 0/1 数字形式摩斯：全 0/1（无 .-）→ 0→'.' 1→'-'（等价参考 MORSE_UNCODE2）
  if (!/[.\-]/.test(s) && /[01]/.test(s)) {
    s = [...s].map((c) => (c === "0") ? "." : (c === "1") ? "-" : c).join("");
  }
 // ③ 分隔符归一：/ | x 都当词分隔
  s = s.replace(/[|x]/g, " / ");
  return s.split(/\s*\/\s*/).map((word) =>
    word.trim().split(/\s+/).filter(Boolean).map((c) => {
      if (MORSE[c]) return MORSE[c];
   // ④ 未知码回退：'.'→0 '-'→1 → 16 位二进制 → hex → chr（参考实现行为）
      const bin = [...c].map((ch) => (ch === "." ? "0" : "1")).join("").padStart(16, "0");
      const v = parseInt(bin, 2);
      return v > 0 && v <= 0xffff ? String.fromCharCode(v) : "?";
    }).join("")
  ).join(" ");
}

// ============ 培根密码（24/26 字母两版） ============
// 26 字母版：每字母独立 5 位 a/b；24 字母版：I=J, U=V（去 J 和 V）
const BACON26 = {};
for (let i = 0; i < 26; i++) BACON26[i.toString(2).padStart(5, "0")] = A_UP[i];
const BACON24_ALPHA = "ABCDEFGHIKLMNOPQRSTUWXYZ"; // 24 字母（I=J, U=V）
const BACON24 = {};
for (let i = 0; i < 24; i++) BACON24[i.toString(2).padStart(5, "0")] = BACON24_ALPHA[i];

function baconEncode(text, p) {
  const version = (p && p.version) || "26";
  const norm = text.toUpperCase().replace(/[^A-Z]/g, "");
  if (version === "24") {
    const s = norm.replace(/J/g, "I").replace(/V/g, "U");
    return [...s].map((ch) => {
      const idx = BACON24_ALPHA.indexOf(ch);
      if (idx < 0) return "";
      return idx.toString(2).padStart(5, "0").replace(/0/g, "a").replace(/1/g, "b");
    }).join(" ");
  }
  return [...norm].map((ch) => {
    const idx = ch.charCodeAt(0) - 65;
    return idx.toString(2).padStart(5, "0").replace(/0/g, "a").replace(/1/g, "b");
  }).join(" ");
}
function baconDecode(text, p) {
  const version = (p && p.version) || "26";
  const table = version === "24" ? BACON24 : BACON26;
 // 归一：a/A/0 → 0，b/B/1 → 1
  const norm = text.replace(/[^abAB01]/g, "")
    .replace(/[aA0]/g, "0").replace(/[bB1]/g, "1");
  let out = "";
  for (let i = 0; i + 5 <= norm.length; i += 5) {
    out += table[norm.slice(i, i + 5)] || "?";
  }
  return out;
}

// ============ 栅栏密码（W 型 zigzag） ============
function railFenceEncode(text, p) {
  const rails = Math.max(2, Number((p && p.rails) || 2));
  if (rails < 2 || rails >= text.length) return text;
  const rows = new Array(rails).fill("");
  let r = 0, dir = 1;
  for (let i = 0; i < text.length; i++) {
    rows[r] += text[i];
    if (r === 0) dir = 1;
    else if (r === rails - 1) dir = -1;
    r += dir;
  }
  return rows.join("");
}
function railFenceDecode(text, p) {
  const rails = Math.max(2, Number((p && p.rails) || 2));
  if (rails < 2 || rails >= text.length) return text;
  const len = text.length;
 // 算 W 型 pattern
  const pattern = new Array(len);
  let r = 0, dir = 1;
  for (let i = 0; i < len; i++) {
    pattern[i] = r;
    if (r === 0) dir = 1;
    else if (r === rails - 1) dir = -1;
    r += dir;
  }
 // 每行字符数
  const counts = new Array(rails).fill(0);
  for (const row of pattern) counts[row]++;
 // 切片
  const rows = [];
  let idx = 0;
  for (let i = 0; i < rails; i++) {
    rows.push(text.slice(idx, idx + counts[i]).split(""));
    idx += counts[i];
  }
 // 按 pattern 重组
  let out = "";
  const ptr = new Array(rails).fill(0);
  for (let i = 0; i < len; i++) {
    const row = pattern[i];
    out += rows[row][ptr[row]++];
  }
  return out;
}

// ============ 凯撒（参数移位量） ============
function caesarShift(text, shift) {
  const s = ((shift % 26) + 26) % 26;
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + s) % 26) + base);
  });
}
// encode +shift，decode -shift（互逆）
// 递增/递减凯撒：第 x 字符位移 shift±x（参考实现 mode3/mode4 的字母版；非字母原样）
function caesarProgressive(text, shift, isEncode, isDec) {
  const s = ((shift % 26) + 26) % 26;
  let out = "";
  for (let x = 0; x < text.length; x++) {
    const delta = isDec ? s - x : s + x;
    out += caesarShift(text[x], isEncode ? delta : -delta);
  }
  return out;
}
function caesarEncode(t, p) {
  const shift = Number((p && p.shift) || 3);
  const mode = (p && p.mode) || "standard";
  if (mode === "progInc") return caesarProgressive(t, shift, true, false);
  if (mode === "progDec") return caesarProgressive(t, shift, true, true);
  return caesarShift(t, shift);
}
function caesarDecode(t, p) {
  const shift = Number((p && p.shift) || 3);
  const mode = (p && p.mode) || "standard";
  if (mode === "progInc") return caesarProgressive(t, shift, false, false);
  if (mode === "progDec") return caesarProgressive(t, shift, false, true);
  return caesarShift(t, -shift);
}

// ============ ROT 系列 ============
function rot13(text) {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}
function rot5(text) {
  return text.replace(/[0-9]/g, (c) => String((+c + 5) % 10));
}
function rot18(text) { return rot5(rot13(text)); }
function rot47(text) {
  return text.replace(/[!-~]/g, (c) => {
    const code = c.charCodeAt(0);
    return String.fromCharCode(33 + ((code - 33 + 47) % 94));
  });
}

// ============ Atbash（自反） ============
function atbash(text) {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(base + 25 - (c.charCodeAt(0) - base));
  });
}

// ============ A1Z26（数字 ↔ 字母） ============
function a1z26Encode(text) {
  return text.toLowerCase().split("").filter((c) => /[a-z]/.test(c))
    .map((c) => c.charCodeAt(0) - 96).join(" ");
}
function a1z26Decode(text) {
  return text.trim().split(/[\s,.\-]+/).filter(Boolean)
    .map((n) => {
      const i = parseInt(n, 10);
      return i >= 1 && i <= 26 ? A[i - 1] : "?";
    }).join("");
}

// ============ DNA 编码（3 字母密码子 ↔ 字符） ============
// 码表照抄 WhatsInYourClipboard ctfCiphers.js
const DNA_MAP = {
  AAA:"a",AAC:"b",AAG:"c",AAT:"d",ACA:"e",ACC:"f",ACG:"g",ACT:"h",AGA:"i",AGC:"j",
  AGG:"k",AGT:"l",ATA:"m",ATC:"n",ATG:"o",ATT:"p",CAA:"q",CAC:"r",CAG:"s",CAT:"t",
  CCA:"u",CCC:"v",CCG:"w",CCT:"x",CGA:"y",CGC:"z",CGG:"A",CGT:"B",CTA:"C",CTC:"D",
  CTG:"E",CTT:"F",GAA:"G",GAC:"H",GAG:"I",GAT:"J",GCA:"K",GCC:"L",GCG:"M",GCT:"N",
  GGA:"O",GGC:"P",GGG:"Q",GGT:"R",GTA:"S",GTC:"T",GTG:"U",GTT:"V",TAA:"W",TAC:"X",
  TAG:"Y",TAT:"Z",TCA:"1",TCC:"2",TCG:"3",TCT:"4",TGA:"5",TGC:"6",TGG:"7",TGT:"8",
  TTA:"9",TTC:"0",TTG:" ",TTT:".",
};
const DNA_BIN = { "00":"A","10":"C","01":"G","11":"T" };
const DNA_REV = {};
for (const [codon, ch] of Object.entries(DNA_MAP)) {
  if (!(ch in DNA_REV)) DNA_REV[ch] = codon;
}
function dnaEncode(text) {
 // 用空格分隔每个密码子，便于 dnaDecode 按 split 还原（双向契约）
  return [...text].map((ch) => DNA_REV[ch] || "").join(" ");
}
function dnaDecode(text) {
  return text.split(/[^01AGCTagct]+/).filter(Boolean).map((seg) => {
    let codon = seg;
    if (/[01]/.test(seg)) {
      codon = (seg.match(/.{2}/g) || []).map((b) => DNA_BIN[b] || "").join("");
    }
    return DNA_MAP[codon.toUpperCase()] || "";
  }).join("");
}

// ============ 键盘坐标（C7-P14 合并：吸收 kbdFullCoord）============
// layout=qwerty3（默认）：3 字母行 QWERTYUIOP/ASDFGHJKL/ZXCVBNM，二位连写 R+C（Q=11）。
// layout=full4：4 行含数字行，"R.C" 点分隔（Q=2.1，1=1.1，0=1.10），列可到 10 故必须点分。
const KBD_ROWS = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const KBD_FULL_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
function keyboardEncode(text, p) {
  const layout = (p && p.layout) || "qwerty3";
  if (layout === "full4") {
    const sep = (p && p.sep) || " ";
    return [...text.toUpperCase()].map((ch) => {
      for (let r = 0; r < KBD_FULL_ROWS.length; r++) {
        const c = KBD_FULL_ROWS[r].indexOf(ch);
        if (c !== -1) return (r + 1) + "." + (c + 1);
      }
      return ch;
    }).join(sep);
  }
  const sep = (p && p.sep) || " "; // 分隔符
  return [...text.toUpperCase()].map((ch) => {
    for (let r = 0; r < KBD_ROWS.length; r++) {
      const c = KBD_ROWS[r].indexOf(ch);
      if (c !== -1) return String(r + 1) + String(c + 1);
    }
    return ch;
  }).join(sep);
}
function keyboardDecode(text, p) {
  const layout = (p && p.layout) || "qwerty3";
  if (layout === "full4") {
    return text.split(/[\s,;]+/).filter(Boolean).map((token) => {
      const m = /^(\d+)\.(\d+)$/.exec(token);
      if (m) {
        const r = parseInt(m[1], 10) - 1;
        const c = parseInt(m[2], 10) - 1;
        if (r >= 0 && r < KBD_FULL_ROWS.length && c >= 0 && c < KBD_FULL_ROWS[r].length) {
          return KBD_FULL_ROWS[r][c];
        }
      }
      return token;
    }).join("");
  }
  return text.split(/[\s,;]+/).filter(Boolean).map((token) => {
    if (token.length === 2 && /^\d{2}$/.test(token)) {
      const r = parseInt(token[0], 10) - 1;
      const c = parseInt(token[1], 10) - 1;
      if (r >= 0 && r < KBD_ROWS.length && c >= 0 && c < KBD_ROWS[r].length) {
        return KBD_ROWS[r][c];
      }
    }
    return token;
  }).join("");
}

// ---- 注册 ----
register({
  id: "morse", cat: "fancy", name: "摩斯电码", desc: "ITU-R M.1677（字母/数字/标点，/ 分词）",
  encode: morseEncode, decode: morseDecode,
  detect: (t) => (/^[.\-/\s]+$/.test(t.trim()) && /[.-]/.test(t) && t.trim().length >= 5 ? 0.6 : 0),
});

register({
  id: "bacon", cat: "fancy", name: "培根密码", desc: "5 位 a/b（24/26 字母两版）",
  params: [
    { key: "version", label: "版本", type: "select", default: "26",
      options: [
        { value: "26", label: "26 字母版（每字母独立）" },
        { value: "24", label: "24 字母版（I=J, U=V）" },
      ],
    },
  ],
  encode: baconEncode, decode: baconDecode,
  detect: (t) => (/^[abAB01\s]+$/.test(t.trim()) && t.replace(/[^abAB01]/g, "").length % 5 === 0 && t.trim().length >= 5 ? 0.4 : 0),
});

register({
  id: "railFence", cat: "fancy", name: "栅栏密码", desc: "W 型 zigzag（参数：栏数）",
  params: [
    { key: "rails", label: "栏数", type: "number", default: 2, placeholder: "2-10" },
  ],
  encode: railFenceEncode, decode: railFenceDecode,
});

register({
  id: "caesar", cat: "fancy", name: "凯撒密码", desc: "指定位移量（encode +shift，decode -shift）；mode 可切递增/递减凯撒（第 x 字符位移 shift±x）",
  params: [
    { key: "shift", label: "位移量", type: "number", default: 3, placeholder: "1-25" },
    { key: "mode", label: "模式", type: "select", default: "standard",
      options: [
        { value: "standard", label: "标准（固定位移）" },
        { value: "progInc", label: "递增凯撒（第 x 字符位移 shift+x）" },
        { value: "progDec", label: "递减凯撒（第 x 字符位移 shift-x）" },
      ] },
  ],
  encode: (t, p) => caesarEncode(t, p),
  decode: (t, p) => caesarDecode(t, p),
});

register({
  id: "rot13", cat: "fancy", name: "ROT13", desc: "字母移位 13（自反）",
  encode: rot13, decode: rot13,
});
register({
  id: "rot5", cat: "fancy", name: "ROT5", desc: "数字移位 5（自反）",
  encode: rot5, decode: rot5,
});
register({
  id: "rot18", cat: "fancy", name: "ROT18", desc: "ROT13 + ROT5（自反）",
  encode: rot18, decode: rot18,
});
register({
  id: "rot47", cat: "fancy", name: "ROT47", desc: "ASCII 33-126 移位 47（自反）",
  encode: rot47, decode: rot47,
});

register({
  id: "atbash", cat: "fancy", name: "Atbash", desc: "字母反转（A↔Z，自反）",
  encode: atbash, decode: atbash,
});

register({
  id: "a1z26", cat: "fancy", name: "A1Z26", desc: "字母 ↔ 数字（1-26）",
  encode: a1z26Encode, decode: a1z26Decode,
  detect: (t) => (/^[\d\s,.\-]+$/.test(t.trim()) && t.trim().split(/[\s,.\-]+/).every((n) => !n || (parseInt(n, 10) >= 1 && parseInt(n, 10) <= 26)) ? 0.3 : 0),
});

register({
  id: "dna", cat: "fancy", name: "DNA 编码", desc: "3 字母密码子（A/C/G/T）↔ 字符",
  encode: dnaEncode, decode: dnaDecode,
  detect: (t) => (/^[ACGTacgt\s]+$/.test(t.trim()) && t.replace(/\s/g, "").length % 3 === 0 && t.trim().length >= 3 ? 0.4 : 0),
});

register({
  id: "keyboard", cat: "fancy", name: "键盘坐标",
  desc: "键盘行列坐标：qwerty3=3 字母行二位连写（Q=11）；full4=4 行含数字行 R.C 点分隔（Q=2.1，0=1.10）",
  params: [
    { key: "layout", label: "布局", type: "select", default: "qwerty3",
      options: [
        { value: "qwerty3", label: "三字母行（Q=11）" },
        { value: "full4", label: "含数字行 R.C（Q=2.1）" },
      ],
    },
  ],
  encode: keyboardEncode, decode: keyboardDecode,
 // 二位连写（Q=11）或 R.C 点分隔（Q=2.1，吸收原 kbdFullCoord detect）任一命中即可。
  detect: (t) => {
    const s = t.trim();
    if (/^([1-3][0-9])([\s,;]+[1-3][0-9])*$/.test(s)) return 0.3;
    if (/^\d+\.\d+(\s+\d+\.\d+)*$/.test(s)) return 0.4;
    return 0;
  },
});

export {
  morseEncode, morseDecode, MORSE, MORSE_REV,
  baconEncode, baconDecode, BACON24, BACON26, BACON24_ALPHA,
  railFenceEncode, railFenceDecode,
  caesarShift, rot13, rot5, rot18, rot47, atbash,
  a1z26Encode, a1z26Decode,
  dnaEncode, dnaDecode, DNA_MAP, DNA_REV,
  keyboardEncode, keyboardDecode, KBD_ROWS,
};
