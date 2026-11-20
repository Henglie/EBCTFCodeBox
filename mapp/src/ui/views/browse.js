import { h, icon, debounce } from "../dom.js";
import { opCard, emptyState, catName } from "../components.js";
import { searchOps } from "../../core/search.js";

export function renderBrowse(root, ctx) {
  let activeCat = null;
  let query = "";
  const limit = new Map();

  const search = h("input", { class: "input search-input", type: "search", placeholder: "搜索算法 / id / 别名 / 说明…", autocomplete: "off", spellcheck: "false" });
  const chips = h("div", { class: "chips", role: "tablist" });
  const body = h("div", { class: "browse-body" });

  const renderChips = () => {
    chips.replaceChildren();
    const all = h("button", { class: "chip" + (activeCat ? "" : " active"), type: "button", role: "tab", "aria-selected": String(!activeCat) }, "全部");
    all.addEventListener("click", () => { activeCat = null; render(); });
    chips.append(all);
    for (const c of ctx.cats) {
      const b = h("button", { class: "chip" + (activeCat === c.id ? " active" : ""), type: "button", role: "tab", "aria-selected": String(activeCat === c.id) }, c.name, h("span", { class: "chip-n", text: String(c.count) }));
      b.addEventListener("click", () => { activeCat = c.id; render(); });
      chips.append(b);
    }
  };

  const renderOpList = (list, title) => {
    const key = title || "list";
    const n = limit.get(key) || 40;
    const slice = list.slice(0, n);
    const box = h("div", { class: "op-list" }, ...slice.map((op) => opCard(op, ctx)));
    if (list.length > n) {
      box.append(h("button", { class: "btn ghost load-more", type: "button", onclick: () => { limit.set(key, n + 40); render(); } }, "显示更多（" + (list.length - n) + "）"));
    }
    return h("section", { class: "section" },
      title ? h("div", { class: "section-head" }, h("h2", { text: title }), h("span", { class: "count", text: list.length + " 个" })) : null,
      box
    );
  };

  const render = () => {
    renderChips();
    body.replaceChildren();
    const q = query.trim();
    if (q) {
      const found = searchOps(ctx.catalog, q, ctx.cats);
      body.append(renderOpList(found, "搜索结果"));
      if (!found.length) body.append(emptyState("没有找到", "换个关键词，或试试英文 id / 别名。"));
      return;
    }
    if (activeCat) {
      const list = ctx.catalog.filter((op) => op.cat === activeCat);
      body.append(renderOpList(list, catName(ctx, activeCat)));
      return;
    }
    const favs = ctx.catalog.filter((op) => ctx.isFav(op.id));
    if (favs.length) {
      body.append(h("section", { class: "section" },
        h("div", { class: "section-head" }, h("h2", { text: "收藏" }), h("span", { class: "count", text: favs.length + " 个" })),
        h("div", { class: "op-list" }, ...favs.slice(0, 20).map((op) => opCard(op, ctx)))
      ));
    }
    body.append(h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", { text: "分类" })),
      h("div", { class: "cat-grid" }, ...ctx.cats.map((c) => {
        const b = h("button", { class: "cat-card", type: "button" },
          h("span", { class: "cat-card-name", text: c.name }),
          h("span", { class: "cat-card-n", text: c.count + " 个算法" })
        );
        b.addEventListener("click", () => { activeCat = c.id; render(); });
        return b;
      }))
    ));
  };

  const onSearch = debounce(() => { query = search.value; limit.clear(); render(); }, 100);
  search.addEventListener("input", onSearch);
  search.addEventListener("keydown", (e) => { if (e.key === "Escape") { search.value = ""; query = ""; render(); } });

  root.append(
    h("section", { class: "page-head" },
      h("h1", { text: "算法库" }),
      h("p", { class: "muted", text: "共 " + ctx.catalog.length + " 个本地算法，全部在浏览器内执行。" })
    ),
    h("div", { class: "search-wrap" }, icon("search", 18), search),
    chips,
    body
  );

  render();
  return () => {};
}
