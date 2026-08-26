/*
 * mcSave.js — Minecraft 存档分析地基（cat:'analysis'，单向 run）。
 *
 * 本卡只做最小地基两件：
 * 1) 自写纯 JS NBT 解析器（Java 版大端序二进制树，tag type 0-12）。
 * Long/LongArray 用 BigInt；String 按 UTF-8（TextDecoder，兜底 latin1）。
 * 解压优先浏览器原生 DecompressionStream('gzip'|'deflate')，异步。
 * 2) mcLevelDat：解析 level.dat（gzip NBT），输出中文结构化摘要——
 * 种子 seed、出生点 Spawn、GameRules、LevelName、Version、DataVersion
 * 并高亮异常/可疑字段（非常规 GameRule、异常坐标等）。
 *
 * 输入是二进制文件 → 照 pcapParse.js 范式接 hex/base64/auto 文本输入
 * （复用 inputToBytes）。纯前端零外发，件内自注册。
 *
 * 格式依据（照规范实现，不编造）：
 * NBT: [1B tagType][2B nameLen N][N B name(modified UTF-8)][payload]
 * 根为 TAG_Compound；List 元素只有 payload（type 在 List 头写一次）。
 * tag: 0 End / 1 Byte / 2 Short / 3 Int / 4 Long / 5 Float / 6 Double /
 * 7 ByteArray / 8 String / 9 List / 10 Compound / 11 IntArray / 12 LongArray。
 * level.dat: gzip(魔数 1f 8b) 压缩的 NBT；根 Compound 内含 "Data" 子树。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./pcapParse.js";
import { streamDecompress as safeStreamDecompress } from "./compress.js"; // v0.1.5：安全流（超时+纯JS兜底）

// ============================================================
// 解压：代理 compress.js 安全流，按魔数判 gzip / zlib(deflate)
// v0.1.5：安全流内建超时 + 纯 JS inflate 兜底，无需 hasStreams 预检
// ============================================================

async function streamDecompress(format, bytes) {
  // v0.1.5：改用 compress.js 安全流（超时 + 纯 JS inflate 兜底），保留 128MB 防爆上限
  const out = await safeStreamDecompress(format, bytes);
  if (out.length > MAX_INFLATE) {
    throw new Error("NBT 解压超过 128MB 上限（疑似解压炸弹），已中止");
  }
  return out;
}

// 若已是裸 NBT（首字节是合法 tag 且非压缩魔数），直接返回；否则按魔数解压。
// gzip: 1f 8b；zlib: 首字节 (b0 & 0x0f)==8 且 (b0<<8|b1)%31==0。
async function maybeDecompress(bytes) {
  if (!bytes || bytes.length < 2) return { data: bytes, note: "输入过短" };
  const b0 = bytes[0], b1 = bytes[1];
  if (b0 === 0x1f && b1 === 0x8b) {
    return { data: await streamDecompress("gzip", bytes), note: "gzip 已解压" };
  }
  if ((b0 & 0x0f) === 8 && (((b0 << 8) | b1) % 31 === 0)) {
    return { data: await streamDecompress("deflate", bytes), note: "zlib(deflate) 已解压" };
  }
 // 未压缩：level.dat 极少见，但结构方块 .nbt 也可能裸存。首字节应为合法 tag 0-12。
  if (b0 <= 12) return { data: bytes, note: "未压缩（裸 NBT）" };
  throw new Error("无法识别的输入：非 gzip(1f8b)/zlib，首字节也不是合法 NBT tag(0-12)");
}

// ============================================================
// 纯 JS NBT 解析器（大端序）
// ============================================================
const TAG_NAMES = [
  "End", "Byte", "Short", "Int", "Long", "Float", "Double",
  "ByteArray", "String", "List", "Compound", "IntArray", "LongArray",
];

const _latin1Decoder = { decode: (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(u8.length, i + 8192))); return s; } };
const _utf8Decoder = (typeof TextDecoder === "function") ? new TextDecoder("utf-8", { fatal: false }) : _latin1Decoder;

// NBT String 是 Java modified UTF-8。绝大多数场景等同普通 UTF-8，用 TextDecoder；
// 抛错或无 TextDecoder 时兜底 latin1。
function decodeNbtString(u8) {
  try { return _utf8Decoder.decode(u8); }
  catch { return _latin1Decoder.decode(u8); }
}

// 防炸：限制节点总数与嵌套深度。
const MAX_NODES = 5_000_000;
const MAX_DEPTH = 512;

function createNbtReader(data) {
  let pos = 0;
  let nodeCount = 0;

  function need(n) {
    if (pos + n > data.length) throw new Error(`NBT: 数据提前结束（需 ${n} 字节 @${pos}，剩 ${data.length - pos}）`);
  }
  function u8() { need(1); return data[pos++]; }
  function i8() { const v = u8(); return v < 128 ? v : v - 256; }
  function u16() { need(2); const v = (data[pos] << 8) | data[pos + 1]; pos += 2; return v >>> 0; }
  function i16() { const v = u16(); return v < 0x8000 ? v : v - 0x10000; }
  function i32() {
    need(4);
    const v = ((data[pos] << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3]);
    pos += 4;
    return v | 0; // 有符号
  }
  function i64() {
    need(8);
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(data[pos + i]);
    pos += 8;
    if (v >= (1n << 63n)) v -= (1n << 64n); // 有符号 BigInt
    return v;
  }
  function f32() {
    need(4);
    const dv = new DataView(data.buffer, data.byteOffset + pos, 4);
    const v = dv.getFloat32(0, false);
    pos += 4;
    return v;
  }
  function f64() {
    need(8);
    const dv = new DataView(data.buffer, data.byteOffset + pos, 8);
    const v = dv.getFloat64(0, false);
    pos += 8;
    return v;
  }
  function str() {
    const len = u16();
    need(len);
    const s = decodeNbtString(data.subarray(pos, pos + len));
    pos += len;
    return s;
  }

 // 按 tag type 读 payload
  function readPayload(type, depth) {
    if (depth > MAX_DEPTH) throw new Error("NBT: 嵌套过深（>" + MAX_DEPTH + "）");
    if (++nodeCount > MAX_NODES) throw new Error("NBT: 节点过多（>" + MAX_NODES + "）");
    switch (type) {
      case 1: return i8();
      case 2: return i16();
      case 3: return i32();
      case 4: return i64();          // BigInt
      case 5: return f32();
      case 6: return f64();
      case 7: {                      // ByteArray
        const n = i32();
        if (n < 0) throw new Error("NBT: ByteArray 负长度 " + n);
        need(n);
        const arr = data.subarray(pos, pos + n);
        pos += n;
        return arr; // Uint8Array 视图
      }
      case 8: return str();
      case 9: {                      // List：1B 元素 type + 4B count + payload×count
        const elemType = u8();
        const n = i32();
        if (n < 0) throw new Error("NBT: List 负长度 " + n);
        const list = [];
        list._elemType = elemType;   // 记录元素类型，供渲染
        if (elemType === 0 && n > 0) {
 // TAG_End 元素类型只在空列表合法；非空则数据异常，按空处理避免死读
          return list;
        }
        for (let i = 0; i < n; i++) list.push(readPayload(elemType, depth + 1));
        return list;
      }
      case 10: {                     // Compound：连续 named tag 直到 End
 // Object.create(null)：无原型链，恶意键名 __proto__ 只当普通数据键，不污染原型。
        const obj = Object.create(null);
        obj.__nbtCompound = true;
        for (;;) {
          const t = u8();
          if (t === 0) break;        // TAG_End
          if (t < 0 || t > 12) throw new Error("NBT: 非法 tag type " + t + " @" + (pos - 1));
          const name = str();
          obj[name] = { __t: t, v: readPayload(t, depth + 1) };
        }
        return obj;
      }
      case 11: {                     // IntArray
        const n = i32();
        if (n < 0) throw new Error("NBT: IntArray 负长度 " + n);
        const arr = new Array(n);
        for (let i = 0; i < n; i++) arr[i] = i32();
        return arr;
      }
      case 12: {                     // LongArray（BigInt[]）
        const n = i32();
        if (n < 0) throw new Error("NBT: LongArray 负长度 " + n);
        const arr = new Array(n);
        for (let i = 0; i < n; i++) arr[i] = i64();
        return arr;
      }
      default:
        throw new Error("NBT: 未知/不可读 tag type " + type);
    }
  }

  return {
 // 解析根：1B type（应为 10 Compound）+ name + payload
    parseRoot() {
      const t = u8();
      if (t === 0) return { name: "", type: 0, value: null }; // 空
      if (t !== 10) {
 // 宽容：非 Compound 根也读（结构 .nbt 少见非常规）
        const name = str();
        return { name, type: t, value: readPayload(t, 0) };
      }
      const name = str();
      const value = readPayload(10, 0);
      return { name, type: 10, value };
    },
    get pos() { return pos; },
    get nodeCount() { return nodeCount; },
  };
}

/** 解析一段 NBT 字节（已解压）→ { name, type, value }。value 中 Compound 项为 {__t, v}。 */
export function parseNBT(data) {
  return createNbtReader(data).parseRoot();
}

