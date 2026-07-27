/*
 * fancyExt.js — 花式 / CTF 编码 C 组（cat:'fancy'）。
 *
 * 覆盖：aaencode（颜文字）/ baudot（ITA2 博多码）/ type7（Cisco Type7）/
 * decabit（脉冲编码）/ scytale（栅格转置）。
 *
 * 各编码的表与常量:
 * - aaencode/aadecode : b 数组 16 项 + prefix_core 固定头部
 * - baudot : letters2/figures2 表 32 项，switchToLetters=11111/switchToFigures=11011
 * - type7 : MAGIC_VALUES 53 项常量表，salt_offset 异或
 * - decabit : pattern 127 项 +− 字符串表
 * - scytale : 栅格转置，column 参数，dec=True 时 column/rows 互换
 *
 * 与 fancy.js / fancy2.js 独立，仅共享 registry。
 */
import { register } from "./registry.js";

// ============================================================
// aaencode / aadecode（颜文字编码）
// b 数组 16 项：下标 0-15 对应十六进制数字 0-9,a-f
// ============================================================
const AA_B = [
  '(c^_^o)',
  '(ﾟΘﾟ)',
  '((o^_^o) - (ﾟΘﾟ))',
  '(o^_^o)',
  '(ﾟｰﾟ)',
  '((ﾟｰﾟ) + (ﾟΘﾟ))',
  '((o^_^o) +(o^_^o))',
  '((ﾟｰﾟ) + (o^_^o))',
  '((ﾟｰﾟ) + (ﾟｰﾟ))',
  '((ﾟｰﾟ) + (ﾟｰﾟ) + (ﾟΘﾟ))',
  '(ﾟДﾟ) .ﾟωﾟﾉ',
  '(ﾟДﾟ) .ﾟΘﾟﾉ',
  "(ﾟДﾟ) ['c']",
  '(ﾟДﾟ) .ﾟｰﾟﾉ',
  '(ﾟДﾟ) .ﾟДﾟﾉ',
  '(ﾟДﾟ) [ﾟΘﾟ]',
];

// 固定头部（encode 用带空格版，decode 用去空格版 = AA_PREFIX.replace(/\s+/g,"")）
// 内容含 2 个反斜杠（'\\'）与 1 个双引号（'"'），模板字面量中反斜杠需转义
const AA_PREFIX = `ﾟωﾟﾉ= /｀ｍ´）ﾉ ~┻━┻   //*´∇｀*/ ['_']; o=(ﾟｰﾟ)  =_=3; c=(ﾟΘﾟ) =(ﾟｰﾟ)-(ﾟｰﾟ); (ﾟДﾟ) =(ﾟΘﾟ)= (o^_^o)/ (o^_^o);(ﾟДﾟ)={ﾟΘﾟ: '_' ,ﾟωﾟﾉ : ((ﾟωﾟﾉ==3) +'_') [ﾟΘﾟ] ,ﾟｰﾟﾉ :(ﾟωﾟﾉ+ '_')[o^_^o -(ﾟΘﾟ)] ,ﾟДﾟﾉ:((ﾟｰﾟ==3) +'_')[ﾟｰﾟ] }; (ﾟДﾟ) [ﾟΘﾟ] =((ﾟωﾟﾉ==3) +'_') [c^_^o];(ﾟДﾟ) ['c'] = ((ﾟДﾟ)+'_') [ (ﾟｰﾟ)+(ﾟｰﾟ)-(ﾟΘﾟ) ];(ﾟДﾟ) ['o'] = ((ﾟДﾟ)+'_') [ﾟΘﾟ];(ﾟoﾟ)=(ﾟДﾟ) ['c']+(ﾟДﾟ) ['o']+(ﾟωﾟﾉ +'_')[ﾟΘﾟ]+ ((ﾟωﾟﾉ==3) +'_') [ﾟｰﾟ] + ((ﾟДﾟ) +'_') [(ﾟｰﾟ)+(ﾟｰﾟ)]+ ((ﾟｰﾟ==3) +'_') [ﾟΘﾟ]+((ﾟｰﾟ==3) +'_') [(ﾟｰﾟ) - (ﾟΘﾟ)]+(ﾟДﾟ) ['c']+((ﾟДﾟ)+'_') [(ﾟｰﾟ)+(ﾟｰﾟ)]+ (ﾟДﾟ) ['o']+((ﾟｰﾟ==3) +'_') [ﾟΘﾟ];(ﾟДﾟ) ['_'] =(o^_^o) [ﾟoﾟ] [ﾟoﾟ];(ﾟεﾟ)=((ﾟｰﾟ==3) +'_') [ﾟΘﾟ]+ (ﾟДﾟ) .ﾟДﾟﾉ+((ﾟДﾟ)+'_') [(ﾟｰﾟ) + (ﾟｰﾟ)]+((ﾟｰﾟ==3) +'_') [o^_^o -ﾟΘﾟ]+((ﾟｰﾟ==3) +'_') [ﾟΘﾟ]+ (ﾟωﾟﾉ +'_') [ﾟΘﾟ]; (ﾟｰﾟ)+=(ﾟΘﾟ); (ﾟДﾟ)[ﾟεﾟ]='\\\\'; (ﾟДﾟ).ﾟΘﾟﾉ=(ﾟДﾟ+ ﾟｰﾟ)[o^_^o -(ﾟΘﾟ)];(oﾟｰﾟo)=(ﾟωﾟﾉ +'_')[c^_^o];(ﾟДﾟ) [ﾟoﾟ]='"';(ﾟДﾟ) ['_'] ( (ﾟДﾟ) ['_'] (ﾟεﾟ+`;
const AA_PREFIX_CORE = AA_PREFIX.replace(/\s+/g, "");
const AA_SUFFIX = "(ﾟДﾟ)[ﾟoﾟ]) (ﾟΘﾟ)) ('_');";
const AA_SUFFIX_CORE = AA_SUFFIX.replace(/\s+/g, "");

