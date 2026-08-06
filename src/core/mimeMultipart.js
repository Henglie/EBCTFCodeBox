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

function b64DecodeToText(b64) {
  const s = String(b64 || "").replace(/\s+/g, "");
  let bin;
  if (typeof Buffer !== "undefined") bin = Buffer.from(s, "base64").toString("binary");
  else bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
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
        decoded: decodePartBody(p.encoding === "quoted-printable" || p.encoding === "quoted_printable" ? raw : clean, p.encoding),
      };
    }),
  };
}

function mimeMultipartOp(text, p = {}) {
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
  desc: "解析 multipart/mixed 邮件/HTTP 体：boundary 分 part，识别 Content-Type/Transfer-Encoding（base64/QP/7bit）并解码正文；encode 方向按 | 分隔组合",
  params: [
    { key: "boundary", label: "boundary（encode 用）", type: "text", default: "", placeholder: "encode 方向自定义分隔串" },
  ],
  run: mimeMultipartOp,
  encode: mimeMultipartEncode,
});

export { mimeMultipartOp, mimeMultipartEncode, qpDecode };
