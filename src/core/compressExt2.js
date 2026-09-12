/*
 * compressExt2.js — T508 批三·压缩校验卡（B3-B6 + E7-E8，6 op）。
 *
 * rle / lzw / elias（forensic，压缩编码族，与 gzipCodec 同分类）
 * verhoeff（hash，校验族）lz4Dec / bzip2Dec（forensic，解压族）。
 *
 * 口径来源（逐项）：
 *   rle      — dcode.fr/compression-rle（2026-09 抓取核实）：
 *              计前式「Nombre puis Caractère」4C=CCCC、计后式「Caractère puis Nombre」
 *              C4=CCCC 两形态（页面例：DDDDDCCCCOOODDE → D5C4O3D2E1；数字数据需定长计数，
 *              页面例 11111111111122 → 12-1,2-2）。第三形态 packed：count+value 字节对
 *              （hex 呈现，CyberChef 风格二进制打包，CyberChef 本无此 op、自定口径）。
 *   lzw      — GIF/TIFF 经典变长 LZW（Wikipedia "Lempel–Ziv–Welch"：初始字典、
 *              变宽规则、KwKwK 情形；dcode.fr/compression-lzw 2026-09 抓取核对编码流程）。
 *              字节字母表 + minCodeSize（默认 8）→ clear=2^mcs / EOD=2^mcs+1 / 首新码
 *              2^mcs+2，9→12 位 GIF 变宽（码本满 4096 发 clear 重置），MSB-first 打包。
 *              与既有 lzstring op（pieroxy JS 变体，码本/打包均不等价）明确区分。
 *   elias    — Wikipedia "Elias gamma coding"/"Elias delta coding"（权威定义 + 例码表）。
 *   verhoeff — Wikipedia "Verhoeff algorithm"（d/p/inv 三表 + 生成/校验流程，
 *              页面例：generate(236)=3 → 2363，validate(2363) 通过）。
 *   lz4Dec   — LZ4 块格式 v1.0（github.com/lz4/lz4 doc/lz4_Block_format.md，2026-09
 *              抓取核实：token 高 4 位字面量长/低 4 位匹配长、255 续位、2 字节小端偏移
 *              1-65535、minmatch=4、末序列仅字面量）+ 帧格式（lz4_Frame_format.md：
 *              magic 0x184D2204、FLG/BD、8 字节内容长、HC=(xxh32(descriptor)>>8)&0xff、
 *              块高位置位=未压缩、0x00000000 EndMark、xxh32 内容校验）。
 *   bzip2Dec — bzip2 流格式（BZh+级别；块 magic 0x314159265359 / 尾 magic
 *              0x177245385090；CRC-32/BZIP2 poly 0x04C11DB7 MSB-first；24 位 origPtr；
 *              16×16 符号位图；2-6 棵 Huffman 树 + 50 符号换树选择子 MTF+一元码；
 *              码长 5 位基值 + 1/-1 delta；RUNA/RUNB 双基游程；MTF；BWT 逆变换
 *              （Fenwick SRC-RR-124 §4.2 单数组法）；RLE1 尾游程：4 连字节后跟计数）。
 *              参照 Go 标准库 compress/bzip2 与 dsnet/compress 格式文档的语义自研，
 *              未拷代码。对拍：Git Bash bzip2 / python bz2 生成样本。
 *
 * 测试：资料/工程留存/T508/批3_压缩校验/test.mjs（dCode 向量 + 真实 GIF/bzip2/lz4
 * 样本对拍 + 往返 + 异常路径）。
 * 红线：compress.js 等既有文件零改动；本文件只新建。输入输出全部本地计算，零外发。
 */
import { register } from "./registry.js";
import { inputToBytes, bytesToOutput } from "./compress.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

/* ================================================================
 * B3 RLE 行程编码 rle
 * ================================================================ */
function rleRuns(chars) {
  const runs = [];
  for (const ch of chars) {
    if (runs.length && runs[runs.length - 1].ch === ch) runs[runs.length - 1].n++;
    else runs.push({ ch, n: 1 });
  }
  return runs;
}

function rleEncode(text, p) {
  const fmt = (p && p.fmt) || "countFirst";
  const t = String(text ?? "");
  if (fmt === "packed") {
    const bytes = te(t);
    const out = [];
    let i = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      let n = 1;
      while (i + n < bytes.length && bytes[i + n] === b && n < 255) n++;
      out.push(n, b);
      i += n;
    }
    return out.map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  const countMode = (p && p.countMode) || "var";
  const digits = Math.max(1, Math.min(4, Number((p && p.fixedDigits) || 2) | 0));
  const runs = rleRuns([...t]);
  const parts = [];
  for (const { ch, n } of runs) {
    if (countMode === "fixed") {
      const max = 10 ** digits - 1;
      let rest = n;
      while (rest > 0) {
        const c = Math.min(rest, max);
        parts.push(fmt === "charFirst" ? [ch, String(c).padStart(digits, "0")] : [String(c).padStart(digits, "0"), ch]);
        rest -= c;
      }
    } else {
      parts.push(fmt === "charFirst" ? [ch, String(n)] : [String(n), ch]);
    }
  }
  return parts.flat().join("");
}

