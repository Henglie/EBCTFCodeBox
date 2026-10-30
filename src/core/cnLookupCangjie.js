import { register } from "./registry.js";
import { withCnTable, encodeWithTable, decodeLetters, detectCangjie } from "./cnLookupUtil.js";

register({
  id: "cangjie", cat: "cn", name: "仓颉码",
  desc: "仓颉输入法码 ↔ 汉字；1-5 位大写字母（不含 Z），连写自动最长匹配；同码多字按词频列候选；参数：候选序号 + 全候选",
  params: [
    { key: "pick", label: "候选序号", type: "number", default: 1, placeholder: "1 起" },
    { key: "all", label: "列出全部候选", type: "bool", default: false },
  ],
  encode: (text) => withCnTable("cangjie", (TABLE) => encodeWithTable(text, TABLE)),
  decode: (text, p) => withCnTable("cangjie", (TABLE) => decodeLetters(text, TABLE, {
    caseMode: "upper",
    pick: p && p.pick,
    all: p && (p.all === true || p.all === "true"),
  })),
  detect: detectCangjie,
});
