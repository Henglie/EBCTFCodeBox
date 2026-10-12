/*
 * edu-cn-img-stego.en.js — English edu cards for cnImageStego.js (mirageTank / tomatoScramble).
 * Example descriptions describe the image ops' behavior (in/out are images, no verbatim text contract);
 * numeric correctness is backed by the verify script and interop tests against the reference web tool.
 */
export default {
  mirageTank: {
    what: "Mirage Tank — the image trick that went viral in QQ's heyday: one PNG that shows one picture as a white-background thumbnail in the chat list, and a completely different picture when opened full-screen on a black background. Named after Red Alert 2's tree-disguising Mirage Tank; 光影坦克 (\"light-shadow tank\") is the other popular Chinese name for the same trick (light = what you see on white, shadow = on black).",
    principle:
      "It is pure alpha-channel math: a semi-transparent pixel over a background renders as foreground×α + background×(1−α). Write that equation once for white (255) and once for black (0):\n\n" +
      "$$C_{white} = \\alpha F + (1-\\alpha)\\cdot 255, \\qquad C_{black} = \\alpha F$$\n\n" +
      "Subtracting gives $\\alpha = 1 - (C_{white}-C_{black})/255$ and foreground $F = C_{black}/\\alpha$. Pixels where the two pictures differ more become more opaque — the \"hidden picture\" needs no encryption at all, alpha just lends each image part of the brightness.\n\n" +
      "A PNG pixel has one alpha shared by R/G/B, so the classic approach converts both images to grayscale ($R=G=B$) for an exact composition; the color mode picks α from the largest per-channel difference — exact on the black side, a bright-biased fit on the white side (lossy, the tool reports the affected pixel count). If a pixel's hidden image is brighter than its surface image ($C_{black}>C_{white}$), α leaves [0,1] and can only be clamped — surface brighter than hidden is the precondition.",
    usage: "Drag the surface image (shown on white) as the main input, pick/drag the hidden image (shown on black) in the parameter row → encode gives an RGBA PNG; send it through QQ/WeChat as a file and thumbnail vs. full view show different pictures. Decode: drag a mirage PNG → decode produces both the white-background and black-background renders as PNGs — no squinting at backgrounds needed.",
    tips: [
      "Recognition: a PNG whose alpha channel is broadly semi-transparent (not 0/255) and looks washed out alone — decode it here, or compare viewers with white vs black backgrounds.",
      "WeChat/QQ recompress images on send: pick \"original quality\" or alpha dies and the mirage collapses into a dull grayscale JPEG.",
      "Keep the surface image overall brighter than the hidden one, or clamping distorts; pure-white areas of the surface (clouds, walls) \"vanish\" on white backgrounds — that is the trick's nature.",
      "Color mode can only be exact on the black side; for flawless results use the grayscale mode.",
    ],
    aka: ["mirage tank", "mirageTank", "幻影坦克", "光影坦克", "alpha double image", "dual image png", "white black background image", "transparent image stego", "qq mirage tank", "two faced picture", "light shadow tank", "hidden second image"],
  },

  tomatoScramble: {
    what: "Tomato Scramble (小番茄图片混淆) — a popular Chinese-internet image \"shuffle\": every pixel of the picture is re-queued along a snaking curve, turning the image into unrecognizable confetti; running the same algorithm backwards restores it exactly. The various online tools and the open-source desktop version all share one algorithm and decode each other's output.",
    principle:
      "Two steps:\n\n" +
      "① **The curve** — a Gilbert generalized Hilbert space-filling curve assigns every pixel of a W×H grid an order. Starting at the top-left, it visits every pixel exactly once with self-similar bends (works for any aspect ratio, not just squares).\n\n" +
      "② **The shift** — take the golden-ratio offset $\\text{offset} = \\mathrm{round}((\\sqrt{5}-1)/2 \\times W \\times H)$ and move each pixel to the position offset steps ahead along the curve: $dst[\\text{curve}[(i+\\text{offset}) \\bmod n]] = src[\\text{curve}[i]]$. The whole pixel (all four RGBA bytes) travels together; decoding is the exact inverse move.\n\n" +
      "The golden ratio's charm: it is maximally \"coprime\" to any integer, so the shift has maximal period and the image shatters with no symmetric leftovers.",
    usage: "Drag an image → encode gives the confetti picture (this tool outputs lossless PNG; most web versions output JPEG — the position algorithm is identical, so outputs interconvert) → drag the scrambled picture in and decode. For challenges with a known custom offset, enter it in the parameter; leave 0 for the reference golden-ratio default.",
    tips: [
      "Recognition: normal dimensions but the content is textured regular confetti; faint continuous color bands snake along the edges — the Hilbert curve's trace.",
      "A JPEG-scrambled image decodes with blocky compression noise (positions are right, values were bitten by JPEG); PNG-scrambled images restore losslessly.",
      "A scrambled image that was resized or cropped will not decode — the offset is derived from W×H, and changing size changes the whole shift.",
      "A related pixel scramble is the Arnold cat transform (its own op here): Arnold is periodic coordinate transformation, tomato is curve re-queueing — don't mix them up.",
    ],
    aka: ["tomato scramble", "tomatoScramble", "cherry tomato obfuscation", "小番茄", "小番茄混淆", "图片混淆", "image scramble", "hilbert scramble", "gilbert curve", "pixel shuffle", "image unscramble", "xiao fanqie"],
  },
};
