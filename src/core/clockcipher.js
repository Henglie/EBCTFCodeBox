/*
 * clockcipher.js — 表盘码 / 时钟码（cat:'fancy'，双向）。
 *
 * 通用时钟码实现（CTF 花式常见，通用可逆版本，非对齐特定工具具体变体）。
 *
 * 编码规则（自定义，可逆）：
 * 12 小时制表盘 + 5 分钟刻度（分针位置 0/5/10/.../55，共 12 个刻度）。
 * 每个字符用 "H:MM" 表示（H=1-12 小时，MM=00/05/10/.../55 分钟）。
 * 12 小时 × 12 分刻度 = 144 个符号位，足够覆盖 26 字母 + 10 数字 + 常用标点。
 *
 * 映射表（按字符码点顺序排列，清晰可查）：
 * 字母 A-Z（26）：A=1:00, B=1:05, C=1:10, D=1:15, E=1:20, F=1:25, G=1:30
 * H=1:35, I=1:40, J=1:45, K=1:50, L=1:55
 * M=2:00, N=2:05, O=2:10, P=2:15, Q=2:20, R=2:25, S=2:30
 * T=2:35, U=2:40, V=2:45, W=2:50, X=2:55
 * Y=3:00, Z=3:05
 * 数字 0-9（10）：0=3:10, 1=3:15, 2=3:20, 3=3:25, 4=3:30
 * 5=3:35, 6=3:40, 7=3:45, 8=3:50, 9=3:55
 * 常用标点（可选）：见 PUNCT_MAP
 *
 * 编码格式：
 * 每个字符的时钟码用空格分隔，如 "HELLO" → "1:35 1:20 1:30 1:30 2:10"
 * H 为 1-12（无前导零），MM 为 00/05/10/.../55（两位，5 的倍数）
 *
 * 可逆性：
 * encode：字符 → 查表 → "H:MM"
 * decode：分割后逐个 "H:MM" → 反查表 → 字符
 * 非映射字符透传（encode 原样输出，decode 未知符号原样输出）
 */

import { register } from "./registry.js";

// ============================================================
// 字符 → 时钟码 映射表构建
// 12 小时制 + 5 分钟刻度，144 个符号位
// ============================================================

// 分针刻度（12 个）：00, 05, 10, ..., 55
const MIN_TICKS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

// 构建正向映射（字符 → "H:MM"）与逆向映射（"H:MM" → 字符）
function buildMaps() {
  const encodeMap = {}; // 字符 → "H:MM"
  const decodeMap = {}; // "H:MM" → 字符
  let hour = 1;
  let minIdx = 0;

  function next() {
    const code = hour + ":" + String(MIN_TICKS[minIdx]).padStart(2, "0");
    minIdx++;
    if (minIdx >= 12) { minIdx = 0; hour++; if (hour > 12) hour = 1; }
    return code;
  }

 // A-Z（26）
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    const code = next();
    encodeMap[ch] = code;
    decodeMap[code] = ch;
  }
 // 0-9（10）
  for (let i = 0; i < 10; i++) {
    const ch = String.fromCharCode(48 + i);
    const code = next();
    encodeMap[ch] = code;
    decodeMap[code] = ch;
  }
 // 常用标点（可选，CTF 常见）
  const puncts = ["{", "}", "_", "-", ".", "!", "?", "@", "#", "(", ")", "/", "+", "=", ":", ";", ",", "'", "\"", " ", "\n", "\t"];
  for (const ch of puncts) {
    const code = next();
    encodeMap[ch] = code;
    decodeMap[code] = ch;
  }

  return { encodeMap, decodeMap };
}

const { encodeMap, decodeMap } = buildMaps();

// ============================================================
// encode：文本 → 时钟码（空格分隔的 "H:MM" 序列）
// ============================================================
function clockEncode(text, p) {
  const sep = (p && p.sep != null) ? p.sep : " ";
  const upper = String(text).toUpperCase();
  const parts = [];
  for (const ch of upper) {
    const code = encodeMap[ch];
    if (code != null) {
      parts.push(code);
    } else {
 // 非映射字符：原样透传（不加 sep 内部分隔）
      parts.push(ch);
    }
  }
  return parts.join(sep);
}

// ============================================================
// decode：时钟码 → 文本（分割后逐个反查）
// ============================================================
function clockDecode(text, p) {
  const sep = (p && p.sep != null) ? p.sep : " ";
  const input = String(text);
  const parts = input.split(sep);
  let result = "";
  for (const part of parts) {
    if (part === "") continue; // 跳过空段（连续 sep 产生）
    const ch = decodeMap[part];
    if (ch != null) {
      result += ch;
    } else {
 // 未知符号：原样透传
      result += part;
    }
  }
  return result;
}

// ============================================================
// 注册：双向 op
// ============================================================
register({
  id: "clockCipher",
  cat: "fancy",
  name: "表盘码 / 时钟码",
  desc: "12 小时制表盘 + 5 分钟刻度时钟码。字母 A-Z / 数字 0-9 / 常用标点 → \"H:MM\"（如 A=1:00, B=1:05, M=2:00）。空格分隔。通用可逆方案（非对齐对标工具具体变体）。",
  params: [
    {
      key: "sep", label: "分隔符", type: "text", default: " ",
      placeholder: "符号间分隔符，默认空格",
    },
  ],
  encode: clockEncode,
  decode: clockDecode,
});

export { clockEncode, clockDecode, encodeMap as CLOCK_ENCODE_MAP, decodeMap as CLOCK_DECODE_MAP };
