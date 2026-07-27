/*
 * eccdetect.js — 椭圆曲线 / 现代密码识别组（T61，cat:'analysis'）。
 *
 * 覆盖（全部 run 单向，只解析结构不做签名运算）：
 * - pemParse PEM/DER 结构解析（识别 RSA/EC/Ed25519 公私钥、证书、CSR）
 * - asn1Parse ASN.1 简单解析器（TLV 递归，照 X.690）
 * - ecCurveIdent 椭圆曲线参数识别（secp256k1/P-256/Curve25519…）
 * - sshPubkeyParse SSH 公钥解析（ssh-rsa/ed25519/ecdsa base64 段拆解）
 * - btcAddressIdent 比特币地址识别（P2PKH/P2SH/Bech32，校验）
 * - ethAddressIdent 以太坊地址识别（EIP-55 混合大小写校验）
 *
 * 红线：
 * - 只新建本文件，不碰任何现有 core/*.js。
 * - 只解析结构，不做签名 / 解密运算。
 * - ASN.1 照 X.690（DER 为主，兼容 BER 长度）。
 * - SHA-256（比特币 Base58Check/Bech32 校验）复用 baseExt.js 同步 sha256Bytes；
 * Keccak-256（以太坊 EIP-55）复用 hash.js 同步 keccak256。
 *
 * 输入约定：文本框填 PEM / DER hex / SSH 公钥 / 地址；参数走 params。
 */

import { register } from "./registry.js";
import { sha256Bytes } from "./baseExt.js";
import { keccak256 } from "./hash.js";

// ============================================================
// 通用字节 / 编码工具
// ============================================================
const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (s) => {
  const clean = String(s).replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2) throw new Error("十六进制长度须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
};
const te = (s) => new TextEncoder().encode(s);

