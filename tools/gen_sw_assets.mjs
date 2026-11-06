import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { extname, join } from "node:path";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import { PACKS } from "../src/core/offlinePacks.js";

const execFileAsync = promisify(execFile);

// git ls-files 通道：优先同步；当环境阻断 spawnSync（Windows 下曾现 EBUSY，pid=0）时
// 降级异步 execFile——同一命令、同一输出，仅进程创建通道不同。
async function gitLsFiles() {
  const args = ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "src", "public"];
  try {
    return execFileSync("git", args, { encoding: "utf8" });
  } catch (err) {
    const spawnBlocked = err && err.code === "EBUSY" && err.pid === 0;
    if (!spawnBlocked) throw err; // git 真实失败（非零退出）不降级，照常抛
    const { stdout } = await execFileAsync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    return stdout;
  }
}

const runtimeExts = new Set([
  ".js", ".mjs", ".css", ".json", ".wasm", ".woff2", ".png", ".webp",
  ".jpg", ".svg", ".ico", ".txt", ".bin", ".dat", ".tsv",
]);

// --cached：已跟踪文件；--others --exclude-standard：尚未 git add 但不被 .gitignore 忽略的新文件。
// ⚠ 只用 --cached（默认）会漏掉「已写盘但还没提交」的新模块——而 main.js 是**静态 import**
//   它们的，漏进清单 = 离线时 main.js 直接加载失败 = 整个 PWA 打不开（不是少个功能而已）。
//   2026-08-23 实测漏了 radixAll/progCalc/unitConv 三个，故改成 cached ∪ others。
const tracked = (await gitLsFiles())
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
  // 编码图 A0 槽位布局 sidecar（T774）：打开编码图页才 fetch；
  // 不进首屏预缓存。运行时由 sw.js 的 "/public/data/" 前缀回填（在线用过一次即离线可用）。
  [/^public\/data\/codeimage\/codeImageLayout\.bin$/, "codeImageLayout.bin（编码图页才加载）"],
  // KaTeX：真·懒加载（katexLoader.js 单例 Promise，首次公式渲染才插 script/link；缺失降级为
  // 原始 TeX 文本 <code class="katex-fallback">，不白屏）
  [/^public\/vendor\/katex\//, "KaTeX dist（首次公式渲染才加载）"],
  [/^public\/vendor\/ocr\//, "OCR 引擎/语言模型（离线包，按需安装）"],
  // 编辑器 / PGP / 条码内核：三者都是「打开对应功能才 dynamic import」
  // （customImplEditor.js / pgp.js / barcodeGen.js），缺失时各自降级或显式报错。
  // 首次在线使用后由 SW runtime cache 回填，此后离线可用——与 sw.js 的
  // RUNTIME_CACHE_FIRST "/src/vendor/" 两处保持同步。两份许可 .txt 仍留预缓存。
  [/^src\/vendor\/(codemirror\.bundle\.js|openpgp\.min\.js|bwip-js\.js|bwipp\.js)$/, "编辑器/PGP/条码内核（按功能懒加载）"],
  // CyberChef vendor 引擎（T819/T820）：CSS/JS/SQL/XPath 解析与 jq/YARA 均为打开对应
  // op 才 dynamic import；不进首屏预缓存，首次在线使用后由 SW runtime cache 回填。
  [/^src\/vendor\/(t819\/|jq-web\/|libyara-wasm\/).*\.mjs$/, "CyberChef vendor 引擎（按功能懒加载）"],
  // 官方插件包（dCode 补全集等）：随发行包分发但默认不启用，用户在插件面板
  // 显式加载时才动态 import。首次在线加载后由 SW runtime cache 回填——
  // 与 sw.js 的 RUNTIME_CACHE_FIRST "/addons/" 两处保持同步。
  [/^addons\//, "官方插件包（默认不启用，用户显式加载）"],
  // 语言包：i18n/index.js 仅静态 import zh；en 已改按需 dynamic import（ensureLoaded/_loadEn，
  // boot 后 warmEnglish 空闲预热），仍留预缓存保离线切换；其余语言同上下文动态加载
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

// ---------------------------------------------------------------------------
// T709 离线增强包清单：条目与 src/core/offlinePacks.js 的 PACKS 完全一致。
// rev = 包内 (name + "\0" + bytes) 逐条拼接后的 sha256 前 8 位；缓存名带 rev，
// 条目一变旧包缓存即失效。包条目不在预缓存清单里，只在用户点安装时由 SW 下载。
// ---------------------------------------------------------------------------
const packRev = (p) => {
  const h = createHash("sha256");
  for (const e of p.entries) {
    h.update(e.name);
    h.update("\0");
    h.update(String(e.bytes));
  }
  return h.digest("hex").slice(0, 8);
};
const packsOut = PACKS.map((p) => ({
  id: p.id,
  rev: packRev(p),
  bytes: p.bytes,
  entries: p.entries.map((e) => e.name),
}));
const packsSource = `self.__EBCTF_PACK_REV = ${JSON.stringify(packsOut.map((p) => p.id + ":" + p.rev).join(","))};\n`
  + `self.__EBCTF_PACKS = ${JSON.stringify(packsOut, null, 2)};\n`;

// ① 包条目不得留在预缓存清单里（漏剔 = 首屏回涨 44MB）
const leaked = PACKS.flatMap((p) => p.entries.map((e) => e.name.slice(1)))
  .filter((file) => !isExcluded(file));
if (leaked.length) {
  throw new Error(`离线包条目仍在预缓存清单（EXCLUDE_RULES 失配）：${leaked.join(", ")}`);
}
// ② 声明字节必须等于磁盘实际（防止资产更新后 PACKS 数字过期）
for (const p of PACKS) {
  for (const e of p.entries) {
    const actual = statSync(join(process.cwd(), e.name.slice(1))).size;
    if (actual !== e.bytes) {
      throw new Error(`离线包体积漂移：${e.name} 声明 ${e.bytes}，实际 ${actual}（请重跑 collect_packs.mjs 并更新 PACKS）`);
    }
  }
}

const assets = ["./", "./index.html", "./manifest.json", "./sw.js", "./sw-assets.js", "./sw-packs.js"]
  .concat(kept.map((file) => `./${file.replaceAll("\\", "/")}`));

const hash = createHash("sha256");
const swSource = await readFile("sw.js", "utf8");
// Exclude the generated stamp from its own digest so regeneration is idempotent.
const swWithoutStamp = swSource.replace(/^\/\/ BUILD-STAMP:.*\r?\n/m, "");
for (const file of ["index.html", "manifest.json", "sw.js", ...kept]) {
  hash.update(file);
  hash.update(file === "sw.js" ? swWithoutStamp : await readFile(file));
}
// 按需资产（EXCLUDE_RULES）不进预缓存，但**必须进 revision**：否则 WASM/KaTeX/语言包
// 更新后 ASSET_REV 不变，老用户 SW 不会换缓存名，按需资产会一直命中旧缓存（安全审计 2026-10）。
// 只哈希内容、不加入 assets 清单，预缓存体积不变。
for (const file of dropped) {
  hash.update(file);
  hash.update(await readFile(file));
}
// sw-packs.js 以本轮内存内容入哈希，而不是磁盘上一轮的旧文件：
// 否则「只改 PACKS 不改其它资产」时 ASSET_REV 不变，SW 不会更新，清单停在旧内容。
hash.update("sw-packs.js");
hash.update(packsSource);
const revision = hash.digest("hex").slice(0, 16);
const source = `self.__EBCTF_ASSET_REV = ${JSON.stringify(revision)};\nself.__EBCTF_ASSETS = ${JSON.stringify(assets, null, 2)};\n`;
await writeFile("sw-packs.js", packsSource);
await writeFile("sw-assets.js", source);
await writeFile("sw.js", `// BUILD-STAMP: ${revision}\n${swWithoutStamp}`);
console.log(`sw-assets.js: ${assets.length} files, revision ${revision}`);
console.log(`sw-packs.js: ${packsOut.map((p) => `${p.id}@${p.rev} (${p.entries.length})`).join(", ")}`);
console.log(`按需资产剔除 ${dropped.length} 项（运行时回填 + cache-first 兜底）:`);
const byReason = new Map();
for (const file of dropped) {
  const reason = isExcluded(file)[1];
  byReason.set(reason, (byReason.get(reason) || 0) + 1);
}
for (const [reason, n] of byReason) console.log(`  - ${reason}: ${n} 项`);
