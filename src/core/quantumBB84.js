/*
 * quantumBB84.js — BB84 量子密钥分发教学仿真（cat:'modern'，run 单向）。
 *
 * 原理（C. H. Bennett, G. Brassard, "Quantum Cryptography: Public Key
 *   Distribution and Coin Tossing", Proc. IEEE ICCSSP, 1984；
 *   综述：N. Gisin et al., "Quantum cryptography", Rev. Mod. Phys. 74, 145 (2002)）：
 * - Alice 对每个比特随机选基矢（+ 直角 / × 对角）发偏振光子；
 * - Bob 每光子再随机选基测量：基与 Alice 相同时结果确定（无噪声 100% 一致），
 *   基不同时结果均匀随机（测不准原理）；
 * - 公开信道比对基矢（只公开基，不公开比特），弃掉基不同的位置 → 筛后密钥（期望 n/2 位）；
 * - 从筛后密钥抽样公开比对估计误码率 QBER：
 *   · 无窃听无噪声时 QBER = 0；
 *   · 截获-重发式窃听（Eve 每光子以概率 eve 拦截、随机基测量后转发）
 *     在筛后位上引入错率 ≈ eve/4（Eve 全拦 eve=1 时 ≈ 25%，超 BB84 安全阈值 ~11%）；
 *   · QBER 超阈值 → 判定信道不安全（Eve 被检出），协议中止；
 * - 删去抽样位，剩余即最终共享密钥。
 *
 * 实现：经典概率仿真（splitmix64 可复现 PRNG；seed 留空用 crypto.getRandomValues
 *   取随机种子并回显，同 seed 完全复现）。数学要点：Bob 基与到达光子基相同时
 *   输出该比特、不同时输出随机比特；信道误码率在测量结果上再独立翻转。
 *
 * 红线：纯函数本地，零外发；非密码学安全 PRNG（仿真教学专用）。
 */

import { register } from "./registry.js";

// ---- splitmix64 PRNG（可复现，非密码学安全） ----
function makeRng(seed) {
  let state = BigInt(seed) & 0xffffffffffffffffn;
  return function next() {
    state = (state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    z = z ^ (z >> 31n);
    return Number(z & 0xfffffffffffffn) / 2 ** 52; // [0,1)
  };
}
const randBit = (rng) => (rng() < 0.5 ? 0 : 1);

function hashSeed(str) { // 口令 → 64 位种子（FNV-1a 两轮）
  let h = 0xcbf29ce484222325n;
  for (const b of new TextEncoder().encode(String(str))) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}

function bitsToHex(bits) {
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b.toString(16).padStart(2, "0"));
  }
  const rem = bits.length % 8;
  if (rem) { // 不足一字节：低位补零打包
    let b = 0;
    for (let j = 0; j < rem; j++) b = (b << 1) | bits[bits.length - rem + j];
    b <<= 8 - rem;
    out.push(b.toString(16).padStart(2, "0"));
  }
  return out.join("");
}

const BASIS_CHAR = (b) => (b ? "×" : "+");

