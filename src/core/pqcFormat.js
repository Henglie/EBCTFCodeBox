/*
 * pqcFormat.js — PQC blob 解析（ML-KEM / ML-DSA / SLH-DSA）+ NTRU 系数打包。
 *
 * 规范与长度来源：
 * - FIPS 203 (ML-KEM, 2024-08-13) Table 2：ek/dk/ct 长度；
 *   算法 OID 取 RFC 9935 / NIST CSOR：2.16.840.1.101.3.4.4.{1,2,3}。
 * - FIPS 204 (ML-DSA, 2024-08-13) Table 1：pk/sk/sig 长度；
 *   算法 OID 取 RFC 9881：2.16.840.1.101.3.4.3.{17,18,19}。
 * - FIPS 205 (SLH-DSA, 2024-08-13) Table 2：pk=2n、sk=4n、sig=n+(a+1)kn+d·len·n+h·n；
 *   纯 SLH-DSA OID 取 draft-ietf-lamps-x509-slhdsa-03：sigAlgs 20..31
 *   （SHA2-128s/128f/192s/192f/256s/256f、SHAKE-128s/128f/192s/192f/256s/256f）。
 * - NTRU 参数取 EESS #1 v3.1 / libntru encparams.c 的四套产品式/标准式参数
 *   （ees401ep1 / ees401ep2 / ees439ep1 / ees659ep1，N 与 q=2048）。
 *
 * 诚实边界：
 * - 只有 PEM/DER 里解析到已核对 OID 时，才把它称为标准封装；
 *   裸 hex 一律标为「raw 长度匹配（启发式）」，不冒充 SPKI/PKCS#8。
 * - 没有编造 OID；不在表内的 OID 原样展示并明确说未知。
 * - SLH-DSA 的 SHAKE 参数集只按 FIPS 205 长度识别；本工具现有签名实现只覆盖 SHA2 四档。
 * - NTRU 只做系数 bit-pack/unpack，不实现 CCA-2/SVES 外壳；bit 流口径与现有真参数
 *   NTRU op 的序列化一致（大端位流），是本工具口径，不声称是 EESS 官方逐字节线格式。
 *
 * 红线：core 层零 UI 依赖；纯本地；无随机数。
 * 契约：register({ id, cat, name, desc, params, run, detect })。
 */
import { register } from "./registry.js";

// ============================================================
// 基础工具
// ============================================================

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytesStrict(value, name, allowEmpty = false) {
  let s = String(value == null ? "" : value).trim();
  s = s.replace(/^0x/i, "").replace(/[\s:_-]+/g, "");
  if (s === "") {
    if (allowEmpty) return new Uint8Array(0);
    throw new Error(`${name} 不能为空`);
  }
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error(`${name} 含非 hex 字符`);
  if (s.length % 2 !== 0) throw new Error(`${name} 的 hex 长度为奇数（${s.length}）`);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function b64ToBytes(value) {
  const s = String(value == null ? "" : value).replace(/\s+/g, "");
  if (!s) throw new Error("base64 输入为空");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) {
    throw new Error("base64 输入不合法（只允许 A-Z a-z 0-9 + /，长度须为 4 的倍数）");
  }
  if (typeof globalThis.atob !== "function") {
    throw new Error("当前运行环境没有 atob，无法解析 base64/PEM");
  }
  let bin;
  try {
    bin = globalThis.atob(s);
  } catch {
    throw new Error("base64 解码失败");
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

function looksHex(value) {
  const s = String(value == null ? "" : value).replace(/^0x/i, "").replace(/[\s:_-]+/g, "");
  return s.length > 0 && s.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(s);
}

// ============================================================
// DER / PEM 最小解析器
// ============================================================

function derError(message) {
  const e = new Error(message);
  e.code = "DER_PARSE";
  return e;
}

function readTlv(buf, off, end) {
  if (off >= end) throw derError("DER 截断：缺少 tag");
  const tag = buf[off++];
  if (off >= end) throw derError("DER 截断：缺少长度");
  let len = buf[off++];
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0) throw derError("DER 不允许不定长（0x80）");
    if (n > 4) throw derError(`DER 长度字段过长（${n} 字节）`);
    if (off + n > end) throw derError("DER 截断：长度字段不完整");
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[off++];
  }
  if (off + len > end) throw derError(`DER 长度越界：需要 ${len} 字节，只剩 ${end - off} 字节`);
  return { tag, start: off, end: off + len, next: off + len, value: buf.subarray(off, off + len) };
}

