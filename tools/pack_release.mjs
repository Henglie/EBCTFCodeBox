#!/usr/bin/env node
/*
 * pack_release.mjs — 发行包打包 stage / 清单校验 verify / 版本交叉校验 version。
 *
 * v0.1.4 事故背景：RAR 打包件漏了 tools/ 目录（bridge.py 的 EXE_BASE）已流出。
 * 从 v0.1.5 起打包清单定死，本脚本就是那道闸门。
 *
 * ⚠ 清单唯一事实源：PROGRESS.md「📦 发行包文件清单 v0.1.5」表。
 *   改本文件的 INCLUDE_FILES / INCLUDE_DIRS / DIR_EXCLUDE / CHANNELS
 *   必须同步改 PROGRESS 那张表（反向亦然）——两边任何一边单改都是事故隐患。
 *
 * 用法：
 *   node tools/pack_release.mjs stage [--channel <渠道名>]
 *       按白名单复制到 <项目外>/_release_stage_<版本>/，产 _manifest.txt。
 *       不做 RAR 压缩（不依赖 WinRAR/三方库）：stage 只出待打包目录，
 *       由恒烈右键打包。--channel X 时从 授权/成品授权/license.bin X 取
 *       已签产物重命名为 license.bin 放包根；不传则不带 license.bin 并提示。
 *   node tools/pack_release.mjs verify <目录> [--channel <渠道名>]
 *       拿已解包的发行包目录逐条比对白名单（缺失/多余均 fail，exit 非 0），
 *       顺带跑包内版本号六处交叉校验 + 渠道校验（解 license.bin payload 的
 *       source 字段与 --channel 比对，防打错渠道；Web Crypto 验签）。
 *   node tools/pack_release.mjs version
 *       对项目根跑六处版本号交叉校验。
 *
 * 渠道表（授权/成品授权/ 文件名 → payload.source 应含的关键字）：
 *   source 实测值见 CHANNELS 注释。L站 的 source 是「LinuxDO社区（linux.do）」，
 *   含「L站」两字比对不上，必须走关键字映射，不能拿渠道名硬 contains。
 *
 * 退出码：0 = 通过；1 = 校验失败（缺失/多余/版本不一致/渠道不符）；
 *         2 = 用法/环境错误（参数错、白名单目录缺失、渠道文件缺失）。
 */
