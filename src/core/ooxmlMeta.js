/*
 * ooxmlMeta.js — OOXML 元数据提取（P1 批，cat:'forensic'，单向 run）。
 *
 * 解决什么：docx / xlsx / pptx 本质是 ZIP 容器，元数据在 docProps/ 下的
 * 三个 XML 部件里：core.xml（标题/作者/时间）、app.xml（程序/公司/页数）、
 * custom.xml（自定义属性）。取证常从作者名/公司名/编辑时间直接翻出线索，
 * 本工具把三部件的键值对全部挖出来。
 *
 * 解析路径：
 * - ZIP：EOCD（尾部倒找）→ 中央目录逐条 → 本地文件头精确切压缩数据，
 *   支持 stored（method 0）与 deflate（method 8，纯 JS RFC 1951 解压）；
 *   拼接件（EOCD 声明偏移验不出 CDH 签名）按「CD 紧贴 EOCD 前」反推
 *   前缀修正量，与主流解压器一致
 * - XML：两段式提取——先 custom 的 <property name="X">…<tag>值</tag>
 *   …</property>（custom 部件专用结构），再通用 <tag>文本</tag> 对
 *   （文本无嵌套标签、≤4096 字符；local name 去命名空间前缀）；
 *   五实体反转义（&amp; 最后解，避免双解）
 *
 * 输出：报告 = 头部统计 + 按部件分组的键值行（core:Title: xxx 形态）。
 *
 * 输入：text 为 hex / base64 / 原始二进制字符串（inputEnc 可指定），
 * 或 p.rawBytes 直传（拖文件）。
 *
 * 零外发：纯字节解析；deflate 解压复用 pcapDeep.js 的 inflateRaw（纯 JS）。
 *
 * 回归断言：加载期自检 IIFE（含对拍向量：core.xml 标题/作者 → 报告行）。
 * makeOoxml/makeZipEntryDeflate 导出供回归脚本构造测试件。
 */
import { register } from "./registry.js";
import { inflateRaw } from "./pcapDeep.js";
import { inputToBytes } from "./compress.js";
import { findEocd, crc32Bytes, makeStoredZip } from "./zipRepair.js";

// ============ ZIP 条目读取（EOCD → CD → LFH 精确路径） ============

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => ((b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0);
const CDH_SIG = [0x50, 0x4b, 0x01, 0x02];
const LFH_SIG = [0x50, 0x4b, 0x03, 0x04];

function isSig(b, o, sig) {
  for (let i = 0; i < sig.length; i++) if (b[o + i] !== sig[i]) return false;
  return true;
}

/**
 * 中央目录遍历。返回条目数组：
 * { name, method, crc, compSize, size, lfhOff }
 * 无 EOCD 返回 null；EOCD 处返回 { entries: [], eocdOff } 形态照常。
 */
export function zipEntries(bytes) {
  const eocdOff = findEocd(bytes);
  if (eocdOff < 0) return null;
  const count = u16(bytes, eocdOff + 10);
  const cdSize = u32(bytes, eocdOff + 12);
  const cdOff = u32(bytes, eocdOff + 16);

  // 拼接件前缀修正：声明偏移验不出 CDH，而「CD 紧贴 EOCD 前」验出 → 平移
  let base = cdOff;
  if (base + 4 > bytes.length || !isSig(bytes, base, CDH_SIG)) {
    const guess = eocdOff - cdSize;
    if (guess >= 0 && guess + 4 <= bytes.length && isSig(bytes, guess, CDH_SIG)) {
      base = guess;
    } else {
      return { entries: [], prefixDelta: 0 };
    }
  }
  const prefixDelta = base - cdOff; // LFH 偏移同步平移量

  const entries = [];
  let p = base;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || !isSig(bytes, p, CDH_SIG)) break;
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const lfhOff = u32(bytes, p + 42);
    if (p + 46 + nameLen > bytes.length) break;
    let name = "";
    for (let j = 0; j < nameLen; j++) name += String.fromCharCode(bytes[p + 46 + j]);
    entries.push({ name, method, compSize, size, lfhOff: lfhOff + prefixDelta });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, prefixDelta };
}

