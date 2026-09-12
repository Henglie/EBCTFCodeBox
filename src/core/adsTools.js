/*
 * adsTools.js — NTFS 备用数据流（ADS）纯 JS 工具（2026-09-13 恒烈指示，替代 ntfsstreams GUI exe）。
 *
 * 诚实边界（写入 desc/tips）：浏览器只能拿到拖入文件的「主数据流」字节，拿不到 NTFS 主机
 * 文件系统上文件的真实 ADS。但 Windows 右键「压缩为 ZIP」/Info-ZIP 系工具会把 ADS 一起
 * 打进压缩包（ZIP 规范 reserved extra field 0x000A，NTFS 标签 0x0001）——CTF「ADS 藏数据」
 * 题的载体就是这种 ZIP。本工具作用对象 = 含 NTFS 扩展字段的 ZIP：
 *   ① 检测：列出包内全部 ADS（宿主:流名、大小、时间戳三件套）；
 *   ② 提取：按「宿主:流名」解出流内容（下载）；
 *   ③ 删除：剥除指定/全部 ADS（重写包，宿主文件原样保留）；
 *   ④ 添加：往宿主文件挂新流（写入 NTFS extra 配对 + 流条目，Info-ZIP 口径）。
 *
 * 实现依据：PKWARE APPNOTE 6.3.x §4.5.2/§4.5.3（extra field 结构）
 *   与 §4.5.7（0x000A NTFS：reserved 4B + Tag 0x0001 + size + 4B reserved +
 *   mtime/atime/ctime 各 8B（FILETIME 100ns，自 1601-01-01）+ 若干
 *   {u16 名长, UTF-16LE 名, u64 流大小} 配对）。流数据本体按 Info-ZIP 口径
 *   以独立条目「宿主:流名」存放（Windows 资源管理器压缩口径）。
 *
 * 复用：pcapDeep.js inflateRaw（deflate 解压，T346 先例）；crc32 自带（zipCreate 同款表）。
 * 不参与 magic（返回对象，Worker 红线无冲突）；files 产物协议（下载按钮）。
 */
import { register } from "./registry.js";
import { inflateRaw } from "./pcapDeep.js";