function rleDecode(text, p) {
  const fmt = (p && p.fmt) || "countFirst";
  const countMode = (p && p.countMode) || "var";
  const digits = Math.max(1, Math.min(4, Number((p && p.fixedDigits) || 2) | 0));
  if (fmt === "packed") {
    // 打包式只认 hex/base64（不给 UTF-8 兜底：二进制格式喂文本只会产出静默垃圾）
    const enc = (p && p.inputEnc) || "auto";
    const s = String(text ?? "").trim().replace(/\s+/g, "");
    let bytes;
    if (!s) return "";
    if (enc === "hex" || (enc === "auto" && /^[0-9a-fA-F]+$/.test(s))) {
      if (s.length % 2 !== 0)
        throw new Error("RLE（打包式）：hex 长度为奇数（应为「计数,值」成对字节）。");
      bytes = inputToBytes(s, { inputEnc: "hex" });
    } else if (enc === "utf8") {
      throw new Error("RLE（打包式）：不支持 UTF-8 输入（应为 hex/base64）。");
    } else {
      try {
        bytes = inputToBytes(s, { inputEnc: "base64" });
      } catch {
        throw new Error("RLE（打包式）：输入不是合法 hex（偶数长度 0-9a-f）或 base64。");
      }
    }
    if (bytes.length === 0) return "";
    if (bytes.length % 2 !== 0) throw new Error("RLE（打包式）：字节数为奇数——应为「计数,值」成对。");
    let out = "";
    for (let i = 0; i < bytes.length; i += 2) {
      const n = bytes[i], b = bytes[i + 1];
      if (n === 0) throw new Error(`RLE（打包式）：第 ${i / 2 + 1} 对计数值为 0（计数范围 1-255）。`);
      out += td([b]).repeat(n);
    }
    return out;
  }
  // 按码点切（emoji 等多字节字符不撕裂）；只剔换行（粘贴残留），空格/制表符是合法行程内容
  const t = [...String(text ?? "").replace(/[\r\n]+/g, "")];
  const isDigit = (ch) => ch >= "0" && ch <= "9";
  const out = [];
  const pushRun = (n, ch, where) => {
    if (n === 0) throw new Error(`RLE：${where}的计数为 0（行程长度至少为 1）。`);
    out.push(ch.repeat(n));
  };
  if (countMode === "fixed") {
    let i = 0, k = 0;
    while (i < t.length) {
      const num = t.slice(i, i + digits).join("");
      const ch = t[i + digits];
      if (fmt === "countFirst") {
        if (t.slice(i, i + digits).some((c) => !isDigit(c)) || t.length - i < digits)
          throw new Error(`RLE：第 ${k + 1} 段计数不是 ${digits} 位数字（在「${t.slice(i, i + digits + 1).join("")}」处——变长数据遇数字字符需定长计数）。`);
        if (ch === undefined) throw new Error(`RLE：第 ${k + 1} 段只有计数没有字符。`);
        pushRun(Number(num), ch, `第 ${k + 1} 段`);
        i += digits + 1; k++;
      } else {
        const ch2 = t[i];
        const cnt = t.slice(i + 1, i + 1 + digits);
        if (cnt.length < digits || cnt.some((c) => !isDigit(c)))
          throw new Error(`RLE：第 ${k + 1} 段（字符「${ch2}」）后不是 ${digits} 位数字。`);
        pushRun(Number(cnt.join("")), ch2, `第 ${k + 1} 段`);
        i += digits + 1; k++;
      }
    }
    return out.join("");
  }
  // 变长十进制
  let i = 0, k = 0;
  if (fmt === "countFirst") {
    while (i < t.length) {
      let j = i;
      while (j < t.length && isDigit(t[j])) j++;
      if (j === i) throw new Error(`RLE：第 ${k + 1} 段以非数字「${t[i]}」开头（计前式应为 数字+字符）。`);
      const ch = t[j];
      if (ch === undefined) throw new Error("RLE：末尾只有计数没有字符（流被截断？）。");
      if (isDigit(ch))
        throw new Error(`RLE：第 ${k + 1} 段有二义性——重复字符本身是数字。数字数据请改用定长计数或打包式。`);
      pushRun(Number(t.slice(i, j).join("")), ch, `第 ${k + 1} 段`);
      i = j + 1; k++;
    }
  } else {
    while (i < t.length) {
      const ch = t[i];
      if (isDigit(ch))
        throw new Error(`RLE：第 ${k + 1} 段（位置 ${i + 1}）以数字「${ch}」开头——计后式变长模式不能编码数字字符，请改用定长计数或打包式。`);
      let j = i + 1;
      while (j < t.length && isDigit(t[j])) j++;
      pushRun(j > i + 1 ? Number(t.slice(i + 1, j).join("")) : 1, ch, `第 ${k + 1} 段`); // 计后式允许省略 1（dCode 口径）
      i = j; k++;
    }
  }
  return out.join("");
}

register({
  id: "rle", cat: "forensic", name: "RLE 行程编码",
  desc: "游程编码：计前式 4A3B=AAAABB / 计后式 A4B3 / 打包式 count+value 字节对(hex)；变长或定长计数，双向",
  params: [
    { key: "fmt", label: "格式", type: "select", default: "countFirst",
      options: [
        { value: "countFirst", label: "计前式（4A3B = AAAABB）" },
        { value: "charFirst", label: "计后式（A4B3 = AAAABB，dCode 默认）" },
        { value: "packed", label: "打包式（hex：count+value 字节对）" },
      ] },
    { key: "countMode", label: "计数方式（文本两式生效）", type: "select", default: "var",
      options: [
        { value: "var", label: "变长十进制（4A / 12A）" },
        { value: "fixed", label: "定长 N 位（04A，支持数字字符）" },
      ] },
    { key: "fixedDigits", label: "定长位数 N（1-4）", type: "number", default: 2 },
    { key: "inputEnc", label: "输入编码（仅打包式解密）", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ] },
  ],
  encode: rleEncode,
  decode: rleDecode,
});

/* ================================================================
 * B4 标准 LZW lzw（GIF/TIFF 变体，≠ 既有 lzstring）
 * ================================================================ */
class BitWriter {
  constructor(lsb = false) { this.bytes = []; this.cur = 0; this.n = 0; this.lsb = lsb; }
  write(code, width) {
    if (this.lsb) {
      // GIF 式：码的低位先入字节（LSB-first）
      this.cur |= (code << this.n);
      this.n += width;
      while (this.n >= 8) { this.bytes.push(this.cur & 0xff); this.cur >>>= 8; this.n -= 8; }
    } else {
      // TIFF/常规式：高位先入（MSB-first）
      for (let i = width - 1; i >= 0; i--) {
        this.cur = (this.cur << 1) | ((code >>> i) & 1);
        this.n++;
        if (this.n === 8) { this.bytes.push(this.cur & 0xff); this.cur = 0; this.n = 0; }
      }
    }
  }
  finish() { if (this.n > 0) { this.bytes.push(this.lsb ? (this.cur & 0xff) : ((this.cur << (8 - this.n)) & 0xff)); this.cur = 0; this.n = 0; } return this.bytes; }
}
class BitReader {
  constructor(bytes, lsb = false) { this.b = bytes; this.i = 0; this.bit = 0; this.lsb = lsb; }
  read(width) {
    if ((this.i * 8 + this.bit + width) > this.b.length * 8) return null;
    let v = 0;
    for (let k = 0; k < width; k++) {
      const byte = this.b[this.i];
      if (byte === undefined) return null;
      const bit = (byte >>> (this.lsb ? this.bit : (7 - this.bit))) & 1;
      v = this.lsb ? (v | (bit << k)) : ((v << 1) | bit);
      this.bit++;
      if (this.bit === 8) { this.bit = 0; this.i++; }
    }
    return v;
  }
  readBit() { return this.read(1); }
  get bitsLeft() { return this.b.length * 8 - (this.i * 8 + this.bit); }
}

function bytesToStrDict(b) { let s = ""; for (const x of b) s += String.fromCharCode(x); return s; }

