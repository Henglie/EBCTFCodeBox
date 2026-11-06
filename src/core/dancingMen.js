/*
 * dancingMen.js — 跳舞小人 Dancing Men（福尔摩斯《跳舞的小人》，cat:'classic'）。
 *
 * 原理（照权威来源，未编造）：
 *  - 柯南·道尔 1903 年短篇《The Adventure of the Dancing Men》中的单表替换密码：
 *    每个字母 ↔ 一个特定姿态的小人简笔画；手持小旗的小人表示「词的结束」（词分隔符）。
 *  - 原作五条消息里只出现 18 个不同字母：F/J/K/Q/U/W/X/Z 共 8 个字母在原作中没有符号
 *    （dCode 原文："only 18 different letters appear. 8 letters (FJKQUWXZ) were not used
 *    and therefore have no known symbols"；另注 P 与 V 的符号在原作里几乎相同，流传的
 *    补全版才把两者略微区分）。
 *
 * 本实现的文字 token 表示（重点约定，与猪圈密码 token 描述版同思路）：
 *  - 小人姿态是图形，无任何权威来源给出可逐字复现的文字姿态码（dCode 页面的符号即以
 *    图片呈现，其图片文件即以字母本身命名 char(97..122).png），故本工具的密文 token =
 *    「字母本身 + 可选旗标后缀 *」。即：字母替换层在文本域内按原文字母表恒等呈现
 *    （story 档只有 18 个原作字母，complete 档为流传补全的 26 字母），真正参与编码的
 *    机器可读信息是「词尾旗标 + 空格分词」结构。头注释与 desc 均已声明，不冒充姿态图。
 *  - encode：明文大写化，只保留 A-Z 与空格（其余字符丢弃，连续空格折算为一个）；
 *    flag 档在每个词的末字母后加 "*"，词间以单个空格分隔；noflag 档不加旗标（对应
 *    dCode「旗标缺失但有空格」档）。story 档遇到 F/J/K/Q/U/W/X/Z 明确报错（原作无符号，
 *    不猜）。
 *  - decode：严格互逆——按空白切词，每词只允许在末尾出现一个 "*"，去掉旗标还原字母；
 *    非法 token（空词、"*" 单独成词、词中 "*"、story 档非法字母）显式报错。
 *
 * 权威来源（访问日期均为 2026-09-22）：
 *  - Wikipedia「The Adventure of the Dancing Men」
 *    (https://en.wikipedia.org/wiki/The_Adventure_of_the_Dancing_Men)：
 *    确认单表替换 + 频率分析破译；第五条（最后一条）消息解得 "ELSIE PREPARE TO MEET
 *    THY GOD"，并明言「第一、二次小人举旗表示词的结束，两词都以 e 结尾」（ELSIE 与
 *    PREPARE）。本实现默认参数即复现该消息的旗标结构。
 *  - dCode「Dancing Men Cipher」(https://www.dcode.fr/dancing-men-cipher)：
 *    确认 18 原作字母 / 8 个无符号字母（FJKQUWXZ）/ P≈V 近同形 / 旗标分词三档；
 *    其「补全变体」（互联网流传，来源不明）补齐 26 字母——本实现 complete 档即此口径。
 *  - 故事第一条消息 "AM HERE ABE SLANEY"（维基条目改编作品一节提及同款密文，
 *    dCode 页 FAQ 亦述及 Cubitt 与 Abe Slaney）。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
// 原作 18 字母（A-Z 去 F/J/K/Q/U/W/X/Z，照 dCode 页面口径）。
const STORY_SET = [...AZ].filter((c) => !"FJKQUWXZ".includes(c));

function lettersOf(mode) {
  return mode === "story" ? STORY_SET : [...AZ];
}

function dancingMenEncode(text, variant, flagMode) {
  const allowed = lettersOf(variant);
  const src = String(text == null ? "" : text).toUpperCase();
  const words = src.split(/\s+/).filter(Boolean).map((w) => {
    const letters = [...w].filter((c) => AZ.includes(c));
    return letters.join("");
  }).filter(Boolean);
  if (!words.length)
    throw new Error("跳舞小人：输入不含任何 A-Z 字母。");
  for (const w of words) {
    for (const c of w) {
      if (!allowed.includes(c))
        throw new Error(
          `跳舞小人：字母 ${c} 在原作字母表中没有对应小人（原作仅 18 字母，F/J/K/Q/U/W/X/Z 无符号；可切「补全 26 字母」档）。`
        );
    }
  }
  const flagged = flagMode !== "noflag";
  return words.map((w) => (flagged ? w + "*" : w)).join(" ");
}

function dancingMenDecode(text, variant) {
  const allowed = lettersOf(variant);
  const src = String(text == null ? "" : text).toUpperCase();
  const toks = src.split(/[\s,;]+/).filter(Boolean);
  if (!toks.length)
    throw new Error("跳舞小人：密文为空。");
  const out = [];
  for (const t of toks) {
    if (t === "*")
      throw new Error('跳舞小人：单独的 "*" 不是合法 token（旗标只能缀在词尾字母后）。');
    const m = /^([A-Z]+)(\*?)$/.exec(t);
    if (!m)
      throw new Error(`跳舞小人：token "${t}" 非法（只允许字母，旗标 * 只能出现在词尾）。`);
    for (const c of m[1]) {
      if (!allowed.includes(c))
        throw new Error(
          `跳舞小人：字母 ${c} 不在${variant === "story" ? "原作 18 字母" : "26 字母"}码表内。`
        );
    }
    out.push(m[1]);
  }
  return out.join(" ");
}

register({
  id: "dancingMen", cat: "classic", name: "跳舞小人 Dancing Men",
  desc: "福尔摩斯《跳舞的小人》单表替换：文字 token=字母+词尾旗标*（小人姿态无法文本化，按 dCode 内部标识以字母为本体）；story 档仅原作 18 字母（F/J/K/Q/U/W/X/Z 报错），默认复现 Wikipedia 第五消息 ELSIE PREPARE TO MEET THY GOD 的旗标结构",
  params: [
    { key: "variant", label: "字母表档", type: "select", default: "story",
      options: [
        { value: "story", label: "原作 18 字母（FJKQUWXZ 无符号，出现即报错）" },
        { value: "complete", label: "补全 26 字母（互联网流传变体，dCode 口径）" },
      ] },
    { key: "flags", label: "旗标策略", type: "select", default: "flag",
      options: [
        { value: "flag", label: "词尾小人举旗（token 加 *，原作口径）" },
        { value: "noflag", label: "无旗标，仅空格分词（dCode「旗标缺失」档）" },
      ] },
  ],
  encode: (t, p) => dancingMenEncode(t, (p && p.variant) || "story", (p && p.flags) || "flag"),
  decode: (t, p) => dancingMenDecode(t, (p && p.variant) || "story"),
});

export { dancingMenEncode, dancingMenDecode, STORY_SET };
