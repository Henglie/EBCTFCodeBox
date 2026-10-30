/*
 * stegoFileScan.js — 一键文件分析里的「隐写自动尝试」补充通道。
 *
 * 为什么独立：fileAnalysis 只做结构/内容取证，真正的算法级隐写（jsteg/outguess/
 * steghide/F5/WaterMarkH）是注册表 op，需要线程隔离 + 超时；这里统一调度并归一成
 * fileAnalysis 的 section 形状，由 main.js 合并后交给 finalizeSections 排序。
 *
 * 约束：只返回纯数据（body/actions/level/priority），不碰 DOM；引擎走
 * runOpOffThread（Worker 优先，无 Worker 时同步降级）。
 */
import { getOp } from "./registry.js";
import { runOpOffThread } from "./opRunClient.js";
import { rasterStegoScan } from "./rasterStego.js";
import { mp3stegoDecode } from "./mp3stego.js";
import { buildZip } from "./batchRun.js";
import { alphaStripScan } from "./alphaStrip.js";
import { carve } from "./foremostJs.js";

const MAX_TEXT = 6000;

function clip(s, n = MAX_TEXT) {
  const t = String(s == null ? "" : s);
  return t.length > n ? t.slice(0, n) + "\n…（截断，完整内容见下载/查看）" : t;
}

