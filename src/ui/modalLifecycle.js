// modalLifecycle.js — 弹层生命周期统一实现（Tab 环回 / Esc 关闭 / 遮罩关闭 / 背景惰性 / 关闭后焦点归还）。
//
// 现状：全站 8 个模态弹层各自手写关闭逻辑，焦点圈定只有 1 处具备、焦点归还只有 3 处具备，
// 遮罩关闭事件类型分裂为 mousedown 与 click 两种。本模块把上述行为收敛到唯一实现，
// 各弹层打开后调用一次 attachModalLifecycle(root, opts) 即可，不再各自维护监听器。
//
// 设计约束：
// 1. 只做「生命周期编排」，不改各弹层已有的 DOM 结构与视觉；
// 2. 幂等：release() 可重复调用；弹层节点被外部摘除时由 MutationObserver 兜底释放；
// 3. 释放顺序：先撤监听 → 再撤 inert → 最后归还焦点，保证归还目标此刻已可聚焦；
// 4. 无外部依赖，零网络请求。

// 可聚焦元素选择器（不含 disabled / tabindex=-1 / 隐藏类型）。
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** 收集容器内当前可聚焦且可见的元素（DOM 顺序）。 */
function focusableIn(container) {
  const out = [];
  for (const node of container.querySelectorAll(FOCUSABLE_SELECTOR)) {
    if (node.hasAttribute("inert") || node.closest("[inert]")) continue;
    if (node.getAttribute("aria-hidden") === "true") continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    out.push(node);
  }
  return out;
}

// 当前存活的弹层根节点栈（后进先出）。键盘事件必须挂在 document 上才可靠：
// 当焦点落在弹层之外的 body（用户点了弹层内不可聚焦的区域）时，事件传播路径不含弹层根节点，
// 挂在 root 上的监听器收不到 Esc/Tab。因此统一挂 document 捕获阶段，并用本栈保证
// 「只有最上层弹层响应」，避免叠加弹层时多个实例同时抢键。
const STACK = [];
const ACTIVE = new Map(); // root → { close, release }，供路由切换统一收尾
function isTopmost(root) {
  return STACK.length > 0 && STACK[STACK.length - 1] === root;
}

/**
 * 关闭当前所有活动弹层（路由切换/工作区重渲染前调用）。
 * 优先走各弹层自己的 onClose（保证动画、objectURL 等收尾），随后幂等 release。
 */
export function releaseAllModals() {
  const entries = [...ACTIVE.values()].reverse();
  for (const entry of entries) {
    try { entry.close(); } catch { /* 单个弹层关闭失败不阻塞其余 */ }
    try { entry.release(); } catch { /* release 幂等 */ }
  }
}

function focusNode(node) {
  if (!node || typeof node.focus !== "function") return false;
  try {
    node.focus({ preventScroll: true });
    return true;
  } catch {
    try { node.focus(); return true; } catch { return false; }
  }
}

/**
 * 把已挂载进 DOM 的弹层纳入统一生命周期。
 *
 * @param {HTMLElement} root 弹层根节点（遮罩层；必须是 document.body 的直系子孙）。
 * @param {object}   [opts]
 * @param {HTMLElement|null} [opts.dialog]        对话框容器；默认 root 内首个 role=dialog|alertdialog，否则 root 自身。
 * @param {(() => void)|null} [opts.onClose]      关闭动作（Esc / 遮罩触发时调用）。通常传组件自身关闭函数；
 *                                                省略则直接 release()（仅撤监听与 inert，不摘节点）。
 * @param {HTMLElement|string|null} [opts.initialFocus] 打开后焦点落点；字符串按选择器在 dialog 内查找。
 *                                                默认 dialog 内首个可聚焦元素，没有则把 dialog 变可聚焦并聚焦它。
 * @param {HTMLElement|null} [opts.restoreFocusTo] 关闭后返还焦点的元素；默认 attach 时的 document.activeElement。
 * @param {boolean} [opts.restoreFocus=true]      false 表示不归还焦点。
 * @param {boolean} [opts.trapFocus=true]         是否做 Tab 首尾环回。
 * @param {boolean} [opts.closeOnEscape=true]     是否处理 Esc。
 * @param {"guarded"|"always"|"none"} [opts.closeOnBackdrop="guarded"]
 *        guarded —— 仅点在遮罩本身（e.target === root）时关闭（默认，站内多数弹层口径）；
 *        always  —— 点在遮罩任意位置都关闭（图片灯箱这类「点图即关」的设计）；
 *        none    —— 不处理遮罩点击。
 * @param {boolean} [opts.inertBackground=true]   是否把弹层之外的 body 直系子节点置 inert。
 * @param {boolean} [opts.releaseOnDisconnect=true] 节点被摘除时自动 release。
 * @returns {{ release: () => void, focusFirst: () => void, readonly root: HTMLElement }}
 */
