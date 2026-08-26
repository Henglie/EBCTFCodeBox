/*
 * john_office.js — Office 加密文件 → John/hashcat hash 串提取（T291，cat:'forensic'，单向 run）。
 *
 * 用途：CTF 取证里拿到加密 Office 文档（.doc/.docx/.xls/.xlsx/.ppt/.pptx）
 * 想用 John the Ripper / hashcat 离线爆破密码。本 op 只提取 hash 串（不爆破）
 * 输出可直接喂给 john/hashcat 的格式。
 *
 * 支持格式：
 * 1. Office 2007 (OOXML ECMA-376 1st ed, binary EncryptionInfo)
 * → $office$*2007*<hashSize>*<keyBits>*<saltSize>*<salt>*<encVerifier>*<encVerifierHash>
 * hashSize=20(SHA-1), keyBits=128(AES-128), saltSize=16
 * hashcat mode 9400
 * 2. Office 2010 (Agile, XML EncryptionInfo)
 * → $office$*2010*<spinCount>*<keyBits>*<saltSize>*<salt>*<encVerifier>*<encVerifierHash>
 * spinCount=100000, keyBits=128, saltSize=16, encVerifierHash=32B
 * hashcat mode 9500
 * 3. Office 2013 (Agile, XML EncryptionInfo)
 * → $office$*2013*<spinCount>*<keyBits>*<saltSize>*<salt>*<encVerifier>*<encVerifierHash>
 * spinCount=100000, keyBits=256, saltSize=16, encVerifierHash=32B
 * hashcat mode 9600
 * 4. Office 97-2003 (oldoffice, RC4)
 * → $oldoffice$<type>*<salt>*<encVerifier>*<encVerifierHash>
 * type 0/1: MD5+RC4, hashcat mode 9700; type 3/4: SHA1+RC4, hashcat mode 9800
 * （本 op 检测到旧版格式会报告，但不做完整 oldoffice 提取——结构太分散）
 *
 * 格式定义（照 john 官方 office2john + hashcat example_hashes 逐字对照）：
 * $office$*2007*20*128*16*salt*encrypted_verifier*encrypted_verifier_hash
 * $office$*2010*100000*128*16*salt*encrypted_verifier*encrypted_verifier_hash
 * $office$*2013*100000*256*16*salt*encrypted_verifier*encrypted_verifier_hash
 * $oldoffice$0*salt*encrypted_verifier*encrypted_verifier_hash
 * $oldoffice$1*salt*encrypted_verifier*encrypted_verifier_hash
 * $oldoffice$3*salt*encrypted_verifier*encrypted_verifier_hash
 * $oldoffice$4*salt*encrypted_verifier*encrypted_verifier_hash
 *
 * CFB (Compound File Binary) / OLE2 结构：
 * Header Signature: D0CF11E0A1B11AE1 (8 字节)
 * 后跟 CFB 头字段（扇区大小 2^sector_shift，512 或 4096）
 * FAT/MiniFAT/Directory 结构
 * EncryptionInfo 流在根目录下（Office 2007+）
 *
 * 红线：只建本文件，件内自注册，不碰任何现有文件。零外发纯 JS 计算。
 * 只提取 hash 串，绝不爆破密码。
 */
import { register } from "./registry.js";

// ---- 小端整数读取 ----
function u16le(b, i) { return (b[i] | (b[i + 1] << 8)) >>> 0; }
function u32le(b, i) {
  return ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0;
}

// ---- hex 编码 ----
function toHex(bytes, start, end) {
  let s = "";
  const e = end == null ? bytes.length : end;
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

// ---- base64 解码（Node 环境用 Buffer，浏览器用 atob） ----
function b64decode(s) {
  const clean = String(s).replace(/\s/g, "");
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(clean, "base64"));
  }
  return b64ToBytes(clean);
}

// ============================================================
// CFB (OLE2) 常量
// ============================================================
const CFB_MAGIC = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
const ENDOFCHAIN = 0xFFFFFFFE;
const FREESECT = 0xFFFFFFFF;
const FATSECT = 0xFFFFFFFD;
const DIFSECT = 0xFFFFFFFC;
const MINI_STREAM_CUTOFF_DEFAULT = 4096;
const MINI_SECTOR_SIZE = 64; // 2^6

