/*
 * ntruCca2.js — NTRU CCA-2 变体（hash-based SVES，教学演示口径）。
 *
 * 基础 PKE 与 SVES 字节映射完全复用 ntruReal.js（EESS1 v3.1 口径，P1363.1 §9.2.2/9.2.3
 * 的 3bit→2 系数映射）。本文件在其上加「hash 绑定」变换：
 *   - 随机 b 字段改为 MGF1-SHA256(参数集‖明文) 派生（加密全确定）；
 *   - 盲化多项式 r 由 (b ‖ 明文) 的哈希确定性采样；
 *   - 解密端从恢复的 M 里取回 b，重算 MGF 并与明文绑定校验——不一致即判定
 *     「密文被篡改/非本方案密文」并拒绝（CCA-2 重加密校验的思想）。
 *
 * 诚实边界（卡面要求"不得把演示当生产级攻击/方案"）：
 *   这是 EESS1 v3.1 的 SVES hash-based 变体的教学实现（NAEP/P1363.1 思想），
 *   无官方测试向量；底层 SVES 映射与 PKE 数学与 ntruReal.js 同源（该文件已与
 *   libntru/论文口径逐条对齐）。生产使用请用经标准审定的 KEM（如 ML-KEM）。
 *
 * 红线：件内自注册，零 UI 依赖；加密路径全确定性（不消耗随机源），randOps 无需登记。
 */

import { register } from "./registry.js";
import { __ntruReal } from "./ntruReal.js";
import { decodeUtf8Lossless } from "./bytesIo.js";

const { SETS, polyMulMod, fromSves, toSves, unpackCoefs, packCoefs, makeRng, sampleF, combineProd, buildF, centerLift, mod3, mLenBytes } = __ntruReal;

const QBITS = 11; // 全部内置参数集 q = 2^11（与 ntruReal.js 一致）

// ============================================================
// 基础工具
// ============================================================

function hexToBytes(hex) {
  const h = String(hex || "").replace(/^0x/i, "").replace(/[\s_-]+/g, "");
  if (!h) throw new Error("输入为空（需要 hex）");
  if (h.length % 2) throw new Error("hex 长度为奇数");
  if (!/^[0-9a-fA-F]+$/.test(h)) throw new Error("含非 hex 字符");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) { let s = ""; for (const x of b) s += x.toString(16).padStart(2, "0"); return s; }
function te(s) { return new TextEncoder().encode(String(s)); }
function concat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto（需 HTTPS 或 localhost）");
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

/** MGF1-SHA256（PKCS#1 v2.2 附录 B.2.1 口径）：seed 派生任意长度掩码 */
async function mgf1(seed, len) {
  const out = new Uint8Array(len);
  let off = 0;
  for (let counter = 0; off < len; counter++) {
    const block = await sha256(concat(seed, new Uint8Array([counter >>> 24, (counter >>> 16) & 0xff, (counter >>> 8) & 0xff, counter & 0xff])));
    const take = Math.min(32, len - off);
    out.set(block.subarray(0, take), off);
    off += take;
  }
  return out;
}

function setByTag(tag) {
  const set = SETS[tag - 1];
  if (!set) throw new Error(`密钥标签字节 ${tag} 不在参数集范围内（1..${SETS.length}）`);
  return set;
}

/** 解析公钥（tag ‖ h 紧凑系数流）→ { set, h } */
function parsePub(pubBytes) {
  if (!pubBytes.length) throw new Error("公钥为空");
  const set = setByTag(pubBytes[0]);
  const h = unpackCoefs(pubBytes.subarray(1), set.N, QBITS);
  return { set, h };
}
/** 解析私钥（tag ‖ 成分 ×2bit 紧凑流；产品式 3 成分 / 标准式 1 成分）→ { set, parts } */
function parsePriv(privBytes) {
  if (!privBytes.length) throw new Error("私钥为空");
  const set = setByTag(privBytes[0]);
  const partLen = Math.ceil((set.N * 2) / 8);
  const cnt = set.prod ? 3 : 1;
  if (privBytes.length !== 1 + cnt * partLen) {
    throw new Error(`私钥长度不符：${set.name} 应为 ${1 + cnt * partLen} 字节，当前 ${privBytes.length}`);
  }
  const parts = [];
  for (let i = 0; i < cnt; i++) parts.push(unpackCoefs(privBytes.subarray(1 + i * partLen, 1 + (i + 1) * partLen), set.N, 2));
  return { set, parts };
}

