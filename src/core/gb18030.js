/*
 * gb18030.js — GB18030 严格编解码（含四字节区，替代 charset.js gb18030 档的静默回退）。
 *
 * 数据与算法：WHATWG Encoding Standard 官方索引（index-gb18030 / index-gb18030-ranges，
 * 数据文件 src/core/data/gb18030Data.js 由 WHATWG 官方 txt 生成，SHA256 固定）。
 * 浏览器 / Node TextDecoder("gb18030") 即按同一索引工作，本实现与其同源。
 *
 * 解码（字节→文本，严格模式）：
 *   0x00-0x7F 单字节；0x80 → U+20AC（spec 特步）；
 *   lead 0x81-0xFE：次字节 0x30-0x39 → 四字节（GB18030-2022 四字节区），
 *     pointer = ((b1-0x81)*10+(b2-0x30))*1260 + (b3-0x81)*10+(b4-0x30)，
 *     spec 边界：pointer ∈ (39419, 189000) 或 > 1237575 → 无映射（报错），
 *     pointer 7457 → U+E7C7，其余查 INDEX（≤23939）或 ranges 线性；
 *   其余两字节（trail 0x40-0xFE 除 0x7F）查 INDEX；非法序列显式报错。
 * 编码（文本→字节，WHATWG 语义）：
 *   ASCII 原样；U+E5E5 显式报错（spec：0xA3A0→U+3000 特例使其无法往返，是 GB18030
 *   编码器唯一必报错的码位）；18 条 PUA 非对称侧表（GB18030-2005 兼容）；两字节反表；
 *   四字节 ranges 线性（U+E7C7 → pointer 7457 特例）——GB180-30 覆盖除 U+E5E5 外
 *   全部 Unicode，不再像 charset.js gb18030 档那样对四字节区字符静默回退 UTF-8 字节。
 *
 * 与 charset.js 的关系：gbCharset 的 GBK/GB2312 档与解码侧（宿主 TextDecoder）
 * 行为完全保留；本 op 是独立严格版，fixes「四字节区字符编码静默回退 UTF-8」。
 * 已知差异：WHATWG 表与 CPython codecs 在个别条目不同（0xA3A0：WHATWG→U+3000，
 * CPython→U+E5E5），本实现按 WHATWG（与浏览器一致），对拍差异点在验证报告记录。
 *
 * 红线：纯本地计算，零外发；不取随机字节；不 import UI/DOM。
 */

import { register } from "./registry.js";
import { GB18030_INDEX, GB18030_RANGES } from "./data/gb18030Data.js";
import { decodeUtf8Lossless } from "./bytesIo.js";

// ---- cp → pointer 反查（两字节区）：首次调用构建，缓存 ----
let _cpToPtr = null;
function cpToPtrMap() {
  if (_cpToPtr) return _cpToPtr;
  const m = new Map();
  for (let p = 0; p < GB18030_INDEX.length; p++) {
    const cp = GB18030_INDEX[p];
    if (!m.has(cp)) m.set(cp, p); // 同 cp 多指针时取最小指针（WHATWG encoder 语义：index 首个匹配）
  }
  _cpToPtr = m;
  return m;
}

// ptr → 两字节（lead,trail）
function ptr2bytes(p) {
  const lead = 0x81 + (p / 190 | 0);
  let t = p % 190;
  const trail = t + 0x40 + (t >= 0x3F ? 1 : 0); // 跳过 0x7F：t=0x3F(63) 对应 trail 0x80
  return [lead, trail];
}
// 指针校验：t = p % 190；合法 trail = 0x40..0xFE 除 0x7F（t∈[0,0x3E]→0x40+t；t∈[0x3F,0xBE]→0x41+t）
// t 0..62 → 0x40..0x7E；t 63..189 → 0x80..0xFE。上面公式：t<63→t+0x40 ✓；t≥63→t+0x41 ✓（63→0x80）

