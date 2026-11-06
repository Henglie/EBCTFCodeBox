/*
 * colossus.js — Colossus 计数破译机仿真（Lorenz SZ40/42）
 *
 * 参考实现：CyberChef src/core/operations/Colossus.mjs 与
 * src/core/lib/Colossus.mjs（Apache-2.0，VirtualColossus / Crown Copyright 2019）。
 * 凸轮图案数据与 CyberChef src/core/lib/Lorenz.mjs 一致。
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

const VALID_ITA2 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ34589+-./";

const ROTOR_SIZES = {
  S1: 43, S2: 47, S3: 51, S4: 53, S5: 59,
  M37: 37, M61: 61,
  X1: 41, X2: 31, X3: 29, X4: 26, X5: 23,
};

const PATTERNS = {
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

const PATTERN_NAMES = ["KH Pattern", "ZMUG Pattern", "BREAM Pattern"];
const LIMITATION_OPTIONS = ["None", "Χ2", "Χ2 + P5", "X2 + Ψ1", "X2 + Ψ1 + P5"];
const PROGRAM_OPTIONS = [
  "Letter Count",
  "1+2=. (1+2 Break In, Find X1,X2)",
  "4=5=/1=2 (Given X1,X2 find X4,X5)",
  "/,5,U (Count chars to find X3)",
  "Custom",
];
const PROGRAM_LETTER = "Letter Count";
const PROGRAM_12 = "1+2=. (1+2 Break In, Find X1,X2)";
const PROGRAM_45 = "4=5=/1=2 (Given X1,X2 find X4,X5)";
const PROGRAM_U = "/,5,U (Count chars to find X3)";
const PROGRAM_CUSTOM = "Custom";
const STEP_OPTIONS = ["", "X1", "X2", "X3", "X4", "X5", "M37", "M61", "S1", "S2", "S3", "S4", "S5"];
const ROTOR_KEYS = ["X1", "X2", "X3", "X4", "X5", "M61", "M37", "S1", "S2", "S3", "S4", "S5"];
const STARTS_KEYS = ["S1", "S2", "S3", "S4", "S5", "M37", "M61", "X1", "X2", "X3", "X4", "X5"];
const STARTS_LABELS = ["Ψ1", "Ψ2", "Ψ3", "Ψ4", "Ψ5", "Μ37", "Μ61", "Χ1", "Χ2", "Χ3", "Χ4", "Χ5"];
const DEFAULT_STARTS = "1 1 1 1 1 1 1 1 1 1 1 1";
const MAX_INPUT_LENGTH = 100000;
const MAX_TAPE_STEPS = 20000000;

const RING_CACHE = new Map();

function getRings(patternName) {
  if (!PATTERNS[patternName]) throw new Error(`未知凸轮图案 "${patternName}"`);
  if (RING_CACHE.has(patternName)) return RING_CACHE.get(patternName);
  const source = PATTERNS[patternName];
  const rings = { X: {}, M: {}, S: {} };
  for (const group of ["X", "M", "S"]) {
    for (const [index, bits] of Object.entries(source[group])) {
      rings[group][index] = bits.split("").map((c) => (c === "x" ? 1 : 0)).reverse();
    }
  }
  RING_CACHE.set(patternName, rings);
  return rings;
}

function parseBool(value, name) {
  if (typeof value === "boolean") return value;
  const s = String(value == null ? "" : value).trim().toLowerCase();
  if (s === "1" || s === "true" || s === "x" || s === "yes" || s === "on") return true;
  if (s === "" || s === "0" || s === "false" || s === "." || s === "no" || s === "off") return false;
  throw new Error(`${name} 只能是 true/false 或 1/0`);
}

function parseCounter(value, name) {
  const s = String(value == null ? "" : value).trim();
  if (s === "" || s === "0") return "";
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new Error(`${name} 计数器必须是 1-5 或留空`);
  return String(n);
}

function parseCondition(raw, name) {
  const s = String(raw == null ? "" : raw).trim();
  if (s === "") {
    return { Qswitches: ["", "", "", "", ""], Negate: false, Counter: "" };
  }
  const parts = s.split("|").map((part) => part.trim());
  if (parts.length !== 3) {
    throw new Error(`${name} 格式应为 5位开关|Negate|Counter，例如 .....|0|1`);
  }
  const pattern = parts[0];
  if (pattern.length !== 5) throw new Error(`${name} 开关必须是 5 位（. x -）`);
  const Qswitches = [];
  for (const c of pattern) {
    if (c === "." || c === "0") Qswitches.push(".");
    else if (c === "x" || c === "X" || c === "1") Qswitches.push("x");
    else if (c === "-" || c === "?" || c === "_") Qswitches.push("");
    else throw new Error(`${name} 开关字符 "${c}" 非法，只允许 . x -`);
  }
  return {
    Qswitches,
    Negate: parseBool(parts[1], `${name} Negate`),
    Counter: parseCounter(parts[2], `${name} Counter`),
  };
}

function parseAdditionQ(raw, name) {
  const s = String(raw == null ? "" : raw).trim();
  if (s === "") return [false, false, false, false, false];
  if (s.length !== 5) throw new Error(`${name} 开关必须是 5 位（. x -）`);
  const out = [];
  for (const c of s) {
    if (c === "x" || c === "X" || c === "1") out.push(true);
    else if (c === "." || c === "0" || c === "-" || c === "?" || c === "_") out.push(false);
    else throw new Error(`${name} 开关字符 "${c}" 非法，只允许 . x -`);
  }
  return out;
}

const LIMITATION_NORMALIZED = LIMITATION_OPTIONS.map((s) => s.replace(/X/g, "Χ"));

function getLimitation(name) {
  const text = String(name == null ? "None" : name);
  const normalized = text.replace(/X/g, "Χ");
  if (!LIMITATION_NORMALIZED.includes(normalized)) throw new Error(`未知限制 "${text}"`);
  return {
    X2: normalized.includes("Χ2"),
    S1: normalized.includes("Ψ1"),
    P5: normalized.includes("P5"),
  };
}

function parseStarts(raw) {
  const parts = String(raw == null ? DEFAULT_STARTS : raw).trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 12) throw new Error(`起始位置需要 12 个数字，当前 ${parts.length} 个`);
  const out = {};
  parts.forEach((part, index) => {
    const key = STARTS_KEYS[index];
    const n = Number(part);
    if (!Number.isInteger(n) || n < 1 || n > ROTOR_SIZES[key]) {
      throw new Error(`${STARTS_LABELS[index]} 起始位置必须在 1-${ROTOR_SIZES[key]}`);
    }
    out[key] = n;
  });
  return out;
}

function applyProgram(program, switches) {
  if (!PROGRAM_OPTIONS.includes(program)) throw new Error(`未知预设程序 "${program}"`);
  if (program === PROGRAM_LETTER) {
    switches.condition[0] = { Qswitches: ["", "", "", "", ""], Negate: false, Counter: "1" };
    switches.condition[1].Counter = "";
    switches.condition[2].Counter = "";
    switches.condNegateAll = false;
    switches.addition[0].C1 = false;
  } else if (program === PROGRAM_12) {
    switches.condition[0].Counter = "";
    switches.condition[1].Counter = "";
    switches.condition[2].Counter = "";
    switches.addition[0] = {
      Qswitches: [true, true, false, false, false],
      Equals: ".",
      C1: true,
    };
  } else if (program === PROGRAM_45) {
    switches.condition[0] = {
      Qswitches: [".", ".", "", ".", "."],
      Negate: true,
      Counter: "1",
    };
    switches.condition[1] = {
      Qswitches: ["x", "x", "", "x", "x"],
      Negate: true,
      Counter: "1",
    };
    switches.condition[2].Counter = "";
    switches.condNegateAll = true;
    switches.addition[0].C1 = false;
  } else if (program === PROGRAM_U) {
    switches.condition[0] = {
      Qswitches: [".", ".", ".", ".", "."],
      Negate: false,
      Counter: "1",
    };
    switches.condition[1] = {
      Qswitches: ["x", "x", ".", "x", "x"],
      Negate: false,
      Counter: "2",
    };
    switches.condition[2] = {
      Qswitches: ["x", "x", "x", ".", "."],
      Negate: false,
      Counter: "3",
    };
    switches.condNegateAll = false;
    switches.addition[0].C1 = false;
  }
}

function buildSwitches(params) {
  const addEquals = String(params.addEquals == null ? "" : params.addEquals).trim();
  if (!["", "x", "."].includes(addEquals)) throw new Error(`加法比较值只能是空、x 或 .`);
  const totalMotor = String(params.totalMotor == null ? "" : params.totalMotor).trim();
  if (!["", "x", "."].includes(totalMotor)) throw new Error(`总电机筛选只能是空、x 或 .`);
  const switches = {
    condition: [
      parseCondition(params.cond1, "R1"),
      parseCondition(params.cond2, "R2"),
      parseCondition(params.cond3, "R3"),
    ],
    condNegateAll: parseBool(params.condNegateAll, "Negate All"),
    addition: [{
      Qswitches: parseAdditionQ(params.addQ, "Add-Q"),
      Equals: addEquals,
      C1: parseBool(params.addCounter1, "Add-Counter1"),
    }],
    addNegateAll: parseBool(params.addNegateAll, "Add Negate All"),
    totalMotor,
  };
  applyProgram(String(params.program == null ? PROGRAM_LETTER : params.program), switches);
  return switches;
}

function sameRotorState(rotorPtrs, starts) {
  for (const key of ROTOR_KEYS) {
    if (rotorPtrs[key] !== starts[key]) return false;
  }
  return true;
}

export class ColossusComputer {
  constructor(ciphertext, pattern, qbusin, qbusswitches, control, starts, settotal, limitation) {
    this.rings = getRings(pattern);
    this.ciphertext = ciphertext;
    this.qbusin = qbusin;
    this.qbusswitches = qbusswitches;
    this.control = control;
    this.starts = starts;
    this.settotal = settotal;
    this.limitations = limitation;
    this.allCounters = [0, 0, 0, 0, 0];
    this.Zbits = [0, 0, 0, 0, 0];
    this.ZbitsOneBack = [0, 0, 0, 0, 0];
    this.Qbits = [0, 0, 0, 0, 0];
    this.Xbits = [0, 0, 0, 0, 0];
    this.Xptr = [0, 0, 0, 0, 0];
    this.XbitsOneBack = [0, 0, 0, 0, 0];
    this.Sbits = [0, 0, 0, 0, 0];
    this.Sptr = [0, 0, 0, 0, 0];
    this.SbitsOneBack = [0, 0, 0, 0, 0];
    this.Mptr = [0, 0];
    this.rotorPtrs = {};
    this.totalmotor = 0;
    this.P5Zbit = [0, 0];
  }

  run() {
    const result = { printout: "" };
    this.rotorPtrs = {
      X1: this.starts.X1,
      X2: this.starts.X2,
      X3: this.starts.X3,
      X4: this.starts.X4,
      X5: this.starts.X5,
      M61: this.starts.M61,
      M37: this.starts.M37,
      S1: this.starts.S1,
      S2: this.starts.S2,
      S3: this.starts.S3,
      S4: this.starts.S4,
      S5: this.starts.S5,
    };
    let runcount = 1;
    const fast = this.control.fast;
    const slow = this.control.slow;
    result.printout += fast + " " + slow + "\n";

    do {
      this.allCounters = [0, 0, 0, 0, 0];
      this.ZbitsOneBack = [0, 0, 0, 0, 0];
      this.XbitsOneBack = [0, 0, 0, 0, 0];
      this.runTape();

      let fastRef = "00";
      let slowRef = "00";
      if (fast !== "") fastRef = this.rotorPtrs[fast].toString().padStart(2, "0");
      if (slow !== "") slowRef = this.rotorPtrs[slow].toString().padStart(2, "0");
      let printline = "";
      for (let c = 0; c < 5; c++) {
        if (this.allCounters[c] > this.settotal) {
          printline += String.fromCharCode(c + 97) + this.allCounters[c] + " ";
        }
      }
      if (printline !== "") {
        result.printout += fastRef + " " + slowRef + " : " + printline + "\n";
      }

      if (fast !== "") {
        this.rotorPtrs[fast]++;
        if (this.rotorPtrs[fast] > ROTOR_SIZES[fast]) this.rotorPtrs[fast] = 1;
      }
      if (slow !== "" && this.rotorPtrs[fast] === this.starts[fast]) {
        this.rotorPtrs[slow]++;
        if (this.rotorPtrs[slow] > ROTOR_SIZES[slow]) this.rotorPtrs[slow] = 1;
      }
      runcount++;
    } while (!sameRotorState(this.rotorPtrs, this.starts));

    result.counters = this.allCounters;
    result.runcount = runcount;
    return result;
  }

  runTape() {
    this.Xptr = [this.rotorPtrs.X1, this.rotorPtrs.X2, this.rotorPtrs.X3, this.rotorPtrs.X4, this.rotorPtrs.X5];
    this.Mptr = [this.rotorPtrs.M37, this.rotorPtrs.M61];
    this.Sptr = [this.rotorPtrs.S1, this.rotorPtrs.S2, this.rotorPtrs.S3, this.rotorPtrs.S4, this.rotorPtrs.S5];
    for (let i = 0; i < this.ciphertext.length; i++) {
      const charZin = this.ciphertext.charAt(i);
      this.getQbusInputs(charZin);
      const tmpcnt = this.runQbusProcessingConditional();
      this.runQbusProcessingAddition(tmpcnt);
      this.P5Zbit[1] = this.P5Zbit[0];
      this.P5Zbit[0] = ITA2_TABLE[charZin].split("")[4];
      this.stepThyratrons();
    }
  }

  stepThyratrons() {
    let X2bPtr = this.Xptr[1] - 1;
    if (X2bPtr === 0) X2bPtr = ROTOR_SIZES.X2;
    let S1bPtr = this.Sptr[0] - 1;
    if (S1bPtr === 0) S1bPtr = ROTOR_SIZES.S1;
    let X5bPtr = this.Xptr[4] - 1;
    if (X5bPtr === 0) X5bPtr = ROTOR_SIZES.X5;
    X5bPtr = X5bPtr - 1;
    if (X5bPtr === 0) X5bPtr = ROTOR_SIZES.X5;
    let S5bPtr = this.Sptr[4] - 1;
    if (S5bPtr === 0) S5bPtr = ROTOR_SIZES.S5;
    S5bPtr = S5bPtr - 1;
    if (S5bPtr === 0) S5bPtr = ROTOR_SIZES.S5;

    const x2sw = this.limitations.X2;
    const s1sw = this.limitations.S1;
    const p5sw = this.limitations.P5;

    let lim = 1;
    if (x2sw) lim = this.rings.X[2][X2bPtr - 1];
    if (s1sw) lim = lim ^ this.rings.S[1][S1bPtr - 1];
    if (p5sw) {
      let p5lim = this.P5Zbit[1];
      p5lim = p5lim ^ this.rings.X[5][X5bPtr - 1];
      p5lim = p5lim ^ this.rings.S[5][S5bPtr - 1];
      lim = lim ^ p5lim;
    }

    const basicmotor = this.rings.M[2][this.Mptr[0] - 1];
    this.totalmotor = basicmotor;
    if (x2sw || s1sw) {
      if (basicmotor === 0 && lim === 1) this.totalmotor = 0;
      else this.totalmotor = 1;
    }

    for (let r = 0; r < 5; r++) {
      this.Xptr[r]++;
      if (this.Xptr[r] > ROTOR_SIZES["X" + (r + 1)]) this.Xptr[r] = 1;
    }

    if (this.totalmotor) {
      for (let r = 0; r < 5; r++) {
        this.Sptr[r]++;
        if (this.Sptr[r] > ROTOR_SIZES["S" + (r + 1)]) this.Sptr[r] = 1;
      }
    }

    if (this.rings.M[1][this.Mptr[1] - 1] === 1) this.Mptr[0]++;
    if (this.Mptr[0] > ROTOR_SIZES.M37) this.Mptr[0] = 1;
    this.Mptr[1]++;
    if (this.Mptr[1] > ROTOR_SIZES.M61) this.Mptr[1] = 1;
  }

  getQbusInputs(charZin) {
    this.Zbits = ITA2_TABLE[charZin].split("");
    if (this.qbusin.Z === "Z") {
      this.Qbits = this.Zbits;
    } else if (this.qbusin.Z === "ΔZ") {
      for (let b = 0; b < 5; b++) {
        this.Qbits[b] = this.Zbits[b] ^ this.ZbitsOneBack[b];
      }
    }
    this.ZbitsOneBack = this.Zbits.slice();

    for (let b = 0; b < 5; b++) {
      this.Xbits[b] = this.rings.X[b + 1][this.Xptr[b] - 1];
    }
    if (this.qbusin.Chi !== "") {
      if (this.qbusin.Chi === "Χ") {
        for (let b = 0; b < 5; b++) this.Qbits[b] = this.Qbits[b] ^ this.Xbits[b];
      } else if (this.qbusin.Chi === "ΔΧ") {
        for (let b = 0; b < 5; b++) {
          this.Qbits[b] = this.Qbits[b] ^ this.Xbits[b];
          this.Qbits[b] = this.Qbits[b] ^ this.XbitsOneBack[b];
        }
      }
    }
    this.XbitsOneBack = this.Xbits.slice();

    for (let b = 0; b < 5; b++) {
      this.Sbits[b] = this.rings.S[b + 1][this.Sptr[b] - 1];
    }
    if (this.qbusin.Psi !== "") {
      if (this.qbusin.Psi === "Ψ") {
        for (let b = 0; b < 5; b++) this.Qbits[b] = this.Qbits[b] ^ this.Sbits[b];
      } else if (this.qbusin.Psi === "ΔΨ") {
        for (let b = 0; b < 5; b++) {
          this.Qbits[b] = this.Qbits[b] ^ this.Sbits[b];
          this.Qbits[b] = this.Qbits[b] ^ this.SbitsOneBack[b];
        }
      }
    }
    this.SbitsOneBack = this.Sbits.slice();
  }

  runQbusProcessingConditional() {
    const cnt = [-1, -1, -1, -1, -1];
    const numrows = this.qbusswitches.condition.length;
    for (let r = 0; r < numrows; r++) {
      const row = this.qbusswitches.condition[r];
      if (row.Counter !== "") {
        let result = true;
        const cPnt = Number(row.Counter) - 1;
        const Qswitch = this.readBusSwitches(row.Qswitches);
        for (let s = 0; s < 5; s++) {
          if (Qswitch[s] >= 0 && Qswitch[s] !== Number(this.Qbits[s])) result = false;
        }
        if (row.Negate) result = !result;
        if (cnt[cPnt] === -1) cnt[cPnt] = result;
        else if (!result) cnt[cPnt] = false;
      }
    }
    for (let c = 0; c < 5; c++) {
      if (this.qbusswitches.condNegateAll && cnt[c] !== -1) cnt[c] = !cnt[c];
    }
    return cnt;
  }

  runQbusProcessingAddition(cnt) {
    const row = this.qbusswitches.addition[0];
    const Qswitch = row.Qswitches.slice();
    if (row.C1) {
      let addition = 0;
      for (let s = 0; s < 5; s++) {
        if (Qswitch[s]) addition = addition ^ this.Qbits[s];
      }
      const equals = row.Equals === "" ? -1 : (row.Equals === "." ? 0 : 1);
      if (addition === equals) {
        if (cnt[0] === -1) cnt[0] = true;
      } else {
        cnt[0] = false;
      }
    }
    for (let c = 0; c < 5; c++) {
      if (this.qbusswitches.addNegateAll && cnt[c] !== -1) cnt[c] = !cnt[c];
      if (
        this.qbusswitches.totalMotor === "" ||
        (this.qbusswitches.totalMotor === "x" && this.totalmotor === 0) ||
        (this.qbusswitches.totalMotor === "." && this.totalmotor === 1)
      ) {
        if (cnt[c] === true) this.allCounters[c]++;
      }
    }
  }

  readBusSwitches(row) {
    const output = [-1, -1, -1, -1, -1];
    for (let c = 0; c < 5; c++) {
      if (row[c] === ".") output[c] = 0;
      if (row[c] === "x") output[c] = 1;
    }
    return output;
  }
}

function normalizeChi(value) {
  if (value === "X") return "Χ";
  if (value === "ΔX") return "ΔΧ";
  return value;
}

export function colossusProcess(text, params = {}) {
  const input = String(text == null ? "" : text).toUpperCase();
  if (input.length > MAX_INPUT_LENGTH) {
    throw new Error(`输入长度 ${input.length} 超过上限 ${MAX_INPUT_LENGTH}`);
  }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (!VALID_ITA2.includes(ch)) {
      let shown = ch;
      if (ch === "\n") shown = "换行";
      else if (ch === "\r") shown = "回车";
      else if (ch === " ") shown = "空格";
      throw new Error(`非法 ITA2 字符 "${shown}"（位置 ${i + 1}）`);
    }
  }

  const pattern = String(params.pattern == null ? "KH Pattern" : params.pattern);
  if (!PATTERN_NAMES.includes(pattern)) throw new Error(`未知凸轮图案 "${pattern}"`);
  const qbusZ = String(params.qbusZ == null ? "" : params.qbusZ);
  if (!["", "Z", "ΔZ"].includes(qbusZ)) throw new Error(`QBus Z 只能是空、Z 或 ΔZ`);
  const qbusChi = normalizeChi(String(params.qbusChi == null ? "" : params.qbusChi));
  if (!["", "Χ", "ΔΧ"].includes(qbusChi)) throw new Error(`QBus Χ 只能是空、Χ 或 ΔΧ`);
  const qbusPsi = String(params.qbusPsi == null ? "" : params.qbusPsi);
  if (!["", "Ψ", "ΔΨ"].includes(qbusPsi)) throw new Error(`QBus Ψ 只能是空、Ψ 或 ΔΨ`);

  const limitationName = String(params.limitation == null ? "None" : params.limitation);
  const limitation = getLimitation(limitationName);
  const switches = buildSwitches(params);
  const starts = parseStarts(params.starts);

  const settotalRaw = String(params.setTotal == null ? 0 : params.setTotal).trim();
  if (!/^\d+$/.test(settotalRaw)) throw new Error("Set Total 必须是 0-9999 的整数");
  const settotal = Number(settotalRaw);
  if (!Number.isInteger(settotal) || settotal < 0 || settotal > 9999) {
    throw new Error("Set Total 必须是 0-9999");
  }

  const fast = String(params.fastStep == null ? "" : params.fastStep);
  const slow = String(params.slowStep == null ? "" : params.slowStep);
  if (!STEP_OPTIONS.includes(fast)) throw new Error(`Fast Step "${fast}" 非法`);
  if (!STEP_OPTIONS.includes(slow)) throw new Error(`Slow Step "${slow}" 非法`);
  if (fast !== "" && slow !== "" && fast === slow) {
    throw new Error("Fast Step 与 Slow Step 不能是同一个轮");
  }

  let passes = 1;
  if (fast !== "" && slow !== "") passes = ROTOR_SIZES[fast] * ROTOR_SIZES[slow];
  else if (fast !== "") passes = ROTOR_SIZES[fast];
  else if (slow !== "") passes = ROTOR_SIZES[slow];
  const estimatedSteps = input.length * passes;
  if (estimatedSteps > MAX_TAPE_STEPS) {
    throw new Error(`预计卷带步数 ${estimatedSteps} 超过上限 ${MAX_TAPE_STEPS}，请缩短输入或调整 Fast/Slow Step`);
  }

  const machine = new ColossusComputer(
    input,
    pattern,
    { Z: qbusZ, Chi: qbusChi, Psi: qbusPsi },
    switches,
    { fast, slow },
    starts,
    settotal,
    limitation,
  );
  return machine.run();
}

export function formatColossusResult(result) {
  const printer = result.printout.endsWith("\n")
    ? result.printout.slice(0, -1)
    : result.printout;
  const counters = result.counters.map((value, index) => `C${index + 1}=${value}`).join(" ");
  return `Colossus Printer\n${printer}\n\nColossus Counters\n${counters}\nRuns=${result.runcount}`;
}

register({
  id: "colossus",
  cat: "classic",
  name: "Colossus 计数破译机",
  desc: "英国二战 Colossus 对 Lorenz SZ40/42 密文的计数/破译仿真：KH/ZMUG/BREAM、QBus、限制、4 个预设程序与自定义开关",
  params: [
    { key: "pattern", label: "凸轮图案", type: "select", default: "KH Pattern", options: PATTERN_NAMES },
    { key: "qbusZ", label: "QBus Z（空/Z/ΔZ）", type: "select", default: "Z", options: ["", "Z", "ΔZ"] },
    { key: "qbusChi", label: "QBus Χ（空/Χ/ΔΧ）", type: "select", default: "", options: ["", "Χ", "ΔΧ"] },
    { key: "qbusPsi", label: "QBus Ψ（空/Ψ/ΔΨ）", type: "select", default: "", options: ["", "Ψ", "ΔΨ"] },
    { key: "limitation", label: "Limitation", type: "select", default: "None", options: LIMITATION_OPTIONS },
    { key: "program", label: "预设程序", type: "select", default: "Letter Count", options: PROGRAM_OPTIONS },
    { key: "cond1", label: "条件行 R1（开关|Negate|Counter）", type: "text", default: "", placeholder: ".....|0|1" },
    { key: "cond2", label: "条件行 R2（开关|Negate|Counter）", type: "text", default: "", placeholder: "xx.xx|0|2" },
    { key: "cond3", label: "条件行 R3（开关|Negate|Counter）", type: "text", default: "", placeholder: "xxx..|0|3" },
    { key: "condNegateAll", label: "条件区 Negate All", type: "bool", default: false },
    { key: "addQ", label: "加法开关 Q1-Q5（. x -）", type: "text", default: "-----", placeholder: "xx---" },
    { key: "addEquals", label: "加法比较值（空/x/.）", type: "select", default: "", options: ["", ".", "x"] },
    { key: "addCounter1", label: "加法结果入 C1", type: "bool", default: false },
    { key: "addNegateAll", label: "加法区 Negate All", type: "bool", default: false },
    { key: "totalMotor", label: "总电机筛选（空/x/.）", type: "select", default: "", options: ["", "x", "."] },
    { key: "setTotal", label: "Set Total（只打印大于该值）", type: "number", default: 0 },
    { key: "fastStep", label: "Fast Step", type: "select", default: "", options: STEP_OPTIONS },
    { key: "slowStep", label: "Slow Step", type: "select", default: "", options: STEP_OPTIONS },
    { key: "starts", label: "12 轮起始位置（Ψ1-5, Μ37, Μ61, Χ1-5）", type: "text", default: DEFAULT_STARTS },
  ],
  run: (text, p) => formatColossusResult(colossusProcess(text, p || {})),
});

export { PATTERNS, ROTOR_SIZES, LIMITATION_OPTIONS, PROGRAM_OPTIONS };
