/*
 * exclusiveCodec.js — 一组中文 / 古典编码算法。
 *
 * 收录 6 个 op：
 * - shzyhxjzg 社会主义核心价值观（cn）
 * - makkaPakka 玛卡巴卡（cn）
 * - yuanYin 元音密码（classic）
 * - columnReplace 列置换密码（classic）
 * - rowsReplace 行置换密码（classic）
 *
 * 纯函数，零 UI 依赖。
 */
import { register } from "./registry.js";

const te = new TextEncoder();

// ============ 社会主义核心价值观 ============
// 12 对 24 字，duo 数字 0..11 → values[2d]+values[2d+1]
const SHZYHXJZG_VALUES = "富强民主文明和谐自由平等公正法治爱国敬业诚信友善";

// str2utf8：原文 → UTF-8 字节的大写 hex 串。
// 两步法（unreserved 字符替成 hex(ord) 再 parse.quote 去 % 大写）的净效果
// 等价于「UTF-8 字节序列的大写 hex」，此处直接实现等价形式（不引入 URL 编码差异）。
function shzyStr2utf8Hex(text) {
  const bytes = te.encode(text);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, "0");
  return s.toUpperCase();
}

// hex2duo：每个 hex 数字（0..15）→ duo 数字流。
// n<10 → 单数字 n；n>=10 → 随机二选一：[10, n-10] 或 [11, n-6]。
function shzyHex2duo(hexs) {
  const duo = [];
  for (const c of hexs) {
    const n = parseInt(c, 16);
    if (n < 10) {
      duo.push(n);
    } else if (Math.random() >= 0.5) {
      duo.push(10);
      duo.push(n - 10);
    } else {
      duo.push(11);
      duo.push(n - 6);
    }
  }
  return duo;
}

function shzyDuo2values(duo) {
  let out = "";
  for (const d of duo) out += SHZYHXJZG_VALUES[2 * d] + SHZYHXJZG_VALUES[2 * d + 1];
  return out;
}

function shzyhxjzgEncode(text) {
  return shzyDuo2values(shzyHex2duo(shzyStr2utf8Hex(text)));
}

function shzyhxjzgDecode(encoded) {
 // 取偶数位（每对首字）→ duo 数字
  const duo = [];
  for (const c of encoded) {
    const i = SHZYHXJZG_VALUES.indexOf(c);
    if (i === -1) continue;
    if (i % 2 === 1) continue;
    duo.push(Math.floor(i / 2));
  }
 // 还原 hex 数字流
  const duo2 = [];
  let i = 0;
  while (i < duo.length) {
    if (duo[i] < 10) {
      duo2.push(duo[i]);
    } else if (duo[i] === 10) {
      i++;
      duo2.push(duo[i] + 10);
    } else {
 // duo[i] === 11
      i++;
      duo2.push(duo[i] + 6);
    }
    i++;
  }
  const s = duo2.map((x) => x.toString(16)).join("");
 // %XX%XX... → UTF-8 解码
  let urlstr = "";
  for (let j = 0; j + 2 <= s.length; j += 2) urlstr += "%" + s.slice(j, j + 2);
  try {
    return decodeURIComponent(urlstr);
  } catch {
 // 非法 % 序列：退化为原始拼接
    return urlstr.replace(/%/g, "");
  }
}

