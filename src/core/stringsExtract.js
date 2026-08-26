/*
 * stringsExtract.js — 通用可打印字符串提取（T347，cat:'forensic'，单向 run）。
 *
 * 场景：逆向 / 取证的起手动作——任意字节流里扫出「连续可打印字符 ≥ 最小长度」
 * 的片段（经典 strings 命令的浏览器版）。不限可执行文件，对任何二进制都可用，
 * 常用于从图片 / 文档 / 内存转储里快速捞出 flag、路径、域名、报错文本。
 *
 * 三种编码模式：
 * - ascii    连续可打印 ASCII（0x20..0x7E）片段
 * - utf16le  连续「可打印字节 + 0x00」字符对（Windows 程序 / 注册表 / DOC 里常见；
 *            扫描按任意对齐前进——命中步进 2、未命中步进 1，奇偶起点都能扫到）
 * - both     双扫描合并，结果按偏移升序
 *
 * 参数：
 * - minLen     最小长度，默认 4（<1 按 1），片段不足则丢弃
 * - encoding   ascii / utf16le / both，默认 ascii
 * - showOffset 每行前缀偏移（0x00000010 十六进制 8 位）
 *
 * 输出：报告（模式 / 阈值 / 命中数 + 逐条字符串）。命中极多时截断展示（默认
 * 上限 5000 行，计数仍为全量），防大文件刷爆渲染。
 *
 * 输入：text 为 hex / base64 / 原始二进制字符串（自动识别），或 p.rawBytes 直传。
 *
 * 回归断言：加载期自检 IIFE（参考测试向量：ASCII 混合流 / 最小长度过滤 /
 * UTF-16LE「flag」/ both 合并排序 / 偏移格式 / 空输入）。
 */
import { register } from "./registry.js";

const MAX_DISPLAY = 5000; // 报告最多列 5000 条（计数仍全量）

const printable = (b) => b >= 0x20 && b <= 0x7e;

/**
 * 连续 ASCII 可打印片段 → [{offset, s}]。
 * @param {Uint8Array} data @param {number} min 最小长度
 */
export function scanAscii(data, min) {
  const out = [];
  let start = 0, cur = "";
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if (printable(b)) {
      if (cur === "") start = i;
      cur += String.fromCharCode(b);
    } else {
      if (cur.length >= min) out.push({ offset: start, s: cur });
      cur = "";
    }
  }
  if (cur.length >= min) out.push({ offset: start, s: cur });
  return out;
}

/**
 * 连续 UTF-16LE 可打印片段（可打印字节 + 0x00 交替）→ [{offset, s}]。
 * 命中步进 2 / 未命中步进 1，任意对齐都能扫到。
 */
export function scanUtf16le(data, min) {
  const out = [];
  let start = 0, cur = "";
  let i = 0;
  while (i + 1 < data.length) {
    if (data[i + 1] === 0 && printable(data[i])) {
      if (cur === "") start = i;
      cur += String.fromCharCode(data[i]);
      i += 2;
    } else {
      if (cur.length >= min) out.push({ offset: start, s: cur });
      cur = "";
      i += 1;
    }
  }
  if (cur.length >= min) out.push({ offset: start, s: cur });
  return out;
}

// ============ 输入：hex / base64 / 原始二进制字符串自动识别（或 rawBytes 直传） ============

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
function isHex(s) { return /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 && s.length >= 2; }
function isB64(s) {
  if (!s || s.length % 4 !== 0) return false;
  for (const c of s) if (!B64_CHARS.includes(c)) return false;
  return true;
}
export function inputToBytes(text, p) {
  if (p && p.rawBytes && p.rawBytes.length) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  }
  const s = String(text).trim().replace(/\s+/g, "");
  if (isHex(s)) {
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
    return out;
  }
  if (isB64(s)) {
    try {
      let bin;
      if (typeof atob === "function") bin = atob(s);
      else bin = Buffer.from(s, "base64").toString("binary");
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    } catch { /* 走原始字符回退 */ }
  }
  // 原始二进制字符串（拖入文件时前端可能给 latin1 串）
  const out = new Uint8Array(String(text).length);
  for (let i = 0; i < out.length; i++) out[i] = String(text).charCodeAt(i) & 0xFF;
  return out;
}

// ============ run ============

function stringsExtractRun(text, p) {
  const pp = p || {};
  if ((!text || !String(text).trim()) && !(pp.rawBytes && pp.rawBytes.length)) {
    return "（空输入）请拖入文件或粘贴 hex / base64 字节。";
  }
  let minLen = parseInt(pp.minLen, 10);
  if (!Number.isFinite(minLen) || minLen < 1) minLen = 4;
  const enc = pp.encoding || "ascii";
  const showOff = !!pp.showOffset;

  const data = inputToBytes(text, pp);

  let hits = [];
  if (enc === "ascii" || enc === "both") hits = hits.concat(scanAscii(data, minLen));
  if (enc === "utf16le" || enc === "both") hits = hits.concat(scanUtf16le(data, minLen));
  if (enc === "both") hits.sort((a, b) => a.offset - b.offset);

  const encName = enc === "utf16le" ? "UTF-16LE" : enc === "both" ? "ASCII + UTF-16LE" : "ASCII";
  const lines = [];
  lines.push(`字符串提取（模式 ${encName}，最小长度 ${minLen}，输入 ${data.length} 字节）`);
  lines.push(`命中 ${hits.length} 条${hits.length > MAX_DISPLAY ? `（仅展示前 ${MAX_DISPLAY} 条）` : ""}`);
  lines.push("");
  if (hits.length === 0) {
    lines.push("未找到满足长度的可打印字符串。建议：降低最小长度或换编码模式（Windows 来源优先试 UTF-16LE）。");
    return lines.join("\n");
  }
  const cap = Math.min(hits.length, MAX_DISPLAY);
  for (let i = 0; i < cap; i++) {
    lines.push(showOff ? `0x${hits[i].offset.toString(16).padStart(8, "0")}  ${hits[i].s}` : hits[i].s);
  }
  return lines.join("\n");
}

