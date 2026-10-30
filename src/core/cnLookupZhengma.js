import { register } from "./registry.js";
import { withCnTable, encodeWithTable, decodeLetters, detectZhengma } from "./cnLookupUtil.js";

register({
  id: "zhengma", cat: "cn", name: "郑码",
  desc: "郑码单字码 ↔ 汉字；1-4 位大写字母，编码优先输出全码；同码多字按词频列候选；参数：候选序号 + 全候选",
  params: [
    { key: "pick", label: "候选序号", type: "number", default: 1, placeholder: "1 起" },
    { key: "all", label: "列出全部候选", type: "bool", default: false },
  ],
  encode: (text) => withCnTable("zhengma", (TABLE) => encodeWithTable(text, TABLE)),
  decode: (text, p) => withCnTable("zhengma", (TABLE) => decodeLetters(text, TABLE, {
    caseMode: "upper",
    pick: p && p.pick,
    all: p && (p.all === true || p.all === "true"),
  })),
  detect: detectZhengma,
});
