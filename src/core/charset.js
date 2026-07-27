/*
 * charset.js — 字符集 / 编码转换组（T62，cat:'text'）。
 *
 * 覆盖：
 * - GBK / GB2312 / GB18030 ↔ UTF-8（含 GB2312 区位码）
 * - Big5、Shift-JIS、EUC-KR ↔ UTF-8
 * - Latin-1 / ISO-8859 全系 + Windows 单字节码页
 * - EBCDIC（IBM 037 / 1047 内嵌码表，TextDecoder 不支持）
 * - UTF-16 BE/LE + BOM 处理
 * - 乱码修复（mojibake 常见错配还原）
 *
 * 红线：只新建本文件，不动任何现有 core/*.js。
 *
 * 实现策略（与任务红线一致）：
 * - 解码（bytes→string）一律用宿主 TextDecoder（浏览器 / node v24 实测支持
 * gbk/gb2312/gb18030/big5/shift_jis/euc-kr/iso-8859 series/windows-1252/utf-16 等）。
 * - 编码（string→bytes）：宿主 TextEncoder 只会 UTF-8，故对目标字符集用
 * 「暴力解码所有字节组合 → 反向构造 cp→bytes 映射」的运行时建表法
 * （单字节扫 0..255；多字节再扫 lead 0x81..0xFE × trail 0x40..0xFE）。
 * 建表结果缓存，首次约几十毫秒。CTF 文本场景足够。
 * - node 降级：node 的 TextDecoder 同样支持上述标签（v24 实测全 OK）；
 * 若运行在更旧环境某标签缺失，ensureDecoder 抛清晰错误。
 * - EBCDIC：TextDecoder 不支持，用内嵌手验码表（"Hello, World!" →
 * C8 85 93 93 96 6B 40 E6 96 99 93 84 5A 校验通过）。
 *
 * 字节表示（除 区位码 / mojibakeFix 外的 charset op）：
 * format=hex（默认）：字节串 → hex 文本；hex 文本 → 字节串
 * format=latin1：每字节当一个 Latin-1 字符（二进制串，适合 mojibake 直观查看）
 * format=auto（仅 decode）：偶数 hex 串按 hex，否则按 latin1
 *
 * 契约：register({id, cat:"text", name, desc, params, encode?, decode?})。
 * 每 op 双向 encode/decode 且 decode(encode(x))===x（可表示字符集内）。
 *
 * 与现有 op 不冲突：text.js（url/htmlEntity/unicodeEscape/qp/uu/xx/jsfuck）
 * textExt.js（utf7/punycode/jsHex/...）。UTF-7 已在 textExt.js 实现（RFC 2152）
 * 本文件不重复注册以避 id 冲突（
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);

// ============ 字节 ↔ hex / latin1（二进制串）============
function bytesToHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
function hexToBytes(text) {
  let s = text.trim();
  if (/^0x/i.test(s)) s = s.slice(2);
  s = s.replace(/[\s,;:]/g, "");
  if (s.length === 0) return new Uint8Array(0);
  if (s.length % 2 !== 0) throw new Error("hex 长度须为偶数（每字节 2 位）");
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error("含非 hex 字符");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
function bytesToLatin1(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return s;
}
function latin1ToBytes(text) {
  const arr = [...text];
  const out = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) out[i] = arr[i].charCodeAt(0) & 0xff;
  return out;
}

// 输入文本 → 字节（按 format）。auto 仅用于 decode。
function parseBytes(text, format) {
  if (format === "hex") return hexToBytes(text);
  if (format === "latin1") return latin1ToBytes(text);
 // auto
  const compact = text.trim().replace(/[\s,;:]/g, "");
  if (compact.length > 0 && compact.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(compact)) {
    try { return hexToBytes(text); } catch { /* fallthrough */ }
  }
  return latin1ToBytes(text);
}
function formatBytes(bytes, format) {
  if (format === "latin1") return bytesToLatin1(bytes);
  return bytesToHex(bytes); // 默认 hex
}

// ============ TextDecoder 缓存 + 反向编码表 ============
const _decoders = new Map();
function getDecoder(label) {
  if (_decoders.has(label)) return _decoders.get(label);
  let td;
  try { td = new TextDecoder(label, { fatal: false }); }
  catch (e) { throw new Error(`当前环境不支持字符集 "${label}"（TextDecoder 未实现）`); }
  _decoders.set(label, td);
  return td;
}

