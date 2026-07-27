// English edu shard: misc2-new. cn 5 + stego 4 + hash 3 + base 1 + classic 6 + radix 5 = 24 ops.
// Pure data, no imports, no side effects. Content faithfully reflects each op's source; author/prefix/passwords match the source.
export default {
 // ============ cn / Chinese native encodings ============
  yueChang: {
    what: "YueChang (曰唱): a work by Feng Zhi Xia Xiang (fzxx) that compresses and encrypts text, then maps it into a string of Chinese onomatopoeic characters (啊嘶呼呀嗞…), prefixed with 「唱：」.",
    principle:
      "Essentially three steps: compress + encrypt + reskin.\n\n" +
      "Encode: deflate the plaintext → derive an AES-GCM-256 key from the password via $PBKDF2\\text{-}SHA256$ (100,000 iterations) → encrypt (random 8-byte salt + 12-byte iv) → frame `salt||iv||ciphertext` as standard Base64 → map each of Base64's 65 characters (A-Z a-z 0-9 + / =) to a Chinese onomatopoeic character → add the prefix 「唱：」 (唱 + full-width colon).\n\n" +
      "Default password is `YueChang` (leave blank to use the default). Because of the random salt/iv, the same plaintext yields different ciphertext every time; integrity is guaranteed by the AES-GCM authentication tag.",
    usage: "Encode: enter text, optionally supply a password (blank uses the default YueChang), output a 「唱：…」 onomatopoeic string. Decode: paste the onomatopoeic string; the password must match the one used to encrypt.",
    examples: [
      { in: "hello", param: "password blank", out: "唱：啊嘶呼呀… (differs each time)", desc: "Random iv makes ciphertext non-fixed" },
    ],
    tips: ["A leading 「唱：」 plus a run of onomatopoeic characters like 「啊嘶呼呀嗞哦啡啦」 means YueChang.", "A wrong password makes GCM authentication fail, throwing a decryption error directly — either the ciphertext is broken or the password is wrong."],
    aka: ["曰唱", "yuechang", "YueChang", "风之暇想", "fzxx", "唱语", "拟声字加密", "唱前缀编码",
      "中文拟声加密", "aes拟声编码", "曰唱编码", "yue chang", "与佛论禅加密版",
      "onomatopoeia cipher", "chinese onomatopoeia encryption"],
  },

  moyue: {
    what: "MoYue (魔曰): a Chinese port of SheepChef's Abracadabra that encrypts text and disguises it as faux classical Chinese (or a plain character-substitution string); a key is required to decrypt.",
    principle:
      "Upstream is a full encryption pipeline: $UNISHOX2/GZIP$ compression → $AES\\text{-}256\\text{-}CTR$ → Mersenne Twister PRNG → rotating large-dictionary character-table substitution → Luhn check digit.\n\n" +
      "Two modes: classical simulation (classical, default, outputs text that looks like classical Chinese, with options for punctuation/parallel prose/logic style) and traditional (a plain character-substitution string, no literary style). Ciphertext from the two modes is incompatible; cross-decoding errors out, and a failed decode automatically falls back to the other mode and retries.\n\n" +
      "Default key is `ABRACADABRA`. Encode uses randomness (seeded by Date.now()), so the same plaintext gives different ciphertext each time, yet decode always recovers it; a wrong key throws 「解码失败」 (decode failed).",
    usage: "Pick a mode (classical simulation / traditional) and enter a key (default ABRACADABRA). In classical simulation you can also tune randomness (0-100), whether to add punctuation, parallel prose, and logic priority. The decode key must match.",
    examples: [
      { in: "flag", param: "mode=classical, default key", out: "a stretch of faux classical Chinese (differs each time)", desc: "Random seeding makes ciphertext non-fixed" },
    ],
    tips: ["Ciphertext peppered with JP marker chars (桜込冪雫実沢) and CN marker chars (琊俵琊欤瞍珏), dominated by CJK, is most likely MoYue.", "The two modes are incompatible; if it won't decode, try switching modes first."],
    aka: ["魔曰", "moyue", "abracadabra", "Abracadabra", "SheepChef", "文言仿真加密", "mo yue",
      "魔曰编码", "中文abracadabra", "仿文言文加密", "魔曰密码", "咒语加密", "AES中文伪装",
      "classical chinese disguise cipher"],
  },

  suiYanSuiYu: {
    what: "SuiYanSuiYu (随言随语, credited to Gamma): converts each character to base 4, then uses the four characters 「随波逐流」 as digit symbols, assembling text prefixed with 「随波逐流语录：」.",
    principle:
      "The dictionary `随波逐流` (four chars) represents base-4 digits 0/1/2/3; the length table `江河洪浪湖泊海` (seven chars) represents base-4 digit counts 1-7.\n\n" +
      "Encode: take each character's code point → convert to a base-4 string → map each digit to its corresponding character via the dictionary → prepend a length-prefix character (indicating how many digits this segment has). The whole thing is prefixed with a random 1-4 characters + 「随波逐流语录：」.\n\n" +
      "The random prefix makes output non-fixed, but decode recovers any valid encoding. Because the length table has only 7 positions ($4^7=16384$), characters with code points above 16383 are unsupported.",
    usage: "Encode: enter text, output a 「随波逐流语录：…」 string. Decode: paste that string to recover the original.",
    examples: [
      { in: "Hi", out: "随波逐流语录：… (random prefix + encoded segment)", desc: "Different random prefix each time" },
    ],
    tips: ["A leading 「随波逐流语录：」, or a whole passage made only of the 11 characters 「随波逐流江河洪浪湖泊海」, is this.", "Rare characters/emoji with code points above 16383 can't be encoded; the original algorithm throws out-of-range."],
    aka: ["随言随语", "随波逐流语录", "suiyansuiyu", "随波逐流编码", "伽马编码", "sui yan sui yu",
      "四进制汉字编码", "随言随语编码", "随波逐流工具编码", "SBZL", "随语编码", "语录编码",
      "base-4 chinese encoding"],
  },

  xiangyue: {
    what: "XiangYue (想曰, decrypt-only): decrypts XiangYue ciphertext (Chinese / Emoji / zero-width / Japanese / Korean / pictographic characters) back to plaintext; it's a re-encryption scheme.",
    principle:
      "The ciphertext first auto-detects which mapping set it uses by character type (Chinese / Emoji / zero-width / Japanese / Korean / pictographic), reverse-maps back to Base64, then auto-detects one of two ciphertext formats:\n\n" +
      "format1: seed(16) + ChaCha20-Poly1305 ciphertext; the master key is derived via $Argon2id$ (t=2, m=64MiB, p=1), then subkeys are derived via HKDF-SHA512 → ChaCha20-Poly1305 → AES-CTR → zlib decompress.\n\n" +
      "format2: salt(16)+nonce(12)+ciphertext; derived via $PBKDF2\\text{-}SHA256$ (500,000 iterations), HKDF-SHA256 → ChaCha20-Poly1305 → AES-CTR → zlib.\n\n" +
      "Built-in default password `a184f7b849ffed24d266a30298c72ef2f5ad040db73bf37151fac767630728`. The decompiled source contains only the decryption function, so this op is decrypt-only (format1's Argon2id derivation is slow, taking a few seconds).",
    usage: "Paste XiangYue ciphertext (any mapping is auto-detected); the password defaults to the built-in one. Tick 「include detection info」 to see the detected mapping type and format. Decrypt only.",
    examples: [
      { in: "(a XiangYue Chinese/Emoji ciphertext string)", param: "default password", out: "recovered plaintext", desc: "Auto-detects mapping and format" },
    ],
    tips: ["XiangYue ciphertext takes many forms (Chinese characters, Emoji, invisible zero-width characters, Japanese/Korean) and is identified via a built-in table of 650 mappings.", "format1 uses Argon2id with 64MiB memory, so decryption stalling for a few seconds is normal."],
    aka: ["想曰", "xiangyue", "XiangYue", "想曰解密", "zbXiangYue", "xiang yue", "想曰编码",
      "argon2想曰", "chacha想曰", "重加密中文", "想曰密文", "多映射解密", "想曰XiangYue",
      "xiangyue decrypt", "multi-mapping decryption"],
  },

  xiongyue: {
    what: "XiongYue (熊曰): compresses text, then encodes it using 91 「bear-speak」 Chinese characters (食性很雜既溫和…), prefixed with 「熊曰：呕」.",
    principle:
      "Pipeline: UTF-8 the plaintext → raw deflate → base91 numeric encoding (13/14-bit adaptive) → map each value (0-90) to one of the 91 bear-speak dictionary characters → reverse the whole thing → add the prefix 「熊曰：呕」.\n\n" +
      "base91 packs the byte stream into 0-90 values in 13- or 14-bit groups, more compact than base64. To decode: strip the prefix, reverse, look up the dictionary back to values, restore bytes with base91, then raw inflate.\n\n" +
      "Browser deflate can't set a compression level, so bytes differ slightly from the Python original, but decompression is interoperable.",
    usage: "Encode: enter text, output a 「熊曰：呕…」 bear-speak string. Decode: paste that string to recover.",
    examples: [
      { in: "hi", out: "熊曰：呕… (bear-speak characters)", desc: "Fixed prefix; body is compressed + base91" },
    ],
    tips: ["A leading 「熊曰：呕」 plus a run of characters like 「食性很雜哞嗄哈」 means XiongYue.", "「呕」 is the header marker and must be the first character after the prefix; missing it throws 「缺失标头」 (missing header)."],
    aka: ["熊曰", "xiongyue", "熊曰编码", "熊语", "随波逐流熊曰", "zbXiongYue", "xiong yue",
      "熊语编码", "base91熊曰", "熊曰密码", "呕编码", "熊曰：呕", "熊话编码",
      "bear-speak encoding"],
  },

 // ============ stego ============
  dctWatermark: {
    what: "DCT blind watermark: embeds text into an image's DCT frequency domain, virtually invisible to the eye; extraction needs no original image (truly blind). A common CTF blind-watermark challenge type.",
    principle:
      "Apply a 2D $DCT\\text{-}II$ (discrete cosine transform) in 8×8 blocks, taking each block into the frequency domain.\n\n" +
      "Embed bits with QIM (quantization index modulation): quantize a mid-frequency coefficient into an odd/even bin — $q=\\text{round}(F/Q)$, adjust q's parity to match the bit to embed, $F'=q\\cdot Q$; extraction is $b=\\text{round}(F'/Q) \\bmod 2$. By default the same bit is redundantly embedded across 4 mid-frequency coefficients with $u+v=5$, and extraction uses majority voting to resist IDCT rounding noise.\n\n" +
      "payload = 32-bit length header + UTF-8 bytes. Mid-frequency coefficients avoid the DC term (visible artifacts) and high frequencies (fragile). Extraction must use the same strength Q and channel as embedding.",
    usage: "Embed direction: give an image + text, output a watermarked PNG. Extract direction: give only the image, output text. Params: strength Q (16-40, higher = more robust but more visible), embed channel (default B). Extraction must match the embedding Q/channel.",
    examples: [
      { in: "a PNG + text flag{...}", param: "Q=24, channel=B", out: "watermarked PNG", desc: "Embed direction" },
    ],
    tips: ["When extracting, the strength Q and channel must exactly match embedding, or you read garbage.", "This tool extracts what it embeds, but is not interoperable with the DWT-DCT-SVD scheme of Python's blind_watermark library."],
    aka: ["dct盲水印", "盲水印", "blind watermark", "dct watermark", "频域水印", "qim水印",
      "数字水印", "图片盲水印", "dct隐写", "量化水印", "watermark", "离散余弦水印"],
  },

  bmpPalette: {
    what: "BMP palette steganalysis: specifically checks for data hidden in a BMP's palette rather than its pixels; a frequent image-forensics challenge. Analyze only, never modifies the file.",
    principle:
      "8/4/1-bit indexed BMPs have a palette (each entry is 4 bytes B,G,R,A); pixels store only index numbers, and colors come from palette lookups. Data is often hidden in the palette.\n\n" +
      "This op parses the BMP header + dumps the palette, and runs several stego candidates:\n" +
      "1. Palette LSB: assemble a bit stream from the low bit of each entry's B/G/R (A optional) → ASCII (MSB/LSB assembly)\n" +
      "2. Index order: a normal palette is ordered by luminance; non-monotonic order suggests scrambled ordering that may encode data\n" +
      "3. Adjacent-entry difference LSB: the low bit of the component difference between adjacent entries\n" +
      "4. Unused indices: when pixels use only a few indices, unused palette entries often hide data on their own\n" +
      "Matches of patterns like flag{}/ctf{} are highlighted in a summary.",
    usage: "Drop in a BMP file, or paste hex/base64. You can tune the LSB extraction channel order (default bgr) and dump count. Output is an ASCII preview per candidate + flag hits. Analyze only.",
    examples: [
      { in: "(hex/base64 of an 8-bit indexed BMP)", param: "lsbChannels=bgr", out: "header info + palette dump + each stego candidate + flag hits" },
    ],
    tips: ["When every pixel uses the same index, the real data is almost certainly in the palette itself — focus on candidates 1 and 3.", "BMP palette storage order is B,G,R,A; channel order affects LSB assembly, so if it won't decode, change lsbChannels."],
    aka: ["bmp调色板隐写", "bmp palette", "调色板隐写", "palette lsb", "bmp隐写", "调色板lsb",
      "索引bmp隐写", "bmp取证", "调色板分析", "bmp color table", "palette steganography", "位图调色板隐写"],
  },

  f5stego: {
    what: "F5 JPEG stego extraction: pulls a hidden byte stream out of an F5-steganographic JPEG using a key. A faithful port of the f5stegojs library; extract only, no embedding.",
    principle:
      "F5 hides data in a JPEG's DCT coefficients (skipping DC coefficients). Extraction flow:\n\n" +
      "1. Entropy-decode the JPEG to get each component's DCT coefficients (take the luminance component Y)\n" +
      "2. Use the key with an RC4-variant PRNG to generate a pseudorandom stream, then Fisher-Yates permute the coefficient order\n" +
      "3. First extract 4 bits to fix the matrix-encoding parameter k, then extract hashes per the $(1, 2^k-1, k)$ matrix encoding → byte stream, XORing gamma (keystream) throughout\n" +
      "4. Take the real payload per a 2/3-byte length header\n\n" +
      "The key is the seed of the F5 PRNG (f5stegojs commonly uses an integer byte array like 1,2,3,4,5,6,7, but also supports a passphrase/hex). With a wrong key or a non-f5stegojs sample, the output is noise and the length header will look absurd.",
    usage: "Drop in a JPEG (or paste hex/base64), enter the key. Key format options: auto / integer list / passphrase text / hex. Output is the hidden bytes as hex + ASCII + UTF-8 + F5 capacity diagnostics + flag hits. Extract only.",
    examples: [
      { in: "(an F5-steganographic JPEG)", param: "key=1,2,3,4,5,6,7 keyFormat=ints", out: "extracted byte stream hex/ASCII + diagnostics" },
    ],
    tips: ["Both the key and keyFormat must match; a common f5stegojs form is an integer list like 1,2,3,4,5,6,7.", "Failed extraction or an absurd length header usually means a wrong key, or that the JPEG is original Java F5 (which derives from a passphrase differently and this op doesn't handle)."],
    aka: ["f5隐写", "f5 jpeg", "f5stego", "f5stegojs", "jpeg隐写提取", "f5 steganography",
      "dct系数隐写", "f5提取", "jpeg dct隐写", "f5 extract", "矩阵编码隐写", "F5隐写"],
  },

  spectrogram: {
    what: "Audio spectrogram (STFT): turns a WAV into a spectrogram PNG so you can see a flag/text painted into the audio frequency domain with your eyes — no Audacity needed. A CTF audio-stego killer.",
    principle:
      "Standard short-time Fourier transform (STFT):\n\n" +
      "1. Parse the WAV and take mono PCM\n" +
      "2. Slide a window of length fftSize (hop = fftSize/2, half overlap), applying a Hann window per frame to suppress spectral leakage\n" +
      "3. Radix-2 Cooley-Tukey FFT per frame → magnitude spectrum, take the first fftSize/2 bins (within Nyquist)\n" +
      "4. Convert magnitude to dB ($20\\log_{10}$), normalize by dynamic range → magma colormap → pixels\n" +
      "5. Hand-written PNG encoder, x = time frame, y = frequency (low frequencies at bottom), output a dataURL\n\n" +
      "Challenge authors often paint text in the frequency domain; ordinary playback won't reveal it, but the spectrogram will.",
    usage: "Drop in a WAV (or paste hex/base64/dataURL), pick FFT frame length (default 1024), channel, and dynamic-range floor dbFloor. Output is a spectrogram PNG dataURL + a parameter summary. Analyze only.",
    examples: [
      { in: "(a WAV with hidden text)", param: "fftSize=1024", out: "spectrogram PNG (you can see the hidden text)" },
    ],
    tips: ["Frequency-domain hidden text is usually bright text/waveforms spanning several frames — just read it by eye.", "If it's unclear, adjust dbFloor (smaller = keeps only strong signals for stronger contrast); if high-frequency detail is lost, increase the FFT frame length."],
    aka: ["频谱图", "spectrogram", "stft", "音频频谱", "短时傅里叶", "声谱图",
      "音频隐写频谱", "audio spectrogram", "频谱分析", "fft频谱", "sonic visualiser", "频域藏字"],
  },

 // ============ hash ============
  bcrypt: {
    what: "Bcrypt: OpenBSD's password hashing algorithm, based on Blowfish and deliberately slow (tunable cost iterations), resistant to brute force. Can both generate and verify.",
    principle:
      "The core is EksBlowfishSetup (an expensive key schedule):\n\n" +
      "1. Initialize Blowfish state (π constants) → ExpandKey with salt + password\n" +
      "2. Loop $2^{cost}$ times: alternate ExpandKey(0, password) and ExpandKey(0, salt) — higher cost is slower\n" +
      "3. Repeatedly encrypt the magic string `OrpheanBeholderScryDoubt` (24 bytes) for 64 rounds\n" +
      "4. Take the first 23 bytes of ciphertext and encode with bcrypt-variant Radix-64 (alphabet `./A-Za-z0-9`)\n\n" +
      "Output is the standard modular crypt format: `$2b$<cost>$<22-char salt><31-char hash>`. bcrypt only considers the first 72 bytes of the password (including trailing NUL).",
    usage: "Generate mode: enter password, set cost (4-31, default 10), salt (blank = random), version prefix ($2b$/$2a$/$2y$). Verify mode: enter password + the $2b$... string to check, output match/no-match.",
    examples: [
      { in: "password", param: "mode=hash cost=10", out: "$2b$10$... (60 chars)", desc: "Differs each time with a random salt" },
    ],
    tips: ["A string starting with `$2a$`/`$2b$`/`$2y$` and totaling 60 characters is a bcrypt hash.", "Each +1 to cost doubles the work; the part of the password past 72 bytes is ignored — that's standard behavior, not a bug."],
    aka: ["bcrypt", "Bcrypt", "布洛菲什哈希", "口令哈希", "密码哈希", "blowfish hash", "eksblowfish",
      "$2b$", "$2a$", "openbsd哈希", "bcrypt校验", "password hashing", "慢哈希"],
  },

  lmHash: {
    what: "LM Hash: the early Windows (LAN Manager) password hash — fragile by design and trivially cracked, a common pentesting target.",
    principle:
      "Steps:\n\n" +
      "1. Uppercase the password, truncate/pad with zeros to 14 bytes\n" +
      "2. Split into two 7-byte halves, each expanded into an 8-byte DES key (7 data bits + 1 parity bit per byte)\n" +
      "3. DES-ECB encrypt the fixed plaintext `KGS!@#$%` with each of the two keys\n" +
      "4. Concatenate the two 8-byte ciphertexts into 16 bytes, output as uppercase hex\n\n" +
      "Fatal weaknesses: forced-uppercase password (shrinks the space), independent 7-byte processing (the two halves can be brute-forced separately), and no salt. So LM Hash cracks almost instantly.",
    usage: "Enter a password, directly output the 32-char uppercase hex LM Hash. One-way.",
    examples: [
      { in: "password", out: "E52CAC67419A9A224A3B108F3FA6CB6D", desc: "Password is uppercased before hashing" },
    ],
    tips: ["The LM Hash of an empty password is fixed at `AAD3B435B51404EEAAD3B435B51404EE`; seeing it means that half is empty.", "Because of the independent halves and forced uppercasing, LM Hash is one of the easiest password hashes to crack in history; modern systems have retired it."],
    aka: ["lm hash", "lmhash", "LM Hash", "lan manager hash", "windows lm", "局域网管理器哈希",
      "lm哈希", "des口令哈希", "KGS!@#$%", "lanman", "windows口令哈希", "LM散列"],
  },

  evpBytesToKey: {
    what: "EVP_BytesToKey: OpenSSL's old algorithm for deriving key and IV from a passphrase — exactly what `openssl enc -k` uses. In CTF, OpenSSL-encrypted ciphertext often needs it to recover the key.",
    principle:
      "Iterative hash concatenation:\n\n" +
      "$D_1 = \\text{Hash}(pass \\| salt)$, $D_i = \\text{Hash}(D_{i-1} \\| pass \\| salt)$.\n\n" +
      "When count > 1, each block is hashed count-1 more times. Concatenate $D_1, D_2, \\dots$ to length ≥ keyLen + ivLen; the first keyLen bytes are the key, the next ivLen bytes are the IV.\n\n" +
      "Default hash is MD5 with count=1, OpenSSL's historical default (now discouraged, but a huge amount of old ciphertext still uses it).",
    usage: "Enter a passphrase, fill in salt (8-byte hex, may be empty), key byte count (e.g. 32 for AES-256), iv byte count (16 for CBC), iteration count (default 1), and hash (MD5/SHA-1/SHA-256). Output Key and IV as hex.",
    examples: [
      { in: "password", param: "keyLen=32 ivLen=16 hash=md5", out: "Key: ...\nIV:  ...", desc: "Derivation parameters for AES-256-CBC" },
    ],
    tips: ["When OpenSSL ciphertext starts with `Salted__`, the following 8 bytes are the salt — fill it in with the passphrase to recover key/iv.", "Default is MD5 + count=1; if it doesn't match, try SHA-256 or adjust the iteration count."],
    aka: ["evpbytestokey", "evp_bytes_to_key", "EVP_BytesToKey", "openssl密钥派生", "openssl kdf", "openssl enc",
      "口令派生key", "evp派生", "openssl口令派生", "salted__", "密钥派生函数", "bytestokey"],
  },

 // ============ base ============
  dxBase64: {
    what: "DXBase64: a Base64 variant by Feng Zhi Xia Xiang (thread-2058510) with a CRC16 checksum, different ciphertext each time, and no key (for anti-censorship).",
    principle:
      "Encode: UTF-8 the plaintext → raw deflate → generate a 2-byte random salt, XOR the compressed data cyclically (byte i XOR salt[i%2]) → compute a CRC16 checksum (init 0xFFFF, polynomial 0x1021) → frame `[crcHi, crcLo, salt0, salt1, ...xored data]` → standard Base64.\n\n" +
      "Decode: Base64 unframe → CRC16 check (mismatch errors out immediately) → restore with cyclic salt XOR → raw inflate.\n\n" +
      "The random salt makes the same plaintext yield different ciphertext each time (defeats fingerprinting/censorship), CRC16 guarantees integrity, and there's no key anywhere.",
    usage: "Encode: enter text, output a checksummed Base64 string (differs each time). Decode: paste that string; it's only restored if the CRC16 check passes.",
    examples: [
      { in: "hello", out: "(a standard Base64 string, differs each time)", desc: "Contains a random salt" },
    ],
    tips: ["Looks like ordinary Base64 but the same text encodes differently each time and self-verifies — most likely DXBase64.", "A CRC16 mismatch throws 「数据校验失败」 (data check failed), meaning the ciphertext was altered or it isn't DXBase64."],
    aka: ["dxbase64", "DXBase64", "dx base64", "风之暇想base64", "校验base64", "crc16 base64",
      "带校验base64", "防和谐base64", "随机盐base64", "dxb64", "base64变体", "风之暇想编码"],
  },

 // ============ classic ============
  alberti: {
    what: "Alberti cipher disk: invented by Alberti in 1467, the ancestor of polyalphabetic substitution. Two concentric disks (outer plaintext, inner ciphertext); turning the inner disk switches to a new substitution table.",
    principle:
      "The outer disk is engraved with the standard 26 letters A-Z; the inner disk with a mixed 26-letter cipher alphabet.\n\n" +
      "Encrypt: locate a letter's index i on the outer disk → take the inner disk's $[(i + shift) \\bmod 26]$; decrypt reverses. Every period letters, the accumulated offset $shift \\mathrel{+}= periodicShift$ — this is 「turning the inner disk」, mapping the same plaintext letter to different ciphertext at different positions, i.e. polyalphabetic substitution. With periodicShift=0 it degenerates to monoalphabetic.",
    usage: "Params: inner disk mixed 26-letter alphabet (default QWERTZUIOPASDFGHJKLYXCVBNM), initial offset, periodic rotation step (0 = monoalphabetic), and how many letters per rotation. Non-letters pass through unchanged.",
    examples: [
      { in: "HELLO", param: "default inner disk, shift=0, rotation=0", out: "result of monoalphabetic substitution by the inner disk", desc: "rotation=0 means monoalphabetic" },
    ],
    tips: ["Alberti is the grandfather of polyalphabetic substitution, decades before Vigenère; disk rotation is table-switching.", "Set rotation step to 0 and it becomes a simple substitution cipher; set it and you get polyalphabetic strength."],
    aka: ["alberti", "阿尔伯蒂圆盘", "alberti cipher", "圆盘密码", "阿尔伯蒂密码", "cipher disk",
      "多表替换鼻祖", "alberti disk", "同心圆盘密码", "阿尔贝蒂", "圆盘替换", "阿尔伯蒂圆盘密码"],
  },

  gematria: {
    what: "Gematria numeric cipher: substitutes letters for numbers by fixed tables, outputting a string of numbers. Includes multiple systems: English, Hebrew, Greek, etc.",
    principle:
      "This op uses a 「per-letter numeric sequence」 to stay reversible, optionally appending each word's total sum Σ at line end. Included systems:\n\n" +
      "- English Ordinal: A=1…Z=26\n" +
      "- Pythagorean digital root: 1-9 cycle (A=1…I=9, J=1…R=9, S=1…Z=8)\n" +
      "- English/Simple ×6: Ordinal×6, A=6…Z=156\n" +
      "- Reverse Ordinal: A=26…Z=1\n" +
      "- Hebrew Mispar Hechrachi: א=1…ת=400\n" +
      "- Greek Isopsephy: α=1…ω=800\n\n" +
      "One-to-one systems are fully reversible; the digital root is many-to-one (1←a|j|s), so decoding gives a candidate set like (a|j|s).",
    usage: "Pick a system and whether to append the sum Σ. Encode: text → number sequence (spaces separate within a word, / separates words, line end may carry Σ=). Decode: number string → letters (digital-root systems mark multiple-solution candidates).",
    examples: [
      { in: "hi", param: "mode=ordinal", out: "8 9  |  Σ=17", desc: "h=8 i=9, sum 17" },
    ],
    tips: ["Gematria is often tied to number puzzles/religious texts; a 「letter=number」 summation clue points to it.", "Digital-root (reduction) systems aren't uniquely reversible, so decoding gives multiple solutions like (a|j|s)."],
    aka: ["gematria", "Gematria", "数值密码", "字母数值", "isopsephy", "希伯来数值", "希腊数值",
      "字母求和", "ordinal gematria", "gematria计算", "数字命理", "字母转数字", "gematria数值"],
  },

  nihilistCipher: {
    what: "Nihilist cipher: used by the Russian Narodnaya Volya in the 1880s — a Polybius square + keyword addition. Ciphertext is a string of numbers.",
    principle:
      "1. Build a 5×5 Polybius square from the square keyword (fill in the deduplicated keyword, merge I/J, complete the rest in order)\n" +
      "2. Each plaintext letter → its row+column in the square, coded as a two-digit number (e.g. R=11, A=12)\n" +
      "3. The encryption key is likewise coded into a number sequence via the square, used cyclically\n" +
      "4. Ciphertext = plaintext numbers + key numbers (integer addition, independent per position, no carry)\n\n" +
      "Because it's integer addition, ciphertext may be three digits (e.g. 55+51=106). Decrypt: subtract the key numbers from the ciphertext numbers, recover the row/column, and look up the square.",
    usage: "Fill in the square keyword (builds the Polybius square) and the encryption key. Encode outputs a space-separated number string. Decode accepts numbers separated by spaces/commas/ideographic commas. J merges into I.",
    examples: [
      { in: "dynamitewinterpalace", param: "keyword=zebras key=russian", out: "37 106 62 36 67 ...", desc: "Wikipedia's official vector" },
    ],
    tips: ["Ciphertext is a string of numbers around 20-110 (possibly three-digit) needing two keywords — most likely Nihilist.", "The square merges I/J, so treat plaintext J as I."],
    aka: ["nihilist", "nihilist cipher", "虚无主义者密码", "尼希利斯特", "波利比乌斯加数", "俄国虚无党密码",
      "nihilist密码", "polybius加数", "虚无党密码", "尼希利斯特密码", "民意党密码", "nihilistcipher"],
  },

  solitaire: {
    what: "Solitaire playing-card stream cipher (aka Pontifex): a hand cipher designed by Bruce Schneier and featured in Cryptonomicon, using a 54-card deck to generate a keystream.",
    principle:
      "54 cards: 1-52 regular cards, 53 = big joker (A), 54 = little joker (B). Before each keystream value, the deck evolves in four steps:\n\n" +
      "1. Move the big joker down 1\n2. Move the little joker down 2\n3. Triple cut: swap the top and bottom sections bounded by the two jokers\n4. Count cut: move a number of top cards equal to the bottom card's value to just above the bottom card\n\n" +
      "Then read the top card value n, take the (n+1)-th card's value as the keystream (jokers are skipped and the step reruns), mapped to 1-26. Encrypt: plaintext letter(1-26) + keystream mod 26; decrypt: subtract. A keyword can pre-arrange the deck.",
    usage: "Optionally enter a keyword key (pre-arranges the deck; blank uses the default order). Encode/decode process only letters, ignoring non-letters.",
    examples: [
      { in: "AAAAAAAAAA", param: "keyword blank", out: "EXKYIZSGEH", desc: "Schneier's official vector" },
    ],
    tips: ["A classic hand cipher; challenges often mention playing cards, jokers, or Cryptonomicon.", "The keyword only affects the initial deck order; the same keyword and length give the same keystream, so you can cross-check."],
    aka: ["solitaire", "pontifex", "扑克密码", "纸牌密码", "solitaire cipher", "施奈尔密码",
      "扑克流密码", "纸牌流密码", "solitaire扑克", "cryptonomicon密码", "手工流密码", "54张牌密码"],
  },

  foursquarekw: {
    what: "Four-square cipher (keyword version): a digraph substitution cipher in the Playfair family, using two keywords to build cipher squares plus two standard plaintext squares — four 5×5 squares total.",
    principle:
      "The four squares are laid out 2×2: top-left and bottom-right are standard plaintext squares; top-right (keyword1) and bottom-left (keyword2) are cipher squares.\n\n" +
      "Encrypt a digraph (a,b): locate a in the top-left plaintext square at (r1,c1), and b in the bottom-right plaintext square at (r2,c2); cipher1 = top-right square[r1][c2], cipher2 = bottom-left square[r2][c1]. Decrypt reverses.\n\n" +
      "Alphabet convention: a 5×5 holds only 25 letters, so choose 「merge I/J (drop J)」 or 「omit Q」. Wikipedia's official vector requires omit-Q to reproduce. Odd-length plaintext is padded with X.",
    usage: "Fill in keyword1 (top-right cipher square), keyword2 (bottom-left cipher square), and the alphabet convention (merge I/J or omit Q). Bidirectional.",
    examples: [
      { in: "helpmeobiwankenobi", param: "key1=EXAMPLE key2=KEYWORD alphabet=noq", out: "FYGMKYHOBXMFKKKIMD", desc: "Wikipedia's official vector" },
    ],
    tips: ["Four-square is stronger than Playfair because it uses two independent cipher squares, so the same plaintext digraph can map to different ciphertext.", "To reproduce Wikipedia's official example you must choose the omit-Q alphabet convention."],
    aka: ["four-square", "foursquare", "四方密码", "four square cipher", "foursquarekw", "四方形密码",
      "四方关键词", "四格密码", "four-square cipher", "双字母替换四方", "playfair家族四方", "4方密码"],
  },

  twosquare: {
    what: "Two-square cipher (aka double Playfair): two keyword squares, arranged horizontally or vertically, doing digraph substitution. It's a reciprocal cipher (encode and decode are the same operation).",
    principle:
      "Two 5×5 squares generated from keywords, arranged horizontally (left | right) or vertically (top / bottom).\n\n" +
      "Vertical: a in the top square (r1,c1), b in the bottom square (r2,c2). Same column (c1==c2) outputs a,b unchanged; otherwise out1=top[r1][c2], out2=bottom[r2][c1].\n\n" +
      "Horizontal: a in the left square, b in the right square. Same row outputs unchanged; otherwise take letters crosswise.\n\n" +
      "Because the transform is symmetric, encode and decode are the same function — reciprocal. The alphabet can merge I/J or omit Q; odd-length plaintext is padded with X.",
    usage: "Fill in keyword1, keyword2, arrangement direction (vertical/horizontal), and alphabet convention. Encode and decode are the same operation (reciprocal).",
    examples: [
      { in: "HELP", param: "key1=EXAMPLE key2=KEYWORD vertical", out: "digraph substitution result", desc: "Run it again to recover" },
    ],
    tips: ["Reciprocal: under the same params, encoding a result again returns the original, so if unsure of direction just run it again.", "Vertical same-column / horizontal same-row letter pairs pass through unchanged — an inherent property of Two-square."],
    aka: ["two-square", "twosquare", "双方密码", "two square cipher", "double playfair", "双方形密码",
      "双格密码", "two-square cipher", "双方关键词", "自反双字母密码", "双四方密码", "2方密码"],
  },

 // ============ radix ============
  bech32: {
    what: "Bech32 encoding (BIP173): the encoding for Bitcoin SegWit addresses — HRP prefix + data + BCH checksum, able to detect typos.",
    principle:
      "Structure: `HRP + '1' + data + 6-char checksum`. HRP is the human-readable prefix (e.g. `bc` mainnet, `tb` testnet).\n\n" +
      "The data part: convert the 8-bit byte stream into 5-bit groups ($8 \\to 5$-bit packing), then represent with the 32-char alphabet `qpzry9x8gf...` (excluding the confusable 1/b/i/o).\n\n" +
      "The checksum is a BCH code with the polynomial per BIP173, able to locate and detect a small number of character errors. The separator is fixed as `1` (so the data alphabet excludes 1).",
    usage: "Encode: enter a hex payload, fill in HRP (default bc), output a bech32 address. Decode: paste a bech32 string; after the checksum passes, output the hrp and payload hex.",
    examples: [
      { in: "751e76e8199196d454941c45d1b3a323f1433bd6", param: "hrp=bc", out: "bc1... (bech32 string)", desc: "20-byte payload" },
    ],
    tips: ["Lowercase, starting with `bc1`/`tb1`, containing only `qpzry9x8gf2tvdw0s3jn54khce6mua7l` characters is Bech32.", "A failing checksum means the address is mistyped or corrupted — exactly what Bech32 is designed to catch."],
    aka: ["bech32", "Bech32", "bip173", "比特币地址编码", "segwit地址", "bch校验编码", "bech32编码",
      "比特币bech32", "bip-173", "segwit address", "hrp编码", "闪电网络地址编码"],
  },

  uuidParse: {
    what: "UUID parse: breaks a UUID apart to show version and variant; v1 also reveals a timestamp and MAC address, and v7 reveals a Unix millisecond time. RFC 4122.",
    principle:
      "A UUID is 128 bits (32 hex, format 8-4-4-4-12). Structure: time_low(32) - time_mid(16) - time_hi_and_version(16) - clock_seq(16) - node(48).\n\n" +
      "Version = the high 4 bits of time_hi_and_version; variant = the high bits of clock_seq_hi.\n\n" +
      "- v1: 60-bit timestamp (100ns intervals since 1582-10-15) + 48-bit MAC address — can leak generation time and NIC\n" +
      "- v4: random (except version/variant bits)\n" +
      "- v3/v5: MD5/SHA-1 hash of namespace+name (not reversible)\n" +
      "- v7: the first 48 bits are a Unix millisecond timestamp",
    usage: "Enter a UUID (with or without hyphens), output version, variant, plus v1's timestamp/MAC/clock sequence and v7's timestamp. One-way parse.",
    examples: [
      { in: "550e8400-e29b-41d4-a716-446655440000", out: "Version: v4 (random)\nVariant: RFC 4122...", desc: "v4 UUID" },
    ],
    tips: ["UUID v1 leaks generation time and MAC address; CTF often uses it to infer information.", "The version number is the 13th hex character (first of the third group), so you can spot v1/v4/v7 at a glance."],
    aka: ["uuid", "uuidparse", "uuid解析", "guid", "rfc4122", "通用唯一标识符", "uuid parser",
      "uuid版本", "uuid v1", "uuid v4", "guid解析", "唯一标识符解析"],
  },

  varint: {
    what: "VarInt (LEB128): Protobuf's variable-length integer encoding; small integers take fewer bytes. Supports unsigned and ZigZag signed. Uses BigInt for large numbers.",
    principle:
      "Unsigned LEB128 (ULEB128): each byte's high bit is the continuation flag (1 = more follows, 0 = end), the low 7 bits are data, little-endian (low byte first).\n\n" +
      "Signed uses ZigZag before ULEB128: $n \\to (n \\ll 1) \\oplus (n \\gg 63)$, mapping small negatives to small positives (0→0, -1→1, 1→2, -2→3…) to avoid negatives becoming a long byte run.\n\n" +
      "Decode reverses: first ULEB128 unpacks bytes, then signed ZigZag restores.",
    usage: "Encode: enter a decimal integer, tick whether it's ZigZag signed, output hex bytes. Decode: enter hex, restore the integer with the same signed setting.",
    examples: [
      { in: "300", param: "signed=false", out: "ac02", desc: "300 = 0xAC 0x02 (little-endian 7-bit groups)" },
      { in: "-1", param: "signed=true", out: "01", desc: "ZigZag: -1→1→single byte 01" },
    ],
    tips: ["Protobuf's wire format encodes all integer fields with LEB128, so reversing protobuf messages often needs it.", "A negative without ZigZag errors out (unsigned doesn't support negatives); the signed setting on decode must match encoding."],
    aka: ["varint", "leb128", "LEB128", "变长整数", "protobuf整数", "uleb128", "zigzag编码",
      "protobuf varint", "变长编码", "变长int", "变长整型", "protobuf变长整数"],
  },

  primeGen: {
    what: "Large prime generation: uses the Miller-Rabin primality test to generate large primes of a given bit length, with a cryptographically secure CSPRNG as the random source. Common for RSA challenge-crafting.",
    principle:
      "Miller-Rabin probabilistic primality test (deterministic version): write $n-1 = d \\cdot 2^r$, and for each witness a, check whether $a^d \\bmod n$ is 1 or $n-1$, or whether $n-1$ appears in the squaring sequence.\n\n" +
      "For $n < 3.3 \\times 10^{24}$, the first 13 primes (2,3,5,…,41) as witnesses give a deterministic verdict; for larger n the same 13 witnesses give a misjudgment probability $< 4^{-13}$, plenty for CTF.\n\n" +
      "Generate: crypto.getRandomValues makes a random odd number (top and bottom bits set to 1) → Miller-Rabin test; on failure, +2 and retry until a prime is found.",
    usage: "Fill in bit length (2-1024) and count, output the corresponding decimal primes (one per line). Input text is ignored.",
    examples: [
      { in: "(ignored)", param: "bits=64 count=1", out: "a 64-bit decimal prime (differs each time)", desc: "Randomly generated" },
    ],
    tips: ["RSA challenge-crafting needs two large primes p, q — this generates them directly.", "The random source is the crypto CSPRNG, not Math.random, so it's suitable for cryptographic use."],
    aka: ["素数生成", "primegen", "大素数生成", "miller-rabin", "米勒拉宾", "prime generator", "素性检验",
      "质数生成", "随机素数", "miller rabin", "素数生成器", "prime gen", "rsa素数"],
  },

  randomSeed: {
    what: "Random seed generation: uses a cryptographically secure CSPRNG (crypto.getRandomValues) to generate random bytes, output as hex or base64.",
    principle:
      "Calls crypto.getRandomValues to fill a byte array of the given length — this is the browser/Node cryptographically secure pseudorandom number generator (CSPRNG), not the predictable Math.random.\n\n" +
      "After generating, output in the chosen format: hex (two hex digits per byte) or base64. Suitable for a key, IV, salt, nonce, or random token.",
    usage: "Fill in byte count (1-4096) and output format (hex/base64), output a random string. Input text is ignored.",
    examples: [
      { in: "(ignored)", param: "length=16 format=hex", out: "a 32-char hex random string (differs each time)", desc: "16 random bytes" },
    ],
    tips: ["Use it when you need a key/IV/salt/nonce; don't use Math.random (predictable, insecure).", "16 bytes = 128 bits, 32 bytes = 256 bits; pick the length by purpose."],
    aka: ["随机种子", "randomseed", "随机字节", "csprng", "random seed", "随机数生成", "安全随机",
      "随机密钥", "getrandomvalues", "随机种子生成", "random bytes", "密码学随机", "随机token"],
  },
};
