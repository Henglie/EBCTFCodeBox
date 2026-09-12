// English edu shard: steganography/forensics op fill-ins.
// Covers dtmfWav (DTMF dial-tone WAV). exeBridge card removed with the CLI bridge retirement (2026-09-13).
export default {
 // ============================================================
 // DTMF dial-tone WAV
 // ============================================================
  dtmfWav: {
    what: "Encode a phone keypad sequence into a DTMF (dual-tone multi-frequency) WAV: each key maps to two superimposed sine waves, and the decoder uses the Goertzel algorithm to detect the frequencies and recover the keys. A regular in CTF audio steganography challenges.",
    principle:
      "DTMF (Dual-Tone Multi-Frequency) encodes 16 keys with 8 frequencies in a 4×4 matrix. Row frequencies 697/770/852/941 Hz, column frequencies 1209/1336/1477/1633 Hz; each key = one row frequency + one column frequency superimposed.\n\n**encode**: each key in the sequence (0-9 / A-D / * / #) is turned into a (row freq, column freq) pair, generating toneMs milliseconds of dual-sine PCM samples (two sines summed), with gapMs milliseconds of silence between keys, assembled into 16-bit mono PCM with a WAV header (RIFF/WAVE/fmt /data) added, output as base64.\n\n**decode**: parse the WAV header for the PCM data, split into frames by toneMs, use the Goertzel algorithm on each frame to compute the energy of the 8 base frequencies; the key whose row-freq and column-freq energies both exceed the threshold (relative peak × threshold) is the recognized result, with silent frames skipped.",
    usage:
      "encode: enter the key sequence (e.g. `911`) in the input box; parameters toneMs/gapMs/amp tune the timbre (defaults 200ms/100ms/0.35). decode: input the WAV's base64 or hex; threshold tunes detection sensitivity (default 0.15, raise it when noise is high). The WAV must be 16-bit mono PCM format.",
    examples: [
      { in: "123", param: "toneMs=100, gapMs=50, amp=0.35", out: "WAV base64 of length 9660, starting with UklGRkQcAABXQVZFZm10... (RIFF WAV header)", desc: "3 keys ×(100+50)ms = 450ms of audio; decode recovers → 123" },
      { in: "123", param: "default (toneMs=200, gapMs=100)", out: "WAV base64 of length 19260", desc: "The default is longer, so the base64 is bigger; decode still recovers 123" },
      { in: "*#", param: "toneMs=100, gapMs=50", out: "WAV base64 of length 6460", desc: "Special keys * and # are also supported; decode → *#" },
    ],
    formulas: [
      { tex: "\\text{sample}_t = \\text{amp}\\cdot(\\sin(2\\pi f_{\\text{row}} t)+\\sin(2\\pi f_{\\text{col}} t))", caption: "Per-key PCM sample = row-frequency sine + column-frequency sine superimposed" },
      { tex: "P(f) = \\sum_{n=0}^{N-1} x_n \\cdot e^{-j2\\pi f n/N}", caption: "The Goertzel algorithm computes single-frequency energy (lighter than FFT, only computing the 8 target frequencies)" },
    ],
    tips: [
      "DTMF is the standard for phone dial tones; the most common CTF play is being given a WAV file and asked to decode a phone number / password — this tool's decode outputs the key sequence directly.",
      "threshold defaults to 0.15: lower it (0.05) for more sensitivity but more false positives when nothing is recognized; raise it (0.3) for more stability when noise is high.",
      "The WAV must be lossless 16-bit PCM mono — MP3/AAC lossy compression destroys the frequencies, so convert to WAV first.",
      "Different from audioAnalysis (audio detection in file analysis): this op is 'actively encode/decode a DTMF WAV', while audioAnalysis is 'drop in audio and auto-detect whether it contains DTMF/SSTV/LSB'.",
      "The A-D keys are DTMF's 4th column (1633 Hz), rarely used on phones, but CTF might use them for hex encoding.",
    ],
    aka: ["DTMF", "双音多频", "拨号音", "Touch-Tone", "DTMF WAV", "Goertzel", "dtmf2num", "双音多频信号", "电话拨号音", "按键音", "触摸音", "DTMF解码", "拨号音识别"],
  },

 // ============================================================
 // local bridge · external exe
 // ============================================================

};
