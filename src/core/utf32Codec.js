/*
 * utf32Codec.js — UTF-32 LE/BE 编解码（含 BOM）。
 *
 * UTF-32：每个 Unicode 码位固定 4 字节。LE = 低位在前（x86 常见），BE = 高位在前
 * （网络/文件惯例）。BOM（字节序标记）：LE = FF FE 00 00，BE = 00 00 FE FF——
 * 注意与 UTF-16 的 BOM（FF FE / FE FF）区分：UTF-32 BOM 是 4 字节，前两字节与
 * UTF-16 同形，靠第 3/4 字节的 00 00 区分。
 *
 * 严格校验（本 op 与 TextDecoder 宽松模式的差异）：
 *   长度必须为 4 的倍数；每个 4 字节单元必须 ≤ 0x10FFFF 且不得落在
 *   D800-DFFF（代理区，UTF-32 不允许）；非法一律显式报错，不静默替换 U+FFFD。
 *   编码侧：JS 字符串按码位遍历，散置代理（未配对）显式报错。
 *
 * 对拍：Node ICU 不支持 utf-32 标签，验证脚本以 Python codecs（utf-32-le/be，
 * CPython 权威实现）四路对拍 + 官方边界码位（U+0000/U+0080/U+FFFF/U+10000/
 * U+10FFFF）结构自检。
 *
 * 红线：纯本地计算，零外发；不取随机字节。
 */

import { register } from "./registry.js";
import { decodeUtf8Lossless } from "./bytesIo.js";

const LE_BOM = [0xff, 0xfe, 0x00, 0x00];
const BE_BOM = [0x00, 0x00, 0xfe, 0xff];

function utf32Decode(bytes, endian) {
  if (bytes.length % 4 !== 0) {
    throw new Error(`UTF-32 解码失败（严格模式）：字节数 ${bytes.length} 不是 4 的倍数（UTF-32 每码位固定 4 字节）`);
  }
  const lsbFirst = endian === "le";
  const out = [];
  for (let i = 0; i < bytes.length; i += 4) {
    const cp = lsbFirst
      ? bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24) >>> 0
      : ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
    if (cp >= 0xd800 && cp <= 0xdfff) {
      throw new Error(`UTF-32 解码失败（严格模式，偏移 ${i}）：码位 U+${cp.toString(16).toUpperCase()} 落在代理区 D800-DFFF（UTF-32 不允许）`);
    }
    if (cp > 0x10ffff) {
      throw new Error(`UTF-32 解码失败（严格模式，偏移 ${i}）：码位 U+${cp.toString(16).toUpperCase()} 超出 Unicode 上限 10FFFF`);
    }
    out.push(cp);
  }
  let s = "";
  for (const cp of out) s += String.fromCodePoint(cp);
  return s;
}

function utf32Encode(text, endian) {
  const lsbFirst = endian === "le";
  const out = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0xd800 && cp <= 0xdfff) {
      throw new Error(`UTF-32 编码失败（严格模式）：输入含未配对代理 U+${cp.toString(16).toUpperCase()}（损坏文本）`);
    }
    if (lsbFirst) {
      out.push(cp & 0xff, (cp >>> 8) & 0xff, (cp >>> 16) & 0xff, (cp >>> 24) & 0xff);
    } else {
      out.push((cp >>> 24) & 0xff, (cp >>> 16) & 0xff, (cp >>> 8) & 0xff, cp & 0xff);
    }
  }
  return new Uint8Array(out);
}

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
  id: "utf32",
  cat: "text",
  name: "UTF-32 LE/BE",
  desc: "UTF-32 编解码（每码位固定 4 字节）：LE（FF FE 00 00 BOM，x86 常见）/ BE（00 00 FE FF BOM）。解码自动识别 BOM，无 BOM 按所选端序；严格模式——长度非 4 倍数、代理区 D800-DFFF、超 0x10FFFF 显式报错（不静默 U+FFFD）。与 UTF-16 BOM 的区分靠第 3/4 字节 00 00",
  params: [
    { key: "dir", label: "方向", type: "select", default: "encode", options: [
      { value: "encode", label: "编码（文本 → UTF-32 字节 hex）" },
      { value: "decode", label: "解码（UTF-32 字节 hex → 文本）" },
    ] },
    { key: "endian", label: "端序", type: "select", default: "le", options: [
      { value: "le", label: "LE（小端，FF FE 00 00）" },
      { value: "be", label: "BE（大端，00 00 FE FF）" },
    ] },
    { key: "bom", label: "BOM", type: "select", default: "none", options: [
      { value: "none", label: "编码不加 BOM" },
      { value: "add", label: "编码加 BOM（解码遇 BOM 自动识别并去除）" },
    ] },
  ],
  run: (text, p) => {
    const dir = (p && p.dir) || "encode";
    const endian = (p && p.endian) === "be" ? "be" : "le";
    const withBom = (p && p.bom) === "add";
    if (dir === "decode") {
      const raw = p && p.rawBytes;
      let bytes = raw || hexToBytes(text, "UTF-32 字节 hex");
      let endianUsed = endian;
      let bomSeen = "无";
      if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) {
        endianUsed = "le"; bomSeen = "LE（FF FE 00 00）";
        bytes = bytes.subarray(4); // BOM 是字节序标记不是正文，检测到即剥
      } else if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff) {
        endianUsed = "be"; bomSeen = "BE（00 00 FE FF）";
        bytes = bytes.subarray(4);
      }
      const s = utf32Decode(bytes, endianUsed);
      return [
        `=== UTF-32 解码（严格模式）===`,
        `BOM：${bomSeen}；实际端序：${endianUsed.toUpperCase()}`,
        `文本：${s}`,
      ].join("\n");
    }
    const raw = p && p.rawBytes;
    let src = text;
    if (raw) {
      const loss = decodeUtf8Lossless(raw);
      if (!loss.ok) throw new Error("上游字节不是合法 UTF-8 文本，无法作为待编码内容。若要按 UTF-32 解读这批字节，请改用解码方向。");
      src = loss.text;
    }
    let bytes = utf32Encode(String(src ?? ""), endian);
    if (withBom) {
      const bom = new Uint8Array(endian === "le" ? LE_BOM : BE_BOM);
      const merged = new Uint8Array(bom.length + bytes.length);
      merged.set(bom, 0); merged.set(bytes, bom.length);
      bytes = merged;
    }
    return `=== UTF-32 编码（${endian.toUpperCase()}${withBom ? "，含 BOM" : ""}）===\n字节 hex（${bytes.length} 字节）：${bytesToHex(bytes)}`;
  },
});
