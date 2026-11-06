/*
 * keyboardExt.js — 键盘 / 布局编码补全组（cat:'fancy'）。
 *
 * 覆盖：
 * - layoutMap QWERTY ↔ Dvorak ↔ Colemak 物理键位映射（全 47 键双射置换）
 * - t9Phone 手机九宫格 T9（键号 + 按次二位编码 a=21 b=22 c=23 … z=94，空格=00）
 * - multitap 手机全键盘多击（2=a 22=b 222=c，空格分隔字母，0=空格）
 * - kbdFullCoord 键盘行列坐标（含数字行 4 行，格式 R.C 空格分隔，如 Q=2.1）
 * - stenoLetter Steno 速记字母（Plover 拼写形 fingerspelling，A-Z ↔ 单 stroke 和弦）
 * - arrowKey 方向键编码（↑↓←→ ↔ WASD/UDLR/数字小键盘，参数选方案）
 *
 * 红线：
 * - 不碰 keyboard.js。现有键盘 op id 已查重避让：
 * keyboard.js：keyCode / shiftKey / keyword9 / keyboardSurround / qweAbc
 * fancy.js： keyboard / tapcode
 * fancy3.js： keyboardShift
 * - 本文件全部为双向 encode/decode，跑往返测试。
 * - 布局映射照抄 Wikipedia 公开标准；Steno 码表逐键取自 Plover 官方词典 main.json
 * 的拼写形（fingerspelling）条目，不编造。
 *
 * 注册契约：register({id, cat:"fancy", name, desc, params, encode?, decode?})
 */
import { register } from "./registry.js";

// ============ 1. layoutMap：QWERTY ↔ Dvorak ↔ Colemak ============
// 三套布局定义为等长（47 字符）的物理键序串，同一物理键在三个串中下标相同。
// 即三串互为同一 47 字符集合的置换——保证双射，往返无损。
//
// 字符集（47）：` 1-9 0 - = q w e r t y u i o p [ ] \ a s d f g h j k l ; ' z x c v b n m , . /
// 来源（unshifted 主键，不含空格 / 修饰键）：
// QWERTY 行：`1234567890-= / qwertyuiop[]\ / asdfghjkl;' / zxcvbnm,./
// Dvorak 行：`1234567890[] / ',.pyfgcrl/=\ / aoeuidhtns- / ;qjkxbmwvz
// Colemak 行：`1234567890-= / qwfpgjluy;[]\ / arstdhneio' / zxcvbkm,./
// （Dvorak 行序：数字行 / 上字母行 / 主行 / 下行；下行 10 键含首位 ;）
const LAY_QWERTY  = "`1234567890-=qwertyuiop[]\\asdfghjkl;'zxcvbnm,./";
const LAY_DVORAK  = "`1234567890[]',.pyfgcrl/=\\aoeuidhtns-;qjkxbmwvz";
const LAY_COLEMAK = "`1234567890-=qwfpgjluy;[]\\arstdhneio'zxcvbkm,./";

// 构建置换映射：from → to，按字符级（大小写保留：大写输入按小写查表后转大写输出）。
function buildLayoutMap(fromStr, toStr) {
  const m = {};
  for (let i = 0; i < fromStr.length; i++) m[fromStr[i]] = toStr[i];
  return m;
}
const Q2D = buildLayoutMap(LAY_QWERTY, LAY_DVORAK);
const D2Q = buildLayoutMap(LAY_DVORAK, LAY_QWERTY);
const Q2C = buildLayoutMap(LAY_QWERTY, LAY_COLEMAK);
const C2Q = buildLayoutMap(LAY_COLEMAK, LAY_QWERTY);
// Dvorak ↔ Colemak 经 QWERTY 中转（双射复合仍双射）。
const D2C = buildLayoutMap(LAY_DVORAK, LAY_COLEMAK);
const C2D = buildLayoutMap(LAY_COLEMAK, LAY_DVORAK);

// 大小写转义：47 键只建模 unshifted 主键，目标键是标点时无法靠 toUpperCase 保留大写。
// 用 ~（不在 47 键集合）作为标记：~x = 源字符为大写、目标键为无大小写的 x；字面 ~ 写作 ~~。
const LAY_ESC = "~";
const isAsciiLetter = (ch) => (ch >= "A" && ch <= "Z") || (ch >= "a" && ch <= "z");

