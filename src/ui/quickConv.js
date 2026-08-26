/*
 * quickConv.js — 「快速换算」置顶视图（MT81）。
 *
 * 与「配方链」「字符显示器」「编码图鉴」并列的一级视图，不是 op 列表里的条目。
 * 两个子面板：
 *   ① 程序员进制：多进制输入框**全同步双向联动** + 任意字宽掩码 + 位格点击翻转
 *      + 表达式求值 + 「基址 + RVA = VA」三框小工具（逆向日常最高频动作）。
 *   ② 单位换算：按分类切换，组内每个单位都是可编辑输入框，改一个其余全跟着变。
 *
 * 红线（本文件的立身之本）：
 * - **UI 层零算法实现**。进制/位运算全部走 core/progCalc.js 的 evalProgExpr 与
 *   手写解析器；单位系数与换算全部走 core/unitTables.js。本文件只负责交互，
 *   一个换算系数、一条位运算规则都不在这里写。
 * - 全程 BigInt，绝不用 JS 原生位运算（|、&、<<）——它们会把操作数截成 32 位
 *   有符号，64 位字宽必错。
 * - 绝不用 eval / new Function。
 * - 纯本地零外发。
 *
 * 交互上两个必须守住的细节（这类控件最常见的两个 bug）：
 * - **联动刷新不能碰当前有焦点的框**，否则光标每打一个字就跳到末尾。
 *   所有刷新路径都带 skipId，跳过事件源那一个框。
 * - **半成品输入不报错**：只打了 "-" / "0x" / "1." 时静默等待，不清空、不弹错。
 *
 * 样式：类名前缀 qc-，样式写在 src/ui/app.css 末尾。
 *   （不新建 quickConv.css 是因为 index.html 属版本冻结文件 MT80，本轮不得改动，
 *     无法新增 <link>；发布时若解冻可拆分。）
 */
import { icon as iconSvg } from "./icons.js";
import { evalProgExpr } from "../core/progCalc.js";
import { UNIT_CATS, getCat, convertAll, parseQty } from "../core/unitTables.js";
import { moneyToCn } from "../core/moneyAmount.js";
import { dateDiff as dcDateDiff, addDays as dcAddDays, weekday as dcWeekday } from "../core/dateCalc.js";
// MT73④：机器码&汇编 互转面板核心（WASM 引擎，懒加载，非 op）
import { asmDisasmRun } from "../core/asmDisasm.js";
import { asmAssembleRun } from "../core/asmAssemble.js";

// ---- 轻量 DOM 工具（本模块自持，与 universalViewer 同款，零耦合）----
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
  try {
    if (typeof window !== "undefined" && window.__ebctfT) {
      const s = window.__ebctfT(key, ...args);
      if (s && s !== key) return s;
    }
  } catch { /* 回退 */ }
  let s = QC_FALLBACK[key] || key;
  for (let i = 0; i < args.length; i++) s = s.replace("{" + i + "}", String(args[i]));
  return s;
}
function toast(msg) {
  try { if (typeof window !== "undefined" && window.__ebctfToast) window.__ebctfToast(msg); } catch { /* 回退 */ }
}
function isZh() {
  try {
    return (document.documentElement.getAttribute("lang") || "zh").toLowerCase().startsWith("zh");
  } catch { return true; }
}
// 单位的次要说明名：中文界面给中文名，其余语言给英文名（不让中文漏进其他语言）
function unitAlt(x) {
  return isZh() ? x.zh : x.en;
}
// 分类 chip 标签：中文界面走 i18n/兜底；非中文优先用分类自带 en（新分类 i18n 未并入时防中文泄漏）
function catLabel(c) {
  if (isZh()) return tt("ui.qc.cat." + c.id);
  return c.en || tt("ui.qc.cat." + c.id);
}
// 面板内小节标题（内联样式，不新增 app.css 类）
function blockTitle(text) {
  return el("div", {
    style: "font-size:var(--fs-sm);color:var(--on-surface-var);font-weight:600;margin:var(--sp-3) 0 var(--sp-2);letter-spacing:.02em;",
  }, text);
}
async function copyText(s) {
  try {
    await navigator.clipboard.writeText(s);
    toast(tt("ui.qc.copied"));
  } catch {
    toast(tt("ui.qc.copyFail"));
  }
}

