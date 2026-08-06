/*
 * decodeProfile.js — 一键解码「强度预设 + 自定义参与算法」的唯一事实源（纯逻辑，零 UI 依赖）。
 *
 * 解决什么：
 * 过去首页只有「深度爆破」「多层链式」两个裸开关，用户无法表达「我只要秒解」或
 * 「我愿意等 30 秒把冷门算法也试完」。本模块把强度做成 5 档预设（从热门到冷门 CTF 考点
 * 逐层放开），并允许用户手动勾选参与解码的算法、存成命名方案复用。
 *
 * ============ 分层口径（强度档 = rank 标注 + 能力分层 叠加） ============
 * 层级由两个正交维度合成：
 *   ① 考点热度：ctfPresets.js 的 CTF_HOT_META[id].rank（1 = 超高频，2 = 常见），无标注 = 冷门。
 *   ② 能力分层：magic 内部本就有的四类能力 —— 有 detect 的解码器 / 无 detect 的纯解码器
 *      （花式编码）/ 带参网格扫描 / 暴力（XOR·位旋转）。越往后越慢、越易出噪声。
 * 于是 tier 1..5 = 「热度从高到低」与「能力从省到费」同步放开，正好对应 5 个强度档。
 *
 * tier 1 热门解码器      rank1 且是解码器 —— 秒级，base64/hex/morse 这类先试的
 * tier 2 常见解码器      rank2 且是解码器 —— 分方向常客
 * tier 3 其余带 detect   有 detect 的解码器（强信号，误报低）
 * tier 4 无 detect 解码器 花式/衍生编码（靠字符集定义域预筛，量大）
 * tier 5 冷门/重活       其余可自动跑的解码器
 *
 * ============ 5 档强度 ============
 * fast     快速（秒解）    tier1        单层，不扫参数，不暴力
 * normal   默认（5 秒内）  tier1-3      单层 + 参数网格（P0）
 * enhanced 增强           tier1-4      2 层链式 + 参数网格全量
 * extreme  极强           tier1-5      3 层链式 + 暴力（XOR/位旋转）
 * max      最强           全部          3 层 + 暴力 + 穷举全解，预算拉满
 * custom   自定义         用户勾选      预算取 enhanced 档，op 集合由用户定
 *
 * 每档给 magicDecode 的 opts 见 STRENGTH_PRESETS[level].magic —— timeBudget/softDeadlineMs
 * 与档位名的承诺（「秒解」「5 秒内」）一致，不放空话。
 *
 * ============ 文本 / 文件双作用域 ============
 * 文本与文件参与的算法天然不同（文件走取证/隐写/容器解析，文本走编码/古典/现代密码）。
 * SCOPES = ["text","file"]，两套 op 集合与两套用户方案各存各的，互不串味。
 *
 * ============ 红线 ============
 * - core 层零 UI / i18n / main 依赖：只 import registry + ctfPresets（均为纯数据/纯函数）。
 * - 纯本地：方案存 localStorage，绝不外发。隐私模式 localStorage 抛错时静默降级为内存态。
 * - 不改 magic 排序逻辑：本模块只产出「允许哪些 op 参与」+ 预算参数，排序仍归 magic/scorer。
 */
import { OPS, CATEGORIES, getOp } from "./registry.js";
import { CTF_HOT_META } from "./ctfPresets.js";

// ============================================================
// 常量
// ============================================================

/** 作用域：文本输入 / 文件输入，两套配置独立。 */
export const SCOPES = ["text", "file"];

/** 强度档 id，从省到费。custom 单列（op 集合由用户定）。 */
export const STRENGTH_LEVELS = ["fast", "normal", "enhanced", "extreme", "max"];

/** 档位 → 放开到第几层 tier（含）。custom 不用此表。 */
const LEVEL_TIER = { fast: 1, normal: 3, enhanced: 4, extreme: 5, max: 5 };

/**
 * 各档给 magicDecode / exhaustiveDecode 的预算与开关。
 * timeBudget 与档名承诺对齐：fast 1.5s 内收、normal 5s 内、越往上越舍得花。
 * softDeadlineMs = 到点先把已得结果渲染出来（后台继续跑），保证界面不像卡死。
 */
