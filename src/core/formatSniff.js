/*
 * formatSniff.js — 格式嗅探 / 特征识别（cat:'analysis'，单向 run，无 detect）。
 *
 * 移植自「剪贴板里有什么」的格式识别层：输入任意文本，快速识别其格式/特征
 * 给 CTF 选手惊喜提示。全本地正则/特征判定，零外发，不依赖 UI。
 *
 * 契约：单向 run(text, params) 返回报告文本（多行「类别: 判定依据 + 附加信息」）。
 * 无 encode/decode/detect（本 op 只做识别报告，不参与一把梭）。
 *
 * 红线：只新建本文件，件内 import { register } 自注册；不碰 main.js / i18n。
 */
import { register } from "./registry.js";

// ============ 小工具 ============
const trim = (t) => String(t == null ? "" : t).trim();

// base64url 解码（用于 JWT 头部）——纯本地，容错不抛
function b64urlDecode(s) {
  try {
    let b = s.replace(/-/g, "+").replace(/_/g, "/");
    while (b.length % 4) b += "=";
    const bin = atob(b);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}

// Luhn 校验（信用卡）
function luhnValid(digits) {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ============ 各识别器：返回 null（未命中）或 { cat, info } ============

// --- JWT：三段 base64url 点分，头部含 alg ---
function sniffJWT(s) {
  const m = s.match(/^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/);
  if (!m) return null;
  const head = b64urlDecode(m[1]);
  let alg = "?", typ = "?";
  try {
    const j = JSON.parse(head);
    if (j.alg) alg = j.alg;
    if (j.typ) typ = j.typ;
  } catch { return null; } // 头部解不出 JSON 就不是 JWT
  let payloadHint = "";
  const payload = b64urlDecode(m[2]);
  try {
    const pj = JSON.parse(payload);
    const keys = Object.keys(pj).slice(0, 8).join(", ");
    payloadHint = keys ? `；载荷字段: ${keys}` : "";
    if (alg === "none") payloadHint += "；[!] alg=none，可尝试空签名绕过";
  } catch { /* 载荷不是 JSON 也可能是 JWT */ }
  return { cat: "JWT", info: `三段 base64url 点分，头部 alg=${alg} typ=${typ}${payloadHint}` };
}

// --- PEM 块 ---
function sniffPEM(s) {
  const m = s.match(/-----BEGIN ([A-Z0-9 ]+?)-----/);
  if (!m) return null;
  const label = m[1].trim();
  let hint = "";
  if (/PRIVATE KEY/.test(label)) hint = "；[!] 私钥，敏感物";
  else if (/CERTIFICATE/.test(label)) hint = "；X.509 证书";
  else if (/PUBLIC KEY/.test(label)) hint = "；公钥";
  return { cat: "PEM 块", info: `BEGIN ${label}${hint}` };
}

// --- data URI ---
function sniffDataURI(s) {
  const m = s.match(/^data:([^;,]*)(;base64)?,/i);
  if (!m) return null;
  const mime = m[1] || "text/plain";
  const enc = m[2] ? "base64" : "url-encoded";
  return { cat: "data URI", info: `MIME=${mime || "(空)"}，编码=${enc}` };
}

// --- magnet 链接 ---
function sniffMagnet(s) {
  if (!/^magnet:\?/i.test(s)) return null;
  const btih = s.match(/xt=urn:btih:([0-9a-fA-F]{40}|[a-zA-Z2-7]{32})/);
  const dn = s.match(/[?&]dn=([^&]+)/);
  let info = "BitTorrent 磁力链接";
  if (btih) info += `；infohash=${btih[1]}`;
  if (dn) { try { info += `；名称=${decodeURIComponent(dn[1])}`; } catch { /**/ } }
  return { cat: "magnet", info };
}

// --- URL ---
function sniffURL(s) {
  const m = s.match(/^(https?|ftp|ws|wss):\/\/([^\s/]+)(\/\S*)?$/i);
  if (!m) return null;
  return { cat: "URL", info: `协议=${m[1].toLowerCase()}，主机=${m[2]}` };
}

// --- IPv4 ---
function sniffIPv4(s) {
  const m = s.match(/^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/);
  if (!m) return null;
  return { cat: "IPv4", info: `点分十进制 IPv4 地址` };
}

// --- IPv6（宽松，含缩写 ::）---
function sniffIPv6(s) {
  if (s.indexOf(":") < 0) return null;
  const re = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
  if (!re.test(s)) return null;
  return { cat: "IPv6", info: `IPv6 地址` };
}

// --- MAC 地址 ---
function sniffMAC(s) {
  if (!/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/.test(s)) return null;
  return { cat: "MAC", info: `以太网 MAC 地址（6 字节）` };
}

// --- UUID ---
function sniffUUID(s) {
  const m = s.match(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-([0-9a-fA-F])[0-9a-fA-F]{3}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/);
  if (!m) return null;
  return { cat: "UUID", info: `UUID/GUID，版本=${m[1]}` };
}

// --- 域名 ---
function sniffDomain(s) {
  if (!/^([a-zA-Z0-9](-?[a-zA-Z0-9])*\.)+[a-zA-Z]{2,}$/.test(s)) return null;
  if (s.length > 253) return null;
  return { cat: "域名", info: `合法域名格式` };
}

// --- 以太坊地址 ---
function sniffEthAddr(s) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return null;
  return { cat: "以太坊地址", info: `0x + 40 位 hex（20 字节），CTF 敏感物` };
}

// --- 比特币地址（Base58 P2PKH/P2SH 或 bech32 bc1）---
function sniffBtcAddr(s) {
  if (/^(bc1)[0-9a-z]{6,87}$/.test(s)) {
    return { cat: "比特币地址", info: `bech32 (bc1...) 格式` };
  }
  if (/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s)) {
    return { cat: "比特币地址", info: `Base58 P2PKH/P2SH（1/3 开头）` };
  }
  return null;
}

