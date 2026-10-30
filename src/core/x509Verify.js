/*
 * x509Verify.js — X.509 证书链验签（ITU-T X.509 / RFC 5280）。
 *
 * 能力：
 *   - 输入：PEM 多证书（-----BEGIN CERTIFICATE-----）或单张 DER（文件字节 / hex）。
 *   - 解析：tbsCertificate、issuer/subject（RDNSequence）、validity、SPKI、
 *           BasicConstraints、KeyUsage、SubjectKeyIdentifier、AuthorityKeyIdentifier、
 *           未知关键扩展标记。
 *   - 验签：RSA PKCS#1 v1.5（SHA-256/384/512）、ECDSA P-256/P-384/P-521（SHA-256/384/512）、
 *           Ed25519（PureEdDSA）。
 *   - 链式：叶子 → 中间 → 根，逐级用 issuer 公钥验签；issuer/subject 名称衔接；
 *           每张证书有效期；签发者 CA 位与 keyCertSign；pathLenConstraint。
 *   - 信任锚：可选，自备完整证书（PEM）或该证书的 SHA-256 指纹；不内置系统根、不联网。
 *
 * 签名输入严格使用证书中原始 tbsCertificate 的 DER 字节切片（带绝对偏移解析），
 * 不对解码后的节点重新编码，避免「重编码不等于原始字节」造成假验签。
 *
 * 明确不做：CRL / OCSP / 策略树 / NameConstraints / 时间戳 / 系统根证书 / 网络访问。
 * 错误分类：FORMAT_ERROR / UNKNOWN_ALGORITHM / ALGORITHM_MISMATCH / SIGNATURE_INVALID /
 *           CHAIN_BROKEN / EXPIRED / NOT_YET_VALID / CA_CONSTRAINT /
 *           ANCHOR_MISMATCH / UNKNOWN_CRITICAL_EXTENSION / NO_CERTIFICATE。
 *
 * 纯本地、零外发；哈希走 WebCrypto（浏览器与 Node>=19 同源），验签原语复用仓内
 * ecdsa.js / ed25519.js。
 */
import { register } from "./registry.js";
import { CURVES, ecdsaVerifyRaw, derToSig, hashToE, parsePoint } from "./ecdsa.js";
import { verify as ed25519Verify } from "./ed25519.js";

// ============================================================
// 错误分类
// ============================================================
const CODE = Object.freeze({
  FORMAT: "FORMAT_ERROR",
  UNKNOWN_ALG: "UNKNOWN_ALGORITHM",
  ALG_MISMATCH: "ALGORITHM_MISMATCH",
  SIGNATURE: "SIGNATURE_INVALID",
  CHAIN: "CHAIN_BROKEN",
  EXPIRED: "EXPIRED",
  NOT_YET_VALID: "NOT_YET_VALID",
  CA: "CA_CONSTRAINT",
  ANCHOR: "ANCHOR_MISMATCH",
  CRITICAL_EXT: "UNKNOWN_CRITICAL_EXTENSION",
  NO_CERT: "NO_CERTIFICATE",
});

class X509VerifyError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = "X509VerifyError";
    this.code = code;
    this.extra = extra;
  }
}

const fmtErr = (code, message) => new X509VerifyError(code, message);

