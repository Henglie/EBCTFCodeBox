// offlinePacks.js — PWA 离线包的数据与纯函数（无 DOM、无网络、无存储）。
//
// 用途：把「首屏预缓存之外、按需才用」的资产按能力分组，供上层决定装/卸/降级提示。
// 本模块不直接调用 Service Worker、不读写本地持久化、不探测网络；状态由上层持久化后
// 以普通对象传入，所有函数均不修改入参。
//
// 分类口径与 tools/gen_sw_assets.mjs 的 EXCLUDE_RULES、sw.js 的 RUNTIME_CACHE_FIRST 同源：
//   wasm     public/wasm/** 下 .wasm|.js（许可/说明 .txt 仍留首屏预缓存，不进包）
//   fonts    public/fonts/th/th-p<数字>.woff2 四平面（th-ctf-subset.woff2 是首屏基线，不进包）
//   locales  src/i18n/locales/**（zh/en 在 src/i18n/*.js，属基线，不进包）
//   edu-en   src/core/eduContent.en.js + src/core/edu-en/**
//
// bytes 与 entries 由工程留存目录下的 collect_packs.mjs 逐文件 statSync 统计；
// 同目录 verify 脚本会重新扫盘断言逐字节一致（±0），防止手写数字漂移。
//
// 状态形状（上层持久化的就是它）：
//   {
//     installed: { [packId]: { entries: string[], bytes: number } },
//     errors:    { [packId]: { packId, reason } },
//   }
// 其余字段（语言、主题等）原样透传，本模块不解释。

