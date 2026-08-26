/*
 * apkManifest.js — APK AndroidManifest.xml 解析（P1 批，cat:'forensic'，单向 run）。
 *
 * 解决什么：APK（ZIP 容器）里的 AndroidManifest.xml 多数是二进制 AXML 格式，
 * 纯文本正则挖不了；本工具直接把 manifest 解出来：包名 package、权限
 * uses-permission / uses-permission-sdk-23、四大组件 activity/service/receiver/
 * provider 的 name 全列出，并附元素表（元素名+属性名/值）。二进制 AXML 与
 * 明文 XML 两种形态自动识别。
 *
 * 解析路径：
 * - ZIP：复用 ooxmlMeta.zipEntries/zipReadEntry（EOCD→CD→LFH 精确切，
 *   stored/deflate 纯 JS 解压，拼接件前缀修正）读 AndroidManifest.xml
 * - 明文鉴定：内容前 16 字节出现 '<' → 明文 XML，走标签/属性正则
 * - 二进制 AXML：按 chunk 遍历。0x0001 字符串池（UTF-16/UTF-8 两种 flag）
 *   → 0x0102 START_ELEMENT 解析元素名 + 属性（属性名/raw value/typed value）。
 *   值渲染：raw 字符串优先 → typed：0x03 字符串 / 0x10,0x11 十进制 /
 *   0x12 布尔 / 0x01 资源引用@ / 0x02 主题引用? / 0x1c..0x1f 颜色# / 其余 type=..:..
 *
 * 输出：报告 = 头部统计（strings/elements 数）+ package / permissions /
 * components 汇总 + 逐元素表（name + 各属性 key=value）。参考实现把汇总走
 * text、明细走 json/strings 多端口，本卡点名单 op → 一份报告出齐。
 *
 * 输入：text 为 hex / base64 / 原始二进制字符串（inputEnc 可指定），
 * 或 p.rawBytes 直传（拖 APK 文件）。
 *
 * 零外发：纯字节解析 + 自包含 ZIP/deflate。
 *
 * 回归断言：加载期自检 IIFE（含对拍向量：参考单测的 make_axml_manifest
 * 二进制 AXML → package com.example.app + strings 含 manifest）。
 * makeAxmlManifest/makeStringPoolBuffer/makeApk 导出供回归脚本构造测试件。
 */
import { register } from "./registry.js";
import { zipEntries, zipReadEntry } from "./ooxmlMeta.js";
import { inputToBytes } from "./compress.js";
import { makeStoredZip } from "./zipRepair.js";

// ============ 基础工具 ============

const le16 = (b, o) => (b.length >= o + 2 ? b[o] | (b[o + 1] << 8) : null);
const le32 = (b, o) => {
  if (b.length < o + 4) return null;
  const v = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24));
  return v >>> 0;
};

function localXmlName(name) {
  const i = name.lastIndexOf(":");
  return i < 0 ? name : name.slice(i + 1);
}

