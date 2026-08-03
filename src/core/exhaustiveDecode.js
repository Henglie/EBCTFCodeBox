/*
 * core/exhaustiveDecode.js — 穷举式一键解码（对齐同类实现）
 *
 * 与 magic/magic.js 的区别：
 * - magic：多层 BFS + 综合分排序，只给 top N 候选（智能优选）。
 * - 本模块：单层「每个解码器都跑一遍、结果全列出」（哪怕乱码），用户自己扫。
 * 这是同类工具一键解码的形态——把所有 decode-op 结果按分类平铺，flag/crib 命中高亮。
 *
 * 设计：
 * - 遍历 OPS 里所有有 decode 或单向 run 的 op，用 defaultParams 跑一遍。
 * - 异步 op（WebCrypto 等返回 Promise）用 Promise.allSettled 并发，失败不阻塞。
 * - 每条结果带 {ok, printable, matchesCrib, empty, changed} 供 UI 决定显示/高亮/折叠。
 * - 按 cat 分组返回，对齐界面「分类平铺」布局。
 *
 * 参数网格扫描（PARAM_SWEEP）：对带参 op 做全参数遍历，对齐同类实现的穷举扫描模式。
 * - P0 立即全扫（~96 组合）：caesar/multiplicative/trithemius/keyboardShift/bacon/baudot/decabit/scytale
 * - P1 限制扫（~512 组合）：affine/rotSpecial/railFence/routeCipher
 * - P2 跳过（text 密钥不可枚举）：vigenere 等 25+ 个
 * 总组合数超 paramScanLimit（默认 1000）只扫 P0，防爆。
 */
import { OPS, defaultParams, CATEGORIES } from "./registry.js";

// 可打印占比阈值：>= 此值视为「像明文」，UI 默认展开高亮，否则折叠为乱码。
const PRINTABLE_THRESHOLD = 0.85;

// flag 高亮关键词（对齐同类工具的关键词高亮集）。
// 含 flag 密文常见前缀 base64(Zmxh=flag/Y3Rm=ctf/a2V5=key/cGFzc=pass)、OpenSSL(U2FsdGVkX1)
// base64 尾 ==。命中即 flagHit（UI 黄底红字）。大小写不敏感。
export const FLAG_KEYWORDS = ["flag", "ctf", "key", "pass", "U2FsdGVkX1", "Zmxh", "Y3Rm", "a2V5", "cGFzc", "==", "{", "}"];
const FLAG_RE = new RegExp(FLAG_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "i");
// flag{...} 完整格式（金底整段定位）
const FLAG_FORMAT_RE = /[a-z0-9_]{2,}\{[^{}]{1,}\}/i;

