/*
 * moyue.js — 魔曰（cat: 'cn'）。
 *
 * 上游：SheepChef Abracadabra v3.7.7（https://github.com/SheepChef/Abracadabra，@SheepChef）。
 * 移植方式：整份官方 UMD 库本地化为 ESM 后内联（src/core/lib/abracadabra-cn.umd.js）
 * 本文件仅做薄封装，不重写内部算法。原库是完整加密管线（UNISHOX2/GZIP 压缩 →
 * AES-256-CTR → MersenneTwister 随机 → 旋转字表大字典替换 → Luhn 校验位）
 * 手工 1:1 复刻不现实且会破坏互解性，故照 sjcl.js 先例整体 vendored。
 *
 * 与本项目现有 cn 系（佛又曰/天书/熊曰/随言随语）区别：魔曰是外部独立算法
 * 两种模式：
 * - 文言仿真（classical，Input_Next）：输出仿文言文，含标点/骈文/逻辑等风格选项，默认模式。
 * - 传统（traditional，Input）：输出纯字符替换串，无文风。
 * 两模式密文互不兼容（交叉解码会抛错），decode 按所选模式解，失败自动回退另一模式。
 *
 * 互解性：已用 node 对拍原始 abracadabra-cn.umd.cjs，vendored 库与原库双向互解通过
 * （文言仿真 + 传统 两模式，含中文/ASCII/emoji）。
 *
 * 注：encode 含随机数（MersenneTwister 以 Date.now 播种），同一明文每次密文不同
 * 但 decode 恒定可还原。密钥错误会抛「解码失败」。
 *
 * 契约：register({ id:"moyue", cat:"cn", name:"魔曰", encode, decode, params, detect })。
 */

import "./lib/abracadabra-cn.umd.js";
import { register } from "./registry.js";

// vendored 库把 Abracadabra 挂到 globalThis["abracadabra-cn"]（UMD else 分支）。
function getAbra() {
  const ns =
    (typeof globalThis !== "undefined" && globalThis["abracadabra-cn"]) || null;
  const A = ns && ns.Abracadabra;
  if (typeof A !== "function") {
    throw new Error(
      "魔曰依赖 abracadabra-cn 库（src/core/lib/abracadabra-cn.umd.js），未检测到 Abracadabra"
    );
  }
  return A;
}

// 识别指纹字符（照抄 vendored 库 SIG_DECRYPT_JP / SIG_DECRYPT_CN）。
// 两种模式的密文都会插入至少 1 个 JP + 1 个 CN 标志字，供 detect 结构判断。
const SIG_JP = "桜込凪雫実沢";
const SIG_CN = "玚俟玊欤瞐珏";

const CLASSICAL_CHARS = new Set("关赴呈添停成走达行称见学听买作弹写定谈动旅返度开筑选流指换探放看报事泊现迸彰需飞游求御航歌读振登任留奏连知至致去画说进信取问笑视言人镜鹏曲霞绸裳路岩叶鲤月雪冰局恋福铃琴家天韵书莺璃雨文涧水花风棋楼鹤鸢灯雁星声树茶竹兰苗心语礼梦庭木驿火森夏光林物云夜城春空雀鹂鸳莹畅新高静美绿佳善良瀚明早宏青遥速慧绚绮寒冷银灵绣北临南俊捷骏益雅舒智谜彩余短秋乐怡瑞惠和纯悦迷长少近清远极安聪秀旧浩盈快悠后轻坚诚恒愈谨频笃湛昭朗祗攸徐咸皆恭弥允公淳嘉勤协永歆已忻谧稍尚竟悉渐颇辄曾欲应可能将请想必当之乎者也为把了而此斯仍与同亦是乃未莫或更使让非不何奈哉但却则况且似如若倘呼噫自以于曰夫在有初谓常然无道实本其今弗论居所受命固具继尝予虽复孰每便得矣故中上间唯某谁");
const CLASSICAL_PUNCT = new Set(["\uFF0C", "\u3002", "\u3001", "\uFF1F"]);
const CLASSICAL_FUNC = "之也而不其者以为有无则故是非所矣哉夫";

const DEFAULT_KEY = "ABRACADABRA";

function normKey(params) {
  const k = params && params.key != null ? params.key : "";
  const s = typeof k === "string" ? k.trim() : "";
  return s || DEFAULT_KEY;
}

// ============================================================
// encode
// ============================================================
function moyueEncode(text, params = {}) {
  const A = getAbra();
  const key = normKey(params);
  const mode = (params.mode || "classical") + "";
  const o = new A("TEXT", "TEXT");
  if (mode === "traditional") {
 // Input(input, mode, key, q)：q=false → 保留标志位（便于解码端自检）
    o.Input(text, "ENCRYPT", key, false);
  } else {
 // Input_Next(input, mode, key, q, r, p, l)
 // q=是否添加标点(默认 true)，r=随机程度(0-100)，p=骈文，l=逻辑
    const q = params.punct !== false; // 默认加标点
    let r = Number(params.random);
    if (!Number.isFinite(r)) r = 50;
    r = Math.max(0, Math.min(100, r));
    const p = !!params.pianwen;
    const l = !!params.logic;
    o.Input_Next(text, "ENCRYPT", key, q, r, p, l);
  }
  return o.Output();
}