// ============ 玛卡巴卡 MakkaPakka ============
// 编码表 encoding_rules（键→中文段，均以「轰」结尾）。
const MAKKAPAKKA_RULES = {
  a: "玛卡巴卡轰",
  b: "阿巴雅卡轰",
  c: "伊卡阿卡噢轰",
  d: "哈姆达姆阿卡嗙轰",
  e: "咿呀呦轰",
  f: "玛卡雅卡轰",
  g: "伊卡阿卡轰",
  h: "咿呀巴卡轰",
  i: "达姆阿卡嗙轰",
  j: "玛卡巴卡玛卡巴卡轰",
  k: "玛卡巴卡玛卡巴卡玛卡巴卡轰",
  l: "玛卡巴卡玛卡巴卡玛卡巴卡玛卡巴卡轰",
  m: "阿巴雅卡阿巴雅卡轰",
  n: "阿巴雅卡阿巴雅卡阿巴雅卡轰",
  o: "阿巴雅卡阿巴雅卡阿巴雅卡阿巴雅卡轰",
  p: "伊卡阿卡噢伊卡阿卡噢轰",
  q: "伊卡阿卡噢伊卡阿卡噢伊卡阿卡噢轰",
  r: "伊卡阿卡噢伊卡阿卡噢伊卡阿卡噢伊卡阿卡噢轰",
  s: "哈姆达姆阿卡嗙哈姆达姆阿卡嗙轰",
  t: "哈姆达姆阿卡嗙哈姆达姆阿卡嗙哈姆达姆阿卡嗙轰",
  u: "哈姆达姆阿卡嗙哈姆达姆阿卡嗙哈姆达姆阿卡嗙哈姆达姆阿卡嗙轰",
  v: "咿呀呦咿呀呦轰",
  w: "咿呀呦咿呀呦咿呀呦轰",
  x: "咿呀呦咿呀呦咿呀呦咿呀呦轰",
  y: "咿呀呦咿呀呦咿呀呦咿呀呦咿呀呦轰",
  z: "玛卡雅卡玛卡雅卡轰",
  A: "玛卡雅卡玛卡雅卡玛卡雅卡轰",
  B: "玛卡雅卡玛卡雅卡玛卡雅卡玛卡雅卡轰",
  C: "伊卡阿卡伊卡阿卡轰",
  D: "伊卡阿卡伊卡阿卡伊卡阿卡轰",
  E: "伊卡阿卡伊卡阿卡伊卡阿卡伊卡阿卡轰",
  F: "咿呀巴卡咿呀巴卡轰",
  G: "咿呀巴卡咿呀巴卡咿呀巴卡轰",
  H: "咿呀巴卡咿呀巴卡咿呀巴卡咿呀巴卡轰",
  I: "咿呀巴卡咿呀巴卡咿呀巴卡咿呀巴卡咿呀巴卡轰",
  J: "达姆阿卡嗙达姆阿卡嗙轰",
  K: "达姆阿卡嗙达姆阿卡嗙达姆阿卡嗙轰",
  L: "达姆阿卡嗙达姆阿卡嗙达姆阿卡嗙达姆阿卡嗙轰",
  M: "达姆阿卡嗙达姆阿卡嗙达姆阿卡嗙达姆阿卡嗙达姆阿卡嗙轰",
  N: "巴卡巴卡轰",
  O: "巴卡巴卡巴卡巴卡轰",
  P: "巴卡巴卡巴卡巴卡巴卡巴卡轰",
  Q: "巴卡巴卡巴卡巴卡巴卡巴卡巴卡巴卡轰",
  R: "巴卡巴卡巴卡巴卡巴卡巴卡巴卡巴卡巴卡巴卡轰",
  S: "呀呦轰",
  T: "呀呦呀呦轰",
  U: "呀呦呀呦呀呦轰",
  V: "呀呦呀呦呀呦呀呦轰",
  W: "呀呦呀呦呀呦呀呦呀呦轰",
  X: "达姆阿卡轰",
  Y: "达姆阿卡达姆阿卡轰",
  Z: "达姆阿卡达姆阿卡达姆阿卡轰",
  0: "达姆阿卡达姆阿卡达姆阿卡达姆阿卡轰",
  1: "达姆阿卡达姆阿卡达姆阿卡达姆阿卡达姆阿卡轰",
  2: "玛巴轰",
  3: "玛巴玛巴轰",
  4: "玛巴玛巴玛巴轰",
  5: "玛巴玛巴玛巴玛巴轰",
  6: "巴卡玛巴轰",
  7: "巴卡玛巴巴卡玛巴轰",
  8: "巴卡玛巴巴卡玛巴巴卡玛巴轰",
  9: "巴卡玛巴巴卡玛巴巴卡玛巴巴卡玛巴轰",
  "=": "妈个巴子轰",
  "/": "妈个巴卡轰",
  "+": "妈个巴达轰",
};

const MAKKAPAKKA_KEYS = Object.keys(MAKKAPAKKA_RULES);
const MAKKAPAKKA_KEYSET = new Set(MAKKAPAKKA_KEYS);
// 按编码串长度降序，供 decode 贪心最长匹配（sorted(key=len, reverse=True)）
const MAKKAPAKKA_DECODE_ORDER = [...MAKKAPAKKA_KEYS].sort(
  (a, b) => MAKKAPAKKA_RULES[b].length - MAKKAPAKKA_RULES[a].length
);
const MAKKAPAKKA_REV = {};
for (const k of MAKKAPAKKA_KEYS) MAKKAPAKKA_REV[MAKKAPAKKA_RULES[k]] = k;

