/*
 * T525 扩展安全目录（extension-safe catalog）· 候选
 *
 * 模型：**正向白名单**。目录只显式列出 opId；目录外一律拒绝，不存在「默认放行」。
 * 入选规则（与 T524 目录文档 §4/§5 一致）：
 *   cat ∈ {base, text, radix} ∧ !requiresBridge ∧ direction ∈ {both,decode,encode} ∧ ioKind === "text"
 * 该规则天然排除：报告型 op（jsteg 等，cat=stego）、文件/EXE/多材料 op（forensic/asym 等）、
 * WASM 懒加载 op（bkcrack/sevenzip 在 analysis/forensic）、桥 op（bridgeStego 等）。
 *
 * 纯只读：只 import 产品 src/core 的注册表，不写任何产品文件。
 */
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { scanClosureCsp } from "./cspClosure.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 候选文件当前位于证据目录；集成后由 M 放到目标位置，可用 EBCTF_CORE_DIR 覆盖。
const CORE = process.env.EBCTF_CORE_DIR || path.resolve(HERE, "..", "..", "..", "src", "core");

export const CATALOG_VERSION = "2026-09-19.2";
export const DEFAULT_FIVE = ["base64", "base16", "url", "htmlEntity", "unicodeEscape"];
const SAFE_CATS = new Set(["base", "text", "radix"]);
const TEXT_DIRECTIONS = new Set(["both", "decode", "encode"]);

let _reg = null;
async function loadRegistry() {
  if (_reg) return _reg;
  await import(pathToFileURL(path.join(CORE, "registerAll.js")).href);
  _reg = await import(pathToFileURL(path.join(CORE, "registry.js")).href);
  return _reg;
}

/** 方向口径：both / decode / encode / run / none */
export function directionOf(op) {
  if (op.encode && op.decode) return "both";
  if (op.decode && !op.encode) return "decode";
  if (op.encode && !op.decode) return "encode";
  if (op.run && !op.encode && !op.decode) return "run";
  return "none";
}

/** op 的源文件绝对路径（来自 registry 的 callerModuleUrl）。取不到返回 null。 */
function sourceAbsOf(op) {
  const sf = op && op.sourceFile;
  if (!sf) return null;
  try { return sf.startsWith("file:") ? fileURLToPath(sf) : sf; } catch { return null; }
}

/**
 * 构建扩展安全目录。返回 { catalogVersion, defaultFive, ops, byId, excluded }。
 * 每次调用重新扫描注册表（不缓存 op 列表，避免运行期增删 op 后目录失真）。
 *
 * **入选 = 分类/方向/IO 过滤 ∧ 闭包内无 CSP 硬阻断**（T525 补缺）。
 * 后者是必须的一层：分类规则不足以证明 CSP-safe（反例 `jsfuck`）。
 */
export async function buildCatalog() {
  const reg = await loadRegistry();
  const ops = [];
  const excluded = [];
  const scanCache = new Map(); // 入口绝对路径 → 扫描结果
  for (const op of reg.OPS) {
    if (!SAFE_CATS.has(op.cat)) { excluded.push({ opId: op.id, cat: op.cat, reason: "cat 不在 base/text/radix" }); continue; }
    if (op.requiresBridge) { excluded.push({ opId: op.id, cat: op.cat, reason: "requiresBridge" }); continue; }
    const direction = directionOf(op);
    if (!TEXT_DIRECTIONS.has(direction)) { excluded.push({ opId: op.id, cat: op.cat, reason: `direction=${direction}` }); continue; }
    if (reg.inferIoMode(op) !== "text") { excluded.push({ opId: op.id, cat: op.cat, reason: "ioKind!=text" }); continue; }

    // ---- T525 补缺：CSP 闭包硬阻断层 ----
    const entry = sourceAbsOf(op);
    if (!entry) { excluded.push({ opId: op.id, cat: op.cat, reason: "无法定位源文件（CSP 不可证）" }); continue; }
    let scan = scanCache.get(entry);
    if (!scan) { scan = scanClosureCsp(entry); scanCache.set(entry, scan); }
    if (!scan.ok) {
      excluded.push({
        opId: op.id, cat: op.cat,
        reason: "CSP 硬阻断: " + scan.hits.map((h) => `${h.risk}@${h.file}:${h.line}`).join("; "),
      });
      continue;
    }

    ops.push({
      opId: op.id,
      cat: op.cat,
      direction,
      ioKind: "text->text",
      needsWasm: false,
      requiresBridge: false,
      cspSafe: true,              // 已由闭包扫描证明：闭包内无 new Function/eval/Function(/动态 import(
      cspHardBlocks: [],
      paramCount: (op.params || []).length,
      params: (op.params || []).map((p) => ({
        key: p.key,
        type: p.type || "text",
        default: p.default,
      })),
      family: op.family ?? null,
      acceptsBytes: !!op.acceptsBytes,
    });
  }
  ops.sort((a, b) => (a.cat === b.cat ? a.opId.localeCompare(b.opId) : a.cat.localeCompare(b.cat)));
  const byId = new Map(ops.map((o) => [o.opId, o]));
  return {
    catalogVersion: CATALOG_VERSION,
    defaultFive: [...DEFAULT_FIVE],
    ops,
    byId,
    excluded,
  };
}

/** 目录内精确匹配校验（不接受前缀/通配/大小写折叠/二次解码变体）。 */
export function resolveOp(catalog, opId) {
  if (typeof opId !== "string") return null;
  return catalog.byId.get(opId) || null;
}
