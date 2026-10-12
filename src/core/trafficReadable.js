import { register } from "./registry.js";
import { encodePNG } from "./mcMap.js";

/* ============================================================
 * trafficReadable.js — 流量包「人话结论」模块
 * ------------------------------------------------------------
 * 定位：把拖进来的真实流量包（pcap/pcapng）从「一屏 hex」变成「人能直接读的结论」。
 * 覆盖四类：
 *   1) USB 键盘流量  → 还原按键序列（Shift / CapsLock / 修饰键 / 长按去重 / 退格）+ 打字节奏图 PNG
 *   2) USB 鼠标流量  → 还原轨迹（坐标序列 + 按键事件 + 真彩轨迹图 PNG，替代旧字符画布）
 *   3) 网络流量      → 可读协议摘要（HTTP 请求行/头/体、DNS 查询、TLS SNI、TCP 会话转录）
 *   4) MQTT 流量     → MQTT 主题表（topic / payload / QoS / retain）
 *
 * 契约：
 *   - 纯 JS，零第三方依赖，零 DOM，零外发；全程 Uint8Array/DataView 内存解析。
 *   - 图像编码复用 mcMap.encodePNG（与 dataToImage 同一条 PNG 编码链），不自写编码器。
 *   - Node 22 可直接 `import()` 调用（不依赖 registry / 不依赖任何 src 模块）。
 *   - 所有入口对畸形输入不抛异常，返回结构化的 { ok:false, error }。
 *
 * 对外 API：
 *   analyzeTraffic(bytes, opts) -> TrafficResult
 *   renderReadableReport(result) -> string   // 中文人话报告（op run 直接返回它）
 *   analyzeTrafficBytes(bytes, opts) -> sections[]  // 对齐 fileAnalysis 的 section 结构
 *   renderTrackImage / renderKeyRhythmImage         // 轨迹/节奏真彩图像素（确定性，可单测）
 *   以及若干具名导出供测试：parseContainer / dissectFrame / decodeKeyboardReports /
 *   decodeMouseReports / parseMqttStream / parseDnsMessage / extractTlsSni /
 *   reassembleTcpFlows / findFlags
 *
 * 格式依据（照规范实现，不编造）：
 *   - libpcap 文件格式：magic a1b2c3d4 / d4c3b2a1 / a1b2cd34 / 34cdb2a1
 *   - pcapng v1.0：SHB(0x0A0D0D0A) / IDB(1) / EPB(6) / SPB(3) / NRB(4)
 *   - USBPcap 伪头（linkType 249）：headerLen(u16) + irpId(u64) + status(u32) +
 *     function(u16) + info(u8) + bus(u16) + device(u16) + endpoint(u8) + transfer(u8) + dataLength(u32)
 *   - Linux usbmon mmap 头（linkType 249 另一变体）：64 字节，type 在偏移 8，数据在偏移 64
 *   - USB HID 1.21：Keyboard/Keypad 页 0x07 usage 表；boot 键盘报告 8 字节
 *     (modifier + reserved + keycodes1..6)；boot 鼠标报告 4 字节 (buttons + dX + dY + wheel)
 *   - RFC 894/791/8200/793/768/792/1035/2616/9112；MQTT 3.1.1/5.0 定长头 + 可变长度
 *   - RFC 1951 DEFLATE / 1950 zlib / 1952 gzip（内置纯 JS inflate）
 *   - RFC 5246/8446 TLS ClientHello 与 server_name(0x0000) 扩展
 * ============================================================ */

// ============================================================
// 0. 基础字节工具
// ============================================================
function u16le(b, i) { return (b[i] | (b[i + 1] << 8)) >>> 0; }
function u32le(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0; }
function u16be(b, i) { return ((b[i] << 8) | b[i + 1]) >>> 0; }
function u32be(b, i) { return (((b[i] * 0x1000000) >>> 0) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }
function s8(v) { return (v & 0x80) ? v - 0x100 : v; }
function s16le(b, i) { const v = u16le(b, i); return (v & 0x8000) ? v - 0x10000 : v; }
function s32le(b, i) { const v = u32le(b, i); return v > 0x7fffffff ? v - 0x100000000 : v; }

function toHex(bytes, start, end) {
  let s = "";
  const e = end === undefined ? bytes.length : end;
  for (let i = start || 0; i < e && i < bytes.length; i++) s += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return s;
}
function asciiPreview(bytes, start, end) {
  let s = "";
  const e = end === undefined ? bytes.length : end;
  for (let i = start || 0; i < e && i < bytes.length; i++) {
    const b = bytes[i];
    s += (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b <= 0x7e)) ? String.fromCharCode(b) : ".";
  }
  return s;
}
function latin1(bytes, start, end) {
  const s = start || 0;
  const e = end === undefined ? bytes.length : end;
  let out = "";
  for (let i = s; i < e; i += 8192) out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(e, i + 8192)));
  return out;
}
function printableRatio(bytes) {
  if (!bytes || bytes.length === 0) return 0;
  let p = 0;
  for (const b of bytes) if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b <= 0x7e)) p++;
  return p / bytes.length;
}
function isMostlyText(bytes, limit) {
  const e = Math.min(bytes.length, limit || 512);
  if (e === 0) return true;
  let p = 0;
  for (let i = 0; i < e; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b <= 0x7e)) p++;
    else if (b >= 0x80) p += 0.5;
  }
  return p / e > 0.85;
}
function concatBytes(list) {
  let total = 0;
  for (const c of list) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of list) { out.set(c, off); off += c.length; }
  return out;
}
// 报告展示用转义：\\ \r \n \t 用惯用写法，其余控制字符（C0 + DEL）一律写成 \xNN —— 保证控制字符在报告里可见、可复制。
function escapeText(s) {
  return String(s).replace(/[\x00-\x1f\x7f\\]/g, (c) => {
    if (c === "\\") return "\\\\";
    if (c === "\r") return "\\r";
    if (c === "\n") return "\\n";
    if (c === "\t") return "\\t";
    return "\\x" + c.charCodeAt(0).toString(16).padStart(2, "0");
  });
}

// ============================================================
// 1. 容器解析（libpcap / pcapng）
// ============================================================
const LINKTYPES = {
  0: "NULL/Loopback", 1: "Ethernet", 6: "Token Ring", 9: "PPP", 12: "Raw IP", 101: "Raw IP(101)",
  105: "IEEE 802.11", 113: "Linux SLL", 127: "802.11 + radiotap", 220: "USB (usbmon)",
  228: "Raw IPv4", 229: "Raw IPv6", 249: "USB (USBPcap / usbmon-mmap)", 276: "Linux SLL2",
};
// 键 = 首 4 字节按小端读出的值（与 libpcap 惯例一致）：
//  磁盘字节 d4c3b2a1 → LE 微秒；a1b2c3d4 → BE 微秒；34cdb2a1 → LE 纳秒；a1b2cd34 → BE 纳秒
const PCAP_MAGICS = {
  "a1b2c3d4": { le: true, nano: false }, "d4c3b2a1": { le: false, nano: false },
  "a1b2cd34": { le: true, nano: true }, "34cdb2a1": { le: false, nano: true },
};

export function parseContainer(bytes) {
  if (!bytes || bytes.length < 4) throw new Error("数据过短，不足一个流量容器头");
  if (toHex(bytes, 0, 4) === "0a0d0d0a") return parsePcapng(bytes);
  const magic = u32le(bytes, 0).toString(16).padStart(8, "0");
  if (PCAP_MAGICS[magic]) return parsePcapClassic(bytes, PCAP_MAGICS[magic]);
  throw new Error("无法识别的容器格式（首 4 字节 " + toHex(bytes, 0, 4) + "，期望 pcap magic 或 pcapng SHB）");
}

function parsePcapClassic(bytes, info) {
  if (bytes.length < 24) throw new Error("pcap 全局头不足 24 字节");
  const { le, nano } = info;
  const rd16 = (i) => le ? u16le(bytes, i) : u16be(bytes, i);
  const rd32 = (i) => le ? u32le(bytes, i) : u32be(bytes, i);
  const linkType = rd32(20);
  const packets = [];
  let pos = 24;
  while (pos + 16 <= bytes.length) {
    const inclLen = rd32(pos + 8);
    const origLen = rd32(pos + 12);
    pos += 16;
    if (inclLen === 0 || inclLen > bytes.length - pos) break;
    packets.push({
      index: packets.length, raw: bytes.subarray(pos, pos + inclLen),
      inclLen, origLen, tsSec: rd32(pos - 16), tsUsec: rd32(pos - 12), linkType,
    });
    pos += inclLen;
  }
  return {
    format: "pcap", endian: le ? "little" : "big", nano, linkType,
    linkTypeName: LINKTYPES[linkType] || ("linkType " + linkType),
    version: rd16(4) + "." + rd16(6), snapLen: rd32(16), interfaces: [{ linkType }], packets,
  };
}

function parsePcapng(bytes) {
  const bom = u32le(bytes, 8);
  let le;
  if (bom === 0x1a2b3c4d) le = true;
  else if (bom === 0x4d3c2b1a) le = false;
  else throw new Error("pcapng SHB byte-order magic 异常: 0x" + bom.toString(16));
  const rd16 = (i) => le ? u16le(bytes, i) : u16be(bytes, i);
  const rd32 = (i) => le ? u32le(bytes, i) : u32be(bytes, i);

  const interfaces = [];
  const packets = [];
  let pos = 0;
  while (pos + 12 <= bytes.length) {
    const bt = rd32(pos);
    const totalLen = rd32(pos + 4);
    if (totalLen < 12 || pos + totalLen > bytes.length) break;
    if (bt === 1) {
      interfaces.push({ linkType: rd16(pos + 8), snapLen: rd32(pos + 12) });
    } else if (bt === 6) {
      const ifaceId = rd32(pos + 8);
      const inclLen = rd32(pos + 20);
      const origLen = rd32(pos + 24);
      const dataStart = pos + 28;
      if (dataStart + inclLen <= pos + totalLen) {
        const iface = interfaces[ifaceId];
        const hi = rd32(pos + 12), lo = rd32(pos + 16);
        const ts = (hi * 0x100000000 + lo) / 1000000;
        packets.push({
          index: packets.length, raw: bytes.subarray(dataStart, dataStart + inclLen),
          inclLen, origLen, tsSec: Math.floor(ts), tsUsec: Math.round((ts % 1) * 1e6),
          linkType: iface ? iface.linkType : 1,
        });
      }
    } else if (bt === 3) {
      const dataLen = Math.max(0, totalLen - 16);
      const iface = interfaces[0];
      packets.push({
        index: packets.length, raw: bytes.subarray(pos + 12, pos + 12 + dataLen),
        inclLen: dataLen, origLen: dataLen, tsSec: 0, tsUsec: 0,
        linkType: iface ? iface.linkType : 1,
      });
    }
    pos += totalLen;
  }
  const primary = interfaces.length ? interfaces[0].linkType : 1;
  return {
    format: "pcapng", endian: le ? "little" : "big", nano: false,
    linkType: primary, linkTypeName: LINKTYPES[primary] || ("linkType " + primary),
    interfaces, packets,
  };
}

// ============================================================
// 2. 网络链路/网络/传输层分帧
// ============================================================
const ETHERTYPES = { 0x0800: "IPv4", 0x0806: "ARP", 0x86dd: "IPv6", 0x8100: "802.1Q VLAN" };
const IPPROTO = { 1: "ICMP", 6: "TCP", 17: "UDP", 58: "ICMPv6" };

function fmtIPv4(b, o) { return b[o] + "." + b[o + 1] + "." + b[o + 2] + "." + b[o + 3]; }
function fmtIPv6(b, o) {
  const parts = [];
  for (let i = 0; i < 8; i++) parts.push(u16be(b, o + i * 2).toString(16));
  return parts.join(":");
}
function fmtMac(b, o) {
  const p = [];
  for (let i = 0; i < 6; i++) p.push(b[o + i].toString(16).padStart(2, "0"));
  return p.join(":");
}

function dissectIPv4(p) {
  if (p.length < 20) return { ok: false, error: "IPv4 头不足 20 字节" };
  const ihl = (p[0] & 0x0f) * 4;
  if (ihl < 20 || ihl > p.length) return { ok: false, error: "IPv4 IHL 非法" };
  const total = u16be(p, 2);
  const end = total > p.length ? p.length : total;
  return {
    ok: true, version: 4, ihl, protocol: p[9], protocolName: IPPROTO[p[9]] || ("proto " + p[9]),
    src: fmtIPv4(p, 12), dst: fmtIPv4(p, 16), ttl: p[8], totalLen: total,
    payload: p.subarray(ihl, end),
  };
}
function dissectIPv6(p) {
  if (p.length < 40) return { ok: false, error: "IPv6 头不足 40 字节" };
  let pos = 40;
  let proto = p[6];
  while ([0, 43, 60].includes(proto) && pos + 2 <= p.length) {
    const next = p[pos];
    pos += (p[pos + 1] + 1) * 8;
    proto = next;
  }
  if (proto === 44 && pos + 8 <= p.length) { proto = p[pos]; pos += 8; }
  const plen = u16be(p, 4);
  const end = Math.min(p.length, 40 + plen);
  return {
    ok: true, version: 6, protocol: proto, protocolName: IPPROTO[proto] || ("proto " + proto),
    src: fmtIPv6(p, 8), dst: fmtIPv6(p, 24), hopLimit: p[7], payload: p.subarray(pos, end),
  };
}
function dissectTCP(p) {
  if (p.length < 20) return { ok: false, error: "TCP 头不足 20 字节" };
  const doff = ((p[12] >> 4) & 0x0f) * 4;
  if (doff < 20 || doff > p.length) return { ok: false, error: "TCP dataOffset 非法" };
  const f = p[13];
  const flags = { FIN: !!(f & 1), SYN: !!(f & 2), RST: !!(f & 4), PSH: !!(f & 8), ACK: !!(f & 16), URG: !!(f & 32) };
  return {
    ok: true, srcPort: u16be(p, 0), dstPort: u16be(p, 2), seq: u32be(p, 4), ack: u32be(p, 8),
    flags, flagStr: Object.keys(flags).filter((k) => flags[k]).join(",") || "none",
    window: u16be(p, 14), payload: p.subarray(doff),
  };
}
function dissectUDP(p) {
  if (p.length < 8) return { ok: false, error: "UDP 头不足 8 字节" };
  const len = u16be(p, 4);
  return { ok: true, srcPort: u16be(p, 0), dstPort: u16be(p, 2), length: len, payload: p.subarray(8, Math.min(p.length, len)) };
}
function dissectICMP(p) {
  if (p.length < 4) return { ok: false, error: "ICMP 头不足 4 字节" };
  return { ok: true, icmpType: p[0], code: p[1], payload: p.subarray(8) };
}

