/*
 * paillier.js — Paillier 加法同态加密（cat:'crypto'，run 型）。
 *
 * 定位：审计标注「同态加密」整类空白，Paillier 是最经典的加法同态方案，
 * CTF crypto 常出（同态性质 + 已知 λ 分解 n）。照 Paillier 1999 原始论文
 * 《Public-Key Cryptosystems Based on Composite Degree Residuosity Classes》
 * + HAC 实现，不编造。
 *
 * 密钥生成：
 *   选两个等长大素数 p,q，n = p·q，λ = lcm(p-1, q-1)
 *   g = n + 1（标准简化选取，此时 L(g^λ mod n²) 可省）
 *   μ = (L(g^λ mod n²))⁻¹ mod n，其中 L(x) = (x-1)/n
 *   公钥 (n, g)，私钥 (λ, μ)
 *
 * 加密（明文 m ∈ Z_n）：
 *   选随机 r ∈ Z_n*（gcd(r,n)=1）
 *   c = g^m · r^n mod n²
 *
 * 解密：
 *   m = L(c^λ mod n²) · μ mod n
 *
 * 加法同态：
 *   D(E(m1)·E(m2) mod n²) = m1 + m2 mod n
 *   D(E(m)^k mod n²)      = k·m mod n
 *
 * 红线：
 * - 算法照原始论文，不编造；交付前跑 decrypt(encrypt(m))=m + 同态性质验证。
 * - 随机 r / 素数用 crypto 随机源（复用 primeGen）。
 * - 零外发；core 层零 UI 依赖（仅 registry + primeGen）。
 *
 * 契约：register({ id:"paillier", cat:"crypto", name, desc, params, run })。
 */
import { register } from "./registry.js";
import { generatePrime, modPow } from "./primeGen.js";

// ============================================================
// 大整数工具
// ============================================================
function egcd(a, b) {
  let oldR = a, r = b, oldS = 1n, s = 0n, oldT = 0n, t = 1n;
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
    [oldT, t] = [t, oldT - q * t];
  }
  return [oldR, oldS, oldT];
}
function mod(a, m) { const r = a % m; return r < 0n ? r + m : r; }
function modInverse(a, m) {
  const [g, x] = egcd(mod(a, m), m);
  if (g !== 1n) throw new Error(`模逆不存在：gcd=${g}`);
  return mod(x, m);
}
function lcm(a, b) { return (a / egcd(a, b)[0]) * b; }

function parseBig(s, name) {
  const t = String(s == null ? "" : s).trim();
  if (t === "") throw new Error(`缺少参数：${name}`);
  try { return /^0x/i.test(t) ? BigInt(t) : BigInt(t); }
  catch { throw new Error(`${name} 不是合法整数：${t}`); }
}

// L 函数：L(x) = (x-1)/n
function L(x, n) { return (x - 1n) / n; }

// 随机 r ∈ [1, n-1] 且 gcd(r,n)=1（复用 crypto 随机源经 generatePrime 无关，这里自取）
function randCoprime(n) {
  const bytes = (n.toString(16).length + 1) >> 1;
  for (let tries = 0; tries < 1000; tries++) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    let r = 0n;
    for (const b of buf) r = (r << 8n) | BigInt(b);
    r = mod(r, n);
    if (r > 1n && egcd(r, n)[0] === 1n) return r;
  }
  throw new Error("无法生成与 n 互质的随机数");
}

// ============================================================
// 核心
// ============================================================
function keygen(bits) {
  const half = Math.max(8, bits >> 1);
  let p = generatePrime(half);
  let q = generatePrime(half);
  while (q === p) q = generatePrime(half);
  const n = p * q;
  const n2 = n * n;
  const lambda = lcm(p - 1n, q - 1n);
  const g = n + 1n; // 标准选取
  // μ = (L(g^λ mod n²))⁻¹ mod n
  const mu = modInverse(L(modPow(g, lambda, n2), n), n);
  return { p, q, n, n2, lambda, mu, g };
}

function encrypt(m, n, g) {
  const n2 = n * n;
  const r = randCoprime(n);
  return mod(modPow(g, m, n2) * modPow(r, n, n2), n2);
}

function decrypt(c, n, lambda, mu) {
  const n2 = n * n;
  return mod(L(modPow(c, lambda, n2), n) * mu, n);
}

