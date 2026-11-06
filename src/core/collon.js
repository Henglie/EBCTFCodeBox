/*
 * collon.js — Collon 密码（cat:'classic'）。
 *
 * 原理（照权威来源，未编造）：
 *  - 一字母 → 二字母组的「多元组代换」+ 组内换位（dCode 口径）：
 *    给定 5x5 网格与系列长 N。对每 N 个字母的系列：
 *    每个字母 x 在网格 (r,c) → 记「行首字母」= 网格[r][0]、「列末字母」= 网格[4][c]；
 *    该系列的密文 = 先连写 N 个行首，再连写 N 个列末（组内做了一次首/末换位）。
 *  - 解密：密文按 2N 切组、组内对半分为「行首串」与「列末串」；
 *    第 i 个明文 = 网格[行首_i 所在行][列末_i 所在列]。
 *
 * 权威来源：
 *  - dCode「Chiffre de Collon」(https://www.dcode.fr/chiffre-collon)，访问日期 2026-09-22：
 *    加密算例：网格 ABCDEFGHIKLMNOPQRSTUVWXY（A-Z 去 J）、N=2，
 *    DCODE → DC/OD/E，D→(A,Y)、C→(A,X)、O→(L,Y)、D→(A,Y)、E→(A,Z)
 *    → 密文 AAYXLAYYAZ；解密算例：网格 ABCDEFGHIJKLMNOPQRSTUVXYZ（A-Z 去 W）、N=3，
 *    AKKXZVKKKVZY → AKK|XZV → (A,X)(K,Z)(K,V)… → 明文 COLLON。
 *    本实现默认参数即加密算例。
 *
 * 约定：
 *  - 明文/密文只取 A-Z（其余字符丢弃），输出大写；末系列不足 N 按实际长度输出（密文长度恒为明文 2 倍）。
 *  - 网格参数给 25 字母串则直接用（须互异，行首互异、列末互异以保证可逆——互异字母方阵天然满足）；
 *    给短关键词则按约定生成：关键词去重字母 + 按序补全 A-Z 去 J 的 25 字母表（行优先 5x5）。
 *  - 解密要求：长度为偶数；每组的两半等长；行首/列末字母须能在网格中定位。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const AZ25 = "ABCDEFGHIKLMNOPQRSTUVWXYZ"; // A-Z 去 J（dCode 加密算例网格，亦为关键词生成基底）

/** 解析网格：25 字母串直用；短关键词按约定生成。返回 5x5 二维数组。 */
function parseGrid(spec) {
  const s = [...String(spec == null ? "" : spec).toUpperCase()].filter((c) => c >= "A" && c <= "Z").join("");
  if (!s) throw new Error("Collon：网格/关键词为空。");
  if (s.length > 25) throw new Error(`Collon：网格参数超过 25 个字母（${s.length}）。`);
  let square;
  if (s.length === 25) square = s;
  else {
    const seen = new Set();
    let out = "";
    for (const ch of s) if (!seen.has(ch)) { seen.add(ch); out += ch; }
    for (const ch of AZ25) if (!seen.has(ch)) out += ch;
    square = out;
  }
  if (new Set(square).size !== 25) throw new Error("Collon：网格有重复字母，须为 25 个互异字母。");
  const grid = [];
  for (let r = 0; r < 5; r++) grid.push([...square.slice(r * 5, r * 5 + 5)]);
  return grid;
}

function collonEncode(text, gridSpec, nSer) {
  const grid = parseGrid(gridSpec);
  const N = Number(nSer);
  if (!Number.isInteger(N) || N < 1) throw new Error(`Collon：系列长 N 须为正整数（拿到 ${nSer}）。`);
  const letters = [...String(text == null ? "" : text).toUpperCase()].filter((c) => c >= "A" && c <= "Z");
  if (!letters.length) throw new Error("Collon：明文不含任何 A-Z 字母。");
  const pos = new Map();
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) pos.set(grid[r][c], [r, c]);
  let out = "";
  for (let i = 0; i < letters.length; i += N) {
    const series = letters.slice(i, i + N);
    let heads = "", tails = "";
    for (const ch of series) {
      const p = pos.get(ch);
      if (!p) throw new Error(`Collon：字母 "${ch}" 不在网格中。`);
      heads += grid[p[0]][0];
      tails += grid[4][p[1]];
    }
    out += heads + tails;
  }
  return out;
}

function collonDecode(text, gridSpec, nSer) {
  const grid = parseGrid(gridSpec);
  const N = Number(nSer);
  if (!Number.isInteger(N) || N < 1) throw new Error(`Collon：系列长 N 须为正整数（拿到 ${nSer}）。`);
  const letters = [...String(text == null ? "" : text).toUpperCase()].filter((c) => c >= "A" && c <= "Z");
  if (!letters.length) throw new Error("Collon：密文不含任何 A-Z 字母。");
  if (letters.length % 2 !== 0)
    throw new Error(`Collon：密文长度 ${letters.length} 为奇数（Collon 密文恒为明文两倍长，必为偶数）。`);
  const rowOf = new Map(), colOf = new Map();
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) { rowOf.set(grid[r][c], r); colOf.set(grid[r][c], c); }
  let out = "";
  for (let i = 0; i < letters.length; i += 2 * N) {
    const group = letters.slice(i, i + 2 * N);
    if (group.length % 2 !== 0)
      throw new Error(`Collon：第 ${i / (2 * N) + 1} 组长度 ${group.length} 为奇数，无法对半分。`);
    const k = group.length / 2;
    const heads = group.slice(0, k);
    const tails = group.slice(k);
    for (let j = 0; j < k; j++) {
      const r = rowOf.get(heads[j]);
      const c = colOf.get(tails[j]);
      if (r == null || c == null)
        throw new Error(`Collon：字母对 (${heads[j]},${tails[j]}) 无法在网格中定位行/列。`);
      out += grid[r][c];
    }
  }
  return out;
}

register({
  id: "collon", cat: "classic", name: "Collon 密码",
  desc: "一字母→双字母组（行首+列末）再按 N 字母系列首末换位（dCode 口径）；默认网格去 J、N=2，即 dCode 例 DCODE→AAYXLAYYAZ",
  params: [
    { key: "grid", label: "网格（25 字母串；短于 25 视为关键词，按去 J 字母表生成）", type: "text", default: AZ25 },
    { key: "series", label: "系列长 N（每 N 个字母一组换位）", type: "number", default: 2 },
  ],
  encode: (t, p) => collonEncode(t, (p && p.grid) != null ? p.grid : AZ25, (p && p.series) != null ? p.series : 2),
  decode: (t, p) => collonDecode(t, (p && p.grid) != null ? p.grid : AZ25, (p && p.series) != null ? p.series : 2),
});

export { collonEncode, collonDecode, parseGrid, AZ25 };