/** 单帧分层分帧：返回 { ok, l2, l3, l4 }（与 pcapParse 的层次约定一致）。 */
export function dissectFrame(raw, linkType) {
  const res = { ok: false, l2: null, l3: null, l4: null, error: "" };
  let ethertype = 0;
  let ipPayload = null;

  if (linkType === 1) {
    if (raw.length < 14) { res.error = "Ethernet 帧不足 14 字节"; return res; }
    ethertype = u16be(raw, 12);
    let off = 14;
    if (ethertype === 0x8100 && raw.length >= 18) { ethertype = u16be(raw, 16); off = 18; }
    res.l2 = { type: "Ethernet", src: fmtMac(raw, 6), dst: fmtMac(raw, 0), ethertype, name: ETHERTYPES[ethertype] || ("0x" + ethertype.toString(16)) };
    ipPayload = raw.subarray(off);
  } else if (linkType === 113) {
    if (raw.length < 16) { res.error = "Linux SLL 帧不足 16 字节"; return res; }
    ethertype = u16be(raw, 14);
    res.l2 = { type: "Linux SLL", src: fmtMac(raw, 6), dst: "—", ethertype, name: ETHERTYPES[ethertype] || ("0x" + ethertype.toString(16)) };
    ipPayload = raw.subarray(16);
  } else if (linkType === 0) {
    if (raw.length < 4) { res.error = "Loopback 帧不足 4 字节"; return res; }
    const fam = u32le(raw, 0);
    ethertype = fam === 2 ? 0x0800 : ((fam === 28 || fam === 30) ? 0x86dd : 0);
    res.l2 = { type: "Loopback", src: "—", dst: "—", ethertype, name: ethertype === 0x0800 ? "IPv4" : (ethertype === 0x86dd ? "IPv6" : ("family " + fam)) };
    ipPayload = raw.subarray(4);
  } else if (linkType === 12 || linkType === 101 || linkType === 228) {
    ethertype = 0x0800;
    res.l2 = { type: "Raw IPv4", src: "—", dst: "—", ethertype, name: "IPv4" };
    ipPayload = raw;
  } else if (linkType === 229) {
    ethertype = 0x86dd;
    res.l2 = { type: "Raw IPv6", src: "—", dst: "—", ethertype, name: "IPv6" };
    ipPayload = raw;
  } else {
    res.error = "未支持的链路类型 " + linkType;
    return res;
  }

  if (ethertype === 0x0800) res.l3 = dissectIPv4(ipPayload);
  else if (ethertype === 0x86dd) res.l3 = dissectIPv6(ipPayload);
  else if (ethertype === 0x0806) res.l3 = { ok: true, type: "ARP", payload: ipPayload };
  else { res.error = "L2 承载 " + res.l2.name + "，非 IP 流量"; return res; }

  if (!res.l3.ok) { res.error = res.l3.error; return res; }
  res.l3.type = res.l3.version === 6 ? "IPv6" : (res.l3.type || "IPv4");

  const proto = res.l3.protocol;
  if (proto === 6) res.l4 = dissectTCP(res.l3.payload);
  else if (proto === 17) res.l4 = dissectUDP(res.l3.payload);
  else if (proto === 1 || proto === 58) res.l4 = dissectICMP(res.l3.payload);
  else { res.l4 = null; res.ok = true; return res; }
  if (res.l4) res.l4.type = proto === 6 ? "TCP" : (proto === 17 ? "UDP" : "ICMP");
  res.ok = true;
  return res;
}

// ============================================================
// 3. TCP 流重组（seq 排序去重，方向分流）
// ============================================================
function seqDelta(seq, base) {
  let d = ((seq - base) % 0x100000000 + 0x100000000) % 0x100000000;
  if (d > 0x80000000) d -= 0x100000000;
  return d;
}
const MAX_STREAM = 8 * 1024 * 1024;

/** 输入 dissectFrame 结果数组 → Map(connKey → {a,b,dirs:Map(dirKey→{from,to,segs})}) */
export function reassembleTcpFlows(frames) {
  const flows = new Map();
  for (const f of frames) {
    if (!f || !f.l3 || !f.l4 || f.l4.type !== "TCP") continue;
    const src = f.l3.src + ":" + f.l4.srcPort;
    const dst = f.l3.dst + ":" + f.l4.dstPort;
    const key = src < dst ? src + "|" + dst : dst + "|" + src;
    let flow = flows.get(key);
    if (!flow) { flow = { a: src, b: dst, dirs: new Map(), firstIndex: f.index }; flows.set(key, flow); }
    const dk = src + ">" + dst;
    let dir = flow.dirs.get(dk);
    if (!dir) { dir = { from: src, to: dst, segs: [], isn: null }; flow.dirs.set(dk, dir); }
    if (f.l4.flags && f.l4.flags.SYN) dir.isn = (f.l4.seq + 1) >>> 0;
    if (f.l4.payload && f.l4.payload.length > 0) dir.segs.push({ seq: f.l4.seq >>> 0, data: f.l4.payload, index: f.index });
  }
  return flows;
}

/** 单方向重组为连续字节流（首次写入优先，重传去重）。 */
export function reassembleDir(dir) {
  const segs = dir.segs;
  if (!segs.length) return new Uint8Array(0);
  let base = dir.isn;
  if (base === null || base === undefined) {
    base = segs.slice().sort((x, y) => x.seq - y.seq)[0].seq;
  }
  let maxEnd = 0;
  for (const s of segs) {
    const off = seqDelta(s.seq, base);
    if (off < 0) continue;
    const end = off + s.data.length;
    if (end > maxEnd) maxEnd = end;
  }
  if (maxEnd <= 0) return new Uint8Array(0);
  if (maxEnd > MAX_STREAM) maxEnd = MAX_STREAM;
  const out = new Uint8Array(maxEnd);
  const filled = new Uint8Array(maxEnd);
  for (const s of segs.slice().sort((x, y) => x.index - y.index)) {
    const off = seqDelta(s.seq, base);
    if (off < 0) continue;
    const n = Math.min(s.data.length, maxEnd - off);
    for (let i = 0; i < n; i++) if (!filled[off + i]) { out[off + i] = s.data[i]; filled[off + i] = 1; }
  }
  return out;
}

// ============================================================
// 4. 纯 JS inflate（RFC 1951/1950/1952），供 HTTP 体解压
// ============================================================
const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function buildHuff(lengths, num) {
  const counts = new Array(16).fill(0);
  for (let i = 0; i < num; i++) counts[lengths[i]]++;
  counts[0] = 0;
  const offsets = new Array(16).fill(0);
  for (let i = 1; i < 16; i++) offsets[i] = offsets[i - 1] + counts[i - 1];
  const symbols = new Array(num);
  for (let i = 0; i < num; i++) if (lengths[i]) symbols[offsets[lengths[i]]++] = i;
  return { counts, symbols };
}

/** 裸 DEFLATE 解压（无 zlib/gzip 包装）。 */
export function inflateRaw(data) {
  let bitBuf = 0, bitCnt = 0, pos = 0;
  const out = [];
  function getBit() {
    if (bitCnt === 0) { if (pos >= data.length) throw new Error("inflate: 数据提前结束"); bitBuf = data[pos++]; bitCnt = 8; }
    const b = bitBuf & 1; bitBuf >>= 1; bitCnt--; return b;
  }
  function getBits(n) { let v = 0; for (let i = 0; i < n; i++) v |= getBit() << i; return v >>> 0; }
  function decodeSym(tree) {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= 15; len++) {
      code |= getBit();
      const count = tree.counts[len];
      if (code - first < count) return tree.symbols[index + (code - first)];
      index += count; first += count; first <<= 1; code <<= 1;
    }
    throw new Error("inflate: 非法 Huffman 码");
  }
  const fixedLitLen = new Array(288);
  for (let i = 0; i < 144; i++) fixedLitLen[i] = 8;
  for (let i = 144; i < 256; i++) fixedLitLen[i] = 9;
  for (let i = 256; i < 280; i++) fixedLitLen[i] = 7;
  for (let i = 280; i < 288; i++) fixedLitLen[i] = 8;
  const fixedLit = buildHuff(fixedLitLen, 288);
  const fixedDist = buildHuff(new Array(30).fill(5), 30);
  function block(lt, dt) {
    for (;;) {
      const sym = decodeSym(lt);
      if (sym === 256) break;
      if (sym < 256) { out.push(sym); continue; }
      const s = sym - 257;
      if (s < 0 || s >= LEN_BASE.length) throw new Error("inflate: 非法长度码");
      const length = LEN_BASE[s] + getBits(LEN_EXTRA[s]);
      const dsym = decodeSym(dt);
      if (dsym < 0 || dsym >= DIST_BASE.length) throw new Error("inflate: 非法距离码");
      const dist = DIST_BASE[dsym] + getBits(DIST_EXTRA[dsym]);
      const start = out.length - dist;
      if (start < 0) throw new Error("inflate: 距离越界");
      for (let i = 0; i < length; i++) out.push(out[start + i]);
      if (out.length > MAX_STREAM) throw new Error("inflate: 输出超限");
    }
  }
  let final = 0;
  do {
    final = getBit();
    const type = getBits(2);
    if (type === 0) {
      bitCnt = 0;
      if (pos + 4 > data.length) throw new Error("inflate: stored 块头不足");
      const len = data[pos] | (data[pos + 1] << 8);
      pos += 4;
      if (pos + len > data.length) throw new Error("inflate: stored 块数据不足");
      for (let i = 0; i < len; i++) out.push(data[pos++]);
    } else if (type === 1) block(fixedLit, fixedDist);
    else if (type === 2) {
      const hlit = getBits(5) + 257, hdist = getBits(5) + 1, hclen = getBits(4) + 4;
      const clLen = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) clLen[CL_ORDER[i]] = getBits(3);
      const clTree = buildHuff(clLen, 19);
      const lengths = new Array(hlit + hdist).fill(0);
      let i = 0;
      while (i < hlit + hdist) {
        const sym = decodeSym(clTree);
        if (sym < 16) lengths[i++] = sym;
        else if (sym === 16) { const r = getBits(2) + 3; const prev = lengths[i - 1]; for (let k = 0; k < r; k++) lengths[i++] = prev; }
        else if (sym === 17) { const r = getBits(3) + 3; for (let k = 0; k < r; k++) lengths[i++] = 0; }
        else if (sym === 18) { const r = getBits(7) + 11; for (let k = 0; k < r; k++) lengths[i++] = 0; }
        else throw new Error("inflate: 非法码长符号");
      }
      block(buildHuff(lengths.slice(0, hlit), hlit), buildHuff(lengths.slice(hlit), hdist));
    } else throw new Error("inflate: 保留块类型 3");
  } while (!final);
  return new Uint8Array(out);
}

/** zlib / gzip / 裸 deflate 三态解压（自动识别）。 */
export function inflateAny(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const flg = bytes[3];
    let off = 10;
    if (flg & 0x04) { const xlen = u16le(bytes, off); off += 2 + xlen; }
    if (flg & 0x08) { while (off < bytes.length && bytes[off] !== 0) off++; off++; }
    if (flg & 0x10) { while (off < bytes.length && bytes[off] !== 0) off++; off++; }
    if (flg & 0x02) off += 2;
    return { how: "gzip", data: inflateRaw(bytes.subarray(off, bytes.length - 8)) };
  }
  if (bytes.length >= 2 && (bytes[0] & 0x0f) === 8 && ((bytes[0] << 8 | bytes[1]) % 31 === 0)) {
    return { how: "zlib", data: inflateRaw(bytes.subarray(2, bytes.length - 4)) };
  }
  return { how: "raw-deflate", data: inflateRaw(bytes) };
}

const B64_RE = /^[A-Za-z0-9+/\r\n=]+$/;
function b64ToBytes(s) {
  const clean = String(s).replace(/\s+/g, "");
  if (typeof atob === "function") {
    const bin = atob(clean);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new Uint8Array(Buffer.from(clean, "base64"));
}

/**
 * 分层解码 HTTP body：Content-Encoding → 解压；base64(压缩流) → 解压。
 * 返回 [{ how, bytes, text|null }]，最多 4 层。
 */
export function decodeBodyLayers(body, headers) {
  const layers = [];
  if (!body || body.length === 0) return layers;
  let cur = body;
  let how = (headers && (headers["content-encoding"] || "")).toLowerCase();
  try {
    if (how.includes("gzip") || how.includes("deflate")) {
      const r = inflateAny(cur);
      layers.push({ how: how.trim() + "→inflate", bytes: r.data, text: isMostlyText(r.data, 4096) ? latin1(r.data) : null });
      cur = r.data;
    } else if (cur.length >= 2 && (cur[0] === 0x1f && cur[1] === 0x8b)) {
      const r = inflateAny(cur);
      layers.push({ how: "gzip(裸)", bytes: r.data, text: isMostlyText(r.data, 4096) ? latin1(r.data) : null });
      cur = r.data;
    }
  } catch (e) { layers.push({ how: "inflate 失败: " + (e && e.message), bytes: cur, text: null }); }

  // base64(压缩流) —— PHP 后门 base64_encode(gzcompress($x)) 的典型形态
  for (let depth = 0; depth < 3; depth++) {
    const text = latin1(cur).trim();
    if (text.length < 8 || text.length % 4 !== 0 || !B64_RE.test(text)) break;
    let raw;
    try { raw = b64ToBytes(text); } catch { break; }
    if (raw.length < 2) break;
    const looksCompressed = (raw[0] === 0x78) || (raw[0] === 0x1f && raw[1] === 0x8b);
    if (looksCompressed) {
      try {
        const r = inflateAny(raw);
        layers.push({ how: "base64→" + r.how + "→inflate", bytes: r.data, text: isMostlyText(r.data, 4096) ? latin1(r.data) : null });
        cur = r.data;
        continue;
      } catch { /* fallthrough */ }
    }
    if (isMostlyText(raw, 512)) {
      layers.push({ how: "base64", bytes: raw, text: latin1(raw) });
      cur = raw;
      continue;
    }
    break;
  }
  return layers;
}

// ============================================================
// 5. DNS（RFC 1035）
// ============================================================
const DNS_TYPES = { 1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 43: "DS", 46: "RRSIG", 48: "DNSKEY", 65: "HTTPS", 255: "ANY" };

function parseDnsName(bytes, start) {
  let pos = start, jumped = false, endPos = -1, jumps = 0;
  const labels = [];
  while (pos < bytes.length && jumps < 20) {
    const len = bytes[pos];
    if (len === 0) { pos++; if (!jumped) endPos = pos; break; }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 2 > bytes.length) break;
      if (!jumped) endPos = pos + 2;
      pos = ((len & 0x3f) << 8) | bytes[pos + 1];
      jumped = true; jumps++;
      continue;
    }
    if (pos + 1 + len > bytes.length) break;
    let label = "";
    for (let i = 0; i < len; i++) label += String.fromCharCode(bytes[pos + 1 + i]);
    labels.push(label);
    pos += 1 + len;
  }
  if (endPos === -1) endPos = pos;
  return { name: labels.length ? labels.join(".") : ".", endPos };
}