import { fileURLToPath } from "node:url";
import {
  readdirSync,
  statSync,
  existsSync,
  readFileSync,
  copyFileSync,
  mkdirSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";

// ---- 定位项目根。本文件路径含中文，必须 fileURLToPath 解码
// （直接取 import.meta.url 的 pathname 会留 percent-encode + 前导 /，
//  照 工具/rt_t185_opcount.mjs 修过的同款盘符 footgun）----
const HERE = dirname(fileURLToPath(import.meta.url)); // <root>/tools
const ROOT = dirname(HERE);

// ==================== 白名单（照 PROGRESS「📦 发行包文件清单 v0.1.5」表抄） ====================

// 根级单文件（✅ 必带，license.bin 除外——它按渠道动态加，见 CHANNELS）
const INCLUDE_FILES = [
  "index.html",
  "manifest.json",
  "sw.js",
  "sw-assets.js",
  "README.md",
  "CHANGELOG.md",
  "LICENSE",
  "点我启动.py",
  "bridge.py",
  "HenglieICO.png",
];

// 整目录递归（src 含 core/ui/i18n/plugin/main.js；public 含 fonts/th 五个 woff2
// 约 33 MB 首屏子集 + 四平面，缺一个就有豆腐块，必须全量带；tools 打包时只带
// exe/ —— bridge.py 的 EXE_BASE，v0.1.4 漏的就是它，构建脚本由 DIR_EXCLUDE 剔除）
const INCLUDE_DIRS = ["src", "public", "tools", "mcp", "skills"];

// 白名单目录内部的清扫（PROGRESS 表明确排除项）。
// rel 为相对项目根的 posix 路径（目录本身也会被问询，rel 形如 "src" / ""）。
const DIR_EXCLUDE = (rel) =>
  rel.split("/").includes("__pycache__") || rel.endsWith(".pyc") ||
  // tools/ 在发行包里只带 exe/（bridge.py 的 EXE_BASE，运行时必需）。
  // 构建期脚本（subset_fonts.py 字体切分 / build_bkcrack.* / gen_*.mjs /
  // modulepreload_list.txt / pack_release.mjs 本体）只留 git 仓库供复现构建，
  // 不进成品包（2026-08-26 恒烈指出：字体切分等构建脚本不该混进发行包）。
  // 注意 rel !== "tools" —— 目录本身必须放行，否则 exe/ 整个被丢掉。
  (rel.startsWith("tools/") && rel !== "tools" && !rel.startsWith("tools/exe"));

// ==================== 渠道表（PROGRESS「🔑 分渠道打包」段） ====================
// 键 = 授权/成品授权/ 里的文件名后缀（"license.bin <键>"）；值 = payload.source
// 必须包含的关键字。实测 source（2026-08-23）：
//   吾爱破解 → "吾爱破解论坛（www.52pojie.cn）"   看雪论坛 → "看雪论坛（bbs.pediy.com）"
//   L站     → "LinuxDO社区（linux.do）"           CSDN    → "CSDN社区（www.csdn.net/）"
//   恒烈的小窝 → "恒烈的小窝（eb.xbdqwq.com）"
const CHANNELS = {
  "吾爱破解": "吾爱破解",
  "看雪论坛": "看雪",
  "L站": "LinuxDO",
  "CSDN": "CSDN",
  "恒烈的小窝": "恒烈的小窝",
};
const LICENSE_DIR = join(ROOT, "授权", "成品授权");

// ==================== 硬编码禁止项（误配置也不能漏出去） ====================
// 白名单本身不含这些，但按任务卡要求复制前做二次断言：展开后的清单里
// 若出现下列任何前缀，说明白名单被人改坏，立即中止。
const FORBIDDEN_PREFIXES = [
  "授权/",
  "工具/",
  "资料/",
  "介绍图片/",
  "PROGRESS.md",
  "多Agent协作.md",
  "介绍文章.md",
];
// 授权工程文件名（出现在白名单里任何位置都不行，双保险）
const FORBIDDEN_NAMES = ["private_key.enc", "keygen.mjs", "sign.mjs", "encrypt_key.mjs"];

// 打包器自身产物，verify 比对时豁免（stage 目录/发行包里合法存在，不算多余）
const SELF_ARTIFACT = "_manifest.txt";

// license.bin 内嵌公钥（与 src/core/license.js 同一把，SPKI DER base64，ECDSA P-256）
const PUBLIC_KEY_B64 =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEkOkYdb4i7EAZ1KukarDW12eqfLQf1S18MlgIqVp7H7jqOJdZotjIigSMYPDtvSJdYdydRwfpFXXJ273987Ke3w==";

// ==================== 版本号六处（version / verify 共用） ====================
// [文件, 提取正则]；正则第一捕获组 = 版本号。
const VERSION_SOURCES = [
  ["src/core/version.js", /APP_VERSION\s*=\s*"([^"]+)"/],
  ["sw.js", /APP_VERSION\s*=\s*"([^"]+)"/],
  ["index.html", /id="appVer">v([\d.]+)</],
  ["README.md", /当前版本\s*\*\*v([\d.]+)\*\*/],
  ["CHANGELOG.md", /^## v([\d.]+)/m],
  ["mcp/README.md", /server 版本 `([\d.]+)`/],
];

// ==================== 基础工具 ====================
const toPosix = (p) => p.split(sep).join("/");

function walkFiles(dir, base = dir, out = new Set()) {
  // 递归列出 dir 下全部文件的 posix 相对路径（不含目录本身）
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, base, out);
    else out.add(toPosix(relative(base, p)));
  }
  return out;
}

