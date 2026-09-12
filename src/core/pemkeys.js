/*
 * pemkeys.js — PEM / JWK / DER 密钥格式互转层（T350 批A4，cat:'crypto'）
 *
 * 标准依据（照标准实现，不编造）：
 * - PEM 文法 = RFC 7468 (2015-04)
 *   · §4 文本化封装：-----BEGIN/END label-----；§5.2 64 字符折行
 *   · §6/§13 宽松解析：容忍注脚、多余空白（本文件按"宽松输入"清洗）
 * - DER = ITU-T X.690 (02/2021) TLV 编码
 * - RSA：
 *   · PKCS#1 v2.2 = RFC 8017 §A.1.2 RSAPrivateKey / §A.1.1 RSAPublicKey
 *   · PKCS#8 v1.2 = RFC 5208 §5 PrivateKeyInfo
 *   · SPKI = RFC 5280 §4.1 SubjectPublicKeyInfo
 *   · OID rsaEncryption = 1.2.840.113549.1.1.1
 * - EC：
 *   · SEC 1 v2.0 §C.4 ECPrivateKey ::= SEQUENCE{version 1, d, [0] 参数, [1] 公钥点}
 *   · RFC 5480 §2.1 曲线 OID（§2.2.1 PKCS#8 内嵌 ECPrivateKey 时省略 [0] 参数）
 *   · RFC 5915 (2009-06) 传统 EC 私钥 PEM（EC PRIVATE KEY 标签）的 ASN.1 模板
 *   · 公钥点非压缩 04‖X‖Y（SEC 1 v2 §2.3.3）；压缩 02/03‖X 解压用 p ≡ 3 (mod 4)
 * - JWK = RFC 7517 (2015-05) / RFC 7518 §6：
 *   · §6.3 RSA：n/e/d/p/q/dp/dq/qi，base64url 无 padding（RFC 4648 §5），
 *     n/e 为最小字节数（§6.3.1.1），x/y/d 为曲线坐标定长字节（§6.2.1.2）
 *   · §6.2 EC：crv/x/y/d；crv 名 P-256/P-384/P-521（RFC 5480 OID 对应），
 *     secp256k1 的 JWK crv 名 = "secp256k1"（RFC 8812 §3.2）
 * - 曲线域参数/点乘：复用 ecdsa.js CURVES + ecdsaReuseK.js ecMul/ecToAffine
 *   （雅可比坐标标量乘）；modPow 复用 primeGen.js；modInverse 复用 ecdsaReuseK.js
 *
 * 依赖方向：core 内纯函数复用（rsagen/ecdsa/ecdsaReuseK/primeGen），
 * 零 UI 依赖，node 可直跑。DER 编解码全走 rsagen.js 导出，不另造轮子。
 */
import { register } from "./registry.js";
import {
  derEncode, derDecode, derInt, derSeq, derOid, derOctetString, derBitString,
  derBytesToBigint, bytesToBase64, derToPem,
  buildPkcs1PrivateDer, buildPkcs8PrivateDer, buildSpkiPublicDer,
} from "./rsagen.js";
import { ecMul, ecToAffine, modInverse } from "./ecdsaReuseK.js";
import { CURVES } from "./ecdsa.js";
import { modPow } from "./primeGen.js";

// ============================================================
// 基础工具：hex / base64 / base64url
// ============================================================

/** 字节 → 连续小写 hex */
function bytesToHex(u8) {
  let s = "";
  for (const b of u8) s += b.toString(16).padStart(2, "0");
  return s;
}