export function parseDnsMessage(payload) {
  if (payload.length < 12) return { ok: false, error: "DNS 头不足 12 字节" };
  const id = u16be(payload, 0);
  const flags = u16be(payload, 2);
  const qd = u16be(payload, 4), an = u16be(payload, 6), ns = u16be(payload, 8), ar = u16be(payload, 10);
  let pos = 12;
  const questions = [], answers = [];
  for (let i = 0; i < qd && pos < payload.length; i++) {
    const { name, endPos } = parseDnsName(payload, pos);
    pos = endPos;
    if (pos + 4 > payload.length) break;
    const qtype = u16be(payload, pos);
    pos += 4;
    questions.push({ name, qtype, qtypeName: DNS_TYPES[qtype] || ("type " + qtype) });
  }
  for (let i = 0; i < an && pos + 10 <= payload.length; i++) {
    const { name, endPos } = parseDnsName(payload, pos);
    pos = endPos;
    if (pos + 10 > payload.length) break;
    const rtype = u16be(payload, pos);
    const ttl = u32be(payload, pos + 4);
    const rdlen = u16be(payload, pos + 8);
    pos += 10;
    if (pos + rdlen > payload.length) break;
    let rdata = toHex(payload, pos, pos + rdlen);
    if (rtype === 1 && rdlen === 4) rdata = fmtIPv4(payload, pos);
    else if (rtype === 28 && rdlen === 16) rdata = fmtIPv6(payload, pos);
    else if (rtype === 5 || rtype === 2 || rtype === 12) rdata = parseDnsName(payload, pos).name;
    else if (rtype === 16) { // TXT：一个或多个 <character-string>，语义为顺序拼接（RFC 1035 §3.3.14）
      rdata = "";
      let toff = 0;
      while (toff < rdlen) {
        const l = payload[pos + toff];
        if (toff + 1 + l > rdlen) break; // 长度字节越界：截断如实停止
        for (let k = 0; k < l; k++) rdata += String.fromCharCode(payload[pos + 1 + toff + k]);
        toff += 1 + l;
      }
    }
    pos += rdlen;
    answers.push({ name, rtype, rtypeName: DNS_TYPES[rtype] || ("type " + rtype), ttl, rdata });
  }
  return { ok: true, id, isResponse: !!(flags & 0x8000), qd, an, ns, ar, questions, answers };
}

// ============================================================
// 6. TLS ClientHello SNI（RFC 5246 / 8446）
// ============================================================
export function extractTlsSni(payload) {
  try {
    if (payload.length < 6 || payload[0] !== 0x16) return null;
    const recLen = u16be(payload, 3);
    const rec = payload.subarray(5, Math.min(payload.length, 5 + recLen));
    if (rec.length < 4 || rec[0] !== 0x01) return null; // handshake ClientHello
    const hsLen = (rec[1] << 16) | (rec[2] << 8) | rec[3];
    const hs = rec.subarray(4, Math.min(rec.length, 4 + hsLen));
    if (hs.length < 34) return null;
    const version = u16be(hs, 0);
    let p = 34;
    const sidLen = hs[p]; p += 1 + sidLen;
    if (p + 2 > hs.length) return null;
    const csLen = u16be(hs, p); p += 2 + csLen;
    if (p + 1 > hs.length) return null;
    const compLen = hs[p]; p += 1 + compLen;
    if (p + 2 > hs.length) return null;
    const extLen = u16be(hs, p); p += 2;
    const extEnd = Math.min(hs.length, p + extLen);
    while (p + 4 <= extEnd) {
      const etype = u16be(hs, p);
      const elen = u16be(hs, p + 2);
      const ebody = hs.subarray(p + 4, Math.min(extEnd, p + 4 + elen));
      if (etype === 0x0000 && ebody.length >= 5) {
        // server_name_list: list_len(2) + [name_type(1) + name_len(2) + name]
        let q = 2;
        while (q + 3 <= ebody.length) {
          const ntype = ebody[q];
          const nlen = u16be(ebody, q + 1);
          const name = latin1(ebody, q + 3, Math.min(ebody.length, q + 3 + nlen));
          if (ntype === 0) return { sni: name, version, recordVersion: u16be(payload, 1) };
          q += 3 + nlen;
        }
      }
      p += 4 + elen;
    }
    return { sni: null, version, recordVersion: u16be(payload, 1) };
  } catch { return null; }
}

// ============================================================
// 7. HTTP（请求/响应分帧 + 头 + 体分层解码）
// ============================================================
function indexOfHeaderEnd(b, from) {
  for (let i = from; i + 3 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i;
  return -1;
}
function readChunked(b, start) {
  const chunks = [];
  let pos = start, guard = 0;
  while (pos < b.length && guard++ < 100000) {
    let lineEnd = pos;
    while (lineEnd + 1 < b.length && !(b[lineEnd] === 13 && b[lineEnd + 1] === 10)) lineEnd++;
    const size = parseInt(latin1(b, pos, lineEnd).split(";")[0].trim(), 16);
    pos = lineEnd + 2;
    if (isNaN(size) || size === 0) break;
    const end = Math.min(b.length, pos + size);
    chunks.push(b.subarray(pos, end));
    pos = end + 2;
  }
  return { data: concatBytes(chunks), end: pos };
}

export function parseHttpStream(stream) {
  const msgs = [];
  let pos = 0, guard = 0;
  while (pos < stream.length && guard++ < 500) {
    while (pos < stream.length && (stream[pos] === 13 || stream[pos] === 10)) pos++;
    if (pos >= stream.length) break;
    const hend = indexOfHeaderEnd(stream, pos);
    if (hend < 0) break;
    const lines = latin1(stream, pos, hend).split("\r\n");
    const startLine = lines[0];
    let kind = null;
    if (/^HTTP\/\d/.test(startLine)) kind = "response";
    else if (/^[A-Z]{3,8} \S+ HTTP\/\d/.test(startLine)) kind = "request";
    if (!kind) break;
    const headers = {};
    for (let i = 1; i < lines.length; i++) {
      const idx = lines[i].indexOf(":");
      if (idx > 0) headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
    }
    const bodyStart = hend + 4;
    let bodyRaw, truncated = false;
    const te = (headers["transfer-encoding"] || "").toLowerCase();
    if (te.includes("chunked")) { const r = readChunked(stream, bodyStart); bodyRaw = r.data; pos = r.end; }
    else if (headers["content-length"] !== undefined) {
      const n = parseInt(headers["content-length"], 10) || 0;
      const end = Math.min(stream.length, bodyStart + n);
      if (end < bodyStart + n) truncated = true;
      bodyRaw = stream.subarray(bodyStart, end);
      pos = end;
    } else if (kind === "response") {
      const st = parseInt(startLine.split(" ")[1], 10);
      if (st === 204 || st === 304 || (st >= 100 && st < 200)) { bodyRaw = new Uint8Array(0); pos = bodyStart; }
      else { bodyRaw = stream.subarray(bodyStart); pos = stream.length; }
    } else { bodyRaw = new Uint8Array(0); pos = bodyStart; }

    const layers = decodeBodyLayers(bodyRaw, headers);
    msgs.push({
      kind, startLine, headers, bodyRaw, truncated, layers,
      method: kind === "request" ? startLine.split(" ")[0] : null,
      url: kind === "request" ? startLine.split(" ")[1] : null,
      status: kind === "response" ? parseInt(startLine.split(" ")[1], 10) : null,
      contentType: headers["content-type"] || "",
      host: headers["host"] || "",
    });
  }
  return msgs;
}

// ============================================================
// 8. MQTT（3.1.1 / 5.0）
// ============================================================
const MQTT_TYPES = {
  1: "CONNECT", 2: "CONNACK", 3: "PUBLISH", 4: "PUBACK", 5: "PUBREC", 6: "PUBREL", 7: "PUBCOMP",
  8: "SUBSCRIBE", 9: "SUBACK", 10: "UNSUBSCRIBE", 11: "UNSUBACK", 12: "PINGREQ", 13: "PINGRESP",
  14: "DISCONNECT", 15: "AUTH",
};

function readVarInt(b, pos) {
  let mult = 1, val = 0, i = 0;
  while (pos + i < b.length && i < 4) {
    const enc = b[pos + i];
    val += (enc & 0x7f) * mult;
    i++;
    if ((enc & 0x80) === 0) return { value: val, size: i };
    mult *= 128;
  }
  return null;
}
function readUtf8(b, pos) {
  if (pos + 2 > b.length) return null;
  const len = u16be(b, pos);
  if (pos + 2 + len > b.length) return null;
  return { str: latin1(b, pos + 2, pos + 2 + len), end: pos + 2 + len };
}

/**
 * 解析一段已重组的 MQTT 字节流（同一方向）→ 消息数组。
 * 返回 { ok, messages }；ok=false 表示这段流不像 MQTT。
 */
export function parseMqttStream(bytes) {
  const messages = [];
  let pos = 0;
  if (bytes.length < 2) return { ok: false, messages, reason: "字节不足" };
  while (pos + 2 <= bytes.length) {
    const b0 = bytes[pos];
    const type = (b0 >> 4) & 0x0f;
    if (type < 1 || type > 15) return { ok: messages.length > 0, messages, reason: "非法报文类型 " + type };
    const rl = readVarInt(bytes, pos + 1);
    if (!rl) return { ok: messages.length > 0, messages, reason: "剩余长度非法" };
    const bodyStart = pos + 1 + rl.size;
    const bodyEnd = bodyStart + rl.value;
    if (bodyEnd > bytes.length) {
      // 允许流末截断：记录已解析的，停止
      break;
    }
    const body = bytes.subarray(bodyStart, bodyEnd);
    const flags = b0 & 0x0f;
    const msg = { type, typeName: MQTT_TYPES[type] || ("type " + type), offset: pos, length: bodyEnd - pos };
    try {
      if (type === 1) {
        const pn = readUtf8(body, 0);
        if (pn) {
          msg.protocolName = pn.str;
          const level = body[pn.end];
          const cflags = body[pn.end + 1];
          msg.protocolLevel = level;
          msg.cleanSession = !!(cflags & 0x02);
          msg.willFlag = !!(cflags & 0x04);
          msg.willQoS = (cflags >> 3) & 0x03;
          msg.willRetain = !!(cflags & 0x20);
          msg.hasPassword = !!(cflags & 0x40);
          msg.hasUsername = !!(cflags & 0x80);
          msg.keepAlive = u16be(body, pn.end + 2);
          let q = pn.end + 4;
          const cid = readUtf8(body, q);
          if (cid) { msg.clientId = cid.str; q = cid.end; }
          if (msg.willFlag) {
            const wt = readUtf8(body, q);
            if (wt) { msg.willTopic = wt.str; q = wt.end; }
            const wm = readUtf8(body, q);
            if (wm) { msg.willMessage = wm.str; q = wm.end; }
          }
          if (msg.hasUsername) { const u = readUtf8(body, q); if (u) { msg.username = u.str; q = u.end; } }
          if (msg.hasPassword) { const pw = readUtf8(body, q); if (pw) { msg.password = pw.str; q = pw.end; } }
        }
      } else if (type === 3) {
        msg.retain = !!(flags & 0x01);
        msg.qos = (flags >> 1) & 0x03;
        msg.dup = !!(flags & 0x08);
        const t = readUtf8(body, 0);
        if (t) {
          msg.topic = t.str;
          let q = t.end;
          if (msg.qos > 0 && q + 2 <= body.length) { msg.packetId = u16be(body, q); q += 2; }
          msg.payload = body.subarray(q);
          msg.payloadText = isMostlyText(msg.payload, 256) ? latin1(msg.payload) : null;
          msg.payloadHex = toHex(msg.payload, 0, Math.min(msg.payload.length, 64));
        }
      } else if (type === 8 || type === 10) {
        if (body.length >= 2) msg.packetId = u16be(body, 0);
        const topics = [];
        let q = 2;
        while (q + 3 <= body.length) {
          const t = readUtf8(body, q);
          if (!t) break;
          const qos = body[t.end];
          topics.push({ topic: t.str, qos });
          q = t.end + 1;
        }
        msg.topics = topics;
      } else if (type === 9) {
        if (body.length >= 2) msg.packetId = u16be(body, 0);
        msg.granted = Array.from(body.subarray(2));
      } else if (type === 2) {
        if (body.length >= 2) { msg.sessionPresent = !!(body[0] & 1); msg.returnCode = body[1]; }
      }
    } catch { /* 单条解析失败不阻断 */ }
    messages.push(msg);
    pos = bodyEnd;
  }
  const ok = messages.length > 0 && messages.some((m) => m.type === 1 || m.type === 3 || m.type === 8 || m.type === 12);
  return { ok, messages };
}

/** 把 MQTT 消息汇总成「主题表」。 */
export function buildMqttTopicTable(messages) {
  const table = new Map();
  let connects = 0, subscribes = 0, pings = 0, connacks = 0, subacks = 0;
  for (const m of messages) {
    if (m.type === 1) connects++;
    else if (m.type === 2) connacks++;
    else if (m.type === 8) { subscribes++; for (const t of m.topics || []) if (!table.has(t.topic)) table.set(t.topic, { topic: t.topic, subscribedQos: t.qos, publishes: [] }); }
    else if (m.type === 9) subacks++;
    else if (m.type === 12) pings++;
    else if (m.type === 3 && m.topic) {
      if (!table.has(m.topic)) table.set(m.topic, { topic: m.topic, subscribedQos: null, publishes: [] });
      table.get(m.topic).publishes.push(m);
    }
  }
  return { topics: [...table.values()], stats: { connects, connacks, subscribes, subacks, pings } };
}

const MAGIC_SIGNS = [
  { sig: "526172211a0700", name: "RAR 压缩包", ext: "rar" },
  { sig: "526172211a070100", name: "RAR5 压缩包", ext: "rar" },
  { sig: "504b0304", name: "ZIP 压缩包", ext: "zip" },
  { sig: "1f8b08", name: "gzip 流", ext: "gz" },
  { sig: "89504e470d0a1a0a", name: "PNG 图片", ext: "png" },
  { sig: "ffd8ff", name: "JPEG 图片", ext: "jpg" },
  { sig: "7f454c46", name: "ELF 可执行文件", ext: "elf" },
  { sig: "25504446", name: "PDF 文档", ext: "pdf" },
];
function detectMagic(bytes) {
  const h = toHex(bytes, 0, Math.min(bytes.length, 8));
  for (const m of MAGIC_SIGNS) if (h.startsWith(m.sig)) return m;
  return null;
}

/**
 * 载荷的多种可能解释：原始字节；若载荷本身是 hex 文本则再 hex 解码一次。
 * （CTF 里常见「把压缩包 hex 成字符串再当 MQTT 载荷发」的写法）
 */
export function payloadVariants(payload) {
  const out = [];
  if (!payload || !payload.length) return out;
  out.push({ how: "原始载荷", bytes: payload });
  const text = latin1(payload).trim();
  if (text.length >= 8 && text.length % 2 === 0 && /^[0-9a-fA-F]+$/.test(text)) {
    out.push({ how: "载荷为 hex 文本 → hex 解码", bytes: hexToBytesLocal(text) });
  }
  return out;
}

// 注意：不加尾部 \b —— 压缩包里的名字常紧跟数字/二进制，\b 会因 "txt0" 这类相邻词字符而失配
const ARCHIVE_EXT_RE = /[\w.\-]{2,64}\.(?:txt|png|jpg|jpeg|gif|rar|zip|7z|tar|gz|php|py|js|flag|docx|xlsx|pdf|bin|dat)/gi;
/** 在二进制里扫可打印文件名（压缩包目录项/头里常见）。 */
export function listArchiveNames(bytes) {
  const found = new Set();
  let run = "";
  const push = () => { if (run.length >= 4) { const m = run.match(ARCHIVE_EXT_RE); if (m) for (const x of m) found.add(x); } run = ""; };
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b >= 0x20 && b <= 0x7e) run += String.fromCharCode(b);
    else push();
    if (found.size > 12) break;
  }
  push();
  return [...found];
}