/**
 * 检测 CFB magic（D0CF11E0A1B11AE1）。
 */
function isCfbMagic(bytes) {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) if (bytes[i] !== CFB_MAGIC[i]) return false;
  return true;
}

/**
 * 解析 CFB 头（前 512 字节）。
 * 返回 { sectorSize, miniSectorSize, firstDirSector, numFatSectors
 * miniStreamCutoff, firstMiniFatSector, numMiniFatSectors
 * firstDifatSector, numDifatSectors, difat[] } 或抛错。
 */
function parseCfbHeader(bytes) {
  if (!isCfbMagic(bytes)) throw new Error("不是 CFB/OLE2 文件（magic 不匹配）");
  if (bytes.length < 512) throw new Error("CFB 头不完整（< 512 字节）");

  const minorVersion = u16le(bytes, 0x18);
  const majorVersion = u16le(bytes, 0x1A);
  const byteOrder = u16le(bytes, 0x1C);     // 应为 0xFFFE
  const sectorShift = u16le(bytes, 0x1E);   // 9=512, 12=4096
  const miniSectorShift = u16le(bytes, 0x20); // 通常 6=64

  if (byteOrder !== 0xFFFE) throw new Error("CFB 字节序异常（期望 0xFFFE）");
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << miniSectorShift;

  const numDirSectors = u32le(bytes, 0x28);    // v4 才有，v3 = 0
  const numFatSectors = u32le(bytes, 0x2C);
  const firstDirSector = u32le(bytes, 0x30);
  const transactionSig = u32le(bytes, 0x34);
  const miniStreamCutoff = u32le(bytes, 0x38);
  const firstMiniFatSector = u32le(bytes, 0x3C);
  const numMiniFatSectors = u32le(bytes, 0x40);
  const firstDifatSector = u32le(bytes, 0x44);
  const numDifatSectors = u32le(bytes, 0x48);

 // DIFAT: 109 个条目，从 offset 0x4C 开始，每个 4 字节
  const difat = [];
  for (let i = 0; i < 109; i++) {
    const off = 0x4C + i * 4;
    const v = u32le(bytes, off);
    if (v !== FREESECT) difat.push(v);
  }

  return {
    majorVersion, minorVersion, sectorSize, miniSectorSize,
    numDirSectors, numFatSectors, firstDirSector,
    miniStreamCutoff: miniStreamCutoff || MINI_STREAM_CUTOFF_DEFAULT,
    firstMiniFatSector, numMiniFatSectors,
    firstDifatSector, numDifatSectors, difat,
  };
}

/**
 * 获取扇区 N 在文件中的字节偏移。
 * 扇区 0 从 offset sectorSize 开始（头本身占第一个 sectorSize 块）。
 */
function sectorOffset(sectorNum, sectorSize) {
  return (sectorNum + 1) * sectorSize;
}

/**
 * 读取 FAT（File Allocation Table）。
 * FAT 扇区列表由 DIFAT 给出。返回 Uint32Array。
 */
function readFat(bytes, header) {
  const { sectorSize, difat, numFatSectors } = header;
  const entriesPerSector = sectorSize / 4;
 // numFatSectors 取自文件头，攻击者可填巨值致 OOM。钳到文件实际能容纳的扇区数。
  const maxSectors = Math.ceil(bytes.length / sectorSize) + 1;
  const fatSectors = Math.min(Math.max(difat.length, numFatSectors), maxSectors);
  const totalEntries = entriesPerSector * fatSectors;
  const fat = new Uint32Array(totalEntries);

  for (let si = 0; si < difat.length; si++) {
    const secNum = difat[si];
    const off = sectorOffset(secNum, sectorSize);
    for (let e = 0; e < entriesPerSector; e++) {
      const idx = si * entriesPerSector + e;
      if (off + e * 4 + 4 <= bytes.length) {
        fat[idx] = u32le(bytes, off + e * 4);
      }
    }
  }
  return fat;
}

/**
 * 跟踪 FAT 链，返回扇区号数组。
 */
function followChain(fat, startSector) {
  const chain = [];
  let cur = startSector;
  const visited = new Set();
  while (cur !== ENDOFCHAIN && cur !== FREESECT && cur < fat.length) {
    if (visited.has(cur)) break; // 防环
    visited.add(cur);
    chain.push(cur);
    cur = fat[cur];
  }
  return chain;
}

