// 科普内容分片：radix 时间家族 12 op（外部4）。纯数据，无 import 无副作用。
// 覆盖 timestamp/unixTime/filetime/hfsTime/cocoaTime/dosDateTime/chineseDate/
// tzConvert/julianDate/excelDate/chromeTime/snowflakeId。示例值均照算法实算，非编造。
export default {
  timestamp: {
    what: "最常见的「时间戳 ↔ 人类时间」互转小工具。时间戳就是从 1970-01-01 那一刻起走过的秒数（或毫秒数）。",
    principle:
      "计算机不爱存「2021年1月1日」这种字符串，改存一个大整数：从 `1970-01-01T00:00:00Z`（Unix 纪元）到现在走过了多少秒。\n\n" +
      "本工具的 `auto` 会看数字大小自动判断单位：10 位数左右当秒，13 位数左右当毫秒。方向也能自动猜——给数字就转成时间，给时间就转成数字。",
    usage: "方向选 `auto` 自动判断；也可强制「时间戳→时间」或「时间→时间戳」。输入一个整数或一个日期串即可。",
    examples: [
      { in: "1609459200", out: "2021-01-01（UTC）", desc: "10 位当秒" },
      { in: "2021-01-01", out: "1609459200", desc: "反向" },
    ],
    tips: [
      "10 位数≈秒（到 2286 年前都是 10 位），13 位数≈毫秒，一眼可分。",
      "看到 `16xxxxxxxx` 这种 10 位数字，几乎就是 2020 年前后的 Unix 秒级时间戳。",
    ],
    aka: ["timestamp", "unix时间戳", "时间戳转换", "epoch time", "时间戳", "unix time", "秒级时间戳", "毫秒时间戳", "epoch转时间", "时间戳互转"],
  },

  unixTime: {
    what: "Unix 时间戳和标准 ISO8601 时间的精确互转，比 timestamp 多了微秒单位和更严格的格式。",
    principle:
      "同样以 `1970-01-01T00:00:00Z` 为零点，但这里让你显式选单位：秒 / 毫秒 / 微秒。`auto` 按数值范围判断——小于 $10^{10}$ 当秒，小于 $10^{13}$ 当毫秒，再大当微秒。\n\n" +
      "输出统一是 ISO8601 的 UTC 格式（带 `Z` 后缀），如 `2021-01-01T00:00:00Z`。",
    usage: "选单位（默认 auto）。编码方向把 ISO 时间转成时间戳，解码方向把时间戳转回 ISO 时间。",
    examples: [
      { in: "2021-01-01T00:00:00Z", param: "unit=sec", out: "1609459200", desc: "编码：时间→秒" },
      { in: "1609459200", param: "unit=auto", out: "2021-01-01T00:00:00Z", desc: "解码：秒→时间" },
    ],
    tips: [
      "毫秒时间戳（13 位）常见于 JS 的 `Date.now()`、Java 的 `System.currentTimeMillis()`。",
      "输出末尾的 `Z` 表示 UTC（零时区），别当成随便一个字母。",
    ],
    aka: ["unix timestamp", "posix time", "epoch", "iso8601", "unix时间戳", "posix时间", "unix纪元", "ISO 8601", "微秒时间戳", "时间戳转ISO"],
  },

  filetime: {
    what: "Windows 系统内部用的时间格式。取证题里从注册表、$MFT、事件日志里挖出来的时间戳，多半是这种。",
    principle:
      "FILETIME 是一个 64 位整数，记的是从 `1601-01-01T00:00:00Z` 起走过的「100 纳秒」个数（即 0.1 微秒为一个单位）。\n\n" +
      "为什么是 1601？因为它是格里高利历一个 400 年闰年周期的整起点，微软图个整。换算到 Unix 纪元要先减掉 1601→1970 的差值 `11644473600` 秒。数值极大（现代日期约 $1.3\\times10^{17}$），本工具用 BigInt 算防溢出。",
    usage: "编码方向把 ISO 时间转成 FILETIME 整数；解码方向把 FILETIME 整数转回 ISO 时间。",
    examples: [
      { in: "2021-01-01T00:00:00Z", out: "132539328000000000", desc: "编码：时间→FILETIME" },
      { in: "132539616000000000", out: "2021-01-01T08:00:00Z", desc: "解码：FILETIME→时间" },
    ],
    formulas: [
      { tex: "t_{unix\\_ms} = \\frac{FILETIME}{10000} - 11644473600000", caption: "FILETIME(100ns) 换算到 Unix 毫秒" },
    ],
    tips: [
      "18 位左右的超大整数（1.3e17 量级）+ 出现在 Windows 场景，基本就是 FILETIME。",
      "和 Chrome 时间容易混：Chrome 是同纪元的微秒（FILETIME÷10），量级差 10 倍。",
    ],
    aka: ["filetime", "windows时间", "win32 filetime", "1601纪元", "FILETIME", "windows filetime", "windows时间戳", "100纳秒时间", "$MFT时间", "注册表时间戳"],
  },

  hfsTime: {
    what: "老版 Mac（HFS+ 文件系统）用的时间格式，从 1904 年开始数秒。分析 Mac 磁盘镜像时会碰到。",
    principle:
      "HFS+ 时间是从 `1904-01-01T00:00:00Z` 起的秒数（32 位无符号整数）。1904 这个起点源自早期 Mac 的传统。\n\n" +
      "换算到 Unix 纪元要减掉 1904→1970 的差值 `2082844800` 秒。",
    usage: "编码方向把 ISO 时间转成 HFS+ 秒数；解码方向把秒数转回 ISO 时间。",
    examples: [
      { in: "2021-01-01T00:00:00Z", out: "3692304000", desc: "编码：时间→HFS+秒" },
      { in: "3692304000", out: "2021-01-01T00:00:00Z", desc: "解码：HFS+秒→时间" },
    ],
    formulas: [
      { tex: "t_{unix} = t_{hfs} - 2082844800", caption: "HFS+ 秒换算到 Unix 秒" },
    ],
    tips: [
      "同为「秒级」的还有 Cocoa（2001 纪元），别把纪元记混。",
      "32 位上限约到 2040 年，之后 HFS+ 时间会溢出。",
    ],
    aka: ["hfs+ time", "mac时间", "1904纪元", "hfsplus", "HFS+时间", "HFS时间戳", "mac hfs时间", "苹果hfs时间", "1904 epoch", "hfs+ timestamp"],
  },

  cocoaTime: {
    what: "苹果 Cocoa / Core Data 框架用的时间（也叫 Mac Absolute Time），从 2001 年开始数秒。iOS/macOS 应用数据里常见。",
    principle:
      "Cocoa 时间是从 `2001-01-01T00:00:00Z` 起的秒数（可带小数）。2001 是苹果给 Cocoa 定的「绝对时间」参考点。\n\n" +
      "换算到 Unix 纪元要加上 1970→2001 的差值 `978307200` 秒（注意是加，因为 2001 在 1970 之后）。",
    usage: "编码方向把 ISO 时间转成 Cocoa 秒数；解码方向把秒数转回 ISO 时间。",
    examples: [
      { in: "2021-01-01T00:00:00Z", out: "631152000", desc: "编码：时间→Cocoa秒" },
      { in: "631152000", out: "2021-01-01T00:00:00Z", desc: "解码：Cocoa秒→时间" },
    ],
    formulas: [
      { tex: "t_{unix} = t_{cocoa} + 978307200", caption: "Cocoa 秒换算到 Unix 秒" },
    ],
    tips: [
      "iOS SQLite 数据库（如短信、通话记录）里的时间字段常是 Cocoa 时间。",
      "数值比同期 Unix 时间戳小约 9.78 亿——因为纪元晚了 31 年。",
    ],
    aka: ["cocoa time", "mac absolute time", "core data时间", "2001纪元", "cfabsolutetime", "cocoa时间", "mac绝对时间", "苹果cocoa时间", "NSDate时间", "iOS时间戳"],
  },

  dosDateTime: {
    what: "DOS/FAT 文件系统用的紧凑日期时间，把年月日时分秒硬塞进 4 个字节。ZIP 文件头里的时间就是这个格式。",
    principle:
      "DOS 时间把日期和时间各压进一个 16 位字，再拼成 32 位：\n\n" +
      "日期字：`bits 15-9` 存年份(从1980算起)、`bits 8-5` 存月、`bits 4-0` 存日。\n\n" +
      "时间字：`bits 15-11` 存时、`bits 10-5` 存分、`bits 4-0` 存「秒÷2」（所以秒只有 2 秒精度）。\n\n" +
      "起点 1980 是因为 DOS 诞生于那个年代，之前的日期存不了。",
    usage: "编码方向把 ISO 时间打包成 DOS 32 位整数；解码方向拆包回 ISO 时间。仅支持 1980 年及以后。",
    examples: [
      { in: "2021-01-01T00:00:00Z", out: "1377894400", desc: "编码：时间→DOS打包值" },
      { in: "1388167168", out: "2021-05-30T00:00:00Z", desc: "解码：DOS打包值→时间" },
    ],
    tips: [
      "秒位只存「秒÷2」，所以 DOS 时间的秒永远是偶数，奇数秒会被抹掉。",
      "在 ZIP 的本地文件头偏移 10-13 字节就是这个打包时间，解压工具靠它显示修改时间。",
    ],
    aka: ["dos time", "fat时间", "msdos datetime", "zip时间", "DOS日期时间", "FAT日期时间", "dos date time", "MS-DOS时间", "zip文件时间", "FAT时间戳"],
  },

  chineseDate: {
    what: "把日期在「阿拉伯数字」和「汉字写法」之间互转，比如 2000-01-01 ↔ 二〇〇〇年一月一日。偏门题或文字游戏里会用。",
    principle:
      "纯查表转换：年份逐位映射成汉字数字（`〇一二三四五六七八九`），月和日按中文习惯组合（十、十一、二十一…）。\n\n" +
      "只处理日期部分，不含时分秒；解码时按 UTC 午夜（当天 00:00:00Z）对齐。",
    usage: "编码方向把 ISO 日期转成汉字日期；解码方向把「X年X月X日」的汉字串转回 ISO 日期。",
    examples: [
      { in: "2000-01-01T00:00:00Z", out: "二〇〇〇年一月一日", desc: "编码：数字→汉字" },
      { in: "二〇〇〇年一月一日", out: "2000-01-01T00:00:00Z", desc: "解码：汉字→数字" },
    ],
    tips: [
      "年份用的是「〇一二三…」逐位读法（二〇〇〇不是两千），和口语「二零零零」一致。",
      "只认 `X年X月X日` 格式，多字少字都会报错。",
    ],
    aka: ["中文日期", "汉字日期", "chinese date", "汉字日期转换", "中文数字日期", "汉字数字日期", "chinese date convert", "年月日汉字", "汉字纪年", "中文日期互转"],
  },

  tzConvert: {
    what: "把一个时间从一个时区换算到另一个时区，比如把伦敦时间换成北京时间。",
    principle:
      "时区本质是相对 UTC 的偏移量，如 `+08:00` 表示比 UTC 快 8 小时。转换分两步：先把输入时间归到 UTC，再加上目标时区偏移输出。\n\n" +
      "如果输入已带时区后缀（`Z` 或 `±HH:MM`），就以它为准；如果没带，则视为「源时区」的本地时间。",
    usage: "填源时区（无时区输入时生效，默认 UTC）和目标时区（默认 +08:00）。时区可写 `UTC` / `+8` / `-05:00` 等。",
    examples: [
      { in: "2021-01-01T12:00:00Z", param: "UTC → +08:00", out: "2021-01-01T20:00:00+08:00", desc: "UTC 12点=北京20点" },
    ],
    tips: [
      "北京时间没有夏令时，恒为 `+08:00`，换算最省心。",
      "输出保留目标时区后缀，方便一眼看出这是哪个时区的钟点。",
    ],
    aka: ["时区转换", "timezone convert", "utc offset", "时差换算", "时区换算", "timezone conversion", "UTC偏移", "跨时区转换", "时区互转", "GMT换算"],
  },

  julianDate: {
    what: "天文学家用的「儒略日」：从公元前 4713 年起把每一天连续编号的一个大数。搞天文、历法题会碰到。",
    principle:
      "儒略日 JD 是从 `公元前 4713-01-01 12:00 UT` 起数的天数（含小数，小数部分表示当天过了几分之几）。注意它从「中午」起算，所以整数 JD 对应的是当天正午。\n\n" +
      "本工具用 Meeus《天文算法》的标准公式做格里高利历 ↔ JD 互转，并在 1582-10-15 前后自动切换儒略历/格里高利历分支。一个著名基准：`J2000.0 = 2451545.0`（2000-01-01 12:00 UT）。",
    usage: "编码方向把 ISO 时间转成儒略日数；解码方向把儒略日转回 ISO 时间。",
    examples: [
      { in: "2000-01-01T12:00:00Z", out: "2451545", desc: "编码：正好是 J2000.0 基准" },
      { in: "1970-01-01T00:00:00Z", out: "2440587.5", desc: "Unix 纪元的 JD，含 .5（午夜=半天）" },
    ],
    formulas: [
      { tex: "JD_{J2000.0} = 2451545.0", caption: "天文常用基准历元（2000-01-01 12:00 UT）" },
    ],
    tips: [
      "小数 `.5` 是因为儒略日从正午起算，午夜正好差半天。",
      "看到 240 万~ 245 万量级的带小数大数、且和天文/历法相关，多半是儒略日。",
    ],
    aka: ["julian date", "儒略日", "jd", "julian day number", "儒略日期", "儒略日转换", "julian day", "天文儒略日", "JD转换", "J2000历元"],
  },

  excelDate: {
    what: "Excel 存日期用的「序列号」：1900-01-01 记作 1，往后一天加一。从表格里导出的数字日期常是这个。",
    principle:
      "1900 系统里 serial 1 = 1900-01-01，serial 25569 = 1970-01-01，往后每天 +1。小数部分表示一天内的时间（0.5 = 正午）。\n\n" +
      "有个著名坑：Excel 误以为 1900 年是闰年，凭空多出个 `1900-02-29`（serial 60）。所以 1900 年 3 月起公式才精确，之前的日期要修正 1 天。另有 Mac 旧版用的 1904 系统（无此 bug）。",
    usage: "选日期系统（默认 1900，可选 1904）。编码方向把 ISO 时间转成 Excel 序列号；解码方向转回。",
    examples: [
      { in: "2021-01-01T00:00:00Z", param: "system=1900", out: "44197", desc: "编码：日期→序列号" },
      { in: "44197", param: "system=1900", out: "2021-01-01（UTC）", desc: "解码：序列号→日期" },
    ],
    tips: [
      "serial 60 是幻影日 1900-02-29，本工具会直接报错提醒——它在真实历法里根本不存在。",
      "带小数的 serial（如 44197.5）表示日期+时间，.5 就是中午 12 点。",
    ],
    aka: ["excel date", "excel序列日期", "serial date", "1900系统", "1904系统", "excel日期序列号", "excel serial", "表格序列日期", "excel serial date", "excel日期数字"],
  },

  chromeTime: {
    what: "Chrome 浏览器（和整个 WebKit 系）内部记时间的格式。翻取证题里 Chrome 历史记录、Cookie 的时间戳就是它。",
    principle:
      "和 Windows FILETIME 同一个纪元 `1601-01-01T00:00:00Z`，但单位是「微秒」（百万分之一秒），而 FILETIME 是 100 纳秒——所以 Chrome 时间 = FILETIME ÷ 10。\n\n" +
      "换算到 Unix 要减掉 1601→1970 的 `11644473600000000` 微秒。数值极大（约 $1.3\\times10^{16}$），用 BigInt 处理。",
    usage: "编码方向把 ISO 时间转成 Chrome 微秒值；解码方向转回 ISO 时间。",
    examples: [
      { in: "2021-01-01T00:00:00Z", out: "13253932800000000", desc: "编码：时间→Chrome微秒" },
      { in: "13253932800000000", out: "2021-01-01T00:00:00Z", desc: "解码：Chrome微秒→时间" },
    ],
    formulas: [
      { tex: "t_{unix\\_ms} = \\frac{t_{chrome}}{1000} - 11644473600000", caption: "Chrome 微秒换算到 Unix 毫秒" },
    ],
    tips: [
      "Chrome 的 `History` SQLite 库里 `last_visit_time` 字段就是这个格式，直接拿来解。",
      "17 位量级（1.3e16）是 Chrome 微秒；18 位量级（1.3e17）才是 FILETIME，差一位数别认错。",
    ],
    aka: ["chrome time", "webkit time", "chrome时间戳", "1601纪元微秒", "chrome时间", "webkit时间戳", "chrome微秒时间", "浏览器历史时间", "cookie时间戳", "chrome epoch"],
  },

  snowflakeId: {
    what: "Twitter 发明、Discord 等大量沿用的分布式唯一 ID。它把「生成时间」直接编进 ID 里，所以能反解出这条消息/用户是什么时候创建的。",
    principle:
      "雪花 ID 是 64 位整数，按位切成四段：\n\n" +
      "`bits 63-22`（高 41 位）= 毫秒时间戳偏移；`bits 21-17` = 数据中心 ID；`bits 16-12` = 工作节点 ID；`bits 11-0`（低 12 位）= 同毫秒内的序列号。\n\n" +
      "时间戳是「相对某个自定义纪元的毫秒偏移」，不是相对 1970。Twitter 纪元 = `1288834974657`（2010-11-04），Discord 纪元 = `1420070400000`（2015-01-01）。加回纪元才是真实 Unix 毫秒。本工具 run 单向输出解析报告。",
    usage: "选纪元（Twitter / Discord / 自定义）。输入雪花 ID 整数，输出拆解出的时间、数据中心、工作节点、序列号。",
    examples: [
      { in: "1541815603606036480", param: "epoch=discord", out: "生成时间 2022-06-28T16:07:40Z / 数据中心=11 / 工作节点=26 / 序列号=0", desc: "Discord 消息 ID 反解" },
    ],
    formulas: [
      { tex: "t_{unix\\_ms} = (id \\gg 22) + epoch", caption: "高 41 位右移取时间戳偏移，加纪元得真实毫秒" },
    ],
    tips: [
      "拿到 Discord/Twitter 的消息或用户 ID，直接右移 22 位加纪元就能算出创建时间，无需数据库。",
      "选错纪元会把时间算偏好几年——Twitter 和 Discord 纪元差约 4 年。",
    ],
    aka: ["snowflake id", "雪花id", "twitter snowflake", "discord id", "分布式id", "雪花算法", "snowflake算法", "雪花ID解析", "discord snowflake", "分布式唯一id"],
  },
};
