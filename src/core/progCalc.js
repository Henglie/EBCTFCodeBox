/*
 * progCalc.js — 程序员计算器（cat:'radix'，run 报告型，T338）。
 *
 * 位运算表达式求值 + 多视图输出。运算符（优先级同 C/JS，从低到高）：
 *   |   →  ^  →  &  →  << >> >>>  →  + -  →  * / %  →  **  →  ~ -(+) 一元
 *   函数：rotl(x, n) / rotr(x, n)（循环移位，CTF/密码学高频，标准运算符没有）
 *   字面量：0x / 0b / 0o 前缀 + 十进制（BigInt）
 *
 * 字宽：8 / 16 / 32 / 64 位（width 参数，默认 32；纯函数入口另收 1–512 的
 * 任意位宽，供「快速换算」视图的自定义 bit 数用）。每个运算结果立即按字宽
 * 掩码回绕（C 整数回绕语义），全程 BigInt——绝不用 Number 位运算
 * （JS 的 |/& 会把操作数截成 32 位有符号，64 位字宽必错，本卡头号坑）。
 *
 * signed 参数（默认 true）影响：十进制显示、/ 与 % 的语义（signed 解读下
 * 向零截断再回绕，同 C）；>> 始终算术右移（负数补符号位，同 JS），
 * >>> 始终逻辑右移（无符号域），两运算符语义固定不随 signed 切换。
 *
 * 安全红线：绝不用 eval / new Function 求值——手写词法分析 + 递归下降
 * 解析器（解析即求值，无 AST 中间层）。表达式长度上限 1024 字符，
 * 括号深度上限 32。
 *
 * 移位数按字宽取模（JS 语义：1 << 32 在 32 位下 = 1 << 0）；
 * 负移位数报错；rotl/rotr 的 n 负值按数学等价处理（mod 字宽）。
 * ** 负指数报错（整数计算器）；快速幂 mod 2^w，防大指数爆内存。
 *
 * 与 T337 radixAll 的边界：radixAll 是单数值的多进制对照视图（无运算），
 * 本 op 是表达式求值器（有运算），负数补码多宽度展示归 radixAll。
 *
 * 红线：core 层零 UI 依赖（仅 registry）；纯本地零外发。
 */
import { register } from "./registry.js";

const MAX_EXPR_LEN = 1024;
const MAX_PAREN_DEPTH = 32;

// ============ 词法分析 ============
// token: { type: "num"|"ident"|"op", value: BigInt|string, pos }
function tokenize(src) {
  const toks = [];
  let i = 0;
  const isDigit = (c) => c >= "0" && c <= "9";
  const isIdentStart = (c) => /[a-zA-Z_]/.test(c);
  const isIdentChar = (c) => /[a-zA-Z0-9_]/.test(c);
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    // 数字字面量（0x/0b/0o 前缀或十进制）
    if (isDigit(c)) {
      const start = i;
      let base = 10;
      if (c === "0" && i + 1 < src.length) {
        const p = src[i + 1].toLowerCase();
        if (p === "x") base = 16;
        else if (p === "b") base = 2;
        else if (p === "o") base = 8;
      }
      if (base !== 10) i += 2; // 跳过前缀
      const ds = i;
      while (i < src.length && /[0-9a-fA-F]/.test(src[i]) && parseInt(src[i], 16) < base) i++;
      if (i === ds) {
        const pfx = { 16: "x", 2: "b", 8: "o" }[base] ?? "";
        throw new Error(`位置 ${start + 1}：前缀 0${pfx} 后无数字`);
      }
      // 切片含前缀一起交给 BigInt（其原生支持 0x/0b/0o）——
      // 剥前缀后按十进制解析会把 0x80000000 错读成 80000000（本卡自检抓出的头号 bug）
      toks.push({ type: "num", value: BigInt(src.slice(start, i)), pos: start });
      continue;
    }
    // 标识符（rotl / rotr）
    if (isIdentStart(c)) {
      const start = i;
      while (i < src.length && isIdentChar(src[i])) i++;
      toks.push({ type: "ident", value: src.slice(start, i), pos: start });
      continue;
    }
    // 运算符（最长匹配：** >>> << >> 先于单字符）
    const three = src.slice(i, i + 3);
    const two = src.slice(i, i + 2);
    if (three === ">>>") {
      toks.push({ type: "op", value: ">>>", pos: i });
      i += 3;
      continue;
    }
    if (["<<", ">>", "**"].includes(two)) {
      toks.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if ("&|^~+-*/%(),".includes(c)) {
      toks.push({ type: "op", value: c, pos: i });
      i++;
      continue;
    }
    throw new Error(`位置 ${i + 1}：无法识别的字符 '${c}'`);
  }
  return toks;
}

