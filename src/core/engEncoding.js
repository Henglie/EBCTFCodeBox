/*
 * engEncoding.js — T508 批四·工程编码组（E1/E3/E4/E5/E6/E9）。
 *
 * 6 个 op：hexdump / modhex / citrixCtx1 / scriptDecoder / rison / unixPerms。
 * 口径来源（逐项，均以本地快照+权威源核实，自研实现、行为对拍）：
 *   hexdump      — xxd 经典三栏格式（Git Bash xxd 实测输出当向量逐字节对拍）；
 *                  From 方向解析容错对照 CyberChef FromHexdump（偏移可选、'-' 分隔、
 *                  双空格后为 ASCII 列不吃），另支持 xxd -a 的 * 重复行。
 *   modhex       — YubiKey ModHex（Wikipedia: YubiKey § ModHex + CyberChef To/From Modhex）：
 *                  字母表 cbdefghijklnrtuv 与 0123456789abcdef 逐位互换，UTF-8 字节流。
 *   citrixCtx1   — CyberChef Citrix CTX1 Encode/Decode（tests/operations/tests/Ciphers.mjs
 *                  向量 "Password1"↔"PFFAJEDBOHECJEDBODEGIMCJPOFLJKDPKLAO"）：
 *                  明文按 UTF-16LE 展开成字节，temp = b⊕0xA5⊕prevTemp，
 *                  每个结果高/低半字节各 +0x41 → 两个 A-P 字符。
 *   scriptDecoder— CyberChef Microsoft Script Decoder（scrdec 公开算法，
 *                  tests/operations/tests/MS.mjs 向量对拍）：#@~^xxxxxx==…==^#~@ 块内
 *                  先做 @& @# @* @! @$ 五个逃逸替换，再按 128 行×3 列替换表 +
 *                  64 步组合序列（D_COMBINATION）按位置解码。run 型单向。
 *   rison        — Rison 规范（GitHub Nanonid/rison，CyberChef 快照 node_modules 内
 *                  随包源码逐条核对文法）：() 对象、!() 数组、!t/!f/!n、标识符免引号
 *                  （not_idchar=" '!:(),*@$"，首位另禁 -0-9）、引号串仅 !' 与 !! 转义、
 *                  数指数禁 '+'、对象键编码时排序；O-Rison/A-Rison 变体 + URI 引用。
 *                  注：任务书提到的 "~ 查找表压缩" 与 "!1 数组短写" 在权威 rison 规范中
 *                  不存在（urfarel.github.io/rison-js/ 已 404），未凭空实现。
 *   unixPerms    — Wikipedia: File system permissions（传统 Unix 权限）：
 *                  rwx 符号形 ↔ 3/4 位八进制 ↔ 二进制位 ↔ chmod 命令，特殊位
 *                  setuid(4)/setgid(2)/sticky(1) 映射 s/S/t/T。
 *
 * 对拍与测试：资料/工程留存/T508/批4_工程编码/test.mjs
 * （xxd 实测向量、CyberChef tests 向量、scrdec 表与快照逐行核对、往返与异常）。
 * 本文件为自研实现，未拷贝 CyberChef/rison 任何代码（替换表为算法常量数据）。
 */
import { register } from "./registry.js";

/* ---------- 公共：懒加载的 UTF-8 编解码（浏览器/Node 通用） ---------- */
let _enc = null, _dec = null;
function utf8Bytes(str) { return (_enc ||= new TextEncoder()).encode(String(str ?? "")); }
function utf8Text(bytes) { return (_dec ||= new TextDecoder()).decode(bytes); }

/* ================================================================
 * E1 Hexdump 互转（xxd 风格）
 * ================================================================ */
const HEX_LC = "0123456789abcdef";
const byteHex = (b) => HEX_LC[b >> 4] + HEX_LC[b & 15];
const isPrint = (b) => b >= 0x20 && b <= 0x7e;

/** 字节 → xxd 三栏文本：偏移(8 位 hex):  两字节一组的 hex 区  ASCII 区。 */
function hexdumpEncode(text, p) {
  const width = Math.round(Number((p && p.width) ?? 16));
  if (!Number.isInteger(width) || width < 1 || width > 512)
    throw new Error(`Hexdump：每行字节数须为 1-512 的整数（当前 ${width}）。`);
  const upper = !!(p && p.upperCase);
  const data = utf8Bytes(text);
  const groups = Math.ceil(width / 2);
  const hexAreaFull = width * 2 + groups; // 每字节 2 字符 + 每组尾 1 空格
  const lines = [];
  for (let off = 0; off < data.length; off += width) {
    const n = Math.min(width, data.length - off);
    let hex = "";
    for (let g = 0; g < groups; g++) {
      const i0 = off + g * 2;
      if (i0 < off + n) hex += byteHex(data[i0]);
      if (i0 + 1 < off + n) hex += byteHex(data[i0 + 1]);
      hex += " ";
    }
    hex = hex.padEnd(hexAreaFull, " ");
    let ascii = "";
    for (let i = 0; i < n; i++) { const b = data[off + i]; ascii += isPrint(b) ? String.fromCharCode(b) : "."; }
    let lineNo = off.toString(16).padStart(8, "0");
    if (upper) { lineNo = lineNo.toUpperCase(); hex = hex.toUpperCase(); }
    lines.push(`${lineNo}: ${hex} ${ascii}`);
  }
  return lines.join("\n");
}

