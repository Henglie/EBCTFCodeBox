/*
 * customImplSource.js — 从内置 op 的注册入口反向抽取「可运行的完整算法源码」。
 *
 * 问题：Function.prototype.toString() 只给入口函数体，入口里引用的模块级 helper、
 * 常量表、跨文件 import 全部丢失，粘进自定义实现编辑器就是一层空壳，运行报
 * "xxx is not defined"。用户要的是能直接改的真算法源码。
 *
 * 本层做一个小型源码打包器（无第三方解析器）：
 *   1. 在模块源码里定位 register({ id: "<opId>", ... })；
 *   2. 找到 encode/decode/run 属性的入口（标识符或内联箭头/函数表达式）；
 *   3. 从文件顶层声明中递归收集入口引用的函数/常量/类；
 *   4. 跟随相对 import 跨文件收集，直到闭包完整；
 *   5. 每个源文件包成一个 IIFE 模块，按依赖顺序输出，避免不同模块的同名常量冲突。
 *
 * 边界（诚实版）：
 *   - 只处理本项目常见的 ESM 写法（import/export、function/const/let/var/class）。
 *   - `import * as ns`、`export default <表达式>`、动态 import、`import.meta` 不内联，
 *     会记入 warnings；运行时会显式报未定义，不静默产出错算法。
 *   - 运行时依赖 DOM（document/Image/canvas）的 op 在自定义实现 Worker 里仍不可用，
 *     会记入 warnings，由 UI 提示。
 *   - 生成的是**快照**：上游改算法后不会自动同步，UI 提供「同步上游」重新生成。
 *
 * 纯函数 + 异步 loadModule 回调；Node 与浏览器共用。零第三方依赖。
 */

const KEYWORDS = new Set((
  "break case catch class const continue debugger default delete do else export extends finally for " +
  "function if import in instanceof let new return super switch this throw try typeof var void while with " +
  "yield async await of static get set true false null undefined"
).split(" "));

const GLOBALS = new Set((
  "Math JSON Object Array String Number Boolean Date RegExp Map Set WeakMap WeakSet Promise Error TypeError " +
  "RangeError SyntaxError ArrayBuffer DataView Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array " +
  "Int32Array Uint32Array Float32Array Float64Array BigInt BigInt64Array BigUint64Array Symbol Proxy Reflect " +
  "TextEncoder TextDecoder atob btoa Buffer console parseInt parseFloat isNaN isFinite encodeURIComponent " +
  "decodeURIComponent encodeURI decodeURI escape unescape crypto performance setTimeout clearTimeout setInterval " +
  "clearInterval queueMicrotask structuredClone URL URLSearchParams Intl globalThis process require module exports " +
  "__dirname __filename H input rawBytes params dir Infinity NaN arguments Function eval " +
  // 浏览器/DOM 名：不是依赖，但自定义实现 Worker 里通常不存在；单独做能力告警。
  "document window self navigator location Blob File FileReader createImageBitmap Image ImageData " +
  "AbortController Headers Request Response fetch " +
  "OffscreenCanvas HTMLCanvasElement HTMLElement CanvasRenderingContext2D"
).split(" "));

const DOM_NAMES = ["document", "window", "createImageBitmap", "OffscreenCanvas", "HTMLCanvasElement", "ImageData", "Image"];

const REGEX_AFTER_KEYWORDS = new Set((
  "return typeof instanceof in of new delete void case do else yield await throw"
).split(" "));

function isSpace(c) { return c === " " || c === "\t" || c === "\r" || c === "\n"; }
function isIdStart(c) { return !!c && (/[A-Za-z_$]/.test(c) || c.charCodeAt(0) > 127); }
function isIdPart(c) { return !!c && (/[A-Za-z0-9_$]/.test(c) || c.charCodeAt(0) > 127); }

function skipLineComment(src, i) {
  while (i < src.length && src[i] !== "\n") i++;
  return i;
}
function skipBlockComment(src, i) {
  const end = src.indexOf("*/", i + 2);
  return end < 0 ? src.length : end + 2;
}
function skipString(src, i) {
  const quote = src[i];
  i++;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (quote === "`" && c === "$" && src[i + 1] === "{") {
      i = skipBalanced(src, i + 1);
      continue;
    }
    if (c === quote) return i + 1;
    i++;
  }
  return src.length;
}
function skipRegex(src, i) {
  i++;
  let inClass = false;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") { i += 2; continue; }
    if (c === "[") { inClass = true; i++; continue; }
    if (c === "]") { inClass = false; i++; continue; }
    if (c === "/" && !inClass) {
      i++;
      while (isIdPart(src[i])) i++;
      return i;
    }
    if (c === "\n") return i;
    i++;
  }
  return src.length;
}
/**
 * 模板字符串扫描：字面量跳过，`${...}` 里的表达式正文回调给 onInner。
 * 不能直接用 skipBalanced——它内部会把嵌套模板整段跳过，插值（尤其嵌套模板）里的
 * 依赖标识符会漏掉；闭包漏一个 helper，运行时就是 not defined。
 * @param {string} src
 * @param {number} i src[i] === '`'
 * @param {(expr:string)=>void} onInner
 * @returns {number} 模板结束后的下标
 */
function walkTemplate(src, i, onInner) {
  let j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "`") return j + 1;
    if (c === "$" && src[j + 1] === "{") {
      let depth = 1, k = j + 2;
      while (k < src.length && depth > 0) {
        const ch = src[k];
        if (ch === "\\") { k += 2; continue; }
        if (ch === "`") { k = walkTemplate(src, k, onInner); continue; }
        if (ch === '"' || ch === "'") { k = skipString(src, k); continue; }
        if (ch === "{") { depth++; k++; continue; }
        if (ch === "}") { depth--; k++; continue; }
        k++;
      }
      onInner(src.slice(j + 2, Math.max(j + 2, k - 1)));
      j = k;
      continue;
    }
    j++;
  }
  return src.length;
}