// ============================================================
// hash 绑定内核：b = MGF1(域分隔 ‖ 明文)；r = sampleF(H(b‖明文))
// ============================================================

async function deriveB(set, msg) {
  return mgf1(concat(te("ntru-cca2-b|" + set.name + "|"), msg), set.db / 8);
}
async function deriveR(set, b, msg) {
  const seed = await sha256(concat(te("ntru-cca2-r|" + set.name + "|"), b, msg));
  return sampleF(set, makeRng(bytesToHex(seed)));
}

/** 加密内核：M = b‖octL‖msg‖0 → m → e = r∗h + m (mod q) → eBytes */
async function cca2EncryptCore(set, h, msg) {
  const N = set.N, q = set.q;
  const Mlen = mLenBytes(N);
  const maxMsg = Mlen - set.db / 8 - 2;
  if (msg.length > maxMsg) throw new Error(`明文过长：${set.name} 上限 ${maxMsg} 字节，当前 ${msg.length} 字节（超长请先对称压缩/分片）`);
  const b = await deriveB(set, msg);
  const M = new Uint8Array(Mlen);
  M.set(b, 0);
  M[set.db / 8] = msg.length;
  M.set(msg, set.db / 8 + 1);
  const m = fromSves(M, N);
  const { F: r } = await deriveR(set, b, msg);
  const R = polyMulMod(r, h, N, q);
  const e = new Array(N);
  for (let i = 0; i < N; i++) e[i] = ((R[i] + m[i]) % q + q) % q;
  const eBytes = new Uint8Array(1 + Math.ceil((N * QBITS) / 8));
  eBytes[0] = SETS.indexOf(set) + 1;
  eBytes.set(packCoefs(e, QBITS), 1);
  return { eBytes, b, M };
}

/** 解密内核（ntruReal 解密数学 + b 重算校验） */
async function cca2DecryptCore(set, parts, eBytes) {
  const N = set.N, q = set.q;
  const e = unpackCoefs(eBytes.subarray(1), N, QBITS);
  const F = set.prod ? combineProd(N, parts) : parts[0];
  const f = buildF(set, F);
  const a = centerLift(polyMulMod(f, e, N, q), q);
  const m012 = mod3(a);
  const Mlen = mLenBytes(N);
  let M;
  try {
    M = toSves(m012, Mlen);
  } catch {
    throw new Error("SVES 解码失败：密文被篡改或损坏（出现非法系数对）");
  }
  const blen = set.db / 8;
  const maxMsg = Mlen - blen - 2;
  const cl = M[blen];
  if (cl > maxMsg) throw new Error("长度字段非法：解密失败或密文被篡改");
  for (let i = blen + 1 + cl; i < Mlen; i++) {
    if (M[i] !== 0) throw new Error("零填充校验失败：解密失败或密文被篡改");
  }
  const msg = M.slice(blen + 1, blen + 1 + cl);
  const bRec = M.slice(0, blen);
  const bExp = await deriveB(set, msg);
  let bOk = bRec.length === bExp.length && bRec.every((v, i) => v === bExp[i]);
  if (!bOk) throw new Error("CCA-2 校验失败：恢复的 b 与 MGF(明文) 不一致（密文被篡改或非本方案密文）");
  return { msg, b: bRec };
}

// ============================================================
// op 注册：加密 / 解密 两档
// ============================================================

