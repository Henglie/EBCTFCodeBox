/*
 * rabin.js — Rabin 公钥密码（加密 / 解密）。
 *
 * 算法（Rabin, 1979）：
 *   n = p·q，要求 p ≡ q ≡ 3 (mod 4)（便于闭式开方）。
 *   加密：c = m² mod n （m < n）。
 *   解密：求 c 模 n 的 4 个平方根（CRT 合成）：
 *     mp = c^((p+1)/4) mod p，mq = c^((q+1)/4) mod q
 *     用扩展欧几里得求 yp·p + yq·q = 1
 *     r1 = (yp·p·mq + yq·q·mp) mod n
 *     r2 = n - r1
 *     r3 = (yp·p·mq - yq·q·mp) mod n
 *     r4 = n - r3
 *   Rabin 密文对应 4 个候选明文，需冗余标记消歧。本实现在明文尾部追加
 *   2 字节魔数 0xAB 0xCD，解密时选字节尾部匹配魔数的根即为原文。
 *
 * 红线：算法照 Rabin 原始论文 / 标准 CRT 开方，纯 BigInt 本地，零外发。
 *       core 层仅 import registry.js。随机数（本算法确定性无需随机）。
 *
 * 契约：register({ id:"rabin", cat:"crypto", encode, decode, params })。
 */

import { register } from "./registry.js";

// ---- BigInt 工具 ----
function parseBig(s, label) {
  const t = String(s == null ? "" : s).trim();
  if (!t) throw new Error(`缺少参数 ${label}`);
  try { return BigInt(t); } catch { throw new Error(`参数 ${label} 不是合法整数：${t}`); }
}
function mod(a, m) { const r = a % m; return r < 0n ? r + m : r; }
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
function powMod(base, exp, m) {
  if (m === 1n) return 0n;
  let res = 1n; base = mod(base, m);
  while (exp > 0n) { if (exp & 1n) res = (res * base) % m; exp >>= 1n; base = (base * base) % m; }
  return res;
}

// ---- 字节 / BigInt 互转（big-endian，最小字节数） ----
function bytesToBig(bytes) { let x = 0n; for (const b of bytes) x = (x << 8n) | BigInt(b); return x; }
function bigToBytes(x) {
  if (x === 0n) return new Uint8Array([0]);
  const out = [];
  while (x > 0n) { out.unshift(Number(x & 0xffn)); x >>= 8n; }
  return new Uint8Array(out);
}
function toHex(x) { return "0x" + x.toString(16); }

const MARK = [0xAB, 0xCD]; // 冗余魔数，尾部标记消歧 4 根

// 默认 demo 素数（均为素数且 ≡ 3 mod 4）：
//   p = 2^31-1 = 2147483647（梅森素数 M31）
//   q = 2^61-1 = 2305843009213693951（梅森素数 M61）
const DEMO = {
  p: "2147483647",
  q: "2305843009213693951",
};

/** 求 c 模 n（n=p·q, p≡q≡3 mod4）的 4 个平方根。 */
function rabinRoots(c, p, q) {
  const n = p * q;
  const mp = powMod(mod(c, p), (p + 1n) / 4n, p);
  const mq = powMod(mod(c, q), (q + 1n) / 4n, q);
  const [, yp, yq] = egcd(p, q); // yp·p + yq·q = 1
  const a = mod(yp * p * mq + yq * q * mp, n);
  const b = mod(yp * p * mq - yq * q * mp, n);
  return [a, n - a, b, n - b].map((r) => mod(r, n));
}