// i18n 未接线时的中文兜底（键在 i18n 里有则以 i18n 为准）
const QC_FALLBACK = {
  "ui.qc.title": "快速换算",
  "ui.qc.desc": "程序员进制互转与单位换算工作台：改任一个框，其余实时跟着变。纯本地零外发。",
  "ui.qc.tabRadix": "程序员进制",
  "ui.qc.tabUnit": "单位换算",
  "ui.qc.tabAsm": "机器码&汇编 互转",
  "ui.qc.tabMoney": "金额",
  "ui.qc.tabDate": "日期",
  "ui.qc.tabMisc": "杂项",
  "ui.qc.asmAssemble": "汇编",
  "ui.qc.asmDisasm": "反汇编",
  "ui.qc.asmArch": "架构",
  "ui.qc.asmSyntax": "语法",
  "ui.qc.asmBase": "基地址",
  "ui.qc.asmEnc": "输入编码",
  "ui.qc.asmInPhAsm": "输入汇编源码（一行一条或分号分隔），如 push rbp; mov rbp, rsp",
  "ui.qc.asmInPhDis": "输入机器码：hex（支持 0x 前缀/空格/冒号）或 base64，如 55 48 89 e5",
  "ui.qc.asmRunning": "运行中…",
  "ui.qc.asmHint": "本地 WASM 引擎懒加载，零外发。汇编结果可用反汇编验证往返。",
  "ui.qc.width": "字宽",
  "ui.qc.custom": "自定义",
  "ui.qc.widthDec": "字宽减 1 位",
  "ui.qc.widthInc": "字宽加 1 位",
  "ui.qc.bitsUnit": "位",
  "ui.qc.signed": "有符号",
  "ui.qc.unsigned": "无符号",
  "ui.qc.clear": "清零",
  "ui.qc.hex": "十六进制",
  "ui.qc.dec": "十进制（有符号）",
  "ui.qc.udec": "十进制（无符号）",
  "ui.qc.oct": "八进制",
  "ui.qc.bin": "二进制",
  "ui.qc.bytesBE": "字节（大端）",
  "ui.qc.bytesLE": "字节（小端）",
  "ui.qc.bitmap": "位视图（点格子翻转该位）",
  "ui.qc.bitmapWide": "字宽超过 64 位，位视图已隐藏（格子太多反而看不清）。",
  "ui.qc.expr": "表达式",
  "ui.qc.exprPlaceholder": "如 0x401000 + 0x1234、1 << 31、rotl(0x80000000, 1)、~0 & 0xFF",
  "ui.qc.eval": "求值",
  "ui.qc.exprHelp": "支持 + - * / % ** 与 & | ^ ~ << >> >>>、括号、rotl/rotr；字面量可用 0x / 0b / 0o 前缀。手写解析器，无 eval。",
  "ui.qc.rvaTitle": "基址 + 偏移(RVA) = 绝对地址(VA)",
  "ui.qc.rvaBase": "模块基址",
  "ui.qc.rvaOff": "偏移 RVA",
  "ui.qc.rvaVa": "绝对地址 VA",
  "ui.qc.rvaHint": "三个框填任意两个，第三个自动算出（十六进制，跟随上面的字宽）。",
  "ui.qc.rvaBad": "十六进制格式不对：{0}",
  "ui.qc.wrapped": "⚠ 输入超出 {0} 位，已按掩码回绕为 0x{1}（高位被截掉，不是四舍五入）。",
  "ui.qc.badInput": "「{0}」不是合法的{1}数字，已忽略这次输入（其余框保持不变）。",
  "ui.qc.copied": "已复制",
  "ui.qc.copyFail": "复制失败（浏览器拒绝了剪贴板权限）",
  "ui.qc.copyHint": "点击标签复制该行",
  "ui.qc.category": "分类",
  "ui.qc.source": "系数溯源",
  "ui.qc.unitBad": "输入不是合法数值，已忽略（支持整数/小数/千分位逗号）。",
  "ui.qc.approx": "近似值（非精确定义），见溯源说明",
  "ui.qc.currency": "货币",
  "ui.qc.currencyTitle": "选择货币",
  "ui.qc.currencyNote": "本组是同一种货币内部的**面额**换算（元/角/分这类），比例由法律与铸币制度定死，是精确常数，不联网也不会过期。跨币种（人民币↔美元）需要实时汇率，属外部数据，与本工具箱「纯前端零外发」的铁律冲突，因此不做。",
  // 分类名兜底（i18n 未接线时不至于露出裸键名）
  "ui.qc.cat.dataSize": "数据量",
  "ui.qc.cat.dataRate": "数据速率",
  "ui.qc.cat.time": "时间",
  "ui.qc.cat.freq": "频率",
  "ui.qc.cat.length": "长度",
  "ui.qc.cat.area": "面积",
  "ui.qc.cat.volume": "体积",
  "ui.qc.cat.mass": "质量",
  "ui.qc.cat.temp": "温度",
  "ui.qc.cat.speed": "速度",
  "ui.qc.cat.pressure": "压强",
  "ui.qc.cat.force": "力",
  "ui.qc.cat.energy": "能量",
  "ui.qc.cat.power": "功率",
  "ui.qc.cat.density": "密度",
  "ui.qc.cat.resistance": "电阻",
  "ui.qc.cat.angle": "角度",
  "ui.qc.cat.epoch": "时间戳纪元",
  "ui.qc.cat.cur_cny": "人民币",
  "ui.qc.cat.cur_usd": "美元",
  "ui.qc.cat.cur_eur": "欧元",
  "ui.qc.cat.cur_gbp": "英镑",
  "ui.qc.cat.cur_jpy": "日元",
  "ui.qc.cat.cur_hkd": "港币",
  "ui.qc.cat.fuel": "油耗",
  "ui.qc.moneyPlaceholder": "如 1234.56、0.05、100000000.01",
  "ui.qc.moneyAmount": "金额数字",
  "ui.qc.moneyUpper": "人民币大写",
  "ui.qc.moneyHint": "整数：元/拾/佰/仟/万/亿；小数：角/分，分以下四舍五入。支持负数、千分位逗号、空格。0 → 零元整。",
  "ui.qc.dateDiff": "两日期差值",
  "ui.qc.dateFrom": "起始日期",
  "ui.qc.dateTo": "结束日期",
  "ui.qc.dateResult": "相差",
  "ui.qc.dateDays": "天",
  "ui.qc.dateWeeks": "周",
  "ui.qc.dateMonths": "个月",
  "ui.qc.dateYears": "年",
  "ui.qc.dateShift": "日期加减天数",
  "ui.qc.dateShiftBase": "基准日期",
  "ui.qc.dateShiftN": "天数（负为往前）",
  "ui.qc.dateShiftOut": "结果",
  "ui.qc.dateWeekday": "星期几",
  "ui.qc.dateBad": "日期格式应为 YYYY-MM-DD",
  "ui.qc.fuelNote": "逆比例：mpg 越大越省油，L/100km 越小越省油。K(US)=235.215、K(UK)=282.481 由加仑与英里精确导出。",
};

// ============ 视图状态（模块级，切 tab / 切视图后保留）============
const S = {
  tab: "radix",
  width: 32,
  customWidth: 32,
  signed: false, // 逆向场景（地址）默认无符号
  value: 0n, // 按 width 掩码后的位模式
  expr: "",
  rva: { base: "", off: "", va: "" },
  rvaTouched: ["base", "off", "va"], // 最近编辑在前，最久未动的那个是被算出来的
  unitCat: "length",
  unitFrom: "m",
  unitQty: "1",
  lastCur: "cur_cny", // 上次选的币种（货币是二级菜单，记住选择省一次点）
  // 面板 ④ 金额（T367）：大写金额
  money: "",
  // 面板 ⑤ 日期（T367）
  date: { from: "", to: "", base: "", n: "7", wd: "" },
  // 面板 ③ 机器码&汇编 互转（MT73④）
  asm: { dir: "disasm", arch: "x86", syntax: "intel", base: 0, enc: "hex", input: "", lastOut: "", lastErr: false },
};

