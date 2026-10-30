/*
 * radixExt.js — 进制 / 数学工具扩展（cat:'radix'）。
 *
 * 收录的算法：
 * - hybridCode（混合进制解码）
 * - separationAscii（数字串贪婪分割 ASCII）
 * - asciiOffset（ASCII 偏移带 key/穷举）
 * - decimalToFloat（10 进制转 2-36 进制小数，BigInt 有理数 / 循环节检测）
 * - floatToDecimal（2-36 进制小数转十进制，支持前缀与循环节）
 * - binaryComplement（原码/反码/补码）
 * - completion（补 0 对齐）
 * - splitHex（N 位分割）
 * - standardCode（字符集互转）
 * - timestamp（时间戳↔时间）
 * - gcd（最大公约数）
 * - primeFactor（素数分解）
 * - fibonacci（斐波那契解码）
 *
 * 契约：能双向的 encode/decode，单向工具 run 返报告文本。
 * 与 radix.js 6 项不重复（radixConvert/asciiRadix/ieee754/grayNum/bcd/binPad 已有）。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

// ============ hybridCode（混合进制解码）============
// 输入 "b1101000 x68 o150 d104" 形式，前缀 b/x/o/d 分别按 2/16/8/10 解析为字符
function hybridCodeDecode(text) {
  const s = text.trim();
  let parts;
  if (s.includes("\\")) parts = s.split("\\").filter(Boolean);
  else if (s.includes(" ")) parts = s.split(/\s+/).filter(Boolean);
  else if (s.includes(",")) parts = s.split(",").filter(Boolean);
  else parts = [s];
  let out = "";
  for (const x of parts) {
    if (!x) continue;
    const prefix = x[0].toLowerCase();
    const rest = x.slice(1);
    let code;
    if (prefix === "b") code = parseInt(rest, 2);
    else if (prefix === "x") code = parseInt(rest, 16);
    else if (prefix === "o") code = parseInt(rest, 8);
    else if (prefix === "d") code = parseInt(rest, 10);
    else throw new Error("hybridCode: 未知前缀 '" + x[0] + "'（应为 b/x/o/d）");
    if (isNaN(code)) throw new Error("hybridCode: 非法数字 " + x);
    out += String.fromCodePoint(code);
  }
  return out;
}
function hybridCodeEncode(text, p) {
 // decode 用 String.fromCodePoint(code)，所以 encode 用 codePointAt 而非 UTF-8 字节
 // 这样 BMP 和补充平面字符都能 roundtrip（按字符 code 解码设计一致）
  const mode = (p && p.mode) || "hex";
  const sep = (p && p.sep) || " ";
  return [...text].map((ch) => {
    const cp = ch.codePointAt(0);
    if (mode === "hex") return "x" + cp.toString(16);
    if (mode === "dec") return "d" + cp;
    if (mode === "oct") return "o" + cp.toString(8);
    if (mode === "bin") return "b" + cp.toString(2);
    if (mode === "auto") {
      const opts = [
        ["d", cp.toString(10)],
        ["x", cp.toString(16)],
        ["o", cp.toString(8)],
        ["b", cp.toString(2)],
      ];
      opts.sort((a, b) => a[1].length - b[1].length);
      return opts[0][0] + opts[0][1];
    }
    throw new Error("hybridCode: 未知 mode " + mode);
  }).join(sep);
}

// ============ separationAscii（数字串贪婪分割 ASCII，参考实现）============
function separationOneScale(s, scale) {
  const validChars = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, scale);
  if (![...s].every((c) => validChars.includes(c.toLowerCase()))) return null;
  let temp = "", result = "";
  for (const ch of s) {
    temp += ch;
    const v = parseInt(temp, scale);
    if (v >= 32 && v <= 126) {
      result += String.fromCharCode(v);
      temp = "";
    }
  }
  if (temp) return null; // 末尾有未消费字符，分割不完整
  return result;
}
function separationAscii(text) {
  const s = text.trim().replace(/\s+/g, "");
  if (!s) return "（空输入）";
  const results = [];
 // 1. 整数 → bytes → UTF-8/latin1
  try {
    if (/^\d+$/.test(s)) {
      let n = BigInt(s);
      const bytes = [];
      if (n > 0n) {
        // 大端字节直出：toString(16) 对 2 的幂基数为近线性，替代逐字节 &/>> 的 O(n²)
        const hex = n.toString(16);
        bytes.length = (hex.length + 1) >> 1;
        let j = bytes.length - 1;
        for (let off = hex.length - 2; off >= 0; off -= 2, j--) bytes[j] = parseInt(hex.slice(off, off + 2), 16);
        if (hex.length & 1) bytes[0] = parseInt(hex[0], 16);
      }
      const dec = td(bytes);
      if (dec && /^[\x20-\x7e]+$/.test(dec)) results.push("整数→字节: " + dec);
    }
  } catch {}
 // 2. 贪婪分割 10/16/8/2 进制
  for (const scale of [10, 16, 8, 2]) {
    const r = separationOneScale(s, scale);
    if (r) results.push(scale + " 进制: " + r);
  }
  return results.length ? results.join("\n") : "（无可行分割）";
}

// ============ asciiOffset（ASCII 偏移，参考实现）============
function asciiOffset(text, offset) {
  return [...text].map((c) => String.fromCharCode(c.charCodeAt(0) + offset)).join("");
}
function asciiOffsetBrute(text) {
  const lines = [];
  for (let i = -26; i <= 26; i++) {
    if (i === 0) continue;
    const out = [...text].map((c) => String.fromCharCode(c.charCodeAt(0) + i)).join("");
    lines.push(i + "\t" + out);
  }
  return lines.join("\n");
}

// ============ decimalToFloat（10 进制转 2-36 进制小数，BigInt 有理数）============
// 旧实现用 Number 逐位乘基，只有 2/8/10/16 且 0.1 一类会被双精度污染。现改为
// 「输入 → 精确分数 p/q → 任意 base 长除」，余数重复即检测到循环节；
// 精度只限制最多输出多少位，不再用 Number 冒充精确。
const FLOAT_DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const FLOAT_PRECISION_MAX = 2048;
const FLOAT_INPUT_MAX = 4096;
const FLOAT_BASE_MIN = 2;
const FLOAT_BASE_MAX = 36;

function assertFloatBase(base, label = "进制") {
  const b = Number(base);
  if (!Number.isInteger(b) || b < FLOAT_BASE_MIN) {
    throw new Error(`${label}须为 2-36 的整数（收到 ${base}）`);
  }
  if (b > FLOAT_BASE_MAX) {
    if (b <= 95) {
      throw new Error(`${label} ${b} 超出当前浮点支持范围：小数换基仅支持 2-36。37-95 的可见 ASCII 表含 . ( ) + - 等语法字符，直接套用会与小数点/循环节/正负号冲突，故不冒充支持；整数 37-95 请用「任意进制 radixN」。`);
    }
    throw new Error(`${label} ${b} 超出范围：仅支持 2-36（37-95 未提供无歧义小数位字符表）。`);
  }
  return b;
}

function clampFloatPrecision(value, dflt, min = 1) {
  if (value === undefined || value === null || String(value).trim() === "") return dflt;
  const n = Number(value);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(FLOAT_PRECISION_MAX, Math.trunc(n)));
}

function floatGcd(a, b) {
  a = a < 0n ? -a : a;
  b = b < 0n ? -b : b;
  while (b) { [a, b] = [b, a % b]; }
  return a;
}

function normalizeRational(num, den) {
  if (den === 0n) throw new Error("分母不能为 0");
  if (den < 0n) { num = -num; den = -den; }
  if (num === 0n) return { num: 0n, den: 1n };
  const g = floatGcd(num, den);
  return { num: num / g, den: den / g };
}

function floatDigitValue(ch, base) {
  const v = FLOAT_DIGITS.indexOf(String(ch).toUpperCase());
  if (v < 0 || v >= base) {
    const range = base <= 10 ? `0-${base - 1}` : `0-9 / A-${FLOAT_DIGITS[base - 1]}`;
    throw new Error(`非法 ${base} 进制字符: ${ch}（可用 ${range}）`);
  }
  return v;
}

function powBase(base, n) {
  if (n < 0) throw new Error("内部错误：负指数");
  return BigInt(base) ** BigInt(n);
}

/**
 * 解析 base 进制浮点串为精确有理数。
 * 支持：正负号、匹配进制的 0b/0o/0d/0x 前缀、小数点、循环节 0.(3)/0.1(6)。
 * @returns {{num:bigint, den:bigint}}
 */
