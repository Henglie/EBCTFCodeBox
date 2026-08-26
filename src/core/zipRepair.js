/*
 * zipRepair.js — ZIP 伪加密修复 / 置位（T346，cat:'forensic'，一对互逆 op）。
 *
 * 场景：ZIP「伪加密」= 通用位标志（General Purpose Bit Flag）的加密位 bit0 被
 * 置 1，但压缩数据本身没加密 —— 解压软件据此误报「需要密码」。
 * 「修复」清掉标志位即可正常解压；「置位」是逆操作，用于出题与演示。
 *
 * 精确路径（不扫描字节流，避免误伤压缩数据里恰好像 PK 签名的字节序列）：
 *   EOCD(50 4B 05 06，从尾部往前找，尾部注释最长 65535)
 *     偏移 10: 条目总数(2 LE)      偏移 16: 中央目录偏移(4 LE)
 *   → 逐条中央目录头 CDH(50 4B 01 02，定长 46 + 名/扩展/注释)
 *     偏移 8:  通用位标志(2 LE)    ← 清/置 bit0（可连带 bit6 强加密位）
 *     偏移 28/30/32: 名长/扩展长/注释长(2 LE)
 *     偏移 42: 本地文件头偏移(4 LE)
 *   → 对应本地文件头 LFH(50 4B 03 04)
 *     偏移 6:  通用位标志(2 LE)    ← 同步清/置
 *
 * 格式依据：PKWARE .ZIP File Format Specification（APPNOTE 6.3.x）
 * §4.3.7 本地文件头、§4.3.12 中央目录结构、§4.3.16 EOCD、§4.4 通用位标志定义
 * （bit0=加密、bit6=强加密、bit11=UTF-8 文件名）。
 *
 * 输出：报告 + 改写后 base64（对齐本类目图像修复 op 的「报告+产物」形态）。
 * 输入：text 为 base64（可带 dataURL 前缀），或 p.rawBytes 直传 Uint8Array。
 * 边界：RAR 头明确拒绝（结构不同，仅检测）；ZIP64 大档（计数值/偏移顶格
 * 0xFFFF/0xFFFFFFFF）拒绝；文件头非 PK 不拒绝（拼接文件场景，EOCD 精确路径
 * 不依赖文件头），报告给提示行。
 *
 * 回归断言：加载期自检 IIFE（自搓 Stored 测试 ZIP 构造器：LFH/CDH/EOCD +
 * 标准 CRC32，覆盖伪加密→修复逐字节还原、多条目、bit6 连带、置位互逆闭环、
 * RAR/非 ZIP/截断边界、base64 文本输入路径）。
 */
import { register } from "./registry.js";

// ============ 通用工具（自包含） ============

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
  throw new Error("无 btoa/Buffer，无法编码 base64");
}

const u16le = (b, o) => (b[o] | (b[o + 1] << 8)) >>> 0;
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] * 0x1000000)) >>> 0;
function setU16le(b, o, v) { b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; }

const LFH_SIG = [0x50, 0x4B, 0x03, 0x04];
const CDH_SIG = [0x50, 0x4B, 0x01, 0x02];
const EOCD_SIG = [0x50, 0x4B, 0x05, 0x06];

function isSig(b, o, sig) {
  return b[o] === sig[0] && b[o + 1] === sig[1] && b[o + 2] === sig[2] && b[o + 3] === sig[3];
}

/** 定位 EOCD（50 4B 05 06）：从尾部往前找（EOCD 定长 22 + 注释最长 65535）。 */
function findEocd(b) {
  if (b.length < 22) return -1;
  const start = Math.max(0, b.length - 22 - 65535);
  for (let i = b.length - 22; i >= start; i--) {
    if (isSig(b, i, EOCD_SIG)) return i;
  }
  return -1;
}

// ============ 核心：EOCD→CD→LFH 精确路径改写通用位标志 ============

