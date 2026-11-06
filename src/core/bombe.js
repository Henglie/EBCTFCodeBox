/*
 * Bombe candidate module (T762 C group).
 * Algorithm derived from CyberChef lib/Bombe.mjs and lib/Enigma.mjs.
 * CyberChef: Crown Copyright 2019, Apache-2.0.
 */
import { register } from "./registry.js";

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const mod = (n, m = 26) => ((n % m) + m) % m;
const a2i = (c) => c.charCodeAt(0) - 65;
const i2a = (i) => LETTERS.charAt(mod(i, 26));

const ROTOR_ALIASES = {
  I: "EKMFLGDQVZNTOWYHXUSPAIBRCJ",
  II: "AJDKSIRUXBLHWTMCQGZNPYFVOE",
  III: "BDFHJLCPRTXVZNYEIWGAKMUSQO",
  IV: "ESOVPZJAYQUIRHXLNFTGKDCMWB",
  V: "VZBRGITYUPSDNHLXAWMJQOFECK",
  VI: "JPGVOUMFYQBENHZRDKASXLICTW",
  VII: "NZJHGRCXMYSWBOUFAIVLPEKQDT",
  VIII: "FKQHTLXOCBJSPDZRAMEWNIUYGV",
  BETA: "LEYJVCNIXWPBQMDRTAKZGFUHOS",
  GAMMA: "FSOKANUERHMBTIYCWLQPZXVGJD",
};

const REFLECTOR_ALIASES = {
  B: "AY BR CU DH EQ FS GL IP JX KN MO TZ VW",
  C: "AF BV CP DJ EI GO HY KR LZ MX NW TQ SU",
  "B THIN": "AE BN CK DQ FU GY HW IJ LO MP RX SZ TV",
  "C THIN": "AR BD CO EJ FN GT HK IV LM PW QZ SX UY",
};

const DEFAULT_ROTORS = "I\nII\nIII";
const DEFAULT_REFLECTOR = "B";

class Rotor {
  constructor(wiring, ringSetting = "A", initialPosition = "A") {
    if (!/^[A-Z]{26}$/.test(wiring) || new Set(wiring).size !== 26) {
      throw new Error("Rotor wiring must be 26 unique uppercase letters");
    }
    this.map = new Array(26);
    this.revMap = new Array(26);
    for (let i = 0; i < 26; i++) {
      const b = a2i(wiring.charAt(i));
      this.map[i] = b;
      this.revMap[b] = i;
    }
    const ring = a2i(ringSetting);
    this.pos = mod(a2i(initialPosition) - ring, 26);
  }

