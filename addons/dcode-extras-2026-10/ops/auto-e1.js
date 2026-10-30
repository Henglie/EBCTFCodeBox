import { runOp } from "../lib/util.js";

const NS = "dcode-extras-2026-10/";
const MATH = NS + "cat-math";
const CIPHER = NS + "cat-cipher";
const TEXT = NS + "cat-text";

const P = (key, label, ph = "") => ({ key, label, type: "text", default: "", placeholder: ph });
const SEL = (key, label, def, opts) => ({ key, label, type: "select", default: def, options: opts.map((o) => (typeof o === "string" ? { value: o, label: o } : o)) });
const oid = (s) => NS + "e1-" + s;
const C = (id, cat, name, desc, params, encode, decode) => ({ id: oid(id), cat, name, desc, params, encode, decode });
const R = (id, cat, name, desc, params, run) => runOp(oid(id), cat, name, desc, run, params);

function intp(v, def, name, min = -100000, max = 100000) {
  const raw = v === undefined || v === null || String(v).trim() === "" ? def : v;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} 须为 ${min}..${max} 的整数`);
  return n;
}

function nump(v, def, name, min = -Infinity, max = Infinity) {
  const raw = v === undefined || v === null || String(v).trim() === "" ? def : v;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} 须为 ${min}..${max} 的实数`);
  return n;
}

function nums(text, what) {
  const s = String(text == null ? "" : text).trim();
  if (!s) throw new Error(`${what}不能为空`);
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  if (parts.length > 20000) throw new Error(`${what}数量超过 20000`);
  return parts.map((x) => {
    if (!/^[+-]?\d+$/.test(x)) throw new Error(`${what}含非整数项: ${x}`);
    const n = Number(x);
    if (!Number.isSafeInteger(n)) throw new Error(`${what}超出安全整数范围: ${x}`);
    return n;
  });
}

function multVigenere(text, keyText, decode) {
  const msg = nums(text, "消息数字");
  const key = nums(keyText, "密钥数字");
  if (key.some((k) => k === 0)) throw new Error("密钥不能含 0（乘法不可逆）");
  const out = [];
  for (let i = 0; i < msg.length; i++) {
    const k = key[i % key.length];
    if (decode) {
      if (msg[i] % k !== 0) throw new Error(`第 ${i + 1} 个密文 ${msg[i]} 不能被密钥 ${k} 整除`);
      out.push(msg[i] / k);
    } else {
      const v = msg[i] * k;
      if (!Number.isSafeInteger(v)) throw new Error(`第 ${i + 1} 个乘积超出安全整数范围`);
      out.push(v);
    }
  }
  return out.join(" ");
}

function cesarProgressive(text, p, decode) {
  const step = intp(p && p.step, 1, "步长");
  const start = intp(p && p.start, 1, "起始位移");
  const mode = String((p && p.mode) || "char");
  const n = intp(p && p.n, 1, "N", 1, 100000);
  if (!["char", "word", "nth"].includes(mode)) throw new Error("模式须为 char / word / nth");
  let out = "";
  let letterIdx = 0;
  let wordIdx = -1;
  let inWord = false;
  for (const ch of String(text == null ? "" : text)) {
    const up = ch.toUpperCase();
    const isLetter = up >= "A" && up <= "Z";
    if (!isLetter) { out += ch; inWord = false; continue; }
    if (!inWord) { wordIdx++; inWord = true; }
    let shift;
    if (mode === "word") shift = start + step * wordIdx;
    else if (mode === "nth") shift = start + step * Math.floor(letterIdx / n);
    else shift = start + step * letterIdx;
    const base = ch >= "a" && ch <= "z" ? 97 : 65;
    const v = ch.charCodeAt(0) - base;
    const k = decode ? -shift : shift;
    out += String.fromCharCode(base + ((v + k) % 26 + 26) % 26);
    letterIdx++;
  }
  return out;
}