/**
 * 沿精确路径逐条改写通用位标志（原地修改 bytes）。
 * 拼接文件（图片/垃圾字节 + ZIP）场景：EOCD 里的偏移是 ZIP 相对值，前面有前缀时
 * 用「CD 紧贴 EOCD 之前」的常见布局反推真实 CD 位置（eocd - cdSize），差值即前缀
 * 长度，LFH 偏移同步平移——与主流解压器的偏移修正思路一致。反推位置验不出 CDH
 * 签名时不修正（可能隔了 ZIP64 记录等），按声明值走。
 * @param {Uint8Array} bytes ZIP 字节
 * @param {"clear"|"set"} action clear=清除 bit0（可连带 bit6）；set=置位 bit0
 * @param {boolean} withStrong 仅 clear 生效：连带清强加密位 bit6
 * @returns {{scanned:number, changed:number, lfhChanged:number, delta:number, details:Array}}
 *   changed 计 CDH 位标志发生变化的条数；delta=前缀修正字节数；details 含每条前后值
 * @throws {Error} 无 EOCD / ZIP64 / 中央目录解析失败
 */
function rewriteFlagBits(bytes, action, withStrong) {
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error("找不到 ZIP 中央目录（EOCD），文件可能截断或不是 ZIP。");
  const count = u16le(bytes, eocd + 10);
  const cdSize = u32le(bytes, eocd + 12);
  const cdOff = u32le(bytes, eocd + 16);
  if (count === 0xFFFF || cdOff === 0xFFFFFFFF) {
    throw new Error("疑似 ZIP64 大档（条目数/偏移顶格），暂不支持。");
  }

  // 前缀修正：声明 CD 位置验不出签名、而按 EOCD 反推的位置验得出 → 拼接文件
  let delta = 0;
  let cur = cdOff;
  if (cdOff + 46 > bytes.length || !isSig(bytes, cdOff, CDH_SIG)) {
    const cdActual = eocd - cdSize;
    if (cdActual > 0 && cdActual + 46 <= bytes.length && isSig(bytes, cdActual, CDH_SIG)) {
      delta = cdActual - cdOff;
      cur = cdActual;
    }
  }

  const details = [];
  let changed = 0, lfhChanged = 0;
  for (let idx = 0; idx < count; idx++) {
    if (cur + 46 > bytes.length || !isSig(bytes, cur, CDH_SIG)) {
      throw new Error(`中央目录第 ${idx + 1} 条解析失败（可能是 ZIP64 或文件损坏）。`);
    }
    const nameLen = u16le(bytes, cur + 28);
    const extraLen = u16le(bytes, cur + 30);
    const commentLen = u16le(bytes, cur + 32);
    const lfhOff = u32le(bytes, cur + 42) + delta; // 声明值 + 前缀修正 → 绝对偏移
    const nameStart = cur + 46;
    let name = "(空名)";
    if (nameStart + nameLen <= bytes.length && nameLen > 0) {
      try { name = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLen)); }
      catch { name = "(解码失败)"; }
    }

    // 中央目录头通用位标志 @ +8
    const cdFlag = u16le(bytes, cur + 8);
    const newCd = action === "set"
      ? (cdFlag | 0x0001) >>> 0
      : (cdFlag & (withStrong ? 0xFFBE : 0xFFFE)) >>> 0;

    // 对应本地文件头通用位标志 @ +6（LFH 偏移按 CDH 声明值；未命中不视为错误）
    let lfhOk = false, lfFlag = 0, newLf = 0;
    if (lfhOff + 8 <= bytes.length && isSig(bytes, lfhOff, LFH_SIG)) {
      lfhOk = true;
      lfFlag = u16le(bytes, lfhOff + 6);
      newLf = action === "set"
        ? (lfFlag | 0x0001) >>> 0
        : (lfFlag & (withStrong ? 0xFFBE : 0xFFFE)) >>> 0;
    }

    if (newCd !== cdFlag) { setU16le(bytes, cur + 8, newCd); changed++; }
    if (lfhOk && newLf !== lfFlag) { setU16le(bytes, lfhOff + 6, newLf); lfhChanged++; }
    details.push({ name, cdFlag, newCd, lfhOk, lfFlag, newLf, lfhOff });

    cur += 46 + nameLen + extraLen + commentLen;
  }
  return { scanned: count, changed, lfhChanged, delta, details, eocd, cdOff };
}