export function attachModalLifecycle(root, opts = {}) {
  const o = {
    dialog: null,
    onClose: null,
    initialFocus: null,
    restoreFocusTo: null,
    restoreFocus: true,
    trapFocus: true,
    closeOnEscape: true,
    closeOnBackdrop: "guarded",
    inertBackground: true,
    releaseOnDisconnect: true,
    ...opts,
  };
  if (!root || root.nodeType !== 1) {
    return { release() {}, focusFirst() {}, root: null };
  }

  const doc = root.ownerDocument || document;
  const dialog = o.dialog || root.querySelector("[role='dialog'],[role='alertdialog']") || root;
  const restoreTarget = o.restoreFocus
    ? (o.restoreFocusTo || doc.activeElement || null)
    : null;

  let released = false;
  let observer = null;
  const inerted = [];

  // ---- 背景惰性：弹层之外的 body 直系子节点统一置 inert ----
  if (o.inertBackground && doc.body) {
    for (const child of Array.from(doc.body.children)) {
      if (child === root || child.contains(root)) continue;
      if (child.hasAttribute("inert")) continue;
      child.setAttribute("inert", "");
      inerted.push(child);
    }
  }

  // ---- 初始焦点 ----
  function resolveInitialFocus() {
    if (typeof o.initialFocus === "string") {
      const hit = dialog.querySelector(o.initialFocus);
      if (hit) return hit;
    } else if (o.initialFocus && o.initialFocus.nodeType === 1) {
      return o.initialFocus;
    }
    const list = focusableIn(dialog);
    if (list.length) return list[0];
    if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    return dialog;
  }
  function focusFirst() {
    focusNode(resolveInitialFocus());
  }

  // ---- Tab 环回 / Esc（document 捕获阶段，仅最上层弹层响应）----
  function onKeydown(e) {
    if (released || !isTopmost(root)) return;
    if (e.key === "Escape") {
      if (!o.closeOnEscape) return;
      e.preventDefault();
      e.stopPropagation();
      requestClose();
      return;
    }
    if (e.key !== "Tab" || !o.trapFocus) return;
    const list = focusableIn(dialog);
    if (!list.length) {
      e.preventDefault();
      focusFirst();
      return;
    }
    const first = list[0];
    const last = list[list.length - 1];
    const active = doc.activeElement;
    // 焦点不在对话框内（含落在 body、或落在弹层内非对话框区域）：先把焦点拉进圈定范围。
    if (!dialog.contains(active)) {
      e.preventDefault();
      focusNode(e.shiftKey ? last : first);
      return;
    }
    if (e.shiftKey && active === first) {
      e.preventDefault();
      focusNode(last);
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      focusNode(first);
    }
  }
  doc.addEventListener("keydown", onKeydown, true);
  STACK.push(root);
  ACTIVE.set(root, { close: requestClose, release });

  // ---- 遮罩关闭（统一为 mousedown，与站内多数弹层及「按下即响应」口径一致）----
  function onBackdrop(e) {
    if (o.closeOnBackdrop === "guarded") {
      if (e.target === root) requestClose();
    } else {
      requestClose();
    }
  }
  if (o.closeOnBackdrop !== "none") root.addEventListener("mousedown", onBackdrop);

  function requestClose() {
    if (typeof o.onClose === "function") o.onClose();
    else release();
  }

  /** 释放本弹层的生命周期占用：撤监听、撤 inert、归还焦点、断观察器。幂等。 */
  function release() {
    if (released) return;
    released = true;
    doc.removeEventListener("keydown", onKeydown, true);
    const at = STACK.lastIndexOf(root);
    if (at > -1) STACK.splice(at, 1);
    ACTIVE.delete(root);
    if (o.closeOnBackdrop !== "none") root.removeEventListener("mousedown", onBackdrop);
    for (const el of inerted) el.removeAttribute("inert");
    inerted.length = 0;
    if (observer) { observer.disconnect(); observer = null; }
    if (restoreTarget && restoreTarget.isConnected) focusNode(restoreTarget);
  }

  // ---- 兜底：节点被摘除（组件自身 setTimeout 移除、路由切换等）时自动释放 ----
  if (o.releaseOnDisconnect && typeof MutationObserver === "function" && doc.body) {
    observer = new MutationObserver(() => {
      if (!root.isConnected) release();
    });
    observer.observe(doc.body, { childList: true, subtree: true });
  }

  focusFirst();

  return { release, focusFirst, root };
}