/** 读条目内容（LFH 处重读名长/扩展长，切压缩数据后按 method 解压）。 */
export function zipReadEntry(bytes, entry) {
  const off = entry.lfhOff;
  if (off + 30 > bytes.length || !isSig(bytes, off, LFH_SIG)) {
    throw new Error(`条目 ${entry.name} 的本地头未命中`);
  }
  const nameLen = u16(bytes, off + 26);
  const extraLen = u16(bytes, off + 28);
  const dataStart = off + 30 + nameLen + extraLen;
  const comp = bytes.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return comp;
  if (entry.method === 8) return inflateRaw(comp);
  throw new Error(`条目 ${entry.name} 使用不支持的压缩方法 ${entry.method}`);
}

// ============ XML 键值提取 ============

function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&"); // &amp; 最后解，避免二次反转义
}

function localXmlName(name) {
  const i = name.lastIndexOf(":");
  return i < 0 ? name : name.slice(i + 1);
}

// custom 部件专用：<property name="X">…<tag>值</tag>…</property>
const CUSTOM_PROP_RE = /<property\b[^>]*\bname="([^"]+)"[^>]*>[\s\S]*?<([A-Za-z0-9_.:-]+)[^>]*>([\s\S]*?)<\/[A-Za-z0-9_.:-]+>[\s\S]*?<\/property>/g;
// 通用标签对：文本无嵌套标签、≤4096 字符
const TAG_PAIR_RE = /<([A-Za-z0-9_.:-]+)(?:\s[^>]*)?>([^<>]{1,4096})<\/[A-Za-z0-9_.:-]+>/g;

/** 一个部件的键值对：[{key: "source:Name", value}]。 */
export function xmlPairs(source, xml) {
  const out = [];
  CUSTOM_PROP_RE.lastIndex = 0;
  let m;
  while ((m = CUSTOM_PROP_RE.exec(xml)) !== null) {
    const name = xmlUnescape(m[1]);
    const value = xmlUnescape(m[3]).trim();
    if (name && value) out.push({ key: `${source}:${name}`, value });
  }
  TAG_PAIR_RE.lastIndex = 0;
  while ((m = TAG_PAIR_RE.exec(xml)) !== null) {
    if (localXmlName(m[1]) === "property") continue;
    const tag = localXmlName(m[1]);
    const value = xmlUnescape(m[2]).trim();
    if (tag && value) out.push({ key: `${source}:${tag}`, value });
  }
  return out;
}

// ============ op run ============

const TARGETS = [
  ["core", "docProps/core.xml"],
  ["app", "docProps/app.xml"],
  ["custom", "docProps/custom.xml"],
];

function ooxmlMetaRun(text, p) {
  const pp = p || {};
  if ((!text || !String(text).trim()) && !(pp.rawBytes && pp.rawBytes.length)) {
    return "（空输入）请拖入 docx / xlsx / pptx 文件或粘贴 hex / base64 字节。";
  }
  let data;
  try {
    data = inputToBytes(text, pp);
  } catch (e) {
    return "输入解析失败：" + (e && e.message ? e.message : String(e));
  }

  const zr = zipEntries(data);
  if (!zr) {
    return `不是 ZIP 容器（未找到 EOCD），输入 ${data.length} 字节。OOXML（docx/xlsx/pptx）本质是 ZIP；旧版 .doc/.xls 是 OLE 复合文档，本工具不支持。`;
  }

  const lines = [];
  let total = 0, foundParts = 0;
  const decoder = new TextDecoder("utf-8", { fatal: false });
  for (const [label, path] of TARGETS) {
    const entry = zr.entries.find((e) => e.name === path);
    if (!entry) continue;
    let xml;
    try {
      xml = decoder.decode(zipReadEntry(data, entry));
    } catch (e) {
      lines.push(`[${path}] 读取/解压失败：${e && e.message ? e.message : String(e)}`);
      foundParts++;
      continue;
    }
    const pairs = xmlPairs(label, xml);
    foundParts++;
    if (pairs.length === 0) continue;
    lines.push(`[${path}]`);
    for (const kv of pairs) {
      lines.push(`${kv.key}: ${kv.value}`);
      total++;
    }
  }

  const head = `OOXML 元数据（命中 ${foundParts}/3 个元数据部件，${total} 条属性，输入 ${data.length} 字节）`;
  if (total === 0) {
    const hint = foundParts === 0
      ? `三个元数据部件（docProps/core.xml · app.xml · custom.xml）都没找到。ZIP 共 ${zr.entries.length} 个条目——可能不是 Word/Excel/PPT 主文档，或部件被删。`
      : "部件在但没提取到属性（内容可能为空或非预期结构）。";
    return [head, "", hint].join("\n");
  }
  return [head, "", ...lines].join("\n");
}

