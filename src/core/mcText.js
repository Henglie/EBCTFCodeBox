/*
 * mcText.js — Minecraft 存档「文本情报一键提取」（cat:'analysis'，单向 run）。
 *
 * mcLevelDat（mcSave.js）的姊妹功能，MVP 第 2 项，找 flag 主力。
 * 直接复用 mcSave.js 的 NBT 解析器（parseNBT / decompressAndParseNBT）
 * 复用 pcapParse.js 的 inputToBytes 接 hex/base64/auto 文本输入。本卡不重写解析器。
 *
 * 输入（auto 识别）：
 * 1) 单个 region/entities/poi 的 *.mca（Anvil 格式）——头 4KiB location 表
 * （1024×4 字节：3 字节扇区偏移 + 1 字节扇区数，每扇区 4KiB）+ 4KiB timestamp 表
 * 各 chunk 数据段 = 4 字节长度 + 1 字节压缩类型(1=gzip/2=zlib/3=none) + 压缩 NBT。
 * 2) 单个 .dat / .nbt（gzip / zlib / 裸 NBT）。
 *
 * 提取：遍历 NBT 树，按类型 + 坐标聚合文本情报——
 * 告示牌(Text1-4 / front_text|back_text.messages)、成书(pages/title/author)
 * 命令方块(Command)、实体/方块自定义名(CustomName)、物品(display.Name/Lore
 * 1.20.5+ components:minecraft:custom_name|item_name|lore)。可选兜底抽全部 TAG_String。
 *
 * flag 正则高亮：flag{...} 及 xxx{...} 常见变体，并对疑似 base64 的文本尝试解码再扫。
 * 无 detect（analysis 类）。纯前端零外发，件内自注册。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./pcapParse.js";
import { parseNBT, decompressAndParseNBT } from "./mcSave.js";

// ============================================================
// Compound 取值助手（Compound 项形如 { __t, v }）
// ============================================================
function entryOf(comp, key) {
  if (!comp || typeof comp !== "object") return undefined;
  const e = comp[key];
  return e && typeof e === "object" && "__t" in e ? e : undefined;
}
function strOf(comp, key) {
  const e = entryOf(comp, key);
  return e && e.__t === 8 ? e.v : undefined;
}
function numOf(comp, key) {
  const e = entryOf(comp, key);
  if (!e) return undefined;
  if (e.__t >= 1 && e.__t <= 6) return Number(e.v);
  return undefined;
}
function fmtN(v) {
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return (Math.round(n * 10) / 10).toString();
}

// ============================================================
// 文本组件（JSON text component）→ 可读文本
// 告示牌/CustomName/Name 常是 '{"text":"..."}' 或数组形式，抽 text/extra 拼接。
// ============================================================
function collectComp(node, out) {
  if (node == null) return;
  if (typeof node === "string") { out.push(node); return; }
  if (Array.isArray(node)) { for (const n of node) collectComp(n, out); return; }
  if (typeof node === "object") {
    if (typeof node.text === "string") out.push(node.text);
    if ("extra" in node) collectComp(node.extra, out);
  }
}
export function readableText(s) {
  if (typeof s !== "string") return String(s);
  const t = s.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      const parts = [];
      collectComp(JSON.parse(t), parts);
      const joined = parts.join("");
      if (joined) return joined;
    } catch { /* 非 JSON，用原文 */ }
  }
  return s;
}

// ============================================================
// flag 检测：flag{...} + 通用 xxx{...} 变体 + 疑似 base64 解码再扫
// ============================================================
function tryB64Decode(s) {
  const t = String(s).trim();
  if (!/^[A-Za-z0-9+/]{8,}={0,2}$/.test(t) || t.length % 4 !== 0) return null;
  try {
    if (typeof globalThis.atob === "function") return globalThis.atob(t);
  } catch { /* ignore */ }
  return null;
}

const FLAG_RES = [
  /flag\{[^}]{0,300}\}/gi,                          // 标准 flag{...}
  /[A-Za-z_][A-Za-z0-9_]{1,24}\{[^}]{1,300}\}/g,    // 通用 xxx{...}（ctf{}/key{}/DASCTF{} 等）
];

