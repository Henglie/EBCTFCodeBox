import { register } from "./registry.js";
import { withCnTable, encodeWithTable, decodeDigits, detectFourCorner, CN_LOOKUP } from "./cnLookupUtil.js";

register({
  id: "fourCorner", cat: "cn", name: "四角号码",
  desc: "四角号码 ↔ 汉字；可输 5 位（含附号）或 4 位主码，也认 4022.7 点分写法；同码字按词频列候选，默认列出全部候选；参数：位数 + 候选序号 + 全候选",
  params: [
    { key: "digits", label: "编码位数", type: "select", default: "5",
      options: [
        { value: "5", label: "5 位（主码 + 附号）" },
        { value: "4", label: "4 位（只要主码）" },
      ] },
    { key: "pick", label: "候选序号", type: "number", default: 1, placeholder: "1 起" },
    { key: "all", label: "列出全部候选", type: "bool", default: true },
  ],
  encode: (text, p) => withCnTable("fourcorner", (TABLE) => encodeWithTable(text, TABLE, {
    format: (code) => (String(p && p.digits) === "4" ? code.slice(0, 4) : code),
  })),
  decode: (text, p) => withCnTable("fourcorner", (TABLE) => decodeDigits(text, {
    table: TABLE,
    normalize: (token) => {
      const s = token.replace(/\./g, "");
      return /^\d{4,5}$/.test(s) ? s : "";
    },
    lookup: (code) => {
      const exact = TABLE.codeToChars.get(code);
      if (exact) return exact;
      // 部分字表只收 4 位主码；允许 5 位输入用末位 0 回退到 4 位（如 识=3678 也认 36780）。
      if (code.length === 5 && code.endsWith("0")) {
        const main = code.slice(0, 4);
        return TABLE.code4ToChars.get(main) || TABLE.codeToChars.get(main) || null;
      }
      if (code.length === 4) return TABLE.code4ToChars.get(code) || null;
      return null;
    },
    segment: (token) => {
      const s = token.replace(/\./g, "");
      return /^\d+$/.test(s) && s.length > 5 ? CN_LOOKUP.splitDigits(s, [5, 4]) : [token];
    },
    pick: p && p.pick,
    all: p ? (p.all === true || p.all === "true") : true,
  })),
  detect: detectFourCorner,
  magicParams: { all: false },
});