function parseRadixRational(text, base) {
  base = assertFloatBase(base, "输入进制");
  let s = String(text == null ? "" : text).trim().replace(/\s+/g, "");
  if (!s) throw new Error("空输入");
  if (s.length > FLOAT_INPUT_MAX) throw new Error(`输入过长（${s.length} 字符，上限 ${FLOAT_INPUT_MAX}）`);
  let neg = false;
  if (s[0] === "-" || s[0] === "+") { neg = s[0] === "-"; s = s.slice(1); }
  if (!s) throw new Error("只有正负号，缺少数字");
  const pm = /^0([bBoOxXdD])/.exec(s);
  if (pm) {
    const want = base === 2 ? "b" : base === 8 ? "o" : base === 16 ? "x" : base === 10 ? "d" : "";
    // 仅剥离与所选进制匹配的前缀；base16 的 0BEEF 是合法十六进制数，不能误判成 0b
    if (want && pm[1].toLowerCase() === want) s = s.slice(2);
  }
  if (!s) throw new Error("只有进制前缀，缺少数字");

  let repeat = null;
  const open = s.indexOf("(");
  if (open >= 0) {
    if (s[s.length - 1] !== ")" || s.indexOf("(", open + 1) >= 0 || s.indexOf(")") !== s.length - 1) {
      throw new Error("循环节格式错误：只允许末尾一个括号，如 0.(3) / 0.1(6)");
    }
    repeat = s.slice(open + 1, -1);
    s = s.slice(0, open);
    if (!repeat) throw new Error("循环节不能为空");
    if (repeat.includes(".")) throw new Error("循环节内不能再有小数点");
  }

  const dot = s.indexOf(".");
  if (dot !== s.lastIndexOf(".")) throw new Error("非法数字：小数点过多");
  const intPart = dot >= 0 ? s.slice(0, dot) : s;
  const fracPart = dot >= 0 ? s.slice(dot + 1) : "";
  if (!intPart && !fracPart && !repeat) throw new Error("缺少数字");

  let num = 0n;
  for (const ch of intPart) num = num * BigInt(base) + BigInt(floatDigitValue(ch, base));
  let den = 1n;
  if (fracPart) {
    let f = 0n;
    for (const ch of fracPart) f = f * BigInt(base) + BigInt(floatDigitValue(ch, base));
    den = powBase(base, fracPart.length);
    num = num * den + f;
  }
  if (repeat) {
    let r = 0n;
    for (const ch of repeat) r = r * BigInt(base) + BigInt(floatDigitValue(ch, base));
    const p = powBase(base, fracPart.length);
    const repDen = powBase(base, repeat.length) - 1n;
    const addDen = p * repDen;
    num = num * addDen + r * den;
    den = den * addDen;
  }
  return normalizeRational(neg ? -num : num, den);
}

/** 十进制精确解析：整数/小数/科学计数法/分数 a/b/循环小数 0.(3)。 */
function parseDecimalRational(text) {
  let s = String(text == null ? "" : text).trim().replace(/\s+/g, "");
  if (!s) throw new Error("空输入");
  if (s.length > FLOAT_INPUT_MAX) throw new Error(`输入过长（${s.length} 字符，上限 ${FLOAT_INPUT_MAX}）`);
  let neg = false;
  if (s[0] === "-" || s[0] === "+") { neg = s[0] === "-"; s = s.slice(1); }
  if (!s) throw new Error("只有正负号，缺少数字");
  if (s.includes("/")) {
    const parts = s.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("分数格式应为 a/b，且分母不能为空");
    const a = parseDecimalRational(parts[0]);
    const b = parseDecimalRational(parts[1]);
    if (b.num === 0n) throw new Error("分母不能为 0");
    const num = a.num * b.den;
    const den = a.den * b.num;
    return normalizeRational(neg ? -num : num, den);
  }
  let r;
  const sci = /^([0-9]*\.?[0-9]*)[eE]([+-]?\d+)$/.exec(s);
  if (sci) {
    if (!sci[1] || sci[1] === ".") throw new Error("科学计数法格式错误，应形如 1.25e-3");
    r = parseDecimalRational(sci[1]);
    const e = Number(sci[2]);
    if (!Number.isSafeInteger(e) || Math.abs(e) > FLOAT_INPUT_MAX) throw new Error(`指数 ${sci[2]} 超出范围（±${FLOAT_INPUT_MAX}）`);
    if (e >= 0) r = normalizeRational(r.num * powBase(10, e), r.den);
    else r = normalizeRational(r.num, r.den * powBase(10, -e));
  } else {
    r = parseRadixRational(s, 10);
  }
  return normalizeRational(neg ? -r.num : r.num, r.den);
}

