/*
 * cnImageStego.js — 中文互联网主流图像玩法（幻影坦克 / 小番茄混淆）
 *
 * mirageTank   — 幻影坦克（光影坦克=同物别名，百度知道原话「光影坦克（幻影坦克）」）：
 *                白底显示表图、黑底显示里图的 RGBA PNG。算法正源=CSDN 原理文
 *                （blog.csdn.net/qq_36729037「幻影坦克图片原理与实现」）逐像素公式：
 *                  α = 1 − (C白 − C黑)/255；前景 = C黑/α（α=0 时全透，白底见 255、黑底见 0）；
 *                  灰度档 R=G=B（三通道共享一个 Alpha，社区经典做法，精确）；
 *                  彩色档 α = 1 − max_c(C白_c − C黑_c)/255：黑底侧逐通道精确、白底侧向亮拟合（有损，如实标注）。
 *                约束：里图亮度须 ≤ 表图，违反处钳位并计数回报（百度知道条目同款口径）。
 *                解码=反渲染：直通 alpha 合成到白底/黑底各出一张 PNG。
 *                ⚠ PNG 读写在纯 JS（stegoPixels.decodePNG / mcMap.encodePNG）——canvas 对半透明
 *                像素做 alpha 预乘/色彩管理会改写 RGB，直接毁掉 alpha 双图数学（dualFftWatermark
 *                同款教训）。JPEG/GIF 输入才走浏览器 canvas（只取不透明像素，作素材无碍）。
 * tomatoScramble — 小番茄图片混淆：Gilbert 广义 Hilbert 曲线像素重排 + 黄金比例偏移。
 *                正源=流行网页版（iris10086.github.io/pic-scramble）内联 JS 逐字节转写：
 *                  curve = gilbert2d(W,H)；offset = Math.round((√5−1)/2 × W × H)；
 *                  混淆 dst[curve[(i+offset)%n]] = src[curve[i]]（RGBA 四字节整搬）；
 *                  解混淆 = 精确逆映射。算法源出 singularpoint.cn/hideImg1.html，各网页版/桌面版
 *                 （GitHub ok8634673/Cherry-tomato-image-obfuscation）同源互解。
 *                本实现输出 PNG（无损）；网页版输出 JPEG q=1（有损）——位置映射完全一致，
 * 互解只差 JPEG 量化误差；互通性由验证脚本与网页版实测对拍。
 */
import { register } from "./registry.js";
import { decodePNG, dataURLToBytes } from "./stegoPixels.js";
import { encodePNG, rgbaToDataURL } from "./mcMap.js";

/* ==================== 共用：输入字节 → 精确 RGBA ==================== */

function inputBytes(text, p) {
  if (p && p.rawBytes && p.rawBytes.length) {
    return p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes);
  }
  const s = String(text == null ? "" : text).trim();
  if (!s.length) throw new Error("输入为空——拖入图片文件，或在输入框粘贴图片的 base64/dataURL");
  const bytes = dataURLToBytes(s);
  if (!bytes.length) throw new Error("输入不是可识别的图片 base64/dataURL");
  return bytes;
}

/** PNG 一律纯 JS 解码（精确 RGBA 含 alpha）——canvas 预乘会毁掉 alpha 数学；其余格式浏览器 canvas。 */
async function bytesToRGBA(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (!u8.length) throw new Error("空图片数据");
  if (u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) {
    try {
      const dec = decodePNG(u8);
      return { width: dec.width, height: dec.height, data: dec.data };
    } catch (e) { /* 隔行等异常 PNG 回落 canvas */ }
  }
  if (typeof document !== "undefined" && typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(new Blob([u8]));
      const w = bmp.width, h = bmp.height; // close() 后宽高归零，必须先取
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      if (bmp.close) bmp.close();
      const id = ctx.getImageData(0, 0, w, h);
      return { width: w, height: h, data: new Uint8ClampedArray(id.data) };
    } catch (e) {
      throw new Error("图片解码失败：PNG 走纯 JS 解码；JPEG/GIF 等需浏览器环境（底层原因：" +
        (e && e.message ? e.message : String(e)) + "）");
    }
  }
  throw new Error("图片解码失败：非隔行 PNG 可纯 JS 解码；JPEG/GIF/隔行 PNG 等需浏览器环境");
}

