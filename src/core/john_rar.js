/*
 * john_rar.js — RAR 加密头 → John/hashcat hash 串提取（T289，cat:'analysis'，单向 run）。
 *
 * 用途：CTF 取证里拿到加密 RAR，想用 John the Ripper / hashcat 离线爆破密码。
 * 本 op 只提取 hash 串（不爆破），输出可直接喂给 john/hashcat 的格式。
 *
 * 支持两种 RAR 版本 × 两种加密模式：
 * RAR 3.x -hp 模式（块头加密）→ $RAR3$*0*<salt>*<enc_data>（hashcat 12500）
 * RAR 3.x -p 模式（文件加密） → $RAR3$*1*<salt>*<crc>*<pack>*<unp>*1*<enc>*<method>（hashcat 23700/23800）
 * RAR 5.0 文件加密 → $rar5$16$<salt>$<iter>$<iv>$8$<pswcheck>（hashcat 13000）
 * RAR 5.0 归档加密（-hp） → 同 $rar5$ 格式，IV 取自下一加密块
 *
 * 格式定义（照 john 源码 src/rar2john.c + hashcat example_hashes 交叉验证）：
 *
 * $RAR3$*0*salt_hex*enc_data_hex
 * type=0 -hp 模式（块头加密，known-plaintext 攻击）
 * salt 8 字节，取自文件末尾 24 字节的前 8 字节
 * enc_data 16 字节，取自文件末尾 24 字节的后 16 字节（加密的 END_HEAD 块）
 *
 * $RAR3$*1*salt_hex*crc_hex*pack_size*unp_size*1*enc_data_hex*method
 * type=1 -p 模式（仅文件数据加密）
 * salt 8 字节，取自 FILE_HEAD 的 SALT 字段（flags & 0x400）
 * crc 4 字节，FILE_CRC（小端转 hex）
 * pack_size 压缩后大小（dec）
 * unp_size 未压缩大小（dec）
 * 1 pack_type=1（内联数据）
 * enc_data 加密的文件数据（hex）
 * method 压缩方法（0x30=存储，0x33=普通等）
 *
 * $rar5$16$salt_hex$iter_log2$iv_hex$8$pswcheck_hex
 * salt_len 固定 16
 * salt 16 字节
 * iter_log2 KDF count（PBKDF2 迭代次数的对数，如 15 → 2^15=32768）
 * iv 16 字节 AES-256 IV
 * pswcheck_len 固定 8
 * pswcheck 8 字节密码验证值（文件中存 12 字节，前 8 用于哈希）
 *
 * RAR3 块头结构：
 * HEAD_CRC(2) + HEAD_TYPE(1) + HEAD_FLAGS(2) + HEAD_SIZE(2) [+ ADD_SIZE(4) if flags&0x8000]
 * 块类型：0x72=MARK, 0x73=MAIN, 0x74=FILE, 0x7b=END
 * MAIN_HEAD flags 0x0080 = 块头加密（-hp 模式）
 * FILE_HEAD flags 0x004 = 文件加密（LHD_PASSWORD），0x400 = SALT 存在，0x100 = HIGH_SIZE 存在
 *
 * RAR5 块头结构（vint 变长整数）：
 * CRC32(4) + header_size(vint) + header_type(vint) + header_flags(vint) + ...
 * 块类型：1=MAIN, 2=FILE, 4=ARCHIVE_ENC, 5=END
 * 文件加密记录在 extra area（record type=0x01）：
 * version(vint) + flags(vint) + kdf_count(1B) + salt(16B) + iv(16B) + check_value(12B, 可选)
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
// RAR3 常量
// ============================================================
const RAR3_MAGIC = [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x00]; // 7 字节
const RAR5_MAGIC = [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]; // 8 字节

const HEAD_MAIN = 0x73;
const HEAD_FILE = 0x74;
const HEAD_END  = 0x7b;

const FLAG_MAIN_ENC = 0x0080;  // MAIN_HEAD: 块头加密（-hp）
const FLAG_FILE_PWD = 0x0004;  // FILE_HEAD: 文件加密
const FLAG_HIGH_SIZE = 0x0100; // FILE_HEAD: HIGH_PACK/UNP_SIZE 存在
const FLAG_SALT      = 0x0400; // FILE_HEAD: SALT 存在
const FLAG_ADD_SIZE  = 0x8000; // 通用: ADD_SIZE 存在

// ============================================================
// RAR3 结构解析
// ============================================================

/**
 * 检测 RAR 版本。
 * @returns {number} 3 = RAR3, 5 = RAR5, 0 = 非 RAR
 */
