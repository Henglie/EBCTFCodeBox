/*
 * domainScope.js — 声明式字符定义域（一键解码候选准入的字符级缩限）
 *
 * 用途：为高频编解码 op 建立「声明式定义域」，供一键解码的候选准入做字符级缩限。
 * 设计目标：
 *   - 越界输入（含不属于该编码字符表的字符）不再被误判为候选；
 *   - 合法输入（含其天然分隔符 / 原样透传字符）零误杀。
 *
 * 每一层对「当前文本」重新求值，不缓存、不静态判断（满足逐层重算需求）。
 *
 * 声明 schema（每个 op 四条）：
 *   participant 参与字符表   —— 该 op 真正会变换的字符集合
 *   separator   可忽略分隔符 —— decode 会先剥离的纯结构性字符（如空白）
 *   passthrough 原样透传字符 —— decode 不变换、原样保留的字符
 *   reject      拒绝字符     —— 出现即判定输入非法（类外字符）。未显式列出时，
 *                              任何既非 participant / separator / passthrough 的字符
 *                              也按「类外」计入拒绝。
 *
 * 求值语义（scopeEvaluate）：
 *   ① 命中 reject 或落入类外（四类中均不匹配）→ 拒绝
 *   ② 一个 participant 都没有（整串只有分隔/透传）→ 拒绝（无意义候选）
 *   ③ 其余 → 准入
 *
 * 未声明的 op 返回 { admit: null }，由调用方回退既有逻辑。
 *
 * 纯函数、零依赖、可结构化克隆；不 import 任何产品代码（便于独立运行 / Worker 引用）。
 */

// ---------- 字符集构造助手 ----------
// 把字符串转成「成员判定」函数（避免正则转义陷阱，行为最直观）。
const S = (s) => (ch) => s.includes(ch);
// 把正则包成判定函数。
const RE = (r) => (ch) => r.test(ch);
// 把任意字母表字符串安全包成字符类（自动转义 \ ] ^ -）。
function rxSafe(s) {
  const esc = s.replace(/[\\^\]-]/g, "\\$&");
  const r = new RegExp("[" + esc + "]");
  return (ch) => r.test(ch);
}

