/*
 * ttlStego.js — TTL 隐写（IP 包 TTL 值序列 ↔ 比特流，cat:'analysis'，双向）。
 *
 * 定位：网络流量取证高频。发包方把每个 IP 包的 TTL 设成一小撮"锚点值"之一
 * 每个锚点代表 2 bit，4 个包拼 1 字节 → 藏 ASCII。对应 all-in-one tem_exp_add
 * 脚本金矿里的 TTL 隐写项。
 *
 * 编码方案（默认，经典 4 锚点）：
 * TTL 0 → "00"
 * TTL 64 → "01"
 * TTL 128 → "10"
 * TTL 255 → "11"
 * （decode 时按"最近锚点"归一化，容忍 63/65/127 等实测抖动值）
 * 比特 MSB 优先，每 4 个 TTL 值拼 1 字节。
 *
 * 契约：register({id, cat:'analysis', name, desc, params, encode, decode})。
 * encode(text) 文本 → 空格分隔 TTL 序列
 * decode(text) TTL 序列（空格/逗号/换行分隔的整数）→ 文本
 *
 * 红线：算法层零 UI 依赖（仅 registry）；零外发纯本地；件内自注册。
 *
 * 参考：CTF-wiki misc 流量分析（TTL 隐写）+ all-in-one 决策案「tem_exp_add 真缺 3 个」。
 */
import { register } from "./registry.js";

// 2-bit → TTL 锚点值
const BITS_TO_TTL = { "00": 0, "01": 64, "10": 128, "11": 255 };
// 锚点列表（decode 归一化用）
const ANCHORS = [
  { ttl: 0, bits: "00" },
  { ttl: 64, bits: "01" },
  { ttl: 128, bits: "10" },
  { ttl: 255, bits: "11" },
];

// 把一个实测 TTL 值归一到最近锚点 → 2 bit
function ttlToBits(v) {
  let best = ANCHORS[0], bestD = Infinity;
  for (const a of ANCHORS) {
    const d = Math.abs(v - a.ttl);
    if (d < bestD) { bestD = d; best = a; }
  }
  return best.bits;
}

// decode：TTL 序列 → 文本
function ttlDecode(text) {
  const nums = String(text || "")
    .split(/[^0-9]+/)
    .filter((s) => s !== "")
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n));
  if (nums.length === 0) return "（无有效 TTL 值。输入应为空格/逗号/换行分隔的整数序列）";

  let bitStr = "";
  for (const n of nums) bitStr += ttlToBits(n);

 // 每 8 bit 一字节
  const bytes = [];
  for (let i = 0; i + 8 <= bitStr.length; i += 8) {
    bytes.push(parseInt(bitStr.slice(i, i + 8), 2));
  }
  const leftover = bitStr.length % 8;

  let asText;
  try {
    asText = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    asText = bytes.map((b) => String.fromCharCode(b)).join("");
  }

  const lines = [];
  lines.push("=== TTL 隐写解码 ===");
  lines.push("TTL 值个数: " + nums.length + "（每 4 个拼 1 字节）");
  lines.push("比特流(" + bitStr.length + " bit): " + (bitStr.length > 256 ? bitStr.slice(0, 256) + "…" : bitStr));
  if (leftover) lines.push("⚠ 末尾剩 " + leftover + " bit 不足 1 字节，已忽略（TTL 个数应为 4 的倍数）");
  lines.push("");
  lines.push("--- 明文 ---");
  lines.push(asText);
  lines.push("");
  lines.push("--- 字节(hex) ---");
  lines.push(bytes.map((b) => b.toString(16).padStart(2, "0")).join(" "));
  return lines.join("\n");
}

// encode：文本 → TTL 序列
function ttlEncode(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  const ttls = [];
  for (const b of bytes) {
    const bin = b.toString(2).padStart(8, "0");
 // 每 2 bit 一个 TTL 值，MSB 优先
    ttls.push(BITS_TO_TTL[bin.slice(0, 2)]);
    ttls.push(BITS_TO_TTL[bin.slice(2, 4)]);
    ttls.push(BITS_TO_TTL[bin.slice(4, 6)]);
    ttls.push(BITS_TO_TTL[bin.slice(6, 8)]);
  }
  return ttls.join(" ");
}

register({
  id: "ttlStego",
  cat: "analysis",
  name: "TTL 隐写（IP 包 TTL 序列）",
  desc: "IP 包 TTL 值序列 ↔ 文本：4 锚点(0/64/128/255)各代表 2bit，4 个包拼 1 字节。解码容忍实测抖动值（按最近锚点归一）",
  params: [],
  encode: ttlEncode,
  decode: ttlDecode,
});

export { ttlEncode, ttlDecode, ttlToBits };
