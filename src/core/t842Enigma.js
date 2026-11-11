/*
 * t842Enigma.js — CyberChef Enigma 对齐的候选 op（T842）。
 *
 * 只新增 op enigmaCC，不改既有 enigma（三转子/自反/非字母透传）默认行为。
 * 实现按 CC lib/Enigma.mjs：3/4 转子、I-VIII + Beta/Gamma、B/C/B Thin/C Thin 反射器、
 * 多 notch（VI-VIII 的 AN）、双步进异常、Strict output（去非字母 + 5 字符分组）。
 */
import { register } from "./registry.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const ROTOR_NAMES = {
  I: "EKMFLGDQVZNTOWYHXUSPAIBRCJ<R",
  II: "AJDKSIRUXBLHWTMCQGZNPYFVOE<F",
  III: "BDFHJLCPRTXVZNYEIWGAKMUSQO<W",
  IV: "ESOVPZJAYQUIRHXLNFTGKDCMWB<K",
  V: "VZBRGITYUPSDNHLXAWMJQOFECK<A",
  VI: "JPGVOUMFYQBENHZRDKASXLICTW<AN",
  VII: "NZJHGRCXMYSWBOUFAIVLPEKQDT<AN",
  VIII: "FKQHTLXOCBJSPDZRAMEWNIUYGV<AN",
  Beta: "LEYJVCNIXWPBQMDRTAKZGFUHOS",
  Gamma: "FSOKANUERHMBTIYCWLQPZXVGJD",
};
const REFLECTOR_NAMES = {
  B: "AY BR CU DH EQ FS GL IP JX KN MO TZ VW",
  C: "AF BV CP DJ EI GO HY KR LZ MX NW TQ SU",
  "B Thin": "AE BN CK DQ FU GY HW IJ LO MP RX SZ TV",
  "C Thin": "AR BD CO EJ FN GT HK IV LM PW QZ SX UY",
};
const mod = (n, m) => ((n % m) + m) % m;
function a2i(c) {
  const i = c.charCodeAt(0);
  if (i >= 65 && i <= 90) return i - 65;
  if (i >= 97 && i <= 122) return i - 97;
  return -1;
}
class Rotor {
  constructor(wiring, steps, ring, initial) {
    const spec = String(wiring || "");
    const parts = spec.split("<", 2);
    const wire = parts[0];
    const stepStr = (steps != null && String(steps) !== "") ? String(steps) : (parts[1] || "");
    if (!/^[A-Z]{26}$/.test(wire)) throw new Error("Enigma：转子接线须为 26 个大写字母");
    const uniq = new Set(wire.split(""));
    if (uniq.size !== 26) throw new Error("Enigma：转子接线每个字母必须恰好一次");
    if (!/^[A-Z]*$/.test(stepStr)) throw new Error("Enigma：转子 stepping 须为 0-26 个大写字母");
    const rs = a2i(ring || "A");
    if (rs < 0) throw new Error("Enigma：环设置须为 A-Z");
    this.map = new Array(26);
    this.revMap = new Array(26);
    for (let i = 0; i < 26; i++) {
      const b = a2i(wire[i]);
      this.map[i] = b;
      this.revMap[b] = i;
    }
    this.steps = new Set();
    for (const ch of stepStr) this.steps.add(mod(a2i(ch) - rs, 26));
    this.pos = mod(a2i(initial || "A") - rs, 26);
  }
  step() { this.pos = mod(this.pos + 1, 26); }
  transform(c) { return mod(this.map[mod(c + this.pos, 26)] - this.pos, 26); }
  revTransform(c) { return mod(this.revMap[mod(c + this.pos, 26)] - this.pos, 26); }
}
function pairMap(pairs, name, requireAll) {
  const map = new Array(26).fill(-1);
  const s = String(pairs || "").trim();
  if (s) {
    for (const pr of s.split(/\s+/)) {
      if (!/^[A-Z]{2}$/.test(pr)) throw new Error(name + "：须为空格分隔的大写字母对");
      const a = a2i(pr[0]), b = a2i(pr[1]);
      if (map[a] !== -1 || map[b] !== -1) throw new Error(name + "：字母重复连接 " + pr);
      map[a] = b; map[b] = a;
    }
  }
  if (requireAll) {
    if (map.some((v) => v === -1)) throw new Error(name + "：必须由 13 对覆盖全部字母");
  } else {
    for (let i = 0; i < 26; i++) if (map[i] === -1) map[i] = i;
  }
  return map;
}
function parseRotor(v, label) {
  const s = String(v == null ? "" : v).trim();
  if (!s) throw new Error("Enigma：" + label + " 不能为空");
  if (Object.prototype.hasOwnProperty.call(ROTOR_NAMES, s)) return ROTOR_NAMES[s];
  if (s.includes("<") || /^[A-Z]{26}/.test(s)) return s;
  throw new Error("Enigma：未知转子 " + s);
}
function parseReflector(v) {
  const s = String(v == null ? "" : v).trim();
  if (Object.prototype.hasOwnProperty.call(REFLECTOR_NAMES, s)) return REFLECTOR_NAMES[s];
  if (/^([A-Z]{2}\s+){12}[A-Z]{2}$/.test(s)) return s;
  throw new Error("Enigma：未知反射器 " + s);
}
function enigmaRun(input, p = {}) {
  const model = String(p.model || "3-rotor");
  if (model !== "3-rotor" && model !== "4-rotor") throw new Error("Enigma：Model 仅支持 3-rotor/4-rotor");
  const specs = [p.fourthRotor || "Beta", p.leftRotor || "I", p.middleRotor || "II", p.rightRotor || "III"];
  if (model === "3-rotor") specs.shift();
  const rings = model === "4-rotor"
    ? [p.fourthRing || "A", p.leftRing || "A", p.middleRing || "A", p.rightRing || "A"]
    : [p.leftRing || "A", p.middleRing || "A", p.rightRing || "A"];
  const pos = model === "4-rotor"
    ? [p.fourthPos || "A", p.leftPos || "A", p.middlePos || "A", p.rightPos || "A"]
    : [p.leftPos || "A", p.middlePos || "A", p.rightPos || "A"];
  const built = specs.map((spec, i) => {
    const full = parseRotor(spec, "rotor " + i);
    const [wire, steps = ""] = full.split("<", 2);
    return new Rotor(wire, steps, rings[i], pos[i]);
  });
  built.reverse();
  const reflector = new Reflector(parseReflector(p.reflector || "B"));
  const plugboard = pairMap(p.plugboard || "", "Plugboard", false);
  let text = String(input == null ? "" : input);
  const strict = p.strictOutput !== false;
  if (strict) text = text.replace(/[^A-Za-z]/g, "");
  let out = "";
  for (const ch of text) {
    let c = a2i(ch);
    if (c === -1) { out += ch; continue; }
    stepRotors(built);
    c = plugboard[c];
    for (const r of built) c = r.transform(c);
    c = reflector.transform(c);
    for (let i = built.length - 1; i >= 0; i--) c = built[i].revTransform(c);
    c = plugboard[c];
    out += LETTERS[c];
  }
  if (strict) out = out.replace(/([A-Z]{5})(?!$)/g, "$1 ");
  return out;
}
function stepRotors(rotors) {
  const r0 = rotors[0], r1 = rotors[1];
  r0.step();
  if (r0.steps.has(r0.pos) || r1.steps.has(mod(r1.pos + 1, 26))) {
    r1.step();
    if (r1.steps.has(r1.pos)) rotors[2].step();
  }
}
class Reflector {
  constructor(pairs) {
    const map = pairMap(pairs, "Reflector", true);
    this.map = map;
  }
  transform(c) { return this.map[c]; }
}