function decodeOid(bytes) {
  if (!bytes.length) throw derError("OID 为空");
  const subs = [];
  let v = 0;
  let have = false;
  for (const b of bytes) {
    v = v * 128 + (b & 0x7f);
    have = true;
    if (!(b & 0x80)) {
      subs.push(v);
      v = 0;
      have = false;
    }
  }
  if (have) throw derError("OID 的最后一个子标识符未结束");
  if (!subs.length) throw derError("OID 没有子标识符");
  const first = subs[0];
  const firstArc = first < 40 ? 0 : first < 80 ? 1 : 2;
  const secondArc = first - 40 * firstArc;
  return [firstArc, secondArc, ...subs.slice(1)].join(".");
}

function algorithmOid(der, alg) {
  if (alg.tag !== 0x30) throw derError("AlgorithmIdentifier 必须是 SEQUENCE");
  const oidTlv = readTlv(der, alg.start, alg.end);
  if (oidTlv.tag !== 0x06) throw derError("AlgorithmIdentifier 的第一个元素必须是 OID");
  return decodeOid(oidTlv.value);
}

function parseSpki(der) {
  const outer = readTlv(der, 0, der.length);
  if (outer.tag !== 0x30) throw derError("SPKI 外层必须是 SEQUENCE");
  if (outer.next !== der.length) throw derError("SPKI 外层之后还有多余字节");
  const alg = readTlv(der, outer.start, outer.end);
  if (alg.tag !== 0x30) throw derError("SPKI 缺少 AlgorithmIdentifier");
  const oid = algorithmOid(der, alg);
  const bit = readTlv(der, alg.next, outer.end);
  if (bit.tag !== 0x03) throw derError("SPKI 缺少 subjectPublicKey BIT STRING");
  if (bit.next !== outer.end) throw derError("SPKI 在 BIT STRING 之后还有多余字段");
  if (!bit.value.length) throw derError("SPKI 的 BIT STRING 为空");
  if (bit.value[0] !== 0) throw derError(`SPKI 的 BIT STRING 有 ${bit.value[0]} 个未用位，PQC 公钥应为整字节`);
  return { type: "spki", oid, payload: bit.value.subarray(1) };
}

function parsePkcs8(der) {
  const outer = readTlv(der, 0, der.length);
  if (outer.tag !== 0x30) throw derError("PKCS#8 外层必须是 SEQUENCE");
  if (outer.next !== der.length) throw derError("PKCS#8 外层之后还有多余字节");
  const version = readTlv(der, outer.start, outer.end);
  if (version.tag !== 0x02) throw derError("PKCS#8 缺少 version INTEGER");
  const alg = readTlv(der, version.next, outer.end);
  if (alg.tag !== 0x30) throw derError("PKCS#8 缺少 privateKeyAlgorithm");
  const oid = algorithmOid(der, alg);
  const pk = readTlv(der, alg.next, outer.end);
  if (pk.tag !== 0x04) throw derError("PKCS#8 缺少 privateKey OCTET STRING");
  // 可选 attributes [0] / publicKey [1]；其余字段一律拒绝，避免误读。
  let off = pk.next;
  while (off < outer.end) {
    const extra = readTlv(der, off, outer.end);
    if (extra.tag !== 0xa0 && extra.tag !== 0x81) {
      throw derError(`PKCS#8 出现未预期的可选字段 tag=0x${extra.tag.toString(16)}`);
    }
    off = extra.next;
  }
  return { type: "pkcs8", oid, payload: pk.value };
}

/** 解析 DER 封装；不是 SPKI/PKCS#8 时返回 null，结构损坏时抛错。 */
function parseDerEnvelope(der) {
  if (!der.length) throw derError("DER 输入为空");
  const outer = readTlv(der, 0, der.length);
  if (outer.tag !== 0x30) throw derError("DER 顶层不是 SEQUENCE");
  const first = readTlv(der, outer.start, outer.end);
  if (first.tag === 0x02) return parsePkcs8(der);
  if (first.tag === 0x30) {
    const second = readTlv(der, first.next, outer.end);
    if (second.tag === 0x03) return parseSpki(der);
    if (second.tag === 0x30) {
      const third = readTlv(der, second.next, outer.end);
      if (third.tag === 0x03) {
        const e = new Error("输入看起来是 X.509 证书；本 op 不解析证书，请先提取其中的 SPKI/PKCS#8 再粘贴");
        e.code = "CERT";
        throw e;
      }
    }
  }
  return null;
}

