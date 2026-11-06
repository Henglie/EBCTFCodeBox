/*
 * t819CssSelector.js —— CyberChef #54 "CSS selector" 同源实现。
 * 依赖 @xmldom/xmldom 0.8.13 + nwmatcher 1.4.4（CC 11.2.0 实际依赖）。
 */
import { register } from "./registry.js";
import { parseEscapedChars } from "./t819Common.js";

let _mods;
async function mods() {
  if (!_mods) {
    const [x, n] = await Promise.all([
      import("../vendor/t819/xmldom.mjs"),
      import("../vendor/t819/nwmatcher.mjs"),
    ]);
    _mods = { xmldom: x.default, nwmatcher: n.default };
  }
  return _mods;
}

register({
  id: "cssSelector",
  cat: "text",
  io: "text",
  name: "CSS 选择器",
  desc: "用 CSS 选择器从 HTML 文档中提取节点，多个结果按分隔符连接（CyberChef #54）",
  params: [
    { key: "query", label: "CSS 选择器", type: "text", default: "" },
    { key: "delimiter", label: "分隔符", type: "text", default: "\\n", placeholder: "\\n" },
  ],
  async run(text, p) {
    const query = String(p && p.query != null ? p.query : "");
    const delimiter = parseEscapedChars(p && p.delimiter != null ? p.delimiter : "\\n");
    const input = String(text == null ? "" : text);

    if (!query.length || !input.length) return "";

    const { xmldom, nwmatcher } = await mods();
    let dom;
    try {
      dom = new xmldom.DOMParser().parseFromString(input);
    } catch (err) {
      throw new Error("Invalid input HTML.");
    }

    let result;
    try {
      const matcher = nwmatcher({ document: dom });
      result = matcher.select(query, dom);
    } catch (err) {
      throw new Error("Invalid CSS Selector. Details:\n" + err.message);
    }

    return result.map((node) => node.toString()).join(delimiter);
  },
});
