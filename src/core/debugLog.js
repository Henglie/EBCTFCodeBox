/*
 * debugLog.js — 统一的加载期诊断输出（默认静默，可显式开启）。
 *
 * 背景：detectExt 系列模块在 import 期会打印诊断行（如 "[detectExt] patched 50 ops: …"）。
 * MCP stdio 协议要求 stdout 只承载 JSON-RPC 消息，这类诊断行会污染协议流；此前由
 * mcp/server.mjs 与 skills/ebctf-decode/decode.mjs 各自劫持 process.stdout.write 规避
 * （同一件事在两个入口各写一遍，第三个消费方还要写第三遍）。现统一改走本模块：
 *   - 默认静默（浏览器 / Node 行为一致）；
 *   - Node 下设环境变量 EBCTF_DEBUG=1、或浏览器下设 globalThis.EBCTF_DEBUG = true 时，
 *     诊断输出到 console.error（stderr），永不碰 stdout。
 *
 * 零依赖、零 DOM，浏览器 / Node / Worker 任意环境可 import。
 */
export function debugLog(...args) {
  let on = false;
  try {
    if (typeof process !== "undefined" && process.env && process.env.EBCTF_DEBUG === "1") on = true;
    if (typeof globalThis !== "undefined" && globalThis.EBCTF_DEBUG) on = true;
  } catch { /* 环境探测失败按静默处理 */ }
  if (!on) return;
  try { console.error(...args); } catch { /* 输出失败忽略 */ }
}
