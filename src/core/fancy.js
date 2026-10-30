/*
 * fancy.js — 花式 / CTF 编码 A 组（cat:'fancy'）。
 * 摩斯电码、培根密码（24/26 字母）、栅栏密码（W 型锯齿 / Z 型传统分栏）、凯撒、ROT13/5/18/47
 * Atbash、A1Z26、童子军木棍密码（dCode Code Chinois/Samurai）、DNA、敲击码 TapCode、键盘坐标。
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
// 码表来源：ITU-R M.1677-1 §1.1 的封闭清单 + 以下非 ITU 扩展（已逐条核验）：
//  常见但非官方：! ; & _ $
//  本工具自加：{ } * # %   （其中 # 在 ITU 清单中无对应码）
//  注意：& (.-...) 与 % (...-.-) 的码值分别与 ITU 的 prosign「等待」「结束工作」同形，语义不同。
// 类外字符（非 '.'/'-' 且非本表码）按「整 token 忽略」处置，不产出字符。
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
   // ④ 非纯点划 token = 类外输入：按「忽略」处置，该 token 不产出任何字符
   //   （此前把任何非 '.' 字符都当作 '1' 位，故 '#' 会静默解出 U+0001 控制字符）
      if (!/^[.\-]+$/.test(c)) return "";
   // ⑤ 未知纯点划码回退：'.'→0 '-'→1 → 16 位二进制 → chr（参考实现行为，仅对纯点划生效）
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

// ============ 栅栏密码（W 型锯齿 / Z 型传统分栏） ============
// 同一栏数下两种走法结果不同，仅 rails=2 时等价（都是奇偶位分离）：
//  - W 型：明文沿 0→1→…→(r-1)→…→0 的锯齿轨迹逐字符落行，再逐行读出（zigzag / rail fence）。
//    W 型可带偏移量 offset：轨迹开头先空出 offset 个格子再落字（dCode「Use an offset of +N
//    characters」口径），等价于从锯齿周期的第 offset 个位置起写。
//  - Z 型：传统分栏（百度百科「栅栏密码」、CTF「传统型（Z型）」口径）——明文按列自上而下
//    写入 r 行，再逐行读出；等价于「每 r 个字符一组，取每组第 i 个字符依次拼接」。Z 型无偏移量。
const RAIL_MIN = 2;
const RAIL_MAX = 64;
const RAIL_OFFSET_MAX = 64;

/** 栏数：空值取默认 2；其余必须是 2..64 的整数（不把 0/NaN 静默当默认）。 */
function railRails(v) {
  if (v === undefined || v === null || v === "") return 2;
  const n = Number(v);
  if (!Number.isInteger(n) || n < RAIL_MIN || n > RAIL_MAX)
    throw new Error(`栅栏密码：栏数须为 ${RAIL_MIN}..${RAIL_MAX} 的整数（当前 ${v}）。`);
  return n;
}

/** 模式：w = W 型锯齿（默认，兼容旧行为）；z = Z 型传统分栏。 */
function railMode(p) {
  const raw = p && p.mode;
  const m = String(raw === undefined || raw === null || raw === "" ? "w" : raw).toLowerCase();
  if (m !== "w" && m !== "z")
    throw new Error(`栅栏密码：未知模式 "${m}"（仅支持 w=W 型锯齿 / z=Z 型传统分栏）。`);
  return m;
}

/** W 型偏移量：空值取 0；其余必须是 0..64 的整数。 */
function railOffset(p) {
  const raw = p && p.offset;
  if (raw === undefined || raw === null || raw === "") return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > RAIL_OFFSET_MAX)
    throw new Error(`栅栏密码：偏移量须为 0..${RAIL_OFFSET_MAX} 的整数（当前 ${raw}）。`);
  return n;
}

/** W 型 zigzag 的逐字符行号序列。 */
function railWPattern(len, rails) {
  const pattern = new Array(len);
  let r = 0, dir = 1;
  for (let i = 0; i < len; i++) {
    pattern[i] = r;
    if (r === 0) dir = 1;
    else if (r === rails - 1) dir = -1;
    r += dir;
  }
  return pattern;
}

