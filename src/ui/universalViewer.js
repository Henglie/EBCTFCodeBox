// universalViewer.js — 字符显示器视图
// 与 exhaustiveView（穷举全解）并列的独立视图：多视角透视同一段输入。
// 三视图并列：① Hex+ASCII 双栏 ② 全字库 Unicode 逐字符表 ③ 不可见/零宽字符标记
// （编码探测 tab 已按删除）
// 复用：core/hexview.js（buildHexRows/byteStats）+ core/invisibles.js（scan/strip）
// + core/confusables.js（detect）+ core/unicodeNames.js（blockOf/planeOf/categoryOf/nameHint）
// + ui/inputEnhance.js（invisibleReport/visualizeInvisiblesHTML）
// 自持 el/msym（msym 须 icon 注水），window.__ebctfT/__ebctfToast 取值。零外发。
import { icon as iconSvg } from "./icons.js";
import { scan as invisScan, strip as invisStrip, INVISIBLES, TYPE_LABEL, cpLabel } from "../core/invisibles.js";
import { invisibleReport, visualizeInvisiblesHTML } from "./inputEnhance.js";
import { buildHexRows, byteStats } from "../core/hexview.js";
import { blockOf, planeOf, categoryOf, nameHint } from "../core/unicodeNames.js";
import { detect as confusDetect } from "../core/confusables.js";
import { renderMathIn } from "./katexLoader.js";
import { attachEditorToolbar } from "./editorToolbar.js";
import { ioArea } from "./ioArea.js"; // 天珩连字：输入/输出改 contenteditable div（textarea 吞 OpenType 特性）

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
  let s = UV_FALLBACK[key] || key;
 // 简易 {0}/{1} 占位替换
  for (let i = 0; i < args.length; i++) s = s.replace("{" + i + "}", String(args[i]));
  return s;
}
function toast(msg) {
  try { if (typeof window !== "undefined" && window.__ebctfToast) { window.__ebctfToast(msg); return; } } catch { /* 回退 */ }
}
// i18n 未接线时的中文兜底
const UV_FALLBACK = {
  "ui.uv.title": "字符显示器",
  "ui.uv.desc": "多视角透视：Hex+ASCII / Unicode 逐字符 / 不可见字符。全字库渲染冷僻码位。",
  "ui.uv.placeholder": "在此粘贴或拖入内容（纯前端，零外发）…",
  "ui.uv.runBtn": "分析",
  "ui.uv.tabHex": "Hex+ASCII",
  "ui.uv.tabUnicode": "Unicode 逐字符",
  "ui.uv.tabInvisible": "不可见字符",
  "ui.uv.empty": "请输入或拖入内容后点击「分析」。",
  "ui.uv.tooLong": "输入过长（上限 {0} 字符），已截断。",
  "ui.uv.copied": "已复制",
  "ui.uv.copyHint": "点击复制",
  "ui.uv.copyClean": "复制清洗后文本",
  "ui.uv.noInvisible": "未检测到不可见/零宽字符。",
  "ui.uv.invisibleFound": "检测到 {0} 个不可见字符（其中 {1} 个危险）。",
  "ui.uv.running": "分析中…",
  "ui.uv.bytes": "字节",
  "ui.uv.chars": "字符",
  "ui.uv.glyph": "字形",
  "ui.uv.codepoint": "码位",
  "ui.uv.name": "名称",
  "ui.uv.category": "分类",
  "ui.uv.block": "区块",
  "ui.uv.utf8": "UTF-8",
  "ui.uv.utf16": "UTF-16",
  "ui.uv.plane": "平面",
  "ui.uv.offset": "偏移",
  "ui.uv.hex": "十六进制",
  "ui.uv.ascii": "ASCII",
  "ui.uv.hexHoverHint": "鼠标移到任意字节，hex 与 ASCII 会同步高亮。",
  "ui.uv.hexByteInfo": "偏移 {0}（第 {1} 字节）· 值 {2}（{3}）",
  "ui.uv.fileLoaded": "已载入文件：{0}（{1} 字节）",
  "ui.uv.confusTitle": "同形异义字（Homoglyph）",
  "ui.uv.confusNone": "未发现与主脚本不一致的同形字。",
  "ui.uv.confusFound": "主书写系统 {0}，发现 {1} 处混入的同形字。",
  "ui.uv.entropy": "香农熵",
  "ui.uv.byteStat": "字节统计",
 // ---- 新增：渲染全部 tab ----
  "ui.uv.tabRenderAll": "渲染全部",
  "ui.uv.renderMd": "Markdown 渲染",
  "ui.uv.renderMath": "LaTeX 公式",
  "ui.uv.renderCheon": "天珩全字库渲染",
  "ui.uv.renderMdDesc": "按 Markdown 规则解析（标题/粗斜体/列表/代码/链接/表格），纯前端零外发。",
  "ui.uv.renderMathDesc": "扫描 $…$ 行内与 $$…$$ 独立公式，本地 KaTeX 渲染；缺库时降级显示原始 TeX。",
  "ui.uv.renderCheonDesc": "开启 OpenType 特性（ccmp/calt/liga），正确显示天珩堆叠字与冷僻码位。",
  "ui.uv.renderAllDesc": "合并渲染：同一视图内 Markdown 结构、$…$/$$…$$ 数学公式（本地 KaTeX）、天珩全字库同时生效。纯前端零外发。",
  "ui.uv.renderEmpty": "无可渲染内容。",
 // ---- 输出框 ----
  "ui.uv.outLabel": "文本输出（当前视图，可复制/导出）",
  "ui.uv.outPh": "分析后当前视图的文本结果显示在此…",
  "ui.uv.copyOut": "复制输出",
 // ---- 渲染全部 tab 可编辑源文本框（联动渲染） ----
  "ui.uv.renderAllSrc": "源文本（可编辑，实时联动渲染）",
  "ui.uv.renderAllSrcPh": "在此编辑源文本，下方渲染实时更新…",
};

