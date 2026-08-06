/*
 * edu-text-jsescape.js — JS escape 编码科普卡（text 类）。
 *
 * 覆盖 op：jsEscape
 * 纯数据无副作用，export default 对象照 eduContent.js 头注释契约。
 */
export default {
  jsEscape: {
    what: "旧版 JavaScript 的 escape()/unescape() 全局函数编码——RFC 2396 之前的老式 URL 编码。字母数字与 @*_+-./ 不编码，其他 ASCII 变 %XX，非 ASCII（中文/emoji）变 %uXXXX（按 UTF-16 code unit）。CTF 偶考这类「老式 escape 题」，与 encodeURI/encodeURIComponent（UTF-8 字节）语义完全不同。",
    principle:
      "编码规则（escape() 行为）：\n\n" +
      "① 安全字符：ASCII 字母、数字，以及 @ * _ + - . / 原样输出；\n" +
      "② 其他 ASCII（控制符、空格、标点等）→ %XX（两位大写十六进制）；\n" +
      "③ 非 ASCII 字符（≥ U+0080）→ %uXXXX（四位大写十六进制，UTF-16 code unit；emoji 等代理对会拆成两个 %u 序列）。\n\n" +
      "解码（unescape()）是逆过程：%XX → 单字节，%uXXXX → UTF-16 单元。\n\n" +
      "与 encodeURIComponent 的关键差异：那个按 UTF-8 把中文编成多字节 %E4%B8%AD 形式；escape 按 UTF-16 编成 %u4E2D 单段形式——两者对同一中文输出完全不同，这是区分题型的判据。",
    usage: "输入框填文本（或 %XX/%uXXXX 形式的密文），点运行。encode 生成 escape 密文、decode 还原明文。双向。",
    examples: [
      { in: "Hello World!", param: "", out: "Hello%20World%21", desc: "ASCII：空格/标点转 %XX" },
      { in: "中文", param: "", out: "%u4E2D%u6587", desc: "非 ASCII：UTF-16 code unit 转 %uXXXX" },
      { in: "%u4E2D%u6587", param: "", out: "中文", desc: "decode 还原" },
    ],
    tips: [
      "看到 %uXXXX 形式（小写 u + 4 位 hex）→ 老式 escape 编码，不是 UTF-8 的 %XX 多字节形式。",
      "与 encodeURIComponent 区分：中文「中」escape 得 %u4E2D，encodeURIComponent 得 %E4%B8%AD。同一输入两种结果，看 %u 前缀即可判断。",
      "escape 已废弃但仍被所有浏览器支持；题目若出现 %u 形式，用本 op 直接解。",
      "emoji 等辅助平面字符：escape 会拆成两个 %u 序列（代理对），decode 时两个 %u 自动拼回原字符。",
    ],
    aka: ["escape", "unescape", "JS escape", "javascript escape", "%u编码", "老式URL编码", "escape编码", "unescape解码", "%uXXXX", "url escape", "js escape code", "escape 函数", "urlencode 旧版", "jsEscape"],
  },
};
