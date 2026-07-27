/*
 * pcapParse.js — pcap/pcapng 流量结构解析（T298，cat:'analysis'，单向 run）。
 *
 * 用途：CTF 流量题基础设施——解析 pcap/pcapng 容器格式 + 逐层协议分帧
 * （Ethernet/LinuxSLL → IPv4/IPv6 → TCP/UDP/ICMP → HTTP/DNS），输出包摘要表
 * + 提取的 HTTP 请求/响应、DNS 查询、原始载荷。
 *
 * 纯前端零依赖零外发，全程 ArrayBuffer/DataView 内存解析。
 * USB HID 流量另见 usbHid.js，本卡不重复。
 *
 * 格式参考（照规范实现，不编造）：
 * - libpcap File Format: magic 0xa1b2c3d4(LE) / 0xd4c3b2a1(BE) / 0xa1b2cd34(nano)
 * - pcapng v1.0: 块结构 SHB(0x0A0D0D0A)/IDB(0x01)/EPB(0x06)/SPB(0x03)/NRB(0x04)
 * - RFC 894 Ethernet II, RFC 791 IPv4, RFC 8200 IPv6, RFC 793 TCP, RFC 768 UDP
 * RFC 792 ICMP, RFC 2616 HTTP, RFC 1035 DNS
 *
 * 契约：件内自注册，只 import { register } from "./registry.js"。
 * run(text, p) 单向，输入 hex/base64/auto，输出报告文本。
 * parsePcap/parsePcapng/dissectPacket 等核心函数 export 供测试。
 */
import { register } from "./registry.js";

