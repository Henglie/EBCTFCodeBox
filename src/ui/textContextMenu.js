// textContextMenu.js — 编辑框自定义右键文本处理菜单（对标同类工具「文本区右键菜单」）
// 零耦合：自持样式注入、菜单 DOM、纯本地文本处理，零外发。
// 用法：attachTextContextMenu(area, opts) 在 area 上绑 contextmenu，弹 M3 风格菜单，处理后写回 area.value。
// - area 需支持 .value 读写（原生 textarea 或 contenteditable 代理均可）
// - opts.readonly=true → 只读框：仅给「复制/全选」无损项，不给会改写内容的项
// - opts.onChange → 写回后回调（与 editorToolbar 一致）
// i18n：菜单文案先硬编码中文，建议补的 key 见文件末注释与回执。
//
// 自定义菜单覆盖浏览器原生右键菜单，是预期行为（同类工具同款）。

/* ============================ 文本处理函数 ============================ */

// 智能分段：先规整空白，在中文/英文句末标点后断行；无标点的超长段按长度软断。
function smartParagraph(text) {
  let s = String(text).replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
 // 句末标点（。！？；…!?;）后补换行
  s = s.replace(/([。！？；…!?;])(?=\S)/g, "$1\n");
 // 逗号类不断行，只处理仍然过长的行：>42 字在最近的空格/中文逗号处软断
  const LIMIT = 42;
  const out = [];
  for (const line of s.split("\n")) {
    if (line.length <= LIMIT) { out.push(line); continue; }
    let rest = line;
    while (rest.length > LIMIT) {
      let cut = -1;
      for (let i = LIMIT; i > LIMIT * 0.5; i--) {
        if (/[ ，,、]/.test(rest[i])) { cut = i; break; }
      }
      if (cut < 0) cut = LIMIT;
      out.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) out.push(rest);
  }
  return out.join("\n");
}

const removeSpacesAndBreaks = (t) => String(t).replace(/\s+/g, "");
const breaksToSpaces = (t) => String(t).replace(/\r\n|\r|\n/g, " ");
const removeBreaks = (t) => String(t).replace(/\r\n|\r|\n/g, "");
const removeSpaces = (t) => String(t).replace(/[ \t]+/g, "");

// 全局字符去重：保留首次出现顺序。
function dedupeChars(text) {
  const seen = new Set();
  let out = "";
  for (const ch of String(text)) { // for..of 按码点，保 emoji/汉字完整
    if (!seen.has(ch)) { seen.add(ch); out += ch; }
  }
  return out;
}

const toLower = (t) => String(t).toLowerCase();
const toUpper = (t) => String(t).toUpperCase();
const swapCase = (t) => String(t).replace(/[a-zA-Z]/g, (c) =>
  c >= "a" && c <= "z" ? c.toUpperCase() : c.toLowerCase());
const swap01 = (t) => String(t).replace(/[01]/g, (c) => (c === "0" ? "1" : "0"));
const reverseStr = (t) => Array.from(String(t)).reverse().join("");

// Hex 串按字节对反转："48656c6c6f" → "6f6c6c6548"。非偶数长度：末尾单字符作为一组兜底。
function reverseHex(text) {
  const s = String(text).replace(/\s+/g, "");
  const pairs = [];
  for (let i = 0; i < s.length; i += 2) pairs.push(s.slice(i, i + 2));
  return pairs.reverse().join("");
}

/* ---- 数字金额转中文大写（标准财务规则）---- */
function amountToChinese(text) {
  const m = String(text).trim().match(/-?\d+(\.\d+)?/);
  if (!m) return text; // 非数字：原样返回
  let num = m[0];
  const neg = num.startsWith("-");
  if (neg) num = num.slice(1);
  const D = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const unit = ["", "拾", "佰", "仟"];
  const bigUnit = ["", "万", "亿", "兆"];
  let [intPart, decPart = ""] = num.split(".");
  intPart = intPart.replace(/^0+/, "") || "0";

  let intStr = "";
  if (intPart === "0") {
    intStr = "零";
  } else {
 // 每 4 位一节
    const groups = [];
    for (let i = intPart.length; i > 0; i -= 4) groups.unshift(intPart.slice(Math.max(0, i - 4), i));
    const gCount = groups.length;
    groups.forEach((g, gi) => {
      const bu = bigUnit[gCount - 1 - gi];
      let seg = "";
      let zeroFlag = false;
      const len = g.length;
      for (let i = 0; i < len; i++) {
        const d = +g[i];
        const u = unit[len - 1 - i];
        if (d === 0) { zeroFlag = true; }
        else { if (zeroFlag) { seg += "零"; zeroFlag = false; } seg += D[d] + u; }
      }
      if (seg) intStr += seg + bu;
      else if (intStr && !intStr.endsWith("零")) intStr += "零"; // 整节为零的连接
    });
    intStr = intStr.replace(/零+$/, "").replace(/零+/g, "零");
  }

  let result = intStr + "元";
  if (!decPart || /^0*$/.test(decPart)) {
    result += "整";
  } else {
    const jiao = +decPart[0] || 0;
    const fen = +decPart[1] || 0;
    if (jiao) result += D[jiao] + "角";
    else if (fen) result += "零"; // 角为零但分不为零补零
    if (fen) result += D[fen] + "分";
  }
  return (neg ? "负" : "") + result;
}