// ============================================================
// 9. USB（USBPcap 伪头 + usbmon-mmap 头）
// ============================================================
/** 从 USBPcap 帧解析伪头。返回 null 表示不是 USBPcap。 */
function parseUsbPcapHeader(raw) {
  if (raw.length < 27) return null;
  const headerLen = u16le(raw, 0);
  if (headerLen < 27 || headerLen > raw.length || headerLen > 64) return null;
  if (raw[1] !== 0) return null; // headerLen 高字节必为 0
  const info = raw[16];
  const transfer = raw[22];
  const dataLength = u32le(raw, 23);
  if (transfer > 4) return null;
  if (headerLen + Math.min(dataLength, raw.length - headerLen) > raw.length) {
    // 允许截断，但仍视为 USBPcap（dataLength 声明大于实捕获）
  }
  return {
    headerLen,
    irpId: toHex(raw, 2, 10),
    status: u32le(raw, 10),
    func: u16le(raw, 14),
    info,
    direction: info & 1, // 1 = device→host (IN)
    bus: u16le(raw, 17),
    device: u16le(raw, 19),
    endpoint: raw[21],
    transfer, // 0 isoc, 1 interrupt, 2 control, 3 bulk, 4 ...
    dataLength,
    data: raw.subarray(headerLen, Math.min(raw.length, headerLen + dataLength)),
  };
}

/** 从 usbmon mmap 帧解析头（64 字节）。返回 null 表示不是该格式。 */
function parseUsbmonMmapHeader(raw) {
  if (raw.length < 64) return null;
  const t = raw[8];
  if (t !== 0x53 && t !== 0x43 && t !== 0x45) return null; // 'S' / 'C' / 'E'
  const lenCap = u32le(raw, 36);
  return {
    headerLen: 64, type: String.fromCharCode(t), xferType: raw[9], epnum: raw[10], devnum: raw[11],
    bus: u16le(raw, 12), status: s32le(raw, 28), length: u32le(raw, 32), lenCap,
    endpoint: raw[10], device: raw[11], transfer: raw[9],
    direction: (raw[10] & 0x80) ? 1 : 0,
    data: raw.subarray(64, Math.min(raw.length, 64 + lenCap)),
  };
}

/** 解析 USB 配置描述符 blob → 接口/端点角色表。 */
export function parseUsbConfigDescriptor(blob) {
  const ifaces = [];
  let i = 0;
  while (i + 2 <= blob.length) {
    const len = blob[i];
    if (len === 0) break;
    const type = blob[i + 1];
    if (type === 4 && i + 9 <= blob.length) {
      ifaces.push({ num: blob[i + 2], cls: blob[i + 5], sub: blob[i + 6], proto: blob[i + 7], eps: [] });
    } else if (type === 5 && i + 7 <= blob.length && ifaces.length) {
      ifaces[ifaces.length - 1].eps.push({ addr: blob[i + 2], attr: blob[i + 3], mps: u16le(blob, i + 4) });
    }
    i += len;
  }
  return ifaces;
}

/** 把接口描述翻译成人类角色名。 */
function ifaceRole(iface) {
  if (!iface) return "未知";
  if (iface.cls === 3 && iface.sub === 1 && iface.proto === 1) return "keyboard";
  if (iface.cls === 3 && iface.sub === 1 && iface.proto === 2) return "mouse";
  if (iface.cls === 3) return "hid";
  if (iface.cls === 8) return "mass-storage";
  if (iface.cls === 224) return "wireless-radio";
  if (iface.cls === 14) return "video";
  if (iface.cls === 9) return "hub";
  if (iface.cls === 255) return "vendor";
  return "class-" + iface.cls;
}

/**
 * 从 USB 帧集合提取：
 *   descriptors: Map(dev → ifaces[])
 *   groups:      Map("dev=.. ep=0x.." → { dev, ep, role, reports:[{data, ts, bus}] })
 */
export function extractUsbStreams(packets, opts) {
  const descriptors = new Map();
  const groups = new Map();
  const headerKinds = { usbpcap: 0, usbmon: 0 };
  const seenEp = new Map(); // dev → Set(ep) 用于 fallback 角色推断
  const records = [];

  for (const pkt of packets) {
    let h = parseUsbPcapHeader(pkt.raw);
    let kind = "usbpcap";
    if (!h) { h = parseUsbmonMmapHeader(pkt.raw); kind = "usbmon"; }
    if (!h) continue;
    headerKinds[kind]++;
    h.pktIndex = pkt.index;
    h.tsSec = pkt.tsSec;
    h.tsUsec = pkt.tsUsec;
    records.push(h);

    if (kind === "usbpcap" && h.transfer === 2 && h.direction === 1 && h.func === 0x8 && h.data.length >= 2) {
      const dtype = h.data[1];
      if (dtype === 2) descriptors.set(h.device, parseUsbConfigDescriptor(h.data));
    }
    if (kind === "usbpcap" && h.transfer === 2 && h.direction === 1 && h.func === 0x8 && h.data.length >= 2 && h.data[1] === 0x22) {
      // HID report descriptor：仅记录存在，用于角色确认
      const cur = descriptors.get(h.device) || [];
      descriptors.set(h.device, cur);
    }

    // 只收「设备→主机 的中断/批量数据」，即真正的 HID 输入报告
    const isInput = h.direction === 1;
    const isData = (h.transfer === 1 || h.transfer === 3) && h.data.length > 0;
    if (isInput && isData) {
      const key = "dev=" + h.device + " ep=0x" + h.endpoint.toString(16);
      if (!groups.has(key)) groups.set(key, { dev: h.device, bus: h.bus, ep: h.endpoint, reports: [], firstIndex: h.pktIndex });
      groups.get(key).reports.push({ data: h.data, tsSec: h.tsSec, tsUsec: h.tsUsec, index: h.pktIndex });
    }
    if (!seenEp.has(h.device)) seenEp.set(h.device, new Set());
    seenEp.get(h.device).add(h.endpoint);
  }

  // 角色推断：优先描述符，其次报告长度
  for (const g of groups.values()) {
    const ifaces = descriptors.get(g.dev) || [];
    let role = null;
    for (const iface of ifaces) {
      if ((iface.eps || []).some((e) => e.addr === g.ep)) { role = ifaceRole(iface); break; }
    }
    if (!role && ifaces.length === 1) role = ifaceRole(ifaces[0]);
    const lens = [...new Set(g.reports.map((r) => r.data.length))];
    g.reportLens = lens;
    g.ifaceRole = role;
    if (!role) {
      if (lens.includes(4) && lens.length === 1) role = "mouse";
      else if (lens.includes(8) && lens.length === 1) role = "keyboard";
      else role = "unknown";
    }
    g.role = role;
  }
  return { descriptors, groups, records, headerKinds };
}

// ---- HID 键盘 usage 表（USB HID 1.21 Keyboard/Keypad 页 0x07 照抄，含数字小键盘） ----
const HID_KEY = {
  0x04: ["a", "A"], 0x05: ["b", "B"], 0x06: ["c", "C"], 0x07: ["d", "D"], 0x08: ["e", "E"], 0x09: ["f", "F"],
  0x0a: ["g", "G"], 0x0b: ["h", "H"], 0x0c: ["i", "I"], 0x0d: ["j", "J"], 0x0e: ["k", "K"], 0x0f: ["l", "L"],
  0x10: ["m", "M"], 0x11: ["n", "N"], 0x12: ["o", "O"], 0x13: ["p", "P"], 0x14: ["q", "Q"], 0x15: ["r", "R"],
  0x16: ["s", "S"], 0x17: ["t", "T"], 0x18: ["u", "U"], 0x19: ["v", "V"], 0x1a: ["w", "W"], 0x1b: ["x", "X"],
  0x1c: ["y", "Y"], 0x1d: ["z", "Z"],
  0x1e: ["1", "!"], 0x1f: ["2", "@"], 0x20: ["3", "#"], 0x21: ["4", "$"], 0x22: ["5", "%"], 0x23: ["6", "^"],
  0x24: ["7", "&"], 0x25: ["8", "*"], 0x26: ["9", "("], 0x27: ["0", ")"],
  0x28: ["\n", "\n"], 0x29: ["[ESC]", "[ESC]"], 0x2a: ["[BKSP]", "[BKSP]"], 0x2b: ["\t", "\t"], 0x2c: [" ", " "],
  0x2d: ["-", "_"], 0x2e: ["=", "+"], 0x2f: ["[", "{"], 0x30: ["]", "}"], 0x31: ["\\", "|"], 0x32: ["#", "~"],
  0x33: [";", ":"], 0x34: ["'", "\""], 0x35: ["`", "~"], 0x36: [",", "<"], 0x37: [".", ">"], 0x38: ["/", "?"],
  0x39: ["[CAPS]", "[CAPS]"],
  0x3a: ["[F1]", "[F1]"], 0x3b: ["[F2]", "[F2]"], 0x3c: ["[F3]", "[F3]"], 0x3d: ["[F4]", "[F4]"],
  0x3e: ["[F5]", "[F5]"], 0x3f: ["[F6]", "[F6]"], 0x40: ["[F7]", "[F7]"], 0x41: ["[F8]", "[F8]"],
  0x42: ["[F9]", "[F9]"], 0x43: ["[F10]", "[F10]"], 0x44: ["[F11]", "[F11]"], 0x45: ["[F12]", "[F12]"],
  0x49: ["[INS]", "[INS]"], 0x4a: ["[HOME]", "[HOME]"], 0x4b: ["[PGUP]", "[PGUP]"], 0x4c: ["[DEL]", "[DEL]"],
  0x4d: ["[END]", "[END]"], 0x4e: ["[PGDN]", "[PGDN]"], 0x4f: ["[RIGHT]", "[RIGHT]"], 0x50: ["[LEFT]", "[LEFT]"],
  0x51: ["[DOWN]", "[DOWN]"], 0x52: ["[UP]", "[UP]"],
  // 数字小键盘（NumLock 打开时的字符解释；CTF 里常见「小键盘打 hex」）
  0x53: ["[NUMLK]", "[NUMLK]"], 0x54: ["/", "/"], 0x55: ["*", "*"], 0x56: ["-", "-"], 0x57: ["+", "+"], 0x58: ["\n", "\n"],
  0x59: ["1", "1"], 0x5a: ["2", "2"], 0x5b: ["3", "3"], 0x5c: ["4", "4"], 0x5d: ["5", "5"], 0x5e: ["6", "6"],
  0x5f: ["7", "7"], 0x60: ["8", "8"], 0x61: ["9", "9"], 0x62: ["0", "0"], 0x63: [".", "."],
  0x64: ["<", ">"], 0x67: ["=", "="],
};
const MOD_NAMES = { 0x01: "LCtrl", 0x02: "LShift", 0x04: "LAlt", 0x08: "LGui", 0x10: "RCtrl", 0x20: "RShift", 0x40: "RAlt", 0x80: "RGui" };

// Ctrl 组合键 → ASCII 控制字符（C0 表）。这不是本工具的约定，而是 ASCII 本身：
// Ctrl+A=0x01(SOH) … Ctrl+Z=0x1A(SUB)、Ctrl+Space=0x00(NUL)、Ctrl+[=0x1B(ESC) 等，
// 终端也是把这些码位交给前台程序的。未在 ASCII 中定义的组合返回 null（不产出字符）。
function ctrlCharOf(code) {
  if (code >= 0x04 && code <= 0x1d) return String.fromCharCode(code - 0x03); // a..z → 0x01..0x1a
  switch (code) {
    case 0x28: return "\n";    // Enter
    case 0x2b: return "\t";    // Tab
    case 0x2c: return "\x00";  // Space / @
    case 0x2d: return "\x1f";  // - / _ → US
    case 0x2f: return "\x1b";  // [ / { → ESC
    case 0x30: return "\x1d";  // ] / } → GS
    case 0x31: return "\x1c";  // \ / | → FS
    case 0x38: return "\x7f";  // / / ? → DEL
    default: return null;
  }
}
// 组合键类别：gui（本机系统消费，不进会话）/ alt（POSIX 终端 meta，ESC 前缀）/ ctrl（C0 控制字符）/ null（Shift、CapsLock 等按字符表出字）。
function comboKind(mods) {
  if (mods.some((m) => m.endsWith("Gui"))) return "gui";
  if (mods.some((m) => m.endsWith("Alt"))) return "alt";
  if (mods.some((m) => m.endsWith("Ctrl"))) return "ctrl";
  return null;
}

