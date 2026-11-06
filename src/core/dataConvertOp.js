/*
 * dataConvertOp.js — dataConvert 注册层（薄封装）。
 *
 * 纯函数与格式口径在 dataConvert.js；本文件只负责把 9 个模式接到 registry。
 * 依据：
 *   - RFC 8259（JSON 数据交换格式）
 *   - RFC 4180（CSV 格式与 MIME 类型）
 *   - W3C XML 1.0（标签/属性/CDATA/DOCTYPE 语法；本工具只做结构缩进，不做 DOM 语义改写）
 *   - YAML 1.2 / js-yaml 4.1.0（JSON_SCHEMA 安全解析；JSON 是 YAML 1.2 子集）
 *
 * 红线：纯本地计算，零外发；不读 DOM、不读存储。
 */

import { register } from "./registry.js";
import {
  jsonBeautify, jsonMinify, jsonToCsv, csvToJson, xmlBeautify,
  yamlBeautify, yamlMinify, yamlToJson, jsonToYaml,
} from "./dataConvert.js";

function readIndent(raw) {
  if (raw == null || raw === "") return 2;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10) {
    throw new Error(`缩进必须是 0-10 的整数（拿到 ${JSON.stringify(raw)}）`);
  }
  return n;
}

register({
  id: "dataConvert",
  cat: "data",
  name: "JSON / CSV / XML / YAML 转换",
  desc:
    "JSON 美化/压缩、JSON↔CSV、XML 结构美化、YAML 美化/压缩/JSON↔YAML。JSON→CSV 支持对象数组/对象/原始值数组/二维数组，" +
    "嵌套对象或数组在单元格里写成 JSON 文本；CSV 按 RFC 4180 处理引号、双引号转义与字段内换行。" +
    "XML 只重排缩进并校验标签配平，不改属性/CDATA/DOCTYPE 语义；YAML 用 JSON_SCHEMA 安全解析，" +
    "锚点/别名按 js-yaml 行为展开或重新输出",
  params: [
    { key: "mode", label: "模式", type: "select", default: "jsonBeautify",
      options: [
        { value: "jsonBeautify", label: "JSON 美化" },
        { value: "jsonMinify", label: "JSON 压缩" },
        { value: "jsonToCsv", label: "JSON → CSV" },
        { value: "csvToJson", label: "CSV → JSON" },
        { value: "xmlBeautify", label: "XML 美化" },
        { value: "yamlBeautify", label: "YAML 美化" },
        { value: "yamlMinify", label: "YAML 压缩（单行 JSON）" },
        { value: "yamlToJson", label: "YAML → JSON" },
        { value: "jsonToYaml", label: "JSON → YAML" },
      ] },
    { key: "indent", label: "缩进（JSON/YAML 美化 / CSV→JSON / YAML→JSON / JSON→YAML / XML 美化）", type: "number", default: 2, placeholder: "JSON 0-10；YAML 1-10" },
    { key: "sortKeys", label: "JSON Beautify：递归排序对象键", type: "bool", default: false },
    { key: "formatted", label: "JSON Beautify：格式化（关闭则单行）", type: "bool", default: true },
    { key: "delimiter", label: "CSV 分隔符", type: "text", default: ",", placeholder: "单个字符，如 , 或 ;" },
    { key: "header", label: "CSV 首行作表头", type: "bool", default: true },
  ],
  run(text, p) {
    const o = p || {};
    const mode = String(o.mode || "jsonBeautify");
    const indent = readIndent(o.indent);
    const delimiter = o.delimiter == null ? "," : o.delimiter;
    const header = o.header !== false;
    switch (mode) {
      case "jsonBeautify":
        return jsonBeautify(text, { indent, sortKeys: !!o.sortKeys, formatted: o.formatted !== false });
      case "jsonMinify":
        return jsonMinify(text);
      case "jsonToCsv":
        return jsonToCsv(text, { delimiter, header });
      case "csvToJson":
        return csvToJson(text, { delimiter, header, indent });
      case "xmlBeautify":
        return xmlBeautify(text, { indent });
      case "yamlBeautify":
        return yamlBeautify(text, { indent: o.indent });
      case "yamlMinify":
        return yamlMinify(text);
      case "yamlToJson":
        return yamlToJson(text, { indent });
      case "jsonToYaml":
        return jsonToYaml(text, { indent: o.indent });
      default:
        throw new Error(`未知 mode ${JSON.stringify(mode)}：只支持 jsonBeautify / jsonMinify / jsonToCsv / csvToJson / xmlBeautify / yamlBeautify / yamlMinify / yamlToJson / jsonToYaml`);
    }
  },
});