/**
 * 从 FAT 链读取连续字节。
 */
function readStreamFromFat(bytes, fat, startSector, streamSize, sectorSize) {
  const chain = followChain(fat, startSector);
 // streamSize 取自目录项，攻击者可填巨值致 OOM。钳到文件长度（真实流不可能超过文件本身）。
  streamSize = Math.min(Math.max(0, streamSize | 0), bytes.length);
  const out = new Uint8Array(streamSize);
  let written = 0;
  for (const secNum of chain) {
    if (written >= streamSize) break;
    const off = sectorOffset(secNum, sectorSize);
    for (let i = 0; i < sectorSize && written < streamSize; i++) {
      if (off + i < bytes.length) out[written] = bytes[off + i];
      written++;
    }
  }
  return out;
}

/**
 * 读取 MiniFAT。
 */
function readMiniFat(bytes, header, fat) {
  const { sectorSize, firstMiniFatSector, numMiniFatSectors, miniSectorSize } = header;
  if (firstMiniFatSector === ENDOFCHAIN) return new Uint32Array(0);

  const entriesPerSector = sectorSize / 4;
  const chain = followChain(fat, firstMiniFatSector);
  const totalEntries = chain.length * entriesPerSector;
  const miniFat = new Uint32Array(totalEntries);

  let idx = 0;
  for (const secNum of chain) {
    const off = sectorOffset(secNum, sectorSize);
    for (let e = 0; e < entriesPerSector; e++) {
      if (off + e * 4 + 4 <= bytes.length) {
        miniFat[idx] = u32le(bytes, off + e * 4);
      }
      idx++;
    }
  }
  return miniFat;
}

/**
 * 从目录项中读取目录项数组。
 * 每个目录项 128 字节。
 */
function readDirectory(bytes, header, fat) {
  const { sectorSize, firstDirSector } = header;
  const chain = followChain(fat, firstDirSector);
  const entries = [];

  for (const secNum of chain) {
    const off = sectorOffset(secNum, sectorSize);
    const entriesPerSector = sectorSize / 128;
    for (let e = 0; e < entriesPerSector; e++) {
      const entryOff = off + e * 128;
      if (entryOff + 128 > bytes.length) break;
      const entry = parseDirEntry(bytes, entryOff);
      if (entry) entries.push(entry);
    }
  }
  return entries;
}

/**
 * 解析单个目录项（128 字节）。
 */
function parseDirEntry(bytes, off) {
  const nameSizeBytes = u16le(bytes, off + 0x40);
  if (nameSizeBytes === 0) return null;

 // 名称 UTF-16LE，最多 64 字节（32 字符）
  let name = "";
  const nameLen = Math.min(nameSizeBytes, 64) - 2; // 减去 null terminator
  for (let i = 0; i < nameLen; i += 2) {
    const code = u16le(bytes, off + i);
    if (code === 0) break;
    name += String.fromCharCode(code);
  }

  const objectType = bytes[off + 0x42];
  const colorFlag = bytes[off + 0x43];
  const leftSiblingId = u32le(bytes, off + 0x44);
  const rightSiblingId = u32le(bytes, off + 0x48);
  const childId = u32le(bytes, off + 0x4C);
 // CLSID 16 bytes at 0x50
 // StateBits 4 bytes at 0x60
 // CreationTime 8 bytes at 0x64
 // ModifiedTime 8 bytes at 0x6C
  const startingSector = u32le(bytes, off + 0x74);
  const streamSize = u32le(bytes, off + 0x78); // v3: 4 字节; v4: 8 字节（高 4 字节在 0x7C）

  return {
    name, objectType, colorFlag,
    leftSiblingId, rightSiblingId, childId,
    startingSector, streamSize,
    offset: off,
  };
}

/**
 * 读取 mini stream（根存储的流）。
 * mini stream 存储在 FAT 链中，由根目录项的 startingSector 指定。
 */
function readMiniStream(bytes, header, fat, rootEntry) {
  const { sectorSize } = header;
  if (!rootEntry || rootEntry.startingSector === ENDOFCHAIN) return new Uint8Array(0);
  return readStreamFromFat(bytes, fat, rootEntry.startingSector, rootEntry.streamSize, sectorSize);
}