/** 在文本（含可读组件、base64 解码）里找所有 flag/疑似，去重返回。extraRe 为可选自定义正则串。 */
export function findFlags(text, extraRe) {
  const out = new Set();
  const scan = (s) => {
    if (typeof s !== "string" || !s) return;
    for (const re of FLAG_RES) {
      const r = new RegExp(re.source, re.flags);
      let m;
      while ((m = r.exec(s)) !== null) {
        out.add(m[0]);
        if (m.index === r.lastIndex) r.lastIndex++; // 防零宽死循环
      }
    }
    if (extraRe) {
      try {
        const r = new RegExp(extraRe, "g");
        let m;
        while ((m = r.exec(s)) !== null) {
          if (m[0]) out.add(m[0]);
          if (m.index === r.lastIndex) r.lastIndex++;
        }
      } catch { /* 用户正则非法，忽略 */ }
    }
  };
  scan(text);
  const rd = readableText(text);
  if (rd !== text) scan(rd);
  const b = tryB64Decode(text);
  if (b) scan(b);
  return [...out];
}

// ============================================================
// Anvil MCA 解析
// ============================================================
function looksLikeMCA(bytes) {
  if (!bytes || bytes.length < 8192) return false;
  for (let i = 0; i < 1024; i++) {
    const o = i * 4;
    const off = (bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2];
    const cnt = bytes[o + 3];
 // 数据段最早从扇区 2 开始（前两扇区是 location + timestamp）
    if (off >= 2 && cnt > 0 && off * 4096 < bytes.length) return true;
  }
  return false;
}

/**
 * 解析 Anvil MCA header → 已生成 chunk 列表。
 * 每项 { index, localX, localZ, sectorOffset, sectorCount, compType, payload }
 * payload 为压缩类型字节之后的压缩 NBT 字节（Uint8Array 视图）。
 */
export function parseMCA(bytes) {
  if (!bytes || bytes.length < 8192) throw new Error("MCA: 文件不足 8KiB（缺少 location+timestamp 头）");
  const chunks = [];
  for (let i = 0; i < 1024; i++) {
    const o = i * 4;
    const off = (bytes[o] << 16) | (bytes[o + 1] << 8) | bytes[o + 2];
    const cnt = bytes[o + 3];
    if (off === 0 && cnt === 0) continue; // 未生成
    const byteOff = off * 4096;
    if (byteOff + 5 > bytes.length) continue; // 越界，跳过
    const len = (
      ((bytes[byteOff] << 24) | (bytes[byteOff + 1] << 16) | (bytes[byteOff + 2] << 8) | bytes[byteOff + 3]) >>> 0
    );
    if (len < 1) continue;
    const compType = bytes[byteOff + 4];
    const dataStart = byteOff + 5;
    const dataEnd = Math.min(byteOff + 4 + len, bytes.length); // len 含压缩类型字节
    if (dataEnd <= dataStart) continue;
    chunks.push({
      index: i,
      localX: i % 32,
      localZ: Math.floor(i / 32),
      sectorOffset: off,
      sectorCount: cnt,
      compType,
      payload: bytes.subarray(dataStart, dataEnd),
    });
  }
  return chunks;
}

// ============================================================
// NBT 树遍历 → 抽取文本情报
// entries: { kind, coord, id, field, raw }
// kind ∈ sign|book|cmd|name|item
// ============================================================
const COMPONENT_NAME_KEYS = new Set(["minecraft:custom_name", "minecraft:item_name"]);

function addEntry(collect, kind, ctx, field, raw) {
  if (raw == null || raw === "") return;
  collect.push({ kind, coord: ctx.coord || null, id: ctx.id || null, field, raw });
}

