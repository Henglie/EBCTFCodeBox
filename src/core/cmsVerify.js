/*
 * cmsVerify.js — CMS / PKCS#7 SignedData 验签（RFC 5652）
 *
 * 支持范围（显式声明，未做的项在下文与输出中标注）：
 *   - ContentInfo/signedData（OID 1.2.840.113549.1.7.2），DER 与 BER（含不定长）解析；
 *   - attached（eContent 内嵌 OCTET STRING）与 detached（外部原文）；
 *   - 多 SignerInfo 逐个验证；issuerAndSerialNumber 与 subjectKeyIdentifier 两种 sid；
 *   - signedAttrs 的 contentType / messageDigest 校验（签名输入按 RFC 5652 §5.4
 *     使用 SignedAttributes 的 DER SET OF 编码，而非 [0] IMPLICIT 标签）；
 *   - 摘要 SHA-256 / SHA-384 / SHA-512；
 *   - 签名 RSA PKCS#1 v1.5（rsaEncryption 或 sha*WithRSAEncryption）与
 *     ECDSA P-256 / P-384 / P-521（ecdsa-with-SHA256/384/512）；
 *   - 证书集解析：只提取签名者证书的 subject/issuer/serial/validity/SPKI/SKID/KeyUsage，
 *     不做证书链、信任锚、CRL、OCSP、时间戳、签名策略校验。
 *
 * 标准依据：
 *   - RFC 5652 §5 SignedData / §5.3 SignerInfo / §5.4 SignedAttributes；
 *   - RFC 8017 §8.2.2 / §9.2 RSASSA-PKCS1-v1_5 验证与 EMSA-PKCS1-v1_5；
 *   - RFC 5758 §3.2 ECDSA 与 SHA-2 组合；
 *   - RFC 5280 §4.1 证书结构、§4.2.1.2 SubjectKeyIdentifier；
 *   - ITU-T X.690 BER/DER（本文件自带短/长/不定长 TLV 解析，签名输入统一重编码为 DER）；
 *   - FIPS 186-4 / ANSI X9.62 ECDSA 验证（复用仓内 ecdsa.js 原语）。
 *
 * 复用（不复制）：rsagen.js 的 DER 编码器；pemkeys.js 的 PEM/base64/OID；
 * ecdsa.js 的曲线表/点解析/ECDSA 验签；primeGen.js 的模幂。
 *
 * 红线：算法层零 UI 依赖；纯本地零外发；验签确定性计算，不取随机数。
 */
import { register } from "./registry.js";
import {
  derEncode, derSeq, derOid, derNull, derOctetString,
} from "./rsagen.js";
import { base64Decode, oidString } from "./pemkeys.js";
import { CURVES, ecdsaVerifyRaw, hashToE, parsePoint } from "./ecdsa.js";
import { modPow } from "./primeGen.js";

const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_DEPTH = 96;
const tdUtf8 = new TextDecoder("utf-8", { fatal: false });
const tdLatin1 = new TextDecoder("latin1");
const te = new TextEncoder();

// ============================================================
// 基础字节工具
// ============================================================

function bytesToHex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(text) {
  const t = String(text || "").trim().replace(/^0x/i, "").replace(/[\s:]/g, "");
  if (!t) return new Uint8Array(0);
  if (!/^[0-9a-fA-F]+$/.test(t)) throw new Error("hex 输入含非十六进制字符");
  if (t.length % 2) throw new Error("hex 输入长度为奇数（hex 必须按字节成对）");
  const out = new Uint8Array(t.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(t.substr(i * 2, 2), 16);
  return out;
}

function bytesToBigInt(bytes) {
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  return v;
}

function bigIntToBytes(v, len, what) {
  if (v < 0n) throw new Error(`${what} 为负数，无法按无符号大端输出`);
  const h = v.toString(16).padStart(2, "0");
  const raw = hexToBytes(h.length % 2 ? "0" + h : h);
  if (raw.length > len) throw new Error(`${what} 超出 ${len} 字节`);
  const out = new Uint8Array(len);
  out.set(raw, len - raw.length);
  return out;
}

function bigIntBitLen(v) {
  return v <= 0n ? 0 : v.toString(2).length;
}

function ctEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i];
  return r === 0;
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ============================================================
// BER/DER TLV 解析
// ============================================================
// 解析器接受 BER 的定长与不定长构造形式；签名输入与证书匹配统一重编码为 DER。
// 多字节 tag 号在 CMS SignedData 的必需字段中不出现，遇到即显式拒绝。

function parseTlv(u8, off, depth, limit) {
  if (depth > MAX_DEPTH) throw new Error(`BER/DER 嵌套超过 ${MAX_DEPTH} 层（拒绝递归炸弹）`);
  if (off + 2 > limit) throw new Error(`TLV 在偏移 ${off} 处不足 2 字节（数据被截断）`);
  const tag = u8[off];
  if ((tag & 0x1f) === 0x1f) throw new Error(`不支持多字节 tag（偏移 ${off}，tag 0x${tag.toString(16)}）`);
  const constructed = (tag & 0x20) !== 0;
  let p = off + 1;
  const firstLen = u8[p];
  if (firstLen === 0x80) {
    if (!constructed) throw new Error(`原始类型不得使用不定长（偏移 ${off}，tag 0x${tag.toString(16)}）`);
    const contentStart = p + 1;
    const children = [];
    let q = contentStart;
    for (;;) {
      if (q + 2 > limit) throw new Error(`不定长 TLV（偏移 ${off}）缺少 EOC 00 00（数据被截断）`);
      if (u8[q] === 0 && u8[q + 1] === 0) { q += 2; break; }
      const c = parseTlv(u8, q, depth + 1, limit);
      children.push(c);
      q = c.end;
    }
    return { tag, constructed, indefinite: true, value: u8.slice(contentStart, q - 2), children, start: off, end: q };
  }
  let contentStart = p + 1;
  let len = firstLen;
  if (firstLen & 0x80) {
    const n = firstLen & 0x7f;
    if (n === 0 || n > 4) throw new Error(`长度字段非法（偏移 ${off}，0x80|${n}）`);
    if (contentStart + n > limit) throw new Error(`长度字段被截断（偏移 ${off}）`);
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + u8[contentStart + i];
    contentStart += n;
  }
  const end = contentStart + len;
  if (end > limit) throw new Error(`TLV 内容长度 ${len} 越界（偏移 ${off}，剩余 ${limit - contentStart} 字节）`);
  const value = u8.slice(contentStart, end);
  const node = { tag, constructed, indefinite: false, value, children: null, start: off, end };
  if (constructed) {
    const children = [];
    let q = contentStart;
    while (q < end) {
      const c = parseTlv(u8, q, depth + 1, end);
      children.push(c);
      q = c.end;
    }
    node.children = children;
  }
  return node;
}

function parseRoot(u8, what = "输入") {
  if (!(u8 instanceof Uint8Array) || u8.length === 0) throw new Error(`${what}为空`);
  if (u8.length > MAX_INPUT_BYTES) throw new Error(`${what}超过 ${MAX_INPUT_BYTES} 字节上限`);
  const node = parseTlv(u8, 0, 0, u8.length);
  if (node.end !== u8.length) {
    throw new Error(`${what}根 TLV 结束于 ${node.end}，其后仍有 ${u8.length - node.end} 字节尾随（DER 不允许 / BER 单对象不允许）`);
  }
  return node;
}

