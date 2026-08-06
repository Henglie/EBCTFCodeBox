/*
 * edu-fancy-roar.js — 兽音译者（嗷呜啊~）科普卡（fancy 类）。
 *
 * 覆盖 op：roar
 * 纯数据无副作用，export default 对象照 eduContent.js 头注释契约。
 */
export default {
  roar: {
    what: "兽音译者——把普通文字变成「嗷呜啊~」等 4 个兽语字符的可读加密。与「就这¿/不会吧？」比特流版（本地 yygq op）是两套完全不同的算法：本 op 采用 roar.iiilab.com 的核心编码——每字符 Unicode 码点转 4 位十六进制，按位偏移后用 4 字符 codec 两两映射，最后加前后缀包裹。",
    principle:
      "编码流程（codec 为 4 个不重复字符，默认「嗷呜啊~」）：\n\n" +
      "① 明文中每个字符取其 Unicode 码点，格式化为 4 位十六进制（如 'A' → 0041），拼接成 hex 串；\n" +
      "② 对 hex 串第 s 位（0 起）：取该位十六进制值 n0，加上 s%16（位置偏移），超过 15 则回绕；\n" +
      "③ 结果 n 拆成 商 n//4 与 余 n%4，分别作为 codec 的下标，取两个字符拼成一对（每个 hex 位 → 2 个 codec 字符）；\n" +
      "④ 前缀 t = codec[3]+codec[1]+codec[0]，后缀 codec[2]，密文 = 前缀 + 中间串 + 后缀。\n\n" +
      "解码是编码的逆过程：定位前缀与后缀，取中间段；每 2 个 codec 字符反查下标还原 n = 4*idx1+idx2，再减去位置偏移；4 位 hex 一组还原码点。\n\n" +
      "位置偏移（s%16）是关键：同一 hex 字符出现在不同位置会映射成不同 codec 对，使密文不再按字符边界对齐——这也是它的抗误读设计。",
    usage: "输入框填文本（或密文），codec 参数默认「嗷呜啊~」，可改为任意 4 个不重复字符（如「喵汪哞咩」）。点运行即得密文/明文。双向：encode 生成、decode 还原。",
    examples: [
      { in: "A", param: "codec=嗷呜啊~", out: "~呜嗷嗷嗷嗷呜呜啊呜嗷啊", desc: "单字符：A(0041) → 8 个 codec 字符 + 前后缀" },
      { in: "Hello", param: "codec=嗷呜啊~", out: "~呜嗷嗷嗷嗷呜呜啊啊~呜嗷呜呜~嗷~嗷啊嗷啊呜嗷嗷呜~~嗷~呜呜嗷啊~嗷嗷嗷呜啊嗷嗷啊啊", desc: "5 字符英文往返" },
      { in: "flag", param: "codec=喵汪哞咩", out: "咩汪喵喵喵喵汪哞喵哞汪汪喵汪汪咩喵喵咩哞喵哞汪喵喵咩喵咩喵咩汪汪喵汪哞哞", desc: "自定义 codec" },
    ],
    tips: [
      "看到「嗷呜啊~」或任意 4 字符反复组合的密文，先试本 op（codec 默认值就是这 4 个字）。",
      "与 yygq（就这¿/不会吧？）都是「兽音译者」但算法完全不同：yygq 是 2 token 比特流映射，本 op 是 4 codec hex 偏移映射。同一段密文两个 op 都试。",
      "codec 必须 4 个不重复字符，否则报错。题目的 codec 若藏在提示里，填进去即可解。",
      "解码定位用前缀 codec[3]+codec[1]+codec[0] 和后缀 codec[2]——密文前若被加了别的文本也不影响（取最后一次出现的后缀）。",
      "支持中文：Unicode 码点直接 4 位 hex 编码，无需 UTF-8 字节转换。",
    ],
    aka: ["roar", "兽音译者", "嗷呜啊", "兽语", "嗷呜啊~", "iiilab roar", "roar.iiilab", "兽音", "4字符codec", "兽语翻译", "roar encode", "roar decode", "兽语加密", "喵汪哞咩", "兽语编码", "beast language"],
  },
};