const hex4 = (v) => "0x" + v.toString(16).padStart(4, "0");

/** 输入统一：rawBytes 直传（拷贝一份，改写不污染调用方）或 base64 文本。 */
function inputZipBytes(text, p) {
  let src;
  if (p && p.rawBytes && p.rawBytes.length) {
    src = p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  } else {
    if (!text || !String(text).trim()) throw new Error("（空输入）请拖入 ZIP 文件或粘贴其 base64。");
    src = b64ToBytes(text);
  }
  return new Uint8Array(src); // 拷贝：本 op 原地改写
}

/** 头部快检：RAR 明确拒绝；非 PK 头不拒绝（拼接文件场景），返回提示行或 null。 */
function headCheck(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0x52 && bytes[1] === 0x61 && bytes[2] === 0x72 && bytes[3] === 0x21) {
    throw new Error("检测到 RAR。RAR 伪加密结构复杂，本工具暂不修复；请用解压工具或专门工具处理。");
  }
  if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4B) return "文件头非 PK（可能是拼接文件），按尾部 EOCD 精确解析。";
  return null;
}

// ============ op 1：ZIP 伪加密修复（清除） ============

function zipRepairRun(text, p) {
  const bytes = inputZipBytes(text, p);
  const headNote = headCheck(bytes);
  const withStrong = !!(p && p.clearStrong);

  const r = rewriteFlagBits(bytes, "clear", withStrong);

  const lines = [];
  lines.push(`ZIP 伪加密修复（文件 ${bytes.length} 字节，条目 ${r.scanned} 个，EOCD @ 0x${r.eocd.toString(16)}，中央目录 @ 0x${r.cdOff.toString(16)}${withStrong ? "，连带清强加密位 bit6" : ""}）`);
  if (headNote) lines.push(headNote);
  if (r.delta > 0) lines.push(`检测到前缀 ${r.delta} 字节（拼接文件），偏移已按前缀修正。`);

  if (r.changed === 0 && r.lfhChanged === 0) {
    lines.push(`扫描 ${r.scanned} 个条目，未发现伪加密位（没有条目置了加密位），文件未改动。`);
    return lines.join("\n");
  }

  lines.push(`修复完成：${r.scanned} 个条目中清除了 ${r.changed} 个加密位${withStrong ? "（含强加密位 bit6）" : ""}（LFH 同步清 ${r.lfhChanged} 处）。`);
  lines.push("明细：");
  r.details.forEach((d, i) => {
    const lf = d.lfhOk
      ? (d.newLf !== d.lfFlag ? `LFH ${hex4(d.lfFlag)}→${hex4(d.newLf)}` : `LFH ${hex4(d.lfFlag)}（未变）`)
      : `LFH 未命中 @0x${d.lfhOff.toString(16)}`;
    lines.push(`  [${i + 1}] ${d.name}  CDH ${hex4(d.cdFlag)}→${hex4(d.newCd)}，${lf}`);
  });
  lines.push("注意：若清位后解压仍报密码错或数据乱码，说明是真加密（ZipCrypto/AES）而非伪加密——需口令爆破（ZIP 弱口令爆破）而非清位。");
  lines.push("");
  lines.push("修复后 base64：");
  lines.push(bytesToB64(bytes));
  return lines.join("\n");
}

// ============ op 2：ZIP 伪加密置位（伪造） ============

