import { register } from "./registry.js";
import { withCnTable, encodeWithTable, decodeLetters, detectWubi } from "./cnLookupUtil.js";

const verOf = (p) => (String(p && p.version) === "98" ? "98" : "86");

register({
  id: "wubi", cat: "cn", name: "五笔字型",
  desc: "五笔 86/98 单字全码 ↔ 汉字；字母码可空格分隔，连写自动最长匹配；同码多字按词频列候选；参数：版本 + 候选序号 + 全候选",
  params: [
    { key: "version", label: "版本", type: "select", default: "86",
      options: [
        { value: "86", label: "86 版（王码五笔）" },
        { value: "98", label: "98 版" },
      ] },
    { key: "pick", label: "候选序号", type: "number", default: 1, placeholder: "1 起" },
    { key: "all", label: "列出全部候选", type: "bool", default: false },
  ],
  encode: (text, p) => withCnTable("wubi", (T) => encodeWithTable(text, T[verOf(p)])),
  decode: (text, p) => withCnTable("wubi", (T) => decodeLetters(text, T[verOf(p)], {
    caseMode: "lower",
    pick: p && p.pick,
    all: p && (p.all === true || p.all === "true"),
  })),
  detect: detectWubi,
});