// ============ 求值上下文 ============
// 内部表示：全程无符号 BigInt ∈ [0, 2^w)，负数即补码位模式。
function makeCtx(width, signed) {
  const W = BigInt(width);
  const MOD = 1n << W;
  const MASK = MOD - 1n;
  const wrap = (v) => ((v % MOD) + MOD) % MOD;
  const toSigned = (v) => (v >= MOD / 2n ? v - MOD : v);

  // 快速幂 mod 2^w（防大指数真算 a^e）
  function powMod(a, e) {
    let r = 1n;
    let base = a & MASK;
    let exp = e;
    while (exp > 0n) {
      if (exp & 1n) r = (r * base) & MASK;
      base = (base * base) & MASK;
      exp >>= 1n;
    }
    return r;
  }

  // 计数类操作数（移位数/指数/rotl 的 n）的符号判读：按当前 signed 模式解读。
  // 内部值恒为无符号域——wrap(-1)=0xFFFFFFFF，直接判 <0n 永远不成立，
  // `1 << -1` / `2 ** -1` 会漏报错（自检抓出的第二类 bug）。
  function countSigned(v) {
    return signed ? toSigned(v) : v;
  }

  // 移位数：负数报错，按字宽取模（JS 语义）
  function shiftN(n) {
    const sn = countSigned(n);
    if (sn < 0n) throw new Error(`移位数为负（${sn}）：不支持负移位`);
    return sn % W;
  }

  return {
    width, signed, W, MOD, MASK, wrap, toSigned, powMod, shiftN,
  };
}