function zipPseudoEncryptRun(text, p) {
  const bytes = inputZipBytes(text, p);
  const headNote = headCheck(bytes);

  const r = rewriteFlagBits(bytes, "set", false);

  const lines = [];
  lines.push(`ZIP 伪加密置位（文件 ${bytes.length} 字节，条目 ${r.scanned} 个，EOCD @ 0x${r.eocd.toString(16)}）`);
  if (headNote) lines.push(headNote);
  if (r.delta > 0) lines.push(`检测到前缀 ${r.delta} 字节（拼接文件），偏移已按前缀修正。`);

  if (r.changed === 0 && r.lfhChanged === 0) {
    lines.push(`扫描 ${r.scanned} 个条目，全部已置位（bit0 原本就是 1），文件未改动。`);
    return lines.join("\n");
  }

  lines.push(`置位完成：${r.scanned} 个条目中置位 ${r.changed} 个（LFH 同步置 ${r.lfhChanged} 处）。`);
  lines.push("明细：");
  r.details.forEach((d, i) => {
    const lf = d.lfhOk
      ? (d.newLf !== d.lfFlag ? `LFH ${hex4(d.lfFlag)}→${hex4(d.newLf)}` : `LFH ${hex4(d.lfFlag)}（未变）`)
      : `LFH 未命中 @0x${d.lfhOff.toString(16)}`;
    lines.push(`  [${i + 1}] ${d.name}  CDH ${hex4(d.cdFlag)}→${hex4(d.newCd)}，${lf}`);
  });
  lines.push("说明：伪加密只改标志位、不动数据——解压软件会误报「需要密码」。逆操作用「ZIP 伪加密修复」。");
  lines.push("");
  lines.push("置位后 base64：");
  lines.push(bytesToB64(bytes));
  return lines.join("\n");
}

// ============ 自检用手搓 Stored 测试 ZIP（LFH/CDH/EOCD + 标准 CRC32） ============

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** 标准 CRC-32/ISO-HDLC（IEEE 802.3，与 ZIP 一致），测试构造器用。 */
export function crc32Bytes(data) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) c = (CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8)) >>> 0;
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 手搓极小 Stored ZIP（method 0，无压缩）：LFH + CDH + EOCD 全手写，
 * CRC32 按数据实算，结构合法可供外部解压器读取。
 * @param {Array<{name:string, data:string|Uint8Array}>} files
 */
export function makeStoredZip(files) {
  const parts = [];
  const push = (...bs) => { for (const b of bs) parts.push(b & 0xFF); };
  const pushU16 = (v) => push(v & 0xFF, (v >>> 8) & 0xFF);
  const pushU32 = (v) => push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
  const toBytes = (s) => (typeof s === "string" ? Array.from(s, (c) => c.charCodeAt(0) & 0xFF) : Array.from(s));

  const entries = [];
  for (const f of files) {
    const nameB = toBytes(f.name), dataB = toBytes(f.data);
    const lfhOff = parts.length;
    push(0x50, 0x4B, 0x03, 0x04);
    pushU16(0x0014); pushU16(0x0000); pushU16(0x0000); // 版本 / flag=0 / method=0 Stored
    pushU16(0x4800); pushU16(0x5987); // 时间 / 日期（任意合法值）
    pushU32(crc32Bytes(dataB)); pushU32(dataB.length); pushU32(dataB.length);
    pushU16(nameB.length); pushU16(0);
    for (const b of nameB) push(b);
    for (const b of dataB) push(b);
    entries.push({ nameB, dataB, lfhOff });
  }
  const cdOff = parts.length;
  for (const e of entries) {
    push(0x50, 0x4B, 0x01, 0x02);
    pushU16(0x031E); pushU16(0x0014); // 制作版本(UNIX·3.30) / 需要版本
    pushU16(0x0000); pushU16(0x0000); // flag=0 / method=0
    pushU16(0x4800); pushU16(0x5987);
    pushU32(crc32Bytes(e.dataB)); pushU32(e.dataB.length); pushU32(e.dataB.length);
    pushU16(e.nameB.length); pushU16(0); pushU16(0); // 名长 / 扩展长 / 注释长
    pushU16(0); pushU16(0); pushU32(0); // 起始盘号 / 内部属性 / 外部属性
    pushU32(e.lfhOff);
    for (const b of e.nameB) push(b);
  }
  const cdSize = parts.length - cdOff;
  push(0x50, 0x4B, 0x05, 0x06);
  pushU16(0); pushU16(0); pushU16(entries.length); pushU16(entries.length);
  pushU32(cdSize); pushU32(cdOff); pushU16(0);
  return new Uint8Array(parts);
}