/** GIF 变宽 LZW 编码（LSB-first 打包——GIF 特有；码本满 2^maxWidth 发 clear 重置）。 */
function lzwEncodeGif(bytes, mcs, maxWidth) {
  const clear = 1 << mcs, eod = clear + 1;
  const w = new BitWriter(true);
  let width = mcs + 1;
  const newDict = () => {
    const d = new Map();
    for (let i = 0; i < (1 << mcs); i++) d.set(String.fromCharCode(i), i);
    return d;
  };
  let dict = newDict();
  let next = eod + 1;
  w.write(clear, width);
  if (bytes.length === 0) { w.write(eod, width); return w.finish(); }
  let cur = String.fromCharCode(bytes[0]);
  let pendingWiden = false; // 加宽延迟一码：解码器在处理下一码时才补登本条目并检宽（PIL 真流校准）
  for (let i = 1; i < bytes.length; i++) {
    const c = String.fromCharCode(bytes[i]);
    const nc = cur + c;
    if (dict.has(nc)) { cur = nc; continue; }
    w.write(dict.get(cur), width);
    if (next < (1 << maxWidth)) { // 还有空码才登记
      dict.set(nc, next);
      next++;
      if (pendingWiden) { width++; pendingWiden = false; }
      else if (width < maxWidth && next === (1 << width)) pendingWiden = true;
    } else {
      // 码本满（GIF 惯例：发 clear 重置，绝不分配 2^maxWidth 越界码）
      w.write(clear, width);
      dict = newDict();
      next = eod + 1;
      width = mcs + 1;
      pendingWiden = false;
    }
    cur = c;
  }
  w.write(dict.get(cur), width);
  w.write(eod, width);
  return w.finish();
}

/** 定长 N 位 LZW（无 clear/EOD；码本满即冻结）。 */
function lzwEncodeFixed(bytes, width) {
  const dict = new Map();
  for (let i = 0; i < 256; i++) dict.set(String.fromCharCode(i), i);
  let next = 256;
  const w = new BitWriter();
  if (bytes.length === 0) return w.finish();
  let cur = String.fromCharCode(bytes[0]);
  for (let i = 1; i < bytes.length; i++) {
    const c = String.fromCharCode(bytes[i]);
    const nc = cur + c;
    if (dict.has(nc)) { cur = nc; continue; }
    w.write(dict.get(cur), width);
    if (next < (1 << width)) dict.set(nc, next++);
    cur = c;
  }
  w.write(dict.get(cur), width);
  return w.finish();
}

/** GIF 变宽 LZW 解码；返回 { bytes, sawEod }。 */
function lzwDecodeGif(bytes, mcs, maxWidth) {
  const clear = 1 << mcs, eod = clear + 1;
  const r = new BitReader(bytes, true);
  let width = mcs + 1;
  let dict = null, next = 0;
  let prev = null;
  const out = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < (1 << mcs); i++) dict[i] = [i];
    dict.length = eod + 1; // clear/eod 槽位保留（dict.length == 下一可分配码，KwKwK 判断依赖）
    next = eod + 1;
    width = mcs + 1;
    prev = null;
  };
  reset();
  while (true) {
    const code = r.read(width);
    if (code === null) return { bytes: out, sawEod: false };
    if (code === clear) { reset(); continue; }
    if (code === eod) return { bytes: out, sawEod: true };
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length && prev) entry = prev.concat([prev[0]]); // KwKwK
    else throw new Error(`LZW：码 ${code} 超出码本（当前大小 ${dict.length}）——位宽/格式参数与编码时不一致。`);
    out.push(...entry);
    if (prev && next < (1 << maxWidth)) { // 码本满即停增（兼容「满后继续编不重置」的他厂流）
      dict[next++] = prev.concat([entry[0]]);
      if (next === (1 << width) && width < maxWidth) width++;
    }
    prev = entry;
  }
}

/** 定长 N 位 LZW 解码；返回 { bytes, sawEod }（sawEod 恒 false，流尽即止）。 */
function lzwDecodeFixed(bytes, width) {
  const r = new BitReader(bytes);
  const dict = [];
  for (let i = 0; i < 256; i++) dict[i] = [i];
  let next = 256;
  let prev = null;
  const out = [];
  while (true) {
    const code = r.read(width);
    if (code === null) break;
    let entry;
    if (code < dict.length) entry = dict[code];
    else if (code === dict.length && prev) entry = prev.concat([prev[0]]);
    else throw new Error(`LZW：码 ${code} 超出码本（当前大小 ${dict.length}）——定长位宽与编码时不一致。`);
    out.push(...entry);
    if (prev && next < (1 << width)) { dict[next++] = prev.concat([entry[0]]); }
    prev = entry;
  }
  return { bytes: out, sawEod: false };
}

const bytesToHexLower = (arr) => Array.from(arr, (x) => x.toString(16).padStart(2, "0")).join("");

function lzwEncode(text, p) {
  const mode = (p && p.mode) || "gif";
  const bytes = te(String(text ?? ""));
  if (mode === "fixed") {
    const width = Math.max(9, Math.min(16, Number((p && p.fixedBits) || 12) | 0));
    return bytesToHexLower(lzwEncodeFixed(bytes, width));
  }
  const mcs = Math.max(2, Math.min(8, Number((p && p.minCodeSize) || 8) | 0));
  const maxWidth = Math.max(mcs + 1, Math.min(16, Number((p && p.maxWidth) || 12) | 0));
  for (const b of bytes)
    if (b >= (1 << mcs))
      throw new Error(`LZW：输入含字节 ${b}，超出 minCodeSize=${mcs} 的字母表（0-${(1 << mcs) - 1}）。`);
  return bytesToHexLower(lzwEncodeGif(bytes, mcs, maxWidth));
}

function lzwDecode(text, p) {
  const mode = (p && p.mode) || "gif";
  let bytes;
  try {
    bytes = inputToBytes(text, p);
  } catch {
    throw new Error("LZW：输入不是合法 hex/base64（应为编码输出的 hex 位流）。");
  }
  let res;
  if (mode === "fixed") {
    const width = Math.max(9, Math.min(16, Number((p && p.fixedBits) || 12) | 0));
    res = lzwDecodeFixed(bytes, width);
  } else {
    const mcs = Math.max(2, Math.min(8, Number((p && p.minCodeSize) || 8) | 0));
    const maxWidth = Math.max(mcs + 1, Math.min(16, Number((p && p.maxWidth) || 12) | 0));
    res = lzwDecodeGif(bytes, mcs, maxWidth);
    if (!res.sawEod) throw new Error("LZW：位流在 EOD 码之前耗尽（数据被截断或位宽参数不符）。");
  }
  return td(res.bytes);
}

