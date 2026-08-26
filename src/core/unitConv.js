/*
 * unitConv.js — 单位换算（cat:'data'，run 报告型，T339）。
 *
 * 九组（任务卡口径 + MT81 尾巴补三组）：
 * - 数据量：B/KB/MB/GB/TB/PB（SI 1000 制）与 KiB/MiB/GiB/TiB/PiB（IEC 1024 制）
 *   两制并列输出（最常被搞混的点）。
 * - 数据速率：bps/Kbps/Mbps/Gbps（bit，SI）与 B/s/KB/s/MB/s（Byte，bit×8）。
 * - 时间：ns/μs/ms/s/min/h/d。
 * - 时间戳纪元对照：Unix 秒 / Unix 毫秒 / Windows FILETIME / DOS 日期时间 /
 *   Mac Cocoa / Chrome μs —— 一次输入全表互转。与 timecodec.js/timecodecExt.js
 *   的边界：那两个是「单纪元 ↔ ISO8601」双向 op，本 op 是「多纪元之间对照表」，
 *   ISO 行仅作辅助展示，不做双向解码。
 * - 频率：Hz/kHz/MHz/GHz。
 * - 角度：度/弧度/梯度。
 * - 长度（MT81）：km/m/cm/mm/in/ft/yd/mi/nmi/里/尺…（与 unitTables.js 同源）。
 * - 速度（MT81）：m/s、km/h、mph、kn（与 unitTables.js 同源）。
 * - 货币面额（MT81）：人民币元角分、美元 dollar/cent 等主辅币（**非汇率**，
 *   与 unitTables.js 同源）。
 *
 * 换算系数溯源（北极星第二条，每个系数给依据）：
 * - SI 词头 k/M/G/T/P = 10^3/10^6/10^9/10^12/10^15：BIPM《国际单位制（SI）》
 *   第 9 版（2019）§3「SI 词头」表。
 * - 二进制词头 Ki/Mi/Gi/Ti/Pi = 2^10/2^20/2^30/2^40/2^50：IEC 60027-2:2005
 *   （A.2 节首次标准化）+ IEC 80000-13:2008（继承并正式编号）。
 * - 1 Byte = 8 bit：IEC 80000-13:2008 §3.3。
 * - FILETIME：自 1601-01-01 00:00:00 UTC 起的 100 纳秒数——Microsoft Win32 API
 *   文档 FILETIME 结构（learn.microsoft.com/windows/win32/api/minwinbase）；
 *   1601→1970 纪元差 = 11644473600 秒（11644473600000 ms，timecodec.js 同源常量）。
 * - Cocoa/NSDate：自 2001-01-01 00:00:00 UTC 的秒数——Apple 文档 NSDate
 *   （developer.apple.com/documentation/foundation/nsdate）；1970→2001 差 =
 *   978307200 秒。
 * - Chrome 时间：自 1601-01-01 UTC 的微秒数——Chromium 源码 base/time.h
 *   Time::FromInternalValue（与 FILETIME 同纪元，单位差 10 倍：100ns vs μs）。
 * - DOS 日期时间：MS-DOS/FAT 目录项 16+16 位打包（Duncan《IBM PC 电磁资料》、
 *   RBIL），年份 1980–2107，秒精度 2 秒（sec/2 存 5 位）。
 * - 时间单位：s 为 SI 基本单位（BIPM）；min = 60 s、h = 3600 s（历史约定，
 *   SI 接受并用）；d = 86400 s（平太阳日，ISO 80000-3）。
 * - 角度：deg（360° = 周角）；rad 为 SI 导出单位（ISO 80000-3，π rad = 180°）；
 *   gon（梯度，400 gon = 360°，ISO 80000-1 附录平面角单位）。
 *
 * 精度方案（任务卡硬要求）：数据量/速率/时间/时间戳组全程 BigInt 有理数
 * {n, d}（分母恒正，构造时 gcd 约分）。理由：PB 级字节数（10^15）虽在
 * Number.MAX_SAFE_INTEGER（≈9.007×10^15）内，但 1 PiB = 2^50 ≈ 1.126×10^15
 * 的中间换算（×1024、×8 累乘）极易越界；且小数（953.67431640625 MiB）在
 * double 下只能到 17 位有效数字，有理数能给精确有限小数 + 截断标记。
 * 仅角度组（含 π 无理因子）用 Number 双精度，报告注明 17 位有效。
 *
 * 输出约定：整数部分 BigInt 全精度（1 PB → 1000000000000000 十五位全给）；
 * 小数 12 位截断，截断处（余数非零）尾标 "…"，精确有限小数不加标。
 * |值| < 10^-6 且非零时退科学计数法（13 位有效）。
 *
 * 红线：core 层零 UI 依赖（仅 registry）；纯本地零外发。
 */
import { register } from "./registry.js";

// ============ 有理数（BigInt 分子/分母，分母恒正） ============
function bigAbs(a) {
  return a < 0n ? -a : a;
}
function bigGcd(a, b) {
  a = bigAbs(a);
  b = bigAbs(b);
  while (b) {
    const t = a % b;
    a = b;
    b = t;
  }
  return a;
}
function rat(n, d = 1n) {
  if (d === 0n) throw new Error("有理数分母为零");
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = bigGcd(n, d) || 1n;
  return { n: n / g, d: d / g };
}
function ratMul(a, b) {
  return rat(a.n * b.n, a.d * b.d);
}
function ratDiv(a, b) {
  if (b.n === 0n) throw new Error("除数为零");
  return rat(a.n * b.d, a.d * b.n);
}
function ratIsZero(a) {
  return a.n === 0n;
}