// ============================================================
// 字节 / hex / base64 小工具
// ============================================================
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(h) {
  const out = new Uint8Array(h.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function concatBytes(...parts) {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function asciiBytes(b) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return s;
}

function base64Decode(body, label) {
  const clean = String(body || "").replace(/\s+/g, "");
  if (!clean) throw fmtErr(CODE.FORMAT, `${label} 的 base64 内容为空`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw fmtErr(CODE.FORMAT, `${label} 含非 base64 字符（RFC 7468 §2：仅 A-Z a-z 0-9 + / 与末尾 =）`);
  }
  if (clean.length % 4 === 1) throw fmtErr(CODE.FORMAT, `${label} 的 base64 长度非法（余 1 字符）`);
  if (clean.includes("=") && clean.length % 4 !== 0) {
    throw fmtErr(CODE.FORMAT, `${label} 的 base64 padding 位置非法`);
  }
  const data = clean.replace(/=+$/, "");
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of data) {
    const v = B64_ALPHABET.indexOf(ch);
    if (v < 0) throw fmtErr(CODE.FORMAT, `${label} 含非 base64 字符`);
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  if (bits > 0 && (buf & ((1 << bits) - 1)) !== 0) {
    throw fmtErr(CODE.FORMAT, `${label} 的 base64 尾部填充位非零（非规范编码）`);
  }
  return Uint8Array.from(out);
}

function wrapHexColon(hex) {
  const pairs = [];
  for (let i = 0; i < hex.length; i += 2) pairs.push(hex.slice(i, i + 2).toUpperCase());
  return pairs.join(":");
}

// ============================================================
// DER 解析（带绝对偏移，严格 DER）
// ============================================================
const TAG = Object.freeze({
  INTEGER: 0x02,
  BIT_STRING: 0x03,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  OID: 0x06,
  BOOLEAN: 0x01,
  SEQUENCE: 0x30,
  SET: 0x31,
  UTF8: 0x0c,
  PRINTABLE: 0x13,
  T61: 0x14,
  IA5: 0x16,
  BMP: 0x1e,
  UNIVERSAL: 0x1c,
  NUMERIC: 0x12,
  VISIBLE: 0x1a,
  UTC_TIME: 0x17,
  GENERALIZED_TIME: 0x18,
});

/**
 * 解析单个 TLV。start/end 是相对整个 u8 的绝对偏移；children 的偏移同样绝对，
 * 因此 tbsCertificate 可直接用 u8.slice(node.start, node.end) 取原始签名字节。
 */
function readTlv(u8, off, limit, path) {
  if (off + 2 > limit) throw fmtErr(CODE.FORMAT, `${path}：偏移 ${off} 起不足 2 字节（DER 截断）`);
  const start = off;
  const tag = u8[off];
  if ((tag & 0x1f) === 0x1f) {
    throw fmtErr(CODE.FORMAT, `${path}：不支持多字节 tag（X.690 §8.1.2.4）`);
  }
  let p = off + 1;
  let lenByte = u8[p++];
  let len;
  if (lenByte < 0x80) {
    len = lenByte;
  } else if (lenByte === 0x80) {
    throw fmtErr(CODE.FORMAT, `${path}：不定长编码禁止（DER，X.690 §9）`);
  } else {
    const n = lenByte & 0x7f;
    if (n === 0) throw fmtErr(CODE.FORMAT, `${path}：长度字段非法（0 字节）`);
    if (n > 4) throw fmtErr(CODE.FORMAT, `${path}：长度字段过长（${n} 字节）`);
    if (p + n > limit) throw fmtErr(CODE.FORMAT, `${path}：长度字段被截断`);
    if (u8[p] === 0) throw fmtErr(CODE.FORMAT, `${path}：长形式长度含前导 0（非最短编码）`);
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + u8[p + i];
    p += n;
    if (len < 0x80) throw fmtErr(CODE.FORMAT, `${path}：短长度误用长形式（非最短编码）`);
  }
  if (p + len > limit) {
    throw fmtErr(CODE.FORMAT, `${path}：内容长度 ${len} 越界（剩余 ${limit - p} 字节，DER 截断）`);
  }
  const node = {
    tag,
    start,
    valueStart: p,
    valueEnd: p + len,
    end: p + len,
    value: u8.subarray(p, p + len),
    raw: u8.subarray(start, p + len),
    children: null,
  };
  if (tag & 0x20) {
    const children = [];
    let q = p;
    while (q < node.valueEnd) {
      const c = readTlv(u8, q, node.valueEnd, `${path}/${children.length}`);
      children.push(c);
      q = c.end;
    }
    if (q !== node.valueEnd) throw fmtErr(CODE.FORMAT, `${path}：构造类型长度与子项不符`);
    node.children = children;
  }
  return node;
}

function decodeOid(value) {
  if (!value.length) throw fmtErr(CODE.FORMAT, "OID 内容为空");
  const arcs = [];
  let v = 0;
  let started = false;
  for (const b of value) {
    if (!started && b === 0x80) throw fmtErr(CODE.FORMAT, "OID base-128 含冗余前导 0x80（非最短编码）");
    started = true;
    v = v * 128 + (b & 0x7f);
    if (!(b & 0x80)) {
      arcs.push(v);
      v = 0;
      started = false;
    }
  }
  if (started) throw fmtErr(CODE.FORMAT, "OID base-128 末字节仍置高位（截断）");
  const first = arcs.shift();
  let a0, a1;
  if (first < 40) { a0 = 0; a1 = first; }
  else if (first < 80) { a0 = 1; a1 = first - 40; }
  else { a0 = 2; a1 = first - 80; }
  return [a0, a1, ...arcs].join(".");
}

function readPositiveInt(node, what) {
  if (node.tag !== TAG.INTEGER) throw fmtErr(CODE.FORMAT, `${what} 不是 INTEGER（tag 0x${node.tag.toString(16)}）`);
  if (!node.value.length) throw fmtErr(CODE.FORMAT, `${what} 的 INTEGER 长度为 0`);
  if (node.value[0] & 0x80) throw fmtErr(CODE.FORMAT, `${what} 为负整数（本字段要求非负）`);
  if (node.value.length > 1 && node.value[0] === 0 && (node.value[1] & 0x80) === 0) {
    throw fmtErr(CODE.FORMAT, `${what} 的 INTEGER 含冗余前导 0（非最短编码）`);
  }
  let v = 0n;
  let i = 0;
  while (i < node.value.length - 1 && node.value[i] === 0) i++;
  for (; i < node.value.length; i++) v = (v << 8n) | BigInt(node.value[i]);
  return v;
}

function bytesToBigInt(b) {
  let v = 0n;
  for (const x of b) v = (v << 8n) | BigInt(x);
  return v;
}

function bigIntToBytes(v, len) {
  const out = new Uint8Array(len);
  let x = v;
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  if (x !== 0n) throw fmtErr(CODE.FORMAT, "整数超出目标字节宽度");
  return out;
}

function bitLength(v) {
  return v === 0n ? 0 : v.toString(2).length;
}

function modPow(base, exp, mod) {
  let b = base % mod;
  let e = exp;
  let r = 1n;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % mod;
    e >>= 1n;
    b = (b * b) % mod;
  }
  return r;
}

// ============================================================
// Name / Time / OID 显示
// ============================================================
const OID_LABEL = {
  "2.5.4.3": "CN",
  "2.5.4.4": "SN",
  "2.5.4.5": "serialNumber",
  "2.5.4.6": "C",
  "2.5.4.7": "L",
  "2.5.4.8": "ST",
  "2.5.4.9": "street",
  "2.5.4.10": "O",
  "2.5.4.11": "OU",
  "2.5.4.12": "title",
  "2.5.4.42": "GN",
  "2.5.4.43": "initials",
  "2.5.4.46": "dnQualifier",
  "0.9.2342.19200300.100.1.1": "UID",
  "0.9.2342.19200300.100.1.25": "DC",
  "1.2.840.113549.1.9.1": "emailAddress",
  "1.3.6.1.4.1.311.60.2.1.3": "jurisdictionC",
};

const OID_NAME_ALIAS = {
  "2.5.29.19": "basicConstraints",
  "2.5.29.15": "keyUsage",
  "2.5.29.14": "subjectKeyIdentifier",
  "2.5.29.35": "authorityKeyIdentifier",
  "2.5.29.17": "subjectAltName",
  "2.5.29.37": "extKeyUsage",
  "2.5.29.30": "nameConstraints",
  "2.5.29.32": "certificatePolicies",
  "2.5.29.36": "policyConstraints",
  "2.5.29.33": "policyMappings",
  "2.5.29.54": "inhibitAnyPolicy",
  "2.5.29.31": "cRLDistributionPoints",
  "2.5.29.46": "freshestCRL",
  "1.3.6.1.5.5.7.1.1": "authorityInfoAccess",
};

const OID = Object.freeze({
  RSA: "1.2.840.113549.1.1.1",
  EC: "1.2.840.10045.2.1",
  ED25519: "1.3.101.112",
  BC: "2.5.29.19",
  KU: "2.5.29.15",
  SKI: "2.5.29.14",
  AKI: "2.5.29.35",
  SAN: "2.5.29.17",
  EKU: "2.5.29.37",
  CURVE_P256: "1.2.840.10045.3.1.7",
  CURVE_P384: "1.3.132.0.34",
  CURVE_P521: "1.3.132.0.35",
});

const CURVE_BY_OID = {
  [OID.CURVE_P256]: { id: "p256", name: "P-256", curve: CURVES.p256 },
  [OID.CURVE_P384]: { id: "p384", name: "P-384", curve: CURVES.p384 },
  [OID.CURVE_P521]: { id: "p521", name: "P-521", curve: CURVES.p521 },
};

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

function decodeDirectoryString(node) {
  const v = node.value;
  if (node.tag === TAG.UTF8) {
    try {
      return UTF8_DECODER.decode(v);
    } catch {
      throw fmtErr(CODE.FORMAT, "DirectoryString 声明 UTF8String 但字节不是合法 UTF-8");
    }
  }
  if (node.tag === TAG.BMP) {
    if (v.length % 2) throw fmtErr(CODE.FORMAT, "BMPString 字节数为奇数");
    let s = "";
    for (let i = 0; i < v.length; i += 2) s += String.fromCharCode((v[i] << 8) | v[i + 1]);
    return s;
  }
  if (node.tag === TAG.UNIVERSAL) {
    if (v.length % 4) throw fmtErr(CODE.FORMAT, "UniversalString 字节数不是 4 的倍数");
    let s = "";
    for (let i = 0; i < v.length; i += 4) {
      const cp = (v[i] << 24) >>> 0 | (v[i + 1] << 16) | (v[i + 2] << 8) | v[i + 3];
      s += String.fromCodePoint(cp);
    }
    return s;
  }
  if (node.tag === TAG.PRINTABLE || node.tag === TAG.IA5 || node.tag === TAG.NUMERIC ||
      node.tag === TAG.VISIBLE || node.tag === TAG.T61) {
    let s = "";
    for (const x of v) s += String.fromCharCode(x);
    return s;
  }
  return "#" + bytesToHex(v);
}

function normalizeNameValue(s) {
  return String(s).normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function escapeDn(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/\+/g, "\\+")
    .replace(/"/g, '\\"')
    .replace(/</g, "\\<")
    .replace(/>/g, "\\>")
    .replace(/;/g, "\\;")
    .replace(/^ /, "\\ ")
    .replace(/ $/, "\\ ");
}

function parseName(node, what) {
  if (!node || node.tag !== TAG.SEQUENCE || !node.children) {
    throw fmtErr(CODE.FORMAT, `${what} 不是 Name（RDNSequence SEQUENCE）`);
  }
  const rdns = node.children.map((set, si) => {
    if (set.tag !== TAG.SET || !set.children) {
      throw fmtErr(CODE.FORMAT, `${what} 第 ${si + 1} 个 RDN 不是 SET（RFC 5280 §4.1.2.4）`);
    }
    if (!set.children.length) throw fmtErr(CODE.FORMAT, `${what} 第 ${si + 1} 个 RDN 为空 SET`);
    return set.children.map((atv, ai) => {
      if (atv.tag !== TAG.SEQUENCE || !atv.children || atv.children.length !== 2) {
        throw fmtErr(CODE.FORMAT, `${what} 第 ${si + 1} 个 RDN 的第 ${ai + 1} 个 AttributeTypeAndValue 结构非法`);
      }
      if (atv.children[0].tag !== TAG.OID) {
        throw fmtErr(CODE.FORMAT, `${what} 的 AttributeType 不是 OID`);
      }
      const oid = decodeOid(atv.children[0].value);
      const valNode = atv.children[1];
      let text;
      try {
        text = decodeDirectoryString(valNode);
      } catch (e) {
        throw fmtErr(CODE.FORMAT, `${what} 的 ${oid} 值解码失败：${e.message}`);
      }
      return { oid, tag: valNode.tag, text, norm: normalizeNameValue(text), raw: valNode.raw };
    });
  });
  const canon = rdns
    .map((attrs) => attrs.map((a) => `${a.oid}=${a.norm}`).sort().join("+"))
    .join(",");
  const text = rdns
    .slice()
    .reverse()
    .map((attrs) => attrs.map((a) => `${OID_LABEL[a.oid] || a.oid}=${escapeDn(a.text)}`).join("+"))
    .join(", ");
  return { rdns, canon, text: text || "(空 DN)", der: node.raw, empty: rdns.length === 0 };
}

function sameName(a, b) {
  if (!a || !b) return false;
  if (bytesEqual(a.der, b.der)) return true;
  return a.canon === b.canon;
}

function parseTimeNode(node, what) {
  const raw = asciiBytes(node.value);
  let ms;
  let off = "Z";
  if (node.tag === TAG.UTC_TIME) {
    const m = /^(\d{10}|\d{12})(Z|[+-]\d{4})$/.exec(raw);
    if (!m) throw fmtErr(CODE.FORMAT, `${what} 的 UTCTime 非法：${JSON.stringify(raw)}（RFC 5280 §4.1.2.5.1）`);
    off = m[2];
    const d = m[1];
    const yy = Number(d.slice(0, 2));
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    ms = Date.UTC(year, +d.slice(2, 4) - 1, +d.slice(4, 6), +d.slice(6, 8), +d.slice(8, 10), d.length >= 12 ? +d.slice(10, 12) : 0);
  } else if (node.tag === TAG.GENERALIZED_TIME) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?(Z|[+-]\d{4})$/.exec(raw);
    if (!m) throw fmtErr(CODE.FORMAT, `${what} 的 GeneralizedTime 非法：${JSON.stringify(raw)}（RFC 5280 §4.1.2.5.2）`);
    off = m[8];
    ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (m[7]) ms += Math.round(parseFloat(m[7]) * 1000);
  } else {
    throw fmtErr(CODE.FORMAT, `${what} 不是 UTCTime/GeneralizedTime（tag 0x${node.tag.toString(16)}）`);
  }
  if (off !== "Z") {
    const om = ((+off.slice(1, 3)) * 60 + (+off.slice(3, 5))) * 60000;
    ms += off[0] === "+" ? -om : om;
  }
  return { ms, raw, kind: node.tag === TAG.UTC_TIME ? "UTCTime" : "GeneralizedTime" };
}

function fmtUtc(ms) {
  try {
    return new Date(ms).toISOString().replace(".000Z", "Z");
  } catch {
    return String(ms);
  }
}

// ============================================================
// 算法标识 / SPKI / 扩展
// ============================================================
function parseAlgId(node, what) {
  if (!node || node.tag !== TAG.SEQUENCE || !node.children || !node.children.length) {
    throw fmtErr(CODE.FORMAT, `${what} 不是 AlgorithmIdentifier SEQUENCE`);
  }
  if (node.children.length > 2) throw fmtErr(CODE.FORMAT, `${what} 的 AlgorithmIdentifier 多于 2 个字段`);
  if (node.children[0].tag !== TAG.OID) throw fmtErr(CODE.FORMAT, `${what} 的 algorithm 不是 OID`);
  return {
    oid: decodeOid(node.children[0].value),
    params: node.children[1] || null,
    raw: node.raw,
  };
}

const SIG_ALGORITHMS = {
  "1.2.840.113549.1.1.11": { kind: "rsa", hash: "SHA-256", label: "RSA PKCS#1 v1.5 / SHA-256", oidName: "sha256WithRSAEncryption" },
  "1.2.840.113549.1.1.12": { kind: "rsa", hash: "SHA-384", label: "RSA PKCS#1 v1.5 / SHA-384", oidName: "sha384WithRSAEncryption" },
  "1.2.840.113549.1.1.13": { kind: "rsa", hash: "SHA-512", label: "RSA PKCS#1 v1.5 / SHA-512", oidName: "sha512WithRSAEncryption" },
  "1.2.840.10045.4.3.2": { kind: "ecdsa", hash: "SHA-256", label: "ECDSA / SHA-256", oidName: "ecdsa-with-SHA256" },
  "1.2.840.10045.4.3.3": { kind: "ecdsa", hash: "SHA-384", label: "ECDSA / SHA-384", oidName: "ecdsa-with-SHA384" },
  "1.2.840.10045.4.3.4": { kind: "ecdsa", hash: "SHA-512", label: "ECDSA / SHA-512", oidName: "ecdsa-with-SHA512" },
  "1.3.101.112": { kind: "ed25519", hash: null, label: "Ed25519（PureEdDSA，RFC 8410）", oidName: "id-Ed25519" },
};

const UNSUPPORTED_SIG = {
  "1.2.840.113549.1.1.4": "md5WithRSAEncryption（MD5）",
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption（SHA-1）",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.2.840.113549.1.1.14": "sha224WithRSAEncryption（SHA-224）",
  "1.2.840.10045.4.1": "ecdsa-with-SHA1",
  "1.2.840.10045.4.3.1": "ecdsa-with-SHA224",
  "1.3.101.113": "Ed448",
  "1.2.840.10040.4.3": "dsa-with-SHA1",
  "2.16.840.1.101.3.4.3.2": "dsa-with-SHA256",
};

const DIGEST_INFO_NULL = {
  "SHA-256": "3031300d060960864801650304020105000420",
  "SHA-384": "3041300d060960864801650304020205000430",
  "SHA-512": "3051300d060960864801650304020305000440",
};
const DIGEST_INFO_ABSENT = {
  "SHA-256": "302f300b06096086480165030402010420",
  "SHA-384": "303f300b06096086480165030402020430",
  "SHA-512": "304f300b06096086480165030402030440",
};

function resolveSigAlg(oid, where) {
  const alg = SIG_ALGORITHMS[oid];
  if (alg) return alg;
  if (UNSUPPORTED_SIG[oid]) {
    throw fmtErr(
      CODE.UNKNOWN_ALG,
      `${where}：签名算法 ${UNSUPPORTED_SIG[oid]}（OID ${oid}）不在支持范围；` +
      "本工具仅支持 RSA PKCS#1 v1.5（SHA-256/384/512）、ECDSA P-256/384/521、Ed25519"
    );
  }
  throw fmtErr(CODE.UNKNOWN_ALG, `${where}：未知签名算法 OID ${oid}`);
}

function assertSigParams(alg, algId, where) {
  if (alg.kind === "rsa") {
    if (algId.params && algId.params.tag !== TAG.NULL) {
      throw fmtErr(CODE.FORMAT, `${where}：RSA PKCS#1 v1.5 的 AlgorithmIdentifier 参数应为 NULL`);
    }
    if (algId.params && algId.params.value.length !== 0) {
      throw fmtErr(CODE.FORMAT, `${where}：RSA 参数的 NULL 内容应为空`);
    }
    return;
  }
  if (alg.kind === "ecdsa" || alg.kind === "ed25519") {
    if (algId.params) {
      throw fmtErr(CODE.FORMAT, `${where}：${alg.label} 的 AlgorithmIdentifier 参数必须缺省（RFC 5758 / RFC 8410）`);
    }
  }
}

function parseSpki(node) {
  if (!node || node.tag !== TAG.SEQUENCE || !node.children || node.children.length !== 2) {
    throw fmtErr(CODE.FORMAT, "SubjectPublicKeyInfo 结构非法（需 SEQUENCE { algorithm, subjectPublicKey }）");
  }
  const alg = parseAlgId(node.children[0], "SPKI.algorithm");
  const bit = node.children[1];
  if (bit.tag !== TAG.BIT_STRING) throw fmtErr(CODE.FORMAT, "SPKI.subjectPublicKey 不是 BIT STRING");
  if (!bit.value.length) throw fmtErr(CODE.FORMAT, "SPKI.subjectPublicKey 为空");
  if (bit.value[0] !== 0) throw fmtErr(CODE.FORMAT, `SPKI.subjectPublicKey 的 unused bits = ${bit.value[0]}（公钥应为 0）`);
  const keyBytes = bit.value.subarray(1);

  if (alg.oid === OID.RSA) {
    if (alg.params && alg.params.tag !== TAG.NULL) {
      throw fmtErr(CODE.FORMAT, "RSA SPKI 参数应为 NULL");
    }
    const seq = readTlv(keyBytes, 0, keyBytes.length, "RSAPublicKey");
    if (seq.end !== keyBytes.length) throw fmtErr(CODE.FORMAT, "RSAPublicKey 后有多余字节");
    if (seq.tag !== TAG.SEQUENCE || !seq.children || seq.children.length !== 2) {
      throw fmtErr(CODE.FORMAT, "RSAPublicKey 结构非法（需 SEQUENCE { modulus, exponent }）");
    }
    const n = readPositiveInt(seq.children[0], "RSA modulus");
    const e = readPositiveInt(seq.children[1], "RSA publicExponent");
    if (n === 0n) throw fmtErr(CODE.FORMAT, "RSA modulus 为 0");
    if ((n & 1n) === 0n) throw fmtErr(CODE.FORMAT, "RSA modulus 为偶数（非法）");
    if (e === 0n || (e & 1n) === 0n) throw fmtErr(CODE.FORMAT, "RSA publicExponent 必须为正奇数");
    const bits = bitLength(n);
    return {
      kind: "rsa",
      label: `RSA ${bits} 位（e=${e.toString()}）`,
      short: `RSA-${bits}`,
      n, e, bits,
      spki: node.raw,
    };
  }

  if (alg.oid === OID.EC) {
    if (!alg.params || alg.params.tag !== TAG.OID) {
      throw fmtErr(CODE.FORMAT, "EC SPKI 缺少 namedCurve OID 参数");
    }
    const curveOid = decodeOid(alg.params.value);
    const c = CURVE_BY_OID[curveOid];
    if (!c) {
      throw fmtErr(
        CODE.UNKNOWN_ALG,
        `EC 曲线 OID ${curveOid} 不在支持范围；本工具仅支持 P-256 / P-384 / P-521`
      );
    }
    let Q;
    try {
      Q = parsePoint(bytesToHex(keyBytes), c.curve, "EC 公钥");
    } catch (e) {
      throw fmtErr(CODE.FORMAT, `EC 公钥解析失败（曲线 ${c.name}）：${e.message}`);
    }
    if (!Q) throw fmtErr(CODE.FORMAT, "EC 公钥为无穷远点");
    return {
      kind: "ecdsa",
      curveId: c.id,
      curveName: c.name,
      curveObj: c.curve,
      label: `ECDSA ${c.name}`,
      short: `ECDSA ${c.name}`,
      Q,
      pointHex: bytesToHex(keyBytes),
      spki: node.raw,
    };
  }

  if (alg.oid === OID.ED25519) {
    if (alg.params) throw fmtErr(CODE.FORMAT, "Ed25519 SPKI 参数必须缺省（RFC 8410 §4）");
    if (keyBytes.length !== 32) throw fmtErr(CODE.FORMAT, `Ed25519 公钥必须 32 字节，实际 ${keyBytes.length}`);
    return {
      kind: "ed25519",
      label: "Ed25519（32 字节公钥）",
      short: "Ed25519",
      pk: keyBytes,
      spki: node.raw,
    };
  }

  throw fmtErr(
    CODE.UNKNOWN_ALG,
    `SPKI 公钥算法 OID ${alg.oid} 不在支持范围；支持 rsaEncryption / id-ecPublicKey(P-256/384/521) / id-Ed25519`
  );
}

function parseExtensionList(explicitNode) {
  if (!explicitNode) return [];
  if (explicitNode.tag !== 0xa3) throw fmtErr(CODE.FORMAT, "extensions 字段不是 [3] EXPLICIT（tag 0xa3）");
  const seq = explicitNode.children && explicitNode.children[0];
  if (!seq || seq.tag !== TAG.SEQUENCE || !seq.children) {
    throw fmtErr(CODE.FORMAT, "extensions [3] 内不是 SEQUENCE OF Extension");
  }
  const seen = new Set();
  return seq.children.map((e, i) => {
    if (e.tag !== TAG.SEQUENCE || !e.children || e.children.length < 2 || e.children.length > 3) {
      throw fmtErr(CODE.FORMAT, `第 ${i + 1} 个 Extension 结构非法（需 SEQUENCE { extnID, critical?, extnValue }）`);
    }
    if (e.children[0].tag !== TAG.OID) throw fmtErr(CODE.FORMAT, `第 ${i + 1} 个 Extension 的 extnID 不是 OID`);
    const oid = decodeOid(e.children[0].value);
    if (seen.has(oid)) throw fmtErr(CODE.FORMAT, `扩展 OID ${oid} 重复（RFC 5280 §4.2：不得出现两次）`);
    seen.add(oid);
    let j = 1;
    let critical = false;
    if (e.children[j] && e.children[j].tag === TAG.BOOLEAN) {
      if (e.children[j].value.length !== 1 || (e.children[j].value[0] !== 0x00 && e.children[j].value[0] !== 0xff)) {
        throw fmtErr(CODE.FORMAT, `第 ${i + 1} 个 Extension 的 critical BOOLEAN 非 DER 布尔值`);
      }
      critical = e.children[j].value[0] === 0xff;
      j++;
    }
    if (!e.children[j] || e.children[j].tag !== TAG.OCTET_STRING) {
      throw fmtErr(CODE.FORMAT, `第 ${i + 1} 个 Extension 缺 extnValue OCTET STRING`);
    }
    return { oid, critical, valueDer: e.children[j].value, index: i };
  });
}

function readExtTlv(ext, what) {
  const node = readTlv(ext.valueDer, 0, ext.valueDer.length, what);
  if (node.end !== ext.valueDer.length) {
    throw fmtErr(CODE.FORMAT, `${what} 后有多余字节（extnValue 内 DER 长度不符）`);
  }
  return node;
}

function parseBasicConstraints(ext) {
  const seq = readExtTlv(ext, "basicConstraints");
  if (seq.tag !== TAG.SEQUENCE) throw fmtErr(CODE.FORMAT, "basicConstraints 不是 SEQUENCE");
  let ca = false;
  let pathLen = null;
  let i = 0;
  const kids = seq.children || [];
  if (kids[i] && kids[i].tag === TAG.BOOLEAN) {
    const b = kids[i].value;
    if (b.length !== 1 || (b[0] !== 0x00 && b[0] !== 0xff)) {
      throw fmtErr(CODE.FORMAT, "basicConstraints.cA 非 DER 布尔值");
    }
    ca = b[0] === 0xff;
    i++;
  }
  if (kids[i] && kids[i].tag === TAG.INTEGER) {
    const v = readPositiveInt(kids[i], "basicConstraints.pathLenConstraint");
    pathLen = Number(v);
    i++;
  }
  if (i !== kids.length) throw fmtErr(CODE.FORMAT, "basicConstraints 含多余字段");
  return { present: true, critical: ext.critical, ca, pathLen };
}

function parseKeyUsage(ext) {
  const bit = readExtTlv(ext, "keyUsage");
  if (bit.tag !== TAG.BIT_STRING) throw fmtErr(CODE.FORMAT, "keyUsage 不是 BIT STRING");
  if (!bit.value.length) throw fmtErr(CODE.FORMAT, "keyUsage BIT STRING 为空");
  const unused = bit.value[0];
  if (unused > 7) throw fmtErr(CODE.FORMAT, `keyUsage unused bits = ${unused}（应为 0..7）`);
  const data = bit.value.subarray(1);
  if (unused > 0 && data.length && (data[data.length - 1] & ((1 << unused) - 1)) !== 0) {
    throw fmtErr(CODE.FORMAT, "keyUsage 尾部的 unused bits 非零（非 DER 规范编码）");
  }
  const bitAt = (i) => {
    const byte = i >> 3;
    if (byte >= data.length) return false;
    return ((data[byte] >> (7 - (i & 7))) & 1) === 1;
  };
  const names = [];
  const table = [
    [0, "digitalSignature"], [1, "nonRepudiation"], [2, "keyEncipherment"],
    [3, "dataEncipherment"], [4, "keyAgreement"], [5, "keyCertSign"],
    [6, "cRLSign"], [7, "encipherOnly"], [8, "decipherOnly"],
  ];
  for (const [i, name] of table) if (bitAt(i)) names.push(name);
  return { present: true, critical: ext.critical, names, keyCertSign: bitAt(5) };
}

function parseKeyIdentifier(ext, what) {
  const oct = readExtTlv(ext, what);
  if (oct.tag !== TAG.OCTET_STRING) throw fmtErr(CODE.FORMAT, `${what} 不是 OCTET STRING`);
  return bytesToHex(oct.value);
}

function parseAuthorityKeyIdentifier(ext) {
  const seq = readExtTlv(ext, "authorityKeyIdentifier");
  if (seq.tag !== TAG.SEQUENCE) throw fmtErr(CODE.FORMAT, "authorityKeyIdentifier 不是 SEQUENCE");
  let keyId = null;
  for (const c of seq.children || []) {
    if (c.tag === 0x80) keyId = bytesToHex(c.value);
    else if (c.tag === 0xa1 || c.tag === 0x82) {
      // authorityCertIssuer / serial：链构建不使用，保留结构合法性
      if (c.tag === 0xa1 && !c.children) throw fmtErr(CODE.FORMAT, "authorityCertIssuer 构造类型无子项");
      if (c.tag === 0x82 && !c.value.length) throw fmtErr(CODE.FORMAT, "authorityCertSerialNumber 为空");
    } else {
      throw fmtErr(CODE.FORMAT, `authorityKeyIdentifier 含未知字段 tag 0x${c.tag.toString(16)}`);
    }
  }
  return { present: true, critical: ext.critical, keyId };
}

/**
 * 解析单张证书。返回结构中的 tbsDer / signature 均为原始字节切片。
 */
export function parseCertificate(der, label = "证书", options = {}) {
  const u8 = der instanceof Uint8Array ? der : new Uint8Array(der);
  if (!u8.length) throw fmtErr(CODE.FORMAT, `${label}：DER 为空`);
  const top = readTlv(u8, 0, u8.length, `${label}.Certificate`);
  if (top.end !== u8.length && !options.allowTrailing) {
    throw fmtErr(CODE.FORMAT, `${label}：Certificate 结束于 ${top.end}，其后仍有 ${u8.length - top.end} 字节（尾随数据）`);
  }
  if (top.tag !== TAG.SEQUENCE || !top.children || top.children.length !== 3) {
    throw fmtErr(CODE.FORMAT, `${label}：顶层不是 Certificate SEQUENCE { tbsCertificate, signatureAlgorithm, signatureValue }`);
  }
  const [tbs, outerSigAlgNode, sigValueNode] = top.children;
  if (tbs.tag !== TAG.SEQUENCE || !tbs.children || tbs.children.length < 6) {
    throw fmtErr(CODE.FORMAT, `${label}：tbsCertificate 结构非法`);
  }
  if (sigValueNode.tag !== TAG.BIT_STRING) throw fmtErr(CODE.FORMAT, `${label}：signatureValue 不是 BIT STRING`);
  if (!sigValueNode.value.length) throw fmtErr(CODE.FORMAT, `${label}：signatureValue 为空`);
  if (sigValueNode.value[0] !== 0) {
    throw fmtErr(CODE.FORMAT, `${label}：signatureValue 的 unused bits = ${sigValueNode.value[0]}（签名应恒为 0）`);
  }

  let idx = 0;
  let version = 1;
  if (tbs.children[0].tag === 0xa0) {
    const inner = tbs.children[0].children;
    if (!inner || inner.length !== 1 || inner[0].tag !== TAG.INTEGER) {
      throw fmtErr(CODE.FORMAT, `${label}：[0] EXPLICIT version 内不是单个 INTEGER`);
    }
    const v = readPositiveInt(inner[0], "version");
    if (v > 2n) throw fmtErr(CODE.FORMAT, `${label}：证书版本 v${v + 1n} 超出 RFC 5280 范围（v1..v3）`);
    version = Number(v) + 1;
    idx = 1;
  }
  const serialNode = tbs.children[idx];
  if (!serialNode || serialNode.tag !== TAG.INTEGER) throw fmtErr(CODE.FORMAT, `${label}：serialNumber 不是 INTEGER`);
  if (!serialNode.value.length) throw fmtErr(CODE.FORMAT, `${label}：serialNumber 为空`);
  const serial = readPositiveInt(serialNode, "serialNumber");

  const tbsSigAlgNode = tbs.children[idx + 1];
  const validityNode = tbs.children[idx + 3];
  const spkiNode = tbs.children[idx + 5];
  if (!tbsSigAlgNode || tbsSigAlgNode.tag !== TAG.SEQUENCE) {
    throw fmtErr(CODE.FORMAT, `${label}：tbsCertificate.signature 不是 AlgorithmIdentifier`);
  }
  if (!validityNode || validityNode.tag !== TAG.SEQUENCE || !validityNode.children || validityNode.children.length !== 2) {
    throw fmtErr(CODE.FORMAT, `${label}：validity 结构非法（需 SEQUENCE { notBefore, notAfter }）`);
  }
  const issuer = parseName(tbs.children[idx + 2], `${label}.issuer`);
  const subject = parseName(tbs.children[idx + 4], `${label}.subject`);
  const notBefore = parseTimeNode(validityNode.children[0], `${label}.notBefore`);
  const notAfter = parseTimeNode(validityNode.children[1], `${label}.notAfter`);
  if (notAfter.ms < notBefore.ms) throw fmtErr(CODE.FORMAT, `${label}：notAfter 早于 notBefore`);

  const tail = tbs.children.slice(idx + 6);
  let extNode = null;
  for (const t of tail) {
    if (t.tag === 0xa3) {
      if (extNode) throw fmtErr(CODE.FORMAT, `${label}：extensions 字段重复`);
      extNode = t;
    } else if (t.tag === 0x81 || t.tag === 0x82) {
      // issuerUniqueID / subjectUniqueID（v2/v3 可选，忽略）
    } else {
      throw fmtErr(CODE.FORMAT, `${label}：tbsCertificate 含未预期字段 tag 0x${t.tag.toString(16)}`);
    }
  }
  if (extNode && version !== 3) throw fmtErr(CODE.FORMAT, `${label}：v${version} 证书不应含 extensions（RFC 5280 §4.1.2.9）`);

  const extensions = parseExtensionList(extNode);
  let basicConstraints = { present: false, critical: false, ca: false, pathLen: null };
  let keyUsage = { present: false, critical: false, names: [], keyCertSign: false };
  let ski = null;
  let akiKeyId = null;
  const unknownCritical = [];
  const knownButDisplayOnly = new Set([OID.SAN, OID.EKU]);

  for (const ext of extensions) {
    if (ext.oid === OID.BC) basicConstraints = parseBasicConstraints(ext);
    else if (ext.oid === OID.KU) keyUsage = parseKeyUsage(ext);
    else if (ext.oid === OID.SKI) ski = parseKeyIdentifier(ext, "subjectKeyIdentifier");
    else if (ext.oid === OID.AKI) akiKeyId = parseAuthorityKeyIdentifier(ext).keyId;
    else if (ext.oid === OID.SAN || ext.oid === OID.EKU) {
      // 仅展示，不影响链验签
    } else if (ext.critical) {
      unknownCritical.push(ext.oid);
    }
  }

  const tbsSigAlg = parseAlgId(tbsSigAlgNode, `${label}.tbs.signature`);
  const sigAlg = parseAlgId(outerSigAlgNode, `${label}.signatureAlgorithm`);
  const publicKey = parseSpki(spkiNode);
  const extNames = extensions.map((e) => `${OID_NAME_ALIAS[e.oid] || e.oid}${e.critical ? "(critical)" : ""}`);

  return {
    label,
    version,
    der: u8.slice(0, top.end),
    tbsDer: u8.slice(tbs.start, tbs.end),
    tbsSigAlg,
    sigAlg,
    signature: sigValueNode.value.slice(1),
    serial,
    serialHex: bytesToHex(serialNode.value),
    issuer,
    subject,
    notBefore,
    notAfter,
    publicKey,
    extensions,
    extNames,
    basicConstraints,
    keyUsage,
    ski,
    akiKeyId,
    unknownCritical,
    knownButDisplayOnly: [...knownButDisplayOnly].filter((o) => extensions.some((e) => e.oid === o)),
  };
}

// ============================================================
// 输入解析（PEM 多证书 / 单 DER / DER hex）
// ============================================================
function parsePemCertificates(text) {
  const re = /-----BEGIN ([A-Z0-9][A-Z0-9 ]*)-----([\s\S]*?)-----END \1-----/g;
  const blocks = [];
  let m;
  while ((m = re.exec(text)) !== null) blocks.push({ label: m[1].trim(), body: m[2] });
  if (!blocks.length) {
    if (text.includes("-----BEGIN")) {
      throw fmtErr(CODE.FORMAT, "PEM 块不完整：缺 -----END 或 BEGIN/END 标签不一致（截断的 armor）");
    }
    throw fmtErr(CODE.FORMAT, "未找到 PEM 证书块（需 -----BEGIN CERTIFICATE-----）");
  }
  const certs = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const label = `PEM ${b.label} #${i + 1}`;
    if (b.label !== "CERTIFICATE" && b.label !== "TRUSTED CERTIFICATE" && b.label !== "X509 CERTIFICATE") {
      throw fmtErr(CODE.FORMAT, `${label}：不是证书 PEM 标签（支持 CERTIFICATE / TRUSTED CERTIFICATE）`);
    }
    const der = base64Decode(b.body, label);
    certs.push(parseCertificate(der, label, { allowTrailing: b.label === "TRUSTED CERTIFICATE" }));
  }
  return certs;
}