function prevAllowsRegex(prev) {
  if (!prev) return true;
  if (prev.type === "id") return REGEX_AFTER_KEYWORDS.has(prev.value);
  if (prev.type === "punct") return !/^[)\]}]$/.test(prev.value);
  return false;
}
/** 从开括号位置跳到配对闭括号之后；跳过字符串/注释/模板/正则。 */
function skipBalanced(src, i) {
  const open = src[i];
  const close = open === "{" ? "}" : open === "(" ? ")" : open === "[" ? "]" : null;
  if (!close) return i + 1;
  let depth = 1;
  let prev = null;
  i++;
  while (i < src.length) {
    const c = src[i];
    if (isSpace(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (c === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); prev = { type: "string" }; continue; }
    if (c === "/" && prevAllowsRegex(prev)) { i = skipRegex(src, i); prev = { type: "regex" }; continue; }
    if (c === open) { depth++; i++; prev = { type: "punct", value: c }; continue; }
    if (c === close) { depth--; i++; prev = { type: "punct", value: c }; if (!depth) return i; continue; }
    if (isIdStart(c)) {
      const start = i;
      while (isIdPart(src[i])) i++;
      prev = { type: "id", value: src.slice(start, i) };
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (/[0-9a-fA-FxXoObBeEn._]/.test(src[i] || "")) i++;
      prev = { type: "number" };
      continue;
    }
    prev = { type: "punct", value: c };
    i++;
  }
  return src.length;
}

function readId(src, i) {
  const start = i;
  while (isIdPart(src[i])) i++;
  return { value: src.slice(start, i), start, end: i };
}

function skipSpace(src, i) {
  while (i < src.length) {
    if (isSpace(src[i])) { i++; continue; }
    if (src[i] === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (src[i] === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }
    break;
  }
  return i;
}

/** 找顶层语句结束位置（分号或 ASI 换行），跳过嵌套结构。返回结束索引（不含）。 */
function skipStatementEnd(src, i) {
  let paren = 0, bracket = 0, brace = 0;
  let prev = null;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n" && !paren && !bracket && !brace) {
      const j = skipSpace(src, i + 1);
      if (j >= src.length) return i;
      const next = src.slice(j, j + 12);
      if (/^(const|let|var|function|class|export|import|async\s+function)\b/.test(next)) return i;
    }
    if (isSpace(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (c === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); prev = { type: "string" }; continue; }
    if (c === "/" && prevAllowsRegex(prev)) { i = skipRegex(src, i); prev = { type: "regex" }; continue; }
    if (c === "(") { paren++; i++; prev = { type: "punct", value: c }; continue; }
    if (c === ")") { paren = Math.max(0, paren - 1); i++; prev = { type: "punct", value: c }; continue; }
    if (c === "[") { bracket++; i++; prev = { type: "punct", value: c }; continue; }
    if (c === "]") { bracket = Math.max(0, bracket - 1); i++; prev = { type: "punct", value: c }; continue; }
    if (c === "{") { brace++; i++; prev = { type: "punct", value: c }; continue; }
    if (c === "}") {
      if (brace > 0) { brace--; i++; prev = { type: "punct", value: c }; continue; }
      return i; // 顶层对象字面量结束（调用方通常已跳过）
    }
    if (c === ";" && !paren && !bracket && !brace) return i + 1;
    if (isIdStart(c)) { while (isIdPart(src[i])) i++; prev = { type: "id" }; continue; }
    if (/[0-9]/.test(c)) { while (/[0-9a-fA-FxXoObBeEn._]/.test(src[i] || "")) i++; prev = { type: "number" }; continue; }
    prev = { type: "punct", value: c };
    i++;
  }
  return src.length;
}

/** 跳过一个声明初始化表达式，停在顶层逗号/分号/右括号/换行前。 */
function skipInitializer(src, i) {
  let paren = 0, bracket = 0, brace = 0;
  let prev = null;
  while (i < src.length) {
    const c = src[i];
    if (c === "\n" && !paren && !bracket && !brace) return i;
    if (c === "/" && src[i + 1] === "/") { i = skipLineComment(src, i); continue; }
    if (c === "/" && src[i + 1] === "*") { i = skipBlockComment(src, i); continue; }
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); prev = { type: "string" }; continue; }
    if (c === "/" && prevAllowsRegex(prev)) { i = skipRegex(src, i); prev = { type: "regex" }; continue; }
    if (c === "(") { paren++; i++; prev = { type: "punct", value: c }; continue; }
    if (c === ")") { paren = Math.max(0, paren - 1); i++; prev = { type: "punct", value: c }; continue; }
    if (c === "[") { bracket++; i++; prev = { type: "punct", value: c }; continue; }
    if (c === "]") { bracket = Math.max(0, bracket - 1); i++; prev = { type: "punct", value: c }; continue; }
    if (c === "{") { brace++; i++; prev = { type: "punct", value: c }; continue; }
    if (c === "}") { brace = Math.max(0, brace - 1); i++; prev = { type: "punct", value: c }; continue; }
    if ((c === "," || c === ";") && !paren && !bracket && !brace) return i;
    if (isIdStart(c)) { while (isIdPart(src[i])) i++; prev = { type: "id" }; continue; }
    if (/[0-9]/.test(c)) { while (/[0-9a-fA-FxXoObBeEn._]/.test(src[i] || "")) i++; prev = { type: "number" }; continue; }
    if (!isSpace(c)) prev = { type: "punct", value: c };
    i++;
  }
  return i;
}

