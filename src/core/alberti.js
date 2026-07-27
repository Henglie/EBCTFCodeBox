/*
 * alberti.js — Alberti 圆盘密码（cat:'classic'）。
 *
 * Leon Battista Alberti 1467 年的圆盘密码，多表替换（polyalphabetic）鼻祖：
 * 两个同心圆盘，外盘（静盘）刻明文字母表，内盘（动盘）刻密文字母表
 * 通过转动内盘切换替换表。历史原版外盘为 24 格（20 字母去 HJKUWY + 数字 1-4）
 * 内盘 24 个乱序字母。本实现取 CTF/教学常用的简化 26 字母版，便于双向与可测：
 * 外盘 = 标准 26 字母 A-Z，内盘 = 可配置的 26 字母混合表（cipher alphabet）。
 *
 * 参数：
 * cipherAlphabet 内盘 26 字母排列（默认 "QWERTZUIOPASDFGHJKLYXCVBNM"）
 * initialShift 内外盘初始对齐偏移（默认 0）
 * periodicShift 每转一次内盘转动的步数（默认 0=不转，退化为单表）
 * period 每处理几个字母转一次内盘（默认 1）
 *
 * 规则：字母按外盘定位，加当前累计 shift 后取内盘字母；每处理 period 个字母
 * 累计 shift += periodicShift。非字母原样保留且不推进字母计数。
 */
import { register } from "./registry.js";

const OUTER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DEFAULT_INNER = "QWERTZUIOPASDFGHJKLYXCVBNM";

// 归一化内盘：取字母、大写、去重补齐到 26；非法/不足时回落默认表。
function normalizeInner(s) {
  const up = String(s || "").toUpperCase().replace(/[^A-Z]/g, "");
  const seen = new Set();
  let out = "";
  for (const c of up) {
    if (!seen.has(c)) { seen.add(c); out += c; }
  }
 // 补齐缺失字母（按 A-Z 顺序），保证内盘是 26 字母的一个排列。
  for (const c of OUTER) if (!seen.has(c)) { seen.add(c); out += c; }
  return out.length === 26 ? out : DEFAULT_INNER;
}

const norm = (n, d) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.trunc(v) : d;
};

function transform(text, p, encoding) {
  const inner = normalizeInner((p && p.cipherAlphabet) || DEFAULT_INNER);
  const initialShift = norm(p && p.initialShift, 0);
  const periodicShift = norm(p && p.periodicShift, 0);
  let period = norm(p && p.period, 1);
  if (period < 1) period = 1;

 // 从明文字母到密文字母：outer[i] → inner[(i + shift) mod 26]
 // 反向解码：inner 位置 j → outer[(j - shift) mod 26]
  let shift = initialShift;
  let count = 0; // 已处理字母数

  let out = "";
  for (const ch of text) {
    const isUpper = ch >= "A" && ch <= "Z";
    const isLower = ch >= "a" && ch <= "z";
    if (!isUpper && !isLower) { out += ch; continue; }

    const up = ch.toUpperCase();
    let mapped;
    if (encoding) {
      const i = OUTER.indexOf(up);
      mapped = inner[(((i + shift) % 26) + 26) % 26];
    } else {
      const j = inner.indexOf(up);
      mapped = OUTER[(((j - shift) % 26) + 26) % 26];
    }
    out += isLower ? mapped.toLowerCase() : mapped;

    count++;
    if (count % period === 0) shift += periodicShift;
  }
  return out;
}

register({
  id: "alberti",
  cat: "classic",
  name: "Alberti 圆盘",
  desc: "1467 多表替换圆盘：外盘 A-Z，内盘混合表，可周期转动",
  params: [
    { key: "cipherAlphabet", label: "内盘字母表（26 字母混合表）", type: "text", default: DEFAULT_INNER },
    { key: "initialShift", label: "初始偏移", type: "number", default: 0 },
    { key: "periodicShift", label: "周期转动步数（0=单表）", type: "number", default: 0 },
    { key: "period", label: "每几个字母转一次", type: "number", default: 1 },
  ],
  encode: (t, p) => transform(t, p, true),
  decode: (t, p) => transform(t, p, false),
});