export const PACKS = [
  {
    id: "wasm",
    name: "WASM 引擎包",
    kind: "wasm",
    bytes: 9490473,
    optional: true,
    entries: [
      { name: "/public/wasm/7zz.js", bytes: 82904 },
      { name: "/public/wasm/7zz.wasm", bytes: 1651931 },
      { name: "/public/wasm/bkcrack.js", bytes: 89305 },
      { name: "/public/wasm/bkcrack.wasm", bytes: 378700 },
      { name: "/public/wasm/outguess/outguess-client.js", bytes: 4805 },
      { name: "/public/wasm/outguess/outguess.js", bytes: 62458 },
      { name: "/public/wasm/outguess/outguess.wasm", bytes: 181940 },
      { name: "/public/wasm/outguess/outguess.worker.js", bytes: 3641 },
      { name: "/public/wasm/steghide/steghide.js", bytes: 149186 },
      { name: "/public/wasm/steghide/steghide.wasm", bytes: 1017408 },
      { name: "/public/wasm/steghide/steghide.worker.js", bytes: 2450 },
      { name: "/public/wasm/vendor/asm/asm-glue.js", bytes: 44716 },
      { name: "/public/wasm/vendor/asm/asm.wasm", bytes: 2997968 },
      { name: "/public/wasm/vendor/disasm/disasm-glue.js", bytes: 39582 },
      { name: "/public/wasm/vendor/disasm/disasm.wasm", bytes: 1778509 },
      { name: "/public/wasm/zxing/reader/index.js", bytes: 40496 },
      { name: "/public/wasm/zxing/reader/zxing_reader.wasm", bytes: 953527 },
      { name: "/public/wasm/zxing/share.js", bytes: 10947 },
    ],
  },
  {
    id: "fonts",
    name: "天珩全字库包",
    kind: "fonts",
    bytes: 32681388,
    optional: true,
    entries: [
      { name: "/public/fonts/th/th-p0.woff2", bytes: 5821788 },
      { name: "/public/fonts/th/th-p1.woff2", bytes: 7873912 },
      { name: "/public/fonts/th/th-p16.woff2", bytes: 9419376 },
      { name: "/public/fonts/th/th-p2.woff2", bytes: 9566312 },
    ],
  },
  {
    id: "locales",
    name: "界面语言包",
    kind: "locales",
    bytes: 2997126,
    optional: true,
    entries: [
      { name: "/src/i18n/locales/ar.js", bytes: 102145 },
      { name: "/src/i18n/locales/bo.js", bytes: 121492 },
      { name: "/src/i18n/locales/de.js", bytes: 307169 },
      { name: "/src/i18n/locales/es.js", bytes: 92262 },
      { name: "/src/i18n/locales/fa.js", bytes: 106808 },
      { name: "/src/i18n/locales/fr.js", bytes: 317609 },
      { name: "/src/i18n/locales/he.js", bytes: 97286 },
      { name: "/src/i18n/locales/hi.js", bytes: 130335 },
      { name: "/src/i18n/locales/id.js", bytes: 85425 },
      { name: "/src/i18n/locales/ja.js", bytes: 312025 },
      { name: "/src/i18n/locales/ko.js", bytes: 303878 },
      { name: "/src/i18n/locales/mn-Mong.js", bytes: 125794 },
      { name: "/src/i18n/locales/pt.js", bytes: 91534 },
      { name: "/src/i18n/locales/ru.js", bytes: 434394 },
      { name: "/src/i18n/locales/tr.js", bytes: 88752 },
      { name: "/src/i18n/locales/ug.js", bytes: 101800 },
      { name: "/src/i18n/locales/ur.js", bytes: 105671 },
      { name: "/src/i18n/locales/za-Latn.js", bytes: 72747 },
    ],
  },
  {
    id: "edu-en",
    name: "英文科普层",
    kind: "edu-en",
    bytes: 1271561,
    optional: true,
    entries: [
      { name: "/src/core/edu-en/edu-ana-crypto-new.en.js", bytes: 34324 },
      { name: "/src/core/edu-en/edu-ana-freq.en.js", bytes: 16830 },
      { name: "/src/core/edu-en/edu-ana-geffe.en.js", bytes: 634 },
      { name: "/src/core/edu-en/edu-ana-more.en.js", bytes: 8143 },
      { name: "/src/core/edu-en/edu-ana-new.en.js", bytes: 13970 },
      { name: "/src/core/edu-en/edu-ana-rest.en.js", bytes: 9264 },
      { name: "/src/core/edu-en/edu-ana-rsa1.en.js", bytes: 7449 },
      { name: "/src/core/edu-en/edu-ana-rsa2.en.js", bytes: 12653 },
      { name: "/src/core/edu-en/edu-ana-serial.en.js", bytes: 13936 },
      { name: "/src/core/edu-en/edu-ana-tools.en.js", bytes: 7392 },
      { name: "/src/core/edu-en/edu-ana-tools2.en.js", bytes: 13506 },
      { name: "/src/core/edu-en/edu-analysis-crc32rev.en.js", bytes: 3566 },
      { name: "/src/core/edu-en/edu-base1.en.js", bytes: 11850 },
      { name: "/src/core/edu-en/edu-base2.en.js", bytes: 6544 },
      { name: "/src/core/edu-en/edu-batch-new.en.js", bytes: 12197 },
      { name: "/src/core/edu-en/edu-batch5-modern.en.js", bytes: 12952 },
      { name: "/src/core/edu-en/edu-batch5-new.en.js", bytes: 33032 },
      { name: "/src/core/edu-en/edu-batch5-stego.en.js", bytes: 4103 },
      { name: "/src/core/edu-en/edu-batch6.en.js", bytes: 13931 },
      { name: "/src/core/edu-en/edu-batch7-new.en.js", bytes: 44231 },
      { name: "/src/core/edu-en/edu-blindwm2.en.js", bytes: 13456 },
      { name: "/src/core/edu-en/edu-bridge-new.en.js", bytes: 6049 },
      { name: "/src/core/edu-en/edu-classic-disks-transposition.en.js", bytes: 17567 },
      { name: "/src/core/edu-en/edu-classic-new.en.js", bytes: 11729 },
      { name: "/src/core/edu-en/edu-classic-rest.en.js", bytes: 17909 },
      { name: "/src/core/edu-en/edu-classic1.en.js", bytes: 11158 },
      { name: "/src/core/edu-en/edu-classic2.en.js", bytes: 10455 },
      { name: "/src/core/edu-en/edu-cn-img-stego.en.js", bytes: 5735 },
      { name: "/src/core/edu-en/edu-cn-lookup.en.js", bytes: 13964 },
      { name: "/src/core/edu-en/edu-crypto-b.en.js", bytes: 26628 },
      { name: "/src/core/edu-en/edu-crypto-pg.en.js", bytes: 67609 },
      { name: "/src/core/edu-en/edu-ctf-cipher-ext.en.js", bytes: 1350 },
      { name: "/src/core/edu-en/edu-exe.en.js", bytes: 2951 },
      { name: "/src/core/edu-en/edu-fancy-cn.en.js", bytes: 12093 },
      { name: "/src/core/edu-en/edu-fancy-modern-new.en.js", bytes: 31195 },
      { name: "/src/core/edu-en/edu-fancy-new.en.js", bytes: 2918 },
      { name: "/src/core/edu-en/edu-fancy-rest.en.js", bytes: 52923 },
      { name: "/src/core/edu-en/edu-fancy-roar.en.js", bytes: 3562 },
      { name: "/src/core/edu-en/edu-forensic-new.en.js", bytes: 36715 },
      { name: "/src/core/edu-en/edu-gifshuffle.en.js", bytes: 153 },
      { name: "/src/core/edu-en/edu-hash-cityhash.en.js", bytes: 4502 },
      { name: "/src/core/edu-en/edu-hash-xxhash.en.js", bytes: 3397 },
      { name: "/src/core/edu-en/edu-hash1.en.js", bytes: 10831 },
      { name: "/src/core/edu-en/edu-hash2.en.js", bytes: 12025 },
      { name: "/src/core/edu-en/edu-hash3.en.js", bytes: 10710 },
      { name: "/src/core/edu-en/edu-imageToolbox.en.js", bytes: 14415 },
      { name: "/src/core/edu-en/edu-misc2-new.en.js", bytes: 52187 },
      { name: "/src/core/edu-en/edu-modern-new.en.js", bytes: 14027 },
      { name: "/src/core/edu-en/edu-modern-rest.en.js", bytes: 14848 },
      { name: "/src/core/edu-en/edu-modern1.en.js", bytes: 9716 },
      { name: "/src/core/edu-en/edu-modern2.en.js", bytes: 9915 },
      { name: "/src/core/edu-en/edu-outguess.en.js", bytes: 147 },
      { name: "/src/core/edu-en/edu-p0-20261025.en.js", bytes: 21041 },
      { name: "/src/core/edu-en/edu-pcap-fields.en.js", bytes: 161 },
      { name: "/src/core/edu-en/edu-pemkeys.en.js", bytes: 2887 },
      { name: "/src/core/edu-en/edu-pipAstro.en.js", bytes: 6915 },
      { name: "/src/core/edu-en/edu-qrscanimage.en.js", bytes: 9875 },
      { name: "/src/core/edu-en/edu-radix-bitops.en.js", bytes: 5450 },
      { name: "/src/core/edu-en/edu-radix-check.en.js", bytes: 8399 },
      { name: "/src/core/edu-en/edu-radix-color.en.js", bytes: 2823 },
      { name: "/src/core/edu-en/edu-radix-convert.en.js", bytes: 4475 },
      { name: "/src/core/edu-en/edu-radix-geo.en.js", bytes: 5814 },
      { name: "/src/core/edu-en/edu-radix-hamming.en.js", bytes: 2415 },
      { name: "/src/core/edu-en/edu-radix-math.en.js", bytes: 1878 },
      { name: "/src/core/edu-en/edu-radix-net.en.js", bytes: 5944 },
      { name: "/src/core/edu-en/edu-radix-num.en.js", bytes: 19228 },
      { name: "/src/core/edu-en/edu-radix-numsys.en.js", bytes: 11019 },
      { name: "/src/core/edu-en/edu-radix-time.en.js", bytes: 18480 },
      { name: "/src/core/edu-en/edu-randBeacon.en.js", bytes: 4581 },
      { name: "/src/core/edu-en/edu-randomSecure.en.js", bytes: 4075 },
      { name: "/src/core/edu-en/edu-regex.en.js", bytes: 7021 },
      { name: "/src/core/edu-en/edu-steghide.en.js", bytes: 69 },
      { name: "/src/core/edu-en/edu-stego-detect.en.js", bytes: 5873 },
      { name: "/src/core/edu-en/edu-stego-image.en.js", bytes: 21105 },
      { name: "/src/core/edu-en/edu-stego-qr-audio.en.js", bytes: 13032 },
      { name: "/src/core/edu-en/edu-stego-text.en.js", bytes: 7840 },
      { name: "/src/core/edu-en/edu-t359.en.js", bytes: 3667 },
      { name: "/src/core/edu-en/edu-t508-b2.en.js", bytes: 15742 },
      { name: "/src/core/edu-en/edu-t508-b3.en.js", bytes: 19989 },
      { name: "/src/core/edu-en/edu-t508-b4.en.js", bytes: 15736 },
      { name: "/src/core/edu-en/edu-t508.en.js", bytes: 14180 },
      { name: "/src/core/edu-en/edu-t689t710.en.js", bytes: 100030 },
      { name: "/src/core/edu-en/edu-t690.en.js", bytes: 21988 },
      { name: "/src/core/edu-en/edu-t693.en.js", bytes: 10664 },
      { name: "/src/core/edu-en/edu-t694.en.js", bytes: 11019 },
      { name: "/src/core/edu-en/edu-t703.en.js", bytes: 10484 },
      { name: "/src/core/edu-en/edu-t720.en.js", bytes: 11420 },
      { name: "/src/core/edu-en/edu-t721.en.js", bytes: 8757 },
      { name: "/src/core/edu-en/edu-t722.en.js", bytes: 3637 },
      { name: "/src/core/edu-en/edu-t723.en.js", bytes: 2936 },
      { name: "/src/core/edu-en/edu-text-bubblebabble.en.js", bytes: 3191 },
      { name: "/src/core/edu-en/edu-text-jsescape.en.js", bytes: 2555 },
      { name: "/src/core/edu-en/edu-text-ppencode.en.js", bytes: 2360 },
      { name: "/src/core/edu-en/edu-token-signing.en.js", bytes: 7907 },
      { name: "/src/core/edu-en/edu-unified-misc.en.js", bytes: 11852 },
      { name: "/src/core/edu-en/eduImages.en.js", bytes: 5584 },
      { name: "/src/core/eduContent.en.js", bytes: 14117 },
    ],
  },
];

