/*
 * straddleCheckerboard.js — 跨界棋盘 Straddling checkerboard（T305，cat:'classic'，双向）。
 *
 * 背景：跨界棋盘是一种变长（fractionating）编码棋盘，二战间谍与 VIC 密码常用。
 * 它把 8 个高频字母放在首行、占用单个数字码；两个空列的列头数字作为前缀
 * 引出下两行的剩余字母 + 常用符号（.、/），占用两位数字码。
 * "straddling"（跨界）指首行的空列既是字母缺口、又是下两行的行前缀。
 *
 * 权威配置（默认，照 Wikipedia "Straddling checkerboard" 经典例）：
 *
 * 0 1 2 3 4 5 6 7 8 9
 * A T O N E S I R ← 首行：ATONESIR 占列 0/1/3/4/5/7/8/9，列 2/6 空
 * 2 B C D F G H J K L M ← 前缀 2：20..29
 * 6 P Q U V W X Y Z . / ← 前缀 6：60..69
 *
 * 单位码：A=0 T=1 O=3 N=4 E=5 S=7 I=8 R=9
 * 双位码（前缀 2）：B=20 C=21 D=22 F=23 G=24 H=25 J=26 K=27 L=28 M=29
 * 双位码（前缀 6）：P=60 Q=61 U=62 V=63 W=64 X=65 Y=66 Z=67 .=68 /=69
 *
 * 自定界（无需分隔符即可解码）：
 * 解码时逐位读数字——若该数字是某个「行前缀」（默认 2 或 6），则再吞一位组成两位码；
 * 否则该单个数字就是一个首行字母。前缀数字绝不会同时作为首行字母码，故无歧义。
 *
 * 参数化：
 * - high：首行 8 个高频字母（默认 "ATONESIR"，须 8 个不重复 A-Z）。
 * - blanks：首行两个空列的列头数字（默认 "26"，须 2 个不同的 0-9 数字）。
 * - lower：下两行 20 个字符（默认 "BCDFGHJKLMPQUVWXYZ./"，前 10 属前缀 blanks[0]、后 10 属 blanks[1]）。
 *
 * 编码：先大写；棋盘内字符（默认含 A-Z 与 . /）→ 数字码；棋盘外字符跳过（保证数字流可逆）。
 * 解码：纯数字流 → 字符；非数字字符原样透传。
 *
 * 红线：
 * - 只新建 straddleCheckerboard.js，不碰任何现有 core / main.js / i18n。
 * - 照权威配置不编造；经典棋盘固定向量对拍 + 往返测试。
 */

import { register } from "./registry.js";

const DEF_HIGH = "ATONESIR";
const DEF_BLANKS = "26";
const DEF_LOWER = "BCDFGHJKLMPQUVWXYZ./";

function buildBoard(p) {
  const high = String((p && p.high) != null ? p.high : DEF_HIGH).toUpperCase().replace(/[^A-Z]/g, "");
  const blanks = String((p && p.blanks) != null ? p.blanks : DEF_BLANKS).replace(/[^0-9]/g, "");
  const lower = String((p && p.lower) != null ? p.lower : DEF_LOWER).toUpperCase();

  if (high.length !== 8 || new Set(high).size !== 8) {
    throw new Error("首行高频字母须为 8 个不重复字母");
  }
  if (blanks.length !== 2 || blanks[0] === blanks[1]) {
    throw new Error("空列前缀须为 2 个不同的 0-9 数字");
  }
  if (lower.length !== 20) {
    throw new Error("下两行须为 20 个字符");
  }

  const blankCols = [Number(blanks[0]), Number(blanks[1])];
  const encodeMap = {};
  const decodeMap = {};

  let hi = 0;
  for (let col = 0; col < 10; col++) {
    if (blankCols.indexOf(col) !== -1) continue;
    const ch = high[hi++];
    const code = String(col);
    encodeMap[ch] = code;
    decodeMap[code] = ch;
  }

  for (let row = 0; row < 2; row++) {
    const prefix = blankCols[row];
    for (let col = 0; col < 10; col++) {
      const ch = lower[row * 10 + col];
      const code = String(prefix) + String(col);
      encodeMap[ch] = code;
      decodeMap[code] = ch;
    }
  }

  return { encodeMap, decodeMap, prefixes: blankCols.map(String) };
}

function scEncode(text, p) {
  const { encodeMap } = buildBoard(p);
  const src = String(text).toUpperCase();
  let out = "";
  for (const ch of src) {
    const code = encodeMap[ch];
    if (code != null) out += code;
  }
  return out;
}

function scDecode(text, p) {
  const { decodeMap, prefixes } = buildBoard(p);
  const src = String(text);
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c < "0" || c > "9") {
      out += c;
      i++;
      continue;
    }
    if (prefixes.indexOf(c) !== -1 && i + 1 < src.length && src[i + 1] >= "0" && src[i + 1] <= "9") {
      const two = c + src[i + 1];
      const ch = decodeMap[two];
      if (ch != null) {
        out += ch;
        i += 2;
        continue;
      }
    }
    const one = decodeMap[c];
    out += one != null ? one : c;
    i++;
  }
  return out;
}

register({
  id: "straddleCheckerboard",
  cat: "classic",
  name: "跨界棋盘",
  desc: "Straddling checkerboard 跨界棋盘：变长编码棋盘。8 个高频字母占单数字、两空列前缀引出双数字行，自定界无需分隔符即可解码。默认照 Wikipedia 经典配置（ATONESIR + 前缀 2/6）。棋盘外字符编码时跳过。",
  params: [
    {
      key: "high", label: "首行高频字母", type: "text", default: DEF_HIGH,
      placeholder: "8 个不重复 A-Z 字母",
    },
    {
      key: "blanks", label: "空列前缀", type: "text", default: DEF_BLANKS,
      placeholder: "2 个不同的 0-9 数字",
    },
    {
      key: "lower", label: "下两行字符", type: "text", default: DEF_LOWER,
      placeholder: "20 个字符（前 10 属前缀 1、后 10 属前缀 2）",
    },
  ],
  encode: scEncode,
  decode: scDecode,
});

export { scEncode, scDecode, buildBoard, DEF_HIGH, DEF_BLANKS, DEF_LOWER };
