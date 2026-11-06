/*
 * sigaba.js — SIGABA / ECM Mark II 美国二战转轮密码机（cat:'classic'）
 *
 * 15 个转轮：5 个密码轮 + 5 个控制轮 + 5 个索引轮；控制轮经索引轮决定
 * 密码轮的步进，因此加密与解密不是同一操作。
 *
 * 参考实现：CyberChef src/core/lib/SIGABA.mjs（Apache-2.0，gchq/CyberChef），
 * 转子接线为公开示例；向量见 CyberChef tests/operations/tests/SIGABA.mjs。
 */
import { register } from "./registry.js";

const DEFAULT_CIPHER = [
  "BHKWECJDOVAYLFMITUGXRNSPZQ|1|G",
  "CDTAKGQOZXLVJYHSWMIBPRUNEF|0|L",
  "WAXHJZMBVDPOLTUYRCQFNSGKEI|0|I",
  "HUSCWIMJQXDALVGBFTOYZKRPNE|0|T",
  "RTLSMNKXFVWQUZGCHEJBYDAIPO|0|B",
].join("\n");
const DEFAULT_CONTROL = [
  "GHAQBRJWDMNZTSKLOUXYPFIECV|0|N",
  "VFLGEMTCXZIQDYAKRPBONHWSUJ|1|Q",
  "ZQCAYHRJNXPFLKIOTBUSVWMGDE|0|B",
  "EZVSWPCTULGAOFDJNBIYMXKQHR|0|J",
  "ELKSGDXMVYJUZNCAROQBPWHITF|0|R",
].join("\n");
const DEFAULT_INDEX = [
  "3891625740|3",
  "6297135408|1",
  "2389715064|8",
  "9264351708|6",
  "9573086142|6",
].join("\n");

const mod = (n, m) => ((n % m) + m) % m;

class Rotor {
  constructor(wireSetting, key, rev) {
    this.state = key;
    this.numMapping = this.buildNumMapping(wireSetting, rev);
    this.posMapping = this.buildPosMapping(rev);
  }

  buildNumMapping(wireSetting, rev) {
    if (!rev) return wireSetting.slice();
    const out = new Array(wireSetting.length);
    for (let i = 0; i < wireSetting.length; i++) out[wireSetting[i]] = i;
    return out;
  }

  buildPosMapping(rev) {
    const length = this.numMapping.length;
    const out = [];
    if (!rev) {
      for (let i = this.state; i < this.state + length; i++) out.push(mod(i, length));
    } else {
      for (let i = this.state; i > this.state - length; i--) out.push(mod(i, length));
    }
    return out;
  }

  cryptNum(inputPos, direction) {
    const inp = this.posMapping[inputPos];
    const out = direction === "leftToRight" ? this.numMapping[inp] : this.numMapping.indexOf(inp);
    return this.posMapping.indexOf(out);
  }

  step() {
    this.posMapping.unshift(this.posMapping.pop());
    this.state = this.posMapping[0];
  }
}

class CRRotor extends Rotor {
  constructor(wiring, key, rev) {
    if (!/^[A-Z]{26}$/.test(wiring)) throw new Error("密码轮/控制轮接线必须是 26 个大写字母");
    if (new Set(wiring).size !== 26) throw new Error("密码轮/控制轮接线每个字母只能出现一次");
    if (!/^[A-Z]$/.test(key)) throw new Error("转子初始位置必须是 1 个大写字母");
    super(wiring.split("").map((c) => c.charCodeAt(0) - 65), key.charCodeAt(0) - 65, rev);
  }

  crypt(input, direction) {
    const n = String(input).charCodeAt(0) - 65;
    return String.fromCharCode(this.cryptNum(n, direction) + 65);
  }
}

class IRotor extends Rotor {
  constructor(wiring, key) {
    if (!/^[0-9]{10}$/.test(wiring) || new Set(wiring).size !== 10) {
      throw new Error("索引轮接线必须是 0-9 的 10 位不重复数字");
    }
    const k = Number(key);
    if (!Number.isInteger(k) || k < 0 || k > 9) throw new Error("索引轮初始值必须是 0-9");
    super(wiring.split("").map(Number), k, false);
  }

  crypt(input) {
    return this.cryptNum(Number(input), "leftToRight");
  }
}

class CipherBank {
  constructor(rotors) {
    this.rotors = rotors;
  }

  encrypt(input) {
    let c = input;
    for (const rotor of this.rotors) c = rotor.crypt(c, "leftToRight");
    return c;
  }

  decrypt(input) {
    let c = input;
    for (const rotor of [...this.rotors].reverse()) c = rotor.crypt(c, "rightToLeft");
    return c;
  }

  step(indexInputs) {
    const logic = { 0: [0, 9], 1: [7, 8], 2: [5, 6], 3: [3, 4], 4: [1, 2] };
    for (let key = 0; key < 5; key++) {
      const item = logic[key];
      if (indexInputs.some((x) => item.includes(x))) this.rotors[key].step();
    }
  }
}

class ControlBank {
  constructor(rotors) {
    this.rotors = [...rotors].reverse();
  }

  crypt(input) {
    let c = input;
    for (const rotor of this.rotors) c = rotor.crypt(c, "rightToLeft");
    return c;
  }

