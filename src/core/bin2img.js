/*
 * bin2img.js —— 二进制/位流 → 图片渲染 + 图片 → Base64/dataURI 生成。
 *
 * 背景：
 * CTF misc 常给一大串 0/1（或 hex、字节），实为按宽度排布的黑白/位图点阵，
 * 渲染成图片即见 flag 文字/二维码/图案。此前只有反向（LSB 提取/位平面分析），
 * 补齐正向渲染。
 *
 * 覆盖（单向 run，输出 PNG data URL，UI 自动渲染 + 下载）：
 * - bin2img：0/1 位流 → 黑白点阵图。1=黑 0=白（可反色）。按宽度换行；
 *   宽度留空则自动取 sqrt 近似正方形。每个 bit 放大为 scale×scale 像素块。
 * - img2dataURI：图片 → Base64/dataURI 生成方向（拖入图片 → 按 PNG/JPG/GIF/
 *   BMP/WebP/ICO 文件头嗅探 MIME，输出 dataURI 或裸 base64 串）。
 *   裸 base64 方向此前可经 Base64 编码 op（acceptsBytes）覆盖；dataURI 带 MIME
 *   出口为本文件新增面。
 *
 * 复用：mcMap.js 的 encodePNG(rgba,w,h) / rgbaToDataURL —— 手写最小 PNG 编码器，
 * 不引第三方、纯本地、零外发。
 *
 * 红线：纯本地纯 JS，零外发。输入容错（忽略非 0/1 字符）。
 */
import { register } from "./registry.js";
import { rgbaToDataURL } from "./mcMap.js";
import { b64ToBytes, sniffMagic } from "./bytesIo.js";
import { decodeDataUri } from "./dataUri.js";
import { imageInputBytes, decodeImageToRgba } from "./imageBytes.js";

// 从输入抽出 0/1 位流。支持：纯 01 串（忽略空白/其他）；
// 也支持 "0b" 前缀行。非 0/1 字符一律忽略（容错）。
function extractBits(text) {
  let bits = "";
  for (const ch of String(text)) {
    if (ch === "0" || ch === "1") bits += ch;
  }
  return bits;
}

function bin2imgRun(text, p = {}) {
  const bits = extractBits(text);
  if (!bits.length) {
    return "（无有效位）请粘贴 0/1 位流。1=黑 0=白，按宽度排布成点阵图。\n" +
      "参数：宽度（留空自动取近似正方形）、放大倍数、是否反色。";
  }
  const invert = !!p.invert;
  const scale = Math.max(1, Math.min(20, Number(p.scale || 4)));
  let width = Number(p.width || 0);
  if (!width || width < 1) {
    // 自动宽度：近似正方形
    width = Math.max(1, Math.round(Math.sqrt(bits.length)));
  }
  width = Math.min(width, 4096);
  const height = Math.ceil(bits.length / width);
  if (width * height > 4096 * 4096) return "点阵过大（超过 4096×4096），请减小宽度或输入。";

  // 每 bit → scale×scale 像素块，输出 RGBA
  const outW = width * scale, outH = height * scale;
  // 上限必须按「放大后的输出」算：只卡 width*height 时，640×640 位流 × scale 20
  // 会变成 12800² RGBA ≈ 655MB，直接 RangeError。
  if (outW * outH > 4096 * 4096) {
    return "点阵过大（输出 " + outW + "×" + outH + " 超过 4096×4096 像素上限），请减小宽度或放大倍数。";
  }
  const rgba = new Uint8Array(outW * outH * 4);
  for (let by = 0; by < height; by++) {
    for (let bx = 0; bx < width; bx++) {
      const idx = by * width + bx;
      let bit = idx < bits.length ? (bits[idx] === "1" ? 1 : 0) : 0;
      if (invert) bit ^= 1;
      const v = bit ? 0 : 255; // 1=黑(0) 0=白(255)
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((by * scale + dy) * outW + (bx * scale + dx)) * 4;
          rgba[px] = v; rgba[px + 1] = v; rgba[px + 2] = v; rgba[px + 3] = 255;
        }
      }
    }
  }
  return rgbaToDataURL(rgba, outW, outH);
}

