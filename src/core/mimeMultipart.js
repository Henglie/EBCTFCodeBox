/*
 * mimeMultipart.js — MIME multipart 解析/组合（cat:'text'）。
 *
 * 解析：识别 Content-Type 里的 boundary，按 `--boundary` 分隔各 part，
 * 提取每 part 的 Content-Type / Content-Transfer-Encoding，正文按
 * base64 / quoted-printable / 7bit 解码，输出 part 清单（类型 + 解码内容）。
 * CTF 里 multipart 邮件/HTTP 响应体常把附件藏在 part 里。
 *
 * 组合（encode 方向）：输入 "part1 内容 | part2 内容"（| 分隔），可选
 * boundary 参数，输出完整 multipart 文本。
 *
 * 红线：算法层零 UI 依赖；零外发；件内自注册。
 * 契约：register({ id:"mimeMultipart", cat:"text", name, desc, run, encode })。
 */
import { register } from "./registry.js";

function b64DecodeBytes(b64) {
  const s = String(b64 || "").replace(/\s+/g, "");
  let bin;
  if (typeof Buffer !== "undefined") bin = Buffer.from(s, "base64").toString("binary");
  else bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64DecodeToText(b64) {
  return new TextDecoder("utf-8", { fatal: false }).decode(b64DecodeBytes(b64));
}

// quoted-printable 解码（RFC 2045）：=XX 转字节，软换行 = 去掉
function qpDecode(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=") {
      if (s[i + 1] === "\n") { i++; continue; }        // 软换行 =\n
      if (s[i + 1] === "\r" && s[i + 2] === "\n") { i += 2; continue; }
      const hex = s.substr(i + 1, 2);
      if (/^[0-9a-fA-F]{2}$/.test(hex)) { out.push(parseInt(hex, 16)); i += 2; continue; }
      out.push(0x3d); // 字面 =
    } else {
      out.push(s.charCodeAt(i) & 0xff);
    }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(out));
}

function decodePartBody(body, encoding) {
  const enc = (encoding || "").trim().toLowerCase();
  if (enc === "base64") return b64DecodeToText(body);
  if (enc === "quoted-printable" || enc === "quoted_printable") return qpDecode(body);
  return body; // 7bit / 8bit / 无声明
}

/** 解析 multipart 文本 → { boundary, parts: [{type, encoding, name, body}] } */
export function mimeMultipartParse(src) {
  const text = String(src || "");
  const head = text.slice(0, Math.min(text.length, 4096));
  const bm = head.match(/boundary\s*=\s*"?([^";\r\n]+)"?/i);
  if (!bm) throw new Error("未找到 boundary（需要 multipart 头）");
  const boundary = bm[1];
  // 正文起始 = 第一个 --boundary 行之后
  const marker = "--" + boundary;
  const first = text.indexOf(marker);
  if (first === -1) throw new Error("未找到分隔行 --" + boundary);
  let pos = text.indexOf("\n", first);
  if (pos === -1) pos = first + marker.length;
  const parts = [];
  const lines = text.slice(pos + 1).split(/\r?\n/);
  let i = 0;
  // 第一个 part 的头部（marker 行已被消费，lines[0..] 直到空行）
  const parseHeader = (current, h) => {
    const colon = h.indexOf(":");
    if (colon <= 0) return;
    const k = h.slice(0, colon).trim().toLowerCase();
    const v = h.slice(colon + 1).trim();
    if (k === "content-type") {
      const tm = v.match(/^([^;]+)/);
      current.type = tm ? tm[1].trim() : v;
      const nm = v.match(/name\s*=\s*"?([^";]+)"?/i);
      if (nm) current.name = nm[1];
    } else if (k === "content-transfer-encoding") {
      current.encoding = v;
    } else if (k === "content-disposition") {
      const nm = v.match(/filename\s*=\s*"?([^";]+)"?/i);
      if (nm) current.name = nm[1];
    }
  };
  let current = { type: "", encoding: "", name: "", body: "" };
  while (i < lines.length && lines[i].trim() !== "") { parseHeader(current, lines[i]); i++; }
  i++; // 空行
  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === marker || t === marker + "--") {
      if (current && current.body !== undefined) parts.push(current);
      if (t === marker + "--") break;
      current = { type: "", encoding: "", name: "", body: "" };
      i++;
      while (i < lines.length && lines[i].trim() !== "") { parseHeader(current, lines[i]); i++; }
      i++;
      continue;
    }
    if (current) current.body += line + "\n";
    i++;
  }
  if (current && current.body !== undefined && !parts.includes(current)) parts.push(current);
  return {
    boundary,
    parts: parts.map((p) => {
      const raw = p.body === undefined ? "" : p.body;
      const clean = raw.replace(/\n$/, "");
      return {
        type: p.type,
        encoding: p.encoding,
        name: p.name,
        body: clean,
        // QP 需要保留行结构识别软换行（行尾 =）
        decoded: decodePartBody(clean, p.encoding),
      };
    }),
  };
}