/** 收集代码里引用到的标识符（跳过属性访问、字符串、注释、正则）。 */
export function collectIdentifiers(text) {
  const s = String(text || "");
  const out = new Set();
  let i = 0;
  let prev = null;
  while (i < s.length) {
    const c = s[i];
    if (isSpace(c)) { i++; continue; }
    if (c === "/" && s[i + 1] === "/") { i = skipLineComment(s, i); continue; }
    if (c === "/" && s[i + 1] === "*") { i = skipBlockComment(s, i); continue; }
    if (c === "`") {
      i = walkTemplate(s, i, (inner) => { for (const id of collectIdentifiers(inner)) out.add(id); });
      prev = { type: "string" };
      continue;
    }
    if (c === '"' || c === "'") { i = skipString(s, i); prev = { type: "string" }; continue; }
    if (c === "/" && prevAllowsRegex(prev)) { i = skipRegex(s, i); prev = { type: "regex" }; continue; }
    if (isIdStart(c)) {
      const id = readId(s, i);
      if (prev && prev.type === "punct" && (prev.value === "." || prev.value === "?.")) {
        i = id.end; prev = { type: "id", value: id.value }; continue;
      }
      // 对象字面量的键（{ ok: true } / , text: ...）不是依赖；三元表达式的 b 前面是 ?，不能误杀。
      const next = skipSpace(s, id.end);
      const isKey = s[next] === ":" && (!prev ||
        (prev.type === "punct" && (prev.value === "{" || prev.value === "," || prev.value === ";")));
      // continue outer / break outer 的 outer 是标签，不是变量。
      const isLabelRef = prev && prev.type === "id" && (prev.value === "continue" || prev.value === "break");
      if (!isKey && !isLabelRef && !KEYWORDS.has(id.value) && !GLOBALS.has(id.value)) out.add(id.value);
      i = id.end;
      prev = { type: "id", value: id.value };
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (/[0-9a-fA-FxXoObBeEn._]/.test(s[i] || "")) i++;
      prev = { type: "number" };
      continue;
    }
    const three = s.slice(i, i + 3);
    if (three === "...") { // 展开运算符不是属性访问，否则 ...args 会被当成 .args 丢掉
      prev = { type: "punct", value: "..." }; i += 3; continue;
    }
    const two = s.slice(i, i + 2);
    if (two === "?." || two === "=>" || two === "++" || two === "--") {
      prev = { type: "punct", value: two }; i += 2; continue;
    }
    prev = { type: "punct", value: c };
    i++;
  }
  return out;
}

/**
 * 收集一段代码里**自己声明**的名字（函数/箭头参数、var/let/const、catch、class）。
 * 用途：解析依赖时排除局部变量，否则每个形参都会被当成「未解析的模块级 helper」。
 * 这是作用域近似（同名局部变量可能遮蔽真实依赖），只用于降噪，不影响功能。
 */
export function collectDeclaredNames(text) {
  const s = String(text || "");
  const out = new Set();
  let i = 0;
  let prev = null;
  while (i < s.length) {
    const c = s[i];
    if (isSpace(c)) { i++; continue; }
    if (c === "/" && s[i + 1] === "/") { i = skipLineComment(s, i); continue; }
    if (c === "/" && s[i + 1] === "*") { i = skipBlockComment(s, i); continue; }
    if (c === "`") {
      i = walkTemplate(s, i, (inner) => { for (const n of collectDeclaredNames(inner)) out.add(n); });
      prev = { type: "string" };
      continue;
    }
    if (c === '"' || c === "'") { i = skipString(s, i); prev = { type: "string" }; continue; }
    if (c === "/" && prevAllowsRegex(prev)) { i = skipRegex(s, i); prev = { type: "regex" }; continue; }
    if (/[0-9]/.test(c)) {
      while (/[0-9a-fA-FxXoObBeEn._]/.test(s[i] || "")) i++;
      prev = { type: "number" };
      continue;
    }
    if (isIdStart(c)) {
      const tok = readId(s, i);
      const w = tok.value;
      prev = { type: "id", value: w };
      let j = skipSpace(s, tok.end);
      if (w === "function" || w === "class") {
        if (s[j] === "*") j = skipSpace(s, j + 1);
        const nm = readId(s, j);
        if (nm.value) out.add(nm.value);
        j = skipSpace(s, nm.end);
        if (s[j] === "(") {
          const close = skipBalanced(s, j);
          for (const n of bindingNames(s.slice(j + 1, close - 1))) out.add(n);
          j = close;
        }
        i = j;
        continue;
      }
      if (w === "var" || w === "let" || w === "const") {
        // 只取绑定模式，不能把 for (const m of MAGIC) 里的 MAGIC/循环体当成本地声明。
        let j = skipSpace(s, tok.end);
        let firstInit = -1;
        for (;;) {
          if (s[j] === "{" || s[j] === "[") {
            const close = skipBalanced(s, j);
            for (const n of bindingNames(s.slice(j, close))) out.add(n);
            j = close;
          } else {
            const nm = readId(s, j);
            if (nm.value && !KEYWORDS.has(nm.value)) out.add(nm.value);
            j = nm.end;
          }
          j = skipSpace(s, j);
          if (s[j] === "=") {
            if (firstInit < 0) firstInit = j;
            j = skipSpace(s, skipInitializer(s, j + 1));
          }
          if (s[j] === ",") { j = skipSpace(s, j + 1); continue; }
          break;
        }
        // 回到初始化表达式起点继续扫：里面可能有箭头参数/嵌套 const。
        i = firstInit >= 0 ? firstInit : j;
        prev = { type: "punct", value: "=" };
        continue;
      }
      if (w === "catch" && s[j] === "(") {
        const close = skipBalanced(s, j);
        for (const n of bindingNames(s.slice(j + 1, close - 1))) out.add(n);
        i = close;
        prev = { type: "punct", value: ")" };
        continue;
      }
      if (s.slice(j, j + 2) === "=>") out.add(w);
      if (s[j] === "(") {
        const close = skipBalanced(s, j);
        const k = skipSpace(s, close);
        const control = w === "for" || w === "if" || w === "while" || w === "switch" || w === "with" || w === "catch";
        if (s.slice(k, k + 2) === "=>" || (s[k] === "{" && !control)) {
          // 箭头参数 / 方法简写 name(a,b) {...}
          for (const n of bindingNames(s.slice(j + 1, close - 1))) out.add(n);
          // 方法名本身不是模块级依赖（class/对象成员），加进 locals 防误报 missing。
          if (s[k] === "{" && !control) out.add(w);
        }
        // 括号里可能有 let/const/箭头函数（控制语句条件、调用实参都会出现），必须进去扫。
        i = j + 1;
        prev = { type: "punct", value: "(" };
        continue;
      }
      i = tok.end;
      continue;
    }
    if (c === "(") {
      const close = skipBalanced(s, i);
      const k = skipSpace(s, close);
      if (s.slice(k, k + 2) === "=>") for (const n of bindingNames(s.slice(i + 1, close - 1))) out.add(n);
      // 不能整段跳过：`(async () => { const mod = ... })()` 的声明在括号里。
      prev = { type: "punct", value: "(" };
      i++;
      continue;
    }
    prev = { type: "punct", value: c };
    i++;
  }
  return out;
}

