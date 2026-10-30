/*
 * historyPanel.js — 撤销/重做 + 单步/运行到节点 的面板（UI 候选）。
 *
 * 只依赖传入的 ctx：{ history, onRestore, onStep, onRunTo, t }。
 * 不 import 任何既有模块、不读全局 state、不直接碰 localStorage —— 是否接线由上层决定。
 *
 * 交互契约：
 *   onRestore(state, index)  点击历史条目后回调，state 是该条目的状态快照（深拷贝）
 *   onStep(index)            单步执行第 index 个节点
 *   onRunTo(index)           执行到第 index 个节点（含）
 *   t(key, ...args)          i18n 取值；缺省用内置中文兜底（不会出现空白文案）
 *
 * 失败一律写进面板底部的状态行（role="status"），不静默吞掉。
 */

const FALLBACK = {
  "ui.history.title": "历史",
  "ui.history.undo": "撤销",
  "ui.history.redo": "重做",
  "ui.history.step": "单步",
  "ui.history.runTo": "运行到",
  "ui.history.index": "节点下标",
  "ui.history.empty": "暂无历史",
  "ui.history.now": "刚刚",
  "ui.history.secondsAgo": "{0} 秒前",
  "ui.history.minutesAgo": "{0} 分钟前",
  "ui.history.hoursAgo": "{0} 小时前",
  "ui.history.daysAgo": "{0} 天前",
  "ui.history.undoTitle": "撤销上一步（Ctrl+Z）",
  "ui.history.redoTitle": "重做（Ctrl+Shift+Z）",
  "ui.history.restoreHint": "点击某条历史可回到该状态",
  "ui.history.jumpFail": "无法跳转到第 {0} 条（当前停在第 {1} 条）",
  "ui.history.indexInvalid": "节点下标必须是非负整数",
  "ui.history.notWired": "该操作尚未接线",
  "ui.history.callbackFail": "操作失败：{0}",
  "ui.history.undoBoundary": "已回到最早一条，无法继续撤销",
  "ui.history.redoBoundary": "已是最新一条，无法继续重做",
  "ui.history.entry": "第 {0} 条",
  "ui.history.unlabeled": "未命名改动",
};

function makeT(t) {
  return function tf(key, ...args) {
    let s = "";
    if (typeof t === "function") {
      try {
        s = t(key, ...args);
      } catch (err) {
        s = "";
        if (typeof console !== "undefined" && typeof console.warn === "function") {
          console.warn("[historyPanel] i18n 取值抛错，回退内置文案：" + (err && err.message ? err.message : String(err)));
        }
      }
    }
    if (!s || s === key) s = FALLBACK[key] || key;
    return String(s).replace(/\{(\d+)\}/g, (m, i) => (args[Number(i)] === undefined ? m : String(args[Number(i)])));
  };
}

function relTime(at, tf, nowValue) {
  const diff = Math.max(0, nowValue - Number(at || 0));
  if (!Number.isFinite(diff) || diff < 5000) return tf("ui.history.now");
  if (diff < 60000) return tf("ui.history.secondsAgo", Math.floor(diff / 1000));
  if (diff < 3600000) return tf("ui.history.minutesAgo", Math.floor(diff / 60000));
  if (diff < 86400000) return tf("ui.history.hoursAgo", Math.floor(diff / 3600000));
  return tf("ui.history.daysAgo", Math.floor(diff / 86400000));
}

/**
 * 构建历史面板。
 * @param {{history:object, onRestore?:Function, onStep?:Function, onRunTo?:Function, t?:Function}} ctx
 * @returns {HTMLElement} 面板根节点；根节点带 dispose() 用于取消订阅
 */
