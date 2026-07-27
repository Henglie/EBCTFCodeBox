// English edu shard: radix "color encoding" family — 2 ops. Pure data, no imports, no side effects.
// color / colorInfo (all sample values are computed by color.js)
export default {
  color: {
    what: "Converts colors between various representations: RGB, Hex (`#FF0000`), HSL, HSV, CMYK, integer color value, and CSS color names (`red`) all interconvert.",
    principle:
      "Every format is first normalized to RGB (0–255) as an intermediate, then converted to the target format.\n\n" +
      "Hex is 2 hex digits per channel; HSL/HSV describe color using hue, saturation, and lightness/value; CMYK is the four printing colors; the integer color value is `(R<<16)|(G<<8)|B` packed into a single number. CSS named colors follow the W3C standard 147-color table.",
    usage: "Choose source format (can auto-detect) and target format. encode does from→to, decode reverses. Hex case is optional.",
    examples: [
      { in: "255,0,0", param: "RGB→Hex", out: "#FF0000" },
      { in: "#FF0000", param: "Hex→HSL", out: "hsl(0, 100.0%, 50.0%)" },
      { in: "red", param: "CSS name→Hex", out: "#FF0000" },
    ],
    tips: ["In CTF image/pixel challenges, color values are often used to encode data; convert to integer or binary to spot patterns.", "HSL's hue H is an angle (0–360°): red=0, green=120, blue=240 — remember these three anchor points."],
    aka: ["颜色转换", "color", "rgb转hex", "颜色编码", "颜色互转", "hsl", "cmyk", "hex颜色", "RGB转换", "颜色格式转换", "hsv", "color convert", "配色转换", "CSS颜色名", "color conversion", "rgb to hex"],
  },

  colorInfo: {
    what: "Input a single color in any format and get its representation in every format at once, plus the nearest CSS named color and 24-bit binary.",
    principle: "After parsing the input into RGB, it simultaneously computes Hex, integer, binary, HSL, HSV, and CMYK, and finds an exact match or the Euclidean-nearest name among the 147 CSS named colors.",
    usage: "Just paste a color (`#FF0000` / `rgb(255,0,0)` / `red` / an integer all work), run outputs the full picture.",
    examples: [
      { in: "#FF0000", out: "Integer:    16711680 (0xFF0000)\nBinary:     11111111 00000000 00000000\nHSL:        hsl(0, 100.0%, 50.0%)\nCSS name:   red (exact match)", desc: "excerpt" },
    ],
    tips: ["When you have a color and don't know which format to use, drop it in to see all of them at once.", "The \"nearest named color\" helps you quickly judge whether a messy color leans red or blue — handy when writing reports."],
    aka: ["颜色信息", "color info", "颜色全息", "颜色详情", "取色", "颜色分析", "颜色全格式", "color inspector", "颜色详细信息", "最近命名色", "颜色识别", "color detail", "全格式颜色", "nearest named color"],
  },
};
