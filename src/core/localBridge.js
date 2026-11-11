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
// 与 bridge.py 默认两级上限对齐：软 128 MiB / 硬 512 MiB。
// 超过软上限先弹确认，确认后才带 X-EBCTF-Allow-Large: 1；硬上限任何请求都不能越过。
const REQUEST_SOFT_LIMIT = 128 * 1024 * 1024;
const REQUEST_HARD_LIMIT = 512 * 1024 * 1024;
const ALLOW_LARGE_HEADER = "X-EBCTF-Allow-Large";

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

// base64 后的字节长度（不做实际编码，便于发送前估算大请求）。
function b64LengthForBytes(n) {
  const len = Number(n) || 0;
  return Math.ceil(len / 3) * 4;
}

// 请求体大致字节数：args/tool 元信息 + stdin base64 + files base64（含键名）。
function estimateRequestBytes(tool, args, stdinBytes, filesMap) {
  let total = 64 + String(tool || "").length;
  try {
    total += JSON.stringify(args || []).length;
  } catch { /* 不可序列化时按 0 估 */ }
  if (stdinBytes && stdinBytes.length) total += 16 + b64LengthForBytes(stdinBytes.length);
  if (filesMap) {
    for (const [k, v] of Object.entries(filesMap)) {
      total += 8 + String(k).length + b64LengthForBytes(v && v.length);
    }
  }
  return total;
}

// 大请求确认：只有 window.confirm 返回 true 才继续；无确认环境按取消处理。
function confirmLargeRequest(approx, softLimit) {
  const approxMiB = (approx / (1024 * 1024)).toFixed(1);
  const softMiB = Math.round(softLimit / (1024 * 1024));
  const msg = `文件较大（约 ${approxMiB} MiB，超过本地桥软上限 ${softMiB} MiB），是否继续读取/发送？`;
  const host = (typeof window !== "undefined" && window) ? window : globalThis;
  if (host && typeof host.confirm === "function") {
    try { return { ok: !!host.confirm(msg), msg }; }
    catch (e) { return { ok: false, msg, error: String((e && e.message) || e) }; }
  }
  return { ok: false, msg, unavailable: true };
}

// 截断字段 → 可见提示（成功/失败响应都检查，绝不静默）。
function truncationNotice(j) {
  if (!j || typeof j !== "object") return "";
  const parts = [];
  if (j.stdoutTruncated) parts.push("stdout");
  if (j.stderrTruncated) parts.push("stderr");
  if (!parts.length && j.truncated) parts.push("输出");
  if (!parts.length && j.partial) parts.push("部分结果");
  if (!parts.length) return "";
  const cap = Number(j.outputLimit);
  const limitText = Number.isFinite(cap) && cap > 0 ? `（上限 ${cap} 字节）` : "";
  return `本地桥提示：${parts.join(" / ")} 已截断${limitText}，当前内容不完整。`;
}

// 调用 bridge /api/run。返回 {ok, stdout, stderr, exitCode} 或 {ok:false, error}。
// limits 仅供测试/特殊调用覆盖软硬阈值；正常调用不传，用默认 128/512 MiB。
async function bridgeRun(tool, args, stdinBytes, filesMap, limits) {
  const softLimit = limits && Number.isFinite(limits.soft) ? limits.soft : REQUEST_SOFT_LIMIT;
  const hardLimit = limits && Number.isFinite(limits.hard)
    ? Math.max(softLimit, limits.hard)
    : Math.max(softLimit, REQUEST_HARD_LIMIT);
  const approx = estimateRequestBytes(tool, args, stdinBytes, filesMap);
  if (approx > hardLimit) {
    const approxMiB = (approx / (1024 * 1024)).toFixed(1);
    const hardMiB = Math.round(hardLimit / (1024 * 1024));
    return { ok: false, error: `请求约 ${approxMiB} MiB，超过本地桥硬上限 ${hardMiB} MiB，已中止（未发送）。` };
  }
  let allowLarge = false;
  if (approx > softLimit) {
    const confirmed = confirmLargeRequest(approx, softLimit);
    if (!confirmed.ok) {
      const reason = confirmed.unavailable ? "当前环境不支持确认弹窗" : "已取消";
      const approxMiB = (approx / (1024 * 1024)).toFixed(1);
      const softMiB = Math.round(softLimit / (1024 * 1024));
      return { ok: false, error: `${reason}：请求约 ${approxMiB} MiB，超过软上限 ${softMiB} MiB，未发送。` };
    }
    allowLarge = true;
  }
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
      headers: {
        "Content-Type": "application/json",
        ...(allowLarge ? { [ALLOW_LARGE_HEADER]: "1" } : {}),
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try {
        const j = await r.json();
        if (j && j.error) msg += ": " + j.error;
        const note = truncationNotice(j);
        if (note) msg += "\n" + note;
      } catch { /* 非 JSON 错误体 */ }
      return { ok: false, error: msg };
    }
    let j;
    try {
      j = await r.json();
    } catch {
      return { ok: false, error: "bridge 返回非 JSON 响应" };
    }
    if (!j.ok) {
      let msg = j.error || "bridge error";
      const note = truncationNotice(j);
      if (note) msg += "\n" + note;
      return { ok: false, error: msg };
    }
    const stdout = b64decodeText(j.stdout);
    const stderr = b64decodeText(j.stderr);
    const notice = truncationNotice(j);
    const result = {
      ok: true,
      exitCode: j.exitCode,
      stdout,
      stderr: notice ? (stderr ? stderr + "\n\n" + notice : notice) : stderr,
    };
    if (notice) {
      result.truncated = true;
      result.notice = notice;
      result.outputLimit = j.outputLimit;
    }
    return result;
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

// bytes → base64（分块，避免大文件逐字节拼接导致卡死）
function b64encode(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
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
