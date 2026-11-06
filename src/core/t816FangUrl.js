/*
 * t816FangUrl.js — Fang URL（CyberChef #134）。
 *
 * 口径与 CyberChef src/core/operations/FangURL.mjs 逐行一致：
 * [.] → .、hxxp → http、[://] → ://，三项可分别开关。纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";

function fangURL(url, dots, http, slashes) {
  let s = url;
  if (dots) s = s.replace(/\[\.\]/g, ".");
  if (http) s = s.replace(/hxxp/g, "http");
  if (slashes) s = s.replace(/\[:\/\/\]/g, "://");
  return s;
}

register({
  id: "fangUrl",
  cat: "forensic",
  name: "Fang URL（还原）",
  desc: "把 Defang 后的 URL 还原：[.] → .、hxxp → http、[://] → ://；三项可分别开关。口径同 CyberChef「Fang URL」",
  params: [
    { key: "dots", label: "还原 [.]", type: "bool", default: true },
    { key: "http", label: "还原 hxxp", type: "bool", default: true },
    { key: "slashes", label: "还原 [://]", type: "bool", default: true },
  ],
  run(text, p) {
    const dots = !(p && p.dots === false);
    const http = !(p && p.http === false);
    const slashes = !(p && p.slashes === false);
    return fangURL(String(text == null ? "" : text), dots, http, slashes);
  },
});
