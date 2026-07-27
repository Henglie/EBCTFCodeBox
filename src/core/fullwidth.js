/*
 * fullwidth.js — 全角密码（cat:'text'）。
 * 半角 ASCII 可打印字符 (0x21-0x7E) ↔ 全角 (0xFF01-0xFF5E)，偏移 0xFEE0；
 * 半角空格 0x20 ↔ 全角空格 0x3000（特殊处理）。
 * 对齐同类实现「全角/半角互转」。自注册，往返可逆。
 */
import { register } from "./registry.js";

const OFFSET = 0xfee0;
const HALF_SPACE = 0x20;
const FULL_SPACE = 0x3000;

// 半角 → 全角
function fullwidthEncode(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === HALF_SPACE) {
      out += String.fromCharCode(FULL_SPACE);
    } else if (code >= 0x21 && code <= 0x7e) {
      out += String.fromCharCode(code + OFFSET);
    } else {
      out += ch;
    }
  }
  return out;
}

// 全角 → 半角
function fullwidthDecode(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code === FULL_SPACE) {
      out += " ";
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - OFFSET);
    } else {
      out += ch;
    }
  }
  return out;
}

// detect：命中大量全角字符（含全角空格）时给置信度
function fullwidthDetect(t) {
  const s = t.trim();
  if (!s) return 0;
  let full = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if ((code >= 0xff01 && code <= 0xff5e) || code === FULL_SPACE) full++;
  }
  const ratio = full / [...s].length;
  if (full >= 2 && ratio >= 0.5) return 0.6;
  return 0;
}

register({
  id: "fullwidth",
  cat: "text",
  name: "全角密码",
  desc: "ASCII 半角 ↔ 全角（含空格），偏移 0xFEE0",
  encode: fullwidthEncode,
  decode: fullwidthDecode,
  detect: fullwidthDetect,
});

export { fullwidthEncode, fullwidthDecode, fullwidthDetect };
