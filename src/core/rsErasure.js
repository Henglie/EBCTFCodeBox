/*
 * rsErasure.js — 支持「擦除（erasure）」的 Reed-Solomon 解码
 *
 * 纯函数、零依赖。是 rsDecodeBlock（只纠已知位置之外的错误、上限 ⌊nsym/2⌋）的增强：
 * 当外部能指出「某些码字位置**已知不可信**」时，纠错能力提升为
 *     e + 2v ≤ nsym
 * （e = 擦除数、v = 未知错误数）—— 位置已知时每个擦除只花 1 个校验符号而非 2 个。
 *
 * 算法（Blahut《Algebraic Codes for Data Transmission》标准路线）：
 *   校正子 → 擦除定位多项式 Λ_e → Forney 校正子 S'=S·Λ_e → BM(S'[e..]) →
 *   Λ=Λ_err·Λ_e → Chien 搜索 → Ω=S·Λ → Forney 求值 → **后验校正子复核**
 *
 * GF 约定与 qrdecode.js / qrcode.js 完全一致（GF(2^8)、0x11D、α=2、fcr=0）。
 *
 * 设计红线：**绝不静默出错** —— 超限、Chien 根数与 Λ 次数不符、Λ'(X⁻¹)=0、
 * 后验校正子非零等情况一律返回明确失败，不返回"看起来成功"的码字。
 */


// ---------- GF(256) ----------
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0) ? 0 : GF_EXP[GF_LOG[a] + GF_LOG[b]];
const gfDiv = (a, b) => {
  if (b === 0) throw new Error("GF 除零");
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255];
};
const gfInv = (a) => (a === 0 ? 0 : GF_EXP[255 - GF_LOG[a]]);
const gp = (i) => GF_EXP[i % 255];              // α^i

// ---------- 多项式（低次在前：p[k] 是 x^k 的系数）----------
function polyMul(a, b) {
  const r = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (!a[i]) continue;
    for (let j = 0; j < b.length; j++) r[i + j] ^= gfMul(a[i], b[j]);
  }
  return r;
}
function polyAdd(a, b) {
  const n = Math.max(a.length, b.length);
  const r = new Array(n).fill(0);
  for (let i = 0; i < n; i++) r[i] = (a[i] || 0) ^ (b[i] || 0);
  return r;
}
function polyEval(p, x) {
  let y = 0;
  for (let i = p.length - 1; i >= 0; i--) y = gfMul(y, x) ^ p[i];
  return y;
}
function polyDerivative(p) {
  const r = [];
  for (let i = 1; i < p.length; i++) r.push(i % 2 ? p[i] : 0);
  while (r.length > 1 && r[r.length - 1] === 0) r.pop();
  return r.length ? r : [0];
}
function polyTrim(p) {
  const r = p.slice();
  while (r.length > 1 && r[r.length - 1] === 0) r.pop();
  return r;
}
function polyDegree(p) { const t = polyTrim(p); return t.length - 1; }

// ---------- 编码（仅用于自测造向量；与解码同一 GF 约定）----------
function generatorPoly(nsym) {
  let g = [1];
  // ⚠ 因子必须是 **(x + α^i)** 而非 (1 + α^i·x)：后者首项系数为 α^i、不是 monic，
  //  乘出来的生成多项式整体差一个常数因子，用它编码会产生非零校正子。
  //  低次在前时 (x + α^i) = [α^i, 1]。
  for (let i = 0; i < nsym; i++) g = polyMul(g, [gp(i), 1]);
  return g;                                                     // 低次在前，次数 = nsym，首项为 1
}
/** 返回 nsym 个校验字节（低次在前） */
function rsParity(data, nsym) {
  const gen = generatorPoly(nsym);
  const gHigh = [];                                             // 去掉最高次项，高次在前
  for (let i = nsym - 1; i >= 0; i--) gHigh.push(gen[i]);
  const rem = new Array(nsym).fill(0);
  for (const b of data) {
    const fb = b ^ rem[0];
    rem.shift(); rem.push(0);
    if (fb) for (let i = 0; i < nsym; i++) rem[i] ^= gfMul(gHigh[i], fb);
  }
  return rem;
}
/** 编码：数据 + 校验 → 完整码字 */
export function rsEncode(data, nsym) {
  return Uint8Array.from(data.concat(rsParity(data, nsym)));
}

// ---------- 校正子 ----------
function computeSyndromes(block, nsym) {
  const syn = new Uint8Array(nsym);
  for (let k = 0; k < nsym; k++) {
    const ak = gp(k);
    let y = 0;
    for (let i = 0; i < block.length; i++) y = gfMul(y, ak) ^ block[i];
    syn[k] = y;
  }
  return syn;
}

// ---------- Berlekamp-Massey（同现用约定：低次在前、Λ[0]=1）----------
function berlekampMassey(syn) {
  const nsym = syn.length;
  let Lambda = [1], B = [1];
  let L = 0, m = 1, b = 1;
  for (let n = 0; n < nsym; n++) {
    let delta = syn[n];
    for (let i = 1; i <= L; i++) delta ^= gfMul(Lambda[i] || 0, syn[n - i] || 0);
    if (delta === 0) { m++; continue; }
    if (2 * L <= n) {
      const T = Lambda.slice();
      const coef = gfDiv(delta, b);
      const shifted = new Array(m).fill(0).concat(B.map((c) => gfMul(c, coef)));
      Lambda = polyAdd(Lambda, shifted);
      L = n + 1 - L;
      B = T; b = delta; m = 1;
    } else {
      const coef = gfDiv(delta, b);
      const shifted = new Array(m).fill(0).concat(B.map((c) => gfMul(c, coef)));
      Lambda = polyAdd(Lambda, shifted);
      m++;
    }
  }
  return polyTrim(Lambda);
}

