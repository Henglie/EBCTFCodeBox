/*
 * t816DefangUrl.js — Defang URL（CyberChef #95）。
 *
 * 口径与 CyberChef src/core/operations/DefangURL.mjs 一致：
 * URL/域名正则来自 CyberChef src/core/lib/Extract.mjs（Apache-2.0），逐行移植；
 * 可分别开关 . → [.]、http → hxxp、:// → [://]，并可选只处理完整 URL / 域名 / 全文。
 * 纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";

const PROTOCOL = "[A-Z]+://";
const HOSTNAME = "[-\\w]+(?:\\.\\w[-\\w]*)+";
const PORT = ":\\d+";
const PATH = "/[^.!,?\"<>\\[\\]{}\\s\\x7F-\\xFF]*" +
  "(?:[.!,?]+[^.!,?\"<>\\[\\]{}\\s\\x7F-\\xFF]+)*";
const URL_REGEX = new RegExp(PROTOCOL + HOSTNAME + "(?:" + PORT + ")?(?:" + PATH + ")?", "ig");
const DOMAIN_REGEX = /\b((?=[a-z0-9-]{1,63}\.)(xn--)?[a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,63}\b/ig;

function defangURL(url, dots, http, slashes) {
  let s = url;
  if (dots) s = s.replace(/\./g, "[.]");
  if (http) s = s.replace(/http/gi, "hxxp");
  if (slashes) s = s.replace(/:\/\//g, "[://]");
  return s;
}

register({
  id: "defangUrl",
  cat: "forensic",
  io: "text",
  name: "Defang URL",
  desc: "把 URL/域名改写成不可直接点击的 IOC 形式：. → [.]、http → hxxp、:// → [://]；可只处理完整 URL、域名或全文。口径同 CyberChef「Defang URL」",
  params: [
    { key: "dots", label: "转义点号（. → [.]）", type: "bool", default: true },
    { key: "http", label: "转义 http（http → hxxp）", type: "bool", default: true },
    { key: "slashes", label: "转义 ://（:// → [://]）", type: "bool", default: true },
    { key: "process", label: "处理范围", type: "select", default: "domains", options: [
      { value: "domains", label: "有效域名与完整 URL" },
      { value: "fullUrls", label: "仅完整 URL" },
      { value: "everything", label: "全文" },
    ] },
  ],
  run(text, p) {
    const dots = !(p && p.dots === false);
    const http = !(p && p.http === false);
    const slashes = !(p && p.slashes === false);
    const process = (p && p.process) ? String(p.process) : "domains";
    let input = String(text == null ? "" : text);
    if (process === "domains") {
      input = input.replace(URL_REGEX, (x) => defangURL(x, dots, http, slashes));
      input = input.replace(DOMAIN_REGEX, (x) => defangURL(x, dots, http, slashes));
    } else if (process === "fullUrls") {
      input = input.replace(URL_REGEX, (x) => defangURL(x, dots, http, slashes));
    } else if (process === "everything") {
      input = defangURL(input, dots, http, slashes);
    }
    return input;
  },
});
