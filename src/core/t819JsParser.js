/*
 * t819JsParser.js —— CyberChef #241 "JavaScript Parser" 同源实现。
 * 依赖 esprima 4.0.1。
 */
import { register } from "./registry.js";

let _esprima;
async function esprima() {
  if (!_esprima) _esprima = (await import("../vendor/t819/esprima.mjs")).default;
  return _esprima;
}

register({
  id: "jsParser",
  cat: "text",
  name: "JavaScript 解析",
  desc: "解析 JavaScript 代码并输出抽象语法树（AST）JSON（CyberChef #241）",
  params: [
    { key: "loc", label: "位置信息（loc）", type: "bool", default: false },
    { key: "range", label: "范围信息（range）", type: "bool", default: false },
    { key: "tokens", label: "包含 tokens 数组", type: "bool", default: false },
    { key: "comments", label: "包含注释数组", type: "bool", default: false },
    { key: "tolerant", label: "报告错误并尽量继续", type: "bool", default: false },
  ],
  async run(text, p) {
    const lib = await esprima();
    const options = {
      loc: !!(p && p.loc),
      range: !!(p && p.range),
      tokens: !!(p && p.tokens),
      comment: !!(p && p.comments),
      tolerant: !!(p && p.tolerant),
    };
    const result = lib.parseScript(String(text == null ? "" : text), options);
    return JSON.stringify(result, null, 2);
  },
});
