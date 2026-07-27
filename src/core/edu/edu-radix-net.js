// 科普内容分片：radix「网络/协议」组 4 项。纯数据，无 import 无副作用。
// ipv6Format / macFormat / cidrCalc / userAgentParse（样例均由 netcodec.js 实跑取值）
export default {
  ipv6Format: {
    what: "IPv6 地址在「规范压缩」和「完全展开」两种写法间互转。同一个地址可以写得很短也可以写得很长。",
    principle:
      "IPv6 是 8 组各 4 位十六进制（共 128 位）。RFC 5952 规范压缩规则：把最长的一段连续全零组（长度 ≥2）替换成 `::`，每组的前导零去掉；`::` 在整个地址里最多出现一次。\n\n" +
      "展开方向则相反：把 `::` 还原成足量的 `0000` 组，每组补足 4 位。",
    usage: "encode 把地址规范压缩成短写法，decode 展开成 8 组完整写法。支持末尾嵌 IPv4（如 `::ffff:1.2.3.4`）。",
    examples: [
      { in: "2001:db8::ff00:42:8329", param: "解码（展开）", out: "2001:0db8:0000:0000:0000:ff00:0042:8329" },
      { in: "2001:0db8:0000:0000:0000:ff00:0042:8329", param: "编码（压缩）", out: "2001:db8::ff00:42:8329" },
    ],
    tips: ["`::` 只能出现一次，否则无法确定省略了几组零，这是 IPv6 书写的硬规则。", "多段全零长度相同时，规范要求压缩最靠前的那一段。"],
    aka: ["ipv6", "ipv6压缩", "ipv6展开", "rfc5952", "ipv6格式化", "ipv6地址", "ipv6 compress", "ipv6 expand", "ipv6缩写", "ipv6 address", "ipv6规范化", "冒号十六进制地址"],
  },

  macFormat: {
    what: "MAC 地址（网卡物理地址）在冒号、连字符、Cisco 点分、整数四种写法间互转。48 位，自动识别你输入的格式。",
    principle:
      "MAC 是 48 位（6 字节）。常见写法：冒号 `aa:bb:cc:dd:ee:ff`、连字符 `aa-bb-cc-dd-ee-ff`、Cisco 点分 `aabb.ccdd.eeff`（每 4 hex 一段）、或直接一个十进制整数。\n\n" +
      "工具把输入统一解析成 48 位整数，再按你选的目标格式输出。",
    usage: "选输出格式（冒号/连字符/点分/整数），粘任意格式的 MAC，encode/decode 都转成目标格式。",
    examples: [
      { in: "01:23:45:67:89:ab", param: "输出=点分", out: "0123.4567.89ab" },
      { in: "01:23:45:67:89:ab", param: "输出=整数", out: "1250999896491" },
    ],
    tips: ["Cisco 设备用点分 3 段写法，Windows 用连字符，Linux/抓包多用冒号，认清来源就知道原格式。", "MAC 首字节的第 2 位（本地/全局位）和第 1 位（单播/组播位）在取证里有含义。"],
    aka: ["mac地址", "mac", "物理地址", "硬件地址", "mac格式转换", "mac address", "网卡地址", "以太网地址", "cisco点分mac", "mac冒号连字符", "48位地址", "eui-48"],
  },

  cidrCalc: {
    what: "输入一个 CIDR 网段（如 `192.168.1.0/24`），一次算清网络地址、广播地址、子网掩码、可用主机范围、IP 类别和是否私有。",
    principle:
      "CIDR 前缀 `/N` 表示掩码高 N 位为 1。网络地址 = IP 与掩码；广播地址 = 网络地址或上反掩码；可用主机数 = $2^{32-N}-2$（去掉网络号和广播号）。\n\n" +
      "`/31` 是点对点特例（RFC 3021，2 个可用地址），`/32` 是单主机。",
    usage: "直接粘 `A.B.C.D/N` 形式的网段，run 输出完整子网信息。",
    examples: [
      { in: "192.168.1.0/24", out: "子网掩码:    255.255.255.0\n广播地址:    192.168.1.255\n主机最小:    192.168.1.1\n主机最大:    192.168.1.254\n主机数量:    254", desc: "节选" },
    ],
    formulas: [
      { tex: "\\text{可用主机数} = 2^{32-N} - 2", caption: "N 为前缀长度（/31、/32 例外）" },
    ],
    tips: ["`/24` 是最常见的家用/小办公网段，256 个地址减去网络号和广播号剩 254 个可用。", "10.x、172.16-31.x、192.168.x 是三段私有地址，工具会标「私有」。"],
    aka: ["cidr", "子网计算", "subnet", "网段计算", "ip子网", "cidr calculator", "子网掩码计算", "subnet calculator", "无类域间路由", "网络地址计算", "ip网段", "掩码计算器"],
  },

  userAgentParse: {
    what: "解析浏览器的 User-Agent 字符串，拆出浏览器、渲染引擎、操作系统和设备类型。日志分析、流量取证常用。",
    principle:
      "UA 是浏览器自报家门的一串标识。工具按特征子串按优先级匹配：先认 Edge/Opera（都基于 Chromium，须在 Chrome 之前判），再 Firefox/Chrome/Safari；引擎分 Trident/Gecko/Blink/WebKit；OS 看 `Windows NT x.x`、`Android`、`Mac OS X` 等版本号映射。",
    usage: "直接粘一整条 UA 字符串，run 输出结构化解析结果。",
    examples: [
      { in: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", out: "浏览器:     Chrome 120.0.0.0\n引擎:       Blink 120.0.0.0\n操作系统:   Windows 10/11\n设备类型:   桌面", desc: "节选" },
    ],
    tips: ["几乎所有 UA 都以 `Mozilla/5.0` 开头，这是历史遗留的兼容伪装，别当真。", "`Windows NT 10.0` 同时代表 Win10 和 Win11（UA 层面不区分），别被骗。"],
    aka: ["user agent", "ua解析", "浏览器标识", "ua", "用户代理", "user-agent parser", "ua字符串解析", "user agent string", "浏览器指纹", "ua识别", "浏览器版本识别", "客户端标识解析"],
  },
};
