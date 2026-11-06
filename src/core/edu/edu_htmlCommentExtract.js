/*
 * edu_htmlCommentExtract.js — 科普卡候选（HTML 注释提取）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：HTML Living Standard 13.2.4 Comments / 13.2.5 分词器注释状态（2026-09-22 访问）。
 */
export default {
  htmlCommentExtract: {
    what: "HTML 注释提取——从网页源码里抠出 <!-- --> 包起来的注释域。Web 取证的最基础动作之一：开发者常把调试信息、隐藏链接、被注释掉的后门接口、甚至 flag 本体忘在注释里；渗透测试信息收集阶段也拿它扫注释里的内网地址、账号和框架版本。与「字符串提取」互补：注释域提取是按语法结构精确切片，不是模糊捞可打印串。",
    principle:
      "标准语义（HTML Living Standard 分词器）：扫描到 <!-- 开注释，其后第一个 --> 收口；\n" +
      "注释内的 <!-- 不开新注释（nested-comment 解析错误但注释继续，HTML 没有嵌套注释）；\n" +
      "--!> 同样收口（incorrectly-escaped-comment 解析错误路径）；<!--> 与 <!---> 是「空注释急收」\n" +
      "（abrupt-closing-of-empty-comment）；到 EOF 还没收口则整段发出（eof-in-comment，仍算一条）。\n" +
      "嵌套容错档（非标准约定）：把 <!-- 当开括号做深度计数、配对归零才收口——出题人手写\n" +
      "<!-- a <!-- b --> c --> 时，标准档只能拿到前半段，容错档取整段，两档对照即可定位差异。",
    usage:
      "粘贴 HTML 源码（或从浏览器「查看网页源代码」全选复制）。标准档按浏览器真实分词语义提取；\n" +
      "嵌套容错档按深度配对提取。可选最小内容长度过滤（滤掉空注释/井号装饰）、显示字符偏移。\n" +
      "每条注释带 #序号与偏移，未闭合的标「未闭合(EOF)」——残缺文件不丢内容。",
    examples: [
      { in: "<!-- TODO: remove before release -->", param: "标准", out: " TODO: remove before release ", desc: "最常见形态：忘删的待办注释" },
      { in: "<div><!-- <script>findme()</script> --></div>", param: "标准", out: " <script>findme()</script> ", desc: "被注释掉的前端代码/接口" },
      { in: "<!-- outer <!-- flag{nested_comment} --> still outer -->", param: "嵌套容错", out: " outer <!-- flag{nested_comment} --> still outer ", desc: "手写嵌套注释整段取出（标准档只取到第一个 -->）" },
      { in: "<!-- flag{unclosed}", param: "标准", out: " flag{unclosed}", desc: "EOF 未闭合仍整段取出并标注" },
    ],
    formulas: [
      { tex: "\\text{comment} \\in \\text{src}[\\texttt{<!--}\\,\\cdots\\,\\texttt{-->}]", caption: "注释域=开括号后到第一个收口符前的文本（Living Standard 13.2.4）" },
      { tex: "\\text{depth}(\\texttt{<!--})=+1,\\ \\text{depth}(\\texttt{-->})=-1 \\Rightarrow \\text{close at } 0", caption: "嵌套容错档的深度配对判据（非标准）" },
    ],
    tips: [
      "识别：源码里 Ctrl+F 搜 <!-- 只能找开头；本工具按语法收口，嵌套/残缺/急收都按浏览器真实语义处理。",
      "标准档=浏览器所见即所得；嵌套容错档是取证增强——两档结果不一致的地方，就是出题人埋钩子的地方。",
      "三个解析错误路径也收口：--!>、<!-->、<!--->——见 Living Standard 13.2.5，别按「必须三个减号加大于号」硬写正则。",
      "注释里藏 flag 是入门 Web 题高频套路；注释里的 hidden input、API 路径、base64 串常是后续步骤的钥匙。",
      "对付整页压缩成一行的 HTML 同样有效：提取按偏移扫描，不依赖换行。",
      "安全边界：注释内容默认不执行不渲染，但若被服务端模板引擎二次解析（如 SSTI），注释域可能是注入点——分析时保持怀疑。",
      "来源：HTML Living Standard https://html.spec.whatwg.org/multipage/syntax.html#comments 与 https://html.spec.whatwg.org/multipage/parsing.html#comment-state （访问日期 2026-09-22）。",
    ],
    aka: ["HTML 注释提取", "extract html comments", "HTML comment extract", "注释域提取", "网页注释",
      "HTML comments", "注释提取器", "extract comments", "source code comments", "HTML 源码注释",
      "隐藏注释查看", "comment extractor"],
  },
};
