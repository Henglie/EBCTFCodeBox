/*
 * opensslDec.js — OpenSSL `enc` 口令加解密（cat: 'block'）
 *
 * 补齐「一步式口令解密」：手上只有 `U2FsdGVkX1…`（base64("Salted__"+salt+密文)）和口令时，
 * 不必先自己派生 key/iv 再喂 AES。仓库现有 evpBytesToKey 是**派生**步骤、aes 是**要 raw key/iv**
 * 的裸算法，两者之间缺的正是本 op。
 *
 * 严格按 OpenSSL `enc` 语义实现：
 *   结构   = "Salted__"(8) || salt(8) || ciphertext
 *   派生   = EVP_BytesToKey，count=1：D_1 = H(pass || salt)，D_i = H(D_(i-1) || pass || salt)，
 *            拼接至 keyLen + 16（CBC 的 iv）后切分；哈希档 md5 / sha256。
 *   加密   = AES-128/192/256-CBC + PKCS#7。
 *   去填充 = 校验 pad 长度 1..16 且尾部 pad 个字节全部相等（modern.js 的 unpad 也做同样校验，
 *            这里自行实现是为了在 auto 模式下把「填充非法」当成**可比较的失败结果**而不是异常）。
 *
 * 三条硬规矩（对应实测踩过的坑）：
 *   1. 密文长度不是 16 的倍数 → 显式报错并指出缺几字节，绝不静默截断/补零后输出乱码。
 *   2. 口令错误 → 报错。填充校验是第一道闸；填充偶然合法（约 1/256）时再用
 *      「合法 UTF-8 / 可打印率 / 已知魔数」第二道闸拦住乱码。代价：无魔数的纯二进制明文
 *      会被判为可疑并报错，此时请用 aes op 直接喂 key/iv（本格式本身不带完整性校验）。
 *   3. encode 方向的 salt 必须走统一随机源 randSource.randomBytes（已在 randOps.RAND_OPS 登记）。
 *
 * 方向用参数 mode 选择（decode / encode），与 ascon、dataConvertOp 等「参数定方向」的 op 同形；
 * 不另设 encode/decode 双函数，避免「按钮方向」和「mode 参数」两个真相源打架。
 */

import { aesEncrypt, aesDecrypt } from "./modern.js";
import { md5Bytes } from "./hash.js";
import { register } from "./registry.js";
import { randomBytes } from "./randSource.js";
import {
  b64ToBytes,
  bytesToB64,
  hexToBytes,
  decodeUtf8Lossless,
  sniffMagic,
  finishBytesDecode,
} from "./bytesIo.js";

const te = new TextEncoder();

// ============================================================
// 常量
// ============================================================
const SALTED = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]); // "Salted__"
const BLOCK = 16;

const CIPHERS = {
  "aes-128-cbc": { keyLen: 16, label: "AES-128-CBC" },
  "aes-192-cbc": { keyLen: 24, label: "AES-192-CBC" },
  "aes-256-cbc": { keyLen: 32, label: "AES-256-CBC" },
  // RC4：CryptoJS 默认 32 字节 key（256 bit），流密码无填充、无 IV。
  rc4: { keyLen: 32, label: "RC4", stream: true },
};
// 尝试顺序：AES 三档优先（CTF 与各语言库最常见），RC4 兜底（CryptoJS 默认封装）。
const AUTO_CIPHERS = ["aes-256-cbc", "aes-192-cbc", "aes-128-cbc", "rc4"];
const AUTO_KDFS = ["md5", "sha256"];

