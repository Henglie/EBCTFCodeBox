/*
 * monomeBinome.js — Monome-Binome（单子-双子密码，cat:'classic'）。
 *
 * 原理（照 dCode「Chiffre Monome-Binome」，访问日期 2026-09-22，未编造）：
 *  - Polybius 家族的坐标替换：刻意不完整的 3 行网格，两个特殊数字作「行键」。
 *    第一行没有行名，其字母只输出列号（1 位，monome）；第二、三行以行键数字命名，
 *    其字母输出 行键数字+列号（2 位，binome）——名字即「有的一字母 1 位、有的 2 位」。
 *  - 3×10 档（dCode 官方例）：行键默认 3 和 7；表头 0-9，第一行占非行键的 8 列，
 *    后两行各 10 格；28 个码位 = A-Z + 空格 + *。
 *      例（标准序，键 3/7）：
 *        列:  0 1 2 3 4 5 6 7 8 9
 *        行1: A B C   D E F   G H        （3、7 列空缺，作行键）
 *        行3: I J K L M N O P Q R
 *        行7: S T U V W X Y Z ␣ *
 *    dCode 官方向量：MONOME → 34,36,35,36,34,5；4303536345 → DINOME。
 *  - 3×8 档：24 字母（J→I、U→V 合并——dCode 官方网格第二三行为 I K L M N O P Q 与
 *    R S T V W X Y Z，无 J 无 U，故 U 并入 V 格），三行各 8 格，列 = 非行键的 8 个数字。
 *  - 关键词变体：字母表可用关键词扰动（keyword + 余下码位原序）；dCode 另提列序置换，
 *    本实现不收列置换（额外密钥维度，官方例不涉及，不编造向量）。
 *
 * 约定（头注释与 desc 声明）：
 *  - 密文 = 连续数字串（无分隔符；decode 容忍逗号/空格，剥掉再解析）。
 *  - 解析无歧义：行键数字不可能出现在第一行（第一行只占非行键列），故读到行键数字
 *    必为 binome 首位；其余数字必为 monome。
 *  - encode：大写化；3x8 档 J→I、U→V；3x10 档保留空格与 *（网格有此两码位），其余
 *    非 A-Z 字符丢弃。3x8 档 binome 的列号不可能是行键数字（列集 = 非行键数字），非法
 *    坐标显式报错。
 *
 * 权威来源（访问日期 2026-09-22）：
 *  - dCode「Chiffre Monome-Binome」(https://www.dcode.fr/monome-binome)：
 *    两种网格、坐标读写规则、MONOME→34,36,35,36,34,5 与 4303536345→DINOME 官方向量、
 *    西班牙内战（1936）使用痕迹、关键词扰动变体。本实现默认参数即复现两向量。
 *
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 解析行键：两个互异的 0-9 数字（默认 3,7）。 */
function parseRowKeys(spec) {
  const parts = String(spec == null ? "" : spec).split(/[^\d]+/).filter(Boolean);
  if (parts.length !== 2)
    throw new Error(`Monome-Binome：行键须为两个互异数字（如 3,7；当前 ${parts.length} 个）。`);
  const ks = parts.map((s) => {
    const n = Number(s);
    if (n < 0 || n > 9) throw new Error(`Monome-Binome：行键 ${s} 越界（0-9）。`);
    return n;
  });
  if (ks[0] === ks[1])
    throw new Error(`Monome-Binome：两个行键相同（${ks[0]}），须互异。`);
  return ks;
}

/**
 * 建网格。返回 { colDigits, rows: [{ keyDigit|null, cells }...] }，
 * cells[j] 为该行第 j 格的字符，colDigits[j] 为其列号。
 */
function buildGrid(keyword, rowKeys, gridMode) {
  const isBig = gridMode !== "3x8";
  const pool = isBig ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ *" : "ABCDEFGHIKLMNOPQRSTVWXYZ";
  const merge = isBig ? {} : { J: "I", U: "V" };
  // keyword 归一进池首
  let alpha = "";
  const seen = new Set();
  const kw = String(keyword == null ? "" : keyword).toUpperCase();
  for (const ch of kw) {
    const c = merge[ch] || ch;
    if (pool.includes(c) && !seen.has(c)) { seen.add(c); alpha += c; }
  }
  for (const ch of pool) if (!seen.has(ch)) alpha += ch;
  const nonKey = [..."0123456789"].map(Number).filter((d) => !rowKeys.includes(d));
  if (isBig) {
    // 3x10：行1 占非行键 8 列；行键两行各 10 格（列 0-9）。
    const rows = [
      { keyDigit: null, cells: [...alpha.slice(0, 8)], cols: nonKey },
      { keyDigit: rowKeys[0], cells: [...alpha.slice(8, 18)], cols: [...Array(10).keys()] },
      { keyDigit: rowKeys[1], cells: [...alpha.slice(18, 28)], cols: [...Array(10).keys()] },
    ];
    return { rows };
  }
  // 3x8：三行各 8 格，列 = 非行键数字。
  const rows = [
    { keyDigit: null, cells: [...alpha.slice(0, 8)], cols: nonKey },
    { keyDigit: rowKeys[0], cells: [...alpha.slice(8, 16)], cols: nonKey },
    { keyDigit: rowKeys[1], cells: [...alpha.slice(16, 24)], cols: nonKey },
  ];
  return { rows };
}

