/*
 * phillips.js — Phillips 密码（cat:'classic'）。
 *
 * 原理（照权威来源，未编造）：
 *  - 多表代换：把一个 25 字母的 5x5 方阵按规则生成 8 个方阵。
 *    方阵 1 为基础；把第 1 行逐次下移一位得到方阵 2、3、4、5；
 *    再在方阵 5 上把（原）第 2 行逐次下移一位得到方阵 6、7、8。
 *  - 明文按每块 T 个字母（经典 T=5）分块，第 n 块用方阵 ((n-1) mod 8)+1。
 *  - 代换：在当前方阵中找到明文字母 (r,c)，密文 = 同一方阵 ((r+dr) mod 5, (c+dc) mod 5)
 *    处的字母（经典 dr=1、dc=1，即「往右下方一格」，第 5 列绕回第 1 列、第 5 行绕回第 1 行）。
 *  - 解密 = 反向移格，块与方阵的对应关系相同。
 *
 * 权威来源：
 *  - ACA（American Cryptogram Association）「PHILLIPS」说明页 PDF
 *    (https://www.cryptogram.org/downloads/aca.info/ciphers/Phillips.pdf)，访问日期 2026-09-22：
 *    给出方阵生成规则（第 1 行逐次下移成 #2-#5、第 2 行逐次下移成 #6-#8）、
 *    「右下方一格」代换规则及 64 字母完整算例：Key 方阵
 *    DIAGOCBSLNEFHKMUTRQPVWXYZ，明文 "Squares one and five are actually the same as
 *    are squares two and eight. The overall period is forty."
 *    → 密文 KZWLYTGEDTQETARBTYGTLFXWLPPOXLTYKUTKGKYTKZWLYTGXSEQETIRZQAAQTCITYKPPVBLHEFHGREYXO。
 *    本实现默认参数即该例。
 *  - dCode「Phillips Cipher」(https://www.dcode.fr/phillips-cipher)，访问日期 2026-09-22：
 *    确认 (1,1) 位移与块参数化（Number of characters per block / Horizontal shift /
 *    Vertical shift）。注意：dCode 页面文字算例 DCODEPHILLIPS→JIPJFVDERROVY 与其自身
 *    「第 3 块用方阵 3」的规则矛盾（其 IPS→OVY 只与方阵 1 相符），故不作为向量采用；
 *    本实现以自洽的 ACA 算例为准。
 *
 * 约定：
 *  - 明文/密文只取 A-Z（其余字符丢弃），输出大写；输入字母必须能在 25 字母方阵中找到，
 *    否则显式报错。
 *  - 网格参数给 25 字母串则直接用；给短关键词则按约定生成：关键词去重字母 + 按序补全
 *    A-Z 去掉 J 的 25 字母表，行优先填入 5x5（此为工具约定，ACA 例方阵非该法生成，
 *    故默认值为 ACA 原方阵字面）。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const AZ25 = "ABCDEFGHIKLMNOPQRSTUVWXYZ"; // A-Z 去 J（关键词生成模式的基底）
const ACA_SQUARE = "DIAGOCBSLNEFHKMUTRQPVWXYZ"; // ACA 算例方阵（原样照抄）

/** 解析网格：25 字母串直用；短关键词按约定生成。 */
function parseGrid(spec) {
  const s = [...String(spec == null ? "" : spec).toUpperCase()].filter((c) => c >= "A" && c <= "Z").join("");
  if (!s) throw new Error("Phillips：网格/关键词为空。");
  if (s.length > 25) throw new Error(`Phillips：网格参数超过 25 个字母（${s.length}）。`);
  let square;
  if (s.length === 25) {
    square = s;
  } else {
    const seen = new Set();
    let out = "";
    for (const ch of s) if (!seen.has(ch)) { seen.add(ch); out += ch; }
    for (const ch of AZ25) if (!seen.has(ch)) out += ch;
    square = out;
  }
  if (new Set(square).size !== 25)
    throw new Error("Phillips：网格有重复字母，须为 25 个互异字母。");
  return square;
}

