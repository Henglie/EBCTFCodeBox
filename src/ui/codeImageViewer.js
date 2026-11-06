// codeImageViewer.js — 图形编码对照表查询器（外星文字/游戏文字/古文字/符号/旗语/条码等）
// 左侧分类树 + 名称/别名搜索 + 右侧大图 + 自动识图（条码解码 / 视觉对照候选）。
// 图片走本地 public/codeimages/，IntersectionObserver 懒加载，点击看大图。
// 自持 el/msym（icon 注水），tt/window.__ebctfT 兜底 i18n（不进主表）。零外发。
import { icon as iconSvg } from "./icons.js";
import { attachModalLifecycle } from "./modalLifecycle.js";

function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}
function msym(name, cls = "") {
  const s = el("span", { class: "msym" + (cls ? " " + cls : "") });
  s.innerHTML = iconSvg(name);
  return s;
}
function tt(key, ...args) {
  try { if (typeof window !== "undefined" && window.__ebctfT) { const s = window.__ebctfT(key, ...args); if (s && s !== key) return s; } } catch { /* 回退 */ }
  let s = CI_FALLBACK[key] || key;
  for (let i = 0; i < args.length; i++) s = s.replace("{" + i + "}", String(args[i]));
  return s;
}
function toast(msg) {
  try { if (typeof window !== "undefined" && window.__ebctfToast) { window.__ebctfToast(msg); return; } } catch { /* 回退 */ }
}

// i18n 未接线时的中文兜底
const CI_FALLBACK = {
  "ui.ci.title": "编码图查询器",
  "ui.ci.desc": "244 张图形编码对照表：外星文字 / 游戏文字 / 古代文字 / 符号 / 旗语手语 / 条码等，人肉对照解码用。",
  "ui.ci.search": "搜索名称 / 别名…",
  "ui.ci.all": "全部",
  "ui.ci.empty": "无匹配结果。",
  "ui.ci.pick": "从左侧选择一张编码图查看。",
  "ui.ci.count": "共 {0} 张",
  "ui.ci.unconfirmed": "待确认",
  "ui.ci.alias": "别名",
  "ui.ci.loadFail": "图片加载失败",
  "ui.ci.zoom": "点击放大",
  "ui.ci.close": "关闭",
  "ui.ci.zoomHint": "滚轮缩放 · 拖拽平移 · 双击复位",
  "ui.ci.cat.alien": "外星文字",
  "ui.ci.cat.game": "游戏文字",
  "ui.ci.cat.ancient": "古代文字",
  "ui.ci.cat.symbol": "符号编码",
  "ui.ci.cat.flag": "旗语手语",
  "ui.ci.cat.barcode": "条码",
  "ui.ci.cat.other": "其他",
  "ui.ci.rec.title": "自动识图",
  "ui.ci.rec.desc": "上传题目图片：先跑二维码/条形码解码，再做字形与整图对照，给出最可能的编码样式和对照表。全程本地计算。",
  "ui.ci.rec.upload": "上传题目图片",
  "ui.ci.rec.drop": "或把图片拖到这里",
  "ui.ci.rec.running": "识别中…",
  "ui.ci.rec.fail": "识别失败：{0}",
  "ui.ci.rec.barcode": "读码命中",
  "ui.ci.rec.noBarcode": "未读到二维码/条形码。",
  "ui.ci.rec.candidates": "候选编码样式",
  "ui.ci.rec.noCandidates": "没有足够相似的对照表。可继续按字形/别名搜索。",
  "ui.ci.rec.glyphs": "检测到 {0} 个符号，去重后 {1} 类",
  "ui.ci.rec.matchGlyphs": "字形吻合 {0} 个",
  "ui.ci.rec.score": "相似度 {0}%",
  "ui.ci.rec.open": "打开对照表",
  "ui.ci.rec.hint": "视觉对照只负责「像哪张编码表」；外星文字/游戏文字的字形→字母映射仍需按对照表人工确认。",
  "ui.ci.rec.reset": "重新选择",
  "ui.ci.rec.copy": "复制",
  "ui.ci.rec.copied": "已复制",
  "ui.ci.rec.sequence": "字形序列与权重",
  "ui.ci.rec.candidate": "候选",
  "ui.ci.rec.seqHint": "当前还没有该对照表的字形映射。设置映射后才会输出文本；未填槽位显示 ?，不按字母表猜。",
  "ui.ci.rec.setMap": "设置字形映射",
  "ui.ci.rec.mapHint": "按左侧槽位填字符（留空=未知）。保存后立即用同一张图重新解码。",
  "ui.ci.rec.saveMap": "保存映射并解码",
  "ui.ci.rec.mapped": "已映射 {0}/{1}",
  "ui.ci.rec.slot": "槽位 {0}",
  "ui.ci.rec.mappingSaved": "字形映射已保存",
  "ui.ci.rec.weights": "权重：字形 {0} / 哈希 {1} / 直方图 {2} / 比例 {3}",
};

