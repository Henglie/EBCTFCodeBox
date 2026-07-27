/* __T72_PATCHED__
 * color.js — 颜色编码组（T72，cat:'radix'）。
 *
 * 覆盖：
 * - RGB ↔ HSL ↔ HSV ↔ CMYK ↔ 十六进制 ↔ 整数色值 ↔ CSS 颜色名
 * - 多向互转（color op：参数 from/to 选源/目标格式，encode=正向，decode=反向）
 * - 颜色全息信息（colorInfo op：单向 run，输入任意格式 → 输出全部格式 + 最近 CSS 命名色）
 *
 * 算法标准：
 * - RGB↔HSL：W3C / Wikipedia HSL_and_HSV 公式（r,g,b∈[0,1] → H∈[0,360), S/L∈[0,1]）。
 * - RGB↔HSV：同上标准公式，V 代替 L。
 * - RGB↔CMYK：c=1-r/255 等，k=min(r,g,b)/255；反向 r=255*(1-c)*(1-k)。
 * - RGB↔Hex：#RRGGBB 六位（或三位简写识别），大写输出可配。
 * - RGB↔Int：24 位打包 (r<<16)|(g<<8)|b，BigInt 防溢出。
 * - CSS 颜色名：CSS3/HTML4 命名色 147 项表（W3C 推荐），照抄 W3C 规范不编造。
 *
 * 红线：
 * - CSS 命名色表逐字照抄 W3C CSS Color Module Level 3（不编造）。
 * - 纯算法无外部依赖；输入解析容错（去空格、支持 rgb/hsl 函数语法、支持 # / 0x 前缀）。
 * - 双向 encode+decode：encode = from→to，decode = to→from（方向切换有意义）。
 */
import { register } from "./registry.js";

// ============ 通用：颜色规范化为 {r,g,b} ∈ [0,255] 整数 ============
function clampByte(n) {
  n = Math.round(n);
  if (n < 0) return 0;
  if (n > 255) return 255;
  return n;
}
function clampUnit(n) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
function normalizeRgb(o) {
  return { r: clampByte(o.r), g: clampByte(o.g), b: clampByte(o.b) };
}

