/*
 * t819XPath.js —— CyberChef #496 "XPath expression" 同源实现。
 * 依赖 @xmldom/xmldom 0.8.13 + xpath 0.0.34。
 */
import { register } from "./registry.js";
import { parseEscapedChars } from "./t819Common.js";

let _mods;
async function mods() {
  if (!_mods) {
    const [x, xp] = await Promise.all([
      import("../vendor/t819/xmldom.mjs"),
      import("../vendor/t819/xpath.mjs"),
    ]);
    _mods = { xmldom: x.default, xpath: xp.default };
  }
  return _mods;
}

register({
  id: "xpathQuery",
  cat: "text",
  io: "text",
  name: "XPath 表达式",
  desc: "用 XPath 从 XML 文档中提取节点，多个结果按分隔符连接（CyberChef #496）",
  params: [
    { key: "query", label: "XPath", type: "text", default: "" },
    { key: "delimiter", label: "结果分隔符", type: "text", default: "\\n", placeholder: "\\n" },
  ],
  async run(text, p) {
    const query = String(p && p.query != null ? p.query : "");
    const delimiter = parseEscapedChars(p && p.delimiter != null ? p.delimiter : "\\n");
    const input = String(text == null ? "" : text);
    const { xmldom, xpath } = await mods();

    let doc;
    try {
      doc = new xmldom.DOMParser({
        errorHandler: {
          fatalError(e) {
            throw e;
          },
        },
      }).parseFromString(input, "application/xml");
    } catch (err) {
      throw new Error("Invalid input XML.");
    }

    let nodes;
    try {
      nodes = xpath.parse(query).select({ node: doc, allowAnyNamespaceForNoPrefix: true });
    } catch (err) {
      throw new Error(`Invalid XPath. Details:\n${err.message}.`);
    }

    return nodes.map((node) => node.toString()).join(delimiter);
  },
});
