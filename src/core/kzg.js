/*
 * kzg.js — KZG 多项式承诺（EIP-4844 口径）：证明验证、blob 承诺、blob/versioned hash 字段解析。
 *
 * KZG（Kate–Zaverucha–Goldberg）把多项式 f 承诺为群元 C = f(s)·G1（s 为仪式销毁的可信
 * 设置秘密）。打开点 z 处的声明值 y 时给出商多项式证明 π = ((f(X) − y)/(X − z))(s)·G1，
 * 验证是双线性配对恒等式（c-kzg-4844 src/eip4844/eip4844.c verify_kzg_proof_impl）：
 *
 *     e(C − y·G1, [1]₂) == e(π, [s]₂ − z·[1]₂)
 *
 * 其中 [1]₂ 为标准 G2 生成元、[s]₂ 为可信设置第 2 个 G2 monomial 点（均为公开常量，
 * 见 kzgSetupData.js 的来源注释）。无穷点按 GT 单位元处理：e(O, X) = 1——官方向量含
 * 「证明为无穷点」的正确样例（f 为常数多项式时商恒为零），必须走该分支。
 *
 * 实现口径（全部逐行对照 ethereum/c-kzg-4844 v2.1.8，Apache-2.0，2026-10-25 取）：
 *   - blob 第 i 个 32B 字块 = 多项式在 4096 阶乘法子群第 i 个单位根处的取值，但下标为
 *     **12 位位反转序**（c-kzg 的 brp_roots_of_unity 约定，FFT 友好排序）；承诺 = 取值
 *     向量与 G1 Lagrange 点（同样位反转序）的线性组合。位反转序已用官方
 *     blob_to_kzg_commitment 向量实证（自然序会在非对称样例上失配）。
 *   - blob 证明的求值点 z 由 Fiat-Shamir 派生：SHA-256("FSBLOBVERIFY_V1_" ‖ 0⁸ ‖
 *     uint64be(4096) ‖ blob ‖ commitment)，取 32 字节大端整数模 r（compute_challenge +
 *     hash_to_bls_field）。y 用重心公式在取值形式下直接求值；商多项式 q 的取值
 *     q(ωᵢ) = (f(ωᵢ) − y)/(ωᵢ − z) 再对同一组 Lagrange 点做线性组合即 π——商的次数
 *     < 4096，Lagrange 恒等式保证与 monomial 口径一致（省去 IFFT 与 monomial 点）。
 *     z 落在求值域内时的洛必达分支照 c-kzg compute_kzg_proof_impl 原式。
 *   - 版本哈希 = 0x01 ‖ SHA-256(commitment)[1..31]（EIP-4844 kzg_to_versioned_hash）。
 *   - 输入校验对齐 c-kzg bytes_to_kzg_commitment/bytes_to_bls_field：48B 压缩 G1 须在
 *     曲线上、属 r 阶子群、允许无穷点（noble 编解码 + assertValidity 即此三件）；
 *     32B 域元素须严格小于 r；blob 每个字块同前（blob_to_polynomial 的 BADARGS 面）。
 *
 * 常量来源与许可：可信设置 G1/G2 点取自 c-kzg-4844 v2.1.8 随源分发的主网公开
 * trusted_setup.txt（SHA256 见 kzgSetupData.js 头注；本体为 Ethereum KZG Ceremony 公开
 * 产出）；曲线与配对用内联 @noble/curves 最小闭包（MIT）。本模块不实现可信设置生成。
 *
 * 纯计算：无随机、无 DOM/UI、无网络。曲线运算经 src/core/lib/noble/bls12-381.js。
 */
import { register } from "./registry.js";
import { bls12_381 } from "./lib/noble/bls12-381.js";
import {
  BLS_MODULUS, FIELD_ELEMENTS_PER_BLOB, BLOB_BYTES,
  G1_LAGRANGE, G2_MONOMIAL,
} from "./kzgSetupData.js";
import { sha256Hex } from "./shaExt.js";