// 多字节字符集标签（决定建表时是否扫描 2 字节组合）
const MULTI_BYTE_LABELS = new Set([
  "gbk", "gb2312", "gb18030", "big5", "shift_jis", "euc-kr", "euc-jp",
]);
function isMultiByte(label) { return MULTI_BYTE_LABELS.has(label.toLowerCase()); }

const _encMaps = new Map();
// 暴力解码所有字节组合，构造 cp → bytes[] 映射（首次调用缓存）。
function buildEncMap(label, multiByte) {
  const td = getDecoder(label);
  const map = new Map();
  const trySet = (bytes) => {
    let ch;
    try { ch = td.decode(new Uint8Array(bytes)); } catch { return; }
    if (!ch || ch.length !== 1) return;
    const cp = ch.codePointAt(0);
    if (cp === 0xFFFD) return; // 替换字符，跳过
    if (!map.has(cp)) map.set(cp, bytes); // 首次（最低 lead/trail）优先
  };
  for (let b = 0; b < 256; b++) trySet([b]);
  if (multiByte) {
    for (let lead = 0x81; lead <= 0xFE; lead++) {
      for (let trail = 0x40; trail <= 0xFE; trail++) {
        if (trail === 0x7F) continue; // 0x7F 多字节尾字节非法
        trySet([lead, trail]);
      }
    }
  }
  return map;
}
function getEncMap(label) {
  const mb = isMultiByte(label);
  const key = label + (mb ? "|mb" : "|sb");
  if (!_encMaps.has(key)) _encMaps.set(key, buildEncMap(label, mb));
  return _encMaps.get(key);
}

// 通用：字符串 → 目标字符集字节（UTF-8 走 TextEncoder，其余走反向表）
function strToBytes(label, str) {
  if (label === "utf-8" || label === "utf8") return te(str);
  const map = getEncMap(label);
  const out = [];
  for (const ch of [...str]) {
    const cp = ch.codePointAt(0);
    const bytes = map.get(cp);
    if (bytes) for (const b of bytes) out.push(b);
    else for (const b of te(ch)) out.push(b); // 回退 UTF-8（保不丢，但非目标字符集）
  }
  return new Uint8Array(out);
}
// 通用：目标字符集字节 → 字符串
function bytesToStr(label, bytes) {
  return getDecoder(label === "utf8" ? "utf-8" : label).decode(bytes);
}

// ============ GBK / GB2312 / GB18030 ↔ UTF-8 ============
function gbEncode(text, p) {
  const cs = (p && p.charset) || "gbk";
  return formatBytes(strToBytes(cs, text), (p && p.format) || "hex");
}
function gbDecode(text, p) {
  const cs = (p && p.charset) || "gbk";
  return bytesToStr(cs, parseBytes(text, (p && p.format) || "hex"));
}

// ============ 通用单字符集 op 工厂（big5/shift_jis/euc-kr/latin 全系）============
function makeCodec(label) {
  return {
    encode: (text, p) => formatBytes(strToBytes(label, text), (p && p.format) || "hex"),
    decode: (text, p) => bytesToStr(label, parseBytes(text, (p && p.format) || "hex")),
  };
}

