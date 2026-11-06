/*
 * lorenz.js — Lorenz SZ40/42a/42b 德国二战十二轮密码附件（cat:'classic'）
 *
 * 5 个 χ 轮 + 5 个 ψ 轮 + 2 个 μ（37/61）马达轮，输出 ITA2 五单位密钥流，
 * 与明文逐位 XOR。支持 SZ40/SZ42a/SZ42b 与 KH/ZMUG/BREAM/自定义凸轮图案。
 *
 * 参考实现：CyberChef src/core/operations/Lorenz.mjs（Apache-2.0，
 * VirtualColossus / gchq CyberChef）；向量见 CyberChef tests/operations/tests/Lorenz.mjs。
 */
import { register } from "./registry.js";

const ITA2_TABLE = {
  A: "11000", B: "10011", C: "01110", D: "10010", E: "10000", F: "10110",
  G: "01011", H: "00101", I: "01100", J: "11010", K: "11110", L: "01001",
  M: "00111", N: "00110", O: "00011", P: "01101", Q: "11101", R: "01010",
  S: "10100", T: "00001", U: "11100", V: "01111", W: "11001", X: "10111",
  Y: "10101", Z: "10001", 3: "00010", 4: "01000", 9: "00100", "/": "00000",
  " ": "00100", ".": "00100", 8: "11111", 5: "11011", "-": "11111", "+": "11011",
};
const REVERSE_ITA2 = {};
for (const [k, v] of Object.entries(ITA2_TABLE)) REVERSE_ITA2[v] = k;

const VALID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890+-'()/:=?,. \n\r";
const VALID_ITA2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ34589+-./";
const FIG_SHIFTED = "1234567890+-'()/:=?,.";
const FIG_SHIFT = {
  1: "Q", 2: "W", 3: "E", 4: "R", 5: "T", 6: "Y", 7: "U", 8: "I", 9: "O", 0: "P",
  " ": "9", "-": "A", "?": "B", ":": "C", "#": "D", "%": "F", "@": "G", "£": "H",
  "": "J", "(": "K", ")": "L", ".": "M", ",": "N", "'": "S", "=": "V", "/": "X",
  "+": "Z", "\n": "3", "\r": "4",
};
const REVERSE_FIG = {};
for (const [k, v] of Object.entries(FIG_SHIFT)) REVERSE_FIG[v] = k;

