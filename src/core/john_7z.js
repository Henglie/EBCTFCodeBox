/*
 * john_7z.js — 7z 加密头 → John/hashcat hash 串提取（T293，cat:'forensic'，单向 run）。
 *
 * 用途：CTF 取证里拿到加密 7z，想用 John the Ripper / hashcat 离线爆破密码。
 * 本 op 只提取 hash 串（不爆破），输出可直接喂给 john/hashcat 的格式。
 *
 * 格式定义（照 john 源码 src/7z_fmt_plug.c + 7z_common_plug.c + run/7z2john.pl）：
 *
 * $7z$[type]$[NumCyclesPower]$[saltLen]$[salt]$[ivLen]$[iv]$[crc]$[encLen]$[decLen]$[encData]
 * type 数据类型指示
 * 0 = stored（无压缩，无需解压即可校验 CRC）
 * 1 = LZMA1, 2 = LZMA2, 3 = PPMD, 6 = BZIP2, 7 = DEFLATE
 * 128 = 截断（padding attack，无 CRC 校验）
 * 高 4 位 (type>>4) 表示预处理器：1=BCJ, 2=BCJ2, 9=Delta, 8=截断
 * NumCyclesPower KDF 迭代次数 = 2^NumCyclesPower
 * saltLen 盐长度（字节，0-16）
 * salt 盐（hex，saltLen=0 时为空字符串）
 * ivLen IV 有效长度（字节，通常 8 或 16）
 * iv IV（hex，固定 16 字节，超出 ivLen 部分填 0）
 * crc CRC32（十进制无符号）
 * encLen 加密数据长度（字节，十进制，= AES 块对齐后的 pack size）
 * decLen 解密后数据长度（字节，十进制，= AES 输出 = 去填充后的数据大小）
 * encData 加密数据（hex）
 *
 * 若 type∈[1,127]（非截断、需解压校验 CRC），追加：
 * $[crcDataLen]$[coderAttrs]
 * crcDataLen 第一个文件解压后的数据长度（用于 CRC 校验）
 * coderAttrs 解压器的 Properties（hex，如 LZMA1 的 5d00000100）
 *
 * 若有预处理器，再追加：
 * $[preprocAttrs]
 *
 * 7z 文件格式要点（照 7zFormat spec / 7zHeader.h）：
 * - SignatureHeader（32字节）：
 * Signature(6B 37 7A BC AF 27 1C) + Version(2B) + StartHeaderCRC(4B LE)
 * + NextHeaderOffset(8B LE) + NextHeaderSize(8B LE) + NextHeaderCRC(4B LE)
 * - Packed Data：位于 offset 32 + PackPos（PackPos 通常=0），即签名头之后
 * - NextHeader（在 offset 32+NextHeaderOffset 处）：
 * 首字节 PropertyID：0x01=HEADER(明文)，0x17=ENCODED_HEADER(压缩/加密头)
 * - StreamsInfo = PackInfo(0x06) + CodersInfo/UnpackInfo(0x07) + SubStreamsInfo(0x08)
 * - Folder 内 Coder 链：AES(06F10701) 总是第一个（读 pack 流→解密），后接压缩器
 * - AES Properties = [NumCyclesPower(1B)] + [Salt(saltLen)] + [IV(16B)]
 * saltLen = PropertiesSize - 1 - 16
 *
 * 红线：只建本文件，件内自注册，不碰任何现有文件。零外发纯 JS 计算。
 * 只提取 hash 串，绝不爆破密码。
 */
import { register } from "./registry.js";

// ---- 小端整数读取 ----
function u16le(b, i) { return (b[i] | (b[i + 1] << 8)) >>> 0; }
function u32le(b, i) { return ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0; }
function u64le(b, i) {
 // 安全读到 2^53（7z 偏移/大小不会超过此范围）
  const lo = ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0;
  const hi = ((b[i + 4]) | (b[i + 5] << 8) | (b[i + 6] << 16) | (b[i + 7] * 0x1000000)) >>> 0;
  return lo + hi * 0x100000000;
}

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
// 7z 常量
// ============================================================
const SEVEN_ZIP_MAGIC = [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C];
const AES_CODEC_ID = [0x06, 0xF1, 0x07, 0x01];

