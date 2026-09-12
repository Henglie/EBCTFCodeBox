/*
 * certparse.js — X.509 证书解析 + SSH 公钥（authorized_keys / known_hosts）解析
 * 任务卡 T354（v0.1.6beta 批A5）。单向 run 工具（解析器，无双向编码语义）。
 *
 * 标准依据（注释随行标注）：
 *   - ITU-T X.509 / RFC 5280：证书结构 §4.1、有效期 §4.1.2.5、扩展 §4.2
 *   - ITU-T X.501 §9：Name（RDNSequence）DN 结构
 *   - ITU-T X.690：DER（复用 rsagen.js 的 derDecode/derEncode/derBytesToBigint）
 *   - RFC 7468：PEM 文本封装（复用 pemkeys.js 的 parsePem）
 *   - RFC 5480 / RFC 8017 / RFC 8410 / RFC 3279：算法与曲线 OID
 *   - RFC 4251 §5：SSH string/mpint wire 编码；RFC 4253 §6.6：ssh-rsa/ssh-dss
 *   - RFC 5656：ecdsa-sha2-nistp*；RFC 8709：ssh-ed25519；RFC 4716：SSH2 公钥文件格式
 *
 * 对拍基准：openssl x509 -text -noout / ssh-keygen -lf（SHA-256）、-E md5 -lf。
 * 算法层零 UI 依赖，node 直跑。
 */
import { register } from "./registry.js";
import { derDecode, derEncode, derBytesToBigint, bytesToBase64 } from "./rsagen.js";
import { parsePem, oidString, base64Decode } from "./pemkeys.js";
import { md5Bytes } from "./hash.js";

// ============================================================
// 通用小工具
// ============================================================

const TD_UTF8 = new TextDecoder();

function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}

/** 大写冒号分组 hex（openssl serial 显示风格） */
function hexColon(b) {
  const out = [];
  for (const x of b) out.push(x.toString(16).padStart(2, "0").toUpperCase());
  return out.join(":");
}

function asciiStr(b) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return s;
}

function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

/** hex 串按 64 字符折行（长模数/签名可读性） */
function wrap64(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 64) out.push(s.slice(i, i + 64));
  return out;
}

/** 大 BigInt → 连续大写 hex（无前导 0，对拍 openssl x509 -modulus 风格） */
function bigintToHexUpper(v) {
  const h = v.toString(16).replace(/^0+/, "") || "0";
  return h.toUpperCase();
}

// ============================================================
// OID 友好名表（约 100 条）
// 来源：RFC 5280 §A.2 / RFC 4519 / ITU-T X.520 / PKCS#9(RFC 2985) /
//       RFC 5480 / RFC 8017 §A / RFC 8410 / RFC 3279 / RFC 6960 §4.2.3 / NIST
// [短名, 全名]；未知 OID 显示原值。
// ============================================================

