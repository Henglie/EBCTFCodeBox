// English edu shard: stego image family (LSB / scrambling / bit-plane / PNG·JPEG·GIF chunk parsing). Pure data, no imports, no side effects.
export default {
  pixelJihad: {
    what: "PixelJihad steganography: an advanced LSB — a password-derived pseudorandom sequence decides which pixel bits hold the data, with optional AES-CCM encryption on top, far stealthier than sequential LSB.",
    principle:
      "SHA-256 turns the password into a seed fed to a pseudorandom number generator, which decides which pixels' lowest bits the hidden bits scatter into (not laid out in order from the start). Without the password you don't know the read order. With AES-CCM enabled, the message is encrypted before embedding and decrypted after extraction.",
    usage: "Encode: enter a password (and optional AES key) to scatter the message into the image's lowest bits. Decode: the same password restores the read order and extracts the message.",
    examples: [
      { in: "a PNG + password", out: "hidden message", desc: "A wrong password scrambles the bit order entirely" },
    ],
    tips: ["Sequential LSB finds nothing, but the challenge hints at steganography and gives a password → try PixelJihad. The pixel changes are scattered, hard for the eye and standard LSB tools to spot."],
    aka: ["pixeljihad", "伪随机lsb", "口令lsb隐写", "PixelJihad", "密码lsb", "随机lsb隐写", "分散lsb", "aes-ccm lsb", "口令隐写", "伪随机位隐写"],
  },

  arnoldCat: {
    what: "Arnold's cat map: a permutation that 'scrambles' the pixels of a square image; scrambling enough times magically restores the original (it's periodic). Used in CTF to scramble/restore hidden images.",
    principle:
      "For an N×N image, each pixel coordinate undergoes the linear transform $(x,y)\\to(2x+y,\\ x+y)\\bmod N$, moving the pixel to a new position. This map is a bijection with period T — after T iterations every pixel returns to its origin and the image is restored.",
    usage: "Input a square image and an iteration count: forward iterations scramble the image; continuing to period T restores it.",
    examples: [
      { in: "N×N image", param: "iterate k times", out: "scrambled image", desc: "Iterate T−k more times to restore" },
    ],
    formulas: [
      { tex: "\\begin{pmatrix}x'\\\\y'\\end{pmatrix}=\\begin{pmatrix}2&1\\\\1&1\\end{pmatrix}\\begin{pmatrix}x\\\\y\\end{pmatrix}\\bmod N", caption: "Arnold cat map matrix" },
    ],
    tips: ["An image obviously block-scrambled and square → try Arnold. If you don't know the iteration count, just keep iterating; the moment it suddenly looks clear is the restore point."],
    aka: ["arnold变换", "猫脸变换", "arnold cat map", "图像置乱", "Arnold Cat Map", "阿诺德变换", "猫映射", "arnold scrambling", "像素置乱", "图像还原变换"],
  },

  imageBasic: {
    what: "Image basic-operations collection: invert, flip, channel split, bit-plane extraction, and other routine transforms. The 'try everything once' toolbox for misc image challenges.",
    principle:
      "Basic per-pixel operations: invert is $255-v$; flip rearranges pixel coordinates; channel split keeps just one of R/G/B to view a single-channel pattern; bit-plane extraction pulls out one specific bit. Many challenges hide the flag in a single channel or reveal it only after inverting.",
    usage: "Upload an image, choose an operation (invert/flip/channel split/bit-plane…), and see whether the transform reveals hidden content.",
    examples: [
      { in: "an image", param: "invert", out: "inverted image, may reveal hidden text" },
    ],
    tips: ["When you get an image challenge, run through the basics mindlessly first: invert, split channels, view each bit-plane — the flag is often hidden in one channel or one bit-plane."],
    aka: ["图像基础操作", "image basic", "反色翻转通道", "图像反色", "通道分离", "图像翻转", "image invert", "channel split", "灰度反转", "图像变换工具"],
  },

  pngText: {
    what: "PNG text-chunk read/write: PNG can store text metadata (author, description, comment) in tEXt/zTXt/iTXt chunks. Flags love hiding here. Operates on file bytes directly, not via the canvas.",
    principle:
      "PNG is made of chunks; there are three text chunks: tEXt (uncompressed keyword+text), zTXt (zlib-compressed text), iTXt (supports UTF-8/multilingual, optionally compressed). The tool parses these chunks to read out text and can also write new text chunks.",
    usage: "Upload a PNG (base64 in/out), read all text-chunk contents, or write a custom keyword+text.",
    examples: [
      { in: "PNG with tEXt", out: "keyword=Comment, text=flag{...}" },
    ],
    tips: ["Running `strings` on a PNG often glimpses tEXt plaintext; zTXt is compressed so it needs one decompression pass. When you see tEXt/zTXt/iTXt sandwiched after IHDR, read it."],
    aka: ["png文本块", "png text", "text", "ztxt", "itxt", "tEXt块", "zTXt块", "iTXt块", "png元数据", "png文本chunk"],
  },

  bitplaneSlicing: {
    what: "Bit-plane decomposition: extracts one specific bit of every pixel of an image and assembles it into a black-and-white image of just 0/1. Hidden patterns are often visible only in one bit-plane.",
    principle:
      "An 8-bit channel value has 8 bits (bit0 lowest to bit7 highest). High bit-planes retain the image's main outline, while the lowest bit-plane (bit0) usually looks like noise — but if LSB steganography stuffed regular data in, the lowest bit-plane reveals text/QR patterns. Color images split by RGB channel, grayscale by luminance.",
    usage: "Upload an image, choose a channel and bit (0=LSB..7=MSB), and output that bit-plane's black-and-white image.",
    examples: [
      { in: "an image", param: "R channel bit0", out: "lowest bit-plane B&W image, may reveal text" },
    ],
    tips: ["View each bit-plane, especially each channel's bit0/bit1. Hidden QR codes, text, and patterns are often hidden in the lowest few bit-planes."],
    aka: ["位平面分解", "bitplane slicing", "位平面", "bit plane", "比特平面", "位平面提取", "bit plane slicing", "LSB位平面", "位平面隐写", "比特层分离"],
  },

  imageDiff: {
    what: "Image difference comparison: takes two images and runs a per-pixel operation (XOR/difference/add/and/or) to force out the layer hidden in the 'difference between the two images'.",
    principle:
      "Some challenges hide the flag in the difference between 'original vs. modified image', or scatter it across two seemingly identical images. Per-pixel XOR zeros out identical parts and highlights differences; difference/bitwise ops do the same. The identical background cancels out and the hidden layer surfaces.",
    usage: "Upload two same-size images (pass the second via p.image2), choose an operation (XOR/diff/add/and/or), and output the result image.",
    examples: [
      { in: "image A + image B", param: "XOR", out: "difference image of the two, hidden layer revealed", desc: "Identical pixels XOR to 0 (black)" },
    ],
    tips: ["A challenge gives 'two nearly identical images' → nine times out of ten it wants you to XOR/subtract to find the difference. Sizes must match to align pixel by pixel."],
    aka: ["图像差异", "image diff", "图像异或", "双图对比", "图像对比", "image xor", "图片差异", "逐像素对比", "图像差值", "两图异或"],
  },

  pngChunkList: {
    what: "PNG full-chunk parse: lists every chunk in a PNG (IHDR/PLTE/tEXt/IDAT/IEND, etc.) and parses text chunks and metadata. See whether the PNG structure has anomalies or hides something.",
    principle:
      "PNG = 8-byte signature + a series of chunks, each chunk being 'length + type + data + CRC'. IHDR stores width/height/bit depth, IDAT is the pixel data, IEND finishes, and tEXt/zTXt/iTXt/bKGD/iCCP, etc. may sit in between. The tool walks through listing each chunk's type and size, interpreting text and metadata.",
    usage: "Upload a PNG, output the full chunk list + text-chunk contents + metadata.",
    examples: [
      { in: "a PNG", out: "IHDR, PLTE, tEXt(flag), IDAT×N, IEND" },
    ],
    tips: ["Data after IEND → hidden content appended to the file tail. Anomalous/duplicate/misplaced chunks are all clues. If width/height mismatch IHDR, consider a modified-height challenge."],
    aka: ["png块解析", "png chunk", "png结构", "chunk列表", "png chunk parser", "IHDR IDAT IEND", "png分块", "png结构解析", "png chunk list", "png文件结构"],
  },

  jpegAppList: {
    what: "JPEG APPn segment listing: JPEG is composed of marker segments starting with 0xFF; APP0-APP15 store metadata (JFIF/EXIF/ICC, etc.). The tool lists all segments to help you find where things hide.",
    principle:
      "JPEG divides into marker segments: SOI (start), APP0 (JFIF), APP1 (EXIF), APP2 (ICC), DQT (quantization table), DHT (Huffman table), SOF (frame), COM (comment), SOS (scan data), EOI (end). The tool walks through marking each segment's type and content summary.",
    usage: "Upload a JPEG, output a list of all APPn and other marker segments with content identification.",
    examples: [
      { in: "a JPEG", out: "SOI, APP0(JFIF), APP1(EXIF), COM(comment), ..." },
    ],
    tips: ["The COM comment segment, APP1's EXIF, and data appended after EOI are all common hiding spots. A scrambled segment structure may also signal tampering."],
    aka: ["jpeg段", "jpeg app", "appn段", "jpeg marker", "jpeg marker解析", "APP0 APP1", "jpeg分段", "jfif exif段", "jpeg结构解析", "jpeg segment"],
  },

  gifComment: {
    what: "GIF comment extension: GIF89a supports a comment extension block (0x21 0xFE) that can store plain text. Flags are often stuffed here. The tool assembles all comments.",
    principle:
      "GIF89a extension blocks are introduced by 0x21; the comment extension is 0x21 0xFE, followed by several sub-blocks (each starting with a length byte, terminated by 0x00). The tool finds the comment extension and concatenates all sub-blocks to get the full comment text.",
    usage: "Upload a GIF, output all text in the comment extension block.",
    examples: [
      { in: "a GIF89a", out: "comment text = flag{...}" },
    ],
    tips: ["For GIF challenges, check the comment extension first; `strings` can glimpse it too. Also, multi-frame GIFs may hide a chunk in each frame — use gifFrames alongside."],
    aka: ["gif注释", "gif comment", "注释扩展", "gif comment extension", "gif89a注释", "注释扩展块", "gif注释块", "0x21 0xFE", "gif隐藏文本", "comment extension"],
  },

  gifFrames: {
    what: "GIF multi-frame extraction: GIF can store multi-frame animation; the tool lists each frame's position, size, delay, disposal method, transparent color, etc. Hidden content is often scattered across a few frames.",
    principle:
      "Each GIF frame is introduced by an image descriptor 0x2C carrying that frame's top-left coordinate, width/height, and local color table flag. The graphic control extension records frame delay and disposal method (whether to clear after drawing). The tool parses these to find each frame's info for frame-by-frame viewing.",
    usage: "Upload a multi-frame GIF, output each frame's position/size/local color table/delay/disposal method/transparent color.",
    examples: [
      { in: "multi-frame GIF", out: "frame0: (0,0) 100×100 delay10; frame1: ..." },
    ],
    tips: ["A frame that flashes by in the animation, or a hidden frame with delay 0, often hides the flag. Take the frames apart one by one — don't just look at the first."],
    aka: ["gif帧", "gif frames", "多帧提取", "gif动画", "gif逐帧", "gif帧提取", "gif分帧", "animated gif frames", "gif多帧", "gif动图拆帧"],
  },

  iccStrip: {
    what: "ICC strip: removes the ICC color profile from an image (PNG's iCCP chunk / JPEG's APP2 segment) and returns a clean image. ICC data is sometimes stuffed with hidden data.",
    principle:
      "An ICC profile is a block of data describing the color space; PNG stores it in the iCCP chunk, JPEG in the ICC_PROFILE portion of APP2. It can be quite large, making it a handy place to hide things. The tool locates and removes the ICC segment, outputting the ICC-free base64.",
    usage: "Upload an image, output the ICC-stripped image (base64). Before stripping, you can first check whether the ICC segment holds anomalous data.",
    examples: [
      { in: "PNG with iCCP", out: "PNG with ICC removed" },
    ],
    tips: ["An abnormally large ICC segment → may hide data; dump it out and check before stripping. Stripping ICC can also fix challenge images with 'wrong color display' issues."],
    aka: ["icc剥离", "icc strip", "iccp", "色彩配置剥离", "ICC profile剥离", "iCCP块", "色彩配置文件", "icc profile strip", "去除icc", "icc色彩剥离"],
  },

  arnoldCatBrute: {
    what: "Arnold Cat Map brute-force: when you don't know the Arnold parameters (a/b/iterations), exhaustively try every combination in reverse and tile the candidates into a grid image — scan the grid and spot the restored image.",
    principle:
      "The parameterized Arnold matrix is $\\begin{pmatrix}1&a\\\\b&ab+1\\end{pmatrix}\\bmod N$ (determinant 1, hence invertible). Forward: $\\begin{pmatrix}x'\\\\y'\\end{pmatrix}=M\\begin{pmatrix}x\\\\y\\end{pmatrix}$; inverse uses $M^{-1}=\\begin{pmatrix}ab+1&-a\\\\-b&1\\end{pmatrix}$. Brute force nests loops over a, b and iteration count, inverts the image for each combination and tiles thumbnails into a grid.",
    usage: "Upload a square image, set start/end ranges for a/b/iterations (default a:1-3, b:1-3, times:1-5 = 45 combos), output the candidate grid. Cap is 2000 combos.",
    examples: [
      { in: "scrambled image", param: "a:1-3 b:1-3 times:1-5", out: "45-cell candidate grid", desc: "the restored image is one cell" },
    ],
    formulas: [
      { tex: "M=\\begin{pmatrix}1&a\\\\b&ab+1\\end{pmatrix},\\ M^{-1}=\\begin{pmatrix}ab+1&-a\\\\-b&1\\end{pmatrix}\\pmod N", caption: "parameterized Arnold matrix and inverse" },
    ],
    tips: ["Challenge gives only the image → scan the default range first; cells with clean straight edges are candidates. a=b=1 is the classic cat map (degenerate case). Image must be square."],
    aka: ["arnold暴破", "猫脸暴破", "arnold brute force", "猫脸破解", "arnold参数破解", "猫脸暴力破解", "arnold穷举", "猫脸穷举", "arnold crack", "猫脸还原"],
  },

  stegpy: {
    what: "stegpy steganography (stegv3): the format used by the stegpy tool — message bytes are interleaved into pixel low bits by bit planes (1/2/4 bits), with a frame header carrying the stegv3 magic and length, optionally encrypted with PBKDF2+Fernet. Directly extracts data hidden by stegpy.",
    principle:
      "The host is the image's RGB byte stream (alpha removed, row-major flattened). Bit-plane interleaving: with divisor=8/bits, the bits groups of message byte k are written into the low bits of host[k*divisor+i] (i=0..divisor-1) — the byte stream is split into bits-sized groups spread divisor apart. The first byte's bits 4-5 store the bits marker (1→0, 2→16, 4→32). Frame format: `stegv3`(6B) + message length(4B big-endian) + filename length(1B) + [filename] + message. Password mode: PBKDF2-HMAC-SHA256 with 100k iterations derives a 32-byte key → Fernet (AES-128-CBC + HMAC-SHA256), 16-byte salt prefixed.",
    usage: "Encode: upload a carrier image, enter the text and bit count (1/2/4), optional password. Decode: upload a stegpy image, enter the password (if any) to extract the message; a filename is reported when present.",
    examples: [
      { in: "carrier PNG + text", param: "bits=2", out: "stego PNG", desc: "low-bit disturbance invisible to the eye" },
      { in: "stego PNG", param: "password (if any)", out: "hidden message/filename", desc: "no password → stegv3 magic missing error" },
    ],
    tips: ["Images from the stegpy tool or tutorials → extract with this op, more reliable than generic LSB scans. For RGBA carriers only the RGB channels are used (matching the stegpy tool). Wrong password reports a Fernet MAC failure."],
    aka: ["stegpy", "stegv3", "stegpy隐写", "stegpy提取", "stegv3隐写", "stegpy解密", "stegpy steganography", "stegpy解码", "stegpy工具", "fern隐写"],
  },

  stereogramSolver: {
    what: "Stereogram solver: an autostereogram (SIRDS) encodes hidden depth in the horizontal repetition period of its pattern. Subtract the image from a horizontally rolled copy of itself — where the repeating pattern aligns (correct offset) it darkens and the hidden text/shapes emerge as depth stripes.",
    principle:
      "For each offset: $\\text{diff}(x,y)=\\text{clip}(\\text{img}(x,y)-\\text{img}((x-\\text{offset})\\bmod w,\\ y),\\ 0,\\ 255)$ (numpy.roll-style horizontal shift). Depth stripes are the regions where shift matches the repetition period → difference 0. Offset ranges over [-w/2, w/2]; auto-scan mode tiles all offsets as thumbnails — pick the sharpest cell.",
    usage: "Upload the stereogram. If you know the period, set a single offset for an exact solve; otherwise leave it blank for auto-scan (default -32..32 step 2) and find the cell with the strongest contrast / clearest text.",
    examples: [
      { in: "SIRDS random-dot image", param: "offset=period", out: "revealed stripe image", desc: "dark stripes are the hidden content" },
      { in: "SIRDS random-dot image", param: "blank auto-scan", out: "candidate grid", desc: "the sharpest cell's offset is the period" },
    ],
    tips: ["Stereogram challenges nearly all work this way: subtract the image from its own shifted copy. Not found → widen the scan range (step can go to 1). Works even on fully random dot fields."],
    aka: ["立体图", "autostereogram", "sirds", "立体图求解", "stereogram", "随机点立体图", "立体图隐写", "stereogram solver", "3d立体图", "魔眼图"],
  },
};