/** 亮度（BT.601，与社区工具 sharp .greyscale 同口径）。 */
function luma(r, g, b) {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

/** 尺寸适配：hidden 按 fit 模式对齐到 dw×dh（cover 中心裁剪 / contain 白黑留边 / stretch 拉伸）。 */
function fitImage(src, dw, dh, fit, padWhite) {
  const sw = src.width, sh = src.height;
  const out = new Uint8ClampedArray(dw * dh * 4);
  if (fit === "stretch") {
    for (let y = 0; y < dh; y++) {
      const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
        const di = (y * dw + x) * 4, si = (sy * sw + sx) * 4;
        out[di] = src.data[si]; out[di + 1] = src.data[si + 1];
        out[di + 2] = src.data[si + 2]; out[di + 3] = src.data[si + 3];
      }
    }
    return { width: dw, height: dh, data: out };
  }
  const scale = fit === "contain" ? Math.min(dw / sw, dh / sh) : Math.max(dw / sw, dh / sh);
  const rw = Math.max(1, Math.round(sw * scale)), rh = Math.max(1, Math.round(sh * scale));
  const ox = Math.floor((dw - rw) / 2), oy = Math.floor((dh - rh) / 2);
  // 留边：contain 时表图边=白(255)、里图边=黑(0) → α=0 全透区，背景即所见，天然干净
  out.fill(padWhite ? 255 : 0);
  for (let y = 0; y < rh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / rh));
    const dy = y + oy;
    if (dy < 0 || dy >= dh) continue;
    for (let x = 0; x < rw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / rw));
      const dx = x + ox;
      if (dx < 0 || dx >= dw) continue;
      const di = (dy * dw + dx) * 4, si = (sy * sw + sx) * 4;
      out[di] = src.data[si]; out[di + 1] = src.data[si + 1];
      out[di + 2] = src.data[si + 2]; out[di + 3] = src.data[si + 3];
    }
  }
  return { width: dw, height: dh, data: out };
}

/* ==================== 幻影坦克（光影坦克） ==================== */

async function mirageEncode(text, p = {}) {
  const mode = p.mode === "color" ? "color" : "gray";
  const fit = ["cover", "contain", "stretch"].includes(p.fit) ? p.fit : "cover";
  const surface = await bytesToRGBA(inputBytes(text, p)); // 主输入 = 表图（白底显示）
  const secondSrc = p && p.secondImage != null ? String(p.secondImage).trim() : "";
  if (!secondSrc) throw new Error("请在「里图（黑底显示）」参数中选图/粘贴 base64/dataURL——幻影坦克需要两张图");
  const secondBytes = dataURLToBytes(secondSrc);
  if (!secondBytes.length) throw new Error("里图解析失败：请粘贴有效的 base64/dataURL 或直接选图");
  const hidden = await bytesToRGBA(secondBytes);

  const W = surface.width, H = surface.height;
  const hImg = fitImage(hidden, W, H, fit, false);
  const sD = surface.data, hD = hImg.data;
  const out = new Uint8ClampedArray(W * H * 4);
  let overflow = 0; // 里图亮度 > 表图的像素数（白底侧失真来源，如实计数回报）

  for (let i = 0; i < W * H; i++) {
    const si = i * 4;
    let A, F0, F1, F2;
    if (mode === "gray") {
      const w = luma(sD[si], sD[si + 1], sD[si + 2]);
      const b = luma(hD[si], hD[si + 1], hD[si + 2]);
      const d = w - b;
      if (d < 0) { overflow++; A = 255; F0 = F1 = F2 = b; } // 钳位 α=1：黑底精确、白底=b 偏暗
      else if (d >= 255) { A = 0; F0 = F1 = F2 = 0; } // 全透：白底见 255、黑底见 0，天然精确
      else {
        A = 255 - d;
        const f = A > 0 ? Math.min(255, Math.round((b * 255) / A)) : 0;
        F0 = F1 = F2 = f;
      }
    } else {
      // 彩色拟合：单 Alpha 三通道共享 → 取最大差定 α；黑底侧逐通道精确，白底侧向亮拟合
      let anyNeg = false, dmax = 0;
      for (let c = 0; c < 3; c++) {
        const d = sD[si + c] - hD[si + c];
        if (d < 0) anyNeg = true;
        if (d > dmax) dmax = d;
      }
      if (anyNeg) overflow++;
      if (dmax >= 255) { A = 0; F0 = F1 = F2 = 0; }
      else {
        A = 255 - dmax;
        F0 = A > 0 ? Math.min(255, Math.round((hD[si] * 255) / A)) : 0;
        F1 = A > 0 ? Math.min(255, Math.round((hD[si + 1] * 255) / A)) : 0;
        F2 = A > 0 ? Math.min(255, Math.round((hD[si + 2] * 255) / A)) : 0;
      }
    }
    out[si] = F0; out[si + 1] = F1; out[si + 2] = F2; out[si + 3] = A;
  }

  return { width: W, height: H, data: out, overflow };
}