// 字形槽位→字符映射：按对照表 id 存 localStorage；只存映射，不存用户图片/结果。
const GLYPH_MAP_KEY = "ebctf.codeimage.glyphmaps";
function loadGlyphMaps() {
  try {
    const v = JSON.parse(localStorage.getItem(GLYPH_MAP_KEY) || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}
function saveGlyphMaps(maps) {
  try { localStorage.setItem(GLYPH_MAP_KEY, JSON.stringify(maps)); } catch { /* 隐私模式忽略 */ }
}

const CAT_LABEL_KEY = {
  alien: "ui.ci.cat.alien",
  game: "ui.ci.cat.game",
  ancient: "ui.ci.cat.ancient",
  symbol: "ui.ci.cat.symbol",
  flag: "ui.ci.cat.flag",
  barcode: "ui.ci.cat.barcode",
  other: "ui.ci.cat.other",
};
const catLabel = (cat) => (CAT_LABEL_KEY[cat] ? tt(CAT_LABEL_KEY[cat]) : cat);
const CAT_ORDER = ["alien", "game", "ancient", "symbol", "flag", "barcode", "other"];
const CAT_ICON = {
  alien: "auto_awesome",
  game: "apps",
  ancient: "history_edu",
  symbol: "tag",
  flag: "graphic_eq",
  barcode: "dialpad",
  other: "image",
};

const MANIFEST_URL = "public/codeimages/codeImageManifest.json";
const IMG_BASE = "public/";

const ciState = {
  manifest: null,
  fpManifest: null,
  fpPromise: null,
  activeCat: "all",
  query: "",
  selected: null,
};

let _io = null;

function ensureIO() {
  if (_io) return _io;
  if (typeof IntersectionObserver === "undefined") return null;
  _io = new IntersectionObserver((entries, obs) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const img = e.target;
      const src = img.getAttribute("data-src");
      if (src && !img.getAttribute("src")) img.setAttribute("src", src);
      obs.unobserve(img);
    }
  }, { rootMargin: "300px" });
  return _io;
}

function matches(img, q) {
  if (!q) return true;
  const hay = [img.cn, img.en, ...(img.alias || [])].join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}
function cnName(img) { return img.cn || img.en; }
function thumbSrc(im) { return IMG_BASE + "codeimages/thumbs/" + im.id + ".webp"; }