/**
 * 有理数 → base 进制小数字符串。
 * 余数重复 → 循环节；达到 precision 仍未终止/未循环 → truncated=true。
 */
function convertRationalToBase(rat, base, precision) {
  base = assertFloatBase(base, "目标进制");
  const pv = (precision === undefined || precision === null || String(precision).trim() === "")
    ? NaN : Number(precision);
  const cap = Number.isFinite(pv)
    ? Math.max(0, Math.min(FLOAT_PRECISION_MAX, Math.trunc(pv)))
    : 64;
  const norm = normalizeRational(rat.num, rat.den);
  let num = norm.num;
  const neg = num < 0n;
  if (neg) num = -num;
  const den = norm.den;
  const baseBig = BigInt(base);

  const intPart = num / den;
  let rem = num % den;
  let intStr = "0";
  if (intPart > 0n) {
    const ds = [];
    let n = intPart;
    while (n > 0n) { ds.push(Number(n % baseBig)); n /= baseBig; }
    intStr = ds.reverse().map((d) => FLOAT_DIGITS[d]).join("");
  }

  const digits = [];
  const seen = new Map();
  let cycleStart = -1;
  let truncated = false;
  while (rem !== 0n) {
    if (seen.has(rem)) { cycleStart = seen.get(rem); break; }
    if (digits.length >= cap) { truncated = true; break; }
    seen.set(rem, digits.length);
    rem *= baseBig;
    const d = rem / den;
    rem %= den;
    digits.push(Number(d));
  }

  const prefix = cycleStart >= 0 ? digits.slice(0, cycleStart) : digits;
  const cycle = cycleStart >= 0 ? digits.slice(cycleStart) : [];
  const digitStr = (arr) => arr.map((d) => FLOAT_DIGITS[d]).join("");
  let out = intStr;
  if (cycleStart >= 0) {
    out += "." + digitStr(prefix) + "(" + digitStr(cycle) + ")";
  } else if (digits.length > 0) {
    out += "." + digitStr(digits);
  }
  if (neg && (intPart > 0n || digits.length > 0)) out = "-" + out;
  return {
    text: out,
    cycle: digitStr(cycle),
    cycleStart,
    cycleLen: cycle.length,
    truncated,
    cap,
    intStr,
    fracDigits: digitStr(digits),
    neg,
  };
}

function conversionNote(conv) {
  if (conv.cycleStart >= 0) {
    return `（循环节 ${conv.cycle}，从第 ${conv.cycleStart + 1} 位小数开始，节长 ${conv.cycleLen}）`;
  }
  if (conv.truncated) return `（已截断到 ${conv.cap} 位，未检出循环）`;
  return "";
}

function decimalToFloat(num, base, precision = 64) {
  base = Number(base);
  if (base === 1) {
    const n = Number(num);
    const intPart = Math.floor(n);
    const decPart = Math.round((n - intPart) * Math.pow(base, precision));
    return decPart > 0 ? "1".repeat(intPart) + "." + "1".repeat(decPart) : "1".repeat(intPart);
  }
  const prec = clampFloatPrecision(precision, 64, 1);
  const rat = parseDecimalRational(String(num));
  return convertRationalToBase(rat, base, prec).text;
}

function decimalToFloatRun(text, p) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) throw new Error("空输入");
  const rat = parseDecimalRational(raw);
  const prec = clampFloatPrecision(p && p.precision, 16, 1);
  const baseRaw = Number((p && p.base) || 0);
  let bases;
  if (baseRaw === 0) {
    bases = [2, 8, 10, 16]; // 旧四档报告保持兼容
  } else {
    bases = [assertFloatBase(baseRaw, "目标进制")];
  }
  const lines = [
    `输入: ${raw}`,
    `精度: ${prec} 位小数（上限 ${FLOAT_PRECISION_MAX}）`,
  ];
  if (rat.den !== 1n) lines.push(`精确分数: ${rat.num}/${rat.den}（BigInt 有理数，无浮点误差）`);
  for (const b of bases) {
    const conv = convertRationalToBase(rat, b, prec);
    lines.push(`${b} 进制: ${conv.text}${conversionNote(conv)}`);
  }
  return lines.join("\n");
}

// ============ binaryComplement（原码/反码/补码，参考实现）============
function binaryComplement(text) {
  const dec = parseInt(text.trim(), 10);
  if (isNaN(dec)) throw new Error("无效整数: " + text);
 // 自适应位宽 8/16/32
  let bits = 8;
  if (dec < -128 || dec > 127) bits = 16;
  if (dec < -32768 || dec > 32767) bits = 32;
  const range = Math.pow(2, bits - 1);
  if (dec < -range || dec > range - 1) throw new Error(`数值 ${dec} 超出 ${bits} 位有符号范围 [-${range}, ${range - 1}]`);
  const sign = dec < 0 ? "1" : "0";
  const mag = Math.abs(dec).toString(2).padStart(bits - 1, "0");
  const orig = sign + mag;
 // 反码：负数符号位不变，数值位取反；正数同原码
  const inv = dec < 0
    ? "1" + mag.split("").map((c) => (c === "0" ? "1" : "0")).join("")
    : "0" + mag;
 // 补码：负数 = 反码 +1；正数同原码
  let comp;
  if (dec < 0) {
    const invVal = parseInt(inv, 2);
    comp = (invVal + 1).toString(2).padStart(bits, "0");
  } else {
    comp = "0" + mag;
  }
  return `10 进制数：${dec}\n位宽：${bits} bit\n原码：${orig}\n反码：${inv}\n补码：${comp}`;
}