function detectRarVersion(bytes) {
  if (bytes.length < 7) return 0;
 // 前 6 字节公共前缀: Rar!\x1a\x07
  for (let i = 0; i < 6; i++) if (bytes[i] !== RAR3_MAGIC[i]) return 0;
  if (bytes[6] === 0x00) return 3;
  if (bytes[6] === 0x01 && bytes.length >= 8 && bytes[7] === 0x00) return 5;
  return 0;
}

/**
 * 解析 RAR3 块结构，遍历所有块头。
 * @returns {{ blocks: Array, isHeaderEncrypted: boolean }}
 */
function parseRar3Blocks(bytes) {
  const blocks = [];
  let isHeaderEncrypted = false;
  let pos = 7; // 跳过 MARK_HEAD

  while (pos + 7 <= bytes.length) {
    const headType = bytes[pos + 2];
    const headFlags = u16le(bytes, pos + 3);
    const headSize = u16le(bytes, pos + 5);
    let addSize = 0;
    if (headFlags & FLAG_ADD_SIZE) {
      if (pos + 11 > bytes.length) break;
      addSize = u32le(bytes, pos + 7);
    }
    const blockSize = headSize + addSize;

    if (headType === HEAD_MAIN) {
      if (headFlags & FLAG_MAIN_ENC) isHeaderEncrypted = true;
    }

    blocks.push({
      offset: pos,
      type: headType,
      flags: headFlags,
      headSize,
      addSize,
      blockSize,
    });

    if (headType === HEAD_END) break;
    pos += blockSize;
    if (blockSize === 0) break; // 防死循环
  }

  return { blocks, isHeaderEncrypted };
}

/**
 * 从 RAR3 FILE_HEAD 块中提取加密信息。
 * @returns {{ salt: Uint8Array, crc: number, packSize: number, unpSize: number, method: number, dataOffset: number, name: string } | null }
 */
function parseRar3FileHead(bytes, block) {
  const base = block.offset;
  if (base + 32 > bytes.length) return null;

  const flags = block.flags;
  const packSize = u32le(bytes, base + 7);
  const unpSize = u32le(bytes, base + 11);
  const fileCrc = u32le(bytes, base + 16);
  const method = bytes[base + 25];
  const nameSize = u16le(bytes, base + 26);

 // 计算可选字段偏移
  let off = base + 32;
  let highPack = 0;
  let highUnp = 0;
  if (flags & FLAG_HIGH_SIZE) {
    if (off + 8 > bytes.length) return null;
    highPack = u32le(bytes, off);
    highUnp = u32le(bytes, off + 4);
    off += 8;
  }

 // 文件名
  if (off + nameSize > bytes.length) return null;
  let name = "";
  for (let i = 0; i < nameSize; i++) name += String.fromCharCode(bytes[off + i]);
  off += nameSize;

 // SALT
  let salt = null;
  if (flags & FLAG_SALT) {
    if (off + 8 > bytes.length) return null;
    salt = bytes.slice(off, off + 8);
    off += 8;
  }

  const fullPackSize = highPack * 0x100000000 + packSize;
  const fullUnpSize = highUnp * 0x100000000 + unpSize;

 // 加密数据紧跟在文件头之后（headSize 已含所有头字段）
  const dataOffset = block.offset + block.headSize;

  return {
    salt,
    crc: fileCrc,
    packSize: fullPackSize,
    unpSize: fullUnpSize,
    method,
    dataOffset,
    name,
  };
}

