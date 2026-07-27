/*
 * detectExt3.js — detect 时序补丁（detectExt2.js 续）。
 *
 * 背景：detectExt.js / detectExt2.js 在 main.js 中较早 import，但一批算法
 * 文件（baseVar / token / netcodec / timecodec / checkdigit / morseExt /
 * keyboardExt / timecodecExt）在其后才 import。ES module 按源码顺序执行
 * detectExt2 的 patch 循环跑时这些 op 还没 register（无 decode），故 detectExt2
 * 的 DETECTORS2 里虽然写了它们的判据却没生效 —— 这就是那批 EASY
 * 仍缺 detect 的根因（时序早，非判据缺）。
 *
 * 本文件职责：对「有 decode 但缺 detect」的一组算法，用 getOp(id) 精确
 * 补 patch。判据沿用 detectExt2.js 已写好的同款（不重造轮子），仅解决时序。
 *
 * 红线（不变）：
 * - 只新建本文件，绝不碰 main.js / i18n / 算法源文件 / detectExt(2).js。
 * - 无副作用，只给 op 补 detect（有 guard：已有 detect 的跳过，幂等防重复）。
 * - 必须 import 在所有算法文件之后才生效（getOp 依赖 op 已 register）。
 *
 * 覆盖：EASY 37 个中的 30 个（另 7 个 radix 数学码在 radixExt.js 注册
 * 早于 detectExt2 已被其 patch，本文件 guard 自动跳过）。
 */
import { getOp } from "./registry.js";

// ============ 通用工具（与 detectExt2.js 同语义）============
const trim = (t) => (t || "").trim();
const compact = (s) => s.replace(/[\s\-]/g, "");

// ============ DETECTORS3 映射（判据抄自 detectExt2.js 已验证的同 id）============
const DETECTORS3 = {
 // ---- base 变体：base32/base58/base64 已合并进 base.js，detect 判据随迁，此处不再补。----

 // ---- modern（token.js）----
  b64urlJson: (t) => {
    const s = trim(t);
 // base64url 串（可能解码出 JSON）
    return /^[A-Za-z0-9\-_]+$/.test(s) && s.length >= 8 ? 0.3 : 0;
  },

 // ---- 网络（netcodec.js）----
  ipv6Format: (t) => {
    const s = trim(t);
 // IPv6：含 : 且 hex
    return /^[0-9a-fA-F:]+$/.test(s) && s.includes(":") && s.length >= 2 ? 0.4 : 0;
  },

 // ---- 校验位（checkdigit.js，数字串长度特征）----
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

 // ---- 时间戳（timecodec.js / timecodecExt.js，纯数字长度特征，多位重叠故偏低）----
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

 // ---- fancy 摩斯/声光（morseExt.js）----
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
 // 敲击码：数字对（1-5），空格分隔
    return /^[1-5][1-5](\s[1-5][1-5])*$/.test(s) ? 0.3 : 0;
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

 // ---- fancy 键盘/手机输入（keyboardExt.js）----
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
};

// ============ monkey-patch：用 getOp 精确补 detect（有 guard，幂等）============
let patched = 0;
const patchedIds = [];
const skippedIds = [];   // 已有 detect（多为 detectExt2 早注册组已 patch）或 op 不存在
for (const id of Object.keys(DETECTORS3)) {
  const op = getOp(id);
  if (!op) {
    skippedIds.push(`${id}(不存在)`);
    continue;
  }
  if (typeof op.detect === "function") {
    skippedIds.push(`${id}(已有detect)`);
    continue;
  }
  if (typeof op.decode !== "function") {
    skippedIds.push(`${id}(无decode)`);
    continue;
  }
  op.detect = DETECTORS3[id];
  patched++;
  patchedIds.push(id);
}

// ============ 诊断导出（供测试/审计）============
export const DETECT3_PATCHED = patchedIds;
export const DETECT3_SKIPPED = skippedIds;

console.log(`[detectExt3] patched ${patched} ops: ${patchedIds.join(", ")}`);
if (skippedIds.length) console.log(`[detectExt3] skipped: ${skippedIds.join(", ")}`);
