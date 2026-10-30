/*
 * bfvToy.js — BFV 同态加密的玩具实现（教学演示，非生产级）。
 *
 * 依据：J. Fan, F. Vercauteren, "Somewhat Practical Fully Homomorphic
 *   Encryption", IACR ePrint 2012/144, §3（密钥生成 / 加密 / 解密 / 同态乘法）。
 *   环：R_q = Z_q[x]/(x^n + 1)，n 取 2 的幂 ⇒ x^n = -1 ⇒ 系数乘法是「负循环卷积」。
 *
 * 本文件做的事（全部按论文公式，未加任何「看起来对」的近似）：
 *   缩放因子  Δ = floor(q / t)
 *   密钥      s, e ← 三元分布 {-1,0,1}；a ← R_q 均匀；b = -(a·s + e) mod q；pk = (b, a)
 *   加密      u, e1, e2 ← 三元；ct = (b·u + e1 + Δ·m , a·u + e2) mod q
 *   解密      v = <ct,(1,s)> = Δ·m + e_total mod q；居中提升后 m = round(t·v/q) mod t
 *   噪声      e_total = v - Δ·m（居中）。解密正确 ⟺ |e_total|∞ < Δ/2 ≈ q/(2t)
 *   加法      分量逐项相加，噪声 ≈ e1 + e2
 *   乘法      张量积 (c0c0', c0c1'+c1c0', c1c1') 后每个系数 round(··t/q)，
 *             把明文缩放从 Δ² 拉回 Δ。**不做重线性化** ⇒ 密文变 3 分量，
 *             噪声 ≈ m1·e2 + m2·e1（量级 t·||e||）——这正是教学上最该看到的一步。
 *
 * 数值上界与理由：q ≤ 2^32、t ≤ 2^16、n ∈ {4,8,16}。系数一律 BigInt：
 *   q² 最大 2^64 已超 Number 的 2^53 精确整数范围，用 Number 会在乘法里静默丢低位
 *   （得到「看起来对」的错结果），所以本文件不做 Number/BigInt 混用。
 *
 * 随机源：统一随机层 randSource.randomBytes（**不直接调 crypto.getRandomValues**）。
 *   给了 seed 就走 custom 档（确定性、可复现，且仍经统一层）；不给就用当前全局档位。
 *   custom 档同一 (长度, seed) 输出恒定，故每次取字节时把序号掺进 seed（"seed#0"、"seed#1"…），
 *   否则私钥 s、噪声 e、随机数 u 会退化成同一组系数。
 *
 * 红线：教学演示，非生产级。参数小到可被穷举/线性代数直接破；无 NTT、无重线性化、
 *   无模切换、无标准序列化——下面的密文 hex 是本文件私有格式，任何主流同态库都读不出来。
 */

import { register } from "./registry.js";
import { randomBytes } from "./randSource.js";

const ALLOWED_N = [4, 8, 16];
const Q_MAX = 1n << 32n; // 密文模数上界
const T_MAX = 1n << 16n; // 明文模数上界

// ============================================================
// 多项式（系数数组，BigInt，模 q；x^n = -1 的负循环卷积）
// ============================================================

function modq(x, q) {
  const r = x % q;
  return r < 0n ? r + q : r;
}

function polyZero(n) {
  return new Array(n).fill(0n);
}

function polyAdd(a, b, q) {
  return a.map((v, i) => modq(v + (b[i] || 0n), q));
}

function polySub(a, b, q) {
  return a.map((v, i) => modq(v - (b[i] || 0n), q));
}

/** 负循环卷积：c_k = Σ_{i+j=k} a_i b_j - Σ_{i+j=k+n} a_i b_j（因 x^n = -1）。 */
function negacyclicMul(a, b, q) {
  const n = a.length;
  if (b.length !== n) throw new Error("负循环卷积要求两个多项式次数相同，收到 " + a.length + " / " + b.length);
  const out = polyZero(n);
  for (let i = 0; i < n; i++) {
    if (a[i] === 0n) continue;
    for (let j = 0; j < n; j++) {
      if (b[j] === 0n) continue;
      const k = i + j;
      if (k < n) out[k] = (out[k] + a[i] * b[j]) % q;
      else out[k - n] = (out[k - n] - a[i] * b[j]) % q; // 越界项取负号
    }
  }
  return out.map((v) => modq(v, q));
}