const MOD = () => 1n << BigInt(S.width);
const MASK = () => MOD() - 1n;
function toSigned(v) {
  const m = MOD();
  return v >= m / 2n ? v - m : v;
}
function wrap(v) {
  const m = MOD();
  return ((v % m) + m) % m;
}

// ============ 进制行定义 ============
const RADIX_ROWS = [
  { id: "hex", radix: 16, key: "ui.qc.hex", prefix: "0x", chars: /^[0-9a-fA-F]+$/ },
  { id: "dec", radix: 10, key: "ui.qc.dec", signed: true, chars: /^[0-9]+$/ },
  { id: "udec", radix: 10, key: "ui.qc.udec", chars: /^[0-9]+$/ },
  { id: "oct", radix: 8, key: "ui.qc.oct", prefix: "0o", chars: /^[0-7]+$/ },
  { id: "bin", radix: 2, key: "ui.qc.bin", prefix: "0b", chars: /^[01]+$/, group: 4 },
];

// 位模式 → 某一行应显示的字符串
function fmtRow(row) {
  if (row.signed) return toSigned(S.value).toString(10);
  let s = S.value.toString(row.radix);
  if (row.radix === 16) s = s.toUpperCase();
  if (row.radix === 2) {
    s = s.padStart(S.width, "0");
    if (row.group) s = s.replace(new RegExp(`(.{${row.group}})(?=.)`, "g"), "$1 ");
  }
  return s;
}

/**
 * 解析某一行输入 → BigInt（可能为负、可能超范围，由调用方回绕）。
 * 返回 { ok:true, v } / { ok:false, empty:true }（半成品，静默）/ { ok:false, bad:"原文" }。
 */
function parseRow(row, raw) {
  let s = String(raw ?? "").replace(/[\s_,]+/g, "");
  if (!s) return { ok: false, empty: true };
  let neg = false;
  if (s[0] === "-") { neg = true; s = s.slice(1); }
  else if (s[0] === "+") s = s.slice(1);
  if (!s) return { ok: false, empty: true }; // 只打了个符号，等着
  const pfx = { 16: /^0[xX]/, 8: /^0[oO]/, 2: /^0[bB]/ }[row.radix];
  if (pfx && pfx.test(s)) s = s.slice(2);
  if (!s) return { ok: false, empty: true }; // 只打了 "0x"，等着
  if (!row.chars.test(s)) return { ok: false, bad: String(raw) };
  let v;
  try {
    v = BigInt(({ 16: "0x", 8: "0o", 2: "0b" }[row.radix] || "") + s);
  } catch {
    return { ok: false, bad: String(raw) };
  }
  return { ok: true, v: neg ? -v : v };
}

// ============ 渲染 ============
let $panel = null; // 当前子面板容器
const R = {}; // 进制面板的活动节点引用

export function renderQuickConv(root) {
  root.innerHTML = "";
  const view = el("div", { class: "qc-view" });

  view.append(
    el("div", { class: "qc-head" },
      el("h2", { class: "qc-title" }, msym("calculate"), el("span", {}, tt("ui.qc.title"))),
      el("div", { class: "qc-desc" }, tt("ui.qc.desc")),
    ),
  );

  const tabs = el("div", { class: "qc-tabs" });
  for (const [id, ico, key] of [["radix", "tag", "ui.qc.tabRadix"], ["unit", "swap_horiz", "ui.qc.tabUnit"], ["asm", "data_object", "ui.qc.tabAsm"], ["money", "currency_exchange", "ui.qc.tabMoney"], ["date", "schedule", "ui.qc.tabDate"]]) {
    tabs.append(el("button", {
      class: "qc-tab" + (S.tab === id ? " active" : ""),
      type: "button",
      onclick: () => { S.tab = id; renderQuickConv(root); },
    }, msym(ico), el("span", {}, tt(key))));
  }
  view.append(tabs);

  $panel = el("div", { class: "qc-panel" });
  view.append($panel);
  root.append(view);

  if (S.tab === "radix") renderRadixPanel();
  else if (S.tab === "asm") renderAsmPanel();
  else if (S.tab === "money") renderMoneyPanel();
  else if (S.tab === "date") renderDatePanel();
  else renderUnitPanel();
}