// ============ RGB ↔ Hex ============
function rgbToHex({ r, g, b }, upper = true) {
  const h = (n) => clampByte(n).toString(16).padStart(2, "0");
  let s = "#" + h(r) + h(g) + h(b);
  return upper ? s.toUpperCase() : s.toLowerCase();
}
function hexToRgb(s) {
  s = String(s).trim().replace(/^0x/, "#").replace(/^#/, "");
 // 三位简写 #RGB → #RRGGBB
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s.split("").map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) {
    throw new Error(`非法 Hex 颜色：需 #RRGGBB 或 #RGB 或 0xRRGGBB（得到 "${s}"）`);
  }
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

// ============ RGB ↔ Int（24 位打包） ============
function rgbToInt({ r, g, b }) {
 // 24 位无符号：r<<16 | g<<8 | b
  return (clampByte(r) << 16) | (clampByte(g) << 8) | clampByte(b);
}
function intToRgb(n) {
 // 接受十进制 / 0x 前缀十六进制 / # 前缀
  const s = String(n).trim().replace(/^#/, "");
  let v;
  if (/^0x[0-9a-fA-F]+$/.test(s)) {
    v = parseInt(s, 16);
  } else if (/^\d+$/.test(s)) {
    v = Number(s);
    if (v > 0xffffffff) {
 // 用 BigInt 兜底大数
      v = BigInt(s);
      if (v > 0xffffffffn) throw new Error(`整数色值超出 24 位（0xFFFFFF）：${s}`);
      v = Number(v);
    }
  } else if (/^[0-9a-fA-F]{6}$/.test(s)) {
    v = parseInt(s, 16);
  } else {
    throw new Error(`非法整数色值：${n}（十进制或 0x 十六进制）`);
  }
  if (v < 0 || v > 0xffffff) {
    throw new Error(`整数色值超出 24 位范围 [0, 16777215]：${v}`);
  }
  return { r: (v >> 16) & 0xff, g: (v >> 8) & 0xff, b: v & 0xff };
}

// ============ RGB ↔ HSL（W3C / Wikipedia 标准公式） ============
function rgbToHsl({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, l };
}
function hslToRgb({ h, s, l }) {
 // h∈[0,360), s/l∈[0,1]
  h = ((h % 360) + 360) % 360;
  s = clampUnit(s);
  l = clampUnit(l);
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const hk = h / 360;
  return {
    r: Math.round(hue2rgb(p, q, hk + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, hk) * 255),
    b: Math.round(hue2rgb(p, q, hk - 1 / 3) * 255),
  };
}

// ============ RGB ↔ HSV（W3C / Wikipedia 标准公式） ============
function rgbToHsv({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const v = max;
  const d = max - min;
  const s = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case rn: h = (gn - bn) / d + (gn < bn ? 6 : 0); break;
      case gn: h = (bn - rn) / d + 2; break;
      case bn: h = (rn - gn) / d + 4; break;
    }
    h *= 60;
  }
  return { h, s, v };
}
function hsvToRgb({ h, s, v }) {
  h = ((h % 360) + 360) % 360;
  s = clampUnit(s);
  v = clampUnit(v);
  const c = v * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1, g1, b1;
  if (hp < 1) { r1 = c; g1 = x; b1 = 0; }
  else if (hp < 2) { r1 = x; g1 = c; b1 = 0; }
  else if (hp < 3) { r1 = 0; g1 = c; b1 = x; }
  else if (hp < 4) { r1 = 0; g1 = x; b1 = c; }
  else if (hp < 5) { r1 = x; g1 = 0; b1 = c; }
  else { r1 = c; g1 = 0; b1 = x; }
  const m = v - c;
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

// ============ RGB ↔ CMYK ============
function rgbToCmyk({ r, g, b }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const k = 1 - Math.max(rn, gn, bn);
  if (k === 1) {
 // 全黑：cmy 全 0
    return { c: 0, m: 0, y: 0, k: 1 };
  }
  const c = (1 - rn - k) / (1 - k);
  const m = (1 - gn - k) / (1 - k);
  const y = (1 - bn - k) / (1 - k);
  return { c, m, y, k };
}
function cmykToRgb({ c, m, y, k }) {
  c = clampUnit(c); m = clampUnit(m); y = clampUnit(y); k = clampUnit(k);
  return {
    r: Math.round(255 * (1 - c) * (1 - k)),
    g: Math.round(255 * (1 - m) * (1 - k)),
    b: Math.round(255 * (1 - y) * (1 - k)),
  };
}

// ============ CSS 命名色表（W3C CSS Color Module Level 3 / HTML4，147 项，照抄不编造） ============
// 来源：https://www.w3.org/TR/css-color-3/ Appendix "Color name table"
const CSS_NAMED = {
  aliceblue: "#F0F8FF", antiquewhite: "#FAEBD7", aqua: "#00FFFF", aquamarine: "#7FFFD4",
  azure: "#F0FFFF", beige: "#F5F5DC", bisque: "#FFE4C4", black: "#000000",
  blanchedalmond: "#FFEBCD", blue: "#0000FF", blueviolet: "#8A2BE2", brown: "#A52A2A",
  burlywood: "#DEB887", cadetblue: "#5F9EA0", chartreuse: "#7FFF00", chocolate: "#D2691E",
  coral: "#FF7F50", cornflowerblue: "#6495ED", cornsilk: "#FFF8DC", crimson: "#DC143C",
  cyan: "#00FFFF", darkblue: "#00008B", darkcyan: "#008B8B", darkgoldenrod: "#B8860B",
  darkgray: "#A9A9A9", darkgreen: "#006400", darkgrey: "#A9A9A9", darkkhaki: "#BDB76B",
  darkmagenta: "#8B008B", darkolivegreen: "#556B2F", darkorange: "#FF8C00", darkorchid: "#9932CC",
  darkred: "#8B0000", darksalmon: "#E9967A", darkseagreen: "#8FBC8F", darkslateblue: "#483D8B",
  darkslategray: "#2F4F4F", darkslategrey: "#2F4F4F", darkturquoise: "#00CED1", darkviolet: "#9400D3",
  deeppink: "#FF1493", deepskyblue: "#00BFFF", dimgray: "#696969", dimgrey: "#696969",
  dodgerblue: "#1E90FF", firebrick: "#B22222", floralwhite: "#FFFAF0", forestgreen: "#228B22",
  fuchsia: "#FF00FF", gainsboro: "#DCDCDC", ghostwhite: "#F8F8FF", gold: "#FFD700",
  goldenrod: "#DAA520", gray: "#808080", green: "#008000", greenyellow: "#ADFF2F",
  grey: "#808080", honeydew: "#F0FFF0", hotpink: "#FF69B4", indianred: "#CD5C5C",
  indigo: "#4B0082", ivory: "#FFFFF0", khaki: "#F0E68C", lavender: "#E6E6FA",
  lavenderblush: "#FFF0F5", lawngreen: "#7CFC00", lemonchiffon: "#FFFACD", lightblue: "#ADD8E6",
  lightcoral: "#F08080", lightcyan: "#E0FFFF", lightgoldenrodyellow: "#FAFAD2", lightgray: "#D3D3D3",
  lightgreen: "#90EE90", lightgrey: "#D3D3D3", lightpink: "#FFB6C1", lightsalmon: "#FFA07A",
  lightseagreen: "#20B2AA", lightskyblue: "#87CEFA", lightslategray: "#778899", lightslategrey: "#778899",
  lightsteelblue: "#B0C4DE", lightyellow: "#FFFFE0", lime: "#00FF00", limegreen: "#32CD32",
  linen: "#FAF0E6", magenta: "#FF00FF", maroon: "#800000", mediumaquamarine: "#66CDAA",
  mediumblue: "#0000CD", mediumorchid: "#BA55D3", mediumpurple: "#9370DB", mediumseagreen: "#3CB371",
  mediumslateblue: "#7B68EE", mediumspringgreen: "#00FA9A", mediumturquoise: "#48D1CC", mediumvioletred: "#C71585",
  midnightblue: "#191970", mintcream: "#F5FFFA", mistyrose: "#FFE4E1", moccasin: "#FFE4B5",
  navajowhite: "#FFDEAD", navy: "#000080", oldlace: "#FDF5E6", olive: "#808000",
  olivedrab: "#6B8E23", orange: "#FFA500", orangered: "#FF4500", orchid: "#DA70D6",
  palegoldenrod: "#EEE8AA", palegreen: "#98FB98", paleturquoise: "#AFEEEE", palevioletred: "#DB7093",
  papayawhip: "#FFEFD5", peachpuff: "#FFDAB9", peru: "#CD853F", pink: "#FFC0CB",
  plum: "#DDA0DD", powderblue: "#B0E0E6", purple: "#800080",
  red: "#FF0000", rosybrown: "#BC8F8F", royalblue: "#4169E1", saddlebrown: "#8B4513",
  salmon: "#FA8072", sandybrown: "#F4A460", seagreen: "#2E8B57", seashell: "#FFF5EE",
  sienna: "#A0522D", silver: "#C0C0C0", skyblue: "#87CEEB", slateblue: "#6A5ACD",
  slategray: "#708090", slategrey: "#708090", snow: "#FFFAFA", springgreen: "#00FF7F",
  steelblue: "#4682B4", tan: "#D2B48C", teal: "#008080", thistle: "#D8BFD8",
  tomato: "#FF6347", turquoise: "#40E0D0", violet: "#EE82EE", wheat: "#F5DEB3",
  white: "#FFFFFF", whitesmoke: "#F5F5F5", yellow: "#FFFF00", yellowgreen: "#9ACD32",
 // HTML4 16 基础色（与上重复，不重复列出，但保证可访问）：black/aqua/blue/fuchsia/gray/green/lime/maroon/navy/olive/purple/red/silver/teal/white/yellow 已含。
};
// 反向表：hex → 命名（首个命中）
const HEX_TO_NAME = (() => {
  const m = new Map();
 // 按规范定义顺序优先取首个（Object 插入顺序），无需重排
  for (const [name, hex] of Object.entries(CSS_NAMED)) {
    const key = hex.toLowerCase();
    if (!m.has(key)) m.set(key, name);
  }
  return m;
})();

function nameToRgb(name) {
  const k = String(name).trim().toLowerCase().replace(/\s+/g, "");
  if (!k) throw new Error("空 CSS 颜色名");
  const hex = CSS_NAMED[k];
  if (!hex) throw new Error(`未知 CSS 颜色名：${name}（共 ${Object.keys(CSS_NAMED).length} 项 W3C 命名色）`);
  return hexToRgb(hex);
}
function rgbToName({ r, g, b }, closest = false) {
  const hex = rgbToHex({ r, g, b }, false);
  const exact = HEX_TO_NAME.get(hex);
  if (exact) return exact;
  if (!closest) return null; // 无精确匹配
 // 找最近命名色（欧氏距离）
  let best = null, bestD = Infinity;
  for (const [name, h] of Object.entries(CSS_NAMED)) {
    const c = hexToRgb(h);
    const d = (c.r - r) ** 2 + (c.g - g) ** 2 + (c.b - b) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  }
  return best;
}

// ============ 输入解析（自动识别 / 容错） ============
// 支持格式：
// - #RRGGBB / #RGB / 0xRRGGBB / RRGGBB（hex）
// - rgb(r,g,b) / rgb(r g b) / r,g,b / r g b（rgb）
// - hsl(h,s%,l%) / hsl(h,s,l) / h,s%,l% / h s% l%（hsl）
// - hsv(h,s%,v%) / hsv(h,s,v)（hsv）
// - cmyk(c%,m%,y%,k%) / cmyk(c,m,y,k)（cmyk）
// - 整数（十进制 / 0x）
// - CSS 颜色名
function parseAnyToRgb(text) {
  const s = String(text).trim();
  if (!s) throw new Error("空颜色输入");
  const lower = s.toLowerCase();
 // 1. CSS 命名
  const cleaned = lower.replace(/\s+/g, "");
  if (CSS_NAMED[cleaned]) return nameToRgb(cleaned);
 // 2. #hex / 0xhex / 纯 hex
  if (/^(#|0x)?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(s)) return hexToRgb(s);
 // 3. 整数十进制 / 0x 前缀
  if (/^0x[0-9a-f]+$/i.test(s)) return intToRgb(s);
  if (/^\d+$/.test(s)) return intToRgb(s);
 // 4. 函数语法 rgb/hsl/hsv/cmyk
  const fnMatch = s.match(/^(rgb|hsl|hsv|cmyk)\s*\(([^)]*)\)$/i);
  if (fnMatch) {
    const fn = fnMatch[1].toLowerCase();
    const parts = fnMatch[2].split(/[,\s/]+/).filter(Boolean).map((p) => parseFloat(p));
    if (parts.length < 3) throw new Error(`${fn}() 参数不足`);
    if (fn === "rgb") {
 // 0-255（容许百分比）
      const conv = (v) => v <= 1 ? Math.round(v * 255) : Math.round(v);
      return normalizeRgb({ r: conv(parts[0]), g: conv(parts[1]), b: conv(parts[2]) });
    }
    if (fn === "hsl") {
      const h = parts[0];
      const s = parts[1] <= 1 ? parts[1] : parts[1] / 100;
      const l = parts[2] <= 1 ? parts[2] : parts[2] / 100;
      return hslToRgb({ h, s, l });
    }
    if (fn === "hsv") {
      const h = parts[0];
      const s = parts[1] <= 1 ? parts[1] : parts[1] / 100;
      const v = parts[2] <= 1 ? parts[2] : parts[2] / 100;
      return hsvToRgb({ h, s, v });
    }
    if (fn === "cmyk") {
      if (parts.length < 4) throw new Error("cmyk() 需 4 参数");
      const conv = (v) => (v <= 1 ? v : v / 100);
      return cmykToRgb({ c: conv(parts[0]), m: conv(parts[1]), y: conv(parts[2]), k: conv(parts[3]) });
    }
  }
 // 5. 裸逗号/空格分隔的数字串：按数字个数判定
  const nums = s.split(/[,\s/]+/).filter(Boolean).map(Number).filter((n) => !isNaN(n));
  if (nums.length === 3) {
 // 0-255（容许百分比）
    const conv = (v) => v <= 1 ? Math.round(v * 255) : Math.round(v);
 // 启发式：若都 ≤ 1 视为 [0,1]，否则 ≤255 视为 [0,255]
    if (nums.every((v) => v >= 0 && v <= 1)) {
 // 全 ≤ 1 → RGB [0,1] 归一化
      return normalizeRgb({ r: nums[0] * 255, g: nums[1] * 255, b: nums[2] * 255 });
    }
    if (nums.every((v) => v >= 0 && v <= 255)) {
 // 全 ≤ 255 → RGB [0,255]（最常见，优先于 HSL 避免 255,0,0 误判）
      return normalizeRgb({ r: nums[0], g: nums[1], b: nums[2] });
    }
    if (nums[0] >= 0 && nums[0] <= 360 && nums[1] >= 0 && nums[1] <= 100 && nums[2] >= 0 && nums[2] <= 100) {
 // 有数 > 255 才考虑 HSL/HSV（h 可达 360，s/l/v 用百分比 0-100）
      return hslToRgb({ h: nums[0], s: nums[1] / 100, l: nums[2] / 100 });
    }
    throw new Error(`无法识别颜色格式：${s}`);
  }
  if (nums.length === 4) {
 // 4 个数：CMYK（百分比或小数）
    const conv = (v) => (v <= 1 ? v : v / 100);
    return cmykToRgb({ c: conv(nums[0]), m: conv(nums[1]), y: conv(nums[2]), k: conv(nums[3]) });
  }
  throw new Error(`无法识别颜色格式：${s}`);
}

// ============ 格式化输出 ============
function fmtRgb({ r, g, b }) {
  return `rgb(${clampByte(r)}, ${clampByte(g)}, ${clampByte(b)})`;
}
function fmtHsl({ h, s, l }) {
  return `hsl(${Math.round(h * 10) / 10}, ${(s * 100).toFixed(1)}%, ${(l * 100).toFixed(1)}%)`;
}
function fmtHsv({ h, s, v }) {
  return `hsv(${Math.round(h * 10) / 10}, ${(s * 100).toFixed(1)}%, ${(v * 100).toFixed(1)}%)`;
}
function fmtCmyk({ c, m, y, k }) {
  return `cmyk(${(c * 100).toFixed(1)}%, ${(m * 100).toFixed(1)}%, ${(y * 100).toFixed(1)}%, ${(k * 100).toFixed(1)}%)`;
}

// ============ 主转换：from → to ============
const FORMATS = ["hex", "rgb", "hsl", "hsv", "cmyk", "int", "cssname"];
function convert(text, from, to, upper = true) {
 // 先解析到 RGB
  let rgb;
  if (from === "auto") {
    rgb = normalizeRgb(parseAnyToRgb(text));
  } else if (from === "hex") rgb = normalizeRgb(hexToRgb(text));
  else if (from === "rgb") rgb = normalizeRgb(parseAnyToRgb(text));
  else if (from === "hsl") {
 // 接受 hsl(h,s%,l%) / h,s%,l% / 三个数（视为 h,s,l）
    const t = String(text).trim();
    const m = t.match(/^hsl\s*\(([^)]*)\)$/i);
    let parts;
    if (m) parts = m[1].replace(/%/g, "").split(/[,\s/]+/).filter(Boolean).map(Number);
    else parts = t.replace(/%/g, "").split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3) throw new Error("HSL 需 3 个值：h, s, l");
    const h = parts[0];
    const s = parts[1] <= 1 ? parts[1] : parts[1] / 100;
    const l = parts[2] <= 1 ? parts[2] : parts[2] / 100;
    rgb = normalizeRgb(hslToRgb({ h, s, l }));
  } else if (from === "hsv") {
    const t = String(text).trim();
    const m = t.match(/^hsv\s*\(([^)]*)\)$/i);
    let parts;
    if (m) parts = m[1].replace(/%/g, "").split(/[,\s/]+/).filter(Boolean).map(Number);
    else parts = t.replace(/%/g, "").split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3) throw new Error("HSV 需 3 个值：h, s, v");
    const h = parts[0];
    const s = parts[1] <= 1 ? parts[1] : parts[1] / 100;
    const v = parts[2] <= 1 ? parts[2] : parts[2] / 100;
    rgb = normalizeRgb(hsvToRgb({ h, s, v }));
  } else if (from === "cmyk") {
    const t = String(text).trim();
    const m = t.match(/^cmyk\s*\(([^)]*)\)$/i);
    let parts;
    if (m) parts = m[1].replace(/%/g, "").split(/[,\s/]+/).filter(Boolean).map(Number);
    else parts = t.replace(/%/g, "").split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 4) throw new Error("CMYK 需 4 个值：c, m, y, k");
    const conv = (v) => (v <= 1 ? v : v / 100);
    rgb = normalizeRgb(cmykToRgb({ c: conv(parts[0]), m: conv(parts[1]), y: conv(parts[2]), k: conv(parts[3]) }));
  } else if (from === "int") {
    rgb = normalizeRgb(intToRgb(text));
  } else if (from === "cssname") {
    rgb = normalizeRgb(nameToRgb(text));
  } else {
    throw new Error(`未知源格式：${from}`);
  }
 // 再从 RGB 转到目标格式
  if (to === "hex") return rgbToHex(rgb, upper);
  if (to === "rgb") return fmtRgb(rgb);
  if (to === "hsl") return fmtHsl(rgbToHsl(rgb));
  if (to === "hsv") return fmtHsv(rgbToHsv(rgb));
  if (to === "cmyk") return fmtCmyk(rgbToCmyk(rgb));
  if (to === "int") return String(rgbToInt(rgb));
  if (to === "cssname") {
    const n = rgbToName(rgb, false);
    if (!n) throw new Error(`无精确 CSS 命名色匹配（hex=${rgbToHex(rgb)}，最近似：${rgbToName(rgb, true)}）`);
    return n;
  }
  throw new Error(`未知目标格式：${to}`);
}

