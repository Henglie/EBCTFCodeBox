// codeImageViewer.js — 图形编码对照表查询器（244 张外星文字/游戏文字/古文字/符号/旗语/条码等）
// 图片来源：224 种编码图鉴，版权归原作者，此处仅内嵌引用。
// 左侧分类树（按中文分类分组）+ 名称/别名搜索 + 右侧大图 + 名称/别名。
// 图片走本地 public/codeimages/，IntersectionObserver 懒加载，点击看大图。
// 自持 el/msym（icon 注水），tt/window.__ebctfT 兜底 i18n（不进主表）。零外发。
import { icon as iconSvg } from "./icons.js";

// ---- 轻量 DOM 工具（本模块自持，零耦合）----
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

// i18n 未接线时的中文兜底
const CI_FALLBACK = {
  "ui.ci.title": "编码图查询器",
  "ui.ci.desc": "244 张图形编码对照表：外星文字 / 游戏文字 / 古代文字 / 符号 / 旗语手语 / 条码等，人肉对照解码用。",
  "ui.ci.search": "搜索名称 / 别名…",
  "ui.ci.all": "全部",
  "ui.ci.empty": "无匹配结果。",
  "ui.ci.pick": "从左侧选择一张编码图查看。",
  "ui.ci.count": "共 {0} 张",
  "ui.ci.source": "图片来源：224 种编码图鉴，版权归原作者，此处仅内嵌引用。",
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
};

// 分类名 i18n key（与 manifest.cat 对应）。中文兜底并入 CI_FALLBACK，走 tt() 取当前语言。
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

// ---- 状态（会话态）----
const ciState = {
  manifest: null,   // { images:[...] }
  activeCat: "all", // 当前分类过滤
  query: "",        // 搜索词
  selected: null,   // 当前选中的 image 对象
};

let _io = null; // IntersectionObserver（缩略图懒加载）

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
  }, { rootMargin: "200px" });
  return _io;
}

function matches(img, q) {
  if (!q) return true;
  const hay = [img.cn, img.en, ...(img.alias || [])].join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}

function cnName(img) {
  return img.cn || img.en;
}

// ---- 渲染主入口 ----
export async function renderCodeImageViewer(container) {
  container.innerHTML = "";
  const wrap = el("div", { class: "ci-view" });

 // 标题
  wrap.append(el("div", { class: "op-head" },
    el("div", { class: "op-title" }, msym("image"), tt("ui.ci.title")),
    el("div", { class: "op-desc" }, tt("ui.ci.desc")),
  ));

 // 来源致谢横幅（显著标注）
  wrap.append(el("div", { class: "ci-credit" },
    msym("info"), el("span", {}, tt("ui.ci.source")),
  ));

  const body = el("div", { class: "ci-body" });
  wrap.append(body);
  container.append(wrap);

 // 载入 manifest（首次）
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

 // ---- 左栏：分类树 + 搜索 ----
  const side = el("div", { class: "ci-side" });
  const searchBox = el("input", {
    class: "ci-search", type: "search", placeholder: tt("ui.ci.search"),
    spellcheck: "false",
  });
  searchBox.value = ciState.query;
  const tree = el("div", { class: "ci-tree" });
  side.append(searchBox, tree);

 // ---- 右栏：网格（点击卡片弹模态大图）----
  const main = el("div", { class: "ci-main" });
  const grid = el("div", { class: "ci-grid" });
  main.append(grid);

  body.append(side, main);

 // 统计各分类数量
  function catCount(cat) {
    return imgs.filter((im) => (cat === "all" || im.cat === cat) && matches(im, ciState.query)).length;
  }

  function buildTree() {
    tree.innerHTML = "";
 // 全部
    const total = catCount("all");
    tree.append(treeItem("all", tt("ui.ci.all"), "apps", total));
    for (const cat of CAT_ORDER) {
      const c = catCount(cat);
      if (c === 0 && ciState.query) continue; // 搜索时隐藏空分类
      tree.append(treeItem(cat, catLabel(cat), CAT_ICON[cat] || "image", c));
    }
  }

  function treeItem(cat, label, ic, count) {
    const active = ciState.activeCat === cat;
    return el("button", {
      class: "ci-tree-item" + (active ? " active" : ""),
      onclick: () => { ciState.activeCat = cat; buildTree(); buildGrid(); },
    },
      msym(ic, "ci-tree-ic"),
      el("span", { class: "ci-tree-label" }, label),
      el("span", { class: "ci-tree-count" }, String(count)),
    );
  }

  function buildGrid() {
    grid.innerHTML = "";
    const io = ensureIO();
    const list = imgs.filter((im) =>
      (ciState.activeCat === "all" || im.cat === ciState.activeCat) && matches(im, ciState.query));

    if (list.length === 0) {
      grid.append(el("div", { class: "ci-empty" }, tt("ui.ci.empty")));
      return;
    }

    for (const im of list) {
      const thumb = el("img", {
        class: "ci-thumb-img", alt: cnName(im), loading: "lazy",
        "data-src": IMG_BASE + im.file, width: "160",
      });
      thumb.addEventListener("error", () => thumb.classList.add("ci-thumb-err"));
      if (io) io.observe(thumb);
      else thumb.setAttribute("src", IMG_BASE + im.file); // 无 IO 时直接加载

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
      card._imgId = im.id;
      grid.append(card);
    }
  }

 // 搜索防抖
  let sTimer = 0;
  searchBox.addEventListener("input", () => {
    clearTimeout(sTimer);
    sTimer = setTimeout(() => {
      ciState.query = searchBox.value.trim();
      buildTree();
      buildGrid();
    }, 150);
  });

  buildTree();
  buildGrid();
}

