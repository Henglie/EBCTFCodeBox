/*
 * csrlparse.js — CSR（PKCS#10 证书请求）+ X.509 CRL（证书吊销列表）解析
 * 任务卡 T357（v0.1.6beta 批A5 补全）。单向 run 解析器（对标 CyberChef ParseCSR / ParseX509CRL）。
 *
 * 标准依据（注释随行标注）：
 *   - RFC 2986（PKCS#10 CertificationRequest：§4 ASN.1 结构）
 *   - RFC 2985（PKCS#9 属性；challengePassword = 1.2.840.113549.1.9.7 §5.4；
 *     注：0.9.2342.19200300.100.1.1 是 UID（userId），非 challengePassword）
 *   - RFC 5280 §5.1（CertificateList/TBSCertList）、§5.2（crlExtensions）、§5.3（CRL entry 扩展）
 *   - ITU-T X.501（Name = RDNSequence DN 结构）、X.690（DER）、RFC 7468（PEM）
 *   - RFC 8017 §9.2（RSASSA-PKCS1-v1_5 验签：EM = 0x00 0x01 FF.. 0x00 ‖ DigestInfo）
 *   - RFC 5480 / RFC 3279 §2.2.3（EC 曲线与 ecdsa-with-SHA* OID）
 *
 * 复用：rsagen.js 的 derDecode/derBytesToBigint/bytesToBase64、pemkeys.js 的
 *   parsePem/oidString、hash.js 的 md5Bytes（与 certparse.js 同款用法）。
 *   DN/OID 友好名小表本地实现（certparse.js 未导出内部函数，按任务卡勿改他人文件）。
 * CRL 性能：revokedCertificates 循环纯解析无哈希/大数运算，10 万条内可接受（desc 注明）。
 * 算法层零 UI 依赖，node 直跑。
 */
import { register } from "./registry.js";
import { derDecode, derBytesToBigint } from "./rsagen.js";
import { parsePem, oidString } from "./pemkeys.js";
import { md5Bytes } from "./hash.js";

// ============================================================
// 通用小工具（与 certparse.js 同思路，本文件独立实现）
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

/** hex 串按 64 字符折行（长签名可读性） */
function wrap64(s) {
  const out = [];
  for (let i = 0; i < s.length; i += 64) out.push(s.slice(i, i + 64));
  return out;
}

// ============================================================
// OID 友好名小表（DN 属性 X.520/RFC 4519、签名算法 RFC 8017/5480/3279、
// PKCS#9 属性 RFC 2985、CRL 扩展 RFC 5280 §5.2/§5.3）。[短名, 全名]
// ============================================================