// ============ 参数网格扫描表（对齐同类实现的穷举扫描模式） ============
// PARAM_SWEEP[opId] = (text) => params[]：返回该 op 的全参数网格。
// exhaustiveDecode（穷举一键）与 magic.js（一把梭）共用此表——magic.js 用白名单绕过
// detect 要求直接扫描，exhaustiveDecode 在单层平铺里展开全部参数候选。
// - P0（~96 组合）：caesar/multiplicative/trithemius/keyboardShift/bacon/baudot/decabit/scytale
// - P1（~512 组合）：affine/rotSpecial/railFence/routeCipher
// - P2（text 密钥，不可枚举）：vigenere 等 25+ 个跳过
// 依赖 text 长度的 op（railFence/routeCipher/scytale）按输入长度动态截断上限。
export const PARAM_SWEEP = {
 // ---- P0：立即全扫（组合数 < 100） ----
  caesar: () => Array.from({ length: 25 }, (_, i) => ({ shift: i + 1 })),
  trithemius: () => Array.from({ length: 26 }, (_, i) => ({ start: i })),
  keyboardShift: () => {
    const arr = [];
    for (let s = 1; s <= 9; s++)
      for (const d of ["right", "left"])
        arr.push({ shift: s, direction: d });
    return arr;
  },
  bacon: () => [{ version: "26" }, { version: "24" }],
  baudot: () => [{ variant: "ita2" }, { variant: "ita1" }],
  decabit: () => [{ asNumber: false }, { asNumber: true }],
  // 字符↔进制 ASCII：扫 2/8/10/16 进制。二进制(01100110…)/八进制/十进制 ASCII 串是
  // 超高频 CTF 编码，但 asciiRadix 默认参数 base=16，二进制串默认参数解不出（报越界）。
  // 加进 sweep 网格让 magic 扫全 4 个 base，无需用户手动选进制。
  // 二进制额外扫变体：8/7 位 × {正常, 0-1取反, 逐字节位反转}。
  // 8/10/16 进制只扫标准。二进制花招（7-bit 紧凑 / 取反 / LSB-first）CTF 高频，
  // 让一键解码自动覆盖，无需用户手选。
  asciiRadix: () => [
    { base: 8 }, { base: 10 }, { base: 16 },
    { base: 2, bits: 8 }, { base: 2, bits: 7 },
    { base: 2, bits: 8, invert: true }, { base: 2, bits: 7, invert: true },
    { base: 2, bits: 8, bitReverse: true }, { base: 2, bits: 7, bitReverse: true },
  ],
  scytale: (text) => {
    const maxCol = Math.min(10, Math.max(2, (text || "").length - 1));
    const arr = [];
    for (let c = 2; c <= maxCol; c++) arr.push({ column: c });
    return arr;
  },
 // ---- P1：限制扫（组合数 100-1000） ----
  affine: () => {
    const A = [1, 3, 5, 7, 9, 11, 15, 17, 19, 21, 23, 25];
    const arr = [];
    for (const a of A) for (let b = 0; b < 26; b++) arr.push({ a, b });
    return arr;
  },
  rotSpecial: () => {
    const arr = [];
    for (const alphabet of ["letters", "alnum", "ascii94"]) {
      const max = alphabet === "ascii94" ? 93 : 25;
      for (let s = 1; s <= max; s++) arr.push({ shift: s, alphabet });
    }
    return arr;
  },
  railFence: (text) => {
    const maxR = Math.min(20, Math.max(2, (text || "").length - 1));
    const arr = [];
    for (let r = 2; r <= maxR; r++) arr.push({ rails: r });
    return arr;
  },
  routeCipher: (text) => {
    const maxC = Math.min(20, Math.max(2, (text || "").length - 1));
    const arr = [];
    for (let c = 2; c <= maxC; c++)
      for (const route of ["snake", "vertical"])
        arr.push({ cols: c, route });
    return arr;
  },
};

// 白名单 = P0 + P1 的 op id 列表（magic.js 用此绕过 detect 直接扫描）。
export const PARAM_SCAN_OP_IDS = Object.keys(PARAM_SWEEP);

// P0 op id 列表（总组合数超 paramScanLimit 时降级只扫 P0，防爆）。
export const PARAM_SCAN_P0_IDS = [
  "caesar", "trithemius", "keyboardShift",
  "bacon", "baudot", "decabit", "scytale", "asciiRadix",
];

// 默认总组合数上限（超限只扫 P0）。
export const PARAM_SCAN_DEFAULT_LIMIT = 1000;

/**
 * 格式化参数标签：caesar(shift=3) / affine(a=5,b=8) / railFence(rails=3)。
 * 用于 chain id 与 UI 显示，对齐同类实现「[解码N次] 明文」三元组格式。
 */
export function formatParamTag(opId, params) {
  if (!params) return opId;
  const parts = [];
  for (const [k, v] of Object.entries(params)) parts.push(`${k}=${v}`);
  return `${opId}(${parts.join(",")})`;
}

/**
 * 只格式化参数部分（不含 opId 前缀），用于穷举分组内单条分支的参数标签。
 * caesar {shift:3} → "shift=3"；affine {a:5,b:8} → "a=5, b=8"。无参返回空串。
 */
export function formatParamsOnly(params) {
  if (!params) return "";
  return Object.entries(params).map(([k, v]) => `${k}=${v}`).join(", ");
}

// 命中判定（分组高亮统一口径）：
// 强命中 = 完整 flag{...} 格式 或 用户 crib 命中 → 算法组标「疑似命中」、默认展开。
// 任意命中 = 强命中 或 关键词命中(flagHit) → 用于组内排序置顶。
function isStrongHit(it) { return !!(it && (it.isFlagFormat || it.matchesCrib)); }
function isAnyHit(it) { return !!(it && (it.isFlagFormat || it.flagHit || it.matchesCrib)); }
function hitThenPrintable(a, b) {
  const ah = isAnyHit(a), bh = isAnyHit(b);
  if (ah !== bh) return ah ? -1 : 1;
  return b.printable - a.printable;
}

// 穷举一键的输入上限（同类工具约 2000；本实现异步并发性能更好，放宽到 5000）。
const MAX_INPUT = 5000;

