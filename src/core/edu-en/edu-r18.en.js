/*
 * edu-r18.en.js — English edu cards for the 4 R18 ops (candidates, not wired).
 * Source: edu-r18.js (Chinese), translated 1:1. Example vectors and formulas are
 * copied verbatim; only prose is translated. Aka lists keep every Chinese alias
 * and add English ones. All samples come from real runs (R6/R8/R10/R18 verify).
 *
 * M merge: copy to src/core/edu-en/edu-r18.en.js, import it in eduContent.en.js,
 * and add it to the registerEduEn({...}) object.
 */
export default {
  // ==================== LSB deep scan ====================
  lsbDeep: {
    what:
      "LSB deep scan (lsbDeep) brute-forces the least-significant bits of PNG/BMP pixels across " +
      "\"channel combination × bit plane × row/column order × MSB/LSB bit order × starting offset\" and " +
      "picks the candidates that look most like hidden text or a flag. Unlike a basic LSB extractor it does " +
      "not stop at bit0 and row-major order: column-major, MSB-first and 1..7 starting-bit offsets all take part.",
    principle:
      "**Bit planes**: each channel of a true-colour image is one byte; bit0 is the least-significant bit (LSB) " +
      "and bit7 the most-significant. LSB steganography usually edits bit0, but a challenge author may use " +
      "bit1..bit7, or interleave several channels.\n\n" +
      "**Combination sweep**: the tool covers channels `r/g/b/a/rgb/bgr/rgba/bgra` × bit planes 0..7 × " +
      "row/column order × MSB-first/LSB-first byte packing × starting offset 0..7 — 8×8×2×2×8 = 2048 " +
      "combinations by default. Each combination first samples a 768-byte probe prefix (384 bytes on large " +
      "images), scores printable/ASCII ratio, letter ratio, longest readable run and flag/Base64/URL shape, " +
      "then re-samples 8192 bytes for the top candidates before the final ranking.\n\n" +
      "**Why offsets matter**: some challenges do not start at the first pixel but skip 1..7 bits; looking " +
      "only at offset=0 misses them.\n\n" +
      "**Ranking**: a flag hit adds 1000 points and moves the candidate to the front; Base64/URL shape comes " +
      "next; readability score last. Constant-colour, periodic and low-diversity filler is discarded as noise, " +
      "so a solid-colour image does not flood the result list.",
    usage:
      "Drag a PNG/BMP into the input box (this op accepts raw bytes only, not pasted text) and press Decode.\n\n" +
      "Parameters: `channels` (all or b,r,g,a,rgb,bgr,rgba,bgra), `bits` (all / 0-7 / 0,1,2), " +
      "`orders` (msb,lsb), `scans` (row,col), `offsets` (0-7), `limit` (returned candidates, default 20), " +
      "`maxPixels` (per-image pixel cap, default 16000000).\n\n" +
      "The report lists flag hits first, then the top candidates with channel/bit/order/scan/offset/score " +
      "and a text snippet. To reproduce one candidate exactly, set channels/bits/orders/scans/offsets to " +
      "that single combination and run again.",
    examples: [
      {
        in: "资料/软件测试用文件/LSB-AsianCheetah.png (600×450 RGBA PNG)",
        param: "default channels=all, bits=0-7, orders=msb,lsb, scans=row,col, offsets=0-7",
        out: "Top1 = B/bit0 MSB-first row-major off0, score=1225.6, hit SharifCTF{e8e12db2fc654f3b50f3da4901ab986e}",
        desc: "R6 verify_lsbdeep.mjs real run: 2048 combinations, 1216 candidates, flag ranked #1; R18 verify hits it again",
      },
      {
        in: "the same LSB-AsianCheetah.png",
        param: "default parameters",
        out: "scan takes about 157–189 ms and returns 20 candidates (40 when the module default limit=40 is used)",
        desc: "measured performance and limits; >1MP images shorten the probe and reduce candidates, >16MP is rejected",
      },
      {
        in: "4 bytes 01 02 03 04 (not an image)",
        param: "default parameters",
        out: "no valid candidate: input is empty or not image bytes",
        desc: "non-PNG/BMP input fails explicitly instead of passing binary noise off as text",
      },
    ],
    formulas: [
      {
        tex: "b_i = \\left( p_{c,i} \\gg k \\right) \\bmod 2",
        caption: "one LSB extracted from pixel i, channel c, bit plane k",
      },
      {
        tex: "\\text{byte}_j = \\sum_{t=0}^{7} b_{8j+t} \\cdot 2^{7-t}\\quad(\\text{MSB-first})",
        caption: "pack 8 bits into one byte MSB-first; LSB-first reverses the exponent order",
      },
    ],
    tips: [
      "Recognition: an image where changing channel/bit plane in StegSolve reveals text, or a challenge mentioning \"LSB\", \"least significant bit\" or \"zsteg\" — run this full scan instead of clicking every channel by hand.",
      "The most common authoring pattern is B channel, bit0, MSB-first, row-major, offset=0; LSB-AsianCheetah is exactly that combination.",
      "JPEG is lossy: DCT quantisation destroys stable pixel LSBs. This op only supports PNG/BMP; for JPEG use coefficient-domain ops such as jsteg/f5/outguess.",
      "Column-major (col) often differs from row-major on square images; if row-major is all noise, set scans=col and try again.",
      "Offsets 1..7 are cheap and run by default; if you know the payload starts at bit N, set offsets=N to cut the sweep to 1/8.",
      "A flag candidate ranking first is a scoring design, not proof that every other candidate is meaningless; Base64/URL-shaped candidates are worth opening too.",
      "Sources and limits: R6 `verify_lsbdeep.mjs` 45/0; default 16MP pixel cap, 4096 characters per candidate; the difference from zstegScan is column-major, MSB/LSB bit order and 0..7 offsets.",
    ],
    aka: [
      "LSB 深入分析", "LSB 深度扫描", "LSB 全通道扫描", "LSB 位平面分析", "LSB 多偏移扫描",
      "LSB 列优先", "LSB MSB-first", "LSB bit plane scan", "LSB deep scan", "LSB stego analysis",
      "zsteg 替代", "LSB 隐写提取", "最低有效位分析", "逐位平面提取", "LSB 比特序",
      "least significant bit scan", "LSB extraction", "bit-plane stego", "column-major LSB", "MSB-first LSB",
    ],
  },

  // ==================== Raster stego phase split ====================
  rasterStego: {
    what:
      "Raster stego phase split (rasterStego) — a replica of zbRasterTerminator: it splits an image by each " +
      "divisor d of its width/height and by phase into multiple phase images that keep only " +
      "\"x % d == phase\" (or \"y % d == phase\"). Hidden text or patterns often become legible only in one " +
      "phase, while the original image looks normal.",
    principle:
      "**Split rule**: for every divisor d (2..maxDivisor) of width W, generate d images; image phase keeps " +
      "only columns `x % d == phase` and clears the rest; the same applies to height H and rows. The filename " +
      "`x-d-(phase+1).png` uses a 1-based phase in the third segment, while the internal phase field is 0-based.\n\n" +
      "**Divisor order**: replicates the reference Python `output.insert(1, x)`, so the divisors of 600 are " +
      "`[2,10,8,6,5,4,3]` — 2 fixed first, the rest in reverse order, not ascending.\n\n" +
      "**Fill**: when the source has alpha, cleared pixels are transparent by default (alpha=0); otherwise " +
      "they are black. This prevents blank areas from being mistaken for black blocks.\n\n" +
      "**Why it works**: if a challenge writes text at a fixed interval (e.g. every 5th column) into the image, " +
      "the original still looks like a complete picture, but at d=5, phase=0 the retained pixels spell out " +
      "the text and the cleared pixels make it stand out.",
    usage:
      "Drag a PNG/BMP into the input box (raw bytes only) and press Decode.\n\n" +
      "Parameters: `maxDivisor` (2..64, default 10, reference implementation 2..10), `both` (default true, " +
      "split both x/y), `axes` (used when both=false: x,y / x / y), `fillMode` (auto/black/transparent), " +
      "`maxImages` (default 128), `maxPixelsPerImage` (default 8,000,000), `maxTotalPixels` (default 64,000,000).\n\n" +
      "The result lists every phase image with dimensions and returns each PNG as a downloadable file. " +
      "Start from the files with small d and inspect the phase images for text.",
    examples: [
      {
        in: "资料/软件测试用文件/光栅图demo.png (600×300 RGBA PNG)",
        param: "default maxDivisor=10, both=true, fillMode=auto",
        out: "68 images: x axis 38, y axis 30; x-5-1.png exists (axis=x, divisor=5, phase=0)",
        desc: "R10 verify_r10.mjs 49/0 real run; a 5×5 sampling of x-5-1 spells Password is here!",
      },
      {
        in: "the same 光栅图demo.png",
        param: "maxImages=10",
        out: "explicit failure: RASTER_LIMIT_IMAGES, 68 products exceed the limit of 10, no silent truncation",
        desc: "limit semantics: over-limit raises an error with the divisor list instead of returning the first 10 and pretending success",
      },
      {
        in: "2×2 24-bit BMP (R10 synthetic case)",
        param: "default parameters",
        out: "2 x-axis images + 2 y-axis images = 4, all PNG",
        desc: "BMP input uses the same split and PNG encoder; 24-bit BGR order is corrected",
      },
    ],
    formulas: [
      {
        tex: "\\text{keep}_x(x,y) = [x \\bmod d = phase],\\qquad \\text{keep}_y(x,y) = [y \\bmod d = phase]",
        caption: "phase masks for the x/y axes; other pixels are cleared (or made transparent)",
      },
      {
        tex: "\\text{output.insert}(1, d) \\Rightarrow [2, d_{\\max}, \\ldots, d_{\\min}]",
        caption: "replicates the reference Python divisor order: 2 first, the rest reversed",
      },
    ],
    tips: [
      "Recognition: an image that looks normal but has regular stripes, or a challenge mentioning \"raster\", \"phase\" or \"grid\" — try this op first.",
      "The filename `x-5-1.png` means x axis, divisor 5, first phase (0-based phase=0); it is not \"the fifth image\".",
      "Check both axes: text may be written column-wise or row-wise; with both=false only x is scanned by default, so switch to y manually.",
      "With alpha the default fill is transparent; if the output looks all black, compare fillMode=black and fillMode=transparent.",
      "When there are many products, start with small d (2, 3, 5, 10); large d makes the image sparse and text may be only a few columns wide.",
      "Limits are hard: `maxImages` defaults to 128 and `maxTotalPixels` to 64M; exceeding them raises RASTER_LIMIT_* instead of freezing the browser.",
      "Sources and limits: R10 `verify_r10.mjs` 49/0; reference `资料/参考/反编py/zbCrypto/zbCrypto.zbRasterTerminator.py`; pure JS, zero DOM.",
    ],
    aka: [
      "光栅隐写", "光栅图拆图", "zbRasterTerminator", "光栅终止器", "相位拆图",
      "x/y 相位图", "光栅扫描隐写", "栅格隐写", "raster stego", "raster terminator",
      "phase decomposition", "divisor phase images", "光栅图分离", "列/行相位拆图", "栅格拆图",
      "raster phase split", "grid stego", "divisor split", "phase image", "zbRaster",
    ],
  },

  // ==================== MP3Stego decode ====================
  mp3stego: {
    what:
      "MP3Stego decode (mp3stego) — follows the MP3Stego 1.1.19 `-X -P` decode flow and recovers hidden data " +
      "from MPEG-1 Layer III frames using the password: the parity of `part2_3_length` carries one bit, the " +
      "password decides which granule/channel bits participate, and the extracted bytes are 3DES-CBC " +
      "decrypted and gunzipped back into text or a file.",
    principle:
      "**Bit selection**: each Layer III frame's side info carries `part2_3_length`; the encoder writes hidden " +
      "bits into its parity. The decoder uses `SHA1(password)` as the PRNG, taking bits LSB-first from 32-bit " +
      "words; after every 5 words it rehashes `SHA1(hash_words_hostLE || password)`, and after three 0s it drops " +
      "the next 0. The low bit of each selected `part2_3_length` is one hidden-stream bit.\n\n" +
      "**Payload format**: the first 4 bytes of the hidden stream are a little-endian `size_t` payload length " +
      "lData, followed by lData bytes of 3DES-CBC ciphertext (three 8-byte keys from `SHA1(password)` in host " +
      "byte order at offsets 0/6/12, IV=0). After decryption the trailing 3DES padding is removed (last byte of " +
      "the final block = valid byte count rem), then the result is gunzipped.\n\n" +
      "**Failure semantics**: if the 3DES result lacks a gzip header, the password is wrong or no payload was " +
      "embedded; the tool reports an explicit error instead of returning random bytes as plaintext. MPEG-2/2.5 " +
      "LSF frames have a different side-info layout; this implementation only verifies MPEG-1 and reports " +
      "`MP3STEGO_LSF_UNVERIFIED` for LSF, never a fake success.",
    usage:
      "Drag an MP3 into the input box (raw bytes only), enter the encoding password and press Decode.\n\n" +
      "Parameters: `password` (-P passphrase), `extract` (default true; false only extracts the 3DES ciphertext " +
      "without decrypting or gunzipping), `maxPayloadBytes` (default 4 MiB).\n\n" +
      "On success the report shows the plaintext, UTF-8 length and metadata (frames, candidate bits, hidden " +
      "length); with `extract=false` it returns `mp3stego-payload.bin` for further analysis. Wrong/empty " +
      "password, non-MP3 input and LSF frames all produce explicit error codes.",
    examples: [
      {
        in: "资料/工程留存/R10/_assets/a.mp3",
        param: "password=ILOVEYOUYOULOVEME, extract=true",
        out: "flag{1251_521_m1xueb1n9chen9ti@nm1mi} (37-byte plaintext; 233 frames, 931 candidate bits, 64-byte hidden payload)",
        desc: "R10 verify_r10.mjs matches the official mp3stego_Decode.exe oracle byte-for-byte; R18 verify hits it again",
      },
      {
        in: "the same a.mp3",
        param: "password=wrong",
        out: "decode fails (MP3STEGO_BAD_PADDING or MP3STEGO_NOT_GZIP), no plaintext and no files",
        desc: "wrong password fails explicitly; any bad 3DES padding or gzip header stops the decode, never a fake success",
      },
      {
        in: "the same a.mp3",
        param: "password=(empty string)",
        out: "decode fails, the message says the password does not match or no payload is embedded",
        desc: "empty and wrong passwords share the same failure path",
      },
      {
        in: "4 bytes 01 02 03 04",
        param: "password=x",
        out: "MP3STEGO_NOT_MP3: not an MP3 frame stream (missing ID3/0xFFEx sync)",
        desc: "non-MP3 input is rejected before parsing",
      },
    ],
    formulas: [
      {
        tex: "\\text{bit}_t = \\text{part2\\_3\\_length}_{f,g,c} \\bmod 2",
        caption: "parity of the frame/granule/channel part2_3_length selected by the password PRNG",
      },
      {
        tex: "P = \\mathrm{3DES\\text{-}CBC}_{K_1,K_2,K_3}(C),\\qquad M = \\mathrm{gunzip}(P[0:|P|-8+rem])",
        caption: "3DES-CBC decrypt, strip padding using the final byte rem, then gunzip",
      },
    ],
    tips: [
      "Recognition: a challenge supplies an MP3 and mentions \"mp3stego\", \"-X -P\" or audio steganography, or the archive ships an MP3Stego encoder — try this op with the password.",
      "Passwords are case- and space-sensitive; copy long passphrases such as `ILOVEYOUYOULOVEME` verbatim without a trailing newline.",
      "A wrong password usually reports `MP3STEGO_BAD_PADDING` or `MP3STEGO_NOT_GZIP`; `MP3STEGO_LSF_UNVERIFIED` means MPEG-2/2.5 frames, not a password problem.",
      "`extract=false` only returns the encrypted payload; it is useful for confirming whether hidden data exists before trying passwords.",
      "The hidden length lData is capped at 4 MiB; exceeding it reports `MP3STEGO_PAYLOAD_LIMIT` without allocating huge memory.",
      "The layout depends on the encoder's 32-bit size_t and little-endian host order; official 32-bit Windows/Linux builds match, other builds may not.",
      "Sources and limits: R10 `verify_r10.mjs` 49/0 plus the exe oracle; algorithm replicated from MP3Stego 1.1.19 source, no external exe involved.",
    ],
    aka: [
      "MP3Stego", "MP3 隐写", "MP3 隐写解码", "mp3stego -X -P", "MP3Stego 解码",
      "MP3 音频隐写", "MP3 最低有效位", "part2_3_length 隐写", "MP3 steganography",
      "mp3 stego decode", "MP3Stego extract", "MP3 隐藏数据", "音频隐写 MP3",
      "MP3Stego 密码", "mp3stego.exe",
      "MP3 stego", "audio stego MP3", "MP3Stego -P", "part2_3_length parity", "MP3 payload extract",
    ],
  },

  // ==================== EXIF thumbnail extraction ====================
  imageThumb: {
    what:
      "EXIF thumbnail extraction (imageThumb) — finds the embedded thumbnail pointed to by IFD1 in JPEG APP1 " +
      "(EXIF), the 3×W×H raw RGB thumbnail in APP0 (JFIF), and TIFF thumbnails in PNG eXIf chunks. Many " +
      "challenges hide a flag or password in the thumbnail while the main image looks completely normal.",
    principle:
      "**JPEG EXIF**: the APP1 segment starts with `Exif\\0\\0`, followed by a TIFF header (II/MM + 42 + IFD0 " +
      "offset). The next-IFD pointer of IFD0 leads to IFD1; tag `0x0201` is the thumbnail offset and `0x0202` " +
      "its length, so the thumbnail bytes are sliced from the TIFF data using those two values.\n\n" +
      "**JFIF APP0**: the APP0 header carries `Xthumbnail`/`Ythumbnail`, immediately followed by 3×W×H raw RGB " +
      "pixels; the tool re-encodes them as PNG.\n\n" +
      "**PNG eXIf**: the PNG `eXIf` chunk contains a TIFF structure parsed the same way as EXIF.\n\n" +
      "**Boundary**: only these three standard locations are parsed; no arbitrary trailer or inter-chunk " +
      "carving. If no thumbnail exists the tool says so explicitly and never passes the main image or a random " +
      "JPEG fragment off as a thumbnail.",
    usage:
      "Drag a JPEG/PNG into the input box (raw bytes only) and press Decode.\n\n" +
      "Parameters: `maxCount` (maximum returned thumbnails, default 8), `minBytes` (filter thumbnails smaller " +
      "than this, default 0).\n\n" +
      "The result lists each thumbnail's source (EXIF IFD1 / JFIF APP0 / PNG eXIf), MIME, dimensions and byte " +
      "count, and returns the thumbnails as downloadable files; the default name is `image-thumb-1.jpg` and " +
      "`rawFileName` changes the prefix.",
    examples: [
      {
        in: "资料/软件测试用文件/misc22-缩略图.jpg",
        param: "default maxCount=8, minBytes=0",
        out: "1 image: EXIF IFD1 | image/jpeg | 300×50 | 8201 B",
        desc: "R8 verify_thumb.mjs 46/0 and PIL cross-check agree; R18 verify confirms 8201 B again",
      },
      {
        in: "资料/软件测试用文件/014.jpg",
        param: "default parameters",
        out: "no embedded thumbnail: no EXIF/JFIF embedded thumbnail found",
        desc: "with no thumbnail the tool says so explicitly, does not throw and does not fabricate files (R2 regression requirement)",
      },
    ],
    formulas: [
      {
        tex: "\\text{thumb} = \\text{TIFF}[\\text{offset}_{0x0201}:\\text{offset}_{0x0201}+\\text{len}_{0x0202}]",
        caption: "EXIF IFD1 thumbnail offset/length; JPEG thumbnails start with FF D8",
      },
      {
        tex: "\\text{JPEG APP1} = \\text{Exif}\\backslash 0\\backslash 0 \\| \\text{TIFF}(\\text{II/MM}, 42, \\text{IFD0})",
        caption: "APP1 layout; the next-IFD pointer of IFD0 points to IFD1",
      },
    ],
    tips: [
      "Recognition: a challenge mentions \"thumbnail\", \"embedded preview\" or an EXIF image that differs from the main picture — run this op first.",
      "The EXIF thumbnail may show completely different content from the main image (the author only edited the thumbnail); zoom in to read text/flags.",
      "The JFIF APP0 thumbnail is raw RGB, not JPEG; this tool converts it to PNG so the downloaded file opens directly.",
      "Files such as 014.jpg with no IFD1 return \"not found\" explicitly rather than a decode failure; try another file.",
      "Only standard JPEG/PNG thumbnail locations are supported; thumbnails hidden in the file trailer or custom chunks need binwalk/foremost, not this op.",
      "Sources and limits: R8 `verify_thumb.mjs` 46/0; PIL cross-check reports 300×50 / 8201 B for misc22; `014.jpg` has no thumbnail and does not crash.",
    ],
    aka: [
      "EXIF 缩略图", "EXIF 缩略图提取", "内嵌缩略图", "JPEG 缩略图", "IFD1 缩略图",
      "JFIF 缩略图", "PNG eXIf 缩略图", "EXIF thumbnail", "embedded thumbnail",
      "thumbnail extract", "EXIF 预览图", "JPEG APP1 缩略图", "缩略图检测",
      "EXIF 缩略图查看", "EXIF thumbnail recovery",
      "thumbnail preview", "EXIF IFD1", "JFIF thumbnail", "PNG eXIf", "embedded preview extract",
    ],
  },
  stegSolve: {
    "what": "StegSolve workbench: channel/bit-plane switching, LSB data extraction, GIF frame browsing, two-image combining and stereogram solving in one page. Load a PNG/BMP/JPEG/GIF and cycle through 42 pixel transforms, extract bytes by channel/bit/order/scan, and save intermediate images without switching tools.",
    "principle": "**Channel/bit-plane transforms**: 42 operations (bitwise, channel swap, grayscale/invert/XOR, etc.). Text or QR codes often become visible in one channel or bit plane.\n\n**Data Extract**: assemble bytes by channel, bit plane, bit order (MSB/LSB), row/column scan and offset, then show hex/ASCII/UTF-8 for manual LSB verification.\n\n**Frame Browser**: inspect and save individual GIF frames.\n\n**Image Combiner**: combine two images with 13 arithmetic/bitwise modes to expose differences or undo overlays.\n\n**Stereogram Solver**: search disparity offsets and render the hidden depth map.",
    "usage": "Open StegSolve from search or the image-analysis entry, then drop/select an image. Cycle the transform list first; use Data Extract for exact channel/bit/order/scan/offset extraction; use Frame Browser for GIFs, Image Combiner for two images, and Stereogram Solver for autostereograms. Everything runs locally in the browser.",
    "examples": [
      {
        "in": "LSB-AsianCheetah.png (600x450 RGBA PNG)",
        "param": "Data Extract: B channel / bit0 / MSB-first / row / offset=0",
        "out": "SharifCTF{e8e12db2fc654f3b50f3da4901ab986e}",
        "desc": "Same real sample used by R6 verify_lsbdeep.mjs; StegSolve is the manual cross-check."
      },
      {
        "in": "Multi-frame GIF",
        "param": "Frame Browser",
        "out": "Per-frame thumbnails + save; locate text/QR that appears in only one frame.",
        "desc": "Frame order/delay comes from the GIF structure; frames are not re-encoded."
      },
      {
        "in": "Two same-size images",
        "param": "Image Combiner: XOR / 13 modes",
        "out": "Preview/save the combined image to expose differences or overlays.",
        "desc": "Different dimensions are rejected explicitly, never silently rescaled."
      }
    ],
    "formulas": [
      {
        "tex": "b = (p_c \\gg k) \\bmod 2",
        "caption": "bit k of channel c (bit0 = LSB)"
      },
      {
        "tex": "I_{out}(x,y) = I_A(x,y) \\oplus I_B(x,y)",
        "caption": "Image Combiner XOR example"
      }
    ],
    "tips": [
      "Inspect channels/bit planes first; text may only appear in bit0 or bit1 of one channel.",
      "Bit order and row/column scan must match the embedding script; MSB-first and LSB-first differ completely.",
      "JPEG pixel LSBs are destroyed by lossy compression; use jsteg/F5/OutGuess coefficient-domain tools for JPEG.",
      "For GIF challenges, check frame count/delay and save frames individually; inter-frame differences may hold the payload.",
      "For stereograms, estimate a disparity range before searching; a very large range is slow.",
      "All processing is local; save intermediate images and continue with other ops."
    ],
    "aka": [
      "StegSolve",
      "Stegsolve",
      "stegsolve",
      "StegSolve image analysis",
      "image channel analysis",
      "bit plane analysis",
      "LSB manual extract",
      "Data Extract",
      "Frame Browser",
      "GIF frame browser",
      "Image Combiner",
      "image combine",
      "Stereogram Solver",
      "stereogram solve",
      "CTF image stego",
      "channel switch",
      "stego image viewer",
      "stegsolve jar",
      "StegSolve alternative",
      "bitplane viewer"
    ]
  },
  knnClassify: {
    "what": "KNN nearest-neighbour classification: parse a labelled training CSV (A/B) and an unlabelled test CSV, take the k nearest samples by Euclidean/Manhattan distance, and output each test prediction plus counts.",
    "principle": "**Distance**: squared Euclidean or absolute Manhattan over numeric feature columns.\n\n**Vote**: the k nearest training samples vote for A/B; ties follow `tieBreak` (A, B, or error).\n\n**Layout**: the training CSV has an A/B label column; the test CSV has no label. Headers and a UTF-8 BOM are auto-detected.",
    "usage": "Open the KNN op, put the test CSV in the input, paste the training CSV into the parameter, set k/metric/tieBreak, and run. Output lists every prediction plus A/B counts.",
    "examples": [
      {
        "in": "Training: 新能源汽车检测数据.csv; test: 待检测新能源车.csv",
        "param": "k=1, metric=euclidean",
        "out": "336 predictions: A=180 / B=156; flag{e0f095bd-16e6-4bf5-a1c5-3dce1d693aa5}",
        "desc": "Measured in headless Chromium against both real CSVs."
      },
      {
        "in": "k=3, metric=manhattan",
        "param": "tieBreak=error",
        "out": "Vote counts per row; ties raise an explicit error.",
        "desc": "Invalid dimensions, k > training rows, or non-A/B labels also error."
      }
    ],
    "formulas": [
      {
        "tex": "d(x,y)=\\sqrt{\\sum_i (x_i-y_i)^2}",
        "caption": "Euclidean distance"
      },
      {
        "tex": "\\hat{y}=\\arg\\max_{c\\in\\{A,B\\}}\\sum_{j\\in N_k(x)} [y_j=c]",
        "caption": "majority vote of k nearest neighbours"
      }
    ],
    "tips": [
      "Training and test CSVs must have the same feature dimension; the ID column is not a feature.",
      "k must not exceed the training row count; use tieBreak=error to avoid silent tie-breaking.",
      "BOM and CRLF are supported; labels may be A/B or A类/B类.",
      "All computation is local; no upload.",
      "The library ships separate training and test CSVs.",
      "A=180/B=156 is the measured result for the current library sample."
    ],
    "aka": [
      "KNN",
      "KNN classification",
      "K-nearest neighbours",
      "nearest neighbour classifier",
      "knnClassify",
      "Euclidean classifier",
      "Manhattan classifier",
      "A/B classification",
      "vehicle classification",
      "CSV classifier",
      "KNN algorithm",
      "supervised classification"
    ]
  },
  yunying: {
    "what": "Yunying (01248) is a classic CTF digit-substitution cipher: 0 separates letters, while 1/2/4/8 are additive weights whose sum maps to A=1..Z=26.",
    "principle": "Split the ciphertext on 0; each segment may contain only 1/2/4/8. Sum the digits to an index 1..26 and map it to A-Z.\n\nEncoding reverses this: decompose the letter index into 8/4/2/1 weights, ordered high to low, and separate letters with 0.\n\nThis is not binary: 1/2/4/8 are repeatable additive weights (8+8+8+2=26=Z).",
    "usage": "Paste the 01248 string and decode, or enter A-Z plaintext and encode. Decoding rejects characters outside 0/1/2/4/8 and segment sums outside 1..26.",
    "examples": [
      {
        "in": "880810421",
        "out": "PIG",
        "desc": "Split on 0; sum each segment and map to A-Z."
      },
      {
        "in": "ALICE",
        "out": "1084081021041",
        "desc": "A=1→1, L=12→84, I=9→81, C=3→21, E=5→41; letters separated by 0."
      }
    ],
    "formulas": [
      {
        "tex": "v=\\sum d_i,\\quad d_i\\in\\{1,2,4,8\\}",
        "caption": "sum of each segment"
      },
      {
        "tex": "\\text{char}=A_{v-1}",
        "caption": "map v∈1..26 to A-Z"
      }
    ],
    "tips": [
      "0 is only a separator, not a value; empty groups produce no letter.",
      "Segment sums must be 1..26; invalid digits or sums must error.",
      "Encoding accepts A-Z only; whitespace is ignored.",
      "This is not binary or octal: 1/2/4/8 may repeat."
    ],
    "aka": [
      "Yunying",
      "Yunying cipher",
      "01248",
      "01248 cipher",
      "01248 encode",
      "01248 decode",
      "digit sum cipher",
      "cloud shadow cipher",
      "yunying decode",
      "yunying encode",
      "A1Z26 variant",
      "CTF 01248"
    ]
  }
};
