/*
 * john_pdf.js — PDF /Encrypt 字典 → John/hashcat hash 串提取（T290，cat:'analysis'，单向 run）。
 *
 * 用途：CTF 取证里拿到加密 PDF，想用 John the Ripper / hashcat 离线爆破口令。
 * 本 op 只提取 hash 串（不爆破），输出可直接喂给 john/hashcat 的 $pdf$ 格式。
 *
 * 格式定义（严格照 openwall/john 官方 run/pdf2john.py，逐字段对照）：
 *
 * $pdf$<V>*<R>*<Length>*<P>*<EncryptMetadata>*<len(ID)>*<ID_hex>*<passwords>
 *
 * V 标准安全处理器算法版本（/V）
 * R 修订号（/R）：2=RC4基础 3=RC4扩展 4=RC4或AES128 5=AES-R5-256 6=AES-256
 * Length 密钥长度 bit（/Length，缺省 40）
 * P 访问权限位（/P，32 位有符号整数，原样输出如 -3904）
 * EncryptMetadata 元数据是否加密（/EncryptMetadata，true→"1" false→"0"，缺省 1）
 * len(ID) 文档 /ID 第一段字节数（十进制）
 * ID_hex 文档 /ID 第一段的 hex
 * passwords 依次 /U /O /OE /UE 中存在者，每个输出 "<字节数>*<hex>"
 * 每段截断到 max_key_length（R2-4 = 32；R5/R6 = 48）
 *
 * 修订号→截断长度表（照 pdf2john.py SecurityRevision）：
 * 2:32 3:32 4:32 5:48 6:48 （其余缺省 48）
 *
 * 红线：只建本文件，件内自注册，不碰任何现有文件。零外发纯 JS 计算。
 * 照 john 官方格式不编造。只提取 hash 串，绝不爆破口令。
 */
import { register } from "./registry.js";

// ---- hex 编码（Uint8Array → hex 串） ----
function toHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] & 0xFF;
    s += (b < 16 ? "0" : "") + b.toString(16);
  }
  return s;
}

// ---- 输入 → 字节（hex / base64 / auto / 原始 latin1） ----
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function isHex(s) { return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2; }
function isB64(s) {
  if (!s || s.length % 4 !== 0) return false;
  for (const c of s) if (!B64_CHARS.includes(c)) return false;
  return true;
}
function hexToBytes(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}
function b64ToBytes(s) {
  let str = s.replace(/\s/g, "");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function inputToBytes(text, enc) {
  const raw = String(text);
  const s = raw.trim().replace(/\s+/g, "");
  if (enc === "hex") { if (!isHex(s)) throw new Error("输入不是合法 hex"); return hexToBytes(s); }
  if (enc === "base64") { try { return b64ToBytes(s); } catch { throw new Error("输入不是合法 base64"); } }
 // auto：PDF 原始文本以 "%PDF" 开头，优先当原始字节
  if (raw.slice(0, 5).indexOf("%PDF") !== -1) {
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i) & 0xFF;
    return out;
  }
  if (isHex(s)) return hexToBytes(s);
  if (isB64(s)) { try { return b64ToBytes(s); } catch { /* fall */ } }
  let latin1 = true;
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) > 0xFF) { latin1 = false; break; }
  if (latin1) {
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(raw);
}

// 字节 → latin1 串（供 PDF 结构 token 解析，1 字节 = 1 char code）
function bytesToLatin1(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0xFF);
  return s;
}