// 有理数 → 字符串：整数部分全精度，小数 12 位截断（非精确处尾标 "…"），
// |值|<10^-6 非零退科学计数法（13 位有效）。
function ratToStr(a, fracDigits = 12) {
  if (a.n === 0n) return "0";
  const neg = a.n < 0n;
  const n = bigAbs(a.n);
  const intPart = n / a.d;
  let rem = n % a.d;
  let frac = "";
  let truncated = false;
  if (rem !== 0n) {
    // 先判 |值| < 10^-6（整数部分 0 且首 6 位小数全零）→ 科学计数法
    let probe = rem;
    let zeros = 0;
    while (probe !== 0n && zeros < 6 && (probe * 10n) / a.d === 0n) {
      probe = (probe * 10n) % a.d === 0n ? 0n : probe;
      // 逐位探测前 6 位是否全零
      const digit = (probe * 10n) / a.d;
      if (digit !== 0n) break;
      probe = (probe * 10n) % a.d;
      zeros++;
    }
    if (intPart === 0n && zeros >= 6) {
      const num = Number(a.n) / Number(a.d);
      return num.toPrecision(13);
    }
    for (let i = 0; i < fracDigits && rem !== 0n; i++) {
      rem *= 10n;
      frac += (rem / a.d).toString();
      rem %= a.d;
    }
    if (rem !== 0n) truncated = true;
    frac = frac.replace(/0+$/, ""); // 去尾零
  }
  const body = frac ? `${intPart}.${frac}` : `${intPart}`;
  return (neg ? "-" : "") + body + (truncated ? "…" : "");
}

// 有理数 → Number（仅展示用：ISO 时间、双精度角度）
function ratToNum(a) {
  return Number(a.n) / Number(a.d);
}

// ============ 系数表（全部有理数，溯源见文件头注释） ============
const R0 = rat(0n);
const R1 = rat(1n);

// -- 数据量（基准：字节 B） --
// SI（BIPM SI 第9版 §3）：k=10^3 M=10^6 G=10^9 T=10^12 P=10^15
// IEC（60027-2:2005 / 80000-13:2008）：Ki=2^10 Mi=2^20 Gi=2^30 Ti=2^40 Pi=2^50
const DATA_SIZE = [
  { u: "PB",  k: rat(10n ** 15n), sys: "SI" },
  { u: "TB",  k: rat(10n ** 12n), sys: "SI" },
  { u: "GB",  k: rat(10n ** 9n),  sys: "SI" },
  { u: "MB",  k: rat(10n ** 6n),  sys: "SI" },
  { u: "KB",  k: rat(10n ** 3n),  sys: "SI" },
  { u: "B",   k: R1,              sys: "SI" },
  { u: "PiB", k: rat(1n << 50n),  sys: "IEC" },
  { u: "TiB", k: rat(1n << 40n),  sys: "IEC" },
  { u: "GiB", k: rat(1n << 30n),  sys: "IEC" },
  { u: "MiB", k: rat(1n << 20n),  sys: "IEC" },
  { u: "KiB", k: rat(1n << 10n),  sys: "IEC" },
];

// -- 数据速率（基准：bit/s） --
// bps 系 bit/s（SI 词头）；Byte = 8 bit（IEC 80000-13 §3.3）
const DATA_RATE = [
  { u: "Gbps", k: rat(10n ** 9n),  dim: "bit" },
  { u: "Mbps", k: rat(10n ** 6n),  dim: "bit" },
  { u: "Kbps", k: rat(10n ** 3n),  dim: "bit" },
  { u: "bps",  k: R1,              dim: "bit" },
  { u: "MB/s", k: rat(10n ** 6n * 8n), dim: "byte" },
  { u: "KB/s", k: rat(10n ** 3n * 8n), dim: "byte" },
  { u: "B/s",  k: rat(8n),         dim: "byte" },
];

// -- 时间（基准：秒 s，SI 基本单位；min/h/d 见文件头溯源） --
const TIME_UNITS = [
  { u: "d",  k: rat(86400n) },
  { u: "h",  k: rat(3600n) },
  { u: "min", k: rat(60n) },
  { u: "s",  k: R1 },
  { u: "ms", k: rat(1n, 1000n) },
  { u: "μs", k: rat(1n, 10n ** 6n) },
  { u: "ns", k: rat(1n, 10n ** 9n) },
];

// -- 频率（基准：Hz，SI 词头） --
const FREQ_UNITS = [
  { u: "GHz", k: rat(10n ** 9n) },
  { u: "MHz", k: rat(10n ** 6n) },
  { u: "kHz", k: rat(10n ** 3n) },
  { u: "Hz",  k: R1 },
];

// -- 角度（基准：度 deg；rad/gon 用 Number——π 无理因子，双精度 17 位） --
// deg→rad：×π/180（ISO 80000-3）；deg→gon：×10/9（400 gon = 360°）
const ANGLE_UNITS = ["deg", "rad", "gon"];

// -- 长度（基准：米 m；MT81 尾巴：op 侧补齐，与 unitTables.js 的 LENGTH_UNITS 逐字同源） --
// 英制精确值来自 1959 年美英等六国《国际码磅协定》；市制取 1984 年国务院
// 《关于在我国统一实行法定计量单位的命令》；au/ly 为天文距离参考。
// ⚠ 同源约定：此表与 src/core/unitTables.js 的 LENGTH_UNITS 必须保持一致，
//   改单位先改那边（视图层事实源），这边同步。禁止只改一边造成 op 与视图漂移。
const LEN_UNITS = [
  { u: "km", zh: "千米", k: rat(10n ** 3n) },
  { u: "m", zh: "米", k: R1 },
  { u: "dm", zh: "分米", k: rat(1n, 10n) },
  { u: "cm", zh: "厘米", k: rat(1n, 10n ** 2n) },
  { u: "mm", zh: "毫米", k: rat(1n, 10n ** 3n) },
  { u: "μm", zh: "微米", k: rat(1n, 10n ** 6n) },
  { u: "nm", zh: "纳米", k: rat(1n, 10n ** 9n) },
  { u: "in", zh: "英寸", k: rat(254n, 10n ** 4n) },
  { u: "ft", zh: "英尺", k: rat(3048n, 10n ** 4n) },
  { u: "yd", zh: "码", k: rat(9144n, 10n ** 4n) },
  { u: "mi", zh: "英里", k: rat(1609344n, 10n ** 3n) },
  { u: "nmi", zh: "海里", k: rat(1852n) },
  { u: "里", zh: "市里", k: rat(500n) },
  { u: "丈", zh: "市丈", k: rat(10n, 3n) },
  { u: "尺", zh: "市尺", k: rat(1n, 3n) },
  { u: "寸", zh: "市寸", k: rat(1n, 30n) },
  { u: "au", zh: "天文单位", k: rat(149597870700n) },
  { u: "ly", zh: "光年", k: rat(9460730472580800n) },
];