const WEB_ASCII = " 🕷🕸🕲🕶🏆🎖🖇🗨🗩🗰🗱🌶🎗🙾🙼🗕🗖🗗⏴⏵⏶⏷⏪⏩⏮⏭⏸⏹⏺🗚🗳🛠🏗🏘🏙🏚🏜🏭🏛🏠🏖🏝🛣🔍🏔👁👂🏞🏕🛤🏟🛳🕬🕫🕨🔈🎔🎕🗬🙽🗭🗪🗫⮔✔🚲□🛡📦🛱■🚑🛈🛩🛰🟈🕴⚫🛥🚔🗘🗙❓🛲🚇🚍⛳🛇⊖🚭🗮|🗯🗲";
const WEB_EXT = "🚹🚺🛉🛊🚼👽🏋⛷🏂🏌🏊🏄🏍🏎🚘🗠🛢💰🏷💳👪🗡🗢🗣✯🖄🖅🖃🖆🖹🖺🖻🕵🕰🖽🖾📋🗒🗓📖📚🗞🗟🗃🗂🖼🎭🎜🎘🎙🎧💿🎞📷🎟🎬📽📹📾📻🎚🎛📺💻🖥🖦🖧🕹🎮🕻🕼📟🖁🖀🖨🖩🖿🖪🗜🔒🔓🗝📥📤🕳🌣🌤🌥🌦☁🌧🌨🌩🌪🌬🌫🌜🌡🛋🛏🍽🍸🛎🛍Ⓟ♿🛆🖈🎓🗤🗥🗦🗧🛪🐿🐦🐟🐕🐈🙬🙮🙭🙯🗺🌍🌏🌎🕊";
const WEB_ENC = new Map();
Array.from(WEB_ASCII).forEach((ch, i) => WEB_ENC.set(32 + i, ch));
Array.from(WEB_EXT).forEach((ch, i) => WEB_ENC.set(128 + i, ch));
const WEB_DEC = new Map([...WEB_ENC].map(([code, ch]) => [ch, code]));

function webdingsEncode(text) {
  let out = "";
  for (const ch of String(text == null ? "" : text)) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || c === 32) { out += ch; continue; }
    const sym = WEB_ENC.get(c);
    if (!sym) throw new Error(`Webdings 无 ASCII/Latin-1 槽位：字符 ${ch} (U+${c.toString(16)})`);
    out += sym;
  }
  return out;
}

function webdingsDecode(text) {
  const src = String(text == null ? "" : text).replace(/[\uFE0E\uFE0F]/g, "");
  let out = "";
  for (const ch of src) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13) { out += ch; continue; }
    const code = WEB_DEC.get(ch);
    if (code === undefined) throw new Error(`未知 Webdings 符号 ${ch} (U+${c.toString(16)})`);
    out += String.fromCharCode(code);
  }
  return out;
}

const R_EARTH = 6371;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

function parsePoint(s) {
  const t = String(s == null ? "" : s).trim();
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:[,;]|\s)\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) throw new Error(`坐标须为 "lat,lon" 形式（十进制度），当前: ${t}`);
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error(`纬度超出 [-90, 90]: ${m[1]}`);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error(`经度超出 [-180, 180]: ${m[2]}`);
  return { lat, lon };
}

function parsePair(text) {
  const raw = String(text == null ? "" : text).trim();
  if (!raw) throw new Error("需要两个坐标点");
  const parts = raw.split(/\s*(?:;|\r?\n|\|)\s*/).filter(Boolean);
  if (parts.length === 2) return [parsePoint(parts[0]), parsePoint(parts[1])];
  const n = raw.match(/-?\d+(?:\.\d+)?/g) || [];
  if (n.length === 4) return [parsePoint(`${n[0]},${n[1]}`), parsePoint(`${n[2]},${n[3]}`)];
  throw new Error(`需要两个坐标点（lat1,lon1; lat2,lon2），当前: ${raw}`);
}

function fmt(n, digits = 6) {
  if (!Number.isFinite(n)) throw new Error("数值不是有限数");
  let x = Math.abs(n) < 5e-7 ? 0 : n;
  const s = x.toFixed(digits);
  return s.replace(/\.?0+$/, "") || "0";
}

function formatCoord(lat, lon) {
  return `${fmt(lat)}, ${fmt(lon)}`;
}

function normLon(lon) {
  let x = (lon + 180) % 360;
  if (x < 0) x += 360;
  x -= 180;
  return Math.abs(x) < 1e-12 ? 0 : x;
}