function rabinEncode(text, params) {
  const p = parseBig((params && params.p) || DEMO.p, "p");
  const q = parseBig((params && params.q) || DEMO.q, "q");
  if (mod(p, 4n) !== 3n || mod(q, 4n) !== 3n) {
    throw new Error("Rabin 要求 p ≡ q ≡ 3 (mod 4)");
  }
  const n = p * q;
  const inputMode = (params && params.inputMode) || "text";

  let m;
  if (inputMode === "int") {
    m = parseBig(text, "明文整数 m");
    if (m >= n) throw new Error(`明文整数 m 必须 < n（n = ${n}）`);
    const c = powMod(m, 2n, n);
    return [
      "=== Rabin 加密（整数模式）===",
      `p = ${p}`,
      `q = ${q}`,
      `n = p·q = ${n}`,
      `m = ${m}`,
      "",
      `密文 c = m² mod n = ${c}`,
      `c (hex) = ${toHex(c)}`,
    ].join("\n");
  }

  // 文本模式：明文字节 + 魔数 → BigInt
  const bytes = new TextEncoder().encode(String(text == null ? "" : text));
  const withMark = new Uint8Array(bytes.length + MARK.length);
  withMark.set(bytes, 0);
  withMark.set(MARK, bytes.length);
  m = bytesToBig(withMark);
  if (m >= n) throw new Error(`明文过长：m ≥ n。请使用更大的 p·q 或缩短明文（当前 n=${n}）`);
  const c = powMod(m, 2n, n);
  return [
    "=== Rabin 加密（文本模式）===",
    `p = ${p}`,
    `q = ${q}`,
    `n = p·q = ${n}`,
    `明文尾部追加魔数 0xAB 0xCD 以便解密消歧`,
    `m (明文+魔数的整数) = ${m}`,
    "",
    `密文 c = m² mod n = ${c}`,
    `c (hex) = ${toHex(c)}`,
  ].join("\n");
}

function rabinDecode(text, params) {
  const p = parseBig((params && params.p) || DEMO.p, "p");
  const q = parseBig((params && params.q) || DEMO.q, "q");
  if (mod(p, 4n) !== 3n || mod(q, 4n) !== 3n) {
    throw new Error("Rabin 要求 p ≡ q ≡ 3 (mod 4)");
  }
  const n = p * q;
  const c = parseBig(text, "密文 c");
  const inputMode = (params && params.inputMode) || "text";
  const roots = rabinRoots(c, p, q);

  const lines = ["=== Rabin 解密 ===", `p = ${p}`, `q = ${q}`, `n = ${n}`, `密文 c = ${c}`, "", "4 个平方根候选："];
  roots.forEach((r, i) => lines.push(`  根${i + 1} = ${r}  (hex ${toHex(r)})`));
  lines.push("");

  if (inputMode === "int") {
    lines.push("（整数模式：明文即上述 4 根之一，需依业务冗余判定）");
    return lines.join("\n");
  }

  // 文本模式：找尾部匹配魔数的根
  let found = null;
  for (const r of roots) {
    const bs = bigToBytes(r);
    if (bs.length >= MARK.length &&
        bs[bs.length - 2] === MARK[0] && bs[bs.length - 1] === MARK[1]) {
      const plain = bs.slice(0, bs.length - MARK.length);
      try { found = new TextDecoder("utf-8", { fatal: false }).decode(plain); }
      catch { found = null; }
      break;
    }
  }
  lines.push("尾部魔数 0xAB 0xCD 匹配结果：");
  if (found != null) {
    lines.push(`✓ 明文 = ${found}`);
  } else {
    lines.push("✗ 无根匹配魔数（密文非本工具文本模式产物，或参数不符）。可尝试逐根按字节解读。");
    // 兜底：列出每根的可打印解读
    roots.forEach((r, i) => {
      const bs = bigToBytes(r);
      const s = new TextDecoder("utf-8", { fatal: false }).decode(bs);
      lines.push(`  根${i + 1} 文本 = ${JSON.stringify(s)}`);
    });
  }
  return lines.join("\n");
}

register({
  id: "rabin",
  cat: "crypto",
  name: "Rabin 密码",
  desc: "Rabin 公钥密码（p≡q≡3 mod4）：加密 c=m² mod n，解密用 CRT 求 4 个平方根 + 尾部魔数消歧。纯 BigInt 本地计算。",
  params: [
    {
      key: "inputMode", label: "明文形式", type: "select", default: "text",
      options: [
        { value: "text", label: "文本（自动加魔数消歧）" },
        { value: "int", label: "整数 m / c" },
      ],
    },
    { key: "p", label: "素数 p (≡3 mod4)", type: "text", default: DEMO.p, placeholder: "demo: 2147483647" },
    { key: "q", label: "素数 q (≡3 mod4)", type: "text", default: DEMO.q, placeholder: "demo: 2305843009213693951" },
  ],
  encode: rabinEncode,
  decode: rabinDecode,
});

export { rabinRoots, powMod, egcd, mod, bytesToBig, bigToBytes };