function aaencode(text) {
  let r = AA_PREFIX;
  r += "(ﾟДﾟ)[ﾟoﾟ]+ ";
  for (const ch of text) {
    const n = ch.codePointAt(0);
    let t = "(ﾟДﾟ)[ﾟεﾟ]+";
    if (n <= 127) {
 // 八进制，每位数字 d (0-7) → b[d] + "+ "
      const oct = n.toString(8);
      for (const d of oct) t += AA_B[parseInt(d, 10)] + "+ ";
    } else {
 // 十六进制，每位数字 d (0-f) → b[d] + "+ "
      t += "(oﾟｰﾟo)+ ";
      const hex = n.toString(16);
      for (const d of hex) t += AA_B[parseInt(d, 16)] + "+ ";
    }
    r += t;
  }
  r += "(ﾟДﾟ)[ﾟoﾟ]) (ﾟΘﾟ)) ('_');";
  return r;
}

function aadecode(text) {
 // 原源有 valid_chars 过滤但漏了 ';'，致 prefix_core（含';'）匹配失败 → 不剥头尾。
 // 此处改为直接去空白（不过滤字符），prefix/suffix 精确匹配后剥除，更稳健。
  let s = text.replace(/\s+/g, "");
 // 去头部
  if (s.includes(AA_PREFIX_CORE)) {
    s = s.split(AA_PREFIX_CORE).pop();
  }
 // 去尾部
  if (s.includes(AA_SUFFIX_CORE)) {
    s = s.split(AA_SUFFIX_CORE)[0];
  }
 // 去 /*´∇｀*/
  s = s.replace(/\/\*´∇｀\*\//g, "");
 // 替换 b[i] → hex(i)。按符号长度降序替换，避免短符号污染长符号
 // （原源逆序 i=15..0 有 bug：b[2]含b[3]子串，i=3先替换会破坏b[2]，致 digit 2 解不出）
  const replPairs = AA_B.map((sym, i) => [sym.replace(/\s+/g, ""), i.toString(16)])
    .sort((a, b) => b[0].length - a[0].length);
  for (const [sym, hex] of replPairs) {
    s = s.split(sym).join(hex);
  }
 // (3-1) → 2（兼容其它 aaencode 变体）
  s = s.replace(/\(3-1\)/g, "2");
 // 不再全局去 (oﾟｰﾟo)：原源用 (oﾟｰﾟo) 标记非 ASCII 字符的 hex 段
 // 全局去掉会丢失 hex/octal 判据，致 "恒"(U+6052, hex="6052" 全 0-7) 被误判为八进制。
  const sep = "(ﾟДﾟ)[ﾟεﾟ]";
  const parts = s.split(sep).filter((x) => x.trim());
  const HEX_MARKER = "(oﾟｰﾟo)";
  let dec = "";
  for (const x of parts) {
 // 去 +
    let t = x.replace(/\+/g, "");
 // 段内含 (oﾟｰﾟo) → 非 ASCII 的 hex 段
    let isHex = false;
    if (t.includes(HEX_MARKER)) {
      isHex = true;
      t = t.split(HEX_MARKER).join("");
    }
 // 去除残留非 hex 字符（如首段 (ﾟДﾟ)[ﾟoﾟ] 前缀）
    const cleaned = t.replace(/[^0-9a-fA-F]/g, "");
    if (!cleaned) continue;
    let code;
    if (isHex) {
      code = parseInt(cleaned, 16);
    } else if (/^[0-7]+$/.test(cleaned)) {
 // ASCII 八进制
      code = parseInt(cleaned, 8);
    } else if (/^[0-9a-fA-F]+$/.test(cleaned)) {
 // fallback 十六进制（理论上 ASCII octal 不会走到这）
      code = parseInt(cleaned, 16);
    } else {
      continue;
    }
    if (!isNaN(code)) dec += String.fromCodePoint(code);
  }
  return dec;
}

// ============================================================
// baudot（ITA2/ITA1 博多码）
// letters/figures 表各 32 项；ITA2: switchToLetters=11111(31)/switchToFigures=11011(27)
// ============================================================
const BAUDOT_LETTERS1 = [
  '*NUL*', 'A', 'E', '\r', 'Y', 'U', 'I', 'O', '*FIGURES*', 'J', 'G', 'H',
  'B', 'C', 'F', 'D', ' ', '\n', 'X', 'Z', 'S', 'T', 'W', 'V', '*DEL*',
  'K', 'M', 'L', 'R', 'Q', 'N', 'P',
];
const BAUDOT_FIGURES1 = [
  '*NUL*', '1', '2', '\r', '3', '4', '', '5', ' ', '6', '7', '+', '8',
  '9', '', '0', '*LETTERS*', '\n', ',', ':', '.', '', '?', "'", '*DEL*',
  '(', ')', '=', '-', '/', '', '%',
];
const BAUDOT_LETTERS2 = [
  '*NUL*', 'E', '\n', 'A', ' ', 'S', 'I', 'U', '\r', 'D', 'R', 'J', 'N',
  'F', 'C', 'K', 'T', 'Z', 'L', 'W', 'H', 'Y', 'P', 'Q', 'O', 'B', 'G',
  '*FIGURES*', 'M', 'X', 'V', '*LETTERS*',
];
const BAUDOT_FIGURES2 = [
  '*NUL*', '3', '\n', '-', ' ', "'", '8', '7', '\r', '*ENQUIRY*', '4', '*BELL*',
  ',', '!', ':', '(', '5', '+', ')', '2', '$', '6', '0', '1', '9',
  '?', '&', '*FIGURES*', '.', '/', ';', '*LETTERS*',
];

function baudotEncode(text, variant) {
  const letters = variant === "ita1" ? BAUDOT_LETTERS1 : BAUDOT_LETTERS2;
  const figures = variant === "ita1" ? BAUDOT_FIGURES1 : BAUDOT_FIGURES2;
  const switchToLetters = variant === "ita1" ? "10000" : "11111";
  const switchToFigures = variant === "ita1" ? "01000" : "11011";
  let dst = "";
  let sep = "";
  let figureMode = false;
  for (const ch of text) {
    const up = ch.toUpperCase();
    let idx = letters.indexOf(up);
    if (idx !== -1) {
      if (figureMode) {
        figureMode = false;
 // 不在 switch 后加 " "，sep 已负责分隔；否则首字符会变 "11011 " 再加 sep=" " → 双空格
        dst += sep + switchToLetters;
        sep = " ";
      }
    } else {
      idx = figures.indexOf(up);
      if (idx !== -1) {
        if (!figureMode) {
          figureMode = true;
          dst += sep + switchToFigures;
          sep = " ";
        }
      } else {
 // 不在任一表：跳过（原源 try/except 会中止，这里更稳健）
        continue;
      }
    }
    dst += sep + idx.toString(2).padStart(5, "0");
    sep = " ";
  }
  return dst;
}

function baudotDecode(text, variant) {
  const letters = variant === "ita1" ? BAUDOT_LETTERS1 : BAUDOT_LETTERS2;
  const figures = variant === "ita1" ? BAUDOT_FIGURES1 : BAUDOT_FIGURES2;
  const switchToLetters = variant === "ita1" ? 16 : 31;
  const switchToFigures = variant === "ita1" ? 8 : 27;
  const bits = text.replace(/\s+/g, "");
  let dst = "";
  let figureMode = false;
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    const idx = parseInt(bits.substring(i, i + 5), 2);
    if (idx === switchToFigures) {
      figureMode = true;
    } else if (idx === switchToLetters) {
      figureMode = false;
    } else if (figureMode) {
      dst += figures[idx] || "";
    } else {
      dst += letters[idx] || "";
    }
  }
  return dst;
}