function walkCompound(comp, ctx, collect) {
  if (!comp || typeof comp !== "object") return;

 // 继承并按本节点更新上下文（坐标 / id）
  const nc = { coord: ctx.coord || null, id: ctx.id || null };
  const id = strOf(comp, "id");
  if (id) nc.id = id;
  const x = numOf(comp, "x"), y = numOf(comp, "y"), z = numOf(comp, "z");
  if (x != null && y != null && z != null) nc.coord = `(${x}, ${y}, ${z})`;
  const pos = entryOf(comp, "Pos");
  if (pos && pos.__t === 9 && Array.isArray(pos.v) && pos.v.length >= 3) {
    nc.coord = `(${fmtN(pos.v[0])}, ${fmtN(pos.v[1])}, ${fmtN(pos.v[2])})`;
  }

 // 告示牌（老版 Text1-4）
  for (const k of ["Text1", "Text2", "Text3", "Text4"]) {
    const s = strOf(comp, k);
    if (s != null) addEntry(collect, "sign", nc, k, s);
  }
 // 告示牌（1.20+ front_text / back_text → messages: List<String>）
  for (const side of ["front_text", "back_text"]) {
    const e = entryOf(comp, side);
    if (e && e.__t === 10) {
      const m = entryOf(e.v, "messages");
      if (m && m.__t === 9 && Array.isArray(m.v)) {
        m.v.forEach((mm, i) => { if (typeof mm === "string") addEntry(collect, "sign", nc, `${side}.messages[${i}]`, mm); });
      }
    }
  }
 // 命令方块
  { const s = strOf(comp, "Command"); if (s != null) addEntry(collect, "cmd", nc, "Command", s); }
 // 实体 / 方块实体自定义名
  { const s = strOf(comp, "CustomName"); if (s != null) addEntry(collect, "name", nc, "CustomName", s); }
 // 成书
  { const s = strOf(comp, "title"); if (s != null) addEntry(collect, "book", nc, "title", s); }
  { const s = strOf(comp, "author"); if (s != null) addEntry(collect, "book", nc, "author", s); }
  { const s = strOf(comp, "raw"); if (s != null) addEntry(collect, "book", nc, "raw", s); } // 1.20.5+ book pages/title 的 {raw:...}
  {
    const p = entryOf(comp, "pages");
    if (p && p.__t === 9 && Array.isArray(p.v)) {
      p.v.forEach((pp, i) => { if (typeof pp === "string") addEntry(collect, "book", nc, `pages[${i}]`, pp); });
    }
  }
 // 物品 display.Name / display.Lore
  {
    const d = entryOf(comp, "display");
    if (d && d.__t === 10) {
      const nm = strOf(d.v, "Name");
      if (nm != null) addEntry(collect, "item", nc, "display.Name", nm);
      const lore = entryOf(d.v, "Lore");
      if (lore && lore.__t === 9 && Array.isArray(lore.v)) {
        lore.v.forEach((ll, i) => { if (typeof ll === "string") addEntry(collect, "item", nc, `display.Lore[${i}]`, ll); });
      }
    }
  }
 // 1.20.5+ components 命名键
  for (const key of Object.keys(comp)) {
    if (key === "__nbtCompound") continue;
    if (COMPONENT_NAME_KEYS.has(key)) {
      const s = strOf(comp, key);
      if (s != null) addEntry(collect, "item", nc, key, s);
    } else if (key === "minecraft:lore") {
      const e = entryOf(comp, key);
      if (e && e.__t === 9 && Array.isArray(e.v)) {
        e.v.forEach((ll, i) => { if (typeof ll === "string") addEntry(collect, "item", nc, `${key}[${i}]`, ll); });
      }
    }
  }

 // 递归下探（Compound / List）
  for (const key of Object.keys(comp)) {
    if (key === "__nbtCompound") continue;
    const e = comp[key];
    if (!e || typeof e !== "object" || !("__t" in e)) continue;
    if (e.__t === 10) walkCompound(e.v, nc, collect);
    else if (e.__t === 9) walkList(e.v, nc, collect);
  }
}

function walkList(list, ctx, collect) {
  if (!Array.isArray(list)) return;
  const et = list._elemType;
  if (et === 10) { for (const it of list) walkCompound(it, ctx, collect); }
  else if (et === 9) { for (const it of list) walkList(it, ctx, collect); }
}

// 兜底：递归抽取所有 TAG_String（含 List<String>），带路径。
function collectAllStrings(comp, path, out) {
  if (!comp || typeof comp !== "object") return;
  for (const key of Object.keys(comp)) {
    if (key === "__nbtCompound") continue;
    const e = comp[key];
    if (!e || typeof e !== "object" || !("__t" in e)) continue;
    const p = path ? `${path}.${key}` : key;
    if (e.__t === 8) out.push({ path: p, text: e.v });
    else if (e.__t === 10) collectAllStrings(e.v, p, out);
    else if (e.__t === 9) collectStringsFromList(e.v, p, out);
  }
}
function collectStringsFromList(list, path, out) {
  if (!Array.isArray(list)) return;
  const et = list._elemType;
  if (et === 8) list.forEach((s, i) => { if (typeof s === "string") out.push({ path: `${path}[${i}]`, text: s }); });
  else if (et === 10) list.forEach((it, i) => collectAllStrings(it, `${path}[${i}]`, out));
  else if (et === 9) list.forEach((it, i) => collectStringsFromList(it, `${path}[${i}]`, out));
}

