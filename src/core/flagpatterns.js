/*
 * flagpatterns.js — CTF flag 格式正则库（T78，纯数据模块，不注册 op）。
 *
 * 定位：供 T66 flagdetect.js 复用的数据层。本模块只导出正则表 + findFlags 纯函数
 * 不调用 register，不进 OPS，不碰 main.js / i18n。flagdetect.js（T66）import 后
 * 可直接用 findFlags(text) 拿区间列表做识别 / 高亮，或用 FLAG_PATTERNS 自行扫描。
 *
 * 覆盖（按置信度降序）：
 * flag_brace flag{...} / FLAG{...}（大小写不敏感） 0.99
 * ctf_brace CTF{...}（大小写不敏感） 0.99
 * prefixed_brace 赛事前缀{...}（picoCTF/HTB/DASCTF 等，排除编程关键字）0.85
 * key_assign key=... / key:... 赋值 0.60
 * md5 32 位 hex（疑似 MD5） 0.50
 * sha1 40 位 hex（疑似 SHA1） 0.45
 * base64 Base64 串（长度≥16，含可选 = 填充） 0.40
 * hex_long 长 hex 串（长度≥16，与 md5/sha1 重叠时低优先） 0.30
 *
 * findFlags(text, opts) → [{ start, end, match, patternId, name, confidence, desc }]
 * opts.minConfidence 最低置信度阈值（默认 0，全返回）
 * opts.dedupe 重叠区间加权去重，保留高置信度（默认 true）
 * opts.patterns 指定 patternId 子集（默认全部）
 *
 * 算法说明：
 * - 正则全局扫描（g 标志）；findFlags 内部为每次调用 new 一份 RegExp，避免
 * lastIndex 污染（同一 source+flags 的字面量 RegExp 共享 lastIndex 是常见 bug 源）。
 * - 赛事前缀 prefixed_brace 会同时命中 flag{}/CTF{}，靠加权去重保留更高置信度的
 * flag_brace/ctf_brace；同理 md5/sha1 会同时被 hex_long/base64 命中，去重保留
 * 更具体的 md5/sha1。
 * - 加权去重用贪心策略：按置信度降序稳定排序，逐个选与已选区间不重叠的。
 * CTF 场景重叠均为「同一区间被多模式命中」，贪心等价于「保留最高置信度」
 * 不会出现需要 DP 的嵌套最优解问题。
 *
 * 红线：
 * - 纯函数零 DOM，不依赖 registry / compress / magic。
 * - 不注册 op，不进 OPS；T66 flagdetect 负责 op 注册 + UI 高亮。
 * - 编程关键字 if/for/while/function 等用 KEYWORD_BLOCKLIST 排除，避免代码片段误报。
 */

// ============================================================
// 正则表：每项 { id, name, regex, confidence, desc }
// ============================================================
export const FLAG_PATTERNS = [
  {
    id: "flag_brace",
    name: "flag{...}",
    regex: /\bflag\{[^}]{1,500}\}/gi,
    confidence: 0.99,
    desc: "通用 flag{...} / FLAG{...}（大小写不敏感）",
  },
  {
    id: "ctf_brace",
    name: "CTF{...}",
    regex: /\bctf\{[^}]{1,500}\}/gi,
    confidence: 0.99,
    desc: "CTF{...}（大小写不敏感）",
  },
  {
    id: "prefixed_brace",
    name: "赛事前缀{...}",
    regex: /\b[A-Za-z][A-Za-z0-9_]{1,20}\{[^}]{1,200}\}/g,
    confidence: 0.85,
    desc: "赛事前缀{...}（picoCTF/HTB/DASCTF/hxbctf 等，排除编程关键字）",
  },
  {
    id: "key_assign",
    name: "key=...",
    regex: /\bkey\s*[:=]\s*["']?[A-Za-z0-9+/=_\-]{4,200}["']?/gi,
    confidence: 0.6,
    desc: "key=... / key:... 赋值（疑似 flag/key 串）",
  },
  {
    id: "md5",
    name: "MD5",
    regex: /\b[a-fA-F0-9]{32}\b/g,
    confidence: 0.5,
    desc: "32 位 hex（疑似 MD5）",
  },
  {
    id: "sha1",
    name: "SHA1",
    regex: /\b[a-fA-F0-9]{40}\b/g,
    confidence: 0.45,
    desc: "40 位 hex（疑似 SHA1）",
  },
  {
    id: "base64",
    name: "Base64",
    regex: /\b[A-Za-z0-9+/]{16,}={0,2}\b/g,
    confidence: 0.4,
    desc: "Base64 串（长度≥16，含可选 = 填充）",
  },
  {
    id: "hex_long",
    name: "Hex 串",
    regex: /\b[a-fA-F0-9]{16,}\b/g,
    confidence: 0.3,
    desc: "长 hex 串（长度≥16，与 md5/sha1 重叠时低优先）",
  },
];

