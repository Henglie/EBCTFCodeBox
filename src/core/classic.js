/*
 * classic.js — 古典密码（cat:'classic'）。
 * 维吉尼亚、Gronsfeld、Beaufort、AutoKey、Porta、Playfair、Hill、仿射
 * FourSquare、Bifid、Trifid、Polybius、ADFGX/ADFGVX、列移位、Nihilist、GrayCode。
 *
 * 算法来源：复刻自 WhatsInYourClipboard 的 classicalCiphers.js / classicalGrid.js /
 * classicalExtra.js / ciphers.js（ISC License，鸣谢 Leon406/ToolsFx）。
 * 编码表照抄源码，不许编造。每个 encode/decode 用往返测试验证。
 */
import { register } from "./registry.js";

const AZ = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const AZ_NO_J = "ABCDEFGHIKLMNOPQRSTUVWXYZ"; // 25，无 J
const AZ_NO_K = "ABCDEFGHIJLMNOPQRSTUVWXYZ"; // 25，无 K
const ADFGX_MAP = "ADFGX";
const ADFGVX_MAP = "ADFGVX";
const TABLE_ADFGVX = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"; // 36，6×6

const stripSpace = (s) => s.replace(/\s+/g, "");
const onlyLetters = (s) => s.replace(/[^a-zA-Z]/g, "");

// ============ Polybius 键控方阵（classicalGrid.js polyEncrypt/polyDecrypt） ============
function polyEncrypt(text, table = AZ_NO_J, encMap = "12345", rep) {
  const t = stripSpace(table).toUpperCase();
  const map = {};
  for (let i = 0; i < t.length; i++) {
    map[t[i]] = encMap[Math.floor(i / encMap.length)] + encMap[i % encMap.length];
  }
  let s = text.toUpperCase();
  if (rep && rep[0]) s = s.split(rep[0]).join(rep[1]);
  return [...s].map((c) => map[c] ?? c).join("");
}
function polyDecrypt(text, table = AZ_NO_J, encMap = "12345") {
  const t = stripSpace(table).toUpperCase();
  const map = {};
  for (let i = 0; i < t.length; i++) {
    map[encMap[Math.floor(i / encMap.length)] + encMap[i % encMap.length]] = t[i];
  }
  let sb = "", tmp = "";
  for (const c of text) {
    if (/[0-9a-zA-Z]/.test(c)) {
      if (tmp.length === 1) { tmp += c; sb += map[tmp] ?? tmp; tmp = ""; }
      else tmp = c;
    } else sb += c;
  }
  return sb;
}

// ============ 维吉尼亚（ciphers.js） ============
function vigenereEncode(text, key = "key") {
  const k = (key || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return text;
  let ki = 0;
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    const shift = k.charCodeAt(ki % k.length) - 97;
    ki++;
    return String.fromCharCode(((c.charCodeAt(0) - base + shift) % 26) + base);
  });
}
function vigenereDecode(text, key = "key") {
  if (!key) return text;
  const k = key.toLowerCase().replace(/[^a-z]/g, "");
  if (!k) return text;
  let ki = 0;
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    const shift = k.charCodeAt(ki % k.length) - 97;
    ki++;
    return String.fromCharCode(((c.charCodeAt(0) - base - shift + 26) % 26) + base);
  });
}

// ============ Gronsfeld（classicalCiphers.js，数字密钥维吉尼亚） ============
function gronsfeldEncode(text, key = "123456") {
  const shifts = key.replace(/\D/g, "").split("").map(Number);
  if (!shifts.length) return text;
  let idx = 0;
  return text.toUpperCase().replace(/[A-Z]/g, (ch) => {
    const out = AZ[(AZ.indexOf(ch) + shifts[idx % shifts.length]) % 26];
    idx++;
    return out;
  });
}
function gronsfeldDecode(text, key = "123456") {
  const shifts = key.replace(/\D/g, "").split("").map(Number);
  if (!shifts.length) return text;
  let idx = 0;
  return text.toUpperCase().replace(/[A-Z]/g, (ch) => {
    const out = AZ[(AZ.indexOf(ch) + 26 - shifts[idx % shifts.length]) % 26];
    idx++;
    return out;
  });
}

// ============ Beaufort（classicalCiphers.js，自反） ============
function beaufort(text, key = "FORTIFICATION") {
  const k = key.toUpperCase().replace(/[^A-Z]/g, "");
  if (!k) return text;
  let idx = 0;
  let out = "";
  for (const ch of text.toUpperCase()) {
    if (!/[A-Z]/.test(ch)) continue;
    out += AZ[(AZ.indexOf(k[idx % k.length]) - AZ.indexOf(ch) + 26) % 26];
    idx++;
  }
  return out;
}

