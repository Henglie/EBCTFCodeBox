/*
 * sm9ops.js — SM9 国密标识密码五操作（GB/T 38635-2020，前身 GM/T 0044-2016）。
 *
 * 五档族（family:"sm9" + familyLabel，族滑块机制同 sm2）：
 * - sm9KeyGen（keygen）签名 ks / 加密 ke 双主密钥 + 指定 uid 用户密钥派生
 * - sm9Sign（sign）标识签名：签名主公钥 + 用户私钥 + 消息 → (h, S)
 * - sm9Verify（verify）标识验签：签名主公钥 + uid + hid + 消息 + (h,S) → 有效/无效
 * - sm9Encrypt（encrypt）标识加密：加密主公钥 + uid + hid + 明文 → C1‖C3‖C2（GB/T 38635.4 口径）
 * - sm9Decrypt（decrypt）标识解密：用户加密私钥 + uid + 密文 → 明文（C3 校验失败报错）
 *
 * 双线性对内核在 pairing.js（BN 曲线 R-ate pairing，256 位安全）。协议流程逐行对照
 * github.com/emmansun/gmsm（MIT）internal/sm9/sm9.go / sm9_key.go / kat.go：
 * - 用户密钥：t1 = H1(uid‖hid)+d (mod n)；t2 = d·t1⁻¹；签名私钥 [t2]G1，加密私钥 [t2]G2；
 *   用户公钥 = [H1(uid‖hid)]G + Ppub（签名在 G2、加密在 G1）
 * - 签名：g = e(G1, Ppub_s)；w = g^r；h = H2(M‖GT(w))；S = [r−h]dA
 * - 验签：u = e(S, P_user)；t = g^h；h2 = H2(M‖GT(u·t))；h2 == h 即有效
 * - 加密：QB = [H1(uid‖hid)]G1 + Ppub_e；C1 = [r]QB（64B x‖y）；w = g^r；
 *   K = KDF(C1‖GT(w)‖uid, mlen+32)；C2 = M⊕K[0..mlen]；C3 = SM3(C2‖K2)
 *   （C3 组装序 C2 在前 K2 在后，gmsm / BouncyCastle / GmSSL 三方实现一致）
 * - 解密：w′ = e(dB, C1)；K 同式重导；SM3(C2‖K2) == C3 校验后异或出明文
 *
 * 序列化口径（对齐 gmsm Marshal）：G1 = 64B 大端 x‖y（非压缩加 04 前缀共 65B）；
 * G2 = 128B（x.u‖x.c‖y.u‖y.c，非压缩 129B）；GT = 192B（12×32B，gfp12 序）；
 * 标量 = 32B 大端。KAT：GB/T 38635.2-2020 附录 A（与 gmsm kat.go 同源向量）。
 *
 * 北极星：算法层零 UI 依赖、纯函数、协议函数全部导出，可独立摘取当权威源。
 */
import { register } from "./registry.js";
import { sm3Bytes } from "./hashExt.js";
import {
  SM9_N, G1_GEN, G2_GEN,
  hexToBytes, bytesToHex, concatBytes,
  sm9RandomScalar,
  g1Add, g1Mul, g1Affine, g1Marshal, g1MarshalUncompressed, g1Unmarshal,
  g2Add, g2Mul, g2Affine, g2Marshal, g2MarshalUncompressed, g2Unmarshal,
  pairing, gtMul, gtExp, gtMarshal, sm9H1, sm9H2, sm9Kdf,
} from "./pairing.js";

// ============================================================
// 基础工具（模运算 / 异或 / 比较；Fp2 单位元 {x:0, y:1}，见 pairing.js 存储序）
// ============================================================
const N = SM9_N;
function modN(a) { const r = a % N; return r < 0n ? r + N : r; }
function modInvN(a) {
  // 扩展欧几里得求逆（n 为素数，a ≠ 0 mod n 时必存在）
  let oldR = modN(a), r = N, oldS = 1n, s = 0n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  if (oldR !== 1n) throw new Error("SM9：模逆不存在（输入 ≡ 0 mod n）");
  return modN(oldS);
}
function xorBytes(a, b) {
  const o = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) o[i] = a[i] ^ b[i];
  return o;
}
function allZero(b) { for (const x of b) if (x !== 0) return false; return true; }
function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
const F2_ONE = () => ({ x: 0n, y: 1n });