function polyConst(c, n, q) {
  const p = polyZero(n);
  p[0] = modq(c, q);
  return p;
}

/** 居中代表：把 [0,q) 映射到 (-q/2, q/2]。 */
function centered(x, q) {
  const v = modq(x, q);
  return v * 2n > q ? v - q : v;
}

/** 无穷范数 ||p||∞（居中后取最大绝对值）。 */
function infNorm(p, q) {
  let m = 0n;
  for (const v of p) {
    const c = centered(v, q);
    const a = c < 0n ? -c : c;
    if (a > m) m = a;
  }
  return m;
}

/** 四舍五入的整除（den > 0，num 可负；JS 的 BigInt 除法是向零截断，不能直接用）。 */
function roundDiv(num, den) {
  if (den <= 0n) throw new Error("roundDiv 的分母必须为正，收到 " + den);
  const q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  if (num >= 0n) return r * 2n >= den ? q + 1n : q;
  return -r * 2n >= den ? q - 1n : q;
}

// ============================================================
// 随机流（统一随机层；seed 为空 → 跟随全局档位）
// ============================================================

function makeStream(seedRaw) {
  const seed = seedRaw == null ? "" : String(seedRaw).trim();
  if (seed === "") {
    return { seeded: false, seed: "", next: (k) => randomBytes(k) };
  }
  let ctr = 0;
  return {
    seeded: true,
    seed,
    next: (k) => randomBytes(k, { mode: "custom", seed: seed + "#" + ctr++ }),
  };
}

/** R_q 上的均匀多项式：位宽掩码 + 拒绝采样（避免取模偏置，拒绝次数有硬上限）。 */
function uniformPoly(n, q, stream) {
  const bits = (q - 1n).toString(2).length;
  const bytes = Math.ceil(bits / 8);
  const mask = (1n << BigInt(bits)) - 1n;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let picked = null;
    for (let attempt = 0; attempt < 10000; attempt++) {
      const buf = stream.next(bytes);
      let x = 0n;
      for (const b of buf) x = (x << 8n) | BigInt(b);
      x &= mask;
      if (x < q) { picked = x; break; }
    }
    if (picked === null) {
      throw new Error("R_q 均匀采样连续 10000 次落在拒绝区（q 远小于 2^位宽时才会发生），请检查 q = " + q);
    }
    out[i] = picked;
  }
  return out;
}

/** 三元分布 {-1,0,1}：字节 < 255 时 b%3 等概率取 0/1/2，255 丢弃（256 不是 3 的倍数）。 */
function ternaryPoly(n, stream) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let picked = null;
    for (let attempt = 0; attempt < 10000; attempt++) {
      const b = stream.next(1)[0];
      if (b < 255) { picked = BigInt((b % 3) - 1); break; }
    }
    if (picked === null) throw new Error("三元分布采样连续 10000 次被拒绝，随机源异常");
    out[i] = picked;
  }
  return out;
}

// ============================================================
// BFV 原语
// ============================================================

function keygen(n, q, stream) {
  const s = ternaryPoly(n, stream);
  const e = ternaryPoly(n, stream);
  const a = uniformPoly(n, q, stream);
  // b = -(a·s + e) mod q
  const b = polySub(polyZero(n), polyAdd(negacyclicMul(a, s, q), e, q), q);
  return { s, e, a, b };
}

function encrypt(m, keys, n, q, t, stream) {
  const delta = q / t;
  const u = ternaryPoly(n, stream);
  const e1 = ternaryPoly(n, stream);
  const e2 = ternaryPoly(n, stream);
  const c0 = polyAdd(polyAdd(negacyclicMul(keys.b, u, q), e1, q), polyConst(delta * BigInt(m), n, q), q);
  const c1 = polyAdd(negacyclicMul(keys.a, u, q), e2, q);
  return [c0, c1];
}

