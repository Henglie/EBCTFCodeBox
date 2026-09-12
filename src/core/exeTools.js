/*
 * exeTools.js — 外部 exe 本地桥 op（件内自注册）。
 *
 * 把 localBridge.js 通用 exeBridge 未单列的 exe 做成独立 op
 * 每个 op 打 requiresBridge:true 徽章标记（渲染层据此画「EXE」徽章：
 * 非 Windows / 未起桥的机器点不动，标出来避免被当 bug）。
 *
 * 两类形态：
 * CLI 型（有命令行、可无人值守）：调 /api/run（bridgeRun），有输入输出。
 * - bftools Brainfuck 工具集（run/encode/decode…），BF 源码走 stdin
 * - npiet Piet 图像语言解释器，吃图像文件执行回 stdout
 * - stegdetect JPEG 隐写检测（jsteg/jphide/outguess…），吃 jpg 回报告
 * GUI 型（纯图形界面 / 私有格式，无无人值守 CLI）：调 /api/launch，仅拉起 exe
 * 用户在弹出窗口里自己操作，run 函数只回「已启动」提示。
 * - watermarkH 吾爱出品图像水印隐写 GUI
 * - jphswin JPHS for Windows，JPEG 图像隐写 GUI
 * - openpuff OpenPuff 多载体隐写 GUI
 * - oursecret OurSecret GUI 隐写（私有格式，无法纯前端复刻）
 *
 * 约束：
 * - 仅 fetch localhost:8181，绝不外发。
 * - tool/args 透传桥的白名单校验，前端不自行执行 exe。
 * - bridge 未起 / 非 Win 时，op 返回友好提示字符串，不抛错（灰置语义）。
 */
import { register } from "./registry.js";

const BRIDGE_URL = "http://localhost:8181";
const BRIDGE_TIMEOUT = 70000; // 略大于桥的 60s
const LAUNCH_TIMEOUT = 8000;  // 启动 GUI 很快，短超时

// ---- base64 编解码（本模块自持，不依赖 localBridge.js 内部函数）----
function b64encode(bytes) {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
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
const te = new TextEncoder();
function decodeInput(text, enc) {
  switch (enc) {
    case "base64": {
      const bin = atob((text || "").replace(/\s/g, ""));
      const o = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i);
      return o;
    }
    case "hex": {
      const c = (text || "").replace(/[^0-9a-fA-F]/g, "");
      const o = new Uint8Array(Math.floor(c.length / 2));
      for (let i = 0; i < o.length; i++) o[i] = parseInt(c.substr(i * 2, 2), 16);
      return o;
    }
    case "utf8":
    default:
      return te.encode(text || "");
  }
}

// ---- 调桥 /api/run（CLI 型）。返回 {ok, stdout, stderr, exitCode} 或 {ok:false, error} ----
async function bridgeRun(tool, args, stdinBytes, filesMap) {
  const body = { tool, args: args || [] };
  if (stdinBytes && stdinBytes.length) body.stdin = b64encode(stdinBytes);
  if (filesMap) {
    const f = {};
    for (const [k, v] of Object.entries(filesMap)) f[k] = b64encode(v);
    body.files = f;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT);
    const r = await fetch(`${BRIDGE_URL}/api/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const j = await r.json();
    if (!j.ok) return { ok: false, error: j.error || "bridge error" };
    return {
      ok: true,
      exitCode: j.exitCode,
      stdout: b64decodeText(j.stdout),
      stderr: b64decodeText(j.stderr),
    };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// ---- 调桥 /api/launch（GUI 型）。返回 {ok, launched, path} 或 {ok:false, error} ----
async function bridgeLaunch(tool) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), LAUNCH_TIMEOUT);
    const r = await fetch(`${BRIDGE_URL}/api/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const j = await r.json();
    if (!j.ok) return { ok: false, error: j.error || "launch error" };
    return { ok: true, launched: true, path: j.path };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

// CLI 型统一的未就绪提示
const BRIDGE_HINT =
  "（本功能仅本地运行 + 仅 Windows 可用。需先在本机运行 python bridge.py，启动后刷新本页。）";

// CLI 结果 → 可读文本
function fmtRun(r) {
  if (!r.ok) return `● 本地桥未就绪：${r.error}\n${BRIDGE_HINT}`;
  const stderr = r.stderr && r.stderr.trim() ? `\n\n[stderr]\n${r.stderr}` : "";
  return `[exit ${r.exitCode}]\n${r.stdout}${stderr}`;
}

// ============================================================
// CLI 型 op
// ============================================================

// ============================================================
// GUI 型 op（launch 型）：点击拉起本机 exe，用户手动操作
// ============================================================

// 生成一个「启动型」op：无输入输出，run 调 /api/launch，回启动提示。
function makeLaunchOp({ id, cat, name, tool, blurb }) {
  register({
    id,
    cat,
    name,
    desc:
      `${blurb} 本工具为纯 GUI 程序（私有格式 / 无无人值守命令行），本功能仅「启动本机 exe」，` +
      `点击后在弹出的窗口里手动操作，工具箱不代为喂输入或取结果。仅 Windows，需先起 python bridge.py。`,
    params: [],
    requiresBridge: true,
    run: async () => {
      const r = await bridgeLaunch(tool);
      if (!r.ok) return `● 无法启动 ${name}：${r.error}\n${BRIDGE_HINT}`;
      return `● 已启动本机 exe：${name}\n路径：${r.path || tool}\n请在弹出的程序窗口里手动操作（本工具箱不代为处理输入输出）。`;
    },
  });
}

makeLaunchOp({
  id: "watermarkhLaunch", cat: "bridgeStego", tool: "watermarkh",
  name: "watermarkH · 水印",
  blurb: "吾爱出品的图像水印隐写工具。",
});
makeLaunchOp({
  id: "jphswinLaunch", cat: "bridgeStego", tool: "jphswin",
  name: "JPHS · JPEG 隐写",
  blurb: "JPHS for Windows（jphide/jpseek），把数据藏进 JPEG。",
});
// ntfsstreamsLaunch（NTFS 数据流 GUI exe）2026-09-13 删除：纯 JS adsTool（forensic 类）已
// 完整替代检测/提取/删除/添加四能力，bridgeForensic 分类随之撤销（恒烈裁决）。
makeLaunchOp({
  id: "openpuffLaunch", cat: "bridgeStego", tool: "openpuff",
  name: "OpenPuff · 多载体",
  blurb: "OpenPuff 多载体隐写（图/音/视/PDF/flash 等），支持多层密码。",
});
makeLaunchOp({
  id: "oursecretLaunch", cat: "bridgeStego", tool: "oursecret",
  name: "OurSecret · 隐写",
  blurb: "OurSecret GUI 隐写工具，私有格式无法纯前端复刻。",
});

export { bridgeRun, bridgeLaunch };
