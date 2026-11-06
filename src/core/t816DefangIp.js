/*
 * t816DefangIp.js — Defang IP 地址（CyberChef #94）。
 *
 * 口径与 CyberChef src/core/operations/DefangIPAddresses.mjs 逐行一致：
 * IPv4 的 . → [.]；IPv6 的 : → [:]；可带 IPv4 CIDR 后缀。纯本地计算，零依赖、零外发。
 */
import { register } from "./registry.js";

const IPV4_REGEX = new RegExp("(?:(?:\\d|[01]?\\d\\d|2[0-4]\\d|25[0-5])\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d|\\d)(?:\\/\\d{1,2})?", "g");
const IPV6_REGEX = new RegExp("((?=.*::)(?!.*::.+::)(::)?([\\dA-Fa-f]{1,4}:(:|\\b)|){5}|([\\dA-Fa-f]{1,4}:){6})((([\\dA-Fa-f]{1,4}((?!\\3)::|:\\b|(?![\\dA-Fa-f])))|(?!\\2\\3)){2}|(((2[0-4]|1\\d|[1-9])?\\d|25[0-5])\\.?\\b){4})", "g");

register({
  id: "defangIp",
  cat: "forensic",
  io: "text",
  name: "Defang IP 地址",
  desc: "把 IPv4/IPv6 地址改写成不可直接点击的形式：IPv4 的 . → [.]，IPv6 的 : → [:]。用于安全报告/IOC。口径同 CyberChef「Defang IP Addresses」",
  params: [],
  run(text) {
    let input = String(text == null ? "" : text);
    input = input.replace(IPV4_REGEX, (x) => x.replace(/\./g, "[.]"));
    input = input.replace(IPV6_REGEX, (x) => x.replace(/:/g, "[:]"));
    return input;
  },
});
