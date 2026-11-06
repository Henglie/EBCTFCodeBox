/*
 * Multiple-Bombe candidate module.
 * Algorithm derived from CyberChef MultipleBombe.mjs.
 * CyberChef: Crown Copyright 2019, Apache-2.0.
 *
 * Product wiring note: when moved to src/core/, change the imports below to
 *   import { register } from "./registry.js";
 *   import { BombeMachine, parseReflector, parseRotorWiring } from "./bombe.js";
 */
import { register } from "./registry.js";
import { BombeMachine, parseReflector, parseRotorWiring } from "./bombe.js";

const DEFAULT_ROTORS = "I\nII\nIII\nIV\nV";
const DEFAULT_REFLECTORS = "B";

function splitLines(raw) {
  return String(raw == null ? "" : raw)
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sanitizeLetters(text) {
  return String(text == null ? "" : text)
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
}

function parseReflectorList(raw) {
  const lines = splitLines(raw);
  if (lines.length === 0) throw new Error("A minimum of one reflector must be supplied");
  return lines.map((line) => parseReflector(line));
}

function scoreStop(crib, stop) {
  const [, stecker, decrypt] = stop;
  let matches = 0;
  const n = Math.min(crib.length, decrypt.length);
  for (let i = 0; i < n; i++) {
    if (decrypt.charAt(i) === crib.charAt(i)) matches++;
  }
  const pairs = stecker === "??" ? 0 : stecker.split(/\s+/).filter(Boolean).length;
  return { matches, pairs, score: matches * 100 + pairs * 5 };
}

// CyberChef「Standard Enigmas」预设（第一/第二/第三/第四），custom 时沿用用户填写值。
const BOMBE_PRESETS = {
  german1: { rotors: "I\nII\nIII\nIV\nV", fourth: "", reflectors: "B" },
  german2: { rotors: "I\nII\nIII\nIV\nV\nVI\nVII\nVIII", fourth: "", reflectors: "B\nC" },
  german3: { rotors: "I\nII\nIII\nIV\nV\nVI\nVII\nVIII", fourth: "Gamma", reflectors: "B Thin" },
  german4: { rotors: "I\nII\nIII\nIV\nV\nVI\nVII\nVIII", fourth: "Gamma", reflectors: "B Thin\nC Thin" },
};

function multipleBombeAttack(text, params = {}) {
  const preset = BOMBE_PRESETS[params.preset];
  if (preset) {
    params = { ...params, rotors: preset.rotors, fourthRotors: preset.fourth, reflectors: preset.reflectors };
  }
  const crib = sanitizeLetters(params.crib);
  const offset = Number(params.offset == null ? 0 : params.offset);
  if (!Number.isInteger(offset) || offset < 0) throw new Error("Offset must be a non-negative integer");
  if (crib.length === 0) throw new Error("Crib cannot be empty");

  const mainRotors = [
    ...new Set(
      splitLines(params.rotors == null ? DEFAULT_ROTORS : params.rotors).map(parseRotorWiring)
    ),
  ];
  if (mainRotors.length < 3) throw new Error("A minimum of three rotors must be supplied");

  const fourthRaw = splitLines(params.fourthRotors);
  const fourthRotors = fourthRaw.length === 0 ? [""] : fourthRaw.map(parseRotorWiring);
  const reflectors = parseReflectorList(
    params.reflectors == null ? DEFAULT_REFLECTORS : params.reflectors
  );
  const check = params.check !== false;
  const rawMaxRunsParam = params.maxRuns;
  const rawMaxRuns =
    rawMaxRunsParam == null || String(rawMaxRunsParam).trim() === ""
      ? 60
      : Number(rawMaxRunsParam);
  if (!Number.isInteger(rawMaxRuns) || rawMaxRuns < 0) {
    throw new Error("maxRuns must be a non-negative integer (0 = unlimited)");
  }
  const maxRuns = rawMaxRuns;
  const ciphertext = sanitizeLetters(text).slice(offset);

  const totalRuns =
    mainRotors.length *
    (mainRotors.length - 1) *
    (mainRotors.length - 2) *
    fourthRotors.length *
    reflectors.length;

  let machine;
  const runs = [];
  let executedRuns = 0;
  let stopsTotal = 0;
  let truncated = false;

  outer: for (const r1 of mainRotors) {
    for (const r2 of mainRotors) {
      if (r2 === r1) continue;
      for (const r3 of mainRotors) {
        if (r3 === r2 || r3 === r1) continue;
        for (const r4 of fourthRotors) {
          for (const reflector of reflectors) {
            if (maxRuns > 0 && executedRuns >= maxRuns) {
              truncated = true;
              break outer;
            }
            const runRotors = r4 === "" ? [r1, r2, r3] : [r4, r1, r2, r3];
            const fastFirst = runRotors.slice().reverse();
            if (machine === undefined) {
              machine = new BombeMachine(fastFirst, reflector, ciphertext, crib, check);
            } else {
              machine.changeRotors(fastFirst, reflector);
            }
            const result = machine.run();
            executedRuns++;
            stopsTotal += result.length;
            if (result.length > 0) {
              const stops = result.map((stop) => {
                const scored = scoreStop(crib, stop);
                return {
                  setting: stop[0],
                  stecker: stop[1],
                  decrypt: stop[2],
                  matches: scored.matches,
                  steckerPairs: scored.pairs,
                  score: scored.score,
                };
              });
              stops.sort((a, b) => b.score - a.score);
              runs.push({
                rotors: runRotors.slice(),
                reflector: reflector.pairs,
                bestScore: stops[0].score,
                nLoops: machine.nLoops,
                stops,
              });
            }
          }
        }
      }
    }
  }

  runs.sort((a, b) => {
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    if (b.nLoops !== a.nLoops) return b.nLoops - a.nLoops;
    if (a.stops.length !== b.stops.length) return a.stops.length - b.stops.length;
    const ka = a.rotors.join("\n");
    const kb = b.rotors.join("\n");
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  return {
    nLoops: machine === undefined ? 0 : machine.nLoops,
    totalRuns,
    executedRuns,
    truncated,
    stopsTotal,
    runs,
  };
}

function formatMultipleBombeReport(attack) {
  const lines = [];
  lines.push(
    `Multiple Bombe: ${attack.executedRuns}/${attack.totalRuns} run(s) executed, ${attack.runs.length} candidate run(s), ${attack.stopsTotal} stop(s)`
  );
  lines.push(`Menu loops: ${attack.nLoops}`);
  if (attack.truncated) {
    lines.push("Run limit reached; raise maxRuns (0 = no limit) to scan the remaining rotor/reflector combinations.");
  }
  lines.push(
    "Candidates are sorted by decryption-preview/crib match count, then plugboard pairs, then menu loops."
  );
  lines.push("");
  attack.runs.forEach((run, idx) => {
    lines.push(
      `#${idx + 1} score=${run.bestScore} rotors=${run.rotors.join(", ")} reflector=${run.reflector}`
    );
    lines.push("Rotor stops\tPartial plugboard\tDecryption preview");
    for (const stop of run.stops) {
      lines.push(`${stop.setting}\t${stop.stecker}\t${stop.decrypt}`);
    }
    lines.push("");
  });
  if (attack.runs.length === 0) lines.push("No stops found.");
  lines.push("Rotor positions are left to right, start at the beginning of the crib, and ignore stepping and ring settings.");
  return lines.join("\n");
}

function multipleBombeProcess(text, params = {}) {
  return formatMultipleBombeReport(multipleBombeAttack(text, params));
}

register({
  id: "multipleBombe",
  cat: "crypto",
  name: "Multiple Bombe 批量炸弹机",
  desc: "未知转子组合时批量运行 Bombe，按预览/crib 匹配与接线板完整度评分排序输出候选",
  params: [
    {
      key: "preset",
      label: "Standard Enigmas",
      type: "select",
      default: "custom",
      options: [
        { value: "custom", label: "User defined（使用下方三组值）" },
        { value: "german1", label: "German Service Enigma (First - 3 rotor)" },
        { value: "german2", label: "German Service Enigma (Second - 3 rotor)" },
        { value: "german3", label: "German Service Enigma (Third - 4 rotor)" },
        { value: "german4", label: "German Service Enigma (Fourth - 4 rotor)" },
      ],
    },
    {
      key: "rotors",
      label: "主转子池（每行一个，左→右，至少 3 个，<步进会忽略）",
      type: "textarea",
      rows: 5,
      default: DEFAULT_ROTORS,
      placeholder: "I\nII\nIII\nIV\nV 或完整 26 字母接线",
    },
    {
      key: "fourthRotors",
      label: "第 4 转子池（每行一个，可留空）",
      type: "textarea",
      rows: 3,
      default: "",
      placeholder: "Beta\nGamma",
    },
    {
      key: "reflectors",
      label: "反射器池（每行一个，B/C/B Thin/C Thin 或 13 对字母）",
      type: "textarea",
      rows: 3,
      default: DEFAULT_REFLECTORS,
    },
    { key: "crib", label: "已知明文 crib", type: "text", default: "" },
    { key: "offset", label: "crib 在密文中的偏移", type: "number", default: 0 },
    { key: "check", label: "使用 checking machine", type: "bool", default: true },
    { key: "maxRuns", label: "最多运行次数（0 = 不限制）", type: "number", default: 60 },
  ],
  run: (text, p) => multipleBombeProcess(text, p || {}),
});

export {
  multipleBombeAttack,
  multipleBombeProcess,
  formatMultipleBombeReport,
  parseReflectorList,
  scoreStop,
};
export default multipleBombeProcess;
