/*
 * t816FromCiRegex.js — 还原大小写不敏感正则（CyberChef #164）。
 *
 * 口径与 CyberChef src/core/operations/FromCaseInsensitiveRegex.mjs 逐行一致：
 * 把 [aA] 形式的两个字母字符类折成一个字母（取第一个字符），非两字母字符类原样保留。
 * 纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";

register({
  id: "fromCiRegex",
  cat: "text",
  io: "text",
  name: "还原大小写不敏感正则",
  desc: "把 [sS] 这类大小写展开字符类折叠成单字母（不保证还原原始大小写）；[Gg]、[0-9] 等非两字母类原样保留。口径同 CyberChef「From Case Insensitive Regex」",
  params: [],
  run(text) {
    return String(text == null ? "" : text).replace(
      /\[[a-z]{2}\]/ig,
      (m) => (m[1].toUpperCase() === m[2].toUpperCase() ? m[1] : m)
    );
  },
});
