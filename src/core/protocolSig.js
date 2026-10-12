/*
 * protocolSig.js — 协议原语四件（Merkle 证明 / Pedersen 承诺 / Feldman VSS / LSAG 环签名）。
 * 群：BLS12-381 G1（内联 @noble/curves@2.4.0，MIT © 2022 Paul Miller，
 *   https://github.com/paulmillr/noble-curves，许可文本见 ./lib/noble/LICENSE.txt）；
 *   标量域 = 子群阶 r；点序列化 = 48B 压缩（96 hex）。
 * Pedersen 第二基 H 与 LSAG 的 Hp 均由 RFC 9380 hash-to-curve 生成（DST 各自域分隔），
 *   两基点离散对数不可知 → 绑定性/匿名性的安全前提成立。
 * LSAG 口径：Liu–Wei–Wong 2004（eprint 2004/027），key image 可链接。
 * Feldman：Feldman 1987（FOCS）t-out-of-n，生产级校验（整数门限、n≥t、秘密精确解析、不静默扩份额）。
 * Merkle：SHA-256 树（WebCrypto 异步），与本文件群运算无关。
 */
import { register } from "./registry.js";
import { randomBytes as randBytes } from "./randSource.js";
import { bls12_381 } from "./lib/noble/bls12-381.js";

const G1 = bls12_381.G1; // hasher（hashToCurve）+ Point
const G1Point = G1.Point;
const R = bls12_381.fields.Fr.ORDER; // BLS12-381 子群阶 r（标量域）
const G = G1Point.BASE;

// ---------- 工具 ----------
function modR(a) { const r = a % R; return r < 0n ? r + R : r; }
function hexToBig(hex, what) {
  const s = String(hex ?? "").trim().replace(/^0x/i, "");
  if (!s) throw new Error(`${what}为空：须填非空 hex 字符串`);
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error(`${what}不是合法 hex（含非十六进制字符）`);
  return BigInt("0x" + s);
}
function parseScalarHex(hex, what) {
  const v = hexToBig(hex, what);
  if (v >= R) throw new Error(`${what}超出标量域 [0, r-1]（不做静默约减）`);
  return v;
}
function bigHex(x) { return x.toString(16).padStart(64, "0"); }
function scMul(pt, k) { return k === 0n ? G1Point.ZERO : pt.multiply(k); } // 零标量 → 单位元（底层 multiply 拒绝 0）
function ptHex(pt) { return pt.toHex(); } // 48B 压缩 G1（96 hex）
function ptFromHex(s, what) {
  let pt;
  try { pt = G1Point.fromHex(String(s ?? "").trim().replace(/^0x/i, "")); }
  catch (e) { throw new Error(`${what}点解析失败（须 48B 压缩 G1 hex；底层原因：${e.message}）`); }
  return pt;
}
function hexToBytes(hex) {
  const clean = String(hex || "").replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function u8ToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }
function concatU8(arrs) {
  let total = 0; for (const a of arrs) total += a.length;
  const out = new Uint8Array(total); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
async function sha256(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(d);
}
function sha256Sync(bytes) {
  // 简易同步 SHA-256（仅用于派生常量/挑战哈希，数据路径仍走 WebCrypto 异步）
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  let H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const msg = new Uint8Array(bytes);
  const bitLen = msg.length * 8;
  const padded = new Uint8Array((((msg.length + 8) >> 6) + 1) << 6);
  padded.set(msg); padded[msg.length] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, bitLen >>> 0);
  new DataView(padded.buffer).setUint32(padded.length - 8, Math.floor(bitLen / 0x100000000));
  const w = new Uint32Array(64);
  const rr = (x, n2) => (x >>> n2) | (x << (32 - n2));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = new DataView(padded.buffer).getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rr(e, 6) ^ rr(e, 11) ^ rr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rr(a, 2) ^ rr(a, 13) ^ rr(a, 22);
      const mj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + mj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const nx = [H[0] + a, H[1] + b, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + h];
    H = nx.map((x) => x >>> 0);
  }
  const out = new Uint8Array(32);
  new DataView(out.buffer).setUint32(0, H[0]);
  for (let i = 0; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, H[i]);
  return out;
}
function randScalar() {
  // 64B 熵 → mod R（偏差 < 2^-254，可忽略）
  return modR(BigInt("0x" + u8ToHex(randBytes(64))));
}
function parseDecInt(v, what) {
  const s = String(v ?? "").trim();
  if (!/^\d+$/.test(s)) throw new Error(`${what}须为非负十进制整数字符串（got：${JSON.stringify(s)}）`);
  const num = Number(s);
  if (!Number.isSafeInteger(num)) {
    // 超出安全整数范围的值仅作 BigInt 用途（如秘密），门限/份额数继续走安全整数校验
    return { big: BigInt(s), num: null };
  }
  return { big: BigInt(s), num };
}

