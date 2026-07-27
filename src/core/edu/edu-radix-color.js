// 科普内容分片：radix「颜色编码」组 2 项。纯数据，无 import 无副作用。
// color / colorInfo（样例均由 color.js 实跑取值）
export default {
  color: {
    what: "颜色在各种表示法之间互转：RGB、Hex（`#FF0000`）、HSL、HSV、CMYK、整数色值、CSS 颜色名（`red`）都能来回换。",
    principle:
      "所有格式先归一到 RGB（0-255）作中转，再转到目标格式。\n\n" +
      "Hex 是每通道 2 位十六进制；HSL/HSV 用色相、饱和度、明度/亮度描述；CMYK 是印刷四色；整数色值是 `(R<<16)|(G<<8)|B` 打包成一个数。CSS 命名色照 W3C 标准 147 色表。",
    usage: "选源格式（可自动识别）和目标格式，encode 做 from→to，decode 反向。Hex 大小写可选。",
    examples: [
      { in: "255,0,0", param: "RGB→Hex", out: "#FF0000" },
      { in: "#FF0000", param: "Hex→HSL", out: "hsl(0, 100.0%, 50.0%)" },
      { in: "red", param: "CSS名→Hex", out: "#FF0000" },
    ],
    tips: ["CTF 图像/像素题里，颜色值常拿来编码数据，转成整数或二进制看规律。", "HSL 的色相 H 是角度（0-360°），红=0、绿=120、蓝=240，记住这三个锚点。"],
    aka: ["颜色转换", "color", "rgb转hex", "颜色编码", "颜色互转", "hsl", "cmyk", "hex颜色", "RGB转换", "颜色格式转换", "hsv", "color convert", "配色转换", "CSS颜色名"],
  },

  colorInfo: {
    what: "输入任意格式的一个颜色，一次性输出它在所有格式下的表示，外加最接近的 CSS 命名色和 24 位二进制。",
    principle: "把输入解析成 RGB 后，同时算出 Hex、整数、二进制、HSL、HSV、CMYK，并在 147 个 CSS 命名色里找精确匹配或欧氏距离最近的名字。",
    usage: "直接粘一个颜色（`#FF0000` / `rgb(255,0,0)` / `red` / 整数皆可），run 输出全息信息。",
    examples: [
      { in: "#FF0000", out: "整数:       16711680 (0xFF0000)\n二进制:     11111111 00000000 00000000\nHSL:        hsl(0, 100.0%, 50.0%)\nCSS 命名色: red（精确匹配）", desc: "节选" },
    ],
    tips: ["拿到一个颜色不知道该用哪种格式时，丢进来一次看全部。", "「最近命名色」帮你快速判断一个杂色大致偏红偏蓝，写报告时好描述。"],
    aka: ["颜色信息", "color info", "颜色全息", "颜色详情", "取色", "颜色分析", "颜色全格式", "color inspector", "颜色详细信息", "最近命名色", "颜色识别", "color detail", "全格式颜色"],
  },
};
