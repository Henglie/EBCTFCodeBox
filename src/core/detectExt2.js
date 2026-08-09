/*
 * detectExt2.js — T99 编码自动检测大表补强（detectExt.js 续）。
 *
 * 职责：为 detectExt.js 未覆盖的 op 补全 detect 识别函数，提升 oneClickDecode
 * （一把梭）识别命中率。与 detectExt.js 互补：两者都 monkey-patch OPS，只给
 * 「缺 detect 且有 decode」的 op 加 detect，互不冲突（顺序无关）。
 *
 * 红线（不变）：
 * - 不改 detectExt.js / detect.js / magic.js，不碰 main.js import 清单（机制四）。
 * - 件内自注册：import 时自动 patch OPS，入口 import 行写回执交 M 归并。
 * - detect 只读不写；置信度策略沿用 detectExt.js：固定变换/字符集明确 0.3-0.5
 * 需密钥/参数 0.1-0.2，自反变换 0.1，纯数字长度特征 0.2-0.4，二进制图像不适用 0。
 * - 编码特征基于公开格式常识与各 op desc，不编造编码表。
 *
 * 覆盖 82 个 op（base7 / 校验5 / 时间10 / radix数学8 / 信号6 / fancy14 /
 * classic4 / text9 / stego5 / analysis2 / modern1 / 颜色地理键盘等归入对应组）。
 */
import { OPS } from "./registry.js";

// ============ 通用工具 ============
const trim = (t) => (t || "").trim();
// 正则 + 最小长度 → 置信度（与 detectExt.js cs 同语义）
const cs = (re, minLen, conf) => (t) => {
  const s = trim(t);
  return re.test(s) && s.length >= minLen ? conf : 0;
};
// 去空白/连字符后的串
const compact = (s) => s.replace(/[\s\-]/g, "");

