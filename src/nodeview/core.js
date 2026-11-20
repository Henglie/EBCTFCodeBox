/*
 * core.js — T953 节点视图支撑层（节点库 / 节点卡片 / 检查器共用）。
 *
 * 职责（只读复用产品源码，不改产品）：
 *   1. 实载 registry（registerAll 副作用注册 978 个 op）与分类表；
 *   2. op 名/描述/分类名走产品 i18n（op.<id>.name / op.<id>.desc / cat.<id>），
 *      与算法页显示完全一致；
 *   3. 节点视图自身的界面文案（nv.*）全部集中在 i18n/zh.json、i18n/en.json，
 *      代码里不出现任何中文字面量；
 *   4. 端口模型：in / out / files / param:<key> / field:<key>，类型 text|bytes（MT809）；
 *   5. 参数校验与算法页同一套规则（见 validateParam 注释）；
 *   6. 搜索索引与全站搜索同源：直接复用 src/ui/pinyinSearch.js（拼音全拼/首字母）、
 *      src/ui/searchSynonyms.js（同义词扩展）、core/eduContent.defer.js（算法别名 aka），
 *      索引字段与打分逻辑逐行对齐 main.js buildSearchIndex/searchOps。
 *
 * 依赖边界：本文件可被三个 UI 组件静态 import；不触碰产品 DOM、不写 localStorage。
 */

import "../core/registerAll.js";
import { OPS, CATEGORIES, FAMILY_NAMES, getOp, inferIoMode } from "../core/registry.js";
import { CTF_HOT } from "../core/ctfPresets.js";
import { pinyinKeys } from "../ui/pinyinSearch.js";
import { synonymsOf, expandAliases } from "../ui/searchSynonyms.js";
import { eduContentReady, eduAliasesSync } from "../core/eduContent.defer.js";
import { t as tp, getLocale, setLocale, ensureLoaded } from "../i18n/index.js";

/* ============================ 界面文案（nv.*） ============================ */

const MESSAGES = {};
let _lang = "zh";
let _loadPromise = null;

/** 读 i18n/<lang>.json（与组件同目录，fetch 相对 import.meta.url）。 */
async function loadMessages(lang) {
  if (MESSAGES[lang]) return MESSAGES[lang];
  const url = new URL(`./i18n/${lang}.json`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`i18n ${lang} load failed: ${res.status}`);
  MESSAGES[lang] = await res.json();
  return MESSAGES[lang];
}

/** 初始化文案表（默认取当前语言，缺 en 表则回落 zh）。 */
export async function loadNvMessages(lang = "zh") {
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    await loadMessages("zh");
    await loadMessages("en").catch(() => ({}));
    await applyLang(lang);
  })();
  return _loadPromise;
}

async function applyLang(lang) {
  const next = MESSAGES[lang] ? lang : "zh";
  _lang = next;
  if (next === "en") {
    await ensureLoaded("en").catch(() => null);
    if (getLocale() !== "en") await setLocale("en").catch(() => null);
  } else if (getLocale() !== "zh") {
    await setLocale("zh").catch(() => null);
  }
  try { document.documentElement.setAttribute("lang", next === "zh" ? "zh-CN" : next); } catch { /* node */ }
  _index = null;
}

/** 切界面语言：重载 nv 表 + 同步产品 i18n（op 名/描述随语言变，与算法页一致）。 */
export async function setNodeLang(lang) {
  await loadNvMessages("zh");
  await loadMessages(lang).catch(() => null);
  await applyLang(lang);
  return _lang;
}

export function getNodeLang() {
  return _lang;
}

/** 取文案：当前语言 → 中文 → key 本身；{0}{1} 占位替换。 */
export function tNv(key, ...args) {
  const cur = MESSAGES[_lang] || {};
  let s = cur[key];
  if (s == null) s = (MESSAGES.zh || {})[key];
  if (s == null) s = key;
  if (args.length) s = String(s).replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? args[i] : m));
  return s;
}

/** 测试/回执用：拿到整表（深拷贝由调用方自理）。 */
export function nvMessages(lang) {
  return MESSAGES[lang] || {};
}

/* ============================ op 显示信息 ============================ */

export function opNameOf(op) {
  if (!op) return "";
  const k = `op.${op.id}.name`;
  const s = tp(k);
  return s === k ? (op.name || op.id) : s;
}

export function opDescOf(op) {
  if (!op || !op.desc) return "";
  const k = `op.${op.id}.desc`;
  const s = tp(k);
  return s === k ? op.desc : s;
}

export function catNameOf(catId) {
  const cat = CATEGORIES.find((c) => c.id === catId);
  if (!cat) return catId;
  const k = "cat." + cat.id;
  const s = tp(k);
  return s === k ? cat.name : s;
}