function expectTag(node, tag, what) {
  if (!node || node.tag !== tag) {
    throw new Error(`${what}标签应为 0x${tag.toString(16)}，实际 ${node ? "0x" + node.tag.toString(16) : "缺失"}`);
  }
}

function readOid(node, what) {
  expectTag(node, 0x06, `${what} OID`);
  return oidString(node.value);
}

function readInteger(node, what) {
  expectTag(node, 0x02, `${what} INTEGER`);
  return bytesToBigInt(node.value);
}

function readOctetString(node, what) {
  if (!node) throw new Error(`${what}缺失`);
  if (node.tag === 0x04) return node.value;
  if (node.tag === 0x24 && node.children) {
    return concatBytes(node.children.map((c) => readOctetString(c, what)));
  }
  throw new Error(`${what}不是 OCTET STRING（tag 0x${node.tag.toString(16)}）`);
}

function readAlgId(node, what) {
  expectTag(node, 0x30, `${what} AlgorithmIdentifier`);
  const ch = node.children || [];
  if (ch.length < 1 || ch[0].tag !== 0x06) throw new Error(`${what} AlgorithmIdentifier 缺 algorithm OID`);
  return {
    oid: oidString(ch[0].value),
    params: ch[1] || null,
    node,
  };
}

// ============================================================
// OID 表
// ============================================================

const HASHES = {
  "2.16.840.1.101.3.4.2.1": { key: "sha256", norm: "SHA-256", label: "SHA-256", hLen: 32, arcs: [2, 16, 840, 1, 101, 3, 4, 2, 1] },
  "2.16.840.1.101.3.4.2.2": { key: "sha384", norm: "SHA-384", label: "SHA-384", hLen: 48, arcs: [2, 16, 840, 1, 101, 3, 4, 2, 2] },
  "2.16.840.1.101.3.4.2.3": { key: "sha512", norm: "SHA-512", label: "SHA-512", hLen: 64, arcs: [2, 16, 840, 1, 101, 3, 4, 2, 3] },
};

const UNSUPPORTED_HASHES = {
  "1.3.14.3.2.26": "SHA-1",
  "1.2.840.113549.2.5": "MD5",
  "2.16.840.1.101.3.4.2.4": "SHA-224",
  "2.16.840.1.101.3.4.2.5": "SHA-512/224",
  "2.16.840.1.101.3.4.2.6": "SHA-512/256",
};

const SIGNATURE_ALGS = {
  "1.2.840.113549.1.1.1": { kind: "rsa", label: "RSA PKCS#1 v1.5（rsaEncryption）", hash: null },
  "1.2.840.113549.1.1.11": { kind: "rsa", label: "sha256WithRSAEncryption", hash: "sha256" },
  "1.2.840.113549.1.1.12": { kind: "rsa", label: "sha384WithRSAEncryption", hash: "sha384" },
  "1.2.840.113549.1.1.13": { kind: "rsa", label: "sha512WithRSAEncryption", hash: "sha512" },
  "1.2.840.10045.4.3.2": { kind: "ecdsa", label: "ecdsa-with-SHA256", hash: "sha256" },
  "1.2.840.10045.4.3.3": { kind: "ecdsa", label: "ecdsa-with-SHA384", hash: "sha384" },
  "1.2.840.10045.4.3.4": { kind: "ecdsa", label: "ecdsa-with-SHA512", hash: "sha512" },
};

const SIGNATURE_ALG_NAMES = {
  "1.2.840.113549.1.1.2": "md2WithRSAEncryption",
  "1.2.840.113549.1.1.4": "md5WithRSAEncryption",
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.10": "RSASSA-PSS",
  "1.2.840.10045.4.1": "ecdsa-with-SHA1",
  "1.2.840.10045.4.3.1": "ecdsa-with-SHA224",
};

const OID_LABELS = {
  "1.2.840.113549.1.7.1": "id-data",
  "1.2.840.113549.1.7.2": "signedData",
  "1.2.840.113549.1.9.3": "contentType",
  "1.2.840.113549.1.9.4": "messageDigest",
  "1.2.840.113549.1.9.5": "signingTime",
  "1.2.840.113549.1.9.6": "counterSignature",
  "1.2.840.113549.1.9.16.2.14": "signatureTimeStampToken",
  "1.2.840.113549.1.1.1": "rsaEncryption",
  "1.2.840.10045.2.1": "id-ecPublicKey",
  "2.5.29.14": "subjectKeyIdentifier",
  "2.5.29.15": "keyUsage",
  "2.5.29.19": "basicConstraints",
};

function oidLabel(oid) {
  return `${OID_LABELS[oid] || "未知 OID"} (${oid})`;
}

function hashLabel(oid) {
  if (HASHES[oid]) return `${HASHES[oid].label} (${oid})`;
  if (UNSUPPORTED_HASHES[oid]) return `${UNSUPPORTED_HASHES[oid]} (${oid}，不支持)`;
  return `未知摘要算法 (${oid})`;
}

function sigAlgLabel(oid) {
  if (SIGNATURE_ALGS[oid]) return `${SIGNATURE_ALGS[oid].label} (${oid})`;
  if (SIGNATURE_ALG_NAMES[oid]) return `${SIGNATURE_ALG_NAMES[oid]} (${oid}，不支持)`;
  return `未知签名算法 (${oid})`;
}

// ============================================================
// 哈希与 RSA PKCS#1 v1.5
// ============================================================

async function digestBytes(hashInfo, data) {
  if (!globalThis.crypto?.subtle) throw new Error("当前环境不支持 WebCrypto，无法计算摘要");
  return new Uint8Array(await crypto.subtle.digest(hashInfo.norm, data));
}

function buildDigestInfo(hashInfo, digest) {
  return derEncode(derSeq(
    derSeq(derOid(hashInfo.arcs), derNull()),
    derOctetString(digest)
  ));
}

/**
 * RSASSA-PKCS1-v1_5 验签（RFC 8017 §8.2.2）：
 * s = SIG^e mod n；EM = 0x00 || 0x01 || 0xFF... || 0x00 || DigestInfo，逐字节比对。
 */
