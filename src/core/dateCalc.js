/*
 * dateCalc.js — 日期计算纯函数（差值 / 加减天数 / 星期）。
 *
 * 定位：纯函数，不注册 op，无 UI 依赖，纯本地零外发。供 ui/quickConv.js「日期」面板调用。
 *
 * 红线：
 * - **绝不用 Date.now()**（脚本/模块环境禁 Date.now；本文件连 new Date() 都不用，
 *   全部日期算术走「儒略日编号」纯函数，跨时区零漂移）。
 * - 输入约定 YYYY-MM-DD（也容忍 YYYY/M/D、YYYY.M.D），按**本地日历**解释，
 *   不做 UTC 时区换算（避免东八区日期错位）。
 *
 * 日期转天数算法：Howard Hinnant《chrono-Compatible Low-Level Date Algorithms》
 * （https://howardhinnant.github.io/date_algorithms.html），公历 400 年周期，
 * 负天数（1970 前）也正确。
 *
 * 月/年差值是「完整历法月/年」近似（非平均月 30.44 天），与 CTF 取证时间线直觉一致：
 * 同月同日 = 整月/整年；日不足则向下取整。
 */
const RE = /^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})日?$/;

/** 解析 "YYYY-MM-DD" → {y,m,d}；非法返回 null。 */
export function parseDate(s) {
  const m = RE.exec(String(s ?? "").trim());
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 回验真实存在（防 2 月 30 这类）
  const rd = daysFromCivil(y, mo, d);
  const back = civilFromDays(rd);
  if (back.y !== y || back.m !== mo || back.d !== d) return null;
  return { y, mo, d };
}