// ============ 递归下降解析 + 求值 ============
function evalProgExpr(src, opts = {}) {
  const width = opts.width === undefined || opts.width === null || opts.width === ""
    ? 32
    : Number(opts.width);
  // 字宽：常用 8/16/32/64 之外还收**任意位宽** 1–512（MT81 恒烈点名「几个 bit」——
  // 逆向里 12 位地址总线、位域、24 位色深都不是 2 的幂）。op 的下拉仍只给四档，
  // 这里放宽的是纯函数入口，向后兼容。
  if (!Number.isInteger(width) || width < 1 || width > 512) {
    throw new Error(`字宽须为 1–512 的整数（常用 8/16/32/64）：${opts.width}`);
  }
  const signed = opts.signed !== false; // 默认有符号
  const s = String(src ?? "").trim();
  if (!s) throw new Error("空表达式：如 1 << 31 | 0xFF & 0x0F、rotl(0x80000000, 1)");
  if (s.length > MAX_EXPR_LEN) {
    throw new Error(`表达式 ${s.length} 字符超过上限 ${MAX_EXPR_LEN}`);
  }

  const ctx = makeCtx(width, signed);
  const toks = tokenize(s);
  let i = 0;
  let depth = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];

  function expectOp(op) {
    const t = next();
    if (!t || t.type !== "op" || t.value !== op) {
      throw new Error(`位置 ${t ? t.pos + 1 : s.length + 1}：期望 '${op}'${t ? `，实际是 '${t.value}'` : "，表达式在此结束"}`);
    }
  }

  // 每层二元循环运算后立即 wrap（C 回绕语义）
  function div(a, b) {
    if (b === 0n) throw new Error("除数为零");
    return ctx.signed ? ctx.wrap(ctx.toSigned(a) / ctx.toSigned(b)) : ctx.wrap(a / b);
  }
  function mod(a, b) {
    if (b === 0n) throw new Error("模数为零");
    return ctx.signed ? ctx.wrap(ctx.toSigned(a) % ctx.toSigned(b)) : ctx.wrap(a % b);
  }

  function parseExpr() {
    return parseOr();
  }
  function parseOr() {
    let v = parseXor();
    while (peek() && peek().type === "op" && peek().value === "|") {
      next();
      v = (v | parseXor()) & ctx.MASK;
    }
    return v;
  }
  function parseXor() {
    let v = parseAnd();
    while (peek() && peek().type === "op" && peek().value === "^") {
      next();
      v = (v ^ parseAnd()) & ctx.MASK;
    }
    return v;
  }
  function parseAnd() {
    let v = parseShift();
    while (peek() && peek().type === "op" && peek().value === "&") {
      next();
      v = (v & parseShift()) & ctx.MASK;
    }
    return v;
  }
  function parseShift() {
    let v = parseAdd();
    while (peek() && peek().type === "op" && ["<<", ">>", ">>>"].includes(peek().value)) {
      const op = next().value;
      const r = parseAdd();
      const n = ctx.shiftN(r);
      if (op === "<<") v = (v << n) & ctx.MASK;
      else if (op === ">>") v = ctx.wrap(ctx.toSigned(v) >> n); // 算术右移
      else v = v >> n; // 逻辑右移（v 已是无符号域）
    }
    return v;
  }
  function parseAdd() {
    let v = parseMul();
    while (peek() && peek().type === "op" && (peek().value === "+" || peek().value === "-")) {
      const op = next().value;
      const r = parseMul();
      v = op === "+" ? ctx.wrap(v + r) : ctx.wrap(v - r);
    }
    return v;
  }
  function parseMul() {
    let v = parsePow();
    while (peek() && peek().type === "op" && ["*", "/", "%"].includes(peek().value)) {
      const op = next().value;
      const r = parsePow();
      if (op === "*") v = ctx.wrap(v * r);
      else if (op === "/") v = div(v, r);
      else v = mod(v, r);
    }
    return v;
  }
  function parsePow() {
    const base = parseUnary();
    if (peek() && peek().type === "op" && peek().value === "**") {
      next();
      const eRaw = parsePow(); // 右结合
      const e = ctx.signed ? ctx.toSigned(eRaw) : eRaw;
      if (e < 0n) throw new Error(`** 指数为负（${e}）：整数计算器不支持负指数`);
      return ctx.powMod(base, e);
    }
    return base;
  }
  function parseUnary() {
    const t = peek();
    if (t && t.type === "op" && (t.value === "~" || t.value === "-" || t.value === "+")) {
      next();
      const v = parseUnary();
      if (t.value === "~") return (~v) & ctx.MASK;
      if (t.value === "-") return ctx.wrap(-v);
      return v;
    }
    return parsePrimary();
  }
  function parsePrimary() {
    const t = next();
    if (!t) throw new Error(`位置 ${s.length + 1}：表达式意外结束（缺少操作数）`);
    if (t.type === "num") return t.value & ctx.MASK; // 字面量立即截断（C 截断语义）
    if (t.type === "ident") {
      if (t.value !== "rotl" && t.value !== "rotr") {
        throw new Error(`位置 ${t.pos + 1}：未知函数 '${t.value}'（仅支持 rotl / rotr）`);
      }
      expectOp("(");
      const x = parseExpr();
      expectOp(",");
      const nRaw = parseExpr();
      expectOp(")");
      // 负 n 按数学等价处理：rotl(x,-1) ≡ rotr(x,1)。nRaw 已回绕成无符号域
      // （wrap(-1)=0xFFFFFFFF），先按 signed 模式还原符号再 mod 字宽。
      let n = (ctx.signed ? ctx.toSigned(nRaw) : nRaw) % ctx.W;
      if (n < 0n) n += ctx.W;
      if (t.value === "rotl") return ((x << n) | (x >> (ctx.W - n))) & ctx.MASK;
      return ((x >> n) | (x << (ctx.W - n))) & ctx.MASK;
    }
    if (t.type === "op" && t.value === "(") {
      depth++;
      if (depth > MAX_PAREN_DEPTH) throw new Error(`位置 ${t.pos + 1}：括号嵌套超过 ${MAX_PAREN_DEPTH} 层`);
      const v = parseExpr();
      const close = next();
      if (!close || close.value !== ")") {
        throw new Error(`位置 ${t.pos + 1}：括号不匹配（缺少 ')'）`);
      }
      depth--;
      return v;
    }
    throw new Error(`位置 ${t.pos + 1}：意外的记号 '${t.value}'（缺少操作数）`);
  }

  const value = parseExpr();
  if (i < toks.length) {
    const t = toks[i];
    throw new Error(`位置 ${t.pos + 1}：表达式结束后还有多余内容 '${t.value}'`);
  }
  return { value, ctx, src: s };
}

