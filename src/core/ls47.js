/*
 * ls47.js — LS47 字母牌密码（ElsieFour/LC4 的 7×7 扩展，双向 encode/decode）。
 *
 * 算法（作者 Michal Buszkiewicz / Mirek Kratochvil 2017，官方参考实现
 *   github.com/exaexa/ls47 的 ls47.py，本文件逐函数对照移植）：
 * - 49 字符字母表排成 7×7 牌面 key（每字符恰一次）：
 *   下划线 + 26 小写字母 + 点 + 10 数字 + , - + 星 斜杠 : ? ! ' ( )（见 LETTERS 常量，共 49 字符）
 * - 记号（与参考实现同名）：pos(c) = 字符在 key 中的 (行,列)；ix(c) = 字符在
 *   标准字母表中的固有 (行,列)；marker mp 从 (0,0) 出发。
 * - 加密每个明文字符 p：
 *   ① pp = pos(p)；② mix = ix(key[mp])；③ cp = pp + mix (mod 7)；④ 密文 c = key[cp]
 *   ⑤ key 的 pp[0] 行右旋 1 格；⑥ cp = pos(c)（新牌面下重算）；⑦ key 的 cp[1] 列下旋 1 格
 *   ⑧ mp += ix(c)
 * - 解密为逆过程：pp = cp − mix，其余状态更新完全一致。
 * - 密钥可由口令派生（derive_key）：i 循环 0..6，每字符把第 i 行右旋 ix(c).col 格、
 *   第 i 列下旋 ix(c).row 格。
 *
 * 红线：纯函数本地，零外发；对照官方 ls47.py 输出逐字对拍（见回执）。
 */

import { register } from "./registry.js";

const LETTERS = "_abcdefghijklmnopqrstuvwxyz.0123456789,-+*/:?!'()";
const N = 7;

// 字符 → 标准字母表固有坐标 ix(c) = (index // 7, index % 7)
const IX = new Map();
for (let i = 0; i < LETTERS.length; i++) IX.set(LETTERS[i], [Math.floor(i / N), i % N]);

function checkKey(key) {
  if (typeof key !== "string" || key.length !== LETTERS.length) {
    throw new Error(`密钥必须为 49 字符（7×7 排列），当前 ${key ? key.length : 0} 字符`);
  }
  const seen = new Set();
  for (const c of key) {
    if (!IX.has(c)) throw new Error(`字符「${c}」不在 LS47 字母表中`);
    if (seen.has(c)) throw new Error(`字符「${c}」在密钥中重复`);
    seen.add(c);
  }
  return key;
}

// pos：字符在 key 中的 (行, 列)
function findPos(key, c) {
  const i = key.indexOf(c);
  if (i < 0) throw new Error(`字符「${c}」不在当前牌面（应属 LS47 字母表，密钥或输入有误）`);
  return [Math.floor(i / N), i % N];
}
const findAt = (key, row, col) => key[col + row * N];
const addPos = (a, b) => [(a[0] + b[0]) % N, (a[1] + b[1]) % N];
const subPos = (a, b) => [(a[0] - b[0] + N) % N, (a[1] - b[1] + N) % N];

// 第 row 行右旋 n 格（"abcdefg" 右旋 1 → "gabcdef"）
function rotateRight(key, row, n) {
  const m = ((N - (n % N)) % N);
  return key.slice(0, row * N) + key.slice(row * N + m, row * N + N) + key.slice(row * N, row * N + m) + key.slice((row + 1) * N);
}
// 第 col 列下旋 n 格
function rotateDown(key, col, n) {
  const m = ((N - (n % N)) % N);
  const mid = [];
  for (let r = 0; r < N; r++) mid.push(key[col + r * N]);
  const rotated = mid.slice(m).concat(mid.slice(0, m));
  const arr = key.split("");
  for (let r = 0; r < N; r++) arr[col + r * N] = rotated[r];
  return arr.join("");
}

function deriveKey(password) {
  let k = LETTERS;
  let i = 0;
  for (const c of String(password)) {
    const [row, col] = IX.get(c); // 非法口令字符在 IX.get 处抛 TypeError，先显式检查
    k = rotateDown(rotateRight(k, i, col), i, row);
    i = (i + 1) % N;
  }
  return k;
}

function deriveKeyChecked(password) {
  for (const c of String(password)) {
    if (!IX.has(c)) throw new Error(`口令字符「${c}」不在 LS47 字母表中`);
  }
  return deriveKey(password);
}

function process(key, input, isEncrypt) {
  checkKey(key);
  let mp = [0, 0];
  let out = "";
  for (const c of input) {
    if (!IX.has(c)) throw new Error(`字符「${c}」不在 LS47 字母表（49 字符）中，无法处理`);
    if (isEncrypt) {
      const pp = findPos(key, c);
      const mix = IX.get(findAt(key, mp[0], mp[1]));
      const cp = addPos(pp, mix);
      const co = findAt(key, cp[0], cp[1]);
      out += co;
      key = rotateRight(key, pp[0], 1);
      const cp2 = findPos(key, co);
      key = rotateDown(key, cp2[1], 1);
      mp = addPos(mp, IX.get(co));
    } else {
      const cp = findPos(key, c);
      const mix = IX.get(findAt(key, mp[0], mp[1]));
      const pp = subPos(cp, mix);
      const po = findAt(key, pp[0], pp[1]);
      out += po;
      key = rotateRight(key, pp[0], 1);
      const cp2 = findPos(key, c);
      key = rotateDown(key, cp2[1], 1);
      mp = addPos(mp, IX.get(c));
    }
  }
  return out;
}

register({
  id: "ls47",
  cat: "classic",
  name: "LS47 字母牌密码",
  desc: "ElsieFour/LC4 的 7×7 扩展（49 字符含小写字母/数字/常用符号）：牌面行列随每字符旋转 + marker 混合位，状态自同步。密钥支持 49 字符排列或口令派生。对照官方参考实现 ls47.py 逐字对拍",
  params: [
    { key: "mode", label: "密钥方式", type: "select", default: "password", options: [
      { value: "password", label: "口令派生（derive_key）" },
      { value: "raw", label: "49 字符原始牌面" },
    ] },
    { key: "key", label: "密钥 / 口令", type: "text", default: "s3cret_p4ssw0rd/31337", placeholder: "口令任意长；raw 模式须 49 字符排列" },
  ],
  encode: (text, p) => {
    const key = (p && p.mode) === "raw"
      ? checkKey(String((p && p.key) || "").trim())
      : deriveKeyChecked(String((p && p.key) || ""));
    // 空格透明转 _（字母表空格位约定，官方算法本体不动）
    return process(key, String(text).replace(/ /g, "_"), true);
  },
  decode: (text, p) => {
    const key = (p && p.mode) === "raw"
      ? checkKey(String((p && p.key) || "").trim())
      : deriveKeyChecked(String((p && p.key) || ""));
    return process(key, String(text), false).replace(/_/g, " ");
  },
});

export { LETTERS, deriveKey, deriveKeyChecked, checkKey, process };
