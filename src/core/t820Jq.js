/*
 * t820Jq.js — jq JSON 查询（CyberChef #242）。
 *
 * 口径与 CyberChef src/core/operations/Jq.mjs 一致：输入先按 JSON 解析，
 * 查询结果的字符串在 Raw 开时原样输出，否则 JSON.stringify；表达式/解析错误明确报错。
 * 引擎：src/vendor/jq-web/jq.asm.bundle.min.mjs（jq-web 0.5.1，ISC；
 * 与 CC 使用同一个 jq.asm.bundle.min.js，asm.js + 内存镜像内嵌，UMD 尾部 ESM 化）。
 * 懒加载：首次使用才载入 ~1.75MB，零外发；加载失败给明确错误。
 */
import { register } from "./registry.js";

let _jqPromise = null;

function getJq() {
  if (!_jqPromise) {
    _jqPromise = import("../vendor/jq-web/jq.asm.bundle.min.mjs")
      .then((m) => new Promise((resolve, reject) => {
        const jq = m.default;
        try {
          // jq-web 的 addListener 在已初始化时会立即回调，重复调用安全。
          jq.onInitialized.addListener(() => resolve(jq));
        } catch (e) {
          reject(e);
        }
      }))
      .catch((err) => {
        _jqPromise = null;
        throw new Error("jq 引擎加载失败：" + (err && err.message ? err.message : String(err)));
      });
  }
  return _jqPromise;
}

register({
  id: "jqQuery",
  cat: "data",
  name: "jq JSON 查询",
  desc: "用 jq 表达式查询 JSON（如 .foo.bar、.[] | .name）；Raw 开时字符串结果不加引号。口径同 CyberChef「Jq」",
  params: [
    { key: "query", label: "Query", type: "text", default: "", placeholder: ".foo" },
    { key: "raw", label: "Raw", type: "bool", default: false },
  ],
  async run(text, p) {
    const query = String(p.query == null ? "" : p.query);
    let input;
    try {
      input = JSON.parse(String(text == null ? "" : text));
    } catch (e) {
      throw new Error("输入不是合法 JSON：" + (e && e.message ? e.message : String(e)));
    }
    const jq = await getJq();
    let result;
    try {
      result = jq.json(input, query);
    } catch (e) {
      throw new Error("jq 表达式错误：" + (e && e.message ? e.message : String(e)));
    }
    if (p.raw && typeof result === "string") return result;
    const out = JSON.stringify(result);
    return out === undefined ? "" : out;
  },
});
