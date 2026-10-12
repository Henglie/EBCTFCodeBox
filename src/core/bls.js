/*
 * bls.js — BLS 签名（Boneh–Lynn–Shacham 2001）对齐 IETF draft-irtf-cfrg-bls-signature：
 * BLS12-381 曲线 + RFC 9380 hash-to-curve（expand_message_xmd(SHA-256) → simplified-SWU →
 * 同源映射 → clearCofactor，恒定时间），官方 ciphersuite
 * BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_（basic 方案 / minimal-pubkey-size）：
 *   sk ∈ [1, r-1]（r 为子群阶），pk = [sk]G1（48B 压缩），σ = [sk]·H(m) ∈ G2（96B 压缩），
 *   验签 e(σ, G1) == e(H(m), pk)；H 为 hash_to_curve（点的离散对数不可知），与 IETF/ETH2 互通。
 * 曲线/配对/hash-to-curve 取内联 @noble/curves@2.4.0 最小闭包
 * （MIT © 2022 Paul Miller，https://github.com/paulmillr/noble-curves，
 *   许可文本见 ./lib/noble/LICENSE.txt）。
 * KeyValidate（draft §2.5）：公钥须为 G1 上曲线点、非无穷远、且在 r 阶子群内。
 * 聚合验签（basic 方案，draft §3.1.1）：消息两两互异，否则整体拒绝（防 rogue-key 攻击）。
 */
import { register } from "./registry.js";
import { randomBytes as randBytes } from "./randSource.js";
import { bls12_381 } from "./lib/noble/bls12-381.js";

const BLS = bls12_381.longSignatures; // basic：pk ∈ G1 / σ ∈ G2，默认 DST 即官方 ciphersuite
const G1Point = bls12_381.G1.Point;
const G2Point = bls12_381.G2.Point;
const R = bls12_381.fields.Fr.ORDER; // BLS12-381 子群阶 r