function xmlUnescape(s) {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

// ============ Android 二进制 XML（AXML）解析 ============

// length=UTF8：(u8&0x7f)<<8 | u8（2 字节）或 u8（1 字节）；UTF16 同理按 u16 高位
function readResUtf8Len(data, pos) {
  const b0 = data[pos];
  if (b0 === undefined) return [0, 0];
  if (b0 & 0x80) return [(((b0 & 0x7f) << 8) | (data[pos + 1] || 0)), 2];
  return [b0, 1];
}
function readResUtf16Len(data, pos) {
  const w0 = le16(data, pos);
  if (w0 === null) return [0, 0];
  if (w0 & 0x8000) return [((((w0 & 0x7fff) << 16) | le16(data, pos + 2)) >>> 0), 4];
  return [w0, 2];
}

/** 解析字符串池 chunk（0x0001），返回字符串数组；非法 null。 */
export function parseStringPool(data, offset) {
  if (le16(data, offset) !== 0x0001) return null;
  const headerSize = le16(data, offset + 2) || 0;
  const chunkSize = le32(data, offset + 4) || 0;
  const stringCount = le32(data, offset + 8) || 0;
  const flags = le32(data, offset + 16) || 0;
  const stringsStart = le32(data, offset + 20) || 0;
  if (offset + chunkSize > data.length || headerSize < 28) return null;
  const utf8 = (flags & 0x0000_0100) !== 0;
  const offsetsStart = offset + headerSize;
  const dataStart = offset + stringsStart;
  const out = [];
  for (let i = 0; i < stringCount; i++) {
    const itemOff = le32(data, offsetsStart + i * 4);
    const pos = dataStart + (itemOff || 0);
    if (pos >= data.length) { out.push(""); continue; }
    if (utf8) {
      const [, a] = readResUtf8Len(data, pos);
      const [byteLen, b] = readResUtf8Len(data, pos + a);
      const start = pos + a + b;
      const end = Math.min(start + byteLen, data.length);
      out.push(new TextDecoder("utf-8").decode(data.subarray(start, end)));
    } else {
      const [units, a] = readResUtf16Len(data, pos);
      const start = pos + a;
      const words = [];
      for (let j = 0; j < units; j++) words.push(le16(data, start + j * 2) || 0);
      out.push(String.fromCharCode(...words)); // 由 UTF-16 码元直接组合
    }
  }
  return out;
}

const AXML_NONE = 0xffffffff;
const axmlString = (strings, idx) => (idx === AXML_NONE ? null : strings[idx]);

function axmlValue(strings, rawIdx, dataType, dataValue) {
  const raw = axmlString(strings, rawIdx);
  if (raw !== null && raw !== undefined) return raw;
  switch (dataType) {
    case 0x03: return axmlString(strings, dataValue) || "";
    case 0x10: case 0x11: return String(dataValue);
    case 0x12: return dataValue === 0 ? "false" : "true";
    case 0x01: return `@0x${dataValue.toString(16).padStart(8, "0")}`;
    case 0x02: return `?0x${dataValue.toString(16).padStart(8, "0")}`;
    case 0x1c: case 0x1d: case 0x1e: case 0x1f:
      return `#${dataValue.toString(16).padStart(8, "0")}`;
    default: return `type=0x${dataType.toString(16).padStart(2, "0")}:0x${dataValue.toString(16)}`;
  }
}

/**
 * AXML 全文件解析。返回 { strings:[], elements:[{name, attrs:[[k,v]]}] }。
 * {strings:0, elements:0} 表示解析失败（与参考实现空报告判定一致）。
 */
export function parseAxml(data) {
  const rootType = le16(data, 0);
  const start = rootType === 0x0003 ? (le16(data, 2) || 8) : 0;
  let offset = start;
  let strings = [];
  const elements = [];
  while (offset + 8 <= data.length) {
    const chunkType = le16(data, offset);
    if (chunkType === null) break;
    const headerSize = le16(data, offset + 2) || 8;
    const chunkSize = le32(data, offset + 4) || 0;
    if (chunkSize < 8 || offset + chunkSize > data.length) break;
    switch (chunkType) {
      case 0x0001: {
        const pool = parseStringPool(data, offset);
        if (pool) strings = pool;
        break;
      }
      case 0x0102: {
        if (strings.length && chunkSize >= headerSize + 20) {
          const ext = offset + headerSize;
          const nameIdx = le32(data, ext + 4);
          const name = axmlString(strings, nameIdx) || `#${nameIdx}`;
          const attrStart = le16(data, ext + 8) || 20;
          const attrSize = Math.max(le16(data, ext + 10) || 20, 20);
          const attrCount = le16(data, ext + 12) || 0;
          const attrsBase = ext + attrStart;
          const attrs = [];
          for (let n = 0; n < attrCount; n++) {
            const a = attrsBase + n * attrSize;
            if (a + 20 > offset + chunkSize) break;
            const attrNameIdx = le32(data, a + 4);
            const rawValueIdx = le32(data, a + 8);
            const dataType = data[a + 15] || 0;
            const dataValue = le32(data, a + 16) || 0;
            const attrName = axmlString(strings, attrNameIdx) || `#${attrNameIdx}`;
            const value = axmlValue(strings, rawValueIdx, dataType, dataValue);
            attrs.push([attrName, value]);
          }
          elements.push({ name, attrs });
        }
        break;
      }
      default: {}
    }
    offset += chunkSize;
  }
  return { strings, elements };
}

// ============ 明文 manifest ============

const TEXT_TAG_RE = /<([A-Za-z0-9_.:-]+)\b([^>]*)>/g;
const TEXT_ATTR_RE = /([A-Za-z0-9_.:-]+)\s*=\s*"([^"]*)"/g;

