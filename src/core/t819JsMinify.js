/*
 * t819JsMinify.js —— CyberChef #240 "JavaScript Minify" 同源实现。
 * 依赖 terser 5.48.0。
 */
import { register } from "./registry.js";

let _terser;
async function terser() {
  if (!_terser) _terser = (await import("../vendor/t819/terser.mjs")).default;
  return _terser;
}

register({
  id: "jsMinify",
  cat: "text",
  name: "JavaScript 压缩",
  desc: "用 terser 压缩 JavaScript 代码，移除空白并缩短局部变量名（CyberChef #240）",
  params: [],
  async run(text) {
    const lib = await terser();
    const result = await lib.minify(String(text == null ? "" : text));
    if (result.error) {
      throw new Error(`Error minifying JavaScript. (${result.error})`);
    }
    return result.code;
  },
});
