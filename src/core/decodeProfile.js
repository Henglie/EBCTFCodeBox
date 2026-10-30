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
 * 文件域除解码器外还收文件向 run 型工具（pcap/strings/exif/归档解析等，本地桥除外），
 * 并把 stegoFileScan 的固定自动集在 normal 及以上默认放行；fast 不跑重活。
 * allowOps 对文件分析是「白名单」语义：null = 不限，Set/数组 = 只跑命中项。
 *
 * ============ 红线 ============
 * - core 层零 UI / i18n / main 依赖：只 import registry + ctfPresets（均为纯数据/纯函数）。
 * - 纯本地：方案存 localStorage，绝不外发。隐私模式 localStorage 抛错时静默降级为内存态。
 * - 不改 magic 排序逻辑：本模块只产出「允许哪些 op 参与」+ 预算参数，排序仍归 magic/scorer。
 *
 * ============ 循环解码（增强） ============
 * 同一解码（Base64/Hex/URL）反复施加，直到三条件之一：无法继续（解码失败或结果
 * 不再变化）/ 命中正则提前停 / 达轮数上限。输出每轮中间值 + 最终结果。
 * 多层套娃编码（Base64 × N 层）一把解开。纯执行原语（零状态零 UI），
 * UI 入口由 main 侧接线（本模块只出 loopDecode / formatLoopReport）。
 */
import { OPS, CATEGORIES, getOp } from "./registry.js";
import { CTF_HOT_META } from "./ctfPresets.js";
// 字节统计模型标签（纯常量，零副作用）——供模型提名报告格式化用。
import { LABELS as BYTESTAT_LABELS } from "./magic/byteStatCnn.js";

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
// 「倾向文件输入」的分类：智能解码走文件优先路径时的判据之一。
// ⚠ 分类拆分后必须同步：forensic/stego 已裂成 archive+crack+forensic+filefmt
//  与 image+audio+stegoFile，漏改会让这些类的 op 在智能解码里丢掉"文件优先"待遇。
// 保留 "stego" 作历史兼容（旧插件/旧方案可能仍用该 id）。
const FILE_FIRST_CATS = new Set([
  "archive", "crack", "forensic", "filefmt",
  "image", "audio", "stego", "stegoFile",
  "data", "analysis",
]);

// ============================================================
// 暴力爆破池（与解码池完全分离，产品负责人 2026-08-03 需求）
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
 * 文件分析固定自动集的成员（与 stegoFileScan 的历史行为对齐）。
 * 默认档及以上放行基础隐写尝试；重/解释器类按 FILE_BASELINE_MIN_LEVEL 抬高门槛，
 * 避免「拖图即自动跑 Piet」这类高噪声重活污染默认结果。fast 档不跑重活。
 */
// jsteg / F5 仅手动：F5 误报率高、jsteg 耗时占空间，不进档位预设的固定自动集。
export const FILE_BASELINE_OPS = [
  "outguess", "steghide",
  "morseWav", "watermarkhFft", "pietExec",
  "rasterStego", "mp3stego",
];
const _fileBaseline = new Set(FILE_BASELINE_OPS);

/**
 * 固定自动集成员的最低强度档。未列出的成员默认 normal；
 * Piet 执行是完整解释器（重、噪声大），只有 enhanced 及以上才自动进一把梭。
 */
export const FILE_BASELINE_MIN_LEVEL = {
  pietExec: "enhanced",
};
const LEVEL_ORDER = { fast: 0, normal: 1, enhanced: 2, extreme: 3, max: 4 };

/** 某 id 是否属文件分析固定自动集。 */
export function isFileBaselineOp(id) {
  return _fileBaseline.has(id);
}

