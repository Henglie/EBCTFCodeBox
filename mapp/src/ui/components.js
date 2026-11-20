import { h, icon, debounce } from "./dom.js";
import { searchOps } from "../core/search.js";

export function opCard(op, ctx, opts = {}) {
  const card = h("article", { class: "op-card", tabindex: "0", role: "button" },
    h("div", { class: "op-card-main" },
      h("div", { class: "op-card-title" },
        h("span", { class: "op-card-name", text: op.name }),
        h("span", { class: "op-card-id", text: op.id })
      ),
      h("p", { class: "op-card-desc", text: op.desc || "（暂无说明）" })
    ),
    h("div", { class: "op-card-side" },
      opts.showFav === false ? null : favButton(op.id, ctx),
      h("span", { class: "op-card-cat", text: catName(ctx, op.cat) })
    )
  );
  const open = () => ctx.openOp(op.id);
  card.addEventListener("click", (e) => { if (!e.target.closest(".fav-btn")) open(); });
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  return card;
}

export function favButton(id, ctx) {
  const btn = h("button", { class: "fav-btn" + (ctx.isFav(id) ? " on" : ""), type: "button", title: ctx.isFav(id) ? "取消收藏" : "收藏", "aria-label": ctx.isFav(id) ? "取消收藏" : "收藏" }, icon("star", 18));
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const on = ctx.toggleFav(id);
    btn.classList.toggle("on", on);
    btn.title = on ? "取消收藏" : "收藏";
    ctx.toast(on ? "已收藏" : "已取消收藏", "ok");
  });
  return btn;
}

export function catName(ctx, id) {
  const c = ctx.cats.find((x) => x.id === id);
  return c ? c.name : id;
}

export function copyBtn(text, ctx, label = "复制", cls = "btn ghost small") {
  return h("button", { class: cls, type: "button", onclick: () => ctx.copy(text) }, icon("copy", 16), label);
}

export function normalizeOptions(options) {
  return (options || []).map((o) => {
    if (typeof o === "string") return { value: o, label: o };
    if (o && typeof o === "object") return { value: String(o.value ?? o.v ?? o.label ?? o.name ?? ""), label: String(o.label ?? o.name ?? o.value ?? o.v ?? "") };
    return { value: String(o), label: String(o) };
  });
}

export function paramForm(op, values, ctx) {
  const wrap = h("div", { class: "param-grid" });
  const inputs = new Map();
  const defaults = {};
  for (const p of op.params || []) defaults[p.key] = p.default;
  const initial = { ...defaults, ...values };
  for (const p of op.params || []) {
    const v = initial[p.key];
    let input;
    if (p.type === "bool") {
      const cb = h("input", { type: "checkbox", class: "switch-input" });
      cb.checked = !!v;
      input = h("label", { class: "switch-row" }, cb, h("span", { class: "switch-track" }, h("span", { class: "switch-dot" })));
      inputs.set(p.key, () => cb.checked);
    } else if (p.type === "select") {
      const sel = h("select", { class: "input select" });
      for (const o of normalizeOptions(p.options)) {
        const opt = h("option", { value: o.value, text: o.label });
        opt.selected = String(o.value) === String(v);
        sel.append(opt);
      }
      input = sel;
      inputs.set(p.key, () => sel.value);
    } else if (p.type === "number") {
      const inp = h("input", { class: "input", type: "number", value: v ?? "" });
      if (p.min !== undefined) inp.min = String(p.min);
      if (p.max !== undefined) inp.max = String(p.max);
      if (p.step !== undefined) inp.step = String(p.step);
      input = inp;
      inputs.set(p.key, () => {
        const n = inp.value === "" ? Number(p.default) : Number(inp.value);
        return Number.isFinite(n) ? n : Number(p.default);
      });
    } else if (p.type === "textarea") {
      const ta = h("textarea", { class: "input textarea", rows: "3", placeholder: p.placeholder || "" });
      ta.value = v ?? "";
      input = ta;
      inputs.set(p.key, () => ta.value);
    } else {
      const inp = h("input", { class: "input", type: p.sensitive ? "password" : "text", value: v ?? "", placeholder: p.placeholder || "" });
      input = inp;
      inputs.set(p.key, () => inp.value);
    }
    wrap.append(h("div", { class: "field" + (p.type === "textarea" ? " wide" : "") },
      h("label", { class: "field-label" }, h("span", { text: p.label || p.key }), p.sensitive ? h("span", { class: "field-badge", text: "敏感" }) : null),
      input
    ));
  }
  const read = () => {
    const out = {};
    for (const [k, fn] of inputs) out[k] = fn();
    return out;
  };
  return { el: wrap, read };
}

