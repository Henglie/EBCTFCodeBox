/*
 * infoSignals.js — 结构化有效信息识别（纯函数、零依赖、有界奖励）
 *
 * 用途：一键解码引擎把一段文本解出来后，判断其中是否包含「结构化、可证的有效信息」
 *       （URL / 邮箱 / JSON / XML / 密钥或凭证块 / JWT / 厂商密钥前缀 / UUID /
 *        解出反馈文本 / 敏感文件路径）。命中即给有限降分（奖励），让这些结果排在普通噪声之前。
 *
 * 设计红线（本模块自我约束）：
 *  ① 每类信号「单独封顶」：该类合计奖励幅度不超过该类 cap（见 SIGSPEC）。
 *  ② 全部信号「合计封顶」：本模块所有信号相加的奖励幅度不超过 TOTAL_CAP。
 *  ③ TOTAL_CAP 严格小于 flag 检出的信号幅度 FLAG_WEIGHT_REF（见 §叠加次序），
 *     故任何「仅含普通有效信息」的结果，其本模块奖励都不足以压过 flag 或用户目标特征。
 *
 * 全部判据均带权威依据（RFC / 规范 / 厂商文档）或带低误报判据（词边界 + 经验白名单），
 * 给不出低误报判据的类型已列入 BLOCKED（见 设计.md / 报告.md），本模块不实现。
 *
 * 输入：字符串文本（通常是一键解码的某个候选 result）。
 * 输出：{ signals:[{kind,label,weight,span}], adjust:number, totalCap:number }
 *   - adjust 为「奖励幅度」，取负值（分数越低越优，故奖励 = 减分 = 负数）。
 *   - 满足 adjust ∈ [-TOTAL_CAP, 0]。
 */

// ============ 上限常量 ============
// flag 检出的信号幅度（来自解码引擎统一信号层：flag 格式 flagStrong = -40）。
// 本模块合计奖励幅度必须严格小于它，才能保证 flag 永远排在普通有效信息之前。
export const FLAG_WEIGHT_REF = 40;
// 本模块合计奖励幅度上限（绝对值）。取 32 < 40，留足安全余量，且远小于用户目标特征 -60。
export const TOTAL_CAP = 32;

// ============ 每类信号规格 ============
// weight：单条命中奖励幅度（负值）。
// cap   ：该类合计奖励幅度下限（更负，但不超过此值），实现「单独封顶」。
// 判据（re 或 detector）必须带词边界 / 结构锚点，杜绝子串误报（见 设计.md 误报节）。
export const SIGSPEC = Object.freeze({
  url: {
    label: "URL",
    basis: "RFC 3986 §3（URI 通用语法）/ §3.2（authority）",
    weight: -6, cap: -12,
    // 必须含方案（http/https/ftp）+ // + 至少一个点号的 authority，杜绝裸 http 词。
    re: /\b(?:https?|ftp):\/\/[^\s"'<>{}|\\]+?\.[^\s"'<>{}|\\]+/gi,
  },
  email: {
    label: "邮箱",
    basis: "RFC 5322 §3.4.1（addr-spec，简化口径：local@domain.tld）",
    weight: -6, cap: -12,
    // 词边界 + 顶级域 ≥2 字母，规避 monkey/contact 之类子串。
    re: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}(?![A-Za-z0-9-])/g,
  },
  json: {
    label: "JSON",
    basis: "RFC 8259 / ECMA-404（必须是可被 JSON.parse 接受的对象或数组）",
    weight: -10, cap: -10,
    // 用真实解析（见 detectJson），不是松散正则，确保低误报。
    detector: "json",
  },
  xml: {
    label: "XML",
    basis: "W3C XML 1.0 §2.1（格式良构：含 <?xml 声明，或单根元素且非 HTML 标签名）",
    weight: -6, cap: -6,
    detector: "xml",
  },
  pem: {
    label: "PEM/密钥块",
    basis: "RFC 7468（文本编码的密钥/证书：-----BEGIN …----- / -----END …-----）",
    weight: -12, cap: -12,
    re: /-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
  },
  jwt: {
    label: "JWT",
    basis: "RFC 7519 §1（header.payload.signature，base64url，恰两处点号）",
    weight: -10, cap: -10,
    re: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  secret: {
    label: "厂商密钥前缀",
    basis: "各厂商密钥格式文档（Stripe sk_/rk_、AWS AKIA/ASIA、GitHub ghp_/github_pat_、Slack xox*、Google AIza*）",
    weight: -12, cap: -24, // 至多 2 条
    detector: "secret",
  },
  uuid: {
    label: "UUID",
    basis: "RFC 4122 §3（8-4-4-4-12 十六进制，含版本/变体位）",
    weight: -4, cap: -4,
    re: /(?<![0-9A-Fa-f])[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[1-5][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}(?![0-9A-Fa-f])/g,
  },
  success: {
    label: "解出反馈文本",
    basis: "CTF 解出反馈经验词表（whole-word 锚点 + CJK 子串锚点，低误报判据见 设计.md）",
    weight: -6, cap: -6,
    detector: "success",
  },
 敏感路径: {
    label: "敏感文件路径",
    basis: "CTF 常见目标文件经验白名单 + 绝对路径锚点（/etc/passwd、/flag、id_rsa 等）",
    weight: -8, cap: -8,
    detector: "敏感路径",
  },
});

// ============ 各 detector 实现 ============

// JSON：在文本中找到第一个「可被 JSON.parse 接受的 {…} 或 […]」即判命中。
// 用括号配平 + 字符串引号感知扫描，避免把普通含花括号文本误判。
function detectJson(text) {
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== "{" && ch !== "[") continue;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let j = i; j < s.length; j++) {
      const c = s[j];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === "{" || c === "[") depth++;
        else if (c === "}" || c === "]") {
          depth--;
          if (depth === 0) { end = j; break; }
        }
      }
    }
    if (end > i) {
      const sub = s.slice(i, end + 1);
      try {
        const v = JSON.parse(sub);
        if (v !== null && typeof v === "object") return [[i, end + 1]];
      } catch { /* 不是合法 JSON，继续找下一个 */ }
    }
  }
  return [];
}

