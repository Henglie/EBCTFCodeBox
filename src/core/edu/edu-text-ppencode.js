/*
 * edu-text-ppencode.js — ppencode 编码科普卡（text 类）。
 *
 * 覆盖 op：ppencode
 * 纯数据无副作用，export default 对象照 eduContent.js 头注释契约。
 */
export default {
  ppencode: {
    what: "ppencode——Perl 关键字编码（PPEncode）。把任意字节流编成一段「看起来像 Perl 程序」的文本：由 Perl 关键字（abs/ord/uc/print…）拼成，开头是 `#!/usr/bin/perl -w`。CTF 里见到整页 perl 关键字乱码，多半是它。",
    principle:
      "每个原始字节从预生成字典中随机挑一个「候选」：候选是一串 Perl 关键字（2~45 个），关键字按内置 256 词表排号（下标即字典序序号），整串作为 chr 的参数链。输出结构：\n\n" +
      "`#!/usr/bin/perl -w` + 随机前缀 + `and print chr <候选词> and print chr <候选词> ...`\n\n" +
      "同一字节有 3 个不同候选（多对冗余），编码时随机选，所以同一原文每次编码结果不同。解码逆向：`chr` 后的关键字序列查 768 项反向表还原原始字节，再按 UTF-8 解出文本。",
    usage: "encode：输入文本，输出 perl 关键字伪程序（UTF-8 字节流逐字节编码，中文可用）。decode：粘贴 perl 关键字文本，还原原文。",
    examples: [
      { in: "hi", param: "", out: "#!/usr/bin/perl -w\\n<关键字串> and print chr ...", desc: "每次输出不同（随机候选）" },
      { in: "flag{...}", param: "", out: "关键字伪程序", desc: "decode 还原原文" },
    ],
    tips: [
      "看到 `#!/usr/bin/perl -w` 开头 + 全篇 perl 函数名（ord/uc/q/chr）拼成的字符串 → ppencode。",
      "与 aaencode/jjencode（JS 符号编码）区分：ppencode 全是 perl 关键字，aaencode 是 `ﾟωﾟﾉ` 表情符号、jjencode 是 `$=~[]` 符号。",
      "开头的随机前缀无意义，decode 自动丢弃；真正的数据在 `and print chr` 之后。",
      "编码是 UTF-8 字节流：中文按 3 字节编码，还原后无损。",
    ],
    aka: ["ppencode", "perl编码", "perl关键字", "PPEncode", "perl混淆", "perl keyword encoding", "perl程序编码", "ppenc", "perl伪程序", "关键字编码"],
  },
};