// Property IDs（7zFormat spec）
const kEnd                = 0x00;
const kHeader             = 0x01;
const kEncodedHeader      = 0x17;
const kMainStreamsInfo    = 0x04;
const kPackInfo           = 0x06;
const kUnpackInfo         = 0x07;
const kSubStreamsInfo     = 0x08;
const kSize               = 0x09;
const kCRC                = 0x0A;
const kFolder             = 0x0B;
const kUnpackSize         = 0x0C;
const kNumUnpackStream    = 0x0D;

// 数据类型指示 → 压缩器名
const COMP_NAMES = { 0: "stored", 1: "LZMA1", 2: "LZMA2", 3: "PPMD", 6: "BZIP2", 7: "DEFLATE" };

// ============================================================
// vint 读取（7z 变长整数：每字节高 1 位续传，低 7 位数据，小端序）
// ============================================================
function readVint(bytes, offset) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  for (;;) {
    if (pos >= bytes.length) throw new Error("vint 读取越界");
 // 上限保护：7z 里 vint 全是计数/偏移，不可能超过文件长度，超了即损坏数据（防巨型循环卡死）。
    if (shift > 56 || value > bytes.length) throw new Error("vint 值过大（疑似损坏数据）");
    const byte = bytes[pos++];
    value += (byte & 0x7F) * Math.pow(2, shift);
    shift += 7;
    if (!(byte & 0x80)) break;
  }
  return { value: value, nextOffset: pos };
}

// ============================================================
// 签名头解析（32 字节）
// ============================================================
function parse7zSignatureHeader(bytes) {
  if (bytes.length < 32) {
    throw new Error("文件过短（<32 字节），不足 7z SignatureHeader");
  }
  for (let i = 0; i < 6; i++) {
    if (bytes[i] !== SEVEN_ZIP_MAGIC[i]) {
      throw new Error("非 7z 文件（magic 不匹配）");
    }
  }
  return {
    versionMajor: bytes[6],
    versionMinor: bytes[7],
    startHeaderCRC: u32le(bytes, 8),
    nextHeaderOffset: u64le(bytes, 12),
    nextHeaderSize: u64le(bytes, 20),
    nextHeaderCRC: u32le(bytes, 28),
  };
}

// ============================================================
// Folder 解析（提取 Coder 链 + BindPairs）
// ============================================================
function parseFolder(bytes, offset) {
  let { value: numCoders, nextOffset: pos } = readVint(bytes, offset);
  const coders = [];
  let totalInStreams = 0;
  let totalOutStreams = 0;

  for (let i = 0; i < numCoders; i++) {
    const flag = bytes[pos++];
    const codecIdSize = flag & 0x0F;
    const isComplex = (flag & 0x10) !== 0;
    const hasAttributes = (flag & 0x20) !== 0;

    const codecId = [];
    for (let j = 0; j < codecIdSize; j++) codecId.push(bytes[pos++]);

    let numIn = 1, numOut = 1;
    if (isComplex) {
      ({ value: numOut, nextOffset: pos } = readVint(bytes, pos));
      ({ value: numIn, nextOffset: pos } = readVint(bytes, pos));
    }

    let properties = null;
    let propertiesSize = 0;
    if (hasAttributes) {
      ({ value: propertiesSize, nextOffset: pos } = readVint(bytes, pos));
      properties = Array.from(bytes.slice(pos, pos + propertiesSize));
      pos += propertiesSize;
    }

    coders.push({ codecId, properties, propertiesSize, numIn, numOut });
    totalInStreams += numIn;
    totalOutStreams += numOut;
  }

 // BindPairs（out→in 连接）
  const numBindPairs = totalOutStreams - 1;
  const bindPairs = [];
  for (let i = 0; i < numBindPairs; i++) {
    const { value: inIndex, nextOffset: p1 } = readVint(bytes, pos);
    const { value: outIndex, nextOffset: p2 } = readVint(bytes, p1);
    bindPairs.push({ inIndex, outIndex });
    pos = p2;
  }

 // PackedStream indices（如果有多个）
  const numPackedStreams = totalInStreams - numBindPairs;
  const packedIndices = [];
  if (numPackedStreams > 1) {
    for (let i = 0; i < numPackedStreams; i++) {
      const { value: idx, nextOffset: p } = readVint(bytes, pos);
      packedIndices.push(idx);
      pos = p;
    }
  } else {
    packedIndices.push(0);
  }

  return { coders, bindPairs, packedIndices, totalInStreams, totalOutStreams, nextOffset: pos };
}