// ============ 测试构造器（供回归脚本） ============

/** 手拼单条目 ZIP（method 由调用者指定，method 8 时传 comp=已压缩数据）。 */
export function makeZipEntryRaw(name, raw, method, comp) {
  const nameB = Array.from(name, (c) => c.charCodeAt(0) & 0xff);
  const dataB = method === 0 ? raw : comp;
  const parts = [];
  const u16w = (v) => parts.push(v & 0xff, (v >>> 8) & 0xff);
  const u32w = (v) => parts.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  const lfhOff = 0;
  parts.push(0x50, 0x4b, 0x03, 0x04);
  u16w(0x0014); u16w(0x0000); u16w(method);
  u16w(0x4800); u16w(0x5987);
  u32w(crc32Bytes(raw)); u32w(raw.length); u32w(dataB.length);
  u16w(nameB.length); u16w(0);
  parts.push(...nameB, ...Array.from(dataB));
  const cdOff = parts.length;
  parts.push(0x50, 0x4b, 0x01, 0x02);
  u16w(0x0014); u16w(0x0014); u16w(0x0000); u16w(method);
  u16w(0x4800); u16w(0x5987);
  u32w(crc32Bytes(raw)); u32w(raw.length); u32w(dataB.length);
  u16w(nameB.length); u16w(0); u16w(0); u16w(0); u16w(0); u32w(0);
  u32w(lfhOff);
  parts.push(...nameB);
  const cdSize = parts.length - cdOff;
  parts.push(0x50, 0x4b, 0x05, 0x06);
  u16w(0); u16w(0); u16w(1); u16w(1); u32w(cdSize); u32w(cdOff); u16w(0);
  return new Uint8Array(parts);
}

/** OOXML 测试件（stored 多部件 ZIP，XML 按 UTF-8 编码入包）：parts = [[name, xmlText], ...]。 */
export function makeOoxml(parts) {
  return makeStoredZip(parts.map(([name, xml]) => ({ name, data: new TextEncoder().encode(xml) })));
}

// ============ 加载期自检（import 即跑；异常未处理会非零退出，CI 可抓） ============