register({
  id: "lzw", cat: "forensic", name: "标准 LZW（GIF/TIFF）",
  desc: "经典变长码本 LZW（GIF 档：LSB-first 位流、初始 256 项字节字典、clear 256 / EOD 257、9→12 位变宽；定长档：MSB-first 定长 N 位，hex 呈现）。≠ 既有 LZString op（JS 库变体，不等价）",
  params: [
    { key: "mode", label: "模式", type: "select", default: "gif",
      options: [
        { value: "gif", label: "GIF 变宽（clear/EOD，9→12 位）" },
        { value: "fixed", label: "定长 N 位（无 clear/EOD）" },
      ] },
    { key: "maxWidth", label: "位宽上限（GIF 式，默认 12）", type: "number", default: 12 },
    { key: "minCodeSize", label: "minCodeSize（2-8，GIF 数据段用，默认 8）", type: "number", default: 8 },
    { key: "fixedBits", label: "定长位宽 N（9-16，定长档用）", type: "number", default: 12 },
    { key: "inputEnc", label: "输入编码（解密）", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ] },
  ],
  encode: lzwEncode,
  decode: lzwDecode,
});

/* ================================================================
 * B5 Elias Gamma / Delta elias
 * ================================================================ */
function eliasGammaCode(x) {
  let N = 0;
  while ((1 << (N + 1)) <= x) N++;
  const bin = x.toString(2);
  return "0".repeat(N) + bin;
}
function eliasDeltaCode(x) {
  let N = 0;
  while ((1 << (N + 1)) <= x) N++;
  return eliasGammaCode(N + 1) + x.toString(2).slice(1);
}
function parseEliasNumbers(text) {
  const parts = String(text ?? "").split(/[\s,;，；、]+/).filter(Boolean);
  const nums = [];
  for (const s of parts) {
    if (!/^\d+$/.test(s)) throw new Error(`Elias：「${s}」不是非负整数（只支持 ≥1 的正整数）。`);
    const n = Number(s);
    if (n < 1) throw new Error("Elias：只支持正整数（≥1）；0 与负数无法编码（可先 +1 偏移）。");
    nums.push(n);
  }
  if (!nums.length) throw new Error("Elias：输入为空（应为一组正整数，空格或逗号分隔）。");
  return nums;
}

function eliasEncode(text, p) {
  const mode = (p && p.mode) || "gamma";
  const sep = p && p.sep === "space" ? " " : "";
  const nums = parseEliasNumbers(text);
  if (nums.some((n) => n > Number.MAX_SAFE_INTEGER)) throw new Error("Elias：数值超出安全整数范围。");
  return nums.map((n) => (mode === "delta" ? eliasDeltaCode(n) : eliasGammaCode(n))).join(sep);
}

function eliasDecode(text, p) {
  const mode = (p && p.mode) || "gamma";
  const bits = String(text ?? "").replace(/[\s,;，；、]+/g, "");
  if (!/^[01]*$/.test(bits)) throw new Error("Elias：位流含非 0/1 字符。");
  if (!bits.length) throw new Error("Elias：位流为空。");
  const out = [];
  let i = 0;
  const readGammaPrefix = () => {
    let zeros = 0;
    while (i < bits.length && bits[i] === "0") { zeros++; i++; }
    if (i >= bits.length) throw new Error(`Elias：位流在第 ${i} 位被截断（一元前缀没有结束的 1）。`);
    i++; // 跳过结束的 1
    return zeros;
  };
  const readBits = (n, what) => {
    if (i + n > bits.length) throw new Error(`Elias：位流在第 ${i} 位被截断（${what}需要 ${n} 位）。`);
    const s = bits.slice(i, i + n);
    i += n;
    return s;
  };
  while (i < bits.length) {
    let x;
    if (mode === "gamma") {
      const N = readGammaPrefix();
      if (N === 0) x = 1;
      else x = parseInt("1" + readBits(N, "数值尾段"), 2);
    } else {
      const Np1 = (() => {
        const N = readGammaPrefix();
        if (N === 0) return 1;
        return parseInt("1" + readBits(N, "gamma 数值尾段"), 2);
      })();
      const N = Np1 - 1;
      if (N === 0) x = 1;
      else x = parseInt("1" + readBits(N, "数值尾段"), 2);
    }
    out.push(x);
  }
  return out.join(" ");
}

register({
  id: "elias", cat: "forensic", name: "Elias Gamma/Delta 编码",
  desc: " universal 前缀码：gamma = ⌊log₂x⌋ 个 0 + 二进制原码；delta = gamma(⌊log₂x⌋+1) + 尾段。正整数 ↔ 位串双向",
  params: [
    { key: "mode", label: "编码族", type: "select", default: "gamma",
      options: [
        { value: "gamma", label: "Elias gamma（γ）" },
        { value: "delta", label: "Elias delta（δ）" },
      ] },
    { key: "sep", label: "输出分隔（编码）", type: "select", default: "none",
      options: [
        { value: "none", label: "不分隔（紧贴位串，标准形态）" },
        { value: "space", label: "每码一空格（易读，解密也接受）" },
      ] },
  ],
  encode: eliasEncode,
  decode: eliasDecode,
});

/* ================================================================
 * B6 Verhoeff 校验 verhoeff
 * ================================================================ */
const VERHOEFF_D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const VERHOEFF_P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
const VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

/** Verhoeff 校验值 c（右起处理；返回 0 即校验通过）。 */
function verhoeffChecksum(digits) {
  let c = 0;
  const ds = String(digits);
  const len = ds.length;
  for (let i = 0; i < len; i++) {
    const n = Number(ds[len - 1 - i]); // n0 = 最右位
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][n]];
  }
  return c;
}

function verhoeffDigits(text) {
  const t = String(text ?? "").replace(/[\s\-._]/g, "");
  if (!t) throw new Error("Verhoeff：输入为空（应为数字串，可含空格/连字符分隔）。");
  if (!/^\d+$/.test(t)) {
    const bad = [...t].find((ch) => !/\d/.test(ch));
    throw new Error(`Verhoeff：输入含非数字字符「${bad}」（仅数字与分隔符允许）。`);
  }
  return t;
}

