import { h, icon, debounce } from "../dom.js";
import { copyBtn, opPicker, statusLine, emptyState } from "../components.js";
import { runOp, defaultsFor } from "../../core/exec.js";
import { recipeData, setRecipeData, getDraft, setDraft, opParams } from "../../platform/storage.js";

const PRESETS = [
  { name: "Base64 → URL", nodes: [["base64", "decode"], ["url", "decode"]] },
  { name: "URL → Base64", nodes: [["url", "decode"], ["base64", "decode"]] },
  { name: "Hex → MD5", nodes: [["base16", "decode"], ["md5", "run"]] },
  { name: "Base64 → MD5", nodes: [["base64", "decode"], ["md5", "run"]] },
  { name: "Atbash → ROT13", nodes: [["atbash", "decode"], ["rot13", "decode"]] },
  { name: "HTML → URL", nodes: [["htmlEntity", "decode"], ["url", "decode"]] },
];

function defaultNodes() {
  return [{ opId: "base64", dir: "decode" }];
}

function loadNodes() {
  const saved = recipeData();
  if (saved && Array.isArray(saved.nodes) && saved.nodes.length) {
    return saved.nodes.filter((n) => n && typeof n.opId === "string").map((n) => ({ opId: n.opId, dir: n.dir || "run" }));
  }
  return defaultNodes();
}

