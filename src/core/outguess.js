/*
 * outguess.js — OutGuess 0.4 隐写双向（单线程 WASM + 模块 Worker）
 *
 * 内核 = outguess 0.4（固定提交 24810e14）编译的单线程 WASM，上游算法源码零改动；
 * 引擎、胶水与许可原文（BSD-4-Clause 强制署名 + IJG 通知）在 public/wasm/outguess/。
 *
 * 契约要点（原生 + WASM 四路对拍实测）：
 *  - 载体类型上游只认扩展名（jpg / ppm / pnm）→ 前端按魔数映射：FF D8 为 jpg，
 *    P2/P3/P5/P6 为 ppm；P1/P4（PBM）上游不支持，显式拒绝。
 *  - JPEG 产物按质量重编码（默认 75，下限硬钳 75），不是载体字节副本。
 *  - 载荷无 MAC：取出 N 字节不等于口令已认证，文案不得写「口令正确」。
 *  - 空载荷会让上游整数除零崩溃 → 前端先拦。
 *  - 失败后的残留 0 字节文件不得当产物（Worker 侧已拦）。
 *  - ECC（Golay 纠错）内核可用，首批不在参数面暴露。
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
const WORKER_URL = new URL("../../public/wasm/outguess/outguess.worker.js?v=20260927b", import.meta.url).href;
const JOB_TIMEOUT_MS = 120000;
const BS = String.fromCharCode(92);
const RE_WS = new RegExp(BS + "s+", "g");

class OutguessError extends Error {
  constructor(message, info) {
    super(message);
    this.name = "OutguessError";
    this.info = info || {};
  }
}

let seq = 0;

// 每作业一个全新 Worker 实例：上游进程级状态多（steg_stat / JPEG quality / 位图指针），
// 复用实例会跨作业污染；新实例同时带来全新 MEMFS，天然隔离。
function runOutguessJob(job, workerUrl, opts = {}) {
  const timeoutMs = (opts && opts.timeoutMs) || 0;
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const worker = new Worker(workerUrl, { type: "module" });
    let settled = false;
    let timer = null;
    const cleanup = () => { if (timer) clearTimeout(timer); worker.terminate(); };
    const fail = (err) => { if (settled) return; settled = true; cleanup(); reject(err); };
    const done = (res) => { if (settled) return; settled = true; cleanup(); resolve(res); };
    if (timeoutMs > 0) timer = setTimeout(() => fail(new OutguessError("超时（" + timeoutMs + " ms）后硬终止 Worker", { reason: "timeout" })), timeoutMs);
    worker.onerror = (ev) => fail(new OutguessError("Worker 错误：" + ((ev && ev.message) || "未知"), { reason: "worker" }));
    worker.onmessage = (ev) => {
      const r = ev.data;
      if (r.error) return fail(new OutguessError("作业失败：" + r.error, { reason: "job", info: r }));
      if (!r.ok) return fail(new OutguessError("outguess 退出码 " + r.rc + (r.trapped ? "（上游崩溃）" : ""), { reason: "rc", rc: r.rc, log: r.log, trapped: r.trapped }));
      done({ bytes: new Uint8Array(r.bytes), rc: r.rc, log: r.log || [] });
    };
    // 先复制再 transfer：postMessage 的 transfer 会把调用方 ArrayBuffer 打挂，
    // 同一载荷嵌多图是真实用法，不能销毁调用方缓冲。
    const carrier = job.carrier.slice();
    const payload = job.payload ? job.payload.slice() : null;
    const transfer = [carrier.buffer];
    if (payload) transfer.push(payload.buffer);
    worker.postMessage({ id, op: job.op, carrier, payload, ext: job.ext, key: job.key, quality: job.quality, ecc: !!job.ecc, noFoil: !!job.noFoil }, transfer);
  });
}

// 载体类型按真实魔数映射成上游认得的扩展名（上游 get_handler 只看文件名）。
// P1/P4（PBM）上游 pnm.c 不支持 → 返回 null 由前端显式拒绝。
function carrierExt(bytes) {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes.length >= 2 && bytes[0] === 0x50) {
    const d = bytes[1];
    if (d === 0x32 || d === 0x35 || d === 0x33 || d === 0x36) return "ppm";
  }
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

function utf8Bytes(s) {
  return new TextEncoder().encode(String(s == null ? "" : s));
}

function utf8TextMaybe(bytes) {
  try {
    return _decodeUtf8Fatal(bytes);
  } catch (e) {
    return "";
  }
}

function friendlyJobError(e) {
  const log = (e && e.info && e.info.log) || [];
  const tail = log.slice(-3).join(" / ");
  const all = log.join(" ");
  if (e && e.info && e.info.trapped) return "上游崩溃（已知缺陷：空载荷会整数除零；请确认载荷非空）" + (tail ? "｜日志：" + tail : "");
  if (all.indexOf("Extracted datalen is too long") >= 0)
    return "长度头不可信，取出失败。两个最常见原因：①口令不对——很多 CTF 题用空口令嵌入（命令行不带 -k 即空口令），请先清空口令重试；②该 JPEG 被重新保存/转码过（另存、画图编辑、格式转换都会重算 DCT 系数，隐藏数据随之丢失），必须用嵌入产物或原始载体的原字节。注意载荷无 MAC，取出字节不代表口令已认证。" + (tail ? "｜日志：" + tail : "");
  if (all.indexOf("not enough bits") >= 0) return "容量不足：载荷超出该载体可嵌入位数。换更大载体或缩短载荷。" + (tail ? "｜日志：" + tail : "");
  if (all.indexOf("Unknown data type") >= 0) return "载体类型不被上游支持（只认 jpg / ppm / pnm）。" + (tail ? "｜日志：" + tail : "");
  if (all.indexOf("Cannot open input file") >= 0 || all.indexOf("Can not open") >= 0) return "输入读取失败。" + (tail ? "｜日志：" + tail : "");
  return ((e && e.message) || "outguess 失败") + (tail ? "｜日志：" + tail : "");
}

const EXT_MIME = { jpg: "image/jpeg", ppm: "image/x-portable-pixmap" };

async function ogEncode(text, p = {}) {
  const carrier = carrierBytesOf(text, p);
  if (!carrier.length) throw new Error("缺少载体：请拖入/选择 JPEG 或 PPM（P2/P3/P5/P6）图片文件，或粘贴其 base64/dataURL");
  const ext = carrierExt(carrier);
  if (!ext) throw new Error("载体魔数不被支持：本工具支持 JPEG（FF D8）与 PNM P2/P3/P5/P6；P1/P4（PBM）上游不支持");
  const msg = String(p.message == null ? "" : p.message);
  if (!msg.length) throw new Error("载荷为空：请填写要嵌入的消息（空载荷会触发上游整数除零缺陷，已拦截）");
  const payload = utf8Bytes(msg);
  let quality = Math.round(Number(p.quality));
  if (!Number.isFinite(quality)) quality = 75;
  quality = Math.max(75, Math.min(100, quality)); // 上游把低于 75 的值硬钳到 75
  const key = String(p.key == null ? "" : p.key);
  let r;
  try {
    r = await runOutguessJob({ op: "encode", carrier, payload, ext, key, quality, noFoil: !p.foil, ecc: false }, WORKER_URL, { timeoutMs: JOB_TIMEOUT_MS });
  } catch (e) {
    throw new Error(friendlyJobError(e));
  }
  const mime = EXT_MIME[ext] || "application/octet-stream";
  const name = "outguess_out." + (ext === "jpg" ? "jpg" : "ppm");
  const lines = [
    "已嵌入 " + payload.length + " 字节载荷（UTF-8）到 " + ext.toUpperCase() + " 载体。",
    "产物为重新编码的" + (ext === "jpg" ? " JPEG（质量 " + quality + "，系数域嵌入，非原图字节副本）" : " PNM（像素位嵌入）") + "，统计保真" + (p.foil === false ? "已关闭" : "开启") + "。",
    "载荷无认证标签（无 MAC）：嵌入口令与提取口令需一致，但输出存在不等于口令已被验证。",
    "日志：" + (r.log.slice(-2).join(" / ") || "（无）"),
  ];
  return { text: lines.join("\n"), files: [{ name, mime, bytes: r.bytes }] };
}

async function ogDecode(text, p = {}) {
  const data = carrierBytesOf(text, p);
  if (!data.length) throw new Error("缺少输入：请拖入/选择 OutGuess 产物文件，或粘贴其 base64/dataURL");
  if (data.length >= 4 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47)
    throw new Error("这是 PNG 文件：OutGuess 数据只存在于嵌入时的原始 JPEG（或 PNM）字节里。" +
      "把 JPEG 另存为 PNG（即使像素完全相同）会彻底丢掉 DCT 系数结构，隐藏内容物理上无法取回——请找原始 JPEG。");
  const ext = carrierExt(data);
  if (!ext) throw new Error("输入魔数不被支持：本工具支持 JPEG（FF D8）与 PNM P2/P3/P5/P6 产物；P1/P4（PBM）上游不支持");
  const key = String(p.key == null ? "" : p.key);
  let r;
  try {
    r = await runOutguessJob({ op: "decode", carrier: data, ext, key, quality: 75, noFoil: false, ecc: false }, WORKER_URL, { timeoutMs: JOB_TIMEOUT_MS });
  } catch (e) {
    throw new Error(friendlyJobError(e));
  }
  const out = r.bytes;
  const asText = utf8TextMaybe(out);
  const lines = [
    "取出 " + out.length + " 字节。",
    "载荷无认证标签（无 MAC）：「取出 N 字节」不代表口令已认证——错误口令也可能吐出字节，请以内容本身判读。",
    "截断的产物可能仍返回错误字节（上游不报完整性错误），对可疑产物请结合容量与内容判断。",
  ];
  if (asText) lines.push("按 UTF-8 严格解码成功，内容：\n" + asText);
  else lines.push("内容不是有效 UTF-8 文本（疑似二进制载荷），请从下方下载后另行分析。");
  return { text: lines.join("\n"), files: [{ name: "outguess_payload.bin", mime: "application/octet-stream", bytes: out }] };
}

register({
  id: "outguess",
  cat: "stegoFile",
  name: "OutGuess 隐写（双向）",
  desc:
    "OutGuess 0.4 隐写双向：encode 把消息嵌进载体，decode 用同一口令取回。JPEG 走量化 DCT 系数 LSB" +
    "（系数域编辑，产物按质量重编码、非原图字节副本），PPM/PGM（P2/P3/P5/P6）走像素位；统计保真默认开启。" +
    "载体按魔数分派（jpg/ppm/pnm），P1/P4 不支持。载荷无认证标签（无 MAC）：取出字节不等于口令已认证。" +
    "引擎为本地 WASM（单线程，无跨源隔离头要求），源码与许可见引擎目录 NOTICE。",
  acceptsBytes: true,
  aka: [
    "outguess", "OutGuess", "outguess 0.4", "outguess隐写", "JPEG隐写 OutGuess",
    "DCT系数隐写", "系数LSB隐写", "Niels Provos隐写", "provos stego",
    "已知口令隐写", "统计保真隐写", "foiling隐写", "Golay纠错隐写", "outguess解密",
  ],
  params: [
    { sensitive: true, key: "key", label: "口令（空串是合法口令）", type: "password", default: "", placeholder: "encode/decode 两侧须一致" },
    { key: "message", label: "要嵌入的消息（encode 用）", type: "text", default: "", placeholder: "如 flag{...}（按 UTF-8 编码为字节）" },
    { key: "quality", label: "JPEG 重编码质量（下限 75）", type: "number", default: 75 },
    { key: "foil", label: "统计保真（抗卡方检测）", type: "bool", default: true },
  ],
  encode: ogEncode,
  decode: ogDecode,
});

export default { runOutguessJob, carrierExt };