// base64 → bytes（兼容 URL-safe / 换行 / 缺 padding）
function b64ToBytes(s) {
  let t = String(s).replace(/[^A-Za-z0-9+/=_-]/g, "");
  t = t.replace(/-/g, "+").replace(/_/g, "/");
  while (t.length % 4) t += "=";
  const bin = atob(t);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ============================================================
// ASN.1 OID 名称表（识别用，X.690 不涉及命名）
// ============================================================
const OID_NAMES = {
 // 公钥算法
  "1.2.840.113549.1.1.1": "rsaEncryption (RSA 公钥)",
  "1.2.840.113549.1.1.2": "md2WithRSAEncryption",
  "1.2.840.113549.1.1.4": "md5WithRSAEncryption",
  "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
  "1.2.840.113549.1.1.10": "rsassaPss",
  "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
  "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
  "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
  "1.2.840.10045.2.1": "id-ecPublicKey (EC 公钥)",
  "1.2.840.10045.4.1": "ecdsa-with-SHA1",
  "1.2.840.10045.4.3.1": "ecdsa-with-SHA224",
  "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
  "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
  "1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
  "1.3.101.110": "X25519",
  "1.3.101.111": "X448",
  "1.3.101.112": "Ed25519",
  "1.3.101.113": "Ed448",
  "1.2.840.10040.4.1": "dsa",
  "1.2.840.113549.1.7.1": "pkcs7-data",
  "1.2.840.113549.1.7.2": "pkcs7-signedData",
  "1.2.840.113549.1.7.3": "pkcs7-envelopedData",
  "1.2.840.113549.1.9.1": "emailAddress",
 // EC 曲线 OID
  "1.2.840.10045.3.1.7": "prime256v1 (P-256 / secp256r1)",
  "1.3.132.0.34": "secp384r1 (P-384)",
  "1.3.132.0.35": "secp521r1 (P-521)",
  "1.3.132.0.10": "secp256k1",
  "1.3.132.0.31": "secp192r1 (P-192)",
  "1.3.132.0.33": "secp224r1 (P-224)",
 // X.509 / CSR 属性
  "2.5.4.3": "commonName (CN)",
  "2.5.4.6": "countryName (C)",
  "2.5.4.7": "localityName (L)",
  "2.5.4.8": "stateOrProvinceName (ST)",
  "2.5.4.10": "organizationName (O)",
  "2.5.4.11": "organizationalUnitName (OU)",
  "2.5.4.9": "streetAddress",
  "2.5.4.5": "serialNumber",
  "2.5.29.14": "subjectKeyIdentifier",
  "2.5.29.15": "keyUsage",
  "2.5.29.17": "subjectAltName",
  "2.5.29.19": "basicConstraints",
  "2.5.29.35": "authorityKeyIdentifier",
  "2.5.29.37": "extKeyUsage",
  "1.2.840.113549.1.9.14": "extensionRequest",
  "1.2.840.113549.1.9.7": "challengePassword",
 // X.509 证书结构
  "2.5.4.0": "objectClass",
 // PKCS#8
  "1.2.840.113549.1.8.1.1": "PBES2",
  "1.2.840.113549.1.5.13": "PBES2",
  "1.2.840.113549.1.5.12": "PBKDF2",
  "2.16.840.1.101.3.4.1.2": "aes128-CBC",
  "2.16.840.1.101.3.4.1.22": "aes192-CBC",
  "2.16.840.1.101.3.4.1.42": "aes256-CBC",
  "1.2.840.113549.2.7": "hmacWithSHA1",
  "1.2.840.113549.2.9": "hmacWithSHA256",
  "1.2.840.113549.2.10": "hmacWithSHA384",
  "1.2.840.113549.2.11": "hmacWithSHA512",
};

// ============================================================
// ASN.1 标签名（Universal 类）
// ============================================================
const TAG_NAMES = {
  0x01: "BOOLEAN", 0x02: "INTEGER", 0x03: "BIT STRING", 0x04: "OCTET STRING",
  0x05: "NULL", 0x06: "OBJECT IDENTIFIER", 0x07: "ObjectDescriptor",
  0x08: "EXTERNAL", 0x09: "REAL", 0x0A: "ENUMERATED", 0x0B: "EMBEDDED PDV",
  0x0C: "UTF8String", 0x0D: "RELATIVE-OID", 0x10: "SEQUENCE", 0x11: "SET",
  0x12: "NumericString", 0x13: "PrintableString", 0x14: "T61String",
  0x15: "VideotexString", 0x16: "IA5String", 0x17: "UTCTime",
  0x18: "GeneralizedTime", 0x19: "GraphicString", 0x1A: "VisibleString",
  0x1B: "GeneralString", 0x1C: "UniversalString", 0x1E: "BMPString",
};

const TAG_CLASS_NAMES = ["UNIVERSAL", "APPLICATION", "CONTEXT-SPECIFIC", "PRIVATE"];

// ============================================================
// ASN.1 TLV 解析器（X.690 DER，递归）
// 返回节点 { tag, class, constructed, tagNum, length, headerLen
// value: Uint8Array, children: [node]|null, start, end }
// ============================================================
function parseAsn1(bytes, offset = 0, depth = 0) {
  if (offset >= bytes.length) throw new Error("ASN.1 解析越界：offset >= length");
  const start = offset;
  let tag = bytes[offset++];
  const cls = (tag >> 6) & 0x03;
  let constructed = (tag >> 5) & 0x01;
  let tagNum = tag & 0x1f;
 // 高 tag 形式（tagNum == 31）：后续 base-128 字节
  if (tagNum === 0x1f) {
    tagNum = 0;
    let b;
    do {
      if (offset >= bytes.length) throw new Error("ASN.1 高 tag 形式解析越界");
      b = bytes[offset++];
      tagNum = (tagNum << 7) | (b & 0x7f);
    } while (b & 0x80);
  }
  if (offset >= bytes.length) throw new Error("ASN.1 长度字节缺失");
  let lenByte = bytes[offset++];
  let length;
  let indefinite = false;
  if (lenByte & 0x80) {
    const numLenBytes = lenByte & 0x7f;
    if (numLenBytes === 0) {
 // 不定长（BER，非 DER）：读到 00 00 结束
      indefinite = true;
      length = -1;
    } else {
      length = 0;
      for (let i = 0; i < numLenBytes; i++) {
        if (offset >= bytes.length) throw new Error("ASN.1 长度字节解析越界");
        length = (length << 8) | bytes[offset++];
      }
    }
  } else {
    length = lenByte;
  }
  const valueStart = offset;
  let valueEnd;
  let children = null;
  if (indefinite) {
 // 扫描到 00 00（end-of-contents）
    valueEnd = valueStart;
    while (valueEnd + 1 < bytes.length && !(bytes[valueEnd] === 0 && bytes[valueEnd + 1] === 0)) {
      valueEnd++;
    }
    valueEnd += 2; // 含 00 00
  } else {
    valueEnd = valueStart + length;
  }
  if (valueEnd > bytes.length) throw new Error("ASN.1 内容长度超出剩余字节（length=" + length + "）");
  const value = bytes.slice(valueStart, valueEnd - (indefinite ? 2 : 0));
  const headerLen = valueStart - start;
 // 构造类型递归子节点（SEQUENCE / SET / context-constructed）
  if (constructed) {
    children = [];
    let co = valueStart;
    const cEnd = indefinite ? valueEnd - 2 : valueEnd;
    while (co < cEnd) {
      const child = parseAsn1(bytes, co, depth + 1);
      children.push(child);
      co = child.end;
    }
  }
  return {
    tag, class: cls, constructed: !!constructed, tagNum,
    length, headerLen, indefinite,
    value, children,
    start, end: valueEnd,
  };
}

/** 解码 OID 内容字节为点分字符串。 */
function decodeOID(bytes) {
  if (!bytes.length) return "";
  const arcs = [];
  const first = bytes[0];
  arcs.push(Math.floor(first / 40));
  arcs.push(first % 40);
  let val = 0;
  for (let i = 1; i < bytes.length; i++) {
    val = (val << 7) | (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      arcs.push(val);
      val = 0;
    }
  }
  return arcs.join(".");
}

/** INTEGER 内容（大端有符号补码）→ BigInt。 */
function decodeInteger(bytes) {
  if (!bytes.length) return 0n;
  let neg = false;
  if (bytes[0] & 0x80) neg = true;
  let v = 0n;
  for (const b of bytes) v = (v << 8n) | BigInt(b);
  if (neg) {
 // 补码还原
    v -= 1n << BigInt(bytes.length * 8);
  }
  return v;
}

/** BIT STRING 内容 → { unusedBits, bytes }。 */
function decodeBitString(bytes) {
  if (!bytes.length) return { unusedBits: 0, bytes: new Uint8Array(0) };
  return { unusedBits: bytes[0], bytes: bytes.slice(1) };
}

/** 节点 → 可读类型名。 */
function nodeTypeName(node) {
  if (node.class === 0) return TAG_NAMES[node.tagNum] || ("UNIVERSAL [" + node.tagNum + "]");
  return TAG_CLASS_NAMES[node.class] + " [" + node.tagNum + "]" + (node.constructed ? " (constructed)" : "");
}

/** 递归格式化 ASN.1 树为文本（带缩进）。 */
function formatAsn1Tree(node, indent = 0, maxDepth = 8) {
  const pad = "  ".repeat(indent);
  const lines = [];
  const type = nodeTypeName(node);
  let val = "";
  if (node.class === 0 && !node.constructed) {
    switch (node.tagNum) {
      case 0x01: // BOOLEAN
        val = node.value.length ? (node.value[0] ? "TRUE" : "FALSE") : "";
        break;
      case 0x02: // INTEGER
        val = decodeInteger(node.value).toString();
        break;
      case 0x03: { // BIT STRING
        const bs = decodeBitString(node.value);
        val = `unusedBits=${bs.unusedBits}, ${bs.bytes.length} 字节` + (bs.bytes.length <= 32 ? "  " + toHex(bs.bytes) : "");
        break;
      }
      case 0x04: // OCTET STRING
        val = `${node.value.length} 字节  ${node.value.length <= 32 ? toHex(node.value) : ""}`.trimEnd();
        break;
      case 0x05: // NULL
        val = "";
        break;
      case 0x06: { // OID
        const oid = decodeOID(node.value);
        val = oid + (OID_NAMES[oid] ? "  (" + OID_NAMES[oid] + ")" : "");
        break;
      }
      case 0x0C: // UTF8String
      case 0x13: // PrintableString
      case 0x14: // T61String
      case 0x16: // IA5String
      case 0x1E: // BMPString
        val = '"' + new TextDecoder("utf-8", { fatal: false }).decode(node.value) + '"';
        break;
      case 0x17: // UTCTime
      case 0x18: // GeneralizedTime
        val = new TextDecoder("utf-8", { fatal: false }).decode(node.value);
        break;
      case 0x0A: // ENUMERATED
        val = decodeInteger(node.value).toString();
        break;
      default:
        val = node.value.length <= 32 ? toHex(node.value) : `(${node.value.length} 字节)`;
    }
  }
  const lenTag = node.indefinite ? "indef" : node.length;
  lines.push(`${pad}${type} (${lenTag} 字节)${val ? " : " + val : ""}`);
  if (node.children && indent < maxDepth) {
    for (const c of node.children) lines.push(...formatAsn1Tree(c, indent + 1, maxDepth));
  } else if (node.children && indent >= maxDepth) {
    lines.push(`${pad}  …(深度上限，省略子节点)`);
  }
  return lines;
}

// ============================================================
// PEM 解析
// ============================================================
const PEM_LABELS = {
  "RSA PRIVATE KEY": { kind: "rsa-priv", desc: "PKCS#1 RSA 私钥" },
  "RSA PUBLIC KEY": { kind: "rsa-pub", desc: "PKCS#1 RSA 公钥" },
  "EC PRIVATE KEY": { kind: "ec-priv", desc: "SEC1 EC 私钥" },
  "PRIVATE KEY": { kind: "pkcs8-priv", desc: "PKCS#8 私钥" },
  "ENCRYPTED PRIVATE KEY": { kind: "pkcs8-enc-priv", desc: "PKCS#8 加密私钥" },
  "PUBLIC KEY": { kind: "spki-pub", desc: "SubjectPublicKeyInfo 公钥" },
  "CERTIFICATE": { kind: "cert", desc: "X.509 证书" },
  "X509 CRL": { kind: "crl", desc: "X.509 CRL 吊销列表" },
  "CERTIFICATE REQUEST": { kind: "csr", desc: "PKCS#10 CSR" },
  "NEW CERTIFICATE REQUEST": { kind: "csr", desc: "PKCS#10 CSR" },
  "EC PARAMETERS": { kind: "ec-params", desc: "EC 参数" },
  "DH PARAMETERS": { kind: "dh-params", desc: "Diffie-Hellman 参数" },
  "DSA PRIVATE KEY": { kind: "dsa-priv", desc: "DSA 私钥" },
  "DSA PUBLIC KEY": { kind: "dsa-pub", desc: "DSA 公钥" },
  "OPENSSH PRIVATE KEY": { kind: "openssh-priv", desc: "OpenSSH 私钥" },
  "SSH2 PUBLIC KEY": { kind: "ssh2-pub", desc: "SSH2 公钥" },
};

/** 从文本提取 PEM 块；返回 [{label, der: Uint8Array, raw}] 或 null。 */
function extractPem(text) {
  const re = /-----BEGIN ([A-Z0-9 ]+)-----\s*([\s\S]*?)-----END \1-----/g;
  const blocks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const label = m[1].trim();
    const b64 = m[2].replace(/\s+/g, "");
    blocks.push({ label, der: b64ToBytes(b64), raw: m[0] });
  }
  return blocks.length ? blocks : null;
}