// ============================================================
// decode
// ============================================================
function decodeWith(A, text, key, mode) {
  const o = new A("TEXT", "TEXT");
  if (mode === "traditional") {
    o.Input(text, "DECRYPT", key);
  } else {
    o.Input_Next(text, "DECRYPT", key);
  }
  const res = o.Output();
 // 文言仿真 DECRYPT 返回 {output,...}，传统 DECRYPT 直接返回字符串。
  if (res && typeof res === "object" && "output" in res) return res.output;
  return res;
}

function moyueDecode(text, params = {}) {
  const A = getAbra();
  const key = normKey(params);
  const wanted = (params.mode || "classical") + "";
  const other = wanted === "traditional" ? "classical" : "traditional";
 // 先按所选模式解；两模式密文互不兼容，失败则回退另一模式。
  try {
    return decodeWith(A, text, key, wanted);
  } catch (e1) {
    try {
      return decodeWith(A, text, key, other);
    } catch (e2) {
      throw new Error("魔曰解码失败：密钥错误或非魔曰密文");
    }
  }
}

// ============================================================
// 注册
// ============================================================
register({
  id: "moyue",
  cat: "cn",
  name: "魔曰",
  desc: "Abracadabra 中文版（文言仿真 / 传统两模式，AES-256-CTR + 压缩 + 字表替换，需密钥）",
  params: [
    {
      key: "mode",
      label: "模式",
      type: "select",
      default: "classical",
      options: [
        { value: "classical", label: "文言仿真（仿文言文）" },
        { value: "traditional", label: "传统（纯字符替换）" },
      ],
    },
    {
      key: "key",
      label: "密钥",
      type: "text",
      default: DEFAULT_KEY,
      placeholder: "默认 ABRACADABRA",
    },
    {
      key: "random",
      label: "随机程度（文言仿真，0-100）",
      type: "number",
      default: 50,
      placeholder: "越大越随机，默认 50",
    },
    { key: "punct", label: "添加标点（文言仿真）", type: "bool", default: true },
    { key: "pianwen", label: "骈文格律（文言仿真）", type: "bool", default: false },
    { key: "logic", label: "逻辑优先（文言仿真）", type: "bool", default: false },
  ],
  encode: moyueEncode,
  decode: moyueDecode,
  detect: (t) => {
    const s = (t || "").trim();
    if (s.length < 6) return 0;
    const chars = [...s];
    let hasJp = false;
    let hasCn = false;
    let cjk = 0;
    let stray = 0;
    let func = 0;
    let topFunc = 0;
    const funcHits = new Map();
    for (const c of chars) {
      if (!hasJp && SIG_JP.indexOf(c) !== -1) hasJp = true;
      if (!hasCn && SIG_CN.indexOf(c) !== -1) hasCn = true;
      const cp = c.codePointAt(0);
      if (cp >= 0x3400 && cp <= 0x9fff) {
        cjk++;
        if (!CLASSICAL_CHARS.has(c)) stray++;
        if (CLASSICAL_FUNC.indexOf(c) !== -1) {
          func++;
          const n = (funcHits.get(c) || 0) + 1;
          funcHits.set(c, n);
          if (n > topFunc) topFunc = n;
        }
      } else if (!CLASSICAL_PUNCT.has(c) && c !== "\n" && c !== "\r") {
        stray++;
      }
    }
    const cjkRatio = cjk / chars.length;
    const funcRatio = func / chars.length;
 // 传统模式含 JP+CN 标志字且以 CJK 为主 → 低置信度（防与其他 cn 编码误撞）。
    if (hasJp && hasCn && cjkRatio > 0.7) return 0.35;
 // 文言仿真模式无标志字：先按 CJK 占比粗筛，再用默认密钥试解做精确校验；
 // 密钥不符/非魔曰密文会抛错，不会误报；非默认密钥的 classical 走下方结构分支。
    if (cjkRatio > 0.7 && /[，。！？、]/.test(s)) {
      try {
        const out = moyueDecode(s, { mode: "classical", key: DEFAULT_KEY });
        if (typeof out === "string" && out.length > 0) return 0.3;
      } catch (e) { /* 非魔曰密文或非默认密钥 */ }
    }
    const structural =
      chars.length < 40
        ? (topFunc >= 3 ? funcRatio >= 0.14 : topFunc === 2 && funcRatio >= 0.15)
        : topFunc >= 3
          ? funcRatio >= 0.09
          : topFunc === 2 && funcRatio >= 0.12;
    if (cjkRatio > 0.7 && chars.length >= 12 && stray === 0 && structural) return 0.24;
    return 0;
  },
});

export { moyueEncode, moyueDecode };
