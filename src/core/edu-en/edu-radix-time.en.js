// English edu shard: radix time family — 12 ops (4 external). Pure data, no imports, no side effects.
// Covers timestamp/unixTime/filetime/hfsTime/cocoaTime/dosDateTime/chineseDate/
// tzConvert/julianDate/excelDate/chromeTime/snowflakeId. Example values are all computed by the algorithms, not made up.
export default {
  timestamp: {
    what: "The most common little \"timestamp ↔ human time\" converter. A timestamp is the number of seconds (or milliseconds) elapsed since the moment 1970-01-01.",
    principle:
      "Computers don't like storing strings like \"January 1, 2021\", so they store a big integer instead: how many seconds have elapsed from `1970-01-01T00:00:00Z` (the Unix epoch) to now.\n\n" +
      "This tool's `auto` mode looks at the magnitude of the number to decide the unit automatically: around 10 digits is treated as seconds, around 13 digits as milliseconds. The direction is also guessed automatically — give it a number and it becomes a time, give it a time and it becomes a number.",
    usage: "Set direction to `auto` for automatic detection; you can also force \"timestamp→time\" or \"time→timestamp\". Enter an integer or a date string.",
    examples: [
      { in: "1609459200", out: "2021-01-01 (UTC)", desc: "10 digits treated as seconds" },
      { in: "2021-01-01", out: "1609459200", desc: "reverse" },
    ],
    tips: [
      "10 digits ≈ seconds (it stays 10 digits until the year 2286), 13 digits ≈ milliseconds — distinguishable at a glance.",
      "A 10-digit number like `16xxxxxxxx` is almost certainly a Unix second-level timestamp from around 2020.",
    ],
    aka: ["timestamp", "unix时间戳", "时间戳转换", "epoch time", "时间戳", "unix time", "秒级时间戳", "毫秒时间戳", "epoch转时间", "时间戳互转"],
  },

  unixTime: {
    what: "Precise conversion between Unix timestamps and standard ISO8601 time, with a microsecond unit and stricter formatting than timestamp.",
    principle:
      "Also using `1970-01-01T00:00:00Z` as the zero point, but here you explicitly choose the unit: seconds / milliseconds / microseconds. `auto` decides by numeric range — less than $10^{10}$ is seconds, less than $10^{13}$ is milliseconds, larger is microseconds.\n\n" +
      "The output is uniformly ISO8601 UTC format (with a `Z` suffix), like `2021-01-01T00:00:00Z`.",
    usage: "Choose the unit (default auto). Encode direction turns ISO time into a timestamp, decode direction turns a timestamp back into ISO time.",
    examples: [
      { in: "2021-01-01T00:00:00Z", param: "unit=sec", out: "1609459200", desc: "Encode: time → seconds" },
      { in: "1609459200", param: "unit=auto", out: "2021-01-01T00:00:00Z", desc: "Decode: seconds → time" },
    ],
    tips: [
      "Millisecond timestamps (13 digits) are common in JS's `Date.now()` and Java's `System.currentTimeMillis()`.",
      "The trailing `Z` in the output means UTC (zero timezone) — don't treat it as just any letter.",
    ],
    aka: ["unix timestamp", "posix time", "epoch", "iso8601", "unix时间戳", "posix时间", "unix纪元", "ISO 8601", "微秒时间戳", "时间戳转ISO"],
  },

  filetime: {
    what: "The time format used internally by Windows. In forensics challenges, timestamps dug out of the registry, $MFT, or event logs are usually this format.",
    principle:
      "FILETIME is a 64-bit integer recording the number of \"100-nanosecond\" units (i.e. 0.1 microsecond per unit) elapsed since `1601-01-01T00:00:00Z`.\n\n" +
      "Why 1601? Because it's the clean start of a 400-year leap-year cycle in the Gregorian calendar, and Microsoft wanted a round starting point. To convert to the Unix epoch, first subtract the 1601→1970 difference of `11644473600` seconds. The values are enormous (a modern date is around $1.3\\times10^{17}$), so this tool uses BigInt to prevent overflow.",
    usage: "Encode direction turns ISO time into a FILETIME integer; decode direction turns a FILETIME integer back into ISO time.",
    examples: [
      { in: "2021-01-01T00:00:00Z", out: "132539328000000000", desc: "Encode: time → FILETIME" },
      { in: "132539616000000000", out: "2021-01-01T08:00:00Z", desc: "Decode: FILETIME → time" },
    ],
    formulas: [
      { tex: "t_{unix\\_ms} = \\frac{FILETIME}{10000} - 11644473600000", caption: "Convert FILETIME (100ns) to Unix milliseconds" },
    ],
    tips: [
      "A huge integer of about 18 digits (on the order of 1.3e17) appearing in a Windows context is basically FILETIME.",
      "Easily confused with Chrome time: Chrome uses microseconds on the same epoch (FILETIME÷10), a magnitude 10× smaller.",
    ],
    aka: ["filetime", "windows时间", "win32 filetime", "1601纪元", "FILETIME", "windows filetime", "windows时间戳", "100纳秒时间", "$MFT时间", "注册表时间戳"],
  },

  hfsTime: {
    what: "The time format used by old Macs (the HFS+ file system), counting seconds from 1904. You'll run into it when analyzing Mac disk images.",
    principle:
      "HFS+ time is the number of seconds (a 32-bit unsigned integer) since `1904-01-01T00:00:00Z`. The 1904 starting point comes from early Mac tradition.\n\n" +
      "To convert to the Unix epoch, subtract the 1904→1970 difference of `2082844800` seconds.",
    usage: "Encode direction turns ISO time into HFS+ seconds; decode direction turns seconds back into ISO time.",
    examples: [
      { in: "2021-01-01T00:00:00Z", out: "3692304000", desc: "Encode: time → HFS+ seconds" },
      { in: "3692304000", out: "2021-01-01T00:00:00Z", desc: "Decode: HFS+ seconds → time" },
    ],
    formulas: [
      { tex: "t_{unix} = t_{hfs} - 2082844800", caption: "Convert HFS+ seconds to Unix seconds" },
    ],
    tips: [
      "Cocoa (2001 epoch) is also \"second-level\" — don't mix up the epochs.",
      "The 32-bit limit tops out around the year 2040, after which HFS+ time overflows.",
    ],
    aka: ["hfs+ time", "mac时间", "1904纪元", "hfsplus", "HFS+时间", "HFS时间戳", "mac hfs时间", "苹果hfs时间", "1904 epoch", "hfs+ timestamp"],
  },

  cocoaTime: {
    what: "The time used by Apple's Cocoa / Core Data frameworks (also called Mac Absolute Time), counting seconds from 2001. Common in iOS/macOS app data.",
    principle:
      "Cocoa time is the number of seconds (which may have a fractional part) since `2001-01-01T00:00:00Z`. 2001 is the \"absolute time\" reference point Apple set for Cocoa.\n\n" +
      "To convert to the Unix epoch, add the 1970→2001 difference of `978307200` seconds (note it's add, because 2001 comes after 1970).",
    usage: "Encode direction turns ISO time into Cocoa seconds; decode direction turns seconds back into ISO time.",
    examples: [
      { in: "2021-01-01T00:00:00Z", out: "631152000", desc: "Encode: time → Cocoa seconds" },
      { in: "631152000", out: "2021-01-01T00:00:00Z", desc: "Decode: Cocoa seconds → time" },
    ],
    formulas: [
      { tex: "t_{unix} = t_{cocoa} + 978307200", caption: "Convert Cocoa seconds to Unix seconds" },
    ],
    tips: [
      "Time fields in iOS SQLite databases (like SMS and call records) are often Cocoa time.",
      "The value is about 978 million smaller than a contemporary Unix timestamp — because the epoch is 31 years later.",
    ],
    aka: ["cocoa time", "mac absolute time", "core data时间", "2001纪元", "cfabsolutetime", "cocoa时间", "mac绝对时间", "苹果cocoa时间", "NSDate时间", "iOS时间戳"],
  },

  dosDateTime: {
    what: "The compact date-time used by the DOS/FAT file system, cramming year/month/day/hour/minute/second into 4 bytes. The time in a ZIP file header is this format.",
    principle:
      "DOS time packs the date and time into a 16-bit word each, then combines them into 32 bits:\n\n" +
      "Date word: `bits 15-9` hold the year (counting from 1980), `bits 8-5` the month, `bits 4-0` the day.\n\n" +
      "Time word: `bits 15-11` hold the hour, `bits 10-5` the minute, `bits 4-0` hold \"seconds÷2\" (so seconds have only 2-second precision).\n\n" +
      "The 1980 starting point is because DOS was born in that era and can't store dates before it.",
    usage: "Encode direction packs ISO time into a DOS 32-bit integer; decode direction unpacks it back to ISO time. Only supports 1980 and later.",
    examples: [
      { in: "2021-01-01T00:00:00Z", out: "1377894400", desc: "Encode: time → DOS packed value" },
      { in: "1388167168", out: "2021-05-30T00:00:00Z", desc: "Decode: DOS packed value → time" },
    ],
    tips: [
      "The seconds field stores only \"seconds÷2\", so DOS-time seconds are always even; odd seconds get wiped out.",
      "This packed time sits at byte offset 10-13 in a ZIP local file header, and extraction tools rely on it to display the modification time.",
    ],
    aka: ["dos time", "fat时间", "msdos datetime", "zip时间", "DOS日期时间", "FAT日期时间", "dos date time", "MS-DOS时间", "zip文件时间", "FAT时间戳"],
  },

  chineseDate: {
    what: "Converts dates between Arabic numerals and the Chinese-character form, e.g. 2000-01-01 ↔ 二〇〇〇年一月一日. Used in offbeat challenges or word games.",
    principle:
      "Pure table lookup: the year is mapped digit by digit to Chinese digits (`〇一二三四五六七八九`), and the month and day are composed per Chinese convention (十, 十一, 二十一…).\n\n" +
      "It handles only the date portion, no hours/minutes/seconds; decoding aligns to UTC midnight (00:00:00Z of that day).",
    usage: "Encode direction turns an ISO date into a Chinese date; decode direction turns a Chinese string of the form \"X年X月X日\" back into an ISO date.",
    examples: [
      { in: "2000-01-01T00:00:00Z", out: "二〇〇〇年一月一日", desc: "Encode: numerals → Chinese characters" },
      { in: "二〇〇〇年一月一日", out: "2000-01-01T00:00:00Z", desc: "Decode: Chinese characters → numerals" },
    ],
    tips: [
      "The year uses the digit-by-digit reading `〇一二三…` (二〇〇〇 is not \"two thousand\"), matching the spoken \"二零零零\".",
      "It only recognizes the `X年X月X日` format; too many or too few characters raise an error.",
    ],
    aka: ["中文日期", "汉字日期", "chinese date", "汉字日期转换", "中文数字日期", "汉字数字日期", "chinese date convert", "年月日汉字", "汉字纪年", "中文日期互转"],
  },

  tzConvert: {
    what: "Converts a time from one timezone to another, e.g. turning London time into Beijing time.",
    principle:
      "A timezone is essentially an offset relative to UTC, like `+08:00` meaning 8 hours ahead of UTC. Conversion is two steps: first normalize the input time to UTC, then add the target timezone offset and output.\n\n" +
      "If the input already has a timezone suffix (`Z` or `±HH:MM`), that takes precedence; if not, it's treated as local time in the \"source timezone\".",
    usage: "Set the source timezone (effective when the input has no timezone, default UTC) and the target timezone (default +08:00). Timezones can be written as `UTC` / `+8` / `-05:00` etc.",
    examples: [
      { in: "2021-01-01T12:00:00Z", param: "UTC → +08:00", out: "2021-01-01T20:00:00+08:00", desc: "UTC noon = Beijing 8pm" },
    ],
    tips: [
      "Beijing time has no daylight saving, always `+08:00`, making conversion the simplest.",
      "The output keeps the target timezone suffix, so you can tell at a glance which timezone the clock reading belongs to.",
    ],
    aka: ["时区转换", "timezone convert", "utc offset", "时差换算", "时区换算", "timezone conversion", "UTC偏移", "跨时区转换", "时区互转", "GMT换算"],
  },

  julianDate: {
    what: "The \"Julian Day\" used by astronomers: a big number that continuously numbers every day since 4713 BC. You'll encounter it in astronomy and calendar challenges.",
    principle:
      "The Julian Day JD is the number of days (including a fractional part representing how far into the day it is) since `4713-01-01 12:00 UT BC`. Note it starts counting from \"noon\", so an integer JD corresponds to that day's noon.\n\n" +
      "This tool uses the standard formulas from Meeus's \"Astronomical Algorithms\" for Gregorian ↔ JD conversion, and automatically switches between the Julian/Gregorian calendar branches around 1582-10-15. A famous reference: `J2000.0 = 2451545.0` (2000-01-01 12:00 UT).",
    usage: "Encode direction turns ISO time into a Julian Day number; decode direction turns a Julian Day back into ISO time.",
    examples: [
      { in: "2000-01-01T12:00:00Z", out: "2451545", desc: "Encode: exactly the J2000.0 reference" },
      { in: "1970-01-01T00:00:00Z", out: "2440587.5", desc: "The JD of the Unix epoch, with .5 (midnight = half a day)" },
    ],
    formulas: [
      { tex: "JD_{J2000.0} = 2451545.0", caption: "The common astronomical reference epoch (2000-01-01 12:00 UT)" },
    ],
    tips: [
      "The `.5` fraction is because the Julian Day starts at noon, so midnight is exactly half a day off.",
      "A large fractional number on the order of 2.4–2.45 million related to astronomy/calendars is probably a Julian Day.",
    ],
    aka: ["julian date", "儒略日", "jd", "julian day number", "儒略日期", "儒略日转换", "julian day", "天文儒略日", "JD转换", "J2000历元"],
  },

  excelDate: {
    what: "The \"serial number\" Excel uses to store dates: 1900-01-01 is recorded as 1, incrementing by one for each day after. Numeric dates exported from spreadsheets are often this.",
    principle:
      "In the 1900 system, serial 1 = 1900-01-01, serial 25569 = 1970-01-01, incrementing by 1 each day after. The fractional part represents the time within a day (0.5 = noon).\n\n" +
      "There's a famous pitfall: Excel mistakenly treats 1900 as a leap year, inventing a phantom `1900-02-29` (serial 60). So the formula is only accurate from March 1900 onward; dates before that need a 1-day correction. There's also the 1904 system used by old Macs (which lacks this bug).",
    usage: "Choose the date system (default 1900, 1904 optional). Encode direction turns ISO time into an Excel serial number; decode direction converts back.",
    examples: [
      { in: "2021-01-01T00:00:00Z", param: "system=1900", out: "44197", desc: "Encode: date → serial number" },
      { in: "44197", param: "system=1900", out: "2021-01-01 (UTC)", desc: "Decode: serial number → date" },
    ],
    tips: [
      "Serial 60 is the phantom day 1900-02-29; this tool raises an error to warn you — it doesn't exist in the real calendar.",
      "A serial with a fractional part (like 44197.5) represents date + time, and .5 is exactly noon.",
    ],
    aka: ["excel date", "excel序列日期", "serial date", "1900系统", "1904系统", "excel日期序列号", "excel serial", "表格序列日期", "excel serial date", "excel日期数字"],
  },

  chromeTime: {
    what: "The time format used internally by the Chrome browser (and the whole WebKit family). In forensics challenges, timestamps dug from Chrome history and cookies are this.",
    principle:
      "Same epoch as Windows FILETIME, `1601-01-01T00:00:00Z`, but the unit is \"microseconds\" (one millionth of a second), whereas FILETIME is 100 nanoseconds — so Chrome time = FILETIME ÷ 10.\n\n" +
      "To convert to Unix, subtract the 1601→1970 difference of `11644473600000000` microseconds. The values are enormous (about $1.3\\times10^{16}$), handled with BigInt.",
    usage: "Encode direction turns ISO time into a Chrome microsecond value; decode direction converts back to ISO time.",
    examples: [
      { in: "2021-01-01T00:00:00Z", out: "13253932800000000", desc: "Encode: time → Chrome microseconds" },
      { in: "13253932800000000", out: "2021-01-01T00:00:00Z", desc: "Decode: Chrome microseconds → time" },
    ],
    formulas: [
      { tex: "t_{unix\\_ms} = \\frac{t_{chrome}}{1000} - 11644473600000", caption: "Convert Chrome microseconds to Unix milliseconds" },
    ],
    tips: [
      "The `last_visit_time` field in Chrome's `History` SQLite database is exactly this format, ready to decode directly.",
      "A magnitude of 17 digits (1.3e16) is Chrome microseconds; a magnitude of 18 digits (1.3e17) is FILETIME — don't misread by one digit.",
    ],
    aka: ["chrome time", "webkit time", "chrome时间戳", "1601纪元微秒", "chrome时间", "webkit时间戳", "chrome微秒时间", "浏览器历史时间", "cookie时间戳", "chrome epoch"],
  },

  snowflakeId: {
    what: "The distributed unique ID invented by Twitter and widely reused by Discord and others. It encodes the \"generation time\" directly into the ID, so you can reverse out when a message/user was created.",
    principle:
      "A Snowflake ID is a 64-bit integer, sliced by bits into four sections:\n\n" +
      "`bits 63-22` (high 41 bits) = millisecond timestamp offset; `bits 21-17` = datacenter ID; `bits 16-12` = worker node ID; `bits 11-0` (low 12 bits) = sequence number within the same millisecond.\n\n" +
      "The timestamp is a \"millisecond offset relative to some custom epoch\", not relative to 1970. The Twitter epoch = `1288834974657` (2010-11-04), the Discord epoch = `1420070400000` (2015-01-01). Adding the epoch back gives the real Unix milliseconds. This tool's run gives a one-way parsing report.",
    usage: "Choose the epoch (Twitter / Discord / custom). Enter a Snowflake ID integer, and it outputs the extracted time, datacenter, worker node, and sequence number.",
    examples: [
      { in: "1541815603606036480", param: "epoch=discord", out: "generation time 2022-06-28T16:07:40Z / datacenter=11 / worker node=26 / sequence=0", desc: "Reversing a Discord message ID" },
    ],
    formulas: [
      { tex: "t_{unix\\_ms} = (id \\gg 22) + epoch", caption: "Right-shift the high 41 bits to get the timestamp offset, add the epoch to get the real milliseconds" },
    ],
    tips: [
      "Given a Discord/Twitter message or user ID, just right-shift 22 bits and add the epoch to compute the creation time, no database needed.",
      "Choosing the wrong epoch throws the time off by years — the Twitter and Discord epochs differ by about 4 years.",
    ],
    aka: ["snowflake id", "雪花id", "twitter snowflake", "discord id", "分布式id", "雪花算法", "snowflake算法", "雪花ID解析", "discord snowflake", "分布式唯一id"],
  },
};
