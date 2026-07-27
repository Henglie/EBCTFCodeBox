/*
 * enigma.js — Enigma 恩尼格玛机（cat:'classic'）。
 *
 * 实现标准德军 Enigma I（三转子）:
 * - 转子 I-V（可选，接线表照 Wikipedia "Enigma rotor details" 权威照抄）
 * - 反射器 UKW-B / UKW-C（接线表权威照抄）
 * - 环设置 Ringstellung（每转子一个，A-Z 或 1-26）
 * - 初始位置 Grundstellung（每转子一个，A-Z 或 1-26）
 * - 插线板 Steckerbrett（成对字母互换，如 "AB CD EF"）
 * - 双步进（double-stepping）机械行为忠实复刻
 *
 * 自反性：Enigma 结构自反（同一配置 encode == decode）。故 encode/decode 共用 process。
 *
 * 权威来源（转子接线 + notch 照抄不编造）:
 * Wikipedia "Enigma rotor details"（https://en.wikipedia.org/wiki/Enigma_rotor_details）
 * Rotor | Wiring(ABCDEFGHIJKLMNOPQRSTUVWXYZ→) | Turnover(窗口字母)
 * I EKMFLGDQVZNTOWYHXUSPAIBRCJ Q
 * II AJDKSIRUXBLHWTMCQGZNPYFVOE E
 * III BDFHJLCPRTXVZNYEIWGAKMUSQO V
 * IV ESOVPZJAYQUIRHXLNFTGKDCMWB J
 * V VZBRGITYUPSDNHLXAWMJQOFECK Z
 * UKW-B YRUHQSLDPXNGOKMIEBFZCWVJAT
 * UKW-C FVPJIAOYEDRZXWGCTKUQSBNMHL
 *
 * 纯前端零外发；单向依赖（仅 import registry.js）。
 *
 * 契约：register({id:"enigma", cat:"classic", name, desc, params, encode, decode})。
 * params: rotors / reflector / ring / position / plugboard
 * encode(text, p) / decode(text, p) → 密文/明文（自反，二者同逻辑）
 */
import { register } from "./registry.js";

const A = 65; // 'A' 码点

// ============================================================
// 转子接线表 + turnover（照 Wikipedia 逐字照抄）
// wiring: A..Z 每格右侧输入→左侧输出的字母；turnover: 窗口显示该字母时
// 本转子步进会带动左邻转子步进（notch 咬合位）。
// ============================================================
const ROTORS = {
  I:   { wiring: "EKMFLGDQVZNTOWYHXUSPAIBRCJ", turnover: "Q" },
  II:  { wiring: "AJDKSIRUXBLHWTMCQGZNPYFVOE", turnover: "E" },
  III: { wiring: "BDFHJLCPRTXVZNYEIWGAKMUSQO", turnover: "V" },
  IV:  { wiring: "ESOVPZJAYQUIRHXLNFTGKDCMWB", turnover: "J" },
  V:   { wiring: "VZBRGITYUPSDNHLXAWMJQOFECK", turnover: "Z" },
};

const REFLECTORS = {
  B: "YRUHQSLDPXNGOKMIEBFZCWVJAT",
  C: "FVPJIAOYEDRZXWGCTKUQSBNMHL",
};

// ============================================================
// 预计算：字符串接线 → 数字置换表（0..25）+ 逆表
// ============================================================
function wiringToArr(str) {
  const fwd = new Array(26);
  const inv = new Array(26);
  for (let i = 0; i < 26; i++) {
    const o = str.charCodeAt(i) - A;
    fwd[i] = o;
    inv[o] = i;
  }
  return { fwd, inv };
}

const ROTOR_ARR = {};
for (const [k, v] of Object.entries(ROTORS)) {
  ROTOR_ARR[k] = { ...wiringToArr(v.wiring), turnover: v.turnover.charCodeAt(0) - A };
}
const REFLECTOR_ARR = {};
for (const [k, v] of Object.entries(REFLECTORS)) REFLECTOR_ARR[k] = wiringToArr(v).fwd;

// ============================================================
// 参数解析
// ============================================================
// 转子选择："I II III" 或 "I,II,III"（左→右），须恰好 3 个且属 I-V。
function parseRotors(str) {
  const parts = String(str || "I II III").trim().toUpperCase().split(/[\s,]+/).filter(Boolean);
  if (parts.length !== 3) throw new Error(`Enigma 需恰好 3 个转子，收到 ${parts.length} 个: "${str}"`);
  for (const p of parts) {
    if (!ROTOR_ARR[p]) throw new Error(`未知转子 "${p}"（可选 I/II/III/IV/V）`);
  }
  return parts;
}

// 环设置 / 初始位置："ABC" 或 "1 2 3"（1=A..26=Z），左→右，恰好 3 个。
function parseSetting(str, label) {
  const s = String(str == null ? "" : str).trim().toUpperCase();
  if (!s) return [0, 0, 0];
  let out;
  if (/\d/.test(s)) {
 // 数字模式：空格/逗号分隔，1-based
    const parts = s.split(/[\s,]+/).filter(Boolean);
    out = parts.map((p) => {
      const n = parseInt(p, 10);
      if (isNaN(n) || n < 1 || n > 26) throw new Error(`${label} 数值须 1-26，收到 "${p}"`);
      return n - 1;
    });
  } else {
 // 字母模式：连写或分隔均可
    const letters = s.replace(/[\s,]+/g, "").split("");
    out = letters.map((c) => {
      const v = c.charCodeAt(0) - A;
      if (v < 0 || v > 25) throw new Error(`${label} 须为 A-Z 字母，收到 "${c}"`);
      return v;
    });
  }
  if (out.length !== 3) throw new Error(`${label} 需恰好 3 个（对应 3 个转子），收到 ${out.length} 个: "${str}"`);
  return out;
}

