/*
 * extractAll.js — 专用文本提取器（cat:'analysis'，run 单向）。
 *
 * 支持类型（types，逗号/空格/分号分隔，数组亦可）：
 *   email / url / domain / ipv4 / ipv6 / mac / date / filepath / hash / flag / keyValue
 *   all = 全部类型；默认只开核心 7 类：email,url,domain,ipv4,mac,date,filepath。
 *
 * 口径与边界：
 * - email     常规 local@domain.tld，local 不以点开头/结尾、不出现连续点；domain 标签不以连字符开头/结尾。
 * - url       http/https/ftp 或 www. 开头；尾部常见标点（.,;:!?)]} 与中文标点）自动剥掉。
 * - domain    至少一个点 + 字母 TLD（2..63）；不会命中 1.2.3.4 这类纯数字点串。
 * - ipv4      四段十进制，每段 0..255；前后禁止数字/点，故 999.1.1.1、1.2.3.4.5 不命中。
 * - ipv6      完整 8 组或含 :: 的压缩形式；aa:bb:cc 这类 3 组 MAC 片段不命中。
 * - mac       6 个两位 hex，分隔符统一为 : 或 -；aa:bb:cc 不足 6 组不命中。
 * - date      YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD / YYYY年M月D日；按真实日历校验（2023-02-29 拒绝）。
 *             不支持 20240102 这类紧凑数字，避免吞普通数字串。
 * - filepath  盘符路径、UNC、/abs、./、../、~/，以及带扩展名的相对路径；
 *             落在 URL 区间内的片段跳过，避免把网址路径当文件路径。
 * - hash      32/40/64/128 位 hex，前后禁止 hex，长摘要不会被拆成短摘要。
 * - flag      形如 flag{...} 或 *CTF{...}（大小写不敏感），内容 1..512 字符。
 * - keyValue  JSON 引号键值、引号值、敏感键（password/token/flag/...）、或配置式键（含 _ - . 数字/大写=）。
 *             普通英文短语 monkey = banana、compass: north 不命中；MAC/IPv6 形式的片段不命中。
 *
 * 去重保序：按匹配在原文中的出现位置排序，unique=true（默认）时只保留首次出现的完全相同字符串。
 * 输出：单个文本（sep 连接，默认换行），不返回对象；空结果返回空字符串。
 *
 * 预算（可读拒绝，不静默截断）：
 * - 输入 ≤ 2,000,000 字符。
 * - 原始匹配 ≤ 80,000 条（去重前护栏）。
 * - 去重后 ≤ 20,000 条；输出 ≤ 1,000,000 字符。
 * 超限直接抛错并给出实际值与上限，提示缩小输入或减少 types。
 *
 * 零外发：纯本地正则扫描。
 */
import { register } from "./registry.js";

const MAX_INPUT_CHARS = 2_000_000;
const MAX_RAW_MATCHES = 80_000;
const MAX_MATCHES = 20_000;
const MAX_OUTPUT_CHARS = 1_000_000;

const ALL_TYPES = [
  "email", "url", "domain", "ipv4", "ipv6", "mac",
  "date", "filepath", "hash", "flag", "keyvalue",
];
const DEFAULT_TYPES = ["email", "url", "domain", "ipv4", "mac", "date", "filepath"];
const TYPE_ALIASES = {
  "e-mail": "email",
  mail: "email",
  uri: "url",
  link: "url",
  host: "domain",
  hostname: "domain",
  ip4: "ipv4",
  ip6: "ipv6",
  macaddr: "mac",
  "mac-address": "mac",
  time: "date",
  path: "filepath",
  file: "filepath",
  digest: "hash",
  ctf: "flag",
  kv: "keyvalue",
  "key-value": "keyvalue",
  key_value: "keyvalue",
};

const SENSITIVE_KEY = /^(?:pass(?:word)?|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|auth|authorization|user(?:name)?|login|admin|flag|key|session|cookie|csrf|email|host(?:name)?|db|database|dsn|url|uri|path|file(?:name)?|dir)$/i;
const HEX_LIKE_KEY = /^[0-9A-Fa-f]{1,4}$/;
const TYPED_VALUE = /^(?:true|false|null|none|nil|-?\d+(?:\.\d+)?)$/i;

// ============ 各类型匹配器（返回 [{value,index}]） ============

