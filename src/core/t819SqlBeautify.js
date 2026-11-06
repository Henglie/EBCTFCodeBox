/*
 * t819SqlBeautify.js —— CyberChef #383 "SQL Beautify" 同源实现。
 * 依赖 sql-formatter 15.8.2；方言固定 mysql，绑定变量 :name 先占位再还原。
 */
import { register } from "./registry.js";
import { parseEscapedChars } from "./t819Common.js";

let _format;
async function format() {
  if (!_format) _format = (await import("../vendor/t819/sql-formatter.mjs")).default.format;
  return _format;
}

register({
  id: "sqlBeautify",
  cat: "text",
  io: "text",
  name: "SQL 美化",
  desc: "缩进并美化 SQL 代码，保留 :name 绑定变量（CyberChef #383）",
  params: [
    { key: "indent", label: "缩进字符串", type: "text", default: "\\t", placeholder: "\\t" },
  ],
  async run(text, p) {
    const doFormat = await format();
    const indentStr = parseEscapedChars(p && p.indent != null ? p.indent : "\\t");
    const input = String(text == null ? "" : text);

    const bindRegex = /:\w+/g;
    const bindMap = {};
    let bindCounter = 0;
    const placeholderInput = input.replace(bindRegex, (match) => {
      const placeholder = `__BIND_${bindCounter++}__`;
      bindMap[placeholder] = match;
      return placeholder;
    });

    let formatted = doFormat(placeholderInput, {
      language: "mysql",
      useTabs: indentStr === "\t",
      tabWidth: indentStr.length || 4,
      indentStyle: "standard",
    });

    formatted = formatted.replace(/__BIND_\d+__/g, (match) => bindMap[match] || match);
    return formatted;
  },
});
