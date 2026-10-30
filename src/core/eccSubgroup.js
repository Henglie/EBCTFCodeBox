/*
 * eccSubgroup.js — ECDH 点校验缺失攻击演示：小子群（X25519）与无效曲线（Weierstrass）。
 *
 * 文献/规范依据（照标准与原文实现，不编造）：
 * - X25519 小子群：RFC 7748 §5（clamping：低 3 位清零 ⇒ 标量恒为余因子 8 的倍数）与
 *   §6.8.1（共享密钥全零检查）。低阶点常数取自公开文献口径（SageMath
 *   E.division_polynomial(8).roots，crypto.stackexchange.com/questions/82078、
 *   eprint 2019/526，采集日期 2026-10-25），但**不信任任何转抄值**：每个候选 u 都经
 *   运行时倍点链定阶（2P/4P 落点链式核验）+ 二次特征判边（曲线/扭曲），不通过的
 *   候选自动淘汰——常数表错误会在运行期显式暴露而非静默出错。
 *   x-only 泄露量的数学事实（演示如实反映）：阶 4 点 P 的 2P=(0,0) 与 4P=∞ 在 x-only
 *   下同输出 0、1P/3P 同 u，故单点只给 d mod 2；阶 8 点给 3 类输出（u(Q)/u(2Q)/0），
 *   恰好恢复 d mod 4。未 clamp 的裸实现泄露 d mod 4（2 bit）；clamping 后全零。
 * - 无效曲线攻击（Biehl et al. 2000）：Weierstrass 点加/倍点公式只依赖 a 不依赖 b——
 *   不校验点在曲线上的受害者在 y²=x³+ax+b′（b′≠b）上做标量乘；攻击者选光滑阶无效
 *   曲线，用其小阶点查询预言机得 d mod ℓ，CRT 合成私钥。玩具曲线（p=1000003）全流程
 *   演示；真实曲线群阶 ~256bit 分解超出演示范围，如实标注。
 *
 * 红线：独立攻击 op（模拟预言机本地闭环）；全确定性（不消耗随机源，randOps 无需登记）；
 * 纯 BigInt，零 UI/外发；不碰既有 ECC 文件。
 */

import { register } from "./registry.js";
import { hexToBytes } from "./x25519.js";

const P25519 = (1n << 255n) - 19n;
const A25519 = 486662n;

function mod(a, p) { const r = a % p; return r < 0n ? r + p : r; }
function powMod(b, e, p) { let r = 1n; b = mod(b, p); while (e > 0n) { if (e & 1n) r = (r * b) % p; e >>= 1n; b = (b * b) % p; } return r; }
function invMod(a, p) { return powMod(a, p - 2n, p); }

// ============================================================
// X25519：x-only Montgomery 梯（原始标量，可选 clamp）
// ============================================================

function montDoubleU(u) {
  if (u === 0n) return 0n; // ∞ 约定
  const num = mod((u * u - 1n) * (u * u - 1n), P25519);
  const den = mod(4n * mod(u * u * u + A25519 * u * u + u, P25519), P25519);
  if (den === 0n) return 0n;
  return mod(num * invMod(den, P25519), P25519);
}

/** 原始标量乘（不 clamp；MSB-first 梯子，标量不做 mod p——标量不是域元素） */
function ladderRaw(k, u) {
  let x1 = mod(u, P25519), x2 = 1n, z2 = 0n, x3 = mod(u, P25519), z3 = 1n, swap = 0n;
  const kk = BigInt(k); // 标量原样使用（可为任意 ≤255bit 整数）
  for (let t = 254; t >= 0; t--) {
    const kt = (kk >> BigInt(t)) & 1n;
    swap ^= kt;
    if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
    swap = kt;
    const A = mod(x2 + z2, P25519), AA = mod(A * A, P25519);
    const B = mod(x2 - z2, P25519), BB = mod(B * B, P25519);
    const E = mod(AA - BB, P25519);
    const C = mod(x3 + z3, P25519), D = mod(x3 - z3, P25519);
    const DA = mod(D * A, P25519), CB = mod(C * B, P25519);
    x3 = mod((DA + CB) * (DA + CB), P25519);
    z3 = mod(x1 * mod((DA - CB) * (DA - CB), P25519), P25519);
    x2 = mod(AA * BB, P25519);
    z2 = mod(E * mod(AA + mod(121665n * E, P25519), P25519), P25519);
  }
  if (swap) { [x2, x3] = [x3, x2]; [z2, z3] = [z3, z2]; }
  if (z2 === 0n) return 0n;
  return mod(x2 * invMod(z2, P25519), P25519);
}