const HEX_PAIRISH = /^[0-9A-Fa-f]{2,}/;

/** 解析单行 hexdump：返回 {offset|null, bytes[]}；无可识别内容返回 null。 */
function parseHexdumpLine(line) {
  let s = line.replace(/^[ \t]+/, "");
  let offset = null;
  // ① 带冒号/带 h 的偏移（xxd / DEBUG 0040h:）
  let m = /^([0-9A-Fa-f]{1,16})h?[ \t]*:(.*)$/.exec(s);
  if (m) { offset = parseInt(m[1], 16); s = m[2]; }
  else {
    // ② 无冒号：≥4 位 hex + 至少两空格（hexdump -C / CyberChef ToHexdump 风格）
    m = /^([0-9A-Fa-f]{6,16})[ \t]{2,}(.*)$/.exec(s)
      || /^([0-9A-Fa-f]{4,16})h[ \t]+(.*)$/.exec(s);
    if (m && HEX_PAIRISH.test(m[2])) { offset = parseInt(m[1], 16); s = m[2]; }
  }
  s = s.replace(/^[ \t]+/, "");
  // 数字间连字符视作分隔（部分 dump 风格 68-65-6C）
  s = s.replace(/([0-9A-Fa-f])-(?=[0-9A-Fa-f])/g, "$1 ");
  // ③ 十六进制区：连续 token（偶数位 hex，单空格分隔），遇双空格/非 hex 停（ASCII 列不吃）
  const bytes = [];
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && /[0-9A-Fa-f]/.test(s[j])) j++;
    const runLen = j - i;
    if (runLen < 2) break; // 空 run 或落单 hex 字符 → 后面是 ASCII 列
    for (let k = 0; k < runLen - (runLen % 2); k += 2)
      bytes.push(parseInt(s.substr(i + k, 2), 16));
    i = j;
    // token 后必须是单空格才继续；双空格 = ASCII 列边界
    if (i < s.length && s[i] === " ") {
      let k = i; while (k < s.length && s[k] === " ") k++;
      if (k - i >= 2) break;
      i = k;
      if (i >= s.length || !/[0-9A-Fa-f]/.test(s[i])) break;
    } else break;
  }
  if (offset === null && !bytes.length) return null;
  return { offset, bytes };
}

/** hexdump 文本 → 原文本（UTF-8 宽松解码）。支持 xxd / hexdump -C / CyberChef 及 * 重复行。 */
function hexdumpDecode(text, p) {
  const raw = String(text ?? "");
  if (!raw.trim()) return "";
  const out = [];
  let prev = null;   // 上一条带偏移的数据行（* 重复用）
  let star = false;
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (/^\s*\*\s*$/.test(line)) { star = true; continue; }
    const parsed = parseHexdumpLine(line);
    if (!parsed || !parsed.bytes.length) { star = false; continue; }
    const { offset, bytes } = parsed;
    if (star && prev && offset !== null) {
      const gap = offset - (prev.offset + prev.bytes.length);
      if (gap > 0 && gap % prev.bytes.length === 0)
        for (let r = 0; r < gap / prev.bytes.length; r++) out.push(...prev.bytes);
    }
    star = false;
    out.push(...bytes);
    if (offset !== null) prev = { offset, bytes };
  }
  if (!out.length)
    throw new Error("Hexdump：没有解析出任何十六进制字节——请确认输入是 xxd / hexdump -C / CyberChef 风格的转储文本（纯 hex 字节串请用 Hex 编码 op）。");
  return utf8Text(Uint8Array.from(out));
}

register({
  id: "hexdump", cat: "forensic", name: "Hexdump 互转（xxd）",
  desc: "xxd 风格十六进制转储 ↔ 原文本：编码方向输出「偏移: 两字节一组 hex + ASCII」三栏（与 xxd 逐字节一致，行宽/大小写可调）；解码方向容忍 xxd / hexdump -C / CyberChef 等常见格式（含 * 重复行）",
  params: [
    { key: "width", label: "每行字节数（1-512）", type: "number", default: 16 },
    { key: "upperCase", label: "十六进制大写", type: "bool", default: false },
  ],
  encode: hexdumpEncode,
  decode: hexdumpDecode,
});

