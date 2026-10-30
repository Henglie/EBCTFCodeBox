#!/usr/bin/env node
/*
 * gen_cn_lookup_data.mjs — 生成五种中文查字编码的紧凑码表。
 *
 * 产物（src/core/data/）：
 *   wubi.tsv        五笔 86/98 单字全码（ISC）
 *   zhengma.tsv     郑码单字码（BSD-2-Clause + Apache-2.0）
 *   telegraph.tsv   中文电码（Unicode License + MIT 交叉核对）
 *   fourcorner.tsv  四角号码（Unicode License）
 *   cangjie.tsv     仓颉码（Unicode License）
 *
 * 排序：同码多字按 hanziDB（MIT，Jun Da 字频表的简化字版本）词频升序；
 * 词频表未收的字排在后面，再按码点升序。生成结果无时间戳，可复现。
 *
 * 用法：node tools/gen_cn_lookup_data.mjs [--refresh]
 *   --refresh 忽略缓存重新下载（缓存默认在系统临时目录 ebctf-cn-lookup/）。
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "data", "cn");
const CACHE_DIR = path.join(os.tmpdir(), "ebctf-cn-lookup");
const REFRESH = process.argv.includes("--refresh");

const SOURCES = {
  wubi: {
    file: "wubi-code-data-1.0.2.js",
    url: "https://cdn.jsdelivr.net/npm/wubi-code-data@1.0.2/%E4%BA%94%E7%AC%94%E7%A0%81%E8%A1%A8%E6%95%B0%E6%8D%AE.js",
    license: "ISC · © nobodxbodon / program-in-chinese/npm-wubi-code-data",
  },
  bsdCodes: {
    file: "all-hanzi-codes.gbk.txt",
    url: "https://cdn.jsdelivr.net/gh/yefeijiang/Chinese-characters-code-table@8db2c1ce88b067fccf71e1aff4c0c8d35229f17f/%E5%85%A8%E9%83%A8%E6%B1%89%E5%AD%97%E7%A0%81%E8%A1%A8.TXT",
    license: "BSD-2-Clause · © yefeijiang/Chinese-characters-code-table",
  },
  zhengma: {
    file: "zhengma.dict.yaml",
    url: "https://cdn.jsdelivr.net/gh/chen32768/zhengma_for_rime@57a246ecdfa74bad7900d39ad26b26791455f256/zhengma.dict.yaml",
    license: "Apache-2.0 · © chen32768/zhengma_for_rime",
  },
  unihanZip: {
    file: "Unihan-18.0.0.zip",
    url: "https://www.unicode.org/Public/18.0.0/ucd/Unihan.zip",
    license: "Unicode License v3 · © Unicode, Inc.",
  },
  ctc: {
    file: "hanzi2ctc.json",
    url: "https://cdn.jsdelivr.net/gh/lisposter/node-ctc@6f875074e0c6518e827d44ff70570fdf5b8d4bb3/dict/hanzi2ctc.json",
    license: "MIT · © 2015 Leigh Zhu / lisposter/node-ctc",
  },
  freq: {
    file: "hanziDB.csv",
    url: "https://cdn.jsdelivr.net/gh/ruddfawcett/hanziDB.csv@3e9f908d25f70674862343b201f6b641a36cd226/data/hanziDB.csv",
    license: "MIT · © 2017 Rudd Fawcett；字频数据源自 Jun Da 现代汉语字频表",
  },
};

const sha256 = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

const _inflight = new Map();

async function getSource(key) {
  if (_inflight.has(key)) return _inflight.get(key);
  const task = (async () => {
    const src = SOURCES[key];
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const p = path.join(CACHE_DIR, src.file);
    if (REFRESH || !fs.existsSync(p)) {
      process.stdout.write(`下载 ${key}: ${src.url}\n`);
      let lastErr;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const res = await fetch(src.url, { redirect: "follow" });
          if (!res.ok) throw new Error(`${key} HTTP ${res.status}: ${src.url}`);
          fs.writeFileSync(p, Buffer.from(await res.arrayBuffer()));
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
          if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
        }
      }
      if (lastErr) throw lastErr;
    }
    const buf = fs.readFileSync(p);
    return { buf, sha: sha256(buf), ...src };
  })();
  _inflight.set(key, task);
  try {
    return await task;
  } finally {
    _inflight.delete(key);
  }
}

const isBmpCjk = (ch) => {
  const cp = ch.codePointAt(0);
  return (cp >= 0x3400 && cp <= 0x4dbf) || (cp >= 0x4e00 && cp <= 0x9fff);
};
const cpOf = (ch) => ch.codePointAt(0);

function textOf(buf, encoding = "utf-8") {
  return new TextDecoder(encoding).decode(buf).replace(/\r\n?/g, "\n");
}

// ---------------- Wubi 86/98 ----------------
function parseWubi(text) {
  const i86 = text.indexOf("const 五笔86");
  if (i86 < 0) throw new Error("五笔码表结构变化：找不到 const 五笔86");
  const iEnd = text.indexOf("exports.五笔98", i86);
  const parse = (section) => {
    const map = new Map();
    for (const m of section.matchAll(/"([^"]+)"\s*:\s*"([A-Za-z]*)"/g)) {
      let code = m[2];
      if (!code || !isBmpCjk(m[1])) continue;
      // 源表有 7 条首字母大写的异常码（如 我=Qtrny、为=Oyeyi），首字母是排版残留；去掉后才是标准码。
      if (/^[A-Z][a-z]{2,4}$/.test(code)) {
        console.warn(`修正五笔异常码：${m[1]} ${code} → ${code.slice(1)}`);
        code = code.slice(1);
      }
      if (/^[a-z]{1,4}$/.test(code)) map.set(m[1], code);
    }
    return map;
  };
  return { w86: parse(text.slice(i86, iEnd)), w98: parse(text.slice(0, i86)) };
}

// ---------------- BSD 20902 字表（五笔/郑码交叉源） ----------------
function parseBsd(buf) {
  const text = textOf(buf, "gbk");
  const rows = [];
  for (const line of text.split("\n")) {
    // 列：汉字 全拼 五笔 郑码 UNICODE GBK 笔画数 部首 笔顺编号
    const m = line.match(/^(\S)\s+(\S+)\s+(\S+)\s+(\S+)\s+([0-9A-F]+)\s+/);
    if (!m || !isBmpCjk(m[1])) continue;
    rows.push({ ch: m[1], wubi: m[3].toLowerCase(), zhengma: m[4] });
  }
  return rows;
}

// ---------------- 郑码附加表（Apache-2.0） ----------------
function parseZhengmaDict(text) {
  const map = new Map();
  for (const line of text.split("\n")) {
    const m = line.match(/^([a-z]{1,4})\t(.+)$/);
    if (!m) continue;
    const chars = [...m[2]];
    if (chars.length !== 1 || !isBmpCjk(chars[0])) continue;
    if (!map.has(chars[0])) map.set(chars[0], new Set());
    map.get(chars[0]).add(m[1].toUpperCase());
  }
  return map;
}

// ---------------- Unihan 字段 ----------------
function parseUnihan(buf, field) {
  const map = new Map();
  for (const line of textOf(buf).split("\n")) {
    const m = line.match(/^U\+([0-9A-F]+)\t([^\t]+)\t(.+)$/);
    if (!m || m[2] !== field) continue;
    const ch = String.fromCodePoint(parseInt(m[1], 16));
    if (!isBmpCjk(ch)) continue;
    map.set(ch, m[3].trim());
  }
  return map;
}

async function getUnihanFile(name) {
  const dir = path.join(CACHE_DIR, "unihan-18.0.0");
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) {
    await getSource("unihanZip");
    fs.mkdirSync(dir, { recursive: true });
    const zipPath = path.join(CACHE_DIR, SOURCES.unihanZip.file);
    const tryRun = (cmd, args) => {
      try {
        const r = spawnSync(cmd, args, { stdio: "ignore" });
        return r.status === 0 && fs.existsSync(p);
      } catch { return false; }
    };
    let ok = tryRun("unzip", ["-o", zipPath, name, "-d", dir]);
    if (!ok) ok = tryRun("tar", ["-xf", zipPath, "-C", dir, name]);
    if (!ok && process.platform === "win32") {
      ok = tryRun("powershell", ["-NoProfile", "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`]);
    }
    if (!ok) throw new Error(`无法解压 ${zipPath}；请安装 unzip 或手动把 ${name} 放到 ${dir}`);
  }
  return fs.readFileSync(p);
}

async function loadUnihan(name, field) {
  const buf = await getUnihanFile(name);
  const version = (textOf(buf).match(/# Unicode Version ([\d.]+)/) || [])[1] || "18.0.0";
  return { map: parseUnihan(buf, field), version, sha: sha256(buf), license: SOURCES.unihanZip.license, url: SOURCES.unihanZip.url };
}

// ---------------- 词频排序 ----------------
function parseFreq(buf) {
  const map = new Map();
  const text = textOf(buf);
  for (const line of text.split("\n").slice(1)) {
    const p = line.split(",");
    const rank = Number(p[0]);
    const ch = p[1];
    if (ch && Number.isFinite(rank) && ch.length === 1) map.set(ch, rank);
  }
  return map;
}

const ranker = (freq) => (ch) => freq.get(ch) ?? 1e9;

function sortRows(rows, freq) {
  const rank = ranker(freq);
  return rows.sort((a, b) => rank(a.ch) - rank(b.ch) || cpOf(a.ch) - cpOf(b.ch));
}

// ---------------- 输出 ----------------
function dataFile(filename, title, sources, counts, body, formatHint = "字符<TAB>码1[|码2…]；多字同码按词频排序（生成时已排好）。") {
  const header = [
    `# ${filename} — ${title}`,
    "#",
    "# 由 tools/gen_cn_lookup_data.mjs 生成，勿手改；重跑脚本即可重建。",
    "# 数据来源与许可证：",
    ...sources.map((s) => `#   - ${s.license}`),
    ...sources.map((s) => `#     ${s.url}`),
    ...sources.map((s) => `#     SHA256 ${s.sha}`),
    "#",
    `# 行格式：${formatHint}`,
    `# 条目：${counts}`,
    "",
  ].join("\n");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, filename), header + body + "\n");
  return fs.statSync(path.join(OUT_DIR, filename)).size;
}

function linesOf(map, render) {
  return [...map.entries()].map(([ch, v]) => `${ch}\t${render(v)}`).join("\n");
}

// ---------------- 主流程 ----------------
const [wubiSrc, bsdSrc, zhengmaSrc, freqSrc, ctcSrc] = await Promise.all([
  getSource("wubi"), getSource("bsdCodes"), getSource("zhengma"), getSource("freq"), getSource("ctc"),
]);
const [uniCangjie, uniFourCorner, uniTelegraph] = await Promise.all([
  loadUnihan("Unihan_DictionaryLikeData.txt", "kCangjie"),
  loadUnihan("Unihan_DictionaryLikeData.txt", "kFourCornerCode"),
  loadUnihan("Unihan_OtherMappings.txt", "kMainlandTelegraph"),
]);

const freq = parseFreq(freqSrc.buf);
const bsd = parseBsd(bsdSrc.buf);
const { w86, w98 } = parseWubi(textOf(wubiSrc.buf));

const wubiRows = bsd
  .map(({ ch }) => ({ ch, c86: w86.get(ch) || "", c98: w98.get(ch) || "" }))
  .filter((r) => r.c86 || r.c98);
sortRows(wubiRows, freq);
const wubiBody = linesOf(new Map(wubiRows.map((r) => [r.ch, r])), (r) => `${r.c86}\t${r.c98}`);
const wubiSize = dataFile(
  "wubi.tsv",
  "五笔字型 86/98 单字全码表",
  [wubiSrc],
  `86=${wubiRows.filter((r) => r.c86).length}，98=${wubiRows.filter((r) => r.c98).length}，合计 ${wubiRows.length} 字`,
  wubiBody,
  "字符<TAB>86码<TAB>98码；多字同码按词频排序（生成时已排好）。",
);

// 郑码：BSD 主表 + Apache-2.0 附加表合并；每字多码按「全码优先、短码靠后」排
const zhengma = new Map();
const addZm = (ch, code) => {
  code = String(code || "").toUpperCase();
  if (!/^[A-Z]{1,4}$/.test(code)) return;
  if (!zhengma.has(ch)) zhengma.set(ch, new Set());
  zhengma.get(ch).add(code);
};
for (const r of bsd) for (const code of r.zhengma.split("/")) addZm(r.ch, code);
for (const [ch, codes] of parseZhengmaDict(textOf(zhengmaSrc.buf))) for (const code of codes) addZm(ch, code);
const zhengmaRows = [...zhengma.entries()].map(([ch, codes]) => ({
  ch,
  codes: [...codes].sort((a, b) => b.length - a.length || a.localeCompare(b)),
}));
sortRows(zhengmaRows, freq);
const zhengmaBody = linesOf(new Map(zhengmaRows.map((r) => [r.ch, r.codes])), (codes) => codes.join("|"));
const zhengmaSize = dataFile(
  "zhengma.tsv",
  "郑码单字码表",
  [bsdSrc, zhengmaSrc],
  `${zhengmaRows.length} 字`,
  zhengmaBody,
);

// 中文电码：Unihan 为主，node-ctc（MIT）补缺；0000 为保留码不收录
const telegraph = new Map();
for (const [ch, code] of uniTelegraph.map) {
  if (/^\d{4}$/.test(code) && code !== "0000") telegraph.set(ch, code);
}
const ctc = JSON.parse(textOf(ctcSrc.buf));
for (const [ch, code] of Object.entries(ctc)) {
  if (!telegraph.has(ch) && /^\d{4}$/.test(code) && code !== "0000" && isBmpCjk(ch)) telegraph.set(ch, code);
}
const teleRows = [...telegraph.entries()].map(([ch, code]) => ({ ch, code: code.padStart(4, "0") }));
sortRows(teleRows, freq);
const teleBody = linesOf(new Map(teleRows.map((r) => [r.ch, r.code])), (code) => code);
const teleSize = dataFile(
  "telegraph.tsv",
  "中文电码（四位电报码）单字表",
  [uniTelegraph, ctcSrc],
  `${teleRows.length} 字（Unicode ${uniTelegraph.version}）`,
  teleBody,
);

// 四角号码：Unihan 5 位（第 5 位为附号）；原生 4 位的保留 4 位
const fourCorner = new Map();
for (const [ch, raw] of uniFourCorner.map) {
  const codes = raw.split(/\s+/)
    .map((s) => s.replace(".", ""))
    .filter((s) => /^\d{4,5}$/.test(s));
  if (codes.length) fourCorner.set(ch, [...new Set(codes)]);
}
const fcRows = [...fourCorner.entries()].map(([ch, codes]) => ({ ch, codes }));
sortRows(fcRows, freq);
const fcBody = linesOf(new Map(fcRows.map((r) => [r.ch, r.codes])), (codes) => codes.join("|"));
const fcSize = dataFile(
  "fourcorner.tsv",
  "四角号码单字表",
  [uniFourCorner],
  `${fcRows.length} 字（Unicode ${uniFourCorner.version}）`,
  fcBody,
);

// 仓颉：Unihan kCangjie，A-Z 1–5 码
const cangjie = new Map();
for (const [ch, raw] of uniCangjie.map) {
  const codes = raw.split(/\s+/).filter((s) => /^[A-Z]{1,5}$/.test(s));
  if (codes.length) cangjie.set(ch, [...new Set(codes)]);
}
const cjRows = [...cangjie.entries()].map(([ch, codes]) => ({ ch, codes }));
sortRows(cjRows, freq);
const cjBody = linesOf(new Map(cjRows.map((r) => [r.ch, r.codes])), (codes) => codes.join("|"));
const cjSize = dataFile(
  "cangjie.tsv",
  "仓颉码单字表",
  [uniCangjie],
  `${cjRows.length} 字（Unicode ${uniCangjie.version}）`,
  cjBody,
);

// ---------------- 自检（码→字） ----------------
function invert(exportsTable) {
  const map = new Map();
  for (const line of exportsTable.split("\n")) {
    const [ch, ...rest] = line.split("\t");
    for (const code of rest.join("\t").split("|")) {
      if (!code) continue;
      if (!map.has(code)) map.set(code, []);
      map.get(code).push(ch);
    }
  }
  return map;
}
const wubiInvert = new Map();
for (const r of wubiRows) {
  for (const code of [r.c86, r.c98]) {
    if (!code) continue;
    if (!wubiInvert.has(code)) wubiInvert.set(code, []);
    if (!wubiInvert.get(code).includes(r.ch)) wubiInvert.get(code).push(r.ch);
  }
}
const zmInvert = invert(zhengmaBody);
const teleInvert = invert(teleBody);
const fcInvert = invert(fcBody);
const cjInvert = invert(cjBody);

const checks = [
  ["五笔86 ovty→数", wubiInvert.get("ovty")?.includes("数")],
  ["五笔86 fgh→十", wubiInvert.get("fgh")?.includes("十")],
  ["五笔86 wnn→亿", wubiInvert.get("wnn")?.includes("亿")],
  ["郑码 MAZY→每", zmInvert.get("MAZY")?.includes("每")],
  ["郑码 AGD→天", zmInvert.get("AGD")?.includes("天")],
  ["郑码 MFJI→种", zmInvert.get("MFJI")?.includes("种")],
  ["电码 0022→中", teleInvert.get("0022")?.includes("中")],
  ["电码 0678→合", teleInvert.get("0678")?.includes("合")],
  ["电码 3127→法", teleInvert.get("3127")?.includes("法")],
  ["四角 40227→内", fcInvert.get("40227")?.includes("内")],
  ["四角 44801→共", fcInvert.get("44801")?.includes("共")],
  ["仓颉 MGBHU→现", cjInvert.get("MGBHU")?.includes("现")],
  ["仓颉 QVIO→拟", cjInvert.get("QVIO")?.includes("拟")],
  ["仓颉 YPTC→虚", cjInvert.get("YPTC")?.includes("虚")],
];
let failed = 0;
for (const [name, ok] of checks) {
  if (!ok) { failed++; console.error(`FAIL ${name}`); }
}
if (failed) throw new Error(`码表自检失败 ${failed} 项`);

console.log("生成完成（public/data/cn/）：");
console.log(`  wubi.tsv        ${(wubiSize / 1024).toFixed(1)} KiB  ${wubiRows.length} 字`);
console.log(`  zhengma.tsv     ${(zhengmaSize / 1024).toFixed(1)} KiB  ${zhengmaRows.length} 字`);
console.log(`  telegraph.tsv   ${(teleSize / 1024).toFixed(1)} KiB  ${teleRows.length} 字`);
console.log(`  fourcorner.tsv  ${(fcSize / 1024).toFixed(1)} KiB  ${fcRows.length} 字`);
console.log(`  cangjie.tsv     ${(cjSize / 1024).toFixed(1)} KiB  ${cjRows.length} 字`);
console.log("自检 14/14 通过（五笔/郑码/电码/四角/仓颉样例码→字）");
