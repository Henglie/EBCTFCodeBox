/*
 * binhex.js — Mac BinHex 4.0 编解码（text, 双向）。
 *
 * 算法照 BinHex 4.0 规范（Yves Lempereur）+ Python 标准库 binhex / binascii.crc_hqx
 * 参考实现，不编造：
 *
 * 文件结构（外层）：
 *   一行说明头 `(This file must be converted with BinHex 4.0)`，
 *   随后数据以 ':' 开始、以 ':' 结束，中间是 6-bit 编码（每行常 64 字符）。
 *
 * 6-bit 码表（64 字符，经过挑选避开易混淆/传输不安全字符）：
 *   !"#$%&'()*+,-012345689@ABCDEFGHIJKLMNPQRSTUVXYZ[`abcdefhijklmpqr
 *   （注意：数字缺 7，字母缺 O/W/g/n/o —— 这是 BinHex 4.0 的既定码表）
 *
 * 6-bit 解码后得到 RLE90 压缩流；RLE90（marker 0x90）：
 *   `<c> 0x90 <n>`：字节 c 重复 n 次（n=0 时 0x90 为字面量本身）。
 *
 * RLE90 解压后为二进制主体：
 *   [1]文件名长度 nl | [nl]文件名 | [1]版本(0) | [4]type | [4]creator | [2]flags
 *   | [4]数据叉长度 dlen | [4]资源叉长度 rlen | [2]头 CRC
 *   | [dlen]数据叉 | [2]数据叉 CRC | [rlen]资源叉 | [2]资源叉 CRC
 *   （所有多字节整数大端序）
 *
 * CRC：CRC-16-CCITT/XModem（poly 0x1021，init 0，无反射），即 binascii.crc_hqx。
 *   encode 存 crc_hqx(section,0)，decode 重算后直接比对（与 Python binhex 一致）。
 *
 * 本实现：
 *   decode —— 完整解析，提取文件名/type/creator/数据叉/资源叉，校验三处 CRC，
 *             数据叉可 UTF-8 解码则输出文本，否则输出 hex。
 *   encode —— 以输入 UTF-8 字节为数据叉、空资源叉，默认文件名，构造合规 BinHex 4.0。
 *
 * 红线：算法照 BinHex 4.0 规范 + Python binhex；纯本地零外发；core 层零 UI 依赖（仅 registry）。
 * 交付前跑 encode→decode 往返 + CRC 校验验证。
 *
 * 契约：register({ id:"binhex", cat:"text", name, desc, params, encode, decode })。
 */
import { register } from "./registry.js";

// ============================================================
// 6-bit 码表
// ============================================================
const B64 = "!\"#$%&'()*+,-012345689@ABCDEFGHIJKLMNPQRSTUVXYZ[`abcdefhijklmpqr";
if (B64.length !== 64) throw new Error("binhex 码表长度必须为 64");
const B64_REV = (() => {
  const m = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) m[B64.charCodeAt(i)] = i;
  return m;
})();

const te = (s) => new TextEncoder().encode(s);

// ============================================================
// CRC-16-CCITT / XModem（binascii.crc_hqx）
// ============================================================
function crcHqx(bytes, crc = 0) {
  for (const b of bytes) {
    crc ^= (b << 8);
    for (let i = 0; i < 8; i++) {
      if (crc & 0x8000) crc = ((crc << 1) ^ 0x1021);
      else crc = crc << 1;
      crc &= 0xffff;
    }
  }
  return crc & 0xffff;
}

// ============================================================
// RLE90 压缩 / 解压
// ============================================================
function rle90Encode(bytes) {
  const out = [];
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i];
    if (b === 0x90) {
      out.push(0x90, 0x00); // 0x90 字面量
      i++;
      continue;
    }
    let run = 1;
    while (i + run < n && bytes[i + run] === b && run < 255) run++;
    if (run >= 3) {
      out.push(b, 0x90, run); // b 重复 run 次
      i += run;
    } else {
      out.push(b);
      i++;
    }
  }
  return out;
}

