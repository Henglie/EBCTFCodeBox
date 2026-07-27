/*
 * timecodec.js — 时间戳/日期编码组（T50，cat:'radix'）。
 *
 * 覆盖：
 * - Unix 时间戳（秒/毫秒/微秒 auto）↔ ISO8601
 * - Windows FILETIME（1601 纪元 100ns，BigInt 防 53 位溢出）↔ ISO8601
 * - Mac HFS+（1904 纪元 秒）↔ ISO8601
 * - Cocoa（2001 纪元 秒）↔ ISO8601
 * - DOS 日期时间（FAT 4 字节打包，1980+）↔ ISO8601
 * - 汉字日期（二〇〇〇年一月一日）↔ ISO8601（仅日期，UTC 午夜）
 * - 时区转换（ISO8601 + 偏移）
 *
 * 红线：纯计算不引外部库。FILETIME 用 BigInt（ms*10000 超 Number.MAX_SAFE_INTEGER）。
 * 与 radixExt.js id:"timestamp" 不冲突（本文件 id:"unixTime" 含微秒+时区选项）。
 */
import { register } from "./registry.js";

// ============ ISO8601 解析/格式化 ============
function parseIso(s) {
  const t = String(s).trim();
  if (!t) throw new Error("时间: 空输入");
  let normalized = t;
 // 无时区后缀（无 Z、无 ±HH:MM）→ 补 Z 当 UTC
  if (!/[Zz]$/.test(t) && !/[+-]\d{2}:?\d{2}$/.test(t)) {
    normalized = t + "Z";
  }
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) throw new Error("无效 ISO8601: " + s);
  return ms;
}

function formatIso(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) throw new Error("无效时间戳: " + ms);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const se = String(d.getUTCSeconds()).padStart(2, "0");
  return y + "-" + mo + "-" + da + "T" + h + ":" + mi + ":" + se + "Z";
}

// ============ 1. Unix 时间戳 ↔ ISO8601 ============
// auto: <1e10 秒, <1e13 毫秒, <1e16 微秒
function unixDetectUnit(n) {
  const abs = n < 0 ? -n : n;
  if (abs < 1e10) return "sec";
  if (abs < 1e13) return "ms";
  return "us";
}

function unixToMs(ts, unit) {
  const u = unit === "auto" ? unixDetectUnit(Number(ts)) : unit;
  const n = Number(ts);
  if (!Number.isFinite(n)) throw new Error("时间戳非有效数字: " + ts);
  if (u === "sec") return n * 1000;
  if (u === "ms") return n;
  if (u === "us") return n / 1000;
  throw new Error("未知单位: " + unit);
}

function msToUnix(ms, unit) {
  const u = unit === "auto" ? "sec" : unit;
  if (u === "sec") return Math.floor(ms / 1000).toString();
  if (u === "ms") return Math.floor(ms).toString();
  if (u === "us") return Math.floor(ms * 1000).toString();
  throw new Error("未知单位: " + unit);
}

// ============ 2. Windows FILETIME ↔ ISO8601 ============
// FILETIME: 自 1601-01-01 UTC 的 100ns 间隔，64 位
// 1601→1970 差 = 11644473600000 ms
const FILETIME_EPOCH_OFFSET_MS = 11644473600000n;

function filetimeToMs(ft) {
  const n = BigInt(String(ft).trim());
  const ms = n / 10000n - FILETIME_EPOCH_OFFSET_MS;
  return Number(ms);
}

function msToFiletime(ms) {
  const n = BigInt(Math.floor(ms));
  return ((n + FILETIME_EPOCH_OFFSET_MS) * 10000n).toString();
}

// ============ 3. Mac HFS+ ↔ ISO8601 ============
// HFS+: 自 1904-01-01 UTC 的秒数；1904→1970 差 = 2082844800 秒
const HFS_EPOCH_OFFSET_SEC = 2082844800;

function hfsToMs(sec) {
  return (Number(sec) - HFS_EPOCH_OFFSET_SEC) * 1000;
}

function msToHfs(ms) {
  return Math.floor(ms / 1000) + HFS_EPOCH_OFFSET_SEC;
}

// ============ 4. Cocoa ↔ ISO8601 ============
// Cocoa: 自 2001-01-01 UTC 的秒数；1970→2001 差 = 978307200 秒
const COCOA_EPOCH_OFFSET_SEC = 978307200;

function cocoaToMs(sec) {
  return (Number(sec) + COCOA_EPOCH_OFFSET_SEC) * 1000;
}

function msToCocoa(ms) {
  return Math.floor(ms / 1000) - COCOA_EPOCH_OFFSET_SEC;
}