const R = BLS_MODULUS; // BLS12-381 标量域阶 r（= 曲线群阶）
const G1 = bls12_381.G1.Point;
const G2 = bls12_381.G2.Point;
const Fp12 = bls12_381.fields.Fp12;
const N = FIELD_ELEMENTS_PER_BLOB;
const HEX_BLOB = BLOB_BYTES * 2; // 262144
const FS_DOMAIN = "FSBLOBVERIFY_V1_";
const VERSIONED_HASH_VERSION_KZG = 0x01;

// ============ 基础工具 ============

function normHex(s, label) {
  let t = String(s ?? "").trim().toLowerCase();
  if (t.startsWith("0x")) t = t.slice(2);
  t = t.replace(/[\s,]+/g, "");
  if (!/^[0-9a-f]*$/.test(t)) throw new Error(`${label}：含非十六进制字符`);
  if (t.length % 2) throw new Error(`${label}：hex 长度为奇数`);
  return t;
}

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** 48B 压缩 G1 → 曲线点。校验口径 = c-kzg validate_kzg_g1（曲线上 + r 阶子群 + 允许无穷点）。 */
function g1From48(s, label) {
  const t = normHex(s, label);
  if (t.length !== 96) throw new Error(`${label}：应为 48 字节（96 个 hex 字符），实得 ${t.length / 2} 字节`);
  let p;
  try {
    p = G1.fromHex(t);
    p.assertValidity(); // 曲线方程 + isTorsionFree（r 阶子群）+ 规范无穷点
  } catch {
    throw new Error(`${label}：不是合法的 BLS12-381 G1 群元（须在曲线上且属 r 阶子群）`);
  }
  return p;
}

/** 32B 大端 → 域元素。校验口径 = c-kzg bytes_to_bls_field（严格 < r，不静默取模）。 */
function frFrom32(s, label) {
  const t = normHex(s, label);
  if (t.length !== 64) throw new Error(`${label}：应为 32 字节（64 个 hex 字符），实得 ${t.length / 2} 字节`);
  const v = BigInt("0x" + t);
  if (v >= R) throw new Error(`${label}：域元素必须小于曲线阶 r`);
  return v;
}

const fAdd = (a, b) => (a + b) % R;
const fSub = (a, b) => (a - b % R + R) % R;
const fMul = (a, b) => (a * b) % R;

function fInv(a) {
  // 扩展欧几里得求逆（a ∈ [1, R-1]）
  let [old_r, r] = [a % R, R];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error("域元素不可逆（gcd ≠ 1）");
  return ((old_s % R) + R) % R;
}

function fPow(a, e) {
  let x = a % R, out = 1n;
  while (e > 0n) {
    if (e & 1n) out = (out * x) % R;
    x = (x * x) % R;
    e >>= 1n;
  }
  return out;
}

/** 批量求逆（标准实现：prefix 乘积 + 一次求逆 + 回代）。 */
function batchInvert(arr) {
  const n = arr.length;
  const pref = new Array(n);
  let acc = 1n;
  for (let i = 0; i < n; i++) {
    pref[i] = acc;
    acc = fMul(acc, arr[i]);
  }
  let inv = fInv(acc);
  const out = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    if (arr[i] === 0n) { out[i] = 0n; continue; }
    out[i] = fMul(inv, pref[i]);
    inv = fMul(inv, arr[i]);
  }
  return out;
}

// ============ 可信设置点（懒加载缓存） ============

let _rev12 = null;
/** 12 位位反转表：blob 下标 i ↔ 求值域单位根 ω^rev12(i)（c-kzg brp 约定）。 */
function rev12Table() {
  if (_rev12) return _rev12;
  _rev12 = new Uint32Array(N);
  for (let i = 0; i < N; i++) {
    let x = i, r = 0;
    for (let b = 0; b < 12; b++) { r = (r << 1) | (x & 1); x >>= 1; }
    _rev12[i] = r;
  }
  return _rev12;
}

let _lagBrp = null;
/** G1 Lagrange 点，位反转序（下标 i ↔ 求值域第 i 个 brp 单位根）。 */
function lagrangeBrp() {
  if (_lagBrp) return _lagBrp;
  const rv = rev12Table();
  _lagBrp = new Array(N);
  for (let i = 0; i < N; i++) _lagBrp[i] = G1.fromHex(G1_LAGRANGE[rv[i]]);
  return _lagBrp;
}