/**
 * 解码键盘 HID 报告序列（8 字节 boot 报告：modifier + reserved + keycodes1..6）。
 * 修饰键参与字符生成：Ctrl 出 C0 控制字符、Alt 出 ESC 前缀（meta）、Gui 不出字符并如实登记；
 * 绝不把组合键按裸字母写进明文（那会污染 flag，属静默错误）。
 * opts: { backspace:boolean, capsInitial:boolean }
 * 返回 { text, keys:[{index,code,char,base,combo,shift,caps,mods}], pressedKeys, capsLock }
 */
export function decodeKeyboardReports(reports, opts) {
  const o = opts || {};
  const useBackspace = o.backspace !== false;
  let caps = !!o.capsInitial;
  let text = "";
  const keys = [];
  let prev = new Set();

  reports.forEach((rep, ri) => {
    const data = rep.data || rep;
    if (data.length < 3) return;
    const mod = data[0];
    const shift = !!(mod & 0x22);
    const mods = Object.keys(MOD_NAMES).filter((m) => mod & Number(m)).map((m) => MOD_NAMES[m]);
    const codes = [];
    for (let j = 2; j < Math.min(8, data.length); j++) if (data[j] !== 0) codes.push(data[j]);
    const cur = new Set(codes);

    for (const code of codes) {
      if (prev.has(code)) continue; // 长按重复：同一键连续出现不重复输出
      const map = HID_KEY[code];
      let ch = map ? (shift ? map[1] : map[0]) : ("[0x" + code.toString(16).padStart(2, "0") + "]");
      if (code === 0x39) { caps = !caps; keys.push({ index: rep.index, code, char: null, shift, caps, mods, ts: rep.tsSec !== undefined ? rep.tsSec + (rep.tsUsec || 0) / 1e6 : undefined, note: "CapsLock →" + (caps ? "开" : "关") }); continue; }
      // 字母受 CapsLock 影响；Shift 与 CapsLock 异或
      if (map && code >= 0x04 && code <= 0x1d) ch = (shift !== caps) ? map[1] : map[0];
      const base = ch;                          // 不带修饰键时的字面字符（仅供报告标注组合键用）
      const combo = comboKind(mods);            // Ctrl / Alt / Gui 组合键：改走控制字符语义
      if (combo === "gui") ch = null;           // 本机系统消费，不进会话
      else if (combo === "alt") ch = ch === null ? null : "\x1b" + ch; // POSIX 终端 meta = ESC 前缀
      else if (combo === "ctrl") ch = ctrlCharOf(code);
      if (code === 0x2a && !combo) {
        if (useBackspace) { text = text.slice(0, -1); }
        else text += ch;
        keys.push({ index: rep.index, code, char: useBackspace ? "[退格]" : ch, shift, caps, mods, ts: rep.tsSec !== undefined ? rep.tsSec + (rep.tsUsec || 0) / 1e6 : undefined });
        continue;
      }
      if (ch !== null) text += ch;
      keys.push({ index: rep.index, code, char: ch, base: base === ch ? undefined : base, combo: combo || undefined, shift, caps, mods, ts: rep.tsSec !== undefined ? rep.tsSec + (rep.tsUsec || 0) / 1e6 : undefined });
    }
    prev = cur;
  });
  return { text, keys, capsLock: caps };
}

// ---- 鼠标报告布局自动选择 ----
// byte0 约定为按键位，永不作为位移轴。
function mouseDeltaCandidates(len) {
  if (len <= 4) return [{ dx: 1, dy: 2, w: 1, label: "boot 4 字节 (buttons, dX, dY, wheel)" }];
  const c = [];
  for (const dx of [1, 2, 3, 4, 5]) for (const dy of [1, 2, 3, 4, 5]) {
    if (dx === dy) continue;
    if (dx > len - 1 || dy > len - 1) continue;
    c.push({ dx, dy, w: 1, label: "int8 byte" + dx + "/byte" + dy });
  }
  for (const [dx, dy] of [[1, 2], [2, 3], [2, 4], [3, 4], [1, 3]]) {
    if (dx + 2 > len || dy + 2 > len) continue;
    c.push({ dx, dy, w: 2, label: "int16le byte" + dx + "-" + (dx + 1) + "/byte" + dy + "-" + (dy + 1) });
  }
  return c;
}
// 某轴字节的取值多样性：真实位移轴会取多个值；常量字节或 1 bit 信号（仅 {0,255}）会被排除
function axisDistinct(reports, idx, w) {
  const s = new Set();
  for (const r of reports) {
    const b = r.data || r;
    if (idx + (w === 2 ? 1 : 0) >= b.length) return 0;
    s.add(w === 2 ? (b[idx] | (b[idx + 1] << 8)) : b[idx]);
    if (s.size >= 6) break;
  }
  return s.size;
}
function evalMouseLayout(reports, cand) {
  let x = 0, y = 0, nz = 0, nzX = 0, nzY = 0;
  const deltas = [];
  const pts = [];
  for (const r of reports) {
    const b = r.data || r;
    let dx, dy;
    if (cand.w === 2) { dx = s16le(b, cand.dx); dy = s16le(b, cand.dy); }
    else { dx = s8(b[cand.dx]); dy = s8(b[cand.dy]); }
    const m = Math.abs(dx) + Math.abs(dy);
    deltas.push(m);
    if (m > 0) nz++;
    if (dx !== 0) nzX++;
    if (dy !== 0) nzY++;
    x += dx; y += dy;
    pts.push([x, y]);
  }
  const sorted = deltas.slice().sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  const mean = deltas.reduce((a, b) => a + b, 0) / (deltas.length || 1);
  let minx = 0, maxx = 0, miny = 0, maxy = 0;
  for (const p of pts) { if (p[0] < minx) minx = p[0]; if (p[0] > maxx) maxx = p[0]; if (p[1] < miny) miny = p[1]; if (p[1] > maxy) maxy = p[1]; }
  return { pts, p95, mean, nzFrac: nz / (deltas.length || 1), nzXFrac: nzX / (deltas.length || 1), nzYFrac: nzY / (deltas.length || 1), minx, maxx, miny, maxy };
}

/**
 * 解码鼠标 HID 报告序列 → 轨迹 + 按键事件（字符画布已由 9.5 节真彩轨迹图取代）。
 * opts: { layout:null|{dx,dy,w} }
 */
export function decodeMouseReports(reports, opts) {
  const o = opts || {};
  if (!reports.length) return { points: [], events: [], bbox: null, layout: null, reportCount: 0 };
  const len = reports[0].data ? reports[0].data.length : reports[0].length;
  let best = null;
  const cands = o.layout ? [o.layout] : mouseDeltaCandidates(len);
  if (o.layout) {
    best = { cand: o.layout, ev: evalMouseLayout(reports, o.layout) };
  } else if (len <= 4) {
    best = { cand: cands[0], ev: evalMouseLayout(reports, cands[0]) };
  } else {
    // 优先：两轴都「取值多样」（≥3 种）且都有位移 —— 排除常量字节与 1 bit 信号
    let pool = cands.filter((c) => axisDistinct(reports, c.dx, c.w) >= 3 && axisDistinct(reports, c.dy, c.w) >= 3);
    let evs = pool.map((c) => ({ cand: c, ev: evalMouseLayout(reports, c) })).filter((x) => x.ev.nzXFrac >= 0.05 && x.ev.nzYFrac >= 0.05);
    if (!evs.length) {
      // 退化：只要单轴有位移
      evs = cands.map((c) => ({ cand: c, ev: evalMouseLayout(reports, c) })).filter((x) => x.ev.nzFrac >= 0.3);
    }
    if (!evs.length) evs = [{ cand: cands[0], ev: evalMouseLayout(reports, cands[0]) }];
    // 选：步长 95 分位最小 → 平均步长最小 → 轨迹覆盖面最大
    evs.sort((a, b) => (a.ev.p95 - b.ev.p95) || (a.ev.mean - b.ev.mean) ||
      ((b.ev.maxx - b.ev.minx) * (b.ev.maxy - b.ev.miny)) - ((a.ev.maxx - a.ev.minx) * (a.ev.maxy - a.ev.miny)));
    best = evs[0];
  }

  // 按键事件（按钮位按位上升沿）
  const events = [];
  let prevBtn = 0;
  reports.forEach((r, i) => {
    const b = r.data || r;
    const btn = b[0] & 0x07;
    for (let bit = 0; bit < 3; bit++) {
      const mask = 1 << bit;
      if ((btn & mask) && !(prevBtn & mask)) events.push({ type: "down", button: ["左键", "右键", "中键"][bit], index: (r.index !== undefined ? r.index : i) });
      else if (!(btn & mask) && (prevBtn & mask)) events.push({ type: "up", button: ["左键", "右键", "中键"][bit], index: (r.index !== undefined ? r.index : i) });
    }
    prevBtn = btn;
  });

  const ev = best.ev;
  const W = ev.maxx - ev.minx + 1;
  const H = ev.maxy - ev.miny + 1;
  // 抬笔判据沿用旧字符画布公式（cols 固定 120 档），笔划段数与旧版同口径；字符画布由真彩 PNG 取代
  let strokes = 0;
  if (W > 1 && H > 1) {
    const lift = Math.max(8, Math.round(Math.max(W, H) / 120) * 4); // 超过该步长视为抬笔（新一笔）
    for (let i = 1; i < ev.pts.length; i++) {
      const [x, y] = ev.pts[i];
      const [px, py] = ev.pts[i - 1];
      if (Math.abs(x - px) + Math.abs(y - py) > lift) strokes++;
    }
    strokes++; // 首点自成一笔
  }
  return {
    reportCount: reports.length, points: ev.pts, events, layout: best.cand, strokes,
    bbox: { minX: ev.minx, maxX: ev.maxx, minY: ev.miny, maxY: ev.maxy, width: W, height: H },
    meanStep: ev.mean, p95Step: ev.p95, movingRatio: ev.nzFrac,
  };
}

// ============================================================
// 9.5 轨迹 / 节奏真彩图（PNG 编码复用 mcMap.encodePNG，输出走产物协议 files）
// ------------------------------------------------------------
// 确定性契约：不读时钟、不用随机数；颜色只由「绘制序号」与固定色表决定，
// 同一份报告输入两次生成，PNG 字节逐字节一致（PNG 内无时间块、无随机序）。
// ============================================================
// 固定色表（6 档锚点，之间线性插值）：深蓝→蓝→青→黄绿→橙→红。深色起点便于在白底上读出先后。
const TRACK_COLORMAP = [
  [0.0, [47, 22, 138]],
  [0.2, [33, 96, 208]],
  [0.4, [36, 178, 162]],
  [0.6, [128, 208, 64]],
  [0.8, [244, 158, 38]],
  [1.0, [216, 44, 44]],
];

/** t∈[0,1] → 固定色表插值 RGB。 */
export function trackColor(t) {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < TRACK_COLORMAP.length; i++) {
    if (x <= TRACK_COLORMAP[i][0]) {
      const t0 = TRACK_COLORMAP[i - 1][0], c0 = TRACK_COLORMAP[i - 1][1];
      const t1 = TRACK_COLORMAP[i][0], c1 = TRACK_COLORMAP[i][1];
      const f = (x - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
      ];
    }
  }
  return TRACK_COLORMAP[TRACK_COLORMAP.length - 1][1].slice();
}

function pngArtifact(name, rgba, width, height) {
  return { name, mime: "image/png", bytes: encodePNG(rgba, width, height, zlibFixed), width, height };
}

// ---- 定长 Huffman deflate（BTYPE=01）----
function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
// 轨迹图是白底稀疏点阵：zlibStore（存储块）会让 3.3M 像素出 13MB PNG，浏览器渲染/下载被拖死；
// 定长 Huffman + 贪心 LZ77 把大段重复底色压掉（实测 13MB → ~数百 KB），输出确定性不变。
// 只用于本文件的两个真彩图产物；mcMap.encodePNG 的默认 zlibStore 与其他 op 不受影响。
// 正确性自证：IDAT 经 node zlib.inflate 回读必须与原像素逐字节一致（独立验证脚本）。
export function zlibFixed(raw) {
  const out = [];
  const bitBuf = [];
  let acc = 0, nbits = 0;
  const put = (val, n) => { acc |= val << nbits; nbits += n; while (nbits >= 8) { bitBuf.push(acc & 0xff); acc >>>= 8; nbits -= 8; } };
  // deflate 规则：Huffman 码按 MSB 先行进位流，普通字段（额外位）按 LSB 先行。
  const putCode = (code, n) => { for (let b = n - 1; b >= 0; b--) put((code >>> b) & 1, 1); };
  out.push(0x78, 0x01);
  // 定长码表：字面 0-143 → 8 位 00110000+；144-255 → 9 位 110010000+；
  // 长度符号 257-279 → 7 位（码 = sym−256）、280-287 → 8 位（码 = 11000000+）；距离 5 位。
  const putLiteral = (b) => { if (b < 144) putCode(0x30 + b, 8); else putCode(0x190 + b - 144, 9); };
  const putLenSym = (s) => { if (s < 280) putCode(s - 256, 7); else putCode(0xc0 + s - 280, 8); };
  const putDist = (d) => putCode(d, 5);
  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  put(1, 1); // BFINAL=1（单块）
  put(1, 2); // BTYPE=01 定长 Huffman
  const HB = 1 << 15;
  const head = new Int32Array(HB).fill(-1);
  const prev = new Int32Array(raw.length).fill(-1);
  const h = (i) => ((raw[i] << 10) ^ (raw[i + 1] << 5) ^ raw[i + 2]) & (HB - 1);
  let i = 0;
  while (i < raw.length) {
    let bestLen = 0, bestDist = 0;
    if (i + 2 < raw.length) {
      const hv = h(i);
      let j = head[hv];
      const limit = Math.max(0, i - 32768);
      let tries = 0;
      while (j >= limit && tries < 32) {
        if (raw[j] === raw[i] && raw[j + 1] === raw[i + 1] && raw[j + 2] === raw[i + 2]) {
          let len = 3;
          const maxLen = Math.min(258, raw.length - i);
          while (len < maxLen && raw[j + len] === raw[i + len]) len++;
          if (len > bestLen) { bestLen = len; bestDist = i - j; if (len >= 258) break; }
        }
        j = prev[j]; tries++;
      }
    }
    if (bestLen >= 3) {
      let lc = LEN_BASE.length - 1;
      while (lc > 0 && LEN_BASE[lc] > bestLen) lc--;
      putLenSym(257 + lc);
      put(bestLen - LEN_BASE[lc], LEN_EXTRA[lc]);
      let dc = DIST_BASE.length - 1;
      while (dc > 0 && DIST_BASE[dc] > bestDist) dc--;
      putDist(dc);
      put(bestDist - DIST_BASE[dc], DIST_EXTRA[dc]);
      for (let k = 0; k < bestLen; k++) { if (i + 2 < raw.length) { const hv2 = h(i); prev[i] = head[hv2]; head[hv2] = i; } i++; }
    } else {
      putLiteral(raw[i]);
      if (i + 2 < raw.length) { const hv2 = h(i); prev[i] = head[hv2]; head[hv2] = i; }
      i++;
    }
  }
  putLenSym(256); // EOB
  if (nbits > 0) bitBuf.push(acc & 0xff);
  const fin = new Uint8Array(out.length + bitBuf.length + 4);
  fin.set(out, 0);
  fin.set(bitBuf, out.length);
  const ad = adler32(raw);
  fin[out.length + bitBuf.length] = (ad >>> 24) & 0xff;
  fin[out.length + bitBuf.length + 1] = (ad >>> 16) & 0xff;
  fin[out.length + bitBuf.length + 2] = (ad >>> 8) & 0xff;
  fin[out.length + bitBuf.length + 3] = ad & 0xff;
  return fin;
}