// ============================================================
// StreamsInfo 解析（PackInfo + UnpackInfo + SubStreamsInfo）
// ============================================================
function parseStreamsInfo(bytes, offset) {
  let pos = offset;
  const result = {
    packPos: 0,
    packSizes: [],
    folders: [],
    folderCRCs: [],
    substreamCRCs: [],
    substreamSizes: [],
    numUnpackStreams: [],
    nextOffset: pos,
  };

 // ---- PackInfo (0x06) ----
  if (pos < bytes.length && bytes[pos] === kPackInfo) {
    pos++;
    ({ value: result.packPos, nextOffset: pos } = readVint(bytes, pos));
    let numPackStreams;
    ({ value: numPackStreams, nextOffset: pos } = readVint(bytes, pos));

    if (pos < bytes.length && bytes[pos] === kSize) {
      pos++;
      for (let i = 0; i < numPackStreams; i++) {
        let sz;
        ({ value: sz, nextOffset: pos } = readVint(bytes, pos));
        result.packSizes.push(sz);
      }
    }
 // 跳过未知属性直到 kEnd
    while (pos < bytes.length && bytes[pos] !== kEnd) {
 // 简单跳过：读 vint（不完美，但 PackInfo 通常只有 Size）
      const { nextOffset: p } = readVint(bytes, pos);
      pos = p;
    }
    if (pos < bytes.length && bytes[pos] === kEnd) pos++;
  }

 // ---- UnpackInfo / CodersInfo (0x07) ----
  if (pos < bytes.length && bytes[pos] === kUnpackInfo) {
    pos++;
    if (pos < bytes.length && bytes[pos] === kFolder) {
      pos++;
      let numFolders;
      ({ value: numFolders, nextOffset: pos } = readVint(bytes, pos));
      const external = bytes[pos++];
      if (external !== 0) throw new Error("external folder data 不支持");

      for (let i = 0; i < numFolders; i++) {
        const folder = parseFolder(bytes, pos);
        result.folders.push(folder);
        pos = folder.nextOffset;
      }
    }

 // UnpackSize (0x0C) — 每个 folder 的每个输出流大小
    if (pos < bytes.length && bytes[pos] === kUnpackSize) {
      pos++;
      for (let i = 0; i < result.folders.length; i++) {
        const sizes = [];
        for (let j = 0; j < result.folders[i].totalOutStreams; j++) {
          let sz;
          ({ value: sz, nextOffset: pos } = readVint(bytes, pos));
          sizes.push(sz);
        }
        result.folders[i].unpackSizes = sizes;
      }
    }

 // CRC (0x0A) — folder 级别的 CRC
    if (pos < bytes.length && bytes[pos] === kCRC) {
      pos++;
      const allDefined = bytes[pos++];
      for (let i = 0; i < result.folders.length; i++) {
        const defined = allDefined || ((bytes[pos >>> 3] >> (7 - (pos & 7))) & 1);
        if (allDefined || defined) {
          result.folderCRCs.push(u32le(bytes, pos));
          pos += 4;
        } else {
          result.folderCRCs.push(null);
        }
      }
    }

    if (pos < bytes.length && bytes[pos] === kEnd) pos++;
  }

 // ---- SubStreamsInfo (0x08) ----
  if (pos < bytes.length && bytes[pos] === kSubStreamsInfo) {
    pos++;
 // NumUnpackStreams per folder
    for (let i = 0; i < result.folders.length; i++) {
      if (pos < bytes.length && bytes[pos] === kNumUnpackStream) {
        pos++;
        let n;
        ({ value: n, nextOffset: pos } = readVint(bytes, pos));
        result.numUnpackStreams.push(n);
      } else {
        result.numUnpackStreams.push(1);
      }
    }

 // Sizes（每个 substream 的大小，减去 folder 的 unpackSize）
    if (pos < bytes.length && bytes[pos] === kSize) {
      pos++;
      for (let i = 0; i < result.folders.length; i++) {
        const n = result.numUnpackStreams[i] || 1;
        for (let j = 0; j < n - 1; j++) {
          let sz;
          ({ value: sz, nextOffset: pos } = readVint(bytes, pos));
          result.substreamSizes.push(sz);
        }
      }
    }

 // CRCs
    if (pos < bytes.length && bytes[pos] === kCRC) {
      pos++;
      const allDefined = bytes[pos++];
      let crcIndex = 0;
      for (let i = 0; i < result.folders.length; i++) {
        const n = result.numUnpackStreams[i] || 1;
        for (let j = 0; j < n; j++) {
          const defined = allDefined || true; // 简化：假设都有 CRC
          if (defined) {
            if (pos + 4 <= bytes.length) {
              result.substreamCRCs.push(u32le(bytes, pos));
              pos += 4;
            }
          } else {
            result.substreamCRCs.push(null);
          }
        }
      }
    }

 // 跳到 kEnd
    while (pos < bytes.length && bytes[pos] !== kEnd) pos++;
    if (pos < bytes.length && bytes[pos] === kEnd) pos++;
  }

  if (pos < bytes.length && bytes[pos] === kEnd) pos++;
  result.nextOffset = pos;
  return result;
}

