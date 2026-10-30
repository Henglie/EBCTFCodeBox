/*
 * localBridge.js — 外部 exe 本地桥前端 op。
 *
 * 调用本地 bridge.py（独立服务，端口 8181，仅 Windows）执行白名单 exe。
 * bridge 未启动 / 非 Win 时，op 返回友好提示字符串，不抛错（灰置语义）。
 *
 * 约束：
 * - 仅调 localhost:8181，绝不外发。
 * - tool/args 透传 bridge 白名单校验（前端不自行执行 exe）。
 *
 * op：
 * exeBridge — 通用本地桥（tool/args/stdin/files 自由组合，cat:'bridgeForensic'，requiresBridge）
 */
import { register } from "./registry.js";

const BRIDGE_URL = "http://127.0.0.1:8181";  // 127.0.0.1 保证命中 bridge 监听的 IPv4 地址（localhost 可能解析到 ::1）
const BRIDGE_TIMEOUT = 70000; // 略大于 bridge 的 60s
const HEALTH_TIMEOUT = 1500;  // 探活必须快：桥未起时立刻返回，不拖启动

async function fetchJsonWithTimeout(url, ms, opts) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { ...(opts || {}), signal: ctrl.signal });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    try {
      return { ok: true, json: await r.json() };
    } catch {
      return { ok: false, error: "响应不是 JSON（8181 可能被其他程序占用）" };
    }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  } finally {
    clearTimeout(t);
  }
}

// 探测 bridge 是否在线。先试 /api/health（统一返回 ok:true），老桥 404 时
// fallback 到 /api/tools 并补 ok:true。只打 127.0.0.1，避免 localhost→::1 空等。
// 不抛错，返回 {ok, win, tools} 或 {ok:false, error}。
async function bridgeHealth() {
  let lastErr = "";
  const health = await fetchJsonWithTimeout(`${BRIDGE_URL}/api/health`, HEALTH_TIMEOUT, { cache: "no-store" });
  if (health.ok && health.json && health.json.ok === true) return health.json;
  if (!health.ok) lastErr = health.error;
  else lastErr = "health 响应异常";

  const tools = await fetchJsonWithTimeout(`${BRIDGE_URL}/api/tools`, HEALTH_TIMEOUT, { cache: "no-store" });
  if (tools.ok && tools.json && typeof tools.json === "object") {
    return { ok: true, ...tools.json };
  }
  if (!tools.ok) lastErr = tools.error;
  return { ok: false, error: `本地桥未运行（127.0.0.1:8181）：${lastErr || "无法连接"}` };
}

// 调用 bridge /api/run。返回 {ok, stdout, stderr, exitCode} 或 {ok:false, error}。
async function bridgeRun(tool, args, stdinBytes, filesMap) {
  const body = { tool, args: args || [] };
  if (stdinBytes && stdinBytes.length) {
    body.stdin = b64encode(stdinBytes);
  }
  if (filesMap) {
    const f = {};
    for (const [k, v] of Object.entries(filesMap)) f[k] = b64encode(v);
    body.files = f;
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT);
  try {
    const r = await fetch(`${BRIDGE_URL}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        if (j && j.error) msg += ": " + j.error;
      } catch { /* 非 JSON 错误体 */ }
      return { ok: false, error: msg };
    }
    let j;
    try {
      j = await r.json();
    } catch {
      return { ok: false, error: "bridge 返回非 JSON 响应" };
    }
    if (!j.ok) return { ok: false, error: j.error || "bridge error" };
    return {
      ok: true,
      exitCode: j.exitCode,
      stdout: b64decodeText(j.stdout),
      stderr: b64decodeText(j.stderr),
    };
  } catch (e) {
    const aborted = e && (e.name === "AbortError" || e.name === "TimeoutError");
    return {
      ok: false,
      error: aborted ? `本地桥 ${Math.round(BRIDGE_TIMEOUT / 1000)}s 未返回` : String((e && e.message) || e),
    };
  } finally {
    clearTimeout(t);
  }
}

// bytes → base64
function b64encode(bytes) {
  let bin = "";
  for (const x of bytes) bin += String.fromCharCode(x);
  return btoa(bin);
}
// base64 → utf8 文本（容错）
function b64decodeText(b64) {
  try {
    const bin = atob(b64 || "");
    const o = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
    return new TextDecoder("utf-8", { fatal: false }).decode(o);
  } catch (e) {
    return "";
  }
}

// 2026-09-13 桥大清除（产品负责人令）·CLI 桥全线退役：
// steghide/foremost/snow/jsteg/mp3stego/bkcrack/dtmf2num 七个 *Bridge op 与「本地桥·通用命令行」
// （exeBridge）已删——现桥协议 /api/run 的产物落盘后无读回通道且 finally rmtree 清场，CLI 型
// 桥对用户是空壳（复验实锤）；snow/jsteg/bkcrack/dtmf2num/foremost 另有纯 JS/wasm 实现
// （snow.js/foremostJs.js/bkcrack wasm/dtmfWav）。仅存 5 个 GUI 型 *Launch 桥（exeTools.js，
// /api/launch 拉窗口，用户在原生窗口操作）。decodeInput/fmtBridgeRun/makeBridgeToolOp
// 随 CLI 桥一并退役删除。

export { bridgeHealth, bridgeRun };
