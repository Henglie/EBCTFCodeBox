/*
 * hieroglyphs.js — 圣书体字母映射（Manuel de Codage 单字母符子集，cat:'fancy'）。
 *
 * 原理（照权威来源，未编造）：
 *  - Manuel de Codage（MdC）是埃及圣书体的标准机读转写法。数千符号中只有
 *    一小群「单字母符（unilittéral）」= 一个符号对一个字母。dCode 页面声明
 *    "Cet outil se limite aux glyphes unilittéraux (1 symbole = 1 lettre)"，
 *    编码表 20 字母、解码表 30 个字形（含变体）。
 *  - 编码表（dCode 页面原文，20 字母——C/E/J/O/U/V 无字形，dCode 原文
 *    "il n'est donc pas possible de coder les mots qui comportent les
 *    lettres C,E,J,O,U,V"；码点逐条核对）：
 *    A𓄿U+1313F B𓃀U+130C0 D𓂧U+130A7 F𓆑U+13191 G𓎼U+133BC H𓉔U+13254
 *    I𓇋U+131CB K𓎡U+133A1 L𓃭U+130ED M𓅓U+13153 N𓈖U+13216 P𓊪U+132AA
 *    Q𓈎U+1320E R𓂋U+1308B S𓋴U+132F4 T𓏏U+133CF W𓅱U+13171 X𓐍U+1340D
 *    Y𓇌U+131CC Z𓊃U+13283
 *  - 解码表（dCode 页面原文，30 字形；变体字形同归一个字母，输出统一大写）：
 *    𓄿A 𓇋i 𓏭y 𓇌y 𓂝a 𓅱w 𓏲W 𓃀b 𓊪p 𓆑f 𓅓m 𓐝M 𓈖n 𓋔N 𓂋r 𓃭l
 *    𓉔h 𓎛H 𓐍x 𓄡X 𓊃z 𓋴s 𓈙S 𓈎q 𓎡k 𓎼g 𓏏t 𓍿T 𓂧d 𓆓D
 *    （dCode 原表大小写混排——小写为 MdC 细分变体；本 op 输出统一大写字母，
 *     已在 desc 声明。变体字形：𓏭U+133ED/𓇌U+131CC→Y、𓂝U+1309D→A、
 *     𓏲U+133F2→W、𓐝U+1341D→M、𓋔U+132D4→N、𓎛U+1339B→H、𓄡U+13121→X、
 *     𓈙U+13219→S、𓍿U+1337F→T、𓆓U+13193→D）
 *  - dCode 页面例（逐字复现，例图文件名即字符码点）：SPHINX →
 *    𓋴𓊪𓉔𓇋𓈖𓐍（char(78580)(78506)(78420)(78283)(78358)(78861) 十进制）；
 *    ankh 四符号 = 𓄿𓈖𓎡𓉔 → "ankh"。
 *
 * 约定（如实登记）：
 *  - encode：大写化后逐字母映射；C/E/J/O/U/V 显式报错（dCode 口径，无字形不猜）；
 *    非字母字符（空格、标点、数字）原样保留。
 *  - decode：30 字形 → 大写字母；其余字符原样保留。输出统一大写（dCode 原表
 *    大小写混排是转写学细分，字母级无歧义）。
 *  - 省略并登记：MdC 的双字母/三字母符（bilittéral/trilittéral）、限定符
 *    （determinative）与音补——dCode 页面明确只做单字母符，本 op 同口径。
 *
 * 契约：encode/decode 原样交反向；无 emoji（圣书体字符是 unicode 文字符号）。
 *
 * 权威来源（访问日期均为 2026-09-22）：
 *  - dCode「Hiéroglyphes (Manuel de Codage)」
 *    https://www.dcode.fr/hieroglyphes-manuel-de-codage
 *    （20 字母编码表、30 字形解码表、SPHINX/ankh 例、C,E,J,O,U,V 不可编说明）。
 *  - Unicode 字符名内嵌 Gardiner 编号（编码 20 字形依次 G001/D058/D046/I009/
 *    W011/O004/M017/V031/E023/G017/N035/Q003/N029/D021/S029/X001/G043/AA001/
 *    M017A/O034，本机 unicodedata 逐一核对），与 Wikipedia「Transliteration
 *    of Ancient Egyptian」单字母符集合一致（调研交叉核对）。
 */
import { register } from "./registry.js";

