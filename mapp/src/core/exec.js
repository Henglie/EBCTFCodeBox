import { getOp } from "../../../src/core/registry.js";
import { CATALOG } from "../generated/catalog.js";

export const DESC_BY_ID = new Map(CATALOG.map((o) => [o.id, o]));

export function defaultsFor(id) {
  const d = DESC_BY_ID.get(id);
  const p = {};
  if (d && Array.isArray(d.params)) {
    for (const item of d.params) p[item.key] = item.default;
  }
  return p;
}

export function normalizeResult(out) {
  if (out == null) return { text: "", files: [] };
  if (typeof out === "string") return { text: out, files: [] };
  if (typeof out === "object") {
    if (typeof out.text === "string") {
      return { text: out.text, files: Array.isArray(out.files) ? out.files : [] };
    }
    if (Array.isArray(out.files)) return { text: "", files: out.files };
    try { return { text: JSON.stringify(out, null, 2), files: [] }; } catch { return { text: String(out), files: [] }; }
  }
  return { text: String(out), files: [] };
}

export async function runOp(id, dir, input, params = {}) {
  const op = getOp(id);
  if (!op) throw new Error("算法不存在：" + id);
  const fn = dir === "encode" ? op.encode : dir === "decode" ? op.decode : op.run;
  const run = typeof fn === "function" ? fn : op.run;
  if (typeof run !== "function") throw new Error("该方向不可用");
  const p = { ...params };
  const out = await run.call(op, String(input ?? ""), p);
  return normalizeResult(out);
}

function bytesToText(bytes) {
  try { return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(bytes)); }
  catch { return String.fromCharCode(...bytes); }
}