// ---------- 各编码权威字符表（取自各自 decode 实现与对应规范） ----------
// Base 系列（base.js）：
const B16 = "0123456789abcdefABCDEF";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567=";
const B36 = "0123456789abcdefghijklmnopqrstuvwxyz"; // 仅小写：B36 字典即小写，大写非法
const B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"; // 空格是数据字符（码表索引 36）
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_-"; // 含 urlsafe -_
const B85 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~"; // 可打印 33..126
const B91 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$%&()*+,./:;<=>?@[]^_`{|}~\"";
const B92 = "!#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_abcdefghijklmnopqrstuvwxyz{|}";

const WS = RE(/\s/);

/**
 * 声明表。仅登记有「权威字符表依据」的高频 op；其余一律不登记（回退既有逻辑）。
 * authority 字段说明依据来源（规范 / 具体 decode 行为），不臆造字符表。
 */
export const DOMAIN_SCOPE = {
  // ---------- Base 系列（依据 base.js 的 decode 实现）----------
  base64: {
    participant: S(B64),
    separator: WS,
    authority: "RFC 4648：字母表 A-Z a-z 0-9 + /，填充 =；urlsafe 变体用 - _；decode 先 strip 空白与 urlsafe 归一后 atob。空白为可忽略分隔符。",
  },
  base32: {
    participant: RE(/[A-Z2-7=]/i), // 大小写不敏感：decode 先 toUpperCase 再校验
    separator: WS,
    authority: "RFC 4648：字母表 A-Z 与 2-7，填充 =；decode 先去尾 = 与空白，再 toUpperCase 归一，故小写亦合法。",
    note: "字符集为 A-Z2-7；I/L/O/U 等大小写经大写后仍不在字母表内，属越界（宁松勿杀，接受大小写字母）。",
  },
  base45: {
    participant: S(B45),
    separator: RE(/[\r\n]/), // 仅去 CR/LF；空格是数据字符，不得剥离
    authority: "RFC 9285：字母表 0-9 A-Z 及空格 $ % * + - . / :；空格是合法码表索引 36，decode 仅去换行。",
    note: "空白中的空格参与运算，只有回车/换行作分隔符。",
  },
  base16: {
    participant: S(B16),
    separator: WS,
    passthrough: RE(/[xX]/), // 容忍 0x 前缀
    authority: "hex decode：标准码表只认 0-9 a-f A-F，并容忍 0x 前缀与空白；其余字符为类外。",
  },
  base36: {
    participant: S(B36), // 仅小写：B36 字典小写，大写非法
    separator: WS,
    authority: "base36 decode 用 B36='0-9a-z' 字典查表，大写字母 indexOf 为 -1 → 抛错，故大写属越界。",
    note: "与既有实现差异：此处按字典严格区分大小写，拒绝大写（既有实现对 base36 用了不区分大小写，会误收大写）。",
  },
  base58: {
    participant: S(B58),
    separator: WS,
    authority: "Bitcoin 字母表 1-9 A-H J-NP-Z a-km-z（无 0/O/I/l）；decode 按字典查表，其余字符越界。",
  },
  base62: {
    participant: S(B62),
    separator: WS,
    authority: "字母表 0-9 A-Z a-z；decode 按字典查表，其余字符越界。",
  },
  base85: {
    participant: RE(/[\x21-\x7e]/), // Ascii85 可打印区间 33..126
    separator: WS,
    authority: "Adobe Ascii85：每个字符 = 码点 33..117（'!'..'u'）；声明取可打印 33..126 以容纳包裹符与 z，越界字符拒绝。",
  },
  base91: {
    participant: rxSafe(B91),
    separator: WS,
    authority: "basE91 字母表（94 字符，含 !#$%&()*+,./:;<=>?@[]^_`{|}~ 与字母数字）；decode 按字典查表，其余越界。",
  },
  base92: {
    participant: rxSafe(B92),
    separator: WS,
    authority: "base92 字母表（!#$%&'()*+,-./0-9:;<=>?@A-Z[\\]^_a-z{|}）；decode 按字典查表，其余越界。",
  },

  // ---------- 古典 / 文本换位替换（字母参与，非字母原样透传）----------
  // 依据：vigenere/affine/beaufort/autokey/gronsfeld/trithemius/keyboardShift/atbash 的
  // decode 仅对 [A-Za-z] 做变换，其余字符原样保留（不占移位序号、不报错）。
  caesar: {
    participant: RE(/[A-Za-z]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z\s]/),
    authority: "凯撒类 decode 仅变换字母，数字/标点/空格原样透传；无拒绝字符（任何含字母的文本皆为潜在明文）。",
  },
  vigenere: {
    participant: RE(/[A-Za-z]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z\s]/),
    authority: "维吉尼亚 decode 仅对字母做移位，非字母原样透传。",
  },
  affine: {
    participant: RE(/[A-Za-z]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z\s]/),
    authority: "仿射 decode 仅对字母做 (a·x+b) mod 26，非字母原样透传。",
  },
  beaufort: {
    participant: RE(/[A-Za-z]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z\s]/),
    authority: "Beaufort decode 仅对字母做变换，非字母原样透传。",
  },
  autokey: {
    participant: RE(/[A-Za-z]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z\s]/),
    authority: "AutoKey decode 仅对字母做变换，非字母原样透传。",
  },
  gronsfeld: {
    participant: RE(/[A-Za-z]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z\s]/),
    authority: "Gronsfeld decode 仅对字母做移位，非字母原样透传。",
  },
  trithemius: {
    participant: RE(/[A-Za-z]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z\s]/),
    authority: "Trithemius decode 仅对字母做渐进移位，非字母原样透传、不占序号。",
  },
  keyboardShift: {
    participant: RE(/[A-Za-z]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z\s]/),
    authority: "键盘漂移 decode 仅对字母做键位循环移位，非字母原样透传。",
  },
  atbash: {
    participant: RE(/[A-Za-z]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z\s]/),
    authority: "Atbash decode 仅对字母做 A↔Z 反转，非字母原样透传。",
  },

  // ---------- ROT 系列 ----------
  rot13: {
    participant: RE(/[A-Za-z]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z\s]/),
    authority: "ROT13 仅对字母做 +13，非字母原样透传。",
  },
  rot18: {
    participant: RE(/[A-Za-z0-9]/),
    separator: WS,
    passthrough: RE(/[^A-Za-z0-9\s]/),
    authority: "ROT18 = ROT13 + ROT5，仅变换字母与数字，其余原样透传。",
  },
  rot47: {
    participant: RE(/[\x21-\x7e]/), // 可打印 ASCII 33..126
    separator: null,
    passthrough: RE(/[^\x21-\x7e]/), // 非可打印字符原样透传
    authority: "ROT47 在可打印 ASCII 33..126 内循环移位 47；控制符/非 ASCII 原样透传，无拒绝字符。",
  },
  rotSpecial: {
    participant: RE(/[\x21-\x7e]/), // 取最宽安全档 ascii94，宁松勿杀
    separator: null,
    passthrough: RE(/[^\x21-\x7e]/),
    authority: "Rot 任意位移：letters/alnum/ascii94 三档均只变换对应区间字符，其余原样透传；取 ascii94 覆盖最广，避免误杀。",
  },

  // ---------- Morse ----------
  morse: {
    participant: RE(/[.\-]/),
    separator: RE(/[\s/|x]/),
    authority: "Morse 点位仅由 . 与 - 组成，空白 / | x 作分隔；其它字符为类外（如明文字母串不应作为 morse 候选）。",
  },
};