let _rootsBrp = null;
/** 4096 阶子群的单位根（位反转序）：ω = 7^((r−1)/8192)，求值域根 = ω²，下标按 brp。 */
function rootsBrp() {
  if (_rootsBrp) return _rootsBrp;
  const w = fPow(7n, (R - 1n) / 8192n); // c-kzg setup.c ROOT_OF_UNITY 的构造式
  const root = fMul(w, w); // 4096 阶子群生成元
  const rv = rev12Table();
  _rootsBrp = new Array(N);
  for (let i = 0; i < N; i++) _rootsBrp[i] = fPow(root, BigInt(rv[i]));
  return _rootsBrp;
}

let _s2 = null;
/** 可信设置 [s]₂（G2 monomial 第 2 点）。 */
function s2() {
  if (!_s2) _s2 = G2.fromHex(G2_MONOMIAL[1]);
  return _s2;
}

// ============ 多标量乘（Pippenger 桶法） ============

/** 变点 MSM：Σ scalars[i]·points[i]。标量为公开数据，允许 0。 */
function msmPippenger(points, scalars) {
  const n = scalars.length;
  let result = null;
  let maxBits = 0;
  for (const s of scalars) if (s !== 0n) { const b = s.toString(2).length; if (b > maxBits) maxBits = b; }
  if (maxBits === 0) return G1.ZERO;
  const c = n <= 16 ? 5 : n <= 64 ? 6 : n <= 256 ? 8 : 9;
  const winCount = Math.ceil(maxBits / c);
  const mask = (1 << c) - 1;
  let win = winCount - 1;
  for (; win >= 0; win--) {
    const m = mask; // 桶数 m（下标 0..m-1 表示窗口值 1..m）
    const buckets = new Array(m).fill(null);
    let maxB = -1;
    const shift = BigInt(win * c);
    for (let i = 0; i < n; i++) {
      const s = scalars[i];
      if (s === 0n) continue;
      const idx = Number((s >> shift) & BigInt(mask));
      if (idx === 0) continue;
      const b = idx - 1;
      buckets[b] = buckets[b] === null ? points[i] : buckets[b].add(points[i]);
      if (b > maxB) maxB = b;
    }
    let sum = G1.ZERO, acc = G1.ZERO;
    for (let b = maxB; b >= 0; b--) {
      if (buckets[b] !== null) sum = sum.add(buckets[b]);
      acc = acc.add(sum);
    }
    if (result === null) result = acc;
    else result = acc.add(result.multiplyUnsafe(BigInt(1 << c)));
  }
  return result === null ? G1.ZERO : result;
}

// ============ EIP-4844 核心算法 ============

/** blob hex 文本 → 4096 个域元素。逐字块严格 < r（c-kzg blob_to_polynomial 口径）。 */
function blobToElems(text) {
  const t = normHex(text, "blob");
  if (t.length !== HEX_BLOB) {
    throw new Error(`blob：应为 ${BLOB_BYTES} 字节（${HEX_BLOB} 个 hex 字符），实得 ${t.length / 2} 字节`);
  }
  const elems = new Array(N);
  for (let i = 0; i < N; i++) {
    const v = BigInt("0x" + t.slice(i * 64, (i + 1) * 64));
    if (v >= R) throw new Error(`blob：第 ${i} 个 32 字节块不是规范域元素（≥ r）`);
    elems[i] = v;
  }
  return elems;
}

/** blob → KZG 承诺（48B 压缩 hex，无 0x 前缀）。 */
function blobToCommitment(elems) {
  return msmPippenger(lagrangeBrp(), elems).toHex(true);
}

/** KZG 承诺 → 版本哈希：0x01 ‖ SHA-256(commitment)[1..31]。 */
function kzgToVersionedHash(commitmentHex48) {
  const c = normHex(commitmentHex48, "commitment");
  if (c.length !== 96) throw new Error(`commitment：应为 48 字节，实得 ${c.length / 2} 字节`);
  const h = sha256Hex(hexToBytes(c));
  return "01" + h.slice(2); // 版本字节 VERSIONED_HASH_VERSION_KZG = 0x01
}