// ---- 状态 ----
const uvState = {
  input: "",
  activeTab: "renderall",
};
const MAX_INPUT = 50000; // 输入上限（比穷举宽，因不做全解码）
const MAX_HEX_ROWS = 2048; // hex 视图最大行数（防爆）
const MAX_UNICODE_ROWS = 2000; // unicode 表最大行数

// ============================================================
// 字节工具
// ============================================================
const te = (s) => new TextEncoder().encode(s);
const td = (b, label = "utf-8", fatal = false) => {
  try { return new TextDecoder(label, { fatal }).decode(new Uint8Array(b)); }
  catch { return null; }
};

function bytesToHex(bytes, max = 64) {
  let s = "";
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) s += "…";
  return s;
}

function printableRatio(str) {
  if (!str || str.length === 0) return 0;
  let p = 0;
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if ((c >= 0x20 && c < 0x7F) || c === 0x0A || c === 0x0D || c === 0x09 || c >= 0x80) p++;
  }
  return p / str.length;
}

// ============================================================
// 视图 ①：Hex+ASCII 双栏（OllyDbg 风格：鼠标跟随 + hex↔ASCII 双向联动高亮）
// 参考「剪贴板里有什么 WhatsInYourClipboard」HexView.js，风格换成本项目 M3 温和红。
// 复用 hexview.js: byteStats（统计条）。逐字节 span 带 data-i，事件委托做联动高亮。
// ============================================================
const HEX_LUT = [];
for (let i = 0; i < 256; i++) HEX_LUT[i] = i.toString(16).padStart(2, "0");

