/*
 * pdfObjects.js — PDF 对象与流解析（P1 批，cat:'forensic'，单向 run）。
 *
 * 解决什么：PDF 取证起手动作——不渲染页面、不修文件，直接把对象表挖出来：
 * 每个「N M obj ... endobj」对象的编号 / 文件偏移 / 体长 / Type / Subtype /
 * Filter / 流长度逐行列出；每个流再给内容预览，FlateDecode 流自动 zlib
 * 解压后预览（页面内容流、隐藏文本、被压缩的 flag 常藏在对象流里）。
 *
 * 解析策略（词法容错扫描，与 xref 严格路径互补——xref 被改/截断照样能挖）：
 * - %PDF- 头在前 1024 字节内扫描（容忍前置垃圾 / 图片拼接件）
 * - 对象头按「数字 空白 数字 空白 obj」词法匹配（数字 ≤10 位）；对象体 =
 *   obj 之后到最近的 endobj（缺失则到文件尾，容错截断件）
 * - stream 关键字：前一字节必须是空白或 '>'（排除字典里 "xxxstream" 词内
 *   误命中），关键字后必须紧跟 CR / LF 行尾；endstream 前的一个 CR/LF
 *   按 PDF 规范不计入流数据
 * - /Type /Subtype /Filter 取名值：定位 "/键"，跳空白，Filter 数组写法
 *   [ /A /B ] 跳 '[' 后取首名
 *
 * 输出：报告 = 头部统计（版本/对象数/流数）+ 逐对象行 + 流内容段
 * （raw 长度 / 解压结果 / 预览 200 字符）。
 *
 * 输入：text 为 hex / base64 / 原始二进制字符串（inputEnc 可指定），
 * 或 p.rawBytes 直传（拖文件）。
 *
 * 零外发：纯字节解析；zlib 解压复用 lsbExtract.js 的 inflateZlib（自包含 tinf）。
 *
 * 回归断言：加载期自检 IIFE（含对拍向量的最小双对象 PDF + FlateDecode 流）。
 * makePdf/zlibStore 导出供回归脚本构造测试件（stored DEFLATE 块手工包装，
 * 任何标准 inflate 均可还原）。
 */
import { register } from "./registry.js";
import { inflateZlib } from "./lsbExtract.js";
import { inputToBytes } from "./compress.js";

// ============ 基础工具 ============

const STREAM_KW = asciiBytes("stream");
const ENDSTREAM_KW = asciiBytes("endstream");
const ENDOBJ_KW = asciiBytes("endobj");
const PDF_MAGIC = asciiBytes("%PDF-");
// 空白字节集（PDF 词法空白：NUL \t \n \f \r 空格）
const PDF_WS = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20]);
// 名字终结符：空白与定界符 / < > [ ] ( )
const NAME_STOP = new Set([0x2f, 0x3c, 0x3e, 0x5b, 0x5d, 0x28, 0x29]);

function asciiBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function toLatin1(data) {
  let s = "";
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i]);
  return s;
}

function latin1ToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

/** 从 from 起找 needle 首次出现，命中返回下标，未命中 -1。 */
function findBytes(data, needle, from) {
  const n = needle.length;
  if (n === 0) return from || 0;
  const end = data.length - n;
  for (let i = from || 0; i <= end; i++) {
    let j = 0;
    while (j < n && data[i + j] === needle[j]) j++;
    if (j === n) return i;
  }
  return -1;
}

/** ASCII 预览：可打印保留，\t\n\r 折叠为空格，其余打点，去首尾空白。 */
function asciiPreview(data, limit) {
  let s = "";
  const end = Math.min(limit, data.length);
  for (let i = 0; i < end; i++) {
    const b = data[i];
    if (b === 0x09 || b === 0x0a || b === 0x0d) s += " ";
    else if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
    else s += ".";
  }
  return s.trim();
}

// ============ PDF 结构解析 ============

/** %PDF- 头偏移（前 1024 字节内），未找到 -1。 */
export function pdfHeaderOffset(data) {
  return findBytes(data.subarray(0, Math.min(1024, data.length)), PDF_MAGIC, 0);
}