  copy() {
    const clone = Object.create(Rotor.prototype);
    clone.map = this.map;
    clone.revMap = this.revMap;
    clone.pos = this.pos;
    return clone;
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

class Plugboard {
  constructor(pairs = "") {
    this.map = new Array(26).fill(-1);
    const s = String(pairs || "").trim().toUpperCase();
    if (!s) return;
    for (const pair of s.split(/\s+/)) {
      if (!/^[A-Z]{2}$/.test(pair)) {
        throw new Error("Plugboard must be a whitespace-separated list of uppercase letter pairs");
      }
      const a = a2i(pair.charAt(0));
      const b = a2i(pair.charAt(1));
      if (a === b) continue;
      if (this.map[a] !== -1) throw new Error(`Plugboard connects ${pair.charAt(0)} more than once`);
      if (this.map[b] !== -1) throw new Error(`Plugboard connects ${pair.charAt(1)} more than once`);
      this.map[a] = b;
      this.map[b] = a;
    }
  }

  transform(c) {
    const v = this.map[c];
    return v === -1 ? c : v;
  }
}

function parseRotorWiring(line) {
  const raw = String(line == null ? "" : line).trim().toUpperCase();
  if (!raw) throw new Error("Rotor wiring must be 26 unique uppercase letters");
  const wiringPart = raw.split("<", 1)[0];
  const wiring = ROTOR_ALIASES[wiringPart] || wiringPart;
  if (!/^[A-Z]{26}$/.test(wiring) || new Set(wiring).size !== 26) {
    throw new Error("Rotor wiring must be 26 unique uppercase letters");
  }
  return wiring;
}

function parseRotorLines(raw, { min = 3, max = Infinity } = {}) {
  const lines = String(raw == null ? "" : raw)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (lines.length < min) throw new Error(`A minimum of ${min} rotors must be supplied`);
  if (lines.length > max) throw new Error("Enigma must have 3 or 4 rotors");
  return lines.map(parseRotorWiring);
}

function parseReflector(spec) {
  const raw = String(spec == null ? "" : spec).trim().toUpperCase();
  if (!raw) throw new Error("Reflector must have exactly 13 pairs covering every letter");
  const aliased = REFLECTOR_ALIASES[raw] || raw;
  const map = new Array(26).fill(-1);

  if (/^[A-Z]{26}$/.test(aliased) && new Set(aliased).size === 26) {
    for (let i = 0; i < 26; i++) map[i] = a2i(aliased.charAt(i));
    for (let i = 0; i < 26; i++) {
      if (map[map[i]] !== i) throw new Error("Reflector wiring must be a symmetric involution");
    }
    return { map, pairs: reflectPairsToString(map) };
  }

  const pairs = aliased.split(/\s+/).filter(Boolean);
  if (pairs.length !== 13) {
    throw new Error("Reflector must have exactly 13 pairs covering every letter");
  }
  for (const pair of pairs) {
    if (!/^[A-Z]{2}$/.test(pair)) {
      throw new Error("Reflector must be a whitespace-separated list of uppercase letter pairs");
    }
    const a = a2i(pair.charAt(0));
    const b = a2i(pair.charAt(1));
    if (a === b || map[a] !== -1 || map[b] !== -1) {
      throw new Error("Reflector must have exactly 13 pairs covering every letter");
    }
    map[a] = b;
    map[b] = a;
  }
  if (map.some((v) => v === -1)) {
    throw new Error("Reflector must have exactly 13 pairs covering every letter");
  }
  return { map, pairs: reflectPairsToString(map) };
}

function reflectPairsToString(map) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < 26; i++) {
    if (seen.has(i)) continue;
    const j = map[i];
    seen.add(i);
    seen.add(j);
    out.push(i2a(i) + i2a(j));
  }
  return out.join(" ");
}

class Node {
  constructor(letter) {
    this.letter = letter;
    this.edges = new Set();
    this.visited = false;
  }
}

class Edge {
  constructor(pos, node1, node2) {
    this.pos = pos;
    this.node1 = node1;
    this.node2 = node2;
    node1.edges.add(this);
    node2.edges.add(this);
    this.visited = false;
  }

  getOther(node) {
    return this.node1 === node ? this.node2 : this.node1;
  }
}

class SharedScrambler {
  constructor(rotors, reflector) {
    this.lowerCache = new Array(26);
    this.higherCache = new Array(26);
    for (let i = 0; i < 26; i++) this.higherCache[i] = new Array(26);
    this.changeRotors(rotors, reflector);
  }

  changeRotors(rotors, reflector) {
    this.reflector = reflector;
    this.rotors = rotors;
    this.rotorsRev = [].concat(rotors).reverse();
    this.cacheGen();
  }

  step(n) {
    for (let i = 0; i < n - 1; i++) this.rotors[i].step();
    this.cacheGen();
  }

  cacheGen() {
    for (let i = 0; i < 26; i++) {
      this.lowerCache[i] = undefined;
      for (let j = 0; j < 26; j++) this.higherCache[i][j] = undefined;
    }
    for (let i = 0; i < 26; i++) {
      if (this.lowerCache[i] !== undefined) continue;
      let letter = i;
      for (const rotor of this.rotors) letter = rotor.transform(letter);
      letter = this.reflector.map[letter];
      for (const rotor of this.rotorsRev) letter = rotor.revTransform(letter);
      this.lowerCache[i] = letter;
      this.lowerCache[letter] = i;
    }
  }

  transform(i) {
    return this.lowerCache[i];
  }
}

class Scrambler {
  constructor(base, rotor, pos, end1, end2) {
    this.baseScrambler = base;
    this.initialPos = pos;
    this.end1 = end1;
    this.end2 = end2;
    this.setRotor(rotor);
  }

  setRotor(rotor) {
    this.rotor = rotor;
    this.rotor.pos = mod(rotor.pos + this.initialPos, 26);
    this.cache = this.baseScrambler.higherCache[this.rotor.pos];
  }

