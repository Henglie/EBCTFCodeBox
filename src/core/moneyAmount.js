/*
 * moneyAmount.js — 人民币大写金额（数字 → 中文大写）。
 *
 * 定位：纯函数，不注册 op，无 UI 依赖，纯本地零外发。供 ui/quickConv.js「金额」面板调用。
 *
 * 用途：CTF 票据/合同金额取证、财务单据核对。
 *
 * 规则依据（《会计基础工作规范》第五十二条 / 《支付结算办法》附一）：
 * - 中文大写数字：零壹贰叁肆伍陆柒捌玖；单位：元 / 拾佰仟 / 万 / 亿。
 * - 数字中间有 0：写一个「零」；连续多个 0：只写一个「零」。
 * - 万位 / 亿位是 0 但其低位非 0 时，可写一个「零」（本实现始终写，便于对账）。
 * - 金额到「元」为止写「整」；到「角」为止可写「整」（本实现写，便于结算）；
 *   有「分」不写「整」。
 * - 角位为 0、分位非 0：元与分之间写「零」（如 1.05 → 壹元零伍分）。
 * - 纯小数：整数部分 0 写作「零元」接角分（如 0.05 → 零元零伍分）。
 * - 分以下（第三位小数）：四舍五入到分（与财务记账惯例一致）。
 * - 负数：前缀「负」（如 -12.50 → 负壹拾贰元伍角整）。
 *
 * 边界（按任务卡 T367 要求显式覆盖）：
 * - 0            → 「零元整」
 * - 0.05（纯小数）→ 「零元零伍分」
 * - 12.00（整数元）→ 「壹拾贰元整」
 * - 1.05（角位 0 分位非 0）→ 「壹元零伍分」
 * - 100000000.01 → 「壹亿元零壹分」
 * - 非法输入（空串/半成品/非数字）→ 返回 null，调用方静默等待，不抛错。
 */
const CN = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const U4 = ["", "拾", "佰", "仟"];
// 四位一节的大单位：万/亿/万亿 之后是 京/垓/秭/穰/沟/涧/正/载（各 +4 位）。
// ⚠ G4 下标 = 分组数-1-g；分组数可达 10^16 以上（超万亿），下标必须覆盖，否则越界出 undefined。
const G4 = ["", "万", "亿", "万亿", "京", "垓", "秭", "穰", "沟", "涧", "正", "载"];

/** 解析输入为 { neg, int, frac }；非法返回 null（半成品静默等待）。 */
function parseAmount(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/[\s_,]+/g, "");
  if (!s) return null;
  let neg = false;
  if (s[0] === "-") { neg = true; s = s.slice(1); }
  else if (s[0] === "+") s = s.slice(1);
  if (!s || s === ".") return null;
  if (!/^\d+(\.\d*)?$/.test(s)) return null;
  const [i = "", f = ""] = s.split(".");
  if (i === "" && f === "") return null;
  const int = i === "" ? "0" : i;
  return { neg, int: int.replace(/^0+(?=\d)/, ""), frac: f };
}

/**
 * 整数部分 → 中文大写（四位一节）。
 * 零规则：组内数字中间的 0 写一个「零」；组间「高位组非零且本组 <1000，
 * 或上组整组为 0」时在本组前补「零」（覆盖 10010→壹万零壹拾、1 0000 0001→壹亿零壹）。
 * int 为非负整数字符串（可含前导零）。
 */
function intToCn(intStr) {
  if (intStr === "0") return "零";
  // 从右往左按四位分组
  const groups = [];
  for (let i = intStr.length; i > 0; i -= 4) groups.unshift(intStr.slice(Math.max(0, i - 4), i));
  const n = groups.length;
  let out = "";
  let needZero = false; // 高一组整组为 0（需要在本组前补零）
  for (let g = 0; g < n; g++) {
    const part = groups[g];
    const val = parseInt(part, 10);
    if (val === 0) { needZero = true; continue; } // 整组为零：只留零标记
    let s = "";
    let zero = false;
    // 组内四位：千/百/十/个，数字中间 0 → 单零（前导 0 不产出，交给组前补零）
    for (let i = 0; i < part.length; i++) {
      const d = part.charCodeAt(i) - 48;
      const pos = part.length - 1 - i;
      if (d === 0) {
        if (s) zero = true;
      } else {
        if (zero) s += "零";
        zero = false;
        s += CN[d] + U4[pos];
      }
    }
    // 组前补零：已有高位组，且（上组整组为 0 或本组 <1000 未占满千位）
    if (out && (needZero || val < 1000)) s = "零" + s;
    needZero = false;
    out += s + G4[n - 1 - g];
  }
  return out || "零";
}