/** 密文内积 v = Σ c_i · s^i mod q，再居中。 */
function ctInner(ct, s, q) {
  const n = s.length;
  let acc = ct[0].slice();
  let pow = polyConst(1n, n, q);
  for (let i = 1; i < ct.length; i++) {
    pow = negacyclicMul(pow, s, q);
    const term = negacyclicMul(ct[i], pow, q);
    acc = polyAdd(acc, term, q);
  }
  return acc.map((v) => centered(v, q));
}

/**
 * 解密 + 噪声核算。噪声超预算一律抛错，绝不返回「看起来对」的乱码。
 * @returns {{m:number, noise:bigint, budget:bigint}}
 */
function decrypt(ct, s, n, q, t) {
  const delta = q / t;
  const v = ctInner(ct, s, q);
  const mPoly = v.map((x) => {
    const r = roundDiv(BigInt(t) * x, q) % BigInt(t);
    return (r + BigInt(t)) % BigInt(t);
  });
  // 明文只编码常数项；非常数项非零说明噪声已把系数推出可解码范围。
  // 噪声必须按模 q 的差算：Δ·m 本身可能已越过 q/2（乘法后 m1m2 接近 t 时），
  // 直接做整数差会把「卷绕」误算成巨额噪声，从而误报预算耗尽。
  const m = Number(mPoly[0]);
  let eMax = 0n;
  for (let i = 0; i < n; i++) {
    const expect = i === 0 ? delta * BigInt(m) : 0n;
    const e = centered(v[i] - expect, q);
    const a = e < 0n ? -e : e;
    if (a > eMax) eMax = a;
  }
  const budget = delta / 2n;
  if (eMax * 2n >= delta) {
    throw new Error(
      "解密失败：噪声预算耗尽（||e||∞ = " + eMax + " ≥ Δ/2 = " + budget +
      "，Δ = floor(q/t) = " + delta + "）。本实现不返回乱码结果——请减小 t、增大 q 或减少乘法次数"
    );
  }
  return { m, noise: eMax, budget };
}

function ctAdd(a, b, q) {
  const len = Math.max(a.length, b.length);
  const out = [];
  for (let i = 0; i < len; i++) {
    out.push(polyAdd(a[i] || polyZero(a[0].length), b[i] || polyZero(a[0].length), q));
  }
  return out;
}

/** 整数上的负循环卷积：系数不取模 q，用于同态乘法（见 ctMul 的注释）。 */
function negacyclicMulExact(a, b) {
  const n = a.length;
  const out = polyZero(n);
  for (let i = 0; i < n; i++) {
    if (a[i] === 0n) continue;
    for (let j = 0; j < n; j++) {
      if (b[j] === 0n) continue;
      const k = i + j;
      if (k < n) out[k] += a[i] * b[j];
      else out[k - n] -= a[i] * b[j];
    }
  }
  return out;
}

/** 张量积 + t/q 缩放（无重线性化）。
 *
 * 关键细节（踩过坑）：张量积的系数必须**先不取模 q**，保持整数，缩放到 t/q 之后再取模。
 * 若先取模再缩放，明文项 Δ²·m1m2（量级 (q/t)²·m²，远大于 q）已被 q 卷绕，
 * 缩放后只剩噪声——实测该写法解密恒为 0（m=5、42、200 全错）。
 * 先整数后缩放时，两个因子各自的 j·q 卷绕量在缩放后变成 j·t·Δ·m ≡ 0 (mod q)，
 * 只剩 j·t·e 这一项加进噪声（量级 t·n·||e||），这是本实现与教科书「在 R_q 内缩放」
 * 写法唯一的差别，也是下面噪声账本里乘法噪声偏大的原因。
 */
