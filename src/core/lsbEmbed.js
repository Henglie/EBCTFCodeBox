/*
 * lsbEmbed.js — LSB 嵌入（出题）（cat:'stego'，P1 批，单向 run）。
 *
 * 解决什么：把一段载荷（文本）写进封面图指定位平面的最低有效位，生成隐写图
 * （PNG）。用于出 misc 题——先做一张 LSB 隐写图，配合本工具另一张
 * `zstegScan`（LSB 全组合扫描）解回。
 *
 * 与提取侧一一对应（参考实现 lsb_embed.rs 头注释：与 lsb_stego 参数一一对应，
 * 用相同 通道顺序 / 位平面 / 位序 即可把载荷提取回来）：
 * - 通道顺序：参数 `channels`（R/G/B/A），如 "RGB" → 通道下标 [0,1,2]
 * - 位平面：参数 `bit`（0..7），0 = 最低位
 * - 位序：参数 `msbFirst`（高位先打包），与 zstegScan 的 MSB-first 读序对齐
 * - 遍历：行主序像素序（与 zstegScan 行优先读序一致）
 *
 * 解析路径（复用现有纯 JS 栈，不引外部图像库）：
 * - 封面解码：`lsbExtract.decodePngPixels` / `decodeBmpPixels`（PNG 8bit 非隔行 /
 *   BMP 24·32bit 未压缩，与 zstegScan 同源）
 * - 统一转 RGBA：encodePNG 只认 RGBA（colorType 6），把解码样本按 4/3/1 通道
 *   扩成 RGBA（1 通道灰度复制到 RGB；alpha 置 255）
 * - 写位：对每个像素、每个选中通道、按行主序 + 位序取载荷 1 位，写进 `bit` 平面
 * - 编码：`mcMap.encodePNG` 纯 JS 产 PNG → `rgbaToDataURL` 出 data URL
 *
 * 载荷编码：参数 `payload` 文本按 UTF-8 取字节。
 * 容量：需 total_bits = 载荷字节×8，容量 = 像素数 × 通道数；超出报错（同参考）。
 *
 * 输出：data:image/png;base64,...（PNG 字节→base64，同 mcMap 出图先例），
 * 用户可直接保存为隐写图。
 *
 * 零外发：纯字节解析+PNG 编码。
 *
 * 回归断言：加载期自检 IIFE（含参考单测 embed_then_extract_recovers_payload 形态：
 * 16×16 纯色封面嵌入 "HI" → 重解析抽位还原 "HI"；及位平面/通道/容量/非图报错）。
 */
import { register } from "./registry.js";
import { inputToBytes } from "./compress.js";
import { decodePngPixels, decodeBmpPixels } from "./lsbExtract.js";
import { encodePNG, rgbaToDataURL } from "./mcMap.js";

// ============ 基础工具 ============

const CHAN_MAP = { R: 0, G: 1, B: 2, A: 3 };

/** "RGB" → [0,1,2]；未知字母忽略；空返回 null（参考 chans.is_empty 语义）。 */
export function parseChannels(s) {
  const out = [];
  for (const ch of String(s || "")) {
    const c = ch.toUpperCase();
    const idx = CHAN_MAP[c];
    if (idx !== undefined) out.push(idx);
  }
  return out.length ? out : null;
}

/** 解码样本（native 通道）→ RGBA 缓冲。4→直用 3→补 alpha、1→灰度复制+alpha。 */
export function toRgba(decoded) {
  const { width, height, channels, samples } = decoded;
  const n = width * height;
  const rgba = new Uint8Array(n * 4);
  if (channels === 4) {
    rgba.set(samples);
  } else if (channels === 3) {
    for (let i = 0; i < n; i++) {
      const s = i * 3, d = i * 4;
      rgba[d] = samples[s]; rgba[d + 1] = samples[s + 1]; rgba[d + 2] = samples[s + 2];
      rgba[d + 3] = 255;
    }
  } else {
    for (let i = 0; i < n; i++) {
      const v = samples[i], d = i * 4;
      rgba[d] = v; rgba[d + 1] = v; rgba[d + 2] = v; rgba[d + 3] = 255;
    }
  }
  return rgba;
}

/**
 * LSB 嵌入主逻辑：把 payloadBytes 写进封面像素 RGBA 的指定位平面。
 * @param {Uint8Array} rgba    RGBA 像素缓冲（可原地改写）
 * @param {number} n           像素数（=rgba.length/4）
 * @param {number[]} chans     通道下标序列（已解析）
 * @param {number} bit         位平面 0..7
 * @param {boolean} msbFirst   位序：true 高位先打包（与 zstegScan MSB 读序对齐）
 * @param {Uint8Array} payloadBytes 载荷字节
 * @returns {{ok:true,pixels:n,capacity:number}} | {ok:false,error,capacity}
 */
