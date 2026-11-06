/*
 * dataConvert.js — JSON / CSV / XML / YAML 纯函数转换（不注册 op）。
 *
 * 本文件只提供可被任意 op / 配方 / Worker 调用的纯函数：
 *   jsonBeautify(input, {indent=2})     JSON 美化
 *   jsonMinify(input)                   JSON 压缩（去空白）
 *   jsonToCsv(input, {delimiter=",", header=true, eol="\n"})
 *   csvToJson(text, {delimiter=",", header=true, trim=false, indent?})
 *   xmlBeautify(text, {indent=2})       XML 缩进美化（结构级，不做语义改写）
 *   yamlBeautify(text, {indent=2})      YAML 解析后按缩进重新 dump
 *   yamlMinify(text)                    YAML → 单行 JSON（JSON 是 YAML 1.2 子集）
 *   yamlToJson(text, {indent=0})        YAML → JSON 字符串（默认单行）
 *   jsonToYaml(input, {indent=2})       JSON → YAML
 *   parseCsvRows(text, delimiter)       RFC 4180 风格 CSV 行解析（导出供测试）
 *
 * 口径：
 *   - JSON / CSV 互转只处理对象数组、对象、原始值数组；嵌套对象/数组在 CSV 单元格里
 *     用 JSON 文本表示，避免伪造不存在的扁平化语义。
 *   - CSV 解析遵循 RFC 4180：引号包裹、"" 转义、字段内换行、CRLF/CR/LF 行尾。
 *   - XML 美化是「标签缩进 + 基本配平校验」，不是完整 XML DOM：
 *     纯文本元素保持单行（文本两端 trim），混合内容按节点拆行；
 *     属性原样保留，DOCTYPE/注释/CDATA/PI 原样输出。空白敏感文档请勿用美化结果做签名。
 *   - YAML 用本地 vendor/js-yaml 4.1.0，JSON_SCHEMA 安全解析，只产生 JSON 兼容类型
 *     （不做任意 JS 类型/自定义 tag）。锚点/别名由 js-yaml 展开为共享引用；dump 时
 *     重复引用会按 js-yaml 默认行为重新输出 &锚点 / *别名，循环引用仍可 dump。
 *     yamlMinify 的「压缩」口径是输出单行 JSON：JSON 是 YAML 1.2 的严格子集。
 *
 * 不新增 op id、不改 registerAll / main / i18n / edu；建议注册配置写在证据文件里。
 */

import { load as yamlLoad, dump as yamlDump, JSON_SCHEMA } from "../vendor/js-yaml.mjs";

// ============================================================
// JSON
// ============================================================
function parseJsonInput(input) {
  if (typeof input !== "string") return input;
  try {
    return JSON.parse(input);
  } catch (e) {
    const reason = e && e.message ? e.message : String(e);
    throw new Error(`JSON 解析失败：${reason}`);
  }
}

function normalizeIndent(raw, fallback = 2) {
  const v = raw == null ? fallback : raw;
  if (typeof v === "string") {
    if (v.length > 20 || /[^\t ]/.test(v)) {
      throw new Error(`缩进字符串只允许 0-20 个空格或制表符（拿到 ${JSON.stringify(v)}）`);
    }
    return v;
  }
  if (!Number.isInteger(v) || v < 0 || v > 10) {
    throw new Error(`缩进必须是 0-10 的整数（拿到 ${JSON.stringify(v)}）`);
  }
  return " ".repeat(v);
}

/** JSON 美化：解析后按 indent 重新序列化。 */
export function jsonBeautify(input, opts = {}) {
  const indent = normalizeIndent(opts.indent, 2);
  const value = parseJsonInput(input);
  return JSON.stringify(value, null, indent);
}

/** JSON 压缩：解析后去掉所有非必要空白。 */
export function jsonMinify(input) {
  const value = parseJsonInput(input);
  return JSON.stringify(value);
}

// ============================================================
// YAML（vendor/js-yaml 4.1.0，JSON_SCHEMA 安全解析）
// ============================================================
function parseYamlInput(text) {
  const s = String(text == null ? "" : text);
  try {
    return yamlLoad(s, { schema: JSON_SCHEMA });
  } catch (e) {
    const reason = e && e.message ? e.message : String(e);
    throw new Error(`YAML 解析失败：${reason}`);
  }
}

function normalizeYamlIndent(raw, fallback = 2) {
  const v = raw == null || raw === "" ? fallback : raw;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 10) {
    throw new Error(`YAML 缩进必须是 1-10 的整数（拿到 ${JSON.stringify(v)}）`);
  }
  return n;
}

