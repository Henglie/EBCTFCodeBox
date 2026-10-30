/*
 * qrText.js — 二维码文本编码修复（GBK/GB18030 被当成 Latin-1 的乱码）
 *
 * 背景：ZXing 的 ReadResult 同时给 `text`（引擎按启发式/ECI 还原的文本）和 `bytes`
 * （符号里真正承载的字节）。国内实际物料（demo1_enhanced.png 等）常把 GBK 字节写进
 * 字节模式段，引擎在部分分段上按 Latin-1 还原，于是 `text` 出现 `ËÕÖÝ´óÑ§` 这类
 * 「Latin-1 外衣 + 真中文混排」；而 `bytes` 用 GB18030 解码即为原文。
 *
 * 本模块只做**文本层修复**：不碰几何、不碰解码，也不猜测没有字节证据的内容。
 * 判据（宁可少改，不改坏正常 UTF-8）：
 *   ① bytes 与 text 在 UTF-8 下完全一致 → 直接返回（正常 UTF-8 永不改动）；
 *   ② bytes 是合法 UTF-8 → 仅当 UTF-8 解码在「汉字更多、坏字符不增」时采用；
 *   ③ 否则用 TextDecoder("gb18030") 解码 bytes，仅当原文本有明显乱码证据
 *      （控制符 / 替换符 / 高密度 Latin-1 字符），且候选的汉字显著更多、
 *      可疑字符更少、坏字符不增、综合分明显更优时才替换。
 *
 * 纯计算、零依赖、浏览器/Node 通用；TextDecoder 不可用或解码失败时原样返回。
 */

// Han 统一表意文字（含扩展 A/B~F 兼容区）；用码点判断，避免正则属性转义的兼容性差异。
function isHanCodePoint(cp) {
  return (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0x20000 && cp <= 0x2fa1f);
}

function toBytes(bytes) {
  if (!bytes) return null;
  if (bytes instanceof Uint8Array) return bytes;
  if (typeof ArrayBuffer !== "undefined" && bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (Array.isArray(bytes)) {
    try { return Uint8Array.from(bytes); } catch { return null; }
  }
  return null;
}

/**
 * 文本质量度量（越大越好）：
 *   han  汉字数（核心正向证据）
 *   bad  替换符 / C0/C1 控制符（乱码强证据，重罚）
 *   susp Latin-1 补充区字符（GBK 字节被按 Latin-1 显示时会成片出现）
 */
function textMetrics(s) {
  let han = 0, bad = 0, susp = 0, visible = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d) continue;
    visible++;
    if (isHanCodePoint(cp)) han++;
    else if (cp === 0xfffd) bad += 3;
    else if (cp === 0x7f || (cp < 0x20 && cp !== 0x09 && cp !== 0x0a && cp !== 0x0d)) bad += 3;
    else if (cp >= 0x80 && cp <= 0x9f) bad += 2;
    else if (cp >= 0xa0 && cp <= 0xff) susp++;
  }
  return { han, bad, susp, visible, len: s.length };
}

function quality(m) {
  return m.han * 2 - m.bad * 6 - m.susp;
}

/** 原文本是否有足够强的乱码证据（正常中文/英文 + 少量重音符不算）。 */
function looksMojibake(m) {
  if (m.bad > 0) return true;
  if (m.han > 0 && m.susp >= 2) return true;
  return m.susp >= 3 && m.susp * 2 >= m.visible;
}

function decodeStrict(data, encoding) {
  if (typeof TextDecoder !== "function") return null;
  try {
    return new TextDecoder(encoding, { fatal: true }).decode(data);
  } catch {
    return null;
  }
}

/**
 * 修复二维码文本的编码误判。
 * @param {string} text    ZXing ReadResult.text
 * @param {Uint8Array|ArrayBuffer|number[]|null} bytes  ReadResult.bytes（符号原始字节）
 * @returns {string} 修复后的文本；无把握时原样返回 text
 */
export function fixQrText(text, bytes) {
  if (typeof text !== "string" || text.length === 0) return text;
  const data = toBytes(bytes);
  if (!data || data.length === 0) return text;

  // ① 正常 UTF-8：字节解码与文本完全一致，绝不改动。
  const utf8 = decodeStrict(data, "utf-8");
  if (utf8 === text) return text;

  const mt = textMetrics(text);

  // ② 字节本身是合法 UTF-8：只在文本明显是「UTF-8 被按 Latin-1 显示」时改回。
  if (utf8 !== null) {
    const mu = textMetrics(utf8);
    if (mu.bad <= mt.bad && mu.han > mt.han && quality(mu) - quality(mt) >= 2) return utf8;
    return text;
  }

  // ③ 非 UTF-8 字节：按 GB18030 还原，并与原文本比较。
  let gbk = decodeStrict(data, "gb18030");
  if (gbk === null) {
    try { gbk = new TextDecoder("gb18030").decode(data); }
    catch { return text; }
  }
  if (!gbk || gbk === text || !looksMojibake(mt)) return text;

  const mg = textMetrics(gbk);
  if (mg.bad > mt.bad) return text;          // 候选引入坏字符 → 拒绝
  if (mg.susp >= mt.susp) return text;       // 可疑 Latin-1 字符没有减少 → 拒绝
  if (mg.han - mt.han < 2) return text;      // 汉字增益不足 → 视为噪声，不换
  if (quality(mg) - quality(mt) < 2) return text;
  return gbk;
}

/**
 * 文本载荷类型（仅供多符号排序用）：
 *   "flag"   flag{...} / CTF{...} / FLAG IS ... 这类结构
 *   "url"    http(s)/ftp/www 链接
 *   "email"  邮箱
 *   "normal" 其余
 */
export function qrPayloadKind(text) {
  const s = String(text == null ? "" : text);
  if (/\b(?:flag|ctf|key|pass(?:word)?|secret|answer|token)\s*\{[^{}\r\n]{1,}\}/i.test(s) ||
      /\b[A-Za-z][A-Za-z0-9_]{1,15}\{[^{}\r\n]{2,}\}/.test(s) ||
      /\bflag\s*(?:is|:|=)\s*\S+/i.test(s)) return "flag";
  if (/\b(?:https?|ftp):\/\/[^\s]+/i.test(s) || /^www\./i.test(s.trim())) return "url";
  if (/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s)) return "email";
  return "normal";
}

export default { fixQrText, qrPayloadKind };
