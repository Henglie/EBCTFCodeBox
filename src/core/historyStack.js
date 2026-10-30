/*
 * historyStack.js — 撤销/重做历史内核（纯内存，无 DOM、无存储、无随机、无网络）。
 *
 * 模型：entries 是「状态序列」，cursor 指向当前状态。
 *   push(s) 追加一条并把 cursor 移到末尾；undo() 把 cursor 前移并返回该处状态；
 *   redo() 后移。因此 entries[0] 是初始态，undo 到底即可回到初始态。
 *
 * 三条不可静默的语义（都有返回值或事件，调用方必须能看见）：
 *   1) 与当前状态相等 -> 不产生新条目，返回 { ok:false, reason:"equal" }。
 *   2) 容量淘汰最旧条目 -> 通过 subscribe 发 { type:"evict", dropped }。
 *   3) undo/redo 到边界 -> 返回 { ok:false, reason:"at-start"|"at-end", state:null }，不抛错。
 *
 * 快照策略：**深拷贝**（cloneState）。理由见文件末尾注释——调用方（配方链状态）
 * 是原地可变对象，结构共享会被后续 splice / 参数赋值直接改脏历史。
 *
 * 本模块不做持久化：需要落盘的调用方用 snapshot() 自行序列化。
 */

const DEFAULT_CAPACITY = 100;
const DEFAULT_COALESCE_MS = 300;

function typeTag(value) {
  return Object.prototype.toString.call(value).slice(8, -1);
}

// ---- 深拷贝：覆盖 Uint8Array / 其它 TypedArray / DataView / ArrayBuffer / Date / RegExp / Map / Set / 数组 / 纯对象 ----
// 环引用用 WeakMap 记忆，拷贝后仍保持同一引用拓扑（不会无限递归）。
function cloneState(value, seen) {
  if (value === null) return null;
  const t = typeof value;
  if (t === "function") {
    throw new TypeError("historyStack: 状态里不能含函数（" + (value.name || "anonymous") + "），请先转成可比较的数据");
  }
  if (t === "symbol") throw new TypeError("historyStack: 状态里不能含 Symbol");
  if (t !== "object") return value; // string / number / boolean / bigint / undefined

  if (seen.has(value)) return seen.get(value);
  const tag = typeTag(value);

  if (tag === "Date") return new Date(value.getTime());
  if (tag === "RegExp") return new RegExp(value.source, value.flags);
  if (tag === "ArrayBuffer") return value.slice(0);

  if (ArrayBuffer.isView(value)) {
    if (tag === "DataView") {
      return new DataView(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    }
    // TypedArray 构造器接受同类型数组即完成复制（含 byteOffset 归零）
    return new value.constructor(value);
  }

  if (tag === "Map") {
    const out = new Map();
    seen.set(value, out);
    for (const [k, v] of value) out.set(cloneState(k, seen), cloneState(v, seen));
    return out;
  }
  if (tag === "Set") {
    const out = new Set();
    seen.set(value, out);
    for (const v of value) out.add(cloneState(v, seen));
    return out;
  }

  if (Array.isArray(value)) {
    const out = [];
    seen.set(value, out);
    for (let i = 0; i < value.length; i++) out.push(cloneState(value[i], seen));
    return out;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError("historyStack: 不支持克隆 " + tag + "（只接受纯对象 / 数组 / Date / RegExp / Map / Set / 二进制视图）");
  }
  const out = Object.create(proto);
  seen.set(value, out);
  for (const k of Object.keys(value)) out[k] = cloneState(value[k], seen);
  return out;
}

function clone(value) {
  return cloneState(value, new WeakMap());
}

// ---- 默认相等：结构化比较（与 cloneState 支持的形态一一对应）----
function equalsDeep(a, b, seen) {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  const tag = typeTag(a);
  if (tag !== typeTag(b)) return false;

  if (tag === "Date") return a.getTime() === b.getTime();
  if (tag === "RegExp") return a.source === b.source && a.flags === b.flags;
  if (tag === "ArrayBuffer") {
    if (a.byteLength !== b.byteLength) return false;
    const va = new Uint8Array(a);
    const vb = new Uint8Array(b);
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
    return true;
  }
  if (ArrayBuffer.isView(a)) {
    if (tag !== typeTag(b)) return false;
    if (a.byteLength !== b.byteLength) return false;
    const va = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const vb = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    for (let i = 0; i < va.length; i++) if (va[i] !== vb[i]) return false;
    return true;
  }

  // 环引用：同一对 (a,b) 只比一次
  if (seen.has(a)) {
    if (seen.get(a).has(b)) return true;
  } else {
    seen.set(a, new WeakSet());
  }
  seen.get(a).add(b);

  if (tag === "Map") {
    if (a.size !== b.size) return false;
    const ea = Array.from(a.entries());
    const eb = Array.from(b.entries());
    for (let i = 0; i < ea.length; i++) {
      if (!equalsDeep(ea[i][0], eb[i][0], seen)) return false;
      if (!equalsDeep(ea[i][1], eb[i][1], seen)) return false;
    }
    return true;
  }
  if (tag === "Set") {
    if (a.size !== b.size) return false;
    const ea = Array.from(a.values());
    const eb = Array.from(b.values());
    for (let i = 0; i < ea.length; i++) if (!equalsDeep(ea[i], eb[i], seen)) return false;
    return true;
  }
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!equalsDeep(a[i], b[i], seen)) return false;
    return true;
  }

  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!equalsDeep(a[k], b[k], seen)) return false;
  }
  return true;
}