// ============ 反向：任意进制浮点 → 十进制 / 位串 → 原反补码 ============

function floatToDecimalRun(text, p = {}) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) throw new Error("空输入");
  const baseRaw = (p && p.base != null && p.base !== "") ? Number(p.base) : 10;
  const base = assertFloatBase(baseRaw, "输入进制");
  const prec = clampFloatPrecision(p && p.precision, 16, 0);
  const rat = parseRadixRational(raw, base);
  const conv = convertRationalToBase(rat, 10, prec);
  const lines = [
    `${base} 进制浮点: ${raw}`,
    `十进制: ${conv.text}${conversionNote(conv)}`,
    `精度: ${prec} 位小数（上限 ${FLOAT_PRECISION_MAX}）`,
  ];
  if (rat.den !== 1n) lines.push(`精确分数: ${rat.num}/${rat.den}（BigInt 有理数，无浮点误差）`);
  return lines.join("\n");
}

function complementToDecRun(text, p = {}) {
  let s = String(text == null ? "" : text).trim().replace(/\s+/g, "");
  if (!/^[01]+$/.test(s)) throw new Error("需要二进制位串（仅 0/1）");
  const bits = Math.max(1, Math.min(64, Number(p.bits) || s.length));
  if (s.length > bits) throw new Error(`位串长度 ${s.length} 超过指定位宽 ${bits}`);
  s = s.padStart(bits, "0");
  const width = BigInt(bits);
  const raw = BigInt("0b" + s);
  const sign = (raw >> (width - 1n)) & 1n;
  const magMask = (1n << (width - 1n)) - 1n;
  const mag = raw & magMask;
  const full = 1n << width;
  // 原码/反码存在 -0：BigInt 的 -0n 会归一成 0n，必须手工保留负号再拼接。
  const orig = sign ? "-" + mag : String(raw);
  const inv = sign ? "-" + ((1n << (width - 1n)) - 1n - mag) : String(raw);
  const comp = String(sign ? raw - full : raw);
  return [
    `位串: ${s}`,
    `位宽: ${bits} bit（最高位 ${sign ? 1 : 0} = ${sign ? "负" : "正"}）`,
    `按原码解释: ${orig}`,
    `按反码解释: ${inv}`,
    `按补码解释: ${comp}`,
    "",
    "三种编码只在负数时不同；正数三者相同。CTF 中给出位串未说明编码时，优先看题目语境或逐个试。",
  ].join("\n");
}

// ============ completion（补 0 对齐，参考实现）============
function completionEncode(text, p) {
  const target = Number((p && p.bits) || 0);
  let s = text.trim().replace(/\s+/g, " ");
 // 去前缀 0b/0x/0o（全局 replace）
  if (s.includes("0b")) s = s.replace(/0b/g, "");
  else if (s.includes("0x")) s = s.replace(/0x/g, "");
  else if (s.includes("0o")) s = s.replace(/0o/g, "");
  const parts = s.split(/\s+/).filter(Boolean);
  if (parts.length === 0) throw new Error("空输入");
  let tlen;
  if (target === 0) {
    tlen = Math.max(...parts.map((t) => t.length));
  } else {
    tlen = target;
  }
  return parts.map((t) => t.padStart(tlen, "0")).join(" ");
}
function completionDecode(text) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  return parts.map((t) => t.replace(/^0+(?=\d)/, "")).join(" ");
}

// ============ splitHex（N 位分割，参考实现）============
function splitHex(text, p) {
  const s = text.trim().replace(/\s+/g, "");
  if (!s) return "（空输入）";
  const sizes = (p && p.sizes) || [2, 4, 8];
  const lines = sizes.map((sz) => {
    const parts = [];
    for (let i = 0; i < s.length; i += sz) parts.push(s.slice(i, i + sz));
    return `${sz} 位分割：${parts.join(" ")}`;
  });
  return lines.join("\n");
}

// ============ standardCode（字符集互转，参考实现）============
const STD_ENCODINGS = [
  "utf-8", "utf-16le", "utf-16be", "latin1", "iso-8859-1",
  "gbk", "gb18030", "big5", "shift_jis", "euc-jp", "windows-1252",
];
function standardCodeRun(text) {
  const s = text.trim();
  if (!s) return "（空输入）";
  const isHex = /^[0-9a-fA-F\s]+$/.test(s) && s.replace(/\s/g, "").length % 2 === 0 && s.replace(/\s/g, "").length >= 2;
  const lines = [];
  if (isHex) {
    const hex = s.replace(/\s/g, "");
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
    lines.push(`输入: hex (${bytes.length} 字节)\n`);
    for (const enc of STD_ENCODINGS) {
      try {
        const dec = new TextDecoder(enc, { fatal: false }).decode(bytes);
        const hasReplacement = dec.includes("\uFFFD");
        lines.push(`${enc} 解码: ${dec}${hasReplacement ? "  （含替换符 U+FFFD）" : ""}`);
      } catch {
        lines.push(`${enc}: 浏览器不支持`);
      }
    }
  } else {
    lines.push(`输入: 文本 (${s.length} 字符)\n`);
    for (const enc of STD_ENCODINGS) {
      try {
        let bytes;
        if (enc === "utf-8") {
          bytes = te(s);
        } else if (enc === "utf-16le") {
          const u16 = new Uint16Array(s.length);
          for (let i = 0; i < s.length; i++) u16[i] = s.charCodeAt(i);
          bytes = new Uint8Array(u16.buffer);
        } else if (enc === "utf-16be") {
          const u16 = new Uint16Array(s.length);
          for (let i = 0; i < s.length; i++) u16[i] = s.charCodeAt(i);
          const u8 = new Uint8Array(u16.buffer);
          bytes = new Uint8Array(u8.length);
          for (let i = 0; i < u8.length; i += 2) { bytes[i] = u8[i + 1]; bytes[i + 1] = u8[i]; }
        } else if (enc === "latin1" || enc === "iso-8859-1") {
          if ([...s].some((ch) => ch.charCodeAt(0) > 0xff)) {
            lines.push(`${enc} 编码: （非 Latin1 域，无法表示）`);
            continue;
          }
          bytes = new Uint8Array(s.length);
          for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
        } else {
 // 浏览器 TextEncoder 只支持 utf-8，其他编码无法直接 encode
          lines.push(`${enc} 编码: TextEncoder 不支持（仅 utf-8）`);
          continue;
        }
        const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
        lines.push(`${enc} 编码: ${hex}`);
      } catch (e) {
        lines.push(`${enc}: 错误 ${e.message}`);
      }
    }
  }
  return lines.join("\n");
}