// 按 Unicode 码点算可打印占比（ASCII 可打印 + 常见空白 + 非 ASCII 文字如中文/emoji）。
function printableRatio(str) {
  if (!str) return 0;
  let n = 0, ok = 0;
  for (const ch of str) {
    n++;
    const c = ch.codePointAt(0);
    if ((c >= 0x20 && c <= 0x7e) || c === 0x09 || c === 0x0a || c === 0x0d || c >= 0xa0) ok++;
  }
  return n === 0 ? 0 : ok / n;
}

// ============ 输入特征预筛选（按输入特征智能选候选，不再全跑） ============
// 单遍纯字符集判定，轻量。用于：①无 detect 的 op 按 cat 粗筛；②sweep 字母密码类在数值串上跳过。
// 导出供 magic.js 复用（同一套定义域预筛，两条路径口径一致，不重复实现）。
export function inputFeatures(text) {
  const compact = text.replace(/\s+/g, "");
  return {
    compact,
    compactLen: compact.length,
    // 非空白字符种类数（lenient 宽松档用：只判种类不判具体字符，喵呜/emoji 等变体二进制也能准入）
    nCharKinds: new Set(compact).size,
    isHex: compact.length > 0 && /^[0-9a-fA-F]+$/.test(compact),
    isDigits: compact.length > 0 && /^[0-9]+$/.test(compact),
    isBinary: compact.length > 0 && /^[01]+$/.test(compact),
 // base 字母表并集（标准/urlsafe base64、base32、base58 等字符全落在此集）
    isBase64ish: compact.length > 0 && /^[A-Za-z0-9+/=_-]+$/.test(compact),
    hasLetters: /[a-zA-Z]/.test(text),
    hasNonAscii: /[^\x00-\x7f]/.test(text),
  };
}

// ============ 字符集指纹（字符集⊄算法字符集即排除） ============
// 思路：给 op 声明「合法输入必落入的字符集类」，输入含类外字符 → 该 op 产不出这种串
// → 不纳入候选。这是 coarseAdmitPlain 的强化版（精确到单个 op 而非整类 cat）。
//
// **零误排铁律**：指纹类必须是该 op「encode 输出全域」的证明性超集——即 decode 的一切
// 合法输入都恒 ⊆ 类。据此排除「输入 ⊄ 类」的候选绝不会丢真解（编码器根本产不出）。
// 下表由 工具/_fp_verify.mjs 自证：对多样语料(字母/数字/符号/中文/emoji)跑 encode
// 全部成功输出均 ⊆ 所标类，且各 op 自身 encode 产物能通过自己的指纹门（self-round-trip）。
// 仅收无 detect（有 detect 走 detect，更强）且 decode 输入 ≡ encode 输出（纯编解码器）的 op；
// snow(掩护文本+空白，输入域宽于输出)、dtmfWav(WAV 二进制) 因输入域大于 encode 输出剔除。
const FP_CLASS = {
 // 类名 → 判定「compact 是否全部落入本类」。宽松取超集，宁漏筛不错筛。
  BINARY: /^[01]+$/,
  DIGIT: /^[0-9]+$/,
  HEX: /^[0-9a-fA-Fx]+$/,             // 含 hybridCode 的 "x48" 前缀 x（HEX 超集）
  BASE64ISH: /^[A-Za-z0-9+/=_:.\-]+$/, // 字母/数字/base 符号 + 分隔符（factorial ":"、cf "."）
};
const OP_FINGERPRINT = {
 // BINARY（01 串）
  hammingCode: "BINARY", negabase: "BINARY", radixConvert: "BINARY", zeckendorf: "BINARY",
 // DIGIT（纯数字）
  bcd: "DIGIT", straddleCheckerboard: "DIGIT",
 // HEX（十六进制，可含 hybridCode 的 x 前缀）
  asciiRadix: "HEX", byteArith: "HEX", ieee754: "HEX", varint: "HEX",
 // BASE64ISH（字母/数字/base 符号/分隔符）
  balancedTernary: "BASE64ISH", bech32: "BASE64ISH", foursquarekw: "BASE64ISH",
  fracmorse: "BASE64ISH", hybridCode: "BASE64ISH", solitaire: "BASE64ISH",
  sternBrocot: "BASE64ISH", twosquare: "BASE64ISH",
};
// 字符集指纹准入：op 无指纹 → 放行；有指纹 → compact 全落入类才纳入（类外字符即排除）。
// lenient（增强+/自定义档）：只判字符种类数 ≤ 类字符集大小，不判具体字符——
// CTF 变体题（喵呜=01、emoji=01…）用非标准字符表也能准入参与解码（恒烈 2026-08-03）。
function fingerprintAdmit(op, f, lenient) {
  const cls = OP_FINGERPRINT[op.id];
  if (!cls) return true;                        // 未登记指纹的 op 不受此门限制
  if (f.compactLen === 0) return true;          // 空输入交后续逻辑，不在此排除
  if (lenient) {
    const LIMIT = { BINARY: 2, DIGIT: 10, HEX: 17, BASE64ISH: 70 };
    return f.nCharKinds <= (LIMIT[cls] ?? 70);
  }
  return FP_CLASS[cls].test(f.compact);
}