register({
  id: "bb84Qkd",
  cat: "modern",
  name: "BB84 量子密钥分发仿真",
  desc: "BB84 协议教学仿真（Bennett-Brassard 1984 / Gisin et al. 2002）：随机基矢发送-测量 → 基矢比对筛密 → 抽样估误码率检出窃听 → 剩余为最终密钥。支持信道误码率、Eve 截获-重发窃听率、可复现种子。Eve 全拦时筛后误码率 ≈ 25%",
  params: [
    { key: "n", label: "发送光子数 n", type: "number", default: 128 },
    { key: "err", label: "信道误码率 (0~1)", type: "number", default: 0 },
    { key: "eve", label: "Eve 窃听率 (0~1)", type: "number", default: 0 },
    { key: "seed", label: "随机种子 (可选)", type: "text", default: "", placeholder: "留空随机；固定则完全复现" },
    { key: "sampleRatio", label: "抽样比例", type: "number", default: 0.5 },
    { key: "threshold", label: "QBER 检出门限", type: "number", default: 0.11 },
    { key: "tableRows", label: "过程表显示行数", type: "number", default: 32 },
  ],
  run: (_text, p) => {
    const n = Math.max(8, Math.min(4096, Math.floor(Number(p?.n) || 128)));
    const err = Math.max(0, Math.min(1, Number(p?.err) || 0));
    const eve = Math.max(0, Math.min(1, Number(p?.eve) || 0));
    const sampleRatio = Math.max(0.05, Math.min(1, Number(p?.sampleRatio ?? 0.5)));
    const threshold = Math.max(0.001, Math.min(1, Number(p?.threshold ?? 0.11)));
    const tableRows = Math.max(0, Math.min(n, Math.floor(Number(p?.tableRows ?? 32))));

    const seedStr = (p && p.seed != null && String(p.seed).trim() !== "") ? String(p.seed) : null;
    const seedShown = seedStr != null ? `（口令 "${seedStr}"）` : "（随机生成）";
    let seed;
    if (seedStr != null) {
      seed = hashSeed(seedStr);
    } else {
      const b = new Uint8Array(8);
      crypto.getRandomValues(b);
      seed = 0n;
      for (const x of b) seed = (seed << 8n) | BigInt(x);
    }
    const rng = makeRng(seed);

    // ① Alice：随机比特 + 随机基
    const aBit = [], aBas = [];
    for (let i = 0; i < n; i++) { aBit.push(randBit(rng)); aBas.push(randBit(rng)); }

    // ② Eve 截获-重发 + ③ Bob 随机基测量
    const eHit = [], eBas = [], bBit = [], bBas = [];
    for (let i = 0; i < n; i++) {
      let bitIn = aBit[i], basIn = aBas[i]; // 到达态（默认 Alice 原态）
      const hit = rng() < eve;
      eHit.push(hit);
      if (hit) {
        const eb = randBit(rng);
        eBas.push(eb);
        const m = eb === basIn ? bitIn : randBit(rng); // Eve 基不同则得随机比特
        bitIn = m; basIn = eb; // 转发测量态
      } else {
        eBas.push(null);
      }
      const bb = randBit(rng);
      bBas.push(bb);
      let m2 = bb === basIn ? bitIn : randBit(rng); // Bob 基不同则随机
      if (rng() < err) m2 ^= 1; // 信道误码
      bBit.push(m2);
    }

    // ④ 基矢比对筛密（公开的只有基矢）
    const sifted = [];
    for (let i = 0; i < n; i++) if (bBas[i] === aBas[i]) sifted.push(i);

    // ⑤ 抽样公开校验
    const shuffled = sifted.slice();
    for (let i = shuffled.length - 1; i > 0; i--) { // Fisher-Yates
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const sampleN = Math.max(1, Math.floor(sifted.length * sampleRatio));
    const sampled = shuffled.slice(0, sampleN);
    const sampledSet = new Set(sampled);
    let mism = 0;
    for (const i of sampled) if (bBit[i] !== aBit[i]) mism++;
    const qber = sampled.length ? mism / sampled.length : 0;
    const eveDetected = qber > threshold;

    // ⑥ 剩余为最终密钥
    const finalBits = [];
    for (const i of sifted) {
      if (!sampledSet.has(i)) finalBits.push(aBit[i]);
    }

    // ---- 输出 ----
    const siftedSet = new Set(sifted);
    const L = [];
    L.push(`=== BB84 量子密钥分发仿真（Bennett-Brassard 1984）===`);
    L.push(`参数：n=${n} 光子，信道误码率=${err}，Eve 窃听率=${eve}，抽样比例=${sampleRatio}，检出门限=${threshold}`);
    L.push(`随机种子 = ${seed}${seedShown}`);
    L.push("");
    L.push(`① Alice 发送 ${n} 个偏振光子（随机比特 + 随机基 +/×）`);
    L.push(`② Eve 截获-重发：拦下 ${eHit.filter(Boolean).length} 个（窃听率 ${eve}，拦后选随机基测量再转发）`);
    L.push(`③ Bob 随机基测量完成`);
    L.push(`④ 公开比对基矢：双方基相同 ${sifted.length} 位（期望 ≈ n/2 = ${Math.round(n / 2)}）→ 筛后密钥`);
    L.push(`⑤ 抽样公开比对 ${sampled.length} 位：不一致 ${mism} 位 → 实测 QBER = ${(qber * 100).toFixed(2)}%`);
    L.push(`   理论 QBER ≈ (eve/4 + (1-eve)×err) × 100% = ${((eve / 4 + (1 - eve) * err) * 100).toFixed(2)}%`);
    L.push(`⑥ 判定：${eveDetected ? "⚠ QBER 超门限——Eve 被检出，本次密钥作废（真实协议中止并换信道）" : "QBER 在门限内，未检出窃听"}`);
    L.push(`⑦ 删除抽样位后剩余 ${finalBits.length} 位为最终共享密钥`);
    L.push("");
    if (eveDetected) {
      L.push(`最终密钥：（已作废——Eve 被检出）`);
    } else {
      L.push(`最终密钥 (${finalBits.length} bit) hex = ${bitsToHex(finalBits)}`);
    }
    L.push("");

    // 过程表（前 tableRows 行）
    const rows = Math.min(tableRows, n);
    L.push(`── 过程表（前 ${rows} / ${n} 行；A=Alice，B=Bob，E=Eve；+ × 为基矢；"S"=筛后保留，"◆"=抽样公开）──`);
    L.push(`idx | A比特 A基 | E拦截 E基 | B基 B测 | 筛后/抽样`);
    for (let i = 0; i < rows; i++) {
      const s = siftedSet.has(i) ? "S" : " ";
      const sm = sampledSet.has(i) ? `◆${bBit[i] === aBit[i] ? "✓" : "✗"}` : "";
      L.push(`${String(i).padStart(3)} |   ${aBit[i]}    ${BASIS_CHAR(aBas[i])} |   ${eHit[i] ? "是" : "-"}    ${eHit[i] ? BASIS_CHAR(eBas[i]) : "-"} |  ${BASIS_CHAR(bBas[i])}   ${bBit[i]}  | ${s} ${sm}`.replace(/\s+$/, ""));
    }
    L.push("");
    L.push(`判据自检：无 Eve 无误码时筛后位应全一致；Eve 全拦（eve=1）时筛后误码 ≈ 25%。`);
    L.push(`说明：本仿真为经典概率模型，演示 BB84 的 sift-then-check 逻辑；真实 QKD 需量子信道与单光子源。`);
    return L.join("\n");
  },
});

export { makeRng, bitsToHex };
