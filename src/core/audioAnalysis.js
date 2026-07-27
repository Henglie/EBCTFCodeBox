/*
 * audioAnalysis.js — 音频文件自动智能分析（cat: 无）。
 *
 * 定位：拖入音频文件 → 智能跑 DTMF 拨号识别 / SSTV 模式标注 / 音频 LSB 隐写
 * 产出 section（遵守 fileAnalysis schema 契约，含 actions）。本模块只产出
 * {sections:[...]}，由 main.js handleFile 按 detected.ext/mime 分派调用、合并进报告。
 *
 * 复用（先读确认签名，单向依赖，不修改复用件）：
 * ./dtmfWav.js dtmfDecode(text, p) / parseWavPcm(bytes) / goertzel / ROW / COL
 * dtmfDecode 吃 base64/hex 文本 → Goertzel 8 频 → 按键序列
 * parseWavPcm(bytes) → {sig: Float64Array, sampleRate}
 * ./audiostego.js parseWav(bytes) / readPcmSamples(bytes,fmt,off,size) / goertzel
 * parseWav → {ok, fmt, data, chunks, error}（结构更详）
 * readPcmSamples → {channels:[Int32Array], frames, bytesPerSample}
 *
 * 算法链路（WAV 分支）：
 * WAV 字节 → parseWav 结构校验 →
 * ① DTMF：bytes→base64 喂 dtmfDecode（复用具名导出，零重造）→ 按键串
 * ② SSTV：parseWavPcm 拿 sig → goertzel 扫 1200Hz 同步脉冲 + VIS 码 → 模式标注
 * ③ LSB：readPcmSamples 拿 PCM → 每样本取低 N 位拼比特流 → bytes → 文本/hex
 *
 * 限制：
 * - 仅 WAV (RIFF/WAVE) 像素级支持。MP3/FLAC/OGG 无自包含 PCM 解码器
 * 返回 info 提示（"转 WAV 后可分析"），不硬编不调外部库。
 * - RIFF 非 WAVE（AVI/WebP）不算音频，返回 null（交给其他分析）。
 * - SSTV 仅识别标注模式，不解调图像（与 audiostego sstvIdent 一致）。
 */

import { dtmfDecode, parseWavPcm, goertzel as goertzelDtmf, ROW, COL } from "./dtmfWav.js";
import { parseWav, readPcmSamples, goertzel } from "./audiostego.js";

// flag 正则（照 section schema 契约，与 imageAnalysis.js 一致）
const FLAG_RE = /(flag|ctf|key)\{[^}]+\}/i;

// ---- bytes → base64（浏览器 + node 通用，照 dtmfWav.js 实现）----
function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return (typeof btoa !== "undefined") ? btoa(bin) : Buffer.from(bytes).toString("base64");
}

// ---- WAV 头快速判定（magic + WAVE 标识）----
function isWav(bytes) {
  return bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x41 && bytes[10] === 0x56 && bytes[11] === 0x45;   // WAVE
}
// MP3 (ID3 或 MPEG 帧头 0xFF Ex)
function isMp3(bytes) {
  if (bytes.length < 3) return false;
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return true; // ID3
  return bytes[0] === 0xFF && (bytes[1] & 0xE0) === 0xE0; // MPEG 帧头
}
// FLAC (fLaC)
function isFlac(bytes) {
  return bytes.length >= 4 &&
    bytes[0] === 0x66 && bytes[1] === 0x4C && bytes[2] === 0x61 && bytes[3] === 0x43; // fLaC
}
// OGG (OggS)
function isOgg(bytes) {
  return bytes.length >= 4 &&
    bytes[0] === 0x4F && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53; // OggS
}

// ============================================================
// ① DTMF 识别（复用 dtmfWav.js dtmfDecode，零重造）
// ============================================================
function detectDtmf(bytes) {
  try {
    const seq = dtmfDecode(bytesToBase64(bytes), { threshold: 0.15 });
    if (seq && seq.length) return { seq };
  } catch { /* 非 DTMF 或解析失败，静默 */ }
  return null;
}

