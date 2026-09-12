/*
 * ed448x448.js — Ed448 数字签名 + X448 密钥交换（RFC 8032 §5.2 / RFC 7748 §4.2）。
 *
 * Ed448（Goldilocks）：
 * - 曲线：非扭转 Edwards x² + y² = 1 + d·x²·y²，p = 2^448 − 2^224 − 1，d = −39081，a = 1
 * - b = 456 bit（57 字节）；基点阶 L = 2^446 − 13818066809895115352007386748515426880336692474882178609894547503885
 * - 哈希 H(x) = SHAKE256(dom4(F,C) || x, 114)（FIPS 202）；
 *   dom4(F,C) = "SigEd448" || octet(F) || octet(len(C)) || C（纯 Ed448：F=0，C 默认空）
 * - 私钥 57 字节 → SHAKE256(sk,114) → prune：首字节低 2 位清零、末字节清零、
 *   倒数第二字节最高位置 1（RFC 8032 §5.2.5）
 * - 签名：r = H(prefix || M) mod L；R = [r]B；k = H(ENC(R) || A || M) mod L；S = (r + k·s) mod L
 *   签名串 = ENC(R)(57B) || ENC(S)(57B LE)，共 114 字节
 * - 验签：[4][S]B = [4]R + [4][k]A（乘 cofactor 4；RFC 8032 §5.2.7）
 * - 点解压（RFC 8032 §5.2.3）：x² = (y²−1)/(d·y²−1)；p ≡ 3 (mod 4) → 候选根 x = (u/v)^((p+1)/4)
 * - 点加/倍点：投影坐标 (X,Y,Z)，RFC 8032 §5.2.4（Faster-ECC / EFD add-2007-bl、dbl-2007-bl）
 *
 * X448（RFC 7748 §4.2/§5）：
 * - Curve448 Montgomery：v² = u³ + 156326·u² + u；a24 = (156326−2)/4 = 39081；基点 u = 5
 * - 56 字节 LE；clamp：k[0] &= 252，k[55] |= 128（X448 不 mask u 最高位——p 整除 8，无空闲位）
 * - Montgomery ladder 与 x25519.js 同构（本文件独立实现，p/长度/常量不同）
 *
 * SHAKE-256 复用 hash.js 的 keccak(rate=136, pad=0x1f, msg, n)。
 * 红线：纯 BigInt 本地，零外发；随机私钥用 crypto.getRandomValues。
 * 已过 RFC 8032 §7.4 全部 9 组 Ed448 官方向量 + RFC 7748 §5.2 / §6.2 / 1 次迭代 X448 向量。
 */

import { register } from "./registry.js";
import { keccak } from "./hash.js";

// ==================== 共用域参数（RFC 8032 Table 2 / RFC 7748 §4.2） ====================

const P = (1n << 448n) - (1n << 224n) - 1n;
const D = P - 39081n; // 曲线参数 d = -39081 (mod p)
const L = (1n << 446n) - 13818066809895115352007386748515426880336692474882178609894547503885n;
const BASE = { X: 224580040295924300187604334099896036246789641632564134246125461686950415467406032909029192869357953282578032075146446173674602635247710n,
  Y: 298819210078481492676017930443930673437544040154080242095928241372331506189835876003536878655418784733982303233503462500531545062832660n, Z: 1n };

const A24 = 39081n; // X448 的 (156326 - 2) / 4
const BITS = 448;

// ==================== 有限域 / 编码小工具 ====================

function mod(a) { const r = a % P; return r < 0n ? r + P : r; }
function powMod(b, e) {
  let r = 1n; b = mod(b);
  while (e > 0n) { if (e & 1n) r = (r * b) % P; e >>= 1n; b = (b * b) % P; }
  return r;
}
function inv(a) { return powMod(a, P - 2n); } // 费马小定理（RFC 8032 §5.2.1 推荐）