/** 模拟出题手法：全文件扫 PK 头，把 LFH(+6)/CDH(+8) 的 bit0 全置 1。 */
function setFakeEncryption(src) {
  const d = new Uint8Array(src);
  for (let i = 0; i + 10 <= d.length; i++) {
    if (isSig(d, i, LFH_SIG)) {
      const f = u16le(d, i + 6) | 1;
      setU16le(d, i + 6, f);
    } else if (isSig(d, i, CDH_SIG)) {
      const f = u16le(d, i + 8) | 1;
      setU16le(d, i + 8, f);
    }
  }
  return d;
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 全条目 CDH(+8)/LFH(+6) 的 bit0 是否全为 1。 */
function allEncrypted(b) {
  const eo = findEocd(b);
  const count = u16le(b, eo + 10);
  let cur = u32le(b, eo + 16);
  let all = true;
  for (let i = 0; i < count; i++) {
    const n = u16le(b, cur + 28), m = u16le(b, cur + 30), k = u16le(b, cur + 32);
    const lo = u32le(b, cur + 42);
    if ((u16le(b, cur + 8) & 1) !== 1) all = false;
    if (lo + 8 <= b.length && isSig(b, lo, LFH_SIG) && (u16le(b, lo + 6) & 1) !== 1) all = false;
    cur += 46 + n + m + k;
  }
  return all;
}

// ============ 加载期自检（import 即跑） ============

(() => {
  // ① 单条目伪加密 → 修复 → 报告命中 + 逐字节还原为原始 ZIP
  const plain = makeStoredZip([{ name: "flag.txt", data: "flag{fake_encryption}" }]);
  let out = zipRepairRun("", { rawBytes: setFakeEncryption(plain) });
  if (!out.includes("修复完成") || !out.includes("清除了 1 个加密位")) throw new Error(`zipRepair 自检①失败：\n${out}`);
  let fixed = b64ToBytes(out.split("\n").pop());
  if (!bytesEqual(fixed, plain)) throw new Error("zipRepair 自检①失败：修复后未逐字节还原");

  // ② 干净 ZIP：未发现伪加密位，不输出 base64
  out = zipRepairRun("", { rawBytes: plain });
  if (!out.includes("未发现伪加密位") || out.includes("base64")) throw new Error(`zipRepair 自检②失败：\n${out}`);

  // ③ 多条目：2 条全清，逐字节还原
  const two = makeStoredZip([{ name: "a.txt", data: "AAA" }, { name: "b.txt", data: "BBBB" }]);
  out = zipRepairRun("", { rawBytes: setFakeEncryption(two) });
  if (!out.includes("清除了 2 个加密位")) throw new Error(`zipRepair 自检③失败：\n${out}`);
  if (!bytesEqual(b64ToBytes(out.split("\n").pop()), two)) throw new Error("zipRepair 自检③失败：多条目未还原");

  // ④ bit6 连带：flag 置 0x41 后，默认只清 bit0（留 0x40），clearStrong 才全清
  const strong = new Uint8Array(plain);
  const eo = findEocd(strong), cd = u32le(strong, eo + 16);
  setU16le(strong, 6, 0x0041);      // LFH @0 偏移 6（单条目 LFH 必在 0）
  setU16le(strong, cd + 8, 0x0041); // CDH 偏移 8
  out = zipRepairRun("", { rawBytes: strong });
  if (!out.includes("0x0041→0x0040")) throw new Error(`zipRepair 自检④失败（bit6 应保留）：\n${out}`);
  out = zipRepairRun("", { rawBytes: strong, clearStrong: true });
  if (!bytesEqual(b64ToBytes(out.split("\n").pop()), plain)) throw new Error("zipRepair 自检④失败：clearStrong 未全清");

  // ⑤ 置位互逆闭环：置位后全条目 bit0=1，再修复逐字节还原
  out = zipPseudoEncryptRun("", { rawBytes: plain });
  const encBytes = b64ToBytes(out.split("\n").pop());
  if (!allEncrypted(encBytes)) throw new Error("zipPseudoEncrypt 自检⑤失败：置位不全");
  out = zipRepairRun("", { rawBytes: encBytes });
  if (!bytesEqual(b64ToBytes(out.split("\n").pop()), plain)) throw new Error("zipPseudoEncrypt 自检⑤失败：闭环未还原");
  // 已全置位再置位：报告未改动
  out = zipPseudoEncryptRun("", { rawBytes: encBytes });
  if (!out.includes("文件未改动")) throw new Error(`zipPseudoEncrypt 自检⑤失败：\n${out}`);

  // ⑥ RAR 头：明确拒绝
  let threw = false, msg = "";
  try { zipRepairRun("", { rawBytes: new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0x01, 0x00]) }); }
  catch (e) { threw = true; msg = String(e && e.message); }
  if (!threw || !msg.includes("RAR")) throw new Error(`zipRepair 自检⑥失败：${msg}`);

  // ⑦ 非 ZIP（无 PK 头无 EOCD）：报找不到 EOCD
  threw = false; msg = "";
  try { zipRepairRun("", { rawBytes: new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]) }); }
  catch (e) { threw = true; msg = String(e && e.message); }
  if (!threw || !msg.includes("EOCD")) throw new Error(`zipRepair 自检⑦失败：${msg}`);

  // ⑧ 截断（砍掉 CD+EOCD）：报截断
  const eocdOff = findEocd(plain);
  threw = false; msg = "";
  try { zipRepairRun("", { rawBytes: plain.slice(0, eocdOff - 10) }); }
  catch (e) { threw = true; msg = String(e && e.message); }
  if (!threw || !msg.includes("EOCD")) throw new Error(`zipRepair 自检⑧失败：${msg}`);

  // ⑨ base64 文本输入路径（无 rawBytes）
  out = zipRepairRun(bytesToB64(setFakeEncryption(plain)), {});
  if (!out.includes("清除了 1 个加密位") || !bytesEqual(b64ToBytes(out.split("\n").pop()), plain)) {
    throw new Error("zipRepair 自检⑨失败：base64 文本输入路径异常");
  }

  // ⑩ 拼接文件：前缀垃圾字节 + ZIP。EOCD 声明偏移是 ZIP 相对值 → 前缀修正
  //    （eocd - cdSize 反推真实 CD）后 CDH/LFH 均命中，修复后逐字节还原拼接原件
  const glued = new Uint8Array(16 + plain.length);
  glued.set(Array.from("GIF89a-fake-img", (c) => c.charCodeAt(0)), 0);
  glued.set(plain, 16);
  const gluedFaked = setFakeEncryption(glued);
  out = zipRepairRun("", { rawBytes: gluedFaked });
  if (!out.includes("文件头非 PK") || !out.includes("前缀 16 字节") || out.includes("LFH 未命中")) {
    throw new Error(`zipRepair 自检⑩失败：\n${out}`);
  }
  if (!bytesEqual(b64ToBytes(out.split("\n").pop()), glued)) {
    throw new Error("zipRepair 自检⑩失败：拼接件未逐字节还原");
  }
})();

// ============ register ============

register({
  id: "zipRepair", cat: "forensic", name: "ZIP 伪加密修复",
  desc: "清除中央目录与本地文件头通用位标志的加密位（bit0，可连带强加密位 bit6）。走 EOCD→中央目录→本地头精确路径，不误伤压缩数据。伪加密=标志位被置 1 但数据未加密，清位即可正常解压；输出修复后 base64",
  params: [
    { key: "clearStrong", label: "同时清强加密位(bit6)", type: "bool", default: false },
  ],
  run: zipRepairRun,
  acceptsBytes: true,
});

register({
  id: "zipPseudoEncrypt", cat: "forensic", name: "ZIP 伪加密（置位）",
  desc: "把中央目录与本地文件头的加密位（bit0）置 1 而不动数据——制造「需要密码」假象，「ZIP 伪加密修复」的逆操作，可用于出题与演示；输出置位后 base64",
  params: [],
  run: zipPseudoEncryptRun,
  acceptsBytes: true,
});

export {
  zipRepairRun,
  zipPseudoEncryptRun,
  rewriteFlagBits,
  findEocd,
};
