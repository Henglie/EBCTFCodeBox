/*
 * netcodec.js — 网络/协议编码组（cat:'radix'）。
 *
 * 覆盖：
 * - IPv4 ↔ 整数/hex（点分十进制 + 0x / 八进制 / 0b 变体，inet_aton 语义）
 * - IPv6 压缩（RFC 5952 规范）↔ 展开（8 组 4 位十六进制）
 * - MAC 地址格式互转（冒号 / 连字符 / 点分 / 整数，48 位）
 * - CIDR 子网计算（网络/广播/掩码/反掩码/主机范围/IP 类/私有段，单向 run）
 * - User-Agent 解析（浏览器/引擎/OS/设备，单向 run）
 *
 * 红线说明（已查 id）：
 * - URL 百分号编码（standard/full/plus 三模式）已由 text.js id:"url" 提供。
 * - Punycode（RFC 3492 IDN）已由 textExt.js id:"punycode" 提供。
 * 注册表对重复 id 抛错，且红线禁止改现有 core/*.js，故本文件不重复注册这两项；
 * textExt.js 的 punycode 已用 RFC 3492 §7 官方向量对拍验证。
 *
 * 纯算法，无外部依赖。encode/decode 用往返测试验证。
 */
import { register } from "./registry.js";

// ============ 通用：无符号整数解析（0x/0o/0b/前导0八进制/十进制，BigInt 防溢出） ============
const RADIX_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";

function parseBigRadixBody(s, base) {
  let n = 0n;
  const b = BigInt(base);
  for (const ch of s) {
    const v = RADIX_CHARS.indexOf(ch);
    if (v < 0 || v >= base) throw new Error("字符 '" + ch + "' 不在基数 " + base + " 字符集");
    n = n * b + BigInt(v);
  }
  return n;
}

// 自动识别 0x (十六进制) / 0o (八进制) / 0b (二进制) / 前导 0 (八进制，inet_aton 语义) / 十进制
function parseUintStrAuto(s) {
  const t = String(s).trim().toLowerCase();
  if (!t) throw new Error("空数字");
  if (t[0] === "-" || t[0] === "+") throw new Error("不允许符号: " + s);
  if (t.startsWith("0x")) return parseBigRadixBody(t.slice(2), 16);
  if (t.startsWith("0o")) return parseBigRadixBody(t.slice(2), 8);
  if (t.startsWith("0b")) return parseBigRadixBody(t.slice(2), 2);
 // 前导 0 且全 0-7 → 八进制（inet_aton 变体）；单个 "0" 仍按十进制
  if (t.length > 1 && t[0] === "0" && /^[0-7]+$/.test(t)) return parseBigRadixBody(t.slice(1), 8);
  if (!/^[0-9]+$/.test(t)) throw new Error("无效整数: " + s);
  return parseBigRadixBody(t, 10);
}

// 按声明基数解析裸串（无 0x/0o/0b 前缀、无点分）。format 已明示基数，
// 故不再要求前缀；其余情形交回 parseUintStrAuto 自动识别。
const FORMAT_BASE = { hex: 16, oct: 8, bin: 2 };

function ipv4ToIntWithFormat(str, format) {
  const s = String(str).trim();
  const base = FORMAT_BASE[format];
  if (base && s && !s.includes(".") && !/^0[xob]/i.test(s)) {
    const n = parseBigRadixBody(s.toLowerCase(), base);
    if (n > 0xFFFFFFFFn) throw new Error("IPv4 整数超出 32 位: " + s);
    return n;
  }
  return ipv4ToInt(s);
}

// ============ 1. IPv4 ↔ 整数/hex ============
// 解析支持：标准点分十进制 / 每段 0x 或八进制变体 / 单整数 / inet_aton 压缩形式 (a / a.b / a.b.c)
function ipv4ToInt(str) {
  const s = String(str).trim();
  if (!s) throw new Error("IPv4: 空输入");
  if (!s.includes(".")) {
    const n = parseUintStrAuto(s);
    if (n > 0xFFFFFFFFn) throw new Error("IPv4 整数超出 32 位: " + s);
    return n;
  }
  const parts = s.split(".");
  if (parts.length > 4) throw new Error("IPv4 段数 > 4: " + s);
  const nums = parts.map((p) => parseUintStrAuto(p));
  let result;
  if (nums.length === 4) {
    for (const n of nums) if (n > 255n) throw new Error("IPv4 段 > 255: " + s);
    result = (nums[0] << 24n) | (nums[1] << 16n) | (nums[2] << 8n) | nums[3];
  } else if (nums.length === 3) {
 // a.b.c：a、b 须 <=255，c 承载低 16 位（<=65535）
    if (nums[0] > 255n || nums[1] > 255n) throw new Error("IPv4 段 > 255: " + s);
    if (nums[2] > 0xFFFFn) throw new Error("IPv4 末段 > 65535: " + s);
    result = (nums[0] << 24n) | (nums[1] << 16n) | nums[2];
  } else if (nums.length === 2) {
 // a.b：a 须 <=255，b 承载低 24 位（<=16777215）
    if (nums[0] > 255n) throw new Error("IPv4 首段 > 255: " + s);
    if (nums[1] > 0xFFFFFFn) throw new Error("IPv4 末段 > 16777215: " + s);
    result = (nums[0] << 24n) | nums[1];
  } else {
    result = nums[0]; // 1 段（无点分支已处理，此处防御）
  }
  if (result > 0xFFFFFFFFn) throw new Error("IPv4 超出 32 位: " + s);
  return result;
}

function intToIpv4(n) {
  if (n < 0n || n > 0xFFFFFFFFn) throw new Error("IPv4 整数超出 32 位: " + n.toString());
  const a = Number((n >> 24n) & 0xFFn);
  const b = Number((n >> 16n) & 0xFFn);
  const c = Number((n >> 8n) & 0xFFn);
  const d = Number(n & 0xFFn);
  return a + "." + b + "." + c + "." + d;
}

