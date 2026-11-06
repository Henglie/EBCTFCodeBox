/*
 * typex.js — Typex 英国二战转轮密码机（cat:'classic'）
 *
 * 结构与 Enigma 同源：5 个转轮（右两个固定）+ 反射器插线板 + 输入插线板，
 * 支持 Typex Mark 22 的键盘模拟（数字/符号用 Z/V 前缀转义）。
 *
 * 参考实现：CyberChef src/core/lib/Typex.mjs（Apache-2.0，gchq/CyberChef）
 * 转子默认接线为公开示例（真实 Typex 转子接线未公开），向量见
 * CyberChef tests/operations/tests/Typex.mjs。
 */
import { register } from "./registry.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const REVERSED_ALPHABET = "AZYXWVUTSRQPONMLKJIHGFEDCB";

const DEFAULT_ROTORS = [
  "MCYLPQUVRXGSAOWNBJEZDTFKHI<BFHNQUW|0|B|C",
  "KHWENRCBISXJQGOFMAPVYZDLTU<BFHNQUW|0|D|E",
  "BYPDZMGIKQCUSATREHOJNLFWXV<BFHNQUW|0|F|G",
  "ZANJCGDLVHIXOBRPMSWQUKFYET<BFHNQUW|1|H|I",
  "QXBGUTOVFCZPJIHSWERYNDAMLK<BFHNQUW|1|J|K",
].join("\n");
const DEFAULT_REFLECTOR = "AN BC FG IE KD LU MH OR TS VZ WQ XJ YP";
const DEFAULT_PLUGBOARD = "EHZTLCVKFRPQSYANBUIWOJXGMD";

const KEYBOARD = {
  Q: "1", W: "2", E: "3", R: "4", T: "5", Y: "6", U: "7", I: "8", O: "9", P: "0",
  A: "-", S: "/", D: "Z", F: "%", G: "X", H: "£", K: "(", L: ")",
  C: "V", B: "'", N: ",", M: ".",
};
const KEYBOARD_REV = {};
for (const [k, v] of Object.entries(KEYBOARD)) KEYBOARD_REV[v] = k;

const mod = (n, m) => ((n % m) + m) % m;
const a2i = (c) => {
  const n = String(c).charCodeAt(0) - 65;
  if (n < 0 || n > 25) throw new Error(`需要 A-Z 大写字母，收到 "${c}"`);
  return n;
};
const i2a = (n) => String.fromCharCode(mod(n, 26) + 65);

class Rotor {
  constructor(wiring, steps, ringSetting, initialPosition) {
    if (!/^[A-Z]{26}$/.test(wiring)) throw new Error("转子接线必须是 26 个大写字母");
    if (!/^[A-Z]{0,26}$/.test(steps)) throw new Error("转子步进点必须是 0-26 个大写字母");
    if (!/^[A-Z]$/.test(ringSetting)) throw new Error("转子环设置必须是 1 个大写字母");
    if (!/^[A-Z]$/.test(initialPosition)) throw new Error("转子初始位置必须是 1 个大写字母");

    this.map = new Array(26);
    this.revMap = new Array(26);
    const seen = new Set();
    for (let i = 0; i < 26; i++) {
      const a = a2i(LETTERS[i]);
      const b = a2i(wiring[i]);
      this.map[a] = b;
      this.revMap[b] = a;
      seen.add(b);
    }
    if (seen.size !== 26) throw new Error("转子接线必须每个字母恰好出现一次");

    const rs = a2i(ringSetting);
    this.steps = new Set();
    for (const ch of steps) this.steps.add(mod(a2i(ch) - rs, 26));
    if (this.steps.size !== steps.length) throw new Error("转子步进点不能重复");
    this.pos = mod(a2i(initialPosition) - rs, 26);
  }

  step() {
    this.pos = mod(this.pos + 1, 26);
    return this.pos;
  }

  transform(c) {
    return mod(this.map[mod(c + this.pos, 26)] - this.pos, 26);
  }

  revTransform(c) {
    return mod(this.revMap[mod(c + this.pos, 26)] - this.pos, 26);
  }
}

function parsePairs(pairs, name, requireAll) {
  const map = {};
  if (pairs !== "") {
    for (const pair of String(pairs).trim().split(/\s+/)) {
      if (!/^[A-Z]{2}$/.test(pair)) throw new Error(`${name} 必须是空格分隔的大写字母对`);
      const a = a2i(pair[0]);
      const b = a2i(pair[1]);
      if (a === b) continue;
      if (Object.prototype.hasOwnProperty.call(map, a)) throw new Error(`${name} 中 ${pair[0]} 重复连接`);
      if (Object.prototype.hasOwnProperty.call(map, b)) throw new Error(`${name} 中 ${pair[1]} 重复连接`);
      map[a] = b;
      map[b] = a;
    }
  }
  if (requireAll && Object.keys(map).length !== 26) {
    throw new Error(`${name} 必须用 13 对覆盖全部 26 个字母`);
  }
  return map;
}

function reflectorTransform(map, c) {
  return map[c];
}

class TypexMachine {
  constructor(rotors, reflector, plugboard, keyboard) {
    this.rotors = rotors;
    this.rotorsRev = [...rotors].reverse();
    this.reflector = reflector;
    this.plugboard = plugboard;
    this.keyboard = keyboard;
  }

  step() {
    const r0 = this.rotors[2];
    const r1 = this.rotors[3];
    r0.step();
    if (r0.steps.has(r0.pos) || r1.steps.has(mod(r1.pos + 1, 26))) {
      r1.step();
      if (r1.steps.has(r1.pos)) this.rotors[4].step();
    }
  }

