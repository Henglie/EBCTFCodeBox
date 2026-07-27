/*
 * checkdigit.js — 条码 / 校验位组（T51，cat:'radix'）。
 *
 * 覆盖：
 * - Luhn 校验（信用卡/IMEI，ISO/IEC 7812）
 * - ISBN-10 / ISBN-13 校验（模 11 / 模 10）
 * - EAN-13 校验（模 10，与 ISBN-13 同算法）
 * - 中国身份证 18 位校验位（GB 11643-1999）
 * - UPC-A 校验（模 10）
 * - 银行卡 BIN 识别（前 6 位查表，单向 run）
 *
 * 双向约定：
 * encode(主体) = 计算并返回校验位（1 字符）
 * decode(完整号) = 校验合法性，返回 "合法" 或 "非法：校验位应为 X"
 *
 * 红线：
 * - 身份证仅算校验位，不生成真实号（隐私红线，测试样例用全 0 主体）。
 * - 纯算法，无外部依赖。编码表/权重照抄国标，不编造。
 */
import { register } from "./registry.js";

// ============ 通用：清洗输入（去空格/连字符/点；保留数字与 ISBN-10 末尾 X） ============
function cleanNum(s) {
  return String(s).replace(/[\s\-./]/g, "").toUpperCase();
}
// 仅数字
function cleanDigits(s) {
  return String(s).replace(/\D/g, "");
}
function isDigits(s) {
  return /^\d+$/.test(s);
}

// ============ 1. Luhn（ISO/IEC 7812） ============
// 计算使整体（含校验位）Luhn 和 ≡ 0 (mod 10) 的校验位
function luhnCheckDigit(body) {
 // body 不含校验位。补 0 当校验位算和，校验位 = (10 - sum%10)%10
  const digits = body.split("").map(Number);
  digits.push(0); // 占位校验位
  let sum = 0, dbl = false; // 从右起，校验位是第 1 位（不×2），第 2 位×2...
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits[i];
    if (dbl) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    dbl = !dbl;
  }
  return (10 - (sum % 10)) % 10;
}
// 校验完整号（含校验位）Luhn 合法性
function luhnValid(full) {
  return luhnCheckDigit(full.slice(0, -1)) === Number(full.slice(-1));
}

// ============ 2. ISBN-10（模 11） ============
// d1×10 + d2×9 + ... + d10×1 ≡ 0 (mod 11)，d10 可能是 X(=10)
function isbn10CheckDigit(body9) {
  if (body9.length !== 9 || !isDigits(body9)) throw new Error("ISBN-10 主体须 9 位数字");
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(body9[i]) * (10 - i);
  const r = (11 - (sum % 11)) % 11;
  return r === 10 ? "X" : String(r);
}
function isbn10Valid(full10) {
 // 末位 X 视为 10
  const last = full10.slice(-1);
  const body = full10.slice(0, -1);
  const expected = isbn10CheckDigit(body);
  return expected === last.toUpperCase();
}

