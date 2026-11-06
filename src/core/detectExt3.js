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
import { debugLog } from "./debugLog.js";

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
    // Cocoa 纪元 2001，2001 前为负；不 compact（会吃掉负号）
    const s = trim(t).replace(/\s/g, "");
    if (/^\d{9,10}$/.test(s)) return 0.12;
    // 负值下界取公元 1 年（约 -63072000000 秒）；至少 5 位避免小负数误报
    if (/^-\d{5,11}$/.test(s)) {
      const n = Number(s);
      return n >= -63072000000 ? 0.12 : 0;
    }
    return 0;
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
    // 1900 系统 1900 前为负；不 compact（会吃掉负号）
    const s = trim(t).replace(/\s/g, "");
    const m = /^(-?)(\d{1,7})(\.\d+)?$/.exec(s);
    if (!m) return 0;
    const n = Number(m[2]);
    if (m[1]) return n >= 1 && n <= 695055 ? 0.15 : 0; // 公元 1 年 ~ 1899-12-31（兼容 1904 系统下界）
    // 正常序列号只认 4-5 位，避免与普通数字撞（1900-01-01=1，9999-12-31=2958465）
    return n >= 1000 && n <= 99999 ? 0.15 : 0;
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
    if (!s) return 0;
    // encode 输出为数字摩斯（每位 5 个 .-/），组间可带 " / "；不再要求原数字
    let count = 0;
    for (const g of s.split(/\s*\/\s*/)) {
      for (const tok of g.trim().split(/\s+/).filter(Boolean)) {
        if (!/^[.-]{5}$/.test(tok)) return 0;
        count++;
      }
    }
    return count >= 2 ? 0.3 : 0;
  },
  tapCode: (t) => {
    const s = trim(t);
 // 敲击码：数字对（1-5），空格分隔；外部工具常输出连写，故一并认（decode 亦已容忍）
    if (/^[1-5][1-5](\s[1-5][1-5])*$/.test(s)) return 0.3;
    return /^[1-5]{4,}$/.test(s) && s.length % 2 === 0 ? 0.3 : 0;
  },
  semaphore: (t) => {
    // 方向词对（照 morseExt.js SEMAPHORE_TABLE 的 8 方向；与 detectSupplement 同判据）
    const dir = "(?:up|down|left|right|upleft|upright|downleft|downright)";
    const re = new RegExp("^" + dir + "\\+" + dir + "(?:\\s+" + dir + "\\+" + dir + ")+$", "i");
    return re.test(trim(t)) ? 0.5 : 0;
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
    if (!s) return 0;
    // 和弦均来自 STENO_LETTER 值：星号位置不固定（*E/*EU/TP*），但星号必在键序字母之间；
    // "/" 是词间空格。无星号的普通大写词（HELLO）不命中。
    let chords = 0;
    for (const tok of s.split(/\s+/).filter(Boolean)) {
      if (tok === "/") continue;
      if (tok.length < 2 || !/^[STKPWHRAOEUFRPBLGTSDZ]*\*[STKPWHRAOEUFRPBLGTSDZ]*$/.test(tok)) return 0;
      chords++;
    }
    return chords >= 1 ? 0.15 : 0;
  },
};

// ============ monkey-patch：用 getOp 精确补 detect（有 guard，幂等）============
let patched = 0;
const patchedIds = [];
const skippedIds = [];   // 已有 detect（多为 detectExt2 早注册组已 patch）或 op 不存在
// 惰载重放入口：循环幂等（缺 detect 才补），lazyCore 每批文件落地后调用
export function applyDetectPatches() {
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
}
applyDetectPatches();

// ============ 诊断导出（供测试/审计）============
export const DETECT3_PATCHED = patchedIds;
export const DETECT3_SKIPPED = skippedIds;

debugLog(`[detectExt3] patched ${patched} ops: ${patchedIds.join(", ")}`);
if (skippedIds.length) debugLog(`[detectExt3] skipped: ${skippedIds.join(", ")}`);