// ============================================================
// type7（Cisco Type7）
// MAGIC_VALUES 53 项常量表，salt_offset 异或
// ============================================================
const TYPE7_MAGIC = [
  100, 115, 102, 100, 59, 107, 102, 111, 65, 44, 46, 105, 121, 101,
  119, 114, 107, 108, 100, 74, 75, 68, 72, 83, 85, 66, 115, 103,
  118, 99, 97, 54, 57, 56, 51, 52, 110, 99, 120, 118, 57, 56, 55,
  51, 50, 53, 52, 107, 59, 102, 103, 56, 55,
];

function type7Encrypt(text, salt) {
  const saltOffset = ((Math.floor(salt) % 53) + 53) % 53;
  const seed = String(saltOffset).padStart(2, "0");
  let enc = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    let h;
    if (saltOffset + i > 52) {
      h = code.toString(16);
    } else {
      h = (TYPE7_MAGIC[saltOffset + i] ^ code).toString(16);
    }
    if (h.length === 1) h = "0" + h;
    enc += h;
  }
  return (seed + enc).toUpperCase();
}

function type7Decrypt(encoded) {
  const s = encoded.trim();
  if (s.length % 2 !== 0) throw new Error("type7: 密文长度需为偶数");
  if (s.length < 2) return "";
  const saltOffset = parseInt(s.substring(0, 2), 10);
  if (isNaN(saltOffset)) throw new Error("type7: 前两位非数字 salt");
  let dec = "";
  let index = 0;
  for (let i = 2; i < s.length; i += 2) {
    index++;
    const encChar = parseInt(s.substring(i, i + 2), 16);
    if (isNaN(encChar)) throw new Error(`type7: 位置 ${i}-${i + 2} 非十六进制`);
    let ch;
    if (saltOffset + index - 1 < 53) {
      ch = String.fromCharCode(encChar ^ TYPE7_MAGIC[saltOffset + index - 1]);
    } else {
      ch = String.fromCharCode(encChar);
    }
    dec += ch;
  }
  return dec;
}