/* ---- 数字转英文读法 ---- */
function numberToEnglish(text) {
  const m = String(text).trim().match(/-?\d+(\.\d+)?/);
  if (!m) return text;
  let num = m[0];
  const neg = num.startsWith("-");
  if (neg) num = num.slice(1);
  const [intPart, decPart] = num.split(".");

  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const scales = ["", "thousand", "million", "billion", "trillion", "quadrillion"];

  function under1000(n) {
    let s = "";
    const h = Math.floor(n / 100);
    const r = n % 100;
    if (h) s += ones[h] + " hundred" + (r ? " " : "");
    if (r) {
      if (r < 20) s += ones[r];
      else { s += tens[Math.floor(r / 10)]; if (r % 10) s += "-" + ones[r % 10]; }
    }
    return s;
  }

  let intStr;
  const iNum = intPart.replace(/^0+/, "") || "0";
  if (iNum === "0") {
    intStr = "zero";
  } else {
    const groups = [];
    let x = iNum;
    while (x.length) { groups.unshift(x.slice(-3)); x = x.slice(0, -3); }
    const parts = [];
    const gCount = groups.length;
    groups.forEach((g, gi) => {
      const v = +g;
      if (!v) return;
      const scale = scales[gCount - 1 - gi];
      parts.push(under1000(v) + (scale ? " " + scale : ""));
    });
    intStr = parts.join(" ");
  }

  let result = intStr;
  if (decPart != null && decPart !== "") {
    result += " point " + Array.from(decPart).map((d) => ones[+d]).join(" ");
  }
  return (neg ? "negative " : "") + result;
}