// ============================================================
// ② SSTV 模式识别（照 audiostego.js sstvIdentRun 算法自建，未导出）
// ============================================================
// 常见 SSTV VIS 码 → 模式名（照 audiostego.js SSTV_VIS 表）
const SSTV_VIS = {
  0: "Robot 12 (BW)", 8: "Robot 24 (BW)", 40: "Robot 72 (color)", 44: "Robot 36 (color)",
  60: "Scottie 1", 56: "Scottie 2", 76: "Scottie DX", 36: "Martin 2", 32: "Martin 1",
  93: "PD 50", 95: "PD 90", 99: "PD 120", 113: "PD 160", 96: "PD 180", 98: "PD 240", 111: "PD 290",
};

// 在信号窗内测各候选频率能量，返回最强频率与其相对主导度（照 audiostego dominantFreq）
function dominantFreq(buf, start, N, sr, freqs) {
  let best = -1, bestE = -1;
  const es = freqs.map((fr) => goertzel(buf, start, N, fr, sr));
  for (let i = 0; i < es.length; i++) if (es[i] > bestE) { bestE = es[i]; best = i; }
  const sum = es.reduce((a, b) => a + b, 0) || 1;
  return { idx: best, freq: freqs[best], dom: bestE / sum, energy: bestE };
}

function detectSstv(bytes) {
  let parsed;
  try {
    parsed = parseWavPcm(bytes); // dtmfWav.js，直接拿归一化 Float64Array sig
  } catch { return null; }
  if (!parsed || !parsed.sig || parsed.sampleRate <= 0) return null;
  const sig = parsed.sig;
  const sr = parsed.sampleRate;
  const N = sig.length;

  const win = Math.max(64, Math.round(sr * 0.010)); // 10ms 分析窗
  const hop = Math.max(1, Math.floor(win / 2));
  const CAND = [1100, 1200, 1300, 1900];
  let syncRun = 0, syncStart = 0, firstSyncAt = -1;
  const needSyncWins = Math.max(3, Math.floor(0.150 / (hop / sr))); // ~150ms 连续判定
  for (let start = 0; start + win <= N; start += hop) {
    const d = dominantFreq(sig, start, win, sr, CAND);
    const is1200 = d.freq === 1200 && d.dom > 0.4;
    if (is1200) {
      if (syncRun === 0) syncStart = start;
      syncRun++;
      if (syncRun >= needSyncWins && firstSyncAt < 0) firstSyncAt = syncStart;
    } else {
      syncRun = 0;
    }
  }
  if (firstSyncAt < 0) return null; // 无同步脉冲，非 SSTV

 // 定位同步脉冲结束处，再读 VIS 码（30ms/bit，1100=1/1300=0，LSB-first，7 数据位）
  let visSearch = firstSyncAt;
  {
    let s = firstSyncAt;
    while (s + win <= N) {
      const d = dominantFreq(sig, s, win, sr, CAND);
      if (!(d.freq === 1200 && d.dom > 0.4)) break;
      s += hop;
    }
    visSearch = s;
  }
  const bitDur = Math.round(sr * 0.030);
  if (visSearch + bitDur * 9 > N) return { syncAt: firstSyncAt, vis: null };
  let pos = visSearch;
  const startBit = dominantFreq(sig, pos, Math.min(bitDur, N - pos), sr, [1100, 1200, 1300]);
  if (startBit.freq !== 1200) return { syncAt: firstSyncAt, vis: null };
  pos += bitDur;
  let vis = 0, ok = true;
  const visBits = [];
  for (let b = 0; b < 7; b++) {
    if (pos + bitDur > N) { ok = false; break; }
    const d = dominantFreq(sig, pos, bitDur, sr, [1100, 1300]);
    const bit = d.freq === 1100 ? 1 : 0;
    visBits.push(bit);
    vis |= (bit << b);
    pos += bitDur;
  }
  if (!ok) return { syncAt: firstSyncAt, vis: null };
  return { syncAt: firstSyncAt, vis, visBits, mode: SSTV_VIS[vis] || null };
}

// ============================================================
// ③ 音频 LSB 提取（照 audiostego.js audioLsbRun 算法自建，未导出）
// ============================================================
function bitsToBytes(bits) {
  const out = new Uint8Array(bits.length >> 3);
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let v = 0;
    for (let k = 0; k < 8; k++) v = (v << 1) | (bits[i + k] & 1);
    out[i >> 3] = v;
  }
  return out;
}