export const STRENGTH_PRESETS = {
  fast: {
    tier: 1,
    magic: { maxDepth: 1, intensive: false, paramScan: false, lenient: false, timeBudget: 1500, softDeadlineMs: 800, guard: 6000, maxCandidates: 30 },
    exhaust: false,
  },
  normal: {
    tier: 3,
    magic: { maxDepth: 1, intensive: false, paramScan: true, paramScanLimit: 1000, lenient: false, timeBudget: 5000, softDeadlineMs: 2500, guard: 20000, maxCandidates: 50 },
    exhaust: false,
  },
  enhanced: {
    tier: 4,
    magic: { maxDepth: 2, intensive: false, paramScan: true, paramScanLimit: 4000, lenient: true, timeBudget: 12000, softDeadlineMs: 5000, guard: 50000, maxCandidates: 60 },
    exhaust: false,
  },
  extreme: {
    tier: 5,
    magic: { maxDepth: 3, intensive: true, paramScan: true, paramScanLimit: 8000, lenient: true, timeBudget: 25000, softDeadlineMs: 6000, guard: 90000, maxCandidates: 80 },
    exhaust: true,
  },
  max: {
    tier: 5,
    magic: { maxDepth: 3, intensive: true, paramScan: true, paramScanLimit: 20000, lenient: true, timeBudget: 60000, softDeadlineMs: 8000, guard: 200000, maxCandidates: 120 },
    exhaust: true,
  },
};

/** 自定义档沿用 enhanced 的预算（op 集合由用户勾选决定）。 */
const CUSTOM_BUDGET = STRENGTH_PRESETS.enhanced.magic;

/**
 * 文件作用域优先分类：拖入文件时这些分类的 op 才是主力。
 * 文本作用域反之——排除纯文件向分类，避免对一段密文跑 pcap 修复这类无意义项。
 */
const FILE_FIRST_CATS = new Set(["forensic", "stego", "data", "analysis"]);

// ============================================================
// 暴力爆破池（与解码池完全分离，恒烈 2026-08-03 需求）
// ============================================================

/**
 * 爆破/破解类 op 白名单（全为 run 型无 decode，opTier 恒 0、永不进主候选池）。
 * 独立成池：一键解码主排序不掺入它们的报告文本（避免被当明文误判置顶），
 * 结果单独归组展示。清单经遍历全量 OPS 实测确认（run 型 + id 白名单人工核对）。
 */
// 实测遍历全量 OPS 确认：仅以下 11 个为真实注册的 run 型爆破 op（rotBruteAll/substBrute 等 id 不存在，已剔除防幽灵条目）
export const BRUTE_OPS = [
  "xorBrute", "caesarBrute",
  "hashDictCrack", "rainbowQuery", "hmacKeyBrute", "pbeAesBrute", "playfairCrack",
  "zipBrute", "zipCrc32Brute", "crc32Collision", "bkcrackAttack",
];

/** 某 id 是否属爆破池。 */
export function isBruteOp(id) {
  return BRUTE_OPS.includes(id);
}

/**
 * 爆破池可用清单（带名称/分类，供 UI 渲染）。
 * 只返回真实注册且确为 run 型的项——插件可能未注册某些 op，不渲染幽灵条目。
 */
export function listBruteOps() {
  return BRUTE_OPS.map((id) => {
    const op = getOp(id);
    if (!op) return null;
    return { id, name: op.name || id, cat: op.cat || "", run: typeof op.run === "function" };
  }).filter(Boolean);
}

/**
 * 把爆破池包成「虚拟分类」供 decodeStrength 弹窗的 op 多选列表复用渲染。
 * cat 用 _brute 占位（不与真实分类撞），catName 走 i18n（ui.ds.brute.title）。
 * 该分类不参与 opPool / opsForLevel / tier 计算（仍只走 work.bruteIds 通道）。
 */
export function bruteOpGroup() {
  const ops = listBruteOps().map((b) => ({ id: b.id, cat: "_brute", name: b.name, tier: 0, primary: true }));
  return { cat: "_brute", catName: "暴力爆破（独立通道）", ops };
}

// ============================================================
// op 可自动参与的基础判定（与 magic.js 的排除口径保持一致）
// ============================================================

/**
 * 该 op 能否进入自动解码。
 * 排除 requiresBridge（需本地 exe 桥）、noAuto（重 op，作者标注不自动跑）。
 * 只收 decode（真解码器）——run-only 的哈希/报告类 op 对任意输入都吐报告文本，
 * 进自动解码会被当明文误判置顶（magic.js 已有同样口径，此处保持一致）。
 */
export function isAutoDecodable(op) {
  if (!op || op.requiresBridge || op.noAuto) return false;
  return typeof op.decode === "function";
}

/** 该 op 是否吃原始字节（文件作用域主力）。 */
function acceptsBytes(op) {
  return !!(op && op.acceptsBytes);
}

/**
 * 该 op 是否「必须有密钥/口令才有意义」。
 * 这类 op（AES/RC5/维吉尼亚/Magma…）在用户没填密钥时只能靠猜，属最贵的一档：
 * 要么等用户在密钥框填值，要么靠爆破。故单独归到最冷的 tier 5。
 * 判据 = 参数表里有 key/password/passphrase/keyword/secret 类必填项（不含 keyEnc/keyBits
 * 这种「密钥编码/长度」的附属参数——它们不是密钥本体）。
 */
