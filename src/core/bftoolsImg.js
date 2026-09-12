/*
 * bftoolsImg.js — Brainloller / Braincopter 图像变体编解码（T389）。
 * 规范来源：bftools.exe 逐字节实测对拍（见 progress.md 2026-09-04 晚段）。
 *  - brainloller：bftools 实测色表（与社区规范不同）+ 蛇形路径 + 左右缘转向标记 + firebrick 终止。
 *  - braincopter：经典 esolangs 规范 f = (-2R+3G+B) mod 11，0..7→><+-.,[]，8/9/10=nop/终止。
 * 纯 JS、零 UI 依赖；PNG 解码复用 stegoPixels.decodePNG，PNG 写出为内置最小编码器（RGBA + stored-deflate zlib）。
 */
import { register } from "./registry.js";
import { decodePNG } from "./stegoPixels.js";
import { bfRun } from "./bfDialects.js";

// ============ 基础：CRC32 / Adler32 / zlib(stored) / PNG 写出 ============
function crc32(buf) {
  let c, t = [];
  for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function adler32(buf) {
  let a = 1, b = 0;
  for (const x of buf) { a = (a + x) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
// zlib 流（stored 块，零压缩——PNG 合法且任何解码器可读）
function zlibStore(raw) {
  const nBlocks = Math.ceil(raw.length / 65535) || 1;
  const out = new Uint8Array(2 + raw.length + nBlocks * 5 + 4);
  let o = 0;
  out[o++] = 0x78; out[o++] = 0x01;
  for (let i = 0; i < nBlocks; i++) {
    const chunk = raw.subarray(i * 65535, Math.min((i + 1) * 65535, raw.length));
    const last = i === nBlocks - 1 ? 1 : 0;
    out[o++] = last; // BFINAL/BTYPE=00 打包进首字节
    out[o++] = chunk.length & 0xff; out[o++] = (chunk.length >>> 8) & 0xff;
    out[o++] = (~chunk.length) & 0xff; out[o++] = ((~chunk.length) >>> 8) & 0xff;
    out.set(chunk, o); o += chunk.length;
  }
  const ad = adler32(raw);
  out[o++] = (ad >>> 24) & 0xff; out[o++] = (ad >>> 16) & 0xff; out[o++] = (ad >>> 8) & 0xff; out[o++] = ad & 0xff;
  return out.subarray(0, o);
}
function pngChunk(type, data) {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length);
  const td = new Uint8Array(4 + data.length);
  td.set(type); td.set(data, 4);
  const c = new Uint8Array(4);
  new DataView(c.buffer).setUint32(0, crc32(td));
  return [len, td, c];
}
// RGBA 像素 → PNG 字节（8bit RGBA，filter 0）
export function encodePNG_RGBA(width, height, rgba) {
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width);
  new DataView(ihdr.buffer).setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; // 8bit RGBA
  const stride = width * 4;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + stride)] = 0;
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (1 + stride) + 1);
  }
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  parts.push(...pngChunk([0x49, 0x48, 0x44, 0x52], ihdr)); // IHDR
  parts.push(...pngChunk([0x49, 0x44, 0x41, 0x54], zlibStore(raw))); // IDAT
  parts.push(...pngChunk([0x49, 0x45, 0x4e, 0x44], new Uint8Array(0))); // IEND
  let total = 0; for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

// ============ Brainloller（bftools 实测色表） ============
const BL_INS = { "255,0,0": ">", "128,0,0": "<", "0,255,0": "+", "0,128,0": "-", "255,255,0": "[", "128,128,0": "]", "0,0,255": ".", "0,0,128": "," };
const BL_COLOR = { ">": [255, 0, 0], "<": [128, 0, 0], "+": [0, 255, 0], "-": [0, 128, 0], "[": [255, 255, 0], "]": [128, 128, 0], ".": [0, 0, 255], ",": [0, 0, 128] };
const BL_TURN_R = [0, 255, 255], BL_TURN_L = [0, 128, 128], BL_END = [178, 34, 34], BL_BLACK = [0, 0, 0];

