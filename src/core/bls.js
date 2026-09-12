/*
 * bls.js — BLS 签名（Boneh–Lynn–Shacham 2001 构造）跑在项目 BN254/SM9 曲线上（T398 批C）。
 * 定位：教学/CTF 口径的 BLS 构造——曲线复用项目 pairing 内核（SM9 BN 曲线，**非 BLS12-381**，
 * 与 IETF/ETH2 签名不互通）；签名域 G1、公钥域 G2；hash-to-G1 复用 SM9 H1（SM3 双块计数器 → 标量 →
 * 基点乘，域分隔前缀 0x42 与 SM9 的 hid 空间隔离）。聚合签名 = 同域签名点加（Boneh 原始聚合口径）。
 */
import { register } from "./registry.js";
import {
  pairing, gtMul, gtMarshal, G1_GEN, G2_GEN, sm9H1, sm9RandomScalar,
  g1Mul, g2Mul, g1Affine, g2Affine, g1MarshalUncompressed, g1Unmarshal,
  g2MarshalUncompressed, g2Unmarshal, hexToBytes, bytesToHex, SM9_N, concatBytes,
} from "./pairing.js";

const N = SM9_N;
function modN(a) { const r = a % N; return r < 0n ? r + N : r; }
function hexToBig(hex) {
  const s = String(hex || "").replace(/^0x/i, "").trim() || "0";
  return BigInt("0x" + s);
}
// hash-to-G1 标量：域分隔 0x42（'B'）前缀 + 消息字节 → SM9 H1 → [1, N-1]
function h2gScalar(msgBytes) {
  return sm9H1(concatBytes(Uint8Array.of(0x42), msgBytes));
}
function g1J(pt) { return [pt[0], pt[1], 1n]; }
function g2J(pt) { return [pt[0], pt[1], { x: 0n, y: 1n }]; }

/** 密钥生成：sk ∈ [1,N-1]（skHex 留空随机），pk = [sk]G2（129B hex 04 前缀）。 */
export function blsKeyGenBytes(skHex) {
  const sk = skHex && String(skHex).trim() ? modN(hexToBig(skHex)) : sm9RandomScalar();
  if (sk === 0n) throw new Error("BLS：私钥须在 [1, n-1]");
  const pk = g2Affine(g2Mul(sk, g2J(G2_GEN)));
  return { sk: sk.toString(16).padStart(64, "0"), pk: bytesToHex(g2MarshalUncompressed(pk)) };
}

/** 签名：σ = [H(m)]G1（65B hex 04 前缀）。 */
export function blsSignBytes(skHex, msgBytes) {
  const sk = modN(hexToBig(skHex));
  if (sk === 0n) throw new Error("BLS：私钥无效");
  const h = h2gScalar(msgBytes);
  const sig = g1Affine(g1Mul(modN(sk * h), g1J(G1_GEN))); // σ = [sk·H(m)]G1（BLS 核心）
  if (!sig) throw new Error("BLS：哈希点为无穷远（异常）");
  return bytesToHex(g1MarshalUncompressed(sig));
}

/** 验签：e(σ, G2) ?= e(H(m)·G1, pk)。pk/sig 均为 04 前缀 hex。 */
export function blsVerifyBytes(pkHex, msgBytes, sigHex) {
  const pkRaw = hexToBytes(pkHex.replace(/^0x/i, ""));
  const sigRaw = hexToBytes(sigHex.replace(/^0x/i, ""));
  let pk, sg;
  try { pk = g2Unmarshal(pkRaw); } catch (e) { throw new Error("BLS：公钥解析失败（" + e.message + "）"); }
  try { sg = g1Unmarshal(sigRaw); } catch (e) { throw new Error("BLS：签名解析失败（" + e.message + "）"); }
  if (!pk || !sg) return false;
  const h = h2gScalar(msgBytes);
  const hm = g1Affine(g1Mul(h, g1J(G1_GEN)));
  const left = pairing(sg, G2_GEN);
  const right = pairing(hm, pk);
  return bytesToHex(gtMarshal(left)) === bytesToHex(gtMarshal(right));
}

/** 聚合验签（Boneh 原始聚合）：e(σ_i,G2) 连乘 ?= e(H(mi)G1,pki) 连乘（σ_agg=Σσ_i 等价式）。 */
export function blsAggVerifyBytes(pkHexList, msgList, sigHexList) {
  if (!(pkHexList.length && pkHexList.length === msgList.length && pkHexList.length === sigHexList.length)) {
    throw new Error("BLS 聚合：公钥/消息/签名数量必须一致且非空");
  }
  const lhsParts = [], rhsParts = [];
  for (let i = 0; i < pkHexList.length; i++) {
    const pk = g2Unmarshal(hexToBytes(pkHexList[i].replace(/^0x/i, "")));
    const sg = g1Unmarshal(hexToBytes(sigHexList[i].replace(/^0x/i, "")));
    if (!pk || !sg) throw new Error("BLS 聚合：输入含无穷远点");
    lhsParts.push(pairing(sg, G2_GEN));
    const h = h2gScalar(msgList[i]);
    rhsParts.push(pairing(g1Affine(g1Mul(h, g1J(G1_GEN))), g2J(pk)));
  }
  const mulAll = (arr) => arr.reduce((acc, e) => gtMul(acc, e));
  return bytesToHex(gtMarshal(mulAll(lhsParts))) === bytesToHex(gtMarshal(mulAll(rhsParts)));
}