/** 判定输入是否为纯 hex / base64（裸 DER）。 */
function detectRawDer(text) {
  const t = text.trim();
 // hex（偶数长度，仅 0-9a-f）
  if (/^[0-9a-fA-F\s]+$/.test(t) && t.replace(/\s/g, "").length % 2 === 0 && t.replace(/\s/g, "").length >= 2) {
    return fromHex(t);
  }
 // base64
  if (/^[A-Za-z0-9+/=_\s-]+$/.test(t) && t.replace(/\s/g, "").length >= 4) {
    try { return b64ToBytes(t); } catch { return null; }
  }
  return null;
}

// ============================================================
// 密钥 / 证书结构识别（基于 ASN.1 顶层结构 + OID）
// ============================================================

// rsaEncryption OID 内容字节
const OID_RSA = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];
const OID_EC_PUBKEY = [0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
const OID_ED25519 = [0x2b, 0x65, 0x70];
const OID_X25519 = [0x2b, 0x65, 0x6e];
const OID_ED448 = [0x2b, 0x65, 0x71];
const OID_X448 = [0x2b, 0x65, 0x6f];

function oidsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 从 AlgorithmIdentifier（SEQUENCE{OID, params}）提取算法标识。 */
function identifyAlgId(algIdNode) {
  if (!algIdNode || !algIdNode.children || algIdNode.children.length < 1) return null;
  const oidNode = algIdNode.children[0];
  if (oidNode.tagNum !== 0x06) return null;
  const oid = decodeOID(oidNode.value);
  let name = OID_NAMES[oid] || oid;
 // 曲线参数（EC 的第二个字段是曲线 OID）
  let curve = null;
  if (algIdNode.children.length >= 2) {
    const paramNode = algIdNode.children[1];
    if (paramNode.tagNum === 0x06) {
      const coid = decodeOID(paramNode.value);
      curve = OID_NAMES[coid] || coid;
    }
  }
  return { oid, name, curve };
}

/** 识别 PEM/DER 顶层结构，返回 { kind, desc, alg, detail }。 */
function identifyStructure(der, label) {
  let root;
  try { root = parseAsn1(der); }
  catch (e) { return { kind: "unknown", desc: "ASN.1 解析失败: " + e.message, alg: null, detail: null }; }

 // 先按 PEM 标签快速判定
  if (label && PEM_LABELS[label]) {
    return identifyByKind(der, root, PEM_LABELS[label].kind, PEM_LABELS[label].desc);
  }
 // 无标签 → 按结构推断
  return identifyByStructure(der, root);
}

function identifyByKind(der, root, kind, desc) {
  const detail = {};
  try {
    if (kind === "rsa-priv") {
 // SEQUENCE{ version, n, e, d, p, q, dp, dq, qinv }
      const c = root.children;
      if (c && c.length >= 9) {
        detail.version = decodeInteger(c[0].value).toString();
        detail.modulus_n = decodeInteger(c[1].value).toString();
        detail.publicExponent_e = decodeInteger(c[2].value).toString();
        detail.privateExponent_d = decodeInteger(c[3].value).toString();
        detail.prime1_p = decodeInteger(c[4].value).toString();
        detail.prime2_q = decodeInteger(c[5].value).toString();
        detail.exponent1_dp = decodeInteger(c[6].value).toString();
        detail.exponent2_dq = decodeInteger(c[7].value).toString();
        detail.coefficient_qinv = decodeInteger(c[8].value).toString();
        detail.bitLength = BigInt(detail.modulus_n).toString(2).length;
      }
    } else if (kind === "rsa-pub") {
      const c = root.children;
      if (c && c.length >= 2) {
        detail.modulus_n = decodeInteger(c[0].value).toString();
        detail.publicExponent_e = decodeInteger(c[1].value).toString();
        detail.bitLength = BigInt(detail.modulus_n).toString(2).length;
      }
    } else if (kind === "ec-priv") {
 // SEQUENCE{ version, privateKey OCTET STRING, [0] params, [1] pubkey }
      const c = root.children;
      if (c && c.length >= 2) {
        detail.version = decodeInteger(c[0].value).toString();
        detail.privateKey = toHex(c[1].value);
        detail.privateKeyLen = c[1].value.length;
      }
 // 找 [0] 曲线参数
      for (const ch of c || []) {
        if (ch.class === 2 && ch.tagNum === 0 && ch.children && ch.children[0] && ch.children[0].tagNum === 0x06) {
          detail.curve = OID_NAMES[decodeOID(ch.children[0].value)] || decodeOID(ch.children[0].value);
        }
        if (ch.class === 2 && ch.tagNum === 1) {
          detail.publicKey = toHex(decodeBitString(ch.value).bytes);
        }
      }
    } else if (kind === "pkcs8-priv") {
 // SEQUENCE{ version, AlgorithmIdentifier, privateKey OCTET STRING }
      const c = root.children;
      if (c && c.length >= 3) {
        detail.version = decodeInteger(c[0].value).toString();
        const alg = identifyAlgId(c[1]);
        if (alg) { detail.algorithm = alg.name; detail.curve = alg.curve; }
        detail.privateKey = toHex(c[2].value);
      }
    } else if (kind === "spki-pub") {
 // SEQUENCE{ AlgorithmIdentifier, BIT STRING }
      const c = root.children;
      if (c && c.length >= 2) {
        const alg = identifyAlgId(c[0]);
        if (alg) { detail.algorithm = alg.name; detail.curve = alg.curve; }
        const bs = decodeBitString(c[1].value);
        detail.publicKey = toHex(bs.bytes);
        detail.publicKeyLen = bs.bytes.length;
 // RSA：BIT STRING 内嵌 RSAPublicKey SEQUENCE{ n, e }，递归提取
        if (alg && alg.oid === "1.2.840.113549.1.1.1" && bs.bytes.length) {
          try {
            const inner = parseAsn1(bs.bytes);
            if (inner.children && inner.children.length >= 2
              && inner.children[0].tagNum === 0x02 && inner.children[1].tagNum === 0x02) {
              detail.modulus_n = decodeInteger(inner.children[0].value).toString();
              detail.publicExponent_e = decodeInteger(inner.children[1].value).toString();
              detail.bitLength = BigInt(detail.modulus_n).toString(2).length;
            }
          } catch { /* BIT STRING 内容非 RSA SEQUENCE，保留原始 publicKey */ }
        }
      }
    } else if (kind === "cert") {
 // SEQUENCE{ tbsCertificate, signatureAlgorithm, signatureValue }
      const c = root.children;
      if (c && c.length >= 3) {
        detail.signatureAlgorithm = identifyAlgId(c[1])?.name || "?";
        const tbs = c[0];
        if (tbs.children) {
 // tbsCertificate: [0] version, serial, sigAlg, issuer, validity, subject, spki, ...
          detail.serial = (tbs.children[1] && tbs.children[1].tagNum === 0x02)
            ? decodeInteger(tbs.children[1].value).toString() : "?";
          detail.sigAlgInTbs = identifyAlgId(tbs.children[2])?.name || "?";
        }
      }
    } else if (kind === "csr") {
 // CertificationRequest: SEQUENCE{ certificationRequestInfo, signatureAlgorithm, signature }
      const c = root.children;
      if (c && c.length >= 2) {
        detail.signatureAlgorithm = identifyAlgId(c[1])?.name || "?";
        const cri = c[0];
        if (cri.children) detail.version = decodeInteger(cri.children[0].value).toString();
      }
    }
  } catch { /* 结构识别失败不影响 kind 判定 */ }
  return { kind, desc, alg: detail.algorithm || null, detail };
}

function identifyByStructure(der, root) {
 // 顶层须为 SEQUENCE
  if (root.class !== 0 || root.tagNum !== 0x10 || !root.children) {
    return { kind: "unknown", desc: "非 SEQUENCE 顶层结构", alg: null, detail: null };
  }
  const c = root.children;
 // PKCS#1 RSA 私钥：version(0/1) + 8 个 INTEGER
  if (c.length === 9 && c[0].tagNum === 0x02 && c[1].tagNum === 0x02) {
    let allInt = true;
    for (const ch of c) if (ch.tagNum !== 0x02) { allInt = false; break; }
    if (allInt) return identifyByKind(der, root, "rsa-priv", PEM_LABELS["RSA PRIVATE KEY"].desc);
  }
 // PKCS#1 RSA 公钥：2 个 INTEGER
  if (c.length === 2 && c[0].tagNum === 0x02 && c[1].tagNum === 0x02) {
    return identifyByKind(der, root, "rsa-pub", PEM_LABELS["RSA PUBLIC KEY"].desc);
  }
 // SPKI 公钥：SEQUENCE{ AlgorithmIdentifier(SEQUENCE{OID}), BIT STRING }
  if (c.length === 2 && c[0].class === 0 && c[0].tagNum === 0x10 && c[0].children && c[0].children[0] && c[0].children[0].tagNum === 0x06 && c[1].tagNum === 0x03) {
    return identifyByKind(der, root, "spki-pub", PEM_LABELS["PUBLIC KEY"].desc);
  }
 // PKCS#8 私钥：SEQUENCE{ version INTEGER, AlgorithmIdentifier(SEQUENCE{OID}), OCTET STRING }
  if (c.length >= 3 && c[0].tagNum === 0x02 && c[1].class === 0 && c[1].tagNum === 0x10 && c[1].children && c[1].children[0] && c[1].children[0].tagNum === 0x06 && c[2].tagNum === 0x04) {
    return identifyByKind(der, root, "pkcs8-priv", PEM_LABELS["PRIVATE KEY"].desc);
  }
 // X.509 证书：SEQUENCE{ SEQUENCE(tbs), SEQUENCE(sigAlg), BIT STRING(sig) }
  if (c.length >= 3 && c[0].tagNum === 0x10 && c[1].tagNum === 0x10 && c[2].tagNum === 0x03) {
    return identifyByKind(der, root, "cert", PEM_LABELS["CERTIFICATE"].desc);
  }
 // SEC1 EC 私钥：SEQUENCE{ INTEGER(1), OCTET STRING, ... }
  if (c.length >= 2 && c[0].tagNum === 0x02 && c[1].tagNum === 0x04) {
    return identifyByKind(der, root, "ec-priv", PEM_LABELS["EC PRIVATE KEY"].desc);
  }
  return { kind: "unknown", desc: "未能识别的 ASN.1 SEQUENCE 结构", alg: null, detail: null };
}

// ============================================================
// EC 曲线参数表
// ============================================================
const EC_CURVES = {
  "1.3.132.0.10": {
    names: ["secp256k1"],
    oid: "1.3.132.0.10",
    field: "Fp",
    p: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F",
    a: "0000000000000000000000000000000000000000000000000000000000000000",
    b: "0000000000000000000000000000000000000000000000000000000000000007",
    Gx: "79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
    Gy: "483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8",
    n: "FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
    h: "1",
    bits: 256,
    note: "比特币 / 以太坊使用的曲线（Kobayashi–Koblitz）",
  },
  "1.2.840.10045.3.1.7": {
    names: ["prime256v1", "P-256", "secp256r1"],
    oid: "1.2.840.10045.3.1.7",
    field: "Fp",
    p: "FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF",
    a: "FFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFC",
    b: "5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B",
    Gx: "6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296",
    Gy: "4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5",
    n: "FFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
    h: "1",
    bits: 256,
    note: "NIST P-256，FIPS 186-4，TLS / 苹果 / 谷歌默认曲线",
  },
  "1.3.132.0.34": {
    names: ["secp384r1", "P-384"],
    oid: "1.3.132.0.34",
    field: "Fp",
    bits: 384,
    h: "1",
    note: "NIST P-384，FIPS 186-4",
  },
  "1.3.132.0.35": {
    names: ["secp521r1", "P-521"],
    oid: "1.3.132.0.35",
    field: "Fp",
    bits: 521,
    h: "1",
    note: "NIST P-521，FIPS 186-4",
  },
  "1.3.132.0.31": {
    names: ["secp192r1", "P-192"],
    oid: "1.3.132.0.31",
    field: "Fp",
    bits: 192,
    h: "1",
  },
  "1.3.132.0.33": {
    names: ["secp224r1", "P-224"],
    oid: "1.3.132.0.33",
    field: "Fp",
    bits: 224,
    h: "1",
  },
  "1.3.101.112": {
    names: ["Ed25519"],
    oid: "1.3.101.112",
    field: "Edwards / Twisted Edwards",
    bits: 256,
    note: "Edwards 曲线，EdDSA 签名（RFC 8032），公钥 32 字节",
  },
  "1.3.101.110": {
    names: ["X25519", "Curve25519"],
    oid: "1.3.101.110",
    field: "Montgomery",
    bits: 256,
    note: "Montgomery 曲线，ECDH 密钥交换（RFC 7748），公钥 32 字节",
  },
  "1.3.101.113": {
    names: ["Ed448"],
    oid: "1.3.101.113",
    field: "Edwards",
    bits: 448,
    note: "Edwards 曲线，EdDSA（RFC 8032），公钥 57 字节",
  },
  "1.3.101.111": {
    names: ["X448"],
    oid: "1.3.101.111",
    field: "Montgomery",
    bits: 448,
    note: "Montgomery 曲线，ECDH（RFC 7748），公钥 56 字节",
  },
};

// 名称 → OID 反查
const CURVE_NAME_TO_OID = {};
for (const oid of Object.keys(EC_CURVES)) {
  for (const nm of EC_CURVES[oid].names) CURVE_NAME_TO_OID[nm.toLowerCase()] = oid;
}

// ============================================================
// SSH 公钥解析
// ============================================================
function sshReadString(bytes, off) {
  if (off + 4 > bytes.length) throw new Error("SSH 数据截断：缺少 4 字节长度");
  const len = (bytes[off] << 24) | (bytes[off + 1] << 16) | (bytes[off + 2] << 8) | bytes[off + 3];
  off += 4;
  if (off + len > bytes.length) throw new Error("SSH 数据截断：字段长度超出");
  return { data: bytes.slice(off, off + len), next: off + len };
}
function sshReadMpint(bytes, off) {
  const { data, next } = sshReadString(bytes, off);
 // mpint 大端有符号（前导 0x00 用于保持正数）
  let v = 0n;
  for (const b of data) v = (v << 8n) | BigInt(b);
  return { val: v, next };
}

function parseSshPubkey(text) {
  const t = text.trim();
 // 支持多行：取第一段非空（authorized_keys 单行格式）
  const first = t.split(/\s+/)[0];
 // 情况 1：标准 "type base64 comment"
  const m = t.match(/^([a-zA-Z0-9-]+)\s+([A-Za-z0-9+/=_]+)(?:\s+(\S.*))?$/);
  let keyType, blobB64, comment;
  if (m) {
    keyType = m[1];
    blobB64 = m[2];
    comment = m[3] || "";
  } else if (first && /^[A-Za-z0-9+/=_]+$/.test(first)) {
 // 情况 2：纯 base64（无类型前缀）——从 blob 内部读类型
    keyType = null;
    blobB64 = first;
    comment = "";
  } else {
    throw new Error("无法识别 SSH 公钥格式（应为 'type base64 comment'）");
  }
  const blob = b64ToBytes(blobB64);
 // 第一个字段总是 key type 字符串
  const { data: typeData, next } = sshReadString(blob, 0);
  const innerType = new TextDecoder().decode(typeData);
  if (!keyType) keyType = innerType;
  const fields = { keyType: innerType };
  const report = { keyType, comment, blob, fields: {}, raw: {} };

  if (innerType === "ssh-rsa") {
    const e = sshReadMpint(blob, next);
    const n = sshReadMpint(blob, e.next);
    fields.e = e.val;
    fields.n = n.val;
    report.fields = { e: e.val.toString(), n: n.val.toString(), modulusBits: n.val.toString(2).length };
  } else if (innerType === "ssh-ed25519") {
    const { data: pub, next: n2 } = sshReadString(blob, next);
    fields.publicKey = toHex(pub);
    fields.publicKeyLen = pub.length;
    report.fields = { publicKey: toHex(pub), publicKeyLen: pub.length };
    void n2;
  } else if (innerType === "ssh-dss") {
    const p = sshReadMpint(blob, next);
    const q = sshReadMpint(blob, p.next);
    const g = sshReadMpint(blob, q.next);
    const y = sshReadMpint(blob, g.next);
    report.fields = { p: p.val.toString(), q: q.val.toString(), g: g.val.toString(), y: y.val.toString() };
  } else if (innerType.startsWith("ecdsa-sha2-")) {
    const { data: curveData, next: n2 } = sshReadString(blob, next);
    const { data: pointData, next: n3 } = sshReadString(blob, n2);
    const curve = new TextDecoder().decode(curveData);
    report.fields = { curve, publicKeyPoint: toHex(pointData), publicKeyLen: pointData.length };
    void n3;
  } else if (innerType === "sk-ssh-ed25519@openssh.com") {
    const { data: pub, next: n2 } = sshReadString(blob, next);
    const { data: app, next: n3 } = sshReadString(blob, n2);
    report.fields = { publicKey: toHex(pub), application: new TextDecoder().decode(app) };
    void n3;
  } else {
 // 通用：剩余当原始字段
    report.fields.raw = toHex(blob.slice(next));
  }
  return report;
}

// SHA-256 指纹（SSH fingerprint，OpenSSH 格式）
function sshFingerprint(blob) {
  const h = sha256Bytes(blob);
  let b64 = bytesToB64(h);
  b64 = b64.replace(/=+$/, "");
  return "SHA256:" + b64;
}

// ============================================================
// Base58 解码（比特币地址用）
// ============================================================
const B58_DICT = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s) {
  const clean = String(s).trim();
  if (!clean) throw new Error("空地址");
  let zeros = 0;
  while (zeros < clean.length && clean[zeros] === "1") zeros++;
  let num = 0n;
  for (const ch of clean) {
    const idx = B58_DICT.indexOf(ch);
    if (idx === -1) throw new Error("非法 Base58 字符: " + ch);
    num = num * 58n + BigInt(idx);
  }
  const bytes = [];
  while (num > 0n) { bytes.unshift(Number(num & 0xffn)); num >>= 8n; }
  return new Uint8Array([...new Array(zeros).fill(0), ...bytes]);
}