// ============================================================
// RAR5 vint 解析
// ============================================================

/**
 * 读取 RAR5 vint 变长整数。
 * @returns {{ value: number, bytesRead: number }}
 */
function readVint(bytes, offset) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  let bytesRead = 0;
  while (pos < bytes.length && bytesRead < 10) {
    const b = bytes[pos++];
    bytesRead++;
    value |= (b & 0x7F) << shift;
    shift += 7;
    if ((b & 0x80) === 0) break;
  }
  return { value: value >>> 0, bytesRead };
}

// RAR5 块类型
const RAR5_HEAD_MAIN = 1;
const RAR5_HEAD_FILE = 2;
const RAR5_HEAD_ARCHIVE_ENC = 4;
const RAR5_HEAD_END = 5;

// RAR5 header flags
const RAR5_HFL_EXTRA = 0x0001;
const RAR5_HFL_DATA  = 0x0002;

// RAR5 file flags
const RAR5_FFL_UNIX_TIME = 0x0002;
const RAR5_FFL_CRC32     = 0x0004;

// RAR5 加密记录
const RAR5_ENC_RECORD_TYPE = 0x01;
const RAR5_ENC_FLAG_CHECK  = 0x0001;

/**
 * 解析 RAR5 块结构，查找加密信息。
 * @returns {{ encRecords: Array, archiveEnc: object|null }}
 */
function parseRar5Blocks(bytes) {
  const encRecords = [];
  let archiveEnc = null;
  let pos = 8; // 跳过 magic

  while (pos + 4 < bytes.length) {
    const blockStart = pos;
    const crc32 = u32le(bytes, pos);
    let off = pos + 4;

    const hsRes = readVint(bytes, off);
    const headerSize = hsRes.value;
    off += hsRes.bytesRead;

    const headerStart = off; // header_type 开始位置

    const htRes = readVint(bytes, off);
    const headerType = htRes.value;
    off += htRes.bytesRead;

    const hfRes = readVint(bytes, off);
    const headerFlags = hfRes.value;
    off += hfRes.bytesRead;

    let extraAreaSize = 0;
    let dataSize = 0;
    if (headerFlags & RAR5_HFL_EXTRA) {
      const r = readVint(bytes, off); extraAreaSize = r.value; off += r.bytesRead;
    }
    if (headerFlags & RAR5_HFL_DATA) {
      const r = readVint(bytes, off); dataSize = r.value; off += r.bytesRead;
    }

 // header 内容区到 extra area 结束
    const contentStart = off;
    const extraAreaStart = headerStart + headerSize - extraAreaSize;
    const dataAreaStart = headerStart + headerSize;

    if (headerType === RAR5_HEAD_ARCHIVE_ENC) {
 // 归档加密头（-hp 模式）
      const enc = parseRar5EncryptionRecord(bytes, off, false);
      if (enc) archiveEnc = enc;
    } else if (headerType === RAR5_HEAD_FILE) {
 // 文件头
      const fileInfo = parseRar5FileHeader(bytes, off, headerFlags);
      if (fileInfo && (headerFlags & RAR5_HFL_EXTRA) && extraAreaSize > 0) {
 // 在 extra area 中查找加密记录
        const enc = scanRar5ExtraArea(bytes, extraAreaStart, extraAreaSize);
        if (enc) {
          encRecords.push({ ...enc, name: fileInfo.name });
        }
      }
    }

 // 跳到下一块
    const nextPos = dataAreaStart + dataSize;
    if (nextPos <= blockStart) break; // 防死循环
    pos = nextPos;

    if (headerType === RAR5_HEAD_END) break;
  }

  return { encRecords, archiveEnc };
}