// ============ op 注册（三档族，familyLabel 复用既有 keygen/sign/verify） ============
register({
  id: "blsKeyGen", cat: "asym", family: "bls", familyLabel: "keygen",
  name: "BLS 密钥生成",
  desc: "BLS（Boneh–Lynn–Shacham）密钥生成：sk ∈ [1,n-1]，pk=[sk]G2。构造跑在项目 BN254/SM9 曲线（教学口径，非 BLS12-381，与 ETH2 不互通）",
  params: [{ key: "sk", label: "私钥 sk (hex 32B，留空随机)", type: "text", default: "", placeholder: "复现用固定私钥" }],
  run(_t, p = {}) {
    const r = blsKeyGenBytes(p.sk);
    return { text: ["私钥 sk: " + r.sk, "公钥 pk ([sk]G2, 129B): " + r.pk].join("\n"), files: [] };
  },
});

register({
  id: "blsSign", cat: "asym", family: "bls", familyLabel: "sign",
  name: "BLS 签名",
  desc: "BLS 签名：σ = [sk·H(m)]G1，H 复用 SM9 H1（域分隔 0x42）。签名 65B G1 点；同域签名可点加聚合（见聚合验签）",
  params: [
    { key: "sk", label: "私钥 sk (hex 32B)", type: "text", default: "", placeholder: "BLS 密钥生成输出的 sk" },
  ],
  run(t, p = {}) {
    if (!t || !String(t).trim()) throw new Error("请在主输入框填入待签消息");
    if (!p.sk) throw new Error("请填入私钥 sk（BLS 密钥生成输出）");
    const sig = blsSignBytes(p.sk, new TextEncoder().encode(String(t)));
    return "BLS 签名 σ ([H(m)]G1, 65B):\n" + sig;
  },
});

register({
  id: "blsVerify", cat: "asym", family: "bls", familyLabel: "verify",
  name: "BLS 验签",
  desc: "BLS 验签：e(σ,G2) ?= e(H(m)·G1, pk)。主输入填原消息；参数填公钥与签名",
  params: [
    { key: "pk", label: "公钥 pk (hex 129B)", type: "text", default: "", placeholder: "04 开头的 G2 点" },
    { key: "sig", label: "签名 σ (hex 65B)", type: "text", default: "", placeholder: "04 开头的 G1 点" },
  ],
  run(t, p = {}) {
    if (!t || !String(t).trim()) throw new Error("请在主输入框填入被签消息");
    if (!p.pk || !p.sig) throw new Error("请填入公钥与签名");
    const ok = blsVerifyBytes(p.pk, new TextEncoder().encode(String(t)), p.sig);
    return ok ? "✓ 验签通过（e(σ,G2) = e(H(m)·G1, pk)）" : "✗ 验签失败";
  },
});

register({
  id: "blsAggVerify", family: "bls", familyLabel: "aggverify", cat: "asym", name: "BLS 聚合验签",
  desc: "Boneh 原始聚合验签：n 组 (pk, 消息, 签名) 一次配对检查。主输入每行一组：pk_hex 空格 签名_hex；消息放参数框逐行对应",
  params: [
    { key: "msgs", label: "消息列表（每行一条，与主输入行对应）", type: "textarea", default: "", placeholder: "消息1\n消息2\n…" },
  ],
  run(t, p = {}) {
    const lines = String(t || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const msgs = String(p.msgs || "").split(/\r?\n/).filter((s) => s !== "");
    if (!lines.length) throw new Error("主输入每行填：pk_hex 签名_hex");
    if (msgs.length !== lines.length) throw new Error(`消息行数（${msgs.length}）须与主输入组数（${lines.length}）一致`);
    const pks = [], sigs = [];
    for (const line of lines) {
      const m = line.split(/\s+/);
      if (m.length !== 2) throw new Error("主输入每行格式：pk_hex 空格 签名_hex");
      pks.push(m[0]); sigs.push(m[1]);
    }
    const ok = blsAggVerifyBytes(pks, msgs, sigs);
    return ok
      ? `✓ 聚合验签通过（${lines.length} 组签名聚合，一次配对检查）`
      : "✗ 聚合验签失败（组内有签名/消息/公钥不匹配）";
  },
});