// ============================================================
// 同步 SHA-256（FIPS 180-4）
// 为什么不复用 hash.js：那里的 SHA 家族走 WebCrypto，是 async；本 op 的 run 是同步签名，
// 且 auto 模式要对 6 组参数逐一派生，不能返回 Promise。实现与 randSource / baseExt 内的
// 同步 SHA-256 同构，逐字节对齐 FIPS 180-4 测试向量。
// ============================================================
const K256 = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x, n) {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function sha256Bytes(msg) {
  const l = msg.length;
  const total = Math.ceil((l + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(msg, 0);
  buf[l] = 0x80;
  const bits = BigInt(l) * 8n;
  for (let i = 0; i < 8; i++) buf[total - 1 - i] = Number((bits >> BigInt(8 * i)) & 0xffn);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = ((buf[off + i * 4] << 24) | (buf[off + i * 4 + 1] << 16) | (buf[off + i * 4 + 2] << 8) | buf[off + i * 4 + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (H[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    out[i * 4 + 3] = H[i] & 0xff;
  }
  return out;
}

const HASHES = {
  md5: { label: "MD5", fn: md5Bytes, outLen: 16 },
  sha256: { label: "SHA-256", fn: sha256Bytes, outLen: 32 },
};

// ============================================================
// EVP_BytesToKey（OpenSSL enc 的 -k/口令派生，count=1）
// ============================================================
/**
 * D_1 = H(pass || salt)；D_i = H(D_(i-1) || pass || salt)；串接后前 keyLen 为 key、后 ivLen 为 iv。
 * @param {Uint8Array} pass 口令字节（UTF-8）
 * @param {Uint8Array} salt 8 字节盐
 * @param {number} keyLen 16 / 24 / 32
 * @param {number} ivLen CBC 恒为 16
 * @param {{fn:Function, outLen:number}} hash 摘要实现
 * @returns {{key:Uint8Array, iv:Uint8Array}}
 */
function evpBytesToKey(pass, salt, keyLen, ivLen, hash) {
  const need = keyLen + ivLen;
  const out = new Uint8Array(need);
  let off = 0;
  let prev = new Uint8Array(0);
  while (off < need) {
    const buf = new Uint8Array(prev.length + pass.length + salt.length);
    buf.set(prev, 0);
    buf.set(pass, prev.length);
    buf.set(salt, prev.length + pass.length);
    const digest = hash.fn(buf);
    const take = Math.min(digest.length, need - off);
    out.set(digest.subarray(0, take), off);
    off += take;
    prev = digest;
  }
  return { key: out.subarray(0, keyLen), iv: out.subarray(keyLen, need) };
}

// RC4（RFC 6229 语义）：KSA + PRGA，加密与解密同函数；无 drop、无填充。
// CryptoJS 的 RC4 也是标准 RC4（非 RC4Drop），密钥 32 字节时与本实现逐字节一致。
function rc4Crypt(data, key) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + key[i % key.length]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  const out = new Uint8Array(data.length);
  let a = 0, b = 0;
  for (let k = 0; k < data.length; k++) {
    a = (a + 1) & 0xff;
    b = (b + S[a]) & 0xff;
    const t = S[a]; S[a] = S[b]; S[b] = t;
    out[k] = data[k] ^ S[(S[a] + S[b]) & 0xff];
  }
  return out;
}

// ============================================================
// 输入解析：rawBytes / base64（可带 data: 前缀）/ hex
// ============================================================
function toBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  if (Array.isArray(v)) return Uint8Array.from(v);
  if (typeof v === "string") {
    // 真字节通道偶尔会被上层以「逐字符即字节」的字符串中转，这里按低 8 位还原。
    const out = new Uint8Array(v.length);
    for (let i = 0; i < v.length; i++) out[i] = v.charCodeAt(i) & 0xff;
    return out;
  }
  throw new Error("rawBytes 类型无法识别（支持 Uint8Array / ArrayBuffer / 数组）");
}

/** 去掉 data: URL 前缀；非 base64 的 data URL 直接拒绝（避免把百分号转义当成密文）。 */
function stripDataUrl(s) {
  if (!/^data:/i.test(s)) return s;
  const comma = s.indexOf(",");
  if (comma < 0) throw new Error("data: 前缀格式错误：缺少逗号后的数据部分");
  const meta = s.slice(5, comma);
  if (!/;base64/i.test(meta)) {
    throw new Error("data: 前缀仅支持 base64 数据（形如 data:application/octet-stream;base64,…）");
  }
  return s.slice(comma + 1);
}

function parseCiphertext(text, p) {
  if (p && p.rawBytes != null) return toBytes(p.rawBytes);

  let s = String(text == null ? "" : text).trim();
  if (!s) throw new Error("输入为空：请粘贴 OpenSSL Salted__ 密文（base64 或 hex）");
  s = stripDataUrl(s);
  const compact = s.replace(/\s+/g, "");
  if (!compact) throw new Error("输入为空：data: 前缀后没有数据");

  // hex 全由 0-9a-f 组成；base64("Salted__") 以 U2FsdGVkX1 开头，含非 hex 字符，二者不会混淆。
  if (/^[0-9a-fA-F]+$/.test(compact)) {
    if (compact.length % 2 !== 0) {
      throw new Error(`hex 长度必须为偶数（当前 ${compact.length} 个字符），未做补零`);
    }
    return hexToBytes(compact);
  }
  try {
    return b64ToBytes(compact);
  } catch (e) {
    throw new Error("输入既不是 hex 也不是 base64：" + ((e && e.message) || String(e)));
  }
}

/** 拆 Salted__ 结构；长度不合规一律显式报错。 */
function splitSalted(raw) {
  if (raw.length < 16) {
    throw new Error(`数据太短：${raw.length} 字节，至少需要 16 字节（Salted__ 头 8 + salt 8）`);
  }
  for (let i = 0; i < 8; i++) {
    if (raw[i] !== SALTED[i]) {
      throw new Error(
        "不是 OpenSSL Salted__ 格式：前 8 字节应为 \"Salted__\"（base64 应以 U2FsdGVkX1 开头）"
      );
    }
  }
  const salt = raw.subarray(8, 16);
  const ct = raw.subarray(16);
  if (ct.length === 0) throw new Error("密文为空：Salted__ 头与 salt 之后没有数据");
  // 不在这里判 16 倍数：RC4 是流密码，任何长度都合法。
  // 是否按分组密码处理由 decodeDirection 按 cipher 决定（显式 AES 时仍严格报缺字节）。
  return { salt, ct, blockAligned: ct.length % BLOCK === 0 };
}

// ============================================================
// PKCS#7 去填充 + 明文可信度
// ============================================================
function pkcs7Unpad(bytes, blockSize = BLOCK) {
  if (!bytes.length) return { ok: false, reason: "解密结果为空" };
  const padLen = bytes[bytes.length - 1];
  if (padLen < 1 || padLen > blockSize) {
    return { ok: false, reason: `末字节 0x${padLen.toString(16).padStart(2, "0")} 不是合法填充长度 1..${blockSize}` };
  }
  if (padLen > bytes.length) {
    return { ok: false, reason: `填充长度 ${padLen} 超过数据长度 ${bytes.length}` };
  }
  for (let i = bytes.length - padLen; i < bytes.length; i++) {
    if (bytes[i] !== padLen) {
      return { ok: false, reason: `尾部 ${padLen} 字节填充值不一致（位置 ${i} 为 0x${bytes[i].toString(16).padStart(2, "0")}）` };
    }
  }
  return { ok: true, data: bytes.subarray(0, bytes.length - padLen), padLen };
}

function printableRatio(bytes) {
  if (!bytes.length) return 1;
  let hit = 0;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e)) hit++;
  }
  return hit / bytes.length;
}

/** 明文可信度：合法 UTF-8 或已知魔数最强，其次看 ASCII 可打印率。 */
function judgePlain(data) {
  const utf8 = decodeUtf8Lossless(data).ok;
  const printable = printableRatio(data);
  const magic = sniffMagic(data);
  return {
    utf8,
    printable,
    magicName: magic ? magic.name : "",
    plausible: utf8 || printable >= 0.85 || !!magic,
  };
}

// ============================================================
// 单组尝试 / 自动尝试
// ============================================================
function normalizeCipher(v) {
  const s = String(v == null || v === "" ? "auto" : v).trim().toLowerCase();
  if (s === "auto") return "auto";
  if (!CIPHERS[s]) {
    throw new Error(`未知 cipher：${v}（合法：auto / aes-128-cbc / aes-192-cbc / aes-256-cbc / rc4）`);
  }
  return s;
}

function normalizeKdf(v) {
  const s = String(v == null || v === "" ? "auto" : v).trim().toLowerCase();
  if (s === "auto") return "auto";
  if (!HASHES[s]) throw new Error(`未知 kdf：${v}（合法：auto / md5 / sha256）`);
  return s;
}

function readPass(p) {
  const pass = p && p.passphrase != null ? String(p.passphrase) : "";
  if (pass === "") {
    throw new Error("口令为空：请填写 openssl enc 的 -k / -pass 使用的口令（本工具不接受空口令）");
  }
  return te.encode(pass);
}

/**
 * 用一组固定参数解一次。失败不抛错，返回可比较的结果（auto 模式要汇总全部尝试）。
 */
function attemptDecrypt(ct, salt, pass, cipher, kdf) {
  const c = CIPHERS[cipher];
  const h = HASHES[kdf];
  if (c.stream) {
    // 流密码：只派生 key，无 IV、无填充；结果是否有意义交给 judgePlain。
    const { key } = evpBytesToKey(pass, salt, c.keyLen, 0, h);
    const data = rc4Crypt(ct, key);
    return { cipher, kdf, ok: true, reason: "", data, judge: judgePlain(data), stream: true };
  }
  const { key, iv } = evpBytesToKey(pass, salt, c.keyLen, BLOCK, h);
  // pad:false → 自行校验 PKCS#7，把「填充非法」变成结果而不是异常。
  const padded = aesDecrypt(ct, key, { mode: "CBC", iv, pad: false });
  const un = pkcs7Unpad(padded);
  if (!un.ok) {
    return { cipher, kdf, ok: false, reason: un.reason, data: null, judge: null };
  }
  const judge = judgePlain(un.data);
  return { cipher, kdf, ok: true, reason: "", data: un.data, judge };
}

function scoreAttempt(a) {
  if (!a.ok) return -1;
  let s = 1;
  if (a.judge.utf8) s += 4;
  if (a.judge.magicName) s += 3;
  s += a.judge.printable * 2;
  return s;
}

function fmtAttempt(a, adopted) {
  const name = `${a.cipher} / ${a.kdf}`;
  if (!a.ok) return `  ✗ ${name}：填充非法（${a.reason}）`;
  const pct = Math.round(a.judge.printable * 100);
  const kind = a.judge.utf8 ? "UTF-8 文本" : a.judge.magicName ? a.judge.magicName : `可打印率 ${pct}%`;
  const head = a.stream ? "无填充（流密码）" : "填充合法";
  return `  ${adopted ? "✔" : "·"} ${name}：${head}，${kind}${adopted ? "  ← 采用" : ""}`;
}

function buildReport(attempts, winner) {
  const lines = [`—— OpenSSL 自动尝试（${attempts.length} 组）——`];
  for (const a of attempts) lines.push(fmtAttempt(a, a === winner));
  return "\n\n" + lines.join("\n");
}

function appendReport(result, report) {
  if (typeof result === "string") return result + report;
  if (result && typeof result === "object" && typeof result.text === "string") {
    return { ...result, text: result.text + report };
  }
  return result;
}

function decodeDirection(text, p) {
  const raw = parseCiphertext(text, p);
  const { salt, ct, blockAligned } = splitSalted(raw);
  const pass = readPass(p);
  const cipher = normalizeCipher(p && p.cipher);
  const kdf = normalizeKdf(p && p.kdf);
  const auto = cipher === "auto" || kdf === "auto";
  // 显式选分组密码但密文不整块：仍严格报缺字节（不静默截断）。
  if (cipher !== "auto" && !CIPHERS[cipher].stream && !blockAligned) {
    const missing = BLOCK - (ct.length % BLOCK);
    throw new Error(
      `密文长度 ${ct.length} 字节不是 16 的倍数（缺 ${missing} 字节）：` +
      "分组密码要求整块密文；若来源是 CryptoJS 封装，请把 cipher 设为 auto 或 rc4（流密码不要求对齐）"
    );
  }
  // auto：长度不齐时分组密码无解，只试流密码；长度对齐时全试（AES 优先，RC4 兜底）。
  const ciphers = cipher === "auto"
    ? (blockAligned ? AUTO_CIPHERS : AUTO_CIPHERS.filter((x) => CIPHERS[x].stream))
    : [cipher];
  const kdfs = kdf === "auto" ? AUTO_KDFS : [kdf];

  const attempts = [];
  for (const c of ciphers) {
    for (const k of kdfs) attempts.push(attemptDecrypt(ct, salt, pass, c, k));
  }

  const good = attempts.filter((a) => a.ok && a.judge.plausible);
  const plain = (a) => finishBytesDecode(a.data, { name: "opensslDec" });

  if (!good.length) {
    const detail = attempts.map((a) => fmtAttempt(a, false)).join("\n");
    const anyPadOk = attempts.some((a) => a.ok);
    throw new Error(
      (anyPadOk
        ? `解密失败：${attempts.length} 组参数组合的填充虽合法，但明文不像有意义的文本（口令可能错误，或 cipher/kdf 不匹配）`
        : `解密失败：${attempts.length} 组参数组合都未通过 PKCS#7 填充校验（口令可能错误，或 cipher/kdf 不匹配）`) +
      "\n" + detail
    );
  }

  // 排序取最优；分数相同按尝试顺序（256→192→128，md5→sha256）稳定取先出现者。
  let winner = good[0];
  for (const a of good) if (scoreAttempt(a) > scoreAttempt(winner)) winner = a;

  const result = plain(winner);
  if (!auto) return result;
  return appendReport(result, buildReport(attempts, winner));
}

function encodeDirection(text, p) {
  const pass = readPass(p);
  const cipher = normalizeCipher(p && p.cipher);
  const kdf = normalizeKdf(p && p.kdf);
  // 编码方向 auto 的落点：AES-256-CBC + MD5（经典 openssl enc / 各语言库默认；
  // 现代 OpenSSL 3 的默认摘要已改为 sha256，需要时请显式选 kdf=sha256）。
  const useCipher = cipher === "auto" ? "aes-256-cbc" : cipher;
  const useKdf = kdf === "auto" ? "md5" : kdf;

  const data = p && p.rawBytes != null
    ? toBytes(p.rawBytes)
    : text instanceof Uint8Array
      ? text
      : te.encode(String(text == null ? "" : text));
  const salt = randomBytes(8); // 必须走统一随机源（randOps.RAND_OPS 已登记）
  const c = CIPHERS[useCipher];
  let ct;
  if (c.stream) {
    const { key } = evpBytesToKey(pass, salt, c.keyLen, 0, HASHES[useKdf]);
    ct = rc4Crypt(data, key);
  } else {
    const { key, iv } = evpBytesToKey(pass, salt, c.keyLen, BLOCK, HASHES[useKdf]);
    ct = aesEncrypt(data, key, { mode: "CBC", iv, pad: true }); // PKCS#7 自动补
  }
  const out = new Uint8Array(16 + ct.length);
  out.set(SALTED, 0);
  out.set(salt, 8);
  out.set(ct, 16);
  return bytesToB64(out);
}

/**
 * op 入口：mode 定方向。
 * @param {string|Uint8Array} text 主输入
 * @param {{passphrase?:string, cipher?:string, kdf?:string, mode?:string, rawBytes?:Uint8Array}} [p]
 */
function opensslDecRun(text, p = {}) {
  const mode = String(p.mode == null || p.mode === "" ? "decode" : p.mode).trim().toLowerCase();
  if (mode === "encode") return encodeDirection(text, p);
  if (mode === "decode") return decodeDirection(text, p);
  throw new Error(`未知 mode：${p.mode}（合法：decode / encode）`);
}

// ============================================================
// 注册
// ============================================================
register({
  id: "opensslDec",
  cat: "block",
  name: "OpenSSL 口令加解密",
  desc:
    "OpenSSL enc 的 Salted__ 一步式口令加解密：base64/hex/真字节输入，EVP_BytesToKey（md5/sha256）+ AES-128/192/256-CBC + PKCS#7，并支持 CryptoJS 常见的 RC4（流密码，无填充）。" +
    "auto 遍历 8 组并给出全部尝试结果；密文非 16 倍数时分组密码显式报缺字节、自动改试流密码，坏填充/无 Salted__ 头/口令错误均显式报错，不输出乱码。",
  params: [
    {
      sensitive: true,
      key: "passphrase",
      label: "口令",
      type: "password",
      default: "",
      placeholder: "openssl enc -k 的口令",
    },
    {
      key: "cipher",
      label: "算法",
      type: "select",
      default: "auto",
      options: [
        { value: "auto", label: "auto（AES 三档 + RC4）" },
        { value: "aes-128-cbc", label: "AES-128-CBC" },
        { value: "aes-192-cbc", label: "AES-192-CBC" },
        { value: "aes-256-cbc", label: "AES-256-CBC" },
        { value: "rc4", label: "RC4（流密码）" },
      ],
    },
    {
      key: "kdf",
      label: "KDF 摘要",
      type: "select",
      default: "auto",
      options: [
        { value: "auto", label: "auto（MD5 / SHA-256 都试）" },
        { value: "md5", label: "MD5（经典默认）" },
        { value: "sha256", label: "SHA-256（OpenSSL 3 默认）" },
      ],
    },
    {
      key: "mode",
      label: "方向",
      type: "select",
      default: "decode",
      options: [
        { value: "decode", label: "解密（Salted__ → 明文）" },
        { value: "encode", label: "加密（明文 → Salted__）" },
      ],
    },
  ],
  acceptsBytes: true,
  run: opensslDecRun,
});

export {
  opensslDecRun,
  evpBytesToKey,
  sha256Bytes,
  pkcs7Unpad,
  splitSalted,
  parseCiphertext,
  encodeDirection,
  decodeDirection,
};