/**
 * 人民币大写：数字 → 大写金额字符串。
 * @param {string|number} input 金额（支持整数/小数/负号/千分位逗号/空格）
 * @returns {string|null} 大写金额；非法输入返回 null（UI 半成品静默）
 */
export function moneyToCn(input) {
  const p = parseAmount(input);
  if (!p) return null;

  // 分以下四舍五入：取前两位小数，看第三位
  let frac = (p.frac || "").padEnd(2, "0").slice(0, 2);
  const third = (p.frac || "").charAt(2);
  let intStr = p.int;
  if (third !== "" && third >= "5") {
    let f = parseInt(frac, 10) + 1;
    if (f >= 100) { f -= 100; intStr = (BigInt(intStr || "0") + 1n).toString(); }
    frac = String(f).padStart(2, "0");
  }

  let out = (p.neg ? "负" : "") + intToCn(intStr) + "元";
  const jiao = frac[0], fen = frac[1];
  if (jiao === "0" && fen === "0") {
    out += "整";
  } else if (jiao === "0") {
    out += "零" + CN[fen] + "分"; // 角位 0 分位非 0：元分之间补零
  } else if (fen === "0") {
    out += CN[jiao] + "角整";
  } else {
    out += CN[jiao] + "角" + CN[fen] + "分";
  }
  return out;
}

/** 自检：返回断言数，失败即抛错（与 unitTables.js 同风格，node -e 直跑）。 */
export function selfTest() {
  const cases = [
    ["0", "零元整"],
    ["0.00", "零元整"],
    ["0.5", "零元伍角整"],
    ["0.05", "零元零伍分"],
    ["1", "壹元整"],
    ["12", "壹拾贰元整"],
    ["12.00", "壹拾贰元整"],
    ["100", "壹佰元整"],
    ["1001", "壹仟零壹元整"],
    ["1010", "壹仟零壹拾元整"],
    ["10010", "壹万零壹拾元整"],
    ["100000", "壹拾万元整"],
    ["100000000", "壹亿元整"],
    ["100100000", "壹亿零壹拾万元整"],
    ["100000001", "壹亿零壹元整"],
    ["100000000.01", "壹亿元零壹分"],
    ["1234.56", "壹仟贰佰叁拾肆元伍角陆分"],
    ["1.05", "壹元零伍分"],
    ["1.50", "壹元伍角整"],
    ["1.004", "壹元整"],
    ["1.005", "壹元零壹分"], // 分以下四舍五入
    ["0.555", "零元伍角陆分"],
    ["999.995", "壹仟元整"], // 进位跨整数
    ["-12.50", "负壹拾贰元伍角整"],
    ["1,234.56", "壹仟贰佰叁拾肆元伍角陆分"],
  ];
  for (const [input, want] of cases) {
    const got = moneyToCn(input);
    if (got !== want) throw new Error(`moneyToCn(${JSON.stringify(input)}) 应 ${want}，实得 ${got}`);
  }
  // 超大值回归（G4 越界 P1 bug 修复验证）
  const bigCases = [
    ["10000000000000000", "壹京元整"],
    ["100000000000000000", "壹拾京元整"],
    ["1000000000000000000", "壹佰京元整"],
    ["10000000000000000000", "壹仟京元整"],
    ["100000000000000000000", "壹垓元整"],
  ];
  for (const [input, want] of bigCases) {
    const got = moneyToCn(input);
    if (got !== want) throw new Error(`moneyToCn(${JSON.stringify(input)}) 应 ${want}，实得 ${got}`);
  }
  for (const bad of ["", "  ", ".", "-", "+", "abc", "1e5", "1.2.3", "12-3", null, undefined]) {
    if (moneyToCn(bad) !== null) throw new Error(`moneyToCn(${JSON.stringify(bad)}) 应返回 null（半成品静默）`);
  }
  return cases.length;
}
