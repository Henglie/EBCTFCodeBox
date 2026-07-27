/*
 * zipCrack.js — ZIP 弱口令爆破（纯 JS 最小可用版，cat:'analysis'，单向 run）。
 *
 * 覆盖：ZipCrypto（传统 PKWARE 加密，general purpose flag bit0=1 且 method≠99）
 * 的弱口令爆破。两种策略：纯数字掩码 + 内置/自定义字典。
 *
 * 算法（PKWARE APPNOTE 6.3.x §6.1 传统加密）：
 * 三个 32 位 key：key0=0x12345678, key1=0x23456789, key2=0x34567890。
 * update_keys(c):
 * key0 = crc32(key0, c)
 * key1 = (key1 + (key0 & 0xff)) * 134775813 + 1
 * key2 = crc32(key2, key1 >>> 24)
 * 其中 crc32(reg, b) = (reg >>> 8) ^ TABLE[(reg ^ b) & 0xff]（标准 0xEDB88320 反射表）。
 * decrypt_byte: temp = key2 | 2; ((temp * (temp ^ 1)) >>> 8) & 0xff。
 * 加密条目前有 12 字节随机加密头，解密后：
 * - flag bit3(0x08) 未置位：第 12 字节(header[11]) == (crc32 >>> 24) & 0xff
 * - flag bit3 置位：header[11] == (dosTime >>> 8) & 0xff（用文件时间高字节校验）
 * 本版对两种校验都支持（有 crc 用 crc，否则回退时间高字节）。
 *
 * 爆破策略（本版只做两种，不贪大）：
 * 1. 纯数字掩码：给定位数上限 maxDigits，穷举 0..10^maxDigits-1（含前导零，如 0000-9999）。
 * 2. 字典：内置常见弱口令 + 用户自定义（换行分隔）。字典先跑，命中最快。
 *
 * 防爆：maxDigits 默认 4，硬上限 6（10^6=100 万，同步可扛）。>6 拒跑。
 *
 * 已知边界（本版不做）：
 * - WinZip AES 加密（method 99 / AE-1/AE-2，PBKDF2-HMAC-SHA1 太重）→ 留待 hash-wasm 版。
 * - bkcrack 已知明文攻击 → 后续独立 WASM 卡。
 * - 大位数 / 复杂字符集掩码 → 需 Worker 池，本版同步实现。
 * - 找到密码后不解压还原明文（只验证密码正确性）。
 *
 * 红线：只建本文件，件内自注册，不碰任何现有文件。零外发纯 JS 计算。
 */
import { register } from "./registry.js";

// ---- CRC32 表（标准 poly 0xEDB88320，反射式；与 crc32collision.js 同，本文件自持一份避免跨文件耦合） ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

/** ZipCrypto 的 crc32 单字节推进（注意：这里不是 finalize 版，是原始寄存器推进）。 */
function crc32Update(reg, byte) {
  return ((reg >>> 8) ^ CRC_TABLE[(reg ^ byte) & 0xFF]) >>> 0;
}

