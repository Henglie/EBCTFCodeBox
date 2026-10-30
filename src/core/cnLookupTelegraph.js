import { register } from "./registry.js";
import { withCnTable, encodeWithTable, decodeDigits, detectTelegraph, CN_LOOKUP } from "./cnLookupUtil.js";

register({
  id: "cnTelegraph", cat: "cn", name: "中文电码",
  desc: "中文电码（四位电报码）↔ 汉字；四位一组，不足左补零；无参数",
  encode: (text) => withCnTable("telegraph", (TABLE) => encodeWithTable(text, TABLE)),
  decode: (text) => withCnTable("telegraph", (TABLE) => decodeDigits(text, {
    table: TABLE,
    normalize: (token) => (/^\d{1,4}$/.test(token) ? token.padStart(4, "0") : ""),
    lookup: (code) => TABLE.codeToChars.get(code),
    segment: (token) => (/^\d+$/.test(token) && token.length > 4 ? CN_LOOKUP.splitDigits(token, [4]) : [token]),
  })),
  detect: detectTelegraph,
});