function rsaPkcs1Verify(sigBytes, digestInfo, n, e) {
  const k = Math.ceil(bigIntBitLen(n) / 8);
  if (sigBytes.length !== k) {
    return { ok: false, reason: `RSA 签名长度 ${sigBytes.length} 字节 ≠ 模数长度 ${k} 字节` };
  }
  const s = bytesToBigInt(sigBytes);
  if (s <= 0n || s >= n) {
    return { ok: false, reason: `RSA 签名整数不在 [1, n-1] 区间（s 位长 ${bigIntBitLen(s)}，n 位长 ${bigIntBitLen(n)}）` };
  }
  const em = bigIntToBytes(modPow(s, e, n), k, "RSA 恢复的 EM");
  const tLen = digestInfo.length;
  const psLen = k - tLen - 3;
  if (psLen < 8) {
    return { ok: false, reason: `RSA 模数过短：EM 的 PS 段仅 ${psLen} 字节（RFC 8017 §9.2 要求 ≥8）` };
  }
  if (em[0] !== 0x00 || em[1] !== 0x01) {
    return { ok: false, reason: `RSA EM 头部不是 00 01（实际 ${bytesToHex(em.subarray(0, 2))}）` };
  }
  for (let i = 2; i < 2 + psLen; i++) {
    if (em[i] !== 0xff) return { ok: false, reason: `RSA EM 的 PS 段第 ${i - 1} 字节不是 0xFF` };
  }
  if (em[2 + psLen] !== 0x00) {
    return { ok: false, reason: "RSA EM 的 PS 段后缺少 0x00 分隔符" };
  }
  const t = em.subarray(3 + psLen);
  if (!ctEqual(t, digestInfo)) {
    return { ok: false, reason: "RSA EM 中的 DigestInfo 与重算摘要不一致（内容/签名/证书不匹配）" };
  }
  return { ok: true, reason: "RSA PKCS#1 v1.5 验签通过" };
}

// ============================================================
// X.509 证书解析（只取验签所需字段）
// ============================================================

const DN_SHORT = {
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
  "0.9.2342.19200300.100.1.1": "UID",
  "0.9.2342.19200300.100.1.25": "DC",
  "1.2.840.113549.1.9.1": "emailAddress",
};

const EC_CURVES = {
  "1.2.840.10045.3.1.7": { key: "p256", label: "P-256 (secp256r1)" },
  "1.3.132.0.34": { key: "p384", label: "P-384 (secp384r1)" },
  "1.3.132.0.35": { key: "p521", label: "P-521 (secp521r1)" },
};

const KEY_USAGE_BITS = [
  "digitalSignature", "nonRepudiation/contentCommitment", "keyEncipherment",
  "dataEncipherment", "keyAgreement", "keyCertSign", "cRLSign",
  "encipherOnly", "decipherOnly",
];

function decodeAsn1String(node) {
  try {
    if (node.tag === 0x1e) return new TextDecoder("utf-16be").decode(node.value);
    if (node.tag === 0x1c) {
      let s = "";
      const v = node.value;
      for (let i = 0; i + 3 < v.length; i += 4) {
        s += String.fromCodePoint(((v[i] << 24) | (v[i + 1] << 16) | (v[i + 2] << 8) | v[i + 3]) >>> 0);
      }
      return s;
    }
    if (node.tag === 0x14) return tdLatin1.decode(node.value);
    if (node.tag === 0x0c || node.tag === 0x13 || node.tag === 0x16 || node.tag === 0x1a || node.tag === 0x12) {
      return tdUtf8.decode(node.value);
    }
  } catch { /* 降级 hex */ }
  return null;
}

function formatName(node, what) {
  if (!node || node.tag !== 0x30 || !node.children) throw new Error(`${what} DN 结构非法（X.501 RDNSequence 应为 SEQUENCE）`);
  const rdns = [];
  for (const rdn of node.children) {
    if (rdn.tag !== 0x31 || !rdn.children) throw new Error(`${what} DN 的 RDN 不是 SET（X.501）`);
    const atvs = [];
    for (const atv of rdn.children) {
      if (atv.tag !== 0x30 || !atv.children || atv.children.length < 2 || atv.children[0].tag !== 0x06) {
        throw new Error(`${what} DN 的 AttributeTypeAndValue 结构非法（X.501）`);
      }
      const oid = oidString(atv.children[0].value);
      const valNode = atv.children[1];
      const text = decodeAsn1String(valNode);
      const val = text == null ? `#${bytesToHex(valNode.value)}` : text;
      atvs.push(`${DN_SHORT[oid] || oid}=${val}`);
    }
    rdns.push(atvs.join("+"));
  }
  return rdns.reverse().join(","); // RFC 4514 逆序
}

function parseTimeNode(node, what) {
  const raw = tdLatin1.decode(node.value);
  let ms;
  if (node.tag === 0x17) {
    const m = /^(\d{10}|\d{12})(Z|[+-]\d{4})$/.exec(raw);
    if (!m) throw new Error(`${what} 的 UTCTime 非法：${JSON.stringify(raw)}`);
    const d = m[1];
    const yy = Number(d.slice(0, 2));
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    ms = Date.UTC(year, +d.slice(2, 4) - 1, +d.slice(4, 6), +d.slice(6, 8), +d.slice(8, 10), d.length >= 12 ? +d.slice(10, 12) : 0);
    if (m[2] !== "Z") ms += offsetMs(m[2]);
  } else if (node.tag === 0x18) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?(Z|[+-]\d{4})$/.exec(raw);
    if (!m) throw new Error(`${what} 的 GeneralizedTime 非法：${JSON.stringify(raw)}`);
    ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (m[7]) ms += Math.round(parseFloat(m[7]) * 1000);
    if (m[8] !== "Z") ms += offsetMs(m[8]);
  } else {
    throw new Error(`${what} 不是 UTCTime/GeneralizedTime（tag 0x${node.tag.toString(16)}）`);
  }
  return { ms, raw, text: new Date(ms).toISOString().replace("T", " ").slice(0, 19) + " UTC" };
}

function offsetMs(off) {
  const om = ((+off.slice(1, 3)) * 60 + (+off.slice(3, 5))) * 60000;
  return off[0] === "+" ? -om : om;
}

function parseExtensions(tail) {
  const extWrap = tail.find((n) => n.tag === 0xa3);
  if (!extWrap) return [];
  const seq = extWrap.children && extWrap.children[0];
  if (!seq || seq.tag !== 0x30 || !seq.children) throw new Error("证书 extensions [3] 结构非法（RFC 5280 §4.1.2.9）");
  return seq.children.map((ext, i) => {
    if (ext.tag !== 0x30 || !ext.children || ext.children.length < 2 || ext.children[0].tag !== 0x06) {
      throw new Error(`证书第 ${i + 1} 个 Extension 结构非法（RFC 5280 §4.2）`);
    }
    let j = 1;
    let critical = false;
    if (ext.children[j] && ext.children[j].tag === 0x01) {
      critical = ext.children[j].value[0] !== 0;
      j++;
    }
    const oct = ext.children[j];
    if (!oct || oct.tag !== 0x04) throw new Error(`证书第 ${i + 1} 个 Extension 缺 extnValue OCTET STRING`);
    return { oid: oidString(ext.children[0].value), critical, valueDer: oct.value };
  });
}

function parseKeyUsage(der) {
  const inner = parseRoot(der, "KeyUsage 扩展");
  expectTag(inner, 0x03, "KeyUsage");
  const bits = [];
  const unused = inner.value[0];
  const body = inner.value.subarray(1);
  for (let i = 0; i < body.length * 8 - unused; i++) {
    if ((body[i >> 3] >> (7 - (i & 7))) & 1) bits.push(KEY_USAGE_BITS[i] || `bit${i}`);
  }
  return bits;
}