export function lsbEmbedPixels(rgba, n, chans, bit, msbFirst, payloadBytes) {
  const totalBits = payloadBytes.length * 8;
  const capacity = n * chans.length;
  if (totalBits > capacity) {
    return { ok: false, error: `载荷过大：需要 ${totalBits} 位，封面图仅能容纳 ${capacity} 位（${n} 像素 × ${chans.length} 通道）。`, capacity };
  }
  let bitIdx = 0;
  for (let i = 0; i < n && bitIdx < totalBits; i++) {
    for (const ch of chans) {
      if (bitIdx >= totalBits) break;
      const byte = payloadBytes[bitIdx >> 3];
      const shift = msbFirst ? (7 - (bitIdx % 8)) : (bitIdx % 8);
      const b = (byte >> shift) & 1;
      const off = i * 4 + ch;
      rgba[off] = (rgba[off] & ~(1 << bit)) | (b << bit);
      bitIdx++;
    }
  }
  return { ok: true, capacity };
}

// ============ op run ============

function lsbEmbedRun(text, p) {
  const pp = p || {};
  const payload = pp.payload == null ? "" : String(pp.payload);

  if ((!text || !String(text).trim()) && !(pp.rawBytes && pp.rawBytes.length)) {
    return "（空输入）请拖入封面图片（PNG/BMP）或粘贴其 hex / base64 字节，并在「载荷」填要嵌入的文本。";
  }
  let bytes;
  try { bytes = inputToBytes(text, pp); }
  catch (e) { return "封面输入解析失败：" + (e && e.message ? e.message : String(e)); }

  const chans = parseChannels(pp.channels != null ? pp.channels : "RGB");
  if (!chans) return "通道至少选一个（R/G/B/A）。";
  let bit = Number(pp.bit);
  if (!Number.isFinite(bit)) bit = 0;
  bit = Math.max(0, Math.min(7, Math.floor(bit)));
  const msbFirst = pp.msbFirst !== false;
  const payloadBytes = new TextEncoder().encode(payload);

  // 封面解码（PNG 优先，BMP 兜底）
  let decoded = decodePngPixels(bytes);
  if (!decoded) decoded = decodeBmpPixels(bytes);
  if (!decoded) return "不支持的封面格式（仅 PNG / BMP），或输入不是图片字节。";
  if (decoded.unsupported) return "封面像素解码失败：" + decoded.unsupported;

  const { width, height } = decoded;
  const n = width * height;
  const rgba = toRgba(decoded);
  const res = lsbEmbedPixels(rgba, n, chans, bit, msbFirst, payloadBytes);
  if (!res.ok) return res.error;

  return rgbaToDataURL(rgba, width, height);
}

// ============ 测试构造器（供回归构造已知封面） ============
/** 纯色 RGBA 封面 PNG。 */
export function makeSolidPng(width, height, rgba) {
  const buf = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    buf[i * 4] = rgba[0]; buf[i * 4 + 1] = rgba[1];
    buf[i * 4 + 2] = rgba[2]; buf[i * 4 + 3] = rgba[3];
  }
  return encodePNG(buf, width, height);
}

// ============ 加载期自检（import 即跑；异常未处理会非零退出） ============

