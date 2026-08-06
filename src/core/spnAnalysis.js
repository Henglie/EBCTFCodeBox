/*
 * spnAnalysis.js — SPN 差分/线性分析教学（cat:'analysis'）。
 *
 * 对用户输入的 4-bit S 盒（16 个 hex 值）计算：
 * - 差分分布表 DDT（Δin → Δout 计数，用于差分攻击找高概率差分）
 * - 线性逼近表 LAT（输入掩码 α → 输出掩码 β 的偏差，用于线性攻击）
 * 内置 PRESENT S 盒（CTF 常考）作为默认示例。
 *
 * 红线：算法层零 UI 依赖；纯本地；件内自注册。
 */
import { register } from "./registry.js";

const PRESENT_SBOX = ["c", "5", "6", "b", "9", "0", "a", "d", "3", "e", "f", "8", "4", "7", "1", "2"];

/** 解析 S 盒：16 个 0-15 值（hex 或 dec），须为置换。 */
export function parseSbox(text) {
  const raw = String(text || "").trim().split(/[\s,;]+/).filter(Boolean);
  const box = raw.map((s) => {
    const v = /^[0-9a-fA-F]$/.test(s) ? parseInt(s, 16) : parseInt(s, 10);
    if (!Number.isFinite(v) || v < 0 || v > 15) throw new Error("S 盒值须为 0-15（hex 或 dec），共 16 个");
    return v;
  });
  if (box.length !== 16) throw new Error("S 盒须 16 个值（当前 " + box.length + "）");
  if (new Set(box).size !== 16) throw new Error("S 盒须为置换（值不重复）");
  return box;
}

/** 差分分布表：ddt[a][b] = #{x : S(x)⊕S(x⊕a) = b}（a,b ∈ 0..15） */
export function ddtOf(box) {
  const ddt = Array.from({ length: 16 }, () => new Array(16).fill(0));
  for (let x = 0; x < 16; x++) {
    for (let a = 1; a < 16; a++) {
      const b = box[x] ^ box[x ^ a];
      ddt[a][b]++;
    }
  }
  return ddt;
}

/** 线性逼近表：lat[α][β] = #{x : α·x ⊕ β·S(x) = 0} - 8（偏差，α,β ∈ 0..15） */
export function latOf(box) {
  const lat = Array.from({ length: 16 }, () => new Array(16).fill(0));
  for (let x = 0; x < 16; x++) {
    for (let a = 1; a < 16; a++) {
      for (let b = 1; b < 16; b++) {
        const pa = popcount(a & x) & 1;
        const pb = popcount(b & box[x]) & 1;
        if ((pa ^ pb) === 0) lat[a][b]++;
      }
    }
  }
  for (let a = 1; a < 16; a++) for (let b = 1; b < 16; b++) lat[a][b] -= 8;
  return lat;
}
function popcount(v) {
  let c = 0;
  while (v) { c += v & 1; v >>= 1; }
  return c;
}

function spnOp(text, p = {}) {
  const box = parseSbox((p && p.sbox) ? p.sbox : (text || PRESENT_SBOX.join(" ")));
  const ddt = ddtOf(box);
  const lat = latOf(box);
  // 差分：找最大非平凡概率
  let bestD = { a: 0, b: 0, c: 0 };
  for (let a = 1; a < 16; a++) for (let b = 0; b < 16; b++) {
    if (ddt[a][b] > bestD.c) bestD = { a, b, c: ddt[a][b] };
  }
  // 线性：找最大偏差
  let bestL = { a: 0, b: 0, c: 0 };
  for (let a = 1; a < 16; a++) for (let b = 1; b < 16; b++) {
    const v = Math.abs(lat[a][b]);
    if (v > bestL.c) bestL = { a, b, c: v };
  }
  const fmt = (t) => t.map((r) => r.map((v) => (v < 0 ? String(v) : " " + v).padStart(3)).join(" ")).join("\n");
  return (
    "S 盒：" + box.map((v) => v.toString(16)).join(" ") + "\n\n" +
    "● 差分分布表 DDT（行=Δin 1-15，列=Δout 0-15）：\n" + fmt(ddt) + "\n\n" +
    "● 线性逼近表 LAT（行=输入掩码，列=输出掩码；值=偏差，范围 -8..8）：\n" + fmt(lat) + "\n\n" +
    "● 最强差分：Δin=" + bestD.a.toString(16) + " → Δout=" + bestD.b.toString(16) +
    "，计数 " + bestD.c + "/16（概率 " + (bestD.c / 16).toFixed(2) + "）\n" +
    "● 最强线性：掩码 " + bestL.a.toString(16) + " → " + bestL.b.toString(16) +
    "，偏差 " + bestL.c + "/16（= " + (bestL.c / 16).toFixed(2) + "）"
  );
}

register({
  id: "spnAnalysis", cat: "analysis", name: "SPN 差分/线性分析",
  desc: "教学工具：4-bit S 盒的差分分布表（DDT）与线性逼近表（LAT）+ 最强差分/线性特征（默认 PRESENT S 盒）",
  params: [
    { key: "sbox", label: "S 盒（16 个 hex/dec）", type: "text", default: "", placeholder: "留空用 PRESENT 默认" },
  ],
  run: spnOp,
});