// ============ timestamp（时间戳↔时间，参考实现）============
function timestampRun(text, p) {
  const s = text.trim();
  const dir = (p && p.dir) || "auto";
  const isNum = /^-?\d+(\.\d+)?$/.test(s);
  if (dir === "toTime" || (dir === "auto" && isNum)) {
    const ts = Number(s);
 // < 1e12 当秒，否则当毫秒
    const d = new Date(ts < 1e12 ? ts * 1000 : ts);
    if (isNaN(d.getTime())) throw new Error("无效时间戳: " + text);
    return `时间戳: ${ts}\n本地时间: ${d.toLocaleString("zh-CN", { hour12: false })}\nUTC: ${d.toISOString()}\nUnix秒: ${Math.floor(d.getTime() / 1000)}\nUnix毫秒: ${d.getTime()}`;
  } else {
    const d = new Date(s.replace("T", " "));
    if (isNaN(d.getTime())) throw new Error("无效时间格式，例：2020-01-01 01:01:01");
    return `时间: ${s}\nUnix时间戳(秒): ${Math.floor(d.getTime() / 1000)}\nUnix时间戳(毫秒): ${d.getTime()}\nUTC: ${d.toISOString()}`;
  }
}

// ============ gcd（最大公约数，参考实现）============
function gcd(a, b) {
  a = Math.abs(a); b = Math.abs(b);
  while (b) { [a, b] = [b, a % b]; }
  return a;
}
function gcdRun(text) {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (parts.length < 2 || parts.some(isNaN)) throw new Error("请输入至少 2 个数字（空格或逗号分隔）");
  let g = parts[0];
  for (let i = 1; i < parts.length; i++) g = gcd(g, parts[i]);
 // lcm = product / gcd
  let l = parts[0];
  for (let i = 1; i < parts.length; i++) l = Math.round(l * parts[i] / gcd(l, parts[i]));
  return `输入: ${parts.join(", ")}\n最大公约数 (GCD): ${g}\n最小公倍数 (LCM): ${l}`;
}

// ============ primeFactor（素数分解，参考实现）============
function primeFactor(text) {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return "请输入非负整数（仅数字）";
  let n = BigInt(s);
  if (n < 2n) return `${s} = ${s}（< 2，无分解）`;
  const factors = [];
  let d = 2n;
  while (d * d <= n) {
    while (n % d === 0n) { factors.push(d); n /= d; }
    d += 1n;
  }
  if (n > 1n) factors.push(n);
  const counts = new Map();
  for (const f of factors) counts.set(f, (counts.get(f) || 0n) + 1n);
  const parts = [];
  for (const [f, c] of counts) parts.push(c === 1n ? f.toString() : `${f}^${c}`);
  return `${s} = ${parts.join(" × ")}`;
}

// ============ fibonacci（斐波那契解码，参考实现）============
const FIBS = (() => {
  const f = [1n, 1n];
  for (let i = 2; i < 128; i++) f.push(f[i - 2] + f[i - 1]);
  return f;
})();
function fibonacciDecode(text) {
  let s = text;
 // 从 i=32 开始，跳过小 fib 数避免误替换。从大到小替换防止破坏大数。
  for (let i = FIBS.length - 1; i >= 32; i--) {
    const fibStr = FIBS[i].toString();
    if (s.includes(fibStr)) {
      s = s.split(fibStr).join(String.fromCharCode(i + 1));
    }
  }
  return s;
}
function fibonacciList() {
  return `斐波那契数列（前 64 项，索引 → 字符）:\n` + FIBS.slice(0, 64).map((f, i) => `${i + 1}\t${f}\t→ ${String.fromCharCode(i + 1)}`).join("\n");
}

// ============ 进制 / 数学扩展（10 op） ============
// 覆盖边界（0/负/大数/前导零），可逆做 encode+decode，单向做 run。

// ============ negabase（负进制，base 为负）============
// 十进制整数 ↔ 负进制字符串（base=-2/-10 等，可逆，BigInt）
// 算法：余数落在 [0, |base|)，通过 rem -= base; num += 1 调整
function negabaseEncode(n, base) {
  n = BigInt(n);
  base = BigInt(base);
  if (base >= 0n) throw new Error("negabase: base 须为负整数");
  if (n === 0n) return "0";
  const radix = Number(-base);
  const digits = [];
  let num = n;
  while (num !== 0n) {
    let rem = num % base;
    num = num / base;
    if (rem < 0n) {
      rem -= base;
      num += 1n;
    }
    digits.push(rem.toString(radix).toUpperCase());
  }
  return digits.reverse().join("");
}
function negabaseDecode(s, base) {
  s = String(s).trim().replace(/\s+/g, "");
  base = BigInt(base);
  if (base >= 0n) throw new Error("negabase: base 须为负整数");
  const radix = Number(-base);
  let n = 0n;
  for (const ch of s) {
    const dv = parseInt(ch, radix);
    if (Number.isNaN(dv)) throw new Error("negabase: 非法字符 " + ch);
    n = n * base + BigInt(dv);
  }
  return n.toString();
}