// ============================================================
// decabit（脉冲编码）
// pattern 127 项（值 0-126 → 10 字符 +− 串）
// ============================================================
const DECABIT_PATTERNS = new Array(127);
const DECABIT_REV = {};
const _DECABIT_RAW = `
--+-+++-+-:0
+--+++--+-:1
+--++-+-+-:2
+--+-++-+-:3
----+++-++:4
++--+++---:5
++--++--+-:6
++--+-+-+-:7
++---++-+-:8
---++++-+-:9
+-+-+++---:10
+-+-+-+-+-:11
+-+--++-+-:12
+---++-++-:13
+---++--++:14
--+++-++--:15
---++-+++-:16
+---+-++-+:17
+--++--+-+:18
+--++-+--+:19
+-+++--+--:20
+--+++-+--:21
++--+-++--:22
-+-++-++--:23
+--++--++-:24
+-+++-+---:25
++-+--++--:26
+-+-+-++--:27
+--+-+++--:28
+--+--++-+:29
+-++-++---:30
+-++-+-+--:31
+-+-++-+--:32
+---++++--:33
+-+--+-++-:34
+++--++---:35
+++--+-+--:36
+++---++--:37
++---+++--:38
--+-++++--:39
++--++-+--:40
-+-+-+-++-:41
++----+++-:42
+----+-+++:43
++---+-+-+:44
++-+-+-+--:45
++-+-+--+-:46
+++----++-:47
++--+--++-:48
+--+-+-++-:49
++++----+-:50
++-++---+-:51
+-+++---+-:52
-++++---+-:53
+-+-+---++:54
+++-++----:55
+++-+-+---:56
+-+-+--++-:57
-++-+--++-:58
+++-+----+:59
++++-+----:60
-+++-++---:61
-+-+-++-+-:62
++---++--+:63
++-+--+--+:64
++-+++----:65
++++--+---:66
+--++++---:67
-+-++++---:68
++-+--+-+-:69
-++---+++-:70
+---+-+++-:71
--+-+-+++-:72
+----++++-:73
--+--++++-:74
+++---+-+-:75
+-++---++-:76
+--+--+++-:77
--++--+++-:78
+-+---+-++:79
-+++--+-+-:80
-+-++-+-+-:81
-+++---++-:82
-+-++--++-:83
-+---++++-:84
-++++--+--:85
-++-++-+--:86
--++++-+--:87
--++-+++--:88
--++-+-++-:89
+-++++----:90
--++++--+-:91
--++-++-+-:92
+--+-+--++:93
+-++----++:94
-+-+++--+-:95
-++-+-+-+-:96
-+--++-++-:97
---+++-++-:98
-+--+-+++-:99
+---+++-+-:100
-+--+++-+-:101
+-+-++--+-:102
+--++-++--:103
++-++--+--:104
+-++--++--:105
+-+--+++--:106
-++--+++--:107
++---+-++-:108
++-+---++-:109
+++-+---+-:110
+++-+--+--:111
++-+-++---:112
++-++-+---:113
+-+---+++-:114
+-++--+-+-:115
-+-+--+++-:116
-+++-+-+--:117
+-++-+--+-:118
-++-+++---:119
+++--+--+-:120
+++++-----:121
-+++++----:122
--+++++---:123
---+++++--:124
----+++++-:125
++++++++++:126
`;
for (const line of _DECABIT_RAW.trim().split("\n")) {
  const [pat, val] = line.split(":");
  const v = parseInt(val, 10);
  DECABIT_PATTERNS[v] = pat;
  DECABIT_REV[pat] = v;
}