function parseSpki(spkiNode) {
  expectTag(spkiNode, 0x30, "SubjectPublicKeyInfo");
  const ch = spkiNode.children || [];
  if (ch.length < 2) throw new Error("SubjectPublicKeyInfo 结构非法（RFC 5280 §4.1：SEQUENCE{algorithm, subjectPublicKey}）");
  const alg = readAlgId(ch[0], "证书公钥");
  const bit = ch[1];
  expectTag(bit, 0x03, "证书 subjectPublicKey BIT STRING");
  if (bit.value.length < 2) throw new Error("证书 subjectPublicKey BIT STRING 内容过短");
  if (bit.value[0] !== 0) throw new Error(`证书公钥 BIT STRING 有 ${bit.value[0]} 个未用位（公钥必须字节对齐）`);
  const keyBytes = bit.value.subarray(1);

  if (alg.oid === "1.2.840.113549.1.1.1") {
    const inner = parseRoot(keyBytes, "RSA 公钥");
    expectTag(inner, 0x30, "RSAPublicKey");
    const rc = inner.children || [];
    if (rc.length < 2) throw new Error("RSAPublicKey 结构非法（RFC 8017 §A.1.1：SEQUENCE{n,e}）");
    const n = readInteger(rc[0], "RSA n");
    const e = readInteger(rc[1], "RSA e");
    if (n <= 0n || e <= 0n) throw new Error("RSA 公钥 n/e 必须为正整数");
    return { kind: "rsa", oid: alg.oid, n, e, bits: bigIntBitLen(n), label: `RSA ${bigIntBitLen(n)} 位（e=${e}）` };
  }
  if (alg.oid === "1.2.840.10045.2.1") {
    if (!alg.params || alg.params.tag !== 0x06) throw new Error("EC 公钥缺曲线 OID 参数（RFC 5480 §2.1.1）");
    const curveOid = oidString(alg.params.value);
    const curve = EC_CURVES[curveOid];
    if (!curve) throw new Error(`不支持 EC 曲线 OID ${curveOid}（支持 P-256/P-384/P-521）`);
    const pointHex = bytesToHex(keyBytes);
    const Q = parsePoint(pointHex, CURVES[curve.key], "证书公钥点");
    return { kind: "ec", oid: alg.oid, curveOid, curveKey: curve.key, curveLabel: curve.label, point: Q, pointHex, label: `EC ${curve.label}` };
  }
  throw new Error(`不支持的证书公钥算法 OID ${alg.oid}（支持 RSA / EC P-256/P-384/P-521）`);
}

/**
 * 解析 X.509 Certificate，返回验签所需字段。
 * 注意：只解析结构，不验证证书签名、链、有效期策略或扩展语义。
 */
export function parseCertificateDer(derBytes) {
  const der = derBytes instanceof Uint8Array ? derBytes : new Uint8Array(derBytes);
  const root = parseRoot(der, "X.509 证书");
  expectTag(root, 0x30, "Certificate");
  const ch = root.children || [];
  if (ch.length !== 3) throw new Error("Certificate 顶层必须是 SEQUENCE{tbsCertificate, signatureAlgorithm, signatureValue}（RFC 5280 §4.1）");
  const tbs = ch[0];
  expectTag(tbs, 0x30, "tbsCertificate");
  const fields = tbs.children || [];
  let i = 0;
  let version = 1;
  if (fields[0] && fields[0].tag === 0xa0) {
    const v = fields[0].children && fields[0].children[0];
    if (!v || v.tag !== 0x02) throw new Error("证书 version [0] 内不是 INTEGER");
    version = Number(bytesToBigInt(v.value)) + 1;
    i = 1;
  }
  const serialNode = fields[i];
  if (!serialNode || serialNode.tag !== 0x02) throw new Error("证书 serialNumber 不是 INTEGER");
  const serial = bytesToBigInt(serialNode.value);
  const sigAlg = readAlgId(fields[i + 1], "证书签名");
  const issuerNode = fields[i + 2];
  const valNode = fields[i + 3];
  if (!valNode || valNode.tag !== 0x30 || !valNode.children || valNode.children.length !== 2) {
    throw new Error("证书 validity 结构非法（RFC 5280 §4.1.2.5）");
  }
  const subjectNode = fields[i + 4];
  const spkiNode = fields[i + 5];
  const notBefore = parseTimeNode(valNode.children[0], "notBefore");
  const notAfter = parseTimeNode(valNode.children[1], "notAfter");
  const exts = parseExtensions(fields.slice(i + 6));
  let skid = null;
  let keyUsage = null;
  let basicConstraints = null;
  for (const ext of exts) {
    try {
      if (ext.oid === "2.5.29.14") {
        const inner = parseRoot(ext.valueDer, "SubjectKeyIdentifier");
        if (inner.tag === 0x04) skid = inner.value;
      } else if (ext.oid === "2.5.29.15") {
        keyUsage = parseKeyUsage(ext.valueDer);
      } else if (ext.oid === "2.5.29.19") {
        const inner = parseRoot(ext.valueDer, "BasicConstraints");
        if (inner.tag === 0x30) {
          let ca = false;
          let pathLen = null;
          for (const c of inner.children || []) {
            if (c.tag === 0x01) ca = c.value[0] !== 0;
            if (c.tag === 0x02) pathLen = Number(bytesToBigInt(c.value));
          }
          basicConstraints = { ca, pathLen };
        }
      }
    } catch { /* 单个扩展解析失败不影响验签；输出中不声称该扩展有效 */ }
  }
  let spki;
  try {
    spki = parseSpki(spkiNode);
  } catch (err) {
    // 证书结构本身可解析，但公钥算法/曲线不在支持范围：保留占位，由签名者验证阶段显式报错。
    spki = { kind: "unsupported", label: "无法解析", error: err.message };
  }
  return {
    der,
    version,
    serial,
    serialHex: bytesToHex(serialNode.value),
    sigAlgOid: sigAlg.oid,
    sigAlgLabel: sigAlgLabel(sigAlg.oid),
    issuerNode,
    issuerDer: derEncode(issuerNode),
    issuer: formatName(issuerNode, "issuer"),
    subjectNode,
    subjectDer: derEncode(subjectNode),
    subject: formatName(subjectNode, "subject"),
    notBefore,
    notAfter,
    spki,
    skid,
    keyUsage,
    basicConstraints,
    extensions: exts.map((e) => ({ oid: e.oid, critical: e.critical })),
  };
}

// ============================================================
// CMS SignedData 解析（RFC 5652 §5）
// ============================================================