function monomeBinomeEncode(text, keyword, rowKeysSpec, gridMode) {
  const rowKeys = parseRowKeys(rowKeysSpec);
  const grid = buildGrid(keyword, rowKeys, gridMode);
  const isBig = gridMode !== "3x8";
  const merge = isBig ? {} : { J: "I", U: "V" };
  const keep = (c) => (isBig ? (AZ.includes(c) || c === " " || c === "*") : AZ.includes(c));
  const src = [...String(text == null ? "" : text).toUpperCase()].map((c) => merge[c] || c).filter(keep);
  if (!src.length) throw new Error(`Monome-Binome：输入不含任何可编码字符（3x10 档收 A-Z/空格/*，3x8 档收 A-Z）。`);
  let out = "";
  for (const ch of src) {
    let done = false;
    for (const row of grid.rows) {
      const j = row.cells.indexOf(ch);
      if (j >= 0) {
        out += row.keyDigit === null ? String(row.cols[j]) : String(row.keyDigit) + String(row.cols[j]);
        done = true;
        break;
      }
    }
    if (!done) throw new Error(`Monome-Binome：字符 "${ch}" 不在网格内。`);
  }
  return out;
}

function monomeBinomeDecode(text, keyword, rowKeysSpec, gridMode) {
  const rowKeys = parseRowKeys(rowKeysSpec);
  const grid = buildGrid(keyword, rowKeys, gridMode);
  const digits = [...String(text == null ? "" : text)].filter((c) => c >= "0" && c <= "9").map(Number);
  if (!digits.length) throw new Error("Monome-Binome：密文不含任何数字。");
  const row1 = grid.rows[0];
  let out = "";
  for (let i = 0; i < digits.length; i++) {
    const d = digits[i];
    if (rowKeys.includes(d)) {
      if (i + 1 >= digits.length)
        throw new Error(`Monome-Binome：数字流以行键 ${d} 结尾，binome 缺列号。`);
      const col = digits[++i];
      const row = d === rowKeys[0] ? grid.rows[1] : grid.rows[2];
      const j = row.cols.indexOf(col);
      if (j < 0 || j >= row.cells.length)
        throw new Error(`Monome-Binome：坐标 (${d},${col}) 不在${gridMode === "3x8" ? " 3x8" : " 3x10"}网格内。`);
      out += row.cells[j];
    } else {
      const j = row1.cols.indexOf(d);
      if (j < 0 || j >= row1.cells.length)
        throw new Error(`Monome-Binome：列号 ${d} 不在第一行网格内。`);
      out += row1.cells[j];
    }
  }
  return out;
}

register({
  id: "monomeBinome", cat: "classic", name: "Monome-Binome 单子双子",
  desc: "Polybius 族坐标替换：3 行不完整网格 + 两个行键数字，首行字母出 1 位数（monome）、后两行出 2 位数（binome）；3x10 档 28 码位（A-Z+空格+*），3x8 档 24 字母（J→I、U→V）；默认复现 dCode 例 MONOME→34363536345 / 4303536345→DINOME",
  params: [
    { key: "keyword", label: "关键词（扰动字母表，可空）", type: "text", default: "", placeholder: "留空 = 标准序 A-Z…" },
    { key: "rowkeys", label: "行键数字（两个互异 0-9）", type: "text", default: "3,7" },
    { key: "grid", label: "网格档", type: "select", default: "3x10",
      options: [
        { value: "3x10", label: "3x10（28 码位：A-Z+空格+*，dCode 官方例）" },
        { value: "3x8", label: "3x8（24 字母，J→I、U→V）" },
      ] },
  ],
  encode: (t, p) => monomeBinomeEncode(t, (p && p.keyword) || "", (p && p.rowkeys) || "3,7", (p && p.grid) || "3x10"),
  decode: (t, p) => monomeBinomeDecode(t, (p && p.keyword) || "", (p && p.rowkeys) || "3,7", (p && p.grid) || "3x10"),
});

export { monomeBinomeEncode, monomeBinomeDecode, buildGrid, parseRowKeys };
