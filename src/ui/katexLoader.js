/*
 * katexLoader.js — KaTeX 懒加载 + 公式渲染（零外发，本地 dist）。
 *
 * 科普卡里带数学公式（RSA 的 c=mᵉ mod n、仿射 ax+b、连分数等）。KaTeX 体积不小
 * （min.js 260KB + css + 字体），但科普卡只在用户点进某个 op 页时才可能出现
 * 首屏不需要——所以懒加载：第一次要渲染公式时才动态插入本地 <script>/<link>。
 *
 * 零外发：全部资源指向本地 public/vendor/katex/（随包分发，等同天珩字库），绝不挂 CDN。
 * 缺失降级：若 public/vendor/katex/ 不存在（用户没放 dist），renderMath 回退为
 * 把公式包在 <code class="katex-fallback"> 里显示原始 TeX 源，不报错、不白屏。
 *
 * 用法：
 * import { renderMathIn } from "./katexLoader.js";
 * await renderMathIn(container); // 扫描 container 内 [data-tex] 元素，就地渲染
 * 或
 * const html = await renderMathToString("c = m^e \\bmod n", {display:true});
 */

const KATEX_BASE = "public/vendor/katex/";
const CSS_HREF = KATEX_BASE + "katex.min.css";
const JS_SRC = KATEX_BASE + "katex.min.js";

let _loadPromise = null;   // 单例：多处并发调用只加载一次
let _available = null;     // null=未知 / true=已就绪 / false=缺失降级

/** 动态插入 <link>（幂等）。 */
function ensureCss() {
  if (document.querySelector('link[data-katex]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = CSS_HREF;
  link.setAttribute("data-katex", "1");
  document.head.append(link);
}

/**
 * 懒加载 KaTeX 主脚本。返回 Promise<boolean>：true=可用，false=缺失降级。
 * 幂等——重复调用共享同一 Promise。
 */
export function loadKatex() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve) => {
 // 已由别处（如全局脚本）加载过
    if (window.katex) { _available = true; ensureCss(); resolve(true); return; }
    ensureCss();
    const s = document.createElement("script");
    s.src = JS_SRC;
    s.async = true;
    s.setAttribute("data-katex", "1");
    s.onload = () => { _available = !!window.katex; resolve(_available); };
    s.onerror = () => { _available = false; resolve(false); };  // dist 缺失 → 降级
    document.head.append(s);
  });
  return _loadPromise;
}

/** KaTeX 是否已确认可用（未加载过返回 null）。 */
export function katexAvailable() { return _available; }

/**
 * 渲染单条公式为 HTML 字符串。KaTeX 不可用时回退为转义后的原始 TeX。
 * @param {string} tex TeX 源
 * @param {{display?:boolean}} opts display=true 为独立居中公式（$$），否则行内
 */
export async function renderMathToString(tex, opts = {}) {
  const ok = await loadKatex();
  if (ok && window.katex) {
    try {
      return window.katex.renderToString(tex, {
        displayMode: !!opts.display,
        throwOnError: false,
        output: "html",
 // 天珩兜底：KaTeX 字体没覆盖的字符仍能显示
        strict: false,
      });
    } catch {
      return fallbackSpan(tex, opts.display);
    }
  }
  return fallbackSpan(tex, opts.display);
}

function fallbackSpan(tex, display) {
  const esc = String(tex)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cls = display ? "katex-fallback katex-fallback-block" : "katex-fallback";
  return `<code class="${cls}">${esc}</code>`;
}

/**
 * 就地渲染容器内所有 [data-tex] 元素。
 * 约定：<span data-tex="..." data-display="1|0"></span>
 * data-tex TeX 源（HTML 属性，写时注意转义引号）
 * data-display "1" 独立公式，缺省行内
 * 渲染后写入 innerHTML，并打 data-tex-done 标记避免重复渲染。
 */
export async function renderMathIn(container) {
  if (!container) return;
  const nodes = container.querySelectorAll("[data-tex]:not([data-tex-done])");
  if (!nodes.length) return;
  await loadKatex();
  for (const node of nodes) {
    const tex = node.getAttribute("data-tex") || "";
    const display = node.getAttribute("data-display") === "1";
    node.innerHTML = await renderMathToString(tex, { display });
    node.setAttribute("data-tex-done", "1");
  }
}