const PATTERNS = {
  "No Pattern": {
    X: {
      1: ".........................................",
      2: "...............................",
      3: ".............................",
      4: "..........................",
      5: ".......................",
    },
    M: {
      1: ".............................................................",
      2: ".....................................",
    },
    S: {
      1: "...........................................",
      2: "...............................................",
      3: "...................................................",
      4: ".....................................................",
      5: "............................................................",
    },
  },
  "KH Pattern": {
    X: {
      1: ".x...xxx.x.xxxx.x...x.x..xxx....xx.xxxx..",
      2: "x..xxx...x.xxxx..xx..x..xx.xx..",
      3: "..xx..x.xxx...xx...xx..xx.xx.",
      4: "xx..x..xxxx..xx.xxx....x..",
      5: "xx..xx....xxxx.x..x.x..",
    },
    M: {
      1: ".xxxx.xxxx.xxx.xxxx.xx....xxx.xxxx.xxxx.xxxx.xxxx.xxx.xxxx...",
      2: "x.x.x.x.x.x...x.x.x...x.x.x...x.x....",
    },
    S: {
      1: ".x...xx.x.x..xxx.x.x.xxxx.x.x.x.x.x..x.xx.x",
      2: ".xx.x.xxx..x.x.x..x.xx.x.xxx.x....x.xx.x.x.x..x",
      3: ".x.x.x..xxx....x.x.xx.x.x.x..xxx.x.x..x.x.xx..x.x.x",
      4: ".xx...xxxxx.x.x.xx...x.xx.x.x..x.x.xx.x..x.x.x.x.x.x.",
      5: "xx...xx.x..x.xx.x...x.x.x.x.x.x.x.x.xx..xxxx.x.x...xx.x..x.",
    },
  },
  "ZMUG Pattern": {
    X: {
      1: ".xx.xx...xx.xx..x....xxx..xxx....xxx..xx.",
      2: "xx.xx....xxx.xxxx.x...xx..xx...",
      3: "..x..xx...xx...xxx...xx.xxxx.",
      4: "x.x.x..xx...xx..x.xxx..x.x",
      5: ".x..xxxx...x.xxx....x.x",
    },
    M: {
      1: "x.xx.x.xxx.xxx.x.x.xxx.xx.xx.xx.xx.xxx.xxx.xxx.x.x.xxxx.x.x.x",
      2: ".x.x.xx.x.xx.xxx.xxx.xx.x.xxx.xxx.xxx",
    },
    S: {
      1: "xx.x..xx...xxx..xx...xx...xxxx..xxx..xxx...",
      2: "...x...xxx..xx..xxx...xxxx...xx..xxx..xxx..x.xx",
      3: ".x..xx..xxx..xxx..x...xxxx...x...xxx...xx...xx..xxx",
      4: "..xxx..xx..xxx..xxxx...x...xx..xxx..x..xx...xx..xxx.x",
      5: "x..xxx...x...xxxx..xxx..x..xxxx...xx..xxx..xx..xxx..x...xx.",
    },
  },
  "BREAM Pattern": {
    X: {
      1: ".xxxx.x.xx.x.xx..x..xx.x....xx....xxxx...",
      2: ".xxx....x...xx.x.x...xx.xxx..xx",
      3: "xx..xx.xx..xxx....x..xx.xxx..",
      4: "xxxx..x..xx..x..xx.x..xx..",
      5: ".xxx.xxx...x..xx.x...x.",
    },
    M: {
      1: "x....xx...xx..xx.xxxx....xx...xx.xx.x.xxxx...xx..xx..xx.x.xxx",
      2: ".x.x.x.x.x.x.x.xxx.x.x..x.x.x.x.xxx.x",
    },
    S: {
      1: "...xxx..xxx.xx..x.x.xx.xx.x..x..x.x.x.x.x..",
      2: "xx.x..xxx.....xxxx.x..x.xx..xx.x.x.x.x.x.xx.x..",
      3: "x..x..xx.xxx...xxx....xxxx.x.x.xx..x..x.x.x.x.x.x.x",
      4: ".x....x..x.xxxxx.xx..xx..xx....x.xx.x.x.x.x.x.xx..x.x",
      5: "x.x.x..xx..xx.xx..x...x....x.xx.xxxx.xxx..x.x...xx.x.x.x.x.",
    },
  },
};

const ROTOR_SIZES = {
  S1: 43, S2: 47, S3: 51, S4: 53, S5: 59,
  M37: 37, M61: 61,
  X1: 41, X2: 31, X3: 29, X4: 26, X5: 23,
};

const DEFAULT_STARTS = "1 1 1 1 1 1 1 1 1 1 1 1";
const DEFAULT_LUGS = [
  PATTERNS["No Pattern"].S[1], PATTERNS["No Pattern"].S[2], PATTERNS["No Pattern"].S[3],
  PATTERNS["No Pattern"].S[4], PATTERNS["No Pattern"].S[5],
  PATTERNS["No Pattern"].M[2], PATTERNS["No Pattern"].M[1],
  PATTERNS["No Pattern"].X[1], PATTERNS["No Pattern"].X[2], PATTERNS["No Pattern"].X[3],
  PATTERNS["No Pattern"].X[4], PATTERNS["No Pattern"].X[5],
].join("\n");

const toBits = (s) => s.split("").map((c) => (c === "x" || c === "X" ? 1 : 0));

function readLugs(raw, size, name) {
  const s = String(raw == null ? "" : raw).trim();
  if (s.length !== size || !/^[.xX]+$/.test(s)) {
    throw new Error(`${name} 凸轮必须为 ${size} 位，只能包含 . 或 x`);
  }
  return toBits(s);
}

function parseStarts(raw) {
  const parts = String(raw == null ? DEFAULT_STARTS : raw).trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 12) throw new Error(`起始位置需要 12 个数字，当前 ${parts.length} 个`);
  const names = ["Ψ1", "Ψ2", "Ψ3", "Ψ4", "Ψ5", "Μ37", "Μ61", "Χ1", "Χ2", "Χ3", "Χ4", "Χ5"];
  const keys = ["S1", "S2", "S3", "S4", "S5", "M37", "M61", "X1", "X2", "X3", "X4", "X5"];
  const out = {};
  parts.forEach((p, i) => {
    const n = Number(p);
    if (!Number.isInteger(n) || n < 1 || n > ROTOR_SIZES[keys[i]]) {
      throw new Error(`${names[i]} 起始位置必须在 1-${ROTOR_SIZES[keys[i]]}`);
    }
    out[keys[i]] = n;
  });
  return out;
}

