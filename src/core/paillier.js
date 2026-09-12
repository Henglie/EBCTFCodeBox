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
 * 契约：族滑块四档 op（T396-A）：paillierKeyGen / paillierEncrypt / paillierDecrypt /
 *        paillierHomAdd，family:"paillier"。
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
// Paillier 四档算法族（T396-A，2026-09-04：同族多操作必须族滑块，废除下拉切模式）
// family:"paillier" + familyLabel → fam.lbl.*（keygen/encrypt/decrypt 已有主表 key；
// 同态加档用 homAdd——需主控在 zh/en i18n 主表新增 fam.lbl.homAdd）。
// 底层 keygen/encrypt/decrypt 实现原样复用，每个 op 只保留本档参数面。
// 原 demo 演示档并入 keygen 档 desc（用四档串起来即完整流程）。
// ============================================================

// ---- 档① 生成密钥对 ----
register({
  id: "paillierKeyGen",
  cat: "asym",
  family: "paillier",
  familyLabel: "keygen",
  name: "Paillier 密钥对生成",
  desc: "生成 Paillier 密钥对（1999 论文口径）：等长素数 p,q → n=p·q，g=n+1，λ=lcm(p-1,q-1)，μ=(L(g^λ mod n²))⁻¹ mod n。公钥 (n,g) 加密，私钥 (λ,μ) 解密。原 demo 演示档已并入：生成密钥后接「加密 → 同态加 → 解密」三档即可跑通 E(m1)·E(m2)=E(m1+m2) 完整流程",
  params: [
    { key: "bits", label: "密钥位数 n", type: "number", default: 256, placeholder: "≥16，演示用小值" },
  ],
  run: (_text, p) => {
    const bits = Math.max(16, parseInt(p.bits, 10) || 256);
    const k = keygen(bits);
    // T362 产物协议（2026-09-02）：公钥（n/g）/ 私钥（λ/μ）分开交付下载按钮（十进制文本）。
    return {
      text: [
        "=== Paillier 密钥对生成 ===",
        "",
        `公钥 n = ${k.n}`,
        `公钥 g = ${k.g}  (= n+1)`,
        `私钥 λ = ${k.lambda}`,
        `私钥 μ = ${k.mu}`,
        `(p = ${k.p}, q = ${k.q})`,
        "",
        "提示：把 n（和 g，留空即 n+1）填入「加密」档；λ/μ 填入「解密」档即可解密。",
        "",
        "公钥 / 私钥已分开生成：私钥 ⚠ 敏感请妥善保管。点击下方按钮下载。",
      ].join("\n"),
      files: [
        { name: `paillier_pub_${bits}.txt`, mime: "text/plain",
          bytes: new TextEncoder().encode(`n = ${k.n}\ng = ${k.g}\n`) },
        { name: `paillier_priv_${bits}.txt`, mime: "text/plain",
          bytes: new TextEncoder().encode(`lambda = ${k.lambda}\nmu = ${k.mu}\n`) },
      ],
    };
  },
});

// ---- 档② 加密 ----
register({
  id: "paillierEncrypt",
  cat: "asym",
  family: "paillier",
  familyLabel: "encrypt",
  name: "Paillier 加密",
  desc: "Paillier 公钥加密：明文 m ∈ [0,n)，选随机 r∈Z_n*（gcd(r,n)=1），c = g^m·r^n mod n²。g 留空按标准简化选取 n+1",
  params: [
    { key: "n", label: "公钥 n", type: "text", default: "", placeholder: "十进制 / 0x hex" },
    { key: "g", label: "公钥 g（留空=n+1）", type: "text", default: "", placeholder: "标准简化选取即 n+1" },
  ],
  run: (text, p) => {
    const n = parseBig(p.n, "n");
    const g = p.g != null && String(p.g).trim() ? parseBig(p.g, "g") : n + 1n;
    const m = parseBig(text, "明文 m");
    if (m < 0n || m >= n) throw new Error("明文 m 须在 [0, n)");
    const c = encrypt(m, n, g);
    return [
      "=== Paillier 加密 ===",
      "",
      `明文 m = ${m}`,
      `密文 c = ${c}`,
    ].join("\n");
  },
});

// ---- 档③ 解密 ----
register({
  id: "paillierDecrypt",
  cat: "asym",
  family: "paillier",
  familyLabel: "decrypt",
  name: "Paillier 解密",
  desc: "Paillier 私钥解密：m = L(c^λ mod n²)·μ mod n，其中 L(x)=(x-1)/n。输入密文 c（十进制 / 0x hex）",
  params: [
    { key: "n", label: "公钥 n", type: "text", default: "", placeholder: "十进制 / 0x hex" },
    { key: "lambda", label: "私钥 λ", type: "text", default: "", placeholder: "lcm(p-1, q-1)" },
    { key: "mu", label: "私钥 μ", type: "text", default: "", placeholder: "(L(g^λ mod n²))⁻¹ mod n" },
  ],
  run: (text, p) => {
    const n = parseBig(p.n, "n");
    const lambda = parseBig(p.lambda, "λ");
    const mu = parseBig(p.mu, "μ");
    const c = parseBig(text, "密文 c");
    const m = decrypt(c, n, lambda, mu);
    return [
      "=== Paillier 解密 ===",
      "",
      `密文 c = ${c}`,
      `明文 m = ${m}`,
    ].join("\n");
  },
});

// ---- 档④ 同态加 ----
register({
  id: "paillierHomAdd",
  cat: "asym",
  family: "paillier",
  familyLabel: "homAdd",
  name: "Paillier 同态加",
  desc: "Paillier 加法同态性质：E(m1)·E(m2) mod n² = E(m1+m2)。输入两个密文（逗号/空白分隔），输出可直接用「解密」档解出的和密文。CTF 高频：已知 n 时无需私钥即可对密文做加法篡改",
  params: [
    { key: "n", label: "公钥 n", type: "text", default: "", placeholder: "十进制 / 0x hex" },
  ],
  run: (text, p) => {
    const n = parseBig(p.n, "n");
    const parts = String(text).split(/[,\s]+/).filter(Boolean);
    if (parts.length !== 2) throw new Error("同态加需要两个密文（逗号分隔）");
    const c1 = parseBig(parts[0], "c1"), c2 = parseBig(parts[1], "c2");
    const c = mod(c1 * c2, n * n);
    return [
      "=== Paillier 同态加 ===",
      "",
      "同态加：E(m1)·E(m2) mod n² = E(m1+m2)",
      `结果密文 c = ${c}`,
      "(解密后 = m1 + m2 mod n)",
    ].join("\n");
  },
});

export { keygen, encrypt, decrypt, lcm, modInverse, L };