// bare=true 省去 0x/0b/前导 0 标记（外部工具多输出裸串 c0a80101）
function intToFormat(n, fmt, bare) {
  if (fmt === "dec") return n.toString(10);
  if (fmt === "hex") {
    const h = n.toString(16).toUpperCase().padStart(8, "0");
    return bare ? h.toLowerCase() : "0x" + h;
  }
  if (fmt === "oct") {
    const o = n.toString(8).padStart(11, "0"); // 32 位 → 11 位八进制
    return bare ? o : "0" + o;
  }
  if (fmt === "bin") {
    const b = n.toString(2).padStart(32, "0");
    return bare ? b : "0b" + b;
  }
  throw new Error("未知格式: " + fmt);
}

// ============ 2. IPv6 压缩/展开 ============
// 解析返回 8 个 16-bit 组（数组），支持 :: 压缩与末尾嵌入式 IPv4 (::ffff:1.2.3.4)
function parseIpv6(str) {
  let s = String(str).trim();
  if (!s) throw new Error("IPv6: 空输入");
 // 末尾嵌入式 IPv4 → 转为 2 个 16-bit 组
  const lastColon = s.lastIndexOf(":");
  if (lastColon >= 0 && s.slice(lastColon + 1).includes(".")) {
    const v4Part = s.slice(lastColon + 1);
    const v4Int = ipv4ToInt(v4Part);
    const hi = Number((v4Int >> 16n) & 0xFFFFn);
    const lo = Number(v4Int & 0xFFFFn);
    s = s.slice(0, lastColon + 1) + hi.toString(16) + ":" + lo.toString(16);
  }
 // 拆 ::（至多一个）
  const parts = s.split("::");
  if (parts.length > 2) throw new Error("IPv6: 多个 :: 非法: " + str);
  let left, right;
  if (parts.length === 2) {
    left = parts[0] ? parts[0].split(":") : [];
    right = parts[1] ? parts[1].split(":") : [];
  } else {
    left = parts[0].split(":");
    right = [];
  }
  const total = left.length + right.length;
  if (parts.length === 1) {
    if (total !== 8) throw new Error("IPv6: 非压缩形式须 8 组，实际 " + total + ": " + str);
  } else {
    if (total >= 8) throw new Error("IPv6: :: 压缩但组数 >= 8: " + str);
  }
  const missing = 8 - total;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8) throw new Error("IPv6: 解析后组数 != 8: " + str);
  return groups.map((g) => {
    if (g === "") throw new Error("IPv6: 空组: " + str);
    const n = parseInt(g, 16);
    if (Number.isNaN(n) || n < 0 || n > 0xFFFF) throw new Error("IPv6: 非法组 '" + g + "': " + str);
    return n;
  });
}

// 全展开：8 组 4 位十六进制，冒号分隔
function ipv6Expand(groups) {
  return groups.map((g) => g.toString(16).padStart(4, "0")).join(":");
}

// RFC 5952 规范压缩：最长连续 0 段（>=2）→ ::；并列取第一段；不压缩单 0
function ipv6Compress(groups) {
  const hex = groups.map((g) => g.toString(16));
  let bestStart = -1, bestLen = 0;
  let curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === 0) {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else {
      curStart = -1; curLen = 0;
    }
  }
  if (bestLen < 2) return hex.join(":");
  const before = hex.slice(0, bestStart);
  const after = hex.slice(bestStart + bestLen);
  return before.join(":") + "::" + after.join(":");
}

// ============ 3. MAC 地址格式互转 ============
// 解析支持：冒号/连字符（6 段）、点分（3 段）、整数（0x 或十进制）；返回 48 位 BigInt
function parseMac(str) {
  const s = String(str).trim().toLowerCase();
  if (!s) throw new Error("MAC: 空输入");
 // 整数形式（无任何分隔符）
  if (!s.includes(":") && !s.includes("-") && !s.includes(".")) {
    const n = parseUintStrAuto(s);
    if (n > 0xFFFFFFFFFFFFn) throw new Error("MAC 整数超出 48 位: " + str);
    return n;
  }
  let hexStr;
  if (s.includes(".")) {
 // 点分 Cisco 格式：aaaa.bbbb.cccc
    const parts = s.split(".");
    if (parts.length !== 3) throw new Error("MAC 点分格式须 3 段: " + str);
    hexStr = parts.join("");
  } else {
 // 冒号或连字符：6 段
    const parts = s.split(/[:-]/);
    if (parts.length !== 6) throw new Error("MAC 冒号/连字符格式须 6 段: " + str);
    hexStr = parts.join("");
  }
  if (!/^[0-9a-f]{12}$/.test(hexStr)) throw new Error("MAC 非法十六进制: " + str);
  return BigInt("0x" + hexStr);
}

function intToMac(n, fmt) {
  if (n < 0n || n > 0xFFFFFFFFFFFFn) throw new Error("MAC 整数超出 48 位: " + n.toString());
  const hex = n.toString(16).padStart(12, "0");
  if (fmt === "colon") return hex.match(/.{2}/g).join(":");
  if (fmt === "hyphen") return hex.match(/.{2}/g).join("-");
  if (fmt === "dot") return hex.match(/.{4}/g).join(".");
  if (fmt === "int") return n.toString(10);
  throw new Error("未知 MAC 格式: " + fmt);
}

// ============ 4. CIDR 子网计算（run，单向） ============
function ipv4Class(n) {
  const a = Number((n >> 24n) & 0xFFn);
  if (a < 128) return "A 类";
  if (a < 192) return "B 类";
  if (a < 224) return "C 类";
  if (a < 240) return "D 类（组播）";
  return "E 类（保留）";
}

function isPrivateIp(n) {
  const a = Number((n >> 24n) & 0xFFn);
  const b = Number((n >> 16n) & 0xFFn);
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true;          // 192.168.0.0/16
  return false;
}

