/*
 * Unified text signals and versioned target configuration.
 * User targets and crib values are literals only; user regular expressions are never executed.
 */

export const TARGET_CONFIG_VERSION = 1;

export const SIGNAL_LIMITS = Object.freeze({
  maxTargets: 32,
  maxLabelLen: 120,
  maxPatternLen: 200,
  maxScanLen: 200000,
  maxKeywordHits: 4,
  maxStructureHits: 4,
  adjustFloor: -120,
  adjustCeil: 40,
  ordinaryCap: 32, // 旧层普通信号合计封顶（与 TOTAL_CAP=32 同口径，严格弱于 flag -40）
});

export const SIGNAL_WEIGHTS = Object.freeze({
  target: -60,
  flagStrong: -40,
  flagKeyword: -12,
  structure: -6,
  weakSymbol: -1,
});

export const STORE_KEY = "ebctf.targets.v1";

const KEYWORD_RE = /flag|ctf|key|pass/i;
const WEAK_SYMBOL_RE = /[{}]|==|===|:\/\//;
const STRUCTURE = [
  { id: "url", label: "URL", re: /https?:\/\/[^\s"'<>]{4,}/i },
  { id: "json", label: "JSON", re: /^\s*[\[{][\s\S]*[\]}]\s*$/ },
  { id: "jwt", label: "JWT", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/ },
  { id: "credential", label: "凭证格式", re: /\b(ghp_|github_pat_|gho_|ghu_|ghs_|ghr_|AKIA|ASIA|xox[baprs]-)[A-Za-z0-9_-]{8,}/ },
  { id: "pem", label: "PEM", re: /-----BEGIN [A-Z ]+-----/ },
  { id: "success", label: "成功文本", re: /\b(success|passed|verified|unlocked|correct|恭喜|成功)\b/i },
  { id: "base64ish", label: "Base64 结构", re: /^[A-Za-z0-9+/]{16,}={0,2}$/ },
];

function isFlagPrefixCode(code) {
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || code === 95
    || (code >= 97 && code <= 122);
}

function isAsciiWordCode(code) {
  return (code >= 48 && code <= 57)
    || (code >= 65 && code <= 90)
    || (code >= 97 && code <= 122)
    || code === 95;
}

function hasKeywordBoundary(text, start, end) {
  const before = start > 0 ? text.charCodeAt(start - 1) : -1;
  const after = end < text.length ? text.charCodeAt(end) : -1;
  return (before < 0 || !isAsciiWordCode(before)) && (after < 0 || !isAsciiWordCode(after));
}

function findFlagFormatSpan(text) {
  let candidateStart = -1;
  let bodyStart = -1;
  let prefixStart = -1;
  let prefixLength = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const isPrefix = isFlagPrefixCode(code);
    if (candidateStart >= 0) {
      if (code === 125) {
        if (i > bodyStart) return [candidateStart, i + 1];
        candidateStart = -1;
        prefixStart = -1;
        prefixLength = 0;
      } else if (code === 123) {
        if (prefixLength >= 2) {
          candidateStart = prefixStart;
          bodyStart = i + 1;
        } else {
          candidateStart = -1;
        }
        prefixStart = -1;
        prefixLength = 0;
      } else if (isPrefix) {
        if (prefixLength === 0) prefixStart = i;
        prefixLength++;
      } else {
        prefixStart = -1;
        prefixLength = 0;
      }
      continue;
    }
    if (isPrefix) {
      if (prefixLength === 0) prefixStart = i;
      prefixLength++;
    } else if (code === 123 && prefixLength >= 2) {
      candidateStart = prefixStart;
      bodyStart = i + 1;
      prefixStart = -1;
      prefixLength = 0;
    } else {
      prefixStart = -1;
      prefixLength = 0;
    }
  }
  return null;
}

function foldLiteral(text) {
  let folded = "";
  for (const codePoint of text) folded += codePoint.toLowerCase();
  return folded;
}

function buildLiteralIndex(text) {
  let folded = "";
  const sourceStarts = [];
  const sourceEnds = [];
  const boundaries = new Set([0]);
  let sourceOffset = 0;
  for (const codePoint of text) {
    const part = codePoint.toLowerCase();
    const sourceEnd = sourceOffset + codePoint.length;
    for (let i = 0; i < part.length; i++) {
      sourceStarts.push(sourceOffset);
      sourceEnds.push(sourceEnd);
    }
    folded += part;
    boundaries.add(folded.length);
    sourceOffset = sourceEnd;
  }
  return { folded, sourceStarts, sourceEnds, boundaries };
}

function findLiteralSpan(index, foldedNeedle) {
  if (!foldedNeedle) return null;
  let from = 0;
  while (from <= index.folded.length - foldedNeedle.length) {
    const start = index.folded.indexOf(foldedNeedle, from);
    if (start < 0) return null;
    const end = start + foldedNeedle.length;
    if (index.boundaries.has(start) && index.boundaries.has(end)) {
      return [index.sourceStarts[start], index.sourceEnds[end - 1]];
    }
    from = start + 1;
  }
  return null;
}

export function compileTarget(t) {
  if (!t || typeof t !== "object") return { ok: false, reason: "badEntry" };
  const label = String(t.label ?? "").slice(0, SIGNAL_LIMITS.maxLabelLen);
  if (!label) return { ok: false, reason: "emptyLabel" };
  if (t.pattern !== undefined && t.pattern !== null) return { ok: false, reason: "patternUnsupported" };
  if (t.enabled === false) return { ok: false, reason: t.disabledReason === "patternUnsupported" ? "patternUnsupported" : "disabled" };
  const lit = String(t.literal ?? "");
  if (!lit) return { ok: false, reason: "emptyLiteral" };
  if (lit.length > SIGNAL_LIMITS.maxPatternLen) return { ok: false, reason: "literalTooLong" };
  return { ok: true, matcher: foldLiteral(lit), label, mode: "literal", id: t.id || label };
}

function sanitizeStoredTarget(t) {
  const src = t && typeof t === "object" ? t : {};
  const patternDisabled = (src.pattern !== undefined && src.pattern !== null) || src.disabledReason === "patternUnsupported";
  return {
    id: String(src.id ?? "").slice(0, 64),
    label: String(src.label ?? "").slice(0, SIGNAL_LIMITS.maxLabelLen),
    literal: src.literal == null ? undefined : String(src.literal).slice(0, SIGNAL_LIMITS.maxPatternLen),
    enabled: patternDisabled ? false : src.enabled !== false,
    disabledReason: patternDisabled ? "patternUnsupported" : undefined,
  };
}

export function defaultTargetConfig() {
  return { version: TARGET_CONFIG_VERSION, targets: [] };
}

export function loadTargetConfig(store) {
  try {
    const s = store !== undefined ? store : (typeof localStorage !== "undefined" ? localStorage : null);
    if (!s) return defaultTargetConfig();
    const raw = s.getItem(STORE_KEY);
    if (!raw) return defaultTargetConfig();
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || obj.version !== TARGET_CONFIG_VERSION) return defaultTargetConfig();
    const targets = Array.isArray(obj.targets)
      ? obj.targets.slice(0, SIGNAL_LIMITS.maxTargets).map(sanitizeStoredTarget)
      : [];
    return { version: TARGET_CONFIG_VERSION, targets };
  } catch {
    return defaultTargetConfig();
  }
}

