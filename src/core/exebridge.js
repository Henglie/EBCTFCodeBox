/*
 * exebridge.js — pyc/exe 自动反编前端 op（件内自注册）。
 *
 * 调本地 bridge.py 的 /api/decompile（独立服务，127.0.0.1:8181，仅 Windows）：
 * 前端把 .pyc/.exe 读成 base64 → POST bridge → 桥 xdis 查 magic 定 Python 版本
 * → 3.4-3.8 走 uncompyle6/decompyle3；3.9+ 走 pylingual（实验，需手动装）
 * → 都不可用时回退 pycdc（Decompyle++）
 * → PyInstaller exe 先 Pyinstxtractor 解包再逐 pyc 反编 → 返 py 源码。
 * 反编前先 GET /api/health 短探活（2s）：桥没起立即明确报错，不空等 130s。
 *
 * 形态判定：
 * - bridge 不可用（纯静态分发 / 未起桥）→ op 返回明确提示「仅本地运行 + 仅 Windows」，不抛错。
 * - 非 Windows → 桥端点直接拒绝，前端如实透传提示。
 *
 * 零外发：
 * - 仅 fetch 127.0.0.1:8181，绝不外发用户样本或反编结果到任何远端。
 * - pylingual 的 HF 镜像仅桥侧用于其自身模型拉取，不上传样本（见 bridge.py）。
 *
 * op：
 * pycExeDecompile — pyc/exe 反编（cat:'analysis'，file base64 输入）
 * 导出：
 * decompileEnv —— 探反编工具链可用性（供灰置/实验标记）
 * decompileBytes(bytes,...) —— 在 handleFile 里按 .pyc/.exe 分派调用
 */
import { register } from "./registry.js";

// 固定 127.0.0.1：bridge.py 只监听 IPv4 回环；localhost 在部分 Windows 环境先解析到
// ::1，浏览器会白等到超时（旧版报 request timeout 的诱因之一）。
const BRIDGE_URL = "http://127.0.0.1:8181";
const HEALTH_TIMEOUT = 3000;
const PREFLIGHT_TIMEOUT = 2000; // 桥未起时快速失败，不等满反编超时
const PREFLIGHT_CACHE_MS = 10000; // 刚探活成功就在短窗口内复用，避免每次拖文件多一跳
const DECOMPILE_TIMEOUT = 130000; // 略大于桥的 120s（exe 多 pyc 分支）

let _bridgeUpAt = 0; // 最近一次健康检查成功的时间戳（ms）

// ---- base64 编解码（与 localBridge.js 同形，本模块自持）----
function b64encode(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
function decodeB64Input(text) {
  const bin = atob((text || "").replace(/\s/g, ""));
  const o = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
  return o;
}

async function fetchWithTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...(opts || {}), signal: ctrl.signal });
  } finally {
    clearTimeout(id);
  }
}

function describeFetchError(e) {
  const name = (e && e.name) || "";
  if (name === "AbortError" || name === "TimeoutError") return "连接超时";
  return String((e && e.message) || e);
}

/** 单次健康探测。必须拿到 JSON 且 ok:true 才认作本地桥（避免 8181 被别的服务占用时误判）。 */
async function probeBridge(ms) {
  try {
    const r = await fetchWithTimeout(BRIDGE_URL + "/api/health", ms, { cache: "no-store" });
    if (!r.ok) return { ok: false, error: "健康检查 HTTP " + r.status };
    let j = null;
    try { j = await r.json(); } catch { /* 非 JSON：不是本地桥 */ }
    if (!j || j.ok !== true) return { ok: false, error: "健康检查响应不是本地桥（端口 8181 可能被占用）" };
    return { ok: true, info: j };
  } catch (e) {
    return { ok: false, error: describeFetchError(e) };
  }
}

/**
 * 反编前先短探活：桥没起时立刻给明确提示，绝不把 130s 超时耗满。
 * 成功结果缓存 10s，避免连续拖文件时每次多一跳。
 */
async function ensureBridge() {
  if (Date.now() - _bridgeUpAt < PREFLIGHT_CACHE_MS) return { ok: true, cached: true };
  const h = await probeBridge(PREFLIGHT_TIMEOUT);
  if (h.ok) _bridgeUpAt = Date.now();
  return h;
}

/** 探反编工具链可用性（GET /api/decompile-env）。返回桥结果或 {ok:false,...}。 */
async function decompileEnv() {
  try {
    const r = await fetchWithTimeout(BRIDGE_URL + "/api/decompile-env", HEALTH_TIMEOUT, { cache: "no-store" });
    if (!r.ok) return { ok: false, bridge: true, error: "HTTP " + r.status };
    const j = await r.json();
    j.bridge = true;
    return j;
  } catch (e) {
 // 桥不可用（纯静态分发 / 未起桥）
    return { ok: false, bridge: false, error: describeFetchError(e) };
  }
}

/**
 * 反编字节流。kind: 'pyc'|'exe'|'auto'（默认 auto，桥按 MZ 头自判）。
 * 返回桥结果对象或 {ok:false, bridge:false, error}（桥不可用时）。
 */
