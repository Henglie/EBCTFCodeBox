/*
 * edu-dataConvert.js — dataConvert（JSON / CSV / XML 转换）科普卡。
 * 纯数据，无 import、无副作用。
 */
export default {
  dataConvert: {
    what:
      "JSON、CSV、XML 三种常见结构化数据的互转与格式化工具：JSON 美化/压缩、JSON 与 CSV 双向转换、XML 结构美化。它处理的是数据格式，不是加密。",
    principle:
      "JSON 是 RFC 8259 定义的文本数据交换格式，语法只有对象、数组、字符串、数字、布尔和 null；美化只是解析后按缩进重新序列化，压缩则去掉非必要空白。" +
      "CSV 遵循 RFC 4180：字段用分隔符隔开，含分隔符、引号或换行的字段要用双引号包裹，字段内的双引号写成两个双引号。" +
      "JSON→CSV 时，对象数组取所有键的并集作为表头；嵌套对象或数组没有通用的扁平化语义，所以单元格里保留为 JSON 文本，不擅自拆列。" +
      "CSV 本身不区分数字和字符串，CSV→JSON 会把 `20` 写成字符串 `\"20\"`；这是格式限制，不是往返 bug。\n\n" +
      "XML 美化只做「标签缩进 + 配平校验」：属性、注释、CDATA、DOCTYPE、处理指令原样保留，纯文本元素保持单行。它不是完整 DOM 解析器，也不改语义；对空白敏感的文档不要拿美化结果去做签名或摘要。" +
      "YAML 使用 js-yaml 4.1.0 的 JSON_SCHEMA 安全解析，支持美化/压缩与 JSON↔YAML；锚点/别名按库行为展开或重新输出，不执行任意 JS 类型。",
    usage:
      "先在「模式」里选方向：`JSON 美化`、`JSON 压缩`、`JSON → CSV`、`CSV → JSON`、`XML 美化`、`YAML 美化`、`YAML 压缩`、`YAML → JSON`、`JSON → YAML`。\n" +
      "`indent` 控制缩进空格数（0-10，0 表示不缩进），只影响美化类模式；`delimiter` 是 CSV 分隔符，必须是单个字符（逗号、分号、制表符等）；`header` 决定 CSV 首行是否当表头。\n" +
      "JSON→CSV 的表头按所有对象键的首次出现顺序合并；CSV→JSON 时表头重名会直接报错，数据行多列也会报错，不静默丢列。输入为空或格式非法会给出具体错误位置/原因。",
    examples: [
      { in: "{\"a\":1,\"b\":[true,null]}", param: "mode=jsonBeautify, indent=2", out: "{\n  \"a\": 1,\n  \"b\": [\n    true,\n    null\n  ]\n}" },
      { in: "{ \"a\" : 1 , \"b\" : [ true , null ] }", param: "mode=jsonMinify", out: "{\"a\":1,\"b\":[true,null]}" },
      { in: "[{\"name\":\"张三\",\"age\":20},{\"name\":\"李四\",\"age\":21}]", param: "mode=jsonToCsv, delimiter=,, header=true", out: "name,age\n张三,20\n李四,21" },
      { in: "name,age\n张三,20\n李四,21", param: "mode=csvToJson, delimiter=,, header=true, indent=0", out: "[{\"name\":\"张三\",\"age\":\"20\"},{\"name\":\"李四\",\"age\":\"21\"}]" },
      { in: "<root><a>1</a><b><c>2</c></b></root>", param: "mode=xmlBeautify, indent=2", out: "<root>\n  <a>1</a>\n  <b>\n    <c>2</c>\n  </b>\n</root>" },
      { in: "name: 张三\nage: 20\ntags:\n  - ctf\n  - crypto", param: "mode=yamlToJson, indent=2", out: "{\n  \"name\": \"张三\",\n  \"age\": 20,\n  \"tags\": [\n    \"ctf\",\n    \"crypto\"\n  ]\n}" },
    ],
    formulas: [
      { tex: "\\text{CSV 字段} = \\begin{cases} f & f \\text{ 不含分隔符/引号/换行} \\\\ \"f''\" & \\text{否则，内部 } \" \\to \"\" \\end{cases}", caption: "RFC 4180 的字段转义规则" },
    ],
    tips: [
      "CSV 没有类型系统：JSON 里的数字、布尔、null 经 CSV 回来都会变字符串或空串；需要保类型请直接用 JSON。",
      "嵌套对象/数组在 CSV 单元格里是 JSON 文本，不是「点号展开」或「多列展开」；要拆列请先自己拍平。",
      "XML 美化会重排空白，混合内容或空白敏感文档不要用结果做签名、哈希或逐字节比对。",
      "YAML 的「压缩」输出是单行 JSON（JSON 是 YAML 1.2 严格子集），不是保留 YAML 注释的压缩；注释会在解析时丢失。",
      "解析失败优先看报错里的位置/字段名；JSON 常见原因是尾逗号、单引号或注释，这些都不是合法 JSON。",
    ],
    aka: [
      "json 美化", "json 格式化", "json 压缩", "json minify", "json pretty",
      "json 转 csv", "csv 转 json", "csv parser", "xml 美化", "xml formatter",
      "xml 格式化", "数据转换", "json csv xml converter", "yaml 美化", "yaml 转 json", "json 转 yaml", "yaml formatter", "yaml parser",
    ],
  },
};
