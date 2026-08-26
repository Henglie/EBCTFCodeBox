/*
 * i18n/index.js — 国际化核心（20 语言，自动识别 + 手动切换）。
 *
 * 职责：
 * 1. 启动读 navigator.language 匹配支持的语言前缀，命中则用，否则英文。
 * 2. localStorage['ebctf_locale'] 优先于自动判断（用户手动切过就记住）。
 * 3. t(key, ...args) 取文案，缺 key 回退 zh 再回退 key 本身（不白屏）；{0}{1} 占位符替换。
 * 4. setLocale/getLocale/onLocaleChange 供 UI 切换 + 订阅重渲染。
 * 5. <html lang> 与 <html dir> 随语言同步；RTL 语言（ar/he/fa/ur/ug）自动切右到左布局。
 * 6. 中国境内四门民族语言（bo/ug/za-Latn/mn-Mong）以中文为基底：英文占位自动换成中文，
 *    见 CN_BASE_LOCALES / applyCnBase。
 *
 * 加载策略：zh/en 静态打进主 bundle（默认双语零延迟）；其余 18 语言按需 dynamic import
 * （不进主 bundle，切到才拉对应 locales/<code>.js，减小首屏体积）。
 *
 * 红线：core 算法层绝不 import 本模块（纯函数）。i18n 只在 ui / main 层用。
 * op 名/描述缺 key 时 main 层 fallback 到 registry 中文字面量，未翻译不白屏。
 */
import zh from "./zh.js";
import en from "./en.js";

// 语言元数据：name = 该语言自称（切换菜单直接显示）；dir = 文字方向。
export const LOCALE_META = {
  zh: { name: "中文", dir: "ltr" },
  en: { name: "English", dir: "ltr" },
  es: { name: "Español", dir: "ltr" },
  fr: { name: "Français", dir: "ltr" },
  de: { name: "Deutsch", dir: "ltr" },
  ja: { name: "日本語", dir: "ltr" },
  ko: { name: "한국어", dir: "ltr" },
  ru: { name: "Русский", dir: "ltr" },
  pt: { name: "Português", dir: "ltr" },
  hi: { name: "हिन्दी", dir: "ltr" },
  id: { name: "Bahasa Indonesia", dir: "ltr" },
  tr: { name: "Türkçe", dir: "ltr" },
  ar: { name: "العربية", dir: "rtl" },
  he: { name: "עברית", dir: "rtl" },
  fa: { name: "فارسی", dir: "rtl" },
  ur: { name: "اردو", dir: "rtl" },
  // ---- MT76③ 新增民族语言（2026-08-24 落地）----
  bo: { name: "藏语 བོད་ཡིག", dir: "ltr" },              // 藏文
  ug: { name: "维吾尔语 ئۇيغۇرچە", dir: "rtl" },           // 维吾尔文（阿拉伯字母，右到左）
  "za-Latn": { name: "壮语 Vahcuengh", dir: "ltr" },      // 壮文·拉丁版
  "mn-Mong": { name: "蒙古语 ᠮᠣᠩᠭᠣᠯ ᠪᠢᠴᠢᠭ", dir: "ltr" },  // 传统蒙文（人民币式横排）
};

// 已加载字典：zh/en 静态在册，其余切到时按需 import 填入。
const DICTS = { zh, en };
// 语言文件在途 import 承诺缓存（防同一语言并发重复拉取）。
const _loading = {};
const STORE_KEY = "ebctf_locale";
const _listeners = new Set();

function detectLocale() {
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && LOCALE_META[saved]) return saved;
  } catch { /* localStorage 不可用（隐私模式等）→ 走自动判断 */ }
  const nav = (navigator.language || navigator.userLanguage || "en").toLowerCase();
  // 按语言主标签（zh-CN → zh）匹配支持列表。
  const primary = nav.split("-")[0];
  return LOCALE_META[primary] ? primary : "en";
}

let _locale = detectLocale();

/** 当前语言的文字方向（'ltr' | 'rtl'）。 */
export function getDir() {
  return (LOCALE_META[_locale] && LOCALE_META[_locale].dir) || "ltr";
}