const OID_NAME = {
  // ---- DN 属性（X.520 / RFC 4519 / PKCS#9）----
  "2.5.4.0": ["objectClass", "objectClass"],
  "2.5.4.3": ["CN", "commonName"],
  "2.5.4.4": ["SN", "surname"],
  "2.5.4.5": ["serialNumber", "serialNumber"],
  "2.5.4.6": ["C", "countryName"],
  "2.5.4.7": ["L", "localityName"],
  "2.5.4.8": ["ST", "stateOrProvinceName"],
  "2.5.4.9": ["street", "streetAddress"],
  "2.5.4.10": ["O", "organizationName"],
  "2.5.4.11": ["OU", "organizationalUnitName"],
  "2.5.4.12": ["title", "title"],
  "2.5.4.13": ["description", "description"],
  "2.5.4.15": ["businessCategory", "businessCategory"],
  "2.5.4.16": ["postalAddress", "postalAddress"],
  "2.5.4.17": ["postalCode", "postalCode"],
  "2.5.4.20": ["telephoneNumber", "telephoneNumber"],
  "2.5.4.41": ["name", "name"],
  "2.5.4.42": ["GN", "givenName"],
  "2.5.4.43": ["initials", "initials"],
  "2.5.4.44": ["generationQualifier", "generationQualifier"],
  "2.5.4.45": ["uniqueIdentifier", "uniqueIdentifier"],
  "2.5.4.46": ["dnQualifier", "dnQualifier"],
  "2.5.4.51": ["houseIdentifier", "houseIdentifier"],
  "2.5.4.65": ["pseudonym", "pseudonym"],
  "0.9.2342.19200300.100.1.1": ["UID", "userId"],
  "0.9.2342.19200300.100.1.25": ["DC", "domainComponent"],
  "1.2.840.113549.1.9.1": ["emailAddress", "emailAddress"],
  "1.2.840.113549.1.9.2": ["unstructuredName", "unstructuredName"],
  "1.3.6.1.4.1.311.60.2.1.1": ["jurisdictionL", "jurisdictionLocalityName"],
  "1.3.6.1.4.1.311.60.2.1.2": ["jurisdictionST", "jurisdictionStateOrProvinceName"],
  "1.3.6.1.4.1.311.60.2.1.3": ["jurisdictionC", "jurisdictionCountryName"],
  // ---- 签名/公钥算法（RFC 8017 §A.2 / RFC 5480 §2 / RFC 8410 / RFC 3279）----
  "1.2.840.113549.1.1.1": ["rsaEncryption", "rsaEncryption"],
  "1.2.840.113549.1.1.3": ["md4WithRSAEncryption", "md4WithRSAEncryption"],
  "1.2.840.113549.1.1.4": ["md5WithRSAEncryption", "md5WithRSAEncryption"],
  "1.2.840.113549.1.1.5": ["sha1WithRSAEncryption", "sha1WithRSAEncryption"],
  "1.2.840.113549.1.1.7": ["id-RSAES-OAEP", "RSAES-OAEP"],
  "1.2.840.113549.1.1.8": ["id-MGF1", "mgf1"],
  "1.2.840.113549.1.1.10": ["id-RSASSA-PSS", "RSASSA-PSS"],
  "1.2.840.113549.1.1.11": ["sha256WithRSAEncryption", "sha256WithRSAEncryption"],
  "1.2.840.113549.1.1.12": ["sha384WithRSAEncryption", "sha384WithRSAEncryption"],
  "1.2.840.113549.1.1.13": ["sha512WithRSAEncryption", "sha512WithRSAEncryption"],
  "1.2.840.113549.1.1.14": ["sha224WithRSAEncryption", "sha224WithRSAEncryption"],
  "1.2.840.10040.4.1": ["id-DSA", "dsa"],
  "1.2.840.10040.4.3": ["id-dsa-with-sha1", "dsaWithSha1"],
  "2.16.840.1.101.3.4.3.1": ["id-dsa-with-sha224", "dsaWithSha224"],
  "2.16.840.1.101.3.4.3.2": ["id-dsa-with-sha256", "dsaWithSha256"],
  "1.2.840.10045.2.1": ["id-ecPublicKey", "ecPublicKey"],
  "1.2.840.10045.4.1": ["ecdsa-with-SHA1", "ecdsa-with-SHA1"],
  "1.2.840.10045.4.3.1": ["ecdsa-with-SHA224", "ecdsa-with-SHA224"],
  "1.2.840.10045.4.3.2": ["ecdsa-with-SHA256", "ecdsa-with-SHA256"],
  "1.2.840.10045.4.3.3": ["ecdsa-with-SHA384", "ecdsa-with-SHA384"],
  "1.2.840.10045.4.3.4": ["ecdsa-with-SHA512", "ecdsa-with-SHA512"],
  "1.3.101.112": ["Ed25519", "Ed25519"],
  "1.3.101.113": ["Ed448", "Ed448"],
  // ---- 哈希 OID（PSS 参数内可见）----
  "1.2.840.113549.2.5": ["md5", "md5"],
  "1.3.14.3.2.26": ["sha1", "sha1"],
  "2.16.840.1.101.3.4.2.1": ["sha256", "sha256"],
  "2.16.840.1.101.3.4.2.2": ["sha384", "sha384"],
  "2.16.840.1.101.3.4.2.3": ["sha512", "sha512"],
  // ---- EC 曲线（RFC 5480 §2.1 / SEC 2 v2）----
  "1.2.840.10045.3.1.7": ["prime256v1", "P-256 / secp256r1"],
  "1.3.132.0.33": ["P-224", "secp224r1"],
  "1.3.132.0.34": ["P-384", "secp384r1"],
  "1.3.132.0.35": ["P-521", "secp521r1"],
  "1.3.132.0.10": ["secp256k1", "secp256k1"],
  // ---- 扩展（RFC 5280 §4.2 / RFC 6960）----
  "2.5.29.9": ["subjectDirectoryAttributes", "subjectDirectoryAttributes"],
  "2.5.29.14": ["subjectKeyIdentifier", "subjectKeyIdentifier"],
  "2.5.29.15": ["keyUsage", "keyUsage"],
  "2.5.29.16": ["privateKeyUsagePeriod", "privateKeyUsagePeriod"],
  "2.5.29.17": ["subjectAltName", "subjectAltName"],
  "2.5.29.18": ["issuerAltName", "issuerAltName"],
  "2.5.29.19": ["basicConstraints", "basicConstraints"],
  "2.5.29.20": ["cRLNumber", "cRLNumber"],
  "2.5.29.21": ["cRLReason", "cRLReason"],
  "2.5.29.24": ["invalidityDate", "invalidityDate"],
  "2.5.29.27": ["deltaCRLIndicator", "deltaCRLIndicator"],
  "2.5.29.28": ["issuingDistributionPoint", "issuingDistributionPoint"],
  "2.5.29.29": ["certificateIssuer", "certificateIssuer"],
  "2.5.29.30": ["nameConstraints", "nameConstraints"],
  "2.5.29.31": ["cRLDistributionPoints", "cRLDistributionPoints"],
  "2.5.29.32": ["certificatePolicies", "certificatePolicies"],
  "2.5.29.33": ["policyMappings", "policyMappings"],
  "2.5.29.35": ["authorityKeyIdentifier", "authorityKeyIdentifier"],
  "2.5.29.36": ["policyConstraints", "policyConstraints"],
  "2.5.29.37": ["extKeyUsage", "extKeyUsage"],
  "2.5.29.46": ["freshestCRL", "freshestCRL"],
  "2.5.29.54": ["inhibitAnyPolicy", "inhibitAnyPolicy"],
  "1.3.6.1.5.5.7.1.1": ["authorityInfoAccess", "authorityInfoAccess"],
  "1.3.6.1.5.5.7.1.11": ["subjectInfoAccess", "subjectInfoAccess"],
  "1.3.6.1.4.1.11129.2.4.2": ["ctCertSCTs", "CT SignedCertificateTimestampList"],
  // ---- EKU 用途（RFC 5280 §4.2.1.12 / RFC 6960 §4.2.3）----
  "2.5.29.37.0": ["anyExtendedKeyUsage", "anyExtendedKeyUsage"],
  "1.3.6.1.5.5.7.3.1": ["serverAuth", "id-kp-serverAuth"],
  "1.3.6.1.5.5.7.3.2": ["clientAuth", "id-kp-clientAuth"],
  "1.3.6.1.5.5.7.3.3": ["codeSigning", "id-kp-codeSigning"],
  "1.3.6.1.5.5.7.3.4": ["emailProtection", "id-kp-emailProtection"],
  "1.3.6.1.5.5.7.3.5": ["ipsecEndSystem", "id-kp-ipsecEndSystem"],
  "1.3.6.1.5.5.7.3.6": ["ipsecTunnel", "id-kp-ipsecTunnel"],
  "1.3.6.1.5.5.7.3.7": ["ipsecUser", "id-kp-ipsecUser"],
  "1.3.6.1.5.5.7.3.8": ["timeStamping", "id-kp-timeStamping"],
  "1.3.6.1.5.5.7.3.9": ["OCSPSigning", "id-kp-OCSPSigning"],
  // ---- AIA 访问方法（RFC 6960 / RFC 5280 §4.2.2.1）----
  "1.3.6.1.5.5.7.48.1": ["OCSP", "id-ad-ocsp"],
  "1.3.6.1.5.5.7.48.2": ["caIssuers", "id-ad-caIssuers"],
  // ---- Netscape（历史遗留，老证书常见）----
  "2.16.840.1.113730.1.1": ["netscapeCertType", "netscapeCertType"],
};

/** OID → "短名（全名）"；未知返回原 OID */
function oidLabel(oid) {
  const e = OID_NAME[oid];
  return e ? `${e[0]}（${e[1]}）` : oid;
}

/** OID → 短名；未知返回原 OID */
function oidShort(oid) {
  const e = OID_NAME[oid];
  return e ? e[0] : oid;
}

/** EC 曲线 OID → 域字节长（坐标定长字节数，SEC 1 §2.3.3 非压缩点 1+2n） */
const CURVE_FIELD_BYTES = {
  "1.2.840.10045.3.1.7": 32, // P-256
  "1.3.132.0.33": 28,        // P-224
  "1.3.132.0.34": 48,        // P-384
  "1.3.132.0.35": 66,        // P-521
  "1.3.132.0.10": 32,        // secp256k1
};

// ============================================================
// X.509 证书解析（ITU-T X.509 / RFC 5280 §4.1）
// ============================================================

/** ASN.1 Time → UTC 毫秒。UTCTime(0x17) RFC 5280 §4.1.2.5.1（YY≥50→19xx）；
 *  GeneralizedTime(0x18) §4.1.2.5.2。容忍 ±hhmm 偏移（BER 宽松，DER 应为 Z）。 */