// ============ AutoKey 自动密钥（classicalExtra.js） ============
function autoKeyEncode(text, keyword = "KEY") {
  const kw = keyword.toUpperCase().replace(/[^A-Z]/g, "") || "KEY";
  const stream = kw.split("");
  let ki = 0;
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    const p = c.charCodeAt(0) - base;
    const k = AZ.indexOf(stream[ki]);
    stream.push(AZ[p]);
    ki++;
    return String.fromCharCode(base + ((p + k) % 26));
  });
}
function autoKeyDecode(text, keyword = "KEY") {
  const kw = keyword.toUpperCase().replace(/[^A-Z]/g, "") || "KEY";
  const stream = kw.split("");
  let ki = 0;
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    const ct = c.charCodeAt(0) - base;
    const k = AZ.indexOf(stream[ki]);
    const p = (ct - k + 26) % 26;
    stream.push(AZ[p]);
    ki++;
    return String.fromCharCode(base + p);
  });
}

// ============ Porta（classicalCiphers.js，自反） ============
const PORTA_ROWS = {
  A: "NOPQRSTUVWXYZABCDEFGHIJKLM", B: "NOPQRSTUVWXYZABCDEFGHIJKLM",
  Y: "ZNOPQRSTUVWXYBCDEFGHIJKLMA", Z: "ZNOPQRSTUVWXYBCDEFGHIJKLMA",
  W: "YZNOPQRSTUVWXCDEFGHIJKLMAB", X: "YZNOPQRSTUVWXCDEFGHIJKLMAB",
  U: "XYZNOPQRSTUVWDEFGHIJKLMABC", V: "XYZNOPQRSTUVWDEFGHIJKLMABC",
  S: "WXYZNOPQRSTUVEFGHIJKLMABCD", T: "WXYZNOPQRSTUVEFGHIJKLMABCD",
  Q: "VWXYZNOPQRSTUFGHIJKLMABCDE", R: "VWXYZNOPQRSTUFGHIJKLMABCDE",
  O: "UVWXYZNOPQRSTGHIJKLMABCDEF", P: "UVWXYZNOPQRSTGHIJKLMABCDEF",
  M: "TUVWXYZNOPQRSHIJKLMABCDEFG", N: "TUVWXYZNOPQRSHIJKLMABCDEFG",
  K: "STUVWXYZNOPQRIJKLMABCDEFGH", L: "STUVWXYZNOPQRIJKLMABCDEFGH",
  I: "RSTUVWXYZNOPQJKLMABCDEFGHI", J: "RSTUVWXYZNOPQJKLMABCDEFGHI",
  G: "QRSTUVWXYZNOPKLMABCDEFGHIJ", H: "QRSTUVWXYZNOPKLMABCDEFGHIJ",
  E: "PQRSTUVWXYZNOLMABCDEFGHIJK", F: "PQRSTUVWXYZNOLMABCDEFGHIJK",
  C: "OPQRSTUVWXYZNMABCDEFGHIJKL", D: "OPQRSTUVWXYZNMABCDEFGHIJKL",
};
function porta(text, key = "FORTIFICATION") {
  const k = key.toUpperCase().replace(/[^A-Z]/g, "");
  if (!k) return text;
  let idx = 0;
  let out = "";
  for (const ch of text.toUpperCase()) {
    if (!/[A-Z]/.test(ch)) continue;
    const row = PORTA_ROWS[k[idx % k.length]];
    out += row[AZ.indexOf(ch)];
    idx++;
  }
  return out;
}

// ============ Playfair（classicalGrid.js） ============
function playfairAlphabet(keyword) {
  const alpha = [...AZ_NO_J];
  const key = [...new Set(keyword.replace(/ /g, "").toUpperCase())];
  for (const c of key) { const i = alpha.indexOf(c); if (i !== -1) alpha.splice(i, 1); }
  return key.concat(alpha);
}
const pfCase = (resultChar, srcChar) =>
  /[a-z]/.test(srcChar) ? resultChar.toLowerCase() : resultChar.toUpperCase();