function parseImportBindings(clause, source) {
  const bindings = [];
  let rest = String(clause || "").trim();
  if (!rest) return bindings;
  const star = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(rest);
  if (star) {
    bindings.push({ local: star[1], imported: "*", source, kind: "namespace" });
    return bindings;
  }
  const comma = splitTopLevel(rest, ",");
  if (comma.length > 1) {
    const first = comma[0].trim();
    if (isIdStart(first[0])) bindings.push({ local: first, imported: "default", source, kind: "default" });
    rest = comma.slice(1).join(",").trim();
  }
  const named = /^\{([\s\S]*)\}$/.exec(rest);
  if (named) {
    for (const piece of named[1].split(",")) {
      const t = piece.trim();
      if (!t) continue;
      const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(t);
      if (m) bindings.push({ local: m[2] || m[1], imported: m[1], source, kind: "named" });
    }
  } else if (isIdStart(rest[0]) && !bindings.length) {
    bindings.push({ local: rest, imported: "default", source, kind: "default" });
  }
  return bindings;
}

/** 按顶层分隔符切分（忽略括号/字符串/注释内的分隔符）。 */
function splitTopLevel(text, sep) {
  const s = String(text || "");
  const parts = [];
  let start = 0;
  let paren = 0, bracket = 0, brace = 0;
  let prev = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "/" && s[i + 1] === "/") { i = skipLineComment(s, i) - 1; continue; }
    if (c === "/" && s[i + 1] === "*") { i = skipBlockComment(s, i) - 1; continue; }
    if (c === '"' || c === "'" || c === "`") { i = skipString(s, i) - 1; continue; }
    if (c === "/" && prevAllowsRegex(prev)) { i = skipRegex(s, i) - 1; continue; }
    if (c === "(") paren++;
    else if (c === ")") paren = Math.max(0, paren - 1);
    else if (c === "[") bracket++;
    else if (c === "]") bracket = Math.max(0, bracket - 1);
    else if (c === "{") brace++;
    else if (c === "}") brace = Math.max(0, brace - 1);
    else if (c === sep && !paren && !bracket && !brace) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
    // for 循环自增：扫描到分隔符后要回退一位，否则会跳过紧跟标识符/数字的逗号。
    if (isIdStart(c)) { while (isIdPart(s[i])) i++; i--; prev = { type: "id" }; continue; }
    if (/[0-9]/.test(c)) { while (/[0-9a-fA-FxXoObBeEn._]/.test(s[i] || "")) i++; i--; prev = { type: "number" }; continue; }
    prev = { type: "punct", value: c };
  }
  parts.push(s.slice(start));
  return parts;
}

/** 声明左侧绑定名（支持解构/多声明符）。 */
function bindingNames(lhs) {
  const names = new Set();
  for (const part of splitTopLevel(lhs, ",")) {
    let beforeEq = part;
    // 找顶层第一个 =
    let paren = 0, bracket = 0, brace = 0;
    for (let i = 0; i < part.length; i++) {
      const c = part[i];
      if (c === "(") paren++;
      else if (c === ")") paren = Math.max(0, paren - 1);
      else if (c === "[") bracket++;
      else if (c === "]") bracket = Math.max(0, bracket - 1);
      else if (c === "{") brace++;
      else if (c === "}") brace = Math.max(0, brace - 1);
      else if (c === "=" && !paren && !bracket && !brace) { beforeEq = part.slice(0, i); break; }
    }
    for (const id of collectIdentifiers(beforeEq)) names.add(id);
  }
  return [...names];
}

function stripExportPrefix(src, start) {
  let i = skipSpace(src, start);
  if (src.slice(i, i + 6) === "export") {
    i = skipSpace(src, i + 6);
    if (src.slice(i, i + 7) === "default") i = skipSpace(src, i + 7);
  }
  return i;
}

/**
 * 扫描一个 ESM 源文件，记录顶层声明、import 绑定、export 映射、register 调用。
 * 返回 { url, text, decls, imports, importBindings, exports, byName, calls }。
 */
