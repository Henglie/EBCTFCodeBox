/*
 * aeadModes.js — AEAD 补口：ChaCha20-Poly1305 / Poly1305 / GHASH / nonce 重用演示。
 *
 * 规范依据（只引用公开标准与论文，不引用内部资料）：
 * - RFC 8439: ChaCha20 and Poly1305 for IETF Protocols
 *     §2.5 Poly1305、§2.6 Poly1305 key generation、§2.8 AEAD_CHACHA20_POLY1305。
 *     本文件直接复用 poly1305.js 的 ChaCha20 / Poly1305 / AEAD 原语，不重复实现。
 * - NIST SP 800-38D: Recommendation for Block Cipher Modes of Operation — GCM and GMAC，
 *     §6.4 GHASH；测试向量取 McGrew/Viega "The Galois/Counter Mode of Operation (GCM)"
 *     Appendix B Test Case 2（无 AAD）与 Test Case 4（有 AAD、多块密文）。
 * - nonce 重用：ChaCha20-Poly1305 在同一 key+nonce 下重复使用会复用 ChaCha20 密钥流
 *     与 Poly1305 一次性密钥（RFC 8439 §2.6）。已知一侧明文即可恢复密钥流并解出另一侧；
 *     本 op 只做这一条可验证的攻击链，不把 GCM forbidden attack 伪装成已实现。
 *
 * 红线：core 层零 UI 依赖；纯本地零外发；无随机数（本文件不生成密钥）。
 * 契约：register({ id, cat, name, desc, params, encode/decode/run, detect })。
 */
import { register } from "./registry.js";
import {
  chacha20Poly1305Encrypt,
  chacha20Poly1305Decrypt,
  chacha20Block,
  poly1305Mac,
} from "./poly1305.js";
import { decodeUtf8Lossless, finishBytesDecode } from "./bytesIo.js";

// ============================================================
// 字节 / hex 工具
// ============================================================

function bytesToHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 严格 hex → 字节。允许 0x 前缀、空白、冒号、下划线、短横线作为分隔。
 * expectedLen 非空时校验精确长度；allowEmpty 控制空串是否合法。
 */