// ============ GB2312 区位码 ============
// GB2312 EUC-CN 字节 0xA1A1..0xFEFE，区位码 = (byte1-0xA0, byte2-0xA0)，各 01..94。
// "中" = 0xD6D0 → 区54 位48 → "5448"。ASCII 字符在 GB2312 中为单字节 0x00..0x7F
// encode 时原样透传（区位码仅定义 94×94 网格，不含 ASCII）。
function quweiEncode(text, p) {
  const sep = (p && p.sep) || "none";
  const sepCh = sep === "space" ? " " : (sep === "newline" ? "\n" : "");
  const bytes = strToBytes("gb2312", text);
  const groups = [];
  let i = 0;
  while (i < bytes.length) {
    const b1 = bytes[i];
    if (b1 >= 0xA1 && b1 <= 0xFE && i + 1 < bytes.length && bytes[i + 1] >= 0xA1 && bytes[i + 1] <= 0xFE) {
      const q = b1 - 0xA0;
      const w = bytes[i + 1] - 0xA0;
      groups.push(q.toString().padStart(2, "0") + w.toString().padStart(2, "0"));
      i += 2;
    } else {
 // ASCII 透传
      groups.push(String.fromCharCode(b1));
      i += 1;
    }
  }
  return groups.join(sepCh);
}
function quweiDecode(text, p) {
  const sep = (p && p.sep) || "none";
  const sepSet = sep === "space" ? new Set([" "]) : (sep === "newline" ? new Set(["\n", "\r"]) : null);
  const out = [];
  const re = /\d{4}/g;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
 // 透传两个匹配之间的非数字字符（ASCII）
    for (const ch of text.slice(last, m.index)) {
      if (ch.charCodeAt(0) < 0x80 && !(sepSet && sepSet.has(ch))) out.push(ch.charCodeAt(0));
    }
    const q = parseInt(m[0].slice(0, 2), 10);
    const w = parseInt(m[0].slice(2, 4), 10);
    if (q >= 1 && q <= 94 && w >= 1 && w <= 94) {
      out.push(q + 0xA0, w + 0xA0);
    } else {
      out.push(0x3F); // 越界 → '?'
    }
    last = m.index + 4;
  }
  for (const ch of text.slice(last)) {
    if (ch.charCodeAt(0) < 0x80 && !(sepSet && sepSet.has(ch))) out.push(ch.charCodeAt(0));
  }
  return bytesToStr("gb2312", new Uint8Array(out));
}

// ============ EBCDIC（内嵌码表，TextDecoder 不支持）============
// IBM-037（US/Canada）：可打印 ASCII → EBCDIC 字节。经 "Hello, World!" →
// C8 85 93 93 96 6B 40 E6 96 99 93 84 5A 校验。字母/数字位置 037 与 1047 一致。
const EBCDIC_037 = {
  " ":0x40,"!":0x5A,'"':0x7F,"#":0x7B,"$":0x5B,"%":0x6C,"&":0x50,"'":0x7D,
  "(":0x4D,")":0x5D,"*":0x5C,"+":0x4E,",":0x6B,"-":0x60,".":0x4B,"/":0x61,
  "0":0xF0,"1":0xF1,"2":0xF2,"3":0xF3,"4":0xF4,"5":0xF5,"6":0xF6,"7":0xF7,
  "8":0xF8,"9":0xF9,
  ":":0x7A,";":0x5E,"<":0x4C,"=":0x7E,">":0x6E,"?":0x6F,"@":0x7C,
  "A":0xC1,"B":0xC2,"C":0xC3,"D":0xC4,"E":0xC5,"F":0xC6,"G":0xC7,"H":0xC8,"I":0xC9,
  "J":0xD1,"K":0xD2,"L":0xD3,"M":0xD4,"N":0xD5,"O":0xD6,"P":0xD7,"Q":0xD8,"R":0xD9,
  "S":0xE2,"T":0xE3,"U":0xE4,"V":0xE5,"W":0xE6,"X":0xE7,"Y":0xE8,"Z":0xE9,
  "\\":0xE0,"`":0x79,"_":0x6D,"|":0x4F,
  "a":0x81,"b":0x82,"c":0x83,"d":0x84,"e":0x85,"f":0x86,"g":0x87,"h":0x88,"i":0x89,
  "j":0x91,"k":0x92,"l":0x93,"m":0x94,"n":0x95,"o":0x96,"p":0x97,"q":0x98,"r":0x99,
  "s":0xA2,"t":0xA3,"u":0xA4,"v":0xA5,"w":0xA6,"x":0xA7,"y":0xA8,"z":0xA9,
};
// IBM-1047（Unix POSIX EBCDIC）：在 037 字母数字基础上，含 [] {} ^ ~ \
// （037 无这些；1047 是 Linux-on-mainframe 常用码页）
const EBCDIC_1047 = {
  ...EBCDIC_037,
  "^":0x5F,"~":0xA1,"[":0xAD,"]":0xBD,"{":0xC0,"}":0xD0,
};
const EBCDIC_TABLES = { cp037: EBCDIC_037, cp1047: EBCDIC_1047 };
// 反向表（byte → char），含码页特有符号
const EBCDIC_REVERSE = {};
for (const [cp, tbl] of Object.entries(EBCDIC_TABLES)) {
  EBCDIC_REVERSE[cp] = {};
  for (const [k, v] of Object.entries(tbl)) EBCDIC_REVERSE[cp][v] = k;
}
function ebcdicEncode(text, p) {
  const cp = (p && p.codepage) || "cp037";
  const tbl = EBCDIC_TABLES[cp];
  if (!tbl) throw new Error(`未知 EBCDIC 码页: ${cp}`);
  const out = [];
  for (const ch of text) {
    out.push(ch in tbl ? tbl[ch] : 0x6F); // 未知 → EBCDIC '?'
  }
  return formatBytes(new Uint8Array(out), (p && p.format) || "hex");
}
function ebcdicDecode(text, p) {
  const cp = (p && p.codepage) || "cp037";
  const rev = EBCDIC_REVERSE[cp];
  if (!rev) throw new Error(`未知 EBCDIC 码页: ${cp}`);
  const bytes = parseBytes(text, (p && p.format) || "hex");
  let s = "";
  for (const b of bytes) s += (b in rev) ? rev[b] : "\uFFFD";
  return s;
}