/**
 * 输入 → 证书数组。
 * - PEM 文本（可多块）
 * - Uint8Array：以 -----BEGIN 开头按 PEM，否则按单张 DER
 * - 文本 DER hex（可带空白/冒号/0x 前缀）
 */
export function loadCertificates(input, label = "证书输入") {
  if (input instanceof Uint8Array) {
    if (!input.length) throw fmtErr(CODE.NO_CERT, `${label}：字节输入为空`);
    const head = asciiBytes(input.subarray(0, Math.min(200, input.length)));
    if (head.includes("-----BEGIN")) return parsePemCertificates(new TextDecoder().decode(input));
    return [parseCertificate(input, `${label}（DER）`)];
  }
  const text = String(input == null ? "" : input).trim();
  if (!text) throw fmtErr(CODE.NO_CERT, `${label}：输入为空（需 PEM 证书链或 DER）`);
  if (text.includes("-----BEGIN")) return parsePemCertificates(text);
  const compact = text.replace(/^0x/i, "").replace(/[\s:]/g, "");
  if (/^[0-9a-fA-F]+$/.test(compact)) {
    if (compact.length % 2) throw fmtErr(CODE.FORMAT, `${label}：DER hex 长度为奇数`);
    if (compact.length < 16) throw fmtErr(CODE.FORMAT, `${label}：DER hex 过短，不可能是证书`);
    return [parseCertificate(hexToBytes(compact), `${label}（DER hex）`)];
  }
  throw fmtErr(
    CODE.FORMAT,
    `${label}：无法识别。需 PEM（-----BEGIN CERTIFICATE-----）或单张 DER（文件上传/hex）；` +
    "多证书 DER 请改用 PEM 拼接"
  );
}