// ============ 3. ISBN-13 / EAN-13（模 10，奇位×1 偶位×3） ============
function ean13CheckDigit(body12) {
  if (body12.length !== 12 || !isDigits(body12)) throw new Error("EAN-13/ISBN-13 主体须 12 位数字");
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(body12[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}
function ean13Valid(full13) {
  return ean13CheckDigit(full13.slice(0, -1)) === full13.slice(-1);
}

// ============ 4. 身份证 18 位校验位（GB 11643-1999） ============
const CNID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const CNID_CHECK_MAP = ["1", "0", "X", "9", "8", "7", "6", "5", "4", "3", "2"];
function cnidCheckDigit(body17) {
  if (body17.length !== 17 || !isDigits(body17)) throw new Error("身份证主体须 17 位数字");
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(body17[i]) * CNID_WEIGHTS[i];
  return CNID_CHECK_MAP[sum % 11];
}
function cnidValid(full18) {
  if (full18.length !== 18) return false;
  const last = full18.slice(-1).toUpperCase();
  return cnidCheckDigit(full18.slice(0, -1)) === last;
}

// ============ 5. UPC-A（模 10，奇位×3 偶位×1） ============
function upcCheckDigit(body11) {
  if (body11.length !== 11 || !isDigits(body11)) throw new Error("UPC-A 主体须 11 位数字");
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum += Number(body11[i]) * (i % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}
function upcValid(full12) {
  return upcCheckDigit(full12.slice(0, -1)) === full12.slice(-1);
}

// ============ 6. 银行卡 BIN 识别（前 6 位查表，单向） ============
// 常见 BIN 前缀表（简化版，覆盖主流卡组织与国内大行）
const BIN_TABLE = [
  { prefix: "4", len: 1, brand: "Visa", issuer: "Visa 国际" },
  { prefix: "51", len: 2, brand: "MasterCard", issuer: "MasterCard 国际" },
  { prefix: "52", len: 2, brand: "MasterCard", issuer: "MasterCard 国际" },
  { prefix: "53", len: 2, brand: "MasterCard", issuer: "MasterCard 国际" },
  { prefix: "54", len: 2, brand: "MasterCard", issuer: "MasterCard 国际" },
  { prefix: "55", len: 2, brand: "MasterCard", issuer: "MasterCard 国际" },
  { prefix: "34", len: 2, brand: "American Express", issuer: "美国运通" },
  { prefix: "37", len: 2, brand: "American Express", issuer: "美国运通" },
  { prefix: "6011", len: 4, brand: "Discover", issuer: "Discover" },
  { prefix: "65", len: 2, brand: "Discover", issuer: "Discover" },
  { prefix: "3528", len: 4, brand: "JCB", issuer: "JCB 国际" },
  { prefix: "3589", len: 4, brand: "JCB", issuer: "JCB 国际" },
  { prefix: "36", len: 2, brand: "Diners Club", issuer: "大莱卡" },
  { prefix: "62", len: 2, brand: "China UnionPay", issuer: "中国银联" },
 // 国内主流银行（622126 开头多为工行/农行等，简化用前 6 位）
  { prefix: "621700", len: 6, brand: "China UnionPay", issuer: "中国建设银行" },
  { prefix: "622202", len: 6, brand: "China UnionPay", issuer: "中国工商银行" },
  { prefix: "621662", len: 6, brand: "China UnionPay", issuer: "中国银行" },
  { prefix: "622848", len: 6, brand: "China UnionPay", issuer: "中国农业银行" },
  { prefix: "622588", len: 6, brand: "China UnionPay", issuer: "招商银行" },
  { prefix: "621283", len: 6, brand: "China UnionPay", issuer: "中国邮政储蓄银行" },
  { prefix: "622150", len: 6, brand: "China UnionPay", issuer: "中国银行" },
];
function binLookup(cardNum) {
  const num = cleanDigits(cardNum);
  if (num.length < 4) throw new Error("卡号过短，至少 4 位");
 // 最长前缀优先匹配
  const sorted = BIN_TABLE.slice().sort((a, b) => b.len - a.len);
  for (const e of sorted) {
    if (num.startsWith(e.prefix)) return e;
  }
  return { prefix: num.slice(0, 6), brand: "未知", issuer: "未知" };
}

// ============ 注册 ============
// 1. Luhn（信用卡/IMEI 通用）
register({
  id: "luhn", cat: "radix", name: "Luhn 校验位",
  desc: "Luhn 校验（信用卡/IMEI，ISO/IEC 7812）。encode=算校验位，decode=校验合法性",
  params: [],
  encode: (t) => {
    const s = cleanDigits(t);
    if (s.length < 1) throw new Error("Luhn: 输入过短");
    return String(luhnCheckDigit(s));
  },
  decode: (t) => {
    const s = cleanDigits(t);
    if (s.length < 2) throw new Error("Luhn: 完整号至少 2 位");
    if (luhnValid(s)) return "合法（Luhn 校验通过）";
    const correct = luhnCheckDigit(s.slice(0, -1));
    return "非法：末位校验位应为 " + correct;
  },
});

// 2. ISBN-10/13（自动识别长度）
register({
  id: "isbn", cat: "radix", name: "ISBN-10/13 校验位",
  desc: "ISBN-10（模 11，校验位可能 X）/ ISBN-13（模 10）校验。encode=算校验位，decode=校验",
  params: [],
  encode: (t) => {
    const s = cleanNum(t);
    if (s.length === 9 && isDigits(s)) return isbn10CheckDigit(s);
    if (s.length === 12 && isDigits(s)) return ean13CheckDigit(s);
    throw new Error("ISBN 主体须 9 位（ISBN-10）或 12 位（ISBN-13）数字");
  },
  decode: (t) => {
    const s = cleanNum(t);
    if (s.length === 10) {
      if (!/^\d{9}[\dX]$/.test(s)) throw new Error("ISBN-10 须 9 数字 + (数字或X)");
      if (isbn10Valid(s)) return "合法（ISBN-10 模 11 校验通过）";
      const correct = isbn10CheckDigit(s.slice(0, -1));
      return "非法：校验位应为 " + correct;
    }
    if (s.length === 13) {
      if (!isDigits(s)) throw new Error("ISBN-13 须 13 位数字");
      if (ean13Valid(s)) return "合法（ISBN-13 模 10 校验通过）";
      const correct = ean13CheckDigit(s.slice(0, -1));
      return "非法：校验位应为 " + correct;
    }
    throw new Error("ISBN 须 10 位或 13 位");
  },
});

// 3. EAN-13
register({
  id: "ean13", cat: "radix", name: "EAN-13 校验位",
  desc: "EAN-13 条码校验（模 10，奇位×1 偶位×3）。encode=算校验位，decode=校验",
  params: [],
  encode: (t) => {
    const s = cleanDigits(t);
    if (s.length !== 12) throw new Error("EAN-13 主体须 12 位数字");
    return ean13CheckDigit(s);
  },
  decode: (t) => {
    const s = cleanDigits(t);
    if (s.length !== 13) throw new Error("EAN-13 须 13 位数字");
    if (ean13Valid(s)) return "合法（EAN-13 模 10 校验通过）";
    const correct = ean13CheckDigit(s.slice(0, -1));
    return "非法：校验位应为 " + correct;
  },
});

// 4. 中国身份证 18 位校验位（GB 11643）
register({
  id: "cnidCheck", cat: "radix", name: "身份证 18 位校验位",
  desc: "中国身份证 18 位校验位（GB 11643-1999，校验位可能 X）。encode=算校验位，decode=校验",
  params: [],
  encode: (t) => {
    const s = cleanDigits(t);
    if (s.length !== 17) throw new Error("身份证主体须 17 位数字");
    return cnidCheckDigit(s);
  },
  decode: (t) => {
    const s = cleanNum(t);
    if (s.length !== 18) throw new Error("身份证须 18 位（17 数字 + 校验位）");
    if (!/^\d{17}[\dX]$/.test(s)) throw new Error("身份证格式：17 数字 + (数字或X)");
    if (cnidValid(s)) return "合法（GB 11643 校验通过）";
    const correct = cnidCheckDigit(s.slice(0, -1));
    return "非法：校验位应为 " + correct;
  },
});

// 5. UPC-A
register({
  id: "upc", cat: "radix", name: "UPC-A 校验位",
  desc: "UPC-A 条码校验（模 10，奇位×3 偶位×1）。encode=算校验位，decode=校验",
  params: [],
  encode: (t) => {
    const s = cleanDigits(t);
    if (s.length !== 11) throw new Error("UPC-A 主体须 11 位数字");
    return upcCheckDigit(s);
  },
  decode: (t) => {
    const s = cleanDigits(t);
    if (s.length !== 12) throw new Error("UPC-A 须 12 位数字");
    if (upcValid(s)) return "合法（UPC-A 模 10 校验通过）";
    const correct = upcCheckDigit(s.slice(0, -1));
    return "非法：校验位应为 " + correct;
  },
});

// 6. 银行卡 BIN 识别（单向 run）
register({
  id: "bankBin", cat: "radix", name: "银行卡 BIN 识别",
  desc: "银行卡前 6 位 BIN 识别（卡组织 + 发卡行，单向）",
  params: [],
  run: (t) => {
    const num = cleanDigits(t);
    if (num.length < 4) throw new Error("卡号至少 4 位");
    const info = binLookup(num);
    const lines = [
      "卡号:        " + num + (num.length >= 6 ? "" : "（前 6 位不足，按已有前缀匹配）"),
      "BIN 前缀:    " + num.slice(0, 6),
      "卡组织:      " + info.brand,
      "发卡行:      " + info.issuer,
      "卡号长度:    " + num.length + " 位" + (num.length >= 12 && num.length <= 19 ? "（合规）" : "（异常）"),
    ];
 // 顺带 Luhn 校验（卡号常见 13-19 位）
    if (num.length >= 13 && num.length <= 19) {
      lines.push("Luhn 校验:   " + (luhnValid(num) ? "通过" : "不通过"));
    }
    return lines.join("\n");
  },
});

export {
  luhnCheckDigit, luhnValid,
  isbn10CheckDigit, isbn10Valid,
  ean13CheckDigit, ean13Valid,
  cnidCheckDigit, cnidValid,
  upcCheckDigit, upcValid,
  binLookup,
};