// ============ 报告 ============
function popcount(v) {
  let n = 0n;
  let x = v;
  while (x > 0n) {
    n += x & 1n;
    x >>= 1n;
  }
  return n;
}

function progCalcRun(src, p) {
  const { value, ctx } = evalProgExpr(src, {
    width: Number((p && p.width) || 32),
    signed: !(p && p.signed === false),
  });
  const sv = ctx.toSigned(value);
  // 任意位宽下 width/4 可能非整（如 12 位 → 3 个 hex 位），须向上取整
  const hex = "0x" + value.toString(16).toUpperCase().padStart(Math.ceil(ctx.width / 4), "0");
  const bin = value
    .toString(2)
    .padStart(ctx.width, "0")
    .replace(/(.{4})(?=.)/g, "$1 ");
  const bits = ctx.width;
  const bitLen = value === 0n ? 0 : value.toString(2).length;
  const leading = bits - bitLen;
  let trailing = 0;
  if (value === 0n) trailing = bits;
  else {
    let x = value;
    while ((x & 1n) === 0n) {
      trailing++;
      x >>= 1n;
    }
  }
  const lines = [
    `结果：${sv}（按 ${bits} 位 ${ctx.signed ? "有符号" : "无符号"}解读）`,
    `  十进制   : ${sv}（signed） / ${value}（unsigned）`,
    `  十六进制 : ${hex}`,
    `  八进制   : 0o${value.toString(8)}`,
    `  二进制   : ${bin}`,
    sv < 0n
      ? `  补码     : ${sv} 的 ${bits} 位补码 = ${hex}（无符号值 ${value}）`
      : `  补码     : 非负数，补码与原码相同（${hex}）`,
    `  置位数   : ${popcount(value)}`,
    `  前导零   : ${leading}（按 ${bits} 位字宽）`,
    `  尾随零   : ${trailing}`,
  ];
  return lines.join("\n");
}

