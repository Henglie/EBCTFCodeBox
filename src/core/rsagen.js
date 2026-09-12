/*
 * rsagen.js — RSA 密钥对生成 + DER/PEM 导出（T344 批A1，cat:'modern'）
 *
 * 标准依据（照标准实现，不编造）：
 * - PKCS#1 v2.2 = RFC 8017 (2016-11)
 *   · §A.1.2 RSAPrivateKey ::= SEQUENCE{version, n, e, d, p, q, dp, dq, qinv}
 *   · §A.1.1 RSAPublicKey ::= SEQUENCE{n, e}
 *   · OID rsaEncryption = 1.2.840.113549.1.1.1
 * - PKCS#8 v1.2 = RFC 5208 (2008-05) §5 PrivateKeyInfo
 *   ::= SEQUENCE{version 0, AlgorithmIdentifier, privateKey OCTET STRING(内嵌完整 PKCS#1 DER)}
 * - SPKI = RFC 5280 (2008-05) §4.1 SubjectPublicKeyInfo
 *   ::= SEQUENCE{AlgorithmIdentifier, subjectPublicKey BIT STRING(内嵌 RSAPublicKey DER)}
 * - DER = ITU-T X.690 (02/2021)：TLV 基本编码 §8；DER 限定 §9
 *   · INTEGER 非负且最高位为 1 时加前导 0x00（X.690 §8.3.2）
 *   · 长度：短形式 <128 单字节；长形式 0x80|字节数 后接大端（§8.1.3.4）
 *   · OID 弧值 base-128 编码，除末字节外最高位置 1（§8.19）
 * - PEM 封装 = RFC 7468 §5.2：64 字符折行，"-----BEGIN/END label-----"
 *
 * 素数复用 primeGen.js（generatePrime：最高位/最低位置 1 的随机奇数 +
 * Miller-Rabin；13 个固定小质数 witness，FIPS 186-4 Table C.2，2048 位级
 * 误判概率 < 4^-13 ≈ 1.5e-8，CTF/教学场景足够）。
 *
 * 性能提示：纯 JS BigInt，无 WASM。512 位瞬出；2048 位约 1~4 秒；
 * 4096 位需搜索两个 2048 位素数，数秒到数十秒量级，浏览器内会阻塞主线程，
 * 属预期行为（教学优先；先用小位数验证流程再生成大位数）。
 *
 * 红线：算法层零 UI 依赖（仅 import registry + primeGen），node 可直跑；
 * ecdsa.js 内有另一份私有 derEncodeInt——本文件 DER 实现完全独立、
 * 命名不冲突、互不 import。
 */
import { register } from "./registry.js";
import { generatePrime, isProbablePrime, modPow } from "./primeGen.js";

// ============================================================
// 数论基础：gcd / 扩展欧几里得 / 模逆
// ============================================================

/** 欧几里得 gcd（BigInt，非负输入约定） */
function gcd(a, b) {
  while (b !== 0n) [a, b] = [b, a % b];
  return a < 0n ? -a : a;
}

/**
 * 迭代扩展欧几里得（避免大深度递归）
 * @returns [g, x, y] 满足 a*x + b*y = g = gcd(a,b)
 */
function extGcd(a, b) {
  let x0 = 1n, y0 = 0n, x1 = 0n, y1 = 1n, r0 = a, r1 = b;
  while (r1 !== 0n) {
    const q = r0 / r1;
    [r0, r1] = [r1, r0 - q * r1];
    [x0, x1] = [x1, x0 - q * x1];
    [y0, y1] = [y1, y0 - q * y1];
  }
  return [r0, x0, y0];
}

/** 模逆 a^{-1} mod m（扩展欧几里得；无逆抛错） */
function modInv(a, m) {
  const r = ((a % m) + m) % m; // 规整到 [0,m)
  const [g, x] = extGcd(r, m);
  if (g !== 1n) throw new Error(`${a} 与模数不互素，不存在模逆`);
  return ((x % m) + m) % m;
}

// ============================================================
// DER 编解码（ITU-T X.690）— 纯函数，T350 PEM/JWK 层复用
// ============================================================