/**
 * 解析 RAR5 文件头字段（type=2）。
 * @returns {{ name: string, fileFlags: number } | null}
 */
function parseRar5FileHeader(bytes, offset, headerFlags) {
  let off = offset;
  const ffRes = readVint(bytes, off);
  const fileFlags = ffRes.value;
  off += ffRes.bytesRead;

  const usRes = readVint(bytes, off);
  off += usRes.bytesRead; // unpacked_size

  const attrRes = readVint(bytes, off);
  off += attrRes.bytesRead; // attributes

  if (fileFlags & RAR5_FFL_UNIX_TIME) {
    off += 4; // mtime (uint32)
  }
  if (fileFlags & RAR5_FFL_CRC32) {
    off += 4; // data_crc32 (uint32)
  }

  const ciRes = readVint(bytes, off);
  off += ciRes.bytesRead; // compression_info

  const osRes = readVint(bytes, off);
  off += osRes.bytesRead; // host_os

  const nlRes = readVint(bytes, off);
  const nameLength = nlRes.value;
  off += nlRes.bytesRead;

  if (off + nameLength > bytes.length) return null;
  let name = "";
  for (let i = 0; i < nameLength; i++) name += String.fromCharCode(bytes[off + i]);

  return { name, fileFlags };
}

/**
 * 在 RAR5 extra area 中扫描加密记录（type=0x01）。
 * @returns {object|null} 加密信息
 */
function scanRar5ExtraArea(bytes, start, size) {
  const end = start + size;
  let pos = start;
  while (pos + 2 <= end) {
    const szRes = readVint(bytes, pos);
    const recSize = szRes.value;
    pos += szRes.bytesRead;
    const recStart = pos;

    const tyRes = readVint(bytes, pos);
    const recType = tyRes.value;
    pos += tyRes.bytesRead;

    if (recType === RAR5_ENC_RECORD_TYPE) {
 // pos 已跳过 record_type，指向 version 字段起始
      return parseRar5EncryptionRecord(bytes, pos, true);
    }

 // 跳到下一条记录：recStart + recSize（recSize 从 type 开始算）
    pos = recStart + recSize;
    if (pos <= start) break;
  }
  return null;
}

/**
 * 解析 RAR5 加密记录。
 * @param {boolean} hasIv 文件加密记录有 IV，归档加密头无 IV
 * @returns {object|null} { version, kdfCount, salt, iv, checkValue }
 */
function parseRar5EncryptionRecord(bytes, offset, hasIv) {
  let off = offset;
  const vRes = readVint(bytes, off);
  const version = vRes.value;
  off += vRes.bytesRead;

  const fRes = readVint(bytes, off);
  const encFlags = fRes.value;
  off += fRes.bytesRead;

  if (off + 1 > bytes.length) return null;
  const kdfCount = bytes[off];
  off += 1;

  if (off + 16 > bytes.length) return null;
  const salt = bytes.slice(off, off + 16);
  off += 16;

  let iv = null;
  if (hasIv) {
    if (off + 16 > bytes.length) return null;
    iv = bytes.slice(off, off + 16);
    off += 16;
  }

  let checkValue = null;
  if (encFlags & RAR5_ENC_FLAG_CHECK) {
    if (off + 12 > bytes.length) return null;
    checkValue = bytes.slice(off, off + 12); // 前 8 字节用于哈希
    off += 12;
  }

  return { version, encFlags, kdfCount, salt, iv, checkValue };
}

// ============================================================
// 构建 hash 串
// ============================================================

/**
 * 构建 RAR3 -hp 模式 hash（type=0）。
 * 从文件末尾取 24 字节：前 8 = salt，后 16 = 加密的 END_HEAD。
 */
function buildRar3HpHash(bytes) {
  if (bytes.length < 24) return null;
  const tail = bytes.length - 24;
  const salt = toHex(bytes, tail, tail + 8);
  const encData = toHex(bytes, tail + 8, tail + 24);
  return `$RAR3$*0*${salt}*${encData}`;
}