/**
 * 鼠标轨迹 → RGBA 像素（真彩轨迹图）。规则全部显式，无随机：
 *   - 白底；四周留 8 格边距；网格坐标 = 相对位移累计值 - 包围盒左上角 + 边距。
 *   - 缩放 scale：长边基准 2000（opts.maxSide 可覆盖），像素总量上限 4M，超限自动降档。
 *   - 每个报告点画 1 格色点；相邻两点「和位移 ≤ 抬笔阈值」才按 Bresenham 补线
 *     （抬笔阈值沿用旧字符画布公式，cols 固定 120 档，与笔划段数同口径）。
 *   - 颜色 = trackColor(报告序号 / 总数)：起点深蓝、终点红，沿绘制时序渐变（时间着色）。
 *   - 左键按下位置画 3×3 深灰空心方框（起笔/确认点）。
 */
export function renderTrackImage(dec, opts) {  const o = opts || {};
  const pts = dec && dec.points, bbox = dec && dec.bbox;
  if (!pts || pts.length < 2 || !bbox || bbox.width < 2 || bbox.height < 2) return null;
  const PAD = 8;
  const gw = bbox.width + PAD * 2, gh = bbox.height + PAD * 2;
  const base = (o.maxSide && o.maxSide > 0) ? o.maxSide : 2000;
  let scale = Math.max(1, Math.floor(base / Math.max(gw, gh)));
  while (scale > 1 && gw * gh * scale * scale > 4000000) scale--;
  const W = gw * scale, H = gh * scale;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; }
  const put = (gx, gy, c) => {
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const o4 = ((gy * scale + dy) * W + gx * scale + dx) * 4;
      rgba[o4] = c[0]; rgba[o4 + 1] = c[1]; rgba[o4 + 2] = c[2]; rgba[o4 + 3] = 255;
    }
  };
  const toGrid = (p) => [p[0] - bbox.minX + PAD, p[1] - bbox.minY + PAD];
  const lift = Math.max(8, Math.round(Math.max(bbox.width, bbox.height) / 120) * 4);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [gx, gy] = toGrid(pts[i]);
    put(gx, gy, trackColor(i / Math.max(1, n - 1))); // 每个报告点自成 1 格色点
  }
  for (let i = 1; i < n; i++) {
    const d = Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
    if (d > lift) continue; // 大步长=抬笔，不补线
    let [x0, y0] = toGrid(pts[i - 1]);
    const [x1, y1] = toGrid(pts[i]);
    const c = trackColor(i / Math.max(1, n - 1));
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;
    for (;;) { // Bresenham 补线，颜色取该段末端序号（时序渐变）
      put(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x0 += sx; }
      if (e2 < dx) { err += dx; y0 += sy; }
    }
  }
  for (const e of dec.events || []) { // 左键按下 → 3×3 深灰空心方框
    if (e.type !== "down" || e.button !== "左键") continue;
    const p = pts[Math.min(e.index, n - 1)];
    if (!p) continue;
    const [gx, gy] = toGrid(p);
    for (let k = -1; k <= 1; k++) {
      put(gx + k, gy - 1, [40, 40, 40]); put(gx + k, gy + 1, [40, 40, 40]);
      put(gx - 1, gy + k, [40, 40, 40]); put(gx + 1, gy + k, [40, 40, 40]);
    }
  }
  return { rgba, width: W, height: H, scale };
}

/**
 * 键盘打字节奏 → RGBA 像素（时间着色节奏条）。规则：
 *   - 每键一根 3px 宽竖条（间隔 1px），从左到右 = 按键顺序；图高 64px。
 *   - 条高与颜色按「与上一键的间隔」对数刻度着色（8..56 px；深蓝=连击，红=长停顿）。
 *   - 底部 2px 灰色基线。样本缺时间戳或全 0 → 返回 null（不出图，不硬凑）。
 */
export function renderKeyRhythmImage(keys) {
  const ks = keys || [];
  if (ks.length < 2) return null;
  const ts = ks.map((k) => (k && typeof k.ts === "number" && Number.isFinite(k.ts)) ? k.ts : NaN);
  if (ts.some((t) => Number.isNaN(t))) return null;
  const d = [0];
  let maxD = 0;
  for (let i = 1; i < ts.length; i++) { const x = Math.max(0, ts[i] - ts[i - 1]); d.push(x); if (x > maxD) maxD = x; }
  if (!(maxD > 0)) return null;
  const BAR = 4, PAD = 8, H = 64, BASE = 2;
  const n = Math.min(ks.length, Math.floor((2000 - PAD * 2) / BAR));
  const W = PAD * 2 + n * BAR;
  const rgba = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = 255; rgba[i * 4 + 1] = 255; rgba[i * 4 + 2] = 255; rgba[i * 4 + 3] = 255; }
  const putPx = (x, y, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const o4 = (y * W + x) * 4;
    rgba[o4] = c[0]; rgba[o4 + 1] = c[1]; rgba[o4 + 2] = c[2]; rgba[o4 + 3] = 255;
  };
  const logmax = Math.log2(1 + maxD);
  for (let i = 0; i < n; i++) {
    const t = Math.log2(1 + d[i]) / logmax;
    const c = trackColor(t);
    const h = 8 + Math.round(48 * t);
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < BAR - 1; xx++) putPx(PAD + i * BAR + xx, H - BASE - 1 - yy, c);
  }
  for (let x = 0; x < W; x++) for (let yy = 0; yy < BASE; yy++) putPx(x, H - 1 - yy, [110, 110, 110]);
  return { rgba, width: W, height: H, keysDrawn: n, keysTotal: ks.length };
}

/** 轨迹图 → 产物（encodePNG 链）。范围过小返回 null。 */
function buildTrackArtifact(dec, name, opts) {
  const img = renderTrackImage(dec, opts);
  if (!img) return null;
  const a = pngArtifact(name, img.rgba, img.width, img.height);
  return {
    artifact: { name, mime: "image/png", bytes: a.bytes }, width: a.width, height: a.height,
    note: "白底真彩 PNG：路径颜色沿绘制时序从深蓝渐变到红（起点深蓝、终点红），左键按下处画深灰方框；坐标为相对位移累计值。",
  };
}

/** 打字节奏图 → 产物（encodePNG 链）。无时间戳返回 null。 */
function buildKeyRhythmArtifact(keys, name) {
  const img = renderKeyRhythmImage(keys);
  if (!img) return null;
  const a = pngArtifact(name, img.rgba, img.width, img.height);
  return {
    artifact: { name, mime: "image/png", bytes: a.bytes }, width: a.width, height: a.height,
    note: "每键一根竖条（左=先按），高度与颜色按与上一键的间隔（对数刻度）着色：矮/深蓝=连击，高/红=停顿。",
  };
}

// ============================================================
// 10. flag / 明文线索扫描
// ============================================================
// flag 正文不允许出现控制字符：Ctrl 组合键在明文里是控制字节，若被当成正文而纳入，
// 会造出「花括号里混进一个 c」的假 flag 并高置信置顶 —— 宁可漏报也不许假报。
// 名字侧同理：`f␃lag{...}` 会被通用名字模式匹配到被截断的后缀 `lag{...}`，报出前缀错误的假 flag。
// 但判据要精确到「控制字节把一个单词劈开」：拦的是「字母/数字/_ 紧跟控制字节、再紧跟候选前缀」这一形态
// （`[A-Za-z0-9_][控制字节]+` 紧贴前缀）。否则会误杀 `␃flag{...}` 这种「控制字节在完好 flag 之前」的真答案。
// 行内空白（\t \n \r）不算控制字节，否则行首的 flag 会被误杀。
const CTRL_BEFORE_NAME = "(?<![A-Za-z0-9_][\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f]+)";
const FLAG_PATTERNS = [
  new RegExp(CTRL_BEFORE_NAME + "\\b(?:flag|ctf|key|FLAG|CTF|KEY)\\{[^}\\r\\n\\x00-\\x1f\\x7f]{1,200}\\}", "g"),
  new RegExp(CTRL_BEFORE_NAME + "\\b[a-z0-9_]{2,16}\\{[^}\\r\\n\\x00-\\x1f\\x7f]{4,200}\\}", "g"),
];
export function findFlags(text) {
  if (!text) return [];
  const found = new Set();
  for (const re of FLAG_PATTERNS) {
    const r = new RegExp(re.source, "g");
    let m;
    while ((m = r.exec(text)) !== null) {
      const v = m[0];
      // 过滤明显的非 flag 花括号内容（如 {0}、纯数字）
      if (/^[a-z0-9_]{2,16}\{\d{1,3}\}$/i.test(v)) continue;
      found.add(v);
      if (found.size > 40) break;
    }
  }
  return [...found];
}

// ============================================================
// 11. 主入口
// ============================================================
const USB_LINKTYPES = new Set([220, 249]);

function tsLabel(pkt) {
  return pkt.tsSec + "." + String(pkt.tsUsec).padStart(6, "0");
}

function section(id, title, level, icon, body) { return { id, title, level, icon, body }; }

/**
 * 分析一个流量包字节流，产出结构化结果 + 人话结论。
 * @param {Uint8Array|number[]} bytes
 * @param {object} [opts] { maxList, pngMaxSide, backspace }
 * @returns {object} TrafficResult
 */
export function analyzeTraffic(bytes, opts) {
  const o = opts || {};
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const result = {
    ok: false, error: null, kind: "unknown", container: null, summary: "",
    sections: [], flags: [], tables: {}, artifacts: [], stats: {},
  };
  if (!u8.length) { result.error = "空输入"; result.summary = "空输入，无内容可分析。"; return result; }

  let container;
  try { container = parseContainer(u8); }
  catch (e) { result.error = e.message || String(e); result.summary = "容器解析失败：" + result.error; return result; }
  result.container = container;
  result.ok = true;

  // ---- 概览 ----
  const overview = [];
  overview.push("容器格式: " + container.format + "（" + container.endian + " endian" + (container.nano ? "，纳秒时间戳" : "") + "）");
  overview.push("链路类型: " + container.linkTypeName + " (linkType=" + container.linkType + ")");
  overview.push("包总数: " + container.packets.length);
  if (container.interfaces && container.interfaces.length > 1) {
    overview.push("接口数: " + container.interfaces.length + " → " + container.interfaces.map((i) => (LINKTYPES[i.linkType] || i.linkType)).join(", "));
  }
  const span = container.packets.length ? (container.packets[container.packets.length - 1].tsSec - container.packets[0].tsSec) : 0;
  if (span > 0) overview.push("时间跨度: " + span + " 秒");

  const isUsb = USB_LINKTYPES.has(container.linkType) ||
    (container.interfaces || []).some((i) => USB_LINKTYPES.has(i.linkType)) ||
    container.packets.some((p) => USB_LINKTYPES.has(p.linkType));

  if (isUsb) {
    analyzeUsbPath(container, result, overview, o);
  } else {
    analyzeNetworkPath(container, result, overview, o);
  }

  result.sections.unshift(section("traffic-overview", "流量概览", "info", "analytics", overview.join("\n")));
  if (result.flags.length) {
    result.sections.push(section("traffic-flag", "flag / 明文线索", "alert", "flag",
      result.flags.map((f) => "★ " + f).join("\n")));
  }
  result.stats.packetCount = container.packets.length;
  result.stats.flagCount = result.flags.length;
  return result;
}