// --- 助记词（BIP39 风格：12/15/18/21/24 个小写英文词）---
function sniffMnemonic(s) {
  const words = s.split(/\s+/).filter(Boolean);
  const n = words.length;
  if (![12, 15, 18, 21, 24].includes(n)) return null;
  if (!words.every((w) => /^[a-z]{3,8}$/.test(w))) return null;
  return { cat: "助记词", info: `疑似 BIP39 助记词（${n} 个词），CTF 敏感物` };
}

// --- 时间戳（Unix 秒/毫秒）---
function sniffTimestamp(s) {
  if (!/^\d{10}$|^\d{13}$/.test(s)) return null;
  const n = Number(s);
  const ms = s.length === 13 ? n : n * 1000;
  const d = new Date(ms);
  if (isNaN(d.getTime()) || d.getFullYear() < 1990 || d.getFullYear() > 2100) return null;
  const unit = s.length === 13 ? "毫秒" : "秒";
  return { cat: "时间戳", info: `Unix ${unit}时间戳 → ${d.toISOString()}` };
}

// --- 信用卡（Luhn）---
function sniffCreditCard(s) {
  const digits = s.replace(/[\s-]/g, "");
  if (!/^\d{13,19}$/.test(digits)) return null;
  if (!luhnValid(digits)) return null;
  let brand = "未知";
  if (/^4/.test(digits)) brand = "Visa";
  else if (/^5[1-5]/.test(digits)) brand = "MasterCard";
  else if (/^3[47]/.test(digits)) brand = "American Express";
  else if (/^6(011|5)/.test(digits)) brand = "Discover";
  return { cat: "信用卡号", info: `Luhn 校验通过，卡种=${brand}（${digits.length} 位）` };
}