/**
 * 构建 RAR3 -p 模式 hash（type=1）。
 */
function buildRar3PHash(bytes, fileHead, maxDataLen) {
  if (!fileHead.salt) return null;
  const saltHex = toHex(fileHead.salt, 0, 8);
  const crcHex = toHex([
    fileHead.crc & 0xFF,
    (fileHead.crc >>> 8) & 0xFF,
    (fileHead.crc >>> 16) & 0xFF,
    (fileHead.crc >>> 24) & 0xFF,
  ], 0, 4);

 // 加密数据：取 min(packSize, maxDataLen) 字节
  const takeLen = Math.min(fileHead.packSize, maxDataLen);
  if (fileHead.dataOffset + takeLen > bytes.length) return null;
  const encDataHex = toHex(bytes, fileHead.dataOffset, fileHead.dataOffset + takeLen);

  return `$RAR3$*1*${saltHex}*${crcHex}*${fileHead.packSize}*${fileHead.unpSize}*1*${encDataHex}*${fileHead.method}`;
}

/**
 * 构建 RAR5 hash。
 */
function buildRar5Hash(enc) {
  if (!enc.salt || !enc.checkValue) return null;
  const saltHex = toHex(enc.salt, 0, 16);
  const iter = enc.kdfCount;
 // IV：文件加密记录有 IV；归档加密头无 IV，用全 0 占位（-hp 模式实际 IV 在下一块）
  const ivHex = enc.iv ? toHex(enc.iv, 0, 16) : "00".repeat(16);
 // pswcheck：取 checkValue 前 8 字节
  const pswcheckHex = toHex(enc.checkValue, 0, 8);
  return `$rar5$16$${saltHex}$${iter}$${ivHex}$8$${pswcheckHex}`;
}

// ============================================================
// 主函数：提取 hash
// ============================================================

/**
 * 从 RAR 字节中提取哈希串。
 * @param {Uint8Array} rarBytes
 * @param {number} maxDataLen RAR3 -p 模式取多少字节加密数据
 * @returns {{ hashes: string[], version: number, mode: string, errors: string[] }}
 */
function extractRarHash(rarBytes, maxDataLen = 200) {
  const hashes = [];
  const errors = [];
  const version = detectRarVersion(rarBytes);

  if (version === 0) {
    return { hashes, version: 0, mode: "unknown", errors: ["非 RAR 文件（magic 不匹配）"] };
  }

  if (version === 3) {
    const { blocks, isHeaderEncrypted } = parseRar3Blocks(rarBytes);

    if (isHeaderEncrypted) {
 // -hp 模式：从文件末尾取 24 字节
      const h = buildRar3HpHash(rarBytes);
      if (h) {
        hashes.push(h);
        return { hashes, version: 3, mode: "hp", errors };
      }
      return { hashes, version: 3, mode: "hp", errors: ["-hp 模式但文件不足 24 字节"] };
    }

 // -p 模式：找加密的 FILE_HEAD
    let found = false;
    for (const block of blocks) {
      if (block.type !== HEAD_FILE) continue;
      if (!(block.flags & FLAG_FILE_PWD)) continue;

      const fh = parseRar3FileHead(rarBytes, block);
      if (!fh) {
        errors.push("FILE_HEAD 解析失败");
        continue;
      }
      if (!fh.salt) {
        errors.push(`文件 "${fh.name}": 加密但无 SALT 字段`);
        continue;
      }

      const h = buildRar3PHash(rarBytes, fh, maxDataLen);
      if (h) {
        hashes.push(`${fh.name}:${h}`);
        found = true;
      }
    }

    if (!found && errors.length === 0) {
      errors.push("未找到 RAR3 加密文件条目");
    }
    return { hashes, version: 3, mode: "p", errors };
  }

  if (version === 5) {
    const { encRecords, archiveEnc } = parseRar5Blocks(rarBytes);

    if (archiveEnc) {
 // -hp 模式（归档加密头）
      const h = buildRar5Hash(archiveEnc);
      if (h) {
        hashes.push(h);
        return { hashes, version: 5, mode: "hp", errors };
      }
      return { hashes, version: 5, mode: "hp", errors: ["归档加密头解析失败"] };
    }

 // -p 模式（文件加密记录）
    let found = false;
    for (const enc of encRecords) {
      const h = buildRar5Hash(enc);
      if (h) {
        hashes.push(`${enc.name}:${h}`);
        found = true;
      }
    }

    if (!found && errors.length === 0) {
      errors.push("未找到 RAR5 加密文件条目");
    }
    return { hashes, version: 5, mode: "p", errors };
  }

  return { hashes, version: 0, mode: "unknown", errors };
}

