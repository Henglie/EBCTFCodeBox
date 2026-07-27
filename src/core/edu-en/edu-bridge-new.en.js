/*
 * edu-bridge-new.en.js — English edu shard for the local-bridge / exe bridging ops (pure data, no side effects).
 *
 * Covers 15 bridging ops that "call a local exe / launch a local GUI". These ops are essentially wrappers around external tools:
 * - GUI type (*Launch): only call the bridge /api/launch to spin up a local exe; the user operates manually in the pop-up window.
 *   The toolbox does not feed input or fetch results on your behalf.
 * - CLI type (*Bridge / *Exe): call the bridge /api/run for unattended execution, with files passed in via {placeholder}.
 * Common prerequisites: Windows only, and you must first run python bridge.py locally (listening on localhost:8181).
 * When the bridge isn't running / it's not Windows, the op returns a friendly notice instead of throwing. Zero outbound traffic (connects to localhost only).
 *
 * This file only exports data; it's wired up by the master controller eduContent.js, with no import / register.
 */
export default {
 // ============================================================
 // GUI launchers (bridgeStego)
 // ============================================================
  watermarkhLaunch: {
    what: "A button that launches the local watermarkH image-watermark steganography tool (a 52pojie release).",
    principle:
      "watermarkH is a Chinese GUI steganography tool that hides text/images as a watermark inside a carrier image, or extracts watermarks from an image; " +
      "it circulates on the 52pojie (Kanxue/wuaipojie) forum and is common in CTF image-misc challenges.\n\n" +
      "This op does no image processing: it only spins up the local watermarkH.exe via the local bridge's /api/launch endpoint, " +
      "and the actual hide/extract operations all happen manually in the pop-up program window.",
    usage:
      "Windows only. First run python bridge.py locally (listening on localhost:8181), refresh this page, then click this feature to launch the watermarkH window. " +
      "This is a pure GUI launcher: the toolbox does not receive input or return results — do all steganography operations manually in the pop-up watermarkH window.",
    examples: [
      {
        in: "（no input, just click）",
        out: "● Launched local exe: watermarkH · watermark\nPath: ...\nPlease operate manually in the pop-up program window.",
        desc: "After clicking, the bridge spins up watermarkH.exe; everything else is done in the native window.",
      },
    ],
    tips: [
      "When you get a suspicious image, try it first to check for a hidden watermark — many Chinese misc challenges rely on it.",
      "If the bridge isn't running it returns \"local bridge not ready\"; first confirm python bridge.py is running and that you're on Windows.",
    ],
    aka: [
      "watermarkH", "watermark", "图像水印", "水印隐写", "吾爱破解", "52pojie",
      "图片隐写", "watermarkH.exe", "image watermark", "steganography", "misc 隐写",
    ],
  },

  jphswinLaunch: {
    what: "Launches the local JPHS for Windows (jphide/jpseek) to hide data in a JPEG or extract it.",
    principle:
      "JPHS = JP Hide and Seek, written by Allan Latham. jphide embeds data into a JPEG's DCT coefficients, " +
      "jpseek extracts it in reverse; both are the classic password-protected JPEG steganography pair. JPHSwin is its Windows GUI version.\n\n" +
      "This op only calls the bridge's /api/launch to spin up JPHSwin.exe; you do the hide/extract by clicking in the window.",
    usage:
      "Windows only, requires python bridge.py running first. After clicking to launch the JPHSwin window, do Open jpeg → Hide/Seek in it, " +
      "entering the password manually. A pure GUI launcher — the toolbox doesn't feed input or fetch results on your behalf.",
    examples: [
      {
        in: "（no input, just click）",
        out: "● Launched local exe: JPHS · JPEG steganography\nPath: ...\nPlease operate manually in the pop-up window.",
        desc: "Spins up JPHSwin; do jphide/jpseek in the native window.",
      },
    ],
    tips: [
      "When stegdetect reports jphide(*), use JPHS's jpseek with the password to extract.",
      "jphide only eats JPEG; other formats won't work.",
    ],
    aka: [
      "JPHS", "JPHSwin", "jphide", "jpseek", "JP Hide and Seek", "JPEG 隐写",
      "DCT 隐写", "Allan Latham", "JPHS for Windows", "图像隐写", "jphide and seek", "misc",
    ],
  },

  openpuffLaunch: {
    what: "Launches the local OpenPuff multi-carrier steganography tool (image/audio/video/PDF/flash, etc.), with multi-layer passwords.",
    principle:
      "OpenPuff is Cosimo Oliboni's free professional-grade steganography tool that can scatter data across many carriers (BMP/JPG/PNG/MP3/WAV/" +
      "MP4/PDF/SWF, etc.), supporting three-layer passwords, deduplication, decoys, and other advanced features, with fairly strong anti-detection.\n\n" +
      "This op only calls the bridge's /api/launch to spin up OpenPuff.exe; do the hide/extract manually in the window.",
    usage:
      "Windows only, requires python bridge.py running first. After clicking to launch the OpenPuff window, do Hide/Unhide, pick carriers, and fill in the three-layer passwords manually. " +
      "A pure GUI launcher — the toolbox doesn't feed input or fetch results on your behalf.",
    examples: [
      {
        in: "（no input, just click）",
        out: "● Launched local exe: OpenPuff · multi-carrier\nPath: ...\nPlease operate manually in the pop-up window.",
        desc: "Spins up OpenPuff; multi-carrier steganography is done in the native window.",
      },
    ],
    tips: [
      "When a challenge gives multiple files of the same type + hints at multi-layer passwords, suspect OpenPuff first.",
      "All three password layers must be correct to extract, none can be missing; note the carrier order may also be part of the key.",
    ],
    aka: [
      "OpenPuff", "openpuff", "多载体隐写", "Cosimo Oliboni", "carrier chain",
      "多层密码", "steganography", "隐写", "decoy", "OpenPuff.exe", "professional steganography", "misc 隐写",
    ],
  },

  oursecretLaunch: {
    what: "Launches the local OurSecret GUI steganography tool (proprietary format, cannot be replicated purely in the frontend).",
    principle:
      "OurSecret (sometimes written Our Secret) is a GUI steganography tool that password-encrypts a file/text then hides it inside an image or sound file, " +
      "using a proprietary embedding format; in CTF, if a .ourse file is given or OurSecret is hinted, use it to extract.\n\n" +
      "This op only calls the bridge's /api/launch to spin up OurSecret.exe; do the hide/extract manually in the window.",
    usage:
      "Windows only, requires python bridge.py running first. After clicking to launch the OurSecret window, pick the carrier, enter the password, and do Hide/Unhide manually. " +
      "A pure GUI launcher — the toolbox doesn't feed input or fetch results on your behalf; because the format is proprietary it can't be replaced by other tools.",
    examples: [
      {
        in: "（no input, just click）",
        out: "● Launched local exe: OurSecret · steganography\nPath: ...\nPlease operate manually in the pop-up window.",
        desc: "Spins up OurSecret; do proprietary-format extraction in the native window.",
      },
    ],
    tips: [
      "When a challenge explicitly names OurSecret, or the carrier tests negative on every other steganography tool, try it.",
      "The password is often hidden in the challenge description / image exif / an attachment — try each one.",
    ],
    aka: [
      "OurSecret", "Our Secret", "oursecret", "私有格式隐写", "图片隐写", "音频隐写",
      "密码隐写", "steganography", "隐写工具", "OurSecret.exe", "hide data", "misc",
    ],
  },

 // ============================================================
 // CLI bridging (bridgeStego)
 // ============================================================
  steghideBridge: {
    what: "Calls the local steghide.exe to embed data into an image/audio, or extract data hidden inside.",
    principle:
      "steghide is a classic command-line steganography tool supporting JPEG/BMP/WAV/AU carriers, embedding data with a password and optional compression/checksum.\n\n" +
      "This op calls steghide.exe unattended via the local bridge's /api/run:\n" +
      "  the extract subcommand pulls data out of a carrier, the embed subcommand hides data into a carrier;\n" +
      "  the carrier file is passed to the bridge via the {cover} placeholder (you drop the file in to paste its base64, and the bridge writes it to a temp file then substitutes {cover}).",
    usage:
      "Windows only, requires python bridge.py running first. Drop in the carrier to get its base64 and fill the {cover} field; " +
      "the params default to extract -sf {cover}, and with a password write extract -sf {cover} -p password. " +
      "The result is returned as [exit code] + stdout/stderr. CLI type uses placeholder files, no manual window-opening.",
    examples: [
      {
        in: "params: extract -sf {cover} -p 123456   {cover}=base64 of a suspicious.jpg",
        out: "[exit 0]\nwrote extracted data to \"...\".",
        desc: "Extract hidden data from a JPEG with a password.",
      },
    ],
    tips: [
      "For an empty extract password, just press enter (leave -p blank or omit -p); on many challenges the password is empty.",
      "steghide only recognizes jpg/bmp/wav/au; it won't eat a png carrier, so don't waste time.",
      "The password is often written in the challenge text, image exif, or another attachment.",
    ],
    aka: [
      "steghide", "隐写工具", "steganography", "embed", "extract", "JPEG 隐写",
      "WAV 隐写", "命令行隐写", "steghide.exe", "-sf", "-p 密码", "图片隐写", "misc",
    ],
  },

  snowBridge: {
    what: "Calls the local snow.exe to hide data in text using end-of-line whitespace (spaces/tabs).",
    principle:
      "snow = Steganographic Nature Of Whitespace, written by Matthew Kwan. It encodes data as a combination of spaces and tabs appended to the end of each line " +
      "(invisible when printed/displayed), with optional ICE encryption. Because it only touches line-ending whitespace, the body text looks unchanged to the eye.\n\n" +
      "This op calls snow.exe via the bridge's /api/run, with the text file passed via the {in} placeholder.",
    usage:
      "Windows only, requires python bridge.py running first. Drop in the text file to get its base64 and fill {in}. " +
      "The default param -C {in} is extraction (-C means decompress/pull out content); to hide data write -p password -m \"message\" in.txt out.txt. " +
      "CLI type uses placeholder files.",
    examples: [
      {
        in: "params: -C {in}   {in}=base64 of a .txt with hidden trailing whitespace",
        out: "[exit 0]\n<the message hidden in the line-ending whitespace>",
        desc: "Restore the hidden message from the line-ending whitespace of the text.",
      },
    ],
    tips: [
      "When you get text that \"looks normal but has odd trailing spaces on each line\", try snow.",
      "With a password, the -p password must match the one used to hide, otherwise you get gibberish.",
      "Use cat -A or a hex view to glance at line endings and confirm whether there's suspicious whitespace.",
    ],
    aka: [
      "snow", "whitespace steganography", "空白隐写", "行尾空白", "空格 Tab 隐写",
      "Matthew Kwan", "SNOW", "文本隐写", "snow.exe", "ICE 加密", "whitespace", "misc",
    ],
  },

  jstegBridge: {
    what: "Calls the local jsteg.exe to read/write LSB steganography on a JPEG.",
    principle:
      "jsteg hides data in the least significant bits (LSB) of a JPEG's compressed DCT coefficients — one of the most classic JPEG LSB steganography implementations.\n\n" +
      "This op calls jsteg.exe via the bridge's /api/run: the reveal subcommand reads the hidden data out of a JPEG; " +
      "the JPEG file is passed to the bridge via the {jpg} placeholder.",
    usage:
      "Windows only, requires python bridge.py running first. Drop in the JPEG to get its base64 and fill {jpg}; the default param reveal {jpg} extracts. " +
      "CLI type uses placeholder files, and the result is returned as [exit code] + stdout.",
    examples: [
      {
        in: "params: reveal {jpg}   {jpg}=base64 of a suspicious JPEG",
        out: "[exit 0]\nflag{...}",
        desc: "Read the hidden data out of the JPEG's LSB.",
      },
    ],
    tips: [
      "When stegdetect reports jsteg(*), extract with jsteg reveal.",
      "Only works on JPEG; and it must be jsteg-hidden — other LSB schemes may not be readable.",
    ],
    aka: [
      "jsteg", "JPEG LSB", "LSB 隐写", "reveal", "DCT LSB", "JPEG 隐写",
      "最低有效位", "steganography", "jsteg.exe", "least significant bit", "图片隐写", "misc",
    ],
  },

  mp3stegoBridge: {
    what: "Calls the local MP3Stego's Decode to restore data hidden inside an MP3.",
    principle:
      "MP3Stego (Fabien Petitcolas) hides data in the quantization process during MP3 encoding's inner loop; Encode hides, Decode extracts, " +
      "both with a password. Because it's embedded in the compression process, normal playback/viewing shows no anomaly.\n\n" +
      "This op calls MP3Stego Decode via the bridge's /api/run, with the MP3 file passed via the {mp3} placeholder.",
    usage:
      "Windows only, requires python bridge.py running first. Drop in the MP3 to get its base64 and fill {mp3}; the default param -X {mp3} extracts " +
      "(-X means decode out the hidden data), and with a password write -X {mp3} -P password. CLI type uses placeholder files.",
    examples: [
      {
        in: "params: -X {mp3} -P mypass   {mp3}=base64 of a suspicious MP3",
        out: "[exit 0]\n（the restored hidden.txt content / extraction-complete message）",
        desc: "Restore hidden data from an MP3 with a password.",
      },
    ],
    tips: [
      "A challenge giving an mp3 + a password hint is almost certainly MP3Stego.",
      "The -P password must match the one used to hide, or extraction fails.",
      "MP3Stego only recognizes data it Encode-hid itself; an mp3 hidden by anything else won't work.",
    ],
    aka: [
      "MP3Stego", "mp3stego", "MP3 隐写", "Decode", "-X", "Fabien Petitcolas",
      "音频隐写", "steganography", "mp3 stego", "-P 密码", "compressed-domain", "misc",
    ],
  },

 // ============================================================
 // CLI bridging (bridgeForensic)
 // ============================================================
  stegdetectExe: {
    what: "Calls the local stegdetect.exe to detect which steganography a JPEG may be hiding (jsteg/jphide/outguess/invisible secrets, etc.).",
    principle:
      "stegdetect (Niels Provos) scans a JPEG with statistical features to judge whether it was steganographed by jsteg, jphide, outguess, " +
      "invisible secrets, etc., with a confidence level. It only detects, it doesn't extract.\n\n" +
      "This op calls stegdetect.exe via the bridge's /api/run: the JPEG goes via the {jpg} placeholder, -t specifies the detection algorithm, -s sets sensitivity.",
    usage:
      "Windows only, requires python bridge.py running first. Drop in the JPEG to get its base64 and fill {jpg}; the default param -t jopi {jpg} " +
      "(jopi = detect the four classes jsteg/outguess/jphide/invisible secrets), and to raise sensitivity write -s 3.0 {jpg}. CLI type uses placeholder files.",
    examples: [
      {
        in: "params: -t jopi {jpg}   {jpg}=base64 of a suspicious JPEG",
        out: "[exit 0]\nchall.jpg : jphide(***)",
        desc: "Reports that the JPEG is suspected to use jphide steganography; more asterisks means higher confidence.",
      },
    ],
    tips: [
      "Use it first to locate the algorithm, then decide whether to extract with jsteg reveal or JPHS's jpseek.",
      "A negative report doesn't mean nothing is hidden; try a higher -s sensitivity or a different tool.",
      "The -t letters: j=jsteg, o=outguess, p=jphide, i=invisible secrets.",
    ],
    aka: [
      "stegdetect", "JPEG 隐写检测", "Niels Provos", "jsteg", "jphide", "outguess",
      "invisible secrets", "-t jopi", "-s 灵敏度", "steganalysis", "stegdetect.exe", "隐写分析", "misc",
    ],
  },

  ntfsstreamsLaunch: {
    what: "Launches the local NTFS Alternate Data Stream (ADS) viewer/editor.",
    principle:
      "The NTFS file system lets a single file carry multiple \"alternate data streams\" (Alternate Data Stream, e.g. file.txt:hidden), " +
      "where the main content displays normally but the extra streams are invisible by default, often used to hide a flag or malicious data.\n\n" +
      "This op only calls the bridge's /api/launch to spin up the local ADS editor GUI; view/edit manually in the window.",
    usage:
      "Windows only, requires python bridge.py running first. After clicking to launch the ADS editor window, view/edit the data streams manually. " +
      "A pure GUI launcher — the toolbox doesn't feed input or fetch results on your behalf. (From the command line you can also use dir /r to list streams, type file:stream to read a stream.)",
    examples: [
      {
        in: "（no input, just click）",
        out: "● Launched local exe: NTFS data stream\nPath: ...\nPlease operate manually in the pop-up window.",
        desc: "Spins up the ADS editor; view the hidden data streams in the window.",
      },
    ],
    tips: [
      "When a challenge gives an NTFS partition image or explicitly says ADS, check whether each file has extra streams.",
      "Command-line quick check: dir /r to see streams with a : suffix, more < file.txt:secret.txt to read the content.",
      "ADS only exists on NTFS; copying to FAT/exFAT loses it.",
    ],
    aka: [
      "NTFS ADS", "Alternate Data Stream", "备用数据流", "ntfsstreams", "NTFS 数据流",
      "隐藏数据流", "dir /r", "文件流隐藏", "ADS", "NTFS", "data stream", "misc 取证",
    ],
  },

  foremostBridge: {
    what: "Calls the local foremost.exe to carve out embedded files from data by file header/footer signatures.",
    principle:
      "foremost is a classic file-carving tool that relies on the magic-number headers of known file formats (e.g. PNG's 89504E47, ZIP's 504B0304) and footer signatures " +
      "to scan any data stream and cut out complete files, often used to extract concatenated/hidden attachments from images/disk images.\n\n" +
      "This op calls foremost.exe via the bridge's /api/run: the file to carve goes via the {in} placeholder, -o specifies the output directory.",
    usage:
      "Windows only, requires python bridge.py running first. Drop in the file to get its base64 and fill {in}; the default param -i {in} -o out " +
      "(-i input, -o output directory). CLI type uses placeholder files, and the result lists the carved file types and counts.",
    examples: [
      {
        in: "params: -i {in} -o out   {in}=base64 of a png with a ZIP hidden inside",
        out: "[exit 0]\nProcessing: {in}\n|foundat=...|\n... zip: 1 ...",
        desc: "Carve the ZIP appended after a PNG out of the PNG.",
      },
    ],
    tips: [
      "When \"binwalk sees other files inside an image\", foremost cuts them out for you.",
      "The -o directory must not exist or be empty, otherwise foremost errors and refuses to write.",
      "Complements binwalk: foremost relies on magic numbers and can cover cases binwalk misses.",
    ],
    aka: [
      "foremost", "文件雕复", "file carving", "carve", "数据恢复", "魔数",
      "file signature", "magic number", "foremost.exe", "取证", "-i -o", "内嵌文件提取", "misc 取证",
    ],
  },

  bkcrackBridge: {
    what: "Calls the local bkcrack.exe to run a known-plaintext attack on a ZipCrypto-encrypted ZIP and recover its internal keys.",
    principle:
      "The traditional ZIP's ZipCrypto stream cipher has a known-plaintext attack (Biham-Kocher): as long as you know " +
      "at least 12 bytes of plaintext of some file in the archive (usually a few more bytes needed), bkcrack can recover the three internal 32-bit keys, then decrypt all entries, " +
      "even without the original password.\n\n" +
      "This op calls bkcrack.exe via the bridge's /api/run: the ZIP goes via the {zip} placeholder, -c specifies the target filename inside the archive, -p gives the plaintext.",
    usage:
      "Windows only, requires python bridge.py running first. Drop in the ZIP to get its base64 and fill {zip}; params look like" +
      " -C {zip} -c inner.txt -p plain.bin (-C encrypted archive, -c filename inside the archive, -p plaintext file). CLI type uses placeholder files.",
    examples: [
      {
        in: "params: -C {zip} -c flag.txt -p known.bin",
        out: "[exit 0]\nKeys: 12345678 9abcdef0 ...",
        desc: "Recover the three internal keys from known plaintext, then use -d to decrypt other files.",
      },
    ],
    tips: [
      "Only works on ZipCrypto (traditional ZIP encryption); AES-encrypted zips won't work.",
      "Plaintext sources: a known public file inside the archive, a fixed file header, or the same file leaked elsewhere.",
      "After getting Keys, use bkcrack -C {zip} -k keys -d out.zip to decrypt the archive.",
    ],
    aka: [
      "bkcrack", "ZipCrypto", "已知明文攻击", "known plaintext attack", "Biham-Kocher",
      "ZIP 破解", "zip crypto", "内部密钥", "bkcrack.exe", "-C -c -p", "plaintext attack", "misc crypto",
    ],
  },

  dtmf2numBridge: {
    what: "Calls the local dtmf2num.exe to decode the corresponding DTMF keypad sequence from dial tones in a WAV.",
    principle:
      "DTMF (Dual-Tone Multi-Frequency) is the telephone keypad tone, where each key corresponds to the superposition of two fixed frequencies. dtmf2num analyzes the audio in a WAV, " +
      "recognizes these dual-frequency combinations, and restores them into a digit/symbol key string (0-9, *, #, etc.).\n\n" +
      "This op calls dtmf2num.exe via the bridge's /api/run, with the WAV passed via the {wav} placeholder.",
    usage:
      "Windows only, requires python bridge.py running first. Drop in the WAV to get its base64 and fill {wav}; the default param is just {wav} (analyze the file directly). " +
      "CLI type uses placeholder files, and the result gives the recognized key sequence.",
    examples: [
      {
        in: "params: {wav}   {wav}=base64 of a WAV of dial tones",
        out: "[exit 0]\nDTMF: 1234567890",
        desc: "Restore the key sequence from the dial tones.",
      },
    ],
    tips: [
      "In an audio challenge, when you hear \"beep-beep\" like a phone dialing, think DTMF first.",
      "The recognized keys may be the flag, or may need mapping to letters via the phone keypad grid.",
      "Only eats WAV; convert mp3 to wav first before feeding it.",
    ],
    aka: [
      "dtmf2num", "DTMF", "双音多频", "拨号音", "电话按键音", "Dual-Tone Multi-Frequency",
      "音频解码", "touch tone", "dtmf2num.exe", "WAV 解码", "音频隐写", "misc 音频",
    ],
  },

 // ============================================================
 // CLI bridging (bridgeLang)
 // ============================================================
  bftoolsExe: {
    what: "Calls the local bftools.exe to run Brainfuck-related subcommands: execute BF source, or handle brainloller/braincopter image steganography.",
    principle:
      "Brainfuck is a minimal language with only 8 symbols (+-<>[].,). bftools is a toolset around BF:\n" +
      "  run executes a piece of BF source;\n" +
      "  brainloller encodes a BF program into a colorful pixel image, braincopter hides BF into the pixels of any image, " +
      "  and the encode/decode subcommands convert between \"BF source ⇄ image\".\n\n" +
      "This op calls bftools.exe via the bridge's /api/run: BF source is passed via stdin (with the run - param), " +
      "and images go via the {img} placeholder (with encode/decode).",
    usage:
      "Windows only, requires python bridge.py running first. To execute BF: write the param run -, and fill the source into stdin. " +
      "To decode braincopter/brainloller image steganography: write the param decode braincopter {img}, drop in the image to get its base64 and fill {img}. CLI type.",
    examples: [
      {
        in: "params: run -   stdin: ++++++++[>++++++++<-]>+.",
        out: "[exit 0]\nA",
        desc: "Execute a piece of BF source, output the character A.",
      },
      {
        in: "params: decode braincopter {img}   {img}=base64 of a braincopter image",
        out: "[exit 0]\n（the restored BF source）",
        desc: "Restore the Brainfuck source out of a braincopter image.",
      },
    ],
    tips: [
      "When you see a very regular color-block image that looks like hidden code, try decode braincopter/brainloller.",
      "After decoding the BF source, run - to execute it and get the plaintext.",
      "For a pure BF source challenge, run - fed by stdin is the easiest.",
    ],
    aka: [
      "bftools", "Brainfuck", "BF", "brainloller", "braincopter", "esoteric language",
      "深奥语言", "图像隐写", "run encode decode", "bftools.exe", "brainfuck 解释器", "misc",
    ],
  },

  npietExe: {
    what: "Calls the local npiet.exe to execute a Piet image program (png/gif, etc.), running the image as code to produce a result.",
    principle:
      "Piet is an esoteric language where \"the program is an abstract painting\" (named after the painter Mondrian): it's made of color blocks in 20 colors, " +
      "with the instruction pointer moving between blocks and the operation decided by the hue/lightness difference of adjacent blocks. npiet is its interpreter.\n\n" +
      "This op calls npiet.exe via the bridge's /api/run: the Piet image goes via the {img} placeholder, -e limits the max execution steps (to prevent infinite loops), " +
      "and the program output goes back to stdout.",
    usage:
      "Windows only, requires python bridge.py running first. Drop in the Piet image to get its base64 and fill {img}; the default param -e 1000000 {img} " +
      "(-e limits steps, prevents infinite loops); to see the execution trace use -v {img}. CLI type uses placeholder files.",
    examples: [
      {
        in: "params: -e 1000000 {img}   {img}=base64 of a Piet program image",
        out: "[exit 0]\nHello, world!",
        desc: "Execute this colorful block image as a Piet program and output the result.",
      },
    ],
    tips: [
      "When you get an image \"like a mosaic/abstract painting with very clear block boundaries\", think Piet first.",
      "If the program won't stop, lower the -e step cap; use -v to see the instruction trace and help debug.",
      "npiet recognizes png/gif/ppm, etc.; make sure the image isn't scaled (the codel size would change).",
    ],
    aka: [
      "npiet", "Piet", "esoteric language", "深奥语言", "图像编程语言", "Mondrian",
      "色块编程", "-e 步数", "npiet.exe", "codel", "Piet 解释器", "misc",
    ],
  },
};