register({
  id: "bin2img",
  cat: "image",
  name: "二进制转图片",
  desc: "0/1 位流 → 黑白点阵图（1=黑 0=白，可反色）。CTF 中一串二进制按宽度排布常构成 flag 文字/二维码。输出 PNG，可下载。宽度留空自动取近似正方形。",
  params: [
    { key: "width", label: "宽度（像素/位，留空自动近似正方形）", type: "number", default: 0 },
    { key: "scale", label: "放大倍数（每位放大为 N×N 像素）", type: "number", default: 4 },
    { key: "invert", label: "反色（0=黑 1=白）", type: "bool", default: false },
  ],
  run: bin2imgRun,
});

// ============ img2dataURI：图片 → Base64/dataURI 生成 ============

/** 按文件头嗅探图片 MIME（PNG/JPG/GIF/BMP/WebP/ICO）。 */
function sniffImageMime(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return "image/bmp";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57 && bytes[9] === 0x45) return "image/webp";
  if (bytes.length >= 4 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return "image/x-icon";
  // SVG 是文本：嗅探前 1KB 是否含 <svg>（允许 XML 声明/注释/DOCTYPE）。
  try {
    const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 1024));
    if (/<svg[\s>]/i.test(head)) return "image/svg+xml";
  } catch { /* 非文本，忽略 */ }
  return null;
}

/** 字节 → base64（浏览器 btoa / node Buffer 兜底，与 mcMap.bytesToB64 同法）。 */
function bytesToBase64(bytes) {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  if (typeof globalThis.btoa === "function") {
    let s = "";
    for (let i = 0; i < bytes.length; i += 8192) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(bytes.length, i + 8192)));
    }
    return globalThis.btoa(s);
  }
  throw new Error("img2dataURI：当前环境无 base64 编码器（btoa/Buffer 均不可用）");
}

function img2dataURIRun(text, p = {}) {
  const outMode = String(p.output || "datauri");
  if (!["datauri", "base64", "both"].includes(outMode)) {
    throw new Error("img2dataURI：输出形式需为 datauri/base64/both，当前 " + outMode);
  }
  let bytes;
  if (p && p.rawBytes && p.rawBytes.length) {
    bytes = new Uint8Array(p.rawBytes);
  } else {
    const raw = String(text || "").replace(/\s+/g, "");
    if (!raw) throw new Error("img2dataURI：请拖入或粘贴图片文件（支持 PNG/JPG/GIF/BMP/WebP/ICO）");
    if (typeof Buffer !== "undefined") {
      bytes = new Uint8Array(Buffer.from(raw, "base64"));
    } else if (typeof globalThis.atob === "function") {
      const bin = globalThis.atob(raw);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      throw new Error("img2dataURI：当前环境无 base64 解码器（atob/Buffer 均不可用）");
    }
    if (!bytes.length) throw new Error("img2dataURI：base64 解析结果为空——输入不是有效的图片数据");
  }
  const mime = sniffImageMime(bytes);
  if (!mime) {
    throw new Error("img2dataURI：未识别到图片文件头（PNG/JPG/GIF/BMP/WebP/ICO）——输入不是有效的图片数据");
  }
  const b64 = bytesToBase64(bytes);
  const dataUri = "data:" + mime + ";base64," + b64;
  if (outMode === "base64") return b64;
  if (outMode === "both") {
    return "MIME: " + mime + "  大小: " + bytes.length + " 字节\n\ndataURI:\n" + dataUri +
      "\n\nbase64 裸串:\n" + b64;
  }
  return dataUri;
}

register({
  id: "img2dataURI",
  cat: "image",
  name: "图片转 Base64/dataURI",
  desc: "图片 → Base64 生成方向：拖入图片按文件头嗅探 MIME（PNG/JPG/GIF/BMP/WebP/ICO），输出 dataURI（可嵌 HTML/CSS）或裸 base64 串。支持 PNG/JPG/GIF/BMP/WebP/ICO/SVG。与「Base64 编码」op 的字节通道互为补充：本 op 自动带对 MIME。反向（dataURI/base64 → 图片）用「Base64/dataURI 转图片」",
  params: [
    {
      key: "output", label: "输出形式", type: "select", default: "datauri",
      options: [
        { value: "datauri", label: "dataURI（data:image/...;base64,...）" },
        { value: "base64", label: "base64 裸串" },
        { value: "both", label: "两者都要" },
      ],
    },
  ],
  acceptsBytes: true,
  run: img2dataURIRun,
});