/** 解压 + 解析：输入原始文件字节 → { root, note }。 */
export async function decompressAndParseNBT(bytes) {
  const dz = await maybeDecompress(bytes);
  const root = parseNBT(dz.data);
  return { root, note: dz.note, decompressed: dz.data };
}

// ============================================================
// 取值助手：在 Compound 里按路径找值
// ============================================================
// Compound 项形如 { __t, v }。unwrap 拿到 v。
function child(compound, key) {
  if (!compound || typeof compound !== "object") return undefined;
  const e = compound[key];
  return e && typeof e === "object" && "__t" in e ? e : undefined;
}
function childVal(compound, key) {
  const e = child(compound, key);
  return e ? e.v : undefined;
}
// ============================================================
// 渲染值为中文可读字符串
// ============================================================
function fmtVal(entry, indent, depth) {
  if (!entry) return "(无)";
  const { __t: t, v } = entry;
  return fmtPayload(t, v, indent, depth);
}

function fmtPayload(t, v, indent, depth) {
  const pad = "  ".repeat(indent);
  switch (t) {
    case 1: case 2: case 3: return String(v);
    case 4: return v.toString() + "L";          // Long BigInt
    case 5: case 6: return String(v);
    case 7: return `[ByteArray ${v.length} 字节] ${hexPreview(v, 32)}`;
    case 8: return JSON.stringify(v);
    case 9: {
      const et = v._elemType;
      if (v.length === 0) return `[List<${TAG_NAMES[et] || et}> 空]`;
      if (depth > 6) return `[List<${TAG_NAMES[et] || et}> ${v.length} 项 …]`;
      const items = v.map((it) => fmtPayload(et, it, indent + 1, depth + 1));
 // 标量列表单行
      if (et >= 1 && et <= 6) return `[${items.join(", ")}]`;
      return `List<${TAG_NAMES[et] || et}>(${v.length}):\n` +
        v.map((it, i) => `${pad}  [${i}] ${fmtPayload(et, it, indent + 1, depth + 1)}`).join("\n");
    }
    case 10: {
      const keys = Object.keys(v).filter((k) => k !== "__nbtCompound");
      if (keys.length === 0) return "{}";
      if (depth > 8) return `{…${keys.length} 键}`;
      return "\n" + keys.map((k) => {
        const sub = fmtPayload(v[k].__t, v[k].v, indent + 1, depth + 1);
        return `${pad}  ${k}: ${sub}`;
      }).join("\n");
    }
    case 11: return `[IntArray ${v.length}] ${v.slice(0, 16).join(", ")}${v.length > 16 ? " …" : ""}`;
    case 12: return `[LongArray ${v.length}] ${v.slice(0, 8).map((x) => x.toString()).join(", ")}${v.length > 8 ? " …" : ""}`;
    default: return "(?)";
  }
}

