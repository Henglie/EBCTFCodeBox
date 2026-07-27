/*
 * gen_modulepreload.mjs — T200 首屏 modulepreload 清单生成脚本（F2）。
 *
 * 用途：解析 src/main.js 的静态 import 链，生成首屏关键模块清单，
 *       供 MT31 在 index.html head 加 <link rel="modulepreload"> 压平加载瀑布。
 *
 * 用法：node tools/gen_modulepreload.mjs
 *       输出：tools/modulepreload_list.txt（每行一个相对 index.html 的模块路径）
 *       stdout：打印统计 + 示例 HTML 片段
 *
 * 原则：
 *   - 只读 src/main.js，不改任何源文件。
 *   - 只提取静态 import（`import ... from "..."` 和 `import "..."`），不提取动态 import（`await import(...)`）。
 *   - 路径转换：main.js 里的 `./core/xxx.js` → 相对 index.html 的 `src/core/xxx.js`。
 *   - 一次性脚本非构建工具，无依赖，纯 Node.js 标准库。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, resolve, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");
const MAIN_JS = join(PROJECT_ROOT, "src", "main.js");
const INDEX_HTML = join(PROJECT_ROOT, "index.html");
const OUT_FILE = join(__dirname, "modulepreload_list.txt");

if (!existsSync(MAIN_JS)) {
  console.error("找不到 src/main.js：" + MAIN_JS);
  process.exit(1);
}

const src = readFileSync(MAIN_JS, "utf8");
const lines = src.split("\n");

// 解析静态 import 语句，提取模块路径。
// 匹配两种形式：
//   1. import ... from "..."  （具名/默认导入，可能跨多行，但 main.js 都是单行）
//   2. import "..."            （副作用导入）
// 不匹配：
//   - await import("...")      （动态导入）
//   - // import "..."          （注释）
const IMPORT_RE = /^\s*import\s+(?:[^'"`;]+\s+from\s+)?["']([^"']+)["']/;

const mainDir = join(PROJECT_ROOT, "src"); // main.js 所在目录
const imported = []; // [{ raw: "./core/xxx.js", abs: 绝对路径, rel: "src/core/xxx.js" }]

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  // 跳过注释行（// 开头，允许前面有空白）
  const trimmed = line.trimStart();
  if (trimmed.startsWith("//")) continue;
  const m = line.match(IMPORT_RE);
  if (!m) continue;
  const raw = m[1];
  // 只处理相对路径（./ 或 ../），忽略 bare import（如 "katex"）
  if (!raw.startsWith(".") && !raw.startsWith("/")) continue;
  // 解析绝对路径
  const abs = resolve(mainDir, raw);
  // 补 .js 扩展名（如果路径无扩展名）
  const absJs = abs.endsWith(".js") ? abs : abs + ".js";
  // 转相对 index.html 的路径
  const rel = relative(dirname(INDEX_HTML), absJs).replace(/\\/g, "/");
  imported.push({ raw, rel, line: i + 1 });
}

// 去重（同一路径可能被 import 多次，虽然实际不会）
const seen = new Set();
const unique = [];
for (const item of imported) {
  if (seen.has(item.rel)) continue;
  seen.add(item.rel);
  unique.push(item);
}

// 输出清单文件
const listText = unique.map((u) => u.rel).join("\n") + "\n";
writeFileSync(OUT_FILE, listText, "utf8");

// 打印结果
console.log("=== T200 modulepreload 清单生成 ===");
console.log("解析文件: " + MAIN_JS);
console.log("总行数: " + lines.length);
console.log("静态 import 数: " + imported.length);
console.log("去重后: " + unique.length);
console.log("输出文件: " + OUT_FILE);
console.log("");
console.log("--- 清单（" + unique.length + " 条，相对 index.html）---");
for (const u of unique) {
  console.log("  " + u.rel + "  (L" + u.line + ": " + u.raw + ")");
}

// 生成示例 HTML 片段（供 MT31 直接复制到 index.html head）
console.log("");
console.log("--- 示例 HTML 片段（粘贴到 index.html <head>）---");
const htmlLines = unique.map((u) => `  <link rel="modulepreload" href="${u.rel}">`);
console.log(htmlLines.join("\n"));

// 按目录分组统计
console.log("");
console.log("--- 目录分布 ---");
const dirStat = {};
for (const u of unique) {
  const dir = u.rel.startsWith("src/core/") ? "src/core" :
              u.rel.startsWith("src/ui/") ? "src/ui" :
              u.rel.startsWith("src/i18n/") ? "src/i18n" :
              u.rel.startsWith("src/core/magic/") ? "src/core/magic" :
              u.rel.startsWith("src/core/edu/") ? "src/core/edu" :
              "其他";
  dirStat[dir] = (dirStat[dir] || 0) + 1;
}
for (const [dir, count] of Object.entries(dirStat).sort((a, b) => b[1] - a[1])) {
  console.log("  " + dir.padEnd(20) + " " + count);
}

console.log("");
console.log("完成。清单已写入: " + OUT_FILE);
console.log("MT31 用法：将上述 HTML 片段粘贴到 index.html <head> 的 <script type=\"module\" src=\"src/main.js\"> 之前。");
