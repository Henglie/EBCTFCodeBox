/*
 * carbonaro.js — Carbonaro 码（cat:'fancy'）。
 *
 * Carbonaro 密码：19 世纪初那不勒斯烧炭党（Carboneria）秘密社团所用单表替换。
 * 用意大利语 21 字母表（无 J K W X Y），明文位与「Carbonaro 字母表」同位互换。
 *
 * 权威编码表来源：thecipher.jimdofree.com "THE CARBONARO ALPHABET"
 * 明文 21 字母：A B C D E F G H I L M N O P Q R S T U V Z
 * 编码字母表： O P G T I V C H E R N M A B Q L Z D U F S
 * （即 A→O B→P C→G D→T E→I F→V G→C H→H I→E L→R M→N N→M
 * O→A P→B Q→Q R→L S→Z T→D U→U V→F Z→S）
 * 经验证为对合（involution）：A↔O B↔P C↔G D↔T E↔I F↔V L↔R M↔N S↔Z
 * H/Q/U 为不动点，故加解密共用同一张表。
 *
 * 说明：本实现采用公开权威历史表（那不勒斯 Carboneria 21 字母版）。
 * 意大利语表外的 J K W X Y 不参与替换，原样透传。
 *
 * 纯前端零外发。
 *
 * 契约：register({id, cat:"fancy", name, desc, encode, decode})。
 * 加解密同表（对合），大小写分别保留，非表内字符原样透传。
 */
import { register } from "./registry.js";

// 明文 21 字母（意大利语，无 J K W X Y）
const PLAIN = "ABCDEFGHILMNOPQRSTUVZ";
// Carbonaro 编码字母表（与 PLAIN 同位对应）
const CIPHER = "OPGTIVCHERNMABQLZDUFS";

// 构建对合映射表（大写）。因表为对合，encode/decode 共用。
const MAP = {};
for (let i = 0; i < PLAIN.length; i++) {
  MAP[PLAIN[i]] = CIPHER[i];
}

function carbonaroChar(ch) {
  const up = ch.toUpperCase();
  const mapped = MAP[up];
  if (mapped === undefined) return ch; // 表外字符（含 J K W X Y、数字、符号）原样
 // 保留原大小写
  return ch === up ? mapped : mapped.toLowerCase();
}

function carbonaroTransform(text) {
  let out = "";
  for (const ch of text) out += carbonaroChar(ch);
  return out;
}

register({
  id: "carbonaro",
  cat: "fancy",
  name: "Carbonaro 码",
  desc: "那不勒斯烧炭党单表替换，意大利语 21 字母对位互换（对合表，J K W X Y 透传）",
  encode: carbonaroTransform,
  decode: carbonaroTransform, // 对合：同一张表
});

export { carbonaroTransform, PLAIN, CIPHER };