function readVersion(root) {
  // 六处版本号实测 → [{ file, ver } | { file, err }]；另有 allSame / value
  const rows = VERSION_SOURCES.map(([file, re]) => {
    const full = join(root, file);
    if (!existsSync(full)) return { file, err: "文件不存在" };
    const m = readFileSync(full, "utf8").match(re);
    if (!m) return { file, err: "未匹配到版本号" };
    return { file, ver: m[1] };
  });
  const vers = rows.filter((r) => r.ver).map((r) => r.ver);
  const allSame = vers.length === VERSION_SOURCES.length && new Set(vers).size === 1;
  return { rows, allSame, value: allSame ? vers[0] : null };
}

function assertIncludeClean(files) {
  // 复制前二次断言：白名单展开结果里不得出现任何禁止项
  for (const f of files) {
    if (FORBIDDEN_PREFIXES.some((p) => f === p.slice(0, -1) || f.startsWith(p))) {
      throw new Error(`白名单被改坏：出现禁止项 ${f}（授权工程/内部文档永不打包）`);
    }
    if (FORBIDDEN_NAMES.some((n) => f === n || f.endsWith("/" + n))) {
      throw new Error(`白名单被改坏：出现授权工程文件 ${f}`);
    }
  }
}

function listIncludeFiles(channel) {
  // 展开白名单 → 排序后的 posix 相对路径数组（channel 非空时含 license.bin）
  const files = [...INCLUDE_FILES];
  for (const d of INCLUDE_DIRS) {
    const dp = join(ROOT, d);
    if (!existsSync(dp)) throw new Error(`白名单目录不存在：${d}/（清单表与实际项目不符）`);
    for (const f of walkFiles(dp)) {
      const rel = `${d}/${f}`;
      if (!DIR_EXCLUDE(rel)) files.push(rel);
    }
  }
  if (channel) files.push("license.bin");
  assertIncludeClean(files);
  return files.sort();
}

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + " MB";
}

// ==================== license.bin 读取 + Web Crypto 验签 ====================
function b64urlToBuf(s) {
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return Buffer.from(b64, "base64");
}

async function readLicense(dir) {
  // 读 dir/license.bin → { missing } | { corrupt, why } | { verified, source, licensedTo }
  // 验签逻辑与 src/core/license.js 一致（ECDSA P-256 / SHA-256，对 payload 原文字节验）。
  const file = join(dir, "license.bin");
  if (!existsSync(file)) return { missing: true };
  let text;
  try {
    text = readFileSync(file, "utf8").trim();
  } catch (e) {
    return { corrupt: true, why: `读取失败：${e.message}` };
  }
  const dot = text.indexOf(".");
  if (dot < 0) return { corrupt: true, why: "非 bin 格式（无 '.' 分隔）" };
  const payloadBytes = b64urlToBuf(text.slice(0, dot));
  const sigBytes = b64urlToBuf(text.slice(dot + 1));
  try {
    const key = await crypto.subtle.importKey(
      "spki",
      Buffer.from(PUBLIC_KEY_B64, "base64"),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sigBytes,
      payloadBytes,
    );
    if (!ok) return { corrupt: true, why: "验签失败（被篡改或损坏）" };
  } catch (e) {
    return { corrupt: true, why: `验签异常：${e.message}` };
  }
  try {
    const payload = JSON.parse(payloadBytes.toString("utf8"));
    return { verified: true, source: payload.source || "", licensedTo: payload.licensedTo || null };
  } catch (e) {
    return { corrupt: true, why: "payload JSON 解析失败" };
  }
}

// ==================== 子命令：version ====================
function cmdVersion() {
  const { rows, allSame, value } = readVersion(ROOT);
  console.log("版本号六处交叉校验（项目根）");
  for (const r of rows) {
    console.log(`  ${r.file.padEnd(22)} ${r.err ? "!! " + r.err : r.ver}`);
  }
  if (allSame) {
    console.log(`\n✓ 六处一致：${value}`);
    return 0;
  }
  console.log("\n× 六处不一致，禁止发布（改版本只动 version.js 和 sw.js，其余四处随发布流程同步）");
  return 1;
}