// 编程关键字黑名单：prefixed_brace 命中后取 { 前的前缀，命中黑名单则丢弃。
// 覆盖常见 C 类 / shell / python / js / sql 结构关键字，避免 if{}/for{}/select{} 等误报。
const KEYWORD_BLOCKLIST = new Set([
  "if", "for", "while", "do", "switch", "try", "catch", "finally", "class", "def",
  "lambda", "return", "else", "with", "foreach", "using", "namespace", "struct",
  "enum", "union", "void", "int", "char", "byte", "bool", "string", "var", "let",
  "const", "new", "delete", "this", "super", "extends", "implements", "interface",
  "abstract", "final", "static", "public", "private", "protected", "internal",
  "extern", "volatile", "async", "await", "yield", "typeof", "instanceof", "in",
  "of", "from", "import", "export", "default", "case", "break", "continue", "goto",
  "throw", "throws", "assert", "except", "raise", "begin", "end", "then", "elif",
  "endif", "func", "fun", "fn", "method", "procedure", "sub", "print", "echo",
  "printf", "main", "select", "where", "group", "order", "by", "join", "left",
  "right", "inner", "outer", "on", "as", "is", "not", "and", "or", "null",
  "true", "false", "undefined", "none", "nil", "self", "cls", "function", "void",
  "long", "short", "float", "double", "signed", "unsigned", "auto", "register",
  "inline", "virtual", "operator", "template", "typename", "typedef", "sizeof",
  "module", "require", "include", "define", "ifdef", "ifndef", "endif", "pragma",
]);

// patternId → pattern 映射，方便消费方按 id 查表。
export const PATTERNS_BY_ID = Object.fromEntries(
  FLAG_PATTERNS.map((p) => [p.id, p])
);

// ============================================================
// findFlags — 主函数
// ============================================================
/**
 * 扫描文本，返回 CTF flag 候选区间列表。
 * @param {string} text 待扫描文本
 * @param {object} [opts]
 * @param {number} [opts.minConfidence=0] 最低置信度阈值
 * @param {boolean} [opts.dedupe=true] 重叠区间加权去重（保留高置信度）
 * @param {string[]} [opts.patterns] 指定 patternId 子集
 * @returns {Array<{start,end,match,patternId,name,confidence,desc}>}
 */
export function findFlags(text, opts = {}) {
  if (typeof text !== "string" || text.length === 0) return [];
  const minConfidence = opts.minConfidence ?? 0;
  const dedupe = opts.dedupe ?? true;
  const patternFilter = opts.patterns ? new Set(opts.patterns) : null;

  const results = [];
  for (const p of FLAG_PATTERNS) {
    if (p.confidence < minConfidence) continue;
    if (patternFilter && !patternFilter.has(p.id)) continue;
 // 每次调用 new 一份 RegExp，避免字面量 RegExp 共享 lastIndex 污染。
    const re = new RegExp(p.regex.source, p.regex.flags.includes("g") ? p.regex.flags : p.regex.flags + "g");
    let m;
    while ((m = re.exec(text)) !== null) {
 // prefixed_brace：提取 { 前的前缀，命中编程关键字黑名单则丢弃。
      if (p.id === "prefixed_brace") {
        const braceIdx = m[0].indexOf("{");
        const prefix = m[0].slice(0, braceIdx).toLowerCase();
        if (KEYWORD_BLOCKLIST.has(prefix)) continue;
      }
      results.push({
        start: m.index,
        end: m.index + m[0].length,
        match: m[0],
        patternId: p.id,
        name: p.name,
        confidence: p.confidence,
        desc: p.desc,
      });
 // 零宽匹配保护（防死循环，正常情况下不会触发）
      if (m[0] === "") re.lastIndex++;
    }
  }

 // 按位置稳定排序
  results.sort((a, b) => a.start - b.start || a.end - b.end || b.confidence - a.confidence);
  if (!dedupe) return results;

 // 加权去重：按置信度降序稳定排序，贪心选不重叠区间。
 // CTF 场景重叠均为「同一区间被多模式命中」，贪心等价于保留最高置信度。
  const byConf = [...results].sort(
    (a, b) => b.confidence - a.confidence || a.start - b.start || a.end - b.end
  );
  const chosen = [];
  const overlap = (a, b) => a.start < b.end && b.start < a.end;
  for (const r of byConf) {
    let conflict = false;
    for (const c of chosen) {
      if (overlap(c, r)) { conflict = true; break; }
    }
    if (!conflict) chosen.push(r);
  }
  chosen.sort((a, b) => a.start - b.start || a.end - b.end);
  return chosen;
}

// ============================================================
// 辅助：summarize — 把结果格式化成多行报告文本（调试/直接展示用，非必需）
// ============================================================
export function summarizeFlags(text, opts = {}) {
  const hits = findFlags(text, opts);
  const lines = ["=== CTF flag 候选扫描 ===", `输入长度：${text.length}`, `命中：${hits.length} 个`, ""];
  if (hits.length === 0) {
    lines.push("（未发现 flag 候选）");
    return lines.join("\n");
  }
  lines.push("[起止]      置信度  类型            匹配内容");
  for (const h of hits) {
    const preview = h.match.length > 60 ? h.match.slice(0, 57) + "..." : h.match;
    lines.push(
      `${String(h.start).padStart(6)}-${String(h.end).padEnd(6)}  ${h.confidence.toFixed(2).padEnd(7)} ${h.patternId.padEnd(15)} ${preview}`
    );
  }
  return lines.join("\n");
}