// ============================================================
// 摘要 / 验签
// ============================================================
async function digestBytes(hashName, bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw fmtErr(CODE.FORMAT, "当前环境不支持 WebCrypto，无法计算签名摘要");
  const buf = await subtle.digest(hashName, bytes);
  return new Uint8Array(buf);
}

export async function sha256Hex(bytes) {
  return bytesToHex(await digestBytes("SHA-256", bytes));
}

function buildPkcs1Em(digestInfo, digest, k) {
  const psLen = k - digestInfo.length - digest.length - 3;
  if (psLen < 8) {
    throw fmtErr(CODE.SIGNATURE, `RSA 模数 ${k} 字节过短：PKCS#1 v1.5 要求 PS ≥ 8 字节（RFC 8017 §9.2）`);
  }
  const em = new Uint8Array(k);
  em[0] = 0x00;
  em[1] = 0x01;
  em.fill(0xff, 2, 2 + psLen);
  em[2 + psLen] = 0x00;
  em.set(digestInfo, 3 + psLen);
  em.set(digest, 3 + psLen + digestInfo.length);
  return em;
}

function verifyRsaPkcs1(cert, key, alg, digest) {
  const k = Math.ceil(key.bits / 8);
  const sig = cert.signature;
  if (sig.length !== k) {
    throw fmtErr(CODE.SIGNATURE, `RSA 签名长度 ${sig.length} 字节 ≠ 模数长度 ${k} 字节（RFC 8017 §8.2.2）`);
  }
  const s = bytesToBigInt(sig);
  if (s <= 0n || s >= key.n) {
    throw fmtErr(CODE.SIGNATURE, `RSA 签名整数 s 不在 [1, n-1]（s 位长 ${bitLength(s)}，n 位长 ${key.bits}）`);
  }
  const em = bigIntToBytes(modPow(s, key.e, key.n), k);
  const variants = [
    { name: "DigestInfo 含 NULL 参数", di: hexToBytes(DIGEST_INFO_NULL[alg.hash]) },
    { name: "DigestInfo 省略 NULL 参数", di: hexToBytes(DIGEST_INFO_ABSENT[alg.hash]) },
  ];
  for (const v of variants) {
    const expected = buildPkcs1Em(v.di, digest, k);
    if (bytesEqual(em, expected)) return { variant: v.name, emLen: k };
  }
  // 给出首个差异位置，便于定位是填充还是摘要不符
  const expected = buildPkcs1Em(variants[0].di, digest, k);
  let where = "长度";
  for (let i = 0; i < Math.min(em.length, expected.length); i++) {
    if (em[i] !== expected[i]) {
      where = i < 2 ? `头部标记（第 ${i + 1} 字节）`
        : i < 2 + (k - variants[0].di.length - digest.length - 3) ? `PS 0xFF 段（第 ${i + 1} 字节）`
        : `DigestInfo/摘要区（第 ${i + 1} 字节）`;
      break;
    }
  }
  throw fmtErr(
    CODE.SIGNATURE,
    `RSA PKCS#1 v1.5 验签失败：恢复的 EM 与期望不符（${where}；RFC 8017 §8.2.2 步骤 3）`
  );
}

