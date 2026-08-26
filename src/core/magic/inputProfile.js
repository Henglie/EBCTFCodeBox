/*
 * core/magic/inputProfile.js — 输入统计画像（18 维字节统计特征 + 字节化）
 *
 * 为「字节统计编码识别 CNN」一键解码提名模块（byteStatCnn.js）提供模型输入：
 *   ① 18 维统计特征（长度归一化 / 字符集占比 / 香农熵等，顺序固定）
 *   ② 前 128 + 后 128 字节（head/tail 截断）→ 256 长 byte id 序列（1 起偏移，0 为 pad）
 *
 * 口径约束（与模型训练端完全一致，改动会直接破坏数值对拍）：
 * - UTF-8 编码（TextEncoder，与训练端 errors="replace" 对齐：孤立代理项 → U+FFFD）
 * - 长度特征用 log1p(len) / log1p(4096)，封顶 1.5
 * - 熵按 log2 位数，最后 /8 归一
 * 纯函数、零依赖，主线程 / Worker / node 均可直接 import。
 */

/** 字节序列定长（模型输入窗口） */
export const MAX_BYTES = 256;
/** 字节 id 偏移：真实字节值 +1，0 留作 padding（pad 行在 embedding 中为全零） */
export const BYTE_OFFSET = 1;
/** 统计特征维度 */
export const NUM_STATS = 18;

const LOG1P_4096 = Math.log1p(4096);

// 字符集查表（256 位 0/1 表，比 Set 快得多）
function buildTable(pred) {
  const t = new Uint8Array(256);
  for (let b = 0; b < 256; b++) if (pred(b)) t[b] = 1;
  return t;
}

const T_UPPER = buildTable((b) => b >= 65 && b <= 90);        // A-Z
const T_LOWER = buildTable((b) => b >= 97 && b <= 122);       // a-z
const T_DIGIT = buildTable((b) => b >= 48 && b <= 57);        // 0-9
const T_WS = buildTable((b) => b === 9 || b === 10 || b === 11 || b === 12 || b === 13 || b === 32);
const T_PRINT = buildTable((b) => b >= 32 && b <= 126);       // 可打印 ASCII 0x20-0x7E
const T_B64_STD = buildTable((b) => (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || (b >= 48 && b <= 57) || b === 43 || b === 47 || b === 61); // + / =
const T_B64_URL = buildTable((b) => (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || (b >= 48 && b <= 57) || b === 45 || b === 95 || b === 61); // - _ =
const T_HEX = buildTable((b) => (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102)); // 0-9 a-f A-F

/** 文本 → UTF-8 字节数组 */
export function utf8Bytes(text) {
  return new TextEncoder().encode(String(text == null ? "" : text));
}

/**
 * 头尾截断：超长时保留前 maxBytes/2 字节 + 后 maxBytes/2 字节
 * （模型看「开头 + 结尾」，兼顾前缀签名（如 MZ/JSON）与结尾 padding 特征）。
 */
export function headTailTruncate(bytes, maxBytes = MAX_BYTES) {
  if (bytes.length <= maxBytes) return bytes;
  const head = maxBytes >> 1;
  const tail = maxBytes - head;
  const out = new Uint8Array(maxBytes);
  out.set(bytes.subarray(0, head), 0);
  out.set(bytes.subarray(bytes.length - tail), head);
  return out;
}

/**
 * 文本 → 定长 byte id 序列（Int32Array(MAX_BYTES)）。
 * 真实字节值 + BYTE_OFFSET(=1)，padding 全 0。与训练端 encode 完全一致。
 */
export function byteEncode(text, maxBytes = MAX_BYTES) {
  const bytes = headTailTruncate(utf8Bytes(text), maxBytes);
  const ids = new Int32Array(maxBytes);
  for (let i = 0; i < bytes.length; i++) ids[i] = bytes[i] + BYTE_OFFSET;
  return ids;
}

/** 香农熵（字节频率，log2 位/字节） */
function shannonEntropy(bytes) {
  if (bytes.length === 0) return 0;
  const freq = new Uint32Array(256);
  for (let i = 0; i < bytes.length; i++) freq[bytes[i]]++;
  let h = 0;
  for (let b = 0; b < 256; b++) {
    const p = freq[b] / bytes.length;
    if (p > 0) h -= p * Math.log2(p);
  }
  return h;
}

/**
 * 18 维统计特征（Float32Array(18)），顺序固定不可调换：
 *   0 归一化长度     log1p(len)/log1p(4096)，封顶 1.5
 *   1 长度余数       (len % 4) / 3
 *   2 大写占比       3 小写占比       4 数字占比
 *   5 空白占比       6 可打印占比     7 非 ASCII 占比
 *   8 base64 标准字母表（A-Za-z0-9+/=）占比
 *   9 base64url 字母表（A-Za-z0-9-_=）占比
 *  10 hex 字母表（0-9a-fA-F）占比
 *  11 '=' 12 '%' 13 '\' 14 '&' 15 '.' 16 ':' 各自占比
 *  17 香农熵 / 8
 * 空串：长度类特征按空串口径，其余全部为 0。
 */
export function statisticalFeatures(text) {
  const bytes = utf8Bytes(text);
  const f = new Float32Array(NUM_STATS);
  f[0] = Math.min(Math.log1p(bytes.length) / LOG1P_4096, 1.5);
  f[1] = (bytes.length % 4) / 3;
  if (bytes.length > 0) {
    const L = bytes.length;
    let upper = 0, lower = 0, digit = 0, ws = 0, pr = 0, nonAscii = 0;
    let b64s = 0, b64u = 0, hex = 0, eq = 0, pct = 0, bsl = 0, amp = 0, dot = 0, col = 0;
    for (let i = 0; i < L; i++) {
      const b = bytes[i];
      upper += T_UPPER[b]; lower += T_LOWER[b]; digit += T_DIGIT[b]; ws += T_WS[b]; pr += T_PRINT[b];
      if (b >= 128) nonAscii++;
      b64s += T_B64_STD[b]; b64u += T_B64_URL[b]; hex += T_HEX[b];
      if (b === 61) eq++;
      else if (b === 37) pct++;
      else if (b === 92) bsl++;
      else if (b === 38) amp++;
      else if (b === 46) dot++;
      else if (b === 58) col++;
    }
    f[2] = upper / L; f[3] = lower / L; f[4] = digit / L;
    f[5] = ws / L; f[6] = pr / L; f[7] = nonAscii / L;
    f[8] = b64s / L; f[9] = b64u / L; f[10] = hex / L;
    f[11] = eq / L; f[12] = pct / L; f[13] = bsl / L;
    f[14] = amp / L; f[15] = dot / L; f[16] = col / L;
    f[17] = shannonEntropy(bytes) / 8;
  }
  return f;
}