// ============ balancedTernary（平衡三进制）============
// 三态 T/0/1（T=-1）↔ 十进制整数，可逆
function balancedTernaryEncode(n) {
  n = BigInt(n);
  if (n === 0n) return "0";
  const neg = n < 0n;
  let num = neg ? -n : n;
  const digits = [];
  while (num !== 0n) {
    let r = num % 3n;
    num = num / 3n;
    if (r === 2n) { r = -1n; num += 1n; }
    digits.push(r === -1n ? "T" : r.toString());
  }
  let s = digits.reverse().join("");
  if (neg) s = s.split("").map((c) => (c === "T" ? "1" : c === "1" ? "T" : c)).join("");
  return s;
}
function balancedTernaryDecode(s) {
  s = String(s).trim().replace(/\s+/g, "").toUpperCase();
  if (!/^[T01]+$/.test(s)) throw new Error("balancedTernary: 仅含 T/0/1");
  let n = 0n;
  for (const ch of s) {
    const d = ch === "T" ? -1n : BigInt(ch);
    n = n * 3n + d;
  }
  return n.toString();
}

// ============ factorialBase（阶乘进制）============
// n = Σ d_i·i! (i 从 1 起，0 ≤ d_i ≤ i)，冒号分隔，可逆
function factorialBaseEncode(n) {
  n = BigInt(n);
  if (n < 0n) throw new Error("factorialBase: 不支持负数");
  if (n === 0n) return "0";
  const digits = [];
  let base = 2n;
  let num = n;
  while (num > 0n) {
    digits.push((num % base).toString());
    num = num / base;
    base += 1n;
    if (base > 256n) throw new Error("factorialBase: 数值过大");
  }
  return digits.reverse().join(":");
}
function factorialBaseDecode(s) {
  const parts = String(s).trim().split(/[:\s,]+/).filter(Boolean);
  if (parts.length === 0) throw new Error("factorialBase: 空输入");
  let n = 0n, k = 1n, fact = 1n;
  for (let i = parts.length - 1; i >= 0; i--) {
    const d = BigInt(parts[i]);
    n += d * fact;
    k += 1n;
    fact *= k;
  }
  return n.toString();
}

// ============ zeckendorf（Zeckendorf 表示）============
// 正整数 ↔ 不连续斐波那契求和的 01 串（Fib: 1,2,3,5,8,...），可逆
const ZECK_FIBS = (() => {
  const f = [1n, 2n];
  while (f[f.length - 1] < (1n << 256n)) f.push(f[f.length - 1] + f[f.length - 2]);
  return f;
})();
function zeckendorfEncode(n) {
  n = BigInt(n);
  if (n < 0n) throw new Error("zeckendorf: 不支持负数");
  if (n === 0n) return "0";
  let idx = ZECK_FIBS.length - 1;
  while (idx >= 0 && ZECK_FIBS[idx] > n) idx--;
  if (idx < 0) return "0";
  const bits = [];
  let rem = n;
  for (let i = idx; i >= 0; i--) {
    if (ZECK_FIBS[i] <= rem) { bits.push("1"); rem -= ZECK_FIBS[i]; }
    else bits.push("0");
  }
  return bits.join("");
}
function zeckendorfDecode(s) {
  s = String(s).trim().replace(/[\s,]+/g, "");
  if (!/^[01]+$/.test(s)) throw new Error("zeckendorf: 仅含 0/1");
  let n = 0n;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "1") n += ZECK_FIBS[s.length - 1 - i];
  }
  return n.toString();
}

// ============ roman（罗马数字）============
// 阿拉伯(1-3999) ↔ 罗马数字，可逆
const ROMAN_TABLE = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];
const ROMAN_MAP = { M: 1000, CM: 900, D: 500, CD: 400, C: 100, XC: 90, L: 50, XL: 40, X: 10, IX: 9, V: 5, IV: 4, I: 1 };
function romanEncode(n) {
  n = parseInt(n, 10);
  if (Number.isNaN(n) || n < 1 || n > 3999) throw new Error("roman: 范围 1-3999");
  let s = "";
  for (const [v, sym] of ROMAN_TABLE) {
    while (n >= v) { s += sym; n -= v; }
  }
  return s;
}
function romanDecode(s) {
  s = String(s).trim().toUpperCase();
 // 正则各组均可选，空串会"通过"；罗马数字有效域 1-3999，空串无对应值 → 显式拒绝
  if (!s || !/^M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(s)) {
    throw new Error("roman: 非法罗马数字 " + s);
  }
  let n = 0, i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (ROMAN_MAP[two]) { n += ROMAN_MAP[two]; i += 2; }
    else { n += ROMAN_MAP[s[i]]; i += 1; }
  }
  return String(n);
}

// ============ chineseNum（中文数字）============
// 阿拉伯 ↔ 中文数字（零一二三…），可逆，含负数
const CN_DIGITS = "零一二三四五六七八九";
function chineseNumEncode(n) {
  n = BigInt(n);
  const neg = n < 0n;
  if (neg) n = -n;
  if (n === 0n) return "零";
  const s = n.toString();
  let out = "";
  for (const ch of s) out += CN_DIGITS[parseInt(ch, 10)];
  return (neg ? "负" : "") + out;
}
function chineseNumDecode(s) {
  s = String(s).trim();
  let neg = false;
  if (s.startsWith("负")) { neg = true; s = s.slice(1); }
  if (s === "零") return "0";
  let out = "";
  for (const ch of s) {
    const idx = CN_DIGITS.indexOf(ch);
    if (idx < 0) throw new Error("chineseNum: 非法字符 " + ch);
    out += idx;
  }
  const n = BigInt(out || "0");
  return (neg ? -n : n).toString();
}

// ============ continuedFraction（连分数）============
// 有理数 p/q ↔ 序列 [a0; a1, a2, ...]，可逆
function continuedFractionEncode(text) {
  const s = String(text).trim();
  let num, den;
  if (s.includes("/")) {
    const [a, b] = s.split("/").map((x) => x.trim());
    num = BigInt(a); den = BigInt(b);
  } else {
    num = BigInt(s); den = 1n;
  }
  if (den === 0n) throw new Error("continuedFraction: 分母不能为 0");
  if (den < 0n) { num = -num; den = -den; }
  const cf = [];
  while (den !== 0n) {
    let a = num / den;
    let r = num - a * den;
    if (r < 0n) { a -= 1n; r += den; }
    cf.push(a);
    num = den; den = r;
  }
  return "[" + cf.join(", ") + "]";
}
function continuedFractionDecode(text) {
  const s = String(text).trim().replace(/[\[\]]/g, "");
  const cf = s.split(/[\s,;]+/).filter(Boolean).map((x) => BigInt(x));
  if (cf.length === 0) throw new Error("continuedFraction: 空序列");
  let num = 1n, den = 0n;
  for (let i = cf.length - 1; i >= 0; i--) {
    [num, den] = [cf[i] * num + den, num];
  }
  return num + "/" + den;
}