// ============ dataURIToImage：Base64/dataURI → 图片（反向） ============

/** 图片文件头 → { mime, ext, name }；非图片返回 null。 */
function sniffImageInfo(bytes) {
  const mime = sniffImageMime(bytes);
  if (!mime) return null;
  const meta = {
    "image/png": ["png", "PNG 图像"],
    "image/jpeg": ["jpg", "JPEG 图像"],
    "image/gif": ["gif", "GIF 图像"],
    "image/bmp": ["bmp", "BMP 图像"],
    "image/webp": ["webp", "WebP 图像"],
    "image/x-icon": ["ico", "ICO 图标"],
    "image/svg+xml": ["svg", "SVG 矢量图"],
  }[mime] || ["bin", mime];
  return { mime, ext: meta[0], name: meta[1] };
}

function normImageMime(m) {
  const s = String(m || "").toLowerCase().split(";")[0].trim();
  return s === "image/jpg" ? "image/jpeg" : s;
}

function dataURIToImageRun(text) {
  let s = String(text == null ? "" : text).trim();
  if (!s) throw new Error("请粘贴 data:image/... URI 或图片的 base64 串");
  // 容忍从代码/HTML 里连引号一起复制
  if ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'") ||
      (s[0] === "`" && s[s.length - 1] === "`")) {
    s = s.slice(1, -1).trim();
  }
  let bytes;
  let declaredMime = "";
  let encoding = "裸 base64";
  let attrs = [];
  if (/^data:/i.test(s)) {
    const d = decodeDataUri(s);
    bytes = d.bytes;
    declaredMime = d.mime;
    encoding = d.base64 ? "data URI · base64" : "data URI · percent-encoding";
    attrs = d.attrs;
  } else {
    const clean = s.replace(/\s+/g, "");
    if (!/^[A-Za-z0-9+/_=-]+$/.test(clean)) {
      throw new Error("输入既不是 data: URI，也不是纯 base64（含非法字符）");
    }
    bytes = b64ToBytes(clean);
  }
  if (!bytes.length) throw new Error("解码结果为空");
  // SVG 走文本路径：直接交回可读标记 + .svg 文件，不要求位图魔数。
  const headText = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, 2048));
  if (/image\/svg/i.test(declaredMime) || /<svg[\s>]/i.test(headText)) {
    const svg = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (!/<svg[\s>]/i.test(svg)) throw new Error("声明为 SVG，但内容里找不到 <svg> 标签");
    return {
      text: [
        "输入形态:   " + (declaredMime ? "data URI" : "裸 base64"),
        "编码方式:   " + encoding,
        "声明 MIME:  " + (declaredMime || "（无）"),
        "实际格式:   SVG 矢量图（image/svg+xml）",
        "图片大小:   " + bytes.length + " 字节",
        "说明:       SVG 是文本型图片，已按 UTF-8 还原并交回 .svg 文件",
      ].join("\n"),
      files: [{ name: "from_datauri.svg", mime: "image/svg+xml", bytes }],
    };
  }
  const info = sniffImageInfo(bytes);
  if (!info) {
    const other = sniffMagic(bytes);
    throw new Error("解出的 " + bytes.length + " 字节不是已知图片格式（PNG/JPG/GIF/BMP/WebP/ICO）" +
      (other ? "；文件头识别为 " + other.name : "，且未命中已知魔数"));
  }
  const declared = normImageMime(declaredMime);
  const lines = [
    "输入形态:   " + (declaredMime ? "data URI" : "裸 base64"),
    "编码方式:   " + encoding,
    "声明 MIME:  " + (declaredMime || "（无）"),
    "实际格式:   " + info.name + "（" + info.mime + "）",
    "图片大小:   " + bytes.length + " 字节",
  ];
  if (attrs.length) lines.push("附加参数:   " + attrs.join("; "));
  if (declared && declared !== info.mime) {
    lines.push("⚠ MIME 不符：URI 声明 " + declaredMime + "，文件头实际为 " + info.mime +
      " —— 常见 CTF 伪装点，已按真实字节还原为 ." + info.ext);
  }
  lines.push("提示：若图片是二维码/条码，可把原 URI/base64 直接粘到「二维码扫描解析」（支持 dataURI/base64）。");
  return {
    text: lines.join("\n"),
    files: [{ name: "from_datauri." + info.ext, mime: info.mime, bytes }],
  };
}