// ============ 注册 op：color（多向互转） ============
const FORMAT_OPTIONS = [
  { value: "auto",    label: "自动识别" },
  { value: "hex",     label: "#RRGGBB Hex" },
  { value: "rgb",     label: "rgb(r,g,b)" },
  { value: "hsl",     label: "hsl(h,s%,l%)" },
  { value: "hsv",     label: "hsv(h,s%,v%)" },
  { value: "cmyk",    label: "cmyk(c%,m%,y%,k%)" },
  { value: "int",     label: "整数色值（0-16777215）" },
  { value: "cssname", label: "CSS 颜色名（如 red）" },
];
register({
  id: "color", cat: "radix", name: "颜色编码互转",
  desc: "RGB ↔ HSL ↔ HSV ↔ CMYK ↔ Hex ↔ 整数色值 ↔ CSS 颜色名（W3C 标准 147 命名色）多向互转。encode=from→to，decode=to→from",
  params: [
    { key: "from", label: "源格式", type: "select", default: "auto", options: FORMAT_OPTIONS },
    { key: "to",   label: "目标格式", type: "select", default: "hex", options: FORMAT_OPTIONS.filter((o) => o.value !== "auto") },
    { key: "upper",label: "Hex 大写", type: "bool", default: true },
  ],
  encode: (t, p) => convert(t, p.from || "auto", p.to || "hex", p.upper !== false),
  decode: (t, p) => convert(t, p.to || "hex", p.from === "auto" ? "hex" : (p.from || "hex"), p.upper !== false),
});