// ============ sternBrocot（Stern-Brocot 路径）============
// 正分数 ↔ L/R 路径串，可逆
function _gcdBig(a, b) {
  a = a < 0n ? -a : a; b = b < 0n ? -b : b;
  while (b) { [a, b] = [b, a % b]; }
  return a;
}
function sternBrocotEncode(text) {
  const s = String(text).trim();
  let p, q;
  if (s.includes("/")) {
    const [a, b] = s.split("/").map((x) => x.trim());
    p = BigInt(a); q = BigInt(b);
  } else {
    p = BigInt(s); q = 1n;
  }
  if (p <= 0n || q <= 0n) throw new Error("sternBrocot: 仅支持正分数");
  const g = _gcdBig(p, q);
  p /= g; q /= g;
  let path = "";
  let lo = [0n, 1n], hi = [1n, 0n];
  let guard = 0;
  while (guard++ < 100000) {
    const mn = lo[0] + hi[0], md = lo[1] + hi[1];
    const cmp = p * md - mn * q;
    if (cmp === 0n) break;
    if (cmp < 0n) { path += "L"; hi = [mn, md]; }
    else { path += "R"; lo = [mn, md]; }
  }
  return path || "(root)";
}
function sternBrocotDecode(text) {
  const s = String(text).trim().replace(/[\s,]+/g, "").toUpperCase();
  if (s === "(ROOT)" || s === "") return "1/1";
  if (!/^[LR]+$/.test(s)) throw new Error("sternBrocot: 路径仅含 L/R");
  let lo = [0n, 1n], hi = [1n, 0n];
  for (const ch of s) {
    const mn = lo[0] + hi[0], md = lo[1] + hi[1];
    if (ch === "L") hi = [mn, md];
    else lo = [mn, md];
  }
  return (lo[0] + hi[0]) + "/" + (lo[1] + hi[1]);
}

// ============ collatz（Collatz 序列，run 单向）============
function collatzRun(text) {
  let n = BigInt(String(text).trim());
  if (n < 1n) throw new Error("collatz: 需正整数");
  const seq = [n];
  let steps = 0;
  const MAX = 100000;
  let peak = n;
  while (n !== 1n && steps < MAX) {
    n = (n % 2n === 0n) ? n / 2n : 3n * n + 1n;
    seq.push(n);
    if (n > peak) peak = n;
    steps++;
  }
  const tail = steps >= MAX ? "\n(已达步数上限 " + MAX + ")" : "";
  return "起始: " + seq[0] + "\n步数: " + steps + "\n峰值: " + peak + "\n序列(" + seq.length + " 项): " + seq.map((x) => x.toString()).join(" → ") + tail;
}

// ============ 注册 ============
register({
  id: "hybridCode", cat: "radix", name: "混合进制解码",
  desc: "前缀 b/x/o/d 分别按 2/16/8/10 进制解析字符",
  params: [
    { key: "mode", label: "encode 模式", type: "select", default: "hex", options: [
      { value: "hex", label: "hex (xNN)" }, { value: "dec", label: "dec (dN)" },
      { value: "oct", label: "oct (oNNN)" }, { value: "bin", label: "bin (bNNNNNNNN)" },
      { value: "auto", label: "auto 最短" },
    ] },
    { key: "sep", label: "分隔符", type: "text", default: " " },
  ],
  encode: hybridCodeEncode,
  decode: hybridCodeDecode,
});

register({
  id: "separationAscii", cat: "radix", name: "数字串分割 ASCII",
  desc: "长数字串贪婪分割成可打印 ASCII（10/16/8/2 进制尝试）",
  params: [],
  run: separationAscii,
});

register({
  id: "asciiOffset", cat: "radix", name: "ASCII 偏移",
  desc: "每个字符 ASCII 码加偏移（offset=0 穷举 -26..26）",
  params: [
    { key: "offset", label: "偏移量（0=穷举）", type: "number", default: 0 },
  ],
  encode: (t, p) => {
    const off = Number((p && p.offset) || 0);
    if (off === 0) return asciiOffsetBrute(t);
    return asciiOffset(t, off);
  },
  decode: (t, p) => {
    const off = Number((p && p.offset) || 0);
    if (off === 0) return asciiOffsetBrute(t);
    return asciiOffset(t, -off);
  },
});

register({
  id: "decimalToFloat", cat: "radix", name: "十进制转任意进制浮点",
  desc: "十进制数/分数转 2-36 进制小数：支持指定目标进制、精度上限与循环节检测（如 0.1₂=0.0(0011)），用 BigInt 有理数精确换基，不用 Number 冒充精确；base=0 仍输出 2/8/10/16 四档",
  params: [
    { key: "base", label: "目标进制（0=四档 2/8/10/16）", type: "number", default: 0 },
    { key: "precision", label: "小数精度上限（1-2048）", type: "number", default: 16 },
  ],
  run: decimalToFloatRun,
});

register({
  id: "binaryComplement", cat: "radix", name: "原码反码补码",
  desc: "十进制数→原码/反码/补码（8/16/32 位自适应）",
  params: [],
  run: binaryComplement,
});

register({
  id: "floatToDecimal", cat: "radix", name: "任意进制浮点转十进制",
  desc: "「十进制转任意进制浮点」的反向：输入 2-36 进制浮点串（可带正负号、匹配进制的 0b/0o/0d/0x 前缀、循环节 0.(3)），按 BigInt 有理数精确展开为十进制，循环节与截断都明确标注。用于还原题目给出的非十进制浮点",
  params: [
    { key: "base", label: "输入进制（2-36）", type: "number", default: 2 },
    { key: "precision", label: "输出小数位数（0-2048）", type: "number", default: 16 },
  ],
  run: floatToDecimalRun,
});

