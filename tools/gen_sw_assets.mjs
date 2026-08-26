import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { extname } from "node:path";
import { execFileSync } from "node:child_process";

const runtimeExts = new Set([
  ".js", ".css", ".json", ".wasm", ".woff2", ".png", ".webp",
  ".jpg", ".svg", ".ico", ".txt", ".bin", ".dat",
]);

// --cached：已跟踪文件；--others --exclude-standard：尚未 git add 但不被 .gitignore 忽略的新文件。
// ⚠ 只用 --cached（默认）会漏掉「已写盘但还没提交」的新模块——而 main.js 是**静态 import**
//   它们的，漏进清单 = 离线时 main.js 直接加载失败 = 整个 PWA 打不开（不是少个功能而已）。
//   2026-08-23 实测漏了 radixAll/progCalc/unitConv 三个，故改成 cached ∪ others。
const tracked = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "src", "public"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((file) => runtimeExts.has(extname(file).toLowerCase()))
  .sort();

// ---------------------------------------------------------------------------
// H1 按需资产瘦身（2026-08-26，审计-性能 H1/M4）：以下资产在 UI 里本来就是懒加载
// （点按钮 / 切语言 / 打开对应功能才发请求），不再进 SW 预缓存——预缓存从 59.98MB 降到
// <10MB，每次发版（ASSET_REV 变）老用户不再全量重下。运行时由 sw.js fetch handler
// 「网络 → 回填缓存 → 之后 cache-first」兜底：在线用过一次即离线可用。
//
// ⚠ 剔除原则：只剔「运行时才 fetch / 动态 import 且有降级或可延迟」的资产；
//   main.js 静态 import 链上的文件一个都不能剔（剔了 = 离线白屏）。
//   清单变动时必跑：node 工具/rt_browser_ids.mjs（⑤ 断网段验证回填生效）。
// ---------------------------------------------------------------------------
const EXCLUDE_RULES = [
  // 天珩全量四平面 th-p0/p1/p2/p16（envPanel 点按钮才 loadFontPlane；正则不匹配首屏子集
  // th-ctf-subset.woff2 —— 它被 fonts.css @font-face 直接引用，必须留在预缓存）
  [/^public\/fonts\/th\/th-p\d+\.woff2$/, "天珩全量字库平面（懒 loadFontPlane）"],
  // WASM 引擎 + emscripten glue：7zz/bkcrack/asm/disasm，打开对应功能才动态 import；
  // 缺失均优雅降级（提示放置文件 / 纯 JS 兜底）。License.txt 等小文本保留。
  [/^public\/wasm\/.*\.(wasm|js)$/, "WASM 引擎与 glue（按功能懒加载）"],
  // 拼字/IDS 索引：进拼字 tab 才 fetch（universalViewer.js loadIdsIndex）
  [/^public\/data\/ids\.dat$/, "ids.dat（拼字 tab 才 fetch）"],
  // 编码对照图：点击查看才加载；codeImageManifest.json 很小且进 tab 就要，保留
  [/^public\/codeimages\/.*\.(png|webp|jpe?g|svg|gif|avif)$/, "codeimages 对照图（点击才加载）"],
  // KaTeX：真·懒加载（katexLoader.js 单例 Promise，首次公式渲染才插 script/link；缺失降级为
  // 原始 TeX 文本 <code class="katex-fallback">，不白屏）
  [/^public\/vendor\/katex\//, "KaTeX dist（首次公式渲染才加载）"],
  // 语言包：i18n/index.js 仅静态 import zh/en（zh.js/en.js 在 locales/ 目录外），
  // 其余语言全部动态 import(`./locales/${loc}.js`)（i18n/index.js:119），切换语言才加载
  [/^src\/i18n\/locales\//, "i18n 语言包（切语言才动态 import）"],
  // 英文科普层：main.js:3168 动态 import("./core/eduContent.en.js")，edu-en/ 63 分片全挂其下
  [/^src\/core\/(eduContent\.en\.js|edu-en\/)$|^src\/core\/edu-en\//, "英文 EDU 科普层（切英文才动态 import）"],
  // 关于页素材：logo.webp / contributors 头像均为 loading:"lazy" 的 <img>；
  // icons/logo.png 供 README/介绍文章 头图（仅文档引用，运行时不请求；
  // 2026-08-27 双副本合并：public/logo.png 已删，只留 icons/ 份）；
  // favicon.ico 无 link 引用（index.html 只引 app-icon-*，浏览器自动请求兜底）
  [/^public\/logo\.webp$/, "关于页 logo.webp（lazy img）"],
  [/^public\/icons\/logo\.png$/, "icons/logo.png（README 头图，运行时不请求）"],
  [/^public\/favicon\.ico$/, "favicon.ico（无 link 引用）"],
  [/^public\/contributors\//, "贡献者头像（关于页 lazy img）"],
  // magic 字节统计 CNN 权重：一键解码触发时才 fetch（byteStatCnn.js loadByteStatWeights），
  // 失败静默降级为纯规则打分
  [/^public\/models\//, "byteStat CNN 权重（一键解码才 fetch）"],
];
const isExcluded = (file) => EXCLUDE_RULES.find(([re]) => re.test(file));

const kept = tracked.filter((file) => !isExcluded(file));
const dropped = tracked.filter(isExcluded);

const assets = ["./", "./index.html", "./manifest.json", "./sw.js", "./sw-assets.js"]
  .concat(kept.map((file) => `./${file.replaceAll("\\", "/")}`));

const hash = createHash("sha256");
for (const file of ["index.html", "manifest.json", "sw.js", ...kept]) {
  hash.update(file);
  hash.update(await readFile(file));
}
const revision = hash.digest("hex").slice(0, 16);
const source = `self.__EBCTF_ASSET_REV = ${JSON.stringify(revision)};\nself.__EBCTF_ASSETS = ${JSON.stringify(assets, null, 2)};\n`;
await writeFile("sw-assets.js", source);
console.log(`sw-assets.js: ${assets.length} files, revision ${revision}`);
console.log(`按需资产剔除 ${dropped.length} 项（运行时回填 + cache-first 兜底）:`);
const byReason = new Map();
for (const file of dropped) {
  const reason = isExcluded(file)[1];
  byReason.set(reason, (byReason.get(reason) || 0) + 1);
}
for (const [reason, n] of byReason) console.log(`  - ${reason}: ${n} 项`);