function verifyEcdsa(cert, key, alg, digest) {
  let sig;
  try {
    sig = derToSig(cert.signature);
  } catch (e) {
    throw fmtErr(CODE.SIGNATURE, `ECDSA 签名 DER 解析失败：${e.message}`);
  }
  if (sig.trailing) throw fmtErr(CODE.SIGNATURE, "ECDSA 签名 DER 后有多余字节");
  const e = hashToE(digest, key.curveObj);
  const r = ecdsaVerifyRaw(key.curveObj, key.Q, sig.r, sig.s, e);
  if (!r.valid) {
    throw fmtErr(CODE.SIGNATURE, `ECDSA 验签失败：${r.reason || "R.x mod n ≠ r（验签方程不成立）"}`);
  }
  return { curve: key.curveName, rBits: bitLength(sig.r), sBits: bitLength(sig.s) };
}

function verifyEd25519(cert, key) {
  if (cert.signature.length !== 64) {
    throw fmtErr(CODE.SIGNATURE, `Ed25519 签名必须 64 字节，实际 ${cert.signature.length}`);
  }
  let ok = false;
  try {
    ok = ed25519Verify(key.pk, cert.tbsDer, cert.signature);
  } catch (e) {
    throw fmtErr(CODE.SIGNATURE, `Ed25519 验签异常：${e.message}`);
  }
  if (!ok) throw fmtErr(CODE.SIGNATURE, "Ed25519 验签失败（RFC 8032 §5.1.7）");
  return {};
}