// 派生第二基点 H（Pedersen）与 LSAG 的 Hp：RFC 9380 hash-to-curve（BLS12-381 G1，
// simplified-SWU + 同源映射 + clearCofactor，恒定时间；DST 域分隔，与签名 ciphersuite 隔离）
const PEDERSEN_H_DST = "EBCTF-PEDERSEN-BLS12381G1-H2C-V1";
const LSAG_HP_DST = "EBCTF-LSAG-BLS12381G1-HP-V1";
const enc = new TextEncoder();
let H_CACHE = null;
function secondBase() {
  if (!H_CACHE) H_CACHE = G1.hashToCurve(enc.encode("ebctf-pedersen-H"), { DST: PEDERSEN_H_DST });
  return H_CACHE;
}

// ============ ① Merkle 包含证明（SHA-256 树） ============
async function merkleLeaves(lines) {
  const out = [];
  for (const line of lines) out.push(await sha256(new TextEncoder().encode(line)));
  return out;
}
async function merkleRoot(leaves) {
  let level = leaves.map((l) => l.slice());
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const l = level[i], r = i + 1 < level.length ? level[i + 1] : level[i];
      next.push(await sha256(concatU8([l, r])));
    }
    level = next;
  }
  return level[0];
}
export { merkleLeaves, merkleRoot };

// ============ ② Pedersen 承诺（BLS12-381 G1）：C = m·G + r·H ============
function pedersenCommitCalc(mBig, rBig) {
  return scMul(G, mBig).add(scMul(secondBase(), rBig));
}

// ============ ③ Feldman VSS：承诺 A_j = [a_j]G，share_i = f(i) ============
function polyEvalModR(coefs, x) {
  // Horner mod r：coefs[0] + coefs[1]x + ...
  let acc = 0n;
  for (let j = coefs.length - 1; j >= 0; j--) acc = modR(acc * x + coefs[j]);
  return acc;
}