function parsePem(text) {
  const m = /-----BEGIN ([A-Z0-9 _-]+)-----([\s\S]*?)-----END \1-----/.exec(text);
  if (!m) throw new Error("PEM 头尾不匹配（缺少 -----BEGIN/END-----）");
  const label = m[1].trim().toUpperCase();
  const der = b64ToBytes(m[2]);
  if (label === "PUBLIC KEY") {
    const env = parseSpki(der);
    return { ...env, pemLabel: label };
  }
  if (label === "PRIVATE KEY") {
    const env = parsePkcs8(der);
    return { ...env, pemLabel: label };
  }
  if (label === "ENCRYPTED PRIVATE KEY") {
    throw new Error("这是加密的 PKCS#8（ENCRYPTED PRIVATE KEY），本 op 不做口令解密");
  }
  if (label === "CERTIFICATE" || label === "X509 CERTIFICATE") {
    throw new Error("这是 X.509 证书；本 op 不解析证书，请先提取 SPKI 再粘贴");
  }
  throw new Error(`不支持的 PEM 标签「${label}」；只支持 PUBLIC KEY / PRIVATE KEY`);
}

// ============================================================
// PQC 参数集与长度表
// ============================================================

const KIND_LABEL = { pk: "公钥", sk: "私钥", ct: "KEM 密文", sig: "签名" };

const MLKEM_SETS = [
  { set: "512", display: "ML-KEM-512", oid: "2.16.840.1.101.3.4.4.1", pk: 800, sk: 1632, ct: 768, seedSk: 64 },
  { set: "768", display: "ML-KEM-768", oid: "2.16.840.1.101.3.4.4.2", pk: 1184, sk: 2400, ct: 1088, seedSk: 64 },
  { set: "1024", display: "ML-KEM-1024", oid: "2.16.840.1.101.3.4.4.3", pk: 1568, sk: 3168, ct: 1568, seedSk: 64 },
];

const MLDSA_SETS = [
  { set: "44", display: "ML-DSA-44", oid: "2.16.840.1.101.3.4.3.17", pk: 1312, sk: 2560, sig: 2420, seedSk: 32 },
  { set: "65", display: "ML-DSA-65", oid: "2.16.840.1.101.3.4.3.18", pk: 1952, sk: 4032, sig: 3309, seedSk: 32 },
  { set: "87", display: "ML-DSA-87", oid: "2.16.840.1.101.3.4.3.19", pk: 2592, sk: 4896, sig: 4627, seedSk: 32 },
];

// FIPS 205 Table 2：n, h, d, a(FORS 高度), k(FORS 树数)，纯 SLH-DSA OID 弧 20..31。
const SLH_SPECS = [
  { hash: "SHA2", label: "128s", arc: 20, n: 16, h: 63, d: 7, a: 12, k: 14 },
  { hash: "SHA2", label: "128f", arc: 21, n: 16, h: 66, d: 22, a: 6, k: 33 },
  { hash: "SHA2", label: "192s", arc: 22, n: 24, h: 63, d: 7, a: 14, k: 17 },
  { hash: "SHA2", label: "192f", arc: 23, n: 24, h: 66, d: 22, a: 8, k: 33 },
  { hash: "SHA2", label: "256s", arc: 24, n: 32, h: 64, d: 8, a: 14, k: 22 },
  { hash: "SHA2", label: "256f", arc: 25, n: 32, h: 68, d: 17, a: 9, k: 35 },
  { hash: "SHAKE", label: "128s", arc: 26, n: 16, h: 63, d: 7, a: 12, k: 14 },
  { hash: "SHAKE", label: "128f", arc: 27, n: 16, h: 66, d: 22, a: 6, k: 33 },
  { hash: "SHAKE", label: "192s", arc: 28, n: 24, h: 63, d: 7, a: 14, k: 17 },
  { hash: "SHAKE", label: "192f", arc: 29, n: 24, h: 66, d: 22, a: 8, k: 33 },
  { hash: "SHAKE", label: "256s", arc: 30, n: 32, h: 64, d: 8, a: 14, k: 22 },
  { hash: "SHAKE", label: "256f", arc: 31, n: 32, h: 68, d: 17, a: 9, k: 35 },
];

/** FIPS 205 签名长度：n + (a+1)kn + d·(wotsLen·n) + h·n，wotsLen=2n+3（w=16）。 */
function slhSigLen(s) {
  const wotsLen = 2 * s.n + 3;
  return s.n + (s.a + 1) * s.k * s.n + s.d * wotsLen * s.n + s.h * s.n;
}

const SLH_SETS = SLH_SPECS.map((s) => ({
  set: `${s.hash}-${s.label}`,
  display: `SLH-DSA-${s.hash}-${s.label}`,
  oid: `2.16.840.1.101.3.4.3.${s.arc}`,
  fips: "FIPS 205",
  pk: 2 * s.n,
  sk: 4 * s.n,
  sig: slhSigLen(s),
  seedSk: 3 * s.n,
  n: s.n,
}));

const PQC_SETS = [
  ...MLKEM_SETS.map((s) => ({ ...s, scheme: "ML-KEM", fips: "FIPS 203", kinds: { pk: s.pk, sk: s.sk, ct: s.ct } })),
  ...MLDSA_SETS.map((s) => ({ ...s, scheme: "ML-DSA", fips: "FIPS 204", kinds: { pk: s.pk, sk: s.sk, sig: s.sig } })),
  ...SLH_SETS.map((s) => ({ ...s, scheme: "SLH-DSA", kinds: { pk: s.pk, sk: s.sk, sig: s.sig } })),
];

