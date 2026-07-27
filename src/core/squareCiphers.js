/*
 * squareCiphers.js — Four-square（四方）/ Two-square（双方）双字母替换古典密码。
 *
 * cat:'classic'，均双向（encode + decode）。方阵均 5×5（25 字母）。
 * 两条 op：
 * - foursquarekw Four-square 四方（keyword 版）
 * - twosquare Two-square 双方（含横/纵排列切换）
 *
 * 字母表约定（alphabet 参数）：5×5 只能放 25 个字母，须去掉 1 个：
 * - "ij" I/J 合并（J→I）。教材/多数 CTF 常见默认，字母表 = A-Z 去 J。
 * - "noq" 省略 Q。Wikipedia《Four-square cipher》官方例采用此约定。
 * 两者算法完全一致，仅“把哪个字母塞进 25 格”不同，故做成可切换参数。
 * Wikipedia 官方四方向量（key1=EXAMPLE key2=KEYWORD
 * "helpmeobiwankenobi" → "FYGMKYHOBXMFKKKIMD"）须用 "noq" 才能复现。
 *
 * 注意：本库 classic.js 已有 id "foursquare"（直接吃 25 字母原始方阵字符串）。
 * 本文件 "foursquarekw" 是 keyword 驱动版（用关键词生成方阵，更贴近教材与 CTF
 * 常见形态），算法一致、入口不同，故用不同 id 并存，绝不覆盖既有 op。
 *
 * ── Four-square（照 Wikipedia《Four-square cipher》）──
 * 四个方阵按 2×2 摆放：
 * [明文方阵(标准)] [密文方阵1(keyword1)]
 * [密文方阵2(keyword2)] [明文方阵(标准)]
 * 加密双字母 (a,b)：
 * a 定位于左上明文方阵 → (r1,c1)；b 定位于右下明文方阵 → (r2,c2)。
 * 密文1 = 右上(keyword1)方阵[r1][c2]；密文2 = 左下(keyword2)方阵[r2][c1]。
 * 解密反向：密文1 定位于右上方阵 (r1,cc1)、密文2 定位于左下方阵 (r2,cc2)
 * 明文1 = 标准方阵[r1][cc2]，明文2 = 标准方阵[r2][cc1]。
 *
 * ── Two-square（照 Wikipedia《Two-square cipher》，又称 double Playfair）──
 * 两个 keyword 方阵，横排（左|右）或纵排（上/下）。Two-square 是自反密码：
 * encode 与 decode 为同一变换。
 * 纵排(vertical)：a 定位于上方阵(r1,c1)，b 定位于下方阵(r2,c2)。
 * 同列(c1==c2)：原样输出 a,b；否则 out1=上[r1][c2]，out2=下[r2][c1]。
 * 横排(horizontal)：a 定位于左方阵(r1,c1)，b 定位于右方阵(r2,c2)。
 * 同行(r1==r2)：原样输出 a,b；否则 out1=左[r2][c1]，out2=右[r1][c2]。
 *
 * 通用预处理：转大写 → 按字母表约定归一（J→I 或去 Q）→ 仅留表内字母 → 奇数末尾补 X。
 *
 * 红线：只新建本文件，不碰 main.js / i18n / eduContent.js / 任何他人文件。
 * 算法照权威源（Wikipedia），不编造。
 */

import { register } from "./registry.js";

// 两种 25 字母标准表。
const ALPHA_IJ = "ABCDEFGHIKLMNOPQRSTUVWXYZ";  // 去 J（I/J 合并）
const ALPHA_NOQ = "ABCDEFGHIJKLMNOPRSTUVWXYZ"; // 去 Q

/** 取字母表约定对应的 25 字母基准表。 */
function baseAlpha(mode) {
  return mode === "noq" ? ALPHA_NOQ : ALPHA_IJ;
}

/** 把任意字符串按约定归一为“仅含 25 表内字母”的大写串。 */
function normalizeLetters(str, mode) {
  let s = String(str == null ? "" : str).toUpperCase();
  if (mode === "noq") {
    s = s.replace(/Q/g, ""); // 省 Q：Q 直接丢弃
  } else {
    s = s.replace(/J/g, "I"); // 合并：J→I
  }
  const alpha = baseAlpha(mode);
  let out = "";
  for (const ch of s) if (alpha.indexOf(ch) !== -1) out += ch;
  return out;
}

/** keyword → 25 字母方阵字符串（归一、去重、补齐余下字母）。 */
function buildSquare(keyword, mode) {
  const kw = normalizeLetters(keyword, mode);
  const alpha = baseAlpha(mode);
  let sq = "";
  const seen = new Set();
  for (const ch of kw + alpha) {
    if (!seen.has(ch)) {
      seen.add(ch);
      sq += ch;
    }
  }
  return sq; // 恒为 25 字母（alpha 兜底补全）
}

/** 明文预处理：归一到 25 表内字母，奇数补 X。 */
function cleanDigraphs(text, mode) {
  let s = normalizeLetters(text, mode);
  if (s.length % 2 !== 0) s += "X";
  return s;
}

// ========================= Four-square =========================