// ============ 注册 op：colorInfo（颜色全息信息，单向 run） ============
register({
  id: "colorInfo", cat: "radix", name: "颜色全息信息",
  desc: "输入任意格式颜色，输出 RGB/Hex/HSL/HSV/CMYK/整数/CSS 命名色 + 最近命名色 + 24 位二进制",
  params: [],
  run: (t) => {
    const rgb = normalizeRgb(parseAnyToRgb(t));
    const hex = rgbToHex(rgb);
    const hsl = rgbToHsl(rgb);
    const hsv = rgbToHsv(rgb);
    const cmyk = rgbToCmyk(rgb);
    const int = rgbToInt(rgb);
    const exact = rgbToName(rgb, false);
    const near = rgbToName(rgb, true);
    const bin = int.toString(2).padStart(24, "0");
    const lines = [
      "RGB:        " + fmtRgb(rgb),
      "Hex:        " + hex,
      "整数:       " + int + " (0x" + int.toString(16).toUpperCase().padStart(6, "0") + ")",
      "二进制:     " + bin.slice(0, 8) + " " + bin.slice(8, 16) + " " + bin.slice(16, 24),
      "HSL:        " + fmtHsl(hsl),
      "HSV:        " + fmtHsv(hsv),
      "CMYK:       " + fmtCmyk(cmyk),
      "CSS 命名色: " + (exact ? exact + "（精确匹配）" : "无精确匹配"),
      "最近命名色: " + near,
    ];
    return lines.join("\n");
  },
});

export {
 // 基础转换函数
  rgbToHex, hexToRgb,
  rgbToInt, intToRgb,
  rgbToHsl, hslToRgb,
  rgbToHsv, hsvToRgb,
  rgbToCmyk, cmykToRgb,
  nameToRgb, rgbToName,
 // 解析与格式化
  parseAnyToRgb,
  fmtRgb, fmtHsl, fmtHsv, fmtCmyk,
 // 主转换 + 表
  convert, CSS_NAMED, HEX_TO_NAME, FORMATS,
 // 工具
  clampByte, clampUnit, normalizeRgb,
};
