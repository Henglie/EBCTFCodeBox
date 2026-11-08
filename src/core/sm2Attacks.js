// SM2 misuse analysis: draft-shen-sm2-ecdsa-02 sections 5.2.1 and 7.2.1.
import { register } from "./registry.js";
import { CURVE, onCurve, ptMul, ptAffine, sm2Kdf, computeZa } from "./sm2.js";
import { sm3Bytes } from "./hashExt.js";
import { hexToBytes, bytesToHex, decodeUtf8Lossless } from "./bytesIo.js";
const { n, p, Gx, Gy } = CURVE;
const mod = a => ((a % n) + n) % n;
function inverse(value) {
  let a = mod(value), b = n, x = 1n, y = 0n;
  if (!a) throw new Error("方程退化：分母为 0，无法唯一恢复私钥 / Degenerate equation");
  while (b) { const q = a / b; [a, b] = [b, a - q * b]; [x, y] = [y, x - q * y]; }
  return mod(x);
}
function hex(value, label) {
  const text = String(value ?? "").trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (text.length > 2 * 1024 * 1024) throw new Error(`${label}: 最大 1 MiB / maximum 1 MiB`);
  if (!text) throw new Error(`${label}: 不能为空 / required`);
  return hexToBytes(text);
}
function point(bytes, label) {
  if (bytes.length !== 64) throw new Error(`${label}: 点坐标须为 64 字节 / 64-byte x||y required`);
  const x = BigInt("0x" + bytesToHex(bytes.subarray(0, 32))), y = BigInt("0x" + bytesToHex(bytes.subarray(32)));
  if (x >= p || y >= p || !onCurve(x, y)) throw new Error(`${label}: 不是有效的 sm2p256v1 点 / invalid point`);
  return [x, y];
}
function parseCipher(value, order, encoding, label) {
  if (!["c1c3c2", "c1c2c3"].includes(order)) throw new Error("密文顺序仅支持 C1C3C2 / C1C2C3");
  if (!["04", "xy"].includes(encoding)) throw new Error("C1 编码仅支持 04||x||y / x||y");
  const bytes = hex(value, label), start = encoding === "04" ? 65 : 64;
  if (bytes.length <= start + 32) throw new Error(`${label}: 密文过短，须含非空 C2 / ciphertext too short`);
  if (encoding === "04" && bytes[0] !== 4) throw new Error(`${label}: 非压缩点前缀须为 04 / expected 04 prefix`);
  const c1 = bytes.subarray(start - 64, start);
  point(c1, `${label} C1`);
  return { c1, c2: order === "c1c3c2" ? bytes.subarray(start + 32) : bytes.subarray(start, bytes.length - 32), c3: order === "c1c3c2" ? bytes.subarray(start, start + 32) : bytes.subarray(bytes.length - 32) };
}
export function recoverSM2Plaintext(options = {}) {
  const { knownCipher, targetCipher, known, knownEncoding = "text", order1 = "c1c3c2", order2 = "c1c3c2", c1Encoding = "04", cipherFormat = "full", offset = 0 } = options;
  if (!["full", "c2"].includes(cipherFormat)) throw new Error("密文输入格式须为 full / c2");
  const first = cipherFormat === "c2" ? { c2: hex(knownCipher, "C2_known") } : parseCipher(knownCipher, order1, c1Encoding, "已知密文 / known ciphertext");
  const second = cipherFormat === "c2" ? { c2: hex(targetCipher, "C2_target") } : parseCipher(targetCipher, order2, c1Encoding, "目标密文 / target ciphertext");
  if (cipherFormat === "full" && bytesToHex(first.c1) !== bytesToHex(second.c1)) throw new Error("C1 不同：临时随机数复用前提不成立 / C1 mismatch");
  if (!["text", "hex"].includes(knownEncoding)) throw new Error("已知明文编码须为 text / hex");
  const message = knownEncoding === "hex" ? hex(known, "已知明文 / known plaintext") : new TextEncoder().encode(String(known ?? ""));
  if (!message.length || message.length > 1024 * 1024) throw new Error("已知明文须为 1 B–1 MiB / invalid known plaintext length");
  const pos = Number(offset);
  if (!Number.isSafeInteger(pos) || pos < 0 || pos >= second.c2.length || pos + message.length > first.c2.length) throw new Error("已知明文偏移或长度越界 / known plaintext out of bounds");
  const length = Math.min(message.length, second.c2.length - pos);
  const keystream = message.map((byte, i) => byte ^ first.c2[pos + i]);
  const recovered = second.c2.slice(pos, pos + length).map((byte, i) => byte ^ keystream[i]);
  return { recovered, keystream, offset: pos, targetLength: second.c2.length, partial: pos !== 0 || length !== second.c2.length, c1Checked: cipherFormat === "full", c3Verified: false };
}
function integer(value, label, digest = false) {
  const text = String(value ?? "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{1,64}$/.test(text)) throw new Error(`${label}: 需要最多 64 位 hex / hexadecimal integer required`);
  const number = BigInt("0x" + text);
  if (!digest && (number < 1n || number >= n)) throw new Error(`${label}: 须在 [1,n-1] / out of range`);
  return number;
}
export function recoverSM2SigningKey(data, mode = "reuse") {
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("输入须为 JSON 对象 / JSON object required");
  data = { ...data };
  for (const i of [1, 2]) if (data[`signature${i}`] != null) {
    const signature = hex(data[`signature${i}`], `signature${i}`);
    if (signature.length !== 64) throw new Error("签名须为 64B r||s / raw signature must be 64 bytes");
    data[`r${i}`] = bytesToHex(signature.subarray(0, 32)); data[`s${i}`] = bytesToHex(signature.subarray(32));
  }
  if (mode === "cross") return recoverSM2CrossUserNonce(data);
  if (!["reuse", "known", "related"].includes(mode)) throw new Error("攻击档须为 reuse / known / related");
  const r1 = integer(data.r1, "r1"), s1 = integer(data.s1, "s1"), e1 = integer(data.e1, "e1", true);
  let d, k, second = null;
  if (mode === "known") {
    k = integer(data.k, "k"); d = mod((k - s1) * inverse(r1 + s1));
  } else {
    const r2 = integer(data.r2, "r2"), s2 = integer(data.s2, "s2"), e2 = integer(data.e2, "e2", true);
    const a = mode === "related" ? integer(data.a, "a", true) : 1n;
    const b = mode === "related" ? integer(data.b, "b", true) : 0n;
    d = mod((s2 - a * s1 - b) * inverse(a * (r1 + s1) - r2 - s2));
    k = mod(s1 + (r1 + s1) * d); second = { r: r2, s: s2, e: e2 };
    second.k = mod(a * k + b);
  }
  if (d < 1n || d >= n - 1n || k < 1n || k >= n) throw new Error("恢复结果不在 SM2 签名合法范围 / invalid recovered scalar");
  for (const sig of [{ r: r1, s: s1, e: e1 }, ...(second ? [second] : [])]) {
    const nonce = sig.k ?? k;
    if (!nonce) throw new Error("关联随机数为 0 / invalid related nonce");
    const R = ptAffine(ptMul(nonce, [Gx, Gy]));
    if (sig.r + nonce === n || mod(sig.e + R[0]) !== sig.r || mod(sig.s * (1n + d)) !== mod(nonce - sig.r * d)) throw new Error("签名/摘要不满足给定 k 关系的 SM2 方程 / signature or digest does not match");
  }
  const Q = ptAffine(ptMul(d, [Gx, Gy]));
  const publicKey = "04" + Q.map(v => v.toString(16).padStart(64, "0")).join("");
  if (data.publicKey != null && String(data.publicKey).trim()) {
    let pub = hex(data.publicKey, "publicKey");
    if (pub.length === 65 && pub[0] === 4) pub = pub.subarray(1);
    point(pub, "publicKey");
    if (bytesToHex(pub) !== publicKey.slice(2)) throw new Error("恢复私钥与提供公钥不匹配 / public key mismatch");
  }
  return { privateKey: d.toString(16).padStart(64, "0"), nonce: k.toString(16).padStart(64, "0"), publicKey, signaturesChecked: second ? 2 : 1 };
}
export function recoverSM2CrossUserNonce(data) {
  const d1 = integer(data.d1, "d1"), r1 = integer(data.r1, "r1"), s1 = integer(data.s1, "s1"), r2 = integer(data.r2, "r2"), s2 = integer(data.s2, "s2");
  if (d1 >= n - 1n) throw new Error("SM2 签名私钥须小于 n-1 / invalid signing key");
  const k = mod(s1 + (r1 + s1) * d1), d2 = mod((k - s2) * inverse(r2 + s2));
  if (!k || !d2 || d2 >= n - 1n) throw new Error("恢复结果不在有效范围 / invalid recovered key");
  const Q1 = ptAffine(ptMul(d1, [Gx, Gy])), Q2 = ptAffine(ptMul(d2, [Gx, Gy]));
  const digest = (i, Q) => {
    if (data[`e${i}`] != null) return integer(data[`e${i}`], `e${i}`, true);
    if (typeof data[`message${i}`] !== "string") throw new Error(`需要 e${i} 或 UTF-8 message${i} / digest or message required`);
    const id = new TextEncoder().encode(data[`id${i}`] ?? "1234567812345678");
    if (id.length > 8191) throw new Error("SM2 ID 超过 65535 bits / identifier too long");
    const za = computeZa(id, ...Q), message = new TextEncoder().encode(data[`message${i}`]), input = new Uint8Array(za.length + message.length);
    input.set(za); input.set(message, za.length);
    return BigInt("0x" + bytesToHex(sm3Bytes(input)));
  };
  const e1 = digest(1, Q1), e2 = digest(2, Q2), R = ptAffine(ptMul(k, [Gx, Gy]));
  if (r1 + k === n || r2 + k === n || mod(e1 + R[0]) !== r1 || mod(e2 + R[0]) !== r2) throw new Error("两用户签名不满足同一 k / cross-user signatures do not share the nonce");
  const result = recoverSM2SigningKey({ r1: data.r2, s1: data.s2, e1: e2.toString(16), k: k.toString(16), publicKey: data.publicKey2 }, "known");
  return { ...result, signaturesChecked: 2, knownKeyUser: 1, recoveredKeyUser: 2 };
}
export function decryptSM2LeakedK(ciphertext, options = {}) {
  const cipher = parseCipher(ciphertext, options.order || "c1c3c2", options.c1Encoding || "04", "ciphertext");
  const k = integer(options.k, "k");
  let pub = hex(options.publicKey, "publicKey");
  if (pub.length === 65 && pub[0] === 4) pub = pub.subarray(1);
  const Q = point(pub, "publicKey"), C1 = ptAffine(ptMul(k, [Gx, Gy]));
  const bigBytes = v => hexToBytes(v.toString(16).padStart(64, "0"));
  if (bytesToHex(cipher.c1) !== C1.map(v => v.toString(16).padStart(64, "0")).join("")) throw new Error("k 与 C1 不匹配 / k does not match C1");
  const S = ptAffine(ptMul(k, Q)), z = new Uint8Array(64);
  z.set(bigBytes(S[0])); z.set(bigBytes(S[1]), 32);
  const stream = sm2Kdf(z, cipher.c2.length * 8);
  if (!stream.some(Boolean)) throw new Error("SM2 KDF 输出全零 / zero KDF");
  const recovered = cipher.c2.map((byte, i) => byte ^ stream[i]);
  const check = new Uint8Array(64 + recovered.length);
  check.set(z.subarray(0, 32)); check.set(recovered, 32); check.set(z.subarray(32), 32 + recovered.length);
  if (bytesToHex(sm3Bytes(check)) !== bytesToHex(cipher.c3)) throw new Error("C3 校验失败 / C3 authentication failed");
  return recovered;
}
const orders = [{ value: "c1c3c2", label: "C1C3C2" }, { value: "c1c2c3", label: "C1C2C3" }];
register({
  id: "sm2KnownPlaintext", cat: "crypto", name: "SM2 已知明文攻击（随机数复用）",
  desc: "同一接收方公钥、相同 C1 的两条 SM2 密文，利用一侧已知明文片段恢复另一侧对应字节。无需私钥；仅恢复覆盖范围，不验证 C3，也不恢复私钥。",
  io: "text", autoRun: false,
  params: [
    { key: "cipherFormat", label: "密文输入格式（主输入与已知密文一致）", type: "select", default: "full", options: [{ value: "full", label: "完整密文（检查 C1）" }, { value: "c2", label: "仅 C2（题面已明确复用相同 k/公钥）" }] },
    { key: "knownCipher", label: "已知明文对应密文（完整密文或 C2 hex）", type: "textarea", default: "", rows: 3 },
    { key: "known", label: "已知明文或片段", type: "textarea", default: "", rows: 3 },
    { key: "knownEncoding", label: "已知明文形式", type: "select", default: "text", options: [{ value: "text", label: "UTF-8" }, { value: "hex", label: "Hex" }] },
    { key: "offset", label: "片段在明文中的字节偏移（从 0 起）", type: "number", default: 0, min: 0 },
    { key: "order1", label: "已知密文顺序", type: "select", default: "c1c3c2", options: orders },
    { key: "order2", label: "目标密文顺序", type: "select", default: "c1c3c2", options: orders },
    { key: "c1Encoding", label: "两条密文的 C1 编码", type: "select", default: "04", options: [{ value: "04", label: "04 || x || y（65 B）" }, { value: "xy", label: "x || y（64 B，无前缀）" }] },
  ],
  run(text, params = {}) {
    const result = recoverSM2Plaintext({ ...params, targetCipher: text }), decoded = decodeUtf8Lossless(result.recovered);
    return { text: ["SM2 已知明文 / Known-plaintext recovery", "前提 / Assumption: same recipient public key + reused k (identical C1)",
      `C1 checked: ${result.c1Checked}${result.c1Checked ? "" : " (C2-only; nonce/key reuse must be established externally)"}`,
      `恢复范围 / Recovered: offset=${result.offset}, bytes=${result.recovered.length}/${result.targetLength}, partial=${result.partial}`,
      `Hex: ${bytesToHex(result.recovered)}`, decoded.ok ? `UTF-8: ${decoded.text}` : "UTF-8: invalid; use Hex or download",
      `密钥流 / Keystream: ${bytesToHex(result.keystream)}`, "C3 未验证 / NOT authenticated; recipient equality is an external prerequisite. Private key NOT recovered."].join("\n"),
      files: [{ name: "sm2-recovered.bin", mime: "application/octet-stream", bytes: result.recovered }] };
  },
});
register({
  id: "sm2NonceRecover", cat: "crypto", name: "SM2 签名随机数攻击（私钥恢复）",
  desc: "已知签名 k，或同一私钥两次签名复用 k，按 SM2 方程恢复私钥。输入 JSON 的 r1/s1/e1、r2/s2/e2 或 k 均为 hex；e=SM3(ZA||M)。校验签名方程，可选公钥交叉验证。",
  io: "text", autoRun: false,
  params: [{ key: "attackMode", label: "攻击条件", type: "select", default: "reuse", options: [{ value: "reuse", label: "两次签名复用 k" }, { value: "known", label: "一次签名 k 泄露" }, { value: "related", label: "关联随机数 k2 = a*k1 + b（JSON 增加 a/b hex）" }, { value: "cross", label: "跨用户共用 k（已知 d1，恢复 d2；可填完整 signature1/2 与 message1/2）" }] }],
  run(text, params = {}) {
    if (String(text).length > 8192) throw new Error("签名 JSON 最大 8 KiB / input too large");
    let data;
    try { data = JSON.parse(text); } catch { throw new Error("输入 JSON：{r1,s1,e1,r2,s2,e2} 或 {r1,s1,e1,k}，值为 hex"); }
    const r = recoverSM2SigningKey(data, params.attackMode || "reuse");
    return ["SM2 签名私钥恢复 / Signing key recovery", `d = ${r.privateKey}`, `k = ${r.nonce}`, `publicKey = ${r.publicKey}`,
      `已校验 / Checked: ${r.signaturesChecked} signature equation(s) with supplied e=SM3(ZA||M).`, "未自行核对原文与 ZA / Message and ZA binding depends on the supplied digest."].join("\n");
  },
});
register({
  id: "sm2LeakedK", cat: "crypto", name: "SM2 加密随机数泄露解密",
  desc: "已知加密临时随机数 k 与接收方公钥，无需私钥恢复 SM2 明文；核对 C1=[k]G 并验证 C3。",
  io: "text", autoRun: false,
  params: [
    { key: "k", label: "泄露的临时随机数 k（hex）", type: "text", default: "", sensitive: true },
    { key: "publicKey", label: "接收方公钥（hex，04||x||y 或 x||y）", type: "textarea", default: "", rows: 3 },
    { key: "order", label: "密文顺序", type: "select", default: "c1c3c2", options: orders },
    { key: "c1Encoding", label: "C1 编码", type: "select", default: "04", options: [{ value: "04", label: "04 || x || y" }, { value: "xy", label: "x || y" }] },
  ],
  run(text, params = {}) {
    const bytes = decryptSM2LeakedK(text, params), decoded = decodeUtf8Lossless(bytes);
    return { text: `C1 / C3: verified\nHex: ${bytesToHex(bytes)}\nUTF-8: ${decoded.ok ? decoded.text : "invalid; download binary"}`, files: [{ name: "sm2-decrypted.bin", mime: "application/octet-stream", bytes }] };
  },
});
