/*
 * customImplStore.js — MT72 自定义实现的持久化与方案管理（纯数据层，零 DOM）。
 *
 * 为什么放 core 而不是 ui：`activeCustomImplIds()`（magic/穷举排除用）与 Worker 侧都要读它，
 * 让 UI 持有这份状态会让 core 反向依赖 UI。先例：core/decodeProfile.js 同样在 core 里管 localStorage。
 *
 * 存储布局（单键，便于整体导出/迁移）：
 *   localStorage["ebctf.customImpl.v1"] = {
 *     impls:   { <opId>: { enabled:boolean, code:string, ts:number } },   // 每个 op 当前生效的实现
 *     schemes: { <名称>: { opId:string|null, code:string, note:string, ts:number } }  // 命名方案库
 *   }
 * 方案管理的交互契约对齐 core/decodeProfile.js 的 listProfiles/loadProfile/saveProfile/
 * deleteProfile/exportProfiles/importProfiles（MT72 需求 §6：复用那套 UI 模式，别另造一套）。
 */

const STORE_KEY = "ebctf.customImpl.v1";
const LEGACY_PREFIX = "ebctf.customImpl."; // A1 首版：每 op 一个键，读到就并进新布局

function emptyStore() {
  return { impls: {}, schemes: {} };
}

function lsGet(key) {
  try { return typeof localStorage === "undefined" ? null : localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, val) {
  try { if (typeof localStorage !== "undefined") localStorage.setItem(key, val); } catch { /* 配额满/隐私模式忽略 */ }
}
function lsDel(key) {
  try { if (typeof localStorage !== "undefined") localStorage.removeItem(key); } catch { /* ignore */ }
}

function now() {
  try { return Date.now(); } catch { return 0; }
}

/** 一次性迁移：把首版的 per-op 键并进单键布局后删除旧键。 */
function migrateLegacy(store) {
  let moved = 0;
  try {
    if (typeof localStorage === "undefined") return 0;
    const stale = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || k === STORE_KEY || !k.startsWith(LEGACY_PREFIX)) continue;
      const opId = k.slice(LEGACY_PREFIX.length);
      if (!opId || opId.includes(".")) continue; // 只认 "前缀+opId" 这一种形状
      try {
        const o = JSON.parse(localStorage.getItem(k) || "null");
        if (o && typeof o === "object" && typeof o.code === "string") {
          if (!store.impls[opId]) {
            store.impls[opId] = { enabled: !!o.enabled, code: o.code, ts: now() };
            moved++;
          }
        }
      } catch { /* 坏数据直接丢 */ }
      stale.push(k);
    }
    for (const k of stale) lsDel(k);
  } catch { /* 环境不支持枚举则跳过 */ }
  return moved;
}

let _migrated = false;

function readStore() {
  let store = emptyStore();
  const raw = lsGet(STORE_KEY);
  if (raw) {
    try {
      const o = JSON.parse(raw);
      if (o && typeof o === "object") {
        store.impls = o.impls && typeof o.impls === "object" ? o.impls : {};
        store.schemes = o.schemes && typeof o.schemes === "object" ? o.schemes : {};
      }
    } catch { store = emptyStore(); }
  }
  if (!_migrated) {
    _migrated = true;
    if (migrateLegacy(store)) writeStore(store);
  }
  return store;
}

function writeStore(store) {
  lsSet(STORE_KEY, JSON.stringify(store));
}

// ============ 每个 op 的当前实现 ============

/** 读某 op 的自定义实现。返回 { enabled, code } 或 null（从未存过）。 */
export function getCustomImpl(opId) {
  if (!opId) return null;
  const rec = readStore().impls[opId];
  if (!rec) return null;
  return { enabled: !!rec.enabled, code: typeof rec.code === "string" ? rec.code : "" };
}

/** 存某 op 的自定义实现（enabled 与 code 一起写，调用方自己保留未变的那项）。 */
export function saveCustomImpl(opId, { enabled, code } = {}) {
  if (!opId) return false;
  const store = readStore();
  store.impls[opId] = { enabled: !!enabled, code: String(code || ""), ts: now() };
  writeStore(store);
  return true;
}

/** 只翻开关，不动代码（勾选框用）。 */
export function setEnabled(opId, enabled) {
  const cur = getCustomImpl(opId) || { code: "" };
  return saveCustomImpl(opId, { enabled: !!enabled, code: cur.code });
}