register({
  id: "complementToDec", cat: "radix", name: "原反补码转十进制",
  desc: "「原码反码补码」的反向：给定位串，分别按原码/反码/补码三种约定解释为十进制负数或正数。位宽留空按串长；负数三种编码的差异一并列出",
  params: [
    { key: "bits", label: "位宽（0=按输入长度）", type: "number", default: 0 },
  ],
  run: complementToDecRun,
});

register({
  id: "completion", cat: "radix", name: "补零对齐",
  desc: "多段二进制串补零到等长（bits=0 按最长，8/16 定宽）",
  params: [
    { key: "bits", label: "目标位宽（0=按最长）", type: "number", default: 0 },
  ],
  encode: completionEncode,
  decode: completionDecode,
});

register({
  id: "splitHex", cat: "radix", name: "Hex N 位分割",
  desc: "长 hex 串按 2/4/8 位分割",
  params: [],
  run: (t) => splitHex(t, { sizes: [2, 4, 8] }),
});

register({
  id: "standardCode", cat: "radix", name: "字符集互转",
  desc: "文本→多字符集 hex 编码 / hex→多字符集解码（utf-8/utf-16/gbk/big5 等）",
  params: [],
  run: standardCodeRun,
});

register({
  id: "timestamp", cat: "radix", name: "时间戳 ↔ 时间",
  desc: "时间戳↔时间互转（auto 自动判断，秒/毫秒自适应）",
  params: [
    { key: "dir", label: "方向", type: "select", default: "auto", options: [
      { value: "auto", label: "auto 自动" },
      { value: "toTime", label: "时间戳→时间" },
      { value: "toStamp", label: "时间→时间戳" },
    ] },
  ],
  run: timestampRun,
});

register({
  id: "gcd", cat: "radix", name: "最大公约数",
  desc: "多个数的 GCD 和 LCM",
  params: [],
  run: gcdRun,
});

register({
  id: "primeFactor", cat: "radix", name: "素数分解",
  desc: "质因数分解（BigInt）",
  params: [],
  run: primeFactor,
});

register({
  id: "fibonacci", cat: "radix", name: "斐波那契解码",
  desc: "把文本中的大斐波那契数（fib[32+]）替换为对应字符",
  params: [],
  run: fibonacciDecode,
});

register({
  id: "negabase", cat: "radix", name: "负进制",
  desc: "十进制 ↔ 负进制（base=-2/-10 等，可逆，BigInt）",
  params: [
    { key: "base", label: "进制", type: "select", default: -2, options: [
      { value: -2, label: "负二进制 (-2)" },
      { value: -10, label: "负十进制 (-10)" },
      { value: -3, label: "负三进制 (-3)" },
    ] },
  ],
  encode: (t, p) => negabaseEncode(BigInt(String(t).trim()), Number((p && p.base) || -2)),
  decode: (t, p) => negabaseDecode(t, Number((p && p.base) || -2)),
});

register({
  id: "balancedTernary", cat: "radix", name: "平衡三进制",
  desc: "三态 T/0/1（T=-1）↔ 十进制整数（可逆）",
  params: [],
  encode: (t) => balancedTernaryEncode(t),
  decode: (t) => balancedTernaryDecode(t),
});

register({
  id: "factorialBase", cat: "radix", name: "阶乘进制",
  desc: "n = Σ d_i·i!（0 ≤ d_i ≤ i，冒号分隔，可逆）",
  params: [],
  encode: (t) => factorialBaseEncode(t),
  decode: (t) => factorialBaseDecode(t),
});

register({
  id: "zeckendorf", cat: "radix", name: "Zeckendorf 表示",
  desc: "正整数 ↔ 不连续斐波那契求和的 01 串（可逆）",
  params: [],
  encode: (t) => zeckendorfEncode(t),
  decode: (t) => zeckendorfDecode(t),
});

register({
  id: "roman", cat: "radix", name: "罗马数字",
  desc: "阿拉伯数字(1-3999) ↔ 罗马数字（可逆）",
  params: [],
  encode: (t) => romanEncode(t),
  decode: (t) => romanDecode(t),
});

register({
  id: "chineseNum", cat: "radix", name: "中文数字",
  desc: "阿拉伯 ↔ 中文数字（零一二三…，可逆，含负数）",
  params: [],
  encode: (t) => chineseNumEncode(t),
  decode: (t) => chineseNumDecode(t),
});

register({
  id: "continuedFraction", cat: "radix", name: "连分数",
  desc: "有理数 p/q ↔ 连分数序列 [a0; a1, ...]（可逆）",
  params: [],
  encode: (t) => continuedFractionEncode(t),
  decode: (t) => continuedFractionDecode(t),
});

register({
  id: "sternBrocot", cat: "radix", name: "Stern-Brocot 路径",
  desc: "正分数 ↔ L/R 路径串（可逆）",
  params: [],
  encode: (t) => sternBrocotEncode(t),
  decode: (t) => sternBrocotDecode(t),
});

register({
  id: "collatz", cat: "radix", name: "Collatz 序列",
  desc: "正整数 → Collatz 猜想序列（3n+1，run 单向）",
  params: [],
  run: collatzRun,
});

export {
  hybridCodeDecode, hybridCodeEncode,
  separationAscii, separationOneScale,
  asciiOffset, asciiOffsetBrute,
  decimalToFloat, decimalToFloatRun,
  floatToDecimalRun,
  parseRadixRational, parseDecimalRational, convertRationalToBase,
  normalizeRational, assertFloatBase, FLOAT_PRECISION_MAX,
  binaryComplement,
  completionEncode, completionDecode,
  splitHex,
  standardCodeRun,
  timestampRun,
  gcd, gcdRun,
  primeFactor,
  fibonacciDecode, fibonacciList, FIBS,
  negabaseEncode, negabaseDecode,
  balancedTernaryEncode, balancedTernaryDecode,
  factorialBaseEncode, factorialBaseDecode,
  zeckendorfEncode, zeckendorfDecode, ZECK_FIBS,
  romanEncode, romanDecode,
  chineseNumEncode, chineseNumDecode,
  continuedFractionEncode, continuedFractionDecode,
  sternBrocotEncode, sternBrocotDecode,
  collatzRun,
};