/* ================================================================
 * E3 Modhex（YubiKey）
 * ================================================================ */
// YubiKey ModHex 字母表：键盘布局无关，与 0-f 一一对应（Wikipedia: YubiKey § ModHex）
const MODHEX_ALPHA = "cbdefghijklnrtuv";
const MODHEX_IDX = new Map([...MODHEX_ALPHA].map((c, i) => [c, i]));

function modhexEncode(text, p) {
  const delim = (p && p.delim) || "none";
  const sep = delim === "space" ? " " : delim === "colon" ? ":" : delim === "comma" ? "," : "";
  const data = utf8Bytes(text);
  if (!data.length) return "";
  const parts = [];
  for (const b of data) parts.push(MODHEX_ALPHA[b >> 4] + MODHEX_ALPHA[b & 15]);
  return parts.join(sep);
}

const MODHEX_DELIM_OK = /^[\s:;,.\-_%|+]+$/;

function modhexDecode(text) {
  const t = String(text ?? "");
  if (!t.trim()) return "";
  // 允许常见分隔符（Auto：空格/冒号/逗号/分号/点/横线/百分号/竖线/加号），其余字符报错
  const cleaned = t.replace(new RegExp(`[^${MODHEX_ALPHA}]`, "gi"), (ch) => {
    if (MODHEX_DELIM_OK.test(ch)) return "";
    throw new Error(`Modhex：字符 "${ch}" 不在 modhex 字母表 cbdefghijklnrtuv 内（也不是常见分隔符）。`);
  }).toLowerCase();
  if (!cleaned) return "";
  if (cleaned.length % 2 !== 0)
    throw new Error(`Modhex：有效字符共 ${cleaned.length} 个，为奇数——无法按两位组成一个字节（检查是否漏抄或多抄了一个字符）。`);
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = (MODHEX_IDX.get(cleaned[i * 2]) << 4) | MODHEX_IDX.get(cleaned[i * 2 + 1]);
  return utf8Text(bytes);
}

register({
  id: "modhex", cat: "base", name: "Modhex（YubiKey）",
  desc: "YubiKey 键盘布局无关十六进制：字母表 cbdefghijklnrtuv ↔ 0-9a-f 逐位替换（UTF-8 字节流），双向；大小写不敏感，解码自动容忍常见分隔符",
  params: [
    { key: "delim", label: "输出分隔符", type: "select", default: "none",
      options: [
        { value: "none", label: "无（连续流）" },
        { value: "space", label: "空格（每字节一组）" },
        { value: "colon", label: "冒号 :" },
        { value: "comma", label: "逗号 ," },
      ] },
  ],
  encode: modhexEncode,
  decode: modhexDecode,
});

/* ================================================================
 * E4 Citrix CTX1
 * ================================================================ */
// CyberChef CitrixCTX1Encode/Decode 语义（Apache-2.0，自研重写）：
//   编码：明文 → UTF-16LE 字节；temp = b ⊕ 0xA5 ⊕ prevTemp（链式，prevTemp 初值 0）；
//        每个 temp 输出两个字符：((temp>>>4)&0xF)+0x41 与 (temp&0xF)+0x41（即 A-P）。
//   解码：两位一组还原 val[j]，b[j] = val[j] ⊕ 0xA5 ⊕ val[j-1]（val[-1]=0），
//        字节流按 UTF-16LE 还原字符串。密文长度须为 4 的倍数。
const CTX1_A = 0x41;

function citrixEncode(text) {
  const t = String(text ?? "");
  if (!t) return "";
  let out = "";
  let temp = 0;
  for (let i = 0; i < t.length; i++) { // charCodeAt 序列即 UTF-16LE 字节（含代理对）
    const code = t.charCodeAt(i);
    for (const b of [code & 0xff, (code >> 8) & 0xff]) {
      temp = b ^ 0xa5 ^ temp;
      out += String.fromCharCode(((temp >>> 4) & 0xf) + CTX1_A, (temp & 0xf) + CTX1_A);
    }
  }
  return out;
}

function citrixDecode(text) {
  let t = String(text ?? "").trim().toUpperCase();
  if (!t) return "";
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c < 0x41 || c > 0x50)
      throw new Error(`Citrix CTX1：字符 "${t[i]}"（位置 ${i + 1}）不在 A-P 范围内——密文应仅由 A 到 P 共 16 个字母组成。`);
  }
  if (t.length % 4 !== 0)
    throw new Error(`Citrix CTX1：密文长度 ${t.length} 不是 4 的倍数（每个明文字符 → 2 个 UTF-16LE 字节 → 4 个 A-P 字符）。`);
  const n = t.length / 2; // 字节数
  const bytes = new Uint8Array(n);
  let prevVal = 0;
  for (let j = 0; j < n; j++) {
    const val = ((t.charCodeAt(j * 2) - CTX1_A) << 4) | (t.charCodeAt(j * 2 + 1) - CTX1_A);
    bytes[j] = val ^ 0xa5 ^ prevVal;
    prevVal = val;
  }
  let out = "";
  for (let i = 0; i < bytes.length; i += 2)
    out += String.fromCharCode(bytes[i] | (bytes[i + 1] << 8));
  return out;
}