// ============================================================
// Bech32 解码（BIP-173，比特币 SegWit 地址）
// ============================================================
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function bech32Polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
function bech32HrpExpand(hrp) {
  const out = [];
  for (const c of hrp) out.push(c.charCodeAt(0) >> 5);
  out.push(0);
  for (const c of hrp) out.push(c.charCodeAt(0) & 0x1f);
  return out;
}
function bech32VerifyChecksum(hrp, data) {
  return bech32Polymod([...bech32HrpExpand(hrp), ...data]) === 1;
}
function bech32Decode(addr) {
  const s = String(addr).trim();
  if (s.length < 8 || s.length > 90) throw new Error("Bech32 长度非法");
 // 不区分大小写，但全大写或全小写
  const lower = s.toLowerCase();
  const upper = s.toUpperCase();
  if (s !== lower && s !== upper) throw new Error("Bech32 大小写混合非法");
  const pos = lower.lastIndexOf("1");
  if (pos < 1 || pos + 7 > lower.length) throw new Error("Bech32 分隔符位置非法");
  const hrp = lower.slice(0, pos);
  const dataPart = lower.slice(pos + 1);
  const data = [];
  for (const c of dataPart) {
    const idx = BECH32_CHARSET.indexOf(c);
    if (idx === -1) throw new Error("Bech32 非法字符: " + c);
    data.push(idx);
  }
  if (!bech32VerifyChecksum(hrp, data)) throw new Error("Bech32 校验失败");
 // data 最后 6 字节为校验，前面为 payload
  return { hrp, data: data.slice(0, -6) };
}
// Bech32 数据（5-bit）→ 8-bit 字节
function bech32ConvertBits(data, fromBits, toBits, pad) {
  let acc = 0, bits = 0;
  const maxv = (1 << toBits) - 1;
  const maxAcc = (1 << (fromBits + toBits - 1)) - 1;
  const out = [];
  for (const v of data) {
    if (v < 0 || (v >> fromBits) !== 0) throw new Error("Bech32 数据值越界");
    acc = ((acc << fromBits) | v) & maxAcc;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits) out.push((acc << (toBits - bits)) & maxv);
  } else if (bits >= fromBits || ((acc << (toBits - bits)) & maxv)) {
    throw new Error("Bech32 数据非零填充");
  }
  return out;
}