/**
 * 从 mini stream 读取一个流。
 */
function readStreamFromMiniStream(miniStream, miniFat, startSector, streamSize) {
  const chain = followChain(miniFat, startSector);
  const out = new Uint8Array(streamSize);
  let written = 0;
  for (const secNum of chain) {
    if (written >= streamSize) break;
    const off = secNum * MINI_SECTOR_SIZE;
    for (let i = 0; i < MINI_SECTOR_SIZE && written < streamSize; i++) {
      if (off + i < miniStream.length) out[written] = miniStream[off + i];
      written++;
    }
  }
  return out;
}

/**
 * 读取指定目录项的流内容（自动选择 FAT 或 MiniFAT）。
 */
function readStream(bytes, header, fat, miniFat, miniStream, entry) {
  if (!entry) return null;
  const { sectorSize, miniStreamCutoff } = header;
  if (entry.streamSize < miniStreamCutoff) {
    return readStreamFromMiniStream(miniStream, miniFat, entry.startingSector, entry.streamSize);
  }
  return readStreamFromFat(bytes, fat, entry.startingSector, entry.streamSize, sectorSize);
}

/**
 * 在目录中查找名为 "EncryptionInfo" 的流。
 */
function findEncryptionInfoStream(entries) {
  return entries.find((e) =>
    e.name && e.name.toLowerCase() === "encryptioninfo" && e.objectType === 2
  );
}

// ============================================================
// EncryptionInfo 解析
// ============================================================

/**
 * 解析 EncryptionInfo 流。
 * 返回 { version, year, hash } 或 { version, year, error }。
 */
function parseEncryptionInfo(streamBytes) {
  if (streamBytes.length < 4) return { error: "EncryptionInfo 流过短" };

  const vMinor = u16le(streamBytes, 0);
  const vMajor = u16le(streamBytes, 2);

 // Office 2007: vMajor=3/4, vMinor=2 → binary format
  if ((vMajor === 3 || vMajor === 4) && vMinor === 2) {
    return parseEncryptionInfo2007(streamBytes);
  }
 // Office 2010: vMajor=4, vMinor=3 → Agile XML
  if (vMajor === 4 && vMinor === 3) {
    return parseEncryptionInfoAgile(streamBytes, 2010);
  }
 // Office 2013: vMajor=4, vMinor=4 → Agile XML
  if (vMajor === 4 && vMinor === 4) {
    return parseEncryptionInfoAgile(streamBytes, 2013);
  }
 // 旧版 Office (97-2003)
  if (vMajor === 2 && (vMinor === 0 || vMinor === 1)) {
    return { version: "oldoffice", year: null, note: "Office 97-2003 旧版加密（oldoffice），需 RC4 密码提取" };
  }
  return { error: `未知 EncryptionInfo 版本: vMajor=${vMajor} vMinor=${vMinor}` };
}

/**
 * 解析 Office 2007 二进制 EncryptionInfo。
 * 结构: Version(4) + EncryptionHeader(可变) + EncryptionVerifier(60)
 * EncryptionHeader: Flags(4)+SizeExtra(4)+AlgID(4)+AlgIDHash(4)+KeySize(4)+ProviderType(4)+Reserved1(4)+Reserved2(4)+ProviderName(UTF16LE null-term)
 * EncryptionVerifier: SaltSize(4)+Salt(16)+EncryptedVerifier(16)+VerifierHashSize(4)+EncryptedVerifierHash(20)
 */