  crypt(input) {
    let data = input;
    if (this.keyboard === "Encrypt") {
      let out = "";
      let symbolMode = false;
      for (const ch of input) {
        if (ch === " ") {
          out += "X";
        } else if (symbolMode) {
          if (Object.prototype.hasOwnProperty.call(KEYBOARD_REV, ch)) {
            out += KEYBOARD_REV[ch];
          } else {
            symbolMode = false;
            out += "V" + ch;
          }
        } else if (Object.prototype.hasOwnProperty.call(KEYBOARD_REV, ch)) {
          symbolMode = true;
          out += "Z" + KEYBOARD_REV[ch];
        } else {
          out += ch;
        }
      }
      data = out;
    }

    let result = "";
    for (const ch of data) {
      if (!/[A-Za-z]/.test(ch)) {
        result += ch;
        continue;
      }
      let c = a2i(ch.toUpperCase());
      this.step();
      c = this.plugboard.transform(c);
      for (const rotor of this.rotors) c = rotor.transform(c);
      c = reflectorTransform(this.reflector, c);
      for (const rotor of this.rotorsRev) c = rotor.revTransform(c);
      c = this.plugboard.revTransform(c);
      result += i2a(c);
    }

    if (this.keyboard === "Decrypt") {
      let out = "";
      let symbolMode = false;
      for (const ch of result) {
        if (ch === "X") out += " ";
        else if (ch === "V") symbolMode = false;
        else if (ch === "Z") symbolMode = true;
        else if (symbolMode) out += KEYBOARD[ch];
        else out += ch;
      }
      result = out;
    }
    return result;
  }
}

function parseRotorSpec(raw) {
  const lines = String(raw == null ? "" : raw).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length !== 5) throw new Error(`需要 5 行转子配置，当前 ${lines.length} 行`);
  return lines.map((line, idx) => {
    const parts = line.split("|").map((s) => s.trim());
    if (parts.length !== 4) throw new Error(`第 ${idx + 1} 行转子格式应为 接线<步进点|反转|环设置|初始位置`);
    const [spec, revRaw, ring, pos] = parts;
    const [wiring, stepsRaw] = spec.split("<");
    const steps = stepsRaw || "";
    const rev = /^(1|true|yes|是)$/i.test(revRaw);
    let wiringMod = wiring.toUpperCase();
    if (!/^[A-Z]{26}$/.test(wiringMod)) throw new Error(`第 ${idx + 1} 行转子接线必须是 26 个大写字母`);
    if (rev) {
      const outMap = new Array(26);
      for (let i = 0; i < 26; i++) {
        const input = mod(26 - a2i(wiringMod[i]), 26);
        const output = i2a(mod(26 - a2i(LETTERS[i]), 26));
        outMap[input] = output;
      }
      wiringMod = outMap.join("");
    }
    return new Rotor(wiringMod, steps.toUpperCase(), ring.toUpperCase(), pos.toUpperCase());
  });
}

function parsePlugboardWiring(raw) {
  let wiring = String(raw == null ? "" : raw).trim().toUpperCase();
  if (wiring === "") wiring = LETTERS;
  if (!/^[A-Z]{26}$/.test(wiring) || new Set(wiring).size !== 26) {
    throw new Error("输入插线板必须是 26 个互不重复的大写字母");
  }
  const transformed = wiring.replace(/./g, (ch) => REVERSED_ALPHABET[a2i(ch)]);
  return new Rotor(transformed, "", "A", "A");
}

function typexProcess(text, params = {}) {
  const rotate = parseRotorSpec(params.rotors != null ? params.rotors : DEFAULT_ROTORS);
  rotate.reverse();
  const reflector = parsePairs(
    String(params.reflector != null ? params.reflector : DEFAULT_REFLECTOR).trim().toUpperCase(),
    "反射器插线板",
    true
  );
  const plugboard = parsePlugboardWiring(params.plugboard != null ? params.plugboard : DEFAULT_PLUGBOARD);
  const keyboard = String(params.keyboard || "None");
  if (!["None", "Encrypt", "Decrypt"].includes(keyboard)) throw new Error(`未知键盘模式 "${keyboard}"`);

  const strict = params.strict !== false;
  let input = String(text == null ? "" : text);
  if (strict) {
    input = keyboard === "Encrypt"
      ? input.replace(/[^A-Za-z0-9 /%£()',.-]/g, "")
      : input.replace(/[^A-Za-z]/g, "");
  }

  const machine = new TypexMachine(rotate, reflector, plugboard, keyboard);
  let result = machine.crypt(input);
  if (strict && keyboard !== "Decrypt") {
    result = result.replace(/([A-Z]{5})(?!$)/g, "$1 ");
  }
  return result;
}

register({
  id: "typex",
  cat: "classic",
  name: "Typex 英国转轮密码机",
  desc: "二战英国 Typex Mark 22：5 转轮（右两固定）+ 反射器/输入插线板 + 键盘模拟，自反",
  params: [
    {
      key: "rotors",
      label: "5 个转子（每行：接线<步进点|反转|环|初始）",
      type: "text",
      default: DEFAULT_ROTORS,
      placeholder: "MCYLP...<BFHNQUW|0|B|C",
    },
    { key: "reflector", label: "反射器插线板（13 对）", type: "text", default: DEFAULT_REFLECTOR },
    { key: "plugboard", label: "输入插线板（26 字母接线）", type: "text", default: DEFAULT_PLUGBOARD },
    { key: "keyboard", label: "键盘模拟", type: "select", default: "None", options: ["None", "Encrypt", "Decrypt"] },
    { key: "strict", label: "严格输出（去非字母并 5 字分组）", type: "bool", default: true },
  ],
  encode: (text, p) => typexProcess(text, p || {}),
  decode: (text, p) => typexProcess(text, p || {}),
});

export { typexProcess };