// ============ 5. DOS 日期时间 ↔ ISO8601 ============
// DOS date (16 bit): bits 15-9=year-1980, 8-5=month, 4-0=day
// DOS time (16 bit): bits 15-11=hours, 10-5=minutes, 4-0=seconds/2
// 打包: (date << 16) | time
function dosToMs(dos) {
  const s = String(dos).trim();
  let n;
  try { n = BigInt(s); } catch { throw new Error("无效 DOS 日期时间: " + dos); }
  const time = Number(n & 0xFFFFn);
  const date = Number((n >> 16n) & 0xFFFFn);
  const year = ((date >> 9) & 0x7F) + 1980;
  const month = (date >> 5) & 0x0F;
  const day = date & 0x1F;
  const hours = (time >> 11) & 0x1F;
  const minutes = (time >> 5) & 0x3F;
  const seconds = (time & 0x1F) * 2;
  if (month < 1 || month > 12) throw new Error("DOS 月份非法: " + month);
  if (day < 1 || day > 31) throw new Error("DOS 日非法: " + day);
  const ms = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  if (Number.isNaN(ms)) throw new Error("DOS 日期非法: " + dos);
  return ms;
}

function msToDos(ms) {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  if (year < 1980) throw new Error("DOS 不支持 1980 年前: " + year);
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hours = d.getUTCHours();
  const minutes = d.getUTCMinutes();
  const seconds = d.getUTCSeconds();
  const date = ((year - 1980) << 9) | (month << 5) | day;
  const time = (hours << 11) | (minutes << 5) | Math.floor(seconds / 2);
  return (date * 65536 + time).toString();
}