function cidrCalc(text) {
  const s = String(text).trim();
  const m = s.match(/^([\d.]+)\/(\d+)$/);
  if (!m) throw new Error("CIDR: 格式须为 A.B.C.D/N: " + text);
  const ipInt = ipv4ToInt(m[1]);
  const prefix = Number(m[2]);
  if (prefix < 0 || prefix > 32) throw new Error("CIDR 前缀须 0-32: " + prefix);
  const mask = prefix === 0 ? 0n : (0xFFFFFFFFn << BigInt(32 - prefix)) & 0xFFFFFFFFn;
  const network = ipInt & mask;
  const wildcard = (~mask) & 0xFFFFFFFFn;
  const broadcast = network | wildcard;
  let hostMin, hostMax, hostCount;
  if (prefix === 32) {            // 单主机：网络==广播==主机
    hostMin = network; hostMax = network; hostCount = 1n;
  } else if (prefix === 31) {     // RFC 3021 点对点：无网络/广播保留
    hostMin = network; hostMax = broadcast; hostCount = 2n;
  } else {
    hostMin = network + 1n; hostMax = broadcast - 1n;
    hostCount = (1n << BigInt(32 - prefix)) - 2n;
  }
  const lines = [
    "CIDR:        " + intToIpv4(ipInt) + "/" + prefix,
    "IP 地址:     " + intToIpv4(ipInt) + "  (" + ipv4Class(ipInt) + "，" + (isPrivateIp(ipInt) ? "私有" : "公共") + ")",
    "前缀长度:    /" + prefix,
    "子网掩码:    " + intToIpv4(mask) + "  (0x" + mask.toString(16).padStart(8, "0").toUpperCase() + ")",
    "反掩码:      " + intToIpv4(wildcard),
    "网络地址:    " + intToIpv4(network),
    "广播地址:    " + intToIpv4(broadcast),
    "主机最小:    " + intToIpv4(hostMin),
    "主机最大:    " + intToIpv4(hostMax),
    "主机数量:    " + hostCount.toString(),
    "IP 整数:     " + ipInt.toString() + "  (0x" + ipInt.toString(16).padStart(8, "0").toUpperCase() + ")",
  ];
  return lines.join("\n");
}

// ============ 5. User-Agent 解析（run，单向） ============
function parseUserAgent(text) {
  const ua = String(text).trim();
  if (!ua) throw new Error("UA: 空输入");
  const out = [];
  out.push("原始 UA:    " + (ua.length > 80 ? ua.slice(0, 80) + " …" : ua));

 // 浏览器（顺序敏感：Edge/Opera 基于 Chromium，须先于 Chrome 判定）
  let browser = "未知", browserVer = "";
  let m;
  if ((m = ua.match(/Edg\/([\d.]+)/))) { browser = "Microsoft Edge"; browserVer = m[1]; }
  else if ((m = ua.match(/OPR\/([\d.]+)/))) { browser = "Opera"; browserVer = m[1]; }
  else if ((m = ua.match(/MSIE ([\d.]+)/))) { browser = "Internet Explorer"; browserVer = m[1]; }
  else if ((m = ua.match(/Trident\/[\d.]+.*rv:([\d.]+)/))) { browser = "Internet Explorer"; browserVer = m[1]; }
  else if ((m = ua.match(/Firefox\/([\d.]+)/))) { browser = "Firefox"; browserVer = m[1]; }
  else if ((m = ua.match(/Chrome\/([\d.]+)/))) { browser = "Chrome"; browserVer = m[1]; }
  else if ((m = ua.match(/Version\/([\d.]+).*Safari/))) { browser = "Safari"; browserVer = m[1]; }
  else if (/Safari/.test(ua)) { browser = "Safari"; browserVer = ""; }
  out.push("浏览器:     " + browser + (browserVer ? " " + browserVer : ""));

 // 引擎（Trident → Gecko → Blink → WebKit 优先级）
  let engine = "未知", engineVer = "";
  if ((m = ua.match(/Trident\/([\d.]+)/))) { engine = "Trident"; engineVer = m[1]; }
  else if (/Gecko\/[\d.]+/.test(ua) && !/Chrome\//.test(ua)) {
    engine = "Gecko";
    const mm = ua.match(/rv:([\d.]+)/); engineVer = mm ? mm[1] : "";
  }
  else if ((m = ua.match(/Chrome\/([\d.]+)/))) { engine = "Blink"; engineVer = m[1]; }
  else if ((m = ua.match(/AppleWebKit\/([\d.]+)/))) { engine = "WebKit"; engineVer = m[1]; }
  out.push("引擎:       " + engine + (engineVer ? " " + engineVer : ""));

 // 操作系统
  let os = "未知", osVer = "";
  const winNt = ua.match(/Windows NT ([\d.]+)/);
  const winMap = {
    "10.0": "10/11", "6.3": "8.1", "6.2": "8", "6.1": "7", "6.0": "Vista",
    "5.1": "XP", "5.2": "XP x64/Server 2003", "5.0": "2000",
  };
  if (winNt) { os = "Windows"; osVer = winMap[winNt[1]] || ("NT " + winNt[1]); }
  else if (/iPad/.test(ua)) {
    os = "iPadOS";
    const mm = ua.match(/OS (\d+[_\d]*)/); osVer = mm ? mm[1].replace(/_/g, ".") : "";
  }
  else if (/iPhone|iPod/.test(ua)) {
    os = "iOS";
    const mm = ua.match(/OS (\d+[_\d]*)/); osVer = mm ? mm[1].replace(/_/g, ".") : "";
  }
  else if ((m = ua.match(/Android ([\d.]+)/))) { os = "Android"; osVer = m[1]; }
  else if ((m = ua.match(/Mac OS X ([\d_.]+)/))) { os = "macOS"; osVer = m[1].replace(/_/g, "."); }
  else if (/CrOS/.test(ua)) { os = "Chrome OS"; osVer = ""; }
  else if (/Linux/.test(ua)) { os = "Linux"; osVer = ""; }
  out.push("操作系统:   " + os + (osVer ? " " + osVer : ""));

 // 设备类型
  let device = "桌面";
  if (/iPad|Tablet/.test(ua)) device = "平板";
  else if (/Mobi|iPhone|Android.*Mobile/.test(ua)) device = "手机";
  out.push("设备类型:   " + device);

 // 设备型号（部分移动端 UA 含明文型号）
 // iPhone: (iPhone; CPU iPhone OS X_Y like Mac OS X)
 // Android: (Linux; Android <ver>; <model>)
  let devModel = "";
  const iphoneDev = ua.match(/\((iPhone); ([^)]+)\)/);
  if (iphoneDev) devModel = iphoneDev[2];
  else {
    const androidDev = ua.match(/\(Linux; Android [\d.]+; ([^)]+)\)/);
    if (androidDev) devModel = androidDev[1];
  }
  if (devModel) out.push("设备型号:   " + devModel);

  return out.join("\n");
}