// -- 货币「面额」换算（不是汇率！MT81 尾巴：op 侧补齐，与 unitTables.js 同源） --
// 恒烈 2026-08-23 明确：货币要的是「元/角/分」这种**同一种货币内部主辅币面额**换算，
// 比例由法律/铸币法定死，是精确常数，不联网、不过期、与零外发红线无冲突。
// ⚠ 每种货币各自成一组，组间绝不互转（跨币种才需汇率，本工具不做）。
// ⚠ 同源约定：与 unitTables.js 的 CURRENCY_SETS 保持一致，改先改那边，这边同步。
const CURRENCY_SETS = [
  {
    id: "cur_cny", name: "人民币", base: "元",
    note: "《人民币管理条例》（国务院令第 280 号，2000）§2：1 元 = 10 角 = 100 分。厘仅用于记账计息。",
    units: [
      { u: "元", zh: "元（圆）", k: R1 },
      { u: "角", zh: "角（毛）", k: rat(1n, 10n) },
      { u: "分", zh: "分", k: rat(1n, 100n) },
      { u: "厘", zh: "厘（仅记账）", k: rat(1n, 1000n) },
    ],
  },
  {
    id: "cur_usd", name: "美元", base: "dollar",
    note: "美国《1792 年铸币法》：1 dollar = 10 dimes = 100 cents = 1000 mills；nickel/quarter/half 为现行流通面额。mill 仅用于记账。",
    units: [
      { u: "dollar", zh: "美元", k: R1 },
      { u: "half", zh: "半美元", k: rat(1n, 2n) },
      { u: "quarter", zh: "四分之一美元", k: rat(1n, 4n) },
      { u: "dime", zh: "一角", k: rat(1n, 10n) },
      { u: "nickel", zh: "五分", k: rat(1n, 20n) },
      { u: "cent", zh: "美分", k: rat(1n, 100n) },
      { u: "mill", zh: "密尔（仅记账）", k: rat(1n, 1000n) },
    ],
  },
  {
    id: "cur_eur", name: "欧元", base: "euro",
    note: "欧盟理事会条例 (EC) No 974/98 §2：1 euro = 100 cent。",
    units: [
      { u: "euro", zh: "欧元", k: R1 },
      { u: "cent", zh: "欧分", k: rat(1n, 100n) },
    ],
  },
  {
    id: "cur_gbp", name: "英镑", base: "pound",
    note: "1971-02-15「十进制日」起 1 £ = 100 新便士；此前 £sd 旧制 1 £ = 20 先令 = 240 旧便士。CTF/古文献常见。",
    units: [
      { u: "pound", zh: "英镑", k: R1 },
      { u: "shilling", zh: "先令（1971 前）", k: rat(1n, 20n) },
      { u: "penny", zh: "新便士 p", k: rat(1n, 100n) },
      { u: "old_penny", zh: "旧便士 d（1971 前）", k: rat(1n, 240n) },
    ],
  },
  {
    id: "cur_jpy", name: "日元", base: "円",
    note: "1871 年《新货条例》：1 円 = 100 銭 = 1000 厘；1953 年小额通货整理法废止銭/厘流通，仅存记账与史料。",
    units: [
      { u: "円", zh: "日元", k: R1 },
      { u: "銭", zh: "钱（1953 废止）", k: rat(1n, 100n) },
      { u: "厘", zh: "厘（1953 废止）", k: rat(1n, 1000n) },
    ],
  },
  {
    id: "cur_hkd", name: "港币", base: "元",
    note: "香港金融管理局货币制度：1 元 = 10 毫 = 100 仙（毫 = 10 cents，仙 = cent）。",
    units: [
      { u: "元", zh: "港元", k: R1 },
      { u: "毫", zh: "毫（10 仙）", k: rat(1n, 10n) },
      { u: "仙", zh: "仙", k: rat(1n, 100n) },
    ],
  },
];

// -- 速度（基准：m/s；MT81 尾巴：op 侧补齐 mph/kn，与 unitTables.js 的 SPEED_UNITS 同源）--
// mph = 1 mi/h = 0.44704 m/s 精确（由 mi 精确值导出）；kn = 1 nmi/h = 1852/3600 m/s 精确。
// ⚠ 同源约定：与 unitTables.js 的 SPEED_UNITS 保持一致，改先改那边，这边同步。
const SPEED_UNITS = [
  { u: "m/s", zh: "米每秒", k: R1 },
  { u: "km/h", zh: "千米每小时", k: rat(5n, 18n) },
  { u: "mph", zh: "英里每小时", k: rat(44704n, 10n ** 5n) },
  { u: "kn", zh: "节", k: rat(463n, 900n) },
];

// -- 时间戳纪元（全部换算到 Unix 秒基准；溯源见文件头） --
// 1601→1970 = 11644473600 s（MSDN FILETIME）；1970→2001 = 978307200 s（Apple NSDate）
const FT_OFF = 11644473600n; // 1601 纪元 ↔ 1970 纪元 秒差
const COCOA_OFF = 978307200n; // 1970 ↔ 2001 纪元 秒差
const TS_EPOCHS = {
  unix_s:   { label: "Unix 秒",       toSec: (v) => v },
  unix_ms:  { label: "Unix 毫秒",     toSec: (v) => ratDiv(v, rat(1000n)) },
  filetime: { label: "Windows FILETIME", toSec: (v) => ratSub(ratDiv(v, rat(10n ** 7n)), rat(FT_OFF)) },
  cocoa:    { label: "Mac Cocoa 秒",  toSec: (v) => ratAdd(v, rat(COCOA_OFF)) },
  chrome_us:{ label: "Chrome 微秒",   toSec: (v) => ratSub(ratDiv(v, rat(10n ** 6n)), rat(FT_OFF)) },
};
function ratAdd(a, b) {
  return rat(a.n * b.d + b.n * a.d, a.d * b.d);
}
function ratSub(a, b) {
  return rat(a.n * b.d - b.n * a.d, a.d * b.d);
}