// ---------- 面板 ①：程序员进制 ----------
function renderRadixPanel() {
  $panel.innerHTML = "";
  for (const k of Object.keys(R)) delete R[k];

  // -- 工具条：字宽 + 符号 + 清零 --
  const bar = el("div", { class: "qc-bar qc-toolbar" });
  bar.append(el("span", { class: "qc-bar-label" }, tt("ui.qc.width")));
  R.widthChips = [];
  for (const w of [8, 16, 32, 64]) {
    // 字宽按钮做成正圆（恒烈指定；VIS 规范「按钮变体」里 icon 型按钮即圆形）。
    const chip = el("button", {
      class: "qc-chip qc-chip-round" + (S.width === w ? " active" : ""),
      type: "button", title: `${w} ${tt("ui.qc.bitsUnit")}`,
      onclick: () => setWidth(w),
    }, String(w));
    R.widthChips.push([w, chip]);
    bar.append(chip);
  }

  // 自定义字宽用项目规范的 M3 stepper（[−][框][＋]，加减键为圆形），
  // 与 main.js renderParam / recipeView.js 同形；不用原生 number spinner——
  // 原生箭头各平台样式不一、触控目标过小，规范里已明令用 stepper 替代。
  const customInp = el("input", {
    class: "stepper-inp qc-custom-input mono", type: "text", inputmode: "numeric",
    spellcheck: "false", autocomplete: "off", "aria-label": tt("ui.qc.custom"),
    value: String(S.customWidth),
  });
  R.customInp = customInp;
  const clampW = (n) => Math.min(512, Math.max(1, n));
  const applyCustom = (n, echo) => {
    S.customWidth = n;
    if (echo) customInp.value = String(n); // 打字途中不回写，否则光标被顶到末尾
    setWidth(n, { keepCustom: true, inPlace: true });
  };
  customInp.addEventListener("input", () => {
    const n = parseInt(customInp.value, 10);
    if (!Number.isInteger(n) || n < 1 || n > 512) return; // 半成品/越界：静默等，别打断输入
    applyCustom(n, false);
  });
  customInp.addEventListener("blur", () => {
    const n = parseInt(customInp.value, 10);
    if (!Number.isInteger(n)) { customInp.value = String(S.width); return; }
    applyCustom(clampW(n), true); // 失焦时才把越界值钳回 1–512 并回写
  });
  const stepBtn = (icon, dir, key) => {
    const b = el("button", {
      class: "stepper-btn", type: "button", tabindex: "-1",
      "aria-label": tt(key), title: tt(key),
    }, msym(icon));
    b.addEventListener("click", () => {
      const cur = parseInt(customInp.value, 10);
      applyCustom(clampW((Number.isInteger(cur) ? cur : S.width) + dir), true);
    });
    return b;
  };
  const customBox = el("span", { class: "qc-custom" },
    el("span", {}, tt("ui.qc.custom")),
    el("span", { class: "stepper" },
      stepBtn("remove", -1, "ui.qc.widthDec"), customInp, stepBtn("add", 1, "ui.qc.widthInc")),
    el("span", {}, tt("ui.qc.bitsUnit")),
  );
  bar.append(customBox);
  bar.append(el("span", { class: "qc-bar-sep" }));
  for (const [sg, key] of [[false, "ui.qc.unsigned"], [true, "ui.qc.signed"]]) {
    bar.append(el("button", {
      class: "qc-chip" + (S.signed === sg ? " active" : ""),
      type: "button",
      onclick: () => { S.signed = sg; refreshAll(); },
    }, tt(key)));
  }
  bar.append(el("button", {
    class: "qc-chip qc-chip-ghost", type: "button",
    onclick: () => { S.value = 0n; R.notice.textContent = ""; refreshAll(); },
  }, msym("refresh"), el("span", {}, tt("ui.qc.clear"))));
  $panel.append(bar);

  // -- 进制输入行 --
  const grid = el("div", { class: "qc-grid" });
  R.rows = {};
  for (const row of RADIX_ROWS) {
    const inp = el("input", {
      class: "qc-input mono", type: "text", spellcheck: "false",
      autocomplete: "off", autocapitalize: "off", "data-row": row.id,
      value: fmtRow(row),
      oninput: (e) => onRadixInput(row, e.target.value),
    });
    R.rows[row.id] = inp;
    const lab = el("button", {
      class: "qc-rowlabel", type: "button", title: tt("ui.qc.copyHint"),
      onclick: () => copyText(inp.value),
    }, el("span", {}, tt(row.key)), row.prefix ? el("code", { class: "qc-pfx" }, row.prefix) : null);
    grid.append(el("div", { class: "qc-row" }, lab, inp));
  }
  // 只读字节序两行（逆向对着内存看时最常用）
  for (const [id, key] of [["be", "ui.qc.bytesBE"], ["le", "ui.qc.bytesLE"]]) {
    const out = el("div", { class: "qc-bytes mono", "data-bytes": id });
    R[id] = out;
    const lab = el("button", {
      class: "qc-rowlabel", type: "button", title: tt("ui.qc.copyHint"),
      onclick: () => copyText(out.textContent),
    }, el("span", {}, tt(key)));
    grid.append(el("div", { class: "qc-row" }, lab, out));
  }
  $panel.append(grid);

  R.notice = el("div", { class: "qc-notice" });
  $panel.append(R.notice);

  // -- 位视图 --
  R.bitsWrap = el("div", { class: "qc-bits-wrap" });
  $panel.append(R.bitsWrap);

  // -- 表达式 --
  const exprBox = el("div", { class: "qc-expr" });
  R.expr = el("input", {
    class: "qc-input mono qc-expr-input", type: "text", spellcheck: "false",
    autocomplete: "off", value: S.expr, placeholder: tt("ui.qc.exprPlaceholder"),
    oninput: (e) => { S.expr = e.target.value; },
    onkeydown: (e) => { if (e.key === "Enter") { e.preventDefault(); runExpr(); } },
  });
  exprBox.append(
    el("span", { class: "qc-bar-label" }, tt("ui.qc.expr")),
    R.expr,
    el("button", { class: "qc-btn", type: "button", onclick: runExpr }, msym("calculate"), el("span", {}, tt("ui.qc.eval"))),
  );
  $panel.append(exprBox);
  $panel.append(el("div", { class: "qc-hint" }, tt("ui.qc.exprHelp")));
  R.exprErr = el("div", { class: "qc-notice qc-err" });
  $panel.append(R.exprErr);

  // -- 基址 + RVA = VA --
  $panel.append(renderRvaTool());

  refreshAll();
}

function setWidth(w, opts = {}) {
  S.width = w;
  if (!opts.keepCustom) S.customWidth = w;
  S.value &= MASK(); // 缩窄字宽 → 高位截掉
  if (!opts.inPlace) { renderRadixPanel(); return; }
  // 自定义框是边打字边改字宽的：整面板重建会把输入框连同焦点和光标一起换掉，
  // 打完第一位就再也打不进第二位。这条路径只更新受字宽影响的部分。
  for (const [cw, node] of R.widthChips || []) node.classList.toggle("active", cw === w);
  refreshAll();
}

function onRadixInput(row, raw) {
  const r = parseRow(row, raw);
  if (r.empty) { R.notice.textContent = ""; return; } // 半成品，静默等待
  if (!r.bad && r.ok) {
    const w = wrap(r.v);
    R.notice.textContent = w !== r.v
      ? tt("ui.qc.wrapped", S.width, w.toString(16).toUpperCase())
      : "";
    R.notice.classList.toggle("qc-warn", w !== r.v);
    S.value = w;
    refreshAll(row.id);
    return;
  }
  R.notice.textContent = tt("ui.qc.badInput", r.bad, tt(row.key));
  R.notice.classList.add("qc-warn");
}

// 刷新除 skipId 外的全部展示（skipId 是当前有焦点的框，改它会跳光标）
function refreshAll(skipId) {
  if (!R.rows) return;
  for (const row of RADIX_ROWS) {
    if (row.id === skipId) continue;
    R.rows[row.id].value = fmtRow(row);
  }
  const nBytes = Math.ceil(S.width / 8);
  const hex = S.value.toString(16).toUpperCase().padStart(nBytes * 2, "0");
  const bytes = hex.match(/.{2}/g) || ["00"];
  R.be.textContent = bytes.join(" ");
  R.le.textContent = bytes.slice().reverse().join(" ");
  renderBits();
  // 有符号/无符号切换只影响 dec 行的解读，上面已统一重算
}