// ============================================================
// 比特币地址识别
// ============================================================
const BTC_VERSIONS = {
  0x00: { type: "P2PKH", net: "mainnet", desc: "传统付公钥哈希地址（1 开头）" },
  0x6f: { type: "P2PKH", net: "testnet", desc: "测试网 P2PKH（m/n 开头）" },
  0x05: { type: "P2SH", net: "mainnet", desc: "付脚本哈希地址（3 开头）" },
  0xc4: { type: "P2SH", net: "testnet", desc: "测试网 P2SH（2 开头）" },
};

function identifyBtcAddress(text) {
  const addr = String(text).trim();
  if (!addr) throw new Error("空地址");
 // Bech32 / Bech32m SegWit（bc1 / tb1 / bcrt1）
  const lower = addr.toLowerCase();
  if (/^(bc|tb|bcrt)1/.test(lower)) {
    const hrpMap = { bc: "mainnet", tb: "testnet", bcrt: "regtest" };
    let decoded;
    try { decoded = bech32Decode(addr); }
    catch (e) { return { ok: false, raw: addr, type: "Bech32?", error: e.message }; }
    const hrp = decoded.hrp;
    const data = decoded.data;
    if (!data.length) return { ok: false, raw: addr, type: "Bech32", error: "空 witness 数据" };
    const witver = data[0];
    const witprog = bech32ConvertBits(data.slice(1), 5, 8, false);
    const lines = [];
    lines.push("=== 比特币地址识别（Bech32 SegWit）===");
    lines.push(`地址: ${addr}`);
    lines.push(`编码: Bech32${witver === 0 ? "" : (witver === 1 ? "m (Taproot)" : "")}`);
    lines.push(`HRP: ${hrp}  →  网络: ${hrpMap[hrp] || "?"}`);
    lines.push(`Witness 版本: ${witver}`);
    lines.push(`Witness 程序: ${toHex(new Uint8Array(witprog))} (${witprog.length} 字节)`);
    let segType = "?";
    if (witver === 0 && witprog.length === 20) segType = "P2WPKH（原生 SegWit v0 付公钥哈希）";
    else if (witver === 0 && witprog.length === 32) segType = "P2WSH（原生 SegWit v0 付脚本哈希）";
    else if (witver === 1 && witprog.length === 32) segType = "P2TR（Taproot，SegWit v1）";
    lines.push(`类型: ${segType}`);
    lines.push("校验: ✓ Bech32 校验通过");
    return { ok: true, lines: lines.join("\n"), type: segType, net: hrpMap[hrp] };
  }
 // Base58Check
  let raw;
  try { raw = base58Decode(addr); }
  catch (e) { return { ok: false, raw: addr, type: "?", error: e.message }; }
  if (raw.length < 5) return { ok: false, raw: addr, type: "?", error: "Base58 解码后长度不足" };
  const version = raw[0];
  const payload = raw.slice(1, raw.length - 4);
  const checksum = raw.slice(raw.length - 4);
  const calc = sha256Bytes(sha256Bytes(raw.slice(0, raw.length - 4))).slice(0, 4);
  let checkOk = true;
  for (let i = 0; i < 4; i++) if (checksum[i] !== calc[i]) { checkOk = false; break; }
  const v = BTC_VERSIONS[version];
  const lines = [];
  lines.push("=== 比特币地址识别（Base58Check）===");
  lines.push(`地址: ${addr}`);
  lines.push(`编码: Base58Check`);
  lines.push(`版本字节: 0x${version.toString(16).padStart(2, "0")}`);
  if (v) {
    lines.push(`类型: ${v.type}  ·  网络: ${v.net}`);
    lines.push(`说明: ${v.desc}`);
  } else {
    lines.push(`类型: 未知版本字节`);
  }
  lines.push(`哈希: ${toHex(payload)} (${payload.length} 字节)`);
  lines.push(`校验和: ${toHex(checksum)}  →  计算: ${toHex(calc)}  ${checkOk ? "✓" : "✗ 不匹配"}`);
  if (!checkOk) lines.push("⚠ 校验失败：地址可能损坏或非比特币地址");
  return { ok: checkOk, lines: lines.join("\n"), type: v ? v.type : "unknown", net: v ? v.net : "unknown" };
}