const pfPoint = (i) => [Math.floor(i / 5), i % 5];
function playfairEncode(text, keyword = "") {
  const alpha = playfairAlphabet(keyword);
  let s = text
    .replace(/[^A-Za-z]/g, "").replace(/J/g, "I").replace(/j/g, "i")
    .replace(/(\w)\1/g, "$1X$1");
  if (s.length % 2 !== 0) s += "X";
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    const c1 = s[i], c2 = s[i + 1];
    const [r1, col1] = pfPoint(alpha.indexOf(c1.toUpperCase()));
    const [r2, col2] = pfPoint(alpha.indexOf(c2.toUpperCase()));
    if (r1 === r2) {
      out += pfCase(alpha[5 * r2 + (col1 + 1) % 5], c2);
      out += pfCase(alpha[5 * r1 + (col2 + 1) % 5], c1);
    } else if (col1 === col2) {
      out += pfCase(alpha[5 * ((r1 + 1) % 5) + col2], c1);
      out += pfCase(alpha[5 * ((r2 + 1) % 5) + col1], c2);
    } else {
      out += pfCase(alpha[5 * r1 + col2], c1);
      out += pfCase(alpha[5 * r2 + col1], c2);
    }
  }
  return out;
}
function playfairDecode(text, keyword = "") {
  const alpha = playfairAlphabet(keyword);
  const s = text.replace(/[^A-Za-z]/g, "").replace(/J/g, "I").replace(/j/g, "i");
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    const c1 = s[i], c2 = s[i + 1];
    if (c2 === undefined) { out += c1; break; }
    const [r1, col1] = pfPoint(alpha.indexOf(c1.toUpperCase()));
    const [r2, col2] = pfPoint(alpha.indexOf(c2.toUpperCase()));
    if (r1 === r2) {
      out += pfCase(alpha[5 * r2 + (col1 + 4) % 5], c2);
      out += pfCase(alpha[5 * r1 + (col2 + 4) % 5], c1);
    } else if (col1 === col2) {
      out += pfCase(alpha[5 * ((r1 + 4) % 5) + col2], c1);
      out += pfCase(alpha[5 * ((r2 + 4) % 5) + col1], c2);
    } else {
      out += pfCase(alpha[5 * r1 + col2], c1);
      out += pfCase(alpha[5 * r2 + col1], c2);
    }
  }
  return out.replace(/(\w)X\1/g, "$1$1");
}

// ============ Hill 希尔密码（classicalExtra.js） ============
function modInv(a, m) {
  a = ((a % m) + m) % m;
  for (let x = 1; x < m; x++) if ((a * x) % m === 1) return x;
  return -1;
}
function minor(mat, r, c) {
  const sub = [];
  for (let i = 0; i < mat.length; i++) {
    if (i === r) continue;
    const row = [];
    for (let j = 0; j < mat.length; j++) {
      if (j === c) continue;
      row.push(mat[i][j]);
    }
    sub.push(row);
  }
  return determinant(sub);
}
function determinant(mat) {
  const n = mat.length;
  if (n === 1) return mat[0][0];
  if (n === 2) return mat[0][0] * mat[1][1] - mat[0][1] * mat[1][0];
  let det = 0;
  for (let j = 0; j < n; j++) {
    det += (j % 2 === 0 ? 1 : -1) * mat[0][j] * minor(mat, 0, j);
  }
  return det;
}
function invertMatrixMod(mat, m) {
  const n = mat.length;
  let det = ((determinant(mat) % m) + m) % m;
  const detInv = modInv(det, m);
  if (detInv < 0) throw new Error("Hill: 密钥矩阵在 mod " + m + " 下不可逆");
  const inv = [];
  for (let i = 0; i < n; i++) {
    inv.push([]);
    for (let j = 0; j < n; j++) {
      const cof = ((i + j) % 2 === 0 ? 1 : -1) * minor(mat, j, i);
      inv[i][j] = (((cof * detInv) % m) + m) % m;
    }
  }
  return inv;
}
function parseHillKey(key) {
  let nums;
  if (/\d/.test(key)) {
    nums = key.split(/\D+/).filter(Boolean).map(Number);
  } else {
    nums = key.toUpperCase().replace(/[^A-Z]/g, "").split("").map((c) => AZ.indexOf(c));
  }
  const n = Math.round(Math.sqrt(nums.length));
  if (n * n !== nums.length || n < 2) throw new Error("Hill: 密钥长度须为完全平方数（≥4）");
  const mat = [];
  for (let i = 0; i < n; i++) mat.push(nums.slice(i * n, i * n + n));
  return mat;
}
function hillApply(text, mat) {
  const n = mat.length;
  const letters = text.toUpperCase().replace(/[^A-Z]/g, "").split("").map((c) => AZ.indexOf(c));
  while (letters.length % n !== 0) letters.push(AZ.indexOf("X"));
  let out = "";
  for (let i = 0; i < letters.length; i += n) {
    const vec = letters.slice(i, i + n);
    for (let r = 0; r < n; r++) {
      let sum = 0;
      for (let c = 0; c < n; c++) sum += mat[r][c] * vec[c];
      out += AZ[((sum % 26) + 26) % 26];
    }
  }
  return out;
}
function hillEncode(text, key = "GYBNQKURP") {
  return hillApply(text, parseHillKey(key));
}
function hillDecode(text, key = "GYBNQKURP") {
  return hillApply(text, invertMatrixMod(parseHillKey(key), 26));
}