function parseTimeNode(node, what) {
  const raw = asciiStr(node.value);
  let ms;
  let off = "Z";
  if (node.tag === 0x17) {
    const m = /^(\d{10}|\d{12})(Z|[+-]\d{4})$/.exec(raw);
    if (!m) throw new Error(`${what} 的 UTCTime 非法：${JSON.stringify(raw)}（RFC 5280 §4.1.2.5.1 要求 YYMMDDHHMMSSZ）`);
    off = m[2];
    const d = m[1];
    const yy = Number(d.slice(0, 2));
    const year = yy >= 50 ? 1900 + yy : 2000 + yy;
    ms = Date.UTC(year, +d.slice(2, 4) - 1, +d.slice(4, 6), +d.slice(6, 8), +d.slice(8, 10), d.length >= 12 ? +d.slice(10, 12) : 0);
  } else if (node.tag === 0x18) {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\.\d+)?(Z|[+-]\d{4})$/.exec(raw);
    if (!m) throw new Error(`${what} 的 GeneralizedTime 非法：${JSON.stringify(raw)}（RFC 5280 §4.1.2.5.2）`);
    off = m[8];
    ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    if (m[7]) ms += Math.round(parseFloat(m[7]) * 1000);
  } else {
    throw new Error(`${what} 不是 UTCTime(0x17)/GeneralizedTime(0x18)：tag 0x${node.tag.toString(16)}`);
  }
  if (off !== "Z") {
    const om = ((+off.slice(1, 3)) * 60 + (+off.slice(3, 5))) * 60000;
    ms += off[0] === "+" ? -om : om;
  }
  return { ms, raw, kind: node.tag === 0x17 ? "UTCTime" : "GeneralizedTime" };
}

function fmtUtc(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace("T", " ") + " UTC";
}

// ---- DN（X.501 Name = RDNSequence）----

const DN_STRING_TAG = {
  0x0c: "UTF8String", 0x12: "NumericString", 0x13: "PrintableString",
  0x14: "T61String", 0x16: "IA5String", 0x1a: "VisibleString",
  0x1c: "UniversalString", 0x1e: "BMPString",
};

/** DN 属性值按 tag 解码字符串；失败返回 null（调用方降级 hex） */
function decodeDnValue(node) {
  try {
    if (node.tag === 0x1e) return new TextDecoder("utf-16be").decode(node.value);
    if (node.tag === 0x1c) { // UniversalString = UCS-4 大端
      let s = "";
      const v = node.value;
      for (let i = 0; i + 3 < v.length; i += 4) {
        s += String.fromCodePoint(((v[i] << 24) | (v[i + 1] << 16) | (v[i + 2] << 8) | v[i + 3]) >>> 0);
      }
      return s;
    }
    if (node.tag === 0x14) return new TextDecoder("latin1").decode(node.value); // T61String 近似 latin1
    if (node.tag in DN_STRING_TAG) return TD_UTF8.decode(node.value);
  } catch { /* 降级 hex */ }
  return null;
}

/** X.501 Name 节点 → [[{oid,value,decoded,tag}...]]（RDN 列表，每个 RDN 是 ATV 列表） */
function parseName(node, what) {
  if (node.tag !== 0x30 || !node.children) throw new Error(`${what} DN 结构非法（X.501 RDNSequence 应为 SEQUENCE OF SET）`);
  return node.children.map((rdn, ri) => {
    if (rdn.tag !== 0x31 || !rdn.children) throw new Error(`${what} 的第 ${ri + 1} 个 RDN 不是 SET（X.501）`);
    return rdn.children.map((atv) => {
      if (atv.tag !== 0x30 || !atv.children || atv.children.length < 2 || atv.children[0].tag !== 0x06) {
        throw new Error(`${what} 的第 ${ri + 1} 个 RDN 内 AttributeTypeAndValue 结构非法（X.501：SEQUENCE{OID,value}）`);
      }
      const oid = oidString(atv.children[0].value);
      const vNode = atv.children[1];
      return {
        oid,
        value: decodeDnValue(vNode),
        tag: vNode.tag,
        hex: bytesToHex(vNode.value),
      };
    });
  });
}