const OID_NAME = {
  // ---- DN 属性 ----
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
  "2.5.4.42": ["GN", "givenName"],
  "2.5.4.43": ["initials", "initials"],
  "2.5.4.46": ["dnQualifier", "dnQualifier"],
  "2.5.4.65": ["pseudonym", "pseudonym"],
  "0.9.2342.19200300.100.1.1": ["UID", "userId"],
  "0.9.2342.19200300.100.1.25": ["DC", "domainComponent"],
  "1.2.840.113549.1.9.1": ["emailAddress", "emailAddress"],
  // ---- PKCS#9 CSR 属性（RFC 2985）----
  "1.2.840.113549.1.9.2": ["unstructuredName", "unstructuredName"],
  "1.2.840.113549.1.9.3": ["unstructuredAddress", "unstructuredAddress"],
  "1.2.840.113549.1.9.7": ["challengePassword", "challengePassword"],
  "1.2.840.113549.1.9.14": ["extensionRequest", "extensionRequest"],
  "1.2.840.113549.1.9.15": ["smimeCapabilities", "smimeCapabilities"],
  "1.3.6.1.4.1.311.13.2.3": ["OS Version", "OS Version（Microsoft）"],
  // ---- 签名/公钥算法 ----
  "1.2.840.113549.1.1.1": ["rsaEncryption", "rsaEncryption"],
  "1.2.840.113549.1.1.4": ["md5WithRSAEncryption", "md5WithRSAEncryption"],
  "1.2.840.113549.1.1.5": ["sha1WithRSAEncryption", "sha1WithRSAEncryption"],
  "1.2.840.113549.1.1.10": ["RSASSA-PSS", "RSASSA-PSS"],
  "1.2.840.113549.1.1.11": ["sha256WithRSAEncryption", "sha256WithRSAEncryption"],
  "1.2.840.113549.1.1.12": ["sha384WithRSAEncryption", "sha384WithRSAEncryption"],
  "1.2.840.113549.1.1.13": ["sha512WithRSAEncryption", "sha512WithRSAEncryption"],
  "1.2.840.113549.1.1.14": ["sha224WithRSAEncryption", "sha224WithRSAEncryption"],
  "1.2.840.10045.2.1": ["id-ecPublicKey", "ecPublicKey"],
  "1.2.840.10045.4.1": ["ecdsa-with-SHA1", "ecdsa-with-SHA1"],
  "1.2.840.10045.4.3.1": ["ecdsa-with-SHA224", "ecdsa-with-SHA224"],
  "1.2.840.10045.4.3.2": ["ecdsa-with-SHA256", "ecdsa-with-SHA256"],
  "1.2.840.10045.4.3.3": ["ecdsa-with-SHA384", "ecdsa-with-SHA384"],
  "1.2.840.10045.4.3.4": ["ecdsa-with-SHA512", "ecdsa-with-SHA512"],
  "1.3.101.112": ["Ed25519", "Ed25519"],
  "1.3.101.113": ["Ed448", "Ed448"],
  "1.2.840.10040.4.1": ["id-DSA", "dsa"],
  // ---- EC 曲线（RFC 5480 §2.1 / SEC 2 v2）----
  "1.2.840.10045.3.1.7": ["prime256v1", "P-256 / secp256r1"],
  "1.3.132.0.33": ["P-224", "secp224r1"],
  "1.3.132.0.34": ["P-384", "secp384r1"],
  "1.3.132.0.35": ["P-521", "secp521r1"],
  "1.3.132.0.10": ["secp256k1", "secp256k1"],
  // ---- CRL 扩展（RFC 5280 §5.2 / §5.3）----
  "2.5.29.20": ["cRLNumber", "cRLNumber"],
  "2.5.29.27": ["deltaCRLIndicator", "deltaCRLIndicator"],
  "2.5.29.28": ["issuingDistributionPoint", "issuingDistributionPoint"],
  "2.5.29.35": ["authorityKeyIdentifier", "authorityKeyIdentifier"],
  "2.5.29.18": ["issuerAltName", "issuerAltName"],
  "2.5.29.21": ["cRLReason", "reasonCode"],
  "2.5.29.24": ["invalidityDate", "invalidityDate"],
  "2.5.29.29": ["certificateIssuer", "certificateIssuer"],
  "2.5.29.31": ["cRLDistributionPoints", "cRLDistributionPoints"],
  // ---- extensionRequest 常见证书扩展 ----
  "2.5.29.14": ["subjectKeyIdentifier", "subjectKeyIdentifier"],
  "2.5.29.15": ["keyUsage", "keyUsage"],
  "2.5.29.17": ["subjectAltName", "subjectAltName"],
  "2.5.29.19": ["basicConstraints", "basicConstraints"],
  "2.5.29.37": ["extKeyUsage", "extKeyUsage"],
  "1.3.6.1.5.5.7.1.1": ["authorityInfoAccess", "authorityInfoAccess"],
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

/** EC 曲线 OID → 域位长（r,s 上限与坐标定长） */
const CURVE_BITS = {
  "1.2.840.10045.3.1.7": 256,
  "1.3.132.0.33": 224,
  "1.3.132.0.34": 384,
  "1.3.132.0.35": 521,
  "1.3.132.0.10": 256,
};

/** CRL reasonCode 枚举（RFC 5280 §5.3.1） */
const CRL_REASON = {
  0: "unspecified（0）",
  1: "keyCompromise（1）",
  2: "cACompromise（2）",
  3: "affiliationChanged（3）",
  4: "superseded（4）",
  5: "cessationOfOperation（5）",
  6: "certificateHold（6）",
  8: "removeFromCRL（8）",
  9: "privilegeWithdrawn（9）",
  10: "aACompromise（10）",
};

// ============================================================
// 时间 / DN（X.501，与 certparse.js 同思路的本地实现）
// ============================================================

/** ASN.1 Time → UTC 毫秒。UTCTime(0x17) RFC 5280 §4.1.2.5.1（YY≥50→19xx）；
 *  GeneralizedTime(0x18) §4.1.2.5.2。容忍 ±hhmm 偏移（BER 宽松，DER 应为 Z）。 */
function parseTimeNode(node, what) {
  const raw = asciiStr(node.value);
  let ms;
  let off = "Z";
  if (node.tag === 0x17) {
    const m = /^(\d{10}|\d{12})(Z|[+-]\d{4})$/.exec(raw);
    if (!m) throw new Error(`${what} 的 UTCTime 非法：${JSON.stringify(raw)}（RFC 5280 §4.1.2.5.1）`);
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

/** X.501 Name 节点 → [[{oid,value,tag,hex}...]]（RDN 列表，每个 RDN 是 ATV 列表） */
function parseName(node, what) {
  if (node.tag !== 0x30 || !node.children) throw new Error(`${what} DN 结构非法（X.501 RDNSequence 应为 SEQUENCE OF SET）`);
  return node.children.map((rdn, ri) => {
    if (rdn.tag !== 0x31 || !rdn.children) throw new Error(`${what} 的第 ${ri + 1} 个 RDN 不是 SET（X.501）`);
    return rdn.children.map((atv) => {
      if (atv.tag !== 0x30 || !atv.children || atv.children.length < 2 || atv.children[0].tag !== 0x06) {
        throw new Error(`${what} 的第 ${ri + 1} 个 RDN 内 AttributeTypeAndValue 结构非法（X.501：SEQUENCE{OID,value}）`);
      }
      const vNode = atv.children[1];
      return {
        oid: oidString(atv.children[0].value),
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
      return `  ${short.padEnd(3)} ${full.padEnd(24)} = ${val}`;
    });
    lines.push(parts.join("  +  ")); // 多值 RDN（X.501 multi-valued）用 + 连接
  }
  lines.push(`  RFC 4514 : ${dnToRfc4514(name)}`);
  return lines;
}

// ============================================================
// 输入装载：PEM（RFC 7468）或 DER hex
// ============================================================

/** CSR/CRL 通用输入装载。labels = 该 op 接受的 PEM 标签白名单 */
function loadPemOrDer(text, labels, whatZh, minLen) {
  const src = String(text || "").trim();
  if (!src) throw new Error(`输入为空：需要 ${whatZh}（PEM 或 DER 十六进制）`);
  if (src.includes("-----BEGIN")) {
    const { label, der } = parsePem(src);
    if (!labels.includes(label)) {
      throw new Error(`PEM 标签是 ${label}，不是 ${labels.join(" / ")}（${whatZh}，RFC 7468）——X.509 证书解析请用「X.509 证书解析」工具，密钥用「PEM 密钥解析」类工具`);
    }
    return { der, srcKind: `PEM（${label}，RFC 7468）` };
  }
  const h = src.replace(/[\s:]/g, "");
  if (/^[0-9a-fA-F]+$/.test(h)) {
    if (h.length % 2 !== 0) throw new Error("DER hex 长度为奇数——半个字节无法还原");
    if (h.length < minLen) throw new Error(`输入过短（${h.length / 2} 字节），不可能是 ${whatZh}`);
    return { der: hexToBytes(h), srcKind: "DER 十六进制" };
  }
  throw new Error(`无法识别输入：需 ${whatZh} 的 PEM（-----BEGIN ${labels[0]}----- …）或 DER 十六进制`);
}

// ============================================================
// 公钥与验签（RFC 8017 / RFC 5480 / RFC 3279）
// ============================================================

/** BigInt modpow（验签 RSA sig^e mod n 用；e 为小指数，性能无虞） */
function modPow(b, e, m) {
  let r = 1n;
  b %= m;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}

/** DigestInfo DER 前缀（RFC 8017 §9.2 note 1：HASH OID 对应的 AlgorithmIdentifier 段） */
const DIGEST_INFO_PREFIX = {
  MD5: "3020300c06082a864886f70d020505000410",
  "SHA-1": "3021300906052b0e03021a05000414",
  "SHA-224": "302d300d06096086480165030402040500041c",
  "SHA-256": "3031300d060960864801650304020105000420",
  "SHA-384": "3041300d060960864801650304020205000430",
  "SHA-512": "3051300d060960864801650304020305000440",
};

/** 摘要：MD5 走 hash.js（crypto.subtle 无），SHA 系走 crypto.subtle（Node 18+/浏览器均有） */
async function digestBytes(alg, data) {
  if (alg === "MD5") return md5Bytes(data);
  return new Uint8Array(await crypto.subtle.digest(alg, data));
}

/** 签名 OID → { kind: "RSA"|"ECDSA"|"Ed", hash } */
function sigAlgInfo(oid) {
  const rsa = {
    "1.2.840.113549.1.1.4": "MD5",
    "1.2.840.113549.1.1.5": "SHA-1",
    "1.2.840.113549.1.1.11": "SHA-256",
    "1.2.840.113549.1.1.12": "SHA-384",
    "1.2.840.113549.1.1.13": "SHA-512",
    "1.2.840.113549.1.1.14": "SHA-224",
  };
  if (rsa[oid]) return { kind: "RSA", hash: rsa[oid] };
  const ec = {
    "1.2.840.10045.4.1": "SHA-1",
    "1.2.840.10045.4.3.1": "SHA-224",
    "1.2.840.10045.4.3.2": "SHA-256",
    "1.2.840.10045.4.3.3": "SHA-384",
    "1.2.840.10045.4.3.4": "SHA-512",
  };
  if (ec[oid]) return { kind: "ECDSA", hash: ec[oid] };
  if (oid === "1.3.101.112") return { kind: "Ed", hash: null }; // Ed25519（RFC 8410，PureEdDSA，单次 SHA-512 内部）
  return { kind: null, hash: null };
}

/** SPKI 解析（RFC 5280 §4.1.2.7，CSR 的 subjectPKInfo 同构）→ 结构化 + 文本行 */
function parseSpki(spkiNode) {
  const lines = [];
  if (spkiNode.tag !== 0x30 || !spkiNode.children || spkiNode.children.length !== 2) {
    throw new Error("subjectPKInfo 结构非法（RFC 2986 §4.1 / RFC 5280 §4.1.2.7：SEQUENCE{AlgorithmIdentifier,BIT STRING}）");
  }
  const alg = spkiNode.children[0];
  const bit = spkiNode.children[1];
  if (alg.tag !== 0x30 || !alg.children || !alg.children[0] || alg.children[0].tag !== 0x06 || bit.tag !== 0x03) {
    throw new Error("subjectPKInfo 的算法/密钥结构非法");
  }
  const algOid = oidString(alg.children[0].value);
  const params = alg.children[1] || null;
  const keyBytes = bit.value.subarray(1);
  if (bit.value[0] !== 0) lines.push(`警告：BIT STRING unused bits = ${bit.value[0]}（公钥应恒为 0）`);
  lines.push(`算法 : ${oidLabel(algOid)}`);
  const info = { algOid };

  if (algOid === "1.2.840.113549.1.1.1") { // rsaEncryption（RFC 8017 §A.1.1）
    const inner = derDecode(keyBytes);
    if (inner.tag !== 0x30 || !inner.children || inner.children.length !== 2 || inner.children[0].tag !== 0x02 || inner.children[1].tag !== 0x02) {
      throw new Error("RSAPublicKey 结构非法（RFC 8017 §A.1.1：SEQUENCE{INTEGER n,INTEGER e}）");
    }
    const n = derBytesToBigint(inner.children[0].value);
    const e = derBytesToBigint(inner.children[1].value);
    lines.push(`n 位长 : ${n.toString(2).length} bit`);
    lines.push(`e      : ${e}（0x${e.toString(16).toUpperCase()}）`);
    Object.assign(info, { kind: "RSA", n, e, bits: n.toString(2).length });
    return { info, lines };
  }
  if (algOid === "1.2.840.10045.2.1") { // id-ecPublicKey（RFC 5480）
    if (!params || params.tag !== 0x06) throw new Error("EC 公钥缺 namedCurve 参数（RFC 5480 §2.1.1）");
    const curveOid = oidString(params.value);
    lines.push(`曲线   : ${oidLabel(curveOid)}`);
    const bl = CURVE_BITS[curveOid];
    const nb = bl ? (bl + 7) >> 3 : null;
    if (keyBytes[0] === 0x04 && nb && keyBytes.length === 1 + 2 * nb) {
      lines.push(`公钥点 : 非压缩（SEC 1 v2 §2.3.3，0x04 ‖ X ‖ Y，${keyBytes.length} 字节）`);
      lines.push(`X      : ${bytesToHex(keyBytes.subarray(1, 1 + nb)).toUpperCase()}`);
      lines.push(`Y      : ${bytesToHex(keyBytes.subarray(1 + nb)).toUpperCase()}`);
    } else if (keyBytes[0] === 0x02 || keyBytes[0] === 0x03) {
      lines.push(`公钥点 : 压缩（SEC 1 v2 §2.3.1，0x0${keyBytes[0]} ‖ X，${keyBytes.length} 字节）`);
    } else {
      lines.push(`公钥点 : 首字节 0x${keyBytes[0].toString(16)} 非 02/03/04，非常规点编码（SEC 1）`);
    }
    Object.assign(info, { kind: "EC", curveOid, bits: bl || null });
    return { info, lines };
  }
  if (algOid === "1.3.101.112" || algOid === "1.3.101.113") { // Ed25519/Ed448（RFC 8410）
    lines.push(`公钥   : ${keyBytes.length} 字节原始点 ${bytesToHex(keyBytes).toUpperCase()}`);
    Object.assign(info, { kind: "Ed", bits: algOid === "1.3.101.112" ? 256 : 456 });
    return { info, lines };
  }
  lines.push(`公钥   : 未识别算法，BIT STRING 内容 ${keyBytes.length} 字节 ${hexColon(keyBytes)}`);
  return { info, lines };
}

/** RSA PKCS#1 v1.5 验签（RFC 8017 §8.2.2）：
 *  EM = 0x00 ‖ 0x01 ‖ PS(FF×≥8) ‖ 0x00 ‖ DigestInfo(HASH(cri))，与 sig^e mod n 全等比对 */
async function rsaVerifyPkcs1(n, e, sig, hashAlg, tbsBytes) {
  const k = (n.toString(2).length + 7) >> 3;
  if (sig.length !== k) return { ok: false, why: `签名长度 ${sig.length} 字节 ≠ 模数长度 ${k} 字节（RFC 8017 §8.2.2）` };
  const prefix = DIGEST_INFO_PREFIX[hashAlg];
  if (!prefix) return { ok: false, why: `哈希 ${hashAlg} 的 DigestInfo 前缀未内置` };
  const h = await digestBytes(hashAlg, tbsBytes);
  const di = hexToBytes(prefix + bytesToHex(h));
  if (di.length + 11 > k) return { ok: false, why: "DigestInfo + 11 > 模数长度，密钥过短" };
  const em = new Uint8Array(k);
  em[0] = 0x00; em[1] = 0x01;
  em.fill(0xff, 2, k - 1 - di.length);
  em[k - 1 - di.length] = 0x00;
  em.set(di, k - di.length);
  // sig^e mod n → 定长 k 字节。签名是 BIT STRING 原始字节（非 DER INTEGER）：
  // 按 IEEE 1363 大端无符号转 BigInt，勿用 derBytesToBigint（二补码会把高位 1 解成负数）
  const m = modPow(BigInt("0x" + bytesToHex(sig)), e, n);
  const mh = m.toString(16).padStart(k * 2, "0");
  const ok = mh === bytesToHex(em);
  return { ok, why: ok ? "签名的 RSA 恢复值与 00 01 FF.. 00 ‖ DigestInfo(HASH(CRI)) 全等（RFC 8017 §8.2.2）" : "恢复的编码块与期望 EM 不一致（签名不覆盖本 CRI / 算法不符 / 数据被改）" };
}

/** ECDSA 签名结构检查（r,s DER 与曲线位长上限，SEC 1 v2 §2.2.3 / RFC 3279 §2.2.3）。
 *  椭圆曲线点运算级验签不在本工具范围（输出注明）。 */
function ecdsaStructCheck(sig, curveBits) {
  if (!curveBits) return { ok: false, why: "曲线位长未知（未收录曲线），跳过 r,s 检查" };
  try {
    const inner = derDecode(sig);
    if (inner.tag !== 0x30 || !inner.children || inner.children.length !== 2 ||
      inner.children[0].tag !== 0x02 || inner.children[1].tag !== 0x02) {
      return { ok: false, why: "签名内不是 Ecdsa-Sig-Value SEQUENCE{r,s}（RFC 3279 §2.2.3）" };
    }
    const r = derBytesToBigint(inner.children[0].value);
    const s = derBytesToBigint(inner.children[1].value);
    if (r <= 0n || s <= 0n) return { ok: false, why: "r/s 非正（RFC 3279 §2.2.3）" };
    if (r.toString(2).length > curveBits || s.toString(2).length > curveBits) {
      return { ok: false, why: `r/s 位长（${r.toString(2).length}/${s.toString(2).length}）超过曲线阶上限 ${curveBits} bit` };
    }
    return { ok: true, why: `r,s 均为正且 ≤ ${curveBits} bit（结构合法，符合 SEC 1 §2.2.3；椭圆曲线点级验签不在本工具范围）`, r, s };
  } catch (e) {
    return { ok: false, why: `ECDSA 签名 DER 解析失败：${e.message}` };
  }
}

// ============================================================
// CSR 解析（PKCS#10 / RFC 2986 §4）
// ============================================================

/** PKCS#10 属性展示（RFC 2985）：challengePassword 打印、extensionRequest 展开证书扩展 OID */
function csrAttrLines(attrNode, ai) {
  const lines = [];
  if (attrNode.tag !== 0x30 || !attrNode.children || attrNode.children.length < 2 || attrNode.children[0].tag !== 0x06) {
    throw new Error(`第 ${ai + 1} 个 Attribute 结构非法（RFC 2986 §4.1：SEQUENCE{OID,SET}）`);
  }
  const oid = oidString(attrNode.children[0].value);
  const setNode = attrNode.children[1];
  if (setNode.tag !== 0x31 || !setNode.children) {
    throw new Error(`第 ${ai + 1} 个 Attribute 的 values 不是 SET（RFC 2986 §4.1）`);
  }
  lines.push(`  ${ai + 1}. ${oidLabel(oid)}`);

  if (oid === "1.2.840.113549.1.9.7") { // challengePassword（RFC 2985 §5.4）
    const v = setNode.children[0];
    if (v) lines.push(`      值 : ${decodeDnValue(v) ?? "hex:" + bytesToHex(v.value)}（${DN_STRING_TAG[v.tag] || "tag 0x" + v.tag.toString(16)}）`);
    return lines;
  }
  if (oid === "1.2.840.113549.1.9.14") { // extensionRequest（RFC 2985 §5.4.1：请求的证书扩展）
    for (const v of setNode.children) {
      try {
        const seq = derDecode(v.value); // v 本身是 OCTET? 不——SET 内直接是 Extensions SEQUENCE
        if (seq.tag !== 0x30) throw new Error("非 SEQUENCE");
        lines.push(`      请求扩展（RFC 5280 §4.1）共 ${seq.children.length} 项：`);
        seq.children.forEach((e, ei) => {
          if (e.tag === 0x30 && e.children && e.children[0].tag === 0x06) {
            const extOid = oidString(e.children[0].value);
            const crit = e.children[1] && e.children[1].tag === 0x01;
            lines.push(`        ${String(ei + 1).padStart(2)}  ${extOid.padEnd(22)} ${oidShort(extOid)}${crit ? " ·critical" : ""}`);
          }
        });
      } catch (e) {
        lines.push(`      解析失败：${e.message}（原样 hex：${bytesToHex(v.value.subarray(0, 48))}…）`);
      }
    }
    return lines;
  }
  // 其余属性（unstructuredName/Address 等）：短值字符串展示 + hex 摘要
  for (const v of setNode.children) {
    const str = decodeDnValue(v);
    lines.push(`      值 : ${str != null ? str : "hex:" + bytesToHex(v.value.subarray(0, 48))}${v.value.length > 48 ? "…" : ""}（${DN_STRING_TAG[v.tag] || "tag 0x" + v.tag.toString(16)}，${v.value.length} 字节）`);
  }
  return lines;
}

async function csrParseRun(text) {
  // PEM 标签：CERTIFICATE REQUEST（RFC 7468/OpenSSL 标准）+ NEW CERTIFICATE REQUEST（旧 OpenSSL/GnuTLS 变体）
  const { der, srcKind } = loadPemOrDer(text, ["CERTIFICATE REQUEST", "NEW CERTIFICATE REQUEST"], "PKCS#10 证书请求 CSR", 16);
  let root;
  try {
    root = derDecode(der);
  } catch (e) {
    throw new Error(`DER 解析失败（数据被截断或非 DER）：${e.message}`);
  }
  if (root.tag !== 0x30 || !root.children || root.children.length !== 3) {
    throw new Error("顶层结构不是 CertificationRequest：需 SEQUENCE{ certificationRequestInfo, signatureAlgorithm, signature }（RFC 2986 §4）");
  }
  const [cri, sigAlg, sigNode] = root.children;
  if (cri.tag !== 0x30 || !cri.children || cri.children.length !== 4 ||
    sigAlg.tag !== 0x30 || !sigAlg.children || !sigAlg.children[0] || sigAlg.children[0].tag !== 0x06 || sigNode.tag !== 0x03) {
    throw new Error("CertificationRequest 三段结构非法（CRI/sigAlg/BIT STRING，RFC 2986 §4）");
  }
  if (cri.children[0].tag !== 0x02) throw new Error("certificationRequestInfo 第 1 项不是 INTEGER version（RFC 2986 §4.1）");
  const version = derBytesToBigint(cri.children[0].value);
  const subject = parseName(cri.children[1], "subject");
  const spki = parseSpki(cri.children[2]);
  const attrsNode = cri.children[3];
  if (attrsNode.tag !== 0xa0) throw new Error("certificationRequestInfo 第 4 项不是 [0] IMPLICIT attributes（RFC 2986 §4.1）");

  // CRI 原始字节（验签输入）：子节点 start/end 相对根 value 数组，换算回 der 坐标
  const rootOff = der.length - root.value.length;
  const criBytes = der.subarray(rootOff + cri.start, rootOff + cri.end);

  const sigOid = oidString(sigAlg.children[0].value);
  const sigBytes = sigNode.value.subarray(1);
  const si = sigAlgInfo(sigOid);

  // ---- 输出组装 ----
  const out = [];
  out.push("PKCS#10 CSR 解析（RFC 2986）");
  out.push(`输入 : ${srcKind} · DER ${der.length} 字节`);

  out.push("");
  out.push("[certificationRequestInfo]（RFC 2986 §4.1）");
  out.push(`版本   : ${version}${version === 0n ? "（PKCS#10 固定为 0）" : "（非 0：RFC 2986 规定此版本恒为 0，非常规）"}`);
  out.push("");
  out.push(...dnBlockLines(subject, "主体 Subject DN"));
  out.push("");
  out.push("[主体公钥 subjectPKInfo]");
  out.push(...spki.lines);

  out.push("");
  out.push(`[属性 attributes [0]]（RFC 2986 §4.1 / RFC 2985，共 ${attrsNode.children.length} 项${version !== 0n ? "" : ""}）`);
  if (!attrsNode.children.length) {
    out.push("  无属性（openssl req -text 显示 (none)）");
  } else {
    attrsNode.children.forEach((a, i) => out.push(...csrAttrLines(a, i)));
  }

  out.push("");
  out.push("[签名]");
  out.push(`签名算法 : ${oidLabel(sigOid)}（OID ${sigOid}）`);
  out.push(`  PKCS#10 的 CRI 内无算法字段（区别于 X.509 TBS 内 signature）——一致性校验方式：按声明算法对 CRI 原始 ${criBytes.length} 字节验签`);
  if (si.kind === "RSA" && spki.info.kind === "RSA") {
    let vr;
    try {
      vr = si.hash === "SHA-224"
        ? { ok: false, why: "SHA-224 摘要本环境 crypto.subtle 不提供，跳过完整验签" }
        : await rsaVerifyPkcs1(spki.info.n, spki.info.e, sigBytes, si.hash, criBytes);
    } catch (e) {
      vr = { ok: false, why: `验签异常：${e.message}` };
    }
    out.push(`  RSA PKCS#1 v1.5 验签（RFC 8017 §8.2.2，${si.hash}）: ${vr.ok ? "通过" : "未通过/跳过"}——${vr.why}`);
  } else if (si.kind === "ECDSA" && spki.info.kind === "EC") {
    const c = ecdsaStructCheck(sigBytes, spki.info.bits);
    out.push(`  ECDSA r,s 结构（RFC 3279 §2.2.3，${si.hash}）: ${c.ok ? "合法" : "非法"}——${c.why}`);
    if (c.r != null) out.push(`  r : ${c.r.toString(16).toUpperCase()} / s : ${c.s.toString(16).toUpperCase()}`);
  } else if (si.kind === "Ed") {
    out.push("  Ed25519 验签不在本工具范围（RFC 8410），仅结构展示");
  } else {
    out.push(`  算法（${oidShort(sigOid)}）与公钥类型（${spki.info.kind ?? "未知"}）组合未收录，跳过验签`);
  }
  if (si.kind === "RSA" && spki.info.kind !== "RSA" || si.kind === "ECDSA" && spki.info.kind !== "EC") {
    out.push("  警告：签名算法族与公钥算法族不匹配（非常规）");
  }
  out.push(`签名值   : ${sigBytes.length} 字节 BIT STRING`);
  out.push(...wrap64(bytesToHex(sigBytes).toUpperCase()));
  // T364 产物协议：CSR DER 出 request.der（application/pkcs10，即 .csr 换壳）
  const files = [{ name: "request.der", mime: "application/pkcs10", bytes: der }];
  out.push("", `产物：1 个文件可下载（${files[0].name}，与输入 DER 逐字节一致）`);
  return { text: out.join("\n"), files };
}

// ============================================================
// CRL 解析（RFC 5280 §5.1 CertificateList）
// ============================================================

/** CRL entry 扩展（RFC 5280 §5.3）→ 明细行 */
function crlEntryExtLines(oid, valueDer) {
  const lines = [];
  const soft = (fn) => { try { fn(); } catch (e) { lines.push(`        解析失败：${e.message}（hex：${bytesToHex(valueDer.subarray(0, 32))}…）`); } };
  if (oid === "2.5.29.21") { // reasonCode ENUMERATED（RFC 5280 §5.3.1）
    soft(() => {
      const n = derDecode(valueDer);
      const v = n.tag === 0x0a || n.tag === 0x02 ? Number(derBytesToBigint(n.value)) : NaN;
      lines.push(`        吊销原因 : ${CRL_REASON[v] ?? `未知值 ${v}（RFC 5280 §5.3.1；7 未分配）`}`);
    });
    return lines;
  }
  if (oid === "2.5.29.24") { // invalidityDate GeneralizedTime（RFC 5280 §5.3.2）
    soft(() => {
      const n = derDecode(valueDer);
      const t = parseTimeNode(n, "invalidityDate");
      lines.push(`        失效日期 : ${fmtUtc(t.ms)}（${t.raw}）`);
    });
    return lines;
  }
  if (oid === "2.5.29.29") {
    lines.push("        certificateIssuer（间接 CRL 用，RFC 5280 §5.3.3）");
    return lines;
  }
  soft(() => {
    lines.push(`        值（hex 摘要）：${bytesToHex(valueDer.subarray(0, 32))}${valueDer.length > 32 ? "…" : ""}（${valueDer.length} 字节）`);
  });
  return lines;
}

/** CRL 级扩展（RFC 5280 §5.2）→ 明细行 */
function crlExtLines(oid, valueDer) {
  const lines = [];
  const soft = (fn) => { try { fn(); } catch (e) { lines.push(`      解析失败：${e.message}（hex：${bytesToHex(valueDer.subarray(0, 32))}…）`); } };
  if (oid === "2.5.29.20") { // cRLNumber INTEGER（RFC 5280 §5.2.3）
    soft(() => {
      const n = derDecode(valueDer);
      lines.push(`      CRL 号 : ${derBytesToBigint(n.value)}（monotonic 递增整数）`);
    });
    return lines;
  }
  if (oid === "2.5.29.27") { // deltaCRLIndicator（RFC 5280 §5.2.4，必须 critical）
    soft(() => {
      const n = derDecode(valueDer);
      lines.push(`      基准 CRL 号 : ${derBytesToBigint(n.value)}（本 CRL 是其增量 delta）`);
    });
    return lines;
  }
  if (oid === "2.5.29.35") { // AKID（RFC 5280 §5.2.1）
    soft(() => {
      const seq = derDecode(valueDer);
      for (const c of seq.children || []) {
        if (c.tag === 0x80) lines.push(`      keyIdentifier = ${hexColon(c.value)}`);
      }
    });
    return lines;
  }
  soft(() => {
    lines.push(`      值（hex 摘要）：${bytesToHex(valueDer.subarray(0, 32))}${valueDer.length > 32 ? "…" : ""}（${valueDer.length} 字节）`);
  });
  return lines;
}

/** Extension SEQUENCE OF（RFC 5280 §4.1）→ [{oid,critical,valueDer}] */
function parseExtensionsNode(seqNode, whatZh) {
  if (seqNode.tag !== 0x30 || !seqNode.children) throw new Error(`${whatZh} 扩展结构非法（SEQUENCE OF Extension，RFC 5280 §4.1）`);
  return seqNode.children.map((e, i) => {
    if (e.tag !== 0x30 || !e.children || e.children.length < 2 || e.children[0].tag !== 0x06) {
      throw new Error(`${whatZh} 第 ${i + 1} 个 Extension 结构非法（SEQUENCE{OID,critical?,OCTET STRING}）`);
    }
    let j = 1, critical = false;
    if (e.children[j] && e.children[j].tag === 0x01) { critical = e.children[j].value[0] !== 0; j++; }
    if (!e.children[j] || e.children[j].tag !== 0x04) throw new Error(`${whatZh} 第 ${i + 1} 个 Extension 缺 extnValue OCTET STRING`);
    return { oid: oidString(e.children[0].value), critical, valueDer: e.children[j].value };
  });
}

function crlParseRun(text) {
  const { der, srcKind } = loadPemOrDer(text, ["X509 CRL"], "X.509 CRL（RFC 5280 §5.1）", 16);
  let root;
  try {
    root = derDecode(der);
  } catch (e) {
    throw new Error(`DER 解析失败（数据被截断或非 DER）：${e.message}`);
  }
  if (root.tag !== 0x30 || !root.children || root.children.length !== 3) {
    throw new Error("顶层结构不是 CertificateList：需 SEQUENCE{ tbsCertList, signatureAlgorithm, signatureValue }（RFC 5280 §5.1）");
  }
  const [tbs, sigAlgOuter, sigNode] = root.children;
  if (tbs.tag !== 0x30 || !tbs.children || tbs.children.length < 4 ||
    sigAlgOuter.tag !== 0x30 || !sigAlgOuter.children || !sigAlgOuter.children[0] || sigAlgOuter.children[0].tag !== 0x06 || sigNode.tag !== 0x03) {
    throw new Error("CertificateList 三段结构非法（tbsCertList/sigAlg/BIT STRING，RFC 5280 §5.1）");
  }

  // ---- TBSCertList 字段（RFC 5280 §5.1.2），version INTEGER OPTIONAL 缺省 = v1 ----
  let idx = 0;
  let version = 1; // 缺省 v1
  let hasVersion = false;
  if (tbs.children[0].tag === 0x02) {
    version = Number(derBytesToBigint(tbs.children[0].value)) + 1; // INTEGER 1 → v2
    hasVersion = true;
    idx = 1;
  }
  const sigAlgTbs = tbs.children[idx];
  if (sigAlgTbs.tag !== 0x30 || !sigAlgTbs.children || !sigAlgTbs.children[0] || sigAlgTbs.children[0].tag !== 0x06) {
    throw new Error("tbsCertList 内 signature AlgorithmIdentifier 结构非法（RFC 5280 §5.1.2.2）");
  }
  const issuer = parseName(tbs.children[idx + 1], "issuer");
  const thisUpdate = parseTimeNode(tbs.children[idx + 2], "thisUpdate");
  let next = idx + 3;
  let nextUpdate = null;
  if (tbs.children[next] && (tbs.children[next].tag === 0x17 || tbs.children[next].tag === 0x18)) {
    nextUpdate = parseTimeNode(tbs.children[next], "nextUpdate");
    next++;
  }
  let revoked = [];
  let hasRevoked = false;
  if (tbs.children[next] && tbs.children[next].tag === 0x30) { // revokedCertificates OPTIONAL（§5.1.2.6）
    hasRevoked = true;
    for (const [ri, r] of (tbs.children[next].children || []).entries()) {
      if (r.tag !== 0x30 || !r.children || r.children.length < 2 || r.children[0].tag !== 0x02) {
        throw new Error(`第 ${ri + 1} 条 revoked 结构非法（RFC 5280 §5.1.2.6：SEQUENCE{serial,Time,ext?}）`);
      }
      const serialNode = r.children[0];
      const revDate = parseTimeNode(r.children[1], `第 ${ri + 1} 条 revocationDate`);
      let entryExts = [];
      if (r.children[2]) entryExts = parseExtensionsNode(r.children[2], `第 ${ri + 1} 条 CRL entry`);
      revoked.push({ serialNode, revDate, entryExts });
    }
    next++;
  }
  let crlExts = [];
  if (tbs.children[next] && tbs.children[next].tag === 0xa0) { // crlExtensions [0] EXPLICIT（§5.1.2.8）
    const seq = tbs.children[next].children && tbs.children[next].children[0];
    if (!seq) throw new Error("crlExtensions [0] 内缺 SEQUENCE（RFC 5280 §5.1.2.8）");
    crlExts = parseExtensionsNode(seq, "CRL");
    if (version < 2) throw new Error("v1 CRL 含 crlExtensions：非法（RFC 5280 §5.1.2.8，扩展仅 v2）");
    next++;
  }
  const tail = tbs.children.slice(next);
  if (tail.length) throw new Error(`tbsCertList 尾部有 ${tail.length} 个未识别字段（tag 0x${tail.map((n) => n.tag.toString(16)).join("/0x")}，RFC 5280 §5.1.2）`);

  const sigOidOuter = oidString(sigAlgOuter.children[0].value);
  const sigOidTbs = oidString(sigAlgTbs.children[0].value);
  const sigBytes = sigNode.value.subarray(1);

  // ---- 输出组装 ----
  const out = [];
  out.push("X.509 CRL 解析（RFC 5280 §5.1）");
  out.push(`输入 : ${srcKind} · DER ${der.length} 字节`);

  out.push("");
  out.push("[基本信息]");
  out.push(`版本     : v${version}（${hasVersion ? `INTEGER ${version - 1}，RFC 5280 §5.1.2.1` : "version 缺省 = v1（有扩展/entry 扩展应为 v2）"}）`);
  out.push(`签名算法 : ${oidLabel(sigOidOuter)}（OID ${sigOidOuter}）`);
  out.push(`  外层 signatureAlgorithm 与 tbsCertList 内 : ${sigOidOuter === sigOidTbs ? "一致（RFC 5280 §5.1.1.2 要求两处一致）" : "不一致（违规格，谨慎对待）"}`);
  if (sigOidOuter === "1.2.840.113549.1.1.10") out.push("  RSASSA-PSS（RFC 8017）：参数明细未展开（本工具只列 OID）");

  out.push("");
  out.push(...dnBlockLines(issuer, "签发者 Issuer DN"));

  out.push("");
  out.push("[更新时间]（RFC 5280 §5.1.2.4/§5.1.2.5）");
  out.push(`thisUpdate : ${fmtUtc(thisUpdate.ms)}（${thisUpdate.kind} ${thisUpdate.raw}）`);
  out.push(nextUpdate ? `nextUpdate : ${fmtUtc(nextUpdate.ms)}（${nextUpdate.kind} ${nextUpdate.raw}）` : "nextUpdate : 缺省（RFC 5280： SHOULD 出现，缺省属非常规）");
  const nowMs = Date.now();
  if (nextUpdate) out.push(`判定       : ${nowMs > nextUpdate.ms ? "已过期（nextUpdate 早于当前时间，应取新 CRL）" : `未过期（剩余 ${Math.floor((nextUpdate.ms - nowMs) / 3600000)} 小时）`}`);

  out.push("");
  out.push(`[已吊销证书 revokedCertificates]（RFC 5280 §5.1.2.6，${revoked.length} 条${hasRevoked ? "" : "（字段缺省：无吊销记录）"}）`);
  if (!revoked.length) {
    out.push("  空（v1 CRL 常见于无吊销记录场景）");
  } else {
    for (const [i, r] of revoked.entries()) {
      out.push(`  ${i + 1}. 序列号 : ${hexColon(r.serialNode.value)}（原始 ${r.serialNode.value.length} 字节，十进制 ${derBytesToBigint(r.serialNode.value)}）`);
      out.push(`     吊销日期 : ${fmtUtc(r.revDate.ms)}（${r.revDate.kind} ${r.revDate.raw}）`);
      if (r.entryExts.length) {
        out.push(`     entry 扩展（RFC 5280 §5.3，${r.entryExts.length} 项）：`);
        for (const e of r.entryExts) {
          out.push(`       - ${oidLabel(e.oid)}${e.critical ? " ·critical" : ""}`);
          out.push(...crlEntryExtLines(e.oid, e.valueDer));
        }
      }
    }
  }

  out.push("");
  out.push(`[CRL 扩展 crlExtensions [0]]（RFC 5280 §5.2，${crlExts.length} 项）`);
  if (!crlExts.length) {
    out.push("  无（v1 CRL 不允许携带）");
  } else {
    for (const e of crlExts) {
      out.push(`  - ${oidLabel(e.oid)}${e.critical ? " ·critical" : ""}${e.oid === "2.5.29.27" && !e.critical ? "（警告：deltaCRLIndicator 必须标记 critical，RFC 5280 §5.2.4）" : ""}`);
      out.push(...crlExtLines(e.oid, e.valueDer));
    }
  }

  out.push("");
  out.push("[签名值 signatureValue]（BIT STRING）");
  if (sigNode.value[0] !== 0) out.push(`  警告：unused bits = ${sigNode.value[0]}（签名应恒 0）`);
  out.push(`  ${sigBytes.length} 字节：`);
  out.push(...wrap64(bytesToHex(sigBytes).toUpperCase()));
  // T364 产物协议：CRL DER 出 crl.der（application/pkix-crl）
  const files = [{ name: "crl.der", mime: "application/pkix-crl", bytes: der }];
  out.push("", `产物：1 个文件可下载（${files[0].name}，与输入 DER 逐字节一致）`);
  return { text: out.join("\n"), files };
}

// ============================================================
// op 注册（cat crypto，run 单向）
// ============================================================

register({
  id: "csrParse",
  cat: "asym",
  name: "CSR 证书请求解析（PKCS#10）",
  desc: "解析 PKCS#10 证书签名请求（RFC 2986）：PEM（CERTIFICATE REQUEST / NEW CERTIFICATE REQUEST）或 DER hex 输入。输出版本/主体 DN（X.501 逐 RDN + RFC 4514 串）/公钥（RSA n 位长+e、EC 曲线+点、Ed25519）/attributes 属性（challengePassword RFC 2985 1.2.840.113549.1.9.7、extensionRequest 请求扩展展开）/签名算法+签名值，并按声明算法对 certificationRequestInfo 原始字节做一致性校验（RSA PKCS#1 v1.5 完整验签 RFC 8017 §8.2.2；ECDSA 验 r,s 结构与曲线位长）。对拍 openssl req -text -noout。负例（非 CSR PEM/截断 DER）中文报错",
  params: [],
  run: csrParseRun,
});

register({
  id: "crlParse",
  cat: "asym",
  name: "X.509 CRL 吊销列表解析",
  desc: "解析 X.509 证书吊销列表（RFC 5280 §5.1 CertificateList）：PEM（X509 CRL）或 DER hex 输出。输出版本/签发者 DN/thisUpdate/nextUpdate（含过期判定）/revokedCertificates 逐条（序列号 hex+十进制、吊销日期、entry 扩展：reasonCode 吊销原因枚举 §5.3.1、invalidityDate §5.3.2）/CRL 扩展（cRLNumber、deltaCRLIndicator、AKID §5.2）/签名算法（内外两处一致性校验 §5.1.1.2）+签名值。列表循环纯解析，10 万条 revoked 内性能可接受。对拍 openssl crl -text -noout。负例（非 CRL PEM/截断 DER）中文报错",
  params: [],
  run: crlParseRun,
});

// 供回归脚本与后续任务卡复用
export { csrParseRun, crlParseRun };
