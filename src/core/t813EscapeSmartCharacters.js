/*
 * t813EscapeSmartCharacters.js — 转义智能字符（CyberChef #115）。
 *
 * 映射表与 CyberChef src/core/operations/EscapeSmartCharacters.mjs 逐项一致（智能引号/破折号/省略号/
 * ©®™/箭头/书名号/数学符号/非 ASCII 空格）；无法映射的非 ASCII 字符按 Include/Remove/Replace with '.' 处理。
 * 纯文本运算，零依赖、零外发。
 */
import { register } from "./registry.js";

const SMART_MAP = new Map([
  // 智能双引号
  ["\u201C", "\""], ["\u201D", "\""], ["\u201E", "\""], ["\u201F", "\""], ["\u2033", "\""],
  // 智能单引号 / 撇号
  ["\u2018", "'"], ["\u2019", "'"], ["\u201A", "'"], ["\u201B", "'"], ["\u2032", "'"],
  // 连字符 / 破折号
  ["\u2010", "-"], ["\u2011", "-"], ["\u2012", "-"], ["\u2013", "-"], ["\u2014", "--"], ["\u2015", "--"],
  // 省略号
  ["\u2026", "..."],
  // 商标 / 版权
  ["\u00A9", "(c)"], ["\u00AE", "(r)"], ["\u2122", "(tm)"],
  // 箭头
  ["\u2190", "<--"], ["\u2192", "-->"], ["\u2191", "^"], ["\u2193", "v"], ["\u2194", "<->"],
  ["\u21D0", "<=="], ["\u21D2", "==>"], ["\u21D4", "<=>"],
  // 书名号
  ["\u00AB", "<<"], ["\u00BB", ">>"], ["\u2039", "<"], ["\u203A", ">"],
  // 数学 / 杂项
  ["\u00D7", "x"], ["\u00F7", "/"], ["\u00B1", "+/-"], ["\u2022", "*"], ["\u00B7", "."],
  // 非 ASCII 空格
  ["\u00A0", " "], ["\u2002", " "], ["\u2003", " "], ["\u2009", " "], ["\u200A", " "],
]);

register({
  id: "escapeSmartChars",
  cat: "text",
  name: "转义智能字符",
  desc: "把智能引号、长短破折号、省略号、©®™、箭头、书名号等排版字符转为 ASCII；无法映射的非 ASCII 字符可选保留/删除/替换为点",
  params: [
    { key: "unmappable", label: "无法映射字符", type: "select", default: "include", options: [
      { value: "include", label: "保留（Include）" },
      { value: "remove", label: "删除（Remove）" },
      { value: "dot", label: "替换为 '.'" },
    ] },
  ],
  run(text, p) {
    const unmappable = (p && p.unmappable) ? String(p.unmappable) : "include";
    let result = "";
    for (const ch of String(text == null ? "" : text)) {
      if (ch.codePointAt(0) < 128) {
        result += ch;
      } else if (SMART_MAP.has(ch)) {
        result += SMART_MAP.get(ch);
      } else if (unmappable === "remove") {
        continue;
      } else if (unmappable === "dot") {
        result += ".";
      } else {
        result += ch;
      }
    }
    return result;
  },
});
