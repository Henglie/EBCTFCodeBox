// offlinePackPanel.js — 离线包管理面板（UI 候选，尚未接线）。
//
// 约束：
//   - 不 import main.js，不读全局 state，不直接调用 Service Worker / Cache API；
//   - 只依赖入参 ctx = { state, onInstall, onRemove, t, offline }；
//   - 装包失败 / 部分安装 / 配额不足一律显式展示原因，不做静默降级。
//
// 返回的根节点附带 refresh(nextState)：上层持久化状态变化后调用即可重绘。
// 安装成功与否由上层落盘后通过 refresh 回灌，本面板不自行改写状态。

import { PACKS, packPlan, offlineReadiness } from "../core/offlinePacks.js";

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "0 B";
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1048576).toFixed(2)} MiB`;
}

const STATE_LABEL = {
  installed: "已安装",
  partial: "部分安装",
  missing: "未安装",
};

/**
 * @param {{ state?: object, onInstall?: (id: string) => any, onRemove?: (id: string) => any,
 *           t?: (key: string, ...args: any[]) => string, offline?: boolean }} ctx
 * @returns {HTMLElement}
 */
export function offlinePackPanel(ctx = {}) {
  const tr = (key, fallback) => {
    if (typeof ctx.t !== "function") return fallback;
    try {
      const text = ctx.t(key);
      return typeof text === "string" && text && text !== key ? text : fallback;
    } catch {
      // 翻译函数自身异常不应让面板白屏，退回内置中文文案。
      return fallback;
    }
  };

  const root = el("section", {
    class: "offline-pack-panel",
    "data-role": "offline-pack-panel",
    "aria-label": tr("ui.offlinePack.title", "离线包管理"),
  });

  let state = ctx.state || { installed: {}, errors: {} };
  let pending = null;
  let actionError = null;

  function collectError(packId) {
    if (actionError && actionError.packId === packId) return actionError.reason;
    const err = state && state.errors && state.errors[packId];
    return err && err.reason ? err.reason : null;
  }

  async function run(action, id) {
    const fn = action === "install" ? ctx.onInstall : ctx.onRemove;
    if (typeof fn !== "function") {
      actionError = { packId: id, reason: "未提供处理函数，操作未执行。" };
      render();
      return;
    }
    pending = id;
    actionError = null;
    render();
    try {
      await fn(id);
    } catch (e) {
      actionError = {
        packId: id,
        reason: (e && e.message) ? e.message : String(e),
      };
    } finally {
      pending = null;
      render();
    }
  }

  function renderPack(pack) {
    const error = collectError(pack.id);
    const busy = pending === pack.id;
    const installed = pack.state === "installed";

    return el("li", { class: "offline-pack-item", "data-pack-id": pack.id, "data-state": pack.state },
      el("div", { class: "offline-pack-head" },
        el("strong", { class: "offline-pack-name", text: tr(`ui.offlinePack.pack.${pack.id}.name`, pack.name) }),
        el("span", { class: "offline-pack-size", text: formatBytes(pack.bytes) }),
        el("span", { class: `offline-pack-state is-${pack.state}`, text: tr(`ui.offlinePack.state.${pack.state}`, STATE_LABEL[pack.state]) }),
      ),
      el("div", { class: "offline-pack-meta", text: `${pack.entries.length} 项`
        + (pack.state === "partial" ? `，缺 ${pack.missingCount} 项（${formatBytes(pack.missingBytes)}）` : "")
        + (pack.state === "installed" ? `，已装 ${formatBytes(pack.installedBytes)}` : "") }),
      el("div", { class: "offline-pack-actions" },
        el("button", {
          type: "button",
          class: "offline-pack-install",
          disabled: installed || busy,
          "data-action": "install",
          onclick: () => run("install", pack.id),
        }, busy ? tr("ui.offlinePack.installing", "安装中…") : tr("ui.offlinePack.install", "安装")),
        el("button", {
          type: "button",
          class: "offline-pack-remove",
          disabled: pack.state === "missing" || busy,
          "data-action": "remove",
          onclick: () => run("remove", pack.id),
        }, tr("ui.offlinePack.remove", "移除")),
      ),
      error
        ? el("p", { class: "offline-pack-error", role: "alert", text: `${tr("ui.offlinePack.failed", "安装失败")}：${error}` })
        : null,
    );
  }

  function render() {
    const plan = packPlan(state);
    const readiness = offlineReadiness(state);
    const installedBytes = plan.packs.reduce((n, p) => n + p.installedBytes, 0);

    const notice = el("div", { class: "offline-pack-notice", "data-role": "offline-pack-notice" });
    if (ctx.offline === true) {
      notice.append(el("p", { class: "offline-pack-offline-hint", text: tr("ui.offlinePack.offlineNow", "当前处于离线状态，以下能力取决于已安装的离线包。") }));
    }
    if (readiness.ready) {
      notice.append(el("p", { class: "offline-pack-ready", text: tr("ui.offlinePack.allReady", "离线包齐全：断网后上述功能均可用。") }));
    } else {
      const list = el("ul", { class: "offline-pack-degradations" });
      for (const item of readiness.degradations) {
        list.append(el("li", { "data-degraded-pack": item.packId },
          el("strong", { text: `${tr(`ui.offlinePack.pack.${item.packId}.name`, item.feature)}：` }),
          el("span", { class: "offline-pack-degrade-reason", text: item.reason }),
          el("span", { class: "offline-pack-degrade-fallback", text: ` → ${tr(`ui.offlinePack.degrade.${item.packId}.fallback`, item.fallback)}` }),
        ));
      }
      notice.append(list);
    }

    root.replaceChildren(
      el("header", { class: "offline-pack-header" },
        el("h3", { class: "offline-pack-title", text: tr("ui.offlinePack.title", "离线包管理") }),
        el("p", { class: "offline-pack-summary", text: `${tr("ui.offlinePack.installedVolume", "已装")} ${formatBytes(installedBytes)} / ${tr("ui.offlinePack.totalVolume", "总计")} ${formatBytes(plan.totalBytes)}` }),
      ),
      el("ul", { class: "offline-pack-list" }, PACKS.map((p) => {
        const planned = plan.packs.find((x) => x.id === p.id);
        return renderPack(planned);
      })),
      notice,
    );
  }

  root.refresh = (nextState) => {
    state = nextState || { installed: {}, errors: {} };
    actionError = null;
    render();
  };

  render();
  return root;
}