// ============ ④ LSAG 环签名（LWW2004） ============
function lsagHn(parts) {
  if (!Array.isArray(parts)) parts = [parts];
  const all = concatU8(parts.map((x) => (x instanceof Uint8Array ? x : enc.encode(String(x)))));
  return modR(BigInt("0x" + u8ToHex(sha256Sync(all))));
}
export function lsagHp(Lhex) { return G1.hashToCurve(enc.encode(Lhex), { DST: LSAG_HP_DST }); }
export function lsagPointBytes(pt) {
  if (pt.is0()) return new Uint8Array(64);
  const { x, y } = pt.toAffine();
  return concatU8([hexToBytes(x.toString(16).padStart(64, "0")), hexToBytes(y.toString(16).padStart(64, "0"))]);
}
export function lsagHnStep(Lhex, ytilde, m, z1, z2) {
  const all = concatU8([enc.encode(Lhex + "|" + ytilde + "|" + m + "|"), lsagPointBytes(z1), new Uint8Array([0x2f]), lsagPointBytes(z2)]);
  return modR(BigInt("0x" + u8ToHex(sha256Sync(all))));
}
export function lsagSignBytes(ringPubHexList, skHex, index, msg) {
  const L = ringPubHexList.map((s) => String(s).trim().toLowerCase());
  const t = L.length;
  if (t < 2) throw new Error("LSAG：环至少需要 2 个成员");
  const idx = Number(index);
  if (!Number.isSafeInteger(idx) || idx < 0 || idx >= t) throw new Error(`LSAG：签名 index 越界（0..${t - 1}）`);
  const xk = parseScalarHex(skHex, "LSAG：私钥 ");
  if (xk === 0n) throw new Error("LSAG：私钥须在 [1, r-1]");
  const Yk = scMul(G, xk);
  if (ptHex(Yk) !== L[idx]) throw new Error("LSAG：私钥与 index 位置的环公钥不匹配");
  const Lhex = L.join(",");
  const hp = lsagHp(Lhex);
  const ytilde = scMul(hp, xk); // key image（可链接）
  const alpha = randScalar();
  const s = new Array(t).fill(0n);
  const cStart = lsagHnStep(Lhex, ptHex(ytilde), msg, scMul(G, alpha), scMul(hp, alpha)); // c_{π+1}
  let ci = cStart;
  let i = (idx + 1) % t;
  let c0 = null;
  while (i !== idx) {
    s[i] = randScalar();
    const z1 = scMul(G, s[i]).add(scMul(ptFromHex(L[i], "LSAG：环公钥[" + i + "] "), ci));
    const z2 = scMul(hp, s[i]).add(scMul(ytilde, ci));
    ci = lsagHnStep(Lhex, ptHex(ytilde), msg, z1, z2);
    if (i === t - 1) c0 = ci; // i=t-1 步的输出即验证起点挑战 c_0
    i = (i + 1) % t;
  }
  s[idx] = modR(alpha - xk * ci); // 此刻 ci = c_π；重构 H(s_π·G+c_π·K_π)=cStart 恒成立
  if (c0 === null) c0 = cStart; // idx=t-1：验证起点挑战 = H(s_π·G+c_π·K_π, …) = H(αG, αh) = cStart
  return { ytilde: ptHex(ytilde), c0: bigHex(c0), s: s.map((x) => bigHex(x)) };
}
export function lsagVerifyBytes(ringPubHexList, msg, sigObj) {
  const L = ringPubHexList.map((s) => String(s).trim().toLowerCase());
  const t = L.length;
  if (t < 2) throw new Error("LSAG：环至少需要 2 个成员");
  const ytilde = String(sigObj.ytilde || "");
  const c0 = parseScalarHex(sigObj.c0, "LSAG：c0 ");
  const sArr = sigObj.s || [];
  if (!Array.isArray(sArr) || sArr.length !== t) throw new Error(`LSAG：s 数量（${sArr.length}）须与环成员数（${t}）一致`);
  const s = sArr.map((x, i) => parseScalarHex(x, `LSAG：s[${i}] `));
  const Lhex = L.join(",");
  const hp = lsagHp(Lhex);
  const yt = ptFromHex(ytilde, "LSAG：key image ");
  let ci = c0;
  for (let i = 0; i < t; i++) {
    const Ki = ptFromHex(L[i], `LSAG：环公钥[${i}] `);
    const z1 = scMul(G, s[i]).add(scMul(Ki, ci));
    const z2 = scMul(hp, s[i]).add(scMul(yt, ci));
    ci = lsagHnStep(Lhex, ytilde, msg, z1, z2);
  }
  return ci === c0;
}