function layoutConvert(text, map, decode = false) {
  const chars = [...text];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === LAY_ESC) {
      if (!decode) {
        out += LAY_ESC + LAY_ESC; // 字面 ~ 转义
        continue;
      }
      const next = chars[++i];
      if (next === undefined) throw new Error("键盘布局映射：末尾有悬空 ~ 转义。");
      if (next === LAY_ESC) { out += LAY_ESC; continue; }
      const src = map[next];
      if (src === undefined) throw new Error("键盘布局映射：~ 后的字符不在目标布局内。");
      out += src.toUpperCase(); // 标记表示源字符为大写
      continue;
    }
    const up = ch >= "A" && ch <= "Z";
    const low = up ? ch.toLowerCase() : ch;
    const dst = map[low];
    if (dst === undefined) { out += ch; continue; } // 不在 47 键集合内（如空格、换行、中文）原样保留
    if (decode) {
      out += up ? dst.toUpperCase() : dst;
    } else if (up && !isAsciiLetter(dst)) {
      out += LAY_ESC + dst; // 目标键无大小写，标记源字符的大写
    } else {
      out += up ? dst.toUpperCase() : dst;
    }
  }
  return out;
}

// encode = QWERTY → 目标布局；decode = 目标布局 → QWERTY
function layoutEncode(text, p) {
  const t = (p && p.layout) || "dvorak";
  const map = t === "colemak" ? Q2C : t === "dvorak" ? Q2D : null;
  if (!map) throw new Error("未知布局: " + t);
  return layoutConvert(text, map, false);
}
function layoutDecode(text, p) {
  const t = (p && p.layout) || "dvorak";
  const map = t === "colemak" ? C2Q : t === "dvorak" ? D2Q : null;
  if (!map) throw new Error("未知布局: " + t);
  return layoutConvert(text, map, true);
}
// 额外导出 Dvorak↔Colemak 直转（供测试与未来扩展，不单独注册 op）。
function dvorakToColemak(text) { return layoutConvert(text, D2C); }
function colemakToDvorak(text) { return layoutConvert(text, C2D); }

// ============ 2. t9Phone：手机九宫格 T9（键号 + 按次） ============
// 标准 T9 九宫格：键 2=abc 3=def 4=ghi 5=jkl 6=mno 7=pqrs 8=tuv 9=wxyz。
// 二位编码：十位=键号(2-9)，个位=该键上第几次(1-4)。
// a=21 b=22 c=23 / d=31 e=32 f=33 / … / w=91 x=92 y=93 z=94
// 空格 = 00。只处理大写字母 + 空格，其余原样保留（不参与编码）。
const T9_KEYS = ["", "", "ABC", "DEF", "GHI", "JKL", "MNO", "PQRS", "TUV", "WXYZ"];
const T9_ENC = {}; // 字母 → 二位码
const T9_DEC = {}; // 二位码 → 字母
for (let key = 2; key <= 9; key++) {
  const letters = T9_KEYS[key];
  for (let i = 0; i < letters.length; i++) {
    const code = String(key) + String(i + 1);
    T9_ENC[letters[i]] = code;
    T9_DEC[code] = letters[i];
  }
}
T9_DEC["00"] = " ";
T9_ENC[" "] = "00";

function t9Encode(text) {
  let out = "";
  for (const ch of text) {
    const up = ch.toUpperCase();
    if (T9_ENC[up]) out += T9_ENC[up];
    else if (T9_ENC[ch]) out += T9_ENC[ch];
    else out += ch; // 数字 / 标点原样保留
  }
  return out;
}
function t9Decode(text) {
  let out = "";
  let buf = "";
  for (const ch of text) {
    if (ch >= "0" && ch <= "9") {
      buf += ch;
      if (buf.length === 2) {
        out += T9_DEC[buf] !== undefined ? T9_DEC[buf] : buf;
        buf = "";
      }
    } else {
      // 标点/空白先冲刷未成对数字，再原样输出，避免把标点吞进数字对。
      if (buf) { out += buf; buf = ""; }
      out += ch;
    }
  }
  if (buf) out += buf;
  return out;
}

// ============ 3. multitap：手机全键盘多击 ============
// 2=a 22=b 222=c / 3=d 33=e 333=f / … / 7=p 77=q 777=r 7777=s / 9=w 99=x 999=y 9999=z
// 同键字母用按键次数区分；不同字母间用空格分隔以消歧（"aaa"="2 2 2"，"c"="222"）。
// 空格 = 0。输出统一大写。
const MULTITAP_ENC = {}; // 字母 → 重复数字串
const MULTITAP_DEC = {}; // 重复数字串 → 字母
for (let key = 2; key <= 9; key++) {
  const letters = T9_KEYS[key];
  for (let i = 0; i < letters.length; i++) {
    const code = String(key).repeat(i + 1);
    MULTITAP_ENC[letters[i]] = code;
    MULTITAP_DEC[code] = letters[i];
  }
}
MULTITAP_ENC[" "] = "0";
MULTITAP_DEC["0"] = " ";