// ============ 输入解析 ============
// 形如 "1.5 GB" / "1 GiB" / "100 Mbps" / "42 min" / 纯数字（→时间戳嗅探）
// 小数解析走有理数：1.5 → 3/2（无 double 中转，零精度损失）
function parseRatDecimal(s) {
  const m = /^[+-]?(\d+)(?:\.(\d+))?$/.test(s) && s.match(/^[+-]?(\d+)(?:\.(\d+))?$/);
  if (!m) {
    // 纯整数（可超大）也收：BigInt 直接建
    if (/^[+-]?\d+$/.test(s)) return rat(BigInt(s));
    return null;
  }
  const sign = s.startsWith("-") ? -1n : 1n;
  const intPart = BigInt(m[1]);
  const frac = m[2] || "";
  if (frac.length > 18) throw new Error(`小数位 ${frac.length} 位过长（上限 18，防输入滥用）`);
  const numer = sign * (intPart * 10n ** BigInt(frac.length) + (frac ? BigInt(frac) : 0n));
  return rat(numer, 10n ** BigInt(frac.length));
}

// 单位别名归一（μs 的 Unicode 希腊 mu、角度的中文与符号、长度中文全名、货币中文名、英文全名）
function normUnit(u) {
  const map = {
    "us": "μs", "µs": "μs", "°": "deg", "度": "deg", "弧度": "rad", "梯度": "gon", "grad": "gon",
    // 长度中文全名 → 符号（与 LEN_UNITS 的 u 对齐）
    "米": "m", "千米": "km", "公里": "km", "分米": "dm", "厘米": "cm", "毫米": "mm",
    "微米": "μm", "纳米": "nm", "英寸": "in", "英尺": "ft", "码": "yd", "英里": "mi",
    "海里": "nmi", "市里": "里", "市丈": "丈", "市尺": "尺", "市寸": "寸",
    "天文单位": "au", "光年": "ly",
    // 长度英文全名 → 符号
    "kilometer": "km", "kilometre": "km", "meter": "m", "metre": "m",
    "decimeter": "dm", "decimetre": "dm", "centimeter": "cm", "centimetre": "cm",
    "millimeter": "mm", "millimetre": "mm", "micrometer": "μm", "nanometer": "nm",
    "inch": "in", "foot": "ft", "feet": "ft", "yard": "yd", "mile": "mi",
    "nautical mile": "nmi", "nautical mile": "nmi", "light year": "ly",
    // 货币中文名 → 主币单位（与 CURRENCY_SETS 各组 units 的 u 对齐）
    "美元": "dollar", "美金": "dollar", "欧元": "euro", "英镑": "pound",
    "日元": "円", "人民币": "元", "港币": "元", "港元": "元",
    // 速度英文/中文名
    "knot": "kn", "节": "kn", "公里每小时": "km/h", "千米每小时": "km/h", "英里每小时": "mph",
    "mile/hour": "mph", "miles per hour": "mph", "miles/hour": "mph",
    "USD": "dollar", "usd": "dollar", "CNY": "元", "cny": "元", "EUR": "euro", "eur": "euro",
    "GBP": "pound", "gbp": "pound", "JPY": "円", "jpy": "円", "HKD": "元", "hkd": "元",
  };
  return map[u] || u;
}

// 按单位定位组
function findGroup(unit) {
  if (DATA_SIZE.some((x) => x.u === unit)) return "dataSize";
  if (DATA_RATE.some((x) => x.u === unit)) return "dataRate";
  if (TIME_UNITS.some((x) => x.u === unit)) return "time";
  if (FREQ_UNITS.some((x) => x.u === unit)) return "freq";
  if (ANGLE_UNITS.includes(unit)) return "angle";
  if (LEN_UNITS.some((x) => x.u === unit)) return "length";
  if (SPEED_UNITS.some((x) => x.u === unit)) return "speed";
  if (CURRENCY_SETS.some((g) => g.units.some((x) => x.u === unit))) return "currency";
  return null;
}

// 时间戳纪元嗅探（数量级启发，BigInt 比较；判定结果写进报告，参数可覆盖）
function sniffEpoch(v) {
  const a = bigAbs(v.n) / v.d; // 整数部分量级
  const B = (x) => 10n ** BigInt(x);
  if (a >= B(17)) return "filetime"; // 当前时刻 100ns ≈ 1.34×10^17
  if (a >= B(14)) return "chrome_us"; // 当前时刻 μs ≈ 1.34×10^15
  if (a >= B(11)) return "unix_ms"; // 当前时刻 ms ≈ 1.79×10^12
  return "unix_s";
}

// ============ 各组报告 ============
function fmtUnitLine(u, val) {
  return `  ${u.padEnd(5)} = ${ratToStr(val)}`;
}

function dataSizeReport(qty, unit) {
  const def = DATA_SIZE.find((x) => x.u === unit);
  const bytes = ratMul(qty, def.k); // 基准字节（有理数）
  const lines = [];
  lines.push(`【数据量换算】输入：${ratToStr(qty)} ${unit}（${def.sys === "SI" ? "SI 1000 制" : "IEC 1024 制"}）`);
  lines.push("");
  lines.push(`字节总数（BigInt 精确）：${ratToStr(bytes)} B`);
  lines.push("");
  lines.push("▍1000 制（SI 词头：BIPM《国际单位制》第 9 版 §3）");
  for (const x of DATA_SIZE.filter((x) => x.sys === "SI")) {
    lines.push(fmtUnitLine(x.u, ratDiv(bytes, x.k)));
  }
  lines.push("");
  lines.push("▍1024 制（IEC 60027-2:2005 / IEC 80000-13:2008）");
  for (const x of DATA_SIZE.filter((x) => x.sys === "IEC")) {
    lines.push(fmtUnitLine(x.u, ratDiv(bytes, x.k)));
  }
  lines.push("");
  lines.push("注：1 Byte = 8 bit（IEC 80000-13 §3.3）；两制数值不同是特性不是 bug——");
  lines.push("    硬件容量习惯 SI 制（1 TB = 10^12 B），操作系统显容习惯 IEC 制（1 TiB = 2^40 B）。");
  return lines.join("\n");
}