/** RFC 4514 §2.2 字符串转义 */
function esc4514(s) {
  let t = String(s).replace(/([\\",+=<>;\u0000])/g, "\\$1");
  t = t.replace(/^([ #])/, "\\$1").replace(/([ ])$/, "\\$1");
  return t;
}

/** DN → RFC 4514 逆序字符串（对拍 openssl -nameopt RFC2253） */
function dnToRfc4514(name) {
  return name
    .map((rdn) => rdn
      .map((atv) => `${OID_NAME[atv.oid] ? OID_NAME[atv.oid][0] : "OID." + atv.oid}=${atv.value == null ? esc4514(atv.hex) : esc4514(atv.value)}`)
      .join("+"))
    .reverse()
    .join(",");
}

function dnBlockLines(name, title) {
  const lines = [`[${title}]（X.501，按编码顺序 = openssl -text 显示顺序）`];
  for (const rdn of name) {
    const parts = rdn.map((atv) => {
      const short = OID_NAME[atv.oid] ? OID_NAME[atv.oid][0] : "?";
      const full = OID_NAME[atv.oid] ? OID_NAME[atv.oid][1] : atv.oid + "（未知 OID，原值）";
      const val = atv.value != null ? atv.value : `hex:${atv.hex}（${DN_STRING_TAG[atv.tag] || "tag 0x" + atv.tag.toString(16)} 无法按已知字符串类型解码）`;
      return `  ${short.padEnd(3)} ${full.padEnd(26)} = ${val}`;
    });
    lines.push(parts.join("  +  ")); // 多值 RDN（X.501 multi-valued）用 + 连接
  }
  lines.push(`  RFC 4514 : ${dnToRfc4514(name)}`);
  return lines;
}

// ---- 扩展（RFC 5280 §4.2）----

const KEY_USAGE_BITS = [
  "digitalSignature",                     // bit 0
  "nonRepudiation/contentCommitment",     // bit 1（RFC 5280 §4.2.1.3）
  "keyEncipherment",                      // bit 2
  "dataEncipherment",                     // bit 3
  "keyAgreement",                         // bit 4
  "keyCertSign",                          // bit 5
  "cRLSign",                              // bit 6
  "encipherOnly",                         // bit 7（仅 keyAgreement 时有意义）
  "decipherOnly",                         // bit 8（仅 keyAgreement 时有意义）
];

function formatIp(b) {
  if (b.length === 4) return b.join(".");
  if (b.length === 16) {
    const g = [];
    for (let i = 0; i < 16; i += 2) g.push(((b[i] << 8) | b[i + 1]).toString(16));
    return g.join(":"); // 未做零压缩，完整 8 组
  }
  return hexColon(b) + "（长度非 4/16 字节，非标准 IP）";
}

/** 逐扩展明细（已知类型深入解析，未知 hex 摘要） */
function extDetailLines(oid, valueDer) {
  const lines = [];
  const soft = (fn) => { try { fn(); } catch (e) { lines.push(`      解析失败：${e.message}（原样 hex：${bytesToHex(valueDer.subarray(0, 48))}…）`); } };
  if (oid === "2.5.29.17" || oid === "2.5.29.18") {
    const nm = oid === "2.5.29.17" ? "subjectAltName" : "issuerAltName";
    soft(() => {
      const seq = derDecode(valueDer);
      for (const g of seq.children || []) {
        if (g.tag === 0x81) lines.push(`      email : ${TD_UTF8.decode(g.value)}`);
        else if (g.tag === 0x82) lines.push(`      DNS   : ${TD_UTF8.decode(g.value)}`);
        else if (g.tag === 0x86) lines.push(`      URI   : ${TD_UTF8.decode(g.value)}`);
        else if (g.tag === 0x87) lines.push(`      IP    : ${formatIp(g.value)}`);
        else if (g.tag === 0xa4) lines.push(`      dirName: ${dnToRfc4514(parseName(g.children[0], "SAN dirName"))}`);
        else if (g.tag === 0x88) lines.push(`      registeredID : ${oidString(g.value)}`);
        else lines.push(`      其他 GeneralName（tag 0x${g.tag.toString(16)}，RFC 5280 §4.2.1.6/§4.2.1.7）`);
      }
    });
    return { name: nm, lines };
  }
  if (oid === "2.5.29.19") {
    soft(() => {
      const seq = derDecode(valueDer);
      let ca = false, pathLen = null;
      for (const c of seq.children || []) {
        if (c.tag === 0x01) ca = c.value[0] !== 0;
        if (c.tag === 0x02) pathLen = derBytesToBigint(c.value).toString();
      }
      lines.push(`      CA = ${ca ? "TRUE" : "FALSE"}${pathLen != null ? `，pathLenConstraint = ${pathLen}` : "（未设 pathLenConstraint）"}`);
    });
    return { name: "basicConstraints", lines };
  }
  if (oid === "2.5.29.15") {
    soft(() => {
      const bs = derDecode(valueDer);
      if (bs.tag !== 0x03) throw new Error("keyUsage 应为 BIT STRING");
      const unused = bs.value[0];
      const v = bs.value.subarray(1);
      const totalBits = v.length * 8 - unused;
      const bits = [];
      for (let i = 0; i < KEY_USAGE_BITS.length && i < totalBits; i++) {
        if ((v[i >> 3] >> (7 - (i & 7))) & 1) bits.push(KEY_USAGE_BITS[i]);
      }
      lines.push(`      用途位：${bits.length ? bits.join(", ") : "（空）"}`);
    });
    return { name: "keyUsage", lines };
  }
  if (oid === "2.5.29.14") {
    soft(() => {
      const n = derDecode(valueDer);
      lines.push(`      SKID = ${hexColon(n.value)}`);
    });
    return { name: "subjectKeyIdentifier", lines };
  }
  if (oid === "2.5.29.35") {
    soft(() => {
      const seq = derDecode(valueDer);
      for (const c of seq.children || []) {
        if (c.tag === 0x80) lines.push(`      keyIdentifier       = ${hexColon(c.value)}`);
        else if (c.tag === 0xa1) lines.push(`      authorityCertIssuer = ${c.children ? c.children.length + " 个 GeneralName" : "?"}`);
        else if (c.tag === 0x82) lines.push(`      authorityCertSerial = ${derBytesToBigint(c.value).toString()}`);
      }
    });
    return { name: "authorityKeyIdentifier", lines };
  }
  if (oid === "2.5.29.37") {
    soft(() => {
      const seq = derDecode(valueDer);
      for (const c of seq.children || []) {
        if (c.tag === 0x06) lines.push(`      ${oidLabel(oidString(c.value))}`);
      }
    });
    return { name: "extKeyUsage", lines };
  }
  if (oid === "1.3.6.1.5.5.7.1.1") {
    soft(() => {
      const seq = derDecode(valueDer);
      for (const ad of seq.children || []) {
        if (ad.tag === 0x30 && ad.children && ad.children[0].tag === 0x06 && ad.children[1] && ad.children[1].tag === 0x86) {
          lines.push(`      ${oidShort(oidString(ad.children[0].value)).padEnd(11)} : ${TD_UTF8.decode(ad.children[1].value)}`);
        }
      }
    });
    return { name: "authorityInfoAccess", lines };
  }
  return { name: null, lines }; // 无明细的扩展只进总表
}

// ---- 主体公钥（RFC 5280 §4.1.2.7 SPKI）----

function spkiLines(spkiNode) {
  const lines = [];
  if (spkiNode.tag !== 0x30 || !spkiNode.children || spkiNode.children.length !== 2) {
    throw new Error("subjectPublicKeyInfo 结构非法（RFC 5280 §4.1.2.7：SEQUENCE{AlgorithmIdentifier,BIT STRING}）");
  }
  const alg = spkiNode.children[0];
  const bit = spkiNode.children[1];
  if (alg.tag !== 0x30 || !alg.children || !alg.children[0] || alg.children[0].tag !== 0x06 || bit.tag !== 0x03) {
    throw new Error("subjectPublicKeyInfo 的算法/密钥结构非法");
  }
  const algOid = oidString(alg.children[0].value);
  const params = alg.children[1] || null;
  const unused = bit.value[0];
  const keyBytes = bit.value.subarray(1);
  if (unused !== 0) lines.push(`  警告：BIT STRING unused bits = ${unused}（公钥应恒为 0，RFC 5280）`);
  lines.push(`算法 : ${oidLabel(algOid)}`);

  if (algOid === "1.2.840.113549.1.1.1") { // rsaEncryption（RFC 8017）
    const inner = derDecode(keyBytes);
    if (inner.tag !== 0x30 || !inner.children || inner.children.length !== 2 || inner.children[0].tag !== 0x02 || inner.children[1].tag !== 0x02) {
      throw new Error("RSA 公钥 RSAPublicKey 结构非法（RFC 8017 §A.1.1：SEQUENCE{INTEGER n,INTEGER e}）");
    }
    const n = derBytesToBigint(inner.children[0].value);
    const e = derBytesToBigint(inner.children[1].value);
    lines.push(`n 位长 : ${n.toString(2).length} bit`);
    lines.push(`e      : ${e}（0x${e.toString(16).toUpperCase()}）`);
    lines.push(`n(hex) : ${bigintToHexUpper(n)}`);
    lines.push(`  对拍：openssl x509 -noout -modulus`);
    return lines;
  }
  if (algOid === "1.2.840.10045.2.1") { // id-ecPublicKey（RFC 5480）
    if (!params || params.tag !== 0x06) throw new Error("EC 公钥缺 namedCurve 参数（RFC 5480 §2.1.1）");
    const curveOid = oidString(params.value);
    lines.push(`曲线   : ${oidLabel(curveOid)}`);
    const bl = CURVE_FIELD_BYTES[curveOid];
    if (keyBytes[0] === 0x04 && bl && keyBytes.length === 1 + 2 * bl) {
      lines.push(`公钥点 : 非压缩（SEC 1 v2 §2.3.3，0x04 ‖ X ‖ Y，${keyBytes.length} 字节）`);
      lines.push(`X      : ${bytesToHex(keyBytes.subarray(1, 1 + bl)).toUpperCase()}`);
      lines.push(`Y      : ${bytesToHex(keyBytes.subarray(1 + bl)).toUpperCase()}`);
    } else if (keyBytes[0] === 0x02 || keyBytes[0] === 0x03) {
      lines.push(`公钥点 : 压缩（SEC 1 v2 §2.3.1，0x0${keyBytes[0]} ‖ X，${keyBytes.length} 字节）`);
      lines.push(`X      : ${bytesToHex(keyBytes.subarray(1)).toUpperCase()}`);
    } else {
      lines.push(`公钥点 : 首字节 0x${keyBytes[0].toString(16)} 非 02/03/04，无法识别（SEC 1）`);
    }
    return lines;
  }
  if (algOid === "1.3.101.112" || algOid === "1.3.101.113") { // Ed25519/Ed448（RFC 8410）
    lines.push(`公钥   : ${keyBytes.length} 字节原始点 ${bytesToHex(keyBytes).toUpperCase()}`);
    return lines;
  }
  if (algOid === "1.2.840.10040.4.1") { // id-DSA（RFC 3279 §2.3.2）
    lines.push(`公钥 y : ${keyBytes.length} 字节 INTEGER ${hexColon(keyBytes)}`);
    if (params && params.tag === 0x30 && params.children) {
      lines.push(`参数   : p ${derBytesToBigint(params.children[0].value).toString(2).length} bit / q ${derBytesToBigint(params.children[1].value).toString(2).length} bit / g`);
    }
    return lines;
  }
  lines.push(`公钥   : 未识别算法，BIT STRING 内容 ${keyBytes.length} 字节 ${hexColon(keyBytes)}`);
  return lines;
}

/** 输入（PEM CERTIFICATE 或 DER hex）→ DER 字节 */
function loadCertDer(text) {
  const src = String(text || "").trim();
  if (!src) throw new Error("输入为空：需要 X.509 证书（PEM -----BEGIN CERTIFICATE----- 或 DER 十六进制）");
  if (src.includes("-----BEGIN")) {
    const { label, der } = parsePem(src);
    if (label !== "CERTIFICATE") {
      throw new Error(`PEM 标签是 ${label}，不是 CERTIFICATE（X.509 证书，RFC 7468）——公钥/私钥解析请用 PEM 密钥解析类工具`);
    }
    return { der, srcKind: `PEM（CERTIFICATE，RFC 7468）` };
  }
  const h = src.replace(/[\s:]/g, "");
  if (/^[0-9a-fA-F]+$/.test(h)) {
    if (h.length % 2 !== 0) throw new Error("DER hex 长度为奇数——半个字节无法还原");
    if (h.length < 8) throw new Error("输入过短，不可能是 X.509 证书");
    return { der: hexToBytes(h), srcKind: "DER 十六进制" };
  }
  throw new Error("无法识别输入：需 PEM（-----BEGIN CERTIFICATE----- …）或 DER 十六进制（其他封装暂不支持）");
}

/** RSASSA-PSS 参数（RFC 8017 §A.2.3，[0]hash [1]mgf [2]saltLen [3]trailer） */
function pssParamLines(paramsNode) {
  const lines = [];
  try {
    const seq = paramsNode && paramsNode.tag === 0x30 ? paramsNode : null;
    if (!seq) return lines;
    for (const c of seq.children || []) {
      if (c.tag === 0xa0 && c.children && c.children[0] && c.children[0].tag === 0x30 && c.children[0].children) {
        lines.push(`      hashAlgorithm = ${oidLabel(oidString(c.children[0].children[0].value))}`);
      }
      if (c.tag === 0x82) lines.push(`      saltLength    = ${derBytesToBigint(c.value).toString()}`);
      if (c.tag === 0xa1) lines.push(`      maskGeneration = MGF1（含其内 hashAlgorithm OID）`);
    }
  } catch { /* 参数异常不致命 */ }
  return lines;
}

function x509ParseRun(text, p = {}) {
  const { der, srcKind } = loadCertDer(text);
  let root;
  try {
    root = derDecode(der);
  } catch (e) {
    throw new Error(`DER 解析失败（数据被截断或非 DER）:${e.message}`);
  }
  if (root.tag !== 0x30 || !root.children || root.children.length !== 3) {
    throw new Error("顶层结构不是 Certificate：需 SEQUENCE{ tbsCertificate, signatureAlgorithm, signatureValue }（RFC 5280 §4.1）");
  }
  const [tbs, sigAlgOuter, sigValueNode] = root.children;
  if (tbs.tag !== 0x30 || !tbs.children || tbs.children.length < 6 ||
    sigAlgOuter.tag !== 0x30 || sigValueNode.tag !== 0x03) {
    throw new Error("Certificate 三段结构非法（tbs/sigAlg/BIT STRING，RFC 5280 §4.1）");
  }

  // ---- TBS 字段（§4.1.2.x），[0] EXPLICIT version 缺省 = v1 ----
  let idx = 0;
  let version = 1;
  if (tbs.children[0].tag === 0xa0) {
    const vInt = tbs.children[0].children && tbs.children[0].children[0];
    if (!vInt || vInt.tag !== 0x02) throw new Error("[0] EXPLICIT version 内不是 INTEGER（RFC 5280 §4.1.2.1）");
    version = Number(derBytesToBigint(vInt.value)) + 1;
    idx = 1;
  }
  const serialNode = tbs.children[idx];
  if (serialNode.tag !== 0x02) throw new Error("序列号字段不是 INTEGER（RFC 5280 §4.1.2.2）");
  const serial = serialNode.value.length ? derBytesToBigint(serialNode.value) : 0n;
  const sigAlgTbs = tbs.children[idx + 1];
  if (sigAlgTbs.tag !== 0x30 || !sigAlgTbs.children || !sigAlgTbs.children[0] || sigAlgTbs.children[0].tag !== 0x06) {
    throw new Error("TBS signatureAlgorithm 结构非法（RFC 5280 §4.1.2.3）");
  }
  const issuer = parseName(tbs.children[idx + 2], "issuer");
  const valNode = tbs.children[idx + 3];
  if (valNode.tag !== 0x30 || !valNode.children || valNode.children.length !== 2) {
    throw new Error("validity 结构非法（RFC 5280 §4.1.2.5：SEQUENCE{notBefore,notAfter}）");
  }
  const notBefore = parseTimeNode(valNode.children[0], "notBefore");
  const notAfter = parseTimeNode(valNode.children[1], "notAfter");
  const subject = parseName(tbs.children[idx + 4], "subject");
  const spkiNode = tbs.children[idx + 5];

  // ---- 尾部可选字段：[1]/[2] IMPLICIT UniqueID（0x81/0x82），[3] EXPLICIT extensions（0xa3） ----
  const tail = tbs.children.slice(idx + 6);
  const extSeqNode = tail.find((n) => n.tag === 0xa3);
  const hasUidNote = tail.some((n) => n.tag === 0x81 || n.tag === 0x82);
  let exts = [];
  if (extSeqNode) {
    const seq = extSeqNode.children && extSeqNode.children[0];
    if (!seq || seq.tag !== 0x30 || !seq.children) throw new Error("extensions [3] 结构非法（RFC 5280 §4.1.2.9）");
    exts = seq.children.map((e, i) => {
      if (e.tag !== 0x30 || !e.children || e.children.length < 2 || e.children[0].tag !== 0x06) {
        throw new Error(`第 ${i + 1} 个 Extension 结构非法（RFC 5280 §4.1：SEQUENCE{OID,critical?,OCTET STRING}）`);
      }
      let j = 1, critical = false;
      if (e.children[j] && e.children[j].tag === 0x01) { critical = e.children[j].value[0] !== 0; j++; }
      if (!e.children[j] || e.children[j].tag !== 0x04) throw new Error(`第 ${i + 1} 个 Extension 缺 extnValue OCTET STRING`);
      return { oid: oidString(e.children[0].value), critical, valueDer: e.children[j].value };
    });
  }

  // ---- 输出组装 ----
  const out = [];
  out.push("X.509 证书解析（ITU-T X.509 / RFC 5280 §4.1）");
  out.push(`输入 : ${srcKind} · DER ${der.length} 字节`);

  out.push("");
  out.push("[基本信息]");
  out.push(`版本       : v${version}（DER 值 ${version - 1}${version === 1 ? "，[0] EXPLICIT 缺省" : "，[0] EXPLICIT"}，RFC 5280 §4.1.2.1）`);
  out.push(`序列号     : ${hexColon(serialNode.value)}（原始 ${serialNode.value.length} 字节）`);
  out.push(`             十进制 ${serial}${serial < 0n ? "（负数：RFC 5280 §4.1.2.2 要求正整数，非常规证书）" : ""}`);
  const sigOidOuter = oidString(sigAlgOuter.children[0].value);
  const sigOidTbs = oidString(sigAlgTbs.children[0].value);
  out.push(`签名算法   : ${oidShort(sigOidOuter)}（OID ${sigOidOuter}）`);
  out.push(`  外层 AlgorithmIdentifier 与 tbs 内 : ${sigOidOuter === sigOidTbs ? "一致（RFC 5280 §4.1.2.3 要求两处一致）" : "不一致（违规格，谨慎对待）"}`);
  if (sigOidOuter === "1.2.840.113549.1.1.10") {
    out.push("  RSASSA-PSS 参数（RFC 8017 §A.2.3，缺省 hash=SHA-1/salt=20）：");
    const pl = pssParamLines(sigAlgOuter.children[1]);
    out.push(...(pl.length ? pl : ["      （params NULL/缺省）"]));
  }
  if (hasUidNote) out.push("  含 issuerUniqueID/subjectUniqueID（v2/v3 老字段，RFC 5280 §4.1.2.8，罕见）");

  out.push("");
  out.push("[有效期]（RFC 5280 §4.1.2.5）");
  out.push(`notBefore : ${fmtUtc(notBefore.ms)}（${notBefore.kind} ${notBefore.raw}）`);
  out.push(`notAfter  : ${fmtUtc(notAfter.ms)}（${notAfter.kind} ${notAfter.raw}）`);
  const atRaw = String(p?.at ?? "").trim();
  let nowMs;
  if (atRaw) {
    nowMs = Date.parse(atRaw);
    if (Number.isNaN(nowMs)) throw new Error(`判定基准时间参数非法：${atRaw}（需 ISO 格式如 2026-01-01T00:00:00Z）`);
  } else {
    nowMs = Date.now();
  }
  const state = nowMs < notBefore.ms ? "尚未生效" : nowMs > notAfter.ms ? "已过期" : "有效";
  const days = Math.floor((notAfter.ms - nowMs) / 86400000);
  out.push(`判定       : ${state}（基准 ${fmtUtc(nowMs)}${atRaw ? "（参数指定）" : "（当前时间，可用参数覆盖）"}${nowMs <= notAfter.ms && nowMs >= notBefore.ms ? `，距到期 ${days} 天` : ""}）`);

  out.push("");
  out.push(...dnBlockLines(issuer, "签发者 Issuer DN"));
  out.push("");
  out.push(...dnBlockLines(subject, "主体 Subject DN"));

  out.push("");
  out.push("[主体公钥 SubjectPublicKeyInfo]");
  out.push(...spkiLines(spkiNode));

  out.push("");
  out.push(`[扩展 Extensions]（RFC 5280 §4.2，共 ${exts.length} 项${version === 1 ? "；v1 证书按标准不应有扩展" : ""}）`);
  if (!exts.length) {
    out.push("  无扩展字段");
  } else {
    exts.forEach((e, i) => {
      out.push(`  ${i + 1}. ${oidLabel(e.oid)}${e.critical ? " ·critical（RFC 5280 §4.2：关键扩展，无法识别时应拒绝该证书）" : ""}`);
      const d = extDetailLines(e.oid, e.valueDer);
      out.push(...d.lines);
    });
    out.push("  扩展 OID 总表（按出现顺序）：");
    exts.forEach((e, i) => {
      out.push(`    ${String(i + 1).padStart(2)}  ${e.oid.padEnd(24)} ${oidShort(e.oid).padEnd(26)} critical=${e.critical ? "是" : "否"}`);
    });
  }

  out.push("");
  out.push("[签名值 signatureValue]（BIT STRING）");
  const sigBytes = sigValueNode.value.subarray(1);
  if (sigValueNode.value[0] !== 0) out.push(`  警告：unused bits = ${sigValueNode.value[0]}（签名应恒 0）`);
  out.push(`  ${sigBytes.length} 字节：`);
  out.push(...wrap64(hexColon(sigBytes).replace(/:/g, "")));
  // T364 产物协议：证书 DER 出 certificate.der（.cer 内容型，RFC 7468 换壳即 .pem）
  const files = [{ name: "certificate.der", mime: "application/pkix-cert", bytes: der }];
  out.push("", `产物：1 个文件可下载（${files[0].name}，与输入 DER 逐字节一致）`);
  return { text: out.join("\n"), files };
}

// ============================================================
// SSH 公钥解析（RFC 4251 §5 wire 格式）
// ============================================================

/** 读 uint32（RFC 4251 §5） */
function sshReadUint32(buf, off) {
  if (off + 4 > buf.length) throw new Error("SSH blob 数据被截断（RFC 4251 §5 uint32 不足 4 字节）");
  return [((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0, off + 4];
}

/** 读 string（uint32 长度前缀，RFC 4251 §5） */
function sshReadString(buf, off, what = "string") {
  const [len, o1] = sshReadUint32(buf, off);
  if (len > 0x1000000) throw new Error(`SSH ${what} 长度字段非法（${len} 字节，RFC 4251 §5）`);
  if (o1 + len > buf.length) throw new Error(`SSH ${what} 数据被截断（声明 ${len} 字节，剩余 ${buf.length - o1}）`);
  return [buf.subarray(o1, o1 + len), o1 + len];
}

/** 读 mpint → BigInt + 位长（RFC 4251 §5：大端二补码；正数最高位为 1 时前置 0x00 符号字节） */
function sshReadMpint(buf, off, what) {
  const [b, o] = sshReadString(buf, off, `mpint(${what})`);
  let hex = bytesToHex(b);
  if (hex.length >= 2 && hex.startsWith("00")) hex = hex.slice(2); // 符号字节不计位长
  hex = hex.replace(/^0+/, "") || "0";
  const v = BigInt("0x" + hex);
  return [v, v === 0n ? 0 : v.toString(2).length, o];
}

const SSH_ECDSA_BITS = { nistp256: 256, nistp384: 384, nistp521: 521 };

/** 已解码 blob → 结构化公钥信息 */
function parseSshBlob(blob) {
  const [algoB, o0] = sshReadString(blob, 0, "算法名");
  const algo = TD_UTF8.decode(algoB);
  const info = { algo, extra: null };

  const done = (off) => {
    if (off !== blob.length) info.extra = `尾部多余 ${blob.length - off} 字节（RFC 4253 §6.6 声明外数据）`;
  };

  if (algo === "ssh-rsa") { // RFC 4253 §6.6：string "ssh-rsa", mpint e, mpint n
    const [e, , o1] = sshReadMpint(blob, o0, "e");
    const [n, nBits, o2] = sshReadMpint(blob, o1, "n");
    Object.assign(info, { kind: "RSA", bits: nBits, e, n, nHex: n.toString(16).toUpperCase() });
    done(o2);
    return info;
  }
  if (algo === "ssh-ed25519") { // RFC 8709 §4：string "ssh-ed25519", string pk(32 字节)
    const [pk, o1] = sshReadString(blob, o0, "ed25519 公钥");
    if (pk.length !== 32) throw new Error(`ssh-ed25519 公钥长度应为 32 字节（RFC 8709 §4），实际 ${pk.length}`);
    Object.assign(info, { kind: "Ed25519", bits: 256, keyHex: bytesToHex(pk).toUpperCase() });
    done(o1);
    return info;
  }
  if (/^ecdsa-sha2-nistp(256|384|521)$/.test(algo)) { // RFC 5656 §3.1：string 曲线名 + string Q 点
    const [curveB, o1] = sshReadString(blob, o0, "曲线名");
    const curve = TD_UTF8.decode(curveB);
    if (curve !== algo.slice("ecdsa-sha2-".length)) throw new Error(`ecdsa 算法名(${algo})与曲线字段(${curve})不一致（RFC 5656 §3.1）`);
    const [q, o2] = sshReadString(blob, o1, "ECDSA 公钥点");
    const coordLen = (SSH_ECDSA_BITS[curve] + 7) >> 3;
    const pt = { curve, bits: SSH_ECDSA_BITS[curve], pointLen: q.length, pointHex: bytesToHex(q).toUpperCase() };
    if (q[0] === 0x04 && q.length === 1 + 2 * coordLen) {
      pt.x = bytesToHex(q.subarray(1, 1 + coordLen)).toUpperCase();
      pt.y = bytesToHex(q.subarray(1 + coordLen)).toUpperCase();
      pt.form = `非压缩 0x04 ‖ X ‖ Y（SEC 1 §2.3.3，${q.length} 字节）`;
    } else if (q[0] === 0x02 || q[0] === 0x03) {
      pt.x = bytesToHex(q.subarray(1)).toUpperCase();
      pt.form = `压缩 0x0${q[0]} ‖ X（SEC 1 §2.3.1）`;
    } else {
      pt.form = `首字节 0x${q[0].toString(16)} 非 02/03/04，非常规点编码`;
    }
    Object.assign(info, { kind: "ECDSA", ...pt });
    done(o2);
    return info;
  }
  if (algo === "sk-ssh-ed25519@openssh.com" || algo === "sk-ecdsa-sha2-nistp256@openssh.com") {
    // OpenSSH FIDO 硬件钥（PROTOCOL.u2f）：算法名 string 后跟常规密钥字段 + string application
    if (algo.startsWith("sk-ecdsa")) {
      const [curveB, o1] = sshReadString(blob, o0, "曲线名");
      const [q, o2] = sshReadString(blob, o1, "ECDSA 公钥点");
      const [app, o3] = sshReadString(blob, o2, "application");
      Object.assign(info, { kind: "ECDSA-SK", curve: TD_UTF8.decode(curveB), bits: 256, pointHex: bytesToHex(q).toUpperCase(), application: TD_UTF8.decode(app) });
      done(o3);
      return info;
    }
    const [pk, o1] = sshReadString(blob, o0, "ed25519 公钥");
    const [app, o2] = sshReadString(blob, o1, "application");
    Object.assign(info, { kind: "Ed25519-SK", bits: 256, keyHex: bytesToHex(pk).toUpperCase(), application: TD_UTF8.decode(app) });
    done(o2);
    return info;
  }
  if (algo === "ssh-dss") { // RFC 4253 §6.6：mpint p,q,g,y
    const [pp, , o1] = sshReadMpint(blob, o0, "p");
    const [q, , o2] = sshReadMpint(blob, o1, "q");
    const [g, , o3] = sshReadMpint(blob, o2, "g");
    const [y, , o4] = sshReadMpint(blob, o3, "y");
    Object.assign(info, { kind: "DSA", bits: pp.toString(2).length, p: pp, q, g, y });
    done(o4);
    return info;
  }
  if (/-cert-v0[12]@openssh\.com$/.test(algo)) {
    throw new Error(`不支持的 SSH 公钥类型：${algo}（SSH 证书格式，含 CA 签名结构，不在本工具解析范围）`);
  }
  throw new Error(`不支持的 SSH 公钥类型：${algo}（支持 ssh-rsa / ssh-ed25519 / ecdsa-sha2-nistp256|384|521 / ssh-dss 及 sk-* 变体）`);
}

/** 输入行 → { blob, algoToken, comment, form, marker }（兼容 authorized_keys / known_hosts / RFC 4716 / 裸 blob） */
function parseSshInput(text) {
  const src = String(text || "").trim();
  if (!src) throw new Error("输入为空：需要 authorized_keys/known_hosts 行、RFC 4716 公钥块或裸 base64 blob");

  // RFC 4716 SSH2 公钥文件（ssh-keygen -e 输出）：头部行 "Key: value"，续行以 \ 结尾
  if (/----\s*BEGIN SSH2 PUBLIC KEY\s*----/.test(src)) {
    const bodyLines = [];
    let comment = null;
    for (let line of src.split(/\r?\n/)) {
      line = line.trim();
      if (/----/.test(line) || !line) continue;
      if (/^[A-Za-z0-9-]+:/.test(line)) {
        const m = /^Comment:\s*(.*)$/.exec(line);
        if (m) comment = m[1];
        continue; // 头部标签行
      }
      bodyLines.push(line.replace(/\\$/, ""));
    }
    const blob = base64Decode(bodyLines.join(""));
    return { blob, algoToken: null, comment, form: "RFC 4716 SSH2 公钥块", marker: null };
  }

  const lines = src.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (!lines.length) throw new Error("输入无有效内容（全是空行或注释）");
  const tokens = lines[0].split(/\s+/);
  const isAlgoToken = (t) => /^(ssh-|ecdsa-|sk-)/.test(t);
  let marker = null;
  if (tokens[0].startsWith("@")) marker = tokens[0]; // known_hosts 标记 @cert-authority/@revoked

  // 途径一：行内含明文算法名 token（authorized_keys/known_hosts 标准形态）
  for (let i = 0; i < tokens.length - 1; i++) {
    if (isAlgoToken(tokens[i])) {
      let blob;
      try {
        blob = base64Decode(tokens[i + 1]);
      } catch (e) {
        throw new Error(`算法名 ${tokens[i]} 后的 base64 解码失败：${e.message}`);
      }
      return { blob, algoToken: tokens[i], comment: tokens.slice(i + 2).join(" "), form: marker ? `known_hosts 行（标记 ${marker}）` : "authorized_keys/known_hosts 行", marker };
    }
  }

  // 途径二：裸 base64 blob（或带前缀字段的行）——逐 token 试解码，看内部算法名
  // 第一优先：算法名前缀（ssh-/ecdsa-/sk-）命中；第二候选：能读出 string 算法字段的 token
  //（候选即使算法未知也交给 parseSshBlob 报「不支持的类型」，而不是静默漏过）
  let fallback = null;
  for (const t of tokens) {
    try {
      const blob = base64Decode(t);
      if (blob.length < 8) continue;
      const [a] = sshReadString(blob, 0, "算法名");
      const algo = TD_UTF8.decode(a);
      if (/^(ssh-|ecdsa-|sk-)/.test(algo)) {
        return { blob, algoToken: null, comment: "", form: "裸 base64 blob", marker: null };
      }
      if (!fallback) fallback = { blob };
    } catch { /* 非 blob token，跳过 */ }
  }
  if (fallback) {
    const info = parseSshBlob(fallback.blob); // 未知算法在此抛「不支持的类型」
    return { blob: fallback.blob, algoToken: null, comment: "", form: "裸 base64 blob", marker: null, info };
  }
  throw new Error("输入中找不到 SSH 公钥：需包含算法名 + base64 blob（如 ssh-ed25519 AAAA... comment），或裸 base64 blob，或 RFC 4716 块");
}

async function sha256Bytes(data) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data)); // 浏览器/Node 18+ 均有
}

function md5Colon(b) {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(":"); // ssh-keygen -E md5 小写冒号风格
}

async function sshHostKeyParseRun(text) {
  const parsed = parseSshInput(text);
  const info = parsed.info || parseSshBlob(parsed.blob);
  if (parsed.algoToken && parsed.algoToken !== info.algo) {
    throw new Error(`算法名 token（${parsed.algoToken}）与 blob 内算法字段（${info.algo}）不一致——数据被拼接或损坏（RFC 4253 §6.6）`);
  }
  const out = [];
  out.push("SSH 公钥解析（RFC 4251 §5 / RFC 4253 §6.6 / RFC 5656 / RFC 8709）");
  out.push(`输入形态 : ${parsed.form}`);
  if (parsed.comment) out.push(`注释     : ${parsed.comment}`);

  out.push("");
  out.push("[算法与参数]");
  out.push(`算法 : ${info.algo}`);
  if (info.kind === "RSA") {
    out.push(`类型 : RSA（RFC 4253 §6.6），${info.bits} 位`);
    out.push(`e    : ${info.e}（0x${info.e.toString(16).toUpperCase()}）`);
    out.push(`n 位长 : ${info.bits} bit`);
    out.push(`n    : ${info.nHex}`);
  } else if (info.kind === "Ed25519") {
    out.push(`类型 : Ed25519（RFC 8709 §4，Ed25519-SHA-512），256 位`);
    out.push(`公钥 A（32 字节）: ${info.keyHex}`);
  } else if (info.kind === "ECDSA") {
    out.push(`类型 : ECDSA（RFC 5656 §3.1），曲线 ${info.curve}，${info.bits} 位`);
    out.push(`公钥点 : ${info.form}`);
    if (info.x) out.push(`X : ${info.x}`);
    if (info.y) out.push(`Y : ${info.y}`);
  } else if (info.kind === "Ed25519-SK" || info.kind === "ECDSA-SK") {
    out.push(`类型 : OpenSSH FIDO 硬件安全钥（sk-*，PROTOCOL.u2f）`);
    if (info.keyHex) out.push(`公钥 : ${info.keyHex}`);
    if (info.pointHex) out.push(`ECDSA 点 : ${info.pointHex}`);
    out.push(`application : ${info.application}`);
  } else if (info.kind === "DSA") {
    out.push(`类型 : DSA（RFC 4253 §6.6，ssh-dss 已被 OpenSSH 默认禁用），p ${info.bits} 位`);
    out.push(`p : ${info.p.toString(16).toUpperCase()}`);
    out.push(`q : ${info.q.toString(16).toUpperCase()}`);
    out.push(`g : ${info.g.toString(16).toUpperCase()}`);
    out.push(`y : ${info.y.toString(16).toUpperCase()}`);
  }
  if (info.extra) out.push(`警告 : ${info.extra}`);

  const sha = await sha256Bytes(parsed.blob);
  const fpSha = "SHA256:" + bytesToBase64(sha).replace(/=+$/, ""); // 无 padding，RFC 4716/ssh-keygen 展示风格
  const fpMd5 = "MD5:" + md5Colon(md5Bytes(parsed.blob));

  out.push("");
  out.push("[指纹]（对拍 ssh-keygen -lf / ssh-keygen -E md5 -lf）");
  out.push(`SHA-256 : ${fpSha}`);
  out.push(`MD5     : ${fpMd5}`);

  out.push("");
  out.push("[规范行重建]");
  const pubLine = `${info.algo} ${bytesToBase64(parsed.blob)}${parsed.comment ? " " + parsed.comment : ""}`;
  out.push(pubLine);
  // T364 产物协议：公钥 blob 出 .pub 文件（OpenSSH 行格式 = 算法名 + base64 + 注释）
  const files = [{
    name: `${info.algo.replace(/[^A-Za-z0-9.-]/g, "_")}.pub`,
    mime: "text/plain", bytes: new TextEncoder().encode(pubLine + "\n"),
  }];
  out.push("", `产物：1 个文件可下载（${files[0].name}，即上方规范行，可直接入 authorized_keys）`);
  return { text: out.join("\n"), files };
}

// ============================================================
// op 注册（cat crypto，run 单向）
// ============================================================

register({
  id: "x509Parse",
  cat: "asym",
  name: "X.509 证书解析",
  desc: "解析 X.509 证书（RFC 5280 §4.1）：PEM（CERTIFICATE）或 DER hex 输入。输出版本/序列号/签名算法（OID+名称，含 RSASSA-PSS 参数）/签发者与主体 DN（X.501 逐 RDN，CN/O/C 等 100+ OID 友好名 + RFC 4514 串）/有效期（UTCTime/GeneralizedTime + 过期判定，时间基准可参数覆盖）/公钥参数（RSA n 位长+e、EC 曲线+点、Ed25519/DSA）/扩展明细（SAN DNS/IP/email/URI、BasicConstraints CA、KeyUsage 位、SKID/AKID、EKU、AIA + 全扩展 OID 总表）/签名值 hex。对拍 openssl x509 -text -noout。负例（非证书 PEM/截断 DER）中文报错",
  params: [
    { key: "at", label: "过期判定基准时间", type: "text", default: "", placeholder: "留空=当前时间；或 ISO 时间如 2026-01-01T00:00:00Z" },
  ],
  run: x509ParseRun,
});

register({
  id: "sshHostKeyParse",
  cat: "asym",
  name: "SSH 公钥解析（authorized_keys/known_hosts）",
  desc: "解析 SSH 公钥：authorized_keys 行（ssh-ed25519 AAAA... comment）、known_hosts 行（含 @revoked/@cert-authority 标记与主机列表前缀）、RFC 4716 SSH2 公钥块（ssh-keygen -e 输出）或裸 base64 blob。按 RFC 4251 §5 wire 格式解出算法与参数（ssh-rsa n 位长+e / ssh-ed25519 32 字节公钥 / ecdsa-sha2-nistp256|384|521 曲线+点 / ssh-dss / sk-* FIDO 变体），输出 SHA-256（SHA256:xxx 无 padding base64）与 MD5 两版指纹（与 ssh-keygen -lf / -E md5 -lf 逐字一致）+ 规范行重建。不支持的 key 类型（如 SSH 证书）中文报错",
  params: [],
  run: sshHostKeyParseRun,
});

// 供任务卡后续（SSH 证书、CRL、CSR 解析）与回归脚本复用
export { x509ParseRun, sshHostKeyParseRun, parseSshBlob, parseSshInput, loadCertDer };
