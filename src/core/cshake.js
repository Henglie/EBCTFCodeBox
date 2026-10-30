/*
 * cshake.js — cSHAKE128 / cSHAKE256 可定制可扩展输出函数（NIST SP 800-185 §3.3）。
 *
 * cSHAKE = SHAKE 加「函数名 N」与「定制串 S」两个域分隔输入：
 *   cSHAKE128(X, L, N, S) = KECCAK[168](bytepad(encode_string(N) || encode_string(S), 168) ‖ X, L)
 *   cSHAKE256(X, L, N, S) = KECCAK[136](bytepad(encode_string(N) || encode_string(S), 136) ‖ X, L)
 *   spec 规定：N 与 S 同时为空时等价于 SHAKE128/256（无前缀，pad 0x1f）——实现必须
 *   特判，否则 bytepad(01 00 01 00, rate) 前缀会破坏等价性（pycryptodomex 同口径）。
 *
 * 海绵复用：hash.js 导出的 keccak(rate, padByte, msg, outLen)（Keccak-f[1600] +
 * 多速率 pad10*1），本文件只组装 SP 800-185 §2.3 的 left_encode/encode_string/
 * bytepad 三件套，不重复实现海绵（红线「不重复实现底层海绵」）。
 *
 * 家族关系（edu 详述）：SHAKE128/256 = cSHAKE 的 N=S=空特例；KMAC128/256 =
 * cSHAKE128/256(N="KMAC") 的进一步封装（SP 800-185 §4.3，见 cmac.js kmac op）；
 * SHA-3 = 定长输出的 KECCAK[c]（pad 0x06）。pad 域字节：SHA3=0x06 / SHAKE=0x1f /
 * cSHAKE=0x04（SP 800-185 §3.3）。
 *
 * 红线：纯本地计算，零外发；不取随机字节。
 */

import { register } from "./registry.js";
import { keccak } from "./hash.js";

// left_encode(x)（SP 800-185 §2.3.2）：[字节数 N] ‖ x 的 N 字节大端（x 非零时去前导 0；x=0 → N=1）
function leftEncode(x) {
  let n = 1;
  while (x >= 256 ** n && n < 255) n++; // x < 256^n → n 字节装得下
  const out = new Uint8Array(n + 1);
  out[0] = n;
  for (let i = 0; i < n; i++) out[n - i] = (x >>> (8 * i)) & 0xff; // 大端
  return out;
}

// encode_string(s)（§2.3.3）：left_encode(8·len(s)) ‖ s
function encodeString(s) {
  const head = leftEncode(s.length * 8);
  const out = new Uint8Array(head.length + s.length);
  out.set(head, 0);
  out.set(s, head.length);
  return out;
}

// bytepad(X, w)（§2.3.4）：left_encode(w) ‖ X ‖ 0x00*，凑到 w 的整数倍
function bytepad(X, w) {
  const head = leftEncode(w);
  const total = head.length + X.length;
  const pad = (w - (total % w)) % w;
  const out = new Uint8Array(total + pad);
  out.set(head, 0);
  out.set(X, head.length);
  return out;
}

const RATE = { 128: 168, 256: 136 }; // KECCAK[c] 的字节速率，c = 2×security

function cshake(security, msg, outLen, nBytes, sBytes) {
  const rate = RATE[security];
  const n = Math.max(0, Math.floor(outLen) || 0);
  if (!nBytes.length && !sBytes.length) {
    // spec §3.3：N=S=空 ⇔ SHAKE（pad 0x1f，无前缀）
    return keccak(rate, 0x1f, msg, n);
  }
  const prefix = bytepad(concat(encodeString(nBytes), encodeString(sBytes)), rate);
  const full = concat(prefix, msg);
  return keccak(rate, 0x04, full, n); // cSHAKE 域 pad = 0x04（00+1）
}

function concat(...arrs) {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function bytesFromInput(str, fmt, label) {
  if (fmt === "hex") {
    const s = String(str == null ? "" : str).trim().replace(/^0x/i, "").replace(/\s+/g, "");
    if (!s) return new Uint8Array(0);
    if (s.length % 2 || /[^0-9a-fA-F]/.test(s)) throw new Error(`${label} hex 非法：须为偶数个 hex 字符`);
    return Uint8Array.from({ length: s.length / 2 }, (_, i) => parseInt(s.substr(i * 2, 2), 16));
  }
  return new TextEncoder().encode(String(str ?? ""));
}

function toHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }

register({
  id: "cshake",
  cat: "hash",
  name: "cSHAKE",
  family: "cshake",
  familyLabel: "cSHAKE",
  desc: "cSHAKE128/256 可定制 XOF（NIST SP 800-185 §3.3）：SHAKE 加「函数名 N」与「定制串 S」域分隔输入（bytepad(encode_string(N)‖encode_string(S)) 前缀，pad 0x04）。N=S 同时为空 ⇔ SHAKE128/256（spec 等价）。KMAC = cSHAKE(N=\"KMAC\") 的封装（见 KMAC op）；SHA-3 = 定长 KECCAK[c]。海绵复用 hash.js Keccak-f[1600]，与 pycryptodomex 逐字节对拍",
  acceptsBytes: true, textTransit: true,
  params: [
    { key: "bits", label: "安全强度", type: "select", default: 128, options: [
      { value: 128, label: "128（cSHAKE128，rate 168）" },
      { value: 256, label: "256（cSHAKE256，rate 136）" },
    ] },
    { key: "funcName", label: "函数名 N（text / hex）", type: "text", default: "", placeholder: "域分隔用函数名，通常留空或 \"KMAC\"" },
    { key: "customization", label: "定制串 S（text / hex）", type: "text", default: "", placeholder: "应用定制串，如 \"Email Signature\"" },
    { key: "inputEnc", label: "N/S 编码", type: "select", default: "text", options: [
      { value: "text", label: "text（UTF-8）" },
      { value: "hex", label: "hex" },
    ] },
    { key: "outLen", label: "输出字节数", type: "number", default: 32, placeholder: "任意长度（XOF）" },
  ],
  run: (t, p) => {
    const bits = (p && Number(p.bits)) === 256 ? 256 : 128;
    const enc = (p && p.inputEnc) === "hex" ? "hex" : "text";
    const nBytes = bytesFromInput(p && p.funcName, enc, "函数名 N");
    const sBytes = bytesFromInput(p && p.customization, enc, "定制串 S");
    const outLen = (p && p.outLen != null) ? Number(p.outLen) : 32;
    if (!Number.isFinite(outLen) || outLen < 0) throw new Error("输出字节数须为非负整数");
    const raw = p && p.rawBytes;
    const msg = raw || new TextEncoder().encode(String(t ?? ""));
    return toHex(cshake(bits, msg, outLen, nBytes, sBytes));
  },
});