/** 头之后 的版本串（如 "1.4"），取不到 null。 */
export function pdfVersionAt(data, off) {
  let s = "";
  for (let i = off + 5; i < data.length && s.length < 8; i++) {
    const c = data[i];
    if ((c >= 0x30 && c <= 0x39) || c === 0x2e) s += String.fromCharCode(c);
    else break;
  }
  return s || null;
}

/**
 * 字典里 /键 的名值：定位 "/键"，跳空白；若遇 '[' 再跳一次（Filter 数组）；
 * 若遇 '/' 跳过（名前导斜杠）；取到空白/定界符为止。
 * 找不到或取空返回 null。
 */
export function pdfNameValue(content, key) {
  const needle = asciiBytes("/" + key);
  const idx = findBytes(content, needle, 0);
  if (idx < 0) return null;
  let pos = idx + needle.length;
  while (pos < content.length && PDF_WS.has(content[pos])) pos++;
  if (pos < content.length && content[pos] === 0x5b) { // '['：数组写法取首名
    pos++;
    while (pos < content.length && PDF_WS.has(content[pos])) pos++;
  }
  if (pos < content.length && content[pos] === 0x2f) pos++; // '/'
  const start = pos;
  while (pos < content.length && !PDF_WS.has(content[pos]) && !NAME_STOP.has(content[pos])) pos++;
  return pos > start ? toLatin1(content.subarray(start, pos)) : null;
}

/**
 * 在对象体内定位 stream 数据段（返回绝对偏移 {start,end}，无流 null）。
 * 关键字前必须是空白或 '>'；关键字后必须 CR/LF（CR 后可跟 LF）；
 * endstream 前的一个 CR/LF 不计入数据（规范行尾）。
 * 关键字命中但后续不合法 → 继续向后找；有效关键字后无 endstream → null。
 */
export function findPdfStream(content, base) {
  let search = 0;
  for (;;) {
    const s = findBytes(content, STREAM_KW, search);
    if (s < 0) return null;
    const before = s === 0 ? -1 : content[s - 1];
    const beforeOk = s === 0 || before === 0x0a || before === 0x0d || before === 0x20 || before === 0x09 || before === 0x3e;
    let payloadStart = s + 6;
    if (!beforeOk || payloadStart >= content.length) { search = s + 6; continue; }
    const c = content[payloadStart];
    if (c === 0x0d) {
      payloadStart++;
      if (payloadStart < content.length && content[payloadStart] === 0x0a) payloadStart++;
    } else if (c === 0x0a) {
      payloadStart++;
    } else {
      search = s + 6; continue; // 关键字后无行尾 → 词内误命中
    }
    const endRel = findBytes(content, ENDSTREAM_KW, payloadStart);
    if (endRel < 0) return null;
    let payloadEnd = endRel;
    if (payloadEnd > payloadStart && content[payloadEnd - 1] === 0x0a) payloadEnd--;
    if (payloadEnd > payloadStart && content[payloadEnd - 1] === 0x0d) payloadEnd--;
    return { start: base + payloadStart, end: base + payloadEnd };
  }
}

// 对象头词法：数字(≤10位) 空白 数字(≤10位) 空白 obj 词边界。
// 空白类用显式字节集（\s 会把 latin1 串里 0xA0 等高位字节误当空白）。
const OBJ_RE = /(\d{1,10})[ \t\r\n\x0b\x0c]+(\d{1,10})[ \t\r\n\x0b\x0c]+obj\b/g;

/**
 * 全文件对象扫描。返回对象数组：
 * { number, generation, offset, contentStart, contentEnd, typ, subtype, filter, stream }
 * 非 PDF（无 %PDF- 头）返回 null。
 */
export function parsePdfObjects(data) {
  if (pdfHeaderOffset(data) < 0) return null;
  const text = toLatin1(data);
  const out = [];
  OBJ_RE.lastIndex = 0;
  let m;
  while ((m = OBJ_RE.exec(text)) !== null) {
    const contentStart = m.index + m[0].length;
    const endRel = findBytes(data, ENDOBJ_KW, contentStart);
    const contentEnd = endRel < 0 ? data.length : endRel;
    const content = data.subarray(contentStart, contentEnd);
    out.push({
      number: parseInt(m[1], 10),
      generation: parseInt(m[2], 10),
      offset: m.index,
      contentStart,
      contentEnd,
      typ: pdfNameValue(content, "Type"),
      subtype: pdfNameValue(content, "Subtype"),
      filter: pdfNameValue(content, "Filter"),
      stream: findPdfStream(content, contentStart),
    });
  }
  return out;
}