function hexPreview(u8, n) {
  const e = Math.min(u8.length, n);
  let s = "";
  for (let i = 0; i < e; i++) s += (u8[i] < 16 ? "0" : "") + u8[i].toString(16);
  return s + (u8.length > n ? " …" : "");
}

// ============================================================
// 已知标准 GameRules（1.20 前后常见集合）→ 非此集合的高亮为可疑
// ============================================================
const KNOWN_GAMERULES = new Set([
  "announceAdvancements", "commandBlockOutput", "disableElytraMovementCheck",
  "disableRaids", "doDaylightCycle", "doEntityDrops", "doFireTick",
  "doImmediateRespawn", "doInsomnia", "doLimitedCrafting", "doMobLoot",
  "doMobSpawning", "doPatrolSpawning", "doTileDrops", "doTraderSpawning",
  "doVinesSpread", "doWardenSpawning", "doWeatherCycle", "drowningDamage",
  "enderPearlsVanishOnDeath", "fallDamage", "fireDamage", "forgiveDeadPlayers",
  "freezeDamage", "globalSoundEvents", "keepInventory", "logAdminCommands",
  "maxCommandChainLength", "maxCommandForkCount", "maxEntityCramming",
  "mobExplosionDropDecay", "mobGriefing", "naturalRegeneration",
  "playersNetherPortalCreativeDelay", "playersNetherPortalDefaultDelay",
  "playersSleepingPercentage", "projectilesCanBreakBlocks", "pvp",
  "randomTickSpeed", "reducedDebugInfo", "sendCommandFeedback",
  "showDeathMessages", "snowAccumulationHeight", "spawnRadius",
  "spawnChunkRadius", "spectatorsGenerateChunks", "tntExplosionDropDecay",
  "universalAnger", "waterSourceConversion", "lavaSourceConversion",
  "blockExplosionDropDecay", "commandModificationBlockLimit",
  "doWardenSpawning", "commandBlocksEnabled",
]);

