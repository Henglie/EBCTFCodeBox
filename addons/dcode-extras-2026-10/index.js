/*
 * dcode-extras-2026-10 — dCode 风格扩展包（官方插件）
 *
 * 定位：选取 dCode.fr 风格、且主工具箱 878 op 未覆盖的纯 JS 算法子集；
 * 不声称复刻全站。每个 op 均有已知向量/往返自测，见 tests/selftest.mjs。
 *
 * 契约：export const manifest + export default setup(ctx)。
 * 依赖：允许复用主程序源码（当前仅 lib/util.js 引用统一随机源 randSource）。
 * 纯前端零外发；所有生成/求解均有界，超限显式报错。
 */

export const manifest = {
  id: "dcode-extras-2026-10",
  name: "dCode 扩展包 Beta · 2026-10 · 408 op",
  version: "2026.10.3-beta.1",
  description: "dCode.fr 风格纯 JS 算法扩展包 Beta：988 个工具逐条入账，408 op；WASM/无限大数/自动运行策略下版优化。覆盖缺口见 COVERAGE.md。",
  author: "恒烈CTF编码工具箱",
  apiVersion: 1,
};

import { OPS as MATH_OPS } from "./ops/mathfun.js";
import { OPS as NUM_OPS } from "./ops/numerals.js";
import { OPS as TEXT_OPS } from "./ops/texttool.js";
import { OPS as GAME_OPS } from "./ops/games.js";
import { OPS as LEX_OPS, loadLexicon } from "./ops/lexicon2.js";
import { OPS as SYM_OPS } from "./ops/symbols.js";
import { OPS as MATH_MORE } from "./ops/mathmore.js";
import { OPS as TEXT_MORE } from "./ops/textmore.js";
import { OPS as NUM_MORE } from "./ops/numeralmore.js";
import { OPS as CIPHER_MORE } from "./ops/ciphermore.js";

const CATS = [
  { id: "dcode-extras-2026-10/cat-math", name: "dcode·数学", icon: "calculate" },
  { id: "dcode-extras-2026-10/cat-numeral", name: "dcode·记数", icon: "pin" },
  { id: "dcode-extras-2026-10/cat-text", name: "dcode·文本", icon: "text_fields" },
  { id: "dcode-extras-2026-10/cat-game", name: "dcode·谜题", icon: "extension" },
  { id: "dcode-extras-2026-10/cat-symbol", name: "dcode·符号", icon: "translate" },
  { id: "dcode-extras-2026-10/cat-cipher", name: "dcode·古典", icon: "lock" },
];

const EN_CAT = {
  "cat-math": "dcode · Math",
  "cat-numeral": "dcode · Numerals",
  "cat-text": "dcode · Text",
  "cat-game": "dcode · Puzzles",
  "cat-symbol": "dcode · Symbols",
  "cat-cipher": "dcode · Classical",
};

const STATIC_OPS = [...MATH_OPS, ...NUM_OPS, ...TEXT_OPS, ...GAME_OPS, ...LEX_OPS, ...SYM_OPS, ...MATH_MORE, ...TEXT_MORE, ...NUM_MORE, ...CIPHER_MORE];

const AUTO_BATCHES = ["auto-d1.js", "auto-d2.js", "auto-d3.js", "auto-d4.js", "auto-e1.js", "auto-e2.js", "auto-e3.js", "auto-e4.js"];

export default async function setup(ctx) {
  await loadLexicon();
  for (const c of CATS) ctx.addCategory(c);
  let n = 0;
  for (const op of STATIC_OPS) { ctx.registerOp({ ...op, since: op.since || "2026.10.0", addedIn: "v0.1.12-beta" }); n++; }
  for (const name of AUTO_BATCHES) {
    try {
      const mod = await import("./ops/" + name);
      for (const raw of mod.OPS || []) {
        const base = String(raw.id || "").startsWith("dcode-extras-2026-10/") ? raw : { ...raw, id: "dcode-extras-2026-10/" + raw.id };
        const op = { ...base, since: base.since || "2026.10.3", addedIn: "v0.1.12-beta" };
        ctx.registerOp(op); n++;
      }
    } catch (e) {
      if (!/Failed to fetch dynamically imported module|Cannot find module|ERR_MODULE_NOT_FOUND/i.test(String(e && e.message))) {
        ctx.log("auto batch failed: " + name + " :: " + (e && e.message ? e.message : e));
      }
    }
  }
  ctx.addMessages({
    zh: Object.fromEntries(CATS.map((c) => [`cat.${c.id}`, c.name])),
    en: Object.fromEntries(CATS.map((c) => [`cat.${c.id}`, EN_CAT[c.id.split("/").pop()] || "Extras"])),
  });
  ctx.log(`已注册 ${n} 个 op（dCode 扩展包 Beta · 2026-10）`);
}