function renderBits() {
  R.bitsWrap.innerHTML = "";
  if (S.width > 64) {
    R.bitsWrap.append(el("div", { class: "qc-hint" }, tt("ui.qc.bitmapWide")));
    return;
  }
  R.bitsWrap.append(el("div", { class: "qc-bar-label" }, tt("ui.qc.bitmap")));
  // 位号和格子必须是**同一个盒子**里上下堆叠的：早先格子行与标尺行是两个独立 flex 容器，
  // 靠「宽度都写 1.7em」硬凑对齐 —— 但格子是 button（多 2px 边框）、标尺是 span，
  // 每格差一点，几格之后位号就跑到隔壁格子底下去了，换行时更是各断各的。
  // 现在一位 = 一个 qc-bitcell（格子在上、位号在下），八位一组，换行以「组」为单位。
  const grid = el("div", { class: "qc-bits" });
  let group = null;
  for (let i = S.width - 1; i >= 0; i--) {
    if (group === null || i % 8 === 7) {
      group = el("div", { class: "qc-bit-group" });
      grid.append(group);
    }
    const on = ((S.value >> BigInt(i)) & 1n) === 1n;
    const btn = el("button", {
      class: "qc-bit" + (on ? " on" : ""),
      type: "button", title: `bit ${i}`,
      onclick: () => {
        S.value ^= 1n << BigInt(i);
        R.notice.textContent = "";
        refreshAll();
      },
    }, on ? "1" : "0");
    const tick = el("span", { class: "qc-bit-tick" + (i % 8 === 0 ? " major" : "") }, String(i));
    group.append(el("div", { class: "qc-bitcell" }, btn, tick));
  }
  R.bitsWrap.append(grid);
}

function runExpr() {
  const src = S.expr.trim();
  R.exprErr.textContent = "";
  if (!src) return;
  try {
    // 算法层：手写递归下降解析器，无 eval（core/progCalc.js）
    const { value } = evalProgExpr(src, { width: S.width, signed: S.signed });
    S.value = value;
    R.notice.textContent = "";
    refreshAll();
  } catch (e) {
    R.exprErr.textContent = String(e && e.message ? e.message : e);
  }
}

// ---- 基址 + 偏移(RVA) = 绝对地址(VA) ----
// 恒烈给的验收场景：逆向时汇编里的相对地址换成绝对地址。任填两个算第三个。
function renderRvaTool() {
  const box = el("div", { class: "qc-rva" });
  box.append(el("div", { class: "qc-rva-title" }, msym("swap_horiz"), el("span", {}, tt("ui.qc.rvaTitle"))));
  const line = el("div", { class: "qc-rva-line" });
  R.rvaInputs = {};
  R.rvaDec = {};
  const fields = [["base", "ui.qc.rvaBase"], ["off", "ui.qc.rvaOff"], ["va", "ui.qc.rvaVa"]];
  fields.forEach(([id, key], idx) => {
    const inp = el("input", {
      class: "qc-input mono qc-rva-input", type: "text", spellcheck: "false",
      autocomplete: "off", value: S.rva[id], placeholder: "0x…",
      oninput: (e) => {
        S.rva[id] = e.target.value;
        S.rvaTouched = [id, ...S.rvaTouched.filter((x) => x !== id)];
        recalcRva(id);
      },
    });
    R.rvaInputs[id] = inp;
    const dec = el("div", { class: "qc-rva-dec mono" });
    R.rvaDec[id] = dec;
    line.append(el("div", { class: "qc-rva-field" },
      el("label", { class: "qc-rva-label" }, tt(key)), inp, dec));
    if (idx < 2) line.append(el("div", { class: "qc-rva-op" }, idx === 0 ? "+" : "="));
  });
  box.append(line);
  R.rvaErr = el("div", { class: "qc-notice qc-err" });
  box.append(R.rvaErr);
  box.append(el("div", { class: "qc-hint" }, tt("ui.qc.rvaHint")));
  return box;
}

// 十六进制串 → BigInt；空/半成品 → null；非法 → 抛
function parseHexField(raw) {
  let s = String(raw ?? "").replace(/[\s_,]+/g, "");
  if (!s) return null;
  let neg = false;
  if (s[0] === "-") { neg = true; s = s.slice(1); }
  if (/^0[xX]$/.test(s)) return null; // 只打了 0x
  s = s.replace(/^0[xX]/, "");
  if (!s) return null;
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error(raw);
  const v = BigInt("0x" + s);
  return neg ? -v : v;
}

function recalcRva(editedId) {
  R.rvaErr.textContent = "";
  const vals = {};
  for (const id of ["base", "off", "va"]) {
    try {
      vals[id] = parseHexField(S.rva[id]);
    } catch (e) {
      R.rvaErr.textContent = tt("ui.qc.rvaBad", String(e.message));
      return;
    }
  }
  // 目标 = 最久未被编辑的那个（「任填两个算第三个」的自然实现）
  let target = S.rvaTouched[S.rvaTouched.length - 1];
  if (target === editedId) target = S.rvaTouched.find((x) => x !== editedId);
  const others = ["base", "off", "va"].filter((x) => x !== target);
  if (vals[others[0]] === null || vals[others[1]] === null) {
    updateRvaDec();
    return; // 另外两个还没填全，等着
  }
  let out;
  if (target === "va") out = vals.base + vals.off;
  else if (target === "off") out = vals.va - vals.base;
  else out = vals.va - vals.off;
  out = wrap(out);
  S.rva[target] = out.toString(16).toUpperCase();
  R.rvaInputs[target].value = S.rva[target];
  updateRvaDec();
}

function updateRvaDec() {
  for (const id of ["base", "off", "va"]) {
    let v = null;
    try { v = parseHexField(S.rva[id]); } catch { v = null; }
    R.rvaDec[id].textContent = v === null ? "" : `= ${v} (dec)`;
  }
}