async function decompileBytes(bytes, name, kind) {
  const online = await ensureBridge();
  if (!online.ok) {
    return {
      ok: false,
      bridge: false,
      error: "无法连接 127.0.0.1:8181（" + (online.error || "本地桥未运行") + "）",
    };
  }
  const body = {
    kind: kind || "auto",
    name: name || "",
    data: b64encode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || [])),
  };
  try {
    const r = await fetchWithTimeout(BRIDGE_URL + "/api/decompile", DECOMPILE_TIMEOUT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      let msg = "HTTP " + r.status;
      try {
        const j = await r.json();
        if (j && (j.error || j.message)) msg += ": " + (j.error || j.message);
      } catch { /* 非 JSON 错误体 */ }
      return { ok: false, bridge: true, httpStatus: r.status, error: msg };
    }
    let j;
    try {
      j = await r.json();
    } catch {
      return { ok: false, bridge: true, error: "桥返回非 JSON 响应" };
    }
    if (!j || typeof j !== "object") return { ok: false, bridge: true, error: "桥返回空响应" };
    if (j.bridge === undefined) j.bridge = true; // 已收到响应 → 桥可达
    return j;
  } catch (e) {
    const aborted = (e && (e.name === "AbortError" || e.name === "TimeoutError")) || false;
    if (aborted) {
      return {
        ok: false,
        bridge: true,
        timeout: true,
        error: "本地桥 " + Math.round(DECOMPILE_TIMEOUT / 1000) +
          "s 未返回（反编子进程卡住，或 8181 被其他程序占用）",
      };
    }
    return { ok: false, bridge: false, error: describeFetchError(e) };
  }
}

// ---- 结果 → 可读文本（op 输出 / 报告卡通用）----
function formatResult(res, srcName) {
  if (!res) return "● 反编失败：无响应";
  if (res.bridge === false) {
    return "● 本地桥未就绪：" + (res.error || "无法连接") +
      "\n（本功能仅本地运行 + 仅 Windows 可用。需先在本机运行 python bridge.py，启动后刷新本页。）";
  }
  if (!res.ok && res.error) {
    let s = "● 反编未完成：" + res.error;
    if (res.experimental) s += "\n（实验功能，需手动安装对应工具链。）";
    if (res.pyVersion) s += "\n检测到 Python 版本：" + res.pyVersion;
    return s;
  }
 // exe：多 pyc 汇总
  if (Array.isArray(res.files)) {
    const head = "[PyInstaller 解包 · " + res.files.length + " 个 pyc]" +
      (res.note ? "  " + res.note : "");
    const parts = res.files.map((f) => {
      const title = "──── " + (f.name || "?") +
        (f.pyVersion ? "  (Python " + f.pyVersion + ")" : "") +
        (f.tool ? "  via " + f.tool : "") + " ────";
      if (f.source && f.source.trim()) return title + "\n" + f.source;
      return title + "\n（未反编：" + (f.error || f.note || f.stderr || "无输出") + "）";
    });
    return head + "\n\n" + parts.join("\n\n");
  }
 // 单 pyc
  const meta = [];
  if (res.pyVersion) meta.push("Python " + res.pyVersion);
  if (res.magic) meta.push("magic " + res.magic);
  if (res.tool) meta.push("via " + res.tool);
  const head = "[" + (srcName || "input") + (meta.length ? " · " + meta.join(" · ") : "") + "]";
  if (res.source && res.source.trim()) {
    const err = res.stderr && res.stderr.trim() ? "\n\n[stderr]\n" + res.stderr.trim() : "";
    return head + "\n" + res.source + err;
  }
  return head + "\n（未反编：" + (res.error || res.note || res.stderr || "无输出") + "）";
}

register({
  id: "pycExeDecompile",
  cat: "filefmt",
  name: "pyc/exe 反编（本地桥）",
  desc: "拖入 .pyc 或 PyInstaller 打包 .exe，经本地 bridge.py 自动判 Python 版本并反编为源码（uncompyle6/decompyle3，3.9+ 走 pylingual 实验链路；仅 Windows，需先起 python bridge.py）",
  params: [
    { key: "file", label: "文件 base64（拖入 .pyc/.exe 后填）", type: "text", default: "",
      placeholder: "文件的 Base64；或直接用文件拖放区" },
    { key: "kind", label: "类型", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（按文件头判定）" },
        { value: "pyc", label: "pyc 字节码" },
        { value: "exe", label: "PyInstaller exe" },
      ] },
    { key: "name", label: "文件名（可选，辅助命名）", type: "text", default: "",
      placeholder: "如 main.pyc" },
  ],
  run: async (text, p) => {
    const raw = (p && p.rawBytes && p.rawBytes.length)
      ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
      : null;
    const b64 = (p.file != null && p.file !== "") ? p.file : (raw ? "" : (text || ""));
    if (!raw && (!b64 || !b64.trim())) {
      return "● 请提供 .pyc / .exe 文件（拖入输入框或点「选择文件」），或用文件拖放区粘贴其 Base64。本功能仅本地运行 + 仅 Windows 可用。";
    }
    let bytes;
    try {
      bytes = raw || decodeB64Input(b64);
    } catch (e) {
      return "● Base64 解析失败：" + String(e);
    }
    const name = (p && p.name) || (p && p.rawFileName) || "";
    const res = await decompileBytes(bytes, name, p.kind || "auto");
    return formatResult(res, name || "input");
  },
  acceptsBytes: true,
});

export { decompileEnv, decompileBytes, formatResult };