const PACK_BY_ID = new Map(PACKS.map((p) => [p.id, p]));

// 每个包的「能力名 / 缺失后果 / 兜底路径」，供离线就绪度直接展示给用户。
const FEATURE = {
  wasm: "压缩/破解/汇编反汇编/隐写/条码识别等 WASM 引擎功能",
  fonts: "天珩全角全字库（四平面，覆盖扩展 A/B 及以后的生僻字）",
  locales: "中文/英文之外的界面语言",
  "edu-en": "英文科普层（每个操作的说明与背景）",
};

const FALLBACK = {
  wasm:
    "打开对应功能时提示「该功能依赖的离线包未安装」，并给出包体积与安装入口；纯 JS 操作与首屏功能不受影响。",
  fonts:
    "仅使用首屏子集字体，生僻字/扩展平面字符显示为缺字方框（tofu），文本内容本身不丢失。",
  locales:
    "界面回退到中文，语言菜单中该语言标注「未安装离线包」，不静默切成别的语言。",
  "edu-en":
    "操作仍可执行，说明区回退中文科普；若中文条目也不存在则显示「英文科普未安装」。",
};

/* ------------------------------ 内部工具 ------------------------------ */

function badState(detail) {
  throw new Error(`离线包状态无效：${detail}`);
}