// ============ op run ============

function pdfObjectsRun(text, p) {
  const pp = p || {};
  if ((!text || !String(text).trim()) && !(pp.rawBytes && pp.rawBytes.length)) {
    return "（空输入）请拖入 PDF 文件或粘贴 hex / base64 字节。";
  }
  let data;
  try {
    data = inputToBytes(text, pp);
  } catch (e) {
    return "输入解析失败：" + (e && e.message ? e.message : String(e));
  }

  const headerOff = pdfHeaderOffset(data);
  if (headerOff < 0) {
    return `不是 PDF 文件（前 ${Math.min(1024, data.length)} 字节内未找到 %PDF- 头），输入 ${data.length} 字节。`;
  }
  const objects = parsePdfObjects(data) || [];
  const version = pdfVersionAt(data, headerOff);
  const decodeFlate = pp.decodeFlate === undefined ? true : !!pp.decodeFlate;
  const streamObjs = objects.filter((o) => o.stream);

  const lines = [];
  lines.push(
    `PDF 对象解析（PDF-${version || "?"} 头 @ 0x${headerOff.toString(16).padStart(8, "0")}，` +
    `共 ${objects.length} 个对象 / ${streamObjs.length} 个流，输入 ${data.length} 字节）`
  );
  lines.push("");
  if (objects.length === 0) {
    lines.push("找到 %PDF- 头但未扫到任何「N M obj」对象。文件可能损坏，或对象全在压缩对象流（/Type /ObjStm）里——可看流内容段的 ObjStm 解压预览。");
    return lines.join("\n");
  }

  for (const o of objects) {
    const id = `${o.number} ${o.generation}`;
    const len = o.contentEnd - o.contentStart;
    const sl = o.stream ? o.stream.end - o.stream.start : null;
    lines.push(
      `obj ${id.padEnd(9)} @ 0x${o.offset.toString(16).padStart(8, "0")}  len ${String(len).padStart(7)}  ` +
      `type=${o.typ || "-"} subtype=${o.subtype || "-"} filter=${o.filter || "-"} stream=${sl === null ? "-" : sl}`
    );
  }

  lines.push("");
  lines.push(`流内容（${streamObjs.length} 个流${decodeFlate ? "，FlateDecode 自动解压" : "，未解压"}）：`);
  if (streamObjs.length === 0) lines.push("  无");
  for (const o of streamObjs) {
    const st = o.stream;
    const raw = data.subarray(st.start, st.end);
    let decoded = null, err = null;
    if (decodeFlate && o.filter === "FlateDecode") {
      try { decoded = inflateZlib(raw); } catch (e) { err = e && e.message ? e.message : String(e); }
    }
    const effective = decoded || raw;
    const id = `${o.number} ${o.generation}`;
    const decPart = decoded ? ` → 解压 ${decoded.length} 字节` : err ? ` → 解压失败（${err}），按 raw 展示` : "";
    lines.push(`obj ${id}  stream @ 0x${st.start.toString(16).padStart(8, "0")}  raw ${raw.length} 字节${decPart}  filter=${o.filter || "-"}`);
    lines.push(`  ${asciiPreview(effective, 200) || "（空流）"}`);
  }
  return lines.join("\n");
}

// ============ 测试构造器（供回归脚本） ============

/** Adler-32（RFC 1950 校验和，大端写回流尾）。 */
export function adler32(data) {
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b * 65536) + a) >>> 0;
}

/**
 * 手工 zlib 包装：stored（非压缩）DEFLATE 块 + adler32。
 * 结构合法（RFC 1950/1951），任何标准 inflate / 解压器都能还原；
 * 测试里当「已压缩」流用，避免核心代码依赖压缩器。
 */