/** 用 issuer 的公钥验证 cert 的签名；失败抛 X509VerifyError。 */
export async function verifyCertSignature(cert, issuer) {
  const where = `证书 ${cert.label}`;
  if (cert.tbsSigAlg.oid !== cert.sigAlg.oid) {
    throw fmtErr(
      CODE.ALG_MISMATCH,
      `${where}：tbsCertificate.signature（${cert.tbsSigAlg.oid}）与外层 signatureAlgorithm（${cert.sigAlg.oid}）不一致（RFC 5280 §4.1.2.3）`
    );
  }
  const alg = resolveSigAlg(cert.sigAlg.oid, where);
  assertSigParams(alg, cert.sigAlg, `${where}.signatureAlgorithm`);
  if ((cert.sigAlg.params ? 1 : 0) !== (cert.tbsSigAlg.params ? 1 : 0) ||
      (cert.sigAlg.params && cert.tbsSigAlg.params && !bytesEqual(cert.sigAlg.params.raw, cert.tbsSigAlg.params.raw))) {
    throw fmtErr(CODE.ALG_MISMATCH, `${where}：两处签名算法参数不一致`);
  }
  if (alg.kind !== issuer.publicKey.kind) {
    throw fmtErr(
      CODE.ALG_MISMATCH,
      `${where}：签名算法 ${alg.label} 与签发者公钥 ${issuer.publicKey.label} 类型不匹配`
    );
  }
  const digest = alg.hash ? await digestBytes(alg.hash, cert.tbsDer) : null;
  if (alg.kind === "rsa") {
    const r = verifyRsaPkcs1(cert, issuer.publicKey, alg, digest);
    return { alg: alg.label, digest: bytesToHex(digest), ...r };
  }
  if (alg.kind === "ecdsa") {
    const r = verifyEcdsa(cert, issuer.publicKey, alg, digest);
    return { alg: alg.label, digest: bytesToHex(digest), ...r };
  }
  const r = verifyEd25519(cert, issuer.publicKey);
  return { alg: alg.label, digest: null, ...r };
}

// ============================================================
// 链构建 / 信任锚
// ============================================================
function certPoolKey(cert) {
  return bytesToHex(cert.der);
}

function dedupeCertificates(certs, warnings) {
  const seen = new Map();
  const out = [];
  for (const c of certs) {
    const k = certPoolKey(c);
    if (seen.has(k)) {
      warnings.push(`输入含重复证书（${c.subject.text}，SHA-256 相同），已去重`);
      continue;
    }
    seen.set(k, true);
    out.push(c);
  }
  return out;
}

export function chooseLeafIndex(certs, leafSel = 0) {
  if (leafSel) {
    const i = Number(leafSel) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= certs.length) {
      throw fmtErr(CODE.FORMAT, `叶子证书序号 ${leafSel} 超出范围（1..${certs.length}）`);
    }
    return i;
  }
  const candidates = [];
  for (let i = 0; i < certs.length; i++) {
    const isIssuerOfOther = certs.some((other, j) => j !== i && sameName(other.issuer, certs[i].subject));
    if (!isIssuerOfOther) candidates.push(i);
  }
  if (candidates.length === 1) return candidates[0];
  const nonSelf = candidates.filter((i) => !sameName(certs[i].subject, certs[i].issuer));
  if (nonSelf.length === 1) return nonSelf[0];
  return 0; // 输入即链序（叶子在前）的常规约定
}

function pickIssuer(cert, candidates, warnings) {
  if (candidates.length === 1) return candidates[0];
  const keyId = cert.akiKeyId;
  if (keyId) {
    const matched = candidates.filter((c) => c.ski && c.ski.toLowerCase() === keyId.toLowerCase());
    if (matched.length === 1) return matched[0];
    if (matched.length > 1) {
      warnings.push(`证书 ${cert.subject.text} 的 AKI 命中 ${matched.length} 张同名签发者，按输入顺序选择`);
      return matched[0];
    }
  }
  warnings.push(
    `证书 ${cert.subject.text} 有 ${candidates.length} 张同名候选签发者，` +
    "AKI/SKI 未能唯一匹配，按输入顺序选择（若签名失败请补齐正确中间证书）"
  );
  return candidates[0];
}

/**
 * 按 issuer/subject 名称构建链；遇到信任锚证书即停。
 * 不在此阶段验签，签名在后续逐级检查中单独报告。
 */
export function buildCertificateChain(inputCerts, anchorCerts, leafSel, warnings) {
  const pool = [];
  const seen = new Set();
  for (const c of [...inputCerts, ...anchorCerts]) {
    const k = certPoolKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    pool.push(c);
  }
  const anchorKeys = new Set(anchorCerts.map(certPoolKey));
  const leafIdx = chooseLeafIndex(inputCerts, leafSel);
  const leaf = inputCerts[leafIdx];
  const chain = [leaf];
  if (anchorKeys.has(certPoolKey(leaf))) {
    return { chain, anchorReached: true };
  }
  for (let guard = 0; guard <= pool.length + 1; guard++) {
    const cur = chain[chain.length - 1];
    if (sameName(cur.subject, cur.issuer)) {
      return { chain, anchorReached: false };
    }
    const used = new Set(chain.map(certPoolKey));
    const candidates = pool.filter((c) => !used.has(certPoolKey(c)) && sameName(c.subject, cur.issuer));
    if (!candidates.length) {
      throw new X509VerifyError(
        CODE.CHAIN,
        `链断裂：找不到 subject = "${cur.issuer.text}" 的签发者证书（当前链 ${chain.length} 张，候选池 ${pool.length} 张）`,
        { chainSoFar: chain }
      );
    }
    const issuer = pickIssuer(cur, candidates, warnings);
    chain.push(issuer);
    if (anchorKeys.has(certPoolKey(issuer))) return { chain, anchorReached: true };
  }
  throw new X509VerifyError(CODE.CHAIN, "链构建出现环（issuer/subject 循环）", { chainSoFar: chain });
}

async function parseAnchorText(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return null;
  if (!s.includes("-----BEGIN")) {
    const compact = s.replace(/[:\s-]/g, "");
    if (/^[0-9a-fA-F]+$/.test(compact)) {
      if (compact.length !== 64) {
        throw fmtErr(CODE.FORMAT, `信任锚指纹必须是 SHA-256 的 64 个 hex 字符，实际 ${compact.length} 个`);
      }
      return { kind: "fingerprint", hex: compact.toLowerCase() };
    }
    throw fmtErr(CODE.FORMAT, "信任锚需为 PEM 证书或 SHA-256 指纹（64 hex，可带冒号）");
  }
  const certs = parsePemCertificates(s).map((c, i) => ({ ...c, label: `信任锚 #${i + 1}` }));
  if (certs.length > 1) {
    throw fmtErr(CODE.FORMAT, `信任锚一次只接受 1 张证书，当前 ${certs.length} 张；请指定链终端对应的那张`);
  }
  return { kind: "certificate", certificates: certs };
}