// ============ 注册 ============
register({
  id: "ipv4Int", cat: "radix", name: "IPv4 ↔ 整数",
  desc: "IPv4 点分十进制 ↔ 32 位整数（支持 0x/八进制/0b 变体，inet_aton 语义）",
  params: [
    { key: "format", label: "整数格式", type: "select", default: "dec", options: [
      { value: "dec", label: "十进制" },
      { value: "hex", label: "十六进制 (0x)" },
      { value: "oct", label: "八进制 (前导 0)" },
      { value: "bin", label: "二进制 (0b)" },
    ] },
    { key: "compat", label: "兼容模式（输出不带 0x/0b/前导 0 标记）", type: "bool", default: false },
  ],
  encode: (t, p) => { const n = ipv4ToInt(t); return intToFormat(n, (p && p.format) || "dec", p && p.compat); },
 // decode 尊重 format：无前缀裸串按所选基数解（外部工具常输出不带 0x 的 c0a80101）；
 // 带前缀或点分形式仍走自动识别
  decode: (t, p) => intToIpv4(ipv4ToIntWithFormat(t, (p && p.format) || "dec")),
});

// ============ IPv6 详细报告（CyberChef Parse IPv6 address 口径） ============
function ipv4Pair(hi, lo) {
  return intToIpv4((BigInt(hi) << 16n) | BigInt(lo));
}