// ---------- 通用 ----------
function b64ToBytes(b64) {
  if (typeof b64 !== "string") throw new Error("需 base64 字符串输入");
  const comma = b64.indexOf(",");
  if (comma >= 0 && b64.slice(0, 5).toLowerCase().startsWith("data:")) b64 = b64.slice(comma + 1);
  b64 = b64.replace(/\s+/g, "");
  let bin;
  if (typeof atob === "function") bin = atob(b64);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(b64, "base64").toString("binary");
  else throw new Error("无 atob/Buffer，无法解码 base64");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  if (typeof btoa === "function") return btoa(bin);
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  throw new Error("无 btoa/Buffer");
}
const u16le = (b, o) => (b[o] | (b[o + 1] << 8)) >>> 0;
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0;
function pushU16(a, v) { a.push(v & 0xFF, (v >>> 8) & 0xFF); }
function pushU32(a, v) { a.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF); }
function setU16(b, o, v) { b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; }
function setU32(b, o, v) { b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; b[o + 2] = (v >>> 16) & 0xFF; b[o + 3] = (v >>> 24) & 0xFF; }
function utf8Decode(b) { try { return new TextDecoder("utf-8").decode(b); } catch { return String.fromCharCode(...b); } }
function utf16leDecode(b) {
  let s = "";
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode(b[i] | (b[i + 1] << 8));
  return s;
}
function utf16leEncode(s) {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); out[i * 2] = c & 0xFF; out[i * 2 + 1] = (c >>> 8) & 0xFF; }
  return out;
}
// FILETIME(100ns, 1601 纪元) → ISO 字符串；非法回退原始低 32 位十六进制
function filetimeToIso(lo, hi) {
  const t = hi * 0x100000000 + lo; // 可能超过 Number 安全界（>275760 年才会），常见值安全
  if (!isFinite(t) || t <= 0) return null;
  const ms = t / 10000 - 11644473600000; // 1601→1970
  const d = new Date(ms);
  return isNaN(d) ? null : d.toISOString().replace("T", " ").slice(0, 19);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ---------- 解析：EOCD → 中央目录 → 每条目（含 LFH 数据起点） ----------
function parseZip(data) {
  if (data.length < 22 || u32le(data, 0) !== 0x04034b50 && !findEocd(data)) {
    // 顶部非 PK 也可能拼接场景，交给 findEocd
  }
  const eocd = findEocd(data);
  if (eocd < 0) throw new Error("未找到 ZIP 结束目录（EOCD）——不是 ZIP（RAR/7z 结构不同，本工具只吃 ZIP）");
  if (u16le(data, eocd + 4) === 0xFFFF || u32le(data, eocd + 16) === 0xFFFFFFFF) {
    throw new Error("ZIP64 大档（计数值/偏移顶格）本工具不支持");
  }
  const total = u16le(data, eocd + 10);
  let off = u32le(data, eocd + 16);
  const entries = [];
  for (let i = 0; i < total; i++) {
    if (u32le(data, off) !== 0x02014b50) throw new Error("中央目录损坏（第 " + (i + 1) + " 条签名不符）");
    const flags = u16le(data, off + 8);
    const method = u16le(data, off + 10);
    const crc = u32le(data, off + 16);
    const csize = u32le(data, off + 20);
    const usize = u32le(data, off + 24);
    const nlen = u16le(data, off + 28), elen = u16le(data, off + 30), clen = u16le(data, off + 32);
    const lfhOff = u32le(data, off + 42);
    const nameBytes = data.slice(off + 46, off + 46 + nlen);
    const extraRaw = data.slice(off + 46 + nlen, off + 46 + nlen + elen);
    // LFH：真实数据起点以本地头的名/扩展长度为准（可能与中央目录不同）
    if (u32le(data, lfhOff) !== 0x04034b50) throw new Error("本地文件头损坏（" + utf8Decode(nameBytes) + "）");
    const lnlen = u16le(data, lfhOff + 26), lelen = u16le(data, lfhOff + 28);
    const dataOff = lfhOff + 30 + lnlen + lelen;
    entries.push({
      nameRaw: nameBytes,
      name: (flags & 0x800) ? utf8Decode(nameBytes) : utf8Decode(nameBytes), // CTF 场景默认按 UTF-8；GBK 名另注
      flags, method, crc, csize, usize, lfhOff, extraRaw,
      lfhExtraRaw: data.slice(lfhOff + 30 + lnlen, dataOff),
      data: data.slice(dataOff, dataOff + csize),
    });
    off += 46 + nlen + elen + clen;
  }
  return { entries, eocd };
}
function findEocd(data) {
  const min = Math.max(0, data.length - 22 - 65535);
  for (let i = data.length - 22; i >= min; i--) {
    if (data[i] === 0x50 && data[i + 1] === 0x4b && data[i + 2] === 0x05 && data[i + 3] === 0x06) return i;
  }
  return -1;
}

// ---------- NTFS extra field（0x000A）读写 ----------
function readNtfsExtra(extraRaw) {
  const out = { times: null, streams: [], raw: null };
  let o = 0;
  while (o + 4 <= extraRaw.length) {
    const id = u16le(extraRaw, o), size = u16le(extraRaw, o + 2);
    const body = extraRaw.slice(o + 4, Math.min(o + 4 + size, extraRaw.length));
    if (id === 0x000A && body.length >= 4 && u16le(body, 0) === 0x0001) {
      out.raw = body;
      const p = 4; // tag(2)+size(2) 后：reserved(4)
      if (body.length >= p + 4 + 24) {
        out.times = {
          mtime: filetimeToIso(u32le(body, p + 4), u32le(body, p + 8)),
          atime: filetimeToIso(u32le(body, p + 12), u32le(body, p + 16)),
          ctime: filetimeToIso(u32le(body, p + 20), u32le(body, p + 24)),
        };
      }
      let q = p + 4 + 24;
      while (q + 4 <= body.length) {
        const nlen = u16le(body, q);
        if (q + 4 + nlen * 2 + 8 > body.length) break;
        const sname = utf16leDecode(body.slice(q + 2, q + 2 + nlen * 2));
        // u64 大小：低 32 位为主（CTF 载体不会超 4GB）
        const ssize = u32le(body, q + 2 + nlen * 2) + u32le(body, q + 2 + nlen * 2 + 4) * 0x100000000;
        out.streams.push({ name: sname, size: ssize });
        q += 4 + nlen * 2 + 8;
      }
    }
    o += 4 + size;
  }
  return out;
}
// 重建 NTFS extra（保留时间戳；streams 传 null 表示只留时间戳/删流配对，数组表示新配对）
function buildNtfsExtraBody(times, streams) {
  const body = [0x01, 0x00]; // tag 0x0001
  const payloadLen = 4 + 24 + (streams ? streams.reduce((n, s) => n + 4 + s.name.length * 2 + 8, 0) : 0);
  pushU16(body, payloadLen);
  body.push(0, 0, 0, 0); // reserved
  const t = times || { mtime: new Date().toISOString(), atime: null, ctime: null };
  for (const key of ["mtime", "atime", "ctime"]) {
    let ft = 0n;
    if (t[key]) {
      const ms = Date.parse(t[key].replace(" ", "T") + "Z") + 11644473600000;
      if (isFinite(ms)) ft = BigInt(Math.round(ms)) * 10000n;
    }
    const lo = Number(ft & 0xFFFFFFFFn), hi = Number((ft >> 32n) & 0xFFFFFFFFn);
    pushU32(body, lo); pushU32(body, hi);
  }
  if (streams) {
    for (const s of streams) {
      pushU16(body, s.name.length);
      const nb = utf16leEncode(s.name);
      for (const b of nb) body.push(b);
      const sz = BigInt(s.size || 0);
      pushU32(body, Number(sz & 0xFFFFFFFFn)); pushU32(body, Number((sz >> 32n) & 0xFFFFFFFFn));
    }
  }
  return new Uint8Array(body); // 这是 0x000A 的 body（不含 id/size 头）
}
function wrapExtra(id, bodyArr) {
  const head = new Uint8Array(4);
  setU16(head, 0, id); setU16(head, 2, bodyArr.length);
  const out = new Uint8Array(4 + bodyArr.length);
  out.set(head, 0); out.set(bodyArr, 4);
  return out;
}
// 把 extraRaw 中的 0x000A 替换/注入为 newNtfs，其余字段原样保留
function patchNtfsExtra(extraRaw, newNtfsBody) {
  const kept = [];
  let o = 0;
  while (o + 4 <= extraRaw.length) {
    const id = u16le(extraRaw, o), size = u16le(extraRaw, o + 2);
    if (id !== 0x000A) kept.push(extraRaw.slice(o, Math.min(o + 4 + size, extraRaw.length)));
    o += 4 + size;
  }
  const parts = [wrapExtra(0x000A, newNtfsBody), ...kept];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let w = 0;
  for (const p of parts) { out.set(p, w); w += p.length; }
  return out;
}

// ---------- 识别流条目（Info-ZIP 口径：条目名形如「宿主:流名」） ----------
// 排除盘符形态（"C:" 开头单字母+冒号）与 URL 形态
function adsEntryOf(name) {
  const idx = name.indexOf(":");
  if (idx <= 0) return null;
  const host = name.slice(0, idx), stream = name.slice(idx + 1);
  if (!host || !stream) return null;
  if (/^[A-Za-z]$/.test(host) && !stream.includes(":")) return null; // 盘符路径
  if (/^[a-z]+:\/\//i.test(name)) return null; // URL
  return { host, stream, full: name };
}

// ---------- ZIP 重写（保留原压缩数据，只重排头/目录） ----------
function rebuildZip(entries) {
  const parts = [];
  const central = [];
  for (const e of entries) {
    const lfhOff = parts.reduce((n, p) => n + p.length, 0);
    const lfh = new Uint8Array(30 + e.nameRaw.length + e.lfhExtraRaw.length);
    setU32(lfh, 0, 0x04034b50);
    setU16(lfh, 4, 20); setU16(lfh, 6, e.flags);
    setU16(lfh, 8, e.method);
    const time = u16le(e.rawTime || new Uint8Array(2), 0) || 0; // 时间字段原样保留（见下）
    setU16(lfh, 10, e.time != null ? e.time : time);
    setU16(lfh, 12, e.date != null ? e.date : 0);
    setU32(lfh, 14, e.crc);
    setU32(lfh, 18, e.csize); setU32(lfh, 22, e.usize);
    setU16(lfh, 26, e.nameRaw.length); setU16(lfh, 28, e.lfhExtraRaw.length);
    lfh.set(e.nameRaw, 30); lfh.set(e.lfhExtraRaw, 30 + e.nameRaw.length);
    parts.push(lfh, e.data);
    const cd = new Uint8Array(46 + e.nameRaw.length + e.extraRaw.length);
    setU32(cd, 0, 0x02014b50);
    setU16(cd, 4, 20); setU16(cd, 6, 20); setU16(cd, 8, e.flags);
    setU16(cd, 10, e.method);
    setU16(cd, 12, e.time != null ? e.time : 0); setU16(cd, 14, e.date != null ? e.date : 0);
    setU32(cd, 16, e.crc); setU32(cd, 20, e.csize); setU32(cd, 24, e.usize);
    setU16(cd, 28, e.nameRaw.length); setU16(cd, 30, e.extraRaw.length); setU16(cd, 32, 0);
    setU32(cd, 42, lfhOff);
    cd.set(e.nameRaw, 46); cd.set(e.extraRaw, 46 + e.nameRaw.length);
    central.push(cd);
  }
  const cdOff = parts.reduce((n, p) => n + p.length, 0);
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  parts.push(...central);
  const eocd = new Uint8Array(22);
  setU32(eocd, 0, 0x06054b50);
  setU16(eocd, 8, entries.length); setU16(eocd, 10, entries.length);
  setU32(eocd, 12, cdSize); setU32(eocd, 16, cdOff);
  parts.push(eocd);
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let w = 0;
  for (const p of parts) { out.set(p, w); w += p.length; }
  return out;
}
// 从原 LFH 抢救 DOS 时间字段（重写时保持原值）
function grabDosTime(data, lfhOff) {
  return { time: u16le(data, lfhOff + 10), date: u16le(data, lfhOff + 12) };
}

// ---------- 主 op ----------
register({
  id: "adsTool",
  cat: "forensic",
  name: "NTFS ADS 备用数据流",
  desc: "检测/提取/删除/添加 ZIP 内嵌的 NTFS 备用数据流（ADS）。Windows 右键压缩会把 ADS 连同 NTFS 扩展字段一起打进 ZIP——「file.txt:secret」类 CTF 题的载体。纯 JS 实现替代原 ntfsstreams GUI exe。注意：浏览器拿不到主机文件系统上文件的真实 ADS，本工具作用于 ZIP 载体。",
  noAuto: true,
  params: [
    { key: "mode", label: "模式", type: "select", default: "scan", options: [
      { value: "scan", label: "检测（列出全部 ADS）" },
      { value: "extract", label: "提取指定流" },
      { value: "delete", label: "删除指定流（或全部）" },
      { value: "add", label: "添加新流" },
    ] },
    { key: "streamName", label: "流（宿主:流名）", type: "text", default: "", placeholder: "如 file.txt:secret；删除模式可填 * 表示全部" },
    { key: "payload", label: "新流内容（添加模式）", type: "textarea", default: "", placeholder: "要藏进新流的文本（添加模式）" },
  ],
  acceptsBytes: true,
  run: async (text, p) => {
    const data = (p && p.rawBytes && p.rawBytes.length) ? p.rawBytes : b64ToBytes(text || "");
    const mode = (p && p.mode) || "scan";
    const { entries } = parseZip(data);

    // 汇总 ADS：extra 字段配对 + 流条目名两种来源合并去重
    const found = []; // {host, stream, size, src, entryIdx}
    const seen = new Set();
    entries.forEach((e, i) => {
      const nt = readNtfsExtra(e.extraRaw);
      for (const s of nt.streams) {
        const k = e.name + ":" + s.name;
        if (!seen.has(k)) { seen.add(k); found.push({ host: e.name, stream: s.name, size: s.size, src: "NTFS 扩展字段", entryIdx: i, times: nt.times }); }
      }
      const ads = adsEntryOf(e.name);
      if (ads) {
        const k = ads.host + ":" + ads.stream;
        if (!seen.has(k)) { seen.add(k); found.push({ host: ads.host, stream: ads.stream, size: e.usize, src: "流条目", entryIdx: i }); }
      }
    });
    const lines = found.map((f, i) =>
      `${i + 1}. ${f.host}:${f.stream}  ${f.size}B  来源=${f.src}` +
      (f.times && f.times.mtime ? `  修改=${f.times.mtime}` : ""));

    if (mode === "scan") {
      if (!lines.length) {
        // 顺带给包结构速览（无 ADS 也不白跑）
        const brief = entries.map((e) => `  - ${e.name}  ${e.usize}B  method=${e.method}`).join("\n");
        return `未检测到 ADS（包内 ${entries.length} 个条目均无 NTFS 扩展字段流配对、也无「宿主:流名」条目）。\n\n条目速览：\n${brief}\n\n提示：ADS 藏数据的 ZIP 通常由 Windows 资源管理器或 Info-ZIP 系工具打包。`;
      }
      return `检测到 ${found.length} 个 ADS：\n${lines.join("\n")}\n\n操作：提取/删除填「宿主:流名」（可从上面复制）；添加模式填新流名并在内容框写数据。`;
    }

    if (mode === "extract") {
      const want = (p.streamName || "").trim();
      if (!want) throw new Error("提取模式需填「宿主:流名」");
      const hit = found.find((f) => `${f.host}:${f.stream}` === want);
      if (!hit) throw new Error("未找到该流。现有：" + (lines.join("；") || "无"));
      // 优先流条目本体；否则宿主的 NTFS 配对只声明了名字（数据在流条目，缺条目=载体异常）
      const streamEntry = entries[hit.entryIdx] && adsEntryOf(entries[hit.entryIdx].name)
        && entries[hit.entryIdx].name === want ? entries[hit.entryIdx] : null;
      const byName = entries.find((e) => e.name === want);
      const src = streamEntry || byName;
      if (!src) throw new Error(`该流只在宿主「${hit.host}」的 NTFS 扩展字段里声明了名字，但包内没有数据条目「${want}」——打包时数据未随流写入（或被剥离）。`);
      let bytes;
      if (src.method === 0) bytes = src.data;
      else if (src.method === 8) bytes = inflateRaw(src.data);
      else throw new Error("不支持的压缩方法 method=" + src.method + "（仅支持 stored/deflate）");
      if (bytes.length !== src.usize) bytes = bytes.slice(0, src.usize);
      const head = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, 64)).replace(/[^\x20-\x7e\u4e00-\u9fa5]/g, "·");
      const outName = want.replace(/[:\\\/]/g, "_") + ".bin";
      return {
        text: `已提取 ${want}（${bytes.length}B）\n预览（前 64B 文本视图）：${head}${bytes.length > 64 ? "…" : ""}\n完整字节见下载。`,
        files: [{ name: outName, mime: "application/octet-stream", bytes }],
      };
    }

    if (mode === "delete") {
      const want = (p.streamName || "").trim();
      if (!want) throw new Error("删除模式需填「宿主:流名」，或填 * 删除全部");
      const dropAll = want === "*";
      const victims = found.filter((f) => dropAll || `${f.host}:${f.stream}` === want);
      if (!victims.length) throw new Error("未找到要删的流。现有：" + (lines.join("；") || "无"));
      const dropIdx = new Set(victims.map((v) => v.entryIdx).filter((i) => adsEntryOf(entries[i].name))); // 只删流条目
      const hostIdxs = new Set(victims.filter((v) => v.src === "NTFS 扩展字段").map((v) => v.entryIdx));
      const kept = [];
      entries.forEach((e, i) => {
        if (dropIdx.has(i)) return; // 流条目整条剔除
        if (hostIdxs.has(i)) {
          // 宿主：重写 NTFS extra，剔除被删流的配对（时间戳保留）
          const nt = readNtfsExtra(e.extraRaw);
          const left = nt.streams.filter((s) => !victims.some((v) => v.host === e.name && v.stream === s.name && v.src === "NTFS 扩展字段"));
          const newExtra = patchNtfsExtra(e.extraRaw, buildNtfsExtraBody(nt.times, left.length ? left : null));
          const dos = grabDosTime(data, e.lfhOff);
          kept.push({ ...e, extraRaw: newExtra, ...dos });
        } else {
          kept.push({ ...e, ...grabDosTime(data, e.lfhOff) });
        }
      });
      const outZip = rebuildZip(kept);
      return {
        text: `已删除 ${victims.length} 个 ADS（${victims.map((v) => `${v.host}:${v.stream}`).join("、")}），包内其余 ${kept.length} 个条目原样保留（压缩数据未重压）。\n清理后的 ZIP 见下载。`,
        files: [{ name: "ads_cleaned.zip", mime: "application/zip", bytes: outZip }],
      };
    }

    if (mode === "add") {
      const want = (p.streamName || "").trim();
      const payloadText = (p.payload != null ? String(p.payload) : "");
      if (!want || !want.includes(":")) throw new Error("添加模式需填「宿主:流名」（宿主须是包内已有条目名）");
      if (!payloadText) throw new Error("请在「新流内容」填写要藏入的数据");
      const ads = adsEntryOf(want);
      if (!ads) throw new Error("流名形如 宿主:流名（如 file.txt:secret），且不能是盘符/URL 形态");
      const host = entries.find((e) => e.name === ads.host);
      if (!host) throw new Error(`宿主条目「${ads.host}」不在包内。现有：` + entries.map((e) => e.name).join("、"));
      if (seen.has(want)) throw new Error(`流「${want}」已存在——删除后可重加，或换名。`);
      const bytes = new TextEncoder().encode(payloadText);
      // ① 宿主 extra：追加流配对（原时间戳保留）
      const nt = readNtfsExtra(host.extraRaw);
      const newStreams = [...nt.streams, { name: ads.stream, size: bytes.length }];
      const newHostExtra = patchNtfsExtra(host.extraRaw, buildNtfsExtraBody(nt.times, newStreams));
      // ② 新流条目：stored，UTF-8 名，自身 NTFS extra 也声明（Info-ZIP 口径双写）
      const nowIso = new Date().toISOString().slice(0, 19);
      const streamExtra = wrapExtra(0x000A, buildNtfsExtraBody({ mtime: nowIso, atime: nowIso, ctime: nowIso }, []));
      const nameRaw = utf8EncodeSafe(want);
      const dos = grabDosTime(data, host.lfhOff);
      const streamEntry = {
        nameRaw, name: want, flags: 0x800, method: 0,
        crc: crc32(bytes), csize: bytes.length, usize: bytes.length,
        extraRaw: streamExtra, lfhExtraRaw: streamExtra.slice(), data: bytes,
        time: dos.time, date: dos.date,
      };
      const kept = entries.map((e) => (e === host
        ? { ...e, extraRaw: newHostExtra, ...grabDosTime(data, e.lfhOff) }
        : { ...e, ...grabDosTime(data, e.lfhOff) }));
      kept.push(streamEntry);
      const outZip = rebuildZip(kept);
      return {
        text: `已添加流 ${want}（${bytes.length}B，stored）——宿主「${ads.host}」的 NTFS 扩展字段已写入配对，流条目已随包写入。\n新 ZIP 见下载；用本工具检测模式可回读验证。`,
        files: [{ name: "ads_added.zip", mime: "application/zip", bytes: outZip }],
      };
    }

    throw new Error("未知模式：" + mode);
  },
});

function utf8EncodeSafe(s) { return new TextEncoder().encode(s); }