// ---- 模态大图弹窗（滚轮缩放）----
// 全局单例：任意时刻只允许一个弹窗
let _modalEl = null;      // 遮罩根节点
let _modalKeyHandler = null;

function closeModal() {
  if (_modalKeyHandler) {
    document.removeEventListener("keydown", _modalKeyHandler);
    _modalKeyHandler = null;
  }
  if (_modalEl) {
    _modalEl.remove();
    _modalEl = null;
  }
}

function openModal(im) {
  closeModal(); // 防止叠加

  const unconf = /（待确认）$/.test(im.cn);
  const aliasStr = (im.alias || []).join("、");

 // 缩放状态：scale + 平移（拖拽）
  let scale = 1;
  let tx = 0, ty = 0;
  const MIN = 0.5, MAX = 5, STEP = 0.0015; // 滚轮灵敏度

  const big = el("img", {
    class: "ci-modal-img", alt: cnName(im), src: IMG_BASE + im.file,
    draggable: "false",
  });
  big.addEventListener("error", () => big.classList.add("ci-thumb-err"));

  function applyTransform() {
    big.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }

 // 图片容器：承接滚轮缩放与拖拽平移
  const stage = el("div", { class: "ci-modal-stage" }, big);

 // 滚轮缩放：以光标位置为锚点
  stage.addEventListener("wheel", (e) => {
    e.preventDefault();
    const prev = scale;
 // 向上（deltaY<0）放大，向下缩小
    let next = prev * Math.exp(-e.deltaY * STEP);
    next = Math.max(MIN, Math.min(MAX, next));
    if (next === prev) return;
 // 锚点：光标相对 stage 中心的偏移，保持光标下的图像点不动
    const rect = stage.getBoundingClientRect();
    const cx = e.clientX - (rect.left + rect.width / 2);
    const cy = e.clientY - (rect.top + rect.height / 2);
    const ratio = next / prev;
    tx = cx - (cx - tx) * ratio;
    ty = cy - (cy - ty) * ratio;
    scale = next;
    applyTransform();
  }, { passive: false });

 // 拖拽平移（放大后可拖）
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

 // 双击复位
  stage.addEventListener("dblclick", () => {
    scale = 1; tx = 0; ty = 0; applyTransform();
  });

 // 关闭按钮
  const closeBtn = el("button", {
    class: "ci-modal-close", type: "button", title: tt("ui.ci.close"),
    "aria-label": tt("ui.ci.close"),
    onclick: closeModal,
  }, msym("close"));

 // 头部信息：名称 / 别名 / 尺寸 / 分类
  const head = el("div", { class: "ci-modal-head" },
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
  );

  const dialog = el("div", {
    class: "ci-modal-dialog", role: "dialog", "aria-modal": "true",
    onclick: (e) => e.stopPropagation(), // 阻止冒泡到遮罩
  }, closeBtn, head, stage,
    el("div", { class: "ci-modal-hint" }, tt("ui.ci.zoomHint")),
  );

 // 遮罩：点击关闭
  _modalEl = el("div", { class: "ci-modal-overlay", onclick: closeModal }, dialog);
  document.body.append(_modalEl);

 // ESC 关闭
  _modalKeyHandler = (e) => { if (e.key === "Escape") closeModal(); };
  document.addEventListener("keydown", _modalKeyHandler);

  applyTransform();
}