const PQC_CANDIDATES = [];
const OID_INDEX = new Map();
for (const set of PQC_SETS) {
  OID_INDEX.set(set.oid, set);
  for (const [kind, bytes] of Object.entries(set.kinds)) {
    PQC_CANDIDATES.push({ scheme: set.scheme, display: set.display, set, kind, bytes, oid: set.oid });
  }
}

const KIND_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "pk", label: "公钥 pk/ek" },
  { value: "sk", label: "私钥 sk/dk" },
  { value: "ct", label: "KEM 密文 ct" },
  { value: "sig", label: "签名 σ" },
];
const SCHEME_OPTIONS = [
  { value: "auto", label: "自动" },
  { value: "ML-KEM", label: "ML-KEM" },
  { value: "ML-DSA", label: "ML-DSA" },
  { value: "SLH-DSA", label: "SLH-DSA" },
];
const FORMAT_OPTIONS = [
  { value: "auto", label: "自动（PEM / DER / raw hex）" },
  { value: "pem", label: "PEM" },
  { value: "der", label: "DER（hex 或 base64）" },
  { value: "hex", label: "强制 raw hex（不做 OID 解析）" },
  { value: "base64", label: "base64（先试 DER，再退回 raw）" },
];

function classifyByLength(len, kindFilter = "auto", schemeFilter = "auto") {
  return PQC_CANDIDATES.filter((c) =>
    c.bytes === len &&
    (kindFilter === "auto" || c.kind === kindFilter) &&
    (schemeFilter === "auto" || c.scheme === schemeFilter)
  );
}

// ============================================================
// blob 解析
// ============================================================

function readInput(text, format) {
  const s = String(text == null ? "" : text).trim();
  if (!s) throw new Error("请输入 PQC blob（PEM / DER hex / base64 / raw hex）");

  if (format === "pem" || (format === "auto" && /-----BEGIN/.test(s))) {
    const env = parsePem(s);
    return {
      mode: "envelope",
      envelope: env,
      bytes: env.payload,
      source: `PEM「${env.pemLabel}」→ ${env.type === "spki" ? "SPKI DER" : "PKCS#8 DER"}`,
    };
  }

  if (format === "der") {
    const bytes = looksHex(s) ? hexToBytesStrict(s, "DER") : b64ToBytes(s);
    let env;
    try {
      env = parseDerEnvelope(bytes);
    } catch (e) {
      if (e.code === "CERT") throw e;
      throw new Error(`DER 解析失败：${e.message}`);
    }
    if (!env) throw new Error("DER 结构不是 SPKI/PKCS#8（顶层 SEQUENCE 的字段模式不匹配）");
    return {
      mode: "envelope",
      envelope: env,
      bytes: env.payload,
      source: env.type === "spki" ? "SPKI DER" : "PKCS#8 DER",
    };
  }

  if (format === "hex") {
    const bytes = hexToBytesStrict(s, "raw hex");
    return { mode: "raw", bytes, source: "强制 raw hex（无 OID/封装解析）" };
  }

  if (format === "base64") {
    const bytes = b64ToBytes(s);
    try {
      const env = parseDerEnvelope(bytes);
      if (env) {
        return {
          mode: "envelope",
          envelope: env,
          bytes: env.payload,
          source: `base64 → ${env.type === "spki" ? "SPKI DER" : "PKCS#8 DER"}`,
        };
      }
    } catch (e) {
      if (e.code === "CERT") throw e;
    }
    return { mode: "raw", bytes, source: "base64 解码后的 raw 字节（无 OID/封装）" };
  }

  // auto：PEM 已在上面处理；先按 hex，再按 base64。
  if (looksHex(s)) {
    const bytes = hexToBytesStrict(s, "raw hex");
    try {
      const env = parseDerEnvelope(bytes);
      if (env) {
        return {
          mode: "envelope",
          envelope: env,
          bytes: env.payload,
          source: `raw hex → ${env.type === "spki" ? "SPKI DER" : "PKCS#8 DER"}`,
        };
      }
    } catch (e) {
      if (e.code === "CERT") throw e;
    }
    return { mode: "raw", bytes, source: "raw 十六进制字节（未解析到 SPKI/PKCS#8 封装）" };
  }

  const bytes = b64ToBytes(s);
  try {
    const env = parseDerEnvelope(bytes);
    if (env) {
      return {
        mode: "envelope",
        envelope: env,
        bytes: env.payload,
        source: `base64 → ${env.type === "spki" ? "SPKI DER" : "PKCS#8 DER"}`,
      };
    }
  } catch (e) {
    if (e.code === "CERT") throw e;
  }
  return { mode: "raw", bytes, source: "base64 解码后的 raw 字节（无 OID/封装）" };
}

