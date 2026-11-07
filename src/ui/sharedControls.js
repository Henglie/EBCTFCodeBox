import { HLSpring } from "./spring.js";

const SEGMENTS = ".dir-seg, .uv-tabs, .qc-tabs, .ds-depth-row, .io-coding-seg, .uv-ids-subtabs, .imgops-tabs, .stegsolve-tabs, .sspage-tabs";
const instances = new WeakMap();
const positions = new Map();
let pendingFocus = null;
let initialized = false;
const resize = typeof ResizeObserver === "function" ? new ResizeObserver(entries => {
  for (const { target } of entries) instances.get(target)?.sync(false);
}) : null;

// One range implementation for decode strength, image adjustments and StegSolve.
class RangeControl {
  constructor(input) {
    this.input = input;
    input.classList.add("m3-slider");
    this.sync = this.sync.bind(this);
    input.addEventListener("input", this.sync);
    input.addEventListener("change", this.sync);
    // Keep programmatic changes (reset, frame count, zoom) visually in sync.
    const value = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    try {
      Object.defineProperty(input, "value", {
        configurable: true,
        get() { return value.get.call(this); },
        set(next) { value.set.call(this, next); instances.get(this)?.sync(); },
      });
    } catch { /* Native input/change and reflected attributes still synchronize. */ }
    this.sync();
  }
  sync() {
    const input = this.input;
    const min = input.min === "" ? 0 : Number(input.min);
    const max = input.max === "" ? 100 : Number(input.max);
    const ratio = max > min ? (Number(input.value) - min) / (max - min) : 0;
    input.style.setProperty("--range-progress", `${Math.max(0, Math.min(1, ratio)) * 100}%`);
  }
  dispose() {}
}

class SegmentedControl {
  constructor(root) {
    this.root = root;
    this.initial = true;
    this.key = root.dataset.segmentKey || root.id ||
      (root.matches(".qc-tabs") ? "quickconv-tabs" : root.matches(".uv-tabs") ? "inspect-tabs" :
        root.matches(".ds-tabs") ? "decode-scope" : root.matches(".ds-depth-row") ? "decode-depth" : "");
    root.classList.add("m3-segmented");
    if (!root.hasAttribute("role")) root.setAttribute("role", "group");
    this.thumb = document.createElement("span");
    this.thumb.className = "m3-segment-thumb";
    this.thumb.setAttribute("aria-hidden", "true");
    root.append(this.thumb);
    root.addEventListener("click", () => queueMicrotask(() => { if (root.isConnected) this.sync(true); }));
    root.addEventListener("keydown", event => this.keydown(event));
    root.addEventListener("family-overflow-select", () => { pendingFocus = this.key || null; });
    resize?.observe(root);
    requestAnimationFrame(() => { if (root.isConnected) this.sync(false); });
  }
  buttons() { return Array.from(this.root.children).filter(node => node.tagName === "BUTTON" && !node.hidden && node.getAttribute("aria-hidden") !== "true"); }
  sync(animate = true) {
    const buttons = this.buttons();
    const selected = buttons.find(button => button.classList.contains("on") || button.classList.contains("active")) ||
      buttons.find(button => button.getAttribute("aria-selected") === "true");
    this.thumb.hidden = !selected;
    if (!selected || !this.root.isConnected) return;
    const tabs = this.root.getAttribute("role") === "tablist";
    for (const button of buttons) {
      const attribute = tabs ? "aria-selected" : "aria-pressed";
      const value = String(button === selected);
      if (!button.hasAttribute("data-family-more") && button.getAttribute(attribute) !== value) button.setAttribute(attribute, value);
      button.tabIndex = button === selected ? 0 : -1;
    }
    const x = selected.offsetLeft;
    this.thumb.style.width = `${selected.offsetWidth}px`;
    this.thumb.style.top = `${selected.offsetTop}px`;
    this.thumb.style.height = `${selected.offsetHeight}px`;
    const spring = document.documentElement.classList.contains("spring-motion");
    if (this.initial) {
      const previous = this.key && !this.root.classList.contains("family-overflow") ? positions.get(this.key) : undefined;
      HLSpring.set(this.thumb, { x: spring && previous != null ? previous : x });
      this.initial = false;
      animate = spring && previous != null && previous !== x;
    }
    if (animate && spring) HLSpring.to(this.thumb, { x }, { stiffness: 1422, damping: 57 });
    else HLSpring.set(this.thumb, { x });
    if (this.key) positions.set(this.key, x);
    if (this.key && pendingFocus === this.key) {
      // The new route's DOM and overflow visibility must settle before focus is
      // restored; a synchronous focus can land on a button that is then hidden.
      if (!this.focusQueued) {
        this.focusQueued = true;
        requestAnimationFrame(() => {
          this.focusQueued = false;
          if (pendingFocus !== this.key || !this.root.isConnected) return;
          const active = this.buttons().find(button => button.classList.contains("on") || button.classList.contains("active") || button.getAttribute("aria-selected") === "true");
          if (active) { pendingFocus = null; active.focus({ preventScroll: true }); }
        });
      }
    }
  }
  keydown(event) {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const buttons = this.buttons().filter(button => !button.disabled);
    const index = buttons.indexOf(event.target);
    if (index < 0 || buttons.length < 2) return;
    event.preventDefault();
    const rtl = getComputedStyle(this.root).direction === "rtl";
    const direction = (event.key === "ArrowRight" ? 1 : -1) * (rtl ? -1 : 1);
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 :
      (index + direction + buttons.length) % buttons.length;
    buttons[next].focus({ preventScroll: true });
    // More is a menu launcher, never an operation. Arrow/Home/End only focus it.
    if (!buttons[next].hasAttribute("data-family-more")) {
      pendingFocus = this.key || null;
      buttons[next].click();
    }
  }
  dispose() { resize?.unobserve(this.root); HLSpring.stop(this.thumb); }
}

function mount(node) {
  if (!(node instanceof Element)) return;
  if (!instances.has(node)) {
    if (node.matches('input[type="range"]')) {
      const control = new RangeControl(node); instances.set(node, control);
    } else if (node.matches(SEGMENTS)) instances.set(node, new SegmentedControl(node));
  }
  for (const child of node.querySelectorAll(`input[type="range"], ${SEGMENTS}`)) mount(child);
}

function unmount(node) {
  if (!(node instanceof Element)) return;
  instances.get(node)?.dispose(); instances.delete(node);
  for (const child of node.querySelectorAll(".m3-slider, .m3-segmented")) {
    instances.get(child)?.dispose(); instances.delete(child);
  }
}

export function syncRange(input) {
  if (!instances.has(input)) instances.set(input, new RangeControl(input));
  instances.get(input).sync();
}

// Family overflow changes visibility without changing operation selection.
export function syncSegmentedControl(root, animate = false) {
  mount(root);
  instances.get(root)?.sync(animate);
}

export function initSharedControls() {
  if (initialized) return;
  initialized = true;
  mount(document.body);
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === "childList") {
        for (const node of record.removedNodes) { if (!node.isConnected) unmount(node); }
        for (const node of record.addedNodes) mount(node);
      } else {
        instances.get(record.target)?.sync(false);
        if (record.target.parentElement?.matches(SEGMENTS)) instances.get(record.target.parentElement)?.sync(true);
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "min", "max", "value", "aria-selected"] });
}