// 无 detect 的 op 按 cat 粗筛（保守：只在明显不适用时排除，默认纳入）。
// lenient=true（增强/极强/最强/自定义档）：只按字符种类数放行，全部相关算法参与。
export function coarseAdmitPlain(op, f, lenient) {
 // 字符集指纹优先（精确到单 op）：输入含算法字符集外字符即排除（lenient 放宽为种类数）。
  if (!fingerprintAdmit(op, f, lenient)) return false;
 // Base 系：只在输入是 base 字母表子集时纳入（含可能的 = 尾）。
  if (op.cat === "base") {
    if (lenient) return f.compactLen > 0 && f.nCharKinds <= 70;  // 变体 base 表（emoji 等）也能参与
    return f.isBase64ish;
  }
 // 进制/字符集 系：需 hex/纯数字/二进制/base 字母表（纯文本、非 ASCII 不是进制串）。
  if (op.cat === "radix") {
    if (lenient) return f.compactLen > 0 && f.nCharKinds >= 2 && f.nCharKinds <= 17;  // 2~16 进制变体字符
    return f.isHex || f.isDigits || f.isBinary || f.isBase64ish;
  }
 // 其余分类（text/fancy/cn/classic/modern/hash/analysis/stego…）默认纳入。
  return true;
}

// 文本类字母密码 sweep：输入无字母，或为纯数字/hex/二进制串时跳过
// （对齐同类实现不在数值串上跑 caesar/affine 等字母密码）。
const LETTER_SWEEP_OPS = new Set([
  "caesar", "trithemius", "keyboardShift", "affine", "rotSpecial",
]);
export function sweepApplies(opId, f) {
  if (LETTER_SWEEP_OPS.has(opId)) {
    return f.hasLetters && !f.isHex && !f.isDigits && !f.isBinary;
  }
 // 换位类（railFence/routeCipher/scytale）组合数已按输入长度截断；
 // bacon/baudot/decabit 为字母/数字/二进制导向。均保留。
  return true;
}

/**
 * 穷举解码：对输入跑所有 decode/run op，结果全列出（不排序删除）。
 *
 * @param {string} input 待解码文本
 * @param {object} [opts]
 * - crib 目标特征正则源串或 RegExp（命中标记 matchesCrib，UI 高亮置顶），可空
 * - onlyChanged true 时过滤掉「输出==输入」的无变化项（默认 false，全列）
 * - onlyPrintable true 时只保留可打印结果（默认 false）
 * @returns {Promise<{groups: Array<{cat, catName, items, algos}>, total, hits}>}
 * groups 按分类分组。每组：
 * - items：该分类全部候选的扁平数组（命中优先排序，兼容旧消费端/测试）。
 * - algos：按算法(baseOpId)聚合的子组数组，每个 = {baseOpId, count, hitCount
 * flagKwCount, hasStrongHit, expanded, items}——UI 把每个 algo 画成一张可折叠卡片
 * 同算法的几十条穷举分支归一处，命中组(hasStrongHit)默认展开。
 * 每 item = {opId, baseOpId, paramTag, opName, cat, ok, result, error, printable
 * matchesCrib, empty, changed, flagHit, isFlagFormat, hasBrace}。
 * total 总条数，hits flag 关键词/crib 命中数。
 */