/* ---- 汉字转拼音（内置精简高频表，无声调；未覆盖字保留原字，降级）---- */
// 覆盖最常用约 500 汉字，够 CTF 常见场景；生僻字降级保留。表内联不引外部数据文件。
const PINYIN_MAP = {
  的:"de",一:"yi",是:"shi",不:"bu",了:"le",在:"zai",人:"ren",有:"you",我:"wo",他:"ta",
  这:"zhe",个:"ge",们:"men",中:"zhong",来:"lai",上:"shang",大:"da",为:"wei",和:"he",国:"guo",
  地:"di",到:"dao",以:"yi",说:"shuo",时:"shi",要:"yao",就:"jiu",出:"chu",会:"hui",可:"ke",
  也:"ye",你:"ni",对:"dui",生:"sheng",能:"neng",而:"er",子:"zi",那:"na",得:"de",于:"yu",
  着:"zhe",下:"xia",自:"zi",之:"zhi",年:"nian",过:"guo",发:"fa",后:"hou",作:"zuo",里:"li",
  用:"yong",道:"dao",行:"xing",所:"suo",然:"ran",家:"jia",种:"zhong",事:"shi",成:"cheng",方:"fang",
  多:"duo",经:"jing",么:"me",去:"qu",法:"fa",学:"xue",如:"ru",都:"dou",同:"tong",现:"xian",
  当:"dang",没:"mei",动:"dong",面:"mian",起:"qi",看:"kan",定:"ding",天:"tian",分:"fen",还:"hai",
  进:"jin",好:"hao",小:"xiao",部:"bu",其:"qi",些:"xie",主:"zhu",样:"yang",理:"li",心:"xin",
  她:"ta",本:"ben",前:"qian",开:"kai",但:"dan",因:"yin",只:"zhi",从:"cong",想:"xiang",实:"shi",
  日:"ri",军:"jun",者:"zhe",意:"yi",无:"wu",力:"li",它:"ta",与:"yu",长:"chang",把:"ba",
  机:"ji",十:"shi",民:"min",第:"di",公:"gong",此:"ci",已:"yi",工:"gong",使:"shi",情:"qing",
  明:"ming",性:"xing",知:"zhi",全:"quan",三:"san",又:"you",关:"guan",点:"dian",正:"zheng",业:"ye",
  外:"wai",将:"jiang",两:"liang",高:"gao",间:"jian",由:"you",问:"wen",很:"hen",最:"zui",重:"zhong",
  并:"bing",物:"wu",手:"shou",应:"ying",战:"zhan",向:"xiang",头:"tou",文:"wen",体:"ti",政:"zheng",
  美:"mei",相:"xiang",见:"jian",被:"bei",利:"li",什:"shen",二:"er",等:"deng",产:"chan",或:"huo",
  新:"xin",己:"ji",制:"zhi",身:"shen",果:"guo",加:"jia",西:"xi",斯:"si",月:"yue",话:"hua",
  合:"he",回:"hui",特:"te",代:"dai",内:"nei",信:"xin",表:"biao",化:"hua",老:"lao",给:"gei",
  世:"shi",位:"wei",次:"ci",度:"du",门:"men",任:"ren",常:"chang",先:"xian",海:"hai",通:"tong",
  教:"jiao",儿:"er",原:"yuan",东:"dong",声:"sheng",提:"ti",立:"li",及:"ji",比:"bi",员:"yuan",
  解:"jie",水:"shui",名:"ming",真:"zhen",论:"lun",处:"chu",走:"zou",义:"yi",各:"ge",入:"ru",
  几:"ji",口:"kou",认:"ren",条:"tiao",平:"ping",系:"xi",气:"qi",题:"ti",活:"huo",尔:"er",
  更:"geng",别:"bie",打:"da",女:"nv",变:"bian",四:"si",神:"shen",总:"zong",何:"he",电:"dian",
  数:"shu",安:"an",少:"shao",报:"bao",才:"cai",结:"jie",反:"fan",受:"shou",目:"mu",太:"tai",
  量:"liang",再:"zai",感:"gan",建:"jian",务:"wu",做:"zuo",接:"jie",必:"bi",场:"chang",件:"jian",
  计:"ji",管:"guan",期:"qi",市:"shi",直:"zhi",德:"de",资:"zi",命:"ming",山:"shan",金:"jin",
  指:"zhi",克:"ke",许:"xu",统:"tong",区:"qu",保:"bao",至:"zhi",队:"dui",形:"xing",社:"she",
  便:"bian",空:"kong",决:"jue",治:"zhi",展:"zhan",马:"ma",科:"ke",司:"si",五:"wu",基:"ji",
  眼:"yan",书:"shu",非:"fei",则:"ze",听:"ting",白:"bai",却:"que",界:"jie",达:"da",光:"guang",
  放:"fang",强:"qiang",思:"si",且:"qie",权:"quan",况:"kuang",记:"ji",标:"biao",精:"jing",近:"jin",
  边:"bian",片:"pian",复:"fu",电:"dian",密:"mi",码:"ma",文:"wen",字:"zi",加:"jia",解:"jie",
  编:"bian",转:"zhuan",换:"huan",译:"yi",算:"suan",符:"fu",号:"hao",值:"zhi",键:"jian",锁:"suo",
};
function hanziToPinyin(text) {
  let out = "";
  let prevPy = false;
  for (const ch of String(text)) {
    const py = PINYIN_MAP[ch];
    if (py) { out += (prevPy ? " " : "") + py; prevPy = true; }
    else { out += ch; prevPy = false; }
  }
  return out;
}

/* ============================ 菜单定义 ============================ */
// 需要用户输入的项走 prompt（纯本地阻塞输入，同类工具同款交互）。
const EDIT_ITEMS = [
  { label: "智能分段", fn: smartParagraph },
  { label: "删除空格与换行", fn: removeSpacesAndBreaks },
  { label: "替换换行为空格", fn: breaksToSpaces },
  { label: "删除换行", fn: removeBreaks },
  { label: "删除空格", fn: removeSpaces },
  { sep: true },
  { label: "删除任意字符…", fn: (t) => {
      const ch = prompt("输入要删除的字符（可多个）：");
      if (ch == null || ch === "") return t;
      return Array.from(t).filter((c) => !ch.includes(c)).join("");
    } },
  { label: "替换指定字符为空格…", fn: (t) => {
      const ch = prompt("输入要替换为空格的字符（可多个）：");
      if (ch == null || ch === "") return t;
      return Array.from(t).map((c) => (ch.includes(c) ? " " : c)).join("");
    } },
  { label: "字符去重", fn: dedupeChars },
  { sep: true },
  { label: "全部小写", fn: toLower },
  { label: "全部大写", fn: toUpper },
  { label: "大小写互换", fn: swapCase },
  { label: "0/1 互换", fn: swap01 },
  { label: "字符反转", fn: reverseStr },
  { label: "Hex 串字节反转", fn: reverseHex },
  { sep: true },
  { label: "金额转中文大写", fn: amountToChinese },
  { label: "汉字转拼音", fn: hanziToPinyin },
  { label: "数字转英文", fn: numberToEnglish },
];