export function fieldsForm(op, values) {
  const wrap = h("div", { class: "field-list" });
  const areas = [];
  for (const p of op.fields || []) {
    const ta = h("textarea", { class: "input textarea", rows: "3", placeholder: p.placeholder || "" });
    ta.value = values[p.key] ?? p.default ?? "";
    areas.push(ta);
    wrap.append(h("div", { class: "field wide" },
      h("label", { class: "field-label", text: p.label || p.key }),
      ta
    ));
  }
  return { el: wrap, read: () => areas.map((a) => a.value).join(op.fieldsJoin ?? "\n") };
}

export function statusLine() {
  const el = h("div", { class: "status-line", role: "status", "aria-live": "polite" });
  const set = (msg, kind = "") => {
    el.className = "status-line" + (kind ? " " + kind : "");
    el.textContent = msg || "";
  };
  set("");
  return { el, set };
}

export function emptyState(title, text, action) {
  return h("div", { class: "empty-card" },
    icon("wand", 30),
    h("h2", { text: title }),
    text ? h("p", { class: "muted", text }) : null,
    action || null
  );
}

export function openSheet(title, content, opts = {}) {
  const root = document.getElementById("overlay-root");
  const overlay = h("div", { class: "overlay" });
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const close = () => {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
    if (opts.onClose) opts.onClose();
  };
  document.addEventListener("keydown", onKey);
  const box = h("div", { class: "modal " + (opts.size || ""), role: "dialog", "aria-modal": "true", "aria-label": title },
    h("div", { class: "modal-head" },
      h("h2", { text: title }),
      h("button", { class: "icon-btn", type: "button", "aria-label": "关闭", onclick: close }, icon("clear", 20))
    ),
    h("div", { class: "modal-body" }, content)
  );
  overlay.append(box);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  root.append(overlay);
  return { close, box };
}

export function opPicker(ctx, onPick) {
  const input = h("input", { class: "input", type: "search", placeholder: "搜索算法 / id / 别名", autocomplete: "off" });
  const list = h("div", { class: "picker-list" });
  const render = debounce(() => {
    list.replaceChildren();
    const q = input.value.trim();
    const items = searchOps(ctx.catalog, q).slice(0, 80);
    for (const op of items) {
      const row = h("button", { class: "picker-row", type: "button" },
        h("span", { class: "picker-name", text: op.name }),
        h("span", { class: "picker-meta", text: op.id + " · " + catName(ctx, op.cat) })
      );
      row.addEventListener("click", () => onPick(op));
      list.append(row);
    }
    if (!items.length) list.append(h("p", { class: "muted pad", text: "没有匹配的算法" }));
  }, 90);
  input.addEventListener("input", render);
  render();
  const sheet = openSheet("选择算法", h("div", { class: "picker" }, input, list), { size: "tall" });
  setTimeout(() => input.focus(), 30);
  return sheet;
}

export function eduCard(op, ctx) {
  const e = op.edu;
  if (!e) return null;
  const det = h("details", { class: "edu-card" },
    h("summary", null, icon("info", 18), h("span", { text: "科普 · " + op.name })),
    e.what ? h("p", { class: "edu-what", text: e.what }) : null,
    e.principle ? h("p", { class: "edu-text", text: e.principle }) : null,
    e.usage ? h("div", { class: "edu-block" }, h("h3", { text: "怎么用" }), h("p", { class: "edu-text", text: e.usage })) : null,
    e.examples && e.examples.length ? h("div", { class: "edu-block" },
      h("h3", { text: "示例" }),
      ...e.examples.map((ex) => h("div", { class: "edu-example" },
        h("code", { text: ex.in }),
        h("span", { class: "edu-arrow", text: "→" }),
        h("code", { text: ex.out }),
        ex.param ? h("span", { class: "edu-param", text: "参数：" + ex.param }) : null
      ))
    ) : null,
    e.tips && e.tips.length ? h("div", { class: "edu-block" },
      h("h3", { text: "小贴士" }),
      h("ul", { class: "edu-tips" }, ...e.tips.map((t) => h("li", { text: t })))
    ) : null,
    op.aliases && op.aliases.length ? h("p", { class: "edu-aka", text: "别名：" + op.aliases.join(" / ") }) : null
  );
  return det;
}