function parseEncryptionInfo2007(streamBytes) {
  if (streamBytes.length < 36 + 60) {
    return { error: "2007 EncryptionInfo 流过短" };
  }

 // EncryptionHeader 固定部分: offset 4..35 (32 字节)
  const keyBits = u32le(streamBytes, 20); // KeySize at offset 4+16=20

 // ProviderName: UTF-16LE null-terminated，从 offset 36 开始
 // 扫描 null terminator（两个连续 0x00 在偶数偏移）
  let nameEnd = 36;
  while (nameEnd + 1 < streamBytes.length) {
    if (streamBytes[nameEnd] === 0 && streamBytes[nameEnd + 1] === 0) {
      nameEnd += 2; // 包含 null terminator
      break;
    }
    nameEnd += 2;
  }

 // 对齐到 4 字节边界
  while (nameEnd % 4 !== 0) nameEnd++;

 // EncryptionVerifier 从 nameEnd 开始
  const verOff = nameEnd;
  if (verOff + 60 > streamBytes.length) {
 // 回退: 扫描 SaltSize=16 模式
    return parseEncryptionInfo2007Scan(streamBytes, keyBits);
  }

  const saltSize = u32le(streamBytes, verOff);
  if (saltSize !== 16) {
    return parseEncryptionInfo2007Scan(streamBytes, keyBits);
  }

  const salt = toHex(streamBytes, verOff + 4, verOff + 4 + 16);
  const encVerifier = toHex(streamBytes, verOff + 20, verOff + 20 + 16);
  const verifierHashSize = u32le(streamBytes, verOff + 36);
  const encVerifierHash = toHex(streamBytes, verOff + 40, verOff + 40 + (verifierHashSize || 20));

  const hash = `$office$*2007*${verifierHashSize || 20}*${keyBits || 128}*16*${salt}*${encVerifier}*${encVerifierHash}`;
  return {
    version: "2007", year: 2007,
    hashSize: verifierHashSize || 20,
    keyBits: keyBits || 128,
    saltSize: 16,
    salt, encVerifier, encVerifierHash,
    hash,
  };
}

/**
 * 扫描模式回退：在 EncryptionInfo 流中搜索 SaltSize=16 模式。
 * 模式: 10 00 00 00 [16B salt] [16B verifier] 14 00 00 00 [20B hash]
 */
function parseEncryptionInfo2007Scan(streamBytes, keyBits) {
  for (let i = 4; i + 60 <= streamBytes.length; i++) {
    if (u32le(streamBytes, i) === 16 &&
        u32le(streamBytes, i + 36) === 20) {
 // 候选: 检查 keyBits 合理性
      const salt = toHex(streamBytes, i + 4, i + 4 + 16);
      const encVerifier = toHex(streamBytes, i + 20, i + 20 + 16);
      const encVerifierHash = toHex(streamBytes, i + 40, i + 40 + 20);
      const kb = keyBits || 128;
      const hash = `$office$*2007*20*${kb}*16*${salt}*${encVerifier}*${encVerifierHash}`;
      return {
        version: "2007", year: 2007,
        hashSize: 20, keyBits: kb, saltSize: 16,
        salt, encVerifier, encVerifierHash, hash,
        note: "通过模式扫描提取",
      };
    }
  }
  return { error: "2007 EncryptionInfo: 未找到 EncryptionVerifier 模式" };
}

/**
 * 解析 Office 2010/2013 Agile XML EncryptionInfo。
 * 结构: Version(4) + XML(UTF-8)
 */