/**
 * op run 函数：提取 RAR hash 串。
 * @param {string} text 输入文本（hex/base64/原始字节）
 * @param {object} p { inputEnc: "hex"|"base64"|"auto", maxDataLen: number }
 */
function rar2johnRun(text, p = {}) {
  const enc = p.inputEnc || "auto";
  const maxDataLen = parseInt(p.maxDataLen, 10) || 200;

  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) return "（空输入）";
  let rarBytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
    rarBytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, enc);
  } catch (e) {
    return "输入解析失败：" + (e && e.message ? e.message : String(e));
  }
  if (rarBytes.length < 8) return "（输入过短）不足一个 RAR 文件头。";

  const { hashes, version, mode, errors } = extractRarHash(rarBytes, maxDataLen);

  const lines = [];
  const verStr = version === 3 ? "RAR 3.x" : version === 5 ? "RAR 5.0" : "未知";
  lines.push("=== RAR hash 提取（rar2john 格式）===");
  lines.push(`版本: ${verStr}  模式: ${mode === "hp" ? "-hp（块头加密）" : mode === "p" ? "-p（文件加密）" : mode}`);
  lines.push(`扫描结果: ${hashes.length} 条哈希`);
  if (errors.length > 0) {
    lines.push("警告:");
    errors.forEach((e) => lines.push("  - " + e));
  }
  lines.push("");
  if (hashes.length === 0) {
    lines.push("未提取到哈希。");
    lines.push("提示: 确认输入为加密 RAR 文件（RAR3 magic: 526172211a0700，RAR5 magic: 526172211a070100）。");
  } else {
    lines.push("哈希串（可直接喂给 john/hashcat）:");
    hashes.forEach((h) => lines.push(h));
    lines.push("");
    const modeHint = version === 3
      ? (mode === "hp" ? "hashcat -m 12500" : "hashcat -m 23700（未压缩）/ 23800（已压缩）")
      : "hashcat -m 13000";
    lines.push(`爆破命令: ${modeHint} "哈希串" 字典.txt`);
  }
  return lines.join("\n");
}

register({
  id: "rar2john",
  cat: "forensic",
  name: "RAR 哈希提取（rar2john）",
  desc: "从 RAR3/RAR5 加密文件提取 hash 串（$RAR3$/$rar5$），输出可直接喂给 john/hashcat。只提取不爆破",
  params: [
    {
      key: "inputEnc", label: "输入编码", type: "select", default: "hex",
      options: [
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "auto", label: "自动识别" },
      ],
    },
    { key: "maxDataLen", label: "RAR3-p 数据截取长度", type: "number", default: 200, placeholder: "加密数据取多少字节" },
  ],
  run: rar2johnRun,
  acceptsBytes: true,
});

export {
  rar2johnRun, extractRarHash,
  buildRar3HpHash, buildRar3PHash, buildRar5Hash,
  parseRar3Blocks, parseRar3FileHead, parseRar5Blocks,
  readVint, detectRarVersion, inputToBytes,
  u16le, u32le, toHex,
};
