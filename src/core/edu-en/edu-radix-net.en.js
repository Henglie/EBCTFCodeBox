// English edu shard: radix "network/protocol" family — 4 ops. Pure data, no imports, no side effects.
// ipv6Format / macFormat / cidrCalc / userAgentParse (all example values are taken from real runs of netcodec.js)
export default {
  ipv6Format: {
    what: "Converts an IPv6 address between its \"canonical compressed\" and \"fully expanded\" forms. The same address can be written very short or very long.",
    principle:
      "IPv6 is 8 groups of 4 hex digits each (128 bits total). RFC 5952 canonical compression rules: replace the longest run of consecutive all-zero groups (length ≥2) with `::`, and drop the leading zeros of each group; `::` may appear at most once in the whole address.\n\n" +
      "Expansion goes the other way: restore `::` back into enough `0000` groups and pad each group to 4 digits.",
    usage: "encode compresses the address canonically into the short form, decode expands it into the full 8-group form. Supports a trailing embedded IPv4 (e.g. `::ffff:1.2.3.4`).",
    examples: [
      { in: "2001:db8::ff00:42:8329", param: "Decode (expand)", out: "2001:0db8:0000:0000:0000:ff00:0042:8329" },
      { in: "2001:0db8:0000:0000:0000:ff00:0042:8329", param: "Encode (compress)", out: "2001:db8::ff00:42:8329" },
    ],
    tips: ["`::` can appear only once, otherwise you couldn't tell how many zero groups were omitted — this is a hard rule of IPv6 notation.", "When multiple all-zero runs have the same length, the standard requires compressing the earliest one."],
    aka: ["ipv6", "ipv6压缩", "ipv6展开", "rfc5952", "ipv6格式化", "ipv6地址", "ipv6 compress", "ipv6 expand", "ipv6缩写", "ipv6 address", "ipv6规范化", "冒号十六进制地址"],
  },

  macFormat: {
    what: "Converts a MAC address (a network card's physical address) between colon, hyphen, Cisco dotted, and integer forms. 48 bits, auto-detects the format you enter.",
    principle:
      "A MAC is 48 bits (6 bytes). Common forms: colon `aa:bb:cc:dd:ee:ff`, hyphen `aa-bb-cc-dd-ee-ff`, Cisco dotted `aabb.ccdd.eeff` (4 hex per group), or just a decimal integer.\n\n" +
      "The tool parses the input into a unified 48-bit integer, then outputs it in the target format you choose.",
    usage: "Choose the output format (colon/hyphen/dotted/integer), paste a MAC in any format, and both encode/decode convert it into the target format.",
    examples: [
      { in: "01:23:45:67:89:ab", param: "Output=dotted", out: "0123.4567.89ab" },
      { in: "01:23:45:67:89:ab", param: "Output=integer", out: "1250999896491" },
    ],
    tips: ["Cisco devices use the dotted 3-group form, Windows uses hyphens, Linux/packet captures mostly use colons — recognize the source and you know the original format.", "In forensics, bit 2 (local/global) and bit 1 (unicast/multicast) of the MAC's first byte carry meaning."],
    aka: ["mac地址", "mac", "物理地址", "硬件地址", "mac格式转换", "mac address", "网卡地址", "以太网地址", "cisco点分mac", "mac冒号连字符", "48位地址", "eui-48"],
  },

  cidrCalc: {
    what: "Enter a CIDR block (e.g. `192.168.1.0/24`) and get, in one shot, the network address, broadcast address, subnet mask, usable host range, IP class, and whether it's private.",
    principle:
      "A CIDR prefix `/N` means the top N bits of the mask are 1. Network address = IP AND mask; broadcast address = network address OR the inverted mask; usable host count = $2^{32-N}-2$ (excluding the network and broadcast addresses).\n\n" +
      "`/31` is the point-to-point special case (RFC 3021, 2 usable addresses), `/32` is a single host.",
    usage: "Paste a block in `A.B.C.D/N` form directly, run outputs the full subnet info.",
    examples: [
      { in: "192.168.1.0/24", out: "子网掩码:    255.255.255.0\n广播地址:    192.168.1.255\n主机最小:    192.168.1.1\n主机最大:    192.168.1.254\n主机数量:    254", desc: "excerpt" },
    ],
    formulas: [
      { tex: "\\text{可用主机数} = 2^{32-N} - 2", caption: "N is the prefix length (/31, /32 are exceptions)" },
    ],
    tips: ["`/24` is the most common home/small-office block: 256 addresses minus the network and broadcast addresses leaves 254 usable.", "10.x, 172.16-31.x, and 192.168.x are the three private address ranges; the tool marks them \"private\"."],
    aka: ["cidr", "子网计算", "subnet", "网段计算", "ip子网", "cidr calculator", "子网掩码计算", "subnet calculator", "无类域间路由", "网络地址计算", "ip网段", "掩码计算器"],
  },

  userAgentParse: {
    what: "Parses a browser's User-Agent string, breaking out the browser, rendering engine, operating system, and device type. Common in log analysis and traffic forensics.",
    principle:
      "The UA is a string a browser self-reports. The tool matches characteristic substrings by priority: first Edge/Opera (both Chromium-based, must be checked before Chrome), then Firefox/Chrome/Safari; engines split into Trident/Gecko/Blink/WebKit; the OS is read from version-number mappings like `Windows NT x.x`, `Android`, `Mac OS X`.",
    usage: "Paste a full UA string directly, run outputs the structured parse result.",
    examples: [
      { in: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", out: "浏览器:     Chrome 120.0.0.0\n引擎:       Blink 120.0.0.0\n操作系统:   Windows 10/11\n设备类型:   桌面", desc: "excerpt" },
    ],
    tips: ["Almost every UA starts with `Mozilla/5.0` — this is a legacy compatibility disguise, don't take it at face value.", "`Windows NT 10.0` represents both Win10 and Win11 (the UA doesn't distinguish them), so don't be fooled."],
    aka: ["user agent", "ua解析", "浏览器标识", "ua", "用户代理", "user-agent parser", "ua字符串解析", "user agent string", "浏览器指纹", "ua识别", "浏览器版本识别", "客户端标识解析"],
  },
};