function parseSignedAttrs(node, expectedContentType, contentDigest, hashInfo) {
  const attrs = node.children || [];
  const errors = [];
  let contentType = null;
  let messageDigest = null;
  let contentTypeCount = 0;
  let messageDigestCount = 0;
  for (const attr of attrs) {
    if (attr.tag !== 0x30 || !attr.children || attr.children.length < 2 || attr.children[0].tag !== 0x06) {
      errors.push("signedAttrs 中某项不是 SEQUENCE{attrType OID, attrValues SET}");
      continue;
    }
    const oid = oidString(attr.children[0].value);
    const set = attr.children[1];
    if (set.tag !== 0x31 || !set.children) {
      errors.push(`signedAttrs 属性 ${oidLabel(oid)} 的 attrValues 不是 SET`);
      continue;
    }
    if (oid === "1.2.840.113549.1.9.3") {
      contentTypeCount++;
      if (set.children.length !== 1) {
        errors.push(`contentType 属性出现 ${set.children.length} 个值（必须恰好 1 个）`);
      } else if (set.children[0].tag !== 0x06) {
        errors.push("contentType 属性值不是 OID");
      } else {
        contentType = oidString(set.children[0].value);
      }
    } else if (oid === "1.2.840.113549.1.9.4") {
      messageDigestCount++;
      if (set.children.length !== 1) {
        errors.push(`messageDigest 属性出现 ${set.children.length} 个值（必须恰好 1 个）`);
      } else if (set.children[0].tag !== 0x04) {
        errors.push("messageDigest 属性值不是 OCTET STRING");
      } else {
        messageDigest = set.children[0].value;
      }
    }
  }
  if (contentTypeCount === 0) errors.push("signedAttrs 缺少 contentType 属性（RFC 5652 §5.3）");
  if (contentTypeCount > 1) errors.push("signedAttrs 含重复 contentType 属性");
  if (messageDigestCount === 0) errors.push("signedAttrs 缺少 messageDigest 属性（RFC 5652 §5.3）");
  if (messageDigestCount > 1) errors.push("signedAttrs 含重复 messageDigest 属性");
  if (contentType != null && expectedContentType != null && contentType !== expectedContentType) {
    errors.push(`contentType 属性 ${contentType} 与 encapContentInfo.eContentType ${expectedContentType} 不一致`);
  }
  let digestMatches = null;
  if (messageDigest != null && contentDigest != null && hashInfo) {
    digestMatches = ctEqual(messageDigest, contentDigest);
    if (!digestMatches) {
      errors.push(`messageDigest 与外部内容的 ${hashInfo.label} 摘要不一致（期望 ${bytesToHex(contentDigest)}，属性 ${bytesToHex(messageDigest)}）`);
    }
  }
  return {
    count: attrs.length,
    contentType,
    messageDigest,
    digestMatches,
    errors,
    der: derEncode({ tag: 0x31, children: attrs }),
    attrOids: attrs.map((a) => {
      try { return oidString(a.children[0].value); } catch { return "?"; }
    }),
  };
}

function parseSignerInfo(node) {
  expectTag(node, 0x30, "SignerInfo");
  const ch = node.children || [];
  if (ch.length < 5) throw new Error("SignerInfo 结构非法（RFC 5652 §5.3）");
  let i = 0;
  const version = Number(readInteger(ch[i++], "SignerInfo version"));
  const sidNode = ch[i++];
  let sid;
  if (sidNode.tag === 0x30) {
    const sc = sidNode.children || [];
    if (sc.length < 2 || sc[1].tag !== 0x02) throw new Error("SignerInfo sid（issuerAndSerialNumber）结构非法");
    sid = {
      kind: "issuerSerial",
      issuerNode: sc[0],
      issuerDer: derEncode(sc[0]),
      issuer: formatName(sc[0], "sid issuer"),
      serial: bytesToBigInt(sc[1].value),
      serialHex: bytesToHex(sc[1].value),
    };
  } else if (sidNode.tag === 0x80) {
    sid = { kind: "skid", skid: sidNode.value, skidHex: bytesToHex(sidNode.value) };
  } else {
    throw new Error(`SignerInfo sid 标签非法：0x${sidNode.tag.toString(16)}（应为 SEQUENCE 或 [0] IMPLICIT OCTET STRING）`);
  }
  const digestAlg = readAlgId(ch[i++], "SignerInfo digestAlgorithm");
  let signedAttrs = null;
  if (ch[i] && ch[i].tag === 0xa0) signedAttrs = ch[i++];
  const signatureAlg = readAlgId(ch[i++], "SignerInfo signatureAlgorithm");
  const sigNode = ch[i++];
  if (!sigNode || sigNode.tag !== 0x04) throw new Error("SignerInfo signature 不是 OCTET STRING");
  let unsignedAttrs = null;
  if (ch[i] && ch[i].tag === 0xa1) unsignedAttrs = ch[i++];
  if (i !== ch.length) throw new Error(`SignerInfo 有 ${ch.length - i} 个未识别尾随字段`);
  return {
    version,
    sid,
    digestAlg,
    signedAttrsNode: signedAttrs,
    signatureAlg,
    signature: sigNode.value,
    unsignedAttrs,
  };
}

/**
 * 解析 CMS ContentInfo{SignedData}。
 * 返回结构树与元数据；不验签。
 */
export function parseCmsDer(derBytes) {
  const der = derBytes instanceof Uint8Array ? derBytes : new Uint8Array(derBytes);
  const root = parseRoot(der, "CMS 输入");
  expectTag(root, 0x30, "ContentInfo");
  const ci = root.children || [];
  if (ci.length < 2 || ci[0].tag !== 0x06) throw new Error("ContentInfo 结构非法（RFC 5652 §3：SEQUENCE{contentType, [0] content}）");
  const contentType = oidString(ci[0].value);
  if (contentType !== "1.2.840.113549.1.7.2") {
    throw new Error(`输入不是 CMS SignedData：contentType = ${oidLabel(contentType)}（本工具只支持 signedData 1.2.840.113549.1.7.2）`);
  }
  const explicit = ci[1];
  if (!explicit || explicit.tag !== 0xa0 || !explicit.children || explicit.children.length !== 1) {
    throw new Error("ContentInfo 的 content [0] EXPLICIT 结构非法（应为单个 SignedData SEQUENCE）");
  }
  const sd = explicit.children[0];
  expectTag(sd, 0x30, "SignedData");
  const ch = sd.children || [];
  if (ch.length < 4) throw new Error("SignedData 字段不足（version/digestAlgorithms/encapContentInfo/signerInfos）");
  let i = 0;
  const version = Number(readInteger(ch[i++], "SignedData version"));
  const digestSet = ch[i++];
  expectTag(digestSet, 0x31, "SignedData digestAlgorithms");
  const digestAlgorithms = (digestSet.children || []).map((n) => {
    const a = readAlgId(n, "digestAlgorithms");
    return { oid: a.oid, label: hashLabel(a.oid), supported: !!HASHES[a.oid] };
  });
  const encap = ch[i++];
  expectTag(encap, 0x30, "EncapsulatedContentInfo");
  const ec = encap.children || [];
  if (ec.length < 1 || ec[0].tag !== 0x06) throw new Error("EncapsulatedContentInfo 缺 eContentType OID");
  const eContentType = oidString(ec[0].value);
  let attached = false;
  let eContent = null;
  if (ec[1]) {
    if (ec[1].tag !== 0xa0) throw new Error("EncapsulatedContentInfo 的 eContent 不是 [0] EXPLICIT");
    const inner = ec[1].children && ec[1].children[0];
    eContent = readOctetString(inner, "eContent");
    attached = true;
  }
  const certificates = [];
  const skippedCertChoices = [];
  let crlsPresent = false;
  let signerSet = null;
  for (; i < ch.length; i++) {
    const n = ch[i];
    if (n.tag === 0xa0) {
      if (!n.children) throw new Error("certificates [0] IMPLICIT 结构非法");
      for (const choice of n.children) {
        if (choice.tag === 0x30) {
          certificates.push(parseCertificateDer(derEncode(choice)));
        } else {
          skippedCertChoices.push(`tag 0x${choice.tag.toString(16)}`);
        }
      }
    } else if (n.tag === 0xa1) {
      crlsPresent = true;
    } else if (n.tag === 0x31) {
      if (signerSet) throw new Error("SignedData 出现多个 signerInfos SET");
      signerSet = n;
    } else {
      throw new Error(`SignedData 出现未识别字段 tag 0x${n.tag.toString(16)}`);
    }
  }
  if (!signerSet) throw new Error("SignedData 缺 signerInfos SET（RFC 5652 §5.1）");
  const signerInfos = (signerSet.children || []).map(parseSignerInfo);
  if (!signerInfos.length) throw new Error("signerInfos 为空：没有可验证的签名者");
  return {
    der,
    contentType,
    version,
    digestAlgorithms,
    eContentType,
    attached,
    eContent,
    certificates,
    skippedCertChoices,
    crlsPresent,
    signerInfos,
  };
}

