/*
 * T525 补缺：CSP 闭包扫描（MV3 extension_pages 硬阻断检测）
 *
 * 为什么需要：目录入选规则只看 `cat/方向/ioKind` **不足以**证明 CSP-safe。
 * 反例：`jsfuck` 被 MT524A 拆到独立 `src/core/jsfuck.js` 后，cat 仍是 `text`，
 * 按分类规则会进目录，但它用 `new Function` —— MV3 `script-src 'self'` 下必然抛 EvalError。
 * 故必须在分类过滤之上再叠一层「**闭包内无 CSP 硬阻断**」。
 *
 * 口径：HARD = 在**去注释去字符串后**的代码里出现的
 *   new Function( / eval( / Function( 直接调用 / 动态 import(
 * 只跟**相对路径**静态 import 递归求闭包；裸模块说明符单独记录（本产品闭包内应为空）。
 */
import fs from "node:fs";
import path from "node:path";

const IMPORT_RE = /^[ \t]*import\s+(?!\.)(?:[^"'`]*?\bfrom\s*)?["']([^"']+)["']/gm;

/** MV3 CSP 硬阻断构造（代码层面）。 */
export const HARD_RISKS = [
  { id: "new Function()", re: /\bnew\s+Function\s*\(/ },
  { id: "eval()", re: /(^|[^.\w$])eval\s*\(/ },
  { id: "Function() 直接调用", re: /(^|[^.\w$])Function\s*\(/ },
  { id: "动态 import()", re: /\bimport\s*\(\s*[^"')\s]/ },
];

/**
 * 去掉注释与字符串字面量，只留「代码」。
 * 目的：避免把注释/字符串里的 "new Function(" 误判为硬阻断。
 * 用空格等长替换以保留列结构（便于报行号）。
 */
export function codeOnly(src) {
  const out = [];
  const n = src.length;
  let i = 0;
  const blank = (s) => " ".repeat(s.length);
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { let j = i; while (j < n && src[j] !== "\n") j++; out.push(blank(src.slice(i, j))); i = j; continue; }
    if (c === "/" && d === "*") { let j = i + 2; while (j < n && !(src[j] === "*" && src[j + 1] === "/")) j++; j = Math.min(n, j + 2); out.push(blank(src.slice(i, j))); i = j; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; let j = i + 1;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === q) { j++; break; }
        j++;
      }
      out.push(blank(src.slice(i, j)));
      i = j;
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** 从入口文件出发递归求静态相对 import 闭包。返回 { files:Set<abs>, bare:Set<string> }。 */
export function closureOf(entryAbs) {
  const files = new Set();
  const bare = new Set();
  const walk = (abs) => {
    const key = path.normalize(abs);
    if (files.has(key) || !fs.existsSync(key)) return;
    files.add(key);
    const src = fs.readFileSync(key, "utf8");
    let m;
    IMPORT_RE.lastIndex = 0;
    while ((m = IMPORT_RE.exec(src))) {
      const spec = m[1];
      if (spec.startsWith("./") || spec.startsWith("../")) walk(path.resolve(path.dirname(key), spec));
      else bare.add(spec);
    }
  };
  walk(entryAbs);
  return { files, bare };
}

/**
 * 扫描入口文件闭包内的 CSP 硬阻断。
 * @returns {{ ok:boolean, hits:Array<{file:string,line:number,risk:string,text:string}>, files:string[], bare:string[] }}
 */
export function scanClosureCsp(entryAbs) {
  const { files, bare } = closureOf(entryAbs);
  const hits = [];
  for (const f of files) {
    const code = codeOnly(fs.readFileSync(f, "utf8"));
    const lines = code.split(/\r?\n/);
    lines.forEach((ln, idx) => {
      // `new Function(` 已覆盖同一行的裸 `Function(`，避免重复计一条
      const isNewFunction = HARD_RISKS[0].re.test(ln);
      for (const r of HARD_RISKS) {
        if (r.id === "Function() 直接调用" && isNewFunction) continue;
        if (r.re.test(ln)) hits.push({ file: path.basename(f), line: idx + 1, risk: r.id, text: ln.trim().slice(0, 90) });
      }
    });
  }
  return { ok: hits.length === 0, hits, files: [...files].sort(), bare: [...bare].sort() };
}