export function parseModule(text, url = "") {
  const src = String(text || "");
  const decls = [];
  const importBindings = new Map();
  const imports = [];
  const exports = new Map();
  const calls = [];
  let i = 0;
  let idSeq = 0;

  function addDecl(d, opts = {}) {
    const names = d.names || opts.names || [];
    d.names = names;
    d.exported = !!opts.exported;
    d.defaultExport = !!opts.defaultExport;
    decls.push(d);
    for (const n of names) if (n && n !== "default") {
      if (!exports.has(n)) exports.set(n, { kind: "decl", decl: d, name: n });
    }
    if (opts.defaultExport) {
      const n = names.find((x) => x && x !== "default") || d.defaultName;
      if (n) exports.set("default", { kind: "decl", decl: d, name: n });
    }
    return d;
  }

  while (i < src.length) {
    i = skipSpace(src, i);
    if (i >= src.length) break;
    const tok = readId(src, i);
    const word = tok.value;

    if (word === "import") {
      const end = skipStatementEnd(src, tok.end);
      const stmt = src.slice(i, end);
      const m = /^import\s+([\s\S]*?)\s+from\s*["']([^"']+)["']/.exec(stmt) ||
        /^import\s*["']([^"']+)["']/.exec(stmt);
      if (m && m[2]) {
        const source = m[2];
        imports.push({ source, text: stmt });
        for (const b of parseImportBindings(m[1], source)) importBindings.set(b.local, b);
      }
      i = end;
      continue;
    }

    if (word === "export") {
      let j = skipSpace(src, tok.end);
      let isDefault = false;
      if (src.slice(j, j + 7) === "default") { isDefault = true; j = skipSpace(src, j + 7); }
      const next = readId(src, j);
      if (next.value === "function" || next.value === "class" ||
          next.value === "const" || next.value === "let" || next.value === "var" ||
          next.value === "async") {
        i = parseDeclAt(next.start, true, isDefault);
        continue;
      }
      if (src[j] === "{") {
        const close = skipBalanced(src, j);
        const inner = src.slice(j + 1, close - 1);
        let k = skipSpace(src, close);
        let from = "";
        if (src.slice(k, k + 4) === "from") {
          k = skipSpace(src, k + 4);
          if (src[k] === '"' || src[k] === "'") {
            const q = src[k];
            let e = k + 1;
            while (e < src.length && src[e] !== q) e++;
            from = src.slice(k + 1, e);
            k = skipStatementEnd(src, e + 1);
          }
        }
        for (const piece of inner.split(",")) {
          const t = piece.trim();
          if (!t) continue;
          const m = /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(t);
          if (!m) continue;
          const local = m[1], alias = m[2] || m[1];
          exports.set(alias, from
            ? { kind: "reexport", source: from, imported: local }
            : { kind: "local", name: local });
        }
        i = k > close ? k : close;
        continue;
      }
      if (src[j] === "*") {
        i = skipStatementEnd(src, j + 1);
        continue;
      }
      // export default <表达式>：包成一条合成声明，尽量支持
      const end = skipStatementEnd(src, j);
      const expr = src.slice(j, end).replace(/;\s*$/, "");
      if (isDefault && expr.trim()) {
        const name = "__ebctf_default_" + (idSeq++);
        addDecl({
          kind: "const", names: [name], start: j, end,
          text: "const " + name + " = " + expr + ";", defaultName: name,
        }, { exported: true, defaultExport: true });
      }
      i = end;
      continue;
    }

    if (word === "async") {
      const n = skipSpace(src, tok.end);
      if (src.slice(n, n + 8) === "function") {
        i = parseDeclAt(i, false, false);
        continue;
      }
      i = skipStatementEnd(src, tok.end);
      continue;
    }

    if (word === "function" || word === "class" || word === "const" || word === "let" || word === "var") {
      i = parseDeclAt(i, false, false);
      continue;
    }

    if (word === "register" && src[skipSpace(src, tok.end)] === "(") {
      const paren = skipSpace(src, tok.end);
      const close = skipBalanced(src, paren);
      const objStart = skipSpace(src, paren + 1);
      if (src[objStart] === "{") {
        const objEnd = skipBalanced(src, objStart);
        calls.push({ objStart, objEnd, start: i, end: close });
      }
      i = close;
      continue;
    }

    // 普通顶层语句：整条跳过，避免把嵌套函数当成顶层声明
    if (src[i] === "{") { i = skipBalanced(src, i); continue; }
    i = skipStatementEnd(src, tok.end);
  }

  function parseDeclAt(start, exported, defaultExport) {
    let i = skipSpace(src, start);
    let textStart = i;
    let isAsync = false;
    if (src.slice(i, i + 5) === "async" && !isIdPart(src[i + 5])) {
      isAsync = true;
      i = skipSpace(src, i + 5);
    }
    const kw = readId(src, i).value;
    if (kw === "function") {
      let j = skipSpace(src, i + 8);
      if (src[j] === "*") j = skipSpace(src, j + 1);
      const nameTok = readId(src, j);
      let name = nameTok.value;
      j = nameTok.end;
      const paren = src.indexOf("(", j);
      j = paren < 0 ? j : skipBalanced(src, paren);
      j = skipSpace(src, j);
      if (src[j] === "{") {
        const end = skipBalanced(src, j);
        const text = src.slice(textStart, end);
        const names = name ? [name] : (defaultExport ? ["default"] : []);
        if (!name && defaultExport) {
          const synth = "__ebctf_default_" + (idSeq++);
          addDecl({ kind: "function", names: [synth], start: textStart, end, text: "const " + synth + " = " + text + ";", defaultName: synth }, { exported, defaultExport });
          return end;
        }
        addDecl({ kind: "function", names, start: textStart, end, text }, { exported, defaultExport });
        return end;
      }
      return skipStatementEnd(src, j);
    }
    if (kw === "class") {
      let j = skipSpace(src, i + 5);
      const nameTok = readId(src, j);
      const name = nameTok.value;
      j = skipSpace(src, nameTok.end);
      while (j < src.length && src[j] !== "{") {
        if (src[j] === "(" || src[j] === "[" || src[j] === "{") j = skipBalanced(src, j);
        else j = skipSpace(src, j + 1);
      }
      const end = src[j] === "{" ? skipBalanced(src, j) : j;
      addDecl({ kind: "class", names: name ? [name] : [], start: textStart, end, text: src.slice(textStart, end) }, { exported, defaultExport });
      return end;
    }
    if (kw === "const" || kw === "let" || kw === "var") {
      const end = skipStatementEnd(src, i + kw.length);
      const text = src.slice(textStart, end);
      const afterKw = text.slice(kw.length + (isAsync ? 5 : 0));
      const names = bindingNames(afterKw);
      addDecl({ kind: kw, names, start: textStart, end, text }, { exported, defaultExport });
      return end;
    }
    return skipStatementEnd(src, i);
  }

  const byName = new Map();
  for (const d of decls) for (const n of d.names) if (n && n !== "default" && !byName.has(n)) byName.set(n, d);
  return { url, text: src, decls, imports, importBindings, exports, byName, calls };
}