/** Fiat-Shamir 求值点 z（c-kzg compute_challenge + hash_to_bls_field）。 */
function computeChallenge(elems, commitmentHex48) {
  const blob = new Uint8Array(BLOB_BYTES);
  for (let i = 0; i < N; i++) {
    let v = elems[i];
    for (let j = 31; j >= 0; j--) { blob[i * 32 + j] = Number(v & 0xffn); v >>= 8n; }
  }
  const c = hexToBytes(normHex(commitmentHex48, "commitment"));
  const buf = new Uint8Array(16 + 16 + BLOB_BYTES + 48);
  let o = 0;
  for (let i = 0; i < 16; i++) buf[o++] = FS_DOMAIN.charCodeAt(i);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(o, 0n, false); o += 8;               // 多项式次数高 64 位（固定 0）
  dv.setBigUint64(o, BigInt(N), false); o += 8;        // 低 64 位 = 4096
  buf.set(blob, o); o += BLOB_BYTES;
  buf.set(c, o);
  return BigInt("0x" + sha256Hex(buf)) % R; // 32B 大端整数模 r（不拒绝超 r 哈希）
}

/** 取值形式多项式在 z 处的重心求值（c-kzg evaluate_polynomial_in_evaluation_form）。 */
function evalInEvalForm(elems, z, roots) {
  for (let i = 0; i < N; i++) if (z === roots[i]) return elems[i];
  const dens = new Array(N);
  for (let i = 0; i < N; i++) dens[i] = fSub(z, roots[i]);
  const inv = batchInvert(dens);
  let acc = 0n;
  for (let i = 0; i < N; i++) acc = fAdd(acc, fMul(fMul(inv[i], roots[i]), elems[i]));
  acc = fMul(acc, fInv(BigInt(N)));
  acc = fMul(acc, fSub(fPow(z, BigInt(N)), 1n));
  return acc;
}

/**
 * 商多项式证明：π = Σ q(ωᵢ)·Lᵢ(τ)·G1（Lagrange 域直接构造）。
 * 返回 { proofHex, y, z }。z 落在求值域内的洛必达分支照 c-kzg compute_kzg_proof_impl。
 */
function computeProofImpl(elems, z, roots) {
  const y = evalInEvalForm(elems, z, roots);
  let m = -1;
  const q = new Array(N);
  const dens = new Array(N);
  for (let i = 0; i < N; i++) {
    if (z === roots[i]) { m = i; q[i] = 0n; dens[i] = 1n; continue; }
    q[i] = fSub(elems[i], y);
    dens[i] = fSub(roots[i], z);
  }
  const inv = batchInvert(dens);
  for (let i = 0; i < N; i++) if (i !== m) q[i] = fMul(q[i], inv[i]);
  if (m >= 0) {
    q[m] = 0n;
    const dens2 = new Array(N);
    for (let i = 0; i < N; i++) dens2[i] = i === m ? 1n : fMul(fSub(z, roots[i]), z);
    const inv2 = batchInvert(dens2);
    for (let i = 0; i < N; i++) {
      if (i === m) continue;
      q[m] = fAdd(q[m], fMul(fMul(fSub(elems[i], y), roots[i]), inv2[i]));
    }
  }
  return { proofHex: msmPippenger(lagrangeBrp(), q).toHex(true), y, z };
}

/** 配对恒等判定（含无穷点 = GT 单位元分支）。e(a1,a2) 是否等于 e(b1,b2)。 */
function pairEqual(a1, a2, b1, b2) {
  const t1 = a1.is0() || a2.is0() ? Fp12.ONE : bls12_381.pairing(a1, a2);
  const t2 = b1.is0() || b2.is0() ? Fp12.ONE : bls12_381.pairing(b1, b2);
  return Fp12.eql(t1, t2);
}

/**
 * KZG 单点证明验证（c-kzg verify_kzg_proof_impl）：
 * e(C − y·G1, [1]₂) == e(π, [s]₂ − z·[1]₂)。
 * 输入已通过解析校验；返回布尔。
 */
