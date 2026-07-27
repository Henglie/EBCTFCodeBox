/*
 * pizzini.js — Pizzini 密码（cat:'classic'）。
 *
 * Pizzini 密码：古典字母-数字替换，A=4..Z=29。
 *
 * 算法链路（pizzini_encrypto/pizzini_decrypto）:
 * 1. encode: message 转大写，A-Z → 数字串（A=4,B=5,...,F=9,G=10,...,Z=29）
 * 输出数字串无分隔，非字母原样保留
 * 2. decode: 遍历数字串，遇 "1" 当两位数前缀（10-19 → G-P）
 * 遇 "2" 当两位数前缀（20-29 → Q-Z），其他单数字 4-9 → A-F
 * 靠 validNumbers 表（数字个位）反查字母
 *
 * 两张 validNumbers 表分别用于 encode / decode。
 *
 * 契约：register({id, cat:"classic", name, desc, encode, decode})。
 * encode(text) → 数字串
 * decode(text) → 明文大写
 */
import { register } from "./registry.js";

// ============================================================
// encode 表
// validLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
// validNumbers = ['4','5','6','7','8','9','10','11','12','13','14','15'
// '16','17','18','19','20','21','22','23','24','25','26','27','28','29']
// 即 A=4, B=5, C=6, D=7, E=8, F=9, G=10, H=11, ..., Z=29
// ============================================================
const VALID_LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ENCODE_NUMBERS = [
  "4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15",
  "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29",
];
// 字母 → 数字串
const LETTER_TO_NUM = {};
for (let i = 0; i < 26; i++) LETTER_TO_NUM[VALID_LETTERS[i]] = ENCODE_NUMBERS[i];

// ============================================================
// decode 表
// validNumbers = ['4','5','6','7','8','9','0','1','2','3','4','5','6'
// '7','8','9','0','1','2','3','4','5','6','7','8','9']
// 即 A=4,B=5,C=6,D=7,E=8,F=9,G=0,H=1,I=2,J=3,K=4,L=5,M=6,N=7,O=8,P=9
// Q=0,R=1,S=2,T=3,U=4,V=5,W=6,X=7,Y=8,Z=9（数字 % 10）
// ============================================================
const DECODE_NUMBERS = [
  "4", "5", "6", "7", "8", "9", "0", "1", "2", "3", "4", "5", "6",
  "7", "8", "9", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
];

// ============================================================
// 加密（pizzini_encrypto）
// ============================================================
function pizziniEncrypt(message) {
  const up = message.toUpperCase();
  let result = "";
  for (const c of up) {
    if (c >= "A" && c <= "Z") {
      const ordinal = VALID_LETTERS.indexOf(c);
      result += ENCODE_NUMBERS[ordinal];
    } else {
 // 非字母原样保留
      result += c;
    }
  }
  return result;
}

// ============================================================
// 解密（pizzini_decrypto）
// ============================================================
function pizziniDecrypt(message) {
 // message += "*" 哨兵
  const msg = message + "*";
  let result = "";
  const lens = msg.length;
  let i = 0;
  while (i < lens - 1) {
    let c = msg[i];
    let matches = false;
    let j = 0;
 // 遇 "1" 当两位数前缀（10-19 → G-P，j 从 6 开始）
    if (c === "1") {
      j = 6;
      i += 1;
      c = msg[i];
    } else if (c === "2") {
 // 遇 "2" 当两位数前缀（20-29 → Q-Z，j 从 16 开始）
      j = 16;
      i += 1;
      c = msg[i];
    }
 // 从 j 开始找 validNumbers[j] == c
    while (j < 26 && !matches) {
      if (c === DECODE_NUMBERS[j]) {
        result += VALID_LETTERS[j];
        matches = true;
      }
      j += 1;
    }
 // 未匹配原样保留
    if (!matches) {
      result += c;
    }
    i += 1;
  }
  return result;
}

// ============================================================
// op 注册
// ============================================================
register({
  id: "pizzini",
  cat: "classic",
  name: "Pizzini 密码",
  desc: "A-Z → 数字替换（A=4..F=9, G=10..Z=29，无分隔数字串）",
  encode: pizziniEncrypt,
  decode: pizziniDecrypt,
});

export { pizziniEncrypt, pizziniDecrypt, VALID_LETTERS, ENCODE_NUMBERS, DECODE_NUMBERS, LETTER_TO_NUM };
