/*
 * sm2.js — SM2 椭圆曲线公钥密码（完整运算）。
 *
 * 覆盖：
 * - 数字签名生成/验证：GB/T 32918.2-2016（前身 GM/T 0003.2-2012）
 * - 公钥加密/解密：GB/T 32918.4-2016（前身 GM/T 0003.4-2012），密文 C1||C3||C2（GB/T 32918.4 旧序）
 * - 曲线 sm2p256v1 参数：GB/T 32918.5-2017（前身 GM/T 0003.5-2012）
 * - KDF：GB/T 32918.4 §5.4.3（计数器式 SM3 派生）
 * - 哈希：SM3（GB/T 32905-2016），复用 hashExt.js 导出 sm3Bytes
 *
 * 权威验证（加载自检 IIFE，不符即抛错）：
 * - 签名：GB/T 32918.2-2016 附录 A.2（message digest，dA/k 给定）→ (r, s) 逐字节
 * - 加密：GB/T 32918.4-2016 附录 A（encryption standard，dB/k 给定）→ C1||C3||C2 逐字节
 *
 * 北极星：算法零 UI 依赖、纯函数、导出核心，可被独立摘取当权威源。
 */
import { register } from "./registry.js";
import { sm3Bytes } from "./hashExt.js";

// ============================================================
// 数论（BigInt，模运算）
// ============================================================
function mod(a, m) { const r = a % m; return r < 0n ? r + m : r; }
function egcd(a, b) {
  let oldR = a, r = b, oldS = 1n, s = 0n, oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return [oldR, oldS, oldT];
}
function modInverse(a, m) {
  const [g, x] = egcd(mod(a, m), m);
  if (g !== 1n) throw new Error(`模逆不存在：gcd(${a}, ${m}) = ${g}（≠1）`);
  return mod(x, m);
}

// ============================================================
// sm2p256v1 曲线参数（GB/T 32918.5-2017 附录 A）
// ============================================================
const CURVE = {
  p: 0xFFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000FFFFFFFFFFFFFFFFn,
  a: 0xFFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF00000000FFFFFFFFFFFFFFFCn,
  b: 0x28E9FA9E9D9F5E344D5A9E4BCF6509A7F39789F515AB8F92DDBCBD414D940E93n,
  n: 0xFFFFFFFEFFFFFFFFFFFFFFFFFFFFFFFF7203DF6B21C6052B53BBF40939D54123n,
  Gx: 0x32C4AE2C1F1981195F9904466A39C9948FE30BBFF2660BE1715A4589334C74C7n,
  Gy: 0xBC3736A2F4F6779C59BDCEE36B692153D0A9877CC62A474002DF32E52139F0A0n,
};
const { p, a, b, n, Gx, Gy } = CURVE;