// ============================================================
// NextHeader 解析（处理 0x01=HEADER / 0x17=ENCODED_HEADER）
// ============================================================
function parse7zNextHeader(bytes, sigHeader) {
  const nhOffset = 32 + sigHeader.nextHeaderOffset;
  const nhSize = sigHeader.nextHeaderSize;

  if (nhOffset + nhSize > bytes.length) {
    throw new Error(`NextHeader 越界（offset=${nhOffset}, size=${nhSize}, file=${bytes.length}）`);
  }

  if (nhSize < 1) {
    throw new Error("NextHeader 为空");
  }

  const propId = bytes[nhOffset];
  const errors = [];

  if (propId === kEncodedHeader) {
 // 0x17 = ENCODED_HEADER：头部本身被压缩/加密
 // 解析其 StreamsInfo，提取 AES 编码器信息
    try {
      const streamsInfo = parseStreamsInfo(bytes, nhOffset + 1);
      return {
        type: "encoded",
        streamsInfo,
        errors,
      };
    } catch (e) {
      errors.push("ENCODED_HEADER StreamsInfo 解析失败: " + (e.message || e));
      return { type: "encoded", streamsInfo: null, errors };
    }
  }

  if (propId === kHeader) {
 // 0x01 = HEADER：明文头，内含 MAIN_STREAMS_INFO
    let pos = nhOffset + 1;
    let mainStreamsInfo = null;

    while (pos < nhOffset + nhSize && bytes[pos] !== kEnd) {
      if (bytes[pos] === kMainStreamsInfo) {
        try {
          mainStreamsInfo = parseStreamsInfo(bytes, pos + 1);
          pos = mainStreamsInfo.nextOffset;
        } catch (e) {
          errors.push("MAIN_STREAMS_INFO 解析失败: " + (e.message || e));
          pos++;
        }
        break;
      }
 // 跳过其他属性（FILES_INFO 等）— 简单跳字节
      pos++;
    }

    return {
      type: "plain",
      streamsInfo: mainStreamsInfo,
      errors,
    };
  }

  throw new Error(`未知的 NextHeader PropertyID: 0x${propId.toString(16)}`);
}

// ============================================================
// 从 Coder 链中提取 AES 加密信息
// ============================================================
function isAesCoder(coder) {
  const id = coder.codecId;
  return id.length === 4 &&
    id[0] === AES_CODEC_ID[0] && id[1] === AES_CODEC_ID[1] &&
    id[2] === AES_CODEC_ID[2] && id[3] === AES_CODEC_ID[3];
}

/**
 * 将压缩器 CodecId 映射到数据类型指示值。
 * 返回 -1 表示 AES 编码器，-2 表示未知/不支持。
 */