  step() {
    this.rotor.step();
    this.cache = this.baseScrambler.higherCache[this.rotor.pos];
  }

  transform(i) {
    const cached = this.cache[i];
    if (cached !== undefined) return cached;
    let letter = this.rotor.transform(i);
    letter = this.baseScrambler.transform(letter);
    letter = this.rotor.revTransform(letter);
    this.cache[i] = letter;
    this.cache[letter] = i;
    return letter;
  }

  getOtherEnd(end) {
    return this.end1 === end ? this.end2 : this.end1;
  }

  getPos() {
    let result = i2a(mod(this.rotor.pos - 1, 26));
    for (const rotor of this.baseScrambler.rotors) result += i2a(rotor.pos);
    return result.split("").reverse().join("");
  }
}

class BombeMachine {
  constructor(rotors, reflector, ciphertext, crib, check, update = undefined) {
    if (ciphertext.length < crib.length) throw new Error("Crib overruns supplied ciphertext");
    if (crib.length < 2) throw new Error("Crib is too short");
    if (crib.length > 25) throw new Error("Crib is too long");
    for (let i = 0; i < crib.length; i++) {
      if (ciphertext.charAt(i) === crib.charAt(i)) {
        throw new Error(`Invalid crib: character ${ciphertext.charAt(i)} at pos ${i} in both ciphertext and crib`);
      }
    }

    this.ciphertext = ciphertext;
    this.crib = crib;
    this.reflector = reflector;
    this.check = check;
    this.updateFn = update;
    this.initRotors(rotors);

    const [mostConnected, edges] = this.makeMenu();
    this.wires = new Array(26 * 26);
    this.scramblers = new Array(26);
    for (let i = 0; i < 26; i++) this.scramblers[i] = [];
    this.sharedScrambler = new SharedScrambler(this.baseRotors.slice(1), reflector);
    this.allScramblers = [];
    this.indicator = undefined;

    for (const edge of edges) {
      const cRotor = this.baseRotors[0].copy();
      const end1 = a2i(edge.node1.letter);
      const end2 = a2i(edge.node2.letter);
      const scrambler = new Scrambler(this.sharedScrambler, cRotor, edge.pos, end1, end2);
      if (edge.pos === 0) this.indicator = scrambler;
      this.scramblers[end1].push(scrambler);
      this.scramblers[end2].push(scrambler);
      this.allScramblers.push(scrambler);
    }

    if (this.indicator === undefined) {
      this.indicator = new Scrambler(
        this.sharedScrambler,
        this.baseRotors[0].copy(),
        0,
        undefined,
        undefined
      );
      this.allScramblers.push(this.indicator);
    }

    this.testRegister = a2i(mostConnected.letter);
    this.testInput = [this.testRegister, this.testRegister];
    for (const edge of mostConnected.edges) {
      this.testInput = [this.testRegister, a2i(edge.getOther(mostConnected).letter)];
      break;
    }
  }

  initRotors(rotors) {
    this.baseRotors = rotors.map((rstr) => new Rotor(rstr));
  }

  changeRotors(rotors, reflector) {
    this.reflector = reflector;
    this.initRotors(rotors);
    this.sharedScrambler.changeRotors(this.baseRotors.slice(1), reflector);
    for (const scrambler of this.allScramblers) {
      scrambler.setRotor(this.baseRotors[0].copy());
    }
  }

  update(...msg) {
    if (this.updateFn !== undefined) this.updateFn(...msg);
  }

  dfs(node) {
    let loops = 0;
    let nNodes = 1;
    let mostConnected = node;
    let nConnections = mostConnected.edges.size;
    let edges = new Set();
    node.visited = true;
    for (const edge of node.edges) {
      if (edge.visited) continue;
      edge.visited = true;
      edges.add(edge);
      const other = edge.getOther(node);
      if (other.visited) {
        loops += 1;
        continue;
      }
      const [oLoops, oNNodes, oMostConnected, oNConnections, oEdges] = this.dfs(other);
      loops += oLoops;
      nNodes += oNNodes;
      edges = new Set([...edges, ...oEdges]);
      if (oNConnections > nConnections) {
        mostConnected = oMostConnected;
        nConnections = oNConnections;
      }
    }
    return [loops, nNodes, mostConnected, nConnections, edges];
  }