function decodeLE(bytes) {
  let x = 0n;
  for (let i = 0; i < bytes.length; i++) x |= BigInt(bytes[i]) << (8n * BigInt(i));
  return x;
}
function encodeLE(x, len) {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
function concatBytes(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

function hexToBytes(hex) {
  const h = String(hex || "").trim().replace(/^0x/i, "").replace(/[\s:]/g, "");
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`非法 hex：${hex}`);
  if (h.length % 2) throw new Error("hex 长度必须为偶数");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }
function randomBytes(n) { const b = new Uint8Array(n); crypto.getRandomValues(b); return b; }

function shake256(bytes, outLen) { return keccak(136, 0x1f, bytes, outLen); }

// ==================== X448（RFC 7748 §5） ====================

function clampScalar448(bytes) {
  const b = bytes.slice(0, 56);
  b[0] &= 252;
  b[55] |= 128;
  return decodeLE(b);
}

function ladder(k, u) {
  let x1 = u;
  let x2 = 1n, z2 = 0n, x3 = u, z3 = 1n;
  let swap = 0n;
  const cswap = (s, a, b) => (s ? [b, a] : [a, b]);
  for (let t = BITS - 1; t >= 0; t--) {
    const kt = (k >> BigInt(t)) & 1n;
    swap ^= kt;
    [x2, x3] = cswap(swap, x2, x3);
    [z2, z3] = cswap(swap, z2, z3);
    swap = kt;

    const A = mod(x2 + z2);
    const AA = mod(A * A);
    const B = mod(x2 - z2);
    const BB = mod(B * B);
    const E = mod(AA - BB);
    const C = mod(x3 + z3);
    const D = mod(x3 - z3);
    const DA = mod(D * A);
    const CB = mod(C * B);
    x3 = mod((DA + CB) * (DA + CB));
    z3 = mod(x1 * mod((DA - CB) * (DA - CB)));
    x2 = mod(AA * BB);
    z2 = mod(E * (AA + mod(A24 * E)));
  }
  [x2, x3] = cswap(swap, x2, x3);
  [z2, z3] = cswap(swap, z2, z3);
  return mod(x2 * inv(z2));
}

/** X448(k_bytes, u_bytes) → 56 字节。u 取 56 字节 LE，非规范值按 mod p 处理（RFC 7748 §5）。 */
function x448(kBytes, uBytes) {
  const k = clampScalar448(kBytes);
  const u = mod(decodeLE(uBytes.slice(0, 56)));
  return encodeLE(ladder(k, u), 56);
}

const X448_BASE = (() => { const b = new Uint8Array(56); b[0] = 5; return b; })();
function x448ScalarBase(kBytes) { return x448(kBytes, X448_BASE); }

// ==================== Ed448 点运算（RFC 8032 §5.2.4，投影坐标 a=1） ====================

/** 点加（untwisted Edwards，完整公式）：(X,Y,Z) 射影坐标，x=X/Z, y=Y/Z。
 * 注意 RFC 8032 §5.2.4 的临时量 D（=Y1·Y2）与曲线参数 d 撞名——
 * 此处临时量改名 DY，E = d·C·DY 的 d 用模块级常量 D（= -39081 mod p）。 */
function pointAdd(p1, p2) {
  const A = mod(p1.Z * p2.Z);
  const B = mod(A * A);
  const C = mod(p1.X * p2.X);
  const DY = mod(p1.Y * p2.Y);
  const E = mod(D * C * DY);
  const F = mod(B - E);
  const G = mod(B + E);
  const H = mod((p1.X + p1.Y) * (p2.X + p2.Y));
  return {
    X: mod(A * F * mod(H - C - DY)),
    Y: mod(A * G * mod(DY - C)),
    Z: mod(F * G),
  };
}

/** 倍点（dbl-2007-bl 系）。 */
function pointDouble(p) {
  const B = mod((p.X + p.Y) * (p.X + p.Y));
  const C = mod(p.X * p.X);
  const D = mod(p.Y * p.Y);
  const E = mod(C + D);
  const H = mod(p.Z * p.Z);
  const J = mod(E - mod(2n * H));
  return {
    X: mod(mod(B - E) * J),
    Y: mod(E * mod(C - D)),
    Z: mod(E * J),
  };
}

const NEUTRAL = { X: 0n, Y: 1n, Z: 1n };

/** 标量乘（double-and-add，非侧信道安全，教学用途足够）。 */
function scalarMul(k, pt) {
  let acc = NEUTRAL, addend = pt;
  let s = BigInt(k);
  while (s > 0n) {
    if (s & 1n) acc = pointAdd(acc, addend);
    addend = pointDouble(addend);
    s >>= 1n;
  }
  return acc;
}

/** 点压缩：ENC(x,y) = y 的 455-bit LE 编码 || x 最低位（放末字节 bit 7）。 */
function pointCompress(pt) {
  const zinv = inv(pt.Z);
  const x = mod(pt.X * zinv);
  const y = mod(pt.Y * zinv);
  const out = encodeLE(y, 57);
  out[56] = Number(x & 1n) << 7;
  return out;
}

/** 点解压（RFC 8032 §5.2.3）：失败返回 null。 */
function pointDecompress(b57) {
  if (b57.length !== 57) return null;
  const yInt = decodeLE(b57);
  const sign = Number((yInt >> 455n) & 1n);
  const y = yInt & ((1n << 455n) - 1n);
  if (y >= P) return null;
  const u = mod(y * y - 1n);
  const v = mod(D * y * y - 1n);
  // p = 3 (mod 4)：候选根 x = (u/v)^((p+1)/4)
  const x2 = mod(u * inv(v));
  let x = powMod(x2, (P + 1n) / 4n);
  if (mod(x * x) !== x2) return null;
  if (x === 0n && sign) return null;
  if (Number(x & 1n) !== sign) x = P - x;
  return { X: x, Y: y, Z: 1n };
}

function pointEqual(p, q) { // 交叉相乘比较，免除法
  return mod(p.X * q.Z - q.X * p.Z) === 0n && mod(p.Y * q.Z - q.Y * p.Z) === 0n;
}

// ==================== Ed448 签名 / 验签（RFC 8032 §5.2.5–§5.2.7） ====================

/** dom4(F,C) = "SigEd448" || octet(F) || octet(len(C)) || C。纯 Ed448 F=0。 */
function dom4(f, ctx) {
  return concatBytes(new TextEncoder().encode("SigEd448"),
    new Uint8Array([f & 0xff, ctx.length]), ctx);
}

/** 私钥展开：SHAKE256(sk,114)，前 57 字节 prune 成标量 s，后 57 字节作 prefix。 */
function secretExpand(sk) {
  if (sk.length !== 57) throw new Error("Ed448 私钥必须为 57 字节（114 hex 字符）");
  const h = shake256(sk, 114);
  h[0] &= 252;   // 清低 2 位
  h[56] = 0;     // 末字节 8 位全清
  h[55] |= 128;  // 置 bit 447
  return { s: decodeLE(h.slice(0, 57)), prefix: h.slice(57, 114) };
}

function secretToPublic(sk) {
  const { s } = secretExpand(sk);
  return pointCompress(scalarMul(s, BASE));
}

function ed448Sign(sk, msg, ctx = new Uint8Array(0)) {
  if (ctx.length > 255) throw new Error("context 最长 255 字节");
  const { s, prefix } = secretExpand(sk);
  const A = secretToPublic(sk);
  const dom = dom4(0, ctx);
  const r = decodeLE(shake256(concatBytes(dom, prefix, msg), 114)) % L;
  const R = pointCompress(scalarMul(r, BASE));
  const h = decodeLE(shake256(concatBytes(dom, R, A, msg), 114)) % L;
  const S = (r + h * s) % L;
  return concatBytes(R, encodeLE(S, 57));
}

function ed448Verify(pk, msg, sig, ctx = new Uint8Array(0)) {
  if (pk.length !== 57 || sig.length !== 114) return false;
  const A = pointDecompress(pk);
  const R = pointDecompress(sig.slice(0, 57));
  if (!A || !R) return false;
  const S = decodeLE(sig.slice(57));
  if (S >= L) return false; // RFC 8032 §8.4：防 malleability 必须 S < L
  const dom = dom4(0, ctx);
  const h = decodeLE(shake256(concatBytes(dom, sig.slice(0, 57), pk, msg), 114)) % L;
  const lhs = scalarMul(4n * S, BASE);
  const rhs = pointAdd(scalarMul(4n, R), scalarMul(4n * h, A));
  return pointEqual(lhs, rhs);
}

// ==================== op 注册 ====================

function msgToBytes(text, fmt) {
  if (fmt === "hex") {
    const b = hexToBytes(text);
    if (!b.length) throw new Error("hex 输入为空");
    return b;
  }
  return new TextEncoder().encode(String(text));
}

register({
  id: "ed448Sign",
  family: "ed448", familyLabel: "sign",
  cat: "asym",
  name: "Ed448 签名",
  desc: "Ed448 纯 EdDSA 签名（RFC 8032，SHAKE-256，57 字节密钥/114 字节签名，~224 位安全级）：私钥留空随机生成，输出公钥与签名。支持 context（可选）。过 RFC 8032 §7.4 九组官方向量",
  params: [
    { key: "inputFormat", label: "消息格式", type: "select", default: "text", options: [
      { value: "text", label: "文本" },
      { value: "hex", label: "Hex" },
    ] },
    { key: "priv", label: "私钥 (57B hex)", type: "text", default: "", placeholder: "114 hex 字符，留空随机生成" },
    { key: "ctx", label: "Context (hex, 可选)", type: "text", default: "", placeholder: "RFC 8032 dom4 context，留空=无" },
  ],
  run: (text, p) => {
    const msg = msgToBytes(text, (p && p.inputFormat) || "text");
    const privRaw = (p && p.priv && String(p.priv).trim()) || "";
    const sk = privRaw ? hexToBytes(privRaw) : randomBytes(57);
    if (sk.length !== 57) throw new Error(`Ed448 私钥必须为 57 字节，当前 ${sk.length} 字节`);
    let ctx = new Uint8Array(0);
    if (p && p.ctx && String(p.ctx).trim()) {
      ctx = hexToBytes(String(p.ctx).trim());
      if (ctx.length > 255) throw new Error("context 最长 255 字节");
    }
    const pk = secretToPublic(sk);
    const sig = ed448Sign(sk, msg, ctx);
    return {
      text: [
        "=== Ed448 签名（RFC 8032 §5.2）===",
        `私钥 (57B) = ${bytesToHex(sk)}`,
        `公钥 (57B) = ${bytesToHex(pk)}`,
        `消息 (${msg.length}B) = ${bytesToHex(msg)}`,
        "",
        `签名 R (57B) = ${bytesToHex(sig.slice(0, 57))}`,
        `签名 S (57B) = ${bytesToHex(sig.slice(57))}`,
        `签名 (114B hex) = ${bytesToHex(sig)}`,
        "",
        privRaw ? "" : "私钥为随机生成：⚠ 敏感请妥善保管。",
        "验签用「Ed448 验签」op：公钥 + 签名 + 原消息（context 须一致）。",
        "签名已生成二进制文件，点击下方按钮下载。",
      ].filter((x) => x !== "").join("\n"),
      files: [
        { name: "ed448.sig", mime: "application/octet-stream", bytes: sig },
      ],
    };
  },
});

register({
  id: "ed448Verify",
  family: "ed448", familyLabel: "verify",
  cat: "asym",
  name: "Ed448 验签",
  desc: "Ed448 纯 EdDSA 验签（RFC 8032 §5.2.7）：公钥 + 114 字节签名 + 原消息，校验 [4][S]B = [4]R + [4][k]A。篡改消息/签名任一字节即失败",
  params: [
    { key: "inputFormat", label: "消息格式", type: "select", default: "text", options: [
      { value: "text", label: "文本" },
      { value: "hex", label: "Hex" },
    ] },
    { key: "pub", label: "公钥 (57B hex)", type: "text", default: "", placeholder: "114 hex 字符" },
    { key: "sig", label: "签名 (114B hex)", type: "text", default: "", placeholder: "228 hex 字符" },
    { key: "ctx", label: "Context (hex, 可选)", type: "text", default: "", placeholder: "须与签名时一致" },
  ],
  run: (text, p) => {
    const msg = msgToBytes(text, (p && p.inputFormat) || "text");
    const pk = hexToBytes((p && p.pub) || "");
    if (pk.length !== 57) throw new Error(`公钥必须为 57 字节（114 hex 字符），当前 ${pk.length} 字节`);
    const sig = hexToBytes((p && p.sig) || "");
    if (sig.length !== 114) throw new Error(`签名必须为 114 字节（228 hex 字符），当前 ${sig.length} 字节`);
    let ctx = new Uint8Array(0);
    if (p && p.ctx && String(p.ctx).trim()) {
      ctx = hexToBytes(String(p.ctx).trim());
      if (ctx.length > 255) throw new Error("context 最长 255 字节");
    }
    const A = pointDecompress(pk);
    const R = pointDecompress(sig.slice(0, 57));
    const lines = ["=== Ed448 验签（RFC 8032 §5.2.7）===", `消息 (${msg.length}B) hex = ${bytesToHex(msg)}`];
    lines.push(A ? "公钥点解压：成功" : "公钥点解压：失败（非曲线点）");
    lines.push(R ? "R 点解压：成功" : "R 点解压：失败（非曲线点）");
    if (!A || !R) { lines.push("", "✗ 签名无效（点编码非法）"); return lines.join("\n"); }
    const S = decodeLE(sig.slice(57));
    lines.push(S < L ? "标量 S 范围检查：通过（S < L）" : "标量 S 范围检查：失败（S ≥ L，可延展性攻击）");
    const ok = ed448Verify(pk, msg, sig, ctx);
    lines.push("", ok ? "✓ 签名有效（[4][S]B = [4]R + [4][k]A 成立）" : "✗ 签名无效（群方程不成立）");
    return lines.join("\n");
  },
});

register({
  id: "x448KeyGen",
  family: "x448", familyLabel: "keygen",
  cat: "asym",
  name: "X448 密钥生成",
  desc: "Curve448 密钥对生成（RFC 7748）：私钥 56 字节随机（或给定）→ 公钥 = X448(clamp(私钥), 基点 5)。配套「X448 共享密钥」op 做 ECDH",
  params: [
    { key: "priv", label: "私钥 (56B hex)", type: "text", default: "", placeholder: "112 hex 字符，留空随机生成" },
  ],
  run: (_text, p) => {
    const privRaw = (p && p.priv && String(p.priv).trim()) || "";
    const sk = privRaw ? hexToBytes(privRaw) : randomBytes(56);
    if (sk.length !== 56) throw new Error(`X448 私钥必须为 56 字节，当前 ${sk.length} 字节`);
    const pk = x448ScalarBase(sk);
    return {
      text: [
        "=== X448 密钥生成（RFC 7748）===",
        `私钥 (56B, hex) = ${bytesToHex(sk)}`,
        `公钥 (56B, hex) = ${bytesToHex(pk)}`,
        "",
        "说明：公钥 = X448(clamp(私钥), 基点 5)。clamp：k[0] &= 252，k[55] |= 128。",
        "私钥留空则随机生成：⚠ 敏感请妥善保管。点击下方按钮下载。",
      ].join("\n"),
      files: [
        { name: "x448_priv.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(sk) + "\n") },
        { name: "x448_pub.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(pk) + "\n") },
      ],
    };
  },
});

register({
  id: "x448Shared",
  family: "x448", familyLabel: "shared",
  cat: "asym",
  name: "X448 共享密钥",
  desc: "Curve448 上的 ECDH（RFC 7748 §6.2）：双方私钥算共享密钥（两侧互验一致），或我方私钥 + 对方公钥直接算。共享密钥可下载",
  params: [
    { key: "mode", label: "模式", type: "select", default: "shared_from_privs", options: [
      { value: "shared_from_privs", label: "共享密钥（双方私钥）" },
      { value: "shared_priv_pub", label: "共享密钥（我私钥+对方公钥）" },
    ] },
    { key: "priv", label: "我的私钥 (hex)", type: "text", default: "", placeholder: "56B hex" },
    { key: "pub", label: "对方公钥 (hex)", type: "text", default: "", placeholder: "56B hex" },
    { key: "privA", label: "私钥 A (hex, 双方模式)", type: "text", default: "", placeholder: "56B hex" },
    { key: "privB", label: "私钥 B (hex, 双方模式)", type: "text", default: "", placeholder: "56B hex" },
  ],
  run: (_text, p) => {
    const mode = (p && p.mode) || "shared_from_privs";
    const need56 = (hex, label) => {
      const b = hexToBytes(hex);
      if (b.length !== 56) throw new Error(`${label} 必须为 56 字节（112 hex 字符），当前 ${b.length} 字节`);
      return b;
    };
    if (mode === "shared_from_privs") {
      const a = need56((p && p.privA) || "", "私钥 A");
      const b = need56((p && p.privB) || "", "私钥 B");
      const pkA = x448ScalarBase(a), pkB = x448ScalarBase(b);
      const s1 = x448(a, pkB), s2 = x448(b, pkA);
      const same = bytesToHex(s1) === bytesToHex(s2);
      return {
        text: [
          "=== X448 共享密钥（双方私钥，RFC 7748 §6.2）===",
          `私钥 A = ${bytesToHex(a)}`,
          `私钥 B = ${bytesToHex(b)}`,
          `公钥 A = ${bytesToHex(pkA)}`,
          `公钥 B = ${bytesToHex(pkB)}`,
          "",
          `共享 K (A·pkB) = ${bytesToHex(s1)}`,
          `共享 K (B·pkA) = ${bytesToHex(s2)}`,
          same ? "✓ 两侧一致（ECDH 成立）" : "✗ 两侧不一致（参数异常）",
          "",
          "共享密钥已生成，点击下方按钮下载。⚠ 仅作演示，实际通信勿直接当对称密钥用（建议再过 KDF）。",
        ].join("\n"),
        files: [
          { name: "x448_shared.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(s1) + "\n") },
        ],
      };
    }
    if (mode === "shared_priv_pub") {
      const sk = need56((p && p.priv) || "", "我的私钥");
      const pk = need56((p && p.pub) || "", "对方公钥");
      const s = x448(sk, pk);
      return {
        text: [
          "=== X448 共享密钥（我私钥 + 对方公钥，RFC 7748 §6.2）===",
          `我的私钥 = ${bytesToHex(sk)}`,
          `对方公钥 = ${bytesToHex(pk)}`,
          "",
          `共享密钥 K = X448(私钥, 对方公钥) = ${bytesToHex(s)}`,
          "",
          "共享密钥已生成，点击下方按钮下载。⚠ 仅作演示，实际通信勿直接当对称密钥用（建议再过 KDF）。",
        ].join("\n"),
        files: [
          { name: "x448_shared.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(s) + "\n") },
        ],
      };
    }
    throw new Error(`未知 mode: ${mode}`);
  },
});

export { ed448Sign, ed448Verify, secretExpand, secretToPublic, x448, x448ScalarBase,
  pointCompress, pointDecompress, scalarMul, hexToBytes, bytesToHex };