// 蛇形路径像素坐标：行 0 从左向右，行 1 从右向左……
function blPath(W, H) {
  const seq = [];
  for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) seq.push([y % 2 === 0 ? i : W - 1 - i, y]);
  return seq;
}
// 解码：PNG 字节 → BF 程序文本
export function brainlollerDecode(pngBytes) {
  const img = decodePNG(pngBytes);
  const { width: W, height: H, data } = img;
  let prog = "";
  for (const [x, y] of blPath(W, H)) {
    const o = (y * W + x) * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    if (r === BL_END[0] && g === BL_END[1] && b === BL_END[2]) break;
    if (r === BL_TURN_R[0] && g === BL_TURN_R[1] && b === BL_TURN_R[2]) continue;
    if (r === BL_TURN_L[0] && g === BL_TURN_L[1] && b === BL_TURN_L[2]) continue;
    if (r === BL_BLACK[0] && g === BL_BLACK[1] && b === BL_BLACK[2]) continue;
    const ins = BL_INS[r + "," + g + "," + b];
    if (ins) prog += ins; // 未知色跳过（载体图兼容）
  }
  return prog;
}
// 编码：BF 程序 → PNG 字节（蛇形布局，行容量 W-2，尾行放完即 firebrick）
export function brainlollerEncode(prog, width = 16) {
  const code = String(prog).replace(/[^><+\-.,\[\]]/g, "");
  const W = Math.max(4, width | 0);
  const H = Math.max(1, Math.ceil(code.length / (W - 2)) || 1);
  const rgba = new Uint8Array(W * H * 4);
  const put = (x, y, c) => { const o = (y * W + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255; };
  let k = 0, ended = false;
  for (const [x, y] of blPath(W, H)) {
    if (y === 0 && x === 0) { put(x, y, BL_BLACK); continue; } // 起点
    // 转向标记占「边缘列的连续两行」：右缘两行放右转标记、左缘两行放左转标记（exe 实测对拍）
    if (x === W - 1) { put(x, y, BL_TURN_R); continue; }
    if (y > 0 && x === 0) { put(x, y, BL_TURN_L); continue; }
    if (!ended) {
      if (k < code.length) put(x, y, BL_COLOR[code[k++]]);
      else { ended = true; put(x, y, BL_END); }
    } else put(x, y, BL_END);
  }
  return encodePNG_RGBA(W, H, rgba);
}

// ============ Braincopter（经典规范 f=(-2R+3G+B) mod 11） ============
const BC_VAL = [">", "<", "+", "-", ".", ",", "[", "]"]; // 0..7
const BC_CODE = { ">": 0, "<": 1, "+": 2, "-": 3, ".": 4, ",": 5, "[": 6, "]": 7 };
const BC_NOP = 10; // exe 终止填充值
const mod11 = v => ((v % 11) + 11) % 11;
const pixF = (r, g, b) => mod11(-2 * r + 3 * g + b);

export function braincopterDecode(pngBytes, allowGap = false) {
  const img = decodePNG(pngBytes);
  const { width: W, height: H, data } = img;
  const total = W * H;
  let prog = "", i = 0, gapUsed = false;
  const at = j => pixF(data[j * 4], data[j * 4 + 1], data[j * 4 + 2]);
  while (i < total) {
    const f = at(i);
    if (f <= 7) { prog += BC_VAL[f]; i++; continue; }
    if (!allowGap || gapUsed) break;
    // exe 长图容错：跳过一段连续 nop（≤32 像素）续读一次
    let j = i;
    while (j < total && at(j) > 7 && j - i <= 32) j++;
    if (j > i && j < total && at(j) <= 7) { i = j; gapUsed = true; continue; }
    break;
  }
  return prog;
}
// basePx：载体 RGBA（Uint8Array W*H*4）；程序写入 + 终止符填充到 W 整数倍
export function braincopterEncode(prog, basePx, W, H) {
  const code = String(prog).replace(/[^><+\-.,\[\]]/g, "");
  const rgba = new Uint8Array(basePx);
  const total = W * H;
  const nWrite = Math.min(total, W * Math.max(1, Math.ceil((code.length + 1) / W)));
  for (let i = 0; i < nWrite; i++) {
    const target = i < code.length ? BC_CODE[code[i]] : BC_NOP;
    const o = i * 4;
    let d = mod11(target - pixF(rgba[o], rgba[o + 1], rgba[o + 2]));
    if (d > 5) d -= 11; // 最小绝对改动（对齐 exe 观测）
    rgba[o + 2] = (rgba[o + 2] + d) & 0xff;
  }
  return encodePNG_RGBA(W, H, rgba);
}
function solidBase(W, H, rgb) {
  const a = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { a[i * 4] = rgb[0]; a[i * 4 + 1] = rgb[1]; a[i * 4 + 2] = rgb[2]; a[i * 4 + 3] = 255; }
  return a;
}

// ============ 图片输入提取（rawBytes / dataURL） ============
function toPngBytes(p) {
  const rb = p && p.rawBytes;
  if (rb && rb.length) return rb instanceof Uint8Array ? rb : new Uint8Array(rb);
  const t = String(p && p.text != null ? p.text : "").trim();
  const m = t.match(/^data:image\/png;base64,(.+)$/s);
  if (m) {
    const b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    return Uint8Array.from(bin, ch => ch.charCodeAt(0));
  }
  throw new Error("请拖入 PNG 图片（或粘贴 data:image/png;base64,… 图片数据）");
}

// ============ op 注册 ============
register({
  id: "brainlollerDecode", family: "brainloller", familyLabel: "decode", cat: "stego", name: "Brainloller 解码",
  desc: "Brainloller 图像 → Brainfuck 程序（bftools 实测色表 + 蛇形路径；终止色 firebrick，转向标记占格）",
  params: [{ key: "exec", label: "解码后执行 BF 并输出运行结果", type: "bool", default: false }],
  run(_t, p = {}) {
    const prog = brainlollerDecode(toPngBytes(p));
    if (p.exec) {
      const out = bfRun(prog);
      return "BF 程序（" + prog.length + " 指令）：\n" + prog + "\n\n执行输出：\n" + out;
    }
    return prog;
  },
  acceptsBytes: true,
});
register({
  id: "brainlollerEncode", family: "brainloller", familyLabel: "encode", cat: "stego", name: "Brainloller 编码",
  desc: "Brainfuck 程序 → Brainloller PNG（蛇形布局，行容量 W-2，行容量随宽度可调）",
  params: [{ key: "width", label: "图像宽度", type: "number", default: 16, placeholder: "≥4，每行指令容量=宽-2" }],
  encode(text, p = {}) {
    const png = brainlollerEncode(text, Number(p.width) || 16);
    return { text: "已生成 Brainloller PNG（" + String(text).replace(/[^><+\-.,\[\]]/g, "").length + " 指令）", files: [{ name: "brainloller.png", mime: "image/png", bytes: png }] };
  },
});
register({
  id: "braincopterDecode", family: "braincopter", familyLabel: "decode", cat: "stego", name: "Braincopter 解码",
  desc: "Braincopter 图像 → Brainfuck 程序（f=(-2R+3G+B) mod 11 经典规范；遇 nop/终止即停）",
  params: [
    { key: "exec", label: "解码后执行 BF 并输出运行结果", type: "bool", default: false },
    { key: "allowGap", label: "exe 长图容错（跳过一段 nop 续读）", type: "bool", default: false },
  ],
  run(_t, p = {}) {
    const prog = braincopterDecode(toPngBytes(p), !!p.allowGap);
    if (p.exec) {
      const out = bfRun(prog);
      return "BF 程序（" + prog.length + " 指令）：\n" + prog + "\n\n执行输出：\n" + out;
    }
    return prog;
  },
  acceptsBytes: true,
});
register({
  id: "braincopterEncode", family: "braincopter", familyLabel: "encode", cat: "stego", name: "Braincopter 编码",
  desc: "Brainfuck 程序 → Braincopter PNG（每像素 f=(-2R+3G+B) mod 11，最小改动写入，终止符填充到宽度整数倍；载体为指定纯色）",
  params: [
    { key: "width", label: "载体宽度", type: "number", default: 64 },
    { key: "height", label: "载体高度", type: "number", default: 48 },
    { key: "baseColor", label: "载体基色（hex）", type: "text", default: "#804020", placeholder: "#RRGGBB" },
  ],
  encode(text, p = {}) {
    const W = Math.max(4, Number(p.width) || 64), H = Math.max(2, Number(p.height) || 48);
    const m = /^#?([0-9a-fA-F]{6})$/.test(String(p.baseColor || "")) ? /^#?([0-9a-fA-F]{6})$/.exec(String(p.baseColor))[1] : "804020";
    const base = solidBase(W, H, [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)]);
    const png = braincopterEncode(text, base, W, H);
    return { text: "已生成 Braincopter PNG（" + String(text).replace(/[^><+\-.,\[\]]/g, "").length + " 指令，载体 " + W + "×" + H + "）", files: [{ name: "braincopter.png", mime: "image/png", bytes: png }] };
  },
});