register({
  id: "citrixCtx1", cat: "base", name: "Citrix CTX1",
  desc: "Citrix 密码编码（.ica/思杰凭据常见）：UTF-16LE 字节链式异或 0xA5，每个结果的两个半字节各 +0x41 映射为 A-P 字符；双向",
  params: [],
  encode: citrixEncode,
  decode: citrixDecode,
});

/* ================================================================
 * E5 Microsoft Script Decoder（.vbe/.jse，scrdec 算法）
 * ================================================================ */
// 128 行 × 3 列替换表（scrdec 公开算法常量；test.mjs 与 CyberChef 快照逐行核对）
// 每行 6 个 hex 字符 = 三个目标字符；行号 = 编码字节的 ASCII 值。
const SCRDEC_TABLE_HEX = [
  "", "", "", "", "", "", "", "", "",
  "576E7B", "4A4C41", "0B0B0B", "0C0C0C", "4A4C41",
  "0E0E0E", "0F0F0F", "101010", "111111", "121212",
  "131313", "141414", "151515", "161616", "171717",
  "181818", "191919", "1A1A1A", "1B1B1B", "1C1C1C",
  "1D1D1D", "1E1E1E", "1F1F1F",
  "2E2D32", "477530", "7A5221", "566029", "42715B", "6A5E38", "2F4933", "265C3D",
  "496258", "417D3A", "342935", "323665", "5B2039", "767C5C", "727A56", "437F73",
  "386B66", "39634E", "703345", "452B6B", "686862", "715159", "4F6678", "09765E",
  "62317D", "44644A", "23546D", "754371", "4A4C41", "7E3A60", "4A4C41", "5E7E53",
  "404C40", "774542", "4A2C27", "612A48", "5D7472", "222775", "4B3731", "6F4437",
  "4E794D", "3B5952", "4C2F22", "506F54", "67266A", "2A7247", "7D6A64", "74392D",
  "547B20", "2B3F7F", "2D382E", "2C774C", "30675D", "6E537E", "6B476C", "66346F",
  "357879", "255D74", "213043", "642326", "4D5A76", "525B25", "636C24", "3F482B",
  "7B5528", "787023", "296941", "282E34", "734C09", "59212A", "332444", "7F4E3F",
  "6D5077", "55093B", "535655", "7C7369", "3A3561", "5F6163", "654B50", "465867",
  "583B51", "315749", "69224F", "6C6D46", "5A4D68", "48257C", "272836", "5C4670",
  "3D4A6E", "24327A", "79412F", "373D5F", "605F4B", "514F5A", "20422C", "366557",
];
// 64 步组合序列：第 index 个可解码位置取第 (index % 64) 个值 ∈ {0,1,2} 选列
const SCRDEC_COMB = [
  0, 1, 2, 0, 1, 2, 1, 2, 2, 1, 2, 1, 0, 2, 1, 2, 0, 2, 1, 2, 0, 0, 1, 2, 2, 1, 0, 2, 1, 2, 2, 1,
  0, 0, 2, 1, 2, 1, 2, 0, 2, 0, 0, 1, 2, 0, 2, 1, 0, 2, 1, 2, 0, 0, 1, 2, 2, 0, 0, 1, 2, 0, 2, 1,
];
const SCRDEC_ROWS = SCRDEC_TABLE_HEX.map((h) => [0, 2, 4].map((i) => String.fromCharCode(parseInt(h.substr(i, 2), 16))).join(""));