function verhoeffRun(text, p) {
  const mode = (p && p.mode) || "validate";
  const t = verhoeffDigits(text);
  // generate 口径（Wikipedia）：末尾补 0 占位跑校验循环（其余数位因此平移一位），校验位 = inv(c)。
  const expectedDigit = (bare) => VERHOEFF_INV[verhoeffChecksum(bare + "0")];
  if (mode === "generate") {
    const check = expectedDigit(t);
    return t + check;
  }
  if (mode === "strip") {
    if (t.length < 2) throw new Error("Verhoeff（去校验位）：至少要 2 位数字。");
    const c = verhoeffChecksum(t);
    if (c !== 0)
      throw new Error(`Verhoeff：${t} 校验失败（c=${c}，末位应为 ${expectedDigit(t.slice(0, -1))}）——不是合法 Verhoeff 序列，拒绝去位。`);
    return t.slice(0, -1);
  }
  // validate
  const c = verhoeffChecksum(t);
  if (c === 0) {
    const bare = t.slice(0, -1);
    return `${t} → Verhoeff 校验通过 ✓（${bare.length} 位数据 + 校验位 ${t.slice(-1)}）`;
  }
  return `${t} → Verhoeff 校验失败 ✗（校验值 c=${c} ≠ 0；若前 ${t.length - 1} 位正确，校验位应为 ${expectedDigit(t.slice(0, -1))}）`;
}

register({
  id: "verhoeff", cat: "hash", name: "Verhoeff 校验",
  desc: "二面体群 D₅ 五阶校验位算法（d 乘法表 + p 置换表 + inv 逆表）：validate 校验 / generate 算校验位 / strip 去校验位；捕获全部单字错误与大多数换位错误",
  params: [
    { key: "mode", label: "模式", type: "select", default: "validate",
      options: [
        { value: "validate", label: "validate：校验（输出通过/失败）" },
        { value: "generate", label: "generate：计算并追加校验位" },
        { value: "strip", label: "strip：校验通过后去掉校验位" },
      ] },
  ],
  run: verhoeffRun,
});

/* ================================================================
 * E7 LZ4 解压 lz4Dec
 * ================================================================ */
const rotl = (x, r) => ((x << r) | (x >>> (32 - r))) >>> 0;
const XXH_PRIME1 = 2654435761, XXH_PRIME2 = 2246822519, XXH_PRIME3 = 3266489917,
  XXH_PRIME4 = 668265263, XXH_PRIME5 = 374761393;

/** xxHash32（seed 0 为主；LZ4 帧校验用），语义按 xxHash 规范自研。 */
function xxh32(bytes, seed = 0) {
  const u32 = (i) => (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] * 0x1000000)) >>> 0;
  let h, i = 0;
  const len = bytes.length;
  if (len >= 16) {
    let v1 = (seed + XXH_PRIME1 + XXH_PRIME2) >>> 0;
    let v2 = (seed + XXH_PRIME2) >>> 0;
    let v3 = seed >>> 0;
    let v4 = (seed - XXH_PRIME1) >>> 0;
    const limit = len - 16;
    while (i <= limit) {
      v1 = Math.imul(rotl((v1 + Math.imul(u32(i), XXH_PRIME2)) >>> 0, 13), XXH_PRIME1) >>> 0;
      v2 = Math.imul(rotl((v2 + Math.imul(u32(i + 4), XXH_PRIME2)) >>> 0, 13), XXH_PRIME1) >>> 0;
      v3 = Math.imul(rotl((v3 + Math.imul(u32(i + 8), XXH_PRIME2)) >>> 0, 13), XXH_PRIME1) >>> 0;
      v4 = Math.imul(rotl((v4 + Math.imul(u32(i + 12), XXH_PRIME2)) >>> 0, 13), XXH_PRIME1) >>> 0;
      i += 16;
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h = (seed + XXH_PRIME5) >>> 0;
  }
  h = (h + len) >>> 0;
  while (i + 4 <= len) {
    h = Math.imul(rotl((h + Math.imul(u32(i), XXH_PRIME3)) >>> 0, 17), XXH_PRIME4) >>> 0;
    i += 4;
  }
  while (i < len) {
    h = Math.imul(rotl((h + Math.imul(bytes[i++], XXH_PRIME5)) >>> 0, 11), XXH_PRIME1) >>> 0;
  }
  h ^= h >>> 15;
  h = Math.imul(h, XXH_PRIME2) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, XXH_PRIME3) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * LZ4 块格式解压。outBase：已累积的历史输出（链接块字典）；out：本块输出数组。
 * 返回 out。末序列允许只含字面量（宽松口径，规范允许解码器容忍）。
 */
function lz4DecompressBlockInto(src, outBase, out, label) {
  let i = 0;
  const totalLen = () => outBase.length + out.length;
  const readAt = (idx) => (idx < outBase.length ? outBase[idx] : out[idx - outBase.length]);
  while (i < src.length) {
    const token = src[i++];
    let litLen = token >>> 4;
    if (litLen === 15) {
      let b;
      do { if (i >= src.length) throw new Error(`${label}：字面量长度续位越界（流被截断）。`); b = src[i++]; litLen += b; } while (b === 255);
    }
    for (let k = 0; k < litLen; k++) {
      if (i >= src.length) throw new Error(`${label}：字面量数据不足（声明 ${litLen} 字节，流被截断）。`);
      out.push(src[i++]);
    }
    if (i >= src.length) break; // 末序列：只有字面量
    if (i + 2 > src.length) throw new Error(`${label}：偏移字段不足 2 字节（流被截断）。`);
    const offset = src[i] | (src[i + 1] << 8);
    i += 2;
    if (offset === 0) throw new Error(`${label}：偏移为 0（非法，块已损坏）。`);
    let matchLen = token & 15;
    if (matchLen === 15) {
      let b;
      do { if (i >= src.length) throw new Error(`${label}：匹配长度续位越界（流被截断）。`); b = src[i++]; matchLen += b; } while (b === 255);
    }
    matchLen += 4;
    if (offset > totalLen()) throw new Error(`${label}：偏移 ${offset} 超出已有数据 ${totalLen()} 字节（独立块档请改自动/帧格式，或数据损坏）。`);
    const start = totalLen() - offset;
    for (let k = 0; k < matchLen; k++) out.push(readAt(start + k));
  }
  return out;
}