// ============ 6. 汉字日期 ↔ ISO8601 ============
const DIGIT_CN = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const CN_TO_DIGIT = { "〇": 0, "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };

function numToCnYear(n) {
  return String(n).split("").map((d) => DIGIT_CN[parseInt(d)]).join("");
}

function numToCnMonth(m) {
  if (m === 10) return "十";
  if (m === 11) return "十一";
  if (m === 12) return "十二";
  return DIGIT_CN[m];
}

function numToCnDay(d) {
  if (d < 10) return DIGIT_CN[d];
  if (d === 10) return "十";
  if (d < 20) return "十" + DIGIT_CN[d - 10];
  if (d === 20) return "二十";
  if (d < 30) return "二十" + DIGIT_CN[d - 20];
  if (d === 30) return "三十";
  return "三十一";
}

function cnYearToNum(s) {
  let n = 0;
  for (const ch of s) {
    if (ch in CN_TO_DIGIT && CN_TO_DIGIT[ch] < 10) n = n * 10 + CN_TO_DIGIT[ch];
    else throw new Error("无效汉字年份: " + s);
  }
  if (!s.length) throw new Error("空汉字年份");
  return n;
}

function cnMonthToNum(s) {
  if (s === "十") return 10;
  if (s === "十一") return 11;
  if (s === "十二") return 12;
  if (s in CN_TO_DIGIT && CN_TO_DIGIT[s] < 10) return CN_TO_DIGIT[s];
  throw new Error("无效汉字月份: " + s);
}

function cnDayToNum(s) {
  if (s === "十") return 10;
  if (s === "二十") return 20;
  if (s === "三十") return 30;
  if (s === "三十一") return 31;
  if (s.startsWith("十") && s.length === 2) {
    const d = CN_TO_DIGIT[s[1]];
    if (d === undefined) throw new Error("无效汉字日: " + s);
    return 10 + d;
  }
  if (s.startsWith("二十") && s.length === 3) {
    const d = CN_TO_DIGIT[s[2]];
    if (d === undefined) throw new Error("无效汉字日: " + s);
    return 20 + d;
  }
  if (s in CN_TO_DIGIT && CN_TO_DIGIT[s] < 10) return CN_TO_DIGIT[s];
  throw new Error("无效汉字日: " + s);
}

function isoToChineseDate(iso) {
  const ms = parseIso(iso);
  const d = new Date(ms);
  return numToCnYear(d.getUTCFullYear()) + "年" + numToCnMonth(d.getUTCMonth() + 1) + "月" + numToCnDay(d.getUTCDate()) + "日";
}

function chineseDateToIso(s) {
  const t = String(s).trim();
  const m = t.match(/^(.+?)年(.+?)月(.+?)日$/);
  if (!m) throw new Error("汉字日期格式须为 X年X月X日: " + s);
  const y = cnYearToNum(m[1]);
  const mo = cnMonthToNum(m[2]);
  const da = cnDayToNum(m[3]);
  return formatIso(Date.UTC(y, mo - 1, da));
}

// ============ 7. 时区转换 ============
function parseTzOffset(tz) {
  const t = String(tz).trim().toUpperCase();
  if (t === "UTC" || t === "Z" || t === "GMT" || t === "") return 0;
  const m = t.match(/^([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (m) {
    const sign = m[1] === "-" ? -1 : 1;
    const h = parseInt(m[2]);
    const min = m[3] ? parseInt(m[3]) : 0;
    return sign * (h * 60 + min);
  }
  throw new Error("未知时区: " + tz);
}

function formatIsoWithTz(ms, offsetMin) {
  const adjusted = ms + offsetMin * 60000;
  const d = new Date(adjusted);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const da = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const se = String(d.getUTCSeconds()).padStart(2, "0");
  const sign = offsetMin >= 0 ? "+" : "-";
  const oh = String(Math.floor(Math.abs(offsetMin) / 60)).padStart(2, "0");
  const om = String(Math.abs(offsetMin) % 60).padStart(2, "0");
  return y + "-" + mo + "-" + da + "T" + h + ":" + mi + ":" + se + sign + oh + ":" + om;
}

function tzConvert(iso, fromTz, toTz) {
  const fromOffset = parseTzOffset(fromTz);
  const toOffset = parseTzOffset(toTz);
  const t = String(iso).trim();
  let utcMs;
  if (/[Zz]$/.test(t) || /[+-]\d{2}:?\d{2}$/.test(t)) {
    utcMs = parseIso(t);
  } else {
 // 无时区 → 视为 fromTz 本地时间
    utcMs = parseIso(t + "Z") - fromOffset * 60000;
  }
  return formatIsoWithTz(utcMs, toOffset);
}

// ============ 注册 ============
register({
  id: "unixTime", cat: "radix", name: "Unix 时间戳 ↔ ISO8601",
  desc: "Unix 时间戳（秒/毫秒/微秒 auto）↔ ISO8601（UTC）",
  params: [
    { key: "unit", label: "单位", type: "select", default: "auto", options: [
      { value: "auto", label: "自动（按数值大小）" },
      { value: "sec", label: "秒" },
      { value: "ms", label: "毫秒" },
      { value: "us", label: "微秒" },
    ] },
  ],
  encode: (t, p) => msToUnix(parseIso(t), (p && p.unit) || "auto"),
  decode: (t, p) => formatIso(unixToMs(t, (p && p.unit) || "auto")),
});

register({
  id: "filetime", cat: "radix", name: "Windows FILETIME ↔ ISO8601",
  desc: "FILETIME（1601 纪元 100ns，64 位 BigInt）↔ ISO8601",
  params: [],
  encode: (t) => msToFiletime(parseIso(t)),
  decode: (t) => formatIso(filetimeToMs(t)),
});

register({
  id: "hfsTime", cat: "radix", name: "Mac HFS+ 时间 ↔ ISO8601",
  desc: "HFS+（1904 纪元 秒）↔ ISO8601",
  params: [],
  encode: (t) => msToHfs(parseIso(t)).toString(),
  decode: (t) => formatIso(hfsToMs(t)),
});

register({
  id: "cocoaTime", cat: "radix", name: "Cocoa 时间 ↔ ISO8601",
  desc: "Cocoa（2001 纪元 秒）↔ ISO8601",
  params: [],
  encode: (t) => msToCocoa(parseIso(t)).toString(),
  decode: (t) => formatIso(cocoaToMs(t)),
});

register({
  id: "dosDateTime", cat: "radix", name: "DOS 日期时间 ↔ ISO8601",
  desc: "DOS FAT 4 字节打包日期时间（1980+）↔ ISO8601",
  params: [],
  encode: (t) => msToDos(parseIso(t)),
  decode: (t) => formatIso(dosToMs(t)),
});

register({
  id: "chineseDate", cat: "radix", name: "汉字日期 ↔ ISO8601",
  desc: "汉字日期（二〇〇〇年一月一日）↔ ISO8601（仅日期，UTC 午夜）",
  params: [],
  encode: (t) => isoToChineseDate(t),
  decode: (t) => chineseDateToIso(t),
});

register({
  id: "tzConvert", cat: "radix", name: "时区转换",
  desc: "ISO8601 时区转换（支持 UTC / ±HH:MM 偏移）",
  params: [
    { key: "fromTz", label: "源时区（无时区输入时生效）", type: "text", default: "UTC", placeholder: "UTC / +8 / -05:00" },
    { key: "toTz", label: "目标时区", type: "text", default: "+08:00", placeholder: "UTC / +8 / -05:00" },
  ],
  run: (t, p) => tzConvert(t, (p && p.fromTz) || "UTC", (p && p.toTz) || "+08:00"),
});

export {
  parseIso, formatIso,
  unixDetectUnit, unixToMs, msToUnix,
  filetimeToMs, msToFiletime,
  hfsToMs, msToHfs,
  cocoaToMs, msToCocoa,
  dosToMs, msToDos,
  isoToChineseDate, chineseDateToIso,
  parseTzOffset, tzConvert,
};