function dumpYaml(value, indent) {
  try {
    return yamlDump(value, { indent, lineWidth: -1, schema: JSON_SCHEMA });
  } catch (e) {
    const reason = e && e.message ? e.message : String(e);
    throw new Error(`YAML 生成失败：${reason}`);
  }
}

/** YAML 美化：安全解析后按 indent 重新 dump（规范化缩进）。 */
export function yamlBeautify(text, opts = {}) {
  const indent = normalizeYamlIndent(opts.indent, 2);
  return dumpYaml(parseYamlInput(text), indent);
}

/** YAML 压缩：输出单行 JSON（JSON 是 YAML 1.2 严格子集，语义无歧义）。 */
export function yamlMinify(text) {
  const value = parseYamlInput(text);
  if (value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch (e) {
    const reason = e && e.message ? e.message : String(e);
    throw new Error(`YAML 压缩失败：${reason}`);
  }
}

/** YAML → JSON 字符串；默认单行（同 csvToJson），空文档按 null 输出，保证结果是合法 JSON。 */
export function yamlToJson(text, opts = {}) {
  const indent = normalizeIndent(opts.indent, 0);
  const value = parseYamlInput(text);
  try {
    return JSON.stringify(value === undefined ? null : value, null, indent);
  } catch (e) {
    const reason = e && e.message ? e.message : String(e);
    throw new Error(`YAML 转 JSON 失败：${reason}`);
  }
}

/** JSON → YAML；输入沿用 parseJsonInput 的错误口径。 */
export function jsonToYaml(input, opts = {}) {
  const indent = normalizeYamlIndent(opts.indent, 2);
  return dumpYaml(parseJsonInput(input), indent);
}

// ============================================================
// CSV
// ============================================================
function normalizeDelimiter(raw) {
  const d = raw == null ? "," : String(raw);
  if (d.length !== 1) throw new Error(`CSV 分隔符必须是单个字符（拿到 ${JSON.stringify(d)}）`);
  if (d === "\"" || d === "\r" || d === "\n") {
    throw new Error(`CSV 分隔符不能是引号或换行（拿到 ${JSON.stringify(d)}）`);
  }
  return d;
}

/**
 * RFC 4180 风格 CSV 行解析。
 * 返回 string[][]；空输入返回 []。引号未闭合抛错。
 */
export function parseCsvRows(text, delimiter = ",") {
  const d = normalizeDelimiter(delimiter);
  let s = String(text == null ? "" : text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  if (s === "") return [];

  const rows = [];
  let row = [];
  let field = "";
  let fieldStarted = false;
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (s[i + 1] === "\"") {
          field += "\"";
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === "\"" && field === "") {
      inQuotes = true;
      fieldStarted = true;
      i++;
      continue;
    }
    if (ch === d) {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      pushRow();
      i += ch === "\r" && s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    field += ch;
    i++;
  }

  if (inQuotes) throw new Error("CSV 解析失败：引号未闭合（字段内 \"\" 表示一个字面量引号）");
  if (field !== "" || row.length > 0 || fieldStarted) pushRow();
  return rows;
}

function csvCell(value, delimiter) {
  if (value == null) return "";
  let s;
  if (typeof value === "string") s = value;
  else if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") s = String(value);
  else {
    const j = JSON.stringify(value);
    s = j === undefined ? "" : j;
  }
  if (s.includes("\"") || s.includes(delimiter) || /[\r\n]/.test(s)) {
    return "\"" + s.replace(/"/g, "\"\"") + "\"";
  }
  return s;
}

/**
 * JSON → CSV。
 * - 对象数组：列 = 所有对象键的并集（首次出现顺序）；
 * - 原始值数组：单列 value；
 * - 二维数组：每行原样输出，不生成表头；
 * - 单个对象：当作一行。
 * 嵌套对象/数组在单元格内序列化为 JSON 文本。空数组返回 ""。
 */
export function jsonToCsv(input, opts = {}) {
  const delimiter = normalizeDelimiter(opts.delimiter);
  const eol = opts.eol == null ? "\n" : String(opts.eol);
  if (eol !== "\n" && eol !== "\r\n" && eol !== "\r") {
    throw new Error(`CSV 行尾只支持 \\n / \\r\\n / \\r（拿到 ${JSON.stringify(eol)}）`);
  }
  const useHeader = opts.header !== false;
  const data = parseJsonInput(input);

  let columns;
  let rows;
  let emitHeader = useHeader;

  if (Array.isArray(data)) {
    if (data.length === 0) return "";
    const allObjects = data.every((v) => v !== null && typeof v === "object" && !Array.isArray(v));
    const allArrays = data.every((v) => Array.isArray(v));
    const allPrimitive = data.every((v) => v === null || typeof v !== "object");
    if (allObjects) {
      const seen = new Set();
      columns = [];
      for (const obj of data) {
        for (const key of Object.keys(obj)) {
          if (!seen.has(key)) { seen.add(key); columns.push(key); }
        }
      }
      rows = data.map((obj) => columns.map((c) => obj[c]));
    } else if (allArrays) {
      const width = Math.max(...data.map((r) => r.length));
      columns = Array.from({ length: width }, (_, i) => String(i + 1));
      rows = data;
      emitHeader = false;
    } else if (allPrimitive) {
      columns = ["value"];
      rows = data.map((v) => [v]);
    } else {
      throw new Error("JSON 转 CSV：数组元素必须同为对象、同类数组或同类原始值，不能混合");
    }
  } else if (data !== null && typeof data === "object") {
    columns = Object.keys(data);
    rows = [columns.map((c) => data[c])];
  } else {
    throw new Error("JSON 转 CSV：顶层必须是对象或数组");
  }

  const lines = [];
  if (emitHeader && columns.length > 0) lines.push(columns.map((c) => csvCell(c, delimiter)).join(delimiter));
  for (const r of rows) {
    const cells = [];
    for (let i = 0; i < columns.length; i++) cells.push(csvCell(r[i], delimiter));
    lines.push(cells.join(delimiter));
  }
  return lines.join(eol);
}

/**
 * CSV → JSON 字符串。
 * header=true（默认）：首行作表头，输出对象数组；空表头列自动命名 columnN，重名抛错。
 * header=false：输出二维字符串数组。
 * 数据行比表头多列时抛错（不静默丢列）；少列补空串。
 */
export function csvToJson(text, opts = {}) {
  const delimiter = normalizeDelimiter(opts.delimiter);
  const useHeader = opts.header !== false;
  const trim = opts.trim === true;
  const rows = parseCsvRows(text, delimiter);
  if (rows.length === 0) return "[]";

  let out;
  if (!useHeader) {
    out = rows.map((r) => (trim ? r.map((v) => v.trim()) : r));
  } else {
    const header = rows[0].map((h, i) => {
      const name = trim ? h.trim() : h;
      return name === "" ? `column${i + 1}` : name;
    });
    const seen = new Set();
    for (const name of header) {
      if (seen.has(name)) throw new Error(`CSV 表头重名 ${JSON.stringify(name)}：请先改名，避免对象键覆盖丢列`);
      seen.add(name);
    }
    out = [];
    for (let r = 1; r < rows.length; r++) {
      const src = rows[r];
      if (src.length > header.length) {
        throw new Error(`CSV 第 ${r + 1} 行有 ${src.length} 列，超过表头 ${header.length} 列（不静默丢列）`);
      }
      const obj = {};
      for (let i = 0; i < header.length; i++) {
        const v = i < src.length ? src[i] : "";
        obj[header[i]] = trim ? v.trim() : v;
      }
      out.push(obj);
    }
  }

  const indent = opts.indent == null ? 0 : opts.indent;
  if (indent === 0) return JSON.stringify(out);
  return JSON.stringify(out, null, normalizeIndent(indent));
}

// ============================================================
// XML 美化
// ============================================================
const XML_NAME = "[A-Za-z_][\\w:.\\-]*";
const XML_CLOSE_RE = new RegExp(`^<\\/(${XML_NAME})\\s*>`);
const XML_OPEN_RE = new RegExp(`^<(${XML_NAME})((?:[^>"']|"[^"]*"|'[^']*')*)>`);

function tokenizeXml(s) {
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] !== "<") {
      let j = s.indexOf("<", i);
      if (j < 0) j = s.length;
      tokens.push({ type: "text", raw: s.slice(i, j) });
      i = j;
      continue;
    }
    if (s.startsWith("<!--", i)) {
      const end = s.indexOf("-->", i + 4);
      if (end < 0) throw new Error(`XML 美化：注释未闭合（位置 ${i}）`);
      tokens.push({ type: "comment", raw: s.slice(i, end + 3) });
      i = end + 3;
      continue;
    }
    if (s.startsWith("<![CDATA[", i)) {
      const end = s.indexOf("]]>", i + 9);
      if (end < 0) throw new Error(`XML 美化：CDATA 未闭合（位置 ${i}）`);
      tokens.push({ type: "cdata", raw: s.slice(i, end + 3) });
      i = end + 3;
      continue;
    }
    if (s.startsWith("<?", i)) {
      const end = s.indexOf("?>", i + 2);
      if (end < 0) throw new Error(`XML 美化：处理指令未闭合（位置 ${i}）`);
      tokens.push({ type: "pi", raw: s.slice(i, end + 2) });
      i = end + 2;
      continue;
    }
    if (s.startsWith("<!", i)) {
      let j = i + 2;
      let depth = 0;
      let quote = "";
      for (; j < s.length; j++) {
        const ch = s[j];
        if (quote) {
          if (ch === quote) quote = "";
          continue;
        }
        if (ch === "\"" || ch === "'") { quote = ch; continue; }
        if (ch === "[") { depth++; continue; }
        if (ch === "]") { if (depth > 0) depth--; continue; }
        if (ch === ">" && depth === 0) break;
      }
      if (j >= s.length) throw new Error(`XML 美化：声明未闭合（位置 ${i}）`);
      tokens.push({ type: "decl", raw: s.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    const rest = s.slice(i);
    const close = XML_CLOSE_RE.exec(rest);
    if (close) {
      tokens.push({ type: "close", name: close[1], raw: close[0] });
      i += close[0].length;
      continue;
    }
    const open = XML_OPEN_RE.exec(rest);
    if (open) {
      const raw = open[0];
      const selfClosing = /\/\s*$/.test(open[2] || "");
      tokens.push({ type: selfClosing ? "self" : "open", name: open[1], raw });
      i += raw.length;
      continue;
    }
    throw new Error(`XML 美化：位置 ${i} 不是合法 XML 标签或文本（文本中的 < 必须写成 &lt;）`);
  }
  return tokens;
}

function parseXmlTree(s) {
  const tokens = tokenizeXml(s);
  const root = { type: "root", children: [] };
  const stack = [root];
  for (const tok of tokens) {
    const parent = stack[stack.length - 1];
    if (tok.type === "open") {
      const node = { type: "element", name: tok.name, open: tok.raw, close: null, selfClosing: false, children: [] };
      parent.children.push(node);
      stack.push(node);
    } else if (tok.type === "self") {
      parent.children.push({ type: "element", name: tok.name, open: tok.raw, close: null, selfClosing: true, children: [] });
    } else if (tok.type === "close") {
      if (stack.length === 1) throw new Error(`XML 美化：多余的结束标签 ${tok.raw}`);
      const node = stack.pop();
      if (node.name !== tok.name) {
        throw new Error(`XML 美化：标签不匹配（打开 <${node.name}>，关闭 ${tok.raw}）`);
      }
      node.close = tok.raw;
    } else {
      parent.children.push(tok);
    }
  }
  if (stack.length !== 1) {
    const node = stack[stack.length - 1];
    throw new Error(`XML 美化：标签未闭合 <${node.name}>`);
  }
  return root;
}

function serializeXmlNode(node, depth, indent, out) {
  const pad = indent.repeat(depth);
  if (node.type === "text") {
    const t = node.raw.trim();
    if (t !== "") out.push(pad + t);
    return;
  }
  if (node.type !== "element") {
    out.push(pad + node.raw);
    return;
  }
  if (node.selfClosing) {
    out.push(pad + node.open);
    return;
  }
  const kids = node.children.filter((c) => !(c.type === "text" && c.raw.trim() === ""));
  if (kids.length === 0) {
    out.push(pad + node.open + (node.close || `</${node.name}>`));
    return;
  }
  if (kids.length === 1 && kids[0].type === "text") {
    out.push(pad + node.open + kids[0].raw.trim() + node.close);
    return;
  }
  out.push(pad + node.open);
  for (const child of kids) serializeXmlNode(child, depth + 1, indent, out);
  out.push(pad + node.close);
}

/** XML 结构美化：只重排缩进，保留属性/注释/CDATA/DOCTYPE/PI 原文。 */
export function xmlBeautify(text, opts = {}) {
  const indent = normalizeIndent(opts.indent, 2);
  const tree = parseXmlTree(String(text == null ? "" : text));
  const out = [];
  for (const child of tree.children) serializeXmlNode(child, 0, indent, out);
  return out.join("\n");
}