// ---------- 面板 ②：单位换算 ----------
// 分类 chip 分两级：一级是常规分类 + 一个「货币」入口；点货币后再出二级 chip 选币种。
// 这么分是因为货币**组间不能互转**（跨币种要汇率），每种货币必须各自成组，
// 但六个币种全塞进一级栏会把 chip 栏撑爆。
const MAIN_CATS = UNIT_CATS.filter((c) => c.group !== "currency");
const CUR_CATS = UNIT_CATS.filter((c) => c.group === "currency");
const isCurCat = (id) => CUR_CATS.some((c) => c.id === id);

// 历史：曾有一段时期 renderFuelPanel（油耗快捷入口）写死 S.unitCat="fuel" 污染分类记忆，
// 恒烈报「全部被归类到油耗」后根治；2026-08-26 恒烈拍板删掉冗余的「杂项」tab
// （与单位换算面板完全重复），时间/频率/角度/油耗等分类一律从单位换算 tab 进。
function unitCatNow() { return S.unitCat; }
function setUnitCat(id) { S.unitCat = id; }

function pickCat(id) {
  const c = getCat(id);
  if (!c) return;
  setUnitCat(id);
  S.unitFrom = c.base;
  S.unitQty = "1";
  if (isCurCat(id)) S.lastCur = id;
  renderUnitPanel();
}

function renderUnitPanel() {
  $panel.innerHTML = "";
  const uc = unitCatNow(); // 当前作用域（单位换算 tab 或 油耗 tab）的分类

  const chips = el("div", { class: "qc-bar qc-catbar" });
  chips.append(el("span", { class: "qc-bar-label" }, tt("ui.qc.category")));
  for (const c of MAIN_CATS) {
    chips.append(el("button", {
      class: "qc-chip" + (uc === c.id ? " active" : ""),
      type: "button",
      onclick: () => pickCat(c.id),
    }, msym(c.icon), el("span", {}, catLabel(c))));
  }
  // 货币入口（面额换算，非汇率）
  chips.append(el("button", {
    class: "qc-chip" + (isCurCat(uc) ? " active" : ""),
    type: "button",
    onclick: () => pickCat(isCurCat(uc) ? uc : (S.lastCur || CUR_CATS[0].id)),
  }, msym("currency_exchange"), el("span", {}, tt("ui.qc.currency"))));
  $panel.append(chips);

  // 二级：币种
  if (isCurCat(uc)) {
    const sub = el("div", { class: "qc-bar qc-subbar" });
    sub.append(el("span", { class: "qc-bar-label" }, tt("ui.qc.currencyTitle")));
    for (const c of CUR_CATS) {
      sub.append(el("button", {
        class: "qc-chip" + (uc === c.id ? " active" : ""),
        type: "button",
        onclick: () => pickCat(c.id),
      }, tt("ui.qc.cat." + c.id)));
    }
    $panel.append(sub);
  }

  const cat = getCat(uc);
  if (!cat) return;

  const grid = el("div", { class: "qc-grid qc-unit-grid" });
  R.unitInputs = {};
  for (const x of cat.units) {
    const inp = el("input", {
      class: "qc-input mono", type: "text", spellcheck: "false", autocomplete: "off",
      "data-unit": x.u,
      oninput: (e) => onUnitInput(cat, x.u, e.target.value),
    });
    R.unitInputs[x.u] = inp;
    const lab = el("button", {
      class: "qc-rowlabel qc-unit-label", type: "button", title: tt("ui.qc.copyHint"),
      onclick: () => copyText(`${inp.value} ${x.u}`),
    },
      el("span", { class: "qc-unit-sym" }, x.u),
      el("span", { class: "qc-unit-alt" }, unitAlt(x)),
      x.approx ? el("span", { class: "qc-approx", title: tt("ui.qc.approx") }, "≈") : null,
    );
    grid.append(el("div", { class: "qc-row" }, lab, inp));
  }
  $panel.append(grid);

  R.unitNotice = el("div", { class: "qc-notice" });
  $panel.append(R.unitNotice);
  $panel.append(el("div", { class: "qc-hint" },
    el("strong", {}, tt("ui.qc.source") + "：" ), cat.note));
  // 货币组额外提醒：这是面额换算，跨币种要汇率所以不做
  if (isCurCat(uc)) {
    $panel.append(el("div", { class: "qc-hint qc-cur-note" }, tt("ui.qc.currencyNote")));
  }

  // 防御：unitFrom/unitQty 是跨 tab 共享的输入记忆，可能不属于当前分类（刚切 tab 时）——
  // 不在当前组就回退到该组 base + 1，避免 convertAll 抛错刷错误条。
  const fromOk = cat.units.some((x) => x.u === S.unitFrom) ? S.unitFrom : cat.base;
  fillUnits(cat, fromOk, fromOk === S.unitFrom ? S.unitQty : "1");
}

function onUnitInput(cat, unit, raw) {
  const q = parseQty(raw);
  if (q === null) {
    R.unitNotice.textContent = String(raw).trim() ? tt("ui.qc.unitBad") : "";
    return;
  }
  R.unitNotice.textContent = "";
  S.unitFrom = unit;
  S.unitQty = raw;
  fillUnits(cat, unit, raw, unit);
}

function fillUnits(cat, fromUnit, rawQty, skipUnit) {
  const q = parseQty(rawQty);
  if (q === null) return;
  let rows;
  try {
    // 算法层：core/unitTables.js（系数全部可溯源，全程 BigInt 有理数）
    rows = convertAll(cat.id, q, fromUnit);
  } catch (e) {
    R.unitNotice.textContent = String(e && e.message ? e.message : e);
    return;
  }
  for (const r of rows) {
    if (r.u === skipUnit) continue;
    const inp = R.unitInputs[r.u];
    if (inp) inp.value = r.text;
  }
  if (skipUnit === undefined && R.unitInputs[fromUnit]) {
    R.unitInputs[fromUnit].value = String(rawQty);
  }
}