function parseEncryptionInfoAgile(streamBytes, year) {
 // XML 内容从 offset 4 开始
  let xml = "";
  for (let i = 4; i < streamBytes.length; i++) {
    if (streamBytes[i] === 0) break;
    xml += String.fromCharCode(streamBytes[i]);
  }

  if (!xml || xml.length < 10) {
    return { error: `${year} EncryptionInfo XML 为空` };
  }

 // 从 p:encryptedKey 元素提取属性
  const encKeyMatch = xml.match(/<p:encryptedKey\b[^>]*>/i) ||
                      xml.match(/<encryptedKey\b[^>]*>/i);
  if (!encKeyMatch) {
    return { error: `${year} EncryptionInfo XML 中未找到 encryptedKey 元素` };
  }
  const encKeyTag = encKeyMatch[0];

  const getAttr = (tag, name) => {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, "i"));
    return m ? m[1] : null;
  };

  const spinCount = parseInt(getAttr(encKeyTag, "spinCount"), 10);
  const keyBits = parseInt(getAttr(encKeyTag, "keyBits"), 10);
  const saltSize = parseInt(getAttr(encKeyTag, "saltSize"), 10);
  const saltValueB64 = getAttr(encKeyTag, "saltValue");
 // Agile 加密 XML 的 password keyEncryptor 只有这两个密文属性（无 encryptedVerifierInput）：
 // encryptedVerifierHashInput → hashcat 的 encryptedVerifier（16B）
 // encryptedVerifierHashValue → hashcat 的 encryptedVerifierHash（2010:20B / 2013:32B）
  const encVerifierHashInputB64 = getAttr(encKeyTag, "encryptedVerifierHashInput");
  const encVerifierHashValueB64 = getAttr(encKeyTag, "encryptedVerifierHashValue");

  if (!saltValueB64 || !encVerifierHashInputB64 || !encVerifierHashValueB64) {
    return { error: `${year} XML 缺少 saltValue / encryptedVerifierHashInput / encryptedVerifierHashValue` };
  }

  const salt = toHex(b64decode(saltValueB64));
  const encVerifier = toHex(b64decode(encVerifierHashInputB64));
  let encVerifierHash = toHex(b64decode(encVerifierHashValueB64));
 // hashcat 2010/2013 格式固定 encryptedVerifierHash 32B（截断）
  if (encVerifierHash.length > 64) encVerifierHash = encVerifierHash.slice(0, 64);

  const kb = keyBits || (year === 2013 ? 256 : 128);
  const sc = spinCount || 100000;
  const ss = saltSize || 16;

  const hash = `$office$*${year}*${sc}*${kb}*${ss}*${salt}*${encVerifier}*${encVerifierHash}`;
  return {
    version: "agile", year,
    spinCount: sc, keyBits: kb, saltSize: ss,
    salt, encVerifier, encVerifierHash, hash,
  };
}

// ============================================================
// 主提取函数
// ============================================================

/**
 * 从 CFB 字节中提取 Office hash。
 * 返回 { hash, version, year, details } 或 { error }。
 */
function extractOfficeHash(bytes) {
  if (!isCfbMagic(bytes)) {
    return { error: "不是 CFB/OLE2 文件（magic D0CF11E0A1B11AE1 不匹配）" };
  }

  let header;
  try {
    header = parseCfbHeader(bytes);
  } catch (e) {
    return { error: "CFB 头解析失败: " + (e.message || e) };
  }

  const fat = readFat(bytes, header);
  const dirEntries = readDirectory(bytes, header, fat);

  if (dirEntries.length === 0) {
    return { error: "CFB 目录为空" };
  }

 // 根目录项通常是第一个（objectType=5）
  const rootEntry = dirEntries.find((e) => e.objectType === 5) || dirEntries[0];
  const miniFat = readMiniFat(bytes, header, fat);
  const miniStream = readMiniStream(bytes, header, fat, rootEntry);

 // 查找 EncryptionInfo 流
  const encInfoEntry = findEncryptionInfoStream(dirEntries);
  if (!encInfoEntry) {
 // 可能是旧版 Office（97-2003），没有 EncryptionInfo 流
    return {
      error: "未找到 EncryptionInfo 流",
      hint: "可能是旧版 Office (97-2003) 加密文件或非加密文件。旧版 Office 加密的 hash 提取需分析 WordDocument/Workbook 等流，结构分散暂不支持。",
      dirEntries: dirEntries.map((e) => ({ name: e.name, type: e.objectType, size: e.streamSize })),
    };
  }

  const streamBytes = readStream(bytes, header, fat, miniFat, miniStream, encInfoEntry);
  if (!streamBytes || streamBytes.length < 4) {
    return { error: "EncryptionInfo 流读取失败或过短" };
  }

  const result = parseEncryptionInfo(streamBytes);
  if (result.error) return { ...result, streamSize: streamBytes.length };
  return { ...result, streamSize: streamBytes.length };
}

/**
 * 回退：在原始字节中搜索 EncryptionInfo 模式。
 * 扫描版本号模式 + XML 模式。
 */