function lz4DecompressFrame(bytes) {
  if (bytes.length < 7) throw new Error("LZ4 帧：数据过短。");
  if (!((bytes[0] === 0x04) && (bytes[1] === 0x22) && (bytes[2] === 0x4D) && (bytes[3] === 0x18)))
    throw new Error("LZ4 帧：magic 不符（应为 04 22 4D 18 = 0x184D2204）。");
  let i = 4;
  const flg = bytes[i++];
  const bd = bytes[i++];
  const version = (flg >>> 6) & 3;
  if (version !== 1) throw new Error(`LZ4 帧：版本号 ${version}（仅支持 01）。`);
  const bIndep = ((flg >>> 5) & 1) === 1;
  const bCheck = ((flg >>> 4) & 1) === 1;
  const cSize = ((flg >>> 3) & 1) === 1;
  const cCheck = ((flg >>> 2) & 1) === 1;
  if (((flg >>> 1) & 1) !== 0) throw new Error("LZ4 帧：FLG 保留位非 0（非法帧）。");
  const hasDictId = (flg & 1) === 1;
  const bMax = (bd >>> 4) & 7;
  if (bMax < 4 || bMax > 7) throw new Error(`LZ4 帧：BD 块大小档 ${bMax} 非法（4-7）。`);
  let contentSize = -1;
  if (cSize) {
    if (i + 8 > bytes.length) throw new Error("LZ4 帧：内容长度字段不足 8 字节。");
    contentSize = 0;
    for (let k = 7; k >= 0; k--) contentSize = contentSize * 256 + bytes[i + k]; // LE → Number
    i += 8;
  }
  if (hasDictId) {
    if (i + 4 > bytes.length) throw new Error("LZ4 帧：Dict-ID 字段不足 4 字节。");
    i += 4;
    throw new Error("LZ4 帧：带外部字典（Dict-ID），本工具无字典数据无法解压。");
  }
  if (i + 1 > bytes.length) throw new Error("LZ4 帧：缺 HC 头校验字节。");
  const hc = bytes[i++];
  const wantHc = (xxh32(bytes.subarray(4, i - 1)) >>> 8) & 0xff;
  if (hc !== wantHc) throw new Error(`LZ4 帧：头校验 HC 不符（读到 ${hc.toString(16).padStart(2, "0")}，应为 ${wantHc.toString(16).padStart(2, "0")}）——帧头损坏。`);
  const out = [];
  const windowCap = 65536 + 4 * 1024 * 1024; // 链接块窗口上限（64KB 偏移 + 4MB 块）
  while (true) {
    if (i + 4 > bytes.length) throw new Error("LZ4 帧：块大小字段越界（流在块中截断）。");
    let bsz = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] * 0x1000000)) >>> 0;
    i += 4;
    if (bsz === 0) break; // EndMark
    const uncompressed = (bsz & 0x80000000) !== 0;
    bsz &= 0x7fffffff;
    if (i + bsz > bytes.length) throw new Error(`LZ4 帧：声明块大小 ${bsz} 越界（流被截断）。`);
    const data = bytes.subarray(i, i + bsz);
    i += bsz;
    if (bCheck) {
      if (i + 4 > bytes.length) throw new Error("LZ4 帧：块校验字段越界。");
      const want = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] * 0x1000000)) >>> 0;
      i += 4;
      const got = xxh32(data);
      if (got !== want) throw new Error(`LZ4 帧：块校验 xxh32 不符（读到 0x${want.toString(16)}，实算 0x${got.toString(16)}）——块损坏。`);
    }
    if (uncompressed) {
      for (const b of data) out.push(b);
    } else if (bIndep) {
      lz4DecompressBlockInto(data, [], out, "LZ4 帧");
    } else {
      const base = out.slice(Math.max(0, out.length - windowCap)); // 链接块：历史 64KB+ 窗口作字典
      lz4DecompressBlockInto(data, base, out, "LZ4 帧");
    }
  }
  if (cCheck) {
    if (i + 4 > bytes.length) throw new Error("LZ4 帧：内容校验字段越界。");
    const want = (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] * 0x1000000)) >>> 0;
    i += 4;
    const got = xxh32(out);
    if (got !== want) throw new Error(`LZ4 帧：内容校验 xxh32 不符（读到 0x${want.toString(16)}，实算 0x${got.toString(16)}）——数据损坏。`);
  }
  if (i < bytes.length) throw new Error(`LZ4 帧：EndMark 后仍有 ${bytes.length - i} 字节残留。`);
  if (contentSize >= 0 && contentSize !== out.length)
    throw new Error(`LZ4 帧：内容长度不符（帧头声明 ${contentSize}，实解 ${out.length} 字节）。`);
  return out;
}

/** 简易 LZ4 块压缩（测试工具：贪心最长匹配 + 规范末段约束），导出供对拍。 */
function lz4CompressBlock(bytes) {
  const out = [];
  const emitSeq = (literals, offset, matchLen) => {
    let litLen = literals.length;
    const token = (litLen >= 15 ? 15 : litLen) << 4 | ((matchLen || 0) >= 19 ? 15 : (matchLen ? matchLen - 4 : 0));
    out.push(token);
    if (litLen >= 15) { litLen -= 15; while (litLen >= 255) { out.push(255); litLen -= 255; } out.push(litLen); }
    for (const b of literals) out.push(b);
    if (matchLen) {
      out.push(offset & 0xff, (offset >>> 8) & 0xff);
      let ml = matchLen - 4;
      if (ml >= 15) { ml -= 15; while (ml >= 255) { out.push(255); ml -= 255; } out.push(ml); }
    }
  };
  let lit = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    // 末 12 字节内不开新匹配；末 5 字节恒为字面量（块格式规范）
    if (i + 12 >= n) break;
    let bestLen = 0, bestOff = 0;
    const maxOff = Math.min(65535, i);
    for (let off = 1; off <= maxOff; off++) {
      let l = 0;
      const pos = i - off;
      while (i + l < n - 5 && bytes[pos + (l % off)] === bytes[i + l] && l < 260) l++;
      if (l > bestLen) { bestLen = l; bestOff = off; }
    }
    if (bestLen >= 4 && bestLen >= 4) {
      emitSeq(lit, bestOff, bestLen);
      lit = [];
      i += bestLen;
    } else {
      lit.push(bytes[i]);
      i++;
    }
  }
  while (i < n) lit.push(bytes[i++]);
  emitSeq(lit, 0, 0);
  return out;
}

function lz4DecRun(text, p) {
  let bytes;
  try {
    bytes = inputToBytes(text, p);
  } catch {
    throw new Error("LZ4：输入不是合法 hex/base64。");
  }
  const fmt = (p && p.fmt) || "auto";
  let out;
  if (fmt === "block" || (fmt === "auto" && !(bytes[0] === 0x04 && bytes[1] === 0x22 && bytes[2] === 0x4D && bytes[3] === 0x18))) {
    if (bytes.length === 0) throw new Error("LZ4：输入为空。");
    out = lz4DecompressBlockInto(bytes, [], [], "LZ4 块");
  } else {
    out = lz4DecompressFrame(bytes);
  }
  const outU8 = new Uint8Array(out);
  const r = bytesToOutput(outU8);
  if (p && p.toFile && r.mode !== "text") {
    return {
      text: "(解压成功，结果为二进制 " + outU8.length + " 字节，已提供完整文件下载；hex 预览前 4096 字节)\n" + r.text,
      files: [{ name: "lz4-decompressed.bin", mime: "application/octet-stream", bytes: outU8 }],
    };
  }
  return r.mode === "text" ? r.text : "(解压成功，结果为二进制 " + outU8.length + " 字节，输出 hex)\n" + r.text;
}