/** 解码编码块主体（#@~^…== 与 ==^#~@ 之间）。 */
function scrdecDecodeBody(data) {
  data = data
    .replace(/@&/g, "\n").replace(/@#/g, "\r")
    .replace(/@\*/g, ">").replace(/@!/g, "<").replace(/@\$/g, "@");
  let out = "";
  let index = -1;
  for (let i = 0; i < data.length; i++) {
    const byte = data.charCodeAt(i);
    let ch = data.charAt(i);
    if (byte < 128) index++;
    // 可替换类：TAB 或可见 ASCII（32-127），但 < > @ 三者除外（由逃逸序列承担）
    if ((byte === 9 || (byte > 31 && byte < 128)) && byte !== 60 && byte !== 62 && byte !== 64)
      ch = SCRDEC_ROWS[byte].charAt(SCRDEC_COMB[index % 64]);
    out += ch;
  }
  return out;
}

/** run：识别 #@~^xxxxxx==…==^#~@ 编码块并解码（.vbe/.jse 全文粘贴即可）。 */
function scriptDecoderRun(text) {
  const t = String(text ?? "");
  const m = /#@~\^.{6}==(.+).{6}==\^#~@/.exec(t);
  if (!m)
    throw new Error("脚本解码：未找到编码块——.vbe/.jse 内容应形如 #@~^XXXXXX==…XXXXXX==^#~@，请粘贴完整文件内容。");
  return scrdecDecodeBody(m[1]);
}

/** 测试用编码器（scrdec 解码的确定性逆）：按当前位置的组合列挑可逆字节。
 *  注意：部分字符在个别组合列可能无源字节（替换表存在碰撞），此时报错；真实 screnc 有
 *  专用机制，本编码器仅用于自构测试样本与往返验证。 */
function scrdecEncodeBody(plain) {
  const REV = [new Map(), new Map(), new Map()];
  // 源字节取 TAB(9) + 可见 ASCII 32-127（去 < > @）：CR/LF 虽也在表内（行 10/13 = JLA），
  // 但裸换行会破坏 #@~^…==…==^#~@ 单行块结构（正则 . 不跨行）；TAB 不影响匹配，保留。
  const src = [9];
  for (let b = 32; b < 128; b++) if (b !== 60 && b !== 62 && b !== 64) src.push(b);
  for (const b of src) {
    const row = SCRDEC_ROWS[b];
    for (let c = 0; c < 3; c++) if (!REV[c].has(row.charAt(c))) REV[c].set(row.charAt(c), b);
  }
  // 解码侧 index 按「逃逸替换后」的字符串计数：@&/@# 等两个字符的逃逸在解码时
  // 先被替换成单个字符（LF/CR/</>/@）再计数，因此这里每个逃逸记 1，普通 ASCII 记 1，非 ASCII 记 0。
  const countIdx = (s) => {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
      if (s[i] === "@" && i + 1 < s.length && "&#*!$".includes(s[i + 1])) { n++; i++; }
      else if (s.charCodeAt(i) < 128) n++;
    }
    return n;
  };
  let data = "";
  for (const pch of String(plain)) {
    const code = pch.charCodeAt(0);
    if (code === 10) { data += "@&"; continue; }
    if (code === 13) { data += "@#"; continue; }
    if (code === 60) { data += "@!"; continue; }
    if (code === 62) { data += "@*"; continue; }
    if (code === 64) { data += "@$"; continue; }
    if (code === 9 || (code > 31 && code < 128)) {
      const comb = SCRDEC_COMB[countIdx(data) % 64];
      const b = REV[comb].get(pch);
      if (b === undefined)
        throw new Error(`脚本编码（测试用）：明文字符 ${JSON.stringify(pch)} 在当前位置（组合列 ${comb}）无可用源字节——换用其他样本字符。`);
      data += String.fromCharCode(b);
    } else {
      data += pch; // 其余控制字符与非 ASCII 原样透传
    }
  }
  return data;
}

/** 用测试编码器产一个完整 .vbe 形态样本（长度标记位解码时不校验，填 AAAAAA）。 */
function scrdecWrap(body) { return `#@~^AAAAAA==${body}AAAAAA==^#~@`; }

register({
  id: "scriptDecoder", cat: "forensic", name: "MS 脚本解码（.vbe/.jse）",
  desc: "还原 Microsoft 编码脚本（scrdec 算法）：#@~^ 头 + 128×3 替换表按 64 步组合序列位置解码，@& @# @* @! @$ 逃逸还原；.vbe/.jse 取证常客，单向",
  params: [],
  run: scriptDecoderRun,
});

/* ================================================================
 * E6 Rison（compact JSON for URLs）
 * ================================================================ */
// 文法常量（Nanonid/rison 源码逐条核对）：
const RISON_NOT_IDCHAR = " '!:(),*@$";     // 标识符内禁用（引号内不禁）
const RISON_NOT_IDSTART = "-0123456789";   // 标识符首位另禁（防与数字混淆）