function syncHtmlLangDir() {
  try {
    document.documentElement.setAttribute("lang", _locale === "zh" ? "zh-CN" : _locale);
    document.documentElement.setAttribute("dir", getDir());
  } catch { /* 非浏览器环境（node 单测）忽略 */ }
}
syncHtmlLangDir();

/*
 * ---- 中国境内民族语言：以中文为基底（恒烈明令，MT86）----
 *
 * 这四门语言的现代科技术语，借词来源是**汉语**而不是英语。未翻译的条目回退英文会造成
 * 「藏文界面里冒出一串英文」的割裂感；回退中文则符合这些语言的实际使用习惯（本族语法框架 +
 * 汉语术语），也是这些地区用户真实的阅读预期。
 *
 * 触发条件：该语言的值与 en 表逐字相同 = 补翻时留的英文占位（不是真译文）→ 换成 zh 表的值。
 * 排除 op.*.name：算法名全语言保留英文，是项目既定规则（Base64 就该叫 Base64）。
 * 排除 zh 与 en 本就相同的 key：纯技术专名（JSON / Worker / Markdown），换不换一个样。
 *
 * 放在运行时而不是改 locales/*.js 静态文件的理由：将来新增 key 时占位自动生效，
 * 不必每次补翻都记得回来同步这四个文件。补翻真译文后本逻辑自动让路（值 ≠ en 即跳过）。
 */
export const CN_BASE_LOCALES = new Set(["bo", "ug", "za-Latn", "mn-Mong"]);

function applyCnBase(dict) {
  if (!dict) return 0;
  let n = 0;
  for (const k of Object.keys(en)) {
    if (k.startsWith("op.") && k.endsWith(".name")) continue; // 算法名保留英文
    if (dict[k] !== en[k]) continue;                          // 已有真译文
    const z = zh[k];
    if (z == null || z === en[k]) continue;                   // 中文表也是同一串
    dict[k] = z;
    n++;
  }
  return n;
}

/**
 * 确保某语言字典已加载。zh/en 立即返回；其余 dynamic import locales/<code>.js。
 * 拉取失败（文件缺失/网络错）返回 null，调用方回退英文，绝不白屏。
 * @returns {Promise<object|null>}
 */
export async function ensureLoaded(loc) {
  if (DICTS[loc]) return DICTS[loc];
  if (!LOCALE_META[loc]) return null;
  if (_loading[loc]) return _loading[loc];
  _loading[loc] = import(`./locales/${loc}.js`)
    .then((m) => {
      const dict = m.default || {};
      if (CN_BASE_LOCALES.has(loc)) applyCnBase(dict);
      DICTS[loc] = dict;
      return dict;
    })
    .catch((err) => { console.warn(`语言包 ${loc} 加载失败，回退 en`, err); return null; });
  return _loading[loc];
}

/**
 * 启动引导：若持久化/自动判定的语言是懒加载语言（非 zh/en），先把它的字典拉进来
 * 再让 UI 首次渲染，避免首屏全回退 zh。main.js 启动早期 await 本函数。
 * 加载失败静默降级 en（_locale 回退），绝不阻塞启动。
 */
export async function initLocale() {
  if (DICTS[_locale]) return _locale;
  const dict = await ensureLoaded(_locale);
  if (!dict) { _locale = "en"; syncHtmlLangDir(); }
  return _locale;
}

/** 当前语言码。 */
export function getLocale() {
  return _locale;
}

/** 支持的语言码列表（全部 20 个，含未加载的懒加载语言）。 */
export function locales() {
  return Object.keys(LOCALE_META);
}

/**
 * 切换语言：按需加载语言包 → 写 localStorage → 同步 <html lang/dir> → 触发订阅重渲染。
 * async：懒加载语言需 await；UI 切换处 await 后界面才带新文案重绘。
 */