function verifyKzgCore(Cp, z, y, Pp) {
  const Pmy = y === 0n ? Cp : Cp.subtract(G1.BASE.multiplyUnsafe(y));
  const Xmz = z === 0n ? s2() : s2().subtract(G2.BASE.multiplyUnsafe(z));
  return pairEqual(Pmy, G2.BASE, Pp, Xmz);
}

/** 供 verify 脚本使用的原始入口：任何输入异常都折算成 { ok:false, invalid:true }，语义对齐官方向量。 */
export function kzgVerifyRaw(commitmentHex, zHex, yHex, proofHex) {
  try {
    const Cp = g1From48(commitmentHex, "commitment");
    const z = frFrom32(zHex, "z");
    const y = frFrom32(yHex, "y");
    const Pp = g1From48(proofHex, "proof");
    return { ok: verifyKzgCore(Cp, z, y, Pp), invalid: false, reason: "" };
  } catch (e) {
    return { ok: false, invalid: true, reason: e.message };
  }
}

/** blob 侧车整链：challenge → y → proof → 自验。供生成侧使用（kzgCommit withProof）。 */
export function kzgBlobProofFlow(blobText, commitmentHex) {
  const elems = blobToElems(blobText);
  const cHex = normHex(commitmentHex, "commitment");
  if (cHex.length !== 96) throw new Error("commitment：应为 48 字节（96 个 hex 字符）");
  const Cp = g1From48(cHex, "commitment");
  const roots = rootsBrp();
  const z = computeChallenge(elems, cHex);
  const { proofHex, y } = computeProofImpl(elems, z, roots);
  const ok = verifyKzgCore(Cp, z, y, g1From48(proofHex, "proof"));
  return { commitmentHex: cHex, zHex: z.toString(16).padStart(64, "0"), yHex: y.toString(16).padStart(64, "0"), proofHex, ok };
}

/** blob 证明验证（c-kzg verify_blob_kzg_proof 口径）：z/y 由 Fiat-Shamir 从 blob+承诺派生，
 * 对调用方给出的证明做配对验证——不重新生成证明。 */
export function kzgBlobVerifyRaw(blobText, commitmentHex, proofHex) {
  const elems = blobToElems(blobText);
  const cHex = normHex(commitmentHex, "commitment");
  if (cHex.length !== 96) throw new Error("commitment：应为 48 字节（96 个 hex 字符）");
  const Cp = g1From48(cHex, "commitment");
  const Pp = g1From48(proofHex, "proof");
  const roots = rootsBrp();
  const z = computeChallenge(elems, cHex);
  const y = evalInEvalForm(elems, z, roots);
  return {
    ok: verifyKzgCore(Cp, z, y, Pp),
    zHex: z.toString(16).padStart(64, "0"),
    yHex: y.toString(16).padStart(64, "0"),
  };
}

/** 显式 z 的打开证明（c-kzg compute_kzg_proof 口径）：输入 4096 域元素 hex + z。 */
export function kzgProofRaw(polyText, zHex) {
  const elems = blobToElems(polyText);
  const z = frFrom32(zHex, "z");
  const { proofHex, y } = computeProofImpl(elems, z, rootsBrp());
  return { proofHex, yHex: y.toString(16).padStart(64, "0") };
}

/** Fiat-Shamir challenge 原始入口（c-kzg compute_challenge 口径）。 */
export function kzgChallengeRaw(blobText, commitmentHex) {
  const elems = blobToElems(blobText);
  return computeChallenge(elems, normHex(commitmentHex, "commitment")).toString(16).padStart(64, "0");
}

/** blob → 承诺原始入口（48B 压缩 hex，无 0x 前缀）。 */
export function kzgCommitRaw(blobText) {
  return blobToCommitment(blobToElems(blobText));
}

/** 承诺 → 版本哈希原始入口（32B hex，无 0x 前缀）。 */
export function kzgVersionedHashRaw(commitmentHex) {
  return kzgToVersionedHash(commitmentHex);
}

// ============ op 注册 ============