function scanRawBytes(bytes) {
  const findings = [];

 // 搜索版本号模式: 04 00 02 00 (2007), 04 00 03 00 (2010), 04 00 04 00 (2013)
  const versionPatterns = [
    { bytes: [0x02, 0x00, 0x04, 0x00], year: 2007, desc: "Office 2007 (vMajor=4, vMinor=2)" },
    { bytes: [0x02, 0x00, 0x03, 0x00], year: 2007, desc: "Office 2007 (vMajor=3, vMinor=2)" },
    { bytes: [0x03, 0x00, 0x04, 0x00], year: 2010, desc: "Office 2010 (vMajor=4, vMinor=3)" },
    { bytes: [0x04, 0x00, 0x04, 0x00], year: 2013, desc: "Office 2013 (vMajor=4, vMinor=4)" },
  ];

  for (let i = 0; i + 4 <= bytes.length; i++) {
    for (const pat of versionPatterns) {
      if (bytes[i] === pat.bytes[0] && bytes[i + 1] === pat.bytes[1] &&
          bytes[i + 2] === pat.bytes[2] && bytes[i + 3] === pat.bytes[3]) {
        findings.push({ offset: i, ...pat });
      }
    }
  }

 // 搜索 XML 模式
  const xmlPatterns = ["<encryption", "encryptedKey", "spinCount", "saltValue"];
  for (const pat of xmlPatterns) {
    const patBytes = new TextEncoder().encode(pat);
    for (let i = 0; i + patBytes.length <= bytes.length; i++) {
      let match = true;
      for (let j = 0; j < patBytes.length; j++) {
        if (bytes[i + j] !== patBytes[j]) { match = false; break; }
      }
      if (match) {
        findings.push({ offset: i, desc: `XML 模式: "${pat}"` });
      }
    }
  }

  return findings;
}

// ============================================================
// op run 函数
// ============================================================

/**
 * op run 函数：提取 Office 加密文件 hash 串。
 * @param {string} text 输入文本（hex/base64/原始字节）
 * @param {object} p { inputEnc: "hex"|"base64"|"auto" }
 */
