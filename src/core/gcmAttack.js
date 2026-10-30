/*
 * gcmAttack.js — AES-GCM nonce 重用攻击（教学演示）：密钥流复用解密 + forbidden attack
 * （GHASH 认证子 H 恢复与任意伪造）。
 *
 * 规范/文献依据（照标准与原文实现，不编造）：
 * - GCM/GHASH = NIST SP 800-38D §6.4/§7.1；GF(2^128) 域多项式 x^128+x^7+x^2+x+1，
 *   R = 0xe1‖0^120（块内大端位序）。
 * - forbidden attack = Antoine Joux, "Authentication Failures in NIST Version of GCM"
 *   (2006)：同一 IV 下两条消息的 tag 差给出 GHASH 多项式方程 q(H) = T1⊕T2，H 是其在
 *   GF(2^128) 上的根；求出 H 后 mask = T⊕GHASH_H(A,C) 同样可恢复（同一 nonce ⇒ 同一
 *   E_K(J0)），即可对任意新 (A′,C′) 伪造 tag。
 * - 求根 = GF(2^128)[x] 多项式：x^{2^128} mod q 与 q 取 gcd 取出全部线性因子，再用
 *   痕迹映射 Tr(α·x) 递归拆分（标准 Berlekamp/ trace-map 等度拆分；α 取输入摘要派生的
 *   确定性序列——本 op 不消耗随机源）。
 * - 独立攻击 op：不复用/不修改 AEAD 原语（aeadModes.js 的 ChaCha 密钥流恢复覆盖另一族）。
 *
 * 边界（如实声明）：这是 nonce 重用这一协议错误的演示性攻击，不是对 AES 本身的攻击；
 * 防御 = 永不重用 nonce（同一 key 下换 nonce 即失效）。多项式次数（≈ 密文块数）过大时
 * 计算量按次数平方增长，本实现设硬上限并在超限时明确拒绝。
 *
 * 红线：件内自注册，零 UI 依赖，node 可直测；GF 乘法与项目 aeadModes 的 GHASH 同约定
 * （大端块、R=0xe1…），对拍 node:crypto AES-GCM。
 */

import { register } from "./registry.js";
import { decodeUtf8Lossless } from "./bytesIo.js";

// ============================================================
// GF(2^128) 块运算（GCM 约定：大端 BigInt，R = 0xe1‖0^120）
// ============================================================

const R = 0xe1000000000000000000000000000000n;
const MASK128 = (1n << 128n) - 1n;
// 乘法恒元 = 块 0x80…00（BigInt bit 127 ↔ 多项式常数项的反射位序约定，SP 800-38D §6.4）。
// 多项式机器里「x」的一次项系数必须用 ONE，用字面 1n 会把 eval 变成非恒元乘子，破坏环同态。
const ONE = 1n << 127n;

function gmul(x, y) {
  let z = 0n;
  let v = y & MASK128;
  let mask = 1n << 127n;
  for (let i = 0; i < 128; i++) {
    if (x & mask) z ^= v;
    if (v & 1n) v = (v >> 1n) ^ R;
    else v >>= 1n;
    mask >>= 1n;
  }
  return z;
}

function hexToBytes(s) {
  const t = String(s || "").trim().replace(/^0x/i, "").replace(/[\s:_-]+/g, "");
  if (!t) return new Uint8Array(0);
  if (!/^[0-9a-fA-F]+$/.test(t) || t.length % 2) throw new Error("hex 非法（含非 hex 字符或奇数长度）");
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}
function bytesToHex(b) { let s = ""; for (const x of b) s += x.toString(16).padStart(2, "0"); return s; }