export function historyPanel(ctx) {
  if (!ctx || typeof ctx !== "object") {
    throw new TypeError("historyPanel: ctx 必须是对象，收到 " + (ctx === null ? "null" : typeof ctx));
  }
  const history = ctx.history;
  if (!history || typeof history.push !== "function" || typeof history.snapshot !== "function") {
    throw new TypeError("historyPanel: ctx.history 必须是 createHistory() 返回的历史对象");
  }
  const tf = makeT(ctx.t);
  const onRestore = typeof ctx.onRestore === "function" ? ctx.onRestore : null;
  const onStep = typeof ctx.onStep === "function" ? ctx.onStep : null;
  const onRunTo = typeof ctx.onRunTo === "function" ? ctx.onRunTo : null;

  const root = document.createElement("section");
  root.className = "history-panel";
  root.setAttribute("aria-label", tf("ui.history.title"));

  const status = document.createElement("div");
  status.className = "history-panel__status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  function setStatus(text) {
    status.textContent = text ? String(text) : "";
    status.classList.toggle("is-error", !!text);
  }

  // 回调统一包一层：同步抛错与 Promise 拒绝都落到状态行，不吞。
  function call(fn, args) {
    if (!fn) {
      setStatus(tf("ui.history.notWired"));
      return;
    }
    let ret;
    try {
      ret = fn(...args);
    } catch (err) {
      setStatus(tf("ui.history.callbackFail", err && err.message ? err.message : String(err)));
      return;
    }
    if (ret && typeof ret.then === "function") {
      ret.then(
        () => { setStatus(""); },
        (err) => setStatus(tf("ui.history.callbackFail", err && err.message ? err.message : String(err)))
      );
    } else {
      setStatus("");
    }
  }

  // ---- 工具条 ----
  const bar = document.createElement("div");
  bar.className = "history-panel__bar";

  const btnUndo = document.createElement("button");
  btnUndo.type = "button";
  btnUndo.className = "history-panel__btn";
  btnUndo.textContent = tf("ui.history.undo");
  btnUndo.title = tf("ui.history.undoTitle");

  const btnRedo = document.createElement("button");
  btnRedo.type = "button";
  btnRedo.className = "history-panel__btn";
  btnRedo.textContent = tf("ui.history.redo");
  btnRedo.title = tf("ui.history.redoTitle");

  const indexLabel = document.createElement("label");
  indexLabel.className = "history-panel__index";
  indexLabel.textContent = tf("ui.history.index");
  const indexInput = document.createElement("input");
  indexInput.type = "number";
  indexInput.min = "0";
  indexInput.step = "1";
  indexInput.value = "0";
  indexInput.className = "history-panel__index-input";
  indexLabel.append(indexInput);

  const btnStep = document.createElement("button");
  btnStep.type = "button";
  btnStep.className = "history-panel__btn";
  btnStep.textContent = tf("ui.history.step");

  const btnRunTo = document.createElement("button");
  btnRunTo.type = "button";
  btnRunTo.className = "history-panel__btn";
  btnRunTo.textContent = tf("ui.history.runTo");

  bar.append(btnUndo, btnRedo, indexLabel, btnStep, btnRunTo);

  // ---- 历史列表 ----
  const list = document.createElement("ol");
  list.className = "history-panel__list";
  list.setAttribute("aria-label", tf("ui.history.restoreHint"));

  root.append(bar, list, status);

  function readIndex() {
    const raw = String(indexInput.value === "" ? "0" : indexInput.value).trim();
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      setStatus(tf("ui.history.indexInvalid"));
      return null;
    }
    return n;
  }

  // 跳转到第 target 条：只靠 undo/redo 移动光标（不额外扩展内核 API）。
  function jumpTo(target) {
    let snap = history.snapshot();
    if (!Number.isInteger(target) || target < 0 || target >= snap.size) {
      setStatus(tf("ui.history.jumpFail", target, snap.cursor));
      return;
    }
    let guard = snap.size + 8;
    let cur = snap.cursor;
    while (cur !== target && guard > 0) {
      guard -= 1;
      const r = cur > target ? history.undo() : history.redo();
      if (!r || !r.ok) break;
      cur = r.index;
    }
    const after = history.snapshot();
    if (after.cursor !== target) {
      setStatus(tf("ui.history.jumpFail", target, after.cursor));
      return;
    }
    call(onRestore, [after.entries[target].state, target]);
    refresh();
  }

  function refresh() {
    const snap = history.snapshot();
    btnUndo.disabled = !snap.canUndo;
    btnRedo.disabled = !snap.canRedo;
    btnStep.disabled = !onStep;
    btnRunTo.disabled = !onRunTo;

    list.textContent = "";
    if (snap.size === 0) {
      const li = document.createElement("li");
      li.className = "history-panel__empty";
      li.textContent = tf("ui.history.empty");
      list.append(li);
      return;
    }

    const nowValue = Date.now();
    // 新的在上：阅读顺序与「最近的改动」一致
    for (let i = snap.entries.length - 1; i >= 0; i--) {
      const entry = snap.entries[i];
      const li = document.createElement("li");
      li.className = "history-panel__item";
      li.dataset.index = String(i);
      if (i === snap.cursor) {
        li.classList.add("is-current");
        li.setAttribute("aria-current", "true");
      }
      li.tabIndex = 0;
      li.setAttribute("role", "button");
      li.title = tf("ui.history.restoreHint");

      const label = document.createElement("span");
      label.className = "history-panel__label";
      label.textContent = entry.label ? entry.label : tf("ui.history.unlabeled");

      const time = document.createElement("span");
      time.className = "history-panel__time";
      time.textContent = relTime(entry.at, tf, nowValue);

      const seq = document.createElement("span");
      seq.className = "history-panel__seq";
      seq.textContent = tf("ui.history.entry", i);

      li.append(seq, label, time);
      li.addEventListener("click", () => jumpTo(i));
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          jumpTo(i);
        }
      });
      list.append(li);
    }
  }

  btnUndo.addEventListener("click", () => {
    const r = history.undo();
    if (!r.ok) {
      setStatus(tf("ui.history.undoBoundary"));
      refresh();
      return;
    }
    call(onRestore, [r.state, r.index]);
    refresh();
  });

  btnRedo.addEventListener("click", () => {
    const r = history.redo();
    if (!r.ok) {
      setStatus(tf("ui.history.redoBoundary"));
      refresh();
      return;
    }
    call(onRestore, [r.state, r.index]);
    refresh();
  });

  btnStep.addEventListener("click", () => {
    const n = readIndex();
    if (n === null) return;
    call(onStep, [n]);
  });

  btnRunTo.addEventListener("click", () => {
    const n = readIndex();
    if (n === null) return;
    call(onRunTo, [n]);
  });

  let unsubscribe = null;
  if (typeof history.subscribe === "function") {
    unsubscribe = history.subscribe(() => {
      refresh();
    });
  }

  Object.defineProperty(root, "dispose", {
    enumerable: false,
    value: function dispose() {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  });

  refresh();
  return root;
}
