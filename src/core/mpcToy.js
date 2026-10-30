/*
 * mpcToy.js — 安全多方计算的玩具实现（教学演示，非生产级）。
 *
 * 两个模式，都只做「一次乘法」这个最小闭环：
 *   beaver — 三方加法分享 + Beaver 乘法三元组（D. Beaver, "Efficient Multiparty
 *            Computations Using Circuit Randomization", CRYPTO '91, LNCS 576, 1991）。
 *            离线阶段预生成与输入无关的三元组 (x, y, z = x·y)；在线阶段各方只公开
 *            两个掩码值 d = x + a、e = y + b，再由
 *                [w]_i = [z]_i - d·[y]_i - e·[x]_i   （P1 再加 d·e）
 *            得到 [a·b] 的分享。加法 Σ 后恰为 a·b（推导见 multiply 内注释）。
 *   ot     — 1-of-2 不经意传输的教学模拟（Even-Goldreich-Micali 1985 的 RSA 型构造
 *            在概念上对应「接收方发盲化值、发送方回两条掩码消息」）。本文件**不实现**
 *            真实构造：没有 RSA/DDH、没有陷门、pad 由确定性 PRF 生成，因此不具任何
 *            密码学安全性，仅用于演示「接收方只能解出所选那条」的流程。
 *
 * 域：p = 2^31 - 1（梅森素数）。所有分享、掩码都在 Z_p 上；用 Number 而非 BigInt，
 *   因为 p² ≈ 2^62 会超 Number 精度——所以乘法一律走 mulMod()（BigInt 中转），
 *   不对 Number 直接做 a*b。这是本文件唯一需要小心的地方。
 *
 * 随机：种子 → FNV-1a 64 位 → splitmix64 流（可复现，非密码学安全）；
 *   不给种子时从统一随机层 randSource.randomBytes 取 8 字节作种子并回显。
 *
 * 红线：教学演示，非生产级。分享数只有 3 份、无 MAC/无承诺/无零知识证明，
 *   恶意参与者可任意偏离协议而无人察觉；OT 是模拟，无真实安全性。
 */

import { register } from "./registry.js";
import { randomBytes, sha256HexOfUtf8 } from "./randSource.js";

const P = 2147483647; // 2^31 - 1，素数