function parseCustomLugs(raw) {
  const lines = String(raw == null ? "" : raw).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length !== 12) throw new Error(`自定义凸轮需要 12 行，当前 ${lines.length} 行`);
  const order = [
    ["S", 1, 43], ["S", 2, 47], ["S", 3, 51], ["S", 4, 53], ["S", 5, 59],
    ["M", 2, 37], ["M", 1, 61],
    ["X", 1, 41], ["X", 2, 31], ["X", 3, 29], ["X", 4, 26], ["X", 5, 23],
  ];
  const out = { X: {}, M: {}, S: {} };
  order.forEach(([g, i, size], idx) => {
    out[g][i] = readLugs(lines[idx], size, `${g}${i}`);
  });
  return out;
}

function getPattern(name, custom) {
  if (name === "Custom") return custom;
  if (!PATTERNS[name]) throw new Error(`未知凸轮图案 "${name}"`);
  const p = PATTERNS[name];
  const out = { X: {}, M: {}, S: {} };
  for (const g of ["X", "M", "S"]) {
    for (const [k, v] of Object.entries(p[g])) out[g][k] = toBits(v);
  }
  return out;
}

function convertToITA2(input, intype, mode) {
  let result = "";
  let figShifted = false;
  for (const character of String(input)) {
    const letter = character.toUpperCase();
    if (intype === "ITA2" || mode === "Receive") {
      if (!VALID_ITA2.includes(letter)) throw new Error(`非法 ITA2 字符: ${letter}`);
      result += letter;
    } else {
      if (!VALID_CHARS.includes(letter)) throw new Error(`非法明文字符: ${letter}`);
      if (!figShifted && FIG_SHIFTED.includes(letter)) {
        figShifted = true;
        result += "55" + FIG_SHIFT[letter];
      } else if (figShifted) {
        if (letter === "\n") {
          result += "34";
        } else if (letter === "\r") {
          result += "4";
        } else if (!FIG_SHIFTED.includes(letter)) {
          figShifted = false;
          result += "88" + letter;
        } else {
          result += FIG_SHIFT[letter];
        }
      } else if (letter === "\n") {
        result += "34";
      } else if (letter === "\r") {
        result += "4";
      } else {
        result += letter;
      }
    }
  }
  return result;
}

function convertFromITA2(input, outtype, mode) {
  if (mode !== "Receive" || outtype !== "Plaintext") return input;
  let result = "";
  let figShifted = false;
  for (const letter of input) {
    if (letter === "5" || letter === "+") figShifted = true;
    else if (letter === "8" || letter === "-") figShifted = false;
    else if (letter === "9") result += " ";
    else if (letter === "3") result += "\n";
    else if (letter === "4") result += "";
    else if (letter === "/") result += "/";
    else result += figShifted ? REVERSE_FIG[letter] : letter;
  }
  return result;
}