function codecToType(coder) {
  const id = coder.codecId;
  if (isAesCoder(coder)) return -1; // AES 不是压缩器
  if (id.length === 1 && id[0] === 0x00) return 0; // Copy/Store
  if (id.length === 3 && id[0] === 0x03 && id[1] === 0x01 && id[2] === 0x01) return 1; // LZMA1
  if (id.length === 1 && id[0] === 0x21) return 2; // LZMA2
  if (id.length === 3 && id[0] === 0x03 && id[1] === 0x04 && id[2] === 0x01) return 3; // PPMD
  if (id.length === 3 && id[0] === 0x04 && id[1] === 0x02 && id[2] === 0x02) return 6; // BZIP2
  if (id.length === 3 && id[0] === 0x04 && id[1] === 0x01 && id[2] === 0x08) return 7; // DEFLATE
 // 预处理器（高 4 位）
  if (id.length === 4 && id[0] === 0x03 && id[1] === 0x03 && id[2] === 0x01 && id[3] === 0x03) return 1 << 4; // BCJ
  if (id.length === 4 && id[0] === 0x03 && id[1] === 0x03 && id[2] === 0x01 && id[3] === 0x1b) return 2 << 4; // BCJ2
  if (id.length === 1 && id[0] === 0x03) return 9 << 4; // Delta
  return -2; // 未知
}

/**
 * 从 AES Coder 的 Properties 提取加密参数。
 * Properties = [NumCyclesPower(1B)] + [Salt(saltLen)] + [IV(16B)]
 * saltLen = PropertiesSize - 1 - 16
 */
function extractAesProperties(coder) {
  if (!coder.properties || coder.propertiesSize < 17) {
    throw new Error("AES Properties 过短（<17 字节）");
  }
  const props = coder.properties;
  const numCyclesPower = props[0];
  const ivLen16 = 16;
  const saltLen = props.length - 1 - ivLen16;
  if (saltLen < 0) {
    throw new Error("AES Properties 格式错误：saltLen < 0");
  }
  const salt = props.slice(1, 1 + saltLen);
  const iv = props.slice(1 + saltLen, 1 + saltLen + ivLen16);

 // 计算 ivLen（去掉尾部 0 字节）
  let ivLen = ivLen16;
  while (ivLen > 0 && iv[ivLen - 1] === 0) ivLen--;

  return { numCyclesPower, saltLen, salt, iv, ivLen };
}

/**
 * 从 StreamsInfo 的第一个 folder 中提取 AES 加密信息。
 * 返回 { aesInfo, compType, compCoder, packSize, decLen, crc, isEncrypted }
 */
function extractEncryptionInfo(streamsInfo) {
  if (!streamsInfo || !streamsInfo.folders || streamsInfo.folders.length === 0) {
    return { isEncrypted: false };
  }

  const folder = streamsInfo.folders[0];
  let aesCoder = null;
  let compType = 0; // 默认 stored
  let compCoder = null;
  let preprocType = 0;

  for (const coder of folder.coders) {
    if (isAesCoder(coder)) {
      aesCoder = coder;
    } else {
      const t = codecToType(coder);
      if (t >= 0 && t <= 7) {
        compType = t;
        compCoder = coder;
      } else if (t >= 16) {
        preprocType = t >> 4;
      }
    }
  }

  if (!aesCoder) {
    return { isEncrypted: false };
  }

  const aesInfo = extractAesProperties(aesCoder);

 // decLen = folder 的第一个输出流大小（AES 的输出 = 去填充后的数据）
  let decLen = 0;
  if (folder.unpackSizes && folder.unpackSizes.length > 0) {
    decLen = folder.unpackSizes[0];
  }

 // packSize = 第一个 pack stream 的大小
  let packSize = 0;
  if (streamsInfo.packSizes.length > 0) {
    packSize = streamsInfo.packSizes[0];
  }

 // CRC：优先 SubStreamsInfo 的第一个 CRC，其次 folder CRC
  let crc = 0;
  if (streamsInfo.substreamCRCs.length > 0 && streamsInfo.substreamCRCs[0] != null) {
    crc = streamsInfo.substreamCRCs[0];
  } else if (streamsInfo.folderCRCs.length > 0 && streamsInfo.folderCRCs[0] != null) {
    crc = streamsInfo.folderCRCs[0];
  }

 // crcDataLen = folder 的最终输出大小（最后一个输出流 = 解压后大小）
  let crcDataLen = 0;
  if (folder.unpackSizes && folder.unpackSizes.length > 0) {
    crcDataLen = folder.unpackSizes[folder.unpackSizes.length - 1];
  }

  return {
    isEncrypted: true,
    aesInfo,
    compType,
    compCoder,
    preprocType,
    packSize,
    decLen,
    crc,
    crcDataLen,
    packPos: streamsInfo.packPos,
  };
}

