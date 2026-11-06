/*
 * t816CartesianProduct.js — 笛卡尔积（CyberChef #59）。
 *
 * 口径与 CyberChef src/core/operations/CartesianProduct.mjs 一致：
 * 输入按样本分隔符切成多组、每组按元素分隔符切分，输出全部组合；
 * 每个组合写成 "(元素1,元素2,...)"，组合之间用元素分隔符连接。少于 2 组时报错。
 * 纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";
import { parseEscapedChars } from "./t816Common.js";

function cartesian(a, b, ...c) {
  const f = (x, y) => [].concat(...x.map((d) => y.map((e) => [].concat(d, e))));
  return b ? cartesian(f(a, b), ...c) : a;
}

register({
  id: "cartesianProduct",
  cat: "data",
  io: "text",
  name: "笛卡尔积",
  desc: "把输入按样本分隔符分成多组、按元素分隔符切分，输出全部组合（(a,b) 形式）。少于两组报错。口径同 CyberChef「Cartesian Product」",
  params: [
    { key: "sampleDelimiter", label: "样本分隔符", type: "text", default: "\\n\\n", placeholder: "默认两个换行" },
    { key: "itemDelimiter", label: "元素分隔符", type: "text", default: ",", placeholder: "如 , 或空格" },
  ],
  run(text, p) {
    const sampleDelim = parseEscapedChars((p && p.sampleDelimiter != null) ? p.sampleDelimiter : "\\n\\n");
    const itemDelim = parseEscapedChars((p && p.itemDelimiter != null) ? p.itemDelimiter : ",");
    const input = String(text == null ? "" : text);
    const sets = input.split(sampleDelim);
    if (!sets || sets.length < 2) {
      throw new Error("样本组数不足 2，请检查样本分隔符或补充样本");
    }
    return cartesian(...sets.map((s) => s.split(itemDelim)))
      .map((set) => "(" + set.join(",") + ")")
      .join(itemDelim);
  },
});