function dataRateReport(qty, unit) {
  const def = DATA_RATE.find((x) => x.u === unit);
  const bps = ratMul(qty, def.k); // 基准 bit/s
  const lines = [];
  lines.push(`【数据速率换算】输入：${ratToStr(qty)} ${unit}`);
  lines.push("");
  lines.push("▍bit 侧（SI 词头）");
  for (const x of DATA_RATE.filter((x) => x.dim === "bit")) {
    lines.push(fmtUnitLine(x.u, ratDiv(bps, x.k)));
  }
  lines.push("");
  lines.push("▍Byte 侧（1 Byte = 8 bit，IEC 80000-13 §3.3）");
  for (const x of DATA_RATE.filter((x) => x.dim === "byte")) {
    lines.push(fmtUnitLine(x.u, ratDiv(bps, x.k)));
  }
  lines.push("");
  lines.push("注：Kbps=10^3 bit/s（SI）；KB/s=10^3 Byte/s。运营商带宽bps、下载速度B/s，");
  lines.push("    8 倍关系是网络测速「100M 宽带下载约 12.5MB/s」的由来。");
  return lines.join("\n");
}

function timeReport(qty, unit) {
  const def = TIME_UNITS.find((x) => x.u === unit);
  const secs = ratMul(qty, def.k); // 基准秒
  const lines = [];
  lines.push(`【时间换算】输入：${ratToStr(qty)} ${unit}`);
  lines.push("");
  for (const x of TIME_UNITS) {
    lines.push(fmtUnitLine(x.u, ratDiv(secs, x.k)));
  }
  lines.push("");
  lines.push("注：s 为 SI 基本单位；min=60 s、h=3600 s（历史约定，SI 接受并用）；d=86400 s（平太阳日，ISO 80000-3）。");
  return lines.join("\n");
}

function freqReport(qty, unit) {
  const def = FREQ_UNITS.find((x) => x.u === unit);
  const hz = ratMul(qty, def.k);
  const lines = [];
  lines.push(`【频率换算】输入：${ratToStr(qty)} ${unit}`);
  lines.push("");
  for (const x of FREQ_UNITS) {
    lines.push(fmtUnitLine(x.u, ratDiv(hz, x.k)));
  }
  lines.push("");
  lines.push("注：Hz 为 SI 导出单位（s^-1）；k/M/G 为 SI 词头（BIPM《国际单位制》第 9 版 §3）。");
  return lines.join("\n");
}

function angleReport(qty, unit) {
  const d = ratToNum(qty) * (unit === "deg" ? 1 : unit === "rad" ? 180 / Math.PI : 0.9); // 归一到度
  const rad = (d * Math.PI) / 180;
  const gon = (d * 10) / 9;
  const f = (x) => Number(x.toPrecision(15));
  const lines = [];
  lines.push(`【角度换算】输入：${ratToStr(qty)} ${unit}`);
  lines.push("");
  lines.push(`  deg   = ${f(d)}`);
  lines.push(`  rad   = ${f(rad)}`);
  lines.push(`  gon   = ${f(gon)}`);
  lines.push("");
  lines.push("注：rad 为 SI 导出单位，π rad = 180°（ISO 80000-3）；gon 梯度 400 gon = 360°（ISO 80000-1）。");
  lines.push("    rad/gon 含 π 无理因子，无有限精确值——Number 双精度 15 位有效，非 BigInt 有理数路径。");
  return lines.join("\n");
}

// -- 长度报告（MT81 尾巴）--
function lengthReport(qty, unit) {
  const def = LEN_UNITS.find((x) => x.u === unit);
  const meters = ratMul(qty, def.k); // 基准米（有理数）
  const lines = [];
  lines.push(`【长度换算】输入：${ratToStr(qty)} ${unit}（${def.zh}）`);
  lines.push("");
  for (const x of LEN_UNITS) {
    lines.push(fmtUnitLine(x.u, ratDiv(meters, x.k)));
  }
  lines.push("");
  lines.push("注：英制单位为 1959 年《国际码磅协定》精确值（in/ft/yd/mi）；市制取 1984 年国务院法定计量单位命令；");
  lines.push("    au/ly 为天文距离参考。");
  return lines.join("\n");
}

// -- 速度报告（MT81 尾巴）--
function speedReport(qty, unit) {
  const def = SPEED_UNITS.find((x) => x.u === unit);
  const ms = ratMul(qty, def.k); // 基准 m/s（有理数）
  const lines = [];
  lines.push(`【速度换算】输入：${ratToStr(qty)} ${unit}（${def.zh}）`);
  lines.push("");
  for (const x of SPEED_UNITS) {
    lines.push(fmtUnitLine(x.u, ratDiv(ms, x.k)));
  }
  lines.push("");
  lines.push("注：mph = 1 mi/h = 0.44704 m/s（由 1959 年协定 mi 精确值导出）；kn = 1 nmi/h = 1852/3600 m/s。");
  return lines.join("\n");
}

// -- 货币面额报告（MT81 尾巴；组间绝不互转，同种货币内部列全部面额）--
function currencyReport(qty, unit) {
  const hits = CURRENCY_SETS.filter((g) => g.units.some((x) => x.u === unit));
  if (!hits.length) throw new Error(`未知货币面额 '${unit}'`);
  const lines = [];
  for (const g of hits) {
    const def = g.units.find((x) => x.u === unit);
    const base = ratMul(qty, def.k); // 换算到该货币组基准（元/dollar/…）
    lines.push(`【${g.name}·面额换算】输入：${ratToStr(qty)} ${unit}（1 ${g.base} = ${ratToStr(g.units[0].k)}）`);
    lines.push("");
    for (const x of g.units) {
      lines.push(`  ${String(x.u).padEnd(9)} = ${ratToStr(ratDiv(base, x.k))} ${x.zh}`);
    }
    lines.push("");
    lines.push(`注：${g.note}`);
    lines.push("    跨币种换算需实时汇率，本工具不做（零外发红线：绝不联网取价）。");
    lines.push("");
  }
  return lines.join("\n");
}

// DOS 日期时间打包（FAT 目录项 16+16 位；1980–2107；秒精度 2 秒）
function unixSecToDos(secRat) {
  const secNum = ratToNum(secRat);
  if (!Number.isFinite(secNum) || Math.abs(secNum) > 8.64e15) return "（超出 DOS 可表示范围）";
  const t = new Date(Math.round(secNum) * 1000);
  const y = t.getUTCFullYear();
  if (y < 1980 || y > 2107) return "（超出 DOS 年份范围 1980–2107）";
  const dosDate = ((y - 1980) << 9) | ((t.getUTCMonth() + 1) << 5) | t.getUTCDate();
  const dosTime = (t.getUTCHours() << 11) | (t.getUTCMinutes() << 5) | (Math.floor(t.getUTCSeconds() / 2));
  const packed = (dosDate * 0x10000) + dosTime;
  return `0x${packed.toString(16).toUpperCase().padStart(8, "0")}（日期 0x${dosDate.toString(16).toUpperCase().padStart(4, "0")} 时间 0x${dosTime.toString(16).toUpperCase().padStart(4, "0")}，UTC 打包，2 秒精度）`;
}

