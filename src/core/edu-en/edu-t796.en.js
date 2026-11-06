export default {
  httpDechunk: {
    what: "HTTP Dechunk restores a chunked Transfer-Encoding response body to raw bytes by stripping each chunk's size line and delimiter CRLF and reading the terminating zero-length chunk.",
    principle:
      "A chunked body is a sequence of chunks: hex length, CRLF, data, CRLF. A zero-length chunk ends the body and may be followed by trailer headers and a final CRLF.\n\nDechunk only unwraps the protocol layer; it does not decode gzip/deflate Content-Encoding, so compressed bodies need a separate decompression step.",
    usage:
      "Input may be a full HTTP response or just the chunked body. `inputEnc=raw` reads it as literal text; hex/base64 are for pasting binary. Output is the raw body with size lines removed.",
    examples: [
      { in: "4\\r\\nWiki\\r\\n0\\r\\n\\r\\n", param: "inputEnc=raw", out: "Wiki", desc: "single-chunk minimal case" },
      { in: "5\\r\\nHello\\r\\n6\\r\\n World\\r\\n0\\r\\n\\r\\n", param: "inputEnc=raw", out: "Hello World", desc: "two chunks joined" },
    ],
    tips: [
      "The hex size line may carry chunk extensions (;key=value); cut at the semicolon before parsing the length.",
      "Trailer headers may follow the terminating zero chunk; Dechunk should output only the body.",
      "For chunked + gzip, Dechunk first, then decompress; reversing the order fails.",
      "In capture-file challenges, reassemble the TCP stream before Dechunk.",
    ],
    aka: ["Dechunk", "HTTP Dechunk", "chunked decode", "Transfer-Encoding chunked", "HTTP chunked", "chunked body", "strip chunk lengths", "HTTP response unwrap", "chunk decode", "Dechunk HTTP response", "chunked response decode", "HTTP 分块解码"],
  },
  splitChannels: {
    what: "Split Colour Channels turns an RGBA image into four grayscale PNGs (R, G, B, A), each keeping only one channel for per-channel LSB/bit-plane analysis.",
    principle:
      "For each pixel (r,g,b,a), the four outputs at the same position are (r,r,r,255), (g,g,g,255), (b,b,b,255), (a,a,a,255). Single-channel differences become visible as gray levels, making steganographic traces easier to spot.\n\nSplitting does not alter data; it visualizes channel components.",
    usage:
      "Input any decodable PNG/BMP image; output four downloadable PNGs (channel_R/G/B/A.png). Alpha is preserved and inspectable instead of being mistaken for black.",
    examples: [
      { in: "any RGBA PNG", param: "default", out: "channel_R.png / channel_G.png / channel_B.png / channel_A.png", desc: "one PNG per channel" },
    ],
    tips: [
      "Check the LSB planes first; single-channel grayscale exposes weak watermarks better than the original.",
      "The alpha channel is often ignored but frequently carries data.",
      "Dimensions and pixel counts must match before/after; a change means decode/scale went wrong.",
    ],
    aka: ["Split Colour Channels", "Split Color Channels", "channel split", "split channels", "RGBA split", "R/G/B/A split", "color channel separation", "colour channel split", "single channel extract", "image channel split", "拆分颜色通道", "通道拆分"],
  },
};
