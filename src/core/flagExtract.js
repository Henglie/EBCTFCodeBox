/*
 * flagExtract.js — flag 自动提取器（cat:'analysis'，run 型）。
 *
 * 定位：CTF 一键杀器。递归对输入做多编码解码，每层用 flag{} 正则匹配，命中即输出
 * flag + 完整解码链路。本质是 magic 一键解码的"只找 flag 闭环"收窄版——magic 是
 * 全候选打分排序，本 op 是"非递归不猜算法、只找 flag{}"专项。
 *
 * 算法：
 * 1. 当前文本直接跑 FLAG_RE 检查，命中即记录（链路空）
 * 2. 用一批轻量 decode op 对当前文本跑一遍（base64/hex/url/rot13/caesar 等）
 * 3. 每个 decode 成功且变化的结果，递归 depth+1
 * 4. 命中或达 maxDepth 停止
 * 5. 去重 + 按链路长度排序输出
 *
 * 防爆：
 * - 每层最多保留 8 个候选（按"含 flag 关键字优先 + 可打印率高优先"排序）
 * - 总迭代 200 上限（maxDepth * 候选数 * decode op 数）
 * - 同 op 在同链路不连用（防自打转）
 * - 候选与父文本相同则剪枝
 *
 * 红线：
 * - 算法层零 UI 依赖（仅 registry + 一批选定的 decode op）。
 * - 零外发：纯本地计算。
 * - 件内自注册（register(op)）。
 * - 不 import magic/exhaustiveDecode（避依赖耦合），自备 decode op 调用表 + flag 正则。
 *
 * 契约：register({id, cat:'analysis', name, desc, params, run})。
 *
 * 参考：
 * - ctf-wiki 通用（非单页）+ cryptopals + CyberChef Magic
 * - 本项目 magic.js FLAG_FORMAT_RE / exhaustiveDecode FLAG_KEYWORDS 思路
 */
import { register, OPS, getOp, defaultParams } from "./registry.js";

// ============================================================
// flag 正则
// ============================================================
// flag{...} 完整格式：前缀{内容}，前缀 2+ 字母数字下划线，内容 1+ 非 {} 字符
const FLAG_FORMAT_RE = /[a-z0-9_]{2,}\{[^{}]{1,}\}/gi;
// 强命中关键词（密文/明文均检测，宽匹配）
const FLAG_KEYWORDS = ["flag", "ctf", "key", "pass", "Flag", "CTF", "FLAG", "KEY", "PASS"];

function findFlags(text) {
  if (!text) return [];
  const hits = [];
 // 完整 flag{...} 格式
  const re = new RegExp(FLAG_FORMAT_RE.source, "gi");
  let m;
  while ((m = re.exec(text)) !== null) {
    hits.push({ flag: m[0], type: "format" });
  }
  return hits;
}

function hasFlagKeyword(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  for (const kw of FLAG_KEYWORDS) {
    if (lower.includes(kw.toLowerCase())) return true;
  }
  return false;
}

// ============================================================
// 可打印率
// ============================================================
function printableRatio(text) {
  if (!text) return 0;
  let printable = 0;
  let total = 0;
  for (const ch of text) {
    total++;
    const c = ch.codePointAt(0);
    if ((c >= 0x20 && c <= 0x7e) || c === 0x0a || c === 0x0d || c === 0x09) printable++;
    else if (c >= 0x4e00 && c <= 0x9fff) printable++; // CJK
  }
  return total === 0 ? 0 : printable / total;
}

// ============================================================
// 候选 decode op 白名单（只跑这些轻量解码 op，避免遍历全 OPS 过载）
// ============================================================
// 只选有 decode 且是"输入字符串→字符串"的纯编解码 op，无文件/字节/参数复杂依赖。
const DECODE_OP_IDS = [
  "base64", "base32", "base58", "base85", "base91", "base62", "base36", "base45",
  "base16", "url", "htmlEntity", "unicodeEscape",
  "rot13", "rot5", "rot18", "rot47", "caesar", "atbash", "a1z26",
  "morse", "baudot", "tapCode",
  "bacon", "railFence",
];

function getDecodeOps() {
 // 从 registry OPS 里挑白名单内的 op
  return DECODE_OP_IDS.map((id) => getOp(id)).filter((op) => op && typeof op.decode === "function");
}

// ============================================================
// 递归提取
// ============================================================
/**
 * @param {string} text 输入文本
 * @param {number} maxDepth 最大递归深度
 * @returns {Array<{flag, chain}>}
 */
