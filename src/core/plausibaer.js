/*
 * plausibaer.js — 坐标公式候选求解（guballa.de Plausibär 的本地复刻）。
 *
 * 适用：CTF/Geocaching 给的坐标里有未知变量（N 48 1a.bcd E 008 3e.fgh），
 * 并给了变量候选值/中间公式。枚举所有组合，输出合法经纬度、十进制坐标与地图链接。
 * 纯本地、零外发；表达式只允许数字、变量、+ - * / % 和括号。
 */
import { register } from "./registry.js";

function parseCandidates(s) {
  const out = new Map();
  for (const part of String(s || "").split(/[;\n]+/)) {
    const m = part.match(/^\s*([A-Za-z])\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const vals = m[2].split(/[,\s/]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
      if (!/^-?\d+(?:\.\d+)?$/.test(x)) throw new Error(`候选值不是数字：${x}`);
      return Number(x);
    });
    if (vals.length) out.set(m[1].toLowerCase(), [...new Set(vals)]);
  }
  return out;
}

function parseFormulas(s) {
  const out = new Map();
  for (const part of String(s || "").split(/[;\n]+/)) {
    const m = part.match(/^\s*([A-Za-z])\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    out.set(m[1].toLowerCase(), m[2]);
  }
  return out;
}

// 只支持 + - * / % 括号、数字和单字母变量；无 eval。
function evalExpr(expr, vars) {
  const s = String(expr || "").replace(/\s+/g, "");
  if (!s) throw new Error("空表达式");
  let i = 0;
  const peek = () => s[i];
  const next = () => s[i++];
  function primary() {
    if (peek() === "(") { next(); const v = expression(); if (next() !== ")") throw new Error("括号不匹配"); return v; }
    if (peek() === "-") { next(); return -primary(); }
    if (peek() === "+") { next(); return primary(); }
    if (/[0-9.]/.test(peek() || "")) {
      let t = "";
      while (/[0-9.]/.test(peek() || "")) t += next();
      const n = Number(t);
      if (!Number.isFinite(n)) throw new Error(`数字非法：${t}`);
      return n;
    }
    if (/[A-Za-z]/.test(peek() || "")) {
      const k = next().toLowerCase();
      if (!vars.has(k)) throw new Error(`变量未定义：${k}`);
      return vars.get(k);
    }
    throw new Error(`表达式非法：${expr}`);
  }
  function term() {
    let v = primary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = next(); const r = primary();
      if (op === "*") v *= r;
      else if (op === "/") { if (!r) throw new Error("除以 0"); v /= r; }
      else { if (!r) throw new Error("对 0 取模"); v %= r; }
    }
    return v;
  }
  function expression() {
    let v = term();
    while (peek() === "+" || peek() === "-") {
      const op = next(); const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  const v = expression();
  if (i !== s.length) throw new Error(`表达式尾部无法解析：${expr}`);
  if (!Number.isFinite(v)) throw new Error(`表达式结果非有限数：${expr}`);
  return v;
}

function resolveVars(base, formulas) {
  const vars = new Map(base);
  const pending = new Map(formulas);
  for (let pass = 0; pass < 12 && pending.size; pass++) {
    let changed = false;
    for (const [k, expr] of [...pending]) {
      try {
        const v = evalExpr(expr, vars);
        vars.set(k, v); pending.delete(k); changed = true;
      } catch { /* 依赖的变量还没算出来 */ }
    }
    if (!changed) break;
  }
  if (pending.size) throw new Error(`公式无法求解：${[...pending.keys()].join(",")}（可能循环依赖或变量缺失）`);
  return vars;
}

function parseCoord(text) {
  const s = String(text || "").replace(/[°'"]/g, " ").replace(/\s+/g, " ").trim();
  const lat = s.match(/([NS])\s*(\d{1,3})\s+(\d{1,2}(?:\.\d+)?)/i);
  const lon = s.match(/([EW])\s*(\d{1,3})\s+(\d{1,2}(?:\.\d+)?)/i);
  if (!lat || !lon) return null;
  const latDeg = Number(lat[2]), latMin = Number(lat[3]);
  const lonDeg = Number(lon[2]), lonMin = Number(lon[3]);
  if (latDeg > 90 || lonDeg > 180 || latMin >= 60 || lonMin >= 60) return null;
  const latDec = (lat[1].toUpperCase() === "S" ? -1 : 1) * (latDeg + latMin / 60);
  const lonDec = (lon[1].toUpperCase() === "E" ? 1 : -1) * (lonDeg + lonMin / 60);
  return { latDeg, latMin, lonDeg, lonMin, latDec, lonDec };
}

function* combinations(keys, pools, idx = 0, cur = {}) {
  if (idx >= keys.length) { yield cur; return; }
  const k = keys[idx];
  for (const v of pools.get(k)) {
    yield* combinations(keys, pools, idx + 1, { ...cur, [k]: v });
  }
}

function solvePlausibaer(text, p = {}) {
  const coordTpl = String(text || "").trim();
  if (!coordTpl) return "请把带未知变量的坐标模板粘进输入框（如 N 48 1a.bcd E 008 3e.fgh）。";
  const candidates = parseCandidates(p.candidates);
  const formulas = parseFormulas(p.formulas);
  const keys = [...candidates.keys()];
  if (!keys.length) {
    const letters = [...new Set(coordTpl.match(/[A-Za-z]/g) || [])].filter((c) => !/[NSEW]/i.test(c)).map((c) => c.toLowerCase());
    for (const k of letters) candidates.set(k, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    keys.push(...letters);
  }
  if (!keys.length) return "坐标模板里没有可枚举的变量。";
  const maxCombos = Math.max(1, Math.min(Number(p.limit) || 20000, 200000));
  let total = 1;
  for (const k of keys) total *= candidates.get(k).length;
  const limit = Math.min(total, maxCombos);

  const lines = [];
  lines.push("=== 坐标公式候选求解（Plausibär） ===");
  lines.push(`模板：${coordTpl}`);
  lines.push(`变量：${keys.map((k) => `${k}=[${candidates.get(k).join(",")}]`).join("  ")}`);
  if (formulas.size) lines.push(`中间公式：${[...formulas].map(([k, v]) => `${k}=${v}`).join("；")}`);
  lines.push(`组合总数：${total}${total > limit ? `（已限制到前 ${limit} 组）` : ""}`);
  lines.push("");

  const out = [];
  let invalid = 0, count = 0;
  for (const base of combinations(keys, candidates)) {
    if (++count > limit) break;
    let vars;
    try { vars = resolveVars(new Map(Object.entries(base)), formulas); }
    catch (e) { invalid++; continue; }
    const filled = coordTpl.replace(/[A-Za-z]/g, (ch) => {
      if (/[NSEW]/i.test(ch)) return ch;
      const k = ch.toLowerCase();
      if (!vars.has(k)) return ch;
      const v = vars.get(k);
      return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
    });
    if (/[A-Za-z]/.test(filled.replace(/[NSEW]/gi, ""))) { invalid++; continue; }
    const c = parseCoord(filled);
    if (!c) { invalid++; continue; }
    out.push({
      vars: Object.fromEntries([...vars].filter(([k]) => keys.includes(k))),
      coord: filled,
      ...c,
      maps: `https://www.google.com/maps?q=${c.latDec.toFixed(6)},${c.lonDec.toFixed(6)}`,
    });
  }

  // 去重（同一十进制坐标可能由不同变量组合得到）
  const seen = new Set();
  const uniq = [];
  for (const x of out) {
    const key = x.latDec.toFixed(6) + "," + x.lonDec.toFixed(6);
    if (seen.has(key)) continue;
    seen.add(key); uniq.push(x);
  }
  lines.push(`合法候选：${uniq.length}（跳过 ${invalid} 组非法/无法求解的坐标）`);
  lines.push("");
  for (let i = 0; i < uniq.length; i++) {
    const x = uniq[i];
    const vs = Object.entries(x.vars).map(([k, v]) => `${k}=${Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6}`).join(" ");
    lines.push(`#${i + 1}  ${x.coord}`);
    lines.push(`     ${vs}  →  ${x.latDec.toFixed(6)}, ${x.lonDec.toFixed(6)}`);
    lines.push(`     地图：${x.maps}`);
  }
  if (!uniq.length) lines.push("没有合法候选：请检查坐标格式（N/S + 度 + 分）和变量/公式。");
  lines.push("");
  lines.push("提示：结果只按坐标范围过滤，不判断地理合理性；请结合题目提示自行筛选。");
  return lines.join("\n");
}

register({
  id: "plausibaer",
  cat: "analysis",
  name: "坐标公式求解（Plausibär）",
  desc: "枚举坐标中的未知变量与中间公式，输出所有合法经纬度/十进制坐标/地图链接（guballa.de Plausibär 本地复刻）",
  params: [
    { key: "candidates", label: "候选值（如 x=1,2,5；y=0,3）", type: "text", default: "" },
    { key: "formulas", label: "中间公式（如 z=x+3；w=y*2）", type: "text", default: "" },
    { key: "limit", label: "最多组合数", type: "number", default: 20000 },
  ],
  run: solvePlausibaer,
});

export { solvePlausibaer, parseCandidates, parseFormulas, evalExpr, resolveVars, parseCoord };