// ============================================================
// 构建 $7z$ hash 串
// ============================================================
function build7zHash(bytes, encInfo, maxDataLen) {
  if (!encInfo.isEncrypted) return null;

  const { aesInfo, compType, compCoder, preprocType, packSize, decLen, crc, crcDataLen, packPos } = encInfo;
  const { numCyclesPower, saltLen, salt, iv, ivLen } = aesInfo;

 // 确定数据类型指示
  let type;
  let truncated = false;
  if (packSize > maxDataLen) {
    type = 128; // 截断
    truncated = true;
  } else {
    type = compType | (preprocType << 4);
  }

 // 读取加密数据（最多 maxDataLen 字节）
  const dataOffset = 32 + packPos;
  const readLen = Math.min(packSize, maxDataLen, bytes.length - dataOffset);
  if (readLen <= 0) {
    return null;
  }
  const encDataHex = toHex(bytes, dataOffset, dataOffset + readLen);

 // 构建基础字段
  const saltHex = saltLen > 0 ? toHex(salt, 0, saltLen) : "";
  const ivHex = toHex(iv, 0, 16); // IV 固定 16 字节
  const encLen = readLen; // 实际读取的加密数据长度

 // 注意：$7z$ 前缀不放入 parts 数组，因为 join("$") 会在各元素间插入 $。
 // 若把 "$7z$" 放入 parts 会导致 $7z$$0$...（双 $）。
 // 正确格式：$7z$0$19$0$$8$iv$crc$encLen$decLen$encData
  const parts = [
    "7z",
    String(type),
    String(numCyclesPower),
    String(saltLen),
    saltHex,
    String(ivLen),
    ivHex,
    String(crc),
    String(encLen),
    String(decLen),
    encDataHex,
  ];
  let hash = "$" + parts.join("$");

 // 非截断 + 需要解压时，追加 coder attributes
  if (!truncated && compType > 0 && compType <= 7) {
    const coderAttrs = (compCoder && compCoder.properties) ? toHex(compCoder.properties, 0) : "";
    hash += "$" + String(crcDataLen) + "$" + coderAttrs;
  }

  return hash;
}

// ============================================================
// 主提取函数
// ============================================================
/**
 * 从 7z 字节数组中提取 John/hashcat 格式 hash 串。
 * @param {Uint8Array} bytes 7z 文件字节
 * @param {number} maxDataLen 单条 hash 内联数据上限（字节）
 * @returns {object} { hash, sigHeader, isEncrypted, errors, ... }
 */
function extract7zHash(bytes, maxDataLen = 200) {
  const errors = [];

 // 1. 解析签名头
  let sigHeader;
  try {
    sigHeader = parse7zSignatureHeader(bytes);
  } catch (e) {
    return { hash: null, sigHeader: null, isEncrypted: false, errors: [e.message] };
  }

 // 2. 解析 NextHeader
  let nextHeader;
  try {
    nextHeader = parse7zNextHeader(bytes, sigHeader);
  } catch (e) {
    return {
      hash: null,
      sigHeader,
      isEncrypted: false,
      errors: ["NextHeader 解析失败: " + (e.message || e)],
    };
  }
  errors.push(...nextHeader.errors);

 // 3. 提取加密信息
  let encInfo = null;
  let hash = null;

  if (nextHeader.type === "encoded") {
 // ENCODED_HEADER（0x17）— 头部被压缩/加密
    if (nextHeader.streamsInfo) {
      encInfo = extractEncryptionInfo(nextHeader.streamsInfo);
      if (encInfo.isEncrypted) {
 // 头部加密（-mhe=on），可以从 ENCODED_HEADER 的 StreamsInfo 提取 hash
        hash = build7zHash(bytes, encInfo, maxDataLen);
      } else {
 // 头部只是压缩（非加密），需要 LZMA 解压才能读取 MAIN_STREAMS_INFO
        const hasAes = nextHeader.streamsInfo.folders && nextHeader.streamsInfo.folders.some(f => f.coders.some(isAesCoder));
        if (!hasAes) {
          errors.push("NextHeader 为压缩编码（ENCODED_HEADER），需 LZMA 解压才能提取文件加密信息（当前不支持）");
        }
      }
    }
  } else if (nextHeader.type === "plain" && nextHeader.streamsInfo) {
 // 明文头 + MAIN_STREAMS_INFO
    encInfo = extractEncryptionInfo(nextHeader.streamsInfo);
    if (encInfo.isEncrypted) {
      hash = build7zHash(bytes, encInfo, maxDataLen);
    }
  }

  return {
    hash,
    sigHeader,
    isEncrypted: encInfo ? encInfo.isEncrypted : false,
    encInfo,
    nextHeaderType: nextHeader.type,
    errors,
  };
}

