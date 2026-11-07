import { syncSegmentedControl } from "./sharedControls.js";

const attached = new WeakMap();
let sequence = 0;
const setAttr = (node, name, value) => { if (node.getAttribute(name) !== value) node.setAttribute(name, value); };
const selected = button => button.classList.contains("on") || button.classList.contains("active") || button.getAttribute("aria-pressed") === "true" || button.getAttribute("aria-selected") === "true";

/** Keep a contiguous family prefix and put the remainder in an unclipped, named menu.
 * Labels are supplied by the caller's effective locale. Original buttons retain routing/favorites.
 */
export function attachFamilyOverflow(root, { moreLabel, ariaLabel } = {}) {
  if (!(root instanceof HTMLElement) || !String(moreLabel || "").trim()) throw new TypeError("Family root and localized moreLabel are required");
  attached.get(root)?.();
  let disposed = false, frame = 0, popup = null, connected = root.isConnected;
  let originals = [], overflow = [];
  const saved = new Map();
  const menuId = `family-overflow-menu-${++sequence}`;
  const more = document.createElement("button"); more.type = "button"; more.className = "family-more";
  more.setAttribute("data-family-more", ""); more.setAttribute("aria-haspopup", "menu"); more.setAttribute("aria-expanded", "false"); more.setAttribute("aria-controls", menuId);
  const label = document.createElement("span"); label.className = "family-more-label"; label.textContent = moreLabel;
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.setAttribute("viewBox", "0 0 24 24"); icon.setAttribute("aria-hidden", "true"); icon.classList.add("family-more-icon");
  const path = document.createElementNS(icon.namespaceURI, "path"); path.setAttribute("d", "m6 9 6 6 6-6"); icon.append(path); more.append(label, icon);
  more.hidden = true;
  root.classList.add("family-overflow"); root.append(more);

  const restore = button => {
    const state = saved.get(button); if (!state) return;
    button.hidden = state.hidden;
    if (state.tabindex === null) button.removeAttribute("tabindex"); else button.setAttribute("tabindex", state.tabindex);
    saved.delete(button);
  };
  function collect() {
    const next = [...root.children].filter(node => node.tagName === "BUTTON" && node !== more);
    for (const old of originals) if (!next.includes(old)) restore(old);
    for (const button of next) if (!saved.has(button)) saved.set(button, { hidden: button.hidden, tabindex: button.getAttribute("tabindex") });
    originals = next.filter(button => !saved.get(button).hidden);
  }
  const schedule = () => { if (!disposed && !frame) frame = requestAnimationFrame(() => { frame = 0; layout(); }); };
  function close(restoreFocus = false) {
    if (!popup) return;
    popup.remove(); popup = null; setAttr(more, "aria-expanded", "false");
    document.removeEventListener("pointerdown", outside, true);
    document.removeEventListener("keydown", dismiss, true);
    if (restoreFocus && root.isConnected && !more.hidden) more.focus({ preventScroll: true });
  }
  function outside(event) { if (!more.contains(event.target) && !popup?.contains(event.target)) close(false); }
  function dismiss(event) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(true); }
  }
  const choices = () => popup ? [...popup.querySelectorAll('button[role="menuitemradio"]')].filter(button => !button.disabled) : [];
  function position() {
    if (!popup) return;
    const rect = more.getBoundingClientRect();
    if (!root.isConnected || more.hidden || rect.bottom < 0 || rect.top > innerHeight) { close(false); return; }
    const rtl = getComputedStyle(root).direction === "rtl";
    popup.dir = rtl ? "rtl" : "ltr";
    const width = Math.min(Math.max(root.getBoundingClientRect().width, 200), 360, Math.max(0, innerWidth - 16));
    popup.style.width = `${width}px`;
    const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
    const upward = below < Math.min(popup.scrollHeight, 240) && above > below;
    popup.style.maxHeight = `${Math.max(44, upward ? above : below)}px`;
    const height = popup.getBoundingClientRect().height;
    popup.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, rtl ? rect.right - width : rect.left))}px`;
    popup.style.top = `${Math.max(8, upward ? rect.top - height - 4 : rect.bottom + 4)}px`;
  }
  function open(which = "selected") {
    if (disposed || more.hidden || !overflow.length) return;
    close(false);
    popup = document.createElement("div"); popup.id = menuId; popup.className = "family-overflow-menu";
    popup.setAttribute("role", "menu"); popup.setAttribute("aria-label", ariaLabel || root.getAttribute("aria-label") || moreLabel);
    for (const original of overflow) {
      const item = document.createElement("button"); item.type = "button"; item.className = "family-overflow-choice";
      item.setAttribute("role", "menuitemradio"); item.setAttribute("aria-checked", String(selected(original))); item.tabIndex = -1; item.disabled = original.disabled;
      const check = document.createElement("span"); check.className = "family-choice-check"; check.setAttribute("aria-hidden", "true"); check.textContent = "\u2713";
      const text = document.createElement("span"); text.className = "family-choice-label"; text.textContent = original.textContent;
      item.append(check, text);
      item.addEventListener("click", () => {
        close(false);
        root.dispatchEvent(new Event("family-overflow-select"));
        original.click();
        // In-place users keep their selection focus; routed users are restored by sharedControls.
        if (root.isConnected && !disposed) { layout(); (original.hidden ? more : original).focus({ preventScroll: true }); }
      });
      popup.append(item);
    }
    popup.addEventListener("keydown", event => {
      const buttons = choices(), current = buttons.indexOf(document.activeElement);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) && buttons.length) {
        event.preventDefault(); event.stopPropagation();
        const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
        buttons[index].focus();
      } else if (event.key === "Tab") close(true);
    });
    popup.addEventListener("contextmenu", event => {
      event.preventDefault();
      const { clientX, clientY } = event;
      close(false);
      root.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY }));
    });
    document.body.append(popup); setAttr(more, "aria-expanded", "true"); position();
    if (!popup) return;
    document.addEventListener("pointerdown", outside, true); document.addEventListener("keydown", dismiss, true);
    const buttons = choices();
    const initial = which === "last" ? buttons.at(-1) : which === "first" ? buttons[0] : buttons.find(button => button.getAttribute("aria-checked") === "true") || buttons[0];
    initial?.focus({ preventScroll: true });
  }
  const toggle = () => popup ? close(true) : open();
  const launcherKeys = event => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); open(event.key === "ArrowUp" ? "last" : "first"); }
  };
  more.addEventListener("click", toggle); more.addEventListener("keydown", launcherKeys);

  // Measure faithful, inert clones. Never temporarily reveal hidden source buttons or copy IDs.
  function widths(buttons) {
    const probe = document.createElement("div"); probe.className = "family-overflow-measure";
    probe.setAttribute("aria-hidden", "true"); probe.inert = true;
    probe.style.cssText = "position:fixed;left:0;top:0;display:flex;width:max-content;max-width:none;visibility:hidden;pointer-events:none";
    for (const button of buttons) {
      const clone = button.cloneNode(true), css = getComputedStyle(button);
      clone.hidden = false; clone.removeAttribute("id"); clone.removeAttribute("aria-hidden"); clone.tabIndex = -1;
      for (const child of clone.querySelectorAll("[id]")) child.removeAttribute("id");
      for (const key of ["font", "fontFeatureSettings", "letterSpacing", "wordSpacing", "paddingLeft", "paddingRight", "borderLeftWidth", "borderRightWidth", "borderStyle", "boxSizing", "minWidth", "gap"])
        clone.style[key] = css[key];
      clone.style.display = "inline-flex"; clone.style.position = "static"; clone.style.width = "max-content"; clone.style.maxWidth = "none"; clone.style.flex = "none";
      probe.append(clone);
    }
    document.body.append(probe);
    const result = [...probe.children].map(button => button.getBoundingClientRect().width);
    probe.remove(); return result;
  }
  function layout() {
    if (disposed || !root.isConnected) return;
    const focused = document.activeElement, menuFocused = popup?.contains(focused);
    collect();
    const chosen = originals.find(selected);
    // First fit the neutral launcher, then reserve its selected label if that
    // operation overflows. This one-way refinement cannot oscillate near a breakpoint.
    if (label.textContent !== moreLabel) label.textContent = moreLabel;
    const css = getComputedStyle(root), gap = parseFloat(css.columnGap) || 0;
    const available = Math.max(0, root.clientWidth - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0));
    const measured = widths([...originals, more]);
    const total = measured.slice(0, -1).reduce((sum, width) => sum + width, 0) + Math.max(0, originals.length - 1) * gap;
    const fit = reserve => {
      let count = 0, used = Math.min(reserve, available);
      while (count < originals.length && used + measured[count] + gap <= available + .5) { used += measured[count] + gap; count++; }
      return count;
    };
    let count = total <= available + .5 ? originals.length : fit(measured.at(-1));
    if (chosen && originals.indexOf(chosen) >= count && count < originals.length) {
      label.textContent = `${moreLabel} \u00b7 ${chosen.textContent.trim()}`;
      count = fit(widths([more])[0]);
    }
    const next = originals.slice(count);
    if (popup && (next.length !== overflow.length || next.some((button, index) => button !== overflow[index]))) close(false);
    overflow = next;
    for (let i = 0; i < originals.length; i++) {
      const hidden = i >= count;
      if (originals[i].hidden !== hidden) originals[i].hidden = hidden;
      if (hidden) originals[i].tabIndex = -1;
    }
    more.hidden = !overflow.length;
    const selectedInOverflow = !!chosen && overflow.includes(chosen);
    const nextText = selectedInOverflow ? `${moreLabel} \u00b7 ${chosen.textContent.trim()}` : moreLabel;
    if (label.textContent !== nextText) label.textContent = nextText;
    if (more.classList.contains("on") !== selectedInOverflow) more.classList.toggle("on", selectedInOverflow);
    more.title = nextText; setAttr(more, "aria-label", nextText);
    more.style.maxWidth = `${available}px`;
    if (!overflow.length) close(false);
    root.scrollLeft = 0;
    syncSegmentedControl(root, false);
    if ((originals.includes(focused) && focused.hidden) || (menuFocused && !popup)) (more.hidden ? chosen || originals[0] : more)?.focus({ preventScroll: true });
    else if (focused === more && more.hidden) (chosen || originals[0])?.focus({ preventScroll: true });
    position();
  }
  const observer = new ResizeObserver(schedule); observer.observe(root);
  const mutations = new MutationObserver(records => {
    if (records.some(record => record.target === root && record.type === "childList" && [...record.addedNodes, ...record.removedNodes].some(node => node.tagName === "BUTTON" && node !== more)
      || originals.some(button => record.target === button || button.contains(record.target)))) schedule();
  });
  mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "disabled", "aria-pressed", "aria-selected"] });
  const removal = new MutationObserver(() => { if (root.isConnected) connected = true; else if (connected) dispose(); });
  removal.observe(document.body, { childList: true, subtree: true });
  const scroll = event => { if (!popup?.contains(event.target)) position(); };
  const route = () => close(false);
  window.addEventListener("resize", schedule); window.addEventListener("scroll", scroll, true);
  window.addEventListener("hashchange", route); window.addEventListener("popstate", route);
  document.fonts?.addEventListener("loadingdone", schedule);
  function dispose() {
    if (disposed) return; disposed = true;
    const returnFocus = document.activeElement === more || popup?.contains(document.activeElement);
    cancelAnimationFrame(frame); close(false); observer.disconnect(); mutations.disconnect(); removal.disconnect();
    window.removeEventListener("resize", schedule); window.removeEventListener("scroll", scroll, true);
    window.removeEventListener("hashchange", route); window.removeEventListener("popstate", route);
    document.fonts?.removeEventListener("loadingdone", schedule);
    more.removeEventListener("click", toggle); more.removeEventListener("keydown", launcherKeys); more.remove();
    for (const button of [...saved.keys()]) restore(button);
    root.classList.remove("family-overflow"); attached.delete(root);
    if (root.isConnected) {
      syncSegmentedControl(root, false);
      if (returnFocus) (originals.find(selected) || originals[0])?.focus({ preventScroll: true });
    }
  }
  attached.set(root, dispose); layout(); return dispose;
}
