/*
 * edu-batch5-stego.js — 隐写/取证 op 科普补全。
 *
 * 纯数据 export default { [opId]: EduEntry }，无 import、无副作用、无 register（机制四低耦合）。
 * EduEntry 契约见 eduContent.js 头注释：what/principle/usage/examples/formulas/tips/aka。
 *
 * 覆盖范围（经 rt_t170_diff.mjs 差集核查）:
 * registry cat=stego(43)/analysis(71) 共 114 op，已有科普 112 个（覆盖率 98.2%）
 * 本文件补齐 stego op 缺口：dtmfWav（DTMF 拨号音 WAV）。exeBridge 卡随 CLI 桥退役删除（2026-09-13 桥大清除）。
 *
 * examples 取值:
 * - dtmfWav: 由 src/core/dtmfWav.js 的 dtmfEncode/dtmfDecode 实跑取值。
 * - exeBridge: 需本地 bridge.py + Windows exe，无法纯前端实跑，examples 为说明性描述 + 标注「需 bridge.py」。
 */
export default {
 // ============================================================
 // DTMF 拨号音 WAV
 // ============================================================
  dtmfWav: {
    what: "把电话拨号按键序列编码成 DTMF 双音多频 WAV 音频——每个按键对应两个频率叠加的正弦波，解码端用 Goertzel 算法检出频率还原按键。CTF 音频隐写题的常客。",
    principle:
      "DTMF（Dual-Tone Multi-Frequency）用 4×4 矩阵的 8 个频率编码 16 个按键。行频 697/770/852/941 Hz，列频 1209/1336/1477/1633 Hz，每个按键 = 一个行频 + 一个列频同时叠加。\n\n**encode**：按键序列（0-9 / A-D / * / #）逐个转成 (行频, 列频) 对，生成 toneMs 毫秒的双正弦 PCM 样本（两路正弦相加），键间插 gapMs 毫秒静音，拼成 16 位单声道 PCM，加 WAV 头（RIFF/WAVE/fmt /data），输出 base64。\n\n**decode**：解析 WAV 头取 PCM 数据，按 toneMs 分帧，对每帧用 Goertzel 算法计算 8 个基频的能量，行频+列频能量都超阈值（相对峰值 × threshold）的那个按键即识别结果，静音帧跳过。",
    usage:
      "encode：输入框填按键序列（如 `911`），参数 toneMs/gapMs/amp 调音色（默认 200ms/100ms/0.35）。decode：输入 WAV 的 base64 或 hex，threshold 调检测灵敏度（默认 0.15，噪声大时调高）。WAV 必须是 16 位单声道 PCM 格式。",
    examples: [
      { in: "123", param: "toneMs=100, gapMs=50, amp=0.35", out: "WAV base64 长度 9660，开头 UklGRkQcAABXQVZFZm10...（RIFF WAV 头）", desc: "3 键 ×(100+50)ms = 450ms 音频，decode 还原 → 123" },
      { in: "123", param: "默认（toneMs=200, gapMs=100）", out: "WAV base64 长度 19260", desc: "默认时长更长，base64 更大；decode 同样还原 123" },
      { in: "*#", param: "toneMs=100, gapMs=50", out: "WAV base64 长度 6460", desc: "特殊键 * 和 # 同样支持，decode → *#" },
    ],
    formulas: [
      { tex: "\\text{sample}_t = \\text{amp}\\cdot(\\sin(2\\pi f_{\\text{row}} t)+\\sin(2\\pi f_{\\text{col}} t))", caption: "每键 PCM 样本 = 行频正弦 + 列频正弦叠加" },
      { tex: "P(f) = \\sum_{n=0}^{N-1} x_n \\cdot e^{-j2\\pi f n/N}", caption: "Goertzel 算法算单频能量（比 FFT 轻量，只算 8 个目标频率）" },
    ],
    tips: [
      "DTMF 是电话拨号音的标准，CTF 给个 WAV 文件让你解出电话号码 / 密码是最常见玩法——本工具 decode 直接出按键序列。",
      "threshold 默认 0.15：识别不出时调低（0.05）更灵敏但易误报；噪声大时调高（0.3）更稳。",
      "WAV 必须是无损 16 位 PCM 单声道——MP3/AAC 有损压缩会破坏频率，需先转 WAV。",
      "与 audioAnalysis（文件分析音频检测）不同：本 op 是「主动编/解 DTMF WAV」，audioAnalysis 是「拖入音频自动检测是否含 DTMF/SSTV/LSB」。",
      "A-D 键是 DTMF 第 4 列（1633 Hz），电话机上很少用，但 CTF 可能拿来做 16 进制编码。",
    ],
    aka: ["DTMF", "双音多频", "拨号音", "Touch-Tone", "DTMF WAV", "Goertzel", "dtmf2num", "双音多频信号", "电话拨号音", "按键音", "触摸音", "DTMF解码", "拨号音识别"],
  },

 // ============================================================
 // 本地桥·外部 exe
 // ============================================================

};