function clamp25519(bytes) {
  const b = bytes.slice(0, 32);
  b[0] &= 248; b[31] &= 127; b[31] |= 64;
  return b;
}
function leToBig(bytes) { let x = 0n; for (let i = 0; i < bytes.length; i++) x |= BigInt(bytes[i]) << (8n * BigInt(i)); return x; }

/**
 * 低阶点候选池（曲线 ∪ 扭曲；来源见文件头）。转抄值一律不信任：进入
 * `classifyLowOrder` 运行时定阶 + 判边，不通过者淘汰。池里故意混入
 * 多个转抄口径的变体值，让运行时验证裁决谁真谁假。
 */
const LOW_ORDER_CANDIDATES = [
  0n, // (0,0)：曲线与扭曲共用的 2 挠
  1n, // 曲线阶 4（2·(1,y)=(0,0)）
  325606250916557431795983626356110631294008115727848805560023387167927233504n, // 转抄候选 A
  325606250916557431795983625354325233311460858698981768708288852584876220095n, // 转抄候选 B（与 A 冲突，二选一）
  39382357235489614581723060781553021112529911719440698176882885853963445705823n, // 阶 8 候选 A
  888381913156303494145612916493556322884477154276496061245976289735827756961n, // 阶 8 候选 B
  2n, // 转抄"扭曲"候选（运行时裁决）
  1929868153955269923726183083478131797554499744417342768947594579171851516357n, // 转抄"扭曲"候选
  4759223461012615006903543847321907755252488428637127300008264738517136551537n, // 转抄"扭曲"候选
  46827403850823179245072216630277197565144205554125654976674165829533817101731n, // 转抄"扭曲"候选
  57896044618658097711785492504343953926634992332820282019728792003956564819948n, // 扭曲阶 4（p-29）
];

/**
 * 链式定阶（前提：F_p 内 2 挠点唯一且 u=0——由曲线判别式非二次剩余保证，运行时核验）：
 * u=0 → 阶 2（(0,0) 本身）；u≠0 且 2P 落 (0,0) → 阶 4；4P 落 (0,0) → 阶 8。
 * 注意 montDoubleU 的 0 输出混叠 ∞ 与 (0,0)：u≠0 的点不可能是阶 2（阶 2 ⟺ y=0 ⟺ u=0），
 * 故 2P 输出 0 只能是 (0,0)，无歧义。
 */
function lowOrderOf(u) {
  if (u === 0n) return 2;
  const v2 = montDoubleU(u);
  if (v2 === 0n) return 4;
  const v4 = montDoubleU(v2);
  if (v4 === 0n) return 8;
  return 0;
}

/** 边判定：u 在主曲线上 ⟺ u³+Au²+u 为二次剩余（或 0） */
function sideOf(u) {
  const rhs = mod(u * u * u + A25519 * u * u + u, P25519);
  if (rhs === 0n) return "曲线";
  return powMod(rhs, (P25519 - 1n) / 2n, P25519) === 1n ? "曲线" : "扭曲";
}

