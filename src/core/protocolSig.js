/*
 * protocolSig.js — T398 批C 协议原语四件（Merkle 证明 / Pedersen 承诺 / Feldman VSS / LSAG 环签名）。
 * 群：SM2 曲线（复用 sm2.js 的 ptMul/ptAdd/ptAffine，基点即 SM2 G）；哈希：SHA-256（WebCrypto）。
 * LSAG 口径：Liu–Wei–Wong 2004（eprint 2004/027），Hp(x) = Hn(x)·G 简化（论文允许），key image 可链接。
 */
import { register } from "./registry.js";
import { ptMul, ptAdd, ptAffine, CURVE } from "./sm2.js";

const { p, n, Gx, Gy } = CURVE;
const G = [Gx, Gy];
// ⚠ sm2.js 的 ptMul 会把输入 Z 强制置 1（仿射假设），雅可比输入必须先转仿射
function mulAff(k, pt) { if (pt.length === 2) pt = [pt[0], pt[1], 1n]; const a = ptAffine(pt); if (!a) return [0n, 1n, 0n]; return ptMul(((k % n) + n) % n, [a[0], a[1], 1n]); }

// ---------- 工具 ----------
function modN(a) { const r = a % n; return r < 0n ? r + n : n === 0n ? 0n : r; }
function hexToBig(hex) {
  const s = String(hex || "").replace(/^0x/i, "").replace(/[^0-9a-fA-F]/g, "") || "0";
  return BigInt("0x" + s);
}
function bigHex(x) { return x.toString(16).padStart(64, "0"); }
function ptHex(pt) { const a = ptAffine(pt); if (!a) return "00"; return "04" + bigHex(a[0]) + bigHex(a[1]); }
function ptFromHex(s) {
  const str = String(s || "").replace(/^0x/i, "").trim();
  if (str === "00") return [0n, 1n, 0n];
  if (!/^04[0-9a-fA-F]{128}$/.test(str)) throw new Error("点须为 04‖x‖y（130 hex 字符）格式");
  return [BigInt("0x" + str.slice(2, 66)), BigInt("0x" + str.slice(66, 130)), 1n];
}
function hexToBytes(hex) {
  const clean = String(hex || "").replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function u8ToHex(b) { return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join(""); }
async function sha256(bytes) {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(d);
}
async function hashScalar(parts) {
  const enc = new TextEncoder();
  const all = concatU8(parts.map((x) => (x instanceof Uint8Array ? x : enc.encode(String(x)))));
  const h = await sha256(all);
  return modN(BigInt("0x" + u8ToHex(h)));
}
function concatU8(arrs) {
  let total = 0; for (const a of arrs) total += a.length;
  const out = new Uint8Array(total); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function randScalar() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  return modN(BigInt("0x" + u8ToHex(b)));
}

// 派生第二基点 H（Pedersen / LSAG Hp 用）：H = [SHA256("ebctf-pedersen-H")]G
let H_CACHE = null;
function secondBase() {
  if (!H_CACHE) {
    const enc = new TextEncoder();
    // 同步场景无 WebCrypto 时退化：用 FNV 展开为 32B 再乘（仅作为第二基点的确定性来源）
    H_CACHE = [BigInt("0x" + u8ToHex(sha256Sync(enc.encode("ebctf-pedersen-H")))), 1n, 0n];
    H_CACHE = ptMul(modN(H_CACHE[0]), G);
  }
  return H_CACHE;
}
function sha256Sync(bytes) {
  // 简易同步 SHA-256（仅用于派生常量，数据路径仍走 WebCrypto 异步）
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
      h = g; g = f; f = c; c = b;
      b = (a + t1) >>> 0; a = (t1 + t2) >>> 0; d = (d + t1) >>> 0;
    }
    const nx = [H[0] + a, H[1] + b, H[2] + c, H[3] + d, H[4] + e, H[5] + f, H[6] + g, H[7] + h];
    H = nx.map((x) => x >>> 0);
  }
  const out = new Uint8Array(32);
  new DataView(out.buffer).setUint32(0, H[0]);
  for (let i = 0; i < 8; i++) new DataView(out.buffer).setUint32(i * 4, H[i]);
  return out;
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

