/*
 * t813HexToOid.js — 十六进制 → 对象标识符（CyberChef #217 / ITU-T X.690 §8.19）。
 *
 * 首个子标识符 = 40*X + Y；其后每段为 base-128 varint（高 bit 续段）。
 * 输出点分十进制。纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";
import { parseHexBytes, decodeBase128 } from "./t813Common.js";

register({
  id: "hexToOid",
  cat: "asym",
  name: "十六进制 → 对象标识符",
  desc: "把 ASN.1 OBJECT IDENTIFIER 的十六进制内容（不含 06/长度）解为点分十进制，首段按 40*X+Y 还原。依据 ITU-T X.690 §8.19",
  params: [],
  run(text) {
    const bytes = parseHexBytes(text);
    const parts = [];
    let i = 0;
    while (i < bytes.length) {
      const [v, next] = decodeBase128(bytes, i);
      parts.push(v);
      i = next;
    }
    const first = parts.shift();
    const x = first < 40 ? 0 : (first < 80 ? 1 : 2);
    const y = first - 40 * x;
    return [x, y].concat(parts).join(".");
  },
});