// CRT（模数两两互素；无效曲线档按素数阶小点构造保证）
function crt(residues) {
  let R = 0n, M = 1n;
  for (const { r, m } of residues) {
    const g = extGcd(M, m);
    const lcm = M / g.g * m;
    const t = mod((r - R) / g.g * g.x, m / g.g);
    R = mod(R + M * t, lcm);
    M = lcm;
  }
  return { r: ((R % M) + M) % M, m: M };
}
function extGcd(a, b) {
  let [oldR, r] = [a, b], [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return { g: oldR, x: oldS };
}

// ============================================================
// Weierstrass 玩具曲线（无效曲线攻击档）
// ============================================================

const WP = 1000003n;
const WA = 2n;
const WB = 2n;

function wsAdd(P1, P2, p) {
  if (!P1) return P2;
  if (!P2) return P1;
  const [x1, y1] = P1, [x2, y2] = P2;
  if (x1 === x2 && mod(y1 + y2, p) === 0n) return null;
  let lam;
  if (x1 === x2 && mod(y1 - y2, p) === 0n) {
    if (y1 === 0n) return null;
    lam = mod((3n * x1 * x1 + WA) * invMod(2n * y1, p), p);
  } else {
    lam = mod((y2 - y1) * invMod(mod(x2 - x1, p), p), p);
  }
  const x3 = mod(lam * lam - x1 - x2, p);
  return [x3, mod(lam * (x1 - x3) - y1, p)];
}
function wsMul(k, P, p) {
  let R = null, Q = P, e = mod(k, p);
  while (e > 0n) { if (e & 1n) R = wsAdd(R, Q, p); Q = wsAdd(Q, Q, p); e >>= 1n; }
  return R;
}
function ptEq(A, B) {
  if (A === null || B === null) return A === B;
  return A[0] === B[0] && A[1] === B[1];
}
function isqrt(n) { if (n < 2n) return n; let x = n, y = (x + 1n) / 2n; while (y < x) { x = y; y = (x + n / x) / 2n; } return x; }
function sqrtModW(v, p) {
  if (v === 0n) return 0n;
  if (powMod(v, (p - 1n) / 2n, p) !== 1n) return null;
  const r = powMod(v, (p + 1n) / 4n, p); // p ≡ 3 (mod 4)
  return mod(r * r, p) === mod(v, p) ? r : null;
}
function wsOrder(p, a, b) {
  let G = null;
  for (let x = 2n; x < 200n && !G; x++) {
    const yy = mod(BigInt(x) ** 3n + a * BigInt(x) + b, p);
    const y = sqrtModW(yy, p);
    if (y !== null) G = [BigInt(x), y];
  }
  if (!G) return null;
  const lo = p + 1n - 2n * isqrt(p) - 4n, hi = p + 1n + 2n * isqrt(p) + 4n;
  const m = isqrt(hi - lo + 1n) + 1n;
  const baby = new Map();
  let T = null;
  for (let j = 0n; j < m; j++) { baby.set(T ? `${T[0]},${T[1]}` : "inf", j); T = wsAdd(T, G, p); }
  const mG = wsMul(m, G, p);
  let acc = wsMul(lo, G, p);
  for (let i = 0n; i * m <= hi - lo + m + 2n; i++) {
    const key = acc ? `${acc[0]},${acc[1]}` : "inf";
    if (baby.has(key)) {
      const N = lo + i * m - baby.get(key);
      if (N >= lo && N <= hi && wsMul(N, G, p) === null) return { N, G };
    }
    acc = wsAdd(acc, mG, p);
  }
  return null;
}
function factorSmall(n, maxPrime) {
  const f = [];
  for (let d = 2n; d <= maxPrime && d * d <= n; d++) {
    while (n % d === 0n) { f.push(d); n /= d; }
  }
  return f;
}

// ============================================================
// op 注册
// ============================================================

// 首字节 0xa3 ⇒ d mod 4 = 3（奇）：查询输出非零，与「坏梯子恒返 0」可区分
const DEF_D = "a3b1c2d3e4f5061728394a5b6c7d8e9f00112233445566778899aabbccddeeff";

register({
  id: "eccSubgroupAttack",
  cat: "crack",
  family: "eccSubgroup",
  familyLabel: "forbidden",
  name: "ECDH 小子群/无效曲线攻击",
  desc: "ECDH 点校验缺失攻击演示（RFC 7748 §6.8.1 + Biehl 2000 无效曲线）：①X25519 小子群（真参数）——低阶点候选经运行时倍点链定阶+二次特征判边（不信任转抄常数），x-only 泄露上限如实演示：阶 8 点恢复 d mod 4（2 bit）、其余低阶点交叉印证，clamping 后全零共享密钥即防御；②无效曲线（玩具曲线 p=1000003 全流程）——光滑阶无效曲线确定性搜索、小阶点预言机查询、CRT 合成私钥。模拟预言机本地闭环，教学演示非远程攻击工具，全确定性零随机",
  params: [
    {
      key: "mode", label: "攻击档", type: "select", default: "x25519",
      options: [
        { value: "x25519", label: "X25519 小子群（真参数）" },
        { value: "invalidCurve", label: "无效曲线（玩具曲线全流程）" },
      ],
    },
    { key: "priv", label: "受害者私钥（X25519: 32B hex；玩具曲线: 十进制整数；可空=内置固定示例）", type: "text", default: "", placeholder: "" },
  ],
  run: (_text, p) => {
    const mode = String((p && p.mode) || "x25519");
    const lines = [];

    if (mode === "x25519") {
      const privHex = String((p && p.priv) || "").trim() || DEF_D;
      const privBytes = hexToBytes(privHex);
      if (privBytes.length !== 32) throw new Error(`X25519 私钥须为 32 字节（64 hex），当前 ${privBytes.length}`);
      const dRaw = leToBig(privBytes) & ((1n << 255n) - 1n); // 取 255bit（RFC 域）
      const dClamped = leToBig(clamp25519(privBytes));

      // 运行时定阶 + 判边（转抄常数不通过即淘汰）
      const pts = [];
      for (const u of LOW_ORDER_CANDIDATES) {
        const o = lowOrderOf(u);
        if (o === 0) continue;
        pts.push({ u, o, side: sideOf(u) });
      }
      // 前提自检：2 挠唯一（判别式 Δ=A²−4 非二次剩余 ⟺ x²+Ax+1 无根）
      const disc = mod(A25519 * A25519 - 4n, P25519);
      if (powMod(disc, (P25519 - 1n) / 2n, P25519) === 1n) throw new Error("2 挠唯一性前提不成立（实现错误）");
      const have8 = pts.some((x) => x.o === 8 && x.side === "曲线");
      if (!have8 || pts.length < 3) throw new Error("低阶点候选链验证后不足（转抄常数全不可信？）——内部错误");

      lines.push("=== X25519 小子群攻击（RFC 7748 §6.8.1）===",
        `低阶点（候选池运行时定阶+判边， ${LOW_ORDER_CANDIDATES.length} 选 ${pts.length}，淘汰 ${LOW_ORDER_CANDIDATES.length - pts.length} 个不可信转抄值）：`,
        ...pts.map((pt) => `  阶 ${pt.o}（${pt.side}）：u = ${pt.u === 0n ? "0（(0,0)，查询无信息）" : pt.u.toString()}`),
        "");

      // 约束收集：x-only 下每个查询点给「d mod o ∈ 某剩余类集合 S」
      // 阶 2 点 u=0：梯子恒输出 0（∞ 约定），跳过
      const cands = new Set([0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n]); // d mod 8 候选集
      for (const pt of pts) {
        if (pt.u === 0n) continue;
        const shared = ladderRaw(dRaw, pt.u);
        const S = [];
        for (let j = 0n; j < BigInt(pt.o); j++) {
          if (ladderRaw(j, pt.u) === shared) S.push(j);
        }
        if (!S.length) throw new Error("查询点分类失败（内部错误）");
        const lifted = new Set();
        for (let r = 0n; r < 8n; r++) if (S.some((j) => r % BigInt(pt.o) === j)) lifted.add(r);
        for (const r of [...cands]) if (!lifted.has(r)) cands.delete(r);
        lines.push(`预言机查询：d·(阶 ${pt.o} ${pt.side}点 u=${shortU(pt.u)}) = ${shared === 0n ? "0" : shared.toString(16).slice(0, 16) + "…"} ⇒ d mod ${pt.o} ∈ {${S.join(",")}}（剩余候选 ${lifted.size}/8）`);
      }
      if (cands.size === 8) throw new Error("未收集到任何小子群约束（内部错误）");
      const leakedBits = Math.log2(8 / cands.size);
      const uniq = [...cands].sort((a, b) => (a < b ? -1 : 1));
      let verdict;
      if (uniq.length === 2 && uniq[1] - uniq[0] === 4n) {
        verdict = `合成约束：d mod 4 = ${uniq[0] % 4n}（阶 8 点的类划分恰定 d mod 4；x-only 抹去 ±y，这是单点查询泄露上限）`;
      } else if (uniq.length === 4) {
        verdict = `合成约束：d mod 8 ∈ {${uniq.join(",")}}，即 d ≡ ±${uniq[0]} (mod 8)（x-only 抹去 ±y：奇数标量只能定到 ±r，无法写成 d mod k，如实呈现）`;
      } else {
        verdict = `合成约束：d mod 8 ∈ {${uniq.join(",")}}`;
      }
      lines.push("",
        `mod 8 候选取值：{${uniq.join(",")}}（剩余 ${cands.size}/8，泄露 ${leakedBits.toFixed(2)} bit）`,
        verdict,
        `真值校验：d mod 8 = ${dRaw % 8n} ∈ 候选集 ⇒ ${cands.has(dRaw % 8n) ? "✓ 一致（小子群泄露实证）" : "✗ 不一致（实现错误）"}`,
        "");

      const clampedZeros = pts.every((pt) => ladderRaw(dClamped, pt.u) === 0n);
      lines.push("防御对照（RFC 口径 clamping）：",
        `clamp 后标量恒为 8 的倍数 ⇒ d·(低阶点) 恒为 ∞ ⇒ 共享密钥恒为全零：${clampedZeros ? "✓ 实测全部全零（无泄露）" : "✗ 异常"}`,
        "工程防御 = ①clamping（RFC 7748 §5 内建）+ ②共享密钥全零检查（§6.8.1，检测到必须中止）。",
        "对照结论：未 clamp 的裸实现泄露余因子信息（至多 2 bit：偶标量定 d mod 4，奇标量定 d ≡ ±1/±3 (mod 8)）；标准 X25519 设计已封死该泄露。",
      );
      return { text: lines.join("\n") };
    }

    // —— 无效曲线档（玩具曲线全流程）——
    const privStr = String((p && p.priv) || "").trim() || "123456";
    if (!/^\d+$/.test(privStr)) throw new Error("玩具曲线私钥须为十进制整数（< p=1000003）");
    const d = BigInt(privStr) % WP;
    if (d === 0n) throw new Error("私钥为 0（无意义）");
    if ((4n * WA ** 3n + 27n * WB * WB) % WP === 0n) throw new Error("受害者曲线奇异（内部错误）");

    lines.push("=== 无效曲线攻击（Biehl et al. 2000，玩具曲线全流程）===",
      `受害者曲线 E: y² = x³ + ${WA}x + ${WB} (mod ${WP})，私钥 d = ${d}（模拟 ECDH 预言机，不做点校验——被攻击的缺陷实现）`,
      "",
      "攻击者搜索同 a 不同 b 的光滑阶无效曲线（确定性枚举 b′=1,2,…）：");

    const residues = [];
    const usedPrimes = new Set();
    let searched = 0;
    const MAXB = 3000;
    const seenOrders = new Set();
    for (let B = 1n; B <= BigInt(MAXB); B++) {
      const prod = residues.reduce((a, r) => a * r.m, 1n);
      if (prod >= WP) break; // 覆盖已足够
      if ((4n * WA ** 3n + 27n * B * B) % WP === 0n) continue;
      const ord = wsOrder(WP, WA, B);
      if (!ord) continue;
      searched++;
      const key = ord.N.toString();
      if (seenOrders.has(key)) continue;
      seenOrders.add(key);
      const factors = factorSmall(ord.N, 997n);
      for (const ls of [...new Set(factors.map(String))]) {
        const l = BigInt(ls);
        if (l < 4n || usedPrimes.has(ls)) continue;
        const P = wsMul(ord.N / l, ord.G, WP);
        if (!P || wsMul(l, P, WP) !== null) continue; // 阶须恰为 l
        const shared = wsMul(d, P, WP);
        let recovered = -1;
        for (let j = 0n; j < l; j++) {
          if (ptEq(wsMul(j, P, WP), shared)) { recovered = Number(j); break; }
        }
        if (recovered < 0) continue;
        usedPrimes.add(ls);
        residues.push({ r: BigInt(recovered), m: l });
        lines.push(`  b′=${B}：|E′| = ${ord.N}，取阶 ${l} 点 → 预言机输出 ⇒ d mod ${l} = ${recovered}`);
      }
    }
    const prod = residues.reduce((a, r) => a * r.m, 1n);
    lines.push(`（共枚举 ${searched} 条非奇异无效曲线，覆盖素数 ${[...usedPrimes].join(", ")}）`, "");
    if (!residues.length) throw new Error("未收集到任何小子群约束（搜索上限内无可用光滑阶无效曲线）");
    const cr = crt(residues);
    const dTrue = mod(d, cr.m);
    lines.push(`CRT 合成：d ≡ ${cr.r} (mod ${cr.m})`,
      `真值校验：d mod ${cr.m} = ${dTrue} ⇒ ${cr.r === dTrue ? "✓ 一致（无效曲线攻击实证）" : "✗ 不一致"}`);
    if (cr.m >= WP) {
      lines.push(`恢复完整性：mod ${cr.m} ≥ p ⇒ 私钥**完整恢复**（CRT 值 = ${cr.r}，真值 = ${d}：${cr.r === d ? "一致" : "不一致"}）`);
    } else {
      lines.push(`恢复完整性：mod ${cr.m} < p ⇒ 恢复部分约束（真实场景继续收集曲线即可，本演示如实止步）`);
    }
    lines.push("", "防御：接收任何对端点必须做 on-curve 校验（无效曲线点的 y² ≠ x³+ax+b）。",
      "范围声明：真实曲线（如 P-256）的无效曲线群阶 ~256bit，分解超出演示范围；本档以玩具曲线全流程演示机制（构造样例口径）。",
    );
    return { text: lines.join("\n") };
  },
});

function shortU(u) {
  const s = u.toString();
  return s.length <= 13 ? s : s.slice(0, 12) + "…";
}