// ============ 仿射（ciphers.js） ============
function affineEncode(text, a = 5, b = 8) {
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    const x = c.charCodeAt(0) - base;
 // 正规化取模：b 为负/超界时 ((n%26)+26)%26 保证落在 0..25
    return String.fromCharCode((((a * x + b) % 26) + 26) % 26 + base);
  });
}
function affineDecode(text, a = 5, b = 8) {
  const aInv = modInv(a, 26);
  if (aInv < 0) throw new Error("仿射: a 与 26 不互质");
  return text.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    const y = c.charCodeAt(0) - base;
 // 正规化取模，不再依赖硬编码 +26*10 偏移（b 超过 260 会失效）
    return String.fromCharCode((((aInv * (y - b)) % 26) + 26) % 26 + base);
  });
}

// ============ Bifid（classicalGrid.js） ============
function bifidEncode(text, key = AZ_NO_J, period = 5) {
  const poly = polyEncrypt(onlyLetters(text), key);
  let mixed = "";
  for (let i = 0; i < poly.length; i += period * 2) {
    const chunk = poly.slice(i, i + period * 2);
    let even = "", odd = "";
    for (let j = 0; j < chunk.length; j++) (j % 2 === 0 ? (even += chunk[j]) : (odd += chunk[j]));
    mixed += even + odd;
  }
  return polyDecrypt(mixed, key);
}
function bifidDecode(text, key = AZ_NO_J, period = 5) {
  const poly = polyEncrypt(onlyLetters(text), key);
  let mixed = "";
  for (let i = 0; i < poly.length; i += period * 2) {
    const chunk = poly.slice(i, i + period * 2);
    const half = chunk.length / 2;
    const acc = new Array(chunk.length);
    for (let j = 0; j < chunk.length; j++) {
      if (j < half) acc[j * 2] = chunk[j];
      else acc[(j - half) * 2 + 1] = chunk[j];
    }
    mixed += acc.join("");
  }
  return polyDecrypt(mixed, key);
}

// ============ Trifid（classicalGrid.js） ============
function trifidSquareIndex(squares, ch) {
  const r = [0, 0, 0];
  squares.forEach((sq, idx) => {
    const p = sq.indexOf(ch);
    if (p !== -1) { r[0] = idx + 1; r[1] = Math.floor(p / 3) + 1; r[2] = (p % 3) + 1; }
  });
  return r.join("");
}
function trifidSquare(squares, sq, row, col) {
  return squares[sq - 1][col - 1 + 3 * (row - 1)];
}
function trifidEncode(text, key, period = 5) {
  if (!key || key.length !== 27) throw new Error("Trifid 密钥须为 27 字符");
  const squares = [key.slice(0, 9), key.slice(9, 18), key.slice(18, 27)];
 // 只保留在密钥表中的字符（不在表内的字符无坐标，跳过防止非法索引崩溃）。
  const keySet = new Set(key.toUpperCase());
  const clean = [...text.toUpperCase()].filter((c) => keySet.has(c));
  const digits = clean.map((c) => trifidSquareIndex(squares, c)).join("");
  let mixed = "";
  for (let i = 0; i < digits.length; i += period * 3) {
    const chunk = digits.slice(i, i + period * 3);
    let a = "", b = "", c = "";
    for (let j = 0; j < chunk.length; j++) {
      if (j % 3 === 0) a += chunk[j]; else if (j % 3 === 1) b += chunk[j]; else c += chunk[j];
    }
    mixed += a + b + c;
  }
  let out = "";
  for (let i = 0; i + 3 <= mixed.length; i += 3) {
    const p = [+mixed[i], +mixed[i + 1], +mixed[i + 2]];
    out += trifidSquare(squares, p[0], p[1], p[2]);
  }
  return out;
}
function trifidDecode(text, key, period = 5) {
  if (!key || key.length !== 27) throw new Error("Trifid 密钥须为 27 字符");
  const squares = [key.slice(0, 9), key.slice(9, 18), key.slice(18, 27)];
  const keySet = new Set(key.toUpperCase());
  const clean = [...text.toUpperCase()].filter((c) => keySet.has(c));
  const digits = clean.map((c) => trifidSquareIndex(squares, c)).join("");
  let mixed = "";
  for (let i = 0; i < digits.length; i += period * 3) {
    const chunk = digits.slice(i, i + period * 3);
    const third = chunk.length / 3;
    const acc = new Array(chunk.length);
    for (let j = 0; j < chunk.length; j++) {
      const s = Math.floor(j / third);
      const m = j % third;
      acc[m * 3 + s] = chunk[j];
    }
    mixed += acc.join("");
  }
  let out = "";
  for (let i = 0; i + 3 <= mixed.length; i += 3) {
    const p = [+mixed[i], +mixed[i + 1], +mixed[i + 2]];
    out += trifidSquare(squares, p[0], p[1], p[2]);
  }
  return out;
}