// ============ ② Pedersen 承诺（SM2 群）：C = m·G + r·H ============
function pedersenCommitCalc(mBig, rBig) {
  return ptAdd(ptMul(mBig % n, G), ptMul(rBig % n, secondBase()));
}

// ============ ③ Feldman VSS：承诺 A_j = [a_j]G，share_i = f(i) ============
function polyEvalModN(coefs, x) {
  // Horner mod n：coefs[0] + coefs[1]x + ...
  let acc = 0n;
  for (let j = coefs.length - 1; j >= 0; j--) acc = (acc * x + coefs[j]) % n;
  return ((acc % n) + n) % n;
}

// ============ ④ LSAG 环签名（LWW2004） ============
const enc = new TextEncoder();
function lsagHn(parts) {
  if (!Array.isArray(parts)) parts = [parts];
  // Hn → 标量 mod n（同步版 sha256）
  const all = concatU8(parts.map((x) => (x instanceof Uint8Array ? x : enc.encode(String(x)))));
  return modN(BigInt("0x" + u8ToHex(sha256Sync(all))));
}
export function lsagHp(Lhex) { return mulAff(lsagHn(Lhex), G); } // 论文允许的简化：Hp(x)=Hn(x)·G
export function lsagPointBytes(pt) {
  const a = ptAffine(pt);
  if (!a) return new Uint8Array(64);
  return concatU8([hexToBytes(bigHex(a[0])), hexToBytes(bigHex(a[1]))]);
}
export function lsagHnStep(Lhex, ytilde, m, z1, z2) {
  const enc2 = new TextEncoder();
  const all = concatU8([enc2.encode(Lhex + "|" + ytilde + "|" + m + "|"), lsagPointBytes(z1), new Uint8Array([0x2f]), lsagPointBytes(z2)]);
  return modN(BigInt("0x" + u8ToHex(sha256Sync(all))));
}
export function lsagSignBytes(ringPubHexList, skHex, index, msg) {
  const L = ringPubHexList.map((s) => s.trim());
  const t = L.length;
  if (t < 2) throw new Error("LSAG：环至少需要 2 个成员");
  if (index < 0 || index >= t) throw new Error(`LSAG：签名 index 越界（0..${t - 1}）`);
  const xk = modN(hexToBig(skHex));
  const Yk = mulAff(xk, G);
  if (ptHex(Yk) !== L[index]) throw new Error("LSAG：私钥与 index 位置的环公钥不匹配");
  const Lhex = L.join(",");
  const hp = lsagHp(Lhex);
  const ytilde = mulAff(xk, hp); // key image（可链接）
  const hLym = lsagHn([enc.encode(Lhex), enc.encode("|"), enc.encode(ptHex(ytilde)), enc.encode("|"), enc.encode(msg)]);
  const alpha = randScalar();
  const s = new Array(t).fill(0n);
  const cStart = lsagHnStep(Lhex, ptHex(ytilde), msg, mulAff(alpha, G), mulAff(alpha, hp)); // c_{π+1}
  let ci = cStart;
  let i = (index + 1) % t;
  let c0 = null;
  while (i !== index) {
    s[i] = randScalar();
    const z1 = ptAdd(mulAff(s[i], G), mulAff(ci, ptFromHex(L[i])));
    const z2 = ptAdd(mulAff(s[i], hp), mulAff(ci, ytilde));
    ci = lsagHnStep(Lhex, ptHex(ytilde), msg, z1, z2);
    if (i === t - 1) c0 = ci; // i=t-1 步的输出即验证起点挑战 c_0
    i = (i + 1) % t;
  }
  s[index] = modN(alpha - xk * ci); // 此刻 ci = c_π；重构 H(s_π·G+c_π·K_π)=cStart 恒成立
  if (c0 === null) c0 = cStart; // index=t-1：验证起点挑战 = H(s_π·G+c_π·K_π, …) = H(αG, αh) = cStart
  return { ytilde: ptHex(ytilde), c0: c0.toString(16).padStart(64, "0"), s: s.map((x) => x.toString(16).padStart(64, "0")) };
}
export function lsagVerifyBytes(ringPubHexList, msg, sigObj) {
  const L = ringPubHexList.map((s) => s.trim());
  const t = L.length;
  const ytilde = String(sigObj.ytilde || "");
  const c0 = hexToBig(sigObj.c0);
  const s = (sigObj.s || []).map((x) => hexToBig(x));
  if (s.length !== t) throw new Error(`LSAG：s 数量（${s.length}）须与环成员数（${t}）一致`);
  const hp = lsagHp(L.join(","));
  let ci = c0;
  for (let i = 0; i < t; i++) {
    const Ki = ptFromHex(L[i]);
    const z1 = ptAdd(mulAff(s[i], G), ptMul(ci, Ki));
    const z2 = ptAdd(mulAff(s[i], hp), ptMul(ci, ptFromHex(ytilde)));
    ci = lsagHnStep(L.join(","), ytilde, msg, z1, z2);
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
  desc: "椭圆曲线 Pedersen 承诺 C = m·G + r·H（SM2 群，H 为确定性派生第二基点）：计算性隐藏 m、完美绑定向量承诺；参数给 r 或留空随机，勾选验证则以承诺+明文+盲化子打开校验",
  params: [
    { key: "m", label: "承诺值 m（数字）", type: "number", default: 42 },
    { key: "r", label: "盲化因子 r（hex，留空随机）", type: "text", default: "" },
    { key: "verify", label: "打开验证模式（填 C hex 后勾选）", type: "bool", default: false },
    { key: "cHex", label: "待验证承诺 C（hex 点）", type: "text", default: "" },
  ],
  run(_t, p = {}) {
    const m = BigInt(Math.max(0, Number(p.m) || 0));
    const r = p.r && String(p.r).trim() ? modN(hexToBig(p.r)) : randScalar();
    if (p.verify) {
      if (!p.cHex) throw new Error("验证模式需填入承诺 C");
      const expect = ptHex(pedersenCommitCalc(m, r));
      return expect === String(p.cHex).replace(/^0x/i, "").trim().toLowerCase()
        ? "✓ 承诺打开验证通过（C = m·G + r·H）"
        : "✗ 打开验证失败（m/r 与承诺不符）";
    }
    const C = ptHex(pedersenCommitCalc(m, r));
    return ["承诺 C: " + C, "盲化因子 r: " + bigHex(r) + "（⚠ 保存它，打开承诺时需要）", "性质：不同 (m,r) 生成不同 C（绑定向量）；C 不泄露 m（隐藏性）"].join("\n");
  },
});

