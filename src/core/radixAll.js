/*
 * radixAll.js — 一键多进制转换（cat:'radix'，run 报告型，T337）。
 *
 * 一个输入（自动嗅探进制），一次性给出全部常用进制对照 + 字节/字符视图：
 *   - 进制：2 / 8 / 10 / 16 / 32 / 36 / 62（数值的 N 进制数字表示）
 *   - Base64：按最小大端字节编码（RFC 4648），非「64 进制数字」——输出标明区别
 *   - 数值字节 hex（最小大端）/ UTF-16 码元 / Unicode 码位字符 / 该码位的真 UTF-8 编码 / 位宽
 *     （注意区分：数值字节是「这个数的最小大端字节序列」，UTF-8 是「把它当码位时的 UTF-8 编码」，
 *      两者对 255 分别是 FF 与 C3 BF —— 旧版把前者错标成 UTF-8，2026-08-23 归并时修正）
 *   - 负数：8 / 16 / 32 / 64 位补码（与 progCalc 呼应）
 *
 * 与既有 op 的边界（非重复功能）：
 *   - radixConvert：需手动指定源/目标进制的两两互转；本 op 是自动嗅探 + 全进制对照表
 *   - asciiRadix：文本→逐字节各进制（字节级）；本 op 是单个数值的数值级视图
 *   - mixHexOctBin：b1101000 x68 混合前缀串→文本；本 op 不做文本解码
 *   - base.js 的 base36/62/64：文本编码（字符串→编码串）；本 op 是数值的进制表示
 *
 * 嗅探规则：
 *   - 前缀 0x/0X → 16，0b/0B → 2，0o/0O → 8（可带 +/- 号，如 -0xFF）
 *   - 分隔符（空格/下划线/逗号）先归一删除：1_000_000 → 1000000
 *   - 无前缀纯数字 → 十进制；若全为 0/1 且长度≥2，无法排除二进制解读，
 *     同时列出十进制 + 二进制两种解读（不猜死一个）
 *   - 无前缀含字母（如 ff）→ 报错提示加前缀（避免歧义猜测）
 *   - 输入 > 4096 字符直接拒绝（防 BigInt 转 2 进制串爆内存）
 *
 * 复用：radix.js 的 parseBigIntRadix / bigIntToRadix（2-36 进制，BigInt）。
 * base62 数值表示本文件自实现（radix.js 明确限 2-36，属扩展非重复）。
 * 全程 BigInt，大数（如 2^256）无精度损失。
 *
 * 红线：core 层零 UI 依赖（仅 registry）；纯本地零外发。
 */
import { register } from "./registry.js";
import { parseBigIntRadix, bigIntToRadix } from "./radix.js";

const MAX_INPUT_LEN = 4096;

// base62 数值字符表：0-9 a-z A-Z（数值进制的通行排列，区别于 base.js 的文本编码 B62 表）
const B62_NUM = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

// ---- 数值 → 62 进制数字表示（BigInt）----
function bigIntToBase62(num) {
  if (num === 0n) return "0";
  let neg = false;
  let n = num;
  if (n < 0n) {
    neg = true;
    n = -n;
  }
  let out = "";
  while (n > 0n) {
    out = B62_NUM[Number(n % 62n)] + out;
    n /= 62n;
  }
  return (neg ? "-" : "") + out;
}

// ---- 正数 → 最小大端字节 hex（偶数长，如 255 → "FF"，10 → "0A"）----
function bigIntToHexBE(n) {
  const h = n.toString(16);
  return h.length % 2 ? "0" + h : h;
}

