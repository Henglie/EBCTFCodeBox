// 科普内容分片：radix「进制/网络/地理坐标转换」收尾组 3 op
// radixConvert / ipv4Int / geoHash
// 纯数据，无 import 无副作用。样例均由 radix.js / netcodec.js / geo.js 实跑取值。
export default {
  radixConvert: {
    what: "任意进制之间互相转换：2~36 进制随意换，比如十六进制转二进制、十进制转三十六进制。",
    principle:
      "先把源进制的字符串按位权展开还原成一个整数，再用「除基取余」逆序拼出目标进制。\n\n" +
      "内部用 BigInt 计算，所以再大的数也不会溢出。字母按 a=10、b=11…z=35 取值。",
    usage: "填数字串，设「源进制 fromBase」和「目标进制 toBase」（都在 2~36 之间），一次换算完成。",
    examples: [
      { in: "255", param: "fromBase=10, toBase=16", out: "ff", desc: "十进制 255 → 十六进制 ff" },
      { in: "3735928559", param: "fromBase=10, toBase=16", out: "deadbeef", desc: "经典 0xDEADBEEF" },
      { in: "FF", param: "fromBase=16, toBase=2", out: "11111111", desc: "十六进制 → 二进制" },
    ],
    tips: [
      "字母大小写都认，输出统一用小写。",
      "16 进制的 `deadbeef`、`cafebabe` 是 CTF 里常见的「魔数」，看到别惊讶。",
    ],
    aka: ["进制转换", "进制互转", "radix convert", "base convert", "任意进制", "base conversion",
      "进制换算", "2-36进制", "radix conversion", "数制转换", "任意进制转换", "十六进制转二进制"],
  },

  ipv4Int: {
    what: "IPv4 地址和 32 位整数互转。`192.168.1.1` 这种点分十进制，其实等于一个 0~42 亿之间的整数。",
    principle:
      "IPv4 四段各占 8 位，拼成一个 32 位整数：`a·256³ + b·256² + c·256 + d`。\n\n" +
      "反向就是把整数按每 8 位切成四段。支持 inet_aton 语义，整数可用十进制/0x 十六进制/前导 0 八进制/0b 二进制表示。",
    usage: "填 IPv4 点分地址得整数，或填整数得 IPv4。可选整数输出格式（dec/hex/oct/bin）。",
    examples: [
      { in: "8.8.8.8", out: "134744072", desc: "Google DNS → 整数" },
      { in: "3232235777", out: "192.168.1.1", desc: "整数 → 内网地址" },
      { in: "192.168.1.1", param: "format=hex", out: "0xC0A80101", desc: "输出十六进制形式" },
    ],
    tips: [
      "IP 藏成整数是常见的「藏坐标」手法，看到一个 42 亿以内的大整数可以试着当 IP 解。",
      "`0xC0A80101` = 192.168.1.1，十六进制每两位正好对应一段。",
    ],
    aka: ["IP 转整数", "ipv4 int", "inet_aton", "IP 十进制", "整数 IP", "ipv4 to int",
      "IP整数互转", "ip转数字", "十进制IP", "IP地址编码", "long IP", "ip2long"],
  },

  geoHash: {
    what: "把经纬度坐标编码成一串短字符（Geohash），也能反解回坐标。地图定位、附近搜索常用。",
    principle:
      "把纬度、经度分别在各自范围内反复二分（在上半/下半各记一个 bit），两者交替取位，得到一长串 bit。\n\n" +
      "每 5 个 bit 查一次去掉 a/i/l/o 的特制 base32 表，拼成字符串。字符越多、精度越高。",
    usage: "填 `纬度,经度`（如 `39.9042,116.4074`）编码，或填 geohash 串解码。可选精度位数。",
    examples: [
      { in: "39.9042,116.4074", param: "precision=11", out: "wx4g0bm6c40", desc: "北京天安门坐标" },
      { in: "48.669,-4.329", param: "precision=8", out: "gbsuv7zt", desc: "8 位精度约 ±19m" },
      { in: "wx4g0bm6c40", out: "39.904201,116.4074", desc: "反解回坐标" },
    ],
    tips: [
      "前缀相同的 geohash 地理位置相邻，所以能拿来做「附近的人」检索。",
      "看到不含 a/i/l/o 的短字符串、又和地点有关，优先怀疑 geohash。",
    ],
    aka: ["geohash", "地理哈希", "坐标编码", "经纬度编码", "地理散列", "geo hash",
      "地理位置编码", "geohash编码", "空间编码", "base32坐标", "地理网格编码", "位置哈希"],
  },
};
