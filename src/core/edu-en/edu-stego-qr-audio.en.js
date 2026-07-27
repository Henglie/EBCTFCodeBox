// English edu shard: stego QR/barcode + audio family. Pure data, no imports, no side effects.
export default {
  qrGen: {
    what: "QR code generation: encodes text into a QR code's 0/1 matrix. Core is a pure-JS implementation, outputting matrix JSON so you can inspect the structure or re-decode it.",
    principle:
      "QR first encodes the data into a bit stream by mode (numeric/alphanumeric/byte), adds Reed-Solomon error-correction codes for the chosen error level (L/M/Q/H), fills them into the matrix in a zigzag, and finally overlays a mask to even out the black/white distribution. The three corner blocks are the finder patterns.",
    usage: "Input text, choose the mode and error level, output a 0/1 matrix JSON (1=black module, 0=white). Can be fed to qrDecode for verification.",
    examples: [
      { in: "HELLO", param: "error level=M", out: "0/1 matrix JSON", desc: "1 is a black cell, 0 is a white cell" },
    ],
    tips: ["Higher error level (H) tolerates more damage but grows the matrix. In CTF, a broken QR is often rescued via a high error level."],
    aka: ["qr生成", "qr code", "二维码生成", "qr encode", "二维码编码", "qr码生成", "quick response code", "qrcode生成", "生成二维码", "qr矩阵生成", "reed-solomon二维码"],
  },

  qrParse: {
    what: "QR structure parse: doesn't decode the content, first checks this QR's 'health report' — which version, which mask, which error level, whether the finder patterns are correct.",
    principle:
      "A QR matrix has regions with fixed meaning: the three corner finder patterns, timing lines, format info (stores error level + mask number), and version info (version ≥7). Reading these structural bits tells you whether the matrix is well-formed and what its parameters are, without actually decoding the data.",
    usage: "Paste a QR matrix (ASCII art or 0/1 rows), output the version, mask, error level, and finder/dark-module validation results.",
    examples: [
      { in: "0/1 matrix or ASCII art", out: "version=2, mask=3, error level=M, finder OK" },
    ],
    tips: ["If it won't decode, run a health check first: a missing finder corner or wrong dark module means the matrix was copied wrong or cropped — fix the structure before qrDecode."],
    aka: ["qr解析", "qr结构", "qr parse", "二维码结构", "qr结构分析", "qr code structure", "二维码解析", "qr version掩码", "qr体检", "qr format info", "qr矩阵解析"],
  },

  barcodeIdentify: {
    what: "Barcode type determination: given a piece of barcode data, decides whether it's a 2D code (QR/Aztec/DataMatrix) or a 1D product code (EAN/UPC/ISBN/Code39, etc.), and validates the check digit along the way.",
    principle:
      "2D codes are distinguished by matrix structural features (finder pattern shape); 1D codes are distinguished by digit count and check rules — EAN-13/UPC-A have a mod-10 check digit, ISBN has mod-11/mod-10 checks, Code39/Codabar have fixed start/stop characters. The tool combines length, character set, and checks to determine the type.",
    usage: "Paste barcode data (matrix or digit string), output the most likely barcode type + check result.",
    examples: [
      { in: "6901234567892", out: "EAN-13, check digit passed" },
      { in: "0/1 large matrix", out: "likely QR (has three finders)" },
    ],
    tips: ["When unsure which code it is, triage with this first, then pick qrDecode or the corresponding 1D check tool."],
    aka: ["条码识别", "barcode identify", "条形码类型", "条码类型判定", "barcode type", "一维码识别", "ean upc识别", "条码分诊", "barcode detect", "条形码识别", "1d 2d码判定"],
  },

  qrDecode: {
    what: "QR code decode: reverse-decodes the original text hidden in a QR from a 0/1 matrix. Runs the full pipeline: finder detection → read format info → zigzag extraction → unmask → RS error correction → restore by mode.",
    principle:
      "Decoding is the reverse of encoding: first use the finder patterns to determine orientation and grid, read the format info to get the mask number and error level, extract bits in zigzag from bottom-right upward, XOR out the mask, use Reed-Solomon error correction to repair erroneous bits, and finally restore text by segment mode (numeric/alphanumeric/byte).",
    usage: "Paste a QR's 0/1 matrix and the tool reverse-decodes the original text. Minor matrix damage can still be rescued by RS error correction.",
    examples: [
      { in: "complete 0/1 matrix", out: "flag{...}", desc: "Includes error correction, tolerates some wrong cells" },
    ],
    tips: ["Wrong matrix orientation or inverted black/white causes decode failure; run qrParse for a health check first. Error correction can fix a limited number of wrong blocks; too much damage still fails."],
    aka: ["qr解码", "qr decode", "二维码解码", "扫码", "qr码解码", "qr code decode", "二维码识别", "qr矩阵解码", "reed-solomon纠错解码", "scan qr", "qr reader", "二维码还原"],
  },

  qrDecodeReport: {
    what: "QR decode diagnostics: the 'with commentary' version of qrDecode, listing version, error level, mask, finder, how many blocks RS error correction fixed, how many segments, and each segment's mode — used to pinpoint where it gets stuck when decoding fails.",
    principle:
      "Prints intermediate state at every step of the full decode pipeline: detected version/ECL/mask, finder detection results, the number of error symbols RS correction fixed, and the data segments' modes and contents. Any anomalous step is obvious at a glance.",
    usage: "Paste a QR matrix (qrGen's JSON or ASCII art), output a step-by-step diagnostic report + the final original text.",
    examples: [
      { in: "QR matrix", out: "version2/ECL=M/mask3/RS-corrected 2 blocks/byte mode/original text" },
    ],
    tips: ["When plain qrDecode fails, switch to this to see whether it's the finder not recognized, a wrong mask, or error correction exceeded."],
    aka: ["qr诊断", "qr decode report", "qr解码报告"],
  },

  wavHeader: {
    what: "WAV header parse: opens up the RIFF/WAVE structure of a WAV audio file, reading out sample rate, bit depth, channel count, and duration — the first step for audio steganography challenges.",
    principle:
      "WAV is a RIFF container: it starts with `RIFF....WAVE`, followed by several chunks. The `fmt ` chunk records the format code/channel count/sample rate/bit depth, and the `data` chunk is the PCM samples themselves. Walking the chunks reads all parameters; data chunk size ÷ (sample rate × channels × bit depth/8) gives the duration.",
    usage: "Paste WAV data (hex/base64/UTF-8 auto-detected), output each chunk + fmt parameters + duration.",
    examples: [
      { in: "WAV file bytes", out: "sample rate 44100, 16-bit, stereo, 3.2s" },
    ],
    tips: ["For audio challenges, check the header first: sample rate/bit depth determine how audioLsb extracts bits. Anomalous extra chunks may hide data."],
    aka: ["wav头", "wav header", "riff解析", "wave结构", "wav头解析", "wav文件头", "riff wave", "音频头解析", "wav format chunk", "pcm头解析", "wave file header"],
  },

  audioLsb: {
    what: "Audio LSB extraction: same idea as image LSB — the secret is hidden in the lowest bit of each PCM sample value of a WAV, dug out sample by sample and assembled into a hidden bit stream.",
    principle:
      "PCM samples are integers (8/16/24/32-bit). Changing a sample's lowest bit shifts the volume imperceptibly to the human ear, yet stuffs 1 bit per sample. To extract, read each sample by bit depth, take the lowest bit (or several), assemble a bit stream, then restore to text/hex 8 bits per byte.",
    usage: "Input a WAV, choose bit depth, channels, and how many bits per sample, and the tool digs out the LSB bit stream and tries to restore text/hex.",
    examples: [
      { in: "WAV PCM", param: "16-bit/left channel/1 bit per sample", out: "hidden flag{...}" },
    ],
    tips: ["Confirm bit depth and channels with wavHeader first, then extract bits. Wrong bit count/channel choice yields garbage — try several combinations."],
    aka: ["音频lsb", "audio lsb", "wav隐写", "音频隐写", "音频最低位隐写", "audio steganography", "pcm lsb", "wav lsb提取", "音频最低有效位", "audio lsb extract", "声音隐写"],
  },

  dtmfDecode: {
    what: "DTMF dual-tone multi-frequency extraction: those 'beep-beep' telephone dialing key tones, each key being two specific frequencies superimposed, detected from a WAV and restored to a key sequence.",
    principle:
      "DTMF arranges 12/16 keys in a 4-row × 4-column grid, each key = one row frequency + one column frequency (8 standard frequencies total) superimposed. The Goertzel algorithm (an efficient DFT measuring only these 8 frequencies' energy) detects in a sliding window which two frequencies have the strongest energy, and a lookup table gives the corresponding key.",
    usage: "Input a WAV PCM containing dial tones, and the tool runs sliding-window Goertzel detection, outputting the key sequence (0-9 A-D * #).",
    examples: [
      { in: "WAV with dial tones", out: "key sequence like 1234#" },
    ],
    formulas: [
      { tex: "\\text{key} = (\\text{row freq},\\ \\text{col freq}) \\to \\{697/770/852/941\\} \\times \\{1209/1336/1477/1633\\}", caption: "Row freq × column freq locates the key" },
    ],
    tips: ["Audio that sounds like phone dialing/key tones → try DTMF. The decoded digit string may be a password or coordinates."],
    aka: ["dtmf", "双音多频", "拨号音解码", "goertzel"],
  },

  sstvIdent: {
    what: "SSTV mode identification: amateur radio transmits images via sound (slow-scan television); first identify which SSTV mode the audio uses, paving the way for later demodulation.",
    principle:
      "Before encoding an image into audio, SSTV sends a 1200Hz leader sync pulse + a VIS code (a series of tones identifying the mode). Detecting this header determines which of Robot/Scottie/Martin/PD modes it is. This tool only identifies and labels; it does not demodulate the image.",
    usage: "Input SSTV audio, and the tool detects the sync pulse + VIS code and labels the likely SSTV mode.",
    examples: [
      { in: "SSTV audio", out: "VIS code detected → likely Scottie S1 mode" },
    ],
    tips: ["An audio spectrum that looks like a line-by-line scanned image + a sync tone at the start → SSTV. To actually produce the image, demodulate with dedicated software like RX-SSTV/QSSTV."],
    aka: ["sstv", "慢扫描电视", "sstv识别", "vis码", "slow scan television", "sstv模式识别", "sstv mode", "无线电传图", "vis code", "scottie martin robot", "业余无线电图像"],
  },
};
