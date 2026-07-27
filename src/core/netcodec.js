/*
 * netcodec.js — 网络/协议编码组（T49，cat:'radix'）。
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

function intToFormat(n, fmt) {
  if (fmt === "dec") return n.toString(10);
  if (fmt === "hex") return "0x" + n.toString(16).toUpperCase().padStart(8, "0");
  if (fmt === "oct") return "0" + n.toString(8).padStart(11, "0"); // 32 位 → 11 位八进制
  if (fmt === "bin") return "0b" + n.toString(2).padStart(32, "0");
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
  ],
  encode: (t, p) => { const n = ipv4ToInt(t); return intToFormat(n, (p && p.format) || "dec"); },
  decode: (t) => intToIpv4(ipv4ToInt(t)),
});

register({
  id: "ipv6Format", cat: "radix", name: "IPv6 压缩/展开",
  desc: "IPv6 规范压缩（RFC 5952）↔ 全展开 8 组 4 位十六进制",
  encode: (t) => ipv6Compress(parseIpv6(t)),
  decode: (t) => ipv6Expand(parseIpv6(t)),
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
  desc: "网络/广播地址、掩码、反掩码、主机范围、IP 类与私有段判定（单向）",
  params: [],
  run: (t) => cidrCalc(t),
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