function multitapEncode(text) {
  const tokens = [];
  for (const ch of text) {
    const up = ch.toUpperCase();
    if (MULTITAP_ENC[up]) tokens.push(MULTITAP_ENC[up]);
    else tokens.push(ch); // 非字母空格原样作一个 token
  }
  return tokens.join(" ");
}
function multitapDecode(text) {
  return text.split(/\s+/).filter((t) => t.length > 0).map((t) => {
    if (MULTITAP_DEC[t]) return MULTITAP_DEC[t];
    return t; // 无法识别的 token 原样保留
  }).join("");
}

// C7-P13 合并：t9Phone 吸收 multitap，mode 参数分派（twoDigit 二位固定 / multitap 多击）。
// 原 t9Encode/multitapEncode 等函数保持不变（仍导出供测试），此处仅按 mode 转调。
function t9OpEncode(text, p) {
  const mode = (p && p.mode) || "twoDigit";
  return mode === "multitap" ? multitapEncode(text) : t9Encode(text);
}
function t9OpDecode(text, p) {
  const mode = (p && p.mode) || "twoDigit";
  return mode === "multitap" ? multitapDecode(text) : t9Decode(text);
}

// ============ 4. kbdFullCoord：键盘行列坐标（含数字行） ============
// 4 行键盘（数字行 + 三字母行），每键 → "行.列"（均 1-indexed）。
// 行1: 1234567890 (10 键，0 在第 10 列)
// 行2: QWERTYUIOP (10 键)
// 行3: ASDFGHJKL (9 键)
// 行4: ZXCVBNM (7 键)
// 与 fancy.js id:"keyboard"（仅 3 字母行、二位连写如 Q=11）区分：本 op 含数字行且用 R.C 分隔。
const KBD_FULL_ROWS = ["1234567890", "QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];
const KBD_FULL_ENC = {}; // 字符 → "R.C"
const KBD_FULL_DEC = {}; // "R.C" → 字符
for (let r = 0; r < KBD_FULL_ROWS.length; r++) {
  const row = KBD_FULL_ROWS[r];
  for (let c = 0; c < row.length; c++) {
    const coord = (r + 1) + "." + (c + 1);
    KBD_FULL_ENC[row[c]] = coord;
    KBD_FULL_DEC[coord] = row[c];
  }
}

function kbdFullCoordEncode(text) {
  const tokens = [];
  for (const ch of text) {
    const up = ch.toUpperCase();
    if (KBD_FULL_ENC[up]) tokens.push(KBD_FULL_ENC[up]);
    else tokens.push(ch); // 非键盘字符原样保留
  }
  return tokens.join(" ");
}
function kbdFullCoordDecode(text) {
  return text.split(/\s+/).filter((t) => t.length > 0).map((t) => {
    if (KBD_FULL_DEC[t]) return KBD_FULL_DEC[t];
    return t; // 非坐标 token 原样保留
  }).join("");
}

// ============ 5. stenoLetter：Steno 速记字母（Plover 拼写形 fingerspelling） ============
// 速记机（steno）单 stroke 拼写形和弦表，逐键取自 Plover 官方词典 main.json 的
// 拼写形（fingerspelling）小写条目（A*=>{>}{&a} … STKPW*=>{>}{&z}），是 Plover
// 和弦体系的拼写子集：不含大小写修饰、元音 e/i/u 星号在前（*E/*EU/*U）。
// 每个字母 ↔ 一个唯一 steno chord（steno 键序 STKPWHRAO*EUFRPBLGTSDZ 的子集）。
// 和弦间用空格分隔，往返无损（26 个 chord 两两不同）。
const STENO_LETTER = {
  A: "A*", B: "PW*", C: "KR*", D: "TK*", E: "*E", F: "TP*", G: "TKPW*", H: "H*",
  I: "*EU", J: "SKWR*", K: "K*", L: "HR*", M: "PH*", N: "TPH*", O: "O*", P: "P*",
  Q: "KW*", R: "R*", S: "S*", T: "T*", U: "*U", V: "SR*", W: "W*", X: "KP*",
  Y: "KWR*", Z: "STKPW*",
};
const STENO_LETTER_REV = {};
for (const [k, v] of Object.entries(STENO_LETTER)) STENO_LETTER_REV[v] = k;

function stenoEncode(text) {
  if (typeof text !== "string" || text.length === 0) throw new Error("stenoLetter: 输入必须为非空字符串");
  const tokens = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const up = ch.toUpperCase();
    if (STENO_LETTER[up]) tokens.push(STENO_LETTER[up]);
    else if (ch === " ") tokens.push("/"); // 词间空格用 / 编码，避免与 join 分隔符混淆
    else throw new Error("stenoLetter: 非法字符 " + JSON.stringify(ch) + "（位置 " + i + "）"); // 非字母显式抛错
  }
  return tokens.join(" ");
}
function stenoDecode(text) {
  if (typeof text !== "string" || text.length === 0) throw new Error("stenoLetter: 输入必须为非空字符串");
  return text.split(/\s+/).filter((t) => t.length > 0).map((t) => {
    if (t === "/") return " ";
    if (STENO_LETTER_REV[t]) return STENO_LETTER_REV[t];
    throw new Error("stenoLetter: 无法识别的 token " + JSON.stringify(t)); // 未知 token 显式抛错
  }).join("");
}