const fmtHex = (t) => (t && !String(t).trim().toLowerCase().startsWith("0x") ? "0x" : "") + String(t ?? "").trim();

register({
  id: "kzgVerify",
  cat: "asym", family: "kzg", familyLabel: "verify",
  name: "KZG 证明验证",
  desc: "KZG 多项式承诺打开验证（EIP-4844）：配对恒等式 e(C − y·G1, [1]₂) == e(π, [s]₂ − z·[1]₂)。手动四元组模式验 z/y/承诺/证明；blob 模式由 blob+承诺按 Fiat-Shamir（FSBLOBVERIFY_V1_）自动派生 z/y 再验。BLS12-381 主网可信设置公开常量，与 c-kzg-4844 官方向量逐字节对拍。这是承诺体系验证原语，不是加密",
  acceptsBytes: false, textTransit: true,
  params: [
    { key: "mode", label: "验证模式", type: "select", default: "manual", options: [
      { value: "manual", label: "手动四元组（承诺 / z / y / 证明）" },
      { value: "blob", label: "blob 侧车（主输入 = blob hex，自动派生 z/y）" },
    ] },
    { key: "commitment", label: "承诺 commitment（0x + 96 hex）", type: "text", default: "", placeholder: "48 字节压缩 G1 点" },
    { key: "z", label: "求值点 z（0x + 64 hex，手动模式）", type: "text", default: "", placeholder: "32 字节域元素" },
    { key: "y", label: "声明值 y（0x + 64 hex，手动模式）", type: "text", default: "", placeholder: "32 字节域元素" },
    { key: "proof", label: "证明 proof（0x + 96 hex）", type: "text", default: "", placeholder: "48 字节压缩 G1 点" },
  ],
  run(t, p = {}) {
    const mode = p.mode || "manual";
    if (mode === "blob") {
      if (!t || !String(t).trim()) throw new Error("请在主输入框粘贴 blob hex（131072 字节 = 262144 个 hex 字符）");
      if (!p.commitment || !String(p.commitment).trim()) throw new Error("请在参数里填入承诺 commitment");
      if (!p.proof || !String(p.proof).trim()) throw new Error("请在参数里填入证明 proof");
      let r;
      try {
        r = kzgBlobVerifyRaw(String(t), String(p.commitment), String(p.proof));
      } catch (e) {
        return `结论：输入无效（未进入配对检查）\n原因：${e.message}`;
      }
      return [
        `结论：${r.ok ? "验证通过 PASS" : "验证失败 FAIL"}`,
        `模式：blob 侧车（Fiat-Shamir 自动派生 z/y）`,
        `承诺 commitment: ${fmtHex(normHex(p.commitment, "commitment"))}`,
        `求值点 z: 0x${r.zHex}`,
        `声明值 y: 0x${r.yHex}`,
        `证明 proof: ${fmtHex(normHex(p.proof, "proof"))}`,
        `配对检查: e(C − y·G1, [1]₂) == e(π, [s]₂ − z·[1]₂)`,
        r.ok ? "blob 数据、承诺与证明三者自洽" : "blob / 承诺 / 证明至少一项被改动或不匹配",
      ].join("\n");
    }
    // 手动四元组
    for (const [k, label] of [["commitment", "承诺 commitment"], ["z", "求值点 z"], ["y", "声明值 y"], ["proof", "证明 proof"]]) {
      if (!p[k] || !String(p[k]).trim()) throw new Error(`请在参数里填入${label}`);
    }
    const lines = [];
    let Cp, z, y, Pp, reason = "";
    try {
      Cp = g1From48(p.commitment, "commitment");
      z = frFrom32(p.z, "z");
      y = frFrom32(p.y, "y");
      Pp = g1From48(p.proof, "proof");
    } catch (e) {
      reason = e.message;
    }
    if (reason) {
      lines.push("结论：输入无效（未进入配对检查）", `原因：${reason}`);
      return lines.join("\n");
    }
    const ok = verifyKzgCore(Cp, z, y, Pp);
    lines.push(
      `结论：${ok ? "验证通过 PASS" : "验证失败 FAIL"}`,
      "模式：手动四元组",
      `承诺 commitment: ${fmtHex(normHex(p.commitment, "commitment"))}`,
      `求值点 z: 0x${z.toString(16).padStart(64, "0")}`,
      `声明值 y: 0x${y.toString(16).padStart(64, "0")}`,
      `证明 proof: ${fmtHex(normHex(p.proof, "proof"))}`,
      "配对检查: e(C − y·G1, [1]₂) == e(π, [s]₂ − z·[1]₂)",
      ok ? "双线性配对恒等式成立" : "配对恒等式不成立（承诺 / z / y / 证明至少一项不符）"
    );
    if (Cp.is0() || Pp.is0()) {
      lines.push("注：输入含无穷点（无穷点按 GT 单位元处理，与官方向量口径一致）");
    }
    return lines.join("\n");
  },
});