export function renderRecipe(root, ctx) {
  let nodes = loadNodes();
  let busy = false;
  let seq = 0;
  const status = statusLine();
  const list = h("div", { class: "recipe-list" });
  const output = h("pre", { class: "io-output", tabindex: "0", "aria-label": "配方输出" });
  const input = h("textarea", { class: "input io-input", rows: "5", placeholder: "配方输入文本…", spellcheck: "false" });
  input.value = getDraft("recipe-input");

  const save = debounce(() => {
    if (!setRecipeData({ nodes })) status.set("配方过长，未能保存", "warn");
    setDraft("recipe-input", input.value);
  }, 400);

  const persist = () => {
    if (!setRecipeData({ nodes })) status.set("配方过长，未能保存", "warn");
  };

  const renderList = () => {
    list.replaceChildren();
    if (!nodes.length) {
      list.append(h("p", { class: "muted pad", text: "还没有步骤，点「添加算法」或选一个预设。" }));
      return;
    }
    nodes.forEach((node, i) => {
      const op = ctx.byId.get(node.opId);
      const dirs = [];
      if (op && op.canEncode) dirs.push("encode");
      if (op && op.canDecode) dirs.push("decode");
      if (op && op.canRun) dirs.push("run");
      const dirSel = dirs.length > 1
        ? h("select", { class: "input select mini" }, ...dirs.map((d) => {
          const o = h("option", { value: d, text: d === "encode" ? "编码" : d === "decode" ? "解码" : "运行" });
          if (d === node.dir) o.selected = true;
          return o;
        }))
        : h("span", { class: "dir-note", text: node.dir === "encode" ? "编码" : node.dir === "decode" ? "解码" : "运行" });
      if (dirs.length > 1) dirSel.addEventListener("change", () => { node.dir = dirSel.value; persist(); });
      const card = h("div", { class: "recipe-node" },
        h("span", { class: "recipe-step", text: String(i + 1) }),
        h("div", { class: "recipe-main" },
          h("strong", { text: op ? op.name : node.opId + "（缺失）" }),
          h("span", { class: "recipe-sub", text: op ? op.id : node.opId })
        ),
        dirSel,
        h("div", { class: "recipe-tools" },
          h("button", { class: "icon-btn tiny", type: "button", title: "上移", disabled: i === 0, onclick: () => move(i, -1) }, icon("up", 17)),
          h("button", { class: "icon-btn tiny", type: "button", title: "下移", disabled: i === nodes.length - 1, onclick: () => move(i, 1) }, icon("down", 17)),
          h("button", { class: "icon-btn tiny danger", type: "button", title: "删除", onclick: () => { nodes.splice(i, 1); renderList(); persist(); } }, icon("trash", 17))
        )
      );
      list.append(card);
    });
  };

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= nodes.length) return;
    [nodes[i], nodes[j]] = [nodes[j], nodes[i]];
    renderList();
    persist();
  };

  const addNode = () => {
    opPicker(ctx, (op) => {
      const dir = op.canDecode ? "decode" : op.canEncode ? "encode" : "run";
      nodes.push({ opId: op.id, dir });
      renderList();
      persist();
      ctx.toast("已加入：" + op.name, "ok");
    });
  };

  const run = async () => {
    if (busy) return;
    if (!nodes.length) { ctx.toast("配方为空", "error"); return; }
    const my = ++seq;
    const source = input.value;
    if (!source) { ctx.toast("先输入内容", "error"); input.focus(); return; }
    busy = true;
    runBtn.disabled = true;
    runBtn.classList.add("loading");
    status.set("运行中…", "run");
    let text = source;
    const steps = [];
    try {
      for (let i = 0; i < nodes.length; i++) {
        if (my !== seq) return;
        const node = nodes[i];
        const op = ctx.byId.get(node.opId);
        if (!op) throw new Error("第 " + (i + 1) + " 步算法不存在：" + node.opId);
        status.set("第 " + (i + 1) + " / " + nodes.length + " 步：" + op.name, "run");
        const r = await runOp(node.opId, node.dir, text, { ...defaultsFor(node.opId), ...opParams(node.opId) });
        text = r.text;
        steps.push({ name: op.name, dir: node.dir, out: text });
      }
      output.textContent = text;
      status.set("完成 · " + nodes.length + " 步 · " + text.length + " 字符", "ok");
      stepBox.replaceChildren(...steps.map((s, i) => h("details", { class: "step" },
        h("summary", { text: (i + 1) + ". " + s.name + " · " + (s.dir === "encode" ? "编码" : s.dir === "decode" ? "解码" : "运行") }),
        h("pre", { class: "step-out", text: s.out.length > 3000 ? s.out.slice(0, 3000) + "\n…" : s.out })
      )));
      stepWrap.classList.remove("hidden");
    } catch (e) {
      status.set("失败：" + (e && e.message ? e.message : "未知错误"), "error");
    } finally {
      if (my === seq) { busy = false; runBtn.disabled = false; runBtn.classList.remove("loading"); }
    }
  };

  const runBtn = h("button", { class: "btn primary", type: "button" }, icon("play", 17), "运行配方");
  runBtn.addEventListener("click", run);
  const addBtn = h("button", { class: "btn ghost", type: "button", onclick: addNode }, icon("plus", 16), "添加算法");
  const clearBtn = h("button", { class: "btn ghost", type: "button", onclick: () => {
    nodes = [];
    renderList();
    persist();
    output.textContent = "";
    stepWrap.classList.add("hidden");
    status.set("");
  } }, icon("trash", 16), "清空");

  const stepBox = h("div", { class: "step-list" });
  const stepWrap = h("div", { class: "steps hidden" }, h("h2", { text: "步骤输出" }), stepBox);

  const presetRow = h("div", { class: "preset-row" }, ...PRESETS.map((p) => {
    const b = h("button", { class: "chip", type: "button", text: p.name });
    b.addEventListener("click", () => {
      nodes = p.nodes.map(([opId, dir]) => ({ opId, dir }));
      renderList();
      persist();
      ctx.toast("已载入预设：" + p.name, "ok");
    });
    return b;
  }));

  input.addEventListener("input", save);
  input.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); } });

  root.append(
    h("section", { class: "page-head" },
      h("h1", { text: "配方" }),
      h("p", { class: "muted", text: "把多个算法串成一条线性流水线，全部在本地执行；步骤使用你保存的参数，没有则用默认值。" })
    ),
    h("section", { class: "recipe-input-card" },
      h("div", { class: "io-head" }, h("span", { text: "输入" }), h("span", { class: "count", text: "文本" })),
      input
    ),
    h("section", { class: "recipe-card" },
      h("div", { class: "section-head" },
        h("h2", { text: "步骤" }),
        h("div", { class: "inline-actions" }, addBtn, clearBtn)
      ),
      presetRow,
      list,
      h("div", { class: "action-row" }, runBtn),
      status.el
    ),
    h("section", { class: "recipe-output-card" },
      h("div", { class: "io-head" }, h("span", { text: "输出" }), h("span", { class: "count", text: "只读" })),
      output,
      h("div", { class: "io-actions" }, h("button", { class: "btn ghost small", type: "button", onclick: () => ctx.copy(output.textContent) }, icon("copy", 16), "复制结果"))
    ),
    stepWrap
  );

  renderList();
  return () => { save(); input.value = ""; };
}
