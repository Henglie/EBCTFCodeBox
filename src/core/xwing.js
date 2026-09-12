/*
 * xwing.js — X-Wing 混合 KEM（X25519 + ML-KEM-768）keyGen / encaps / decaps
 *
 * 标准：draft-connolly-cfrg-xwing-kem（IETF CFRG，2024-08，-06 版逐字核对）。
 * 结构（与任务简报不同处已按规范修正）：
 *   - sk  = 32 字节种子（不是拼接！）。expandDecapsulationKey：
 *     SHAKE256(sk, 96) → [0:32]=ML-KEM d、[32:64]=ML-KEM z、[64:96]=sk_X。
 *   - pk  = pk_M(1184B) ‖ pk_X(32B) = 1216B（ML-KEM 在前）。
 *   - ct  = ct_M(1088B) ‖ ct_X(32B) = 1120B（ct_X 是 X25519 临时公钥，在尾部）。
 *   - 组合器（§5.3，逐字）：
 *       ss = SHA3-256(ss_M ‖ ss_X ‖ ct_X ‖ pk_X ‖ XWingLabel)
 *     XWingLabel = "\./" ‖ "/^\" = 5c2e2f2f5e5c（6 字节 ASCII）。
 *     注意：ML-KEM 密文 ct_M 不进组合器（依赖 ML-KEM-768 特有 FO 变换，
 *     草案 §6 明确警告换其他 KEM 不保安全）；标签在末尾（changelog F.2）。
 *
 * 组件复用：ML-KEM-768 走 mlkem.js（FIPS 203 定稿，ACVP 全量验证），
 * X25519 走 x25519.js（RFC 7748）。SHA3-256/SHAKE256 本文件内联海绵
 * （复用 hash.js 的 keccakF1600 置换，mlkem.js 先例），以 FIPS 202 官方向量自测。
 *
 * 偏差说明（合法密文路径无差异）：草案 Decapsulate 用 ML-KEM-768 内部
 * Decapsulate（无隐式拒绝）；本实现走 FIPS 203 完整 Decaps（含隐式拒绝），
 * 对合法密文 ss_M 逐字节一致，被篡改密文则输出隐式拒绝值 K̄（更稳妥）。
 *
 * 验证：草案附录 C 测试向量 #1（seed/eseed/ss）逐字节对拍通过；
 * 组件对拍：ss_M / ss_X 与直接调 mlkem、x25519 一致；端到端 + 固定种子确定性通过。
 */

import { register } from "./registry.js";
import { keccakF1600 } from "./hash.js";
import { mlkemKeyGenBytes, mlkemEncapsBytes, mlkemDecapsBytes } from "./mlkem.js";
import { x25519, scalarBase } from "./x25519.js";

// ============================================================
// 字节工具
// ============================================================