// RFC 2047 encoded-word 解码（CyberChef MIME Decoding 同口径：B 为 base64、Q 为 =XX/_，charset 支持 UTF-8/US-ASCII/ISO-8859-1..16）。
function decodeMimeCharset(charset, bytes) {
  const cs = String(charset || "").toLowerCase();
  if (cs === "utf-8") return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (cs === "us-ascii") {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
  const iso = cs.match(/^iso-8859-(\d+)$/);
  if (iso) {
    const n = Number(iso[1]);
    if (n === 1) {
      let s = "";
      for (const b of bytes) s += String.fromCharCode(b);
      return s;
    }
    if (n >= 2 && n <= 16) {
      try { return new TextDecoder("iso-8859-" + n, { fatal: false }).decode(bytes); }
      catch { /* fall through */ }
    }
  }
  throw new Error("Unhandled Charset");
}

function parseQEncodedBytes(word) {
  const out = [];
  for (let i = 0; i < word.length; i++) {
    if (word[i] === "_") {
      out.push(0x20);
    } else if (word[i] === "=") {
      if (i + 2 >= word.length) throw new Error("Incorrectly Encoded Word");
      const hex = word.slice(i + 1, i + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) throw new Error("Incorrectly Encoded Word");
      out.push(parseInt(hex, 16));
      i += 2;
    } else {
      const c = word.charCodeAt(i);
      if ((c >= 0x20 && c <= 0x7e) || c === 0x0a || c === 0x0d || c === 0x09) out.push(c);
      else throw new Error("Incorrectly Encoded Word");
    }
  }
  return new Uint8Array(out);
}

function mimeDecodeHeaders(text) {
  const headerString = String(text || "").replace(/\r\n/g, "\n");
  let i = headerString.indexOf("=?");
  if (i === -1) return headerString;
  let decoded = headerString.slice(0, i);
  let header = headerString.slice(i);
  let isBetweenWords = false;
  while (true) {
    const start = header.indexOf("=?");
    if (start === -1) break;
    let cur = start + 2;
    const q = header.slice(cur).indexOf("?");
    if (q === -1) break;
    const charset = header.slice(cur, cur + q);
    cur += q + 1;
    if (header.length < cur + 3) break;
    const encoding = header[cur];
    cur += 1;
    if (header[cur] !== "?") break;
    cur += 1;
    const endIdx = header.slice(cur).indexOf("?=");
    if (endIdx === -1) break;
    const text = header.slice(cur, cur + endIdx);
    const end = cur + endIdx + 2;
    let bytes;
    if (encoding.toLowerCase() === "b") bytes = b64DecodeBytes(text);
    else if (encoding.toLowerCase() === "q") bytes = parseQEncodedBytes(text);
    else {
      isBetweenWords = false;
      decoded += header.slice(0, start + 2);
      header = header.slice(start + 2);
      continue;
    }
    if (start > 0 && (!isBetweenWords || header.slice(0, start).search(/\S/g) > -1)) {
      decoded += header.slice(0, start);
    }
    decoded += decodeMimeCharset(charset, bytes);
    header = header.slice(end);
    isBetweenWords = true;
  }
  if (header.length > 0) decoded += header;
  return decoded;
}

function mimeMultipartOp(text, p = {}) {
  if ((p && p.mode) === "encodedWords") return mimeDecodeHeaders(text);
  const parsed = mimeMultipartParse(text);
  if (!parsed.parts.length) return "解析完成：boundary=" + parsed.boundary + "，无 part";
  const out = parsed.parts.map((part, i) => {
    let head = "part " + (i + 1) + "：";
    head += part.type || "(无类型)";
    if (part.name) head += "  name=" + part.name;
    if (part.encoding) head += "  encoding=" + part.encoding;
    const preview = part.decoded.length > 500 ? part.decoded.slice(0, 500) + "\n…（截断）" : part.decoded;
    return head + "\n" + preview;
  });
  return out.join("\n\n" + "─".repeat(20) + "\n\n");
}

function mimeMultipartEncode(text, p = {}) {
  const parts = String(text || "").split(/\s*\|\s*/).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error("输入格式：part1 内容 | part2 内容（| 分隔）");
  const boundary = String(p.boundary || "").trim() || "----ctf-part" + parts.length;
  const out = [
    'Content-Type: multipart/mixed; boundary="' + boundary + '"',
    "",
  ];
  parts.forEach((body) => {
    out.push("--" + boundary);
    out.push("Content-Type: text/plain; charset=utf-8");
    out.push("");
    out.push(body);
  });
  out.push("--" + boundary + "--");
  return out.join("\r\n");
}

register({
  id: "mimeMultipart", cat: "text", name: "MIME multipart 解析",
  desc: "解析 multipart/mixed 邮件/HTTP 体：boundary 分 part，识别 Content-Type/Transfer-Encoding（base64/QP/7bit）并解码正文；encode 方向按 | 分隔组合；mode=encodedWords 时按 RFC 2047 解码邮件头 encoded-word",
  params: [
    { key: "mode", label: "模式", type: "select", default: "multipart", options: [
      { value: "multipart", label: "multipart 解析" },
      { value: "encodedWords", label: "MIME Decoding（RFC 2047 头解码）" },
    ] },
    { key: "boundary", label: "boundary（encode 用）", type: "text", default: "", placeholder: "encode 方向自定义分隔串" },
  ],
  decode: mimeMultipartOp,
  encode: mimeMultipartEncode,
});

export { mimeMultipartOp, mimeMultipartEncode, qpDecode, mimeDecodeHeaders };