function makkaPakkaEncode(text) {
  let out = "";
  for (const ch of text) {
    if (MAKKAPAKKA_KEYSET.has(ch)) out += MAKKAPAKKA_RULES[ch];
 // 非表内字符直接丢弃（continue）
  }
  return out;
}

function makkaPakkaDecode(encoded) {
  let out = "";
  let i = 0;
  while (i < encoded.length) {
    let matched = false;
    for (const k of MAKKAPAKKA_DECODE_ORDER) {
      const seg = MAKKAPAKKA_RULES[k];
      if (encoded.startsWith(seg, i)) {
        out += k;
        i += seg.length;
        matched = true;
        break;
      }
    }
    if (!matched) i += 1; // 未知字符跳过
  }
  return out;
}

// ============ 元音密码 yuanYin ============
// dic：数字 → 字母。1/2/3/4/5 为单元音 a/e/i/o/u；辅音为两位（元音组+位序）。
// 表为算法固定映射。
const YUANYIN_DEC = {
  1: "a", 11: "b", 12: "c", 13: "d",
  2: "e", 21: "f", 22: "g", 23: "h",
  3: "i", 31: "j", 32: "k", 33: "l", 34: "m", 35: "n",
  4: "o", 41: "p", 42: "q", 43: "r", 44: "s", 45: "t",
  5: "u", 51: "v", 52: "w", 53: "x", 54: "y", 55: "z",
};
const YUANYIN_ENC = {}; // 字母 → 数字串
for (const [n, ch] of Object.entries(YUANYIN_DEC)) YUANYIN_ENC[ch] = n;

function yuanYinEncode(text, p = {}) {
  const sep = p.sep != null ? p.sep : " ";
  return [...text]
    .map((ch) => YUANYIN_ENC[ch])
    .filter((v) => v !== undefined)
    .join(sep);
}

function yuanYinDecode(text, p = {}) {
 // 按 , / . / 空格 任一分隔
  const parts = text.split(/[,.\s]+/).filter((s) => s.length > 0);
  let res = "";
  for (const part of parts) {
    const v = YUANYIN_DEC[parseInt(part, 10)];
    if (v !== undefined) res += v;
  }
  return res;
}

// ============ 列置换密码 columnReplace ============
// keysort = sorted(key)；encode ids[j] = keysort.index(key[j])；
// 明文补空格至 keylen 整数倍，按 ids 顺序逐块取列。
function _sortedChars(s) {
  return [...s].sort().join("");
}

function columnReplaceEncode(text, p = {}) {
  const key = p.key || "ZEBRA";
  const keysort = _sortedChars(key);
  const ids = [];
  for (const ch of key) ids.push(keysort.indexOf(ch));
  const keylen = key.length;
  if (keylen === 0) throw new Error("列置换密钥不能为空");
  let mingwen = text;
  const pad = (keylen - (mingwen.length % keylen)) % keylen;
  mingwen += " ".repeat(pad);
  const blocks = [];
  for (let i = 0; i < mingwen.length; i += keylen) blocks.push(mingwen.slice(i, i + keylen));
  let miwen = "";
  for (const id of ids) {
    for (const blk of blocks) miwen += blk[id];
  }
  return miwen;
}

function columnReplaceDecode(text, p = {}) {
  const key = p.key || "ZEBRA";
  const keysort = _sortedChars(key);
 // decode：ids 由 keysort 遍历，ids.append(key.index(i))
  const ids = [];
  for (const ch of keysort) ids.push(key.indexOf(ch));
  const miwen = text;
  const keylen = key.length;
  if (keylen === 0) throw new Error("列置换密钥不能为空");
  const miwenlen = miwen.length;
  const cols = Math.floor(miwenlen / keylen); // 每列字符数 = 块数
  if (cols < 1) return miwen.replace(/\s+$/g, ""); // 密文短于密钥：不足一整块，原样返回（防 cols=0 步进死循环）
 // miwenlist：按 keylen 切成 keylen 段，每段 cols 个
  const miwenlist = [];
  for (let i = 0; i < miwenlen; i += cols) miwenlist.push(miwen.slice(i, i + cols));
 // miwenlist2[i] = 各段第 i 字符拼接 = 还原块
  const miwenlist2 = [];
  for (let i = 0; i < cols; i++) {
    let row = "";
    for (const seg of miwenlist) row += seg[i];
    miwenlist2.push(row);
  }
  let mingwen = "";
  for (const row of miwenlist2) {
    for (const id of ids) mingwen += row[id];
  }
  return mingwen.replace(/\s+$/g, ""); // .strip() 去两端空白
}