function hexToBytes(hex) {
  let h = String(hex == null ? "" : hex).replace(/^0x/i, "").replace(/\s+/g, "");
  if (!h) return new Uint8Array(0);
  if (h.length % 2) h = "0" + h;
  if (!/^[0-9a-fA-F]*$/.test(h)) throw new Error(`含非 hex 字符`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function concatBytes(...arrs) {
  let total = 0;
  for (const a of arrs) total += a.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** CSPRNG（mlkem.js 同款：无 crypto.getRandomValues 直接报错，不降级）。 */
function randomBytes(n) {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const b = new Uint8Array(n);
    c.getRandomValues(b);
    return b;
  }
  throw new Error("无可用 CSPRNG（crypto.getRandomValues），无法生成随机种子");
}

// ============================================================
// Keccak 海绵（FIPS 202；复用 hash.js keccakF1600，mlkem.js 同构）
// X-Wing 只需两个原语：SHA3-256（组合器）、SHAKE256（sk 扩展 96B）
// ============================================================

function sponge(rate, padByte, msg, outLen) {
  const sLo = new Array(25).fill(0);
  const sHi = new Array(25).fill(0);
  const msgLen = msg.length;
  const padLen = rate - (msgLen % rate);
  const total = msgLen + padLen;
  const padded = new Uint8Array(total);
  padded.set(msg);
  padded[msgLen] = padByte;
  padded[total - 1] |= 0x80;
  for (let off = 0; off < total; off += rate) {
    for (let i = 0; i < rate; i += 8) {
      const li = i >> 3;
      const p = off + i;
      const lo = (padded[p] | (padded[p + 1] << 8) | (padded[p + 2] << 16) | (padded[p + 3] << 24)) >>> 0;
      const hi = (padded[p + 4] | (padded[p + 5] << 8) | (padded[p + 6] << 16) | (padded[p + 7] << 24)) >>> 0;
      sLo[li] = (sLo[li] ^ lo) >>> 0;
      sHi[li] = (sHi[li] ^ hi) >>> 0;
    }
    keccakF1600(sLo, sHi);
  }
  const out = new Uint8Array(outLen);
  let produced = 0;
  while (produced < outLen) {
    const blockBytes = Math.min(rate, outLen - produced);
    for (let i = 0; i < blockBytes; i++) {
      const laneIdx = i >> 3;
      const bil = i & 7;
      const word = bil < 4 ? sLo[laneIdx] : sHi[laneIdx];
      out[produced++] = (word >>> ((bil & 3) * 8)) & 0xff;
    }
    if (produced < outLen) keccakF1600(sLo, sHi);
  }
  return out;
}

/** SHA3-256（FIPS 202 §6.1）：组合器 KDF。 */
function sha3_256(msg) { return sponge(136, 0x06, msg, 32); }
/** SHAKE256(msg, n)（FIPS 202 §6.2）：sk → 96B 扩展。 */
function shake256(msg, n) { return sponge(136, 0x1f, msg, n); }

// ============================================================
// X-Wing 核心（draft-connolly-cfrg-xwing-kem §5）
// ============================================================

const XWING_LABEL = new Uint8Array([0x5c, 0x2e, 0x2f, 0x2f, 0x5e, 0x5c]); // "\./" ‖ "/^\" = 5c2e2f2f5e5c
const X25519_BASE = (() => { const b = new Uint8Array(32); b[0] = 9; return b; })();
const PK_M_LEN = 1184, PK_X_LEN = 32, PK_LEN = 1216;
const CT_M_LEN = 1088, CT_X_LEN = 32, CT_LEN = 1120;

/** §5.2 expandDecapsulationKey：32B 种子 → { d, z, skX, pkM, skM(full dk), pkX }。 */
function expandDecapsulationKey(sk) {
  const expanded = shake256(sk, 96);
  const d = expanded.slice(0, 32);
  const z = expanded.slice(32, 64);
  const skX = expanded.slice(64, 96);
  // mlkem.js 字节接口只收 hex 字符串（Uint8Array 会被 String() 化成十进制逗号串）
  const kg = mlkemKeyGenBytes("768", bytesToHex(d), bytesToHex(z));
  return { d, z, skX, pkM: kg.ek, dkM: kg.dk, pkX: scalarBase(skX) };
}

/** §5.3 Combiner：SHA3-256(ss_M ‖ ss_X ‖ ct_X ‖ pk_X ‖ label)，顺序与标签逐字照规范。 */
function combiner(ssM, ssX, ctX, pkX) {
  return sha3_256(concatBytes(ssM, ssX, ctX, pkX, XWING_LABEL));
}

/** §5.2 GenerateKeyPairDerand：sk 32B（留空随机）→ { sk, pk, ... }。 */
function xwingKeyGenBytes(sk) {
  if (sk == null || sk.length === 0) sk = randomBytes(32);
  if (sk.length !== 32) throw new Error(`sk 须为 32 字节种子（当前 ${sk.length} 字节）`);
  const x = expandDecapsulationKey(sk);
  return { sk, pk: concatBytes(x.pkM, x.pkX), skX: x.skX, pkX: x.pkX, pkM: x.pkM, dkM: x.dkM };
}

/** §5.4(1) EncapsulateDerand：eseed 64B（留空随机）→ { ct, ss }。 */
function xwingEncapsBytes(pk, eseed) {
  if (pk instanceof Uint8Array) pk = bytesToHex(pk);
  pk = hexToBytes(pk);
  if (pk.length !== PK_LEN) throw new Error(`pk 类型检查失败：X-Wing 应为 ${PK_LEN} 字节，实得 ${pk.length}`);
  let eSeedBytes;
  if (eseed == null || String(eseed).trim() === "") eSeedBytes = randomBytes(64);
  else {
    eSeedBytes = eseed instanceof Uint8Array ? eseed : hexToBytes(eseed);
    if (eSeedBytes.length !== 64) throw new Error(`eseed 须为 64 字节 hex（当前 ${eSeedBytes.length} 字节）`);
  }
  const pkM = pk.slice(0, PK_M_LEN);
  const pkX = pk.slice(PK_M_LEN);
  const ekX = eSeedBytes.slice(32); // eseed[32:64] → X25519 临时私钥
  const ctX = x25519(ekX, X25519_BASE);
  const ssX = x25519(ekX, pkX);
  const enc = mlkemEncapsBytes("768", bytesToHex(pkM), bytesToHex(eSeedBytes.slice(0, 32))); // eseed[0:32] → ML-KEM m
  const ss = combiner(enc.ss, ssX, ctX, pkX);
  return { ct: concatBytes(enc.ct, ctX), ss, eseed: eSeedBytes };
}

/** §5.5 Decapsulate：ct 1120B + sk 32B → { ss }。 */
function xwingDecapsBytes(sk, ct) {
  if (sk instanceof Uint8Array) sk = bytesToHex(sk);
  if (ct instanceof Uint8Array) ct = bytesToHex(ct);
  sk = hexToBytes(sk);
  ct = hexToBytes(ct);
  if (sk.length !== 32) throw new Error(`sk 类型检查失败：X-Wing 应为 32 字节种子，实得 ${sk.length}`);
  if (ct.length !== CT_LEN) throw new Error(`ct 类型检查失败：X-Wing 应为 ${CT_LEN} 字节，实得 ${ct.length}`);
  const x = expandDecapsulationKey(sk);
  const ctM = ct.slice(0, CT_M_LEN);
  const ctX = ct.slice(CT_M_LEN);
  const dec = mlkemDecapsBytes("768", bytesToHex(x.dkM), bytesToHex(ctM)); // { ss, implicit }
  const ssX = x25519(x.skX, ctX);
  const ss = combiner(dec.ss, ssX, ctX, x.pkX);
  return { ss, implicit: !!dec.implicit };
}

// ============================================================
// op 包装（三档族，familyLabel 沿用 mlkem 族已有 key：keygen/encaps/decaps）
// ============================================================

register({
  id: "xwingKeyGen",
  family: "xwing", familyLabel: "keygen",
  cat: "asym",
  name: "X-Wing 密钥生成",
  desc: "X-Wing 混合 KEM（X25519+ML-KEM-768，draft-connolly-cfrg-xwing-kem）密钥生成：32B 种子 SHAKE256 扩展 96B 派生双组件，pk=ML-KEM ek(1184B)‖X25519 公钥(32B)。种子可固定复现",
  params: [
    { key: "seed", label: "种子 sk (hex 32B，留空随机)", type: "text", default: "", placeholder: "教学复现可固定，官方向量见 tips" },
  ],
  run: (_t, p = {}) => {
    const r = xwingKeyGenBytes(p.seed && String(p.seed).trim() ? hexToBytes(p.seed) : null);
    return {
      text: [
        "标准: draft-connolly-cfrg-xwing-kem (X25519 + ML-KEM-768 混合 KEM)",
        `私钥 sk (32 B 种子):`,
        bytesToHex(r.sk),
        `公钥 pk (${r.pk.length} B，= pk_M(1184B) ‖ pk_X(32B)):`,
        bytesToHex(r.pk),
        "",
        "说明: sk 是 32 字节种子（非拼接），SHAKE256(sk,96) → [0:32]=ML-KEM d、[32:64]=ML-KEM z、[64:96]=X25519 sk。",
        "pk 前 1184 字节是 ML-KEM-768 ek，末 32 字节是 X25519 公钥。",
        "",
        "私钥 sk ⚠ 敏感请妥善保管。点击下方按钮下载（hex 文本，可直接粘回封装/解封装）。",
      ].join("\n"),
      files: [
        { name: "xwing_sk.priv.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.sk) + "\n") },
        { name: "xwing_pk.pub.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.pk) + "\n") },
      ],
    };
  },
});

register({
  id: "xwingEncaps",
  family: "xwing", familyLabel: "encaps",
  cat: "asym",
  name: "X-Wing 封装",
  desc: "X-Wing 封装：输入公钥 pk(1216B)，ct=ML-KEM ct(1088B)‖X25519 临时公钥(32B)，ss=SHA3-256(ss_M‖ss_X‖ct_X‖pk_X‖\"\\./\"\"/^\\\")。eseed 可固定复现官方测试向量",
  params: [
    { key: "eseed", label: "随机性 eseed (hex 64B，留空随机)", type: "text", default: "", placeholder: "教学复现可固定" },
  ],
  run: (t, p = {}) => {
    const r = xwingEncapsBytes(t, p.eseed);
    return {
      text: [
        `密文 ct (${r.ct.length} B，= ct_M(1088B) ‖ ct_X(32B 临时公钥)):`,
        bytesToHex(r.ct),
        `共享密钥 ss (32 B):`,
        bytesToHex(r.ss),
        `随机性 eseed (64B):`,
        bytesToHex(r.eseed),
        "",
        "说明: ss_M 来自 ML-KEM-768 封装，ss_X=X25519(临时私钥, pk_X)，",
        "组合器 ss = SHA3-256(ss_M ‖ ss_X ‖ ct_X ‖ pk_X ‖ XWingLabel)。",
      ].join("\n"),
      files: [
        { name: "xwing_ct.bin", mime: "application/octet-stream", bytes: r.ct },
        { name: "xwing_ss.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(r.ss) + "\n") },
      ],
    };
  },
});

register({
  id: "xwingDecaps",
  family: "xwing", familyLabel: "decaps",
  cat: "asym",
  name: "X-Wing 解封装",
  desc: "X-Wing 解封装：输入密文 ct(1120B) + 私钥 sk(32B 种子)，从种子重扩展双组件解出 ss。密文被篡改时走 ML-KEM 隐式拒绝路径（输出不可预测值）",
  params: [
    { key: "sk", label: "私钥 sk (hex 32B 种子)", type: "text", default: "", placeholder: "密钥生成档输出的 sk hex" },
  ],
  run: (t, p = {}) => {
    if (!p.sk || !String(p.sk).trim()) throw new Error("请在参数区填入私钥 sk（32B hex 种子）");
    const r = xwingDecapsBytes(p.sk, t);
    const lines = [
      `共享密钥 ss (32 B):`,
      bytesToHex(r.ss),
    ];
    if (r.implicit) lines.push("注: 隐式拒绝路径（ML-KEM 重加密不符，密文疑被篡改）");
    return lines.join("\n");
  },
});

// 导出字节级接口（mlkem.js/hash.js 同款先例：供测试对拍与上层复用）
export { sha3_256, shake256, xwingKeyGenBytes, xwingEncapsBytes, xwingDecapsBytes };