/** 8 个方阵的行置换表：#1 基础；#2-#5 第 1 行逐次下移；#6-#8 再把原第 2 行逐次下移。 */
function rowOrders() {
  const orders = [];
  let cur = [0, 1, 2, 3, 4];
  orders.push(cur.slice());
  const moveDown = (order, rowVal) => {
    const pos = order.indexOf(rowVal);
    const next = order.slice();
    next.splice(pos, 1);
    next.splice(pos + 1, 0, rowVal);
    return next;
  };
  for (let k = 0; k < 4; k++) { cur = moveDown(cur, 0); orders.push(cur.slice()); } // #2-#5：第 1 行(值0)下移
  for (let k = 0; k < 3; k++) { cur = moveDown(cur, 1); orders.push(cur.slice()); } // #6-#8：第 2 行(值1)下移
  return orders; // 长度 8
}

function phillipsRun(text, gridSpec, period, dr, dc, decode) {
  const square = parseGrid(gridSpec);
  const T = Number(period);
  if (!Number.isInteger(T) || T < 1) throw new Error(`Phillips：块长须为正整数（拿到 ${period}）。`);
  const vr = Number(dr), vc = Number(dc);
  if (!Number.isInteger(vr) || !Number.isInteger(vc)) throw new Error("Phillips：行/列位移须为整数。");
  const orders = rowOrders();
  const grids = orders.map((ord) => ord.map((r) => square.slice(r * 5, r * 5 + 5)));
  const letters = [...String(text == null ? "" : text).toUpperCase()].filter((c) => c >= "A" && c <= "Z");
  if (!letters.length) throw new Error("Phillips：输入不含任何 A-Z 字母。");
  // 每个方阵单独建位置表：同一字母在不同方阵中的行列不同
  const posMaps = grids.map((g) => {
    const m = new Map();
    for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) m.set(g[r][c], [r, c]);
    return m;
  });
  let out = "";
  letters.forEach((ch, i) => {
    const grid = grids[Math.floor(i / T) % 8];
    const p = posMaps[Math.floor(i / T) % 8].get(ch);
    if (!p)
      throw new Error(`Phillips：字母 "${ch}" 不在 25 字母网格中（网格缺该字母）。`);
    const r = p[0], c = p[1];
    const nr = (r + (decode ? -vr : vr) + 50) % 5;
    const nc = (c + (decode ? -vc : vc) + 50) % 5;
    out += grid[nr][nc];
  });
  return out;
}

register({
  id: "phillips", cat: "classic", name: "Phillips 密码",
  desc: "5x5 方阵周期代换：第 1 行逐次下移生成 8 阵、每块 5 字母换一阵，明文取「右下方一格」（ACA 口径）；默认即 ACA 64 字母算例方阵",
  params: [
    { key: "grid", label: "网格（25 字母串；短于 25 视为关键词，按去 J 字母表生成）", type: "text", default: ACA_SQUARE },
    { key: "period", label: "块长（每块换一个方阵）", type: "number", default: 5 },
    { key: "rowShift", label: "行位移（向下）", type: "number", default: 1 },
    { key: "colShift", label: "列位移（向右）", type: "number", default: 1 },
  ],
  encode: (t, p) => phillipsRun(t, (p && p.grid) != null ? p.grid : ACA_SQUARE, (p && p.period) != null ? p.period : 5, (p && p.rowShift) != null ? p.rowShift : 1, (p && p.colShift) != null ? p.colShift : 1, false),
  decode: (t, p) => phillipsRun(t, (p && p.grid) != null ? p.grid : ACA_SQUARE, (p && p.period) != null ? p.period : 5, (p && p.rowShift) != null ? p.rowShift : 1, (p && p.colShift) != null ? p.colShift : 1, true),
});

export { phillipsRun, parseGrid, rowOrders, ACA_SQUARE, AZ25 };