// HTML 内联/空元素标签名：命中则不当作 XML（避免 <b>…</b> 误判）。
const HTML_TAGS = new Set([
  "a","abbr","b","blockquote","br","code","col","dd","div","dl","dt","em","h1","h2","h3",
  "h4","h5","h6","hr","i","img","input","kbd","li","link","mark","meta","ol","p","pre",
  "q","rp","rt","s","samp","small","span","strong","sub","sup","table","tbody","td","tfoot",
  "th","thead","time","tr","track","u","ul","var","wbr","area","base","colgroup","embed","source",
]);

function detectXml(text) {
  const s = String(text).trim();
  if (/^\s*<\?xml\b/i.test(s) || /^\s*<!DOCTYPE\b/i.test(s)) return [[0, s.length]];
  // 单根元素：<root ...> ... </root>，且 root 不是 HTML 标签。
  const m = /^\s*<([A-Za-z_][\w.-]*)(\s[^>]*)?>([\s\S]*?)<\/\1>\s*$/.exec(s);
  if (m && !HTML_TAGS.has(m[1].toLowerCase())) return [[m.index, m.index + m[0].length]];
  return [];
}

// 厂商密钥前缀：每族带具体前缀 + 长度/字符集约束，低误报。
const SECRET_RES = [
  // OpenAI 风格 sk- 令牌（短样本/教学密钥）
  /\bsk-[0-9A-Za-z]{8,}\b/g,
  // Stripe 私密/受限密钥：sk_live_ / sk_test_ / rk_live_ / rk_test_ + ≥24 位字母数字
  /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{24,}/g,
  // AWS 访问密钥 ID：AKIA / ASIA + 16 位大写字母数字
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // GitHub PAT：ghp_/gho_/ghu_/ghs_/ghr_ + 36 位；或 github_pat_ + ≥22 位
  /\b(?:ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{36}\b/g,
  /\bgithub_pat_[0-9A-Za-z_]{22,}\b/g,
  // Slack 令牌：xoxb-/xoxp-/xoxa-/xoxr-/xoxs- + 段
  /\bxox[bpars]-[0-9A-Za-z-]{10,}\b/g,
  // Google API 密钥：AIza + 35 位 base64 字符
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
];

function detectSecret(text) {
  const out = [];
  for (const re of SECRET_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push([m.index, m.index + m[0].length]);
      if (m[0].length === re.lastIndex) re.lastIndex++; // 防零宽死循环
    }
  }
  return out;
}

