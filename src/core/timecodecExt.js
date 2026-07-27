/*
 * timecodecExt.js — 时间戳扩展组（T94，cat:'radix'）。
 *
 * 覆盖：
 * - julianDate 儒略日 / 简化儒略日 ↔ ISO8601（含时间小数）
 * - excelDate Excel 序列日期 ↔ ISO8601（1900/1904 日期系统）
 * - chromeTime Google/Chrome 时间（1601 纪元 微秒，BigInt）↔ ISO8601
 * - snowflakeId Twitter/Discord 雪花 ID 解析（run 单向，输出多行报告）
 *
 * 红线：
 * - 不碰 timecodec.js（T50），仅 import 其 parseIso/formatIso 复用。
 * - 查重：T50 已有 unixTime/filetime/hfsTime/cocoaTime/dosDateTime/chineseDate/tzConvert
 * radixExt.js 有 timestamp；本组 4 个新 id 全无冲突。
 * - Chrome 时间用 BigInt（现代日期微秒值 > 2^53，超 Number.MAX_SAFE_INTEGER）。
 * - Excel 1900 闰年 bug（1900-02-29 幻影日）：1900-03-01 起公式精确，1900-01/02 月差 1 天，已在 desc 注明。
 * - 雪花 ID 位拆分照 Twitter Snowflake 规范（41+5+5+12， epoch 可选 Twitter/Discord/自定义）。
 *
 * 算法标准：
 * - 儒略日：Meeus《Astronomical Algorithms》Gregorian↔JD 互转公式（含 1582 Gregory 改历阈值）。
 * - Excel：1900 系统 serial 25569 = 1970-01-01；1904 系统 serial 24107 = 1970-01-01。
 * - Chrome：1601-01-01 00:00 UT，11644473600 秒 = 11644473600000000 微秒到 1970 纪元。
 * - 雪花：id >> 22 = ms 偏移，(id>>17)&0x1F = datacenter，(id>>12)&0x1F = worker，id&0xFFF = seq。
 */
import { register } from "./registry.js";
import { parseIso, formatIso } from "./timecodec.js";

// ============ 1. 儒略日 (Julian Date) ↔ ISO8601 ============
// JD = 自公元前 4713 年 1 月 1 日 12:00 UT 起的日数（含小数）。JDN = 整数 JD（当日 12:00 UT）。
// Meeus 算法：Gregorian 历（>= 1582-10-15）与 Julian 历分支由 Z < 2299161 判定。

/** ISO8601 毫秒 → 儒略日（含时间小数） */
function msToJd(ms) {
  const d = new Date(ms);
  const Y = d.getUTCFullYear();
  const M = d.getUTCMonth() + 1;
  const D = d.getUTCDate();
  let y = Y, m = M;
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100);
  const B = 2 - A + Math.floor(A / 4);
 // JD at 0h UT
  const jd0 = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + D + B - 1524.5;
 // 时间小数（日分数）
  const h = d.getUTCHours();
  const mi = d.getUTCMinutes();
  const s = d.getUTCSeconds();
  const msf = d.getUTCMilliseconds();
  const frac = (h + mi / 60 + (s + msf / 1000) / 3600) / 24;
  return jd0 + frac;
}

/** 儒略日（含小数） → ISO8601 毫秒 */
function jdToMs(jd) {
  let Z = Math.floor(jd + 0.5);
  let F = jd + 0.5 - Z; // 日分数（0h UT 起）
  let A;
  if (Z < 2299161) {
    A = Z; // Julian 历
  } else {
    const alpha = Math.floor((Z - 1867216.25) / 36524.25);
    A = Z + 1 + alpha - Math.floor(alpha / 4); // Gregorian 历
  }
  const B = A + 1524;
  const C = Math.floor((B - 122.1) / 365.25);
  const Dd = Math.floor(365.25 * C);
  const E = Math.floor((B - Dd) / 30.6001);
  const day = B - Dd - Math.floor(30.6001 * E);
  const month = E < 14 ? E - 1 : E - 13;
  const year = month > 2 ? C - 4716 : C - 4715;
 // F → 时分秒毫秒
  let totalMs = F * 86400000;
  const hh = Math.floor(totalMs / 3600000); totalMs -= hh * 3600000;
  const mm = Math.floor(totalMs / 60000); totalMs -= mm * 60000;
  const ss = Math.floor(totalMs / 1000); totalMs -= ss * 1000;
  const mss = Math.round(totalMs);
  return Date.UTC(year, month - 1, day, hh, mm, ss, mss);
}