function modR(a) { const r = a % R; return r < 0n ? r + R : r; }
function hexToBig(hex, what) {
  const s = String(hex ?? "").trim().replace(/^0x/i, "");
  if (!s) throw new Error(`${what}为空：须填非空 hex 字符串`);
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error(`${what}不是合法 hex（含非十六进制字符）`);
  return BigInt("0x" + s);
}
function parseSecretKey(skHex) {
  const sk = hexToBig(skHex, "BLS：私钥 sk ");
  if (sk === 0n) throw new Error("BLS：私钥须在 [1, r-1]（不可为 0）");
  if (sk >= R) throw new Error("BLS：私钥须在 [1, r-1]（超出子群阶 r，不做静默约减）");
  return { sk, skBytes: skToBytes(sk) };
}
function skToBytes(sk) {
  const out = new Uint8Array(32);
  const h = sk.toString(16).padStart(64, "0");
  for (let i = 0; i < 32; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
/** KeyValidate（draft §2.5）：G1 曲线点 + 非无穷远 + r 阶子群（noble 解码即校验曲线与子群）。 */
function keyValidatePk(pkHex) {
  let pk;
  try { pk = G1Point.fromHex(String(pkHex ?? "").trim().replace(/^0x/i, "")); }
  catch (e) { throw new Error("BLS：公钥解析失败（须 48B 压缩 G1 hex；底层原因：" + e.message + "）"); }
  if (pk.is0()) throw new Error("BLS：公钥 KeyValidate 失败（无穷远点，draft §2.5 禁止）");
  return pk;
}
function parseSig(sigHex) {
  let sig;
  try { sig = G2Point.fromHex(String(sigHex ?? "").trim().replace(/^0x/i, "")); }
  catch (e) { throw new Error("BLS：签名解析失败（须 96B 压缩 G2 hex；底层原因：" + e.message + "）"); }
  return sig;
}

/** 密钥生成：sk ∈ [1,r-1]（skHex 留空则按 draft KeyGen 流程随机），pk = [sk]G1（48B 压缩 hex）。 */
export function blsKeyGenBytes(skHex) {
  let sk, skBytes, pk;
  if (skHex && String(skHex).trim()) {
    ({ sk, skBytes } = parseSecretKey(skHex));
    pk = BLS.getPublicKey(skBytes);
  } else {
    const kg = BLS.keygen(randBytes(BLS.lengths.seed));
    sk = hexToBig(bufHex(kg.secretKey), "BLS：私钥 sk ");
    skBytes = kg.secretKey;
    pk = kg.publicKey;
    if (sk === 0n || sk >= R) throw new Error("BLS：随机私钥越界（内部错误）");
  }
  return { sk: sk.toString(16).padStart(64, "0"), pk: pk.toHex() };
}
function bufHex(b) { return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); }

/** 签名：σ = [sk]·H(m)，H = hash_to_curve（RFC 9380，官方 ciphersuite DST），96B 压缩 G2 hex。 */
export function blsSignBytes(skHex, msgBytes) {
  const { skBytes } = parseSecretKey(skHex);
  const hm = BLS.hash(msgBytes);
  return BLS.sign(hm, skBytes).toHex();
}

/** 验签：e(σ, G1) ?= e(H(m), pk)。pk/sig 为压缩 hex；解析失败显式报错，配对不匹配返回 false。 */
export function blsVerifyBytes(pkHex, msgBytes, sigHex) {
  const pk = keyValidatePk(pkHex);
  const sig = parseSig(sigHex);
  const hm = BLS.hash(msgBytes);
  return BLS.verify(sig, hm, pk);
}

/** 聚合验签（basic）：σ_agg = Σσ_i 后一次配对检查；消息两两互异 + 逐组 KeyValidate。 */
export function blsAggVerifyBytes(pkHexList, msgList, sigHexList) {
  if (!(pkHexList.length && pkHexList.length === msgList.length && pkHexList.length === sigHexList.length)) {
    throw new Error("BLS 聚合：公钥/消息/签名数量必须一致且非空");
  }
  const seen = new Set();
  for (let i = 0; i < msgList.length; i++) {
    const k = bufHex(msgList[i]);
    if (seen.has(k)) throw new Error("BLS 聚合：basic 方案要求消息两两互异（第 " + (i + 1) + " 条消息重复，防 rogue-key 攻击，draft §3.1.1）");
    seen.add(k);
  }
  const items = [];
  const sigs = [];
  for (let i = 0; i < pkHexList.length; i++) {
    const pk = keyValidatePk(pkHexList[i]);
    const sig = parseSig(sigHexList[i]);
    if (sig.is0()) throw new Error("BLS 聚合：第 " + (i + 1) + " 组签名为无穷远点");
    items.push({ message: BLS.hash(msgList[i]), publicKey: pk });
    sigs.push(sig);
  }
  const agg = BLS.aggregateSignatures(sigs);
  return BLS.verifyBatch(agg, items);
}

// ============ op 注册（三档族，familyLabel 复用既有 keygen/sign/verify） ============
register({
  id: "blsKeyGen", cat: "asym", family: "bls", familyLabel: "keygen",
  name: "BLS 密钥生成",
  desc: "BLS（Boneh–Lynn–Shacham）密钥生成，对齐 IETF draft-irtf-cfrg-bls-signature：BLS12-381 + RFC 9380，ciphersuite BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_。sk ∈ [1,r-1]（留空按 draft KeyGen 随机），pk=[sk]G1（48B 压缩，与 ETH2 互通）",
  params: [{ key: "sk", label: "私钥 sk (hex，留空随机)", type: "text", default: "", placeholder: "复现用固定私钥" }],
  run(_t, p = {}) {
    const r = blsKeyGenBytes(p.sk);
    return { text: ["私钥 sk: " + r.sk, "公钥 pk ([sk]G1, 48B 压缩): " + r.pk].join("\n"), files: [] };
  },
});

register({
  id: "blsSign", cat: "asym", family: "bls", familyLabel: "sign",
  name: "BLS 签名",
  desc: "BLS 签名：σ = [sk]·H(m)，H 为 RFC 9380 hash_to_curve（恒定时间，官方 ciphersuite DST）。签名 σ 为 96B 压缩 G2 点；同域签名可聚合（见聚合验签）",
  params: [
    { key: "sk", label: "私钥 sk (hex 32B)", type: "text", default: "", placeholder: "BLS 密钥生成输出的 sk" },
  ],
  run(t, p = {}) {
    if (!t || !String(t).trim()) throw new Error("请在主输入框填入待签消息");
    if (!p.sk) throw new Error("请填入私钥 sk（BLS 密钥生成输出）");
    const sig = blsSignBytes(p.sk, new TextEncoder().encode(String(t)));
    return "BLS 签名 σ ([sk]·H(m) ∈ G2, 96B 压缩):\n" + sig;
  },
});

register({
  id: "blsVerify", cat: "asym", family: "bls", familyLabel: "verify",
  name: "BLS 验签",
  desc: "BLS 验签：e(σ, G1) ?= e(H(m), pk)，含公钥 KeyValidate（非无穷远 + 子群校验）。主输入填原消息；参数填公钥（48B）与签名（96B）",
  params: [
    { key: "pk", label: "公钥 pk (hex 48B 压缩 G1)", type: "text", default: "", placeholder: "96 个 hex 字符（压缩 G1 点）" },
    { key: "sig", label: "签名 σ (hex 96B 压缩 G2)", type: "text", default: "", placeholder: "192 个 hex 字符（压缩 G2 点）" },
  ],
  run(t, p = {}) {
    if (!t || !String(t).trim()) throw new Error("请在主输入框填入被签消息");
    if (!p.pk || !p.sig) throw new Error("请填入公钥与签名");
    const ok = blsVerifyBytes(p.pk, new TextEncoder().encode(String(t)), p.sig);
    return ok ? "✓ 验签通过（e(σ, G1) = e(H(m), pk)）" : "✗ 验签失败";
  },
});

register({
  id: "blsAggVerify", family: "bls", familyLabel: "aggverify", cat: "asym", name: "BLS 聚合验签",
  desc: "BLS 聚合验签（basic 方案）：n 组 (pk, 消息, 签名) 聚合后一次配对检查；消息须两两互异（draft §3.1.1，防 rogue-key），逐组 KeyValidate。主输入每行一组：pk_hex 空格 签名_hex；消息放参数框逐行对应",
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
    const ok = blsAggVerifyBytes(pks, msgs.map((m) => new TextEncoder().encode(m)), sigs);
    return ok
      ? `✓ 聚合验签通过（${lines.length} 组签名聚合，一次配对检查）`
      : "✗ 聚合验签失败（组内有签名/消息/公钥不匹配）";
  },
});
