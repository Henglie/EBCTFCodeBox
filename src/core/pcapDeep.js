/*
 * pcapDeep.js — pcap/pcapng 流量深度取证分析（cat:'analysis'，单向 run）。
 *
 * 在 pcapParse.js（容器解析 + 逐帧分层）基础上做取证级深化，对标同类工具做不到的深度：
 * 1) pcapTcpReassemble TCP 流重组：按 5 元组聚合、seq 排序去重、还原完整字节流
 * 2) pcapHttpExtract HTTP 对象提取：基于 TCP 重组解析请求/响应，处理 chunked/gzip/deflate，导出文件/文本
 * 3) pcapDnsTunnel DNS 隧道检测：提取 query 子域名，尝试 base32/base64/hex 拼接解码
 * 4) pcapIcmpPayload ICMP 载荷提取：ICMP echo payload 按 seq 拼接（隐写外泄）
 *
 * 复用 pcapParse.js 的具名导出（不重复造 pcap 解析轮子）：
 * - inputToBytes(text, enc) hex/base64/auto → Uint8Array
 * - parseContainer(bytes) pcap/pcapng 容器解析 → { packets, linkType, ... }
 * - dissectPacket(pkt, linkType) 单包逐层分帧 → { layers:{ l2,l3,l4,l7 }, ... }
 * 其中 l3.payload = L4 原始字节，l4(TCP).{seq,flags,payload}，l4(ICMP).payload，l7(DNS).questions。
 *
 * 协议依据（照 RFC 实现，不编造）：
 * RFC 793 TCP（seq 32bit 回绕）、RFC 9112/2616 HTTP（chunked/Content-Length/Content-Encoding）
 * RFC 1951 DEFLATE + RFC 1950 zlib + RFC 1952 gzip（纯 JS inflate，不依赖 DecompressionStream）
 * RFC 1035 DNS、RFC 792 ICMP（echo id/seq）、RFC 4648 Base32/Base64。
 *
 * 纯前端零外发，算法层零 UI 依赖。件内自注册，只 import { register }。
 */
import { register } from "./registry.js";
import { inputToBytes, parseContainer, dissectPacket } from "./pcapParse.js";

// ============================================================
// 小工具
// ============================================================
function u16be(b, i) { return ((b[i] << 8) | b[i + 1]) >>> 0; }

function toHex(bytes, start, end) {
  let s = "";
  const e = end === undefined ? bytes.length : end;
  for (let i = start || 0; i < e; i++) {
    const v = bytes[i];
    s += (v < 16 ? "0" : "") + v.toString(16);
  }
  return s;
}

// Uint8Array → latin1 字符串（分块，避免超长 apply 爆栈）
function latin1(bytes, start, end) {
  const s = start || 0;
  const e = end === undefined ? bytes.length : end;
  let out = "";
  for (let i = s; i < e; i += 8192) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(e, i + 8192)));
  }
  return out;
}

// 可打印 ASCII 预览（非可见字符 → '.'）
function asciiPreview(bytes, start, end) {
  const s = start || 0;
  const e = end === undefined ? bytes.length : end;
  let out = "";
  for (let i = s; i < e; i++) {
    const b = bytes[i];
    out += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
  }
  return out;
}

function isMostlyText(bytes, limit) {
  const e = Math.min(bytes.length, limit || 512);
  if (e === 0) return true;
  let printable = 0;
  for (let i = 0; i < e; i++) {
    const b = bytes[i];
    if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b <= 0x7e)) printable++;
    else if (b >= 0x80) printable += 0.5; // 可能是 UTF-8
  }
  return printable / e > 0.85;
}

function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

const MAX_STREAM = 64 * 1024 * 1024; // 单流重组上限，防 OOM

// ============================================================
// 共享：解码 pcap → 逐包分帧结果
// ============================================================
function decodePcap(text, enc, p) {
  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) {
    return { error: "（空输入）请输入 pcap/pcapng 文件的 hex 或 base64 编码。" };
  }
  let bytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
    bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, enc || "auto");
  } catch (e) {
    return { error: "输入解析失败：" + (e && e.message ? e.message : String(e)) };
  }
  if (bytes.length < 24) return { error: "（输入过短）不足一个 pcap 全局头（24 字节）。" };
  let container;
  try {
    container = parseContainer(bytes);
  } catch (e) {
    return { error: "pcap/pcapng 解析失败：" + (e && e.message ? e.message : String(e)) };
  }
  const dissected = container.packets.map((pkt) => {
    const lt = pkt.linkType !== undefined ? pkt.linkType : container.linkType;
    try { return dissectPacket(pkt, lt); } catch { return null; }
  }).filter(Boolean);
  return { container, dissected };
}

// ============================================================
// TCP 流重组（RFC 793）
// ============================================================
// seq 是 32bit 循环序号，需按回绕处理相对偏移。
function seqDelta(seq, base) {
  let d = ((seq - base) % 0x100000000 + 0x100000000) % 0x100000000; // → 0..2^32
  if (d > 0x80000000) d -= 0x100000000; // → 有符号
  return d;
}