export async function setLocale(loc) {
  if (!LOCALE_META[loc] || loc === _locale) return;
  const dict = await ensureLoaded(loc);
  if (!dict) return; // 加载失败保持原语言，不切到空表
  _locale = loc;
  try { localStorage.setItem(STORE_KEY, loc); } catch { /* 忽略 */ }
  syncHtmlLangDir();
  for (const cb of _listeners) {
    try { cb(loc); } catch { /* 单个订阅出错不影响其余 */ }
  }
}

/** 订阅语言变化，返回取消订阅函数。 */
export function onLocaleChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/**
 * 双语取值「中文 (English)」——仅供一键解码/穷举结果卡区用（对照原文与各解码器名
 * 中英并列一眼识别）。菜单/参数表等其余 UI 仍走 t 单语，不受影响。
 * - zh/en 两表都有该 key：返回 `中zh (英en)`；两值相同（纯专有名如 Base64）不重复括号。
 * - 只有一个表有：返回那个值。
 * - 都缺：回退 fallback（调用方传 registry name）或 key 本身。
 */
export function tBilingual(key, fallback) {
  const z = DICTS.zh && DICTS.zh[key];
  const e = DICTS.en && DICTS.en[key];
  if (z == null && e == null) return fallback != null ? fallback : key;
  if (z == null) return e;
  if (e == null) return z;
 // 归一化比较：去空白后相同 → 纯专有名词，不重复
  if (String(z).replace(/\s+/g, "") === String(e).replace(/\s+/g, "")) return z;
 // en 自带括号（如 "Chinese Remainder Theorem (CRT)"、"Tianshu (Heavenly Scripture)"）→
 // 拍平成破折号，避免嵌套括号 "((...))"。外层统一用一对括号包裹英文。
  const eFlat = String(e).includes("(")
    ? String(e).replace(/\s*\(\s*/g, " – ").replace(/\s*\)\s*/g, "").trim()
    : String(e);
  return `${z} (${eFlat})`;
}

/**
 * 运行时并入多语言文案（插件用）。dicts 形如 { zh:{key:val}, en:{...}, ja:{...} }
 * 逐语言合并进对应表；已有 key 默认不覆盖（overwrite=true 才覆盖），避免插件误改内置文案。
 * 新语言码（如插件带来的 ja/fr）自动登记到 locales，语言切换菜单随之出现。
 * @param {Record<string, Record<string,string>>} dicts 多语言字典
 * @param {boolean} [overwrite=false] 是否覆盖已有 key
 * @returns {number} 实际写入的 key 总数
 */
export function mergeDict(dicts, overwrite = false) {
  if (!dicts || typeof dicts !== "object") return 0;
  let n = 0;
  for (const [loc, dict] of Object.entries(dicts)) {
    if (!dict || typeof dict !== "object") continue;
    const target = DICTS[loc] || (DICTS[loc] = {});
    for (const [k, v] of Object.entries(dict)) {
      if (!overwrite && target[k] != null) continue;
      target[k] = v;
      n++;
    }
  }
  return n;
}

/**
 * 撤销 mergeDict（插件卸载用）。按传入的同一 dicts 形状逐 key 删除。
 * 只删插件自己注入的 key，不动内置文案（内置 key 本就不在插件 dicts 里）。
 * @param {Record<string, Record<string,string>>} dicts 当初 mergeDict 传入的字典
 */
export function unmergeDict(dicts) {
  if (!dicts || typeof dicts !== "object") return;
  for (const [loc, dict] of Object.entries(dicts)) {
    const target = DICTS[loc];
    if (!target || !dict) continue;
    for (const k of Object.keys(dict)) delete target[k];
  }
}

/**
 * 取文案。缺 key 时：先回退到 zh 表（至少显示中文而非裸 key），再回退 key 本身。
 * {0}{1}… 占位符按 args 顺序替换。
 */
export function t(key, ...args) {
  const dict = DICTS[_locale] || {};
  let s = dict[key];
  if (s == null) s = (DICTS.zh && DICTS.zh[key]) != null ? DICTS.zh[key] : key;
  if (args.length) {
    s = String(s).replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? args[i] : m));
  }
  return s;
}