// ============ 面板 ④：金额 → 人民币大写（T367）============
// 算法层：core/moneyAmount.js 的 moneyToCn（纯函数，零算法在本面板）。
function renderMoneyPanel() {
  $panel.innerHTML = "";
  const row = el("div", { class: "qc-row" },
    el("label", { class: "qc-rowlabel" }, el("span", {}, tt("ui.qc.moneyAmount"))),
    el("input", {
      class: "qc-input mono", type: "text", spellcheck: "false", autocomplete: "off",
      placeholder: tt("ui.qc.moneyPlaceholder"), value: S.money,
      oninput: (e) => { S.money = e.target.value; refreshMoney(); },
    }),
  );
  $panel.append(row);
  const out = el("div", {
    class: "mono",
    style: "font-size:var(--fs-lg);font-weight:600;color:var(--on-surface);word-break:break-all;padding:var(--sp-1) var(--sp-2);background:var(--surface-hi);border-radius:6px;",
  });
  $panel.append(el("div", { class: "qc-row" },
    el("label", { class: "qc-rowlabel" }, el("span", {}, tt("ui.qc.moneyUpper"))),
    out,
  ));
  $panel.append(el("div", { class: "qc-hint" }, tt("ui.qc.moneyHint")));
  function refreshMoney() {
    const s = moneyToCn(S.money);
    out.textContent = s === null ? "" : s; // 半成品静默
  }
  refreshMoney();
}

// ============ 面板 ⑤：日期计算（T367）============
// 算法层：core/dateCalc.js（dateDiff/addDays/weekday），绝无 Date.now。
function renderDatePanel() {
  $panel.innerHTML = "";

  // -- 差值 --
  const mkDateInp = (valKey, onInput) => el("input", {
    class: "qc-input mono", type: "date", value: S.date[valKey],
    oninput: (e) => { S.date[valKey] = e.target.value; onInput(); },
  });
  const diffFrom = mkDateInp("from", refreshDiff);
  const diffTo = mkDateInp("to", refreshDiff);
  const diffOut = el("div", { class: "mono", style: "font-size:var(--fs-base);color:var(--on-surface);word-break:break-all;" });
  $panel.append(blockTitle(tt("ui.qc.dateDiff")));
  $panel.append(el("div", { class: "qc-row" },
    el("label", { class: "qc-rowlabel" }, el("span", {}, tt("ui.qc.dateFrom"))), diffFrom));
  $panel.append(el("div", { class: "qc-row" },
    el("label", { class: "qc-rowlabel" }, el("span", {}, tt("ui.qc.dateTo"))), diffTo));
  $panel.append(el("div", { class: "qc-row" },
    el("label", { class: "qc-rowlabel" }, el("span", {}, tt("ui.qc.dateResult"))), diffOut));
  function refreshDiff() {
    const d = dcDateDiff(S.date.from, S.date.to);
    if (d === null) { diffOut.textContent = ""; return; }
    const week = Math.round(d.weeks * 10) / 10;
    diffOut.textContent = `${d.days} ${tt("ui.qc.dateDays")} / ${week} ${tt("ui.qc.dateWeeks")} / ${d.months} ${tt("ui.qc.dateMonths")} / ${d.years} ${tt("ui.qc.dateYears")}`;
  }

  // -- 加减 --
  const baseInp = mkDateInp("base", refreshShift);
  const nInp = el("input", {
    class: "qc-input mono", type: "text", inputmode: "numeric", value: S.date.n,
    spellcheck: "false", autocomplete: "off",
    oninput: (e) => { S.date.n = e.target.value; refreshShift(); },
  });
  const shiftOut = el("div", { class: "mono", style: "font-size:var(--fs-base);color:var(--on-surface);word-break:break-all;" });
  $panel.append(blockTitle(tt("ui.qc.dateShift")));
  $panel.append(el("div", { class: "qc-row" },
    el("label", { class: "qc-rowlabel" }, el("span", {}, tt("ui.qc.dateShiftBase"))), baseInp));
  $panel.append(el("div", { class: "qc-row" },
    el("label", { class: "qc-rowlabel" }, el("span", {}, tt("ui.qc.dateShiftN"))), nInp));
  $panel.append(el("div", { class: "qc-row" },
    el("label", { class: "qc-rowlabel" }, el("span", {}, tt("ui.qc.dateShiftOut"))), shiftOut));
  function refreshShift() {
    const n = parseInt(S.date.n, 10);
    if (!Number.isFinite(n)) { shiftOut.textContent = ""; return; }
    const r = dcAddDays(S.date.base, n);
    if (r === null) { shiftOut.textContent = ""; return; }
    shiftOut.textContent = r;
  }

    // -- 星期 --
  const wdInp = mkDateInp("wd", refreshWd);
  const wdOut = el("div", { class: "mono", style: "font-size:var(--fs-base);color:var(--on-surface);word-break:break-all;" });
  $panel.append(blockTitle(tt("ui.qc.dateWeekday")));
  $panel.append(el("div", { class: "qc-row" },
    el("label", { class: "qc-rowlabel" }, el("span", {}, tt("ui.qc.dateShiftBase"))), wdInp));
  $panel.append(el("div", { class: "qc-row" },
    el("label", { class: "qc-rowlabel" }, el("span", {}, tt("ui.qc.dateResult"))), wdOut));
  function refreshWd() {
    const w = dcWeekday(S.date.wd);
    wdOut.textContent = w === null ? "" : (isZh() ? `星期${w.zh}` : w.en);
  }

  refreshDiff();
  refreshShift();
  refreshWd();
}

// ============ 面板 ⑥：杂项（原「油耗」tab）——2026-08-26 恒烈拍板删除 ============
// 「杂项」tab 曾复用整个单位换算面板（内容 100% 重复，仅默认落点不同），判定冗余后移除。
// 时间 / 频率 / 角度 / 时间戳纪元 / 油耗等分类仍全部保留在单位换算 tab 的分类条里。