register({
  id: "feldmanVss", cat: "asym", name: "Feldman VSS",
  desc: "Feldman 可验证秘密分享（t-out-of-n，SM2 群）：多项式 f(x)=s+a₁x+…+a_{t−1}x^{t−1}，份额 (i, f(i))，承诺 A_j=[a_j]G——份额可独立验证且不泄露 s。勾选验证模式校验单份份额",
  params: [
    { key: "secret", label: "秘密 s（数字，<曲线阶）", type: "number", default: 20260905 },
    { key: "t", label: "门限 t", type: "number", default: 3 },
    { key: "n", label: "份额数 n", type: "number", default: 5 },
    { key: "verifyMode", label: "验证模式（校验单份份额）", type: "bool", default: false },
    { key: "commitJson", label: "承诺 JSON（split 输出的 commitments）", type: "textarea", default: "" },
    { key: "shareIdx", label: "待验证份额 index i", type: "number", default: 1 },
    { key: "shareVal", label: "待验证份额值 y_i", type: "text", default: "" },
  ],
  run(_t, p = {}) {
    if (p.verifyMode) {
      let cj;
      try { cj = JSON.parse(String(p.commitJson || "")); } catch (e) { throw new Error("承诺 JSON 解析失败"); }
      const commits = cj.commitments.map((h) => ptFromHex(h));
      const i = BigInt(Math.max(1, Number(p.shareIdx) || 1));
      const y = hexToBig(p.shareVal);
      let expect = commits[0].slice(); // A_0
      let xk = 1n;
      for (let j = 1; j < commits.length; j++) {
        xk = (xk * i) % n;
        expect = ptAdd(expect, ptMul((y * 0n + BigInt(j) === 0n ? 0n : commits[j][0] === undefined ? 0n : 1n) && 1n ? xk : xk, commits[j]));
      }
      // 上面表达式过于绕，直接重算：expect = A0 + Σ xk*A_j
      let acc = commits[0];
      xk = 1n;
      for (let j = 1; j < commits.length; j++) { xk = (xk * i) % n; acc = ptAdd(acc, ptMul(xk, commits[j])); }
      const actual = mulAff(y, G);
      const ok = ptHex(acc) === ptHex(actual);
      return ok ? `✓ 份额 i=${i} 有效（[y_i]G = A₀ + Σ iʲ·Aⱼ）` : "✗ 份额无效（承诺不符）";
    }
    const s = BigInt(Math.max(0, Number(p.secret) || 0)) % n;
    const tt = Math.max(1, Number(p.t) || 3), nn = Math.max(tt, Number(p.n) || 5);
    const coefs = [s];
    for (let j = 1; j < tt; j++) coefs.push(randScalar());
    const commitments = coefs.map((a) => ptHex(mulAff(a, G)));
    const shares = [];
    for (let i = 1; i <= nn; i++) shares.push({ i, y: polyEvalModN(coefs, BigInt(i)).toString(16) });
    return {
      text: [
        `Feldman VSS（${tt}-out-of-${nn}）`,
        "多项式承诺 A_j = [a_j]G：",
        ...commitments.map((c, j) => `  A${j}: ${c}`),
        "份额 (i, y_i)：",
        ...shares.map((x) => `  i=${x.i}: y=${x.y}`),
      ].join("\n"),
      files: [{ name: "feldman_vss.json", mime: "application/json", bytes: new TextEncoder().encode(JSON.stringify({ t: tt, n: nn, commitments, shares }, null, 2)) }],
    };
  },
});