// ============ ADFGX / ADFGVX（classicalGrid.js） ============
function adfgxEncode(text, table, keyword, encMap, rep) {
  const key = [...new Set(keyword)];
  const poly = polyEncrypt(text, table, encMap, rep);
  const cols = key.map(() => []);
  for (let i = 0; i < poly.length; i++) cols[i % key.length].push(poly[i]);
  const order = key.map((c, i) => [c, i]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return order.map(([, i]) => cols[i].join("")).join("");
}
function adfgxDecode(text, table, keyword, encMap) {
  const key = [...new Set(keyword)];
  const klen = key.length;
  const count = text.length % klen;
  const len = Math.floor(text.length / klen);
  const order = key.map((c, i) => [c, i]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const colLenByOrig = key.map((_, i) => len + (i < count ? 1 : 0));
  const sortedColLens = order.map(([, i]) => colLenByOrig[i]);
  const slices = [];
  let pos = 0;
  for (const L of sortedColLens) { slices.push(text.slice(pos, pos + L)); pos += L; }
  const colByOrig = {};
  order.forEach(([, origI], k) => { colByOrig[origI] = slices[k]; });
  const out = new Array(text.length);
  const ptr = key.map(() => 0);
  for (let i = 0; i < text.length; i++) {
    const k = i % klen;
    out[i] = colByOrig[k][ptr[k]++];
  }
  return polyDecrypt(out.join(""), table, encMap);
}
const adfgxEnc = (text, table = AZ_NO_J, keyword = "KEY") =>
  adfgxEncode(text, table, keyword, ADFGX_MAP, ["J", "I"]);
const adfgxDec = (text, table = AZ_NO_J, keyword = "KEY") =>
  adfgxDecode(text, table, keyword, ADFGX_MAP);
const adfgvxEnc = (text, table = TABLE_ADFGVX, keyword = "KEY") =>
  adfgxEncode(text, table, keyword, ADFGVX_MAP, ["", ""]);
const adfgvxDec = (text, table = TABLE_ADFGVX, keyword = "KEY") =>
  adfgxDecode(text, table, keyword, ADFGVX_MAP);

// ============ Nihilist（classicalGrid.js，键控 Polybius 字母表） ============
function nihilistTable(keyword) {
  const alpha = [...AZ_NO_J];
  const key = [...new Set(stripSpace(keyword).toUpperCase())];
  for (const c of key) { const i = alpha.indexOf(c); if (i !== -1) alpha.splice(i, 1); }
  return key.concat(alpha).join("");
}
const nihilistEncode = (text, keyword = "KEY") => polyEncrypt(text, nihilistTable(keyword));
const nihilistDecode = (text, keyword = "KEY") => polyDecrypt(text, nihilistTable(keyword));

// ============ FourSquare（classicalGrid.js） ============
function fourSquareEncode(text, key1, key2) {
  const k1 = onlyLetters(key1).toUpperCase();
  const k2 = onlyLetters(key2).toUpperCase();
  if (k1.length !== 25 || k2.length !== 25) throw new Error("两个密钥须各为 25 字母");
  let s = onlyLetters(text).toUpperCase().replace(/J/g, "I");
  if (s.length % 2 !== 0) s += "X";
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    const a = AZ_NO_J.indexOf(s[i]), b = AZ_NO_J.indexOf(s[i + 1]);
    const ar = Math.floor(a / 5), ac = a % 5, br = Math.floor(b / 5), bc = b % 5;
    out += k1[ar * 5 + bc] + k2[br * 5 + ac];
  }
  return out;
}
function fourSquareDecode(text, key1, key2) {
  const k1 = onlyLetters(key1).toUpperCase();
  const k2 = onlyLetters(key2).toUpperCase();
  if (k1.length !== 25 || k2.length !== 25) throw new Error("两个密钥须各为 25 字母");
  let s = onlyLetters(text).toUpperCase().replace(/J/g, "I");
  if (s.length % 2 !== 0) s += "X";
  let out = "";
  for (let i = 0; i < s.length; i += 2) {
    const a = k1.indexOf(s[i]), b = k2.indexOf(s[i + 1]);
    const ar = Math.floor(a / 5), ac = a % 5, br = Math.floor(b / 5), bc = b % 5;
    out += AZ_NO_J[ar * 5 + bc] + AZ_NO_J[br * 5 + ac];
  }
  return out;
}

// ============ Polybius（classicalCiphers.js，5×5 J→I） ============
function polybiusEncode(text, table = AZ_NO_J, encMap = "12345") {
  const t = stripSpace(table).toUpperCase();
  let out = "";
  for (const ch of text.toUpperCase()) {
    let c = ch;
    if (c === "J") c = "I";
    const i = t.indexOf(c);
    if (i === -1) { out += ch; continue; }
    out += `${encMap[Math.floor(i / encMap.length)]}${encMap[i % encMap.length]}`;
  }
  return out;
}
function polybiusDecode(text, table = AZ_NO_J, encMap = "12345") {
  return polyDecrypt(text, table, encMap);
}

// ============ 列移位 Columnar Transposition（自写，key 按字母顺序读列） ============
function columnarEncode(text, key = "ZEBRA") {
  const k = (key || "ZEBRA").toUpperCase().replace(/[^A-Z]/g, "");
  if (!k) return text;
  const clean = text.toUpperCase().replace(/[^A-Z]/g, "");
  const cols = k.length;
  const rows = Math.ceil(clean.length / cols);
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(""));
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols && idx < clean.length; c++) grid[r][c] = clean[idx++];
  }
 // 稳定排序：相同字母按原位置
  const order = [...k].map((ch, i) => [ch, i]).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
  let out = "";
  for (const [, origI] of order) {
    for (let r = 0; r < rows; r++) out += grid[r][origI] || "";
  }
  return out;
}
function columnarDecode(text, key = "ZEBRA") {
  const k = (key || "ZEBRA").toUpperCase().replace(/[^A-Z]/g, "");
  if (!k) return text;
  const cols = k.length;
  const total = text.length;
  const baseRows = Math.floor(total / cols);
  const extraCols = total % cols;
  const order = [...k].map((ch, i) => [ch, i]).sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]);
 // 列长按 origI 分配：encode 时按行填充，前 extraCols 个 origI 列多 1 字符
  const colLenByOrig = new Array(cols).fill(0);
  order.forEach(([, origI]) => {
    colLenByOrig[origI] = baseRows + (origI < extraCols ? 1 : 0);
  });
  const rows = Math.ceil(total / cols);
  const grid = Array.from({ length: rows }, () => new Array(cols).fill(""));
  let pos = 0;
  for (const [, origI] of order) {
    const len = colLenByOrig[origI];
    const colChars = text.slice(pos, pos + len);
    pos += len;
    for (let r = 0; r < len; r++) grid[r][origI] = colChars[r];
  }
  let out = "";
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) if (grid[r][c]) out += grid[r][c];
  }
  return out;
}

