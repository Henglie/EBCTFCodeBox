/*
 * lazyCore.js — core 惰载内核。
 *
 * 职责：
 *  - ensureOp(id)/ensureCat(catId)/ensureAll()：按需动态 import 算法源文件（去重、失败可重试）。
 *  - preloadIdle()：S2 热点批（CTF_HOT ∪ 导航默认类）在 requestIdleCallback 里排队预载。
 *  - stub 语义：加载前 registry 里是 __stub 占位（列表/搜索可用）；文件求值时 register()
 *    原位升级，detect 补丁合并保留（见 registry.js）。
 *
 * 红线：本模块不做 UI/DOM（算法层零 UI 依赖）；Worker 侧继续走 registerAll 全量 eager，
 * 与主线程注册集合最终一致（单一事实源=registerAll 清单）。
 */
import { OP_FILE_MAP, LAZY_FILE_ORDER } from "./lazyTables.generated.js";
import { OPS } from "./registry.js";
import { applyDetectPatches as replay1 } from "./detectExt.js";
import { applyDetectPatches as replay2 } from "./detectExt2.js";
import { applyDetectPatches as replay3 } from "./detectExt3.js";
import { applyDetectPatches as replay4 } from "./detectSupplement.js";

const _loading = new Map(); // file → Promise<void>
const _failed = new Set();

function _replayDetects() {
  // 四件套循环幂等（缺 detect 才补），重放安全；补丁器对 __stub 让位，故必须在真实 op 落地后补
  replay1(); replay2(); replay3(); replay4();
}

function importFile(file) {
  if (!_loading.has(file)) {
    _loading.set(
      file,
      import(file)
        .then(() => { _failed.delete(file); _replayDetects(); })
        .catch((e) => { _loading.delete(file); _failed.add(file); throw e; })
    );
  }
  return _loading.get(file);
}

/** 确保 op 已加载（stub 已升级为真实 op）。加载失败抛原始错误（调用方负责提示/重试）。 */
export async function ensureOp(id) {
  const f = OP_FILE_MAP[id];
  if (!f) return; // 未知 id（插件/旧 id）交给 getOp 的 LEGACY 兜底
  const op = OPS.find((o) => o.id === id);
  if (op && !op.__stub) return;
  await importFile(f);
}

/** 确保某分类下全部 op 就绪（进入分类页时）。 */
export async function ensureCat(catId, catOf) {
  const files = new Set();
  for (const op of OPS) {
    if (op.cat !== catId) continue;
    const f = OP_FILE_MAP[op.id];
    if (f && (op.__stub || _failed.has(f))) files.add(f);
  }
  await Promise.all([...files].map(importFile));
}

/** 全量加载（穷举视图/配方/一键解码主线程兜底等重面）。幂等。 */
export async function ensureAll() {
  await Promise.all(LAZY_FILE_ORDER.map(importFile));
}

/** S2 闲时预载：按序排队，不抢占首屏（每片之间让出主线程）。 */
export function preloadIdle(fileList) {
  const list = (fileList && fileList.length ? fileList : LAZY_FILE_ORDER).filter((f) => !_loading.has(f));
  let i = 0;
  const step = () => {
    if (i >= list.length) return;
    const f = list[i++];
    importFile(f).catch(() => {}); // 预载失败静默（真正使用时 ensureOp 再抛）
    schedule();
  };
  const schedule = () => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(step, { timeout: 2000 });
    else setTimeout(step, 60);
  };
  schedule();
}

/** 诊断：当前加载进度（工具/调试用，非 UI 依赖）。 */
export function lazyStats() {
  let stub = 0, real = 0;
  for (const o of OPS) o.__stub ? stub++ : real++;
  return { total: OPS.length, real, stub, inflight: _loading.size, failed: [..._failed] };
}