// 仿射 ↔ 雅可比包装（pairing.js 的 g1Mul/g2Add 接雅可比 [X,Y,Z]）
export function g1MulAff(k, pt) { return g1Affine(g1Mul(k, [pt[0], pt[1], 1n])); }
export function g2MulAff(k, pt) { return g2Affine(g2Mul(k, [pt[0], pt[1], F2_ONE()])); }
function g1AddAff(a, b) { return g1Affine(g1Add([a[0], a[1], 1n], [b[0], b[1], 1n])); }
function g2AddAff(a, b) { return g2Affine(g2Add([a[0], a[1], F2_ONE()], [b[0], b[1], F2_ONE()])); }

// uid/hid 拼接（H1 输入 Z = uid‖hid）
// uid 统一字节化：字符串按 UTF-8（GB/T IDB 为字节串；此前 Uint8Array.from(字符串) 会产生全零字节，KAT 不符）
function uidBytes(u) { return typeof u === "string" ? new TextEncoder().encode(u) : u; }
function uidHid(uid, hid) {
  return concatBytes(uidBytes(uid), Uint8Array.of(hid));
}

// ============================================================
// 密钥体系（GB/T 38635.2-2020 第 6-7 章；对照 gmsm sm9_key.go）
// ============================================================
// 签名主公钥 Ppub_s = [ks]G2（G2 点，仿射）
export function sm9SignMasterPub(ks) {
  return g2MulAff(ks, G2_GEN);
}
// 加密主公钥 Ppub_e = [ke]G1（G1 点，仿射）
export function sm9EncryptMasterPub(ke) {
  return g1MulAff(ke, G1_GEN);
}
// 签名用户私钥 dA = [t2]G1；t2 = ks·(H1(uid‖hid)+ks)⁻¹ mod n
export function sm9UserSignKey(ks, uid, hid) {
  const t1 = modN(sm9H1(uidHid(uid, hid)) + ks);
  if (t1 === 0n) throw new Error("SM9：H1(uid‖hid)+ks ≡ 0 (mod n)，需更换签名主密钥");
  return g1MulAff(modN(ks * modInvN(t1)), G1_GEN);
}
// 加密用户私钥 dB = [t2]G2；t2 同上（ke 代替 ks）
export function sm9UserEncryptKey(ke, uid, hid) {
  const t1 = modN(sm9H1(uidHid(uid, hid)) + ke);
  if (t1 === 0n) throw new Error("SM9：H1(uid‖hid)+ke ≡ 0 (mod n)，需更换加密主密钥");
  return g2MulAff(modN(ke * modInvN(t1)), G2_GEN);
}
// 签名用户公钥 PA = [H1(uid‖hid)]G2 + Ppub_s（G2 点）
export function sm9UserSignPub(uid, hid, masterPubG2) {
  return g2AddAff(g2MulAff(sm9H1(uidHid(uid, hid)), G2_GEN), masterPubG2);
}
// 加密用户公钥 QB = [H1(uid‖hid)]G1 + Ppub_e（G1 点）
export function sm9UserEncryptPub(uid, hid, masterPubG1) {
  return g1AddAff(g1MulAff(sm9H1(uidHid(uid, hid)), G1_GEN), masterPubG1);
}