const KEY_PARAM_RE = /^(key|key1|key2|keyword|password|passphrase|secret|pass)$/i;
function needsKey(op) {
  const ps = (op && op.params) || [];
  return ps.some((p) => p && KEY_PARAM_RE.test(String(p.key || "")));
}

// ============================================================
// tier 计算
// ============================================================

/**
 * 计算某 op 的 tier（1..5）。不可自动解码返回 0（永不参与）。
 * 口径：热度（CTF_HOT_META.rank）优先，其次能力分层（有无 detect）。
 */
export function opTier(op) {
  if (!isAutoDecodable(op)) return 0;
  const meta = CTF_HOT_META[op.id];
  const hasDetect = typeof op.detect === "function";
  // 热度优先：人工标注的高频考点无条件排前（哪怕它需要密钥，如 aes/xor）
  if (meta && meta.rank === 1) return 1;
  if (meta && meta.rank === 2) return 2;
  // 其余按「误报低→高、代价小→大」排：
  if (hasDetect) return 3;        // 有指纹 = 强信号
  if (needsKey(op)) return 5;     // 没密钥只能猜，最贵，压到最后一档
  return 4;                       // 无 detect 的纯编码（靠字符集定义域预筛）
}

/**
 * 全量 op 的 tier 映射（含不可自动解码的，tier 0）。
 * 每次调用重算——插件可动态注册/注销 op，缓存会过期。OPS 量级几百，开销可忽略。
 */
export function buildTierMap() {
  const m = new Map();
  for (const op of OPS) m.set(op.id, opTier(op));
  return m;
}

/**
 * 某作用域下「候选池」：该作用域值得列出/参与的 op 列表。
 * - text：排除只对文件有意义的分类（除非该 op 也能吃文本）
 * - file：优先文件向分类 + acceptsBytes，其余仍可勾（用户可能先把文件读成文本）
 * 返回按分类分组，供 UI 折叠渲染；同时带 tier 供强度档筛选。
 */
export function opPool(scope = "text") {
  const pool = [];
  for (const op of OPS) {
    const tier = opTier(op);
    if (!tier) continue;                       // 不可自动解码的不进池
    const fileward = FILE_FIRST_CATS.has(op.cat) || acceptsBytes(op);
    if (scope === "file") {
      // 文件域：文件向 op 排前，其余照列（不硬排除，留用户自主）
      pool.push({ id: op.id, cat: op.cat, name: op.name, tier, primary: fileward });
    } else {
      // 文本域：纯文件向（吃字节且属文件分类）的排除，其余照列
      const onlyFile = acceptsBytes(op) && FILE_FIRST_CATS.has(op.cat);
      if (onlyFile) continue;
      pool.push({ id: op.id, cat: op.cat, name: op.name, tier, primary: true });
    }
  }
  return pool;
}

/** 候选池按分类分组（UI 折叠用）。返回 [{cat, catName, ops:[...]}]，空分类不返回。 */
export function opPoolByCat(scope = "text") {
  const pool = opPool(scope);
  const byCat = new Map();
  for (const o of pool) {
    if (!byCat.has(o.cat)) byCat.set(o.cat, []);
    byCat.get(o.cat).push(o);
  }
  const out = [];
  for (const c of CATEGORIES) {
    const ops = byCat.get(c.id);
    if (!ops || !ops.length) continue;
    ops.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
    out.push({ cat: c.id, catName: c.name, ops });
  }
  // CATEGORIES 之外的分类（插件自注册）兜底追加，不漏
  for (const [cat, ops] of byCat) {
    if (CATEGORIES.some((c) => c.id === cat)) continue;
    ops.sort((a, b) => a.tier - b.tier || a.id.localeCompare(b.id));
    out.push({ cat, catName: cat, ops });
  }
  return out;
}

/** 某档强度在某作用域下默认参与的 op id 集合。 */
export function opsForLevel(level, scope = "text") {
  const maxTier = LEVEL_TIER[level] ?? LEVEL_TIER.normal;
  const out = new Set();
  for (const o of opPool(scope)) {
    if (o.tier <= maxTier) out.add(o.id);
  }
  return out;
}

// ============================================================
// 配置解析：档位/自定义 → 传给 magicDecode 的 opts
// ============================================================

/**
 * 把「强度档 + 自定义勾选」解析成一键解码要用的参数。
 * @param {object} cfg { level, scope, customIds?:string[] }
 * @returns {{ level, scope, allowOps:Set<string>, magic:object, exhaust:boolean }}
 *   allowOps 为 null 表示不限制（max 档全放开，交给 magic 原有逻辑）。
 */
