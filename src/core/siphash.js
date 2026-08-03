/*
 * siphash.js — SipHash-2-4 / SipHash-1-3 键控伪随机函数（cat:'hash'，run 型）。
 *
 * 算法照 Aumasson & Bernstein《SipHash: a fast short-input PRF》(2012) 参考实现，
 * 不编造。SipHash 是一个键控 64 位 MAC/PRF，广泛用于哈希表抗碰撞（Python dict、
 * Rust HashMap、多种语言运行时），CTF 逆向/协议题常见。
 *
 * 结构（ARX，全 64 位模运算）：
 *   16 字节密钥 → k0,k1（小端 64 位）
 *   初始化：v0=k0^0x736f6d6570736575, v1=k1^0x646f72616e646f6d,
 *           v2=k0^0x6c7967656e657261, v3=k1^0x7465646279746573
 *   每 8 字节块（小端）：v3^=m; c 轮 SipRound; v0^=m
 *   末块高字节放消息长度 mod 256
 *   收尾：v2^=0xff; d 轮 SipRound; 输出 v0^v1^v2^v3（64 位）
 *   SipRound：加/循环移位/异或的 ARX 网络（见下）
 *   SipHash-2-4：c=2, d=4（默认）；SipHash-1-3：c=1, d=3
 *
 * 参考测试向量（key=000102…0f，输入=00,01,…,(len-1)）：
 *   len=0  → 726fdb47dd0e0e31   len=15 → a129ca6149be45e5
 *   （照参考实现 vectors_sip64，交付前逐条比对）
 *
 * 红线：算法照参考实现；纯本地零外发；core 层零 UI 依赖（仅 registry）；纯 JS BigInt。
 *
 * 契约：register({ id:"siphash", cat:"hash", name, desc, params, run })。
 */
import { register } from "./registry.js";

const MASK64 = (1n << 64n) - 1n;

function rotl64(x, b) {
  b = BigInt(b);
  return ((x << b) | (x >> (64n - b))) & MASK64;
}

function add64(a, b) { return (a + b) & MASK64; }

// 小端 8 字节 → BigInt 64 位
function readLE64(bytes, off, len) {
  let v = 0n;
  for (let i = 0; i < len; i++) v |= BigInt(bytes[off + i]) << (8n * BigInt(i));
  return v;
}

function sipRound(v) {
  v[0] = add64(v[0], v[1]);
  v[1] = rotl64(v[1], 13);
  v[1] ^= v[0];
  v[0] = rotl64(v[0], 32);
  v[2] = add64(v[2], v[3]);
  v[3] = rotl64(v[3], 16);
  v[3] ^= v[2];
  v[0] = add64(v[0], v[3]);
  v[3] = rotl64(v[3], 21);
  v[3] ^= v[0];
  v[2] = add64(v[2], v[1]);
  v[1] = rotl64(v[1], 17);
  v[1] ^= v[2];
  v[2] = rotl64(v[2], 32);
}

/**
 * SipHash 核心。
 * @param {Uint8Array} key 16 字节密钥
 * @param {Uint8Array} data 消息
 * @param {number} c 压缩轮数（默认 2）
 * @param {number} d 收尾轮数（默认 4）
 * @returns {bigint} 64 位结果
 */
function siphash(key, data, c = 2, d = 4) {
  if (key.length !== 16) throw new Error("SipHash 密钥须为 16 字节（32 hex）");
  const k0 = readLE64(key, 0, 8);
  const k1 = readLE64(key, 8, 8);
  const v = [
    k0 ^ 0x736f6d6570736575n,
    k1 ^ 0x646f72616e646f6dn,
    k0 ^ 0x6c7967656e657261n,
    k1 ^ 0x7465646279746573n,
  ];
  const len = data.length;
  const end = len - (len % 8);
  for (let off = 0; off < end; off += 8) {
    const m = readLE64(data, off, 8);
    v[3] ^= m;
    for (let i = 0; i < c; i++) sipRound(v);
    v[0] ^= m;
  }
  // 末块：剩余字节 + 高字节放长度
  let b = BigInt(len & 0xff) << 56n;
  const rem = len - end;
  b |= readLE64(data, end, rem);
  v[3] ^= b;
  for (let i = 0; i < c; i++) sipRound(v);
  v[0] ^= b;
  v[2] ^= 0xffn;
  for (let i = 0; i < d; i++) sipRound(v);
  return (v[0] ^ v[1] ^ v[2] ^ v[3]) & MASK64;
}

// ============================================================
// 输入编解码
// ============================================================
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function decodeInput(text, mode) {
  const s = String(text || "");
  if (mode === "hex") return hexToBytes(s.trim());
  if (mode === "base64") {
    const bin = atob(s.trim().replace(/\s/g, ""));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(s);
}

// 64 位 BigInt → 小端 hex（SipHash 参考输出字节序）
function le64Hex(v) {
  let s = "";
  for (let i = 0; i < 8; i++) {
    s += Number((v >> (8n * BigInt(i))) & 0xffn).toString(16).padStart(2, "0");
  }
  return s;
}

function siphashRun(text, p = {}) {
  const variant = (p && p.variant) || "2-4";
  const [c, d] = variant === "1-3" ? [1, 3] : [2, 4];
  const keyRaw = String((p && p.key) || "").trim();
  if (!keyRaw) throw new Error("请填写 16 字节密钥（32 hex）");
  const key = hexToBytes(keyRaw);
  const data = decodeInput(text, (p && p.inputMode) || "text");

  const out = siphash(key, data, c, d);
  const lines = [];
  lines.push(`=== SipHash-${variant} 键控 PRF ===`);
  lines.push(`密钥: ${keyRaw}（16 字节）`);
  lines.push(`消息: ${data.length} 字节`);
  lines.push("");
  lines.push(`结果（小端 hex，参考实现字节序）: ${le64Hex(out)}`);
  lines.push(`结果（大端 hex）: ${out.toString(16).padStart(16, "0")}`);
  lines.push(`结果（uint64 十进制）: ${out.toString(10)}`);
  return lines.join("\n");
}

register({
  id: "siphash",
  cat: "hash",
  name: "SipHash-2-4 / 1-3",
  desc: "SipHash 键控 64 位 PRF/MAC（Aumasson-Bernstein 2012）：哈希表抗碰撞标准（Python/Rust 等运行时用）。16 字节密钥，输出 64 位。支持 SipHash-2-4（默认）与 SipHash-1-3。",
  params: [
    {
      key: "variant", label: "变体", type: "select", default: "2-4",
      options: [
        { value: "2-4", label: "SipHash-2-4（默认）" },
        { value: "1-3", label: "SipHash-1-3（更快）" },
      ],
    },
    { key: "key", label: "密钥 (hex, 16 字节)", type: "text", default: "000102030405060708090a0b0c0d0e0f", placeholder: "32 hex 字符" },
    {
      key: "inputMode", label: "消息形式", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ],
    },
  ],
  run: siphashRun,
});

export { siphash, rotl64, sipRound };
