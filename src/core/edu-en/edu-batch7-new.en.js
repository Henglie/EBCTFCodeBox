/*
 * edu-batch7-new.en.js — English edu cards for the 9 ops added in v0.1.11.
 * Source: src/core/edu/edu-batch7-new.js (Chinese), translated 1:1.
 *
 * Covers:
 *   meme codecs — xianziCode, hajimiCode, zakoCode, zakoMystery
 *   image reverse ops — dataURIToImage, img2bits, imageToData
 *   radix reverse ops — floatToDecimal, complementToDec
 *
 * Pure data: no imports, no registration, no side effects. Keys and field shapes
 * match the Chinese shard; example vectors (in/param/out) and TeX formulas are
 * copied verbatim, only desc/caption/prose are translated. Aka lists keep every
 * Chinese alias and add English ones.
 */
export default {
  // ============ Chinese / meme codecs ============
  xianziCode: {
    what: "Ohou encoding (哦齁编码, also called 仙子曰 — \"the fairy says\") — rewrites any text using only the seven characters 哦/齁/♥/啊/呜/嗯/唔 and prefixes it with `仙子曰：`. Every 3 characters carry 1 byte; short texts stay plain and long texts are gzip-compressed automatically. It is a fully reversible encoding, not encryption.",
    principle:
      "**Byte-wise Base7**: the UTF-8 text is first split into bytes (0-255); each byte is written as a 3-digit base-7 number $d_2 d_1 d_0$ (0 to $7^3-1=342$, enough for 0-255) and substituted through the alphabet `哦=0 齁=1 ♥=2 啊=3 呜=4 嗯=5 唔=6`. Decoding restores 1 byte from every 3 characters, so the length must be a multiple of 3.\n\n" +
      "**Protocol header**: the encoded byte stream starts with one control byte. The top bit `0x80` means \"this is protocol-tagged data\", the next bit `0x40` means \"compressed\". The control byte is followed by a varint holding the metadata length; when compressed, the first metadata byte is the algorithm ID: `0x01` = zlib/deflate, `0x02` = gzip; the payload comes last.\n\n" +
      "**Compression threshold**: the reference implementation (yikakia/xianzi) actually compresses only when the UTF-8 length is ≥200 bytes, and the `auto` setting follows the same rule; `gzip`/`deflate` force it and `none` turns it off.\n\n" +
      "**Two spellings of ♥**: the encoder emits `♥` as `❤️` (U+2764 + variation selector VS16), while the decoder accepts `❤️`, `❤` and `♥` and ignores all whitespace. So a copy that lost VS16 in a chat app still decodes.",
    usage:
      "Decoding: paste the whole string that begins with `仙子曰：` and hit decode; the prefix and the compression method are read from the data, no parameters to choose.\n\n" +
      "Encoding: enter the plaintext and pick `compress`: auto (default, compresses only at ≥200 bytes) / gzip / deflate / none. Compressed output is not necessarily shorter — auto compresses at the protocol threshold only and does no extra \"use it only if it got smaller\" check.\n\n" +
      "Note: spaces and line breaks inside the string do not affect decoding; characters outside the alphabet raise a clear \"illegal character\" error instead of being silently dropped.",
    examples: [
      { in: "A", out: "仙子曰：❤️呜❤️哦哦哦齁❤️❤️", desc: "Letter A = 0x41 = 65 = base-7 1·2·2; the ❤️ in the output is ♥" },
      { in: "你好", out: "仙子曰：❤️呜❤️哦哦哦呜呜呜啊唔哦啊齁唔呜呜嗯啊❤️呜啊唔哦", desc: "Two Chinese characters = 6 UTF-8 bytes → 18 alphabet characters" },
      { in: "（≥200 字节的长文本）", param: "compress=gzip", out: "仙子曰：…（协议头标记 0x40，元信息 ID=0x02）", desc: "The compression flag and algorithm ID are stored inside the data, so the decoder needs no parameters" },
      { in: "仙子曰：❤️呜❤️哦哦哦齁❤️❤️", out: "A", desc: "Reverse direction; `❤` or `♥` in place of `❤️` decodes just the same" },
    ],
    formulas: [
      { tex: "b = d_2 \\cdot 7^2 + d_1 \\cdot 7 + d_0,\\qquad d_i \\in [0,6]", caption: "Each byte becomes 3 base-7 digits; three digits span 0-342, enough for every byte value" },
      { tex: "\\text{stream} = \\underbrace{0x80}_{\\text{协议}} \\;\\|\\; \\mathrm{varint}(|meta|) \\;\\|\\; meta \\;\\|\\; payload", caption: "The control byte's top bit marks the protocol, the 0x40 bit marks a compressed payload" },
    ],
    tips: [
      "Recognition: the whole string is built from the seven characters 哦/齁/♥/啊/呜/嗯/唔 and starts with `仙子曰：` — that is this codec. If the prefix is missing, prepend it and try again.",
      "It is an **encoding, not encryption**: there is no key, anyone can decode it, so never use it to protect real secrets.",
      "Lost characters while copying is the classic trap: once a chat app eats the VS16 of `❤️` only `❤` remains, and this tool accepts both; if the platform rewrote characters throughout, the text is unrecoverable.",
      "When a long text fails to decode, check for truncation first: every 3 characters are 1 byte, so missing characters either break the multiple-of-3 rule or leave the compressed stream incomplete.",
      "Protocol source: yikakia/xianzi's design.md and reference implementation (a public protocol); this tool implements its byte-level format and passed a four-step acceptance test.",
    ],
    aka: ["哦齁编码", "哦齁", "仙子曰", "仙子编码", "xianzi", "xianzi code", "xianziCode", "ohou codec",
      "哦齁密语", "仙子语", "哦吼编码", "哦齁 Base7", "xianzi 编码", "仙子曰编码", "哦齁码",
      "ohou code", "ohou base7", "fairy says code", "xianzi base7"],
  },

  hajimiCode: {
    what: "Hajimi encoding (哈基米加密, ternary) — writes every UTF-16 code unit as a base-3 string over 哈/基/米 and puts a 3-character block header in front of each character that records a random shift. It is **obfuscation**, not cryptographic encryption: it decodes without a key, and the same plaintext gives a different output every run.",
    principle:
      "**Base-3 representation**: each UTF-16 code unit is 0-65535 and needs at most 12 ternary digits. Lengths fall into three buckets: ≤6 digits padded to 6, ≤9 padded to 9, ≤12 padded to 12; the 3rd header character records the bucket (0/1/2).\n\n" +
      "**Random shift**: every character gets a random $s$ in 0-8 and its ternary string is rotated right by $s$; the first two header characters encode $s$: the first is $\\lfloor s/3 \\rfloor$, the second is $s \\bmod 3$. The bucket marker is also offset by $s$ mod 3 and subtracted back when decoding.\n\n" +
      "**Optional private key**: each character of the key string contributes the decimal digits of its `charCode` (for example `a` → 97 → the digits `9,7`), cycling into the shift amount: total shift = 3 + random shift + key shift. The decoder subtracts the same amount block by block. A wrong key raises no error, it just yields garbage — which is why it looks like encryption.\n\n" +
      "**Block structure**: `[shift high][shift low][bucket marker]` + 6/9/12 ternary data characters, so each plaintext character becomes 9/12/15 \"hajimi\" characters.",
    usage:
      "Decoding: paste the whole 哈/基/米 string, leave the key empty or fill in the private key given by the challenge author; keep the alphabet at the default `哈基米` (any 3 distinct characters also work).\n\n" +
      "Encoding: enter the plaintext and optionally a key; every run produces different output (random shift). That is by design, not a bug.\n\n" +
      "Telling whether the key is right: readable text means correct; scrambled Chinese characters or control codes mean a wrong key or wrong alphabet. There is no checksum, so the tool cannot decide \"is this key correct\" for you.",
    examples: [
      { in: "A", param: "key=a, 固定随机位移=0", out: "哈哈哈哈哈米米基米", desc: "A=65 → base 3 2101 → padded to 6 digits 002101; the header records shift 0 / bucket 0" },
      { in: "B", param: "key=空, 固定随机位移=8", out: "米米米哈哈米米基米", desc: "With random shift 8 both the header and the data rotate, so the output differs from the last run" },
      { in: "哈基米哈基米哈基米哈基米", param: "key=空", out: "（按块结构解出的字符）", desc: "Length must be 3 + a multiple of 6/9/12, otherwise it reports \"truncated / length mismatch\"" },
    ],
    formulas: [
      { tex: "c = (u + 3 + s + k_i) \\bmod 2^{16},\\qquad u \\in [0, 2^{16})", caption: "The code unit plus the total shift, truncated to 16 bits; the decoder subtracts each term back" },
      { tex: "\\text{block} = [\\lfloor s/3 \\rfloor][s \\bmod 3][(\\ell + s) \\bmod 3] \\;\\|\\; \\mathrm{rotR}_s(\\mathrm{ternary}(c))", caption: "3-character block header + 6/9/12 ternary data digits; ℓ is the length bucket" },
    ],
    tips: [
      "Recognition: the whole string uses only 哈/基/米 and its length is a multiple of 3 — that is almost certainly it; try the empty key first.",
      "Decoding the same ciphertext twice gives the same result; encoding the same plaintext twice gives different results — the random shift explains both, and it is normal.",
      "The key is not a cryptographic KDF: it merely uses the decimal digits of character codes as a shift sequence, so security is close to none — fine for CTF jokes, useless for real secrecy.",
      "The alphabet is configurable: if a challenge uses three characters such as 喵/呜/啊, fill in those 3 characters — the order must match the challenge.",
      "Specification source: the public implementation at 01Petard/hajimi-encoder; this tool recreates its \"block header + shift + ternary\" byte for byte and passed a four-step acceptance test.",
    ],
    aka: ["哈基米", "哈基米加密", "哈基米编码", "哈吉米", "哈基米密语", "hajimi", "hajimi code", "hajimiCode",
      "哈基米三进制", "三进制哈基米", "ha ji mi", "哈基米混淆", "哈基米解密", "哈基米 cipher",
      "hajimi cipher", "hajimi encoding", "hajimi ternary", "ternary hajimi", "hajimi encoder"],
  },

  zakoCode: {
    what: "Zako code (杂鱼编码, open-source Base8) — treats the whole UTF-8 byte string as one big integer, keeps dividing by 8 and maps each remainder to one of the eight characters 可/是/杂/鱼/哦/🥵/♥/~. This is the public version from youzijiang233/zakocode and is not the same as the closed-source 杂鱼密语 on the official site.",
    principle:
      "**Big-integer Base8**: the UTF-8 bytes are assembled big-endian into an integer $N = b_0 \\cdot 256^{n-1} + \\cdots + b_{n-1}$, then $N = 8q + r$ is repeated, each remainder $r$ maps to the 8-character alphabet, and the remainder sequence is reversed at the end. Decoding is the reverse Horner accumulation $N = N \\cdot 8 + v_i$, then a split back into bytes.\n\n" +
      "**Difference from byte-wise Base64**: it does not group 3 bytes at a time but uses \"the whole string as one big integer\", so any length can be encoded; the price is that leading zero bytes are lost in the integer representation (UTF-8 text rarely contains NUL, so the impact is small, but watch out for binary data).\n\n" +
      "**Difference from the official version**: 杂鱼密语 at zako.yhgf.top is PBKDF2 + AES-256-GCM + invisible variation selectors — it has a key and real ciphertext; this op has no key and no encryption, it just swaps in a different character alphabet. Similar names, completely different protocols.",
    usage:
      "Encoding: enter arbitrary text and get a string containing only the 8 alphabet characters.\n\n" +
      "Decoding: paste a string made of alphabet characters to restore the UTF-8 text; a character outside the alphabet raises \"illegal character\" naming the offending character.\n\n" +
      "If the challenge explicitly says \"official zako whisper\" or supplies a key, switch to \"杂鱼密语 (official version)\" instead of trying this op.",
    examples: [
      { in: "你好", out: "~是是鱼♥♥哦可~是鱼杂杂♥~🥵", desc: "6 UTF-8 bytes treated as one big integer, converted to base 8" },
      { in: "杂鱼~", out: "鱼哦♥哦~鱼可是鱼🥵是🥵哦鱼鱼♥是~♥", desc: "Mixed ASCII and ~ example" },
      { in: "~是是鱼♥♥哦可~是鱼杂杂♥~🥵", out: "你好", desc: "Reverse direction; leading and trailing whitespace is ignored" },
    ],
    formulas: [
      { tex: "N = \\sum_{i=0}^{n-1} b_i \\cdot 256^{\\,n-1-i},\\qquad N = \\sum_j d_j \\cdot 8^{\\,j}", caption: "Byte string → big integer → octal digit sequence (alphabet indices)" },
    ],
    tips: [
      "Recognition: the whole string uses only the eight symbols 可/是/杂/鱼/哦/🥵/♥/~ — try this op first.",
      "It differs from 哦齁 encoding: ohou is byte-wise Base7 with exactly 3 characters per byte, while this op is whole-string big-integer Base8 with variable length.",
      "Leading zero bytes cannot be recovered from the big integer; if the decoded binary is missing leading NULs, that is an inherent limit of the encoding, not a decode bug.",
      "Name collision: the official 杂鱼密语 is an AES scheme, this op is open-source Base8; when a challenge provides a key, try the official version first.",
      "Source: youzijiang233/zakocode (open-source implementation); this tool recreates its alphabet and big-integer semantics and passed a four-step acceptance test.",
    ],
    aka: ["杂鱼编码", "杂鱼 Base8", "杂鱼base8", "zakocode", "zako code", "zakoCode", "开源杂鱼",
      "杂鱼密语 Base8", "zako8", "杂鱼八进制", "可是杂鱼哦", "杂鱼大整数编码",
      "zako base8", "zako encoding", "open source zako", "big integer base8"],
  },

  zakoMystery: {
    what: "Zako Whisper (杂鱼密语, official version) — a complete reimplementation of the closed-source algorithm at zako.yhgf.top: PBKDF2-SHA256 derives an AES-256-GCM key from the password, the ciphertext is hidden byte by byte in invisible Unicode variation selectors, and the whole thing is wrapped in a normal-looking zako conversation. Without the key you see only a chat and no trace of ciphertext.",
    principle:
      "**Data layer**: the header is a 9-byte `ZK5` protocol block (older versions used ZK2/ZK3/ZK4): magic `ZK` + version + strength level (0-3) + compression flag + persona/dialect/attribute/scene indices. After the header come a 16-byte random salt and a 12-byte random IV, then the AES-256-GCM ciphertext (including the 16-byte auth tag). Key = `PBKDF2-HMAC-SHA256(user key, salt, iterations)`, with the four levels at 60k / 180k / 420k / 800k iterations; the GCM AAD is the header itself, so changing any single bit fails authentication.\n\n" +
      "**Carrier layer**: every ciphertext byte maps to one invisible character: bytes <16 → from U+FE00, ≥16 → from U+E0100. The official site interleaves these invisible characters after every visible character of the dialogue; decoding extracts only the variation selectors, so the visible text is pure cover and editing it does not break interoperability.\n\n" +
      "**Visible carrier**: V6 uses the official site's own scene/persona/dialect/interjection tables and picks sentence combinations by the payload's SHA-256; this tool reimplements those tables and the selection algorithm, and matches the official site byte for byte when salt/IV are fixed. The older V5 visible templates are also supported for decoding.\n\n" +
      "**Compression**: when the header's compression bit is 1, the AES plaintext is a gzip stream; the official auto strategy is \"compress only if gzip output is smaller than the original\".",
    usage:
      "Decoding: paste the whole dialogue that carries invisible characters, fill in the key (the default is the demo key published by the official site) and click decode; the optional diagnostic report shows version, strength, compression and persona/scene indices.\n\n" +
      "Encoding: enter the plaintext, choose the key, PBKDF2 strength, mesugaki (雌小鬼) strength/dialect/persona/scene and compression, and get a dialogue carrying an invisible payload.\n\n" +
      "Platform risk: some chat apps and editors filter variation selectors, which loses the ciphertext; if decoding reports \"payload too short\" or \"incorrect key\", first check that the original text was not sanitized.",
    examples: [
      { in: "（一段含不可见变体选择器的杂鱼对话）", param: "key=zako-whisper-default-key", out: "flag{hello_zako}", desc: "Official algorithm example: the visible words are just cover; the real data sits in the invisible characters" },
      { in: "flag{hello_zako}", param: "strength=标准, compress=auto", out: "（V6 可见对话 + 不可见载荷）", desc: "The encoded output carries data byte by byte: every visible character is followed by one variation selector" },
      { in: "（任意普通 emoji 文本）", out: "（报错：未找到不可见载荷 / 缺少 ZK 魔数）", desc: "Ordinary emoji VS16 is a variation selector too, but there is no ZK header, so the tool will not misjudge it" },
    ],
    formulas: [
      { tex: "K = \\mathrm{PBKDF2\\text{-}SHA256}(pw, salt, iter),\\quad C = \\mathrm{AES\\text{-}GCM}_K(IV, AAD=header, P)", caption: "Key derivation and authenticated encryption; the header is integrity-protected as AAD" },
      { tex: "byte\\ b \\mapsto \\begin{cases} U+FE00 + b, & b < 16 \\\\ U+E0100 + b - 16, & b \\ge 16 \\end{cases}", caption: "Each ciphertext byte corresponds to one invisible variation selector" },
    ],
    tips: [
      "Recognition: a normal Chinese conversation riddled with invisible characters (they show up as blanks or placeholders in an editor) and a zako theme almost certainly means this codec.",
      "The default key `zako-whisper-default-key` is the demo value published by the official site; CTF challenges usually change it, so always use the challenge's key.",
      "It is real encryption: without the key the plaintext cannot be recovered, unlike the open-source Base8 `zakoCode`.",
      "The strength level only changes the PBKDF2 iteration count (60/180/420/800k), not the algorithm itself; if a challenge states the strength, use it to speed up decoding.",
      "Platform filtering of variation selectors loses the ciphertext permanently; for cross-platform transfer, convert to Base64 or a file first.",
      "Interop: ciphertext produced here has been decoded on the official site, official samples (including compressed and old V5) all decode here, and V6 carriers with fixed salt/IV match byte for byte.",
    ],
    aka: ["杂鱼密语", "官方杂鱼密语", "杂鱼密语官方版", "zako whisper", "zako mystery", "zakoMystery",
      "zako.yhgf.top", "ZK5", "ZK4", "变体选择器隐写", "不可见字符加密", "杂鱼官网", "zako official",
      "AES 杂鱼密语", "PBKDF2 杂鱼",
      "zako whisper official", "variation selector stego", "invisible character encryption", "ZK2", "ZK3"],
  },

  // ============ Image reverse ops ============
  dataURIToImage: {
    what: "Base64/dataURI to image — the reverse of \"image to Base64/dataURI\". It turns `data:image/png;base64,...` or bare base64 back into a real image file, auto-detects PNG/JPG/GIF/BMP/WebP/ICO/SVG, and offers an inline preview plus download.",
    principle:
      "**data URI layout**: RFC 2397 defines `data:[<mime>][;base64],<data>`. With `;base64` the data is Base64, otherwise it is percent-encoded. This tool decodes at the byte level and never treats the result as a concatenated string, so binary images survive intact.\n\n" +
      "**Format detection uses file signatures, not declarations**: PNG is `89 50 4E 47`, JPEG is `FF D8 FF`, GIF is `GIF8`, BMP is `BM`, WebP is `RIFF....WEBP`, ICO is `00 00 01 00`. SVG is text, so the first 1 KB is sniffed for `<svg>`.\n\n" +
      "**MIME mismatch warning**: a common CTF disguise declares `image/jpeg` while the actual bytes are PNG. The tool restores the extension from the real signature and also reports \"declared vs actual\".\n\n" +
      "**Division of labour with generic Base64**: the generic Base64 decode only emits bytes/text; this op adds image format sniffing, MIME naming, preview and download, making it the dedicated entry point for image challenges.",
    usage:
      "Paste a data URI or bare base64 (leading/trailing quotes and whitespace are fine) and run; the result area reports format, size and whether the MIME matches, and attaches a downloadable image file.\n\n" +
      "If the input is a QR code or barcode image, the raw data URI/base64 can also be pasted into \"QR code scan and parse\".\n\n" +
      "If the decoded bytes are not a known image, it reports \"not a known image format\" together with the actual magic number it hit (ZIP/PDF, for example), which helps spot a file wrapped in another format.",
    examples: [
      { in: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...", out: "from_datauri.png（1×1 PNG）+ 预览", desc: "Standard PNG data URI" },
      { in: "data:image/jpeg;base64,iVBORw0KGgo...", out: "from_datauri.png；⚠ MIME 不符：声明 image/jpeg，实际 image/png", desc: "Typical disguise: declared JPEG, file signature is PNG" },
      { in: "iVBORw0KGgo...（裸 base64）", out: "from_datauri.png", desc: "Without a data: prefix, the input is decoded as bare base64" },
      { in: "data:image/svg+xml;base64,PHN2Zy...", out: "from_datauri.svg + SVG 源码", desc: "SVG takes the text path and does not require a bitmap magic number" },
    ],
    tips: [
      "Trust the file signature before the extension: the `.jpg` in a challenge is very often a PNG, and this tool warns about it explicitly.",
      "Base64 inside a data URI may contain line breaks; no manual whitespace cleanup is needed when pasting.",
      "Decoded bytes starting with `PK` mean ZIP (possibly docx/apk) and `%PDF` means PDF — this op only restores images; use the matching file analysis/extraction op for other formats.",
      "SVG is text, not a bitmap: browsers display it, but it never goes through PNG decoding; this tool provides both the source and an `.svg` file.",
      "The reverse entry point is \"image to Base64/dataURI\"; if you only have an image file, use that first to produce a data URI.",
    ],
    aka: ["dataURI 转图片", "base64 转图片", "图片还原", "data uri to image", "base64 image decoder",
      "dataurl 转图片", "内联图片解码", "data:image", "base64 图片解码", "图片 base64 还原",
      "datauri2image", "base64 to png", "base64 to jpg", "图片解码",
      "data uri decoder", "dataurl to image", "inline image decode", "base64 image restore"],
  },

  img2bits: {
    what: "Image to binary bitmap — the reverse of \"binary to image\". It samples a black-and-white dot matrix into a 0/1 bit stream (dark=1, white=0 by default), supporting threshold, sampling step, per-row line breaks, channel selection and inversion. PNG is decoded in pure JS; JPG/GIF/BMP/WebP use the browser decoder.",
    principle:
      "**Sampling grid**: starting at offset `floor(scale/2)`, one pixel is taken every `scale` pixels, with the same step in rows and columns. If encoding enlarged each bit to $N \\times N$ pixels, set scale to $N$ when decoding and the original bits come back exactly.\n\n" +
      "**Dark or light**: by default the luminance $Y = 0.299R + 0.587G + 0.114B$ is used, $Y \\le$ threshold is dark (1) and anything else is white (0), matching the 1=black, 0=white convention of \"binary to image\". You can also sample the red/green/blue/alpha channel directly, or invert so white counts as 1.\n\n" +
      "**Line breaks**: when `lineWidth` is non-zero a newline is added after that many bits, which makes it easy to eyeball the original width; 0 outputs a single line.\n\n" +
      "**Why it exists**: CTF challenges often draw a flag's bits as black and white squares, or enlarge a QR code/text and ask you to recover the bit stream; when you have only the image and no original bit string, this op is the reverse entry point.",
    usage:
      "Drop an image file (or paste an image base64/dataURL), set the parameters and run:\n\n" +
      "- `threshold`: luminance threshold, default 128; adjust to the actual gray levels when the background is not clean.\n" +
      "- `scale`: the enlargement factor used when encoding; if unknown start with 1 and check whether the output length matches the expected bit string.\n" +
      "- `lineWidth`: bits per row; fill in the original logical width to align the output by rows.\n" +
      "- `mode`: luminance/red/green/blue/alpha; try a single channel for colorful interference images.\n" +
      "- `invert`: invert, white=1.\n\n" +
      "The output is plain 0/1 text that can feed \"binary to ASCII\", \"binary to image\", or be grouped into bytes.",
    examples: [
      { in: "（4×1 黑白 PNG，像素：黑 白 黑 白）", param: "scale=1, lineWidth=4", out: "1010", desc: "Dark=1, white=0, output 4 bits per row" },
      { in: "（编码时每位放大 4×4 的 PNG）", param: "scale=4", out: "与原位串一致", desc: "The sampling step must equal the enlargement factor used when encoding" },
      { in: "（白底黑字的文字图）", param: "threshold=100, invert=false", out: "文字轮廓的位流", desc: "Adjusting the threshold removes anti-aliased gray fringes" },
    ],
    formulas: [
      { tex: "Y = 0.299R + 0.587G + 0.114B,\\qquad bit = [Y \\le T]", caption: "Default luminance test; T is the threshold and dark pixels become 1" },
      { tex: "bit_{x,y} = f\\bigl(I(\\lfloor scale/2 \\rfloor + x \\cdot scale,\\; \\lfloor scale/2 \\rfloor + y \\cdot scale)\\bigr)", caption: "Uniform-step sampling; the offset is half a step, landing in the centre of an enlarged block" },
    ],
    tips: [
      "All-zero or all-one output: usually the wrong threshold or an image that is not black and white; try `invert` first, then adjust threshold.",
      "Wrong output length: check that `scale` matches the enlargement factor used when the image was generated; a mismatch samples extra or missing pixels.",
      "Before converting a color image to bits, decide which channel to use; plain luminance can flatten color differences.",
      "JPG has compression noise that turns black/white edges gray; PNG is the most reliable.",
      "The reverse entry point is \"binary to image\"; this op only goes image → bit stream and does not interpret the bits as ASCII.",
    ],
    aka: ["图片转二进制", "图片转01", "图片转位流", "点阵转比特", "image to bits", "image to binary",
      "位图解码", "图片转 bit", "binary image decode", "点阵图还原", "图片转 0/1", "黑白图转二进制",
      "位流提取", "image2bits",
      "image to bitstream", "bitmap to bits", "dot matrix decode"],
  },

  imageToData: {
    what: "Image to numeric data — the reverse of \"render numeric data as an image\". It samples an image into one line of RGB/RGBA/grayscale values per pixel, supporting channel count, channel order, row/column scan order, sampling step and separator. It is the tool for recovering the original number list an author rendered into a picture.",
    principle:
      "**Pixel sampling**: the same grid as the renderer — start at `floor(scale/2)` and take one pixel every `scale`, in row-major (across, then down) or column-major (down, then across) order. Column-major is common in CTF because data is often written column by column.\n\n" +
      "**Channel selection**: `auto` scans the alpha channel and outputs RGBA if any alpha is not 255, otherwise RGB; RGB/RGBA/grayscale can also be forced. Grayscale uses $Y = 0.299R + 0.587G + 0.114B$, rounded.\n\n" +
      "**Channel order**: RGB or BGR; if the renderer used BGR, choose BGR on the decoding side too, or red and blue swap.\n\n" +
      "**Why it cannot be inverted exactly**: if the renderer normalized the value range, quantized a palette, used lossy compression (JPG) or resized with interpolation, the pixel values already changed; this op only recovers \"the pixel values that actually exist in the current image\", not the original numbers before normalization. For an exact round trip, render without normalization, use lossless PNG and keep scale identical.",
    usage:
      "Drop an image (or paste base64/dataURL), set `channels`, `order`, `scan`, `scale` and `format` to match the renderer, and run to get one numeric line per pixel.\n\n" +
      "When unsure: start with the defaults (auto channels, RGB, row-major, scale=1, comma) and check whether the number of output lines equals width×height; if not, adjust scan/scale.\n\n" +
      "The output can be pasted straight back into \"render numeric data as an image\" to verify that it reproduces the same picture.",
    examples: [
      { in: "（2×1 PNG，像素红、绿）", param: "channels=3, order=rgb, scan=row", out: "255,0,0\n0,255,0", desc: "One RGB triple per line" },
      { in: "（带透明度的 PNG）", param: "channels=0", out: "R,G,B,A（自动识别 4 通道）", desc: "Auto mode detects alpha != 255 and uses RGBA" },
      { in: "（列主序渲染的图）", param: "scan=column, scale=2", out: "按列取样的数值行", desc: "scan must match the renderer, otherwise the order comes out transposed" },
    ],
    formulas: [
      { tex: "Y = \\operatorname{round}(0.299R + 0.587G + 0.114B)", caption: "Grayscale output uses ITU-R BT.601 luma weights" },
      { tex: "\\mathrm{idx}_{\\text{row}} = y \\cdot W + x,\\qquad \\mathrm{idx}_{\\text{col}} = x \\cdot H + y", caption: "Row-major and column-major sampling order; each is the other's transpose" },
    ],
    tips: [
      "The number of output lines should be $\\lceil W/scale \\rceil \\times \\lceil H/scale \\rceil$; if it does not match, check scale first.",
      "Red and blue swapped: the renderer used BGR, so choose BGR on the decoding side as well.",
      "The image looks \"transposed\": switch scan (row-major ↔ column-major) instead of suspecting the data.",
      "Lossy formats (JPG) and normalization shift the values; for exact recovery use PNG and render without normalization.",
      "The reverse entry point is \"render numeric data as an image\"; this op only samples and does not interpret what the numbers mean.",
    ],
    aka: ["图片转RGB", "图片转数值", "像素值提取", "图片转像素", "image to rgb", "pixel extract",
      "图像采样", "image to data", "像素列表提取", "图片数值还原", "image2data", "RGB 提取",
      "像素数据还原", "图像转数组",
      "image to pixels", "pixel value extract", "image sampler", "pixel dump"],
  },

  // ============ Radix reverse ops ============
  floatToDecimal: {
    what: "Any-base float to decimal — the reverse of \"decimal to any-base float\". It parses a base 2/8/10/16 float string (optional sign and 0b/0o/0x prefix), expands it by place value into a decimal value, and reports the requested precision.",
    principle:
      "**Place-value expansion**: the integer part accumulates left to right as $v = v \\cdot base + d$; each fractional digit is weighted by its position starting from $base^{-1}$, i.e. $d \\cdot base^{-k}$. For example binary `101.1` = $1\\cdot4 + 0\\cdot2 + 1\\cdot1 + 1\\cdot\\tfrac12 = 5.5$.\n\n" +
      "**Prefix and sign**: strip the sign first, then the optional `0b`/`0o`/`0x` prefix; the prefix is not required but must agree with the chosen base (for example with base=16, `0x1A.8` is valid).\n\n" +
      "**Character validation**: every character must be inside the chosen base, otherwise it reports \"illegal base-N character\"; at most one decimal point.\n\n" +
      "**Precision**: output uses `toFixed(precision)` with trailing zeros trimmed, precision capped at 64. Note that JavaScript uses IEEE-754 double precision, so decimal results beyond roughly 15-17 significant digits are inexact by nature; this tool shows the double value, not an arbitrary-precision decimal.",
    usage:
      "Enter the float string, choose the input base and the number of output decimals; the report then shows three lines: base-N float / decimal / precision.\n\n" +
      "The decimal line can be copied directly; for more digits raise precision, but stay within the meaningful range of a double.\n\n" +
      "The reverse entry point is \"decimal to any-base float\".",
    examples: [
      { in: "0b101.1", param: "base=2", out: "5.5", desc: "4 + 0 + 1 + 0.5 = 5.5" },
      { in: "0o17.4", param: "base=8", out: "15.5", desc: "1×8 + 7 + 4/8 = 15.5" },
      { in: "0x1A.8", param: "base=16", out: "26.5", desc: "1×16 + 10 + 8/16 = 26.5" },
      { in: "-0x10.8", param: "base=16", out: "-16.5", desc: "Strip the sign first, then expand by place value" },
      { in: "0.1", param: "base=2", out: "0.5", desc: "Binary fraction 0.1₂ = 1/2" },
    ],
    formulas: [
      { tex: "v = \\sum_{i=0}^{m} d_i \\, b^{\\,i} + \\sum_{j=1}^{n} f_j \\, b^{-j}", caption: "Place-value expansion of integer and fractional digits (b is the input base)" },
      { tex: "\\text{shown} = \\operatorname{trim}\\bigl(\\operatorname{toFixed}(v, p)\\bigr)", caption: "Emit at precision p and trim trailing zeros" },
    ],
    tips: [
      "Confirm the base first: `0b`/`0o`/`0x` mean 2/8/16 respectively; without a prefix look at the character set (only 0/1 is most likely binary).",
      "A tiny difference in the result is usually double-precision error, not a wrong algorithm; decimals like 0.1 are inherently repeating in binary.",
      "Spaces in the input are ignored; multiple decimal points, a sign in the middle or illegal characters all raise clear errors.",
      "In CTF, decimal floats often come from IEEE-754 bit-splitting challenges; this op only does place-value expansion and does not parse IEEE-754 bit patterns.",
      "The reverse entry point is \"decimal to any-base float\"; both sides use the same base and precision conventions.",
    ],
    aka: ["浮点转十进制", "任意进制浮点", "二进制浮点转十进制", "base-n float", "float decoder",
      "非十进制浮点", "0b 浮点", "浮点还原", "float to decimal", "进制浮点转换", "十六进制浮点转十进制",
      "binary fraction", "浮点进制转换", "float2dec",
      "base n float decoder", "radix float", "float base convert"],
  },

  complementToDec: {
    what: "Sign-magnitude/ones'/two's complement to decimal — the reverse of \"sign-magnitude, ones' complement, two's complement\". Given a bit string, it interprets it under all three signed conventions and lists the differences. The width can be left empty (string length) or set to 8/16/32/64.",
    principle:
      "Let the width be $n$, the top bit the sign bit and the remaining $n-1$ bits the magnitude, with raw unsigned value $R$ and magnitude bits $M$:\n\n" +
      "- **Sign-magnitude (原码)**: when the sign bit is 1 the value is $-M$; when 0 it is $R$.\n" +
      "- **Ones' complement (反码)**: when the sign bit is 1 the value is $-((2^{n-1}-1)-M)$; when 0 it is $R$.\n" +
      "- **Two's complement (补码)**: when the sign bit is 1 the value is $R - 2^n$; when 0 it is $R$.\n\n" +
      "**Why the three differ for negatives**: sign-magnitude flips only the sign bit; ones' complement inverts every magnitude bit; two's complement adds 1 on top of that. Modern computers use two's complement because addition and subtraction share one circuit and there is only one zero.\n\n" +
      "**Width**: a width larger than the string pads zeros on the left; a width smaller than the string is an error. At 8 bits the range is -128..127 for two's complement and -127..127 for ones' complement and sign-magnitude.",
    usage:
      "Paste a bit string containing only 0/1 (spaces allowed); a width of 0 means \"use the string length\". The report gives all three interpretations at once.\n\n" +
      "For positive numbers all three agree; only when the top bit is 1 do you need to compare the three lines. If a CTF challenge does not state the convention, two's complement is the usual first guess, then try sign-magnitude/ones' complement from context.",
    examples: [
      { in: "11111111", param: "bits=8", out: "sign-magnitude -127 / ones' complement -0 / two's complement -1", desc: "All 8 bits set; ones' complement yields negative zero, shown explicitly" },
      { in: "10000000", param: "bits=8", out: "sign-magnitude -0 / ones' complement -127 / two's complement -128", desc: "The most negative two's-complement value; sign-magnitude yields negative zero" },
      { in: "01111111", param: "bits=8", out: "三种解释都是 127", desc: "Positive numbers agree in all three" },
      { in: "1010", param: "bits=4", out: "原码 -2 / 反码 -5 / 补码 -6", desc: "A 4-bit negative under the three conventions" },
    ],
    formulas: [
      { tex: "\\text{原码} = \\begin{cases} R, & s=0 \\\\ -M, & s=1 \\end{cases}", caption: "Sign bit s and magnitude bits M" },
      { tex: "\\text{反码} = \\begin{cases} R, & s=0 \\\\ -((2^{n-1}-1)-M), & s=1 \\end{cases}", caption: "Negative numbers invert every magnitude bit" },
      { tex: "\\text{补码} = \\begin{cases} R, & s=0 \\\\ R-2^{n}, & s=1 \\end{cases}", caption: "The representation modern computers use" },
    ],
    tips: [
      "Look at the top bit first: when it is 0 all three interpretations agree, so there is nothing to debate; only a 1 forces you to decide which convention the challenge uses.",
      "Two's complement first: signed integers in C/Java/assembly default to it, and a challenge saying \"signed binary\" almost always means it too.",
      "Both ones' complement and sign-magnitude have a -0: the tool computes the magnitude with BigInt and prefixes the sign itself, so the report shows -0 explicitly.",
      "The width must match the challenge: the same bit string read as 4 bits and as 8 bits gives completely different results.",
      "The reverse entry point is \"sign-magnitude, ones' complement, two's complement\"; the forward tool writes a decimal number in all three encodings for cross-checking.",
    ],
    aka: ["原码反码补码解码", "补码转十进制", "原码转十进制", "反码转十进制", "twos complement",
      "two's complement", "ones complement", "sign magnitude", "有符号位串", "补码解码",
      "原码解码", "complement to decimal", "signed binary", "补码还原",
      "two's complement decoder", "signed bit string", "ones complement decoder", "sign-magnitude decoder"],
  },

  // ============ Classic / scout ============
  scoutStick: {
    what: "Scout stick cipher — dCode's Code Chinois (Chinese code), also called Samurai / samurai code. It splits every letter into two stick counts: the vowel index and the consonant index after that vowel; horizontal bars stand for vowels, vertical bars for consonants. dCode's classic example `|||- ||- ---- |||- --` decodes to DCODE.",
    principle:
      "**Vowel index** is fixed as A=1, E=2, I=3, O=4, U=5, Y=6. To encode a consonant, find the nearest vowel before it, then count which consonant it is after that vowel:\n" +
      "- B = 1st consonant after A → 1 horizontal + 1 vertical; C = 2nd → 1 horizontal + 2 vertical; D = 3rd → 1 horizontal + 3 vertical.\n" +
      "- L = 3rd consonant after I → 3 horizontal + 3 vertical (J=1, K=2, L=3).\n" +
      "- W = 2nd consonant after U → 5 horizontal + 2 vertical; Z = 1st consonant after Y → 6 horizontal + 1 vertical.\n\n" +
      "**Vowels themselves** have consonant index 0: A = 1 horizontal, E = 2 horizontal, I = 3 horizontal, O = 4 horizontal, U = 5 horizontal, Y = 6 horizontal. Y counts as a vowel, so Y itself is 6 horizontal bars, and only then does Z fall back to being the 1st consonant after Y.\n\n" +
      "**Writing order**: dCode's displayed examples put the vertical bars first (D = `|||-`), and this tool's default `vh` does the same; if a challenge writes horizontal bars first (D = `-|||`), switch the parameter to `hv`. The horizontal/vertical bars of each letter are written consecutively, letters are separated by spaces, and spaces in the plaintext are shown as `/`.\n\n" +
      "**Samurai variant**: swap the roles of horizontal and vertical bars — the number of horizontal bars now gives the consonant index and the number of vertical bars the vowel index. The same DCODE becomes `|--- |-- |||| |--- ||` under Samurai.\n\n" +
      "**Letter case**: the sticks carry no case information, so decoding always outputs uppercase; non-letter characters pass through unchanged.",
    usage:
      "Encoding: enter letter text, choose the variant (classic/samurai) and the writing order (vh/hv); the output is a stick string made of `|`, `-`, spaces and `/`.\n\n" +
      "Decoding: paste the stick string and pick the same variant and order; each space-separated token is one letter and `/` is a space in the plaintext. Letters must be separated by spaces, otherwise a run such as `|||-` is read as a single glyph.\n\n" +
      "Troubleshooting: a \"vowel index out of range\" error usually means the variant is inverted; a \"glyph order\" error usually means vh/hv is inverted; an error like \"only 3 consonants after A\" means the vertical-bar count exceeds the consonants that actually exist after that vowel (for example there can never be a 4th consonant after A).",
    examples: [
      { in: "DCODE", param: "classic, order=vh", out: "|||- ||- ---- |||- --", desc: "dCode's official example: D C O D E" },
      { in: "L", param: "classic, order=vh", out: "|||---", desc: "L = 3rd consonant after I: 3 vertical + 3 horizontal" },
      { in: "DCODE", param: "classic, order=hv", out: "-||| -|| ---- -||| --", desc: "Horizontal-first notation, exactly the same meaning" },
      { in: "DCODE", param: "samurai, order=vh", out: "|--- |-- |||| |--- ||", desc: "The Samurai variant swaps the roles of horizontal and vertical bars" },
      { in: "Hello, World!", param: "classic, order=vh", out: "|||-- -- |||--- |||--- ---- , / ||----- ---- |||---- |||--- |||- !", desc: "Non-letters pass through and spaces become /; decoding always outputs uppercase" },
    ],
    formulas: [
      { tex: "\\text{letter} = \\mathrm{V}[\\,h\\,]\\text{-th consonant after } \\mathrm{V}[\\,h\\,]", caption: "Classic code: h is the vowel index (1-6) and v the consonant index after it; v=0 means the vowel itself" },
      { tex: "\\text{Samurai}: h \\leftrightarrow v", caption: "The Samurai variant swaps the roles of horizontal and vertical bars; everything else is unchanged" },
    ],
    tips: [
      "Recognition: the whole string contains only `|`, `-` and spaces (maybe `/`), with letters grouped by spaces — that is almost certainly this cipher; unlike Morse (dots and dashes), the characters here are vertical and horizontal bars.",
      "Do not confuse it with counting-rod numerals: those use Unicode rod symbols such as 𝍠-𝍱 to record decimal numbers, whereas this op is dCode's Code Chinois, which encodes letters by the counts of horizontal and vertical bars.",
      "Also do not confuse it with the Scytale (cipher rod): the Scytale wraps a strip of cloth around a stick to transpose the letters; this op has nothing to do with the physical shape of a stick, it merely draws sticks as horizontal and vertical lines.",
      "Y is the 6th vowel: Y itself = 6 horizontal bars, Z = 6 horizontal + 1 vertical. Many implementations miss Y/Z, so these two letters make a good check.",
      "Only B/C/D follow A and only Z follows Y; a vertical-bar count above that limit cannot belong to the vowel, so first check whether the variant is inverted.",
      "Source: the FAQ and examples on dCode.fr/code-chinois (visited 2026-10); both variants (classic/Samurai) and both writing orders (vh/hv) match the page's conventions.",
    ],
    aka: ["童子军木棍密码", "童子军密码", "木棍密码", "棍棒密码", "棍码", "童军码",
      "中国码", "中国密码", "中国木棍密码", "武士码", "武士密码", "Samurai code", "Samurai cipher",
      "Code Chinois", "Chinese code", "scout stick cipher", "stick cipher", "bâtons", "chinese sticks",
      "中国式密码", "童子军中国码", "scout stick code", "chinese stick cipher"],
  },
};
