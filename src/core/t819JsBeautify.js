/*
 * t819JsBeautify.js —— CyberChef #239 "JavaScript Beautify" 同源实现。
 * 依赖 esprima 4.0.1 + escodegen 2.1.0。
 */
import { register } from "./registry.js";
import { parseEscapedChars } from "./t819Common.js";

let _mods;
async function mods() {
  if (!_mods) {
    const [esprima, escodegen] = await Promise.all([
      import("../vendor/t819/esprima.mjs"),
      import("../vendor/t819/escodegen.mjs"),
    ]);
    _mods = { esprima: esprima.default, escodegen: escodegen.default };
  }
  return _mods;
}

register({
  id: "jsBeautify",
  cat: "text",
  name: "JavaScript 美化",
  desc: "解析并美化 JavaScript 代码，支持缩进、引号、分号与注释选项（CyberChef #239）",
  params: [
    { key: "indent", label: "缩进字符串", type: "text", default: "\\t", placeholder: "\\t" },
    {
      key: "quotes",
      label: "引号",
      type: "select",
      default: "auto",
      options: [
        { value: "auto", label: "自动（Auto）" },
        { value: "single", label: "单引号（Single）" },
        { value: "double", label: "双引号（Double）" },
      ],
    },
    { key: "semicolons", label: "右花括号前加分号", type: "bool", default: true },
    { key: "comments", label: "保留注释", type: "bool", default: true },
  ],
  async run(text, p) {
    const { esprima, escodegen } = await mods();
    const rawIndent = String(p && p.indent != null ? p.indent : "\\t");
    const beautifyIndent = rawIndent === "" ? "\\t" : parseEscapedChars(rawIndent);
    const quotes = String(p && p.quotes != null ? p.quotes : "auto").toLowerCase();
    const beautifySemicolons = p && p.semicolons !== undefined ? !!p.semicolons : true;
    const beautifyComment = p && p.comments !== undefined ? !!p.comments : true;

    try {
      let AST = esprima.parseScript(String(text == null ? "" : text), {
        range: true,
        tokens: true,
        comment: true,
      });

      const options = {
        format: {
          indent: { style: beautifyIndent },
          quotes,
          semicolons: beautifySemicolons,
        },
        comment: beautifyComment,
      };

      if (options.comment) AST = escodegen.attachComments(AST, AST.comments, AST.tokens);

      return escodegen.generate(AST, options);
    } catch (e) {
      throw new Error("Unable to parse JavaScript.<br>" + e.message);
    }
  },
});