function extractFlags(text, maxDepth) {
  const results = [];
  const seen = new Set(); // 去重（flag + 链路）

  function addHit(flag, chain) {
    const key = flag + "|" + chain.join(">");
    if (seen.has(key)) return;
    seen.add(key);
    results.push({ flag, chain: chain.slice() });
  }

 // BFS beam search：逐层扩展，每层 candidates 合并 sort 取 top BEAM_WIDTH。
 // 比 DFS LIFO 更稳：高分 candidate（如 base64 解出 flag kw）优先扩展
 // 不被低分子树饿死。DFS 在 MAX_ITER 截断时，浅层高分 candidate 可能永远没机会 pop。
  let frontier = [{ text: String(text || ""), chain: [] }];
  let iter = 0;
  const MAX_ITER = 2000;
  const BEAM_WIDTH = 32; // 每层最多保留 32 个 candidate

  while (frontier.length > 0 && iter < MAX_ITER) {
    const nextFrontier = [];
    for (const node of frontier) {
      iter++;
      if (iter > MAX_ITER) break;
      const { text: cur, chain } = node;

 // 1. 当前文本检查 flag
      const flags = findFlags(cur);
      for (const f of flags) {
        addHit(f.flag, chain);
      }

      if (chain.length >= maxDepth) continue;

 // 2. 跑 decode op
      const ops = getDecodeOps();
      const candidates = [];
      for (const op of ops) {
 // 同 op 不连用（防自打转）
        if (chain.length > 0 && chain[chain.length - 1] === op.id) continue;
        let decoded;
        try {
          const params = defaultParams(op);
          decoded = op.decode(cur, params);
        } catch {
          continue;
        }
        if (decoded == null) continue;
        const s = String(decoded);
 // 剪枝：与父文本相同
        if (s === cur) continue;
 // 剪枝：明显乱码（可打印率 < 0.3 且无 flag 关键字）
        const pr = printableRatio(s);
        const hasKw = hasFlagKeyword(s);
        if (pr < 0.3 && !hasKw) continue;
        candidates.push({ opId: op.id, text: s, score: (hasKw ? 100 : 0) + pr });
      }

 // 3. 单节点内按 score 降序取前 8
      candidates.sort((a, b) => b.score - a.score);
      for (const c of candidates.slice(0, 8)) {
        nextFrontier.push({ text: c.text, chain: chain.concat([c.opId]), score: c.score });
      }
    }
 // 整层合并 sort，取 top BEAM_WIDTH（beam search 剪枝）
    nextFrontier.sort((a, b) => b.score - a.score);
    frontier = nextFrontier.slice(0, BEAM_WIDTH);
  }

 // 排序：链路短的优先（更简单的解）
  results.sort((a, b) => a.chain.length - b.chain.length);
  return results;
}

// ============================================================
// run：主入口
// ============================================================
function flagExtractRun(text, p) {
  const maxDepth = Math.max(1, Math.min(5, parseInt((p && p.maxDepth) || "3", 10) || 3));
  const lines = [];
  lines.push("=== flag 自动提取器（递归多编码 + flag{} 正则闭环） ===");
  lines.push("");

  if (!text || !String(text).trim()) {
    lines.push("✗ 输入为空");
    return lines.join("\n");
  }
  lines.push("输入长度: " + String(text).length + " 字符");
  lines.push("最大递归深度: " + maxDepth);
  lines.push("");

  const hits = extractFlags(text, maxDepth);

  if (hits.length === 0) {
    lines.push("✗ 未提取到 flag{}。可能原因：");
    lines.push("  · 输入不是多编码嵌套的 flag（直接看就有 flag 则无需本 op）");
    lines.push("  · 解码路径不在白名单（" + DECODE_OP_IDS.length + " 个常用解码器）");
    lines.push("  · 深度不足（调大 maxDepth 重试，最大 5）");
    lines.push("  · 需要带参 op（如 vigenere 密钥）——本 op 不跑带参 op，用 magic 一把梭");
    lines.push("");
    lines.push("白名单 decode op: " + DECODE_OP_IDS.join(", "));
    return lines.join("\n");
  }

  lines.push("--- 提取到 " + hits.length + " 个 flag ---");
  lines.push("");
 // 去重 flag 内容（不同链路可能得到同一 flag）
  const uniqueFlags = new Map();
  for (const h of hits) {
    if (!uniqueFlags.has(h.flag)) uniqueFlags.set(h.flag, h);
  }
  let idx = 0;
  for (const h of uniqueFlags.values()) {
    idx++;
    lines.push("[" + idx + "] " + h.flag);
    if (h.chain.length > 0) {
      lines.push("    解码链路: " + h.chain.join(" > "));
    } else {
      lines.push("    解码链路: (原文直接命中)");
    }
  }
  lines.push("");
  lines.push("说明:");
  lines.push("  · 链路短的优先（更简单的解更可能是真解）");
  lines.push("  · 同一 flag 多链路命中只展示首条");
  lines.push("  · 若结果明显是乱码撞中正则，忽略即可（正则宽松偶尔误命中）");
  return lines.join("\n");
}

// ============================================================
// 注册
// ============================================================
register({
  id: "flagExtract",
  cat: "analysis",
  name: "flag 自动提取器",
  desc: "递归多编码解码 + flag{} 正则闭环：白名单 26 个常用 decode op 递归跑，命中即输出 flag + 解码链路（maxDepth 默认 3）",
  params: [
    { key: "maxDepth", label: "最大递归深度（1-5）", type: "number", default: 3 },
  ],
  run: flagExtractRun,
});

export { extractFlags, findFlags };