/** 固定自动集成员在指定强度档是否应自动参与（fast 一律不跑重活）。 */
export function isFileBaselineAllowedAt(id, level) {
  if (!_fileBaseline.has(id)) return false;
  if (level === "fast" || !level) return false;
  const min = FILE_BASELINE_MIN_LEVEL[id] || "normal";
  return (LEVEL_ORDER[level] ?? LEVEL_ORDER.normal) >= (LEVEL_ORDER[min] ?? LEVEL_ORDER.normal);
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
 * 文件作用域可实际调度的 op：有 decode 或 run，且不依赖本地桥。
 * 文件侧很多能力是 run 型取证工具（pcap/strings/exif/归档解析），
 * 它们不参与 magicDecode，但必须出现在文件页签并可按强度放行。
 */
export function isFileRunnable(op) {
  if (!op || op.requiresBridge) return false;
  return typeof op.decode === "function" || typeof op.run === "function";
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
 * 文件作用域 tier：解码器沿用 opTier；run 型文件工具按热度补层，冷门压到 5。
 * noAuto 的 op 仍列出（供用户手动勾选），但 UI 侧标记 auto=false，档位默认集合不收。
 */
function fileOpTier(op) {
  const t = opTier(op);
  if (t) return t;
  if (!isFileRunnable(op)) return 0;
  const meta = CTF_HOT_META[op.id];
  if (meta && meta.rank === 1) return 1;
  if (meta && meta.rank === 2) return 2;
  return 5;
}

/**
 * 某作用域下「候选池」：该作用域值得列出/参与的 op 列表。
 * - text：只收可自动解码的 op，并排除只对文件有意义的分类（除非该 op 也能吃文本）
 * - file：收 decode/run 两类（本地桥除外）；文件向分类 + acceptsBytes 标 primary，
 *   其余仍可勾（用户可能先把文件读成文本）
 * 返回按分类分组，供 UI 折叠渲染；同时带 tier 供强度档筛选、auto 供档位默认集合过滤。
 */
export function opPool(scope = "text") {
  const pool = [];
  for (const op of OPS) {
    if (isBruteOp(op.id)) continue;            // 爆破走独立通道，不进普通候选池
    if (scope === "file") {
      const tier = fileOpTier(op);
      if (!tier) continue;
      const fileCat = FILE_FIRST_CATS.has(op.cat);
      // 解码器全域保留（文件内容可能先当文本解）；run 型只收文件向分类，
      // 避免把哈希计算、非对称密钥工具等纯文本/通用 run op 塞进文件页签。
      // 固定自动集成员即使分类不在文件向清单也保留（如 PNG 的 Piet 执行）。
      if (!isAutoDecodable(op) && !(fileCat && isFileRunnable(op)) && !_fileBaseline.has(op.id)) continue;
      // 文件域：文件向 op 排前，其余照列（不硬排除，留用户自主）
      const fileward = fileCat || acceptsBytes(op);
      pool.push({
        id: op.id, cat: op.cat, name: op.name, tier,
        primary: fileward, auto: !op.noAuto, baseline: _fileBaseline.has(op.id),
      });
      continue;
    }
    const tier = opTier(op);
    if (!tier) continue;                       // 文本域：不可自动解码的不进池
    // 文本域：纯文件向（吃字节且属文件分类）的排除，其余照列
    const onlyFile = acceptsBytes(op) && FILE_FIRST_CATS.has(op.cat);
    if (onlyFile) continue;
    pool.push({ id: op.id, cat: op.cat, name: op.name, tier, primary: true, auto: true });
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

/** 某档强度在某作用域下默认参与的 op id 集合（noAuto 项只在用户手动勾选时生效）。 */
export function opsForLevel(level, scope = "text") {
  const maxTier = LEVEL_TIER[level] ?? LEVEL_TIER.normal;
  // 文件域固定自动集按成员最低档放行（normal 基础集 / enhanced 起 Piet）。
  const keepBaseline = scope === "file" && !!STRENGTH_PRESETS[level];
  const out = new Set();
  for (const o of opPool(scope)) {
    if (o.auto === false) continue;
    if (o.tier <= maxTier || (keepBaseline && isFileBaselineAllowedAt(o.id, level))) out.add(o.id);
  }
  return out;
}

/** 某作用域允许用户勾选的 op id 集合（自定义档 / 方案载入的过滤口径）。 */
export function selectableOpIds(scope = "text") {
  return new Set(opPool(scope).map((o) => o.id));
}

// ============================================================
// 作用域配置归一化（纯函数，UI 与 main 共用；零 DOM）
// ============================================================

/** 解析层数只允许 1..3；非法值回退到档位预设。 */
export function normalizeDepth(value, fallback = 1) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(3, n));
}

/** 缺省作用域配置：默认档 + 空勾选 + 默认层数。 */
export function defaultScopeConfig(scope = "text") {
  const preset = STRENGTH_PRESETS.normal;
  return {
    level: "normal",
    customIds: [],
    depth: preset.magic.maxDepth,
    bruteIds: [],
  };
}

/** 该对象是否是 { text?, file? } 双作用域形状（旧单层 {level,customIds} 不算）。 */
export function isScopeBundle(cfg) {
  if (!cfg || typeof cfg !== "object") return false;
  return !!((cfg.text && typeof cfg.text === "object") || (cfg.file && typeof cfg.file === "object"));
}

/**
 * 归一化单个作用域的配置：
 * - level 非法回退 normal；customIds 只保留该作用域池内真实存在的 id（去重）
 * - depth 夹到 1..3，缺省取档位预设（custom 取 enhanced）
 * - bruteIds 只保留真实爆破 op，且只在 text 作用域有效
 * @param {object} cfg { level?, customIds?, depth?, bruteIds? }
 * @param {"text"|"file"} scope
 */
export function normalizeScopeConfig(cfg = {}, scope = "text") {
  const sc = SCOPES.includes(scope) ? scope : "text";
  const src = cfg && typeof cfg === "object" ? cfg : {};
  const level = src.level === "custom" || STRENGTH_PRESETS[src.level] ? src.level : "normal";
  const preset = STRENGTH_PRESETS[level === "custom" ? "enhanced" : level];
  const validIds = selectableOpIds(sc);
  const customIds = Array.isArray(src.customIds)
    ? [...new Set(src.customIds.filter((id) => typeof id === "string" && validIds.has(id)))]
    : [];
  const bruteIds = sc === "text" && Array.isArray(src.bruteIds)
    ? [...new Set(src.bruteIds.filter((id) => isBruteOp(id)))]
    : [];
  return {
    level,
    customIds,
    depth: normalizeDepth(src.depth, preset.magic.maxDepth),
    bruteIds,
  };
}

/**
 * 归一化新旧两种弹窗配置：
 * - 双作用域 {text,file} → 两套各自归一
 * - 旧单层 {level,customIds} → 归到 text，file 用默认 normal
 * @returns {{text:object, file:object, legacy:boolean}}
 */
export function normalizeScopeBundle(cfg = {}) {
  if (isScopeBundle(cfg)) {
    return {
      text: normalizeScopeConfig(cfg.text, "text"),
      file: normalizeScopeConfig(cfg.file, "file"),
      legacy: false,
    };
  }
  return {
    text: normalizeScopeConfig(cfg, "text"),
    file: defaultScopeConfig("file"),
    legacy: true,
  };
}

// ============================================================
// 配置解析：档位/自定义 → 传给 magicDecode 的 opts
// ============================================================

/**
 * 把「强度档 + 自定义勾选」解析成一键解码要用的参数。
 * @param {object} cfg { level, scope, customIds?:string[], depth?:1..3, bruteIds?:string[] }
 * @returns {{ level, scope, allowOps:Set<string>|null, magic:object, exhaust:boolean, bruteOps:string[] }}
 *   allowOps 为 null 表示不限制（max 档全放开，交给 magic 原有逻辑）。
 *   file 作用域的 allowOps 同时含 decode/run 两类，供文件分析按强度过滤。
 */
export function resolveDecodeConfig(cfg = {}) {
  const src = cfg && typeof cfg === "object" ? cfg : {};
  const scope = SCOPES.includes(src.scope) ? src.scope : "text";
  const level = src.level === "custom" || STRENGTH_PRESETS[src.level] ? src.level : "normal";
  const bruteOps = scope === "text" ? bruteIdsOf(src.bruteIds) : [];

  if (level === "custom") {
    const poolIds = selectableOpIds(scope);
    const ids = Array.isArray(src.customIds) ? src.customIds.filter((id) => poolIds.has(id)) : [];
    const magic = { ...CUSTOM_BUDGET };
    magic.maxDepth = normalizeDepth(src.depth, magic.maxDepth);
    return {
      level, scope,
      allowOps: new Set(ids),
      magic,
      exhaust: false,
      bruteOps,
    };
  }

  const preset = STRENGTH_PRESETS[level];
  // max 档不设白名单：全部放开，等同旧行为（避免白名单反而挡掉插件新注册的 op）
  const allowOps = level === "max" ? null : opsForLevel(level, scope);
  const magic = { ...preset.magic };
  magic.maxDepth = normalizeDepth(src.depth, magic.maxDepth);
  return { level, scope, allowOps, magic, exhaust: preset.exhaust, bruteOps };
}

/**
 * allowOps 过滤语义（供文件分析 / 隐写自动尝试等消费方复用）。
 * null/undefined = 不限制；Set 或数组按 id 命中；其他值按不限制处理。
 */
export function isOpAllowed(allowOps, id) {
  if (allowOps == null) return true;
  if (allowOps instanceof Set) return allowOps.has(id);
  if (Array.isArray(allowOps)) return allowOps.includes(id);
  return true;
}

/**
 * 「应用」回执：始终双作用域 {text,file}；顶层再平铺 text 字段，
 * 让仍按 {level,customIds} 读取的旧调用无需改签名即可工作。
 */
export function buildApplyPayload(textCfg, fileCfg) {
  const text = normalizeScopeConfig(textCfg, "text");
  const file = normalizeScopeConfig(fileCfg, "file");
  return {
    text,
    file,
    level: text.level,
    customIds: text.customIds,
    depth: text.depth,
    bruteIds: text.bruteIds,
  };
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

// ============================================================
// 循环解码（）：同一解码反复施加，直到不再变化 / 命中正则 / 达上限
// ============================================================

/** 循环解码支持的编码（三件最常用）。Base64/Hex 解码前先去空白，URL 走 %XX 解码。 */
export const LOOP_CODECS = [
  { id: "base64", label: "Base64" },
  { id: "hex", label: "Hex" },
  { id: "url", label: "URL" },
];

const tdLossy = (bytes) => new TextDecoder("utf-8", { fatal: false }).decode(bytes);

/**
 * 单步解码（纯函数）：成功返回解码后字符串，失败返回 null。
 * - base64：去空白后须为 4 的倍数且字符集合法（= 只允许尾部 0-2 个），atob 严格抛错即失败
 * - hex：去空白后须为偶长纯 hex
 * - url：decodeURIComponent（%XX 解码，孤立 % 或非法 UTF-8 序列抛错即失败）
 */
export function loopDecodeStep(codec, s) {
  const input = String(s ?? "");
  if (codec === "base64") {
    const cleaned = input.replace(/\s+/g, "");
    if (!cleaned || cleaned.length % 4 !== 0) return null;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return null;
    try {
      const bin = atob(cleaned);
      return tdLossy(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
    } catch {
      return null;
    }
  }
  if (codec === "hex") {
    const cleaned = input.replace(/\s+/g, "");
    if (!cleaned || cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleaned)) return null;
    const out = new Uint8Array(cleaned.length >> 1);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    return tdLossy(out);
  }
  if (codec === "url") {
    try {
      return decodeURIComponent(input);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 循环解码主循环（纯函数，不碰 localStorage）。
 * 顺序对齐语义：每轮先查正则（regex 模式）再施加一步解码；解码失败或结果与输入
 * 相同（不动点）即停；跑满 max 轮即停。循环退出后再补一次正则终查（覆盖最后一轮
 * 解码后恰好命中的情况）。
 * @param {string} text 输入密文
 * @param {object} opts { codec:"base64"|"hex"|"url", until:"stuck"|"regex",
 *   pattern:"flag\\{[^}]*\\}", max:1..100(默认16) }
 * @returns {{codec, until, iterations, rounds:[{round, before, after}], final, hit, stopReason, max}}
 *   stopReason: "stuck"=无法继续/不再变化 | "regex"=命中正则 | "max"=达轮数上限
 */
export function loopDecode(text, opts = {}) {
  const codec = LOOP_CODECS.some((c) => c.id === opts.codec) ? opts.codec : "base64";
  const until = opts.until === "regex" ? "regex" : "stuck";
  const pattern = String(opts.pattern != null && opts.pattern !== "" ? opts.pattern : "flag\\{[^}]*\\}");
  const max = Math.min(100, Math.max(1, Math.floor(Number(opts.max) || 16)));
  let re = null;
  if (until === "regex") {
    try { re = new RegExp(pattern); } catch { re = null; }
  }
  let current = String(text ?? "");
  const rounds = [];
  let hit = false;
  let stopReason = "stuck";
  for (let i = 0; i < max; i++) {
    if (until === "regex" && re && re.test(current)) {
      hit = true; stopReason = "regex"; break;
    }
    const next = loopDecodeStep(codec, current);
    if (next == null || next === current) { stopReason = "stuck"; break; }
    rounds.push({ round: rounds.length + 1, before: current, after: next });
    current = next;
    stopReason = "max"; // 若下一轮因 i==max-1 退出即达上限；被 stuck/regex 覆盖则改写
  }
  if (until === "regex" && re && !hit && re.test(current)) {
    hit = true; stopReason = "regex";
  }
  return { codec, until, iterations: rounds.length, rounds, final: current, hit, stopReason, max };
}

/** 单轮中间值的展示截断长度（防多层超长密文刷爆报告）。 */
const LOOP_STEP_SHOW = 300;

/**
 * 循环解码结果 → 多行报告：头部摘要 + 每轮中间值 + 最终结果。
 * @param {object} result loopDecode 的返回值
 * @returns {string} 多行文本
 */
export function formatLoopReport(result) {
  const show = (s) => {
    const t = String(s);
    if (!t) return "(空)";
    return t.length > LOOP_STEP_SHOW ? t.slice(0, LOOP_STEP_SHOW) + `…（截断，共 ${t.length} 字符）` : t;
  };
  const reasonText = {
    stuck: "无法继续解码（解码失败或结果不再变化）",
    regex: "命中正则提前停止",
    max: "达到轮数上限",
  }[result.stopReason] || result.stopReason;
  const lines = [];
  lines.push(`循环解码（${String(result.codec).toUpperCase()} × ${result.iterations} 轮，停止原因：${reasonText}）`);
  lines.push(`输入: ${show(result.rounds.length ? result.rounds[0].before : result.final)}`);
  for (const r of result.rounds) {
    lines.push(`── 第 ${r.round} 轮 ──`);
    lines.push(show(r.after));
  }
  if (!result.rounds.length) lines.push("第 1 轮即无法解码，原样返回。");
  const hitNote = result.until === "regex" ? (result.hit ? " · 命中 ✓" : " · 未命中 ✗") : "";
  lines.push("");
  lines.push(`最终结果（${result.iterations} 轮${hitNote}）:`);
  lines.push(show(result.final));
  return lines.join("\n");
}

// ============================================================
// 字节统计模型提名报告
// ============================================================

/** 18 维统计特征的短名（与 inputProfile.statisticalFeatures 的顺序一一对应）。 */
const BYTESTAT_FEATURE_NAMES = [
  "长度(归一)", "len%4", "大写占比", "小写占比", "数字占比", "空白占比",
  "可打印占比", "非ASCII占比", "Base64标准表", "Base64URL表", "Hex字母表",
  "'='占比", "'%'占比", "'\\'占比", "'&'占比", "'.'占比", "':'占比", "香农熵/8",
];

/**
 * 把字节统计模型的提名结果格式化成多行文本报告（供调试/可解释性展示）。
 * @param {object} probe byteStatPredict 的返回值：{ predicted, top5, probs, features }
 * @returns {string} 多行报告：预测标签 + 11 类概率 + 18 维统计特征
 */
export function formatByteStatReport(probe) {
  if (!probe || !Array.isArray(probe.probs) || !probe.features) return "(无模型提名数据)";
  const lines = [];
  const top = probe.top5 && probe.top5[0] ? probe.top5[0] : { label: "?", probability: 0 };
  lines.push(`字节统计模型提名: ${top.label}（置信 ${(top.probability * 100).toFixed(1)}%）`);
  lines.push("分类概率（11 类，降序 top5 标 *）:");
  const ranked = probe.top5 || [];
  for (let i = 0; i < BYTESTAT_LABELS.length; i++) {
    const mark = ranked.some((r) => r.label === BYTESTAT_LABELS[i]) ? " *" : "  ";
    lines.push(`  ${(probe.probs[i] * 100).toFixed(2).padStart(6)}%${mark} ${BYTESTAT_LABELS[i]}`);
  }
  lines.push("统计特征（18 维）:");
  for (let i = 0; i < probe.features.length; i++) {
    const name = BYTESTAT_FEATURE_NAMES[i] || String(i);
    lines.push(`  [${String(i).padStart(2)}] ${name.padEnd(12)} = ${probe.features[i].toFixed(4)}`);
  }
  return lines.join("\n");
}

// ============================================================
// 加载期自检（import 即跑，失败即抛）
// ============================================================
(function loopSelfTest() {
  const assert = (cond, msg) => { if (!cond) throw new Error("decodeProfile 自检失败: " + msg); };
  const b64e = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
  // 测试明文长度取非 4 的倍数，避免明文恰好可被 base64 再解一次的歧义
  const PLAIN = "flag{loop_decode_x}";
  const nest = (s, n, enc) => { let t = s; for (let i = 0; i < n; i++) t = enc(t); return t; };

  // ① 单步解码权威向量
  assert(loopDecodeStep("base64", "SGVsbG8=") === "Hello", "b64 向量错");
  assert(loopDecodeStep("hex", "48656c6c6f") === "Hello", "hex 向量错");
  assert(loopDecodeStep("url", "%48%65%6c%6c%6f") === "Hello", "url 向量错");
  // ② 单步严格性：bad padding / 奇数 hex / 孤立 % 全拒
  assert(loopDecodeStep("base64", "A=A=") === null && loopDecodeStep("base64", "abc") === null, "b64 宽松了");
  assert(loopDecodeStep("hex", "123") === null && loopDecodeStep("hex", "zz") === null, "hex 宽松了");
  assert(loopDecodeStep("url", "100%") === null, "url 宽松了");
  // ③ Base64 5 层套娃 → 5 轮解开，stuck 停
  {
    const r = loopDecode(nest(PLAIN, 5, b64e), { codec: "base64" });
    assert(r.iterations === 5 && r.final === PLAIN && r.stopReason === "stuck", `b64 套娃 5 轮失败: ${r.iterations}/${r.stopReason}`);
    assert(r.rounds.length === 5 && r.rounds[0].round === 1 && r.rounds[4].after === PLAIN, "轮次中间值错");
  }
  // ④ regex 提前停：第 5 轮解出原文后命中 flag 正则（下一轮迭代开头检查）
  {
    const r = loopDecode(nest(PLAIN, 5, b64e), { codec: "base64", until: "regex" });
    assert(r.iterations === 5 && r.hit === true && r.stopReason === "regex", "regex 提前停失败");
  }
  // ⑤ max 上限：5 层但 max=3 → 3 轮停
  {
    const r = loopDecode(nest(PLAIN, 5, b64e), { codec: "base64", max: 3 });
    assert(r.iterations === 3 && r.stopReason === "max" && r.final !== PLAIN, "max 上限失败");
  }
  // ⑥ Hex 3 层套娃
  {
    const r = loopDecode(nest(PLAIN, 3, (s) => Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, "0")).join("")), { codec: "hex" });
    assert(r.iterations === 3 && r.final === PLAIN, "hex 套娃失败");
  }
  // ⑦ URL 单层 + 不动点停
  {
    const r = loopDecode("%66%6c%61%67%7b%75%7d", { codec: "url" });
    assert(r.iterations === 1 && r.final === "flag{u}" && r.stopReason === "stuck", "url 单层失败");
  }
  // ⑧ 首轮即不可解：iterations=0 原样返回
  {
    const r = loopDecode("hello world", { codec: "base64" });
    assert(r.iterations === 0 && r.final === "hello world" && r.stopReason === "stuck", "首轮不可解失败");
  }
  // ⑨ 非法参数回退：codec → base64；until → stuck；非法正则不炸（re=null 恒不命中）
  {
    const r = loopDecode(PLAIN, { codec: "rot13", until: "whatever", pattern: "([" });
    assert(r.codec === "base64" && r.until === "stuck" && r.hit === false, "参数回退失败");
  }
  // ⑩ 报告含输入/每轮/最终结果
  {
    const r = loopDecode(nest(PLAIN, 2, b64e), { codec: "base64" });
    const report = formatLoopReport(r);
    assert(report.includes("输入:") && report.includes("── 第 1 轮 ──") && report.includes("── 第 2 轮 ──") && report.includes("最终结果"), "报告结构错");
  }
  // ⑪ 超长截断：10 层套娃输入 448 字符 > 300 时标注截断
  {
    const r = loopDecode(nest(PLAIN, 10, b64e), { codec: "base64" });
    const report = formatLoopReport(r);
    assert(report.includes("（截断，共"), "截断标注缺失");
  }
  // ⑫ 模型提名报告：含预测标签 + 11 类概率 + 18 维特征
  {
    const fake = {
      predicted: "base64", top5: [{ label: "base64", probability: 0.9 }, { label: "hex", probability: 0.05 }],
      probs: Array(11).fill(0).map((_, i) => i === 2 ? 0.9 : 0.01),
      features: Array(18).fill(0.25),
    };
    const report = formatByteStatReport(fake);
    assert(report.includes("base64") && report.includes("分类概率") && report.includes("统计特征"), "模型报告结构错");
    assert((report.match(/=/g) || []).length >= 18, "模型报告特征数不足");
    assert(formatByteStatReport(null) === "(无模型提名数据)", "模型报告空值兜底错");
  }
})();
