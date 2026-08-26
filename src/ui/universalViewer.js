// universalViewer.js — 字符显示器视图
// 与 exhaustiveView（穷举全解）并列的独立视图：多视角透视同一段输入。
// 多视图并列：① Hex+ASCII 双栏 ② 全字库 Unicode 逐字符表 ③ 不可见/零宽字符标记
// ④ 渲染全部 ⑤ 拼字 / IDS（表意文字描述序列）
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
 // {0}/{1} 占位替换（replaceAll：同一占位复用的 key 也会全部替换，审计 P3-21）
  for (let i = 0; i < args.length; i++) s = s.replaceAll("{" + i + "}", String(args[i]));
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
  "ui.uv.graphemes": "字素簇",
  "ui.uv.splitClusters": "拆分组合序列（按码位逐个列出）",
  "ui.uv.noSegmenter": "（当前环境不支持字素簇切分，已按码位显示）",
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
 // ---- T360：保存渲染结果图片 ----
  "ui.uv.saveSvg": "保存 SVG",
  "ui.uv.savePng": "保存 PNG",
  "ui.uv.embedFont": "内嵌字体",
  "ui.uv.embedFontHint": "勾选：把天珩字库（约 1.6 MB）内嵌进 SVG，任何机器打开都正确；不勾：文件仅几十 KB，但未装天珩的机器上冷僻字会回退系统字体。",
  "ui.uv.scale": "PNG 倍率",
  "ui.uv.savedSvg": "已导出 SVG",
  "ui.uv.savedPng": "已导出 PNG",
  "ui.uv.exportErr": "导出失败：{0}",
  "ui.uv.exportFormulaHint": "公式字形依赖本机 KaTeX 字体，导出图中未内嵌，换机器可能回退。",
 // ---- 渲染全部 tab 可编辑源文本框（联动渲染） ----
  "ui.uv.renderAllSrc": "源文本（可编辑，实时联动渲染）",
  "ui.uv.renderAllSrcPh": "在此编辑源文本，下方渲染实时更新…",
// ---- 拼字 / IDS 视图 ----
  "ui.uv.tabIds": "拼字 / IDS",
  "ui.uv.idsDesc": "表意文字描述序列（IDS）：正查汉字分解树、反查部件拼字、字与 IDS 串双向互转。纯前端本地数据，零外发。",
  "ui.uv.idsLoading": "正在加载拼字数据…",
  "ui.uv.idsLoadFail": "拼字数据加载失败",
  "ui.uv.idsFwd": "正查 · 字 → 分解树",
  "ui.uv.idsRev": "反查 · 部件 → 字",
  "ui.uv.idsConv": "互转 · 字 ⇄ IDS 串",
  "ui.uv.idsNoData": "（该字符无 IDS 分解数据）",
  "ui.uv.idsRevCount": "共 {0} 字",
  "ui.uv.idsRevEmpty": "未找到包含这些部件的字。",
  "ui.uv.idsRevExact": "IDS 精确匹配 {0} 字",
  "ui.uv.idsPage": "第 {0} / {1} 页",
  "ui.uv.idsPrev": "上一页",
  "ui.uv.idsNext": "下一页",
  "ui.uv.idsPageSize": "每页",
  "ui.uv.idsUnencoded": "未编码",
  "ui.uv.idsUnencodedNote": "「{0}」为未编码部件（占位编号）",
  "ui.uv.idsExpand": "全部展开",
  "ui.uv.idsCollapse": "全部收起",
  "ui.uv.idsNoExact": "无 IDS 精确匹配；按叶子部件反查：",
  "ui.uv.idsConvHits": "匹配 {0} 字",
  "ui.uv.idsSrc": "源",
 // ---- 拼字输入并轨上方输入框（i18n 冻结期新 key，本地兜底）----
  "ui.uv.cpDescV2": "转换 Unicode 描述编码（U+529B → 力）",
  "ui.uv.idsEmptyFwdTop": "在上方输入框输入汉字，此处显示拼字分解树。",
  "ui.uv.idsEmptyRevTop": "在上方输入框输入部件（如：亻 吉）或 IDS 表达式（如：⿰亻吉）反查汉字。",
  "ui.uv.idsEmptyConvTop": "在上方输入框输入汉字或 IDS 表达式，此处双向互转。",
};