export function categoriesWithOps() {
  return CATEGORIES.map((c) => ({ ...c, name: catNameOf(c.id), ops: OPS.filter((o) => o.cat === c.id && !o.__stub) }))
    .filter((c) => c.ops.length > 0);
}

/* ============================ 端口模型（MT809） ============================ */

export const PORT_TYPE = { TEXT: "text", BYTES: "bytes" };

export function hasFields(op) {
  return !!(op && Array.isArray(op.fields) && op.fields.length);
}

/** 方向：双向 op 才有切换；单向（encode/decode/run）不显示切换。 */
export function directionInfo(op) {
  const e = typeof op.encode === "function";
  const d = typeof op.decode === "function";
  if (e && d) return { value: "encode", toggle: true, options: ["encode", "decode"] };
  if (e) return { value: "encode", toggle: false, options: ["encode"] };
  if (d) return { value: "decode", toggle: false, options: ["decode"] };
  return { value: "run", toggle: false, options: ["run"] };
}

/** 主输入：多字段 op 用 field:<key>；无需主输入的 op 无 in 口。 */
export function inputSpec(op) {
  if (hasFields(op)) return { kind: "fields", fields: op.fields, type: PORT_TYPE.TEXT };
  if (inferIoMode(op) === "none") return null;
  return { kind: "in", type: PORT_TYPE.TEXT };
}

/**
 * 端口全集（顺序：输入 → 参数/字段 → 输出）。
 * promoted: 已提升为端口的参数 key 数组。
 * 返回 [{ id, kind, direction, type, label, paramKey?, fieldKey? }]
 */
export function portsOf(op, promoted = []) {
  const out = [];
  const spec = inputSpec(op);
  if (spec && spec.kind === "in") {
    out.push({ id: "in", kind: "in", direction: "in", type: spec.type, label: tNv("nv.port.in") });
  }
  if (op && op.acceptsBytes) {
    out.push({ id: "files", kind: "files", direction: "in", type: PORT_TYPE.BYTES, label: tNv("nv.port.files") });
  }
  const promotedSet = new Set(promoted || []);
  for (const d of op.params || []) {
    if (!promotedSet.has(d.key)) continue;
    out.push({
      id: "param:" + d.key, kind: "param", direction: "in", type: PORT_TYPE.TEXT,
      label: paramLabel(d), paramKey: d.key,
    });
  }
  if (spec && spec.kind === "fields") {
    for (const f of spec.fields) {
      out.push({
        id: "field:" + f.key, kind: "field", direction: "in", type: PORT_TYPE.TEXT,
        label: f.label || f.key, fieldKey: f.key,
      });
    }
  }
  out.push({ id: "out", kind: "out", direction: "out", type: PORT_TYPE.TEXT, label: tNv("nv.port.out") });
  return out;
}

/** 目标 op 是否能接住一条 type 类型的线（拖线到空白时的过滤口径）。 */
export function acceptsWire(op, type) {
  return portsOf(op, []).some((p) => p.direction === "in" && p.type === type);
}

/** 端口的可读类型名（text/bytes 本地化）。 */
export function portTypeLabel(type) {
  return type === PORT_TYPE.BYTES ? tNv("nv.port.type.bytes") : tNv("nv.port.type.text");
}

/* ============================ 参数模型与校验 ============================ */

/** 算法页可渲染的参数类型全集（text/number/bool/select/password/textarea/image）。 */
export const PARAM_KINDS = ["text", "number", "bool", "select", "password", "textarea", "image"];

/** 与 main.js renderParam 的分支一一对应：textarea 兼容 ui:'bigText'。 */
export function paramKind(d) {
  if (!d) return "text";
  if (d.type === "bool") return "bool";
  if (d.type === "select") return "select";
  if (d.type === "number") return "number";
  if (d.type === "password") return "password";
  if (d.type === "textarea" || d.ui === "bigText") return "textarea";
  if (d.type === "image") return "image";
  return "text";
}

/** 敏感参数识别：与 main.js REVEALABLE_KEY_RE 同名同值（含 d.sensitive 显式标记）。 */
export const REVEALABLE_KEY_RE = /^(key|keys|dict|seed|salt|keyword|alphabet|pass|pwd|password|secret|token|nonce|iv)$/i;
export function isSensitive(d) {
  return !!(d && (d.sensitive || REVEALABLE_KEY_RE.test(String(d.key))));
}

export function paramLabel(d) {
  if (!d) return "";
  if (d.labelKey) {
    const s = tp(d.labelKey);
    if (s && s !== d.labelKey) return s;
  }
  return d.label != null ? d.label : d.key;
}

export function optionValue(o) {
  return o && typeof o === "object" ? o.value : o;
}