/** 在 register 调用里找 opId 对应的方向入口。 */
export function findEntry(mod, opId, dir = "encode") {
  if (!mod || !mod.calls || !mod.calls.length) return null;
  for (const call of mod.calls) {
    const objText = mod.text.slice(call.objStart + 1, call.objEnd - 1);
    const idm = /\bid\s*:\s*["']([^"']+)["']/.exec(objText);
    if (!idm || idm[1] !== opId) continue;
    const props = parseObjectProperties(objText);
    const order = dir === "decode"
      ? ["decode", "run", "encode"]
      : dir === "run" ? ["run", "encode", "decode"] : ["encode", "run", "decode"];
    for (const key of order) {
      const p = props.get(key);
      if (!p) continue;
      return { key, ...p, objStart: call.objStart, objEnd: call.objEnd };
    }
  }
  return null;
}

function parseObjectProperties(objText) {
  const props = new Map();
  let i = 0;
  while (i < objText.length) {
    i = skipSpace(objText, i);
    if (i >= objText.length) break;
    if (objText[i] === ",") { i++; continue; }
    if (!isIdStart(objText[i])) { i++; continue; }
    const key = readId(objText, i);
    let j = skipSpace(objText, key.end);
    // async run(t,p){...}：async 是修饰符，下一段才是方法名；生成时必须保留 async。
    if (key.value === "async") {
      const nm = readId(objText, j);
      const k2 = skipSpace(objText, nm.end);
      if (nm.value && objText[k2] === "(") {
        const closeParams = skipBalanced(objText, k2);
        const body = skipSpace(objText, closeParams);
        if (objText[body] === "{") {
          const end = skipBalanced(objText, body);
          props.set(nm.value, { kind: "expr", text: "async function" + objText.slice(k2, end) });
          i = end;
          continue;
        }
      }
    }
    if (objText[j] === ":") {
      j = skipSpace(objText, j + 1);
      const end = skipPropertyValue(objText, j);
      props.set(key.value, { kind: "expr", text: objText.slice(j, end).trim() });
      i = end;
      continue;
    }
    if (objText[j] === "(") {
      // 方法简写 run(t,p) {...}
      const closeParams = skipBalanced(objText, j);
      const body = skipSpace(objText, closeParams);
      if (objText[body] === "{") {
        const end = skipBalanced(objText, body);
        // 方法简写 run(t,p){...} 的运行时 toString 是 "(t,p){...}"，作为表达式必须补 function。
        props.set(key.value, { kind: "expr", text: "function" + objText.slice(j, end) });
        i = end;
        continue;
      }
    }
    if (objText[j] === "," || objText[j] === "}") { i = j + 1; continue; }
    i = j + 1;
  }
  return props;
}

function skipPropertyValue(text, i) {
  let paren = 0, bracket = 0, brace = 0;
  let prev = null;
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") { i = skipLineComment(text, i); continue; }
    if (c === "/" && text[i + 1] === "*") { i = skipBlockComment(text, i); continue; }
    if (c === '"' || c === "'" || c === "`") { i = skipString(text, i); prev = { type: "string" }; continue; }
    if (c === "/" && prevAllowsRegex(prev)) { i = skipRegex(text, i); prev = { type: "regex" }; continue; }
    if (c === "(") paren++;
    else if (c === ")") paren = Math.max(0, paren - 1);
    else if (c === "[") bracket++;
    else if (c === "]") bracket = Math.max(0, bracket - 1);
    else if (c === "{") brace++;
    else if (c === "}") { if (!brace) return i; brace = Math.max(0, brace - 1); }
    else if (c === "," && !paren && !bracket && !brace) return i;
    if (isIdStart(c)) { while (isIdPart(text[i])) i++; prev = { type: "id" }; continue; }
    if (/[0-9]/.test(c)) { while (/[0-9a-fA-FxXoObBeEn._]/.test(text[i] || "")) i++; prev = { type: "number" }; continue; }
    if (!isSpace(c)) prev = { type: "punct", value: c };
    i++;
  }
  return i;
}

/**
 * 构建完整实现源码。
 * @param {{fileText:string, fileUrl:string, opId:string, dir:string, loadModule:(url:string)=>Promise<{url:string,text:string}|null>, maxFiles?:number, maxChars?:number}} opts
 * @returns {Promise<{ok:true, code:string, warnings:string[], missing:string[], files:string[], entry:object, modules:number, decls:number}|{ok:false, errors:string[], warnings:string[], missing:string[]}>}
 */