// ============================================================
// 签名者证书匹配与验签
// ============================================================

function findSignerCert(sid, pool) {
  if (sid.kind === "issuerSerial") {
    const hits = pool.filter((c) => c.serial === sid.serial && ctEqual(c.issuerDer, sid.issuerDer));
    return { cert: hits[0] || null, matches: hits.length };
  }
  const hits = pool.filter((c) => c.skid && ctEqual(c.skid, sid.skid));
  return { cert: hits[0] || null, matches: hits.length };
}

function parseEcdsaSignatureDer(sigBytes) {
  const root = parseRoot(sigBytes, "ECDSA 签名");
  expectTag(root, 0x30, "ECDSA 签名");
  const ch = root.children || [];
  if (ch.length !== 2 || ch[0].tag !== 0x02 || ch[1].tag !== 0x02) {
    throw new Error("ECDSA 签名 DER 必须为 SEQUENCE{r INTEGER, s INTEGER}");
  }
  return { r: bytesToBigInt(ch[0].value), s: bytesToBigInt(ch[1].value) };
}

function certSourceLabel(cert) {
  return cert.source === "external" ? "外部补充证书" : "CMS 内嵌证书";
}

async function verifyOneSigner(signer, cms, content, pool, opts) {
  const errors = [];
  const warnings = [];
  const out = {
    index: 0,
    version: signer.version,
    sid: signer.sid,
    digestAlg: signer.digestAlg.oid,
    digestLabel: hashLabel(signer.digestAlg.oid),
    signatureAlg: signer.signatureAlg.oid,
    signatureAlgLabel: sigAlgLabel(signer.signatureAlg.oid),
    hasSignedAttrs: !!signer.signedAttrsNode,
    signedAttrs: null,
    cert: null,
    certSource: null,
    contentDigestHex: null,
    signatureInput: null,
    ok: false,
    reason: "",
    errors,
    warnings,
  };

  const hashInfo = HASHES[signer.digestAlg.oid];
  if (!hashInfo) {
    const known = UNSUPPORTED_HASHES[signer.digestAlg.oid];
    errors.push(`不支持的摘要算法：${signer.digestAlg.oid}${known ? `（${known}）` : ""}；支持 SHA-256/SHA-384/SHA-512`);
  }
  const sigInfo = SIGNATURE_ALGS[signer.signatureAlg.oid];
  if (!sigInfo) {
    const known = SIGNATURE_ALG_NAMES[signer.signatureAlg.oid];
    errors.push(`不支持的签名算法：${signer.signatureAlg.oid}${known ? `（${known}）` : ""}；支持 RSA PKCS#1 v1.5 与 ECDSA P-256/384/521`);
  }
  if (hashInfo && sigInfo && sigInfo.hash && sigInfo.hash !== hashInfo.key) {
    errors.push(`签名算法 ${sigInfo.label} 与摘要算法 ${hashInfo.label} 不匹配`);
  }
  if (signer.unsignedAttrs) {
    warnings.push("含 unsignedAttrs（时间戳/计数器签名等未验证，仅签名本身参与结论）");
  }

  // signedAttrs 内容绑定
  let contentDigest = null;
  if (hashInfo && content != null) {
    contentDigest = await digestBytes(hashInfo, content);
    out.contentDigestHex = bytesToHex(contentDigest);
  }
  let dataToVerify = content;
  if (signer.signedAttrsNode) {
    const sa = parseSignedAttrs(signer.signedAttrsNode, cms.eContentType, contentDigest, hashInfo);
    out.signedAttrs = sa;
    errors.push(...sa.errors);
    dataToVerify = sa.der;
    out.signatureInput = `signedAttrs 的 DER SET OF（${sa.der.length} 字节，${sa.count} 个属性）`;
  } else {
    out.signatureInput = `内容本身（${content ? content.length : 0} 字节）`;
    if (opts.requireSignedAttrs) {
      errors.push("缺少 signedAttrs（RFC 5652 §5.4 允许直接对内容签名；本工具默认要求 signedAttrs，可在参数中关闭该策略）");
    }
  }

  // 证书
  const found = findSignerCert(signer.sid, pool);
  if (!found.cert) {
    const sidDesc = signer.sid.kind === "issuerSerial"
      ? `issuer=${signer.sid.issuer}, serial=${signer.sid.serial}`
      : `subjectKeyIdentifier=${signer.sid.skidHex}`;
    errors.push(`找不到签名者证书（sid: ${sidDesc}；证书池 ${pool.length} 张，含 CMS 内嵌 ${cms.certificates.length} 张与外部补充）`);
    out.reason = errors.join("；");
    return out;
  }
  if (found.matches > 1) warnings.push(`证书池中有 ${found.matches} 张证书匹配该 sid，使用第一张`);
  out.cert = found.cert;
  out.certSource = certSourceLabel(found.cert);
  if (found.cert.spki.kind === "unsupported") {
    errors.push(`签名者证书公钥不可用：${found.cert.spki.error}`);
  }
  if (found.cert.keyUsage && !found.cert.keyUsage.includes("digitalSignature") && !found.cert.keyUsage.includes("nonRepudiation/contentCommitment")) {
    warnings.push(`证书 KeyUsage=[${found.cert.keyUsage.join(", ")}] 不含 digitalSignature/nonRepudiation（未强制拒绝）`);
  }

  // 摘要与签名
  if (hashInfo && sigInfo && found.cert.spki.kind !== "unsupported" && !errors.some((e) => e.startsWith("不支持的") || e.includes("不匹配"))) {
    try {
      const signedDigest = await digestBytes(hashInfo, dataToVerify);
      if (sigInfo.kind === "rsa") {
        if (found.cert.spki.kind !== "rsa") {
          errors.push(`签名算法为 RSA，但证书公钥是 ${found.cert.spki.label}`);
        } else {
          const digestInfo = buildDigestInfo(hashInfo, signedDigest);
          const r = rsaPkcs1Verify(signer.signature, digestInfo, found.cert.spki.n, found.cert.spki.e);
          if (!r.ok) errors.push(r.reason);
        }
      } else if (sigInfo.kind === "ecdsa") {
        if (found.cert.spki.kind !== "ec") {
          errors.push(`签名算法为 ECDSA，但证书公钥是 ${found.cert.spki.label}`);
        } else {
          const sig = parseEcdsaSignatureDer(signer.signature);
          const e = hashToE(signedDigest, CURVES[found.cert.spki.curveKey]);
          const r = ecdsaVerifyRaw(CURVES[found.cert.spki.curveKey], found.cert.spki.point, sig.r, sig.s, e);
          if (!r.valid) errors.push(`ECDSA 验签失败：${r.reason || "r/s 不匹配"}`);
        }
      }
    } catch (err) {
      errors.push(`验签计算失败：${err.message}`);
    }
  }

  out.ok = errors.length === 0;
  out.reason = out.ok ? "签名、摘要与 signedAttrs 绑定均通过" : errors.join("；");
  return out;
}