function office2johnRun(text, p = {}) {
  const enc = p.inputEnc || "auto";

  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) return "（空输入）";
  let bytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
    bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, enc);
  } catch (e) {
    return "输入解析失败：" + (e && e.message ? e.message : String(e));
  }
  if (bytes.length < 8) return "（输入过短）不足一个 CFB 头。";

  const lines = [];
  lines.push("=== Office 哈希提取（office2john 格式）===");

 // 检查 CFB magic
  if (!isCfbMagic(bytes)) {
    lines.push("✗ 不是 CFB/OLE2 文件（magic D0CF11E0A1B11AE1 不匹配）");
    lines.push("提示: Office 加密文件应是 OLE2 容器。请确认输入为加密的 .doc/.docx/.xls/.xlsx/.ppt/.pptx。");
    lines.push("");
 // 尝试原始字节扫描
    const findings = scanRawBytes(bytes);
    if (findings.length > 0) {
      lines.push("--- 原始字节扫描发现 ---");
      for (const f of findings.slice(0, 10)) {
        lines.push(`  offset 0x${f.offset.toString(16)}: ${f.desc}`);
      }
    }
    return lines.join("\n");
  }

  lines.push("✓ 识别到 CFB/OLE2 容器 (magic D0CF11E0A1B11AE1)");
  lines.push("");

 // 尝试完整提取（内部解析/分配可能因损坏输入抛错，兜住不崩全站）
  let result;
  try {
    result = extractOfficeHash(bytes);
  } catch (e) {
    lines.push(`✗ 提取异常: ${e && e.message ? e.message : String(e)}`);
    lines.push("提示: 文件 CFB 结构可能损坏。可尝试用专用 office2john.py (Python) 提取。");
    return lines.join("\n");
  }

  if (result.error) {
    lines.push(`✗ 提取失败: ${result.error}`);
    if (result.hint) lines.push(`提示: ${result.hint}`);
    if (result.note) lines.push(`说明: ${result.note}`);
    lines.push("");

 // 回退: 原始字节扫描
    const findings = scanRawBytes(bytes);
    if (findings.length > 0) {
      lines.push("--- 原始字节模式扫描 ---");
      const seen = new Set();
      for (const f of findings.slice(0, 20)) {
        const key = f.desc;
        if (seen.has(key)) continue;
        seen.add(key);
        lines.push(`  offset 0x${f.offset.toString(16)}: ${f.desc}${f.year ? ` (year=${f.year})` : ""}`);
      }
      lines.push("");
      lines.push("建议: 文件确实是 Office 加密格式，但 CFB 结构解析未成功。");
      lines.push("      可尝试用专用 office2john.py (Python) 提取，或检查文件是否完整。");
    }
    return lines.join("\n");
  }

 // 旧版 Office 检测
  if (result.version === "oldoffice") {
    lines.push("检测到旧版 Office (97-2003) 加密格式。");
    lines.push("说明: " + (result.note || "oldoffice 格式，RC4 加密"));
    lines.push("");
    lines.push("oldoffice hash 格式（供参考）:");
    lines.push("  $oldoffice$0*salt*encrypted_verifier*encrypted_verifier_hash  (MD5+RC4, hashcat 9700)");
    lines.push("  $oldoffice$1*salt*encrypted_verifier*encrypted_verifier_hash  (MD5+RC4, hashcat 9710/9720)");
    lines.push("  $oldoffice$3*salt*encrypted_verifier*encrypted_verifier_hash  (SHA1+RC4, hashcat 9800)");
    lines.push("  $oldoffice$4*salt*encrypted_verifier*encrypted_verifier_hash  (SHA1+RC4, hashcat 9810/9820)");
    lines.push("");
    lines.push("提示: 旧版 Office 加密信息分散在 WordDocument/Workbook 等流中，建议用 Python office2john.py 提取。");
    return lines.join("\n");
  }

 // 成功提取
  lines.push("✓ 成功提取 Office 加密 hash");
  lines.push("");
  lines.push("--- hash 串 ---");
  lines.push(result.hash);
  lines.push("");
  lines.push("--- 参数 ---");
  if (result.year === 2007) {
    lines.push(`版本: Office 2007 (ECMA-376 1st ed, binary EncryptionInfo)`);
    lines.push(`hashSize: ${result.hashSize} (SHA-1)`);
    lines.push(`keyBits: ${result.keyBits} (AES-${result.keyBits})`);
    lines.push(`saltSize: ${result.saltSize}`);
  } else if (result.year === 2010 || result.year === 2013) {
    lines.push(`版本: Office ${result.year} (Agile, XML EncryptionInfo)`);
    lines.push(`spinCount: ${result.spinCount}`);
    lines.push(`keyBits: ${result.keyBits} (AES-${result.keyBits})`);
    lines.push(`saltSize: ${result.saltSize}`);
  }
  lines.push(`salt: ${result.salt}`);
  lines.push(`encryptedVerifier: ${result.encVerifier}`);
  lines.push(`encryptedVerifierHash: ${result.encVerifierHash}`);
  if (result.note) lines.push(`备注: ${result.note}`);
  lines.push("");
  lines.push("--- 使用方法 ---");
  if (result.year === 2007) {
    lines.push("hashcat -m 9400 hash.txt wordlist");
    lines.push("john --wordlist=wordlist hash.txt");
  } else if (result.year === 2010) {
    lines.push("hashcat -m 9500 hash.txt wordlist");
    lines.push("john --wordlist=wordlist hash.txt");
  } else if (result.year === 2013) {
    lines.push("hashcat -m 9600 hash.txt wordlist");
    lines.push("john --wordlist=wordlist hash.txt");
  }
  return lines.join("\n");
}

// ============================================================
// 注册 op
// ============================================================
register({
  id: "office2john",
  cat: "forensic",
  name: "Office 哈希提取（office2john）",
  desc: "从加密 Office 文档（.doc/.docx/.xls/.xlsx/.ppt/.pptx）提取 John/hashcat 格式 hash 串（只提取不爆破）。解析 CFB/OLE2 容器中的 EncryptionInfo 流，支持 Office 2007($office$*2007*, hashcat 9400)、2010($office$*2010*, hashcat 9500)、2013($office$*2013*, hashcat 9600)",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex（十六进制）" },
      { value: "base64", label: "Base64" },
      { value: "auto", label: "自动识别" },
    ] },
  ],
  run: office2johnRun,
  acceptsBytes: true,
});

// 导出纯函数供测试
export {
  office2johnRun, extractOfficeHash, parseEncryptionInfo,
  parseEncryptionInfo2007, parseEncryptionInfoAgile,
  parseCfbHeader, isCfbMagic, readFat, readDirectory, readStream,
  findEncryptionInfoStream, scanRawBytes,
  inputToBytes, u16le, u32le, toHex, b64decode,
  CFB_MAGIC, ENDOFCHAIN,
};