// DataVersion → 大致版本（只列常见锚点，够 CTF 定位；非精确逐版本表）
function dataVersionToHint(dv) {
  if (dv == null) return null;
  const anchors = [
    [100, "1.9 快照期"], [169, "1.9"], [512, "1.10"], [819, "1.11"],
    [922, "1.11.2"], [1139, "1.12"], [1343, "1.12.2"], [1519, "1.13"],
    [1631, "1.13.2"], [1952, "1.14"], [1976, "1.14.4"], [2225, "1.15"],
    [2230, "1.15.2"], [2566, "1.16"], [2586, "1.16.5"], [2724, "1.17"],
    [2730, "1.17.1"], [2860, "1.18"], [2865, "1.18.1"], [2975, "1.18.2"],
    [3105, "1.19"], [3120, "1.19.2"], [3218, "1.19.4"], [3337, "1.20"],
    [3465, "1.20.1"], [3578, "1.20.2"], [3698, "1.20.4"], [3837, "1.20.6"],
    [3953, "1.21"], [4082, "1.21.4"],
  ];
  let best = null;
  for (const [ver, name] of anchors) {
    if (dv >= ver) best = name;
  }
  if (!best) return "早于 1.9";
 // 精确命中
  for (const [ver, name] of anchors) if (dv === ver) return name;
  return best + " 或更高";
}