// ============================================================
// PDF 字符串解析：字面串 (...) 或 十六进制串 <...>
// 返回 { bytes:Uint8Array, next:number }
// ============================================================
function parsePdfString(s, pos) {
  const c = s[pos];
  if (c === "<") {
    const end = s.indexOf(">", pos + 1);
    if (end < 0) return null;
    let hex = s.slice(pos + 1, end).replace(/\s/g, "");
    if (hex.length % 2) hex += "0";
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16) & 0xFF;
    return { bytes, next: end + 1 };
  }
  if (c === "(") {
    let i = pos + 1;
    let depth = 1;
    const out = [];
    const esc = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    while (i < s.length && depth > 0) {
      const ch = s[i];
      if (ch === "\\") {
        const n = s[i + 1];
        if (n >= "0" && n <= "7") {
          let oct = n; i += 2; let cnt = 1;
          while (cnt < 3 && s[i] >= "0" && s[i] <= "7") { oct += s[i]; i++; cnt++; }
          out.push(parseInt(oct, 8) & 0xFF);
          continue;
        }
        if (n === "\n") { i += 2; continue; }
        if (n === "\r") { i += 2; if (s[i] === "\n") i++; continue; }
        if (Object.prototype.hasOwnProperty.call(esc, n)) { out.push(esc[n]); i += 2; continue; }
        out.push(n.charCodeAt(0) & 0xFF); i += 2; continue;
      }
      if (ch === "(") { depth++; out.push(40); i++; continue; }
      if (ch === ")") { depth--; if (depth === 0) { i++; break; } out.push(41); i++; continue; }
      out.push(ch.charCodeAt(0) & 0xFF); i++;
    }
    return { bytes: Uint8Array.from(out), next: i };
  }
  return null;
}