register({
  id: "ntruCca2Encrypt",
  cat: "asym",
  family: "ntruCca2",
  familyLabel: "encrypt",
  name: "NTRU CCA-2 加密",
  desc: "NTRU CCA-2 变体加密（hash-based SVES，EESS1 v3.1 + P1363.1 映射之上加 MGF1-SHA256 绑定）：b 与盲化 r 均由明文哈希确定性派生，加密全确定可复现；解密端重算 MGF 校验 b——不一致拒绝（重加密校验思想）。教学演示口径，无官方 KAT，生产请用 ML-KEM 等标准 KEM。明文 UTF-8，密钥来自「NTRU 密钥生成」",
  params: [
    { key: "pub", label: "公钥（hex，NTRU 密钥生成的公钥）", type: "text", default: "", placeholder: "01 开头的公钥 hex" },
  ],
  run: async (_text, p) => {
    const pubBytes = hexToBytes(String((p && p.pub) || ""));
    const { set, h } = parsePub(pubBytes);
    const msg = te(String(_text ?? ""));
    if (!msg.length) throw new Error("明文为空");
    const { eBytes } = await cca2EncryptCore(set, h, msg);
    return {
      text: [
        `=== NTRU CCA-2 加密（${set.name}，hash-based SVES）===`,
        `参数集 = ${set.name}（N=${set.N}, q=${set.q}）`,
        `明文 ${msg.length} 字节 → 密文 ${eBytes.length} 字节（含 1 字节参数集标签）`,
        "",
        "确定性说明：b = MGF1-SHA256(参数集‖明文)，r 由 (b‖明文) 哈希确定性采样——",
        "同 (公钥, 明文) 每次加密结果相同（这是重加密校验能成立的前提，非缺陷）。",
        "解密端会重算 MGF 并与恢复的 b 比对，任何篡改都被拒绝（CCA-2 校验）。",
      ].join("\n"),
      files: [{ name: "ntru_cca2_e.hex", mime: "text/plain", bytes: new TextEncoder().encode(bytesToHex(eBytes) + "\n") }],
    };
  },
});

register({
  id: "ntruCca2Decrypt",
  cat: "asym",
  family: "ntruCca2",
  familyLabel: "decrypt",
  name: "NTRU CCA-2 解密",
  desc: "NTRU CCA-2 变体解密（与「NTRU CCA-2 加密」配对）：EESS1 解密数学还原 M 后，重算 MGF1-SHA256(明文) 与恢复的 b 比对——不一致即拒绝（密文被篡改）；另做 octL/零填充双重校验。教学演示口径（无官方 KAT），底层 PKE/SVES 与「NTRU 系列原语」同源",
  params: [
    { key: "priv", label: "私钥（hex，NTRU 密钥生成的私钥）", type: "text", default: "", placeholder: "01 开头的私钥 hex" },
    { key: "ct", label: "密文（hex，含参数集标签）", type: "text", default: "", placeholder: "加密产物 ntru_cca2_e.hex 的内容" },
  ],
  run: async (_text, p) => {
    const privBytes = hexToBytes(String((p && p.priv) || ""));
    const eBytes = hexToBytes(String((p && p.ct) || _text || ""));
    const { set, parts } = parsePriv(privBytes);
    if (!eBytes.length) throw new Error("密文为空");
    if (eBytes[0] !== SETS.indexOf(set) + 1) throw new Error(`密文参数集标签（${eBytes[0]}）与私钥（${SETS.indexOf(set) + 1}）不匹配`);
    const { msg } = await cca2DecryptCore(set, parts, eBytes);
    const dec = decodeUtf8Lossless(msg);
    return {
      text: [
        `=== NTRU CCA-2 解密（${set.name}）===`,
        `CCA-2 校验：✓ 通过（b == MGF1-SHA256(明文)，密文未被篡改）`,
        `明文 ${msg.length} 字节 = ${bytesToHex(msg)}`,
        dec.ok ? `按 UTF-8 解释：${dec.text}` : "（非 UTF-8，按 hex 呈现）",
      ].join("\n"),
    };
  },
});