// ============================================================
// level.dat 摘要提取
// ============================================================
function summarizeLevelDat(root) {
  const lines = [];
  const warns = [];

  const rootVal = root.value;
  if (!rootVal || root.type !== 10) {
    return { text: "根不是 Compound，非标准 level.dat 结构。", warns: [] };
  }
 // level.dat 结构：根 Compound → "Data" 子 Compound
  const dataEntry = child(rootVal, "Data");
  const data = dataEntry ? dataEntry.v : rootVal; // 兜底：有些直接在根
  if (!dataEntry) warns.push("未找到标准 \"Data\" 子 Compound，字段直接从根读（结构异常）。");

 // LevelName
  const levelName = childVal(data, "LevelName");
  if (levelName !== undefined) lines.push(`世界名 LevelName: ${JSON.stringify(levelName)}`);

 // Version（新版是 Compound: {Id, Name, Snapshot}）
  const verEntry = child(data, "Version");
  if (verEntry) {
    if (verEntry.__t === 10) {
      const vn = childVal(verEntry.v, "Name");
      const vid = childVal(verEntry.v, "Id");
      const snap = childVal(verEntry.v, "Snapshot");
      lines.push(`版本 Version: ${vn !== undefined ? vn : "?"}${vid !== undefined ? ` (Id=${vid})` : ""}${snap ? " [快照]" : ""}`);
    } else {
      lines.push(`版本 Version: ${fmtVal(verEntry, 0, 0)}`);
    }
  }

 // DataVersion
  const dataVer = childVal(data, "DataVersion");
  if (dataVer !== undefined) {
    const hint = dataVersionToHint(Number(dataVer));
    lines.push(`DataVersion: ${dataVer}${hint ? `  → 约 ${hint}` : ""}`);
  }

 // 种子 seed：新版 WorldGenSettings.seed（Long），老版 RandomSeed（Long）
  let seedShown = false;
  const wgsEntry = child(data, "WorldGenSettings");
  if (wgsEntry && wgsEntry.__t === 10) {
    const seed = childVal(wgsEntry.v, "seed");
    if (seed !== undefined) { lines.push(`种子 seed (WorldGenSettings.seed): ${seed.toString()}`); seedShown = true; }
  }
  const randomSeed = childVal(data, "RandomSeed");
  if (randomSeed !== undefined) { lines.push(`种子 RandomSeed (旧版): ${randomSeed.toString()}`); seedShown = true; }
  if (!seedShown) lines.push("种子 seed: (未找到 WorldGenSettings.seed / RandomSeed)");

 // 出生点 Spawn X/Y/Z
  const sx = childVal(data, "SpawnX");
  const sy = childVal(data, "SpawnY");
  const sz = childVal(data, "SpawnZ");
  if (sx !== undefined || sy !== undefined || sz !== undefined) {
    lines.push(`出生点 Spawn: X=${sx ?? "?"} Y=${sy ?? "?"} Z=${sz ?? "?"}`);
 // 异常坐标高亮：极端值常是编码 flag 的信号
    for (const [n, val] of [["SpawnX", sx], ["SpawnY", sy], ["SpawnZ", sz]]) {
      if (val === undefined) continue;
      const num = Number(val);
      if (n === "SpawnY" && (num < -64 || num > 320)) warns.push(`出生点 ${n}=${num} 超出常规世界高度(-64..320)，可疑。`);
      if ((n === "SpawnX" || n === "SpawnZ") && Math.abs(num) > 29_999_984) warns.push(`出生点 ${n}=${num} 超出世界边界(±29999984)，可疑。`);
      if (Math.abs(num) >= 32 && Math.abs(num) <= 126 && num !== 0) {
 // 落在可打印 ASCII 区间 → 可能坐标编码字符
        const asc = String.fromCharCode(Math.abs(num));
        warns.push(`出生点 ${n}=${num} 落在可打印 ASCII 区间，可能编码字符 '${asc}'。`);
      }
    }
  }

 // GameRules
  const grEntry = child(data, "GameRules");
  if (grEntry && grEntry.__t === 10) {
    const rules = grEntry.v;
    const keys = Object.keys(rules).filter((k) => k !== "__nbtCompound");
    lines.push(`GameRules (${keys.length} 条):`);
    for (const k of keys.sort()) {
      const val = rules[k].v;
      const suspicious = !KNOWN_GAMERULES.has(k);
      lines.push(`  ${suspicious ? "⚠ " : "  "}${k} = ${JSON.stringify(val)}`);
      if (suspicious) warns.push(`非常规 GameRule "${k}" = ${JSON.stringify(val)}（可能藏 flag/线索）。`);
    }
  }

 // 其他常见字段
  const dayTime = childVal(data, "DayTime");
  const time = childVal(data, "Time");
  if (dayTime !== undefined) lines.push(`DayTime: ${dayTime.toString()}`);
  if (time !== undefined) lines.push(`Time: ${time.toString()}`);
  const hardcore = childVal(data, "hardcore");
  if (hardcore !== undefined) lines.push(`hardcore: ${hardcore}`);
  const gameType = childVal(data, "GameType");
  if (gameType !== undefined) {
    const gt = ["生存", "创造", "冒险", "旁观"][Number(gameType)] || "?";
    lines.push(`GameType: ${gameType} (${gt})`);
  }

 // generatorOptions（旧版自定义生成，常藏线索）
  const genOpt = childVal(data, "generatorOptions");
  if (genOpt !== undefined && genOpt !== "") {
    lines.push(`generatorOptions: ${JSON.stringify(genOpt)}`);
    warns.push("存在 generatorOptions，可能含自定义生成参数/线索。");
  }
  const genName = childVal(data, "generatorName");
  if (genName !== undefined) lines.push(`generatorName: ${JSON.stringify(genName)}`);

 // 非标准顶层字段扫描（Data 内的可疑自定义 tag）
  const STD_TOP = new Set([
    "LevelName", "Version", "DataVersion", "RandomSeed", "WorldGenSettings",
    "SpawnX", "SpawnY", "SpawnZ", "SpawnAngle", "GameRules", "DayTime", "Time",
    "hardcore", "GameType", "Difficulty", "DifficultyLocked", "generatorOptions",
    "generatorName", "generatorVersion", "MapFeatures", "allowCommands",
    "initialized", "clearWeatherTime", "rainTime", "raining", "thunderTime",
    "thundering", "BorderCenterX", "BorderCenterZ", "BorderSize", "BorderWarningBlocks",
    "BorderWarningTime", "BorderSizeLerpTarget", "BorderSizeLerpTime",
    "BorderSafeZone", "BorderDamagePerBlock", "Player", "LastPlayed", "SizeOnDisk",
    "ScheduledEvents", "ServerBrands", "WanderingTraderId", "WanderingTraderSpawnChance",
    "WanderingTraderSpawnDelay", "CustomBossEvents", "DragonFight", "DimensionData",
    "WasModded", "removed_features", "DataPacks", "__nbtCompound",
  ]);
  const custom = Object.keys(data).filter((k) => k !== "__nbtCompound" && !STD_TOP.has(k));
  if (custom.length) {
    for (const k of custom) {
      const e = data[k];
      warns.push(`非标准字段 "${k}" (${TAG_NAMES[e.__t] || e.__t}) = ${fmtPayload(e.__t, e.v, 0, 7)}（自定义 tag，重点检查）。`);
    }
  }

  return { text: lines.join("\n"), warns };
}