// ============================================================
// 以太坊地址识别（EIP-55）
// ============================================================
function identifyEthAddress(text) {
  const raw = String(text).trim();
  const addr = raw.startsWith("0x") || raw.startsWith("0X") ? raw.slice(2) : raw;
  if (!/^[0-9a-fA-F]{40}$/.test(addr)) {
    throw new Error("非法以太坊地址：须为 0x + 40 位十六进制");
  }
  const lower = addr.toLowerCase();
  const hashHex = keccak256(lower);
  let checksummed = "0x";
  for (let i = 0; i < 40; i++) {
    const c = lower[i];
    if (/[0-9]/.test(c)) { checksummed += c; continue; }
    const nibble = parseInt(hashHex[i], 16);
    checksummed += nibble >= 8 ? c.toUpperCase() : c;
  }
  const isMixed = /[A-F]/.test(addr) && /[a-f]/.test(addr);
  const userChecksumOk = !isMixed || (raw.toLowerCase().startsWith("0x") ? ("0x" + addr) === checksummed : addr === checksummed.slice(2));
  const inputNorm = (raw.startsWith("0x") || raw.startsWith("0X")) ? "0x" + addr : addr;
  const exactOk = inputNorm === checksummed;
  const lines = [];
  lines.push("=== 以太坊地址识别（EIP-55）===");
  lines.push(`地址: ${raw}`);
  lines.push(`长度: ${addr.length} 位十六进制（20 字节）`);
  lines.push(`EIP-55 校验地址: ${checksummed}`);
  lines.push(`输入大小写: ${isMixed ? "混合大小写" : "纯小写/大写（无校验信息）"}`);
  if (exactOk) {
    lines.push("校验: ✓ EIP-55 混合大小写校验通过");
  } else if (isMixed) {
    lines.push("校验: ✗ EIP-55 校验失败（大小写与 Keccak-256 哈希不符）");
  } else {
    lines.push("校验: — 纯小写/大写地址无 EIP-55 校验信息（建议用上面的校验地址）");
  }
  void userChecksumOk;
  return { ok: exactOk || !isMixed, lines: lines.join("\n"), checksummed };
}

