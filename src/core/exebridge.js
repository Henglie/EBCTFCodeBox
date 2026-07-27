/*
 * exebridge.js — pyc/exe 自动反编前端 op（件内自注册）。
 *
 * 调本地 bridge.py 的 /api/decompile（独立服务，端口 8181，仅 Windows）：
 * 前端把 .pyc/.exe 读成 base64 → POST bridge → 桥 xdis 查 magic 定 Python 版本
 * → 3.4-3.8 走 uncompyle6/decompyle3；3.9+ 走 pylingual（实验，需手动装）
 * → PyInstaller exe 先 PyInstxtractor 解包再逐 pyc 反编 → 返 py 源码。
 *
 * 形态判定：
 * - bridge 不可用（纯静态分发 / 未起桥）→ op 返回明确提示「仅本地运行 + 仅 Windows」，不抛错。
 * - 非 Windows → 桥端点直接拒绝，前端如实透传提示。
 *
 * 零外发：
 * - 仅 fetch localhost:8181，绝不外发用户样本或反编结果到任何远端。
 * - pylingual 的 HF 镜像仅桥侧用于其自身模型拉取，不上传样本（见 bridge.py）。
 *
 * op：
 * pycExeDecompile — pyc/exe 反编（cat:'analysis'，file base64 输入）
 * 导出：
 * decompileEnv —— 探反编工具链可用性（供灰置/实验标记）
 * decompileBytes(bytes,...) —— 在 handleFile 里按 .pyc/.exe 分派调用
 */
import { register } from "./registry.js";

const BRIDGE_URL = "http://localhost:8181";
const HEALTH_TIMEOUT = 3000;
const DECOMPILE_TIMEOUT = 130000; // 略大于桥的 120s

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

/** 探反编工具链可用性（GET /api/decompile-env）。返回桥结果或 {ok:false,...}。 */
async function decompileEnv() {
  try {
    const r = await fetchWithTimeout(BRIDGE_URL + "/api/decompile-env", HEALTH_TIMEOUT, { cache: "no-store" });
    if (!r.ok) return { ok: false, bridge: false, error: "HTTP " + r.status };
    const j = await r.json();
    j.bridge = true;
    return j;
  } catch (e) {
 // 桥不可用（纯静态分发 / 未起桥）
    return { ok: false, bridge: false, error: String(e) };
  }
}

/**
 * 反编字节流。kind: 'pyc'|'exe'|'auto'（默认 auto，桥按 MZ 头自判）。
 * 返回桥结果对象或 {ok:false, bridge:false, error}（桥不可用时）。
 */
async function decompileBytes(bytes, name, kind) {
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
    const j = await r.json();
    return j;
  } catch (e) {
    return { ok: false, bridge: false, error: String(e) };
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
  cat: "forensic",
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
    const b64 = (p.file != null && p.file !== "") ? p.file : (text || "");
    if (!b64 || !b64.trim()) {
      return "● 请提供 .pyc / .exe 文件的 Base64（或用文件拖放区）。本功能仅本地运行 + 仅 Windows 可用。";
    }
    let bytes;
    try {
      bytes = decodeB64Input(b64);
    } catch (e) {
      return "● Base64 解析失败：" + String(e);
    }
    const res = await decompileBytes(bytes, p.name || "", p.kind || "auto");
    return formatResult(res, p.name || "input");
  },
});

export { decompileEnv, decompileBytes, formatResult };