function rle90Decode(bytes) {
  const out = [];
  let i = 0;
  let last = null;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i++];
    if (b === 0x90) {
      if (i >= n) break; // 尾部孤立 marker
      const cnt = bytes[i++];
      if (cnt === 0) {
        out.push(0x90);
        last = 0x90;
      } else if (last !== null) {
        for (let k = 1; k < cnt; k++) out.push(last); // 已输出 1 次，再补 cnt-1 次
      }
    } else {
      out.push(b);
      last = b;
    }
  }
  return out;
}

// ============================================================
// 6-bit 编 / 解码（连续位流，MSB 优先）
// ============================================================
function sixbitEncode(bytes) {
  let out = "";
  let acc = 0;
  let nbits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    nbits += 8;
    while (nbits >= 6) {
      nbits -= 6;
      out += B64[(acc >> nbits) & 0x3f];
    }
  }
  if (nbits > 0) {
    out += B64[(acc << (6 - nbits)) & 0x3f]; // 末组右补 0
  }
  return out;
}

function sixbitDecode(str) {
  const out = [];
  let acc = 0;
  let nbits = 0;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (code >= 128) continue;
    const v = B64_REV[code];
    if (v < 0) continue; // 忽略非码表字符（空白/换行）
    acc = (acc << 6) | v;
    nbits += 6;
    if (nbits >= 8) {
      nbits -= 8;
      out.push((acc >> nbits) & 0xff);
    }
  }
  return out; // 末尾 <8 位丢弃
}

// ============================================================
// 大端序整数读写
// ============================================================
function be32(bytes, off) {
  return ((bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3]) >>> 0;
}
function put32(arr, v) {
  arr.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}
function put16(arr, v) {
  arr.push((v >>> 8) & 0xff, v & 0xff);
}

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += (b & 0xff).toString(16).padStart(2, "0");
  return s;
}
function fourCC(bytes, off) {
  let s = "";
  for (let i = 0; i < 4; i++) {
    const c = bytes[off + i];
    s += (c >= 0x20 && c <= 0x7e) ? String.fromCharCode(c) : ".";
  }
  return s;
}

// 数据叉是否为可打印文本：无控制字节（除常见 \t\r\n）即视为文本
function looksPrintable(bytes) {
  if (bytes.length === 0) return false;
  for (const b of bytes) {
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b < 0x20) return false;
  }
  return true;
}

// ============================================================
// encode：文本 → BinHex 4.0
// ============================================================
function binhexEncode(text, p = {}) {
  const data = Array.from(te(text));
  let fname = (p && p.filename != null && String(p.filename).trim()) ? String(p.filename).trim() : "file.txt";
  const fnameBytes = Array.from(te(fname)).slice(0, 63); // 文件名长度 1 字节
  const type = te("TEXT"); // 4CC
  const creator = te("CTFB"); // 4CC
  const dlen = data.length;
  const rlen = 0;

  // 头 section（用于头 CRC）
  const header = [];
  header.push(fnameBytes.length);
  for (const b of fnameBytes) header.push(b);
  header.push(0x00); // 版本
  for (const b of type) header.push(b);
  for (const b of creator) header.push(b);
  put16(header, 0x0000); // flags
  put32(header, dlen);
  put32(header, rlen);
  const headerCrc = crcHqx(header, 0);
  const dataCrc = crcHqx(data, 0);
  const resCrc = crcHqx([], 0);

  // 完整二进制流
  const raw = [];
  for (const b of header) raw.push(b);
  put16(raw, headerCrc);
  for (const b of data) raw.push(b);
  put16(raw, dataCrc);
  // 资源叉为空
  put16(raw, resCrc);

  // RLE90 → 6bit → 分行
  const rle = rle90Encode(raw);
  const enc = sixbitEncode(rle);
  const lines = [];
  for (let i = 0; i < enc.length; i += 64) lines.push(enc.slice(i, i + 64));

  return "(This file must be converted with BinHex 4.0)\n\n:" + lines.join("\n") + ":";
}