// ============ 6. arrowKey：方向键编码 ============
// ↑↓←→ ↔ WASD / UDLR / 数字小键盘（8/2/4/6）。参数 scheme 选字母方案。
// encode：方案字母 → 箭头符号；decode：箭头符号 → 方案字母。
// 同方案下 encode/decode 互逆，往返无损。
const ARROW_UP = "\u2191", ARROW_DOWN = "\u2193", ARROW_LEFT = "\u2190", ARROW_RIGHT = "\u2192";
const ARROW_SCHEMES = {
  wasd:    { up: "W", down: "S", left: "A", right: "D" },
  udlr:    { up: "U", down: "D", left: "L", right: "R" },
  numeric: { up: "8", down: "2", left: "4", right: "6" },
};
// 箭头 → 方向键名；方向键名 → 箭头（与方案无关）
const DIR_TO_ARROW = { up: ARROW_UP, down: ARROW_DOWN, left: ARROW_LEFT, right: ARROW_RIGHT };
// 大小写标记：箭头本身无大小写，用小写源字母时在箭头后追加 ~；字面 ~ 用 \ 转义，字面 \ 写 \\。
const ARROW_ESC = "\\";
const ARROW_LOWER = "~";

function arrowEncode(text, p) {
  const scheme = (p && p.scheme) || "wasd";
  const sc = ARROW_SCHEMES[scheme];
  if (!sc) throw new Error("未知方案: " + scheme);
 // 方案字母 → 方向键名
  const letterToDir = {};
  for (const d of ["up", "down", "left", "right"]) letterToDir[sc[d]] = d;
  let out = "";
  for (const ch of text) {
    const up = ch.toUpperCase();
    const dir = letterToDir[up];
    if (dir) {
      out += DIR_TO_ARROW[dir];
      if (ch !== up) out += ARROW_LOWER; // 记录源字母是小写
    } else if (ch === ARROW_UP || ch === ARROW_DOWN || ch === ARROW_LEFT || ch === ARROW_RIGHT) {
      out += ch;
    } else if (ch === ARROW_ESC || ch === ARROW_LOWER) {
      out += ARROW_ESC + ch; // 字面转义符/标记符
    } else {
      out += ch; // 非方向字符原样保留
    }
  }
  return out;
}
function arrowDecode(text, p) {
  const scheme = (p && p.scheme) || "wasd";
  const sc = ARROW_SCHEMES[scheme];
  if (!sc) throw new Error("未知方案: " + scheme);
  const arrowToLetter = {};
  arrowToLetter[ARROW_UP] = sc.up;
  arrowToLetter[ARROW_DOWN] = sc.down;
  arrowToLetter[ARROW_LEFT] = sc.left;
  arrowToLetter[ARROW_RIGHT] = sc.right;
  const chars = [...text];
  let out = "";
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ARROW_ESC) {
      if (i + 1 >= chars.length)
        throw new Error("方向键编码：末尾有悬空转义符（字面反斜杠请写成双反斜杠）。");
      out += chars[++i];
      continue;
    }
    const letter = arrowToLetter[ch];
    if (letter) {
      if (chars[i + 1] === ARROW_LOWER) {
        out += letter.toLowerCase();
        i++;
      } else {
        out += letter;
      }
      continue;
    }
    if (ch === ARROW_LOWER)
      throw new Error("方向键编码：孤立的 ~ 大小写标记（缺少前置箭头）。");
    out += ch;
  }
  return out;
}