function textManifestReport(xml) {
  const strings = [];
  const elements = [];
  TEXT_TAG_RE.lastIndex = 0;
  let m;
  while ((m = TEXT_TAG_RE.exec(xml)) !== null) {
    const raw = m[1];
    if (raw.startsWith("?") || raw.startsWith("!") || raw.startsWith("/")) continue;
    const name = localXmlName(raw);
    const attrsText = m[2] || "";
    const attrs = [];
    TEXT_ATTR_RE.lastIndex = 0;
    let a;
    while ((a = TEXT_ATTR_RE.exec(attrsText)) !== null) {
      const key = localXmlName(a[1]);
      const value = xmlUnescape(a[2]);
      strings.push(value);
      attrs.push([key, value]);
    }
    strings.push(name);
    elements.push({ name, attrs });
  }
  return { strings, elements };
}

// ============ op run ============

function attrValue(el, name) {
  const hit = el.attrs.find(([k]) => k === name || k.endsWith(`:${name}`));
  return hit ? hit[1] : null;
}

function apkManifestRun(text, p) {
  const pp = p || {};
  if ((!text || !String(text).trim()) && !(pp.rawBytes && pp.rawBytes.length)) {
    return "（空输入）请拖入 APK 文件或粘贴 hex / base64 字节。";
  }
  let data;
  try { data = inputToBytes(text, pp); }
  catch (e) { return "输入解析失败：" + (e && e.message ? e.message : String(e)); }

  const zr = zipEntries(data);
  if (!zr) {
    return `不是 ZIP 容器（未找到 EOCD），输入 ${data.length} 字节。APK 是 ZIP 容器，AndroidManifest.xml 在包内。`;
  }
  const entry = zr.entries.find((e) => e.name === "AndroidManifest.xml");
  if (!entry) {
    return `ZIP 内未找到 AndroidManifest.xml（共 ${zr.entries.length} 个条目）。`;
  }
  let manifest;
  try { manifest = zipReadEntry(data, entry); }
  catch (e) { return `读取 AndroidManifest.xml 失败：${e && e.message ? e.message : String(e)}`; }

  const isText = manifest.subarray(0, 16).some((b) => b === 0x3c); // '<'
  const report = isText
    ? textManifestReport(new TextDecoder("utf-8").decode(manifest))
    : parseAxml(manifest);

  const COMP_TYPES = ["activity", "service", "receiver", "provider"];
  const manifestEl = report.elements.find((e) => e.name === "manifest");
  const packageName = manifestEl ? attrValue(manifestEl, "package") : null;
  const permissions = report.elements
    .filter((e) => e.name === "uses-permission" || e.name === "uses-permission-sdk-23")
    .map((e) => attrValue(e, "name")).filter(Boolean);
  const components = report.elements
    .filter((e) => COMP_TYPES.includes(e.name))
    .map((e) => `${e.name}:${attrValue(e, "name")}`)
    .filter((s) => !s.endsWith(":"));

  const lines = [];
  lines.push(`APK manifest 解析（${isText ? "明文 XML" : "二进制 AXML"}，elements ${report.elements.length}，strings ${report.strings.length}，输入 ${data.length} 字节）`);
  lines.push("");
  if (packageName) lines.push(`package: ${packageName}`);
  if (permissions.length) lines.push(`permissions: ${permissions.join(", ")}`);
  if (components.length) lines.push(`components: ${components.join(", ")}`);
  lines.push("");
  for (const el of report.elements) {
    if (el.attrs.length === 0) { lines.push(`<${el.name}/>`); continue; }
    lines.push(`<${el.name} ${el.attrs.map(([k, v]) => `${k}="${v}"`).join(" ")}>`);
  }
  return lines.join("\n");
}

// ============ 测试构造器（供回归脚本，忠实参考 make_axml_manifest） ============

