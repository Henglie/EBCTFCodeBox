/*
 * sstv.js — SSTV（慢扫描电视）编/解（cat:'audio'，acceptsBytes）。
 *
 * decode：拖入 WAV（整数 PCM 8/16/24/32bit），FM 鉴频 + VIS 头解码 + 逐行再同步，
 *         还原 Martin M1(320×256) / Robot36(320×240) 图像为 PNG 产物；
 *         VIS/奇校验/停止位/时钟比/行同步命中诊断随报告输出。
 * encode：输入 hex（RGB 字节流，须恰为模式尺寸 320×256 或 320×240），
 *         按 pySSTV 口径（频率/时序/BT.601 全范围色彩）合成 WAV 产物。
 *
 * 内核 sstvCodec.js：发射侧逐条对齐 pySSTV（MIT），接收侧自研
 * （正交下变频 + 复低通 FIR 多相抽取 + 相位差鉴频 + 逐行同步 + 时钟比 EMA 校准）。
 * 其它 VIS（Scottie/PD 系等）显式拒绝；IEEE float 与压缩 fmt WAV 显式拒绝。
 */
import { register } from "./registry.js";
import { decodeSSTV, encodeSSTV } from "./sstvCodec.js";
import { encodePNG } from "./mcMap.js";

function toBytes(input) {
  if (input instanceof Uint8Array) return input;
  const s = String(input ?? "");
  // 粘贴侧常见格式：base64（含 dataURL）/ hex
  const b64 = s.replace(/^data:[^,]*,/, "").trim();
  const isHex = /^[0-9a-fA-F\s]+$/.test(s) && s.replace(/\s/g, "").length % 2 === 0;
  try {
    if (/^[A-Za-z0-9+/=\s]+$/.test(b64) && b64.replace(/\s/g, "").length >= 24 && !isHex) {
      const bin = atob(b64.replace(/\s/g, ""));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
  } catch (e) { /* 落回 hex/原文 */ }
  if (isHex) {
    const h = s.replace(/\s/g, "");
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }
  return new TextEncoder().encode(s);
}

function pngFromRgb(data, width, height) {
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3) {
    rgba[j++] = data[i]; rgba[j++] = data[i + 1]; rgba[j++] = data[i + 2]; rgba[j++] = 255;
  }
  return encodePNG(rgba, width, height);
}

/** decode 通道：WAV 字节 → SSTV 图像 PNG + 诊断报告 */
function sstvDecodeOp(input, p = {}) {
  // acceptsBytes 拖入真字节经 params.rawBytes 透传（与 stringsExtract.inputToBytes 同口径）
  const bytes = p && p.rawBytes && p.rawBytes.length
    ? (p.rawBytes instanceof Uint8Array ? p.rawBytes : new Uint8Array(p.rawBytes))
    : toBytes(input);
  const r = decodeSSTV(bytes);
  if (!r.ok) throw new Error(r.error || "SSTV 解码失败");
  const png = pngFromRgb(r.image.data, r.image.width, r.image.height);
  const i = r.info;
  const lines = [
    `SSTV 解码成功：${r.mode}（VIS=0x${r.vis.toString(16).padStart(2, "0")}），图像 ${r.image.width}×${r.image.height}`,
    `采样率 ${i.rate} Hz（抽取后 ${i.decimatedRate} Hz），时钟比 ${i.clockRatio.toFixed(4)}`,
    `VIS 校验：奇校验${i.parityOk ? "通过" : "不符"} / 停止位${i.stopOk ? "符合" : "不符"}（位串 ${i.visBits}）`,
    `行同步：命中 ${i.syncFound} / 丢失 ${i.syncMiss}`,
    `产物：sstv_decoded.png（${png.length} 字节）`,
  ];
  return {
    text: lines.join("\n"),
    files: [{ name: "sstv_decoded.png", mime: "image/png", bytes: png }],
    meta: { vis: r.vis, mode: r.mode, ...i },
  };
}

/** encode 通道：hex RGB（恰为模式尺寸）→ SSTV WAV */
function sstvEncodeOp(input, p = {}) {
  const modeName = String(p.mode || "Martin M1");
  const rate = Number(p.rate) || 44100;
  const bits = Number(p.bits) === 8 ? 8 : 16;
  const hex = String(input ?? "").replace(/^0x/i, "").replace(/[\s,]/g, "");
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length === 0) {
    throw new Error("encode 输入须为 RGB 像素 hex（每像素 6 个 hex 字符，无分隔）。");
  }
  if (hex.length % 6 !== 0) {
    throw new Error(`RGB hex 长度须为 6 的倍数（每像素 3 字节），当前 ${hex.length} 个字符。`);
  }
  const dims = { "Martin M1": [320, 256], "Robot36": [320, 240] };
  const [w, h] = dims[modeName] || [0, 0];
  if (!w) throw new Error(`未实现的 SSTV 模式: ${modeName}（本 op 仅支持 Martin M1 与 Robot36）`);
  const data = new Uint8Array(hex.length / 2);
  for (let i = 0; i < data.length; i++) data[i] = parseInt(hex.substr(i * 2, 2), 16);
  if (data.length !== w * h * 3) {
    throw new Error(`输入须恰为 ${modeName} 尺寸 ${w}×${h} 的 RGB 数据（${w * h * 3} 字节），当前 ${data.length} 字节。不做缩放——先用图像工具转好尺寸再取 hex。`);
  }
  const r = encodeSSTV(modeName, { width: w, height: h, data }, rate, bits);
  const lines = [
    `SSTV 编码成功：${r.mode}（VIS=0x${r.vis.toString(16).padStart(2, "0")}），${w}×${h}`,
    `WAV：${r.rate} Hz / ${r.bits}bit 单声道，时长 ${r.durationMs.toFixed(0)} ms，${r.wav.length} 字节`,
    `产物：sstv_encoded.wav（可用本工具 decode 方向读回验证）`,
  ];
  return {
    text: lines.join("\n"),
    files: [{ name: "sstv_encoded.wav", mime: "audio/wav", bytes: r.wav }],
    meta: { mode: r.mode, vis: r.vis, rate: r.rate, bits: r.bits, durationMs: r.durationMs },
  };
}

register({
  id: "sstv",
  cat: "audio",
  name: "SSTV 慢扫描电视 编/解",
  desc: "WAV 里的 SSTV 信号还原成图片：Martin M1 / Robot36 双向。decode 拖入整数 PCM WAV（FM 鉴频 + VIS 头 + 逐行再同步，抗 ±2% 时钟频偏），输出 PNG + VIS/校验/行同步诊断；encode 输入模式尺寸的 RGB hex 合成 WAV。其它模式（Scottie/PD 等）与浮点/压缩 WAV 显式拒绝",
  acceptsBytes: true,
  params: [
    {
      key: "mode", label: "模式（encode）", type: "select", default: "Martin M1",
      options: [
        { value: "Martin M1", label: "Martin M1（320×256，VIS 0x2c）" },
        { value: "Robot36", label: "Robot36（320×240，VIS 0x08）" },
      ],
    },
    {
      key: "rate", label: "采样率（encode）", type: "select", default: "44100",
      options: [
        { value: "44100", label: "44100 Hz" },
        { value: "22050", label: "22050 Hz" },
        { value: "11025", label: "11025 Hz" },
      ],
    },
    {
      key: "bits", label: "位深（encode）", type: "select", default: "16",
      options: [
        { value: "16", label: "16 bit" },
        { value: "8", label: "8 bit" },
      ],
    },
  ],
  decode: sstvDecodeOp,
  encode: sstvEncodeOp,
});

export { sstvDecodeOp, sstvEncodeOp };