// ============================================================
// decode：BinHex 4.0 → 文本 + 报告
// ============================================================
function binhexDecode(text) {
  const s = String(text == null ? "" : text);
  const start = s.indexOf(":");
  if (start < 0) throw new Error("未找到 BinHex 数据起始 ':'（应为 (This file must be converted with BinHex 4.0) 后以 ':' 开始）");
  const end = s.indexOf(":", start + 1);
  if (end < 0) throw new Error("未找到 BinHex 数据结束 ':'");
  const body = s.slice(start + 1, end);

  const rle = sixbitDecode(body);
  const raw = rle90Decode(rle);
  if (raw.length < 22) throw new Error(`BinHex 主体过短（解压后仅 ${raw.length} 字节，无法容纳文件头）`);

  let off = 0;
  const nl = raw[off++];
  if (off + nl > raw.length) throw new Error("文件名长度越界（数据可能损坏）");
  const nameBytes = raw.slice(off, off + nl);
  off += nl;
  const version = raw[off++];
  const type = fourCC(raw, off); off += 4;
  const creator = fourCC(raw, off); off += 4;
  const flags = (raw[off] << 8) | raw[off + 1]; off += 2;
  const dlen = be32(raw, off); off += 4;
  const rlen = be32(raw, off); off += 4;
  const storedHeaderCrc = (raw[off] << 8) | raw[off + 1]; off += 2;

  const headerSection = raw.slice(0, 1 + nl + 1 + 4 + 4 + 2 + 4 + 4);
  const headerCrcCalc = crcHqx(headerSection, 0);

  if (off + dlen + 2 > raw.length) throw new Error(`数据叉长度 ${dlen} 越界（可用 ${raw.length - off} 字节）`);
  const dataFork = raw.slice(off, off + dlen); off += dlen;
  const storedDataCrc = (raw[off] << 8) | raw[off + 1]; off += 2;
  const dataCrcCalc = crcHqx(dataFork, 0);

  let resFork = [];
  let storedResCrc = null, resCrcCalc = null;
  if (off + rlen + 2 <= raw.length) {
    resFork = raw.slice(off, off + rlen); off += rlen;
    storedResCrc = (raw[off] << 8) | raw[off + 1]; off += 2;
    resCrcCalc = crcHqx(resFork, 0);
  }

  const name = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(nameBytes));
  const crcMark = (stored, calc) => calc == null ? "（无）" : (stored === calc ? "✓ 匹配" : `✗ 不匹配 (存 0x${stored.toString(16).padStart(4, "0")} ≠ 算 0x${calc.toString(16).padStart(4, "0")})`);

  // 数据叉：能 UTF-8 解码为可打印文本则输出文本，否则 hex
  const dataStr = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(dataFork));
  const printable = looksPrintable(dataFork);

  const lines = [];
  lines.push("=== BinHex 4.0 解码 ===");
  lines.push(`文件名 = ${name}`);
  lines.push(`版本 = ${version}`);
  lines.push(`type = '${type}'  creator = '${creator}'  flags = 0x${flags.toString(16).padStart(4, "0")}`);
  lines.push(`数据叉长度 = ${dlen}  资源叉长度 = ${rlen}`);
  lines.push(`头 CRC     = ${crcMark(storedHeaderCrc, headerCrcCalc)}`);
  lines.push(`数据叉 CRC = ${crcMark(storedDataCrc, dataCrcCalc)}`);
  lines.push(`资源叉 CRC = ${crcMark(storedResCrc, resCrcCalc)}`);
  lines.push("");
  lines.push(`--- 数据叉内容（${printable ? "UTF-8 文本" : "十六进制"}）---`);
  lines.push(printable ? dataStr : bytesToHex(dataFork));
  if (rlen > 0) {
    lines.push("");
    lines.push(`--- 资源叉（hex，${rlen} 字节）---`);
    lines.push(bytesToHex(resFork));
  }
  return lines.join("\n");
}

register({
  id: "binhex",
  cat: "text",
  name: "BinHex 4.0 编 / 解码",
  desc: "Mac BinHex 4.0（Yves Lempereur 规范 + Python binhex）：6-bit 码表 + RLE90 压缩 + CRC-16-CCITT。decode 解析文件名/type/creator/数据叉/资源叉并校验三处 CRC；encode 把 UTF-8 文本封成合规 BinHex（数据叉，空资源叉）。",
  params: [
    { key: "filename", type: "text", label: "文件名（编码用）", default: "file.txt", placeholder: "写入 BinHex 头的文件名" },
  ],
  encode: binhexEncode,
  decode: binhexDecode,
});

export { binhexEncode, binhexDecode, crcHqx, rle90Encode, rle90Decode, sixbitEncode, sixbitDecode, B64 };
