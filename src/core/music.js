/*
 * music.js — 音乐 / 乐谱编码组（T73，cat:'fancy'）。
 *
 * 覆盖：
 * - 音名（Scientific Pitch Notation）：C4, C#4, Db4, B3, ...
 * - MIDI 音符号：0-127，C4=60
 * - 简谱（Numbered Musical Notation）：1-7，带八度点（' 高 / , 低）
 * - 唱名（Solfège，首调）：do re mi fa sol la si
 * - 四种格式多向互转 + 频率换算（A4=440Hz，十二平均律）
 *
 * 算法标准：
 * - MIDI = (octave + 1) * 12 + semitone；C4=60，A4=69。
 * - 十二平均律频率：f = 440 * 2^((midi - 69) / 12)。
 * - 简谱 1-7 对应大调音阶（首调唱名法）：do=1, re=2, mi=3, fa=4, sol=5, la=6, si=7。
 * - 调号决定 1 的音高：C 调 1=C4=60，G 调 1=G4=67，...
 *
 * 红线：
 * - 调号音阶表照抄乐理标准（十二平均律大调音阶），不编造。
 * - 纯算法无外部依赖；输入解析容错（大小写、空格）。
 * - 双向 encode+decode：encode = from→to，decode = to→from。
 */
import { register } from "./registry.js";

// ============ 常量 ============
const NOTE_LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_TO_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// MIDI semitone → 音名（升号偏好）
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
// MIDI semitone → 音名（降号偏好）
const FLAT_NAMES  = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
// 唱名
const SOLFEGGIO = ["do", "re", "mi", "fa", "sol", "la", "si"];

// ============ 调号音阶表（大调，照抄乐理标准） ============
// 每个调号的 1-7 级音对应的 semitone（相对 C 的半音数）
// C 大调：C D E F G A B = 0 2 4 5 7 9 11
// 升号调（# 越多越多升号）：G(1#) D(2#) A(3#) E(4#) B(5#) F#(6#)
// 降号调（b 越多越多降号）：F(1b) Bb(2b) Eb(3b) Ab(4b) Db(5b) Gb(6b) Cb(7b)
const KEY_SCALE = {
  "C":  [0, 2, 4, 5, 7, 9, 11],
  "G":  [7, 9, 11, 0, 2, 4, 6],
  "D":  [2, 4, 6, 7, 9, 11, 1],
  "A":  [9, 11, 1, 2, 4, 6, 8],
  "E":  [4, 6, 8, 9, 11, 1, 3],
  "B":  [11, 1, 3, 4, 6, 8, 10],
  "F#": [6, 8, 10, 11, 1, 3, 5],
  "F":  [5, 7, 9, 10, 0, 2, 4],
  "Bb": [10, 0, 2, 3, 5, 7, 9],
  "Eb": [3, 5, 7, 8, 10, 0, 2],
  "Ab": [8, 10, 0, 1, 3, 5, 7],
  "Db": [1, 3, 5, 6, 8, 10, 0],
  "Gb": [6, 8, 10, 11, 1, 3, 5],
  "Cb": [11, 1, 3, 4, 6, 8, 10],
};
const KEY_OPTIONS = Object.keys(KEY_SCALE);
// 大调音阶半音间隔（全全半全全全半）：1级=0, 2级=2, 3级=4, 4级=5, 5级=7, 6级=9, 7级=11
const SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11];

