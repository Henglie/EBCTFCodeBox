import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "src");
const core = join(src, "core");
const main = join(src, "main.js");
const readmePath = join(root, "README.md");
const { OPS, CATEGORIES } = await import(pathToFileURL(join(core, "registry.js")).href);

function importsOf(code) {
  const specs = new Set();
  for (const re of [/\bfrom\s*["']([^"']+)["']/g, /\bimport\s*["']([^"']+)["']/g]) {
    let match;
    while ((match = re.exec(code))) specs.add(match[1]);
  }
  return [...specs].filter((spec) => spec.startsWith("./") || spec.startsWith("../"));
}

function resolveImport(from, spec) {
  const path = resolve(dirname(from), spec);
  if (existsSync(path) && statSync(path).isFile()) return path.endsWith(".js") ? path : null;
  return !path.endsWith(".js") && existsSync(path + ".js") ? path + ".js" : null;
}

const seen = new Set([main]);
const stack = [main];
const closure = [];
while (stack.length) {
  const file = stack.pop();
  let code;
  try { code = readFileSync(file, "utf8"); } catch { continue; }
  if (file.startsWith(core + sep)) closure.push(file);
  for (const spec of importsOf(code)) {
    const target = resolveImport(file, spec);
    if (target && !seen.has(target)) {
      seen.add(target);
      stack.push(target);
    }
  }
}

for (const file of closure.sort()) await import(pathToFileURL(file).href);

const clean = (value) => String(value || "")
  .replaceAll("|", "\\|")
  .replace(/\s+/g, " ")
  .trim();
const categories = CATEGORIES.filter((cat) => cat.id !== "home");
const lines = [
  `## 编解码全清单（${OPS.length} ops · ${categories.length} 分类）`,
  "",
  "> 本节由 `node tools/gen_readme_ops.mjs` 从主入口真实 import 闭包生成；opId 即注册表唯一标识。",
  "",
];
for (const cat of categories) {
  const ops = OPS.filter((op) => op.cat === cat.id);
  lines.push(`### ${clean(cat.name)}（${ops.length} ops）`, "", "| opId | 名称 | 说明 |", "|---|---|---|");
  for (const op of ops) lines.push(`| ${clean(op.id)} | ${clean(op.name || op.id)} | ${clean(op.desc)} |`);
  lines.push("");
}

let readme = readFileSync(readmePath, "utf8");
const start = readme.indexOf("## 编解码全清单");
const end = readme.indexOf("## 插件与 AI 接入", start);
if (start < 0 || end < 0) throw new Error("README 清单边界不存在");
readme = readme.slice(0, start) + lines.join("\n") + "\n" + readme.slice(end);
readme = readme.replace(/- \[编解码全清单\]\([^\n]+\)/, `- [编解码全清单](#编解码全清单${OPS.length}-ops--${categories.length}-分类)`);
writeFileSync(readmePath, readme);
console.log(`README.md: ${OPS.length} ops / ${categories.length} categories`);