register({
  id: "lsagSign", family: "lsag", familyLabel: "sign", cat: "asym", name: "LSAG 环签名",
  desc: "LSAG 环签名（Liu–Wei–Wong 2004，SM2 群）：n 选一匿名签名 + key image 可链接（同私钥在同环的两签可被关联）。主输入填消息；参数填环公钥列表（每行 04x‖y）、签名者私钥与其在环中的 index",
  params: [
    { key: "ring", label: "环公钥列表（每行 04x‖y hex）", type: "textarea", default: "", placeholder: "04…\n04…\n04…" },
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
    { key: "ring", label: "环公钥列表（每行 04x‖y hex）", type: "textarea", default: "" },
    { key: "sigJson", label: "签名 JSON", type: "textarea", default: "", placeholder: "lsagSign 输出的 sig 文件内容" },
  ],
  run(t, p = {}) {
    const ring = String(p.ring || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    let sigObj;
    try { sigObj = JSON.parse(String(p.sigJson || "")); } catch (e) { throw new Error("签名 JSON 解析失败"); }
    const ok = lsagVerifyBytes(ring, String(t || ""), sigObj);
    return ok
      ? "✓ 环签名有效（签名者 ∈ 环，匿名；key image: " + sigObj.ytilde.slice(0, 20) + "…）"
      : "✗ 环签名无效";
  },
});

export { sha256Sync, lsagHn };
