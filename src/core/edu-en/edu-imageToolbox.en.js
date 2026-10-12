// Edu content shard (EN): image toolbox batch (imageCompress/imageGray/imagePixelate/
// imageFrosted/imageSketch/imageToText/gifCompose/img2dataURI — 8 ops). Pure data, no import, no side effects.
export default {
  imageCompress: {
    what: "Image compress: re-encodes an image at a chosen quality level to shrink the file, optionally normalizing the format (JPEG/PNG/WebP) and dimensions.",
    principle:
      "JPEG/WebP are lossy: the image is cut into 8×8 blocks and transformed with the DCT; high-frequency components the eye is insensitive to are discarded — the lower the quality, the more is thrown away, the smaller the file and the blockier the artifacts. PNG is lossless (prediction + zlib), so the quality slider has no effect on it.\n\n" +
      "Max width uses nearest-neighbor downscaling: each output pixel copies the source pixel at $src=\\lfloor (dst+0.5)\\cdot W_{src}/W_{dst}\\rfloor$ (same center convention as Pillow NEAREST).",
    usage: "Drop an image (or paste base64/dataURL), pick quality (0-100) and output format, optionally set a max width. Output preview + download. For small files choose JPEG/WebP with mid/low quality; for exact pixels choose PNG.",
    examples: [
      { in: "（一张 2MB 的截图 PNG）", param: "quality=70, format=jpeg", out: "A few hundred KB JPEG, visually lossless", desc: "Screenshots/photos compress 5-20×" },
    ],
    tips: [
      "Quality only affects JPEG/WebP; PNG output is identical at any quality.",
      "Lossy compression is irreversible — re-compressing a stego carrier destroys the payload.",
      "Max width only downscales; small images are never enlarged.",
    ],
    aka: ["图片压缩", "image compress", "compress image", "shrink image", "jpeg compress", "jpg compress",
      "recompress", "image to jpeg", "image to webp", "reduce size", "图片重编码", "图片瘦身", "webp"],
  },

  imageGray: {
    what: "Image grayscale / binarization: turns a color image into gray levels (256) or pure black-and-white.",
    principle:
      "Grayscale is NOT (R+G+B)/3! The eye is most sensitive to green and least to blue, so the standard weights them: $L=0.299R+0.587G+0.114B$ (ITU-R BT.601). Implemented as $\\lfloor(299R+587G+114B)/1000\\rfloor$, pixel-identical to Pillow `convert('L')`.\n\n" +
      "Binarization = threshold the gray value: ≥ threshold → white, < threshold → black. A good threshold makes text/patterns pop out of the background.",
    usage: "Drop an image, choose gray or binary (threshold 0-255). Output PNG preview + download.",
    examples: [
      { in: "（一张彩色二维码截图）", param: "mode=gray", out: "Grayscale image, luminance preserved", desc: "Pixel-identical to Pillow convert('L')" },
      { in: "（被涂鸦干扰的文字图）", param: "mode=binary, threshold=128", out: "Pure B/W, doodles flattened", desc: "Threshold adjustable 0-255" },
    ],
    tips: [
      "Faint watermarks and pencil marks in scans often become clearer after binarization.",
      "Bit-plane stego analysis usually starts with grayscale — drop color first to see luminance textures.",
      "Threshold 0 or 255 yields all-white/all-black output — expected, not a bug.",
    ],
    aka: ["黑白化", "grayscale", "gray scale", "binarize", "binarization", "threshold", "图片黑白",
      "灰度化", "二值化", "convert to gray", "black and white", "otsu", "图片去色", "gray"],
  },

  imagePixelate: {
    what: "Pixelate (mosaic): cuts the image into squares and fills each with its average color — detail gone, only color blocks remain.",
    principle:
      "Each output pixel corresponds to a block×block square in the source: the arithmetic mean of covered pixels. Edge blocks that fall off the image are averaged over their actual coverage (no padding). This is box-filter downsampling, same family as Pillow's `reduce` (±1 rounding).",
    usage: "Drop an image, set the block size (1-512, default 8). Output preview + download.",
    examples: [
      { in: "（一张 200×150 图）", param: "block=10", out: "A 20×15 color-block image", desc: "Edge blocks shrink to actual coverage" },
    ],
    tips: [
      "Mosaicking is irreversible — for a censored flag, try brute-forcing glyph shapes on small blocks.",
      "Reverse use: mosaic a flag image and read each block as a pixel for a dot-matrix look.",
      "block=1 returns the original image (each block is a single pixel).",
    ],
    aka: ["像素化", "mosaic", "pixelate", "pixelize", "打码", "block average", "color blocks",
      "图片马赛克", "打马赛克", "马赛克", "downsample", "像素块"],
  },

  imageFrosted: {
    what: "Frosted glass: uniformly blurs the whole image — like looking through ground glass. Low frequencies stay, high frequencies vanish.",
    principle:
      "Box blur: each pixel becomes the average of the (2r+1)×(2r+1) window around it. Implemented as two separable passes (horizontal sliding-window average, then vertical) so the cost is independent of radius. Edge windows shrink to the pixels that actually exist. Two box passes approximate a Gaussian blur.",
    usage: "Drop an image, set the blur radius (1-20, default 4). Output preview + download.",
    examples: [
      { in: "（一张细纹理截图）", param: "radius=8", out: "Details smoothed into large soft patches", desc: "Larger radius = blurrier" },
    ],
    tips: [
      "Radius 1-2 is a gentle soften; 10+ hides small text entirely.",
      "Versus pixelate: frosted glass is continuous blur, mosaic is discrete blocks.",
      "Frequency view: box blur is a low-pass filter — blur the low frequencies away, then diff to reveal high-frequency hiding spots.",
    ],
    aka: ["毛玻璃", "frosted glass", "box blur", "blur", "盒模糊", "图片模糊", "gaussian approx",
      "磨砂", "smoothing", "low-pass", "柔化", "模糊"],
  },

  imageSketch: {
    what: "Image to sketch: turns a photo into a pencil drawing — two flavors: color-dodge sketch (dodge) and Sobel edge map.",
    principle:
      "dodge (classic pencil-sketch recipe): ① take the grayscale $g$; ② invert to $255-g$ and box-blur to get $b$; ③ color-dodge blend $out=g\\times 255/(255-b)$ (denominator 0 → 255). The blur radius controls stroke thickness.\n\n" +
      "edge: Sobel operator — two 3×3 convolutions compute horizontal/vertical gradients $G_x,G_y$; magnitude $\\sqrt{G_x^2+G_y^2}$ maps darker for stronger edges, producing black lines on white.",
    usage: "Drop an image, choose dodge (sketchy) or edge (outlines); dodge exposes a blur radius (1-40). Output preview + download.",
    examples: [
      { in: "（一张人像照片）", param: "mode=dodge, blurRadius=12", out: "Black strokes on white paper" },
      { in: "（一张徽标图）", param: "mode=edge", out: "Outline-only B/W image" },
    ],
    tips: [
      "dodge output is nearly all white with dark strokes — good for spotting patterns hidden in shading.",
      "edge is noisy on photos but excellent on logos/text/geometric art.",
      "Text hidden under translucent overlays often shows up directly after edge mode.",
    ],
    aka: ["转素描", "pencil sketch", "sketch", "color dodge", "sobel", "edge detection",
      "素描化", "铅笔素描", "edge map", "outline", "轮廓提取", "线稿", "铅笔画"],
  },

  imageToText: {
    what: "Image to text (ASCII art): turns an image into characters — light areas get sparse glyphs (like . or space), dark areas get dense ones (like @ #).",
    principle:
      "① Split the image into a grid with the chosen column count (vertical step = 2× horizontal step to compensate for monospace glyphs being about twice as tall as wide, otherwise faces look squashed); ② average the luminance $L=0.299R+0.587G+0.114B$ per cell; ③ map $idx=\\lfloor L/256\\times n\\rfloor$ into the gradient charset. Invert swaps the mapping for light-background images.",
    usage: "Drop an image, tune columns (20-400, default 80), charset and invert. Output is plain text, ready to copy.",
    examples: [
      { in: "（一张 flag 文字图）", param: "width=100", out: "An @#* character drawing that spells the flag from afar" },
      { in: "（黑底亮字图）", param: "invert=true", out: "Glyphs render correctly after inversion" },
    ],
    tips: [
      "Paste into a monospace font or the art distorts; more columns = finer art and more lines.",
      "The bits charset (01) outputs a raw bitstream — handy to feed later bit operations.",
      "Reading it backwards: converting characters back to pixel densities is a common challenge-authoring trick.",
    ],
    aka: ["字符画", "ascii art", "image to text", "text art", "asciiart", "字符画生成",
      "image to ascii", "图片转文字", "字符图", "ascii画", "brightness mapping", "图片文本化"],
  },

  gifCompose: {
    what: "GIF compose: stitches multiple images into an animated GIF with per-frame delay and loop count. The inverse of GIF frame extraction — authoring and re-processing closed loop.",
    principle:
      "A self-implemented GIF89a encoder: ① global color table — if unique colors ≤256 build an exact palette, otherwise median-cut (count-weighted recursive splitting of color space) down to 256 colors with RGB555 nearest-color mapping; ② each frame gets a Graphic Control Extension carrying its delay (centiseconds = ms/10); ③ index streams are LZW-compressed (GIF variable-length codes, LSB-first packing, CLEAR reset at 4096 codes); ④ a NETSCAPE2.0 application extension sets looping (0 = forever). Non-first-size frames are normalized to the first frame (stretch, or scale-and-center onto a fill color).",
    usage: "Drop one image and paste the rest as base64/dataURL lines into the main input or the extra-images param (≥2 frames total), set per-frame delay (ms) and loop count. Output GIF preview + download; verify with GIF frame extraction.",
    examples: [
      { in: "（按行粘 3 张同尺寸 PNG）", param: "delay=200, loop=0", out: "A 3-frame looping GIF" },
      { in: "（大小不一的图）", param: "fitMode=pad, padColor=#ffffff", out: "Centered on white, uniform size" },
    ],
    tips: [
      "Delay granularity is centiseconds (1/100 s): 100ms and 109ms both land on 10; browsers render <20ms delays as 100ms.",
      "Pairs with GIF frame-timing stego: the delay sequence itself can carry data — author with unusual delays on purpose.",
      "Photo-like material exceeding 256 colors gets quantized; line art / QR frames usually have few colors and compose losslessly.",
    ],
    aka: ["gif合成", "gif compose", "compose gif", "images to gif", "make gif", "gif maker",
      "动图合成", "gif encoder", "lzw", "拼gif", "帧动画", "多图合成", "图片转gif", "生成gif"],
  },

  img2dataURI: {
    what: "Image to Base64/dataURI: turns an image file into text — paste it into HTML/CSS/JS as an inline image with no separate file needed.",
    principle:
      "A data URI looks like `data:[<MIME>][;base64],<data>`: the MIME declares the type and the base64 flag says the payload is base64. This tool sniffs MIME from the file header magic (PNG 89 50 4E 47, JPEG FF D8 FF, GIF GIF8, BMP BM, WebP RIFF…WEBP, ICO 00 00 01 00) instead of trusting the extension — CTF carriers often deliberately rename suffixes.",
    usage: "Drop an image (or paste base64/dataURL), choose output: dataURI (paste into web pages) / raw base64 / both. Output is plain text.",
    examples: [
      { in: "（拖入一张 PNG）", param: "output=datauri", out: "data:image/png;base64,iVBORw0KGgo..." },
      { in: "（一张改名 .txt 的 JPEG）", param: "output=both", out: "MIME still image/jpeg — header-based, not extension-based" },
    ],
    tips: [
      "CSS usage: background-image: url(data:image/png;base64,...).",
      "A long data:image/… string pasted back into this tool restores the original image file.",
      "Base64 inflates size by ~4/3; prefer file references for large images.",
    ],
    aka: ["图片转base64", "img2base64", "image to base64", "data uri", "datauri", "图片base64",
      "image to datauri", "base64 image", "inline image", "内嵌图片", "mimesniff", "图片转文本"],
  },

  spriteSheet: {
    what: "Sprite sheet ↔ frame sequence converter: slice a grid-arranged sprite sheet into individual frames, or pack a set of equal-size frames back into one grid sheet.",
    principle:
      "A sprite sheet is the standard game-asset format: every frame is the same size, laid out row-major (row 1 left to right, then row 2, …) into a $cols\\times rows$ grid. Slicing is pure geometry: frame width $fw=W/cols$, frame height $fh=H/rows$; frame $(r,c)$ copies the source rectangle $(c\\cdot fw, r\\cdot fh)$ pixel-for-pixel with zero resampling — a lossless round trip (slice then merge reproduces the original byte-for-byte). Sheet width/height must divide evenly by cols/rows, otherwise it fails loudly instead of silently cropping.",
    usage: "Slice: drop a sprite sheet, enter columns and rows of the grid, and download frames as frame_000 onwards. Merge: switch direction to \"frames → sheet\", drop the first frame, paste the rest one base64/dataURL per line into the extra box, and set frames per row (empty trailing cells are transparent).",
    examples: [
      { in: "(a 512×512 sprite sheet)", param: "mode=split, cols=4, rows=4", out: "16 PNGs of 128×128, frame_000…frame_015", desc: "Row-major numbering; feed them into GIF Compose for an animation" },
      { in: "(8 frames of 64×64)", param: "mode=merge, cols=4", out: "a 256×128 sheet, 4×2 grid", desc: "Trailing empty cells are transparent" },
    ],
    tips: [
      "Row-major is the mainstream convention (Unity/Godot/Cocos all export sprite sheets row by row) — if the numbering looks scrambled, check whether the sheet was exported column-major.",
      "Equal frame size is a hard constraint: resize mismatched frames first, then merge.",
      "In CTFs a flag is often hidden in a single frame: slice first and inspect frame by frame — far faster than squinting at the big sheet.",
    ],
    aka: ["精灵图", "sprite sheet", "sprite", "spritesheet", "序列帧", "拆帧", "切帧", "帧提取",
      "雪碧图", "图集切割", "逐帧拆分", "序列帧合成", "精灵图切割", "frame extraction"],
  },
};