(() => {
  // 对拍向量：core.xml 标题/作者（参考单测 "Test title"/"Alice"）
  const docA = makeOoxml([
    ["docProps/core.xml",
      `<cp:coreProperties><dc:title>Test title</dc:title><dc:creator>Alice</dc:creator></cp:coreProperties>`],
  ]);
  const outA = ooxmlMetaRun("", { rawBytes: docA });
  if (!outA.includes("core:title: Test title") || !outA.includes("core:creator: Alice") ||
      !outA.includes("1/3") || !outA.includes("2 条属性")) {
    throw new Error(`ooxmlMeta 自检①失败：\n${outA}`);
  }

  // ② app.xml + 命名空间 local name 剥离（dcterms:created → app:created 剥前缀）
  const docB = makeOoxml([
    ["docProps/app.xml",
      `<Properties xmlns="..."><Application>Microsoft Office Word</Application><Company>CTF Corp</Company></Properties>`],
    ["docProps/core.xml",
      `<cp:coreProperties><dcterms:created>2026-08-24T00:00:00Z</dcterms:created></cp:coreProperties>`],
  ]);
  const outB = ooxmlMetaRun("", { rawBytes: docB });
  if (!outB.includes("app:Application: Microsoft Office Word") ||
      !outB.includes("app:Company: CTF Corp") ||
      !outB.includes("core:created: 2026-08-24T00:00:00Z") || !outB.includes("2/3")) {
    throw new Error(`ooxmlMeta 自检②失败：\n${outB}`);
  }

  // ③ custom 部件 <property name="X"><vt:lpstr>值</vt:lpstr></property>
  const docC = makeOoxml([
    ["docProps/custom.xml",
      `<Properties><property name="Category" fmtid="..."><vt:lpstr>CTF-2026</vt:lpstr></property></Properties>`],
  ]);
  const outC = ooxmlMetaRun("", { rawBytes: docC });
  if (!outC.includes("custom:Category: CTF-2026")) {
    throw new Error(`ooxmlMeta 自检③失败：\n${outC}`);
  }

  // ④ 五实体反转义（&amp; 最后解）
  const docD = makeOoxml([
    ["docProps/core.xml", `<c><dc:title>a&lt;b&gt;c&amp;d&quot;e&apos;f</dc:title></c>`],
  ]);
  const outD = ooxmlMetaRun("", { rawBytes: docD });
  if (!outD.includes(`core:title: a<b>c&d"e'f`)) {
    throw new Error(`ooxmlMeta 自检④失败：\n${outD}`);
  }

  // ⑤ deflate 条目（method 8）：预生成的固定内容压缩流（RFC 1951 raw deflate）
  const DEFL_CORE = new Uint8Array([179,73,46,176,74,206,47,74,13,40,202,47,72,45,42,201,76,45,182,179,73,73,182,42,201,44,201,73,181,115,73,77,203,73,44,73,85,240,247,182,209,135,11,218,232,99,106,1,0]);
  const CORE_PLAIN = "<cp:coreProperties><dc:title>Deflate OK</dc:title></cp:coreProperties>";
  const docE = makeZipEntryRaw("docProps/core.xml", new TextEncoder().encode(CORE_PLAIN), 8, DEFL_CORE);
  const outE = ooxmlMetaRun("", { rawBytes: docE });
  if (!outE.includes("core:title: Deflate OK")) {
    throw new Error(`ooxmlMeta 自检⑤失败：\n${outE}`);
  }

  // ⑥ 非 ZIP 报错
  const outF = ooxmlMetaRun("", { rawBytes: new TextEncoder().encode("PK fake not a zip") });
  if (!outF.includes("不是 ZIP 容器")) throw new Error(`ooxmlMeta 自检⑥失败：\n${outF}`);

  // ⑦ ZIP 但无元数据部件
  const outG = ooxmlMetaRun("", { rawBytes: makeOoxml([["word/document.xml", "<w:document/>"]]) });
  if (!outG.includes("0/3") || !outG.includes("都没找到")) throw new Error(`ooxmlMeta 自检⑦失败：\n${outG}`);

  // ⑧ hex 输入路径
  const hexH = Array.from(docA, (b) => b.toString(16).padStart(2, "0")).join("");
  const outH = ooxmlMetaRun(hexH, {});
  if (!outH.includes("core:title: Test title")) throw new Error(`ooxmlMeta 自检⑧失败：\n${outH}`);

  // ⑨ 中文 UTF-8 值解码
  const docI = makeOoxml([
    ["docProps/core.xml", `<cp:coreProperties><dc:title>标题测试</dc:title></cp:coreProperties>`],
  ]);
  const outI = ooxmlMetaRun("", { rawBytes: docI });
  if (!outI.includes("core:title: 标题测试")) throw new Error(`ooxmlMeta 自检⑨失败：\n${outI}`);

  // ⑩ 空输入提示
  const outJ = ooxmlMetaRun("", {});
  if (!outJ.includes("空输入")) throw new Error(`ooxmlMeta 自检⑩失败：\n${outJ}`);
})();

// ============ register ============

register({
  id: "ooxmlMeta", cat: "forensic", name: "OOXML 元数据提取",
  desc: "docx/xlsx/pptx 的元数据一键挖出：docProps 下 core.xml（标题/作者/时间）·app.xml（程序/公司）·custom.xml（自定义属性）全部键值对。ZIP 容器直解（stored/deflate），拼接件前缀自动修正，作者名/公司名/隐藏备注常是取证线索",
  params: [
    { key: "inputEnc", label: "输入编码（文本输入时）", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ],
    },
  ],
  run: ooxmlMetaRun,
  acceptsBytes: true,
});

export { ooxmlMetaRun };