// ============================================================
// 单棵 NBT 树 → 情报（entries）+ 兜底字符串
// ============================================================
function extractFromRoot(root, ctx, collect, allStrings, wantAll) {
  if (!root || root.type !== 10) {
 // 宽容：非 Compound 根也尝试（结构 .nbt 少见非常规）
    return;
  }
  walkCompound(root.value, ctx, collect);
  if (wantAll) collectAllStrings(root.value, "", allStrings);
}

/**
 * 主入口：原始文件字节 → 提取结果。
 * @returns { form, note, chunkStats, entries, allStrings }
 */
export async function extractTextIntel(bytes, opts = {}) {
  const fmt = opts.fmt || "auto";
  const wantAll = opts.scanAll === true || opts.scanAll === "true";

  let form; // "mca" | "nbt"
  if (fmt === "mca") form = "mca";
  else if (fmt === "nbt") form = "nbt";
  else {
 // auto：gzip .dat 优先；否则像 MCA 就当 MCA；再否则当 NBT
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) form = "nbt";
    else if (looksLikeMCA(bytes)) form = "mca";
    else form = "nbt";
  }

  const entries = [];
  const allStrings = [];
  let note = "";
  const chunkStats = { total: 0, ok: 0, fail: 0 };

  if (form === "mca") {
    const chunks = parseMCA(bytes);
    chunkStats.total = chunks.length;
    for (const ch of chunks) {
      let parsed;
      try {
        parsed = await decompressAndParseNBT(ch.payload);
      } catch {
        chunkStats.fail++;
        continue;
      }
      chunkStats.ok++;
      const ctx = { coord: `chunk(${ch.localX},${ch.localZ})`, id: null };
      extractFromRoot(parsed.root, ctx, entries, allStrings, wantAll);
    }
    note = `Anvil MCA：已生成 chunk ${chunkStats.total}，解析成功 ${chunkStats.ok}，失败 ${chunkStats.fail}`;
  } else {
    const parsed = await decompressAndParseNBT(bytes);
    note = `单个 NBT（${parsed.note}）`;
    extractFromRoot(parsed.root, { coord: null, id: null }, entries, allStrings, wantAll);
  }

  return { form, note, chunkStats, entries, allStrings };
}

// ============================================================
// 报告渲染
// ============================================================
const KIND_LABEL = {
  sign: "告示牌 Sign",
  book: "成书 Book",
  cmd: "命令方块 Command",
  name: "自定义名 CustomName",
  item: "物品名 / Lore",
};
const KIND_ORDER = ["sign", "book", "cmd", "name", "item"];

function fmtEntryLine(e, flags) {
  const head = [];
  if (e.coord) head.push(e.coord);
  if (e.id) head.push(`[${e.id}]`);
  const rd = readableText(e.raw);
  const shown = rd === e.raw ? JSON.stringify(e.raw) : `${JSON.stringify(rd)}  «原:${JSON.stringify(e.raw)}»`;
  const mark = flags.length ? "⚑ " : "  ";
  return `  ${mark}${head.join(" ")}${head.length ? " " : ""}${e.field}: ${shown}`;
}