function scoreText(s) {
  if (typeof s !== "string" || !s) return -1;
  const n = s.length;
  if (n > 200000) return -1;
  let good = 0, bad = 0, cjk = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126)) good++;
    else if (c >= 0x4e00 && c <= 0x9fff) { good++; cjk++; }
    else if (c >= 0x3000 && c <= 0x303f) { good++; cjk++; }
    else bad++;
  }
  let score = good / n;
  if (/flag\s*\{|ctf\s*\{|key\s*\{|flag\s+is/i.test(s)) score += 0.75;
  if (cjk > 0) score += 0.12;
  if (/\b(the|and|this|that|with|from|your|secret|password|hello|world)\b/i.test(s)) score += 0.1;
  if (s.includes("\uFFFD")) score -= 0.6;
  if (n < 4) score -= 0.5;
  score -= (bad / n) * 1.8;
  return score;
}

function applyCaesar(text, shift) {
  return text.replace(/[a-z]/gi, (ch) => {
    const base = ch <= "Z" ? 65 : 97;
    return String.fromCharCode(((ch.charCodeAt(0) - base + shift + 26) % 26) + base);
  });
}

function binaryToText(s) {
  const bits = s.replace(/[^01]/g, "");
  if (bits.length < 8) return "";
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return bytesToText(bytes);
}

function numbersToText(s, radix) {
  const parts = s.trim().split(/[\s,;:./-]+/).filter(Boolean);
  if (parts.length < 2) return "";
  const bytes = [];
  for (const part of parts) {
    const v = parseInt(part, radix);
    if (!Number.isFinite(v) || v < 0 || v > 255) return "";
    bytes.push(v);
  }
  return bytesToText(bytes);
}

function candidatesFor(input) {
  const out = [];
  const add = (id, dir, params, label, test) => {
    if (!DESC_BY_ID.has(id)) return;
    if (test && !test(input)) return;
    out.push({ id, dir, params: params || {}, label: label || id });
  };
  const s = input.trim();
  add("base64", "decode", {}, "Base64", (t) => /^[A-Za-z0-9+/=_\-\s]{8,}$/.test(t) && !/^[0-9a-fA-F\s]+$/.test(t));
  add("base64", "decode", { urlsafe: true }, "Base64 URL", (t) => /^[A-Za-z0-9_\-=\s]{8,}$/.test(t) && /[-_]/.test(t));
  add("base32", "decode", {}, "Base32", (t) => /^[A-Z2-7=\s]{8,}$/i.test(t));
  add("base16", "decode", {}, "Hex", (t) => /^(?:[0-9a-fA-F]{2}[\s,:\-]?)+$/.test(t) && t.replace(/[^0-9a-fA-F]/g, "").length >= 8);
  add("base58", "decode", {}, "Base58", (t) => /^[1-9A-HJ-NP-Za-km-z]{8,}$/.test(t) && !/[+/=]/.test(t));
  add("url", "decode", {}, "URL 编码", (t) => /%[0-9a-f]{2}|\+/i.test(t));
  add("htmlEntity", "decode", {}, "HTML 实体", (t) => /&(#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/i.test(t));
  add("unicodeEscape", "decode", {}, "Unicode 转义", (t) => /\\u[0-9a-f]{4}|%u[0-9a-f]{4}|&#x[0-9a-f]+;/i.test(t));
  add("quotedPrintable", "decode", {}, "Quoted-Printable", (t) => /=[0-9A-F]{2}/i.test(t));
  add("uuencode", "decode", {}, "UUencode", (t) => /^\s*begin\s+\d{3}/im.test(t));
  add("morse", "decode", {}, "摩斯电码", (t) => /^[.\-\/\s|]+$/.test(t) && /[.-]/.test(t) && t.length > 3);
  add("a1z26", "decode", {}, "A1Z26", (t) => /^(?:\d{1,2}[\s,.;:\-]+)+\d{1,2}$/.test(t));
  add("bacon", "decode", {}, "培根密码", (t) => /^[ABab01\s]+$/.test(t) && t.length >= 10);
  add("rot13", "decode", {}, "ROT13", () => true);
  add("atbash", "decode", {}, "Atbash", () => true);
  add("brainfuck", "decode", {}, "Brainfuck", (t) => /^[+\-<>.,[\]\s]{6,}$/.test(t) && (t.match(/[+\-<>]/g) || []).length >= 6);
  if (/^[01\s]{16,}$/.test(s)) out.push({ id: "__binary", dir: "run", params: {}, label: "二进制", custom: (t) => binaryToText(t) });
  if (/^(?:\d{2,3}[\s,;:.\-]+)+\d{2,3}$/.test(s)) out.push({ id: "__decimal", dir: "run", params: {}, label: "十进制字节", custom: (t) => numbersToText(t, 10) });
  if (/^(?:[0-7]{2,3}[\s,;:.\-]+)+[0-7]{2,3}$/.test(s)) out.push({ id: "__octal", dir: "run", params: {}, label: "八进制字节", custom: (t) => numbersToText(t, 8) });
  if (/[a-z]/i.test(s) && s.length < 20000) {
    for (const shift of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]) {
      out.push({ id: "__caesar", dir: "run", params: {}, label: "凯撒 +" + shift, custom: (t) => applyCaesar(t, shift), shift });
    }
  }
  return out;
}

async function tryCandidate(cand, input) {
  try {
    let text;
    if (cand.custom) text = cand.custom(input);
    else {
      const params = { ...defaultsFor(cand.id), ...cand.params };
      text = (await runOp(cand.id, cand.dir, input, params)).text;
    }
    if (typeof text !== "string" || !text || text === input) return null;
    const score = scoreText(text);
    if (score < 0.52) return null;
    return { label: cand.label, opId: cand.id.startsWith("__") ? "" : cand.id, output: text, score, shift: cand.shift };
  } catch {
    return null;
  }
}

export async function autoDecode(input, onProgress, shouldStop) {
  const raw = String(input ?? "");
  if (!raw.trim()) return [];
  const direct = [];
  const nested = [];
  const seen = new Set();
  const push = (r, bucket) => {
    if (!r) return;
    const key = r.output.trim();
    if (seen.has(key)) return;
    seen.add(key);
    bucket.push(r);
  };
  const stopped = () => typeof shouldStop === "function" && shouldStop();

  const first = candidatesFor(raw);
  let attempts = 0;
  for (let i = 0; i < first.length; i++) {
    if (stopped()) return [];
    if (attempts++ > 70) break;
    if (onProgress) onProgress(i, first.length);
    push(await tryCandidate(first[i], raw), direct);
    if (i % 6 === 0) await new Promise((r) => setTimeout(r, 0));
  }

  const seeds = direct.filter((r) => r.score >= 0.66).slice(0, 4);
  for (const seed of seeds) {
    if (stopped()) break;
    const second = candidatesFor(seed.output);
    for (let i = 0; i < second.length; i++) {
      if (stopped()) break;
      if (attempts++ > 130) break;
      const r = await tryCandidate(second[i], seed.output);
      if (r) {
        r.label = seed.label + " → " + r.label;
        r.score = Math.min(1.35, r.score + 0.08);
        push(r, nested);
      }
      if (i % 6 === 0) await new Promise((res) => setTimeout(res, 0));
    }
  }

  direct.sort((a, b) => b.score - a.score);
  nested.sort((a, b) => b.score - a.score);
  const out = [...direct.slice(0, 8), ...nested.slice(0, 6)].slice(0, 12);
  return out.map((r) => ({ ...r, score: Math.round(r.score * 100) / 100 }));
}

export function looksLikeFlag(text) {
  return /flag\s*\{[^}]+\}/i.test(text);
}
