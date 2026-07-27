/*
 * bazeries.js — Bazeries 密码（cat:'classic'）。
 *
 * Étienne Bazeries 19 世纪古典密码（5×5 方阵 + 数字 key 分组反转 + num2words 构造密钥矩阵）。
 *
 * 算法链路（cifrar/descifrar）:
 * 1. alfabeto = "abcdefghiklmnopqrstuvwxyz"（25 字母，I/J 合并，无 j）
 * 2. 标准矩阵 matrix：5×5 按列填充 alfabeto，indices_alfabeto[字母]=(行,列)
 * 3. key(int) → num2words 英文单词 → 清洗(去逗号/and/连字符/空格) → 去重打头 + alfabeto 剩余顺补 → key 矩阵(按行填充)，indices_llave[字母]=(列,行)
 * 4. key 各位数字 → digitos（= key 字符串各位）→ separar_en_grupos：按 digitos 循环分组，每组反转，组间空格
 * 5. cifrar：明文分组反转后，每字母查 indices_alfabeto(行,列)，从 key 矩阵取 matrix2[行][列]
 * 6. descifrar：密文分组反转后，每字母查 indices_llave(列,行)，从标准矩阵取 matrix[行][列]
 *
 * num2words：照 Python num2words 库（lang='en'，英国英语加 "and"）行为实现数字转英文单词
 * 清洗规则 re.sub(",", "") + re.sub(" and |-| ", "")，清洗后只保留字母。
 *
 * bug 修正：原实现 descifrar 未重设 self.digitos（依赖 cifrar 残留的类级 list，且会累积）
 * 本实现每次调用都从 key 重新提取 digitos，加解密对称。
 *
 * 契约：register({id, cat:"classic", name, desc, params, encode, decode})。
 * params: [{id:"key", label:"数字密钥", type:"text"}]
 * encode(text, {key}) → 密文字符串
 * decode(text, {key}) → 明文字符串
 */
import { register } from "./registry.js";

// ============================================================
// 常量
// ============================================================
const ALFABETO = "abcdefghiklmnopqrstuvwxyz"; // 25 字母，无 j（I/J 合并）

// ============================================================
// num2words：数字 → 英文单词（照 Python num2words 库 lang='en' 行为）
// ============================================================
const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function int2word0_99(n) {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const r = n % 10;
  return r ? TENS[t] + "-" + ONES[r] : TENS[t];
}
function int2word0_999(n) {
  if (n < 100) return int2word0_99(n);
  const h = Math.floor(n / 100);
  const rest = n % 100;
  let s = ONES[h] + " hundred";
  if (rest) s += " and " + int2word0_99(rest);
  return s;
}
function num2wordsEn(n) {
  if (n === 0) return "zero";
  const parts = [];
  for (const [h, name] of [[1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
    if (n >= h) {
      const q = Math.floor(n / h);
      parts.push(int2word0_999(q) + " " + name);
      n = n % h;
    }
  }
  if (n >= 100) {
    parts.push(int2word0_999(n));
  } else if (n > 0) {
 // 照 Python num2words 库：剩余 <100 且前面有大段时，"and X" 拼到最后一段后（非独立 part，无逗号）
    if (parts.length > 0) {
      parts[parts.length - 1] += " and " + int2word0_99(n);
    } else {
      parts.push(int2word0_99(n));
    }
  }
  return parts.join(", ");
}

// 清洗 num2words 输出
// re.sub(",", "") → 去逗号；re.sub(" and |-| ", "") → 去 " and " / "-" / 空格
function cleanNumWord(s) {
  return s.replace(/,/g, "").replace(/ and |-| /g, "");
}

// ============================================================
// Bazeries 核心
// ============================================================

// 标准矩阵：5×5 按列填充 alfabeto（matrix[行][列]），indices_alfabeto[字母]=(行,列)
function buildStdMatrix() {
  const matrix = [];
  const indices = {};
  for (let col = 0; col < 5; col++) {
    for (let row = 0; row < 5; row++) {
      if (!matrix[row]) matrix[row] = [];
      const ch = ALFABETO[col * 5 + row];
      matrix[row][col] = ch;
      indices[ch] = [row, col];
    }
  }
  return { matrix, indices };
}

// key 矩阵：num2words(key) 清洗 → 去重打头 + alfabeto 剩余顺补 → 5×5 按行填充
// indices_llave[字母]=(列,行)（注意 (j,i) = (列,行)）
function buildKeyMatrix(keyInt) {
  const word = cleanNumWord(num2wordsEn(keyInt));
 // 去重打头
  let aux = "";
  for (const ch of word) {
    if (!aux.includes(ch)) aux += ch;
  }
  for (const ch of ALFABETO) {
    if (!aux.includes(ch)) aux += ch;
  }
 // 5×5 按行填充（matrix2[i][j], indices_llave=(j,i)=(列,行)）
  const matrix2 = [];
  const indices = {};
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      if (!matrix2[row]) matrix2[row] = [];
      const ch = aux[idx++];
      matrix2[row][col] = ch;
      indices[ch] = [col, row]; // (列, 行)
    }
  }
  return { matrix2, indices };
}

