/*
 * alphaStrip.js — alpha 通道条带隐写解码（3 bit/样本）。
 *
 * 适用：PNG（RGBA）或 BMP（带 alpha）中，一条连续的 alpha 像素只使用
 * 少数几个值（例如 245..252）编码 3 bit/样本；按位流打包后可能是
 * UTF-16LE / UTF-8 文本。Image_Steganography.png 即此形态：
 * alpha 仅首行 192 像素，减 245 后 3 bit LSB-first，字节内 LSB-first，
 * UTF-16LE 得到 8f6711e6-7bb1-44e5-9ddf-5138127235ab。
 *
 * 纯函数、零 DOM、零网络、零随机；只在内存里解码。
 */
import { decodePNG } from "./stegoPixels.js";
import { decodeBMP } from "./rasterStego.js";

const MAX_SAMPLES = 8192;
const MAX_PIXELS = 16_000_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FLAG_RE = /(?:flag|ctf|key)\{[^{}\r\n]{1,200}\}/i;

function toBytes(src) {
  if (src instanceof Uint8Array) return src;
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  return null;
}

function alphaSamples(bytes) {
  const b = toBytes(bytes);
  if (!b || !b.length) return null;
  let img = null;
  try {
    if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
      img = decodePNG(b);
    } else if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
      img = decodeBMP(b);
    }
  } catch {
    return null;
  }
  if (!img || !img.data || !img.width || !img.height) return null;
  if (img.width * img.height > MAX_PIXELS) return null;
  if (img.data.length < img.width * img.height * 4) return null;
  const vals = [];
  const data = img.data;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i];
    if (a !== 255 && a !== 0) vals.push(a);
  }
  if (vals.length < 16 || vals.length > MAX_SAMPLES) return null;
  let min = 255, max = 0;
  for (const v of vals) { if (v < min) min = v; if (v > max) max = v; }
  if (max - min > 7) return null;
  return { vals, min, range: max - min + 1, width: img.width, height: img.height };
}

function packBits(samples, min, valueMsb, byteMsb, reverse, invert) {
  const src = reverse ? [...samples].reverse() : samples;
  const bits = [];
  for (const v of src) {
    let d = v - min;
    if (invert) d = 7 - d;
    for (let i = 0; i < 3; i++) bits.push(valueMsb ? (d >> (2 - i)) & 1 : (d >> i) & 1);
  }
  const out = new Uint8Array(Math.floor(bits.length / 8));
  for (let i = 0, o = 0; i + 7 < bits.length; i += 8, o++) {
    let byte = 0;
    for (let k = 0; k < 8; k++) {
      if (byteMsb) byte = (byte << 1) | bits[i + k];
      else byte |= bits[i + k] << k;
    }
    out[o] = byte;
  }
  return out;
}

function printableRatio(s) {
  if (!s) return 0;
  let ok = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) ok++;
  }
  return ok / s.length;
}

function tryText(bytes) {
  const out = [];
  if (bytes.length >= 2 && bytes.length % 2 === 0) {
    try {
      const s = new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
      out.push({ enc: "utf-16le", text: s });
    } catch { /* not UTF-16LE */ }
  }
  try {
    const s = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    out.push({ enc: "utf-8", text: s });
  } catch { /* not UTF-8 */ }
  return out;
}

function scoreText(s, enc) {
  if (!s) return 0;
  const t = s.replace(/\u0000/g, "").trim();
  if (!t) return 0;
  if (UUID_RE.test(t)) return 120;
  if (FLAG_RE.test(t)) return 110;
  const ratio = printableRatio(t);
  if (ratio >= 0.95 && t.length >= 8) return enc === "utf-16le" ? 80 : 60;
  if (ratio >= 0.8 && t.length >= 8) return 40;
  return 0;
}

/**
 * @param {Uint8Array|ArrayBuffer} bytes PNG/BMP
 * @returns {{ok:boolean, text?:string, uuid?:string, flag?:string, method?:string,
 *            samples?:number, min?:number, range?:number, encoding?:string}}
 */
export function alphaStripScan(bytes) {
  const meta = alphaSamples(bytes);
  if (!meta) return { ok: false };
  let best = null;
  for (const valueMsb of [false, true]) {
    for (const byteMsb of [false, true]) {
      for (const reverse of [false, true]) {
        for (const invert of [false, true]) {
          const packed = packBits(meta.vals, meta.min, valueMsb, byteMsb, reverse, invert);
          for (const cand of tryText(packed)) {
            const score = scoreText(cand.text, cand.enc);
            if (score > (best ? best.score : 0)) {
              best = {
                score,
                text: cand.text.replace(/\u0000/g, "").trim(),
                encoding: cand.enc,
                method: [
                  "3bit/sample",
                  valueMsb ? "value-msb" : "value-lsb",
                  byteMsb ? "byte-msb" : "byte-lsb",
                  reverse ? "reverse" : "forward",
                  invert ? "invert" : "normal",
                ].join(" "),
              };
            }
          }
        }
      }
    }
  }
  if (!best || best.score < 60) return { ok: false };
  const uuid = UUID_RE.test(best.text) ? best.text : undefined;
  return {
    ok: true,
    text: best.text,
    uuid,
    flag: uuid ? `flag{${uuid}}` : (FLAG_RE.test(best.text) ? best.text.match(FLAG_RE)[0] : undefined),
    method: best.method,
    samples: meta.vals.length,
    min: meta.min,
    range: meta.range,
    encoding: best.encoding,
  };
}

export default { alphaStripScan };