// ==================== 子命令：stage ====================
function cmdStage(channel) {
  const ver = readVersion(ROOT);
  if (!ver.allSame) {
    console.error("× 项目根版本号六处不一致，先跑 version 子命令处理，拒绝打包：");
    for (const r of ver.rows) console.error(`    ${r.file} ${r.err ?? r.ver}`);
    return 2;
  }
  const version = ver.value;
  const outRoot = dirname(ROOT);
  const stageDir = join(outRoot, `_release_stage_${version}`);
  if (existsSync(stageDir)) {
    console.error(`× stage 目录已存在：${stageDir}`);
    console.error("  为防旧产物混入造成假「多余」，不自动覆盖。请确认后手动删除再跑。");
    return 2;
  }

  const include = listIncludeFiles(channel);
  console.log(`stage → ${stageDir}`);
  console.log(`版本 ${version}${channel ? ` / 渠道 ${channel}` : " / 无渠道（不带 license.bin）"}`);

  mkdirSync(stageDir, { recursive: true });

  // 根级单文件
  for (const f of INCLUDE_FILES) copyFileSync(join(ROOT, f), join(stageDir, f));

  // 整目录（filter 同步排除 __pycache__ / *.pyc，与 listIncludeFiles 一套规则）
  for (const d of INCLUDE_DIRS) {
    cpSync(join(ROOT, d), join(stageDir, d), {
      recursive: true,
      filter: (src) => !DIR_EXCLUDE(toPosix(relative(ROOT, src))),
    });
  }

  // license.bin：按渠道取已签产物（唯一允许从 授权/ 出来的路径）
  if (channel) {
    const src = join(LICENSE_DIR, `license.bin ${channel}`);
    if (!existsSync(src)) {
      console.error(`× 渠道授权产物缺失：${toPosix(relative(ROOT, src))}`);
      console.error(`  可用：${readdirSync(LICENSE_DIR).join(" / ")}`);
      return 2;
    }
    // 二次断言：license 来源必须在 授权/成品授权/ 之内
    const rel = toPosix(relative(ROOT, src));
    if (!rel.startsWith("授权/成品授权/")) {
      console.error(`× license 来源路径断言失败：${rel}`);
      return 2;
    }
    copyFileSync(src, join(stageDir, "license.bin"));
    console.log(`license.bin ← ${rel}（已重命名放包根）`);
  } else {
    console.log("提示：未包含 license.bin，打渠道包请加 --channel <渠道名>");
  }

  // _manifest.txt：逐文件 posix 路径 + 字节数
  const staged = [...walkFiles(stageDir)].filter((f) => f !== SELF_ARTIFACT).sort();
  const sizes = new Map();
  let total = 0;
  for (const f of staged) {
    const sz = statSync(join(stageDir, f)).size;
    sizes.set(f, sz);
    total += sz;
  }
  const lines = [
    `EBCTFCodeBox v${version} 发行包清单（stage 生成）`,
    `渠道：${channel ?? "（无，不带 license.bin）"}`,
    `生成：${new Date().toISOString()}`,
    "".padEnd(64, "-"),
    ...staged.map((f) => `${f}  ${sizes.get(f)}`),
    "".padEnd(64, "-"),
    `清单 ${staged.length} 项 / 总大小 ${total} B（${fmtMB(total)}）`,
  ];
  writeFileSync(join(stageDir, SELF_ARTIFACT), lines.join("\n") + "\n", "utf8");

  console.log(`清单 ${staged.length} 项 / 总大小 ${fmtMB(total)}`);
  console.log(`_manifest.txt 已写入（${SELF_ARTIFACT} 不计入清单项）`);
  console.log("\n下一步：右键压缩 stage 目录为 EBCTFCodeBox-v" + version +
    (channel ? `-${channel}` : "") + ".rar（本脚本不做 RAR，避免依赖 WinRAR/三方库）");
  return 0;
}

