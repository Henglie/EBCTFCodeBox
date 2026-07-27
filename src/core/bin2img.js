/*
 * bin2img.js —— 二进制/位流 → 图片渲染。
 *
 * 背景：
 * CTF misc 常给一大串 0/1（或 hex、字节），实为按宽度排布的黑白/位图点阵，
 * 渲染成图片即见 flag 文字/二维码/图案。此前只有反向（LSB 提取/位平面分析），
 * 补齐正向渲染。
 *
 * 覆盖（单向 run，输出 PNG data URL，UI 自动渲染 + 下载）：
 * - bin2img：0/1 位流 → 黑白点阵图。1=黑 0=白（可反色）。按宽度换行；
 *   宽度留空则自动取 sqrt 近似正方形。每个 bit 放大为 scale×scale 像素块。
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
  cat: "stego",
  name: "二进制转图片",
  desc: "0/1 位流 → 黑白点阵图（1=黑 0=白，可反色）。CTF 中一串二进制按宽度排布常构成 flag 文字/二维码。输出 PNG，可下载。宽度留空自动取近似正方形。",
  params: [
    { key: "width", label: "宽度（像素/位，留空自动近似正方形）", type: "number", default: 0 },
    { key: "scale", label: "放大倍数（每位放大为 N×N 像素）", type: "number", default: 4 },
    { key: "invert", label: "反色（0=黑 1=白）", type: "bool", default: false },
  ],
  run: bin2imgRun,
});

export { bin2imgRun, extractBits };