// ============ UTF-16 BE/LE + BOM ============
const BOM = 0xFEFF;
function utf16Encode(text, p) {
  const endian = (p && p.endian) || "BE"; // BE | LE | auto(auto 同 BE)
  const wantBE = endian !== "LE";
  const addBom = !!(p && p.bom);
  const out = [];
  if (addBom) {
    if (wantBE) out.push(0xFE, 0xFF);
    else out.push(0xFF, 0xFE);
  }
  for (const ch of [...text]) {
    let cp = ch.codePointAt(0);
    if (cp > 0xFFFF) {
 // 拆代理对
      const hi = 0xD800 + ((cp - 0x10000) >> 10);
      const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
      cp = -1; // 标记
      pushU16(hi); pushU16(lo);
    } else {
      pushU16(cp);
    }
  }
  function pushU16(v) {
    if (wantBE) out.push((v >> 8) & 0xff, v & 0xff);
    else out.push(v & 0xff, (v >> 8) & 0xff);
  }
  return formatBytes(new Uint8Array(out), (p && p.format) || "hex");
}
function utf16Decode(text, p) {
  const bytes = parseBytes(text, (p && p.format) || "hex");
  let endian = (p && p.endian) || "BE";
  let start = 0;
 // BOM 自动检测
  if (bytes.length >= 2) {
    if (bytes[0] === 0xFE && bytes[1] === 0xFF) { endian = "BE"; start = 2; }
    else if (bytes[0] === 0xFF && bytes[1] === 0xFE) { endian = "LE"; start = 2; }
  }
  const body = bytes.slice(start);
 // 借宿主 TextDecoder 解码（支持代理对）
  return getDecoder(endian === "LE" ? "utf-16le" : "utf-16be").decode(body);
}

// ============ 乱码修复（mojibake 常见错配还原）============
// 场景：原文用 rightCharset 编码为字节，被错误地用 wrongCharset 解码 → 乱码串。
// 修复（decode）：乱码串 → strToBytes(wrong) 还原字节 → bytesToStr(right) 得原文。
// 制造（encode，便于构造测试样例）：原文 → strToBytes(right) → bytesToStr(wrong) → 乱码串。
// 注：部分方向有损（如 GBK 字节被误解为 UTF-8 会出替换字符，不可逆）。
const MOJIBAKE_PRESETS = {
  utf8_as_cp1252:   { wrong: "windows-1252", right: "utf-8",    name: "UTF-8 被误解为 Windows-1252" },
  utf8_as_latin1:   { wrong: "iso-8859-1",   right: "utf-8",    name: "UTF-8 被误解为 Latin-1（ISO-8859-1）" },
  utf8_as_gbk:      { wrong: "gbk",          right: "utf-8",    name: "UTF-8 被误解为 GBK（涓枃型）" },
  gbk_as_latin1:    { wrong: "iso-8859-1",   right: "gbk",      name: "GBK 被误解为 Latin-1" },
  gbk_as_utf8:      { wrong: "utf-8",        right: "gbk",      name: "GBK 被误解为 UTF-8（有损）" },
  big5_as_gbk:      { wrong: "gbk",          right: "big5",     name: "Big5 被误解为 GBK" },
  gbk_as_big5:      { wrong: "big5",         right: "gbk",      name: "GBK 被误解为 Big5" },
  shiftjis_as_latin1: { wrong: "iso-8859-1", right: "shift_jis", name: "Shift-JIS 被误解为 Latin-1" },
  euckr_as_latin1:    { wrong: "iso-8859-1", right: "euc-kr",    name: "EUC-KR 被误解为 Latin-1" },
};
function resolveMojibake(p) {
  const preset = (p && p.preset) || "utf8_as_cp1252";
  if (preset === "custom") {
    const wrong = (p && p.wrong) || "windows-1252";
    const right = (p && p.right) || "utf-8";
    return { wrong, right };
  }
  const cfg = MOJIBAKE_PRESETS[preset] || MOJIBAKE_PRESETS.utf8_as_cp1252;
  return { wrong: cfg.wrong, right: cfg.right };
}
function mojibakeRepair(text, p) { // decode 方向：乱码 → 原文
  const { wrong, right } = resolveMojibake(p);
  const bytes = strToBytes(wrong, text);
  return bytesToStr(right, bytes);
}
function mojibakeCreate(text, p) { // encode 方向：原文 → 乱码（构造样例用）
  const { wrong, right } = resolveMojibake(p);
  const bytes = strToBytes(right, text);
  return bytesToStr(wrong, bytes);
}

