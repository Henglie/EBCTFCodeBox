/*
 * t813FromHexContent.js — SNORT Hex Content 解码（CyberChef #170）。
 *
 * 口径与 CyberChef src/core/operations/FromHexContent.mjs 一致：
 * 匹配 |HH HH ...| 段并转回原始字节（Latin-1 输出），段外文本原样保留。
 * 段内按空白分组、每组每 2 个 hex 字符取 1 字节（奇数尾字符按单 hex 取值，与 CC fromHex Auto 同）。
 * 纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";

register({
  id: "fromHexContent",
  cat: "data",
  name: "SNORT Hex Content 解码",
  desc: "把 SNORT 规则里的 |41 42 3a| 十六进制内容段还原为字符；段外文本保持不变。口径同 CyberChef「From Hex Content」",
  params: [],
  run(text) {
    const input = String(text == null ? "" : text);
    const regex = /\|([a-f\d ]{2,})\|/gi;
    const out = [];
    let m, i = 0;
    while ((m = regex.exec(input))) {
      while (i < m.index) out.push(input[i++]);
      for (const chunk of m[1].split(" ")) {
        if (!chunk) continue;
        for (let j = 0; j < chunk.length; j += 2) {
          out.push(String.fromCharCode(parseInt(chunk.substr(j, 2), 16)));
        }
      }
      i = regex.lastIndex;
    }
    while (i < input.length) out.push(input[i++]);
    return out.join("");
  },
});
