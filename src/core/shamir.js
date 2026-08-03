/*
 * shamir.js — Shamir 秘密共享（Shamir's Secret Sharing，cat:'crypto'）。
 *
 * 算法照 Adi Shamir 1979《How to Share a Secret》+ HAC §12.71，在 GF(2^8) 上逐字节
 * 实现（工业界 SSS 标准做法，如 HashiCorp Vault / sss 库），不编造：
 *
 * 分割（split，encode 方向）：
 *   秘密按 UTF-8 取字节。对每个字节 s：
 *     构造次数 (k-1) 的多项式 f(x) = s + a1·x + a2·x² + … + a_{k-1}·x^{k-1}
 *     系数 a1..a_{k-1} 用 crypto.getRandomValues 随机取（GF(256) 内）。
 *   对 x = 1,2,…,n 求 f(x)，得到 n 份分片；每份 = (x, 该字节在 x 处的值)。
 *   任意 k 份可还原，k-1 份得不到关于秘密的任何信息（信息论安全）。
 *
 * 合并（combine，decode 方向）：
 *   收集 ≥k 份分片，对每个字节位置用拉格朗日插值在 x=0 处求值：
 *     s = Σ_i y_i · Π_{j≠i} (x_j) / (x_j − x_i)   （全部在 GF(256) 上）
 *   得到常数项即原始字节。
 *
 * GF(2^8) 运算：约化多项式 0x11B（AES 域），生成元 0x03（3 是该域的本原元，
 *   幂遍历全部 255 个非零元）。exp/log 查表做乘除，减法即异或。
 *
 * 分片格式：每行一份 `x:hex`，x 为 1 字节十六进制（01..ff），hex 为该分片各字节值。
 *   首行带元信息注释 `# shamir k=<k> n=<n>`（合并时忽略以 # 开头的行）。
 *
 * 红线：
 * - 算法照原始方案 + HAC 实现，不编造。
 * - 随机系数用 crypto.getRandomValues，不用 Math.random（信息论安全前提）。
 * - 交付前跑往返测试（split→combine 复原，且任取 k 份均可还原、k-1 份不足）。
 * - 零外发：纯本地计算。
 * - core 层零 UI 依赖（仅 registry）。
 *
 * 契约：register({id, cat:"crypto", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

// ============================================================
// GF(2^8) 运算表（约化多项式 0x11B，生成元 0x03）
// ============================================================
const GF_EXP = new Uint8Array(256);
const GF_LOG = new Uint8Array(256);

// 无表乘法（俄罗斯农民乘法 + 0x1B 约化），仅用于建表
function gfMulRaw(a, b) {
  let p = 0;
  for (let i = 0; i < 8; i++) {
    if (b & 1) p ^= a;
    const hi = a & 0x80;
    a = (a << 1) & 0xff;
    if (hi) a ^= 0x1b; // x^8 ≡ x^4+x^3+x+1 (0x11B 去掉溢出的高位)
    b >>= 1;
  }
  return p & 0xff;
}

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = gfMulRaw(x, 3); // 乘生成元 3
  }
  GF_EXP[255] = GF_EXP[0]; // 便于 (log+log) 不取模时索引
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
}

function gfDiv(a, b) {
  if (b === 0) throw new Error("GF(256) 除零");
  if (a === 0) return 0;
  return GF_EXP[(GF_LOG[a] - GF_LOG[b] + 255) % 255];
}

// ============================================================
// 多项式求值 / 拉格朗日插值
// ============================================================
// Horner 法在 GF(256) 上求 f(x)，coeffs[0] 为常数项（秘密字节）
function gfPolyEval(coeffs, x) {
  let acc = 0;
  for (let i = coeffs.length - 1; i >= 0; i--) {
    acc = gfMul(acc, x) ^ coeffs[i];
  }
  return acc & 0xff;
}

// 拉格朗日插值在 x=0 处求常数项。xs/ys 等长（同一字节位置的 k 份点）
function gfLagrangeAt0(xs, ys) {
  let secret = 0;
  for (let i = 0; i < xs.length; i++) {
    let num = 1;
    let den = 1;
    for (let j = 0; j < xs.length; j++) {
      if (j === i) continue;
      // 基多项式在 0 处：Π (0 - x_j) / (x_i - x_j) = Π x_j / (x_i ^ x_j)
      num = gfMul(num, xs[j]);
      den = gfMul(den, xs[i] ^ xs[j]);
    }
    secret ^= gfMul(ys[i], gfDiv(num, den));
  }
  return secret & 0xff;
}

// ============================================================
// 编解码工具
// ============================================================
const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

function byteHex(n) {
  return (n & 0xff).toString(16).padStart(2, "0");
}

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += byteHex(b);
  return s;
}

function hexToBytes(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("分片 hex 长度必须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

// ============================================================
// split（encode 方向）：秘密 → n 份分片，阈值 k
// ============================================================
function shamirSplit(text, p = {}) {
  const secret = te(text);
  if (secret.length === 0) throw new Error("秘密不能为空");
  let n = parseInt(p.n, 10);
  let k = parseInt(p.k, 10);
  if (!Number.isFinite(n)) n = 5;
  if (!Number.isFinite(k)) k = 3;
  if (k < 2) throw new Error("阈值 k 至少为 2");
  if (n < k) throw new Error(`分片数 n(${n}) 必须 ≥ 阈值 k(${k})`);
  if (n > 255) throw new Error("分片数 n 最多 255（GF(256) 上 x 取 1..255）");

  // 为每个 x（1..n）累积各字节值
  const shareBytes = [];
  for (let i = 0; i < n; i++) shareBytes.push(new Uint8Array(secret.length));

  // 逐字节构造多项式并在 x=1..n 求值
  const rnd = new Uint8Array(k - 1);
  for (let bi = 0; bi < secret.length; bi++) {
    const coeffs = new Uint8Array(k);
    coeffs[0] = secret[bi]; // 常数项 = 秘密字节
    crypto.getRandomValues(rnd); // 随机高次系数（信息论安全）
    for (let c = 1; c < k; c++) coeffs[c] = rnd[c - 1];
    for (let x = 1; x <= n; x++) {
      shareBytes[x - 1][bi] = gfPolyEval(coeffs, x);
    }
  }

  const lines = [`# shamir k=${k} n=${n}（任取 ${k} 份分片可还原，少于 ${k} 份无法还原）`];
  for (let x = 1; x <= n; x++) {
    lines.push(`${byteHex(x)}:${bytesToHex(shareBytes[x - 1])}`);
  }
  return lines.join("\n");
}

// ============================================================
// combine（decode 方向）：≥k 份分片 → 还原秘密
// ============================================================
function shamirCombine(text, p = {}) {
  const shares = [];
  const seenX = new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([0-9a-fA-F]{1,2})\s*[:\-]\s*([0-9a-fA-F\s]+)$/);
    if (!m) throw new Error(`分片格式错误（应为 "x:hex"）：${line.slice(0, 40)}`);
    const x = parseInt(m[1], 16);
    if (x === 0) throw new Error("分片 x 不能为 0（0 是秘密位置，不可作为分片坐标）");
    if (seenX.has(x)) throw new Error(`分片 x=${byteHex(x)} 重复`);
    seenX.add(x);
    shares.push({ x, y: hexToBytes(m[2]) });
  }
  if (shares.length < 2) throw new Error("至少需要 2 份分片");
  const len = shares[0].y.length;
  for (const s of shares) {
    if (s.y.length !== len) throw new Error("各分片长度不一致（可能混入了不同秘密的分片）");
  }

  const xs = shares.map((s) => s.x);
  const secret = new Uint8Array(len);
  const ys = new Uint8Array(shares.length);
  for (let bi = 0; bi < len; bi++) {
    for (let i = 0; i < shares.length; i++) ys[i] = shares[i].y[bi];
    secret[bi] = gfLagrangeAt0(xs, ys);
  }
  return td(secret);
}

register({
  id: "shamir",
  cat: "crypto",
  name: "Shamir 秘密共享",
  desc: "Shamir's Secret Sharing（GF(2^8)）：encode 把秘密拆成 n 份分片（阈值 k），decode 用任意 ≥k 份还原。少于 k 份无法得到秘密任何信息（信息论安全）。分片格式：每行 x:hex。",
  params: [
    { key: "n", type: "number", label: "分片总数 n", def: 5, placeholder: "生成的分片份数（2..255）" },
    { key: "k", type: "number", label: "阈值 k", def: 3, placeholder: "还原所需最少份数（≥2 且 ≤n）" },
  ],
  encode: shamirSplit,
  decode: shamirCombine,
});

export { shamirSplit, shamirCombine, gfMul, gfDiv, gfPolyEval, gfLagrangeAt0 };