// ============================================================
// 提取加密字典（含 /Filter /Standard 的 << >> 块）
// ============================================================
function extractEncryptDict(s) {
  const m = /\/Filter\s*\/Standard/.exec(s);
  if (!m) return null;
  const idx = m.index;

 // 向左找包住 idx 的 "<<" 起点
  let depth = 0, start = -1;
  for (let i = idx; i > 0; i--) {
    if (s[i] === ">" && s[i - 1] === ">") { depth++; i--; }
    else if (s[i] === "<" && s[i - 1] === "<") {
      if (depth === 0) { start = i - 1; break; }
      depth--; i--;
    }
  }
  if (start < 0) return null;

 // 从 start 向右找匹配的 ">>"
  let d = 0, end = -1;
  for (let i = start; i < s.length - 1; i++) {
    if (s[i] === "<" && s[i + 1] === "<") { d++; i++; }
    else if (s[i] === ">" && s[i + 1] === ">") { d--; i++; if (d === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  return s.slice(start, end);
}

// 从字典块取整数字段（词界防 /V 误命中 /Version 等）
function getInt(block, key, dflt) {
  const re = new RegExp("\\/" + key + "(?![A-Za-z])\\s*(-?\\d+)");
  const m = re.exec(block);
  return m ? parseInt(m[1], 10) : dflt;
}

// 从字典块取字符串字段（/U /O /OE /UE）
function getStr(block, key) {
  const re = new RegExp("\\/" + key + "(?![A-Za-z])\\s*(?=[(<])");
  const m = re.exec(block);
  if (!m) return null;
  const pos = m.index + m[0].length;
  const r = parsePdfString(block, pos);
  return r ? r.bytes : null;
}

// 提取文档 /ID 第一段
function extractDocId(s) {
  const m = /\/ID\s*\[/.exec(s);
  if (!m) return null;
  let pos = m.index + m[0].length;
  while (pos < s.length && /\s/.test(s[pos])) pos++;
  const r = parsePdfString(s, pos);
  return r ? r.bytes : null;
}

const REVISION_KEYLEN = { 2: 32, 3: 32, 4: 32, 5: 48, 6: 48 };

// ============================================================
// 主提取：字节 → $pdf$ hash 串 + 元信息
// ============================================================
function extractPdfHash(pdfBytes) {
  const s = bytesToLatin1(pdfBytes);

  const dict = extractEncryptDict(s);
  if (!dict) throw new Error("未找到标准安全处理器加密字典（/Filter /Standard）——该 PDF 可能未加密或用了非标准处理器");

  const V = getInt(dict, "V", 0);
  const R = getInt(dict, "R", 0);
  const length = getInt(dict, "Length", 40);
  const P = getInt(dict, "P", 0);
  if (!R) throw new Error("加密字典缺 /R 修订号");

  const emMatch = /\/EncryptMetadata\s*(true|false)/.exec(dict);
  const encMeta = emMatch && emMatch[1] === "false" ? "0" : "1";

  let docId = extractDocId(s);
  const hasId = docId && docId.length > 0;
  if (!docId) docId = new Uint8Array(0);

  const U = getStr(dict, "U");
  const O = getStr(dict, "O");
  const OE = getStr(dict, "OE");
  const UE = getStr(dict, "UE");

  const maxKey = REVISION_KEYLEN[R] || 48;
  const parts = [];
 // 顺序照 pdf2john.py：udata(/U), odata(/O), oeseed(/OE), ueseed(/UE)
  for (const val of [U, O, OE, UE]) {
    if (val && val.length > 0) {
      const d = val.length > maxKey ? val.slice(0, maxKey) : val;
      parts.push(String(d.length), toHex(d));
    }
  }
  const passwords = parts.join("*");

  const fields = [
    "$pdf$" + V,
    R,
    length,
    P,
    encMeta,
    docId.length,
    toHex(docId),
    passwords,
  ];
  const hash = fields.join("*");

  return { hash, V, R, length, P, encMeta, hasId, idLen: docId.length, hasU: !!U, hasO: !!O, hasOE: !!OE, hasUE: !!UE };
}

/**
 * op run：从加密 PDF 提取 $pdf$ hash 串。
 * @param {string} text 输入（PDF 原始字节 / hex / base64）
 * @param {object} p { inputEnc:"auto"|"hex"|"base64" }
 */
function pdf2johnRun(text, p = {}) {
  const enc = p.inputEnc || "auto";
  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) return "（空输入）";

  let pdfBytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
    pdfBytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, enc);
  } catch (e) {
    return "输入解析失败：" + (e && e.message ? e.message : String(e));
  }
  if (pdfBytes.length < 8) return "（输入过短）不像 PDF。";

  let res;
  try {
    res = extractPdfHash(pdfBytes);
  } catch (e) {
    return "提取失败：" + (e && e.message ? e.message : String(e));
  }

  const lines = [];
  lines.push("=== PDF hash 提取（pdf2john 格式）===");
  lines.push(`加密: V=${res.V} R=${res.R} Length=${res.length}bit P=${res.P} EncryptMetadata=${res.encMeta}`);
  const present = [];
  if (res.hasU) present.push("/U");
  if (res.hasO) present.push("/O");
  if (res.hasOE) present.push("/OE");
  if (res.hasUE) present.push("/UE");
  lines.push(`口令项: ${present.join(" ") || "（无）"}；文档 /ID: ${res.hasId ? res.idLen + " 字节" : "缺失（john 可能不接受）"}`);
  lines.push("");
  lines.push(res.hash);
  lines.push("");
  lines.push("--- 使用方法 ---");
  lines.push("john --wordlist=wordlist hash.txt");
  lines.push("hashcat: -m 10400(R2/3 RC4) / 10500(R3 128) / 10600(R5) / 10700(R6 AES-256) hash.txt wordlist");
  return lines.join("\n");
}

register({
  id: "pdf2john",
  cat: "forensic",
  name: "PDF 哈希提取（pdf2john）",
  desc: "从加密 PDF 的 /Encrypt 字典提取 John/hashcat 格式 $pdf$ hash 串（只提取不爆破）。照 openwall john 官方 pdf2john 格式，支持 R2-R6（RC4 / AES-128 / AES-256）。输出可直接喂 john/hashcat 离线爆破",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "auto", options: [
      { value: "auto", label: "自动识别（PDF 原始字节 / hex / base64）" },
      { value: "hex", label: "Hex（十六进制）" },
      { value: "base64", label: "Base64" },
    ] },
  ],
  run: pdf2johnRun,
  acceptsBytes: true,
});

export {
  pdf2johnRun, extractPdfHash, extractEncryptDict, extractDocId,
  parsePdfString, getInt, getStr, inputToBytes, toHex,
};