// ============ GrayCode（classicalGrid.js，文本 ↔ 格雷码二进制串） ============
const teGray = (s) => [...new TextEncoder().encode(s)];
const tdGray = (b) => new TextDecoder("utf-8").decode(new Uint8Array(b));
function grayEncode(text) {
  const bin = teGray(text).map((b) => b.toString(2).padStart(8, "0")).join("");
  let out = "";
  for (let i = 0; i < bin.length; i++) {
    out += i === 0 ? bin[0] : String((+bin[i]) ^ (+bin[i - 1]));
  }
  return out;
}
function grayDecode(text) {
  const bin = text.replace(/[^01]/g, "");
  let out = "";
  for (let i = 0; i < bin.length; i++) {
    out += i === 0 ? bin[0] : String((+bin[i]) ^ (+out[i - 1]));
  }
  const bytes = [];
  for (let i = 0; i + 8 <= out.length; i += 8) bytes.push(parseInt(out.slice(i, i + 8), 2));
  return tdGray(bytes);
}
// ---- num 模式：十进制数值 ↔ 格雷二进制串（迁移自 radix.js grayNum，算法字节级一致） ----
function grayNumEncodeC(text, bits) {
  const s = String(text).trim().replace(/^\+/, "");
  if (!s || !/^[0-9]+$/.test(s)) throw new Error("格雷码输入须为非负整数");
  const n = BigInt(s);
  const g = n ^ (n >> 1n);
  let bin = g.toString(2);
  if (bits && bits > 0) bin = bin.padStart(bits, "0");
  return bin;
}
function grayNumDecodeC(text) {
  const bin = String(text).trim().replace(/[^01]/g, "");
  if (!bin) throw new Error("无效二进制串");
  let g = 0n;
  for (const ch of bin) g = (g << 1n) | (ch === "1" ? 1n : 0n);
  let n = g;
  let shifted = g >> 1n;
  while (shifted > 0n) { n ^= shifted; shifted >>= 1n; }
  return n.toString(10);
}
// ---- bytes 模式：逐字节 g=b^(b>>1)，文本 ↔ Gray Hex（迁移自 bitops.js grayCodeBytes，算法字节级一致） ----
function grayBytesEncodeC(text) {
  const bytes = new TextEncoder().encode(String(text));
  let s = "";
  for (const b of bytes) {
    const g = (b ^ (b >>> 1)) & 0xff;
    s += g.toString(16).padStart(2, "0");
  }
  return s.toUpperCase();
}
function grayBytesDecodeC(text) {
  const s = String(text).trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (s.length === 0) return "";
  if (s.length % 2 !== 0) throw new Error("Hex 长度须为偶数：" + s.length);
  if (!/^[0-9a-fA-F]+$/.test(s)) throw new Error("非法 Hex 字符：" + s);
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    let g = parseInt(s.substr(i * 2, 2), 16) & 0xff;
    g ^= g >>> 1; g ^= g >>> 2; g ^= g >>> 4;
    out[i] = g & 0xff;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(out);
}