// ============ op 注册 ============
register({
  id: "merkleProve", family: "merkle", familyLabel: "prove", cat: "asym", name: "Merkle 包含证明",
  desc: "SHA-256 Merkle 树：主输入每行一个叶子，参数给叶子序号（0 起）→ 输出根、叶子哈希与兄弟路径；单叶奇数位补自身（Bitcoin 口径）",
  params: [{ key: "leafIndex", label: "目标叶子序号", type: "number", default: 0 }],
  async run(t, p = {}) {
    const lines = String(t || "").split(/\r?\n/).filter((s) => s !== "");
    if (lines.length < 1) throw new Error("主输入每行一个叶子");
    const idx = Number(p.leafIndex) | 0;
    if (idx < 0 || idx >= lines.length) throw new Error(`叶子序号越界（0..${lines.length - 1}）`);
    const leaves = await merkleLeaves(lines);
    const path = [];
    let level = leaves.map((l) => l.slice()), cur = idx;
    while (level.length > 1) {
      // ⚠ 修复（2026-09-05）：旧代码 `cur ^ 1 < level.length` 因运算符优先级解析成 `cur ^ (1 < len)`，cur==1 时兄弟错成自身、越界保护失效
      const sib = (cur ^ 1) < level.length ? cur ^ 1 : cur;
      path.push({ index: cur, sibling: u8ToHex(level[sib]), side: (cur ^ 1) < cur ? "L" : "R" });
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const l = level[i], r = i + 1 < level.length ? level[i + 1] : level[i];
        next.push(await sha256(concatU8([l, r])));
      }
      level = next; cur = cur >> 1;
    }
    return {
      text: [
        "Merkle 根: " + u8ToHex(level[0]),
        `叶子[${idx}] 哈希: ` + u8ToHex(leaves[idx]),
        "兄弟路径（自底向上，side=兄弟在合成时的位置）:",
        ...path.map((x, i) => `  L${i}: ${x.side} ${x.sibling}`),
      ].join("\n"),
      files: [{ name: "merkle_proof.json", mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify({ root: u8ToHex(level[0]), leaf: u8ToHex(leaves[idx]), index: idx, path }, null, 2)) }],
    };
  },
});

register({
  id: "merkleVerify", family: "merkle", familyLabel: "verify", cat: "asym", name: "Merkle 证明验证",
  desc: "验证 Merkle 包含证明：主输入填叶子原文，参数填根/路径 JSON（merkleProve 产物）",
  params: [{ key: "proofJson", label: "证明 JSON", type: "textarea", default: "", placeholder: "merkleProve 输出的 proof 文件内容" }],
  async run(t, p = {}) {
    let pj;
    try { pj = JSON.parse(String(p.proofJson || "")); } catch (e) { throw new Error("证明 JSON 解析失败"); }
    const leaf = await sha256(new TextEncoder().encode(String(t || "")));
    if (u8ToHex(leaf) !== pj.leaf) throw new Error("叶子哈希与证明中的 leaf 不符");
    let cur = leaf;
    for (const step of pj.path) {
      const sib = hexToBytes(step.sibling);
      cur = step.side === "L" ? await sha256(concatU8([sib, cur])) : await sha256(concatU8([cur, sib]));
    }
    const ok = u8ToHex(cur) === pj.root;
    return ok ? "✓ 包含证明有效（重算根 = 证明根）" : "✗ 证明无效（重算根不符）";
  },
});

register({
  id: "pedersenCommit", cat: "asym", name: "Pedersen 承诺",
  desc: "椭圆曲线 Pedersen 承诺 C = m·G + r·H（BLS12-381 G1；H 由 RFC 9380 hash-to-curve 派生，离散对数不可知 → 计算性绑定成立）：完美隐藏 m、计算性绑定。m 为十进制整数（< r），r 盲化因子留空随机；勾选验证则以承诺+明文+盲化子打开校验",
  params: [
    { key: "m", label: "承诺值 m（十进制整数，< r）", type: "number", default: 42 },
    { key: "r", label: "盲化因子 r（hex，留空随机）", type: "text", default: "" },
    { key: "verify", label: "打开验证模式（填 C hex 后勾选）", type: "bool", default: false },
    { key: "cHex", label: "待验证承诺 C（48B 压缩 G1 hex）", type: "text", default: "" },
  ],
  run(_t, p = {}) {
    const m = parseDecInt(p.m, "Pedersen：承诺值 m ");
    if (m.big >= R) throw new Error("Pedersen：承诺值 m 须小于群阶 r（不做静默约减）");
    const r = p.r && String(p.r).trim() ? parseScalarHex(p.r, "Pedersen：盲化因子 r ") : randScalar();
    if (p.verify) {
      if (!p.cHex) throw new Error("验证模式需填入承诺 C");
      const expect = ptHex(pedersenCommitCalc(m.big, r));
      return expect === String(p.cHex).replace(/^0x/i, "").trim().toLowerCase()
        ? "✓ 承诺打开验证通过（C = m·G + r·H）"
        : "✗ 打开验证失败（m/r 与承诺不符）";
    }
    const C = ptHex(pedersenCommitCalc(m.big, r));
    return ["承诺 C: " + C, "盲化因子 r: " + bigHex(r) + "（⚠ 保存它，打开承诺时需要）", "性质：完美隐藏（C 不泄露 m）；计算性绑定（基于 log_G H 不可知，H 为 hash-to-curve 点）"].join("\n");
  },
});

