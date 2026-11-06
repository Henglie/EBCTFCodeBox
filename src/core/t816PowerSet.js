/*
 * t816PowerSet.js — 幂集（CyberChef #323）。
 *
 * 口径与 CyberChef src/core/operations/PowerSet.mjs 一致：按元素分隔符切分并丢弃空元素，
 * 以二进制掩码枚举全部子集，按结果字符串长度升序排列，每行一个子集（含空集首行）。
 * 纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";
import { parseEscapedChars } from "./t816Common.js";

function powerSet(items, delimiter) {
  const a = items.filter((i) => i.length);
  if (!a.length) return [];
  const toBinary = (dec) => (dec >>> 0).toString(2);
  const maxBinaryValue = parseInt(Number(a.map(() => "1").reduce((p, c) => p + c, "")), 2);
  const width = toBinary(maxBinaryValue).length;
  const result = new Set();
  for (let n = 0; n <= maxBinaryValue; n++) {
    const split = toBinary(n).padStart(width, "0").split("");
    result.add(a.filter((item, index) => split[index] === "1"));
  }
  return [...result]
    .map((r) => r.join(delimiter))
    .sort((x, y) => x.length - y.length)
    .map((i) => i + "\n")
    .join("");
}

register({
  id: "powerSet",
  cat: "data",
  io: "text",
  name: "幂集",
  desc: "按元素分隔符切分输入，列出全部子集（含空集），按长度排序、每行一个。口径同 CyberChef「Power Set」",
  params: [
    { key: "delimiter", label: "元素分隔符", type: "text", default: ",", placeholder: "如 , 或空格；可用 \\n" },
  ],
  run(text, p) {
    const delimiter = parseEscapedChars((p && p.delimiter != null) ? p.delimiter : ",");
    const input = String(text == null ? "" : text);
    const items = input.split(delimiter).filter((a) => a);
    if (!items.length) return "";
    return powerSet(items, delimiter);
  },
});