/**
 * 解析 PQC blob，返回结构化结果。op 层只负责排版。
 * params: { format, kind, scheme }
 */
export function parsePqcBlob(text, params = {}) {
  const format = params.format || "auto";
  const kindFilter = params.kind || "auto";
  const schemeFilter = params.scheme || "auto";
  if (!["auto", "pem", "der", "hex", "base64"].includes(format)) {
    throw new Error(`未知输入格式「${format}」；可选 auto/pem/der/hex/base64`);
  }
  if (!["auto", "pk", "sk", "ct", "sig"].includes(kindFilter)) {
    throw new Error(`未知类型筛选「${kindFilter}」；可选 auto/pk/sk/ct/sig`);
  }
  if (!["auto", "ML-KEM", "ML-DSA", "SLH-DSA"].includes(schemeFilter)) {
    throw new Error(`未知方案筛选「${schemeFilter}」；可选 auto/ML-KEM/ML-DSA/SLH-DSA`);
  }
  const input = readInput(text, format);

  const r = {
    source: input.source,
    format,
    kindFilter,
    schemeFilter,
    oid: null,
    set: null,
    kind: null,
    actual: input.bytes.length,
    expected: null,
    lengthOk: null,
    identified: false,
    notes: [],
    matches: [],
    ambiguous: false,
  };

  if (input.mode === "envelope") {
    const env = input.envelope;
    r.oid = env.oid;
    r.kind = env.type === "spki" ? "pk" : "sk";
    const set = OID_INDEX.get(env.oid);
    if (!set) {
      r.notes.push("OID 不在已核对的 NIST PQC 算法 OID 表内；下面只做长度参考，不对标准格式作断言。");
      r.matches = classifyByLength(r.actual, "auto", schemeFilter);
      r.ambiguous = r.matches.length > 1;
      return r;
    }
    if (schemeFilter !== "auto" && set.scheme !== schemeFilter) {
      throw new Error(`OID 识别为 ${set.scheme}，与 scheme 筛选「${schemeFilter}」不符`);
    }
    r.set = set;
    r.identified = true;
    if (set.scheme === "SLH-DSA") {
      if (String(set.set).startsWith("SHAKE")) {
        r.notes.push("该 SHAKE 参数集只按 FIPS 205 长度识别；本工具现有 SLH-DSA 签名实现覆盖 SHA2 四档，不包含 SHAKE。");
      }
      if (/(192f|256f)$/.test(String(set.set))) {
        r.notes.push("该 192f/256f 参数集只按 FIPS 205 长度识别；本工具现有 SLH-DSA 签名实现覆盖 128s/128f/192s/256s。");
      }
    }
    if (kindFilter !== "auto" && kindFilter !== r.kind) {
      r.notes.push(`kind 筛选为「${KIND_LABEL[kindFilter] || kindFilter}」，但封装类型是「${KIND_LABEL[r.kind]}」；已按封装类型解析。`);
    }
    r.expected = set.kinds[r.kind];
    r.lengthOk = r.actual === r.expected;
    if (!r.lengthOk) {
      if (r.kind === "sk" && set.seedSk && r.actual === set.seedSk) {
        r.notes.push(`载荷 ${r.actual} B 等于该参数集的 seed 形态（${set.seedSk} B）；OID 已识别，但未按 expanded 私钥的 ${r.expected} B 校验。`);
      } else {
        r.notes.push(`载荷 ${r.actual} B 与 ${set.display} ${KIND_LABEL[r.kind]} 的期望长度 ${r.expected} B 不符。`);
      }
    }
    return r;
  }

  r.matches = classifyByLength(r.actual, kindFilter, schemeFilter);
  r.ambiguous = r.matches.length > 1;
  r.identified = r.matches.length === 1;
  if (r.matches.length === 0) {
    r.notes.push("长度不在本 op 的已知 PQC 长度表内；不声称它是任何标准格式。");
  } else if (r.ambiguous) {
    r.notes.push("同一长度对应多个类型/参数集，仅凭长度不能唯一断言。");
  }
  return r;
}