/** UTF-8 字符串池（flag 0x100），chunk size 推算对齐参考实现。 */
export function makeStringPoolBuffer(strings) {
  const data = [];
  const offsets = [];
  for (const s of strings) {
    offsets.push(data.length);
    data.push(s.length, s.length);
    for (let i = 0; i < s.length; i++) data.push(s.charCodeAt(i) & 0xff);
    data.push(0);
  }
  while (data.length % 4 !== 0) data.push(0);
  const headerSize = 28;
  const stringsStart = headerSize + strings.length * 4;
  const chunkSize = stringsStart + data.length;
  const out = [];
  const u16w = (v) => out.push(v & 0xff, (v >>> 8) & 0xff);
  const u32w = (v) => out.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  u16w(0x0001); u16w(headerSize); u32w(chunkSize);
  u32w(strings.length); u32w(0); u32w(0x0000_0100); u32w(stringsStart); u32w(0);
  for (const off of offsets) u32w(off);
  out.push(...data);
  return new Uint8Array(out);
}

/** utf16/utf32 LE 小端写入工具数组（供构造 chunk）。 */
export function pushLe(out, n, width) {
  for (let i = 0; i < width; i++) out.push((n >>> (8 * i)) & 0xff);
}

/**
 * 构造一个 START_ELEMENT(0x0102) chunk：元素名 idx + 一条属性
 * （name idx / 可选 raw 值 idx / typed 值）。字节几何精确镜像参考实现
 * make_axml_manifest：+8 line +12 comment +16 ns +20 name，随后六个 u16
 * （attrStart/attrSize/attrCount/idIndex/classIndex/styleIndex），+36 起属性结构
 * （ns(4) name(4) raw(4) 保留(2) 0x00+dataType(2) dataValue(4)，共 20 字节）。
 */
export function startElementChunk(nameIdx, attrNameIdx, attrRawIdx, typedType, typedValue) {
  const out = [];
  pushLe(out, 0x0102, 2); pushLe(out, 16, 2); pushLe(out, 56, 4); // type header chunkSize
  pushLe(out, 1, 4);            // line number (+8)
  pushLe(out, 0xffffffff, 4);   // comment idx (+12)
  pushLe(out, 0xffffffff, 4);   // ns idx    (+16) = ext
  pushLe(out, nameIdx, 4);      // name idx  (+20)
  pushLe(out, 20, 2);           // attrStart (+24)
  pushLe(out, 20, 2);           // attrSize  (+26)
  pushLe(out, 1, 2);            // attrCount (+28)
  pushLe(out, 0, 2);            // idIndex   (+30)
  pushLe(out, 0, 2);            // classIndex(+32)
  pushLe(out, 0, 2);            // styleIndex(+34)
  pushLe(out, 0xffffffff, 4);   // attr0 ns        (+36)
  pushLe(out, attrNameIdx, 4);  // attr0 name      (+40)
  pushLe(out, attrRawIdx, 4);   // attr0 raw value (+44)
  pushLe(out, 8, 2);            // 保留 (+48,+49) → dataType 高字节 8
  out.push(0, typedType);       // +50,+51 → dataType 在 attr0+15(+51)=typedType
  pushLe(out, typedValue, 4);   // attr0 dataValue (+52)
  return new Uint8Array(out);
}

/** 完整 AXML（根 0x0003 + 字符串池 + 元素 chunk），参考 make_axml_manifest。 */
export function makeAxmlManifest() {
  const pool = makeStringPoolBuffer(["manifest", "package", "com.example.app"]);
  const start = startElementChunk(0, 1, 2, 0x03, 2);
  const total = 8 + pool.length + start.length;
  const axml = [];
  pushLe(axml, 0x0003, 2); pushLe(axml, 8, 2); pushLe(axml, total, 4);
  axml.push(...pool, ...start);
  return new Uint8Array(axml);
}

/** APK 测试件：带 AndroidManifest.xml（默认二进制 AXML）的 stored ZIP。 */
export function makeApk(manifest) {
  return makeStoredZip([{ name: "AndroidManifest.xml", data: manifest || makeAxmlManifest() }]);
}

// ============ 加载期自检（import 即跑；异常未处理会非零退出，CI 可抓） ============