function looksHit(text) {
  return /flag\{|ctf\{|key\{|sharifctf|nssctf|flag[:：=]|隐藏内容|按 UTF-8 严格解码成功|payload|取出\s*\d+\s*字节/i.test(String(text || ""));
}

function actionsOf(out, name) {
  const acts = [];
  const text = typeof out === "string" ? out : (out && out.text) || "";
  if (text) acts.push({ type: "view", label: "查看完整输出", text });
  if (out && typeof out === "object" && Array.isArray(out.files)) {
    for (const f of out.files) {
      if (!f || !f.bytes) continue;
      acts.push({
        type: "download",
        label: "下载 " + (f.name || "payload.bin"),
        filename: f.name || "payload.bin",
        mime: f.mime || "application/octet-stream",
        bytes: f.bytes,
      });
      if ((f.mime || "").startsWith("image/")) {
        acts.push({ type: "preview", label: f.name || "预览", filename: f.name || "preview.png", mime: f.mime, bytes: f.bytes });
      }
    }
  }
  return acts;
}

// F5 / jsteg 仅手动选择：F5 误报率高，jsteg 耗时且占空间，不进一键文件分析的自动池。
const JPEG_OPS = [
  { id: "outguess", label: "OutGuess 0.4（口令框）", timeout: 20000, keyed: true },
  { id: "steghide", label: "steghide（口令框）", timeout: 20000, keyed: true },
];
const WAV_OPS = [
  { id: "steghide", label: "steghide WAV（口令框）", timeout: 20000, keyed: true },
  { id: "morseWav", label: "摩斯音频", timeout: 20000 },
];
const PNG_OPS = [
  { id: "watermarkhFft", label: "WaterMarkH 频域水印", timeout: 25000, params: { scheme: "1" } },
  // Piet 是完整解释器：默认档不自动跑，增强及以上才进入隐写自动尝试。
  { id: "pietExec", label: "Piet 执行", timeout: 8000, minLevel: "enhanced", params: { codelSize: 0, maxSteps: 200000, timeLimitMs: 3000, stallSteps: 5000 } },
];

const LEVEL_ORDER = { fast: 0, normal: 1, enhanced: 2, extreme: 3, max: 4 };
function specAllowedAt(spec, level) {
  const min = spec && spec.minLevel;
  if (!min || !level || level === "custom") return true;
  return (LEVEL_ORDER[level] ?? LEVEL_ORDER.normal) >= (LEVEL_ORDER[min] ?? LEVEL_ORDER.normal);
}

function safeBase(name) {
  return String(name || "image").replace(/\.[^.\\/]+$/, "").replace(/[^\w.-]+/g, "_").slice(0, 64) || "image";
}

const GENERIC_KEY_PARTS = new Set([
  "f5", "f5stego", "outguess", "steghide", "mp3stego", "watermark", "watermarkh",
  "steg", "stego", "image", "img", "flag", "test", "sample", "file",
]);

function keyCandidates(name, userKey) {
  const out = [];
  const add = (s) => {
    s = String(s || "").trim();
    if (s && !out.includes(s)) out.push(s);
  };
  add(userKey);
  const base = String(name || "").replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");
  for (const p of base.split(/[_\-\s.]+/)) {
    if (p.length >= 2 && !GENERIC_KEY_PARTS.has(p.toLowerCase())) add(p);
  }
  add(base);
  if (!out.length) out.push("");
  return out.slice(0, 4);
}

async function waitControl(control) {
  if (!control) return true;
  while (control.paused && !control.cancelled) {
    await new Promise((r) => setTimeout(r, 80));
  }
  return !control.cancelled;
}

function opsFor(ext) {
  if (ext === "jpg" || ext === "jpeg") return JPEG_OPS;
  if (ext === "wav") return WAV_OPS;
  if (ext === "png" || ext === "bmp") return PNG_OPS;
  return [];
}

/**
 * @param {Uint8Array} bytes
 * @param {string} name
 * @param {{runner?:Function, ext?:string, skip?:string[]}} [opts]
 * @returns {Promise<Array>} fileAnalysis sections
 */
export async function scanStegoFile(bytes, name = "", opts = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const ext = String(opts.ext || (name.split(".").pop() || "")).toLowerCase();
  const allow = opts.allowOps == null ? null : new Set(opts.allowOps);
  const isAllowed = (id) => allow == null || allow.has(id);
  const list = opsFor(ext).filter((spec) => isAllowed(spec.id) && specAllowedAt(spec, opts.level));
  const hasRaster = ext === "png" || ext === "bmp";
  const hasForemost = ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "bmp";
  if (!list.length && ext !== "mp3" && !hasRaster && !hasForemost) return [];
  const runner = opts.runner || ((opId, input, params, o) => runOpOffThread(opId, input, params, o));
  const skip = new Set(opts.skip || []);
  const sections = [];
  // 流式输出：每跑完一个算法就回调，main.js 立即插卡，不再等全部隐写尝试结束。
  const onSection = typeof opts.onSection === "function" ? opts.onSection : null;
  const rawPush = sections.push.bind(sections);
  sections.push = (sec) => {
    const n = rawPush(sec);
    if (onSection) {
      try { onSection(sec); } catch { /* 单个回调失败不影响扫描 */ }
    }
    return n;
  };
  for (const spec of list) {
    if (skip.has(spec.id)) continue;
    if (!(await waitControl(opts.control))) break;
    const op = getOp(spec.id);
    if (!op || (typeof op.decode !== "function" && typeof op.run !== "function")) continue;
    const defaults = Object.fromEntries((op.params || []).map((p) => [p.key, p.default]));
    const keys = spec.keyed ? keyCandidates(name, opts.key) : [""];
    let out = null;
    let err = "";
    for (const k of keys) {
      if (!(await waitControl(opts.control))) break;
      try {
        const params = { ...defaults, ...(spec.params || {}), rawBytes: u8 };
        if (spec.keyed) params.key = k;
        out = await runner(spec.id, "", params, {
          dir: typeof op.decode === "function" ? "decode" : "run",
          timeoutMs: spec.timeout,
        });
        err = "";
      } catch (e) {
        out = null;
        err = String((e && e.message) || e);
      }
      const t = typeof out === "string" ? out : (out && out.text) || "";
      const timed = /timeout/i.test(err);
      const ok = !!out && !timed && !err && t.trim().length > 0
        && !/失败|错误|未命中|未找到|需要密钥|无结果|failed|error|not found/i.test(t);
      if (ok || looksHit(t) || timed) break;
    }
    const text = typeof out === "string" ? out : (out && out.text) || "";
    const hit = !!out && looksHit(text + " " + (out && out.files ? out.files.length + " files" : ""));
    const timeout = /timeout/i.test(err);
    const produced = !!out && !timeout && !err && text.trim().length > 0
      && !/失败|错误|未命中|未找到|需要密钥|无结果|failed|error|not found/i.test(text);
    const body = timeout
      ? `● ${spec.label}：超时（${spec.timeout}ms）已中止，未产出结果。`
      : err
        ? `● ${spec.label}：${err}`
        : clip(text || "（无文本输出）");
    sections.push({
      id: "stego-auto-" + spec.id,
      title: "隐写自动尝试 · " + spec.label,
      level: hit ? "alert" : produced ? "warn" : "info",
      icon: hit ? "vpn_key" : "image",
      body,
      priority: hit ? 14 : produced ? 28 : 72,
      collapsed: !hit && !produced,
      defaultOpen: hit || produced,
      source: "stegoFileScan",
      badge: hit ? "命中" : produced ? "已解出" : (timeout ? "超时" : "尝试"),
      actions: out ? actionsOf(out, name) : [],
      _stegoHit: hit,
    });
  }

  if (!(await waitControl(opts.control))) return sections;
  if ((ext === "jpg" || ext === "jpeg" || ext === "png" || ext === "bmp") && !skip.has("foremost")) {
    try {
      const carved = carve(u8, { formats: ["jpg", "jpeg", "png", "gif", "zip", "rar", "7z", "pdf"] });
      const found = Array.isArray(carved && carved.found) ? carved.found : [];
      const embedded = found.filter((x) => x && x.bytes && !(x.offset === 0 && x.bytes.length === u8.length));
      if (embedded.length) {
        const acts = [];
        for (const x of embedded.slice(0, 12)) {
          const name = "carved-" + (x.offset || 0) + "." + (x.ext || "bin");
          acts.push({
            type: "download",
            label: "下载 " + name,
            filename: name,
            mime: x.mime || (x.ext === "png" ? "image/png" : x.ext === "jpg" ? "image/jpeg" : "application/octet-stream"),
            bytes: x.bytes,
          });
          if (x.ext === "png" || x.ext === "jpg" || x.ext === "jpeg" || x.ext === "gif") {
            acts.push({
              type: "preview",
              label: "预览 " + name,
              filename: name,
              mime: x.ext === "png" ? "image/png" : x.ext === "gif" ? "image/gif" : "image/jpeg",
              bytes: x.bytes,
            });
          }
        }
        sections.push({
          id: "stego-auto-foremost",
          title: "隐写自动尝试 · 内嵌文件分离（foremost）",
          level: "warn",
          icon: "grid_view",
          body: clip([
            `检测到 ${embedded.length} 个内嵌文件（原始文件之外）：`,
            ...embedded.slice(0, 12).map((x, i) => `#${i + 1} ${x.ext} offset=${x.offset} size=${x.bytes.length}`),
            "可在下方预览/下载；图片可点开统一图像查看器放大或调对比度。",
          ].join("\n")),
          priority: 30,
          collapsed: false,
          defaultOpen: true,
          source: "stegoFileScan",
          badge: embedded.length + " 个",
          actions: acts,
        });
      }
    } catch { /* foremost 只尝试，失败静默 */ }
  }

  if (!(await waitControl(opts.control))) return sections;
  if (hasRaster && !skip.has("alphaStrip")) {
    try {
      const a = alphaStripScan(u8);
      if (a.ok) {
        const hit = !!a.flag;
        const detail = [
          "检测到 alpha 通道条带隐写（3 bit/样本）。",
          `编码：${a.encoding}；${a.method}；样本 ${a.samples}，基数 ${a.min}，范围 ${a.range}。`,
          `结果：${a.text}`,
          a.flag ? `推测 flag：${a.flag}` : "",
        ].filter(Boolean).join("\n");
        sections.push({
          id: "stego-auto-alpha-strip",
          title: "隐写自动尝试 · alpha 条带（3 bit/样本）",
          level: hit ? "alert" : "warn",
          icon: hit ? "vpn_key" : "image",
          body: clip(detail),
          priority: hit ? 10 : 40,
          collapsed: false,
          defaultOpen: true,
          source: "stegoFileScan",
          badge: hit ? "命中" : "已解出",
          actions: [
            { type: "view", label: "查看完整输出", text: detail },
            { type: "copy", label: "复制结果", text: a.flag || a.text },
          ],
          _stegoHit: hit,
        });
      }
    } catch { /* alpha 条带只尝试，格式不符时静默跳过 */ }
  }

  if (!(await waitControl(opts.control))) return sections;
  if (hasRaster && isAllowed("rasterStego") && !skip.has("rasterStego")) {
    try {
      const scan = rasterStegoScan(u8, {
        maxDivisor: 10,
        both: true,
        maxImages: 80,
        maxTotalPixels: 64_000_000,
      });
      const images = scan && Array.isArray(scan.images) ? scan.images : [];
      if (images.length) {
        const previews = images.slice(0, 8).map((im) => ({
          type: "preview",
          label: im.name,
          filename: im.name,
          mime: im.mime,
          bytes: im.bytes,
        }));
        let zipBytes = null;
        try {
          if (images.length > 1) {
            zipBytes = buildZip(images.map((im) => ({ name: im.name, bytes: im.bytes })));
          }
        } catch { /* 打包失败不阻断预览 */ }
        sections.push({
          id: "stego-auto-raster",
          title: "隐写自动尝试 · 光栅拆图",
          level: "info",
          icon: "grid_view",
          body: clip([
            ...(scan.notes || []),
            `已生成 ${images.length} 张拆图；前 ${previews.length} 张可直接预览，全部可打包下载。`,
          ].join("\n")),
          priority: 60,
          collapsed: true,
          defaultOpen: false,
          source: "stegoFileScan",
          badge: images.length + " 张",
          actions: [
            ...previews,
            ...(zipBytes ? [{
              type: "download",
              label: "下载全部光栅图（ZIP）",
              filename: "raster-" + safeBase(name) + ".zip",
              mime: "application/zip",
              bytes: zipBytes,
            }] : []),
          ],
        });
      }
    } catch { /* 光栅只尝试，超限/格式不符时静默跳过 */ }
  }

  if (!(await waitControl(opts.control))) return sections;
  if (ext === "mp3" && isAllowed("mp3stego") && !skip.has("mp3stego")) {
    const key = String(opts.key || "").trim();
    if (!key) {
      sections.push({
        id: "stego-auto-mp3stego",
        title: "隐写自动尝试 · MP3Stego",
        level: "info",
        icon: "graphic_eq",
        body: "检测到 MP3：MP3Stego 需要口令。在首页密钥框填入口令后重新拖入本文件会自动尝试解出；无口令不做穷举。",
        priority: 74,
        collapsed: true,
        defaultOpen: false,
        source: "stegoFileScan",
        badge: "待口令",
        actions: [],
      });
    } else {
      let r = null;
      try {
        r = mp3stegoDecode(u8, { password: key });
      } catch (e) {
        r = { ok: false, reason: String((e && e.message) || e) };
      }
      if (r && r.ok) {
        const text = String(r.text || "");
        const hit = looksHit(text);
        const acts = [];
        if (text) acts.push({ type: "view", label: "查看完整输出", text });
        if (r.bytes) {
          acts.push({
            type: "download",
            label: "下载解出载荷",
            filename: safeBase(name) + "-mp3stego.bin",
            mime: "application/octet-stream",
            bytes: r.bytes,
          });
        }
        sections.push({
          id: "stego-auto-mp3stego",
          title: "隐写自动尝试 · MP3Stego",
          level: hit ? "alert" : "info",
          icon: hit ? "vpn_key" : "graphic_eq",
          body: clip(text || "已解出二进制载荷。"),
          priority: hit ? 13 : 68,
          collapsed: !hit,
          defaultOpen: hit,
          source: "stegoFileScan",
          badge: hit ? "命中" : "已解出",
          actions: acts,
          _stegoHit: hit,
        });
      } else {
        sections.push({
          id: "stego-auto-mp3stego",
          title: "隐写自动尝试 · MP3Stego",
          level: "info",
          icon: "graphic_eq",
          body: "未命中：" + ((r && r.reason) || "未知原因"),
          priority: 74,
          collapsed: true,
          defaultOpen: false,
          source: "stegoFileScan",
          badge: "未命中",
          actions: [],
        });
      }
    }
  }

  return sections;
}

export default { scanStegoFile };