// ---- 注册 ----
const KEY_PARAM = { key: "key", type: "text", default: "key", label: "密钥" };
function regKey(id, name, desc, encode, decode, keyDefault, keyLabel) {
  register({
    id, cat: "classic", name, desc,
    params: [{ key: "key", label: keyLabel || "密钥", type: "text", default: keyDefault }],
    encode: (t, p) => encode(t, (p && p.key) || keyDefault),
    decode: (t, p) => decode(t, (p && p.key) || keyDefault),
  });
}

regKey("vigenere", "维吉尼亚", "字母密钥加减移位", vigenereEncode, vigenereDecode, "key", "字母密钥");
regKey("gronsfeld", "Gronsfeld", "数字密钥维吉尼亚", gronsfeldEncode, gronsfeldDecode, "123456", "数字密钥");
regKey("beaufort", "Beaufort", "自反（编解码同形）", beaufort, beaufort, "FORTIFICATION", "密钥");
regKey("autokey", "AutoKey 自动密钥", "密钥流=keyword+明文", autoKeyEncode, autoKeyDecode, "KEY", "keyword");
regKey("porta", "Porta", "自反（编解码同形）", porta, porta, "FORTIFICATION", "密钥");
regKey("playfair", "Playfair", "5×5 键控方阵", playfairEncode, playfairDecode, "MONARCHY", "keyword");
regKey("nihilist", "Nihilist 虚无党", "键控 Polybius", nihilistEncode, nihilistDecode, "KEY", "keyword");
regKey("columnar", "列移位", "按 key 字母顺序读列", columnarEncode, columnarDecode, "ZEBRA", "密钥（单词）");

register({
  id: "hill", cat: "classic", name: "Hill 希尔", desc: "矩阵加密（mod 26，密钥须完全平方数）",
  params: [{ key: "key", label: "密钥（数字或字母）", type: "text", default: "GYBNQKURP" }],
  encode: (t, p) => hillEncode(t, (p && p.key) || "GYBNQKURP"),
  decode: (t, p) => hillDecode(t, (p && p.key) || "GYBNQKURP"),
});

register({
  id: "affine", cat: "classic", name: "仿射", desc: "c=(a·x+b) mod 26（a 与 26 互质，b=0 即乘法密码）",
  params: [
    { key: "a", label: "a", type: "number", default: 5 },
    { key: "b", label: "b", type: "number", default: 8 },
  ],
  encode: (t, p) => affineEncode(t, Number((p && p.a) || 5), Number((p && p.b) ?? 8)),
  decode: (t, p) => affineDecode(t, Number((p && p.a) || 5), Number((p && p.b) ?? 8)),
});

register({
  id: "bifid", cat: "classic", name: "Bifid 双分", desc: "按 period 分组的 Polybius 转置",
  params: [
    { key: "key", label: "25 字母表", type: "text", default: AZ_NO_J },
    { key: "period", label: "period", type: "number", default: 5 },
  ],
  encode: (t, p) => bifidEncode(t, (p && p.key) || AZ_NO_J, Number((p && p.period) || 5)),
  decode: (t, p) => bifidDecode(t, (p && p.key) || AZ_NO_J, Number((p && p.period) || 5)),
});

register({
  id: "trifid", cat: "classic", name: "Trifid 三分", desc: "3×3×3 方阵（key 须 27 字符）",
  params: [
    { key: "key", label: "27 字符密钥表", type: "text", default: "ABCDEFGHIJKLMNOPQRSTUVWXYZ." },
    { key: "period", label: "period", type: "number", default: 5 },
  ],
  encode: (t, p) => trifidEncode(t, (p && p.key) || "ABCDEFGHIJKLMNOPQRSTUVWXYZ.", Number((p && p.period) || 5)),
  decode: (t, p) => trifidDecode(t, (p && p.key) || "ABCDEFGHIJKLMNOPQRSTUVWXYZ.", Number((p && p.period) || 5)),
});

