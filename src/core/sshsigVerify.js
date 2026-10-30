/*
 * sshsigVerify.js — OpenSSH SSHSIG 签名验签（PROTOCOL.sshsig v1）。
 *
 * 输入：
 *   - armored：-----BEGIN SSH SIGNATURE----- … -----END SSH SIGNATURE-----
 *   - binary：以 6 字节 "SSHSIG" 开头的原始结构（文件上传 / hex）
 * 结构（PROTOCOL.sshsig）：
 *   byte[6] magic = "SSHSIG"
 *   uint32  version = 1
 *   string  publickey        （SSH wire public key blob）
 *   string  namespace
 *   string  reserved
 *   string  hash_algorithm   （"sha256" / "sha512"，用于 H(message)）
 *   string  signature        （string signature_key_type + string signature_data）
 *
 * 验签对象：
 *   "SSHSIG" || string(namespace) || string(reserved) ||
 *   string(hash_algorithm) || string(H(message))
 *
 * 支持：
 *   - ssh-ed25519（Ed25519，sig type ssh-ed25519）
 *   - ssh-rsa（RSA PKCS#1 v1.5，sig type rsa-sha2-256 / rsa-sha2-512）
 *   - ecdsa-sha2-nistp256 / nistp384 / nistp521（ECDSA，签名摘要按曲线）
 * 明确不支持：
 *   - ssh-rsa（SHA-1）签名、ssh-dss / DSA、sk-* 安全密钥、*-cert-v01 证书密钥、
 *     未知 key/signature 类型、version ≠ 1、hash_algorithm 非 sha256/sha512
 *   - 读取私钥、allowed_signers 多签名者策略、网络访问
 *
 * 信任模型：SSHSIG 内嵌公钥只能证明「签名由该密钥生成」；只有调用方提供期望公钥
 * 或 SHA-256 指纹并与内嵌公钥一致时，才判定身份 ANCHORED。未提供期望公钥时结论
 * PASS + UNTRUSTED，不把内嵌公钥冒充可信身份。
 */
import { register } from "./registry.js";
import { CURVES, ecdsaVerifyRaw, hashToE, parsePoint } from "./ecdsa.js";
import { verify as ed25519Verify } from "./ed25519.js";

const CODE = Object.freeze({
  FORMAT: "FORMAT_ERROR",
  UNSUPPORTED: "UNSUPPORTED_ALGORITHM",
  VERSION: "UNSUPPORTED_VERSION",
  SIG_TYPE: "ALGORITHM_MISMATCH",
  SIGNATURE: "SIGNATURE_INVALID",
  KEY: "KEY_MISMATCH",
  NAMESPACE: "NAMESPACE_MISMATCH",
  NO_SIGNATURE: "NO_SIGNATURE",
});

class SshsigVerifyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "SshsigVerifyError";
    this.code = code;
  }
}

const fail = (code, message) => new SshsigVerifyError(code, message);
const MAGIC = new TextEncoder().encode("SSHSIG");

// ============================================================
// 字节 / base64 / SSH wire 工具
// ============================================================
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

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
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

function concatBytes(...parts) {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function ascii(b) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return s;
}

function base64Decode(body, label) {
  const clean = String(body || "").replace(/\s+/g, "");
  if (!clean) throw fail(CODE.FORMAT, `${label} 的 base64 内容为空`);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(clean)) {
    throw fail(CODE.FORMAT, `${label} 含非 base64 字符`);
  }
  if (clean.length % 4 === 1) throw fail(CODE.FORMAT, `${label} 的 base64 长度非法（余 1 字符）`);
  if (clean.includes("=") && clean.length % 4 !== 0) throw fail(CODE.FORMAT, `${label} 的 base64 padding 位置非法`);
  const data = clean.replace(/=+$/, "");
  const out = [];
  let buf = 0, bits = 0;
  for (const ch of data) {
    const v = B64.indexOf(ch);
    if (v < 0) throw fail(CODE.FORMAT, `${label} 含非 base64 字符`);
    buf = (buf << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buf >> bits) & 0xff);
    }
  }
  if (bits > 0 && (buf & ((1 << bits) - 1)) !== 0) {
    throw fail(CODE.FORMAT, `${label} 的 base64 尾部填充位非零`);
  }
  return Uint8Array.from(out);
}

