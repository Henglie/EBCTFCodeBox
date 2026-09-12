/*
 * edu-t508-b2.js — T508 批二·编码映射 7 op 科普卡（encodingExt3.js）。
 * crockford32 / alienAlphabet / futhark / countingRods / chuckUnary / wingdings / cardanGrille
 * 示例输出全部来自实跑（资料/工程留存/T508/批2_编码映射/test.mjs 同口径），无编造。
 */
export default {
  crockford32: {
    what: "Crockford Base32——Douglas Crockford（JSON 之父）2002 年设计的「人类可读」Base32：专治手抄抄错。5 个符号里挑掉 I/L/O/U 四个易混字母（I L 像数字 1、O 像 0、U 防拼出脏词），解码时还做 o→0、i/l→1 容错。",
    principle:
      "32 符字母表：`0123456789ABCDEFGHJKMNPQRSTVWXYZ`（数字 0-9 + 22 个字母，值即下标）。数据按 5 bit 一组切分（1 字符 5 位，不足补零），与 RFC 4648 Base32 同构但无 padding。\n\n" +
      "可选校验位：把全部字节按大端拼成整数 $N$，附加符号 $= N \\bmod 37$（37 是大于 32 的最小素数）。值 32-36 用五个专用符号 `* ~ $ = U` 表示——U 虽被排除出数据字母表，却以校验值 36 的身份回归。\n\n" +
      "连字符 `-` 只是可读分组，解码一律忽略；大小写不敏感。",
    usage: "默认就是纯 Base32 传输；要防抄错就开「校验位」开关（收发双方都要开）。位流与本项目 Base32 op 的 crockford 档完全同口径——那边没有的校验位和连字符规约在这里。",
    examples: [
      { in: "Hello", out: "91JPRV3F", desc: "5 字节 40 bit 恰好 8 组符号" },
      { in: "Hello", param: "开校验位", out: "91JPRV3FG", desc: "0x48656C6C6F mod 37 = 16 → 追加 G" },
      { in: "91JPRV3FG", param: "开校验位解密", out: "Hello", desc: "校验通过后还原" },
    ],
    tips: [
      "密文里出现 U 十有八九是校验符——非校验档下 U 直接报错（它不在数据字母表）。",
      "校验位能检出单个错符号和相邻换位错误（mod 37 素数校验的功劳），但没开校验就别怪工具。",
      "Crockford 原页没有编码示例，本卡输出为实跑值；与 RFC 4648 Base32 的区别详见字母表——别混用。参考 https://www.crockford.com/base32.html 。",
    ],
    aka: ["crockford", "crockford base32", "Crockford Base32", "base32 crockford", "克罗克福德", "克罗克福德 base32", "crockford 编码", "crockford 解码", "crockford32", "base32 校验位", "人类可读 base32", "crockford base 32"],
  },

  alienAlphabet: {
    what: "外星字母——流行文化版「外星文」：26 个拉丁字母逐一换成 26 个长相科幻的 Unicode 符号（⏃⏚☊⎅…，多取自杂项技术符号区 U+2300 与 APL 符号）。CTF 里 ⏃⌰⟟⟒⋏ 一出现就是它。",
    principle:
      "unicode 档（dCode 成文表）：一一替换，如 A=⏃(U+23C3)、L=⌰(U+2330)、Z=⋉(U+22C9)。非字母原样保留。\n\n" +
      "futurama2 档（Futurama AL2「自修改字母表」的字母级实现）：每个符号带数值 A=0…Z=25，加密是自密钥移位——\n\n" +
      "$$C_1 = P_1, \\quad C_i = (P_i + C_{i-1}) \\bmod 26$$\n\n" +
      "即每个字母加上「前一个密文字母」的值；解密 $P_i = (C_i - C_{i-1} + 26) \\bmod 26$。密钥就是密文自身，故相邻两个相同符号必然解出后者为 A（差为 0）。",
    usage: "unicode 档直接粘字母编解码；futurama2 档输出的是移位后的字母流（剧中原字形是图片/专用字体，没有 Unicode 编码——别处也查不到标准码位）。",
    examples: [
      { in: "DCODE", out: "⎅☊⍜⎅⟒", desc: "dCode 官方例" },
      { in: "⏃⌰⟟⟒⋏", out: "ALIEN", desc: "dCode 页面标题例，反向" },
      { in: "FUTURAMA", param: "futurama2 档", out: "FZSMDDPP", desc: "dCode AL2 官方例（自密钥移位）" },
    ],
    tips: [
      "Futurama 剧中的 AL1/AL2 原字形只有图片与爱好者字体，Unicode 档用的是 dCode 唯一成文的 Unicode 对照表。",
      "AL2 档识别窍门：连续相同符号的后者必为 A；角形符号多、波浪形少。",
      "S2E14「Bender Gets Made」等多集片头背景招牌藏着 AL1 彩蛋（Drink Slurm、Venusians Go Home）。参考 https://www.dcode.fr/alien-language 。",
    ],
    aka: ["外星字母", "外星文", "外星语", "alien alphabet", "alien language", "alienese", "futurama alien", "futurama alphabet", "AL1", "AL2", "外星符号", "alien language decoder", "alien text"],
  },

  futhark: {
    what: "卢恩符文（Futhark）——古日耳曼字母，取前六符 f-u-th-a-r-k 得名。2 世纪的老弗萨克 24 符，维京时代精简成新弗萨克 16 符（音位合并），符文块在 Unicode U+16A0–16FF。",
    principle:
      "elder 档 24 符标准序：ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ。英语 A-Z 按 dCode 实用映射：C/K/Q→ᚲ、V/W→ᚹ、J/Y→ᛃ（同音合流），X 没有专属卢恩按 ᚲᛊ(ks) 连写；TH→ᚦ、NG→ᛜ 双字母组（词首词中常见，如 THING→ᚦᛁᛜ）。\n\n" +
      "younger 档 16 符长枝形 fuþąrkhniastbmlʀ：ᚠᚢᚦᚬᚱᚴᚼᚾᛁᛅᛋᛏᛒᛘᛚᛦ。音位合并更狠——E/I→ᛁ、O→ᚬ、A→ᛅ、G/K→ᚴ、D/T→ᛏ、P/B→ᛒ、V/W/Y→ᚢ，同一个符文代表一族音。\n\n" +
      "解码容错：elder 的 ᛋ/ᛝ 变体、younger 的全部短枝形（ᚭᚽᚿᛆᛌᛐᛓᛙᛧ）都认。",
    usage: "选 elder/younger 后直接粘英文编、粘符文解。注意编码有损：C 编成 ᚲ 解回是 K（多字母合流是文字史实，不是 bug）——要严格往返请选无合流的字符集。",
    examples: [
      { in: "FUTHARK", out: "ᚠᚢᚦᚨᚱᚲ", desc: "elder：字母表自名（TH 触发双字母组）" },
      { in: "FUTHARK", param: "younger 档", out: "ᚠᚢᚦᛅᚱᚴ", desc: "16 符长枝形（A→ᛅ ár、K→ᚴ kaun）" },
      { in: "HELLO", param: "younger 档", out: "ᚼᛁᛚᛚᚬ", desc: "E/I 合流→ᛁ、O→ᚬ（解回 HILLO，属预期）" },
    ],
    tips: [
      "看到 ᚠᚢᚦ 开头的角形符号串就是卢恩；24 符多为 elder（大陆/早期），16 符多为 younger（维京铭文）。",
      "TH/NG 双字母组默认开启（THING→ᚦᛁᛜ 才是音译正解），要逐字母硬翻可关掉。",
      "ᛦ（ýr/ʀ）是 younger 特有的收尾符，解回 R；elder 的 ᛇ(ï) 解回 Ï。参考 https://www.dcode.fr/vieux-futhark 。",
    ],
    aka: ["futhark", "futhorc", "卢恩", "卢恩符文", "如尼文", "如尼字母", "runes", "elder futhark", "younger futhark", "老弗萨克", "新弗萨克", "runic alphabet", "维京字母"],
  },

  countingRods: {
    what: "算筹数字——春秋至明代中国人摆小棍子算数/记数的记数法（《孙子算经》：「一纵十横，百立千僵」）。Unicode 在 U+1D360 起专门编码了纵横两式 1-9 和〇。",
    principle:
      "纵式 𝍩-𝍱（U+1D369-1D371）与横式 𝍠-𝍨（U+1D360-1D368）按位交替：从右往左，奇位（个、百、十万…）用纵式，偶位（十、千…）用横式——相邻位形态不同，摆盘不混。0 用〇（U+3007；更早是空位）。\n\n" +
      "所以 231 = 纵2横3纵1 → 𝍪𝍢𝍩；5089 = 横5〇横8纵9 → 𝍤〇𝍧𝍱。",
    usage: "输入十进制数字串（空格分隔可编多个数），输出算筹符文；解密粘符文（横纵两式任意混排都认，0 兼容〇）。负数/小数不支持（古人用红黑棍表正负，Unicode 里那是组合符号，从简）。",
    examples: [
      { in: "231", out: "𝍪𝍢𝍩", desc: "Wikipedia 官方例：纵2 横3 纵1" },
      { in: "5089", out: "𝍤〇𝍧𝍱", desc: "Wikipedia 官方例：横5 〇 横8 纵9" },
      { in: "71824", out: "𝍯𝍠𝍰𝍡𝍤", desc: "Wikipedia 官方例（《永乐大典》数码）" },
    ],
    tips: [
      "dCode 的 code-chinois 页是另一个东西（童子军木棍密码，按元音辅音计数），和算筹无关——别被名字骗了。",
      "识别特征：只由 𝍠-𝍱 和〇组成；最高位的纵横形态能反推位数奇偶。",
      "古算书里 4/5/9 的写法宋以后有变形，Unicode 收的是标准形。参考 https://en.wikipedia.org/wiki/Counting_rods 。",
    ],
    aka: ["算筹", "算筹数字", "算筹记数", "筹算", "counting rods", "rod numerals", "rod calculus", "一纵十横", "纵横相间", "chinese counting rods", "算筹符号", "算筹编码", "unicode 算筹"],
  },

  chuckUnary: {
    what: "Chuck Norris 一元码——Codingame 经典谜题带火的「只有 0 的二进制」：信息全靠 0 的个数表达，Chuck Norris 一拳一个 1，所以密文里没有 1。",
    principle:
      "每个字符转 7 位（可选 8 位）ASCII，整条位流连起来做游程编码：\n\n" +
      "- 连续 $N$ 个 1 → 组「0」+ 组「$N$ 个 0」\n" +
      "- 连续 $N$ 个 0 → 组「00」+ 组「$N$ 个 0」\n\n" +
      "组与组之间空格分隔，字符之间没有分隔（游程跨界合并——1000011+1000011 中间的 11 和 1 并成一个 111 游程）。解码按组对还原位流再按宽度切字符。",
    usage: "默认 7 位宽度（dCode/Codingame 口径），密文若解不动换 8 位试试。密文只含 0 和空白，其他字符一律报错。",
    examples: [
      { in: "CC", out: "0 0 00 0000 0 000 00 0000 0 00", desc: "位流 10000111000011：1|0000|111|0000|11 五游程" },
      { in: "%", out: "00 0 0 0 00 00 0 0 00 0 0 0", desc: "0100101 六游程" },
      { in: "0 0 00 0000 0 000 00 0000 0 00", out: "CC", desc: "反向" },
    ],
    tips: [
      "识别特征：纯 0 + 空格，且组数是偶数（前缀组与数量组成对出现）。",
      "位流长度必须是宽度的倍数——7 位档解不动时十有八九是 8 位档。",
      "0 字符可换成任何字符、ASCII 可换成别的编码（A1Z26 等），本工具按 dCode 原口径实现。参考 https://www.dcode.fr/code-chuck-norris 。",
    ],
    aka: ["chuck norris", "chuck norris code", "chuck norris unary", "一元码", "一元编码", "unary code", "unary coding", "codingame unary", "0 00 编码", "norris 密码", "unary cipher", "二进制游程码"],
  },

  wingdings: {
    what: "Wingdings——微软 1990 年代的符号字体：键盘字母排的全是手势、星座、宗教符号和小图标。字体的 Unicode cmap 把 224 个字形映射在 U+F020-F0FF 私用区（本机 wingding.ttf 实测），现代系统又给多数字形定了真实码位（☺✈☠…）。",
    principle:
      "两种码位模式：\n" +
      "- pua 档：字符码 + $\\mathrm{0xF000}$（J→U+F04A）。装了 Wingdings 字体才能看到图形，但严格 1:1 往返（Word 转符号文本就是这个表示）。\n" +
      "- unicode 档：换成真实码位（J→☺ U+263A、Q→✈、N→☠、M→💣），普通字体可见。表据 Alan Wood 字体演示页（0x20-0x7E 全 95 槽）+ Adobe ZapfDingbats 编码（zapf 档，unicode.org 官方映射文件）。\n\n" +
      "四字体档：wingdings1（杂烩图标）/ wingdings2（圈勾序号）/ wingdings3（箭头族）/ zapf（Dingbats 花饰）。只映射可见 ASCII 0x20-0x7E，核实不到的码位不硬造。",
    usage: "解 CTF 图片题：对照字形查出字母再粘进来解；或把明文转符号恶搞。unicode 档在 W2 下 T/W、S/X 同码（字体本身重复），解回取前者。",
    examples: [
      { in: "JQNZ", out: "☺✈☠☪", desc: "经典位：J=笑脸 Q=飞机 N=骷髅 Z=星月" },
      { in: "HI", out: "☟🖐", desc: "H=下指手 I=张开的手掌" },
      { in: "Hello", param: "zapf 档", out: "★❅●●❏", desc: "Zapf Dingbats：H=★ e=❅ l=● o=❏" },
    ],
    tips: [
      "「Q33 NY」是 2001 年的都市骗局——Q33NY 并非世贸航班号；NYC 在 Webdings 里才是「眼♥城市」梗。",
      "Outlook 邮件里的 J 就是 Wingdings 笑脸 ☺（富文本口音未消的化石）。",
      "pua 档粘到没装字体的环境会显示豆腐块；要发给别人看就用 unicode 档。参考 https://en.wikipedia.org/wiki/Wingdings 。",
    ],
    aka: ["wingdings", "wingdings 字体", "wingdings 2", "wingdings 3", "符号字体", "dingbat", "dingbats", "zapf dingbats", "wingdings translator", "wingdings 解码", "wingdings 转换", "webdings"],
  },

  cardanGrille: {
    what: "卡丹格（Cardan Grille）——Cardano 1550 年的掩模隐写：一张打了孔的纸板盖在纸上，秘密只写进孔里，空处再填满掩护字。收信人拿同样的纸板一盖，秘密现形。与旋转 4 次的「转动格栅」是两回事——卡丹格不旋转。",
    principle:
      "掩模是一串任意长度的 `X`（实格）与 `_`（孔）。\n" +
      "- fill 档（dCode 主形态）：明文逐字填入孔位，实位填随机大写字母（种子可控）或自定填充串循环。\n" +
      "- hide 档（Richelieu 红衣主教形态）：明文入孔位，掩护文本依序补满实位，多余掩护文丢弃——产出一段「看起来正常」的文本。\n\n" +
      "解密：掩模逐格盖在等长密文上，取孔位字符即明文。密文比明文长得多是它的识别特征；没有掩模几乎不可破（可用疑似词估孔密度暴力）。",
    usage: "填掩模串（任意长度，不要求方形），fill 档给种子或 filler；hide 档给够长的掩护文本。解密只需掩模 + 等长密文。",
    examples: [
      { in: "OESDVBCNEOHDEEML", param: "掩模 XXX_XX_XX_X_X_XX", out: "DCODE", desc: "dCode 官方解密例" },
      { in: "DCODE", param: "同掩模 fill 档种子 7", out: "PSNLCADCJCMCOCBOKOVDLKCSOEEFOJ", desc: "秘密入孔、随机字母补实位（同种子可复现）" },
      { in: "DCODE", param: "hide 档 + 掩护文 THEQUICKBROWN", out: "THEDQUCICOKDBERO", desc: "掩模位拼出 THE DUC… 一段「正常」英文" },
    ],
    tips: [
      "密文长度必须等于掩模长度——掩模逐格对齐是全部前提。",
      "hide 档选掩护文要贴合语境（情书、公文），红衣主教当年就是这么审改信件的。",
      "没有掩模时可用 probable-word 攻击估孔率；有掩模就秒解。参考 https://www.dcode.fr/grille-cardan 。",
    ],
    aka: ["卡丹格", "卡丹格栅", "卡达诺格栅", "cardan grille", "grille de cardan", "cardano grille", "卡丹密码", "掩模密码", "格栅密码", "掩格", "cardan mask", "grille cipher", "卡达诺密码"],
  },
};
