/*
 * unitTables.js — 单位换算分类总表（MT81「快速换算」视图的算法层）。
 *
 * 定位：**纯数据 + 纯函数，不注册 op**（不进 registry，不计入 op 数）。
 * T339 的 unitConv.js 是「一次性出报告」的 op；本文件是「按分类实时互转」的
 * 数据源与换算引擎，供 ui/quickConv.js 调用。
 *
 * 与 unitConv.js 的关系（红线：绝不抄第二份系数）：
 * - 有理数运算（rat/ratMul/ratDiv/ratAdd/ratSub/ratToStr/parseRatDecimal）
 *   全部 import 自 unitConv.js。
 * - 数据量 / 数据速率 / 时间 / 频率 / 角度 / 时间戳纪元 六组系数表直接复用
 *   unitConv.js 导出的 DATA_SIZE / DATA_RATE / TIME_UNITS / FREQ_UNITS /
 *   ANGLE_UNITS / TS_EPOCHS。本文件只**新增** unitConv 没有的九个分类。
 *
 * 精度：全程 BigInt 有理数（分子/分母），零 double 中转。两个例外并已标注：
 * - 角度组含 π 无理因子 → Number 双精度（沿用 unitConv 的口径）。
 * - 马赫数是标准大气模型给的实测值，本身即近似（见下方溯源）。
 *
 * 温度是**仿射变换**（y = ax + b）不是纯比例，单独一条路径：
 * 「20 °C 的两倍」没有物理意义，比例式换算会给出错误结果——这是单位换算器
 * 最经典的坑，这里用 toBase/fromBase 一对函数显式建模。
 *
 * ============ 换算系数溯源（北极星第二条：每个系数给依据，不许「参考网上」）============
 *
 * 【长度 length，基准 m】
 * - m 为 SI 基本单位（BIPM《国际单位制(SI)》第 9 版，2019；由 c = 299 792 458 m/s 定义）。
 * - in / ft / yd / mi 全部是**精确值**，来自 1959 年美英等六国《国际码磅协定》
 *   (International Yard and Pound Agreement)：1 yd ≡ 0.9144 m 精确，
 *   由此 1 ft = 0.3048 m、1 in = 25.4 mm、1 mi = 1760 yd = 1609.344 m 均为精确值。
 * - nmi（海里）= 1852 m 精确：1929 年国际水文地理会议；BIPM SI 手册表 8
 *   「与 SI 并用的非 SI 单位」列出。
 * - 市制（中国法定）：1984-02-27 国务院《关于在我国统一实行法定计量单位的命令》附件——
 *   1 市里 = 500 m、1 市丈 = 10/3 m、1 市尺 = 1/3 m、1 市寸 = 1/30 m（精确分数，非小数近似）。
 * - au（天文单位）= 149 597 870 700 m 精确：IAU 2012 年第 XXVIII 届大会 B2 号决议。
 * - ly（光年）= 9 460 730 472 580 800 m 精确：IAU 定义为儒略年（365.25 d）× c。
 *
 * 【面积 area，基准 m²】
 * - ha（公顷）= 10^4 m²、a（公亩）= 100 m²：BIPM SI 手册表 8。
 * - acre（英亩）= 4840 sq yd，由 yd 精确值导出 = 4046.856 422 4 m² 精确。
 * - sq mi / sq yd / sq ft / sq in 同理由长度精确值平方导出。
 * - 市亩 = 1/15 公顷 = 2000/3 m²（同 1984 年国务院命令；60 平方市丈 = 2000/3 m²）。
 *
 * 【体积 volume，基准 m³】
 * - L（升）= 10^-3 m³：第 12 届 CGPM（1964）；BIPM SI 手册表 8。
 * - US gal（美制加仑）≡ 231 in³ 精确（美国 1893 年 Mendenhall Order 体系 +
 *   NIST Handbook 44 附录 C）= 3.785 411 784 L 精确。
 * - imp gal（英制加仑）≡ 4.546 09 L 精确：英国 Weights and Measures Act 1985。
 * - US fl oz = US gal / 128；imp fl oz = imp gal / 160（两者不等，是最经典的坑）。
 * - bbl（石油桶）= 42 US gal = 158.987 294 928 L 精确。
 *
 * 【质量 mass，基准 kg】
 * - kg 为 SI 基本单位（2019 起由普朗克常量 h 定义）。
 * - lb（常衡磅）≡ 0.453 592 37 kg 精确：1959 年《国际码磅协定》。
 * - oz = lb/16；grain（格令）= lb/7000；stone = 14 lb（均由 lb 精确值导出）。
 * - ct（克拉）= 200 mg 精确：第 4 届 CGPM（1907）。
 * - t（吨）= 1000 kg：BIPM SI 手册表 8。
 * - 市斤 = 500 g、市两 = 50 g、市钱 = 5 g：1984 年国务院命令。
 *
 * 【温度 temp，基准 K】—— 仿射，见上
 * - K 为 SI 基本单位（2019 起由玻尔兹曼常量 k 定义）。
 * - t/°C = T/K − 273.15：BIPM SI 手册 §2.3.1（273.15 是精确值，非测量值）。
 * - °F = °C × 9/5 + 32；°R（兰金度）= K × 9/5：NIST SP 811 附录 B.8。
 *
 * 【速度 speed，基准 m/s】
 * - km/h = 1/3.6 m/s（精确分数 5/18）。
 * - mph = 1 mi/h = 0.447 04 m/s 精确（由 mi 精确值导出）。
 * - kn（节）= 1 nmi/h = 1852/3600 m/s 精确。
 * - c（真空光速）= 299 792 458 m/s 精确：SI 米的定义值。
 * - Mach（马赫）取 ISO 2533:1975《标准大气》海平面（15 °C、101 325 Pa）声速
 *   340.294 m/s。⚠ **随温度/高度变化**，此值仅为标准大气基准，不是普适常数。
 *
 * 【压强 pressure，基准 Pa】
 * - Pa = N/m²（SI 导出单位）。
 * - bar = 10^5 Pa 精确：ISO 80000-4；BIPM SI 手册表 8。
 * - atm（标准大气压）= 101 325 Pa 精确：第 10 届 CGPM（1954）决议 4。
 * - Torr = 1/760 atm = 101325/760 Pa 精确（定义式，非 mmHg 的同义词）。
 * - mmHg（约定毫米汞柱）= 133.322 387 415 Pa：ISO 80000-4 / NIST SP 811 约定值
 *   （按 ρ = 13 595.1 kg/m³、g₀ = 9.806 65 m/s² 定义，与 Torr 差 ~1.5×10^-7）。
 * - psi = lbf/in²，由 lb 精确值与 g₀ = 9.806 65 m/s² 精确值导出
 *   = 6894.757 293 168 3… Pa（本文件用精确分数，不用四舍五入的小数）。
 * - inHg = 25.4 mmHg（由约定 mmHg 导出）。
 *
 * 【力 force，基准 N】
 * - kgf（千克力）= 9.806 65 N 精确：g₀ 由第 3 届 CGPM（1901）规定为精确值。
 * - lbf（磅力）= 0.453 592 37 kg × 9.806 65 m/s² 精确。
 * - dyn（达因）= 10^-5 N（CGS 制定义）。
 *
 * 【功率 power，基准 W】
 * - W = J/s（SI 导出单位）。
 * - PS（公制马力）= 75 kgf·m/s = 735.498 75 W 精确。
 * - hp（英制/机械马力）= 550 ft·lbf/s = 745.699 871 582 270 2… W（精确分数）。
 *   ⚠ PS ≠ hp，差约 1.4%，是「马力」二字最常见的歧义。
 *
 * 【能量 energy，基准 J】
 * - Wh = 3600 J；kWh = 3.6 MJ（定义式）。
 * - cal_th（热化学卡）≡ 4.184 J 精确：NIST SP 811 表 B.8。
 * - cal_IT（国际蒸汽表卡）≡ 4.1868 J 精确：第 5 届国际水蒸气性质会议（1956）。
 *   ⚠ 两种卡不等，食品标注用的是 kcal_th。
 * - Btu_IT = 1055.055 852 62 J 精确：ISO 31-4 / NIST SP 811 表 B.8。
 * - eV = 1.602 176 634 × 10^-19 J 精确：SI 2019 元电荷 e 的定义值。
 * - erg = 10^-7 J（CGS 制定义）。
 * - ft·lbf = 0.3048 m × lbf（由上述精确值导出）。
 *
 * 红线：core 层零 UI 依赖；纯本地零外发；不注册 op。
 */