function ipv6DetailedReport(text) {
  const g = parseIpv6(text);
  const longhand = ipv6Expand(g);
  const shorthand = ipv6Compress(g);
  let out = "Longhand:  " + longhand + "\nShorthand: " + shorthand + "\n";

  if (shorthand === "::") {
    out += "\nUnspecified address corresponding to 0.0.0.0/32 in IPv4.";
    out += "\nUnspecified address range: ::/128";
  } else if (shorthand === "::1") {
    out += "\nLoopback address to the local host corresponding to 127.0.0.1/8 in IPv4.";
    out += "\nLoopback addresses range: ::1/128";
  } else if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0xffff) {
    out += "\nIPv4-mapped IPv6 address detected. IPv6 clients will be handled natively by default, and IPv4 clients appear as IPv6 clients at their IPv4-mapped IPv6 address.";
    out += "\nMapped IPv4 address: " + ipv4Pair(g[6], g[7]);
    out += "\nIPv4-mapped IPv6 addresses range: ::ffff:0:0/96";
  } else if (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0xffff && g[5] === 0) {
    out += "\nIPv4-translated address detected. Used by Stateless IP/ICMP Translation (SIIT). See RFCs 6145 and 6052 for more details.";
    out += "\nTranslated IPv4 address: " + ipv4Pair(g[6], g[7]);
    out += "\nIPv4-translated addresses range: ::ffff:0:0:0/96";
  } else if (g[0] === 0x100) {
    out += "\nDiscard prefix detected. This is used when forwarding traffic to a sinkhole router to mitigate the effects of a denial-of-service attack. See RFC 6666 for more details.";
    out += "\nDiscard range: 100::/64";
  } else if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0) {
    out += "\n'Well-Known' prefix for IPv4/IPv6 translation detected. See RFC 6052 for more details.";
    out += "\nTranslated IPv4 address: " + ipv4Pair(g[6], g[7]);
    out += "\n'Well-Known' prefix range: 64:ff9b::/96";
  } else if (g[0] === 0x2001 && g[1] === 0) {
    out += "\nTeredo tunneling IPv6 address detected\n";
    const serverIpv4 = (g[2] << 16) + g[3];
    const udpPort = (~g[5]) & 0xffff;
    const clientIpv4 = ~((g[6] << 16) + g[7]);
    const flagCone = (g[4] >>> 15) & 1;
    const flagR = (g[4] >>> 14) & 1;
    const flagRandom1 = (g[4] >>> 10) & 15;
    const flagUg = (g[4] >>> 8) & 3;
    const flagRandom2 = g[4] & 255;
    out += "\nServer IPv4 address: " + intToIpv4(BigInt(serverIpv4 >>> 0)) +
      "\nClient IPv4 address: " + intToIpv4(BigInt(clientIpv4 >>> 0)) +
      "\nClient UDP port:     " + udpPort +
      "\nFlags:" +
      "\n\tCone:    " + flagCone + (flagCone ? " (Client is behind a cone NAT)" : " (Client is not behind a cone NAT)");
    out += "\n\tR:       " + flagR + (flagR ? " Error: This flag should be set to 0. See RFC 5991 and RFC 4380." : "");
    out += "\n\tRandom1: " + flagRandom1.toString(2).padStart(4, "0") +
      "\n\tUG:      " + flagUg.toString(2).padStart(2, "0") + (flagUg ? " Error: This flag should be set to 00. See RFC 4380." : "");
    out += "\n\tRandom2: " + flagRandom2.toString(2).padStart(8, "0");
    if (!flagR && !flagUg && flagRandom1 && flagRandom2) {
      out += "\n\nThis is a valid Teredo address which complies with RFC 4380 and RFC 5991.";
    } else if (!flagR && !flagUg) {
      out += "\n\nThis is a valid Teredo address which complies with RFC 4380, however it does not comply with RFC 5991 (Teredo Security Updates) as there are no randomised bits in the flag field.";
    } else {
      out += "\n\nThis is an invalid Teredo address.";
    }
    out += "\n\nTeredo prefix range: 2001::/32";
  } else if (g[0] === 0x2001 && g[1] === 0x2 && g[2] === 0) {
    out += "\nAssigned to the Benchmarking Methodology Working Group (BMWG) for benchmarking IPv6. Corresponds to 198.18.0.0/15 for benchmarking IPv4. See RFC 5180 for more details.";
    out += "\nBMWG range: 2001:2::/48";
  } else if (g[0] === 0x2001 && g[1] >= 0x10 && g[1] <= 0x1f) {
    out += "\nDeprecated, previously ORCHIDv1 (Overlay Routable Cryptographic Hash Identifiers).\nORCHIDv1 range: 2001:10::/28\nORCHIDv2 now uses 2001:20::/28.";
  } else if (g[0] === 0x2001 && g[1] >= 0x20 && g[1] <= 0x2f) {
    out += "\nORCHIDv2 (Overlay Routable Cryptographic Hash Identifiers).\nThese are non-routed IPv6 addresses used for Cryptographic Hash Identifiers.";
    out += "\nORCHIDv2 range: 2001:20::/28";
  } else if (g[0] === 0x2001 && g[1] === 0xdb8) {
    out += "\nThis is a documentation IPv6 address. This range should be used whenever an example IPv6 address is given or to model networking scenarios. Corresponds to 192.0.2.0/24, 198.51.100.0/24, and 203.0.113.0/24 in IPv4.";
    out += "\nDocumentation range: 2001:db8::/32";
  } else if (g[0] === 0x2002) {
    out += "\n6to4 transition IPv6 address detected. See RFC 3056 for more details.\n6to4 prefix range: 2002::/16";
    const v4Addr = ipv4Pair(g[1], g[2]);
    const slaId = g[3];
    const interfaceIdStr = g[4].toString(16) + g[5].toString(16) + g[6].toString(16) + g[7].toString(16);
    const interfaceId = BigInt("0x" + interfaceIdStr).toString(10);
    out += "\n\nEncapsulated IPv4 address: " + v4Addr +
      "\nSLA ID: " + slaId +
      "\nInterface ID (base 16): " + interfaceIdStr +
      "\nInterface ID (base 10): " + interfaceId;
  } else if (g[0] >= 0xfc00 && g[0] <= 0xfdff) {
    out += "\nThis is a unique local address comparable to the IPv4 private addresses 10.0.0.0/8, 172.16.0.0/12 and 192.168.0.0/16. See RFC 4193 for more details.\nUnique local addresses range: fc00::/7";
  } else if (g[0] >= 0xfe80 && g[0] <= 0xfebf) {
    out += "\nThis is a link-local address comparable to the auto-configuration addresses 169.254.0.0/16 in IPv4.\nLink-local addresses range: fe80::/10";
  } else if (g[0] >= 0xff00) {
    out += "\nThis is a reserved multicast address.\nMulticast addresses range: ff00::/8";
    const scope = {
      0xff01: "Reserved Multicast Block for Interface Local Scope",
      0xff02: "Reserved Multicast Block for Link Local Scope",
      0xff03: "Reserved Multicast Block for Realm Local Scope",
      0xff04: "Reserved Multicast Block for Admin Local Scope",
      0xff05: "Reserved Multicast Block for Site Local Scope",
      0xff08: "Reserved Multicast Block for Organisation Local Scope",
      0xff0e: "Reserved Multicast Block for Global Scope",
    }[g[0]];
    if (scope) out += "\n\n" + scope;
    if (g[6] === 1) {
      if (g[7] === 2) out += "\nReserved Multicast Address for 'All DHCP Servers and Relay Agents (defined in RFC3315)'";
      else if (g[7] === 3) out += "\nReserved Multicast Address for 'All LLMNR Hosts (defined in RFC4795)'";
    } else {
      const names = {
        1: "All nodes", 2: "All routers", 5: "OSPFv3 - All OSPF routers", 6: "OSPFv3 - All Designated Routers",
        8: "IS-IS for IPv6 Routers", 9: "RIP Routers", 0xa: "EIGRP Routers", 0xc: "Simple Service Discovery Protocol",
        0xd: "PIM Routers", 0x16: "MLDv2 Reports (defined in RFC3810)",
        0x6b: "Precision Time Protocol v2 Peer Delay Measurement Messages", 0xfb: "Multicast DNS",
        0x101: "Network Time Protocol", 0x108: "Network Information Service", 0x114: "Experiments",
        0x181: "Precision Time Protocol v2 Messages (exc. Peer Delay)",
      }[g[7]];
      if (names) out += "\nReserved Multicast Address for '" + names + "'";
    }
  }

  if ((g[5] & 0xff) === 0xff && (g[6] >>> 8) === 0xfe) {
    out += "\n\nThis IPv6 address contains a modified EUI-64 address, identified by the presence of FF:FE in the 12th and 13th octets.";
    const hx = (n) => n.toString(16).padStart(2, "0");
    const intIdent = [g[4] >>> 8, g[4] & 0xff, g[5] >>> 8, g[5] & 0xff, g[6] >>> 8, g[6] & 0xff, g[7] >>> 8, g[7] & 0xff].map(hx).join(":");
    const mac = [(g[4] >>> 8) ^ 2, g[4] & 0xff, g[5] >>> 8, g[6] & 0xff, g[7] >>> 8, g[7] & 0xff].map(hx).join(":");
    out += "\nInterface identifier: " + intIdent + "\nMAC address:          " + mac;
  }
  return out;
}

// ============ IPv4/IPv6 区间解析（CyberChef Parse IP range 口径） ============
function v4Mask(prefix) {
  if (prefix <= 0) return 0n;
  return (0xFFFFFFFFn << BigInt(32 - prefix)) & 0xFFFFFFFFn;
}

function v4CidrReport(ipInt, prefix, inc, enumerate, allowLarge) {
  if (prefix < 0 || prefix > 31) throw new Error("IPv4 CIDR must be less than 32");
  const mask = v4Mask(prefix);
  const ip1 = ipInt & mask;
  const ip2 = ip1 | ((~mask) & 0xFFFFFFFFn);
  const total = (ip2 - ip1 + 1n).toString();
  let out = "";
  if (inc) {
    out += "Network: " + intToIpv4(ipInt) + "\n";
    out += "CIDR: " + prefix + "\n";
    out += "Mask: " + intToIpv4(mask) + "\n";
    out += "Range: " + intToIpv4(ip1) + " - " + intToIpv4(ip2) + "\n";
    out += "Total addresses in range: " + total + "\n\n";
  }
  if (enumerate) {
    if (prefix >= 16 || allowLarge) {
      const arr = [];
      for (let n = ip1; n <= ip2; n++) arr.push(intToIpv4(n));
      out += arr.join("\n");
    } else {
      out += LARGE_RANGE_ERROR;
    }
  }
  return out;
}