// ---- splitmix64（可复现，非密码学安全） ----
function makeRng(seed) {
  let state = BigInt(seed) & 0xffffffffffffffffn;
  return function next() {
    state = (state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    z = z ^ (z >> 31n);
    return z & 0xffffffffffffffffn;
  };
}

function hashSeed(str) { // FNV-1a 64 位
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(String(str))) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

/** [0, P) 上的均匀整数（拒绝采样，避免取模偏置）。 */
function randBelow(rng, bound) {
  const b = BigInt(bound);
  const span = 0x10000000000000000n;
  const limit = span - (span % b);
  for (let i = 0; i < 10000; i++) {
    const v = rng();
    if (v < limit) return Number(v % b);
  }
  throw new Error("均匀采样连续 10000 次落在拒绝区（随机流异常）");
}

/** Z_p 上的乘法：p² 超 Number 安全整数范围，必须经 BigInt。 */
function mulMod(a, b) {
  return Number((BigInt(a) * BigInt(b)) % BigInt(P));
}

function addMod(a, b) {
  const s = (a + b) % P;
  return s < 0 ? s + P : s;
}

function subMod(a, b) {
  const s = (a - b) % P;
  return s < 0 ? s + P : s;
}

/** 把 v ∈ Z_p 拆成 3 份加法分享（随机前两份，第三份补齐）。 */
function split3(v, rng) {
  const s1 = randBelow(rng, P);
  const s2 = randBelow(rng, P);
  const s3 = subMod(subMod(v, s1), s2);
  return [s1, s2, s3];
}

function sumMod(arr) {
  let s = 0;
  for (const v of arr) s = addMod(s, v);
  return s;
}

// ============================================================
// Beaver 三元组乘法
// ============================================================

function runBeaver(a, b, rng) {
  const L = [];
  // 离线阶段：三元组与输入无关
  const x = randBelow(rng, P);
  const y = randBelow(rng, P);
  const z = mulMod(x, y);
  const xs = split3(x, rng);
  const ys = split3(y, rng);
  const zs = split3(z, rng);

  L.push("[1] 离线阶段：预生成乘法三元组（与输入无关，可在协议开始前算好）");
  L.push("    x = " + x + "，y = " + y + "，z = x·y mod p = " + z);
  L.push("    三元组的三方分享（每方一份，单独看是均匀随机数）：");
  L.push("      x: [" + xs.join(", ") + "]");
  L.push("      y: [" + ys.join(", ") + "]");
  L.push("      z: [" + zs.join(", ") + "]");
  L.push("");

  // 输入分享
  const as = split3(a, rng);
  const bs = split3(b, rng);
  L.push("[2] 输入分享（加法分享：三方之和 ≡ 输入 mod p）");
  L.push("    Alice 的 a = " + a + " → [" + as.join(", ") + "]，校验 Σ = " + sumMod(as));
  L.push("    Bob   的 b = " + b + " → [" + bs.join(", ") + "]，校验 Σ = " + sumMod(bs));
  L.push("");

  // 在线阶段
  const ds = [0, 1, 2].map((i) => addMod(xs[i], as[i]));
  const es = [0, 1, 2].map((i) => addMod(ys[i], bs[i]));
  const d = sumMod(ds);
  const e = sumMod(es);
  L.push("[3] 在线阶段①：各方本地算 d_i = x_i + a_i、e_i = y_i + b_i（不公开 x_i / a_i）");
  for (let i = 0; i < 3; i++) L.push("    P" + (i + 1) + ": d_" + (i + 1) + " = " + ds[i] + "，e_" + (i + 1) + " = " + es[i]);
  L.push("[4] 公开 d = Σd_i = " + d + "，e = Σe_i = " + e + "（只公开这两个掩码值）");
  L.push("    核对：d ≡ x + a (mod p) → " + addMod(x, a) + (d === addMod(x, a) ? " ✓" : " ✗"));
  L.push("    核对：e ≡ y + b (mod p) → " + addMod(y, b) + (e === addMod(y, b) ? " ✓" : " ✗"));
  L.push("");

  const ws = [0, 1, 2].map((i) => {
    let w = subMod(zs[i], addMod(mulMod(d, ys[i]), mulMod(e, xs[i])));
    if (i === 0) w = addMod(w, mulMod(d, e)); // 只有一方补 d·e
    return w;
  });
  L.push("[5] 在线阶段②：各方本地算 w_i = z_i - d·y_i - e·x_i（P1 再加 d·e）");
  for (let i = 0; i < 3; i++) L.push("    P" + (i + 1) + ": w_" + (i + 1) + " = " + ws[i]);
  const recon = sumMod(ws);
  const expect = mulMod(a, b);
  L.push("[6] 重建：Σw_i mod p = " + recon);
  L.push("");

  L.push("── 自证 ──");
  L.push("重建值 " + recon + (recon === expect ? " == a·b mod p = " + expect + " ✓" : " != a·b mod p = " + expect + " ✗"));
  L.push("代数：Σw_i = z - d·y - e·x + d·e = xy - (x+a)y - (y+b)x + (x+a)(y+b) = ab ✓");
  L.push("");

  // 隐私自证（字符串层面的启发式检查，不是安全性证明）
  // 只比「十进制串整体相等」——1~2 位明文做子串匹配必然误报（"7" 会命中任何含 7 的数）。
  const p1 = [as[0], bs[0], ws[0]];
  const targets = [String(a), String(b), String(expect)];
  const leaks = p1.some((v) => targets.indexOf(String(v)) >= 0);
  L.push("── 隐私自证（P1 视角）──");
  L.push("P1 只看到：a1 = " + as[0] + "，b1 = " + bs[0] + "，w1 = " + ws[0]);
  L.push("对任意候选 a′，都存在 a2′ + a3′ ≡ a′ - a1 的分享组合，故 a1 不缩小 a 的可能范围（信息论意义下与均匀随机不可区分）。");
  L.push("字符串检查（启发式，非证明）：三个 share 的十进制串与 a、b、a·b 的十进制串" +
    (leaks ? "**有整体相等项**，请换一个 seed" : "均不相等") + "。");
  L.push("");
  L.push("说明：教学演示，非生产级——3 份分享、无 MAC/承诺/零知识证明，恶意方偏离协议无人察觉；");
  L.push("      真实 MPC 需要 SPDZ/TinyOT 一类的信息论 MAC 与预处理扩展。");

  return {
    text: L.join("\n"),
    data: { mode: "beaver", a, b, recon, expect, d, e, shares: { a: as, b: bs, w: ws }, p: P },
  };
}

// ============================================================
// 1-of-2 OT（模拟）
// ============================================================

function prf31(key, label) { // 31 位确定性 pad（纯 JS SHA-256，项目统一实现）
  const h = sha256HexOfUtf8(key + "|" + label);
  return parseInt(h.slice(0, 8), 16) & 0x7fffffff;
}

function runOt(choice, base, seedText) {
  const L = [];
  const m0 = base;
  const m1 = base + 1000; // 玩具约定：让两条消息在文本上可区分
  const keyRx = sha256HexOfUtf8("rx|" + seedText);
  const keyTx = sha256HexOfUtf8("tx|" + seedText);

  const v = prf31(keyRx, "v" + choice); // 模拟「接收方公钥盲化后的值」
  const k0 = prf31(keyTx, "k" + v + "0");
  const k1 = prf31(keyTx, "k" + v + "1");
  const c0 = (m0 ^ k0) >>> 0;
  const c1 = (m1 ^ k1) >>> 0;
  const kc = choice === 0 ? k0 : k1;
  const cc = choice === 0 ? c0 : c1;
  const got = (cc ^ kc) >>> 0;

  L.push("[1] 发送方私有消息：m0 = " + m0 + "，m1 = " + m1 + "（玩具约定 m1 = m0 + 1000，仅为可区分）");
  L.push("[2] 接收方私有选择位 c = " + choice);
  L.push("[3] 接收方 → 发送方：v = PRF(K_rx, \"v\"||c) = " + v + "（模拟公钥盲化值）");
  L.push("[4] 发送方：k_i = PRF(K_tx, \"k\"||v||i)");
  L.push("      k0 = " + k0 + "，k1 = " + k1);
  L.push("[5] 发送方 → 接收方：(c0, c1) = (" + c0 + ", " + c1 + ")   [c_i = m_i ⊕ k_i]");
  L.push("[6] 私有通道（模拟）：接收方只拿到 k_" + choice + " = " + kc + "，另一条 pad 未出现在任何记录里");
  L.push("[7] 接收方：m_" + choice + " = c_" + choice + " ⊕ k_" + choice + " = " + got);
  L.push("");
  L.push("── 自证 ──");
  L.push("重建消息 " + got + (got === (choice === 0 ? m0 : m1) ? " == m_" + choice + " ✓" : " != m_" + choice + " ✗"));
  L.push("另一条消息 m_" + (1 - choice) + " = " + (choice === 0 ? m1 : m0) + " 在记录中不可恢复：缺 k_" + (1 - choice) + "。");
  L.push("");
  L.push("── 传输记录（接收方视角可见项）──");
  L.push("  v = " + v);
  L.push("  c0 = " + c0 + "（掩码后，单独看不出 m0）");
  L.push("  c1 = " + c1 + "（掩码后，单独看不出 m1）");
  L.push("  k_" + choice + " = " + kc + "（私有通道）");
  L.push("");
  L.push("说明：教学演示，非生产级，且**这是模拟不是协议**——");
  L.push("      本实现没有 RSA/DDH 陷门，pad 由确定性 PRF 生成；");
  L.push("      由于 seed 在记录里公开（为了复现），任何拿到 seed 的人都能算出 k0、k1 并解出两条消息。");
  L.push("      它演示的是「盲化值 → 两条掩码消息 → 只解一条」的流程骨架，不具备任何保密性。");

  return {
    text: L.join("\n"),
    data: { mode: "ot", choice, m0, m1, v, c0, c1, kc, got, expected: choice === 0 ? m0 : m1 },
  };
}

// ============================================================
// 主流程
// ============================================================

export function mpcRun(p) {
  const src = p || {};
  const mode = src.mode == null || String(src.mode).trim() === "" ? "beaver" : String(src.mode).trim();
  if (mode !== "beaver" && mode !== "ot") throw new Error("mode 只接受 beaver / ot，收到 " + mode);

  const seedRaw = src.seed == null ? "" : String(src.seed).trim();
  let seedText = seedRaw;
  let seedShown = "";
  if (seedText === "") {
    const buf = randomBytes(8);
    let n = 0n;
    for (const x of buf) n = (n << 8n) | BigInt(x);
    seedText = "auto-" + n.toString();
    seedShown = "（未给 seed，本次从统一随机层取种子并回显；下次要复现请填 \"" + seedText + "\"）";
  }
  const rng = makeRng(hashSeed(seedText));

  const L = [];
  L.push("=== 安全多方计算玩具（教学演示，非生产级）===");
  L.push("mode = " + mode + "；域 p = " + P + "（2^31-1 素数）；seed = \"" + seedText + "\"" + seedShown);
  L.push("");

  if (mode === "beaver") {
    const aRaw = Number(src.a);
    const bRaw = Number(src.b);
    if (!Number.isInteger(aRaw) || aRaw < 0 || aRaw >= P) {
      throw new Error("beaver 模式的 a 必须是 [0, p) 内的整数（p = " + P + "），收到 " + src.a);
    }
    if (!Number.isInteger(bRaw) || bRaw < 0 || bRaw >= P) {
      throw new Error("beaver 模式的 b 必须是 [0, p) 内的整数（p = " + P + "），收到 " + src.b);
    }
    const r = runBeaver(aRaw, bRaw, rng);
    return { text: L.join("\n") + r.text, data: r.data };
  }

  const choiceRaw = Number(src.a);
  if (choiceRaw !== 0 && choiceRaw !== 1) {
    throw new Error("ot 模式的 a 是接收方选择位，只接受 0 / 1，收到 " + src.a);
  }
  const baseRaw = Number(src.b);
  if (!Number.isInteger(baseRaw) || baseRaw < 0 || baseRaw > 0x3fffff) {
    throw new Error("ot 模式的 b 是消息基准值，必须是 [0, 4194303] 内的整数（pad 只有 31 位），收到 " + src.b);
  }
  const r = runOt(choiceRaw, baseRaw, seedText);
  return { text: L.join("\n") + r.text, data: r.data };
}

register({
  id: "mpcToy",
  cat: "modern",
  name: "安全多方计算玩具（教学）",
  desc: "MPC 教学玩具：beaver 模式用三方加法分享 + Beaver 1991 乘法三元组完成一次 a×b，打印各方 share、掩码值 d/e 与重建自证，并演示单方 share 看不出明文；ot 模式模拟 1-of-2 不经意传输的「盲化 → 两条掩码消息 → 只解一条」流程。教学演示，非生产级：无 MAC/承诺/零知识证明，OT 是确定性 PRF 模拟（无 RSA/DDH 陷门，公开 seed 即可解出两条），不具备真实安全性",
  params: [
    { key: "mode", label: "模式", type: "select", default: "beaver", options: [
      { value: "beaver", label: "beaver 乘法三元组" },
      { value: "ot", label: "ot 1-of-2 不经意传输（模拟）" },
    ] },
    { key: "a", label: "a（beaver：Alice 输入 / ot：选择位 0|1）", type: "number", default: 7 },
    { key: "b", label: "b（beaver：Bob 输入 / ot：消息基准值）", type: "number", default: 9 },
    { key: "seed", label: "随机种子", type: "text", default: "mpc-toy", placeholder: "同 seed 完全复现；留空则从统一随机层取" },
  ],
  run: (_text, p) => mpcRun(p).text,
});

export { mulMod, addMod, subMod, P as MODULUS };