/**
 * 验证已解析的 CMS。opts:
 *   detachedContent: Uint8Array（detached 时必填）
 *   extraCerts: 已解析证书数组
 *   requireSignedAttrs: boolean（默认 true）
 */
export async function verifyParsedCms(cms, opts = {}) {
  const content = cms.attached ? cms.eContent : opts.detachedContent;
  if (content == null) {
    throw new Error("detached CMS：缺少外部签名原文（参数 content）。attached CMS 的 eContent 为空时也请显式提供内容");
  }
  const pool = [
    ...cms.certificates.map((c) => ({ ...c, source: "embedded" })),
    ...(opts.extraCerts || []).map((c) => ({ ...c, source: "external" })),
  ];
  const signers = [];
  for (let i = 0; i < cms.signerInfos.length; i++) {
    const one = await verifyOneSigner(cms.signerInfos[i], cms, content, pool, {
      requireSignedAttrs: opts.requireSignedAttrs !== false,
    });
    one.index = i + 1;
    signers.push(one);
  }
  const passed = signers.filter((s) => s.ok).length;
  const ok = passed === signers.length && signers.length > 0;
  const warnings = [];
  if (cms.crlsPresent) warnings.push("CMS 含 CRLs 字段（未解析/未检查吊销状态）");
  if (cms.skippedCertChoices.length) warnings.push(`certificates 中跳过 ${cms.skippedCertChoices.length} 个非 X.509 Certificate 选择（${cms.skippedCertChoices.join(", ")}）`);
  if (!cms.digestAlgorithms.every((d) => d.supported)) warnings.push("digestAlgorithms 集合含本工具不支持的摘要算法（仅逐个 signer 判定）");
  return {
    cms,
    content,
    contentLength: content.length,
    contentSource: cms.attached ? "attached（CMS eContent）" : "detached（外部 content 参数）",
    pool,
    signers,
    passed,
    ok,
    warnings,
  };
}

/** 验证 CMS DER 字节。 */
export async function verifyCmsDer(der, opts = {}) {
  const cms = parseCmsDer(der);
  return verifyParsedCms(cms, opts);
}

// ============================================================
// 输入解码与报告
// ============================================================

const CMS_PEM_LABELS = new Set(["CMS", "PKCS7", "PKCS #7 SIGNED DATA", "PKCS7 SIGNED DATA"]);