register({
  id: "feldmanVss", cat: "asym", name: "Feldman VSS",
  desc: "Feldman 可验证秘密分享（t-out-of-n，BLS12-381 G1，生产级校验）：多项式 f(x)=s+a₁x+…+a_{t−1}x^{t−1}，份额 (i, f(i))，承诺 A_j=[a_j]G。秘密按十进制字符串精确解析（无精度丢失）；t 须为 ≥1 整数、n≥t、不静默扩份额。勾选验证模式校验单份份额",
  params: [
    { key: "secret", label: "秘密 s（十进制整数，< 群阶 r）", type: "number", default: 20260905 },
    { key: "t", label: "门限 t（≥1 整数）", type: "number", default: 3 },
    { key: "n", label: "份额数 n（≥t 整数）", type: "number", default: 5 },
    { key: "verifyMode", label: "验证模式（校验单份份额）", type: "bool", default: false },
    { key: "commitJson", label: "承诺 JSON（split 输出的 commitments）", type: "textarea", default: "" },
    { key: "shareIdx", label: "待验证份额 index i", type: "number", default: 1 },
    { key: "shareVal", label: "待验证份额值 y_i", type: "text", default: "" },
  ],
  run(_t, p = {}) {
    if (p.verifyMode) {
      let cj;
      try { cj = JSON.parse(String(p.commitJson || "")); } catch (e) { throw new Error("承诺 JSON 解析失败"); }
      if (!Array.isArray(cj.commitments) || !cj.commitments.length) throw new Error("承诺 JSON 缺少非空 commitments 数组");
      const commits = cj.commitments.map((h, j) => ptFromHex(h, `Feldman：承诺 A${j} `));
      const i = parseDecInt(p.shareIdx, "Feldman：份额 index ");
      if (i.num === null || i.num < 1) throw new Error("Feldman：份额 index 须为 ≥1 的安全整数");
      const y = parseScalarHex(p.shareVal, "Feldman：份额值 y_i ");
      // 生产级校验：[y_i]G ?= A₀ + Σ i^j·A_j（逐项群运算，无冗余中间式）
      let acc = commits[0];
      let xk = 1n;
      for (let j = 1; j < commits.length; j++) {
        xk = modR(xk * i.big);
        acc = acc.add(scMul(commits[j], xk));
      }
      const actual = scMul(G, y);
      const ok = acc.equals(actual);
      return ok ? `✓ 份额 i=${i.num} 有效（[y_i]G = A₀ + Σ iʲ·Aⱼ）` : "✗ 份额无效（承诺不符）";
    }
    const s = parseDecInt(p.secret, "Feldman：秘密 s ");
    if (s.big >= R) throw new Error("Feldman：秘密 s 须小于群阶 r（生产级：拒绝而非静默约减）");
    const tt = parseDecInt(p.t, "Feldman：门限 t ");
    if (tt.num === null || tt.num < 1) throw new Error("Feldman：门限 t 须为 ≥1 的整数（生产级：拒绝小数/非整数）");
    const nn = parseDecInt(p.n, "Feldman：份额数 n ");
    if (nn.num === null || nn.num < tt.num) throw new Error(`Feldman：份额数 n（${nn.num}）须 ≥ 门限 t（${tt.num}）（生产级：不静默扩 n）`);
    if (nn.big >= R) throw new Error("Feldman：份额数 n 须 < 群阶 r（保证份额索引 mod r 互异）");
    const coefs = [s.big];
    for (let j = 1; j < tt.num; j++) coefs.push(randScalar());
    const commitments = coefs.map((a) => ptHex(scMul(G, a)));
    const shares = [];
    for (let i = 1; i <= nn.num; i++) shares.push({ i, y: polyEvalModR(coefs, BigInt(i)).toString(16) });
    return {
      text: [
        `Feldman VSS（${tt.num}-out-of-${nn.num}）`,
        "多项式承诺 A_j = [a_j]G：",
        ...commitments.map((c, j) => `  A${j}: ${c}`),
        "份额 (i, y_i)：",
        ...shares.map((x) => `  i=${x.i}: y=${x.y}`),
      ].join("\n"),
      files: [{ name: "feldman_vss.json", mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify({ t: tt.num, n: nn.num, commitments, shares }, null, 2)) }],
    };
  },
});