  getOutputs() {
    const outputs = [this.crypt("F"), this.crypt("G"), this.crypt("H"), this.crypt("I")];
    const logic = {
      1: "B", 2: "C", 3: "DE", 4: "FGH", 5: "IJK",
      6: "LMNO", 7: "PQRST", 8: "UVWXYZ", 9: "A",
    };
    const nums = [];
    for (let key = 1; key <= 9; key++) {
      for (const out of outputs) {
        if (logic[key].includes(out)) {
          nums.push(key);
          break;
        }
      }
    }
    return nums;
  }

  step() {
    const middle = this.rotors[1];
    const fast = this.rotors[2];
    const slow = this.rotors[3];
    if (fast.state === 14) {
      if (middle.state === 14) slow.step();
      middle.step();
    }
    fast.step();
  }

  goThroughControl() {
    const outputs = this.getOutputs();
    this.step();
    return outputs;
  }
}

class IndexBank {
  constructor(rotors) {
    this.rotors = rotors;
  }

  crypt(input) {
    let c = input;
    for (const rotor of this.rotors) c = rotor.crypt(c);
    return c;
  }

  goThroughIndex(inputs) {
    return inputs.map((x) => this.crypt(x));
  }
}

class SigabaMachine {
  constructor(cipher, control, index) {
    this.cipherBank = new CipherBank(cipher);
    this.controlBank = new ControlBank(control);
    this.indexBank = new IndexBank(index);
  }

  step() {
    const controlOut = this.controlBank.goThroughControl();
    const indexOut = this.indexBank.goThroughIndex(controlOut);
    this.cipherBank.step(indexOut);
  }

  encryptLetter(letter) {
    let ch = String(letter).toUpperCase();
    if (ch === " ") ch = "Z";
    else if (ch === "Z") ch = "X";
    const out = this.cipherBank.encrypt(ch);
    this.step();
    return out;
  }

  decryptLetter(letter) {
    const ch = String(letter).toUpperCase();
    let out = this.cipherBank.decrypt(ch);
    if (out === "Z") out = " ";
    this.step();
    return out;
  }

  encrypt(text) {
    let out = "";
    for (const ch of text) out += this.encryptLetter(ch);
    return out;
  }

  decrypt(text) {
    let out = "";
    for (const ch of text) {
      if (!/[A-Z]/.test(ch.toUpperCase())) continue;
      out += this.decryptLetter(ch);
    }
    return out;
  }
}

function parseBank(raw, label, withRev) {
  const lines = String(raw == null ? "" : raw).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length !== 5) throw new Error(`${label}需要 5 行，当前 ${lines.length} 行`);
  return lines.map((line, idx) => {
    const parts = line.split("|").map((s) => s.trim());
    if (withRev) {
      if (parts.length !== 3) throw new Error(`${label}第 ${idx + 1} 行格式应为 接线|反转|初始`);
      const rev = /^(1|true|yes|是)$/i.test(parts[1]);
      return new CRRotor(parts[0].toUpperCase(), parts[2].toUpperCase(), rev);
    }
    if (parts.length !== 2) throw new Error(`${label}第 ${idx + 1} 行格式应为 接线|初始`);
    return new IRotor(parts[0], parts[1]);
  });
}

function sigabaProcess(text, params = {}) {
  const cipher = parseBank(params.cipherRotors != null ? params.cipherRotors : DEFAULT_CIPHER, "密码轮", true);
  const control = parseBank(params.controlRotors != null ? params.controlRotors : DEFAULT_CONTROL, "控制轮", true);
  const index = parseBank(params.indexRotors != null ? params.indexRotors : DEFAULT_INDEX, "索引轮", false);
  const mode = String(params.mode || "Encrypt");
  if (!["Encrypt", "Decrypt"].includes(mode)) throw new Error(`未知模式 "${mode}"`);

  const input = String(text == null ? "" : text).toUpperCase();
  for (const ch of input) {
    if (!/[A-Z ]/.test(ch)) throw new Error(`SIGABA 只接受 A-Z 与空格，收到 "${ch}"`);
  }
  const machine = new SigabaMachine(cipher, control, index);
  return mode === "Encrypt" ? machine.encrypt(input) : machine.decrypt(input);
}

register({
  id: "sigaba",
  cat: "classic",
  name: "SIGABA / ECM Mark II 密码机",
  desc: "美国二战 SIGABA：5 密码轮 + 5 控制轮 + 5 索引轮，15 转轮步进；加密/解密分向",
  params: [
    {
      key: "cipherRotors",
      label: "密码轮（5 行：接线|反转|初始）",
      type: "text",
      default: DEFAULT_CIPHER,
      placeholder: "BHKW...|1|G",
    },
    {
      key: "controlRotors",
      label: "控制轮（5 行：接线|反转|初始）",
      type: "text",
      default: DEFAULT_CONTROL,
      placeholder: "GHAQ...|0|N",
    },
    {
      key: "indexRotors",
      label: "索引轮（5 行：0-9 接线|初始）",
      type: "text",
      default: DEFAULT_INDEX,
      placeholder: "3891625740|3",
    },
  ],
  encode: (text, p) => sigabaProcess(text, { ...(p || {}), mode: "Encrypt" }),
  decode: (text, p) => sigabaProcess(text, { ...(p || {}), mode: "Decrypt" }),
});

export { sigabaProcess };