function v4HyphenReport(ip1, ip2, inc, enumerate, allowLarge) {
  let diff = ip1 ^ ip2;
  let cidr = 32;
  let mask = 0n;
  while (diff !== 0n) {
    diff >>= 1n;
    cidr--;
    mask = (mask << 1n) | 1n;
  }
  mask = (~mask) & 0xFFFFFFFFn;
  const network = ip1 & mask;
  const subIp1 = network & mask;
  const subIp2 = subIp1 | ((~mask) & 0xFFFFFFFFn);
  let out = "";
  if (inc) {
    out += "Minimum subnet required to hold this range:\n";
    out += "\tNetwork: " + intToIpv4(network) + "\n";
    out += "\tCIDR: " + cidr + "\n";
    out += "\tMask: " + intToIpv4(mask) + "\n";
    out += "\tSubnet range: " + intToIpv4(subIp1) + " - " + intToIpv4(subIp2) + "\n";
    out += "\tTotal addresses in subnet: " + (subIp2 - subIp1 + 1n).toString() + "\n\n";
    out += "Range: " + intToIpv4(ip1) + " - " + intToIpv4(ip2) + "\n";
    out += "Total addresses in range: " + (ip2 - ip1 + 1n).toString() + "\n\n";
  }
  if (enumerate) {
    if ((ip2 - ip1) <= 65536n || allowLarge) {
      const arr = [];
      for (let n = ip1; n <= ip2; n++) arr.push(intToIpv4(n));
      out += arr.join("\n");
    } else {
      out += LARGE_RANGE_ERROR;
    }
  }
  return out;
}

function ipv6MaskGroups(prefix) {
  const mask = new Array(8);
  for (let i = 0; i < 8; i++) {
    if (prefix >= (i + 1) * 16) mask[i] = 0xffff;
    else if (prefix <= i * 16) mask[i] = 0;
    else mask[i] = (0xffff << (16 - (prefix - i * 16))) & 0xffff;
  }
  return mask;
}

function ipv6ToBig(groups) {
  let n = 0n;
  for (const g of groups) n = (n << 16n) | BigInt(g);
  return n;
}

function v6CidrReport(groups, prefix, inc) {
  if (prefix < 0 || prefix > 127) throw new Error("IPv6 CIDR must be less than 128");
  const mask = ipv6MaskGroups(prefix);
  const ip1 = groups.map((g, i) => g & mask[i]);
  const ip2 = ip1.map((g, i) => g | ((~mask[i]) & 0xffff));
  let out = "";
  if (inc) {
    out += "Network: " + ipv6Expand(groups) + "\n";
    out += "Shorthand: " + ipv6Compress(groups) + "\n";
    out += "CIDR: " + prefix + "\n";
    out += "Mask: " + ipv6Expand(mask) + "\n";
    out += "Range: " + ipv6Expand(ip1) + " - " + ipv6Expand(ip2) + "\n";
    out += "Total addresses in range: " + (1n << BigInt(128 - prefix)).toString() + "\n\n";
  }
  return out;
}

function v6HyphenReport(g1, g2, inc) {
  let out = "";
  if (inc) {
    out += "Range: " + ipv6Expand(g1) + " - " + ipv6Expand(g2) + "\n";
    out += "Shorthand range: " + ipv6Compress(g1) + " - " + ipv6Compress(g2) + "\n";
    const total = ipv6ToBig(g2) - ipv6ToBig(g1) + 1n;
    out += "Total addresses in range: " + total.toString() + "\n\n";
  }
  return out;
}

const LARGE_RANGE_ERROR = 'The specified range contains more than 65,536 addresses. Running this query could crash your browser. If you want to run it, select the "Allow large queries" option. You are advised to turn off "Auto Bake" whilst editing large ranges.';

function ipRangeReport(text, p) {
  const inc = p && p.includeNetworkInfo !== false;
  const enumerate = p && p.enumerate !== false;
  const allowLarge = p && p.allowLarge === true;
  const s = String(text == null ? "" : text).trim();
  let m;
  if ((m = s.match(/^\s*((?:\d{1,3}\.){3}\d{1,3})\/(\d\d?)\s*$/))) {
    return v4CidrReport(ipv4ToInt(m[1]), Number(m[2]), inc, enumerate, allowLarge);
  }
  if ((m = s.match(/^\s*((?:\d{1,3}\.){3}\d{1,3})\s*-\s*((?:\d{1,3}\.){3}\d{1,3})\s*$/))) {
    return v4HyphenReport(ipv4ToInt(m[1]), ipv4ToInt(m[2]), inc, enumerate, allowLarge);
  }
  const v4Lines = s.split(/\n/).map((x) => x.trim()).filter(Boolean);
  if (v4Lines.length && v4Lines.every((x) => /^(\d{1,3}\.){3}\d{1,3}(\/\d\d?)?$/.test(x))) {
    const list = [];
    for (const line of v4Lines) {
      if (line.includes("/")) {
        const [ip, pre] = line.split("/");
        const prefix = Number(pre);
        if (prefix < 0 || prefix > 31) throw new Error("IPv4 CIDR must be less than 32");
        const mask = v4Mask(prefix);
        const net = ipv4ToInt(ip) & mask;
        list.push(net, net | ((~mask) & 0xFFFFFFFFn));
      } else {
        const n = ipv4ToInt(line);
        list.push(n, n);
      }
    }
    list.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return v4HyphenReport(list[0], list[list.length - 1], inc, enumerate, allowLarge);
  }
  if ((m = s.match(/^\s*([0-9A-Fa-f:]+)\/(\d\d?\d?)\s*$/))) {
    return v6CidrReport(parseIpv6(m[1]), Number(m[2]), inc);
  }
  if ((m = s.match(/^\s*([0-9A-Fa-f:]+)\s*-\s*([0-9A-Fa-f:]+)\s*$/))) {
    return v6HyphenReport(parseIpv6(m[1]), parseIpv6(m[2]), inc);
  }
  const v6Lines = s.split(/\n/).map((x) => x.trim()).filter(Boolean);
  if (v6Lines.length && v6Lines.every((x) => /^[0-9A-Fa-f:]+(\/\d\d?\d?)?$/.test(x))) {
    const list = [];
    for (const line of v6Lines) {
      if (line.includes("/")) {
        const [ip, pre] = line.split("/");
        const prefix = Number(pre);
        if (prefix < 0 || prefix > 127) throw new Error("IPv6 CIDR must be less than 128");
        const mask = ipv6MaskGroups(prefix);
        const groups = parseIpv6(ip);
        const ip1 = groups.map((g, i) => g & mask[i]);
        const ip2 = ip1.map((g, i) => g | ((~mask[i]) & 0xffff));
        list.push(ip1, ip2);
      } else {
        const groups = parseIpv6(line);
        list.push(groups, groups);
      }
    }
    list.sort((a, b) => {
      const av = ipv6ToBig(a), bv = ipv6ToBig(b);
      return av < bv ? -1 : av > bv ? 1 : 0;
    });
    return v6HyphenReport(list[0], list[list.length - 1], inc);
  }
  throw new Error("Invalid input.\n\nEnter either a CIDR range (e.g. 10.0.0.0/24) or a hyphenated range (e.g. 10.0.0.0 - 10.0.1.0). IPv6 also supported.");
}