register({
  id: "lz4Dec", cat: "forensic", name: "LZ4 解压",
  desc: "块格式（token 高 4 位字面量/低 4 位匹配 + 255 续位 + 2 字节小端偏移）与帧格式（magic 0x184D2204、xxh32 头/块/内容校验）解压；hex/base64 输入自动识别",
  params: [
    { key: "fmt", label: "格式", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（magic 判帧/块）" },
        { value: "block", label: "块格式（裸 block）" },
        { value: "frame", label: "帧格式（LZ4 Frame）" },
      ] },
    { key: "inputEnc", label: "输入编码", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ] },
    { key: "toFile", label: "二进制结果输出为文件", type: "bool", default: false },
  ],
  run: lz4DecRun,
});

/* ================================================================
 * E8 bzip2 解压 bzip2Dec
 * ================================================================ */
class MsbBitReader {
  constructor(bytes) { this.b = bytes; this.pos = 0; this.nbits = 0; }
  readBits(n) {
    // 乘法累加（≤48 位 magic 超出 int32，位左移会截断高位）
    let v = 0;
    for (let k = 0; k < n; k++) {
      if (this.pos >= this.b.length) throw new Error("bzip2：位流意外结束（数据被截断）。");
      v = v * 2 + ((this.b[this.pos] >>> (7 - this.nbits)) & 1);
      if (++this.nbits === 8) { this.nbits = 0; this.pos++; }
    }
    return v;
  }
  readBit() { return this.readBits(1); }
  alignByte() { if (this.nbits !== 0) { this.nbits = 0; this.pos++; } }
  get atEnd() { return this.pos >= this.b.length; }
}

const BZ2_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = (i << 24) >>> 0;
    for (let k = 0; k < 8; k++) c = (c & 0x80000000) !== 0 ? (((c << 1) >>> 0) ^ 0x04c11db7) >>> 0 : (c << 1) >>> 0;
    t[i] = c >>> 0;
  }
  return t;
})();
function bz2Crc(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = ((BZ2_CRC_TABLE[(c >>> 24) ^ b] ^ ((c << 8) >>> 0)) >>> 0);
  return (c ^ 0xffffffff) >>> 0;
}

/** 规范 Huffman（长度→符号升序分配码字；MSB-first 解码）。 */
class Bz2Huffman {
  constructor(lengths) {
    // lengths[sym] ∈ 1..20；超分派/空码校验
    const byLen = new Map();
    for (let s = 0; s < lengths.length; s++) {
      const L = lengths[s];
      if (L < 1 || L > 20) throw new Error(`bzip2：Huffman 码长 ${L} 越界（1-20）。`);
      if (!byLen.has(L)) byLen.set(L, []);
      byLen.get(L).push(s);
    }
    this.table = new Map(); // key = L * 2^24 + code
    let code = 0;
    const lens = [...byLen.keys()].sort((a, b) => a - b);
    let prevLen = 0;
    for (const L of lens) {
      code <<= L - prevLen;
      prevLen = L;
      for (const sym of byLen.get(L)) {
        this.table.set(L * 0x1000000 + code, sym);
        code++;
      }
      if (code > (1 << L)) throw new Error("bzip2：Huffman 码长超分派（非法表）。");
    }
  }
  decode(r) {
    let code = 0, len = 0;
    while (len < 20) {
      code = (code << 1) | r.readBit();
      len++;
      const sym = this.table.get(len * 0x1000000 + code);
      if (sym !== undefined) return sym;
    }
    throw new Error("bzip2：Huffman 解码越界（位流损坏或表不符）。");
  }
}

function bz2ReadBlock(r, blockSize) {
  const wantCrc = r.readBits(32) >>> 0;
  if (r.readBit() !== 0) throw new Error("bzip2：废弃的 randomized 档案（bit=1），本工具不支持。");
  const origPtr = r.readBits(24);
  // 符号位图（16×16 两级）
  const hi = r.readBits(16);
  const symbols = [];
  for (let range = 0; range < 16; range++) {
    if ((hi >>> (15 - range)) & 1) {
      const bits = r.readBits(16);
      for (let s = 0; s < 16; s++) if ((bits >>> (15 - s)) & 1) symbols.push(range * 16 + s);
    }
  }
  if (!symbols.length) throw new Error("bzip2：符号位图为空（无 EOB 符号，非法块）。");
  const numSymbols = symbols.length + 2; // + RUNA/RUNB；EOB = 最后一个
  const nTrees = r.readBits(3);
  if (nTrees < 2 || nTrees > 6) throw new Error(`bzip2：Huffman 树数 ${nTrees} 非法（2-6）。`);
  const nSelectors = r.readBits(15);
  if (nSelectors === 0) throw new Error("bzip2：选择子数为 0（非法块）。");
  const selectors = [];
  const treeMtf = [];
  for (let i = 0; i < nTrees; i++) treeMtf.push(i);
  for (let s = 0; s < nSelectors; s++) {
    let c = 0;
    while (r.readBit() === 1) {
      c++;
      if (c >= nTrees) throw new Error("bzip2：树选择子一元码越界。");
    }
    const [t] = treeMtf.splice(c, 1);
    treeMtf.unshift(t);
    selectors.push(t);
  }
  const trees = [];
  for (let t = 0; t < nTrees; t++) {
    const lengths = new Array(numSymbols).fill(0);
    let length = r.readBits(5);
    for (let j = 0; j < numSymbols; j++) {
      while (true) {
        if (length < 1 || length > 20) throw new Error(`bzip2：Huffman 码长 ${length} 越界（1-20）。`);
        if (r.readBit() === 0) break;
        length += r.readBit() === 1 ? -1 : 1;
      }
      lengths[j] = length;
    }
    trees.push(new Bz2Huffman(lengths));
  }
  // MTF + RUNA/RUNB + Huffman 符号循环
  const mtf = symbols.slice();
  let repeat = 0, repeatPower = 0;
  let decoded = 0, selectorIdx = 1; // 首组已由 selectors[0] 指定，换组从 selectors[1] 起
  let tree = trees[selectors[0]];
  const tt = new Uint32Array(blockSize);
  const c = new Uint32Array(256);
  let bufIndex = 0;
  const emit = (b) => {
    if (bufIndex >= blockSize) throw new Error("bzip2：数据超出块大小上限（块数据多于块大小声明，流已损坏）。");
    tt[bufIndex++] = b;
    c[b]++;
  };
  while (true) {
    if (decoded === 50) {
      if (selectorIdx >= nSelectors) throw new Error("bzip2：选择子不足（符号数超过 50×选择子数）。");
      tree = trees[selectors[selectorIdx++]];
      decoded = 0;
    }
    const v = tree.decode(r);
    decoded++;
    if (v < 2) { // RUNA=0 / RUNB=1（双基计数）
      if (repeat === 0) repeatPower = 1;
      const add = repeatPower * (v === 0 ? 1 : 2);
      repeat += add;
      repeatPower <<= 1;
      if (repeat > 2 * 1024 * 1024) throw new Error("bzip2：游程计数超 2M（非法块）。");
      continue;
    }
    if (repeat > 0) {
      // We have decoded a complete run-length so we need to
      // replicate the last output symbol.
      const front = mtf[0];
      for (let k = 0; k < repeat; k++) emit(front);
      repeat = 0;
    }
    if (v === numSymbols - 1) break; // EOB
    const idx = v - 1;
    const b = mtf[idx];
    mtf.splice(idx, 1);
    mtf.unshift(b);
    emit(b);
  }
  if (repeat > 0) throw new Error("bzip2：EOB 前游程未闭合（非法块）。");
  if (origPtr >= bufIndex) throw new Error("bzip2：origPtr 越界。");
  // 逆 BWT（Fenwick SRC-RR-124 §4.2 单数组法）
  let sum = 0;
  for (let i = 0; i < 256; i++) { sum += c[i]; c[i] = sum - c[i]; }
  for (let i = 0; i < bufIndex; i++) {
    const b = tt[i] & 0xff;
    tt[c[b]] = (tt[c[b]] & 0xff) | ((i << 8) >>> 0);
    c[b]++;
  }
  // 走链 + RLE1 尾游程解码（4 连同字节后跟一个计数字节）
  const out = [];
  let tPos = tt[origPtr] >>> 8;
  let lastByte = -1, byteRepeats = 0, repeats = 0;
  for (let used = 0; used < bufIndex; used++) {
    tPos = tt[tPos];
    const b = tPos & 0xff;
    tPos >>>= 8;
    if (byteRepeats === 3) {
      repeats = b;
      byteRepeats = 0;
      for (let k = 0; k < repeats; k++) out.push(lastByte);
      lastByte = -1;
      continue;
    }
    if (lastByte === b) byteRepeats++;
    else byteRepeats = 0;
    lastByte = b;
    out.push(b);
  }
  const gotCrc = bz2Crc(out);
  if (gotCrc !== wantCrc)
    throw new Error(`bzip2：块 CRC 不符（读到 0x${wantCrc.toString(16).padStart(8, "0")}，实算 0x${gotCrc.toString(16).padStart(8, "0")}）——数据损坏。`);
  return { out, wantCrc };
}

