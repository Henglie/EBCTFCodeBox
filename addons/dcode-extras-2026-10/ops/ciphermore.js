/*
 * dcode-extras · 古典密码补遗批（2026-10 · Agent A）
 * Myszkowski 换位、Quagmire I/II/III 多表代换。
 */

import { A26 } from "../lib/util.js";

const CAT = "dcode-extras-2026-10/cat-cipher";
const P = (key, label, ph) => ({ key, label, type: "text", default: "", placeholder: ph || "" });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });

function normalizeKey(src, name) {
  const key = String(src || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (key.length < 2 || key.length > 24) throw new Error(`${name}需 2..24 个字母`);
  return key;
}

function myszkowskiRanks(key) {
  const uniq = [...new Set(key)].sort();
  const rank = new Map(uniq.map((c, i) => [c, i + 1]));
  return key.split("").map((c) => rank.get(c));
}

function myszkowskiEncode(text, key) {
  const s = String(text);
  const k = key.length, rows = Math.ceil(s.length / k);
  const grid = Array.from({ length: rows }, () => new Array(k).fill(null));
  for (let i = 0; i < s.length; i++) grid[Math.floor(i / k)][i % k] = s[i];
  const ranks = myszkowskiRanks(key);
  const maxRank = Math.max(...ranks);
  let out = "";
  for (let r = 1; r <= maxRank; r++) {
    const cols = ranks.map((x, i) => (x === r ? i : -1)).filter((i) => i >= 0);
    if (cols.length === 1) {
      for (let row = 0; row < rows; row++) if (grid[row][cols[0]] !== null) out += grid[row][cols[0]];
    } else {
      for (let row = 0; row < rows; row++) for (const c of cols) if (grid[row][c] !== null) out += grid[row][c];
    }
  }
  return out;
}

function myszkowskiDecode(text, key) {
  const s = String(text);
  const k = key.length, rows = Math.ceil(s.length / k);
  const grid = Array.from({ length: rows }, () => new Array(k).fill(null));
  const ranks = myszkowskiRanks(key);
  const maxRank = Math.max(...ranks);
  let idx = 0;
  for (let r = 1; r <= maxRank; r++) {
    const cols = ranks.map((x, i) => (x === r ? i : -1)).filter((i) => i >= 0);
    if (cols.length === 1) {
      for (let row = 0; row < rows; row++) {
        const c = cols[0];
        if (row * k + c < s.length && grid[row][c] === null && idx < s.length) grid[row][c] = s[idx++];
      }
    } else {
      for (let row = 0; row < rows; row++) {
        for (const c of cols) {
          if (row * k + c < s.length && grid[row][c] === null && idx < s.length) grid[row][c] = s[idx++];
        }
      }
    }
  }
  let out = "";
  for (let row = 0; row < rows; row++) for (let c = 0; c < k; c++) if (grid[row][c] !== null) out += grid[row][c];
  return out;
}

function keyedAlphabet(src, name) {
  const key = String(src || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!key) throw new Error(`${name}不能为空`);
  const seen = new Set();
  let out = "";
  for (const ch of key) if (!seen.has(ch)) { seen.add(ch); out += ch; }
  for (const ch of A26) if (!seen.has(ch)) out += ch;
  return out;
}

function quagmireTables(mode, key1, key2) {
  if (mode === "I") return { plain: keyedAlphabet(key1, "明文密钥"), cipher: A26 };
  if (mode === "II") return { plain: A26, cipher: keyedAlphabet(key2, "密文密钥") };
  if (mode === "III") return { plain: keyedAlphabet(key1, "明文密钥"), cipher: keyedAlphabet(key2, "密文密钥") };
  throw new Error("mode 需为 I/II/III");
}

function quagmire(text, mode, key1, key2, indicator, dir) {
  const { plain, cipher } = quagmireTables(mode, key1, key2);
  const ind = String(indicator || "").toUpperCase().replace(/[^A-Z]/g, "");
  if (!ind) throw new Error("指示密钥需至少 1 个字母");
  let out = "", ki = 0;
  for (const ch of String(text)) {
    const up = ch.toUpperCase();
    if (!/[A-Z]/.test(up)) { out += ch; continue; }
    const shift = ind.charCodeAt(ki % ind.length) - 65;
    if (dir === "enc") {
      const pi = plain.indexOf(up);
      if (pi < 0) throw new Error(`字符 ${ch} 不在明文字母表`);
      out += cipher[(pi + shift) % 26];
    } else {
      const ci = cipher.indexOf(up);
      if (ci < 0) throw new Error(`字符 ${ch} 不在密文字母表`);
      out += plain[(ci - shift + 26 * 26) % 26];
    }
    ki++;
  }
  return out;
}

export const OPS = [
  {
    id: "dcode-extras-2026-10/cipher-myszkowski", cat: CAT,
    name: "Myszkowski 换位密码",
    desc: "带重复字母关键字的列换位：同秩列按行读取（TOMATO 关键字，ATTACKATDAWN → AATDTKTNACAW）；encode/decode 双向，按字符转置（含空格）",
    params: [P("key", "关键字", "TOMATO")],
    encode(text, p) { return myszkowskiEncode(text, normalizeKey((p && p.key) || "", "关键字")); },
    decode(text, p) { return myszkowskiDecode(text, normalizeKey((p && p.key) || "", "关键字")); },
  },

  {
    id: "dcode-extras-2026-10/cipher-quagmire", cat: CAT,
    name: "Quagmire 密码（I/II/III）",
    desc: "Vigenère 变体：I=明文字母表加关键字；II=密文字母表加关键字；III=两者都加；指示密钥决定每字母位移（标准字母表），非字母透传",
    params: [
      SEL("mode", "变体", "III", [{ value: "I", label: "Quagmire I（明文 keyed）" }, { value: "II", label: "Quagmire II（密文 keyed）" }, { value: "III", label: "Quagmire III（双方 keyed）" }]),
      P("key1", "明文关键字（I/III）", "CIPHER"),
      P("key2", "密文关键字（II/III）", "SECRET"),
      P("ind", "指示密钥", "KEY"),
    ],
    encode(text, p) { return quagmire(text, String((p && p.mode) || "III"), (p && p.key1) || "", (p && p.key2) || "", (p && p.ind) || "", "enc"); },
    decode(text, p) { return quagmire(text, String((p && p.mode) || "III"), (p && p.key1) || "", (p && p.key2) || "", (p && p.ind) || "", "dec"); },
  },
];