function risonEncString(s) {
  if (s === "") return "''";
  let ok = true;
  for (let i = 0; i < s.length; i++) {
    if (RISON_NOT_IDCHAR.includes(s[i]) || (i === 0 && RISON_NOT_IDSTART.includes(s[i]))) { ok = false; break; }
  }
  if (ok) return s; // 标识符免引号
  return "'" + s.replace(/(['!])/g, "!$1") + "'"; // 仅 ' 与 ! 需要转义（! 前缀）
}

function risonEncNumber(x) {
  // 指数里的 '+' 删掉（URI 不安全），'-' 保留；非有限数按 !n（与参考实现一致）
  if (!Number.isFinite(x)) return "!n";
  return String(x).replace("+", "");
}

function risonEncValue(v) {
  if (v === null) return "!n";
  switch (typeof v) {
    case "boolean": return v ? "!t" : "!f";
    case "number": return risonEncNumber(v);
    case "string": return risonEncString(v);
    case "object": {
      if (Array.isArray(v)) return "!(" + v.map(risonEncValue).join(",") + ")";
      const ks = Object.keys(v).sort(); // 参考实现：键排序输出
      return "(" + ks.map((k) => risonEncString(k) + ":" + risonEncValue(v[k])).join(",") + ")";
    }
    default: throw new Error(`Rison：无法编码 ${typeof v} 类型的值（JSON 数据不会出现）。`);
  }
}

/** rison.quote：比 encodeURIComponent 宽松的 URI 引用（空格→+，,:@$ / 放行）。 */
function risonQuoteUri(x) {
  if (/^[-A-Za-z0-9~!*()_.',:@$\/]*$/.test(x)) return x;
  return encodeURIComponent(x)
    .replace(/%2C/g, ",").replace(/%3A/g, ":").replace(/%40/g, "@")
    .replace(/%24/g, "$").replace(/%2F/g, "/").replace(/%20/g, "+");
}

/* ---------- 解码：递归下降（语义与参考实现一致，报错中文化且更严格地报位置） ---------- */
function risonParse(str) {
  let i = 0;
  const err = (msg) => { throw new Error(`Rison：${msg}（位置 ${i}，剩余 "${str.slice(i, i + 12)}${str.length - i > 12 ? "…" : ""}"）`); };
  function readValue() {
    const c = str.charAt(i);
    if (c === "") err("表达式意外结束");
    if (c === "!") {
      i++;
      const c2 = str.charAt(i++);
      if (c2 === "(") return readArray();
      if (c2 === "t") return true;
      if (c2 === "f") return false;
      if (c2 === "n") return null;
      throw new Error(`Rison：未知字面量 "!${c2}"（仅支持 !( 数组、!t、!f、!n）`);
    }
    if (c === "(") { i++; return readObject(); }
    if (c === "'") { i++; return readString(); }
    if (c === "-" || (c >= "0" && c <= "9")) return readNumber();
    return readId();
  }
  function readArray() {
    const ar = [];
    let first = true;
    for (;;) {
      const c = str.charAt(i);
      if (c === "") throw new Error("Rison：数组 !( 未闭合");
      if (c === ")") { i++; return ar; }
      if (first) { if (c === ",") throw new Error("Rison：数组首个元素前多了 ,"); first = false; }
      else { if (c !== ",") err('数组元素之间应为 ","'); i++; }
      ar.push(readValue());
    }
  }
  function readObject() {
    const o = {};
    let count = 0;
    for (;;) {
      const c = str.charAt(i);
      if (c === "") throw new Error("Rison：对象 ( 未闭合");
      if (c === ")") { i++; return o; }
      if (count) { if (c !== ",") err('对象成员之间应为 ","'); i++; }
      else if (c === ",") throw new Error("Rison：对象首个成员前多了 ,");
      const k = readValue();
      if (str.charAt(i) !== ":") err('对象键后应为 ":"');
      i++;
      o[k] = readValue();
      count++;
    }
  }
  function readString() {
    let out = "";
    for (;;) {
      const c = str.charAt(i++);
      if (c === "'") return out;
      if (c === "") throw new Error("Rison：字符串引号未闭合");
      if (c === "!") {
        const e = str.charAt(i++);
        if (e === "!" || e === "'") out += e;
        else throw new Error(`Rison：非法字符串转义 "!${e}"（仅支持 !! 与 !'）`);
      } else out += c;
    }
  }
  function readNumber() {
    const start = i;
    let state = "int", signs = "-";
    for (;;) {
      const c = str.charAt(i);
      if (c === "") break;
      if (c >= "0" && c <= "9") { i++; continue; }
      if (signs.includes(c)) { signs = ""; i++; continue; }
      const key = state + "+" + c.toLowerCase();
      if (key === "int+.") { state = "frac"; i++; continue; }
      if (key === "int+e" || key === "frac+e") { state = "exp"; signs = "-"; i++; continue; }
      break;
    }
    const s = str.slice(start, i);
    if (s === "-") throw new Error('Rison：单独的 "-" 不是数字');
    const n = Number(s);
    if (Number.isNaN(n)) throw new Error(`Rison："${s}" 不是合法数字`);
    if (!Number.isFinite(n)) throw new Error(`Rison：数字 "${s}" 超出可表示范围`);
    return n;
  }
  function readId() {
    const c = str.charAt(i);
    if (c === "" || RISON_NOT_IDCHAR.includes(c) || RISON_NOT_IDSTART.includes(c))
      err(`字符 "${c}" 不能作为标识符起点`);
    let j = i + 1;
    while (j < str.length && !RISON_NOT_IDCHAR.includes(str.charAt(j))) j++;
    const id = str.slice(i, j);
    i = j;
    return id;
  }
  const v = readValue();
  if (i < str.length) err("顶层值之后还有多余字符");
  return v;
}

function risonEncodeOp(text, p) {
  const t = String(text ?? "").trim();
  const mode = (p && p.mode) || "value";
  if (!t) return "";
  let v;
  try { v = JSON.parse(t); }
  catch (e) { throw new Error(`Rison：输入不是合法 JSON（${e.message}）——编码方向吃 JSON 文本。`); }
  if (mode === "object") {
    if (typeof v !== "object" || v === null || Array.isArray(v))
      throw new Error("Rison：O-Rison 模式只接受 JSON 对象（{…}）——顶层是数组请切 A-Rison / 值模式。");
    const r = risonEncValue(v);
    return r.slice(1, -1); // 去掉外层括号
  }
  if (mode === "array") {
    if (!Array.isArray(v))
      throw new Error("Rison：A-Rison 模式只接受 JSON 数组（[…]）——顶层是对象请切 O-Rison / 值模式。");
    return risonEncValue(v).slice(2, -1); // 去掉 !()
  }
  if (mode === "uri") return risonQuoteUri(risonEncValue(v));
  return risonEncValue(v);
}

function risonDecodeOp(text, p) {
  const mode = (p && p.mode) || "value";
  const t = String(text ?? "").trim();
  if (!t) return "";
  let s = t;
  if (mode === "object") s = "(" + s + ")";
  else if (mode === "array") s = "!(" + s + ")";
  else if (mode === "uri") s = t.replace(/\+/g, " ").replace(/%([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); // 宽松反引用
  const v = risonParse(s);
  return JSON.stringify(v, null, 2);
}

register({
  id: "rison", cat: "data", name: "Rison",
  desc: "面向 URI 的紧凑 JSON：() 对象、!() 数组、!t/!f/!n、标识符免引号、引号串仅 !' 与 !! 转义、指数禁 +；JSON ↔ Rison 双向，支持 O-Rison / A-Rison / URI 引用变体",
  params: [
    { key: "mode", label: "模式", type: "select", default: "value",
      options: [
        { value: "value", label: "值：对象 (…) / 数组 !(…)" },
        { value: "object", label: "O-Rison：省略对象括号" },
        { value: "array", label: "A-Rison：省略数组 !(…)" },
        { value: "uri", label: "URI：值 + URL 宽松引用" },
      ] },
  ],
  encode: risonEncodeOp,
  decode: risonDecodeOp,
});

/* ================================================================
 * E9 UNIX 文件权限
 * ================================================================ */
const PERM_TYPE_NAMES = {
  d: "目录（d）", l: "符号链接（l）", p: "命名管道 FIFO（p）", c: "字符设备（c）",
  b: "块设备（b）", s: "套接字（s）", D: "门 door·Solaris（D）",
};

/** 解析八进制或符号形 → 4 位八进制数字数组 [特殊, u, g, o] + 文件类型。 */
function parseUnixPerms(text) {
  const t = String(text ?? "").trim();
  if (!t) throw new Error("UNIX 权限：输入为空——给八进制（755 / 0755 / 4755）或符号形（rwxr-xr-x / drwxr-xr-t / -rwSr--r--）。");
  const s = t.replace(/\s+/g, "");
  let m = /^(0[0-7]{3}|[0-7]{3,4})$/.exec(s);
  if (m) {
    let spec = s.length === 4 ? s : "0" + s;
    return { kind: "octal", digits: [...spec].map((d) => parseInt(d, 8)), type: null };
  }
  m = /^([dlpcbD-]?)([r-][w-][xsS-])([r-][w-][xsS-])([r-][w-][xtT-])$/.exec(s);
  if (m) {
    const type = m[1] && m[1] !== "-" ? m[1] : null;
    let special = 0;
    const digits = [0, 0, 0, 0];
    [m[2], m[3], m[4]].forEach((tr, i) => {
      let d = (tr[0] === "r" ? 4 : 0) | (tr[1] === "w" ? 2 : 0);
      const x = tr[2];
      if (x === "x") d |= 1;
      else if (x === "s") { d |= 1; special |= (i === 0 ? 4 : 2); }
      else if (x === "S") special |= (i === 0 ? 4 : 2);
      else if (x === "t") { d |= 1; special |= 1; }
      else if (x === "T") special |= 1;
      digits[i + 1] = d;
    });
    digits[0] = special;
    return { kind: "text", digits, type };
  }
  throw new Error(`UNIX 权限：「${t}」不是合法输入——八进制给 3-4 位（755 / 0755 / 4755），符号形给 9 位（rwxr-xr-x）或带类型位的 10 位（drwxr-xr-t）。`);
}

/** 4 位八进制 → 9 位符号形（含 s/S/t/T 特殊位表示）。 */
function permsToSymbolic(digits) {
  const [sp, u, g, o] = digits;
  const tri = (d, pos) => {
    let t = (d & 4 ? "r" : "-") + (d & 2 ? "w" : "-");
    if (pos === 0) t += d & 1 ? (sp & 4 ? "s" : "x") : (sp & 4 ? "S" : "-");
    else if (pos === 1) t += d & 1 ? (sp & 2 ? "s" : "x") : (sp & 2 ? "S" : "-");
    else t += d & 1 ? (sp & 1 ? "t" : "x") : (sp & 1 ? "T" : "-");
    return t;
  };
  return tri(u, 0) + tri(g, 1) + tri(o, 2);
}

function permsToSymbolicChmod(digits) {
  const [sp, u, g, o] = digits;
  const part = (d) => (d & 4 ? "r" : "") + (d & 2 ? "w" : "") + (d & 1 ? "x" : "");
  const parts = [`u=${part(u)}`, `g=${part(g)}`, `o=${part(o)}`];
  if (sp & 4) parts.push("u+s");
  if (sp & 2) parts.push("g+s");
  if (sp & 1) parts.push("o+t");
  return parts.join(",");
}

function unixPermsRun(text) {
  const { digits, kind, type } = parseUnixPerms(text);
  const [sp, u, g, o] = digits;
  const sym = permsToSymbolic(digits);
  const oct3 = `${u}${g}${o}`;
  const oct4 = `${sp}${u}${g}${o}`;
  const bin = [u, g, o].map((d) => d.toString(2).padStart(3, "0")).join(" ");
  const permNames = ["读 r", "写 w", "执行 x"];
  const lines = [];
  lines.push(`输入形态：${kind === "octal" ? `八进制 ${text.trim()}` : `符号形 ${text.trim()}`}`);
  lines.push(`符号形（9 位）：${sym}`);
  lines.push(`带类型位（10 位）：${type || "-"}${sym}`);
  lines.push(`文件类型：${kind === "text" && type ? PERM_TYPE_NAMES[type] : "未知（八进制/9 位符号形不含类型位，按普通文件 - 展示）"}`);
  lines.push(`八进制（3 位）：${oct3}`);
  lines.push(`八进制（4 位，含特殊位）：${oct4}`);
  lines.push(`二进制位：${bin}${sp ? `（特殊位 ${sp.toString(2).padStart(3, "0")}）` : ""}`);
  lines.push(`chmod 命令：chmod ${oct4} 文件`);
  lines.push(`符号 chmod：chmod ${permsToSymbolicChmod(digits)} 文件`);
  const specials = [];
  if (sp & 4) specials.push("setuid（首位 4）：以文件属主身份执行——符号形属主执行位显示 s（有执行）/ S（无执行）");
  if (sp & 2) specials.push("setgid（首位 2）：以文件属组身份执行；用在目录上则新文件继承目录属组——符号形属组执行位显示 s/S");
  if (sp & 1) specials.push("sticky（首位 1）：仅属主（及 root）可删改目录内文件，典型如 /tmp 的 1777——符号形其他执行位显示 t/T");
  lines.push(specials.length ? `特殊位（八进制首位 ${sp}）：\n  - ${specials.join("\n  - ")}` : "特殊位：无（setuid / setgid / sticky 均未设置）");
  [["属主 owner（u）", u], ["属组 group（g）", g], ["其他 other（o）", o]].forEach(([label, d]) => {
    const has = [d & 4, d & 2, d & 1].map((b, i) => (b ? permNames[i] : "")).filter(Boolean);
    lines.push(`${label}：${has.join(" + ") || "无任何权限（---）"}`);
  });
  return lines.join("\n");
}

register({
  id: "unixPerms", cat: "forensic", name: "UNIX 文件权限",
  desc: "权限形态互转报告：755 / 4755 八进制 ↔ rwxr-xr-x / rwsr-xr-t 符号形 ↔ 二进制位 ↔ chmod 命令，含 setuid/setgid/sticky 特殊位与各身份明细",
  params: [],
  run: unixPermsRun,
});

/* 供测试/上层复用 */
export {
  // hexdump
  hexdumpEncode, hexdumpDecode, parseHexdumpLine,
  // modhex
  modhexEncode, modhexDecode, MODHEX_ALPHA,
  // citrix ctx1
  citrixEncode, citrixDecode,
  // ms script decoder
  scriptDecoderRun, scrdecDecodeBody, scrdecEncodeBody, scrdecWrap,
  SCRDEC_TABLE_HEX, SCRDEC_COMB,
  // rison
  risonEncodeOp, risonDecodeOp, risonEncValue, risonParse, risonEncString, risonQuoteUri,
  // unix perms
  unixPermsRun, parseUnixPerms, permsToSymbolic, permsToSymbolicChmod,
};