function ctMul(a, b, q, t) {
  const n = a[0].length;
  const A = a.map((p) => p.map((v) => centered(v, q)));
  const B = b.map((p) => p.map((v) => centered(v, q)));
  const len = A.length + B.length - 1;
  const out = [];
  for (let k = 0; k < len; k++) {
    let acc = polyZero(n);
    for (let i = 0; i < A.length; i++) {
      const j = k - i;
      if (j < 0 || j >= B.length) continue;
      const term = negacyclicMulExact(A[i], B[j]);
      for (let c = 0; c < n; c++) acc[c] += term[c];
    }
    out.push(acc.map((v) => modq(roundDiv(v * BigInt(t), q), q)));
  }
  return out;
}

// ============================================================
// 密文序列化（私有格式：分量用 ";" 分隔，每个系数定宽 hex）
// ============================================================

function ctWidth(q) {
  return (q - 1n).toString(16).length;
}

function encodeCt(ct, q) {
  const w = ctWidth(q);
  return ct.map((poly) => poly.map((v) => modq(v, q).toString(16).padStart(w, "0")).join("")).join(";");
}

function decodeCt(raw, n, q, label) {
  const w = ctWidth(q);
  const s = String(raw == null ? "" : raw).trim();
  if (s === "") throw new Error(label + " 为空：该操作需要提供密文 hex（先用 op=encrypt 生成）");
  const parts = s.split(";");
  return parts.map((part, idx) => {
    const hex = part.trim();
    const need = n * w;
    if (hex.length === 0) throw new Error(label + " 的第 " + idx + " 个分量为空（分量之间用单个 \";\" 分隔）");
    if (!/^[0-9a-fA-F]+$/.test(hex)) throw new Error(label + " 的第 " + idx + " 个分量含非 hex 字符");
    if (hex.length !== need) {
      throw new Error(
        label + " 的第 " + idx + " 个分量长度 " + hex.length + " ≠ n×width = " + n + "×" + w + " = " + need +
        "（请确认 n / q 与生成密文时一致）"
      );
    }
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const v = BigInt("0x" + hex.slice(i * w, (i + 1) * w));
      if (v >= q) throw new Error(label + " 第 " + idx + " 分量第 " + i + " 个系数 " + v + " ≥ q = " + q);
      out[i] = v;
    }
    return out;
  });
}

// ============================================================
// 参数校验
// ============================================================

function readParams(p) {
  const src = p || {};
  const nRaw = src.n == null || String(src.n).trim() === "" ? 8 : Number(src.n);
  if (!Number.isInteger(nRaw) || ALLOWED_N.indexOf(nRaw) < 0) {
    throw new Error("多项式次数 n 只接受 4 / 8 / 16（2 的幂，保证 x^n+1 不可约），收到 " + src.n);
  }
  const n = nRaw;

  const qNum = Number(src.q);
  if (!Number.isInteger(qNum) || qNum < 2) throw new Error("密文模数 q 必须是 ≥ 2 的整数，收到 " + src.q);
  const q = BigInt(qNum);
  if (q > Q_MAX) throw new Error("密文模数 q 上限 2^32 = 4294967296（系数乘积会到 q²，本实现用 BigInt 但仍限制规模），收到 " + q);

  const tNum = Number(src.t);
  if (!Number.isInteger(tNum) || tNum < 2) throw new Error("明文模数 t 必须是 ≥ 2 的整数，收到 " + src.t);
  const t = BigInt(tNum);
  if (t > T_MAX) throw new Error("明文模数 t 上限 2^16 = 65536，收到 " + t);
  if (q <= t) throw new Error("必须 q > t（否则 Δ = floor(q/t) = 0，密文里放不下明文），收到 q = " + q + " / t = " + t);

  const mNum = src.m == null || String(src.m).trim() === "" ? 0 : Number(src.m);
  if (!Number.isInteger(mNum)) throw new Error("明文 m 必须是整数，收到 " + src.m);
  if (mNum < 0 || BigInt(mNum) >= t) throw new Error("明文 m 必须落在 [0, t) = [0, " + t + ")，收到 " + mNum);

  return { n, q, t, m: mNum };
}