function loadFingerprints() {
  if (ciState.fpManifest) return Promise.resolve(ciState.fpManifest);
  if (ciState.fpPromise) return ciState.fpPromise;
  ciState.fpPromise = fetch("public/codeimages/codeImageFingerprints.json", { cache: "force-cache" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => { ciState.fpManifest = j; return j; })
    .catch(() => null);
  return ciState.fpPromise;
}

// ---- 渲染主入口 ----
export async function renderCodeImageViewer(container) {
  container.innerHTML = "";
  const wrap = el("div", { class: "ci-view" });

  wrap.append(el("div", { class: "op-head" },
    el("div", { class: "op-title" }, msym("image"), tt("ui.ci.title")),
    el("div", { class: "op-desc" }, tt("ui.ci.desc")),
  ));

  const rec = buildRecognizePanel();
  wrap.append(rec.root);

  const body = el("div", { class: "ci-body" });
  wrap.append(body);
  container.append(wrap);

  if (!ciState.manifest) {
    try {
      const r = await fetch(MANIFEST_URL, { cache: "force-cache" });
      ciState.manifest = await r.json();
    } catch (err) {
      body.append(el("div", { class: "ci-empty" }, tt("ui.ci.loadFail") + "：" + (err && err.message || err)));
      return;
    }
  }

  const imgs = ciState.manifest.images || [];
  rec.setManifest(imgs);

  const side = el("div", { class: "ci-side" });
  const searchBox = el("input", {
    class: "ci-search", type: "search", placeholder: tt("ui.ci.search"),
    spellcheck: "false",
  });
  searchBox.value = ciState.query;
  const tree = el("div", { class: "ci-tree" });
  side.append(searchBox, tree);

  const main = el("div", { class: "ci-main" });
  const grid = el("div", { class: "ci-grid" });
  main.append(grid);
  body.append(side, main);

  const cardById = new Map();
  let allBuilt = false;

  function catCount(cat) {
    return imgs.filter((im) => (cat === "all" || im.cat === cat) && matches(im, ciState.query)).length;
  }

  function buildTree() {
    tree.innerHTML = "";
    tree.append(treeItem("all", tt("ui.ci.all"), "apps", catCount("all")));
    for (const cat of CAT_ORDER) {
      const c = catCount(cat);
      if (c === 0 && ciState.query) continue;
      tree.append(treeItem(cat, catLabel(cat), CAT_ICON[cat] || "image", c));
    }
  }

  function treeItem(cat, label, ic, count) {
    return el("button", {
      class: "ci-tree-item" + (ciState.activeCat === cat ? " active" : ""),
      onclick: () => { ciState.activeCat = cat; buildTree(); applyFilter(); },
    },
      msym(ic, "ci-tree-ic"),
      el("span", { class: "ci-tree-label" }, label),
      el("span", { class: "ci-tree-count" }, String(count)),
    );
  }

  function buildAllCards() {
    if (allBuilt) return;
    allBuilt = true;
    const io = ensureIO();
    const frag = document.createDocumentFragment();
    for (const im of imgs) {
      const thumb = el("img", {
        class: "ci-thumb-img", alt: cnName(im), loading: "lazy", decoding: "async",
        "data-src": thumbSrc(im), width: "160", height: "120",
      });
      thumb.addEventListener("error", () => {
        if (thumb.dataset.retried) { thumb.classList.add("ci-thumb-err"); return; }
        thumb.dataset.retried = "1";
        thumb.setAttribute("src", IMG_BASE + im.file);
      });
      if (io) io.observe(thumb);
      else thumb.setAttribute("src", thumbSrc(im));

      const unconf = /（待确认）$/.test(im.cn);
      const card = el("button", {
        class: "ci-card",
        title: cnName(im),
        onclick: () => openModal(im),
      },
        el("div", { class: "ci-thumb" }, thumb),
        el("div", { class: "ci-card-name" }, cnName(im).replace(/（待确认）$/, "")),
        unconf ? el("span", { class: "ci-badge" }, tt("ui.ci.unconfirmed")) : null,
      );
      card._img = im;
      cardById.set(im.id, card);
      frag.append(card);
    }
    grid.append(frag);
  }

  function applyFilter() {
    buildAllCards();
    let visible = 0;
    const q = ciState.query;
    for (const im of imgs) {
      const card = cardById.get(im.id);
      if (!card) continue;
      const ok = (ciState.activeCat === "all" || im.cat === ciState.activeCat) && matches(im, q);
      card.classList.toggle("ci-hidden", !ok);
      if (ok) visible++;
    }
    const empty = grid.querySelector(".ci-empty");
    if (!visible) {
      if (!empty) grid.append(el("div", { class: "ci-empty" }, tt("ui.ci.empty")));
    } else if (empty) empty.remove();
  }

  let sTimer = 0;
  searchBox.addEventListener("input", () => {
    clearTimeout(sTimer);
    sTimer = setTimeout(() => {
      ciState.query = searchBox.value.trim();
      buildTree();
      applyFilter();
    }, 120);
  });

  buildTree();
  applyFilter();
}

// ---- 自动识图面板 ----
function buildRecognizePanel() {
  let manifest = [];
  let busy = false;

  const input = el("input", { type: "file", accept: "image/*", class: "ci-rec-file" });
  const drop = el("div", { class: "ci-rec-drop" },
    msym("upload", "ci-rec-drop-ic"),
    el("div", { class: "ci-rec-drop-main" }, tt("ui.ci.rec.upload")),
    el("div", { class: "ci-rec-drop-sub" }, tt("ui.ci.rec.drop")),
  );
  const status = el("div", { class: "ci-rec-status" });
  const result = el("div", { class: "ci-rec-result" });
  const resetBtn = el("button", {
    class: "ci-rec-reset", type: "button", hidden: "hidden",
    onclick: () => {
      input.value = ""; result.innerHTML = ""; status.textContent = ""; resetBtn.hidden = true;
      lastFile = null; lastBytes = null;
    },
  }, tt("ui.ci.rec.reset"));

  const pick = () => { if (!busy) input.click(); };
  drop.addEventListener("click", pick);
  input.addEventListener("change", () => { if (input.files && input.files[0]) handleFile(input.files[0]); });
  drop.addEventListener("dragover", (e) => { e.preventDefault(); drop.classList.add("drag"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("drag"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("drag");
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) handleFile(f);
  });

  let lastFile = null;
  let lastBytes = null;

  async function handleFile(file) {
    if (!file || !/^image\//i.test(file.type || "")) { status.textContent = tt("ui.ci.rec.fail", "不是图片文件"); return; }
    const bytes = new Uint8Array(await file.arrayBuffer());
    lastFile = file;
    lastBytes = bytes;
    await runRecognition();
  }

  async function runRecognition() {
    if (!lastFile || !lastBytes) return;
    busy = true;
    result.innerHTML = "";
    status.textContent = tt("ui.ci.rec.running");
    resetBtn.hidden = false;
    try {
      const fp = await loadFingerprints();
      const { recognizeCodeImage } = await import("../core/codeImageRecognize.js");
      const r = await recognizeCodeImage(lastBytes.slice(), {
        manifest,
        fingerprints: fp && fp.images,
        mappings: loadGlyphMaps(),
      });
      renderResult(r, lastFile);
      status.textContent = "";
    } catch (e) {
      status.textContent = tt("ui.ci.rec.fail", e && e.message ? e.message : e);
    } finally {
      busy = false;
    }
  }

  function renderResult(r, file) {
    result.innerHTML = "";
    const preview = el("div", { class: "ci-rec-preview" },
      el("img", { src: URL.createObjectURL(file), alt: file.name }),
      el("div", { class: "ci-rec-meta" },
        el("div", { class: "ci-rec-name" }, file.name),
        el("div", { class: "ci-rec-sub" }, (r.width || 0) + "×" + (r.height || 0)),
        r.glyphCount
          ? el("div", { class: "ci-rec-sub" }, tt("ui.ci.rec.glyphs", r.glyphCount, r.glyphKinds || 0))
          : null,
      ),
    );
    result.append(preview);

    if (r.barcodes && r.barcodes.length) {
      const box = el("div", { class: "ci-rec-block ci-rec-hit" },
        el("div", { class: "ci-rec-block-title" }, msym("qr_code"), tt("ui.ci.rec.barcode")),
      );
      for (const b of r.barcodes) {
        const line = el("div", { class: "ci-rec-barcode" },
          el("span", { class: "ci-rec-barcode-fmt" }, b.format || "barcode"),
          el("code", { class: "ci-rec-barcode-text" }, b.text),
        );
        const copy = el("button", {
          class: "ci-rec-copy", type: "button", title: tt("ui.ci.rec.copy"),
          onclick: async () => {
            try { await navigator.clipboard.writeText(b.text); toast(tt("ui.ci.rec.copied")); } catch { /* ignore */ }
          },
        }, msym("content_copy"));
        line.append(copy);
        box.append(line);
      }
      result.append(box);
    } else {
      result.append(el("div", { class: "ci-rec-block ci-rec-muted" }, tt("ui.ci.rec.noBarcode")));
    }

    const cands = r.candidates || [];
    const box = el("div", { class: "ci-rec-block" },
      el("div", { class: "ci-rec-block-title" }, msym("travel_explore"), tt("ui.ci.rec.candidates")),
    );
    if (!cands.length) {
      box.append(el("div", { class: "ci-rec-muted" }, tt("ui.ci.rec.noCandidates")));
    } else {
      const list = el("div", { class: "ci-rec-cands" });
      for (const c of cands) {
        const im = c.image;
        const card = el("button", {
          class: "ci-rec-cand", type: "button",
          onclick: () => openModal(im),
        },
          el("img", { src: thumbSrc(im), alt: cnName(im), loading: "lazy" }),
          el("div", { class: "ci-rec-cand-main" },
            el("div", { class: "ci-rec-cand-name" }, cnName(im).replace(/（待确认）$/, "")),
            el("div", { class: "ci-rec-cand-meta" },
              el("span", { class: "ci-rec-score" }, tt("ui.ci.rec.score", Math.round(c.score * 100))),
              c.glyphMatched ? el("span", {}, tt("ui.ci.rec.matchGlyphs", c.glyphMatched)) : null,
              el("span", {}, catLabel(im.cat)),
            ),
          ),
        );
        list.append(card);
      }
      box.append(list);
    }
    result.append(box);
    appendSequenceBlock(result, r, (r.sequences || [])[0]);
    result.append(el("div", { class: "ci-rec-hint" }, tt("ui.ci.rec.hint")));
  }

  function appendSequenceBlock(host, r, seq) {
    if (!seq) return;
    const block = el("div", { class: "ci-rec-block ci-rec-seq-block" },
      el("div", { class: "ci-rec-block-title" }, msym("data_array"), tt("ui.ci.rec.sequence")),
    );
    const w = r.weights || {};
    block.append(el("div", { class: "ci-rec-muted" },
      tt("ui.ci.rec.weights",
        Math.round((w.glyph || 0) * 100), Math.round((w.hash || 0) * 100),
        Math.round((w.hist || 0) * 100), Math.round((w.aspect || 0) * 100))));
    block.append(el("div", { class: "ci-rec-seq" },
      seq.glyphs.map((g) => (g.slot >= 0 ? String(g.slot) : "?")).join(" ")));

    function applyCandidate(slot, ch) {
      if (!(slot >= 0) || ch == null || ch === "") return;
      const maps = loadGlyphMaps();
      const labels = Array.isArray(maps[seq.chartId]) ? maps[seq.chartId].slice() : [];
      labels[slot] = String(ch);
      maps[seq.chartId] = labels;
      saveGlyphMaps(maps);
      toast(tt("ui.ci.rec.mappingSaved"));
      runRecognition();
    }

    if (seq.glyphs.length) {
      const candRow = el("div", {
        class: "ci-rec-seq",
        style: "display:flex;flex-wrap:wrap;gap:var(--sp-1);align-items:center;",
      }, el("span", { class: "ci-rec-muted", style: "flex:none;" }, tt("ui.ci.rec.candidate")));
      for (const g of seq.glyphs) {
        const cands = Array.isArray(g.charCandidates) ? g.charCandidates : [];
        const kids = [el("span", {
          class: "ci-rec-map-slot",
          title: g.cellId ? g.cellId : "",
          "data-cell": g.cellId || "",
        }, "#" + (g.slot >= 0 ? g.slot : "?"))];
        cands.forEach((c, i) => {
          if (i) kids.push(el("span", { class: "ci-rec-muted" }, "/"));
          const targetSlot = g.slot >= 0 ? g.slot : c.slot;
          kids.push(el("button", {
            class: "ci-rec-map-btn", type: "button",
            style: "height:22px;padding:0 7px;font-size:var(--fs-xs);line-height:1;",
            title: tt("ui.ci.rec.slot", targetSlot) + " · " + Math.round((Number(c.score) || 0) * 100) + "%",
            onclick: () => applyCandidate(targetSlot, c.char),
          }, c.char));
        });
        if (!cands.length) kids.push(el("span", { class: "ci-rec-muted" }, "?"));
        candRow.append(el("span", {
          style: "display:inline-flex;align-items:center;gap:4px;padding:1px 6px;border:1px solid var(--outline-var);border-radius:var(--r-full);",
        }, kids));
      }
      block.append(candRow);
    }

    if (seq.mapped > 0) {
      block.append(el("pre", { class: "ci-rec-decoded" }, seq.text));
      block.append(el("div", { class: "ci-rec-muted" },
        tt("ui.ci.rec.mapped", seq.mapped, seq.total)));
      const copy = el("button", {
        class: "ci-rec-copy", type: "button", title: tt("ui.ci.rec.copy"),
        onclick: async () => {
          try { await navigator.clipboard.writeText(seq.text); toast(tt("ui.ci.rec.copied")); } catch { /* ignore */ }
        },
      }, msym("content_copy"));
      block.append(copy);
    } else {
      block.append(el("div", { class: "ci-rec-muted" }, tt("ui.ci.rec.seqHint")));
    }

    const editor = el("div", { class: "ci-rec-map", hidden: "hidden" });
    const mapBtn = el("button", { class: "ci-rec-map-btn", type: "button" }, tt("ui.ci.rec.setMap"));
    mapBtn.addEventListener("click", () => {
      editor.hidden = !editor.hidden;
      if (!editor.childNodes.length) buildEditor();
    });
    block.append(mapBtn, editor);

    function buildEditor() {
      const maps = loadGlyphMaps();
      const old = Array.isArray(maps[seq.chartId]) ? maps[seq.chartId] : [];
      const used = [...new Set(seq.glyphs.map((g) => g.slot).filter((s) => s >= 0))].sort((a, b) => a - b);
      editor.append(el("div", { class: "ci-rec-muted" }, tt("ui.ci.rec.mapHint")));
      const rows = el("div", { class: "ci-rec-map-rows" });
      const inputs = [];
      for (const slot of used) {
        const inp = el("input", {
          class: "ci-rec-map-inp", type: "text", maxlength: "8",
          placeholder: "?", value: old[slot] || "", "aria-label": tt("ui.ci.rec.slot", slot),
        });
        inp.dataset.slot = String(slot);
        inputs.push(inp);
        rows.append(el("label", { class: "ci-rec-map-row" },
          el("span", { class: "ci-rec-map-slot" }, tt("ui.ci.rec.slot", slot)), inp));
      }
      const save = el("button", { class: "ci-rec-map-save", type: "button" }, tt("ui.ci.rec.saveMap"));
      save.addEventListener("click", async () => {
        const labels = Array.isArray(old) ? old.slice() : [];
        for (const inp of inputs) {
          const slot = Number(inp.dataset.slot);
          const v = inp.value.trim();
          if (v) labels[slot] = v; else delete labels[slot];
        }
        const next = loadGlyphMaps();
        next[seq.chartId] = labels;
        saveGlyphMaps(next);
        toast(tt("ui.ci.rec.mappingSaved"));
        await runRecognition();
      });
      editor.append(rows, save);
    }

    host.append(block);
  }

  const root = el("div", { class: "ci-rec" },
    el("div", { class: "ci-rec-head" },
      el("div", { class: "ci-rec-title" }, msym("auto_awesome"), tt("ui.ci.rec.title")),
      el("div", { class: "ci-rec-desc" }, tt("ui.ci.rec.desc")),
      resetBtn,
    ),
    drop, input, status, result,
  );

  return {
    root,
    setManifest(list) { manifest = list || []; },
  };
}

// ---- 模态大图弹窗（滚轮缩放）----
let _modalEl = null;
let _lifecycle = null;

function closeModal(immediate = false) {
  if (_lifecycle) { _lifecycle.release(); _lifecycle = null; }
  const ov = _modalEl;
  _modalEl = null;
  if (!ov) return;
  if (immediate || ov._closing) { ov.remove(); return; }
  ov._closing = true;
  ov.classList.add("ci-closing");
  setTimeout(() => { if (ov.isConnected) ov.remove(); }, 250);
}

function openModal(im) {
  closeModal(true);
  const previousFocus = document.activeElement;

  const unconf = /（待确认）$/.test(im.cn);
  const aliasStr = (im.alias || []).join("、");

  let scale = 1;
  let tx = 0, ty = 0;
  const MIN = 0.5, MAX = 5, STEP = 0.0015;

  const big = el("img", {
    class: "ci-modal-img", alt: cnName(im), src: IMG_BASE + im.file,
    draggable: "false",
  });
  big.addEventListener("error", () => big.classList.add("ci-thumb-err"));

  function applyTransform() {
    big.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

  const stage = el("div", { class: "ci-modal-stage" }, big);

  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const prev = scale;
    let next = prev * Math.exp(-e.deltaY * STEP);
    next = Math.max(MIN, Math.min(MAX, next));
    if (next === prev) return;
    const rect = stage.getBoundingClientRect();
    const cx = e.clientX - (rect.left + rect.width / 2);
    const cy = e.clientY - (rect.top + rect.height / 2);
    const ratio = next / prev;
    tx = cx - (cx - tx) * ratio;
    ty = cy - (cy - ty) * ratio;
    scale = next;
    applyTransform();
  }, { passive: false });

  let dragging = false, sx = 0, sy = 0, otx = 0, oty = 0;
  stage.addEventListener("pointerdown", (e) => {
    dragging = true; sx = e.clientX; sy = e.clientY; otx = tx; oty = ty;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add("dragging");
  });
  stage.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tx = otx + (e.clientX - sx);
    ty = oty + (e.clientY - sy);
    applyTransform();
  });
  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    try { stage.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    stage.classList.remove("dragging");
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);
  stage.addEventListener("dblclick", () => {
    scale = 1; tx = 0; ty = 0; applyTransform();
  });

  const closeBtn = el("button", {
    class: "ci-modal-close", type: "button", title: tt("ui.ci.close"),
    "aria-label": tt("ui.ci.close"),
    onclick: () => closeModal(),
  }, msym("close"));

  const head = el("div", { class: "ci-modal-head" },
    el("div", { class: "ci-modal-titles" },
      el("div", { class: "ci-modal-title" },
        cnName(im).replace(/（待确认）$/, ""),
        unconf ? el("span", { class: "ci-badge" }, tt("ui.ci.unconfirmed")) : null,
      ),
      el("div", { class: "ci-modal-meta" },
        im.en ? el("span", { class: "ci-modal-en" }, im.en) : null,
        aliasStr ? el("span", { class: "ci-modal-alias" }, tt("ui.ci.alias") + "：" + aliasStr) : null,
        el("span", { class: "ci-modal-dim" }, im.w + "×" + im.h),
        el("span", { class: "ci-modal-cat" }, catLabel(im.cat)),
      ),
    ),
    closeBtn,
  );

  const dialog = el("div", {
    class: "ci-modal-dialog", role: "dialog", "aria-modal": "true",
    "aria-label": cnName(im).replace(/（待确认）$/, ""),
    onclick: (e) => e.stopPropagation(),
  }, head, stage,
    el("div", { class: "ci-modal-hint" }, tt("ui.ci.zoomHint")),
  );

  _modalEl = el("div", { class: "ci-modal-overlay" }, dialog);
  document.body.append(_modalEl);
  _lifecycle = attachModalLifecycle(_modalEl, { dialog, onClose: closeModal, initialFocus: closeBtn, restoreFocusTo: previousFocus });

  applyTransform();
}

