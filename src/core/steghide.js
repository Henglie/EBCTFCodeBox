/*
 * steghide.js — steghide 0.5.1 隐写双向（单线程 WASM + 模块 Worker）。
 *
 * 内核 = steghide 0.5.1 编译的单线程 WASM；引擎在 public/wasm/steghide/。
 * 契约要点（候选四路矩阵实测）：
 *  - 载体：JPEG（FF D8）与 WAV（RIFF）；其余格式显式拒绝。
 *  - 上游缺 -p 会永久阻塞 stdin → 所有调用强制带 -p（空口令传空串）。
 *  - 作业后必须显式 _fflush(0)（上游从不 fclose，EXIT_RUNTIME=0 小载荷读回 0 字节）。
 *  - 载荷经口令派生加密（默认 AES），但无独立 MAC：「取出 N 字节」不代表口令已认证。
 *  - 失败的残留文件不得当产物（Worker 侧已拦）。
 */
import { register } from "./registry.js";
import { decodeUtf8Lossless } from "./bytesIo.js";

// BOM 保真的严格 UTF-8 解码（bytesIo 单一源）：非法序列抛 TypeError（同旧 fatal TextDecoder 语义），
// 唯一行为差异是合法 BOM（U+FEFF 开头）不再被静默吞掉。
function _decodeUtf8Fatal(bytes) {
  const r = decodeUtf8Lossless(bytes);
  if (!r.ok) throw new TypeError(r.reason);
  return r.text;
}

// 懒加载 worker 不在 sw-assets REV 清单内，运行时 cache-first 会供旧缓存——
// URL 带击穿参数（worker 内容变更时必须 bump 此 token），强制绕开旧缓存。
const WORKER_URL = new URL("../../public/wasm/steghide/steghide.worker.js?v=20260927b", import.meta.url).href;
const JOB_TIMEOUT_MS = 120000;
const BS = String.fromCharCode(92);
const RE_WS = new RegExp(BS + "s+", "g");

class SteghideError extends Error {
  constructor(message, info) { super(message); this.name = "SteghideError"; this.info = info || {}; }
}

let seq = 0;

function runSteghideJob(job, workerUrl, opts = {}) {
  const timeoutMs = (opts && opts.timeoutMs) || 0;
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const worker = new Worker(workerUrl, { type: "module" });
    let settled = false; let timer = null;
    const cleanup = () => { if (timer) clearTimeout(timer); worker.terminate(); };
    const fail = (err) => { if (settled) return; settled = true; cleanup(); reject(err); };
    const done = (res) => { if (settled) return; settled = true; cleanup(); resolve(res); };
    if (timeoutMs > 0) timer = setTimeout(() => fail(new SteghideError("超时（" + timeoutMs + " ms）后硬终止 Worker", { reason: "timeout" })), timeoutMs);
    worker.onerror = (ev) => fail(new SteghideError("Worker 错误：" + ((ev && ev.message) || "未知"), { reason: "worker" }));
    worker.onmessage = (ev) => {
      const r = ev.data;
      if (r.error) return fail(new SteghideError("作业失败：" + r.error, { reason: "job", info: r }));
      if (!r.ok) return fail(new SteghideError("steghide 退出码 " + r.rc, { reason: "rc", rc: r.rc, log: r.log, trapped: r.trapped }));
      done({ bytes: new Uint8Array(r.bytes), rc: r.rc, log: r.log || [] });
    };
    const carrier = job.carrier.slice();
    const payload = job.payload ? job.payload.slice() : null;
    const transfer = [carrier.buffer];
    if (payload) transfer.push(payload.buffer);
    worker.postMessage({ id, op: job.op, carrier, payload, ext: job.ext, key: job.key }, transfer);
  });
}

function carrierExt(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45) return "wav";
  return null;
}

function isB64Char(c) {
  if (c >= "A" && c <= "Z") return true;
  if (c >= "a" && c <= "z") return true;
  if (c >= "0" && c <= "9") return true;
  return c === "+" || c === "/" || c === "=" || c.charCodeAt(0) < 33;
}