// ============ 行置换密码 rowsReplace ============
// 每 keylen 一块，块内按 ids 顺序重排。
// 原算法不补齐（要求明文长度为 keylen 整数倍）；此处补空格至整数倍以增强健壮性
// decode 不剥离（保持块内字符），往返测试用「补齐后等价」校验。
function rowsReplaceEncode(text, p = {}) {
  const key = p.key || "KEY";
  const keysort = _sortedChars(key);
  const ids = [];
  for (const ch of key) ids.push(keysort.indexOf(ch));
  const keylen = key.length;
  if (keylen === 0) throw new Error("行置换密钥不能为空");
  let mingwen = text;
  const pad = (keylen - (mingwen.length % keylen)) % keylen;
  mingwen += " ".repeat(pad);
  let miwen = "";
  for (let i = 0; i < mingwen.length; i += keylen) {
    const blk = mingwen.slice(i, i + keylen);
    for (const id of ids) miwen += blk[id];
  }
  return miwen;
}

function rowsReplaceDecode(text, p = {}) {
  const key = p.key || "KEY";
  const keysort = _sortedChars(key);
 // decode：ids 由 keysort 遍历，ids.append(key.index(i)) —— encode ids 的逆置换
  const ids = [];
  for (const ch of keysort) ids.push(key.indexOf(ch));
  const keylen = key.length;
  if (keylen === 0) throw new Error("行置换密钥不能为空");
  const miwen = text;
  let mingwen = "";
  for (let i = 0; i < miwen.length; i += keylen) {
    const blk = miwen.slice(i, i + keylen);
    for (const id of ids) mingwen += (blk[id] ?? ""); // 末块不足 keylen 时 blk[id] 越界，跳过而非拼字面 "undefined"
  }
  return mingwen.replace(/\s+$/g, "");
}

// ============ 注册 ============
register({
  id: "shzyhxjzg", cat: "cn", name: "社会主义核心价值观",
  desc: "UTF-8 hex → duo（10/11 前缀）→ 富强民主…友善 12 对字",
  encode: shzyhxjzgEncode, decode: shzyhxjzgDecode,
  detect: (t) => {
    const clean = t.replace(/\s/g, "");
    if (!clean || clean.length < 4) return 0;
    return [...clean].every((c) => SHZYHXJZG_VALUES.includes(c)) ? 0.6 : 0;
  },
});

register({
  id: "makkaPakka", cat: "cn", name: "玛卡巴卡",
  desc: "字符 → 玛卡巴卡/阿巴雅卡/咿呀呦…轰 段（玛卡巴卡语言）",
  encode: makkaPakkaEncode, decode: makkaPakkaDecode,
  detect: (t) => (/轰/.test(t) && /玛卡|阿巴雅卡|咿呀呦|达姆阿卡|呀呦|巴卡/.test(t) ? 0.5 : 0),
});

register({
  id: "yuanYin", cat: "classic", name: "元音密码",
  desc: "数字 → 字母（1/2/3/4/5=a/e/i/o/u，辅音两位）",
  params: [{ key: "sep", label: "编码分隔符", type: "text", default: " ", placeholder: "encode 时数字间分隔符" }],
  encode: yuanYinEncode, decode: yuanYinDecode,
});

register({
  id: "columnReplace", cat: "classic", name: "列置换密码",
  desc: "按密钥字母序读列（明文补空格至 keylen 整数倍）",
  params: [{ key: "key", label: "密钥", type: "text", default: "ZEBRA", placeholder: "建议无重复字母" }],
  encode: columnReplaceEncode, decode: columnReplaceDecode,
});

register({
  id: "rowsReplace", cat: "classic", name: "行置换密码",
  desc: "每 keylen 一块块内按密钥字母序重排",
  params: [{ key: "key", label: "密钥", type: "text", default: "KEY", placeholder: "建议无重复字母" }],
  encode: rowsReplaceEncode, decode: rowsReplaceDecode,
});

export {
  shzyhxjzgEncode, shzyhxjzgDecode, SHZYHXJZG_VALUES,
  makkaPakkaEncode, makkaPakkaDecode, MAKKAPAKKA_RULES,
  yuanYinEncode, yuanYinDecode, YUANYIN_DEC,
  columnReplaceEncode, columnReplaceDecode,
  rowsReplaceEncode, rowsReplaceDecode,
};