// ---- USB 路径 ----
function analyzeUsbPath(container, result, overview, o) {
  const usb = extractUsbStreams(container.packets, o);
  result.stats.headerKinds = usb.headerKinds;
  result.stats.usbGroups = usb.groups.size;
  overview.push("USB 伪头识别: USBPcap " + usb.headerKinds.usbpcap + " 帧 / usbmon-mmap " + usb.headerKinds.usbmon + " 帧");

  const descLines = [];
  for (const [dev, ifaces] of usb.descriptors) {
    for (const iface of ifaces) {
      descLines.push("设备 dev=" + dev + " 接口" + iface.num + ": class=" + iface.cls + " subclass=" + iface.sub +
        " protocol=" + iface.proto + "（" + ifaceRole(iface) + "）端点 " +
        (iface.eps || []).map((e) => "0x" + e.addr.toString(16) + "/" + e.mps + "B").join(" "));
    }
  }
  if (descLines.length) overview.push("USB 描述符: " + usb.descriptors.size + " 个设备已识别");
  result.tables.usbDescriptors = descLines;

  const groups = [...usb.groups.values()].sort((a, b) => a.firstIndex - b.firstIndex);
  if (!groups.length) {
    result.kind = "usb-unknown";
    result.summary = "USB 流量，但未捕获到任何「设备→主机」的中断/批量输入报告（可能只抓到了枚举阶段）。";
    result.sections.push(section("usb-none", "USB 输入报告", "warn", "usb", "未发现可解码的 HID 输入报告。"));
    return;
  }

  const kbdGroups = groups.filter((g) => g.role === "keyboard");
  const mouseGroups = groups.filter((g) => g.role === "mouse");
  const others = groups.filter((g) => g.role !== "keyboard" && g.role !== "mouse");

  const kinds = [];
  if (kbdGroups.length) kinds.push("usb-keyboard");
  if (mouseGroups.length) kinds.push("usb-mouse");
  result.kind = kinds.length ? kinds.join("+") : "usb-unknown";

  const summaryBits = [];
  result.tables.usbStreams = groups.map((g) => ({
    device: g.dev, bus: g.bus, endpoint: "0x" + g.ep.toString(16), role: g.role,
    reports: g.reports.length, reportLengths: g.reportLens,
  }));

  // ---- 键盘 ----
  let ki = 0;
  result.tables.keyboards = [];
  for (const g of kbdGroups) {
    const dec = decodeKeyboardReports(g.reports, { backspace: o.backspace !== false });
    const title = "USB 键盘还原（bus " + g.bus + " / dev " + g.dev + " / EP 0x" + g.ep.toString(16) + "）";
    const lines = [];
    lines.push("报告数: " + g.reports.length + "（报告长度 " + g.reportLens.join("/") + " 字节）");
    lines.push("有效按键事件: " + dec.keys.length + " 次");
    const modCount = {};
    for (const k of dec.keys) for (const m of k.mods) modCount[m] = (modCount[m] || 0) + 1;
    if (Object.keys(modCount).length) lines.push("修饰键统计: " + Object.entries(modCount).map(([k, v]) => k + "×" + v).join(", "));
    const combos = dec.keys.filter((k) => k.combo);
    if (combos.length) {
      const head = combos.slice(0, 12).map((k) => {
        const label = k.mods.join("+") + "+" + (k.base || "0x" + k.code.toString(16).padStart(2, "0"));
        if (k.char === null) return label + "（明文无字符）";
        return label + "→" + escapeText(k.char) + (k.combo === "alt" ? "（meta，ESC 前缀）" : "");
      });
      lines.push("组合键（修饰键参与字符生成，不按裸字母输出）: " + head.join(", ") + (combos.length > 12 ? " … 共 " + combos.length + " 次" : ""));
    }
    lines.push("");
    lines.push("--- 按键序列（HID usage，含修饰键） ---");
    lines.push(dec.keys.map((k) => (k.char === null ? "" : "") + "0x" + k.code.toString(16).padStart(2, "0") + (k.char ? "→" + escapeText(k.char) : "") + (k.mods.length ? "[" + k.mods.join("+") + "]" : "")).join("  ") || "(无)");
    lines.push("");
    lines.push("--- 还原明文（按 Shift / CapsLock / 修饰键状态；控制字符写作 \\xNN） ---");
    lines.push(escapeText(dec.text) || "(空)");

    // 打字节奏图：按键间隔时间着色，真彩 PNG 走产物协议（样本无时间戳时不出图）
    const rhythm = buildKeyRhythmArtifact(dec.keys, "keyboard_rhythm_dev" + g.dev + "_ep" + g.ep.toString(16) + ".png");
    if (rhythm) {
      result.artifacts.push(rhythm.artifact);
      lines.push("");
      lines.push("--- 打字节奏图（真彩 PNG，" + rhythm.width + "×" + rhythm.height + " 像素） ---");
      lines.push(rhythm.note);
    }

    const extra = [];
    const hexText = dec.text.trim();
    let hexDecoded = null;
    if (/^[0-9a-fA-F]+$/.test(hexText) && hexText.length % 2 === 0 && hexText.length >= 4) {
      const ascii = latin1(hexToBytesLocal(hexText));
      if (printableRatio(hexToBytesLocal(hexText)) > 0.85) {
        hexDecoded = ascii;
        extra.push("该明文为偶数长度纯 hex，按 hex 解码后为：");
        extra.push(ascii);
      }
    }
    const fl = findFlags(dec.text + "\n" + extra.join("\n"));
    for (const f of fl) if (!result.flags.includes(f)) result.flags.push(f);
    if (extra.length) { lines.push(""); lines.push("--- 自动二次解码 ---"); lines.push(extra.join("\n")); }

    result.tables.keyboards.push({
      bus: g.bus, device: g.dev, endpoint: "0x" + g.ep.toString(16), reports: g.reports.length,
      keyEvents: dec.keys.length, text: dec.text, hexDecoded, flags: fl,
    });
    result.sections.push(section("usb-keyboard-" + (ki++), title, fl.length ? "alert" : "info", "keyboard", lines.join("\n")));
    const plain = escapeText(dec.text);
    summaryBits.push("键盘(dev" + g.dev + "/EP0x" + g.ep.toString(16) + ") 还原 " + dec.keys.length + " 次按键 → 明文「" + (plain.length > 120 ? plain.slice(0, 120) + "…" : plain) + "」");
  }

  // ---- 鼠标 ----
  let mi = 0;
  result.tables.mouses = [];
  for (const g of mouseGroups) {
    const dec = decodeMouseReports(g.reports, {});
    const title = "USB 鼠标轨迹（bus " + g.bus + " / dev " + g.dev + " / EP 0x" + g.ep.toString(16) + "）";
    const lines = [];
    lines.push("报告数: " + dec.reportCount + "（报告长度 " + g.reportLens.join("/") + " 字节）");
    lines.push("采用位移布局: " + dec.layout.label);
    lines.push("坐标范围: X " + dec.bbox.minX + ".." + dec.bbox.maxX + "（宽 " + dec.bbox.width + "）  Y " + dec.bbox.minY + ".." + dec.bbox.maxY + "（高 " + dec.bbox.height + "）");
    lines.push("平均步长 " + dec.meanStep.toFixed(2) + " px，95 分位步长 " + dec.p95Step + " px，有位移报告占比 " + (dec.movingRatio * 100).toFixed(1) + "%");
    lines.push("笔划段数（按大步长=抬笔切分）: " + dec.strokes);
    const downs = dec.events.filter((e) => e.type === "down");
    const cnt = { 左键: 0, 右键: 0, 中键: 0 };
    for (const e of downs) cnt[e.button]++;
    lines.push("按键事件: 共 " + dec.events.length + " 个（按下 " + downs.length + "） → 左键 " + cnt["左键"] + " / 右键 " + cnt["右键"] + " / 中键 " + cnt["中键"]);
    lines.push("");
    lines.push("--- 轨迹坐标序列（累计，前 20 + 末 10） ---");
    const pts = dec.points;
    const head = pts.slice(0, 20).map((p) => "(" + p[0] + "," + p[1] + ")").join(" ");
    const tail = pts.slice(-10).map((p) => "(" + p[0] + "," + p[1] + ")").join(" ");
    lines.push(head + (pts.length > 30 ? " … " + tail : ""));
    const track = buildTrackArtifact(dec, "mouse_track_dev" + g.dev + "_ep" + g.ep.toString(16) + ".png", { maxSide: o.pngMaxSide });
    if (track) result.artifacts.push(track.artifact);
    lines.push("");
    lines.push("--- 轨迹图（真彩 PNG） ---");
    lines.push(track ? track.note + "（" + track.width + "×" + track.height + " 像素，已加入可下载产物）" : "(轨迹范围过小，未生成图片)");

    result.sections.push(section("usb-mouse-" + (mi++), title, "info", "mouse", lines.join("\n")));
    result.tables.mouses.push({
      bus: g.bus, device: g.dev, endpoint: "0x" + g.ep.toString(16), reports: dec.reportCount,
      layout: dec.layout.label, bbox: dec.bbox, strokes: dec.strokes, pointCount: pts.length,
      buttonDown: downs.length, buttonCounts: cnt,
    });
    result.tables["mousePoints_" + g.dev + "_" + g.ep.toString(16)] = pts.slice(0, 4000);
    summaryBits.push("鼠标(dev" + g.dev + "/EP0x" + g.ep.toString(16) + ") 轨迹 " + dec.reportCount + " 点，范围 " + dec.bbox.width + "×" + dec.bbox.height + "，左键 " + cnt["左键"] + " 次");
  }

  // ---- 其他端点（提示，不展开） ----
  if (others.length) {
    const lines = others.map((g) => "dev " + g.dev + " EP 0x" + g.ep.toString(16) + " 角色 " + g.role + "，报告 " + g.reports.length + " 条，长度 " + g.reportLens.join("/"));
    result.sections.push(section("usb-other", "USB 其他端点", "info", "usb", lines.join("\n")));
  }

  result.summary = "USB 流量（" + container.packets.length + " 包）：识别 " + kbdGroups.length + " 个键盘接口 / " + mouseGroups.length + " 个鼠标接口。"
    + (summaryBits.length ? " " + summaryBits.join("；") : "");
}

function hexToBytesLocal(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}