// ============ 音名 ↔ MIDI ============
function noteNameToMidi(name) {
  const s = String(name).trim();
 // 格式：[A-G][#b]*[-?\d]
  const m = s.match(/^([A-Ga-g])([#b]*)(-?\d+)$/);
  if (!m) throw new Error("非法音名：" + name + "（格式如 C4, C#4, Db4, B3）");
  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const octave = parseInt(m[3], 10);
  let semitone = LETTER_TO_SEMITONE[letter];
  for (const c of accidental) {
    if (c === "#") semitone += 1;
    else if (c === "b") semitone -= 1;
  }
  const midi = (octave + 1) * 12 + semitone;
  if (midi < 0 || midi > 127) throw new Error("MIDI 音符号超出 [0,127]：" + name + " → " + midi);
  return midi;
}
function midiToNoteName(midi, preferFlat) {
  midi = Math.round(midi);
  if (midi < 0 || midi > 127) throw new Error("MIDI 音符号超出 [0,127]：" + midi);
  const octave = Math.floor(midi / 12) - 1;
  const semitone = midi % 12;
  const name = preferFlat ? FLAT_NAMES[semitone] : SHARP_NAMES[semitone];
  return name + octave;
}

// ============ MIDI ↔ 频率（十二平均律，A4=440Hz） ============
function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ============ 简谱 ↔ MIDI ============
// 简谱格式：1-7 + 八度标记（' 高八度，, 低八度）
// 中音区 1 = 第 4 八度的 1 级音（C 调时 = C4 = MIDI 60）
function jianpuToMidi(jianpu, key) {
  key = key || "C";
  const s = String(jianpu).trim();
  const m = s.match(/^([1-7])([',]*)$/);
  if (!m) throw new Error("非法简谱：" + jianpu + "（格式如 1, 2', 3,）");
  const num = parseInt(m[1], 10) - 1; // 0-6
  const marks = m[2];
  let octave = 4; // 中音区 = 第 4 八度
  for (const c of marks) {
    if (c === "'") octave++;
    else if (c === ",") octave--;
  }
  const scale = KEY_SCALE[key];
  if (!scale) throw new Error("未知调号：" + key + "（合法：" + KEY_OPTIONS.join("/") + "）");
 // 主音（1 级）在目标八度的 MIDI + 大调音阶半音间隔。
 // 注意：大调音阶跨八度（如 G 调 1=G4=67，4=C5=72，7=F#5=78）
 // 不能用 (octave+1)*12 + scale[num]（会错把 G 调 4 算成 C4=60）。
  const tonicMidi = (octave + 1) * 12 + scale[0];
  return tonicMidi + SCALE_INTERVALS[num];
}
function midiToJianpu(midi, key) {
  key = key || "C";
  midi = Math.round(midi);
  if (midi < 0 || midi > 127) throw new Error("MIDI 音符号超出 [0,127]：" + midi);
  const scale = KEY_SCALE[key];
  if (!scale) throw new Error("未知调号：" + key + "（合法：" + KEY_OPTIONS.join("/") + "）");
 // 相对中音区主音（C4=60 + 主音 semitone）的半音差，调整到 [0,12) 并记录八度偏移。
 // 大调音阶跨八度，必须用音阶间隔表匹配，不能直接用 scale.indexOf(semitone)。
  const tonicBase = 60 + scale[0];
  let diff = midi - tonicBase;
  let octaveShift = 0;
  while (diff < 0) { diff += 12; octaveShift--; }
  while (diff >= 12) { diff -= 12; octaveShift++; }
  const idx = SCALE_INTERVALS.indexOf(diff);
  if (idx < 0) {
    throw new Error("MIDI " + midi + "（" + midiToNoteName(midi) + "）不在 " + key + " 调自然音阶内（半音偏移 " + diff + "）");
  }
  const num = idx + 1;
  const octave = 4 + octaveShift;
  let marks = "";
  let oct = octave;
  while (oct > 4) { marks += "'"; oct--; }
  while (oct < 4) { marks += ","; oct++; }
  return num + marks;
}

// ============ 唱名 ↔ 简谱（首调唱名法：do=1, re=2, ..., si=7） ============
function solfeggioToJianpu(sol) {
  const s = String(sol).trim().toLowerCase();
  const m = s.match(/^(do|re|mi|fa|sol|la|si)([',]*)$/);
  if (!m) throw new Error("非法唱名：" + sol + "（格式如 do, re', mi,）");
  const idx = SOLFEGGIO.indexOf(m[1]);
  return (idx + 1) + m[2];
}
function jianpuToSolfeggio(jianpu) {
  const s = String(jianpu).trim();
  const m = s.match(/^([1-7])([',]*)$/);
  if (!m) throw new Error("非法简谱：" + jianpu);
  const idx = parseInt(m[1], 10) - 1;
  return SOLFEGGIO[idx] + m[2];
}

// ============ 唱名 ↔ MIDI ============
function solfeggioToMidi(sol, key) {
  return jianpuToMidi(solfeggioToJianpu(sol), key);
}
function midiToSolfeggio(midi, key) {
  return jianpuToSolfeggio(midiToJianpu(midi, key));
}

// ============ 输入解析（auto 模式） ============
function parseInput(text) {
  const s = String(text).trim();
  if (!s) throw new Error("空输入");
 // 1. 唱名 do/re/mi/fa/sol/la/si（可带八度标记）
  if (/^(do|re|mi|fa|sol|la|si)[',]*$/i.test(s)) {
    return { type: "solfeggio", value: s.toLowerCase() };
  }
 // 2. 音名 [A-G][#b]*[-?\d]
  if (/^[A-Ga-g][#b]*-?\d+$/.test(s)) {
    return { type: "noteName", value: s };
  }
 // 3. 简谱 [1-7][',]*
  if (/^[1-7][',]*$/.test(s)) {
    return { type: "jianpu", value: s };
  }
 // 4. MIDI 纯数字（0-127）
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n < 0 || n > 127) throw new Error("MIDI 音符号超出 [0,127]：" + n);
    return { type: "midi", value: n };
  }
  throw new Error("无法识别音乐记号：" + s + "（支持音名/MIDI/简谱/唱名）");
}

// ============ 主转换 ============
const FORMATS = ["noteName", "midi", "jianpu", "solfeggio"];
function convert(text, from, to, key, preferFlat) {
  key = key || "C";
  preferFlat = preferFlat || false;
 // 先解析到 MIDI
  let midi;
  if (from === "auto") {
    const parsed = parseInput(text);
    if (parsed.type === "midi") midi = parsed.value;
    else if (parsed.type === "noteName") midi = noteNameToMidi(parsed.value);
    else if (parsed.type === "jianpu") midi = jianpuToMidi(parsed.value, key);
    else if (parsed.type === "solfeggio") midi = solfeggioToMidi(parsed.value, key);
  } else if (from === "noteName") {
    midi = noteNameToMidi(text);
  } else if (from === "midi") {
    midi = parseInt(text, 10);
    if (isNaN(midi) || midi < 0 || midi > 127) throw new Error("MIDI 音符号须为 [0,127] 整数：" + text);
  } else if (from === "jianpu") {
    midi = jianpuToMidi(text, key);
  } else if (from === "solfeggio") {
    midi = solfeggioToMidi(text, key);
  } else {
    throw new Error("未知源格式：" + from);
  }
 // 再从 MIDI 转到目标格式
  if (to === "noteName") return midiToNoteName(midi, preferFlat);
  if (to === "midi") return String(midi);
  if (to === "jianpu") return midiToJianpu(midi, key);
  if (to === "solfeggio") return midiToSolfeggio(midi, key);
  throw new Error("未知目标格式：" + to);
}

// ============ 注册 op：musicNotation（多向互转） ============
const FORMAT_OPTIONS = [
  { value: "auto",      label: "自动识别" },
  { value: "noteName",  label: "音名（如 C4, F#5）" },
  { value: "midi",      label: "MIDI 音号（0-127）" },
  { value: "jianpu",    label: "简谱（1-7，'高,低）" },
  { value: "solfeggio", label: "唱名（do re mi fa sol la si）" },
];
const KEY_SELECT_OPTIONS = KEY_OPTIONS.map(function (k) { return { value: k, label: k + " 大调" }; });

register({
  id: "musicNotation", cat: "fancy", name: "音乐记号互转",
  desc: "音名(C4)/MIDI(60)/简谱(1)/唱名(do) 四向互转。支持 15 个大调调号，A4=440Hz。encode=from→to，decode=to→from",
  params: [
    { key: "from", label: "源格式", type: "select", default: "auto", options: FORMAT_OPTIONS },
    { key: "to",   label: "目标格式", type: "select", default: "midi", options: FORMAT_OPTIONS.filter(function (o) { return o.value !== "auto"; }) },
    { key: "key",  label: "调号", type: "select", default: "C", options: KEY_SELECT_OPTIONS },
    { key: "preferFlat", label: "音名偏好降号", type: "bool", default: false },
  ],
  encode: function (t, p) { return convert(t, p.from || "auto", p.to || "midi", p.key || "C", p.preferFlat === true); },
  decode: function (t, p) { return convert(t, p.to || "midi", p.from === "auto" ? "midi" : (p.from || "midi"), p.key || "C", p.preferFlat === true); },
});

// ============ 注册 op：musicInfo（音符全息信息，单向 run） ============
register({
  id: "musicInfo", cat: "fancy", name: "音符全息信息",
  desc: "输入音名/MIDI/简谱/唱名，输出全部四种格式 + 频率 + 八度 + 半音偏移",
  params: [
    { key: "key", label: "调号", type: "select", default: "C", options: KEY_SELECT_OPTIONS },
    { key: "preferFlat", label: "音名偏好降号", type: "bool", default: false },
  ],
  run: function (t, p) {
    const key = p.key || "C";
    const preferFlat = p.preferFlat === true;
    const parsed = parseInput(t);
    let midi;
    if (parsed.type === "midi") midi = parsed.value;
    else if (parsed.type === "noteName") midi = noteNameToMidi(parsed.value);
    else if (parsed.type === "jianpu") midi = jianpuToMidi(parsed.value, key);
    else if (parsed.type === "solfeggio") midi = solfeggioToMidi(parsed.value, key);
    const noteName = midiToNoteName(midi, preferFlat);
    const jianpu = midiToJianpu(midi, key);
    const solfeggio = midiToSolfeggio(midi, key);
    const freq = midiToFreq(midi);
    const octave = Math.floor(midi / 12) - 1;
    const semitone = midi % 12;
    const lines = [
      "输入类型:   " + parsed.type,
      "音名:       " + noteName,
      "MIDI 音号:  " + midi,
      "简谱:       " + jianpu + "（" + key + " 调）",
      "唱名:       " + solfeggio,
      "频率:       " + freq.toFixed(2) + " Hz（A4=440Hz 十二平均律）",
      "八度:       " + octave,
      "半音偏移:   " + semitone + "（相对 C）",
    ];
    return lines.join("\n");
  },
});

export {
  noteNameToMidi, midiToNoteName,
  jianpuToMidi, midiToJianpu,
  solfeggioToMidi, midiToSolfeggio,
  solfeggioToJianpu, jianpuToSolfeggio,
  midiToFreq, parseInput, convert,
  KEY_SCALE, KEY_OPTIONS, FORMATS,
  NOTE_LETTERS, SOLFEGGIO, SHARP_NAMES, FLAT_NAMES,
};