// ---- 字节 → Base64（原始字节，非 UTF-8 编码；btoa 域恰为 latin1）----
function bytesToB64(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

// ---- 码位 → UTF-16 码元数组（BE 展示用）----
function utf16Units(n) {
  if (n < 0x10000n) return [Number(n)];
  const v = n - 0x10000n;
  return [Number(0xd800n + (v >> 10n)), Number(0xdc00n + (v & 0x3ffn))];
}

// ============ 嗅探：原始输入 → 解读列表 ============
// 返回 [{ label, value(BigInt) }]；≥2 项即多解读。非法输入 throw。
function sniffRadixInput(raw) {
  const s = String(raw ?? "").trim();
  if (!s) throw new Error("空输入：请输入一个数（支持 0x/0b/0o 前缀、十进制、分隔符）");
  if (s.length > MAX_INPUT_LEN) {
    throw new Error(`输入 ${s.length} 字符超过上限 ${MAX_INPUT_LEN}（防 BigInt 转二进制串爆内存）`);
  }
  // 分隔符归一：空格 / 下划线 / 逗号（数字分组符，如 1_000_000 / 1,000,000）。
  // 含分隔符 = 明确的十进制分组写法（千分位），不再叠加二进制歧义解读。
  const hadSep = /[\s_,]/.test(s);
  const joined = s.replace(/[\s_,]+/g, "");
  if (!joined) throw new Error("去分隔符后为空：输入须包含数字");

  const m = joined.match(/^([+-]?)(0[xXbBoO])?([0-9a-zA-Z]+)$/);
  if (!m) throw new Error(`无法解析输入：${s.slice(0, 32)}${s.length > 32 ? "…" : ""}`);

  const [, sign, prefixRaw, digits] = m;
  const neg = sign === "-";
  const tag = (label) => (neg ? `-（负数，按${label}）` : label);

  // 前缀明确 → 唯一解读
  if (prefixRaw) {
    const base = { x: 16, b: 2, o: 8 }[prefixRaw[1].toLowerCase()];
    const label = { 16: "十六进制", 2: "二进制", 8: "八进制" }[base];
    const v = parseBigIntRadix(digits, base);
    return [{ label: tag(label), value: neg ? -v : v }];
  }

  // 无前缀：含字母 → 拒猜（提示加前缀）
  if (/[a-zA-Z]/.test(digits)) {
    throw new Error(`无法唯一嗅探含字母的输入 "${digits.slice(0, 16)}${digits.length > 16 ? "…" : ""}"：请加前缀（0x=十六进制 / 0b=二进制 / 0o=八进制）`);
  }

  // 纯数字 → 十进制必有一解（符号在此处生效）
  const dec = parseBigIntRadix(digits, 10);
  const out = [{ label: tag("十进制"), value: neg ? -dec : dec }];
  // 裸全 01 串（无分隔符）且长度≥2：二进制解读无法排除，并列列出
  // （如 "1010" 可能是十进制 1010 也可能是二进制 10）；两解读同值（如 "00"）只留一条
  if (!hadSep && digits.length >= 2 && /^[01]+$/.test(digits)) {
    const binV = parseBigIntRadix(digits, 2);
    if (binV !== dec) out.push({ label: tag("二进制"), value: neg ? -binV : binV });
  }
  return out;
}

// ============ 单解读 → 报告文本 ============
function renderNumber(n, label) {
  const lines = [];
  const isNeg = n < 0n;
  const abs = isNeg ? -n : n;

  lines.push(`数值：${n.toString(10)}（按${label}读入）`);
  lines.push("  进制对照（数值的 N 进制数字表示）：");
  lines.push(`    2  进制 : ${bigIntToRadix(n, 2)}`);
  lines.push(`    8  进制 : ${bigIntToRadix(n, 8)}`);
  lines.push(`    10 进制 : ${bigIntToRadix(n, 10)}`);
  lines.push(`    16 进制 : ${bigIntToRadix(n, 16)}`);
  lines.push(`    32 进制 : ${bigIntToRadix(n, 32)}（数字表示，非 RFC 4648 Base32 编码）`);
  lines.push(`    36 进制 : ${bigIntToRadix(n, 36)}`);
  lines.push(`    62 进制 : ${bigIntToBase62(n)}`);

  if (isNeg) {
    lines.push(`  补码表示（绝对值位宽 ${abs === 0n ? 0 : abs.toString(2).length} bit）：`);
    for (const bits of [8, 16, 32, 64]) {
      const mask = (1n << BigInt(bits)) - 1n;
      const comp = n & mask; // BigInt 负数 & 即按补码位模式取低 bits 位
      lines.push(`    ${String(bits).padStart(2)} 位补码 : 0x${comp.toString(16).toUpperCase().padStart(bits / 4, "0")}`);
    }
    lines.push("  注：负数的 Base64 / 字节 / 字符视图依赖字宽，见上方补码各宽度后自行截取");
  } else {
    const hexBE = bigIntToHexBE(abs);
    const bytes = hexBE.match(/../g).map((x) => parseInt(x, 16));
    lines.push(`  Base64     : ${bytesToB64(bytes)}（按最小大端字节 RFC 4648 编码，非 64 进制数字表示）`);
    lines.push("  字节 / 字符视图：");
    lines.push(`    数值字节 hex（最小大端）  : ${hexBE.toUpperCase()}`);
    if (abs <= 0x10ffffn && !(abs >= 0xd800n && abs <= 0xdfffn)) {
      const units = utf16Units(abs);
      const unitHex = units.map((u) => u.toString(16).toUpperCase().padStart(4, "0")).join(" ");
      lines.push(`    UTF-16 码元 (BE)         : ${unitHex}（${units.length} 个码元）`);
      const ch = String.fromCodePoint(Number(abs));
      const ctrl = abs < 0x20n || (abs >= 0x7fn && abs <= 0x9fn);
      lines.push(`    Unicode 码位             : U+${abs.toString(16).toUpperCase().padStart(4, "0")} = "${ch}"${ctrl ? "（控制字符，显示可能不可见）" : ""}`);
 // 真 UTF-8 编码（与上面「数值字节」是两回事：255 的数值字节是 FF，而 U+00FF 的 UTF-8 是 C3 BF）
      const u8 = Array.from(new TextEncoder().encode(ch), (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
      lines.push(`    该码位的 UTF-8 编码      : ${u8}`);
    } else {
      const why = abs > 0x10ffffn ? "超出 Unicode 上限 U+10FFFF" : "落在代理区 U+D800–U+DFFF（非字符）";
      lines.push(`    UTF-16 码元 / Unicode 码位: 不适用（${why}）`);
    }
    lines.push(`    位宽                     : ${abs === 0n ? 0 : abs.toString(2).length} bit`);
  }
  return lines.join("\n");
}

// ============ 入口：嗅探 + 全解读报告 ============
function radixAllReport(raw) {
  const reads = sniffRadixInput(raw);
  if (reads.length === 1) {
    return renderNumber(reads[0].value, reads[0].label.replace(/^-（负数，按(.+)）$/, "$1"));
  }
  const parts = [`输入 "${String(raw).trim()}" 无法唯一确定进制，列出全部 ${reads.length} 种解读：`];
  reads.forEach((r, i) => {
    parts.push("");
    parts.push(`[解读 ${i + 1}/${reads.length}] 按${r.label}：`);
    parts.push(renderNumber(r.value, r.label));
  });
  return parts.join("\n");
}

// ============ 载入自校验（不符即抛错，阻断注册） ============
(() => {
  // 嗅探：前缀唯一解读
  let r = sniffRadixInput("0xFF");
  if (r.length !== 1 || r[0].value !== 255n) throw new Error("radixAll 自检失败：0xFF ≠ 255");
  r = sniffRadixInput("0b1010");
  if (r.length !== 1 || r[0].value !== 10n) throw new Error("radixAll 自检失败：0b1010 ≠ 10");
  // 嗅探：分隔符归一
  r = sniffRadixInput("1_000_000");
  if (r.length !== 1 || r[0].value !== 1000000n) throw new Error("radixAll 自检失败：1_000_000 ≠ 1000000");
  // 嗅探：分隔符 = 十进制分组意图，不叠二进制解读；裸串才双解读
  r = sniffRadixInput("1,000,000");
  if (r.length !== 1 || r[0].value !== 1000000n) throw new Error("radixAll 自检失败：1,000,000 应单解读 1000000");
  r = sniffRadixInput("1000000");
  if (r.length !== 2 || r[0].value !== 1000000n || r[1].value !== 64n) {
    throw new Error("radixAll 自检失败：裸 1000000 应双解读 [dec 1000000, bin 64]");
  }
  // 嗅探：同值去重（"00" 十进制/二进制同为 0，只留一条）
  r = sniffRadixInput("00");
  if (r.length !== 1 || r[0].value !== 0n) throw new Error("radixAll 自检失败：00 应去重为单解读 0");
  // 嗅探：全 01 串双解读（十进制 1010 + 二进制 10）
  r = sniffRadixInput("1010");
  if (r.length !== 2 || r[0].value !== 1010n || r[1].value !== 10n) {
    throw new Error("radixAll 自检失败：1010 应双解读 [dec 1010, bin 10]");
  }
  // 嗅探：负号 + 前缀
  r = sniffRadixInput("-0xFF");
  if (r.length !== 1 || r[0].value !== -255n) throw new Error("radixAll 自检失败：-0xFF ≠ -255");
  // 报告：255 全进制对照 + Base64 + UTF-16 + 位宽
  const rep = radixAllReport("255");
  for (const expect of ["11111111", "377", "FF", "7v", "73", "47", "/w==", "00FF", "8 bit", 'U+00FF = "ÿ"', "C3 BF"]) {
    if (!rep.includes(expect)) throw new Error(`radixAll 自检失败：255 报告缺 "${expect}"`);
  }
  // 报告：负数补码（-1 → 64 位全 F）
  const neg = radixAllReport("-1");
  for (const expect of ["0xFF", "0xFFFF", "0xFFFFFFFF", "0xFFFFFFFFFFFFFFFF"]) {
    if (!neg.includes(expect)) throw new Error(`radixAll 自检失败：-1 报告缺补码 "${expect}"`);
  }
  // 报告：代理对码位（0x1F600 → D83D DE00，位宽 17）
  const emoji = radixAllReport("0x1F600");
  if (!emoji.includes("D83D DE00") || !emoji.includes("17 bit")) {
    throw new Error("radixAll 自检失败：0x1F600 码元/位宽不符");
  }
  // 大数：2^256 无精度损失（65 位 hex = 1 后 64 个 0）
  const big = radixAllReport(`0x1${"0".repeat(64)}`);
  if (!big.includes("257 bit")) throw new Error("radixAll 自检失败：2^256 位宽 ≠ 257");
  // 拒绝路径：空 / 超长 / 裸字母
  for (const bad of ["", "   ", "ff", "0x", "1".repeat(4097)]) {
    let threw = false;
    try {
      radixAllReport(bad);
    } catch {
      threw = true;
    }
    if (!threw) throw new Error(`radixAll 自检失败：输入 ${JSON.stringify(bad.slice(0, 12))} 应报错而未报`);
  }
  // base62 边界：61 → "Z"，62 → "10"
  if (bigIntToBase62(61n) !== "Z" || bigIntToBase62(62n) !== "10" || bigIntToBase62(-255n) !== "-47") {
    throw new Error("radixAll 自检失败：base62 边界值不符");
  }
})();

register({
  id: "radixAll",
  cat: "radix",
  name: "一键多进制转换",
  desc: "单输入自动嗅探（0x/0b/0o 前缀 / 十进制 / 分隔符），一次列出 2/8/10/16/32/36/62 进制对照 + Base64 + 数值字节 + UTF-16 码元 + Unicode 码位 + 该码位 UTF-8 + 位宽；负数给 8/16/32/64 位补码；全 01 串歧义时并列多种解读。BigInt 大数无精度损失。",
  run: (t) => radixAllReport(t),
});

export { sniffRadixInput, radixAllReport, bigIntToBase62, bigIntToHexBE };