// ---- 网络路径 ----
function analyzeNetworkPath(container, result, overview, o) {
  const frames = [];
  for (const pkt of container.packets) {
    const lt = pkt.linkType !== undefined ? pkt.linkType : container.linkType;
    const d = dissectFrame(pkt.raw, lt);
    d.index = pkt.index;
    d.tsSec = pkt.tsSec;
    d.tsUsec = pkt.tsUsec;
    d.raw = pkt.raw;
    frames.push(d);
  }
  const protoCount = {};
  for (const f of frames) {
    const p = f.l4 ? f.l4.type : (f.l3 && f.l3.type ? f.l3.type : "other");
    protoCount[p] = (protoCount[p] || 0) + 1;
  }
  overview.push("协议分布: " + Object.entries(protoCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + "(" + v + ")").join(" / "));

  const flows = reassembleTcpFlows(frames);
  const flowList = [...flows.values()].sort((a, b) => a.firstIndex - b.firstIndex);
  overview.push("TCP 流数: " + flowList.length);

  const portSet = new Set();
  const dnsList = [], tlsList = [];
  const httpObjects = [];
  const mqttFlows = [];

  for (const flow of flowList) {
    const dirs = [...flow.dirs.values()];
    for (const dir of dirs) {
      if (dir.from.split(":").pop() === String(1883) || dir.to.split(":").pop() === String(1883) ||
        dir.from.split(":").pop() === String(8883) || dir.to.split(":").pop() === String(8883)) {
        mqttFlows.push({ flow, dir });
      }
    }
  }

  for (const f of frames) {
    if (!f.l4) continue;
    if (f.l4.type === "TCP") { portSet.add(f.l4.srcPort); portSet.add(f.l4.dstPort); }
    if (f.l4.type === "UDP") {
      portSet.add(f.l4.srcPort); portSet.add(f.l4.dstPort);
      if (f.l4.srcPort === 53 || f.l4.dstPort === 53) {
        const dns = parseDnsMessage(f.l4.payload);
        if (dns.ok) dnsList.push({ index: f.index, src: f.l3.src, dst: f.l3.dst, dns });
      }
    }
    if (f.l4.type === "TCP" && f.l4.payload && f.l4.payload.length > 5 && f.l4.payload[0] === 0x16) {
      const sni = extractTlsSni(f.l4.payload);
      if (sni) tlsList.push({ index: f.index, src: f.l3.src, dst: f.l3.dst, port: f.l4.dstPort, ...sni });
    }
  }

  // HTTP / MQTT 走 TCP 重组
  for (const flow of flowList) {
    for (const dir of flow.dirs.values()) {
      const bytes = reassembleDir(dir);
      if (bytes.length === 0) continue;
      const label = dir.from + " → " + dir.to;
      const msgs = parseHttpStream(bytes);
      if (msgs.length) { for (const m of msgs) httpObjects.push({ ...m, flowLabel: label, dir }); continue; }
      const isMqttPort = /:1883$/.test(dir.to) || /:1883$/.test(dir.from) || /:8883$/.test(dir.to) || /:8883$/.test(dir.from);
      const looksMqtt = bytes.length >= 2 && ((bytes[0] >> 4) === 1) && bytes[1] <= 0x7f;
      if (isMqttPort || looksMqtt) {
        const parsed = parseMqttStream(bytes);
        if (parsed.ok) mqttFlows.push({ flow, dir, parsed, label });
      }
    }
  }

  // ---- MQTT ----
  const mqttMessages = [];
  for (const mf of mqttFlows) if (mf.parsed) mqttMessages.push(...mf.parsed.messages);
  const uniqueMqtt = dedupeMqtt(mqttMessages);
  if (uniqueMqtt.length) {
    result.kind = "mqtt";
    const table = buildMqttTopicTable(uniqueMqtt);
    const lines = [];
    const connects = uniqueMqtt.filter((m) => m.type === 1);
    lines.push("MQTT 报文数: " + uniqueMqtt.length + "（去重后）");
    for (const c of connects) {
      lines.push("CONNECT: 协议 " + (c.protocolName || "?") + " v" + (c.protocolLevel || "?") +
        "，clientId=「" + (c.clientId || "") + "」" + (c.cleanSession ? "，CleanSession=1" : "") +
        (c.username ? "，username=「" + c.username + "」" : "") + (c.hasPassword ? "，含密码" : "") +
        "，keepAlive=" + (c.keepAlive || 0));
    }
    const subs = uniqueMqtt.filter((m) => m.type === 8);
    if (subs.length) {
      lines.push("");
      lines.push("--- SUBSCRIBE 订阅 ---");
      for (const s of subs) lines.push("  " + (s.topics || []).map((t) => t.topic + " (QoS" + t.qos + ")").join(", "));
    }
    lines.push("");
    lines.push("--- MQTT 主题表 ---");
    for (const t of table.topics) {
      lines.push("▼ 主题 " + t.topic + (t.subscribedQos !== null ? "（订阅 QoS " + t.subscribedQos + "）" : ""));
      lines.push("  PUBLISH 次数: " + t.publishes.length);
      t.publishes.forEach((p, i) => {
        const qos = p.qos !== undefined ? p.qos : "?";
        lines.push("   #" + (i + 1) + " QoS=" + qos + " retain=" + (p.retain ? 1 : 0) + " dup=" + (p.dup ? 1 : 0) + " 载荷 " + (p.payload ? p.payload.length : 0) + " 字节");
        if (p.payloadText && p.payloadText.trim()) lines.push("      文本: " + escapeText(p.payloadText.length > 200 ? p.payloadText.slice(0, 200) + "…" : p.payloadText));
        lines.push("      hex : " + (p.payloadHex || "") + (p.payload && p.payload.length > 32 ? " …" : ""));
        for (const v of payloadVariants(p.payload)) {
          const magic = detectMagic(v.bytes);
          if (v.how !== "原始载荷") lines.push("      → " + v.how + " 得 " + v.bytes.length + " 字节，头部 " + toHex(v.bytes, 0, Math.min(8, v.bytes.length)));
          const names = listArchiveNames(v.bytes);
          if (names.length) lines.push("      ↳ 内嵌文件名: " + names.join(", "));
          if (magic) {
            lines.push("      ★ 载荷识别为 " + magic.name + "（." + magic.ext + "），已作为可下载产物导出");
            result.artifacts.push({ name: "mqtt_" + sanitizeName(t.topic) + "_" + (i + 1) + "." + magic.ext, mime: "application/octet-stream", bytes: v.bytes });
          }
        }
      });
    }
    result.tables.mqttTopics = table.topics.map((t) => ({
      topic: t.topic, subscribedQos: t.subscribedQos, publishCount: t.publishes.length,
      payloads: t.publishes.map((p) => ({ qos: p.qos, retain: !!p.retain, dup: !!p.dup, size: p.payload ? p.payload.length : 0, text: p.payloadText, hex: p.payloadHex })),
    }));
    result.sections.push(section("mqtt-topics", "MQTT 主题表", "info", "hub", lines.join("\n")));

    // 汇总人话
    const topics = table.topics.map((t) => t.topic);
    const archiveHits = [];
    for (const t of table.topics) for (const p of t.publishes) {
      for (const v of payloadVariants(p.payload)) {
        const m = detectMagic(v.bytes);
        if (m) archiveHits.push(t.topic + " → " + m.name + (v.how === "原始载荷" ? "" : "（载荷为 hex 文本，已解码）"));
      }
    }
    result.summary = "MQTT 流量（" + uniqueMqtt.length + " 报文）：" + connects.length + " 次 CONNECT" +
      (connects[0] && connects[0].clientId ? "（clientId " + connects[0].clientId + "）" : "") +
      "，主题 " + topics.length + " 个 → " + topics.join(", ") +
      (archiveHits.length ? "；★ " + archiveHits.join("，") + " 经 MQTT 传输，载荷已导出" : "");
  }

  // ---- HTTP ----
  if (httpObjects.length) {
    if (!uniqueMqtt.length) result.kind = "http";
    const lines = [];
    lines.push("HTTP 消息数: " + httpObjects.length);
    lines.push("");
    httpObjects.forEach((m, i) => {
      lines.push("▼ #" + i + " [" + m.kind + "] " + m.flowLabel);
      lines.push("  " + m.startLine);
      if (m.host) lines.push("  Host: " + m.host);
      if (m.contentType) lines.push("  Content-Type: " + m.contentType);
      lines.push("  body: " + m.bodyRaw.length + " 字节" + (m.truncated ? "（截断）" : ""));
      for (const L of m.layers) {
        if (!L.text) continue;
        const t = L.text.trim();
        lines.push("  [" + L.how + "] " + L.bytes.length + " 字节 → " + escapeText(t.length > 400 ? t.slice(0, 400) + "…" : t));
        const fl = findFlags(t);
        for (const f of fl) if (!result.flags.includes(f)) result.flags.push(f);
      }
      if (!m.layers.length && m.bodyRaw.length) {
        const t = isMostlyText(m.bodyRaw, 512) ? latin1(m.bodyRaw) : null;
        if (t) lines.push("  [原文] " + escapeText(t.length > 300 ? t.slice(0, 300) + "…" : t));
      }
    });
    result.sections.push(section("http-summary", "HTTP 请求/响应摘要", "info", "language", lines.join("\n")));
    result.tables.http = httpObjects.map((m) => ({
      kind: m.kind, startLine: m.startLine, host: m.host, contentType: m.contentType,
      bodySize: m.bodyRaw.length, decoded: m.layers.filter((l) => l.text).map((l) => ({ how: l.how, text: l.text })),
    }));
    const reqCount = httpObjects.filter((m) => m.kind === "request").length;
    result.summary = (result.summary ? result.summary + " " : "") +
      "HTTP " + reqCount + " 请求 / " + (httpObjects.length - reqCount) + " 响应" +
      (result.tables.http.some((h) => h.decoded.length) ? "，响应体含可解码明文（见 HTTP 摘要）" : "");
  }

  // ---- DNS ----
  if (dnsList.length) {
    if (result.kind === "unknown") result.kind = "dns";
    const lines = [];
    lines.push("DNS 报文数: " + dnsList.length);
    lines.push("");
    for (const d of dnsList) {
      lines.push("▼ #" + d.index + " " + d.src + " → " + d.dst + "  " + (d.dns.isResponse ? "响应" : "查询") + " id=0x" + d.dns.id.toString(16));
      for (const q of d.dns.questions) lines.push("  Q: " + q.name + " " + q.qtypeName);
      for (const a of d.dns.answers) lines.push("  A: " + a.name + " " + a.rtypeName + " → " + a.rdata + " (TTL " + a.ttl + ")");
    }
    result.sections.push(section("dns-summary", "DNS 查询摘要", "info", "dns", lines.join("\n")));
    const qnames = dnsList.flatMap((d) => d.dns.questions.map((q) => q.name));
    result.tables.dns = dnsList.map((d) => ({ index: d.index, src: d.src, dst: d.dst, isResponse: d.dns.isResponse, questions: d.dns.questions, answers: d.dns.answers }));
    result.summary = (result.summary ? result.summary + " " : "") + "DNS " + dnsList.length + " 报文，查询 " + qnames.length + " 个域名（" + qnames.slice(0, 6).join(", ") + (qnames.length > 6 ? " …" : "") + "）";
  }

  // ---- TLS SNI ----
  if (tlsList.length) {
    if (result.kind === "unknown") result.kind = "tls";
    const lines = tlsList.map((t) => "#" + t.index + " " + t.src + " → " + t.dst + ":" + t.port + "  ClientHello SNI = " + (t.sni || "(未携带)") + "  recordVersion=0x" + t.recordVersion.toString(16));
    result.sections.push(section("tls-sni", "TLS ClientHello / SNI", "info", "lock", lines.join("\n")));
    result.tables.tls = tlsList;
    result.summary = (result.summary ? result.summary + " " : "") + "TLS 握手 " + tlsList.length + " 次，SNI: " + tlsList.map((t) => t.sni || "(无)").join(", ");
  }

  // ---- TCP 会话转录（兜底，覆盖 telnet / 明文 shell 等） ----
  const needTranscript = !httpObjects.length && !uniqueMqtt.length;
  if (needTranscript) {
    const lines = [];
    const transcripts = [];
    let shown = 0;
    for (const flow of flowList) {
      for (const dir of flow.dirs.values()) {
        const bytes = reassembleDir(dir);
        if (bytes.length < 4) continue;
        if (shown++ > 8) break;
        lines.push("▼ " + dir.from + " → " + dir.to + "（" + dir.segs.length + " 段，重组 " + bytes.length + " 字节）");
        const t = latin1(bytes);
        lines.push("  " + escapeText(t.length > 1200 ? t.slice(0, 1200) + "…" : t));
        lines.push("");
        transcripts.push({ from: dir.from, to: dir.to, segs: dir.segs.length, bytes: bytes.length, text: t });
        const fl = findFlags(t);
        for (const f of fl) if (!result.flags.includes(f)) result.flags.push(f);
      }
    }
    if (lines.length) {
      if (result.kind === "unknown") result.kind = "tcp-session";
      result.sections.push(section("tcp-transcript", "TCP 会话转录（明文）", result.flags.length ? "alert" : "info", "swap_horiz", lines.join("\n")));
      result.tables.tcpTranscripts = transcripts;
      result.tables.tcpFlows = flowList.map((f) => ({ a: f.a, b: f.b, dirs: [...f.dirs.values()].map((d) => ({ from: d.from, to: d.to, segs: d.segs.length, bytes: reassembleDir(d).length })) }));
      result.summary = (result.summary ? result.summary + " " : "") + "未发现 HTTP/DNS/MQTT/TLS，已按 TCP 会话转录输出明文（" + flowList.length + " 条流）";
    }
  }

  if (!result.summary) {
    result.summary = "网络流量（" + container.packets.length + " 包，" + container.linkTypeName + "）：未发现 HTTP / DNS / MQTT / TLS 特征，也无可读的 TCP 明文会话。协议分布见概览。";
  }
  if (!result.sections.some((s) => s.id === "tcp-frames")) {
    result.sections.push(section("tcp-frames", "前若干帧摘要", "info", "list",
      frames.slice(0, 30).map((f) => {
        const l3 = f.l3 && f.l3.src ? f.l3.src + " → " + f.l3.dst : (f.l3 ? f.l3.type : "?");
        const l4 = f.l4 ? (f.l4.type === "TCP" ? "TCP " + f.l4.srcPort + "→" + f.l4.dstPort + " [" + f.l4.flagStr + "]" : f.l4.type + " " + f.l4.srcPort + "→" + f.l4.dstPort) : "";
        return "[" + f.index + "] " + tsLabel(f) + " len=" + (f.raw ? f.raw.length : 0) + " " + l3 + " " + l4;
      }).join("\n")));
  }
}

function sanitizeName(s) {
  return String(s).replace(/[^\w.\-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "topic";
}
function dedupeMqtt(msgs) {
  // 同一方向重组流与逐包解析可能重复；按 (type, topic, payload hex, clientId) 去重
  const seen = new Set();
  const out = [];
  for (const m of msgs) {
    const key = [m.type, m.topic || m.clientId || (m.topics ? m.topics.map((t) => t.topic).join(",") : ""), m.payload ? toHex(m.payload) : ""].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

// ============================================================
// 12. 人话报告渲染 + fileAnalysis section 适配
// ============================================================
export function renderReadableReport(result) {
  if (!result) return "（无结果）";
  const L = [];
  L.push("=== 流量包可读结论 ===");
  L.push("");
  L.push("【结论】" + (result.summary || "—"));
  if (result.flags && result.flags.length) {
    L.push("");
    L.push("【解出 flag / 明文】");
    for (const f of result.flags) L.push("  ★ " + f);
  }
  L.push("");
  for (const s of result.sections || []) {
    L.push("--- " + s.title + " ---");
    L.push(s.body);
    L.push("");
  }
  if (result.artifacts && result.artifacts.length) {
    L.push("--- 可导出产物 ---");
    for (const a of result.artifacts) L.push("  " + a.name + "（" + (a.bytes ? a.bytes.length : 0) + " 字节）");
  }
  return L.join("\n");
}

/** 对齐 fileAnalysis 的 section 结构，供拖入文件时直接追加。 */
export function analyzeTrafficBytes(bytes, opts) {
  let result;
  try { result = analyzeTraffic(bytes, opts); }
  catch (e) { return [section("traffic-error", "流量分析异常", "warn", "warning", (e && e.message) || String(e))]; }
  const out = [];
  out.push(section("traffic-conclusion", "流量可读结论", result.flags.length ? "alert" : "info", result.flags.length ? "flag" : "travel_explore", result.summary || "—"));
  for (const s of result.sections) out.push(s);
  // 产物协议：图片/载荷作为可下载动作挂到结论卡（拖入路径与 op 路径同源，见 main.js file-section-actions）
  if (result.artifacts && result.artifacts.length) {
    out[0].actions = result.artifacts.map((a) => ({
      type: "download", label: "下载 " + a.name, filename: a.name, mime: a.mime || "application/octet-stream", bytes: a.bytes,
    }));
  }
  return out;
}

/** op run 入口：文本/rawBytes → 中文人话报告。 */
export function trafficReadableRun(text, p) {
  const opts = p || {};
  let bytes = null;
  if (opts.rawBytes && opts.rawBytes.length) bytes = opts.rawBytes instanceof Uint8Array ? opts.rawBytes : new Uint8Array(opts.rawBytes);
  else if (text && String(text).trim()) {
    const s = String(text).trim().replace(/\s+/g, "");
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
      bytes = new Uint8Array(s.length / 2);
      for (let i = 0; i < s.length; i += 2) bytes[i / 2] = parseInt(s.slice(i, i + 2), 16);
    } else {
      try { bytes = b64ToBytes(s); } catch { bytes = null; }
    }
  }
  if (!bytes || !bytes.length) return "（空输入）请拖入 pcap/pcapng 文件，或粘贴其 hex/base64。";
  const result = analyzeTraffic(bytes, opts);
  const report = renderReadableReport(result);
  // 产物协议：有产物（轨迹/节奏 PNG、MQTT 载荷）时返回 {text, files}，图片直接可下载
  if (result.artifacts && result.artifacts.length) {
    return { text: report, files: result.artifacts.map((a) => ({ name: a.name, mime: a.mime || "application/octet-stream", bytes: a.bytes })) };
  }
  return report;
}

// ============ 注册（件内自注册，只此一个 id） ============
register({
  id: "trafficReadable",
  family: "usb", familyLabel: "smartReport",
  cat: "forensic",
  name: "流量可读结论",
  desc: "把 pcap/pcapng 流量包从一屏十六进制变成人能直接读的结论：USB 键盘还原按键序列并出打字节奏图、"
      + "USB 鼠标还原轨迹并出真彩轨迹图 PNG、HTTP/DNS/TLS 协议摘要、MQTT 主题表，并自动挑出 flag 与明文线索。"
      + "定位是新手题一把梭的基础取证（容器概览 / 协议统计 / 关键字段 / 键鼠还原 / flag 扫描）；"
      + "加密流量解密、DNS/ICMP 隧道文件重建等深度分析不在范围内——TLS 只提取 ClientHello 的 SNI，不解密内容",
  params: [
    { key: "backspace", label: "退格生效（删除上一字符，关闭则保留 [BKSP]）", type: "bool", default: true },
    { key: "capsInitial", label: "初始大写锁定（部分样本全程未发 CapsLock 报告）", type: "bool", default: false },
    { key: "pngMaxSide", label: "轨迹图最长边（像素，0=自动）", type: "number", default: 0 },
  ],
  acceptsBytes: true,
  run: trafficReadableRun,
});