function normalizeInstalledMap(input) {
  // null / undefined = 什么都没装；数组 = 只给 id；对象 = 状态或 id->条目表。
  const map = new Map();
  if (input == null) return map;

  if (Array.isArray(input)) {
    for (const id of input) {
      if (!PACK_BY_ID.has(id)) throw new Error(`未知离线包: ${String(id)}`);
      map.set(id, PACK_BY_ID.get(id).entries.map((e) => e.name));
    }
    return map;
  }

  if (typeof input !== "object") badState("期望数组、状态对象或 id 映射");

  const table = "installed" in input ? input.installed : input;
  if (table == null) return map;
  if (typeof table !== "object" || Array.isArray(table)) badState("installed 必须是对象");

  for (const [id, value] of Object.entries(table)) {
    const pack = PACK_BY_ID.get(id);
    if (!pack) throw new Error(`未知离线包: ${id}`);
    if (value === true) {
      map.set(id, pack.entries.map((e) => e.name));
      continue;
    }
    const list = Array.isArray(value) ? value : value && value.entries;
    if (!Array.isArray(list)) badState(`${id} 的条目清单缺失`);
    for (const name of list) {
      if (typeof name !== "string" || !name) badState(`${id} 的条目名必须是字符串`);
    }
    map.set(id, list.slice());
  }
  return map;
}