(() => {
  // ① 对拍向量：参考单测 make_axml_manifest → package com.example.app + strings 含 manifest
  const apk1 = makeApk();
  const out1 = apkManifestRun("", { rawBytes: apk1 });
  if (!out1.includes("com.example.app") || !out1.includes("二进制 AXML") ||
      !out1.includes("package: com.example.app")) {
    throw new Error(`apkManifest 自检①失败：\n${out1}`);
  }

  // ② 明文 XML manifest（uses-permission + activity）
  const textManifest = `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.ctf.demo" android:versionName="1.0">
    <uses-permission android:name="android.permission.INTERNET"/>
    <application>
      <activity android:name="com.ctf.demo.MainActivity" android:exported="true"/>
    </application>
  </manifest>`;
  const doc2 = makeStoredZip([{ name: "AndroidManifest.xml", data: new TextEncoder().encode(textManifest) }]);
  const out2 = apkManifestRun("", { rawBytes: doc2 });
  if (!out2.includes("明文 XML") || !out2.includes("package: com.ctf.demo") ||
      !out2.includes("android.permission.INTERNET") || !out2.includes("com.ctf.demo.MainActivity")) {
    throw new Error(`apkManifest 自检②失败：\n${out2}`);
  }

  // ③ 非 ZIP 报错
  const out3 = apkManifestRun("", { rawBytes: new TextEncoder().encode("PK not a real apk zip") });
  if (!out3.includes("不是 ZIP 容器")) throw new Error(`apkManifest 自检③失败：\n${out3}`);

  // ④ ZIP 无 AndroidManifest.xml
  const out4 = apkManifestRun("", { rawBytes: makeStoredZip([{ name: "classes.dex", data: new TextEncoder().encode("dex") }]) });
  if (!out4.includes("未找到 AndroidManifest.xml")) throw new Error(`apkManifest 自检④失败：\n${out4}`);

  // ⑤ hex 输入路径
  const doc5 = makeApk();
  const hex5 = Array.from(doc5, (b) => b.toString(16).padStart(2, "0")).join("");
  const out5 = apkManifestRun(hex5, {});
  if (!out5.includes("com.example.app")) throw new Error(`apkManifest 自检⑤失败：\n${out5}`);

  // ⑥ 空输入提示
  const out6 = apkManifestRun("", {});
  if (!out6.includes("空输入")) throw new Error(`apkManifest 自检⑥失败：\n${out6}`);

  // ⑦ 二进制 AXML 里 typed int/boolean 属性：nameIdx0 加 href=0x10 与 exported=0x12
  const pool7 = makeStringPoolBuffer(["manifest", "package", "com.x.app",
    "activity", "name", "android:exported", "MainActivity"]);
  // 手拼多元素（element chunk 串行，同字符串池）：
  const elManifest = startElementChunk(0, 1, 2, 0x03, 2);           // manifest package=com.x.app
  const elActivity = startElementChunk(3, 4, 7, 0x03, 6);           // activity 缺 exported，先测 typ 字符串
  const total7 = 8 + pool7.length + elManifest.length + elActivity.length;
  const axml7 = []; pushLe(axml7, 0x0003, 2); pushLe(axml7, 8, 2); pushLe(axml7, total7, 4);
  axml7.push(...pool7, ...elManifest, ...elActivity);
  const out7 = apkManifestRun("", { rawBytes: makeApk(new Uint8Array(axml7)) });
  if (!out7.includes("com.x.app") || !out7.includes("MainActivity")) {
    throw new Error(`apkManifest 自检⑦失败：\n${out7}`);
  }
})();

// ============ register ============

register({
  id: "apkManifest", cat: "forensic", name: "APK Manifest 解析",
  desc: "Android 的 AndroidManifest.xml（二进制 AXML 或明文）直接解出：包名 package、权限 uses-permission/uses-permission-sdk-23、四大组件 activity/service/receiver/provider 全列出，附逐元素属性表。AXML 字符串池 UTF-8/UTF-16 双格式，typed 值（字符串/整型/布尔/资源引用/颜色）都还原",
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
  run: apkManifestRun,
  acceptsBytes: true,
});

export { apkManifestRun };