/** 直通 alpha 合成到纯色底（0=黑 255=白）。 */
function composite(img, bg) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const si = i * 4;
    const a = data[si + 3];
    for (let c = 0; c < 3; c++) out[si + c] = Math.round((data[si + c] * a + bg * (255 - a)) / 255);
    out[si + 3] = 255;
  }
  return { width: w, height: h, data: out };
}

async function mirageDecode(text, p = {}) {
  const bytes = inputBytes(text, p);
  if (!(bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)) {
    throw new Error("输入不是 PNG——幻影坦克载体必是 RGBA PNG（JPEG/GIF 已压掉 alpha 双图结构；如是截图请先另存为 PNG）");
  }
  const img = await bytesToRGBA(bytes);
  const white = composite(img, 255);
  const black = composite(img, 0);
  return {
    text: [
      `幻影坦克解码：${img.width}×${img.height}`,
      `白底渲染 = 聊天缩略图所见；黑底渲染 = 点开大图所见`,
    ].join("\n"),
    files: [
      { name: `mirage_white_${img.width}x${img.height}.png`, mime: "image/png", bytes: encodePNG(white.data, white.width, white.height) },
      { name: `mirage_black_${img.width}x${img.height}.png`, mime: "image/png", bytes: encodePNG(black.data, black.width, black.height) },
    ],
  };
}

/* ==================== 小番茄图片混淆 ==================== */

// Gilbert 广义 Hilbert 曲线（任意 W×H），从流行网页版逐字节转写（见文件头正源注释）。
// 坐标直接写入展平 Int32Array（x0,y0,x1,y1,…），千万级像素不吃对象数组开销。
function generate2d(x, y, ax, ay, bx, by, flat, cursor) {
  const w = Math.abs(ax + ay);
  const h = Math.abs(bx + by);
  const dax = Math.sign(ax), day = Math.sign(ay);
  const dbx = Math.sign(bx), dby = Math.sign(by);
  if (h === 1) {
    for (let i = 0; i < w; i++) { flat[cursor.c++] = x; flat[cursor.c++] = y; x += dax; y += day; }
    return;
  }
  if (w === 1) {
    for (let i = 0; i < h; i++) { flat[cursor.c++] = x; flat[cursor.c++] = y; x += dbx; y += dby; }
    return;
  }
  let ax2 = Math.floor(ax / 2), ay2 = Math.floor(ay / 2);
  let bx2 = Math.floor(bx / 2), by2 = Math.floor(by / 2);
  const w2 = Math.abs(ax2 + ay2);
  const h2 = Math.abs(bx2 + by2);
  if (2 * w > 3 * h) {
    if (w2 % 2 && w > 2) { ax2 += dax; ay2 += day; } // 偶数步长优先（正源同款）
    generate2d(x, y, ax2, ay2, bx, by, flat, cursor);
    generate2d(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by, flat, cursor);
  } else {
    if (h2 % 2 && h > 2) { bx2 += dbx; by2 += dby; }
    generate2d(x, y, bx2, by2, ax2, ay2, flat, cursor);
    generate2d(x + bx2, y + by2, ax, ay, bx - bx2, by - by2, flat, cursor);
    generate2d(x + (ax - dax) + (bx2 - dbx), y + (ay - day) + (by2 - dby),
      -bx2, -by2, -(ax - ax2), -(ay - ay2), flat, cursor);
  }
}