/** 删某 op 的自定义实现。 */
export function clearCustomImpl(opId) {
  const store = readStore();
  if (store.impls[opId]) { delete store.impls[opId]; writeStore(store); return true; }
  return false;
}

/**
 * 真正生效（勾选 + 有非空代码）的 op id 列表。
 * magic / exhaustiveDecode 的 excludeOps 直接吃这个：勾了自定义实现的 op 不进自动解码
 * （原版算法的结果会误导用户，且自动流程不该跑用户代码）。
 */
export function listEnabledOpIds() {
  const out = [];
  const impls = readStore().impls;
  for (const [opId, rec] of Object.entries(impls)) {
    if (rec && rec.enabled && typeof rec.code === "string" && rec.code.trim()) out.push(opId);
  }
  return out.sort();
}

/** 全部有记录的 op（含停用的），UI 做「已保存的实现」列表用。 */
export function listImplOpIds() {
  return Object.keys(readStore().impls).sort();
}

// ============ 命名方案库（对齐 decodeProfile 的方案管理契约） ============

/** 方案名列表（字典序）。 */
export function listSchemes() {
  return Object.keys(readStore().schemes).sort();
}

/** 读方案：返回 { opId, code, note } 或 null。 */
export function loadScheme(name) {
  const rec = readStore().schemes[String(name || "").trim()];
  if (!rec) return null;
  return {
    opId: rec.opId || null,
    code: typeof rec.code === "string" ? rec.code : "",
    note: typeof rec.note === "string" ? rec.note : "",
  };
}

/** 存/覆盖方案。name 为空则忽略。 */
export function saveScheme(name, { opId, code, note } = {}) {
  const n = String(name || "").trim();
  if (!n) return false;
  const store = readStore();
  store.schemes[n] = {
    opId: opId ? String(opId) : null,
    code: String(code || ""),
    note: String(note || ""),
    ts: now(),
  };
  writeStore(store);
  return true;
}

/** 删方案。 */
export function deleteScheme(name) {
  const store = readStore();
  const n = String(name || "").trim();
  if (store.schemes[n]) { delete store.schemes[n]; writeStore(store); return true; }
  return false;
}

/** 导出全部方案为 JSON 字符串（用户存文件 / 贴给队友）。 */
export function exportSchemes() {
  const store = readStore();
  return JSON.stringify({ kind: "ebctf.customImpl.schemes", version: 1, schemes: store.schemes }, null, 2);
}

/**
 * 导入方案 JSON（同名覆盖）。返回导入条数。
 * ⚠ 调用方必须先向用户提示「这是可执行代码，只导入你信任的来源」（MT72 安全约束）。
 * 兼容两种形状：{schemes:{…}} 和裸 {名称:{code…}}。坏 JSON / 空内容抛错，不静默吞。
 */
export function importSchemes(json) {
  let o;
  try { o = JSON.parse(String(json)); } catch (e) { throw new Error("方案 JSON 解析失败：" + (e.message || e)); }
  if (!o || typeof o !== "object") throw new Error("方案 JSON 内容不是对象");
  const src = o.schemes && typeof o.schemes === "object" ? o.schemes : o;
  const store = readStore();
  let n = 0;
  for (const [name, rec] of Object.entries(src)) {
    if (!name || !rec || typeof rec !== "object") continue;
    const code = typeof rec.code === "string" ? rec.code : null;
    if (code == null) continue;
    store.schemes[name] = {
      opId: rec.opId ? String(rec.opId) : null,
      code,
      note: typeof rec.note === "string" ? rec.note : "",
      ts: now(),
    };
    n++;
  }
  if (!n) throw new Error("方案 JSON 里没有可导入的条目（每条需含 code 字段）");
  writeStore(store);
  return n;
}

/** 清空全部（重置入口 / 自检用）。 */
export function clearAll() {
  lsDel(STORE_KEY);
  _migrated = true; // 避免 clearAll 后又把旧键迁回来
}

export default {
  getCustomImpl, saveCustomImpl, setEnabled, clearCustomImpl,
  listEnabledOpIds, listImplOpIds,
  listSchemes, loadScheme, saveScheme, deleteScheme, exportSchemes, importSchemes, clearAll,
};