// ============================================================
// 报告函数（run 入口）
// ============================================================

// ---- pemParse ----
function pemParseReport(text, p) {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定，双模文本/字节 op）：
 // PEM 是 ASCII 文本，把真字节按 latin1 还原成文本再走原 PEM 解析；
 // 裸 DER 二进制文件（无 -----BEGIN----- 头）则直接按 DER 字节识别结构。
  let t;
  if (p && p.rawBytes && p.rawBytes.length) {
    const rb = p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
    let s = "";
    for (let i = 0; i < rb.length; i++) s += String.fromCharCode(rb[i]);
 // 含 PEM 头 → 当文本处理；否则当裸 DER 直接解析
    if (s.indexOf("-----BEGIN") < 0 && rb.length >= 2) {
      const lines = [];
      const id = identifyStructure(rb, null);
      lines.push("=== DER 结构解析（拖入二进制文件）===");
      lines.push(`输入: ${rb.length} 字节`);
      lines.push(`DER hex: ${rb.length <= 64 ? toHex(rb) : toHex(rb.slice(0, 64)) + "…(" + rb.length + " 字节)"}`);
      lines.push(`类型: ${id.desc}`);
      if (id.detail && Object.keys(id.detail).length) {
        lines.push("结构字段:");
        for (const [k, v] of Object.entries(id.detail)) {
          const vs = String(v);
          lines.push(`  ${k}: ${vs.length > 80 ? vs.slice(0, 80) + "…(" + vs.length + " 字符)" : vs}`);
        }
      }
      lines.push("ASN.1 树:");
      try { lines.push(...formatAsn1Tree(parseAsn1(rb), 1, 4)); }
      catch (e) { lines.push("  (ASN.1 解析失败: " + e.message + ")"); }
      return lines.join("\n");
    }
    t = s;
  } else {
    t = String(text);
  }
  const blocks = extractPem(t);
  const lines = [];
  if (blocks && blocks.length) {
    lines.push("=== PEM 结构解析（" + blocks.length + " 个块）===");
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const meta = PEM_LABELS[b.label] || { kind: "unknown", desc: "未知 PEM 标签" };
      const id = identifyStructure(b.der, b.label);
      lines.push("");
      lines.push(`[块 ${i + 1}] ${b.label}  ·  ${meta.desc}`);
      lines.push(`DER: ${b.der.length} 字节`);
      lines.push(`DER hex: ${b.der.length <= 64 ? toHex(b.der) : toHex(b.der.slice(0, 64)) + "…(" + b.der.length + " 字节)"}`);
      if (id.detail && Object.keys(id.detail).length) {
        lines.push("结构字段:");
        for (const [k, v] of Object.entries(id.detail)) {
          const vs = String(v);
          lines.push(`  ${k}: ${vs.length > 80 ? vs.slice(0, 80) + "…(" + vs.length + " 字符)" : vs}`);
        }
      }
 // 内嵌 ASN.1 树（前 2 层）
      lines.push("ASN.1 顶层:");
      try {
        const root = parseAsn1(b.der);
        lines.push(...formatAsn1Tree(root, 1, 2));
      } catch (e) { lines.push("  (ASN.1 解析失败: " + e.message + ")"); }
    }
    return lines.join("\n");
  }
 // 裸 DER hex / base64
  const der = detectRawDer(t);
  if (der && der.length >= 2) {
    const id = identifyStructure(der, null);
    lines.push("=== DER 结构解析（无 PEM 头）===");
    lines.push(`输入: ${der.length} 字节（自动识别为 ${/^[0-9a-fA-F\s]+$/.test(t.trim()) ? "hex" : "base64"}）`);
    lines.push(`DER hex: ${der.length <= 64 ? toHex(der) : toHex(der.slice(0, 64)) + "…(" + der.length + " 字节)"}`);
    lines.push(`类型: ${id.desc}`);
    if (id.detail && Object.keys(id.detail).length) {
      lines.push("结构字段:");
      for (const [k, v] of Object.entries(id.detail)) {
        const vs = String(v);
        lines.push(`  ${k}: ${vs.length > 80 ? vs.slice(0, 80) + "…(" + vs.length + " 字符)" : vs}`);
      }
    }
    lines.push("ASN.1 树:");
    try { lines.push(...formatAsn1Tree(parseAsn1(der), 1, 4)); }
    catch (e) { lines.push("  (ASN.1 解析失败: " + e.message + ")"); }
    return lines.join("\n");
  }
  throw new Error("未识别到 PEM 块或 DER 数据（须为 -----BEGIN...----- 或 hex/base64）");
}

// ---- asn1Parse ----
function asn1ParseReport(text, p) {
  let der;
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：DER 是二进制，直接用真字节，跳过 hex/base64 文本解析。
  if (p && p.rawBytes && p.rawBytes.length) {
    der = p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  } else {
    const t = String(text).trim();
 // hex 优先
    if (/^[0-9a-fA-F\s]+$/.test(t) && t.replace(/\s/g, "").length % 2 === 0) {
      der = fromHex(t);
    } else {
      der = b64ToBytes(t);
    }
  }
  const root = parseAsn1(der);
  const lines = [];
  lines.push("=== ASN.1 DER 解析（X.690 TLV 递归）===");
  lines.push(`输入: ${der.length} 字节`);
  lines.push("");
  lines.push(...formatAsn1Tree(root, 0, 8));
  lines.push("");
  lines.push("=== 顶层节点统计 ===");
  function countNodes(n) {
    let c = 1;
    if (n.children) for (const ch of n.children) c += countNodes(ch);
    return c;
  }
  lines.push(`节点总数: ${countNodes(root)}`);
  lines.push(`顶层类型: ${nodeTypeName(root)}`);
  return lines.join("\n");
}