/** 已声明 op 清单（按声明顺序）。 */
export const SCOPE_OPS = Object.keys(DOMAIN_SCOPE);

// ---------- 输入侧缩限：小字母表输入（字符类型数缩限，恒烈 2026-09-29 核心思路） ----------
// 字符级定义域只能回答「输入是否落在我的字符表内」——base64 等大字母表解码器对纯 0/1 串
// 恒「表内」（数字是合法码字），但输入只动用了字母表的 2/64，语义上不可能是正解，只会产出
// 字节噪声（实测 0101011010011110 → base64/base85/分组密码等高分霸榜）。
// 缩限规则：去空白后字符类型数 k ≤ 4 且长度 ≥ 8（位串/点划/双符号替换类输入）时，仅准
// 白名单 op——位串族（把输入当位流解释）+ 对串本身做可见结构/替换变换的 op（换位、逐字移位、
// 双符号映射）；解释型大字母表解码器（base 系/现代密码/文本码）一律拒绝。
// 字母类小字母表输入（如 abababab）不受损：古典移位族在白名单内（对数字串它们是透传 no-op，
// 会被「输出=输入」剪枝自然滤掉）；k ≥ 5 或短串维持现状，常规 hex/text/base 输入零影响。
export const SMALL_ALPHABET_OPS = new Set([
  // 位串族（输入即位流）
  "manchester", "diffManchester", "nrzi", "miller", "fourB5B", "pwmPpm",
  "bcd", "binPad", "graycode", "bitReverse", "bitRotate",
  // 双符号/点划解释
  "morse", "bacon",
  // 对串本身做可见结构变换（换位/逐字移位/通用替换——保字母表，动位置或映射）
  "railFence", "scytale", "caesarBox", "everyN",
  "rot13", "rot18", "rot47", "rot5", "rotSpecial",
  "caesar", "atbash", "affine", "beaufort", "autokey", "gronsfeld",
  "trithemius", "keyboardShift", "vigenere", "porta",
]);

/**
 * 小字母表输入门：命中返回白名单 Set（只准这些 op），未命中返回 null（不启用，走原逻辑）。
 * 每层调用方对当前文本重算，不缓存。
 */
export function smallAlphabetGate(text) {
  const t = String(text == null ? "" : text).replace(/\s+/g, "");
  if (t.length < 8) return null;
  let kinds;
  try { kinds = new Set(t).size; } catch { return null; }
  return kinds <= 4 ? SMALL_ALPHABET_OPS : null;
}

/**
 * 按当前文本重算该 op 的定义域画像（每层调用，不缓存）。
 * 未声明的 op 返回 null。
 * @returns {null | {opId,participants,separators,passthroughs,rejected,rejectedSamples,admit,reason}}
 */
export function scopeEvaluate(opId, text) {
  const d = DOMAIN_SCOPE[opId];
  if (!d) return null;
  const t = String(text == null ? "" : text);
  const part = d.participant;
  const sep = d.separator || null;
  const pass = d.passthrough || null;
  const rej = d.reject || null;
  let participants = 0, separators = 0, passthroughs = 0, rejected = 0;
  const rejectedSamples = [];
  for (const ch of t) {
    if (sep && sep(ch)) { separators++; continue; }
    if (part(ch)) { participants++; continue; }
    if (pass && pass(ch)) { passthroughs++; continue; }
    if (rej && rej(ch)) {
      rejected++;
      if (rejectedSamples.length < 8) rejectedSamples.push(ch);
      continue;
    }
    // 既非四类中任何一类 → 类外字符，计入拒绝
    rejected++;
    if (rejectedSamples.length < 8) rejectedSamples.push(ch);
  }
  let admit, reason;
  if (rejected > 0) { admit = false; reason = "含类外/拒绝字符"; }
  else if (participants === 0) { admit = false; reason = "无参与字符（仅分隔/透传）"; }
  else { admit = true; reason = "通过"; }
  return {
    opId, participants, separators, passthroughs, rejected,
    rejectedSamples, admit, reason,
  };
}

/** 便捷布尔判定：未声明返回 null。 */
export function scopeAdmit(opId, text) {
  const r = scopeEvaluate(opId, text);
  return r ? r.admit : null;
}