// ============================================================
// op run 函数
// ============================================================
/**
 * @param {string} text 输入文本（hex/base64/原始字节）
 * @param {object} p { inputEnc: "hex"|"base64"|"auto", maxDataLen: number }
 */
function sevenZip2johnRun(text, p = {}) {
  const enc = p.inputEnc || "hex";
  const maxDataLen = parseInt(p.maxDataLen, 10) || 200;

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
  if (bytes.length < 32) return "（输入过短）不足一个 7z 签名头（32 字节）。";

 // 截断/损坏的 7z 会在头部解析深处 throw（vint 越界、AES 属性过短等）——统一兜住不崩 UI。
  let result;
  try {
    result = extract7zHash(bytes, maxDataLen);
  } catch (e) {
    return "7z 解析失败（文件可能损坏或截断）：" + (e && e.message ? e.message : String(e));
  }

  const lines = [];
  lines.push("=== 7z hash 提取（7z2john 格式，hashcat mode 11600）===");
  const sh = result.sigHeader;
  if (sh) {
    lines.push(`版本: ${sh.versionMajor}.${sh.versionMinor}`);
    lines.push(`NextHeader: offset=${sh.nextHeaderOffset}, size=${sh.nextHeaderSize}`);
    lines.push(`NextHeader 类型: ${result.nextHeaderType || "未知"}`);
  }

  if (result.errors.length > 0) {
    lines.push("警告: " + result.errors.join("; "));
  }
  lines.push("");

  if (!result.isEncrypted) {
    if (!result.hash) {
      lines.push("未找到 7z AES 加密信息。");
      lines.push("提示: 确认输入为含 AES-256 加密的 7z 文件。");
      lines.push("      若 NextHeader 被压缩（非加密），需先解压头部才能提取文件加密信息。");
      return lines.join("\n");
    }
  }

  if (result.hash) {
    lines.push("Hash:");
    lines.push(result.hash);
    lines.push("");
    lines.push("--- 使用方法 ---");
    lines.push("hashcat -m 11600 hash.txt wordlist");
    lines.push("john --wordlist=wordlist hash.txt");
  }

  return lines.join("\n");
}

// ============================================================
// 注册 op
// ============================================================
register({
  id: "sevenZip2john",
  cat: "forensic",
  name: "7z 哈希提取（7z2john）",
  desc: "从加密 7z 提取 John/hashcat 格式 hash 串（只提取不爆破）。输出 $7z$ 格式（hashcat mode 11600）。支持 AES-256-SHA-256 加密的 7z 文件，提取 salt/IV/iterations/加密数据，输出可直接喂 john/hashcat 离线爆破",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "hex", options: [
      { value: "hex", label: "Hex（十六进制）" },
      { value: "base64", label: "Base64" },
      { value: "auto", label: "自动识别" },
    ] },
    { key: "maxDataLen", label: "单条 hash 内联数据上限（字节，默认 200）", type: "number", default: 200 },
  ],
  run: sevenZip2johnRun,
  acceptsBytes: true,
});

// 导出纯函数供测试
export {
  sevenZip2johnRun,
  extract7zHash,
  build7zHash,
  parse7zSignatureHeader,
  parse7zNextHeader,
  parseStreamsInfo,
  parseFolder,
  readVint,
  extractAesProperties,
  extractEncryptionInfo,
  codecToType,
  isAesCoder,
  inputToBytes,
  u16le,
  u32le,
  u64le,
  toHex,
};