function hexToBytesStrict(value, name, expectedLen, allowEmpty = true) {
  let s = String(value == null ? "" : value).trim();
  s = s.replace(/^0x/i, "").replace(/[\s:_-]+/g, "");
  if (s === "") {
    if (allowEmpty) return new Uint8Array(0);
    throw new Error(`${name} 不能为空（需要 hex）`);
  }
  if (!/^[0-9a-fA-F]+$/.test(s)) {
    throw new Error(`${name} 含非 hex 字符：${String(value).slice(0, 48)}`);
  }
  if (s.length % 2 !== 0) {
    throw new Error(`${name} 的 hex 长度为奇数（${s.length}），无法按字节解析`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  if (expectedLen != null && out.length !== expectedLen) {
    throw new Error(`${name} 必须为 ${expectedLen} 字节（${expectedLen * 2} hex），当前 ${out.length} 字节`);
  }
  return out;
}

function textToBytes(text) {
  return new TextEncoder().encode(String(text == null ? "" : text));
}

function xorPrefix(a, b, n) {
  const len = Math.min(n, a.length, b.length);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = a[i] ^ b[i];
  return out;
}

function concatBytes(...parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function keyNonceAad(p = {}) {
  const key = hexToBytesStrict(p.key, "key", 32, false);
  const nonce = hexToBytesStrict(p.nonce, "nonce", 12, false);
  const aad = hexToBytesStrict(p.aad, "aad", null, true);
  return { key, nonce, aad };
}

// ============================================================
// GHASH（NIST SP 800-38D §6.4）
// ============================================================

// GF(2^128) 的 GCM 域多项式：x^128 + x^7 + x^2 + x + 1。
// 右移时若最低位为 1，异或 R = 0xe1 || 0^120（大端块表示）。
const GHASH_R = 0xe1000000000000000000000000000000n;

function blockToBigInt(bytes, off) {
  let v = 0n;
  const end = Math.min(off + 16, bytes.length);
  for (let i = off; i < end; i++) v = (v << 8n) | BigInt(bytes[i]);
  // 不足 16 字节的尾块右侧补 0（GCM 的 pad）。
  for (let i = end - off; i < 16; i++) v <<= 8n;
  return v;
}

function bigIntToBlock(v) {
  const out = new Uint8Array(16);
  let x = v & ((1n << 128n) - 1n);
  for (let i = 15; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** GCM 的 GF(2^128) 乘法：X 的位从最高位开始，V 每次右移，按需异或 R。 */
function ghashMul(x, y) {
  let z = 0n;
  let v = y;
  let mask = 1n << 127n;
  for (let i = 0; i < 128; i++) {
    if (x & mask) z ^= v;
    if (v & 1n) v = (v >> 1n) ^ GHASH_R;
    else v >>= 1n;
    mask >>= 1n;
  }
  return z;
}

/**
 * GHASH(H, A, C)：A 为关联数据，C 为密文，两者各自右侧补 0 到 16 字节倍数，
 * 最后再吸收 len(A)||len(C)（各 64 位大端比特长度）。
 * @returns {Uint8Array} 16 字节认证块（GCM 中还要再异或 E_K(J0) 才是 tag）
 */
export function ghash(hBytes, aadBytes, ciphertextBytes) {
  const h = hBytes instanceof Uint8Array ? hBytes : new Uint8Array(hBytes || []);
  const aad = aadBytes instanceof Uint8Array ? aadBytes : new Uint8Array(aadBytes || []);
  const ct = ciphertextBytes instanceof Uint8Array ? ciphertextBytes : new Uint8Array(ciphertextBytes || []);
  if (h.length !== 16) throw new Error(`GHASH: H 必须为 16 字节（当前 ${h.length} 字节）`);

  const hv = blockToBigInt(h, 0);
  let y = 0n;
  for (let off = 0; off < aad.length; off += 16) {
    y = ghashMul(y ^ blockToBigInt(aad, off), hv);
  }
  for (let off = 0; off < ct.length; off += 16) {
    y = ghashMul(y ^ blockToBigInt(ct, off), hv);
  }
  const lenBlock = (BigInt(aad.length) * 8n << 64n) | (BigInt(ct.length) * 8n);
  y = ghashMul(y ^ lenBlock, hv);
  return bigIntToBlock(y);
}

// ============================================================
// nonce 重用恢复（ChaCha20-Poly1305）
// ============================================================

function parseTwoHexBlobs(text) {
  let s = String(text == null ? "" : text).trim();
  if (!s) throw new Error("请输入两组密文 hex（换行、竖线或逗号分隔）");
  s = s.replace(/0x/gi, "");
  if (!/^[0-9a-fA-F\s|,;]+$/.test(s)) {
    throw new Error("密文输入只能包含 hex 字符，以及换行/竖线/逗号分隔符");
  }
  const parts = s.split(/[\s|,;]+/).filter(Boolean);
  if (parts.length !== 2) {
    throw new Error(`需要恰好两组 hex（当前 ${parts.length} 组）；每组内部不要换行`);
  }
  const c1 = hexToBytesStrict(parts[0], "ct1", null, false);
  const c2 = hexToBytesStrict(parts[1], "ct2", null, false);
  return { c1, c2 };
}

/**
 * 同一 key+nonce 下两条 ChaCha20-Poly1305 密文的密钥流恢复。
 * opts: { key, nonce, c1, c2, known, aad, hasTag }
 * - hasTag=true 时 c1/c2 末尾 16 字节视为 tag，并验证 tag 与已知明文。
 * - 已知明文只用于恢复其长度范围内的密钥流；ct2 更长时只恢复前缀并标记 partial。
 * @returns 结构化结果（供测试与 op 展示），不返回任何伪造 tag。
 */
export function nonceReuseRecover(opts = {}) {
  const key = hexToBytesStrict(opts.key, "key", 32, false);
  const nonce = hexToBytesStrict(opts.nonce, "nonce", 12, false);
  const aad = hexToBytesStrict(opts.aad, "aad", null, true);
  const known = opts.known instanceof Uint8Array ? opts.known : new Uint8Array(opts.known || []);
  if (known.length === 0) throw new Error("已知明文不能为空（没有明文就无法恢复密钥流）");

  let c1 = opts.c1 instanceof Uint8Array ? opts.c1 : new Uint8Array(opts.c1 || []);
  let c2 = opts.c2 instanceof Uint8Array ? opts.c2 : new Uint8Array(opts.c2 || []);
  if (!c1.length) throw new Error("ct1 不能为空");
  if (!c2.length) throw new Error("ct2 不能为空");
  if (known.length > c1.length) {
    throw new Error(`已知明文 ${known.length} 字节，比 ct1（${c1.length} 字节）还长，参数不匹配`);
  }

  let tag1 = null;
  let tag2 = null;
  let tagsValid = null;
  if (opts.hasTag) {
    if (c1.length < 16) throw new Error(`ct1 只有 ${c1.length} 字节，去掉 16 字节 tag 后为空`);
    if (c2.length < 16) throw new Error(`ct2 只有 ${c2.length} 字节，去掉 16 字节 tag 后为空`);
    tag1 = c1.slice(c1.length - 16);
    c1 = c1.slice(0, c1.length - 16);
    tag2 = c2.slice(c2.length - 16);
    c2 = c2.slice(0, c2.length - 16);
    if (known.length > c1.length) {
      throw new Error(`已知明文 ${known.length} 字节，比去掉 tag 后的 ct1（${c1.length} 字节）还长，参数不匹配`);
    }

    // tag 验证同时确认「已知明文确实属于 ct1」，避免拿错样本做演示。
    const d1 = chacha20Poly1305Decrypt(key, nonce, c1, tag1, aad);
    if (!d1.ok) throw new Error("ct1 的 Poly1305 tag 验证失败：key/nonce/aad/密文不匹配");
    const prefix = d1.plaintext.slice(0, known.length);
    for (let i = 0; i < known.length; i++) {
      if (prefix[i] !== known[i]) {
        throw new Error(`已知明文与 ct1 解密结果在第 ${i} 字节不符（tag 通过但明文对不上）`);
      }
    }
    const d2 = chacha20Poly1305Decrypt(key, nonce, c2, tag2, aad);
    if (!d2.ok) throw new Error("ct2 的 Poly1305 tag 验证失败：key/nonce/aad/密文不匹配");
    tagsValid = true;
  }

  const keystream = xorPrefix(known, c1, known.length);
  const plaintext2 = xorPrefix(keystream, c2, Math.min(keystream.length, c2.length));
  // 同一 nonce 下 Poly1305 一次性密钥 = ChaCha20 block 0 的前 32 字节（RFC 8439 §2.6）。
  const otk = chacha20Block(key, 0, nonce).slice(0, 32);

  return {
    key, nonce, aad, known, c1, c2, tag1, tag2, tagsValid,
    keystream, plaintext2, otk,
    partial: plaintext2.length < c2.length,
    full: plaintext2.length === c2.length,
  };
}

// ============================================================
// op：ChaCha20-Poly1305 AEAD
// ============================================================

// RFC 8439 §2.8.2 的密文‖tag，仅作为精确测试向量指纹；不把任意 hex 当 AEAD 密文。
const RFC8439_AEAD_VECTOR =
  "d31a8d34648e60db7b86afbc53ef7ec2" +
  "a4aded51296e08fea9e2b5a736ee62d6" +
  "3dbea45e8ca9671282fafb69da92728b" +
  "1a71de0a9e060b2905d6a5b67ecd3b36" +
  "92ddbd7f2d778b8c9803aee328091b58" +
  "fab324e4fad675945585808b4831d7bc" +
  "3ff4def08e4b7a9de576d26586cec64b" +
  "6116" +
  "1ae10b594f09e26a7e902ecbd0600691";

function aeadEncode(text, p = {}) {
  const { key, nonce, aad } = keyNonceAad(p);
  const plaintext = p.inputMode === "hex"
    ? hexToBytesStrict(text, "明文 hex", null, true)
    : textToBytes(text);
  const { ciphertext, tag } = chacha20Poly1305Encrypt(key, nonce, plaintext, aad);
  return bytesToHex(concatBytes(ciphertext, tag));
}

function aeadDecode(text, p = {}) {
  const { key, nonce, aad } = keyNonceAad(p);
  const raw = hexToBytesStrict(text, "密文 hex", null, false);
  let ciphertext;
  let tag;
  if (String(p.tag == null ? "" : p.tag).trim() !== "") {
    tag = hexToBytesStrict(p.tag, "tag", 16, false);
    ciphertext = raw;
  } else {
    if (raw.length < 16) {
      throw new Error(`密文只有 ${raw.length} 字节，至少需要 16 字节 tag（或单独填写 tag 参数）`);
    }
    ciphertext = raw.slice(0, raw.length - 16);
    tag = raw.slice(raw.length - 16);
  }
  const r = chacha20Poly1305Decrypt(key, nonce, ciphertext, tag, aad);
  if (!r.ok) {
    throw new Error("认证失败：Poly1305 tag 不匹配（key/nonce/aad/密文/tag 至少有一项错误或被篡改）");
  }
  return finishBytesDecode(r.plaintext, { textMode: "hex", name: "chacha20poly1305_plain.bin" });
}

register({
  id: "chacha20Poly1305",
  cat: "modern",
  name: "ChaCha20-Poly1305 AEAD",
  desc: "RFC 8439 AEAD_CHACHA20_POLY1305：key 32B / nonce 12B / aad 均为 hex；明文可选 UTF-8 文本或 hex，加密输出 hex（密文‖16B tag，未加分隔）；解密可直接吃该 hex 或另填 tag，tag 不符立即报错。RFC 8439 §2.8.2 官方向量校验通过。",
  params: [
    { key: "key", label: "key（32B hex）", type: "text", default: "", placeholder: "808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f" },
    { key: "nonce", label: "nonce（12B hex）", type: "text", default: "", placeholder: "070000004041424344454647" },
    { key: "aad", label: "aad（hex，可空）", type: "text", default: "", placeholder: "50515253c0c1c2c3c4c5c6c7" },
    {
      key: "inputMode", label: "明文形式（仅加密方向）", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
    { key: "tag", label: "tag（16B hex，仅解密可选）", type: "text", default: "", placeholder: "留空则取密文末 16B" },
  ],
  encode: aeadEncode,
  decode: aeadDecode,
  detect: (t) => (String(t == null ? "" : t).replace(/\s+/g, "").toLowerCase() === RFC8439_AEAD_VECTOR ? 0.99 : 0),
});

// ============================================================
// op：Poly1305 MAC
// ============================================================

function poly1305Run(text, p = {}) {
  const key = hexToBytesStrict(p.key, "key", 32, false);
  const msg = p.inputMode === "hex"
    ? hexToBytesStrict(text, "消息 hex", null, true)
    : textToBytes(text);
  return bytesToHex(poly1305Mac(msg, key));
}

register({
  id: "poly1305",
  cat: "hash",
  name: "Poly1305 MAC",
  desc: "RFC 8439 §2.5 Poly1305 一次性认证码：key 为 32B hex（前 16B 是 r，后 16B 是 s），消息可选 UTF-8 文本或 hex，输出 16B tag 的 hex。key 与 nonce/消息必须一次性使用；RFC 8439 §2.5.2 官方向量校验通过。",
  params: [
    { key: "key", label: "key（32B hex）", type: "text", default: "", placeholder: "85d6be7857556d337f4452fe42d506a80103808afb0db2fd4abff6af4149f51b" },
    {
      key: "inputMode", label: "消息形式", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
  ],
  run: poly1305Run,
  detect: (t) => (String(t == null ? "" : t) === "Cryptographic Forum Research Group" ? 0.9 : 0),
});

// ============================================================
// op：GHASH
// ============================================================

function ghashRun(text, p = {}) {
  const h = hexToBytesStrict(p.H, "H", 16, false);
  const aad = hexToBytesStrict(p.aad, "aad", null, true);
  const ct = hexToBytesStrict(text, "密文 hex", null, true);
  return bytesToHex(ghash(h, aad, ct));
}

register({
  id: "ghash",
  cat: "hash",
  name: "GHASH（GCM 认证哈希）",
  desc: "NIST SP 800-38D §6.4 的 GHASH：输入 H（16B hex）、AAD（hex，可空）、密文（主输入 hex），输出 16B 认证块的 hex。GCM 的最终 tag = GHASH ⊕ E_K(J0)，本 op 只算 GHASH 本身；NIST GCM Test Case 2/4 官方向量校验通过。",
  params: [
    { key: "H", label: "H（16B hex）", type: "text", default: "", placeholder: "b83b533708bf535d0aa6e52980d53b78" },
    { key: "aad", label: "AAD（hex，可空）", type: "text", default: "", placeholder: "feedfacedeadbeeffeedfacedeadbeefabaddad2" },
  ],
  run: ghashRun,
  detect: (t) => {
    const s = String(t == null ? "" : t).replace(/\s+/g, "").toLowerCase();
    const nist2 = "0388dace60b6a392f328c2b971b2fe78";
    const nist4 = "42831ec2217774244b7221b784d0d49ce3aa212f2c02a4e035c17e2329aca12e21d514b25466931c7d8f6a5aac84aa051ba30b396a0aac973d58e091";
    return (s === nist2 || s === nist4) ? 0.9 : 0;
  },
});

// ============================================================
// op：AEAD nonce 重用恢复
// ============================================================

function nonceReuseRun(text, p = {}) {
  const { c1, c2 } = parseTwoHexBlobs(text);
  const known = p.knownMode === "hex"
    ? hexToBytesStrict(p.known, "已知明文 hex", null, false)
    : textToBytes(p.known);
  const r = nonceReuseRecover({
    key: p.key,
    nonce: p.nonce,
    aad: p.aad,
    known,
    c1,
    c2,
    hasTag: p.hasTag !== false,
  });

  const lines = [
    "ChaCha20-Poly1305 nonce 重用恢复",
    `key: ${bytesToHex(r.key)}`,
    `nonce: ${bytesToHex(r.nonce)}（两条密文使用同一 nonce）`,
    `aad: ${r.aad.length} B`,
    `ct1: ${r.c1.length} B；ct2: ${r.c2.length} B${r.tag1 ? "（已剥离 16B tag）" : "（按无 tag 输入处理）"}`,
    `已知明文 P1: ${r.known.length} B`,
    "",
    `密钥流（P1 ⊕ C1，${r.keystream.length} B）:`,
    bytesToHex(r.keystream),
    "",
  ];
  const p2text = decodeUtf8Lossless(r.plaintext2);
  lines.push(`恢复的 P2（${r.plaintext2.length}/${r.c2.length} B${r.partial ? "，仅前缀" : "，完整"}）:`);
  lines.push(p2text.ok ? p2text.text : `（非 UTF-8，hex）${bytesToHex(r.plaintext2)}`);
  lines.push("");
  if (r.tag1) {
    lines.push(`tag 验证: ct1 ${r.tagsValid ? "通过" : "未验证"}；ct2 ${r.tagsValid ? "通过" : "未验证"}`);
    lines.push("两条密文在同一 key+nonce 下都能通过认证，但这并不提供跨密文的安全性。");
  } else {
    lines.push("未提供 tag：本模式不做认证校验，仅演示 C1⊕P1 恢复密钥流。");
  }
  lines.push(`Poly1305 一次性密钥（ChaCha20 block0 前 32B，两条密文相同）: ${bytesToHex(r.otk)}`);
  lines.push("安全边界：本 op 只恢复密钥流/另一侧明文，不自动伪造 tag；GCM 的 forbidden attack 不在本 op 实现范围。");
  if (r.partial) lines.push("注意：ct2 比已知明文长，只有前缀被恢复；提供更长的 P1 才能恢复完整 P2。");
  return lines.join("\n");
}

register({
  id: "aeadNonceReuse",
  cat: "crypto",
  name: "AEAD nonce 重用（ChaCha20-Poly1305）",
  desc: "同一 key+nonce 下两条 ChaCha20-Poly1305 密文的已知明文攻击：主输入粘贴两组密文 hex（换行/竖线/逗号分隔，默认各含末尾 16B tag），再填其中一侧明文，即可恢复 ChaCha20 密钥流并解出另一侧明文；默认验证两条 tag。范围仅限 ChaCha20-Poly1305 的 keystream 重用，不含 GCM forbidden attack。",
  params: [
    { key: "key", label: "key（32B hex）", type: "text", default: "", placeholder: "两条密文共用的 key" },
    { key: "nonce", label: "nonce（12B hex）", type: "text", default: "", placeholder: "两条密文共用的 nonce" },
    { key: "aad", label: "aad（hex，可空）", type: "text", default: "", placeholder: "验证 tag 时使用" },
    {
      key: "knownMode", label: "已知明文形式", type: "select", default: "text",
      options: [
        { value: "text", label: "UTF-8 文本" },
        { value: "hex", label: "Hex 字节" },
      ],
    },
    { key: "known", label: "已知明文 P1", type: "text", default: "", placeholder: "与 ct1 对应的明文（至少 1 字节）" },
    { key: "hasTag", label: "两组密文末尾含 16B tag", type: "bool", default: true },
  ],
  run: nonceReuseRun,
  detect: (t) => {
    const s = String(t == null ? "" : t).trim().replace(/0x/gi, "");
    if (!s || /[^0-9a-fA-F\s|,;]/.test(s)) return 0;
    const parts = s.split(/[\s|,;]+/).filter(Boolean);
    if (parts.length !== 2) return 0;
    if (parts.every((x) => x.length >= 32 && x.length % 2 === 0)) return 0.55;
    return 0;
  },
});
