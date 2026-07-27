/*
 * core/magic/magicWorker.js — 一键解码真多线程 Worker（恒烈需求：真多线程看门狗）
 *
 * 模块 Worker（type:"module"）：导入完整算法注册表 registerAll + magicDecode，
 * 在**独立线程**跑智能解码，主线程完全不阻塞——倒计时流畅、UI 不冻、可随时硬杀接管。
 *
 * 协议（主线程 magicClient.js ↔ 本 Worker）：
 *   主 → Worker： { type:"run", runId, input, opts }
 *   Worker → 主： { type:"partial", runId, cands }   软死线到点的部分结果（先渲染）
 *                 { type:"final",   runId, cands }   跑完的最终结果
 *                 { type:"error",   runId, message } 解码异常
 *                 { type:"ready" }                   Worker 注册表加载完成（可选握手）
 *
 * 中断/接管：主线程直接 worker.terminate() 硬杀本线程 + 重建（毫秒级），
 * 历史任务立即消失、不堆积、不占 CPU——比协作式 abort 更干净彻底。
 * runId 兜底：万一旧消息在 terminate 前漏网，主线程按 runId 丢弃过期结果。
 *
 * ⚠ Worker 内无 DOM：少数图像/音频 op（spectrogram/pixelJihad/canvasDecode…）被调到时
 * 会因缺 document/Image 抛错——magic.js 的 decodeWithTimeout+try/catch 已兜住并跳过，
 * 不影响其余 op（已核实无 op 在模块顶层访问 DOM，故 registerAll 加载不会崩）。
 */
import "../registerAll.js";       // 副作用：注册全部 501 op（与主线程单一事实源）
import { magicDecode } from "./magic.js";

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type !== "run") return;
  const { runId, input, opts } = msg;
  try {
    const cands = await magicDecode(input, {
      ...opts,
 // Worker 里不需要 signal（中断=主线程 terminate），但软死线 onPartial 仍有用：
 // 到点先把已得结果 postMessage 回主线程渲染，用户不必干等全部跑完。
      signal: null,
      onPartial: (parts) => {
        try { self.postMessage({ type: "partial", runId, cands: parts }); }
        catch { /* 结构化克隆失败不阻塞 */ }
      },
    });
    self.postMessage({ type: "final", runId, cands });
  } catch (err) {
    self.postMessage({ type: "error", runId, message: (err && err.message) || String(err) });
  }
};

// 握手：注册表已加载，通知主线程 Worker 就绪（主线程可据此判断真多线程可用）。
self.postMessage({ type: "ready" });