// ============================================================
// run
// ============================================================
async function mcTextExtractRun(text, p = {}) {
  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) {
    return "（空输入）请粘贴单个 region/*.mca（Anvil）或 .dat/.nbt 文件的 hex 或 base64。" +
      "\nMCA 内每个 chunk 是 zlib 压缩的 NBT；.dat 多为 gzip 压缩的 NBT。" +
      "\n本工具遍历 NBT 抽取告示牌 / 成书 / 命令方块 / CustomName / 物品名 Lore，并高亮 flag{...}。";
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
  if (bytes.length < 3) return "（输入过短）不足以构成 NBT / MCA。";

  let res;
  try {
    res = await extractTextIntel(bytes, { fmt: p.fmt || "auto", scanAll: p.scanAll });
  } catch (e) {
    return "解析失败：" + (e && e.message ? e.message : String(e));
  }

  const extraRe = (p.flagPattern && String(p.flagPattern).trim()) ? String(p.flagPattern).trim() : "";
  const lines = [];
  lines.push("=== Minecraft 文本情报提取 ===");
  lines.push(`输入形态: ${res.form === "mca" ? "MCA (Anvil region/entities/poi)" : "单个 NBT (.dat/.nbt)"}`);
  lines.push(res.note);
  lines.push(`共提取文本条目: ${res.entries.length}`);
  lines.push("");

 // 每条算 flag，并汇总
  const flagHits = [];
  const perEntryFlags = res.entries.map((e) => {
    const fl = findFlags(e.raw, extraRe);
    for (const f of fl) flagHits.push({ flag: f, kind: e.kind, coord: e.coord, field: e.field });
    return fl;
  });

 // flag 汇总
  const uniqFlags = [...new Set(flagHits.map((h) => h.flag))];
  if (uniqFlags.length) {
    lines.push(`--- ⚑ 命中 flag / 疑似（${uniqFlags.length}）---`);
    for (const f of uniqFlags) {
      const src = flagHits.find((h) => h.flag === f);
      const where = [KIND_LABEL[src.kind] || src.kind, src.coord || "", src.field].filter(Boolean).join(" ");
      lines.push(`  ⚑ ${f}   ← ${where}`);
    }
    lines.push("");
  } else {
    lines.push("--- 未直接命中 flag{...}（可勾选「兜底扫描全部字符串」或换自定义正则）---");
    lines.push("");
  }

 // 分组明细
  for (const kind of KIND_ORDER) {
    const idxs = [];
    res.entries.forEach((e, i) => { if (e.kind === kind) idxs.push(i); });
    if (!idxs.length) continue;
    lines.push(`--- ${KIND_LABEL[kind]}（${idxs.length}）---`);
    for (const i of idxs) lines.push(fmtEntryLine(res.entries[i], perEntryFlags[i]));
    lines.push("");
  }

 // 兜底全字符串
  if (res.allStrings.length) {
    const hits = [];
    for (const s of res.allStrings) {
      const fl = findFlags(s.text, extraRe);
      if (fl.length) hits.push({ path: s.path, text: s.text, flags: fl });
    }
    lines.push(`--- 兜底：全部 TAG_String（共 ${res.allStrings.length}，含 flag 命中 ${hits.length}）---`);
    if (hits.length) {
      for (const h of hits) lines.push(`  ⚑ ${h.path}: ${JSON.stringify(h.text)}  →  ${h.flags.join(" , ")}`);
    } else {
 // 无 flag 命中时，避免刷屏，仅提示条数
      lines.push("  （无 flag 命中；如需查看全部字符串请配合 NBT 树查看器）");
    }
    lines.push("");
  }

  if (res.form === "mca" && res.chunkStats.total === 0) {
    lines.push("提示：MCA 内无已生成 chunk（location 表全 0）。确认文件是否为空 region。");
  }

  return lines.join("\n").replace(/\n+$/, "");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "mcTextExtract",
  cat: "forensic",
  name: "Minecraft 文本情报提取",
  desc: "遍历 Minecraft Java 版存档 region/*.mca（Anvil，chunk 内 zlib NBT）或单个 .dat/.nbt，" +
    "抽取告示牌 / 成书 / 命令方块 / 实体与方块 CustomName / 物品 Name+Lore，按类型+坐标聚合，" +
    "并高亮 flag{...} 及常见变体（含 base64 解码再扫）。复用 mcSave 的 NBT 解析器，纯前端零外发",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "auto", options: [
      { value: "auto", label: "自动识别" }, { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" },
    ] },
    { key: "fmt", label: "文件类型", type: "select", default: "auto", options: [
      { value: "auto", label: "自动识别" }, { value: "mca", label: "MCA (Anvil region)" }, { value: "nbt", label: "单个 NBT (.dat/.nbt)" },
    ] },
    { key: "scanAll", label: "兜底扫描全部字符串", type: "bool", default: false },
    { key: "flagPattern", label: "自定义 flag 正则（可空）", type: "text", default: "", placeholder: "如 [Dd]ASCTF\\{[^}]*\\}" },
  ],
  run: mcTextExtractRun,
  acceptsBytes: true,
});

// 供测试导出（解析纯函数）
export { walkCompound as _walkCompound };