register({
  id: "polybius", cat: "classic", name: "Polybius 方阵", desc: "5×5（J→I），字母↔坐标对",
  params: [{ key: "table", label: "25 字母表", type: "text", default: AZ_NO_J }],
  encode: (t, p) => polybiusEncode(t, (p && p.table) || AZ_NO_J),
  decode: (t, p) => polybiusDecode(t, (p && p.table) || AZ_NO_J),
});

register({
  id: "adfgx", cat: "classic", name: "ADFGX", desc: "Polybius + 列移位（5×5）",
  params: [
    { key: "table", label: "25 字母表", type: "text", default: AZ_NO_J },
    { key: "key", label: "列移位密钥", type: "text", default: "BATTLE" },
  ],
  encode: (t, p) => adfgxEnc(t, (p && p.table) || AZ_NO_J, (p && p.key) || "BATTLE"),
  decode: (t, p) => adfgxDec(t, (p && p.table) || AZ_NO_J, (p && p.key) || "BATTLE"),
});

register({
  id: "adfgvx", cat: "classic", name: "ADFGVX", desc: "Polybius + 列移位（6×6 含数字）",
  params: [
    { key: "table", label: "36 字母表", type: "text", default: TABLE_ADFGVX },
    { key: "key", label: "列移位密钥", type: "text", default: "BATTLE" },
  ],
  encode: (t, p) => adfgvxEnc(t, (p && p.table) || TABLE_ADFGVX, (p && p.key) || "BATTLE"),
  decode: (t, p) => adfgvxDec(t, (p && p.table) || TABLE_ADFGVX, (p && p.key) || "BATTLE"),
});

register({
  id: "foursquare", cat: "classic", name: "FourSquare 四方", desc: "双 25 字母密钥方阵",
  params: [
    { key: "key1", label: "密钥1（25 字母）", type: "text", default: "ZGPTFOIHMUWDRCNYKEQAXVSBL" },
    { key: "key2", label: "密钥2（25 字母）", type: "text", default: "MFNBDCRHSAXYOGVITUEWLQZKP" },
  ],
  encode: (t, p) => fourSquareEncode(t, (p && p.key1) || "ZGPTFOIHMUWDRCNYKEQAXVSBL", (p && p.key2) || "MFNBDCRHSAXYOGVITUEWLQZKP"),
  decode: (t, p) => fourSquareDecode(t, (p && p.key1) || "ZGPTFOIHMUWDRCNYKEQAXVSBL", (p && p.key2) || "MFNBDCRHSAXYOGVITUEWLQZKP"),
});

register({
  id: "graycode", cat: "classic", name: "格雷码 GrayCode",
  desc: "格雷码 g=n^(n>>1) 三模式：text=文本↔比特格雷串；num=十进制数值↔格雷二进制串（带位宽）；bytes=逐字节 g=b^(b>>1)，文本↔Gray Hex。",
  params: [
    { key: "mode", label: "模式", type: "select", default: "text", options: [
      { value: "text", label: "文本 ↔ 格雷比特串" },
      { value: "num", label: "数值 ↔ 格雷二进制串" },
      { value: "bytes", label: "逐字节 ↔ Gray Hex" },
    ] },
    { key: "bits", label: "位宽（仅 num，补零对齐，0=不定宽）", type: "number", default: 0 },
  ],
  encode: (t, p) => {
    const mode = (p && p.mode) || "text";
    if (mode === "num") return grayNumEncodeC(t, Number((p && p.bits) || 0));
    if (mode === "bytes") return grayBytesEncodeC(t);
    return grayEncode(t);
  },
  decode: (t, p) => {
    const mode = (p && p.mode) || "text";
    if (mode === "num") return grayNumDecodeC(t);
    if (mode === "bytes") return grayBytesDecodeC(t);
    return grayDecode(t);
  },
});

export {
  vigenereEncode, vigenereDecode,
  gronsfeldEncode, gronsfeldDecode,
  beaufort, autoKeyEncode, autoKeyDecode, porta, PORTA_ROWS,
  playfairEncode, playfairDecode,
  hillEncode, hillDecode, parseHillKey, invertMatrixMod,
  affineEncode, affineDecode,
  bifidEncode, bifidDecode,
  trifidEncode, trifidDecode,
  polybiusEncode, polybiusDecode, polyEncrypt, polyDecrypt,
  adfgxEnc, adfgxDec, adfgvxEnc, adfgvxDec,
  nihilistEncode, nihilistDecode, nihilistTable,
  fourSquareEncode, fourSquareDecode,
  columnarEncode, columnarDecode,
  grayEncode, grayDecode,
  AZ_NO_J, AZ_NO_K, TABLE_ADFGVX,
};