function tryDecodeText(bytes) {
  if (bytes.length === 0) return null;
 // 剥离尾部 0x00 填充（CTF LSB 隐写常被 0x00 对齐到样本边界）
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  if (end === 0) return null;
  const trimmed = end < bytes.length ? bytes.subarray(0, end) : bytes;
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(trimmed);
    let ctrl = 0;
    for (const ch of s) {
      const c = ch.codePointAt(0);
      if (c < 0x20 && c !== 0x0A && c !== 0x0D && c !== 0x09) ctrl++;
    }
    if (s.length > 0 && ctrl / s.length < 0.15) return s;
  } catch { /* 非 UTF-8 */ }
  return null;
}

function bytesToHex(bytes, max = 4096) {
  let s = "";
  const n = Math.min(bytes.length, max);
  for (let i = 0; i < n; i++) s += bytes[i].toString(16).padStart(2, "0");
  if (bytes.length > max) s += "…";
  return s;
}

// UTF-8 字符串 → 字节数组（download action 用）
function utf8Bytes(str) {
  return Array.from(new TextEncoder().encode(str));
}

// 默认 LSB 提取（每样本 1 位，全部声道，上限 8192 字节）
function extractAudioLsb(bytes) {
  const w = parseWav(bytes);
  if (!w.ok || !w.data || !w.fmt) return null;
  const f = w.fmt;
  if (![8, 16, 24, 32].includes(f.bitsPerSample)) return null;
 // 仅 PCM 整数有意义（浮点 LSB 无隐写含义）
  if (f.formatTag !== 0x0001 && !(f.formatTag === 0xFFFE && f.subFormat === 0x0001)) return null;

  let pcm;
  try {
    pcm = readPcmSamples(bytes, f, w.data.offset, w.data.actual);
  } catch { return null; }

  const nBits = 1;       // 每样本低 1 位
  const maxBytes = 8192;  // 上限 8KB（够 CTF 隐写）
  const mask = (1 << nBits) - 1;
  const bitCap = maxBytes * 8;
  const bits = [];
  outer:
  for (let fr = 0; fr < pcm.frames; fr++) {
    for (let c = 0; c < pcm.channels.length; c++) {
      const v = pcm.channels[c][fr] & mask;
      for (let b = nBits - 1; b >= 0; b--) {
        bits.push((v >> b) & 1);
        if (bits.length >= bitCap) break outer;
      }
    }
  }
  if (bits.length < 8) return null; // 不足 1 字节，无隐写
  const outBytes = bitsToBytes(bits);
  const text = tryDecodeText(outBytes);
  return { bytes: outBytes, text, bits: bits.length };
}