register({
  id: "julianDate", cat: "radix", name: "儒略日 ↔ ISO8601",
  desc: "儒略日（JD，公元前 4713-01-01 12:00 UT 起日数含小数）↔ ISO8601。J2000.0 = 2451545.0",
  params: [],
  encode: (t) => {
    const jd = msToJd(parseIso(t));
 // 整数 JD 输出无小数，否则保留 6 位
    return Number.isInteger(jd) ? jd.toString() : jd.toFixed(6).replace(/\.?0+$/, "");
  },
  decode: (t) => formatIso(jdToMs(Number(String(t).trim()))),
});

// ============ 2. Excel 序列日期 ↔ ISO8601 ============
// 1900 系统：serial 1 = 1900-01-01，serial 25569 = 1970-01-01。
// 1900 闰年 bug：Excel 误认 1900 为闰年，serial 60 = 1900-02-29（幻影日）。
// 公式 ms = (serial - 25569) * 86400000 对 1900-03-01（serial 61）起精确；
// 1900-01/02 月（serial 1..59）真实历法差 1 天，已注 desc。
// 1904 系统（Mac 旧）：serial 0 = 1904-01-02，serial 24107 = 1970-01-01（无 1900 bug）。
const EXCEL_1900_EPOCH = 25569; // 1970-01-01 的 Excel serial（1900 系统）
const EXCEL_1904_EPOCH = 24107; // 1970-01-01 的 Excel serial（1904 系统）
const PHANTOM_SERIAL = 60; // 1900-02-29 幻影日

function excelToMs(serial, system) {
  const n = Number(serial);
  if (!Number.isFinite(n)) throw new Error("Excel 序列号非有效数字: " + serial);
  if (system === "1904") {
    return Math.round((n - EXCEL_1904_EPOCH) * 86400000);
  }
 // 1900 系统
  if (n === PHANTOM_SERIAL) throw new Error("Excel serial 60 = 1900-02-29（1900 闰年 bug 幻影日，实际不存在）");
 // serial >= 61 用标准公式；serial 1..59 因幻影日尚未插入，差 1 天（+1 天修正）
  const epoch = EXCEL_1900_EPOCH;
  const adj = n < PHANTOM_SERIAL ? 1 : 0; // 1900-01/02 月补 1 天
  return Math.round((n - epoch) * 86400000 + adj * 86400000);
}

function msToExcel(ms, system) {
  if (system === "1904") {
    return ms / 86400000 + EXCEL_1904_EPOCH;
  }
 // 1900 系统：1970+ 日期直接公式；1900-01/02 月需扣幻影修正
  const d = new Date(ms);
  const Y = d.getUTCFullYear();
  if (Y < 1900 || (Y === 1900 && d.getUTCMonth() < 2)) {
 // 1900-01/02 月：扣 1 天（幻影日未插入）
    return (ms / 86400000 + EXCEL_1900_EPOCH) - 1;
  }
  return ms / 86400000 + EXCEL_1900_EPOCH;
}

register({
  id: "excelDate", cat: "radix", name: "Excel 序列日期 ↔ ISO8601",
  desc: "Excel 序列日期 ↔ ISO8601（1900 系统默认，含 1900 闰年 bug 注记；可选 1904 Mac 系统）",
  params: [
    { key: "system", label: "日期系统", type: "select", default: "1900", options: [
      { value: "1900", label: "1900 系统（Windows，默认）" },
      { value: "1904", label: "1904 系统（Mac 旧版）" },
    ] },
  ],
  encode: (t, p) => {
    const sys = (p && p.system) || "1900";
    const v = msToExcel(parseIso(t), sys);
 // 整数输出无小数，否则保留 6 位
    return Number.isInteger(v) ? v.toString() : v.toFixed(6).replace(/\.?0+$/, "");
  },
  decode: (t, p) => {
    const sys = (p && p.system) || "1900";
    return formatIso(excelToMs(t, sys));
  },
});

// ============ 3. Google/Chrome 时间 ↔ ISO8601 ============
// Chrome/Webkit 时间：自 1601-01-01 00:00:00 UT 的微秒数（BigInt）。
// 1601→1970 = 11644473600 秒 = 11644473600000000 微秒。
// 注：FILETIME（T50）是 1601 纪元 100ns，Chrome 是微秒 = FILETIME/10，单位不同故独立 op。
const CHROME_EPOCH_US = 11644473600000000n; // 1601-01-01 → 1970-01-01 的微秒数
const CHROME_EPOCH_MS_BIG = 11644473600000n; // 同上的毫秒数