// 收集所有 TCP 段并按连接聚合。连接以无向 5 元组标识，方向按首见段确定 a→b / b→a。
function reassembleFlows(dissected) {
  const flows = new Map(); // connKey → flow
  for (const d of dissected) {
    const l3 = d.layers && d.layers.l3;
    const l4 = d.layers && d.layers.l4;
    if (!l3 || !l4 || l4.type !== "TCP") continue;
    const src = `${l3.src}:${l4.srcPort}`;
    const dst = `${l3.dst}:${l4.dstPort}`;
    const connKey = src < dst ? `${src}|${dst}` : `${dst}|${src}`;
    let flow = flows.get(connKey);
    if (!flow) {
      flow = { a: src, b: dst, dirs: new Map(), firstIndex: d.index };
      flows.set(connKey, flow);
    }
    const dirKey = `${src}>${dst}`;
    let dir = flow.dirs.get(dirKey);
    if (!dir) { dir = { from: src, to: dst, segs: [], isn: null }; flow.dirs.set(dirKey, dir); }
    if (l4.flags && l4.flags.SYN) dir.isn = (l4.seq + 1) >>> 0; // SYN 占 1 个序号，数据从 seq+1 起
    const data = l4.payload;
    if (data && data.length > 0) {
      dir.segs.push({ seq: l4.seq >>> 0, data, index: d.index });
    }
  }
  return flows;
}

// 重组单方向：确定基准 ISN → 按相对偏移放置 → 首次写入优先（重传去重）。
function reassembleDir(dir) {
  const segs = dir.segs;
  if (segs.length === 0) return new Uint8Array(0);
  let base = dir.isn;
  if (base === null || base === undefined) {
 // 无 SYN：以按 seq 升序的首段为基准
    const sorted = segs.slice().sort((x, y) => x.seq - y.seq);
    base = sorted[0].seq;
  }
 // 先算总长
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
 // 按到达顺序（index）写，首次写入优先
  const byArrival = segs.slice().sort((x, y) => x.index - y.index);
  for (const s of byArrival) {
    const off = seqDelta(s.seq, base);
    if (off < 0) continue;
    const n = Math.min(s.data.length, maxEnd - off);
    for (let i = 0; i < n; i++) {
      if (!filled[off + i]) { out[off + i] = s.data[i]; filled[off + i] = 1; }
    }
  }
  return out;
}

