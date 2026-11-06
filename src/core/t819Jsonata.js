/*
 * t819Jsonata.js —— CyberChef #243 "Jsonata Query" 同源实现。
 * 依赖 jsonata 2.2.1；base64decode/base64encode 用 atob/btoa 覆盖，
 * 与 CC 在 Web Worker 下的处理一致。
 */
import { register } from "./registry.js";

let _jsonata;
async function jsonata() {
  if (!_jsonata) _jsonata = (await import("../vendor/t819/jsonata.mjs")).default;
  return _jsonata;
}

register({
  id: "jsonataQuery",
  cat: "data",
  io: "text",
  name: "Jsonata 查询",
  desc: "用 Jsonata 表达式查询和转换 JSON 数据，输出 JSON 字符串（CyberChef #243）",
  params: [{ key: "query", label: "查询表达式", type: "text", default: "string" }],
  async run(text, p) {
    const query = String(p && p.query != null ? p.query : "string");
    let jsonObj;
    try {
      jsonObj = JSON.parse(String(text == null ? "" : text));
    } catch (err) {
      throw new Error(`Invalid input JSON: ${err.message}`);
    }

    try {
      const lib = await jsonata();
      const expression = lib(query);
      expression.registerFunction(
        "base64decode",
        (str) => {
          if (typeof str === "undefined") return undefined;
          return atob(str);
        },
        "<s-:s>"
      );
      expression.registerFunction(
        "base64encode",
        (str) => {
          if (typeof str === "undefined") return undefined;
          return btoa(str);
        },
        "<s-:s>"
      );
      const result = await expression.evaluate(jsonObj);
      return JSON.stringify(result === undefined ? "" : result);
    } catch (err) {
      throw new Error(`Invalid Jsonata Expression: ${err.message}`);
    }
  },
});