// 插线板："AB CD EF"（成对互换），返回 0..25 映射表；无配对的字母映射到自身。
function parsePlugboard(str) {
  const map = new Array(26);
  for (let i = 0; i < 26; i++) map[i] = i;
  const s = String(str || "").trim().toUpperCase();
  if (!s) return map;
  const pairs = s.split(/[\s,]+/).filter(Boolean);
  const used = new Set();
  for (const pr of pairs) {
    if (pr.length !== 2) throw new Error(`插线板配对须为 2 字母一组，收到 "${pr}"`);
    const a = pr.charCodeAt(0) - A;
    const b = pr.charCodeAt(1) - A;
    if (a < 0 || a > 25 || b < 0 || b > 25) throw new Error(`插线板仅支持 A-Z，收到 "${pr}"`);
    if (a === b) throw new Error(`插线板不能把字母连到自身: "${pr}"`);
    if (used.has(a) || used.has(b)) throw new Error(`插线板字母重复连接: "${pr}"`);
    used.add(a); used.add(b);
    map[a] = b;
    map[b] = a;
  }
  return map;
}

// ============================================================
// 核心处理（自反：encode/decode 共用）
// ============================================================
function enigmaProcess(text, params = {}) {
  const rotorIds = parseRotors(params.rotors);
  const reflId = String(params.reflector || "B").trim().toUpperCase();
  if (!REFLECTOR_ARR[reflId]) throw new Error(`未知反射器 "${reflId}"（可选 B/C）`);
  const rings = parseSetting(params.ring, "环设置");
  const positions = parseSetting(params.position, "初始位置");
  const plug = parsePlugboard(params.plugboard);

  const refl = REFLECTOR_ARR[reflId];
 // 三个转子：索引 0=左, 1=中, 2=右（右转子每字符必步进）
  const rot = rotorIds.map((id, i) => ({
    fwd: ROTOR_ARR[id].fwd,
    inv: ROTOR_ARR[id].inv,
    turnover: ROTOR_ARR[id].turnover,
    ring: rings[i],
    pos: positions[i],
  }));
  const L = rot[0], M = rot[1], R = rot[2];

 // 单转子正向（右→左，朝反射器）
  function fwdThrough(r, c) {
    const shift = ((r.pos - r.ring) % 26 + 26) % 26;
    const inC = (c + shift) % 26;
    const outC = r.fwd[inC];
    return ((outC - shift) % 26 + 26) % 26;
  }
 // 单转子反向（左→右，离开反射器）
  function bwdThrough(r, c) {
    const shift = ((r.pos - r.ring) % 26 + 26) % 26;
    const inC = (c + shift) % 26;
    const outC = r.inv[inC];
    return ((outC - shift) % 26 + 26) % 26;
  }

  const out = [];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
 // 仅字母进机器；其余原样透传（保持自反 + 实用）
    let up;
    if (code >= 65 && code <= 90) up = code - A;
    else if (code >= 97 && code <= 122) up = code - 97;
    else { out.push(ch); continue; }

 // ---- 步进（先步进后加密，忠实机械行为，含双步进）----
    const middleAtNotch = M.pos === M.turnover;
    const rightAtNotch = R.pos === R.turnover;
    if (middleAtNotch) {          // 双步进：中在 notch → 中、左同步进
      M.pos = (M.pos + 1) % 26;
      L.pos = (L.pos + 1) % 26;
    } else if (rightAtNotch) {    // 右在 notch → 带动中步进
      M.pos = (M.pos + 1) % 26;
    }
    R.pos = (R.pos + 1) % 26;     // 右转子每次必步进

 // ---- 加密路径 ----
    let c = up;
    c = plug[c];                  // 插线板入
    c = fwdThrough(R, c);         // 右→中→左（朝反射器）
    c = fwdThrough(M, c);
    c = fwdThrough(L, c);
    c = refl[c];                  // 反射器
    c = bwdThrough(L, c);         // 左→中→右（离开反射器）
    c = bwdThrough(M, c);
    c = bwdThrough(R, c);
    c = plug[c];                  // 插线板出

    out.push(String.fromCharCode(c + A)); // Enigma 输出恒为大写
  }
  return out.join("");
}

// ============================================================
// 注册（encode == decode，自反）
// ============================================================
register({
  id: "enigma",
  cat: "classic",
  name: "Enigma 恩尼格玛机",
  desc: "德军 Enigma I 三转子密码机（转子 I-V + 反射器 B/C + 环设置 + 插线板，自反）",
  params: [
    { key: "rotors", label: "转子（左→右）", type: "text", default: "I II III", placeholder: "如 I II III（可选 I-V）" },
    { key: "reflector", label: "反射器", type: "select", default: "B", options: ["B", "C"] },
    { key: "ring", label: "环设置 Ringstellung", type: "text", default: "AAA", placeholder: "如 AAA 或 1 1 1" },
    { key: "position", label: "初始位置", type: "text", default: "AAA", placeholder: "如 AAA 或 1 1 1" },
    { key: "plugboard", label: "插线板 Steckerbrett", type: "text", default: "", placeholder: "如 AB CD EF（可空）" },
  ],
  encode: (text, p) => enigmaProcess(text, p || {}),
  decode: (text, p) => enigmaProcess(text, p || {}),
});

export { enigmaProcess };