// ============================================================
// 主入口：analyzeAudio(bytes, name, detected)
// bytes: Uint8Array / number[]
// name: 文件名（download filename 用）
// detected: 可选，fileAnalysis 的 detected 对象({ext,mime}) 或 null
// 返回 { sections:[...] } | null（null = 非音频，调用方应忽略）
// ============================================================
export function analyzeAudio(bytes, name = "", detected) {
  if (!bytes || bytes.length === 0) return null;
  const u8a = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

 // 非音频 → null（交给其他分析）
  const isW = isWav(u8a);
  const isM = isMp3(u8a);
  const isF = isFlac(u8a);
  const isO = isOgg(u8a);
  if (!isW && !isM && !isF && !isO) return null;

 // ---- 非 WAV：无自包含 PCM 解码器，仅标注格式 + 提示 ----
  if (!isW) {
    let fmt = "MP3", hint = "MP3 无自包含 PCM 解码器";
    if (isF) { fmt = "FLAC"; hint = "FLAC 无自包含 PCM 解码器"; }
    else if (isO) { fmt = "OGG"; hint = "OGG 容器无自包含 PCM 解码器"; }
    return {
      sections: [{
        id: "audio-format",
        title: "音频分析",
        level: "info",
        icon: "graphic_eq",
        body: fmt + " 音频已识别。\n" + hint + "，DTMF/SSTV/LSB 分析需 WAV PCM。\n提示: 转为 WAV（16 位 PCM）后拖入可继续分析。",
      }],
    };
  }

 // ---- WAV 分支：跑 DTMF / SSTV / LSB ----
  const sections = [];

 // WAV 结构信息
  const w = parseWav(u8a);
  let wavInfoLine = "WAV (RIFF/WAVE)";
  if (w.ok && w.fmt) {
    const f = w.fmt;
    const dur = (f.sampleRate > 0 && w.data) ? (Math.floor(w.data.actual / (f.channels * (f.bitsPerSample >> 3))) / f.sampleRate) : 0;
    const durStr = dur > 0 ? (dur.toFixed(3) + "s") : "?";
    wavInfoLine = "WAV: " + f.sampleRate + " Hz / " + f.bitsPerSample + " bit / " + f.channels + " ch / " + durStr;
  }

 // ① DTMF 识别
  const dtmf = detectDtmf(u8a);
  if (dtmf && dtmf.seq) {
    const seq = dtmf.seq;
    const hasFlag = FLAG_RE.test(seq);
    sections.push({
      id: "audio-dtmf",
      title: "DTMF 拨号识别",
      level: hasFlag ? "alert" : "info",
      icon: "dialpad",
      body: wavInfoLine + "\n检出 DTMF 双音多频信号，按键序列:\n" + seq + "\n（连写: " + seq + "）",
      actions: seq.length > 0 ? [{ type: "view", label: "双击查看", text: seq }] : [],
    });
    if (hasFlag) {
      const m = seq.match(FLAG_RE);
      sections.push({
        id: "audio-dtmf-flag",
        title: "flag",
        level: "alert",
        icon: "emergency",
        body: "DTMF 序列含 flag:\n" + m[0],
      });
    }
  }

 // ② SSTV 模式识别
  const sstv = detectSstv(u8a);
  if (sstv && sstv.syncAt >= 0) {
    const lines = [wavInfoLine];
    lines.push("检出 1200Hz 起始同步脉冲 @ ~" + (sstv.syncAt / (parseWavPcm(u8a).sampleRate || 8000)).toFixed(3) + "s");
    if (sstv.vis != null) {
      lines.push("VIS 码: " + sstv.vis + " (0x" + sstv.vis.toString(16) + ")");
      lines.push("识别模式: " + (sstv.mode || "未知（VIS " + sstv.vis + " 不在常见模式表内）"));
      lines.push("注: 仅识别标注，未解调图像");
    } else {
      lines.push("VIS 码解析不足，疑似 SSTV 信号，无法确定具体模式");
    }
    sections.push({
      id: "audio-sstv",
      title: "SSTV 模式识别",
      level: "info",
      icon: "tv",
      body: lines.join("\n"),
    });
  }

 // ③ 音频 LSB 提取
  const lsb = extractAudioLsb(u8a);
  if (lsb) {
    const hasFlag = lsb.text ? FLAG_RE.test(lsb.text) : false;
    const lines = [wavInfoLine];
    lines.push("从 PCM 样本最低位提取隐写比特流:");
    lines.push("提取比特: " + lsb.bits + " bit → " + lsb.bytes.length + " 字节");
    if (lsb.text) {
      lines.push("--- 解码文本 (UTF-8) ---");
      lines.push(lsb.text);
    } else {
      lines.push("--- 提取字节 (hex, 前 256 字节) ---");
      lines.push(bytesToHex(lsb.bytes, 256));
      lines.push("提示: 非可读 UTF-8，可能为二进制隐写");
    }
    const actions = [];
    if (lsb.text) {
      actions.push({ type: "view", label: "双击查看", text: lsb.text });
    }
 // 二进制/长文本提供 download
    const base = (name || "audio").replace(/\.[^.]+$/, "") || "audio";
    actions.push({
      type: "download",
      label: "下载 bin",
      filename: base + "_lsb.bin",
      mime: "application/octet-stream",
      bytes: Array.from(lsb.bytes),
    });
    sections.push({
      id: "audio-lsb",
      title: "音频 LSB 隐写",
      level: hasFlag ? "alert" : "info",
      icon: "visibility_off",
      body: lines.join("\n"),
      actions,
    });
    if (hasFlag) {
      const m = lsb.text.match(FLAG_RE);
      sections.push({
        id: "audio-lsb-flag",
        title: "flag",
        level: "alert",
        icon: "emergency",
        body: "LSB 隐写含 flag:\n" + m[0],
      });
    }
  }

 // 无任何发现：给一个 info（避免空 sections）
  if (sections.length === 0) {
    sections.push({
      id: "audio-none",
      title: "音频分析",
      level: "info",
      icon: "graphic_eq",
      body: wavInfoLine + "\n未检出 DTMF / SSTV / LSB 隐写特征。\n提示: LSB 默认每样本 1 位、全部声道；DTMF 阈值 0.15。可在「音频 LSB 提取」op 手动调参重试。",
    });
  }

  return { sections };
}

export default { analyzeAudio };