// ============================================================
// run
// ============================================================
async function mcLevelDatRun(text, p = {}) {
  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) {
    return "（空输入）请粘贴 level.dat 文件的 hex 或 base64 编码。level.dat 是 gzip 压缩的 NBT，位于世界存档根目录。";
  }
  let bytes;
  try {
 // 拖入文件走 rawBytes 通道（acceptsBytes 约定）：直接用真字节，跳过 hex/base64 文本解析。
    bytes = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : inputToBytes(text, p.inputEnc || "auto");
  } catch (e) {
    return "输入解析失败：" + (e && e.message ? e.message : String(e));
  }
  if (bytes.length < 3) return "（输入过短）不足一个 gzip 头。";

  let parsed;
  try {
    parsed = await decompressAndParseNBT(bytes);
  } catch (e) {
    return "解析失败：" + (e && e.message ? e.message : String(e));
  }

  const { root, note } = parsed;
  const lines = [];
  lines.push("=== Minecraft level.dat 解析（Java 版大端序 NBT）===");
  lines.push(`解压: ${note}`);
  lines.push(`根 tag: ${TAG_NAMES[root.type] || root.type}${root.name ? ` "${root.name}"` : "（空名）"}`);
  lines.push("");

  const { text: summaryText, warns } = summarizeLevelDat(root);
  lines.push("--- 结构化摘要 ---");
  lines.push(summaryText);
  lines.push("");

  if (warns.length) {
    lines.push(`--- ⚠ 异常/可疑字段高亮（${warns.length}）---`);
    for (const w of warns) lines.push("  ⚠ " + w);
    lines.push("");
  } else {
    lines.push("--- 未检出明显异常字段 ---");
    lines.push("");
  }

 // 可选：完整 NBT 树转储
  if (p.dumpTree === true || p.dumpTree === "true") {
    lines.push("--- 完整 NBT 树 ---");
    lines.push(fmtPayload(root.type, root.value, 0, 0));
  } else {
    lines.push("（勾选「转储完整 NBT 树」可展开全部字段）");
  }

  return lines.join("\n");
}

// ============================================================
// 一把梭识别：hex/base64 里的 gzip 魔数 1f8b（level.dat 恒为 gzip NBT）
// 或裸 NBT 根标签 0a00（TAG_Compound + 空名长度）。返回 0..1 置信分。
// ============================================================
function mcSaveDetect(t) {
  const s = (t || "").trim();
  if (!s) return 0;
  const hex = s.replace(/[^0-9a-fA-F]/g, "").toLowerCase();
  if (/^[0-9a-f\s]+$/i.test(s) && hex.length >= 6) {
    if (hex.startsWith("1f8b08")) return 0.85; // gzip NBT
    if (hex.startsWith("0a00")) return 0.4;    // 裸 NBT 根 Compound
  }
  return 0;
}

// ============================================================
// 注册
// ============================================================
register({
  id: "mcLevelDat",
  cat: "forensic",
  name: "Minecraft level.dat 解析",
  desc: "解析 Minecraft Java 版世界存档 level.dat（gzip 压缩的 NBT）：种子/出生点/GameRules/版本/DataVersion，高亮非常规 GameRule 与异常坐标等可疑字段。自写大端序 NBT 解析器，Long 用 BigInt，纯前端零外发",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "auto", options: [
      { value: "auto", label: "自动识别" }, { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" },
    ] },
    { key: "dumpTree", label: "转储完整 NBT 树", type: "bool", default: false },
  ],
  run: mcLevelDatRun,
  acceptsBytes: true,
 // 一把梭识别：hex/base64 里的 gzip 魔数 1f8b（level.dat 恒为 gzip NBT）。
 // 命中含 Minecraft 存档典型 NBT 键名（LevelName/Data/DataVersion）时提高置信。
  detect: mcSaveDetect,
});