// 编码表：20 字母 → 码点（dCode 原文顺序）。
const HIERO_ENC = {
  A: 0x1313f, B: 0x130c0, D: 0x130a7, F: 0x13191, G: 0x133bc, H: 0x13254,
  I: 0x131cb, K: 0x133a1, L: 0x130ed, M: 0x13153, N: 0x13216, P: 0x132aa,
  Q: 0x1320e, R: 0x1308b, S: 0x132f4, T: 0x133cf, W: 0x13171, X: 0x1340d,
  Y: 0x131cc, Z: 0x13283,
};
const HIERO_MISSING = ["C", "E", "J", "O", "U", "V"]; // dCode：无单字母字形
// 解码表：30 字形码点 → 字母（dCode 原表，变体归并，输出大写）。
const HIERO_DEC = {
  0x1313f: "A", 0x1309d: "A", // 𓄿 vautour / 𓂝 前臂
  0x131cb: "I", 0x133ed: "Y", 0x131cc: "Y", // 𓇋 苇叶 / 𓏭 / 𓇌 双苇
  0x13171: "W", 0x133f2: "W", // 𓅱 鹌鹑 / 𓏲
  0x130c0: "B", 0x132aa: "P", 0x13191: "F",
  0x13153: "M", 0x1341d: "M", // 𓅓 枭 / 𓐝
  0x13216: "N", 0x132d4: "N", // 𓈖 水 / 𓋔
  0x1308b: "R", 0x130ed: "L",
  0x13254: "H", 0x1339b: "H", // 𓉔 棚 / 𓎛
  0x1340d: "X", 0x13121: "X", // 𓐍 / 𓄡
  0x13283: "Z", 0x132f4: "S", 0x13219: "S", // 𓊃 / 𓋴 折布 / 𓈙
  0x1320e: "Q", 0x133a1: "K", 0x133bc: "G",
  0x133cf: "T", 0x1337f: "T", // 𓏏 饼 / 𓍿
  0x130a7: "D", 0x13193: "D", // 𓂧 手 / 𓆓 角蝰
};
const HIERO_REV = new Map(Object.entries(HIERO_DEC).map(([cp, l]) => [Number(cp), l]));

function hieroEncode(text) {
  const src = String(text == null ? "" : text).toUpperCase();
  let out = "", letters = 0;
  for (const ch of src) {
    if (/[A-Z]/.test(ch)) {
      const cp = HIERO_ENC[ch];
      if (cp == null)
        throw new Error(
          `圣书体：字母 ${ch} 没有单字母符（dCode 口径：C/E/J/O/U/V 无字形；Manuel de Codage 仅 20 个单字母符）。`
        );
      out += String.fromCodePoint(cp);
      letters++;
    } else {
      out += ch; // 空格/标点等原样
    }
  }
  if (!letters) throw new Error("圣书体：输入不含任何可编码字母（A-Z）。");
  return out;
}

function hieroDecode(text) {
  const src = String(text == null ? "" : text);
  if (!src.trim()) throw new Error("圣书体：密文为空。");
  let out = "";
  for (const ch of src) {
    const l = HIERO_REV.get(ch.codePointAt(0));
    out += l || ch;
  }
  return out;
}

register({
  id: "hieroglyphs", cat: "fancy", name: "圣书体字母 MdC",
  desc: "拉丁字母 ↔ 埃及圣书体单字母符（Manuel de Codage，dCode 口径）：20 字母可编（A B D F G H I K L M N P Q R S T W X Y Z），C/E/J/O/U/V 无字形报错；解码收 30 字形（含 𓏭𓂝𓏲𓐝𓋔𓎛𓄡𓈙𓍿𓆓 变体）统一输出大写；SPHINX→𓋴𓊪𓉔𓇋𓈖𓐍",
  params: [],
  encode: hieroEncode,
  decode: hieroDecode,
  detect: (t) => {
    const chars = [...t.replace(/\s/g, "")];
    if (chars.length < 3 || chars.length > 200) return 0;
    const inBlock = chars.filter((c) => {
      const cp = c.codePointAt(0);
      return cp >= 0x13000 && cp <= 0x1342f;
    }).length;
    if (inBlock === 0 || inBlock < chars.length * 0.5) return 0;
    const known = chars.filter((c) => HIERO_REV.has(c.codePointAt(0))).length;
    return known >= inBlock * 0.5 ? 0.3 : 0;
  },
});

export { hieroEncode, hieroDecode, HIERO_ENC, HIERO_DEC, HIERO_MISSING };