(() => {
  const cover = () => makeSolidPng(16, 16, [100, 150, 200, 255]);

  // 参考单测形态：封面 100,150,200 → 嵌入 "HI"（RGB/bit0/msb）→ 重解析抽位还原 "HI"
  const checkRoundtrip = (pngBytes, chans, bit, msbFirst, expected, label) => {
    const dec = decodePngPixels(pngBytes);
    if (!dec) throw new Error(`lsbEmbed 自检-${label} 解码封面失败`);
    const rgba = toRgba(dec);
    const payload = new TextEncoder().encode(expected);
    const res = lsbEmbedPixels(rgba, dec.width * dec.height, chans, bit, msbFirst, payload);
    if (!res.ok) throw new Error(`lsbEmbed 自检-${label} 嵌入失败: ${res.error}`);
    const out = encodePNG(rgba, dec.width, dec.height);
    const dec2 = decodePngPixels(out);
    if (!dec2) throw new Error(`lsbEmbed 自检-${label} 重解码失败`);
    const rgba2 = toRgba(dec2);
    // 按相同读序抽回（行主序像素 × 通道序列 × 位序 → 8 位打包）
    const got = new Uint8Array(payload.length);
    let bitIdx = 0;
    for (let i = 0; i < dec2.width * dec2.height && bitIdx < payload.length * 8; i++) {
      for (const ch of chans) {
        if (bitIdx >= payload.length * 8) break;
        const b = (rgba2[i * 4 + ch] >> bit) & 1;
        if (msbFirst) got[bitIdx >> 3] = (got[bitIdx >> 3] << 1) | b;
        else got[bitIdx >> 3] |= b << (bitIdx % 8);
        bitIdx++;
      }
    }
    if (new TextDecoder().decode(got) !== expected) {
      throw new Error(`lsbEmbed 自检-${label} 往返失真: 得 "${new TextDecoder().decode(got)}"`);
    }
  };

  // ① 参考向量：RGB bit0 msb-first → "HI"
  checkRoundtrip(cover(), parseChannels("RGB"), 0, true, "HI", "①");
  // ② 含 alpha 通道：RGBA bit0 → "RGBA"
  checkRoundtrip(cover(), parseChannels("RGBA"), 0, true, "RGBA?", "②");
  // ③ 位平面 bit1 + lsb-first
  checkRoundtrip(cover(), parseChannels("B"), 1, false, "low", "③");
  // ④ 灰度封面自动复制到 RGB 通道仍可抽回（makeSolidPng 恒 RGBA，这里验证单通道 n=RGB 等效）
  checkRoundtrip(cover(), parseChannels("G"), 0, true, "plain", "④");
  // ⑤ 参数接口：run 空输入提示
  if (!lsbEmbedRun("", {}).includes("空输入")) throw new Error("lsbEmbed 自检⑤-空输入失败");
  // ⑥ 通道全非法 → 提示
  const out6 = lsbEmbedRun(Array.from(makeSolidPng(4, 4, [1, 2, 3, 255]), (b) => (b < 16 ? "0" : "") + b.toString(16)).join(""), { payload: "x", channels: "XYZ" });
  if (!out6.includes("通道至少选一个")) throw new Error(`lsbEmbed 自检⑥失败: ${out6}`);
  // ⑦ 非图片封面 → 提示
  const out7 = lsbEmbedRun("aGVsbG8=", { payload: "x", inputEnc: "base64" });
  if (!out7.includes("不支持的封面格式")) throw new Error(`lsbEmbed 自检⑦失败: ${out7}`);
  // ⑧ 容量超限（8 字节载荷可能需要… 4×4 全通道 bit0 容量 4×4×4=64 位=8 字节，用 3 通道 RGB 载 9 字节超）
  const cover8 = Array.from(makeSolidPng(4, 4, [1, 2, 3, 255]), (b) => (b < 16 ? "0" : "") + b.toString(16)).join("");
  const out8 = lsbEmbedRun(cover8, { payload: "123456789", channels: "RGB", inputEnc: "hex" });
  if (!out8.includes("载荷过大")) throw new Error(`lsbEmbed 自检⑧失败: ${out8}`);
  // ⑨ 空载荷也出图（写入 0 位）
  const out9 = lsbEmbedRun(cover8, { payload: "", channels: "RGB", inputEnc: "hex" });
  if (!out9.startsWith("data:image/png;base64,")) throw new Error("lsbEmbed 自检⑨失败");
})();

// ============ register ============

register({
  id: "lsbEmbed", cat: "stego", name: "LSB 嵌入（出题）",
  desc: "把载荷文本写进封面图（PNG/BMP）指定位平面的最低有效位，生成隐写图 PNG（通道顺序/位平面/位序与 zstegScan 一一对应，出 misc 题用）",
  params: [
    { key: "inputEnc", label: "封面输入编码（文本输入时）", type: "select", default: "auto",
      options: [
        { value: "auto", label: "自动（hex/base64/UTF-8）" },
        { value: "hex", label: "Hex" },
        { value: "base64", label: "Base64" },
        { value: "utf8", label: "UTF-8 文本" },
      ],
    },
    { key: "payload", label: "载荷（待嵌入文本）", type: "text", default: "" },
    { key: "channels", label: "通道顺序（R/G/B/A）", type: "text", default: "RGB" },
    { key: "bit", label: "位平面（0=最低位）", type: "number", default: 0 },
    { key: "msbFirst", label: "高位先打包", type: "bool", default: true },
  ],
  run: lsbEmbedRun,
  acceptsBytes: true,
});

export { lsbEmbedRun };