function gilbertCurve(w, h) {
  const flat = new Int32Array(w * h * 2);
  const cursor = { c: 0 };
  if (w >= h) generate2d(0, 0, w, 0, 0, h, flat, cursor);
  else generate2d(0, 0, 0, h, w, 0, flat, cursor);
  if (cursor.c !== flat.length) throw new Error("Gilbert 曲线覆盖不完整（内部错误）");
  return flat;
}

async function tomatoRun(text, p, inverse) {
  const img = await bytesToRGBA(inputBytes(text, p));
  const w = img.width, h = img.height;
  const n = w * h;
  if (n > 33554432) throw new Error(`图片 ${w}×${h} 超过 3355 万像素上限——请先缩小再混淆（曲线内存开销随像素数线性×8 字节，网页版同样顶不住）`);
  const curve = gilbertCurve(w, h);
  let offset = Math.round(((Math.sqrt(5) - 1) / 2) * n); // 黄金比例（正源口径）
  const custom = Number(p && p.offset);
  if (Number.isFinite(custom) && custom > 0) offset = Math.round(custom) % n;
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const j = (((i + offset) % n) + n) % n;
    const sp = (inverse ? j : i) * 2;   // 混淆 dst[curve[j]]=src[curve[i]]；解混淆=逆
    const dp = (inverse ? i : j) * 2;
    const so = (curve[sp] + curve[sp + 1] * w) * 4;
    const dno = (curve[dp] + curve[dp + 1] * w) * 4;
    out[dno] = img.data[so]; out[dno + 1] = img.data[so + 1];
    out[dno + 2] = img.data[so + 2]; out[dno + 3] = img.data[so + 3];
  }
  return rgbaToDataURL(out, w, h);
}

/* ==================== 注册 ==================== */

register({
  id: "mirageTank", cat: "stegoFile", name: "幻影坦克",
  desc: "白底见表图、黑底见里图的 RGBA PNG（光影坦克=同物别名）：α=1−(白−黑)/255、前景=黑/α；灰度档经典精确，彩色档黑底侧精确/白底侧拟合；解码反渲染出白/黑两张图",
  params: [
    { key: "mode", label: "合成模式", type: "select", default: "gray",
      options: [
        { value: "gray", label: "灰度（经典，精确）" },
        { value: "color", label: "彩色拟合（黑底侧精确，白底侧向亮）" },
      ] },
    { key: "fit", label: "里图对齐（以表图尺寸为锚）", type: "select", default: "cover",
      options: [
        { value: "cover", label: "cover 缩放居中裁剪（默认）" },
        { value: "contain", label: "contain 完整缩放留边（边=透明）" },
        { value: "stretch", label: "stretch 拉伸填满" },
      ] },
    { key: "secondImage", label: "里图（黑底显示；可直接选图/拖图）", type: "image", default: "",
      placeholder: "主输入=表图（白底显示），本参数=里图" },
  ],
  encode: async (text, p) => {
    const r = await mirageEncode(text, p);
    const png = encodePNG(r.data, r.width, r.height);
    if (r.overflow > 0) {
      return {
        text: `⚠ ${r.overflow} 个像素里图亮度高于表图（已钳位 α=1，白底侧偏暗失真）——建议表图整体调亮或里图调暗`,
        files: [{ name: `mirage_${r.width}x${r.height}.png`, mime: "image/png", bytes: png }],
      };
    }
    return rgbaToDataURL(r.data, r.width, r.height);
  },
  decode: mirageDecode,
  acceptsBytes: true,
});

register({
  id: "tomatoScramble", cat: "stegoFile", name: "小番茄图片混淆",
  desc: "Gilbert 广义 Hilbert 曲线像素重排 + 黄金比例偏移 round((√5−1)/2×W×H)；与流行网页版/桌面版同算法互解；RGBA 四字节整搬，输出无损 PNG；解码=精确逆映射",
  params: [
    { key: "offset", label: "偏移量（0=黄金比例自动）", type: "number", default: 0,
      placeholder: "正源默认 round((√5−1)/2×W×H)；已知自定义偏移可手填" },
  ],
  encode: (text, p) => tomatoRun(text, p, false),
  decode: (text, p) => tomatoRun(text, p, true),
  acceptsBytes: true,
});

export default { gilbertCurve, composite, fitImage, luma, mirageEncode, tomatoRun };
