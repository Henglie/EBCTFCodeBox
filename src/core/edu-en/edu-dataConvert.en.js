/*
 * edu-dataConvert.en.js — English edu card for the dataConvert op.
 * Source: edu/edu-dataConvert.js, translated 1:1. Example vectors (in/out/param)
 * are copied verbatim; only prose is translated. Aka keeps the Chinese aliases
 * and adds English ones.
 */
export default {
  dataConvert: {
    what:
      "A converter and formatter for three common structured-data formats: JSON, CSV and XML. It beautifies/minifies JSON, converts JSON to/from CSV, and re-indents XML. It handles data formats, not encryption.",
    principle:
      "JSON is the text data-interchange format defined by RFC 8259; its grammar has only objects, arrays, strings, numbers, booleans and null. Beautifying parses the input and re-serializes it with indentation; minifying removes non-essential whitespace." +
      "CSV follows RFC 4180: fields are separated by a delimiter, and a field containing the delimiter, a quote or a line break is wrapped in double quotes, with an internal quote written as two quotes." +
      "For JSON→CSV, an array of objects uses the union of all keys as the header. Nested objects or arrays have no universal flattening semantics, so the cell keeps them as JSON text instead of inventing columns." +
      "CSV has no type system: a JSON number, boolean or null comes back as a string or an empty cell, so `20` becomes `\"20\"` in CSV→JSON. That is a format limitation, not a round-trip bug.\n\n" +
      "XML beautifying only indents tags and checks that they balance: attributes, comments, CDATA, DOCTYPE and processing instructions are kept verbatim, and text-only elements stay on one line. It is not a full DOM parser and does not change semantics; do not sign or hash whitespace-sensitive documents after beautifying." +
      "YAML uses js-yaml 4.1.0 with JSON_SCHEMA for safe parsing, and supports beautify/minify plus JSON↔YAML; anchors/aliases follow the library behavior and arbitrary JS types are not executed.",
    usage:
      "Pick a direction in `mode`: `JSON beautify`, `JSON minify`, `JSON → CSV`, `CSV → JSON`, `XML beautify`, `YAML beautify`, `YAML minify`, `YAML → JSON` or `JSON → YAML`.\n" +
      "`indent` sets the number of spaces (0-10, 0 means no indentation) for beautifying modes; `delimiter` is the single-character CSV separator (comma, semicolon, tab, etc.); `header` controls whether the first CSV row is treated as the header.\n" +
      "For JSON→CSV the header is the union of all object keys in first-occurrence order. For CSV→JSON, duplicate headers raise an error and data rows with more columns than the header also raise an error rather than silently dropping columns. Empty or malformed input reports a concrete position or reason.",
    examples: [
      { in: "{\"a\":1,\"b\":[true,null]}", param: "mode=jsonBeautify, indent=2", out: "{\n  \"a\": 1,\n  \"b\": [\n    true,\n    null\n  ]\n}" },
      { in: "{ \"a\" : 1 , \"b\" : [ true , null ] }", param: "mode=jsonMinify", out: "{\"a\":1,\"b\":[true,null]}" },
      { in: "[{\"name\":\"张三\",\"age\":20},{\"name\":\"李四\",\"age\":21}]", param: "mode=jsonToCsv, delimiter=,, header=true", out: "name,age\n张三,20\n李四,21" },
      { in: "name,age\n张三,20\n李四,21", param: "mode=csvToJson, delimiter=,, header=true, indent=0", out: "[{\"name\":\"张三\",\"age\":\"20\"},{\"name\":\"李四\",\"age\":\"21\"}]" },
      { in: "<root><a>1</a><b><c>2</c></b></root>", param: "mode=xmlBeautify, indent=2", out: "<root>\n  <a>1</a>\n  <b>\n    <c>2</c>\n  </b>\n</root>" },
      { in: "name: 张三\nage: 20\ntags:\n  - ctf\n  - crypto", param: "mode=yamlToJson, indent=2", out: "{\n  \"name\": \"张三\",\n  \"age\": 20,\n  \"tags\": [\n    \"ctf\",\n    \"crypto\"\n  ]\n}" },
    ],
    tips: [
      "CSV has no types: JSON numbers, booleans and null become strings or empty cells after a round trip. Use JSON directly if types must survive.",
      "Nested objects/arrays stay as JSON text inside a CSV cell; they are not expanded with dot notation or extra columns. Flatten them yourself first if you need columns.",
      "XML beautifying re-flows whitespace; never use its output for signatures, hashes or byte-exact comparisons on whitespace-sensitive documents.",
      "YAML minify outputs single-line JSON (JSON is a strict subset of YAML 1.2), not comment-preserving YAML compression; comments are lost during parsing.",
      "On parse failure, read the reported position or field name. Common JSON mistakes are trailing commas, single quotes and comments; none of them are legal JSON.",
    ],
    aka: [
      "json beautify", "json formatter", "json minify", "json pretty", "json to csv",
      "csv to json", "csv parser", "xml beautify", "xml formatter", "data converter",
      "json csv xml converter", "数据转换", "json 美化", "json 压缩", "xml 美化",
      "yaml beautify", "yaml to json", "json to yaml", "yaml formatter", "yaml parser",
    ],
  },
};