function chromeToMs(s) {
  const us = BigInt(String(s).trim());
  return Number(us / 1000n - CHROME_EPOCH_MS_BIG);
}

function msToChrome(ms) {
  return (BigInt(ms) * 1000n + CHROME_EPOCH_US).toString();
}

register({
  id: "chromeTime", cat: "radix", name: "Chrome 时间 ↔ ISO8601",
  desc: "Google/Chrome 时间（1601-01-01 纪元 微秒，BigInt）↔ ISO8601。与 FILETIME(100ns) 单位不同",
  params: [],
  encode: (t) => msToChrome(parseIso(t)),
  decode: (t) => formatIso(chromeToMs(t)),
});

// ============ 4. 雪花 ID 解析（run 单向） ============
// Twitter Snowflake：64 位 = 41 位 ms 时间戳 + 5 位数据中心 + 5 位工作节点 + 12 位序列号。
// Twitter epoch = 1288834974657（2010-11-04 01:42:54.657 UT）
// Discord epoch = 1420070400000（2015-01-01 00:00:00 UT）
const SNOWFLAKE_EPOCHS = {
  twitter: 1288834974657,
  discord: 1420070400000,
};

function parseSnowflake(idStr, epochMs) {
  const big = BigInt(String(idStr).trim());
  const tsOffset = big >> 22n;
  const datacenter = (big >> 17n) & 0x1Fn;
  const worker = (big >> 12n) & 0x1Fn;
  const seq = big & 0xFFFn;
  const ts = Number(tsOffset) + epochMs;
  return { id: big, ts, datacenter: Number(datacenter), worker: Number(worker), seq: Number(seq) };
}

register({
  id: "snowflakeId", cat: "radix", name: "雪花 ID 解析",
  desc: "Twitter/Discord 雪花 ID 解析（64 位拆 timestamp+数据中心+工作节点+序列号，run 单向报告）",
  params: [
    { key: "epoch", label: "纪元", type: "select", default: "twitter", options: [
      { value: "twitter", label: "Twitter (2010-11-04, 1288834974657)" },
      { value: "discord", label: "Discord (2015-01-01, 1420070400000)" },
      { value: "custom", label: "自定义" },
    ] },
    { key: "customEpoch", label: "自定义纪元（ms，epoch=custom 时生效）", type: "text", default: "1288834974657", placeholder: "如 1288834974657" },
  ],
  run: (t, p) => {
    const s = String(t).trim();
    if (!s) return "（空输入）";
    const ep = (p && p.epoch) || "twitter";
    let epochMs;
    if (ep === "twitter") epochMs = SNOWFLAKE_EPOCHS.twitter;
    else if (ep === "discord") epochMs = SNOWFLAKE_EPOCHS.discord;
    else {
      epochMs = Number((p && p.customEpoch) || "1288834974657");
      if (!Number.isFinite(epochMs)) throw new Error("自定义纪元非有效数字: " + (p && p.customEpoch));
    }
    let r;
    try { r = parseSnowflake(s, epochMs); }
    catch (e) { throw new Error("雪花 ID 解析失败（需 64 位整数）: " + (e && e.message ? e.message : String(e))); }
    const lines = [];
    lines.push("=== 雪花 ID 解析 ===");
    lines.push("输入: " + r.id.toString());
    lines.push("ID (hex): 0x" + r.id.toString(16).toUpperCase());
    lines.push("--- 字段分解 ---");
    lines.push("时间戳偏移 (ms): " + (r.ts - epochMs));
    lines.push("纪元: " + (ep === "twitter" ? "Twitter" : ep === "discord" ? "Discord" : "自定义") + " (" + epochMs + ")");
    lines.push("生成时间 (UTC): " + formatIso(r.ts));
    lines.push("数据中心 ID: " + r.datacenter);
    lines.push("工作节点 ID: " + r.worker);
    lines.push("序列号: " + r.seq);
    lines.push("--- 位拆分 ---");
    lines.push("bits 63-22 (timestamp): " + (r.ts - epochMs));
    lines.push("bits 21-17 (datacenter): " + r.datacenter);
    lines.push("bits 16-12 (worker): " + r.worker);
    lines.push("bits 11-0  (sequence): " + r.seq);
    return lines.join("\n");
  },
});

export {
  msToJd, jdToMs,
  excelToMs, msToExcel,
  chromeToMs, msToChrome,
  parseSnowflake,
  SNOWFLAKE_EPOCHS,
};
