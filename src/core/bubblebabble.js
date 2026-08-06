/*
 * bubblebabble.js — BubbleBabble 编码（cat:'text'）。
 *
 * Antti Huima 2000 年设计的防误读编码（fingerprint 友好格式）：
 * 每 2 字节 → 6 字符（x 元音 辅音 元音 辅音-辅音 元音...），5 字符一组用 - 分隔，
 * 首尾 x 包裹。用于指纹/校验和的可读展示，防 OCR/抄写错误。
 *
 * 算法（与 bubblepy 开源实现一致，官方向量已验证）：
 * - vowels = "aeiouy", consonants = "bcdfghklmnprstvzx", padding = 'x'
 * - c 初始 1；每 2 字节 (byte1, byte2)：
 *   元音[((byte1>>6 & 3) + c) % 6] 辅音[(byte1>>2) & 15] 元音[((byte1 & 3) + c//6) % 6]
 *   辅音[(byte2>>4) & 15] '-' 辅音[byte2 & 15]
 *   c = (c*5 + byte1*7 + byte2) % 36
 * - 奇数尾字节：元音[c%6] + 辅音[16] + 元音[c//6]
 * - 空输入 → "xexax"
 *
 * 输入按 UTF-8 字节处理（CTF 常见字节流）。
 *
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 * 契约：register({ id:"bubblebabble", cat:"text", name, desc, encode, decode })。
 */
import { register } from "./registry.js";

const VOWELS = "aeiouy";
const CONSONANTS = "bcdfghklmnprstvzx";
const PADDING = "x";

function bubbleEncode(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let out = PADDING;
  let c = 1;
  for (let i = 0; i < bytes.length + 1; i += 2) {
    if (i >= bytes.length) {
      out += VOWELS[c % 6] + CONSONANTS[16] + VOWELS[Math.floor(c / 6)];
      break;
    }
    const byte1 = bytes[i];
    out += VOWELS[(((byte1 >> 6) & 3) + c) % 6];
    out += CONSONANTS[(byte1 >> 2) & 15];
    out += VOWELS[((byte1 & 3) + Math.floor(c / 6)) % 6];
    if (i + 1 >= bytes.length) break;
    const byte2 = bytes[i + 1];
    out += CONSONANTS[(byte2 >> 4) & 15];
    out += "-";
    out += CONSONANTS[byte2 & 15];
    c = (c * 5 + byte1 * 7 + byte2) % 36;
  }
  return out + PADDING;
}

function bubbleDecode(src) {
  const s = String(src || "").trim();
  if (s.length === 0) return "";
  if (s[0] !== PADDING || s[s.length - 1] !== PADDING) {
    throw new Error("BubbleBabble 密文须以 x 开头和结尾");
  }
  if (s.length !== 5 && s.length % 6 !== 5) {
    throw new Error("BubbleBabble 密文长度非法（应为 5 或 6n+5）");
  }
  const inner = s.slice(1, -1);
  const out = [];
  let c = 1;
  const chunks = [];
  for (let x = 0; x < inner.length; x += 6) chunks.push(inner.slice(x, x + 6));
  const lastIdx = chunks.length - 1;
  for (let k = 0; k < chunks.length; k++) {
    const tup = chunks[k];
    const v1 = VOWELS.indexOf(tup[0]);
    const c1 = CONSONANTS.indexOf(tup[1]);
    const v2 = VOWELS.indexOf(tup[2]);
    if (v1 === -1 || c1 === -1 || v2 === -1) throw new Error("BubbleBabble 密文含无效字符 @ " + (k * 6));
    if (k === lastIdx && tup[1] === CONSONANTS[16]) {
      // 尾块校验元组：元音[c%6] 辅音[16] 元音[c//6]
      if (v1 !== c % 6 || v2 !== Math.floor(c / 6)) {
        throw new Error("BubbleBabble 校验和不符 @ " + (k * 6));
      }
      break;
    }
    // 3-way 字节
    let high2 = (v1 - (c % 6) + 6) % 6;
    if (high2 >= 4) throw new Error("BubbleBabble 高位越界 @ " + (k * 6));
    if (c1 > 16) throw new Error("BubbleBabble 辅音越界 @ " + (k * 6 + 1));
    const mid4 = c1;
    let low2 = (v2 - (Math.floor(c / 6) % 6) + 6) % 6;
    if (low2 >= 4) throw new Error("BubbleBabble 低位越界 @ " + (k * 6 + 2));
    out.push((high2 << 6) | (mid4 << 2) | low2);
    // 第二字节
    if (tup.length >= 6) {
      const c2 = CONSONANTS.indexOf(tup[3]);
      const c3 = CONSONANTS.indexOf(tup[5]);
      if (c2 === -1 || c3 === -1) throw new Error("BubbleBabble 密文含无效字符 @ " + (k * 6 + 3));
      if (tup[4] !== "-") throw new Error("BubbleBabble 分隔符缺失 @ " + (k * 6 + 4));
      out.push((c2 << 4) | c3);
      const byte1 = out[out.length - 2];
      const byte2 = out[out.length - 1];
      c = (c * 5 + byte1 * 7 + byte2) % 36;
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(out));
}

register({
  id: "bubblebabble",
  cat: "text",
  name: "BubbleBabble 编码",
  desc: "Antti Huima 2000 防误读编码：2 字节 → 6 字符，x 包裹 + - 分隔（如 ping → xisak-nerek-loxix）。CTF 指纹/校验和可读展示用",
  encode: bubbleEncode,
  decode: bubbleDecode,
});

export { bubbleEncode, bubbleDecode };