  makeMenu() {
    const nodes = new Map();
    for (const c of this.ciphertext + this.crib) {
      if (!nodes.has(c)) nodes.set(c, new Node(c));
    }
    for (let i = 0; i < this.crib.length; i++) {
      new Edge(i, nodes.get(this.crib.charAt(i)), nodes.get(this.ciphertext.charAt(i)));
    }
    const graphs = [];
    for (const start of nodes.keys()) {
      if (nodes.get(start).visited) continue;
      graphs.push(this.dfs(nodes.get(start)));
    }
    graphs.sort((a, b) => {
      let result = b[0] - a[0];
      if (result === 0) result = b[1] - a[1];
      return result;
    });
    this.nLoops = graphs[0][0];
    return [graphs[0][2], graphs[0][4]];
  }

  energise(i, j) {
    const idx = 26 * i + j;
    if (this.wires[idx]) return;
    this.wires[idx] = true;
    const idxPair = 26 * j + i;
    this.wires[idxPair] = true;
    if (i === this.testRegister || j === this.testRegister) {
      this.energiseCount++;
      if (this.energiseCount === 26) return;
    }

    for (let k = 0; k < this.scramblers[i].length; k++) {
      const scrambler = this.scramblers[i][k];
      const out = scrambler.transform(j);
      const other = scrambler.getOtherEnd(i);
      const otherIdx = 26 * other + out;
      if (!this.wires[otherIdx]) {
        this.energise(other, out);
        if (this.energiseCount === 26) return;
      }
    }
    if (i === j) return;
    for (let k = 0; k < this.scramblers[j].length; k++) {
      const scrambler = this.scramblers[j][k];
      const out = scrambler.transform(i);
      const other = scrambler.getOtherEnd(j);
      const otherIdx = 26 * other + out;
      if (!this.wires[otherIdx]) {
        this.energise(other, out);
        if (this.energiseCount === 26) return;
      }
    }
  }

  tryDecrypt(stecker) {
    const fastRotor = this.indicator.rotor;
    const initialPos = fastRotor.pos;
    const initialCache = this.indicator.cache;
    const res = [];
    const plugboard = new Plugboard(stecker);
    for (let i = 0; i < Math.min(26, this.ciphertext.length); i++) {
      const t = this.indicator.transform(plugboard.transform(a2i(this.ciphertext.charAt(i))));
      res.push(i2a(plugboard.transform(t)));
      this.indicator.step(1);
    }
    fastRotor.pos = initialPos;
    this.indicator.cache = initialCache;
    return res.join("");
  }

  formatPair(a, b) {
    return a < b ? `${i2a(a)}${i2a(b)}` : `${i2a(b)}${i2a(a)}`;
  }

  checkingMachine(pair) {
    if (pair !== this.testInput[1]) {
      for (let i = 0; i < this.wires.length; i++) this.wires[i] = false;
      this.energiseCount = 0;
      this.energise(this.testRegister, pair);
    }
    const results = new Set();
    results.add(this.formatPair(this.testRegister, pair));
    for (let i = 0; i < 26; i++) {
      let count = 0;
      let other = 0;
      for (let j = 0; j < 26; j++) {
        if (this.wires[i * 26 + j]) {
          count++;
          other = j;
        }
      }
      if (count > 1) return "";
      if (count === 0) continue;
      results.add(this.formatPair(i, other));
    }
    return [...results].join(" ");
  }

  checkStop() {
    const count = this.energiseCount;
    if (count === 26) return undefined;
    let steckerPair;
    if (count === 25) {
      for (let j = 0; j < 26; j++) {
        if (!this.wires[26 * this.testRegister + j]) {
          steckerPair = j;
          break;
        }
      }
    } else if (count === 1) {
      steckerPair = this.testInput[1];
    } else {
      if (!this.check) {
        return [this.indicator.getPos(), "??", this.tryDecrypt("")];
      }
      let stecker;
      for (let i = 0; i < 26; i++) {
        const newStecker = this.checkingMachine(i);
        if (newStecker !== "") {
          if (stecker !== undefined) {
            return [this.indicator.getPos(), "??", this.tryDecrypt("")];
          }
          stecker = newStecker;
        }
      }
      if (stecker === undefined) return undefined;
      return [this.indicator.getPos(), stecker, this.tryDecrypt(stecker)];
    }
    let stecker;
    if (this.check) {
      stecker = this.checkingMachine(steckerPair);
      if (stecker === "") return undefined;
    } else {
      stecker = `${i2a(this.testRegister)}${i2a(steckerPair)}`;
    }
    return [this.indicator.getPos(), stecker, this.tryDecrypt(stecker)];
  }

