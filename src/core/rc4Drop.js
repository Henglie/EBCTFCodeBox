/*
 * rc4Drop.js — RC4-drop[n] / CipherSaber-2（cat:'stream'）。
 *
 * 原理（照权威来源，未编造）：
 *  - RC4 是流密码：KSA 用密钥打乱 256 字节状态盒 S，PRGA 逐字节产出密钥流，密文 = 明文 XOR 密钥流（自反）。
 *  - 早期密钥流有强偏置（Roos/ Fluhrer-McGrew / Mantin / Mironov 等分析），实践上丢弃前 n 字节再取用，
 *    记作 RC4-drop[n]。RFC 6229 以「流偏移」形式给出各偏移处的密钥流向量，其中偏移 768 与 3072
 *    对应 SANS 建议，偏移 1536 对应 RFC 4345 建议。
 *  - CipherSaber-2（CS2，Arnold Reinhold 2003）在 RC4 之上加两条改造：① 每条报文的 RC4 密钥 =
 *    用户密钥 ‖ 10 字节 IV（IV 随机、随密文前置）；② KSA 重复 r 轮（推荐 r ≥ 20），以缓解 RC4 密钥
 *    调度偏置。CS1 即 r = 1 的特例。
 *
 * 权威来源：
 *  - RFC 6229《Test Vectors for the Stream Cipher RC4》（Informational，2011-05，J. Strombergson /
 *    S. Josefsson，https://www.rfc-editor.org/rfc/rfc6229.txt），访问日期 2026-09-23：
 *    两组密钥（Key1 = 01 02 03 … 递增；Key2 = SHA-256("Internet Engineering Task Force") 截断取低位）
 *    × 七种密钥长度（40/56/64/80/128/192/256 位），在流偏移 0/256/512/768/1024/1536/2048/3072/4096
 *    各给出 16 字节密钥流；并说明偏移 768、3072 = SANS 建议、偏移 1536 = RFC 4345 建议。
 *    本 op 的 drop 参数即该「偏移」：drop=768 时取偏移 768 起的密钥流，逐字节对拍该 RFC 表格。
 *  - Arnold G. Reinhold, CipherSaber（http://ciphersaber.gurus.org/），访问日期 2026-09-23：
 *    CS1 规范（10 字节 IV 前置、RC4 密钥 = 用户密钥 ‖ IV）；首页明示「I recommend that CipherSaber
 *    users switch to CipherSaber-2 with a parameter N=20 or larger」。
 *  - CipherSaber-2 规范伪码与测试实例（Bart Massey 的 CS2 实现，其 README 自述
 *    "tested against and is compatible with existing CipherSaber implementations"，
 *    https://github.com/BartMassey/ciphersaber2，访问日期 2026-09-23）：给出 rc4(n, r, k) 的 KSA 重复
 *    与 PRGA 伪码、encrypt/decrypt 伪码（IV 10 字节前置、k' = k ‖ iv），并给出取自原始 CipherSaber
 *    资料的向量 cstest.cs2（明文 "This is a test of CipherSaber-2."、密钥 "asdfg"、r = 10）。
 *  - Adam Back「Ciphersaber Memorable Test Vectors」（http://cypherspace.org/adam/csvec/，经上述
 *    CipherSaber 官方页与本实现 README 引述，访问日期 2026-09-23）：r = 20 的人机可记向量——
 *    密文输入 "Al Dakota guts"、密钥 "Al" ↔ 明文 "held"。
 *
 * 参数与取值（覆盖权威定义的参数面）：
 *  - mode：drop（RC4-drop[n]，默认）| cipherSaber2（CS2）。
 *  - drop：丢字节数 n（整数 ≥ 0），默认 768。标准取值点：0 / 256 / 768 / 1024 / 1536 / 3072 / 4096。
 *  - ksaRounds：CS2 的 KSA 重复轮数 r（整数 ≥ 1），默认 20；r = 1 即 CS1。
 *  - key / keyEnc：密钥及其编码（utf8 / hex / base64 / latin1）。
 *  - iv / ivEnc：CS2 的 10 字节 IV（仅 CS2 加密方向需要；解码方向从密文前 10 字节读取）。
 *  - outEnc：密文编码（base64 / hex）。
 *  - 不内置随机数：CS2 加密必须显式给出 IV，保证结果可复现（工具语义，非协议语义）。
 *
 * 约定：
 *  - 两个方向都是 XOR 流，encode/decode 同核；CS2 的差别仅在「加密前置 IV / 解密剥离 IV」。
 *  - drop 模式下空输入返回空串；CS2 解码时若密文不足 10 字节（无完整 IV）显式报错。
 *
 * 契约：register({id, cat:"stream", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

// ---- 编解码小工具（自足，无外部依赖） ----
const te = (s) => new TextEncoder().encode(s);
const td = (b) => new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(b));

function hexToBytes(s) {
  const t = String(s == null ? "" : s).replace(/\s+/g, "");
  if (t.length % 2) throw new Error("十六进制串长度须为偶数：" + t.length);
  const o = new Uint8Array(t.length / 2);
  for (let i = 0; i < o.length; i++) {
    const v = parseInt(t.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(v)) throw new Error("非法十六进制字符：" + t.slice(i * 2, i * 2 + 2));
    o[i] = v;
  }
  return o;
}
function bytesToHex(b) {
  let s = "";
  for (const x of b) s += x.toString(16).padStart(2, "0");
  return s;
}
function b64ToBytes(s) {
  const t = String(s == null ? "" : s).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(t)) throw new Error("非法 Base64 串。");
  const bin = atob(t);
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}
function bytesToB64(b) {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function decodeInput(text, enc) {
  switch (enc) {
    case "hex": return hexToBytes(text);
    case "base64": return b64ToBytes(text);
    case "latin1": {
      const s = String(text == null ? "" : text);
      const o = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 0xff;
      return o;
    }
    case "utf16":
    case "utf16be": {
      const s = String(text == null ? "" : text);
      const o = new Uint8Array(s.length * 2);
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o[i * 2] = (c >> 8) & 0xff; o[i * 2 + 1] = c & 0xff; }
      return o;
    }
    case "utf16le": {
      const s = String(text == null ? "" : text);
      const o = new Uint8Array(s.length * 2);
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); o[i * 2] = c & 0xff; o[i * 2 + 1] = (c >> 8) & 0xff; }
      return o;
    }
    case "utf8":
    default: return te(text);
  }
}
function encodeOutput(bytes, enc) {
  switch (enc) {
    case "hex": return bytesToHex(bytes);
    case "base64": return bytesToB64(bytes);
    case "latin1": {
      let s = "";
      for (const x of bytes) s += String.fromCharCode(x);
      return s;
    }
    case "utf16":
    case "utf16be":
    case "utf16le": {
      const le = enc === "utf16le";
      let s = "";
      for (let i = 0; i + 1 < bytes.length; i += 2) s += String.fromCharCode(le ? (bytes[i] | (bytes[i + 1] << 8)) : ((bytes[i] << 8) | bytes[i + 1]));
      return s;
    }
    case "utf8":
    default: return td(bytes);
  }
}

// ---- RC4 内核 ----
/**
 * RC4 KSA（可重复 r 轮）+ PRGA，先丢弃 drop 字节再产出 len 字节密钥流。
 * @param {Uint8Array} key RC4 密钥（仅前 256 字节参与）
 * @param {number} len 需要的密钥流字节数
 * @param {number} drop 丢弃的密钥流前缀字节数（RFC 6229 的「流偏移」）
 * @param {number} rounds KSA 重复轮数（标准 RC4 = 1）
 */
