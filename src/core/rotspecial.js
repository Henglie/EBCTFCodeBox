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

// ================= 兼容模式：偏移 31753（全字符平移，空格除外） =================
// 另类实现：所有非空格字符 ±31753（encode +，decode −），非自反。
// 越界（负值）字符原样透传，比参考实现更鲁棒（参考对 ord < 31753 直接崩）。
function rot31753(text, isEncode) {
  const delta = isEncode ? 31753 : -31753;
  let out = "";
  for (const ch of text) {
    if (ch === " ") { out += ch; continue; }
    const cp = ch.codePointAt(0) + delta;
    out += cp >= 0 ? String.fromCodePoint(cp) : ch;
  }
  return out;
}

// 可读性评分：可打印 ASCII / 中文 / 常见标点计分，用于 auto 模式选择解码分支
function rotReadability(s) {
  let good = 0, total = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    total++;
    if ((c >= 0x20 && c <= 0x7e) || c === 0x0a || c === 0x0d) good++;
    else if ((c >= 0x4e00 && c <= 0x9fff) || c === 0x3001 || c === 0x3002) good++;
  }
  return total ? good / total : 0;
}

function rot8000Encode(text, p = {}) {
  const offset = String(p?.offset ?? "auto");
  if (offset === "31753") return rot31753(text, true);
  return rot8000(text);
}

function rot8000Decode(text, p = {}) {
  const offset = String(p?.offset ?? "auto");
  if (offset === "31753") return rot31753(text, false);
  if (offset === "8000") return rot8000(text);
  // auto：两个分支都解，取可读性高者（标准 8000 密文解出中文；31753 密文解回 ASCII）
  const a = rot8000(text);
  const b = rot31753(text, false);
  return rotReadability(b) > rotReadability(a) ? b : a;
}

register({
  id: "rot8000",
  cat: "fancy",
  name: "ROT8000",
  desc: "Unicode 版 ROT13：BMP 有效码位表旋转半程（自反）；offset 参数可切 31753 全字符平移兼容版（仅空格除外），auto 自动检测",
  params: [
    { key: "offset", label: "偏移模式", type: "select", default: "auto",
      options: [
        { value: "auto", label: "auto（解码自动检测两种）" },
        { value: "8000", label: "8000（标准 rottytooth 表旋转）" },
        { value: "31753", label: "31753（全字符平移兼容版）" },
      ] },
  ],
  encode: rot8000Encode,
  decode: rot8000Decode,
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