// ---- 状态 ----
const uvState = {
  input: "",
  activeTab: "renderall",
  splitCodepoints: false, // Unicode 视图切分口径：false=字素簇（默认，正确显示组合序列）/ true=逐码位
  bytes: null,            // 最近一次「分析」的结果字节（null=尚未分析）
  text: "",               // 最近一次「分析」的解码文本（""=尚未分析）
  // 渲染全部 tab 的控件记忆（审计 P1-1）：rerender 会整块重建视图，局部变量切 tab 即静默重置——
  // 用户关掉的「转换 Unicode 描述编码」会自己重开。三态入 uvState，与 splitCodepoints 同模式。
  renderall: { cpDesc: true, embedFont: false, pngScale: 2 },
};
// 拼字 / IDS 视图状态（跨 tab 切换保留）。输入统一走上方共享输入框，各 pane 不再自带输入框。
const idsState = {
  sub: "fwd",            // fwd 正查 | rev 反查 | conv 互转
  pageSize: 50,          // 反查每页条数
  page: 0,               // 反查当前页
  deep: false,           // 分解树是否深度展开
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
// ---- 字素簇切分（MT78 疑因 A 修复，2026-08-23）----
// 旧实现用 [...text] 展开，那只按 **码位**（code point）切，仅正确处理代理对，
// **不处理组合序列**：`u̲`（U+0075 LATIN SMALL LETTER U + U+0332 COMBINING LOW LINE）
// 会被拆成两行 —— 组合下划线脱离基字单独成行渲染，既不连续、又错位。
// 恒烈报的 `u̲n̲d̲e̲r̲l̲i̲n̲e̲d̲` 显示异常即此。
// 改用 Intl.Segmenter 按 **字素簇**（grapheme cluster, UAX #29）切分：
// 基字 + 其后所有组合记号算一个用户感知字符，整簇一起渲染，组合符自然贴回基字。
// 兼容：Chromium 87+ / Firefox 125+ / Safari 14.1+ 均支持；不支持时降级回码位切分
// （降级后行为与修复前一致，不会更糟）。
let _seg = null; // null=未初始化 / false=环境不支持 / Segmenter 实例=可用
function getSegmenter() {
  if (_seg === null) {
    try { _seg = new Intl.Segmenter(undefined, { granularity: "grapheme" }); }
    catch { _seg = false; }
  }
  return _seg;
}
/** 按字素簇切分；环境不支持时降级为按码位切分。 */
function graphemes(text) {
  const seg = getSegmenter();
  if (!seg) return [...text];
  const out = [];
  for (const s of seg.segment(text)) out.push(s.segment);
  return out;
}
/** 取一个字素簇内的全部码位。 */
function clusterCps(cluster) {
  const cps = [];
  for (const ch of cluster) cps.push(ch.codePointAt(0));
  return cps;
}

function utf16Units(ch) {
  const cp = ch.codePointAt(0);
  if (cp <= 0xFFFF) return [cp.toString(16).toUpperCase().padStart(4, "0")];
  const hi = 0xD800 + ((cp - 0x10000) >> 10);
  const lo = 0xDC00 + ((cp - 0x10000) & 0x3FF);
  return [hi.toString(16).toUpperCase().padStart(4, "0"), lo.toString(16).toUpperCase().padStart(4, "0")];
}

/** 整簇的 UTF-16 码元（逐码位展开后拼接）。 */
function clusterUtf16(cluster) {
  const units = [];
  for (const ch of cluster) units.push(...utf16Units(ch));
  return units.join(" ");
}

function renderUnicodeView(text) {
  const wrap = el("div", { class: "uv-unicode-wrap" });
  if (!text) {
    wrap.append(el("div", { class: "uv-empty" }, tt("ui.uv.empty")));
    return wrap;
  }

 // 切分模式开关：默认按字素簇（正确显示组合序列）；勾选后退回逐码位
 // （CTF 里查零宽/变体选择子等场景需要看到每个码位单独成行）。
  const modeRow = el("div", { class: "uv-uni-mode" });
  const splitCb = el("input", { type: "checkbox" });
  splitCb.checked = !!uvState.splitCodepoints;
  const modeLabel = el("label", { class: "uv-uni-mode-label" }, splitCb,
    el("span", {}, tt("ui.uv.splitClusters")));
  modeRow.append(modeLabel);
  if (!getSegmenter()) {
    modeRow.append(el("span", { class: "uv-uni-mode-hint" }, tt("ui.uv.noSegmenter")));
  }
  splitCb.addEventListener("change", () => {
    uvState.splitCodepoints = splitCb.checked;
    uvState._tabCache = null; // 切分口径变化 → unicode 视图需重建（M1 缓存失效）
    if (uvState._rerender) uvState._rerender();
  });
  wrap.append(modeRow);

 // 单元切分：字素簇（默认）或码位（勾选拆分后）
  const units = uvState.splitCodepoints ? [...text] : graphemes(text);
  const maxRows = Math.min(units.length, MAX_UNICODE_ROWS);
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
    const unit = units[i];
    const cps = clusterCps(unit);
    const cp = cps[0];                  // 基字：属性列按它取
    const utf8 = te(unit);              // UTF-8/UTF-16 按整簇算
    const utf8Hex = Array.from(utf8, (b) => b.toString(16).toUpperCase().padStart(2, "0")).join(" ");
    const utf16 = clusterUtf16(unit);
    const cat = categoryOf(cp);
    const block = blockOf(cp);
    const pl = planeOf(cp);
 // 码位列：整簇全部码位并列（`U+0075 U+0332`），一眼看出这行是组合序列
    const cpStr = cps.map((c) => cpLabel(c)).join(" ");
 // 名称列：基字名 +（若有）后续组合记号名
    let name = nameHint(cp);
    if (cps.length > 1) name += " + " + cps.slice(1).map((c) => nameHint(c)).join(" + ");
 // 字形：整簇原样交给天珩字库渲染（组合记号贴回基字，不再错位）；
 // 仅当整簇就是单个不可见字符时才换占位符。
    let glyphDisplay = unit;
    if (cps.length === 1 && INVISIBLES[cp]) glyphDisplay = INVISIBLES[cp].glyph || "·";
    const tr = el("tr", { class: "uv-unicode-row" + (cps.length > 1 ? " uv-cluster-row" : "") },
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
  if (units.length > MAX_UNICODE_ROWS) {
    wrap.append(el("div", { class: "uv-truncate" }, "…（已达 " + MAX_UNICODE_ROWS + " 行上限，截断；共 " + units.length + " 项）"));
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
// postHtml：可选后处理器，在 restoreMath 之后、写入 body 之前对 html 做一次变换（MT77① 码位描述还原用）。
function renderMergedInto(body, text, postHtml) {
  const { text: mathless, maths } = extractMath(text);
  let html = mdToHtml(mathless);
  html = restoreMath(html, maths);
  if (postHtml) html = postHtml(html);
  body.innerHTML = html;
 // 异步懒加载 KaTeX，就地渲染容器内 [data-tex]，失败静默降级
  Promise.resolve().then(() => { renderMathIn(body).catch(() => { /* 降级 */ }); });
}

// ============================================================
// MT77①：Unicode 描述编码渲染 —— 把正文里的码位描述就地换成真字符。
// 覆盖：U+4E00 / u+4e00、&#x4E00; / &#20013;、\u4E00、\u{1F600}、\U0001F600、
//       \x{4E00}（Perl/Rust）、%u4E00、0x4E00（4–6 位 hex，保守边界）。
// 实现：原文层替换成私有区占位符（避开 mdInline 的 \uE000/\uE001 与数学占位符
//       \uE010/\uE011），markdown 渲染完成后由 restoreCpDescs 还原为 <span>。
// 这样既不受 markdown 转义影响，也不会被公式/行内代码流程误伤。
// ============================================================
const CP_PH_OPEN = "\uE012", CP_PH_CLOSE = "\uE013";
const CP_DESC_RE = new RegExp(
  "(?:U\\+|u\\+)([0-9A-Fa-f]{4,6})\\b" +            // U+4E00（4-6 位 hex）
  "|&#(?:[xX]([0-9A-Fa-f]{2,6})|(\\d{2,7}));" +    // HTML 实体（hex / dec）
  "|\\\\u([0-9A-Fa-f]{4})" +                        // JS \u4E00
  "|\\\\u\\{([0-9A-Fa-f]{1,6})\\}" +                // JS \u{1F600}
  "|\\\\U([0-9A-Fa-f]{8})" +                        // C/Java \U0001F600
  "|\\\\x\\{([0-9A-Fa-f]{1,6})\\}" +                // Perl/Rust \x{4E00}
  "|%u([0-9A-Fa-f]{4})" +                           // URL 式 %u4E00
  "|(?:^|[^0-9A-Fa-fxX])0x([0-9A-Fa-f]{4,6})(?![0-9A-Fa-f])", // 0x4E00（保守）
  "g"
);
function expandCpDescs(text, map) {
  if (!map) return String(text);
  return String(text).replace(CP_DESC_RE, (m, a, b, c, d, e, f, g, h, i) => {
    const hex = a || b || c || d || e || f || g || h || i;
    if (!hex) return m;
    const cp = parseInt(hex, a || b || c ? 16 : 10);
    if (!Number.isFinite(cp) || cp > 0x10FFFF) return m;
    // 排除 C0/C1 控制符、空格与代理区：防注入不可见字符，代理区无独立字形
    if (cp < 0x21 || (cp >= 0x7F && cp <= 0x9F) || cp === 0x20) return m;
    if (cp >= 0xD800 && cp <= 0xDFFF) return m;
    const ch = String.fromCodePoint(cp);
    const idx = map.length;
    map.push({ ch, desc: m });
    // 0x 分支的 m 带一个前导非 hex 字符（防截断保护），须原样保留在正文里
    const lead = i != null ? m[0] : "";
    return lead + CP_PH_OPEN + idx + CP_PH_CLOSE;
  });
}
function restoreCpDescs(html, map) {
  if (!map || !map.length) return html;
  return html.replace(new RegExp(CP_PH_OPEN + "(\\d+)" + CP_PH_CLOSE, "g"), (m, i) => {
    const item = map[+i];
    if (!item) return "";
    return `<span class="uv-cp-ex" title="${escHtml(item.desc)}">${escHtml(item.ch)}</span>`;
  });
}

// ============================================================
// T360：渲染全部 → 保存 SVG / PNG（导出管线）
// 原则：SVG 是独立文档，不吃页面 CSS —— 用 getComputedStyle 逐节点固化关键样式；
//       零外发自检：导出前 assert 无 http(s)://；PNG 恒内嵌天珩字库（canvas 不加载外部字体）。
// ============================================================
const TH_FONT_NAME = "Cheonhyeong";
const TH_FONT_URL = new URL("../../public/fonts/th/th-ctf-subset.woff2", import.meta.url);
const EXPORT_STYLE_PROPS = [
  "font-family", "font-size", "font-weight", "font-style", "color", "background-color",
  "margin", "padding", "line-height", "text-align", "white-space", "display",
  "text-decoration", "vertical-align", "box-sizing",
];

// 克隆渲染体并逐节点固化计算样式（含 KaTeX 内层布局），不改原 DOM。
// ⚠ 必须在「原树」上取 getComputedStyle（clone 未插入文档，计算样式拿不到），
//   再把样式写入 clone 对应节点 —— 双树同步遍历。
function cloneWithInlineStyles(root) {
  const clone = root.cloneNode(true);
  const walkPair = (src, dst) => {
    if (!src || src.nodeType !== 1 || !dst) return;
    const cs = getComputedStyle(src);
    let css = "";
    for (const p of EXPORT_STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (!v || v === "none" || v === "normal" || v === "0px") continue;
      if (p === "font-family" && v.includes("initial")) continue;
      css += p + ":" + v + ";";
    }
    const bw = cs.getPropertyValue("border-top-width");
    const bs = cs.getPropertyValue("border-top-style");
    const bc = cs.getPropertyValue("border-top-color");
    if (bw && bw !== "0px" && bs && bs !== "none") css += "border:" + bw + " " + bs + " " + bc + ";";
    if (css) dst.setAttribute("style", (dst.getAttribute("style") || "") + css);
    const sc = src.children, dc = dst.children;
    for (let i = 0; i < sc.length; i++) walkPair(sc[i], dc[i]);
  };
  walkPair(root, clone);
  clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  return clone;
}

// 导出图底色：取主题 surface-1 的实际计算色（probe 元素，主题切换后也正确）
function exportBg() {
  const probe = document.createElement("div");
  probe.style.cssText = "position:fixed;left:-99999px;top:0;background:var(--surface-1)";
  document.body.append(probe);
  let bg = getComputedStyle(probe).backgroundColor;
  probe.remove();
  if (!bg || bg === "transparent" || bg === "rgba(0, 0, 0, 0)") bg = "#1d1815";
  return bg;
}

// woff2 → base64 data URL（分块转换，防 String.fromCharCode 参数过多爆栈）
async function thFontDataUrl() {
  return fontDataUrl(TH_FONT_URL);
}
async function fontDataUrl(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("字体加载失败 HTTP " + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  return "data:font/woff2;base64," + btoa(bin);
}

// ============ KaTeX 导出内联（所见即所得：公式渲染成品 = 页面渲染成品）============
// 背景：导出 SVG/PNG 时 foreignObject 是独立文档，不吃页面 CSS。旧实现只把
//   .uv-md-body 的少量计算样式固化成内联 style，KaTeX 公式依赖的 .katex 布局规则
//   （position/width/white-space/display 等）与 KaTeX 字体全没带进去 → 公式塌陷，
//   只剩 exportBg() 的背景色（白天白块/黑夜黑块）。恒烈 2026-08-26 拍板：所见即所得。
// 修法：把 katex.min.css 的布局规则原文注入 SVG <style>，并按公式实际用到的
//   font-family 内嵌对应 woff2（data URL），让 foreignObject 渲染结果与页面一致。
// 体积：仅内嵌扫描到的 family；纯文本/无公式场景不注入，SVG 保持 <200KB 判据。
const KATEX_CSS_URL = new URL("../../public/vendor/katex/katex.min.css", import.meta.url);
const KATEX_FONT_DIR = new URL("../../public/vendor/katex/fonts/", import.meta.url);
// family → 全部 woff2 文件（weight/style 见文件名，@font-face 需补全声明）
const KATEX_FONT_FILES = {
  "KaTeX_AMS": ["KaTeX_AMS-Regular.woff2"],
  "KaTeX_Caligraphic": ["KaTeX_Caligraphic-Regular.woff2", "KaTeX_Caligraphic-Bold.woff2"],
  "KaTeX_Fraktur": ["KaTeX_Fraktur-Regular.woff2", "KaTeX_Fraktur-Bold.woff2"],
  "KaTeX_Main": ["KaTeX_Main-Regular.woff2", "KaTeX_Main-Bold.woff2", "KaTeX_Main-Italic.woff2", "KaTeX_Main-BoldItalic.woff2"],
  "KaTeX_Math": ["KaTeX_Math-Italic.woff2", "KaTeX_Math-BoldItalic.woff2"],
  "KaTeX_SansSerif": ["KaTeX_SansSerif-Regular.woff2", "KaTeX_SansSerif-Bold.woff2", "KaTeX_SansSerif-Italic.woff2"],
  "KaTeX_Script": ["KaTeX_Script-Regular.woff2"],
  "KaTeX_Size1": ["KaTeX_Size1-Regular.woff2"],
  "KaTeX_Size2": ["KaTeX_Size2-Regular.woff2"],
  "KaTeX_Size3": ["KaTeX_Size3-Regular.woff2"],
  "KaTeX_Size4": ["KaTeX_Size4-Regular.woff2"],
  "KaTeX_Typewriter": ["KaTeX_Typewriter-Regular.woff2"],
};
// 文件名 → [weight, style]（KaTeX 官方命名规律）
function katexFontMeta(file) {
  const base = file.replace(/^KaTeX_[A-Za-z]+-/, "").replace(/\.woff2$/, "");
  const w = base.includes("Bold") ? 700 : 400;
  const st = base.includes("Italic") ? "italic" : "normal";
  return { w, st };
}
// 扫描渲染体，收集实际用到的 KaTeX font-family 名（精确到 family，去重）
function collectKatexFonts(body) {
  const set = new Set();
  const walk = (el) => {
    if (!el || el.nodeType !== 1) return;
    const fam = (getComputedStyle(el).fontFamily || "");
    for (const m of fam.matchAll(/KaTeX_[A-Za-z0-9_]+/g)) set.add(m[0]);
    for (const c of el.children) walk(c);
  };
  walk(body);
  return [...set];
}
// 组装 KaTeX 导出 CSS：布局规则全文 + 用到的 family @font-face（data URL 内嵌）
async function katexExportCss(body) {
  let css = "";
  try {
    const res = await fetch(KATEX_CSS_URL);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const raw = await res.text();
    // 布局规则：剥掉 @font-face 块（字体改由下方按需内嵌，且原 url 相对路径在 SVG 里无效）
    css += raw.replace(/@font-face\{[^}]*\}/g, "");
    const fams = collectKatexFonts(body);
    for (const fam of fams) {
      const files = KATEX_FONT_FILES[fam];
      if (!files) continue;
      for (const file of files) {
        const { w, st } = katexFontMeta(file);
        const url = await fontDataUrl(new URL(file, KATEX_FONT_DIR));
        css += "@font-face{font-family:\"" + fam + "\";font-weight:" + w + ";font-style:" + st + ";src:url(" + url + ") format(\"woff2\");}\n";
      }
    }
  } catch (e) { /* 降级：KaTeX 规则/字体拿不到就不注入（公式会用系统字体，不白屏） */ }
  return css;
}

// 组装 SVG 文本：body = .uv-md-body 渲染容器；embedFont 是否内嵌天珩字库
async function buildExportSvg(body, embedFont) {
  // 用户可能手快：先把还没渲染的公式渲染完再导出
  if (body.querySelector("[data-tex]:not([data-tex-done])")) {
    try { await renderMathIn(body); } catch { /* 降级继续 */ }
  }
  const clone = cloneWithInlineStyles(body);
  clone.style.backgroundColor = exportBg();
  const hasMath = !!body.querySelector(".katex");
  // 公式余量：KaTeX 块级公式的上下 margin / 绝对定位延伸会超出 scrollHeight 测量，
  // 不放大导出图底部被裁。仅公式场景 +125%（无公式保持原高，避免底部留白）。
  const h = Math.max(1, Math.round(body.scrollHeight * (hasMath ? 2.25 : 1)));
  const w = Math.max(1, body.scrollWidth);
  const xhtml = new XMLSerializer().serializeToString(clone);
  let css = ".uv-md-body{box-sizing:border-box;}";
  // 有公式 → 注入 KaTeX 布局规则 + 实际用到的 KaTeX 字体（否则公式塌成色块）
  if (body.querySelector(".katex")) css += "\n" + (await katexExportCss(body));
  if (embedFont) css += "@font-face{font-family:\"" + TH_FONT_NAME + "\";src:url(" + (await thFontDataUrl()) + ") format(\"woff2\");font-display:swap;}";
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + " " + h + '">\n' +
    "<style>" + css + "</style>\n" +
    '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">\n' +
    xhtml + "\n" +
    "</foreignObject>\n" +
    "</svg>";
  // 零外发自检：SVG 里不许出现任何网络外链（xmlns 命名空间 URI www.w3.org 除外——那是 XML 规范 URI）
  if (/https?:\/\/(?!www\.w3\.org\/)/.test(svg)) throw new Error("导出内容含外部链接，已拦截");
  return svg;
}

// SVG 文本 → PNG blob（canvas 管线，scale 倍率）
// ⚠ 用 data: URL 而非 blob: URL —— 本 Chromium 版本把「blob URL 加载含 foreignObject 的 SVG」
//   视为跨源而污染 canvas（T360 实测），data: URL 不受影响。
function svgToPngBlob(svgText, scale) {
  return new Promise((resolve, reject) => {
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText);
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 编码失败"))), "image/png");
      } catch (e) { reject(e); }
    };
    img.onerror = () => reject(new Error("SVG 渲染失败"));
    img.src = url;
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function renderRenderAllView(text) {
  const wrap = el("div", { class: "uv-renderall-wrap" });

  wrap.append(el("div", { class: "uv-render-sec-desc" }, tt("ui.uv.renderAllDesc")));

  // MT77①：码位描述编码转换开关（默认开；关 = 原文按原样渲染，互不污染）。
  // 常驻渲染区上方——未点「分析」时也可见可切，不再藏在渲染结果里（恒烈要求提前出现）。
  const cpDescLabel = el("label", { class: "uv-cp-toggle" });
  const cpDescChk = el("input", { type: "checkbox" });
  cpDescChk.checked = uvState.renderall.cpDesc;
  cpDescLabel.append(cpDescChk, el("span", {}, tt("ui.uv.cpDescV2"))); // 示例换「力」（恒烈：一字不明显）
  wrap.append(cpDescLabel);

  // 渲染舞台（显示区）：独立卡片，与下方导出按钮行明确分区（恒烈要求显示部分与按钮空间明显区分）。
  // CSS var(--font-content) = 天珩字库，md 结构 + 天珩字形合并生效。
  const body = el("div", { class: "uv-md-body uv-cheon-body" });
  const stage = el("div", { class: "uv-render-stage" }, body);
  wrap.append(stage);

  // T360：保存渲染结果（SVG / PNG）+ 内嵌字体开关 + PNG 倍率 —— 全部放显示区下方（恒烈拍板）
  const exportRow = el("div", { class: "uv-export-row" });
  const embedChk = el("input", { type: "checkbox", id: "uv_embed_font" });
  embedChk.checked = uvState.renderall.embedFont;
  embedChk.addEventListener("change", () => { uvState.renderall.embedFont = embedChk.checked; });
  const embedLabel = el("label", { class: "uv-export-opt", title: tt("ui.uv.embedFontHint") },
    embedChk, el("span", {}, tt("ui.uv.embedFont")));
  const scaleSel = el("select", { class: "uv-export-scale", title: tt("ui.uv.scale") });
  for (const s of ["1", "2", "3"]) scaleSel.append(el("option", { value: s }, s + "x"));
  scaleSel.value = String(uvState.renderall.pngScale);
  scaleSel.addEventListener("change", () => { uvState.renderall.pngScale = Number(scaleSel.value) || 2; });
  const scaleLabel = el("label", { class: "uv-export-opt" }, tt("ui.uv.scale"), scaleSel);
  const svgBtn = el("button", { type: "button", class: "btn", onclick: () => doExport("svg") }, msym("download"), tt("ui.uv.saveSvg"));
  const pngBtn = el("button", { type: "button", class: "btn", onclick: () => doExport("png") }, msym("image"), tt("ui.uv.savePng"));
  exportRow.append(svgBtn, pngBtn, embedLabel, scaleLabel);
  wrap.append(exportRow);

  // 导出执行：svg 按勾选决定是否内嵌字体；png 恒内嵌字体（canvas 不加载外部字体）
  let exporting = false;
  function doExport(kind) {
    if (exporting) return;
    if (!text) { toast(tt("ui.uv.renderEmpty")); return; }
    exporting = true;
    svgBtn.disabled = pngBtn.disabled = true;
    (async () => {
      try {
        // 导出图里有公式时，如实提示 KaTeX 字体未内嵌（不假装一定正确）
        const hasMath = !!body.querySelector(".katex");
        const formulaNote = hasMath ? " " + tt("ui.uv.exportFormulaHint") : "";
        if (kind === "svg") {
          const svg = await buildExportSvg(body, embedChk.checked);
          downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "uv-renderall.svg");
          toast(tt("ui.uv.savedSvg") + formulaNote);
        } else {
          const svg = await buildExportSvg(body, true); // PNG 恒内嵌天珩字库
          const png = await svgToPngBlob(svg, Number(scaleSel.value) || 2);
          downloadBlob(png, "uv-renderall.png");
          toast(tt("ui.uv.savedPng") + formulaNote);
        }
      } catch (e) {
        toast(tt("ui.uv.exportErr", (e && e.message) || String(e)));
      } finally {
        exporting = false;
        svgBtn.disabled = pngBtn.disabled = false;
      }
    })();
  }

  const render = () => {
    body.innerHTML = "";
    if (!text) {
      body.innerHTML = `<div class="uv-empty">${escHtml(tt("ui.uv.renderEmpty"))}</div>`;
      return;
    }
    const map = [];
    const srcText = cpDescChk.checked ? expandCpDescs(text, map) : text;
    renderMergedInto(body, srcText, (html) => restoreCpDescs(html, map));
  };
  cpDescChk.addEventListener("change", () => {
    uvState.renderall.cpDesc = cpDescChk.checked;
    render();
  });
  render();

  return wrap;
}

// ============================================================
// 视图 ⑤：拼字 / IDS（表意文字描述序列）——正查分解树 / 反查部件→字 / 双向互转
// ============================================================
// 数据：public/data/ids.dat（构建期由 工具/_gen_ids_data.mjs 生成，运行时本地 fetch，零外发）。
// 格式：码点升序 + 变长整数增量编码 + IDS 串共享字典 + 部件→字反查索引。
// IDC 描述符共 17 个：U+2FF0–U+2FFB + U+2FFC–U+2FFF + U+31EF。
const IDS_BIN_URL = new URL("../../public/data/ids.dat", import.meta.url);
const IDS_TREE_CAP = 6;        // 分解树默认最大展开深度
const IDS_NODE_BUDGET = 400;   // 每棵分解树渲染节点预算（防爆）
const IDS_PAGE_MIN = 10, IDS_PAGE_MAX = 200, IDS_PAGE_DEFAULT = 50;
const IDC_CODES = new Set([0x2FF0,0x2FF1,0x2FF2,0x2FF3,0x2FF4,0x2FF5,0x2FF6,0x2FF7,0x2FF8,0x2FF9,0x2FFA,0x2FFB,0x2FFC,0x2FFD,0x2FFE,0x2FFF,0x31EF]);
// 各 IDC 的排布方向（决定分解树子节点 flex 方向）
const IDC_DIR = new Map([
  [0x2FF0,"row"],[0x2FF1,"col"],[0x2FF2,"row"],[0x2FF3,"col"],
  [0x2FF4,"row"],[0x2FF5,"col"],[0x2FF6,"col"],[0x2FF7,"row"],
  [0x2FF8,"row"],[0x2FF9,"row"],[0x2FFA,"row"],[0x2FFB,"overlay"],
  [0x2FFC,"row"],[0x2FFD,"row"],[0x2FFE,"row"],[0x2FFF,"row"],
  [0x31EF,"row"],
]);
const IDC_ARITY_3 = new Set([0x2FF2, 0x2FF3]); // 左中右 / 上中下：三目
const IDC_UNARY = new Set([0x2FFE, 0x2FFF]);   // 水平镜像 / 旋转：一目

let _idsIndexPromise = null;
function loadIdsIndex() {
  if (!_idsIndexPromise) {
    _idsIndexPromise = (async () => {
      const res = await fetch(IDS_BIN_URL);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return decodeIdsBin(new Uint8Array(await res.arrayBuffer()));
    })();
    // 失败不缓存 rejected promise：下次进 tab 重新拉取（审计 P3-22，网络抖动自愈）
    _idsIndexPromise.catch(() => { _idsIndexPromise = null; });
  }
  return _idsIndexPromise;
}

// ---- 二进制解码（头 40 字节 + 变长整数 LEB128 无符号）----
function decodeIdsBin(u8) {
  let i = 0;
  const rd32 = (o) => u8[o] | (u8[o+1] << 8) | (u8[o+2] << 16) | (u8[o+3] << 24);
  const rdVar = () => {
    let n = 0, s = 0;
    for (;;) {
      const x = u8[i++];
      n |= (x & 0x7f) << s;
      if (!(x & 0x80)) return n >>> 0;
      s += 7;
    }
  };
  const charCount = rd32(12), dictCount = rd32(16);
  const offChars = rd32(24), offDict = rd32(28), offComps = rd32(32);

  // IDS 串共享字典
  const dict = [];
  i = offDict;
  for (let d = 0; d < dictCount; d++) {
    const l = rdVar();
    dict.push(td(u8.subarray(i, i + l)) || "");
    i += l;
  }

  // 字 → [(源, IDS)]，并按 IDS 串建立精确反查
  const byCp = new Map();
  const idsToChars = new Map();
  i = offChars;
  let prev = 0;
  for (let c = 0; c < charCount; c++) {
    prev += rdVar();
    const n = rdVar();
    const es = [];
    for (let k = 0; k < n; k++) {
      const src = String.fromCharCode(u8[i++]);
      const ids = dict[rdVar()];
      es.push({ src, ids });
    }
    byCp.set(prev, es);
    for (const e of es) {
      let arr = idsToChars.get(e.ids);
      if (!arr) { arr = []; idsToChars.set(e.ids, arr); }
      arr.push(prev);
    }
  }

  // 部件 → 字 反查索引
  const comps = new Map();
  i = offComps;
  let prevComp = 0;
  for (let c = 0, nComps = rd32(20); c < nComps; c++) {
    prevComp += rdVar();
    const n = rdVar();
    const list = [];
    let prevChar = 0;
    for (let k = 0; k < n; k++) { prevChar += rdVar(); list.push(prevChar); }
    comps.set(prevComp, list);
  }
  return { byCp, idsToChars, comps };
}

// ---- IDS 串 → 树（{N} 占位部件 / ？ 视为叶子）----
function parseIdsTree(ids) {
  let i = 0;
  function node() {
    if (ids[i] === "{") {
      let j = ids.indexOf("}", i);
      if (j < 0) j = ids.length;
      const tok = ids.slice(i, j + 1);
      i = j + 1;
      return { leaf: tok, unencoded: true };
    }
    const cp = ids.codePointAt(i);
    i += cp > 0xFFFF ? 2 : 1;   // 按码点步进：代理对部件占 2 个 UTF-16 码元
    const ch = String.fromCodePoint(cp);
    if (IDC_CODES.has(cp)) {
      const arity = IDC_ARITY_3.has(cp) ? 3 : IDC_UNARY.has(cp) ? 1 : 2;
      const children = [];
      for (let k = 0; k < arity; k++) children.push(node());
      return { op: ch, cp, children };
    }
    return { leaf: ch, cp };
  }
  return node();
}

// ---- 收集一棵 IDS 的叶子部件码点 ----
function collectLeaves(ids) {
  const set = new Set();
  const root = parseIdsTree(ids);
  (function walk(n) {
    if (n.op) { for (const c of n.children) walk(c); return; }
    if (!n.unencoded && n.cp != null && n.leaf !== "？") set.add(n.cp);
  })(root);
  return [...set];
}

// ---- 多部件交集（各列表升序）----
function intersectByComps(idx, compCps) {
  if (!compCps.length) return [];
  const arrs = [];
  for (const cp of compCps) {
    const list = idx.comps.get(cp);
    if (list && list.length) arrs.push(list);
  }
  if (!arrs.length) return [];
  let cur = arrs[0];
  for (let a = 1; a < arrs.length && cur.length; a++) {
    const b = arrs[a];
    const out = [];
    let p = 0;
    for (const x of cur) {
      while (p < b.length && b[p] < x) p++;
      if (b[p] === x) out.push(x);
    }
    cur = out;
  }
  return cur;
}

// ---- 视图外壳：数据就绪后局部填充 body（不整块重建，避免输入框丢焦点）----
function renderIdsView() {
  ensureIdsCss();
  const wrap = el("div", { class: "uv-ids-wrap uv-ids" });
  const body = el("div", { class: "uv-ids-body" });
  body.append(el("div", { class: "uv-empty" }, tt("ui.uv.idsLoading")));
  wrap.append(body);
  loadIdsIndex().then(
    (idx) => {
      if (!body.isConnected) return;
      body.innerHTML = "";
      renderIdsBody(body, idx);
    },
    (err) => {
      if (!body.isConnected) return;
      body.innerHTML = "";
      body.append(el("div", { class: "uv-ids-error" },
        tt("ui.uv.idsLoadFail") + (err && err.message ? "（" + err.message + "）" : "")));
    },
  );
  return wrap;
}

// ---- 三个档位切换 ----
function renderIdsBody(body, idx) {
  const subtabs = [
    { id: "fwd", label: tt("ui.uv.idsFwd") },
    { id: "rev", label: tt("ui.uv.idsRev") },
    { id: "conv", label: tt("ui.uv.idsConv") },
  ];
  const bar = el("div", { class: "uv-ids-subtabs" });
  const pane = el("div", { class: "uv-ids-pane" });
  const btns = [];
  const switchSub = (id) => {
    idsState.sub = id;
    for (const b of btns) b.classList.toggle("active", b.dataset.sub === id);
    pane.innerHTML = "";
    pane.append(id === "fwd" ? renderIdsFwdPane(idx)
      : id === "rev" ? renderIdsRevPane(idx)
      : renderIdsConvPane(idx));
  };
  for (const t of subtabs) {
    const b = el("button", { class: "uv-ids-subtab" + (idsState.sub === t.id ? " active" : ""), "data-sub": t.id, type: "button" }, t.label);
    b.addEventListener("click", () => switchSub(t.id));
    btns.push(b);
    bar.append(b);
  }
  body.append(el("div", { class: "uv-ids-desc" }, tt("ui.uv.idsDesc")));
  body.append(bar);
  body.append(pane);
  switchSub(idsState.sub);
}

// ---- 通用格子：上字形 + 下标签（同一盒子，中心对齐）----
function makeCell(cp, cls) {
  const cell = el("div", { class: cls || "uv-ids-cell" }, 
    el("span", { class: "uv-ids-cell-glyph" }, String.fromCodePoint(cp)),
    el("span", { class: "uv-ids-cell-cp" }, cpLabel(cp)));
  cell.title = cpLabel(cp);
  return cell;
}

// ============ 档1：正查（字 → 分解树）============
// 输入统一走上方共享输入框（恒烈要求：拼字的输入就是上方输入框，不再另起一个）
function renderIdsFwdPane(idx) {
  const pane = el("div", { class: "uv-ids-pane" });
  const results = el("div", { class: "uv-ids-results" });
  pane.append(results);
  // 深度展开/收起是全局状态：onRerender 原地重建 results，让所有分解树同步切深度
  const render = () => { results.innerHTML = ""; renderIdsFwdResults(results, idx, uvState.text || "", render); };
  render();
  return pane;
}

function renderIdsFwdResults(results, idx, value, onRerender) {
  const chars = [...value]; // 逐码位（CJK 单码位）
  if (!chars.length) {
    results.append(el("div", { class: "uv-empty" }, tt("ui.uv.idsEmptyFwdTop")));
    return;
  }
  let any = false;
  for (const ch of chars) {
    const cp = ch.codePointAt(0);
    const entries = idx.byCp.get(cp);
    if (!entries) continue;
    any = true;
    const sec = el("div", { class: "uv-ids-fwd-sec" });
    sec.append(el("div", { class: "uv-ids-fwd-char" },
      el("span", { class: "uv-ids-fwd-glyph" }, ch),
      el("span", { class: "uv-ids-fwd-cp" }, cpLabel(cp) + " · " + entries.length + " " + tt("ui.uv.idsSrc"))));
    for (const e of entries) sec.append(renderIdsEntry(idx, e.src, e.ids, onRerender));
    results.append(sec);
  }
  if (!any) results.append(el("div", { class: "uv-empty" }, tt("ui.uv.idsNoData")));
}

function renderIdsEntry(idx, src, ids, onRerender) {
  const card = el("div", { class: "uv-ids-entry" });
  const top = el("div", { class: "uv-ids-entry-top" },
    el("span", { class: "uv-ids-src" }, tt("ui.uv.idsSrc") + " " + src),
    el("span", { class: "uv-ids-raw" }, ids));
  const tools = el("span", { class: "uv-ids-tools" });
  const toggle = el("button", { type: "button", class: "uv-ids-mini" }, tt(idsState.deep ? "ui.uv.idsCollapse" : "ui.uv.idsExpand"));
  tools.append(toggle);
  top.append(tools);
  const tree = el("div", { class: "uv-ids-tree" });
  const renderTree = () => {
    tree.innerHTML = "";
    const budget = { n: IDS_NODE_BUDGET };
    renderIdsNode(tree, parseIdsTree(ids), 0, idsState.deep ? IDS_TREE_CAP + 6 : IDS_TREE_CAP, budget, idx);
  };
  toggle.addEventListener("click", () => {
    idsState.deep = !idsState.deep;
    toggle.textContent = tt(idsState.deep ? "ui.uv.idsCollapse" : "ui.uv.idsExpand");
    // 展开/收起是全局状态：重渲染整个 fwd results，让所有 entry 的树同步切换深度
    if (onRerender) onRerender();
    else renderTree();
  });
  card.append(top, tree);
  renderTree();
  return card;
}

// 递归渲染分解树；达深度上限的部件以叶子态展示（可再拆的带 + 提示）
function renderIdsNode(container, node, depth, cap, budget, idx) {
  if (budget.n <= 0) { container.append(el("span", { class: "uv-ids-ellipsis" }, "…")); return; }
  budget.n--;
  if (node.op) {
    const dir = IDC_DIR.get(node.cp) || "row";
    const box = el("div", { class: "uv-ids-node " + dir, title: "U+" + node.cp.toString(16).toUpperCase() });
    box.append(el("span", { class: "uv-ids-op" }, node.op));
    for (const child of node.children) {
      if (depth >= cap) appendIdsLeaf(box, child, true, idx);
      else renderIdsNode(box, child, depth + 1, cap, budget, idx);
    }
    container.append(box);
  } else {
    container.append(appendIdsLeaf(container, node, false, idx));
  }
}

function appendIdsLeaf(container, node, capped, idx) {
  const cell = el("div", { class: "uv-ids-leaf" + (node.unencoded ? " unencoded" : "") });
  if (node.unencoded) {
    cell.append(el("span", { class: "uv-ids-leaf-glyph" }, node.leaf));
    cell.append(el("span", { class: "uv-ids-leaf-cp" }, tt("ui.uv.idsUnencoded")));
    cell.title = tt("ui.uv.idsUnencodedNote", node.leaf);
  } else if (node.leaf === "？") {
    cell.append(el("span", { class: "uv-ids-leaf-glyph" }, "？"));
    cell.append(el("span", { class: "uv-ids-leaf-cp" }, "？"));
  } else {
    cell.append(el("span", { class: "uv-ids-leaf-glyph" }, node.leaf));
    cell.append(el("span", { class: "uv-ids-leaf-cp" }, cpLabel(node.cp)));
    // 部件自身还有更深分解但被深度上限截断 → 给出 + 提示
    if (capped) {
      const sub = idx.byCp.get(node.cp);
      if (sub && sub.some((e) => e.ids !== node.leaf)) cell.append(el("span", { class: "uv-ids-leaf-more" }, "+"));
    }
  }
  container.append(cell);
  return cell;
}

// ============ 档2：反查（部件 → 字，支持 IDS 表达式精确匹配）============
function renderIdsRevPane(idx) {
  const pane = el("div", { class: "uv-ids-pane" });
  const ctrl = el("div", { class: "uv-ids-ctrl" });
  const results = el("div", { class: "uv-ids-results" });
  // M3 stepper（[−][框][＋]，type=text + inputmode=numeric）：每页条数
  ctrl.append(el("span", { class: "uv-ids-pagesize-label" }, tt("ui.uv.idsPageSize") + "："));
  ctrl.append(makePageSizeStepper(() => {
    idsState.page = 0;
    results.innerHTML = "";
    renderIdsRevResults(results, idx, uvState.text || "");
  }));
  pane.append(ctrl, results);
  renderIdsRevResults(results, idx, uvState.text || "");
  return pane;
}

// M3 stepper 自实现（范式同 main.js renderParam）：数字输入不用原生 spinner
function makePageSizeStepper(onChange) {
  const inp = el("input", { type: "text", inputmode: "numeric", class: "stepper-inp" });
  inp.value = String(idsState.pageSize);
  const clamp = (n) => Math.max(IDS_PAGE_MIN, Math.min(IDS_PAGE_MAX, n));
  const commit = (n) => {
    const v = clamp(Number.isFinite(n) ? n : idsState.pageSize);
    idsState.pageSize = v;
    inp.value = String(v);
    onChange();
  };
  inp.addEventListener("input", () => { const n = parseInt(inp.value, 10); if (Number.isFinite(n)) commit(n); });
  inp.addEventListener("blur", () => { if (inp.value !== "") commit(parseInt(inp.value, 10) || idsState.pageSize); });
  const btn = (iconName, dir, label) => {
    const b = el("button", { type: "button", class: "stepper-btn", "aria-label": label, tabindex: "-1" }, msym(iconName));
    b.addEventListener("click", () => commit((parseInt(inp.value, 10) || idsState.pageSize) + dir * 10));
    return b;
  };
  return el("div", { class: "stepper" }, btn("remove", -1, "减"), inp, btn("add", 1, "加"));
}

function renderIdsRevResults(results, idx, value) {
  const raw = value.trim();
  if (!raw) {
    results.append(el("div", { class: "uv-empty" }, tt("ui.uv.idsEmptyRevTop")));
    return;
  }
  let matches = [], exact = false;
  const first = raw.codePointAt(0);
  if (IDC_CODES.has(first)) {
    // IDS 表达式：精确匹配；无匹配时回退为叶子部件交集
    const ids = raw.replace(/\s+/g, "").replace(/\u303E/g, "");
    matches = idx.idsToChars.get(ids) || [];
    exact = matches.length > 0;
    if (!exact) {
      results.append(el("div", { class: "uv-ids-rev-stat" }, tt("ui.uv.idsNoExact")));
      matches = intersectByComps(idx, collectLeaves(ids));
    }
  } else {
    const comps = [...raw].filter((c) => !/\s/.test(c)).map((c) => c.codePointAt(0));
    matches = intersectByComps(idx, comps);
  }

  const total = matches.length;
  const pageSize = idsState.pageSize;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (idsState.page >= pages) idsState.page = pages - 1;
  const page = idsState.page;
  const slice = matches.slice(page * pageSize, (page + 1) * pageSize);

  results.append(el("div", { class: "uv-ids-rev-stat" },
    exact ? tt("ui.uv.idsRevExact", total) : tt("ui.uv.idsRevCount", total)));
  if (total === 0) {
    results.append(el("div", { class: "uv-empty" }, tt("ui.uv.idsRevEmpty")));
    return;
  }

  const grid = el("div", { class: "uv-ids-grid" });
  for (const cp of slice) grid.append(makeCell(cp, "uv-ids-cell"));
  results.append(grid);

  if (pages > 1) {
    const pager = el("div", { class: "uv-ids-pager" });
    const prev = el("button", { type: "button", class: "uv-ids-pager-btn" }, "←", el("span", {}, tt("ui.uv.idsPrev")));
    prev.disabled = page === 0;
    prev.addEventListener("click", () => { if (idsState.page > 0) { idsState.page--; rerender(); } });
    const next = el("button", { type: "button", class: "uv-ids-pager-btn" }, el("span", {}, tt("ui.uv.idsNext")), "→");
    next.disabled = page >= pages - 1;
    next.addEventListener("click", () => { if (idsState.page < pages - 1) { idsState.page++; rerender(); } });
    pager.append(prev, el("span", { class: "uv-ids-pageinfo" }, tt("ui.uv.idsPage", page + 1, pages)), next);
    results.append(pager);
  }
  function rerender() {
    results.innerHTML = "";
    renderIdsRevResults(results, idx, uvState.text || "");
  }
}

// ============ 档3：互转（字 ⇄ IDS 串）============
function renderIdsConvPane(idx) {
  const pane = el("div", { class: "uv-ids-pane" });
  const results = el("div", { class: "uv-ids-results" });
  pane.append(results);
  renderIdsConvResults(results, idx, uvState.text || "");
  return pane;
}

function renderIdsConvResults(results, idx, value) {
  const raw = value.trim();
  if (!raw) {
    results.append(el("div", { class: "uv-empty" }, tt("ui.uv.idsEmptyConvTop")));
    return;
  }
  const first = raw.codePointAt(0);
  if (IDC_CODES.has(first)) {
    // IDS 表达式 → 字
    const ids = raw.replace(/\s+/g, "").replace(/\u303E/g, "");
    const hits = idx.idsToChars.get(ids) || [];
    results.append(el("div", { class: "uv-ids-rev-stat" }, tt("ui.uv.idsConvHits", hits.length)));
    if (hits.length) {
      const grid = el("div", { class: "uv-ids-grid" });
      for (const cp of hits.slice(0, 200)) grid.append(makeCell(cp, "uv-ids-cell"));
      results.append(grid);
      if (hits.length > 200) results.append(el("div", { class: "uv-truncate" }, "…"));
    } else {
      results.append(el("div", { class: "uv-empty" }, tt("ui.uv.idsRevEmpty")));
    }
  } else {
    // 字 → IDS 串（多字逐行）
    const lines = [];
    let any = false;
    for (const ch of [...raw]) {
      const cp = ch.codePointAt(0);
      const entries = idx.byCp.get(cp);
      if (!entries) continue;
      any = true;
      for (const e of entries) lines.push(cpLabel(cp) + "\t" + ch + "\t[" + e.src + "]\t" + e.ids);
    }
    if (!any) { results.append(el("div", { class: "uv-empty" }, tt("ui.uv.idsNoData"))); return; }
    results.append(el("pre", { class: "uv-ids-conv-pre" }, lines.join("\n")));
  }
}

// ---- 视图 CSS（随 JS 注入，避免改 css 文件）----
let _idsCssInjected = false;
function ensureIdsCss() {
  if (_idsCssInjected) return;
  _idsCssInjected = true;
  const style = el("style", { "data-uv-ids": "" });
  style.textContent = IDS_CSS;
  (document.head || document.documentElement).append(style);
}
const IDS_CSS = `
/* 拼字区整体呼吸感（恒烈两轮点名「挤」）：块间距 sp-4、控件行 sp-3、格子/树内加大留白。
 * ⚠ .uv-ids-body 才是实际容器（renderIdsBody 把 描述/子页签/结果面板 塞在这里）——
 *   上轮只调了 .uv-ids-wrap 的 gap 无效（它只包 body 一个子节点），描述与三个按钮仍贴死。 */
.uv-ids-wrap{display:flex;flex-direction:column;}
.uv-ids-body{display:flex;flex-direction:column;gap:var(--sp-4);}
.uv-ids-desc{font-size:var(--fs-xs);color:var(--on-surface-var);}
.uv-ids-error{padding:var(--sp-3);background:var(--surface-1);border:1px solid var(--error,#f44336);border-radius:var(--r-lg);color:var(--error,#f44336);font-size:var(--fs-sm);}
.uv-ids-subtabs{display:flex;flex-wrap:wrap;gap:var(--sp-3);}
.uv-ids-subtab{display:inline-flex;align-items:center;gap:var(--sp-1);padding:8px 18px;min-height:40px;box-sizing:border-box;border:1px solid var(--outline-var);border-radius:var(--r-full);background:var(--surface-1);color:var(--on-surface-var);font-size:var(--fs-sm);cursor:pointer;transition:background var(--dur-short) var(--ease),color var(--dur-short) var(--ease);}
.uv-ids-subtab:hover{background:var(--surface-hi);}
.uv-ids-subtab.active{background:var(--primary);color:var(--on-primary);border-color:var(--primary);}
.uv-ids-pane{display:flex;flex-direction:column;gap:var(--sp-4);}
.uv-ids-ctrl{display:flex;flex-wrap:wrap;align-items:center;gap:var(--sp-3);}
.uv-ids-pagesize-label{font-size:var(--fs-sm);color:var(--on-surface-var);}
.uv-ids .stepper{flex:none;}
.uv-ids .stepper-inp{flex:none;width:4.2em;min-width:0;}
.uv-ids-results{display:flex;flex-direction:column;gap:var(--sp-4);}
/* 正查 */
.uv-ids-fwd-sec{display:flex;flex-direction:column;gap:var(--sp-3);}
.uv-ids-fwd-char{display:flex;align-items:baseline;gap:var(--sp-2);}
.uv-ids-fwd-glyph{font-size:2.2em;line-height:1.2;color:var(--on-surface);font-family:var(--font-content),var(--font);font-feature-settings:var(--font-features);}
.uv-ids-fwd-cp{font-family:var(--mono,ui-monospace,monospace);font-size:var(--fs-xs);color:var(--on-surface-var);}
.uv-ids-entry{display:flex;flex-direction:column;gap:var(--sp-3);padding:var(--sp-3) var(--sp-4);background:var(--surface-1);border:1px solid var(--outline-var);border-radius:var(--r-lg);}
.uv-ids-entry-top{display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap;}
.uv-ids-src{display:inline-flex;align-items:center;padding:2px 10px;border:1px solid var(--outline-var);border-radius:var(--r-full);background:var(--surface-2);font-size:var(--fs-xs);font-weight:700;color:var(--primary);}
.uv-ids-raw{font-family:var(--mono,ui-monospace,monospace);font-size:var(--fs-sm);color:var(--on-surface-var);word-break:break-all;}
.uv-ids-tools{margin-inline-start:auto;display:flex;gap:var(--sp-2);}
.uv-ids-mini{font-size:var(--fs-xs);padding:6px 14px;min-height:32px;box-sizing:border-box;border:1px solid var(--outline-var);border-radius:var(--r-full);background:var(--surface-2);color:var(--on-surface-var);cursor:pointer;}
.uv-ids-mini:hover{background:var(--surface-hi);}
/* 分解树 */
.uv-ids-tree{display:flex;align-items:flex-start;gap:var(--sp-3);flex-wrap:wrap;}
.uv-ids-node{display:inline-flex;flex-direction:column;align-items:center;gap:5px;border:1px solid color-mix(in srgb,var(--outline-var) 60%,transparent);border-radius:var(--r-sm);padding:7px;position:relative;background:color-mix(in srgb,var(--surface-2) 45%,transparent);}
.uv-ids-node.row{flex-direction:row;align-items:center;}
.uv-ids-node.col{flex-direction:column;align-items:center;}
.uv-ids-node.overlay{flex-direction:row;align-items:center;}
.uv-ids-op{position:absolute;top:-9px;inset-inline-start:3px;font-size:9px;line-height:1;color:var(--primary);font-family:var(--mono,ui-monospace,monospace);background:var(--surface-1);padding:0 3px;border-radius:2px;z-index:1;}
.uv-ids-leaf{display:inline-flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:2px;min-width:1.9em;padding:4px 6px;border:1px solid transparent;border-radius:var(--r-xs);}
.uv-ids-leaf-glyph{font-size:1.3em;line-height:1.2;color:var(--on-surface);font-family:var(--font-content),var(--font);font-feature-settings:var(--font-features);text-align:center;white-space:nowrap;}
.uv-ids-leaf-cp{font-size:9px;font-family:var(--mono,ui-monospace,monospace);color:var(--on-surface-var);text-align:center;white-space:nowrap;}
.uv-ids-leaf-more{font-size:9px;line-height:1;color:var(--primary);font-weight:700;}
.uv-ids-leaf.unencoded .uv-ids-leaf-glyph{color:var(--warning,#ff9800);font-size:0.9em;}
.uv-ids-ellipsis{color:var(--on-surface-var);font-size:var(--fs-sm);}
/* 反查 */
.uv-ids-rev-stat{font-size:var(--fs-sm);color:var(--on-surface-var);}
.uv-ids-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:var(--sp-3);}
.uv-ids-cell{display:flex;flex-direction:column;align-items:center;gap:3px;padding:9px 4px;background:var(--surface-1);border:1px solid var(--outline-var);border-radius:var(--r-sm);cursor:pointer;}
.uv-ids-cell:hover{background:var(--surface-hi);border-color:var(--primary);}
.uv-ids-cell-glyph{font-size:1.7em;line-height:1.3;color:var(--on-surface);font-family:var(--font-content),var(--font);font-feature-settings:var(--font-features);text-align:center;white-space:nowrap;}
.uv-ids-cell-cp{font-size:10px;font-family:var(--mono,ui-monospace,monospace);color:var(--on-surface-var);text-align:center;white-space:nowrap;}
.uv-ids-pager{display:flex;align-items:center;gap:var(--sp-3);flex-wrap:wrap;font-size:var(--fs-sm);color:var(--on-surface-var);}
.uv-ids-pager-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 16px;min-height:36px;box-sizing:border-box;border:1px solid var(--outline-var);border-radius:var(--r-full);background:var(--surface-2);color:var(--on-surface);cursor:pointer;font-size:var(--fs-sm);}
.uv-ids-pager-btn:disabled{opacity:.4;cursor:default;}
.uv-ids-pager-btn:not(:disabled):hover{background:var(--surface-hi);}
.uv-ids-pageinfo{font-variant-numeric:tabular-nums;}
/* 互转 */
.uv-ids-conv-pre{font-family:var(--mono,ui-monospace,monospace);font-size:var(--fs-sm);margin:0;padding:var(--sp-3) var(--sp-4);background:var(--surface-1);border:1px solid var(--outline-var);border-radius:var(--r-lg);white-space:pre-wrap;word-break:break-all;max-height:320px;overflow-y:auto;}
`;

// ============================================================
// Tab 切换
// ============================================================
function makeTabs() {
  const tabs = [
    { id: "hex", label: tt("ui.uv.tabHex"), icon: "text_fields" },
    { id: "unicode", label: tt("ui.uv.tabUnicode"), icon: "font_download" },
    { id: "invisible", label: tt("ui.uv.tabInvisible"), icon: "visibility_off" },
    { id: "renderall", label: tt("ui.uv.tabRenderAll"), icon: "menu_book" },
    { id: "ids", label: tt("ui.uv.tabIds"), icon: "account_tree" },
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
/**
 * 离开字符显示器视图时由 main.js 调用（性能审计 H3）：
 * _rerender 闭包钉着整棵旧视图 DOM（hex 满载可达 13.9 万节点），切走后置空引用才可回收。
 */
export function disposeUniversalViewer() {
  uvState._rerender = null;
  uvState._tabCache = null; // 连缓存节点一起释放（M1 缓存树也钉 DOM，切走视图统一回收）
}

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

 // 统一重渲染：tab 切换 / 分析 / 拆分口径切换全走这里。
 // 未分析时也渲染各 tab 骨架（渲染全部的转换开关、拼字的子页签常驻可见），
 // 不做「分析前的死占位」——控件该在的位置一开始就在。
 // M1（性能审计）：同步视图做内容缓存——切回 tab 直接复用已建节点，hex 满载
 // 13.9 万节点的重建（100-300ms）只在输入/口径变化时发生；活节点缓存还让
 // 控件状态（cpDesc 开关/导出选项/翻页位置）跨 tab 切换自然保留。
 // ids 除外：数据异步加载，body.isConnected 守卫要求节点挂在文档内。
  function rerender() {
    out.innerHTML = "";
    const tab = uvState.activeTab;
    const bytes = uvState.bytes || new Uint8Array(0);
    const text = uvState.text || "";
    if (tab !== "ids") {
      const cache = uvState._tabCache || (uvState._tabCache = {});
      if (cache[tab]) { out.append(cache[tab]); return; }
    }
    const holder = el("div", { class: "uv-out-holder" });
    switch (tab) {
      case "hex": holder.append(renderHexView(bytes)); break;
      case "unicode": holder.append(renderUnicodeView(text)); break;
      case "invisible": holder.append(renderInvisibleView(text)); break;
      case "renderall": holder.append(renderRenderAllView(text)); break;
      case "ids": holder.append(renderIdsView()); break;
      default: holder.append(renderHexView(bytes)); break;
    }
    if (tab !== "ids") (uvState._tabCache || (uvState._tabCache = {}))[tab] = holder;
    out.append(holder);
  }
  uvState._rerender = rerender;

  function run() {
    uvState.input = input.value;
    const q = input.value;
    uvState._tabCache = null; // 输入变化 → 全部 tab 缓存失效（M1）
    statBar.textContent = "";
    if (!q) {
      uvState.bytes = null;
      uvState.text = "";
      rerender();
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

 // UTF-8 解码文本（用于 Unicode/不可见/渲染全部视图）
    const utf8Text = td(bytes, "utf-8", false) || text;
    uvState.bytes = bytes;
    uvState.text = utf8Text;

    statBar.textContent = bytes.length + " " + tt("ui.uv.bytes")
      + " / " + [...utf8Text].length + " " + tt("ui.uv.chars")
      + " / " + graphemes(utf8Text).length + " " + tt("ui.uv.graphemes");
    rerender();
  }

  runBtn.addEventListener("click", run);

 // 输入框接编辑器工具条（粘贴/清空/字号/全选/导出 + Ctrl+A/S）。
 // onChange=run：粘贴/清空后自动重跑分析，与「分析」按钮一致。
  const inToolbar = attachEditorToolbar(input, {
    onChange: () => { uvState.input = input.value; run(); },
    exportName: "charviewer-input.txt",
  });
 // 输出框工具条已随「文本输出」区一起取消（恒烈 2026-08-26 拍板）。

  wrap.append(inToolbar, input, runBtn, statBar, tabBar, out);
  container.append(wrap);

 // 初始即渲染当前 tab 骨架：渲染全部的「转换 Unicode 描述编码」开关、拼字子页签
 // 在未点「分析」时就可见（恒烈：控件不该等渲染完才出现）。
  rerender();
}