function rc4Keystream(key, len, drop, rounds) {
  if (!key.length) throw new Error("RC4：密钥为空。");
  const r = Number(rounds);
  if (!Number.isInteger(r) || r < 1) throw new Error(`RC4：KSA 轮数须为 ≥1 的整数（当前 ${rounds}）。`);
  const n = Number(drop);
  if (!Number.isInteger(n) || n < 0) throw new Error(`RC4：丢弃字节数须为 ≥0 的整数（当前 ${drop}）。`);
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let k = 0; k < r; k++) {
    for (let i = 0; i < 256; i++) {
      j = (j + S[i] + key[i % key.length]) & 0xff;
      const t = S[i]; S[i] = S[j]; S[j] = t;
    }
  }
  const out = new Uint8Array(len);
  let i = 0; j = 0;
  // 丢弃前 drop 字节（同一条 PRGA 流）
  for (let k = 0; k < drop; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  for (let k = 0; k < len; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
    out[k] = S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

/** RC4-drop[n] 加解密（自反）。 */
function rc4DropCrypt(data, key, drop) {
  const ks = rc4Keystream(key, data.length, drop, 1);
  const out = new Uint8Array(data.length);
  for (let k = 0; k < data.length; k++) out[k] = data[k] ^ ks[k];
  return out;
}

/** CipherSaber-2 加解密：k' = 用户密钥 ‖ IV(10)，KSA 重复 r 轮，密文 = IV ‖ 载荷。 */
function cipherSaber2Crypt(data, key, iv, rounds, decrypt) {
  if (iv.length !== 10) throw new Error(`CipherSaber-2：IV 须为 10 字节（当前 ${iv.length}）。`);
  const full = new Uint8Array(key.length + 10);
  full.set(key, 0);
  full.set(iv, key.length);
  const ks = rc4Keystream(full, data.length, 0, rounds);
  const out = new Uint8Array(data.length);
  for (let k = 0; k < data.length; k++) out[k] = data[k] ^ ks[k];
  return out;
}

/** 取视图真字节通道（params.rawBytes）；无则 null。 */
function rawBytesOf(p) {
  const b = p && p.rawBytes;
  if (b == null) return null;
  return b instanceof Uint8Array ? b : new Uint8Array(b);
}

/** 视图 text 模式字节与文本同构时让位给原文本层；真字节（hex/base64 视图、文件）原样优先。 */
function rawBytesOrNull(p, text) {
  const b = rawBytesOf(p);
  if (!b) return null;
  const t = new TextEncoder().encode(String(text == null ? "" : text));
  if (b.length === t.length) {
    let same = true;
    for (let i = 0; i < b.length; i++) if (b[i] !== t[i]) { same = false; break; }
    if (same) return null;
  }
  return b;
}

const ENC_OPTS = [
  { value: "utf8", label: "UTF-8" },
  { value: "hex", label: "Hex" },
  { value: "base64", label: "Base64" },
  { value: "latin1", label: "Latin-1" },
  { value: "utf16", label: "UTF-16（BE）" },
  { value: "utf16le", label: "UTF-16LE" },
  { value: "utf16be", label: "UTF-16BE" },
];
const OUT_OPTS = [
  { value: "base64", label: "Base64" },
  { value: "hex", label: "Hex" },
  ...ENC_OPTS.filter((o) => o.value !== "utf8"),
];

register({
  id: "rc4Drop", cat: "stream", name: "RC4-drop / CipherSaber-2",
  acceptsBytes: true,
  desc: "RC4-drop[n]（丢弃前 n 字节密钥流，RFC 6229 偏移档，默认 768=SANS 建议）与 CipherSaber-2（10 字节 IV 前置 + KSA 重复 r 轮，默认 r=20）",
  params: [
    { key: "mode", label: "模式", type: "select", default: "drop",
      options: [
        { value: "drop", label: "RC4-drop[n]（丢弃前 n 字节）" },
        { value: "cipherSaber2", label: "CipherSaber-2（IV 前置 + KSA 重复）" },
      ] },
    { key: "key", label: "密钥", type: "text", default: "", placeholder: "密钥" },
    { key: "keyEnc", label: "密钥编码", type: "select", default: "utf8", options: ENC_OPTS },
    { key: "inEnc", label: "输入编码（空=编码方向 UTF-8 / 解码方向跟随密文编码）", type: "select", default: "",
      options: [{ value: "", label: "跟随（旧行为）" }, ...ENC_OPTS] },
    { key: "drop", label: "丢弃字节数 n（drop 模式）", type: "number", default: 768, placeholder: "0/256/768/1536/3072/4096" },
    { key: "ksaRounds", label: "KSA 轮数 r（CS2 模式）", type: "number", default: 20, placeholder: "≥1，1=CS1" },
    { key: "iv", label: "IV（CS2 加密方向，10 字节）", type: "text", default: "", placeholder: "10 字节；解密时从密文前 10 字节读取" },
    { key: "ivEnc", label: "IV 编码", type: "select", default: "utf8", options: ENC_OPTS },
    { key: "outEnc", label: "密文编码", type: "select", default: "base64", options: OUT_OPTS },
  ],
  encode: (text, p) => {
    const mode = (p && p.mode) || "drop";
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    if (mode === "cipherSaber2") {
      const iv = decodeInput(p.iv || "", p.ivEnc || "utf8");
      const body = cipherSaber2Crypt(rawBytesOrNull(p, text) || te(text), key, iv, Number((p && p.ksaRounds) || 20), false);
      const blob = new Uint8Array(iv.length + body.length);
      blob.set(iv, 0);
      blob.set(body, iv.length);
      return encodeOutput(blob, p.outEnc || "base64");
    }
    return encodeOutput(rc4DropCrypt(rawBytesOrNull(p, text) || decodeInput(text, (p && p.inEnc) || "utf8"), key, Number((p && p.drop) || 0)), p.outEnc || "base64");
  },
  decode: (text, p) => {
    const mode = (p && p.mode) || "drop";
    const key = decodeInput(p.key || "", p.keyEnc || "utf8");
    const blob = rawBytesOrNull(p, String(text).trim()) || decodeInput(String(text).trim(), (p && p.inEnc) || p.outEnc || "base64");
    if (mode === "cipherSaber2") {
      if (blob.length < 10) throw new Error(`CipherSaber-2：密文不足 10 字节，读不到 IV（当前 ${blob.length}）。`);
      const iv = blob.subarray(0, 10);
      const body = blob.subarray(10);
      return td(cipherSaber2Crypt(body, key, iv, Number((p && p.ksaRounds) || 20), true));
    }
    return td(rc4DropCrypt(blob, key, Number((p && p.drop) || 0)));
  },
});

export { rc4Keystream, rc4DropCrypt, cipherSaber2Crypt, hexToBytes, bytesToHex, b64ToBytes, bytesToB64 };