  run() {
    let stops = 0;
    const result = [];
    const nChecks = Math.pow(26, this.baseRotors.length);
    for (let i = 1; i <= nChecks; i++) {
      for (let w = 0; w < this.wires.length; w++) this.wires[w] = false;
      this.energiseCount = 0;
      this.energise(this.testInput[0], this.testInput[1]);

      const stop = this.checkStop();
      if (stop !== undefined) {
        stops++;
        result.push(stop);
      }

      let n = 1;
      for (let j = 1; j < this.baseRotors.length; j++) {
        if (i % Math.pow(26, j) === 0) n++;
        else break;
      }
      if (n > 1) this.sharedScrambler.step(n);
      for (const scrambler of this.allScramblers) scrambler.step();
      if (n > 3) this.update(this.nLoops, stops, i / nChecks);
    }
    return result;
  }
}

function sanitizeLetters(text) {
  return String(text == null ? "" : text)
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
}

function bombeAttack(text, params = {}) {
  let crib = sanitizeLetters(params.crib);
  const offset = Number(params.offset == null ? 0 : params.offset);
  if (!Number.isInteger(offset) || offset < 0) throw new Error("offset must be a non-negative integer");
  if (crib.length === 0) throw new Error("Crib cannot be empty");

  const ciphertext = sanitizeLetters(text).slice(offset);
  const rotors = parseRotorLines(params.rotors == null ? DEFAULT_ROTORS : params.rotors, {
    min: 3,
    max: 4,
  });
  const reflector = parseReflector(params.reflector == null ? DEFAULT_REFLECTOR : params.reflector);
  const check = params.check !== false;
  const machine = new BombeMachine(
    [].concat(rotors).reverse(),
    reflector,
    ciphertext,
    crib,
    check
  );
  const result = machine.run();
  return {
    nLoops: machine.nLoops,
    rotors: rotors.slice(),
    reflector: reflector.pairs,
    nStops: result.length,
    result,
  };
}

function formatBombeReport(attack) {
  const lines = [];
  lines.push(`Bombe: menu ${attack.nLoops} loop(s), ${attack.nStops} stop(s)`);
  lines.push("Rotor stops\tPartial plugboard\tDecryption preview");
  for (const [setting, stecker, decrypt] of attack.result) {
    lines.push(`${setting}\t${stecker}\t${decrypt}`);
  }
  lines.push("");
  lines.push("Rotor positions are left to right, start at the beginning of the crib, and ignore stepping and ring settings.");
  return lines.join("\n");
}

function bombeProcess(text, params = {}) {
  return formatBombeReport(bombeAttack(text, params));
}

register({
  id: "bombe",
  cat: "crypto",
  name: "Bombe 图灵炸弹机",
  desc: "Enigma 已知明文 crib 攻击（3/4 转子），输出 rotor stops、部分接线板与解密预览",
  params: [
    {
      key: "rotors",
      label: "转子接线（每行一个，左→右，3 或 4 个，<步进会忽略）",
      type: "textarea",
      rows: 4,
      default: DEFAULT_ROTORS,
      placeholder: "I\nII\nIII 或完整 26 字母接线",
    },
    {
      key: "reflector",
      label: "反射器（B/C/B Thin/C Thin 或 13 对字母）",
      type: "text",
      default: DEFAULT_REFLECTOR,
    },
    { key: "crib", label: "已知明文 crib", type: "text", default: "" },
    { key: "offset", label: "crib 在密文中的偏移", type: "number", default: 0 },
    { key: "check", label: "使用 checking machine", type: "bool", default: true },
  ],
  run: (text, p) => bombeProcess(text, p || {}),
});

export {
  BombeMachine,
  Rotor,
  Plugboard,
  parseReflector,
  parseRotorWiring,
  a2i,
  i2a,
  mod,
  bombeAttack,
  bombeProcess,
  formatBombeReport,
};
export default bombeProcess;