/** CMS 文本输入 → DER：PEM(CMS/PKCS7)、hex、base64。 */
export function loadCmsInput(text) {
  const src = String(text == null ? "" : text).trim();
  if (!src) throw new Error("输入为空：需要 CMS/PKCS#7 SignedData（PEM/hex/base64 的 DER）");
  if (src.includes("-----BEGIN")) {
    const re = /-----BEGIN ([A-Za-z0-9 #]+)-----([\s\S]*?)-----END ([A-Za-z0-9 #]+)-----/g;
    let m;
    let sawCertificate = false;
    let sawOther = "";
    while ((m = re.exec(src)) !== null) {
      if (m[1] !== m[3]) throw new Error(`PEM 标签不匹配：BEGIN ${m[1]} 对 END ${m[3]}（RFC 7468）`);
      if (m[1] === "CERTIFICATE") { sawCertificate = true; continue; }
      if (!CMS_PEM_LABELS.has(m[1])) {
        sawOther = m[1];
        continue;
      }
      const lines = m[2].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const body = lines.filter((l) => !l.includes(":")).join("");
      return { der: base64Decode(body), srcKind: `PEM（${m[1]}，RFC 7468）` };
    }
    if (sawCertificate) throw new Error("PEM 只含 CERTIFICATE 证书块，不是 CMS/PKCS#7 签名数据（CMS 标签应为 CMS 或 PKCS7）");
    if (sawOther) throw new Error(`PEM 标签是 ${sawOther}，不是 CMS/PKCS#7 签名数据（可接受 CMS / PKCS7）`);
    throw new Error("未找到 CMS/PKCS#7 PEM 块（-----BEGIN CMS----- 或 -----BEGIN PKCS7-----）");
  }
  const compact = src.replace(/\s+/g, "");
  if (/^[0-9a-fA-F]+$/.test(compact)) {
    if (compact.length % 2) throw new Error("CMS hex 长度为奇数——半个字节无法还原");
    if (compact.length < 16) throw new Error("CMS hex 过短，不可能是 SignedData");
    return { der: hexToBytes(compact), srcKind: "DER 十六进制" };
  }
  try {
    return { der: base64Decode(src), srcKind: "DER base64" };
  } catch (err) {
    throw new Error(`无法识别输入：需 CMS/PKCS#7 PEM、DER hex 或 DER base64（${err.message}）`);
  }
}

function decodeContentParam(text, enc) {
  const raw = String(text == null ? "" : text);
  if (enc === "hex") return hexToBytes(raw);
  if (enc === "base64") return base64Decode(raw);
  return te.encode(raw);
}

/** 解析外部补充证书 PEM 包（可多张）。 */
export function parseCertificateBundle(pemText) {
  const src = String(pemText == null ? "" : pemText).trim();
  if (!src) return [];
  const re = /-----BEGIN ([A-Za-z0-9 #]+)-----([\s\S]*?)-----END ([A-Za-z0-9 #]+)-----/g;
  const certs = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1] !== m[3]) throw new Error(`PEM 标签不匹配：BEGIN ${m[1]} 对 END ${m[3]}`);
    if (m[1] !== "CERTIFICATE") throw new Error(`补充证书 PEM 标签是 ${m[1]}，不是 CERTIFICATE`);
    const lines = m[2].split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const body = lines.filter((l) => !l.includes(":")).join("");
    certs.push(parseCertificateDer(base64Decode(body)));
  }
  if (!certs.length) throw new Error("补充证书参数非空，但未找到 -----BEGIN CERTIFICATE----- 块");
  return certs;
}

function formatCertLine(cert) {
  return `subject=${cert.subject}；issuer=${cert.issuer}；serial=${cert.serial}；有效期 ${cert.notBefore.text} ~ ${cert.notAfter.text}`;
}

function formatSignerReport(s) {
  const L = [];
  L.push(`[签名者 #${s.index}] ${s.ok ? "PASS" : "FAIL"}`);
  if (s.sid.kind === "issuerSerial") {
    L.push(`  sid            : issuerAndSerialNumber（issuer=${s.sid.issuer}；serial=${s.sid.serial}）`);
  } else {
    L.push(`  sid            : subjectKeyIdentifier（${s.sid.skidHex}）`);
  }
  L.push(`  SignerInfo 版本: ${s.version}（RFC 5652 §5.3：1=issuerAndSerial，3=SKID）`);
  L.push(`  摘要算法       : ${s.digestLabel}`);
  if (s.signedAttrs) {
    L.push(`  signedAttrs    : 有（${s.signedAttrs.count} 个属性：${s.signedAttrs.attrOids.map((o) => OID_LABELS[o] || o).join(", ")}）`);
    L.push(`    contentType  : ${s.signedAttrs.contentType || "缺失"}${s.signedAttrs.errors.some((e) => e.includes("contentType")) ? "（校验失败）" : "（匹配）"}`);
    L.push(`    messageDigest: ${s.signedAttrs.messageDigest ? bytesToHex(s.signedAttrs.messageDigest) : "缺失"}${s.signedAttrs.digestMatches === false ? "（不匹配）" : s.signedAttrs.digestMatches === true ? "（匹配）" : ""}`);
  } else {
    L.push("  signedAttrs    : 无（RFC 5652 §5.4 允许；本工具默认要求，可用参数关闭）");
  }
  L.push(`  签名算法       : ${s.signatureAlgLabel}`);
  if (s.cert) {
    L.push(`  签名者证书     : ${formatCertLine(s.cert)}（${s.certSource}）`);
    L.push(`  证书公钥       : ${s.cert.spki.label}；KeyUsage=${s.cert.keyUsage ? s.cert.keyUsage.join(",") : "无扩展"}；BasicConstraints=${s.cert.basicConstraints ? `CA=${s.cert.basicConstraints.ca}${s.cert.basicConstraints.pathLen != null ? `, pathLen=${s.cert.basicConstraints.pathLen}` : ""}` : "无扩展"}`);
    if (s.cert.skid) L.push(`  证书 SKID      : ${bytesToHex(s.cert.skid)}`);
  } else {
    L.push("  签名者证书     : 未找到");
  }
  L.push(`  签名输入       : ${s.signatureInput}`);
  if (s.contentDigestHex) L.push(`  内容摘要       : ${s.contentDigestHex}`);
  for (const w of s.warnings) L.push(`  ⚠ ${w}`);
  if (!s.ok) {
    L.push(`  失败原因       : ${s.reason}`);
    for (const e of s.errors) if (!s.reason.includes(e)) L.push(`    - ${e}`);
  }
  L.push(`  结论           : ${s.ok ? "PASS（签名有效且 signedAttrs 绑定通过）" : "FAIL"}`);
  return L.join("\n");
}

/** 生成人类可读报告。 */
export function formatCmsReport(result, srcKind) {
  const { cms } = result;
  const L = [];
  L.push("=== CMS / PKCS#7 SignedData 验签（RFC 5652） ===");
  L.push(`输入        : ${srcKind || "DER"} · ${cms.der.length} 字节`);
  L.push(`ContentInfo : ${oidLabel(cms.contentType)}`);
  L.push(`SignedData  : version ${cms.version}（RFC 5652 §5.1）`);
  L.push(`digestAlgorithms: ${cms.digestAlgorithms.map((d) => d.label).join("；")}`);
  L.push(`eContentType: ${oidLabel(cms.eContentType)}`);
  L.push(`内容模式    : ${result.contentSource} · ${result.contentLength} 字节`);
  L.push(`证书集      : CMS 内嵌 ${cms.certificates.length} 张；外部补充 ${result.pool.length - cms.certificates.length} 张`);
  if (cms.certificates.length) {
    for (let i = 0; i < cms.certificates.length; i++) {
      L.push(`  证书 #${i + 1}: ${cms.certificates[i].subject}（serial ${cms.certificates[i].serial}）`);
    }
  }
  L.push(`CRLs        : ${cms.crlsPresent ? "有（未检查吊销）" : "无"}`);
  L.push(`SignerInfos : ${result.signers.length} 个`);
  for (const w of result.warnings) L.push(`⚠ ${w}`);
  L.push("");
  for (const s of result.signers) {
    L.push(formatSignerReport(s));
    L.push("");
  }
  L.push(`总体结论    : ${result.ok ? "PASS" : "FAIL"}（${result.passed}/${result.signers.length} 签名者通过）`);
  L.push("边界        : 只验证 CMS 签名、signedAttrs 绑定与签名者证书公钥；不验证证书链/信任锚/有效期策略/CRL/OCSP/时间戳，不联网。");
  return L.join("\n");
}

/** op 入口：CMS 文本 + 参数 → 报告。 */
export async function cmsVerifyRun(text, p = {}) {
  const { der, srcKind } = loadCmsInput(text);
  let cms;
  try {
    cms = parseCmsDer(der);
  } catch (err) {
    throw new Error(`CMS 解析失败：${err.message}`);
  }
  const opts = { requireSignedAttrs: p.requireSignedAttrs !== false };
  if (!cms.attached) {
    if (p.content == null || String(p.content) === "") {
      throw new Error("detached CMS：缺少外部签名原文。请在参数「外部原文」中提供，或改用 attached（-nodetach）样本");
    }
    opts.detachedContent = decodeContentParam(p.content, p.contentEnc || "text");
  }
  opts.extraCerts = parseCertificateBundle(p.certs);
  const result = await verifyParsedCms(cms, opts);
  return formatCmsReport(result, srcKind);
}

// ============================================================
// 注册
// ============================================================

register({
  id: "cmsVerify",
  family: "cms",
  familyLabel: "verify",
  cat: "asym",
  name: "CMS / PKCS#7 验签",
  desc: "CMS/PKCS#7 SignedData 签名验证（RFC 5652）：DER/BER 解析，attached 内嵌内容与 detached 外部原文；多 SignerInfo 逐个验证，支持 issuerAndSerialNumber 与 subjectKeyIdentifier；校验 signedAttrs 的 contentType/messageDigest 并按 DER SET OF 重算签名；摘要 SHA-256/384/512，签名 RSA PKCS#1 v1.5 与 ECDSA P-256/384/521；解析签名者证书 SPKI/SKID/KeyUsage。仅本地验签，不做证书链/CRL/OCSP/时间戳",
  params: [
    { key: "content", label: "外部原文（detached CMS 必填）", type: "textarea", default: "", placeholder: "detached 时提供被签名原文；attached 时忽略" },
    { key: "contentEnc", label: "外部原文编码", type: "select", default: "text", options: [
      { value: "text", label: "文本（UTF-8）" },
      { value: "hex", label: "hex 字节" },
      { value: "base64", label: "base64" },
    ] },
    { key: "certs", label: "补充证书（PEM，可多张）", type: "textarea", default: "", placeholder: "CMS 未内嵌证书（-nocerts）时使用" },
    { key: "requireSignedAttrs", label: "要求 signedAttrs", type: "bool", default: true },
  ],
  run: async (text, p) => cmsVerifyRun(text, p),
});
