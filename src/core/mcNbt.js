/*
 * mcNbt.js — 通用 NBT 树查看器（cat:'analysis'，单向 run），MVP 第 5 项。
 *
 * 浏览器版 NBTExplorer：把任意 Minecraft Java 版 NBT（level.dat / *.dat /
 * playerdata / 结构方块 .nbt / hotbar.nbt 等）解压后完整转储为缩进折叠的
 * 可读文本树。每个节点显示 tag 类型名（TAG_Compound / TAG_List / TAG_String
 * / TAG_Long / …）、key、值；List 显示元素类型与长度；Long / LongArray 用
 * BigInt 原样打印不丢精度；大数组（Byte/Int/LongArray）截断显示前 N 项 + 省略。
 *
 * 复用 mcSave.js 的解析器（parseNBT / decompressAndParseNBT，自写大端序 NBT
 * 走原生 DecompressionStream 解 gzip/zlib/裸 NBT），复用 pcapParse.js 的
 * inputToBytes 接 hex/base64/auto 文本输入。本卡不重写解析器。纯前端零外发
 * 件内自注册。
 *
 * NBT 树结构约定（来自 mcSave.js）：
 * root = { name, type, value }。
 * Compound value = { key: { __t, v }, __nbtCompound:true }。
 * List value = 数组，带 _elemType（元素 tag 类型）；元素为裸 payload。
 * Byte/Short/Int = number；Long = BigInt；Float/Double = number；
 * ByteArray = Uint8Array（原始字节）；String = string；
 * IntArray = number[]；LongArray = BigInt[]。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./pcapParse.js";
import { decompressAndParseNBT } from "./mcSave.js";

// tag type → 名（与 mcSave.js 一致；下标即 tag id）
const TAG_NAMES = [
  "End", "Byte", "Short", "Int", "Long", "Float", "Double",
  "ByteArray", "String", "List", "Compound", "IntArray", "LongArray",
];
function tagName(t) {
  return "TAG_" + (TAG_NAMES[t] !== undefined ? TAG_NAMES[t] : ("?" + t));
}

// ByteArray 在 NBT 语义里是有符号 byte（NBTExplorer 也按有符号显示）
function toSignedByte(b) { return b < 128 ? b : b - 256; }

// ============================================================
// 路径过滤：形如 "Data.Player.Inventory"，逐段进入 Compound key；
// 数字段（或 key[3] 中的 [3]）视为 List 索引。命中则只转储该子树。
// ============================================================
function splitPath(pathStr) {
 // 支持 "a.b.c" 与 "a[0].b[2]"：先按 . 拆，再把每段里的 [n] 拆成独立索引段。
  const segs = [];
  for (const rawSeg of String(pathStr).split(".")) {
    const seg = rawSeg.trim();
    if (!seg) continue;
    const m = seg.match(/^([^\[\]]*)((?:\[\d+\])*)$/);
    if (!m) { segs.push({ kind: "key", val: seg }); continue; }
    if (m[1]) segs.push({ kind: "key", val: m[1] });
    if (m[2]) {
      const idxs = m[2].match(/\[(\d+)\]/g) || [];
      for (const ix of idxs) segs.push({ kind: "idx", val: Number(ix.slice(1, -1)) });
    }
  }
  return segs;
}

// 从 root 沿路径解析 → { t, key, v } 或 { error }
function resolvePath(root, pathStr) {
  let curT = root.type, curV = root.value;
  let curKey = root.name ? root.name : "(root)";
  const segs = splitPath(pathStr);
  const walked = [];
  for (const seg of segs) {
    if (seg.kind === "key") {
      if (curT !== 10 || !curV || typeof curV !== "object") {
        return { error: `路径 "${walked.join(".")}" 处不是 Compound，无法进入键 "${seg.val}"。` };
      }
      const e = curV[seg.val];
      if (!e || typeof e !== "object" || !("__t" in e)) {
        const avail = Object.keys(curV).filter((k) => k !== "__nbtCompound");
        return { error: `键 "${seg.val}" 不存在。当前层可用键：${avail.length ? avail.join(", ") : "(空)"}` };
      }
      curT = e.__t; curV = e.v; curKey = seg.val;
      walked.push(seg.val);
    } else {
      if (curT !== 9 || !Array.isArray(curV)) {
        return { error: `路径 "${walked.join(".")}" 处不是 List，无法用索引 [${seg.val}]。` };
      }
      if (seg.val < 0 || seg.val >= curV.length) {
        return { error: `List 索引 [${seg.val}] 越界（长度 ${curV.length}）。` };
      }
      curT = curV._elemType; curV = curV[seg.val]; curKey = `[${seg.val}]`;
      walked.push(`[${seg.val}]`);
    }
  }
  return { t: curT, key: curKey, v: curV };
}

// ============================================================
// 转储：把 (type, key, value) 渲染为缩进文本行，push 进 lines。
// ============================================================
function dumpNode(t, key, v, indent, depth, opts, lines, counter) {
  if (++counter.n > opts.maxNodes) {
    if (!counter.capped) { lines.push("  ".repeat(indent) + "… （已达节点上限 " + opts.maxNodes + "，其余省略）"); counter.capped = true; }
    return;
  }
  const pad = "  ".repeat(indent);
  const keyStr = key === null || key === undefined ? "" : (typeof key === "number" ? `[${key}]` : `'${key}'`);
  const label = keyStr ? `${tagName(t)} ${keyStr}` : tagName(t);

  switch (t) {
    case 0:
      lines.push(`${pad}${label}`);
      return;
    case 1: case 2: case 3: // Byte / Short / Int
      lines.push(`${pad}${label}: ${v}`);
      return;
    case 4: // Long (BigInt) — 原样打印不丢精度
      lines.push(`${pad}${label}: ${v.toString()}`);
      return;
    case 5: case 6: // Float / Double
      lines.push(`${pad}${label}: ${v}`);
      return;
    case 8: // String
      lines.push(`${pad}${label}: ${JSON.stringify(v)}`);
      return;
    case 7: { // ByteArray（有符号 byte）
      const n = v.length;
      const lim = Math.min(n, opts.maxArray);
      const parts = [];
      for (let i = 0; i < lim; i++) parts.push(toSignedByte(v[i]));
      const more = n > lim ? ` … (+${n - lim} 项省略)` : "";
      lines.push(`${pad}${label}: ${n} 项 [${parts.join(", ")}${more}]`);
      return;
    }
    case 11: { // IntArray
      const n = v.length;
      const lim = Math.min(n, opts.maxArray);
      const more = n > lim ? ` … (+${n - lim} 项省略)` : "";
      lines.push(`${pad}${label}: ${n} 项 [${v.slice(0, lim).join(", ")}${more}]`);
      return;
    }
    case 12: { // LongArray（BigInt[]）— 原样打印不丢精度
      const n = v.length;
      const lim = Math.min(n, opts.maxArray);
      const shown = v.slice(0, lim).map((x) => x.toString());
      const more = n > lim ? ` … (+${n - lim} 项省略)` : "";
      lines.push(`${pad}${label}: ${n} 项 [${shown.join(", ")}${more}]`);
      return;
    }
    case 9: { // List
      const et = v._elemType;
      const n = v.length;
      lines.push(`${pad}${label}: ${n} 项 <${tagName(et)}>`);
      if (n === 0) return;
      if (depth >= opts.maxDepth) { lines.push(`${pad}  … （已达深度上限 ${opts.maxDepth}）`); return; }
      const lim = Math.min(n, opts.maxArray);
      for (let i = 0; i < lim; i++) dumpNode(et, i, v[i], indent + 1, depth + 1, opts, lines, counter);
      if (n > lim) lines.push(`${pad}  … (+${n - lim} 项省略)`);
      return;
    }
    case 10: { // Compound
      const keys = Object.keys(v).filter((k) => k !== "__nbtCompound");
      lines.push(`${pad}${label}: ${keys.length} 项`);
      if (keys.length === 0) return;
      if (depth >= opts.maxDepth) { lines.push(`${pad}  … （已达深度上限 ${opts.maxDepth}）`); return; }
      for (const k of keys) dumpNode(v[k].__t, k, v[k].v, indent + 1, depth + 1, opts, lines, counter);
      return;
    }
    default:
      lines.push(`${pad}${label}: (未知 tag ${t})`);
      return;
  }
}

// ============================================================
// run
// ============================================================
async function mcNbtViewRun(text, p = {}) {
  if ((!text || !String(text).trim()) && !(p && p.rawBytes && p.rawBytes.length)) {
    return "（空输入）请粘贴 NBT 文件（level.dat / *.dat / playerdata / *.nbt 等）的 hex 或 base64 编码。" +
      "\n支持 gzip / zlib / 裸 NBT 三种存储；解压后完整转储为可读文本树。";
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
  if (!bytes || bytes.length < 3) return "（输入过短）不足以构成一段 NBT（至少需类型+长度头）。";

  let parsed;
  try {
    parsed = await decompressAndParseNBT(bytes);
  } catch (e) {
    return "解析失败：" + (e && e.message ? e.message : String(e)) +
      "\n（确认输入是 gzip/zlib/裸 NBT；若是 region *.mca 请用「Minecraft 文本情报提取」。）";
  }

  const { root, note } = parsed;

 // 参数归一
  let maxArray = parseInt(p.maxArray, 10);
  if (!Number.isFinite(maxArray) || maxArray < 1) maxArray = 64;
  let maxDepth = parseInt(p.maxDepth, 10);
  if (!Number.isFinite(maxDepth) || maxDepth < 1) maxDepth = 64;
  const opts = { maxArray, maxDepth, maxNodes: 200000 };

  const lines = [];
  lines.push("=== Minecraft NBT 树查看器（Java 版大端序 NBT）===");
  lines.push(`解压: ${note}`);
  lines.push(`根 tag: ${tagName(root.type)}${root.name ? ` "${root.name}"` : "（空名）"}`);
  lines.push(`数组截断上限: ${maxArray} 项 / 最大深度: ${maxDepth}`);

  const pathStr = (p.path && String(p.path).trim()) ? String(p.path).trim() : "";
  const counter = { n: 0, capped: false };

  if (pathStr) {
    const r = resolvePath(root, pathStr);
    if (r.error) {
      lines.push("");
      lines.push(`--- 路径过滤 "${pathStr}" 未命中 ---`);
      lines.push("  " + r.error);
      return lines.join("\n");
    }
    lines.push("");
    lines.push(`--- 子树 "${pathStr}" ---`);
    dumpNode(r.t, r.key, r.v, 0, 0, opts, lines, counter);
  } else {
    lines.push("");
    lines.push("--- 完整 NBT 树 ---");
    dumpNode(root.type, root.name || null, root.value, 0, 0, opts, lines, counter);
  }

  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "mcNbtView",
  cat: "forensic",
  name: "Minecraft NBT 树查看器",
  desc: "浏览器版 NBTExplorer：把任意 Minecraft Java 版 NBT（level.dat / *.dat / " +
    "playerdata / 结构 .nbt 等，gzip/zlib/裸均可）解压后完整转储为缩进折叠的可读文本树。" +
    "显示每节点 tag 类型名 / key / 值，List 标元素类型与长度，Long/LongArray 用 BigInt 不丢精度，" +
    "大数组截断显示。支持路径过滤定位子树。复用 mcSave 的 NBT 解析器，纯前端零外发",
  params: [
    { key: "inputEnc", label: "输入编码", type: "select", default: "auto", options: [
      { value: "auto", label: "自动识别" }, { value: "hex", label: "Hex 十六进制" }, { value: "base64", label: "Base64" },
    ] },
    { key: "path", label: "路径过滤（可空，如 Data.Player.Inventory）", type: "text", default: "", placeholder: "Data.Player.Inventory 或 a[0].b" },
    { key: "maxArray", label: "数组截断上限", type: "number", default: 64 },
    { key: "maxDepth", label: "最大深度", type: "number", default: 64 },
  ],
  run: mcNbtViewRun,
  acceptsBytes: true,
});

// 供测试导出
export { splitPath as _splitPath, resolvePath as _resolvePath };
