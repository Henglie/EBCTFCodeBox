/*
 * Result navigation: a plate-free dot/line rail opens a grouped title list.
 * Colors share the result verdict tokens. Group disclosure is retained during
 * updates in this instance. Scroll/focus state belongs to this instance only.
 */

import { icon } from "./icons.js";

const ACTIVE_PAD = 88;
let tocSequence = 0;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

export function createResultToc() {
  const root = el("aside", "rtoc");
  root.setAttribute("aria-label", "结果目录");

  // 收起态：右侧居中的一列算法色点，点之间由竖线连接；点整条轨展开目录。
  const rail = el("button", "rtoc-rail");
  rail.type = "button";
  rail.title = "展开结果目录";
  rail.setAttribute("aria-label", "展开结果目录");
  rail.setAttribute("aria-expanded", "false");

  const panel = el("div", "rtoc-panel");
  panel.id = "result-toc-panel-" + (++tocSequence);
  rail.setAttribute("aria-controls", panel.id);
  panel.setAttribute("aria-hidden", "true");
  panel.inert = true;
  const head = el("div", "rtoc-head");
  const title = el("span", "rtoc-title", "结果目录");
  const count = el("span", "rtoc-count", "0");
  const close = el("button", "rtoc-close");
  close.type = "button";
  close.title = "收起目录";
  close.setAttribute("aria-label", "收起目录");
  close.innerHTML = icon('close');
  head.append(title, count, close);

  const list = el("div", "rtoc-list");
  list.setAttribute("role", "list");
  panel.append(head, list);
  root.append(rail, panel);
  document.body.append(root);

  let items = [];
  let activeId = "";
  let destroyed = false;
  let raf = 0;
  const flashes = new Map();
  const groupOpen = new Map();   // group label -> open

  const setExpanded = (on) => {
    if (destroyed) return;
    on = !!on && items.length > 0;
    const returnFocus = !on && panel.contains(document.activeElement);
    root.classList.toggle("open", on);
    panel.setAttribute("aria-hidden", String(!on));
    panel.inert = !on;
    rail.setAttribute("aria-expanded", String(on));
    rail.tabIndex = on ? -1 : 0;
    if (on) { close.focus({ preventScroll: true }); applyItemActive(); onScroll(); }
    else if (returnFocus) {
      if (items.length) rail.focus({ preventScroll: true });
      else document.activeElement.blur();
    }
  };
  rail.addEventListener("click", () => setExpanded(true));
  close.addEventListener("click", () => setExpanded(false));
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && root.classList.contains("open")) {
      e.preventDefault();
      setExpanded(false);
      rail.focus();
    }
  });

  function itemEl(it, i) {
    const b = el("button", "rtoc-item");
    b.type = "button";
    b.dataset.target = it.id;
    b.style.setProperty("--rtoc-color", it.color || "var(--outline-var)");
    b.setAttribute("aria-label", (it.title || ("结果 " + (i + 1))) + (it.badge ? "，" + it.badge : ""));

    // 目录只给颜色点 + 标题；不再用文本伪造缩略图。
    const dot = el("span", "rtoc-dot");
    const label = el("span", "rtoc-label", it.title || ("结果 " + (i + 1)));
    b.append(dot, label);
    if (it.badge) b.append(el("span", "rtoc-badge", it.badge));
    b.title = it.title || "";
    b.addEventListener("click", () => {
      const target = document.getElementById(it.id);
      if (!target) return;
      target.scrollIntoView({ behavior: document.documentElement.classList.contains("reduce-motion") ? "instant" : "smooth", block: "start" });
      clearTimeout(flashes.get(target));
      target.classList.add("rtoc-flash");
      flashes.set(target, setTimeout(() => { target.classList.remove("rtoc-flash"); flashes.delete(target); }, 1200));
    });
    return b;
  }

  function groupEl(label, entries) {
    const details = el("details", "rtoc-group");
    const key = label || "候选结果";
    details.open = groupOpen.has(key) ? groupOpen.get(key) : key !== "爆破参数";
    const summary = el("summary", "rtoc-group-head");
    const caret = el("span", "rtoc-group-caret");
    caret.innerHTML = icon('chevron_right');
    summary.append(caret, el("span", "rtoc-group-name", key), el("span", "rtoc-group-count", String(entries.length)));
    details.append(summary);
    const body = el("div", "rtoc-group-body");
    entries.forEach(({ it, i }) => body.append(itemEl(it, i)));
    details.append(body);
    details.addEventListener("toggle", () => groupOpen.set(key, details.open));
    return details;
  }

  function update(next, opts = {}) {
    if (destroyed) return;
    items = Array.isArray(next) ? next.filter((x) => x && x.id) : [];
    const focusedId = list.contains(document.activeElement) ? document.activeElement.dataset.target : null;
    const focusedGroup = document.activeElement.matches?.('.rtoc-group-head') && list.contains(document.activeElement)
      ? document.activeElement.querySelector('.rtoc-group-name')?.textContent : null;
    if (activeId && !items.some((x) => x.id === activeId)) activeId = "";
    const n = items.length;
    count.textContent = String(n);
    root.classList.toggle("empty", !n);
    const track = el("span", "rtoc-rail-track");
    track.setAttribute("aria-hidden", "true");
    rail.replaceChildren(track);
    for (const it of items) {
      const dot = el("span", "rtoc-rail-dot");
      dot.dataset.target = it.id;
      dot.style.setProperty("--rtoc-color", it.color || "var(--outline-var)");
      dot.title = it.title || "";
      track.append(dot);
    }
    rail.setAttribute("aria-label", n ? `展开结果目录，共 ${n} 项` : "结果目录为空");
    list.replaceChildren();
    if (!n) {
      list.append(el("div", "rtoc-empty", "暂无结果"));
    } else {
      const order = ["最佳结果", "候选结果", "爆破参数", "原文", "图像分析", "隐写尝试", "结构分析"];
      const buckets = new Map();
      items.forEach((it, i) => {
        const key = it.group || "候选结果";
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push({ it, i });
      });
      const keys = [...order.filter((k) => buckets.has(k)), ...[...buckets.keys()].filter((k) => !order.includes(k))];
      for (const key of keys) list.append(groupEl(key, buckets.get(key)));
    }
    if (activeId) applyItemActive(false);
    if (focusedId) {
      const nextFocus = [...list.querySelectorAll('.rtoc-item')].find(node => node.dataset.target === focusedId);
      (nextFocus || close).focus({ preventScroll: true });
    } else if (focusedGroup) {
      const nextFocus = [...list.querySelectorAll('.rtoc-group-head')].find(node => node.querySelector('.rtoc-group-name')?.textContent === focusedGroup);
      (nextFocus || close).focus({ preventScroll: true });
    }
    if (opts.open && n) setExpanded(true);
    if (!n) setExpanded(false);
    onScroll();
  }

  function clearActive() {
    activeId = "";
    for (const b of list.querySelectorAll(".rtoc-item.active")) { b.classList.remove("active"); b.removeAttribute("aria-current"); }
    for (const d of rail.querySelectorAll(".rtoc-rail-dot.active")) d.classList.remove("active");
  }

  // 面板打开时才同步列表高亮并滚动到可见区域；收起时只维护右侧轨道高亮。
  function applyItemActive(scroll = true) {
    for (const b of list.querySelectorAll(".rtoc-item")) {
      const active = b.dataset.target === activeId;
      b.classList.toggle("active", active);
      if (active) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    }
    for (const d of rail.querySelectorAll(".rtoc-rail-dot")) {
      d.classList.toggle("active", d.dataset.target === activeId);
    }
    const dot = rail.querySelector('.rtoc-rail-dot.active');
    if (dot) {
      const dr = dot.getBoundingClientRect(), rr = rail.getBoundingClientRect();
      // Keep the circular halo/focus ring clear of the scroll viewport edges.
      const pad = 20;
      if (dr.top < rr.top + pad) rail.scrollTop += dr.top - rr.top - pad;
      else if (dr.bottom > rr.bottom - pad) rail.scrollTop += dr.bottom - rr.bottom + pad;
    }
    if (!activeId || !root.classList.contains("open")) return;
    const active = list.querySelector(".rtoc-item.active");
    if (!active) return;
    // 当前项落在手动收起的分组里：先展开，否则 scrollTop 会滚到一个不可见项。
    const group = active.closest("details.rtoc-group");
    if (group && !group.open) {
      group.open = true;
      const name = group.querySelector(".rtoc-group-name")?.textContent;
      if (name) groupOpen.set(name, true);
    }
    if (!scroll) return;
    const lr = list.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    if (ar.top < lr.top || ar.bottom > lr.bottom) {
      list.scrollTop += ar.top - lr.top - 8;
    }
  }

  function syncActive() {
    if (destroyed || !items.length) return;
    let current = null;
    for (const it of items) {
      const node = document.getElementById(it.id);
      if (!node) continue;
      const r = node.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (!current || r.top <= ACTIVE_PAD) current = { it, r };
      if (r.top > ACTIVE_PAD) break;
    }
    if (!current) {
      if (activeId) clearActive();
      return;
    }
    // 滚到页面底部时最后一张卡可能低于 ACTIVE_PAD，但仍已在视口内，必须高亮它。
    const last = items[items.length - 1], lastNode = document.getElementById(last.id);
    const lr = lastNode?.getBoundingClientRect();
    if (lr?.height && lr.top >= 0 && lr.bottom <= window.innerHeight) current = { it: last, r: lr };
    if (current.it.id !== activeId) {
      activeId = current.it.id;
      applyItemActive();
    }
  }

  function onScroll(event) {
    if (destroyed || (event?.target instanceof Node && root.contains(event.target)) || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; syncActive(); });
  }
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("resize", onScroll, { passive: true });

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", onScroll);
    if (raf) cancelAnimationFrame(raf);
    for (const [target, timer] of flashes) { clearTimeout(timer); target.classList.remove("rtoc-flash"); }
    flashes.clear();
    root.remove();
  }

  update([]);
  return { update, destroy, setExpanded, element: root };
}