// ============ Group IP addresses（同 CyberChef） ============
const GROUP_DELIMS = { "Line feed": "\n", Space: " ", Comma: ",", "Semi-colon": ";", Colon: ":" };

function groupIpReport(text, p) {
  const delim = GROUP_DELIMS[(p && p.groupDelimiter) || "Line feed"] ?? "\n";
  const subnet = Number(p && p.groupSubnet != null ? p.groupSubnet : 24);
  const onlySubnets = p && p.groupOnlySubnets === true;
  if (!Number.isInteger(subnet) || subnet < 0 || subnet > 127) throw new Error("CIDR must be less than 32 for IPv4 or 128 for IPv6");
  const v4Mask = subnet <= 32 ? v4MaskFor(subnet) : 0n;
  const v6Mask = ipv6MaskGroups(Math.min(subnet, 127));
  const v4Groups = new Map();
  const v6Groups = new Map();
  for (const raw of String(text == null ? "" : text).split(delim)) {
    const s = raw.trim();
    if (!s) continue;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) {
      const ip = ipv4ToInt(s);
      const net = ip & v4Mask;
      if (!v4Groups.has(net)) v4Groups.set(net, []);
      v4Groups.get(net).push(ip);
    } else if (s.includes(":")) {
      try {
        const g = parseIpv6(s);
        const net = g.map((x, i) => x & v6Mask[i]);
        const key = ipv6Expand(net);
        if (!v6Groups.has(key)) v6Groups.set(key, []);
        v6Groups.get(key).push(g);
      } catch { /* CC skips non-matching lines */ }
    }
  }
  const out = [];
  const keys4 = [...v4Groups.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const net of keys4) {
    out.push(intToIpv4(net) + "/" + Math.min(subnet, 32));
    if (!onlySubnets) {
      for (const ip of v4Groups.get(net).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) out.push("  " + intToIpv4(ip));
      out.push("");
    }
  }
  const keys6 = [...v6Groups.keys()].sort();
  for (const key of keys6) {
    out.push(ipv6Compress(parseIpv6(key)) + "/" + Math.min(subnet, 127));
    if (!onlySubnets) {
      for (const g of v6Groups.get(key)) out.push("  " + ipv6Compress(g));
      out.push("");
    }
  }
  return out.length ? out.join("\n") + "\n" : "";
}

function v4MaskFor(prefix) {
  if (prefix <= 0) return 0n;
  return (0xFFFFFFFFn << BigInt(32 - prefix)) & 0xFFFFFFFFn;
}

// ============ IPv6 Transition Addresses（同 CyberChef） ============
const TRANS_XOR = { "0": "2", "1": "3", "2": "0", "3": "1", "4": "6", "5": "7", "6": "4", "7": "5", "8": "a", "9": "b", a: "8", b: "9", c: "e", d: "f", e: "c", f: "d" };
const hx2 = (s) => Number(s).toString(16).padStart(2, "0");

function ipTransitionReport(text, p) {
  const ignoreRanges = p && p.ignoreRanges !== false;
  const removeHeaders = p && p.removeHeaders === true;
  const lines = [];
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) {
    const s = raw.trim();
    if (!s) continue;
    if (ignoreRanges && s.includes("/")) continue;
    let out = "";
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(s)) {
      const o = s.split(".");
      const add = (label, addr) => { out += (removeHeaders ? "" : label) + addr + "\n"; };
      add("6to4: ", "2002:" + hx2(o[0]) + hx2(o[1]) + ":" + hx2(o[2]) + hx2(o[3]) + "::/48");
      add("IPv4 Mapped: ", "::ffff:" + hx2(o[0]) + hx2(o[1]) + ":" + hx2(o[2]) + hx2(o[3]));
      add("IPv4 Translated: ", "::ffff:0:" + hx2(o[0]) + hx2(o[1]) + ":" + hx2(o[2]) + hx2(o[3]));
      add("Nat 64: ", "64:ff9b::" + hx2(o[0]) + hx2(o[1]) + ":" + hx2(o[2]) + hx2(o[3]));
    } else if (/^(\d{1,3}\.){3}\d{1,3}\/24$/.test(s)) {
      const o = s.slice(0, -3).split(".");
      const add = (label, addr) => { out += (removeHeaders ? "" : label) + addr + "\n"; };
      add("6to4: ", "2002:" + hx2(o[0]) + hx2(o[1]) + ":" + hx2(o[2]) + "00::/40");
      add("IPv4 Mapped: ", "::ffff:" + hx2(o[0]) + hx2(o[1]) + ":" + hx2(o[2]) + "00/120");
      add("IPv4 Translated: ", "::ffff:0:" + hx2(o[0]) + hx2(o[1]) + ":" + hx2(o[2]) + "00/120");
      add("Nat 64: ", "64:ff9b::" + hx2(o[0]) + hx2(o[1]) + ":" + hx2(o[2]) + "00/120");
    } else if (/^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(s)) {
      const m = s.split(":");
      const mac = m[0] + m[1] + ":" + m[2] + "ff:fe" + m[3] + ":" + m[4] + m[5];
      out = (removeHeaders ? "" : "EUI-64 Interface ID: ") + mac.slice(0, 1) + TRANS_XOR[mac.slice(1, 2)] + mac.slice(2) + "\n";
    } else {
      try {
        parseIpv6(s);
        if (s.startsWith("2002:")) {
          out = (removeHeaders ? "" : "IPv4: ") + Number("0x" + s.slice(5, 7)) + "." + Number("0x" + s.slice(7, 9)) + "." + Number("0x" + s.slice(10, 12)) + "." + Number("0x" + s.slice(12, 14)) + "\n";
        } else if (s.startsWith("::ffff:") || s.startsWith("64:ff9b::")) {
          const g = parseIpv6(s);
          out = (removeHeaders ? "" : "IPv4: ") + ipv4Pair(g[6], g[7]) + "\n";
        } else if (s.slice(-5).toUpperCase() === "FF:FE") {
          const mac = (s.slice(-19, -17) + ":" + s.slice(-17, -15) + ":" + s.slice(-14, -12) + ":" + s.slice(-7, -5) + ":" + s.slice(-4, -2) + ":" + s.slice(-2,)).toUpperCase();
          out = (removeHeaders ? "" : "Mac Address: ") + mac.slice(0, 1) + TRANS_XOR[mac.slice(1, 2)] + mac.slice(2) + "\n";
        }
      } catch {
        out = "Enter compressed or expanded IPv6 address, IPv4 address or MAC Address.";
      }
    }
    if (out) lines.push(out.replace(/\n$/, ""));
  }
  return lines.length ? lines.join("\n") + "\n" : "";
}