function pcapTcpReassembleRun(text, p = {}) {
  const res = decodePcap(text, p.inputEnc, p);
  if (res.error) return res.error;
  const flows = reassembleFlows(res.dissected);
  if (flows.size === 0) return "未发现 TCP 段。此流量中没有可重组的 TCP 数据（或非 pcap TCP 流量）。";

  const preview = parseInt(p.previewBytes, 10) || 512;
  const maxFlows = parseInt(p.maxFlows, 10) || 30;
  const flowSel = (p.flowIndex === undefined || p.flowIndex === null || String(p.flowIndex).trim() === "") ? null : parseInt(p.flowIndex, 10);

 // 组织成有序数组
  const list = [];
  for (const [, flow] of flows) {
    const dirs = [];
    for (const [, dir] of flow.dirs) {
      const bytes = reassembleDir(dir);
      dirs.push({ label: `${dir.from} → ${dir.to}`, bytes, segs: dir.segs.length });
    }
    list.push({ a: flow.a, b: flow.b, dirs, firstIndex: flow.firstIndex });
  }
  list.sort((x, y) => x.firstIndex - y.firstIndex);

  const lines = [];
  lines.push("=== TCP 流重组（RFC 793，seq 排序去重）===");
  lines.push(`TCP 流总数: ${list.length}`);
  lines.push("");

  if (flowSel !== null) {
    if (flowSel < 0 || flowSel >= list.length) return `flowIndex 越界：应为 0..${list.length - 1}`;
    const f = list[flowSel];
    lines.push(`▼ 流 #${flowSel}  ${f.a} ⇄ ${f.b}（完整转储）`);
    for (const dir of f.dirs) {
      lines.push("");
      lines.push(`— 方向 ${dir.label}（${dir.segs} 段，重组后 ${dir.bytes.length} 字节）—`);
      if (dir.bytes.length === 0) { lines.push("  (无数据)"); continue; }
      if (isMostlyText(dir.bytes, 2048)) {
        lines.push("[文本]");
        lines.push(latin1(dir.bytes));
      } else {
        lines.push("[二进制 · hex]");
        lines.push(toHex(dir.bytes));
      }
    }
    return lines.join("\n");
  }

 // 列表模式
  const showN = Math.min(list.length, maxFlows);
  if (list.length > maxFlows) lines.push(`（显示前 ${maxFlows} 个，用 flowIndex 转储指定流的完整内容）`);
  for (let i = 0; i < showN; i++) {
    const f = list[i];
    lines.push(`▼ 流 #${i}  ${f.a} ⇄ ${f.b}`);
    for (const dir of f.dirs) {
      lines.push(`  ${dir.label}  ${dir.segs} 段 → ${dir.bytes.length} 字节`);
      if (dir.bytes.length > 0) {
        const n = Math.min(dir.bytes.length, preview);
        if (isMostlyText(dir.bytes, n)) {
          lines.push(`    文本: ${latin1(dir.bytes, 0, n).replace(/\r/g, "\\r").replace(/\n/g, "\\n")}${dir.bytes.length > n ? " …" : ""}`);
        } else {
          lines.push(`    hex: ${toHex(dir.bytes, 0, n)}${dir.bytes.length > n ? " …" : ""}`);
        }
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ============================================================
// 纯 JS inflate（RFC 1951 DEFLATE / 1950 zlib / 1952 gzip）
// 不依赖 DecompressionStream，node 测试环境可直接跑。
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

export function inflateRaw(data) {
  let bitBuf = 0, bitCnt = 0, pos = 0;
  const out = [];

  function getBit() {
    if (bitCnt === 0) {
      if (pos >= data.length) throw new Error("inflate: 数据提前结束");
      bitBuf = data[pos++]; bitCnt = 8;
    }
    const b = bitBuf & 1; bitBuf >>= 1; bitCnt--; return b;
  }
  function getBits(n) {
    let v = 0;
    for (let i = 0; i < n; i++) v |= getBit() << i;
    return v >>> 0;
  }
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

 // 固定 Huffman 表
  const fixedLitLen = new Array(288);
  for (let i = 0; i < 144; i++) fixedLitLen[i] = 8;
  for (let i = 144; i < 256; i++) fixedLitLen[i] = 9;
  for (let i = 256; i < 280; i++) fixedLitLen[i] = 7;
  for (let i = 280; i < 288; i++) fixedLitLen[i] = 8;
  const fixedLit = buildHuff(fixedLitLen, 288);
  const fixedDist = buildHuff(new Array(30).fill(5), 30);

  function inflateBlock(lt, dt) {
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
      let start = out.length - dist;
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
      bitCnt = 0; // 对齐到字节边界，丢弃当前字节剩余位
      if (pos + 4 > data.length) throw new Error("inflate: stored 块头不足");
      const len = data[pos] | (data[pos + 1] << 8);
      pos += 4; // 跳过 LEN(2)+NLEN(2)
      if (pos + len > data.length) throw new Error("inflate: stored 块数据不足");
      for (let i = 0; i < len; i++) out.push(data[pos++]);
    } else if (type === 1) {
      inflateBlock(fixedLit, fixedDist);
    } else if (type === 2) {
      const hlit = getBits(5) + 257;
      const hdist = getBits(5) + 1;
      const hclen = getBits(4) + 4;
      const clLen = new Array(19).fill(0);
      for (let i = 0; i < hclen; i++) clLen[CL_ORDER[i]] = getBits(3);
      const clTree = buildHuff(clLen, 19);
      const lengths = new Array(hlit + hdist).fill(0);
      let i = 0;
      while (i < hlit + hdist) {
        const sym = decodeSym(clTree);
        if (sym < 16) { lengths[i++] = sym; }
        else if (sym === 16) { const r = getBits(2) + 3; const prev = lengths[i - 1]; for (let k = 0; k < r; k++) lengths[i++] = prev; }
        else if (sym === 17) { const r = getBits(3) + 3; for (let k = 0; k < r; k++) lengths[i++] = 0; }
        else if (sym === 18) { const r = getBits(7) + 11; for (let k = 0; k < r; k++) lengths[i++] = 0; }
        else throw new Error("inflate: 非法码长符号");
      }
      const litTree = buildHuff(lengths.slice(0, hlit), hlit);
      const distTree = buildHuff(lengths.slice(hlit), hdist);
      inflateBlock(litTree, distTree);
    } else {
      throw new Error("inflate: 保留块类型 3");
    }
  } while (!final);

  return new Uint8Array(out);
}

// 按 content-encoding 解压。返回 { data, note }；不支持则 note 说明、data 返回原始。
function decompressBody(bytes, encoding) {
  const enc = (encoding || "").toLowerCase().trim();
  if (!enc || enc === "identity") return { data: bytes, note: null };
  try {
    if (enc === "gzip" || enc === "x-gzip") {
      if (bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return { data: bytes, note: "gzip 头无效，按原始输出" };
      if (bytes[2] !== 8) return { data: bytes, note: "gzip 非 deflate 方法" };
      const flg = bytes[3];
      let off = 10;
      if (flg & 0x04) { const xlen = bytes[off] | (bytes[off + 1] << 8); off += 2 + xlen; } // FEXTRA
      if (flg & 0x08) { while (off < bytes.length && bytes[off] !== 0) off++; off++; }        // FNAME
      if (flg & 0x10) { while (off < bytes.length && bytes[off] !== 0) off++; off++; }        // FCOMMENT
      if (flg & 0x02) off += 2;                                                                // FHCRC
      const raw = bytes.subarray(off, bytes.length - 8);
      return { data: inflateRaw(raw), note: "gzip 已解压" };
    }
    if (enc === "deflate") {
 // 可能是 zlib 包装（RFC 1950）或裸 deflate
      if (bytes.length >= 2 && (bytes[0] & 0x0f) === 8 && ((bytes[0] << 8 | bytes[1]) % 31 === 0)) {
        return { data: inflateRaw(bytes.subarray(2, bytes.length - 4)), note: "deflate(zlib) 已解压" };
      }
      return { data: inflateRaw(bytes), note: "deflate(raw) 已解压" };
    }
    if (enc === "br") return { data: bytes, note: "brotli 未支持（纯 JS 未内置），按原始输出" };
  } catch (e) {
    return { data: bytes, note: "解压失败(" + (e && e.message ? e.message : e) + ")，按原始输出" };
  }
  return { data: bytes, note: `未知编码 ${enc}，按原始输出` };
}

// ============================================================
// HTTP 对象提取（RFC 9112/2616）
// ============================================================
function indexOfHeaderEnd(b, from) {
  for (let i = from; i + 3 < b.length; i++) {
    if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i;
  }
  return -1;
}

function readChunked(b, start) {
  const chunks = [];
  let pos = start;
  let guard = 0;
  while (pos < b.length && guard++ < 100000) {
    let lineEnd = pos;
    while (lineEnd + 1 < b.length && !(b[lineEnd] === 13 && b[lineEnd + 1] === 10)) lineEnd++;
    const sizeStr = latin1(b, pos, lineEnd).split(";")[0].trim();
    const size = parseInt(sizeStr, 16);
    pos = lineEnd + 2;
    if (isNaN(size) || size === 0) break; // 0 或非法 → 结束（含 trailer 忽略）
    const end = Math.min(b.length, pos + size);
    chunks.push(b.subarray(pos, end));
    pos = end + 2; // 跳过块尾 CRLF
  }
  return { data: concatBytes(chunks), end: pos };
}

function parseHttpStream(stream) {
  const msgs = [];
  let pos = 0;
  let guard = 0;
  while (pos < stream.length && guard++ < 2000) {
    while (pos < stream.length && (stream[pos] === 13 || stream[pos] === 10)) pos++;
    if (pos >= stream.length) break;
    const hend = indexOfHeaderEnd(stream, pos);
    if (hend < 0) break;
    const headerText = latin1(stream, pos, hend);
    const hlines = headerText.split("\r\n");
    const startLine = hlines[0];
    let kind = null;
    if (/^HTTP\/\d/.test(startLine)) kind = "response";
    else if (/^[A-Z]+ \S+ HTTP\/\d/.test(startLine)) kind = "request";
    if (!kind) break; // 非 HTTP，停止解析该流
    const headers = {};
    for (let i = 1; i < hlines.length; i++) {
      const idx = hlines[i].indexOf(":");
      if (idx > 0) headers[hlines[i].slice(0, idx).trim().toLowerCase()] = hlines[i].slice(idx + 1).trim();
    }
    const bodyStart = hend + 4;
    let bodyRaw;
    let truncated = false;
    const te = (headers["transfer-encoding"] || "").toLowerCase();
    const cl = headers["content-length"];
    if (te.includes("chunked")) {
      const r = readChunked(stream, bodyStart);
      bodyRaw = r.data; pos = r.end;
    } else if (cl !== undefined) {
      const n = parseInt(cl, 10) || 0;
      const end = Math.min(stream.length, bodyStart + n);
      if (end < bodyStart + n) truncated = true;
      bodyRaw = stream.subarray(bodyStart, end);
      pos = end;
    } else if (kind === "response") {
      const status = parseInt(startLine.split(" ")[1], 10);
      if (status === 204 || status === 304 || (status >= 100 && status < 200)) { bodyRaw = new Uint8Array(0); pos = bodyStart; }
      else { bodyRaw = stream.subarray(bodyStart); pos = stream.length; } // 无长度 → 读到流尾（connection: close）
    } else {
      bodyRaw = new Uint8Array(0); pos = bodyStart;
    }
    const dec = decompressBody(bodyRaw, headers["content-encoding"]);
    msgs.push({
      kind, startLine, headers,
      contentType: headers["content-type"] || "",
      bodyRaw, body: dec.data, decodeNote: dec.note, truncated,
    });
  }
  return msgs;
}

function pcapHttpExtractRun(text, p = {}) {
  const res = decodePcap(text, p.inputEnc, p);
  if (res.error) return res.error;
  const flows = reassembleFlows(res.dissected);
  if (flows.size === 0) return "未发现 TCP 段，无法提取 HTTP（HTTP 依赖 TCP 重组）。";

  const preview = parseInt(p.previewBytes, 10) || 400;
  const dumpSel = (p.dumpIndex === undefined || p.dumpIndex === null || String(p.dumpIndex).trim() === "") ? null : parseInt(p.dumpIndex, 10);

 // 收集所有流各方向的 HTTP 消息
  const objects = [];
  const flowList = [];
  for (const [, flow] of flows) flowList.push(flow);
  flowList.sort((x, y) => x.firstIndex - y.firstIndex);
  for (const flow of flowList) {
    for (const [, dir] of flow.dirs) {
      const bytes = reassembleDir(dir);
      if (bytes.length === 0) continue;
      const msgs = parseHttpStream(bytes);
      for (const m of msgs) objects.push({ ...m, flowLabel: `${dir.from} → ${dir.to}` });
    }
  }
  if (objects.length === 0) return "重组了 TCP 流，但未解析出 HTTP 请求/响应。可能是加密(HTTPS)或非 HTTP 协议。";

 // dump 指定对象的 body（hex）
  if (dumpSel !== null) {
    if (dumpSel < 0 || dumpSel >= objects.length) return `dumpIndex 越界：应为 0..${objects.length - 1}`;
    const o = objects[dumpSel];
    const lines = [];
    lines.push(`=== HTTP 对象 #${dumpSel} 完整 body ===`);
    lines.push(`${o.kind}  ${o.startLine}`);
    lines.push(`Content-Type: ${o.contentType || "(无)"}  body: ${o.body.length} 字节${o.decodeNote ? "  [" + o.decodeNote + "]" : ""}`);
    lines.push("");
    if (o.body.length === 0) { lines.push("(空 body)"); return lines.join("\n"); }
    if (isMostlyText(o.body, 4096)) { lines.push("[文本]"); lines.push(latin1(o.body)); }
    else { lines.push("[二进制 · hex]"); lines.push(toHex(o.body)); }
    return lines.join("\n");
  }

  const lines = [];
  lines.push("=== HTTP 对象提取（基于 TCP 重组，含 chunked/gzip/deflate 解码）===");
  lines.push(`共 ${objects.length} 条 HTTP 消息。用 dumpIndex 导出指定对象的完整 body。`);
  lines.push("");
  objects.forEach((o, i) => {
    lines.push(`▼ #${i} [${o.kind}] ${o.flowLabel}`);
    lines.push(`  ${o.startLine}`);
    if (o.contentType) lines.push(`  Content-Type: ${o.contentType}`);
    const enc = o.headers["content-encoding"];
    if (enc) lines.push(`  Content-Encoding: ${enc}${o.decodeNote ? "  → " + o.decodeNote : ""}`);
    if (o.kind === "request" && o.headers["host"]) lines.push(`  Host: ${o.headers["host"]}`);
    lines.push(`  body: ${o.body.length} 字节${o.truncated ? "（截断/流尾不足）" : ""}`);
    if (o.body.length > 0) {
      const n = Math.min(o.body.length, preview);
      if (isMostlyText(o.body, n)) {
        lines.push(`  文本: ${latin1(o.body, 0, n).replace(/\r/g, "\\r").replace(/\n/g, "\\n")}${o.body.length > n ? " …" : ""}`);
      } else {
        lines.push(`  hex: ${toHex(o.body, 0, Math.min(o.body.length, 96))}${o.body.length > 96 ? " …" : ""}`);
      }
    }
    lines.push("");
  });
  return lines.join("\n");
}

// ============================================================
// Base32 / Base64 解码（RFC 4648，容错）
// ============================================================
function base32Decode(s) {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/[^A-Z2-7]/g, "");
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, val = 0;
  const out = [];
  for (const c of clean) {
    const idx = ALPHA.indexOf(c);
    if (idx < 0) continue;
    val = (val << 5) | idx; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

function base64Decode(s) {
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = s.replace(/-/g, "+").replace(/_/g, "/").replace(/[^A-Za-z0-9+/]/g, "");
  let bits = 0, val = 0;
  const out = [];
  for (const c of clean) {
    const idx = ALPHA.indexOf(c);
    if (idx < 0) continue;
    val = (val << 6) | idx; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((val >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

function hexDecodeLoose(s) {
  const clean = s.replace(/[^0-9a-fA-F]/g, "");
  const n = clean.length - (clean.length % 2);
  const out = new Uint8Array(n / 2);
  for (let i = 0; i < n; i += 2) out[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  return out;
}

function tryDecodeData(str, mode) {
  const attempts = [];
  const want = mode || "auto";
  const push = (name, bytes) => {
    if (!bytes || bytes.length === 0) return;
    attempts.push({ name, bytes, ascii: asciiPreview(bytes), printableRatio: printableRatio(bytes) });
  };
  if (want === "base32" || want === "auto") { try { push("base32", base32Decode(str)); } catch { /* skip */ } }
  if (want === "base64" || want === "auto") { try { push("base64", base64Decode(str)); } catch { /* skip */ } }
  if (want === "hex" || want === "auto") { try { push("hex", hexDecodeLoose(str)); } catch { /* skip */ } }
  return attempts;
}

function printableRatio(bytes) {
  if (bytes.length === 0) return 0;
  let p = 0;
  for (const b of bytes) if (b === 9 || b === 10 || b === 13 || (b >= 0x20 && b <= 0x7e)) p++;
  return p / bytes.length;
}

function pcapDnsTunnelRun(text, p = {}) {
  const res = decodePcap(text, p.inputEnc, p);
  if (res.error) return res.error;

 // 收集 DNS query（qr=0）；无 query 则退回全部 DNS 问询
  const queries = [];
  for (const d of res.dissected) {
    const l7 = d.layers && d.layers.l7;
    if (!l7 || l7.proto !== "DNS") continue;
    if (!l7.questions || l7.questions.length === 0) continue;
    for (const q of l7.questions) {
      queries.push({ index: d.index, name: q.name, isResponse: !!l7.isResponse, qtype: q.qtypeName });
    }
  }
  if (queries.length === 0) return "未发现 DNS 查询。此流量中无 DNS（pcapParse 仅解析 UDP/53 DNS）。";

 // 优先只看请求，避免响应重复
  let qset = queries.filter((q) => !q.isResponse);
  if (qset.length === 0) qset = queries;
 // 按出现顺序、去重相邻重复
  const seen = new Set();
  const ordered = [];
  for (const q of qset) {
    const k = q.index + "|" + q.name;
    if (seen.has(k)) continue; seen.add(k);
    ordered.push(q);
  }

  const baseDomain = (p.baseDomain || "").trim().replace(/^\.+|\.+$/g, "").toLowerCase();
  const stripLabels = parseInt(p.stripLabels, 10);
  const strip = isNaN(stripLabels) ? 2 : stripLabels;
  const decodeMode = p.decodeAs || "auto";

 // 提取每条 query 的数据部分（前导子域名标签）
  function extractData(name) {
    let labels = name.split(".").filter(Boolean);
    if (baseDomain) {
      const bParts = baseDomain.split(".");
      if (labels.length >= bParts.length) {
        const tail = labels.slice(labels.length - bParts.length).join(".").toLowerCase();
        if (tail === baseDomain) labels = labels.slice(0, labels.length - bParts.length);
      }
    } else if (strip > 0 && labels.length > strip) {
      labels = labels.slice(0, labels.length - strip);
    }
    return labels;
  }

  const lines = [];
  lines.push("=== DNS 隧道检测（RFC 1035，子域名数据外泄）===");
  lines.push(`DNS 查询数: ${queries.length}（唯一请求: ${ordered.length}）`);
  const baseInfo = baseDomain ? `已剥离基准域: ${baseDomain}` : `未指定基准域，默认剥离末尾 ${strip} 个标签（TLD+域名）。可用 baseDomain 精确指定`;
  lines.push(baseInfo);
  lines.push("");

 // 唯一子域名个数 / 平均长度 → 隧道启发式
  const uniqNames = new Set(ordered.map((q) => q.name));
  const avgLen = ordered.reduce((s, q) => s + q.name.length, 0) / (ordered.length || 1);
  lines.push(`启发式: 唯一域名 ${uniqNames.size} 个，平均查询名长度 ${avgLen.toFixed(1)} 字符${avgLen > 40 || uniqNames.size > 20 ? "（偏高，疑似隧道）" : ""}`);
  lines.push("");

 // 拼接所有数据标签
  const allDataParts = [];
  lines.push("--- 各查询提取的数据标签 ---");
  const maxList = 60;
  ordered.forEach((q, i) => {
    const labels = extractData(q.name);
    const joined = labels.join("");
    allDataParts.push(joined);
    if (i < maxList) lines.push(`[#${q.index}] ${q.name}  →  数据: ${joined || "(空)"}`);
  });
  if (ordered.length > maxList) lines.push(`… 省略 ${ordered.length - maxList} 条`);
  lines.push("");

  const aggregate = allDataParts.join("");
  lines.push("--- 拼接数据流 ---");
  lines.push(`拼接总长: ${aggregate.length} 字符`);
  lines.push(aggregate.length > 512 ? aggregate.slice(0, 512) + " …" : aggregate);
  lines.push("");

  if (decodeMode !== "none" && aggregate.length > 0) {
    lines.push(`--- 解码尝试（${decodeMode}）---`);
    const attempts = tryDecodeData(aggregate, decodeMode);
    if (attempts.length === 0) {
      lines.push("（无有效解码结果）");
    } else {
      attempts.sort((a, b) => b.printableRatio - a.printableRatio);
      for (const a of attempts) {
        const flag = a.printableRatio > 0.85 ? "  ★可读" : "";
        lines.push(`[${a.name}] ${a.bytes.length} 字节 (可打印率 ${(a.printableRatio * 100).toFixed(0)}%)${flag}`);
        lines.push(`  ${a.ascii.length > 512 ? a.ascii.slice(0, 512) + " …" : a.ascii}`);
      }
    }
  }
  return lines.join("\n");
}

// ============================================================
// ICMP 载荷提取（RFC 792，echo id/seq 拼接）
// ============================================================
function pcapIcmpPayloadRun(text, p = {}) {
  const res = decodePcap(text, p.inputEnc, p);
  if (res.error) return res.error;

  const filter = p.filter || "all"; // all | request | reply
  const preview = parseInt(p.previewBytes, 10) || 400;

 // 收集 ICMP 包：从 l3.payload 重解析 id/seq（pcapParse 的 l4 未暴露 id/seq）
  const items = [];
  for (const d of res.dissected) {
    const l3 = d.layers && d.layers.l3;
    const l4 = d.layers && d.layers.l4;
    if (!l4 || l4.type !== "ICMP") continue;
    const icmpBytes = l3 ? l3.payload : null; // ICMP 完整字节（含 8 字节头）
    if (!icmpBytes || icmpBytes.length < 8) continue;
    const type = icmpBytes[0];
    const code = icmpBytes[1];
    const id = u16be(icmpBytes, 4);
    const seq = u16be(icmpBytes, 6);
    const payload = l4.payload || icmpBytes.subarray(8);
    items.push({ index: d.index, type, code, id, seq, payload, src: l3 ? l3.src : "?", dst: l3 ? l3.dst : "?" });
  }
  if (items.length === 0) return "未发现 ICMP 包。此流量中无 ICMP（隐写通常藏于 echo request/reply payload）。";

  let filtered = items;
  if (filter === "request") filtered = items.filter((x) => x.type === 8);
  else if (filter === "reply") filtered = items.filter((x) => x.type === 0);
  if (filtered.length === 0) return `ICMP 包存在，但无 type=${filter === "request" ? "8(request)" : "0(reply)"} 的包。`;

 // 按 (id, seq) 排序拼接
  const sorted = filtered.slice().sort((a, b) => (a.id - b.id) || (a.seq - b.seq) || (a.index - b.index));
  const combined = concatBytes(sorted.map((x) => x.payload));

  const lines = [];
  lines.push("=== ICMP 载荷提取（RFC 792，echo payload 按 id/seq 拼接）===");
  lines.push(`ICMP 包总数: ${items.length}（本次过滤 filter=${filter}，取 ${filtered.length} 个）`);
  lines.push("");
  lines.push("--- 逐包 ---");
  const maxList = 80;
  sorted.slice(0, maxList).forEach((x) => {
    const tName = x.type === 8 ? "EchoReq" : x.type === 0 ? "EchoReply" : `type${x.type}`;
    lines.push(`[#${x.index}] ${x.src}→${x.dst} ${tName} id=0x${x.id.toString(16)} seq=${x.seq} len=${x.payload.length}  ${asciiPreview(x.payload, 0, Math.min(x.payload.length, 32))}`);
  });
  if (sorted.length > maxList) lines.push(`… 省略 ${sorted.length - maxList} 个`);
  lines.push("");
  lines.push(`--- 拼接载荷（${combined.length} 字节）---`);
  if (combined.length === 0) { lines.push("(无载荷)"); return lines.join("\n"); }
  if (isMostlyText(combined, 2048)) {
    lines.push("[文本]");
    lines.push(latin1(combined));
  } else {
    lines.push("[hex]");
    lines.push(toHex(combined, 0, Math.min(combined.length, 4096)) + (combined.length > 4096 ? " …" : ""));
    lines.push("[ASCII]");
    lines.push(asciiPreview(combined, 0, Math.min(combined.length, preview)) + (combined.length > preview ? " …" : ""));
  }
  return lines.join("\n");
}

// ============================================================
// 文件拖入自动分析：analyzePcapBytes(bytes) → sections[]
// 拖入 pcap/pcapng 时由 fileAnalysis.js 调用，一键跑完 4 项协议级分析
// （TCP 重组 / HTTP 提取 / DNS 隧道 / ICMP 载荷），免去用户手动逐个 op 跑。
// 复用 run 函数的完整格式化逻辑（列表模式），纯函数零 UI 依赖。
// ============================================================
const FLAG_RE = /(flag|ctf|key)\{[^}]+\}/i;

export function analyzePcapBytes(bytes) {
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const sections = [];

  // 概览：解析一次统计协议分布 + 时间跨度
  const res = decodePcap("", "auto", { rawBytes: u8a });
  if (res.error) {
    sections.push({
      id: "pcap-error", title: "PCAP 解析失败",
      level: "warn", icon: "warning",
      body: res.error,
    });
    return sections;
  }
  const { container, dissected } = res;

  const protoCount = {};
  let tsMin = Infinity, tsMax = -Infinity;
  for (const d of dissected) {
    const l3 = d.layers && d.layers.l3;
    const l4 = d.layers && d.layers.l4;
    const proto = l4 ? l4.type : (l3 ? l3.type : "other");
    protoCount[proto] = (protoCount[proto] || 0) + 1;
    if (d.tsSec != null) {
      if (d.tsSec < tsMin) tsMin = d.tsSec;
      if (d.tsSec > tsMax) tsMax = d.tsSec;
    }
  }
  const protoLine = Object.entries(protoCount)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k}(${v})`)
    .join(" / ");
  const overviewLines = [];
  overviewLines.push("容器: " + (container.format || "pcap/pcapng"));
  overviewLines.push("链路类型: " + (container.linkType != null ? container.linkType : "—"));
  overviewLines.push("总包数: " + dissected.length);
  if (protoLine) overviewLines.push("协议分布: " + protoLine);
  if (tsMin !== Infinity && tsMax > tsMin) {
    overviewLines.push("时间跨度: " + (tsMax - tsMin) + " 秒");
  }
  sections.push({
    id: "pcap-overview", title: "流量概览",
    level: "info", icon: "analytics",
    body: overviewLines.join("\n"),
  });

  // 4 项协议级分析：复用 run 函数（列表模式，不传 flowIndex/dumpIndex → 摘要不爆量）
  const analyses = [
    { id: "pcap-tcp", title: "TCP 流重组", icon: "swap_horiz", fn: pcapTcpReassembleRun, skipKw: ["未发现 TCP 段"] },
    { id: "pcap-http", title: "HTTP 对象提取", icon: "language", fn: pcapHttpExtractRun, skipKw: ["未发现 TCP", "未解析出 HTTP"] },
    { id: "pcap-dns", title: "DNS 隧道检测", icon: "dns", fn: pcapDnsTunnelRun, skipKw: ["未发现 DNS", "无 DNS"] },
    { id: "pcap-icmp", title: "ICMP 载荷提取", icon: "sensors", fn: pcapIcmpPayloadRun, skipKw: ["未发现 ICMP", "无 ICMP"] },
  ];
  for (const a of analyses) {
    let text;
    try {
      text = a.fn("", { rawBytes: u8a });
    } catch (e) {
      text = "分析异常: " + (e && e.message ? e.message : String(e));
    }
    if (typeof text !== "string" || !text.trim()) continue;
    // 无数据结果跳过（短文本才跳，长文本可能有诊断价值保留）
    if (a.skipKw.some((kw) => text.includes(kw)) && text.length < 80) continue;
    const hasFlag = FLAG_RE.test(text);
    sections.push({
      id: a.id, title: a.title,
      level: hasFlag ? "alert" : "info",
      icon: hasFlag ? "flag" : a.icon,
      body: text,
    });
  }

  return sections;
}

// ============================================================
// 注册
// ============================================================
register({
  id: "pcapTcpReassemble",
  cat: "forensic",
  name: "TCP 流重组",
  desc: "按 5 元组聚合 TCP 段，seq 排序去重，还原各方向完整字节流（HTTP 提取的基础）。纯前端零依赖，复用 pcapParse 分帧",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" }, { value: "auto", label: "自动识别" },
    ] },
    { key: "flowIndex", label: "转储流号（空=列表）", type: "number", default: "", placeholder: "留空看列表，填号看完整内容" },
    { key: "previewBytes", label: "列表预览字节", type: "number", default: 512 },
    { key: "maxFlows", label: "最大列出流数", type: "number", default: 30 },
  ],
  run: pcapTcpReassembleRun,
  acceptsBytes: true,
});

register({
  id: "pcapHttpExtract",
  cat: "forensic",
  name: "HTTP 对象提取",
  desc: "基于 TCP 重组解析 HTTP 请求/响应，处理 chunked 传输与 gzip/deflate 解压（纯 JS inflate），导出传输的文件/文本",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" }, { value: "auto", label: "自动识别" },
    ] },
    { key: "dumpIndex", label: "导出对象号（空=列表）", type: "number", default: "", placeholder: "留空看列表，填号导出完整 body" },
    { key: "previewBytes", label: "列表预览字节", type: "number", default: 400 },
  ],
  run: pcapHttpExtractRun,
  acceptsBytes: true,
});

register({
  id: "pcapDnsTunnel",
  cat: "forensic",
  name: "DNS 隧道检测",
  desc: "提取 DNS query 子域名数据标签，拼接后尝试 base32/base64/hex 解码，检出 DNS 隧道外泄的隐藏数据。复用 pcapParse DNS 分帧",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" }, { value: "auto", label: "自动识别" },
    ] },
    { key: "baseDomain", label: "基准域名（如 evil.com，用于剥离）", type: "text", default: "", placeholder: "留空则默认剥离末尾 N 个标签" },
    { key: "stripLabels", label: "默认剥离末尾标签数", type: "number", default: 2 },
    { key: "decodeAs", label: "解码方式", type: "select", default: "auto", options: [
      { value: "auto", label: "自动全试" }, { value: "base32", label: "Base32" }, { value: "base64", label: "Base64" }, { value: "hex", label: "Hex" }, { value: "none", label: "只提取不解码" },
    ] },
  ],
  run: pcapDnsTunnelRun,
  acceptsBytes: true,
});

register({
  id: "pcapIcmpPayload",
  cat: "forensic",
  name: "ICMP 载荷提取",
  desc: "提取 ICMP echo 载荷，按 id/seq 排序拼接，还原 ICMP 隐写/隧道外泄的数据。复用 pcapParse ICMP 分帧",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" }, { value: "auto", label: "自动识别" },
    ] },
    { key: "filter", label: "包类型过滤", type: "select", default: "all", options: [
      { value: "all", label: "全部" }, { value: "request", label: "仅 Echo Request(8)" }, { value: "reply", label: "仅 Echo Reply(0)" },
    ] },
    { key: "previewBytes", label: "ASCII 预览字节", type: "number", default: 400 },
  ],
  run: pcapIcmpPayloadRun,
  acceptsBytes: true,
});