function railFenceEncode(text, p) {
  const rails = railRails(p && p.rails);
  const mode = railMode(p);
  const offset = railOffset(p);
  const chars = [...text];   // 按码点迭代：text[i] 是 UTF-16 码元，非 BMP 字符（emoji 等）代理对会被拆散打乱
  if (rails >= chars.length) return text;   // 栏数 ≥ 长度时无有效换位
  if (mode === "z") {
    if (offset !== 0)
      throw new Error("栅栏密码：Z 型（传统分栏）没有偏移量，请把偏移量设为 0 或改用 W 型。");
    // Z 型：按列写入（第 i 个字符落 i % rails 行），逐行读出
    const rows = Array.from({ length: rails }, () => []);
    for (let i = 0; i < chars.length; i++) rows[i % rails].push(chars[i]);
    return rows.map((row) => row.join("")).join("");
  }
  // W 型：锯齿轨迹落行（前 offset 格空置），逐行读出
  const pattern = railWPattern(chars.length + offset, rails);
  const rows = Array.from({ length: rails }, () => []);
  for (let i = 0; i < chars.length; i++) rows[pattern[offset + i]].push(chars[i]);
  return rows.map((row) => row.join("")).join("");
}

function railFenceDecode(text, p) {
  const rails = railRails(p && p.rails);
  const mode = railMode(p);
  const offset = railOffset(p);
  const chars = [...text];   // 按码点切分（与 encode 的 for-of 对称），避免代理对被拆散
  const len = chars.length;
  if (rails >= len) return text;
  if (mode === "z") {
    if (offset !== 0)
      throw new Error("栅栏密码：Z 型（传统分栏）没有偏移量，请把偏移量设为 0 或改用 W 型。");
    // Z 型：各行长度 = ceil((len - r) / rails)，按段回填后按 i % rails 交错还原
    const rows = [];
    let idx = 0;
    for (let r = 0; r < rails; r++) {
      const count = Math.ceil((len - r) / rails);
      rows.push(chars.slice(idx, idx + count));
      idx += count;
    }
    const out = new Array(len);
    for (let i = 0; i < len; i++) out[i] = rows[i % rails][Math.floor(i / rails)];
    return out.join("");
  }
  const pattern = railWPattern(len + offset, rails);
  // 每行字符数（只统计偏移之后实际落字的位置）
  const counts = new Array(rails).fill(0);
  for (let i = offset; i < pattern.length; i++) counts[pattern[i]]++;
  // 切片
  const rows = [];
  let idx = 0;
  for (let r = 0; r < rails; r++) {
    rows.push(chars.slice(idx, idx + counts[r]));
    idx += counts[r];
  }
  // 按 pattern 重组（从偏移位置起读）
  const ptr = new Array(rails).fill(0);
  const out = new Array(len);
  for (let i = 0; i < len; i++) {
    const row = pattern[offset + i];
    out[i] = rows[row][ptr[row]++];
  }
  return out.join("");
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
function caesarProgressive(text, shift, isEncode, isDec, charset) {
  const mod = charset === "ascii" ? 94 : 26;
  const s = ((shift % mod) + mod) % mod;
  const shiftFn = charset === "ascii" ? caesarShiftAscii : caesarShift;
  let out = "";
  for (let x = 0; x < text.length; x++) {
    const delta = isDec ? s - x : s + x;
    out += shiftFn(text[x], isEncode ? delta : -delta);
  }
  return out;
}
// ASCII 可打印区（33-126，94 字符环，同 ROT47 域）：**全字符**位移——含 _ { } 数字与大小写，
// 处理「非字母也在动」的凯撒变体题（如 flag{Caesar_variation} ← afZ_r9VYfScOeO_UL^RWUc）。
// 域外字符（控制符/高位 Unicode）原样透传。
function caesarShiftAscii(text, s) {
  return [...text].map((c) => {
    const code = c.charCodeAt(0);
    if (code < 33 || code > 126) return c;
    return String.fromCharCode(33 + ((((code - 33 + s) % 94) + 94) % 94));
  }).join("");
}
function caesarEncode(t, p) {
  const shift = Number((p && p.shift) || 3);
  const mode = (p && p.mode) || "standard";
  const charset = (p && p.charset) || "alpha";
  if (mode === "progInc") return caesarProgressive(t, shift, true, false, charset);
  if (mode === "progDec") return caesarProgressive(t, shift, true, true, charset);
  return charset === "ascii" ? caesarShiftAscii(t, shift) : caesarShift(t, shift);
}
function caesarDecode(t, p) {
  const shift = Number((p && p.shift) || 3);
  const mode = (p && p.mode) || "standard";
  const charset = (p && p.charset) || "alpha";
  if (mode === "progInc") return caesarProgressive(t, shift, false, false, charset);
  if (mode === "progDec") return caesarProgressive(t, shift, false, true, charset);
  return charset === "ascii" ? caesarShiftAscii(t, -shift) : caesarShift(t, -shift);
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

// ============ 童子军木棍密码（dCode Code Chinois / Samurai） ============
// 规则（dCode.fr/code-chinois FAQ）：经典中国码把字母拆成「元音序号 + 该元音之后的辅音序号」。
// 元音序：A=1 E=2 I=3 O=4 U=5 Y=6；横线=元音序号，竖线=辅音序号。例：C = A 后第 2 个辅音
// → 1 横 + 2 竖；L = I 后第 3 个辅音 → 3 横 + 3 竖。dCode 展示例 DCODE = `|||- ||- ---- |||- --`
// （竖线在前）。Samurai 变体把横/竖的角色对调。Y 按元音处理，Z 是 Y 后第 1 个辅音。
const SCOUT_VOWELS = ["A", "E", "I", "O", "U", "Y"];
const SCOUT_AFTER = SCOUT_VOWELS.map((v, i) => {
  const start = v.charCodeAt(0), end = i + 1 < SCOUT_VOWELS.length ? SCOUT_VOWELS[i + 1].charCodeAt(0) : 91;
  const arr = [];
  for (let c = start + 1; c < end; c++) arr.push(String.fromCharCode(c));
  return arr;
});

function scoutLetterInfo(ch) {
  const up = String(ch || "").toUpperCase();
  if (!/^[A-Z]$/.test(up)) return null;
  const vi = SCOUT_VOWELS.indexOf(up);
  if (vi >= 0) return { vowel: vi + 1, cons: 0 };
  let prev = -1;
  for (let i = 0; i < SCOUT_VOWELS.length; i++) {
    if (SCOUT_VOWELS[i].charCodeAt(0) < up.charCodeAt(0)) prev = i;
  }
  if (prev < 0) return null;
  return { vowel: prev + 1, cons: up.charCodeAt(0) - SCOUT_VOWELS[prev].charCodeAt(0) };
}

function scoutEncode(text, p = {}) {
  const variant = String(p.variant || "classic");
  const order = String(p.order || "vh");
  if (!["classic", "samurai"].includes(variant)) throw new Error("童子军木棍密码：variant 需为 classic/samurai");
  if (!["vh", "hv"].includes(order)) throw new Error("童子军木棍密码：order 需为 vh/hv");
  const out = [];
  for (const ch of String(text == null ? "" : text)) {
    const info = scoutLetterInfo(ch);
    if (info) {
      let h = info.vowel, v = info.cons;
      if (variant === "samurai") { const t = h; h = v; v = t; }
      const bars = order === "vh" ? "|".repeat(v) + "-".repeat(h) : "-".repeat(h) + "|".repeat(v);
      out.push(bars);
      continue;
    }
    if (/\s/.test(ch)) { out.push("/"); continue; }
    // 非字母透传；与 bar/分隔符冲突的字符用反斜杠转义，保证可逆。
    out.push(/[|/\\-]/.test(ch) ? "\\" + ch : ch);
  }
  return out.join(" ");
}

function scoutGlyphToLetter(shape, variant, order) {
  if (!/^[|\-]+$/.test(shape)) throw new Error("童子军木棍密码：非法字形 " + JSON.stringify(shape));
  let vCount = 0, hCount = 0;
  if (order === "vh") {
    const m = /^(\|*)(-*)$/.exec(shape);
    if (!m) throw new Error("童子军木棍密码：字形顺序应为「竖线在前、横线在后」：" + JSON.stringify(shape));
    vCount = m[1].length; hCount = m[2].length;
  } else {
    const m = /^(-*)(\|*)$/.exec(shape);
    if (!m) throw new Error("童子军木棍密码：字形顺序应为「横线在前、竖线在后」：" + JSON.stringify(shape));
    hCount = m[1].length; vCount = m[2].length;
  }
  const vowelIndex = variant === "samurai" ? vCount : hCount;
  const consIndex = variant === "samurai" ? hCount : vCount;
  if (vowelIndex < 1 || vowelIndex > 6) {
    throw new Error(`童子军木棍密码：元音序号 ${vowelIndex} 越界（1-6）`);
  }
  if (consIndex === 0) return SCOUT_VOWELS[vowelIndex - 1];
  const after = SCOUT_AFTER[vowelIndex - 1];
  if (consIndex > after.length) {
    throw new Error(`童子军木棍密码：${SCOUT_VOWELS[vowelIndex - 1]} 后只有 ${after.length} 个辅音，收到 ${consIndex}`);
  }
  return after[consIndex - 1];
}

function scoutDecode(text, p = {}) {
  const variant = String(p.variant || "classic");
  const order = String(p.order || "vh");
  if (!["classic", "samurai"].includes(variant)) throw new Error("童子军木棍密码：variant 需为 classic/samurai");
  if (!["vh", "hv"].includes(order)) throw new Error("童子军木棍密码：order 需为 vh/hv");
  const s = String(text == null ? "" : text).trim();
  if (!s) return "";
  const out = [];
  for (const tok of s.split(/\s+/).filter(Boolean)) {
    if (/^\/+$/.test(tok)) { out.push(" ".repeat(tok.length)); continue; }
    if (tok.startsWith("\\")) { out.push(tok.slice(1)); continue; }
    if (/^[|\-]+$/.test(tok)) { out.push(scoutGlyphToLetter(tok, variant, order)); continue; }
    out.push(tok);
  }
  return out.join("");
}

register({
  id: "scoutStick",
  cat: "fancy",
  name: "童子军木棍密码",
  desc: "dCode 的 Code Chinois（又称 Samurai/武士码）：横线=元音序号（A/E/I/O/U/Y=1-6），竖线=该元音之后的辅音序号；例 DCODE = `|||- ||- ---- |||- --`（竖线在前）。可切 Samurai 反置与横线在前写法；非字母原样透传",
  params: [
    { key: "variant", label: "变体", type: "select", default: "classic", options: [
      { value: "classic", label: "经典中国码（横=元音，竖=辅音）" },
      { value: "samurai", label: "Samurai 反置（横=辅音，竖=元音）" },
    ] },
    { key: "order", label: "书写顺序", type: "select", default: "vh", options: [
      { value: "vh", label: "竖线在前（dCode 示例）" },
      { value: "hv", label: "横线在前" },
    ] },
  ],
  encode: scoutEncode,
  decode: scoutDecode,
  detect: (t) => {
    const s = String(t == null ? "" : t).trim();
    if (!s || !/^[|\-\s/\\]+$/.test(s)) return 0;
    const glyphs = s.split(/\s+/).filter((x) => /^[|\-]+$/.test(x));
    return glyphs.length >= 2 ? 0.45 : 0;
  },
});

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
// 解码需同时吃下两种排版：分组（"ACT ACA"）与整段连写（"ACTACA…"）。
// 外部工具普遍输出连写形式，若只按分隔符切段会把整串当成一个密码子而查表落空。
function dnaDecode(text) {
  const segs = text.split(/[^01AGCTagct]+/).filter(Boolean);
  let out = "";
  for (const seg of segs) {
    if (/[01]/.test(seg)) {
      // 二进制形态：2 位 1 个碱基，6 位 1 个密码子
      for (let i = 0; i + 6 <= seg.length; i += 6) {
        const codon = (seg.slice(i, i + 6).match(/.{2}/g) || [])
          .map((b) => DNA_BIN[b] || "").join("");
        out += DNA_MAP[codon] || "";
      }
    } else {
      // 碱基形态：每 3 个碱基切一个密码子，长度不足的尾巴丢弃
      const s = seg.toUpperCase();
      for (let i = 0; i + 3 <= s.length; i += 3) {
        out += DNA_MAP[s.slice(i, i + 3)] || "";
      }
    }
  }
  return out;
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

// ============ 云影密码 / 01248 ============
// 0 作字母分隔；每段只由 1/2/4/8 组成，数字和即 A=1..Z=26。
function yunyingDecode(text) {
  const s = String(text == null ? "" : text).trim();
  if (!s) throw new Error("云影密码输入为空");
  const out = [];
  for (const part of s.split("0")) {
    if (!part) continue;
    if (!/^[1248]+$/.test(part)) throw new Error("云影密码每段只能由 1/2/4/8 组成（0 为分隔）");
    let n = 0;
    for (const ch of part) n += Number(ch);
    if (n < 1 || n > 26) throw new Error(`云影密码段「${part}」数字和 ${n} 超出 A-Z（1-26）`);
    out.push(A_UP[n - 1]);
  }
  if (!out.length) throw new Error("云影密码没有有效字母段（0 只是分隔符）");
  return out.join("");
}

function yunyingEncode(text) {
  const s = String(text == null ? "" : text).toUpperCase().replace(/\s+/g, "");
  if (!s) throw new Error("云影密码明文为空");
  if (!/^[A-Z]+$/.test(s)) throw new Error("云影密码只支持 A-Z 字母");
  const parts = [];
  for (const ch of s) {
    let n = A_UP.indexOf(ch) + 1;
    let part = "";
    for (const w of [8, 4, 2, 1]) {
      while (n >= w) { part += String(w); n -= w; }
    }
    parts.push(part);
  }
  return parts.join("0");
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
  id: "yunying", cat: "fancy", name: "云影密码（01248）",
  desc: "01248/云影密码：0 分隔字母，1/2/4/8 数字和映射 A=1..Z=26；encode 仅接受 A-Z，decode 严格校验每段数字和 1-26。",
  encode: yunyingEncode, decode: yunyingDecode,
  detect: (t) => (/^[01248\s]+$/.test(t.trim()) && /0/.test(t) && t.replace(/[^01248]/g, "").length >= 2 ? 0.45 : 0),
});

register({
  id: "railFence", cat: "classic", name: "栅栏密码", desc: "两种走法：W 型锯齿 zigzag（可带偏移量）/ Z 型传统分栏（按列写、按行读）；参数：栏数 + 模式 + 偏移量",
  params: [
    { key: "rails", label: "栏数", type: "number", default: 2, placeholder: "2-64" },
    { key: "mode", label: "模式", type: "select", default: "w",
      options: [
        { value: "w", label: "W 型（锯齿 zigzag）" },
        { value: "z", label: "Z 型（传统分栏）" },
      ] },
    { key: "offset", label: "偏移量（仅 W 型）", type: "number", default: 0, placeholder: "0-64" },
  ],
  encode: railFenceEncode, decode: railFenceDecode,
});

register({
  id: "caesar", cat: "classic", name: "凯撒密码", desc: "指定位移量（encode +shift，decode -shift）；mode 可切递增/递减凯撒（第 x 字符位移 shift±x）；字符集可切仅字母位移，或 ASCII 可打印区 33-126 全字符位移（处理非字母也在动的变体题）",
  params: [
    { key: "shift", label: "位移量", type: "number", default: 3, placeholder: "1-25" },
    { key: "mode", label: "模式", type: "select", default: "standard",
      options: [
        { value: "standard", label: "标准（固定位移）" },
        { value: "progInc", label: "递增凯撒（第 x 字符位移 shift+x）" },
        { value: "progDec", label: "递减凯撒（第 x 字符位移 shift-x）" },
      ] },
    { key: "charset", label: "字符集", type: "select", default: "alpha",
      options: [
        { value: "alpha", label: "字母（仅 A-Z a-z 位移）" },
        { value: "ascii", label: "ASCII 可打印（33-126 全字符位移）" },
      ] },
  ],
  encode: (t, p) => caesarEncode(t, p),
  decode: (t, p) => caesarDecode(t, p),
});

register({
  id: "rot13", cat: "fancy", family: "rot", familyLabel: "rot13", name: "ROT13", desc: "字母移位 13（自反）",
  encode: rot13, decode: rot13,
});
register({
  id: "rot5", family: "rot", familyLabel: "rot5", cat: "fancy", name: "ROT5", desc: "数字移位 5（自反）",
  encode: rot5, decode: rot5,
});
register({
  id: "rot18", family: "rot", familyLabel: "rot18", cat: "fancy", name: "ROT18", desc: "ROT13 + ROT5（自反）",
  encode: rot18, decode: rot18,
});
register({
  id: "rot47", family: "rot", familyLabel: "rot47", cat: "fancy", name: "ROT47", desc: "ASCII 33-126 移位 47（自反）",
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
  yunyingEncode, yunyingDecode,
  railFenceEncode, railFenceDecode,
  caesarShift, rot13, rot5, rot18, rot47, atbash,
  a1z26Encode, a1z26Decode,
  scoutEncode, scoutDecode, SCOUT_VOWELS, SCOUT_AFTER,
  dnaEncode, dnaDecode, DNA_MAP, DNA_REV,
  keyboardEncode, keyboardDecode, KBD_ROWS,
};