// key 各位数字 → digitos（divmod 取各位再 reverse）
// key=123 → digitos=[1,2,3]
function keyToDigitos(keyInt) {
  const digitos = [];
  let n = keyInt;
  if (n === 0) {
    digitos.push(0);
  } else {
    while (n > 0) {
      digitos.push(n % 10);
      n = Math.floor(n / 10);
    }
  }
  digitos.reverse();
  return digitos;
}

// 分组反转（separar_en_grupos）
// 按 digitos 循环分组，每组反转，组间空格
function separarEnGrupos(texto, digitos) {
  let result = "";
  let i = 0;
  let di = 0;
  while (i < texto.length) {
    const d = digitos[di % digitos.length];
    const chunk = texto.slice(i, i + d);
 // 反转 chunk
    result += chunk.split("").reverse().join("");
    result += " ";
    i += d;
    di++;
  }
  return result;
}

// 加密（cifrar）
// params: { key } — op 层调用约定（registry params 对象）
function bazeriesEncrypt(text, params = {}) {
  const key = params.key != null ? params.key : params;
  const keyInt = parseInt(key, 10);
  if (isNaN(keyInt)) throw new Error("Bazeries 密钥须为数字");
 // 去空格 + 转小写
  let texto = text.replace(/ /g, "").toLowerCase();
 // 只保留 alfabeto 内字符（j→i）
  texto = texto.replace(/j/g, "i");
  const digitos = keyToDigitos(keyInt);
  if (digitos.length === 0 || digitos.every(d => d === 0)) {
    throw new Error("Bazeries 密钥各位全为 0，无法分组");
  }
  if (digitos.some(d => d === 0)) {
    throw new Error("Bazeries 密钥含数字 0，分组长度不能为 0");
  }
  const textoReverso = separarEnGrupos(texto, digitos);
  const { matrix2 } = buildKeyMatrix(keyInt);
  const std = buildStdMatrix();

  let cifrado = "";
  for (const t of textoReverso) {
    if (t === " ") {
      cifrado += " ";
    } else if (ALFABETO.includes(t)) {
 // aux = indices_alfabeto[t] = (行, 列)
      const [row, col] = std.indices[t];
      cifrado += matrix2[row][col];
    } else {
 // 非 alfabeto 字符原样保留
      cifrado += t;
    }
  }
  return cifrado;
}

// 解密（descifrar，修正 digitos 未重设 bug）
// params: { key } — op 层调用约定
function bazeriesDecrypt(text, params = {}) {
  const key = params.key != null ? params.key : params;
  const keyInt = parseInt(key, 10);
  if (isNaN(keyInt)) throw new Error("Bazeries 密钥须为数字");
  const digitos = keyToDigitos(keyInt);
  if (digitos.length === 0 || digitos.every(d => d === 0)) {
    throw new Error("Bazeries 密钥各位全为 0，无法分组");
  }
  if (digitos.some(d => d === 0)) {
    throw new Error("Bazeries 密钥含数字 0，分组长度不能为 0");
  }
 // 去空格后重新分组（解密也分组反转）
  const texto = text.replace(/ /g, "");
  const cifradoEnBloques = separarEnGrupos(texto, digitos);
  const { indices: indicesLlave } = buildKeyMatrix(keyInt);
  const std = buildStdMatrix();

  let descifrado = "";
  for (const t of cifradoEnBloques) {
    if (t === " ") {
      descifrado += " ";
    } else if (indicesLlave[t]) {
 // aux = indices_llave[t] = (列, 行)
 // descifrado += matrix[aux[1]][aux[0]] = matrix[行][列]
      const [col, row] = indicesLlave[t];
      descifrado += std.matrix[row][col];
    } else {
      descifrado += t;
    }
  }
 // split(" ") 后拼接去空格
  descifrado = descifrado.split(" ").join("");
  return descifrado;
}

// ============================================================
// op 注册
// ============================================================
register({
  id: "bazeries",
  cat: "classic",
  name: "Bazeries 密码",
  desc: "5×5 方阵替换 + 数字 key 分组反转（key 转英文单词构造密钥矩阵，I/J 合并，古典密码）",
  params: [{ id: "key", label: "数字密钥", type: "text" }],
  encode: bazeriesEncrypt,
  decode: bazeriesDecrypt,
});

export { bazeriesEncrypt, bazeriesDecrypt, num2wordsEn, cleanNumWord,
  buildStdMatrix, buildKeyMatrix, keyToDigitos, separarEnGrupos, ALFABETO };
