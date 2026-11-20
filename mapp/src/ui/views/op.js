import { h, icon, debounce } from "../dom.js";
import { paramForm, fieldsForm, favButton, statusLine, eduCard, emptyState } from "../components.js";
import { runOp, defaultsFor } from "../../core/exec.js";
import { getDraft, setDraft, opParams, saveOpParams } from "../../platform/storage.js";
import { readText } from "../../platform/clipboard.js";

const DIR_LABEL = { encode: "编码", decode: "解码", run: "运行" };

export function renderOp(root, ctx, id) {
  const op = ctx.byId.get(id);
  if (!op) {
    root.append(emptyState("算法不存在", "id：" + id, h("button", { class: "btn primary", type: "button", onclick: () => ctx.navigate("#/ops") }, "返回算法库")));
    return () => {};
  }
  let dir = op.canDecode ? "decode" : op.canEncode ? "encode" : "run";
  let seq = 0;
  let busy = false;

  const saved = opParams(op.id) || {};
  const merged = { ...defaultsFor(op.id), ...saved };
  const form = paramForm(op, merged, ctx);
  const fields = op.fields ? fieldsForm(op, merged) : null;
  const status = statusLine();

  const input = h("textarea", { class: "input io-input", rows: "8", placeholder: "输入文本…", spellcheck: "false" });
  input.value = getDraft(op.id);

  const output = h("pre", { class: "io-output", tabindex: "0", "aria-label": "输出结果" });
  const fileNote = h("p", { class: "muted small-note hidden" });
  const dirRow = h("div", { class: "segmented", role: "group", "aria-label": "方向" });

  const dirs = [];
  if (op.canEncode) dirs.push("encode");
  if (op.canDecode) dirs.push("decode");
  if (op.canRun) dirs.push("run");

  const syncDir = () => {
    for (const b of dirRow.querySelectorAll("button")) {
      const on = b.dataset.dir === dir;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    }
  };
  for (const d of dirs) {
    const b = h("button", { class: "seg-btn", type: "button", dataset: { dir: d }, onclick: () => { dir = d; syncDir(); } }, DIR_LABEL[d]);
    dirRow.append(b);
  }
  syncDir();

  const saveParams = debounce(() => {
    const all = form.read();
    const diff = {};
    const defs = defaultsFor(op.id);
    for (const [k, v] of Object.entries(all)) {
      const p = (op.params || []).find((x) => x.key === k);
      if (p && p.sensitive) continue;
      if (String(v) !== String(defs[k])) diff[k] = v;
    }
    saveOpParams(op.id, diff);
  }, 500);

  form.el.addEventListener("input", saveParams);
  form.el.addEventListener("change", saveParams);

  const saveDraft = debounce(() => {
    if (fields) return;
    const r = setDraft(op.id, input.value);
    if (r.truncated) status.set("草稿超过 4 KiB，已截断保存", "warn");
  }, 400);
  input.addEventListener("input", saveDraft);

  const runBtn = h("button", { class: "btn primary", type: "button" }, icon("play", 17), "执行");
  const clearBtn = h("button", { class: "btn ghost", type: "button" }, icon("clear", 16), "清空");
  const pasteBtn = h("button", { class: "btn ghost", type: "button" }, icon("paste", 16), "粘贴");

  const setBusy = (v) => {
    busy = v;
    runBtn.disabled = v;
    runBtn.classList.toggle("loading", v);
    input.disabled = v;
  };

  const execute = async () => {
    if (busy) return;
    const my = ++seq;
    const text = fields ? fields.read() : input.value;
    if (op.io !== "none" && !fields && !text.trim()) { ctx.toast("先输入内容", "error"); input.focus(); return; }
    setBusy(true);
    status.set("运行中…", "run");
    try {
      const params = form.read();
      const result = await runOp(op.id, dir, text, params);
      if (my !== seq) return;
      output.textContent = result.text || "";
      if (result.files.length) {
        fileNote.textContent = "该算法返回 " + result.files.length + " 个文件产物；微应用版暂不提供文件下载。";
        fileNote.classList.remove("hidden");
      } else {
        fileNote.classList.add("hidden");
      }
      status.set(result.text ? "完成 · " + result.text.length + " 字符" : "完成（空结果）", "ok");
      if (!fields) setDraft(op.id, input.value);
    } catch (e) {
      if (my !== seq) return;
      output.textContent = "";
      fileNote.classList.add("hidden");
      status.set("失败：" + (e && e.message ? e.message : "未知错误"), "error");
    } finally {
      if (my === seq) setBusy(false);
    }
  };

  runBtn.addEventListener("click", execute);
  clearBtn.addEventListener("click", () => {
    input.value = "";
    setDraft(op.id, "");
    output.textContent = "";
    fileNote.classList.add("hidden");
    status.set("");
    input.focus();
  });
  pasteBtn.addEventListener("click", async () => {
    try {
      const t = await readText();
      input.value = t;
      setDraft(op.id, t);
      ctx.toast("已粘贴", "ok");
    } catch (e) {
      ctx.toast("粘贴失败：" + (e && e.message ? e.message : "平台不允许"), "error");
    }
  });

  input.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); execute(); }
  });

  const useResult = () => {
    if (!output.textContent) return;
    input.value = output.textContent;
    setDraft(op.id, input.value);
    input.focus();
    ctx.toast("已把结果放回输入", "ok");
  };

  const outActions = h("div", { class: "io-actions" },
    h("button", { class: "btn ghost small", type: "button", onclick: () => ctx.copy(output.textContent) }, icon("copy", 16), "复制结果"),
    h("button", { class: "btn ghost small", type: "button", onclick: useResult }, "作为输入"),
    h("button", { class: "btn ghost small", type: "button", onclick: () => ctx.navigate("#/recipe") }, "去配方")
  );

  const paramSection = (op.params && op.params.length) || fields
    ? h("section", { class: "op-config" },
      h("div", { class: "config-head" }, h("h2", { text: "参数" }), saved && Object.keys(saved).length ? h("span", { class: "count", text: "已记住" }) : null),
      form.el,
      fields ? fields.el : null
    )
    : null;

  const ioSection = h("section", { class: "op-io" },
    op.io === "none" || fields ? null : h("div", { class: "io-block" },
      h("div", { class: "io-head" }, h("span", { text: "输入" }), h("span", { class: "count", text: "文本" })),
      input
    ),
    h("div", { class: "action-row" }, runBtn, clearBtn, pasteBtn),
    h("div", { class: "io-block" },
      h("div", { class: "io-head" }, h("span", { text: "输出" }), h("span", { class: "count", text: "只读" })),
      output,
      fileNote,
      outActions
    )
  );

  root.append(
    h("div", { class: "op-page" },
      h("div", { class: "op-top" },
        h("button", { class: "icon-btn", type: "button", "aria-label": "返回", onclick: () => ctx.navigate("#/ops") }, icon("back", 22)),
        h("div", { class: "op-heading" },
          h("div", { class: "op-head-line" },
            h("h1", { text: op.name }),
            favButton(op.id, ctx)
          ),
          h("p", { class: "op-sub", text: op.id + " · " + (op.desc || "") })
        )
      ),
      h("div", { class: "op-meta" },
        dirs.length > 1 ? dirRow : h("span", { class: "dir-note", text: DIR_LABEL[dir] }),
        op.aliases && op.aliases.length ? h("span", { class: "aliases", text: "别名：" + op.aliases.slice(0, 5).join(" / ") }) : null
      ),
      paramSection,
      ioSection,
      status.el,
      eduCard(op, ctx)
    )
  );

  return () => {
    saveParams();
    saveDraft();
    input.value = "";
  };
}
