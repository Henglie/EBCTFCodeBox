/*
 * t813RemoveDiacritics.js — 去除变音符号（CyberChef #357）。
 *
 * 口径与 CyberChef src/core/operations/RemoveDiacritics.mjs 一致：
 * NFD 分解后删除 U+0300–U+036F 组合附加符号。不使用额外特殊映射（ø/ß/Ł 等保持原样）。
 * 纯文本运算，零依赖、零外发。
 */
import { register } from "./registry.js";

register({
  id: "removeDiacritics",
  cat: "text",
  name: "去除变音符号",
  desc: "Unicode NFD 分解后删除 U+0300–U+036F 组合附加符号，把带重音的拉丁字符还原为基字符。口径同 CyberChef「Remove Diacritics」",
  params: [],
  run(text) {
    return String(text == null ? "" : text).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  },
});