// ============================================================
// 签名 / 验签（GB/T 38635.2-2020 第 8 章；对照 gmsm sm9.go Sign/Verify）
// ============================================================
// msg：明文字节；masterPubG2：签名主公钥（G2 仿射）；userPrivG1：用户签名私钥（G1 仿射）；
// fixedR：BigInt|null（固定 r 用于 KAT 复现，null 则随机）
export function sm9Sign(msg, masterPubG2, userPrivG1, fixedR) {
  const g = pairing([G1_GEN[0], G1_GEN[1]], masterPubG2); // g = e(G1, Ppub_s)
  let rr, h, S;
  for (let attempt = 0; ; attempt++) {
    rr = fixedR == null ? sm9RandomScalar() : modN(fixedR);
    if (rr === 0n) throw new Error("SM9：随机数 r 须在 [1, n-1]");
    const w = gtExp(g, rr);
    h = sm9H2(concatBytes(msg, gtMarshal(w)));
    const s = modN(rr - h);
    if (s !== 0n) { S = g1MulAff(s, userPrivG1); break; }
    if (fixedR != null) throw new Error("SM9：固定 r 下 r−h ≡ 0 (mod n)，无法生成签名");
    if (attempt >= 128) throw new Error("SM9：签名重试次数超限（异常）");
  }
  return { h, S };
}
// 验签：h（BigInt）/S（G1 仿射点）→ bool
export function sm9Verify(msg, uid, hid, masterPubG2, h, S) {
  if (h <= 0n || h >= N) return false;
  const g = pairing([G1_GEN[0], G1_GEN[1]], masterPubG2);
  const t = gtExp(g, h); // g^h
  const pUser = sm9UserSignPub(uid, hid, masterPubG2);
  const u = pairing(S, pUser); // e(S, PA)
  const w = gtMul(u, t); // u·t
  const h2 = sm9H2(concatBytes(msg, gtMarshal(w)));
  return h2 === h;
}

// ============================================================
// 密钥封装 / 解封装（GB/T 38635.4-2020；对照 gmsm sm9.go WrapKey/UnwrapKey）
// ============================================================
// 返回 { key, cipher }：cipher 为 C1 的 65B 非压缩（04‖x‖y）
export function sm9WrapKey(uid, hid, masterPubG1, klen, fixedR) {
  if (!Number.isSafeInteger(klen) || klen <= 0) throw new Error("SM9：封装密钥长度需为正整数（字节）");
  const q = sm9UserEncryptPub(uid, hid, masterPubG1);
  let rr, c, key;
  for (let attempt = 0; ; attempt++) {
    rr = fixedR == null ? sm9RandomScalar() : modN(fixedR);
    if (rr === 0n) throw new Error("SM9：随机数 r 须在 [1, n-1]");
    c = g1MulAff(rr, q); // C1 = [r]QB
    const g = pairing(masterPubG1, [G2_GEN[0], G2_GEN[1]]); // g = e(Ppub_e, G2)
    const w = gtExp(g, rr);
    key = sm9Kdf(concatBytes(g1Marshal(c), gtMarshal(w), uidBytes(uid)), klen);
    if (!allZero(key)) break;
    if (fixedR != null) throw new Error("SM9：固定 r 下 KDF 输出全零");
    if (attempt >= 128) throw new Error("SM9：封装重试次数超限（异常）");
  }
  return { key, cipher: g1MarshalUncompressed(c) };
}
// cipher：C1（64B 裸或 65B 04 前缀）
export function sm9UnwrapKey(uid, cipher, userPrivG2, klen) {
  let d = cipher;
  if (d.length === 65 && d[0] === 0x04) d = d.slice(1);
  if (d.length !== 64) throw new Error("SM9：封装密文须为 64 字节 C1（或 65 字节 04 前缀）");
  const c1 = g1Unmarshal(d);
  const w = pairing(c1, userPrivG2); // w′ = e(C1, dB)
  const key = sm9Kdf(concatBytes(d, gtMarshal(w), uidBytes(uid)), klen);
  if (allZero(key)) throw new Error("SM9：解封装失败（KDF 输出全零）");
  return key;
}