register({
  id: "ipv6Format", cat: "radix", name: "IPv6 压缩/展开",
  desc: "IPv6 规范压缩（RFC 5952）↔ 全展开 8 组 4 位十六进制；report=true 时输出 CyberChef Parse IPv6 address 同口径的 longhand/shorthand 与保留段报告",
  params: [
    { key: "report", label: "详细报告（原样输出，不压缩/展开）", type: "bool", default: false },
    { key: "transitionMode", label: "IPv6 Transition Addresses（同 CC）", type: "bool", default: false },
    { key: "ignoreRanges", label: "Transition：Ignore ranges", type: "bool", default: true },
    { key: "removeHeaders", label: "Transition：Remove headers", type: "bool", default: false },
  ],
  encode: (t, p) => (p && p.transitionMode ? ipTransitionReport(t, p) : p && p.report ? ipv6DetailedReport(t) : ipv6Compress(parseIpv6(t))),
  decode: (t, p) => (p && p.transitionMode ? ipTransitionReport(t, p) : p && p.report ? ipv6DetailedReport(t) : ipv6Expand(parseIpv6(t))),
});

register({
  id: "macFormat", cat: "radix", name: "MAC 地址格式互转",
  desc: "MAC 冒号/连字符/点分/整数互转（48 位，自动识别输入格式）",
  params: [
    { key: "format", label: "输出格式", type: "select", default: "colon", options: [
      { value: "colon", label: "冒号 (aa:bb:cc:dd:ee:ff)" },
      { value: "hyphen", label: "连字符 (aa-bb-cc-dd-ee-ff)" },
      { value: "dot", label: "点分 (aabb.ccdd.eeff)" },
      { value: "int", label: "整数 (十进制)" },
    ] },
  ],
  encode: (t, p) => intToMac(parseMac(t), (p && p.format) || "colon"),
  decode: (t, p) => intToMac(parseMac(t), (p && p.format) || "colon"),
  detect: (t) => (/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/.test(String(t).trim()) ? 0.5 : 0),
});

register({
  id: "cidrCalc", cat: "radix", name: "CIDR 子网计算",
  desc: "网络/广播地址、掩码、反掩码、主机范围、IP 类与私有段判定（单向）；mode=auto 时同 CyberChef Parse IP range，支持 CIDR/连字符/列表与 IPv6",
  params: [
    { key: "mode", label: "模式", type: "select", default: "single", options: [
      { value: "single", label: "单条 CIDR 详细计算" },
      { value: "auto", label: "自动识别（CIDR/连字符/列表，IPv4/IPv6）" },
    ] },
    { key: "includeNetworkInfo", label: "输出网络信息", type: "bool", default: true },
    { key: "enumerate", label: "枚举 IPv4 地址", type: "bool", default: true },
    { key: "allowLarge", label: "允许大范围查询（>65536）", type: "bool", default: false },
    { key: "groupMode", label: "Group IP addresses（同 CC）", type: "bool", default: false },
    { key: "groupDelimiter", label: "Group：Delimiter", type: "select", default: "Line feed",
      options: [
        { value: "Line feed", label: "Line feed" }, { value: "Space", label: "Space" },
        { value: "Comma", label: "Comma" }, { value: "Semi-colon", label: "Semi-colon" }, { value: "Colon", label: "Colon" },
      ] },
    { key: "groupSubnet", label: "Group：Subnet (CIDR)", type: "number", default: 24 },
    { key: "groupOnlySubnets", label: "Group：Only show the subnets", type: "bool", default: false },
  ],
  run: (t, p) => (p && p.groupMode ? groupIpReport(t, p) : (p && p.mode) === "auto" ? ipRangeReport(t, p) : cidrCalc(t)),
  detect: (t) => (/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(String(t).trim()) ? 0.5 : 0),
});

register({
  id: "userAgentParse", cat: "radix", name: "User-Agent 解析",
  desc: "解析 UA 字符串：浏览器/引擎/操作系统/设备类型（单向）",
  params: [],
  run: (t) => parseUserAgent(t),
});

export {
  ipv4ToInt, intToIpv4, intToFormat, parseUintStrAuto,
  parseIpv6, ipv6Expand, ipv6Compress,
  parseMac, intToMac,
  cidrCalc, ipv4Class, isPrivateIp,
  parseUserAgent,
};
