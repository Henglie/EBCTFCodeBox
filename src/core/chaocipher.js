/*
 * chaocipher.js — Chaocipher 双转子置换密码（T304，cat:'classic'，双向）。
 *
 * 背景：John F. Byrne 于 1918 年发明，长期保密，直到 2010 年其遗物捐出后由
 * Moshe Rubin 在《Chaocipher Revealed: The Algorithm》中还原并公开。
 * 本实现严格照该权威算法（zenith=位1 / nadir=位14 的双盘动态置换）。
 *
 * 核心模型：两个 26 字母的动态字母表（转盘）
 * - left （ciphertext / 密文盘）
 * - right （plaintext / 明文盘）
 *
 * 加密一个明文字母：
 * 1. 在 right（明文盘）中定位明文字母，记其索引 idx；
 * 2. 密文字母 = left（密文盘）同一索引 idx 处的字母；
 * 3. 分别置换两个盘（见下），再处理下一个字母。
 *
 * 解密一个密文字母：
 * 1. 在 left（密文盘）中定位密文字母，记其索引 idx；
 * 2. 明文字母 = right（明文盘）同一索引 idx 处的字母；
 * 3. 用同样的规则、同样的索引置换两个盘（Chaocipher 编解码对称）。
 *
 * 左盘（密文盘）置换（0-indexed，zenith=0，nadir=13）：
 * ① 循环左移 idx 位，使刚配对的字母落到 zenith(0)；
 * ② 取出 zenith+1（索引1）处的字母；
 * ③ 索引 2..13 整体左移一格填空缺，取出的字母插入 nadir(索引13)；
 * ④ 索引0 与 索引14..25 不动。
 *
 * 右盘（明文盘）置换（0-indexed）：
 * ① 循环左移 (idx+1) 位（先把配对字母移到 zenith，再多移一格）；
 * ② 取出 zenith+2（索引2）处的字母；
 * ③ 索引 3..13 整体左移一格填空缺，取出的字母插入 nadir(索引13)；
 * ④ 索引0、1 与 索引14..25 不动。
 *
 * 只处理 A-Z（先转大写）；非字母字符原样透传，且不推进转盘（保持可逆）。
 *
 * 红线：
 * - 只新建 chaocipher.js，不碰任何现有 core / main.js / i18n。
 * - 照权威算法不编造；官方测试向量对拍 + 往返测试。
 */

import { register } from "./registry.js";

const STD_LEFT = "HXUCZVAMDSLKPEFJRIGTWOBNYQ";
const STD_RIGHT = "PTLNBQDEOYSFAVZKGJRIHWXUMC";

function toAlphabet(str, fallback) {
  const s = String(str == null ? "" : str).toUpperCase().replace(/[^A-Z]/g, "");
  if (s.length === 0) return fallback.split("");
  if (s.length !== 26 || new Set(s).size !== 26) {
    throw new Error("字母表必须是 A-Z 的 26 个不重复字母");
  }
  return s.split("");
}

function permuteLeft(arr, idx) {
  const r = arr.slice(idx).concat(arr.slice(0, idx));
  return [r[0]]
    .concat(r.slice(2, 14))
    .concat([r[1]])
    .concat(r.slice(14));
}

function permuteRight(arr, idx) {
  const k = (idx + 1) % 26;
  const r = arr.slice(k).concat(arr.slice(0, k));
  return r
    .slice(0, 2)
    .concat(r.slice(3, 14))
    .concat([r[2]])
    .concat(r.slice(14));
}

function run(text, p, mode) {
  const left0 = toAlphabet(p && p.left, STD_LEFT);
  const right0 = toAlphabet(p && p.right, STD_RIGHT);
  let left = left0.slice();
  let right = right0.slice();
  const src = String(text).toUpperCase();
  let out = "";
  for (const ch of src) {
    if (ch < "A" || ch > "Z") {
      out += ch;
      continue;
    }
    let idx;
    let mapped;
    if (mode === "encode") {
      idx = right.indexOf(ch);
      mapped = left[idx];
    } else {
      idx = left.indexOf(ch);
      mapped = right[idx];
    }
    out += mapped;
    left = permuteLeft(left, idx);
    right = permuteRight(right, idx);
  }
  return out;
}

function chaoEncode(text, p) {
  return run(text, p, "encode");
}

function chaoDecode(text, p) {
  return run(text, p, "decode");
}

register({
  id: "chaocipher",
  cat: "classic",
  name: "Chaocipher",
  desc: "Chaocipher 双转子置换密码（Byrne 1918，2010 年公开）。左=密文盘 / 右=明文盘，每加密一字符后按 zenith/nadir 规则动态置换两盘。默认盘为官方展品字母表，可自定义。仅处理 A-Z。",
  params: [
    {
      key: "left", label: "密文盘（左）", type: "text", default: STD_LEFT,
      placeholder: "A-Z 的 26 个不重复字母",
    },
    {
      key: "right", label: "明文盘（右）", type: "text", default: STD_RIGHT,
      placeholder: "A-Z 的 26 个不重复字母",
    },
  ],
  encode: chaoEncode,
  decode: chaoDecode,
});

export { chaoEncode, chaoDecode, STD_LEFT, STD_RIGHT };
