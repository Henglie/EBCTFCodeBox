/*
 * albam.js — Albam 码（cat:'fancy'）。
 *
 * Albam（希伯来语 אלב״ם）是希伯来传统「置换密码」三式之一（Atbash / Albam / Atbah）。
 * 拉丁字母版：把 26 字母平分两半 ABCDEFGHIJKLM | NOPQRSTUVWXYZ
 * 上下对位互换 —— A↔N, B↔O, C↔P, ..., M↔Z。属对合（involution，加解密同一张表）。
 *
 * 权威来源：
 * - dCode "Albam Cipher"（拉丁字母半移位定义）
 * - Wikipedia/Practical Cryptography ROT13：拉丁 Albam 与 ROT13 数值等价
 * （偏移 13 = 字母表半长），本实现按「两半对位互换」直写，等价 ROT13。
 * 注：采用公开权威定义（半移位互换），映射唯一无歧义。
 *
 * 纯前端零外发。
 *
 * 契约：register({id, cat:"fancy", name, desc, encode, decode})。
 * 加解密同表（对合），大小写各自保留，非字母原样透传。
 */
import { register } from "./registry.js";

// 两半对位互换表（A↔N ... M↔Z），对合。
const HALF = 13;

function albamChar(ch) {
  const c = ch.charCodeAt(0);
 // 大写 A-Z
  if (c >= 65 && c <= 90) {
    return String.fromCharCode(((c - 65 + HALF) % 26) + 65);
  }
 // 小写 a-z
  if (c >= 97 && c <= 122) {
    return String.fromCharCode(((c - 97 + HALF) % 26) + 97);
  }
 // 非字母原样透传
  return ch;
}

function albamTransform(text) {
  let out = "";
  for (const ch of text) out += albamChar(ch);
  return out;
}

register({
  id: "albam",
  cat: "fancy",
  name: "Albam 码",
  desc: "希伯来 Albam 置换的拉丁版：26 字母平分两半对位互换（A↔N..M↔Z），对合，数值等价 ROT13",
  encode: albamTransform,
  decode: albamTransform, // 对合：同一张表
});

export { albamTransform };