// ============ 注册 ============
const FORMAT_PARAM = {
  key: "format", label: "字节表示", type: "select", default: "hex",
  options: [
    { value: "hex", label: "Hex（默认，安全可往返）" },
    { value: "latin1", label: "Latin-1 二进制串（每字节一字符）" },
    { value: "auto", label: "自动（仅 decode：偶数 hex 否则 latin1）" },
  ],
};

register({
  id: "gbCharset", cat: "text", name: "GBK / GB2312 / GB18030",
  desc: "中文字符集 ↔ UTF-8（TextDecoder 解码 + 运行时反向建表编码）",
  params: [
    { key: "charset", label: "字符集", type: "select", default: "gbk",
      options: [
        { value: "gbk", label: "GBK（含 GB2312）" },
        { value: "gb2312", label: "GB2312（EUC-CN 子集）" },
        { value: "gb18030", label: "GB18030（超集）" },
      ],
    },
    FORMAT_PARAM,
  ],
  encode: gbEncode, decode: gbDecode,
});

register({
  id: "gb2312QuWei", cat: "text", name: "GB2312 区位码",
  desc: "汉字 ↔ 4 位区位码（区01-94 位01-94，字节=区位+0xA0；ASCII 透传）",
  params: [
    { key: "sep", label: "分组分隔", type: "select", default: "none",
      options: [
        { value: "none", label: "无（直接拼接）" },
        { value: "space", label: "空格" },
        { value: "newline", label: "换行" },
      ],
    },
  ],
  encode: quweiEncode, decode: quweiDecode,
});

register({
  id: "big5", cat: "text", name: "Big5 繁体中文",
  desc: "Big5 ↔ UTF-8（TextDecoder + 反向建表）",
  params: [FORMAT_PARAM],
  ...makeCodec("big5"),
});

register({
  id: "shiftJis", cat: "text", name: "Shift-JIS 日文",
  desc: "Shift-JIS ↔ UTF-8（TextDecoder + 反向建表）",
  params: [FORMAT_PARAM],
  ...makeCodec("shift_jis"),
});

register({
  id: "eucKr", cat: "text", name: "EUC-KR 韩文",
  desc: "EUC-KR ↔ UTF-8（TextDecoder + 反向建表）",
  params: [FORMAT_PARAM],
  ...makeCodec("euc-kr"),
});

