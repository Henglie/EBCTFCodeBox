/*
 * threeSquare.js — 三方密码 Three-square（cat:'classic'）。
 *
 * 原理（照 dCode「Three Squares Cipher」，访问日期 2026-09-22，未编造）：
 *  - 三个 5×5 方阵（可由关键词生成）。明文按双字母组（L1,L2）处理：
 *    L1 在方阵 1 定位 (r1,c1)，L2 在方阵 2 定位 (r2,c2)。
 *  - 中间公共方阵（方阵 3）取交点：mid = 方阵3[r1][c2]（行取 L1 的行，列取 L2 的列）。
 *  - 每个双字母组 → 三字母组（trigram，默认 1-3-2 次序）：
 *      第一字母 = 方阵 1 中与 L1 同列的某字母（原算法随机取；本实现参数化，见下）；
 *      第二字母 = mid（方阵 3 交点，确定性）；
 *      第三字母 = 方阵 2 中与 L2 同行的某字母（原算法随机取）。
 *  - 解密（三字母组 A,B,C）：A 在方阵 1 → 只需其列 cA；B 在方阵 3 → (rB,cB)；
 *    C 在方阵 2 → 只需其行 rC。明文1 = 方阵1[rB][cA]，明文2 = 方阵2[rC][cB]。
 *    dCode 官方例：UDBJDC → CODE；TKDGNVSAFRAV → MESSAGEY（后者由其编码例反向导出）。
 *
 * 随机字母的确定性化（本实现约定，头注释与 desc 声明）：
 *  - 原算法第一/第三字母「随机取」，解密只依赖列号/行号，故任取皆可逆。本实现两档：
 *      rotate（默认）——按双字母组序号 i 取 方阵1[i mod 5][c1] 与 方阵2[r2][i mod 5]，
 *      模拟杀手的轮换口味且完全确定；top——恒取列首/行首（方阵1[0][c1]、方阵2[r2][0]）。
 *
 * 字母表约定（与本项目 twoSquare/fourSquare 惯例对齐）：
 *  - "ij"：I/J 合并（J→I，去 J），教材常见默认；
 *  - "noq"：省略 Q；
 *  - "noz"：省略 Z——dCode 官方例三张方阵均无 Z（ONE/TWO/THREE 键），复现向量须用此档，
 *    故本 op 默认 noz + 键 ONE/TWO/THREE（默认即权威例，jefferson 先例）。
 *  - 明文大写化、归一（合并/丢弃）、奇数长度补 X（twoSquare/fourSquare 同款 house 规则）；
 *    密文长度必须是 3 的倍数，三字母组的 A/B/C 必须分别落在方阵 1/3/2 内，否则显式报错。
 *
 * 权威来源（访问日期 2026-09-22）：
 *  - dCode「Three Squares Cipher」(https://www.dcode.fr/three-square-cipher)：
 *    完整加解密算法 + 官方例（键 ONE/TWO/THREE；ME→T?K?D?（随机位以 ? 示）；
 *    MESSAGE→TKDGNVSAFRAV；UDBJDC→CODE）。本实现默认参数复现 UDBJDC→CODE（见
 *    verify_classic2_b.mjs）。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 */
import { register } from "./registry.js";

const ALPHA_IJ = "ABCDEFGHIKLMNOPQRSTUVWXYZ";  // 去 J（I/J 合并）
const ALPHA_NOQ = "ABCDEFGHIJKLMNOPRSTUVWXYZ"; // 去 Q
const ALPHA_NOZ = "ABCDEFGHIJKLMNOPQRSTUVWXY"; // 去 Z（dCode 官方例）

function baseAlpha(mode) {
  return mode === "noq" ? ALPHA_NOQ : mode === "noz" ? ALPHA_NOZ : ALPHA_IJ;
}

/** 归一为表内大写字母串（ij: J→I；noq: 去 Q；noz: 去 Z；其余字符丢弃）。 */
function normalizeLetters(str, mode) {
  let s = String(str == null ? "" : str).toUpperCase();
  if (mode === "noq") s = s.replace(/Q/g, "");
  else if (mode === "noz") s = s.replace(/Z/g, "");
  else s = s.replace(/J/g, "I");
  const alpha = baseAlpha(mode);
  let out = "";
  for (const ch of s) if (alpha.indexOf(ch) !== -1) out += ch;
  return out;
}

/** keyword → 25 字母方阵串（归一、去重、余字母补齐），与 twoSquare/fourSquare 同款。 */
function buildSquare(keyword, mode) {
  const kw = normalizeLetters(keyword, mode);
  if (!kw) throw new Error("三方密码：关键词须含表内字母（不能为空或全为非字母字符）。");
  const alpha = baseAlpha(mode);
  let sq = "";
  const seen = new Set();
  for (const ch of kw + alpha) {
    if (!seen.has(ch)) { seen.add(ch); sq += ch; }
  }
  return sq;
}