// ==================== 子命令：verify ====================
async function cmdVerify(target, channel) {
  const dir = resolve(target);
  if (!existsSync(dir)) {
    console.error(`× 目录不存在：${dir}`);
    return 2;
  }

  let failed = false;

  // ---- 1. 清单比对（白名单展开时 channel 决定 license.bin 在不在清单里）----
  const include = new Set(listIncludeFiles(channel));
  const actual = walkFiles(dir);
  const missing = [...include].filter((f) => !actual.has(f));
  const extra = [...actual].filter((f) => !include.has(f) && f !== SELF_ARTIFACT);

  console.log(`verify ${dir}`);
  console.log(`白名单 ${include.size} 项（${channel ? "含 license.bin（渠道 " + channel + "）" : "不含 license.bin"}）`);
  if (missing.length) {
    failed = true;
    console.log(`缺失 ${missing.length} 项：`);
    for (const f of missing.slice(0, 30)) console.log(`  - ${f}`);
    if (missing.length > 30) console.log(`  … 共 ${missing.length} 项`);
  }
  if (extra.length) {
    failed = true;
    console.log(`多余 ${extra.length} 项：`);
    for (const f of extra.slice(0, 30)) console.log(`  + ${f}`);
    if (extra.length > 30) console.log(`  … 共 ${extra.length} 项`);
  }
  if (!missing.length && !extra.length) console.log("缺失 0 / 多余 0");

  // ---- 2. 包内版本号六处交叉校验（验的是流出的包，不是工作区）----
  const ver = readVersion(dir);
  const verStr = ver.allSame ? ver.value : "不一致";
  if (!ver.allSame) failed = true;
  console.log(`版本号 6 处：${ver.rows.map((r) => r.ver ?? "?").join(" / ")} → ${ver.allSame ? "一致" : "不一致"}`);

  // ---- 3. 渠道校验（防打错渠道：payload.source 与 --channel 比对）----
  let channelStr = "未校验（未传 --channel）";
  if (channel) {
    const lic = await readLicense(dir);
    if (lic.missing) {
      failed = true;
      channelStr = `不符（包内无 license.bin，却传了 --channel ${channel}）`;
    } else if (lic.corrupt) {
      failed = true;
      channelStr = `不符（license.bin ${lic.why}）`;
    } else if (lic.source.includes(CHANNELS[channel])) {
      channelStr = `${channel}（source="${lic.source}" ✓）`;
    } else {
      failed = true;
      channelStr = `不符（source="${lic.source}" 不含 "${CHANNELS[channel]}"）`;
    }
  } else if (actual.has("license.bin")) {
    // 无渠道模式包里却有 license.bin —— 已在上面按「多余」报过，这里补一句人话
    console.log("注意：未传 --channel 但包内有 license.bin（开发版误入？已在「多余」列出）");
  }
  console.log(`渠道 = ${channelStr}`);

  // ---- 汇总（PROGRESS 判据口径）----
  console.log(
    `\n清单 ${include.size} 项，缺失 ${missing.length}，多余 ${extra.length}，` +
      `版本号 6 处${ver.allSame ? "一致" : "不一致"}，渠道 = ${channel ? channelStr.split("（")[0] : "未校验"}`
  );
  return failed ? 1 : 0;
}

// ==================== 入口 ====================
function usage() {
  console.log(`用法：
  node tools/pack_release.mjs stage [--channel <渠道名>]
  node tools/pack_release.mjs verify <目录> [--channel <渠道名>]
  node tools/pack_release.mjs version

渠道名（授权/成品授权/ 现有产物）：${Object.keys(CHANNELS).join(" / ")}`);
}

const argv = process.argv.slice(2);
const cmd = argv[0];
let channel = null;
const rest = [];
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === "--channel") {
    channel = argv[++i];
    if (!channel) {
      usage();
      process.exit(2);
    }
  } else rest.push(argv[i]);
}
if (channel && !Object.hasOwn(CHANNELS, channel)) {
  console.error(`× 未知渠道：${channel}`);
  usage();
  process.exit(2);
}

let code;
if (cmd === "stage" && rest.length === 0) code = cmdStage(channel);
else if (cmd === "verify" && rest.length === 1) code = await cmdVerify(rest[0], channel);
else if (cmd === "version" && rest.length === 0) code = cmdVersion();
else {
  usage();
  code = 2;
}
process.exit(code);
