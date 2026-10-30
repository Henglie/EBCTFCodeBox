/*
 * edu-pipAstro.js — 符号记数组科普卡（astroSymbols.js / pipNumerals.js）。
 * astroSymbols（天文/黄道符号）· pipNumerals（点数记数：骰面/骨牌）
 * 示例输出全部来自四路双向验收实跑（权威源 = CPython unicodedata 按字符名反查），无编造。
 */
export default {
  astroSymbols: {
    what:
      "天文 / 黄道符号 —— 把天体与星座的英文名写成 Unicode 标准符号：SUN → ☉、MOON → ☽、MARS → ♂，" +
      "黄道十二宫 ARIES→♈ … PISCES→♓。它是一张「名称 ↔ 单个符号字符」的映射表，CTF 里见到一串 " +
      "♀♁♂♃♄ 混排的密文时用它还原出英文明文。",
    principle:
      "映射依据是 The Unicode Standard 字符数据库里的**字符官方名称**：每个符号的码位由其 Unicode 名称唯一确定" +
      "（如 U+2609 名为 SUN、U+263D 名为 FIRST QUARTER MOON、U+2648–U+2653 连续十二位即黄道十二宫）。\n\n" +
      "两处名称与通行天文名不一致，本工具如实按 Unicode 名称登记、不做改写：U+2640 官方名是 FEMALE SIGN" +
      "（通行天文名金星 Venus）、U+2642 官方名是 MALE SIGN（通行天文名火星 Mars）——二者是天文与性别两义共用的" +
      "同一枚字符，这是 Unicode 的既有事实。\n\n" +
      "契约：encode 按「连续字母」切词，整词必须是当前档的英文名（大小写不敏感），未知名与缩写显式报错，" +
      "不猜缩写；标点与空白原样透传。decode 按字符扫描：命中本档符号 → 输出规范英文名（大写）；" +
      "命中另一档符号 → 报错提示换档；外来符号（如 ★）→ 报错。同一天体的多个历史字形（如 ☀☼ 都是太阳、" +
      "☽☾ 两个半月相、⛢ 与 ♅ 同为天王星）在解码侧互为别名。",
    usage:
      "encode 输入英文名文本（可含标点）→ 输出符号串；decode 粘贴符号串 → 输出大写英文名。" +
      "先选符号集：行星系（☉☽☿♀♁♂♃♄♅♆♇ + 谷神/智神/婚神/灶神四颗小行星）或黄道十二宫。" +
      "解不出先查是否拿错了档（行星符号放进黄道档会明确提示换档）。",
    examples: [
      { in: "SUN MOON MARS", param: "行星系", out: "☉ ☽ ♂", desc: "四路验收 ①②③④ 全过" },
      { in: "☉ ☽ ♂", param: "行星系·解码", out: "SUN MOON MARS", desc: "别名 ☀☼→SUN、☽☾→MOON 亦通" },
      { in: "Sun, Moon / Mars", param: "行星系", out: "☉, ☽ / ♂", desc: "标点与空白原样透传" },
      { in: "☉, ☽ / ♂", param: "行星系·解码", out: "SUN, MOON / MARS", desc: "含标点输入可逆" },
      { in: "LEO VIRGO LIBRA", param: "黄道十二宫", out: "♌ ♍ ♎", desc: "十二宫档" },
      { in: "CAPRICORN AQUARIUS SAGITTARIUS", param: "黄道十二宫", out: "♑ ♒ ♐", desc: "解码输出规范大写名" },
    ],
    tips: [
      "密文全是 ♀♁♂♃♄♅♆♇ 一类「行星符号」或 ♈–♓ 十二宫符号时优先试本工具；解不出先换档再查拼写。",
      "U+2640/U+2642 同时是性别符号：密文里 ♀♂ 混排既可能是天文密文也可能是性别记号，按上下文判断。",
      "本工具只做名称↔符号映射，不做生辰→星座推算（那不是编解码能力）。",
      "缩写（如 MER）与拼写变体（如 VENUSX）一律拒绝——不编造 IAU 缩写映射。",
      "权威依据：The Unicode Standard 字符数据库（本机 CPython unicodedata 实测 15.1.0），按字符名反查码位独立重建映射。",
    ],
    aka: [
      "astro symbols", "astronomical symbols", "zodiac symbols", "planetary symbols",
      "天文符号", "黄道符号", "星座符号", "行星符号", "太阳月亮符号", "alchemical symbols",
      "planet emojis", "horoscope symbols", "十二宫符号", "占星符号", "venus mars symbols",
    ],
  },

  pipNumerals: {
    what:
      "点数记数 —— 用「骰面 / 骨牌」符号表示数字：骰面档把 1–6 写成 ⚀⚁⚂⚃⚄⚅，骨牌档把两位数字对（0–6）写成" +
      "一枚多米诺骨牌字符（🀱🀲🀹 这类）。见到底牌/骰子风格的花色密文时用它还原出数字串。",
    principle:
      "映射依据是 Unicode 字符官方名称里的点数语义：U+2680–U+2685 官方名为 DIE FACE-1 … DIE FACE-6" +
      "（骰面 1–6 点），一人一码；骨牌块 U+1F031 起官方名为 DOMINO TILE HORIZONTAL-00…（横向）与" +
      " DOMINO TILE VERTICAL-00…（竖向），名称中的两个数字即牌面上下（左右）两半的点数，各自取 0–6，" +
      "共 28 块（7×7 去重后全组合）。\n\n" +
      "契约：骰面档逐位编码十进制数字，遇 0 或 7–9 显式报错（骰面没有 0 点与 7 点以上）；" +
      "骨牌档每两位数字为一块，奇数长度报错，每位取 0–6，越界报错；空白、逗号、斜杠、竖线、括号等分隔符透传；" +
      "骨牌背面字符（U+1F030 系）与朝向不符的字符解码时报错。",
    usage:
      "先选符号系统：骰面（1–6，每位一枚）或骨牌（每两位一块）；骨牌档再选横排/竖排朝向。" +
      "encode 输入数字串 → 输出符号；decode 粘贴符号 → 输出数字串。解不出时检查：骰面档是否混入了 0/7–9、" +
      "骨牌档数字是否越界（0–6 之外）、朝向是否选反。",
    examples: [
      { in: "123456", param: "骰面", out: "⚀⚁⚂⚃⚄⚅", desc: "每位一枚骰面" },
      { in: "⚅⚄⚁⚃⚂⚀", param: "骰面·解码", out: "652431", desc: "往返无损" },
      { in: "00 01 11", param: "骨牌·横排", out: "🀱 🀲 🀹", desc: "两位数字一块牌" },
      { in: "🁡 🀺 🁊", param: "骨牌·横排·解码", out: "66 12 34", desc: "朝向选对才解得出" },
      { in: "012345", param: "骨牌·横排", out: "🀲🁂🁒", desc: "无分隔符亦可" },
    ],
    tips: [
      "密文由 ⚀–⚅ 六枚骰面构成 → 骰面档；由 🀰–🁫 一类骨牌块构成 → 骨牌档（注意横竖朝向）。",
      "骰面没有 0：数字串里出现 0 时骰面档必然报错，先补位或换骨牌档。",
      "骨牌档每个符号承载两位信息（0–6），密度高于骰面档的每位一枚。",
      "四路验收的权威源是 CPython unicodedata 按 Unicode 字符名反查的独立映射，与本实现不同源互证。",
      "本工具是「数字 ↔ 符号」的字符集映射，不是骰子/骨牌游戏模拟器。",
    ],
    aka: [
      "pip numerals", "dice numerals", "die face symbols", "domino tiles", "domino numerals",
      "骰面记数", "骨牌记数", "点数符号", "骰子符号", "多米诺骨牌", "die face", "domino tile symbols",
      "dice cipher", "骨牌密码", "骰子密码",
    ],
  },
};