function fourSquareRun(text, kw1, kw2, mode, alphaMode) {
  const alpha = baseAlpha(alphaMode);
  const sq1 = buildSquare(kw1, alphaMode); // 右上（密文方阵1）
  const sq2 = buildSquare(kw2, alphaMode); // 左下（密文方阵2）
  const s = cleanDigraphs(text, alphaMode);
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    const a = s[i];
    const b = s[i + 1];
    if (mode === "encode") {
      const ia = alpha.indexOf(a);
      const ib = alpha.indexOf(b);
      const r1 = Math.floor(ia / 5), c1 = ia % 5;
      const r2 = Math.floor(ib / 5), c2 = ib % 5;
      out += sq1[r1 * 5 + c2] + sq2[r2 * 5 + c1];
    } else {
      const ia = sq1.indexOf(a);
      const ib = sq2.indexOf(b);
      const r1 = Math.floor(ia / 5), cc1 = ia % 5;
      const r2 = Math.floor(ib / 5), cc2 = ib % 5;
      out += alpha[r1 * 5 + cc2] + alpha[r2 * 5 + cc1];
    }
  }
  return out;
}

const fourSquareEncodeKw = (text, kw1, kw2, alphaMode) =>
  fourSquareRun(text, kw1, kw2, "encode", alphaMode);
const fourSquareDecodeKw = (text, kw1, kw2, alphaMode) =>
  fourSquareRun(text, kw1, kw2, "decode", alphaMode);

// ========================= Two-square =========================
// 自反：encode 与 decode 同一变换。

function twoSquareTransform(text, kw1, kw2, orientation, alphaMode) {
  const sq1 = buildSquare(kw1, alphaMode); // 纵排=上 / 横排=左
  const sq2 = buildSquare(kw2, alphaMode); // 纵排=下 / 横排=右
  const horizontal = orientation === "horizontal";
  const s = cleanDigraphs(text, alphaMode);
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    const ia = sq1.indexOf(s[i]);
    const ib = sq2.indexOf(s[i + 1]);
    const r1 = Math.floor(ia / 5), c1 = ia % 5;
    const r2 = Math.floor(ib / 5), c2 = ib % 5;
    if (horizontal) {
      if (r1 === r2) {
        out += s[i] + s[i + 1]; // 同行：原样
      } else {
        out += sq1[r2 * 5 + c1] + sq2[r1 * 5 + c2];
      }
    } else {
      if (c1 === c2) {
        out += s[i] + s[i + 1]; // 同列：原样
      } else {
        out += sq1[r1 * 5 + c2] + sq2[r2 * 5 + c1];
      }
    }
  }
  return out;
}

// ========================= 注册 =========================

const ALPHA_PARAM = {
  key: "alphabet", label: "字母表约定", type: "select", default: "ij",
  options: [
    { value: "ij", label: "I/J 合并（去 J）" },
    { value: "noq", label: "省略 Q（Wikipedia 官方例）" },
  ],
};

register({
  id: "foursquarekw",
  cat: "classic",
  name: "Four-square 四方（keyword）",
  desc: "四方密码：两个 keyword 生成密文方阵 + 两个标准明文方阵，双字母替换。5×5，奇数补 X。字母表可选 I/J 合并或省略 Q（后者复现 Wikipedia 官方向量）。与既有 foursquare（原始方阵版）算法一致、入口为关键词。",
  params: [
    { key: "key1", label: "关键词1（右上密文方阵）", type: "text", default: "EXAMPLE", placeholder: "任意英文单词" },
    { key: "key2", label: "关键词2（左下密文方阵）", type: "text", default: "KEYWORD", placeholder: "任意英文单词" },
    ALPHA_PARAM,
  ],
  encode: (t, p) => fourSquareEncodeKw(t, (p && p.key1) || "EXAMPLE", (p && p.key2) || "KEYWORD", (p && p.alphabet) || "ij"),
  decode: (t, p) => fourSquareDecodeKw(t, (p && p.key1) || "EXAMPLE", (p && p.key2) || "KEYWORD", (p && p.alphabet) || "ij"),
});

register({
  id: "twosquare",
  cat: "classic",
  name: "Two-square 双方",
  desc: "双方密码（double Playfair）：两个 keyword 方阵，横排或纵排双字母替换。自反密码（编=解）。5×5，奇数补 X；纵排同列 / 横排同行时该组原样输出。字母表可选 I/J 合并或省略 Q。",
  params: [
    { key: "key1", label: "关键词1（上 / 左方阵）", type: "text", default: "EXAMPLE", placeholder: "任意英文单词" },
    { key: "key2", label: "关键词2（下 / 右方阵）", type: "text", default: "KEYWORD", placeholder: "任意英文单词" },
    {
      key: "orientation", label: "排列方向", type: "select", default: "vertical",
      options: [
        { value: "vertical", label: "纵排（上/下）" },
        { value: "horizontal", label: "横排（左|右）" },
      ],
    },
    ALPHA_PARAM,
  ],
  encode: (t, p) => twoSquareTransform(t, (p && p.key1) || "EXAMPLE", (p && p.key2) || "KEYWORD", (p && p.orientation) || "vertical", (p && p.alphabet) || "ij"),
  decode: (t, p) => twoSquareTransform(t, (p && p.key1) || "EXAMPLE", (p && p.key2) || "KEYWORD", (p && p.orientation) || "vertical", (p && p.alphabet) || "ij"),
});

export {
  buildSquare,
  normalizeLetters,
  fourSquareEncodeKw,
  fourSquareDecodeKw,
  twoSquareTransform,
  ALPHA_IJ,
  ALPHA_NOQ,
};