// ============================================================
// run
// ============================================================
function paillierRun(text, p = {}) {
  const mode = (p && p.mode) || "demo";
  const lines = [];
  lines.push("=== Paillier 加法同态加密 ===");
  lines.push("");

  if (mode === "keygen") {
    const bits = Math.max(16, parseInt(p.bits, 10) || 256);
    const k = keygen(bits);
    lines.push(`公钥 n = ${k.n}`);
    lines.push(`公钥 g = ${k.g}  (= n+1)`);
    lines.push(`私钥 λ = ${k.lambda}`);
    lines.push(`私钥 μ = ${k.mu}`);
    lines.push(`(p = ${k.p}, q = ${k.q})`);
    return lines.join("\n");
  }

  if (mode === "encrypt") {
    const n = parseBig(p.n, "n");
    const g = p.g != null && String(p.g).trim() ? parseBig(p.g, "g") : n + 1n;
    const m = parseBig(text, "明文 m");
    if (m < 0n || m >= n) throw new Error("明文 m 须在 [0, n)");
    const c = encrypt(m, n, g);
    lines.push(`明文 m = ${m}`);
    lines.push(`密文 c = ${c}`);
    return lines.join("\n");
  }

  if (mode === "decrypt") {
    const n = parseBig(p.n, "n");
    const lambda = parseBig(p.lambda, "λ");
    const mu = parseBig(p.mu, "μ");
    const c = parseBig(text, "密文 c");
    const m = decrypt(c, n, lambda, mu);
    lines.push(`密文 c = ${c}`);
    lines.push(`明文 m = ${m}`);
    return lines.join("\n");
  }

  if (mode === "add") {
    // 同态加：输入两个密文（逗号分隔），输出 E(m1+m2)
    const n = parseBig(p.n, "n");
    const parts = String(text).split(/[,\s]+/).filter(Boolean);
    if (parts.length !== 2) throw new Error("同态加需要两个密文（逗号分隔）");
    const c1 = parseBig(parts[0], "c1"), c2 = parseBig(parts[1], "c2");
    const c = mod(c1 * c2, n * n);
    lines.push("同态加：E(m1)·E(m2) mod n² = E(m1+m2)");
    lines.push(`结果密文 c = ${c}`);
    lines.push("(解密后 = m1 + m2 mod n)");
    return lines.join("\n");
  }

  // demo：完整演示 keygen→encrypt→homomorphic add→decrypt
  const k = keygen(64);
  const m1 = 42n, m2 = 100n;
  const c1 = encrypt(m1, k.n, k.g);
  const c2 = encrypt(m2, k.n, k.g);
  const cSum = mod(c1 * c2, k.n2);
  const dSum = decrypt(cSum, k.n, k.lambda, k.mu);
  lines.push("【演示】完整流程（64 位密钥）");
  lines.push(`n = ${k.n}`);
  lines.push(`m1 = ${m1}, m2 = ${m2}`);
  lines.push(`E(m1) = ${c1}`);
  lines.push(`E(m2) = ${c2}`);
  lines.push(`E(m1)·E(m2) mod n² = ${cSum}`);
  lines.push(`解密 = ${dSum}  ${dSum === m1 + m2 ? "✓ 等于 m1+m2" : "✗"}`);
  lines.push("");
  lines.push("模式说明：keygen 生成密钥 / encrypt 加密 / decrypt 解密 / add 同态加两密文。");
  return lines.join("\n");
}

register({
  id: "paillier",
  cat: "crypto",
  name: "Paillier 同态加密",
  desc: "Paillier 加法同态公钥加密（1999）：加密 c=g^m·r^n mod n²，解密 m=L(c^λ mod n²)·μ mod n。满足 E(m1)·E(m2)=E(m1+m2) 加法同态。模式：demo 演示 / keygen 生成密钥 / encrypt 加密 / decrypt 解密 / add 同态加。",
  params: [
    {
      key: "mode", label: "模式", type: "select", default: "demo",
      options: [
        { value: "demo", label: "演示（完整流程）" },
        { value: "keygen", label: "生成密钥" },
        { value: "encrypt", label: "加密" },
        { value: "decrypt", label: "解密" },
        { value: "add", label: "同态加（两密文）" },
      ],
    },
    { key: "bits", label: "密钥位数 (keygen)", type: "number", default: 256, placeholder: "≥16，演示用小值" },
    { key: "n", label: "公钥 n", type: "text", default: "", placeholder: "encrypt/decrypt/add 用" },
    { key: "g", label: "公钥 g (留空=n+1)", type: "text", default: "", placeholder: "encrypt 用" },
    { key: "lambda", label: "私钥 λ", type: "text", default: "", placeholder: "decrypt 用" },
    { key: "mu", label: "私钥 μ", type: "text", default: "", placeholder: "decrypt 用" },
  ],
  run: paillierRun,
});

export { keygen, encrypt, decrypt, lcm, modInverse, L };