// ============ 注册 ============
register({
  id: "layoutMap", cat: "fancy", name: "键盘布局映射",
  desc: "QWERTY ↔ Dvorak ↔ Colemak 物理键位置换（47 键双射，大小写保留）",
  params: [
    { key: "layout", label: "目标布局", type: "select", default: "dvorak",
      options: [
        { value: "dvorak", label: "Dvorak" },
        { value: "colemak", label: "Colemak" },
      ],
    },
  ],
  encode: layoutEncode,
  decode: layoutDecode,
});

register({
  id: "t9Phone", cat: "fancy", name: "手机九宫格 T9",
  desc: "手机 T9 键盘编码：twoDigit=二位固定（键号+按次，a=21 … z=94，空格=00）；multitap=多击（2=a 22=b 222=c，空格分词，0=空格）",
  params: [
    { key: "mode", label: "模式", type: "select", default: "twoDigit",
      options: [
        { value: "twoDigit", label: "二位固定（a=21 … z=94）" },
        { value: "multitap", label: "多击（2=a 22=b 222=c）" },
      ],
    },
  ],
  encode: t9OpEncode,
  decode: t9OpDecode,
 // 吸收原 multitap detect：twoDigit=键号2-9+按次1-4或00；multitap=2-9重复/0+/1+，空格分词。
  detect: (t) => {
    const s = t.trim();
    if (/^([2-9][1-4]|00)(\s+([2-9][1-4]|00))*$/.test(s)) return 0.4;
    if (/^([2-9]{1,4}|0+|1+)(\s+([2-9]{1,4}|0+|1+))*$/.test(s)) return 0.4;
    // 连写 twoDigit（无空格）：偶数长度纯数字，每两位是合法 T9 码（键号 2-9 + 按次 1-4，或 00）。
    // decode 能解连写串（每 2 位一组），但上面两条要求空格分隔 → 连写 CTF 输入漏认。低置信兜底。
    if (/^([2-9][1-4]|00){2,}$/.test(s)) return 0.3;
    return 0;
  },
});

// C7-P14 合并：kbdFullCoord 已并入 fancy.js 的 keyboard（layout=full4），此处不再注册。
// kbdFullCoordEncode/Decode 函数仍导出供测试/复用。

register({
  id: "stenoLetter", cat: "fancy", name: "Steno 速记字母",
  desc: "速记机字母和弦（Plover 拼写形 fingerspelling，A-Z ↔ 单 stroke，空格分词）",
  params: [],
  encode: stenoEncode,
  decode: stenoDecode,
});

register({
  id: "arrowKey", cat: "fancy", name: "方向键编码",
  desc: "↑↓←→ ↔ WASD / UDLR / 数字小键盘（参数选方案，同方案往返无损）",
  params: [
    { key: "scheme", label: "字母方案", type: "select", default: "wasd",
      options: [
        { value: "wasd", label: "WASD（W上 A左 S下 D右）" },
        { value: "udlr", label: "UDLR（U上 D下 L左 R右）" },
        { value: "numeric", label: "数字小键盘（8上 2下 4左 6右）" },
      ],
    },
  ],
  encode: arrowEncode,
  decode: arrowDecode,
});

export {
 // 布局映射
  LAY_QWERTY, LAY_DVORAK, LAY_COLEMAK,
  Q2D, D2Q, Q2C, C2Q, D2C, C2D,
  buildLayoutMap, layoutConvert, layoutEncode, layoutDecode,
  dvorakToColemak, colemakToDvorak,
 // T9
  T9_KEYS, T9_ENC, T9_DEC, t9Encode, t9Decode,
 // 多击
  MULTITAP_ENC, MULTITAP_DEC, multitapEncode, multitapDecode,
 // 键盘坐标
  KBD_FULL_ROWS, KBD_FULL_ENC, KBD_FULL_DEC,
  kbdFullCoordEncode, kbdFullCoordDecode,
 // Steno
  STENO_LETTER, STENO_LETTER_REV, stenoEncode, stenoDecode,
 // 方向键
  ARROW_SCHEMES, DIR_TO_ARROW, arrowEncode, arrowDecode,
};