function threeSquareEncode(text, kw1, kw2, kw3, alphaMode, pick) {
  const sq1 = buildSquare(kw1, alphaMode);
  const sq2 = buildSquare(kw2, alphaMode);
  const sq3 = buildSquare(kw3, alphaMode);
  let s = normalizeLetters(text, alphaMode);
  if (!s.length) throw new Error("三方密码：输入不含任何表内字母。");
  if (s.length % 2 !== 0) s += "X"; // 奇数补 X（house 规则）
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    const ia = sq1.indexOf(s[i]);
    const ib = sq2.indexOf(s[i + 1]);
    const r1 = Math.floor(ia / 5), c1 = ia % 5;
    const r2 = Math.floor(ib / 5), c2 = ib % 5;
    const mid = sq3[r1 * 5 + c2]; // 方阵3 交点：行取 L1，列取 L2
    const k = pick === "top" ? 0 : (i / 2) % 5; // rotate 按组序轮转 / top 固定首行首列
    out += sq1[k * 5 + c1] + mid + sq2[r2 * 5 + k];
  }
  return out;
}

function threeSquareDecode(text, kw1, kw2, kw3, alphaMode) {
  const sq1 = buildSquare(kw1, alphaMode);
  const sq2 = buildSquare(kw2, alphaMode);
  const sq3 = buildSquare(kw3, alphaMode);
  const s = normalizeLetters(text, alphaMode);
  if (!s.length) throw new Error("三方密码：密文不含任何表内字母。");
  if (s.length % 3 !== 0)
    throw new Error(`三方密码：密文长度 ${s.length} 不是 3 的倍数（三字母组不完整）。`);
  let out = "";
  for (let i = 0; i < s.length; i += 3) {
    const A = s[i], B = s[i + 1], C = s[i + 2];
    const ia = sq1.indexOf(A);
    if (ia < 0) throw new Error(`三方密码：三字母组第 1 位 "${A}" 不在方阵 1 内（token 位置 ${i}）。`);
    const ib = sq3.indexOf(B);
    if (ib < 0) throw new Error(`三方密码：三字母组第 2 位 "${B}" 不在方阵 3（公共方阵）内（token 位置 ${i + 1}）。`);
    const ic = sq2.indexOf(C);
    if (ic < 0) throw new Error(`三方密码：三字母组第 3 位 "${C}" 不在方阵 2 内（token 位置 ${i + 2}）。`);
    const cA = ia % 5;          // A 在方阵 1 的列
    const rB = Math.floor(ib / 5), cB = ib % 5; // B 在方阵 3 的行列
    const rC = Math.floor(ic / 5); // C 在方阵 2 的行
    out += sq1[rB * 5 + cA] + sq2[rC * 5 + cB];
  }
  return out;
}

register({
  id: "threeSquare", cat: "classic", name: "三方密码 Three-square",
  desc: "三方密码：双字母组→三字母组（方阵1同列字母+方阵3交点+方阵2同行字母）；随机位参数化为轮转/取首，解密只看列号行号故严格可逆；默认即 dCode 官方例（ONE/TWO/THREE，去 Z），UDBJDC→CODE",
  params: [
    { key: "key1", label: "关键词1（方阵1，双字母组首字母）", type: "text", default: "ONE", placeholder: "任意英文单词" },
    { key: "key2", label: "关键词2（方阵2，双字母组次字母）", type: "text", default: "TWO", placeholder: "任意英文单词" },
    { key: "key3", label: "关键词3（方阵3，中间公共方阵）", type: "text", default: "THREE", placeholder: "任意英文单词" },
    { key: "alphabet", label: "字母表约定", type: "select", default: "noz",
      options: [
        { value: "noz", label: "省略 Z（dCode 官方例默认）" },
        { value: "ij", label: "I/J 合并（去 J）" },
        { value: "noq", label: "省略 Q" },
      ] },
    { key: "pick", label: "随机位取法（第1/3字母）", type: "select", default: "rotate",
      options: [
        { value: "rotate", label: "按组序轮转（i mod 5，默认）" },
        { value: "top", label: "固定取列首/行首" },
      ] },
  ],
  encode: (t, p) => threeSquareEncode(t, (p && p.key1 != null) ? p.key1 : "ONE", (p && p.key2 != null) ? p.key2 : "TWO", (p && p.key3 != null) ? p.key3 : "THREE", (p && p.alphabet) || "noz", (p && p.pick) || "rotate"),
  decode: (t, p) => threeSquareDecode(t, (p && p.key1 != null) ? p.key1 : "ONE", (p && p.key2 != null) ? p.key2 : "TWO", (p && p.key3 != null) ? p.key3 : "THREE", (p && p.alphabet) || "noz"),
});

export { threeSquareEncode, threeSquareDecode, buildSquare, normalizeLetters, ALPHA_NOZ };