function resolveAt(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { ms: Date.now(), source: "当前时间" };
  if (/^\d{10}$/.test(s)) return { ms: Number(s) * 1000, source: `epoch ${s}` };
  if (/^\d{13}$/.test(s)) return { ms: Number(s), source: `epoch 毫秒 ${s}` };
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) {
    throw fmtErr(CODE.FORMAT, `验证时刻非法：${JSON.stringify(s)}（需 ISO 8601 如 2026-06-01T00:00:00Z，或 10 位 epoch 秒）`);
  }
  return { ms, source: "参数指定" };
}

function pathLenViolation(chain, issuerIndex) {
  const bc = chain[issuerIndex].basicConstraints;
  if (!bc.present || bc.pathLen == null) return null;
  let below = 0;
  for (let i = 1; i < issuerIndex; i++) below++;
  if (below > bc.pathLen) {
    return {
      max: bc.pathLen,
      actual: below,
      message: `pathLenConstraint = ${bc.pathLen}，但其下还有 ${below} 张中间 CA 证书（RFC 5280 §4.2.1.9）`,
    };
  }
  return null;
}

// ============================================================
// 主验证流程
// ============================================================
/**
 * 验证证书链。
 * @param {string|Uint8Array} input PEM 多证书 / 单 DER / DER hex
 * @param {{anchor?:string, at?:string, leaf?:number|string}} opts
 * @returns 结构化结果（verdict / trust / chain / errors / warnings / checks）
 */
export async function verifyX509(input, opts = {}) {
  const warnings = [];
  const errors = [];
  const result = {
    verdict: "FAIL",
    trust: "UNTRUSTED",
    at: null,
    anchor: null,
    chain: [],
    errors,
    warnings,
    checks: {},
  };

  let certs;
  try {
    certs = loadCertificates(input);
    certs = dedupeCertificates(certs, warnings);
  } catch (e) {
    if (e instanceof X509VerifyError) {
      errors.push({ code: e.code, message: e.message });
      return result;
    }
    throw e;
  }
  if (!certs.length) {
    errors.push({ code: CODE.NO_CERT, message: "输入中没有可用证书" });
    return result;
  }

  let at;
  try {
    at = resolveAt(opts.at);
    result.at = { ms: at.ms, iso: fmtUtc(at.ms), source: at.source };
  } catch (e) {
    if (e instanceof X509VerifyError) {
      errors.push({ code: e.code, message: e.message });
      return result;
    }
    throw e;
  }

  // 信任锚解析与指纹定位
  let anchorCerts = [];
  let anchorInfo = null;
  let fingerprint = null;
  try {
    const anchor = await parseAnchorText(opts.anchor);
    if (anchor && anchor.kind === "fingerprint") {
      fingerprint = anchor.hex;
      const fps = [];
      for (const c of certs) fps.push(await sha256Hex(c.der));
      const hit = certs.find((c, i) => fps[i] === fingerprint);
      if (!hit) {
        anchorInfo = { kind: "fingerprint", hex: fingerprint, matched: false };
      } else {
        anchorCerts = [hit];
        anchorInfo = { kind: "fingerprint", hex: fingerprint, matched: true, label: hit.label };
      }
    } else if (anchor && anchor.kind === "certificate") {
      anchorCerts = anchor.certificates;
      anchorInfo = { kind: "certificate", matched: false, label: anchorCerts[0].label };
    }
    result.anchor = anchorInfo;
  } catch (e) {
    if (e instanceof X509VerifyError) {
      errors.push({ code: e.code, message: e.message });
      return result;
    }
    throw e;
  }

  // 链构建
  let chain = [];
  let chainBuildFailed = false;
  try {
    const built = buildCertificateChain(certs, anchorCerts, opts.leaf, warnings);
    chain = built.chain;
    result.chain = chain;
  } catch (e) {
    if (e instanceof X509VerifyError) {
      chainBuildFailed = true;
      chain = e.extra && e.extra.chainSoFar ? e.extra.chainSoFar : [certs[0]];
      result.chain = chain;
      errors.push({ code: e.code, message: e.message });
    } else {
      throw e;
    }
  }

  // 指纹（展示 + 锚匹配）
  const fingerprints = [];
  for (const c of chain) fingerprints.push(await sha256Hex(c.der));
  result.chain = chain.map((c, i) => ({ ...c, index: i + 1, fingerprint: fingerprints[i] }));

  // 信任判定（链未闭合时，锚不匹配只是次生现象，不再重复报错）
  if (anchorInfo && !chainBuildFailed) {
    if (anchorInfo.kind === "fingerprint") {
      const terminal = chain[chain.length - 1];
      const terminalFp = fingerprints[chain.length - 1];
      if (terminalFp === anchorInfo.hex) {
        result.trust = "ANCHORED";
        anchorInfo.matched = true;
      } else {
        errors.push({
          code: CODE.ANCHOR,
          message: `信任锚不匹配：链终端（#${chain.length} ${terminal.subject.text}）SHA-256 = ` +
            `${wrapHexColon(terminalFp)}，指定指纹 = ${wrapHexColon(anchorInfo.hex)}`,
        });
        result.trust = "MISMATCH";
      }
    } else {
      const terminal = chain[chain.length - 1];
      const hit = anchorCerts.find((a) => bytesEqual(a.der, terminal.der));
      if (hit) {
        result.trust = "ANCHORED";
        anchorInfo.matched = true;
        anchorInfo.label = hit.subject.text;
      } else {
        errors.push({
          code: CODE.ANCHOR,
          message: `信任锚不匹配：链终端（#${chain.length} ${terminal.subject.text}，SHA-256 ` +
            `${wrapHexColon(fingerprints[chain.length - 1])}）与提供的锚证书不同`,
        });
        result.trust = "MISMATCH";
      }
    }
  }

  // 逐级验签
  const linkChecks = [];
  if (result.trust === "ANCHORED" && chain.length === 1) {
    warnings.push("信任锚即叶子证书：直接信任该证书，未验证其签发链（适合证书 pinning，不是常规 CA 路径验证）");
  }
  for (let i = 0; i + 1 < chain.length; i++) {
    try {
      const r = await verifyCertSignature(chain[i], chain[i + 1]);
      linkChecks.push({ from: i + 1, by: i + 2, ok: true, ...r });
    } catch (e) {
      if (!(e instanceof X509VerifyError)) throw e;
      linkChecks.push({ from: i + 1, by: i + 2, ok: false, code: e.code, reason: e.message });
      errors.push({ code: e.code, message: `#${i + 1} → #${i + 2}：${e.message}` });
    }
  }
  // 自签名终端（根或自签锚）也要验证自身签名
  const terminal = chain[chain.length - 1];
  let selfCheck = null;
  if (sameName(terminal.subject, terminal.issuer)) {
    try {
      const r = await verifyCertSignature(terminal, terminal);
      selfCheck = { ok: true, ...r };
    } catch (e) {
      if (!(e instanceof X509VerifyError)) throw e;
      selfCheck = { ok: false, code: e.code, reason: e.message };
      errors.push({ code: e.code, message: `#${chain.length} 自签名验证失败：${e.message}` });
    }
  } else if (result.trust === "ANCHORED") {
    warnings.push("信任锚非自签名证书（RFC 5280 允许：信任来自本地配置，不要求自签名）");
  }

  // 有效期
  const validityChecks = [];
  for (let i = 0; i < chain.length; i++) {
    const c = chain[i];
    const state = at.ms < c.notBefore.ms ? "notYetValid" : at.ms > c.notAfter.ms ? "expired" : "valid";
    validityChecks.push({ index: i + 1, state, notBefore: c.notBefore.ms, notAfter: c.notAfter.ms });
    if (state === "expired") {
      errors.push({
        code: CODE.EXPIRED,
        message: `#${i + 1} ${c.subject.text} 已过期：notAfter = ${fmtUtc(c.notAfter.ms)}，判定时刻 ${fmtUtc(at.ms)}`,
      });
    } else if (state === "notYetValid") {
      errors.push({
        code: CODE.NOT_YET_VALID,
        message: `#${i + 1} ${c.subject.text} 尚未生效：notBefore = ${fmtUtc(c.notBefore.ms)}，判定时刻 ${fmtUtc(at.ms)}`,
      });
    }
  }

  // CA 位 / keyUsage / pathLen
  const caChecks = [];
  for (let i = 1; i < chain.length; i++) {
    const c = chain[i];
    const bc = c.basicConstraints;
    const ku = c.keyUsage;
    let ok = true;
    if (bc.present) {
      if (!bc.ca) {
        ok = false;
        errors.push({
          code: CODE.CA,
          message: `#${i + 1} ${c.subject.text} 的 basicConstraints 为 CA:FALSE，不能作为签发者（RFC 5280 §4.2.1.9）`,
        });
      }
      const pl = pathLenViolation(chain, i);
      if (pl) {
        ok = false;
        errors.push({ code: CODE.CA, message: `#${i + 1} ${c.subject.text}：${pl.message}` });
      }
    } else {
      warnings.push(`#${i + 1} ${c.subject.text} 未声明 basicConstraints（老证书/信任锚常见；按宽松口径放行）`);
    }
    if (ku.present && !ku.keyCertSign) {
      ok = false;
      errors.push({
        code: CODE.CA,
        message: `#${i + 1} ${c.subject.text} 的 keyUsage 未置 keyCertSign，不能签发证书（RFC 5280 §4.2.1.3）`,
      });
    }
    caChecks.push({ index: i + 1, ok, ca: bc.present ? bc.ca : null, pathLen: bc.pathLen, keyCertSign: ku.present ? ku.keyCertSign : null });
  }

  // 未知关键扩展（链路内任一证书）
  for (let i = 0; i < chain.length; i++) {
    for (const oid of chain[i].unknownCritical) {
      errors.push({
        code: CODE.CRITICAL_EXT,
        message: `#${i + 1} ${chain[i].subject.text} 含未处理的关键扩展 OID ${oid}（RFC 5280 §4.2：必须拒绝）`,
      });
    }
  }

  // 叶子自身若带 CA:TRUE，只提示
  if (chain[0] && chain[0].basicConstraints.present && chain[0].basicConstraints.ca) {
    warnings.push("叶子证书自身带 CA:TRUE（不阻断链验证，但请确认用途）");
  }
  if (chain[0] && chain[0].basicConstraints.present && !chain[0].basicConstraints.ca) {
    // 正常
  }

  result.checks = {
    links: linkChecks,
    self: selfCheck,
    validity: validityChecks,
    ca: caChecks,
    unknownCritical: chain.reduce((n, c) => n + c.unknownCritical.length, 0),
  };
  result.verdict = errors.length ? "FAIL" : "PASS";
  return result;
}