register({
  id: "latinCharset", cat: "text", name: "Latin / ISO-8859 / Windows 单字节",
  desc: "ISO-8859 全系 + Windows 码页 ↔ UTF-8（单字节直映）",
  params: [
    { key: "charset", label: "字符集", type: "select", default: "iso-8859-1",
      options: [
        { value: "iso-8859-1",  label: "ISO-8859-1 Latin-1（西欧）" },
        { value: "iso-8859-2",  label: "ISO-8859-2 Latin-2（中欧）" },
        { value: "iso-8859-5",  label: "ISO-8859-5（西里尔）" },
        { value: "iso-8859-6",  label: "ISO-8859-6（阿拉伯）" },
        { value: "iso-8859-7",  label: "ISO-8859-7（希腊）" },
        { value: "iso-8859-8",  label: "ISO-8859-8（希伯来）" },
        { value: "iso-8859-9",  label: "ISO-8859-9 Latin-5（土耳其）" },
        { value: "iso-8859-15", label: "ISO-8859-15 Latin-9（含 €）" },
        { value: "windows-1250", label: "Windows-1250（中欧）" },
        { value: "windows-1251", label: "Windows-1251（西里尔）" },
        { value: "windows-1252", label: "Windows-1252（西欧 ANSI）" },
        { value: "windows-1253", label: "Windows-1253（希腊）" },
        { value: "windows-1254", label: "Windows-1254（土耳其）" },
        { value: "windows-1257", label: "Windows-1257（波罗的海）" },
      ],
    },
    FORMAT_PARAM,
  ],
  encode: (text, p) => formatBytes(strToBytes((p && p.charset) || "iso-8859-1", text), (p && p.format) || "hex"),
  decode: (text, p) => bytesToStr((p && p.charset) || "iso-8859-1", parseBytes(text, (p && p.format) || "hex")),
});

register({
  id: "ebcdic", cat: "text", name: "EBCDIC",
  desc: "IBM EBCDIC ↔ ASCII（内嵌 037/1047 码表，TextDecoder 不支持）",
  params: [
    { key: "codepage", label: "码页", type: "select", default: "cp037",
      options: [
        { value: "cp037", label: "IBM 037（US/Canada，经典）" },
        { value: "cp1047", label: "IBM 1047（Unix POSIX，含 []{}^~\\）" },
      ],
    },
    FORMAT_PARAM,
  ],
  encode: ebcdicEncode, decode: ebcdicDecode,
});

register({
  id: "utf16", cat: "text", name: "UTF-16 BE/LE",
  desc: "UTF-16 编解码 + BOM 处理（encode 可加 BOM，decode 自动识别 BOM）",
  params: [
    { key: "endian", label: "字节序", type: "select", default: "BE",
      options: [
        { value: "BE", label: "大端 BE" },
        { value: "LE", label: "小端 LE" },
      ],
    },
    { key: "bom", label: "encode 加 BOM", type: "bool", default: true },
    FORMAT_PARAM,
  ],
  encode: utf16Encode, decode: utf16Decode,
});

register({
  id: "mojibakeFix", cat: "text", name: "乱码修复 (Mojibake)",
  desc: "常见字符集错配还原（decode=修复，encode=制造乱码样例）；部分方向有损",
  params: [
    { key: "preset", label: "错配类型", type: "select", default: "utf8_as_cp1252",
      options: [
        { value: "utf8_as_cp1252", label: "UTF-8 被误解为 Windows-1252（ä¸­æ–‡型）" },
        { value: "utf8_as_latin1", label: "UTF-8 被误解为 Latin-1" },
        { value: "utf8_as_gbk", label: "UTF-8 被误解为 GBK（涓枃型）" },
        { value: "gbk_as_latin1", label: "GBK 被误解为 Latin-1" },
        { value: "gbk_as_utf8", label: "GBK 被误解为 UTF-8（有损）" },
        { value: "big5_as_gbk", label: "Big5 被误解为 GBK" },
        { value: "gbk_as_big5", label: "GBK 被误解为 Big5" },
        { value: "shiftjis_as_latin1", label: "Shift-JIS 被误解为 Latin-1" },
        { value: "euckr_as_latin1", label: "EUC-KR 被误解为 Latin-1" },
        { value: "custom", label: "自定义（填 wrong / right）" },
      ],
    },
    { key: "wrong", label: "误解的字符集（custom）", type: "text", default: "windows-1252", placeholder: "如 iso-8859-1 / gbk" },
    { key: "right", label: "正确字符集（custom）", type: "text", default: "utf-8", placeholder: "如 utf-8 / gbk" },
  ],
  encode: mojibakeCreate, decode: mojibakeRepair,
});

export {
  bytesToHex, hexToBytes, bytesToLatin1, latin1ToBytes,
  strToBytes, bytesToStr, getEncMap, isMultiByte,
  gbEncode, gbDecode, quweiEncode, quweiDecode,
  ebcdicEncode, ebcdicDecode, utf16Encode, utf16Decode,
  mojibakeRepair, mojibakeCreate,
  EBCDIC_037, EBCDIC_1047, EBCDIC_TABLES, EBCDIC_REVERSE,
  MOJIBAKE_PRESETS,
};