// ---- 小端/大端整数读取（pcap magic 决定字节序，pcapng SHB 内嵌 magic 决定） ----
function u16le(b, i) { return (b[i] | (b[i + 1] << 8)) >>> 0; }
function u32le(b, i) { return ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0; }
function u16be(b, i) { return ((b[i] << 8) | b[i + 1]) >>> 0; }
function u32be(b, i) { return (((b[i] * 0x1000000) >>> 0) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0; }

// ---- hex 编码 ----
function toHex(bytes, start, end) {
  let s = "";
  const e = end || bytes.length;
  for (let i = start || 0; i < e; i++) {
    const b = bytes[i];
    s += (b < 16 ? "0" : "") + b.toString(16);
  }
  return s;
}

// ---- 输入 → 字节（hex / base64 / auto，照 john_zip.js 范式） ----
const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function isHex(s) { return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2; }
function isB64(s) {
  if (!s || s.length % 4 !== 0) return false;
  for (const c of s) if (!B64_CHARS.includes(c)) return false;
  return true;
}
function hexToBytes(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
  return out;
}
function b64ToBytes(s) {
  let str = s.replace(/\s/g, "");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function inputToBytes(text, enc) {
  const raw = String(text);
  const s = raw.trim().replace(/\s+/g, "");
  if (enc === "hex") { if (!isHex(s)) throw new Error("输入不是合法 hex"); return hexToBytes(s); }
  if (enc === "base64") { try { return b64ToBytes(s); } catch { throw new Error("输入不是合法 base64"); } }
 // auto
  if (isHex(s)) return hexToBytes(s);
  if (isB64(s)) { try { return b64ToBytes(s); } catch { /* fall */ } }
  let latin1 = true;
  for (let i = 0; i < raw.length; i++) if (raw.charCodeAt(i) > 0xFF) { latin1 = false; break; }
  if (latin1) {
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(raw);
}

// ============================================================
// pcap 链路层类型（LINKTYPE_*，常见值，照 IANA/tcpdump 注册表）
// ============================================================
const LINKTYPES = {
  0: "NULL/Loopback",
  1: "Ethernet",
  6: "Token Ring",
  9: "PPP",
  12: "Raw IP",
  101: "Raw IP (101)",
  105: "IEEE 802.11",
  113: "Linux SLL",
  127: "IEEE 802.11 + radiotap",
  228: "Raw IPv4",
  229: "Raw IPv6",
  276: "Linux SLL2",
};

// ============================================================
// Ethernet ethertype（RFC 894 / RFC 7042）
// ============================================================
const ETHERTYPES = {
  0x0800: "IPv4",
  0x0806: "ARP",
  0x8035: "RARP",
  0x86DD: "IPv6",
  0x8100: "802.1Q VLAN",
  0x8847: "MPLS unicast",
  0x8848: "MPLS multicast",
  0x8863: "PPPoE Discovery",
  0x8864: "PPPoE Session",
};

// ============================================================
// IP 协议号（RFC 790 / IANA）
// ============================================================
const IP_PROTOCOLS = {
  0: "HOPOPT", 1: "ICMP", 2: "IGMP", 4: "IP-in-IP", 6: "TCP",
  8: "EGP", 9: "IGP", 17: "UDP", 41: "IPv6", 43: "IPv6 Route",
  44: "IPv6 Frag", 47: "GRE", 50: "ESP", 51: "AH", 58: "ICMPv6",
  59: "IPv6 NoNxt", 89: "OSPF", 103: "PIM", 132: "SCTP",
};

// ============================================================
// ICMP type（RFC 792）
// ============================================================
const ICMP_TYPES = {
  0: "Echo Reply", 3: "Dest Unreachable", 4: "Source Quench",
  5: "Redirect", 8: "Echo Request", 11: "Time Exceeded",
  12: "Param Problem", 13: "Timestamp", 14: "Timestamp Reply",
};

// ============================================================
// DNS 记录类型（RFC 1035）
// ============================================================
const DNS_TYPES = {
  1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX",
  16: "TXT", 28: "AAAA", 33: "SRV", 35: "NAPTR", 43: "DS",
  46: "RRSIG", 47: "NSEC", 48: "DNSKEY", 65: "HTTPS", 255: "ANY",
};

// ---- MAC 地址格式化 ----
function fmtMac(b, off) {
  return [0,1,2,3,4,5].map(i => b[off+i].toString(16).padStart(2, "0")).join(":");
}
// ---- IPv4 格式化 ----
function fmtIPv4(b, off) {
  return `${b[off]}.${b[off+1]}.${b[off+2]}.${b[off+3]}`;
}
// ---- IPv6 格式化 ----
function fmtIPv6(b, off) {
  const parts = [];
  for (let i = 0; i < 8; i++) parts.push(u16be(b, off + i * 2).toString(16));
  return parts.join(":");
}

// ============================================================
// pcap 容器解析（libpcap 格式）
// ============================================================
// 全局头 24 字节:
// magic(4) + major(2) + minor(2) + gmtOffset(4) + accuracy(4) + snapLen(4) + linkType(4)
// 包记录头 16 字节:
// ts_sec(4) + ts_usec(4) + incl_len(4) + orig_len(4)
const PCAP_MAGIC_LE  = 0xa1b2c3d4;
const PCAP_MAGIC_BE  = 0xd4c3b2a1;
const PCAP_MAGIC_NANO_LE = 0xa1b2cd34;
const PCAP_MAGIC_NANO_BE = 0x34cdb2a1;

export function parsePcapContainer(bytes) {
  if (bytes.length < 24) throw new Error("pcap 文件过短（不足全局头 24 字节）");

  const magic = u32le(bytes, 0);
  let le;
  let nano = false;
  if (magic === PCAP_MAGIC_LE) le = true;
  else if (magic === PCAP_MAGIC_BE) le = false;
  else if (magic === PCAP_MAGIC_NANO_LE) { le = true; nano = true; }
  else if (magic === PCAP_MAGIC_NANO_BE) { le = false; nano = true; }
  else throw new Error(`非 pcap magic: 0x${magic.toString(16)}`);

  const rd16 = (i) => le ? u16le(bytes, i) : u16be(bytes, i);
  const rd32 = (i) => le ? u32le(bytes, i) : u32be(bytes, i);

  const major = rd16(4);
  const minor = rd16(6);
  const gmtOffset = rd32(8);
  const accuracy = rd32(12);
  const snapLen = rd32(16);
  const linkType = rd32(20);

  const packets = [];
  let pos = 24;
  while (pos + 16 <= bytes.length) {
    const ts_sec = rd32(pos);
    const ts_usec = rd32(pos + 4);
    const incl_len = rd32(pos + 8);
    const orig_len = rd32(pos + 12);
    pos += 16;
    if (incl_len > bytes.length - pos) break; // 截断/损坏
    const raw = bytes.subarray(pos, pos + incl_len);
    packets.push({
      index: packets.length,
      ts_sec,
      ts_usec,
      incl_len,
      orig_len,
      raw,
    });
    pos += incl_len;
  }

  return {
    format: "pcap",
    endian: le ? "little" : "big",
    nano,
    major,
    minor,
    gmtOffset,
    accuracy,
    snapLen,
    linkType,
    linkTypeName: LINKTYPES[linkType] || `未知(${linkType})`,
    packets,
  };
}

// ============================================================
// pcapng 容器解析（块结构）
// ============================================================
// 块头: block_type(4) + total_length(4)，末尾 4 字节重复 total_length
// SHB(0x0A0D0D0A): byte_order_magic(4=0x1A2B3C4D) + major(2) + minor(2) + section_length(8) + options
// IDB(0x01): link_type(2) + reserved(2) + snap_len(4) + options
// EPB(0x06): interface_id(4) + ts_high(4) + ts_low(4) + incl_len(4) + orig_len(4) + data(incl_len) + options
// SPB(0x03): packet_data(变长)
const PCAPNG_SHB = 0x0A0D0D0A;
const PCAPNG_IDB = 0x00000001;
const PCAPNG_EPB = 0x00000006;
const PCAPNG_SPB = 0x00000003;
const PCAPNG_NRB = 0x00000004;
const PCAPNG_BOM_LE = 0x1A2B3C4D;
const PCAPNG_BOM_BE = 0x4D3C2B1A;

export function parsePcapngContainer(bytes) {
  if (bytes.length < 12) throw new Error("pcapng 文件过短");
 // 第一块必须是 SHB
  const blockType = u32le(bytes, 0);
  if (blockType !== PCAPNG_SHB) throw new Error(`非 pcapng（首块 type=0x${blockType.toString(16)}，期望 SHB 0x0a0d0d0a）`);

 // SHB 决定字节序
  const bom = u32le(bytes, 8);
  let le;
  if (bom === PCAPNG_BOM_LE) le = true;
  else if (bom === PCAPNG_BOM_BE) le = false;
  else throw new Error(`pcapng SHB byte order magic 异常: 0x${bom.toString(16)}`);

  const rd32 = (i) => le ? u32le(bytes, i) : u32be(bytes, i);
  const rd16 = (i) => le ? u16le(bytes, i) : u16be(bytes, i);

  const interfaces = []; // [{linkType, snapLen}]
  const packets = [];
  let pos = 0;

  while (pos + 12 <= bytes.length) {
    const bt = rd32(pos);
    const totalLen = rd32(pos + 4);
    if (totalLen < 12 || pos + totalLen > bytes.length) break;

    if (bt === PCAPNG_SHB) {
 // Section Header: 跳过（已在前面读了 BOM），继续
    } else if (bt === PCAPNG_IDB) {
 // Interface Description Block
      const linkType = rd16(pos + 8);
      const snapLen = rd32(pos + 12);
      interfaces.push({ linkType, snapLen });
    } else if (bt === PCAPNG_EPB) {
 // Enhanced Packet Block
      const ifaceId = rd32(pos + 8);
      const tsHigh = rd32(pos + 12);
      const tsLow = rd32(pos + 16);
      const inclLen = rd32(pos + 20);
      const origLen = rd32(pos + 24);
      const dataStart = pos + 28;
      if (dataStart + inclLen <= pos + totalLen) {
        const iface = interfaces[ifaceId];
        packets.push({
          index: packets.length,
          ts_sec: (tsHigh * 0x100000000 + tsLow) / 1000000, // pcapng 默认微秒
          ts_usec: ((tsHigh * 0x100000000 + tsLow) % 1000000) | 0,
          incl_len: inclLen,
          orig_len: origLen,
          raw: bytes.subarray(dataStart, dataStart + inclLen),
          linkType: iface ? iface.linkType : 1,
        });
      }
    } else if (bt === PCAPNG_SPB) {
 // Simple Packet Block：block_type(4) + block_total_length(4) + OrigPktLen(4) + data + block_total_length(4)。
 // 数据从 +12 起（跳过前 12 字节头），可用长度 = totalLen - 16（首尾两个 4 字节长度字段 + OrigPktLen）。
      const dataStart = pos + 12;
      const dataLen = Math.max(0, totalLen - 16);
      const iface = interfaces[0];
      packets.push({
        index: packets.length,
        ts_sec: 0,
        ts_usec: 0,
        incl_len: dataLen,
        orig_len: dataLen,
        raw: bytes.subarray(dataStart, dataStart + dataLen),
        linkType: iface ? iface.linkType : 1,
      });
    }
 // NRB 及其他块跳过

    pos += totalLen;
  }

  const primaryLink = interfaces.length > 0 ? interfaces[0].linkType : 1;
  return {
    format: "pcapng",
    endian: le ? "little" : "big",
    interfaces,
    linkType: primaryLink,
    linkTypeName: LINKTYPES[primaryLink] || `未知(${primaryLink})`,
    packets,
  };
}

// ============================================================
// 容器检测 + 统一入口
// ============================================================
export function detectFormat(bytes) {
  if (bytes.length < 4) return "unknown";
  const m = u32le(bytes, 0);
  if (m === PCAP_MAGIC_LE || m === PCAP_MAGIC_BE || m === PCAP_MAGIC_NANO_LE || m === PCAP_MAGIC_NANO_BE) return "pcap";
  if (m === PCAPNG_SHB) return "pcapng";
  return "unknown";
}

export function parseContainer(bytes) {
  const fmt = detectFormat(bytes);
  if (fmt === "pcap") return parsePcapContainer(bytes);
  if (fmt === "pcapng") return parsePcapngContainer(bytes);
  throw new Error(`无法识别的文件格式（magic=0x${u32le(bytes, 0).toString(16)}，期望 pcap 0xa1b2c3d4 或 pcapng 0x0a0d0d0a）`);
}

// ============================================================
// 链路层分帧
// ============================================================
// 注意：网络协议头（Ethernet/IP/TCP/UDP 等）始终用网络字节序（大端）
// 不受 pcap 文件字节序影响。pcap 的 LE/BE 只影响容器头（全局头+包记录头）。
// Ethernet II: dst MAC(6) + src MAC(6) + ethertype(2) + payload
// 802.1Q VLAN: ethertype=0x8100 后跟 2B tag + 真实 ethertype
function dissectEthernet(frame) {
  if (frame.length < 14) return { ok: false, error: "Ethernet 帧不足 14 字节" };
  let ethertype = u16be(frame, 12);
  let payloadOff = 14;
  let vlan = null;
  if (ethertype === 0x8100 && frame.length >= 18) {
 // 802.1Q VLAN tag: 2 bytes (TPID already read as ethertype, TCI 2 bytes)
    vlan = u16be(frame, 14);
    ethertype = u16be(frame, 16);
    payloadOff = 18;
  }
  return {
    ok: true,
    type: "Ethernet",
    dstMac: fmtMac(frame, 0),
    srcMac: fmtMac(frame, 6),
    ethertype,
    ethertypeName: ETHERTYPES[ethertype] || `0x${ethertype.toString(16)}`,
    vlan,
    payload: frame.subarray(payloadOff),
  };
}

// Linux SLL (cooked capture, linkType=113):
// packet_type(2) + arphrd_type(2) + addr_len(2) + address(8) + protocol(2) + payload
// 注意：SLL 头字段用主机字节序（通常 LE），protocol 字段为 ethertype（网络序）
function dissectLinuxSll(frame) {
  if (frame.length < 16) return { ok: false, error: "Linux SLL 帧不足 16 字节" };
  const pktType = u16le(frame, 0);
  const arphrd = u16le(frame, 2);
  const addrLen = u16le(frame, 4);
  const protocol = u16be(frame, 14); // ethertype 始终网络序
  return {
    ok: true,
    type: "Linux SLL",
    pktType,
    arphrd,
    addrLen,
    address: fmtMac(frame, 6),
    ethertype: protocol,
    ethertypeName: ETHERTYPES[protocol] || `0x${protocol.toString(16)}`,
    payload: frame.subarray(16),
  };
}

// Loopback (linkType=0): family(4) + IP packet
// BSD loopback family 用主机字节序（通常 LE）
function dissectLoopback(frame) {
  if (frame.length < 4) return { ok: false, error: "Loopback 帧不足 4 字节" };
  const family = u32le(frame, 0);
  return {
    ok: true,
    type: "Loopback",
    family,
    ethertype: family === 2 ? 0x0800 : (family === 28 || family === 30 ? 0x86DD : 0),
    ethertypeName: family === 2 ? "IPv4" : (family === 28 || family === 30 ? "IPv6" : `family=${family}`),
    payload: frame.subarray(4),
  };
}

// ============================================================
// IPv4 分帧（RFC 791）
// ============================================================
export function dissectIPv4(payload) {
  if (payload.length < 20) return { ok: false, error: "IPv4 头不足 20 字节" };
  const ihl = (payload[0] & 0x0F) * 4;
  if (ihl < 20 || ihl > payload.length) return { ok: false, error: `IPv4 IHL 非法: ${ihl}` };
  const totalLen = u16be(payload, 2);
  const protocol = payload[9];
  const src = fmtIPv4(payload, 12);
  const dst = fmtIPv4(payload, 16);
  const ttl = payload[8];
  const id = u16be(payload, 4);
  const flagsFrag = u16be(payload, 6);
  const flags = (flagsFrag >>> 13) & 0x07;
  const fragOff = flagsFrag & 0x1FFF;

  const l4Start = ihl;
  const l4End = totalLen > payload.length ? payload.length : totalLen;
  const l4Data = payload.subarray(l4Start, l4End);

  return {
    ok: true,
    type: "IPv4",
    version: 4,
    ihl,
    totalLen,
    id,
    flags,
    fragOff,
    ttl,
    protocol,
    protocolName: IP_PROTOCOLS[protocol] || `proto(${protocol})`,
    src,
    dst,
    payload: l4Data,
  };
}

// ============================================================
// IPv6 分帧（RFC 8200）
// ============================================================
export function dissectIPv6(payload) {
  if (payload.length < 40) return { ok: false, error: "IPv6 头不足 40 字节" };
  const payloadLen = u16be(payload, 4);
  const nextHeader = payload[6];
  const hopLimit = payload[7];
  const src = fmtIPv6(payload, 8);
  const dst = fmtIPv6(payload, 24);

  let pos = 40;
  let proto = nextHeader;
 // 扩展头链：逐个跳过 Hop-by-Hop(0)/Routing(43)/Fragment(44)/DestOpt(60)
  while ([0, 43, 60].includes(proto) && pos + 2 <= payload.length) {
    const nextH = payload[pos];
    const hdrLen = (payload[pos + 1] + 1) * 8;
    pos += hdrLen;
    proto = nextH;
  }
  if (proto === 44 && pos + 8 <= payload.length) {
 // Fragment header: next(1) + reserved(1) + frag_off(2) + id(4)
    proto = payload[pos];
    pos += 8;
  }

  const dataEnd = payloadLen + 40 <= payload.length ? payloadLen + 40 : payload.length;

  return {
    ok: true,
    type: "IPv6",
    version: 6,
    payloadLen,
    nextHeader,
    hopLimit,
    src,
    dst,
    protocol: proto,
    protocolName: IP_PROTOCOLS[proto] || `proto(${proto})`,
    payload: payload.subarray(pos, dataEnd),
  };
}

// ============================================================
// TCP 分帧（RFC 793）
// ============================================================
export function dissectTCP(payload) {
  if (payload.length < 20) return { ok: false, error: "TCP 头不足 20 字节" };
  const srcPort = u16be(payload, 0);
  const dstPort = u16be(payload, 2);
  const seq = u32be(payload, 4);
  const ack = u32be(payload, 8);
  const dataOffset = ((payload[12] >> 4) & 0x0F) * 4;
  const flags = payload[13];
  const window = u16be(payload, 14);
  const FIN = (flags & 0x01) !== 0;
  const SYN = (flags & 0x02) !== 0;
  const RST = (flags & 0x04) !== 0;
  const PSH = (flags & 0x08) !== 0;
  const ACK2 = (flags & 0x10) !== 0;
  const URG = (flags & 0x20) !== 0;
  if (dataOffset < 20 || dataOffset > payload.length) return { ok: false, error: `TCP dataOffset 非法: ${dataOffset}` };
  const appData = payload.subarray(dataOffset);
  return {
    ok: true,
    type: "TCP",
    srcPort,
    dstPort,
    seq,
    ack,
    dataOffset,
    flags: { FIN, SYN, RST, PSH, ACK: ACK2, URG },
    flagStr: ["FIN","SYN","RST","PSH","ACK","URG"].filter((f,i) => [FIN,SYN,RST,PSH,ACK2,URG][i]).join(",") || "none",
    window,
    payload: appData,
  };
}

// ============================================================
// UDP 分帧（RFC 768）
// ============================================================
export function dissectUDP(payload) {
  if (payload.length < 8) return { ok: false, error: "UDP 头不足 8 字节" };
  const srcPort = u16be(payload, 0);
  const dstPort = u16be(payload, 2);
  const length = u16be(payload, 4);
  const appData = payload.subarray(8, length > payload.length ? payload.length : length);
  return {
    ok: true,
    type: "UDP",
    srcPort,
    dstPort,
    length,
    payload: appData,
  };
}

// ============================================================
// ICMP 分帧（RFC 792）
// ============================================================
export function dissectICMP(payload) {
  if (payload.length < 4) return { ok: false, error: "ICMP 头不足 4 字节" };
  const type = payload[0];
  const code = payload[1];
  const typeName = ICMP_TYPES[type] || `type(${type})`;
  const data = payload.subarray(8); // 8 字节头后是 payload
  return {
    ok: true,
    type: "ICMP",
    icmpType: type,
    code,
    typeName,
    payload: data,
  };
}

// ============================================================
// DNS 分帧（RFC 1035）
// ============================================================
function parseDnsName(bytes, start) {
  let pos = start;
  let labels = [];
  let jumped = false;
  let endPos = -1;
  let jumps = 0;
  while (pos < bytes.length && jumps < 20) {
    const len = bytes[pos];
    if (len === 0) {
      pos++;
      if (!jumped) endPos = pos;
      break;
    }
    if ((len & 0xC0) === 0xC0) {
 // 压缩指针
      if (pos + 2 > bytes.length) break;
      const ptr = ((len & 0x3F) << 8) | bytes[pos + 1];
      if (!jumped) endPos = pos + 2;
      pos = ptr;
      jumped = true;
      jumps++;
      continue;
    }
    if (pos + 1 + len > bytes.length) break;
    let label = "";
    for (let i = 0; i < len; i++) label += String.fromCharCode(bytes[pos + 1 + i]);
    labels.push(label);
    pos += 1 + len;
  }
  if (endPos === -1) endPos = pos;
  return { name: labels.length > 0 ? labels.join(".") : ".", endPos };
}

export function dissectDNS(payload) {
  if (payload.length < 12) return { ok: false, error: "DNS 头不足 12 字节" };
  const id = u16be(payload, 0);
  const flags = u16be(payload, 2);
  const qr = (flags >>> 15) & 1;
  const opcode = (flags >>> 11) & 0x0F;
  const qdcount = u16be(payload, 4);
  const ancount = u16be(payload, 6);
  const nscount = u16be(payload, 8);
  const arcount = u16be(payload, 10);

  let pos = 12;
  const questions = [];
  for (let i = 0; i < qdcount && pos < payload.length; i++) {
    const { name, endPos } = parseDnsName(payload, pos);
    pos = endPos;
    if (pos + 4 > payload.length) break;
    const qtype = u16be(payload, pos);
    const qclass = u16be(payload, pos + 2);
    pos += 4;
    questions.push({ name, qtype, qtypeName: DNS_TYPES[qtype] || `type(${qtype})`, qclass });
  }

  const answers = [];
  for (let i = 0; i < ancount && pos < payload.length; i++) {
    const { name, endPos } = parseDnsName(payload, pos);
    pos = endPos;
    if (pos + 10 > payload.length) break;
    const rtype = u16be(payload, pos);
    const rclass = u16be(payload, pos + 2);
    const ttl = u32be(payload, pos + 4);
    const rdlength = u16be(payload, pos + 8);
    pos += 10;
    if (pos + rdlength > payload.length) break;
    const rdata = payload.subarray(pos, pos + rdlength);
    let rdataStr = toHex(rdata, 0);
    if (rtype === 1 && rdlength === 4) rdataStr = fmtIPv4(rdata, 0); // A
    else if (rtype === 28 && rdlength === 16) rdataStr = fmtIPv6(rdata, 0); // AAAA
    else if (rtype === 5 || rtype === 2 || rtype === 12) { // CNAME/NS/PTR
      const parsed = parseDnsName(payload, pos);
      rdataStr = parsed.name;
    } else if (rtype === 16) { // TXT
      const txtLen = rdata[0];
      rdataStr = "";
      for (let k = 0; k < txtLen && k + 1 < rdata.length; k++) rdataStr += String.fromCharCode(rdata[1 + k]);
    } else if (rtype === 15) { // MX
      const pref = u16be(rdata, 0);
      const exch = parseDnsName(payload, pos + 2);
      rdataStr = `pref=${pref} ${exch.name}`;
    }
    pos += rdlength;
    answers.push({ name, rtype, rtypeName: DNS_TYPES[rtype] || `type(${rtype})`, rclass, ttl, rdata: rdataStr });
  }

  return {
    ok: true,
    type: "DNS",
    id,
    isResponse: qr === 1,
    opcode,
    qdcount,
    ancount,
    nscount,
    arcount,
    questions,
    answers,
  };
}

// ============================================================
// HTTP 检测（RFC 2616，文本协议）
// ============================================================
const HTTP_METHODS = ["GET ", "POST ", "PUT ", "DELETE ", "HEAD ", "OPTIONS ", "PATCH ", "TRACE ", "CONNECT "];

function tryHTTP(payload) {
  if (payload.length < 4) return null;
 // 尝试以 ASCII 解码前 512 字节判断
  const peek = payload.subarray(0, Math.min(payload.length, 512));
  let text = "";
  for (let i = 0; i < peek.length; i++) {
    const b = peek[i];
    if (b === 0x0D || b === 0x0A || (b >= 0x20 && b <= 0x7E) || b === 0x09) {
      text += String.fromCharCode(b);
    } else {
 // 出现非 ASCII/非 HTTP 可见字符 → 不是 HTTP
      return null;
    }
  }

 // 请求：METHOD SP URL SP HTTP/x.y
  for (const m of HTTP_METHODS) {
    if (text.startsWith(m)) {
      const firstLine = text.split("\r\n")[0];
      const parts = firstLine.split(" ");
      if (parts.length >= 3 && parts[parts.length - 1].startsWith("HTTP/")) {
 // 提取 headers
        const headers = {};
        const lines = text.split("\r\n");
        for (let i = 1; i < lines.length; i++) {
          const idx = lines[i].indexOf(":");
          if (idx > 0) {
            headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
          }
        }
        return {
          ok: true,
          type: "HTTP-Request",
          method: parts[0],
          url: parts.slice(1, -1).join(" "),
          version: parts[parts.length - 1],
          headers,
          raw: text,
        };
      }
    }
  }

 // 响应：HTTP/x.y SP status SP reason
  if (text.startsWith("HTTP/")) {
    const firstLine = text.split("\r\n")[0];
    const parts = firstLine.split(" ");
    if (parts.length >= 2) {
      const headers = {};
      const lines = text.split("\r\n");
      for (let i = 1; i < lines.length; i++) {
        const idx = lines[i].indexOf(":");
        if (idx > 0) {
          headers[lines[i].slice(0, idx).trim().toLowerCase()] = lines[i].slice(idx + 1).trim();
        }
      }
      return {
        ok: true,
        type: "HTTP-Response",
        version: parts[0],
        status: parseInt(parts[1], 10),
        reason: parts.slice(2).join(" "),
        headers,
        raw: text,
      };
    }
  }

  return null;
}

// ============================================================
// 单包完整分帧
// ============================================================
export function dissectPacket(pkt, linkType) {
  const result = {
    index: pkt.index,
    ts: `${pkt.ts_sec}.${String(pkt.ts_usec).padStart(6, "0")}`,
    length: pkt.incl_len,
    origLength: pkt.orig_len,
    layers: {},
    payload: null,
    summary: "",
  };

  const frame = pkt.raw;

 // ---- L2: 链路层 ----
  let l2;
  if (linkType === 1) {
    l2 = dissectEthernet(frame);
  } else if (linkType === 113) {
    l2 = dissectLinuxSll(frame);
  } else if (linkType === 0) {
    l2 = dissectLoopback(frame);
  } else if (linkType === 12 || linkType === 101 || linkType === 228) {
 // Raw IPv4
    l2 = { ok: true, type: "Raw", ethertype: 0x0800, ethertypeName: "IPv4", payload: frame };
  } else if (linkType === 229) {
 // Raw IPv6
    l2 = { ok: true, type: "Raw", ethertype: 0x86DD, ethertypeName: "IPv6", payload: frame };
  } else {
    l2 = { ok: true, type: `LinkType(${linkType})`, payload: frame };
    result.summary = `[${result.index}] ${result.ts} len=${result.length} linkType=${linkType}`;
    result.payload = frame;
    return result;
  }

  if (!l2.ok) {
    result.summary = `[${result.index}] ${result.ts} len=${result.length} L2错误: ${l2.error}`;
    return result;
  }
  result.layers.l2 = l2;

 // ---- L3: IP 层 ----
  let l3 = null;
  const ipPayload = l2.payload;
  if (l2.ethertype === 0x0800) {
    l3 = dissectIPv4(ipPayload);
  } else if (l2.ethertype === 0x86DD) {
    l3 = dissectIPv6(ipPayload);
  } else if (l2.ethertype === 0x0806) {
 // ARP
    l3 = { ok: true, type: "ARP", payload: ipPayload };
  }

  if (!l3 || !l3.ok) {
    const err = l3 ? l3.error : `ethertype=0x${l2.ethertype.toString(16)}`;
    result.summary = `[${result.index}] ${result.ts} len=${result.length} ${l2.type} ${l2.ethertypeName} ${err}`;
    result.payload = ipPayload;
    return result;
  }
  result.layers.l3 = l3;

 // ---- L4: 传输层 ----
  let l4 = null;
  if (l3.protocol === 6) {
    l4 = dissectTCP(l3.payload);
  } else if (l3.protocol === 17) {
    l4 = dissectUDP(l3.payload);
  } else if (l3.protocol === 1 || l3.protocol === 58) {
    l4 = dissectICMP(l3.payload);
  }

  if (!l4 || !l4.ok) {
    const protoName = l3.protocolName;
    let s = `[${result.index}] ${result.ts} len=${result.length} ${l3.src} → ${l3.dst} ${protoName}`;
    if (l4 && l4.error) s += ` (${l4.error})`;
    result.summary = s;
    result.payload = l3.payload;
    return result;
  }
  result.layers.l4 = l4;

 // ---- L7: 应用层 ----
  let l7 = null;
  if (l4.type === "TCP" || l4.type === "UDP") {
    const appData = l4.payload;
 // DNS: UDP port 53
    if (l4.type === "UDP" && (l4.srcPort === 53 || l4.dstPort === 53)) {
      const dns = dissectDNS(appData);
      if (dns.ok) l7 = { ...dns, proto: "DNS" };
    }
 // HTTP: port 80/8080 或文本特征
    if (!l7 && (l4.srcPort === 80 || l4.dstPort === 80 || l4.srcPort === 8080 || l4.dstPort === 8080)) {
      const http = tryHTTP(appData);
      if (http && http.ok) l7 = { ...http, proto: "HTTP" };
    }
 // 即使端口不匹配，也尝试 HTTP 特征匹配（CTF 中可能用非标准端口）
    if (!l7) {
      const http = tryHTTP(appData);
      if (http && http.ok) l7 = { ...http, proto: "HTTP" };
    }
  }

  if (l7) result.layers.l7 = l7;

 // ---- 摘要 ----
  let s = `[${result.index}] ${result.ts} len=${result.length}`;
  if (l3.type === "IPv4" || l3.type === "IPv6") {
    s += ` ${l3.src} → ${l3.dst}`;
  } else {
    s += ` ${l3.type}`;
  }
  if (l4.type === "TCP") {
    s += ` TCP ${l4.srcPort}→${l4.dstPort} [${l4.flagStr}]`;
  } else if (l4.type === "UDP") {
    s += ` UDP ${l4.srcPort}→${l4.dstPort}`;
  } else if (l4.type === "ICMP") {
    s += ` ICMP ${l4.typeName}`;
  }
  if (l7) {
    if (l7.proto === "DNS") {
      s += ` DNS ${l7.isResponse ? "Response" : "Query"}`;
      if (l7.questions.length > 0) s += ` ${l7.questions[0].name}`;
    } else if (l7.proto === "HTTP") {
      if (l7.type === "HTTP-Request") s += ` HTTP ${l7.method} ${l7.url}`;
      else s += ` HTTP ${l7.status} ${l7.reason}`;
    }
  }
  result.summary = s;

 // 提取应用层载荷
  if (l7) {
    result.payload = l4.payload;
  } else if (l4.type === "TCP" || l4.type === "UDP") {
    result.payload = l4.payload;
  } else {
    result.payload = l3.payload;
  }

  return result;
}

// ============================================================
// 报告格式化
// ============================================================
function formatTime(tsSec, tsUsec) {
  if (tsSec === 0) return "0.000000";
 // 不做时区转换，直接用 epoch 秒
  return `${tsSec}.${String(tsUsec).padStart(6, "0")}`;
}

function formatReport(container, dissected, opts) {
  const lines = [];
  const maxPackets = opts.maxPackets || 50;
  const detail = opts.detail !== "summary";

  lines.push("=== pcap/pcapng 结构解析 ===");
  lines.push(`格式: ${container.format} (${container.endian} endian${container.nano ? ", nanosecond" : ""})`);
  lines.push(`链路类型: ${container.linkTypeName} (linkType=${container.linkType})`);
  if (container.format === "pcap") {
    lines.push(`版本: ${container.major}.${container.minor}  snapLen: ${container.snapLen}`);
  } else if (container.format === "pcapng") {
    lines.push(`接口数: ${container.interfaces.length}`);
    container.interfaces.forEach((iface, i) => {
      lines.push(`  接口[${i}]: ${LINKTYPES[iface.linkType] || iface.linkType}, snapLen=${iface.snapLen}`);
    });
  }
  lines.push(`包总数: ${container.packets.length}`);
  if (container.packets.length > maxPackets) {
    lines.push(`（显示前 ${maxPackets} 个，省略 ${container.packets.length - maxPackets} 个。调大 maxPackets 可看更多）`);
  }
  lines.push("");

 // 包摘要表
  lines.push("--- 包摘要 ---");
  const showCount = Math.min(dissected.length, maxPackets);
  for (let i = 0; i < showCount; i++) {
    lines.push(dissected[i].summary);
  }
  lines.push("");

 // 详细分帧
  if (detail) {
    lines.push("--- 协议详情 ---");
    for (let i = 0; i < showCount; i++) {
      const d = dissected[i];
      lines.push(`▼ [${d.index}] ${d.ts} len=${d.length} (orig=${d.origLength})`);
      const l2 = d.layers.l2;
      if (l2) {
        if (l2.type === "Ethernet") {
          lines.push(`  Ethernet: ${l2.srcMac} → ${l2.dstMac} type=${l2.ethertypeName}${l2.vlan !== null ? ` VLAN=0x${l2.vlan.toString(16)}` : ""}`);
        } else if (l2.type === "Linux SLL") {
          lines.push(`  Linux SLL: addr=${l2.address} proto=${l2.ethertypeName}`);
        }
      }
      const l3 = d.layers.l3;
      if (l3) {
        if (l3.type === "IPv4") {
          lines.push(`  IPv4: ${l3.src} → ${l3.dst} proto=${l3.protocolName} ttl=${l3.ttl} id=0x${l3.id.toString(16)} totalLen=${l3.totalLen}`);
        } else if (l3.type === "IPv6") {
          lines.push(`  IPv6: ${l3.src} → ${l3.dst} proto=${l3.protocolName} hopLimit=${l3.hopLimit} payloadLen=${l3.payloadLen}`);
        }
      }
      const l4 = d.layers.l4;
      if (l4) {
        if (l4.type === "TCP") {
          lines.push(`  TCP: ${l4.srcPort}→${l4.dstPort} [${l4.flagStr}] seq=${l4.seq} ack=${l4.ack} win=${l4.window}`);
        } else if (l4.type === "UDP") {
          lines.push(`  UDP: ${l4.srcPort}→${l4.dstPort} len=${l4.length}`);
        } else if (l4.type === "ICMP") {
          lines.push(`  ICMP: ${l4.typeName} code=${l4.code}`);
        }
      }
      const l7 = d.layers.l7;
      if (l7) {
        if (l7.proto === "DNS") {
          lines.push(`  DNS: id=0x${l7.id.toString(16)} ${l7.isResponse ? "Response" : "Query"}`);
          l7.questions.forEach((q) => {
            lines.push(`    Q: ${q.name} ${q.qtypeName}`);
          });
          l7.answers.forEach((a) => {
            lines.push(`    A: ${a.name} ${a.rtypeName} ${a.rdata}`);
          });
        } else if (l7.proto === "HTTP") {
          if (l7.type === "HTTP-Request") {
            lines.push(`  HTTP Request: ${l7.method} ${l7.url} ${l7.version}`);
          } else {
            lines.push(`  HTTP Response: ${l7.version} ${l7.status} ${l7.reason}`);
          }
          for (const [k, v] of Object.entries(l7.headers)) {
            lines.push(`    ${k}: ${v}`);
          }
        }
      }
 // 原始载荷 hex 预览（前 64 字节）
      if (d.payload && d.payload.length > 0 && (l4 || l7)) {
        const previewLen = Math.min(d.payload.length, 64);
        const hex = toHex(d.payload, 0, previewLen);
        const ascii = Array.from(d.payload.subarray(0, previewLen)).map(b => (b >= 0x20 && b <= 0x7E) ? String.fromCharCode(b) : ".").join("");
        lines.push(`  载荷 (${d.payload.length} 字节${d.payload.length > previewLen ? `, 前 ${previewLen}` : ""}): ${hex}`);
        lines.push(`  ASCII: ${ascii}`);
      }
    }
    lines.push("");
  }

 // HTTP/DNS 汇总
  const httpPkts = dissected.filter(d => d.layers.l7 && d.layers.l7.proto === "HTTP");
  const dnsPkts = dissected.filter(d => d.layers.l7 && d.layers.l7.proto === "DNS");
  if (httpPkts.length > 0) {
    lines.push("--- HTTP 汇总 ---");
    for (const d of httpPkts) {
      const h = d.layers.l7;
      if (h.type === "HTTP-Request") {
        lines.push(`[#${d.index}] ${h.method} ${h.url}`);
      } else {
        lines.push(`[#${d.index}] ${h.status} ${h.reason}`);
      }
    }
    lines.push("");
  }
  if (dnsPkts.length > 0) {
    lines.push("--- DNS 汇总 ---");
    for (const d of dnsPkts) {
      const dns = d.layers.l7;
      lines.push(`[#${d.index}] ${dns.isResponse ? "Response" : "Query"} id=0x${dns.id.toString(16)}`);
      dns.questions.forEach(q => lines.push(`  Q: ${q.name} ${q.qtypeName}`));
      dns.answers.forEach(a => lines.push(`  A: ${a.name} ${a.rtypeName} → ${a.rdata}`));
    }
    lines.push("");
  }

 // 可提取的原始载荷列表（有应用层数据的包）
  const payloadPkts = dissected.filter(d => d.payload && d.payload.length > 0);
  if (payloadPkts.length > 0 && !detail) {
    lines.push("--- 含载荷的包 ---");
    for (const d of payloadPkts.slice(0, maxPackets)) {
      const previewLen = Math.min(d.payload.length, 32);
      const hex = toHex(d.payload, 0, previewLen);
      lines.push(`[#${d.index}] ${d.payload.length} 字节: ${hex}${d.payload.length > previewLen ? "..." : ""}`);
    }
  }

  return lines.join("\n");
}

// ============================================================
// op run 函数
// ============================================================
export function pcapParseRun(text, p = {}) {
  const enc = p.inputEnc || "auto";
  const maxPackets = parseInt(p.maxPackets, 10) || 50;
  const detail = p.detail || "summary";

  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) return "（空输入）请输入 pcap/pcapng 文件的 hex 或 base64 编码。";

  let bytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
    bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, enc);
  } catch (e) {
    return "输入解析失败：" + (e && e.message ? e.message : String(e));
  }

  if (bytes.length < 24) return "（输入过短）不足一个 pcap 全局头（24 字节）。";

  let container;
  try {
    container = parseContainer(bytes);
  } catch (e) {
    return "pcap/pcapng 解析失败：" + (e && e.message ? e.message : String(e));
  }

 // 逐包分帧
  const dissected = container.packets.map((pkt) => {
 // pcapng 每包可能有自己的 linkType（从 EPB→interface→IDB），但简化用 container.linkType
    const lt = pkt.linkType !== undefined ? pkt.linkType : container.linkType;
    try {
      return dissectPacket(pkt, lt);
    } catch (e) {
      return {
        index: pkt.index,
        ts: formatTime(pkt.ts_sec, pkt.ts_usec),
        length: pkt.incl_len,
        origLength: pkt.orig_len,
        layers: {},
        payload: null,
        summary: `[${pkt.index}] ${pkt.ts_sec}.${pkt.ts_usec} len=${pkt.incl_len} 解析错误: ${e.message}`,
      };
    }
  });

  return formatReport(container, dissected, { maxPackets, detail });
}

register({
  id: "pcapParse",
  cat: "forensic",
  name: "pcap/pcapng 结构解析",
  desc: "解析 pcap/pcapng 流量文件：全局头+包记录+Ethernet/IPv4/IPv6/TCP/UDP/ICMP/HTTP/DNS 分帧，输出包摘要表+协议详情+载荷提取。纯前端零依赖",
  params: [
    {
      key: "inputEnc", label: "输入编码", type: "select", default: "hex",
      options: [
        { value: "hex", label: "Hex 十六进制" },
        { value: "base64", label: "Base64" },
        { value: "auto", label: "自动识别" },
      ],
    },
    { key: "maxPackets", label: "最大显示包数", type: "number", default: 50, placeholder: "50" },
    {
      key: "detail", label: "详细程度", type: "select", default: "summary",
      options: [
        { value: "summary", label: "仅摘要（快）" },
        { value: "full", label: "含协议详情+载荷（全）" },
      ],
    },
  ],
  run: pcapParseRun,
  acceptsBytes: true,
});
