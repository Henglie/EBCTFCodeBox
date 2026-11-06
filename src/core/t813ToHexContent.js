/*
 * t813ToHexContent.js — SNORT Hex Content 编码（CyberChef #451）。
 *
 * 口径与 CyberChef src/core/operations/ToHexContent.mjs 一致：
 * - convert=special：仅不可打印/非字母数字字节转 |hh|；空格默认保留
 * - convert=specialSpaces：空格也转 |20|
 * - convert=all：整段包成 |hhhh|
 * - spaces：多字节段内以空格分隔
 * 输入按原始字节流（字节视图优先，否则 UTF-8）。纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";
import { bytesOf, bytesToHexLower } from "./t813Common.js";

register({
  id: "toHexContent",
  cat: "data",
  name: "SNORT Hex Content 编码",
  desc: "把不可打印/特殊字节编码为 SNORT 的 |hh hh| 内容段；可选包含空格或全字符转 hex。口径同 CyberChef「To Hex Content」",
  acceptsBytes: true,
  params: [
    { key: "convert", label: "转换范围", type: "select", default: "special", options: [
      { value: "special", label: "仅特殊字符" },
      { value: "specialSpaces", label: "特殊字符 + 空格" },
      { value: "all", label: "全部字符" },
    ] },
    { key: "spaces", label: "字节间加空格", type: "bool", default: false },
  ],
  run(text, p) {
    const bytes = bytesOf(text, p);
    const convert = (p && p.convert) ? String(p.convert) : "special";
    const spaces = !!(p && p.spaces);
    if (convert === "all") {
      const result = "|" + bytesToHexLower(bytes, " ") + "|";
      return spaces ? result : result.replace(/ /g, "");
    }
    let output = "";
    let inHex = false;
    const convertSpaces = convert === "specialSpaces";
    for (let i = 0; i < bytes.length; i++) {
      const b = bytes[i];
      const special = (b === 32 && convertSpaces) || (b < 48 && b !== 32) ||
        (b > 57 && b < 65) || (b > 90 && b < 97) || b > 122;
      if (special) {
        if (!inHex) {
          output += "|";
          inHex = true;
        } else if (spaces) output += " ";
        output += (b >>> 4).toString(16) + (b & 0x0f).toString(16);
      } else {
        if (inHex) {
          output += "|";
          inHex = false;
        }
        output += String.fromCharCode(b);
      }
    }
    if (inHex) output += "|";
    return output;
  },
});
