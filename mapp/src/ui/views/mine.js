import { h, icon, fmtBytes } from "../dom.js";
import { opCard } from "../components.js";
import { draftIndex, getDraft, removeDraft, clearAll, isStorageAvailable, prefs } from "../../platform/storage.js";

export function renderMine(root, ctx) {
  const favs = ctx.catalog.filter((op) => ctx.isFav(op.id));
  const idx = draftIndex();
  const draftIds = Object.keys(idx).sort((a, b) => (idx[b].at || 0) - (idx[a].at || 0));
  const p = prefs();

  const draftList = h("div", { class: "draft-list" });
  if (!draftIds.length) {
    draftList.append(h("p", { class: "muted pad", text: "还没有保存的草稿。在首页或算法页输入内容会自动保存。" }));
  } else {
    for (const id of draftIds) {
      const op = ctx.byId.get(id);
      const text = getDraft(id);
      const label = id === "home" ? "首页 · 一键解码" : id === "recipe-input" ? "配方 · 输入" : op ? op.name : id;
      const preview = text.replace(/\s+/g, " ").slice(0, 80) || "（空）";
      const row = h("div", { class: "draft-row" },
        h("button", { class: "draft-main", type: "button", onclick: () => ctx.navigate(id === "home" ? "#/home" : id === "recipe-input" ? "#/recipe" : "#/op/" + encodeURIComponent(id)) },
          h("strong", { text: label }),
          h("span", { class: "draft-preview", text: preview }),
          h("span", { class: "draft-size", text: fmtBytes(new TextEncoder().encode(text).byteLength) })
        ),
        h("button", { class: "icon-btn tiny danger", type: "button", title: "删除草稿", onclick: () => { removeDraft(id); ctx.rerender(); ctx.toast("草稿已删除", "ok"); } }, icon("trash", 17))
      );
      draftList.append(row);
    }
  }

  const clearDrafts = h("button", { class: "btn ghost", type: "button" }, "清空全部草稿");
  clearDrafts.addEventListener("click", async () => {
    if (!(await ctx.confirm("清空草稿", "将删除全部输入草稿，收藏与参数保留。", "清空"))) return;
    for (const id of Object.keys(draftIndex())) removeDraft(id);
    ctx.rerender();
    ctx.toast("草稿已清空", "ok");
  });

  const clearAllBtn = h("button", { class: "btn danger", type: "button" }, "清空全部本地数据");
  clearAllBtn.addEventListener("click", async () => {
    if (!(await ctx.confirm("清空全部数据", "将删除收藏、参数、草稿和配方。此操作不可撤销。", "全部清空"))) return;
    await clearAll();
    location.reload();
  });

  root.append(
    h("section", { class: "page-head" },
      h("h1", { text: "我的" }),
      h("p", { class: "muted", text: "收藏、草稿与本地设置都保存在 Linux.do 平台存储中。" })
    ),
    h("section", { class: "section" },
      h("div", { class: "section-head" },
        h("h2", { text: "收藏" }),
        h("span", { class: "count", text: favs.length + " 个" })
      ),
      favs.length
        ? h("div", { class: "op-list" }, ...favs.map((op) => opCard(op, ctx)))
        : h("p", { class: "muted pad", text: "在算法页点星标即可收藏。" })
    ),
    h("section", { class: "section" },
      h("div", { class: "section-head" },
        h("h2", { text: "草稿" }),
        h("span", { class: "count", text: draftIds.length + " 个" })
      ),
      draftList,
      h("div", { class: "action-row" }, clearDrafts)
    ),
    h("section", { class: "section" },
      h("div", { class: "section-head" }, h("h2", { text: "设置" })),
      h("div", { class: "setting-list" },
        h("div", { class: "setting-row" }, h("span", { text: "主题" }), h("strong", { text: (document.documentElement.dataset.theme === "light" ? "浅色" : "深色") + " · 跟随社区" })),
        h("div", { class: "setting-row" }, h("span", { text: "动效" }), h("strong", { text: document.documentElement.dataset.reduceMotion === "true" ? "已按系统减少" : "标准" })),
        h("div", { class: "setting-row" }, h("span", { text: "存储" }), h("strong", { text: isStorageAvailable() ? "可用" : "不可用（仅本次会话）" })),
        h("div", { class: "setting-row" }, h("span", { text: "上次页面" }), h("strong", { text: p.lastRoute || "—" })),
        h("div", { class: "action-row" }, clearAllBtn)
      )
    ),
    h("section", { class: "about-card" },
      icon("bolt", 26),
      h("div", null,
        h("h2", { text: "恒烈 CTF 编码工具箱 · L 站版" }),
        h("p", { class: "muted", text: "版本 L0.1.15 · 本地算法 " + ctx.catalog.length + " 个 · 零外发" }),
        h("p", { class: "muted small-note", text: ctx.isReal ? "运行于 Linux.do 微应用沙箱。" : "当前为本地预览模式，平台能力由浏览器模拟。" })
      )
    )
  );

  return () => {};
}