export function zlibStore(data) {
  const len = data.length;
  if (len > 0xffff) throw new Error("zlibStore 仅支持 ≤65535 字节（stored 块 LEN 16 位）");
  const nlen = (~len) & 0xffff;
  const ad = adler32(data);
  const out = new Uint8Array(2 + 5 + len + 4);
  out[0] = 0x78; out[1] = 0x01;          // CMF=8(32K窗) FLG=FCHECK 合法
  out[2] = 0x01;                          // BFINAL=1 + BTYPE=00(stored)，低位对齐补零
  out[3] = len & 0xff; out[4] = (len >> 8) & 0xff;
  out[5] = nlen & 0xff; out[6] = (nlen >> 8) & 0xff;
  out.set(data, 7);
  out[7 + len] = (ad >>> 24) & 0xff; out[8 + len] = (ad >>> 16) & 0xff;
  out[9 + len] = (ad >>> 8) & 0xff;  out[10 + len] = ad & 0xff;
  return out;
}

/**
 * 最小结构 PDF 构造器。
 * entries: [{ dict: "<< ... >>" 字符串, stream: Uint8Array|null }]
 *  - stream 非 null：默认 zlibStore 压缩并写 /Length + /Filter /FlateDecode；
 *    rawStream: true 则原样嵌入（无 Filter）。
 *  - 默认无参 = 对拍向量的双对象布局（Catalog + FlateDecode 流 "hello stream"）。
 */
export function makePdf(entries) {
  if (!entries) {
    entries = [
      { dict: "<< /Type /Catalog >>" },
      { stream: asciiBytes("hello stream") },
    ];
  }
  let s = "%PDF-1.4\n";
  let n = 1;
  for (const e of entries) {
    s += `${n} 0 obj\n`;
    if (e.stream != null) {
      const comp = e.rawStream ? e.stream : zlibStore(e.stream);
      const filterPart = e.rawStream ? "" : ` /Filter /FlateDecode`;
      s += `<< /Length ${comp.length}${filterPart} >>\n`;
      s += `stream\n${toLatin1(comp)}\nendstream\n`;
    } else {
      s += `${e.dict || "<< >>"}\n`;
    }
    s += `endobj\n`;
    n++;
  }
  s += "%%EOF\n";
  return latin1ToBytes(s);
}

// ============ 加载期自检（import 即跑；异常未处理会非零退出，CI 可抓） ============