register({
  id: "dataURIToImage",
  cat: "image",
  name: "Base64/dataURI 转图片",
  desc: "图片还原方向（「图片转 Base64/dataURI」的反向）：粘贴 data:image/... URI 或图片 base64 串，按文件头识别真实格式（PNG/JPG/GIF/BMP/WebP/ICO/SVG）并还原为图片文件，输出内联预览 + 下载。URI 声明 MIME 与实际字节不符时显式告警（CTF 常见伪装：声明 jpg 实为 png）",
  params: [],
  run: dataURIToImageRun,
});

// ============ img2bits：图片 → 0/1 位流（bin2img 的反向） ============

async function img2bitsRun(text, p = {}) {
  const bytes = imageInputBytes(text, p, "图片转二进制");
  const img = await decodeImageToRgba(bytes, "图片转二进制");
  const width = img.width, height = img.height;
  const scale = Math.max(1, Math.floor(Number(p.scale || 1)));
  const off = Math.floor(scale / 2);
  const thr = Math.max(0, Math.min(255, Number(p.threshold ?? 128)));
  const mode = String(p.mode || "dark");
  const invert = !!p.invert;
  const lineWidth = Math.max(0, Math.floor(Number(p.lineWidth || 0)));
  const d = img.data;
  let bits = "";
  let count = 0;
  for (let y = off; y < height; y += scale) {
    for (let x = off; x < width; x += scale) {
      const i = (y * width + x) * 4;
      let v;
      if (mode === "alpha") v = d[i + 3];
      else if (mode === "red") v = d[i];
      else if (mode === "green") v = d[i + 1];
      else if (mode === "blue") v = d[i + 2];
      else v = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
      // bin2img：1=黑 0=白。默认按「暗=1」，与编码端一致；invert 反转。
      let bit = mode === "alpha" ? (v >= thr ? 1 : 0) : (v <= thr ? 1 : 0);
      if (invert) bit ^= 1;
      bits += bit ? "1" : "0";
      count++;
      if (lineWidth && count % lineWidth === 0) bits += "\n";
    }
  }
  if (!bits) throw new Error("图片转二进制：没有采样到任何像素（检查 scale/尺寸）");
  return bits.replace(/\n$/, "");
}

register({
  id: "img2bits",
  cat: "image",
  name: "图片转二进制点阵",
  desc: "「二进制转图片」的反向：把黑白点阵图还原成 0/1 位流（暗=1、白=0，可反色）。按 scale 采样（编码时放大 N 倍就填 N），可按每行位数换行。PNG 纯 JS 解码，JPG/GIF/BMP/WebP 走浏览器解码",
  params: [
    { key: "threshold", label: "黑白阈值（亮度 0-255）", type: "number", default: 128 },
    { key: "scale", label: "采样步长（编码放大倍数）", type: "number", default: 1 },
    { key: "lineWidth", label: "每行位数（0=不换行）", type: "number", default: 0 },
    { key: "mode", label: "采样通道", type: "select", default: "dark", options: [
      { value: "dark", label: "亮度（暗=1）" }, { value: "red", label: "红通道" },
      { value: "green", label: "绿通道" }, { value: "blue", label: "蓝通道" },
      { value: "alpha", label: "Alpha（不透明=1）" },
    ] },
    { key: "invert", label: "反色（白=1）", type: "bool", default: false },
  ],
  acceptsBytes: true,
  run: img2bitsRun,
});

export { bin2imgRun, extractBits, img2dataURIRun, dataURIToImageRun, img2bitsRun, sniffImageMime, sniffImageInfo };
