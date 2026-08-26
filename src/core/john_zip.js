/*
 * john_zip.js — ZIP 加密头 → John/hashcat hash 串提取（T288，cat:'forensic'，单向 run）。
 *
 * 用途：CTF 取证里拿到加密 ZIP，想用 John the Ripper / hashcat 离线爆破密码。
 * 本 op 只提取 hash 串（不爆破），输出可直接喂给 john/hashcat 的格式。
 *
 * 支持两种加密：
 * 1. ZipCrypto（传统 PKWARE 加密，flag bit0=1 且 method≠99）
 * → 输出 $pkzip2$ 格式（hashcat mode 17200-17230）
 * 2. WinZip AES（method=99，extra field 0x9901）
 * → 输出 $zip2$ 格式（hashcat mode 13600）
 *
 * 格式定义（照 john 源码 src/zip2john.c 注释，逐字对照）：
 *
 * $pkzip2$C*B*[DT*MT{CL*UL*CR*OF*OX}*CT*DL*CS*TC*DA]*$/pkzip2$
 * C hash 数量（1-8）
 * B CS 有效字节数（version<2.0 → 2，否则 1）
 * DT Data Type（1=partial, 2=full inline）
 * MT Magic Type（总是 0）
 * CL 压缩长度（含 12 字节加密头） [DT!=1 时]
 * UL 未压缩长度 [DT!=1 时]
 * CR CRC32 [DT!=1 时]
 * OF PK\x03\x04 记录偏移 [DT!=1 时，DT=2 时为 0]
 * OX 数据在文件内的额外偏移 [DT!=1 时]
 * CT 压缩类型（0=stored, 8=deflated）
 * DL DA 数据长度
 * CS 2 字节校验和（CRC 高位字）
 * TC 2 字节时间戳校验和（lastmodTime）
 * DA 数据（hex）
 *
 * $zip2$*Ty*Mo*Ma*Sa*Va*Le*DF*Au*$/zip2$
 * Ty type（0，忽略）
 * Mo mode（1/2/3 = AES-128/192/256）
 * Ma magic（0）
 * Sa salt（hex，8/12/16 字节）
 * Va 验证字节（hex，2 字节）
 * Le 压缩数据长度
 * DF 压缩数据（hex）
 * Au 认证码（hex，10 字节 HMAC-SHA1）
 *
 * 红线：只建本文件，件内自注册，不碰任何现有文件。零外发纯 JS 计算。
 * 只提取 hash 串，绝不爆破密码。
 */
import { register } from "./registry.js";

// ---- 小端整数读取 ----
function u16le(b, i) { return (b[i] | (b[i + 1] << 8)) >>> 0; }
function u32le(b, i) { return ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0; }

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