(() => {
  const concat = (...parts) => {
    const len = parts.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const hexOf = (d) => Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");

  // ① 对拍向量：最小双对象 PDF → 2 对象 / Catalog / FlateDecode 流解出 hello stream
  const pdf1 = makePdf();
  const out1 = pdfObjectsRun("", { rawBytes: pdf1 });
  if (!out1.includes("共 2 个对象 / 1 个流") || !out1.includes("Catalog") ||
      !out1.includes("FlateDecode") || !out1.includes("hello stream")) {
    throw new Error(`pdfObjects 自检①失败：\n${out1}`);
  }
  if (!out1.includes("0x00000009")) { // "%PDF-1.4\n" 9 字节 → 首对象偏移 9
    throw new Error(`pdfObjects 自检①偏移失败：\n${out1}`);
  }

  // ② zlibStore 合法性：自家 inflateZlib roundtrip
  const src2 = asciiBytes("hello stream");
  const back2 = inflateZlib(zlibStore(src2));
  if (back2.length !== src2.length || asciiPreview(back2, 64) !== "hello stream") {
    throw new Error("pdfObjects 自检②失败：zlibStore roundtrip 不一致");
  }

  // ③ 非 PDF 报错
  const out3 = pdfObjectsRun("", { rawBytes: asciiBytes("GIF89a not a pdf at all") });
  if (!out3.includes("不是 PDF")) throw new Error(`pdfObjects 自检③失败：\n${out3}`);

  // ④ 前置垃圾拼接：头扫描命中（%PDF 不在 0 偏移）
  const junk4 = new Uint8Array(16).fill(0x41);
  const out4 = pdfObjectsRun("", { rawBytes: concat(junk4, makePdf()) });
  if (!out4.includes("共 2 个对象 / 1 个流") || !out4.includes("0x00000010") ||
      !out4.includes("hello stream")) {
    throw new Error(`pdfObjects 自检④失败：\n${out4}`);
  }

  // ⑤ Filter 数组写法取首名 + Type/Subtype
  const img5 = zlibStore(asciiBytes("XYZ"));
  const pdf5 = latin1ToBytes(
    `%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Filter [ /FlateDecode /ASCIIHexDecode ] >>\n` +
    `stream\n${toLatin1(img5)}\nendstream\nendobj\n%%EOF\n`
  );
  const out5 = pdfObjectsRun("", { rawBytes: pdf5 });
  if (!out5.includes("type=XObject subtype=Image filter=FlateDecode") || !out5.includes("XYZ")) {
    throw new Error(`pdfObjects 自检⑤失败：\n${out5}`);
  }

  // ⑥ 截断件：末对象缺 endobj → 容错解析到文件尾，流照常定位
  const pdf6 = latin1ToBytes(`%PDF-1.5\n7 0 obj\n<< /Type /Page >>\n`);
  const out6 = pdfObjectsRun("", { rawBytes: pdf6 });
  if (!out6.includes("共 1 个对象") || !out6.includes("type=Page") || !out6.includes("7 0")) {
    throw new Error(`pdfObjects 自检⑥失败：\n${out6}`);
  }

  // ⑦ \r\n 行尾写法 + endstream 前 CR/LF 修剪（流数据恰 "abc"）
  const pdf7 = latin1ToBytes(`%PDF-1.4\r\n1 0 obj\r\n<< /Length 3 >>\r\nstream\r\nabc\r\nendstream\r\nendobj\r\n`);
  const out7 = pdfObjectsRun("", { rawBytes: pdf7 });
  if (!out7.includes("stream=3") || !out7.includes("abc")) {
    throw new Error(`pdfObjects 自检⑦失败：\n${out7}`);
  }

  // ⑧ decodeFlate=false：不走解压分支（无「→ 解压」），预览为 raw 字节点阵。
  // 注：测试载体是 stored 非压缩块，明文字面就在 raw 里——断言按行为路径写，
  // 不按明文可见性写。
  const out8 = pdfObjectsRun("", { rawBytes: pdf1, decodeFlate: false });
  if (!out8.includes("未解压") || out8.includes("→ 解压") || !out8.includes("x.")) {
    throw new Error(`pdfObjects 自检⑧失败：\n${out8}`);
  }

  // ⑨ hex 文本输入路径（inputEnc 默认 auto 优先 hex）
  const out9 = pdfObjectsRun(hexOf(pdf1), {});
  if (!out9.includes("共 2 个对象 / 1 个流") || !out9.includes("Catalog")) {
    throw new Error(`pdfObjects 自检⑨失败：\n${out9}`);
  }

  // ⑩ 无流 PDF：对象行照列，流段提示「无」
  const out10 = pdfObjectsRun("", { rawBytes: makePdf([{ dict: "<< /Type /Catalog >>" }]) });
  if (!out10.includes("共 1 个对象 / 0 个流") || !out10.includes("  无")) {
    throw new Error(`pdfObjects 自检⑩失败：\n${out10}`);
  }

  // ⑪ 空输入提示
  const out11 = pdfObjectsRun("", {});
  if (!out11.includes("空输入")) throw new Error(`pdfObjects 自检⑪失败：\n${out11}`);
})();

// ============ register ============

register({
  id: "pdfObjects", cat: "forensic", name: "PDF 对象解析",
  desc: "挖出 PDF 对象表：编号/偏移/长度/Type/Subtype/Filter/流长度逐对象列出，FlateDecode 流自动 zlib 解压并预览（页面内容流/隐藏文本/压缩 flag 藏身处）。词法容错扫描，xref 损坏、前置垃圾拼接、缺 endobj 截断件都能解",
  params: [
    { key: "inputEnc", label: "输入编码（文本输入时）", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ],
    },
    { key: "decodeFlate", label: "解压 FlateDecode 流", type: "bool", default: true },
  ],
  run: pdfObjectsRun,
  acceptsBytes: true,
});

export { pdfObjectsRun };