// --- 经纬度坐标 ---
function sniffGeo(s) {
  const m = s.match(/^\s*(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (!/\./.test(s)) return null; // 排除纯整数对（易与其他误判）
  return { cat: "坐标", info: `经纬度 lat=${lat}, lng=${lng}` };
}

// --- 哈希（长度 + 字符集猜）---
function sniffHash(s) {
 // bcrypt / NTLM($)/ crypt 特征前缀优先
  if (/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(s)) {
    return { cat: "哈希", info: `bcrypt（$2a/$2b$ 前缀）` };
  }
  if (/^\$1\$/.test(s)) return { cat: "哈希", info: `MD5-crypt（$1$）` };
  if (/^\$5\$/.test(s)) return { cat: "哈希", info: `SHA-256-crypt（$5$）` };
  if (/^\$6\$/.test(s)) return { cat: "哈希", info: `SHA-512-crypt（$6$）` };
  if (/^\$argon2(id|i|d)\$/.test(s)) return { cat: "哈希", info: `Argon2` };
 // 纯 hex，按长度
  if (!/^[0-9a-fA-F]+$/.test(s)) return null;
  const len = s.length;
  const map = {
    16: ["MySQL<4.1", "CRC64"],
    32: ["MD5", "MD4", "NTLM", "LM"],
    40: ["SHA-1", "RipeMD-160"],
    56: ["SHA-224", "SHA3-224"],
    64: ["SHA-256", "SHA3-256", "BLAKE2s", "Keccak-256"],
    96: ["SHA-384", "SHA3-384"],
    128: ["SHA-512", "SHA3-512", "Whirlpool", "BLAKE2b"],
  };
  const cands = map[len];
  if (!cands) return null;
  return { cat: "哈希", info: `${len} hex 字符 = ${len * 4} bit，可能: ${cands.join(" / ")}` };
}

// --- 编码猜测：hex / base32 / base58 / base64 ---
function sniffEncoding(s) {
  const compact = s.replace(/\s/g, "");
  const out = [];
 // hex
  if (/^[0-9a-fA-F]+$/.test(compact) && compact.length >= 4 && compact.length % 2 === 0) {
    out.push(`hex（纯 0-9a-f，长度 ${compact.length} 偶数，可解 ${compact.length / 2} 字节）`);
  }
 // base32（RFC4648，A-Z2-7，= 填充，长度 8 整除）
  if (/^[A-Z2-7]+=*$/.test(compact) && compact.replace(/=+$/, "").length >= 8 && compact.length % 8 === 0) {
    out.push(`base32（A-Z2-7 字符集，长度 8 整除）`);
  }
 // base64 / base64url（长度 4 整除或有 = 填充）
  if (/^[A-Za-z0-9+/]+=*$/.test(compact) && compact.length >= 8 && compact.length % 4 === 0) {
    out.push(`base64（标准表 A-Za-z0-9+/，长度 4 整除）`);
  } else if (/^[A-Za-z0-9_-]+=*$/.test(compact) && /[_-]/.test(compact) && compact.length >= 8) {
    out.push(`base64url（含 - 或 _，URL 安全变体）`);
  }
 // base58（无 0OIl+/，比特币字母表）
  if (/^[1-9A-HJ-NP-Za-km-z]+$/.test(compact) && compact.length >= 8 && /[a-z]/.test(compact) && /[A-Z]/.test(compact)) {
    out.push(`base58（无 0OIl，Bitcoin/IPFS 字母表）`);
  }
  if (out.length === 0) return null;
  return { cat: "编码猜测", info: out.join("；") };
}

// --- 结构化格式：JSON / XML / YAML ---
function sniffStructured(s) {
  const out = [];
 // JSON
  if (/^[\[{]/.test(s) && /[\]}]$/.test(s)) {
    try { JSON.parse(s); out.push("JSON（解析成功）"); } catch { /**/ }
  }
 // XML / HTML
  if (/^<\?xml/i.test(s)) out.push("XML（<?xml 声明）");
  else if (/^<(!DOCTYPE|html)\b/i.test(s)) out.push("HTML 文档");
  else if (/^<[a-zA-Z][\w:-]*[\s>]/.test(s) && /<\/[a-zA-Z]/.test(s)) out.push("XML/HTML 标签结构");
 // YAML（多行 key: value 或 --- 文档分隔）
  if (/^---\s*$/m.test(s) || /^[a-zA-Z_][\w-]*:\s+\S/m.test(s)) {
    const lines = s.split(/\r?\n/).filter((l) => l.trim());
    const kv = lines.filter((l) => /^[a-zA-Z_][\w-]*:\s/.test(l.trim()) || /^-\s/.test(l.trim()));
    if (kv.length >= 2 || /^---/m.test(s)) out.push("YAML（key: value 结构）");
  }
  if (out.length === 0) return null;
  return { cat: "结构化数据", info: out.join("；") };
}

// --- 编程语言片段 ---
function sniffLanguage(s) {
  const out = [];
 // Python
  if (/^\x80[\x02-\x05]/.test(s)) out.push("[!] Python pickle 魔数（\\x80 协议头）");
  if (/\b(def|class|import|from)\b.*:|print\s*\(|__pycache__|if\s+__name__\s*==/.test(s)) {
    if (/print\s*\(|^\s*def\s|^\s*import\s|^\s*from\s+\w+\s+import/m.test(s)) out.push("Python 片段（def/import/print(）");
  }
 // PHP
  if (/<\?php/.test(s)) out.push("PHP（<?php 标签）");
 // JS
  if (/\b(function|const|let|var)\b.*[={]|=>\s*[{(]|console\.log/.test(s) && /[;{}]/.test(s)) {
    if (/console\.log|=>\s*|function\s*\w*\s*\(|\b(const|let)\s+\w+\s*=/.test(s)) out.push("JavaScript 片段");
  }
 // SQL
  if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\b/i.test(s) && /\b(FROM|INTO|TABLE|WHERE|VALUES)\b/i.test(s)) {
    out.push("SQL 语句");
  }
 // Shell
  if (/^#!\s*\/.*\/(ba)?sh/.test(s)) out.push("Shell 脚本（shebang）");
  if (out.length === 0) return null;
  return { cat: "代码/语言", info: out.join("；") };
}

// 全部识别器（顺序 = 报告顺序，强特征在前）
const SNIFFERS = [
  sniffJWT, sniffPEM, sniffDataURI, sniffMagnet, sniffURL,
  sniffEthAddr, sniffBtcAddr, sniffMnemonic,
  sniffIPv4, sniffIPv6, sniffMAC, sniffUUID, sniffDomain,
  sniffTimestamp, sniffCreditCard, sniffGeo,
  sniffHash, sniffEncoding, sniffStructured, sniffLanguage,
];

// ============ 主入口 ============
function formatSniff(text) {
  const raw = String(text == null ? "" : text);
  const s = trim(raw);
  if (!s) return "（输入为空，粘点东西进来试试）";

  const hits = [];
  const seen = new Set();
  for (const fn of SNIFFERS) {
    let r = null;
    try { r = fn(s); } catch { r = null; }
    if (r && r.cat && !seen.has(r.cat)) {
      seen.add(r.cat);
      hits.push(`${r.cat}: ${r.info}`);
    }
  }

  const header = `格式嗅探（长度 ${raw.length} 字符）`;
  if (hits.length === 0) {
    return `${header}\n\n未命中已知格式指纹。提示：\n  - 若是密文，试试「分析/爆破」里的熵、IC、卡方\n  - 若像编码，试试「首页 · 一把梭」自动识别\n  - 含大量非可打印字节？可能是二进制/图片，试隐写工具`;
  }
  return `${header}\n命中 ${hits.length} 项:\n\n${hits.map((h) => "  ▸ " + h).join("\n")}`;
}

// ============ 注册 ============
register({
  id: "formatSniff",
  cat: "forensic",
  name: "格式嗅探",
  desc: "识别输入的格式/特征（JWT/URL/PEM/哈希/编码/密钥/坐标/时间戳等），给 CTF 惊喜提示",
  params: [],
  run: formatSniff,
});

export { formatSniff };