// ---- 四字节区：ranges 查找（严格按 spec §index-gb18030-ranges 两个算法定义） ----
// decode：pointer ∈ (39419, 189000) 或 pointer > 1237575 → 无映射；pointer 7457 → U+E7C7；
//         其余线性（cp = cp_i + pointer − ptr_i）。
// encode：U+E7C7 → pointer 7457；其余纯线性（spec 无区间 gap 检查；cp > 0x10FFFF 不可能）。
function rangesCpForPointer(p) {
  if ((p > 39419 && p < 189000) || p > 1237575) return -1;
  if (p === 7457) return 0xE7C7;
  let lo = 0, hi = GB18030_RANGES.length - 1, i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (GB18030_RANGES[mid][0] <= p) { i = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (i < 0) return -1;
  return GB18030_RANGES[i][1] + (p - GB18030_RANGES[i][0]);
}
function rangesPointerForCp(cp) {
  if (cp === 0xE7C7) return 7457;
  let lo = 0, hi = GB18030_RANGES.length - 1, i = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (GB18030_RANGES[mid][1] <= cp) { i = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (i < 0) return -1;
  return GB18030_RANGES[i][0] + (cp - GB18030_RANGES[i][1]);
}
// spec §gb18030 encoder 的 18 条非对称侧表（PUA → 两字节；兼容 GB18030-2005）
const PUA_ENCODER_TABLE = new Map([
  [0xE78D, [0xA6, 0xD9]], [0xE78E, [0xA6, 0xDA]], [0xE78F, [0xA6, 0xDB]],
  [0xE790, [0xA6, 0xDC]], [0xE791, [0xA6, 0xDD]], [0xE792, [0xA6, 0xDE]],
  [0xE793, [0xA6, 0xDF]], [0xE794, [0xA6, 0xEC]], [0xE795, [0xA6, 0xED]],
  [0xE796, [0xA6, 0xF3]], [0xE81E, [0xFE, 0x59]], [0xE826, [0xFE, 0x61]],
  [0xE82B, [0xFE, 0x66]], [0xE82C, [0xFE, 0x67]], [0xE832, [0xFE, 0x6D]],
  [0xE843, [0xFE, 0x7E]], [0xE854, [0xFE, 0x90]], [0xE864, [0xFE, 0xA0]],
]);
function ptr4bytes(p) {
  const b1 = 0x81 + (p / 12600 | 0);
  const buf = p % 12600;
  const b2 = 0x30 + (buf / 1260 | 0);
  const b3 = 0x81 + (buf % 1260 / 10 | 0);
  const b4 = 0x30 + buf % 10;
  return [b1, b2, b3, b4];
}

// ---- 解码（严格） ----
function decodeStrict(bytes) {
  const out = [];
  let i = 0;
  const n = bytes.length;
  const err = (msg) => { throw new Error(`GB18030 解码失败（严格模式，偏移 ${i}）：${msg}`); };
  while (i < n) {
    const b = bytes[i];
    if (b <= 0x7F) { out.push(b); i++; continue; }
    if (b === 0x80) { out.push(0x20AC); i++; continue; } // spec 特步：0x80 → €
    if (b < 0x81 || b > 0xFE) err(`字节 0x${b.toString(16)} 不是合法首字节（GB18030 首字节 0x00-0x7F/0x80/0x81-0xFE）`);
    if (i + 1 >= n) err(`首字节 0x${b.toString(16)} 后缺续字节（截断）`);
    const b2 = bytes[i + 1];
    if (b2 >= 0x30 && b2 <= 0x39) {
      // 四字节
      if (i + 3 >= n) err("四字节序列被截断");
      const b3 = bytes[i + 2], b4 = bytes[i + 3];
      if (b3 < 0x81 || b3 > 0xFE) err(`四字节第 3 字节 0x${b3.toString(16)} 越界（须 0x81-0xFE）`);
      if (b4 < 0x30 || b4 > 0x39) err(`四字节第 4 字节 0x${b4.toString(16)} 越界（须 0x30-0x39）`);
      const p = ((b - 0x81) * 10 + (b2 - 0x30)) * 1260 + (b3 - 0x81) * 10 + (b4 - 0x30);
      let cp;
      if (p <= 23939) { cp = GB18030_INDEX[p]; if (!cp) err(`四字节指针 ${p} 在两字节表中无映射`); }
      else { cp = rangesCpForPointer(p); if (cp < 0) err(`四字节指针 ${p} 不在 GB18030 ranges 定义域内`); }
      if (cp >= 0x10000) out.push(0xD800 + ((cp - 0x10000) >> 10), 0xDC00 + ((cp - 0x10000) & 0x3FF));
      else out.push(cp);
      i += 4;
    } else if (b2 >= 0x40 && b2 <= 0xFE && b2 !== 0x7F) {
      // 两字节
      const p = (b - 0x81) * 190 + (b2 - 0x40) - (b2 > 0x7F ? 1 : 0);
      const cp = GB18030_INDEX[p];
      if (!cp) err(`两字节序列 0x${b.toString(16)}${b2.toString(16)}（指针 ${p}）无映射`);
      out.push(cp);
      i += 2;
    } else {
      err(`续字节 0x${b2.toString(16)} 越界（两字节区须 0x40-0xFE 除 0x7F；四字节区第 2 字节须 0x30-0x39）`);
    }
  }
  let s = "";
  for (let j = 0; j < out.length; j += 0x8000) s += String.fromCharCode(...out.slice(j, j + 0x8000));
  return s;
}

// ---- 编码（严格） ----
function encodeStrict(text) {
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp <= 0x7F) { out.push(cp); continue; }
    if (cp >= 0xD800 && cp <= 0xDFFF) {
      throw new Error(`字符为未配对代理 U+${cp.toString(16).toUpperCase()}（损坏文本），无法编码为 GB18030`);
    }
    if (cp === 0xE5E5) {
      throw new Error("字符 U+E5E5 不在 GB18030 编码范围（WHATWG 规定：0xA3A0 已映射为 U+3000，U+E5E5 无法往返，编码器对其报错）");
    }
    const side = PUA_ENCODER_TABLE.get(cp);
    if (side) { out.push(...side); continue; }
    const p2 = cpToPtrMap().get(cp);
    if (p2 !== undefined) { out.push(...ptr2bytes(p2)); continue; }
    const p4 = rangesPointerForCp(cp);
    if (p4 >= 0) { out.push(...ptr4bytes(p4)); continue; }
    throw new Error(
      `字符 "${ch}" (U+${cp.toString(16).toUpperCase().padStart(4, "0")}) 不在 GB18030 编码范围（` +
      `本 op 为严格模式，不静默回退 UTF-8）`
    );
  }
  return new Uint8Array(out);
}