function tsReport(qty, epochKey) {
  const ep = TS_EPOCHS[epochKey];
  const sec = ep.toSec(qty); // 统一 Unix 秒（有理数，可负 = 1970 前）
  const secInt = sec.n / sec.d; // 整数秒（BigInt 截断）
  const fracSec = sec.n % sec.d !== 0n;
  const lines = [];
  lines.push(`【时间戳纪元对照】输入：${ratToStr(qty)}（按 ${ep.label} 解读${epochKey === "auto" ? "，auto 嗅探" : ""}）`);
  lines.push("");
  lines.push(`  Unix 秒      : ${secInt}${fracSec ? `（+${ratToStr(rat(sec.n % sec.d, sec.d))} 小数秒）` : ""}`);
  lines.push(`  Unix 毫秒    : ${secInt * 1000n}${fracSec ? "（含小数秒，已截断到整数毫秒外的部分见上）" : ""}`);
  lines.push(`  FILETIME     : ${(secInt + FT_OFF) * 10n ** 7n}（1601-01-01 UTC 起 100ns，MSDN FILETIME）`);
  lines.push(`  Cocoa 秒     : ${secInt - COCOA_OFF}（2001-01-01 UTC 起，Apple NSDate）`);
  lines.push(`  Chrome μs    : ${(secInt + FT_OFF) * 10n ** 6n}（1601-01-01 UTC 起 μs，Chromium base/time.h）`);
  lines.push(`  DOS 日期时间 : ${unixSecToDos(sec)}`);
  // ISO 辅助行（不做双向解码，双向归 timecodec.js/timecodecExt.js）
  const msNum = ratToNum(sec) * 1000;
  if (Number.isFinite(msNum) && Math.abs(msNum) <= 8.64e15) {
    lines.push(`  ISO8601(UTC) : ${new Date(msNum).toISOString()}（辅助展示；↔ISO 双向转换用 timecodec 系 op）`);
  } else {
    lines.push("  ISO8601(UTC) : （超出 Date 可显示范围）");
  }
  lines.push("");
  lines.push("注：FILETIME/Chrome 同纪元（1601-01-01 UTC）不同单位（100ns vs μs，10 倍关系）；");
  lines.push("    DOS 时间为 FAT 目录项 16+16 位打包（1980–2107，2 秒精度），无时区概念，按 UTC 打包。");
  return lines.join("\n");
}

// ============ 主入口 ============
function unitConvRun(text, p) {
  const s = String(text ?? "").trim();
  if (!s) throw new Error("空输入：如 1 GB / 1.5 GiB / 100 Mbps / 42 min / 1655526400");
  if (s.length > 4096) throw new Error(`输入 ${s.length} 字符超过上限 4096`);
  // 拆「数值 + 可选单位」
  const m = s.match(/^([+-]?[\d.]+)\s*(.*)$/);
  if (!m) throw new Error(`无法解析输入 "${s.slice(0, 32)}"：须为「数值 单位」或纯数字（时间戳）`);
  const qty = parseRatDecimal(m[1]);
  if (!qty) throw new Error(`数值部分 "${m[1]}" 不合法（支持整数/小数，如 1.5）`);
  if (m[1].includes("..")) throw new Error(`数值部分 "${m[1]}" 不合法`);
  let unit = normUnit(m[2] || "");
  if (!unit) {
    // 纯数字 → 时间戳纪元对照（参数可覆盖嗅探）
    const want = (p && p.tsEpoch) || "auto";
    const key = want === "auto" ? sniffEpoch(qty) : want;
    if (!TS_EPOCHS[key]) throw new Error(`未知纪元类型：${want}`);
    return tsReport(qty, key);
  }
  const grp = findGroup(unit);
  if (!grp) {
    throw new Error(`未知单位 '${unit}'。支持：数据量 B/KB/MB/GB/TB/PB/KiB…PiB；速率 bps/Kbps/Mbps/Gbps/B/s/KB/s/MB/s；时间 ns/μs/ms/s/min/h/d；频率 Hz/kHz/MHz/GHz；角度 deg/rad/gon；长度 km/m/cm/mm/in/ft/yd/mi/nmi/里/尺…；货币 元/角/分、dollar/cent/quarter…；或纯数字（时间戳纪元对照）`);
  }
  if (grp === "dataSize") return dataSizeReport(qty, unit);
  if (grp === "dataRate") return dataRateReport(qty, unit);
  if (grp === "time") return timeReport(qty, unit);
  if (grp === "freq") return freqReport(qty, unit);
  if (grp === "length") return lengthReport(qty, unit);
  if (grp === "speed") return speedReport(qty, unit);
  if (grp === "currency") return currencyReport(qty, unit);
  return angleReport(qty, unit);
}