const EMAIL_RE = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,24}(?![A-Za-z0-9-])/g;
const URL_RE = /(?<![A-Za-z0-9])(?:(?:https?|ftp):\/\/|www\.)[^\s<>"'`\u3000\uFEFF]{1,2048}/gi;
const DOMAIN_RE = /(?<![@\w.-])(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}(?![A-Za-z0-9-])/g;
const IPV4_RE = /(?<![\d.])(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}(?![\d.])/g;
const IPV6_RE = new RegExp(
  "(?<![0-9A-Fa-f:.])(" + [
    "(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}",
    "(?:[0-9A-Fa-f]{1,4}:){1,7}:",
    "(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}",
    "(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}",
    "(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}",
    "(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}",
    "(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}",
    "[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}",
    ":(?::[0-9A-Fa-f]{1,4}){1,7}",
    "::",
  ].join("|") + ")(?![0-9A-Fa-f:.])",
  "g"
);
const MAC_RE = /(?<![0-9A-Fa-f:.-])(?:[0-9A-Fa-f]{2}([:-]))(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:-])/g;
const DATE_RE = /(?<!\d)([12]\d{3})([-/.])(0?[1-9]|1[0-2])\2(0?[1-9]|[12]\d|3[01])(?!\d)/g;
const DATE_CN_RE = /(?<!\d)([12]\d{3})年(0?[1-9]|1[0-2])月(0?[1-9]|[12]\d|3[01])日/g;
const WIN_PATH_RE = /(?<![A-Za-z0-9])(?:[A-Za-z]:[\\/]|\\\\)(?:[^\s<>:"|?*\\/]{1,255}[\\/])*[^\s<>:"|?*\\/]{1,255}/g;
const UNIX_PATH_RE = /(?<![\w.:\/-])(?:~\/|\.\.?\/|\/)(?:[A-Za-z0-9._@+~-]{1,255}\/)*[A-Za-z0-9._@+~-]{1,255}/g;
const REL_PATH_RE = /(?<![\w.:\/-])(?:[A-Za-z0-9._@+~-]{1,255}\/)+[A-Za-z0-9._@+~-]{1,254}\.[A-Za-z0-9]{1,16}/g;
const HASH_RE = /(?<![0-9A-Fa-f])(?:[0-9A-Fa-f]{128}|[0-9A-Fa-f]{64}|[0-9A-Fa-f]{40}|[0-9A-Fa-f]{32})(?![0-9A-Fa-f])/g;
const FLAG_RE = /(?<![A-Za-z0-9_])(?:flag|[A-Za-z0-9_]{0,40}ctf)\{[^{}\r\n]{1,512}\}/gi;
const KEYVALUE_RE = /(?<![A-Za-z0-9_"'.-])(?:"([A-Za-z_][\w.-]{0,63})"|'([A-Za-z_][\w.-]{0,63})'|([A-Za-z_][\w.-]{0,63}))[ \t]*(=|:(?!:))[ \t]*(?:"([^"\r\n]{1,256})"|'([^'\r\n]{1,256})'|([^\s,;"'`<>]{1,256}))/g;

const URL_TRAIL = /[.,;:!?'"\)\]\}，。；：！？、）】》〉]+$/;
const PATH_TRAIL = /[.,;，。；]+$/;

function matchesOf(re, s) {
  const out = [];
  re.lastIndex = 0;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ value: m[0], index: m.index });
  }
  return out;
}

function cleanUrl(u) {
  let v = u;
  for (let i = 0; i < 3; i++) {
    const next = v.replace(URL_TRAIL, "");
    if (next === v) break;
    v = next;
  }
  return v;
}

function extractEmail(s) {
  const out = [];
  for (const m of matchesOf(EMAIL_RE, s)) {
    const at = m.value.lastIndexOf("@");
    const local = m.value.slice(0, at);
    const domain = m.value.slice(at + 1);
    if (local.length > 64 || domain.length > 253) continue;
    if (local.startsWith(".") || local.endsWith(".") || local.includes("..")) continue;
    const labels = domain.split(".");
    if (labels.some((x) => !x || x.startsWith("-") || x.endsWith("-"))) continue;
    out.push(m);
  }
  return out;
}

function extractUrl(s) {
  const out = [];
  for (const m of matchesOf(URL_RE, s)) {
    const v = cleanUrl(m.value);
    if (!v || (v.startsWith("www.") && v.length <= 4)) continue;
    out.push({ value: v, index: m.index });
  }
  return out;
}

function extractDomain(s) {
  return matchesOf(DOMAIN_RE, s);
}

function extractIpv4(s) {
  return matchesOf(IPV4_RE, s);
}

function extractIpv6(s) {
  return matchesOf(IPV6_RE, s);
}

function extractMac(s) {
  return matchesOf(MAC_RE, s);
}

function validYmd(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (m < 1 || m > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

function extractDate(s) {
  const out = [];
  for (const m of matchesOf(DATE_RE, s)) {
    const y = Number(m.value.slice(0, 4));
    const sep = m.value[4];
    const rest = m.value.slice(5).split(sep);
    if (!validYmd(y, Number(rest[0]), Number(rest[1]))) continue;
    out.push(m);
  }
  for (const m of matchesOf(DATE_CN_RE, s)) {
    const mm = /^([12]\d{3})年(0?[1-9]|1[0-2])月(0?[1-9]|[12]\d|3[01])日$/.exec(m.value);
    if (!mm) continue;
    if (!validYmd(Number(mm[1]), Number(mm[2]), Number(mm[3]))) continue;
    out.push(m);
  }
  return out;
}

function insideRanges(index, length, ranges) {
  const end = index + length;
  for (const r of ranges) {
    if (index < r.end && end > r.start) return true;
  }
  return false;
}

function extractFilepath(s, urlRanges) {
  const out = [];
  const push = (m) => {
    let v = m.value;
    for (let i = 0; i < 3; i++) {
      const next = v.replace(PATH_TRAIL, "");
      if (next === v) break;
      v = next;
    }
    if (!v || /^[A-Za-z]:[\\/]$/.test(v) || v === "\\\\" || v === "/" || v === "./" || v === "../" || v === "~/") return;
    if (insideRanges(m.index, v.length, urlRanges)) return;
    out.push({ value: v, index: m.index });
  };
  for (const m of matchesOf(WIN_PATH_RE, s)) push(m);
  for (const m of matchesOf(UNIX_PATH_RE, s)) push(m);
  for (const m of matchesOf(REL_PATH_RE, s)) push(m);
  return out;
}

function extractHash(s) {
  return matchesOf(HASH_RE, s);
}

function extractFlag(s) {
  return matchesOf(FLAG_RE, s);
}

function isConfigKey(key, sep) {
  if (SENSITIVE_KEY.test(key)) return true;
  if (/[_.\d-]/.test(key)) return true;
  if (sep === "=" && /^[A-Z][A-Z0-9]*$/.test(key)) return true;
  return false;
}

function extractKeyValue(s, urlRanges) {
  const out = [];
  KEYVALUE_RE.lastIndex = 0;
  let m;
  while ((m = KEYVALUE_RE.exec(s)) !== null) {
    if (m[0].length === 0) {
      KEYVALUE_RE.lastIndex++;
      continue;
    }
    const keyQuoted = m[1] || m[2];
    const key = m[1] || m[2] || m[3] || "";
    const sep = m[4];
    const valueQuoted = m[5] !== undefined || m[6] !== undefined;
    const value = (m[5] !== undefined ? m[5] : m[6] !== undefined ? m[6] : m[7] || "").trim();

    if (!key || !value) continue;
    if (key.length < 2 && !keyQuoted) continue;
    if (sep === ":" && HEX_LIKE_KEY.test(key)) continue;
    if (sep === ":" && value.startsWith(":")) continue;
    if (!keyQuoted && !valueQuoted) {
      if (!isConfigKey(key, sep) && !TYPED_VALUE.test(value)) continue;
    }
    if (insideRanges(m.index, m[0].length, urlRanges)) continue;
    out.push({ value: m[0].trim(), index: m.index });
  }
  return out;
}

const EXTRACTORS = {
  email: extractEmail,
  url: extractUrl,
  domain: extractDomain,
  ipv4: extractIpv4,
  ipv6: extractIpv6,
  mac: extractMac,
  date: extractDate,
  filepath: extractFilepath,
  hash: extractHash,
  flag: extractFlag,
  keyvalue: extractKeyValue,
};

// ============ 参数解析 ============

function parseTypes(v) {
  const raw = Array.isArray(v) ? v.join(",") : String(v ?? "");
  let parts = raw.split(/[\s,;|]+/).filter(Boolean);
  if (parts.length === 0) parts = DEFAULT_TYPES.slice();
  const out = [];
  for (const part of parts) {
    const k = part.toLowerCase();
    if (k === "all") {
      for (const t of ALL_TYPES) if (!out.includes(t)) out.push(t);
      continue;
    }
    const norm = TYPE_ALIASES[k] || k;
    if (!EXTRACTORS[norm]) {
      throw new Error(
        "提取类型未知：" + JSON.stringify(part) +
        "。支持：" + ALL_TYPES.join("/") + "，或 all。"
      );
    }
    if (!out.includes(norm)) out.push(norm);
  }
  return out;
}

function toBool(v, def = true) {
  if (v === undefined || v === null || v === "") return def;
  if (typeof v === "boolean") return v;
  return !/^(?:false|0|no|off)$/i.test(String(v).trim());
}

function unescapeSeparator(raw) {
  const s = String(raw ?? "\\n");
  return s.replace(/\\([ntr\\])/g, (_, c) => (c === "n" ? "\n" : c === "t" ? "\t" : c === "r" ? "\r" : "\\"));
}

function toTextInput(text) {
  if (typeof text === "string") return text;
  if (text instanceof Uint8Array) return new TextDecoder("utf-8", { fatal: false }).decode(text);
  return String(text ?? "");
}

/**
 * extractAll 的 run 实现。
 * @param {string|Uint8Array} text 输入文本
 * @param {{types?:string|string[],sep?:string,unique?:boolean|string}} p
 * @returns {string} 用 sep 连接的提取结果
 */
export function extractAllRun(text, p) {
  const types = parseTypes(p && p.types);
  const s = toTextInput(text);
  if (s.length === 0) return "";
  if (s.length > MAX_INPUT_CHARS) {
    throw new Error(
      "文本提取：输入 " + s.length + " 字符超过上限 " + MAX_INPUT_CHARS +
      " 字符，已拒绝（不截断）。请先截取相关片段或分批处理。"
    );
  }

  const sep = unescapeSeparator(p && p.sep);
  const unique = toBool(p && p.unique, true);

  // URL 区间用于抑制 filepath / keyValue 在网址内部的误报。
  const urlRanges = extractUrl(s).map((m) => ({ start: m.index, end: m.index + m.value.length }));

  const raw = [];
  for (const type of types) {
    const found = EXTRACTORS[type](s, urlRanges);
    for (const item of found) {
      raw.push({ value: item.value, index: item.index, type });
      if (raw.length > MAX_RAW_MATCHES) {
        throw new Error(
          "文本提取：原始匹配超过 " + MAX_RAW_MATCHES + " 条预算，已拒绝（不截断）。" +
          "请缩小输入或减少 types（当前：" + types.join(",") + "）。"
        );
      }
    }
  }

  raw.sort((a, b) => (a.index - b.index) || (a.value.length - b.value.length));

  const out = [];
  const seen = new Set();
  for (const item of raw) {
    if (unique) {
      if (seen.has(item.value)) continue;
      seen.add(item.value);
    }
    out.push(item.value);
    if (out.length > MAX_MATCHES) {
      throw new Error(
        "文本提取：去重后结果超过 " + MAX_MATCHES + " 条预算，已拒绝（不截断）。" +
        "请缩小输入或减少 types（当前：" + types.join(",") + "）。"
      );
    }
  }

  const textOut = out.join(sep);
  if (textOut.length > MAX_OUTPUT_CHARS) {
    throw new Error(
      "文本提取：输出 " + textOut.length + " 字符超过预算 " + MAX_OUTPUT_CHARS +
      " 字符，已拒绝（不截断）。请缩小输入、减少 types 或改用更短的分隔符。"
    );
  }
  return textOut;
}

register({
  id: "extractAll",
  cat: "analysis",
  name: "专用文本提取器",
  desc:
    "从文本批量提取 email/url/domain/ipv4/ipv6/mac/date/filepath/hash/flag/keyValue；" +
    "去重保序、默认换行分隔；对 999.1.1.1、1.2.3.4.5、aa:bb:cc、monkey = banana、compass: north " +
    "等误报边界做了严格约束；超输入/匹配/输出预算直接可读拒绝，不截断。",
  params: [
    {
      key: "types",
      label: "提取类型（逗号分隔）",
      type: "text",
      default: "email,url,domain,ipv4,mac,date,filepath",
      placeholder: "email,url,domain,ipv4,ipv6,mac,date,filepath,hash,flag,keyValue；all=全部",
    },
    {
      key: "sep",
      label: "结果分隔符",
      type: "text",
      default: "\\n",
      placeholder: "支持 \\n \\t \\r 转义，默认换行",
    },
    {
      key: "unique",
      label: "去重（保留首次出现）",
      type: "bool",
      default: true,
    },
  ],
  run: extractAllRun,
});

export {
  MAX_INPUT_CHARS, MAX_RAW_MATCHES, MAX_MATCHES, MAX_OUTPUT_CHARS,
  ALL_TYPES, DEFAULT_TYPES, parseTypes,
};