/** 标准 CRC32（IEEE，finalize 版）：用于解密后数据的全量校验。 */
function crc32Bytes(bytes, start = 0, end = bytes.length) {
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = (CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================
// ZipCrypto 核心
// ============================================================

/** 初始 key 三元组（每次爆破一个密码前重置）。 */
function initKeys() {
  return new Uint32Array([0x12345678, 0x23456789, 0x34567890]);
}

/** update_keys(c)：吃一个明文/密码字节，更新 key0/key1/key2。 */
function updateKeys(keys, c) {
  keys[0] = crc32Update(keys[0], c);
 // key1 = (key1 + (key0 & 0xff)) * 134775813 + 1，需 32 位乘法（用 Math.imul 保精度）
  keys[1] = (Math.imul(((keys[1] + (keys[0] & 0xFF)) >>> 0), 134775813) + 1) >>> 0;
  keys[2] = crc32Update(keys[2], (keys[1] >>> 24) & 0xFF);
}

/** decrypt_byte：由当前 key2 导出流密钥字节。 */
function decryptByte(keys) {
  const temp = (keys[2] | 2) & 0xFFFF;
  return (Math.imul(temp, temp ^ 1) >>> 8) & 0xFF;
}

/** 用密码字符串初始化 keys（吃完密码所有字节）。password 为字节数组。 */
function keysFromPassword(passwordBytes) {
  const keys = initKeys();
  for (let i = 0; i < passwordBytes.length; i++) updateKeys(keys, passwordBytes[i]);
  return keys;
}

/**
 * 用给定密码尝试解密 12 字节加密头，返回校验字节是否匹配。
 * @param {Uint8Array} encHeader 12 字节加密头
 * @param {Uint8Array} pwBytes 密码字节
 * @param {number} checkByte 期望的校验字节（crc>>24 或 time>>8）& 0xff
 * @returns {boolean}
 */
function verifyPassword(encHeader, pwBytes, checkByte) {
  const keys = keysFromPassword(pwBytes);
  let last = 0;
  for (let i = 0; i < 12; i++) {
    const k = decryptByte(keys);
    const plain = (encHeader[i] ^ k) & 0xFF;
    updateKeys(keys, plain);
    last = plain;
  }
  return last === (checkByte & 0xFF);
}

/** 标准 CRC32（finalize 版，用于全量明文二次校验）。 */
function crc32Full(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c = (CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 全量二次校验：用密码解密整段（Stored 条目 = 明文），比对 CRC32 是否等于 LFH 记录的 crc。
 * 通过则密码 100% 正确（消除单字节头 1/256 假阳性）。仅 info.canFullVerify 时可调。
 */
function fullVerify(info, pwBytes) {
  const keys = keysFromPassword(pwBytes);
 // 先吃掉 12 字节加密头
  for (let i = 0; i < 12; i++) {
    const plain = (info.encHeader[i] ^ decryptByte(keys)) & 0xFF;
    updateKeys(keys, plain);
  }
 // 解密数据区（Stored → 直接是明文）
  const data = info.encData;
  const plain = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    const p = (data[i] ^ decryptByte(keys)) & 0xFF;
    updateKeys(keys, p);
    plain[i] = p;
  }
  return crc32Full(plain) === (info.plainCrc >>> 0);
}

// ============================================================
// ZIP 结构：定位第一个 ZipCrypto 加密条目，取加密头 + 校验字节
// 只在本文件内自持轻量解析（不 import compress.js，保持低耦合）。
// ============================================================
function u16le(b, i) { return (b[i] | (b[i + 1] << 8)) >>> 0; }
function u32le(b, i) { return ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0; }

/**
 * 扫 ZIP，找第一个可爆破的 ZipCrypto 加密条目。
 * 返回 { ok, encHeader(12B), checkByte, name, method, aesDetected, reason }。
 */
function findEncryptedEntry(bytes) {
  let sawAes = false;
  for (let i = 0; i + 30 <= bytes.length; i++) {
 // Local File Header sig = 50 4B 03 04
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4B || bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) continue;
    const flag = u16le(bytes, i + 6);
    const method = u16le(bytes, i + 8);
    const dosTime = u16le(bytes, i + 10);      // 修改时间（DOS 格式）
    const crc = u32le(bytes, i + 14);
    const nameLen = u16le(bytes, i + 26);
    const extraLen = u16le(bytes, i + 28);
    const dataStart = i + 30 + nameLen + extraLen;
    const encrypted = (flag & 1) === 1;
    if (!encrypted) continue;

 // AES（method 99）跳过——加密头结构不同，PBKDF2 太重
    if (method === 99) { sawAes = true; continue; }

    if (dataStart + 12 > bytes.length) continue; // 加密头不完整
    let name = "";
    const nameStart = i + 30;
    for (let k = 0; k < nameLen && nameStart + k < bytes.length; k++) {
      name += String.fromCharCode(bytes[nameStart + k]);
    }
    const compSize = u32le(bytes, i + 18);
    const encHeader = bytes.subarray(dataStart, dataStart + 12);
 // 校验字节：flag bit3(0x08) 置位 → 用 dosTime 高字节；否则用 crc 高字节
    const useTime = (flag & 0x08) !== 0;
    const checkByte = useTime ? ((dosTime >>> 8) & 0xFF) : ((crc >>> 24) & 0xFF);
 // 全量二次校验数据（仅 Stored=method0 且 LFH 带 compSize/crc 时可用，消除单字节 1/256 假阳性）。
 // 加密数据区 = header(12) + 密文；密文长 = compSize-12。
    let encData = null, plainCrc = 0, canFullVerify = false;
    if (method === 0 && !useTime && compSize > 12 && dataStart + compSize <= bytes.length) {
      encData = new Uint8Array(bytes.subarray(dataStart + 12, dataStart + compSize));
      plainCrc = crc;
      canFullVerify = true;
    }
    return {
      ok: true,
      encHeader: new Uint8Array(encHeader),
      checkByte,
      useTime,
      name,
      method,
      encData,
      plainCrc,
      canFullVerify,
      aesDetected: sawAes,
    };
  }
  return { ok: false, aesDetected: sawAes, reason: sawAes ? "AES 加密（method 99），本版不支持" : "未找到 ZipCrypto 加密条目" };
}

// ============================================================
// 内置弱口令字典
// ============================================================
const BUILTIN_DICT = [
  "password", "123456", "12345678", "123456789", "1234567890",
  "1234", "12345", "111111", "000000", "666666", "888888",
  "admin", "root", "toor", "administrator", "guest", "user",
  "qwerty", "abc123", "letmein", "welcome", "login", "master",
  "flag", "ctf", "flag{}", "secret", "pass", "passwd", "test",
  "zip", "unzip", "archive", "password1", "password123", "p@ssw0rd",
  "iloveyou", "dragon", "monkey", "sunshine", "princess", "football",
  "shadow", "michael", "superman", "batman", "trustno1", "hello",
  "hello123", "changeme", "default", "123123", "654321", "112233",
  "google", "facebook", "linux", "windows", "server", "backup",
];

// ============================================================
// 爆破核心
// ============================================================

const te = (s) => new TextEncoder().encode(s);

/**
 * ZipCrypto 弱口令爆破（纯函数，供测试直接调）。
 * @param {Uint8Array} zipBytes ZIP 文件字节
 * @param {object} opts { maxDigits:number, dict:string[]|string }
 * @returns {{found:boolean, password?:string, tried:number, entryName?:string
 * method?:string, aesDetected?:boolean, error?:string}}
 */
function crackZipCryptoWeak(zipBytes, opts = {}) {
  const info = findEncryptedEntry(zipBytes);
  if (!info.ok) {
    return { found: false, tried: 0, aesDetected: info.aesDetected, error: info.reason };
  }
  const { encHeader, checkByte } = info;

 // 组合校验：先跑 12 字节头快筛（1/256 误报），头过后若能全量校验（Stored 条目带 CRC）
 // 再比对整段明文 CRC 消除假阳性；否则退回头校验结果。
  function matches(pwBytes) {
    if (!verifyPassword(encHeader, pwBytes, checkByte)) return false;
    if (info.canFullVerify) return fullVerify(info, pwBytes);
    return true;
  }

  let tried = 0;

 // 1) 字典优先（含内置 + 自定义）
  let dictList = [];
  if (Array.isArray(opts.dict)) dictList = opts.dict;
  else if (typeof opts.dict === "string" && opts.dict.trim()) {
    dictList = opts.dict.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  const fullDict = [...BUILTIN_DICT, ...dictList];
  const seen = new Set();
  for (const pw of fullDict) {
    if (seen.has(pw)) continue;
    seen.add(pw);
    tried++;
    if (matches(te(pw))) {
      return {
        found: true, password: pw, tried,
        entryName: info.name, method: "字典", aesDetected: info.aesDetected,
      };
    }
  }

 // 2) 纯数字掩码：逐位数递增，含前导零穷举
  let maxDigits = parseInt(opts.maxDigits, 10);
  if (!Number.isFinite(maxDigits) || maxDigits < 1) maxDigits = 4;
  if (maxDigits > 6) maxDigits = 6; // 硬上限（10^6=100 万）

 // 复用密码前缀的 key 状态代价不大（密码短），这里直接逐个构造字节串。
  for (let len = 1; len <= maxDigits; len++) {
    const limit = Math.pow(10, len);
    const buf = new Uint8Array(len);
    for (let n = 0; n < limit; n++) {
 // 把 n 渲染成定长十进制（含前导零）字节
      let x = n;
      for (let d = len - 1; d >= 0; d--) {
        buf[d] = 0x30 + (x % 10);
        x = (x / 10) | 0;
      }
      tried++;
      if (matches(buf)) {
        let s = "";
        for (let k = 0; k < len; k++) s += String.fromCharCode(buf[k]);
        return {
          found: true, password: s, tried,
          entryName: info.name, method: "数字掩码", aesDetected: info.aesDetected,
        };
      }
    }
  }

  return { found: false, tried, entryName: info.name, aesDetected: info.aesDetected };
}

// ============================================================
// 输入：ZIP 字节（hex / base64 / 原始拖入的二进制字符串自动识别）
// ============================================================
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
function inputToZipBytes(text) {
  const s = String(text).trim().replace(/\s+/g, "");
  if (isHex(s)) return hexToBytes(s);
  if (isB64(s)) { try { return b64ToBytes(s); } catch { /* fall */ } }
 // 原始二进制字符串（拖入文件时前端可能给 latin1 串）
  const out = new Uint8Array(String(text).length);
  for (let i = 0; i < out.length; i++) out[i] = String(text).charCodeAt(i) & 0xFF;
  return out;
}

// ============================================================
// 注册 op
// ============================================================
register({
  id: "zipBrute",
  cat: "forensic",
  name: "ZIP 弱口令爆破",
  desc: "ZipCrypto（传统 PKWARE 加密）弱口令爆破：内置字典 + 自定义字典 + 纯数字掩码。仅验证密码，不还原明文。数字位数默认 4，硬上限 6（防浏览器卡死）。不支持 WinZip AES（留待 WASM 版）与 bkcrack 明文攻击。输入 ZIP 的 hex/base64/拖入字节",
  params: [
    { key: "maxDigits", label: "数字掩码位数上限（默认 4，硬上限 6）", type: "number", default: 4 },
    { key: "dict", label: "自定义字典（每行一个密码，可空）", type: "text", default: "", placeholder: "flag\nctf2024\n..." },
  ],
  run: function (text, p) {
    if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) return "（空输入）请拖入 ZIP 文件或粘贴其 hex/base64。";
    let zipBytes;
    try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
      zipBytes = (p && p.rawBytes && p.rawBytes.length)
        ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
        : inputToZipBytes(text);
    } catch (e) {
      return "输入解析失败：" + (e && e.message ? e.message : String(e));
    }
    if (zipBytes.length < 30) return "（输入过短）不足一个 ZIP 本地文件头。";

    let maxDigits = parseInt(p && p.maxDigits, 10);
    if (!Number.isFinite(maxDigits) || maxDigits < 1) maxDigits = 4;
    let clamped = false;
    if (maxDigits > 6) { maxDigits = 6; clamped = true; }

    const t0 = Date.now();
    const r = crackZipCryptoWeak(zipBytes, { maxDigits, dict: (p && p.dict) || "" });
    const ms = Date.now() - t0;

    const lines = [];
    lines.push("=== ZIP 弱口令爆破（ZipCrypto）===");
    if (r.error) {
      lines.push("结果: " + r.error);
      if (r.aesDetected) {
        lines.push("");
        lines.push("检测到 AES 加密条目（method 99）：本版不支持 WinZip AES 爆破（PBKDF2 太重），留待 hash-wasm 版。");
      }
      lines.push("提示: 确认输入为含 ZipCrypto 加密条目的 ZIP。伪加密请用「ZIP 结构解析」。");
      return lines.join("\n");
    }

    lines.push("目标条目: " + (r.entryName || "(未命名)"));
    if (clamped) lines.push("注意: maxDigits 已压到硬上限 6。");
    lines.push("尝试次数: " + r.tried.toLocaleString() + "  耗时: " + ms + " ms");
    lines.push("");
    if (r.found) {
      lines.push("命中 ✓  密码: \"" + r.password + "\"  （来源: " + r.method + "）");
      lines.push("");
      lines.push("说明: 该密码通过 12 字节加密头校验字节验证（1/256 误报率，多数情况即正确密码）。");
      lines.push("如需还原明文，用此密码在本地解压工具解开即可。");
    } else {
      lines.push("未命中 ✗");
      lines.push("建议: 增大数字位数上限、补充自定义字典，或密码较复杂时改用离线 hashcat/John。");
    }
    if (r.aesDetected) {
      lines.push("");
      lines.push("附注: 归档中另有 AES 加密条目（本版跳过）。");
    }
    return lines.join("\n");
  },
  acceptsBytes: true,
});

// 导出纯函数供测试
export {
  crackZipCryptoWeak, verifyPassword, keysFromPassword,
  updateKeys, decryptByte, initKeys, crc32Update,
  findEncryptedEntry, BUILTIN_DICT, inputToZipBytes,
};