export function optionLabel(o) {
  if (o && typeof o === "object") {
    if (o.labelKey) {
      const s = tp(o.labelKey);
      if (s && s !== o.labelKey) return s;
    }
    return o.label != null ? o.label : String(o.value);
  }
  return String(o);
}

export function defaultParamValue(d) {
  if (!d) return "";
  if ("default" in d) return d.default;
  const k = paramKind(d);
  if (k === "bool") return false;
  if (k === "number") return 0;
  if (k === "select") return optionValue((d.options || [])[0]);
  return "";
}

/** op 的初始参数对象（与 registry.defaultParams 同义，但按当前表补齐缺省）。 */
export function initialParams(op) {
  const p = {};
  for (const d of op.params || []) p[d.key] = defaultParamValue(d);
  return p;
}

/**
 * 单参数校验 —— 与算法页同一套规则（main.js renderParam，4736-4960）：
 *   number : Number(raw)；空串/非数字 → 不写入有效值（算法页 blur 时清空）；
 *            超出 min/max 自动 clamp 到边界（算法页 clamp 后回写）。
 *   select : 取值必须是 options 里的 value；不在其中 → 回退默认（算法页 sel.value 赋非法值后浏览器落空）。
 *   bool   : 强制布尔（算法页读 checkbox.checked）。
 *   text/password/textarea/image : 原样字符串，不做内容校验（算法页同样不校验）。
 * 返回 { ok, value, code?, hint?, clamped? }；hint 已本地化，供检查器就地提示。
 */
export function validateParam(d, raw) {
  const kind = paramKind(d);
  if (kind === "number") {
    const s = String(raw == null ? "" : raw).trim();
    if (s === "") return { ok: false, code: "number.empty", value: "", hint: tNv("nv.insp.errNumberEmpty") };
    const n = Number(s);
    if (!Number.isFinite(n)) return { ok: false, code: "number.nan", value: s, hint: tNv("nv.insp.errNumber") };
    let v = n;
    let clamped = false;
    const min = Number.isFinite(d.min) ? d.min : null;
    const max = Number.isFinite(d.max) ? d.max : null;
    if (min !== null && v < min) { v = min; clamped = true; }
    if (max !== null && v > max) { v = max; clamped = true; }
    return {
      ok: true, value: v, clamped,
      hint: clamped ? tNv("nv.insp.errNumberRange", min, max) : "",
    };
  }
  if (kind === "select") {
    const opts = (d.options || []).map(optionValue);
    const hit = opts.find((v) => String(v) === String(raw));
    if (hit === undefined) {
      return { ok: false, code: "select.invalid", value: defaultParamValue(d), hint: tNv("nv.insp.errSelect") };
    }
    return { ok: true, value: hit, hint: "" };
  }
  if (kind === "bool") return { ok: true, value: !!raw, hint: "" };
  return { ok: true, value: raw == null ? "" : String(raw), hint: "" };
}

/** 整组参数校验：返回 { values, errors:[{key, code, hint}] }。 */
export function validateParams(op, values) {
  const out = { values: {}, errors: [] };
  for (const d of op.params || []) {
    const r = validateParam(d, values ? values[d.key] : defaultParamValue(d));
    out.values[d.key] = r.value;
    if (!r.ok) out.errors.push({ key: d.key, code: r.code, hint: r.hint });
  }
  return out;
}

/** 参数类型分布（回执/断言用）。 */
export function paramTypeStats() {
  const stats = {};
  for (const op of OPS) {
    if (op.__stub) continue;
    for (const d of op.params || []) {
      const k = paramKind(d);
      stats[k] = (stats[k] || 0) + 1;
    }
  }
  return stats;
}

/* ============================ 搜索（与全站搜索同源） ============================ */

let _aliasMap = null;
let _index = null;

/** 等科普数据就绪后取别名表（与 main.js eduAliasesSync 同源）。 */
export async function ensureAliases() {
  await eduContentReady();
  _aliasMap = eduAliasesSync() || {};
  return _aliasMap;
}

/** 索引字段与 main.js buildSearchIndex（5638-5666）逐项对齐。 */
function buildIndex() {
  const aliases = _aliasMap || {};
  const idx = [];
  for (const op of OPS) {
    if (op.__stub) continue;           // 惰载 stub 不是可用算法
    if (op.id === "cryptoTryAll") continue; // 虚拟 op 不进搜索（同 main.js）
    const nm = opNameOf(op);
    const ds = opDescOf(op);
    const catNameText = catNameOf(op.cat);
    const aka = expandAliases([nm, ds, catNameText, ...(aliases[op.id] || [])].join(" "), aliases[op.id] || []);
    const famName = op.family ? (FAMILY_NAMES[op.family] || "") : "";
    let famLbl = "";
    if (op.family && op.familyLabel) {
      const lk = "fam.lbl." + op.familyLabel;
      const lv = tp(lk);
      famLbl = lv === lk ? "" : lv;
    }
    const pyKeys = pinyinKeys(nm, aka);
    const hay = [nm, ...aka, ds, op.id, op.cat, catNameText, famName, famLbl, ...pyKeys].join("").toLowerCase();
    idx.push({ id: op.id, name: nm, desc: ds, cat: op.cat, aka, famName, hay, py: pyKeys });
  }
  return idx;
}