function formatPqcReport(r) {
  const lines = ["PQC blob 解析", `来源: ${r.source}`];
  if (r.oid) {
    lines.push(`OID: ${r.oid}${r.set ? "（已核对的 NIST 算法 OID）" : "（不在已核对表内，未知）"}`);
  }
  if (r.set) {
    lines.push(`识别: ${r.set.display} ${KIND_LABEL[r.kind]}（${r.set.fips}）`);
    lines.push(`载荷长度: ${r.actual} B；期望: ${r.expected} B ${r.lengthOk ? "✓" : "✗"}`);
  } else {
    lines.push(`载荷/字节长度: ${r.actual} B`);
    if (r.oid && r.kind) {
      lines.push(`封装类型: ${KIND_LABEL[r.kind]}（DER 已解析，但 OID 未收录）`);
    }
    if (r.matches.length) {
      lines.push(`长度候选（${r.matches.length}）:`);
      r.matches.forEach((m, i) => lines.push(`  ${i + 1}. ${m.display} ${KIND_LABEL[m.kind]} — ${m.bytes} B（${m.scheme}）`));
      if (r.ambiguous) {
        lines.push("结论: raw 长度歧义，不能唯一断言；请提供 OID/PEM/DER，或用 kind/scheme 过滤。");
      } else {
        lines.push("结论: 唯一 raw 长度匹配；但这只是长度启发式，不是标准封装/OID 的证明。");
      }
    } else {
      lines.push("结论: raw 长度未识别：不在已知表内，不声称是任何 PQC 标准格式。");
    }
  }
  for (const note of r.notes) lines.push(`注意: ${note}`);
  return lines.join("\n");
}

register({
  id: "pqcBlobParse",
  cat: "asym",
  name: "PQC blob 解析（ML-KEM/ML-DSA/SLH-DSA）",
  desc: "识别 ML-KEM-512/768/1024、ML-DSA-44/65/87、SLH-DSA（FIPS 205 六档 × SHA2/SHAKE）的公钥/私钥/KEM 密文/签名长度。优先解析 PEM 的 SPKI/PKCS#8 DER 并核对 NIST 算法 OID；没有 OID 的裸字节只报「raw 长度匹配」并列出歧义，不冒充标准格式。支持自动/强制 raw hex/强制 DER 等模式；X.509 证书与加密 PKCS#8 明确拒绝。",
  params: [
    { key: "format", label: "输入格式", type: "select", default: "auto", options: FORMAT_OPTIONS },
    { key: "kind", label: "类型筛选", type: "select", default: "auto", options: KIND_OPTIONS },
    { key: "scheme", label: "方案筛选", type: "select", default: "auto", options: SCHEME_OPTIONS },
  ],
  run: (text, p = {}) => formatPqcReport(parsePqcBlob(text, p)),
  detect: (t) => {
    const s = String(t == null ? "" : t).trim();
    if (/-----BEGIN (PUBLIC|PRIVATE) KEY-----/.test(s)) return 0.85;
    if (looksHex(s)) {
      const len = s.replace(/^0x/i, "").replace(/[\s:_-]+/g, "").length / 2;
      if (PQC_CANDIDATES.some((c) => c.bytes === len)) return 0.45;
    }
    return 0;
  },
});

// ============================================================
// NTRU 系数打包（EESS 参数，工具口径）
// ============================================================

const NTRU_SETS = [
  { name: "ees401ep1", N: 401, q: 2048, prod: null, df: 113, dg: 133, dm0: 113 },
  { name: "ees401ep2", N: 401, q: 2048, prod: [8, 8, 6], df: null, dg: 133, dm0: 101 },
  { name: "ees439ep1", N: 439, q: 2048, prod: [9, 8, 5], df: null, dg: 146, dm0: 112 },
  { name: "ees659ep1", N: 659, q: 2048, prod: null, df: 38, dg: 219, dm0: 38 },
];

function getNtruSet(name) {
  const s = NTRU_SETS.find((x) => x.name === String(name || "").trim());
  if (!s) throw new Error(`未知 NTRU 参数集「${name}」；可选 ${NTRU_SETS.map((x) => x.name).join(" / ")}`);
  return s;
}

function fieldBits(field) {
  if (field === "q") return 11;
  if (field === "ternary") return 2;
  throw new Error(`未知系数域「${field}」；可选 q（11 bit）或 ternary（2 bit）`);
}

function parseCoeffList(text, set, field) {
  let s = String(text == null ? "" : text).replace(/[\[\](){}]/g, " ").trim();
  if (!s) throw new Error("请输入系数列表（空白/逗号分隔的整数）");
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  if (parts.length !== set.N) {
    throw new Error(`系数个数不符：${set.name} 需要 ${set.N} 个，当前 ${parts.length} 个`);
  }
  const out = new Array(set.N);
  for (let i = 0; i < parts.length; i++) {
    if (!/^[+-]?\d+$/.test(parts[i])) throw new Error(`第 ${i + 1} 个系数不是整数：${parts[i]}`);
    const v = Number(parts[i]);
    if (!Number.isSafeInteger(v)) throw new Error(`第 ${i + 1} 个系数超出安全整数范围`);
    if (field === "q") {
      if (v < 0 || v >= set.q) throw new Error(`第 ${i + 1} 个 q 系数 ${v} 越界（应为 0..${set.q - 1}）`);
    } else if (v !== -1 && v !== 0 && v !== 1) {
      throw new Error(`第 ${i + 1} 个三元系数 ${v} 非法（只允许 -1/0/1）`);
    }
    out[i] = v;
  }
  return out;
}