/** hex（宽松：容忍空白/0x 前缀/井号前缀）→ 字节；奇数长度报错 */
function hexToBytes(hex) {
  const t = String(hex).trim().replace(/^(0x|0X|#)/, "").replace(/\s+/g, "");
  if (!t) throw new Error("hex 输入为空");
  if (!/^[0-9a-fA-F]+$/.test(t)) throw new Error("hex 输入含非十六进制字符");
  if (t.length % 2 !== 0) throw new Error(`hex 长度 ${t.length} 为奇数，无法按字节切分`);
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = (() => {
  const m = Object.create(null);
  for (let i = 0; i < B64_ALPHABET.length; i++) m[B64_ALPHABET[i]] = i;
  return m;
})();

/**
 * Base64（RFC 4648 §4）解码。宽松：容忍空白；兼容 URL 安全字母表（-/_）；
 * 允许省略尾 padding，但长度 %4==1 或含非法字符/夹在中间的 = 报错。
 */
function base64Decode(s) {
  const t = String(s).replace(/\s+/g, "");
  if (!t) throw new Error("base64 输入为空");
  const eq = t.indexOf("=");
  if (eq >= 0 && !/^=+$/.test(t.slice(eq))) {
    throw new Error("base64 非法：= 之后仍有数据（padding 只能在末尾）");
  }
  const core = t.replace(/=+$/, "");
  for (const ch of core) {
    const c = ch === "-" ? "+" : ch === "_" ? "/" : ch;
    if (B64_INDEX[c] === undefined) {
      throw new Error(`base64 非法字符：${JSON.stringify(ch)}`);
    }
  }
  if (core.length % 4 === 1) {
    throw new Error(`base64 长度非法：去掉 padding 后 ${core.length} 字符（mod 4 = 1，不足一个完整字节组）`);
  }
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of core) {
    const c = ch === "-" ? "+" : ch === "_" ? "/" : ch;
    buf = (buf << 6) | B64_INDEX[c];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  return Uint8Array.from(out);
}

/** 字节 → base64url（RFC 4648 §5，无 padding，JWK 用，RFC 7515 §2） */
function bytesToB64url(u8) {
  return bytesToBase64(u8).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 非负 BigInt → 最小无符号大端字节（去前导 0，至少 1 字节；JWK n/e 用，RFC 7518 §6.3.1.1） */
function bigintToMinBytes(v) {
  if (v < 0n) throw new Error("bigintToMinBytes 仅支持非负整数");
  let h = v.toString(16);
  if (h.length % 2) h = "0" + h;
  const t = h.replace(/^(00)+/, "") || "00";
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}

/** 非负 BigInt → 定长字节（左补零；超长报错；JWK x/y/d 与 EC 点坐标用） */
function padBytes(v, len, what) {
  const b = bigintToMinBytes(v);
  if (b.length > len) throw new Error(`${what} 编码超长（需 ≤ ${len} 字节，实际 ${b.length}）`);
  const out = new Uint8Array(len);
  out.set(b, len - b.length);
  return out;
}

/** JWK 数值字段（base64url）→ BigInt；非法字符/空值给中文报错 */
function bigintFromJwkField(jwk, field) {
  const raw = jwk[field];
  if (raw == null || String(raw).length === 0) return null;
  const t = String(raw).replace(/\s+/g, "").replace(/=+$/, "");
  const bytes = base64Decode(t);
  if (bytes.length === 0) return 0n;
  return BigInt("0x" + bytesToHex(bytes));
}

/** BigInt → JWK 数值字段（base64url 无 padding，最小/定长由调用方决定先转字节） */
const jwkFieldFromBytes = bytesToB64url;

// ============================================================
// OID：内容字节 ↔ 点分十进制（X.690 §8.19 base-128）
// ============================================================

/** OID 内容字节 → "1.2.840.…" 字符串（截断的 base-128 序列报错） */
function oidString(u8) {
  if (u8.length === 0) throw new Error("OID 内容为空");
  const vals = [];
  let v = 0n, pending = false;
  for (const b of u8) {
    v = (v << 7n) | BigInt(b & 0x7f);
    pending = true;
    if (!(b & 0x80)) { vals.push(v); v = 0n; pending = false; }
  }
  if (pending) throw new Error("OID 编码非法：base-128 序列未终止（末字节最高位仍为 1，数据被截断）");
  if (vals.length < 2) throw new Error("OID 编码非法：内容不足两弧");
  const first = vals[0]; // X.680 §32: 首值 = 40*arc1 + arc2（arc1<2 时；2.x 弧 ≥80）
  const a1 = first < 80n ? Number(first / 40n) : 2;
  const a2 = Number(first < 80n ? first % 40n : first - 80n);
  return [a1, a2, ...vals.slice(1).map(Number)].join(".");
}

// ============================================================
// OID 常量表
// ============================================================

/** RSA OID（RFC 8017 §A.2 / PKCS#1） */
const OID_RSA = "1.2.840.113549.1.1.1";
const OID_RSA_ARCS = [1, 2, 840, 113549, 1, 1, 1];

/** id-ecPublicKey（RFC 5480 §2.1.1 AlgorithmIdentifier） */
const OID_EC_PUBLIC = "1.2.840.10045.2.1";
const OID_EC_PUBLIC_ARCS = [1, 2, 840, 10045, 2, 1];

/**
 * EC 曲线 OID ↔ JWK crv 名 ↔ ecdsa.js CURVES 内部 key
 * - P-256/P-384/P-521 OID：RFC 5480 §2.1.1/§2.1.2/§2.1.3
 * - secp256k1 OID 1.3.132.0.10（SEC 2 v2 §2.4.1）；JWK crv 名 RFC 8812 §3.2
 */
const EC_CURVES = {
  "1.2.840.10045.3.1.7": { key: "p256", crv: "P-256", arcs: [1, 2, 840, 10045, 3, 1, 7], std: "RFC 5480 §2.1.1" },
  "1.3.132.0.34": { key: "p384", crv: "P-384", arcs: [1, 3, 132, 0, 34], std: "RFC 5480 §2.1.2" },
  "1.3.132.0.35": { key: "p521", crv: "P-521", arcs: [1, 3, 132, 0, 35], std: "RFC 5480 §2.1.3" },
  "1.3.132.0.10": { key: "secp256k1", crv: "secp256k1", arcs: [1, 3, 132, 0, 10], std: "RFC 8812 §3.2" },
};

/** JWK crv → 曲线条目 */
const CRV_TO_CURVE = {};
for (const c of Object.values(EC_CURVES)) CRV_TO_CURVE[c.crv] = c;

/** 曲线坐标字节长 = ceil(bitlen(p)/8) */
function curveByteLen(curveKey) {
  const c = CURVES[curveKey];
  if (!c) throw new Error(`内部错误：未知曲线 key ${curveKey}`);
  return (c.p.toString(16).length + 1) >> 1;
}

// ============================================================
// PEM 解析（RFC 7468 §6 宽松：剥空白与注脚行）
// ============================================================

/**
 * 从文本中提取 PEM 块（取第一个非 EC PARAMETERS 的块）。
 * 宽松清洗：删除所有空白；含 ":" 的行视为注脚丢弃（RFC 7468 §13 之外
 * 的数据行不含冒号——base64 字母表无冒号，注脚格式 "Key: value"）。
 * @returns {{label, b64, der: Uint8Array, skipped: string[]}}
 */
function parsePem(text) {
  const src = String(text);
  const re = /-----BEGIN ([A-Za-z0-9 ]+)-----([\s\S]*?)-----END ([A-Za-z0-9 ]+)-----/g;
  let m, picked = null;
  const skipped = [];
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== m[3]) {
      throw new Error(`PEM 标签不匹配：BEGIN ${m[1]} 对 END ${m[3]}（RFC 7468 §4 要求成对）`);
    }
    if (m[1] === "EC PARAMETERS") { skipped.push(m[1]); continue; } // openssl 传统 EC 输出的参数块，跳过
    picked = m;
    break;
  }
  if (!picked) {
    if (skipped.length && !/BEGIN (?!EC PARAMETERS)/.test(src)) {
      throw new Error("只找到 EC PARAMETERS 参数块，缺少密钥本体块");
    }
    throw new Error("未找到 PEM 封装（需 -----BEGIN xxx----- 与 -----END xxx----- 成对出现）");
  }
  const label = picked[1];
  const lines = picked[2].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const dropped = lines.filter((l) => l.includes(":"));
  const body = lines.filter((l) => !l.includes(":")).join("");
  const der = base64Decode(body);
  return { label, b64: body, der, dropped };
}

// ============================================================
// EC 点：解压 / 非压缩字节 / d·G
// ============================================================

/** 曲线上点 (x,y) → 非压缩 04‖X‖Y 定长字节（SEC 1 v2 §2.3.3） */
function uncompressedPointBytes(x, y, curveKey) {
  const bl = curveByteLen(curveKey);
  const out = new Uint8Array(1 + 2 * bl);
  out[0] = 0x04;
  out.set(padBytes(x, bl, "x 坐标"), 1);
  out.set(padBytes(y, bl, "y 坐标"), 1 + bl);
  return out;
}

/** 压缩点 02/03‖X 解压：p ≡ 3 (mod 4) → y = (x³+ax+b)^((p+1)/4)（SEC 1 v2 §2.3.4） */
function decompressPointBytes(bytes, curveKey) {
  const c = CURVES[curveKey];
  const bl = curveByteLen(curveKey);
  const x = BigInt("0x" + bytesToHex(bytes.subarray(1)));
  if (x >= c.p) throw new Error("压缩公钥 x 坐标超出域范围（≥p）");
  const y2 = (((x * x * x + c.a * x + c.b) % c.p) + c.p) % c.p;
  let y = modPow(y2, (c.p + 1n) / 4n, c.p);
  if ((((y * y) % c.p) + c.p) % c.p !== y2) throw new Error("压缩公钥不在曲线上（x 无平方根）");
  const odd = bytes[0] & 1;
  if (Number(y & 1n) !== odd) y = c.p - y;
  return [x, y];
}

/** SPKI BIT STRING 内容 → 点 [x,y]：04‖X‖Y 或 02/03‖X */
function parseEcPointFromBitString(bytes, curveKey) {
  const bl = curveByteLen(curveKey);
  if (bytes.length === 1 + 2 * bl && bytes[0] === 0x04) {
    return [
      BigInt("0x" + bytesToHex(bytes.subarray(1, 1 + bl))),
      BigInt("0x" + bytesToHex(bytes.subarray(1 + bl))),
    ];
  }
  if (bytes.length === 1 + bl && (bytes[0] === 0x02 || bytes[0] === 0x03)) {
    return decompressPointBytes(bytes, curveKey);
  }
  throw new Error(`EC 公钥点字节长度不符：需 04‖X‖Y（${1 + 2 * bl} 字节）或压缩 02/03‖X（${1 + bl} 字节），收到 ${bytes.length} 字节`);
}

/** d·G → 公钥点 [x,y]（复用 ecdsaReuseK.js 雅可比坐标点乘 + 仿射化） */
function ecPublicFromPrivate(d, curveKey) {
  const c = CURVES[curveKey];
  if (d <= 0n || d >= c.n) throw new Error(`EC 私钥标量 d 越界（须 1 ≤ d < n）`);
  const pt = ecToAffine(ecMul(d, c.Gx, c.Gy, c.a, c.p), c.p);
  if (!pt) throw new Error("d·G 得到无穷远点（不可能，请报告）");
  return pt;
}

// ============================================================
// 统一密钥中间表示
//   RSA: {kty:"RSA", n,e, d?,p?,q?,dp?,dq?,qinv?, src...}
//   EC : {kty:"EC", curve(表项), d?, x?, y?, src...}
// ============================================================

/** 校验 DER 节点是期望 tag（结构化/原始均可），否则中文报错 */
function expect(node, tag, what) {
  if (!node || node.tag !== tag) {
    throw new Error(`DER 结构非法：期望 ${what}（tag 0x${tag.toString(16)}），实际 ${
      node ? `tag 0x${node.tag.toString(16)}` : "缺失"}`);
  }
}

/** PKCS#1 RSAPrivateKey（RFC 8017 §A.1.2）SEQUENCE → 参数 */
function parseRsaPkcs1Private(seq) {
  expect(seq, 0x30, "RSAPrivateKey SEQUENCE");
  const ch = seq.children;
  if (ch.length < 9 || ch.length % 3 !== 0) {
    throw new Error(`PKCS#1 RSAPrivateKey 字段数不符：两素数版需 9 个，多素数版需 9+3k 个，实际 ${ch.length}`);
  }
  const ver = derBytesToBigint(ch[0].value);
  if (ch[0].tag !== 0x02) throw new Error("PKCS#1 RSAPrivateKey 首字段应为 INTEGER(version)");
  if (ver !== 0n) {
    throw new Error(`PKCS#1 RSAPrivateKey version=${ver}（多素数密钥不在此工具支持范围，仅支持 version 0 两素数）`);
  }
  for (let i = 1; i < 9; i++) expect(ch[i], 0x02, `RSAPrivateKey 字段 ${i} INTEGER`);
  return {
    n: derBytesToBigint(ch[1].value), e: derBytesToBigint(ch[2].value), d: derBytesToBigint(ch[3].value),
    p: derBytesToBigint(ch[4].value), q: derBytesToBigint(ch[5].value),
    dp: derBytesToBigint(ch[6].value), dq: derBytesToBigint(ch[7].value), qinv: derBytesToBigint(ch[8].value),
  };
}

/** SPKI BIT STRING 内 RSAPublicKey（RFC 8017 §A.1.1）→ {n,e} */
function parseRsaPublicKey(bitBytes) {
  const inner = derDecode(bitBytes);
  expect(inner, 0x30, "RSAPublicKey SEQUENCE");
  if (inner.children.length !== 2) throw new Error(`RSAPublicKey 应为 SEQUENCE{n,e} 两个 INTEGER，实际 ${inner.children.length} 个`);
  expect(inner.children[0], 0x02, "RSAPublicKey n INTEGER");
  expect(inner.children[1], 0x02, "RSAPublicKey e INTEGER");
  return { n: derBytesToBigint(inner.children[0].value), e: derBytesToBigint(inner.children[1].value) };
}

/**
 * SEC 1 v2 §C.4 ECPrivateKey SEQUENCE → {d, curveOid?, x?, y?}
 * 结构：SEQ{INTEGER 1, OCTET STRING d, [0](0xA0) OID 曲线?, [1](0xA1) BIT STRING 公钥?}
 */
function parseEcSec1Private(seq) {
  expect(seq, 0x30, "ECPrivateKey SEQUENCE");
  const ch = seq.children;
  if (ch.length < 2) throw new Error("ECPrivateKey 字段不足（至少 version + privateKey）");
  if (ch[0].tag !== 0x02 || derBytesToBigint(ch[0].value) !== 1n) {
    throw new Error("ECPrivateKey version 应为 1（SEC 1 v2 §C.4）");
  }
  expect(ch[1], 0x04, "ECPrivateKey privateKey OCTET STRING");
  // 注意：privateKey 是 OCTET STRING（无符号字节串，SEC 1 v2 §C.4），不能按 INTEGER
  // 补码语义解（首字节 ≥0x80 会被当负数），按大端无符号转 BigInt
  if (ch[1].value.length === 0) throw new Error("ECPrivateKey privateKey 为空");
  const out = { d: BigInt("0x" + bytesToHex(ch[1].value)) };
  for (let i = 2; i < ch.length; i++) {
    const c = ch[i];
    if (c.tag === 0xA0) { // [0] 曲线参数（namedCurve OID）
      const oidNode = c.children && c.children[0];
      expect(oidNode, 0x06, "[0] 曲线 OID");
      out.curveOid = oidString(oidNode.value);
    } else if (c.tag === 0xA1) { // [1] 公钥点 BIT STRING
      const bs = c.children && c.children[0];
      expect(bs, 0x03, "[1] 公钥 BIT STRING");
      if (bs.value[0] !== 0) throw new Error("ECPrivateKey [1] 公钥 BIT STRING unused-bits 非 0（仅支持整字节）");
      out.pubBytes = bs.value.subarray(1);
    } else if (c.tag === 0x02 || c.tag === 0x04) {
      throw new Error(`ECPrivateKey 字段 ${i}（tag 0x${c.tag.toString(16)}）多余，可能不是 EC 私钥结构`);
    }
  }
  return out;
}

/**
 * 任意密钥 DER → 统一中间表示。判别规则：
 * - 首子节点 SEQUENCE → SPKI 公钥（RFC 5280 §4.1）
 * - INTEGER 0 + SEQUENCE(AlgId) + OCTET STRING → PKCS#8 私钥（RFC 5208 §5）
 * - INTEGER 0 + INTEGER → PKCS#1 RSA 私钥（RFC 8017 §A.1.2）
 * - INTEGER 1 + OCTET STRING → SEC1 EC 私钥（SEC 1 v2 §C.4）
 */
function parseKeyDer(der) {
  const root = derDecode(der);
  expect(root, 0x30, "顶层 SEQUENCE");
  const ch = root.children;
  if (ch.length === 0) throw new Error("顶层 SEQUENCE 为空，不是密钥结构");

  if (ch[0].tag === 0x30) { // SPKI
    if (ch.length !== 2) throw new Error(`SubjectPublicKeyInfo 应为 SEQUENCE{AlgorithmIdentifier, BIT STRING}，实际 ${ch.length} 个子节点`);
    const algOidNode = ch[0].children && ch[0].children[0];
    expect(algOidNode, 0x06, "AlgorithmIdentifier 算法 OID");
    const algOid = oidString(algOidNode.value);
    expect(ch[1], 0x03, "subjectPublicKey BIT STRING");
    if (ch[1].value[0] !== 0) throw new Error("SPKI BIT STRING unused-bits 非 0（仅支持整字节）");
    const bitBytes = ch[1].value.subarray(1);
    if (algOid === OID_RSA) {
      const { n, e } = parseRsaPublicKey(bitBytes);
      return { kty: "RSA", n, e, srcKind: "spki", srcLabel: "PUBLIC KEY", srcAlg: `rsaEncryption ${OID_RSA}` };
    }
    if (algOid === OID_EC_PUBLIC) {
      if (ch[0].children.length < 2 || ch[0].children[1].tag !== 0x06) {
        throw new Error("EC SPKI 缺曲线 OID（RFC 5480 §2.1.1 要求 AlgorithmIdentifier 第二元素为 namedCurve）");
      }
      const curveOid = oidString(ch[0].children[1].value);
      const curve = EC_CURVES[curveOid];
      if (!curve) throw new Error(`不支持的曲线 OID ${curveOid}（支持 P-256 / P-384 / P-521 / secp256k1）`);
      const [x, y] = parseEcPointFromBitString(bitBytes, curve.key);
      return { kty: "EC", curve, d: null, x, y, srcKind: "spki", srcLabel: "PUBLIC KEY", srcAlg: `id-ecPublicKey ${OID_EC_PUBLIC}` };
    }
    throw new Error(`不支持的算法 OID ${algOid}（支持 rsaEncryption / id-ecPublicKey；Ed25519 等不在本工具范围）`);
  }

  if (ch[0].tag === 0x02) { // 私钥三兄弟
    const ver = derBytesToBigint(ch[0].value);
    if (ver === 0n && ch.length >= 3 && ch[1].tag === 0x30 && ch[2].tag === 0x04) {
      // PKCS#8 PrivateKeyInfo（RFC 5208 §5）
      const algOidNode = ch[1].children && ch[1].children[0];
      expect(algOidNode, 0x06, "PKCS#8 AlgorithmIdentifier 算法 OID");
      const algOid = oidString(algOidNode.value);
      const innerDer = ch[2].value;
      if (algOid === OID_RSA) {
        const rsa = parseRsaPkcs1Private(derDecode(innerDer));
        return { kty: "RSA", ...rsa, srcKind: "pkcs8", srcLabel: "PRIVATE KEY", srcAlg: `rsaEncryption ${OID_RSA}` };
      }
      if (algOid === OID_EC_PUBLIC) {
        if (ch[1].children.length < 2 || ch[1].children[1].tag !== 0x06) {
          throw new Error("EC PKCS#8 缺曲线 OID（RFC 5480 §2.1.1）");
        }
        const curveOid = oidString(ch[1].children[1].value);
        const curve = EC_CURVES[curveOid];
        if (!curve) throw new Error(`不支持的曲线 OID ${curveOid}（支持 P-256 / P-384 / P-521 / secp256k1）`);
        const sec1 = parseEcSec1Private(derDecode(innerDer));
        if (sec1.curveOid && sec1.curveOid !== curveOid) {
          throw new Error(`曲线不一致：外层 AlgId=${curveOid}，内嵌 [0]=${sec1.curveOid}`);
        }
        let x = null, y = null;
        if (sec1.pubBytes) [x, y] = parseEcPointFromBitString(sec1.pubBytes, curve.key);
        else [x, y] = ecPublicFromPrivate(sec1.d, curve.key); // 缺 [1] 公钥 → 现算 d·G
        return { kty: "EC", curve, d: sec1.d, x, y, srcKind: "pkcs8", srcLabel: "PRIVATE KEY", srcAlg: `id-ecPublicKey ${OID_EC_PUBLIC}` };
      }
      throw new Error(`不支持的算法 OID ${algOid}（PKCS#8 内只识别 rsaEncryption / id-ecPublicKey；Ed25519/DSA 等不支持）`);
    }
    if (ver === 0n && ch[1].tag === 0x02) { // PKCS#1 RSA 私钥
      const rsa = parseRsaPkcs1Private(root);
      return { kty: "RSA", ...rsa, srcKind: "pkcs1", srcLabel: "RSA PRIVATE KEY", srcAlg: `rsaEncryption ${OID_RSA}` };
    }
    if (ver === 1n && ch[1].tag === 0x04) { // SEC1 EC 私钥（RFC 5915）
      const sec1 = parseEcSec1Private(root);
      if (!sec1.curveOid) {
        throw new Error("EC 传统私钥（SEC 1）缺少 [0] 曲线 OID，无法确定曲线（RFC 5915 要求 namedCurve）");
      }
      const curve = EC_CURVES[sec1.curveOid];
      if (!curve) throw new Error(`不支持的曲线 OID ${sec1.curveOid}（支持 P-256 / P-384 / P-521 / secp256k1）`);
      let x, y;
      if (sec1.pubBytes) [x, y] = parseEcPointFromBitString(sec1.pubBytes, curve.key);
      else [x, y] = ecPublicFromPrivate(sec1.d, curve.key);
      return { kty: "EC", curve, d: sec1.d, x, y, srcKind: "sec1", srcLabel: "EC PRIVATE KEY", srcAlg: `id-ecPublicKey ${OID_EC_PUBLIC}` };
    }
    throw new Error(`无法识别的私钥结构（version INTEGER=${ver}，子节点 tag 序列不符 PKCS#1/PKCS#8/SEC1 任何一种）`);
  }

  throw new Error(`DER 首子节点 tag 0x${ch[0].tag.toString(16)} 既非 SEQUENCE(SPKI) 也非 INTEGER(私钥)，不是可识别的密钥结构`);
}

/** 文本输入（PEM 或 JWK JSON）→ 统一中间表示 */
function parseKeyText(text) {
  const t = String(text).trim();
  if (/^[{\[]/.test(t)) {
    let jwk;
    try { jwk = JSON.parse(t); } catch (e) { throw new Error(`JWK 解析失败：不是合法 JSON（${e.message}）`); }
    return jwkToParts(jwk);
  }
  const { label, der } = parsePem(t);
  const key = parseKeyDer(der);
  // 标签与实际结构交叉提示（不拦截，宽松）
  key.pemLabel = label;
  return key;
}

// ============================================================
// JWK → 中间表示（RFC 7518 §6 字段语义）
// ============================================================

function jwkToParts(jwk) {
  if (!jwk || typeof jwk !== "object" || Array.isArray(jwk)) throw new Error("JWK 应为 JSON 对象");
  const kty = jwk.kty;
  if (kty === "RSA") {
    const n = bigintFromJwkField(jwk, "n");
    const e = bigintFromJwkField(jwk, "e");
    if (n == null || e == null) throw new Error("RSA JWK 缺必填字段 n / e（RFC 7518 §6.3.1）");
    const out = { kty: "RSA", n, e, srcKind: "jwk", srcLabel: "JWK", srcAlg: "RSA" };
    for (const [field, prop] of [["d", "d"], ["p", "p"], ["q", "q"], ["dp", "dp"], ["dq", "dq"], ["qi", "qinv"]]) {
      const v = bigintFromJwkField(jwk, field);
      if (v != null) out[prop] = v;
    }
    if (out.d != null && out.p != null && out.q != null) {
      if (out.dp == null) out.dp = out.d % (out.p - 1n);
      if (out.dq == null) out.dq = out.d % (out.q - 1n);
      if (out.qinv == null) out.qinv = ((modInverse(out.q, out.p) % out.p) + out.p) % out.p;
    }
    return out;
  }
  if (kty === "EC") {
    const crv = jwk.crv;
    const curve = CRV_TO_CURVE[crv];
    if (!curve) throw new Error(`不支持的 EC JWK crv=${crv}（支持 P-256 / P-384 / P-521 / secp256k1，RFC 7518 §6.2.1.1 + RFC 8812 §3.2）`);
    const d = bigintFromJwkField(jwk, "d");
    const x = bigintFromJwkField(jwk, "x");
    const y = bigintFromJwkField(jwk, "y");
    if (d == null && (x == null || y == null)) {
      throw new Error("EC JWK 需私钥 d 或公钥 x/y 至少一组（RFC 7518 §6.2.2/§6.2.3）");
    }
    const out = { kty: "EC", curve, d, x, y, srcKind: "jwk", srcLabel: "JWK", srcAlg: `EC ${curve.crv}` };
    if (d != null && (x == null || y == null)) {
      const [px, py] = ecPublicFromPrivate(d, curve.key); // 缺公钥坐标 → 现算 d·G
      if (out.x == null) out.x = px;
      if (out.y == null) out.y = py;
    }
    return out;
  }
  throw new Error(`不支持的 JWK kty=${kty}（本工具支持 RSA / EC，RFC 7517 §6.1；oct/OKP 等不支持）`);
}

// ============================================================
// 中间表示 → JWK 对象（字段顺序 kty,n,e,d,p,q,dp,dq,qi / kty,crv,x,y,d）
// ============================================================

function partsToRsaJwk(k) {
  const jwk = { kty: "RSA" };
  jwk.n = jwkFieldFromBytes(bigintToMinBytes(k.n));
  jwk.e = jwkFieldFromBytes(bigintToMinBytes(k.e));
  if (k.d != null) {
    jwk.d = jwkFieldFromBytes(bigintToMinBytes(k.d));
    if (k.p != null) jwk.p = jwkFieldFromBytes(bigintToMinBytes(k.p));
    if (k.q != null) jwk.q = jwkFieldFromBytes(bigintToMinBytes(k.q));
    if (k.dp != null) jwk.dp = jwkFieldFromBytes(bigintToMinBytes(k.dp));
    if (k.dq != null) jwk.dq = jwkFieldFromBytes(bigintToMinBytes(k.dq));
    if (k.qinv != null) jwk.qi = jwkFieldFromBytes(bigintToMinBytes(k.qinv));
  }
  return jwk;
}

function partsToEcJwk(k) {
  const jwk = { kty: "EC" };
  jwk.crv = k.curve.crv;
  const bl = curveByteLen(k.curve.key);
  jwk.x = jwkFieldFromBytes(padBytes(k.x, bl, "x"));
  jwk.y = jwkFieldFromBytes(padBytes(k.y, bl, "y"));
  if (k.d != null) jwk.d = jwkFieldFromBytes(padBytes(k.d, bl, "d"));
  return jwk;
}

// ============================================================
// EC DER 构造
// ============================================================

/** SEC 1 v2 §C.4 ECPrivateKey DER（参数 namedCurve [0] 与公钥 [1] 可选） */
function buildEcSec1Der(k, { withCurveOid, withPub }) {
  const bl = curveByteLen(k.curve.key);
  // 注意：rsagen.derEncode 只吃节点对象（{tag, children|value}），children 里
  // 必须放节点而非已编码 TLV 字节——TLV 字节二次 encode 会当原始类型产出 0x0000
  const kids = [derInt(1n), derOctetString(padBytes(k.d, bl, "d"))];
  if (withCurveOid) {
    kids.push({ tag: 0xA0, children: [derOid(k.curve.arcs)] }); // [0] namedCurve（RFC 5480 §2.1.1.1）
  }
  if (withPub && k.x != null && k.y != null) {
    kids.push({ tag: 0xA1, children: [derBitString(uncompressedPointBytes(k.x, k.y, k.curve.key))] }); // [1] BIT STRING
  }
  return derEncode({ tag: 0x30, children: kids });
}

/** PKCS#8 PrivateKeyInfo（RFC 5208 §5；曲线 OID 进 AlgId，内嵌 SEC1 省略 [0]，RFC 5480 §2.2.1） */
function buildEcPkcs8PrivateDer(k) {
  return derEncode(derSeq(
    derInt(0n), // version 0
    derSeq(derOid(OID_EC_PUBLIC_ARCS), derOid(k.curve.arcs)), // AlgorithmIdentifier{id-ecPublicKey, namedCurve}
    derOctetString(buildEcSec1Der(k, { withCurveOid: false, withPub: true })),
  ));
}

/** EC SPKI 公钥（RFC 5280 §4.1 + RFC 5480 §2.2；BIT STRING = 04‖X‖Y） */
function buildEcSpkiPublicDer(k) {
  return derEncode(derSeq(
    derSeq(derOid(OID_EC_PUBLIC_ARCS), derOid(k.curve.arcs)),
    derBitString(uncompressedPointBytes(k.x, k.y, k.curve.key)),
  ));
}

// ============================================================
// 输出辅助
// ============================================================

/** 16 字节/行 hexdump（偏移 + 十六进制 + ASCII） */
function hexdump(u8) {
  const lines = [];
  for (let i = 0; i < u8.length; i += 16) {
    const row = u8.subarray(i, i + 16);
    let hex = "", ascii = "";
    for (let j = 0; j < 16; j++) {
      if (j === 8) hex += " ";
      if (j < row.length) {
        const b = row[j];
        hex += b.toString(16).padStart(2, "0") + " ";
        ascii += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
      } else {
        hex += "   ";
      }
    }
    lines.push(`${i.toString(16).padStart(8, "0")}  ${hex} |${ascii}|`);
  }
  return lines.join("\n");
}

const KIND_DESC = {
  pkcs1: "PKCS#1 RSAPrivateKey 私钥（RFC 8017 §A.1.2）",
  pkcs8: "PKCS#8 PrivateKeyInfo 私钥（RFC 5208 §5）",
  sec1: "SEC 1 ECPrivateKey 私钥（RFC 5915，传统 EC 格式）",
  spki: "SubjectPublicKeyInfo 公钥（RFC 5280 §4.1）",
  jwk: "JWK（RFC 7517/7518）",
};

// ============================================================
// T364 产物协议（2026-09-02）：run 返回 { text, files }（main.js renderOutFiles
// 渲染下载按钮）。文件名 <算法>_<内容>_<参数>.<ext>，风格同 T362 的
// rsa_private_2048.pem；text 报告保留完整，产物是增量。
// ============================================================

const encodeText = (s) => new TextEncoder().encode(s);

/** PEM 标签 → 文件名段（RSA PRIVATE KEY → rsa_private_key） */
const labelTag = (label) => String(label).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** JWK crv 名 → 文件名段（P-256 → p256，secp256k1 原样） */
const crvTag = (crv) => String(crv).toLowerCase().replace(/-/g, "");

/** text 末尾产物行（私钥产物附 ⚠ 敏感提示） */
function artifactLine(files, sensitive) {
  if (!files.length) return [];
  return ["", `产物：${files.length} 个文件可下载（${files.map((f) => f.name).join("、")}）${sensitive ? "——含私钥 ⚠ 敏感请妥善保管" : ""}`];
}

// ============================================================
// op 注册
// ============================================================

register({
  id: "pemToHex", cat: "asym", name: "PEM → DER",
  desc: "PEM（任意 BEGIN/END 标签）提取 DER 原始字节：base64 解码 + RFC 7468 §6 宽松清洗（剥空白、丢注脚行、跳过 EC PARAMETERS 参数块）。输出 DER hex 或 16 字节 hexdump。对拍可用 openssl asn1parse / xxd -r -p。附带规范 base64 与识别出的标签。不解析 DER 结构（解析见 PEM→JWK）",
  params: [
    { key: "output", label: "输出格式", type: "select", default: "hex", options: [
      { value: "hex", label: "DER hex 连续串" },
      { value: "dump", label: "hexdump（偏移+hex+ASCII）" },
    ] },
  ],
  run: (text, p = {}) => {
    const { label, der, dropped } = parsePem(text);
    const lines = [];
    lines.push(`PEM 标签：${label}`);
    if (dropped.length) lines.push(`已丢弃注脚行 ${dropped.length} 行（RFC 7468 §13 之外的注脚按宽松规则清洗）`);
    lines.push(`DER 字节数：${der.length}（0x${der.length.toString(16)}）`);
    lines.push("");
    if (String(p?.output ?? "hex") === "dump") {
      lines.push(hexdump(der));
    } else {
      lines.push(bytesToHex(der));
    }
    lines.push("");
    lines.push(`规范 base64：${bytesToBase64(der)}`);
    // T364：DER 原始字节出 .der 产物（hex 报告保留文本）
    const files = [{ name: `${labelTag(label)}.der`, mime: "application/octet-stream", bytes: der }];
    lines.push(...artifactLine(files, /PRIVATE KEY/.test(label)));
    return { text: lines.join("\n"), files };
  },
});

register({
  id: "hexToPem", cat: "asym", name: "DER → PEM",
  desc: "DER（hex 或 base64）封装为 PEM：RFC 7468 §5.2 格式，64 字符折行。标签可选 RSA PRIVATE KEY / PRIVATE KEY / PUBLIC KEY / EC PRIVATE KEY / CERTIFICATE 或自定义。hex/base64 自动判别（auto 下全 hex 字符按 hex 处理）。附带尝试 DER 顶层解析提示（不强制合法 DER）",
  params: [
    { key: "input", label: "输入编码", type: "select", default: "auto", options: [
      { value: "auto", label: "自动判别（hex 优先）" },
      { value: "hex", label: "hex" },
      { value: "base64", label: "base64" },
    ] },
    { key: "label", label: "PEM 标签", type: "select", default: "PUBLIC KEY", options: [
      { value: "RSA PRIVATE KEY", label: "RSA PRIVATE KEY（PKCS#1 私钥）" },
      { value: "PRIVATE KEY", label: "PRIVATE KEY（PKCS#8 私钥）" },
      { value: "PUBLIC KEY", label: "PUBLIC KEY（SPKI 公钥）" },
      { value: "EC PRIVATE KEY", label: "EC PRIVATE KEY（SEC 1 传统私钥）" },
      { value: "CERTIFICATE", label: "CERTIFICATE（X.509 证书）" },
      { value: "custom", label: "自定义（填下一栏）" },
    ] },
    { key: "customLabel", label: "自定义标签", type: "text", default: "", placeholder: "仅 label 选自定义时生效，如 CERTIFICATE REQUEST" },
  ],
  run: (text, p = {}) => {
    const raw = String(text).replace(/\s+/g, "");
    if (!raw) throw new Error("输入为空");
    let der;
    const mode = String(p?.input ?? "auto");
    if (mode === "hex" || (mode === "auto" && /^[0-9a-fA-F]+$/.test(raw) && raw.length % 2 === 0)) {
      der = hexToBytes(raw);
    } else if (mode === "base64" || (mode === "auto" && /^[A-Za-z0-9+/_=-]+$/.test(raw))) {
      der = base64Decode(raw);
    } else {
      throw new Error("输入既非合法 hex 也非合法 base64（hex 需全部十六进制字符且长度为偶数）");
    }
    let label = String(p?.label ?? "PUBLIC KEY");
    if (label === "custom") {
      label = String(p?.customLabel ?? "").trim().toUpperCase();
      if (!/^[A-Z0-9 ]{1,64}$/.test(label)) {
        throw new Error(`自定义标签非法：仅大写字母/数字/空格，长度 1-64（收到 ${JSON.stringify(label)}）`);
      }
    }
    let note = "";
    try {
      const root = derDecode(der);
      if (root.tag !== 0x30) note = `注意：顶层 tag 0x${root.tag.toString(16)} 不是 SEQUENCE，可能不是标准 DER 结构`;
    } catch (e) {
      note = `注意：DER 严格解析未通过（${e.message}）——本工具只按给定标签封装，不校验内容`;
    }
    const lines = [`PEM 标签：${label}`, `DER 字节数：${der.length}`, ""];
    const pem = derToPem(label, der);
    lines.push(pem);
    if (note) lines.push("", note);
    // T364：PEM 结果出 .pem 产物（文本报告保留）
    const files = [{ name: `${labelTag(label)}.pem`, mime: "application/x-pem-file", bytes: encodeText(pem + "\n") }];
    lines.push(...artifactLine(files, /PRIVATE KEY/.test(label)));
    return { text: lines.join("\n"), files };
  },
});

register({
  id: "pemToJwk", cat: "asym", name: "PEM → JWK",
  desc: "PEM 私钥/公钥 → JWK JSON（RFC 7517/7518）。RSA：PKCS#1（RFC 8017 §A.1.2）/ PKCS#8（RFC 5208）/ SPKI（RFC 5280）→ n,e,d,p,q,dp,dq,qi；EC：SEC 1（RFC 5915）/ PKCS#8 / SPKI → crv,x,y,d，曲线 OID 映射 P-256/P-384/P-521（RFC 5480）+ secp256k1（RFC 8812 §3.2）。字段 base64url 无 padding（RFC 4648 §5）；缺公钥坐标时现算 d·G。附 n 位长与 x/y hex 行便于对拍 openssl -text",
  params: [],
  run: (text) => {
    const k = parseKeyText(text);
    const lines = [];
    lines.push(`输入解析：${k.srcKind in KIND_DESC ? KIND_DESC[k.srcKind] : k.srcKind} · ${k.srcAlg}`);
    if (k.pemLabel && k.pemLabel !== k.srcLabel) {
      lines.push(`提示：PEM 标签 "${k.pemLabel}" 与解析出的实际结构 "${k.srcLabel}" 不一致，已按实际结构处理`);
    }
    lines.push("");
    const jwk = k.kty === "RSA" ? partsToRsaJwk(k) : partsToEcJwk(k);
    const jwkJson = JSON.stringify(jwk, null, 2);
    lines.push(jwkJson);
    lines.push("");
    if (k.kty === "RSA") {
      lines.push(`n 位长 = ${k.n.toString(2).length}`);
      if (k.p != null && k.q != null) {
        lines.push(`自检 n = p·q → ${k.n === k.p * k.q ? "通过" : `失败（p·q ≠ n）`}`);
      }
      lines.push(`n hex（对拍 openssl rsa -noout -modulus）= ${bytesToHex(bigintToMinBytes(k.n))}`);
    } else {
      const bl = curveByteLen(k.curve.key);
      lines.push(`曲线 ${k.curve.crv}（${k.curve.std}），坐标字节长 ${bl}`);
      if (k.d != null) {
        const [px, py] = ecPublicFromPrivate(k.d, k.curve.key);
        lines.push(`自检 d·G = (x,y) → ${px === k.x && py === k.y ? "与携带公钥一致" : "不一致（密钥数据有误）"}`);
      }
      lines.push(`x hex = ${bytesToHex(padBytes(k.x, bl, "x"))}`);
      lines.push(`y hex = ${bytesToHex(padBytes(k.y, bl, "y"))}`);
    }
    lines.push("字段编码：RFC 7518 §6，base64url 无 padding（RFC 4648 §5）");
    // T364：JWK JSON 出 .jwk 产物（参数 = RSA 位长 / EC 曲线名）
    const isPrivJwk = k.d != null;
    const tag = k.kty === "RSA" ? `${k.n.toString(2).length}` : crvTag(k.curve.crv);
    const files = [{
      name: `${k.kty === "RSA" ? "rsa" : "ec"}_${isPrivJwk ? "private" : "public"}_${tag}.jwk`,
      mime: "application/jwk+json", bytes: encodeText(jwkJson + "\n"),
    }];
    lines.push(...artifactLine(files, isPrivJwk));
    return { text: lines.join("\n"), files };
  },
});

register({
  id: "jwkToPem", cat: "asym", name: "JWK → PEM",
  desc: "JWK JSON → PEM。RSA 私钥出 PKCS#1 + PKCS#8 两块（RFC 8017 §A.1.2 / RFC 5208，CRT 参数缺 dp/dq/qi 时自动推导）；RSA 公钥出 SPKI（RFC 5280）。EC 私钥出 SEC 1 传统 + PKCS#8 两块（RFC 5915 / RFC 5480 §2.2，内嵌版按标准省略 [0] 曲线参数）；EC 公钥出 SPKI（BIT STRING = 04‖X‖Y）。私钥缺公钥坐标时现算 d·G 补全",
  params: [],
  run: (text) => {
    const k = parseKeyText(text);
    const lines = [];
    // T364：PEM 各块拆成独立 .pem 产物（RSA 私钥 = PKCS#1 + PKCS#8 两文件；
    // EC 私钥 = SEC1 + PKCS#8 两文件；公钥 = SPKI 单文件）
    const pems = [];
    if (k.kty === "RSA") {
      const isPriv = k.d != null;
      const bits = k.n.toString(2).length;
      if (isPriv) {
        if (k.p == null || k.q == null) {
          throw new Error("RSA 私钥 JWK 缺 p/q（RFC 7518 §6.3.2）：PKCS#1/PKCS#8 DER 均需完整素数与 CRT 参数，仅有 n,e,d 无法不经分解重建结构");
        }
        const kk = { n: k.n, e: k.e, d: k.d, p: k.p, q: k.q, dp: k.dp, dq: k.dq, qinv: k.qinv };
        if (k.dp == null || k.dq == null || k.qinv == null) {
          lines.push("提示：JWK 缺 dp/dq/qi，已按 RSA-CRT 推导（dp=d mod (p-1)，dq=d mod (q-1)，qi=q^-1 mod p）");
        }
        if (k.n !== k.p * k.q) lines.push("警告：n ≠ p·q，输出结构仍按原值编码（供分析，非可用密钥）");
        lines.push("PKCS#1 私钥（RFC 8017 §A.1.2）:");
        pems.push({ name: `rsa_private_pkcs1_${bits}.pem`, pem: derToPem("RSA PRIVATE KEY", buildPkcs1PrivateDer(kk)) });
        lines.push(pems[pems.length - 1].pem);
        lines.push("");
        lines.push("PKCS#8 私钥（RFC 5208 §5，OpenSSL 默认）:");
        pems.push({ name: `rsa_private_pkcs8_${bits}.pem`, pem: derToPem("PRIVATE KEY", buildPkcs8PrivateDer(kk)) });
        lines.push(pems[pems.length - 1].pem);
      } else {
        lines.push("RSA 公钥 SPKI（RFC 5280 §4.1）:");
        pems.push({ name: `rsa_public_spki_${bits}.pem`, pem: derToPem("PUBLIC KEY", buildSpkiPublicDer({ n: k.n, e: k.e })) });
        lines.push(pems[pems.length - 1].pem);
      }
    } else {
      const isPriv = k.d != null;
      const tag = crvTag(k.curve.crv);
      if (isPriv) {
        lines.push(`EC 私钥 SEC 1 传统格式（RFC 5915，带 [0] namedCurve + [1] 公钥）· 曲线 ${k.curve.crv}:`);
        pems.push({ name: `ec_private_sec1_${tag}.pem`, pem: derToPem("EC PRIVATE KEY", buildEcSec1Der(k, { withCurveOid: true, withPub: true })) });
        lines.push(pems[pems.length - 1].pem);
        lines.push("");
        lines.push("EC 私钥 PKCS#8（RFC 5208 + RFC 5480 §2.2，曲线 OID 进 AlgId，内嵌 SEC 1 省略 [0]）:");
        pems.push({ name: `ec_private_pkcs8_${tag}.pem`, pem: derToPem("PRIVATE KEY", buildEcPkcs8PrivateDer(k)) });
        lines.push(pems[pems.length - 1].pem);
      } else {
        lines.push(`EC 公钥 SPKI（RFC 5480 §2.2，BIT STRING = 04‖X‖Y）· 曲线 ${k.curve.crv}:`);
        pems.push({ name: `ec_public_spki_${tag}.pem`, pem: derToPem("PUBLIC KEY", buildEcSpkiPublicDer(k)) });
        lines.push(pems[pems.length - 1].pem);
      }
    }
    const files = pems.map((p) => ({ name: p.name, mime: "application/x-pem-file", bytes: encodeText(p.pem + "\n") }));
    lines.push(...artifactLine(files, k.d != null));
    return { text: lines.join("\n"), files };
  },
});

register({
  id: "pubFromPriv", cat: "asym", name: "私钥 → 公钥",
  desc: "由私钥提取公钥（PEM 或 JWK 输入）。RSA：公钥 = (n, e)，出 SPKI PEM（RFC 5280）+ JWK（RFC 7518 §6.3.1）。EC：公钥 = d·G 椭圆曲线点乘（雅可比坐标实现），出 SPKI PEM + JWK{crv,x,y}；曲线由私钥结构 OID（RFC 5480）或 JWK crv 字段判别。输出与 openssl pkey -pubout 可逐字节对拍",
  params: [],
  run: (text) => {
    const k = parseKeyText(text);
    const lines = [];
    // T364：公钥双产物 = SPKI .pem + JWK .jwk（公钥可公开，无敏感提示）
    const files = [];
    lines.push(`输入解析：${k.srcKind in KIND_DESC ? KIND_DESC[k.srcKind] : k.srcKind} · ${k.srcAlg}`);
    if (k.kty === "RSA") {
      if (k.d == null) throw new Error("输入是 RSA 公钥（无 d），无需提取——需要私钥（PKCS#1/PKCS#8 PEM 或含 d 的 JWK）");
      const bits = k.n.toString(2).length;
      lines.push(`RSA：公钥 = (n, e)，n 位长 ${bits}，e = ${k.e}`);
      const jwkJson = JSON.stringify(partsToRsaJwk({ n: k.n, e: k.e }), null, 2);
      const pem = derToPem("PUBLIC KEY", buildSpkiPublicDer({ n: k.n, e: k.e }));
      lines.push("");
      lines.push("JWK 公钥（RFC 7518 §6.3.1）:");
      lines.push(jwkJson);
      lines.push("");
      lines.push("PEM 公钥 SPKI（RFC 5280 §4.1，对拍 openssl pkey -pubout）:");
      lines.push(pem);
      files.push({ name: `rsa_public_spki_${bits}.pem`, mime: "application/x-pem-file", bytes: encodeText(pem + "\n") });
      files.push({ name: `rsa_public_${bits}.jwk`, mime: "application/jwk+json", bytes: encodeText(jwkJson + "\n") });
    } else {
      if (k.d == null) throw new Error("输入是 EC 公钥（无 d），无需提取——需要私钥（SEC1/PKCS#8 PEM 或含 d 的 JWK）");
      const [gx, gy] = ecPublicFromPrivate(k.d, k.curve.key);
      const [x, y] = [k.x, k.y];
      lines.push(`EC：公钥 = d·G（曲线 ${k.curve.crv}，${k.curve.std}）`);
      lines.push(`自检：d·G 与私钥携带公钥坐标 → ${gx === x && gy === y ? "一致" : "不一致（" + (k.srcKind === "jwk" ? "JWK 的 x/y 与 d 矛盾" : "PEM [1] 公钥与 d·G 矛盾") + "）"}`);
      const parts = { kty: "EC", curve: k.curve, d: null, x, y };
      const tag = crvTag(k.curve.crv);
      const jwkJson = JSON.stringify(partsToEcJwk(parts), null, 2);
      const pem = derToPem("PUBLIC KEY", buildEcSpkiPublicDer(parts));
      lines.push("");
      lines.push("JWK 公钥（RFC 7518 §6.2.1）:");
      lines.push(jwkJson);
      lines.push("");
      lines.push("PEM 公钥 SPKI（RFC 5480 §2.2，对拍 openssl pkey -pubout）:");
      lines.push(pem);
      files.push({ name: `ec_public_spki_${tag}.pem`, mime: "application/x-pem-file", bytes: encodeText(pem + "\n") });
      files.push({ name: `ec_public_${tag}.jwk`, mime: "application/jwk+json", bytes: encodeText(jwkJson + "\n") });
    }
    lines.push(...artifactLine(files, false));
    return { text: lines.join("\n"), files };
  },
});

// 供后续 T 卡（RSA/EC 签名验签导入密钥）复用的解析入口
export { parsePem, parseKeyDer, parseKeyText, base64Decode, bytesToB64url, oidString, EC_CURVES };
