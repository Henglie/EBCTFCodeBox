/*
 * core/magic/magicWorker.js — 一键解码真多线程 Worker（产品裁决：真多线程看门狗）
 *
 * 模块 Worker（type:"module"）：导入完整算法注册表 registerAll + magicDecode，
 * 在**独立线程**跑智能解码，主线程完全不阻塞——倒计时流畅、UI 不冻、可随时硬杀接管。
 *
 * 协议（主线程 magicClient.js ↔ 本 Worker）：
 *   主 → Worker： { type:"run", runId, input, opts }
 *                 { type:"pause",  runId }            协作式暂停（yield 点生效）
 *                 { type:"resume", runId }            继续
 *   Worker → 主： { type:"partial",  runId, cands }   流式部分结果（节流增量）
 *                 { type:"progress", runId, phase, done, total, opId, label, percent }
 *                 { type:"final",    runId, cands }   跑完的最终结果
 *                 { type:"error",    runId, message } 解码异常
 *                 { type:"ready" }                    Worker 注册表加载完成（可选握手）
 *
 * 向后兼容：旧客户端只发 run、只认 partial/final/error/ready；新增 pause/resume/progress
 * 只增不改，旧消息语义不变。
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

// 当前在途运行的暂停控制对象。pause/resume 消息只改其 paused 布尔，magicDecode 在
// yield 点轮询（定时器让出，非忙等）；暂停期间 done/progress 不推进。
let active = null;   // { runId, control:{paused} }

self.onmessage = async (e) => {
  const msg = e.data || {};
  if (msg.type === "pause" || msg.type === "resume") {
    if (active && (msg.runId == null || msg.runId === active.runId)) {
      active.control.paused = msg.type === "pause";
    }
    return;
  }
  if (msg.type !== "run") return;
  const { runId, input, opts } = msg;
  const control = { paused: false };
  active = { runId, control };
  try {
    const cands = await magicDecode(input, {
      ...opts,
 // Worker 里不需要 signal（中断=主线程 terminate），但软死线 onPartial 仍有用：
 // 流式 partial 与 progress 都 postMessage 回主线程渲染，用户不必干等全部跑完。
      signal: null,
      _control: control,
      onPartial: (parts) => {
        try { self.postMessage({ type: "partial", runId, cands: parts }); }
        catch { /* 结构化克隆失败不阻塞 */ }
      },
      onProgress: (p) => {
        try {
          self.postMessage({
            type: "progress", runId,
            phase: p.phase, done: p.done, total: p.total,
            opId: p.opId, label: p.label, percent: p.percent,
          });
        } catch { /* 结构化克隆失败不阻塞 */ }
      },
    });
    self.postMessage({ type: "final", runId, cands });
  } catch (err) {
    self.postMessage({ type: "error", runId, message: (err && err.message) || String(err) });
  } finally {
    if (active && active.runId === runId) active = null;
  }
};

// 握手：注册表已加载，通知主线程 Worker 就绪（主线程可据此判断真多线程可用）。
self.postMessage({ type: "ready" });
