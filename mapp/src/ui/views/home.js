import { h, icon, debounce } from "../dom.js";
import { copyBtn, emptyState } from "../components.js";
import { autoDecode } from "../../core/exec.js";
import { getDraft, setDraft } from "../../platform/storage.js";
import { readText } from "../../platform/clipboard.js";

const QUICK = ["base64", "base32", "base16", "url", "md5", "rot13", "atbash", "a1z26", "morse", "caesar", "htmlEntity", "unicodeEscape"];

export function renderHome(root, ctx) {
  let seq = 0;
  let busy = false;
  const token = { cancelled: false };

  const input = h("textarea", { class: "input home-input", rows: "7", placeholder: "粘贴密文 / 编码串，点「一键解码」自动尝试常见编码与经典密码…", spellcheck: "false" });
  input.value = getDraft("home");

  const status = h("p", { class: "home-status", role: "status", "aria-live": "polite" });
  const results = h("div", { class: "result-list" });

  const runBtn = h("button", { class: "btn primary", type: "button" }, icon("wand", 18), "一键解码");
  const cancelBtn = h("button", { class: "btn ghost hidden", type: "button" }, "取消");
  const pasteBtn = h("button", { class: "btn ghost", type: "button" }, icon("paste", 16), "粘贴");
  const clearBtn = h("button", { class: "btn ghost", type: "button" }, icon("clear", 16), "清空");

  const save = debounce(() => {
    const r = setDraft("home", input.value);
    if (r.truncated) status.textContent = "草稿超过 4 KiB，已截断保存";
  }, 420);

  input.addEventListener("input", save);

  const setBusy = (v) => {
    busy = v;
    runBtn.disabled = v;
    runBtn.classList.toggle("loading", v);
    cancelBtn.classList.toggle("hidden", !v);
    input.disabled = v;
  };

  const useAsInput = (text) => {
    input.value = text;
    setDraft("home", text);
    input.focus();
    const view = document.getElementById("view");
    if (view) view.scrollTo({ top: 0, behavior: "smooth" });
    ctx.toast("已送入输入框", "ok");
  };

  const renderResults = (list) => {
    results.replaceChildren();
    if (!list.length) {
      results.append(emptyState("没有识别出结果", "可能不是常见编码，或需要手动选择算法。", h("button", { class: "btn ghost", type: "button", onclick: () => ctx.navigate("#/ops") }, "去算法库")));
      return;
    }
    for (const r of list) {
      const op = r.opId ? ctx.byId.get(r.opId) : null;
      const card = h("article", { class: "result-card" },
        h("div", { class: "result-head" },
          h("div", { class: "result-title" },
            h("strong", { text: r.label }),
            op ? h("span", { class: "result-op", text: op.id }) : null
          ),
          h("span", { class: "result-score" + (r.score >= 0.9 ? " high" : ""), text: "匹配 " + Math.round(r.score * 100) })
        ),
        h("pre", { class: "result-text", text: r.output.length > 4000 ? r.output.slice(0, 4000) + "\n…（已截断显示）" : r.output }),
        h("div", { class: "result-actions" },
          copyBtn(r.output, ctx),
          op ? h("button", { class: "btn ghost small", type: "button", onclick: () => ctx.openOp(op.id) }, icon("chevron", 15), "打开算法") : null,
          h("button", { class: "btn ghost small", type: "button", onclick: () => useAsInput(r.output) }, "作为输入")
        )
      );
      results.append(card);
    }
  };

  const run = async () => {
    if (busy) return;
    const text = input.value;
    if (!text.trim()) { ctx.toast("先粘贴一段内容", "error"); input.focus(); return; }
    if (text.length > 200000) { ctx.toast("输入超过 20 万字符，请改用算法页手动处理", "error"); return; }
    const my = ++seq;
    token.cancelled = false;
    setBusy(true);
    results.replaceChildren();
    status.textContent = "正在尝试常见编码…";
    try {
      const list = await autoDecode(text, (i, n) => {
        if (my !== seq) return;
        if (n) status.textContent = "正在尝试 " + Math.min(i + 1, n) + " / " + n + " 种可能…";
      }, () => token.cancelled || my !== seq);
      if (my !== seq) return;
      if (token.cancelled) { status.textContent = "已取消"; return; }
      status.textContent = list.length ? "找到 " + list.length + " 个候选结果" : "未识别出可读结果";
      renderResults(list);
    } catch (e) {
      status.textContent = "解码失败：" + (e && e.message ? e.message : "未知错误");
    } finally {
      if (my === seq) setBusy(false);
    }
  };

  runBtn.addEventListener("click", run);
  cancelBtn.addEventListener("click", () => { token.cancelled = true; status.textContent = "正在取消…"; });
  clearBtn.addEventListener("click", () => {
    input.value = "";
    setDraft("home", "");
    results.replaceChildren();
    status.textContent = "";
    input.focus();
  });
  pasteBtn.addEventListener("click", async () => {
    try {
      const t = await readText();
      input.value = t;
      setDraft("home", t);
      ctx.toast("已粘贴", "ok");
    } catch (e) {
      ctx.toast("粘贴失败：" + (e && e.message ? e.message : "平台不允许"), "error");
    }
  });

  input.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); }
  });

  const quickOps = QUICK.map((id) => ctx.byId.get(id)).filter(Boolean).slice(0, 8);

  root.append(
    h("section", { class: "hero" },
      h("div", { class: "hero-kicker" }, icon("bolt", 16), "本地运行 · 零外发"),
      h("h1", { class: "hero-title", text: "一站式 CTF 解码" }),
      h("p", { class: "hero-sub", text: "自动尝试 Base、Hex、URL、ROT、摩斯等常见编码；也可以进入算法库手动选择。" })
    ),
    h("section", { class: "studio" },
      input,
      h("div", { class: "action-row" },
        runBtn,
        cancelBtn,
        pasteBtn,
        clearBtn,
        h("span", { class: "action-hint", text: "Ctrl / ⌘ + Enter 运行" })
      ),
      status
    ),
    results,
    h("section", { class: "section" },
      h("div", { class: "section-head" },
        h("h2", { text: "常用工具" }),
        h("button", { class: "link-btn", type: "button", onclick: () => ctx.navigate("#/ops") }, "全部算法 ", icon("chevron", 15))
      ),
      h("div", { class: "quick-grid" }, ...quickOps.map((op) => {
        const btn = h("button", { class: "quick-card", type: "button" },
          h("span", { class: "quick-name", text: op.name }),
          h("span", { class: "quick-id", text: op.id })
        );
        btn.addEventListener("click", () => ctx.openOp(op.id));
        return btn;
      }))
    ),
    h("p", { class: "foot-note", text: "全部计算在你的浏览器内完成；剪贴板与存储走 Linux.do 平台授权。" })
  );

  return () => {
    save();
    input.value = "";
  };
}