function normalizeState(state) {
  if (state == null) return { installed: {}, errors: {} };
  if (typeof state !== "object" || Array.isArray(state)) badState("状态必须是对象");
  const installed = state.installed == null ? {} : state.installed;
  const errors = state.errors == null ? {} : state.errors;
  if (typeof installed !== "object" || Array.isArray(installed)) badState("installed 必须是对象");
  if (typeof errors !== "object" || Array.isArray(errors)) badState("errors 必须是对象");
  return { ...state, installed, errors };
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1048576).toFixed(2)} MiB`;
}

/* ------------------------------ 包计划 ------------------------------ */

/**
 * 计算安装计划。入参可以是：
 *   - null / undefined（什么都没装）
 *   - id 数组（视为整包已装）
 *   - 状态对象 { installed, errors }（支持部分安装：installed[id].entries 可只含部分条目）
 *   - id -> 条目名数组 / true 的映射
 * 返回的每个 pack 含 state（installed|missing|partial）与 missingCount（缺失条目数）。
 * missingBytes 只统计真正还缺的条目字节，部分安装不会重复计入已装部分。
 */
export function packPlan(installedIds) {
  const installedMap = normalizeInstalledMap(installedIds);
  const packs = [];
  let totalBytes = 0;
  let missingBytes = 0;

  for (const pack of PACKS) {
    const names = installedMap.get(pack.id);
    const present = new Set(names || []);
    let installedCount = 0;
    let installedBytes = 0;
    let missing = 0;

    for (const entry of pack.entries) {
      if (present.has(entry.name)) {
        installedCount++;
        installedBytes += entry.bytes;
      } else {
        missing++;
      }
    }

    const state = installedCount === pack.entries.length
      ? "installed"
      : installedCount === 0
        ? "missing"
        : "partial";

    totalBytes += pack.bytes;
    missingBytes += pack.bytes - installedBytes;

    packs.push({
      ...pack,
      entries: pack.entries.map((e) => ({ ...e })),
      state,
      installedCount,
      missingCount: missing,
      installedBytes,
      missingBytes: pack.bytes - installedBytes,
    });
  }

  return { packs, totalBytes, missingBytes };
}

/* ------------------------------ 状态迁移 ------------------------------ */

/**
 * 标记整包安装完成，返回新状态（不修改入参）。重复标记幂等：条目不会重复累加。
 */
export function markInstalled(state, id) {
  const s = normalizeState(state);
  const pack = PACK_BY_ID.get(id);
  if (!pack) throw new Error(`未知离线包: ${id}`);

  const installed = { ...s.installed };
  installed[id] = { entries: pack.entries.map((e) => e.name), bytes: pack.bytes };

  const errors = { ...s.errors };
  delete errors[id];

  return { ...s, installed, errors };
}

/**
 * 记录一次安装失败，返回 { state, error }（不修改入参）。
 * reason 必须是可读的非空字符串：上层应带底层原因（如 QuotaExceededError 的 message），
 * 空原因直接抛错，避免「装失败了但界面什么都不说」。
 */
export function markFailed(state, id, reason) {
  const s = normalizeState(state);
  const pack = PACK_BY_ID.get(id);
  if (!pack) throw new Error(`未知离线包: ${id}`);
  if (typeof reason !== "string" || !reason.trim()) {
    throw new Error(`离线包安装失败原因缺失: ${id}（需给出可读原因，例如配额不足或网络中断）`);
  }

  const error = { packId: id, reason: reason.trim() };
  return {
    state: { ...s, errors: { ...s.errors, [id]: error } },
    error,
  };
}

/* ------------------------------ 离线就绪度 ------------------------------ */

/**
 * 把状态翻译成「哪些能力降级、用户会看到什么」。
 * ready 为 true 仅当四个包全部完整安装；其余情况逐包给出 feature / reason / fallback。
 */
export function offlineReadiness(state) {
  const s = normalizeState(state);
  const plan = packPlan(s);
  const degradations = [];

  for (const pack of plan.packs) {
    if (pack.state === "installed") continue;

    const err = s.errors[pack.id];
    const reasonParts = [];
    if (pack.state === "partial") {
      reasonParts.push(
        `部分安装：已装 ${pack.installedCount}/${pack.entries.length} 项，`
        + `缺 ${pack.missingCount} 项（${formatBytes(pack.missingBytes)}）`,
      );
    } else {
      reasonParts.push(`未安装：${pack.entries.length} 项 / ${formatBytes(pack.bytes)}`);
    }
    if (err && err.reason) reasonParts.push(`上次安装失败：${err.reason}`);

    degradations.push({
      packId: pack.id,
      state: pack.state,
      feature: FEATURE[pack.id],
      reason: reasonParts.join("；"),
      fallback: FALLBACK[pack.id],
      missingCount: pack.missingCount,
      missingBytes: pack.missingBytes,
    });
  }

  return { ready: degradations.length === 0, degradations };
}

/* ------------------------------ 清单差异 ------------------------------ */

/**
 * 清单条目：字符串（仅名字）或 { name, size, hash? }。
 * 清单本身：数组，或 { entries: [...] }。
 * 默认哈希 = FNV-1a 32 位 over `${name}\0${size}`，只用于「同名同大小之外是否变化」的判定；
 * 需要强哈希时传 options.hash(entry) => string。
 * 返回 { added, removed, changed }，均为按名字排序的条目名数组。
 */
export function diffManifest(oldManifest, newManifest, options = {}) {
  const hashFn = resolveHash(options && options.hash);
  const oldMap = toManifestMap(oldManifest, hashFn, "旧清单");
  const newMap = toManifestMap(newManifest, hashFn, "新清单");

  const added = [];
  const removed = [];
  const changed = [];

  for (const [name, hash] of newMap) {
    if (!oldMap.has(name)) added.push(name);
    else if (oldMap.get(name) !== hash) changed.push(name);
  }
  for (const name of oldMap.keys()) {
    if (!newMap.has(name)) removed.push(name);
  }

  const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return { added: added.sort(byName), removed: removed.sort(byName), changed: changed.sort(byName) };
}

function resolveHash(hash) {
  if (hash == null) return defaultHash;
  if (typeof hash !== "function") {
    throw new Error("哈希函数无效：options.hash 必须是函数，收到 " + typeof hash);
  }
  return (entry) => {
    const out = hash(entry);
    if (typeof out !== "string" || !out) {
      throw new Error(`哈希函数返回值无效: ${entry && entry.name}（需非空字符串）`);
    }
    return out;
  };
}

function defaultHash(entry) {
  const text = `${entry.name}\u0000${entry.size}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function toManifestMap(manifest, hashFn, label) {
  if (manifest == null) throw new Error(`清单缺失：${label} 为 null 或 undefined`);
  const list = Array.isArray(manifest) ? manifest : manifest.entries;
  if (!Array.isArray(list)) throw new Error(`清单缺字段：${label}.entries 必须是数组`);

  const map = new Map();
  for (const raw of list) {
    let name;
    let size;
    let explicitHash = null;

    if (typeof raw === "string") {
      name = raw;
      size = 0;
    } else if (raw && typeof raw === "object") {
      name = raw.name;
      size = raw.size;
      if (typeof raw.hash === "string" && raw.hash) explicitHash = raw.hash;
    } else {
      throw new Error(`清单条目无效：${label} 中出现 ${raw === null ? "null" : typeof raw}`);
    }

    if (typeof name !== "string" || !name) {
      throw new Error(`清单条目缺字段：${label} 的条目缺少 name`);
    }
    if (!Number.isFinite(size) || size < 0) {
      throw new Error(`清单条目缺字段：${label} 的 ${name} 缺少合法的 size`);
    }
    if (map.has(name)) throw new Error(`清单条目重复：${label} 中 ${name} 出现多次`);

    map.set(name, explicitHash || hashFn({ name, size }));
  }
  return map;
}