// 解出反馈文本：英文 whole-word + CJK 子串（CJK 天然无词边界）。低误报靠白名单。
const SUCCESS_EN = [
  "success", "successful", "successfully", "passed", "verified", "verify",
  "unlocked", "correct", "granted", "authenticated", "welcome", "access granted",
];
const SUCCESS_CJK = ["成功", "恭喜", "通关", "答对", "校验通过"];

function detectSuccess(text) {
  const out = [];
  const lower = text.toLowerCase();
  for (const w of SUCCESS_EN) {
    const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "gi");
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push([m.index, m.index + m[0].length]);
      if (m[0].length === re.lastIndex) re.lastIndex++;
    }
  }
  for (const w of SUCCESS_CJK) {
    let idx = lower.indexOf(w);
    while (idx >= 0) {
      out.push([idx, idx + w.length]);
      idx = lower.indexOf(w, idx + 1);
    }
  }
  return out;
}

// 敏感文件路径：绝对路径锚点 + 敏感文件名白名单（不靠裸「任何 / 路径」以免误报）。
const SENSITIVE_PATH_RE = new RegExp(
  [
    "(?:^|[^A-Za-z0-9./\\\\])",            // 前锚：行首或非路径字符
    "(?:",
      "\\/(?:etc\\/(?:passwd|shadow|group|hostname|gshadow)|flag|flag\\.txt|root\\.txt|user\\.txt)",
      "|(?:\\/[\\w.\\[\\]-]+)*\\/\\.ssh\\/id_rsa",
      "|(?:\\/[\\w.\\[\\]-]+)*\\/\\.bash_history",
      "|[A-Za-z]:\\\\",                    // Windows 盘符路径
    ")",
  ].join(""),
  "g"
);

function detectSensitivePath(text) {
  const out = [];
  let m;
  const re = new RegExp(SENSITIVE_PATH_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    // m[0] 含前锚字符，span 取匹配整体即可（用于展示）。
    out.push([m.index, m.index + m[0].length]);
    if (m[0].length === re.lastIndex) re.lastIndex++;
  }
  return out;
}

// ============ 主入口 ============
/**
 * 分析文本中的结构化有效信息信号。
 * @param {string} text
 * @returns {{signals:Array<{kind:string,label:string,weight:number,span:[number,number]}>, adjust:number, totalCap:number}}
 */
export function analyzeInfoSignals(text) {
  if (typeof text !== "string" || text.length === 0) {
    return { signals: [], adjust: 0, totalCap: TOTAL_CAP };
  }
  const signals = [];
  let total = 0;

  for (const [kind, spec] of Object.entries(SIGSPEC)) {
    let spans;
    if (spec.detector === "json") spans = detectJson(text);
    else if (spec.detector === "xml") spans = detectXml(text);
    else if (spec.detector === "secret") spans = detectSecret(text);
    else if (spec.detector === "success") spans = detectSuccess(text);
    else if (spec.detector === "敏感路径") spans = detectSensitivePath(text);
    else {
      const re = new RegExp(spec.re.source, spec.re.flags.includes("g") ? spec.re.flags : spec.re.flags + "g");
      re.lastIndex = 0;
      spans = [];
      let m;
      while ((m = re.exec(text)) !== null) {
        spans.push([m.index, m.index + m[0].length]);
        if (m[0].length === re.lastIndex) re.lastIndex++;
      }
    }
    if (spans.length === 0) continue;
    // 每类单独封顶（信号条数 + 奖励幅度双重封顶）：
    // 该类最多计入 maxHits = cap/weight 条（二者皆负，商为正），超出部分不计入、
    // 也不参与奖励，确保「记录的信号」与「奖励幅度」一致地受 cap 约束。
    const maxHits = Math.floor(spec.cap / spec.weight);
    const kept = spans.slice(0, maxHits);
    const typeAdjust = kept.length * spec.weight; // 已 ≤ cap（更负不突破 cap）
    total += typeAdjust;
    for (const span of kept) {
      signals.push({ kind, label: spec.label, weight: spec.weight, span });
    }
  }

  // 合计封顶：绝不突破 TOTAL_CAP。
  const adjust = Math.max(total, -TOTAL_CAP);
  return { signals, adjust, totalCap: TOTAL_CAP };
}

export default { analyzeInfoSignals, SIGSPEC, FLAG_WEIGHT_REF, TOTAL_CAP };