// ============ 载入自校验（不符即抛错，阻断注册） ============
(() => {
  const must = (cond, msg) => {
    if (!cond) throw new Error("unitConv 自检失败：" + msg);
  };
  // 有理数基础
  must(ratToStr(rat(10n ** 15n, 1024n)) === "976562500000", "10^15/1024 ≠ 976562500000（BigInt 精度）");
  must(ratToStr(rat(3n, 2n)) === "1.5", "3/2 ≠ 1.5");
  must(ratToStr(rat(-7n, 2n)) === "-3.5", "-7/2 ≠ -3.5");
  must(ratToStr(R0) === "0", "0 格式");
  // 截断标记：1/3
  must(ratToStr(rat(1n, 3n)) === "0.333333333333…", "1/3 应 12 位截断带 …");
  // 有限小数无截断标：5^9/2^11 = 953.67431640625（11 位有限）
  must(ratToStr(rat(10n ** 9n, 1n << 20n)) === "953.67431640625", "10^9/2^20 应精确 953.67431640625 无 …");

  // 任务卡验证组 1：1 GB → 1000 MB 且 953.674… MiB
  let rep = unitConvRun("1 GB");
  must(rep.includes("MB    = 1000") || /MB\s+= 1000/.test(rep), "1 GB 应含 MB = 1000");
  must(/MiB\s+= 953\.67431640625/.test(rep), "1 GB 应含 MiB = 953.67431640625");
  must(/B\s+= 1000000000/.test(rep), "1 GB 应含 B = 1000000000");
  // 任务卡验证组 2：1 GiB → 1024 MiB / 1073741824 B
  rep = unitConvRun("1 GiB");
  must(/MiB\s+= 1024/.test(rep), "1 GiB 应含 MiB = 1024");
  must(/B\s+= 1073741824/.test(rep), "1 GiB 应含 B = 1073741824");
  must(/KB\s+= 1073741\.824/.test(rep), "1 GiB 应含 KB = 1073741.824（精确）");
  // 任务卡验证组 3：1 PB 精度不丢（15 位）
  rep = unitConvRun("1 PB");
  must(/B\s+= 1000000000000000/.test(rep), "1 PB 应含 B = 1000000000000000（15 位全精度）");
  must(/KiB\s+= 976562500000/.test(rep), "1 PB 应含 KiB = 976562500000（精确整除）");
  must(/MiB\s+= 953674316\.40625/.test(rep), "1 PB 应含 MiB = 953674316.40625");
  // 两制并排差异实证：1 TB ≠ 1 TiB
  rep = unitConvRun("1 TB");
  // 10^12/2^30 = 5^12/2^18 = 931.322574615478515625（18 位有限小数，截 12 位带 …）
  must(/GiB\s+= 931\.322574615478…/.test(rep), "1 TB 应含 GiB = 931.322574615478…（12 位截断标）");
  rep = unitConvRun("1 TiB");
  must(/GB\s+= 1099\.511627776/.test(rep), "1 TiB 应含 GB = 1099.511627776（精确）");
  // 速率：100 Mbps → 12.5 MB/s（8 倍关系）
  rep = unitConvRun("100 Mbps");
  must(/B\/s\s+= 12500000/.test(rep), "100 Mbps 应含 B/s = 12500000");
  must(/MB\/s\s+= 12\.5/.test(rep), "100 Mbps 应含 MB/s = 12.5");
  must(/Mbps\s+= 100/.test(rep), "100 Mbps 应含 Mbps = 100");
  // 1 Gbps → 125 MB/s
  rep = unitConvRun("1 Gbps");
  must(/MB\/s\s+= 125/.test(rep), "1 Gbps 应含 MB/s = 125");
  // 时间：1 h → 3600 s / 60 min / 0.041666666667 d
  rep = unitConvRun("1 h");
  must(/s\s+= 3600/.test(rep), "1 h 应含 s = 3600");
  must(/min\s+= 60/.test(rep), "1 h 应含 min = 60");
  must(/d\s+= 0\.041666666666…/.test(rep), "1 h 应含 d = 0.041666666666…");
  rep = unitConvRun("1 d");
  must(/s\s+= 86400/.test(rep), "1 d 应含 s = 86400");
  rep = unitConvRun("1 μs");
  must(/ns\s+= 1000/.test(rep), "1 μs 应含 ns = 1000");
  rep = unitConvRun("1 us");
  must(/ns\s+= 1000/.test(rep), "1 us（别名）应含 ns = 1000");
  // 频率
  rep = unitConvRun("1 GHz");
  must(/MHz\s+= 1000/.test(rep), "1 GHz 应含 MHz = 1000");
  must(/Hz\s+= 1000000000/.test(rep), "1 GHz 应含 Hz = 10^9");
  // 角度：90 deg → π/2 rad、100 gon
  rep = unitConvRun("90 deg");
  must(/rad\s+= 1\.5707963267949/.test(rep), "90 deg 应含 rad = 1.5707963267949…");
  must(/gon\s+= 100/.test(rep), "90 deg 应含 gon = 100");
  rep = unitConvRun("180 deg");
  must(/rad\s+= 3\.14159265358979/.test(rep), "180 deg 应含 rad = π");
  rep = unitConvRun("1 rad");
  must(/deg\s+= 57\.2957795130823/.test(rep), "1 rad 应含 deg = 57.2957795130823");
  // 时间戳：1655526400 unix_s → 全纪元对照（与 FILETIME 133000000000000000 回环）
  rep = unitConvRun("1655526400");
  must(/Unix 秒\s+: 1655526400/.test(rep), "1655526400 应判定 Unix 秒");
  must(/Unix 毫秒\s+: 1655526400000/.test(rep), "Unix 毫秒 = 1655526400000");
  must(/FILETIME\s+: 133000000000000000/.test(rep), "FILETIME = 133000000000000000");
  must(/Cocoa 秒\s+: 677219200/.test(rep), "Cocoa = 677219200（1655526400-978307200，node BigInt 对拍）");
  must(/Chrome μs\s+: 13300000000000000/.test(rep), "Chrome μs = 13300000000000000");
  // 任务卡验证组 4：FILETIME 133000000000000000 → Unix 时间（node Date 独立对拍）
  rep = unitConvRun("133000000000000000", { tsEpoch: "filetime" });
  const expectSec = 133000000000000000n / 10n ** 7n - FT_OFF; // node 独立算
  must(expectSec === 1655526400n, `对拍基准：FILETIME→Unix 秒应为 1655526400，实得 ${expectSec}`);
  must(/Unix 秒\s+: 1655526400/.test(rep), "FILETIME 输入应回 Unix 秒 1655526400（对拍一致）");
  must(/Unix 毫秒\s+: 1655526400000/.test(rep), "FILETIME 输入应回 Unix 毫秒 1655526400000");
  must(/Chrome μs\s+: 13300000000000000/.test(rep), "FILETIME 输入应回 Chrome μs 13300000000000000");
  // 嗅探：133000000000000000 纯数字 → filetime（≥10^17）
  rep = unitConvRun("133000000000000000");
  must(/按 Windows FILETIME 解读/.test(rep), "1.33×10^17 纯数字应嗅探为 FILETIME");
  must(/Unix 秒\s+: 1655526400/.test(rep), "嗅探 FILETIME 应回 Unix 秒 1655526400");
  // 嗅探：1655526400000 → unix_ms
  rep = unitConvRun("1655526400000");
  must(/按 Unix 毫秒 解读/.test(rep), "1.66×10^12 应嗅探为 Unix 毫秒");
  must(/Unix 秒\s+: 1655526400/.test(rep), "unix_ms 输入应回 Unix 秒 1655526400");
  // 嗅探：13300000000000000（10^16 量级）→ chrome_us
  rep = unitConvRun("13300000000000000");
  must(/按 Chrome 微秒 解读/.test(rep), "1.33×10^16 应嗅探为 Chrome μs");
  // DOS 打包两路对拍：unix 1655526400 → Date UTC 现算 vs 报告行
  {
    const t = new Date(1655526400 * 1000);
    const dd = ((t.getUTCFullYear() - 1980) << 9) | ((t.getUTCMonth() + 1) << 5) | t.getUTCDate();
    const dt = (t.getUTCHours() << 11) | (t.getUTCMinutes() << 5) | (t.getUTCSeconds() >> 1);
    const hex = ((dd * 0x10000) + dt).toString(16).toUpperCase().padStart(8, "0");
    rep = unitConvRun("1655526400");
    must(rep.includes(`0x${hex}`), `DOS 打包应含 0x${hex}（Date UTC 两路对拍）`);
  }
  // Cocoa 回环：2001-01-01 → cocoa 0 → unix 978307200
  rep = unitConvRun("0", { tsEpoch: "cocoa" });
  must(/Unix 秒\s+: 978307200/.test(rep), "Cocoa 0 应回 Unix 秒 978307200");
  // 1970 前负时间戳
  rep = unitConvRun("-1", { tsEpoch: "unix_s" });
  must(/Unix 秒\s+: -1/.test(rep), "-1 秒应原样");
  // 非法输入
  for (const bad of ["", "abc", "1 XX", "1.2.3 GB", "GB 1"]) {
    let threw = false;
    try {
      unitConvRun(bad);
    } catch (e) {
      threw = true;
    }
    must(threw, `非法输入 ${JSON.stringify(bad)} 应报错而未报`);
  }
  // 超长输入
  let threwLong = false;
  try {
    unitConvRun("1".repeat(4097));
  } catch (e) {
    threwLong = /超过上限/.test(e.message);
  }
  must(threwLong, "4097 字符应报超上限");
  // ── MT81 尾巴：长度 / 货币 ──
  rep = unitConvRun("1 mi");
  must(/m\s+= 1609\.344/.test(rep), "1 mi 应含 m = 1609.344（1959 协定精确值）");
  must(/km\s+= 1\.609344/.test(rep), "1 mi 应含 km = 1.609344");
  rep = unitConvRun("1 英里");
  must(/km\s+= 1\.609344/.test(rep), "1 英里（中文别名）应含 km = 1.609344");
  rep = unitConvRun("1 尺");
  must(/cm\s+= 33\.333333333333…/.test(rep), "1 市尺 应含 cm = 33.333…（精确 1/3 米）");
  rep = unitConvRun("1 元");
  must(/人民币·面额换算/.test(rep), "1 元 应含人民币面额组");
  must(/角\s+= 10 角/.test(rep), "1 元 应含角 = 10");
  must(/分\s+= 100 分/.test(rep), "1 元 应含分 = 100");
  must(/港币·面额换算/.test(rep), "1 元 也应含港币面额组（歧义全列）");
  rep = unitConvRun("1 dollar");
  must(/cent\s+= 100 美分/.test(rep), "1 dollar 应含 cent = 100");
  must(/quarter\s+= 4 四分之一美元/.test(rep), "1 dollar 应含 quarter = 4");
  rep = unitConvRun("1 分");
  must(/元\s+= 0\.01 元（圆）/.test(rep), "1 分 应含元 = 0.01");
  rep = unitConvRun("1 mph");
  must(/km\/h\s+= 1\.609344/.test(rep), "1 mph 应含 km/h = 1.609344");
  must(/m\/s\s+= 0\.44704/.test(rep), "1 mph 应含 m/s = 0.44704（精确）");
  rep = unitConvRun("1 mile");
  must(/km\s+= 1\.609344/.test(rep), "1 mile（英文全名）应含 km = 1.609344");
})();