function bz2Decompress(bytes) {
  const r = new MsbBitReader(bytes);
  const readSetup = (needMagic) => {
    if (needMagic) {
      if (r.readBits(16) !== 0x425a) throw new Error("bzip2：缺 BZ magic（应以 hex 42 5a 68 开头）。");
    }
    if (r.readBits(8) !== 0x68) throw new Error("bzip2：版本字节非 'h'（仅 Huffman 版）。");
    const level = r.readBits(8);
    if (level < 0x31 || level > 0x39) throw new Error("bzip2：压缩级别字节非法（'1'-'9'）。");
    return 100000 * (level - 0x30);
  };
  let blockSize = readSetup(true);
  const outAll = [];
  let fileCrc = 0;
  while (true) {
    if (r.atEnd) throw new Error("bzip2：流在块 magic 前结束（缺尾 magic，数据被截断）。");
    const magic = r.readBits(48);
    if (magic === 0x314159265359) {
      const { out, wantCrc } = bz2ReadBlock(r, blockSize);
      for (const b of out) outAll.push(b);
      fileCrc = (((fileCrc << 1) | (fileCrc >>> 31)) ^ wantCrc) >>> 0;
    } else if (magic === 0x177245385090) {
      const want = r.readBits(32) >>> 0;
      if (want !== fileCrc)
        throw new Error(`bzip2：文件组合 CRC 不符（读到 0x${want.toString(16).padStart(8, "0")}，实算 0x${fileCrc.toString(16).padStart(8, "0")}）——数据损坏。`);
      r.alignByte();
      if (!r.atEnd) {
        // 级联流：允许 BZh 头紧随
        if (r.readBits(16) !== 0x425a) throw new Error("bzip2：尾 magic 后有残留数据（非级联 bzip2 流）。");
        blockSize = readSetup(false);
        fileCrc = 0;
        continue;
      }
      return outAll;
    } else {
      throw new Error(`bzip2：块 magic 非法（0x${magic.toString(16)}，应为 314159265359 或尾 177245385090）。`);
    }
  }
}

function bzip2DecRun(text, p) {
  let bytes;
  try {
    bytes = inputToBytes(text, p);
  } catch {
    throw new Error("bzip2：输入不是合法 hex/base64（应以 425a68… 即 BZh 开头）。");
  }
  if (bytes.length === 0) throw new Error("bzip2：输入为空。");
  const out = new Uint8Array(bz2Decompress(bytes));
  const r = bytesToOutput(out);
  if (p && p.toFile && r.mode !== "text") {
    return {
      text: "(解压成功，结果为二进制 " + out.length + " 字节，已提供完整文件下载；hex 预览前 4096 字节)\n" + r.text,
      files: [{ name: "bzip2-decompressed.bin", mime: "application/octet-stream", bytes: out }],
    };
  }
  return r.mode === "text" ? r.text : "(解压成功，结果为二进制 " + out.length + " 字节，输出 hex)\n" + r.text;
}

register({
  id: "bzip2Dec", cat: "forensic", name: "bzip2 解压",
  desc: "完整解压链：BZh 头 + π/√2 magic + Huffman(MTF+RUNA/RUNB) + BWT 逆变换 + RLE1 尾游程 + 块/文件 CRC 校验；纯 JS 自研，hex/base64 输入自动识别",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ] },
    { key: "toFile", label: "二进制结果输出为文件", type: "bool", default: false },
  ],
  run: bzip2DecRun,
});

/* 供测试/上层复用 */
export {
  rleEncode, rleDecode,
  lzwEncodeGif, lzwDecodeGif, lzwEncodeFixed, lzwDecodeFixed, lzwEncode, lzwDecode,
  eliasGammaCode, eliasDeltaCode, eliasEncode, eliasDecode,
  verhoeffChecksum, verhoeffRun,
  xxh32, lz4DecompressBlockInto, lz4DecompressFrame, lz4CompressBlock, lz4DecRun,
  bz2Crc, bz2Decompress, bzip2DecRun,
};