export function saveTargetConfig(cfg, store) {
  try {
    const s = store !== undefined ? store : (typeof localStorage !== "undefined" ? localStorage : null);
    if (!s) return false;
    const clean = {
      version: TARGET_CONFIG_VERSION,
      targets: (Array.isArray(cfg && cfg.targets) ? cfg.targets : [])
        .slice(0, SIGNAL_LIMITS.maxTargets)
        .map(sanitizeStoredTarget),
    };
    s.setItem(STORE_KEY, JSON.stringify(clean));
    return true;
  } catch {
    return false;
  }
}

export function computeSignals(text, opts = {}) {
  const out = [];
  if (typeof text !== "string" || text.length === 0) return { signals: [], adjust: 0, truncated: false };
  const truncated = text.length > SIGNAL_LIMITS.maxScanLen;
  const s = truncated ? text.slice(0, SIGNAL_LIMITS.maxScanLen) : text;
  const literalIndex = buildLiteralIndex(s);
  const targets = (opts.targets || defaultTargetConfig().targets).slice(0, SIGNAL_LIMITS.maxTargets);
  let targetHits = 0;
  for (const t of targets) {
    const c = compileTarget(t);
    if (!c.ok) continue;
    const span = findLiteralSpan(literalIndex, c.matcher);
    if (span) { out.push({ kind: "target", label: c.label, span, weight: SIGNAL_WEIGHTS.target }); targetHits++; }
    if (targetHits >= 8) break;
  }
  const flagSpan = findFlagFormatSpan(s);
  if (flagSpan) out.push({ kind: "flagStrong", label: "flag 格式", span: flagSpan, weight: SIGNAL_WEIGHTS.flagStrong });
  if (typeof opts.crib === "string" && opts.crib.length > 0 && opts.crib.length <= SIGNAL_LIMITS.maxPatternLen) {
    const span = findLiteralSpan(literalIndex, foldLiteral(opts.crib));
    if (span) out.push({ kind: "flagStrong", label: "crib 命中", span, weight: SIGNAL_WEIGHTS.flagStrong });
  }
  const kwRe = new RegExp(KEYWORD_RE.source, "gi");
  let kwHits = 0, km;
  while ((km = kwRe.exec(s)) && kwHits < SIGNAL_LIMITS.maxKeywordHits) {
    const start = km.index, end = start + km[0].length;
    if (!hasKeywordBoundary(s, start, end)) continue;
    out.push({ kind: "flagKeyword", label: km[0].toLowerCase(), span: [start, end], weight: SIGNAL_WEIGHTS.flagKeyword });
    kwHits++;
  }
  let stHits = 0;
  for (const d of STRUCTURE) {
    if (stHits >= SIGNAL_LIMITS.maxStructureHits) break;
    const m = d.re.exec(s);
    if (m) { out.push({ kind: "structure", label: d.label, span: [m.index, m.index + m[0].length], weight: SIGNAL_WEIGHTS.structure }); stHits++; }
  }
  const wm = WEAK_SYMBOL_RE.exec(s);
  if (wm) out.push({ kind: "weakSymbol", label: "弱符号", span: [wm.index, wm.index + wm[0].length], weight: SIGNAL_WEIGHTS.weakSymbol });
  if (opts.searchTerm) {
    const st = String(opts.searchTerm);
    const span = st ? findLiteralSpan(literalIndex, foldLiteral(st)) : null;
    if (span) out.push({ kind: "searchTerm", label: st.slice(0, 64), span, weight: 0 });
  }
  let adjust = out.reduce((a, x) => a + (x.weight || 0), 0);
  adjust = Math.max(SIGNAL_LIMITS.adjustFloor, Math.min(SIGNAL_LIMITS.adjustCeil, adjust));
  return { signals: out, adjust, truncated };
}