function decabitEncode(text) {
  const parts = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code < 0 || code > 126) {
      throw new Error(`decabit: 字符 "${ch}"(U+${code.toString(16).toUpperCase()}) 超出 0-126 范围`);
    }
    parts.push(DECABIT_PATTERNS[code]);
  }
  return parts.join(" ");
}

function decabitDecode(text, asNumber) {
 // 提取所有 +/- 连续段（空格/换行等自然分隔），每段按 10 字符切块
  const runs = text.match(/[+\-]+/g) || [];
  let result = "";
  for (const run of runs) {
    const chunks = run.match(/.{1,10}/g) || [];
    for (const chunk of chunks) {
      if (chunk.length === 10) {
        const val = DECABIT_REV[chunk];
        if (val !== undefined) {
          result += asNumber ? val + " " : String.fromCharCode(val);
        } else {
          result += " {?} ";
        }
      } else {
        result += " {?} ";
      }
    }
  }
  return result;
}

// ============================================================
// scytale（栅格转置）
// column 参数，dec=True 时 column/rows 互换，| 占位解码时去除
// ============================================================
function scytaleCrypto(text, column, dec) {
  column = Math.floor(column);
  if (column < 1) throw new Error("scytale: 栏数需 ≥ 1");
  let rows = Math.ceil(text.length / column);
  if (dec) {
    const tmp = column;
    column = rows;
    rows = tmp;
  }
  let result = "";
  for (let i = 0; i < column; i++) {
    for (let j = 0; j < rows; j++) {
      const idx = j * column + i;
      if (idx < text.length) {
        result += text[idx];
      } else {
        result += "|";
      }
    }
  }
  if (dec) {
    result = result.replace(/\|/g, "");
  }
  return result;
}