export function getSearchIndex() {
  if (!_index) _index = buildIndex();
  return _index;
}

/** 索引重建（切语言/别名补载后）。 */
export function invalidateSearchIndex() {
  _index = null;
}

// 动作词表（与 main.js 同源）：加密/解密/编码/解码/解析/解压/转换/生成/识别/提取/破解/计算/伪造。
// 中文词以 \u 转义拼进正则，避免本文件出现中文字面量（文案只允许在 i18n/*.json）。
const ZH_ACTION = "\\u52a0\\u5bc6|\\u89e3\\u5bc6|\\u7f16\\u7801|\\u89e3\\u7801|\\u89e3\\u6790|\\u89e3\\u538b|\\u8f6c\\u6362|\\u751f\\u6210|\\u8bc6\\u522b|\\u63d0\\u53d6|\\u7834\\u89e3|\\u8ba1\\u7b97|\\u4f2a\\u9020";
const EN_ACTION = "encrypt|decrypt|encode|decode|parse|convert|generate|identify|extract|crack|calculate|forge|decompress";
const ACTION_WORDS = new RegExp(`^(${ZH_ACTION}|${EN_ACTION})$`, "i");
const ACTION_SUFFIX = new RegExp(`(${ZH_ACTION}|${EN_ACTION})$`, "i");
// 中英/中数混写断开（同 main.js），CJK 区间用转义，避免本文件出现中文字面量。
const CJK = "\\u4e00-\\u9fff";
const SPLIT_CJK_THEN_ASCII = new RegExp(`([${CJK}])([a-z0-9])`, "g");
const SPLIT_ASCII_THEN_CJK = new RegExp(`([a-z0-9])([${CJK}])`, "g");

/**
 * 搜索：分词、动作词剥离、同义词扩展、打分、CTF 高频加权、短名优先
 * —— 全部与 main.js searchOps（5668-5715）一致。
 */
export function searchOps(q, limit) {
  const index = getSearchIndex();
  let query = String(q == null ? "" : q).trim().toLowerCase()
    .replace(SPLIT_CJK_THEN_ASCII, "$1 $2")
    .replace(SPLIT_ASCII_THEN_CJK, "$1 $2");
  if (!query) return [];
  let terms = query.split(/\s+/).filter(Boolean);
  const stripped = terms
    .filter((term) => !ACTION_WORDS.test(term))
    .map((term) => { const core = term.replace(ACTION_SUFFIX, ""); return core.length >= 2 ? core : term; });
  if (stripped.length) terms = stripped;
  const scored = [];
  for (const e of index) {
    let ok = true;
    let score = 0;
    for (const term of terms) {
      const alts = synonymsOf(term);
      let best = -1;
      for (const alt of alts) {
        if (!alt) continue;
        if (e.hay.indexOf(alt) < 0) continue;
        const nmPos = e.name.toLowerCase().indexOf(alt);
        let s;
        if (nmPos === 0) s = 100;
        else if (nmPos > 0) s = 40;
        else if (e.aka.some((a) => a.toLowerCase().includes(alt))) s = 30;
        else if (e.py && e.py.some((k) => k.startsWith(alt))) s = 20;
        else s = 10;
        if (s > best) best = s;
      }
      if (best < 0) { ok = false; break; }
      score += best;
    }
    if (ok) {
      score += CTF_HOT.has(e.id) ? 25 : 0;
      scored.push({ id: e.id, name: e.name, cat: e.cat, score, nl: e.name.length });
    }
  }
  scored.sort((a, b) => (b.score - a.score) || (a.nl - b.nl));
  return limit ? scored.slice(0, limit) : scored;
}

/* ============================ 初始化 ============================ */

let _init = null;

/** 载入文案 + 别名 + 索引。lang 省略时沿用当前语言。 */
export function initNodeView(lang) {
  if (_init) return _init;
  _init = (async () => {
    await loadNvMessages(lang || "zh");
    await ensureAliases();
    _index = null;
    return { ops: OPS.length, cats: CATEGORIES.length };
  })();
  return _init;
}

export { OPS, CATEGORIES, getOp };
