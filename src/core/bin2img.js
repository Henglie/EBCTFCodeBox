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
  desc: "图片 → Base64 生成方向：拖入图片按文件头嗅探 MIME（PNG/JPG/GIF/BMP/WebP/ICO），输出 dataURI（可嵌 HTML/CSS）或裸 base64 串。与「Base64 编码」op 的字节通道互为补充：本 op 自动带对 MIME",
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

export { bin2imgRun, extractBits, img2dataURIRun, sniffImageMime };
