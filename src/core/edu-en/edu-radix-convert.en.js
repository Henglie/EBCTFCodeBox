// English edu shard: radix "base / network / geo coordinate conversion" wrap-up group — 3 ops
// radixConvert / ipv4Int / geoHash
// Pure data, no imports, no side effects. Sample values are computed by radix.js / netcodec.js / geo.js.
export default {
  radixConvert: {
    what: "Converts between arbitrary bases: any base from 2 to 36, e.g. hex to binary, decimal to base 36.",
    principle:
      "First expand the source-base string by positional weight back into an integer, then use \"divide by base, take remainder\" in reverse to build up the target base.\n\n" +
      "Internally it uses BigInt, so no matter how large the number, it won't overflow. Letters take values a=10, b=11…z=35.",
    usage: "Enter the digit string, set `fromBase` and `toBase` (both between 2 and 36), and the conversion is done in one step.",
    examples: [
      { in: "255", param: "fromBase=10, toBase=16", out: "ff", desc: "decimal 255 → hex ff" },
      { in: "3735928559", param: "fromBase=10, toBase=16", out: "deadbeef", desc: "the classic 0xDEADBEEF" },
      { in: "FF", param: "fromBase=16, toBase=2", out: "11111111", desc: "hex → binary" },
    ],
    tips: [
      "Both upper- and lowercase letters are accepted; output is uniformly lowercase.",
      "Hex `deadbeef` and `cafebabe` are common \"magic numbers\" in CTF — don't be surprised to see them.",
    ],
    aka: ["进制转换", "进制互转", "radix convert", "base convert", "任意进制", "base conversion",
      "进制换算", "2-36进制", "radix conversion", "数制转换", "任意进制转换", "十六进制转二进制"],
  },

  ipv4Int: {
    what: "Converts between an IPv4 address and a 32-bit integer. Dotted-decimal like `192.168.1.1` is actually equal to a single integer between 0 and ~4.2 billion.",
    principle:
      "The four IPv4 octets are 8 bits each, joined into a 32-bit integer: `a·256³ + b·256² + c·256 + d`.\n\n" +
      "The reverse splits the integer into four octets of 8 bits each. It supports inet_aton semantics; the integer can be written in decimal / 0x hex / leading-0 octal / 0b binary.",
    usage: "Enter a dotted IPv4 address to get an integer, or enter an integer to get an IPv4. Optional integer output format (dec/hex/oct/bin).",
    examples: [
      { in: "8.8.8.8", out: "134744072", desc: "Google DNS → integer" },
      { in: "3232235777", out: "192.168.1.1", desc: "integer → private address" },
      { in: "192.168.1.1", param: "format=hex", out: "0xC0A80101", desc: "output in hex form" },
    ],
    tips: [
      "Hiding an IP as an integer is a common \"coordinate hiding\" trick; when you see a large integer under ~4.2 billion, try decoding it as an IP.",
      "`0xC0A80101` = 192.168.1.1 — each pair of hex digits maps exactly to one octet.",
    ],
    aka: ["IP 转整数", "ipv4 int", "inet_aton", "IP 十进制", "整数 IP", "ipv4 to int",
      "IP整数互转", "ip转数字", "十进制IP", "IP地址编码", "long IP", "ip2long"],
  },

  geoHash: {
    what: "Encodes latitude/longitude coordinates into a short string (Geohash) and can also decode it back to coordinates. Common in map positioning and nearby search.",
    principle:
      "Repeatedly bisect latitude and longitude within their respective ranges (recording one bit for the upper/lower half each time), interleaving bits from the two to get one long bit string.\n\n" +
      "Every 5 bits is looked up in a special base32 table that drops a/i/l/o, building up a string. More characters means higher precision.",
    usage: "Enter `lat,lon` (e.g. `39.9042,116.4074`) to encode, or enter a geohash string to decode. Precision (number of digits) is optional.",
    examples: [
      { in: "39.9042,116.4074", param: "precision=11", out: "wx4g0bm6c40", desc: "Tiananmen, Beijing" },
      { in: "48.669,-4.329", param: "precision=8", out: "gbsuv7zt", desc: "8-digit precision ≈ ±19m" },
      { in: "wx4g0bm6c40", out: "39.904201,116.4074", desc: "decode back to coordinates" },
    ],
    tips: [
      "Geohashes with the same prefix are geographically adjacent, which is why they're used for \"nearby people\" lookups.",
      "A short string without a/i/l/o that relates to a location? Suspect geohash first.",
    ],
    aka: ["geohash", "地理哈希", "坐标编码", "经纬度编码", "地理散列", "geo hash",
      "地理位置编码", "geohash编码", "空间编码", "base32坐标", "地理网格编码", "位置哈希"],
  },
};