function haversineKm(a, b, radius = R_EARTH) {
  const dLat = (b.lat - a.lat) * RAD;
  const dLon = (b.lon - a.lon) * RAD;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(Math.min(1, Math.max(0, s))), Math.sqrt(Math.min(1, Math.max(0, 1 - s))));
  return radius * c;
}

function bearingDeg(a, b) {
  const dLon = (b.lon - a.lon) * RAD;
  const y = Math.sin(dLon) * Math.cos(b.lat * RAD);
  const x = Math.cos(a.lat * RAD) * Math.sin(b.lat * RAD) - Math.sin(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.cos(dLon);
  if (Math.abs(x) < 1e-15 && Math.abs(y) < 1e-15) throw new Error("两点重合，方位角无定义");
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

function midpoint(a, b) {
  const dLon = (b.lon - a.lon) * RAD;
  const bx = Math.cos(b.lat * RAD) * Math.cos(dLon);
  const by = Math.cos(b.lat * RAD) * Math.sin(dLon);
  const lat = Math.atan2(Math.sin(a.lat * RAD) + Math.sin(b.lat * RAD), Math.hypot(Math.cos(a.lat * RAD) + bx, by)) * DEG;
  const lon = a.lon + Math.atan2(by, Math.cos(a.lat * RAD) + bx) * DEG;
  return { lat, lon: normLon(lon) };
}

function destination(a, bearing, distKm, radius = R_EARTH) {
  const d = distKm / radius;
  const brg = bearing * RAD;
  const lat = Math.asin(Math.sin(a.lat * RAD) * Math.cos(d) + Math.cos(a.lat * RAD) * Math.sin(d) * Math.cos(brg)) * DEG;
  const lon = a.lon + Math.atan2(Math.sin(brg) * Math.sin(d) * Math.cos(a.lat * RAD), Math.cos(d) - Math.sin(a.lat * RAD) * Math.sin(lat * RAD)) * DEG;
  return { lat, lon: normLon(lon) };
}

const COMPASS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

function compass16(deg) {
  return COMPASS16[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}

const DEPT_ROWS = `01	Ain	département
02	Aisne	département
03	Allier	département
04	Alpes-de-Haute-Provence	département
05	Hautes-Alpes	département
06	Alpes-Maritimes	département
07	Ardèche	département
08	Ardennes	département
09	Ariège	département
10	Aube	département
11	Aude	département
12	Aveyron	département
13	Bouches-du-Rhône	département
14	Calvados	département
15	Cantal	département
16	Charente	département
17	Charente-Maritime	département
18	Cher	département
19	Corrèze	département
2A	Corse-du-Sud	département
2B	Haute-Corse	département
21	Côte-d'Or	département
22	Côtes-d'Armor	département
23	Creuse	département
24	Dordogne	département
25	Doubs	département
26	Drôme	département
27	Eure	département
28	Eure-et-Loir	département
29	Finistère	département
30	Gard	département
31	Haute-Garonne	département
32	Gers	département
33	Gironde	département
34	Hérault	département
35	Ille-et-Vilaine	département
36	Indre	département
37	Indre-et-Loire	département
38	Isère	département
39	Jura	département
40	Landes	département
41	Loir-et-Cher	département
42	Loire	département
43	Haute-Loire	département
44	Loire-Atlantique	département
45	Loiret	département
46	Lot	département
47	Lot-et-Garonne	département
48	Lozère	département
49	Maine-et-Loire	département
50	Manche	département
51	Marne	département
52	Haute-Marne	département
53	Mayenne	département
54	Meurthe-et-Moselle	département
55	Meuse	département
56	Morbihan	département
57	Moselle	département
58	Nièvre	département
59	Nord	département
60	Oise	département
61	Orne	département
62	Pas-de-Calais	département
63	Puy-de-Dôme	département
64	Pyrénées-Atlantiques	département
65	Hautes-Pyrénées	département
66	Pyrénées-Orientales	département
67	Bas-Rhin	département
68	Haut-Rhin	département
69	Rhône	département
70	Haute-Saône	département
71	Saône-et-Loire	département
72	Sarthe	département
73	Savoie	département
74	Haute-Savoie	département
75	Paris	département
76	Seine-Maritime	département
77	Seine-et-Marne	département
78	Yvelines	département
79	Deux-Sèvres	département
80	Somme	département
81	Tarn	département
82	Tarn-et-Garonne	département
83	Var	département
84	Vaucluse	département
85	Vendée	département
86	Vienne	département
87	Haute-Vienne	département
88	Vosges	département
89	Yonne	département
90	Territoire de Belfort	département
91	Essonne	département
92	Hauts-de-Seine	département
93	Seine-Saint-Denis	département
94	Val-de-Marne	département
95	Val-d'Oise	département
971	Guadeloupe	département
972	Martinique	département
973	Guyane	département
974	La Réunion	département
975	Saint-Pierre-et-Miquelon	collectivité
976	Mayotte	département
977	Saint-Barthélemy	collectivité
978	Saint-Martin	collectivité
984	Terres australes et antarctiques françaises	collectivité
986	Wallis-et-Futuna	collectivité
987	Polynésie française	collectivité
988	Nouvelle-Calédonie	collectivité
989	Île de Clipperton	collectivité`;

const DEPTS = DEPT_ROWS.split("\n").map((line) => {
  const [code, name, type] = line.split("\t");
  return { code, name, type };
});

const DEPT_ALIASES = new Map([
  ["reunion", "974"],
  ["la reunion", "974"],
  ["iles clipperton", "989"],
  ["ile de clipperton", "989"],
]);

const deptKey = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function deptLine(d) {
  return `${d.code}\t${d.name}\t${d.type}`;
}

const DIRS = {
  N: [0, 1], S: [0, -1], E: [1, 0], O: [-1, 0], W: [-1, 0],
  NE: [1, 1], NO: [-1, 1], NW: [-1, 1], SE: [1, -1], SO: [-1, -1], SW: [-1, -1],
};

function compassRoute(text) {
  const src = String(text == null ? "" : text).trim();
  if (!src) throw new Error("需要方向路径，如 40N-30E-20S-10O");
  const re = /(\d+)\s*(NE|NO|NW|SE|SO|SW|N|S|E|O|W)(?![A-Za-z])/gi;
  let m;
  let dx = 0;
  let dy = 0;
  let total = 0;
  let count = 0;
  while ((m = re.exec(src))) {
    const n = Number(m[1]);
    const v = DIRS[m[2].toUpperCase()];
    if (!v || !Number.isSafeInteger(n)) continue;
    dx += v[0] * n;
    dy += v[1] * n;
    total += n;
    count++;
  }
  if (!count) throw new Error("未识别到任何 数字+方向（N/S/E/O/NE/NO/SE/SO）");
  const straight = Math.hypot(dx, dy);
  const brg = (Math.atan2(dx, dy) * DEG + 360) % 360;
  const parts = [];
  if (dy !== 0) parts.push(`${Math.abs(dy)}${dy > 0 ? "N" : "S"}`);
  if (dx !== 0) parts.push(`${Math.abs(dx)}${dx > 0 ? "E" : "O"}`);
  return [
    `简化路径: ${parts.length ? parts.join(", ") : "0（回到起点）"}`,
    `最终坐标: ${Math.abs(dx)}${dx >= 0 ? "E" : "O"}, ${Math.abs(dy)}${dy >= 0 ? "N" : "S"}`,
    `总步数: ${total}`,
    `直线距离: ${fmt(straight, 3)}`,
    `方位角: ${fmt(brg, 3)}°`,
  ].join("\n");
}

export const OPS = [
  C("mult-vigenere", CIPHER, "Multiplication Vigenère",
    "数字消息与数字密钥逐位相乘，密钥循环；decode 要求整除。dCode 算例 4,3,15,4,5 × 3,12,5 → 12,36,75,12,60",
    [P("key", "数字密钥", "3 12 5")],
    (t, p) => multVigenere(t, p && p.key, false),
    (t, p) => multVigenere(t, p && p.key, true)),

  C("cesar-progressif", CIPHER, "递进凯撒（Code César Progressif）",
    "按 start + step×序号 递进移位；支持逐字符、逐词、每 N 字符三种换挡。AAA + start=3/step=1 → DEF，start=0 时为 0,1,2…",
    [P("step", "递进步长 N", "1"), P("start", "起始位移（默认 1）", "1"), SEL("mode", "换挡方式", "char", ["char", "word", "nth"]), P("n", "每 N 字符换挡（nth 模式）", "1")],
    (t, p) => cesarProgressive(t, p, false),
    (t, p) => cesarProgressive(t, p, true)),

  C("webdings", CIPHER, "Webdings 符号字体",
    "ASCII 32-126 + Latin-1 128-255 ↔ Webdings Unicode 符号（dCode/Unicode 表）；127 与超出 Latin-1 的码位显式报错",
    [],
    (t) => webdingsEncode(t),
    (t) => webdingsDecode(t)),

  R("azimuth", MATH, "方位角（Azimut）",
    "两 GPS 点之间的初始方位角（正北 0°，顺时针），并给出 16 方位与后向方位",
    [], (t) => {
      const [a, b] = parsePair(t);
      const brg = bearingDeg(a, b);
      return [
        `方位角: ${fmt(brg, 3)}°`,
        `罗盘方位: ${compass16(brg)}`,
        `后向方位: ${fmt((brg + 180) % 360, 3)}°`,
        `两点距离: ${fmt(haversineKm(a, b), 3)} km`,
      ].join("\n");
    }),

  R("geo-calc", MATH, "地理坐标计算（中点 / 终点）",
    "球面中点或已知起点、方位角、距离求终点；默认地球半径 6371 km，与 dCode 算例一致",
    [SEL("mode", "计算类型", "midpoint", [{ value: "midpoint", label: "两点球面中点" }, { value: "destination", label: "起点+方位角+距离→终点" }]), P("bearing", "方位角（度，destination 模式）", "90"), P("distance", "距离 km（destination 模式）", "100"), P("radius", "地球半径 km", "6371")],
    (t, p) => {
      const mode = String((p && p.mode) || "midpoint");
      const radius = nump(p && p.radius, R_EARTH, "地球半径", 1, 1e9);
      if (mode === "midpoint") {
        const [a, b] = parsePair(t);
        const m = midpoint(a, b);
        return [
          `中点: ${formatCoord(m.lat, m.lon)}`,
          `方位角 P1→P2: ${fmt(bearingDeg(a, b), 3)}°`,
          `距离: ${fmt(haversineKm(a, b, radius), 3)} km`,
          `半径: ${fmt(radius, 3)} km`,
        ].join("\n");
      }
      if (mode === "destination") {
        const a = parsePoint(t);
        const brg = nump(p && p.bearing, 90, "方位角");
        const dist = nump(p && p.distance, 100, "距离", 0);
        const d = destination(a, brg, dist, radius);
        return [
          `终点: ${formatCoord(d.lat, d.lon)}`,
          `方位角: ${fmt(((brg % 360) + 360) % 360, 3)}°`,
          `距离: ${fmt(dist, 3)} km`,
          `半径: ${fmt(radius, 3)} km`,
        ].join("\n");
      }
      throw new Error("计算类型须为 midpoint / destination");
    }),

  R("antipodal", MATH, "对跖点（Coordonnées Antipodales）",
    "纬度取反，经度 +180° 并归一化到 [-180, 180]；dCode 算例 -12.345,67.890 → 12.345,-112.11",
    [], (t) => {
      const a = parsePoint(t);
      return [
        `对跖点: ${formatCoord(-a.lat, normLon(a.lon + 180))}`,
        `原始坐标: ${formatCoord(a.lat, a.lon)}`,
        "规则: 纬度取反，经度 +180°",
      ].join("\n");
    }),

  R("haversine", MATH, "Haversine 球面距离",
    "按 Haversine 公式计算两大圆距离（默认地球半径 6371 km），同时给出英里与圆心角",
    [P("radius", "地球半径 km", "6371")],
    (t, p) => {
      const [a, b] = parsePair(t);
      const radius = nump(p && p.radius, R_EARTH, "地球半径", 1, 1e9);
      const km = haversineKm(a, b, radius);
      return [
        `距离: ${fmt(km, 3)} km`,
        `距离: ${fmt(km * 0.621371192237334, 3)} mi`,
        `圆心角: ${fmt((km / radius) * DEG, 6)}°`,
        `半径: ${fmt(radius, 3)} km`,
      ].join("\n");
    }),

  R("dept-fr", MATH, "法国省份（Départements Français）",
    "法国 101 个省及 8 个海外集体：编号/名称双向查询，支持无重音与常见别名；留空或 * 列出全部",
    [], (t) => {
      const q = String(t == null ? "" : t).trim();
      if (!q || q === "*" || q.toLowerCase() === "all") return DEPTS.map(deptLine).join("\n");
      const queries = q.split(/\r?\n|;/).map((x) => x.trim()).filter(Boolean);
      const out = [];
      for (const query of queries) {
        let code = query.toUpperCase().replace(/\s+/g, "");
        if (/^\d$/.test(code)) code = code.padStart(2, "0");
        let hit = DEPTS.find((d) => d.code === code);
        if (!hit) {
          const key = deptKey(query);
          const alias = DEPT_ALIASES.get(key);
          if (alias) hit = DEPTS.find((d) => d.code === alias);
          if (!hit) hit = DEPTS.find((d) => deptKey(d.name) === key);
        }
        if (!hit) throw new Error(`未找到法国省份: ${query}`);
        out.push(deptLine(hit));
      }
      return out.join("\n");
    }),

  R("compass-route", MATH, "罗盘路径化简（Parcours à la Boussole）",
    "按 8 方向路径求和并化简；输出最终坐标、总步数、直线距离与方位角。支持 40N-30E-20S-10O 与 16 SO",
    [], (t) => compassRoute(t)),
];

const E1_IMPL = {
  "webdings": ["police-webdings"],
  "mult-vigenere": ["chiffre-multiplication-vigenere"],
  "cesar-progressif": ["chiffre-cesar-progressif"],
  "azimuth": ["azimut"],
  "geo-calc": ["calcul-coordonnees-geographiques"],
  "antipodal": ["coordonnees-antipodales"],
  "haversine": ["distance-haversine"],
  "dept-fr": ["departements-francais"],
  "compass-route": ["parcours-boussole"],
};

const E1_MAP = {
  alberti: ["chiffre-alberti"],
  autokey: ["chiffre-autoclave"],
  beaufort: ["chiffre-beaufort"],
  bellaso: ["chiffre-bellaso"],
  chaocipher: ["chiffre-chaocipher"],
  ragbaby: ["chiffre-ragbaby"],
  slidefair: ["chiffre-slidefair"],
  solitaire: ["chiffre-solitaire-schneier"],
  beaufortVariant: ["chiffre-variante-beaufort"],
  gronsfeld: ["chiffre-gronsfeld"],
  hill: ["chiffre-hill"],
  phillips: ["chiffre-phillips"],
  porta: ["chiffre-porta"],
  trithemius: ["chiffre-tritheme"],
  otp: ["chiffre-vernam"],
  vigenere: ["chiffre-vigenere", "chiffre-decalage-mot-cle"],
  jefferson: ["cylindre-jefferson"],
  enigma: ["chiffre-machine-enigma"],
  geoUtm: ["coordonnees-utm"],
  geoHash: ["coordonnees-geohash"],
  geoPlusCode: ["code-open-location"],
};

const E1_BLOCK = {
  "altitude-terre": "需要 SRTM/IGN 等数字高程模型栅格数据，纯文本算法无法离线给出海拔。",
  "coordonnees-what3words": "What3Words 使用专有 3 词词表与在线解析服务，词表未公开且不可离线复现。",
  "distance-geographique": "dCode 页面是地址间驾车/步行/航线路径距离，需要地理编码与道路网络服务，非球面距离公式。",
  "geocodage": "地址↔坐标需要外部地理编码数据库或联网服务，仓库未捆绑地址库。",
  "geolocalisation-coordonnees": "坐标反查地点需要地图瓦片/反向地理编码服务，属于联网功能。",
  "http://www.prise2tete.fr/": "Prise2Tete 是外部法语谜题站点，不是可逆算法或可离线复刻的工具。",
  "https://fr.wikipedia.org/": "Wikipedia 是外部百科站点导航页，不是算法工具。",
};

const E1_NOTES = {
  "chiffre-alberti": "主工具箱 alberti 的 cipherAlphabet/initialShift/periodicShift/period 与 dCode 算例 DCODE→EDPGH 对齐。",
  "chiffre-autoclave": "dCode Autoclave = 密钥+明文 autokey；主工具箱 autokey 即此算法。",
  "chiffre-vernam": "字母一次性密码本用 otp；二进制 XOR 模式用 xor；密钥短于明文时按 Vigenere 循环的变体用 vigenere。",
  "chiffre-decalage-mot-cle": "dCode 页面说明该工具即按关键词字母做 Vigenere 式循环移位（A=0），主工具箱 vigenere 同算法。",
  "chiffre-tritheme": "主工具箱 trithemius 为 A=0,1,2… 的递进移位表。",
  "chiffre-machine-enigma": "主工具箱 enigma 覆盖转子 I-V、UKW-B/C、ring/position/plugboard 与双步进。",
  "chiffre-ragbaby": "主工具箱 ragbaby 支持 24/26 字母表、startShift 与 letterStep。",
  "coordonnees-utm": "主工具箱 geoUtm 为 WGS84 UTM 双向转换。",
  "coordonnees-geohash": "主工具箱 geoHash 为 geohash base32 双向转换。",
  "code-open-location": "主工具箱 geoPlusCode 为 Google Open Location Code 双向转换。",
  "police-webdings": "ASCII 32-126 与 Latin-1 128-255 按 dCode/Unicode Webdings 表实现；127 与超出 Latin-1 的码位显式报错。",
};

const NS_LOCAL = "dcode-extras-2026-10/e1-";

const E1_IMPL_BY_SLUG = {};
for (const [op, slugs] of Object.entries(E1_IMPL)) for (const s of slugs) E1_IMPL_BY_SLUG[s] = op;
const E1_MAP_BY_SLUG = {};
for (const [op, slugs] of Object.entries(E1_MAP)) for (const s of slugs) E1_MAP_BY_SLUG[s] = op;

const E1_TOOL_ROWS = `Chiffre Poly-Alphabétique	Chiffre Alberti	chiffre-alberti	https://www.dcode.fr/chiffre-alberti
Chiffre Poly-Alphabétique	Chiffre Autoclave	chiffre-autoclave	https://www.dcode.fr/chiffre-autoclave
Chiffre Poly-Alphabétique	Chiffre Beaufort	chiffre-beaufort	https://www.dcode.fr/chiffre-beaufort
Chiffre Poly-Alphabétique	Chiffre Bellaso	chiffre-bellaso	https://www.dcode.fr/chiffre-bellaso
Chiffre Poly-Alphabétique	Chiffre Chaocipher	chiffre-chaocipher	https://www.dcode.fr/chiffre-chaocipher
Chiffre Poly-Alphabétique	Chiffre Multiplication Vigenère	chiffre-multiplication-vigenere	https://www.dcode.fr/chiffre-multiplication-vigenere
Chiffre Poly-Alphabétique	Chiffre Ragbaby	chiffre-ragbaby	https://www.dcode.fr/chiffre-ragbaby
Chiffre Poly-Alphabétique	Chiffre Slidefair	chiffre-slidefair	https://www.dcode.fr/chiffre-slidefair
Chiffre Poly-Alphabétique	Chiffre Solitaire (Schneier)	chiffre-solitaire-schneier	https://www.dcode.fr/chiffre-solitaire-schneier
Chiffre Poly-Alphabétique	Chiffre Variante de Beaufort	chiffre-variante-beaufort	https://www.dcode.fr/chiffre-variante-beaufort
Chiffre Poly-Alphabétique	Chiffre de Gronsfeld	chiffre-gronsfeld	https://www.dcode.fr/chiffre-gronsfeld
Chiffre Poly-Alphabétique	Chiffre de Hill	chiffre-hill	https://www.dcode.fr/chiffre-hill
Chiffre Poly-Alphabétique	Chiffre de Phillips	chiffre-phillips	https://www.dcode.fr/chiffre-phillips
Chiffre Poly-Alphabétique	Chiffre de Porta	chiffre-porta	https://www.dcode.fr/chiffre-porta
Chiffre Poly-Alphabétique	Chiffre de Trithème	chiffre-tritheme	https://www.dcode.fr/chiffre-tritheme
Chiffre Poly-Alphabétique	Chiffre de Vernam (Masque Jetable)	chiffre-vernam	https://www.dcode.fr/chiffre-vernam
Chiffre Poly-Alphabétique	Chiffre de Vigenère	chiffre-vigenere	https://www.dcode.fr/chiffre-vigenere
Chiffre Poly-Alphabétique	Code César Progressif	chiffre-cesar-progressif	https://www.dcode.fr/chiffre-cesar-progressif
Chiffre Poly-Alphabétique	Cylindre de Jefferson	cylindre-jefferson	https://www.dcode.fr/cylindre-jefferson
Chiffre Poly-Alphabétique	Décalage par Mot Clé	chiffre-decalage-mot-cle	https://www.dcode.fr/chiffre-decalage-mot-cle
Chiffre Poly-Alphabétique	Machine Enigma	chiffre-machine-enigma	https://www.dcode.fr/chiffre-machine-enigma
Géographie	Altitude d'un Point GPS	altitude-terre	https://www.dcode.fr/altitude-terre
Géographie	Azimut	azimut	https://www.dcode.fr/azimut
Géographie	Calcul de Coordonnées Géographiques	calcul-coordonnees-geographiques	https://www.dcode.fr/calcul-coordonnees-geographiques
Géographie	Coordonnées Antipodales	coordonnees-antipodales	https://www.dcode.fr/coordonnees-antipodales
Géographie	Coordonnées UTM	coordonnees-utm	https://www.dcode.fr/coordonnees-utm
Géographie	Coordonnées What3Words	coordonnees-what3words	https://www.dcode.fr/coordonnees-what3words
Géographie	Distance Géographique	distance-geographique	https://www.dcode.fr/distance-geographique
Géographie	Distance Haversine	distance-haversine	https://www.dcode.fr/distance-haversine
Géographie	Départements Français	departements-francais	https://www.dcode.fr/departements-francais
Géographie	Geohash	coordonnees-geohash	https://www.dcode.fr/coordonnees-geohash
Géographie	Géocodage	geocodage	https://www.dcode.fr/geocodage
Géographie	Géolocalisation de Coordonnées	geolocalisation-coordonnees	https://www.dcode.fr/geolocalisation-coordonnees
Géographie	Open Location (Plus Code)	code-open-location	https://www.dcode.fr/code-open-location
Géographie	Parcours à la Boussole	parcours-boussole	https://www.dcode.fr/parcours-boussole
Substitution par Symboles	Police Webdings	police-webdings	https://www.dcode.fr/police-webdings
dCode	Prise2Tete	http://www.prise2tete.fr/	https://www.dcode.fr/http://www.prise2tete.fr/
dCode	Wikipedia	https://fr.wikipedia.org/	https://www.dcode.fr/https://fr.wikipedia.org/`;

export const COVERAGE = E1_TOOL_ROWS.split("\n").map((line) => {
  const [cat, name, slug, url] = line.split("\t");
  const entry = { cat, name, slug, url };
  if (E1_IMPL_BY_SLUG[slug]) return { ...entry, status: "implemented", op: NS_LOCAL + E1_IMPL_BY_SLUG[slug], note: E1_NOTES[slug] || "" };
  if (E1_MAP_BY_SLUG[slug]) return { ...entry, status: "mapped", target: E1_MAP_BY_SLUG[slug], op: E1_MAP_BY_SLUG[slug], note: E1_NOTES[slug] || "" };
  if (E1_BLOCK[slug]) return { ...entry, status: "blocked", reason: E1_BLOCK[slug] };
  throw new Error("E1 覆盖台账缺少分类: " + slug);
});

export const COVERAGE_STATS = (() => {
  const byStatus = { implemented: 0, mapped: 0, blocked: 0 };
  const byCat = {};
  const unique = { implemented: new Set(), mapped: new Set(), blocked: new Set() };
  for (const e of COVERAGE) {
    byStatus[e.status]++;
    byCat[e.cat] = byCat[e.cat] || { implemented: 0, mapped: 0, blocked: 0, total: 0 };
    byCat[e.cat][e.status]++;
    byCat[e.cat].total++;
    unique[e.status].add(e.slug);
  }
  return {
    entries: COVERAGE.length,
    byStatus,
    byCat,
    unique: {
      implemented: unique.implemented.size,
      mapped: unique.mapped.size,
      blocked: unique.blocked.size,
    },
  };
})();
