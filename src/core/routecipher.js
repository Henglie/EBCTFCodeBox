/*
 * routecipher.js — 曲路密码 / Route Cipher（cat:'classic'）。
 *
 * 置换密码。明文逐行填入 cols 列的矩阵，再按"路由"逐列读出：
 * snake（垂直蛇形，boustrophedon，默认，CTF 最常见）：
 * 偶数列（第 1、3、5…列，索引 0、2、4…）从上往下读
 * 奇数列（第 2、4、6…列）从下往上读，逐列上下折返。
 * vertical（垂直）：所有列统一从上往下读。
 *
 * 保留全部字符（含空格、标点、中文），不做大小写归一或过滤
 * 保证任意文本 encode→decode 100% 复原。
 *
 * 参照 classic.js columnarEncode/Decode 的按行填格 + 按列读出的写法。
 * 独立文件自注册，不改动其他文件。
 */
import { register } from "./registry.js";

// 网格：明文 text 逐行填入 cols 列，grid[r][c] = text[r*cols + c]（越界即空）。
// 列 c 的有效字符数 = 前 colLen[c] 行连续有效，colLen[c] = floor(len/cols) + (c < len%cols ? 1 : 0)。

function routeEncode(text, cols = 5, route = "snake") {
  cols = Math.max(1, Math.floor(cols) || 1);
  const len = text.length;
  if (len === 0) return "";
  if (cols === 1) return text; // 单列：读法即原文
  const rows = Math.ceil(len / cols);
  let out = "";
  for (let c = 0; c < cols; c++) {
    const col = [];
    for (let r = 0; r < rows; r++) {
      const idx = r * cols + c;
      if (idx < len) col.push(text[idx]);
    }
    if (route === "snake" && c % 2 === 1) col.reverse(); // 奇数列自下而上
    out += col.join("");
  }
  return out;
}

function routeDecode(text, cols = 5, route = "snake") {
  cols = Math.max(1, Math.floor(cols) || 1);
  const total = text.length;
  if (total === 0) return "";
  if (cols === 1) return text;
  const base = Math.floor(total / cols);
  const rem = total % cols;
 // 各列长度（按 encode 的按行填格规则）
  const colLen = [];
  for (let c = 0; c < cols; c++) colLen.push(base + (c < rem ? 1 : 0));
 // 按读出顺序把密文切回每列，snake 的奇数列切片需反转回自上而下
  const colData = [];
  let pos = 0;
  for (let c = 0; c < cols; c++) {
    let seg = text.slice(pos, pos + colLen[c]);
    pos += colLen[c];
    if (route === "snake" && c % 2 === 1) seg = [...seg].reverse().join("");
    colData.push(seg);
  }
 // 按行重组出原文（按 index r*cols+c 顺序）
  const rows = Math.ceil(total / cols);
  let out = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r < colLen[c]) out += colData[c][r];
    }
  }
  return out;
}

const ROUTE_OPTIONS = [
  { value: "snake", label: "垂直蛇形（逐列上下折返）" },
  { value: "vertical", label: "垂直（各列统一上→下）" },
];

register({
  id: "routeCipher",
  cat: "classic",
  name: "曲路密码",
  desc: "明文填入 W 列矩阵，按蛇形/垂直路由读出（置换密码）",
  params: [
    { key: "cols", label: "列数", type: "number", default: 5 },
    { key: "route", label: "路由", type: "select", default: "snake", options: ROUTE_OPTIONS },
  ],
  encode: (t, p) => routeEncode(t, Number((p && p.cols) || 5), (p && p.route) || "snake"),
  decode: (t, p) => routeDecode(t, Number((p && p.cols) || 5), (p && p.route) || "snake"),
});

export { routeEncode, routeDecode };