register({
  id: "kzgCommit",
  cat: "asym", family: "kzg", familyLabel: "gen",
  name: "KZG blob 承诺",
  desc: "由 EIP-4844 blob（4096 个 32 字节域元素）计算 KZG 承诺与版本哈希：承诺 = 取值向量对主网可信设置 G1 Lagrange 点的线性组合（位反转域序）；版本哈希 = 0x01 ‖ SHA-256(承诺)[1..31]。可同时生成打开证明并自验。不实现可信设置生成；这是承诺，不是加密，无法从承诺还原 blob",
  acceptsBytes: false, textTransit: true,
  params: [
    { key: "withProof", label: "同时生成打开证明并自验（多一次等价运算）", type: "bool", default: false },
  ],
  run(t, p = {}) {
    if (!t || !String(t).trim()) throw new Error("请在主输入框粘贴 blob hex（131072 字节 = 262144 个 hex 字符，可带 0x 前缀）");
    const elems = blobToElems(String(t));
    const t0 = Date.now();
    const cHex = blobToCommitment(elems);
    const vh = kzgToVersionedHash(cHex);
    const lines = [
      `blob: ${BLOB_BYTES} 字节 = ${N} 个域元素（全部 < r，规范）`,
      `承诺 commitment (48B 压缩 G1): 0x${cHex}`,
      `版本哈希 versioned hash: 0x${vh}`,
      "  = 0x01 ‖ SHA-256(承诺) 后 31 字节（EIP-4844 版本字节 0x01 = KZG）",
      `耗时 ${Date.now() - t0} ms`,
      "注：承诺是多对一的群元绑定，不可逆，也不是加密",
    ];
    if (p.withProof) {
      const roots = rootsBrp();
      const z = computeChallenge(elems, cHex);
      const { proofHex, y } = computeProofImpl(elems, z, roots);
      const ok = verifyKzgCore(g1From48(cHex, "commitment"), z, y, g1From48(proofHex, "proof"));
      lines.push(
        `打开证明 proof (48B 压缩 G1): 0x${proofHex}`,
        `求值点 z (Fiat-Shamir): 0x${z.toString(16).padStart(64, "0")}`,
        `声明值 y: 0x${y.toString(16).padStart(64, "0")}`,
        `自验（配对恒等式）: ${ok ? "PASS" : "FAIL"}`
      );
      if (!ok) throw new Error("内部自验失败——请反馈实现问题");
    }
    return lines.join("\n");
  },
});

