// Block-mode misuse applies to SM4 as specified by SP 800-38A/D and RFC 8998.
import { register, getOp } from "./registry.js";
import "./gcmAttack.js";
import { hexToBytes, bytesToHex, decodeUtf8Lossless } from "./bytesIo.js";
function hex(value) {
  const text = String(value ?? "").trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (text.length > 2097152) throw new Error("输入最大 1 MiB / maximum 1 MiB");
  return hexToBytes(text);
}
const product = (bytes, text, name) => ({ text, files: [{ name, mime: "application/octet-stream", bytes }] });
export function recoverReusedStream(cipher1, cipher2, known, offset = 0) {
  const a = hex(cipher1), b = hex(cipher2), plain = hex(known), pos = Number(offset);
  if (!plain.length || !Number.isSafeInteger(pos) || pos < 0 || pos + plain.length > a.length || pos >= b.length) throw new Error("明文/偏移范围无效 / invalid plaintext or offset");
  const count = Math.min(plain.length, b.length - pos);
  const bytes = b.slice(pos, pos + count).map((v, i) => v ^ a[pos + i] ^ plain[i]);
  return { bytes, offset: pos, partial: pos !== 0 || count !== b.length };
}
export function sm4CbcFlip(ivCiphertext, known, desired, offset = 0) {
  const bytes = hex(ivCiphertext), from = hex(known), to = hex(desired), pos = Number(offset);
  if (bytes.length < 32 || bytes.length % 16) throw new Error("输入须为 IV(16B)||完整 CBC 密文块 / IV and whole CBC blocks required");
  if (!from.length || from.length !== to.length || !Number.isSafeInteger(pos) || pos < 0 || pos + from.length > bytes.length - 16) throw new Error("替换片段须非空等长且不越界 / invalid replacement range");
  if (Math.floor(pos / 16) !== Math.floor((pos + from.length - 1) / 16)) throw new Error("一次替换不得跨 16B 明文块 / replacement crosses a block");
  for (let i = 0; i < from.length; i++) bytes[pos + i] ^= from[i] ^ to[i];
  return { bytes, damagedBlock: pos >= 16 ? Math.floor(pos / 16) - 1 : null };
}
export function sm4EcbRecover(target, pairs) {
  const bytes = hex(target);
  if (!bytes.length || bytes.length % 16) throw new Error("目标密文须为非空 16B 整块 / whole blocks required");
  const rows = String(pairs ?? "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!rows.length || rows.length > 4096) throw new Error("码本须为 1–4096 行 / invalid codebook size");
  const map = new Map();
  for (const row of rows) {
    const parts = row.split("|");
    if (parts.length !== 2) throw new Error("码本每行 plaintextHex|ciphertextHex / invalid codebook row");
    const plain = hex(parts[0]), cipher = hex(parts[1]);
    if (plain.length !== 16 || cipher.length !== 16) throw new Error("码本每项须为 16B 明文与密文 / 16-byte blocks required");
    const key = bytesToHex(cipher), value = bytesToHex(plain);
    if (map.has(key) && map.get(key) !== value) throw new Error("同一密文对应冲突明文 / conflicting codebook");
    map.set(key, value);
  }
  const blocks = [];
  for (let off = 0; off < bytes.length; off += 16) blocks.push(map.get(bytesToHex(bytes.subarray(off, off + 16))) ?? null);
  return { blocks, complete: blocks.every(v => v != null) };
}
for (const [id, name, assumption] of [
  ["sm4CtrReuse", "SM4-CTR/OFB 密钥流复用攻击", "同一 SM4 key、相同 IV/计数器起点与流偏移；CTR/OFB raw ciphertext only"],
  ["zucNonceReuse", "ZUC 密钥流复用攻击", "同一 ZUC key+IV 与流偏移；raw ciphertext only"],
]) register({
  id, cat: "crypto", name, desc: `${assumption}。两条密文与一侧已知明文恢复另一侧覆盖字节；不恢复密钥，不验证 MAC。`, io: "text", autoRun: false,
  params: [
    { key: "cipher1", label: "已知明文对应密文（hex，无 tag）", type: "textarea", rows: 3, default: "" },
    { key: "known", label: "已知明文片段（hex）", type: "textarea", rows: 3, default: "" },
    { key: "offset", label: "片段字节偏移（从 0 起）", type: "number", default: 0, min: 0 },
  ],
  run(text, params = {}) {
    const r = recoverReusedStream(params.cipher1, text, params.known, params.offset);
    const decoded = decodeUtf8Lossless(r.bytes);
    return product(r.bytes, `${assumption}\noffset=${r.offset}, partial=${r.partial}\nHex: ${bytesToHex(r.bytes)}\nUTF-8: ${decoded.ok ? decoded.text : "invalid; download binary"}\n仅条件性恢复，未验证认证码 / Conditional recovery; NOT authenticated.`, `${id}-recovered.bin`);
  },
});
register({
  id: "sm4CbcBitflip", cat: "crypto", name: "SM4-CBC 位翻转构造",
  desc: "已知一段明文，修改 IV 或前一密文块，构造同长度目标片段；无 MAC 的 CBC 才可用。修改非首块会破坏前一明文块。主输入 IV||ciphertext hex。", io: "text", autoRun: false,
  params: [
    { key: "known", label: "原明文片段（hex）", type: "text", default: "" },
    { key: "desired", label: "目标明文片段（hex，等长）", type: "text", default: "" },
    { key: "offset", label: "片段绝对字节偏移（从 0 起）", type: "number", min: 0, default: 0 },
  ],
  run(text, params = {}) {
    const r = sm4CbcFlip(text, params.known, params.desired, params.offset);
    return product(r.bytes, `IV||ciphertext: ${bytesToHex(r.bytes)}\n前一明文块损坏 / Damaged preceding plaintext block (0-based): ${r.damagedBlock ?? "none (IV modified)"}\n不绕过 MAC/AEAD / Does NOT bypass MAC or AEAD.`, "sm4-cbc-forged.bin");
  },
});
register({
  id: "sm4EcbCodebook", cat: "crypto", name: "SM4-ECB 已知明文码本攻击",
  desc: "同一密钥下，完整 16B 明密文块组成码本，恢复目标密文中的已知块。未匹配块保留未知，不推测密钥或未知字节。主输入目标密文 hex。", io: "text", autoRun: false,
  params: [{ key: "pairs", label: "每行 16B plaintextHex|ciphertextHex（同一 key）", type: "textarea", default: "", rows: 5 }],
  run(text, params = {}) {
    const r = sm4EcbRecover(text, params.pairs), lines = r.blocks.map((v, i) => `${i}: ${v ?? "UNKNOWN"}`);
    const report = `complete=${r.complete}\n${lines.join("\n")}\n前提：同一 SM4-ECB key / same key required; padding is retained.`;
    return r.complete ? product(hexToBytes(r.blocks.join("")), report, "sm4-ecb-recovered.bin") : report;
  },
});
const gcm = getOp("gcmForbidden");
register({
  id: "sm4GcmForgery", cat: "crypto", name: "SM4-GCM nonce 重用认证伪造",
  desc: "同一 key+nonce 的至少两条 SM4-GCM 样本 aadHex|ctHex|tagHex，恢复 GHASH H 与认证掩码并伪造 tag；完整 16B tag，推荐第三条样本筛候选。不恢复 SM4 key。", io: "text", autoRun: false,
  params: gcm.params.filter(d => d.key !== "mode" && d.key !== "known").map(d => ({ ...d })),
  run(text, params = {}) {
    if (String(params.samples || text).length > 65536 || String(params.samples || text).split(/\n/).length > 32) throw new Error("最多 32 条样本 / 最大 64 KiB / sample budget exceeded");
    const out = gcm.run(text, { ...params, mode: "forbidden" });
    return { ...out, text: out.text.replace(/AES-GCM/g, "SM4-GCM").replace(/AES 本体/g, "SM4 本体") };
  },
});