// ============================================================
// 输出格式化
// ============================================================
function keyUsageText(ku) {
  return ku.present ? ku.names.join(", ") || "(无位)" : "未声明";
}

function basicConstraintsText(bc) {
  if (!bc.present) return "未声明";
  return `CA=${bc.ca ? "TRUE" : "FALSE"}${bc.pathLen == null ? "" : `, pathLen=${bc.pathLen}`}`;
}

function validityStateText(v, atMs) {
  if (v.state === "expired") return `已过期，notAfter ${fmtUtc(v.notAfter)}`;
  if (v.state === "notYetValid") return `尚未生效，notBefore ${fmtUtc(v.notBefore)}`;
  const days = Math.floor((v.notAfter - atMs) / 86400000);
  return `有效，剩余 ${days} 天`;
}

export function formatX509Result(result) {
  const out = [];
  out.push("X.509 证书链验签（ITU-T X.509 / RFC 5280）");
  out.push(`验签结论：${result.verdict}`);
  if (result.trust === "ANCHORED") {
    out.push(`信任判定：ANCHORED（已用自备信任锚建立信任）`);
  } else if (result.trust === "MISMATCH") {
    out.push("信任判定：MISMATCH（提供了信任锚，但与链终端不匹配）");
  } else if (result.anchor) {
    out.push("信任判定：UNTRUSTED（提供了信任锚，但链未闭合，信任未建立）");
  } else {
    out.push("信任判定：UNTRUSTED（未提供信任锚；自签名根通过只说明链内一致，不等于可信）");
  }
  if (result.at) out.push(`判定时刻：${result.at.iso}（${result.at.source}）`);
  if (result.anchor) {
    if (result.anchor.kind === "fingerprint") {
      out.push(`信任锚：SHA-256 指纹 ${wrapHexColon(result.anchor.hex)}${result.anchor.matched ? "（已匹配）" : "（未匹配）"}`);
    } else {
      out.push(`信任锚：证书 ${result.anchor.label || ""}${result.anchor.matched ? "（已匹配）" : "（未匹配）"}`);
    }
  } else {
    out.push("信任锚：未提供（不内置系统根、不联网）");
  }
  out.push("");

  if (!result.chain.length) {
    out.push("[链路] 无（输入解析失败）");
  } else {
    out.push(`[链路] 共 ${result.chain.length} 张（#1 = 叶子）`);
    result.chain.forEach((c, i) => {
      const idx = i + 1;
      const chainLabel = i === 0 ? "叶子" : i === result.chain.length - 1 ? "链终端" : "中间 CA";
      out.push(`#${idx} ${chainLabel}：${c.subject.text}`);
      out.push(`    签发者：${c.issuer.text}`);
      out.push(`    序列号：${c.serialHex ? wrapHexColon(c.serialHex) : "(空)"}`);
      out.push(`    有效期：${fmtUtc(c.notBefore.ms)} → ${fmtUtc(c.notAfter.ms)}（${validityStateText(result.checks.validity[i], result.at.ms)}）`);
      out.push(`    公钥：${c.publicKey.label}`);
      out.push(`    签名算法：${c.sigAlg.oid}${SIG_ALGORITHMS[c.sigAlg.oid] ? `（${SIG_ALGORITHMS[c.sigAlg.oid].label}）` : ""}`);
      out.push(`    SHA-256：${wrapHexColon(c.fingerprint)}`);
      out.push(`    BasicConstraints：${basicConstraintsText(c.basicConstraints)}`);
      out.push(`    KeyUsage：${keyUsageText(c.keyUsage)}`);
      out.push(`    SKI：${c.ski ? wrapHexColon(c.ski) : "未声明"}${c.akiKeyId ? ` · AKI：${wrapHexColon(c.akiKeyId)}` : ""}`);
      if (c.extNames.length) out.push(`    扩展：${c.extNames.join(" / ")}`);
      const link = result.checks.links.find((l) => l.from === idx);
      if (link) {
        out.push(link.ok
          ? `    链签名：由 #${link.by} 验证 通过（${link.alg}）`
          : `    链签名：由 #${link.by} 验证 失败 [${link.code}] ${link.reason}`);
      }
      if (i === result.chain.length - 1 && result.checks.self) {
        out.push(result.checks.self.ok
          ? `    自签名：通过（${result.checks.self.alg}）`
          : `    自签名：失败 [${result.checks.self.code}] ${result.checks.self.reason}`);
      }
      out.push("");
    });
  }

  out.push("[检查汇总]");
  const links = result.checks.links || [];
  const okLinks = links.filter((l) => l.ok).length;
  out.push(`  逐级验签：${okLinks}/${links.length} 通过${result.checks.self ? `；终端自签名 ${result.checks.self.ok ? "通过" : "失败"}` : ""}`);
  const validity = result.checks.validity || [];
  out.push(`  有效期：${validity.filter((v) => v.state === "valid").length}/${validity.length} 在有效期内`);
  const ca = result.checks.ca || [];
  out.push(`  CA 约束：${ca.filter((c) => c.ok).length}/${ca.length} 通过`);
  out.push(`  未处理关键扩展：${result.checks.unknownCritical || 0}`);

  if (result.errors.length) {
    out.push("", `[错误] 共 ${result.errors.length} 项（全部显式报出，不静默通过）`);
    result.errors.forEach((e, i) => out.push(`  ${i + 1}. [${e.code}] ${e.message}`));
  } else {
    out.push("", "[错误] 无");
  }
  if (result.warnings.length) {
    out.push("", `[警告] 共 ${result.warnings.length} 项`);
    result.warnings.forEach((w, i) => out.push(`  ${i + 1}. ${w}`));
  } else {
    out.push("", "[警告] 无");
  }

  out.push("");
  out.push("支持：RSA PKCS#1 v1.5（SHA-256/384/512）、ECDSA P-256/P-384/P-521、Ed25519；");
  out.push("不做：CRL/OCSP、策略树、NameConstraints、系统根内置、网络访问。");
  return out.join("\n");
}

export async function x509VerifyRun(text, p = {}) {
  const params = p || {};
  let input = text;
  if (params.rawBytes && params.rawBytes.length) {
    input = params.rawBytes instanceof Uint8Array ? params.rawBytes : new Uint8Array(params.rawBytes);
  }
  try {
    const result = await verifyX509(input, {
      anchor: params.anchor,
      at: params.at,
      leaf: params.leaf,
    });
    return formatX509Result(result);
  } catch (e) {
    if (e instanceof X509VerifyError) {
      return [
        "X.509 证书链验签（ITU-T X.509 / RFC 5280）",
        "验签结论：FAIL",
        "",
        `[错误] [${e.code}] ${e.message}`,
      ].join("\n");
    }
    throw e;
  }
}

// ============================================================
// 注册
// ============================================================
register({
  id: "x509Verify",
  cat: "asym",
  name: "X.509 证书链验签",
  desc: "X.509 证书链验签：解析 PEM 多证书或单张 DER，逐级用签发者公钥验签（RSA PKCS#1 v1.5 SHA-256/384/512、ECDSA P-256/384/521、Ed25519），检查有效期、issuer/subject 衔接、CA 位/keyCertSign/pathLen，可自备信任锚证书或 SHA-256 指纹；不联网、不内置系统根、不做 CRL/OCSP。",
  acceptsBytes: true,
  params: [
    {
      key: "anchor",
      label: "信任锚（PEM 证书或 SHA-256 指纹，留空则只验链不判信任）",
      type: "text",
      default: "",
      placeholder: "-----BEGIN CERTIFICATE----- … 或 AB:CD:…（64 hex）",
    },
    {
      key: "at",
      label: "验证时刻（ISO 8601 / epoch 秒，留空=当前）",
      type: "text",
      default: "",
      placeholder: "2026-06-01T00:00:00Z",
    },
    {
      key: "leaf",
      label: "叶子证书序号（0=自动）",
      type: "number",
      default: 0,
    },
  ],
  run: x509VerifyRun,
});

export { X509VerifyError, CODE as X509_ERROR_CODES };