// ============================================================
// 字节 ↔ 大整数（大端）
// ============================================================
function bytesToBig(bytes) {
  let x = 0n;
  for (const c of bytes) x = (x << 8n) | BigInt(c);
  return x;
}
function bigToBytes(x, len = 32) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}
function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("hex 长度必须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function concat(...arrays) {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ============================================================
// 椭圆曲线点运算（雅可比坐标，y² = x³ + ax + b mod p）
// ============================================================
function ptDouble(P) {
  const [X1, Y1, Z1] = P;
  if (Y1 === 0n) return [0n, 1n, 0n];
  const A = mod(X1 * X1, p);
  const B = mod(Y1 * Y1, p);
  const C = mod(B * B, p);
  const Z1sq = mod(Z1 * Z1, p);
  const D = mod(2n * (mod((X1 + B) * (X1 + B), p) - A - C), p);
  const E = mod(3n * A + a * mod(Z1sq * Z1sq, p), p);
  const F = mod(E * E, p);
  const X3 = mod(F - 2n * D, p);
  const Y3 = mod(E * (D - X3) - 8n * C, p);
  const Z3 = mod(2n * Y1 * Z1, p);
  return [X3, Y3, Z3];
}
function ptAdd(P, Q) {
  if (P[2] === 0n) return Q;
  if (Q[2] === 0n) return P;
  const [X1, Y1, Z1] = P, [X2, Y2, Z2] = Q;
  const Z1Z1 = mod(Z1 * Z1, p);
  const Z2Z2 = mod(Z2 * Z2, p);
  const U1 = mod(X1 * Z2Z2, p);
  const U2 = mod(X2 * Z1Z1, p);
  const S1 = mod(Y1 * Z2 * Z2Z2, p);
  const S2 = mod(Y2 * Z1 * Z1Z1, p);
  if (U1 === U2) {
    if (S1 !== S2) return [0n, 1n, 0n];
    return ptDouble(P);
  }
  const H = mod(U2 - U1, p);
  const I = mod((2n * H) * (2n * H), p);
  const J = mod(H * I, p);
  const rr = mod(2n * (S2 - S1), p);
  const V = mod(U1 * I, p);
  const X3 = mod(rr * rr - J - 2n * V, p);
  const Y3 = mod(rr * (V - X3) - 2n * S1 * J, p);
  const Z3 = mod((mod((Z1 + Z2) * (Z1 + Z2), p) - Z1Z1 - Z2Z2) * H, p);
  return [X3, Y3, Z3];
}
function ptMul(k, P) {
  let R = [0n, 1n, 0n];
  let Q = [mod(P[0], p), mod(P[1], p), 1n];
  let kk = k;
  while (kk > 0n) {
    if (kk & 1n) R = ptAdd(R, Q);
    Q = ptDouble(Q);
    kk >>= 1n;
  }
  return R;
}
function ptAffine(P) {
  if (P[2] === 0n) return null;
  const zinv = modInverse(P[2], p);
  const zinv2 = mod(zinv * zinv, p);
  return [mod(P[0] * zinv2, p), mod(P[1] * zinv2 * zinv, p)];
}
// 点在曲线上的验证：y² = x³ + ax + b mod p
function onCurve(x, y) {
  return mod(y * y, p) === mod(x * x * x + a * x + b, p);
}

// ============================================================
// SM2 KDF（GB/T 32918.4 §5.4.3，计数器式，SM3）
// ============================================================
function sm2Kdf(z, klen) {
  if (!Number.isSafeInteger(klen) || klen < 0) throw new Error("SM2 KDF 长度需为非负安全整数（bit）");
  if (klen > 0xffffffff * 256) throw new Error("SM2 KDF 长度超过标准计数器上限");
  const nBlocks = Math.ceil(klen / 256);
  const chunks = [];
  for (let i = 1; i <= nBlocks; i++) {
    const ct = new Uint8Array(4);
    ct[0] = (i >>> 24) & 0xff; ct[1] = (i >>> 16) & 0xff; ct[2] = (i >>> 8) & 0xff; ct[3] = i & 0xff;
    chunks.push(sm3Bytes(concat(z, ct)));
  }
  const full = concat(...chunks);
  const outBytes = Math.ceil(klen / 8);
  const out = full.slice(0, outBytes);
  const remaining = klen % 8;
  if (remaining && out.length) out[out.length - 1] &= (0xff << (8 - remaining)) & 0xff;
  return out;
}

// ============================================================
// ZA = SM3(ENTL_A ∥ ID_A ∥ a ∥ b ∥ x_G ∥ y_G ∥ x_A ∥ y_A)
// ENTL_A = ID_A 位长（16 位大端）
// ============================================================
function computeZa(ida, pubX, pubY) {
  const entl = new Uint8Array(2);
  const bitLen = ida.length * 8;
  entl[0] = (bitLen >>> 8) & 0xff; entl[1] = bitLen & 0xff;
  const input = concat(
    entl, ida,
    bigToBytes(a), bigToBytes(b),
    bigToBytes(Gx), bigToBytes(Gy),
    bigToBytes(pubX), bigToBytes(pubY)
  );
  return sm3Bytes(input);
}

// ============================================================
// 密钥交换（GB/T 32918.3-2016 §6.1，sm2p256v1 协因子 h=1）
// 双方各自：临时密钥对 (r, R=[r]G)，交换 R 后计算共享点
// V = [t](P_other + [x_other_]R_other)，t = (d + x_·r) mod n
// x_ = 2^127 + (x & (2^127-1))（取 x 低 127 位 + 置位 bit127）
// 共享密钥 K = KDF(xV ‖ yV ‖ ZA ‖ ZB, klen)
// 确认项（可选）：SB = SM3(0x02‖yV‖H)，S2 = SM3(0x03‖yV‖H)，H = SM3(xV‖ZA‖ZB‖x1‖y1‖x2‖y2)
// ============================================================
const W127 = (1n << 127n) - 1n;
function xTilde(x) { return (x & W127) | (1n << 127n); }

// 单方计算共享点 V = [t](P_other + [x_other_]R_other)
// 参数：d 本方私钥、r 本方临时随机数、R1=(rx1,ry1) 本方临时点、R2=(rx2,ry2) 对端临时点、pubOther 对端公钥
function sm2KexSharedPoint(d, r, rx1, ry1, rx2, ry2, pubOtherX, pubOtherY) {
  const t = mod(d + mod(xTilde(rx1) * r, n), n);
  const P = ptAffine(ptAdd([pubOtherX, pubOtherY, 1n], ptMul(xTilde(rx2), [rx2, ry2])));
  if (!P) throw new Error("SM2 密钥交换中间点 P 为无穷远点");
  const V = ptAffine(ptMul(t, P));
  if (!V) throw new Error("SM2 密钥交换共享点 V 为无穷远点");
  return V;
}

// KDF 派生共享密钥（GB/T 32918.3 输入含 ZA‖ZB）
function sm2KexKdf(Vx, Vy, zA, zB, klen) {
  return sm2Kdf(concat(bigToBytes(Vx), bigToBytes(Vy), zA, zB), klen);
}

// 确认值 S = SM3(prefix ‖ yV ‖ SM3(xV‖ZA‖ZB‖x1‖y1‖x2‖y2))，prefix=0x02（S1/SB）或 0x03（S2）
function sm2KexConfirm(Vx, Vy, zA, zB, x1, y1, x2, y2, prefix) {
  const h = sm3Bytes(concat(bigToBytes(Vx), zA, zB, bigToBytes(x1), bigToBytes(y1), bigToBytes(x2), bigToBytes(y2)));
  return sm3Bytes(concat(new Uint8Array([prefix]), bigToBytes(Vy), h));
}

// 全流程（模拟双方，供 op 与官方向量自检）
// 输入：A/B 私钥 + 临时随机数 + 双方 ID；输出：RA/RB/共享密钥 K/S1/S2/V
function sm2KeyExchange(dA, dB, rA, rB, ida, idb, klen) {
  assertScalar(dA, "SM2 本方私钥");
  assertScalar(dB, "SM2 对方私钥");
  assertScalar(rA, "SM2 本方临时私钥");
  assertScalar(rB, "SM2 对方临时私钥");
  const PA = ptAffine(ptMul(dA, [Gx, Gy]));
  const PB = ptAffine(ptMul(dB, [Gx, Gy]));
  const zA = computeZa(ida, PA[0], PA[1]);
  const zB = computeZa(idb, PB[0], PB[1]);
  const RA = ptAffine(ptMul(rA, [Gx, Gy]));
  const RB = ptAffine(ptMul(rB, [Gx, Gy]));
  const VA = sm2KexSharedPoint(dA, rA, RA[0], RA[1], RB[0], RB[1], PB[0], PB[1]);
  const VB = sm2KexSharedPoint(dB, rB, RB[0], RB[1], RA[0], RA[1], PA[0], PA[1]);
  if (VA[0] !== VB[0] || VA[1] !== VB[1]) throw new Error("SM2 密钥交换双方共享点不一致");
  const K = sm2KexKdf(VA[0], VA[1], zA, zB, klen);
  const S1 = sm2KexConfirm(VA[0], VA[1], zA, zB, RA[0], RA[1], RB[0], RB[1], 0x02);
  const S2 = sm2KexConfirm(VA[0], VA[1], zA, zB, RA[0], RA[1], RB[0], RB[1], 0x03);
  return { RA, RB, V: VA, K, S1, S2, zA, zB };
}

function assertScalar(x, label) {
  if (x < 1n || x >= n) throw new Error(`${label} 需在 [1, n-1] 范围内`);
}
function assertPublicKey(x, y, label = "SM2 公钥") {
  if (x < 0n || x >= p || y < 0n || y >= p || !onCurve(x, y)) throw new Error(`${label} 不在 sm2p256v1 曲线上`);
  if (ptMul(n, [x, y])[2] !== 0n) throw new Error(`${label} 阶不为 n`);
}

// ============================================================
// 数字签名（GB/T 32918.2-2016 §6.1）
// 输入 M（字节）、私钥 dA、标识 ida → { r, s }（32 字节大端）
// ============================================================
function sm2Sign(m, dA, ida = defaultIda(), pubX = null, pubY = null, kFixed = null) {
  assertScalar(dA, "SM2 私钥");
  if (kFixed != null) assertScalar(kFixed, "SM2 随机数 k");
  // 公钥可选（缺省由 dA 派生）；k 可指定（官方向量用固定 k）
  let px = pubX, py = pubY;
  if (px == null || py == null) {
    const P = ptAffine(ptMul(dA, [Gx, Gy]));
    px = P[0]; py = P[1];
  }
  if (pubX != null || pubY != null) {
    if (pubX == null || pubY == null) throw new Error("SM2 公钥 X/Y 必须同时提供");
    assertPublicKey(pubX, pubY);
    const derived = ptAffine(ptMul(dA, [Gx, Gy]));
    if (derived[0] !== pubX || derived[1] !== pubY) throw new Error("SM2 公钥与私钥不匹配");
  }
  const za = computeZa(ida, px, py);
  const e = bytesToBig(sm3Bytes(concat(za, m)));
  let r = 0n, s = 0n;
  for (let tries = 0; tries < 256; tries++) {
    const k = kFixed != null ? kFixed : randomK();
    const [x1] = ptAffine(ptMul(k, [Gx, Gy]));
    r = mod(e + x1, n);
    if (r === 0n || mod(r + k, n) === 0n) continue;
    s = mod(modInverse(1n + dA, n) * mod(k - r * dA, n), n);
    if (s === 0n) continue;
    return { r, s };
  }
  throw new Error("SM2 签名生成失败（重试超限）");
}

// 验签（GB/T 32918.2-2016 §7.1）
function sm2Verify(m, r, s, pubX, pubY, ida = defaultIda()) {
  if (r < 1n || r > n - 1n || s < 1n || s > n - 1n) return false;
  if (pubX < 0n || pubX >= p || pubY < 0n || pubY >= p || !onCurve(pubX, pubY)) return false;
  if (ptMul(n, [pubX, pubY])[2] !== 0n) return false;
  const za = computeZa(ida, pubX, pubY);
  const e = bytesToBig(sm3Bytes(concat(za, m)));
  const t = mod(r + s, n);
  if (t === 0n) return false;
  const G = [Gx, Gy];
  const R1 = ptMul(s, G);
  const R2 = ptMul(t, [pubX, pubY]);
  const point = ptAffine(ptAdd(R1, R2));
  if (!point) return false;
  return mod(e + point[0], n) === r;
}

// ============================================================
// 公钥加密（GB/T 32918.4-2016 §6.1）
// 输出密文 C = C1(65B 非压缩) ∥ C3(32B) ∥ C2（klen = M 位长）
// format: "c1c3c2"（GB/T 32918.4 序）或 "c1c2c3"（GM/T 0009-2023《SM2密码算法使用规范》序）
// ============================================================
function sm2Encrypt(m, pubX, pubY, kFixed = null, format = "c1c3c2") {
  assertPublicKey(pubX, pubY);
  if (kFixed != null) assertScalar(kFixed, "SM2 随机数 k");
  if (format !== "c1c3c2" && format !== "c1c2c3") throw new Error(`不支持的 SM2 密文格式: ${format}`);
  let x2 = 0n, y2 = 0n, c2 = null, c3 = null;
  for (let tries = 0; tries < 256; tries++) {
    const k = kFixed != null ? kFixed : randomK();
    const C1 = ptAffine(ptMul(k, [Gx, Gy]));
    const S = ptAffine(ptMul(k, [pubX, pubY]));
    if (!S) continue; // S 为无穷远点
    x2 = S[0]; y2 = S[1];
    const klen = m.length * 8;
    const t = sm2Kdf(concat(bigToBytes(x2), bigToBytes(y2)), klen);
    // t 全零检查（按标准重试）
    let allZero = true;
    for (const c of t) if (c !== 0) { allZero = false; break; }
    if (allZero) continue;
    c2 = new Uint8Array(m.length);
    for (let i = 0; i < m.length; i++) c2[i] = m[i] ^ t[i];
    c3 = sm3Bytes(concat(bigToBytes(x2), m, bigToBytes(y2)));
    // 组包 C1||C3||C2 或 C1||C2||C3
    const c1bytes = concat(new Uint8Array([4]), bigToBytes(C1[0]), bigToBytes(C1[1]));
    const cipher = format === "c1c2c3" ? concat(c1bytes, c2, c3) : concat(c1bytes, c3, c2);
    return { cipher, c2, c3, x2, y2 };
  }
  throw new Error("SM2 加密失败（重试超限）");
}

// 解密（GB/T 32918.4-2016 §7.1；format 同加密，c1c2c3 为 GM/T 0009-2023 新序）
function sm2Decrypt(cipher, dB, format = "c1c3c2") {
  assertScalar(dB, "SM2 私钥");
  if (format !== "c1c3c2" && format !== "c1c2c3") throw new Error(`不支持的 SM2 密文格式: ${format}`);
  if (cipher.length < 65 + 32) throw new Error("SM2 密文过短（至少 C1 65B + C3 32B）");
  if (cipher[0] !== 4) throw new Error("SM2 密文 C1 非非压缩点（前缀须为 04）");
  const c1x = bytesToBig(cipher.subarray(1, 33));
  const c1y = bytesToBig(cipher.subarray(33, 65));
  if (!onCurve(c1x, c1y)) throw new Error("SM2 密文 C1 不在曲线上");
  const S = ptAffine(ptMul(dB, [c1x, c1y]));
  if (!S) throw new Error("SM2 解密 [dB]C1 为无穷远点");
  const x2 = S[0], y2 = S[1];
  const klen = (cipher.length - 97) * 8;
  // 按序切 C3/C2
  const tail = cipher.subarray(65);
  const c3 = format === "c1c2c3" ? tail.subarray(tail.length - 32) : tail.subarray(0, 32);
  const c2 = format === "c1c2c3" ? tail.subarray(0, tail.length - 32) : tail.subarray(32);
  const t = sm2Kdf(concat(bigToBytes(x2), bigToBytes(y2)), klen);
  let allZero = true;
  for (const c of t) if (c !== 0) { allZero = false; break; }
  if (allZero) throw new Error("SM2 解密 t 全零");
  const m = new Uint8Array(c2.length);
  for (let i = 0; i < c2.length; i++) m[i] = c2[i] ^ t[i];
  const u = sm3Bytes(concat(bigToBytes(x2), m, bigToBytes(y2)));
  for (let i = 0; i < 32; i++) if (u[i] !== c3[i]) throw new Error("SM2 解密 C3 校验失败（密钥/密文可能错误）");
  return m;
}

// 随机 k ∈ [1, n-1]。SM2 私钥运算禁止弱随机降级。
function randomK() {
  if (typeof crypto === "undefined" || typeof crypto.getRandomValues !== "function") throw new Error("当前环境无密码学安全随机源，无法执行 SM2 签名/加密/密钥交换");
  const bytes = new Uint8Array(32);
  while (true) {
    crypto.getRandomValues(bytes);
    const k = bytesToBig(bytes);
    if (k >= 1n && k < n) return k;
  }
}
function defaultIda() { return new TextEncoder().encode("1234567812345678"); }

// ============================================================
// 加载自检（官方向量，不符即抛错）
// ============================================================
(function selfCheck() {
  const h2b = (s) => { const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o; };
  const eq = (a, b, label) => {
    if (bytesToHex(a) !== b.toLowerCase()) throw new Error(`SM2 自检失败：${label}\n  got  ${bytesToHex(a)}\n  want ${b}`);
  };
  const dA = 0x3945208F7B2144B13F36E38AC6D39F95889393692860B51A42FB81EF4DF7C5B8n;
  const pubX = 0x09F9DF311E5421A150DD7D161E4BC5C672179FAD1833FC076BB08FF356F35020n;
  const pubY = 0xCCEA490CE26775A52DC6EA718CC1AA600AED05FBF35E084A6632F6072DA9AD13n;
  const ida = h2b("31323334353637383132333435363738");
  const k = 0x59276E27D506861A16680F3AD9C02DCCEF3CC1FA3CDBE4CE6D54B80DEAC1BC21n;
  const M = new TextEncoder().encode("message digest");

  // ① ZA
  const za = computeZa(ida, pubX, pubY);
  eq(za, "B2E14C5C79C6DF5B85F4FE7ED8DB7A262B9DA7E07CCB0EA9F4747B8CCDA8A4F3", "ZA");

  // ② 签名（固定 k）
  const sig = sm2Sign(M, dA, ida, pubX, pubY, k);
  eq(bigToBytes(sig.r), "F5A03B0648D2C4630EEAC513E1BB81A15944DA3827D5B74143AC7EACEEE720B3", "r");
  eq(bigToBytes(sig.s), "B1B6AA29DF212FD8763182BC0D421CA1BB9038FD1F7F42D4840B69C485BBC1AA", "s");

  // ③ 验签
  if (!sm2Verify(M, sig.r, sig.s, pubX, pubY, ida)) throw new Error("SM2 自检失败：验签（官方向量）");

  // ④ 加密（固定 k，M="encryption standard"）
  const M2 = new TextEncoder().encode("encryption standard");
  const enc = sm2Encrypt(M2, pubX, pubY, k);
  eq(enc.cipher,
    "04" +
    "04EBFC718E8D1798620432268E77FEB6415E2EDE0E073C0F4F640ECD2E149A73" +
    "E858F9D81E5430A57B36DAAB8F950A3C64E6EE6A63094D99283AFF767E124DF0" +
    "59983C18F809E262923C53AEC295D30383B54E39D609D160AFCB1908D0BD8766" +
    "21886CA989CA9C7D58087307CA93092D651EFA", "加密 C1||C3||C2");

  // ⑤ 解密
  const m2 = sm2Decrypt(enc.cipher, dA);
  if (new TextDecoder().decode(m2) !== "encryption standard") throw new Error("SM2 自检失败：解密");

  // ⑥ 密钥交换（GB/T 32918.3-2016 附录 A.2 官方向量）
  // 注：该示例用标准附录的示例曲线（p=8542D69E…，非 sm2p256v1），故公式级对拍：
  // xTilde / KDF 拼接 / 确认值 S 公式（均与曲线无关），协议自洽另用随机密钥对验证。
  const vx = 0x47C826534DC2F6F1FBF28728DD658F21E174F48179ACEF2900F8B7F566E40905n;
  const vy = 0x2AF86EFE732CF12AD0E09A1F2556CC650D9CCCE3E249866BBB5C6846A4C4A295n;
  const rax = 0x6CB5633816F4DD560B1DEC458310CBCC6856C09505324A6D23150C408F162BF0n;
  const rbx = 0x1799B2A2C778295300D9A2325C686129B8F2B5337B3DCF4514E8BBC19D900EE5n;
  const zaK = h2b("E4D1D0C3CA4C7F11BC8FF8CB3F4C02A78F108FA098E51A668487240F75E20F31");
  const zbK = h2b("6B4B6D0E276691BD4A11BF72F4FB501AE309FDACB72FA6CC336E6656119ABD67");
  const ry1 = h2b("6CB5633816F4DD560B1DEC458310CBCC6856C09505324A6D23150C408F162BF0");
  const ry2 = h2b("1799B2A2C778295300D9A2325C686129B8F2B5337B3DCF4514E8BBC19D900EE5");
  // x_ = 2^127 + (x & (2^127-1))：官方 x1_=E856C095…，x2_=B8F2B533…（高 16 字节全 0）
  eq(bigToBytes(xTilde(rax)), "00000000000000000000000000000000E856C09505324A6D23150C408F162BF0", "KEX x1_");
  eq(bigToBytes(xTilde(rbx)), "00000000000000000000000000000000B8F2B5337B3DCF4514E8BBC19D900EE5", "KEX x2_");
  // KDF(xV‖yV‖ZA‖ZB, 128) = 55B0AC62…
  const kk = sm2KexKdf(vx, vy, zaK, zbK, 128);
  eq(kk, "55B0AC62A6B927BA23703832C853DED4", "KEX K(128bit)");
  // H = SM3(xV‖ZA‖ZB‖x1‖y1‖x2‖y2) = FF49D95B…；S1 = SM3(0x02‖yV‖H) = 284C8F19…；S2 = SM3(0x03‖yV‖H) = 23444DAF…
  const H = sm3Bytes(concat(bigToBytes(vx), zaK, zbK, ry1, h2b("0D6FCF62F1036C0A1B6DACCF57399223A65F7D7BF2D9637E5BBBEB857961BF1A"), ry2, h2b("54C9288C82733EFDF7808AE7F27D0E732F7C73A7D9AC98B7D8740A91D0DB3CF4")));
  eq(H, "FF49D95BD45FCE99ED54A8AD7A7091109F51394442916BD154D1DE4379D97647", "KEX H");
  eq(sm3Bytes(concat(new Uint8Array([0x02]), bigToBytes(vy), H)), "284C8F198F141B502E81250F1581C7E9EEB4CA6990F9E02DF388B45471F5BC5C", "KEX S1");
  eq(sm3Bytes(concat(new Uint8Array([0x03]), bigToBytes(vy), H)), "23444DAF8ED7534366CB901C84B3BDBB63504F4065C1116C91A4C00697E6CF7A", "KEX S2");
  // 协议自洽：随机密钥对双方共享点/密钥一致
  const kexSelf = sm2KeyExchange(0x1234567890ABCDEF1234567890ABCDEFn, 0xFEDCBA0987654321FEDCBA0987654321n, 0x11111111111111111111111111111111n, 0x22222222222222222222222222222222n, ida, ida, 128);
  if (kexSelf.K.length === 0) throw new Error("SM2 自检失败：KEX 协议自洽");
  // 双方共享点一致已由 sm2KeyExchange 内部断言（VA===VB）

  // ⑦ 新序 C1||C2||C3（GM/T 0009-2023）往返
  const M3 = new TextEncoder().encode("gm0009 new order");
  const encNew = sm2Encrypt(M3, pubX, pubY, null, "c1c2c3");
  const m3 = sm2Decrypt(encNew.cipher, dA, "c1c2c3");
  if (new TextDecoder().decode(m3) !== "gm0009 new order") throw new Error("SM2 自检失败：新序 C1||C2||C3 往返");
})();

// ============================================================
// register（GB/T 32918-2016 全功能 op）
// ============================================================
const ENC_OPTS = [
  { value: "utf8", label: "UTF-8" },
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
];
function encDecode(s, enc) {
  if (enc === "hex") return hexToBytes(s);
  if (enc === "base64") { const bin = atob(s.replace(/\s/g, "")); const o = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return o; }
  return new TextEncoder().encode(s);
}
function encEncode(b, enc) {
  if (enc === "hex") return bytesToHex(b);
  if (enc === "base64") { let bin = ""; for (const x of b) bin += String.fromCharCode(x); return btoa(bin); }
  return new TextDecoder("utf-8").decode(b);
}
function parseBigHex(s, label) {
  const t = String(s == null ? "" : s).trim();
  if (!t) throw new Error(`缺少参数 ${label}（hex）`);
  return BigInt("0x" + t.replace(/[^0-9a-fA-F]/g, ""));
}

register({
  id: "sm2",
  cat: "modern",
  name: "SM2",
  desc: "国密椭圆曲线公钥密码（GB/T 32918-2016，前身 GM/T 0003-2012）。签名/验签 + 加密/解密 + 密钥交换，曲线 sm2p256v1，哈希 SM3",
  params: [
    { key: "mode", label: "操作", type: "select", default: "encrypt", options: [
      { value: "encrypt", label: "加密" },
      { value: "decrypt", label: "解密" },
      { value: "sign", label: "签名" },
      { value: "verify", label: "验签" },
      { value: "keyExchange", label: "密钥交换" },
    ] },
    { key: "privKey", label: "私钥（hex）", type: "text", default: "", placeholder: "32 字节 hex（签名/解密用）" },
    { key: "privKeyB", label: "对方私钥（hex）", type: "text", default: "", placeholder: "32 字节 hex（密钥交换用）" },
    { key: "pubX", label: "公钥 X（hex）", type: "text", default: "", placeholder: "32 字节 hex（加密/验签用）" },
    { key: "pubY", label: "公钥 Y（hex）", type: "text", default: "", placeholder: "32 字节 hex" },
    { key: "ida", label: "标识 ID_A", type: "text", default: "1234567812345678", placeholder: "签名/验签用（默认官方样例 ID）" },
    { key: "idaB", label: "标识 ID_B", type: "text", default: "ALICE123@YAHOO.COM", placeholder: "密钥交换用 ID_B（默认官方样例）" },
    { key: "klen", label: "共享密钥长度(bit)", type: "number", default: 128, placeholder: "密钥交换 KDF 输出位长" },
    { key: "format", label: "密文格式", type: "select", default: "c1c3c2", options: [
      { value: "c1c3c2", label: "C1||C3||C2（GB/T 32918.4 序）" },
      { value: "c1c2c3", label: "C1||C2||C3（GM/T 0009-2023 序）" },
    ] },
    { key: "r", label: "验签 r（hex）", type: "text", default: "", placeholder: "32 字节 hex" },
    { key: "s", label: "验签 s（hex）", type: "text", default: "", placeholder: "32 字节 hex" },
    { key: "dataEnc", label: "输入编码", type: "select", default: "utf8", options: ENC_OPTS },
    { key: "outEnc", label: "输出编码", type: "select", default: "hex", options: ENC_OPTS },
  ],
  run: (text, p) => {
    const mode = p.mode || "encrypt";
    const ida = encDecode(p.ida || "1234567812345678", "utf8");
    const format = p.format || "c1c3c2";
    if (mode === "encrypt") {
      const data = encDecode(text, p.dataEnc || "utf8");
      const px = parseBigHex(p.pubX, "公钥 X"), py = parseBigHex(p.pubY, "公钥 Y");
      return encEncode(sm2Encrypt(data, px, py, null, format).cipher, p.outEnc || "hex");
    }
    if (mode === "decrypt") {
      const data = encDecode(text, p.outEnc || "hex");
      const d = parseBigHex(p.privKey, "私钥");
      return encEncode(sm2Decrypt(data, d, format), "utf8");
    }
    if (mode === "sign") {
      const data = encDecode(text, p.dataEnc || "utf8");
      const d = parseBigHex(p.privKey, "私钥");
      const px = p.pubX ? parseBigHex(p.pubX, "公钥 X") : null;
      const py = p.pubY ? parseBigHex(p.pubY, "公钥 Y") : null;
      const { r, s } = sm2Sign(data, d, ida, px, py);
      return encEncode(concat(bigToBytes(r), bigToBytes(s)), p.outEnc || "hex");
    }
    if (mode === "verify") {
      const data = encDecode(text, p.dataEnc || "utf8");
      const px = parseBigHex(p.pubX, "公钥 X"), py = parseBigHex(p.pubY, "公钥 Y");
      const r = parseBigHex(p.r, "r"), s = parseBigHex(p.s, "s");
      return sm2Verify(data, r, s, px, py, ida) ? "✓ 签名有效（SM2 验签通过）" : "✗ 签名无效";
    }
    if (mode === "keyExchange") {
      const dA = parseBigHex(p.privKey, "本方私钥");
      const dB = parseBigHex(p.privKeyB, "对方私钥");
      const klen = Number(p.klen) || 128;
      if (!Number.isSafeInteger(klen) || klen < 1 || klen > 65536) throw new Error("SM2 共享密钥长度需为 1..65536 bit");
      const idaB = encDecode(p.idaB || "ALICE123@YAHOO.COM", "utf8");
      const kex = sm2KeyExchange(dA, dB, randomK(), randomK(), ida, idaB, klen);
      return [
        "SM2 密钥交换（GB/T 32918.3-2016，sm2p256v1）",
        `本方临时点 R_A = 04${bytesToHex(concat(bigToBytes(kex.RA[0]), bigToBytes(kex.RA[1])))}`,
        `对方临时点 R_B = 04${bytesToHex(concat(bigToBytes(kex.RB[0]), bigToBytes(kex.RB[1])))}`,
        `共享密钥 K(${klen}bit) = ${bytesToHex(kex.K)}`,
        `S1 确认值 = ${bytesToHex(kex.S1)}`,
        `S2 确认值 = ${bytesToHex(kex.S2)}`,
      ].join("\n");
    }
    throw new Error(`未知 SM2 操作: ${mode}`);
  },
  detect: (text) => {
    // SM2 密文结构识别（04 前缀 + 长 65B 非压缩点）
    const t = text.trim();
    const hexClean = t.replace(/[^0-9a-fA-F]/g, "");
    if (hexClean.length >= 194 && /^04/i.test(hexClean)) return 0.7;
    try {
      const bytes = encDecode(t, "base64");
      if (bytes.length >= 97 && bytes[0] === 0x04) return 0.6;
    } catch { /* ignore */ }
    return 0;
  },
});

// 导出核心（独立可摘取）
export { sm2Sign, sm2Verify, sm2Encrypt, sm2Decrypt, sm2Kdf, sm2KeyExchange, sm2KexKdf, sm2KexConfirm, computeZa, CURVE, ptMul, ptAdd, ptAffine, onCurve };