register({
  id: "enigmaCC",
  cat: "classic",
  name: "Enigma（CyberChef 对齐）",
  desc: "CC Enigma 对齐：3/4 转子、I-VIII + Beta/Gamma、B/C/B Thin/C Thin、环设置/初始位置/插线板、Strict output（去非字母 + 5 字符分组）。",
  params: [
    { key: "model", label: "型号", labelKey: "op.enigmaCC.param.model", type: "select", default: "3-rotor", options: ["3-rotor", "4-rotor"] },
    { key: "fourthRotor", label: "最左（第 4）转子", labelKey: "op.enigmaCC.param.fourthRotor", type: "text", default: "Beta" },
    { key: "fourthRing", label: "第 4 转子环设置", labelKey: "op.enigmaCC.param.fourthRing", type: "text", default: "A" },
    { key: "fourthPos", label: "第 4 转子初始位置", labelKey: "op.enigmaCC.param.fourthPos", type: "text", default: "A" },
    { key: "leftRotor", label: "左转子", labelKey: "op.enigmaCC.param.leftRotor", type: "text", default: "I" },
    { key: "leftRing", label: "左转子环设置", labelKey: "op.enigmaCC.param.leftRing", type: "text", default: "A" },
    { key: "leftPos", label: "左转子初始位置", labelKey: "op.enigmaCC.param.leftPos", type: "text", default: "A" },
    { key: "middleRotor", label: "中转子", labelKey: "op.enigmaCC.param.middleRotor", type: "text", default: "II" },
    { key: "middleRing", label: "中转子环设置", labelKey: "op.enigmaCC.param.middleRing", type: "text", default: "A" },
    { key: "middlePos", label: "中转子初始位置", labelKey: "op.enigmaCC.param.middlePos", type: "text", default: "A" },
    { key: "rightRotor", label: "右转子", labelKey: "op.enigmaCC.param.rightRotor", type: "text", default: "III" },
    { key: "rightRing", label: "右转子环设置", labelKey: "op.enigmaCC.param.rightRing", type: "text", default: "A" },
    { key: "rightPos", label: "右转子初始位置", labelKey: "op.enigmaCC.param.rightPos", type: "text", default: "A" },
    { key: "reflector", label: "反射器", labelKey: "op.enigmaCC.param.reflector", type: "select", default: "B", options: ["B", "C", "B Thin", "C Thin"] },
    { key: "plugboard", label: "插线板", labelKey: "op.enigmaCC.param.plugboard", type: "text", default: "" },
    { key: "strictOutput", label: "严格输出（去非字母 + 5 字符分组）", labelKey: "op.enigmaCC.param.strictOutput", type: "bool", default: true },
  ],
  encode: (t, p) => enigmaRun(t, p || {}),
  decode: (t, p) => enigmaRun(t, p || {}),
});
export { enigmaRun };