import {
  rat, ratMul, ratDiv, ratAdd, ratSub, ratToStr, ratToNum, parseRatDecimal,
  DATA_SIZE, DATA_RATE, TIME_UNITS, FREQ_UNITS, ANGLE_UNITS, TS_EPOCHS,
} from "./unitConv.js";

const R1 = rat(1n);
const P = (e) => rat(10n ** BigInt(e)); // 10^e
const N = (e) => rat(1n, 10n ** BigInt(e)); // 10^-e

// ============ 新增九组系数（全部精确有理数，溯源见文件头） ============

// -- 长度（基准 m） --
const LENGTH_UNITS = [
  { u: "km", zh: "千米", k: P(3) },
  { u: "m", zh: "米", k: R1 },
  { u: "dm", zh: "分米", k: N(1) },
  { u: "cm", zh: "厘米", k: N(2) },
  { u: "mm", zh: "毫米", k: N(3) },
  { u: "μm", zh: "微米", k: N(6) },
  { u: "nm", zh: "纳米", k: N(9) },
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

// -- 面积（基准 m²） --
const AREA_UNITS = [
  { u: "km²", zh: "平方千米", k: P(6) },
  { u: "ha", zh: "公顷", k: P(4) },
  { u: "a", zh: "公亩", k: P(2) },
  { u: "m²", zh: "平方米", k: R1 },
  { u: "dm²", zh: "平方分米", k: N(2) },
  { u: "cm²", zh: "平方厘米", k: N(4) },
  { u: "mm²", zh: "平方毫米", k: N(6) },
  { u: "亩", zh: "市亩", k: rat(2000n, 3n) },
  { u: "acre", zh: "英亩", k: rat(316160658n, 78125n) },
  { u: "mi²", zh: "平方英里", k: rat(40468564224n, 15625n) },
  { u: "yd²", zh: "平方码", k: rat(1306449n, 1562500n) },
  { u: "ft²", zh: "平方英尺", k: rat(145161n, 1562500n) },
  { u: "in²", zh: "平方英寸", k: rat(16129n, 25000000n) },
];

// -- 体积（基准 m³） --
const VOLUME_UNITS = [
  { u: "m³", zh: "立方米", k: R1 },
  { u: "L", zh: "升", k: N(3) },
  { u: "dL", zh: "分升", k: N(4) },
  { u: "mL", zh: "毫升", k: N(6) },
  { u: "cm³", zh: "立方厘米", k: N(6) },
  { u: "mm³", zh: "立方毫米", k: N(9) },
  { u: "ft³", zh: "立方英尺", k: rat(55306341n, 1953125000n) },
  { u: "in³", zh: "立方英寸", k: rat(2048383n, 125000000000n) },
  { u: "gal(US)", zh: "美制加仑", k: rat(473176473n, 125000000000n) },
  { u: "gal(UK)", zh: "英制加仑", k: rat(454609n, 10n ** 8n) },
  { u: "qt(US)", zh: "美制夸脱", k: rat(473176473n, 500000000000n) },
  { u: "pt(US)", zh: "美制品脱", k: rat(473176473n, 1000000000000n) },
  { u: "floz(US)", zh: "美制液盎司", k: rat(473176473n, 16000000000000n) },
  { u: "floz(UK)", zh: "英制液盎司", k: rat(454609n, 16000000000n) },
  { u: "bbl", zh: "石油桶", k: rat(9936705933n, 62500000000n) },
];

// -- 质量（基准 kg） --
const MASS_UNITS = [
  { u: "t", zh: "吨", k: P(3) },
  { u: "kg", zh: "千克", k: R1 },
  { u: "g", zh: "克", k: N(3) },
  { u: "mg", zh: "毫克", k: N(6) },
  { u: "μg", zh: "微克", k: N(9) },
  { u: "斤", zh: "市斤", k: rat(1n, 2n) },
  { u: "两", zh: "市两", k: rat(1n, 20n) },
  { u: "钱", zh: "市钱", k: rat(1n, 200n) },
  { u: "lb", zh: "磅", k: rat(45359237n, 10n ** 8n) },
  { u: "oz", zh: "盎司", k: rat(45359237n, 1600000000n) },
  { u: "st", zh: "英石", k: rat(317514659n, 50000000n) },
  { u: "gr", zh: "格令", k: rat(6479891n, 100000000000n) },
  { u: "ct", zh: "克拉", k: rat(2n, 10n ** 4n) },
];

// -- 速度（基准 m/s） --
const SPEED_UNITS = [
  { u: "m/s", zh: "米每秒", k: R1 },
  { u: "km/h", zh: "千米每小时", k: rat(5n, 18n) },
  { u: "mph", zh: "英里每小时", k: rat(44704n, 10n ** 5n) },
  { u: "kn", zh: "节", k: rat(463n, 900n) },
  { u: "ft/s", zh: "英尺每秒", k: rat(3048n, 10n ** 4n) },
  { u: "Mach", zh: "马赫(ISO 标准大气海平面)", k: rat(340294n, 1000n), approx: true },
  { u: "c", zh: "真空光速", k: rat(299792458n) },
];

// -- 压强（基准 Pa） --
const PRESSURE_UNITS = [
  { u: "MPa", zh: "兆帕", k: P(6) },
  { u: "kPa", zh: "千帕", k: P(3) },
  { u: "hPa", zh: "百帕", k: P(2) },
  { u: "Pa", zh: "帕斯卡", k: R1 },
  { u: "bar", zh: "巴", k: P(5) },
  { u: "mbar", zh: "毫巴", k: P(2) },
  { u: "atm", zh: "标准大气压", k: rat(101325n) },
  { u: "Torr", zh: "托", k: rat(101325n, 760n) },
  { u: "mmHg", zh: "毫米汞柱(约定值)", k: rat(133322387415n, 10n ** 9n) },
  { u: "inHg", zh: "英寸汞柱", k: rat(3386388640341n, 10n ** 9n) },
  { u: "psi", zh: "磅力每平方英寸", k: rat(8896443230521n, 1290320000n) },
];

// -- 力（基准 N） --
const FORCE_UNITS = [
  { u: "kN", zh: "千牛", k: P(3) },
  { u: "N", zh: "牛顿", k: R1 },
  { u: "mN", zh: "毫牛", k: N(3) },
  { u: "kgf", zh: "千克力", k: rat(980665n, 10n ** 5n) },
  { u: "lbf", zh: "磅力", k: rat(8896443230521n, 2000000000000n) },
  { u: "dyn", zh: "达因", k: N(5) },
];

// -- 功率（基准 W） --
const POWER_UNITS = [
  { u: "MW", zh: "兆瓦", k: P(6) },
  { u: "kW", zh: "千瓦", k: P(3) },
  { u: "W", zh: "瓦特", k: R1 },
  { u: "mW", zh: "毫瓦", k: N(3) },
  { u: "PS", zh: "公制马力", k: rat(73549875n, 10n ** 5n) },
  { u: "hp", zh: "英制马力", k: rat(37284993579113511n, 50000000000000n) },
];

// -- 能量（基准 J） --
const ENERGY_UNITS = [
  { u: "MJ", zh: "兆焦", k: P(6) },
  { u: "kJ", zh: "千焦", k: P(3) },
  { u: "J", zh: "焦耳", k: R1 },
  { u: "kWh", zh: "千瓦时", k: rat(36n * 10n ** 5n) },
  { u: "Wh", zh: "瓦时", k: rat(3600n) },
  { u: "kcal", zh: "千卡(热化学)", k: rat(4184n) },
  { u: "cal", zh: "卡(热化学)", k: rat(4184n, 1000n) },
  { u: "cal_IT", zh: "卡(国际蒸汽表)", k: rat(41868n, 10000n) },
  { u: "BTU", zh: "英热单位(IT)", k: rat(105505585262n, 10n ** 8n) },
  { u: "ft·lbf", zh: "英尺磅力", k: rat(3389544870828501n, 2500000000000000n) },
  { u: "erg", zh: "尔格", k: N(7) },
  { u: "eV", zh: "电子伏", k: rat(1602176634n, 10n ** 28n) },
];

// -- 温度（基准 K，仿射变换：toBase/fromBase 一对函数） --
// °C：K = °C + 273.15；°F：K = (°F − 32) × 5/9 + 273.15；°R：K = °R × 5/9
const K_OFF = rat(27315n, 100n); // 273.15，精确
const R59 = rat(5n, 9n);
const R95 = rat(9n, 5n);
const TEMP_UNITS = [
  { u: "°C", zh: "摄氏度", toBase: (v) => ratAdd(v, K_OFF), fromBase: (v) => ratSub(v, K_OFF) },
  { u: "K", zh: "开尔文", toBase: (v) => v, fromBase: (v) => v },
  { u: "°F", zh: "华氏度", toBase: (v) => ratAdd(ratMul(ratSub(v, rat(32n)), R59), K_OFF), fromBase: (v) => ratAdd(ratMul(ratSub(v, K_OFF), R95), rat(32n)) },
  { u: "°R", zh: "兰金度", toBase: (v) => ratMul(v, R59), fromBase: (v) => ratMul(v, R95) },
];

// -- 密度（基准 kg/m³；CTF/取证材料识别常用） --
// g/cm³ ≡ 1000 kg/m³（1 g = 10⁻³ kg，1 cm³ = 10⁻⁶ m³）；1 mL = 1 cm³；
// lb/ft³：lb ≡ 0.453 592 37 kg 精确（1959 协定），ft ≡ 0.3048 m 精确 → 精确有理数导出；
// lb/in³ = 1728 × lb/ft³（1 ft³ = 1728 in³）；oz/in³ = lb/in³ ÷ 16。
const DENSITY_UNITS = [
  { u: "t/m³", zh: "吨/立方米", k: P(3) },
  { u: "g/cm³", zh: "克/立方厘米", k: P(3) },
  { u: "g/mL", zh: "克/毫升", k: P(3) },
  { u: "kg/L", zh: "千克/升", k: P(3) },
  { u: "kg/m³", zh: "千克/立方米", k: R1 },
  { u: "g/L", zh: "克/升", k: R1 },
  { u: "lb/ft³", zh: "磅/立方英尺", k: rat(45359237n * 1953125000n, 100000000n * 55306341n) },
  { u: "lb/in³", zh: "磅/立方英寸", k: rat(45359237n * 1953125000n * 1728n, 100000000n * 55306341n) },
  { u: "oz/in³", zh: "盎司/立方英寸", k: rat(45359237n * 1953125000n * 1728n, 100000000n * 55306341n * 16n) },
];

// -- 燃料经济性（基准 L/100km）--
// 逆比例：值 = K / base。US gal = 3.785 411 784 L，UK gal = 4.546 09 L，mi = 1.609 344 km。
// K_US = (gal_L * 100) / mile_km = (3.785411784 * 100) / 1.609344 = 235.214583333… = 112903/480
// K_UK = (4.54609 * 100) / 1.609344 = 282.480936331… = 56826125/201168
const FUEL_UNITS = [
  { u: "L/100km", zh: "升每百公里", k: R1 },
  { u: "mpg(US)", zh: "英里每加仑(美制)", k: rat(112903n, 480n) },
  { u: "mpg(UK)", zh: "英里每加仑(英制)", k: rat(56826125n, 201168n) },
];
const RESISTANCE_UNITS = [
  { u: "GΩ", zh: "吉欧", k: P(9) },
  { u: "MΩ", zh: "兆欧", k: P(6) },
  { u: "kΩ", zh: "千欧", k: P(3) },
  { u: "Ω", zh: "欧姆", k: R1 },
  { u: "mΩ", zh: "毫欧", k: N(3) },
];

// ============ 货币「面额」换算（不是汇率！）============
// 恒烈 2026-08-23 明确：货币这一项要的是「元 / 角 / 分」这种**同一种货币内部主辅币面额**的换算。
// 这跟汇率完全是两回事 —— 面额比例由法律/铸币法定死，是**精确常数**，
// 不需要联网、不会过期，**与零外发红线毫无冲突**。
// ⚠ 因此每种货币各自成一组，**组间绝不互转**（跨币种才需要汇率，本工具不做）。
const CURRENCY_SETS = [
  {
    id: "cur_cny", zh: "人民币", en: "Renminbi (CNY)", base: "元",
    // 《人民币管理条例》（国务院令第 280 号，2000）第二条：单位为元，辅币单位为角、分；
    // 1 元 = 10 角 = 100 分。厘为记账/计息用（如利率「几厘」），无实体货币。
    note: "《人民币管理条例》（国务院令第 280 号，2000）§2：1 元 = 10 角 = 100 分。厘仅用于记账计息，无实体货币。跨币种换算需实时汇率，本工具不做。",
    units: [
      { u: "元", zh: "元（圆）", en: "yuan", k: R1 },
      { u: "角", zh: "角（毛）", en: "jiao", k: rat(1n, 10n) },
      { u: "分", zh: "分", en: "fen", k: rat(1n, 100n) },
      { u: "厘", zh: "厘（仅记账）", en: "li (accounting only)", k: rat(1n, 1000n) },
    ],
  },
  {
    id: "cur_usd", zh: "美元", en: "US dollar (USD)", base: "dollar",
    // Coinage Act of 1792 确立十进制：1 dollar = 10 dimes = 100 cents = 1000 mills；
    // nickel/quarter/half dollar 为现行流通面额（US Mint）。mill 仅记账（如油价 $3.499）。
    note: "美国《1792 年铸币法》确立十进制：1 dollar = 10 dimes = 100 cents = 1000 mills；nickel = 5¢、quarter = 25¢、half = 50¢ 为现行流通面额（US Mint）。mill 仅用于记账（油价的第三位小数）。",
    units: [
      { u: "dollar", zh: "美元", en: "dollar", k: R1 },
      { u: "half", zh: "半美元", en: "half dollar", k: rat(1n, 2n) },
      { u: "quarter", zh: "四分之一美元", en: "quarter", k: rat(1n, 4n) },
      { u: "dime", zh: "一角", en: "dime", k: rat(1n, 10n) },
      { u: "nickel", zh: "五分", en: "nickel", k: rat(1n, 20n) },
      { u: "cent", zh: "美分", en: "cent", k: rat(1n, 100n) },
      { u: "mill", zh: "密尔（仅记账）", en: "mill (accounting only)", k: rat(1n, 1000n) },
    ],
  },
  {
    id: "cur_eur", zh: "欧元", en: "Euro (EUR)", base: "euro",
    note: "欧盟理事会条例 (EC) No 974/98 §2：1 euro = 100 cent（各国称呼不同，比例统一）。",
    units: [
      { u: "euro", zh: "欧元", en: "euro", k: R1 },
      { u: "cent", zh: "欧分", en: "cent", k: rat(1n, 100n) },
    ],
  },
  {
    id: "cur_gbp", zh: "英镑", en: "Pound sterling (GBP)", base: "pound",
    // 1971-02-15 Decimal Day 起 1 £ = 100 new pence；此前为 £sd 制：1 £ = 20 shillings = 240 old pence。
    note: "1971-02-15「十进制日」起 1 £ = 100 新便士（p）。此前为 £sd 旧制：1 £ = 20 先令 = 240 旧便士（1 先令 = 12 旧便士）。旧制两项按史料列出，CTF/古文献常见。",
    units: [
      { u: "pound", zh: "英镑", en: "pound", k: R1 },
      { u: "shilling", zh: "先令（1971 前）", en: "shilling (pre-1971)", k: rat(1n, 20n) },
      { u: "penny", zh: "新便士 p", en: "new penny (p)", k: rat(1n, 100n) },
      { u: "old_penny", zh: "旧便士 d（1971 前）", en: "old penny (d, pre-1971)", k: rat(1n, 240n) },
    ],
  },
  {
    id: "cur_jpy", zh: "日元", en: "Japanese yen (JPY)", base: "円",
    // 1871 年《新貨条例》：1 円 = 100 銭 = 1000 厘；
    // 1953 年《小額通貨の整理及び支払金の端数計算に関する法律》废止銭/厘流通，仅存记账。
    note: "1871 年《新货条例》：1 円 = 100 銭 = 1000 厘。1953 年《小额通货整理及支付金零数计算法》废止銭/厘流通，二者仅存于记账与史料。",
    units: [
      { u: "円", zh: "日元", en: "yen", k: R1 },
      { u: "銭", zh: "钱（1953 废止）", en: "sen (abolished 1953)", k: rat(1n, 100n) },
      { u: "厘", zh: "厘（1953 废止）", en: "rin (abolished 1953)", k: rat(1n, 1000n) },
    ],
  },
  {
    id: "cur_hkd", zh: "港币", en: "Hong Kong dollar (HKD)", base: "元",
    note: "香港金融管理局货币制度：1 元 = 10 毫 = 100 仙（「毫」即 10 cents，「仙」即 cent）。",
    units: [
      { u: "元", zh: "港元", en: "dollar", k: R1 },
      { u: "毫", zh: "毫（10 仙）", en: "hou (10 cents)", k: rat(1n, 10n) },
      { u: "仙", zh: "仙", en: "cent", k: rat(1n, 100n) },
    ],
  },
];

// ============ 分类总表 ============
// 中文名补表：unitConv 的时间/频率/角度三组表只有符号没有中文名，在此补。
// ⚠ 必须声明在 UNIT_CATS **之前**——UNIT_CATS 的初始化器会立即读这三个 const，
//   放到后面就是顶层 TDZ，整个模块直接崩（见记忆 module-top-level-tdz-crash）。
const TIME_ZH = { d: "天", h: "小时", min: "分钟", s: "秒", ms: "毫秒", "μs": "微秒", ns: "纳秒" };
const FREQ_ZH = { GHz: "吉赫", MHz: "兆赫", kHz: "千赫", Hz: "赫兹" };
const ANGLE_ZH = { deg: "度", rad: "弧度", gon: "梯度" };

// kind: "ratio"（纯比例，有理数）| "affine"（仿射，温度）| "float"（含无理因子，角度）
//     | "epoch"（时间戳纪元，走 unitConv 的 TS_EPOCHS）
// 顺序按「CTF/逆向/工程相关 > 日常生活」排（北极星：不做成通用换算大全）。
const UNIT_CATS = [
  { id: "dataSize", zh: "数据量", icon: "memory", kind: "ratio", base: "B", units: DATA_SIZE.map((x) => ({ u: x.u, zh: x.sys === "IEC" ? "IEC 1024 制" : "SI 1000 制", k: x.k })), note: "SI 1000 制与 IEC 1024 制并列——两者不等，是最常被搞混的一组。" },
  { id: "dataRate", zh: "数据速率", icon: "speed", kind: "ratio", base: "bps", units: DATA_RATE.map((x) => ({ u: x.u, zh: x.dim === "byte" ? "字节制" : "比特制", k: x.k })), note: "1 Byte = 8 bit（IEC 80000-13 §3.3）：宽带的 100 Mbps 实际是 12.5 MB/s。" },
  { id: "time", zh: "时间", icon: "schedule", kind: "ratio", base: "s", units: TIME_UNITS.map((x) => ({ u: x.u, zh: TIME_ZH[x.u] || x.u, k: x.k })), note: "s 为 SI 基本单位；min/h/d 为 SI 接受并用的非 SI 单位。" },
  { id: "freq", zh: "频率", icon: "graphic_eq", kind: "ratio", base: "Hz", units: FREQ_UNITS.map((x) => ({ u: x.u, zh: FREQ_ZH[x.u] || x.u, k: x.k })), note: "SI 词头（BIPM SI 第 9 版 §3）。" },
  { id: "length", zh: "长度", icon: "straighten", kind: "ratio", base: "m", units: LENGTH_UNITS, note: "英制单位自 1959 年《国际码磅协定》起为精确值；市制取 1984 年国务院法定计量单位命令。" },
  { id: "area", zh: "面积", icon: "square_foot", kind: "ratio", base: "m²", units: AREA_UNITS, note: "由长度精确值平方导出；市亩 = 1/15 公顷。" },
  { id: "volume", zh: "体积", icon: "water_drop", kind: "ratio", base: "m³", units: VOLUME_UNITS, note: "美制加仑 ≠ 英制加仑（3.785 411 784 L vs 4.546 09 L），液盎司也不等。" },
  { id: "mass", zh: "质量", icon: "scale", kind: "ratio", base: "kg", units: MASS_UNITS, note: "lb ≡ 0.453 592 37 kg 精确；市斤 = 500 g。" },
  { id: "temp", zh: "温度", icon: "device_thermostat", kind: "affine", base: "K", units: TEMP_UNITS, note: "仿射变换（y = ax + b），不是纯比例——「20 °C 的两倍」无物理意义。" },
  { id: "speed", zh: "速度", icon: "rocket_launch", kind: "ratio", base: "m/s", units: SPEED_UNITS, note: "马赫取 ISO 2533:1975 标准大气海平面声速，随温度/高度变化，非普适常数。" },
  { id: "pressure", zh: "压强", icon: "compress", kind: "ratio", base: "Pa", units: PRESSURE_UNITS, note: "Torr 与 mmHg 定义不同（差约 1.5×10⁻⁷），本表分列。" },
  { id: "force", zh: "力", icon: "fitness_center", kind: "ratio", base: "N", units: FORCE_UNITS, note: "g₀ = 9.806 65 m/s² 为精确值（第 3 届 CGPM，1901）。" },
  { id: "power", zh: "功率", icon: "bolt", kind: "ratio", base: "W", units: POWER_UNITS, note: "公制马力 PS ≠ 英制马力 hp，相差约 1.4%。" },
  { id: "energy", zh: "能量", icon: "local_fire_department", kind: "ratio", base: "J", units: ENERGY_UNITS, note: "热化学卡 4.184 J ≠ 国际蒸汽表卡 4.1868 J；食品标注用前者。" },
  { id: "density", zh: "密度", en: "Density", icon: "density_medium", kind: "ratio", base: "kg/m³", units: DENSITY_UNITS, note: "g/cm³ ≡ 1000 kg/m³（水的密度即 1000）；lb/ft³ 由 1959 协定精确导出。" },
  { id: "resistance", zh: "电阻", en: "Resistance", icon: "electrical_services", kind: "ratio", base: "Ω", units: RESISTANCE_UNITS, note: "SI 词头；kΩ/MΩ 逆向电路分析常用。" },
  { id: "fuel", zh: "油耗", en: "Fuel economy", icon: "swap_horiz", kind: "inverse", base: "L/100km", units: FUEL_UNITS, note: "逆比例：L/100km = K / mpg，其中 K 由美制/英制加仑与英里精确导出（NIST SP 811附录C）。" },
  { id: "angle", zh: "角度", icon: "architecture", kind: "float", base: "deg", units: ANGLE_UNITS.map((u) => ({ u, zh: ANGLE_ZH[u] || u })), note: "含 π 无理因子，本组用双精度浮点（17 位有效），其余各组为精确有理数。" },
  { id: "epoch", zh: "时间戳纪元", icon: "history", kind: "epoch", base: "unix_s", units: Object.entries(TS_EPOCHS).map(([id, e]) => ({ u: id, zh: e.label })), note: "Unix 秒/毫秒、Windows FILETIME、Mac Cocoa、Chrome μs 一次全表互转。" },
  // 货币面额：每种货币各自成组，group 标记让 UI 收进「货币」二级菜单，避免一级 chip 栏被撑爆。
  // ⚠ 组间不互转（跨币种需汇率）。
  ...CURRENCY_SETS.map((s) => ({
    id: s.id, zh: s.zh, en: s.en, icon: "currency_exchange", kind: "ratio",
    group: "currency", base: s.base, units: s.units, note: s.note,
  })),
];

// ============ 单位英文名（非中文界面用，避免中文名漏进其他语言）============
// 主标签永远是单位符号本身（m / kg / MiB 国际通用），这里补的是**次要说明名**。
// 市制单位（里/丈/尺/寸/亩/斤/两/钱）符号本身即汉字，英文名给通行罗马化。
const EN_NAMES = {
  length: { km: "kilometre", m: "metre", dm: "decimetre", cm: "centimetre", mm: "millimetre", "μm": "micrometre", nm: "nanometre", in: "inch", ft: "foot", yd: "yard", mi: "mile", nmi: "nautical mile", "里": "li (500 m)", "丈": "zhang", "尺": "chi", "寸": "cun", au: "astronomical unit", ly: "light-year" },
  area: { "km²": "square kilometre", ha: "hectare", a: "are", "m²": "square metre", "dm²": "square decimetre", "cm²": "square centimetre", "mm²": "square millimetre", "亩": "mu (Chinese acre)", acre: "acre", "mi²": "square mile", "yd²": "square yard", "ft²": "square foot", "in²": "square inch" },
  volume: { "m³": "cubic metre", L: "litre", dL: "decilitre", mL: "millilitre", "cm³": "cubic centimetre", "mm³": "cubic millimetre", "ft³": "cubic foot", "in³": "cubic inch", "gal(US)": "US gallon", "gal(UK)": "imperial gallon", "qt(US)": "US quart", "pt(US)": "US pint", "floz(US)": "US fluid ounce", "floz(UK)": "imperial fluid ounce", bbl: "oil barrel" },
  mass: { t: "tonne", kg: "kilogram", g: "gram", mg: "milligram", "μg": "microgram", "斤": "jin (500 g)", "两": "liang", "钱": "qian", lb: "pound", oz: "ounce", st: "stone", gr: "grain", ct: "carat" },
  temp: { "°C": "Celsius", K: "kelvin", "°F": "Fahrenheit", "°R": "Rankine" },
  speed: { "m/s": "metre per second", "km/h": "kilometre per hour", mph: "mile per hour", kn: "knot", "ft/s": "foot per second", Mach: "Mach (ISA sea level)", c: "speed of light" },
  pressure: { MPa: "megapascal", kPa: "kilopascal", hPa: "hectopascal", Pa: "pascal", bar: "bar", mbar: "millibar", atm: "standard atmosphere", Torr: "torr", mmHg: "mmHg (conventional)", inHg: "inch of mercury", psi: "pound per square inch" },
  force: { kN: "kilonewton", N: "newton", mN: "millinewton", kgf: "kilogram-force", lbf: "pound-force", dyn: "dyne" },
  power: { MW: "megawatt", kW: "kilowatt", W: "watt", mW: "milliwatt", PS: "metric horsepower", hp: "mechanical horsepower" },
  energy: { MJ: "megajoule", kJ: "kilojoule", J: "joule", kWh: "kilowatt-hour", Wh: "watt-hour", kcal: "kilocalorie (th)", cal: "calorie (th)", cal_IT: "calorie (IT)", BTU: "British thermal unit (IT)", "ft·lbf": "foot-pound force", erg: "erg", eV: "electronvolt" },
  time: { d: "day", h: "hour", min: "minute", s: "second", ms: "millisecond", "μs": "microsecond", ns: "nanosecond" },
  freq: { GHz: "gigahertz", MHz: "megahertz", kHz: "kilohertz", Hz: "hertz" },
  angle: { deg: "degree", rad: "radian", gon: "gradian" },
  epoch: { unix_s: "Unix seconds", unix_ms: "Unix milliseconds", filetime: "Windows FILETIME", cocoa: "Mac Cocoa seconds", chrome_us: "Chrome microseconds" },
  density: { "t/m³": "tonne per cubic metre", "g/cm³": "gram per cubic centimetre", "g/mL": "gram per millilitre", "kg/L": "kilogram per litre", "kg/m³": "kilogram per cubic metre", "g/L": "gram per litre", "lb/ft³": "pound per cubic foot", "lb/in³": "pound per cubic inch", "oz/in³": "ounce per cubic inch" },
  resistance: { "GΩ": "gigaohm", "MΩ": "megaohm", "kΩ": "kiloohm", "Ω": "ohm", "mΩ": "milliohm" },
  fuel: { "L/100km": "litres per 100 km", "mpg(US)": "miles per US gallon", "mpg(UK)": "miles per imperial gallon" },
  dataSize: { PB: "SI 1000-based", TB: "SI 1000-based", GB: "SI 1000-based", MB: "SI 1000-based", KB: "SI 1000-based", B: "byte", PiB: "IEC 1024-based", TiB: "IEC 1024-based", GiB: "IEC 1024-based", MiB: "IEC 1024-based", KiB: "IEC 1024-based" },
  dataRate: { Gbps: "bit-based", Mbps: "bit-based", Kbps: "bit-based", bps: "bit-based", "MB/s": "byte-based", "KB/s": "byte-based", "B/s": "byte-based" },
};
for (const c of UNIT_CATS) {
  const map = EN_NAMES[c.id] || {};
  // ⚠ 货币组的 en 是写在单位表里的，别被这里覆盖成符号本身（曾把 "yuan" 覆盖成 "元"）
  for (const x of c.units) if (!x.en) x.en = map[x.u] || x.u;
}

// ============ 换算引擎 ============
function getCat(catId) {
  return UNIT_CATS.find((c) => c.id === catId) || null;
}

// 角度：以 deg 为基准的双精度因子（π 无理，无法用有理数表达）
function angleToDeg(v, u) {
  if (u === "deg") return v;
  if (u === "rad") return (v * 180) / Math.PI;
  return v * 0.9; // gon：400 gon = 360°
}
function degToAngle(deg, u) {
  if (u === "deg") return deg;
  if (u === "rad") return (deg * Math.PI) / 180;
  return deg / 0.9;
}

/**
 * 把一个「某分类某单位下的量」换算到该分类全部单位。
 * @param {string} catId 分类 id
 * @param {{n:bigint,d:bigint}} qty 有理数量值（角度组会转 Number 使用）
 * @param {string} fromUnit 输入单位符号
 * @returns {Array<{u:string, zh:string, text:string, from:boolean, approx?:boolean}>}
 */
function convertAll(catId, qty, fromUnit) {
  const cat = getCat(catId);
  if (!cat) throw new Error(`未知换算分类：${catId}`);
  const src = cat.units.find((x) => x.u === fromUnit);
  if (!src) throw new Error(`分类「${cat.zh}」中没有单位 '${fromUnit}'`);

  if (cat.kind === "float") {
    const num = ratToNum(qty);
    const deg = angleToDeg(num, fromUnit);
    return cat.units.map((x) => ({
      u: x.u, zh: x.zh, from: x.u === fromUnit,
      text: fmtFloat(x.u === fromUnit ? num : degToAngle(deg, x.u)),
    }));
  }
  if (cat.kind === "affine") {
    const base = src.toBase(qty);
    return cat.units.map((x) => ({
      u: x.u, zh: x.zh, from: x.u === fromUnit, text: ratToStr(x.fromBase(base)),
    }));
  }
  if (cat.kind === "epoch") {
    const sec = TS_EPOCHS[fromUnit].toSec(qty);
    return cat.units.map((x) => ({
      u: x.u, zh: x.zh, from: x.u === fromUnit, text: ratToStr(secToEpoch(sec, x.u)),
    }));
  }
  if (cat.kind === "inverse") {
    // 逆比例：value = K / base。基准单位本身 k=1（身份映射）。
    // 边界：0 L/100km 或 0 mpg 物理上无意义（无穷大），输出 "∞" 不崩。
    const isBase = (u) => u === cat.base;
    let base; // 有理数；∞ 用 null 表示
    if (isBase(src.u)) base = qty;
    else if (qty.n === 0n) base = null; // K / 0 = ∞
    else base = ratDiv(src.k, qty);
    return cat.units.map((x) => {
      let text;
      if (isBase(x.u)) {
        text = base === null ? "∞" : ratToStr(base);
      } else if (base === null) {
        text = "0"; // K / ∞ = 0
      } else if (base.n === 0n) {
        text = "∞"; // K / 0 = ∞
      } else {
        text = ratToStr(ratDiv(x.k, base));
      }
      return { u: x.u, zh: x.zh, from: x.u === fromUnit, text };
    });
  }
  // ratio：值 → 基准 → 各单位
  const base = ratMul(qty, src.k);
  return cat.units.map((x) => ({
    u: x.u, zh: x.zh, from: x.u === fromUnit, approx: x.approx || src.approx || false,
    text: ratToStr(ratDiv(base, x.k)),
  }));
}

// Unix 秒 → 各纪元（TS_EPOCHS 只给了 toSec，这里是其逆）
const FT_OFF_R = rat(11644473600n);
const COCOA_OFF_R = rat(978307200n);
function secToEpoch(sec, key) {
  if (key === "unix_s") return sec;
  if (key === "unix_ms") return ratMul(sec, rat(1000n));
  if (key === "filetime") return ratMul(ratAdd(sec, FT_OFF_R), rat(10n ** 7n));
  if (key === "cocoa") return ratSub(sec, COCOA_OFF_R);
  if (key === "chrome_us") return ratMul(ratAdd(sec, FT_OFF_R), rat(10n ** 6n));
  throw new Error(`未知纪元：${key}`);
}

// 浮点展示：17 位有效，去尾零（角度组专用）
function fmtFloat(v) {
  if (!isFinite(v)) return String(v);
  if (v === 0) return "0";
  const s = Math.abs(v) < 1e-6 || Math.abs(v) >= 1e15 ? v.toPrecision(15) : String(Number(v.toPrecision(15)));
  return s;
}

/** 解析用户在单位框里输入的十进制串 → 有理数；空/非法返回 null（UI 不该因半成品输入报错）。 */
function parseQty(s) {
  const str = String(s ?? "").trim().replace(/[\s_,]+/g, "");
  if (!str || str === "-" || str === "+" || str === "." || /\.$/.test(str)) return null;
  try {
    return parseRatDecimal(str);
  } catch {
    return null;
  }
}

// ============ 载入自校验（不符即抛错，暴露在控制台，绝不静默） ============
(() => {
  const must = (cond, msg) => {
    if (!cond) throw new Error("unitTables 自检失败：" + msg);
  };
  const get = (catId, qty, from, want) => {
    const r = convertAll(catId, parseQty(qty), from).find((x) => x.u === want);
    return r ? r.text : "(缺)";
  };
  // 分类完整性：id 唯一、单位符号组内唯一、基准单位存在
  const ids = UNIT_CATS.map((c) => c.id);
  must(new Set(ids).size === ids.length, "分类 id 有重复");
  for (const c of UNIT_CATS) {
    const us = c.units.map((x) => x.u);
    must(new Set(us).size === us.length, `分类 ${c.id} 内单位符号重复`);
    must(us.includes(c.base), `分类 ${c.id} 的基准单位 ${c.base} 不在单位表里`);
    for (const x of c.units) must(x.zh, `分类 ${c.id} 的单位 ${x.u} 缺中文名`);
    for (const x of c.units) must(x.en && x.en !== x.u || /^[A-Za-z]/.test(x.u), `分类 ${c.id} 的单位 ${x.u} 缺英文名（非中文界面会漏中文）`);
  }
  // 长度：1 mi = 1609.344 m（1959 协定精确值）；1 in = 2.54 cm；1 nmi = 1852 m
  must(get("length", "1", "mi", "m") === "1609.344", `1 mi 应 = 1609.344 m，实得 ${get("length", "1", "mi", "m")}`);
  must(get("length", "1", "in", "cm") === "2.54", "1 in 应 = 2.54 cm");
  must(get("length", "1", "nmi", "m") === "1852", "1 nmi 应 = 1852 m");
  must(get("length", "1", "尺", "cm") === "33.333333333333…", `1 市尺 应 = 33.3333…cm，实得 ${get("length", "1", "尺", "cm")}`);
  must(get("length", "1", "ly", "m") === "9460730472580800", "1 ly 应 = 9460730472580800 m（IAU 精确）");
  // 面积：1 acre = 4046.8564224 m²；1 亩 = 666.666…m²
  must(get("area", "1", "acre", "m²") === "4046.8564224", `1 acre 应 = 4046.8564224 m²，实得 ${get("area", "1", "acre", "m²")}`);
  must(get("area", "1", "ha", "m²") === "10000", "1 ha 应 = 10000 m²");
  must(get("area", "15", "亩", "ha") === "1", "15 市亩 应 = 1 公顷");
  // 体积：1 US gal = 3.785411784 L；1 UK gal = 4.54609 L（两者不等）
  must(get("volume", "1", "gal(US)", "L") === "3.785411784", `1 US gal 应 = 3.785411784 L，实得 ${get("volume", "1", "gal(US)", "L")}`);
  must(get("volume", "1", "gal(UK)", "L") === "4.54609", "1 UK gal 应 = 4.54609 L");
  must(get("volume", "1", "bbl", "L") === "158.987294928", "1 bbl 应 = 158.987294928 L");
  must(get("volume", "1", "L", "cm³") === "1000", "1 L 应 = 1000 cm³");
  // 质量：1 lb = 0.45359237 kg；1 oz = 28.349523125 g；1 斤 = 500 g
  must(get("mass", "1", "lb", "kg") === "0.45359237", "1 lb 应 = 0.45359237 kg");
  must(get("mass", "1", "oz", "g") === "28.349523125", `1 oz 应 = 28.349523125 g，实得 ${get("mass", "1", "oz", "g")}`);
  must(get("mass", "1", "斤", "g") === "500", "1 市斤 应 = 500 g");
  must(get("mass", "1", "ct", "mg") === "200", "1 ct 应 = 200 mg");
  // 温度（仿射的四个关键点，手算对拍）
  must(get("temp", "0", "°C", "K") === "273.15", "0 °C 应 = 273.15 K");
  must(get("temp", "0", "°C", "°F") === "32", "0 °C 应 = 32 °F");
  must(get("temp", "100", "°C", "°F") === "212", "100 °C 应 = 212 °F");
  must(get("temp", "-40", "°C", "°F") === "-40", "-40 °C 应 = -40 °F（两标度交点）");
  must(get("temp", "0", "K", "°R") === "0", "0 K 应 = 0 °R");
  must(get("temp", "0", "K", "°C") === "-273.15", "0 K 应 = -273.15 °C");
  must(get("temp", "98.6", "°F", "°C") === "37", `98.6 °F 应 = 37 °C，实得 ${get("temp", "98.6", "°F", "°C")}`);
  // 速度：100 km/h = 27.777…m/s；1 kn = 1.852 km/h；1 c = 299792458 m/s
  must(get("speed", "100", "km/h", "m/s") === "27.777777777777…", `100 km/h 实得 ${get("speed", "100", "km/h", "m/s")}`);
  must(get("speed", "1", "kn", "km/h") === "1.852", "1 kn 应 = 1.852 km/h");
  must(get("speed", "1", "c", "m/s") === "299792458", "1 c 应 = 299792458 m/s");
  must(get("speed", "1", "mph", "m/s") === "0.44704", "1 mph 应 = 0.44704 m/s");
  // 压强：1 atm = 101325 Pa = 1013.25 hPa = 760 Torr
  must(get("pressure", "1", "atm", "Pa") === "101325", "1 atm 应 = 101325 Pa");
  must(get("pressure", "1", "atm", "hPa") === "1013.25", "1 atm 应 = 1013.25 hPa");
  must(get("pressure", "1", "atm", "Torr") === "760", "1 atm 应 = 760 Torr");
  must(get("pressure", "1", "bar", "Pa") === "100000", "1 bar 应 = 100000 Pa");
  must(/^6894\.757293168/.test(get("pressure", "1", "psi", "Pa")), `1 psi 应 ≈ 6894.757293168 Pa，实得 ${get("pressure", "1", "psi", "Pa")}`);
  // 力：1 kgf = 9.80665 N
  must(get("force", "1", "kgf", "N") === "9.80665", "1 kgf 应 = 9.80665 N");
  // 1 lbf = 4.4482216152605 N（13 位小数，超过 ratToStr 的 12 位截断口径，故按前缀匹配）
  must(/^4\.44822161526/.test(get("force", "1", "lbf", "N")), `1 lbf 应 ≈ 4.4482216152605 N，实得 ${get("force", "1", "lbf", "N")}`);
  // 功率：1 PS = 735.49875 W；1 hp = 745.699871582270…W
  must(get("power", "1", "PS", "W") === "735.49875", "1 PS 应 = 735.49875 W");
  must(/^745\.69987158227/.test(get("power", "1", "hp", "W")), `1 hp 应 ≈ 745.6998715822702 W，实得 ${get("power", "1", "hp", "W")}`);
  // 能量：1 kWh = 3600000 J；1 kcal = 4184 J；1 BTU = 1055.05585262 J
  must(get("energy", "1", "kWh", "J") === "3600000", "1 kWh 应 = 3600000 J");
  must(get("energy", "1", "kcal", "J") === "4184", "1 kcal 应 = 4184 J");
  must(get("energy", "1", "BTU", "J") === "1055.05585262", "1 BTU 应 = 1055.05585262 J");
  // eV 走 ratToStr 的科学计数法分支（|值|<10^-6），13 位有效 → "1.602176634000e-19"
  must(/^1\.6021766340*e-19$/.test(get("energy", "1", "eV", "J")), `1 eV 应 = 1.602176634e-19 J，实得 ${get("energy", "1", "eV", "J")}`);
  // 数据量 / 速率（与 unitConv op 同源，此处验「复用没接错」）
  must(get("dataSize", "1", "GB", "MiB") === "953.67431640625", `1 GB 应 = 953.67431640625 MiB，实得 ${get("dataSize", "1", "GB", "MiB")}`);
  must(get("dataSize", "1", "GiB", "B") === "1073741824", "1 GiB 应 = 1073741824 B");
  must(get("dataRate", "100", "Mbps", "MB/s") === "12.5", "100 Mbps 应 = 12.5 MB/s");
  must(get("time", "1", "h", "s") === "3600", "1 h 应 = 3600 s");
  must(get("freq", "1", "GHz", "Hz") === "1000000000", "1 GHz 应 = 10^9 Hz");
  // 角度（浮点组）
  must(/^1\.5707963267949/.test(get("angle", "90", "deg", "rad")), `90 deg 应 ≈ 1.5707963267949 rad，实得 ${get("angle", "90", "deg", "rad")}`);
  must(get("angle", "90", "deg", "gon") === "100", "90 deg 应 = 100 gon");
  // 油耗（逆比例引擎）：K 精确值对拍
  must(get("fuel", "1", "mpg(US)", "L/100km") === "235.214583333333…", `1 mpg(US) 应 = 235.2145833… L/100km，实得 ${get("fuel", "1", "mpg(US)", "L/100km")}`);
  must(get("fuel", "1", "mpg(UK)", "L/100km") === "282.480936331822…", `1 mpg(UK) 应 = 282.4809363… L/100km，实得 ${get("fuel", "1", "mpg(UK)", "L/100km")}`);
  must(get("fuel", "20", "mpg(US)", "L/100km") === "11.760729166666…", `20 mpg(US) 应 ≈ 11.7607291… L/100km，实得 ${get("fuel", "20", "mpg(US)", "L/100km")}`);
  must(get("fuel", "1", "L/100km", "mpg(US)") === "235.214583333333…", `1 L/100km 应 = 235.2… mpg(US)，实得 ${get("fuel", "1", "L/100km", "mpg(US)")}`);
  must(get("fuel", "7", "mpg(US)", "mpg(US)") === "7", "7 mpg(US) 往返应 7（inverse 自反）");
  must(get("fuel", "7", "L/100km", "L/100km") === "7", "7 L/100km 往返应 7");
  must(get("fuel", "1", "mpg(US)", "mpg(UK)") === "1.200949925504…", "1 mpg(US) 应 = K_UK/K_US mpg(UK)");
  must(get("fuel", "0", "mpg(US)", "L/100km") === "∞", "0 mpg → L/100km 应 ∞");
  must(get("fuel", "0", "L/100km", "mpg(US)") === "∞", "0 L/100km → mpg 应 ∞");
  // 时间戳纪元（与 unitConv op 的对拍值一致）
  must(get("epoch", "1655526400", "unix_s", "filetime") === "133000000000000000", `unix 1655526400 → FILETIME 应 133000000000000000，实得 ${get("epoch", "1655526400", "unix_s", "filetime")}`);
  must(get("epoch", "133000000000000000", "filetime", "unix_s") === "1655526400", "FILETIME 回环应得 1655526400");
  must(get("epoch", "1655526400", "unix_s", "cocoa") === "677219200", "unix → cocoa 应 677219200");
  must(get("epoch", "1655526400", "unix_s", "chrome_us") === "13300000000000000", "unix → chrome μs 应 13300000000000000");
  // 货币面额（法定比例，精确常数；⚠ 这是「元角分」不是汇率）
  must(get("cur_cny", "1", "元", "角") === "10", "1 元 应 = 10 角");
  must(get("cur_cny", "1", "元", "分") === "100", "1 元 应 = 100 分");
  must(get("cur_cny", "12.34", "元", "分") === "1234", `12.34 元 应 = 1234 分，实得 ${get("cur_cny", "12.34", "元", "分")}`);
  must(get("cur_cny", "5", "角", "元") === "0.5", "5 角 应 = 0.5 元");
  must(get("cur_usd", "1", "dollar", "cent") === "100", "1 dollar 应 = 100 cent");
  must(get("cur_usd", "1", "dollar", "quarter") === "4", "1 dollar 应 = 4 quarter");
  must(get("cur_usd", "1", "quarter", "cent") === "25", "1 quarter 应 = 25 cent");
  must(get("cur_usd", "1", "nickel", "cent") === "5", "1 nickel 应 = 5 cent");
  must(get("cur_eur", "1", "euro", "cent") === "100", "1 euro 应 = 100 cent");
  must(get("cur_gbp", "1", "pound", "penny") === "100", "1 £ 应 = 100 新便士");
  must(get("cur_gbp", "1", "pound", "shilling") === "20", "1 £ 应 = 20 先令（1971 前）");
  must(get("cur_gbp", "1", "shilling", "old_penny") === "12", "1 先令 应 = 12 旧便士");
  must(get("cur_gbp", "1", "pound", "old_penny") === "240", "1 £ 应 = 240 旧便士");
  must(get("cur_jpy", "1", "円", "銭") === "100", "1 円 应 = 100 銭");
  must(get("cur_jpy", "1", "円", "厘") === "1000", "1 円 应 = 1000 厘");
  must(get("cur_hkd", "1", "元", "毫") === "10", "1 港元 应 = 10 毫");
  must(get("cur_hkd", "1", "元", "仙") === "100", "1 港元 应 = 100 仙");
  // 货币组必须彼此隔离：人民币的「元」不能在港币组里被找到当同一单位
  {
    let isolated = false;
    try { convertAll("cur_cny", parseQty("1"), "cent"); } catch { isolated = true; }
    must(isolated, "跨币种单位不应互认（cur_cny 里不该有 cent）");
  }
  // 往返自反：每个分类每个单位 → 基准 → 自身，必须原样回来（catch 抄错系数的方向）
  for (const c of UNIT_CATS) {
    for (const x of c.units) {
      const r = convertAll(c.id, parseQty("7"), x.u).find((y) => y.u === x.u);
      must(r && (c.kind === "float" ? Math.abs(parseFloat(r.text) - 7) < 1e-12 : r.text === "7"),
        `${c.id}/${x.u} 自反往返失败，实得 ${r ? r.text : "(缺)"}`);
    }
  }
  // parseQty 半成品输入不抛错（UI 边打字边转的前提）
  for (const bad of ["", "-", "+", ".", "1.", "abc", "1e5", null, undefined]) {
    must(parseQty(bad) === null, `parseQty(${JSON.stringify(bad)}) 应返回 null 而非抛错/有值`);
  }
  must(parseQty("1,024").n === 1024n, "parseQty 应吃掉千分位逗号");
  must(parseQty(" 1.5 ").n === 3n, "parseQty 应 trim 且 1.5 → 3/2");
})();

export { UNIT_CATS, getCat, convertAll, parseQty, fmtFloat, secToEpoch };