export async function buildSourceBundle(opts) {
  const {
    fileText, fileUrl = "", opId, dir = "encode",
    loadModule, maxFiles = 24, maxChars = 320000,
  } = opts || {};
  const warnings = [];
  const missing = [];
  const files = [];
  const mods = new Map();
  let moduleSeq = 0;
  let domWarned = false;

  function getModule(url, text) {
    if (mods.has(url)) return mods.get(url);
    const m = parseModule(text, url);
    m.id = moduleSeq++;
    m.included = new Set();
    m.exportSet = new Set();
    m.aliases = new Map();
    m.deps = new Set();
    m.done = false;
    mods.set(url, m);
    files.push(url);
    return m;
  }

  const rootText = String(fileText || "");
  const root = getModule(fileUrl || "<entry>", rootText);
  let entry = findEntry(root, opId, dir);
  if (!entry && opts && opts.op) {
    // 注册块可能由辅助函数生成（regKey / makeOp / 循环注册……），源码里没有直接
    // register({id:"..."})。这时直接用运行时函数对象取入口源码，再按同一闭包算法内联依赖。
    const op = opts.op;
    const fn = dir === "decode"
      ? (op.decode || op.run || op.encode)
      : dir === "encode" ? (op.encode || op.run || op.decode) : (op.run || op.encode || op.decode);
    if (typeof fn === "function") {
      let src = "";
      try { src = Function.prototype.toString.call(fn); } catch { src = ""; }
      if (src && !/\{\s*\[native code\]\s*\}/.test(src)) {
        const nm = fn.name && !/^(encode|decode|run|bound )/.test(fn.name) ? fn.name : "";
        if (nm && (root.byName.has(nm) || root.importBindings.has(nm))) {
          entry = { key: dir, kind: "expr", text: nm };
          warnings.push("注册块由辅助函数生成，入口按运行时函数名 " + nm + " 解析");
        } else {
          entry = { key: dir, kind: "expr", text: src };
          warnings.push("注册块由辅助函数生成，入口取自运行时函数源码");
        }
      }
    }
  }
  if (!entry) {
    return { ok: false, errors: ["未在源文件中找到 op 的 register 注册块或方向入口"], warnings, missing };
  }

  function globalResult() { return { global: true }; }

  async function resolveName(name, mod, stack = new Set()) {
    if (!name) return null;
    if (GLOBALS.has(name)) return globalResult();
    const key = name + "@" + mod.id;
    if (stack.has(key)) return null; // 循环引用：交给运行时自然报错
    // 关键：每个分支用独立的路径副本。共用同一个 Set 会把「兄弟分支」误判成环，
    // 导致第二个 import 同名 helper 不再解析（实测 dataURIToImage 的 b64ToBytes 丢失）。
    stack = new Set(stack);
    stack.add(key);

    const decl = mod.byName.get(name);
    if (decl) {
      await includeDecl(decl, mod, stack);
      mod.exportSet.add(name);
      return { mod, localName: name };
    }

    const exp = mod.exports.get(name);
    if (exp) {
      if (exp.kind === "decl") {
        await includeDecl(exp.decl, mod, stack);
        mod.exportSet.add(exp.name);
        return { mod, localName: exp.name };
      }
      if (exp.kind === "local") {
        if (mod.byName.has(exp.name)) return resolveName(exp.name, mod, stack);
        // export { X } 里的 X 可能是 import 进来的（如 qrFindless 的 LEGAL_SIZES），
        // 必须改走 import 绑定；直接 resolveName(X) 会因同名再次进入 exports 分支被误判成环。
        if (mod.importBindings.has(exp.name)) name = exp.name;
        else return null;
      }
      if (exp.kind === "reexport") {
        const target = await loadRelative(exp.source, mod);
        if (!target) return null;
        const r = await resolveName(exp.imported, target, stack);
        if (r) { mod.deps.add(target); mod.exportSet.add(name); return r; }
        return null;
      }
    }

    const binding = mod.importBindings.get(name);
    if (binding) {
      if (binding.kind === "namespace") {
        warnings.push("未内联命名空间 import * as " + name + "（来自 " + binding.source + "）");
        missing.push(name);
        return null;
      }
      const target = await loadRelative(binding.source, mod);
      if (!target) { missing.push(name); return null; }
      const r = await resolveName(binding.imported, target, stack);
      if (r) {
        mod.deps.add(target);
        mod.aliases.set(name, r);
        return r;
      }
      missing.push(name);
      return null;
    }

    missing.push(name);
    return null;
  }

  async function includeDecl(decl, mod, stack) {
    if (!decl || mod.included.has(decl)) return;
    mod.included.add(decl);
    const locals = collectDeclaredNames(decl.text);
    const ids = collectIdentifiers(decl.text);
    if (!domWarned && DOM_NAMES.some((n) => ids.has(n))) {
      domWarned = true;
      warnings.push("该算法依赖浏览器 DOM/canvas，自定义实现 Worker 内可能无法运行；请优先使用内置 op");
    }
    for (const id of ids) {
      if (decl.names.includes(id) || locals.has(id)) continue;
      await resolveName(id, mod, stack);
    }
  }

  async function loadRelative(spec, fromMod) {
    if (!spec || typeof loadModule !== "function") return null;
    let url;
    try {
      url = new URL(spec, fromMod.url).href;
    } catch {
      warnings.push("无法解析 import 路径：" + spec);
      return null;
    }
    if (mods.has(url)) return mods.get(url);
    if (files.length >= maxFiles) {
      warnings.push("依赖文件数超过上限 " + maxFiles + "，已停止内联：" + spec);
      return null;
    }
    let loaded = null;
    try { loaded = await loadModule(url); } catch (e) {
      warnings.push("加载失败 " + spec + "：" + ((e && e.message) || String(e)));
      return null;
    }
    if (!loaded || typeof loaded.text !== "string") {
      warnings.push("加载失败 " + spec + "：无源码文本");
      return null;
    }
    return getModule(url, loaded.text);
  }

  // 入口：标识符 → 递归；内联表达式 → 合成一条根声明
  let entryRef = null;
  if (entry.kind === "expr" && /^[A-Za-z_$][\w$]*$/.test(entry.text)) {
    const r = await resolveName(entry.text, root);
    if (r && !r.global) entryRef = r.mod === root ? "__ebctf_mod_" + root.id + "." + r.localName
      : "__ebctf_mod_" + r.mod.id + "." + r.localName;
    else entryRef = entry.text;
  } else if (entry.kind === "expr") {
    const synth = "__ebctf_entry";
    const pseudo = {
      kind: "const", names: [synth], start: -1, end: -1,
      text: "const " + synth + " = " + entry.text + ";",
    };
    root.decls.push(pseudo);
    root.included.add(pseudo);
    root.exportSet.add(synth);
    const entryLocals = collectDeclaredNames(entry.text);
    for (const id of collectIdentifiers(entry.text)) {
      if (!entryLocals.has(id)) await resolveName(id, root);
    }
    entryRef = "__ebctf_mod_" + root.id + "." + synth;
  } else {
    const r = await resolveName(entry.text, root);
    if (!r) {
      return { ok: false, errors: ["入口函数 " + entry.text + " 未在源码中解析到声明"], warnings, missing };
    }
    if (r.global) entryRef = entry.text;
    else {
      root.deps.add(r.mod);
      entryRef = "__ebctf_mod_" + r.mod.id + "." + r.localName;
    }
  }

  // 依赖顺序：DFS 后序
  const order = [];
  const state = new Map();
  (function visit(m) {
    if (!m) return;
    if (state.get(m) === 2) return;
    if (state.get(m) === 1) { warnings.push("检测到循环 import，内联顺序可能不完整"); return; }
    state.set(m, 1);
    for (const dep of m.deps) visit(dep);
    state.set(m, 2);
    order.push(m);
  })(root);

  // 生成模块包装
  const parts = [];
  let totalChars = 0;
  let declCount = 0;
  for (const m of order) {
    const aliasLines = [];
    for (const [local, r] of m.aliases) {
      if (!r || r.global) continue;
      aliasLines.push("const " + local + " = __ebctf_mod_" + r.mod.id + "." + r.localName + ";");
    }
    const declTexts = m.decls.filter((d) => m.included.has(d)).map((d) => {
      let text = d.text;
      // 动态 import() 保留：按 2026-10-22 口径，用户自定义代码可主动使用网络能力外发。
      if (!text.includes("import.meta")) return text;
      if (!warnings.includes("import.meta 已替换为源文件 URL（wasm/动态资源可能仍不可用）")) {
        warnings.push("import.meta 已替换为源文件 URL（wasm/动态资源可能仍不可用）");
      }
      return text
        .replace(/import\.meta\.url/g, JSON.stringify(m.url))
        .replace(/\bimport\.meta\b/g, "({ url: " + JSON.stringify(m.url) + " })");
    });
    declCount += declTexts.length;
    const exportNames = [...m.exportSet].filter((n) => m.byName.has(n) || m.decls.some((d) => d.names.includes(n)));
    const body = aliasLines.concat(declTexts).join("\n\n");
    totalChars += body.length;
    if (totalChars > maxChars) {
      return {
        ok: false,
        errors: ["完整实现的依赖闭包超过 " + Math.round(maxChars / 1024) + " KB 上限（已收集 " + Math.round(totalChars / 1024) + " KB）。请改用「仅入口」模式，或手动内联所需 helper。"],
        warnings, missing,
      };
    }
    parts.push(
      "const __ebctf_mod_" + m.id + " = (() => {\n" +
      body + "\n" +
      "return { " + exportNames.map((n) => n + ": " + n).join(", ") + " };\n" +
      "})();"
    );
  }

  if (!entryRef) {
    return { ok: false, errors: ["入口解析失败（无法生成可调用引用）"], warnings, missing };
  }

  const warningsNote = warnings.length
    ? "\n// 未内联/需注意：" + warnings.slice(0, 8).join("；") + (warnings.length > 8 ? " …" : "")
    : "";
  const header = [
    "/* ══════════════════════════════════════════════════════════════",
    " * 完整实现（依赖闭包自动内联）· " + opId + " · " + entry.key,
    " * 来自 " + files.length + " 个源文件、" + declCount + " 个顶层声明。",
    " * 这是**源码快照**：上游修 bug / 改算法不会自动同步；",
    " * 需要最新版时点编辑器里的「同步上游」重新生成。",
    " * 可直接修改下面的任何函数/常量；参数仍从 params 读取。",
    warningsNote,
    " * ══════════════════════════════════════════════════════════════ */",
  ].filter(Boolean).join("\n");

  const tail = [
    "",
    "const __ebctf_params = Object.assign({}, params || {});",
    "if (rawBytes) {",
    "  __ebctf_params.rawBytes = rawBytes;",
    "  __ebctf_params.rawFileName = (params && params.rawFileName) || \"input.bin\";",
    "}",
    "return " + entryRef + "(input, __ebctf_params, __ebctf_params.rawBytes || null);",
  ].join("\n");

  return {
    ok: true,
    code: header + "\n\n" + parts.join("\n\n") + "\n" + tail + "\n",
    warnings,
    missing: [...new Set(missing)],
    files,
    entry: { key: entry.key, kind: entry.kind, text: entry.text },
    modules: order.length,
    decls: declCount,
    ...(opts && opts.debug ? {
      debug: order.map((m) => ({
        url: m.url,
        aliases: [...m.aliases.keys()],
        deps: [...m.deps].map((x) => x.url),
        included: m.decls.filter((d) => m.included.has(d)).map((d) => d.names.join("|")),
      })),
    } : {}),
  };
}

export default { parseModule, findEntry, collectIdentifiers, buildSourceBundle };
