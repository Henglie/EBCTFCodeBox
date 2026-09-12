/*
 * zipCrack.js — ZIP 弱口令爆破（纯 JS 最小可用版，cat:'analysis'，单向 run）。
 *
 * 覆盖两类加密条目的弱口令爆破：
 * 1. ZipCrypto（传统 PKWARE 加密，general purpose flag bit0=1 且 method≠99）。
 * 2. WinZip AES（AE-1/AE-2，method 99 + 0x9901 extra field）——用 WebCrypto
 *    （PBKDF2-HMAC-SHA1 + AES-CTR + HMAC-SHA1），浏览器与 node22 均有 subtle。
 * 两种策略：纯数字掩码 + 内置/自定义字典。
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
 * - WinZip AES 数字掩码逐口令走 PBKDF2（1000 迭代），远慢于 ZipCrypto 的纯 JS
 *   逐字节快筛——位数上限沿用 6，但 AES 条目强烈建议用字典跑。
 * - bkcrack 已知明文攻击 → 后续独立 WASM 卡。
 * - 大位数 / 复杂字符集掩码 → 需 Worker 池，本版同步实现。
 * - 找到密码后不解压还原明文（只验证密码正确性）。
 *
 * WinZip AES 规格（实现依据，WinZip「AES Encryption」附录 + APPNOTE）：
 * - extra field 0x9901：version(2B, 0x0001=AE-1/0x0002=AE-2)、vendor(2B 'AE')、
 *   strength(1B, 1/2/3 → AES-128/192/256)、真实压缩方法(2B，LFH method 恒为 99)。
 * - keySize = (strength+1)*8 字节（1/2/3 → 16/24/32 = AES-128/192/256），
 *   saltLen = (strength+1)*4 字节（8/12/16）= keySize 的一半。
 * - 密钥派生：PBKDF2-HMAC-SHA1(password, salt, 1000) 导出 2*keySize+2 字节：
 *   前 keySize = AES 密钥，次 keySize = HMAC-SHA1 认证密钥，末 2 字节 = 口令验证值 pwdVer。
 * - 密文布局：salt + pwdVer(2B) + AES-CTR 密文（counter 初值 1，大端 128 位，IV 余 0）
 *   + 10 字节 HMAC-SHA1 认证码（对密文计算）。
 * - 爆破口径：pwdVer 两字节快筛（1/65536 漏筛）→ HMAC 全 10 字节比对确认
 *   （1/2^80 误报，AE-1/AE-2 统一走 HMAC，比解压+CRC 更强且无需 inflate）。
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
// WinZip AES（AE-1/AE-2，0x9901）核心——WebCrypto（浏览器 + node22 通用）
// ============================================================

/** subtle 懒取（有些环境 globalThis.crypto 缺失，用到才报错）。 */
function subtle() {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error("当前环境不支持 WebCrypto（需要 globalThis.crypto.subtle）");
  }
  return globalThis.crypto.subtle;
}

/**
 * PBKDF2-HMAC-SHA1 派生 WinZip AES 三件套。
 * @returns {Promise<{encKey:Uint8Array, authKey:Uint8Array, pwdVer:Uint8Array}>}
 */