/** 大端位流打包：每系数 bits 位，三元的 -1 编码为 2（10）。 */
function packCoefs(coeffs, bits) {
  if (bits !== 2 && bits !== 11) throw new Error(`内部错误：bits=${bits}`);
  const max = (1 << bits) - 1;
  const out = [];
  let cur = 0;
  let nbits = 0;
  for (let i = 0; i < coeffs.length; i++) {
    let v = coeffs[i];
    if (bits === 2) {
      if (v === -1) v = 2;
      if (v !== 0 && v !== 1 && v !== 2) throw new Error(`第 ${i + 1} 个系数不能按 2 bit 编码：${coeffs[i]}`);
    } else if (!Number.isInteger(v) || v < 0 || v > max) {
      throw new Error(`第 ${i + 1} 个系数不能按 11 bit 编码：${coeffs[i]}`);
    }
    cur = (cur << bits) | v;
    nbits += bits;
    while (nbits >= 8) {
      out.push((cur >>> (nbits - 8)) & 0xff);
      nbits -= 8;
    }
  }
  if (nbits > 0) out.push((cur << (8 - nbits)) & 0xff);
  return new Uint8Array(out);
}

/** 大端位流解包；要求尾部填充位为 0，三元编码 11 判非法。 */
function unpackCoefs(bytes, count, bits) {
  if (bits !== 2 && bits !== 11) throw new Error(`内部错误：bits=${bits}`);
  const mask = (1 << bits) - 1;
  const vals = [];
  let cur = 0;
  let nbits = 0;
  for (const b of bytes) {
    cur = (cur << 8) | b;
    nbits += 8;
    while (nbits >= bits && vals.length < count) {
      vals.push((cur >>> (nbits - bits)) & mask);
      nbits -= bits;
    }
    if (nbits > 0) cur &= (1 << nbits) - 1;
    else cur = 0;
  }
  if (vals.length < count) throw new Error(`系数流不足：需要 ${count} 个，只解出 ${vals.length} 个`);
  if (nbits > 0 && (cur & ((1 << nbits) - 1)) !== 0) {
    throw new Error("尾部填充位非 0：字节流不是本工具的规范打包（或数据被截断/拼接）");
  }
  if (bits === 2) {
    return vals.map((v, i) => {
      if (v === 0) return 0;
      if (v === 1) return 1;
      if (v === 2) return -1;
      throw new Error(`第 ${i + 1} 个三元系数编码为 11（非法）`);
    });
  }
  return vals;
}

/**
 * 系数数组 → 字节（可带 1 字节参数集 tag，tag = 参数集序号+1，与真参数 NTRU op 一致）。
 * opts: { set, field, tag }
 */
export function ntruPack(coeffs, opts = {}) {
  const set = getNtruSet(opts.set);
  const field = opts.field || "q";
  const bits = fieldBits(field);
  if (!Array.isArray(coeffs) || coeffs.length !== set.N) {
    throw new Error(`系数数组长度必须为 ${set.N}（${set.name}），当前 ${Array.isArray(coeffs) ? coeffs.length : "非数组"}`);
  }
  for (let i = 0; i < coeffs.length; i++) {
    const v = coeffs[i];
    if (field === "q") {
      if (!Number.isInteger(v) || v < 0 || v >= set.q) {
        throw new Error(`第 ${i + 1} 个 q 系数 ${v} 越界（应为 0..${set.q - 1}）`);
      }
    } else if (v !== -1 && v !== 0 && v !== 1) {
      throw new Error(`第 ${i + 1} 个三元系数 ${v} 非法（只允许 -1/0/1）`);
    }
  }
  const body = packCoefs(coeffs, bits);
  if (!opts.tag) return body;
  const out = new Uint8Array(body.length + 1);
  out[0] = NTRU_SETS.indexOf(set) + 1;
  out.set(body, 1);
  return out;
}

/**
 * 字节 → 系数数组。opts: { set, field, tag }
 * 要求长度精确、tag 匹配、尾部填充位为 0。
 */
