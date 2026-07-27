/*
 * xiongyue.js — 熊曰（cat: 'cn'）。
 *
 * 熊曰编码算法。
 * 算法：UTF-8 → zlib.compress(level=1)[2:-4]（raw deflate）→ base91 数值编码（13/14bit 自适应）→ 91字熊语字典映射 → 反转 → 前缀 "熊曰：呋"。
 *
 * 依赖：浏览器原生 CompressionStream/DecompressionStream("deflate-raw")（异步）。
 * - encode 产生纯 raw deflate（等价 Python zlib.compress(data,1)[2:-4]）
 * - decode 用 DecompressionStream 解 raw deflate（等价 Python zlib.decompress(data,-15)）
 * - 浏览器压缩级别默认（无法指定 level=1），字节可能不同但解压互通。
 *
 * base91 数值算法（base91_encode_values/base91_decode_values）：
 * - encode 端 b 及时右移，位运算安全
 * - decode 端 n 可累积到 ~21 位，JS 32 位位运算会溢出，改用浮点（b += v*(2**n), Math.floor(b/256)）
 * - 判断 (v & 8191) > 88：Python 中 & 优先级高于 >，故 v & 8191 > 88 == (v & 8191) > 88，无歧义
 *
 * 单向依赖：import registry.js 的 register，底层不反向 import 上层。
 */
import { register } from "./registry.js";

const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(b);

// ============ 91 字熊语字典（xiongyue_dict，索引 0-90） ============
const XIONGYUE_DICT = [
  "食","性","很","雜","既","溫","和","會","誘","捕","動",
  "物","家","住","山","洞","沒","有","冬","眠","偶","爾","襲","擊","人","類",
  "呱","哞","嗄","哈","嘍","啽","唬","咯","呦","嗷","嗡","哮","嗥","嗒","嗚",
  "吖","吃","嗅","嘶","噔","咬","噗","嘿","嚁","噤","囑","非","常","喜","歡",
  "堅","果","魚","肉","蜂","蜜","註","取","象","發","達","你","覺","出","更",
  "盜","森","氏","我","誒","怎","寶","麼","圖","現","破","嚄","告","訴","樣",
  "呆","萌","笨","拙","意",
];
const REV_DICT = new Map();
for (let i = 0; i < XIONGYUE_DICT.length; i++) REV_DICT.set(XIONGYUE_DICT[i], i);

// ============ base91 数值编码（base91_encode_values） ============
// 输入字节流，输出 0-90 的值数组。encode 端 b 及时右移，位运算安全。
function base91EncodeValues(data) {
  let b = 0, n = 0;
  const out = [];
  for (let i = 0; i < data.length; i++) {
    b |= data[i] << n;
    n += 8;
    if (n > 13) {
      let v = b & 8191;
      if (v > 88) { b >>>= 13; n -= 13; }
      else { v = b & 16383; b >>>= 14; n -= 14; }
      out.push(v % 91);
      out.push(Math.floor(v / 91));
    }
  }
  if (n) {
    out.push(b % 91);
    if (n > 7 || b > 90) out.push(Math.floor(b / 91));
  }
  return out;
}

// ============ base91 数值解码（base91_decode_values，浮点避免溢出） ============
// 输入 0-90 的值数组，输出字节流。decode 端 n 累积到 ~21 位，JS 位运算溢出，用浮点。
function base91DecodeValues(vals) {
  let b = 0, n = 0, v = -1;
  const out = [];
  for (const val of vals) {
    if (v < 0) {
      v = val;
    } else {
      v += val * 91;
      b += v * (2 ** n);
      n += (v & 8191) > 88 ? 13 : 14;
      while (n > 7) {
        out.push(b & 0xff);
        b = Math.floor(b / 256);
        n -= 8;
      }
      v = -1;
    }
  }
  if (v !== -1) out.push((b + v * (2 ** n)) & 0xff);
  return new Uint8Array(out);
}

// ============ raw deflate 压缩/解压（CompressionStream，异步） ============
async function deflateRawCompress(bytes) {
  const cs = new CompressionStream("deflate-raw");
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function deflateRawDecompress(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

// ============ 熊曰 encode/decode ============
async function xiongyueEncode(text) {
  const plainBytes = te(text);
  const deflated = await deflateRawCompress(plainBytes);
  const b91vals = base91EncodeValues(deflated);
  const mapped = b91vals.map((v) => XIONGYUE_DICT[v]);
  mapped.reverse();
  return "熊曰：呋" + mapped.join("");
}

async function xiongyueDecode(text) {
  let s = text.trim();
  if (s.startsWith("熊曰：")) s = s.slice(3);
  else if (s.startsWith("熊曰:")) s = s.slice(3);
  if (s.length === 0 || s[0] !== "呋") throw new Error("缺失标头 '呋'");
  s = s.slice(1);
  const chars = [...s].reverse();
  const b91vals = [];
  for (const ch of chars) {
    const v = REV_DICT.get(ch);
    if (v === undefined) throw new Error("遇到未知的非法字符 -> '" + ch + "'");
    b91vals.push(v);
  }
  const deflated = base91DecodeValues(b91vals);
  let plainBytes;
  try {
    plainBytes = await deflateRawDecompress(deflated);
  } catch (e) {
    throw new Error("解压失败: 载荷损坏，请检查密文是否完整");
  }
  return td(plainBytes);
}

// ============ 注册 ============
register({
  id: "xiongyue",
  cat: "cn",
  name: "熊曰",
  desc: "zlib压缩+base91+熊语字典（前缀 熊曰：呋）",
  encode: xiongyueEncode,
  decode: xiongyueDecode,
  detect: (t) => {
    const s = t.trim();
    if (s.startsWith("熊曰：呋") || s.startsWith("熊曰:呋")) return 0.7;
    return 0;
  },
});

export { xiongyueEncode, xiongyueDecode, XIONGYUE_DICT, base91EncodeValues, base91DecodeValues };