// ============ DETECTORS2 映射 ============
const DETECTORS2 = {
 // ---- base 变体：已于 C7 合并进 base.js 的 base32/base58/base64 三 op
 // 其 detect 判据（hex/Crockford/base64url 区分性）已迁入各主 op，此处不再补。----

 // ---- 校验位（数字串长度特征）----
  luhn: (t) => {
    const s = compact(trim(t));
    return /^\d{8,19}$/.test(s) ? 0.3 : 0;
  },
  isbn: (t) => {
    const s = compact(trim(t).toUpperCase());
 // ISBN-10（末位可 X）或 ISBN-13
    if (/^\d{9}[\dX]$/.test(s) || /^\d{13}$/.test(s)) return 0.3;
    return 0;
  },
  ean13: (t) => {
    const s = compact(trim(t));
    return /^\d{13}$/.test(s) ? 0.35 : 0;
  },
  cnidCheck: (t) => {
    const s = compact(trim(t).toUpperCase());
 // 18 位身份证，末位可 X
    return /^\d{17}[\dX]$/.test(s) ? 0.45 : 0;
  },
  upc: (t) => {
    const s = compact(trim(t));
    return /^\d{12}$/.test(s) ? 0.3 : 0;
  },

 // ---- 时间戳（纯数字长度特征，多位重叠故偏低）----
  unixTime: (t) => {
    const s = compact(trim(t));
    if (/^-?\d{10}$/.test(s)) return 0.35;       // 秒
    if (/^-?\d{13}$/.test(s)) return 0.35;       // 毫秒
    return 0;
  },
  filetime: (t) => {
    const s = compact(trim(t));
 // Windows FILETIME 1601 纪元 100ns，18-19 位
    return /^\d{18,19}$/.test(s) ? 0.25 : 0;
  },
  hfsTime: (t) => {
    const s = compact(trim(t));
    return /^\d{9,10}$/.test(s) ? 0.12 : 0;
  },
  cocoaTime: (t) => {
    const s = compact(trim(t));
    return /^\d{9,10}$/.test(s) ? 0.12 : 0;
  },
  dosDateTime: (t) => {
    const s = compact(trim(t));
 // DOS 4 字节打包，难从文本判，仅兜底
    return /^\d{1,10}$/.test(s) ? 0.1 : 0;
  },
  chineseDate: (t) => {
    const s = trim(t);
 // 汉字日期：含 年/月/日（〇 U+3007 不在 \u4e00-\u9fff，故用 年月日 锚点）
    return /年[^年]*月[^月]*日/.test(s) ? 0.5 : 0;
  },
  julianDate: (t) => {
    const s = compact(trim(t));
 // 儒略日 ~7 位整数（2451545.0），可带小数
    return /^\d{7}(\.\d+)?$/.test(s) ? 0.2 : 0;
  },
  excelDate: (t) => {
    const s = compact(trim(t));
 // Excel 序列日期 ~5 位（44927），可带小数
    return /^\d{4,5}(\.\d+)?$/.test(s) ? 0.15 : 0;
  },
  chromeTime: (t) => {
    const s = compact(trim(t));
 // Chrome 微秒，16-17 位
    return /^\d{16,17}$/.test(s) ? 0.2 : 0;
  },

 // ---- radix 数学（特征格式）----
  negabase: (t) => {
    const s = trim(t);
 // 负进制：数字串（可带 base 前缀），特征弱
    return /^-?\d+$/.test(s) && s.length >= 2 ? 0.15 : 0;
  },
  balancedTernary: (t) => {
    const s = trim(t);
 // T/0/1 串，T 是强信号
    return /^[T01]+$/.test(s) && s.includes("T") && s.length >= 2 ? 0.4 : 0;
  },
  factorialBase: (t) => {
    const s = trim(t);
 // 阶乘进制：冒号分隔数字
    return /^\d+(:\d+)+$/.test(s) ? 0.3 : 0;
  },
  zeckendorf: (t) => {
    const s = trim(t);
 // Zeckendorf：0/1 串不含连续 1
    return /^[01]+$/.test(s) && s.length >= 2 && !s.includes("11") ? 0.25 : 0;
  },
  roman: (t) => {
    const s = trim(t).toUpperCase();
    return /^[IVXLCDM]+$/.test(s) && s.length >= 1 ? 0.5 : 0;
  },
  chineseNum: (t) => {
    const s = trim(t);
 // 中文数字：含 零一二三四五六七八九十百千万亿负
    return /^[\u96f6\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d\u5341\u767e\u5343\u4e07\u4ebf\u8d1f]+$/.test(s) ? 0.5 : 0;
  },
  continuedFraction: (t) => {
    const s = trim(t).replace(/\s/g, "");
 // [a0;a1,a2,...]
    return /^\[\-?\d+(;\-?\d+(,\-?\d+)*)?\]$/.test(s) ? 0.5 : 0;
  },
  sternBrocot: (t) => {
    const s = trim(t);
 // L/R 路径串
    return /^[LR]+$/.test(s) && s.length >= 1 ? 0.5 : 0;
  },

 // ---- 信号编码（0/1 串，特征弱故偏低）----
  manchester: (t) => {
    const s = trim(t).replace(/\s/g, "");
    return /^[01]+$/.test(s) && s.length >= 4 && s.length % 2 === 0 ? 0.2 : 0;
  },
  diffManchester: (t) => {
    const s = trim(t).replace(/\s/g, "");
    return /^[01]+$/.test(s) && s.length >= 4 ? 0.2 : 0;
  },
  nrzi: (t) => {
    const s = trim(t).replace(/\s/g, "");
    return /^[01]+$/.test(s) && s.length >= 4 ? 0.2 : 0;
  },
  miller: (t) => {
    const s = trim(t).replace(/\s/g, "");
    return /^[01]+$/.test(s) && s.length >= 4 ? 0.2 : 0;
  },
  fourB5B: (t) => {
    const s = trim(t).replace(/\s/g, "");
 // 4B5B：5 位一组
    return /^[01]+$/.test(s) && s.length >= 5 && s.length % 5 === 0 ? 0.25 : 0;
  },
  pwmPpm: (t) => {
    const s = trim(t).replace(/\s/g, "");
    return /^[01]+$/.test(s) && s.length >= 4 ? 0.2 : 0;
  },

 // ---- fancy 键盘/摩斯/声光 ----
  keyboardShift: cs(/^[A-Za-z\s]+$/, 4, 0.1),
  layoutMap: cs(/^[A-Za-z\s]+$/, 4, 0.1),
  t9Phone: (t) => {
    const s = trim(t);
 // T9：键号 2-9 后接按次 1-4，空格分词（如 21=a, 94=z, 00=空格）
    return /^([2-9][1-4]|00)(\s+([2-9][1-4]|00))*$/.test(s) ? 0.4 : 0;
  },
  multitap: (t) => {
    const s = trim(t);
 // 多击：2/22/222/2222, 3-9 同理, 0+/1+，空格分词
    return /^([2-9]{1,4}|0+|1+)(\s+([2-9]{1,4}|0+|1+))*$/.test(s) ? 0.4 : 0;
  },
  kbdFullCoord: (t) => {
    const s = trim(t);
 // 行列坐标 R.C（如 2.1 1.10），空格分隔
    return /^\d+\.\d+(\s+\d+\.\d+)*$/.test(s) ? 0.4 : 0;
  },
  stenoLetter: (t) => {
    const s = trim(t).toUpperCase();
 // 速记和弦：STKPWHR AO*EU FRPBLGTS DZ 等键，特征弱
    return /^[STKPHRAOEUFRPBLGTSDZ#*]+(\s+[STKPHRAOEUFRPBLGTSDZ#*]+)*$/.test(s) && s.length >= 2 ? 0.15 : 0;
  },
  arrowKey: (t) => {
    const s = trim(t);
 // 方向键：含 ↑↓←→ 或纯 WASD/UDLR
    if (/[↑↓←→]/.test(s)) return 0.4;
    if (/^[WASD]+$/i.test(s) && s.length >= 2) return 0.3;
    if (/^[UDLR]+$/i.test(s) && s.length >= 2) return 0.3;
    return 0;
  },
  americanMorse: (t) => {
    const s = trim(t);
 // 美式摩斯：含 . - _ /（_ 为长划，/ 分隔）
    return /^[\.\-_/]+(\s[\.\-_/]+)*$/.test(s) && /[_\.]/.test(s) ? 0.3 : 0;
  },
  cnTelegraphMorse: (t) => {
    const s = trim(t);
 // 中文电码摩斯：4 位数字 ↔ 摩斯，含 . - 和数字
    return /[\.\-]/.test(s) && /\d{4}/.test(s) ? 0.3 : 0;
  },
  tapCode: (t) => {
    const s = trim(t);
 // 敲击码：数字对（1-5），空格分隔；外部工具常输出连写，故一并认（decode 亦已容忍）
    if (/^[1-5][1-5](\s[1-5][1-5])*$/.test(s)) return 0.3;
    return /^[1-5]{4,}$/.test(s) && s.length % 2 === 0 ? 0.3 : 0;
  },
  semaphore: (t) => {
    const s = trim(t).toUpperCase();
 // 旗语：方向对标记，特征弱，仅兜底
    return /^[NSEWUDLR]+(\s[NSEWUDLR]+)*$/.test(s) && s.length >= 2 ? 0.2 : 0;
  },
  morseRhythm: (t) => {
    const s = trim(t);
 // 摩斯节奏：含 · − 或 . -，空格分隔
    if (/[·−]/.test(s)) return 0.4;
    return /^[\.\-]+(\s[\.\-]+)*$/.test(s) && s.length >= 2 ? 0.35 : 0;
  },
  musicNotation: (t) => {
    const s = trim(t);
 // 音名(C4)/MIDI(60)/简谱(1)/唱名(do)，特征杂，低兜底
    if (/^[A-G](#|b)?\d+$/.test(s)) return 0.25;
    if (/^\d{1,3}$/.test(s) && s.length >= 1) return 0.1;
    if (/^(do|re|mi|fa|sol|la|ti|si)$/i.test(s)) return 0.25;
    return 0;
  },

 // ---- classic（字母文本，需密钥，极低兜底）----
  yuanYin: (t) => {
    const s = compact(trim(t));
 // 元音密码：数字串（1-5 元音，两位辅音）
    return /^\d+$/.test(s) && s.length >= 2 ? 0.3 : 0;
  },
  columnReplace: cs(/^[A-Za-z\s]+$/, 6, 0.08),
  rowsReplace: cs(/^[A-Za-z\s]+$/, 6, 0.08),

 // ---- text 字符集（输入即文本，特征弱）----
  gbCharset: (t) => {
    const s = trim(t);
 // GBK 编码的 hex 串（特征弱）
    return /^[0-9a-fA-F\s]+$/.test(s) && s.replace(/\s/g, "").length >= 4 ? 0.1 : 0;
  },
  gb2312QuWei: (t) => {
    const s = trim(t);
 // 区位码：4 位数字组，空格分隔（不用 compact，正则需保留分隔）
    return /^(\d{4})(\s+\d{4})*$/.test(s) ? 0.3 : 0;
  },
  big5: (t) => {
    const s = trim(t);
    return /^[0-9a-fA-F\s]+$/.test(s) && s.replace(/\s/g, "").length >= 4 ? 0.1 : 0;
  },
  shiftJis: (t) => {
    const s = trim(t);
    return /^[0-9a-fA-F\s]+$/.test(s) && s.replace(/\s/g, "").length >= 4 ? 0.1 : 0;
  },
  eucKr: (t) => {
    const s = trim(t);
    return /^[0-9a-fA-F\s]+$/.test(s) && s.replace(/\s/g, "").length >= 4 ? 0.1 : 0;
  },
  latinCharset: (t) => {
    const s = trim(t);
    return /^[0-9a-fA-F\s]+$/.test(s) && s.replace(/\s/g, "").length >= 4 ? 0.1 : 0;
  },
  ebcdic: (t) => {
    const s = trim(t);
    return /^[0-9a-fA-F\s]+$/.test(s) && s.replace(/\s/g, "").length >= 4 ? 0.1 : 0;
  },
  utf16: (t) => {
    const s = trim(t).replace(/\s/g, "");
 // UTF-16 hex（偶数 4 位组）或含 BOM FF FE / FE FF
    if (/^(fffe|feff)/i.test(s) && /^[0-9a-fA-F]+$/.test(s) && s.length >= 8) return 0.3;
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 8 && s.length % 4 === 0 ? 0.15 : 0;
  },
  mojibakeFix: (t) => {
    const s = trim(t);
 // 乱码特征：Ã Â ¥ ¦ § ¨ © 等 mojibake 高频字符
    return /[\u00c0-\u00ff]/.test(s) && /[ÃÂ¥¦§¨©¶º¿]/.test(s) ? 0.3 : 0;
  },

 // ---- stego（图像/二进制，文本 detect 多不适用）----
  qrDecode: (t) => {
    const s = trim(t);
 // QR 0/1 矩阵（多行 0/1）
    if (!/^[01\s]+$/.test(s)) return 0;
    const lines = s.split(/\n/).map((x) => x.trim()).filter(Boolean);
    return lines.length >= 5 && lines.every((l) => /^[01]+$/.test(l)) ? 0.2 : 0;
  },
  lsbImage: () => 0,        // 输入为图像字节，文本 detect 不适用
  pixelJihad: () => 0,
  pngText: (t) => {
    const s = trim(t);
 // PNG base64：含 iVBOR 开头（PNG base64 特征）
    return /^iVBORw0KGgo/.test(s) ? 0.3 : 0;
  },

 // ---- analysis ----
  deflateRawCodec: (t) => {
    const s = trim(t).replace(/\s/g, "");
 // raw deflate 二进制 hex，特征弱
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 8 ? 0.1 : 0;
  },
  rsaModinv: (t) => {
    const s = trim(t);
 // 模逆：两数字（a, m）
    return /^-?\d+[\s,]+-?\d+$/.test(s) ? 0.2 : 0;
  },

 // ---- modern ----
  b64urlJson: (t) => {
    const s = trim(t);
 // base64url 串（可能解码出 JSON）
    return /^[A-Za-z0-9\-_]+$/.test(s) && s.length >= 8 ? 0.3 : 0;
  },

 // ---- 颜色 / 地理（radix cat 内但功能独立）----
  color: (t) => {
    const s = trim(t);
 // 颜色：#hex / rgb/hsl（颜色名检测复杂，仅强特征命中）
    if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return 0.5;
    if (/^rgba?\(/i.test(s) || /^hsla?\(/i.test(s)) return 0.5;
    return 0;
  },
  geoDms: (t) => {
    const s = trim(t);
 // 度分秒：含 ° ′ ″ 或 N/S/E/W
    return /[\u00b0\u2032\u2033]/.test(s) || /^\d+(\.\d+)?[NSEW]$/i.test(s) ? 0.4 : 0;
  },
  geoHash: (t) => {
    const s = trim(t);
 // geohash：base32 去元音 a/i/l/o，小写
    return /^[0-9bcdefghjkmnpqrstuvwxyz]+$/i.test(s) && s.length >= 4 ? 0.4 : 0;
  },
  geoPlusCode: (t) => {
    const s = trim(t);
 // Plus Code：含 + 分隔，字母表 23456789CFGHJMPQRVWX
    return /^[23456789CFGHJMPQRVWX]+(\+[23456789CFGHJMPQRVWX]+)?$/.test(s) && s.includes("+") ? 0.5 : 0;
  },
  geoMaidenhead: (t) => {
    const s = trim(t).toUpperCase();
 // Maidenhead：2 字母+2 数字起，可扩展（如 FN31pr）
    return /^[A-R]{2}[0-9]{2}([A-X]{2}([0-9]{2})?)?$/.test(s) ? 0.5 : 0;
  },
  geoUtm: (t) => {
    const s = trim(t);
 // UTM：区号+字母带+东距+北距（如 31U 448251 5411937）
    return /^\d{1,2}[A-HJ-NP-Z]\s+\d+\s+\d+$/.test(s) ? 0.5 : 0;
  },

 // ---- 位运算（hex 串，特征弱）----
  bitReverse: (t) => {
    const s = trim(t).replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 2 && s.length % 2 === 0 ? 0.12 : 0;
  },
  bitRotate: (t) => {
    const s = trim(t).replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 2 && s.length % 2 === 0 ? 0.12 : 0;
  },
  byteSwap: (t) => {
    const s = trim(t).replace(/\s/g, "");
    return /^[0-9a-fA-F]+$/.test(s) && s.length >= 4 && s.length % 2 === 0 ? 0.12 : 0;
  },

 // ---- 网络 ----
  ipv4Int: (t) => {
    const s = trim(t);
 // IPv4 点分 或 纯整数
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return 0.4;
    if (/^\d+$/.test(s) && s.length >= 1) return 0.15;
    return 0;
  },
  ipv6Format: (t) => {
    const s = trim(t);
 // IPv6：含 : 且 hex
    return /^[0-9a-fA-F:]+$/.test(s) && s.includes(":") && s.length >= 2 ? 0.4 : 0;
  },
};

// ============ monkey-patch：给 detectExt.js 未覆盖的 op 补 detect ============
let patched = 0;
const patchedIds = [];
for (const op of OPS) {
  if (typeof op.detect !== "function" && typeof op.decode === "function" && DETECTORS2[op.id]) {
    op.detect = DETECTORS2[op.id];
    patched++;
    patchedIds.push(op.id);
  }
}

// ============ 诊断导出（供测试/审计）============
export const DETECT2_PATCHED = patchedIds;
export function detectAuditStats2() {
  const withDetect = OPS.filter((o) => typeof o.detect === "function");
  const without = OPS.filter((o) => typeof o.detect !== "function" && typeof o.decode === "function");
  return {
    total: OPS.length,
    withDetect: withDetect.length,
    decodableWithoutDetect: without.map((o) => o.id),
    detect2Patched: patchedIds.length,
  };
}

console.log(`[detectExt2] patched ${patched} ops: ${patchedIds.join(", ")}`);