function defaultEquals(a, b) {
  return equalsDeep(a, b, new WeakMap());
}

/**
 * 创建一份撤销/重做历史。
 * @param {object} [opts]
 * @param {number} [opts.capacity=100] 最多保留的状态条数（含初始态），必须为 >=1 的整数
 * @param {number} [opts.coalesceMs=300] 同 label 连续 push 的合并窗口（毫秒），0 表示不合并
 * @param {(a:any,b:any)=>boolean} [opts.equals] 相等判定，默认结构化深比较
 * @param {()=>number} [opts.now] 时钟注入（测试确定性用），默认 Date.now
 */
export function createHistory(opts) {
  if (opts !== undefined && (opts === null || typeof opts !== "object")) {
    throw new TypeError("createHistory: opts 必须是对象，收到 " + typeTag(opts));
  }
  const o = opts || {};

  const capacity = o.capacity === undefined ? DEFAULT_CAPACITY : o.capacity;
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError("createHistory: capacity 必须是 >=1 的整数，收到 " + String(capacity));
  }
  const coalesceMs = o.coalesceMs === undefined ? DEFAULT_COALESCE_MS : o.coalesceMs;
  if (typeof coalesceMs !== "number" || !Number.isFinite(coalesceMs) || coalesceMs < 0) {
    throw new RangeError("createHistory: coalesceMs 必须是 >=0 的有限数，收到 " + String(coalesceMs));
  }
  const equals = o.equals === undefined ? defaultEquals : o.equals;
  if (typeof equals !== "function") throw new TypeError("createHistory: equals 必须是函数");
  const now = o.now === undefined ? () => Date.now() : o.now;
  if (typeof now !== "function") throw new TypeError("createHistory: now 必须是返回毫秒数的函数");

  let entries = [];   // [{ state, label, at, updatedAt }]
  let cursor = -1;    // 当前状态下标；-1 = 空历史
  let lastPushLabel = null;
  let lastPushAt = -Infinity;
  let lastPushIndex = -1;
  const listeners = new Set();

  function emit(evt) {
    for (const fn of Array.from(listeners)) {
      try {
        fn(evt);
      } catch (err) {
        // 订阅者抛错不能中断内核，但必须留下痕迹（不许静默吞掉）
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("[historyStack] 订阅回调抛错，已跳过：" + (err && err.message ? err.message : String(err)));
        }
      }
    }
  }

  function resetCoalesce() {
    lastPushLabel = null;
    lastPushAt = -Infinity;
    lastPushIndex = -1;
  }

  /**
   * 记录一份状态快照。
   * @returns {{ok:boolean, action?:string, reason?:string, size:number, cursor:number, evicted?:number, truncated?:number}}
   */
  function push(state, label) {
    if (state === undefined) {
      throw new TypeError("historyStack.push: state 不能是 undefined（要记录空状态请显式传 null）");
    }
    const lbl = label === undefined || label === null ? "" : String(label);
    const at = now();

    if (cursor >= 0 && equals(entries[cursor].state, state)) {
      return { ok: false, action: "noop", reason: "equal", size: entries.length, cursor };
    }

    // 合并窗口：label 相同、距上次 push 不超过 coalesceMs、且光标仍在末尾（undo/redo 之后一律不合并）。
    // 合并时只覆盖当前条目的 state，条目本身不新增 —— 于是 undo 的目标仍是合并开始之前的那个状态，
    // 即「合并保留最早的状态作为 undo 目标」。
    // 首条（cursor===0）永不合并：否则初始态会被逐字输入覆盖掉，undo 将无目标可回。
    const canCoalesce =
      cursor >= 1 &&
      cursor === entries.length - 1 &&
      cursor === lastPushIndex &&
      lastPushLabel === lbl &&
      at - lastPushAt <= coalesceMs;

    if (canCoalesce) {
      const entry = entries[cursor];
      entry.state = clone(state);
      entry.updatedAt = at;
      lastPushAt = at;
      emit({ type: "coalesce", index: cursor, label: lbl, size: entries.length });
      return { ok: true, action: "coalesce", size: entries.length, cursor };
    }

    // undo 之后 push：先截断 redo 分支（丢弃 cursor 之后的所有条目）
    let truncated = 0;
    if (cursor < entries.length - 1) {
      truncated = entries.length - 1 - cursor;
      entries = entries.slice(0, cursor + 1);
      emit({ type: "truncate", dropped: truncated, size: entries.length });
    }

    entries.push({ state: clone(state), label: lbl, at, updatedAt: at });
    cursor = entries.length - 1;
    lastPushLabel = lbl;
    lastPushAt = at;
    lastPushIndex = cursor;

    let evicted = 0;
    if (entries.length > capacity) {
      evicted = entries.length - capacity;
      entries = entries.slice(evicted);
      cursor -= evicted;
      lastPushIndex -= evicted;
      emit({ type: "evict", dropped: evicted, capacity, size: entries.length });
    }

    emit({ type: "push", index: cursor, label: lbl, size: entries.length, truncated });
    return { ok: true, action: "push", size: entries.length, cursor, evicted, truncated };
  }

  /** 撤销一格。边界返回 { ok:false, reason, state:null }，不抛错。 */
  function undo() {
    if (cursor < 0) {
      return { ok: false, reason: "empty", state: null, index: -1, label: "", size: 0 };
    }
    if (cursor === 0) {
      return { ok: false, reason: "at-start", state: null, index: 0, label: entries[0].label, size: entries.length };
    }
    cursor -= 1;
    resetCoalesce();
    const entry = entries[cursor];
    emit({ type: "undo", index: cursor, label: entry.label, size: entries.length });
    return { ok: true, state: clone(entry.state), index: cursor, label: entry.label, size: entries.length };
  }

  /** 重做一格。边界返回 { ok:false, reason, state:null }，不抛错。 */
  function redo() {
    if (cursor < 0) {
      return { ok: false, reason: "empty", state: null, index: -1, label: "", size: 0 };
    }
    if (cursor >= entries.length - 1) {
      return { ok: false, reason: "at-end", state: null, index: cursor, label: entries[cursor].label, size: entries.length };
    }
    cursor += 1;
    resetCoalesce();
    const entry = entries[cursor];
    emit({ type: "redo", index: cursor, label: entry.label, size: entries.length });
    return { ok: true, state: clone(entry.state), index: cursor, label: entry.label, size: entries.length };
  }

  /** 当前状态快照（深拷贝）；空历史返回 null。 */
  function peek() {
    return cursor < 0 ? null : clone(entries[cursor].state);
  }

  function canUndo() {
    return cursor > 0;
  }
  function canRedo() {
    return cursor >= 0 && cursor < entries.length - 1;
  }
  function size() {
    return entries.length;
  }

  function clear() {
    entries = [];
    cursor = -1;
    resetCoalesce();
    emit({ type: "clear", size: 0 });
    return { ok: true, size: 0, cursor: -1 };
  }

  /** 全量导出（深拷贝），供上层做持久化 / 调试。 */
  function snapshot() {
    return {
      size: entries.length,
      cursor,
      capacity,
      coalesceMs,
      canUndo: canUndo(),
      canRedo: canRedo(),
      entries: entries.map((e) => ({
        label: e.label,
        at: e.at,
        updatedAt: e.updatedAt,
        state: clone(e.state),
      })),
    };
  }

  /** 订阅内核事件，返回取消订阅函数。 */
  function subscribe(fn) {
    if (typeof fn !== "function") throw new TypeError("historyStack.subscribe: 回调必须是函数");
    listeners.add(fn);
    return function unsubscribe() {
      listeners.delete(fn);
    };
  }

  return { push, undo, redo, peek, canUndo, canRedo, size, clear, snapshot, subscribe };
}

/*
 * 为什么是深拷贝而不是结构共享
 * ---------------------------------
 * 本项目的配方链状态是原地可变对象：recipeView 直接 rState.nodes.push(...) /
 * splice(...) / node.params[key] = v，且 rState 是模块级单例、被多处闭包共享。
 * 若历史只存引用（结构共享），后续任何一次原地修改都会同时改掉历史里的旧状态，
 * undo 会「回到未来」——这不是理论风险，而是这类单例状态的常态。
 * 结构共享只有在全链路不可变（每次修改都新建对象）时才成立，改造成本与回归面远超本卡范围。
 *
 * 深拷贝的代价：每次 push 复制一份状态（配方链是几十个节点的小对象，量级可接受），
 * 二进制（Uint8Array）按字节复制；共享同一 ArrayBuffer 的多个视图在拷贝后各自独立，
 * 这一差异已在本文件注释中写明。
 */
