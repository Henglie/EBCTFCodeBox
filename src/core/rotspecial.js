/*
 * rotspecial.js — ROT 任意位移 + ROT8000（T271，件内自注册两个 op）。
 *
 * op1 rotSpecial (cat:classic) ROT 任意位移密码。可指定任意位移 N（不止 13/5/47）
 * 在选定字母表上循环移位。alphabet: letters(仅A-Z/a-z) / alnum(含0-9) / ascii94(全可打印)。
 * encode/decode 双向，decode = -shift。
 *
 * op2 rot8000 (cat:fancy) ROT8000 —— Unicode 版 ROT13。
 * 算法照抄 rottytooth 权威实现 rot8000.js（github.com/rottytooth/rot8000）：
 * 用 valid-code-point-transitions 转换表在 BMP(0x0000..0xFFFF) 内构造「有效码位」有序表
 * 排除 C0/C1 控制符、各类空白/分隔符、代理区(0xD800..0xDFFF)；其余（含私用区/非字符）均有效。
 * 旋转量 = 有效表长的一半（实测 63404/2 = 31702），故自反（encode==decode）。
 * 不在表内的字符（空格/换行/控制符/星光面字符）原样透传。不许编造——本表逐字复刻源码。
 */
import { register } from "./registry.js";

// ================= op1 rotSpecial =================

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGIT = "0123456789";

// 在长度 n 的循环表内取 (idx+shift) mod n（shift 可负）。
const wrap = (idx, shift, n) => (((idx + shift) % n) + n) % n;

/**
 * ROT 任意位移。
 * letters : 大写在 A-Z(26) 内移，小写在 a-z(26) 内移，其余原样。
 * alnum : 额外让数字在 0-9(10) 内移（类比 rot18 = rot13+rot5）。
 * ascii94 : 全可打印 ASCII 0x21..0x7E(94) 内移（类比 rot47 的任意位移版），其余原样。
 */
function rotShift(text, shift, alphabet) {
  const s = Number(shift) || 0;
  if (alphabet === "ascii94") {
    let out = "";
    for (const ch of text) {
      const code = ch.codePointAt(0);
      if (code >= 0x21 && code <= 0x7e) {
        out += String.fromCharCode(0x21 + wrap(code - 0x21, s, 94));
      } else {
        out += ch;
      }
    }
    return out;
  }
  const doDigit = alphabet === "alnum";
  let out = "";
  for (const ch of text) {
    if (ch >= "A" && ch <= "Z") {
      out += UPPER[wrap(ch.charCodeAt(0) - 65, s, 26)];
    } else if (ch >= "a" && ch <= "z") {
      out += LOWER[wrap(ch.charCodeAt(0) - 97, s, 26)];
    } else if (doDigit && ch >= "0" && ch <= "9") {
      out += DIGIT[wrap(ch.charCodeAt(0) - 48, s, 10)];
    } else {
      out += ch;
    }
  }
  return out;
}

register({
  id: "rotSpecial",
  cat: "classic",
  name: "Rot 任意位移",
  desc: "任意位移量 N 的循环移位（letters/alnum/ascii94），decode 反向",
  params: [
    { key: "shift", label: "位移量", type: "number", default: 13 },
    {
      key: "alphabet",
      label: "字母表",
      type: "select",
      default: "letters",
      options: [
        { value: "letters", label: "字母 A-Z/a-z" },
        { value: "alnum", label: "字母+数字" },
        { value: "ascii94", label: "全可打印 ASCII" },
      ],
    },
  ],
  encode: (t, p = {}) => rotShift(t, p.shift ?? 13, p.alphabet ?? "letters"),
  decode: (t, p = {}) => rotShift(t, -(p.shift ?? 13), p.alphabet ?? "letters"),
});

// ================= op2 rot8000 =================

// valid-code-point-transitions.json（逐字复刻 rottytooth/rot8000）。
// key = 有效性翻转的码位，value = 从该码位起的有效性。
const ROT8000_TRANSITIONS = {
  33: true, 127: false, 161: true, 5760: false, 5761: true,
  8192: false, 8203: true, 8232: false, 8234: true, 8239: false,
  8240: true, 8287: false, 8288: true, 12288: false, 12289: true,
  55296: false, 57344: true,
};
const BMP_SIZE = 0x10000;

// 惰性构造映射表（首次调用时建，之后缓存）。
let _rotMap = null;
function buildRot8000Map() {
  if (_rotMap) return _rotMap;
  const validList = [];
  let currValid = false;
  for (let i = 0; i < BMP_SIZE; i++) {
    if (ROT8000_TRANSITIONS[i] !== undefined) currValid = ROT8000_TRANSITIONS[i];
    if (currValid) validList.push(i);
  }
  const rotateNum = validList.length / 2; // 63404/2 = 31702
  const map = new Map();
  for (let i = 0; i < validList.length; i++) {
    map.set(
      String.fromCharCode(validList[i]),
      String.fromCharCode(validList[(i + rotateNum) % (rotateNum * 2)])
    );
  }
  _rotMap = map;
  return map;
}

// 自反：旋转量为表长一半，encode==decode。表外字符原样透传。
function rot8000(text) {
  const map = buildRot8000Map();
  let out = "";
  for (const ch of text) {
 // 逐 UTF-16 code unit：星光面字符（代理对）不在 BMP 表内，原样透传。
    const mapped = map.get(ch);
    out += mapped !== undefined ? mapped : ch;
  }
  return out;
}

register({
  id: "rot8000",
  cat: "fancy",
  name: "ROT8000",
  desc: "Unicode 版 ROT13：BMP 有效码位表旋转半程（自反）",
  encode: rot8000,
  decode: rot8000,
  detect: (t) => {
    const s = (t || "").trim();
    if (s.length < 2) return 0;
 // ROT8000 密文集中在 CJK/籀文类高位 BMP 区（U+3001..U+D7FF），且几乎无 ASCII 字母。
    let high = 0, asciiLetter = 0, total = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) continue;
      total++;
      if (c >= 0x3001 && c <= 0xd7ff) high++;
      if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) asciiLetter++;
    }
    if (!total) return 0;
    const hr = high / total;
    return hr > 0.6 && asciiLetter === 0 ? Math.min(0.5, 0.2 + hr * 0.3) : 0;
  },
});