register({
  id: "lsagSign", family: "lsag", familyLabel: "sign", cat: "asym", name: "LSAG 环签名",
  desc: "LSAG 环签名（Liu–Wei–Wong 2004，BLS12-381 G1）：n 选一匿名签名 + key image 可链接（同私钥在同环的两签可被关联）。Hp 由 RFC 9380 hash-to-curve 生成（离散对数不可知 → 不可由公开值定位签名者）。主输入填消息；参数填环公钥列表（每行 48B 压缩 hex）、签名者私钥与其在环中的 index",
  params: [
    { key: "ring", label: "环公钥列表（每行 96 hex 压缩 G1）", type: "textarea", default: "", placeholder: "96 hex\n96 hex\n…" },
    { key: "sk", label: "签名者私钥 (hex 32B)", type: "text", default: "" },
    { key: "index", label: "签名者在环中的 index（0 起）", type: "number", default: 0 },
  ],
  run(t, p = {}) {
    if (!t || !String(t).trim()) throw new Error("请在主输入框填入待签消息");
    const ring = String(p.ring || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (ring.length < 2) throw new Error("环公钥列表至少 2 行");
    if (!p.sk) throw new Error("请填入签名者私钥");
    const sig = lsagSignBytes(ring, p.sk, Number(p.index) || 0, String(t));
    return {
      text: [
        "LSAG 签名（可链接）:",
        "key image ỹ: " + sig.ytilde,
        "c₀: " + sig.c0,
        ...sig.s.map((x, i) => `s${i}: ${x}`),
      ].join("\n"),
      files: [{ name: "lsag_sig.json", mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify({ ring, message: String(t), ...sig }, null, 2)) }],
    };
  },
});

register({
  id: "lsagVerify", family: "lsag", familyLabel: "verify", cat: "asym", name: "LSAG 环签名验证",
  desc: "LSAG 验签：主输入填原消息；参数填环公钥列表与签名 JSON（lsagSign 产物）。同 key image 的两签即同签者（可链接）",
  params: [
    { key: "ring", label: "环公钥列表（每行 96 hex 压缩 G1）", type: "textarea", default: "", placeholder: "96 hex\n96 hex\n…" },
    { key: "sigJson", label: "签名 JSON", type: "textarea", default: "", placeholder: "lsagSign 输出的 sig 文件内容" },
  ],
  run(t, p = {}) {
    const ring = String(p.ring || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    if (ring.length < 2) throw new Error("环公钥列表至少 2 行");
    let sigObj;
    try { sigObj = JSON.parse(String(p.sigJson || "")); } catch (e) { throw new Error("签名 JSON 解析失败"); }
    const ok = lsagVerifyBytes(ring, String(t || ""), sigObj);
    return ok
      ? "✓ 环签名有效（签名者 ∈ 环，匿名；key image: " + sigObj.ytilde.slice(0, 20) + "…）"
      : "✗ 环签名无效";
  },
});

export { sha256Sync, lsagHn };
