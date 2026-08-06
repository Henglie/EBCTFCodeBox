/*
 * stereogram.js — 立体图隐写求解（Autostereogram solver，cat:'stego'）。
 *
 * 原理：单幅随机点立体图（SIRDS）把隐藏深度编码在相邻像素的水平位移里，
 * 用「自身与自身水平循环位移相减」即可把深度条纹显形：
 *   diff = clip(imgRGB - np.roll(imgRGB, -offset, axis=1), 0, 255)
 * 正确 offset 下，重复图案重叠处差为 0（暗），错位处产生明暗条纹 → 文字浮现。
 *
 * 与参考实现（Stegsolve 立体图求解）逐像素一致：RGBA 转 int16 防下溢，
 * 每通道 clip 0..255。offset 范围 = [-width/2, width/2]。
 *
 * 使用：
 * - offset 指定单值 → 输出该偏移的处理图
 * - offset 留空 → 自动扫描（默认 -32..32 步进 2），候选缩略图网格拼图输出
 *
 * 红线：算法层零 UI 依赖；纯像素零外发；件内自注册。
 * 契约：register({ id:"stereogramSolver", cat:"stego", name, desc, run, acceptsBytes })。
 */
import { register } from "./registry.js";
import { decodePNG, rgbaToDataURL, dataURLToBytes, rollHorizontal } from "./stegoPixels.js";

/** 单个 offset 的处理图（对齐参考：diff = clip(img - roll(img, -offset), 0, 255)）。 */
export function stereogramDiff(rgba, w, h, offset) {
  const rolled = rollHorizontal(rgba, w, h, offset); // 等价 np.roll(img, -offset, axis=1)
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const d = i * 4;
    for (let c = 0; c < 3; c++) {
      const v = rgba[d + c] - rolled[d + c];
      out[d + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    out[d + 3] = 255;
  }
  return out;
}

function stereogramSolverOp(text, p = {}) {
  const img = decodePNG(dataURLToBytes(text));
  const w = img.width, h = img.height;
  const maxOffset = Math.floor(w / 2);
  const offsetRaw = String(p.offset ?? "").trim();

  // 单值模式
  if (offsetRaw !== "") {
    const offset = Number(offsetRaw);
    if (!Number.isFinite(offset)) throw new Error("offset 必须是整数（空 = 自动扫描）");
    const o = Math.max(-maxOffset, Math.min(maxOffset, Math.round(offset)));
    const out = stereogramDiff(img.data, w, h, o);
    return rgbaToDataURL(out, w, h);
  }

  // 自动扫描模式：-32..32 步进 2（可参数扩展），缩略网格拼图
  const scanStart = Number(p.scanStart ?? -32);
  const scanEnd = Number(p.scanEnd ?? 32);
  const step = Number(p.step ?? 2);
  const offsets = [];
  for (let o = scanStart; o <= scanEnd; o += step) {
    if (Math.abs(o) > maxOffset) continue;
    offsets.push(o);
  }
  if (!offsets.length) throw new Error("扫描范围为空（|offset| 不能超过宽/2=" + maxOffset + "）");
  const THUMB_H = 150;
  const thScale = THUMB_H / h;
  const tw = Math.max(1, Math.round(w * thScale));
  const perRow = Math.min(8, offsets.length);
  const gap = 6;
  const gridW = perRow * tw + (perRow + 1) * gap;
  const rows = Math.ceil(offsets.length / perRow);
  const gridH = rows * THUMB_H + (rows + 1) * gap;
  const grid = new Uint8ClampedArray(gridW * gridH * 4);
  for (let i = 0; i < grid.length; i += 4) { grid[i] = 255; grid[i + 1] = 255; grid[i + 2] = 255; grid[i + 3] = 255; }
  offsets.forEach((offset, idx) => {
    const diff = stereogramDiff(img.data, w, h, offset);
    const row = Math.floor(idx / perRow);
    const col = idx % perRow;
    const ox = gap + col * (tw + gap);
    const oy = gap + row * (THUMB_H + gap);
    for (let y = 0; y < THUMB_H; y++) {
      const sy = Math.min(h - 1, Math.floor(y / thScale));
      for (let x = 0; x < tw; x++) {
        const sx = Math.min(w - 1, Math.floor(x / thScale));
        const si = (sy * w + sx) * 4;
        const di = ((oy + y) * gridW + (ox + x)) * 4;
        grid[di] = diff[si]; grid[di + 1] = diff[si + 1]; grid[di + 2] = diff[si + 2]; grid[di + 3] = 255;
      }
    }
  });
  return rgbaToDataURL(grid, gridW, gridH);
}

register({
  id: "stereogramSolver", cat: "stego", name: "立体图求解",
  desc: "Autostereogram 立体图隐写求解：图像与自身水平循环位移相减（roll+diff），正确 offset 下深度条纹显形。offset 单值精确解，留空自动扫描拼图",
  params: [
    { key: "offset", label: "offset 偏移", type: "number", default: "", placeholder: "留空 = 自动扫描" },
    { key: "scanStart", label: "扫描起始", type: "number", default: -32 },
    { key: "scanEnd", label: "扫描结束", type: "number", default: 32 },
    { key: "step", label: "扫描步进", type: "number", default: 2 },
  ],
  run: stereogramSolverOp,
  acceptsBytes: true,
});

export { stereogramSolverOp };
