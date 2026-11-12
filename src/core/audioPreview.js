/*
 * audioPreview.js — 「音频仅分析前 N 分钟」设置的单一存储源。
 *
 * 纯逻辑、零 DOM：decodeStrength 弹窗负责编辑，main.js 的文件分析在拖入音频时读取。
 * 0 = 全量（默认）；仅作用于 WAV PCM 分析，不影响图片/归档/文本。
 */
export const FILE_AUDIO_PREVIEW_KEY = "ebctf_file_audio_preview_minutes";
export const FILE_AUDIO_PREVIEW_DEFAULT = 0;

export function normalizeAudioPreviewMinutes(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : FILE_AUDIO_PREVIEW_DEFAULT;
}

export function readFileAudioPreviewMinutes() {
  try {
    const raw = localStorage.getItem(FILE_AUDIO_PREVIEW_KEY);
    if (raw == null || raw === "") return FILE_AUDIO_PREVIEW_DEFAULT;
    return normalizeAudioPreviewMinutes(raw);
  } catch { return FILE_AUDIO_PREVIEW_DEFAULT; }
}

export function saveFileAudioPreviewMinutes(value) {
  const n = normalizeAudioPreviewMinutes(value);
  try { localStorage.setItem(FILE_AUDIO_PREVIEW_KEY, String(n)); } catch { /* 隐私模式只保留会话态 */ }
  return n;
}

export function fmtAudioPreviewMinutes(value) {
  return Number.isFinite(value) ? String(+value.toFixed(3)) : "?";
}