/**
 * 非负 BigInt → DER INTEGER 内容字节（最小编码）：
 * 去多余前导 0x00；若最高位为 1 则补一个前导 0x00 表正数（X.690 §8.3.2）。
 * 0 编码为单字节 0x00。
 */
export function bigintToDerBytes(v) {
  if (v < 0n) throw new Error("bigintToDerBytes 仅支持非负整数");
  let hex = v.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const n = hex.length / 2;
  const bytes = new Uint8Array(n);
  for (let i = 0; i < n; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  let s = 0;
  while (s < n - 1 && bytes[s] === 0) s++; // 去多余前导 0，保留至少 1 字节
  let out = bytes.subarray(s);
  if (out[0] & 0x80) {
    const padded = new Uint8Array(out.length + 1);
    padded.set(out, 1);
    out = padded; // 最高位为 1 → 前导 0x00 表正数（X.690 §8.3.2）
  }
  return out;
}

/** DER INTEGER 内容字节 → BigInt（最高位为符号位，X.690 §8.3.2） */
export function derBytesToBigint(bytes) {
  if (bytes.length === 0) throw new Error("空 INTEGER 内容");
  if (bytes[0] & 0x80) {
    // 负数：补码语义，v = bytes - 0x80*256^(len-1) 首字节，其余按无符号
    let v = BigInt(bytes[0] & 0x7f) - 0x80n;
    for (let i = 1; i < bytes.length; i++) v = (v << 8n) | BigInt(bytes[i]);
    return v;
  }
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

/** 长度字节（X.690 §8.1.3：短形式 <128；长形式 0x80|字节数 + 大端） */
function derLengthBytes(len) {
  if (len < 0x80) return Uint8Array.of(len);
  let hex = len.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const n = hex.length / 2;
  const out = new Uint8Array(1 + n);
  out[0] = 0x80 | n;
  for (let i = 0; i < n; i++) out[1 + i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

/**
 * DER 节点（TLV）编码。
 * node：{ tag: number, value?: Uint8Array, children?: node[] }
 * children 存在时（SEQUENCE/SET 等结构化类型）value 由 children 编码拼接。
 * @returns {Uint8Array} 完整 TLV 字节
 */
export function derEncode(node) {
  let body;
  if (Array.isArray(node.children)) {
    const parts = node.children.map(derEncode);
    let total = 0;
    for (const p of parts) total += p.length;
    body = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { body.set(p, o); o += p.length; }
  } else {
    body = node.value || new Uint8Array(0);
  }
  const lb = derLengthBytes(body.length);
  const out = new Uint8Array(1 + lb.length + body.length);
  out[0] = node.tag;
  out.set(lb, 1);
  out.set(body, 1 + lb.length);
  return out;
}

/**
 * 单个 TLV 解析（内部用，off 相对 u8）。
 * @returns { tag, value, children, start, end }（start/end 相对传入数组）
 */
function parseTlv(u8, off) {
  if (off + 2 > u8.length) throw new Error(`DER 解析：偏移 ${off} 起不足 2 字节`);
  const tag = u8[off];
  if ((tag & 0x1f) === 0x1f) throw new Error("DER 解析：多字节 tag 号不支持（X.690 §8.1.2.4）");
  let p = off + 1;
  let len = u8[p];
  if (len & 0x80) {
    if (len === 0x80) throw new Error("DER 解析：不定长禁止（X.690 §9）");
    const n = len & 0x7f;
    if (n > 4) throw new Error(`DER 解析：长度字节过长（${n} 字节）`);
    if (p + 1 + n > u8.length) throw new Error("DER 解析：长度字段被截断");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + u8[p + 1 + i];
    if (n > 1 && u8[p + 1] === 0) throw new Error("DER 解析：长形式长度含前导 0，违反最短编码（X.690 §9）");
    if (len < 0x80) throw new Error("DER 解析：应使用短形式却用长形式长度（X.690 §9）");
    p += 1 + n;
  } else {
    p += 1;
  }
  if (p + len > u8.length) throw new Error(`DER 解析：内容长度 ${len} 越界`);
  const value = u8.slice(p, p + len);
  const node = { tag, value, children: null, start: off, end: p + len };
  if (tag & 0x20) { // 结构化类型（如 SEQUENCE 0x30 / SET 0x31）→ 递归解析子 TLV
    const children = [];
    let q = 0;
    while (q < value.length) {
      const c = parseTlv(value, q);
      children.push(c);
      q = c.end;
    }
    node.children = children;
  }
  return node;
}

/**
 * DER 字节 → 节点树（严格模式：拒绝尾随字节/不定长/非最短长度）。
 * 返回 { tag, value, children, start, end }；结构化类型 children 为数组，
 * 原始类型（INTEGER/OID/BIT STRING/OCTET STRING/NULL）children 为 null、
 * value 为内容字节（BIT STRING 的 value[0] 是 unused-bits 计数，X.690 §8.6.4）。
 */
export function derDecode(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length === 0) throw new Error("DER 解析：空输入");
  const node = parseTlv(u8, 0);
  if (node.end !== u8.length) {
    throw new Error(`DER 解析：根 TLV 结束于 ${node.end}，其后仍有 ${u8.length - node.end} 字节尾随（X.690 §9）`);
  }
  return node;
}

// ---- TLV 构造辅助（配合 derEncode 使用）----

/** INTEGER（tag 0x02）。仅支持非负（本项目场景 n/e/d/p/q 等均为正）。 */
export function derInt(v) {
  return { tag: 0x02, value: bigintToDerBytes(v) };
}
/** SEQUENCE（tag 0x30） */
export function derSeq(...children) {
  return { tag: 0x30, children };
}
/** NULL（tag 0x05，长度 0） */
export function derNull() {
  return { tag: 0x05, value: new Uint8Array(0) };
}
/** OID（tag 0x06）。arcs 如 [1, 2, 840, 113549, 1, 1, 1]（X.690 §8.19 base-128） */
export function derOid(arcs) {
  const body = [];
  const pushBase128 = (v) => {
    const tmp = [Number(v & 0x7fn)];
    v >>= 7n;
    while (v > 0n) { tmp.push(Number(v & 0x7fn) | 0x80); v >>= 7n; }
    for (let i = tmp.length - 1; i >= 0; i--) body.push(tmp[i]);
  };
  pushBase128(40n * BigInt(arcs[0]) + BigInt(arcs[1])); // 首两弧 40*a+b
  for (let i = 2; i < arcs.length; i++) pushBase128(BigInt(arcs[i]));
  return { tag: 0x06, value: Uint8Array.from(body) };
}
/** OCTET STRING（tag 0x04） */
export function derOctetString(bytes) {
  return { tag: 0x04, value: bytes };
}
/** BIT STRING（tag 0x03）：首字节 0x00 = unused bits 数（X.690 §8.6.4） */
export function derBitString(bytes) {
  const v = new Uint8Array(1 + bytes.length);
  v[0] = 0x00;
  v.set(bytes, 1);
  return { tag: 0x03, value: v };
}

// ============================================================
// Base64 / PEM（RFC 7468）
// ============================================================

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** 字节 → Base64（RFC 4648，含标准 padding） */
export function bytesToBase64(u8) {
  let out = "";
  for (let i = 0; i < u8.length; i += 3) {
    const b0 = u8[i], b1 = u8[i + 1], b2 = u8[i + 2];
    out += B64_ALPHABET[b0 >> 2];
    out += B64_ALPHABET[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
    out += b1 === undefined
      ? "="
      : B64_ALPHABET[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
    out += b2 === undefined ? "=" : B64_ALPHABET[b2 & 63];
  }
  return out;
}

/**
 * DER 字节 → PEM 文本（RFC 7468 §5.2）：64 字符折行 + BEGIN/END 标签。
 * label 如 "RSA PRIVATE KEY" / "PRIVATE KEY" / "PUBLIC KEY"。
 */
export function derToPem(label, der) {
  const b64 = bytesToBase64(der);
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

// ============================================================
// RSA 密钥生成（RFC 8017 §3 / FIPS 186-4 B.3.3 思路）
// ============================================================

/** rsaEncryption OID 弧值（RFC 8017 §A.2 / PKCS#1） */
const RSA_OID = [1, 2, 840, 113549, 1, 1, 1];

/**
 * 生成 RSA 密钥对（两素数版）。
 * 步骤（RFC 8017 §3.2 + FIPS 186-4 B.3.3 精神）：
 *  1. p,q 各取 bits/2 位素数（primeGen.generatePrime），要求 p != q；
 *  2. 要求 gcd(e, p-1) = gcd(e, q-1) = 1（等价 e 与 φ(n) 互素），
 *     不满足则整对重生成 p,q；
 *  3. n = p*q，若 n 位长不等于 bits（顶位未撑满）则重生成，保证标称位长；
 *  4. d = e^{-1} mod φ(n)（φ = (p-1)(q-1)，扩展欧几里得）；
 *  5. CRT 参数（RFC 8017 §A.1.2）：dp = d mod (p-1)，dq = d mod (q-1)，
 *     qinv = q^{-1} mod p。
 * 生成后自检：素数复检、e*d ≡ 1 (mod φ)、m^e→^d 往返一次。
 * @param {number} bits 512..4096 偶数（512 仅教学）
 * @param {bigint|string} eValue 公钥指数，十进制
 * @returns {{bits,n,e,d,p,q,dp,dq,qinv}} 全部为 BigInt
 */
export function rsaGenerateKey(bits, eValue = 65537n) {
  if (!Number.isInteger(bits) || bits < 512 || bits > 4096 || bits % 2 !== 0) {
    throw new Error(`密钥位数须为 512..4096 的偶数（收到 ${bits}）`);
  }
  const e = typeof eValue === "bigint" ? eValue : BigInt(String(eValue).replace(/[\s,　_]/g, ""));
  if (e < 3n || e % 2n === 0n) throw new Error("公钥指数 e 须为 >=3 的奇数（常用 3/17/65537）");

  const half = bits / 2;
  let p, q, n, phi, d;
  let guard = 0;
  for (;;) {
    if (++guard > 500) throw new Error("多次尝试未获合格 p,q（极罕见；检查 e 是否过大或非素数）");
    p = generatePrime(half);
    q = generatePrime(half);
    if (p === q) continue;                                    // FIPS 186-4 B.3.3：p != q
    if (gcd(e, p - 1n) !== 1n || gcd(e, q - 1n) !== 1n) continue; // e 与 φ(n) 不互素 → 重生成 p,q
    n = p * q;
    if (n.toString(2).length !== bits) continue;              // 保证 n 恰为标称位长
    phi = (p - 1n) * (q - 1n);
    d = modInv(e, phi);                                       // 此处必有逆
    break;
  }
  const dp = d % (p - 1n);
  const dq = d % (q - 1n);
  const qinv = modInv(q, p);

  // 生成后一致性自检（防御性，正常永远不触发）
  if (!isProbablePrime(p) || !isProbablePrime(q)) throw new Error("内部错误：p/q 素性复检失败");
  if ((e * d) % phi !== 1n) throw new Error("内部错误：e*d ≢ 1 (mod φ)");
  const probe = 0x4242424242424242n % n; // m < n 的固定探针
  if (modPow(modPow(probe, e, n), d, n) !== probe) throw new Error("内部错误：加解密往返自检失败");

  return { bits, n, e, d, p, q, dp, dq, qinv };
}

// ============================================================
// 三种密钥 DER 结构（注释见文件头标准清单）
// ============================================================

/** PKCS#1 RSAPrivateKey DER（RFC 8017 §A.1.2，version=0 两素数） */
export function buildPkcs1PrivateDer(k) {
  return derEncode(derSeq(
    derInt(0n), // version：两素数密钥固定 0
    derInt(k.n), derInt(k.e), derInt(k.d),
    derInt(k.p), derInt(k.q),
    derInt(k.dp), derInt(k.dq), derInt(k.qinv),
  ));
}

/** PKCS#8 PrivateKeyInfo DER（RFC 5208 §5；privateKey 字段内嵌完整 PKCS#1 DER） */
export function buildPkcs8PrivateDer(k) {
  return derEncode(derSeq(
    derInt(0n), // version 0
    derSeq(derOid(RSA_OID), derNull()),       // AlgorithmIdentifier{rsaEncryption, NULL}
    derOctetString(buildPkcs1PrivateDer(k)),  // privateKey：OCTET STRING 包 PKCS#1 DER
  ));
}

/** SPKI SubjectPublicKeyInfo DER（RFC 5280 §4.1；BIT STRING 内嵌 RSAPublicKey SEQUENCE{n,e}） */
export function buildSpkiPublicDer(k) {
  return derEncode(derSeq(
    derSeq(derOid(RSA_OID), derNull()),
    derBitString(derEncode(derSeq(derInt(k.n), derInt(k.e)))),
  ));
}

/** PEM 三格式的标签（RFC 7468 约定的标签字符串） */
const PEM_LABELS = {
  pkcs1: "RSA PRIVATE KEY", // PKCS#1 私钥
  pkcs8: "PRIVATE KEY",     // PKCS#8 私钥
  spki: "PUBLIC KEY",       // SubjectPublicKeyInfo 公钥
};

/**
 * 由 pemType（"pkcs1" | "pkcs8" | "spki"）生成对应 PEM 文本。
 * @returns {{pem: string, label: string, der: Uint8Array, note: string}}
 */
export function keyPairToPem(k, pemType = "pkcs1") {
  const t = PEM_LABELS[pemType] ? pemType : "pkcs1";
  const der =
    t === "pkcs8" ? buildPkcs8PrivateDer(k) :
    t === "spki" ? buildSpkiPublicDer(k) :
    buildPkcs1PrivateDer(k);
  const note = {
    pkcs1: "PKCS#1 RSAPrivateKey（RFC 8017 §A.1.2，含全部 CRT 参数）",
    pkcs8: "PKCS#8 PrivateKeyInfo（RFC 5208，privateKey 字段内嵌 PKCS#1，OpenSSL 默认格式）",
    spki: "SubjectPublicKeyInfo 公钥（RFC 5280 §4.1，只含 n/e，可公开）",
  }[t];
  return { pem: derToPem(PEM_LABELS[t], der), label: PEM_LABELS[t], der, note };
}

// ============================================================
// op 注册
// ============================================================

const RSA_BITS_OPTIONS = [512, 1024, 2048, 3072, 4096].map((v) => ({
  value: String(v),
  label: v <= 512 ? "512 位（已被现实分解，仅教学演示）" : `${v} 位`,
}));

const PEM_TYPE_OPTIONS = [
  { value: "pkcs1", label: "PKCS#1 私钥（RSA PRIVATE KEY，RFC 8017）" },
  { value: "pkcs8", label: "PKCS#8 私钥（PRIVATE KEY，RFC 5208）" },
  { value: "spki", label: "公钥 SPKI（PUBLIC KEY，RFC 5280）" },
];

// T362 产物协议（2026-09-02）：下载文件格式选项——PEM 主交付，DER/JWK 为次级（恒烈拍板，
// 下拉选项走注册表 select 参数即项目原生风格）。JWK 按 RFC 7518 §6.3.1 全 CRT 参数。
const DL_FORMAT_OPTIONS = [
  { value: "pem", label: "仅 PEM（私钥 + 公钥两个 .pem）" },
  { value: "pem+der", label: "PEM + DER（追加两份 .der 二进制）" },
  { value: "pem+jwk", label: "PEM + JWK（追加两份 .jwk，RFC 7517）" },
  { value: "pem+der+jwk", label: "PEM + DER + JWK（全格式）" },
];

function bigintToB64url(v) {
  return bytesToBase64(bigintToDerBytes(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

register({
  id: "rsaGenKeyPair", family: "rsa", familyLabel: "keygen", cat: "asym", name: "RSA 密钥对生成",
  desc: "本地生成 RSA 密钥对（纯 JS BigInt，素数 Miller-Rabin 复用 primeGen），输出十进制 n/e/d/p/q/dp/dq/qinv + PEM（PKCS#1 / PKCS#8 / SPKI 三选一，DER 编码按 ITU-T X.690）。私钥 / 公钥分开下载按钮（PEM 主交付，DER / JWK 次级可选）。512 位已被现实分解仅作教学，实际使用至少 2048 位；2048 位约秒级、4096 位数秒级会阻塞页面，属预期",
  params: [
    { key: "bits", label: "密钥位数", type: "select", default: "2048", options: RSA_BITS_OPTIONS },
    { key: "e", label: "公钥指数 e", type: "text", default: "65537", placeholder: "十进制奇数，常用 3 / 17 / 65537" },
    { key: "pemType", label: "PEM 格式", type: "select", default: "pkcs1", options: PEM_TYPE_OPTIONS },
    { key: "dlFormat", label: "下载文件格式", type: "select", default: "pem", options: DL_FORMAT_OPTIONS },
  ],
  run: (_text, p) => {
    const bitsRaw = String(p?.bits ?? "2048").trim() || "2048";
    const bits = Number(bitsRaw);
    if (!RSA_BITS_OPTIONS.some((o) => o.value === bitsRaw)) {
      throw new Error(`不支持的位数 ${bitsRaw}（可选 512/1024/2048/3072/4096）`);
    }
    const k = rsaGenerateKey(bits, p?.e ?? "65537");
    const { pem, label, note } = keyPairToPem(k, String(p?.pemType ?? "pkcs1"));

    const lines = [
      `RSA-${k.bits} 密钥对（e = ${k.e}）`,
      "生成自检：p/q 素性 / n=p·q / e·d≡1 (mod φ(n)) / 加解密往返 → 全部通过",
      "",
      `n  (modulus 模数)             = ${k.n}`,
      `e  (publicExponent 公钥指数)   = ${k.e}`,
      `d  (privateExponent 私钥指数)  = ${k.d}`,
      `p  (prime1 素数)              = ${k.p}`,
      `q  (prime2 素数)              = ${k.q}`,
      `dp = d mod (p-1) (exponent1)   = ${k.dp}`,
      `dq = d mod (q-1) (exponent2)   = ${k.dq}`,
      `qinv = q^-1 mod p (coefficient) = ${k.qinv}`,
      "",
      `PEM · ${note}`,
      pem,
    ];
    if (k.bits <= 1024) {
      lines.push("", "提示：512/1024 位已被现实攻破（教学演示用），真实场景至少 2048 位。");
    }

    // T362 产物协议（2026-09-02）：私钥 / 公钥分开交付（恒烈指示）——PEM 主按钮，
    // DER / JWK 按 dlFormat 追加。文本区的 PEM 保持所选 pemType 不变。
    const fmtRaw = String(p?.dlFormat ?? "pem");
    const fmt = DL_FORMAT_OPTIONS.some((o) => o.value === fmtRaw) ? fmtRaw : "pem";
    const privType = String(p?.pemType ?? "pkcs1") === "spki" ? "pkcs8" : String(p?.pemType ?? "pkcs1");
    const priv = keyPairToPem(k, privType); // {pem, der}
    const pub = keyPairToPem(k, "spki");
    const files = [
      { name: `rsa_private_${k.bits}.pem`, mime: "application/x-pem-file", bytes: new TextEncoder().encode(priv.pem) },
      { name: `rsa_public_${k.bits}.pem`, mime: "application/x-pem-file", bytes: new TextEncoder().encode(pub.pem) },
    ];
    if (fmt.includes("der")) {
      files.push({ name: `rsa_private_${k.bits}.der`, mime: "application/octet-stream", bytes: priv.der });
      files.push({ name: `rsa_public_${k.bits}.der`, mime: "application/octet-stream", bytes: pub.der });
    }
    if (fmt.includes("jwk")) {
      const privJwk = JSON.stringify({ kty: "RSA", n: bigintToB64url(k.n), e: bigintToB64url(k.e), d: bigintToB64url(k.d), p: bigintToB64url(k.p), q: bigintToB64url(k.q), dp: bigintToB64url(k.dp), dq: bigintToB64url(k.dq), qi: bigintToB64url(k.qinv) }, null, 2);
      const pubJwk = JSON.stringify({ kty: "RSA", n: bigintToB64url(k.n), e: bigintToB64url(k.e) }, null, 2);
      files.push({ name: `rsa_private_${k.bits}.jwk`, mime: "application/jwk+json", bytes: new TextEncoder().encode(privJwk) });
      files.push({ name: `rsa_public_${k.bits}.jwk`, mime: "application/jwk+json", bytes: new TextEncoder().encode(pubJwk) });
    }
    lines.push("", "私钥 / 公钥已分开生成：私钥 ⚠ 敏感请妥善保管，公钥可公开分发。点击下方按钮下载。");
    return { text: lines.join("\n"), files };
  },
});
