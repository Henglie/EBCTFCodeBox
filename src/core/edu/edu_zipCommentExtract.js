/*
 * edu_zipCommentExtract.js — 科普卡候选（ZIP 注释提取）。纯数据，无 import 无副作用。
 * 供归并进 src/core/eduContent.js（或 src/core/edu 下新分片）。
 * 来源：PKWARE APPNOTE.TXT 6.3.x §4.3.7/§4.3.16/§4.4.0.4（2026-09-22 访问）。
 */
export default {
  zipCommentExtract: {
    what: "ZIP 注释域提取——一个 ZIP 有两类合法注释位：整个压缩包的「档案注释」（EOCD 记录尾部）和每个文件条目自己的注释（中央目录头里跟在文件名后）。CTF misc 题爱把 flag 或提示语藏在这两处（unzip -z 只显示档案注释，条目注释常被忽略）；取证上注释还能暴露制包工具、时间线索或下一步指令。与「ZIP 伪加密修复」同走 EOCD→中央目录精确路径，互不冲突。",
    principle:
      "EOCD（签名 50 4B 05 06，从文件尾往前找）：偏移 20 是档案注释长度（2 字节小端，上限 65535），\n" +
      "偏移 22 起就是注释本体（APPNOTE §4.3.16）。\n" +
      "中央目录文件头（50 4B 01 02，EOCD 里存着它的偏移与条目数）：偏移 28/30/32 依次是\n" +
      "文件名长/扩展域长/注释长（2 字节小端），注释紧排在名与扩展域之后（§4.3.7）。\n" +
      "本地文件头（LFH）没有注释字段——只有中央目录侧能藏。通用位标志 bit11=1（EFS）表示\n" +
      "名字与注释按 UTF-8 编码（§4.4.0.4）；未置位时先试 UTF-8、失败回退 latin1 并给 hex 原值。\n" +
      "拼接文件（图片/垃圾字节+ZIP）：EOCD 里的偏移是 ZIP 相对值，按「EOCD 前 cdSize 字节」\n" +
      "反推真实位置并告警修正——与主流解压器的偏移修正思路一致。",
    usage:
      "拖入 ZIP 文件（或粘贴 base64）。输出报告分两段：EOCD 档案注释（含 hex 原值）与逐条目注释\n" +
      "（含注释在文件里的字节偏移）。完全无注释时明确说「未发现任何注释域」；\n" +
      "非 ZIP/EOCD 被截断/条目数与目录不符/RAR/ZIP64 均中文报错。",
    examples: [
      { in: "（拖入）2 条目 ZIP：a.txt 条目注释 flag{zip_entry_comment}，b.txt 无注释，档案注释 see the EOCD", param: "", out: "flag{zip_entry_comment}", desc: "条目注释与档案注释同时提取，报告含两者与偏移" },
      { in: "（拖入）无注释 ZIP", param: "", out: "未发现任何注释域", desc: "空注释是正常状态，明示而非报错" },
      { in: "（拖入）JPEG 头 + 带注释 ZIP 拼接文件", param: "", out: "拼接", desc: "EOCD 相对偏移自动修正并告警（图片隐写常用布局）" },
    ],
    formulas: [
      { tex: "\\text{EOCD}+20 = \\text{len}_{\\text{archComment}}(2,\\text{LE}),\\ \\text{EOCD}+22 = \\text{comment}", caption: "档案注释定位（APPNOTE §4.3.16）" },
      { tex: "\\text{CDH}+46+L_{\\text{name}}+L_{\\text{extra}} = \\text{entry comment}", caption: "条目注释定位，$L$ 读自偏移 28/30/32（§4.3.7）" },
    ],
    tips: [
      "识别：拿到 ZIP 先看注释域再动手解压——unzip -z 只报档案注释，条目注释要用 unzip -l -v 或本工具。",
      "Python 的 zipfile 写注释一行：zf.comment = b'...'、ZipInfo.comment = b'...'——出题与验题同源。",
      "PowerShell Compress-Archive 产出的 ZIP 默认无注释，「造 ZIP 后手工 append 注释域」= 改 EOCD 偏移 20 长度再尾接字节。",
      "注释域在压缩数据之外——修注释、改注释不影响压缩内容本身；反过来伪加密改的是通用位标志，别混淆。",
      "拼接文件（JPG+ZIP）场景 EOCD 偏移是 ZIP 相对值：工具按 EOCD-CDSize 反推真实位置，与解压器同思路。",
      "bit11（EFS）未置位但注释是合法 UTF-8 时按 UTF-8 解；真 CP437 高位字节会回退 latin1 并附 hex——以 hex 为准。",
      "来源：PKWARE APPNOTE.TXT https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT （访问日期 2026-09-22）。",
    ],
    aka: ["ZIP 注释提取", "zip comment extract", "archive comment", "ZIP 档案注释", "EOCD 注释",
      "zip file comment", "条目注释", "unzip -z", "注释域", "ZIP 元数据", "zip comment viewer"],
  },
};