function lorenzProcess(text, params = {}) {
  const model = String(params.model || "SZ40");
  if (!["SZ40", "SZ42a", "SZ42b"].includes(model)) throw new Error(`未知型号 "${model}"`);
  const patternName = String(params.pattern || "KH Pattern");
  const custom = patternName === "Custom" ? parseCustomLugs(params.customLugs) : null;
  const settings = getPattern(patternName, custom);
  const kt = params.kt === true;
  const mode = String(params.mode || "Send");
  if (!["Send", "Receive"].includes(mode)) throw new Error(`未知模式 "${mode}"`);
  const intype = String(params.inputType || "Plaintext");
  const outtype = String(params.outputType || "Plaintext");
  const format = String(params.ita2Format || "5/8/9");
  const starts = parseStarts(params.starts);

  let {
    S1: s1, S2: s2, S3: s3, S4: s4, S5: s5,
    M37: m37, M61: m61,
    X1: x1, X2: x2, X3: x3, X4: x4, X5: x5,
  } = starts;

  const ita2Input = convertToITA2(text, intype, mode);
  let m61lug = settings.M[1][m61 - 1];
  let m37lug = settings.M[2][m37 - 1];
  const p5 = [0, 0, 0];
  const output = [];

  for (const character of ita2Input) {
    const letter = character.toUpperCase();
    let x2bptr = x2 + 1;
    if (x2bptr === 32) x2bptr = 1;
    let s1bptr = s1 + 1;
    if (s1bptr === 44) s1bptr = 1;

    const chi = [
      settings.X[1][x1 - 1], settings.X[2][x2 - 1], settings.X[3][x3 - 1],
      settings.X[4][x4 - 1], settings.X[5][x5 - 1],
    ];
    const psi = [
      settings.S[1][s1 - 1], settings.S[2][s2 - 1], settings.S[3][s3 - 1],
      settings.S[4][s4 - 1], settings.S[5][s5 - 1],
    ];
    const bits = ITA2_TABLE[letter];
    if (bits === undefined) {
      output.push("");
      continue;
    }

    const xor = [];
    for (let i = 0; i <= 4; i++) xor[i] = Number(bits[i]) ^ psi[i] ^ chi[i];
    const resultStr = xor.join("");

    if (--x1 < 1) x1 = 41;
    if (--x2 < 1) x2 = 31;
    if (--x3 < 1) x3 = 29;
    if (--x4 < 1) x4 = 26;
    if (--x5 < 1) x5 = 23;
    if (--m61 < 1) m61 = 61;
    if (m61lug === 1 && --m37 < 1) m37 = 37;

    const basicmotor = m37lug;
    let totalmotor;
    p5[2] = p5[1];
    p5[1] = p5[0];
    p5[0] = mode === "Send" ? Number(bits[4]) : xor[4];

    if (model === "SZ42a") {
      let lim = settings.X[2][x2bptr - 1];
      if (kt) lim = lim === p5[2] ? 0 : 1;
      totalmotor = basicmotor === 0 && lim === 1 ? 0 : 1;
    } else if (model === "SZ42b") {
      const x2b1 = settings.X[2][x2bptr - 1];
      const s1b1 = settings.S[1][s1bptr - 1];
      let lim = x2b1 === s1b1 ? 0 : 1;
      if (kt) lim = lim === p5[2] ? 0 : 1;
      totalmotor = basicmotor === 0 && lim === 1 ? 0 : 1;
    } else {
      totalmotor = basicmotor;
    }

    if (totalmotor === 1) {
      if (--s1 < 1) s1 = 43;
      if (--s2 < 1) s2 = 47;
      if (--s3 < 1) s3 = 51;
      if (--s4 < 1) s4 = 53;
      if (--s5 < 1) s5 = 59;
    }

    m61lug = settings.M[1][m61 - 1];
    m37lug = settings.M[2][m37 - 1];

    let rtn = REVERSE_ITA2[resultStr];
    if (format === "5/8/9") {
      if (rtn === "+") rtn = "5";
      if (rtn === "-") rtn = "8";
      if (rtn === ".") rtn = "9";
    }
    output.push(rtn);
  }

  return convertFromITA2(output.join(""), outtype, mode);
}

register({
  id: "lorenz",
  cat: "classic",
  name: "Lorenz SZ40/42 密码附件",
  desc: "德国二战 Lorenz SZ40/42a/42b：χ/ψ/μ 十二轮、ITA2 五单位异或、KH/ZMUG/BREAM 图案",
  params: [
    { key: "model", label: "型号", type: "select", default: "SZ40", options: ["SZ40", "SZ42a", "SZ42b"] },
    { key: "pattern", label: "凸轮图案", type: "select", default: "KH Pattern", options: ["KH Pattern", "ZMUG Pattern", "BREAM Pattern", "No Pattern", "Custom"] },
    { key: "kt", label: "KT-Schalter", type: "bool", default: false },
    { key: "inputType", label: "输入类型", type: "select", default: "Plaintext", options: ["Plaintext", "ITA2"] },
    { key: "outputType", label: "输出类型", type: "select", default: "Plaintext", options: ["Plaintext", "ITA2"] },
    { key: "ita2Format", label: "ITA2 格式", type: "select", default: "5/8/9", options: ["5/8/9", "+/-/."] },
    { key: "starts", label: "12 轮起始位置（Ψ1-5, Μ37, Μ61, Χ1-5）", type: "text", default: DEFAULT_STARTS },
    { key: "customLugs", label: "自定义凸轮（12 行，仅 Custom 使用）", type: "text", default: DEFAULT_LUGS },
  ],
  encode: (text, p) => lorenzProcess(text, { ...(p || {}), mode: "Send" }),
  decode: (text, p) => lorenzProcess(text, { ...(p || {}), mode: "Receive" }),
});

export { lorenzProcess };