// ---- hex/bytes 通道（与 charset.js 同口径） ----
function hexToBytes(hex, label = "输入") {
  const s = String(hex == null ? "" : hex).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!s) throw new Error(`缺少 ${label}（hex 字节串）`);
  if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error(`${label} 非法：须为偶数个 hex 字符`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }

register({
  id: "gb18030",
  cat: "text",
  name: "GB18030 严格版（含四字节）",
  desc: "GB18030 严格编解码（WHATWG Encoding 官方索引同源，与浏览器/Node TextDecoder 一致）：完整覆盖四字节区（生僻汉字、emoji、增补平面线性区），编码仅 U+E5E5 与未配对代理显式报错（spec 唯一例外），不再静默回退 UTF-8 字节；解码非法序列/截断/越界指针显式报错而非 U+FFFD。GBK/GB2312 档请用「GBK / GB2312 / GB18030」op。字节序：GB18030 为变长字节编码无端序；0x80 单字节=欧元符",
  params: [
    { key: "dir", label: "方向", type: "select", default: "encode", options: [
      { value: "encode", label: "编码（文本 → GB18030 字节 hex）" },
      { value: "decode", label: "解码（GB18030 字节 hex → 文本）" },
    ] },
  ],
  run: (text, p) => {
    const dir = (p && p.dir) || "encode";
    if (dir === "decode") {
      const raw = p && p.rawBytes;
      const bytes = raw || hexToBytes(text, "GB18030 字节 hex");
      const s = decodeStrict(bytes);
      return `=== GB18030 解码（严格模式，${bytes.length} 字节）===\n文本：${s}`;
    }
    const raw = p && p.rawBytes;
    let src = text;
    if (raw) {
      const loss = decodeUtf8Lossless(raw);
      if (!loss.ok) throw new Error("上游字节不是合法 UTF-8 文本，无法作为待编码内容。若要按 GB18030 解读这批字节，请改用解码方向。");
      src = loss.text;
    }
    const bytes = encodeStrict(String(src ?? ""));
    return `=== GB18030 编码（严格模式，含四字节区）===\n字节 hex（${bytes.length} 字节）：${bytesToHex(bytes)}`;
  },
});
