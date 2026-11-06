/*
 * t813StripHttpHeaders.js — 剥离 HTTP 头（CyberChef #409 / RFC 7230 §3）。
 *
 * 口径与 CyberChef src/core/operations/StripHTTPHeaders.mjs 一致：
 * 优先找第一个 CRLFCRLF，找不到再找 LFLF；返回其后的报文主体，找不到分隔则原样返回。
 * 纯文本运算，零依赖、零外发。
 */
import { register } from "./registry.js";

register({
  id: "stripHttpHeaders",
  cat: "forensic",
  name: "剥离 HTTP 头",
  desc: "按首个空行（CRLFCRLF 或 LFLF）截断，只保留 HTTP 请求/响应正文；无空行时原样返回。依据 RFC 7230 §3",
  params: [],
  run(text) {
    const input = String(text == null ? "" : text);
    let headerEnd = input.indexOf("\r\n\r\n");
    headerEnd = headerEnd < 0 ? input.indexOf("\n\n") + 2 : headerEnd + 4;
    return headerEnd < 2 ? input : input.slice(headerEnd);
  },
});