function base64Encode(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | ((b === undefined ? 0 : b) >> 4)];
    out += b === undefined ? "=" : B64[((b & 15) << 2) | ((c === undefined ? 0 : c) >> 6)];
    out += c === undefined ? "=" : B64[c & 63];
  }
  return out;
}

function base64EncodeNoPad(bytes) {
  return base64Encode(bytes).replace(/=+$/, "");
}

function u32(v) {
  return Uint8Array.of((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
}

function sshString(bytes) {
  return concatBytes(u32(bytes.length), bytes);
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
  if (x !== 0n) throw fail(CODE.SIGNATURE, "RSA 签名整数超出模数字节宽度");
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

async function digestBytes(name, bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (!subtle) throw fail(CODE.FORMAT, "当前环境不支持 WebCrypto，无法计算摘要");
  return new Uint8Array(await subtle.digest(name, bytes));
}

class SshReader {
  constructor(bytes, label) {
    this.b = bytes;
    this.off = 0;
    this.label = label;
  }
  need(n, what) {
    if (this.off + n > this.b.length) {
      throw fail(CODE.FORMAT, `${this.label}：${what} 被截断（偏移 ${this.off}，需要 ${n} 字节，剩余 ${this.b.length - this.off}）`);
    }
  }
  take(n, what) {
    this.need(n, what);
    const v = this.b.subarray(this.off, this.off + n);
    this.off += n;
    return v;
  }
  u32(what) {
    this.need(4, what);
    const v = ((this.b[this.off] << 24) | (this.b[this.off + 1] << 16) |
      (this.b[this.off + 2] << 8) | this.b[this.off + 3]) >>> 0;
    this.off += 4;
    return v;
  }
  string(what) {
    const n = this.u32(`${what} 的长度`);
    this.need(n, what);
    const v = this.b.subarray(this.off, this.off + n);
    this.off += n;
    return v;
  }
  mpint(what) {
    const raw = this.string(what);
    if (!raw.length) return 0n;
    if (raw[0] & 0x80) throw fail(CODE.FORMAT, `${what} 是负 mpint（SSH 密钥/签名要求非负）`);
    if (raw.length > 1 && raw[0] === 0 && (raw[1] & 0x80) === 0) {
      throw fail(CODE.FORMAT, `${what} 的 mpint 含冗余前导 0（非最短编码）`);
    }
    let i = 0;
    while (i < raw.length - 1 && raw[i] === 0) i++;
    return bytesToBigInt(raw.subarray(i));
  }
  end(what) {
    if (this.off !== this.b.length) {
      throw fail(CODE.FORMAT, `${this.label}：${what} 后仍有 ${this.b.length - this.off} 字节尾随数据`);
    }
  }
}

// ============================================================
// SSHSIG / 公钥 / 签名结构解析
// ============================================================
const EC_TYPES = {
  "ecdsa-sha2-nistp256": { curveName: "nistp256", curveId: "p256", curve: CURVES.p256, hash: "SHA-256", label: "ECDSA P-256" },
  "ecdsa-sha2-nistp384": { curveName: "nistp384", curveId: "p384", curve: CURVES.p384, hash: "SHA-384", label: "ECDSA P-384" },
  "ecdsa-sha2-nistp521": { curveName: "nistp521", curveId: "p521", curve: CURVES.p521, hash: "SHA-512", label: "ECDSA P-521" },
};

export function parsePublicKeyBlob(blob, label = "SSHSIG.publickey") {
  const r = new SshReader(blob, label);
  const type = ascii(r.string("public key type"));
  let key;
  if (type === "ssh-ed25519") {
    const pk = r.string("Ed25519 public key");
    if (pk.length !== 32) throw fail(CODE.FORMAT, `${label}：Ed25519 公钥必须 32 字节，实际 ${pk.length}`);
    key = {
      kind: "ed25519",
      type,
      label: "ssh-ed25519（Ed25519，32 字节公钥）",
      short: "Ed25519",
      pk,
    };
  } else if (type === "ssh-rsa") {
    const e = r.mpint("RSA public exponent");
    const n = r.mpint("RSA modulus");
    if (e <= 0n || (e & 1n) === 0n) throw fail(CODE.FORMAT, `${label}：RSA publicExponent 必须为正奇数`);
    if (n <= 0n || (n & 1n) === 0n) throw fail(CODE.FORMAT, `${label}：RSA modulus 必须为正奇数`);
    const bits = bitLength(n);
    key = {
      kind: "rsa",
      type,
      label: `ssh-rsa（RSA-${bits}，e=${e.toString()}）`,
      short: `RSA-${bits}`,
      e, n, bits,
    };
  } else if (EC_TYPES[type]) {
    const info = EC_TYPES[type];
    const curveName = ascii(r.string("ECDSA curve name"));
    if (curveName !== info.curveName) {
      throw fail(CODE.FORMAT, `${label}：密钥类型 ${type} 与曲线名 ${curveName} 不一致`);
    }
    const point = r.string("ECDSA public point");
    let Q;
    try {
      Q = parsePoint(bytesToHex(point), info.curve, "ECDSA 公钥");
    } catch (e) {
      throw fail(CODE.FORMAT, `${label}：ECDSA 公钥解析失败（${info.label}）：${e.message}`);
    }
    if (!Q) throw fail(CODE.FORMAT, `${label}：ECDSA 公钥为无穷远点`);
    key = {
      kind: "ecdsa",
      type,
      curveName: info.curveName,
      curveId: info.curveId,
      curveObj: info.curve,
      hash: info.hash,
      label: `${type}（${info.label}）`,
      short: info.label,
      Q,
    };
  } else {
    throw fail(
      CODE.UNSUPPORTED,
      `${label}：不支持的 SSH 公钥类型 ${JSON.stringify(type)}；支持 ssh-ed25519 / ssh-rsa / ecdsa-sha2-nistp256/384/521`
    );
  }
  r.end("public key blob");
  return { ...key, blob: blob.slice(), type };
}

function parseSignatureBlob(blob, label = "SSHSIG.signature") {
  const r = new SshReader(blob, label);
  const type = ascii(r.string("signature type"));
  const data = r.string("signature data");
  r.end("signature blob");
  return { type, data: data.slice(), raw: blob };
}

/**
 * 解析 SSHSIG 结构。format = "armored" | "binary"。
 */
export function parseSshsig(blob, format = "binary") {
  const r = new SshReader(blob, "SSHSIG");
  const magic = r.take(6, "magic");
  if (ascii(magic) !== "SSHSIG") {
    throw fail(CODE.FORMAT, `SSHSIG magic 不是 "SSHSIG"（实际 ${JSON.stringify(ascii(magic))}）`);
  }
  const version = r.u32("version");
  if (version !== 1) throw fail(CODE.VERSION, `SSHSIG version = ${version}，本工具仅支持 version 1`);
  const keyBlob = r.string("publickey");
  const namespace = r.string("namespace");
  const reserved = r.string("reserved");
  const hashRaw = r.string("hash_algorithm");
  const hashAlg = ascii(hashRaw);
  const signatureBlob = r.string("signature");
  r.end("SSHSIG");
  const publicKey = parsePublicKeyBlob(keyBlob);
  const signature = parseSignatureBlob(signatureBlob);
  let namespaceText;
  try {
    namespaceText = new TextDecoder("utf-8", { fatal: true }).decode(namespace);
  } catch {
    namespaceText = `(非 UTF-8) ${bytesToHex(namespace)}`;
  }
  return {
    format,
    version,
    keyBlob: keyBlob.slice(),
    publicKey,
    namespace: namespace.slice(),
    namespaceText,
    reserved: reserved.slice(),
    hashRaw: hashRaw.slice(),
    hashAlg,
    signatureBlobRaw: signatureBlob.slice(),
    signature,
  };
}

/** armored 或 binary 输入 → { format, bytes }。 */
export function decodeSshsigInput(input) {
  if (input instanceof Uint8Array) {
    if (!input.length) throw fail(CODE.NO_SIGNATURE, "签名输入为空");
    const head = ascii(input.subarray(0, Math.min(128, input.length)));
    if (head.includes("-----BEGIN")) {
      return { format: "armored", bytes: parseArmor(new TextDecoder().decode(input)) };
    }
    if (head.startsWith("SSHSIG")) return { format: "binary", bytes: input };
    const text = ascii(input).trim();
    const compact = text.replace(/^0x/i, "").replace(/[\s:]/g, "");
    if (compact && /^[0-9a-fA-F]+$/.test(compact)) {
      if (compact.length % 2) throw fail(CODE.FORMAT, "SSHSIG hex 长度为奇数");
      return { format: "binary", bytes: hexToBytes(compact) };
    }
    throw fail(CODE.FORMAT, "无法识别签名输入：需 SSH SIGNATURE armor、SSHSIG binary 或 hex");
  }
  const text = String(input == null ? "" : input).trim();
  if (!text) throw fail(CODE.NO_SIGNATURE, "签名输入为空");
  if (text.includes("-----BEGIN")) return { format: "armored", bytes: parseArmor(text) };
  const compact = text.replace(/^0x/i, "").replace(/[\s:]/g, "");
  if (compact && /^[0-9a-fA-F]+$/.test(compact)) {
    if (compact.length % 2) throw fail(CODE.FORMAT, "SSHSIG hex 长度为奇数");
    return { format: "binary", bytes: hexToBytes(compact) };
  }
  throw fail(CODE.FORMAT, "无法识别签名输入：需 SSH SIGNATURE armor、SSHSIG binary 或 hex");
}

function parseArmor(text) {
  const re = /-----BEGIN SSH SIGNATURE-----([\s\S]*?)-----END SSH SIGNATURE-----/g;
  const blocks = [];
  let m;
  while ((m = re.exec(text)) !== null) blocks.push(m);
  if (!blocks.length) {
    if (text.includes("-----BEGIN")) {
      throw fail(CODE.FORMAT, "SSH SIGNATURE armor 不完整：缺 -----END SSH SIGNATURE----- 或标签不匹配");
    }
    throw fail(CODE.FORMAT, "未找到 -----BEGIN SSH SIGNATURE----- armor");
  }
  if (blocks.length > 1) throw fail(CODE.FORMAT, `输入含 ${blocks.length} 个 SSH SIGNATURE armor 块，一次只接受 1 个`);
  const block = blocks[0];
  const outside = (text.slice(0, block.index) + text.slice(block.index + block[0].length)).trim();
  if (outside) throw fail(CODE.FORMAT, "SSH SIGNATURE armor 之外存在多余内容");
  return base64Decode(block[1], "SSH SIGNATURE armor");
}

export function armorSshsig(binary) {
  const b64 = base64Encode(binary);
  const lines = [];
  for (let i = 0; i < b64.length; i += 70) lines.push(b64.slice(i, i + 70));
  return "-----BEGIN SSH SIGNATURE-----\n" + lines.join("\n") + "\n-----END SSH SIGNATURE-----\n";
}

// ============================================================
// 公钥指纹 / 期望公钥
// ============================================================
export async function sshKeyFingerprint(keyBlob) {
  const h = await digestBytes("SHA-256", keyBlob);
  return "SHA256:" + base64EncodeNoPad(h);
}

function parseExpectedKey(raw, publicKey) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { kind: "none", matched: null };
  const fp = /SHA256:([A-Za-z0-9+/=]+)/.exec(s);
  if (fp) {
    const expected = fp[1].replace(/=+$/, "");
    const actual = publicKey.fingerprint.replace(/^SHA256:/, "").replace(/=+$/, "");
    return { kind: "fingerprint", expected: `SHA256:${expected}`, actual: publicKey.fingerprint, matched: expected === actual };
  }
  // 单 token 且形如 43/44 字符 base64：按 SHA-256 指纹处理
  const single = s.split(/\s+/);
  if (single.length === 1 && /^[A-Za-z0-9+/]{43}=?$/.test(single[0])) {
    const expected = single[0].replace(/=+$/, "");
    const actual = publicKey.fingerprint.replace(/^SHA256:/, "").replace(/=+$/, "");
    return { kind: "fingerprint", expected: `SHA256:${expected}`, actual: publicKey.fingerprint, matched: expected === actual };
  }
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  let parsed = 0;
  let matched = false;
  for (const line of lines) {
    const tokens = line.split(/\s+/);
    let idx = tokens.findIndex((t) => /^(ssh-|ecdsa-|sk-)/.test(t));
    let b64 = null;
    if (idx >= 0) b64 = tokens[idx + 1] || null;
    else if (tokens.length === 1 && /^[A-Za-z0-9+/=]+$/.test(tokens[0])) b64 = tokens[0];
    if (!b64) continue;
    let blob;
    try {
      blob = base64Decode(b64, "期望公钥");
    } catch {
      continue;
    }
    parsed++;
    if (bytesEqual(blob, publicKey.blob)) { matched = true; break; }
  }
  if (!parsed) {
    throw fail(CODE.FORMAT, "期望公钥需为 OpenSSH 公钥行（ssh-ed25519/ssh-rsa/ecdsa-sha2-* AAAA…）或 SHA256: 指纹");
  }
  return { kind: "key", matched, parsed };
}

// ============================================================
// 消息 / 签名验证
// ============================================================
function decodeMessage(text, enc) {
  const s = String(text == null ? "" : text);
  if (enc === "hex") {
    const h = s.replace(/^0x/i, "").replace(/[\s:]/g, "");
    if (!h) return new Uint8Array(0);
    if (!/^[0-9a-fA-F]+$/.test(h)) throw fail(CODE.FORMAT, "消息 hex 含非 hex 字符");
    if (h.length % 2) throw fail(CODE.FORMAT, "消息 hex 长度为奇数");
    return hexToBytes(h);
  }
  if (enc === "base64") {
    const clean = s.replace(/\s+/g, "");
    if (!clean) return new Uint8Array(0);
    return base64Decode(clean, "消息 base64");
  }
  return new TextEncoder().encode(s);
}

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

function verifyRsaPkcs1(key, signature, digest, hashName) {
  const k = Math.ceil(key.bits / 8);
  if (signature.length !== k) {
    throw fail(CODE.SIGNATURE, `RSA 签名长度 ${signature.length} 字节 ≠ 模数长度 ${k} 字节`);
  }
  const s = bytesToBigInt(signature);
  if (s <= 0n || s >= key.n) throw fail(CODE.SIGNATURE, "RSA 签名整数 s 不在 [1, n-1]");
  const em = bigIntToBytes(modPow(s, key.e, key.n), k);
  const variants = [
    { name: "DigestInfo 含 NULL 参数", di: hexToBytes(DIGEST_INFO_NULL[hashName]) },
    { name: "DigestInfo 省略 NULL 参数", di: hexToBytes(DIGEST_INFO_ABSENT[hashName]) },
  ];
  for (const v of variants) {
    const psLen = k - v.di.length - digest.length - 3;
    if (psLen < 8) continue;
    const expected = new Uint8Array(k);
    expected[0] = 0x00;
    expected[1] = 0x01;
    expected.fill(0xff, 2, 2 + psLen);
    expected[2 + psLen] = 0x00;
    expected.set(v.di, 3 + psLen);
    expected.set(digest, 3 + psLen + v.di.length);
    if (bytesEqual(em, expected)) return { variant: v.name };
  }
  throw fail(CODE.SIGNATURE, "RSA PKCS#1 v1.5 验签失败：恢复的 EM 与期望不符（RFC 8017 §8.2.2）");
}

function checkKeySignatureType(key, sigType) {
  if (key.kind === "ed25519") {
    if (sigType !== "ssh-ed25519") {
      throw fail(CODE.SIG_TYPE, `公钥类型 ssh-ed25519 与签名类型 ${sigType} 不匹配`);
    }
    return;
  }
  if (key.kind === "rsa") {
    if (sigType === "ssh-rsa") {
      throw fail(CODE.UNSUPPORTED, "ssh-rsa（SHA-1）签名不在支持范围；支持 rsa-sha2-256 / rsa-sha2-512");
    }
    if (sigType !== "rsa-sha2-256" && sigType !== "rsa-sha2-512") {
      throw fail(CODE.UNSUPPORTED, `RSA 公钥不支持签名类型 ${JSON.stringify(sigType)}`);
    }
    return;
  }
  if (key.kind === "ecdsa") {
    if (sigType !== key.type) {
      if (sigType.startsWith("ecdsa-sha2-")) {
        throw fail(CODE.SIG_TYPE, `ECDSA 公钥曲线 ${key.curveName} 与签名类型 ${sigType} 不匹配`);
      }
      throw fail(CODE.UNSUPPORTED, `ECDSA 公钥不支持签名类型 ${JSON.stringify(sigType)}`);
    }
  }
}

async function verifySignature(sig, signedData) {
  const key = sig.publicKey;
  const sigType = sig.signature.type;
  const data = sig.signature.data;
  checkKeySignatureType(key, sigType);
  if (key.kind === "ed25519") {
    if (data.length !== 64) throw fail(CODE.SIGNATURE, `Ed25519 签名必须 64 字节，实际 ${data.length}`);
    let ok = false;
    try {
      ok = ed25519Verify(key.pk, signedData, data);
    } catch (e) {
      throw fail(CODE.SIGNATURE, `Ed25519 验签异常：${e.message}`);
    }
    if (!ok) throw fail(CODE.SIGNATURE, "Ed25519 验签失败（RFC 8032 §5.1.7）");
    return { alg: "ssh-ed25519", hash: "Ed25519（内部 SHA-512）" };
  }
  if (key.kind === "rsa") {
    const hashName = sigType === "rsa-sha2-256" ? "SHA-256" : "SHA-512";
    const digest = await digestBytes(hashName, signedData);
    const r = verifyRsaPkcs1(key, data, digest, hashName);
    return { alg: sigType, hash: `${hashName}（对 signed data）`, variant: r.variant };
  }
  // ECDSA：签名数据是 string r + string s（mpint 语义）
  const r = new SshReader(data, "ECDSA signature");
  const rr = r.mpint("ECDSA r");
  const ss = r.mpint("ECDSA s");
  r.end("ECDSA signature");
  const digest = await digestBytes(key.hash, signedData);
  const e = hashToE(digest, key.curveObj);
  const res = ecdsaVerifyRaw(key.curveObj, key.Q, rr, ss, e);
  if (!res.valid) throw fail(CODE.SIGNATURE, `ECDSA 验签失败：${res.reason || "R.x mod n ≠ r（验签方程不成立）"}`);
  return { alg: sigType, hash: `${key.hash}（对 signed data）` };
}

// ============================================================
// 主流程
// ============================================================
/**
 * @param {string|Uint8Array} input armored / binary（rawBytes 或 hex）
 * @param {{message?:string, msgEnc?:string, key?:string, namespace?:string}} opts
 */
export async function verifySshsig(input, opts = {}) {
  const result = {
    verdict: "FAIL",
    trust: "UNTRUSTED",
    format: null,
    version: null,
    namespace: null,
    namespaceText: null,
    reservedHex: null,
    hashAlg: null,
    publicKey: null,
    signatureType: null,
    signatureLen: null,
    messageLen: null,
    messageHashHex: null,
    signedDataLen: null,
    checks: { signature: false, namespace: null, key: null },
    errors: [],
    warnings: [],
  };
  const record = (e) => {
    if (e instanceof SshsigVerifyError) {
      result.errors.push({ code: e.code, message: e.message });
    } else {
      throw e;
    }
  };

  let decoded;
  try {
    decoded = decodeSshsigInput(input);
  } catch (e) {
    record(e);
    return result;
  }
  result.format = decoded.format;

  let sig;
  try {
    sig = parseSshsig(decoded.bytes, decoded.format);
  } catch (e) {
    record(e);
    return result;
  }
  result.version = sig.version;
  result.namespace = sig.namespace;
  result.namespaceText = sig.namespaceText;
  result.reservedHex = bytesToHex(sig.reserved);
  result.hashAlg = sig.hashAlg;
  result.publicKey = {
    type: sig.publicKey.type,
    label: sig.publicKey.label,
    short: sig.publicKey.short,
    bits: sig.publicKey.bits || null,
    curve: sig.publicKey.curveName || null,
    fingerprint: await sshKeyFingerprint(sig.keyBlob),
  };
  result.signatureType = sig.signature.type;
  result.signatureLen = sig.signature.data.length;

  if (sig.hashAlg !== "sha256" && sig.hashAlg !== "sha512") {
    result.errors.push({
      code: CODE.UNSUPPORTED,
      message: `hash_algorithm = ${JSON.stringify(sig.hashAlg)} 不在支持范围（仅 sha256 / sha512）`,
    });
    return result;
  }

  let message;
  try {
    message = decodeMessage(opts.message, opts.msgEnc || "text");
  } catch (e) {
    record(e);
    return result;
  }
  result.messageLen = message.length;
  const hashName = sig.hashAlg === "sha256" ? "SHA-256" : "SHA-512";
  const messageHash = await digestBytes(hashName, message);
  result.messageHashHex = bytesToHex(messageHash);
  const signedData = concatBytes(
    MAGIC,
    sshString(sig.namespace),
    sshString(sig.reserved),
    sshString(sig.hashRaw),
    sshString(messageHash)
  );
  result.signedDataLen = signedData.length;

  try {
    const r = await verifySignature(sig, signedData);
    result.checks.signature = true;
    result.signatureAlg = r.alg;
    result.signatureHash = r.hash;
    result.signatureVariant = r.variant || null;
  } catch (e) {
    record(e);
  }

  // 期望 namespace（bytes 精确比较）
  const expectedNamespace = opts.namespace == null ? "" : String(opts.namespace);
  if (expectedNamespace !== "") {
    const exp = new TextEncoder().encode(expectedNamespace);
    if (bytesEqual(exp, sig.namespace)) {
      result.checks.namespace = true;
    } else {
      result.checks.namespace = false;
      result.errors.push({
        code: CODE.NAMESPACE,
        message: `命名空间不匹配：签名内 = ${JSON.stringify(sig.namespaceText)}，期望 = ${JSON.stringify(expectedNamespace)}`,
      });
    }
  }

  // 期望公钥 / 指纹
  let expected;
  try {
    expected = parseExpectedKey(opts.key, { blob: sig.keyBlob, fingerprint: result.publicKey.fingerprint });
  } catch (e) {
    record(e);
    expected = null;
  }
  if (expected) {
    result.expectedKey = expected.kind === "none" ? null : {
      kind: expected.kind,
      expected: expected.expected || null,
      matched: expected.matched,
    };
    if (expected.kind === "none") {
      result.trust = "UNTRUSTED";
      result.checks.key = null;
    } else if (expected.matched) {
      result.trust = "ANCHORED";
      result.checks.key = true;
    } else {
      result.trust = "MISMATCH";
      result.checks.key = false;
      result.errors.push({
        code: CODE.KEY,
        message: expected.kind === "fingerprint"
          ? `期望公钥指纹 ${expected.expected} 与内嵌公钥 ${result.publicKey.fingerprint} 不一致`
          : "期望公钥与 SSHSIG 内嵌公钥不一致（请确认用了正确的 authorized_keys 行）",
      });
    }
  }

  if (result.trust === "UNTRUSTED") {
    result.warnings.push("未提供期望公钥；SSHSIG 内嵌公钥只能证明签名由该密钥生成，不构成身份信任");
  }
  result.verdict = result.errors.length ? "FAIL" : "PASS";
  return result;
}

// ============================================================
// 输出
// ============================================================
export function formatSshsigResult(result) {
  const out = [];
  out.push("OpenSSH SSHSIG 验签（PROTOCOL.sshsig v1）");
  out.push(`验签结论：${result.verdict}`);
  if (result.trust === "ANCHORED") {
    out.push("信任判定：ANCHORED（期望公钥/指纹与内嵌公钥一致）");
  } else if (result.trust === "MISMATCH") {
    out.push("信任判定：MISMATCH（提供了期望公钥/指纹，但与内嵌公钥不一致）");
  } else {
    out.push("信任判定：UNTRUSTED（未提供期望公钥；内嵌公钥不构成身份信任）");
  }
  if (!result.publicKey) {
    if (result.errors.length) {
      out.push("", `[错误] 共 ${result.errors.length} 项`);
      result.errors.forEach((e, i) => out.push(`  ${i + 1}. [${e.code}] ${e.message}`));
    }
    return out.join("\n");
  }
  out.push(`签名格式：${result.format === "armored" ? "armored（SSH SIGNATURE armor）" : "binary（SSHSIG 原始结构）"}`);
  out.push(`版本：${result.version}`);
  out.push(`命名空间：${JSON.stringify(result.namespaceText)}`);
  out.push(`保留字段：${result.reservedHex ? result.reservedHex : "（空）"}`);
  out.push(`消息哈希算法：${result.hashAlg}`);
  out.push(`消息长度：${result.messageLen} 字节`);
  out.push(`公钥：${result.publicKey.label}`);
  out.push(`公钥指纹：${result.publicKey.fingerprint}`);
  out.push(`签名类型：${result.signatureType}`);
  out.push(`签名长度：${result.signatureLen} 字节`);
  if (result.signatureAlg) out.push(`签名算法：${result.signatureAlg} · ${result.signatureHash}`);
  out.push("");
  out.push("[检查]");
  out.push(`  消息哈希：${result.hashAlg}（${result.messageLen} 字节 → ${result.messageHashHex ? result.messageHashHex.slice(0, 32) + "…" : "(未计算)"}）`);
  out.push(`  signed data：${result.signedDataLen} 字节（magic + namespace + reserved + hash_algorithm + H(message)）`);
  out.push(`  签名验证：${result.checks.signature ? "通过" : "失败"}`);
  out.push(`  命名空间：${result.checks.namespace === null ? "未指定期望（使用签名内值）" : result.checks.namespace ? "与期望一致" : "与期望不一致"}`);
  out.push(`  公钥信任：${result.checks.key === null ? "未提供期望公钥" : result.checks.key ? "与期望一致" : "与期望不一致"}`);
  if (result.errors.length) {
    out.push("", `[错误] 共 ${result.errors.length} 项（全部显式报出）`);
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
  out.push("支持：ssh-ed25519、ssh-rsa + rsa-sha2-256/512、ecdsa-sha2-nistp256/384/521；armored 与 binary。");
  out.push("不做：读取私钥、allowed_signers 多签名者策略、证书密钥、sk-* 安全密钥、网络访问。");
  return out.join("\n");
}

export async function sshsigVerifyRun(text, p = {}) {
  const params = p || {};
  let input = text;
  if (params.rawBytes && params.rawBytes.length) {
    input = Uint8Array.from(params.rawBytes);
  }
  try {
    const result = await verifySshsig(input, {
      message: params.message,
      msgEnc: params.msgEnc,
      key: params.key,
      namespace: params.namespace,
    });
    return formatSshsigResult(result);
  } catch (e) {
    if (e instanceof SshsigVerifyError) {
      return [
        "OpenSSH SSHSIG 验签（PROTOCOL.sshsig v1）",
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
  id: "sshsigVerify",
  cat: "asym",
  name: "OpenSSH SSHSIG 验签",
  desc: "解析 OpenSSH SSHSIG 签名（armored 或 binary），验签 Ed25519 / RSA（rsa-sha2-256/512）/ ECDSA P-256/384/521；检查 namespace、hash_algorithm、内嵌公钥类型与签名类型；可提供期望公钥（authorized_keys 行）或 SHA-256 指纹建立身份信任；不读私钥、不联网、不做 allowed_signers 多签名者策略。",
  acceptsBytes: true,
  params: [
    {
      key: "message",
      label: "消息内容（被签名的文件/文本）",
      type: "textarea",
      rows: 6,
      default: "",
      placeholder: "粘贴被签名的消息；二进制消息改用 msgEnc=hex/base64",
    },
    {
      key: "msgEnc",
      label: "消息编码",
      type: "select",
      default: "text",
      options: [
        { value: "text", label: "文本（UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
      ],
    },
    {
      key: "key",
      label: "期望公钥（authorized_keys 行 / SHA256 指纹，留空=只验签不判身份）",
      type: "text",
      default: "",
      placeholder: "ssh-ed25519 AAAA… 或 SHA256:…",
    },
    {
      key: "namespace",
      label: "期望命名空间（留空=使用签名内 namespace）",
      type: "text",
      default: "",
      placeholder: "file / git / …",
    },
  ],
  run: sshsigVerifyRun,
});

export { SshsigVerifyError, CODE as SSHSIG_ERROR_CODES, parseArmor as parseSshsigArmor };