async function aesDeriveKeys(pwBytes, salt, keySize) {
  const baseKey = await subtle().importKey("raw", pwBytes, { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-1", salt, iterations: 1000 },
    baseKey,
    (2 * keySize + 2) * 8
  );
  const all = new Uint8Array(bits);
  return {
    encKey: all.slice(0, keySize),
    authKey: all.slice(keySize, 2 * keySize),
    pwdVer: all.slice(2 * keySize, 2 * keySize + 2),
  };
}

/**
 * HMAC-SHA1 认证码比对（WinZip AES 的认证码是 20 字节摘要的前 10 字节截断）。
 * 注意：subtle.verify 只认全长标签（10B ≠ 20B 恒 false），必须 sign 后手动比对前 10 字节；
 * 用异或累差做常量时间比较，避免逐字节提前短路。
 */
async function hmacVerify(authKey, dataBytes, mac10) {
  if (!mac10 || mac10.length !== 10) return false;
  const key = await subtle().importKey("raw", authKey, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const tag = new Uint8Array(await subtle().sign("HMAC", key, dataBytes));
  let diff = 0;
  for (let i = 0; i < 10; i++) diff |= tag[i] ^ mac10[i];
  return diff === 0;
}

// ============================================================
// ZIP 结构：定位第一个 ZipCrypto 加密条目，取加密头 + 校验字节
// 只在本文件内自持轻量解析（不 import compress.js，保持低耦合）。
// ============================================================
function u16le(b, i) { return (b[i] | (b[i + 1] << 8)) >>> 0; }
function u32le(b, i) { return ((b[i]) | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 0x1000000)) >>> 0; }

/**
 * 扫 ZIP，找第一个可爆破的加密条目（ZipCrypto 优先于 AES 以文件内出现顺序为准）。
 * 返回 { ok, type:'zipcrypto'|'aes', ..., aesDetected, reason }。
 * ZipCrypto：encHeader(12B) + checkByte + 可选全量校验数据。
 * AES：salt / pwdVerTarget(2B) / encPayload(CTR 密文) / authCode(10B HMAC)。
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

 // ---- WinZip AES（method 99）：解析 0x9901 extra field ----
    if (method === 99) {
      sawAes = true;
      const aesExtra = parseAesExtra(bytes, i + 30 + nameLen, extraLen);
      if (!aesExtra || aesExtra.strength < 1 || aesExtra.strength > 3) continue; // extra 缺失/损坏 → 找下一个条目
      const compSize = u32le(bytes, i + 18); // AES 条目 compSize 必须为真实密文总长（bit3 数据描述符条目 compSize=0，无法定位，跳过）
      const saltLen = (aesExtra.strength + 1) * 4;     // strength 1/2/3 → 8/12/16 字节
      const keySize = (aesExtra.strength + 1) * 8;     // strength 1/2/3 → 16/24/32 字节（AES-128/192/256）
      if (compSize < saltLen + 12 || dataStart + compSize > bytes.length) continue; // 至少 salt+2+10，且要有数据本体
      let name = "";
      const nameStart = i + 30;
      for (let k = 0; k < nameLen && nameStart + k < bytes.length; k++) {
        name += String.fromCharCode(bytes[nameStart + k]);
      }
      return {
        ok: true,
        type: "aes",
        name,
        flag,
        aesVersion: aesExtra.version,   // 0x0001=AE-1（LFH 带 CRC）／0x0002=AE-2（CRC 置 0）
        realMethod: aesExtra.realMethod,
        strength: aesExtra.strength,
        keySize,
        saltLen,
        salt: new Uint8Array(bytes.subarray(dataStart, dataStart + saltLen)),
        pwdVerTarget: new Uint8Array(bytes.subarray(dataStart + saltLen, dataStart + saltLen + 2)),
        encPayload: new Uint8Array(bytes.subarray(dataStart + saltLen + 2, dataStart + compSize - 10)),
        authCode: new Uint8Array(bytes.subarray(dataStart + compSize - 10, dataStart + compSize)),
        plainCrc: crc,
        aesDetected: true,
      };
    }

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
      type: "zipcrypto",
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
  return { ok: false, aesDetected: sawAes, reason: sawAes ? "检测到 AES 加密条目（method 99），但其 0x9901 extra field 缺失/损坏或数据不完整，无法爆破" : "未找到 ZipCrypto 加密条目" };
}

/**
 * 解析 extra field 区找 0x9901（WinZip AES）头。
 * @returns {null|{version:number, vendor:string, strength:number, realMethod:number}}
 */
function parseAesExtra(bytes, extraStart, extraLen) {
  const extraEnd = extraStart + extraLen;
  for (let p = extraStart; p + 4 <= extraEnd; ) {
    const headerId = u16le(bytes, p);
    const dataSize = u16le(bytes, p + 2);
    const body = p + 4;
    if (body + dataSize > extraEnd) break; // extra 区越界，结构损坏
    if (headerId === 0x9901 && dataSize >= 7) {
      return {
        version: u16le(bytes, body), // 0x0001=AE-1 / 0x0002=AE-2
        vendor: String.fromCharCode(bytes[body + 2]) + String.fromCharCode(bytes[body + 3]), // 应为 'AE'
        strength: bytes[body + 4],   // 1/2/3 → AES-128/192/256
        realMethod: u16le(bytes, body + 5), // 真实压缩方法（LFH method 恒 99）
      };
    }
    p = body + dataSize;
  }
  return null;
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

/**
 * WinZip AES（AE-1/AE-2）弱口令爆破（异步，WebCrypto；供测试直接调）。
 * 口径与 crackZipCryptoWeak 一致：字典（内置+自定义）先跑，数字掩码兜底；
 * 每口令 pwdVer 两字节快筛 → 命中后再 HMAC-SHA1 全 10 字节确认（AE-1/AE-2 统一）。
 * @param {Uint8Array} zipBytes ZIP 文件字节
 * @param {object} opts { maxDigits:number, dict:string[]|string }
 * @returns {{found:boolean, password?:string, tried:number, entryName?:string,
 * method?:string, aesDetected?:boolean, aes?:object, error?:string}}
 */
async function crackWinZipAesWeak(zipBytes, opts = {}) {
  const info = findEncryptedEntry(zipBytes);
  if (!info.ok) {
    return { found: false, tried: 0, aesDetected: info.aesDetected, error: info.reason };
  }
  if (info.type !== "aes") {
    return { found: false, tried: 0, aesDetected: info.aesDetected, error: "非 AES 加密条目（走 ZipCrypto 路径）" };
  }

 // 组合校验：pwdVer 快筛（1/65536 漏筛）→ HMAC-SHA1 认证码全量比对确认（1/2^80 误报）。
  async function matches(pwBytes) {
    const dk = await aesDeriveKeys(pwBytes, info.salt, info.keySize);
    if (dk.pwdVer[0] !== info.pwdVerTarget[0] || dk.pwdVer[1] !== info.pwdVerTarget[1]) return false;
    return hmacVerify(dk.authKey, info.encPayload, info.authCode);
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
    if (await matches(te(pw))) {
      return {
        found: true, password: pw, tried,
        entryName: info.name, method: "字典", aesDetected: true,
        aes: { strength: info.strength, keySize: info.keySize, aesVersion: info.aesVersion },
      };
    }
  }

 // 2) 纯数字掩码：逐位数递增，含前导零穷举（AES 每口令一次 PBKDF2，位数大时极慢）
  let maxDigits = parseInt(opts.maxDigits, 10);
  if (!Number.isFinite(maxDigits) || maxDigits < 1) maxDigits = 4;
  if (maxDigits > 6) maxDigits = 6; // 硬上限（10^6=100 万）

  for (let len = 1; len <= maxDigits; len++) {
    const limit = Math.pow(10, len);
    const buf = new Uint8Array(len);
    for (let n = 0; n < limit; n++) {
      let x = n;
      for (let d = len - 1; d >= 0; d--) {
        buf[d] = 0x30 + (x % 10);
        x = (x / 10) | 0;
      }
      tried++;
      if (await matches(buf)) {
        let s = "";
        for (let k = 0; k < len; k++) s += String.fromCharCode(buf[k]);
        return {
          found: true, password: s, tried,
          entryName: info.name, method: "数字掩码", aesDetected: true,
          aes: { strength: info.strength, keySize: info.keySize, aesVersion: info.aesVersion },
        };
      }
    }
  }

  return { found: false, tried, entryName: info.name, aesDetected: true };
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
  id: "zipBrute", family: "zip", familyLabel: "crack",
  cat: "forensic",
  name: "ZIP 弱口令爆破",
  desc: "ZIP 加密条目弱口令爆破：ZipCrypto（传统 PKWARE）走 12 字节头快筛+CRC 全量校验；WinZip AES（AE-1/AE-2，method 99）走 WebCrypto PBKDF2-HMAC-SHA1 派生 + pwdVer 快筛 + HMAC-SHA1 认证码确认。内置字典 + 自定义字典 + 纯数字掩码。仅验证密码，不还原明文。数字位数默认 4，硬上限 6（AES 条目数字掩码逐口令 PBKDF2 极慢，建议用字典）。输入 ZIP 的 hex/base64/拖入字节",
  params: [
    { key: "maxDigits", label: "数字掩码位数上限（默认 4，硬上限 6）", type: "number", default: 4 },
    { key: "dict", label: "自定义字典（每行一个密码，可空）", type: "text", default: "", placeholder: "flag\nctf2024\n..." },
  ],
  run: async function (text, p) {
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

    const probe = findEncryptedEntry(zipBytes);
    const isAes = probe.ok && probe.type === "aes";

    const t0 = Date.now();
    let r;
    try {
      r = isAes
        ? await crackWinZipAesWeak(zipBytes, { maxDigits, dict: (p && p.dict) || "" })
        : crackZipCryptoWeak(zipBytes, { maxDigits, dict: (p && p.dict) || "" });
    } catch (e) {
      return "爆破执行失败：" + (e && e.message ? e.message : String(e));
    }
    const ms = Date.now() - t0;

    const lines = [];
    lines.push(isAes ? "=== ZIP 弱口令爆破（WinZip AES AE-1/AE-2）===" : "=== ZIP 弱口令爆破（ZipCrypto）===");
    if (r.error) {
      lines.push("结果: " + r.error);
      if (r.aesDetected && !isAes) {
        lines.push("");
        lines.push("检测到 AES 加密条目，但其 0x9901 extra field 无法解析（结构损坏或数据不完整）。");
      }
      lines.push("提示: 确认输入为含加密条目的 ZIP。伪加密请用「ZIP 结构解析」。");
      return lines.join("\n");
    }

    lines.push("目标条目: " + (r.entryName || "(未命名)"));
    if (isAes && r.aes) {
      const verName = r.aes.aesVersion === 0x0002 ? "AE-2（无 CRC）" : "AE-1（带 CRC）";
      lines.push("加密规格: AES-" + (r.aes.keySize * 8) + "（strength " + r.aes.strength + "）  " + verName + "  PBKDF2-HMAC-SHA1 1000 轮");
    }
    if (clamped) lines.push("注意: maxDigits 已压到硬上限 6。");
    lines.push("尝试次数: " + r.tried.toLocaleString() + "  耗时: " + ms + " ms");
    lines.push("");
    if (r.found) {
      lines.push("命中 ✓  密码: \"" + r.password + "\"  （来源: " + r.method + "）");
      if (isAes) {
        lines.push("");
        lines.push("说明: 该密码通过 2 字节 pwdVer 快筛 + 10 字节 HMAC-SHA1 认证码全量比对双重确认，结果可靠。");
      } else {
        lines.push("");
        lines.push("说明: 该密码通过 12 字节加密头校验字节验证（1/256 误报率，多数情况即正确密码）。");
      }
      lines.push("如需还原明文，用此密码在本地解压工具解开即可。");
    } else {
      lines.push("未命中 ✗");
      lines.push("建议: 增大数字位数上限、补充自定义字典，或密码较复杂时改用离线 hashcat/John。");
    }
    if (r.aesDetected && !isAes) {
      lines.push("");
      lines.push("附注: 归档中另有 AES 加密条目（本次未覆盖）。");
    }
    return lines.join("\n");
  },
  acceptsBytes: true,
});

// 导出纯函数供测试
export {
  crackZipCryptoWeak, crackWinZipAesWeak, aesDeriveKeys, hmacVerify, parseAesExtra,
  verifyPassword, keysFromPassword,
  updateKeys, decryptByte, initKeys, crc32Update,
  findEncryptedEntry, BUILTIN_DICT, inputToZipBytes,
};