/** 公历日期 → 自 1970-01-01 起的天数（可为负）。 */
export function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.trunc((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400;
  const doy = Math.trunc((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; // [0, 365]
  const doe = yoe * 365 + Math.trunc(yoe / 4) - Math.trunc(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** 天数 → 公历日期 {y,m,d}。 */
export function civilFromDays(z) {
  z += 719468;
  const era = Math.trunc((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097;
  const yoe = Math.trunc((doe - Math.trunc(doe / 1460) + Math.trunc(doe / 36524) - Math.trunc(doe / 146096)) / 365);
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.trunc(yoe / 4) - Math.trunc(yoe / 100));
  const mp = Math.trunc((5 * doy + 2) / 153);
  const d = doy - Math.trunc((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  return { y: y + (m <= 2 ? 1 : 0), m, d };
}

const pad = (n) => String(n).padStart(2, "0");

/** {y,m,d}（或 {y,mo,d}）→ "YYYY-MM-DD"。 */
export function fmtDate(p) {
  const m = p.m !== undefined ? p.m : p.mo;
  return `${p.y}-${pad(m)}-${pad(p.d)}`;
}

/** 某日期所在日的星期：0=周日 … 6=周六（与 Date#getDay 同约定）。 */
export function weekdayIndex(dateStr) {
  const p = parseDate(dateStr);
  if (!p) return null;
  // 1970-01-01 是周四（index 4），儒略日取模 +4 即得
  return (((daysFromCivil(p.y, p.mo, p.d) + 4) % 7) + 7) % 7;
}

const WD_ZH = ["日", "一", "二", "三", "四", "五", "六"];
const WD_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** 星期几：{index, zh, en}；非法日期返回 null。 */
export function weekday(dateStr) {
  const i = weekdayIndex(dateStr);
  if (i === null) return null;
  return { index: i, zh: WD_ZH[i], en: WD_EN[i] };
}

/** 两日期差值。a、b 为 YYYY-MM-DD；返回 {days, weeks, months, years}，全部带符号（b−a）。 */
export function dateDiff(a, b) {
  const A = parseDate(a), B = parseDate(b);
  if (!A || !B) return null;
  const days = daysFromCivil(B.y, B.mo, B.d) - daysFromCivil(A.y, A.mo, A.d);
  // 完整历法月：同月同日为整月，日不足向下取整
  let months = (B.y - A.y) * 12 + (B.mo - A.mo);
  if (B.d < A.d) months -= 1;
  const years = Math.trunc(months / 12);
  return { days, weeks: days / 7, months, years };
}

/** 日期加减天数：addDays("2024-01-01", 10) → "2024-01-11"；n 为负即往前。 */
export function addDays(dateStr, n) {
  const p = parseDate(dateStr);
  if (!p || !Number.isFinite(n)) return null;
  return fmtDate(civilFromDays(daysFromCivil(p.y, p.mo, p.d) + Math.trunc(n)));
}

/** 别名：加负天 = 减。 */
export function subDays(dateStr, n) {
  return addDays(dateStr, -(Math.trunc(n)));
}

/** 自检：返回断言数，失败即抛错。 */
export function selfTest() {
  const eq = (got, want, what) => {
    if (got !== want) throw new Error(`${what}：应 ${want}，实得 ${got}`);
  };
  // 儒略日：1970-01-01 = 0；2000-01-01 = 10957（2000-01-01 实际是儒略日 2451545，差 719468 = 10957 ✓）
  eq(daysFromCivil(1970, 1, 1), 0, "1970-01-01 天数");
  eq(daysFromCivil(2000, 1, 1), 10957, "2000-01-01 天数");
  eq(fmtDate(civilFromDays(0)), "1970-01-01", "天数→日期回环");
  eq(fmtDate(civilFromDays(10957)), "2000-01-01", "天数→日期回环 2000");
  eq(fmtDate(civilFromDays(daysFromCivil(2024, 2, 29))), "2024-02-29", "闰日回环");
  // 星期（已知事实：2000-01-01 周六，2024-01-01 周一，2023-12-31 周日）
  eq(weekday("2000-01-01").zh, "六", "2000-01-01 周六");
  eq(weekday("2000-01-01").index, 6, "2000-01-01 index 6");
  eq(weekday("2024-01-01").zh, "一", "2024-01-01 周一");
  eq(weekday("2023-12-31").zh, "日", "2023-12-31 周日");
  eq(weekday("1970-01-01").zh, "四", "1970-01-01 周四");
  // 差值
  eq(dateDiff("2024-01-01", "2024-01-10").days, 9, "1-1 到 1-10 差 9 天");
  eq(dateDiff("2024-01-01", "2024-01-01").days, 0, "同日差 0");
  eq(dateDiff("2023-12-31", "2024-01-01").days, 1, "跨年差 1 天");
  eq(dateDiff("2024-01-01", "2025-01-01").days, 366, "2024 闰年 366 天");
  eq(dateDiff("2024-01-01", "2025-01-01").years, 1, "整年差 1 年");
  eq(dateDiff("2024-01-01", "2024-03-01").months, 2, "1-1 到 3-1 整 2 月");
  eq(dateDiff("2024-01-31", "2024-02-29").months, 0, "1-31 到 2-29 不满整月（日不足）");
  eq(dateDiff("2024-01-15", "2024-02-14").months, 0, "1-15 到 2-14 不满整月");
  eq(dateDiff("2024-01-15", "2024-02-15").months, 1, "1-15 到 2-15 整 1 月");
  eq(dateDiff("2024-02-15", "2024-01-15").days, -31, "倒序差为负");
  eq(dateDiff("2024-01-01", "2024-01-08").weeks, 1, "8 天 = 1 周");
  // 加减
  eq(addDays("2024-01-01", 10), "2024-01-11", "加 10 天");
  eq(addDays("2024-01-01", -1), "2023-12-31", "减 1 天跨年");
  eq(addDays("2024-02-28", 2), "2024-03-01", "闰年 2 月加 2 天");
  eq(addDays("2023-02-28", 1), "2023-03-01", "平年 2 月");
  eq(subDays("2024-01-01", 1), "2023-12-31", "subDays 别名");
  eq(addDays("2024-01-01", 0), "2024-01-01", "加 0 天");
  // 解析容错 + 非法
  eq(fmtDate(parseDate("2024/1/5")), "2024-01-05", "斜杠分隔");
  eq(fmtDate(parseDate("2024.1.5")), "2024-01-05", "点分隔");
  eq(fmtDate(parseDate("2024年1月5日")), "2024-01-05", "中文分隔");
  for (const bad of ["", "2024-02-30", "2023-02-29", "2024-13-01", "abc", "2024-1-1-1", null, undefined]) {
    if (parseDate(bad) !== null) throw new Error(`parseDate(${JSON.stringify(bad)}) 应返回 null`);
  }
  if (weekdayIndex("") !== null) throw new Error("非法日期 weekday 应 null");
  if (dateDiff("2024-01-01", "bad") !== null) throw new Error("非法日期 dateDiff 应 null");
  if (addDays("2024-01-01", NaN) !== null) throw new Error("NaN 天数应 null");
  return 33;
}