// ============================================================
// 加密 / 解密（GB/T 38635.4-2020；对照 gmsm sm9.go encrypt/decrypt、kat.go KATEncryptSample）
// ============================================================
// 输出 C1‖C3‖C2：C1 = 64B 裸 x‖y（GB/T 38635.4 口径）；C3 = SM3(C2‖K2)；C2 = M⊕K1
export function sm9Encrypt(msg, uid, hid, masterPubG1, fixedR) {
  if (!msg || msg.length === 0) throw new Error("SM9：明文不能为空");
  const q = sm9UserEncryptPub(uid, hid, masterPubG1);
  let rr, c1, k;
  for (let attempt = 0; ; attempt++) {
    rr = fixedR == null ? sm9RandomScalar() : modN(fixedR);
    if (rr === 0n) throw new Error("SM9：随机数 r 须在 [1, n-1]");
    c1 = g1MulAff(rr, q); // C1 = [r]QB
    const g = pairing(masterPubG1, [G2_GEN[0], G2_GEN[1]]);
    const w = gtExp(g, rr);
    k = sm9Kdf(concatBytes(g1Marshal(c1), gtMarshal(w), uidBytes(uid)), msg.length + 32);
    if (!allZero(k)) break;
    if (fixedR != null) throw new Error("SM9：固定 r 下 KDF 输出全零");
    if (attempt >= 128) throw new Error("SM9：加密重试次数超限（异常）");
  }
  const c2 = xorBytes(msg, k.slice(0, msg.length)); // C2 = M ⊕ K1
  const c3 = sm3Bytes(concatBytes(c2, k.slice(msg.length))); // C3 = SM3(C2‖K2)
  return concatBytes(g1Marshal(c1), c3, c2);
}
// cipher：C1‖C3‖C2（C1 可带 04 前缀）；C3 校验失败抛错
export function sm9Decrypt(cipher, uid, userPrivG2) {
  const attempts = [];
  if (cipher.length >= 97 && cipher[0] === 0x04) attempts.push(cipher.slice(1)); // 先按 04 前缀试
  attempts.push(cipher); // 再按裸 C1 试（首字节恰为 04 的合法密文）
  let lastErr = null;
  for (const d of attempts) {
    if (d.length < 97) { lastErr = new Error("SM9：密文过短（最少 64+32+1=97 字节）"); continue; }
    try {
      const c1 = g1Unmarshal(d.slice(0, 64));
      const c3 = d.slice(64, 96);
      const c2 = d.slice(96);
      const w = pairing(c1, userPrivG2); // w′ = e(C1, dB)
      const k = sm9Kdf(concatBytes(d.slice(0, 64), gtMarshal(w), uidBytes(uid)), c2.length + 32);
      if (allZero(k)) throw new Error("SM9：KDF 输出全零（解密失败）");
      const c3v = sm3Bytes(concatBytes(c2, k.slice(c2.length)));
      if (!bytesEqual(c3v, c3)) throw new Error("SM9：C3 校验失败（密文被篡改或 uid/私钥不匹配）");
      return xorBytes(c2, k.slice(0, c2.length));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("SM9：解密失败");
}

// ============================================================
// 密钥交换（GB/T 38635.3-2020；对照 gmsm sm9.go KeyExchange 流程；内部函数，供 KAT 验证）
// ============================================================
// gmsm sign(isResponder, prefix)：SM3(g2‖g3‖[resp: peerUID‖uid‖peerSecret‖secret | init: uid‖peerUID‖secret‖peerSecret])
// 再 SM3(prefix ‖ g1 ‖ buffer)；secret/peerSecret 为 65B 非压缩（取 [1:] 去 04 前缀）
function kexSign(isResponder, prefix, g1, g2, g3, uid, peerUID, secret, peerSecret) {
  let buf = concatBytes(gtMarshal(g2), gtMarshal(g3));
  if (isResponder) buf = concatBytes(buf, uidBytes(peerUID), uidBytes(uid), peerSecret.slice(1), secret.slice(1));
  else buf = concatBytes(buf, uidBytes(uid), uidBytes(peerUID), secret.slice(1), peerSecret.slice(1));
  return sm3Bytes(concatBytes(Uint8Array.of(prefix), gtMarshal(g1), sm3Bytes(buf)));
}
function kexKey(isResponder, uid, peerUID, secret, peerSecret, g1, g2, g3, keyLen) {
  let buf;
  if (isResponder) buf = concatBytes(uidBytes(peerUID), uidBytes(uid), peerSecret.slice(1), secret.slice(1));
  else buf = concatBytes(uidBytes(uid), uidBytes(peerUID), secret.slice(1), peerSecret.slice(1));
  buf = concatBytes(buf, gtMarshal(g1), gtMarshal(g2), gtMarshal(g3));
  return sm9Kdf(buf, keyLen);
}
// 一次跑完整交换流（固定 rA/rB，纯函数）：A 发起、B 响应，双向 sig 校验 + 双方导出密钥
// 返回 { rAData, rBData, sigB, sigA, keyA, keyB }
export function sm9KeyExchange(uidA, uidB, hid, masterPubG1, privA, privB, rA, rB, keyLen) {
  // A1-A4：rAData = [rA]QB
  const pubB = sm9UserEncryptPub(uidB, hid, masterPubG1);
  const rAData = g1MarshalUncompressed(g1MulAff(rA, pubB));
  // B1-B7：rBData = [rB]QA；g1 = e(rA, dB)；g3 = g1^rB；g2 = g^rB；sigB
  const pubA = sm9UserEncryptPub(uidA, hid, masterPubG1);
  const rBData = g1MarshalUncompressed(g1MulAff(rB, pubA));
  const g = pairing(masterPubG1, [G2_GEN[0], G2_GEN[1]]);
  const g1r = pairing(g1Unmarshal(rAData), privB);
  const g3r = gtExp(g1r, rB);
  const g2r = gtExp(g, rB);
  const sigB = kexSign(true, 0x82, g1r, g2r, g3r, uidB, uidA, rBData, rAData);
  // A5-A8：g1 = g^rA；g2 = e(rB, dA)；g3 = g2^rA；验 sigB；导 keyA、sigA
  const g1i = gtExp(g, rA);
  const g2i = pairing(g1Unmarshal(rBData), privA);
  const g3i = gtExp(g2i, rA);
  const sigBCheck = kexSign(false, 0x82, g1i, g2i, g3i, uidA, uidB, rAData, rBData);
  if (!bytesEqual(sigBCheck, sigB)) throw new Error("SM9 密钥交换：响应方签名校验失败");
  const keyA = kexKey(false, uidA, uidB, rAData, rBData, g1i, g2i, g3i, keyLen);
  const sigA = kexSign(false, 0x83, g1i, g2i, g3i, uidA, uidB, rAData, rBData);
  // B8：验 sigA，导 keyB
  const sigACheck = kexSign(true, 0x83, g1r, g2r, g3r, uidB, uidA, rBData, rAData);
  if (!bytesEqual(sigACheck, sigA)) throw new Error("SM9 密钥交换：发起方签名校验失败");
  const keyB = kexKey(true, uidB, uidA, rBData, rAData, g1r, g2r, g3r, keyLen);
  return { rAData, rBData, sigB, sigA, keyA, keyB };
}

// ============================================================
// op 参数框辅助（hex 解析；风格参照 sm2.js）
// ============================================================
const ENC_OPTS = [
  { value: "utf8", label: "UTF-8" },
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
];
function encDecode(s, enc) {
  if (enc === "hex") return hexToBytes(s);
  if (enc === "base64") {
    const bin = atob(String(s).replace(/\s/g, ""));
    const o = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
    return o;
  }
  return new TextEncoder().encode(s);
}
function encEncode(b, enc) {
  if (enc === "hex") return bytesToHex(b);
  if (enc === "base64") {
    let bin = "";
    for (const x of b) bin += String.fromCharCode(x);
    return btoa(bin);
  }
  return new TextDecoder("utf-8").decode(b);
}
function parseScalarHex(s, label) {
  const t = String(s == null ? "" : s).trim();
  if (!t) throw new Error(`缺少参数 ${label}（hex）`);
  const clean = t.replace(/[^0-9a-fA-F]/g, "");
  if (!clean) throw new Error(`参数 ${label} 不是合法 hex`);
  const v = BigInt("0x" + clean);
  if (v <= 0n || v >= N) throw new Error(`参数 ${label} 须在 [1, n-1]（32 字节 hex）`);
  return v;
}
function parseOptionalScalarHex(s, label) {
  const t = String(s == null ? "" : s).trim();
  return t ? parseScalarHex(t, label) : null;
}
function parseHid(s, def) {
  const t = String(s == null ? "" : s).trim().replace(/^0[xX]/, "").replace(/[^0-9a-fA-F]/g, "");
  if (!t) return def;
  const v = parseInt(t, 16);
  if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error("SM9：hid 须为 1 字节（hex，如 01/02/03）");
  return v;
}
function parseG1Hex(s, label) {
  try {
    return g1Unmarshal(hexToBytes(String(s == null ? "" : s)));
  } catch (e) {
    throw new Error(`参数 ${label}：${e && e.message ? e.message : e}`);
  }
}
function parseG2Hex(s, label) {
  try {
    return g2Unmarshal(hexToBytes(String(s == null ? "" : s)));
  } catch (e) {
    throw new Error(`参数 ${label}：${e && e.message ? e.message : e}`);
  }
}

// ============================================================
// 五档 op 注册（family:"sm9"；familyLabel → i18n fam.lbl.*，零新增文案）
// ============================================================

// ---- 档① 密钥生成 ----
register({
  id: "sm9KeyGen",
  cat: "asym",
  family: "sm9",
  familyLabel: "keygen",
  name: "SM9 密钥生成",
  desc: "SM9 标识密码密钥体系生成（GB/T 38635.2-2020）：签名 ks/加密 ke 双主密钥对（随机，可注入固定值复现向量）+ 按指定 uid 派生用户签名私钥（G1）/加密私钥（G2）与用户公钥。KGC 模式：用户公钥=标识，无需证书",
  params: [
    { key: "uid", label: "用户标识 uid", type: "text", default: "Alice", placeholder: "如 Alice / 邮箱 / 手机号（即公钥）" },
    { key: "ks", label: "签名主私钥 ks（hex，可选）", type: "text", default: "", placeholder: "留空随机；32 字节 hex（KAT 复现用）" },
    { key: "ke", label: "加密主私钥 ke（hex，可选）", type: "text", default: "", placeholder: "留空随机；32 字节 hex（KAT 复现用）" },
  ],
  run: (text, p) => {
    const uid = new TextEncoder().encode(String(p.uid == null || p.uid === "" ? "Alice" : p.uid));
    const ks = parseOptionalScalarHex(p.ks, "签名主私钥") ?? sm9RandomScalar();
    const ke = parseOptionalScalarHex(p.ke, "加密主私钥") ?? sm9RandomScalar();
    const signPub = sm9SignMasterPub(ks);
    const encPub = sm9EncryptMasterPub(ke);
    const dA = sm9UserSignKey(ks, uid, 0x01);
    const dB = sm9UserEncryptKey(ke, uid, 0x03);
    const pA = sm9UserSignPub(uid, 0x01, signPub);
    const qB = sm9UserEncryptPub(uid, 0x03, encPub);
    return [
      `SM9 密钥体系（GB/T 38635-2020；uid="${new TextDecoder().decode(uid)}"，hid 签名=01 加密=03）`,
      "────────────────────",
      "【签名体系】",
      `签名主私钥 ks = ${bytesToHex(scalarBytes(ks))}（⚠ 敏感，KGC 保管）`,
      `签名主公钥 Ppub_s（G2，129B）= ${bytesToHex(g2MarshalUncompressed(signPub))}`,
      `用户签名私钥 dA（G1，65B）= ${bytesToHex(g1MarshalUncompressed(dA))}（⚠ 敏感）`,
      `用户签名公钥 PA（G2，129B）= ${bytesToHex(g2MarshalUncompressed(pA))}`,
      "【加密体系】",
      `加密主私钥 ke = ${bytesToHex(scalarBytes(ke))}（⚠ 敏感，KGC 保管）`,
      `加密主公钥 Ppub_e（G1，65B）= ${bytesToHex(g1MarshalUncompressed(encPub))}`,
      `用户加密私钥 dB（G2，129B）= ${bytesToHex(g2MarshalUncompressed(dB))}（⚠ 敏感）`,
      `用户加密公钥 QB（G1，65B）= ${bytesToHex(g1MarshalUncompressed(qB))}`,
      "────────────────────",
      "用法：签名档填 Ppub_s + dA；验签档填 Ppub_s + uid；加密档填 Ppub_e + uid；解密档填 dB。",
    ].join("\n");
  },
});

// ---- 档② 签名 ----
register({
  id: "sm9Sign",
  cat: "asym",
  family: "sm9",
  familyLabel: "sign",
  name: "SM9 签名",
  desc: "SM9 标识数字签名（GB/T 38635.2-2020）：签名主公钥（G2）+ 用户签名私钥（G1）+ 消息 → 签名 (h, S)。h 为 32 字节 hex，S 为 G1 点 65 字节（04‖x‖y）。支持固定 r 复现官方向量",
  params: [
    { key: "masterPub", label: "签名主公钥 Ppub_s（hex）", type: "text", default: "", placeholder: "G2 点 129 字节（04 前缀）或 128 字节" },
    { key: "userPriv", label: "用户签名私钥 dA（hex）", type: "text", default: "", placeholder: "G1 点 65 字节（04 前缀）或 64 字节" },
    { key: "uid", label: "用户标识 uid", type: "text", default: "Alice", placeholder: "签名人标识（派生 dA 时所用）" },
    { key: "hid", label: "hid（hex）", type: "text", default: "01", placeholder: "签名函数标识，默认 01" },
    { key: "fixedR", label: "固定 r（hex，可选）", type: "text", default: "", placeholder: "留空随机；KAT 复现用" },
    { key: "dataEnc", label: "消息编码", type: "select", default: "utf8", options: ENC_OPTS },
  ],
  run: (text, p) => {
    const msg = encDecode(text, p.dataEnc || "utf8");
    const masterPub = parseG2Hex(p.masterPub, "签名主公钥 Ppub_s");
    const userPriv = parseG1Hex(p.userPriv, "用户签名私钥 dA");
    const fixedR = parseOptionalScalarHex(p.fixedR, "固定 r");
    const { h, S } = sm9Sign(msg, masterPub, userPriv, fixedR);
    return [
      `h = ${bytesToHex(scalarBytes(h))}`,
      `S = ${bytesToHex(g1MarshalUncompressed(S))}`,
      `签名（h‖S）= ${bytesToHex(scalarBytes(h))}${bytesToHex(g1MarshalUncompressed(S))}`,
    ].join("\n");
  },
});

// ---- 档③ 验签 ----
register({
  id: "sm9Verify",
  cat: "asym",
  family: "sm9",
  familyLabel: "verify",
  name: "SM9 验签",
  desc: "SM9 标识验签（GB/T 38635.2-2020）：签名主公钥（G2）+ 签名人 uid + hid + 消息 + 签名 (h, S) → 有效/无效。双线性对 e(S,PA)·g^h 重算 H2 比对",
  params: [
    { key: "masterPub", label: "签名主公钥 Ppub_s（hex）", type: "text", default: "", placeholder: "G2 点 129 字节（04 前缀）或 128 字节" },
    { key: "uid", label: "签名人标识 uid", type: "text", default: "Alice", placeholder: "验签用标识（即公钥）" },
    { key: "hid", label: "hid（hex）", type: "text", default: "01", placeholder: "签名函数标识，默认 01" },
    { key: "sigH", label: "签名 h（hex）", type: "text", default: "", placeholder: "32 字节 hex" },
    { key: "sigS", label: "签名 S（hex）", type: "text", default: "", placeholder: "G1 点 65 字节（04 前缀）或 64 字节" },
    { key: "dataEnc", label: "消息编码", type: "select", default: "utf8", options: ENC_OPTS },
  ],
  run: (text, p) => {
    const msg = encDecode(text, p.dataEnc || "utf8");
    const masterPub = parseG2Hex(p.masterPub, "签名主公钥 Ppub_s");
    const uid = new TextEncoder().encode(String(p.uid == null || p.uid === "" ? "Alice" : p.uid));
    const hid = parseHid(p.hid, 0x01);
    const h = parseScalarHex(p.sigH, "签名 h");
    const S = parseG1Hex(p.sigS, "签名 S");
    const ok = sm9Verify(msg, uid, hid, masterPub, h, S);
    return ok ? "验签结果：有效 ✓（H2(M‖GT(e(S,PA)·g^h)) == h）" : "验签结果：无效 ✗（签名或消息被篡改 / uid 不匹配）";
  },
});

// ---- 档④ 加密 ----
register({
  id: "sm9Encrypt",
  cat: "asym",
  family: "sm9",
  familyLabel: "encrypt",
  name: "SM9 加密",
  desc: "SM9 标识加密（GB/T 38635.4-2020）：加密主公钥（G1）+ 收件人 uid → 密文 C1‖C3‖C2（C1 为 64 字节 x‖y）。只需对方标识即可加密，无需对方证书；支持固定 r 复现官方向量",
  params: [
    { key: "masterPub", label: "加密主公钥 Ppub_e（hex）", type: "text", default: "", placeholder: "G1 点 65 字节（04 前缀）或 64 字节" },
    { key: "uid", label: "收件人标识 uid", type: "text", default: "Bob", placeholder: "收件人标识（即公钥）" },
    { key: "hid", label: "hid（hex）", type: "text", default: "03", placeholder: "加密函数标识，默认 03" },
    { key: "fixedR", label: "固定 r（hex，可选）", type: "text", default: "", placeholder: "留空随机；KAT 复现用" },
    { key: "dataEnc", label: "明文编码", type: "select", default: "utf8", options: ENC_OPTS },
    { key: "outEnc", label: "密文输出", type: "select", default: "hex", options: ENC_OPTS },
  ],
  run: (text, p) => {
    const msg = encDecode(text, p.dataEnc || "utf8");
    const masterPub = parseG1Hex(p.masterPub, "加密主公钥 Ppub_e");
    const uid = new TextEncoder().encode(String(p.uid == null || p.uid === "" ? "Bob" : p.uid));
    const hid = parseHid(p.hid, 0x03);
    const fixedR = parseOptionalScalarHex(p.fixedR, "固定 r");
    return encEncode(sm9Encrypt(msg, uid, hid, masterPub, fixedR), p.outEnc || "hex");
  },
});

// ---- 档⑤ 解密 ----
register({
  id: "sm9Decrypt",
  cat: "asym",
  family: "sm9",
  familyLabel: "decrypt",
  name: "SM9 解密",
  desc: "SM9 标识解密（GB/T 38635.4-2020）：用户加密私钥（G2）+ 收件人 uid + 密文 C1‖C3‖C2 → 明文。C3 校验失败（篡改/错 uid/错私钥）即报错",
  params: [
    { key: "userPriv", label: "用户加密私钥 dB（hex）", type: "text", default: "", placeholder: "G2 点 129 字节（04 前缀）或 128 字节" },
    { key: "uid", label: "收件人标识 uid", type: "text", default: "Bob", placeholder: "加密时所用标识" },
    { key: "enc", label: "密文编码", type: "select", default: "hex", options: ENC_OPTS },
  ],
  run: (text, p) => {
    const cipher = encDecode(text, p.enc || "hex");
    const userPriv = parseG2Hex(p.userPriv, "用户加密私钥 dB");
    const uid = new TextEncoder().encode(String(p.uid == null || p.uid === "" ? "Bob" : p.uid));
    return encEncode(sm9Decrypt(cipher, uid, userPriv), "utf8");
  },
});

// 标量 → 32 字节大端（补零）
function scalarBytes(x) {
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) { out[i] = Number(v & 0xffn); v >>= 8n; }
  return out;
}