/** 擦除定位多项式 Λ_e(x) = Π (1 + X_i·x)，X_i = α^{blockLen-1-i} */
export function erasureLocator(blockLen, positions) {
  let L = [1];
  for (const i of positions) {
    const p = blockLen - 1 - i;
    L = polyMul(L, [1, gp(p)]);
  }
  return L;
}

/** Chien 搜索：返回 Λ 在 block 上的根位置（block 下标） */
function chienSearch(Lambda, blockLen) {
  const pos = [];
  for (let i = 0; i < blockLen; i++) {
    const p = blockLen - 1 - i;
    if (polyEval(Lambda, gfInv(gp(p))) === 0) pos.push(i);
  }
  return pos;
}

/**
 * 带擦除的 RS 解码。
 * @param {Uint8Array|number[]} block  完整码字（数据+校验），长度 n
 * @param {number} nsym                校验符号数
 * @param {number[]} erasures          **已知不可信**的码字下标（0 = 最高次）；可空
 * @returns {{ok:boolean, corrected:Uint8Array, errorCount:number, erasureCount:number,
 *            unknownErrors:number, reason?:string}}
 *          失败时 ok=false 且 corrected 为原始码字副本（**不伪装成功**）
 */
export function rsDecodeWithErasures(block, nsym, erasures = []) {
  const n = block.length;
  const fail = (reason) => ({
    ok: false, corrected: Uint8Array.from(block), errorCount: 0,
    erasureCount: erasures.length, unknownErrors: 0, reason,
  });
  if (nsym <= 0 || n !== block.length || n <= nsym) return fail("长度或 nsym 非法");

  // 擦除位置归一：去重、范围检查、按位置排序
  const er = [...new Set(erasures.map(Number))].sort((a, b) => a - b);
  for (const i of er) {
    if (!Number.isInteger(i) || i < 0 || i >= n) return fail("擦除位置越界：" + i);
  }

  const syn = computeSyndromes(block, nsym);
  let clean = true;
  for (let k = 0; k < nsym; k++) if (syn[k] !== 0) { clean = false; break; }
  if (clean) {
    return { ok: true, corrected: Uint8Array.from(block), errorCount: 0,
             erasureCount: er.length, unknownErrors: 0 };
  }

  let Lambda;
  if (er.length) {
    const Leras = erasureLocator(n, er);
    const e = polyDegree(Leras);
    // Forney 校正子 S'(x) = S(x)·Λ_e(x) mod x^{nsym}
    const prod = polyMul(Array.from(syn), Leras);
    const fsyndFull = new Array(nsym).fill(0);
    for (let i = 0; i < Math.min(nsym, prod.length); i++) fsyndFull[i] = prod[i];
    // ⚠ BM 的输入必须**从 x^e 起**取（长度 nsym−e）：前 e 项是擦除因子 Λ_e 引入的
    //  dummy 系数，把它们喂给 BM 会让 Λ 度数虚高（实测 e=6,v=5,nsym=16 时算出 14
    //  而非正确的 11），Chien 根数与次数必然对不上。
    const fsynd = [];
    for (let i = e; i < nsym; i++) fsynd.push(fsyndFull[i]);
    const Lerr = berlekampMassey(fsynd);
    Lambda = polyTrim(polyMul(Lerr, Leras));
  } else {
    Lambda = berlekampMassey(Array.from(syn));
  }

  const deg = polyDegree(Lambda);
  const errPos = chienSearch(Lambda, n);
  // 根数必须与 Λ 次数一致，否则说明超出纠错能力（**必须报失败，不许硬纠**）
  if (errPos.length !== deg) {
    return fail("Chien 根数(" + errPos.length + ") ≠ Λ 次数(" + deg + ")：超出纠错能力");
  }
  // 擦除位置必须全部出现在根里（信息论的必然要求，不一致即失败）
  for (const i of er) {
    if (!errPos.includes(i)) return fail("擦除位置 " + i + " 未被 Λ 覆盖：解不一致");
  }
  // 能力上限复核：e + 2v ≤ nsym
  const v = deg - er.length;
  if (v < 0 || er.length + 2 * v > nsym) {
    return fail("超出能力上限：e=" + er.length + " v=" + v + " nsym=" + nsym);
  }

  const Omega = (() => {
    const prod = polyMul(Array.from(syn), Lambda);
    const o = new Array(nsym).fill(0);
    for (let i = 0; i < Math.min(nsym, prod.length); i++) o[i] = prod[i];
    return o;
  })();
  const Lder = polyDerivative(Lambda);

  const corrected = Uint8Array.from(block);
  for (const i of errPos) {
    const p = n - 1 - i;
    const X = gp(p), Xinv = gfInv(X);
    const den = polyEval(Lder, Xinv);
    if (den === 0) return fail("Λ'(X⁻¹)=0：Forney 退化");
    const e = gfMul(X, gfDiv(polyEval(Omega, Xinv), den));
    corrected[i] ^= e;
  }

  // 后验校验：纠正后校正子必须全零（**不许把"跑完了"当成功**）
  const chk = computeSyndromes(corrected, nsym);
  for (let k = 0; k < nsym; k++) if (chk[k] !== 0) return fail("后验校正子非零：结果不可信");

  return { ok: true, corrected, errorCount: errPos.length, erasureCount: er.length,
           unknownErrors: v, positions: errPos };
}

export const _internal = { gfMul, gfDiv, gfInv, gp, generatorPoly, computeSyndromes, polyDegree };