export function ntruUnpack(bytes, opts = {}) {
  const set = getNtruSet(opts.set);
  const field = opts.field || "q";
  const bits = fieldBits(field);
  const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let body = buf;
  if (opts.tag) {
    if (!buf.length) throw new Error("输入为空，缺少参数集 tag 字节");
    const bodyLen = Math.ceil((set.N * bits) / 8);
    if (buf.length === bodyLen) {
      throw new Error(`缺少参数集 tag 字节：当前 ${buf.length} B 正好是无 tag 形态，带 tag 应为 ${bodyLen + 1} B`);
    }
    const want = NTRU_SETS.indexOf(set) + 1;
    if (buf[0] !== want) {
      throw new Error(`参数集 tag 不符：字节为 ${buf[0]}，${set.name} 期望 ${want}`);
    }
    body = buf.subarray(1);
  }
  const expected = Math.ceil((set.N * bits) / 8);
  if (body.length !== expected) {
    throw new Error(`字节数不符：${set.name} ${field} 应为 ${expected} B，当前 ${body.length} B`);
  }
  return {
    set,
    field,
    bits,
    bytes: buf.length,
    coeffs: unpackCoefs(body, set.N, bits),
  };
}

const NTRU_SET_OPTIONS = NTRU_SETS.map((s) => ({ value: s.name, label: `${s.name}（N=${s.N}, q=${s.q}）` }));
const NTRU_FIELD_OPTIONS = [
  { value: "q", label: "q 系数（11 bit/系数，公钥/密文）" },
  { value: "ternary", label: "三元系数（2 bit/系数，私钥 F）" },
];

register({
  id: "ntruPack",
  cat: "asym",
  name: "NTRU 系数打包",
  desc: "把 NTRU（EESS #1 参数：ees401ep1/ees401ep2/ees439ep1/ees659ep1，N=401/439/659，q=2048）的一维系数数组按固定位宽打成 hex：q 系数 11 bit、三元系数 2 bit（-1 编码为 10），大端位流，尾部补 0；可选 1 字节参数集 tag。只是系数序列化，不实现 CCA-2/SVES。",
  params: [
    { key: "set", label: "参数集", type: "select", default: "ees401ep2", options: NTRU_SET_OPTIONS },
    { key: "field", label: "系数域", type: "select", default: "q", options: NTRU_FIELD_OPTIONS },
    { key: "tag", label: "带参数集 tag（1 字节）", type: "bool", default: false },
  ],
  run: (text, p = {}) => {
    const set = getNtruSet(p.set);
    const field = p.field || "q";
    const coeffs = parseCoeffList(text, set, field);
    return bytesToHex(ntruPack(coeffs, { set: set.name, field, tag: p.tag === true }));
  },
  detect: (t) => {
    const parts = String(t == null ? "" : t).replace(/[\[\](){}]/g, " ").trim().split(/[\s,;]+/).filter(Boolean);
    if (![401, 439, 659].includes(parts.length)) return 0;
    for (const s of parts) {
      if (!/^[+-]?\d+$/.test(s)) return 0;
      const v = Number(s);
      if (!Number.isSafeInteger(v) || v < -1 || v > 2047) return 0;
    }
    return 0.35;
  },
});

register({
  id: "ntruUnpack",
  cat: "asym",
  name: "NTRU 系数解包",
  desc: "NTRU 系数打包的逆操作：按参数集与系数域（11 bit q 系数 / 2 bit 三元系数）把 hex 还原为 N 个系数，校验精确长度、参数集 tag 与尾部填充位；遇到非法三元编码 11 或截断/多余字节直接报错。",
  params: [
    { key: "set", label: "参数集", type: "select", default: "ees401ep2", options: NTRU_SET_OPTIONS },
    { key: "field", label: "系数域", type: "select", default: "q", options: NTRU_FIELD_OPTIONS },
    { key: "tag", label: "带参数集 tag（1 字节）", type: "bool", default: false },
  ],
  run: (text, p = {}) => {
    const r = ntruUnpack(hexToBytesStrict(text, "系数 hex"), {
      set: p.set,
      field: p.field || "q",
      tag: p.tag === true,
    });
    const lines = [
      `参数集: ${r.set.name}（N=${r.set.N}, q=${r.set.q}, p=3${r.set.prod ? `，产品式 d=${r.set.prod.join("/")}` : `，标准式 df=${r.set.df}`}）`,
      `系数域: ${r.field}（${r.bits} bit/系数）；输入字节: ${r.bytes} B`,
      `系数（${r.coeffs.length}）:`,
    ];
    for (let i = 0; i < r.coeffs.length; i += 32) {
      lines.push(r.coeffs.slice(i, i + 32).join(" "));
    }
    return lines.join("\n");
  },
  detect: (t) => {
    if (!looksHex(t)) return 0;
    const len = String(t).trim().replace(/^0x/i, "").replace(/[\s:_-]+/g, "").length / 2;
    for (const set of NTRU_SETS) {
      for (const bits of [11, 2]) {
        const base = Math.ceil((set.N * bits) / 8);
        if (len === base || len === base + 1) return 0.25;
      }
    }
    return 0;
  },
});