// ---- 输入 → 字节（hex / base64 / auto） ----
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
function inputToBytes(text, enc) {
  const raw = String(text);
  const s = raw.trim().replace(/\s+/g, "");
  if (enc === "hex") { if (!isHex(s)) throw new Error("输入不是合法 hex"); return hexToBytes(s); }
  if (enc === "base64") { try { return b64ToBytes(s); } catch { throw new Error("输入不是合法 base64"); } }
 // auto
  if (isHex(s)) return hexToBytes(s);
  if (isB64(s)) { try { return b64ToBytes(s); } catch { /* fall */ } }
 // 原始二进制字符串（拖入文件时前端给 latin1 串）
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
// AES extra field (0x9901) 解析
// ============================================================
function parseAesExtra(bytes, extraStart, extraLen) {
  let pos = extraStart;
  const end = extraStart + extraLen;
  while (pos + 4 <= end) {
    const id = u16le(bytes, pos);
    const sz = u16le(bytes, pos + 2);
    pos += 4;
    if (pos + sz > end) break;
    if (id === 0x9901 && sz === 7) {
      return {
        vendorVersion: u16le(bytes, pos),
        vendorId: u16le(bytes, pos + 2),
        strength: bytes[pos + 4],       // 1=128, 2=192, 3=256
        cmptype: u16le(bytes, pos + 5), // 实际压缩方法
      };
    }
    pos += sz;
  }
  return null;
}

// ============================================================
// ZIP 结构解析（LFH / CDH / EOCD）
// ============================================================
const LFH_SIG = [0x50, 0x4B, 0x03, 0x04];
const CDH_SIG = [0x50, 0x4B, 0x01, 0x02];
const EOCD_SIG = [0x50, 0x4B, 0x05, 0x06];
const MAX_ENTRIES = 8; // john MAX_PKZ_FILES

/**
 * 解析 ZIP 结构，返回 LFH / CDH / EOCD 列表。
 */
function parseZipStructure(bytes) {
  const lfhs = [];
  const cdhs = [];
  let eocdOffset = -1;

  for (let i = 0; i + 4 <= bytes.length; i++) {
    if (bytes[i] === LFH_SIG[0] && bytes[i+1] === LFH_SIG[1] &&
        bytes[i+2] === LFH_SIG[2] && bytes[i+3] === LFH_SIG[3]) {
      if (i + 30 > bytes.length) break;
      const nameLen = u16le(bytes, i + 26);
      const extraLen = u16le(bytes, i + 28);
      let name = "";
      const nameStart = i + 30;
      for (let k = 0; k < nameLen && nameStart + k < bytes.length; k++) {
        name += String.fromCharCode(bytes[nameStart + k]);
      }
      lfhs.push({
        offset: i,
        version: u16le(bytes, i + 4),
        flag: u16le(bytes, i + 6),
        method: u16le(bytes, i + 8),
        lastmodTime: u16le(bytes, i + 10),
        lastmodDate: u16le(bytes, i + 12),
        crc: u32le(bytes, i + 14),
        compSize: u32le(bytes, i + 18),
        uncompSize: u32le(bytes, i + 22),
        nameLen,
        extraLen,
        dataOffset: i + 30 + nameLen + extraLen,
        name,
      });
    } else if (bytes[i] === CDH_SIG[0] && bytes[i+1] === CDH_SIG[1] &&
               bytes[i+2] === CDH_SIG[2] && bytes[i+3] === CDH_SIG[3]) {
      if (i + 46 > bytes.length) break;
      const nameLen = u16le(bytes, i + 28);
      const extraLen = u16le(bytes, i + 30);
      const commentLen = u16le(bytes, i + 32);
      let name = "";
      const nameStart = i + 46;
      for (let k = 0; k < nameLen && nameStart + k < bytes.length; k++) {
        name += String.fromCharCode(bytes[nameStart + k]);
      }
      cdhs.push({
        offset: i,
        versionMadeBy: u16le(bytes, i + 4),
        versionNeeded: u16le(bytes, i + 6),
        flag: u16le(bytes, i + 8),
        method: u16le(bytes, i + 10),
        lastmodTime: u16le(bytes, i + 12),
        lastmodDate: u16le(bytes, i + 14),
        crc: u32le(bytes, i + 16),
        compSize: u32le(bytes, i + 20),
        uncompSize: u32le(bytes, i + 24),
        nameLen, extraLen, commentLen,
        name,
      });
    } else if (bytes[i] === EOCD_SIG[0] && bytes[i+1] === EOCD_SIG[1] &&
               bytes[i+2] === EOCD_SIG[2] && bytes[i+3] === EOCD_SIG[3]) {
      eocdOffset = i;
    }
  }

  return { lfhs, cdhs, eocdOffset };
}

/**
 * 扫 ZIP，找所有加密条目（ZipCrypto 或 WinZip AES）。
 */
function scanEncryptedEntries(bytes) {
  const { lfhs } = parseZipStructure(bytes);
  const entries = [];
  const errors = [];
  let aesCount = 0;
  let cryptoCount = 0;

  for (const lh of lfhs) {
    if (entries.length >= MAX_ENTRIES) break;
    const encrypted = (lh.flag & 1) === 1;
    if (!encrypted) continue;

    let isAes = false;
    let aesInfo = null;
    if (lh.method === 99) {
      aesInfo = parseAesExtra(bytes, lh.offset + 30 + lh.nameLen, lh.extraLen);
      if (!aesInfo) {
        errors.push(`条目 "${lh.name}": method=99 但无 AES extra field，跳过`);
        continue;
      }
      isAes = true;
      aesCount++;
    } else {
      cryptoCount++;
    }

    entries.push({ ...lh, isAes, aes: aesInfo });
  }

  return { entries, errors, aesCount, cryptoCount };
}

// ============================================================
// 构建 $pkzip2$ hash 串（传统 ZipCrypto）
// ============================================================
function buildPkzip2Hash(bytes, entries, maxDataLen = 200) {
 // B: version < 2.0 → 2, 否则 1
  let b = 1;
  for (const e of entries) {
    if (e.version < 20) { b = 2; break; }
  }

  const lines = [];
  for (const e of entries) {
    if (e.isAes) continue;
    const encHeaderLen = 12;

 // DT: 数据小则 full inline(2)，大则 partial(1)
    let dt, dl, da;
    if (e.compSize <= maxDataLen && e.compSize > 0 &&
        e.dataOffset + e.compSize <= bytes.length) {
 // full inline
      dt = 2;
      dl = e.compSize;
      da = toHex(bytes, e.dataOffset, e.dataOffset + e.compSize);
    } else {
 // partial: 12 加密头 + (maxDataLen-12) 字节数据，或全取（如果数据不足）
      dt = 1;
      const avail = Math.min(maxDataLen, bytes.length - e.dataOffset);
      if (avail < encHeaderLen) continue;
      dl = avail;
      da = toHex(bytes, e.dataOffset, e.dataOffset + avail);
    }

 // CS: CRC 高 2 字节（大端 hex）
    const cs = ((e.crc >>> 24) & 0xFF).toString(16).padStart(2, "0") +
               ((e.crc >>> 16) & 0xFF).toString(16).padStart(2, "0");
 // TC: lastmodTime 2 字节（大端 hex）
    const tc = ((e.lastmodTime >>> 8) & 0xFF).toString(16).padStart(2, "0") +
               (e.lastmodTime & 0xFF).toString(16).padStart(2, "0");

    const ct = e.method;
    const n2h = (n) => n.toString(16);

    let body;
    if (dt === 2) {
 // DT*MT*CL*UL*CR*OF*OX*CT*DL*CS*TC*DA（OF=0，inline 不需要偏移）
 // john 格式：所有数值字段用 hex（CS/TC/DA 本身已是 hex 串）
      body = [n2h(dt), n2h(0),
        n2h(e.compSize), n2h(e.uncompSize), n2h(e.crc), n2h(0),
        n2h(30 + e.nameLen + e.extraLen),
        n2h(ct), n2h(dl), cs, tc, da,
      ].join("*");
    } else {
 // DT*MT*CT*DL*CS*TC*DA（partial 不含 CL/UL/CR/OF/OX）
      body = [n2h(dt), n2h(0),
        n2h(ct), n2h(dl), cs, tc, da,
      ].join("*");
    }

 // john 输出格式：filename:$pkzip2$C*B*body$/pkzip2$:filename:::
 // 注：body 末尾不含 *，DA 后直接接 $/pkzip2$（避免 split 产生空尾字段）
    lines.push(`${e.name}:$pkzip2$${1}*${b}*${body}$/pkzip2$:${e.name}:::`);
  }

  return lines.length > 0 ? lines.join("\n") : null;
}

// ============================================================
// 构建 $zip2$ hash 串（WinZip AES）
// ============================================================
function buildZip2Hash(bytes, entries, maxDataLen = 200) {
  const lines = [];
  for (const e of entries) {
    if (!e.isAes) continue;
    const aes = e.aes;
    const saltLen = 4 + 4 * aes.strength; // 128→8, 192→12, 256→16
    const verifyLen = 2;
    const authLen = 10;
    const encDataLen = e.compSize - saltLen - verifyLen - authLen;

    if (e.dataOffset + saltLen + verifyLen > bytes.length) {
      lines.push(`# 条目 "${e.name}": AES 数据不足，跳过`);
      continue;
    }

    const salt = toHex(bytes, e.dataOffset, e.dataOffset + saltLen);
    const verify = toHex(bytes, e.dataOffset + saltLen, e.dataOffset + saltLen + verifyLen);

 // 认证码（末尾 10 字节）
    let auth = "00000000000000000000";
    if (e.dataOffset + e.compSize <= bytes.length && encDataLen >= 0) {
      const authStart = e.dataOffset + saltLen + verifyLen + encDataLen;
      if (authStart + authLen <= bytes.length) {
        auth = toHex(bytes, authStart, authStart + authLen);
      }
    }

 // 压缩数据（DF）
    let df, le;
    const dataContentStart = e.dataOffset + saltLen + verifyLen;
    if (encDataLen >= 0 && encDataLen <= maxDataLen &&
        dataContentStart + encDataLen <= bytes.length) {
      df = toHex(bytes, dataContentStart, dataContentStart + encDataLen);
      le = encDataLen;
    } else if (encDataLen > maxDataLen) {
      const take = Math.min(maxDataLen, bytes.length - dataContentStart);
      df = toHex(bytes, dataContentStart, dataContentStart + take);
      le = take;
    } else {
      df = "";
      le = 0;
    }

    const hash = `$zip2$*0*${aes.strength}*0*${salt}*${verify}*${le.toString(16)}*${df}*${auth}*$/zip2$`;
    lines.push(`${e.name}:${hash}`);
  }
  return lines.length > 0 ? lines.join("\n") : null;
}

// ============================================================
// 主函数：提取 hash
// ============================================================
function extractZipHash(zipBytes, maxDataLen = 200) {
  const { entries, errors, aesCount, cryptoCount } = scanEncryptedEntries(zipBytes);

  const hashes = [];
  const aesEntries = entries.filter((e) => e.isAes);
  const cryptoEntries = entries.filter((e) => !e.isAes);

  if (cryptoEntries.length > 0) {
    const h = buildPkzip2Hash(zipBytes, cryptoEntries, maxDataLen);
    if (h) hashes.push(h);
  }
  if (aesEntries.length > 0) {
    const h = buildZip2Hash(zipBytes, aesEntries, maxDataLen);
    if (h) hashes.push(h);
  }

  return { hashes, entryCount: entries.length, aesCount, cryptoCount, errors };
}

/**
 * op run 函数：提取 ZIP hash 串。
 * @param {string} text 输入文本（hex/base64/原始字节）
 * @param {object} p { inputEnc: "hex"|"base64"|"auto", maxDataLen: number }
 */
function zip2johnRun(text, p = {}) {
  const enc = p.inputEnc || "auto";
  const maxDataLen = parseInt(p.maxDataLen, 10) || 200;

  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) return "（空输入）";
  let zipBytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
    zipBytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, enc);
  } catch (e) {
    return "输入解析失败：" + (e && e.message ? e.message : String(e));
  }
  if (zipBytes.length < 30) return "（输入过短）不足一个 ZIP 本地文件头。";

  const { hashes, entryCount, aesCount, cryptoCount, errors } = extractZipHash(zipBytes, maxDataLen);

  const lines = [];
  lines.push("=== ZIP hash 提取（zip2john 格式）===");
  const parts = [];
  if (cryptoCount > 0) parts.push(`ZipCrypto: ${cryptoCount}`);
  if (aesCount > 0) parts.push(`WinZip AES: ${aesCount}`);
  lines.push(`扫描结果: ${entryCount} 条哈希（${parts.join(", ")}）`);
  if (errors.length > 0) lines.push("警告: " + errors.join("; "));
  lines.push("");

  if (hashes.length === 0) {
    lines.push("未找到 ZipCrypto 加密条目。");
    lines.push("提示: 确认输入为含加密条目的 ZIP。伪加密（只设 GPBF 位无真加密）不会产生有效 hash。");
    return lines.join("\n");
  }

  for (const h of hashes) {
    lines.push(h);
  }
  lines.push("");
  lines.push("--- 使用方法 ---");
  if (cryptoCount > 0) {
    lines.push("ZipCrypto ($pkzip2$): hashcat -m 17210 hash.txt wordlist  (或 17200/17220/17225/17230)");
    lines.push("                      john --wordlist=wordlist hash.txt");
  }
  if (aesCount > 0) {
    lines.push("WinZip AES ($zip2$): hashcat -m 13600 hash.txt wordlist");
    lines.push("                     john --wordlist=wordlist hash.txt");
  }
  return lines.join("\n");
}

// ============================================================
// 注册 op
// ============================================================
register({
  id: "zip2john",
  cat: "forensic",
  name: "ZIP 哈希提取（zip2john）",
  desc: "从加密 ZIP 提取 John/hashcat 格式 hash 串（只提取不爆破）。ZipCrypto→$pkzip2$ 格式(hashcat 17200-17230)；WinZip AES→$zip2$ 格式(hashcat 13600)。输出可直接喂 john/hashcat 离线爆破",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex（十六进制）" },
      { value: "base64", label: "Base64" },
      { value: "auto", label: "自动识别" },
    ] },
    { key: "maxDataLen", label: "单条 hash 内联数据上限（字节，默认 200）", type: "number", default: 200 },
  ],
  run: zip2johnRun,
  acceptsBytes: true,
});

// 导出纯函数供测试
export {
  zip2johnRun, extractZipHash, buildPkzip2Hash, buildZip2Hash,
  scanEncryptedEntries, parseZipStructure, parseAesExtra,
  inputToBytes, u16le, u32le, toHex,
};