// ============ 加载期自检（import 即跑） ============

(() => {
  const b = (...bs) => new Uint8Array(bs);

  // ① ASCII 混合流：短片段被 minLen 过滤（参考用例）
  //    "AB\0hello\0\1world!" → hello / world!（"AB" 长 2 被滤）
  const d1 = b(0x41, 0x42, 0x00, 0x68, 0x65, 0x6C, 0x6C, 0x6F, 0x00, 0x01, 0x77, 0x6F, 0x72, 0x6C, 0x64, 0x21);
  let out = stringsExtractRun("", { rawBytes: d1, minLen: 4, encoding: "ascii" });
  if (!out.includes("命中 2 条") || !out.includes("hello") || !out.includes("world!") || out.includes("AB")) {
    throw new Error(`stringsExtract 自检①失败：\n${out}`);
  }

  // ② 全短片段 → 0 命中（参考用例 "AB\0"）
  out = stringsExtractRun("", { rawBytes: b(0x41, 0x42, 0x00), minLen: 4, encoding: "ascii" });
  if (!out.includes("命中 0 条")) throw new Error(`stringsExtract 自检②失败：\n${out}`);

  // ③ UTF-16LE：「f\0l\0a\0g\0」→ flag；\xff\xff 断开（参考用例）
  out = stringsExtractRun("", { rawBytes: b(0x66, 0x00, 0x6C, 0x00, 0x61, 0x00, 0x67, 0x00, 0xFF, 0xFF), minLen: 4, encoding: "utf16le" });
  if (!out.includes("命中 1 条") || !out.includes("flag")) throw new Error(`stringsExtract 自检③失败：\n${out}`);

  // ④ both 合并按偏移排序：UTF-16 的 flag(偏移0) 在 ASCII 的 hello(偏移10) 前
  const d4 = b(
    0x66, 0x00, 0x6C, 0x00, 0x61, 0x00, 0x67, 0x00, 0x00, 0x00, // "flag" utf16le @0，后接 \0\0 断开
    0x68, 0x65, 0x6C, 0x6C, 0x6F, 0x00,                        // "hello" ascii @10
  );
  out = stringsExtractRun("", { rawBytes: d4, minLen: 4, encoding: "both", showOffset: true });
  const li = out.split("\n").filter((l) => l.startsWith("0x"));
  if (li.length !== 2 || !li[0].includes("flag") || !li[0].includes("0x00000000") || !li[1].includes("hello") || !li[1].includes("0x0000000a")) {
    throw new Error(`stringsExtract 自检④失败：\n${out}`);
  }

  // ⑤ 偏移格式：8 位十六进制前缀
  out = stringsExtractRun("", { rawBytes: b(0, 0, 0, 0, 0x68, 0x69, 0x6A, 0x6B, 0x00), minLen: 4, encoding: "ascii", showOffset: true });
  if (!out.includes("0x00000004  hijk")) throw new Error(`stringsExtract 自检⑤失败：\n${out}`);

  // ⑥ minLen 边界：恰好等于阈值的片段保留
  out = stringsExtractRun("", { rawBytes: b(0x68, 0x69, 0x6A, 0x6B, 0x00), minLen: 4, encoding: "ascii" });
  if (!out.includes("命中 1 条")) throw new Error(`stringsExtract 自检⑥失败：\n${out}`);

  // ⑦ 空输入提示
  out = stringsExtractRun("", {});
  if (!out.includes("空输入")) throw new Error(`stringsExtract 自检⑦失败：\n${out}`);

  // ⑧ hex 文本输入路径：48656c6c6f = "Hello"
  out = stringsExtractRun("48 65 6C 6C 6F", { minLen: 4, encoding: "ascii" });
  if (!out.includes("Hello")) throw new Error(`stringsExtract 自检⑧失败：\n${out}`);
})();

// ============ register ============

register({
  id: "stringsExtract", cat: "forensic", name: "字符串提取（strings）",
  desc: "任意字节流里提取连续可打印字符串（经典 strings 工具）：ASCII / UTF-16LE / 双模式合并，最小长度阈值，可选偏移前缀。逆向取证起手动作，图片/文档/内存转储里快速捞 flag、路径、域名",
  params: [
    { key: "minLen", label: "最小长度", type: "number", default: 4 },
    {
      key: "encoding", label: "编码", type: "select", default: "ascii",
      options: [
        { value: "ascii", label: "ASCII" },
        { value: "utf16le", label: "UTF-16LE" },
        { value: "both", label: "两者（按偏移合并）" },
      ],
    },
    { key: "showOffset", label: "显示偏移", type: "bool", default: false },
  ],
  run: stringsExtractRun,
  acceptsBytes: true,
});

export { stringsExtractRun };