export function resolveDecodeConfig(cfg = {}) {
  const scope = SCOPES.includes(cfg.scope) ? cfg.scope : "text";
  const level = cfg.level === "custom" || STRENGTH_PRESETS[cfg.level] ? cfg.level : "normal";

  if (level === "custom") {
    const ids = Array.isArray(cfg.customIds) ? cfg.customIds.filter((id) => {
      const op = getOp(id);
      return op && isAutoDecodable(op);
    }) : [];
    return {
      level, scope,
      allowOps: new Set(ids),
      magic: { ...CUSTOM_BUDGET },
      exhaust: false,
      bruteOps: bruteIdsOf(cfg.bruteIds),
    };
  }

  const preset = STRENGTH_PRESETS[level];
  // max 档不设白名单：全部放开，等同旧行为（避免白名单反而挡掉插件新注册的 op）
  const allowOps = level === "max" ? null : opsForLevel(level, scope);
  return { level, scope, allowOps, magic: { ...preset.magic }, exhaust: preset.exhaust, bruteOps: bruteIdsOf(cfg.bruteIds) };
}

/** 从用户勾选里挑出真实注册的爆破 op id（幽灵 id 剔除）。 */
function bruteIdsOf(ids) {
  if (!Array.isArray(ids) || !ids.length) return [];
  return ids.filter((id) => isBruteOp(id) && getOp(id) && typeof getOp(id).run === "function");
}

// ============================================================
// 用户方案持久化（命名方案，可存多套 + 导入导出）
// ============================================================

const STORE_KEY = "ebctf.decodeProfiles";

// 隐私模式/禁用 localStorage 时的内存兜底（本次会话有效，不报错阻塞 UI）
let _memStore = null;

function readStore() {
  if (_memStore) return _memStore;
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { text: {}, file: {}, last: {} };
    const o = JSON.parse(raw);
    return {
      text: (o && o.text) || {},
      file: (o && o.file) || {},
      last: (o && o.last) || {},
    };
  } catch {
    return { text: {}, file: {}, last: {} };
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
    _memStore = null;
  } catch {
    _memStore = store;   // 隐私模式：退内存态，本次会话仍可用
  }
}

/** 列出某作用域下已存方案名。 */
export function listProfiles(scope = "text") {
  const store = readStore();
  return Object.keys(store[scope] || {}).sort();
}

/** 读某方案：返回 { level, customIds } 或 null。 */
export function loadProfile(name, scope = "text") {
  const store = readStore();
  const p = (store[scope] || {})[name];
  if (!p) return null;
  return { level: p.level || "custom", customIds: Array.isArray(p.customIds) ? p.customIds : [] };
}

/** 存/覆盖某方案。name 空则忽略。 */
export function saveProfile(name, cfg, scope = "text") {
  const n = String(name || "").trim();
  if (!n) return false;
  const store = readStore();
  if (!store[scope]) store[scope] = {};
  store[scope][n] = {
    level: cfg && cfg.level ? cfg.level : "custom",
    customIds: Array.isArray(cfg && cfg.customIds) ? cfg.customIds.slice() : [],
  };
  writeStore(store);
  return true;
}

/** 删某方案。 */
export function deleteProfile(name, scope = "text") {
  const store = readStore();
  if (store[scope] && store[scope][name]) {
    delete store[scope][name];
    writeStore(store);
    return true;
  }
  return false;
}

/** 记住上次用的配置（下次进首页沿用）。 */
export function saveLastConfig(cfg, scope = "text") {
  const store = readStore();
  if (!store.last) store.last = {};
  store.last[scope] = {
    level: cfg && cfg.level ? cfg.level : "normal",
    customIds: Array.isArray(cfg && cfg.customIds) ? cfg.customIds.slice() : [],
  };
  writeStore(store);
}

/** 取上次配置，无则给默认档。 */
export function loadLastConfig(scope = "text") {
  const store = readStore();
  const l = (store.last || {})[scope];
  if (!l) return { level: "normal", customIds: [] };
  return {
    level: l.level || "normal",
    customIds: Array.isArray(l.customIds) ? l.customIds : [],
  };
}

/** 导出全部方案为 JSON 字符串（用户可存文件/贴给队友）。 */
export function exportProfiles() {
  const store = readStore();
  return JSON.stringify({ v: 1, text: store.text || {}, file: store.file || {} }, null, 2);
}

/**
 * 导入方案 JSON（合并，同名覆盖）。返回导入条数；格式非法抛错由调用方提示。
 */
export function importProfiles(json) {
  const o = JSON.parse(String(json || ""));
  const store = readStore();
  let n = 0;
  for (const scope of SCOPES) {
    const incoming = o && o[scope];
    if (!incoming || typeof incoming !== "object") continue;
    if (!store[scope]) store[scope] = {};
    for (const [name, p] of Object.entries(incoming)) {
      if (!p || typeof p !== "object") continue;
      store[scope][name] = {
        level: p.level || "custom",
        customIds: Array.isArray(p.customIds) ? p.customIds : [],
      };
      n++;
    }
  }
  writeStore(store);
  return n;
}