function blockToBigInt(bytes, off) {
  let v = 0n;
  const end = Math.min(off + 16, bytes.length);
  for (let i = off; i < end; i++) v = (v << 8n) | BigInt(bytes[i]);
  for (let i = end - off; i < 16; i++) v <<= 8n;
  return v;
}
function bigIntToBlock(v) {
  const out = new Uint8Array(16);
  let x = v & MASK128;
  for (let i = 15; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

// ============================================================
// GF(2^128)[x] 多项式：coeff 数组 [c0..cd]（c_i 为 x^i 的系数，BigInt 块）
// ============================================================

const polyTrim = (a) => { const r = a.slice(); while (r.length && r[r.length - 1] === 0n) r.pop(); return r; };
const polyDeg = (a) => { const r = polyTrim(a); return r.length - 1; };
function polyAdd(a, b) {
  const n = Math.max(a.length, b.length);
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = (i < a.length ? a[i] : 0n) ^ (i < b.length ? b[i] : 0n);
  return polyTrim(out);
}
function polyMul(a, b) {
  if (!a.length || !b.length) return [];
  const out = new Array(a.length + b.length - 1).fill(0n);
  for (let i = 0; i < a.length; i++) {
    const ai = a[i];
    if (ai === 0n) continue;
    for (let j = 0; j < b.length; j++) out[i + j] ^= gmul(ai, b[j]);
  }
  return polyTrim(out);
}
/** a mod b（要求 b 首一；GF 上首一除式系数即商因子） */
function polyMod(a, b) {
  let r = a.slice();
  const db = polyDeg(b);
  if (db < 0) throw new Error("内部错误：多项式对零式取模");
  while (r.length && polyDeg(r) >= db) {
    const dr = polyDeg(r);
    const factor = r[dr];
    r[dr] = 0n;
    for (let i = 0; i < db; i++) r[dr - db + i] ^= gmul(factor, b[i]);
  }
  return polyTrim(r);
}
/** 商：a ÷ b（b 首一；splitLinear 拆 f1 = g·rest 用——整除时余式为 0，商才是另一半） */
function polyDivQuotient(a, b) {
  let r = a.slice();
  const db = polyDeg(b);
  if (db < 0) throw new Error("内部错误：多项式除以零式");
  const out = new Array(Math.max(0, polyDeg(r) - db + 1)).fill(0n);
  while (r.length && polyDeg(r) >= db) {
    const dr = polyDeg(r);
    const factor = r[dr];
    out[dr - db] = factor;
    r[dr] = 0n;
    for (let i = 0; i < db; i++) r[dr - db + i] ^= gmul(factor, b[i]);
  }
  return polyTrim(out);
}

/** 首一化（GF 上除以首系数 = 乘其逆元；逆元用指数 254 求得） */
function polyMakeMonic(a) {
  const r = polyTrim(a);
  if (!r.length) return r;
  const lead = r[r.length - 1];
  if (lead === ONE) return r;
  // 逆元：lead^(2^128 - 2)（费马）；用平方链实现（累加器起点 = 恒元 ONE，非字面 1n）
  let e = (1n << 128n) - 2n;
  let base = lead, inv = ONE;
  while (e > 0n) { if (e & 1n) inv = gmul(inv, base); base = gmul(base, base); e >>= 1n; }
  return polyTrim(r.map((c) => gmul(c, inv)));
}
function polyGcd(a, b) {
  let x = polyMakeMonic(polyTrim(a)), y = polyMakeMonic(polyTrim(b));
  while (y.length) {
    const r = polyMod(x, y);
    x = y;
    y = polyMakeMonic(r);
  }
  return polyMakeMonic(x);
}
/** Horner 求值 */
function polyEval(a, x) {
  let acc = 0n;
  for (let i = a.length - 1; i >= 0; i--) acc = gmul(acc, x) ^ a[i];
  return acc;
}
/** x^{2^m} mod f（m 次「平方后取模」）——m=128 即 x^{2^128} mod f */
function polyX2mMod(f, m) {
  let e = [0n, ONE]; // x（一次项系数 = 恒元）
  for (let i = 0; i < m; i++) e = polyMod(polyMul(e, e), f);
  return e;
}

/** 痕迹映射拆分：f 为「全部根都在 GF(2^128) 内的平方free多项式」，返回其全部线性因子 */
function splitLinear(f, alphaSeq) {
  const factors = [];
  const stack = [polyMakeMonic(f)];
  let alphaIdx = 0;
  while (stack.length) {
    const cur = stack.pop();
    const d = polyDeg(cur);
    if (d <= 0) continue;
    if (d === 1) { factors.push(cur); continue; }
    // t(x) = Tr(α·x) mod cur：e ← (α·x)，反复平方 128 次累加
    const alpha = alphaSeq(alphaIdx++);
    let e = polyMod(polyMul([0n, alpha], [0n, ONE]), cur); // α·x mod cur
    let t = e.slice();
    for (let i = 1; i < 128; i++) {
      e = polyMod(polyMul(e, e), cur);
      t = polyAdd(t, e);
      if (!t.length) t = [0n];
    }
    t = polyMakeMonic(polyTrim(t));
    let g = polyGcd(t, cur);
    g = polyMakeMonic(g);
    if (g.length === 0 || polyDeg(g) === 0 || polyDeg(g) === d) {
      // 本次未拆开（概率 1/2 失败）→ 换下一个 α 重试
      stack.push(cur);
      if (alphaIdx > 64) throw new Error("痕迹映射拆分异常：连续 64 次未拆开（输入异常）");
      continue;
    }
    const rest = polyMakeMonic(polyDivQuotient(cur, g));
    stack.push(g, rest);
  }
  return factors;
}

/** GF(2^128)[x] 多项式求全部 GF(2^128) 根（确定性 α 序列） */
function polyRoots(q, alphaSeq) {
  const f = polyMakeMonic(polyTrim(q));
  if (!f.length || polyDeg(f) <= 0) return [];
  // 直接取全部「不同」线性因子：x^{2^128} ⊕ x 在每个域内根处为零且自身平方free
  // （导数 = 1），故 gcd 与 q 的重数无关——重根不会被此步丢掉。
  const x2m = polyX2mMod(f, 128);
  const lin = polyGcd(polyAdd(x2m, [0n, ONE]), f); // x^{2^128} ⊕ x
  const factors = splitLinear(polyMakeMonic(lin), alphaSeq);
  // f1 = x ⊕ c（首一）→ 根 = c
  return factors.map((fx) => fx[0]);
}

// ============================================================
// GHASH 多项式构造：S(H) = Σ B_j·H^{n-j+1}
// ============================================================

/** (aad, ct) → GHASH 块序列 [B1..Bn]（A 块‖C 块‖len 块，各自右补零） */
function ghashBlocks(aad, ct) {
  const blocks = [];
  const push = (bytes) => {
    for (let off = 0; off < bytes.length; off += 16) blocks.push(blockToBigInt(bytes, off));
  };
  push(aad); push(ct);
  blocks.push((BigInt(aad.length) * 8n << 64n) | (BigInt(ct.length) * 8n));
  return blocks;
}

/** 块序列 → 多项式：coef[p] = B_{n+1-p}（p = 1..n，coef[0] = 0） */
function blocksToPoly(blocks) {
  const n = blocks.length;
  const coef = new Array(n + 1).fill(0n);
  for (let j = 1; j <= n; j++) coef[n - j + 1] = blocks[j - 1];
  return polyTrim(coef);
}

/** 给定 H 直接算 GHASH 值（供伪造与校验） */
function ghashValue(h, aad, ct) {
  let y = 0n;
  for (const b of ghashBlocks(aad, ct)) y = gmul(y ^ b, h);
  return y;
}

// ============================================================
// 样本解析：每行 aadHex|ctHex|tagHex（aad 可空；'|' 分隔）
// ============================================================

function parseSamples(text) {
  const lines = String(text || "").split(/\n+/).map((s) => s.trim()).filter(Boolean);
  if (lines.length < 2) throw new Error("至少需要 2 条样本（每行 aadHex|ctHex|tagHex，同一 key+nonce）");
  const samples = lines.map((line, i) => {
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length !== 3) throw new Error(`第 ${i + 1} 行格式应为 aadHex|ctHex|tagHex（竖线分隔，当前 ${parts.length} 段）`);
    const aad = hexToBytes(parts[0]);
    const ct = hexToBytes(parts[1]);
    const tag = hexToBytes(parts[2]);
    if (tag.length !== 16) throw new Error(`第 ${i + 1} 行 tag 须为 16 字节（32 hex），当前 ${tag.length}`);
    return { aad, ct, tag };
  });
  return samples;
}

/** 确定性 α 序列：FNV-1a 双搅动样本指纹与计数（不消耗随机源；正确性由
 *  「枚举到拆开为止 + 全样本掩码一致校验」保证，α 只影响搜索路径不影响结果集） */
function makeAlphaSeq(samples) {
  const seed = new TextEncoder().encode(
    samples.map((s) => bytesToHex(s.aad) + bytesToHex(s.ct) + bytesToHex(s.tag)).join("|"),
  );
  return (i) => {
    let h = 0xcbf29ce484222325n;
    const buf = new Uint8Array(seed.length + 4);
    buf.set(seed);
    buf[seed.length] = i & 0xff;
    buf[seed.length + 1] = (i >> 8) & 0xff;
    buf[seed.length + 2] = (i >> 16) & 0xff;
    buf[seed.length + 3] = 0x9e;
    for (const b of buf) { h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn; }
    let v = (h << 64n) | ((h ^ 0xa5a5a5a5a5a5a5a5n) & 0xffffffffffffffffn);
    v |= 1n << 127n; // 保证非零
    return v & MASK128;
  };
}

// ============================================================
// op：GCM nonce 重用攻击（密钥流恢复 / H 恢复与伪造）
// ============================================================

const MAX_DEGREE = 256;

register({
  id: "gcmForbidden",
  cat: "crack",
  family: "gcmAttack",
  familyLabel: "forbidden",
  name: "GCM nonce 重用攻击",
  desc: "AES-GCM nonce 重用攻击演示（SP 800-38D + Joux 2006 forbidden attack）：①同一 key+nonce 两条密文 + 已知一侧明文 → 恢复 CTR 密钥流解另一侧；②≥2 条同 nonce 样本（aad|ct|tag）→ GHASH 多项式方程 q(H)=T1⊕T2 在 GF(2^128) 求根恢复认证子 H（对拍 E_K(0^128)），并恢复 E_K(J0) 掩码 → 对任意新 (aad,ct) 伪造可过验证的 tag。独立攻击 op；nonce 不重用即失效，教学演示非生产攻击",
  params: [
    {
      key: "mode", label: "攻击档", type: "select", default: "forbidden",
      options: [
        { value: "forbidden", label: "H 恢复 + 伪造（forbidden attack）" },
        { value: "keystream", label: "密钥流复用解密" },
      ],
    },
    { key: "samples", label: "样本（每行 aadHex|ctHex|tagHex，同 key+nonce）", type: "textarea", default: "", placeholder: "aad可为空：|ct1hex|tag1hex\\n|ct2hex|tag2hex" },
    { key: "known", label: "已知明文（hex，密钥流档）", type: "text", default: "", placeholder: "与第 1 条样本 ct 对应的明文" },
    { key: "newAad", label: "伪造目标 aad（hex，可空）", type: "text", default: "", placeholder: "留空则用空 aad" },
    { key: "newCt", label: "伪造目标 ct（hex）", type: "text", default: "", placeholder: "要伪造 tag 的密文" },
  ],
  run: (_text, p) => {
    const mode = String((p && p.mode) || "forbidden");
    const samples = parseSamples((p && p.samples) || _text);
    const lines = [];
    const files = [];

    if (mode === "keystream") {
      const known = hexToBytes((p && p.known) || "");
      if (!known.length) throw new Error("密钥流档需要已知明文 hex（与第 1 条样本 ct 对应）");
      const [s1, s2] = samples;
      if (s1.ct.length < known.length) throw new Error(`已知明文 ${known.length} 字节超过第 1 条样本密文 ${s1.ct.length} 字节`);
      const ks = new Uint8Array(known.length);
      for (let i = 0; i < known.length; i++) ks[i] = s1.ct[i] ^ known[i];
      const n = Math.min(ks.length, s2.ct.length);
      const p2 = new Uint8Array(n);
      for (let i = 0; i < n; i++) p2[i] = s2.ct[i] ^ ks[i];
      const dec = decodeUtf8Lossless(p2);
      lines.push(
        "=== GCM 密钥流复用解密（同一 key+nonce）===",
        `密钥流（由 ct1 ⊕ 已知明文恢复，${ks.length} 字节）= ${bytesToHex(ks)}`,
        `第 2 条样本明文（前 ${n} 字节）= ${bytesToHex(p2)}`,
        dec ? `按 UTF-8 解释：${dec}` : "（非 UTF-8，按 hex 呈现）",
        "",
        "注意：这只恢复加密方向（CTR 计数器流）。tag 伪造需要 H 恢复档；同一 nonce 下两段的计数器都从 inc32(J0) 起，恢复的密钥流对两段同时有效。",
      );
      return { text: lines.join("\n"), files };
    }

    // forbidden attack
    if (samples.length < 2) throw new Error("forbidden attack 至少 2 条样本（推荐 ≥3 条以排除伪根）");
    for (const [i, s] of samples.entries()) {
      const deg = Math.ceil(s.aad.length / 16) + Math.ceil(s.ct.length / 16) + 1;
      if (deg > MAX_DEGREE) throw new Error(`第 ${i + 1} 条样本块数 ${deg} 超上限 ${MAX_DEGREE}（计算量按次数平方增长）`);
    }
    const polys = samples.map((s) => blocksToPoly(ghashBlocks(s.aad, s.ct)));
    const t1v = blockToBigInt(samples[0].tag, 0);
    const qLen = Math.max(polys[0].length, polys[1].length);
    const q = new Array(qLen).fill(0n);
    for (let i = 0; i < qLen; i++) {
      q[i] = (polys[0][i] || 0n) ^ (polys[1][i] || 0n);
    }
    q[0] ^= t1v ^ blockToBigInt(samples[1].tag, 0);
    const qTrim = polyTrim(q);
    if (!qTrim.length) throw new Error("方程退化为零多项式（两组样本 aad/ct/tag 完全相同？换不同样本）");
    const degQ = polyDeg(qTrim);
    const alphaSeq = makeAlphaSeq(samples);
    const roots = polyRoots(qTrim, alphaSeq);
    if (!roots.length) throw new Error("未找到 H 的候选根（样本可能不同 nonce/不同 key，或数据有误）——nonce 重用前提不成立");

    // 全样本掩码一致性过滤（≥3 条样本时几乎必唯一）
    const cands = [];
    for (const h of roots) {
      const masks = samples.map((s, i) => polyEval(polys[i], h) ^ blockToBigInt(s.tag, 0));
      if (masks.every((m) => m === masks[0])) cands.push({ h, mask: masks[0] });
    }
    if (!cands.length) throw new Error("候选根无一通过全样本掩码一致性校验——样本疑似不同 nonce/key（nonce 重用前提不成立）");
    lines.push(
      "=== GCM forbidden attack（Joux 2006）===",
      `样本数 = ${samples.length}，方程次数 = ${degQ}，多项式根候选 = ${roots.length}，通过全样本一致性 = ${cands.length}`,
      "",
    );
    cands.forEach(({ h, mask }, i) => {
      lines.push(`候选 H${i + 1} = ${bytesToHex(bigIntToBlock(h))}`, `掩码 E_K(J0) = ${bytesToHex(bigIntToBlock(mask))}`);
    });

    // 伪造
    const newAad = hexToBytes((p && p.newAad) || "");
    const newCt = hexToBytes((p && p.newCt) || "");
    if (newCt.length) {
      const degN = Math.ceil(newAad.length / 16) + Math.ceil(newCt.length / 16) + 1;
      if (degN > MAX_DEGREE) throw new Error(`伪造目标块数 ${degN} 超上限 ${MAX_DEGREE}`);
      cands.forEach(({ h, mask }, ci) => {
        const forged = ghashValue(h, newAad, newCt) ^ mask;
        lines.push("", `伪造 tag（候选 H${ci + 1}）= ${bytesToHex(bigIntToBlock(forged))}`,
          "适用范围：仅与样本同 key+nonce（掩码 = E_K(J0) 同值）；换 nonce 即失效。");
      });
      lines.push("", "验证方式（CTF 口径）：把伪造 tag 塞回 AES-GCM 解密端（同 key/nonce/aad/ct）——将通过认证。这证明 nonce 重用击穿 GCM 认证，非 AES 本体被破。");
    } else {
      lines.push("", "（未填伪造目标 aad/ct——只做了 H/掩码恢复；要伪造请在参数里给目标密文）");
    }
    lines.push("", "防御：同一 key 下永不重用 nonce（随机 96 位或计数器式），即两档攻击同时失效。");
    return { text: lines.join("\n"), files };
  },
});

// 供独立验证与回归使用（op 本体经 registry.register 注册；助手导出不改变注册行为）
export { ghashBlocks, blocksToPoly, ghashValue, polyRoots, polyEval, gmul, polyGcd, polyMod, polyDivQuotient, polyMul, polyMakeMonic, polyX2mMod, polyTrim, splitLinear };