// ============================================================
// 注册
// ============================================================
register({
  id: "aaencode", cat: "fancy", name: "颜文字 aaencode",
  desc: "aaencode 颜文字 JS 风格编码（ASCII 八进制 / 非 ASCII 十六进制）",
  encode: aaencode, decode: aadecode,
  detect: (t) => (/ﾟωﾟﾉ/.test(t) && /ﾟДﾟ/.test(t) ? 0.7 : 0),
});

register({
  id: "baudot", cat: "fancy", name: "博多码 Baudot",
  desc: "ITA2/ITA1 博多码 5 位二进制（letters/figures 双表，模式切换）",
  params: [
    { key: "variant", label: "变体", type: "select", default: "ita2",
      options: [
        { value: "ita2", label: "ITA2（国际，默认）" },
        { value: "ita1", label: "ITA1（早期 Murray）" },
      ],
    },
  ],
  encode: (t, p) => baudotEncode(t, (p && p.variant) || "ita2"),
  decode: (t, p) => baudotDecode(t, (p && p.variant) || "ita2"),
  detect: (t) => (/^[01\s]+$/.test(t.trim()) && t.trim().replace(/\s/g, "").length % 5 === 0 && t.trim().length >= 5 ? 0.3 : 0),
});

register({
  id: "type7", cat: "fancy", name: "Cisco Type7",
  desc: "Cisco 密码 Type7（MAGIC_VALUES 53 项异或，seed 前缀 2 位）",
  params: [
    { key: "salt", label: "salt (0-52)", type: "number", default: 0, placeholder: "0-52" },
  ],
  encode: (t, p) => type7Encrypt(t, Number((p && p.salt) || 0)),
  decode: (t) => type7Decrypt(t),
  detect: (t) => (/^[0-9A-Fa-f]+$/.test(t.trim()) && t.trim().length >= 4 && t.trim().length % 2 === 0 ? 0.2 : 0),
});

register({
  id: "decabit", cat: "fancy", name: "Decabit 脉冲码",
  desc: "Decabit 10 符号 +− 脉冲编码（0-126 字符表）",
  params: [
    { key: "asNumber", label: "解码输出数字", type: "bool", default: false },
  ],
  encode: (t) => decabitEncode(t),
  decode: (t, p) => decabitDecode(t, !!(p && p.asNumber)),
  detect: (t) => (/^[+\-\s]+$/.test(t.trim()) && /[+\-]/.test(t) && t.trim().replace(/\s/g, "").length % 10 === 0 ? 0.5 : 0),
});

register({
  id: "scytale", cat: "fancy", name: "Scytale 密码棒",
  desc: "古希腊栅格转置（column 栏数，按列读出；| 占位）",
  params: [
    { key: "column", label: "栏数", type: "number", default: 2, placeholder: "≥1" },
  ],
 // 用 ?? 而非 ||：col=0 时 || 把 0 当 falsy → 变 2，致 col=0 不触发栏数<1 异常
  encode: (t, p) => scytaleCrypto(t, Number((p && p.column) ?? 2), false),
  decode: (t, p) => scytaleCrypto(t, Number((p && p.column) ?? 2), true),
});