// ---- ecCurveIdent ----
function ecCurveIdentReport(text) {
  const t = String(text).trim();
  const lines = [];
 // 情况 1：点分 OID（如 1.3.132.0.10）
  if (/^\d+(\.\d+)+$/.test(t)) {
    const c = EC_CURVES[t];
    lines.push("=== 椭圆曲线识别（OID 输入）===");
    lines.push(`OID: ${t}`);
    lines.push(`名称: ${c ? c.names.join(" / ") : "未知曲线"}`);
    if (c) lines.push(...formatCurve(c));
    else lines.push("（不在已知曲线表中）");
    return lines.join("\n");
  }
 // 情况 2：DER hex 编码的 OID
  if (/^[0-9a-fA-F\s]+$/.test(t)) {
    try {
      const der = fromHex(t);
 // 可能是完整 TLV（06 ...）或纯内容字节
      let oidBytes;
      if (der[0] === 0x06) { const node = parseAsn1(der); oidBytes = node.value; }
      else oidBytes = der;
      const oid = decodeOID(oidBytes);
      const c = EC_CURVES[oid];
      lines.push("=== 椭圆曲线识别（DER OID 输入）===");
      lines.push(`解码 OID: ${oid}`);
      lines.push(`名称: ${c ? c.names.join(" / ") : "未知曲线"}`);
      if (c) lines.push(...formatCurve(c));
      else lines.push("（不在已知曲线表中）");
      return lines.join("\n");
    } catch (e) { /* fallthrough */ void e; }
  }
 // 情况 3：曲线名称（secp256k1 / P-256 / Ed25519…）
  const oid = CURVE_NAME_TO_OID[t.toLowerCase()];
  if (oid) {
    const c = EC_CURVES[oid];
    lines.push("=== 椭圆曲线识别（名称输入）===");
    lines.push(`输入: ${t}`);
    lines.push(`别名: ${c.names.join(" / ")}`);
    lines.push(...formatCurve(c));
    return lines.join("\n");
  }
  throw new Error("无法识别曲线（须为点分 OID / DER hex / 曲线名称如 secp256k1、P-256、Ed25519）");
}
function formatCurve(c) {
  const out = [`OID: ${c.oid}`];
  if (c.field) out.push(`有限域: ${c.field}`);
  if (c.bits) out.push(`位宽: ${c.bits} bit`);
  if (c.p) out.push(`p = ${c.p}`);
  if (c.a) out.push(`a = ${c.a}`);
  if (c.b) out.push(`b = ${c.b}`);
  if (c.Gx) out.push(`Gx = ${c.Gx}`);
  if (c.Gy) out.push(`Gy = ${c.Gy}`);
  if (c.n) out.push(`n (阶) = ${c.n}`);
  if (c.h) out.push(`h (余因子) = ${c.h}`);
  if (c.note) out.push(`备注: ${c.note}`);
  return out;
}

// ---- sshPubkeyParse ----
function sshPubkeyParseReport(text) {
  const r = parseSshPubkey(text);
  const lines = [];
  lines.push("=== SSH 公钥解析 ===");
  lines.push(`类型: ${r.keyType}`);
  if (r.comment) lines.push(`注释: ${r.comment}`);
  lines.push(`blob: ${r.blob.length} 字节`);
  lines.push(`SHA256 指纹: ${sshFingerprint(r.blob)}`);
  lines.push("");
  lines.push("字段:");
  for (const [k, v] of Object.entries(r.fields)) {
    const vs = String(v);
    lines.push(`  ${k}: ${vs.length > 80 ? vs.slice(0, 80) + "…(" + vs.length + " 字符)" : vs}`);
  }
  return lines.join("\n");
}

// ---- btcAddressIdent ----
function btcAddressIdentReport(text) {
  const r = identifyBtcAddress(text);
  if (r.lines) return r.lines;
  throw new Error(r.error || "地址识别失败");
}

// ---- ethAddressIdent ----
function ethAddressIdentReport(text) {
  const r = identifyEthAddress(text);
  return r.lines;
}

// ============================================================
// 注册
// ============================================================
register({
  id: "pemParse",
  cat: "data",
  name: "PEM/DER 结构解析",
  desc: "识别 RSA/EC/Ed25519 公私钥、X.509 证书、CSR（输入 PEM 文本或 DER hex/base64）",
  params: [],
  run: pemParseReport,
  acceptsBytes: true,
});
register({
  id: "asn1Parse",
  cat: "data",
  name: "ASN.1 TLV 解析",
  desc: "X.690 DER 递归解析（输入 DER hex 或 base64，输出标签/长度/值树 + OID 名称）",
  params: [],
  run: asn1ParseReport,
  acceptsBytes: true,
});
register({
  id: "ecCurveIdent",
  cat: "crypto",
  name: "椭圆曲线参数识别",
  desc: "识别 secp256k1/P-256/Curve25519 等曲线（输入曲线名 / 点分 OID / DER OID，输出域参数 p,a,b,G,n,h）",
  params: [],
  run: ecCurveIdentReport,
});
register({
  id: "sshPubkeyParse",
  cat: "data",
  name: "SSH 公钥解析",
  desc: "解析 ssh-rsa / ssh-ed25519 / ecdsa-sha2-* 公钥（authorized_keys 格式，拆解 base64 blob 字段 + SHA256 指纹）",
  params: [],
  run: sshPubkeyParseReport,
});
register({
  id: "btcAddressIdent",
  cat: "data",
  name: "比特币地址识别",
  desc: "识别 P2PKH / P2SH / P2WPKH / P2WSH / P2TR 地址类型 + 网络主测试 + Base58Check/Bech32 校验",
  params: [],
  run: btcAddressIdentReport,
});
register({
  id: "ethAddressIdent",
  cat: "data",
  name: "以太坊地址识别",
  desc: "识别 0x 地址并校验 EIP-55 混合大小写（Keccak-256 哈希逐位校验，输出标准校验地址）",
  params: [],
  run: ethAddressIdentReport,
});

export {
  pemParseReport, asn1ParseReport, ecCurveIdentReport,
  sshPubkeyParseReport, btcAddressIdentReport, ethAddressIdentReport,
 // 导出纯算法供测试
  parseAsn1, decodeOID, decodeInteger, decodeBitString, formatAsn1Tree, nodeTypeName,
  identifyStructure, identifyAlgId,
  extractPem, detectRawDer,
  parseSshPubkey, sshReadString, sshReadMpint, sshFingerprint,
  identifyBtcAddress, base58Decode, bech32Decode, bech32ConvertBits,
  identifyEthAddress,
  EC_CURVES, CURVE_NAME_TO_OID, OID_NAMES, TAG_NAMES, PEM_LABELS,
};