export async function exhaustiveDecode(input, opts = {}) {
  const text = typeof input === "string" ? input : "";
  if (!text) return { groups: [], total: 0, hits: 0, tooLong: false };
  if (text.length > MAX_INPUT) return { groups: [], total: 0, hits: 0, tooLong: true, maxInput: MAX_INPUT };

  let cribRe = null;
  if (opts.crib) {
    try { cribRe = opts.crib instanceof RegExp ? opts.crib : new RegExp(opts.crib, "i"); }
    catch { cribRe = null; }
  }

 // 候选 op：有 decode（双向/纯解码）或单向 run（无方向的工具，如进制转换）。
 // 纯 encode-only 的不跑（解码场景无意义）。
 // requiresBridge 的 exe 类 op（手动 GUI/CLI 工具，见 exeTools.js）排除：它们只有 run
 // 混进穷举会触发 bridge 调用，破坏一键解码的自动化。
 // noAuto 的 op 排除：单次运行代价过高（如 Argon2id 64MiB 派生约 8-10 秒）或必须由用户
 // 显式提供口令/参数，自动穷举既无意义又会阻塞进度。仅在用户主动选择该 op 时运行。
  const targets = OPS.filter((op) => (typeof op.decode === "function" || typeof op.run === "function") && !op.requiresBridge && !op.noAuto);

 // 预筛选（按输入特征选候选，不再全集穷举）：
 // - 有 detect 的 op：复用 detect(text) 作准入门槛，<=0 排除（对齐 magic.js）。
 // - 无 detect 的 op：按输入字符特征 coarseAdmitPlain 粗筛。
 // - sweep 参数网格 op：无 detect（magic 靠白名单绕过），按 sweepApplies 特征跳过明显不适用的。
  const f = inputFeatures(text);
  const admitted = targets.filter((op) => {
    if (typeof op.detect === "function") {
      try { return op.detect(text) > 0; }
      catch { return false; }
    }
 // PARAM_SWEEP op 交由 sweepApplies 判定（跳过纯数字/hex 不适用的文本类密码）。
    if (PARAM_SWEEP[op.id]) return sweepApplies(op.id, f);
    return coarseAdmitPlain(op, f);
  });

 // 参数网格扫描：白名单 op 跑全参数网格，其余 op 用默认参数跑一次。
  const plainTargets = admitted.filter((op) => !PARAM_SWEEP[op.id]);
  const sweepTargets = admitted.filter((op) => PARAM_SWEEP[op.id] && typeof op.decode === "function");

 // 估算总组合数，超限只扫 P0（防爆）。
  const paramScanLimit = opts.paramScanLimit ?? PARAM_SCAN_DEFAULT_LIMIT;
  const sweepGrids = [];
  let totalCombos = 0;
  for (const op of sweepTargets) {
    const grid = PARAM_SWEEP[op.id](text);
    sweepGrids.push({ op, grid });
    totalCombos += grid.length;
  }
  const activeSweep = totalCombos > paramScanLimit
    ? sweepGrids.filter((g) => PARAM_SCAN_P0_IDS.includes(g.op.id))
    : sweepGrids;

 // 并发跑，失败降级为 error 项（不 throw、不阻塞其他）。
 // 参数扫描 op 每组参数产生一条独立候选（opId 形如 caesar(shift=3)）。
 // 分批执行——每个 task 是一个惰性 thunk，按 CHUNK 大小成批跑
 // 批间 await yieldToMain 让出主线程（避免同步 CPU 型 op 连续占满 microtask 冻结 UI）
 // 并回调 onProgress(done,total) 驱动进度条。总量小时几乎无额外开销。
  const thunks = [
    ...plainTargets.map((op) => async () => {
      const fn = op.decode || op.run;
      try {
        const out = await fn(text, defaultParams(op));
        return { op, params: null, out: out == null ? "" : String(out), error: null };
      } catch (e) {
        return { op, params: null, out: "", error: (e && e.message) || String(e) };
      }
    }),
    ...activeSweep.flatMap(({ op, grid }) =>
      grid.map((params) => async () => {
        try {
          const out = await op.decode(text, params);
          return { op, params, out: out == null ? "" : String(out), error: null };
        } catch (e) {
          return { op, params, out: "", error: (e && e.message) || String(e) };
        }
      })
    ),
  ];

  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  const total = thunks.length;
  const CHUNK = 32;                       // 每批并发数，批间让出主线程
  const yieldToMain = () => new Promise((r) => setTimeout(r, 0));
  const settled = [];
  let done = 0;
  if (onProgress) onProgress(0, total);   // 初值，UI 立即显示 0%
  for (let i = 0; i < thunks.length; i += CHUNK) {
    const batch = thunks.slice(i, i + CHUNK).map((fn) => fn());
    const part = await Promise.allSettled(batch);
    for (const p of part) settled.push(p);
    done += part.length;
    if (onProgress) onProgress(Math.min(done, total), total);
    if (i + CHUNK < thunks.length) await yieldToMain();  // 让出主线程，UI 可刷新进度/响应
  }

  const items = [];
  let hits = 0;
  for (const s of settled) {
    if (s.status === "rejected") continue; // tasks 内部已 try/catch，防御
    const { op, params, out, error } = s.value;
    const opId = params ? formatParamTag(op.id, params) : op.id;
    const paramTag = formatParamsOnly(params); // 分组内单条分支的参数标签（如 shift=3）
    if (error) {
      items.push({
        opId, baseOpId: op.id, paramTag, opName: opId, cat: op.cat,
        ok: false, result: "", error,
        printable: 0, matchesCrib: false, empty: true, changed: false,
      });
      continue;
    }
    const result = out;
    const empty = result.length === 0;
    const changed = result !== text;
    const printable = printableRatio(result);
 // flag 高亮判定（三档）：flagHit=关键词命中(黄底红字)
 // isFlagFormat=完整 flag{...}(金底)，hasBrace=含花括号(浅蓝)。外加用户自定义 crib。
    const flagHit = FLAG_RE.test(result);
    const isFlagFormat = FLAG_FORMAT_RE.test(result);
    const hasBrace = result.includes("{") || result.includes("}");
    const matchesCrib = cribRe ? cribRe.test(result) : false;
    if (flagHit || matchesCrib) hits++;
    items.push({
      opId, baseOpId: op.id, paramTag, opName: opId, cat: op.cat,
      ok: true, result, error: null,
      printable, empty, changed,
      flagHit, isFlagFormat, hasBrace, matchesCrib,
    });
  }

 // 过滤（默认全列）
  let filtered = items;
  if (opts.onlyChanged) filtered = filtered.filter((it) => it.changed && !it.empty);
  if (opts.onlyPrintable) filtered = filtered.filter((it) => it.printable >= PRINTABLE_THRESHOLD);

 // 两级分组：外层按分类(cat)，内层按算法(baseOpId)。
 // - 同一算法的多条穷举分支（如 caesar 25 个位移）归到一个 algo 子组，UI 折叠成单卡片。
 // - algo.items 组内按命中优先、可打印优先排序；hitCount = 强命中(flag{...}/crib)条数。
 // - hasStrongHit 的算法组默认展开(expanded)，其余折叠——让命中一眼可见、乱码不刷屏。
 // - 保留扁平 items（命中优先排序）以兼容旧消费端与测试。
  const byCat = new Map();
  for (const it of filtered) {
    if (!byCat.has(it.cat)) byCat.set(it.cat, []);
    byCat.get(it.cat).push(it);
  }
  const groups = [];
  for (const c of CATEGORIES) {
    const arr = byCat.get(c.id);
    if (!arr || !arr.length) continue;

 // 内层：按 baseOpId 聚合成算法子组
    const byOp = new Map();
    for (const it of arr) {
      if (!byOp.has(it.baseOpId)) byOp.set(it.baseOpId, []);
      byOp.get(it.baseOpId).push(it);
    }
    const algos = [];
    for (const [baseOpId, opItems] of byOp) {
      opItems.sort(hitThenPrintable);
      const hitCount = opItems.filter(isStrongHit).length;   // 强命中：flag{...}/crib
      const flagKwCount = opItems.filter((it) => it.flagHit).length; // 关键词命中（含强命中）
      const hasStrongHit = hitCount > 0;
      algos.push({
        baseOpId,
        count: opItems.length,
        hitCount,
        flagKwCount,
        hasStrongHit,
        expanded: hasStrongHit,           // 命中组默认展开，其余折叠
        items: opItems,
      });
    }
 // 算法子组排序：有强命中的算法置顶，其次命中数多的，其次可打印最高分支
    algos.sort((a, b) => {
      if (a.hasStrongHit !== b.hasStrongHit) return a.hasStrongHit ? -1 : 1;
      if (a.hitCount !== b.hitCount) return b.hitCount - a.hitCount;
      return (b.items[0]?.printable || 0) - (a.items[0]?.printable || 0);
    });

 // 扁平 items（兼容旧消费端 / 测试）：命中优先、可打印优先
    const flat = arr.slice().sort(hitThenPrintable);
    groups.push({ cat: c.id, catName: c.name, items: flat, algos });
  }

  return { groups, total: filtered.length, hits, PRINTABLE_THRESHOLD };
}

export default { exhaustiveDecode };