register({
  id: "kzgBlobParse",
  cat: "filefmt", family: "kzg", familyLabel: "parse",
  name: "EIP-4844 blob 解析",
  desc: "解析 EIP-4844 相关字段并展示结构：blob（131072 字节 = 4096 个 32B BLS12-381 标量域元素，逐块规范校验）、交易侧的 blob versioned hash 列表（32 字节 = 版本字节 0x01 + SHA-256(承诺) 截断 31 字节）、单个 48B KZG 承诺。只解析展示，不联网、不计算承诺（那归 KZG blob 承诺 op）",
  acceptsBytes: false, textTransit: true,
  params: [],
  run(t) {
    const raw = String(t ?? "").trim();
    if (!raw) throw new Error("请在主输入框粘贴 blob hex、一个或多个 versioned hash（64 hex/个，空白分隔）或单个承诺（96 hex）");
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    const norm = tokens.map((x) => normHex(x, "输入"));
    const allBlob = norm.length === 1 && norm[0].length === HEX_BLOB;
    const allHash = norm.every((x) => x.length === 64);
    const oneCommit = norm.length === 1 && norm[0].length === 96;
    const lines = [];
    if (allBlob) {
      const t0 = Date.now();
      let bad = [];
      let zeroCnt = 0;
      const elems = new Array(N);
      for (let i = 0; i < N; i++) {
        const v = BigInt("0x" + norm[0].slice(i * 64, (i + 1) * 64));
        if (v >= R) { if (bad.length < 8) bad.push(i); }
        if (v === 0n) zeroCnt++;
        elems[i] = v;
      }
      lines.push(
        "识别：blob（131072 字节）",
        `结构：${N} × 32 字节 BLS12-381 标量域元素（多项式取值形式，位反转域序）`,
        `域元素规范校验（每个 < r）: ${bad.length === 0 ? "全部合法" : "越界 " + bad.length + " 块，首个下标 " + bad.join(",") + (bad.length >= 8 ? " …" : "")}`,
        `零元素个数: ${zeroCnt}`,
        `首 3 个域元素: 0x${elems[0].toString(16).padStart(64, "0")}, 0x${elems[1].toString(16).padStart(64, "0")}, 0x${elems[2].toString(16).padStart(64, "0")}`,
        `末 2 个域元素: 0x${elems[N - 2].toString(16).padStart(64, "0")}, 0x${elems[N - 1].toString(16).padStart(64, "0")}`,
        `关联: 承诺/证明请用「KZG blob 承诺」「KZG 证明验证」（blob 模式）；耗时 ${Date.now() - t0} ms`
      );
      if (bad.length) lines.push("注：含越界块的 blob 不是合法 sidecar 数据（c-kzg 直接拒绝）");
      return lines.join("\n");
    }
    if (allHash) {
      lines.push(`识别：${norm.length} 个 32 字节 versioned hash（EIP-4844 type-3 交易的 blob_versioned_hashes 字段，每 blob 一个）`);
      norm.forEach((h, i) => {
        const ver = parseInt(h.slice(0, 2), 16);
        const typeName = ver === VERSIONED_HASH_VERSION_KZG
          ? "KZG（EIP-4844 当前唯一定义版本）"
          : ver === 0x00 ? "0x00（未在此规范定义）" : "未知版本（如实标注）";
        lines.push(
          `#${i + 1}: 0x${h}`,
          `    版本字节 = 0x${h.slice(0, 2)} → ${typeName}`,
          ver === VERSIONED_HASH_VERSION_KZG
            ? `    载荷 = SHA-256(承诺) 的第 1..31 字节（截断 31B）: 0x${h.slice(2)}`
            : `    载荷 31 字节: 0x${h.slice(2)}（仅 0x01 版本才承诺为 SHA-256 截断）`,
          `    前 4 字节视图: 0x${h.slice(0, 8)}`
        );
      });
      lines.push(
        "注：版本哈希是承诺的指纹（0x01 + SHA-256 截断），单向不可逆；不能从版本哈希还原 blob 或承诺"
      );
      return lines.join("\n");
    }
    if (oneCommit) {
      let extra = "";
      try {
        const p = G1.fromHex(norm[0]);
        p.assertValidity();
        extra = p.is0() ? "（无穷点）" : "（曲线上、r 阶子群内）";
      } catch { extra = "（不是合法 G1 群元）"; }
      lines.push(
        "识别：48 字节压缩 G1 点 = KZG 承诺形态",
        `值: 0x${norm[0]}`,
        `校验: ${extra}`,
        "关联: 对应承诺请用「KZG blob 承诺」从 blob 计算；版本哈希 = 0x01 ‖ SHA-256(本值)[1..31]"
      );
      return lines.join("\n");
    }
    const lens = [...new Set(norm.map((x) => x.length))].join(",");
    throw new Error(`无法识别输入形态（hex 长度：${lens}）。支持：blob=262144 hex；versioned hash=64 hex ×N；承诺=96 hex ×1`);
  },
});