// ============================================================
// 主流程（导出供验收脚本取结构化数据；op.run 只返回 text）
// ============================================================

export function bfvRun(p) {
  const src = p || {};
  const opRaw = src.op == null || String(src.op).trim() === "" ? "demo" : String(src.op).trim();
  const OPS = ["demo", "encrypt", "decrypt", "add", "mul"];
  if (OPS.indexOf(opRaw) < 0) throw new Error("op 只接受 " + OPS.join(" / ") + "，收到 " + opRaw);
  const op = opRaw;

  const { n, q, t, m } = readParams(src);
  const delta = q / t;
  const budget = delta / 2n;
  const stream = makeStream(src.seed);

  if (!stream.seeded && op !== "encrypt" && op !== "demo") {
    throw new Error(
      "op=" + op + " 需要 seed：本玩具把私钥 s 由 seed 重建（教学实现不单独保存私钥），" +
      "无 seed 时无法解密或核算噪声。请填 seed 或改用 op=encrypt"
    );
  }

  const keys = keygen(n, q, stream);
  const L = [];
  const data = { op, n, q: q.toString(), t: t.toString(), delta: delta.toString(), m, steps: [] };
  // data 里带完整私钥，只为验收脚本能用另一套实现独立重算；输出文本不打印完整私钥。
  data.secret = keys.s.map(String);

  L.push("=== BFV 玩具同态加密（教学演示，非生产级）===");
  L.push("环 R_q = Z_q[x]/(x^" + n + "+1)（负循环卷积，x^n = -1）；q = " + q + "；t = " + t + "；Δ = floor(q/t) = " + delta);
  L.push("噪声预算 Δ/2 = " + budget + "（≈ q/(2t) = " + (Number(q) / (2 * Number(t))).toFixed(2) + "）");
  L.push("随机源：" + (stream.seeded
    ? "统一随机层 custom 档，seed = \"" + stream.seed + "\"（同 seed 完全复现）"
    : "统一随机层当前档位（未给 seed，本次不可复现）"));
  L.push("私钥 s（三元）前 8 项 = [" + keys.s.slice(0, 8).map(String).join(", ") + "]" +
    (n > 8 ? " …（共 " + n + " 项）" : ""));
  L.push("");

  if (op === "encrypt") {
    const ct = encrypt(m, keys, n, q, t, stream);
    const dec = decrypt(ct, keys.s, n, q, t);
    const hex = encodeCt(ct, q);
    data.ciphertext = hex;
    data.plaintext = dec.m;
    data.noise = dec.noise.toString();
    L.push("[加密] 明文 m = " + m + "（编码为常数多项式 [m, 0, …, 0]）");
    L.push("密文分量数 = 2（c0, c1），每个系数 " + ctWidth(q) + " 个 hex 位，总长 " + hex.length);
    L.push("ct = " + hex);
    L.push("自检解密 = " + dec.m + "，噪声 ||e||∞ = " + dec.noise + "，预算占用 " +
      (Number(dec.noise) / Number(budget) * 100).toFixed(4) + "%");
    L.push("");
    L.push("说明：教学演示，非生产级——密文是本文件私有 hex 格式，不是标准 BFV 序列化；");
    L.push("      该参数规模（n ≤ 16、q ≤ 2^32）可被格基约化直接攻破，不能用于任何真实数据。");
    return { text: L.join("\n"), data };
  }

  if (op === "decrypt") {
    const ct = decodeCt(src.ctA, n, q, "ctA");
    const dec = decrypt(ct, keys.s, n, q, t);
    data.plaintext = dec.m;
    data.noise = dec.noise.toString();
    L.push("[解密] 密文分量数 = " + ct.length);
    L.push("明文 m = " + dec.m);
    L.push("噪声 ||e||∞ = " + dec.noise + "，预算 Δ/2 = " + budget + "，占用 " +
      (Number(dec.noise) / Number(budget) * 100).toFixed(4) + "%");
    L.push("说明：噪声超预算时本 op 直接抛错，不返回乱码。");
    return { text: L.join("\n"), data };
  }

  if (op === "add" || op === "mul") {
    const A = decodeCt(src.ctA, n, q, "ctA");
    const B = decodeCt(src.ctB, n, q, "ctB");
    const dA = decrypt(A, keys.s, n, q, t);
    const dB = decrypt(B, keys.s, n, q, t);
    const ct = op === "add" ? ctAdd(A, B, q) : ctMul(A, B, q, t);
    const hex = encodeCt(ct, q);
    const expect = op === "add"
      ? (dA.m + dB.m) % Number(t)
      : Number((BigInt(dA.m) * BigInt(dB.m)) % t);
    const dec = decrypt(ct, keys.s, n, q, t);
    data.ciphertext = hex;
    data.plaintextA = dA.m;
    data.plaintextB = dB.m;
    data.expected = expect;
    data.plaintext = dec.m;
    data.noise = dec.noise.toString();
    L.push("[" + (op === "add" ? "同态加法" : "同态乘法") + "] 密文 A 解密 = " + dA.m + "，密文 B 解密 = " + dB.m);
    if (op === "mul") {
      L.push("乘法：张量积 2×2 → 3 分量，每个系数乘 t/q 取整（未做重线性化，密文分量数从 2 变 3）");
    } else {
      L.push("加法：分量逐项相加（噪声线性增长，不放大）");
    }
    L.push("结果密文分量数 = " + ct.length + "，hex 长度 = " + hex.length);
    L.push("ct = " + hex);
    L.push("结果解密 = " + dec.m + "，期望 (" + dA.m + (op === "add" ? " + " : " × ") + dB.m + ") mod t = " + expect +
      (dec.m === expect ? " ✓" : " ✗ 不一致"));
    L.push("噪声 ||e||∞ = " + dec.noise + "，预算 Δ/2 = " + budget + "，占用 " +
      (Number(dec.noise) / Number(budget) * 100).toFixed(4) + "%");
    if (dec.m !== expect) {
      throw new Error("同态运算结果与明文运算不一致（解密得 " + dec.m + "，期望 " + expect + "）：噪声未超预算却算错，属实现缺陷");
    }
    L.push("说明：教学演示，非生产级；乘法噪声量级 ≈ t·||e||，真实 BFV 靠重线性化 + 模切换把它压回去。");
    return { text: L.join("\n"), data };
  }

  // ---- demo：全流程 ----
  const ct = encrypt(m, keys, n, q, t, stream);
  const dec = decrypt(ct, keys.s, n, q, t);
  data.ciphertext = encodeCt(ct, q);
  data.steps.push({ step: "encrypt", plaintext: dec.m, noise: dec.noise.toString() });

  L.push("[1] 加密：m = " + m + " → 2 分量密文（每个系数 " + ctWidth(q) + " hex 位，总长 " + data.ciphertext.length + "）");
  L.push("    ct = " + data.ciphertext);
  L.push("    解密 = " + dec.m + "（噪声 ||e||∞ = " + dec.noise + "，预算占用 " +
    (Number(dec.noise) / Number(budget) * 100).toFixed(4) + "%）" + (dec.m === m ? " ✓" : " ✗"));
  L.push("");

  const ct2 = ctAdd(ct, ct, q);
  const dec2 = decrypt(ct2, keys.s, n, q, t);
  const exp2 = (2 * m) % Number(t);
  data.steps.push({ step: "add", plaintext: dec2.m, noise: dec2.noise.toString() });
  L.push("[2] 同态加法 ct + ct：解密 = " + dec2.m + "，期望 2m mod t = " + exp2 + (dec2.m === exp2 ? " ✓" : " ✗"));
  L.push("    噪声 ||e||∞ = " + dec2.noise + "（预算占用 " + (Number(dec2.noise) / Number(budget) * 100).toFixed(4) + "%）");
  L.push("");

  let mulOk = true;
  let mulNote = "";
  let dec3 = null;
  try {
    const ct3 = ctMul(ct, ct, q, t);
    dec3 = decrypt(ct3, keys.s, n, q, t);
    const exp3 = Number((BigInt(m) * BigInt(m)) % t);
    data.steps.push({ step: "mul", plaintext: dec3.m, noise: dec3.noise.toString() });
    mulNote = "解密 = " + dec3.m + "，期望 m² mod t = " + exp3 + (dec3.m === exp3 ? " ✓" : " ✗") +
      "；噪声 ||e||∞ = " + dec3.noise + "（预算占用 " + (Number(dec3.noise) / Number(budget) * 100).toFixed(4) + "%）";
    if (dec3.m !== exp3) mulOk = false;
  } catch (e) {
    mulOk = false;
    mulNote = "显式失败（不返回乱码）：" + (e && e.message ? e.message : String(e));
    data.steps.push({ step: "mul", error: mulNote });
  }
  L.push("[3] 同态乘法 ct × ct（张量积 + t/q 缩放，未重线性化 → 3 分量）：" + (mulOk ? "" : "✗ "));
  L.push("    " + mulNote);
  L.push("");

  const noise0 = dec.noise;
  const noise2 = dec2.noise;
  L.push("── 噪声轨迹 ──");
  L.push("加密 ||e||∞ = " + noise0 + " → 加法 " + noise2 + "（≈ 2 倍，线性增长）" +
    (dec3 ? " → 乘法 " + dec3.noise + "（≈ t 倍量级，乘法放大）" : " → 乘法 超预算"));
  L.push("");
  L.push("结论：教学演示，非生产级。这里没有重线性化（密文会从 2 分量涨到 3 分量）、");
  L.push("      没有模切换（噪声只会涨不会降），参数小到可被格基约化直接破译——");
  L.push("      它演示的是 BFV 的代数骨架与噪声账本，不是可用的 FHE 库。");
  return { text: L.join("\n"), data };
}

