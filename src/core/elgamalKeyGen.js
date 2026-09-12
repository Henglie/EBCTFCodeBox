/*
 * elgamalKeyGen.js — ElGamal 密钥对生成器（cat:'modern'，run 单向）。
 *
 * 配套 elgamal.js 的加解密 op：那边要用户手填 p,g,x,y，这里一键生成。
 *
 * 算法（Handbook of Applied Cryptography §8.4.1 / 原文 T. ElGamal 1985, CRYPTO'84）：
 * - 安全素数法：q 取 (bits-1) 位素数，p = 2q+1 再验素（p-1 = 2q 因子平凡，
 *   使原根判定不需分解 p-1：g 为原根 ⟺ g²≢1 且 g^q ≢ 1 (mod p)）
 * - 私钥 x ∈ [2, q]（落在阶 q 子群与原根内均安全），公钥 y = g^x mod p
 * - 随机源：crypto.getRandomValues（密码学安全，禁 Math.random）
 *
 * 北极星：算法零 UI 依赖、纯函数；注释含标准出处，可被独立摘取当权威源。
 */
import { register } from "./registry.js";
import { generatePrime, isProbablePrime } from "./primeGen.js";
import { modPow } from "./elgamal.js";

function randomBig(bits) {
  const bytes = Math.ceil(bits / 8);
  const buf = new Uint8Array(bytes);
  let v;
  do {
    crypto.getRandomValues(buf);
    v = 0n;
    for (const b of buf) v = (v << 8n) | BigInt(b);
    v |= 1n << BigInt(bits - 1); // 置最高位，保证位长足额
  } while (v < (1n << BigInt(bits - 1)));
  return v;
}

function randomInRange(lo, hi) { // 均匀性教学足够：拒绝采样
  const span = hi - lo + 1n;
  const bits = span.toString(2).length;
  for (;;) {
    const v = randomBig(bits) % span;
    if (v <= span - 1n) return lo + v;
  }
}

register({
  id: "elgamalKeyGen", family: "elgamal", familyLabel: "keygen",
  cat: "asym",
  name: "ElGamal 密钥生成",
  desc: "ElGamal 公钥密钥对一键生成（HAC §8.4.1）：安全素数 p=2q+1 + 原根 g + 私钥 x + 公钥 y=g^x。产物直接配套「ElGamal」op 的加密/解密参数",
  params: [
    { key: "bits", label: "素数 p 位长", type: "select", default: "256", options: [
      { value: "128", label: "128 位（CTF 教学快速）" },
      { value: "256", label: "256 位（推荐）" },
      { value: "512", label: "512 位（较慢）" },
      { value: "1024", label: "1024 位（很慢，仅演示）" },
    ] },
    { key: "showQ", label: "输出 q 与中间量", type: "bool", default: true },
  ],
  run: (_text, p) => {
    const bits = Math.max(16, Math.min(1024, Number(p?.bits) || 256));
    // 1) 安全素数 p = 2q+1：q 素且 p 素（Miller-Rabin，复用 primeGen 判据）
    let q = 0n, P = 0n;
    for (let tries = 0; ; tries++) {
      q = generatePrime(bits - 1);
      P = 2n * q + 1n;
      if (isProbablePrime(P)) break;
      if (tries > 100000) throw new Error("安全素数搜索异常，请重试");
    }
    // 2) 原根 g：p-1=2q，g 为原根 ⟺ g²≢1 且 g^q ≢ 1 (mod p)（HAC §4.6.1 判据 4 的安全素数特例）
    let G = 0n;
    for (let g = 2n; g < P - 1n; g++) {
      if (modPow(g, 2n, P) !== 1n && modPow(g, q, P) !== 1n) { G = g; break; }
    }
    if (G === 0n) throw new Error("未找到原根（异常）");
    // 3) 私钥 x ∈ [2, q]（HAC §8.4.1：x ∈ [1, p-2]，收窄到阶 q 子群侧同样安全且常用）
    const X = randomInRange(2n, q);
    const Y = modPow(G, X, P);
    const lines = [
      `ElGamal 密钥对（p = 2q+1 安全素数，p 为 ${bits} 位）`,
      `素数 p = ${P}`,
      `公钥 g = ${G}`,
      `公钥 y = ${Y}`,
      `私钥 x = ${X}`,
      p?.showQ !== false ? `子群阶 q = ${q}` : "",
      "使用：把 p/g/y 填入「ElGamal」op 加密；把 p/x 填入解密（y=g^x 可自查）",
    ].filter(Boolean);
    // T362 产物协议（2026-09-02）：公钥（p/g/y）/ 私钥（p/x）分开交付下载按钮（十进制文本）。
    lines.push("", "公钥 / 私钥已分开生成：私钥 ⚠ 敏感请妥善保管。点击下方按钮下载。");
    return {
      text: lines.join("\n"),
      files: [
        { name: `elgamal_pub_${bits}.txt`, mime: "text/plain",
          bytes: new TextEncoder().encode(`p = ${P}\ng = ${G}\ny = ${Y}\n`) },
        { name: `elgamal_priv_${bits}.txt`, mime: "text/plain",
          bytes: new TextEncoder().encode(`p = ${P}\nx = ${X}\n`) },
      ],
    };
  },
});

export { randomBig, randomInRange };