// ============ 面板 ③：机器码&汇编 互转（MT73④） ============
// 面板 ③：WASM 引擎懒加载，零外发；引擎与许可信息仅存工程文档 PROGRESS.md。
// 红线：本面板只做交互，WASM 调用全在 core/asmDisasm.js 与 core/asmAssemble.js。
const ASM_ARCH_BOTH = ["x86", "x86-64", "arm", "arm-thumb", "arm64", "mips", "mips64", "ppc", "ppc64", "sparc", "systemz", "evm"];
const ASM_ARCH_DISASM_ONLY = ["riscv", "m68k", "tms320c64x", "xcore"];
const ASM_ARCH_ASSEMBLE_ONLY = ["hexagon"];
const ASM_ARCH_LABEL = {
  "x86": "x86 (32-bit)", "x86-64": "x86-64 (64-bit)", "arm": "ARM", "arm-thumb": "ARM Thumb",
  "arm64": "ARM64 (AArch64)", "mips": "MIPS (32)", "mips64": "MIPS (64)", "riscv": "RISC-V (64)",
  "ppc": "PowerPC (32)", "ppc64": "PowerPC (64)", "sparc": "SPARC", "systemz": "SystemZ",
  "m68k": "M68K", "tms320c64x": "TMS320C64x", "xcore": "XCore", "evm": "EVM", "hexagon": "Hexagon",
};
let _asmTimer = null;

function renderAsmPanel() {
  $panel.innerHTML = "";
  const A = S.asm;

  // -- 工具条：方向 + 架构 + 语法 + 基地址 --
  const bar = el("div", { class: "qc-bar qc-toolbar" });

  // 方向 seg（汇编 / 反汇编）
  const seg = el("div", { class: "dir-seg" });
  const mkDirBtn = (dir, key) => el("button", {
    class: A.dir === dir ? "on" : "",
    type: "button",
    onclick: () => { if (A.dir === dir) return; A.dir = dir; renderAsmPanel(); },
  }, tt(key));
  seg.append(mkDirBtn("asm", "ui.qc.asmAssemble"), mkDirBtn("disasm", "ui.qc.asmDisasm"));
  bar.append(seg);

  // 架构 select（按方向过滤可选项）
  const archSel = el("select", {
    "aria-label": tt("ui.qc.asmArch"),
    onchange: () => { A.arch = archSel.value; renderAsmPanel(); },
  });
  const archList = A.dir === "asm"
    ? [...ASM_ARCH_BOTH, ...ASM_ARCH_ASSEMBLE_ONLY]
    : [...ASM_ARCH_BOTH, ...ASM_ARCH_DISASM_ONLY];
  if (!archList.includes(A.arch)) A.arch = "x86";
  for (const a of archList) {
    archSel.append(el("option", { value: a, selected: A.arch === a ? "" : null }, ASM_ARCH_LABEL[a]));
  }
  bar.append(el("span", { class: "qc-bar-label" }, tt("ui.qc.asmArch")), archSel);

  // 语法 select（仅 x86 系有意义）
  if (A.arch.startsWith("x86")) {
    const synSel = el("select", {
      "aria-label": tt("ui.qc.asmSyntax"),
      onchange: () => { A.syntax = synSel.value; runAsmPanel(); },
    });
    for (const [v, l] of [["intel", "Intel"], ["att", "AT&T"]]) {
      synSel.append(el("option", { value: v, selected: A.syntax === v ? "" : null }, l));
    }
    bar.append(el("span", { class: "qc-bar-label" }, tt("ui.qc.asmSyntax")), synSel);
  }

  // 基地址
  const baseInp = el("input", {
    class: "qc-base-inp mono", type: "text", inputmode: "numeric",
    value: A.base ? String(A.base) : "0",
    "aria-label": tt("ui.qc.asmBase"),
  });
  baseInp.addEventListener("change", () => {
    const n = parseInt(baseInp.value, 10);
    A.base = Number.isFinite(n) && n >= 0 ? n : 0;
    baseInp.value = String(A.base);
    runAsmPanel();
  });
  bar.append(el("span", { class: "qc-bar-label" }, tt("ui.qc.asmBase")), baseInp);

  $panel.append(bar);

  // 输入区（反汇编：hex/base64 字节；汇编：源码文本）
  const inTa = el("textarea", {
    class: "qc-asm-in mono", rows: 4, spellcheck: "false",
    placeholder: A.dir === "asm"
      ? tt("ui.qc.asmInPhAsm")
      : tt("ui.qc.asmInPhDis"),
  });
  inTa.value = A.input;
  inTa.addEventListener("input", () => { A.input = inTa.value; scheduleAsmRun(); });
  $panel.append(inTa);

  // 输入编码（仅反汇编）
  if (A.dir === "disasm") {
    const encSel = el("select", {
      "aria-label": tt("ui.qc.asmEnc"),
      onchange: () => { A.enc = encSel.value; runAsmPanel(); },
    });
    for (const [v, l] of [["hex", "hex"], ["base64", "base64"]]) {
      encSel.append(el("option", { value: v, selected: A.enc === v ? "" : null }, l));
    }
    const encRow = el("div", { class: "qc-bar qc-toolbar" }, el("span", { class: "qc-bar-label" }, tt("ui.qc.asmEnc")), encSel);
    $panel.append(encRow);
  }

  // 输出区
  const outPre = el("pre", { class: "qc-asm-out mono" });
  outPre.textContent = A.lastOut || "";
  outPre.style.color = A.lastErr ? "var(--error,#ff8a80)" : "";
  $panel.append(outPre);

  // 提示 + 引擎说明
  $panel.append(el("div", { class: "qc-hint" }, tt("ui.qc.asmHint")));

  runAsmPanel();
}

function scheduleAsmRun() {
  if (_asmTimer) clearTimeout(_asmTimer);
  _asmTimer = setTimeout(() => runAsmPanel(), 300);
}

async function runAsmPanel() {
  const A = S.asm;
  const outPre = $panel.querySelector(".qc-asm-out");
  if (!outPre) return;
  if (!A.input.trim()) { outPre.textContent = ""; outPre.style.color = ""; return; }
  outPre.textContent = tt("ui.qc.asmRunning");
  outPre.style.color = "";
  try {
    const r = A.dir === "asm"
      ? await asmAssembleRun({ text: A.input, params: { arch: A.arch, syntax: A.syntax, base: A.base } })
      : await asmDisasmRun({ text: A.input, params: { arch: A.arch, enc: A.enc, syntax: A.syntax, base: A.base } });
    A.lastOut = String(r);
    A.lastErr = false;
    outPre.textContent = A.lastOut;
    outPre.style.color = "";
  } catch (e) {
    A.lastErr = true;
    outPre.textContent = "✗ " + (e && e.message ? e.message : String(e));
    outPre.style.color = "var(--error,#ff8a80)";
  }
}
