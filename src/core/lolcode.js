/*
 * lolcode.js — LOLCODE 语言字符移位编码（cat:'fancy'）。
 *
 * 算法（decode）:
 * num = ord(c) - 3
 * if num > 69: num += 5
 * else: num += 2
 * chr(num)
 *
 * encode 为 decode 的逆运算:
 * decode 两分支: m = c+2 (当 c>72) 或 m = c-1 (当 c<=72)
 * 逆: c = m-2 (当 m>74) 或 c = m+1 (当 m<=71)
 * m ∈ {72,73,74}（即 H/I/J）无解——算法非双射，decode 不可达这三个值，encode 抛错。
 *
 * 固定向量:
 * decode("LSBBDRGyJmjD1b4]2q]dsl6w{") = "NUAACTF{LolC0d3_1s_fun5y}"
 */
import { register } from "./registry.js";

// decode：LOLCODE_Language 字符移位（Python ord/chr → JS codePointAt/fromCodePoint）
function lolcodeDecode(text) {
  const s = String(text);
  let msg = "";
  for (const ch of s) {
    let num = ch.codePointAt(0);
    num -= 3;
    if (num > 69) num += 5;
    else num += 2;
    msg += String.fromCodePoint(num);
  }
  return msg;
}

// encode：decode 的逆运算。明文码点 m → 密文码点 c。
// m > 74: c = m - 2（对应 decode 分支1: c>72 → m=c+2）
// m <= 71: c = m + 1（对应 decode 分支2: c<=72 → m=c-1）
// m ∈ {72,73,74}（H/I/J）: 无解抛错
function lolcodeEncode(text) {
  const s = String(text);
  let out = "";
  for (const ch of s) {
    const m = ch.codePointAt(0);
    let c;
    if (m > 74) c = m - 2;
    else if (m <= 71) c = m + 1;
    else throw new Error(
      `LOLCODE encode: 明文字符 '${ch}' (U+${m.toString(16).toUpperCase()}) 不可逆——算法非双射，H/I/J 无对应密文`
    );
    out += String.fromCodePoint(c);
  }
  return out;
}

// detect：LOLCODE 密文是字符移位后的可见 ASCII，无固定字符集特征，无法可靠识别。
// 返回 0 避免一把梭误报（函数存在满足"必带 detect"要求）。
function lolcodeDetect(_text) {
  return 0;
}

register({
  id: "lolcode", cat: "fancy",
  name: "LOLCODE",
  desc: "LOLCODE 语言字符移位编码（-3 后 >69 +5 否则 +2，非双射 H/I/J 不可逆）",
  encode: lolcodeEncode, decode: lolcodeDecode,
  detect: lolcodeDetect,
});
