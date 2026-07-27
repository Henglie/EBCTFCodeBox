// 科普内容分片：radix「地理坐标编码」组 4 项。纯数据，无 import 无副作用。
// geoDms / geoPlusCode / geoMaidenhead / geoUtm（样例均由 geo.js 实跑取值）
export default {
  geoDms: {
    what: "经纬度在「度分秒」（DMS）和「十进制度」（DD）两种写法间互转。地图上常见的 `39°30'0\"N` 就是度分秒。",
    principle:
      "十进制度换度分秒：整数部分是度，小数×60 的整数部分是分，剩下再×60 是秒。半球用 N/S（纬度）、E/W（经度）标正负。\n\n" +
      "$DD = 度 + \\dfrac{分}{60} + \\dfrac{秒}{3600}$，反向逐级取整即可。",
    usage: "encode 把 `lat,lon`（十进制度）转成度分秒。decode 把度分秒串转回十进制度。",
    examples: [
      { in: "39.5,116.5", param: "编码", out: "39°30'0\"N, 116°30'0\"E" },
      { in: "39°30'0\"N, 116°30'0\"E", param: "解码", out: "39.5,116.5" },
    ],
    formulas: [
      { tex: "DD = D + \\frac{M}{60} + \\frac{S}{3600}", caption: "度分秒 → 十进制度" },
    ],
    tips: ["GPS 设备、航海航空多用度分秒；导航 App、编程多用十进制度。", "负号 = 南纬/西经，等价于 S/W 半球标识。"],
    aka: ["dms", "度分秒", "经纬度", "十进制度", "dd", "degrees minutes seconds",
      "decimal degrees", "经纬度转换", "DMS转DD", "坐标格式转换", "度分秒转换", "GPS坐标"],
  },

  geoPlusCode: {
    what: "Google 的 Plus Code（开放位置码 OLC）：把经纬度编成一串短代码，没有门牌号的地方也能精确定位。",
    principle:
      "在纬度 [-90,90]、经度 [-180,180] 的网格上逐级细分：每一对字符定位一层网格，字母表 `23456789CFGHJMPQRVWX`（去掉易混字符）。\n\n" +
      "前 8 字符后插一个 `+` 分隔符，11 字符全码可定位到约几米。",
    usage: "encode 把 `lat,lon` 转成 Plus Code（8 位短码或 11 位全码）。decode 把 Plus Code 转回坐标中心点。",
    examples: [
      { in: "39.9,116.4", param: "11 位全码", out: "8PFRW92X+2X", desc: "北京附近" },
    ],
    tips: ["认它很容易：一串大写字母数字中间有个 `+`，且不含 0/1/A/E/I/O/U 等易混字符。", "谷歌地图直接搜 Plus Code 就能跳到那个点，无需注册地址。"],
    aka: ["plus code", "olc", "开放位置码", "google plus code", "加号码", "Open Location Code",
      "谷歌位置码", "plus codes", "OLC编码", "加号地址码", "开放地点编码", "google定位码"],
  },

  geoMaidenhead: {
    what: "Maidenhead 网格定位：业余无线电（HAM）圈用的坐标简记法，如 `OM89ev`。CTF 里的无线电/HAM 题常见。",
    principle:
      "把地球按经度 20°、纬度 10° 划成大格（字段，2 字母），再 2°×1° 细分（2 数字），再 5'×2.5' 细分（2 字母 subsquare），可继续扩展。\n\n" +
      "字母+数字交替，越长越精确。",
    usage: "encode 把 `lat,lon` 转成网格（默认 6 字符 3 对）。decode 把网格转回坐标中心点。",
    examples: [
      { in: "39.9,116.4", param: "6 字符", out: "OM89ev", desc: "北京附近网格" },
    ],
    tips: ["格式很好认：2 大写字母 + 2 数字 (+ 2 小写字母)，如 `FN20` `OM89ev`。", "HAM 电台报点、卫星通联记录里遍地是它，看到就往这上面想。"],
    aka: ["maidenhead", "网格定位", "qth locator", "ham网格", "梅登黑德", "Maidenhead Locator",
      "梅登黑德网格", "grid locator", "业余无线电网格", "QTH定位", "网格坐标", "HAM定位系统"],
  },

  geoUtm: {
    what: "UTM 坐标：把地球分成 60 个 6° 宽的投影带，用「带号+字母带+东距+北距」的米制坐标表示位置，如 `50S 448709 4416831`。",
    principle:
      "基于 WGS84 椭球和横轴墨卡托投影（Snyder/USGS 公式）。带号 `zone = floor((经度+180)/6)+1`（1-60），纬度用字母带 C-X（跳过 I/O，每 8° 一带）。\n\n" +
      "东距（easting）、北距（northing）单位是米，中央经线东距固定加 500000 避免负值。",
    usage: "encode 把 `lat,lon` 转成 UTM。decode 把 `带号字母 东距 北距` 转回经纬度。",
    examples: [
      { in: "39.9,116.4", param: "编码", out: "50S 448709 4416831", desc: "北京在 50 带" },
    ],
    tips: ["军事地图、测绘、GIS 大量用 UTM，因为它是米制、便于量距离。", "字母带跳过 I 和 O（怕和 1、0 混淆），这是 UTM 字母的固定规则。"],
    aka: ["utm", "utm坐标", "通用横轴墨卡托", "军用坐标", "投影坐标", "Universal Transverse Mercator",
      "UTM投影", "横轴墨卡托", "UTM网格", "米制坐标", "墨卡托投影坐标", "UTM zone"],
  },
};