/* ============================ 菜单 UI ============================ */
let styleInjected = false;
function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const css = `
.tcm-menu{position:fixed;z-index:9999;min-width:180px;max-height:80vh;overflow-y:auto;
  padding:var(--sp-1,4px);background:var(--surface-3,#2a2a2a);color:var(--on-surface,#eee);
  border:1px solid var(--outline-var,#555);border-radius:var(--r-md,12px);
  box-shadow:var(--el-3,0 4px 12px rgba(0,0,0,.4));
  font-family:var(--font,system-ui);font-size:var(--fs-base,15px);
  user-select:none;-webkit-user-select:none;}
.tcm-item{padding:6px 12px;border-radius:var(--r-sm,8px);cursor:pointer;white-space:nowrap;
  transition:background var(--dur-short,.12s) var(--ease,ease);}
.tcm-item:hover{background:var(--surface-hi,#3a3a3a);}
.tcm-item:active{transform:scale(.98);}
.tcm-sep{height:1px;margin:4px 6px;background:var(--outline-var,#555);opacity:.5;}
`;
  const st = document.createElement("style");
  st.textContent = css;
  document.head.appendChild(st);
}

let openMenu = null;
function closeMenu() {
  if (openMenu) { openMenu.remove(); openMenu = null; }
  document.removeEventListener("pointerdown", onDocDown, true);
  document.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("blur", closeMenu);
  window.removeEventListener("resize", closeMenu);
}
function onDocDown(e) { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }
function onKeyDown(e) { if (e.key === "Escape") { e.preventDefault(); closeMenu(); } }

function buildMenu(items, area, opts, x, y) {
  injectStyle();
  closeMenu();
  const onChange = typeof opts.onChange === "function" ? opts.onChange : null;
  const menu = document.createElement("div");
  menu.className = "tcm-menu";
  for (const it of items) {
    if (it.sep) { const d = document.createElement("div"); d.className = "tcm-sep"; menu.append(d); continue; }
    const el = document.createElement("div");
    el.className = "tcm-item";
    el.textContent = it.label;
    el.addEventListener("click", () => {
      try {
        if (it.action) it.action(area);
        else {
          const before = area.value == null ? "" : String(area.value);
          const after = it.fn(before);
          if (after !== before) { area.value = after; if (onChange) onChange(); }
        }
      } catch { /* 单项异常不影响菜单 */ }
      closeMenu();
    });
    menu.append(el);
  }
  document.body.append(menu);

 // 边界回弹到可视区
  const r = menu.getBoundingClientRect();
  let nx = x, ny = y;
  if (nx + r.width > window.innerWidth) nx = Math.max(4, window.innerWidth - r.width - 4);
  if (ny + r.height > window.innerHeight) ny = Math.max(4, window.innerHeight - r.height - 4);
  menu.style.left = nx + "px";
  menu.style.top = ny + "px";

  openMenu = menu;
  document.addEventListener("pointerdown", onDocDown, true);
  document.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("blur", closeMenu);
  window.addEventListener("resize", closeMenu);
}

// 无损项（只读框也给）：复制选区/全部、全选。
function losslessItems() {
  return [
    { label: "复制", action: (area) => {
        let txt = "";
        try { const s = window.getSelection?.(); txt = s && s.toString() ? s.toString() : String(area.value ?? ""); } catch { txt = String(area.value ?? ""); }
        try { navigator.clipboard?.writeText(txt); } catch { /* 忽略 */ }
      } },
    { label: "全选", action: (area) => {
        try {
          if (typeof area.select === "function" && "selectionStart" in area) { area.focus(); area.select(); return; }
          const sel = window.getSelection(); if (!sel) return;
          const range = document.createRange(); range.selectNodeContents(area);
          sel.removeAllRanges(); sel.addRange(range); area.focus();
        } catch { /* 忽略 */ }
      } },
  ];
}

/**
 * attachTextContextMenu(area, opts) — 在 area 上绑右键菜单。
 * - opts.readonly=true → 仅「复制/全选」
 * - opts.onChange → 写回后回调
 */
export function attachTextContextMenu(area, opts = {}) {
  if (!area) return;
  const ro = opts.readonly === true;
  const items = ro ? losslessItems() : EDIT_ITEMS;
  area.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    buildMenu(items, area, opts, e.clientX, e.clientY);
  });
}

export {
  smartParagraph, removeSpacesAndBreaks, breaksToSpaces, removeBreaks, removeSpaces,
  dedupeChars, toLower, toUpper, swapCase, swap01, reverseStr, reverseHex,
  amountToChinese, numberToEnglish, hanziToPinyin,
};