function b64ToBytes(s) {
  let str = String(s == null ? "" : s).trim().replace(RE_WS, "");
  const comma = str.indexOf(",");
  if (comma >= 0 && str.slice(0, 5).toLowerCase() === "data:") str = str.slice(comma + 1);
  if (!str) return new Uint8Array(0);
  let bin;
  if (typeof atob === "function") bin = atob(str);
  else if (typeof Buffer !== "undefined") bin = Buffer.from(str, "base64").toString("binary");
  else return new Uint8Array(0);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

function carrierBytesOf(text, p) {
  if (p && p.rawBytes && p.rawBytes.length) return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  const t = String(text == null ? "" : text).trim();
  if (t.toLowerCase().startsWith("data:") || (t.length >= 16 && Array.prototype.every.call(t, isB64Char))) {
    const b = b64ToBytes(t);
    if (b.length) return b;
  }
  return new Uint8Array(0);
}

function utf8Bytes(s) { return new TextEncoder().encode(String(s == null ? "" : s)); }

function utf8TextMaybe(bytes) {
  try { return _decodeUtf8Fatal(bytes); } catch (e) { return ""; }
}

function friendlyJobError(e) {
  const log = (e && e.info && e.info.log) || [];
  const tail = log.slice(-3).join(" / ");
  const all = log.join(" ");
  if (all.indexOf("could not extract any data") >= 0 || all.indexOf("does not contain") >= 0) return "提取失败：该文件里没有能用这个口令取出的数据（口令不对，或不是本工具的 steghide 产物；注意嵌入口令与提取口令须一致）。";
  if (all.indexOf("the cover file is too small") >= 0 || all.indexOf("too small") >= 0) return "容量不足：载体太小装不下该载荷，换更大载体或缩短载荷。";
  return ((e && e.message) || "steghide 失败") + (tail ? "｜日志：" + tail : "");
}

const EXT_MIME = { jpg: "image/jpeg", wav: "audio/wav" };

async function shEncode(text, p = {}) {
  const carrier = carrierBytesOf(text, p);
  if (!carrier.length) throw new Error("缺少载体：请拖入/选择 JPEG 图片或 WAV 音频，或粘贴其 base64/dataURL");
  const ext = carrierExt(carrier);
  if (!ext) throw new Error("载体魔数不被支持：steghide 支持 JPEG（FF D8）与 WAV（RIFF）");
  const msg = String(p.message == null ? "" : p.message);
  if (!msg.length) throw new Error("载荷为空：请填写要嵌入的消息");
  const payload = utf8Bytes(msg);
  const key = String(p.key == null ? "" : p.key);
  let r;
  try {
    r = await runSteghideJob({ op: "embed", carrier, payload, ext, key }, WORKER_URL, { timeoutMs: JOB_TIMEOUT_MS });
  } catch (e) { throw new Error(friendlyJobError(e)); }
  const name = "steghide_out." + ext;
  return {
    text: "已嵌入 " + payload.length + " 字节载荷（UTF-8）到 " + ext.toUpperCase() + " 载体。\n载荷经口令派生加密，但无独立认证标签（无 MAC）：取出字节不等于口令已认证。\n日志：" + (r.log.slice(-2).join(" / ") || "（无）"),
    files: [{ name, mime: EXT_MIME[ext] || "application/octet-stream", bytes: r.bytes }],
  };
}

async function shDecode(text, p = {}) {
  const data = carrierBytesOf(text, p);
  if (!data.length) throw new Error("缺少输入：请拖入/选择 steghide 产物文件，或粘贴其 base64/dataURL");
  const ext = carrierExt(data);
  if (!ext) throw new Error("输入魔数不被支持：steghide 支持 JPEG 与 WAV 产物");
  const key = String(p.key == null ? "" : p.key);
  let r;
  try {
    r = await runSteghideJob({ op: "decode", carrier: data, ext, key }, WORKER_URL, { timeoutMs: JOB_TIMEOUT_MS });
  } catch (e) { throw new Error(friendlyJobError(e)); }
  const out = r.bytes;
  const asText = utf8TextMaybe(out);
  const lines = ["取出 " + out.length + " 字节。", "无独立认证标签（无 MAC）：「取出 N 字节」不代表口令已认证，请以内容判读。"];
  if (asText) lines.push("按 UTF-8 严格解码成功，内容：\n" + asText);
  else lines.push("内容不是有效 UTF-8 文本（疑似二进制载荷），请从下方下载后另行分析。");
  return { text: lines.join("\n"), files: [{ name: "steghide_payload.bin", mime: "application/octet-stream", bytes: out }] };
}

register({
  id: "steghide",
  cat: "stegoFile",
  name: "steghide 隐写（双向）",
  desc:
    "steghide 0.5.1 隐写双向：把消息嵌入 JPEG（DCT 系数）或 WAV（样本 LSB），支持口令派生加密与" +
    "可选压缩；extract 用同一口令取回。载体按魔数分派，仅支持 JPEG 与 WAV。载荷无独立认证标签：" +
    "取出字节不等于口令已认证。引擎为本地 WASM（单线程）。",
  acceptsBytes: true,
  textTransit: true,
  aka: [
    "steghide", "steghide 0.5.1", "steghide隐写", "JPEG隐写 steghide", "WAV隐写",
    "音频隐写 steghide", "steghide extract", "steghide解密", "图种隐写 steghide",
    "已知口令隐写 steghide", "音频LSB steghide", "steghide密码",
  ],
  params: [
    { sensitive: true, key: "key", label: "口令（encode/decode 两侧须一致）", type: "password", default: "", placeholder: "空串按未设口令处理" },
    { key: "message", label: "要嵌入的消息（encode 用）", type: "text", default: "", placeholder: "如 flag{...}（按 UTF-8 编码为字节）" },
  ],
  encode: shEncode,
  decode: shDecode,
});

export default { runSteghideJob, carrierExt };