register({
  id: "bfvToy",
  cat: "block",
  name: "BFV 玩具同态加密（教学）",
  desc: "BFV 同态加密教学实现（Fan-Vercauteren, ePrint 2012/144）：R_q = Z_q[x]/(x^n+1) 负循环卷积 + 三元私钥 + Δ=floor(q/t) 缩放，支持加密/解密/同态加法/同态乘法（乘法不做重线性化，密文涨到 3 分量）。每次运算打印噪声 ||e||∞ 与预算 Δ/2=q/(2t) 占用，噪声耗尽显式报错、绝不返回乱码。教学演示，非生产级：n≤16、q≤2^32、t≤2^16，无 NTT/重线性化/模切换，该规模可被直接攻破",
  params: [
    { key: "op", label: "操作", type: "select", default: "demo", options: [
      { value: "demo", label: "demo 全流程（加密→加法→乘法）" },
      { value: "encrypt", label: "encrypt 加密" },
      { value: "decrypt", label: "decrypt 解密" },
      { value: "add", label: "add 同态加法" },
      { value: "mul", label: "mul 同态乘法" },
    ] },
    { key: "n", label: "多项式次数 n（4 / 8 / 16）", type: "number", default: 8 },
    { key: "q", label: "密文模数 q（≤ 2^32）", type: "number", default: 4294967291 },
    { key: "t", label: "明文模数 t（≤ 2^16）", type: "number", default: 256 },
    { key: "m", label: "明文整数 m（0 ≤ m < t）", type: "number", default: 42 },
    { key: "ctA", label: "密文 A（hex，decrypt/add/mul 用）", type: "text", default: "", placeholder: "分量之间用 ; 分隔" },
    { key: "ctB", label: "密文 B（hex，add/mul 用）", type: "text", default: "", placeholder: "分量之间用 ; 分隔" },
    { key: "seed", label: "随机种子（decrypt/add/mul 必填）", type: "text", default: "bfv-toy", placeholder: "同 seed 完全复现；留空则用当前随机档位" },
  ],
  run: (_text, p) => bfvRun(p).text,
});

export { negacyclicMul, roundDiv, ctMul, ctAdd, encodeCt, decodeCt, keygen, encrypt, decrypt };