// ============ 载入自校验（不符即抛错，阻断注册） ============
(() => {
  // 1 << 31：32 位 signed -2147483648 / unsigned 2147483648
  let r = evalProgExpr("1 << 31", { width: 32, signed: true });
  if (r.ctx.toSigned(r.value) !== -2147483648n || r.value !== 2147483648n) {
    throw new Error("progCalc 自检失败：1 << 31（32 位）不符");
  }
  r = evalProgExpr("1 << 31", { width: 32, signed: false });
  if (r.value !== 2147483648n) throw new Error("progCalc 自检失败：1 << 31 unsigned 不符");
  // ~0：8 位 = 0xFF / signed -1
  r = evalProgExpr("~0", { width: 8 });
  if (r.value !== 0xffn || r.ctx.toSigned(r.value) !== -1n) {
    throw new Error("progCalc 自检失败：~0（8 位）应 0xFF / -1");
  }
  // rotl(0x80000000, 1) = 1（32 位）
  r = evalProgExpr("rotl(0x80000000, 1)", { width: 32 });
  if (r.value !== 1n) throw new Error("progCalc 自检失败：rotl(0x80000000, 1) ≠ 1");
  // rotr 对拍：rotr(1, 1) = 0x80000000
  r = evalProgExpr("rotr(1, 1)", { width: 32 });
  if (r.value !== 0x80000000n) throw new Error("progCalc 自检失败：rotr(1, 1) ≠ 0x80000000");
  // 0xFFFFFFFFFFFFFFFF >> 4（64 位，BigInt 路径未被 Number 截断；算术右移全 1 仍全 1 = -1）
  r = evalProgExpr("0xFFFFFFFFFFFFFFFF >> 4", { width: 64 });
  if (r.value !== 0xffffffffffffffffn || r.ctx.toSigned(r.value) !== -1n) {
    throw new Error("progCalc 自检失败：64 位算术右移路径不符");
  }
  // 64 位字宽防 Number 截断对拍：1 << 63（64 位）= 0x8000...0
  r = evalProgExpr("1 << 63", { width: 64 });
  if (r.value !== 1n << 63n) throw new Error("progCalc 自检失败：1 << 63（64 位）被截断");
  // -8 >> 1（算术）= -4；-8 >>> 1（逻辑）= 2147483644
  r = evalProgExpr("-8 >> 1", { width: 32 });
  if (r.ctx.toSigned(r.value) !== -4n) throw new Error("progCalc 自检失败：-8 >> 1 ≠ -4");
  r = evalProgExpr("-8 >>> 1", { width: 32 });
  if (r.value !== 2147483644n) throw new Error("progCalc 自检失败：-8 >>> 1 ≠ 2147483644");
  // 算术/优先级对拍（与 JS Number 32 位一致）：2 + 3 * 4 = 14；1 | 2 ^ 3 & 5 → 1|(2^(3&5))=1|(2^1)=3
  r = evalProgExpr("2 + 3 * 4", { width: 32 });
  if (r.value !== 14n) throw new Error("progCalc 自检失败：2 + 3 * 4 ≠ 14");
  r = evalProgExpr("1 | 2 ^ 3 & 5", { width: 32 });
  if (r.value !== 3n) throw new Error("progCalc 自检失败：位运算优先级 1|2^3&5 ≠ 3");
  // 进制字面量回归（头号 bug：曾把 0x80000000 错读成十进制 80000000）
  r = evalProgExpr("0xFF & 0x0F", { width: 32 });
  if (r.value !== 15n) throw new Error("progCalc 自检失败：0xFF & 0x0F ≠ 15（hex 字面量回归）");
  r = evalProgExpr("0b1010 | 0", { width: 32 });
  if (r.value !== 10n) throw new Error("progCalc 自检失败：0b1010 ≠ 10（bin 字面量回归）");
  r = evalProgExpr("0o17 + 0", { width: 32 });
  if (r.value !== 15n) throw new Error("progCalc 自检失败：0o17 ≠ 15（oct 字面量回归）");
  // rotl 负参数数学等价：rotl(1, -1) ≡ rotr(1, 1) = 0x80000000
  r = evalProgExpr("rotl(1, -1)", { width: 32 });
  if (r.value !== 0x80000000n) throw new Error("progCalc 自检失败：rotl(1, -1) ≠ 0x80000000（负 n 等价回归）");
  // 计数类负数报错回归（曾因回绕恒非负而漏检）：`1 << -1` 走一元负号、
  // `1 << (0-1)` 走二元减法，两条解析路径回绕后同值 0xFFFFFFFF，须同样报负移位。
  for (const negShift of ["1 << -1", "1 << (0-1)"]) {
    let threwNeg = false;
    try {
      evalProgExpr(negShift, { width: 32 });
    } catch (e) {
      threwNeg = /负移位/.test(e.message);
    }
    if (!threwNeg) throw new Error(`progCalc 自检失败：${negShift} 应报负移位而未报（回绕漏检回归）`);
  }
  r = evalProgExpr("1 << 33", { width: 32 });
  if (r.value !== 2n) throw new Error("progCalc 自检失败：1 << 33（mod 32）≠ 2");
  // ** 右结合与快速幂：2 ** 10 = 1024；2 ** 64（64 位）回绕 = 0
  r = evalProgExpr("2 ** 10", { width: 32 });
  if (r.value !== 1024n) throw new Error("progCalc 自检失败：2 ** 10 ≠ 1024");
  r = evalProgExpr("2 ** 64", { width: 64 });
  if (r.value !== 0n) throw new Error("progCalc 自检失败：2 ** 64（64 位回绕）≠ 0");
  // 除法/取模（signed 语义）：-7 / 2 = -3（向零截断）；-7 % 2 = -1
  r = evalProgExpr("-7 / 2", { width: 32 });
  if (r.ctx.toSigned(r.value) !== -3n) throw new Error("progCalc 自检失败：-7 / 2 ≠ -3");
  r = evalProgExpr("-7 % 2", { width: 32 });
  if (r.ctx.toSigned(r.value) !== -1n) throw new Error("progCalc 自检失败：-7 % 2 ≠ -1");
  // 报告视图：1 << 31（32 位）报告行
  const rep = progCalcRun("1 << 31", { width: 32 });
  for (const expect of ["-2147483648", "2147483648", "0x80000000", "1000 0000 0000 0000 0000 0000 0000 0000", "置位数", "前导零", "尾随零"]) {
    if (!rep.includes(expect)) throw new Error(`progCalc 自检失败：报告缺 "${expect}"`);
  }
  // 非法输入：清晰报错不崩
  const bad = [
    ["1 +", /意外结束/],
    ["((1)", /括号不匹配/],
    ["eval(1)", /未知函数 'eval'/],
    ["1 +* 2", /意外的记号/],
    ["1 / 0", /除数为零/],
    ["2 ** -1", /负指数/],
    ["1 << -1", /负移位/],
    ["a", /未知函数 'a'/],
    ["", /空表达式/],
    ["1".repeat(1025), /超过上限/],
    ["(".repeat(33) + "1" + ")".repeat(33), /括号嵌套超过/],
    ["1 $ 2", /无法识别的字符/],
  ];
  for (const [input, re] of bad) {
    let threw = null;
    try {
      evalProgExpr(input, { width: 32 });
    } catch (e) {
      threw = e.message;
    }
    if (!threw) throw new Error(`progCalc 自检失败：${JSON.stringify(input.slice(0, 16))} 应报错而未报`);
    if (!re.test(threw)) throw new Error(`progCalc 自检失败：${JSON.stringify(input.slice(0, 16))} 报错文案不符：${threw}`);
  }
})();

register({
  id: "progCalc",
  cat: "radix",
  name: "程序员计算器",
  desc: "位运算表达式求值（手写递归下降解析器，无 eval）：& | ^ ~ << >> >>> + - * / % **、括号、rotl/rotr 循环移位；8/16/32/64 位字宽掩码回绕（全程 BigInt），有/无符号切换；一次输出十进制/十六进制/八进制/二进制（4 位分组）/补码/popcount/前导零/尾随零。",
  params: [
    { key: "width", label: "字宽", type: "select", default: 32, options: [
      { value: 8, label: "8 位" },
      { value: 16, label: "16 位" },
      { value: 32, label: "32 位" },
      { value: 64, label: "64 位" },
    ] },
    { key: "signed", label: "有符号解读（影响显示与 / % 语义）", type: "bool", default: true },
  ],
  run: (t, p) => progCalcRun(t, p),
});

export { evalProgExpr, progCalcRun, tokenize };