register({
  id: "unitConv",
  cat: "data",
  name: "单位换算",
  desc: "数据量 B/KB/MB/GB/TB/PB 与 KiB/MiB/GiB/TiB/PiB 两制并列（SI 1000 制 vs IEC 60027-2 1024 制，系数全部可溯源）；速率 bps/Kbps/Mbps/Gbps ↔ B/s/KB/s/MB/s（bit×8）；时间 ns~d；纯数字触发时间戳纪元对照（Unix 秒/毫秒、FILETIME、Cocoa、Chrome μs、DOS 打包，数量级自动嗅探）；频率 Hz~GHz；角度 deg/rad/gon。数据量全程 BigInt 有理数，PB 级零精度损失，精确小数与截断位明确标注。",
  params: [
    { key: "tsEpoch", label: "时间戳纪元（输入为纯数字时生效，auto=按数量级嗅探）", type: "select", default: "auto", options: [
      { value: "auto", label: "auto（自动嗅探）" },
      { value: "unix_s", label: "Unix 秒（1970）" },
      { value: "unix_ms", label: "Unix 毫秒（1970）" },
      { value: "filetime", label: "Windows FILETIME（1601，100ns）" },
      { value: "cocoa", label: "Mac Cocoa 秒（2001）" },
      { value: "chrome_us", label: "Chrome 微秒（1601，μs）" },
    ] },
  ],
  run: (t, p) => unitConvRun(t, p),
});

// 导出面说明：
// - 前 4 个是 T339 原有导出（op 报告 + 有理数工具 + 纪元嗅探）。
// - 其余为 MT81「快速换算」视图所需：有理数四则、十进制解析、既有五组系数表与纪元表。
//   目的是让 unitTables.js / ui 层**复用同一份系数表**，不再抄第二份（抄一份就多一处失同步风险）。
//   只加导出，不改任何既有行为。
export {
  unitConvRun, rat, ratToStr, sniffEpoch,
  ratMul, ratDiv, ratAdd, ratSub, ratToNum, ratIsZero, parseRatDecimal, normUnit,
  DATA_SIZE, DATA_RATE, TIME_UNITS, FREQ_UNITS, ANGLE_UNITS, TS_EPOCHS,
};