function renderHexView(bytes) {
  const wrap = el("div", { class: "uv-hex-wrap" });
  if (bytes.length === 0) {
    wrap.append(el("div", { class: "uv-empty" }, tt("ui.uv.empty")));
    return wrap;
  }

 // 字节统计条（复用 byteStats）
  const st = byteStats(bytes);
  wrap.append(el("div", { class: "uv-hex-stat" },
    el("span", {}, tt("ui.uv.byteStat") + "："),
    el("span", {}, st.total + " " + tt("ui.uv.bytes")),
    el("span", {}, tt("ui.uv.printable") + " " + (st.printableRatio * 100).toFixed(0) + "%"),
    el("span", {}, tt("ui.uv.entropy") + " " + st.entropy.toFixed(2)),
  ));

  const perRow = 16;
  const maxBytes = MAX_HEX_ROWS * perRow;
  const len = Math.min(bytes.length, maxBytes);

 // 悬停提示条（显示 offset / 值）
  const hint = el("div", { class: "uv-hex-hint" }, tt("ui.uv.hexHoverHint"));

  const root = el("div", { class: "uv-hexview" });

 // 表头：列编号
  const head = el("div", { class: "uv-hexview-head" });
  const headOff = el("span", { class: "uv-hexview-off" }, tt("ui.uv.offset"));
  const headHex = el("span", { class: "uv-hexview-hex" });
  let headHexStr = "";
  for (let i = 0; i < perRow; i++) {
    headHexStr += HEX_LUT[i] + (i % 8 === 7 && i !== perRow - 1 ? "  " : " ");
  }
  headHex.textContent = headHexStr;
  const headAscii = el("span", { class: "uv-hexview-ascii" }, tt("ui.uv.ascii"));
  head.append(headOff, headHex, headAscii);
  root.append(head);

 // 数据行
  const frag = document.createDocumentFragment();
  for (let off = 0; off < len; off += perRow) {
    const row = el("div", { class: "uv-hexrow" });

    const offSpan = el("span", { class: "uv-hexview-off" });
    offSpan.textContent = off.toString(16).padStart(8, "0");
    row.append(offSpan);

    const hexSpan = el("span", { class: "uv-hexview-hex" });
    const ascSpan = el("span", { class: "uv-hexview-ascii" });

    for (let i = 0; i < perRow; i++) {
      const idx = off + i;
      if (idx < len) {
        const b = bytes[idx];
        const hb = el("span", { class: "hb" });
        hb.dataset.i = String(idx);
        hb.textContent = HEX_LUT[b];
        hexSpan.append(hb);
        hexSpan.append(document.createTextNode(i % 8 === 7 && i !== perRow - 1 ? "  " : " "));

        const ac = el("span", { class: "ac" });
        ac.dataset.i = String(idx);
        ac.textContent = (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
        ascSpan.append(ac);
      } else {
        hexSpan.append(document.createTextNode("   "));
      }
    }
    row.append(hexSpan, ascSpan);
    frag.append(row);
  }
  root.append(frag);

 // 悬停联动：事件委托，鼠标移到某字节 → 同时高亮左侧 hex 与右侧 ascii 对应格
  root.addEventListener("mouseover", (e) => {
    const cell = e.target.closest("[data-i]");
    if (!cell) return;
    const i = cell.dataset.i;
    root.querySelectorAll('[data-i="' + i + '"]').forEach((n) => n.classList.add("hl"));
    const b = bytes[+i];
    hint.textContent = tt("ui.uv.hexByteInfo", "0x" + (+i).toString(16).padStart(8, "0"), +i, "0x" + HEX_LUT[b], b);
  });
  root.addEventListener("mouseout", (e) => {
    const cell = e.target.closest("[data-i]");
    if (!cell) return;
    const i = cell.dataset.i;
    root.querySelectorAll('[data-i="' + i + '"]').forEach((n) => n.classList.remove("hl"));
  });
  root.addEventListener("mouseleave", () => { hint.textContent = tt("ui.uv.hexHoverHint"); });

  wrap.append(hint, root);
  if (bytes.length > maxBytes) {
    wrap.append(el("div", { class: "uv-truncate" }, "…（已达 " + MAX_HEX_ROWS + " 行上限，截断；共 " + bytes.length + " 字节）"));
  }
  return wrap;
}

// ============================================================
// 视图 ②：全字库 Unicode 逐字符表（复用 unicodeNames.js）
// ============================================================
function utf16Units(ch) {
  const cp = ch.codePointAt(0);
  if (cp <= 0xFFFF) return [cp.toString(16).toUpperCase().padStart(4, "0")];
  const hi = 0xD800 + ((cp - 0x10000) >> 10);
  const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
  return [hi.toString(16).toUpperCase().padStart(4, "0"), lo.toString(16).toUpperCase().padStart(4, "0")];
}

function renderUnicodeView(text) {
  const wrap = el("div", { class: "uv-unicode-wrap" });
  if (!text) {
    wrap.append(el("div", { class: "uv-empty" }, tt("ui.uv.empty")));
    return wrap;
  }
 // 逐字符（用 for...of 正确处理代理对）
  const chars = [...text];
  const maxRows = Math.min(chars.length, MAX_UNICODE_ROWS);
  const tbl = el("table", { class: "uv-unicode-tbl" });
  const thead = el("thead", {}, el("tr", {},
    el("th", {}, tt("ui.uv.glyph")),
    el("th", {}, tt("ui.uv.codepoint")),
    el("th", {}, tt("ui.uv.name")),
    el("th", {}, tt("ui.uv.category")),
    el("th", {}, tt("ui.uv.block")),
    el("th", {}, tt("ui.uv.utf8")),
    el("th", {}, tt("ui.uv.utf16")),
    el("th", {}, tt("ui.uv.plane")),
  ));
  tbl.append(thead);
  const tbody = el("tbody");
  for (let i = 0; i < maxRows; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0);
    const utf8 = te(ch);
    const utf8Hex = Array.from(utf8, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    const utf16 = utf16Units(ch).join(" ");
    const name = nameHint(cp);
    const cat = categoryOf(cp);
    const block = blockOf(cp);
    const pl = planeOf(cp);
    const cpStr = cpLabel(cp);
 // 字形：不可见字符用占位符，其余交给天珩字库（CSS var --font-content）渲染
    let glyphDisplay = ch;
    if (INVISIBLES[cp]) glyphDisplay = INVISIBLES[cp].glyph || "·";
    const tr = el("tr", { class: "uv-unicode-row" },
      el("td", { class: "uv-glyph-cell", title: cpStr }, glyphDisplay),
      el("td", { class: "uv-cp-cell" }, cpStr),
      el("td", { class: "uv-name-cell" }, name),
      el("td", { class: "uv-cat-cell", title: cat.code }, cat.code + " · " + cat.label),
      el("td", { class: "uv-block-cell" }, block),
      el("td", { class: "uv-utf8-cell" }, utf8Hex || "-"),
      el("td", { class: "uv-utf16-cell" }, utf16),
      el("td", { class: "uv-plane-cell", title: "plane " + pl.plane }, pl.name),
    );
    tbody.append(tr);
  }
  tbl.append(tbody);
  wrap.append(tbl);
  if (chars.length > MAX_UNICODE_ROWS) {
    wrap.append(el("div", { class: "uv-truncate" }, "…（已达 " + MAX_UNICODE_ROWS + " 行上限，截断；共 " + chars.length + " 字符）"));
  }
  return wrap;
}

// ============================================================
// 视图 ③：不可见/零宽字符标记（复用 invisibles + confusables）
// （原编码探测 tab 已按删除）
// ============================================================
function renderInvisibleView(text) {
  const wrap = el("div", { class: "uv-invisible-wrap" });
  if (!text) {
    wrap.append(el("div", { class: "uv-empty" }, tt("ui.uv.empty")));
    return wrap;
  }

 // 同形异义字（confusables.detect）
  let confus = { dominant: "", hits: [] };
  try { confus = confusDetect(text); } catch { /* 忽略 */ }
  const confusBox = el("div", { class: "uv-confus-box" });
  confusBox.append(el("div", { class: "uv-confus-title" }, tt("ui.uv.confusTitle")));
  if (!confus.hits || confus.hits.length === 0) {
    confusBox.append(el("div", { class: "uv-confus-ok" }, tt("ui.uv.confusNone")));
  } else {
    confusBox.append(el("div", { class: "uv-confus-stat" }, tt("ui.uv.confusFound", confus.dominant, confus.hits.length)));
    const ctbl = el("table", { class: "uv-confus-tbl" });
    ctbl.append(el("thead", {}, el("tr", {},
      el("th", {}, "位置"), el("th", {}, "字符"), el("th", {}, "码位"), el("th", {}, "脚本"), el("th", {}, "骨架"),
    )));
    const cbody = el("tbody");
    for (const h of confus.hits.slice(0, 200)) {
      cbody.append(el("tr", {},
        el("td", {}, String(h.idx)),
        el("td", { class: "uv-confus-ch" }, h.ch),
        el("td", {}, cpLabel(h.cp)),
        el("td", {}, h.script),
        el("td", {}, h.skeleton != null ? "→ " + h.skeleton : "—"),
      ));
    }
    ctbl.append(cbody);
    confusBox.append(ctbl);
  }
  wrap.append(confusBox);

 // 不可见字符报告
  const report = invisibleReport(text);
  if (report.count === 0) {
    wrap.append(el("div", { class: "uv-invisible-ok" }, tt("ui.uv.noInvisible")));
    return wrap;
  }

  wrap.append(el("div", { class: "uv-invisible-stat" },
    tt("ui.uv.invisibleFound", report.count, report.dangerous),
  ));

 // 按类型分类
  const byType = report.byType || {};
  const typeLines = el("div", { class: "uv-invisible-types" });
  for (const [type, count] of Object.entries(byType)) {
    const label = TYPE_LABEL[type] || type;
    typeLines.append(el("div", { class: "uv-invisible-type-row" },
      el("span", { class: "uv-inv-type-name" }, label),
      el("span", { class: "uv-inv-type-count" }, String(count)),
    ));
  }
  wrap.append(typeLines);

 // 显形 HTML：默认连普通空格 / Tab / 换行一并显形——本视图标题即承诺「不可见字符用
 // 占位符标记」，而空格是 CTF 里最常见的间隔隐写载体，用户预期看得见。复选框默认勾选，
 // 想避开满屏占位符干扰阅读时可取消，仅显形可疑不可见字符。
  let showSpace = true;
  const visLabel = el("div", { class: "uv-invisible-viz-label" });
  visLabel.append(el("span", {}, "显形视图（不可见字符用占位符标记）："));
  const spaceToggle = el("label", {
    class: "uv-space-toggle",
    style: "display:inline-flex;align-items:center;gap:4px;margin-left:12px;font-weight:normal;cursor:pointer;",
  });
  const spaceCb = el("input", { type: "checkbox" });
  spaceCb.checked = showSpace;
  spaceToggle.append(spaceCb, el("span", {}, "显示空格 / Tab / 换行占位符"));
  visLabel.append(spaceToggle);

  const visBox = el("div", { class: "uv-invisible-viz" });
  const renderViz = () => { visBox.innerHTML = visualizeInvisiblesHTML(text, { showSpace }).html; };
  renderViz();
  spaceCb.addEventListener("change", () => { showSpace = spaceCb.checked; renderViz(); });

  wrap.append(visLabel);
  wrap.append(visBox);

 // 结构化清单
  const hits = invisScan(text);
  if (hits.length > 0) {
    const tbl = el("table", { class: "uv-invisible-tbl" });
    tbl.append(el("thead", {}, el("tr", {},
      el("th", {}, "位置"), el("th", {}, "码位"), el("th", {}, "名称"), el("th", {}, "类型"), el("th", {}, "占位符"),
    )));
    const tbody = el("tbody");
    for (const h of hits.slice(0, 500)) {
      tbody.append(el("tr", {},
        el("td", {}, String(h.idx)),
        el("td", {}, cpLabel(h.cp)),
        el("td", {}, h.name),
        el("td", {}, TYPE_LABEL[h.type] || h.type),
        el("td", { class: "uv-inv-glyph" }, h.glyph || "·"),
      ));
    }
    tbl.append(tbody);
    wrap.append(el("div", { class: "uv-invisible-list-label" }, "命中清单（前 500 项）："));
    wrap.append(tbl);
    if (hits.length > 500) {
      wrap.append(el("div", { class: "uv-truncate" }, "…（共 " + hits.length + " 项，截断）"));
    }
  }

 // 清洗后文本 + 复制按钮
  const cleaned = invisStrip(text);
  if (cleaned !== text) {
    const cleanBox = el("div", { class: "uv-invisible-clean" });
    const cleanPre = el("pre", { class: "uv-clean-pre" }, cleaned.slice(0, 5000) + (cleaned.length > 5000 ? "…" : ""));
    const copyBtn = el("button", { class: "act-btn uv-copy-clean-btn" }, msym("content_copy"), el("span", {}, tt("ui.uv.copyClean")));
    copyBtn.addEventListener("click", () => {
      try { navigator.clipboard.writeText(cleaned); toast(tt("ui.uv.copied")); } catch { /* ignore */ }
    });
    cleanBox.append(el("div", { class: "uv-clean-label" }, "清洗后文本（剥离零宽/Bidi/格式/BOM）："));
    cleanBox.append(cleanPre);
    cleanBox.append(copyBtn);
    wrap.append(cleanBox);
  }

  return wrap;
}

// ============================================================
// 视图 ④：渲染全部（Markdown / LaTeX / 天珩全字库）
// ============================================================
// 轻量 Markdown 解析器（纯前端，零依赖，零外发）。
// 支持：标题 # / 粗体 ** / 斜体 * / 无序·有序列表 / 行内代码 ` / 代码块 ``` / 链接 [] / 表格。
function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// 行内元素（入参须已 HTML 转义）。顺序：行内代码 → 链接 → 粗 → 斜。
function mdInline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return "" + (codes.length - 1) + ""; });
 // 链接 [text](url)——url 已转义，仅放行安全协议，否则降级为 #
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    const safe = /^(https?:|mailto:|#|\/|\.\/|\.\.\/)/i.test(u) ? u : "#";
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/(\d+)/g, (m, i) => `<code>${codes[+i]}</code>`);
  return s;
}

function mdSplitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function mdToHtml(src) {
  const lines = String(src).replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const isSpecial = (ln) => /^```/.test(ln) || /^#{1,6}\s/.test(ln) || /^\s*[-*+]\s+/.test(ln) || /^\s*\d+\.\s+/.test(ln);
  while (i < lines.length) {
    const line = lines[i];
 // 代码块 ```
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 跳过收尾 fence
      out.push(`<pre class="uv-md-code"><code>${escHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }
 // 标题 #
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm) {
      const lv = hm[1].length;
      out.push(`<h${lv}>${mdInline(escHtml(hm[2]))}</h${lv}>`);
      i++;
      continue;
    }
 // 表格：当前行含 | 且下一行是分隔行（含 - 与可选 :）
    if (/\|/.test(line) && i + 1 < lines.length && /-/.test(lines[i + 1]) && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const header = mdSplitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim() !== "") { rows.push(mdSplitRow(lines[i])); i++; }
      let t = '<table class="uv-md-table"><thead><tr>';
      for (const h of header) t += `<th>${mdInline(escHtml(h))}</th>`;
      t += "</tr></thead><tbody>";
      for (const r of rows) {
        t += "<tr>";
        for (const c of r) t += `<td>${mdInline(escHtml(c))}</td>`;
        t += "</tr>";
      }
      t += "</tbody></table>";
      out.push(t);
      continue;
    }
 // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, "")); i++; }
      out.push("<ul>" + items.map((it) => `<li>${mdInline(escHtml(it))}</li>`).join("") + "</ul>");
      continue;
    }
 // 有序列表
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i++; }
      out.push("<ol>" + items.map((it) => `<li>${mdInline(escHtml(it))}</li>`).join("") + "</ol>");
      continue;
    }
 // 空行
    if (line.trim() === "") { i++; continue; }
 // 段落：合并连续普通行
    const para = [];
    while (i < lines.length && lines[i].trim() !== "" && !isSpecial(lines[i])) { para.push(lines[i]); i++; }
    out.push(`<p>${mdInline(escHtml(para.join(" ")))}</p>`);
  }
  return out.join("\n");
}

// ---- 合并渲染核心 ----
// 目标：同一段输出里同时让 Markdown 结构、LaTeX 公式、天珩字库三者生效。
// 做法：先把 $$…$$ / $…$ 数学片段抽出替换为 PUA 占位符（避开 Markdown 解析破坏 TeX
// 也避开 mdInline 已占用的 /），跑完 Markdown 生成 HTML 后，再把占位符
// 还原成 <span data-tex> 交给 KaTeX 就地渲染。最终 HTML 落在单一 .uv-md-body 容器里
// 该容器 CSS 用 var(--font-content)（天珩），故 CJK 冷僻字/堆叠字由天珩渲染。
const MATH_PH_OPEN = "";   // 数学占位符起（避开 mdInline 的 /）
const MATH_PH_CLOSE = "";

// 抽取数学片段：返回 {text: 带占位符的源, maths: [{tex, display}]}
function extractMath(src) {
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  const maths = [];
  const text = String(src).replace(re, (m, block, inline) => {
    const display = block != null;
    maths.push({ tex: display ? block : inline, display });
    return MATH_PH_OPEN + (maths.length - 1) + MATH_PH_CLOSE;
  });
  return { text, maths };
}

// 把 HTML 里的数学占位符还原成 [data-tex] span（占位符不含尖括号，不受 escHtml 影响）。
function restoreMath(html, maths) {
  const re = new RegExp(MATH_PH_OPEN + "(\\d+)" + MATH_PH_CLOSE, "g");
  return html.replace(re, (m, i) => {
    const item = maths[+i];
    if (!item) return "";
    const tex = String(item.tex)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    return `<span data-tex="${tex}" data-display="${item.display ? "1" : "0"}"></span>`;
  });
}

// 把源文本合并渲染进目标容器（抽公式 → Markdown → 还原公式占位 → KaTeX）。
function renderMergedInto(body, text) {
  const { text: mathless, maths } = extractMath(text);
  let html = mdToHtml(mathless);
  html = restoreMath(html, maths);
  body.innerHTML = html;
 // 异步懒加载 KaTeX，就地渲染容器内 [data-tex]，失败静默降级
  Promise.resolve().then(() => { renderMathIn(body).catch(() => { /* 降级 */ }); });
}

function renderRenderAllView(text) {
  const wrap = el("div", { class: "uv-renderall-wrap" });

  wrap.append(el("div", { class: "uv-render-sec-desc" }, tt("ui.uv.renderAllDesc")));

 // 渲染框：直接把输入文本渲染出来（Markdown + 公式 + 天珩字形），无编辑框。
 // CSS var(--font-content) = 天珩字库，md 结构 + 天珩字形合并生效。
  const body = el("div", { class: "uv-md-body uv-cheon-body" });
  wrap.append(body);

  if (!text) body.innerHTML = `<div class="uv-empty">${escHtml(tt("ui.uv.renderEmpty"))}</div>`;
  else renderMergedInto(body, text);

  return wrap;
}

// ============================================================
// 输出框文本化——把当前 tab 的分析结果转成可复制的纯文本。
// 各 tab 生成对应文本形态，塞进只读输出 textarea，用户可全选复制/导出。
// ============================================================
function buildTextOutput(tab, bytes, text) {
  try {
    switch (tab) {
      case "hex": return hexDumpText(bytes);
      case "unicode": return unicodeTableText(text);
      case "invisible": return invisibleReportText(text);
      case "renderall": return text;   // 渲染视图源即原文，输出框给纯文本方便复制
      default: return "";
    }
  } catch { return ""; }
}

// 标准 hex dump 文本：offset 16 字节 hex |ASCII|
function hexDumpText(bytes) {
  const perRow = 16;
  const maxBytes = MAX_HEX_ROWS * perRow;
  const len = Math.min(bytes.length, maxBytes);
  const lines = [];
  for (let off = 0; off < len; off += perRow) {
    let hex = "", asc = "";
    for (let i = 0; i < perRow; i++) {
      const idx = off + i;
      if (idx < len) {
        const b = bytes[idx];
        hex += HEX_LUT[b] + (i % 8 === 7 ? "  " : " ");
        asc += (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".";
      } else {
        hex += "   ";
      }
    }
    lines.push(off.toString(16).padStart(8, "0") + "  " + hex + " |" + asc + "|");
  }
  if (bytes.length > maxBytes) lines.push("…（截断，共 " + bytes.length + " 字节）");
  return lines.join("\n");
}

// Unicode 逐字符表 → TSV 文本
function unicodeTableText(text) {
  const chars = [...text];
  const maxRows = Math.min(chars.length, MAX_UNICODE_ROWS);
  const lines = ["字形\t码位\t名称\t分类\t区块\tUTF-8\tUTF-16\t平面"];
  for (let i = 0; i < maxRows; i++) {
    const ch = chars[i];
    const cp = ch.codePointAt(0);
    const utf8Hex = Array.from(te(ch), (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    const utf16 = utf16Units(ch).join(" ");
    const cat = categoryOf(cp);
    let glyph = ch;
    if (INVISIBLES[cp]) glyph = INVISIBLES[cp].glyph || "·";
    lines.push([glyph, cpLabel(cp), nameHint(cp), cat.code + " " + cat.label, blockOf(cp), utf8Hex || "-", utf16, planeOf(cp).name].join("\t"));
  }
  if (chars.length > MAX_UNICODE_ROWS) lines.push("…（截断，共 " + chars.length + " 字符）");
  return lines.join("\n");
}

// 不可见字符报告 → 文本
function invisibleReportText(text) {
  const report = invisibleReport(text);
  const lines = [];
  if (report.count === 0) {
    lines.push(tt("ui.uv.noInvisible"));
  } else {
    lines.push(tt("ui.uv.invisibleFound", report.count, report.dangerous));
    const hits = invisScan(text);
    lines.push("位置\t码位\t名称\t类型");
    for (const h of hits.slice(0, 500)) {
      lines.push([h.idx, cpLabel(h.cp), h.name, TYPE_LABEL[h.type] || h.type].join("\t"));
    }
    const cleaned = invisStrip(text);
    if (cleaned !== text) {
      lines.push("", "— 清洗后文本 —", cleaned);
    }
  }
  return lines.join("\n");
}

// ============================================================
// Tab 切换
// ============================================================
function makeTabs() {
  const tabs = [
    { id: "hex", label: tt("ui.uv.tabHex"), icon: "text_fields" },
    { id: "unicode", label: tt("ui.uv.tabUnicode"), icon: "font_download" },
    { id: "invisible", label: tt("ui.uv.tabInvisible"), icon: "visibility_off" },
    { id: "renderall", label: tt("ui.uv.tabRenderAll"), icon: "menu_book" },
  ];
  const bar = el("div", { class: "uv-tabs" });
  const buttons = [];
  for (const t of tabs) {
    const btn = el("button", { class: "uv-tab" + (uvState.activeTab === t.id ? " active" : "") },
      msym(t.icon), el("span", {}, t.label),
    );
    btn.addEventListener("click", () => {
      uvState.activeTab = t.id;
      for (const b of buttons) b.classList.remove("active");
      btn.classList.add("active");
      if (uvState._rerender) uvState._rerender();
    });
    buttons.push(btn);
    bar.append(btn);
  }
  return bar;
}

// ============================================================
// 主渲染
// ============================================================
export function renderUniversalViewer(container) {
  container.innerHTML = "";
  const wrap = el("div", { class: "uv-view" });

 // 标题
  wrap.append(el("div", { class: "op-head" },
    el("div", { class: "op-title" }, msym("search"), tt("ui.uv.title")),
    el("div", { class: "op-desc" }, tt("ui.uv.desc")),
  ));

 // 输入框
  const input = ioArea({
    class: "io-area uv-input", placeholder: tt("ui.uv.placeholder"),
    style: "min-height:200px",
  });
  input.value = uvState.input || "";

 // 拖放：二进制文件 → hex 填入
  input.addEventListener("dragover", (e) => { e.preventDefault(); input.classList.add("dragover"); });
  input.addEventListener("dragleave", () => input.classList.remove("dragover"));
  input.addEventListener("drop", async (e) => {
    e.preventDefault();
    input.classList.remove("dragover");
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) {
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        input.value = bytesToHex(bytes, 100000);
        uvState.input = input.value;
        toast(tt("ui.uv.fileLoaded", file.name, bytes.length));
        run();
      } catch (err) {
        toast("文件读取失败：" + (err.message || err));
      }
    }
  });

 // 分析按钮
  const runBtn = el("button", { class: "act-btn primary uv-run-btn" },
    msym("search"), el("span", {}, tt("ui.uv.runBtn")),
  );

  const statBar = el("div", { class: "uv-stat" });
  const tabBar = makeTabs();
  const out = el("div", { class: "uv-out" });

 // 初始空态
  out.append(el("div", { class: "uv-empty" }, tt("ui.uv.empty")));

 // 文本输出框——当前 tab 分析结果的可复制/导出纯文本形态。
 // 各视图是 DOM 表格/hex 网格，此框把它转成 hexdump/TSV/报告文本，随 tab 切换同步。
 // 复制/全选/导出/字号统一走下方 attachEditorToolbar（outToolbar），此处只留标签。
  const outLabelRow = el("div", { class: "uv-out-label-row" },
    el("span", { class: "uv-out-label" }, tt("ui.uv.outLabel")),
  );
  const outText = ioArea({
    class: "io-area uv-out-text", readonly: true,
    placeholder: tt("ui.uv.outPh"), style: "min-height:160px",
  });

  function run() {
    uvState.input = input.value;
    const q = input.value;
    out.innerHTML = "";
    statBar.textContent = "";
    if (!q) {
      out.append(el("div", { class: "uv-empty" }, tt("ui.uv.empty")));
      outText.value = "";
      return;
    }
    const truncated = q.length > MAX_INPUT;
    const text = truncated ? q.slice(0, MAX_INPUT) : q;
    if (truncated) toast(tt("ui.uv.tooLong", MAX_INPUT));

 // 输入 → 字节（纯 hex 串优先按 hex 解析，否则 UTF-8 编码）
    let bytes;
    const trimmed = text.trim();
    const hexClean = trimmed.replace(/\s/g, "");
    if (/^[0-9a-fA-F\s]+$/.test(trimmed) && hexClean.length % 2 === 0 && hexClean.length >= 2) {
      bytes = new Uint8Array(hexClean.length / 2);
      for (let i = 0; i < hexClean.length; i += 2) bytes[i / 2] = parseInt(hexClean.slice(i, i + 2), 16);
    } else {
      bytes = te(text);
    }

 // UTF-8 解码文本（用于 Unicode/不可见视图）
    const utf8Text = td(bytes, "utf-8", false) || text;

    statBar.textContent = bytes.length + " " + tt("ui.uv.bytes") + " / " + [...utf8Text].length + " " + tt("ui.uv.chars");

    uvState._rerender = () => {
      out.innerHTML = "";
      switch (uvState.activeTab) {
        case "hex": out.append(renderHexView(bytes)); break;
        case "unicode": out.append(renderUnicodeView(utf8Text)); break;
        case "invisible": out.append(renderInvisibleView(utf8Text)); break;
        case "renderall": out.append(renderRenderAllView(utf8Text)); break;
        default: out.append(renderHexView(bytes)); break;
      }
 // 渲染全部 tab 自带可编辑源框（在视图内），底部通用只读输出框对它无意义 → 隐藏。
 // 其余 tab（hex/unicode/invisible）仍用底部只读输出框给可复制/导出的文本形态。
      const isRenderAll = uvState.activeTab === "renderall";
      outLabelRow.style.display = isRenderAll ? "none" : "";
      outText.style.display = isRenderAll ? "none" : "";
      outText.value = isRenderAll ? "" : buildTextOutput(uvState.activeTab, bytes, utf8Text);
    };
    uvState._rerender();
  }

  runBtn.addEventListener("click", run);

 // 输入框接编辑器工具条（粘贴/清空/字号/全选/导出 + Ctrl+A/S）。
 // onChange=run：粘贴/清空后自动重跑分析，与「分析」按钮一致。
  const inToolbar = attachEditorToolbar(input, {
    onChange: () => { uvState.input = input.value; run(); },
    exportName: "charviewer-input.txt",
  });
 // 输出框工具条（只读：复制/全选/导出/字号）。已有的单复制按钮由工具条统一替代。
  const outToolbar = attachEditorToolbar(outText, { readonly: true, exportName: "charviewer-output.txt" });
  outLabelRow.append(outToolbar);

  wrap.append(inToolbar, input, runBtn, statBar, tabBar, out, outLabelRow, outText);
  container.append(wrap);
}
